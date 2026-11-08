import * as THREE from 'three';
import { terrainTextures } from './textures.js';

/* ------------------------------------------------------------------ *
 * The peninsula itself.
 *
 * A heightfield is grown out from the track: the ground hugs the road's
 * own elevation for as long as the quarter extends, then breaks into
 * cliffs and slides under the sea. How far the land reaches depends on
 * what the road is doing there — the bayside promenade has water almost
 * at the parapet, while the Campo del Morro runs out for a hundred
 * metres before the glacis drops to the Atlantic.
 * ------------------------------------------------------------------ */

const SEA = -7.5;
const CELL = 5.5;
const MARGIN = 300;

export class Terrain {
  constructor(track, scene) {
    this.track = track;

    const bounds = this._bounds(track, MARGIN);
    const nx = Math.ceil((bounds.maxX - bounds.minX) / CELL) + 1;
    const nz = Math.ceil((bounds.maxZ - bounds.minZ) / CELL) + 1;

    const grid = this._sampleGrid(track, bounds, nx, nz);
    const geo = this._buildGeometry(bounds, nx, nz, grid);

    // Kept so props can be seated on the real ground instead of guessing at it.
    this.bounds = bounds;
    this.nx = nx;
    this.nz = nz;
    this.height = grid.height;

    const g = terrainTextures(512);
    g.map.wrapS = g.map.wrapT = THREE.RepeatWrapping;
    g.normalMap.wrapS = g.normalMap.wrapT = THREE.RepeatWrapping;

    this.material = new THREE.MeshStandardMaterial({
      map: g.map,
      normalMap: g.normalMap,
      vertexColors: true,
      roughness: 0.96,
      metalness: 0,
      envMapIntensity: 0.55,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'terrain';
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);
  }

  /**
   * Ground height at a world position, interpolated across the same triangle
   * pair the mesh is built from (the quad splits along the b–c diagonal), so
   * this returns the surface you can actually see rather than an approximation
   * of it. Clamps to the grid edge.
   */
  heightAt(x, z) {
    const b = this.bounds, nx = this.nx, nz = this.nz, h = this.height;
    const fx = THREE.MathUtils.clamp((x - b.minX) / CELL, 0, nx - 1.0001);
    const fz = THREE.MathUtils.clamp((z - b.minZ) / CELL, 0, nz - 1.0001);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const hA = h[iz * nx + ix];
    const hB = h[iz * nx + ix + 1];
    const hC = h[(iz + 1) * nx + ix];
    const hD = h[(iz + 1) * nx + ix + 1];
    if (tx + tz <= 1) return hA + tx * (hB - hA) + tz * (hC - hA);
    return hD + (1 - tx) * (hC - hD) + (1 - tz) * (hB - hD);
  }

  _bounds(t, margin) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < t.n; i += 4) {
      minX = Math.min(minX, t.pos[i * 3]); maxX = Math.max(maxX, t.pos[i * 3]);
      minZ = Math.min(minZ, t.pos[i * 3 + 2]); maxZ = Math.max(maxZ, t.pos[i * 3 + 2]);
    }
    return {
      minX: minX - margin, maxX: maxX + margin,
      minZ: minZ - margin, maxZ: maxZ + margin,
    };
  }

  /**
   * For every grid vertex, find the nearest track sample and decide how
   * much land there should be in that direction.
   */
  _sampleGrid(t, b, nx, nz) {
    // coarse copy of the track for the nearest-point search
    const STRIDE = 3;
    const m = Math.floor(t.n / STRIDE);
    const sx = new Float32Array(m), sy = new Float32Array(m), sz = new Float32Array(m);
    const rx = new Float32Array(m), ry = new Float32Array(m), rz = new Float32Array(m);
    const kind = new Uint8Array(m), wid = new Float32Array(m);
    for (let k = 0; k < m; k++) {
      const i = k * STRIDE;
      sx[k] = t.pos[i * 3]; sy[k] = t.pos[i * 3 + 1]; sz[k] = t.pos[i * 3 + 2];
      rx[k] = t.right[i * 3]; ry[k] = t.right[i * 3 + 1]; rz[k] = t.right[i * 3 + 2];
      kind[k] = t.kind[i]; wid[k] = t.width[i];
    }

    // bucket the samples so each grid vertex only tests a local neighbourhood
    const BCELL = 40;
    const bx = Math.ceil((b.maxX - b.minX) / BCELL) + 1;
    const bz = Math.ceil((b.maxZ - b.minZ) / BCELL) + 1;
    const buckets = new Map();
    for (let k = 0; k < m; k++) {
      const cx = Math.floor((sx[k] - b.minX) / BCELL);
      const cz = Math.floor((sz[k] - b.minZ) / BCELL);
      const key = cz * bx + cx;
      let arr = buckets.get(key);
      if (!arr) buckets.set(key, (arr = []));
      arr.push(k);
    }

    const height = new Float32Array(nx * nz);
    const shore = new Float32Array(nx * nz);   // 0 inland … 1 open water
    const rocky = new Float32Array(nx * nz);

    for (let iz = 0; iz < nz; iz++) {
      const z = b.minZ + iz * CELL;
      for (let ix = 0; ix < nx; ix++) {
        const x = b.minX + ix * CELL;

        // nearest sample: widen the search ring until something is found
        let best = -1, bestD = Infinity;
        const cx = Math.floor((x - b.minX) / BCELL);
        const cz = Math.floor((z - b.minZ) / BCELL);
        // A long, thin course leaves large empty regions of the bucket grid,
        // so the ring has to be allowed to grow to the whole grid — a fixed
        // cap silently returns -1 and poisons the mesh with NaN.
        const maxRing = bx + bz;
        let foundAt = -1;
        for (let ring = 0; ring <= maxRing; ring++) {
          for (let a = -ring; a <= ring; a++) {
            for (let c = -ring; c <= ring; c++) {
              if (ring > 0 && Math.max(Math.abs(a), Math.abs(c)) !== ring) continue;
              const gx = cx + a, gz = cz + c;
              if (gx < 0 || gz < 0 || gx >= bx || gz >= bz) continue;
              const arr = buckets.get(gz * bx + gx);
              if (!arr) continue;
              for (const k of arr) {
                const dx = x - sx[k], dz = z - sz[k];
                const d = dx * dx + dz * dz;
                if (d < bestD) { bestD = d; best = k; }
              }
            }
          }
          // one extra ring past the first hit, so we don't settle for a
          // sample that merely happened to be in a nearer bucket
          if (best >= 0) {
            if (foundAt < 0) foundAt = ring;
            if (ring >= foundAt + 1) break;
          }
        }

        const k = best;
        const d = Math.sqrt(bestD);
        const lat = (x - sx[k]) * rx[k] + (z - sz[k]) * rz[k];

        // how far the land should run in this direction
        let inner, outer;
        if (kind[k] === 2) {
          // bayside promenade: water laps the wall on the outer side
          inner = lat > 0 ? wid[k] + 12 : 190;
          outer = lat > 0 ? wid[k] + 52 : 300;
        } else if (kind[k] === 1) {
          // esplanade: the glacis runs well out before the cliffs
          inner = lat < 0 ? 235 : 190;
          outer = lat < 0 ? 330 : 300;
        } else {
          inner = 175;
          outer = 285;
        }

        const f = smoothstep(inner, outer, d);
        const base = sy[k];
        // land holds the road's height, then plunges past the cliff line
        const floor = SEA - 26;
        let y = base + f * (floor - base);
        // Rocky texture on the slope, gentle undulation inland — but mute it
        // inside the track corridor and cap the ground just under the road
        // plane, otherwise the ±2.6 m of fbm pokes through the tarmac and
        // swallows anything driving there.
        const n = fbm(x * 0.011, z * 0.011);
        const corridor = smoothstep(wid[k] + 1.5, wid[k] + 18, Math.abs(lat));
        y += (1 - f) * n * 2.6 * corridor + f * (1 - f) * n * 9.0;
        // The road is banked, so its surface at this lateral offset is not the
        // centreline height — cap against the tilted plane or the low side of
        // every banked corner swallows the karts.
        const roadY = base + lat * ry[k];
        if (corridor < 1) y = Math.min(y, roadY - 0.4 + corridor * 2.2);

        const idx = iz * nx + ix;
        height[idx] = y;
        shore[idx] = f;
        rocky[idx] = Math.min(1, f * 1.9);
      }
    }

    return { height, shore, rocky };
  }

  _buildGeometry(b, nx, nz, grid) {
    const { height, rocky } = grid;
    const count = nx * nz;
    const pos = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    const col = new Float32Array(count * 3);

    const grass = new THREE.Color(0x8ab84f).convertSRGBToLinear();
    const dry = new THREE.Color(0xc0b96a).convertSRGBToLinear();
    const stone = new THREE.Color(0xb0a68f).convertSRGBToLinear();
    const sand = new THREE.Color(0xe6d3a6).convertSRGBToLinear();
    const c = new THREE.Color();

    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const i = iz * nx + ix;
        const x = b.minX + ix * CELL;
        const z = b.minZ + iz * CELL;
        const y = height[i];
        pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
        uv[i * 2] = x / 14; uv[i * 2 + 1] = z / 14;

        const patch = fbm(x * 0.006 + 11, z * 0.006 - 4) * 0.5 + 0.5;
        c.copy(grass).lerp(dry, patch * 0.5);
        c.lerp(stone, rocky[i]);
        // a pale band right at the waterline reads as sand and foam
        const nearWater = 1 - THREE.MathUtils.clamp(Math.abs(y - SEA) / 4.5, 0, 1);
        c.lerp(sand, nearWater * 0.85);
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
    }

    const idx = [];
    for (let iz = 0; iz < nz - 1; iz++) {
      for (let ix = 0; ix < nx - 1; ix++) {
        const a = iz * nx + ix;
        const b2 = a + 1;
        const cc = a + nx;
        const d = cc + 1;
        idx.push(a, cc, b2, b2, cc, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(count > 65535 ? new THREE.BufferAttribute(new Uint32Array(idx), 1) : idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }
}

/* ------------------------------ noise ------------------------------- */
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
function fbm(x, y) {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < 4; i++) {
    v += amp * (vnoise(x * f, y * f) * 2 - 1);
    amp *= 0.5; f *= 2.03;
  }
  return v;
}
function smoothstep(a, b, x) {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
