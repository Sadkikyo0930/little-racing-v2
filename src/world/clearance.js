import * as THREE from 'three';

/* ------------------------------------------------------------------ *
 * Barrier baking.
 *
 * The kart used to be stopped by a constant `width + 2.5` limit, which
 * had nothing to do with where the buildings actually stand. On curves
 * the offset compresses, props sit closer than the nominal setback, and
 * the limit ignored the kart's own half-width — so the body visibly sank
 * into the facades.
 *
 * Instead we measure. Every solid triangle is rasterised into a plan-view
 * occupancy grid that also records the vertical extent of what it hit;
 * because vertical surfaces project to lines, walking each triangle's
 * edges captures facades exactly. Then a ray is marched outward from the
 * centre line at every track sample to find the first real obstruction,
 * and the kart's half-width is subtracted.
 *
 * The vertical test has to happen during the march, not during
 * rasterisation: `track.right` is banked, so the road plane climbs as you
 * move outward and a wall 20 m off the centre line can legitimately sit
 * several metres above the centre line's own height.
 * ------------------------------------------------------------------ */

const CELL = 0.5;         // occupancy grid resolution, metres
const NEAR = 8;           // coarse "is this near the circuit" grid, metres
const REACH = 44;         // how far from the road we bother rasterising
const BAND_LO = 0.3;      // obstacle must reach this high above the road…
const BAND_HI = 2.4;      // …and start below this, or the kart passes under
const MAX_RUNOFF = 3.0;   // most shoulder we'll ever allow beyond the kerb
const MIN_CORRIDOR = 6.5; // half-width of racing room we never take away
const STEP = 0.2;         // ray march resolution
const STEEP = 0.5;        // |normal.y| above this is drivable, not a barrier
const SLABS = 64;         // vertical resolution of the occupancy mask
const SLAB = 1.0;         // metres per slab

export function bakeClearance(track, roots, kartHalfWidth = 1.15) {
  const t0 = performance.now();
  const n = track.n;

  /* ------------------------------ bounds ----------------------------- */
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = track.pos[i * 3], z = track.pos[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const pad = REACH + 20;
  minX -= pad; minZ -= pad; maxX += pad; maxZ += pad;

  const gw = Math.ceil((maxX - minX) / CELL) + 1;
  const gh = Math.ceil((maxZ - minZ) / CELL) + 1;
  // Vertical occupancy: one bit per SLAB metres. A plain min/max pair would
  // fuse an awning overhead with a kerb underfoot into a phantom solid column.
  const maskLo = new Uint32Array(gw * gh);
  const maskHi = new Uint32Array(gw * gh);

  let yBase = Infinity;
  for (let i = 0; i < n; i++) yBase = Math.min(yBase, track.pos[i * 3 + 1]);
  yBase -= 8;
  const slabOf = (y) => {
    const s = Math.floor((y - yBase) / SLAB);
    return s < 0 ? 0 : s > SLABS - 1 ? SLABS - 1 : s;
  };
  // bit range [s0..s1] split across the two words
  const bitsLo = (s0, s1) => {
    const a = Math.min(s0, 31), b = Math.min(s1, 31);
    if (s0 > 31) return 0;
    return b - a >= 31 ? 0xffffffff : ((((1 << (b - a + 1)) - 1) << a) >>> 0);
  };
  const bitsHi = (s0, s1) => {
    if (s1 < 32) return 0;
    const a = Math.max(s0, 32) - 32, b = s1 - 32;
    return b - a >= 31 ? 0xffffffff : ((((1 << (b - a + 1)) - 1) << a) >>> 0);
  };

  /* ------------------------- near-track mask ------------------------- */
  // Purely an optimisation: skip rasterising the half of the island the
  // player can never reach from the road.
  const nw = Math.ceil((maxX - minX) / NEAR) + 1;
  const nh = Math.ceil((maxZ - minZ) / NEAR) + 1;
  const near = new Uint8Array(nw * nh);
  const span = Math.ceil(REACH / NEAR);
  for (let i = 0; i < n; i++) {
    const cx = Math.floor((track.pos[i * 3] - minX) / NEAR);
    const cz = Math.floor((track.pos[i * 3 + 2] - minZ) / NEAR);
    for (let dz = -span; dz <= span; dz++) {
      const jz = cz + dz;
      if (jz < 0 || jz >= nh) continue;
      for (let dx = -span; dx <= span; dx++) {
        const jx = cx + dx;
        if (jx >= 0 && jx < nw) near[jz * nw + jx] = 1;
      }
    }
  }
  const isNear = (x, z) => {
    const jx = (x - minX) / NEAR | 0, jz = (z - minZ) / NEAR | 0;
    return jx >= 0 && jx < nw && jz >= 0 && jz < nh && near[jz * nw + jx] === 1;
  };

  /* ------------------------- rasterise geometry ---------------------- */
  let triLo = 0, triHi = 0;
  const mark = (x, z) => {
    const jx = (x - minX) / CELL | 0, jz = (z - minZ) / CELL | 0;
    if (jx < 0 || jx >= gw || jz < 0 || jz >= gh) return;
    const k = jz * gw + jx;
    maskLo[k] |= triLo;
    maskHi[k] |= triHi;
  };
  const markEdge = (ax, az, bx, bz) => {
    const dx = bx - ax, dz = bz - az;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (CELL * 0.5)));
    for (let s = 0; s <= steps; s++) mark(ax + dx * (s / steps), az + dz * (s / steps));
  };

  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), nrm = new THREE.Vector3();
  let tris = 0, used = 0;

  for (const root of roots) {
    root.updateWorldMatrix(true, true);
    root.traverse((o) => {
      if (!o.isMesh || o.userData?.noCollide) return;
      const geo = o.geometry;
      const pos = geo.attributes.position;
      if (!pos) return;
      const idx = geo.index;
      const count = idx ? idx.count : pos.count;
      const m = o.matrixWorld;
      for (let i = 0; i < count; i += 3) {
        const i0 = idx ? idx.getX(i) : i;
        const i1 = idx ? idx.getX(i + 1) : i + 1;
        const i2 = idx ? idx.getX(i + 2) : i + 2;
        a.fromBufferAttribute(pos, i0).applyMatrix4(m);
        b.fromBufferAttribute(pos, i1).applyMatrix4(m);
        c.fromBufferAttribute(pos, i2).applyMatrix4(m);
        tris++;
        if (!isNear((a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3)) continue;
        // Only steep faces are barriers. Edge rasterisation is exact for a
        // vertical wall (it projects to a line) but a plaza slab or a ramp
        // would smear phantom walls across open ground, so skip anything
        // shallow enough to simply drive over.
        ab.subVectors(b, a); ac.subVectors(c, a);
        nrm.crossVectors(ab, ac);
        const len = nrm.length();
        if (len < 1e-9 || Math.abs(nrm.y) > STEEP * len) continue;
        used++;
        const s0 = slabOf(Math.min(a.y, b.y, c.y));
        const s1 = slabOf(Math.max(a.y, b.y, c.y));
        triLo = bitsLo(s0, s1); triHi = bitsHi(s0, s1);
        markEdge(a.x, a.z, b.x, b.z);
        markEdge(b.x, b.z, c.x, c.z);
        markEdge(c.x, c.z, a.x, a.z);
      }
    });
  }

  /* --------------------------- march the rays ------------------------ */
  const left = new Float32Array(n);   // limit for lat > 0
  const right = new Float32Array(n);  // limit for lat < 0
  const p = new THREE.Vector3();
  const intrusions = [];

  for (let i = 0; i < n; i++) {
    const w = track.width[i];
    const from = w * 0.55;
    const to = w + MAX_RUNOFF + kartHalfWidth + 0.5;
    for (const side of [1, -1]) {
      let hitAt = Infinity;
      for (let lat = from; lat <= to; lat += STEP) {
        track.pointAt(i, side * lat, p);
        const jx = (p.x - minX) / CELL | 0, jz = (p.z - minZ) / CELL | 0;
        if (jx < 0 || jx >= gw || jz < 0 || jz >= gh) break;
        const k = jz * gw + jx;
        if (!maskLo[k] && !maskHi[k]) continue;
        // p.y already follows the banked road plane at this offset
        const b0 = slabOf(p.y + BAND_LO), b1 = slabOf(p.y + BAND_HI);
        if ((maskLo[k] & bitsLo(b0, b1)) !== 0 || (maskHi[k] & bitsHi(b0, b1)) !== 0) { hitAt = lat; break; }
      }
      let limit = (hitAt === Infinity ? w + MAX_RUNOFF : hitAt - kartHalfWidth);
      if (hitAt < w) intrusions.push({ i, side, at: +hitAt.toFixed(2), width: +w.toFixed(2) });
      // A monument standing in a wide plaza is a genuine obstacle and must be
      // honoured, so the floor is an absolute corridor rather than a fraction
      // of the (sometimes enormous) plaza width.
      const floor = Math.min(w * 0.92, MIN_CORRIDOR);
      limit = Math.min(Math.max(limit, floor), w + MAX_RUNOFF);
      if (side > 0) left[i] = limit; else right[i] = limit;
    }
  }

  // Erode single-sample spikes so one missed grid cell can't open a gap the
  // kart squeezes through, and so the barrier doesn't feel notchy.
  for (const arr of [left, right]) {
    const src = arr.slice();
    for (let i = 0; i < n; i++) {
      const prev = src[(i - 1 + n) % n], cur = src[i], next = src[(i + 1) % n];
      arr[i] = Math.min(cur, Math.max(Math.min(prev, next), cur - 0.6));
    }
  }

  return {
    left, right, intrusions,
    ms: Math.round(performance.now() - t0),
    tris, used,
    limitAt(i, lat) {
      const j = ((i % n) + n) % n;
      return lat >= 0 ? left[j] : right[j];
    },
  };
}
