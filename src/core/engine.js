import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { quality } from './device.js';
import { viewSize } from '../ui/viewport.js';

/* Colour-grade + vignette + chromatic aberration + speed-radial-blur.
 * Applied after bloom, before the tonemapping OutputPass so the grade acts
 * on linear HDR values (much closer to how a film LUT behaves).
 *
 * TAPS is the radial-blur sample count and is the single most expensive knob
 * in the whole chain — each tap costs three dependent texture fetches, so a
 * phone runs 1 tap where a desktop runs 6. */
const gradeShader = (taps) => ({
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.5 },
    uAberration: { value: 0.0016 },
    uSpeed: { value: 0.0 },
    uLift: { value: new THREE.Vector3(0.012, 0.016, 0.03) },
    uGain: { value: new THREE.Vector3(1.06, 1.01, 0.96) },
    uSaturation: { value: 1.14 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    #define TAPS ${taps}
    uniform sampler2D tDiffuse;
    uniform float uVignette, uAberration, uSpeed, uSaturation, uTime;
    uniform vec3 uLift, uGain;
    varying vec2 vUv;

    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);

      // radial speed blur — subtle, only at the frame edges
      vec3 col = vec3(0.0);
      float blur = uSpeed * 0.035;
      float wsum = 0.0;
      for (int i = 0; i < TAPS; i++) {
        float t = TAPS == 1 ? 0.0 : float(i) / float(TAPS - 1);
        float scale = 1.0 - blur * t * smoothstep(0.02, 0.5, r2);
        vec2 uv = 0.5 + c * scale;
        // chromatic aberration grows toward the edges
        float ab = uAberration * (1.0 + uSpeed * 2.0) * r2 * 8.0;
        vec3 s;
        s.r = texture2D(tDiffuse, uv + c * ab).r;
        s.g = texture2D(tDiffuse, uv).g;
        s.b = texture2D(tDiffuse, uv - c * ab).b;
        float w = 1.0 - t * 0.55;
        col += s * w;
        wsum += w;
      }
      col /= wsum;

      // lift / gain colour grade
      col = col * uGain + uLift;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);

      // vignette
      float v = smoothstep(0.95, 0.22, r2 * uVignette * 2.6);
      col *= mix(0.62, 1.0, v);

      gl_FragColor = vec4(col, 1.0);
    }`,
});

export class Engine {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    this.quality = quality;

    this.renderer = new THREE.WebGLRenderer({
      canvas: canvasEl,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.maxPixelRatio = Math.min(devicePixelRatio, quality.maxPixelRatio);
    this.renderer.setPixelRatio(this.maxPixelRatio);
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, quality.far);
    this.camera.position.set(0, 6, 14);

    // EffectComposer's default buffer has no MSAA. On tile-based mobile GPUs
    // multisampling is resolved in tile memory and is dramatically cheaper
    // than a post-process AA pass, so we opt in there instead of using SMAA.
    let rt;
    if (quality.msaa) {
      rt = new THREE.WebGLRenderTarget(
        innerWidth * this.maxPixelRatio, innerHeight * this.maxPixelRatio,
        { type: THREE.HalfFloatType, samples: quality.msaa }
      );
    }
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(this.maxPixelRatio);
    this.composer.setSize(innerWidth, innerHeight);

    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    this.bloomScale = quality.bloomScale;
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(innerWidth * this.bloomScale, innerHeight * this.bloomScale),
      0.42, // strength
      0.72, // radius
      0.86  // threshold — only genuinely bright things glow
    );
    this.composer.addPass(this.bloom);

    this.grade = new ShaderPass(gradeShader(quality.gradeTaps));
    this.composer.addPass(this.grade);

    this.composer.addPass(new OutputPass());

    if (quality.smaa) {
      this.smaa = new SMAAPass();
      this.composer.addPass(this.smaa);
    }

    this._clock = new THREE.Clock();
    this._accum = 0;
    this.fixedStep = quality.fixedStep;
    this.updaters = [];
    this.frameCount = 0;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this.fps = 60;

    addEventListener('resize', () => this.resize());
    // iOS fires resize before the URL bar finishes collapsing, so re-measure
    // after the orientation animation settles.
    addEventListener('orientationchange', () => setTimeout(() => this.resize(), 300));
    this.resize();
  }

  resize() {
    // 用 visualViewport 的实测尺寸，而不是 innerWidth/innerHeight：
    // iPhone Safari 的地址栏/工具栏会占掉一部分，画布必须和**看得见**的
    // 区域一样大，否则底部会被裁掉、3D 画面和 UI 对不上。
    const { w, h } = viewSize();
    // The active camera may be the story-stage one, so update whichever
    // camera the render pass is actually using instead of only this.camera.
    const active = this.renderPass?.camera || this.camera;
    for (const cam of new Set([this.camera, active])) {
      if (cam && cam.isPerspectiveCamera) {
        cam.aspect = w / h;
        cam.updateProjectionMatrix();
      }
    }
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w * this.bloomScale, h * this.bloomScale);
  }

  /** cb(dt) is called at a fixed 120 Hz; cb2(dt) once per rendered frame. */
  add(fixedUpdate, frameUpdate) {
    this.updaters.push({ fixedUpdate, frameUpdate });
  }

  setSpeedFx(v) {
    this.grade.uniforms.uSpeed.value = v;
  }

  /**
   * 切到另一套场景/相机渲染（剧情舞台用）。
   * 比赛用的 this.scene / this.camera 完全不动，随时可以切回来 ——
   * 这是「剧情场景独立、不影响比赛」最省事也最可靠的做法。
   * 后处理链（bloom / 调色 / vignette）沿用同一套，画面风格保持一致。
   */
  useScene(scene, camera) {
    if (!this.renderPass || !scene || !camera) return false;
    this._worldCamera = this._worldCamera || this.camera;
    this._stageCamera = camera;
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    const { w, h } = viewSize();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    this.setSpeedFx(0);
    return true;
  }

  /** 切回比赛场景。 */
  useWorld() {
    if (!this.renderPass) return false;
    this.renderPass.scene = this.scene;
    this.renderPass.camera = this.camera;
    const { w, h } = viewSize();
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    return true;
  }

  get renderingStage() {
    return !!this.renderPass && this.renderPass.scene !== this.scene;
  }

  start() {
    const loop = () => {
      requestAnimationFrame(loop);
      const dt = Math.min(this._clock.getDelta(), 0.1);
      this._accum += dt;
      let steps = 0;
      while (this._accum >= this.fixedStep && steps < 8) {
        for (const u of this.updaters) u.fixedUpdate?.(this.fixedStep);
        this._accum -= this.fixedStep;
        steps++;
      }
      for (const u of this.updaters) u.frameUpdate?.(dt);
      this.grade.uniforms.uTime.value += dt;
      this.composer.render();

      this.frameCount++;
      this._fpsAccum += dt;
      this._fpsFrames++;
      if (this._fpsAccum > 0.5) {
        this.fps = this._fpsFrames / this._fpsAccum;
        this._fpsAccum = 0;
        this._fpsFrames = 0;
        this._autoQuality();
      }
    };
    requestAnimationFrame(loop);
  }

  /** Drop pixel ratio if the GPU is struggling; restore when there's headroom. */
  _autoQuality() {
    const lo = this.quality.minPixelRatio;
    const hi = this.maxPixelRatio;
    const pr = this.renderer.getPixelRatio();
    if (this.fps < 45 && pr > lo) {
      this._setPixelRatio(Math.max(lo, pr - 0.25));
    } else if (this.fps > 58 && pr < hi) {
      this._setPixelRatio(Math.min(hi, pr + 0.25));
    }
  }

  _setPixelRatio(v) {
    this.renderer.setPixelRatio(v);
    this.composer.setPixelRatio(v);
    this.resize();
  }
}
