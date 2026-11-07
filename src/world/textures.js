import * as THREE from 'three';

/* ------------------------------------------------------------------ *
 * Procedural texture factory.
 * Everything in the game is generated at runtime on 2D canvases, then
 * converted to albedo / normal / roughness maps. No binary assets.
 * ------------------------------------------------------------------ */

const cache = new Map();

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function makeTexture(cv, { repeat = 1, srgb = true, aniso = 16 } = {}) {
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Sobel-filter a height canvas into a tangent-space normal map. */
function heightToNormal(heightCanvas, strength = 2.0) {
  const size = heightCanvas.width;
  const src = heightCanvas.getContext('2d').getImageData(0, 0, size, size).data;
  const out = canvas(size);
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(size, size);
  const h = (x, y) => {
    const xi = ((x % size) + size) % size;
    const yi = ((y % size) + size) % size;
    return src[(yi * size + xi) * 4] / 255;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tl = h(x - 1, y - 1), t = h(x, y - 1), tr = h(x + 1, y - 1);
      const l = h(x - 1, y), r = h(x + 1, y);
      const bl = h(x - 1, y + 1), b = h(x, y + 1), br = h(x + 1, y + 1);
      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      let nx = -dx * strength, ny = -dy * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/** Cheap value-noise field with seeded PRNG, used for grain and mottling. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function addGrain(ctx, size, amount, rnd) {
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * amount;
    img.data[i] = THREE.MathUtils.clamp(img.data[i] + n, 0, 255);
    img.data[i + 1] = THREE.MathUtils.clamp(img.data[i + 1] + n, 0, 255);
    img.data[i + 2] = THREE.MathUtils.clamp(img.data[i + 2] + n, 0, 255);
  }
  ctx.putImageData(img, 0, 0);
}

/** Soft blotches used for weathering / moisture stains. */
function blotches(ctx, size, count, colorFn, rnd, maxR = 0.18) {
  for (let i = 0; i < count; i++) {
    const x = rnd() * size, y = rnd() * size;
    const r = (0.02 + rnd() * maxR) * size;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const c = colorFn(rnd);
    g.addColorStop(0, c.replace('ALPHA', 0.5));
    g.addColorStop(1, c.replace('ALPHA', 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* ---------------------------- cobblestone --------------------------- */
/**
 * Old San Juan's streets are paved with adoquines: blue-grey cast iron slag
 * bricks laid in a fan pattern. We build both the albedo and a height field.
 */
export function adoquinTextures(size = 1024) {
  const key = 'adoquin' + size;
  if (cache.has(key)) return cache.get(key);
  const rnd = mulberry32(7);

  const alb = canvas(size);
  const a = alb.getContext('2d');
  const hgt = canvas(size);
  const h = hgt.getContext('2d');
  const rgh = canvas(size);
  const rg = rgh.getContext('2d');

  // mortar / base
  a.fillStyle = '#2b3440';
  a.fillRect(0, 0, size, size);
  h.fillStyle = '#2a2a2a';
  h.fillRect(0, 0, size, size);
  rg.fillStyle = '#e0e0e0';
  rg.fillRect(0, 0, size, size);

  const cols = 16;
  const cell = size / cols;
  const brickW = cell * 0.92;
  const brickH = cell * 0.46;

  for (let row = 0; row < cols * 2; row++) {
    const offset = row % 2 ? cell * 0.5 : 0;
    for (let col = -1; col <= cols; col++) {
      const cx = col * cell + offset + cell / 2;
      const cy = row * (cell / 2) + cell / 4;
      const w = brickW * (0.9 + rnd() * 0.14);
      const hh = brickH * (0.86 + rnd() * 0.2);
      const rot = (rnd() - 0.5) * 0.09;

      // adoquín colours drift from steel blue to teal to slate
      const hue = 198 + rnd() * 26;
      const sat = 10 + rnd() * 16;
      const lig = 31 + rnd() * 15;

      const draw = (ctx, fill, stroke) => {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot);
        ctx.beginPath();
        const r = hh * 0.28;
        ctx.roundRect(-w / 2, -hh / 2, w, hh, r);
        ctx.fillStyle = fill;
        ctx.fill();
        if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
        ctx.restore();
      };

      draw(a, `hsl(${hue} ${sat}% ${lig}%)`, `hsl(${hue} ${sat}% ${lig * 0.6}%)`);
      // Height: a flat-topped setts with a crisp bevel at the mortar joint.
      // A domed gradient here turns the street into glossy bubble-wrap once
      // the normal map is applied, so keep the top plateau genuinely flat and
      // let the dark mortar gap do the bevelling under the sobel pass.
      const top = 196 + rnd() * 34 | 0;
      h.save();
      h.translate(cx, cy);
      h.rotate(rot);
      h.beginPath();
      h.roundRect(-w / 2 + 1, -hh / 2 + 1, w - 2, hh - 2, hh * 0.3);
      h.fillStyle = `rgb(${top},${top},${top})`;
      h.fill();
      h.restore();

      // polished stones are smoother in the middle (centuries of tires)
      const rgv = 178 + rnd() * 52;
      draw(rg, `rgb(${rgv},${rgv},${rgv})`, null);
    }
  }

  // wet-look staining and worn wheel polish
  blotches(a, size, 40, () => `rgba(20,40,55,ALPHA)`, rnd, 0.12);
  blotches(a, size, 22, () => `rgba(120,130,120,ALPHA)`, rnd, 0.08);
  blotches(rg, size, 30, () => `rgba(210,210,210,ALPHA)`, rnd, 0.18);
  addGrain(a, size, 26, rnd);

  const res = {
    map: makeTexture(alb),
    normalMap: makeTexture(heightToNormal(hgt, 1.35), { srgb: false }),
    roughnessMap: makeTexture(rgh, { srgb: false }),
  };
  cache.set(key, res);
  return res;
}

/* ----------------------------- asphalt ------------------------------ */
/**
 * Highway blacktop. The road mesh maps U across the full width and V along
 * the road, so the lane markings can be painted straight into the albedo:
 * a solid white edge line at each shoulder and broken white lane dividers
 * between them. `lanes` is the count per carriageway.
 */
export function asphaltTextures(size = 1024, lanes = 3) {
  const key = 'asphalt' + size + lanes;
  if (cache.has(key)) return cache.get(key);
  const rnd = mulberry32(21);

  const alb = canvas(size);
  const a = alb.getContext('2d');
  const hgt = canvas(size);
  const h = hgt.getContext('2d');
  const rgh = canvas(size);
  const rg = rgh.getContext('2d');

  a.fillStyle = '#31333a';
  a.fillRect(0, 0, size, size);
  h.fillStyle = '#808080';
  h.fillRect(0, 0, size, size);
  rg.fillStyle = '#c8c8c8';
  rg.fillRect(0, 0, size, size);

  // aggregate: thousands of chips of stone in the bitumen
  for (let i = 0; i < size * 26; i++) {
    const x = rnd() * size, y = rnd() * size;
    const r = 0.6 + rnd() * 2.1;
    const v = 42 + rnd() * 58 | 0;
    a.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
    a.beginPath(); a.arc(x, y, r, 0, 6.283); a.fill();
    const hv = 116 + rnd() * 74 | 0;
    h.fillStyle = `rgb(${hv},${hv},${hv})`;
    h.beginPath(); h.arc(x, y, r, 0, 6.283); h.fill();
  }

  // patches, tar-band repairs and the polished strips where tyres run
  blotches(a, size, 16, () => 'rgba(18,18,22,ALPHA)', rnd, 0.16);
  blotches(a, size, 10, () => 'rgba(96,96,104,ALPHA)', rnd, 0.1);
  for (let i = 0; i < 5; i++) {
    const y = rnd() * size;
    a.strokeStyle = 'rgba(16,16,18,0.5)';
    a.lineWidth = 3 + rnd() * 5;
    a.beginPath();
    a.moveTo(0, y);
    a.bezierCurveTo(size * 0.3, y + (rnd() - 0.5) * 40, size * 0.7, y + (rnd() - 0.5) * 40, size, y);
    a.stroke();
  }

  /* Lane markings. U runs 0..1 across the carriageway, so paint in that
   * space and every road width gets correctly proportioned lines. */
  const px = (u) => u * size;
  const EDGE = 0.012;
  a.fillStyle = '#e8e6dc';
  rg.fillStyle = '#8a8a8a';
  for (const u of [0.028, 1 - 0.028]) {
    a.fillRect(px(u - EDGE / 2), 0, px(EDGE), size);
    rg.fillRect(px(u - EDGE / 2), 0, px(EDGE), size);
  }
  // broken dividers: 3 m stripe, 9 m gap is the US standard ratio
  const dashOn = size * 0.25, dashOff = size * 0.75;
  for (let l = 1; l < lanes; l++) {
    const u = 0.028 + (l / lanes) * (1 - 0.056);
    for (let y = 0; y < size; y += dashOn + dashOff) {
      a.fillRect(px(u - EDGE / 2), y, px(EDGE), dashOn);
      rg.fillRect(px(u - EDGE / 2), y, px(EDGE), dashOn);
    }
  }
  // scuff the paint so it doesn't look freshly laid
  blotches(a, size, 26, () => 'rgba(40,40,44,ALPHA)', rnd, 0.05);
  addGrain(a, size, 16, rnd);
  blotches(rg, size, 24, () => 'rgba(150,150,150,ALPHA)', rnd, 0.2);

  const res = {
    map: makeTexture(alb),
    normalMap: makeTexture(heightToNormal(hgt, 0.55), { srgb: false }),
    roughnessMap: makeTexture(rgh, { srgb: false }),
  };
  cache.set(key, res);
  return res;
}

/* ------------------------------ stucco ------------------------------ */
/** Colonial lime-plaster wall in a given pastel hue. */
export function stuccoTextures(hex, size = 512, seed = 3) {
  const key = 'stucco' + hex + size + seed;
  if (cache.has(key)) return cache.get(key);
  const rnd = mulberry32(seed);
  const base = new THREE.Color(hex);
  const hsl = {};
  base.getHSL(hsl);

  const alb = canvas(size);
  const a = alb.getContext('2d');
  const hgt = canvas(size);
  const h = hgt.getContext('2d');

  a.fillStyle = `#${base.getHexString()}`;
  a.fillRect(0, 0, size, size);
  h.fillStyle = 'rgb(128,128,128)';
  h.fillRect(0, 0, size, size);

  // trowel mottling
  for (let i = 0; i < 900; i++) {
    const x = rnd() * size, y = rnd() * size;
    const r = 6 + rnd() * 46;
    const l = THREE.MathUtils.clamp(hsl.l + (rnd() - 0.5) * 0.16, 0.05, 0.97);
    a.fillStyle = `hsla(${hsl.h * 360} ${hsl.s * 100}% ${l * 100}% / ${0.06 + rnd() * 0.12})`;
    a.beginPath();
    a.ellipse(x, y, r, r * (0.5 + rnd()), rnd() * 3.14, 0, Math.PI * 2);
    a.fill();
    const hv = 128 + (rnd() - 0.5) * 60;
    h.fillStyle = `rgba(${hv | 0},${hv | 0},${hv | 0},0.25)`;
    h.beginPath();
    h.ellipse(x, y, r * 0.6, r * 0.5, 0, 0, Math.PI * 2);
    h.fill();
  }

  // salt damp rising from the base, cracks, chipped plaster
  const damp = a.createLinearGradient(0, size, 0, size * 0.55);
  damp.addColorStop(0, 'rgba(60,55,45,0.42)');
  damp.addColorStop(1, 'rgba(60,55,45,0)');
  a.fillStyle = damp;
  a.fillRect(0, 0, size, size);

  for (let i = 0; i < 16; i++) {
    a.strokeStyle = `rgba(0,0,0,${0.05 + rnd() * 0.12})`;
    a.lineWidth = 0.7 + rnd() * 1.4;
    a.beginPath();
    let x = rnd() * size, y = rnd() * size;
    a.moveTo(x, y);
    for (let s = 0; s < 9; s++) {
      x += (rnd() - 0.5) * 60; y += (rnd() - 0.3) * 50;
      a.lineTo(x, y);
    }
    a.stroke();
  }
  for (let i = 0; i < 26; i++) {
    const x = rnd() * size, y = rnd() * size, r = 2 + rnd() * 9;
    a.fillStyle = `hsla(${hsl.h * 360} ${hsl.s * 60}% ${(hsl.l - 0.22) * 100}% / 0.5)`;
    a.beginPath(); a.arc(x, y, r, 0, Math.PI * 2); a.fill();
    h.fillStyle = 'rgba(60,60,60,0.6)';
    h.beginPath(); h.arc(x, y, r, 0, Math.PI * 2); h.fill();
  }
  addGrain(a, size, 14, rnd);

  const res = {
    map: makeTexture(alb),
    normalMap: makeTexture(heightToNormal(hgt, 0.9), { srgb: false }),
  };
  cache.set(key, res);
  return res;
}

/* --------------------------- terracotta tile ------------------------ */
export function roofTileTextures(size = 512) {
  const key = 'rooftile' + size;
  if (cache.has(key)) return cache.get(key);
  const rnd = mulberry32(11);
  const alb = canvas(size);
  const a = alb.getContext('2d');
  const hgt = canvas(size);
  const h = hgt.getContext('2d');

  a.fillStyle = '#5a2a1c';
  a.fillRect(0, 0, size, size);
  h.fillStyle = '#000';
  h.fillRect(0, 0, size, size);

  const cols = 10;
  const w = size / cols;
  for (let x = 0; x < cols; x++) {
    for (let y = -1; y < cols + 1; y++) {
      const cx = x * w + w / 2;
      const cy = y * w * 1.4 + (x % 2) * w * 0.7;
      const hue = 12 + rnd() * 14;
      const l = 30 + rnd() * 18;
      const g = a.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
      g.addColorStop(0, `hsl(${hue} 52% ${l * 0.6}%)`);
      g.addColorStop(0.42, `hsl(${hue} 58% ${l}%)`);
      g.addColorStop(1, `hsl(${hue} 50% ${l * 0.55}%)`);
      a.fillStyle = g;
      a.beginPath();
      a.roundRect(cx - w * 0.46, cy, w * 0.92, w * 1.36, [w * 0.46, w * 0.46, 4, 4]);
      a.fill();

      const gh = h.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
      gh.addColorStop(0, '#111'); gh.addColorStop(0.45, '#ddd'); gh.addColorStop(1, '#111');
      h.fillStyle = gh;
      h.beginPath();
      h.roundRect(cx - w * 0.46, cy, w * 0.92, w * 1.36, [w * 0.46, w * 0.46, 4, 4]);
      h.fill();
    }
  }
  blotches(a, size, 60, () => 'rgba(90,110,60,ALPHA)', rnd, 0.06); // moss
  blotches(a, size, 40, () => 'rgba(30,20,15,ALPHA)', rnd, 0.1);
  addGrain(a, size, 18, rnd);

  const res = {
    map: makeTexture(alb),
    normalMap: makeTexture(heightToNormal(hgt, 1.6), { srgb: false }),
  };
  cache.set(key, res);
  return res;
}

/* ------------------------------- stone ------------------------------ */
/** Sandstone blocks of the muralla / El Morro. */
export function murallaTextures(size = 1024) {
  const key = 'muralla' + size;
  if (cache.has(key)) return cache.get(key);
  const rnd = mulberry32(23);
  const alb = canvas(size);
  const a = alb.getContext('2d');
  const hgt = canvas(size);
  const h = hgt.getContext('2d');

  a.fillStyle = '#5d5344';
  a.fillRect(0, 0, size, size);
  h.fillStyle = '#333';
  h.fillRect(0, 0, size, size);

  const rows = 8;
  const rh = size / rows;
  for (let r = 0; r < rows; r++) {
    let x = -rnd() * rh;
    while (x < size) {
      const bw = rh * (1.1 + rnd() * 1.5);
      const pad = rh * 0.06;
      const hue = 36 + rnd() * 14;
      const sat = 10 + rnd() * 14;
      const lig = 46 + rnd() * 22;
      a.fillStyle = `hsl(${hue} ${sat}% ${lig}%)`;
      a.beginPath();
      a.roundRect(x + pad, r * rh + pad, bw - pad * 2, rh - pad * 2, rh * 0.05);
      a.fill();
      const g = h.createRadialGradient(x + bw / 2, r * rh + rh / 2, 0, x + bw / 2, r * rh + rh / 2, bw * 0.6);
      g.addColorStop(0, '#e8e8e8'); g.addColorStop(0.7, '#b8b8b8'); g.addColorStop(1, '#2a2a2a');
      h.fillStyle = g;
      h.beginPath();
      h.roundRect(x + pad, r * rh + pad, bw - pad * 2, rh - pad * 2, rh * 0.12);
      h.fill();
      x += bw;
    }
  }
  // sea-salt bleaching + biological growth near the base
  blotches(a, size, 70, () => 'rgba(215,205,180,ALPHA)', rnd, 0.13);
  blotches(a, size, 45, () => 'rgba(70,80,50,ALPHA)', rnd, 0.1);
  blotches(a, size, 30, () => 'rgba(40,35,28,ALPHA)', rnd, 0.16);
  addGrain(a, size, 24, rnd);

  const res = {
    map: makeTexture(alb),
    normalMap: makeTexture(heightToNormal(hgt, 2.2), { srgb: false }),
  };
  cache.set(key, res);
  return res;
}

/* ------------------------------- grass ------------------------------ */
export function grassTextures(size = 512) {
  const key = 'grass' + size;
  if (cache.has(key)) return cache.get(key);
  const rnd = mulberry32(31);
  const alb = canvas(size);
  const a = alb.getContext('2d');
  const hgt = canvas(size);
  const h = hgt.getContext('2d');
  a.fillStyle = '#3d6b2a';
  a.fillRect(0, 0, size, size);
  h.fillStyle = '#808080';
  h.fillRect(0, 0, size, size);
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * size, y = rnd() * size;
    const len = 3 + rnd() * 9;
    const ang = -Math.PI / 2 + (rnd() - 0.5) * 1.4;
    a.strokeStyle = `hsl(${88 + rnd() * 34} ${38 + rnd() * 30}% ${18 + rnd() * 30}%)`;
    a.lineWidth = 0.8 + rnd() * 1.3;
    a.beginPath();
    a.moveTo(x, y);
    a.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    a.stroke();
    const hv = 128 + (rnd() - 0.5) * 90;
    h.strokeStyle = `rgb(${hv | 0},${hv | 0},${hv | 0})`;
    h.lineWidth = 1.2;
    h.beginPath();
    h.moveTo(x, y);
    h.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    h.stroke();
  }
  blotches(a, size, 40, () => 'rgba(110,140,60,ALPHA)', rnd, 0.16);
  blotches(a, size, 25, () => 'rgba(30,50,20,ALPHA)', rnd, 0.2);
  const res = {
    map: makeTexture(alb),
    normalMap: makeTexture(heightToNormal(hgt, 1.1), { srgb: false }),
  };
  cache.set(key, res);
  return res;
}

/* ------------------------------ terrain ----------------------------- */
/**
 * Neutral ground detail. Deliberately near-grey so the terrain mesh can
 * tint it per-vertex — grass inland, bare rock on the cliffs, pale sand
 * at the waterline — without fighting a baked-in hue.
 */
export function terrainTextures(size = 512) {
  const key = 'terrain' + size;
  if (cache.has(key)) return cache.get(key);
  const rnd = mulberry32(97);
  const alb = canvas(size);
  const a = alb.getContext('2d');
  const hgt = canvas(size);
  const h = hgt.getContext('2d');

  a.fillStyle = '#b8b4a8';
  a.fillRect(0, 0, size, size);
  h.fillStyle = '#808080';
  h.fillRect(0, 0, size, size);

  // fine speckle: clumps of blade-like detail that read as either grass
  // or gravel once tinted
  for (let i = 0; i < 14000; i++) {
    const x = rnd() * size, y = rnd() * size;
    const len = 2 + rnd() * 8;
    const ang = rnd() * Math.PI * 2;
    const v = 128 + (rnd() - 0.5) * 120;
    a.strokeStyle = `rgba(${v | 0},${(v * 0.99) | 0},${(v * 0.94) | 0},0.55)`;
    a.lineWidth = 0.7 + rnd() * 1.6;
    a.beginPath();
    a.moveTo(x, y);
    a.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    a.stroke();
    const hv = 128 + (rnd() - 0.5) * 70;
    h.strokeStyle = `rgb(${hv | 0},${hv | 0},${hv | 0})`;
    h.lineWidth = 1.1;
    h.beginPath();
    h.moveTo(x, y);
    h.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    h.stroke();
  }
  // broad tonal variation so large areas never look tiled
  blotches(a, size, 46, () => 'rgba(220,216,206,ALPHA)', rnd, 0.13);
  blotches(a, size, 34, () => 'rgba(120,116,108,ALPHA)', rnd, 0.16);
  blotches(h, size, 30, () => 'rgba(160,160,160,ALPHA)', rnd, 0.25);

  const res = {
    map: makeTexture(alb),
    normalMap: makeTexture(heightToNormal(hgt, 1.0), { srgb: false }),
  };
  cache.set(key, res);
  return res;
}

/* -------------------------------- wood ------------------------------ */
export function woodTextures(hex = '#2f4f3f', size = 512) {
  const key = 'wood' + hex + size;
  if (cache.has(key)) return cache.get(key);
  const rnd = mulberry32(53);
  const base = new THREE.Color(hex);
  const hsl = {};
  base.getHSL(hsl);
  const alb = canvas(size);
  const a = alb.getContext('2d');
  const hgt = canvas(size);
  const h = hgt.getContext('2d');
  a.fillStyle = `#${base.getHexString()}`;
  a.fillRect(0, 0, size, size);
  h.fillStyle = '#808080';
  h.fillRect(0, 0, size, size);
  for (let i = 0; i < 260; i++) {
    const y = rnd() * size;
    const l = THREE.MathUtils.clamp(hsl.l + (rnd() - 0.5) * 0.2, 0.03, 0.95);
    a.strokeStyle = `hsla(${hsl.h * 360} ${hsl.s * 100}% ${l * 100}% / ${0.15 + rnd() * 0.4})`;
    a.lineWidth = 0.6 + rnd() * 3.2;
    a.beginPath();
    a.moveTo(0, y);
    for (let x = 0; x <= size; x += 32) a.lineTo(x, y + Math.sin(x * 0.02 + i) * 2.5);
    a.stroke();
  }
  // plank seams
  for (let i = 1; i < 6; i++) {
    const y = (i / 6) * size;
    a.strokeStyle = 'rgba(0,0,0,0.45)';
    a.lineWidth = 3;
    a.beginPath(); a.moveTo(0, y); a.lineTo(size, y); a.stroke();
    h.strokeStyle = '#202020'; h.lineWidth = 5;
    h.beginPath(); h.moveTo(0, y); h.lineTo(size, y); h.stroke();
  }
  addGrain(a, size, 12, rnd);
  const res = {
    map: makeTexture(alb),
    normalMap: makeTexture(heightToNormal(hgt, 1.3), { srgb: false }),
  };
  cache.set(key, res);
  return res;
}

/* ------------------------------ utility ----------------------------- */
/** Radial soft dot, used for particles and light glows. */
export function dotTexture(size = 128, inner = '#ffffff', outer = 'rgba(255,255,255,0)') {
  const key = 'dot' + size + inner + outer;
  if (cache.has(key)) return cache.get(key);
  const cv = canvas(size);
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, inner.startsWith('#') ? inner : inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

/** Fluffy smoke puff sprite. */
export function smokeTexture(size = 128) {
  const key = 'smoke' + size;
  if (cache.has(key)) return cache.get(key);
  const rnd = mulberry32(97);
  const cv = canvas(size);
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 26; i++) {
    const ang = rnd() * Math.PI * 2;
    const dist = rnd() * size * 0.22;
    const x = size / 2 + Math.cos(ang) * dist;
    const y = size / 2 + Math.sin(ang) * dist;
    const r = size * (0.1 + rnd() * 0.2);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

/** Foliage billboard: a cluster of leaves with alpha. */
export function leafTexture(size = 256, hue = 110) {
  const key = 'leaf' + size + hue;
  if (cache.has(key)) return cache.get(key);
  const rnd = mulberry32(hue * 7 + 5);
  const cv = canvas(size);
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 90; i++) {
    const x = size / 2 + (rnd() - 0.5) * size * 0.86;
    const y = size / 2 + (rnd() - 0.5) * size * 0.86;
    const d = Math.hypot(x - size / 2, y - size / 2) / (size / 2);
    if (d > 0.95) continue;
    const r = size * (0.05 + rnd() * 0.1) * (1 - d * 0.35);
    ctx.fillStyle = `hsla(${hue + rnd() * 30 - 15} ${40 + rnd() * 30}% ${16 + rnd() * 34}% / ${0.75 + rnd() * 0.25})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.55 + rnd() * 0.6), rnd() * 3.14, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

export { makeTexture, heightToNormal };

/* ----------------------------- highway ------------------------------ */
/** Weathered poured concrete for viaducts, gantries and expressway walls. */
export function concreteTextures(size = 512, seed = 211) {
  const key = 'concrete' + size + seed;
  if (cache.has(key)) return cache.get(key);
  const rnd = mulberry32(seed);
  const alb = canvas(size);
  const a = alb.getContext('2d');
  const hgt = canvas(size);
  const h = hgt.getContext('2d');
  const rgh = canvas(size);
  const rg = rgh.getContext('2d');

  a.fillStyle = '#b9b7ae';
  a.fillRect(0, 0, size, size);
  h.fillStyle = '#808080';
  h.fillRect(0, 0, size, size);
  rg.fillStyle = '#e4e4e0';
  rg.fillRect(0, 0, size, size);

  for (let i = 0; i < 1500; i++) {
    const x = rnd() * size, y = rnd() * size;
    const w = 1 + rnd() * 7, ht = 1 + rnd() * 4;
    const v = 150 + rnd() * 55 | 0;
    a.fillStyle = `rgba(${v},${v},${v - 6},${0.06 + rnd() * 0.18})`;
    a.fillRect(x, y, w, ht);
    h.fillStyle = `rgba(${120 + rnd() * 34 | 0},${120 + rnd() * 34 | 0},${120 + rnd() * 34 | 0},0.28)`;
    h.fillRect(x, y, w, ht);
  }

  // Formwork seams, rust drips and tropical mildew.
  for (let y = size * 0.18; y < size; y += size * 0.24) {
    a.strokeStyle = 'rgba(72,70,66,0.24)';
    a.lineWidth = 2;
    a.beginPath(); a.moveTo(0, y + (rnd() - 0.5) * 6); a.lineTo(size, y + (rnd() - 0.5) * 6); a.stroke();
    h.strokeStyle = 'rgba(70,70,70,0.55)';
    h.lineWidth = 3;
    h.beginPath(); h.moveTo(0, y); h.lineTo(size, y); h.stroke();
  }
  for (let i = 0; i < 34; i++) {
    const x = rnd() * size, y = rnd() * size * 0.45;
    const len = size * (0.08 + rnd() * 0.32);
    const c = rnd() > 0.55 ? '88,74,48' : '54,76,44';
    const g = a.createLinearGradient(x, y, x + (rnd() - 0.5) * 16, y + len);
    g.addColorStop(0, `rgba(${c},0.30)`);
    g.addColorStop(1, `rgba(${c},0)`);
    a.fillStyle = g;
    a.fillRect(x, y, 2 + rnd() * 7, len);
  }
  blotches(a, size, 28, () => 'rgba(235,232,220,ALPHA)', rnd, 0.12);
  blotches(a, size, 34, () => 'rgba(65,72,55,ALPHA)', rnd, 0.10);
  addGrain(a, size, 12, rnd);

  const res = {
    map: makeTexture(alb, { aniso: 12 }),
    normalMap: makeTexture(heightToNormal(hgt, 0.85), { srgb: false, aniso: 12 }),
    roughnessMap: makeTexture(rgh, { srgb: false, aniso: 8 }),
  };
  cache.set(key, res);
  return res;
}

/** Repeating curtain-wall facade for the Hato Rey financial district. */
export function curtainWallTextures(size = 512, hue = 204, seed = 317) {
  const key = 'curtain' + size + hue + seed;
  if (cache.has(key)) return cache.get(key);
  const rnd = mulberry32(seed + hue);
  const alb = canvas(size);
  const a = alb.getContext('2d');
  const hgt = canvas(size);
  const h = hgt.getContext('2d');
  const rgh = canvas(size);
  const rg = rgh.getContext('2d');

  const g = a.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, `hsl(${hue} 44% 20%)`);
  g.addColorStop(0.52, `hsl(${hue + 9} 48% 34%)`);
  g.addColorStop(1, `hsl(${hue - 14} 38% 14%)`);
  a.fillStyle = g;
  a.fillRect(0, 0, size, size);
  h.fillStyle = '#808080';
  h.fillRect(0, 0, size, size);
  rg.fillStyle = '#6b6f75';
  rg.fillRect(0, 0, size, size);

  const cols = 9, rows = 18;
  const cw = size / cols, rh = size / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const lit = rnd() > 0.78;
      const l = lit ? 62 + rnd() * 20 : 24 + rnd() * 19;
      a.fillStyle = lit ? `hsla(47 90% ${l}% / 0.82)` : `hsla(${hue + rnd() * 20 - 10} 38% ${l}% / 0.78)`;
      a.fillRect(x * cw + 2, y * rh + 2, cw - 4, rh - 4);
      rg.fillStyle = lit ? '#8e8a78' : '#565a60';
      rg.fillRect(x * cw + 2, y * rh + 2, cw - 4, rh - 4);
      h.fillStyle = '#a8a8a8';
      h.fillRect(x * cw + 1, y * rh + 1, cw - 2, rh - 2);
    }
  }
  a.fillStyle = 'rgba(220,235,255,0.16)';
  for (let i = 0; i < 14; i++) {
    const x = rnd() * size;
    a.fillRect(x, 0, 6 + rnd() * 18, size);
  }
  a.strokeStyle = 'rgba(235,244,255,0.45)';
  a.lineWidth = 2;
  for (let x = 0; x <= cols; x++) { a.beginPath(); a.moveTo(x * cw, 0); a.lineTo(x * cw, size); a.stroke(); }
  for (let y = 0; y <= rows; y++) { a.beginPath(); a.moveTo(0, y * rh); a.lineTo(size, y * rh); a.stroke(); }

  const res = {
    map: makeTexture(alb, { aniso: 12 }),
    normalMap: makeTexture(heightToNormal(hgt, 0.38), { srgb: false, aniso: 8 }),
    roughnessMap: makeTexture(rgh, { srgb: false, aniso: 8 }),
  };
  cache.set(key, res);
  return res;
}

/** Transparent chain-link mesh used along the expressway shoulders. */
export function chainLinkTexture(size = 256) {
  const key = 'chainlink' + size;
  if (cache.has(key)) return cache.get(key);
  const cv = canvas(size);
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(210,220,220,0.78)';
  ctx.lineWidth = 3;
  const spacing = size / 4;
  for (let x = -size; x < size * 2; x += spacing) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + size, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, size); ctx.lineTo(x + size, 0); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(245,250,250,0.42)';
  ctx.lineWidth = 1;
  for (let x = -size; x < size * 2; x += spacing) {
    ctx.beginPath(); ctx.moveTo(x + 3, 0); ctx.lineTo(x + size + 3, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 3, size); ctx.lineTo(x + size + 3, 0); ctx.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  cache.set(key, t);
  return t;
}
