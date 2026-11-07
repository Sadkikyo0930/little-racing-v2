import * as THREE from 'three';
import { quality } from '../core/device.js';

/* ------------------------------------------------------------------ *
 * Caribbean sky, sun, and sea.
 * A physically-flavoured gradient dome (Rayleigh-ish) with layered
 * procedural cumulus, plus a Gerstner-wave ocean with sun glitter.
 * ------------------------------------------------------------------ */

const SKY_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const SKY_FRAG = /* glsl */ `
  varying vec3 vWorld;
  uniform vec3 uSunDir;
  uniform vec3 uZenith, uHorizon, uGround;
  uniform float uTime;

  // --- hash / value noise ------------------------------------------
  float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 6; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  void main() {
    vec3 dir = normalize(vWorld);
    float h = dir.y;

    // sky gradient
    float t = pow(smoothstep(-0.08, 0.62, h), 0.85);
    vec3 col = mix(uHorizon, uZenith, t);
    col = mix(uGround, col, smoothstep(-0.22, 0.02, h));

    // sun disc + broad forward-scatter halo
    float sd = max(dot(dir, uSunDir), 0.0);
    col += vec3(1.0, 0.86, 0.66) * pow(sd, 900.0) * 26.0;
    col += vec3(1.0, 0.78, 0.5) * pow(sd, 12.0) * 0.32;
    col += vec3(1.0, 0.72, 0.45) * pow(sd, 2.5) * 0.07;

    // clouds: two advected fbm layers, lit from the sun side
    if (h > 0.0) {
      vec2 uv = dir.xz / max(h + 0.12, 0.02);
      float d1 = fbm(uv * 0.55 + vec2(uTime * 0.006, uTime * 0.0026));
      float d2 = fbm(uv * 1.35 - vec2(uTime * 0.011, 0.0));
      float cloud = smoothstep(0.52, 0.82, d1 * 0.72 + d2 * 0.38);
      float detail = fbm(uv * 3.4 + vec2(uTime * 0.02, 0.0));
      cloud *= smoothstep(0.24, 0.68, detail + 0.28);
      // fake self shadowing: sample the density slightly toward the sun
      float lit = fbm((uv + uSunDir.xz * 0.34) * 0.55 + vec2(uTime * 0.006, uTime * 0.0026));
      float shade = smoothstep(0.35, 0.85, d1 - lit + 0.5);
      vec3 cloudCol = mix(vec3(0.52, 0.56, 0.64), vec3(1.06, 1.02, 0.98), shade);
      cloudCol += vec3(1.0, 0.8, 0.62) * pow(sd, 6.0) * 0.55 * (1.0 - shade);
      float fade = smoothstep(0.0, 0.16, h);
      col = mix(col, cloudCol, cloud * 0.92 * fade);
    }

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const OCEAN_VERT = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vFoam;

  // Gerstner wave train
  vec3 gerstner(vec2 dir, float steep, float wl, float t, vec3 p, inout vec3 tangent, inout vec3 binormal) {
    float k = 6.28318 / wl;
    float c = sqrt(9.8 / k);
    vec2 d = normalize(dir);
    float f = k * (dot(d, p.xz) - c * t);
    float a = steep / k;
    tangent += vec3(-d.x * d.x * (steep * sin(f)), d.x * (steep * cos(f)), -d.x * d.y * (steep * sin(f)));
    binormal += vec3(-d.x * d.y * (steep * sin(f)), d.y * (steep * cos(f)), -d.y * d.y * (steep * sin(f)));
    return vec3(d.x * (a * cos(f)), a * sin(f), d.y * (a * cos(f)));
  }

  void main() {
    vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
    vec3 tangent = vec3(1.0, 0.0, 0.0);
    vec3 binormal = vec3(0.0, 0.0, 1.0);
    vec3 disp = vec3(0.0);
    disp += gerstner(vec2(1.0, 0.35), 0.30, 42.0, uTime, p, tangent, binormal);
    disp += gerstner(vec2(0.7, -0.9), 0.24, 23.0, uTime, p, tangent, binormal);
    disp += gerstner(vec2(-0.4, 0.8), 0.20, 12.5, uTime, p, tangent, binormal);
    disp += gerstner(vec2(1.0, -0.2), 0.16, 6.2, uTime, p, tangent, binormal);
    p += disp;
    vNormal = normalize(cross(binormal, tangent));
    vFoam = smoothstep(0.55, 1.5, disp.y);
    vWorld = p;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;

const OCEAN_FRAG = /* glsl */ `
  uniform vec3 uSunDir, uShallow, uDeep, uSkyCol;
  uniform float uTime;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vFoam;

  float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
  }

  void main() {
    vec3 V = normalize(cameraPosition - vWorld);
    // high-frequency ripple detail on top of the Gerstner normal
    vec2 rp = vWorld.xz * 0.35;
    float n1 = noise(rp + uTime * 0.6), n2 = noise(rp * 2.1 - uTime * 0.45);
    vec3 N = normalize(vNormal + vec3((n1 - 0.5) * 0.35, 0.0, (n2 - 0.5) * 0.35));

    float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
    float depth = smoothstep(0.0, 60.0, length(vWorld.xz));
    vec3 water = mix(uShallow, uDeep, depth);

    // sun glitter
    vec3 H = normalize(uSunDir + V);
    float spec = pow(max(dot(N, H), 0.0), 420.0) * 3.4;
    float glitter = pow(max(dot(N, H), 0.0), 60.0) * 0.4 * noise(rp * 8.0 + uTime);

    vec3 col = mix(water, uSkyCol, clamp(fres * 0.9 + 0.06, 0.0, 1.0));
    col += vec3(1.0, 0.93, 0.8) * (spec + glitter);
    col = mix(col, vec3(0.95, 0.98, 1.0), vFoam * 0.5);

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class Environment {
  constructor(engine) {
    this.engine = engine;
    const scene = engine.scene;

    // Sun direction: late-afternoon Caribbean light, warm and raking.
    this.sunDir = new THREE.Vector3(0.42, 0.5, -0.76).normalize();

    /* ------------------------------ sky ----------------------------- */
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uSunDir: { value: this.sunDir },
        uZenith: { value: new THREE.Color(0x1f66c9).convertSRGBToLinear() },
        uHorizon: { value: new THREE.Color(0xbfe4f2).convertSRGBToLinear() },
        uGround: { value: new THREE.Color(0x7fa5b5).convertSRGBToLinear() },
        uTime: { value: 0 },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
    });
    /* 半径必须小于各级画质的相机 far（4000 / 2600 / 2000），并且要大于
     * 海面平面（2600×2600，角点距中心 1838 m）。
     * 原来是 2600：在 far=2000 的低画质档（以及无头软件光栅化）下，
     * 天空球被远平面裁掉一块 —— 画面上会出现一个巨大的深色圆斑，
     * 远看像一个倒扣的黑色穹顶挂在地平线上。1950 两头都安全。 */
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1950, 48, 32), this.skyMat);
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    /* ----------------------------- lights --------------------------- */
    this.sun = new THREE.DirectionalLight(0xfff0d8, 3.1);
    this.sun.position.copy(this.sunDir).multiplyScalar(320);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(quality.shadowMap, quality.shadowMap);
    const s = 130;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 700;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.035;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // Sky/ground bounce. Tropical bounce off pale stone is strong.
    this.hemi = new THREE.HemisphereLight(0xbfe0ff, 0x8a7a5e, 1.05);
    scene.add(this.hemi);

    // Warm fill from the opposite side so shadowed faces keep colour.
    this.fill = new THREE.DirectionalLight(0xffd9a8, 0.42);
    this.fill.position.set(-0.6, 0.35, 0.7).multiplyScalar(200);
    scene.add(this.fill);

    /* ------------------------- fog / aerial ------------------------- */
    scene.fog = new THREE.FogExp2(new THREE.Color(0xa9d3e8).convertSRGBToLinear(), 0.0016);

    /* ------------------------------ sea ----------------------------- */
    const oseg = quality.oceanSegments;
    const oceanGeo = new THREE.PlaneGeometry(5000, 5000, oseg, oseg);
    oceanGeo.rotateX(-Math.PI / 2);
    this.oceanMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: this.sunDir },
        uShallow: { value: new THREE.Color(0x2fd3c8).convertSRGBToLinear() },
        uDeep: { value: new THREE.Color(0x0a4a86).convertSRGBToLinear() },
        uSkyCol: { value: new THREE.Color(0x9fd0ea).convertSRGBToLinear() },
      },
      vertexShader: OCEAN_VERT,
      fragmentShader: OCEAN_FRAG,
    });
    this.ocean = new THREE.Mesh(oceanGeo, this.oceanMat);
    this.ocean.position.y = -7.5;
    this.ocean.frustumCulled = false;
    scene.add(this.ocean);

    /* ------------------ image-based lighting from sky --------------- */
    const pmrem = new THREE.PMREMGenerator(engine.renderer);
    pmrem.compileEquirectangularShader();
    const rt = pmrem.fromScene(new THREE.Scene().add(this.sky.clone()), 0, 0.1, 3000);
    scene.environment = rt.texture;
    scene.environmentIntensity = 0.85;
    pmrem.dispose();

    this._t = 0;
  }

  update(dt, focus) {
    this._t += dt;
    this.skyMat.uniforms.uTime.value = this._t;
    this.oceanMat.uniforms.uTime.value = this._t;
    if (focus) {
      this.sky.position.set(focus.x, 0, focus.z);
      this.ocean.position.set(focus.x, -7.5, focus.z);
      // keep the shadow frustum tight around the action
      this.sun.position.copy(this.sunDir).multiplyScalar(300).add(focus);
      this.sun.target.position.copy(focus);
      this.sun.target.updateMatrixWorld();
    }
  }
}
