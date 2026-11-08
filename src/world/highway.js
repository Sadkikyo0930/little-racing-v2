import * as THREE from 'three';
import { Bucket } from './city.js';
import {
  chainLinkTexture, concreteTextures, curtainWallTextures, mulberry32, stuccoTextures,
  murallaTextures, roofTileTextures, woodTextures,
} from './textures.js';
import { quality } from '../core/device.js';

/* ------------------------------------------------------------------ *
 * Expreso Las Américas / Hato Rey scenery.
 *
 * A divided Puerto Rican expressway: gantries, cobra-head lighting, the
 * PR-18 viaduct, roadside Santurce fabric and the Hato Rey skyline.
 * Everything is procedural and merged through Bucket where it repeats.
 * ------------------------------------------------------------------ */

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 12);
const CYL_HI = new THREE.CylinderGeometry(1, 1, 1, 20);
const CYL_8 = new THREE.CylinderGeometry(1, 1, 1, 8);
const CONE = new THREE.ConeGeometry(1, 1, 14);
const SPH = new THREE.IcosahedronGeometry(1, 1);
const SPH_HI = new THREE.SphereGeometry(1, 16, 12);
const SPH_LO = new THREE.IcosahedronGeometry(1, 0);
const DOME = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
const TORUS = new THREE.TorusGeometry(1, 0.12, 8, 20);
const TAPER_CYL = new THREE.CylinderGeometry(0.58, 1, 1, 10);
const POLE = new THREE.CylinderGeometry(0.45, 0.95, 1, 12);
const PLANE = new THREE.PlaneGeometry(1, 1);
const FENCE = new THREE.PlaneGeometry(1, 2.6);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

function mat(px, py, pz, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _v.set(px, py, pz);
  _s.set(sx, sy, sz);
  return _m.compose(_v, _q, _s).clone();
}

function matBetween(ax, ay, az, bx, by, bz, radius) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  const mid = new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  const dir = new THREE.Vector3(dx / len, dy / len, dz / len);
  const q = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir);
  return new THREE.Matrix4().compose(mid, q, new THREE.Vector3(radius, len, radius));
}

function materialWithTexture(textures, opts = {}) {
  return new THREE.MeshStandardMaterial({
    map: textures.map,
    normalMap: textures.normalMap,
    roughnessMap: textures.roughnessMap,
    roughness: 0.88,
    metalness: 0,
    envMapIntensity: 0.55,
    ...opts,
  });
}

function makeMaterials() {
  const concrete = concreteTextures(512, 211);
  const concreteWarm = concreteTextures(512, 349);
  const glassA = curtainWallTextures(512, 202, 317);
  const glassB = curtainWallTextures(512, 215, 421);
  const stuccoA = stuccoTextures(0xd7c19a, 512, 71);
  const stuccoB = stuccoTextures(0xbfc7b4, 512, 73);
  const stone = murallaTextures(1024);
  const tile = roofTileTextures(512);
  const wood = woodTextures('#684225', 512);
  const chain = chainLinkTexture(256);

  const fence = new THREE.MeshStandardMaterial({
    map: chain,
    color: 0xd8e0dd,
    roughness: 0.46,
    metalness: 0.45,
    transparent: true,
    alphaTest: 0.18,
    side: THREE.DoubleSide,
    envMapIntensity: 0.8,
  });

  return {
    concrete: materialWithTexture(concrete),
    concreteWarm: materialWithTexture(concreteWarm, { color: 0xd2cab8 }),
    stone: materialWithTexture(stone, { roughness: 0.93, envMapIntensity: 0.58 }),
    trim: new THREE.MeshStandardMaterial({ color: 0xe9dfc8, roughness: 0.82, metalness: 0 }),
    marble: new THREE.MeshStandardMaterial({ color: 0xf3f1e8, roughness: 0.58, metalness: 0.02, envMapIntensity: 0.8 }),
    capitolWhite: new THREE.MeshStandardMaterial({ color: 0xf7f7f1, roughness: 0.62, metalness: 0.02, envMapIntensity: 0.85 }),
    roofTile: materialWithTexture(tile, { roughness: 0.86, envMapIntensity: 0.65 }),
    doorWood: materialWithTexture(wood, { roughness: 0.68, envMapIntensity: 0.55 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x9aa3aa, roughness: 0.38, metalness: 0.82, envMapIntensity: 1.2 }),
    darkSteel: new THREE.MeshStandardMaterial({ color: 0x33383c, roughness: 0.52, metalness: 0.72, envMapIntensity: 0.9 }),
    galvanized: new THREE.MeshStandardMaterial({ color: 0xb9c1c6, roughness: 0.5, metalness: 0.7, envMapIntensity: 1.0 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xffeed1, emissive: 0xffbf66, emissiveIntensity: 1.15, roughness: 0.36 }),
    amber: new THREE.MeshStandardMaterial({ color: 0xff6738, emissive: 0xff2d18, emissiveIntensity: 1.8, roughness: 0.55 }),
    glass: new THREE.MeshPhysicalMaterial({
      map: glassA.map, normalMap: glassA.normalMap, roughnessMap: glassA.roughnessMap,
      color: 0xa8d7ff, roughness: 0.18, metalness: 0.18, transparent: true, opacity: 0.88, envMapIntensity: 2.0,
    }),
    glassBlue: new THREE.MeshPhysicalMaterial({
      map: glassB.map, normalMap: glassB.normalMap, roughnessMap: glassB.roughnessMap,
      color: 0x9ccfff, roughness: 0.14, metalness: 0.24, transparent: true, opacity: 0.84, envMapIntensity: 2.3,
    }),
    reveal: new THREE.MeshStandardMaterial({ color: 0x11151a, roughness: 0.9, metalness: 0 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x5a6570, roughness: 0.72, metalness: 0.18 }),
    warehouseA: materialWithTexture(stuccoA, { roughness: 0.91, envMapIntensity: 0.42 }),
    warehouseB: materialWithTexture(stuccoB, { roughness: 0.93, envMapIntensity: 0.42 }),
    shantyA: new THREE.MeshStandardMaterial({ color: 0x3aa1d8, roughness: 0.86 }),
    shantyB: new THREE.MeshStandardMaterial({ color: 0xf0c84a, roughness: 0.86 }),
    shantyC: new THREE.MeshStandardMaterial({ color: 0xe06451, roughness: 0.86 }),
    shantyD: new THREE.MeshStandardMaterial({ color: 0x66b56b, roughness: 0.86 }),
    palmTrunk: new THREE.MeshStandardMaterial({ color: 0x806a4d, roughness: 0.9 }),
    frond: new THREE.MeshStandardMaterial({ color: 0x2f7f35, roughness: 0.74, side: THREE.DoubleSide }),
    canopy: new THREE.MeshStandardMaterial({ color: 0x2b6534, roughness: 0.86, flatShading: true }),
    flamboyan: new THREE.MeshStandardMaterial({ color: 0xe64526, roughness: 0.82, flatShading: true }),
    flamboyanOrange: new THREE.MeshStandardMaterial({ color: 0xf06f2c, roughness: 0.82, flatShading: true }),
    water: new THREE.MeshPhysicalMaterial({
      color: 0x2f8fab, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.78,
      transmission: 0.35, thickness: 0.5, envMapIntensity: 1.4,
    }),
    parking: new THREE.MeshStandardMaterial({ color: 0x383d42, roughness: 0.8, metalness: 0 }),
    dirt: new THREE.MeshStandardMaterial({ color: 0x8a6a3f, roughness: 0.98, metalness: 0 }),
    dryGrass: new THREE.MeshStandardMaterial({ color: 0x9b8a47, roughness: 0.96, metalness: 0, flatShading: true }),
    scrub: new THREE.MeshStandardMaterial({ color: 0x466f32, roughness: 0.92, metalness: 0, flatShading: true }),
    rock: new THREE.MeshStandardMaterial({ color: 0x756f62, roughness: 0.94, metalness: 0, flatShading: true }),
    fence,
    signPost: new THREE.MeshStandardMaterial({ color: 0xb9c5bd, roughness: 0.48, metalness: 0.75, envMapIntensity: 1.1 }),
    signBack: new THREE.MeshStandardMaterial({ color: 0x3a4a42, roughness: 0.64, metalness: 0.25 }),
    grate: new THREE.MeshStandardMaterial({ color: 0x151719, roughness: 0.58, metalness: 0.8 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xf4c542, roughness: 0.65, metalness: 0 }),
    black: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.7, metalness: 0.1 }),
  };
}

const LEGENDS = [
  { tab: 'SALIDA 2', main: 'Hato Rey', sub: 'PR-18 SUR', shield: '18', arrow: '↓' },
  { tab: 'PR-25', main: 'Ave. Fernández Juncos', sub: 'Santurce  •  Miramar', shield: '25', arrow: '↘' },
  { tab: 'EXPRESO', main: 'Caño Martín Peña', sub: 'Río Piedras', shield: '18', arrow: '↓' },
  { tab: 'OESTE', main: 'Viejo San Juan', sub: 'El Morro  •  Puerta de Tierra', shield: '1', arrow: '↙' },
  { tab: 'LOCAL', main: 'Ave. Ing. M. Domenech', sub: 'Milla de Oro', shield: '21', arrow: '↓' },
  { tab: 'SALIDA', main: 'Santurce', sub: 'Centro de Convenciones', shield: '26', arrow: '↗' },
];

// How far toward the centre of a bend a lateral offset may reach, as a
// fraction of the radius of curvature. Below 1.0 by a comfortable margin so
// props never crowd the arc centre, where the offset frame degenerates.
const SAFE_ARC = 0.72;

const BILLBOARDS = [
  ['HATO REY', 'Milla de Oro adelante'],
  ['SABOR BORICUA', 'café • playa • sol'],
  ['SAN JUAN', 'maneja con calma'],
  ['EXPRESO', 'próxima salida 800 m'],
  ['ISLA VERDE', 'brisa del Atlántico'],
  ['RÍO PIEDRAS', 'por PR-18 Sur'],
];

export class Highway {
  constructor(track, scene, terrain = null) {
    this.track = track;
    this.scene = scene;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'highway';
    this.M = makeMaterials();
    this.rnd = mulberry32(1818);
    this.b = new Bucket();
    this.bNoShadow = new Bucket();
    this.directMaterials = [];
    this.directTextures = [];
    this.directGeometries = [];
    this.landmarks = [];

    const tier = quality.tier;
    this.profile = tier === 'low'
      ? { lamp: 92, trees: 55, buildings: 130, gantry: 390, fence: 120, skyline: 11, overpasses: 2, verge: 150 }
      : tier === 'mid'
        ? { lamp: 72, trees: 38, buildings: 96, gantry: 340, fence: 90, skyline: 16, overpasses: 3, verge: 105 }
        : { lamp: 54, trees: 26, buildings: 72, gantry: 285, fence: 66, skyline: 24, overpasses: 4, verge: 72 };

    this._bakeSetbackLimits();
    this._buildViaduct();
    this._placeLandmarks();
    this._placeSkyline();
    this._placeGantries();
    this._placeLighting();
    this._placeRoadsideBuildings();
    this._placeVegetation();
    this._placeVergeDressing();
    this._placeFences();
    this._placeBillboards();
    this._placeMarkersAndDrainage();
    this._placeOverpasses();
    this._placeBarrierEnds();

    this.b.build(this.group, { cast: true, receive: true });
    this.bNoShadow.build(this.group, { cast: false, receive: true });
    scene.add(this.group);
  }

  r(a = 1, b = null) {
    return b === null ? this.rnd() * a : a + this.rnd() * (b - a);
  }

  ri(a, b) {
    return Math.floor(this.r(a, b + 1));
  }

  pick(arr) {
    return arr[Math.floor(this.rnd() * arr.length)];
  }

  /**
   * Maximum setback per sample and side before the offset would cross into
   * another part of the circuit.
   *
   * The expreso loop is a divided highway: the two carriageways are barely
   * 34 m apart, so a "roadside" building asked to stand 60 m off the centre
   * line is planted squarely in the opposing lanes. Nothing in the placement
   * code could see that, because each carriageway only knows its own centre
   * line. This walks outward from every sample until the point comes within
   * reach of a *distant* stretch of track, and records how far it got.
   *
   * Proximity in index space rather than metres is what makes "another part of
   * the circuit" meaningful — neighbouring samples are always close by.
   */
  _bakeSetbackLimits() {
    const t = this.track;
    const CELL = 10, REACH = 80, STEP = 1.5, GAP = 2.5;
    const far = Math.max(40, Math.round(t.n * 0.04));
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < t.n; i++) {
      const x = t.pos[i * 3], z = t.pos[i * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const gw = Math.ceil((maxX - minX) / CELL) + 3;
    const cells = new Map();
    const key = (cx, cz) => cz * gw + cx;
    for (let i = 0; i < t.n; i++) {
      const cx = ((t.pos[i * 3] - minX) / CELL | 0) + 1, cz = ((t.pos[i * 3 + 2] - minZ) / CELL | 0) + 1;
      const k = key(cx, cz);
      let a = cells.get(k); if (!a) cells.set(k, (a = []));
      a.push(i);
    }

    const limit = new Float32Array(t.n * 2);
    const p = new THREE.Vector3();    for (let i = 0; i < t.n; i++) {
      for (let si = 0; si < 2; si++) {
        const side = si === 0 ? 1 : -1;
        let reached = REACH;
        for (let lat = t.width[i]; lat <= REACH; lat += STEP) {
          t.pointAt(i, side * lat, p);
          const cx = ((p.x - minX) / CELL | 0) + 1, cz = ((p.z - minZ) / CELL | 0) + 1;
          let hit = false;
          for (let dz = -1; dz <= 1 && !hit; dz++) {
            for (let dx = -1; dx <= 1 && !hit; dx++) {
              const a = cells.get(key(cx + dx, cz + dz));
              if (!a) continue;
              for (const j of a) {
                const d = Math.abs(i - j), arc = Math.min(d, t.n - d);
                if (arc < far) continue;
                const ex = p.x - t.pos[j * 3], ez = p.z - t.pos[j * 3 + 2];
                const rr = t.width[j] + GAP;
                if (ex * ex + ez * ez < rr * rr) { hit = true; break; }
              }
            }
          }
          if (hit) { reached = Math.max(t.width[i], lat - STEP); break; }
        }
        limit[i * 2 + si] = reached;
      }
    }
    this.setbackLimit = limit;
    this._grid = { cells, key, CELL, minX, minZ };
  }

  /**
   * Metres between a world position and the nearest road edge — negative when
   * the point is over the carriageway. Landmarks compose their own local
   * frames and so bypass `roomLat` entirely; this is the backstop that lets
   * the prop builders themselves refuse to stand on the racing line.
   */
  roadClearance(pos) {
    const g = this._grid;
    if (!g) return Infinity;
    const t = this.track;
    const cx = ((pos.x - g.minX) / g.CELL | 0) + 1, cz = ((pos.z - g.minZ) / g.CELL | 0) + 1;
    let best = Infinity;
    const span = 2;
    for (let dz = -span; dz <= span; dz++) {
      for (let dx = -span; dx <= span; dx++) {
        const a = g.cells.get(g.key(cx + dx, cz + dz));
        if (!a) continue;
        for (const j of a) {
          const ex = pos.x - t.pos[j * 3], ez = pos.z - t.pos[j * 3 + 2];
          const d = Math.sqrt(ex * ex + ez * ez) - t.width[j];
          if (d < best) best = d;
        }
      }
    }
    return best;
  }

  /** Setback ceiling from `_bakeSetbackLimits`, for a signed lateral offset. */
  setbackCap(i, lat) {
    if (!this.setbackLimit) return Infinity;
    const j = this.track.sampleAt(i);
    return this.setbackLimit[j * 2 + (lat >= 0 ? 0 : 1)];
  }

  /**
   * Offsetting a curve toward the inside of a bend by more than its radius of
   * curvature pushes the offset point through the arc centre and out the far
   * side — so a palm asked to stand 20 m off a 15 m-radius U-turn reappears
   * standing in the middle of the opposite carriageway. The tightest bends on
   * the expreso loop are ~15 m, and props are placed at width + 8..20 m, so
   * this bit every emitter on the inside of both turnarounds.
   *
   * `safeLat` clamps against both that and the self-proximity cap. It is the
   * blunt safety net wired into `basis`/`facing`, so nothing can ever land on
   * the road; emitters that would rather skip than pile up against the barrier
   * should ask `roomLat` first.
   */
  safeLat(i, lat) {
    const t = this.track;
    const j = t.sampleAt(i);
    const k = t.curvature[j];
    // Sign convention measured on the built track: a lateral offset is toward
    // the inside of the bend when it opposes the sign of the curvature.
    if (!k || lat * k >= 0) return lat;
    const bound = SAFE_ARC * Math.abs(1 / k);
    if (Math.abs(lat) <= bound) return lat;
    // Never pull a prop closer than the road edge — better flush against the
    // barrier than standing on the racing line.
    //
    // Deliberately does NOT apply the self-proximity cap: overshooting that
    // means the prop landed on the *opposite* carriageway, and clamping would
    // drag it back onto this one. Emitters handle that by skipping, via
    // `roomLat`.
    return Math.sign(lat) * Math.max(bound, t.width[j]);
  }

  /**
   * Placement offset that respects both hazards, or null when the prop simply
   * does not fit. `extent` is the object's half-footprint, and it applies in
   * both directions: a wide flamboyán canopy has to clear this carriageway on
   * the inside as surely as it has to clear the opposing one on the outside.
   */
  roomLat(i, lat, extent = 2.0) {
    const t = this.track;
    const j = t.sampleAt(i);
    const k = t.curvature[j];
    let bound = this.setbackCap(j, lat);
    if (k && lat * k < 0) bound = Math.min(bound, SAFE_ARC * Math.abs(1 / k));
    const lo = t.width[j] + extent + 1.0;
    const hi = bound - extent;
    if (lo > hi) return null;
    return Math.sign(lat) * THREE.MathUtils.clamp(Math.abs(lat), lo, hi);
  }

  basis(i, lat = 0, lift = 0) {
    const t = this.track;
    lat = this.safeLat(i, lat);
    const p = t.pointAt(i, lat, new THREE.Vector3());
    const over = Math.max(0, Math.abs(lat) - t.width[t.sampleAt(i)]);
    p.y -= Math.min(over * 0.14, 2.35);
    p.y += lift;
    const tan = t.getTangent(i, new THREE.Vector3());
    tan.y = 0;
    if (tan.lengthSq() < 1e-6) tan.set(0, 0, 1);
    tan.normalize();
    const right = new THREE.Vector3(-tan.z, 0, tan.x);
    const up = new THREE.Vector3(0, 1, 0);
    const base = new THREE.Matrix4().makeBasis(right, up, tan);
    base.setPosition(p);
    return base;
  }

  local(i, lat = 0, lift = 0) {
    const base = this.basis(i, lat, lift);
    return (m) => base.clone().multiply(m);
  }

  /**
   * Lift that puts a frame's origin on the real ground rather than on the
   * shoulder approximation `basis()` uses. Roadside props are offset from the
   * road plane and then dropped by a flat 0.14 m/m guess, which is nowhere near
   * the terrain once the land starts rolling — fences were sinking 2.5 m and
   * floating 5 m. Returns 0 when there is no terrain to ask.
   */
  groundLift(i, lat) {
    if (!this.terrain?.heightAt) return 0;
    const t = this.track;
    const safe = this.safeLat(i, lat);
    const p = t.pointAt(i, safe, new THREE.Vector3());
    const over = Math.max(0, Math.abs(safe) - t.width[t.sampleAt(i)]);
    const frameY = p.y - Math.min(over * 0.14, 2.35);
    return this.terrain.heightAt(p.x, p.z) - frameY;
  }

  facing(i, lat = 0, lift = 0) {
    const t = this.track;
    lat = this.safeLat(i, lat);
    const p = t.pointAt(i, lat, new THREE.Vector3());
    const over = Math.max(0, Math.abs(lat) - t.width[t.sampleAt(i)]);
    p.y -= Math.min(over * 0.14, 2.35);
    p.y += lift;
    const r = t.getRight(i, new THREE.Vector3());
    r.y = 0;
    if (r.lengthSq() < 1e-6) r.set(1, 0, 0);
    r.normalize();
    const sign = Math.sign(lat) || 1;
    const yaw = Math.atan2(-sign * r.x, -sign * r.z);
    const base = new THREE.Matrix4().compose(
      p, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1)
    );
    return (m) => base.clone().multiply(m);
  }

  sampleStep(metres) {
    return Math.max(1, Math.round(metres / (this.track.length / this.track.n)));
  }

  landmarkFrame(frac, side, setback = 34, lift = 0) {
    const i = this.track.sampleAt(Math.floor(frac * this.track.n));
    const lat = side * (this.track.width[i] + setback);
    const p = this.track.pointAt(i, lat, new THREE.Vector3());
    const L = this.facing(i, lat, lift);
    return { i, lat, p, L };
  }

  _placeLandmarks() {
    this._placeMorroRamparts();
    this._placeCapitolio();
    this._placeCondadoLagoon();
    this._placeCanoMartinPena();
    this._placeCholiseo();
    this._placeSportsComplex();
    this._placePlazaLasAmericas();
  }

  _noteLandmark(name, p) {
    this.landmarks.push({ name, position: p.clone() });
  }

  _placeMorroRamparts() {
    const t = this.track;
    const seg = this.sampleStep(5.5);
    // Side +1 is the flank away from the median on both carriageways -- the
    // loop's return leg is the corridor offset the other way and driven
    // backwards, so "right" is the outside of the pair either way. The wall
    // used to be built on side -1, and since the carriageways are only ~34 m
    // apart it stood squarely on the opposing one, blocking the view of
    // everything beyond it.
    for (let i = 0; i < this.sampleStep(155); i += seg) {
      const L = this.facing(i, t.width[t.sampleAt(i)] + 26, 0);
      const h = 7.5 + Math.sin(i * 0.04) * 1.2;
      const g = new THREE.CylinderGeometry(1, 1.24, 1, 4, 1);
      g.rotateY(Math.PI / 4);
      this.b.add('stone', this.M.stone, g, L(mat(0, h / 2 - 1.2, 0, 5.5, h, 4.2)), [1.4, h / 4.5]);
      this.b.add('stone', this.M.stone, BOX, L(mat(0, h + 0.35, 0, 6.2, 0.8, 4.6)), [1.5, 1]);
      if (i % (seg * 8) === 0) this._garitaLocal(L, 0, h + 0.5, 0, 0.62);
    }
    // A second run of muralla down the last stretch of the return leg, so the
    // approach to the turnaround is walled on both flanks and reads as the
    // road threading the headland rather than open verge.
    const i0 = Math.floor(t.n * 0.928);
    const i1 = Math.floor(t.n * 0.978);
    for (let i = i0; i < i1; i += seg) {
      const L = this.facing(i, t.width[t.sampleAt(i)] + 24, 0);
      const h = 8.2 + Math.sin(i * 0.03) * 1.3;
      const g = new THREE.CylinderGeometry(1, 1.24, 1, 4, 1);
      g.rotateY(Math.PI / 4);
      this.b.add('stone', this.M.stone, g, L(mat(0, h / 2 - 1.2, 0, 5.5, h, 4.2)), [1.4, h / 4.5]);
      this.b.add('stone', this.M.stone, BOX, L(mat(0, h + 0.35, 0, 6.2, 0.8, 4.6)), [1.5, 1]);
      if ((i - i0) % (seg * 9) === 0) this._garitaLocal(L, 0, h + 0.5, 0, 0.62);
    }

    // El Morro closes off the far side of the near turnaround, which is the
    // one place on the loop it can actually be seen: it sits dead ahead
    // (dot ~1.0 with the direction of travel) for the whole run back in, and
    // falls away behind you as you swing around and head back out of the old
    // city. It used to be pinned beside the *outbound* start instead, where
    // it was over 70 degrees off-axis -- outside the frustum -- from every
    // point on the loop, which is why nobody ever saw it.
    const s = this.landmarkFrame(0.985, 1, 95);
    this._morroFortress(s.L, 0.8, true);
    this._noteLandmark('Castillo San Felipe del Morro', s.p);
  }

  _garitaLocal(L, x, y, z, s = 1) {
    const M = this.M;
    this.b.add('stone', M.stone, CONE, L(mat(x, y + 0.9 * s, z, 1.45 * s, 1.8 * s, 1.45 * s)));
    this.b.add('stone', M.stone, CYL_HI, L(mat(x, y + 2.7 * s, z, 1.16 * s, 2.6 * s, 1.16 * s)));
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      this.b.add('reveal', M.reveal, BOX,
        L(mat(x + Math.sin(a) * 1.12 * s, y + 2.9 * s, z + Math.cos(a) * 1.12 * s, 0.18 * s, 0.8 * s, 0.18 * s, 0, -a, 0)));
    }
    this.b.add('stone', M.stone, CYL_HI, L(mat(x, y + 4.0 * s, z, 1.35 * s, 0.32 * s, 1.35 * s)));
    this.b.add('stone', M.stone, DOME, L(mat(x, y + 4.1 * s, z, 1.26 * s, 1.2 * s, 1.26 * s)));
    this.b.add('stone', M.stone, SPH_LO, L(mat(x, y + 5.25 * s, z, 0.26 * s, 0.34 * s, 0.26 * s)));
  }

  _morroFortress(L, scale = 1, lighthouse = true) {
    const S = new THREE.Matrix4().makeScale(scale, scale, scale);
    const LL = (m) => L(S.clone().multiply(m));
    const B = this.b, M = this.M;
    const face = (w, d, h, y, zFront) => {
      const g = new THREE.CylinderGeometry(1, 1.13, 1, 4, 1);
      g.rotateY(Math.PI / 4);
      B.add('stone', M.stone, g, LL(mat(0, y + h / 2, zFront - d / 2, w, h, d)), [w / 5, h / 5]);
      B.add('stone', M.stone, BOX, LL(mat(0, y + h + 0.5, zFront - d / 2, w + 2.4, 1.0, d + 2.2)), [w / 5, 1]);
      B.add('stone', M.stone, BOX, LL(mat(0, y + h + 1.8, zFront - d / 2, w, 1.8, d)), [w / 5, 1]);
      const merlons = Math.max(5, Math.floor(w / 7));
      for (let k = 0; k <= merlons; k++) {
        const x = -w / 2 + (k / merlons) * w;
        B.add('stone', M.stone, BOX, LL(mat(x, y + h + 3.0, zFront + 0.3, 2.5, 1.6, 1.25)));
      }
      return y + h + 1.8;
    };
    face(112, 24, 10, -5, 42);
    const walk1 = face(104, 31, 18, 0, 30);
    const walk2 = face(76, 27, 10, walk1, 4);
    face(48, 21, 8, walk2, -18);
    B.add('stone', M.stone, BOX, LL(mat(0, -2.5, 49, 112, 5, 10)), [20, 1]);
    B.add('stone', M.stone, BOX, LL(mat(0, 4, 37, 12, 8, 15)), [2, 1]);
    B.add('reveal', M.reveal, BOX, LL(mat(0, 4.0, 43.2, 5.5, 5.7, 0.55)));
    for (const s of [-1, 1]) {
      const bastion = new THREE.CylinderGeometry(10, 14, 20, 5, 1);
      B.add('stone', M.stone, bastion, LL(mat(s * 53, 10, 24, 1, 1, 1, 0, s * 0.5, 0)), [4, 3]);
      this._garitaLocal(LL, s * 53, 20.8, 24, 1);
      this._garitaLocal(LL, s * 47, 5.7, 41, 0.9);
    }
    for (let k = 0; k < 5; k++) {
      const x = -22 + k * 11;
      B.add('darkSteel', M.darkSteel, CYL, LL(mat(x, walk2 + 1.6, 2.0, 0.5, 3.6, 0.5, 1.35)));
      B.add('doorWood', M.doorWood, BOX, LL(mat(x, walk2 + 0.8, 0.7, 1.4, 0.9, 2.4)));
    }
    if (lighthouse) {
      const y0 = walk2 + 9;
      B.add('capitolWhite', M.capitolWhite, BOX, LL(mat(0, y0 + 2.4, -24, 18, 4.8, 12)), [3, 1]);
      B.add('capitolWhite', M.capitolWhite, CYL_HI, LL(mat(0, y0 + 10.2, -24, 3.5, 9.5, 3.5)));
      B.add('darkSteel', M.darkSteel, CYL_HI, LL(mat(0, y0 + 15.3, -24, 2.7, 2.4, 2.7)));
      this.bNoShadow.add('lampGlow', M.lamp, SPH, LL(mat(0, y0 + 15.3, -24, 1.25, 1.25, 1.25)));
      B.add('capitolWhite', M.capitolWhite, CONE, LL(mat(0, y0 + 18.0, -24, 3.0, 2.2, 3.0)));
    }
  }

  _placeCapitolio() {
    const { L, p } = this.landmarkFrame(0.079, 1, 48);
    const M = this.M, B = this.b;
    B.add('capitolWhite', M.capitolWhite, BOX, L(mat(0, 6.5, -14, 58, 13, 28)), [6, 2]);
    B.add('capitolWhite', M.capitolWhite, BOX, L(mat(0, 8.5, 2.4, 31, 17, 8)), [4, 2]);
    for (let k = -5; k <= 5; k++) {
      B.add('capitolWhite', M.capitolWhite, CYL_HI, L(mat(k * 2.65, 6.6, 7.0, 0.46, 12.8, 0.46)));
    }
    B.add('trim', M.trim, BOX, L(mat(0, 13.4, 7.0, 33, 0.9, 2.2)));
    B.add('trim', M.trim, CONE, L(mat(0, 16.2, 7.0, 18, 4.5, 3.2, 0, Math.PI / 4, 0)));
    for (let s = 0; s < 6; s++) {
      B.add('marble', M.marble, BOX, L(mat(0, 0.18 + s * 0.24, 9.8 + s * 1.05, 42 - s * 4, 0.28, 1.0)));
    }
    B.add('capitolWhite', M.capitolWhite, CYL_HI, L(mat(0, 15.2, -13, 8.6, 5.2, 8.6)));
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      B.add('trim', M.trim, BOX, L(mat(Math.sin(a) * 8.8, 15.5, -13 + Math.cos(a) * 8.8, 0.42, 4.8, 0.32, 0, a, 0)));
    }
    B.add('capitolWhite', M.capitolWhite, DOME, L(mat(0, 17.7, -13, 8.6, 7.2, 8.6)));
    B.add('trim', M.trim, TORUS, L(mat(0, 17.8, -13, 8.7, 8.7, 8.7, Math.PI / 2)));
    B.add('trim', M.trim, CYL_HI, L(mat(0, 25.0, -13, 1.1, 2.8, 1.1)));
    this._noteLandmark('Capitolio de Puerto Rico', p);
  }

  _placeCondadoLagoon() {
    const i = this.track.sampleAt(Math.floor(0.174 * this.track.n));
    const y = this.track.getPos(i, new THREE.Vector3()).y;
    const Lw = this.basis(i, 0, 1.0 - y);
    this.bNoShadow.add('lagoonWater', this.M.water, PLANE, Lw.multiply(mat(18, 0, 8, 190, 124, 1, -Math.PI / 2)));
    for (const side of [-1, 1]) {
      const s = this.landmarkFrame(0.166 + (side > 0 ? 0.012 : 0), side, side > 0 ? 105 : 82);
      this._hotelCluster(s.L, side);
    }
  }

  _hotelCluster(L, side) {
    const M = this.M, B = this.b;
    B.add('capitolWhite', M.capitolWhite, BOX, L(mat(-28, 8, -16, 48, 16, 16)), [4, 2]);
    B.add('glassBlue', M.glassBlue, BOX, L(mat(-28, 9, -7.6, 45, 9, 0.55)), [6, 2]);
    for (let k = 0; k < 3; k++) {
      const h = 30 + k * 8;
      B.add(k % 2 ? 'towerGlass' : 'towerGlassB', k % 2 ? M.glass : M.glassBlue,
        BOX, L(mat(8 + k * 15, h / 2, -18 - k * 6, 11, h, 14)), [2, h / 10]);
      B.add('capitolWhite', M.capitolWhite, BOX, L(mat(8 + k * 15, h + 0.5, -18 - k * 6, 12, 1.0, 15)));
    }
    for (let p = 0; p < (quality.tier === 'low' ? 4 : 8); p++) {
      this._palm(new THREE.Vector3(0, 0, 0).applyMatrix4(L(mat(-48 + p * 8, 0, side * 3 - 2, 1, 1, 1))), this.r(0, Math.PI * 2));
    }
  }

  _placeCanoMartinPena() {
    const i = this.track.sampleAt(Math.floor(0.224 * this.track.n));
    const y = this.track.getPos(i, new THREE.Vector3()).y;
    this.bNoShadow.add('canoWater', this.M.water, PLANE, this.basis(i, 0, 0.8 - y).multiply(mat(0, 0, 0, 135, 56, 1, -Math.PI / 2)));
    const mats = [this.M.shantyA, this.M.shantyB, this.M.shantyC, this.M.shantyD];
    const count = quality.tier === 'low' ? 12 : quality.tier === 'mid' ? 18 : 26;
    for (let k = 0; k < count; k++) {
      const side = k % 2 ? 1 : -1;
      const ii = this.track.sampleAt(i + this.sampleStep(this.r(-60, 70)));
      const lat = side * (this.track.width[ii] + this.r(26, 68));
      const L = this.facing(ii, lat, -0.8);
      this._stiltHouse(L, mats[k % mats.length], k);
    }
  }

  _stiltHouse(L, wallMat, k) {
    const M = this.M, B = this.b;
    const w = this.r(5.5, 9.5), d = this.r(5.0, 8.5), h = this.r(3.0, 4.6);
    for (const x of [-w * 0.38, w * 0.38]) {
      for (const z of [-d * 0.82, -d * 0.18]) B.add('palmTrunk', M.palmTrunk, CYL_8, L(mat(x, 1.0, z, 0.11, 2.0, 0.11)));
    }
    B.add('shanty' + (k % 4), wallMat, BOX, L(mat(0, 2.2 + h / 2, -d / 2, w, h, d)), [1.2, 1]);
    B.add('galvanized', M.galvanized, BOX, L(mat(0, 2.3 + h, -d / 2, w + 1.0, 0.26, d + 1.2, 0, 0, this.r(-0.08, 0.08))));
    B.add('reveal', M.reveal, BOX, L(mat(-w * 0.22, 2.2 + h * 0.55, 0.08, 1.0, 1.1, 0.15)));
    B.add('doorWood', M.doorWood, BOX, L(mat(w * 0.28, 2.2 + h * 0.42, 0.08, 1.1, 1.9, 0.18)));
  }

  _placeCholiseo() {
    const { L, p } = this.landmarkFrame(0.292, -1, 62);
    const M = this.M, B = this.b;
    B.add('capitolWhite', M.capitolWhite, CYL_HI, L(mat(0, 8.2, -16, 28, 16.4, 20)));
    B.add('glassBlue', M.glassBlue, CYL_HI, L(mat(0, 9.0, -16, 28.6, 3.4, 20.6)));
    B.add('capitolWhite', M.capitolWhite, SPH_HI, L(mat(0, 17.1, -16, 29.5, 7.2, 21.0)));
    B.add('trim', M.trim, TORUS, L(mat(0, 15.4, -16, 29.5, 21.0, 21.0, Math.PI / 2)));
    this._label(L, 'COLISEO', 11, 2.4, 0, 10.2, 5.1);
    for (const x of [-23, 23]) B.add('trim', M.trim, BOX, L(mat(x, 4.5, 6.4, 2.2, 9.0, 2.0)));
    this._noteLandmark('Coliseo de Puerto Rico', p);
  }

  _placeSportsComplex() {
    const st = this.landmarkFrame(0.323, 1, 70);
    const M = this.M, B = this.b;
    B.add('concreteWarm', M.concreteWarm, CYL_HI, st.L(mat(-18, 5.2, -26, 26, 7.2, 22)));
    B.add('parking', M.parking, TORUS, st.L(mat(-18, 8.9, -26, 24, 19, 19, Math.PI / 2)));
    B.add('scrub', M.scrub, CYL_HI, st.L(mat(-18, 9.05, -26, 14, 0.18, 11)));
    for (let k = 0; k < 4; k++) {
      const a = Math.PI * 0.25 + k * Math.PI * 0.5;
      this._stadiumLight(st.L, -18 + Math.sin(a) * 31, -26 + Math.cos(a) * 26, 26);
    }
    B.add('capitolWhite', M.capitolWhite, CYL_HI, st.L(mat(35, 7.2, -20, 15, 14, 15)));
    B.add('capitolWhite', M.capitolWhite, DOME, st.L(mat(35, 14.0, -20, 15.6, 6.2, 15.6)));
    this._label(st.L, 'ESTADIO', 10, 2.2, -18, 12.5, -1);
    this._label(st.L, 'COLISEO', 8, 2.0, 35, 11.2, -2.8);
    this._noteLandmark('Estadio Hiram Bithorn / Roberto Clemente', st.p);
  }

  _stadiumLight(L, x, z, h) {
    const M = this.M, B = this.b;
    B.add('darkSteel', M.darkSteel, CYL_8, L(mat(x, h / 2, z, 0.18, h, 0.18)));
    for (const dx of [-0.8, 0.8]) B.add('darkSteel', M.darkSteel, CYL_8, L(matBetween(x, 2, z, x + dx, h - 1, z, 0.06)));
    B.add('darkSteel', M.darkSteel, BOX, L(mat(x, h + 0.2, z, 4.8, 2.8, 0.4)));
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
      this.bNoShadow.add('lampGlow', M.lamp, SPH_LO, L(mat(x - 1.8 + c * 1.2, h + 1.0 - r * 0.8, z - 0.32, 0.28, 0.22, 0.16)));
    }
  }

  _placePlazaLasAmericas() {
    const { L, p } = this.landmarkFrame(0.364, -1, 92);
    const M = this.M, B = this.b;
    B.add('warehouseA', M.warehouseA, BOX, L(mat(0, 7.0, -34, 118, 14, 62)), [12, 2]);
    B.add('roof', M.roof, BOX, L(mat(0, 14.5, -34, 120, 1.0, 64)));
    B.add('warehouseB', M.warehouseB, BOX, L(mat(-44, 10, -2, 34, 20, 28)), [5, 3]);
    B.add('warehouseB', M.warehouseB, BOX, L(mat(48, 9, -4, 38, 18, 30)), [5, 3]);
    this._label(L, 'PLAZA', 15, 3.2, 0, 12.0, 0.2);
    for (const z of [18, 40]) {
      B.add('parking', M.parking, BOX, L(mat(0, 0.05, z, 130, 0.08, 28)));
      for (let x = -56; x <= 56; x += 8) B.add('trim', M.trim, BOX, L(mat(x, 0.14, z, 0.18, 0.08, 20)));
      const cars = quality.tier === 'low' ? 8 : 16;
      for (let k = 0; k < cars; k++) {
        const x = -58 + (k % 8) * 16 + this.r(-1, 1);
        const zz = z - 9 + Math.floor(k / 8) * 14;
        B.add(k % 2 ? 'shantyA' : 'shantyC', k % 2 ? M.shantyA : M.shantyC, BOX, L(mat(x, 0.65, zz, 2.5, 1.0, 4.2)));
      }
    }
    this._noteLandmark('Plaza Las Américas', p);
  }

  _label(L, text, w, h, x, y, z) {
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 128;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#f7f3df'; ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = '#1c2b38'; ctx.lineWidth = 8; ctx.strokeRect(8, 8, 496, 112);
    ctx.fillStyle = '#1c2b38';
    ctx.font = 'bold 64px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 68);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.directTextures.push(tex);
    const matl = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, side: THREE.DoubleSide });
    this.directMaterials.push(matl);
    const geo = new THREE.PlaneGeometry(w, h);
    this.directGeometries.push(geo);
    const mesh = new THREE.Mesh(geo, matl);
    mesh.userData.noCollide = true;
    mesh.applyMatrix4(L(mat(x, y, z, 1, 1, 1)));
    this.group.add(mesh);
  }

  /* ---------------------------- gantries ---------------------------- */
  _placeGantries() {
    const step = this.sampleStep(this.profile.gantry);
    const offset = this.sampleStep(70);
    let k = 0;
    for (let i = offset; i < this.track.n; i += step) {
      if (Math.abs(this.track.curvature[i]) > 0.038) continue;
      this._gantry(i, LEGENDS[k++ % LEGENDS.length], LEGENDS[k % LEGENDS.length]);
    }
  }

  _gantry(i, leftLegend, rightLegend) {
    const M = this.M;
    const B = this.b;
    const w = this.track.width[i];
    const L = this.local(i, 0, 0);
    const leftX = -(w + 5.4);
    const rightX = w + 5.8;
    const y0 = 0.06, top = 8.3;
    const z = 0;
    const span = rightX - leftX;

    for (const x of [leftX, rightX]) {
      B.add('gantrySteel', M.steel, CYL_HI, L(mat(x, top / 2, z, 0.22, top, 0.22)));
      B.add('gantrySteel', M.steel, CYL_HI, L(mat(x + (x < 0 ? 0.55 : -0.55), top / 2, z, 0.16, top * 0.96, 0.16)));
      B.add('gantryBase', M.concrete, BOX, L(mat(x, y0 + 0.22, z, 1.8, 0.44, 1.8)));
    }

    B.add('gantrySteel', M.steel, BOX, L(mat((leftX + rightX) / 2, top, z, span, 0.22, 0.22)));
    B.add('gantrySteel', M.steel, BOX, L(mat((leftX + rightX) / 2, top - 1.05, z, span, 0.18, 0.18)));
    B.add('gantrySteel', M.steel, BOX, L(mat((leftX + rightX) / 2, top - 0.52, z - 0.55, span, 0.12, 0.12)));
    B.add('gantrySteel', M.steel, BOX, L(mat((leftX + rightX) / 2, top - 0.52, z + 0.55, span, 0.12, 0.12)));
    const panels = 8;
    for (let p = 0; p < panels; p++) {
      const x0 = leftX + (p / panels) * span;
      const x1 = leftX + ((p + 1) / panels) * span;
      B.add('gantrySteel', M.steel, CYL_8, L(matBetween(x0, top, z - 0.55, x1, top - 1.05, z + 0.55, 0.055)));
      B.add('gantrySteel', M.steel, CYL_8, L(matBetween(x0, top - 1.05, z - 0.55, x1, top, z + 0.55, 0.055)));
      B.add('gantrySteel', M.steel, CYL_8, L(matBetween(x0, top, z, x0, top - 1.05, z, 0.045)));
    }

    const a = this._signPanel(leftLegend, 10.3, 3.25);
    const b = this._signPanel(rightLegend, 8.2, 3.1);
    a.position.set(-(w * 0.38), 6.55, -0.58).applyMatrix4(this.basis(i, 0));
    b.position.set(w * 0.43, 6.52, -0.60).applyMatrix4(this.basis(i, 0));
    a.quaternion.setFromRotationMatrix(this.basis(i, 0));
    b.quaternion.copy(a.quaternion);
    this.group.add(a, b);
    B.add('signBack', M.signBack, BOX, L(mat(-w * 0.38, 6.55, -0.68, 10.6, 3.45, 0.12)));
    B.add('signBack', M.signBack, BOX, L(mat(w * 0.43, 6.52, -0.70, 8.5, 3.32, 0.12)));
  }

  _signPanel(legend, width, height) {
    const matl = this._highwaySignMaterial(legend);
    const geo = new THREE.PlaneGeometry(width, height);
    this.directGeometries.push(geo);
    const mesh = new THREE.Mesh(geo, matl);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.noCollide = true;
    return mesh;
  }

  _highwaySignMaterial({ tab, main, sub, shield, arrow }) {
    const cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 512;
    const ctx = cv.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#0d6b45');
    g.addColorStop(1, '#06442e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1024, 512);
    ctx.strokeStyle = '#f8fff7';
    ctx.lineWidth = 18;
    ctx.strokeRect(32, 32, 960, 448);
    ctx.fillStyle = '#f8fff7';
    ctx.font = 'bold 45px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(tab, 64, 72);
    ctx.fillStyle = '#e8f0ff';
    ctx.fillRect(64, 114, 142, 92);
    ctx.fillStyle = '#0a4fa0';
    ctx.beginPath();
    ctx.roundRect(75, 123, 120, 74, 14);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 24px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PR', 135, 146);
    ctx.font = 'bold 46px Arial, Helvetica, sans-serif';
    ctx.fillText(shield, 135, 181);
    ctx.textAlign = 'left';
    ctx.font = 'bold 91px Arial, Helvetica, sans-serif';
    ctx.fillText(main, 238, 177);
    ctx.font = 'bold 47px Arial, Helvetica, sans-serif';
    ctx.fillText(sub, 80, 292);
    ctx.font = 'bold 112px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(arrow, 512, 405);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(48, 44, 928, 44);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 16;
    this.directTextures.push(tex);
    const m = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.42, metalness: 0.05, side: THREE.DoubleSide, emissive: 0x0b2f20, emissiveIntensity: 0.03,
    });
    this.directMaterials.push(m);
    return m;
  }

  /* ---------------------------- lighting ---------------------------- */
  _placeLighting() {
    const step = this.sampleStep(this.profile.lamp);
    let flip = 0;
    for (let i = 0; i < this.track.n; i += step) {
      this._lightMast(i, -1);
      if (flip++ % 2 === 0 || quality.tier === 'high') this._lightMast(i + Math.floor(step / 2), 1);
    }
  }

  _lightMast(i, side) {
    i = this.track.sampleAt(i);
    const w = this.track.width[i];
    const lat = side < 0 ? -(w + 5.1) : w + 6.2;
    const L = this.local(i, lat, 0);
    const M = this.M;
    const inward = -side;
    const h = side < 0 ? 12.8 : 10.8;
    this.b.add('lampPole', M.galvanized, POLE, L(mat(0, h / 2, 0, 0.19, h, 0.19)));
    this.b.add('lampPole', M.galvanized, CYL, L(mat(0, 0.22, 0, 0.55, 0.44, 0.55)));
    const pts = [
      [0, h - 0.12, 0],
      [inward * 1.8, h + 0.28, 0],
      [inward * 4.3, h - 0.18, 0],
      [inward * 5.65, h - 0.92, 0],
    ];
    for (let p = 0; p < pts.length - 1; p++) {
      const a = pts[p], b = pts[p + 1];
      this.b.add('lampPole', M.galvanized, CYL_8, L(matBetween(a[0], a[1], a[2], b[0], b[1], b[2], p ? 0.07 : 0.09)));
    }
    this.b.add('lampPole', M.galvanized, CYL_8, L(matBetween(inward * 1.1, h - 0.45, 0, inward * 4.1, h - 0.28, 0, 0.035)));
    this.b.add('lampHead', M.darkSteel, SPH_LO, L(mat(inward * 5.95, h - 1.06, 0, 0.92, 0.28, 0.46)));
    this.b.add('lampHead', M.darkSteel, BOX, L(mat(inward * 5.58, h - 1.03, 0, 0.76, 0.18, 0.42, 0, 0, inward * 0.16)));
    this.bNoShadow.add('lampGlow', M.lamp, SPH_LO, L(mat(inward * 6.12, h - 1.24, 0, 0.52, 0.18, 0.28)));
  }

  /* ---------------------------- viaduct ----------------------------- */
  _buildViaduct() {
    this._viaductDeck();
    const step = this.sampleStep(31);
    for (let i = 0; i < this.track.n; i += step) {
      if (this.track.kind[i] === 4 && Math.abs(this.track.curvature[i]) < 0.035) this._viaductPier(i);
    }
  }

  _viaductDeck() {
    const t = this.track;
    const rows = [];
    const step = this.sampleStep(3.2);
    for (let i = 0; i < t.n; i += step) rows.push(i);

    const flush = (run) => {
      if (run.length < 2) return;
      const verts = [], uvs = [], idx = [];
      const P = new THREE.Vector3(), R = new THREE.Vector3();
      for (const i of run) {
        t.getPos(i, P);
        t.getRight(i, R);
        const tan = t.getTangent(i, new THREE.Vector3());
        tan.y = 0; tan.normalize();
        const right = new THREE.Vector3(-tan.z, 0, tan.x);
        const w = t.width[i];
        const prof = [
          [-w - 3.0, -0.62], [w + 3.0, -0.62], [w + 2.55, -1.55],
          [w + 1.8, -2.25], [-w - 1.8, -2.25], [-w - 2.55, -1.55], [-w - 3.0, -0.62],
        ];
        for (const [lat, y] of prof) {
          verts.push(P.x + right.x * lat, P.y + y, P.z + right.z * lat);
          uvs.push(lat / 8, t.dist[i] / 8);
        }
      }
      const cols = 7;
      for (let r = 0; r < run.length - 1; r++) {
        for (let c = 0; c < cols - 1; c++) {
          const a = r * cols + c, b = a + 1, cc = (r + 1) * cols + c, d = cc + 1;
          idx.push(a, cc, b, b, cc, d);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, this.M.concrete);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    };

    let run = [];
    for (const i of rows) {
      if (t.kind[i] === 4) run.push(i);
      else { flush(run); run = []; }
    }
    flush(run);

    this._viaductParapet(1);
    this._viaductParapet(-1);
  }

  _viaductParapet(side) {
    const t = this.track;
    const step = this.sampleStep(4.0);
    let run = [];
    const flush = () => {
      if (run.length < 2) { run = []; return; }
      const verts = [], uvs = [], idx = [];
      for (const i of run) {
        const P = t.getPos(i, new THREE.Vector3());
        const tan = t.getTangent(i, new THREE.Vector3());
        tan.y = 0; tan.normalize();
        const R = new THREE.Vector3(-tan.z, 0, tan.x);
        const lat = side * (t.width[i] + (side > 0 ? 4.35 : 3.35));
        for (const y of [0.0, 1.05]) {
          verts.push(P.x + R.x * lat, P.y + y, P.z + R.z * lat);
          uvs.push(y, t.dist[i] / 5);
        }
      }
      for (let r = 0; r < run.length - 1; r++) {
        const a = r * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.push(a, c, b, b, c, d);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, this.M.concreteWarm);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      run = [];
    };
    for (let i = 0; i < t.n; i += step) {
      if (t.kind[i] === 4) run.push(i);
      else flush();
    }
    flush();
  }

  _viaductPier(i) {
    const L = this.local(i, 0, 0);
    const P = this.track.getPos(i, new THREE.Vector3());
    const groundRel = -Math.min(18.5, Math.max(5.5, P.y - 1.6 + this.r(-1.2, 1.0)));
    const top = -2.55;
    const h = Math.max(2.0, top - groundRel);
    this.b.add('pierCap', this.M.concrete, BOX, L(mat(0, top + 0.45, 0, 17.0, 0.9, 3.2)), [2.5, 1]);
    for (const x of [-4.9, 4.9]) {
      this.b.add('pier', this.M.concrete, CYL_HI, L(mat(x, groundRel + h / 2, 0, 0.9, h, 0.9)), [1, h / 4]);
      this.b.add('pier', this.M.concrete, BOX, L(mat(x, groundRel + 0.15, 0, 2.4, 0.3, 2.4)), [1, 1]);
    }
  }

  /* --------------------------- skyline ------------------------------ */
  _placeSkyline() {
    const t = this.track;
    const anchor = Math.floor(t.n * 0.39);
    const side = 1;
    const towers = this.profile.skyline;
    for (let k = 0; k < towers; k++) {
      const i = t.sampleAt(anchor + this.sampleStep(this.r(-105, 105)));
      const lat = side * (95 + this.r(0, 165));
      const along = this.r(-115, 115);
      const base = this.basis(i, lat, 0).multiply(mat(0, 0, along, 1, 1, 1));
      const w = this.r(11, 24), d = this.r(12, 30);
      const h = this.r(42, quality.tier === 'high' ? 122 : 88);
      this._tower(base, w, d, h, k);
    }
    this._flagshipBankTower(this.basis(anchor, side * 128, 0).multiply(mat(0, 0, -38, 1, 1, 1)));

    // A few low podium slabs knit the towers into a recognizable district.
    for (let k = 0; k < 7; k++) {
      const i = t.sampleAt(anchor + this.sampleStep(this.r(-90, 90)));
      const L = (m) => this.basis(i, side * (75 + this.r(30, 135)), 0).multiply(mat(0, 0, this.r(-130, 130), 1, 1, 1)).multiply(m);
      const w = this.r(22, 46), d = this.r(20, 42), h = this.r(8, 18);
      this.b.add(k % 2 ? 'warehouseA' : 'warehouseB', k % 2 ? this.M.warehouseA : this.M.warehouseB,
        BOX, L(mat(0, h / 2, 0, w, h, d)), [w / 8, h / 5]);
      this.b.add('roof', this.M.roof, BOX, L(mat(0, h + 0.35, 0, w + 1, 0.7, d + 1)));
    }
  }

  _flagshipBankTower(base) {
    const M = this.M, B = this.b;
    const L = (m) => base.clone().multiply(new THREE.Matrix4().makeRotationY(-0.08)).multiply(m);
    const h = quality.tier === 'low' ? 82 : 116;
    B.add('towerGlassB', M.glassBlue, BOX, L(mat(0, h / 2, 0, 26, h, 22)), [3, h / 11]);
    B.add('towerTrim', M.concreteWarm, BOX, L(mat(-7.5, h * 0.42, 0, 12, h * 0.84, 24.2)), [2, h / 12]);
    B.add('towerGlassB', M.glassBlue, BOX, L(mat(4, h + 10, 0, 18, 20, 18)), [2, 2]);
    B.add('towerGlassB', M.glassBlue, BOX, L(mat(8, h + 24, 0, 12, 8, 14)), [2, 1]);
    B.add('roof', M.roof, BOX, L(mat(0, h + 0.7, 0, 27.5, 1.4, 23.5)));
    for (let f = 1; f < 15; f++) {
      const y = (f / 15) * h;
      B.add('towerTrim', M.concreteWarm, BOX, L(mat(0, y, 11.2, 27.0, 0.16, 0.35)));
      B.add('towerTrim', M.concreteWarm, BOX, L(mat(0, y, -11.2, 27.0, 0.16, 0.35)));
    }
    B.add('antenna', M.darkSteel, CYL_8, L(mat(8, h + 35, 0, 0.12, 20, 0.12)));
    this.bNoShadow.add('warningLight', M.amber, SPH_LO, L(mat(8, h + 45.5, 0, 0.42, 0.42, 0.42)));
  }

  _tower(base, w, d, h, k) {
    const L = (m) => base.clone().multiply(new THREE.Matrix4().makeRotationY(this.r(-0.18, 0.18))).multiply(m);
    const glass = k % 3 === 0 ? this.M.glassBlue : this.M.glass;
    const key = k % 3 === 0 ? 'towerGlassB' : 'towerGlass';
    this.b.add(key, glass, BOX, L(mat(0, h / 2, 0, w, h, d)), [w / 10, h / 13]);
    if (this.rnd() > 0.35) {
      this.b.add(key, glass, BOX, L(mat(w * 0.18, h + h * 0.13, -d * 0.12, w * 0.62, h * 0.26, d * 0.76)), [w / 10, h / 20]);
    }
    const bands = Math.min(13, Math.floor(h / 8));
    for (let f = 1; f < bands; f++) {
      const y = (f / bands) * h;
      this.b.add('towerTrim', this.M.concreteWarm, BOX, L(mat(0, y, d / 2 + 0.08, w + 0.2, 0.18, 0.22)));
      this.b.add('towerTrim', this.M.concreteWarm, BOX, L(mat(0, y, -d / 2 - 0.08, w + 0.2, 0.18, 0.22)));
    }
    this.b.add('roof', this.M.roof, BOX, L(mat(0, h + 0.4, 0, w + 0.8, 0.8, d + 0.8)));
    for (let p = 0; p < this.ri(2, 5); p++) {
      this.b.add('roof', this.M.roof, BOX, L(mat(this.r(-w * 0.34, w * 0.34), h + 1.1, this.r(-d * 0.32, d * 0.32), this.r(1.2, 3.2), this.r(1, 2.4), this.r(1.2, 3.6))));
    }
    if (h > 72) {
      this.b.add('antenna', this.M.darkSteel, CYL_8, L(mat(0, h + 5, 0, 0.09, 8.5, 0.09)));
      this.bNoShadow.add('warningLight', this.M.amber, SPH_LO, L(mat(0, h + 9.6, 0, 0.34, 0.34, 0.34)));
    }
  }

  /* ---------------------- roadside buildings ------------------------ */
  _placeRoadsideBuildings() {
    const t = this.track;
    const step = this.sampleStep(this.profile.buildings);
    for (let i = 0; i < t.n; i += step) {
      if (t.kind[i] !== 3 || Math.abs(t.curvature[i]) > 0.045) continue;
      for (const side of [-1, 1]) {
        if (this.rnd() > 0.62) continue;
        const lat = this.roomLat(i, side * (t.width[i] + this.r(28, 62)), 17.0);
        if (lat === null) continue;
        const L = this.facing(i, lat, 0);
        if (this.rnd() > 0.46) this._walkupBlock(L, side, i);
        else this._warehouse(L, i);
      }
    }
  }

  _warehouse(L, i) {
    const M = this.M;
    const w = this.r(18, 34), d = this.r(15, 28), h = this.r(5.0, 9.0);
    const matl = i % 2 ? M.warehouseA : M.warehouseB;
    const key = i % 2 ? 'warehouseA' : 'warehouseB';
    this.b.add(key, matl, BOX, L(mat(0, h / 2, -d / 2, w, h, d)), [w / 8, h / 4]);
    this.b.add('roof', M.roof, BOX, L(mat(0, h + 0.35, -d / 2, w + 0.8, 0.7, d + 0.8)));
    const bays = Math.max(2, Math.floor(w / 8));
    for (let k = 0; k < bays; k++) {
      const x = -w / 2 + (k + 0.5) * (w / bays);
      this.b.add('rollDoor', M.reveal, BOX, L(mat(x, 1.8, 0.08, w / bays * 0.52, 3.4, 0.18)));
      this.b.add('warehouseTrim', M.concreteWarm, BOX, L(mat(x, 3.7, 0.16, w / bays * 0.58, 0.22, 0.2)));
    }
    if (this.rnd() > 0.55) this._smallMural(L, w, h);
  }

  _walkupBlock(L, side, i) {
    const M = this.M;
    const w = this.r(13, 24), d = this.r(10, 18);
    const floors = this.ri(3, 5);
    const fh = 3.2;
    const h = floors * fh;
    const matl = i % 2 ? M.warehouseB : M.concreteWarm;
    const key = i % 2 ? 'warehouseB' : 'concreteWarm';
    this.b.add(key, matl, BOX, L(mat(0, h / 2, -d / 2, w, h, d)), [w / 7, h / 5]);
    this.b.add('roof', M.roof, BOX, L(mat(0, h + 0.35, -d / 2, w + 0.6, 0.7, d + 0.6)));
    const bays = Math.max(3, Math.floor(w / 4.6));
    for (let f = 0; f < floors; f++) {
      for (let b = 0; b < bays; b++) {
        const x = -w / 2 + (b + 0.5) * (w / bays);
        const y = f * fh + 1.65;
        this.b.add('aptReveal', M.reveal, BOX, L(mat(x, y, 0.08, 1.55, 1.35, 0.15)));
        this.b.add('aptGlass', M.glass, BOX, L(mat(x, y, 0.17, 1.35, 1.1, 0.08)));
        if (f > 0 && this.rnd() > 0.45) {
          this.b.add('balcony', M.darkSteel, BOX, L(mat(x, y - 0.92, 0.72, 2.0, 0.08, 0.9)));
          this.b.add('balcony', M.darkSteel, BOX, L(mat(x, y - 0.42, 1.12, 2.0, 0.08, 0.08)));
          for (let r = 0; r < 5; r++) this.b.add('balcony', M.darkSteel, CYL_8, L(mat(x - 0.8 + r * 0.4, y - 0.65, 1.12, 0.025, 0.55, 0.025)));
        }
      }
      this.b.add('warehouseTrim', M.concreteWarm, BOX, L(mat(0, f * fh, 0.08, w + 0.15, 0.18, 0.2)));
    }
    this.b.add('aptStair', M.darkSteel, BOX, L(mat(side * w * 0.42, h / 2, -d - 0.45, 1.4, h, 1.0)));
  }

  _smallMural(L, w, h) {
    const colors = [0x2d8cff, 0xf4c542, 0xe64526, 0x2aaf5f];
    for (let k = 0; k < 5; k++) {
      const m = new THREE.MeshStandardMaterial({ color: colors[k % colors.length], roughness: 0.86 });
      this.directMaterials.push(m);
      this.bNoShadow.add('mural' + k, m, BOX, L(mat(-w * 0.38 + k * w * 0.18, h * 0.52 + Math.sin(k) * 0.4, 0.21, w * 0.16, 1.1, 0.08)));
    }
  }

  /* -------------------------- vegetation ---------------------------- */
  _placeVegetation() {
    const t = this.track;
    const step = this.sampleStep(this.profile.trees);
    for (let i = 0; i < t.n; i += step) {
      if (t.kind[i] === 4 && this.rnd() > 0.25) continue;
      for (const side of [-1, 1]) {
        if (this.rnd() > 0.58) continue;
        const lat = this.roomLat(i, side * (t.width[i] + this.r(8.0, 20.0)), 6.0);
        if (lat === null) continue;
        const p = t.pointAt(i, lat, new THREE.Vector3());
        const over = Math.max(0, Math.abs(lat) - t.width[i]);
        p.y -= Math.min(over * 0.14, 2.2);
        if (this.rnd() > 0.38) this._palm(p, this.r(0, Math.PI * 2));
        else this._flamboyan(p, this.r(0, Math.PI * 2));
      }
    }
  }

  _placeVergeDressing() {
    const t = this.track;
    const step = this.sampleStep(this.profile.verge);
    for (let i = this.sampleStep(20); i < t.n; i += step) {
      if (this.rnd() > 0.78) continue;
      for (const side of [-1, 1]) {
        if (this.rnd() > (t.kind[i] === 4 ? 0.38 : 0.68)) continue;
        const clumps = quality.tier === 'low' ? this.ri(2, 4) : this.ri(4, 8);
        for (let c = 0; c < clumps; c++) {
          const ii = t.sampleAt(i + this.sampleStep(this.r(-24, 24)));
          const lat = this.roomLat(ii, side * (t.width[ii] + this.r(5.3, 18.5)), 1.5);
          if (lat === null) continue;
          const L = this.local(ii, lat, 0.02);
          if (this.rnd() < 0.36) {
            this.bNoShadow.add('dirtPatch', this.M.dirt, PLANE,
              L(mat(0, 0.015, 0, this.r(2.5, 8.0), this.r(1.5, 5.0), 1, -Math.PI / 2, this.r(0, Math.PI), 0)));
          } else if (this.rnd() < 0.72) {
            const blades = quality.tier === 'low' ? 2 : 4;
            for (let b = 0; b < blades; b++) {
              this.bNoShadow.add('dryGrass', b % 2 ? this.M.scrub : this.M.dryGrass, CONE,
                L(mat(this.r(-1.2, 1.2), 0.28, this.r(-1.1, 1.1), this.r(0.28, 0.55), this.r(0.55, 1.15), this.r(0.28, 0.55), this.r(-0.25, 0.25), this.r(0, Math.PI), this.r(-0.25, 0.25))));
            }
          } else {
            this.bNoShadow.add('rock', this.M.rock, SPH_LO,
              L(mat(0, 0.18, 0, this.r(0.45, 1.2), this.r(0.16, 0.45), this.r(0.35, 1.1), 0, this.r(0, Math.PI), 0)));
          }
        }
      }
    }
  }

  _palm(pos, yaw) {
    // Fronds spread ~4 m, so the trunk needs that much verge to itself.
    if (this.roadClearance(pos) < 4.5) return;
    const H = this.r(7.5, 13.5);
    const L = (m) => new THREE.Matrix4().compose(
      pos.clone(), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1)
    ).multiply(m);
    for (let s = 0; s < 7; s++) {
      const f = s / 7;
      this.b.add('palmTrunk', this.M.palmTrunk, CYL_8, L(mat(0, f * H + H / 14, Math.sin(f * 1.8) * 0.18, 0.32 * (1 - f * 0.45), H / 7, 0.32 * (1 - f * 0.45), 0.04 * f, 0, 0.08 * f)));
    }
    this.b.add('palmTrunk', this.M.palmTrunk, SPH_LO, L(mat(0, H + 0.15, 0.22, 0.55, 0.45, 0.55)));
    const fronds = quality.tier === 'low' ? 7 : 10;
    for (let k = 0; k < fronds; k++) {
      const g = makeFrond(this.r(3.0, 4.8), this.r(0.45, 0.75), this.r(0.7, 1.2));
      this.bNoShadow.add('frond', this.M.frond, g, L(mat(0, H + 0.35, 0.22, 1, 1, 1, 0, (k / fronds) * Math.PI * 2, 0)));
    }
  }

  _flamboyan(pos, yaw) {
    // A mature flamboyán canopy is broader than a palm's crown.
    if (this.roadClearance(pos) < 6.0) return;
    const H = this.r(5.5, 8.0);
    const L = (m) => new THREE.Matrix4().compose(
      pos.clone(), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1)
    ).multiply(m);
    this.b.add('palmTrunk', this.M.palmTrunk, TAPER_CYL, L(mat(0, H / 2, 0, 0.46, H, 0.46)));
    const limbs = quality.tier === 'low' ? 4 : 6;
    for (let k = 0; k < limbs; k++) {
      const a = (k / limbs) * Math.PI * 2 + this.r(-0.25, 0.25);
      const x = Math.sin(a) * this.r(1.0, 2.3);
      const z = Math.cos(a) * this.r(1.0, 2.2);
      this.b.add('palmTrunk', this.M.palmTrunk, CYL_8,
        L(matBetween(0, H * this.r(0.55, 0.72), 0, x, H * this.r(0.80, 0.94), z, this.r(0.09, 0.16))));
    }
    const mats = [this.M.flamboyan, this.M.flamboyanOrange, this.M.flamboyan, this.M.canopy];
    const blobs = quality.tier === 'low' ? 7 : quality.tier === 'mid' ? 11 : 15;
    this.b.add('flamboyan', this.M.flamboyan, SPH,
      L(mat(0, H + 0.25, 0, 3.0, 0.9, 2.6, 0, this.r(0, Math.PI), 0)));
    for (let k = 0; k < blobs; k++) {
      const ring = k < blobs * 0.55 ? 1 : 1.45;
      const a = (k / blobs) * Math.PI * 2 + this.r(-0.35, 0.35);
      const matl = mats[k % mats.length];
      const key = matl === this.M.canopy ? 'canopy' : (matl === this.M.flamboyanOrange ? 'flamboyanOrange' : 'flamboyan');
      this.b.add(key, matl, SPH,
        L(mat(Math.sin(a) * this.r(1.1, 3.2) * ring, H + this.r(-0.45, 1.05), Math.cos(a) * this.r(1.0, 3.0) * ring,
          this.r(1.6, 3.0), this.r(0.42, 0.88), this.r(1.5, 2.8), this.r(-0.08, 0.08), this.r(0, Math.PI), this.r(-0.08, 0.08))));
    }
  }

  /* ------------------------- fences, signs -------------------------- */
  _placeFences() {
    const t = this.track;
    const step = this.sampleStep(this.profile.fence);
    // A fence run used to be one rigid chord up to 54 m long. Across a 15 m
    // U-turn that chord sagged ~24 m off the arc and swept straight over the
    // carriageway, which is where most of the clearance intrusions came from.
    // Emitting it as short panels, each in its own frame, makes it follow the
    // road for the same triangle budget.
    const SEG = 6;
    const segStep = this.sampleStep(SEG);
    for (let i = 0; i < t.n; i += step) {
      if (this.rnd() > 0.72) continue;
      for (const side of [1, -1]) {
        const span = this.r(28, 54);
        const panels = Math.max(2, Math.round(span / SEG));
        const offset = side > 0 ? 8.0 : 7.0;
        for (let s = 0; s < panels; s++) {
          const ii = t.sampleAt(i + Math.round((s - panels / 2) * segStep));
          const lat = this.roomLat(ii, side * (t.width[ii] + offset), 0.4);
          if (lat === null) continue;
          const L = this.local(ii, lat, this.groundLift(ii, lat));
          this.bNoShadow.add('fence', this.M.fence, FENCE, L(mat(0, 1.45, 0, SEG, 1, 1, 0, Math.PI / 2, 0)), [SEG / 5, 1]);
          this.b.add('fencePost', this.M.galvanized, CYL_8, L(mat(0, 1.35, -SEG / 2, 0.055, 2.7, 0.055)));
        }
      }
    }
  }

  _placeBillboards() {
    const step = this.sampleStep(210);
    let k = 0;
    for (let i = this.sampleStep(120); i < this.track.n; i += step) {
      const side = this.rnd() > 0.35 ? 1 : -1;
      this._billboard(i, side, BILLBOARDS[k++ % BILLBOARDS.length]);
    }
  }

  _billboard(i, side, lines) {
    const w = this.track.width[i];
    // A 12 m hoarding needs the room checked, not just the post position.
    const lat = this.roomLat(i, side * (w + this.r(16, 28)), 7.0);
    if (lat === null) return;
    const L = this.facing(i, lat, 0);
    const panel = this._billboardMesh(lines, 12.0, 5.2);
    const base = this.facing(i, lat, 0);
    panel.position.setFromMatrixPosition(base(mat(0, 7.2, 0, 1, 1, 1)));
    panel.quaternion.setFromRotationMatrix(base(mat(0, 0, 0, 1, 1, 1)));
    this.group.add(panel);
    this.b.add('billboardBack', this.M.signBack, BOX, L(mat(0, 7.2, -0.08, 12.4, 5.6, 0.15)));
    for (const x of [-4.2, 4.2]) this.b.add('billboardPost', this.M.galvanized, CYL, L(mat(x, 3.4, -0.35, 0.16, 6.8, 0.16)));
  }

  _billboardMesh([headline, sub], w, h) {
    const cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 512;
    const ctx = cv.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 1024, 512);
    grad.addColorStop(0, '#ffe37a');
    grad.addColorStop(0.48, '#ff7e4f');
    grad.addColorStop(1, '#345ab8');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1024, 512);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillRect(42, 42, 940, 428);
    ctx.fillStyle = '#14233c';
    ctx.font = 'bold 120px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(headline, 512, 218);
    ctx.font = 'bold 52px Arial, Helvetica, sans-serif';
    ctx.fillStyle = '#22583d';
    ctx.fillText(sub, 512, 330);
    ctx.fillStyle = 'rgba(20,35,60,0.16)';
    for (let i = 0; i < 80; i++) ctx.fillRect(this.r(0, 1024), this.r(0, 512), this.r(4, 18), this.r(2, 8));
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    this.directTextures.push(tex);
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.72, metalness: 0.0, side: THREE.DoubleSide });
    this.directMaterials.push(m);
    const geo = new THREE.PlaneGeometry(w, h);
    this.directGeometries.push(geo);
    return new THREE.Mesh(geo, m);
  }

  _placeMarkersAndDrainage() {
    const t = this.track;
    const markerStep = this.sampleStep(165);
    let km = 0;
    for (let i = markerStep; i < t.n; i += markerStep) {
      const L = this.facing(i, t.width[i] + 4.8, 0);
      const panel = this._markerMesh(`KM ${km++}`);
      panel.position.setFromMatrixPosition(L(mat(0, 1.15, 0, 1, 1, 1)));
      panel.quaternion.setFromRotationMatrix(L(mat(0, 0, 0, 1, 1, 1)));
      this.group.add(panel);
      this.b.add('markerPost', this.M.signPost, CYL_8, L(mat(0, 0.55, -0.04, 0.045, 1.1, 0.045)));
    }

    const grateStep = this.sampleStep(44);
    for (let i = 0; i < t.n; i += grateStep) {
      const side = i % 2 ? 1 : -1;
      const L = this.local(i, side * (t.width[i] + 4.6), 0.04);
      this.bNoShadow.add('grate', this.M.grate, BOX, L(mat(0, 0.02, 0, 1.35, 0.05, 0.58)));
      for (let k = -2; k <= 2; k++) this.bNoShadow.add('grate', this.M.galvanized, BOX, L(mat(k * 0.25, 0.07, 0, 0.035, 0.04, 0.62)));
    }
  }

  _markerMesh(text) {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 128;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#f4f7ee';
    ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = '#1a6b44';
    ctx.lineWidth = 10;
    ctx.strokeRect(8, 8, 240, 112);
    ctx.fillStyle = '#1a6b44';
    ctx.font = 'bold 48px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 68);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.directTextures.push(tex);
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.68, side: THREE.DoubleSide });
    this.directMaterials.push(m);
    const geo = new THREE.PlaneGeometry(1.25, 0.62);
    this.directGeometries.push(geo);
    return new THREE.Mesh(geo, m);
  }

  /* ------------------------- overpasses ----------------------------- */
  _placeOverpasses() {
    const fracs = [0.16, 0.31, 0.63, 0.78].slice(0, this.profile.overpasses);
    for (const f of fracs) this._overpass(Math.floor(f * this.track.n));
  }

  _overpass(i) {
    const w = this.track.width[i];
    const L = this.local(i, 0, 0);
    const span = w * 2 + 25;
    this.b.add('overpass', this.M.concrete, BOX, L(mat(0, 7.2, 0, span, 1.1, 9.5)), [span / 8, 1]);
    this.b.add('overpass', this.M.concreteWarm, BOX, L(mat(0, 8.25, 4.55, span, 1.0, 0.7)), [span / 8, 1]);
    this.b.add('overpass', this.M.concreteWarm, BOX, L(mat(0, 8.25, -4.55, span, 1.0, 0.7)), [span / 8, 1]);
    for (const x of [-(w + 8.0), w + 8.0]) {
      for (const z of [-3.2, 3.2]) this.b.add('overpassPier', this.M.concrete, CYL_HI, L(mat(x, 3.25, z, 0.55, 6.5, 0.55)), [1, 1.5]);
      this.b.add('overpassCap', this.M.concrete, BOX, L(mat(x, 6.5, 0, 3.2, 0.8, 8.4)), [1, 1]);
    }
  }

  _placeBarrierEnds() {
    const step = this.sampleStep(520);
    for (let i = this.sampleStep(95); i < this.track.n; i += step) {
      const w = this.track.width[i];
      const L = this.local(i, -(w + 3.1), 0);
      for (let k = 0; k < 4; k++) {
        this.b.add(k % 2 ? 'crashBlack' : 'crashYellow', k % 2 ? this.M.black : this.M.yellow,
          BOX, L(mat(0, 0.45, -1.6 + k * 0.95, 1.25 - k * 0.18, 0.9, 0.75)));
      }
    }
  }

  dispose() {
    if (this.scene && this.group.parent === this.scene) this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        for (const key of ['map', 'normalMap', 'roughnessMap', 'alphaMap', 'emissiveMap']) m[key]?.dispose?.();
        m.dispose?.();
      }
    });
    for (const g of this.directGeometries) g.dispose?.();
    for (const t of this.directTextures) t.dispose?.();
    for (const m of this.directMaterials) m.dispose?.();
    for (const m of Object.values(this.M)) {
      if (!m?.isMaterial) continue;
      for (const key of ['map', 'normalMap', 'roughnessMap', 'alphaMap', 'emissiveMap']) m[key]?.dispose?.();
      m.dispose?.();
    }
  }
}

function makeFrond(len, width, droop) {
  const segs = 6;
  const verts = [], uvs = [], idx = [];
  verts.push(0, 0, 0); uvs.push(0.5, 0);
  for (let s = 1; s <= segs; s++) {
    const f = s / segs;
    const z = f * len;
    const y = -Math.pow(f, 1.7) * droop;
    const w = Math.sin(f * Math.PI) * width * (1 - f * 0.2);
    verts.push(-w, y, z, w, y, z);
    uvs.push(0, f, 1, f);
  }
  idx.push(0, 1, 2);
  for (let s = 1; s < segs; s++) {
    const a = 1 + (s - 1) * 2;
    const b = a + 2;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
