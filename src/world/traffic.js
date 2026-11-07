import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { quality } from '../core/device.js';

/* ------------------------------------------------------------------ *
 * Civilian traffic.
 *
 * The expressway loop is a single spline that runs out along one
 * carriageway and back along the other, so traffic only ever has to
 * drive *forwards* along it. On your side of the median that reads as
 * same-direction traffic you overtake; across the median the very same
 * vehicles read as oncoming, because they are physically pointing the
 * other way. No special cases anywhere.
 *
 * Everything is drawn with InstancedMesh — one draw call per
 * (body style x material), so a full motorway costs ~20 calls.
 * ------------------------------------------------------------------ */

/** Paint colours seen on a San Juan expressway: lots of white and silver. */
const PAINT = [
  0xe8e9ec, 0xd7d9dd, 0xb6bcc4, 0x8f959d, 0x2b2f36, 0x151a20,
  0x9c1f24, 0xc4443a, 0x1f4f8f, 0x2e6da4, 0x1d6b43,
  0x2f7a52, 0xd8a12a, 0x6d4a8f,
];

const GLASS = 0x1a2530;
const TYRE = 0x14161a;
const TRIM = 0x30343b;

/* --------------------------- part builder -------------------------- */

/**
 * Small helper that accumulates geometry per material key. Vehicles are
 * modelled nose-first along +Z so an instance matrix can be built
 * straight from the track's (right, up, tangent) basis.
 */
class Body {
  constructor() { this.parts = new Map(); }

  add(key, geo, pos, rot = null, scale = null) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    if (rot) q.setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
    m.compose(
      new THREE.Vector3(pos[0], pos[1], pos[2]),
      q,
      new THREE.Vector3(scale ? scale[0] : 1, scale ? scale[1] : 1, scale ? scale[2] : 1)
    );
    const g = geo.clone().applyMatrix4(m);
    // mergeGeometries silently returns null on mixed indexed/non-indexed
    // input, and RoundedBoxGeometry is the odd one out.
    if (!g.getIndex()) {
      const count = g.getAttribute('position').count;
      const arr = count > 65535 ? new Uint32Array(count) : new Uint16Array(count);
      for (let i = 0; i < count; i++) arr[i] = i;
      g.setIndex(new THREE.BufferAttribute(arr, 1));
    }
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    }
    if (!g.getAttribute('uv')) {
      const count = g.getAttribute('position').count;
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
    }
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(g);
    return this;
  }

  /** Merge each material's parts into one geometry. */
  finish() {
    const out = new Map();
    for (const [key, geos] of this.parts) {
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (geos.length > 1) for (const g of geos) g.dispose();
      if (merged) { merged.computeBoundingSphere(); out.set(key, merged); }
    }
    this.parts.clear();
    return out;
  }
}

const box = (w, h, d, r = 0.08) =>
  new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.05, h / 2.05, d / 2.05));

/** Wheel: a cylinder laid on its side, plus a paler hub face. */
function wheels(b, positions, radius, width) {
  const tyre = new THREE.CylinderGeometry(radius, radius, width, 14, 1);
  const hub = new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width * 1.04, 10, 1);
  for (const [x, y, z] of positions) {
    b.add('tyre', tyre, [x, y, z], [0, 0, Math.PI / 2]);
    b.add('chrome', hub, [x, y, z], [0, 0, Math.PI / 2]);
  }
  tyre.dispose(); hub.dispose();
}

/* ---------------------------- archetypes --------------------------- */

function sedan() {
  const b = new Body();
  const L = 4.6, W = 1.86;
  b.add('paint', box(W, 0.78, L, 0.24), [0, 0.72, 0]);
  b.add('paint', box(W * 0.97, 0.30, L * 0.62, 0.16), [0, 1.06, -0.1]);
  // greenhouse: all glass, with a painted roof cap on top
  b.add('glass', box(W * 0.9, 0.62, 2.42, 0.18), [0, 1.34, -0.18]);
  b.add('paint', box(W * 0.84, 0.16, 2.16, 0.07), [0, 1.62, -0.2]);
  b.add('trim', box(W * 1.01, 0.22, 0.24, 0.07), [0, 0.56, L / 2 - 0.06]);
  b.add('trim', box(W * 1.01, 0.22, 0.22, 0.07), [0, 0.56, -L / 2 + 0.06]);
  b.add('head', box(0.42, 0.16, 0.1, 0.04), [-0.62, 0.86, L / 2 - 0.02]);
  b.add('head', box(0.42, 0.16, 0.1, 0.04), [0.62, 0.86, L / 2 - 0.02]);
  b.add('tail', box(0.5, 0.18, 0.1, 0.04), [-0.6, 0.9, -L / 2 + 0.02]);
  b.add('tail', box(0.5, 0.18, 0.1, 0.04), [0.6, 0.9, -L / 2 + 0.02]);
  wheels(b, [
    [-W / 2 + 0.06, 0.36, 1.42], [W / 2 - 0.06, 0.36, 1.42],
    [-W / 2 + 0.06, 0.36, -1.38], [W / 2 - 0.06, 0.36, -1.38],
  ], 0.36, 0.26);
  return { geos: b.finish(), length: L, width: W, height: 1.7 };
}

function suv() {
  const b = new Body();
  const L = 5.0, W = 2.0;
  b.add('paint', box(W, 1.0, L, 0.22), [0, 0.92, 0]);
  b.add('glass', box(W * 0.92, 0.68, 3.0, 0.16), [0, 1.62, -0.16]);
  b.add('paint', box(W * 0.9, 0.18, 2.9, 0.08), [0, 1.94, -0.18]);
  // roof rails
  b.add('trim', box(0.07, 0.07, 2.5, 0.03), [-W * 0.33, 2.06, -0.2]);
  b.add('trim', box(0.07, 0.07, 2.5, 0.03), [W * 0.33, 2.06, -0.2]);
  b.add('trim', box(W * 1.01, 0.3, 0.26, 0.08), [0, 0.6, L / 2 - 0.06]);
  b.add('trim', box(W * 1.01, 0.3, 0.24, 0.08), [0, 0.6, -L / 2 + 0.06]);
  b.add('head', box(0.46, 0.2, 0.1, 0.04), [-0.66, 1.12, L / 2 - 0.02]);
  b.add('head', box(0.46, 0.2, 0.1, 0.04), [0.66, 1.12, L / 2 - 0.02]);
  b.add('tail', box(0.22, 0.6, 0.1, 0.04), [-W / 2 + 0.24, 1.28, -L / 2 + 0.02]);
  b.add('tail', box(0.22, 0.6, 0.1, 0.04), [W / 2 - 0.24, 1.28, -L / 2 + 0.02]);
  wheels(b, [
    [-W / 2 + 0.05, 0.44, 1.56], [W / 2 - 0.05, 0.44, 1.56],
    [-W / 2 + 0.05, 0.44, -1.52], [W / 2 - 0.05, 0.44, -1.52],
  ], 0.44, 0.3);
  return { geos: b.finish(), length: L, width: W, height: 2.15 };
}

/** Panel van — the delivery workhorse, with a big blank flank. */
function van() {
  const b = new Body();
  const L = 5.9, W = 2.1;
  b.add('paint', box(W, 2.0, L * 0.66, 0.14), [0, 1.42, -0.9]);
  b.add('paint', box(W * 0.98, 1.1, L * 0.36, 0.26), [0, 1.0, 1.62]);
  b.add('glass', box(W * 0.9, 0.6, 0.5, 0.12), [0, 1.7, 1.44]);
  b.add('glass', box(W * 0.92, 0.52, 0.12, 0.06), [0, 1.66, L / 2 - 0.06]);
  b.add('trim', box(W * 1.01, 0.32, 0.26, 0.08), [0, 0.62, L / 2 - 0.08]);
  b.add('trim', box(W * 1.01, 0.3, 0.22, 0.08), [0, 0.62, -L / 2 + 0.06]);
  b.add('head', box(0.42, 0.2, 0.1, 0.04), [-0.68, 1.0, L / 2 - 0.02]);
  b.add('head', box(0.42, 0.2, 0.1, 0.04), [0.68, 1.0, L / 2 - 0.02]);
  b.add('tail', box(0.2, 0.7, 0.1, 0.04), [-W / 2 + 0.2, 1.1, -L / 2 + 0.02]);
  b.add('tail', box(0.2, 0.7, 0.1, 0.04), [W / 2 - 0.2, 1.1, -L / 2 + 0.02]);
  wheels(b, [
    [-W / 2 + 0.05, 0.44, 1.7], [W / 2 - 0.05, 0.44, 1.7],
    [-W / 2 + 0.05, 0.44, -1.7], [W / 2 - 0.05, 0.44, -1.7],
  ], 0.44, 0.3);
  return { geos: b.finish(), length: L, width: W, height: 2.5 };
}

/** La guagua — an AMA transit bus. Fixed livery, so it skips instanceColor. */
function guagua() {
  const b = new Body();
  const L = 11.4, W = 2.55;
  b.add('bus', box(W, 1.5, L, 0.26), [0, 1.05, 0]);
  b.add('busTop', box(W * 0.995, 1.15, L * 0.995, 0.24), [0, 2.36, 0]);
  b.add('glass', box(W * 1.002, 0.86, L * 0.86, 0.1), [0, 2.06, -0.3]);
  b.add('glass', box(W * 0.92, 1.16, 0.12, 0.06), [0, 2.16, L / 2 - 0.04]);
  b.add('glass', box(W * 0.92, 0.9, 0.12, 0.06), [0, 2.16, -L / 2 + 0.04]);
  // destination blind and roof hatches
  b.add('sign', box(1.5, 0.3, 0.08, 0.03), [0, 2.86, L / 2 - 0.02]);
  b.add('trim', box(1.0, 0.14, 1.0, 0.05), [0, 3.02, 2.4]);
  b.add('trim', box(1.0, 0.14, 1.0, 0.05), [0, 3.02, -2.6]);
  b.add('trim', box(W * 1.01, 0.34, 0.26, 0.08), [0, 0.5, L / 2 - 0.08]);
  b.add('trim', box(W * 1.01, 0.34, 0.24, 0.08), [0, 0.5, -L / 2 + 0.06]);
  b.add('head', box(0.44, 0.22, 0.1, 0.04), [-0.86, 0.86, L / 2 - 0.02]);
  b.add('head', box(0.44, 0.22, 0.1, 0.04), [0.86, 0.86, L / 2 - 0.02]);
  b.add('tail', box(0.26, 0.8, 0.1, 0.04), [-W / 2 + 0.26, 1.1, -L / 2 + 0.02]);
  b.add('tail', box(0.26, 0.8, 0.1, 0.04), [W / 2 - 0.26, 1.1, -L / 2 + 0.02]);
  wheels(b, [
    [-W / 2 + 0.04, 0.52, 4.1], [W / 2 - 0.04, 0.52, 4.1],
    [-W / 2 + 0.04, 0.52, -3.2], [W / 2 - 0.04, 0.52, -3.2],
    [-W / 2 + 0.04, 0.52, -4.5], [W / 2 - 0.04, 0.52, -4.5],
  ], 0.52, 0.32);
  return { geos: b.finish(), length: L, width: W, height: 3.1, fixedPaint: true };
}

/* ------------------------------ system ----------------------------- */

export class Traffic {
  /**
   * @param {Track}  track
   * @param {THREE.Scene} scene
   * @param {number} count  how many vehicles to put on the road
   */
  constructor(track, scene, count = 30) {
    this.track = track;
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'traffic';
    this.segLen = track.length / track.n;

    const n = Math.max(0, Math.round(count * (quality.trafficScale ?? 1)));

    // scratch — allocated before the fleet, because seeding lays the first
    // frame of instance matrices out immediately
    this._p = new THREE.Vector3();
    this._r = new THREE.Vector3();
    this._u = new THREE.Vector3();
    this._t = new THREE.Vector3();
    this._bx = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._basis = new THREE.Matrix4();

    this.materials = this._materials();
    this._buildFleet(n);
    scene.add(this.group);
  }

  _materials() {
    const std = (o) => new THREE.MeshStandardMaterial(o);
    return {
      paint: std({ color: 0xffffff, roughness: 0.3, metalness: 0.42, envMapIntensity: 1.15 }),
      bus: std({ color: 0xf2f4f6, roughness: 0.42, metalness: 0.2, envMapIntensity: 0.9 }),
      busTop: std({ color: 0x1c5aa8, roughness: 0.4, metalness: 0.2, envMapIntensity: 0.9 }),
      glass: std({ color: GLASS, roughness: 0.09, metalness: 0.6, envMapIntensity: 1.9 }),
      trim: std({ color: TRIM, roughness: 0.62, metalness: 0.35, envMapIntensity: 0.7 }),
      tyre: std({ color: TYRE, roughness: 0.94, metalness: 0.0, envMapIntensity: 0.25 }),
      chrome: std({ color: 0xb9bec6, roughness: 0.24, metalness: 0.9, envMapIntensity: 1.6 }),
      sign: std({ color: 0x1b2026, roughness: 0.6, emissive: 0xd8a83a, emissiveIntensity: 0.5 }),
      head: std({ color: 0xf6f1e2, roughness: 0.2, emissive: 0xfff3d6, emissiveIntensity: 1.4 }),
      tail: std({ color: 0x5a0d0d, roughness: 0.3, emissive: 0xff1d10, emissiveIntensity: 1.6 }),
    };
  }

  _buildFleet(total) {
    // Mix: mostly cars, a scattering of the big stuff.
    const mix = [
      { make: sedan, share: 0.42 },
      { make: suv, share: 0.30 },
      { make: van, share: 0.18 },
      { make: guagua, share: 0.10 },
    ];
    this.vehicles = [];
    this.meshes = [];
    this.styles = [];

    let assigned = 0;
    mix.forEach((entry, si) => {
      const count = si === mix.length - 1
        ? Math.max(0, total - assigned)
        : Math.round(total * entry.share);
      assigned += count;
      if (count <= 0) return;

      const proto = entry.make();
      const style = { ...proto, index: si, count, matrices: [] };
      this.styles.push(style);

      for (const [key, geo] of proto.geos) {
        const mat = this.materials[key];
        const im = new THREE.InstancedMesh(geo, mat, count);
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.castShadow = key !== 'tyre';
        im.receiveShadow = false;
        // Bodywork gets per-vehicle paint; everything else is shared.
        if (key === 'paint') {
          im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
        }
        // Vehicles are spread over kilometres of road, so a bounding sphere
        // around the prototype would cull them all the instant the camera
        // looked away from the origin.
        im.frustumCulled = false;
        this.group.add(im);
        this.meshes.push({ mesh: im, style: si, key });
      }
    });

    this._seed(total);
  }

  /** Lay the fleet out around the loop, spaced and lane-assigned. */
  _seed(total) {
    const track = this.track;
    const L = track.length;
    // Traffic keeps right; the left of the carriageway stays open so the
    // player always has somewhere to go.
    const LANES = [0.74, 0.46, 0.16];
    const perStyle = this.styles.map(() => 0);
    const rnd = mulberry32(0x5a4d21);

    let placed = 0;
    for (const style of this.styles) {
      for (let k = 0; k < style.count; k++) {
        const s = (placed + rnd() * 0.6) * (L / Math.max(1, total));
        const lane = LANES[(placed + (rnd() * 3 | 0)) % LANES.length];
        const paint = PAINT[(rnd() * PAINT.length) | 0];
        this.vehicles.push({
          style: style.index,
          slot: perStyle[style.index]++,
          s: s % L,
          lane,
          lat: 0,
          targetLane: lane,
          // heavier things cruise slower
          speed: style.length > 8 ? 18 + rnd() * 3 : 21 + rnd() * 6,
          cruise: 0,
          nextThink: rnd() * 9,
          paint,
        });
        placed++;
      }
    }
    for (const v of this.vehicles) v.cruise = v.speed;

    // colour the bodywork once
    const c = new THREE.Color();
    for (const v of this.vehicles) {
      const entry = this.meshes.find((m) => m.style === v.style && m.key === 'paint');
      if (!entry) continue;
      c.setHex(v.paint).convertSRGBToLinear();
      entry.mesh.instanceColor.setXYZ(v.slot, c.r, c.g, c.b);
    }
    for (const m of this.meshes) if (m.mesh.instanceColor) m.mesh.instanceColor.needsUpdate = true;

    this._sorted = this.vehicles.slice();
    this.update(0);
  }

  /** Sample index for an arc distance, wrapped into the loop. */
  _indexAt(s) {
    const n = this.track.n;
    let i = Math.round(s / this.segLen) % n;
    if (i < 0) i += n;
    return i;
  }

  update(dt) {
    const track = this.track;
    const L = track.length;
    const vs = this.vehicles;

    if (dt > 0) {
      // Car-following: sort by arc position once, then each vehicle only has
      // to look at the handful of cars ahead of it rather than all 30.
      this._sorted.sort((a, b) => a.s - b.s);
      const S = this._sorted;
      const N = S.length;

      for (let i = 0; i < N; i++) {
        const v = S[i];
        const style = this.styles[v.style];
        let want = v.cruise;

        // look at the next few vehicles up the road
        for (let k = 1; k <= 4 && k < N; k++) {
          const o = S[(i + k) % N];
          let gap = o.s - v.s;
          if (gap < 0) gap += L;
          if (gap > 70) break;
          const sideBySide = Math.abs(o.lat - v.lat) < (style.width + this.styles[o.style].width) * 0.5 + 0.4;
          if (!sideBySide) continue;
          const clear = gap - style.length * 0.5 - this.styles[o.style].length * 0.5;
          if (clear < 26) {
            // ease down to the blocker's speed, matching it by 6 m
            const t = THREE.MathUtils.clamp((clear - 6) / 20, 0, 1);
            want = Math.min(want, THREE.MathUtils.lerp(o.speed * 0.94, v.cruise, t));
          }
        }

        // occasional lane change, but never into someone
        v.nextThink -= dt;
        if (v.nextThink <= 0) {
          v.nextThink = 7 + Math.random() * 12;
          const lanes = [0.74, 0.46, 0.16];
          const cand = lanes[(Math.random() * lanes.length) | 0];
          let free = true;
          for (const o of vs) {
            if (o === v) continue;
            let gap = o.s - v.s;
            if (gap > L * 0.5) gap -= L; else if (gap < -L * 0.5) gap += L;
            if (Math.abs(gap) < 26 && Math.abs(o.lane - cand) < 0.12) { free = false; break; }
          }
          if (free) v.targetLane = cand;
        }
        v.lane = THREE.MathUtils.damp(v.lane, v.targetLane, 1.1, dt);

        v.speed = THREE.MathUtils.damp(v.speed, want, want < v.speed ? 2.2 : 0.9, dt);
        v.s = (v.s + v.speed * dt) % L;
      }
    }

    // write instance matrices
    const p = this._p, r = this._r, u = this._u, t = this._t;
    for (const v of vs) {
      const style = this.styles[v.style];
      const i = this._indexAt(v.s);
      track.getPos(i, p); track.getRight(i, r); track.getUp(i, u); track.getTangent(i, t);
      const lat = track.width[i] * v.lane;
      v.lat = lat;
      v.index = i;

      // road crown, same shape the road mesh is built with
      const f = THREE.MathUtils.clamp((lat / track.width[i]) * 0.5 + 0.5, 0, 1);
      const crown = Math.cos(f * Math.PI - Math.PI / 2) * 0.14;

      p.x += r.x * lat + u.x * crown;
      p.y += r.y * lat + u.y * crown;
      p.z += r.z * lat + u.z * crown;

      // The track's right vector is cross(tangent, up), which makes
      // (right, up, tangent) left-handed: its determinant is -1, so it is a
      // reflection rather than a rotation. setFromRotationMatrix assumes a
      // pure rotation and silently collapsed it to (near) identity, leaving
      // every vehicle pointing along world +Z whatever way the road ran --
      // which is why traffic drove sideways. cross(up, tangent) is the same
      // axis negated and gives a genuine right-handed basis.
      this._bx.crossVectors(u, t).normalize();
      this._basis.makeBasis(this._bx, u, t);
      this._q.setFromRotationMatrix(this._basis);
      this._m.compose(p, this._q, ONE);

      const entries = this.meshes;
      for (let k = 0; k < entries.length; k++) {
        if (entries[k].style !== v.style) continue;
        entries[k].mesh.setMatrixAt(v.slot, this._m);
      }
      v.pos = v.pos || new THREE.Vector3();
      v.pos.copy(p);
      v.fwd = v.fwd || new THREE.Vector3();
      v.fwd.copy(t);
    }
    for (const m of this.meshes) m.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Karts vs traffic. A kart weighs a fraction of a guagua, so the kart
   * takes essentially all of the impulse: it gets shoved aside and loses
   * speed, while the vehicle only lifts off the throttle.
   * @returns {Array} list of { kart, force } for the caller to react to
   */
  collide(karts) {
    const hits = [];
    const d = new THREE.Vector3();
    for (const v of this.vehicles) {
      if (!v.pos) continue;
      const style = this.styles[v.style];
      const half = style.length * 0.5;
      const halfW = style.width * 0.5;
      for (const k of karts) {
        d.subVectors(k.position, v.pos);
        d.y = 0;
        // cheap reject before the oriented test
        if (d.lengthSq() > (half + 2.4) * (half + 2.4)) continue;

        // project into the vehicle's own frame
        const fz = d.dot(v.fwd);
        const rx = d.x * v.fwd.z - d.z * v.fwd.x; // right = fwd x up
        const overZ = half + k.radius - Math.abs(fz);
        const overX = halfW + k.radius - Math.abs(rx);
        if (overZ <= 0 || overX <= 0) continue;

        // push out along the shallower axis
        if (overX < overZ) {
          const s = Math.sign(rx) || 1;
          k.position.x += (v.fwd.z * s) * overX;
          k.position.z += (-v.fwd.x * s) * overX;
          k.lateral += s * 9 * Math.sign(k.right.x * v.fwd.z - k.right.z * v.fwd.x || 1);
          k.speed *= 0.82;
          hits.push({ kart: k, force: 0.45 });
        } else {
          const s = Math.sign(fz) || 1;
          k.position.x += v.fwd.x * s * overZ;
          k.position.z += v.fwd.z * s * overZ;
          if (s > 0) {
            // rear-ended it: the kart scrubs off a lot of speed
            k.speed = Math.min(k.speed * 0.5, v.speed * 0.85);
            hits.push({ kart: k, force: 0.9 });
          } else {
            k.speed = Math.max(k.speed, v.speed * 1.02);
            hits.push({ kart: k, force: 0.3 });
          }
          v.speed *= 0.96;
        }
      }
    }
    return hits;
  }

  dispose() {
    for (const { mesh } of this.meshes) {
      mesh.geometry.dispose();
      this.group.remove(mesh);
    }
    for (const m of Object.values(this.materials)) m.dispose();
    this.scene.remove(this.group);
    this.meshes.length = 0;
    this.vehicles.length = 0;
  }
}

const ONE = new THREE.Vector3(1, 1, 1);

/** Deterministic PRNG so the grid looks the same every run. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
