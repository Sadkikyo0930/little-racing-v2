import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { dotTexture } from '../world/textures.js';

/* ------------------------------------------------------------------ *
 * Items — Puerto Rican twists on the kart-racing canon.
 *
 *   cocoGreen   Cocotazo    a coconut fired dead straight
 *   cocoRed     Cocotazo Guiao  a coconut that tracks the kart ahead
 *   piragua     Piragua     a slick of shaved ice you spin out on
 *   cafecito    Cafecito    an espresso shot of pure acceleration
 *   triCafecito Tres Cafecitos  three of them
 *   bomba       Bomba       a drum that detonates
 *   coqui       Coquí       a shockwave horn that flips everyone nearby
 *   vejigante   Vejigante   the carnival mask: invincible and fast
 *   huracan     Huracán     shrinks the entire field
 * ------------------------------------------------------------------ */

export const ITEMS = {
  cocoGreen: { name: 'Cocotazo', icon: '🥥', color: 0x6b8e3a },
  cocoRed: { name: 'Cocotazo Guiao', icon: '🥥', color: 0xd8342c },
  piragua: { name: 'Piragua', icon: '🍧', color: 0xff5aa8 },
  cafecito: { name: 'Cafecito', icon: '☕', color: 0x6b4226 },
  triCafecito: { name: 'Tres Cafecitos', icon: '☕', color: 0x8a5a33 },
  bomba: { name: 'Bomba', icon: '🥁', color: 0x2a2e35 },
  coqui: { name: 'Coquí', icon: '🐸', color: 0x2fbf6a },
  vejigante: { name: 'Vejigante', icon: '🎭', color: 0xff7a1a },
  huracan: { name: 'Huracán', icon: '🌀', color: 0x7fd4ff },
};

/** Rank-weighted roulette, front-runners get scraps. */
const TABLES = [
  // rank 1
  { cocoGreen: 34, piragua: 34, cafecito: 18, cocoRed: 8, bomba: 6 },
  { cocoGreen: 26, piragua: 24, cafecito: 22, cocoRed: 16, bomba: 12 },
  { cocoGreen: 18, piragua: 16, cafecito: 22, cocoRed: 20, bomba: 14, coqui: 10 },
  { cocoGreen: 12, piragua: 10, cafecito: 20, cocoRed: 20, bomba: 14, coqui: 12, triCafecito: 12 },
  { cafecito: 14, cocoRed: 18, bomba: 12, coqui: 14, triCafecito: 22, vejigante: 12, huracan: 8 },
  { cocoRed: 14, bomba: 10, coqui: 12, triCafecito: 24, vejigante: 22, huracan: 18 },
];

function roll(rank, total) {
  const t = THREE.MathUtils.clamp(
    Math.floor(((rank - 1) / Math.max(1, total - 1)) * (TABLES.length - 1) + 0.001),
    0, TABLES.length - 1
  );
  const table = TABLES[t];
  let sum = 0;
  for (const k in table) sum += table[k];
  let r = Math.random() * sum;
  for (const k in table) {
    r -= table[k];
    if (r <= 0) return k;
  }
  return 'cocoGreen';
}

/* ---------------------------- item boxes ---------------------------- */
const BOX_VERT = /* glsl */ `
  varying vec3 vN; varying vec3 vP; varying vec2 vUv;
  void main() {
    vUv = uv;
    #ifdef USE_INSTANCING
      vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * (mat3(instanceMatrix) * normal));
    #else
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
    #endif
    vP = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }`;

const BOX_FRAG = /* glsl */ `
  uniform float uTime;
  varying vec3 vN; varying vec3 vP; varying vec2 vUv;
  vec3 hue(float h) {
    return 0.42 + 0.58 * cos(6.28318 * (h + vec3(0.0, 0.33, 0.67)));
  }
  void main() {
    vec3 V = normalize(-vP);
    float fres = pow(1.0 - max(dot(normalize(vN), V), 0.0), 2.4);
    vec3 col = hue(uTime * 0.22 + vUv.x * 0.35 + vUv.y * 0.2);
    col = mix(col * 0.9, vec3(1.0), fres * 0.45);
    // the drifting question-mark shimmer
    float band = smoothstep(0.42, 0.5, abs(fract(vUv.y * 3.0 - uTime * 0.7) - 0.5));
    col += vec3(1.0, 0.95, 0.7) * band * 0.22;
    gl_FragColor = vec4(col, 0.72 + fres * 0.28);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const GLOW_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    // Billboard: take the instance origin in view space, then offset by the
    // quad corner. The instance matrix carries only a uniform scale, which
    // doubles as the hide flag (scale 0 collapses the quad).
    vec3 c = (modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float s = length(instanceMatrix[0].xyz);
    gl_Position = projectionMatrix * vec4(c + vec3(position.xy * s, 0.0), 1.0);
  }`;

const GLOW_FRAG = /* glsl */ `
  uniform sampler2D uMap; uniform vec3 uColor; uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    gl_FragColor = vec4(uColor, 1.0) * texture2D(uMap, vUv) * uOpacity;
  }`;

/** Pure state — the boxes are drawn by ItemBoxField, not by themselves. */
class ItemBox {
  constructor(position) {
    this.position = position.clone();
    this.active = true;
    this.respawn = 0;
    this.spin = Math.random() * 6.28;
  }
}

/* Forty-five boxes used to be 135 separate objects — 135 draw calls, one of
 * the largest single line items in the frame. They are identical, so they
 * collapse into three InstancedMeshes. */
class ItemBoxField {
  constructor(scene, boxes) {
    this.scene = scene;
    this.boxes = boxes;
    const n = boxes.length;

    this.boxMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: BOX_VERT,
      fragmentShader: BOX_FRAG,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.shell = new THREE.InstancedMesh(
      new RoundedBoxGeometry(2.0, 2.0, 2.0, 5, 0.34), this.boxMat, n);

    this.coreMat = new THREE.MeshBasicMaterial({ color: 0xffcc63, transparent: true, opacity: 0.6 });
    this.core = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.5, 0), this.coreMat, n);

    this.glowMat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: dotTexture(128) },
        uColor: { value: new THREE.Color(0xffe9a8) },
        uOpacity: { value: 0.14 },
      },
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.glow = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.6, 2.6), this.glowMat, n);

    this.meshes = [this.shell, this.core, this.glow];
    for (const m of this.meshes) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Instances span the whole lap, so the shared bounds are useless.
      m.frustumCulled = false;
      scene.add(m);
    }

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._zero = new THREE.Vector3(0, 0, 0);
  }

  update(dt, t) {
    this.boxMat.uniforms.uTime.value = t;
    this.glowMat.uniforms.uOpacity.value = 0.12 + Math.sin(t * 4) * 0.04;

    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (!b.active) {
        b.respawn -= dt;
        if (b.respawn <= 0) b.active = true;
      }
      if (!b.active) {
        this._m.makeScale(0, 0, 0);
        for (const m of this.meshes) m.setMatrixAt(i, this._m);
        continue;
      }
      b.spin += dt * 1.2;
      const bob = Math.sin(t * 2.0 + b.position.x) * 0.16;
      this._p.set(b.position.x, b.position.y + bob, b.position.z);
      this._s.set(1, 1, 1);

      this._e.set(b.spin * 0.6, b.spin, b.spin * 0.35);
      this._q.setFromEuler(this._e);
      this.shell.setMatrixAt(i, this._m.compose(this._p, this._q, this._s));

      this._e.set(-b.spin, b.spin * 1.7, 0);
      this._q.setFromEuler(this._e);
      this.core.setMatrixAt(i, this._m.compose(this._p, this._q, this._s));

      this._q.identity();
      this.glow.setMatrixAt(i, this._m.compose(this._p, this._q, this._s));
    }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const m of this.meshes) {
      this.scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
      m.dispose();
    }
    this.glowMat.uniforms.uMap.value?.dispose?.();
  }
}

/* ---------------------------- projectiles --------------------------- */
class Projectile {
  constructor(sys, kind, owner, dir) {
    this.sys = sys;
    this.kind = kind;
    this.owner = owner;
    this.life = kind === 'bomba' ? 3.2 : 9.0;
    this.dead = false;
    this.position = owner.position.clone().add(new THREE.Vector3(0, 0.6, 0));
    const f = owner.forward;
    const launch = dir < 0 ? -1 : 1;
    this.position.add(f.clone().multiplyScalar(2.2 * launch));
    this.speed = (kind === 'bomba' ? 22 : 38) * launch;
    this.yaw = owner.yaw;
    this.trackIndex = owner.trackIndex;
    this.bounces = 0;
    this.armed = 0.12;

    const mesh = makeProjectileMesh(kind);
    mesh.position.copy(this.position);
    sys.scene.add(mesh);
    this.mesh = mesh;
  }

  update(dt, sys) {
    this.life -= dt;
    this.armed = Math.max(0, this.armed - dt);
    if (this.life <= 0) return this.explode(this.kind === 'bomba');

    const track = sys.track;

    if (this.kind === 'cocoRed') {
      // steer toward the racer immediately ahead of the owner
      const target = sys.targetAhead(this.owner);
      this.target = target;
      if (target) {
        const to = target.position.clone().sub(this.position);
        const want = Math.atan2(to.x, to.z);
        let d = want - this.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        this.yaw += THREE.MathUtils.clamp(d, -3.2 * dt, 3.2 * dt);
      } else {
        this._followTrack(dt, track, 4.5);
      }
    } else {
      // green shells and bombs follow the road, ricocheting off the walls
      this._followTrack(dt, track, 1.4);
    }

    const f = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.position.addScaledVector(f, this.speed * dt);

    const surf = track.surfaceAt(this.position, this.trackIndex);
    this.trackIndex = surf.loc.index;
    this.position.y = surf.y + 0.55;

    // wall bounce
    const limit = track.clearance
      ? track.clearance.limitAt(surf.loc.index, surf.loc.lat) + 0.5
      : surf.loc.width + 2.2;
    if (Math.abs(surf.loc.lat) > limit) {
      const sign = Math.sign(surf.loc.lat);
      this.position.add(track.getRight(surf.loc.index).multiplyScalar(-sign * (Math.abs(surf.loc.lat) - limit + 0.2)));
      const tan = track.getTangent(surf.loc.index);
      const tanYaw = Math.atan2(tan.x, tan.z);
      this.yaw = 2 * tanYaw - this.yaw + Math.PI;
      this.bounces++;
      sys.particles.burst(this.position.x, this.position.y, this.position.z, 0xfff0c0, 8, 4);
      if (this.bounces > 4) return this.explode(this.kind === 'bomba');
    }

    this.mesh.position.copy(this.position);
    this.mesh.rotation.x -= dt * 9;
    this.mesh.rotation.y = this.yaw;

    // collisions
    for (const k of sys.karts) {
      if (k === this.owner && this.armed > 0) continue;
      if (k.finished) continue;
      if (this.position.distanceTo(k.position) < 1.7) {
        if (this.kind === 'bomba') return this.explode(true);
        if (sys.hit(k, 'spin')) {
          sys.particles.burst(k.position.x, k.position.y + 0.7, k.position.z, ITEMS[this.kind].color, 30, 9);
          sys.onEvent?.('hit', k);
        }
        return this.explode(false);
      }
    }
    // knock out hazards it rolls over
    for (const h of sys.hazards) {
      if (!h.dead && this.position.distanceTo(h.position) < 1.5) h.pop(sys);
    }
  }

  _followTrack(dt, track, rate) {
    // aim a little way down the road, biased back toward the centre line
    const look = Math.max(6, Math.abs(this.speed) * 0.45);
    const loc = track.locate(this.position, this.trackIndex);
    const ahead = loc.index + Math.sign(this.speed) * Math.round(look / (track.length / track.n));
    const goal = track.pointAt(ahead, loc.lat * 0.35, new THREE.Vector3());
    const to = goal.sub(this.position);
    let d = Math.atan2(to.x, to.z) - this.yaw;
    if (this.speed < 0) d += Math.PI;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += THREE.MathUtils.clamp(d, -rate * dt, rate * dt);
  }

  explode(big) {
    if (this.dead) return;
    this.dead = true;
    const sys = this.sys;
    const p = this.position;
    if (big) {
      sys.particles.burst(p.x, p.y + 0.4, p.z, 0xff9a2a, 90, 20);
      sys.particles.burst(p.x, p.y + 0.4, p.z, 0xffe066, 50, 12);
      sys.shockwave(p, 7.5);
      for (const k of sys.karts) {
        const d = k.position.distanceTo(p);
        if (d < 7.5 && sys.hit(k, 'spin')) sys.onEvent?.('hit', k);
      }
      sys.onEvent?.('explode', p);
    } else {
      sys.particles.burst(p.x, p.y + 0.3, p.z, ITEMS[this.kind].color, 24, 8);
    }
    sys.scene.remove(this.mesh);
    disposeDeep(this.mesh);
  }
}

/* ------------------------------ hazards ----------------------------- */
class Hazard {
  constructor(sys, kind, position) {
    this.kind = kind;
    this.position = position.clone();
    this.life = 26;
    this.dead = false;
    this.armed = 0.9;
    const mesh = makeHazardMesh(kind);
    mesh.position.copy(this.position);
    sys.scene.add(mesh);
    this.mesh = mesh;
  }

  update(dt, sys) {
    this.life -= dt;
    this.armed = Math.max(0, this.armed - dt);
    this.mesh.rotation.y += dt * 0.6;
    const s = 1 + Math.sin(sys.time * 3 + this.position.x) * 0.05;
    this.mesh.scale.set(s, 1, s);
    if (this.life <= 0) return this.pop(sys);
    if (this.armed > 0) return;
    for (const k of sys.karts) {
      if (k.finished) continue;
      if (k.position.distanceTo(this.position) < 1.9) {
        if (sys.hit(k, 'slip')) {
          sys.particles.burst(k.position.x, k.position.y + 0.3, k.position.z, 0xff8ac0, 22, 6);
          sys.onEvent?.('slip', k);
        }
        return this.pop(sys);
      }
    }
  }

  pop(sys) {
    if (this.dead) return;
    this.dead = true;
    sys.particles.burst(this.position.x, this.position.y + 0.2, this.position.z, 0xffc0e0, 16, 5);
    sys.scene.remove(this.mesh);
    disposeDeep(this.mesh);
  }
}

/* ----------------------------- factories ---------------------------- */
function makeProjectileMesh(kind) {
  const g = new THREE.Group();
  if (kind === 'bomba') {
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.46, 0.42, 0.62, 18),
      new THREE.MeshStandardMaterial({ color: 0x8a4a22, roughness: 0.7 })
    );
    g.add(body);
    for (const y of [0.3, -0.3]) {
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(0.46, 0.05, 8, 20),
        new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.5 })
      );
      rim.rotation.x = Math.PI / 2;
      rim.position.y = y;
      g.add(rim);
    }
    const spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd070 })
    );
    spark.position.set(0, 0.46, 0);
    g.add(spark);
    g.userData.spark = spark;
  } else {
    const shellColor = kind === 'cocoRed' ? 0x8b2b20 : 0x5f7a2e;
    const husk = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.52, 1),
      new THREE.MeshStandardMaterial({ color: shellColor, roughness: 0.82, flatShading: true })
    );
    husk.scale.set(1, 0.92, 1.06);
    g.add(husk);
    // the three coconut eyes
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0x1e1208, roughness: 0.9 })
      );
      eye.position.set(Math.cos(a) * 0.22, 0.45, Math.sin(a) * 0.22);
      g.add(eye);
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: dotTexture(128), color: kind === 'cocoRed' ? 0xff5a3a : 0x9fe06a,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5,
    }));
    glow.scale.setScalar(2.4);
    g.add(glow);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function makeHazardMesh(kind) {
  const g = new THREE.Group();
  // a paper cone of shaved ice, tipped over into a slick
  const slick = new THREE.Mesh(
    new THREE.CircleGeometry(1.6, 22),
    new THREE.MeshPhysicalMaterial({
      color: 0xff7ac0, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.72,
      transmission: 0.4, thickness: 0.2, envMapIntensity: 2.0,
    })
  );
  slick.rotation.x = -Math.PI / 2;
  slick.position.y = 0.06;
  g.add(slick);
  const ice = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 14, 10),
    new THREE.MeshStandardMaterial({ color: 0xffd6ea, roughness: 0.35 })
  );
  ice.scale.y = 0.7;
  ice.position.y = 0.34;
  g.add(ice);
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.42, 0.7, 14),
    new THREE.MeshStandardMaterial({ color: 0xf5f0e2, roughness: 0.8 })
  );
  cone.rotation.z = 2.2;
  cone.position.set(0.5, 0.2, 0);
  g.add(cone);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function disposeDeep(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material.dispose();
    }
  });
}

/* --------------------------- item system ---------------------------- */
export class ItemSystem {
  constructor(scene, track, karts, particles) {
    this.scene = scene;
    this.track = track;
    this.karts = karts;
    this.particles = particles;
    this.boxes = [];
    this.projectiles = [];
    this.hazards = [];
    this.shockwaves = [];
    this.time = 0;
    this.onEvent = null;

    this._placeBoxes();
  }

  _placeBoxes() {
    const t = this.track;
    // eight rows of boxes spread around the lap
    const rows = 9;
    for (let r = 0; r < rows; r++) {
      const i = Math.floor(((r + 0.5) / rows) * t.n);
      const w = t.width[i];
      const lanes = 5;
      for (let l = 0; l < lanes; l++) {
        const lat = ((l + 0.5) / lanes * 2 - 1) * w * 0.7;
        const p = t.pointAt(i, lat, new THREE.Vector3());
        p.y += 1.5;
        this.boxes.push(new ItemBox(p));
      }
    }
    this.boxField = new ItemBoxField(this.scene, this.boxes);
  }

  targetAhead(owner) {
    let best = null;
    let bestGap = Infinity;
    for (const k of this.karts) {
      if (k === owner || k.finished) continue;
      if (k.rank < owner.rank) {
        const gap = owner.rank - k.rank;
        if (gap < bestGap) { bestGap = gap; best = k; }
      }
    }
    return best;
  }

  hit(kart, type) {
    if (kart.starTime > 0 || kart.invulnTime > 0) return false;
    if (type === 'spin') return kart.spinOut(1.5);
    if (type === 'slip') return kart.slip(1.2);
    if (type === 'squash') return kart.squash(2.2);
    return false;
  }

  shockwave(position, radius) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 0.55, 48),
      new THREE.MeshBasicMaterial({
        color: 0xfff0b0, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
      })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(position).add(new THREE.Vector3(0, 0.4, 0));
    this.scene.add(mesh);
    this.shockwaves.push({ mesh, t: 0, radius });
  }

  /** Give a kart a fresh item, weighted by its position in the field. */
  grant(kart) {
    if (kart.item || kart.itemRolling > 0) return;
    kart.itemRolling = kart.isPlayer ? 0.85 : 0.15;
    kart.pendingItem = roll(kart.rank, this.karts.length);
  }

  /** Use whatever the kart is holding. `dir` -1 fires backwards. */
  use(kart, dir = 1) {
    const item = kart.item;
    if (!item) return;

    switch (item) {
      case 'cocoGreen':
      case 'cocoRed':
        this.projectiles.push(new Projectile(this, item, kart, dir));
        break;
      case 'bomba':
        this.projectiles.push(new Projectile(this, 'bomba', kart, dir));
        break;
      case 'piragua': {
        const back = kart.forward.multiplyScalar(-2.6);
        const p = kart.position.clone().add(back);
        this.hazards.push(new Hazard(this, 'piragua', p));
        break;
      }
      case 'cafecito':
        kart.applyBoost(12.0, 1.6);
        this.onEvent?.('boost', kart);
        break;
      case 'triCafecito':
        kart.applyBoost(12.0, 1.6);
        this.onEvent?.('boost', kart);
        break;
      case 'coqui': {
        this.shockwave(kart.position, 13);
        this.onEvent?.('horn', kart);
        for (const k of this.karts) {
          if (k === kart) continue;
          if (k.position.distanceTo(kart.position) < 13) {
            if (this.hit(k, 'spin')) this.onEvent?.('hit', k);
          }
        }
        // the coquí also swats away nearby projectiles
        for (const pr of this.projectiles) {
          if (pr.position.distanceTo(kart.position) < 13) pr.explode(false);
        }
        break;
      }
      case 'vejigante':
        kart.starTime = 8.0;
        kart.invulnTime = 8.0;
        kart.applyBoost(6.5, 8.0);
        this.onEvent?.('star', kart);
        break;
      case 'huracan':
        for (const k of this.karts) {
          if (k === kart) continue;
          if (k.starTime > 0) continue;
          k.squash(3.0);
          this.onEvent?.('hit', k);
        }
        this.onEvent?.('huracan', kart);
        break;
    }

    // triple items keep two more charges in reserve
    if ((kart.itemCharges ?? 0) > 0) {
      kart.itemCharges--;
    } else {
      kart.item = null;
      kart.itemCharges = 0;
    }
  }

  dispose() {
    this.boxField?.dispose();
    this.boxField = null;
    for (const p of this.projectiles) { this.scene.remove(p.mesh); disposeDeep(p.mesh); }
    for (const h of this.hazards) { this.scene.remove(h.mesh); disposeDeep(h.mesh); }
    for (const s of this.shockwaves) { this.scene.remove(s.mesh); disposeDeep(s.mesh); }
    this.boxes.length = this.projectiles.length = this.hazards.length = this.shockwaves.length = 0;
  }

  update(dt) {
    this.time += dt;

    this.boxField?.update(dt, this.time);
    for (const b of this.boxes) {
      if (!b.active) continue;
      if (Math.random() < dt * 6) {
        this.particles.sparkle(b.position.x, b.position.y, b.position.z, 0xfff0b0, 2.2);
      }
      for (const k of this.karts) {
        if (k.finished) continue;
        const d = k.position.distanceTo(b.position);
        if (d < 2.2) {
          b.active = false;
          b.respawn = 4.0;
          this.particles.burst(b.position.x, b.position.y, b.position.z, 0xffe08a, 22, 7);
          this.grant(k);
          this.onEvent?.('pickup', k);
          break;
        }
      }
    }

    // item roulette resolution
    for (const k of this.karts) {
      if (k.itemRolling > 0) {
        k.itemRolling -= dt;
        if (k.itemRolling <= 0) {
          k.item = k.pendingItem;
          k.itemCharges = k.item === 'triCafecito' ? 2 : 0;
          k.pendingItem = null;
          if (k.isPlayer) this.onEvent?.('itemReady', k);
        }
      }
    }

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.update(dt, this);
      if (p.dead) this.projectiles.splice(i, 1);
      else if (p.mesh.userData.spark) {
        p.mesh.userData.spark.scale.setScalar(0.7 + Math.random() * 0.6);
        this.particles.sparkle(p.position.x, p.position.y + 0.5, p.position.z, 0xffb040, 0.3);
      }
    }

    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.update(dt, this);
      if (h.dead) this.hazards.splice(i, 1);
    }

    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.t += dt;
      const f = s.t / 0.55;
      s.mesh.scale.setScalar(1 + f * s.radius);
      s.mesh.material.opacity = Math.max(0, 0.9 * (1 - f));
      if (f >= 1) {
        this.scene.remove(s.mesh);
        disposeDeep(s.mesh);
        this.shockwaves.splice(i, 1);
      }
    }
  }
}

export { roll as rollItem };
