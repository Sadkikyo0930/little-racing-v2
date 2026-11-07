import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  stuccoTextures, roofTileTextures, murallaTextures, woodTextures, mulberry32, leafTexture,
} from './textures.js';

/* ------------------------------------------------------------------ *
 * Old San Juan, procedurally built.
 *
 * Everything is generated into per-material geometry buckets and merged,
 * so the entire historic quarter — hundreds of buildings, balconies,
 * garitas, palms and lamps — costs roughly twenty draw calls.
 * ------------------------------------------------------------------ */

// The real palette of the Calle Fortaleza / San Sebastián facades.
const FACADE_COLORS = [
  0xe8586b, 0xf2a03d, 0x63c2d4, 0xf4d64a, 0x7fbf6a, 0xd97ab0,
  0x4a86c8, 0xf0e6d2, 0xe8845c, 0x9b8ec4, 0x5fb89b, 0xd94f3d,
  0xf7b7c2, 0xbfd8a0, 0xffcf8a, 0x8fd0e8,
];

export class Bucket {
  constructor() {
    this.map = new Map();
  }
  add(key, mat, geo, matrix, uvScale = 0) {
    let e = this.map.get(key);
    if (!e) this.map.set(key, (e = { mat, geos: [] }));
    const g = geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    // merging requires a consistent attribute set
    if (!g.getAttribute('uv')) {
      const count = g.getAttribute('position').count;
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
    }
    // large masses need their UVs stretched or the texture smears
    if (uvScale) {
      const uv = g.getAttribute('uv');
      const su = Array.isArray(uvScale) ? uvScale[0] : uvScale;
      const sv = Array.isArray(uvScale) ? uvScale[1] : uvScale;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    }
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    }
    // Icosahedron/Extrude geometries arrive non-indexed; merging demands
    // that every source agrees, so give them a trivial index.
    if (!g.getIndex()) {
      const count = g.getAttribute('position').count;
      const arr = count > 65535 ? new Uint32Array(count) : new Uint16Array(count);
      for (let i = 0; i < count; i++) arr[i] = i;
      g.setIndex(new THREE.BufferAttribute(arr, 1));
    }
    e.geos.push(g);
  }
  build(parent, { cast = true, receive = true } = {}) {
    for (const [key, e] of this.map) {
      if (!e.geos.length) continue;

      /* Merging a whole material into one mesh makes it un-cullable: the
       * facades alone were a single 1.1M-triangle draw that ran every frame
       * no matter where the camera pointed. Splitting each material into
       * CHUNK-sized spatial tiles lets the frustum throw away everything
       * behind you. Light buckets stay whole — tiling them would cost more
       * in draw calls than it ever saves in vertices. */
      let tris = 0;
      for (const g of e.geos) tris += (g.getIndex()?.count ?? g.getAttribute('position').count) / 3;

      const tiles = new Map();
      for (const g of e.geos) {
        let key = '0';
        if (tris > Bucket.TILE_MIN_TRIS) {
          g.computeBoundingSphere();
          const c = g.boundingSphere.center;
          key = `${Math.floor(c.x / Bucket.CHUNK)},${Math.floor(c.z / Bucket.CHUNK)}`;
        }
        if (!tiles.has(key)) tiles.set(key, []);
        tiles.get(key).push(g);
      }

      const kept = new Set();
      for (const [, geos] of tiles) {
        let merged;
        if (geos.length === 1) { merged = geos[0]; kept.add(merged); }
        else merged = BufferGeometryUtils.mergeGeometries(geos, false);
        if (!merged) continue;
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, e.mat);
        // Carrying the bucket key onto the mesh costs nothing and makes both
        // the clearance blame report and renderer profiling legible.
        mesh.name = key;
        mesh.castShadow = cast;
        mesh.receiveShadow = receive;
        parent.add(mesh);
      }
      for (const g of e.geos) if (!kept.has(g)) g.dispose();
      e.geos.length = 0;
    }
  }
}
// Roughly one city block. Small enough to cull usefully, large enough that
// the draw-call count stays sane.
Bucket.CHUNK = 90;
// Below this a material is cheaper as one un-cullable draw than as many.
Bucket.TILE_MIN_TRIS = 60000;

/* ------------------------------ materials ---------------------------- */
function makeMaterials() {
  const stucco = FACADE_COLORS.map((c, i) => {
    const t = stuccoTextures(c, 512, 3 + i);
    t.map.repeat.set(1, 1);
    return new THREE.MeshStandardMaterial({
      map: t.map, normalMap: t.normalMap,
      roughness: 0.88, metalness: 0.0, envMapIntensity: 0.8,
      normalScale: new THREE.Vector2(0.8, 0.8),
    });
  });

  const tile = roofTileTextures(512);
  const stone = murallaTextures(1024);
  const woodDark = woodTextures('#22432f', 512);
  const woodWarm = woodTextures('#6b3d22', 512);

  return {
    stucco,
    roof: new THREE.MeshStandardMaterial({
      map: tile.map, normalMap: tile.normalMap, roughness: 0.86, metalness: 0, envMapIntensity: 0.7,
    }),
    stone: new THREE.MeshStandardMaterial({
      map: stone.map, normalMap: stone.normalMap, roughness: 0.93, metalness: 0, envMapIntensity: 0.7,
    }),
    trim: new THREE.MeshStandardMaterial({ color: 0xe6dcc6, roughness: 0.82, metalness: 0 }),
    reveal: new THREE.MeshStandardMaterial({ color: 0x120f0c, roughness: 0.95, metalness: 0 }),
    cable: new THREE.MeshStandardMaterial({ color: 0x3a352e, roughness: 0.8, metalness: 0.3 }),
    shutter: new THREE.MeshStandardMaterial({
      map: woodDark.map, normalMap: woodDark.normalMap, roughness: 0.62, metalness: 0,
    }),
    doorWood: new THREE.MeshStandardMaterial({
      map: woodWarm.map, normalMap: woodWarm.normalMap, roughness: 0.6, metalness: 0,
    }),
    iron: new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.42, metalness: 0.85, envMapIntensity: 1.2 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x0d1622, roughness: 0.08, metalness: 0.2, envMapIntensity: 2.2,
      transparent: true, opacity: 0.86,
    }),
    brass: new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.28, metalness: 1.0, envMapIntensity: 1.6 }),
    palmTrunk: new THREE.MeshStandardMaterial({ color: 0x8a7256, roughness: 0.9 }),
    frond: new THREE.MeshStandardMaterial({ color: 0x3f7f33, roughness: 0.7, side: THREE.DoubleSide }),
    canopy: new THREE.MeshStandardMaterial({ color: 0x2f6b30, roughness: 0.85, flatShading: true }),
    flamboyan: new THREE.MeshStandardMaterial({ color: 0xe8452b, roughness: 0.8, flatShading: true }),
    bougainvillea: new THREE.MeshStandardMaterial({ color: 0xd6408f, roughness: 0.8, flatShading: true }),
    lamp: new THREE.MeshStandardMaterial({
      color: 0xfff0c0, emissive: 0xffca6a, emissiveIntensity: 2.2, roughness: 0.4,
    }),
    fabric: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide }),
    water: new THREE.MeshPhysicalMaterial({
      color: 0x2f8fb0, roughness: 0.08, metalness: 0, transmission: 0.6,
      thickness: 0.6, transparent: true, opacity: 0.8, envMapIntensity: 1.6,
    }),
    sand: new THREE.MeshStandardMaterial({ color: 0xd8c9a3, roughness: 0.98 }),
  };
}

/* ----------------------------- primitives ---------------------------- */
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 14);
const CYL_HI = new THREE.CylinderGeometry(1, 1, 1, 24);
const SPH = new THREE.IcosahedronGeometry(1, 1);
const SPH_HI = new THREE.SphereGeometry(1, 16, 12);
const CONE = new THREE.ConeGeometry(1, 1, 16);
const TORUS = new THREE.TorusGeometry(1, 0.12, 8, 20);
// Balusters are ~2cm rods and the railing scrollwork is a ~9cm curl, so the
// full-detail primitives above are wasted on them: at 320 triangles a curl,
// the ironwork was the single largest consumer in the city bucket.
const CYL_LO = new THREE.CylinderGeometry(1, 1, 1, 6);
const TORUS_LO = new THREE.TorusGeometry(1, 0.12, 4, 8);

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

export class City {
  constructor(track, scene) {
    this.track = track;
    this.group = new THREE.Group();
    this.group.name = 'city';
    this.M = makeMaterials();
    this.rnd = mulberry32(1337);
    this.b = new Bucket();          // static shadow-casting geometry
    this.bNoShadow = new Bucket();  // decorative, shadow-free (cheaper)
    this.lights = [];
    this.reserved = [];   // track spans owned by landmarks — no filler housing there
    this.landmarks = [];  // { name, position } for signage / minimap

    this._placeLandmarks();
    this._placeBuildings();
    this._placeFortifications();
    this._placeVegetation();
    this._placeStreetFurniture();
    this._placePlaza();
    this._placeStartGate();

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

  /** Local frame at a track sample, offset laterally. Local +Z runs along the
   *  track tangent. */
  frame(i, lat) {
    const t = this.track;
    const p = t.pointAt(i, lat, new THREE.Vector3());
    const tan = t.getTangent(i, new THREE.Vector3());
    const yaw = Math.atan2(tan.x, tan.z);
    return { p, yaw };
  }

  /** Frame whose local +Z points back at the centre line (for facades). */
  facing(i, lat) {
    const t = this.track;
    const p = t.pointAt(i, lat, new THREE.Vector3());
    const r = t.getRight(i, new THREE.Vector3());
    const sign = Math.sign(lat) || 1;
    const yaw = Math.atan2(-sign * r.x, -sign * r.z);
    return { p, yaw };
  }

  /** Matrix helper: everything a landmark builds is relative to this frame. */
  local(pos, yaw, scale = 1) {
    const base = new THREE.Matrix4().compose(
      pos.clone(),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
      new THREE.Vector3(scale, scale, scale)
    );
    return (m) => base.clone().multiply(m);
  }

  /** Claim a stretch of one side of the road so filler housing keeps clear. */
  reserve(centreFrac, metres, side) {
    const t = this.track;
    const half = (metres / 2) / (t.length / t.n);
    const c = centreFrac * t.n;
    this.reserved.push({ a: c - half, b: c + half, side });
  }

  isReserved(i, side) {
    for (const r of this.reserved) {
      if (r.side !== 0 && r.side !== side) continue;
      const n = this.track.n;
      // spans may wrap past the start line
      const a = (r.a + n) % n, b = (r.b + n) % n;
      if (a <= b ? (i >= a && i <= b) : (i >= a || i <= b)) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ *
   * Colonial facades
   * ------------------------------------------------------------------ */
  _placeBuildings() {
    const t = this.track;
    const n = t.n;
    const segLen = t.length / n;

    for (const side of [-1, 1]) {
      let i = 0;
      let guard = 0;
      while (i < n && guard++ < 4000) {
        const kind = t.kind[i];
        if (kind !== 0) { i += Math.round(4 / segLen); continue; }

        const w = this.r(7, 15);
        const setback = t.width[i] + 3.2 + this.r(0, 1.6);
        // don't build on the inside of a tight corner — it would clip the road
        const curv = t.curvature[i] * side;
        if (curv > 0.02) { i += Math.round(3 / segLen); continue; }
        // landmarks own their frontage
        if (this.isReserved(i, side)) { i += Math.round(4 / segLen); continue; }

        const { p, yaw } = this.facing(i, side * setback);
        this._building(p, yaw, w);
        i += Math.round((w + this.r(0.2, 0.9)) / segLen);
      }
    }
  }

  /**
   * One colonial townhouse. `yaw` faces the building's front toward +Z local,
   * i.e. toward the street.
   */
  _building(pos, yaw, width) {
    const B = this.b;
    const M = this.M;
    const floors = this.ri(2, 3);
    const floorH = this.r(3.4, 4.0);
    const h = floors * floorH;
    const depth = this.r(11, 18);
    const colorIdx = this.ri(0, FACADE_COLORS.length - 1);
    const wall = M.stucco[colorIdx];
    const key = 'stucco' + colorIdx;

    const base = new THREE.Matrix4().compose(
      pos.clone(),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
      new THREE.Vector3(1, 1, 1)
    );
    const L = (m) => base.clone().multiply(m);

    // --- main mass ---
    B.add(key, wall, BOX, L(mat(0, h / 2, -depth / 2, width, h, depth)));

    // --- plinth (darker stone base course) ---
    B.add('stone', M.stone, BOX, L(mat(0, 0.45, -depth / 2 + 0.02, width + 0.22, 0.9, depth)));

    // --- cornice + parapet ---
    B.add('trim', M.trim, BOX, L(mat(0, h + 0.16, -depth / 2, width + 0.5, 0.32, depth + 0.5)));
    B.add(key, wall, BOX, L(mat(0, h + 0.72, 0.12, width + 0.3, 0.8, 0.28)));
    // parapet balusters
    const balCount = Math.max(3, Math.floor(width / 0.9));
    for (let k = 0; k < balCount; k++) {
      const x = -width / 2 + (k + 0.5) * (width / balCount);
      B.add('trim', M.trim, CYL, L(mat(x, h + 0.72, 0.12, 0.09, 0.8, 0.09)));
    }

    // --- string course between floors ---
    for (let f = 1; f < floors; f++) {
      B.add('trim', M.trim, BOX, L(mat(0, f * floorH, 0.08, width + 0.34, 0.22, 0.34)));
    }

    // --- roof: flat azotea in front, tiled gable over the back range ---
    if (this.rnd() > 0.4) {
      const span = width + 0.5;
      const rd = depth * 0.52;
      const roof = makeGableRoof(span, rd, this.r(1.3, 2.1));
      B.add('roof', M.roof, roof, L(mat(0, h + 0.5, -depth * 0.62, 1, 1, 1)));
    }
    // rooftop cisterns and a stub chimney
    if (this.rnd() > 0.5) {
      B.add('trim', M.trim, CYL, L(mat(this.r(-width / 3, width / 3), h + 1.2, -depth * this.r(0.3, 0.7), 0.6, 1.1, 0.6)));
    }

    // --- openings ---
    const bays = Math.max(2, Math.min(5, Math.round(width / 3.1)));
    const bayW = width / bays;
    for (let f = 0; f < floors; f++) {
      for (let bx = 0; bx < bays; bx++) {
        const x = -width / 2 + (bx + 0.5) * bayW;
        const y = f * floorH;
        if (f === 0) {
          // ground floor: tall arched doorways and shopfronts
          if (bx === Math.floor(bays / 2) || this.rnd() > 0.55) this._doorway(L, x, y, bayW, floorH, key, wall);
          else this._shopfront(L, x, y, bayW, floorH);
        } else {
          this._window(L, x, y, bayW, floorH, f === 1);
        }
      }
    }

    // --- second-floor balcony spanning most of the facade ---
    if (floors >= 2 && width > 8) {
      this._balcony(L, 0, floorH + 0.05, width * 0.86);
    }

    // --- corner quoins ---
    if (this.rnd() > 0.45) {
      for (const sx of [-1, 1]) {
        for (let q = 0; q < Math.floor(h / 0.9); q++) {
          const long = q % 2 === 0;
          B.add('trim', M.trim, BOX,
            L(mat(sx * (width / 2 + 0.03), 1.0 + q * 0.9, 0.02, long ? 0.5 : 0.32, 0.78, 0.1)));
        }
      }
    }
  }

  _doorway(L, x, y, bayW, floorH, key, wall) {
    const B = this.b, M = this.M;
    const w = Math.min(1.9, bayW * 0.62);
    const doorH = floorH * 0.78;
    // recess
    B.add('doorWood', M.doorWood, BOX, L(mat(x, y + doorH / 2, 0.06, w, doorH, 0.16)));
    // arch head
    const arch = new THREE.CylinderGeometry(w / 2, w / 2, 0.2, 16, 1, false, 0, Math.PI);
    arch.rotateX(Math.PI / 2);
    arch.rotateZ(0);
    B.add('doorWood', M.doorWood, arch, L(mat(x, y + doorH, 0.06, 1, 1, 1)));
    // surround: pilasters either side plus a moulded head
    for (const sj of [-1, 1]) {
      B.add('trim', M.trim, BOX, L(mat(x + sj * (w / 2 + 0.11), y + doorH / 2, 0.12, 0.22, doorH + 0.2, 0.18)));
    }
    B.add('trim', M.trim, BOX, L(mat(x, y + doorH + 0.34, 0.16, w + 0.64, 0.22, 0.2)));
    // fanlight
    const fan = new THREE.CylinderGeometry(w * 0.42, w * 0.42, 0.06, 14, 1, false, 0, Math.PI);
    fan.rotateX(Math.PI / 2);
    B.add('glass', M.glass, fan, L(mat(x, y + doorH + 0.02, 0.2, 1, 1, 1)));
    // door leaves + knocker
    for (const s of [-1, 1]) {
      B.add('doorWood', M.doorWood, BOX, L(mat(x + s * w * 0.24, y + doorH / 2, 0.15, w * 0.44, doorH * 0.96, 0.07)));
    }
    B.add('brass', M.brass, SPH, L(mat(x, y + doorH * 0.6, 0.22, 0.07, 0.07, 0.07)));
    // step
    B.add('stone', M.stone, BOX, L(mat(x, y + 0.07, 0.42, w + 0.5, 0.14, 0.7)));
  }

  _shopfront(L, x, y, bayW, floorH) {
    const B = this.b, M = this.M;
    const w = bayW * 0.74;
    const hgt = floorH * 0.62;
    B.add('reveal', M.reveal, BOX, L(mat(x, y + 0.35 + hgt / 2, -0.1, w + 0.06, hgt + 0.06, 0.3)));
    B.add('glass', M.glass, BOX, L(mat(x, y + 0.35 + hgt / 2, 0.1, w, hgt, 0.06)));
    for (const sj of [-1, 1]) {
      B.add('trim', M.trim, BOX, L(mat(x + sj * (w / 2 + 0.08), y + 0.35 + hgt / 2, 0.14, 0.16, hgt + 0.28, 0.12)));
    }
    B.add('trim', M.trim, BOX, L(mat(x, y + 0.35 + hgt + 0.08, 0.14, w + 0.32, 0.16, 0.12)));
    B.add('stone', M.stone, BOX, L(mat(x, y + 0.2, 0.16, w + 0.24, 0.4, 0.22)));
    // awning
    if (this.rnd() > 0.45) {
      const hue = this.pick([0xd8342c, 0x2f6bb5, 0x1f8a4c, 0xf2a03d]);
      const m = new THREE.MeshStandardMaterial({ color: hue, roughness: 0.8, side: THREE.DoubleSide });
      const awn = new THREE.BoxGeometry(w + 0.5, 0.06, 1.25);
      this.bNoShadow.add('awn' + hue, m, awn, L(mat(x, y + 0.35 + hgt + 0.5, 0.75, 1, 1, 1, -0.32)));
      for (const s of [-1, 1]) {
        this.bNoShadow.add('iron', M.iron, CYL_LO,
          L(mat(x + s * (w / 2 + 0.2), y + 0.35 + hgt + 0.3, 0.7, 0.03, 0.9, 0.03, 0.5)));
      }
    }
  }

  _window(L, x, y, bayW, floorH, hasRail) {
    const B = this.b, M = this.M;
    const w = Math.min(1.5, bayW * 0.5);
    const hgt = floorH * 0.62;
    const cy = y + floorH * 0.16 + hgt / 2;
    // dark reveal behind the glazing so the opening reads as a hole
    B.add('reveal', M.reveal, BOX, L(mat(x, cy, -0.12, w + 0.06, hgt + 0.06, 0.3)));
    B.add('glass', M.glass, BOX, L(mat(x, cy, 0.01, w, hgt, 0.06)));
    // glazing bars
    B.add('trim', M.trim, BOX, L(mat(x, cy, 0.05, w, 0.05, 0.05)));
    B.add('trim', M.trim, BOX, L(mat(x, cy, 0.05, 0.05, hgt, 0.05)));
    // moulded surround: jambs, lintel, sill, pediment
    for (const sj of [-1, 1]) {
      B.add('trim', M.trim, BOX, L(mat(x + sj * (w / 2 + 0.09), cy, 0.08, 0.18, hgt + 0.36, 0.16)));
    }
    B.add('trim', M.trim, BOX, L(mat(x, cy + hgt / 2 + 0.09, 0.08, w + 0.36, 0.18, 0.16)));
    B.add('trim', M.trim, BOX, L(mat(x, cy - hgt / 2 - 0.16, 0.2, w + 0.6, 0.14, 0.3)));
    B.add('trim', M.trim, BOX, L(mat(x, cy + hgt / 2 + 0.3, 0.16, w + 0.62, 0.14, 0.22)));
    // louvered shutters, sometimes thrown open
    const open = this.rnd() > 0.55;
    for (const s of [-1, 1]) {
      const sw = w / 2;
      const ang = open ? s * 1.15 : 0;
      const offX = open ? s * (w / 2 + sw * 0.45) : s * w * 0.25;
      const offZ = open ? 0.24 : 0.1;
      B.add('shutter', M.shutter, BOX, L(mat(x + offX, cy, offZ, sw * 0.94, hgt * 0.97, 0.06, 0, ang, 0)));
      // louver slats
      for (let k = 0; k < 6; k++) {
        const ly = cy - hgt * 0.4 + (k / 5) * hgt * 0.8;
        B.add('shutter', M.shutter, BOX,
          L(mat(x + offX, ly, offZ + 0.04, sw * 0.88, hgt * 0.09, 0.03, 0.25, ang, 0)));
      }
    }
    // wrought-iron juliet rail
    if (hasRail) {
      const rw = w + 0.5;
      B.add('iron', M.iron, BOX, L(mat(x, cy - hgt / 2 + 0.5, 0.36, rw, 0.05, 0.05)));
      B.add('iron', M.iron, BOX, L(mat(x, cy - hgt / 2 - 0.05, 0.36, rw, 0.05, 0.05)));
      const bars = Math.floor(rw / 0.17);
      for (let k = 0; k <= bars; k++) {
        const bxp = x - rw / 2 + (k / bars) * rw;
        B.add('iron', M.iron, CYL_LO, L(mat(bxp, cy - hgt / 2 + 0.22, 0.36, 0.018, 0.56, 0.018)));
      }
      // a flowerpot on the ledge
      if (this.rnd() > 0.6) {
        const px = x + this.r(-0.3, 0.3);
        this.bNoShadow.add('terracotta', M.roof, CYL, L(mat(px, cy - hgt / 2 - 0.02, 0.3, 0.13, 0.2, 0.13)));
        this.bNoShadow.add('bougainvillea', this.rnd() > 0.5 ? M.bougainvillea : M.canopy, SPH,
          L(mat(px, cy - hgt / 2 + 0.16, 0.3, 0.22, 0.2, 0.22)));
      }
    }
  }

  _balcony(L, x, y, width) {
    const B = this.b, M = this.M;
    const depth = 1.15;
    // slab + brackets
    B.add('trim', M.trim, BOX, L(mat(x, y, depth / 2, width, 0.16, depth)));
    const brackets = Math.max(2, Math.floor(width / 2.4));
    for (let k = 0; k <= brackets; k++) {
      const bxp = x - width / 2 + (k / brackets) * width;
      B.add('trim', M.trim, BOX, L(mat(bxp, y - 0.28, 0.35, 0.14, 0.5, 0.7, 0.5)));
    }
    // wrought iron railing: top rail, bottom rail, balusters with a twist
    const h = 1.0;
    for (const zz of [depth - 0.06]) {
      B.add('iron', M.iron, BOX, L(mat(x, y + h + 0.08, zz, width, 0.07, 0.07)));
      B.add('iron', M.iron, BOX, L(mat(x, y + 0.14, zz, width, 0.05, 0.05)));
      B.add('iron', M.iron, BOX, L(mat(x, y + h * 0.55, zz, width, 0.04, 0.04)));
      const bars = Math.floor(width / 0.19);
      for (let k = 0; k <= bars; k++) {
        const bxp = x - width / 2 + (k / bars) * width;
        B.add('iron', M.iron, CYL_LO, L(mat(bxp, y + h / 2 + 0.1, zz, 0.021, h, 0.021)));
        if (k % 3 === 0) {
          B.add('iron', M.iron, TORUS_LO, L(mat(bxp, y + h * 0.55, zz, 0.09, 0.09, 0.09, Math.PI / 2)));
        }
      }
    }
    // side rails
    for (const s of [-1, 1]) {
      B.add('iron', M.iron, BOX, L(mat(x + s * width / 2, y + h + 0.08, depth / 2, 0.07, 0.07, depth)));
      const bars = 6;
      for (let k = 0; k <= bars; k++) {
        B.add('iron', M.iron, CYL_LO,
          L(mat(x + s * width / 2, y + h / 2 + 0.1, (k / bars) * depth, 0.021, h, 0.021)));
      }
    }
    // trailing bougainvillea
    if (this.rnd() > 0.4) {
      for (let k = 0; k < 4; k++) {
        const bxp = x + this.r(-width / 2, width / 2);
        this.bNoShadow.add('bougainvillea', M.bougainvillea, SPH,
          L(mat(bxp, y + this.r(-0.5, 0.3), depth - 0.05, this.r(0.3, 0.6), this.r(0.25, 0.5), 0.24)));
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * City walls, El Morro, San Cristóbal, garitas
   * ------------------------------------------------------------------ */
  _placeFortifications() {
    const t = this.track;
    const M = this.M;
    const segLen = t.length / t.n;

    // Massive sloped curtain wall on the seaward side of the open sections.
    for (let i = 0; i < t.n; i += Math.round(3.5 / segLen)) {
      if (t.kind[i] === 0) continue;
      // the sea gate provides its own wall
      if (this.isReserved(i, t.kind[i] === 2 ? 1 : -1)) continue;
      const side = t.kind[i] === 2 ? 1 : -1; // bay on the right, Atlantic on the left
      const { p, yaw } = this.frame(i, side * (t.width[i] + 9));
      const h = 11 + Math.sin(i * 0.02) * 2.4;
      const base = new THREE.Matrix4().compose(
        p.clone(), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1)
      );
      const L = (m) => base.clone().multiply(m);
      // battered (sloped) face — a trapezoid prism
      const g = new THREE.CylinderGeometry(1, 1.28, 1, 4, 1);
      g.rotateY(Math.PI / 4);
      this.b.add('stone', M.stone, g, L(mat(0, -h / 2 + 1.2, 0, 5.0, h, 4.6)), [1.4, h / 4.5]);
      this.b.add('stone', M.stone, BOX, L(mat(0, 1.9, 0, 7.2, 1.6, 4.6)), [1.6, 1]);
      // crenellated parapet toward the sea
      this.b.add('stone', M.stone, BOX, L(mat(0, 2.9, side * -2.6, 7.2, 1.2, 0.9)));
    }

    // Garitas — the iconic domed sentry boxes — at intervals along the wall.
    for (let k = 0; k < 9; k++) {
      const i = Math.floor((0.30 + k * 0.045) * t.n) % t.n;
      if (t.kind[i] === 0) continue;
      const side = t.kind[i] === 2 ? 1 : -1;
      const { p, yaw } = this.facing(i, side * (t.width[i] + 12.5));
      this._garita(p, yaw + Math.PI);
    }

    // Castillo San Felipe del Morro — a layered mass on the seaward glacis.
    const morroI = Math.floor(t.n * 0.44);
    const { p: mp, yaw: myaw } = this.facing(morroI, -(t.width[morroI] + 150));
    this._fortress(mp, myaw, 1.0, true);

    // Castillo San Cristóbal — smaller, guarding the eastern approach.
    const cristoI = Math.floor(t.n * 0.70);
    const { p: cp, yaw: cyaw } = this.facing(cristoI, -(t.width[cristoI] + 95));
    this._fortress(cp, cyaw, 0.72, false);
  }

  _garita(pos, yaw) {
    const M = this.M;
    const base = new THREE.Matrix4().compose(
      pos.clone(), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1)
    );
    const L = (m) => base.clone().multiply(m);
    // corbelled foot
    this.b.add('stone', M.stone, CONE, L(mat(0, 1.1, 0, 1.5, 2.2, 1.5)));
    // drum with vertical loopholes
    this.b.add('stone', M.stone, CYL_HI, L(mat(0, 3.6, 0, 1.35, 3.0, 1.35)));
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      this.b.add('iron', M.iron, BOX,
        L(mat(Math.sin(a) * 1.3, 3.9, Math.cos(a) * 1.3, 0.28, 1.1, 0.28, 0, -a, 0)));
    }
    // cornice ring + ribbed dome + finial
    this.b.add('stone', M.stone, CYL_HI, L(mat(0, 5.2, 0, 1.62, 0.34, 1.62)));
    this.b.add('stone', M.stone, SPH_HI, L(mat(0, 5.4, 0, 1.5, 1.6, 1.5)));
    this.b.add('stone', M.stone, SPH, L(mat(0, 6.9, 0, 0.34, 0.42, 0.34)));
  }

  _fortress(pos, yaw, scale, lighthouse) {
    const M = this.M;
    const base = new THREE.Matrix4().compose(
      pos.clone(), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(scale, scale, scale)
    );
    const L = (m) => base.clone().multiply(m);
    const B = this.b;

    // The castle presents one enormous battered land face to the esplanade
    // and steps *back* in terraces rather than pyramiding upward, which is
    // what gives the real Morro its low, brooding silhouette.
    const S = 4.5; // metres of stone per texture tile
    const face = (w, d, h, y, zFront) => {
      const g = new THREE.CylinderGeometry(1, 1.16, 1, 4, 1);
      g.rotateY(Math.PI / 4);
      B.add('stone', M.stone, g, L(mat(0, y + h / 2, zFront - d / 2, w, h, d)), [w / S, h / S]);
      // cordon moulding and parapet walk
      B.add('stone', M.stone, BOX, L(mat(0, y + h + 0.5, zFront - d / 2, w + 2.6, 1.0, d + 2.6)), [w / S, 1]);
      B.add('stone', M.stone, BOX, L(mat(0, y + h + 2.0, zFront - d / 2, w, 2.0, d)), [w / S, 1]);
      // merlons along the outer edge of the walk
      const count = Math.max(4, Math.floor(w / 5.4));
      for (let k = 0; k <= count; k++) {
        const x = -w / 2 + (k / count) * w;
        B.add('stone', M.stone, BOX, L(mat(x, y + h + 3.3, zFront + 0.4, 2.6, 1.7, 1.5)));
      }
      return y + h + 2.0;
    };

    // lower battery at the water, then the great land face, then terraces
    face(120, 26, 11, -6, 46);
    const walk1 = face(112, 34, 20, 0, 34);
    const walk2 = face(84, 30, 11, walk1, 6);
    face(56, 24, 9, walk2, -18);

    // dry moat and the ramped gate on the esplanade side
    B.add('stone', M.stone, BOX, L(mat(0, -3, 52, 120, 6, 12)), [120 / S, 1]);
    B.add('stone', M.stone, BOX, L(mat(0, 4.5, 40, 14, 9, 18)), [2, 1]);
    this._archOpening(L, {
      key: 'morroGate', mat: M.stone, x: 0, z: 34.2, W: 13, H: 12, D: 10,
      aw: 5.6, ah: 5.4, doors: true, doorColor: 0x6a4525, tunnel: true,
    });

    // angled bastion noses flanking the land face
    for (const s of [-1, 1]) {
      const g = new THREE.CylinderGeometry(11, 15, 22, 5, 1);
      B.add('stone', M.stone, g, L(mat(s * 58, 11, 26, 1, 1, 1, 0, s * 0.5, 0)), [4, 3]);
      B.add('stone', M.stone, CYL, L(mat(s * 58, 22.6, 26, 12.4, 1.2, 12.4, 0, s * 0.5, 0)), [4, 1]);
    }
    // garitas: on the bastion noses and out at the seaward point
    for (const s of [-1, 1]) {
      this._garita(new THREE.Vector3(s * 58, 23.2, 26).applyMatrix4(base), yaw);
      this._garita(new THREE.Vector3(s * 52, 6.5, 44).applyMatrix4(base), yaw);
    }
    // cannons on the upper terrace, run out through the embrasures
    for (let k = 0; k < 7; k++) {
      const x = -30 + k * 10;
      B.add('iron', M.iron, CYL, L(mat(x, walk2 + 1.9, 3, 0.55, 4.4, 0.55, 1.35)));
      B.add('doorWood', M.doorWood, BOX, L(mat(x, walk2 + 0.9, 1.2, 1.5, 1.0, 3.0)));
      for (const s of [-1, 1]) {
        B.add('doorWood', M.doorWood, CYL, L(mat(x + s * 0.85, walk2 + 0.6, 1.9, 1.1, 0.3, 1.1, 0, 0, Math.PI / 2)));
      }
    }

    if (lighthouse) {
      // the 1908 lighthouse crowning El Morro
      const y0 = walk2 + 11;
      B.add('trim', M.trim, BOX, L(mat(0, y0 + 3, -26, 22, 6, 15)), [3, 1]);
      B.add('trim', M.trim, BOX, L(mat(0, y0 + 6.4, -26, 23.4, 0.9, 16.4)), [3, 1]);
      B.add('trim', M.trim, CYL_HI, L(mat(0, y0 + 12, -26, 4.2, 11, 4.2)));
      B.add('trim', M.trim, CYL_HI, L(mat(0, y0 + 17.8, -26, 5.4, 1.0, 5.4)));
      B.add('iron', M.iron, CYL_HI, L(mat(0, y0 + 20.0, -26, 3.2, 3.4, 3.2)));
      const lampGeo = new THREE.SphereGeometry(1, 14, 12);
      this.bNoShadow.add('lamp', M.lamp, lampGeo, L(mat(0, y0 + 20.0, -26, 1.9, 1.9, 1.9)));
      B.add('trim', M.trim, CONE, L(mat(0, y0 + 22.6, -26, 3.6, 2.4, 3.6)));

      const light = new THREE.PointLight(0xffd9a0, 30, 140, 2);
      light.position.set(0, y0 + 20, -26).applyMatrix4(base);
      this.group.add(light);

      // flagpole with the Puerto Rican flag over the main plaza
      this._flag(new THREE.Vector3(30, walk2 + 2, -4).applyMatrix4(base), yaw);
    }
  }

  _flag(pos, yaw) {
    const M = this.M;
    const base = new THREE.Matrix4().compose(
      pos.clone(), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1)
    );
    const L = (m) => base.clone().multiply(m);
    this.b.add('trim', M.trim, CYL, L(mat(0, 8, 0, 0.22, 16, 0.22)));
    // flag itself: five stripes + a blue triangle, waving via bent quads
    const stripes = [0xed1c24, 0xffffff, 0xed1c24, 0xffffff, 0xed1c24];
    for (let k = 0; k < 5; k++) {
      const m = new THREE.MeshStandardMaterial({ color: stripes[k], roughness: 0.85, side: THREE.DoubleSide });
      this.bNoShadow.add('flag' + k, m, BOX, L(mat(3.2, 14.6 - k * 0.62, 0.06 * (k % 2 ? 1 : -1), 6.0, 0.6, 0.05)));
    }
    const blue = new THREE.MeshStandardMaterial({ color: 0x0050a4, roughness: 0.85, side: THREE.DoubleSide });
    const tri = new THREE.CylinderGeometry(1.6, 1.6, 0.06, 3);
    tri.rotateX(Math.PI / 2);
    this.bNoShadow.add('flagblue', blue, tri, L(mat(1.3, 13.4, 0.07, 1, 1, 1, 0, 0, -Math.PI / 2)));
  }

  /* ------------------------------------------------------------------ *
   * Vegetation
   * ------------------------------------------------------------------ */
  _placeVegetation() {
    const t = this.track;
    const segLen = t.length / t.n;
    for (let i = 0; i < t.n; i += Math.round(9 / segLen)) {
      const kind = t.kind[i];
      if (kind === 0) continue;
      for (const side of [-1, 1]) {
        if (this.rnd() > 0.62) continue;
        const lat = side * (t.width[i] + this.r(3.5, 7));
        const { p } = this.frame(i, lat);
        if (this.rnd() > 0.42) this._palm(p, this.r(0, 6.28));
        else this._tree(p, this.rnd() > 0.6 ? this.M.flamboyan : this.M.canopy);
      }
    }
    // A dense line of palms along the El Morro esplanade edge.
    for (let k = 0; k < 26; k++) {
      const i = Math.floor(t.n * (0.36 + k * 0.006)) % t.n;
      const { p } = this.frame(i, -(t.width[i] + 24 + this.r(0, 8)));
      this._palm(p, this.r(0, 6.28));
    }
  }

  _palm(pos, rot) {
    const M = this.M;
    const H = this.r(7, 12);
    const lean = this.r(0.05, 0.28);
    const leanDir = this.r(0, 6.28);
    const segs = 8;
    let x = 0, y = 0, z = 0;
    const base = new THREE.Matrix4().compose(
      pos.clone(), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)), new THREE.Vector3(1, 1, 1)
    );
    const L = (m) => base.clone().multiply(m);

    for (let s = 0; s < segs; s++) {
      const f = s / segs;
      const segH = H / segs;
      const r = 0.32 * (1 - f * 0.45);
      const off = Math.pow(f, 1.7) * lean * H;
      const nx = Math.cos(leanDir) * off, nz = Math.sin(leanDir) * off;
      const m = mat(nx, f * H + segH / 2, nz, r, segH * 1.04, r,
        Math.sin(leanDir) * lean * 0.9 * f, 0, -Math.cos(leanDir) * lean * 0.9 * f);
      this.b.add('palmTrunk', M.palmTrunk, CYL, L(m));
      // ring scars
      if (s % 2 === 0) {
        this.b.add('palmTrunk', M.palmTrunk, TORUS, L(mat(nx, f * H + segH * 0.2, nz, r * 1.1, r * 1.1, r * 1.1, Math.PI / 2)));
      }
      x = nx; y = H; z = nz;
    }

    // crown shaft + fronds
    const fronds = this.ri(9, 13);
    for (let k = 0; k < fronds; k++) {
      const a = (k / fronds) * Math.PI * 2 + this.r(0, 0.4);
      const droop = this.r(0.45, 1.05);
      const len = this.r(2.6, 4.2);
      const frondGeo = makeFrond(len, this.r(0.42, 0.66), droop);
      this.bNoShadow.add('frond', M.frond, frondGeo,
        L(mat(x, y + 0.2, z, 1, 1, 1, 0, a, 0)));
    }
    // coconuts
    for (let k = 0; k < 4; k++) {
      const a = this.r(0, 6.28);
      this.bNoShadow.add('coco', M.palmTrunk, SPH,
        L(mat(x + Math.sin(a) * 0.4, y - 0.1, z + Math.cos(a) * 0.4, 0.19, 0.19, 0.19)));
    }
  }

  _tree(pos, canopyMat) {
    const M = this.M;
    const H = this.r(4.5, 8);
    const base = new THREE.Matrix4().compose(
      pos.clone(), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.r(0, 6.28), 0)), new THREE.Vector3(1, 1, 1)
    );
    const L = (m) => base.clone().multiply(m);
    this.b.add('palmTrunk', M.palmTrunk, CYL, L(mat(0, H / 2, 0, 0.34, H, 0.34)));
    // branches
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * 6.28;
      this.b.add('palmTrunk', M.palmTrunk, CYL,
        L(mat(Math.sin(a) * 0.7, H * 0.82, Math.cos(a) * 0.7, 0.15, H * 0.5, 0.15, Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5)));
    }
    // flat, wide canopy — flamboyán silhouette
    const blobs = this.ri(4, 7);
    for (let k = 0; k < blobs; k++) {
      const a = (k / blobs) * 6.28;
      const rad = this.r(1.8, 3.1);
      this.b.add(canopyMat === M.flamboyan ? 'flamboyan' : 'canopy', canopyMat, SPH,
        L(mat(Math.sin(a) * this.r(0.6, 2.2), H + this.r(-0.4, 0.9), Math.cos(a) * this.r(0.6, 2.2),
          rad, rad * this.r(0.42, 0.62), rad)));
    }
  }

  /* ------------------------------------------------------------------ *
   * Street furniture
   * ------------------------------------------------------------------ */
  _placeStreetFurniture() {
    const t = this.track;
    const M = this.M;
    const segLen = t.length / t.n;

    // Colonial lamp posts, alternating sides.
    let flip = 1;
    for (let i = 0; i < t.n; i += Math.round(16 / segLen)) {
      flip *= -1;
      const lat = flip * (t.width[i] + 1.9);
      const { p, yaw } = this.frame(i, lat);
      this._lamppost(p, yaw);
    }

    // The famous umbrella canopy over Calle Fortaleza.
    const segLenR = Math.round(4.6 / segLen);
    for (let i = Math.floor(t.n * 0.012); i < Math.floor(t.n * 0.085); i += segLenR) {
      const { p, yaw } = this.frame(i, 0);
      const colors = [0xed1c24, 0xffd23f, 0x2f8fd6, 0x2fbf6a, 0xf27ab0, 0xff8a2a, 0xffffff];
      const span = t.width[i] * 0.9;
      for (let k = -2; k <= 2; k++) {
        const c = colors[(i + k * 11) % colors.length];
        const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.66, side: THREE.DoubleSide });
        const off = (k / 2) * span;
        const wp = new THREE.Vector3(p.x + Math.cos(yaw) * off, p.y + this.r(8.4, 9.6), p.z - Math.sin(yaw) * off);
        const um = makeUmbrella(this.r(1.1, 1.6), this.r(0.4, 0.62));
        this.bNoShadow.add('umb' + c, m, um,
          new THREE.Matrix4().compose(wp, new THREE.Quaternion().setFromEuler(new THREE.Euler(this.r(-0.14, 0.14), this.r(0, 6.28), this.r(-0.14, 0.14))), new THREE.Vector3(1, 1, 1)));
        // hanging line up to the cable
        this.bNoShadow.add('cable', M.cable, CYL,
          new THREE.Matrix4().compose(
            new THREE.Vector3(wp.x, (wp.y + p.y + 10.3) / 2, wp.z),
            new THREE.Quaternion(), new THREE.Vector3(0.01, p.y + 10.3 - wp.y, 0.01)));
      }
      // a single slim cable strung between the facades
      const cw = t.width[i] * 2 + 7;
      this.bNoShadow.add('cable', M.cable, CYL,
        new THREE.Matrix4().compose(
          new THREE.Vector3(p.x, p.y + 10.3, p.z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, Math.PI / 2)),
          new THREE.Vector3(0.01, cw, 0.01)));
    }

    // Benches and bollards along the promenade.
    for (let i = 0; i < t.n; i += Math.round(11 / segLen)) {
      if (t.kind[i] !== 2) continue;
      for (const side of [-1, 1]) {
        if (this.rnd() > 0.5) continue;
        const { p, yaw } = this.facing(i, side * (t.width[i] + 3.2));
        this._bench(p, yaw);
      }
    }
  }

  _lamppost(pos, yaw) {
    const M = this.M;
    const base = new THREE.Matrix4().compose(
      pos.clone(), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1)
    );
    const L = (m) => base.clone().multiply(m);
    this.b.add('stone', M.stone, CYL, L(mat(0, 0.25, 0, 0.42, 0.5, 0.42)));
    this.b.add('iron', M.iron, CYL, L(mat(0, 0.7, 0, 0.28, 0.6, 0.28)));
    this.b.add('iron', M.iron, CYL, L(mat(0, 2.6, 0, 0.11, 3.4, 0.11)));
    this.b.add('iron', M.iron, TORUS, L(mat(0, 1.6, 0, 0.2, 0.2, 0.2, Math.PI / 2)));
    this.b.add('iron', M.iron, CYL, L(mat(0, 4.42, 0, 0.3, 0.24, 0.3)));
    // lantern: four glazed panels under a pyramid cap
    this.bNoShadow.add('lamp', M.lamp, BOX, L(mat(0, 4.95, 0, 0.46, 0.72, 0.46)));
    this.b.add('iron', M.iron, CONE, L(mat(0, 5.55, 0, 0.48, 0.42, 0.48)));
    this.b.add('iron', M.iron, SPH, L(mat(0, 5.85, 0, 0.09, 0.14, 0.09)));
  }

  _bench(pos, yaw) {
    const M = this.M;
    const base = new THREE.Matrix4().compose(
      pos.clone(), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1)
    );
    const L = (m) => base.clone().multiply(m);
    for (let k = 0; k < 5; k++) {
      this.b.add('doorWood', M.doorWood, BOX, L(mat(0, 0.46, -0.28 + k * 0.14, 1.9, 0.06, 0.11)));
      this.b.add('doorWood', M.doorWood, BOX, L(mat(0, 0.62 + k * 0.13, -0.42, 1.9, 0.1, 0.05, 0.22)));
    }
    for (const s of [-1, 1]) {
      this.b.add('iron', M.iron, BOX, L(mat(s * 0.85, 0.23, 0, 0.07, 0.46, 0.7)));
      this.b.add('iron', M.iron, BOX, L(mat(s * 0.85, 0.75, -0.4, 0.07, 0.6, 0.08, 0.22)));
    }
  }

  /* ------------------------------------------------------------------ *
   * Plaza de Armas — the start/finish square
   * ------------------------------------------------------------------ */
  _placePlaza() {
    const t = this.track;
    const M = this.M;
    const i = Math.floor(t.n * 0.985);
    const { p, yaw } = this.frame(i, -(t.width[i] + 16));
    const base = new THREE.Matrix4().compose(
      p.clone(), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1)
    );
    const L = (m) => base.clone().multiply(m);

    // paved apron
    this.bNoShadow.add('stone', M.stone, BOX, L(mat(0, 0.06, 0, 34, 0.12, 26)));

    // the four-season fountain
    this.b.add('stone', M.stone, CYL_HI, L(mat(0, 0.4, 0, 6.2, 0.8, 6.2)));
    this.b.add('stone', M.stone, CYL_HI, L(mat(0, 0.9, 0, 5.5, 0.4, 5.5)));
    this.bNoShadow.add('water', M.water, CYL_HI, L(mat(0, 0.92, 0, 5.3, 0.34, 5.3)));
    this.b.add('stone', M.stone, CYL_HI, L(mat(0, 1.6, 0, 0.9, 1.6, 0.9)));
    this.b.add('stone', M.stone, CYL_HI, L(mat(0, 2.5, 0, 3.0, 0.32, 3.0)));
    this.bNoShadow.add('water', M.water, CYL_HI, L(mat(0, 2.62, 0, 2.8, 0.16, 2.8)));
    this.b.add('stone', M.stone, CYL_HI, L(mat(0, 3.5, 0, 0.5, 1.6, 0.5)));
    this.b.add('stone', M.stone, CYL_HI, L(mat(0, 4.3, 0, 1.5, 0.24, 1.5)));
    this.b.add('stone', M.stone, SPH_HI, L(mat(0, 4.9, 0, 0.6, 0.7, 0.6)));
    // four statues on the rim
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const sx = Math.sin(a) * 4.6, sz = Math.cos(a) * 4.6;
      this.b.add('trim', M.trim, CYL, L(mat(sx, 1.4, sz, 0.5, 1.2, 0.5)));
      this.b.add('trim', M.trim, SPH, L(mat(sx, 2.4, sz, 0.42, 0.9, 0.42)));
      this.b.add('trim', M.trim, SPH, L(mat(sx, 3.3, sz, 0.24, 0.28, 0.24)));
    }

    // shade trees and benches around the square
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const tp = new THREE.Vector3(Math.sin(a) * 13, 0, Math.cos(a) * 11).applyMatrix4(base);
      this._tree(tp, k % 3 === 0 ? M.flamboyan : M.canopy);
      const bp = new THREE.Vector3(Math.sin(a) * 8.4, 0, Math.cos(a) * 7).applyMatrix4(base);
      this._bench(bp, yaw + a + Math.PI);
    }

    // piragua cart — shaved ice, the sound of the plaza
    const cp = new THREE.Vector3(12, 0, -8).applyMatrix4(base);
    this._piraguaCart(cp, yaw + 0.6);
  }

  _piraguaCart(pos, yaw) {
    const M = this.M;
    const base = new THREE.Matrix4().compose(
      pos.clone(), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1)
    );
    const L = (m) => base.clone().multiply(m);
    const cartMat = new THREE.MeshStandardMaterial({ color: 0xf2f2ef, roughness: 0.6 });
    this.b.add('cart', cartMat, BOX, L(mat(0, 0.9, 0, 2.2, 1.0, 1.2)));
    this.b.add('iron', M.iron, CYL, L(mat(-0.9, 0.35, 0.66, 0.35, 0.12, 0.35, 0, 0, Math.PI / 2)));
    this.b.add('iron', M.iron, CYL, L(mat(0.9, 0.35, 0.66, 0.35, 0.12, 0.35, 0, 0, Math.PI / 2)));
    this.b.add('iron', M.iron, CYL, L(mat(0, 1.9, 0, 0.05, 1.0, 0.05)));
    // striped parasol
    const colors = [0xed1c24, 0xffd23f, 0x2f8fd6];
    colors.forEach((c, k) => {
      const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.72, side: THREE.DoubleSide });
      const g = new THREE.CylinderGeometry(0.05, 1.9, 0.6, 12, 1, true, (k / 3) * 6.28, 6.28 / 3);
      this.bNoShadow.add('parasol' + c, m, g, L(mat(0, 2.6, 0, 1, 1, 1)));
    });
    // syrup bottles
    for (let k = 0; k < 5; k++) {
      const m = new THREE.MeshStandardMaterial({
        color: [0xff2d55, 0x2fd36f, 0xffd23f, 0x8e44d8, 0xff8a2a][k],
        roughness: 0.25, metalness: 0.0, transparent: true, opacity: 0.9,
      });
      this.bNoShadow.add('syrup' + k, m, CYL, L(mat(-0.8 + k * 0.4, 1.62, -0.3, 0.09, 0.44, 0.09)));
    }
  }

  /* ------------------------------------------------------------------ *
   * Named landmarks of Old San Juan
   *
   * Each one claims its frontage first (see `reserve`) so the procedural
   * housing grows around it instead of through it.
   * ------------------------------------------------------------------ */
  _placeLandmarks() {
    const t = this.track;
    const at = (frac, lat) => {
      const i = Math.floor(((frac % 1) + 1) % 1 * t.n);
      return { i, ...this.facing(i, lat) };
    };
    const note = (name, p) => this.landmarks.push({ name, position: p.clone() });

    /* --- La Fortaleza: the governor's blue-and-white palace ---------- */
    {
      const f = 0.174;
      this.reserve(f, 78, -1);
      const s = at(f, -(t.width[Math.floor(f * t.n)] + 30));
      this._laFortaleza(s.p, s.yaw);
      note('La Fortaleza', s.p);
    }

    /* --- La Princesa: the 1837 jail, now the tourism office --------- */
    {
      const f = 0.208;
      this.reserve(f, 52, -1);
      const s = at(f, -(t.width[Math.floor(f * t.n)] + 22));
      this._laPrincesa(s.p, s.yaw);
      note('La Princesa', s.p);
    }

    /* --- Fuente Raíces on the Paseo de la Princesa ------------------ */
    {
      const f = 0.232;
      const s = at(f, t.width[Math.floor(f * t.n)] + 15);
      this._fuenteRaices(s.p, s.yaw);
      note('Fuente Raíces', s.p);
    }

    /* --- Puerta de San Juan: the red 1635 sea gate ------------------ */
    {
      const f = 0.348;
      this.reserve(f, 46, 1);
      const i = Math.floor(f * t.n);
      const s = at(f, t.width[i] + 9);
      this._puertaSanJuan(s.p, s.yaw);
      note('Puerta de San Juan', s.p);
    }

    /* --- La Rogativa: the 1971 bishop-and-torches sculpture --------- */
    {
      const f = 0.372;
      const s = at(f, t.width[Math.floor(f * t.n)] + 13);
      this._rogativa(s.p, s.yaw);
      note('La Rogativa', s.p);
    }

    /* --- Cementerio Santa María Magdalena de Pazzis ----------------- */
    {
      const f = 0.418;
      const i = Math.floor(f * t.n);
      const s = at(f, -(t.width[i] + 34));
      this._cementerio(s.p, s.yaw);
      note('Cementerio Pazzis', s.p);
    }

    /* --- Casa Blanca: the Ponce de León family seat ----------------- */
    {
      const f = 0.472;
      this.reserve(f, 60, 1);
      const i = Math.floor(f * t.n);
      const s = at(f, t.width[i] + 30);
      this._casaBlanca(s.p, s.yaw);
      note('Casa Blanca', s.p);
    }

    /* --- Tótem Telúrico, Plaza del Quinto Centenario ---------------- */
    {
      const f = 0.548;
      const i = Math.floor(f * t.n);
      const s = at(f, t.width[i] + 20);
      this._totem(s.p, s.yaw);
      note('Tótem Telúrico', s.p);
    }

    /* --- Plaza de Colón, at the foot of San Cristóbal --------------- */
    {
      const f = 0.792;
      this.reserve(f, 44, 1);
      const i = Math.floor(f * t.n);
      const s = at(f, t.width[i] + 18);
      this._plazaColon(s.p, s.yaw);
      note('Plaza de Colón', s.p);
    }

    /* --- Catedral de San Juan Bautista ------------------------------ */
    {
      const f = 0.918;
      this.reserve(f, 62, 1);
      const i = Math.floor(f * t.n);
      const s = at(f, t.width[i] + 17);
      this._catedral(s.p, s.yaw);
      note('Catedral de San Juan', s.p);
    }

    /* --- Capilla del Cristo: the tiny chapel with the silver altar -- */
    {
      const f = 0.962;
      this.reserve(f, 26, -1);
      const i = Math.floor(f * t.n);
      const s = at(f, -(t.width[i] + 12));
      this._capillaCristo(s.p, s.yaw);
      note('Capilla del Cristo', s.p);
    }

    this._bayTraffic();
    this._chiringas();
  }

  /* ---------------------- La Fortaleza (1533) ---------------------- */
  _laFortaleza(pos, yaw) {
    const M = this.M;
    const L = this.local(pos, yaw);
    const B = this.b;
    // the palace is famously white with cobalt-blue trim
    const white = new THREE.MeshStandardMaterial({ color: 0xf6f2e8, roughness: 0.86 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x1b4f9c, roughness: 0.7 });

    // walled forecourt with a gate on the street
    B.add('fortWhite', white, BOX, L(mat(0, 3.0, 12, 46, 6.0, 1.1)));
    this._archOpening(L, { key: 'fortGate', mat: white, x: 0, z: 12, W: 12, H: 10.5, D: 1.6, aw: 5.0, ah: 4.2, doors: true });
    for (const s of [-1, 1]) {
      B.add('fortWhite', white, BOX, L(mat(s * 22.6, 4.4, 12, 2.4, 8.8, 2.4)));
      B.add('fortBlue', blue, SPH, L(mat(s * 22.6, 9.4, 12, 1.0, 1.2, 1.0)));
    }

    // main block: two storeys of arcaded galleries
    B.add('fortWhite', white, BOX, L(mat(0, 7.5, -6, 42, 15, 22)));
    for (let f = 0; f < 2; f++) {
      const y = 3.6 + f * 6.4;
      for (let k = -4; k <= 4; k++) {
        this._archOpening(L, {
          key: 'fortArc', mat: white, x: k * 4.4, z: 5.2, W: 4.2, H: 6.2, D: 0.9,
          aw: 2.6, ah: 3.0, yBase: y - 3.4, recess: true,
        });
      }
      B.add('fortBlue', blue, BOX, L(mat(0, y + 3.1, 5.4, 42, 0.5, 1.4)));
    }
    // crenellated roofline
    for (let k = -10; k <= 10; k++) {
      B.add('fortWhite', white, BOX, L(mat(k * 2.05, 15.6, 5.0, 1.2, 1.4, 1.2)));
      B.add('fortWhite', white, BOX, L(mat(k * 2.05, 15.6, -17.0, 1.2, 1.4, 1.2)));
    }

    // the two round seaward towers with conical caps
    for (const s of [-1, 1]) {
      B.add('fortWhite', white, CYL_HI, L(mat(s * 19, 11, -16, 4.2, 22, 4.2)));
      B.add('fortWhite', white, CYL_HI, L(mat(s * 19, 22.4, -16, 4.9, 0.9, 4.9)));
      B.add('fortBlue', blue, CONE, L(mat(s * 19, 25.4, -16, 5.0, 5.2, 5.0)));
      B.add('trim', M.trim, SPH, L(mat(s * 19, 28.4, -16, 0.5, 0.7, 0.5)));
      for (let k = 0; k < 5; k++) {
        const a = -1.0 + k * 0.5;
        B.add('reveal', M.reveal, BOX,
          L(mat(s * 19 + Math.sin(a) * 4.2, 15, -16 + Math.cos(a) * 4.2, 0.5, 1.6, 0.4, 0, a, 0)));
      }
    }
    this._flag(new THREE.Vector3(0, 0, 0).applyMatrix4(L(mat(-15, 15.5, 6, 1, 1, 1))), yaw);
  }

  /* ------------------- La Princesa (old city jail) ------------------ */
  _laPrincesa(pos, yaw) {
    const M = this.M;
    const L = this.local(pos, yaw);
    const B = this.b;
    const cream = new THREE.MeshStandardMaterial({ color: 0xf3e2c0, roughness: 0.9 });

    B.add('prinBody', cream, BOX, L(mat(0, 5, -5, 34, 10, 14)));
    B.add('trim', M.trim, BOX, L(mat(0, 10.3, -5, 35.4, 0.7, 15.4)));
    B.add('roof', M.roof, BOX, L(mat(0, 10.9, -5, 35, 0.5, 15)));
    // central pedimented bay
    B.add('prinBody', cream, BOX, L(mat(0, 6, 2.6, 11, 12, 3)));
    B.add('trim', M.trim, CONE, L(mat(0, 13.4, 2.6, 8.0, 2.6, 3.4, 0, Math.PI / 4, 0)));
    this._archOpening(L, { key: 'prinDoor', mat: cream, x: 0, z: 4.2, W: 4.4, H: 7.0, D: 0.8, aw: 2.8, ah: 3.4, doors: true });
    for (let k = -3; k <= 3; k++) {
      if (k === 0) continue;
      for (let f = 0; f < 2; f++) {
        this._archOpening(L, {
          key: 'prinWin', mat: cream, x: k * 4.6, z: 2.1, W: 3.0, H: 4.6, D: 0.7,
          aw: 1.8, ah: 2.4, yBase: 1.2 + f * 5.0, recess: true, bars: true,
        });
      }
    }
    // watch turret — it was a prison, after all
    B.add('prinBody', cream, CYL_HI, L(mat(15, 12, -10, 2.6, 4, 2.6)));
    B.add('roof', M.roof, CONE, L(mat(15, 15.4, -10, 3.2, 3.0, 3.2)));
  }

  /* -------------- Fuente Raíces, Paseo de la Princesa -------------- */
  _fuenteRaices(pos, yaw) {
    const M = this.M;
    const L = this.local(pos, yaw);
    const B = this.b;
    const bronze = new THREE.MeshStandardMaterial({
      color: 0x5a6b52, roughness: 0.42, metalness: 0.9, envMapIntensity: 1.4,
    });

    // stepped granite basin
    B.add('stone', M.stone, CYL_HI, L(mat(0, 0.3, 0, 9.2, 0.6, 9.2)));
    B.add('stone', M.stone, CYL_HI, L(mat(0, 0.85, 0, 8.2, 0.5, 8.2)));
    B.add('stone', M.stone, TORUS, L(mat(0, 1.1, 0, 8.0, 8.0, 8.0, Math.PI / 2)));
    const pool = new THREE.CircleGeometry(7.8, 40);
    pool.rotateX(-Math.PI / 2);
    this.bNoShadow.add('fountainWater', M.water, pool, L(mat(0, 1.0, 0, 1, 1, 1)));

    // the tangle of bronze roots, dolphins and figures at the centre
    B.add('fuenteBronze', bronze, CYL, L(mat(0, 2.6, 0, 1.5, 3.4, 1.5)));
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      const r = 2.6;
      B.add('fuenteBronze', bronze, CYL,
        L(mat(Math.sin(a) * r * 0.6, 1.9, Math.cos(a) * r * 0.6, 0.42, 3.4, 0.42, Math.cos(a) * 0.42, 0, -Math.sin(a) * 0.42)));
      // leaping dolphin heads on the rim
      B.add('fuenteBronze', bronze, SPH_HI,
        L(mat(Math.sin(a) * 4.4, 2.4, Math.cos(a) * 4.4, 0.55, 1.6, 0.55, Math.cos(a) * 0.5, a, -Math.sin(a) * 0.5)));
    }
    B.add('fuenteBronze', bronze, SPH_HI, L(mat(0, 5.0, 0, 2.1, 2.4, 2.1)));
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      this._figure(L, Math.sin(a) * 1.9, 6.0, Math.cos(a) * 1.9, 0.85, bronze, 'fuenteBronze', a);
    }

    // water jets, rendered as translucent tapered columns
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      this.bNoShadow.add('jet', M.water, CONE,
        L(mat(Math.sin(a) * 5.6, 2.6, Math.cos(a) * 5.6, 0.18, 3.2, 0.18, -Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3)));
    }
  }

  /* ------------------ Puerta de San Juan (1635) -------------------- */
  _puertaSanJuan(pos, yaw) {
    const M = this.M;
    const L = this.local(pos, yaw);
    const B = this.b;

    // a deep tunnel through the muralla, faced in cream render
    const face = new THREE.MeshStandardMaterial({ color: 0xefe4cc, roughness: 0.92 });
    B.add('gateStone', M.stone, BOX, L(mat(0, 9, 0, 26, 18, 9)));
    B.add('gateFace', face, BOX, L(mat(0, 8.6, 4.6, 15, 17.2, 0.5)));
    this._archOpening(L, {
      key: 'sjGate', mat: face, x: 0, z: 4.9, W: 12, H: 13, D: 10.0,
      aw: 6.4, ah: 6.0, doors: true, doorColor: 0x9d2b1f, tunnel: true,
    });
    // the inscription tablet and royal arms above the arch
    B.add('trim', M.trim, BOX, L(mat(0, 12.6, 5.1, 5.6, 2.4, 0.4)));
    B.add('brass', M.brass, SPH, L(mat(0, 14.6, 5.2, 1.2, 1.4, 0.6)));
    // crenellated top
    for (let k = -6; k <= 6; k++) {
      B.add('gateStone', M.stone, BOX, L(mat(k * 2.0, 18.7, 3.6, 1.3, 1.6, 1.3)));
    }
    this._flag(new THREE.Vector3(0, 0, 0).applyMatrix4(L(mat(0, 19, 0, 1, 1, 1))), yaw);
  }

  /* -------------------------- La Rogativa -------------------------- */
  _rogativa(pos, yaw) {
    const M = this.M;
    const L = this.local(pos, yaw);
    const bronze = new THREE.MeshStandardMaterial({
      color: 0x4e5a4a, roughness: 0.45, metalness: 0.85, envMapIntensity: 1.3,
    });
    this.b.add('stone', M.stone, BOX, L(mat(0, 0.5, 0, 7.5, 1.0, 4.0)));
    // the bishop leading three women with torches
    this._figure(L, -2.2, 1.0, 0, 1.15, bronze, 'rogativa', 0.2, true);
    for (let k = 0; k < 3; k++) {
      const x = 0.2 + k * 1.5;
      this._figure(L, x, 1.0, (k % 2) * 0.7 - 0.35, 1.0, bronze, 'rogativa', 0.15 * k);
      // raised torch with a live flame
      this.b.add('rogativa', bronze, CYL, L(mat(x + 0.55, 3.4, 0.35, 0.09, 1.5, 0.09, 0.35, 0, -0.3)));
      this.bNoShadow.add('lamp', M.lamp, SPH, L(mat(x + 0.95, 4.15, 0.5, 0.3, 0.42, 0.3)));
    }
  }

  /* ------------ Cementerio Santa María Magdalena de Pazzis --------- */
  _cementerio(pos, yaw) {
    const M = this.M;
    const L = this.local(pos, yaw);
    const B = this.b;
    const marble = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.62 });

    // perimeter wall against the Atlantic cliff
    B.add('stone', M.stone, BOX, L(mat(0, 1.6, 16, 62, 3.2, 0.8)));
    for (const s of [-1, 1]) B.add('stone', M.stone, BOX, L(mat(s * 31, 1.6, 0, 0.8, 3.2, 32)));

    // the neoclassical circular chapel
    B.add('cemMarble', marble, CYL_HI, L(mat(0, 3.2, -6, 6.4, 6.4, 6.4)));
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      B.add('cemMarble', marble, CYL,
        L(mat(Math.sin(a) * 6.6 + 0, 3.2, Math.cos(a) * 6.6 - 6, 0.42, 6.4, 0.42)));
    }
    B.add('cemMarble', marble, CYL_HI, L(mat(0, 6.7, -6, 7.4, 0.7, 7.4)));
    B.add('cemMarble', marble, SPH_HI, L(mat(0, 7.0, -6, 6.2, 5.0, 6.2)));
    B.add('trim', M.trim, CYL, L(mat(0, 12.4, -6, 0.16, 2.2, 0.16)));
    B.add('trim', M.trim, BOX, L(mat(0, 12.9, -6, 1.1, 0.18, 0.18)));

    // ranks of white tombs, crosses and angels
    for (let k = 0; k < 44; k++) {
      const x = -28 + (k % 11) * 5.5 + this.r(-0.6, 0.6);
      const z = 8 - Math.floor(k / 11) * 6.5 + this.r(-0.5, 0.5);
      const h = this.r(1.0, 2.4);
      B.add('cemMarble', marble, BOX, L(mat(x, h / 2, z, 2.0, h, 3.0)));
      if (this.rnd() < 0.5) {
        B.add('cemMarble', marble, BOX, L(mat(x, h + 0.9, z, 0.24, 1.8, 0.24)));
        B.add('cemMarble', marble, BOX, L(mat(x, h + 1.35, z, 1.0, 0.24, 0.24)));
      } else if (this.rnd() < 0.4) {
        this._figure(L, x, h, z, 0.8, marble, 'cemMarble', this.r(-0.6, 0.6));
      } else {
        B.add('cemMarble', marble, CYL, L(mat(x, h + 0.8, z, 0.5, 1.6, 0.5)));
        B.add('cemMarble', marble, SPH, L(mat(x, h + 1.8, z, 0.55, 0.6, 0.55)));
      }
    }
  }

  /* --------------------- Casa Blanca (1521) ------------------------ */
  _casaBlanca(pos, yaw) {
    const M = this.M;
    const L = this.local(pos, yaw);
    const B = this.b;
    const white = new THREE.MeshStandardMaterial({ color: 0xf7f4ea, roughness: 0.9 });

    B.add('cbWall', white, BOX, L(mat(0, 4.5, -4, 30, 9, 16)));
    B.add('roof', M.roof, makeGableRoof(31, 17, 3.4), L(mat(0, 9, -4, 1, 1, 1)));
    // shaded arcaded loggia facing the garden
    for (let k = -3; k <= 3; k++) {
      this._archOpening(L, {
        key: 'cbArc', mat: white, x: k * 4.0, z: 4.2, W: 3.8, H: 6.4, D: 1.0,
        aw: 2.6, ah: 3.2, recess: true,
      });
    }
    B.add('trim', M.trim, BOX, L(mat(0, 6.9, 4.5, 30, 0.4, 1.6)));
    // walled garden with a wellhead and palms
    B.add('cbWall', white, BOX, L(mat(0, 1.4, 12, 30, 2.8, 0.7)));
    B.add('stone', M.stone, CYL_HI, L(mat(-9, 1.0, 8.5, 1.5, 2.0, 1.5)));
    B.add('iron', M.iron, TORUS, L(mat(-9, 2.4, 8.5, 1.2, 1.2, 1.2, Math.PI / 2)));
    for (const x of [8, 12]) this._palm(new THREE.Vector3(0, 0, 0).applyMatrix4(L(mat(x, 0, 8, 1, 1, 1))), this.r(0, 6.28));
  }

  /* ---------------------- Tótem Telúrico --------------------------- */
  _totem(pos, yaw) {
    const M = this.M;
    const L = this.local(pos, yaw);
    const B = this.b;
    const clay = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.55, metalness: 0.1 });
    const glaze = new THREE.MeshStandardMaterial({
      color: 0x2f8fa8, roughness: 0.25, metalness: 0.2, envMapIntensity: 1.6,
    });

    // stepped granite plaza
    for (let k = 0; k < 3; k++) {
      B.add('stone', M.stone, CYL_HI, L(mat(0, 0.22 + k * 0.4, 0, 12 - k * 2.6, 0.42, 12 - k * 2.6)));
    }
    // the 40-foot ceramic column
    let y = 1.2;
    for (let k = 0; k < 9; k++) {
      const w = 2.4 - k * 0.14;
      const h = 1.5 + (k % 2) * 0.5;
      B.add(k % 2 ? 'totemGlaze' : 'totemClay', k % 2 ? glaze : clay, BOX,
        L(mat(0, y + h / 2, 0, w, h, w, 0, k * 0.16, 0)));
      y += h;
    }
    B.add('totemGlaze', glaze, CONE, L(mat(0, y + 1.1, 0, 1.5, 2.2, 1.5)));
  }

  /* ----------------------- Plaza de Colón -------------------------- */
  _plazaColon(pos, yaw) {
    const M = this.M;
    const L = this.local(pos, yaw);
    const B = this.b;
    const marble = new THREE.MeshStandardMaterial({ color: 0xe9e3d4, roughness: 0.7 });
    const bronze = new THREE.MeshStandardMaterial({
      color: 0x53614c, roughness: 0.45, metalness: 0.85, envMapIntensity: 1.3,
    });

    // paved square with benches and lamps around a central column
    const paving = new THREE.CircleGeometry(15, 36);
    paving.rotateX(-Math.PI / 2);
    this.bNoShadow.add('plazaPave', M.trim, paving, L(mat(0, 0.06, 0, 1, 1, 1)));
    B.add('colonBase', marble, BOX, L(mat(0, 0.9, 0, 6.5, 1.8, 6.5)));
    B.add('colonBase', marble, BOX, L(mat(0, 2.4, 0, 4.4, 1.4, 4.4)));
    B.add('colonBase', marble, CYL_HI, L(mat(0, 8.0, 0, 1.5, 10.0, 1.5)));
    B.add('colonBase', marble, CYL_HI, L(mat(0, 13.2, 0, 2.1, 0.6, 2.1)));
    this._figure(L, 0, 13.5, 0, 1.9, bronze, 'colonBronze', 0.3, true);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const p = new THREE.Vector3(0, 0, 0).applyMatrix4(L(mat(Math.sin(a) * 12, 0, Math.cos(a) * 12, 1, 1, 1)));
      if (k % 2) this._lamppost(p, yaw + a);
      else this._bench(p, yaw + a);
    }
    for (const s of [-1, 1]) {
      this._tree(new THREE.Vector3(0, 0, 0).applyMatrix4(L(mat(s * 16, 0, -8, 1, 1, 1))), M.flamboyan);
    }
  }

  /* --------------- Catedral de San Juan Bautista ------------------- */
  _catedral(pos, yaw) {
    const M = this.M;
    const L = this.local(pos, yaw);
    const B = this.b;
    const cream = new THREE.MeshStandardMaterial({ color: 0xf5ecd8, roughness: 0.88 });

    // nave
    B.add('catWall', cream, BOX, L(mat(0, 9, -12, 24, 18, 30)));
    B.add('roof', M.roof, makeGableRoof(25, 31, 4.2), L(mat(0, 18, -12, 1, 1, 1)));
    // aisles
    for (const s of [-1, 1]) {
      B.add('catWall', cream, BOX, L(mat(s * 15, 5.5, -12, 6, 11, 28)));
      B.add('roof', M.roof, makeGableRoof(6.4, 29, 1.6), L(mat(s * 15, 11, -12, 1, 1, 1)));
    }
    // crossing dome on a drum
    B.add('catWall', cream, CYL_HI, L(mat(0, 19.5, -20, 7.0, 5.0, 7.0)));
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      B.add('reveal', M.reveal, BOX,
        L(mat(Math.sin(a) * 6.9, 20.0, -20 + Math.cos(a) * 6.9, 1.4, 3.0, 0.4, 0, a, 0)));
    }
    B.add('roof', M.roof, SPH_HI, L(mat(0, 22.0, -20, 7.6, 6.6, 7.6)));
    B.add('trim', M.trim, CYL_HI, L(mat(0, 28.4, -20, 1.2, 1.6, 1.2)));
    B.add('brass', M.brass, BOX, L(mat(0, 30.2, -20, 0.2, 2.0, 0.2)));
    B.add('brass', M.brass, BOX, L(mat(0, 30.5, -20, 1.1, 0.2, 0.2)));

    // west front: portal, rose window, twin bell towers
    this._archOpening(L, { key: 'catDoor', mat: cream, x: 0, z: 3.2, W: 8.0, H: 12.0, D: 1.4, aw: 4.6, ah: 5.6, doors: true, doorColor: 0x5a3a20 });
    B.add('reveal', M.reveal, CYL_HI, L(mat(0, 14.0, 3.1, 2.4, 2.4, 0.5, Math.PI / 2)));
    B.add('trim', M.trim, TORUS, L(mat(0, 14.0, 3.4, 2.7, 2.7, 2.7)));
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI;
      B.add('trim', M.trim, BOX, L(mat(0, 14.0, 3.5, 5.0, 0.22, 0.22, 0, 0, a)));
    }
    B.add('trim', M.trim, CONE, L(mat(0, 20.4, 2.0, 13.5, 3.6, 4.0, 0, Math.PI / 4, 0)));
    for (const s of [-1, 1]) {
      B.add('catWall', cream, BOX, L(mat(s * 15, 13, 2.0, 7.4, 26, 7.4)));
      for (let f = 0; f < 2; f++) {
        this._archOpening(L, {
          key: 'catBell', mat: cream, x: s * 15, z: 5.6, W: 4.6, H: 6.0, D: 0.7,
          aw: 2.8, ah: 3.0, yBase: 14 + f * 6.5, recess: true,
        });
      }
      B.add('trim', M.trim, BOX, L(mat(s * 15, 26.4, 2.0, 8.6, 0.8, 8.6)));
      B.add('roof', M.roof, CONE, L(mat(s * 15, 29.2, 2.0, 5.4, 5.0, 5.4, 0, Math.PI / 4, 0)));
      B.add('brass', M.brass, SPH, L(mat(s * 15, 32.0, 2.0, 0.5, 0.7, 0.5)));
      // the bell itself, visible in the belfry
      B.add('brass', M.brass, CONE, L(mat(s * 15, 16.6, 4.4, 1.0, 1.5, 1.0, Math.PI)));
    }
  }

  /* -------------------- Capilla del Cristo ------------------------- */
  _capillaCristo(pos, yaw) {
    const M = this.M;
    const L = this.local(pos, yaw);
    const B = this.b;
    const cream = new THREE.MeshStandardMaterial({ color: 0xf0e2c4, roughness: 0.9 });

    B.add('capWall', cream, BOX, L(mat(0, 3.4, -3, 9, 6.8, 8)));
    B.add('roof', M.roof, makeGableRoof(9.6, 8.6, 1.8), L(mat(0, 6.8, -3, 1, 1, 1)));
    // the little bell gable that everyone photographs
    B.add('capWall', cream, BOX, L(mat(0, 8.6, 0.6, 5.4, 4.0, 0.7)));
    B.add('capWall', cream, CONE, L(mat(0, 11.4, 0.6, 3.6, 1.8, 1.0, 0, Math.PI / 4, 0)));
    B.add('reveal', M.reveal, CYL_HI, L(mat(0, 9.0, 0.6, 1.1, 1.1, 0.9, Math.PI / 2)));
    B.add('brass', M.brass, CONE, L(mat(0, 9.2, 0.6, 0.5, 0.8, 0.5, Math.PI)));
    B.add('trim', M.trim, SPH, L(mat(0, 12.6, 0.6, 0.36, 0.5, 0.36)));
    this._archOpening(L, { key: 'capDoor', mat: cream, x: 0, z: 1.1, W: 4.0, H: 5.6, D: 0.7, aw: 2.2, ah: 2.8, doors: true, doorColor: 0x4a2d17 });
    // wrought-iron gate flanking it, and the pigeon park's shade tree
    for (const s of [-1, 1]) {
      B.add('iron', M.iron, BOX, L(mat(s * 5.6, 1.8, 1.0, 0.18, 3.6, 0.18)));
      for (let k = 0; k < 6; k++) {
        B.add('iron', M.iron, BOX, L(mat(s * (5.6 + 0.55 + k * 0.5), 1.8, 1.0, 0.09, 3.2, 0.09)));
      }
    }
    this._tree(new THREE.Vector3(0, 0, 0).applyMatrix4(L(mat(9.5, 0, 4, 1, 1, 1))), M.canopy);
  }

  /* ----------------- bay traffic: ships and sailboats -------------- */
  _bayTraffic() {
    const t = this.track;
    const M = this.M;
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.55 });
    const hull = new THREE.MeshStandardMaterial({ color: 0x18324f, roughness: 0.45, metalness: 0.25 });
    const sail = new THREE.MeshStandardMaterial({ color: 0xfbfbf6, roughness: 0.9, side: THREE.DoubleSide });

    const berth = (frac, lat, len, rot) => {
      const i = Math.floor(frac * t.n);
      const { p } = this.facing(i, lat);
      p.y = -7.5; // sea level
      return this.local(p, rot);
    };

    // a cruise ship at the Pier 3 berth
    {
      const L = berth(0.30, 430, 0, 0.35);
      const stripe = new THREE.MeshStandardMaterial({ color: 0xd23b3b, roughness: 0.5 });
      this.b.add('shipHull', hull, BOX, L(mat(0, 3, 0, 190, 16, 30)));
      this.b.add('shipHull', hull, CONE, L(mat(-102, 3, 0, 16, 26, 30, 0, 0, -Math.PI / 2)));
      this.b.add('shipStripe', stripe, BOX, L(mat(0, 9.6, 0, 190.4, 1.1, 30.4)));
      for (let d = 0; d < 5; d++) {
        this.b.add('shipWhite', white, BOX, L(mat(4, 13.5 + d * 5, 0, 168 - d * 12, 5, 28 - d * 1.6)));
        // window bands so the decks don't read as blank slabs
        this.b.add('shipGlass', M.glass, BOX, L(mat(4, 13.5 + d * 5, 0, 168.4 - d * 12, 2.0, 28.4 - d * 1.6)));
      }
      this.b.add('shipWhite', white, BOX, L(mat(46, 39, 0, 30, 6, 24)));
      this.b.add('shipWhite', white, BOX, L(mat(-38, 39, 0, 22, 6, 22)));
      this.b.add('shipStripe', stripe, CYL_HI, L(mat(-38, 46, 0, 7, 16, 9)));
      this.b.add('shipHull', hull, BOX, L(mat(-38, 55, 0, 16, 2.4, 12)));
    }

    // a smaller ferry crossing the bay
    {
      const L = berth(0.26, 330, 0, -0.6);
      this.b.add('shipHull', hull, BOX, L(mat(0, 1.2, 0, 46, 8, 12)));
      this.b.add('shipWhite', white, BOX, L(mat(0, 7, 0, 34, 4, 10)));
      this.b.add('shipWhite', white, BOX, L(mat(-8, 10.6, 0, 10, 3.4, 8)));
    }

    // sailboats scattered across the water
    for (let k = 0; k < 14; k++) {
      const frac = 0.20 + this.r(0, 0.16);
      const L = berth(frac, 130 + this.r(0, 260), 0, this.r(0, 6.28));
      this.bNoShadow.add('boatHull', white, SPH_HI, L(mat(0, 0.4, 0, 3.6, 1.6, 1.3)));
      this.bNoShadow.add('boatMast', white, CYL, L(mat(0, 4.6, 0, 0.12, 8, 0.12)));
      const s1 = new THREE.PlaneGeometry(3.4, 6.4);
      s1.translate(1.7, 0, 0);
      this.bNoShadow.add('boatSail', sail, s1, L(mat(0, 4.6, 0, 1, 1, 1, 0, Math.PI / 2, 0)));
    }
  }

  /* ------------- chiringas: kites over the Campo del Morro --------- */
  _chiringas() {
    const t = this.track;
    const colors = [0xff4d4d, 0xffd23f, 0x4fd6ff, 0x7fe07f, 0xff7ad0, 0xffffff];
    for (let k = 0; k < 16; k++) {
      const frac = 0.44 + this.r(0, 0.12);
      const i = Math.floor(frac * t.n);
      const { p } = this.facing(i, this.r(-70, 70));
      const h = this.r(22, 48);
      const yaw = this.r(0, 6.28);
      const L = this.local(new THREE.Vector3(p.x, p.y + h, p.z), yaw);
      const c = colors[k % colors.length];
      const kite = new THREE.MeshStandardMaterial({
        color: c, roughness: 0.7, side: THREE.DoubleSide, emissive: c, emissiveIntensity: 0.08,
      });
      // diamond sail
      const d = new THREE.PlaneGeometry(2.6, 3.4);
      this.bNoShadow.add('kite' + (k % 6), kite, d, L(mat(0, 0, 0, 1, 1, 1, this.r(-0.4, 0.4), 0, Math.PI / 4)));
      // tail streamers
      for (let s = 1; s <= 5; s++) {
        this.bNoShadow.add('kite' + (k % 6), kite, BOX,
          L(mat(Math.sin(s * 1.3) * 0.5, -1.8 - s * 1.0, 0, 0.5, 0.35, 0.05)));
      }
      // string down to a tiny figure on the glacis
      const len = h - 1.6;
      this.bNoShadow.add('kiteString', this.M.cable, CYL,
        L(mat(0, -len / 2 - 1.4, len * 0.12, 0.035, len, 0.035, -0.12, 0, 0)));
    }
  }

  /* ------------------------------------------------------------------ *
   * Shared landmark primitives
   * ------------------------------------------------------------------ */

  /**
   * A round-arched opening in a wall: piers, voussoirs, a dark reveal and
   * optionally studded timber doors or a barrel-vaulted tunnel.
   */
  _archOpening(L, o) {
    const M = this.M;
    const B = this.b;
    const {
      key, mat: wallMat, x = 0, z = 0, W, H, D, aw, ah, yBase = 0,
      recess = false, doors = false, bars = false, tunnel = false,
      doorColor = 0x7a3b1e,
    } = o;
    const R = aw / 2;
    const top = ah + R;

    // wall either side of the opening and the spandrel above
    const side = (W - aw) / 2;
    for (const s of [-1, 1]) {
      B.add(key, wallMat, BOX, L(mat(x + s * (aw / 2 + side / 2), yBase + H / 2, z, side, H, D)));
    }
    B.add(key, wallMat, BOX, L(mat(x, yBase + top + (H - top) / 2, z, W, H - top, D)));

    // voussoir ring
    const N = 11;
    for (let k = 0; k <= N; k++) {
      const a = (k / N) * Math.PI;
      B.add(key, wallMat, BOX, L(mat(
        x - Math.cos(a) * (R + 0.28), yBase + ah + Math.sin(a) * (R + 0.28), z,
        0.42, 0.62, D * 1.02, 0, 0, -a
      )));
    }
    // keystone
    B.add('trim', M.trim, BOX, L(mat(x, yBase + top + 0.32, z, 0.6, 0.9, D * 1.06)));

    // dark interior so the opening reads as a hole rather than a panel
    const depth = tunnel ? D : 0.35;
    B.add('reveal', M.reveal, BOX, L(mat(x, yBase + ah / 2, z - depth / 2 - 0.05, aw, ah, depth)));
    B.add('reveal', M.reveal, CYL_HI, L(mat(x, yBase + ah, z - depth / 2 - 0.05, R, depth, R, Math.PI / 2)));

    if (tunnel) {
      // barrel vault continuing through the wall
      for (const s of [-1, 1]) {
        B.add(key, wallMat, BOX, L(mat(x + s * (R + 0.3), yBase + ah / 2, z - D / 2, 0.6, ah, D)));
      }
    }

    if (recess) {
      // shallow reveal only: add a sill and a shutter-dark pane
      B.add('trim', M.trim, BOX, L(mat(x, yBase + 0.12, z + D * 0.45, aw + 0.7, 0.24, 0.5)));
    }

    if (bars) {
      for (let k = 0; k < 5; k++) {
        B.add('iron', M.iron, BOX, L(mat(x - aw / 2 + (k + 0.5) * (aw / 5), yBase + (ah + R * 0.6) / 2, z + D * 0.4, 0.07, ah + R * 0.6, 0.07)));
      }
    }

    if (doors) {
      const wood = new THREE.MeshStandardMaterial({ color: doorColor, roughness: 0.72 });
      for (const s of [-1, 1]) {
        B.add(key + 'Door', wood, BOX, L(mat(x + s * aw / 4, yBase + ah / 2, z - 0.18, aw / 2 - 0.05, ah, 0.22)));
        // half-round leaf following the arch
        B.add(key + 'Door', wood, CYL_HI, L(mat(x, yBase + ah, z - 0.18, R - 0.04, 0.22, R - 0.04, Math.PI / 2)));
        // iron studs
        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 2; c++) {
            B.add('brass', M.brass, SPH, L(mat(
              x + s * (aw / 4 - 0.35 + c * 0.7), yBase + 0.7 + r * (ah / 4), z - 0.3, 0.09, 0.09, 0.09
            )));
          }
        }
      }
    }
  }

  /** A stylised standing figure — good enough for statues at race speed. */
  _figure(L, x, y, z, s, material, key, rot = 0, robed = false) {
    const B = this.b;
    const M = (px, py, pz, sx, sy, sz, rx = 0, ry = 0, rz = 0) =>
      L(mat(x + px * s, y + py * s, z + pz * s, sx * s, sy * s, sz * s, rx, ry + rot, rz));
    if (robed) {
      B.add(key, material, CONE, M(0, 0.65, 0, 0.42, 1.3, 0.42));
    } else {
      for (const side of [-1, 1]) {
        B.add(key, material, CYL, M(side * 0.11, 0.35, 0, 0.09, 0.72, 0.09));
      }
      B.add(key, material, BOX, M(0, 0.95, 0, 0.34, 0.5, 0.2));
    }
    B.add(key, material, BOX, M(0, 1.28, 0, 0.36, 0.42, 0.22));
    // arms: one raised, one at rest — reads as gesture from a distance
    B.add(key, material, CYL, M(-0.26, 1.3, 0.02, 0.07, 0.5, 0.07, 0.2, 0, 0.35));
    B.add(key, material, CYL, M(0.28, 1.5, 0.05, 0.07, 0.55, 0.07, -0.4, 0, -0.7));
    B.add(key, material, SPH, M(0, 1.62, 0, 0.13, 0.15, 0.13));
  }


  _placeStartGate() {
    const t = this.track;
    const M = this.M;
    const i = 0;
    const { p, yaw } = this.frame(i, 0);
    const w = t.width[i];
    const base = new THREE.Matrix4().compose(
      p.clone(), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1)
    );
    const L = (m) => base.clone().multiply(m);

    const H = 13.5;
    // stone piers
    for (const s of [-1, 1]) {
      this.b.add('stone', M.stone, BOX, L(mat(s * (w + 1.6), H / 2, 0, 1.7, H, 1.7)));
      this.b.add('trim', M.trim, BOX, L(mat(s * (w + 1.6), H + 0.3, 0, 2.3, 0.45, 2.3)));
      this.b.add('stone', M.stone, SPH, L(mat(s * (w + 1.6), H + 1.0, 0, 0.62, 0.8, 0.62)));
      // flag on each pier
      this.bNoShadow.add('gateflag' + s, new THREE.MeshStandardMaterial({
        color: s > 0 ? 0xed1c24 : 0x0050a4, roughness: 0.8, side: THREE.DoubleSide,
      }), BOX, L(mat(s * (w + 1.6), H + 3.0, 0, 0.06, 2.2, 1.6)));
      this.b.add('iron', M.iron, CYL, L(mat(s * (w + 1.6), H + 2.6, 0, 0.06, 4.0, 0.06)));
    }
    // truss beam
    this.b.add('iron', M.iron, BOX, L(mat(0, H - 0.3, 0, (w + 2.6) * 2, 0.28, 0.7)));
    this.b.add('iron', M.iron, BOX, L(mat(0, H + 1.4, 0, (w + 2.6) * 2, 0.28, 0.7)));
    for (let k = -6; k <= 6; k++) {
      this.b.add('iron', M.iron, BOX, L(mat(k * (w + 2.6) / 6.5, H + 0.55, 0, 0.16, 1.9, 0.5, 0, 0, k % 2 ? 0.5 : -0.5)));
    }
    // banner across the truss
    this.bNoShadow.add('banner', bannerMaterial(), BOX, L(mat(0, H + 0.55, 0.42, (w + 1.9) * 2, 2.0, 0.06)));

    // checkered start line painted on the adoquines
    const checker = makeCheckerMaterial();
    const line = new THREE.PlaneGeometry(w * 2, 2.6);
    line.rotateX(-Math.PI / 2);
    const lineMesh = new THREE.Mesh(line, checker);
    lineMesh.position.copy(p).add(new THREE.Vector3(0, 0.16, 0));
    lineMesh.rotation.y = yaw;
    lineMesh.receiveShadow = true;
    lineMesh.renderOrder = 1;
    lineMesh.material.polygonOffset = true;
    lineMesh.material.polygonOffsetFactor = -2;
    this.group.add(lineMesh);
  }
}

/* ------------------------------ helpers ------------------------------ */
function makeFrond(len, width, droop) {
  const segs = 7;
  const verts = [], idx = [], uvs = [], norms = [];
  for (let s = 0; s <= segs; s++) {
    const f = s / segs;
    const y = -Math.pow(f, 2.1) * droop * len * 0.75;
    const z = f * len;
    const w = width * Math.sin(Math.min(1, f * 1.4) * Math.PI * 0.85) * (1 - f * 0.25);
    verts.push(-w, y, z, 0, y + w * 0.16, z, w, y, z);
    uvs.push(0, f, 0.5, f, 1, f);
    norms.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
  }
  for (let s = 0; s < segs; s++) {
    const a = s * 3;
    idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
    idx.push(a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Eight-panel parasol with a scalloped, sagging rim. */
/** Triangular prism roof: `span` across the facade, `depth` front-to-back. */
function makeGableRoof(span, depth, rise) {
  const g = new THREE.CylinderGeometry(rise, rise, span, 3, 1);
  g.rotateZ(Math.PI / 2);
  g.rotateX(-Math.PI / 2);
  g.scale(1, 1, depth / (rise * Math.sqrt(3)));
  return g;
}

function makeUmbrella(radius = 1.35, rise = 0.5) {
  const panels = 8, rings = 4;
  const verts = [], uvs = [], idx = [];
  verts.push(0, rise, 0); uvs.push(0.5, 0.5);
  for (let ring = 1; ring <= rings; ring++) {
    const f = ring / rings;
    for (let p = 0; p < panels * 2; p++) {
      const a = (p / (panels * 2)) * Math.PI * 2;
      // rim scallops: panel seams stay high, panel middles sag
      const seam = p % 2 === 0 ? 1 : 0;
      const r = radius * f * (seam ? 1.0 : 1.06);
      const y = rise * (1 - Math.pow(f, 1.6)) - (seam ? 0 : 0.1 * f * f);
      verts.push(Math.cos(a) * r, y, Math.sin(a) * r);
      uvs.push(0.5 + Math.cos(a) * f * 0.5, 0.5 + Math.sin(a) * f * 0.5);
    }
  }
  const per = panels * 2;
  for (let p = 0; p < per; p++) {
    idx.push(0, 1 + p, 1 + ((p + 1) % per));
  }
  for (let ring = 1; ring < rings; ring++) {
    const b0 = 1 + (ring - 1) * per;
    const b1 = 1 + ring * per;
    for (let p = 0; p < per; p++) {
      const q = (p + 1) % per;
      idx.push(b0 + p, b1 + p, b0 + q, b0 + q, b1 + p, b1 + q);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function makeStar() {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.42 : 1.0;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false });
  g.center();
  return g;
}

let _bannerMat = null;
function bannerMaterial() {
  if (_bannerMat) return _bannerMat;
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 128;
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, '#0b4fa0');
  g.addColorStop(1, '#06356e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 128);
  ctx.fillStyle = '#ed1c24';
  ctx.fillRect(0, 0, 1024, 10);
  ctx.fillRect(0, 118, 1024, 10);
  ctx.fillStyle = '#ffd23f';
  ctx.font = 'bold 74px Bungee, Rubik, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('VIEJO SAN JUAN', 512, 68);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 3;
  ctx.strokeText('VIEJO SAN JUAN', 512, 68);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  _bannerMat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, side: THREE.DoubleSide });
  return _bannerMat;
}

let _checkerMat = null;
function makeCheckerMaterial() {
  if (_checkerMat) return _checkerMat;
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const ctx = cv.getContext('2d');
  const cols = 16, rows = 4;
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#101216' : '#f4f4f0';
      ctx.fillRect(x * (256 / cols), y * (64 / rows), 256 / cols, 64 / rows);
    }
  }
  ctx.fillStyle = 'rgba(40,40,45,0.2)';
  for (let i = 0; i < 400; i++) ctx.fillRect(Math.random() * 256, Math.random() * 64, 3, 2);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  _checkerMat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.62, metalness: 0.0 });
  return _checkerMat;
}
