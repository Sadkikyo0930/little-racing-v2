import * as THREE from 'three';
import { dotTexture, smokeTexture } from '../world/textures.js';

/* ------------------------------------------------------------------ *
 * Pooled point-sprite particle system.
 * Two pools — additive (sparks, flame, glow) and alpha (dust, smoke,
 * water) — each a single draw call with per-particle size/colour/fade.
 * ------------------------------------------------------------------ */

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aOpacity;
  attribute vec3 aColor;
  varying float vOpacity;
  varying vec3 vColor;
  void main() {
    vOpacity = aOpacity;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (320.0 / max(-mv.z, 0.5));
    gl_Position = projectionMatrix * mv;
  }`;

const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying float vOpacity;
  varying vec3 vColor;
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    if (t.a * vOpacity < 0.004) discard;
    gl_FragColor = vec4(vColor * t.rgb, t.a * vOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

class Pool {
  constructor(scene, count, texture, blending, depthWrite) {
    this.count = count;
    this.cursor = 0;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.size = new Float32Array(count);
    this.op = new Float32Array(count);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.grav = new Float32Array(count);
    this.drag = new Float32Array(count);
    this.grow = new Float32Array(count);

    // park unused particles far away rather than branching in the shader
    for (let i = 0; i < count; i++) this.pos[i * 3 + 1] = -9999;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aOpacity', new THREE.BufferAttribute(this.op, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geo = geo;

    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite,
      blending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  spawn(x, y, z, vx, vy, vz, color, size, life, opts = {}) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    this.size[i] = size;
    this.op[i] = opts.opacity ?? 1;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = opts.gravity ?? -9;
    this.drag[i] = opts.drag ?? 1.4;
    this.grow[i] = opts.grow ?? 0;
    return i;
  }

  update(dt) {
    const { pos, vel, life, maxLife, op, size, grav, drag, grow } = this;
    for (let i = 0; i < this.count; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) {
        op[i] = 0;
        pos[i * 3 + 1] = -9999;
        continue;
      }
      const d = Math.exp(-drag[i] * dt);
      vel[i * 3] *= d;
      vel[i * 3 + 2] *= d;
      vel[i * 3 + 1] = vel[i * 3 + 1] * d + grav[i] * dt;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      const f = life[i] / maxLife[i];
      op[i] = f * f * (3 - 2 * f); // smoothstep fade
      size[i] += grow[i] * dt;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aOpacity.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
  }
}

const _c = new THREE.Color();

export class Particles {
  constructor(scene) {
    this.additive = new Pool(scene, 2600, dotTexture(128), THREE.AdditiveBlending, false);
    this.alpha = new Pool(scene, 1800, smokeTexture(128), THREE.NormalBlending, false);
  }

  update(dt) {
    this.additive.update(dt);
    this.alpha.update(dt);
  }

  /** Drift sparks: colour escalates with the mini-turbo tier. */
  driftSparks(x, y, z, dir, tier, speed) {
    const colors = [0x66ccff, 0xff9a2a, 0xff3ad0];
    _c.setHex(colors[Math.min(2, Math.max(0, tier - 1))]);
    const n = 2 + tier;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.additive.spawn(
        x + (Math.random() - 0.5) * 0.5,
        y + 0.12 + Math.random() * 0.2,
        z + (Math.random() - 0.5) * 0.5,
        Math.cos(a) * 3.5 - dir.x * speed * 0.16,
        2.4 + Math.random() * 3.4,
        Math.sin(a) * 3.5 - dir.z * speed * 0.16,
        _c, 0.16 + Math.random() * 0.16, 0.32 + Math.random() * 0.24,
        { gravity: -14, drag: 1.4 }
      );
    }
  }

  /** Tyre smoke while sliding. */
  tireSmoke(x, y, z, amount = 1) {
    _c.setRGB(0.72, 0.7, 0.68);
    this.alpha.spawn(
      x + (Math.random() - 0.5) * 0.4, y + 0.16, z + (Math.random() - 0.5) * 0.4,
      (Math.random() - 0.5) * 1.6, 0.9 + Math.random() * 1.1, (Math.random() - 0.5) * 1.6,
      _c, 0.7 + Math.random() * 0.5, 0.7 + Math.random() * 0.5,
      { gravity: 0.6, drag: 1.9, opacity: 0.32 * amount, grow: 1.6 }
    );
  }

  /** Dust kicked up off-road. */
  dust(x, y, z, tint = 0xc9b48a) {
    _c.setHex(tint);
    this.alpha.spawn(
      x + (Math.random() - 0.5) * 0.7, y + 0.1, z + (Math.random() - 0.5) * 0.7,
      (Math.random() - 0.5) * 2.4, 1.2 + Math.random() * 1.8, (Math.random() - 0.5) * 2.4,
      _c, 0.8 + Math.random() * 0.7, 0.55 + Math.random() * 0.5,
      { gravity: -1.2, drag: 2.2, opacity: 0.42, grow: 2.0 }
    );
  }

  /** Boost flame trail from the exhausts. */
  boostFlame(x, y, z, vx, vz) {
    _c.setHSL(0.06 + Math.random() * 0.06, 1.0, 0.6);
    this.additive.spawn(
      x, y, z,
      vx * 0.2 + (Math.random() - 0.5) * 1.4,
      1.0 + Math.random() * 1.2,
      vz * 0.2 + (Math.random() - 0.5) * 1.4,
      _c, 0.45 + Math.random() * 0.4, 0.22 + Math.random() * 0.18,
      { gravity: 3.0, drag: 2.6 }
    );
    if (Math.random() > 0.65) {
      _c.setRGB(0.3, 0.3, 0.32);
      this.alpha.spawn(x, y, z, (Math.random() - 0.5) * 1.2, 1.6, (Math.random() - 0.5) * 1.2,
        _c, 0.5, 0.6, { gravity: 1.2, drag: 2, opacity: 0.2, grow: 1.4 });
    }
  }

  /** Impact burst — used for shells, bumps, item hits. */
  burst(x, y, z, color = 0xffd23f, count = 26, power = 8) {
    _c.setHex(color);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * Math.PI * 0.5;
      this.additive.spawn(
        x, y, z,
        Math.cos(a) * Math.cos(e) * power * (0.4 + Math.random()),
        Math.sin(e) * power * (0.5 + Math.random()),
        Math.sin(a) * Math.cos(e) * power * (0.4 + Math.random()),
        _c, 0.3 + Math.random() * 0.5, 0.4 + Math.random() * 0.5,
        { gravity: -12, drag: 1.1 }
      );
    }
    _c.setRGB(0.85, 0.85, 0.9);
    for (let i = 0; i < count / 2; i++) {
      const a = Math.random() * Math.PI * 2;
      this.alpha.spawn(x, y, z, Math.cos(a) * 4, 2 + Math.random() * 3, Math.sin(a) * 4,
        _c, 0.9, 0.7, { gravity: 0.4, drag: 2.4, opacity: 0.4, grow: 2.5 });
    }
  }

  /** Sparkle used for item boxes and the star. */
  sparkle(x, y, z, color = 0xffffff, spread = 1.2) {
    _c.setHex(color);
    const a = Math.random() * Math.PI * 2;
    this.additive.spawn(
      x + (Math.random() - 0.5) * spread,
      y + (Math.random() - 0.5) * spread,
      z + (Math.random() - 0.5) * spread,
      Math.cos(a) * 0.6, 0.9 + Math.random(), Math.sin(a) * 0.6,
      _c, 0.22 + Math.random() * 0.3, 0.5 + Math.random() * 0.4,
      { gravity: -0.6, drag: 1.6 }
    );
  }

  /** Sea spray along the muralla. */
  spray(x, y, z) {
    _c.setRGB(0.9, 0.96, 1.0);
    this.alpha.spawn(
      x, y, z,
      (Math.random() - 0.5) * 3, 6 + Math.random() * 6, (Math.random() - 0.5) * 3,
      _c, 1.4 + Math.random(), 1.4 + Math.random(),
      { gravity: -9, drag: 1.0, opacity: 0.5, grow: 2.2 }
    );
  }
}
