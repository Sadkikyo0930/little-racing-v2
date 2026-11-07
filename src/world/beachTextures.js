import * as THREE from 'three';
import { mulberry32 } from './textures.js';

/* ------------------------------------------------------------------ *
 * 第二章专属材质：沙、木板、土路。
 *
 * 全部是 canvas 程序化生成，不引入任何外部贴图 —— 和第一章的做法一致，
 * 这样 Pages 版本不会多出几 MB 的图片，手机首屏也快。
 *
 * 每种材质返回 { map, normalMap, roughnessMap }，由调用方决定 repeat。
 * ------------------------------------------------------------------ */

function canvas(size) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  return cv;
}

function toTexture(cv, { srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

/** 高度图 → 法线图（Sobel），和 textures.js 里的做法一致但独立一份 */
function heightToNormal(cv, strength = 2.0) {
  const size = cv.width;
  const src = cv.getContext('2d').getImageData(0, 0, size, size).data;
  const out = canvas(size);
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(size, size);
  const at = (x, y) => src[((((y + size) % size) * size) + ((x + size) % size)) * 4] / 255;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x - 1, y) - at(x + 1, y)) * strength;
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

const cache = new Map();
function once(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

/* ----------------------------- 沙 ----------------------------- */
function sandCanvases(size, { base = '#c9a875', dark = '#a8875a', light = '#e0c79a', seed = 11 } = {}) {
  const rnd = mulberry32(seed);
  const cv = canvas(size);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // 沙粒：几百个小点，深浅交错
  for (let i = 0; i < size * 26; i++) {
    const x = rnd() * size, y = rnd() * size;
    const r = 0.5 + rnd() * 1.6;
    ctx.fillStyle = rnd() < 0.5 ? dark : light;
    ctx.globalAlpha = 0.12 + rnd() * 0.3;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 风纹：几条横向的浅波浪，远看像被风吹过的沙面
  for (let i = 0; i < 14; i++) {
    const y0 = rnd() * size;
    ctx.strokeStyle = rnd() < 0.5 ? light : dark;
    ctx.globalAlpha = 0.09 + rnd() * 0.08;
    ctx.lineWidth = 1 + rnd() * 2.5;
    ctx.beginPath();
    for (let x = 0; x <= size; x += 8) {
      const y = y0 + Math.sin((x / size) * Math.PI * 4 + i) * (2 + rnd() * 3);
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 高度图（只用于法线）
  const h = canvas(size);
  const hctx = h.getContext('2d');
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size * 30; i++) {
    const x = rnd() * size, y = rnd() * size;
    const v = Math.floor(96 + rnd() * 64);
    hctx.fillStyle = `rgb(${v},${v},${v})`;
    hctx.fillRect(x, y, 1 + rnd() * 2.6, 1 + rnd() * 1.6);
  }
  return { cv, h };
}

export function sandTextures(size = 512, opts = {}) {
  return once(`sand${size}${JSON.stringify(opts)}`, () => {
    const { cv, h } = sandCanvases(size, opts);
    const map = toTexture(cv);
    const normalMap = toTexture(heightToNormal(h, 0.85), { srgb: false });
    const rough = canvas(size);
    const rctx = rough.getContext('2d');
    rctx.fillStyle = '#f4f4f4';
    rctx.fillRect(0, 0, size, size);
    const rnd = mulberry32(77);
    for (let i = 0; i < size * 10; i++) {
      const v = Math.floor(200 + rnd() * 55);
      rctx.fillStyle = `rgb(${v},${v},${v})`;
      rctx.fillRect(rnd() * size, rnd() * size, 2 + rnd() * 5, 2 + rnd() * 5);
    }
    return { map, normalMap, roughnessMap: toTexture(rough, { srgb: false }) };
  });
}

/* ---------------------------- 木板 ---------------------------- */
/**
 * @param {{ plank?: number, gap?: number, base?: string, dark?: string }} opts
 *   plank 每块板的宽度（像素），gap 缝宽
 */
export function plankTextures(size = 512, opts = {}) {
  const { plank = 64, gap = 3, base = '#9c6b3c', dark = '#6d4523', seed = 31 } = opts;
  return once(`plank${size}${plank}${gap}${base}`, () => {
    const rnd = mulberry32(seed);
    const cv = canvas(size);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = dark;
    ctx.fillRect(0, 0, size, size);

    const rows = Math.round(size / plank);
    for (let r = 0; r < rows; r++) {
      const y = r * plank;
      // 每块板的色差
      const tone = 0.86 + rnd() * 0.28;
      const c = new THREE.Color(base).multiplyScalar(tone);
      ctx.fillStyle = `#${c.getHexString()}`;
      ctx.fillRect(0, y, size, plank - gap);

      // 木纹
      const lines = 5 + Math.floor(rnd() * 5);
      for (let i = 0; i < lines; i++) {
        ctx.strokeStyle = i % 2 ? 'rgba(60,38,20,0.20)' : 'rgba(255,225,180,0.10)';
        ctx.lineWidth = 0.6 + rnd() * 1.2;
        ctx.beginPath();
        const ly = y + 3 + rnd() * (plank - gap - 6);
        ctx.moveTo(0, ly);
        for (let x = 0; x <= size; x += 24) {
          ctx.lineTo(x, ly + Math.sin(x * 0.03 + i) * 1.6);
        }
        ctx.stroke();
      }
      // 钉子
      for (const nx of [6, size - 12]) {
        ctx.fillStyle = 'rgba(40,30,22,0.55)';
        ctx.beginPath();
        ctx.arc(nx, y + (plank - gap) / 2, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      // 板缝高光
      ctx.fillStyle = 'rgba(255,240,210,0.10)';
      ctx.fillRect(0, y + plank - gap - 1, size, 1);
    }

    // 法线：板缝是凹槽
    const h = canvas(size);
    const hctx = h.getContext('2d');
    hctx.fillStyle = '#b0b0b0';
    hctx.fillRect(0, 0, size, size);
    for (let r = 0; r < rows; r++) {
      const y = r * plank;
      hctx.fillStyle = '#5a5a5a';
      hctx.fillRect(0, y + plank - gap, size, gap);
      hctx.fillStyle = '#d8d8d8';
      hctx.fillRect(0, y + 1, size, 2);
    }
    return {
      map: toTexture(cv),
      normalMap: toTexture(heightToNormal(h, 1.4), { srgb: false }),
      roughnessMap: null,
    };
  });
}

/** 湿沙（水线附近更暗、更平） */
export function wetSandTextures(size = 512) {
  return sandTextures(size, { base: '#a98a63', dark: '#8a6f4e', light: '#c2a37c', seed: 91 });
}

/** 礁石：灰褐色带苔藓，用于岬角散石 */ 
export function rockTexture(size = 256) {
  return once(`rock${size}`, () => {
    const rnd = mulberry32(1234);
    const cv = canvas(size);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#7d7668';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 900; i++) {
      const v = 70 + rnd() * 70;
      ctx.fillStyle = `rgba(${v},${v - 6},${v - 16},${0.25 + rnd() * 0.5})`;
      ctx.beginPath();
      ctx.arc(rnd() * size, rnd() * size, 1 + rnd() * 6, 0, Math.PI * 2);
      ctx.fill();
    }
    // 苔藓
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(96,118,72,${0.10 + rnd() * 0.22})`;
      ctx.beginPath();
      ctx.arc(rnd() * size, rnd() * size, 4 + rnd() * 14, 0, Math.PI * 2);
      ctx.fill();
    }
    return toTexture(cv);
  });
}

/** 棕榈叶 */
export function palmTexture(size = 128) {
  return once(`palm${size}`, () => {
    const rnd = mulberry32(555);
    const cv = canvas(size);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#4e9b3f';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 260; i++) {
      ctx.strokeStyle = rnd() < 0.5 ? 'rgba(30,70,26,0.45)' : 'rgba(150,205,110,0.35)';
      ctx.lineWidth = 0.8 + rnd() * 1.4;
      const x = rnd() * size;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + (rnd() - 0.5) * 10, size);
      ctx.stroke();
    }
    return toTexture(cv);
  });
}

/* ================================================================== *
 * 第二章第二阶段：小屋 / 桥板 / 礁石 / 布料 的贴图
 *
 * 全部 256² 以内、程序化生成，只在本机内存里存在，不进包。
 * 返回 { map, normalMap }，其中 normalMap 由高度图 Sobel 得出。
 * ================================================================== */

/** 通用：画一张颜色图 + 一张同尺寸高度图，返回两个纹理 */
function surface(key, size, paint, height, { strength = 1.1, aniso = 4 } = {}) {
  return once(key, () => {
    const cv = canvas(size);
    const ctx = cv.getContext('2d');
    paint(ctx, size);
    const h = canvas(size);
    const hctx = h.getContext('2d');
    hctx.fillStyle = '#808080';
    hctx.fillRect(0, 0, size, size);
    height(hctx, size);
    return {
      map: toTexture(cv, { aniso }),
      normalMap: toTexture(heightToNormal(h, strength), { srgb: false, aniso }),
    };
  });
}

/** 横向企口板墙（海滨小屋的外墙） */
export function sidingTexture(base = '#efeade', shade = 'rgba(120,108,92,0.30)', size = 256) {
  const BOARD = 22;
  return surface(`siding${base}${size}`, size, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const rnd = mulberry32(21);
    for (let y = 0; y < s; y += BOARD) {
      ctx.fillStyle = shade;
      ctx.fillRect(0, y + BOARD - 2, s, 2);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(0, y + 1, s, 1);
    }
    // 木纹细线
    for (let i = 0; i < 220; i++) {
      ctx.strokeStyle = rnd() < 0.5 ? 'rgba(120,105,88,0.06)' : 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 0.7;
      const y = rnd() * s;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(s, y + (rnd() - 0.5) * 2);
      ctx.stroke();
    }
  }, (h, s) => {
    for (let y = 0; y < s; y += BOARD) {
      h.fillStyle = '#3a3a3a';
      h.fillRect(0, y + BOARD - 2, s, 2);
      h.fillStyle = '#dcdcdc';
      h.fillRect(0, y, s, 2);
    }
  }, { strength: 1.5 });
}

/** 竖向挡雨板墙（渔村小屋） */
export function boardWallTexture(base = '#b53c33', dark = 'rgba(60,18,14,0.34)', size = 256) {
  const BOARD = 20;
  return surface(`boardwall${base}${size}`, size, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const rnd = mulberry32(33);
    for (let x = 0; x < s; x += BOARD) {
      ctx.fillStyle = rnd() < 0.5 ? dark : 'rgba(255,235,225,0.08)';
      ctx.fillRect(x, 0, BOARD, s);
      ctx.fillStyle = 'rgba(30,14,10,0.30)';
      ctx.fillRect(x + BOARD - 2, 0, 2, s);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(x + 1, 0, 1, s);
    }
  }, (h, s) => {
    for (let x = 0; x < s; x += BOARD) {
      h.fillStyle = '#3c3c3c';
      h.fillRect(x + BOARD - 2, 0, 2, s);
      h.fillStyle = '#d6d6d6';
      h.fillRect(x, 0, 2, s);
    }
  }, { strength: 1.6 });
}

/** 灰泥墙（茅草屋） */
export function stuccoTexture(base = '#e0ab58', size = 256) {
  return surface(`stucco${base}${size}`, size, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const rnd = mulberry32(71);
    for (let i = 0; i < 1600; i++) {
      const v = rnd();
      ctx.fillStyle = v < 0.5 ? 'rgba(120,80,30,0.10)' : 'rgba(255,240,210,0.12)';
      ctx.beginPath();
      ctx.arc(rnd() * s, rnd() * s, 0.8 + rnd() * 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }, (h, s) => {
    const rnd = mulberry32(72);
    for (let i = 0; i < 2600; i++) {
      const v = Math.floor(110 + rnd() * 60);
      h.fillStyle = `rgb(${v},${v},${v})`;
      h.beginPath();
      h.arc(rnd() * s, rnd() * s, 0.8 + rnd() * 2.6, 0, Math.PI * 2);
      h.fill();
    }
  }, { strength: 0.8 });
}

/** 屋面瓦（蓝屋顶 / 石板瓦） */
export function shingleTexture(base = '#3574a0', dark = 'rgba(10,30,54,0.42)', size = 256) {
  const ROW = 24;
  return surface(`shingle${base}${size}`, size, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const rnd = mulberry32(101);
    for (let y = 0; y < s; y += ROW) {
      const off = (y / ROW) % 2 ? 16 : 0;
      for (let x = -32; x < s; x += 32) {
        const tone = 0.88 + rnd() * 0.24;
        ctx.fillStyle = shadeColor(base, tone);
        ctx.fillRect(x + off + 1, y + 1, 30, ROW - 2);
      }
      ctx.fillStyle = dark;
      ctx.fillRect(0, y + ROW - 2, s, 2);
    }
  }, (h, s) => {
    for (let y = 0; y < s; y += ROW) {
      h.fillStyle = '#4a4a4a';
      h.fillRect(0, y + ROW - 2, s, 2);
      h.fillStyle = '#c8c8c8';
      h.fillRect(0, y, s, 3);
    }
  }, { strength: 1.3 });
}

/** 茅草 */
export function thatchTexture(base = '#c9a253', dark = '#8e6a2e', size = 256) {
  return surface(`thatch${base}${size}`, size, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const rnd = mulberry32(131);
    for (let i = 0; i < 2400; i++) {
      const x = rnd() * s;
      const y = rnd() * s;
      ctx.strokeStyle = rnd() < 0.55 ? dark : 'rgba(240,215,150,0.55)';
      ctx.globalAlpha = 0.25 + rnd() * 0.5;
      ctx.lineWidth = 0.8 + rnd() * 1.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rnd() - 0.5) * 4, y + 10 + rnd() * 16);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }, (h, s) => {
    const rnd = mulberry32(132);
    for (let i = 0; i < 1800; i++) {
      const v = Math.floor(70 + rnd() * 120);
      h.fillStyle = `rgb(${v},${v},${v})`;
      h.fillRect(rnd() * s, rnd() * s, 1.5, 6 + rnd() * 14);
    }
  }, { strength: 1.9 });
}

/** 木纹（桥板、栏杆、木构件通用） */
export function woodTexture(base = '#b08a55', dark = 'rgba(70,42,18,0.34)', size = 256, opts = {}) {
  const { grain = 26, knots = 3 } = opts;
  return surface(`wood${base}${size}${grain}`, size, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const rnd = mulberry32(151);
    for (let i = 0; i < grain; i++) {
      const y0 = rnd() * s;
      ctx.strokeStyle = rnd() < 0.6 ? dark : 'rgba(255,232,196,0.18)';
      ctx.lineWidth = 0.7 + rnd() * 2.2;
      ctx.beginPath();
      for (let x = 0; x <= s; x += 16) {
        const y = y0 + Math.sin(x * 0.021 + i * 1.7) * (1.6 + rnd() * 2.4);
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    for (let k = 0; k < knots; k++) {
      const cx = rnd() * s, cy = rnd() * s;
      for (let r = 7; r > 0; r -= 1.6) {
        ctx.strokeStyle = `rgba(72,44,20,${0.10 + r * 0.03})`;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r * 1.7, r, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }, (h, s) => {
    const rnd = mulberry32(152);
    for (let i = 0; i < 300; i++) {
      const y0 = rnd() * s;
      const v = Math.floor(100 + rnd() * 70);
      h.strokeStyle = `rgb(${v},${v},${v})`;
      h.lineWidth = 0.8 + rnd() * 1.8;
      h.beginPath();
      for (let x = 0; x <= s; x += 16) {
        const y = y0 + Math.sin(x * 0.021 + i) * 2.0;
        x === 0 ? h.moveTo(x, y) : h.lineTo(x, y);
      }
      h.stroke();
    }
  }, { strength: 0.9 });
}

/** 布（遮阳伞 / 看台顶棚 / 旗子） */
export function fabricTexture(base = '#f3eddc', size = 128) {
  return surface(`fabric${base}${size}`, size, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const rnd = mulberry32(181);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.045)' : 'rgba(255,255,255,0.10)';
      ctx.fillRect(rnd() * s, rnd() * s, 1, 3 + rnd() * 5);
    }
    for (let y = 0; y < s; y += 6) {
      ctx.fillStyle = 'rgba(0,0,0,0.035)';
      ctx.fillRect(0, y, s, 1);
    }
  }, (h, s) => {
    for (let y = 0; y < s; y += 6) {
      h.fillStyle = '#6a6a6a';
      h.fillRect(0, y, s, 1);
    }
  }, { strength: 0.7 });
}

/** 礁石 / 石砌 */
export function stoneTexture(base = '#8d8678', size = 256, opts = {}) {
  const { mossy = 0.12 } = opts;
  return surface(`stone${base}${size}${mossy}`, size, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const rnd = mulberry32(211);
    for (let i = 0; i < 700; i++) {
      const v = 70 + rnd() * 90;
      ctx.fillStyle = `rgba(${v},${v - 4},${v - 14},${0.12 + rnd() * 0.34})`;
      ctx.beginPath();
      ctx.arc(rnd() * s, rnd() * s, 1 + rnd() * 9, 0, Math.PI * 2);
      ctx.fill();
    }
    if (mossy > 0) {
      for (let i = 0; i < 60; i++) {
        ctx.fillStyle = `rgba(96,124,70,${mossy * (0.4 + rnd())})`;
        ctx.beginPath();
        ctx.arc(rnd() * s, rnd() * s, 3 + rnd() * 16, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, (h, s) => {
    const rnd = mulberry32(212);
    for (let i = 0; i < 1400; i++) {
      const v = Math.floor(90 + rnd() * 100);
      h.fillStyle = `rgb(${v},${v},${v})`;
      h.beginPath();
      h.arc(rnd() * s, rnd() * s, 1 + rnd() * 7, 0, Math.PI * 2);
      h.fill();
    }
  }, { strength: 1.5 });
}

/** 沙地细节（近白色，只提供颗粒与法线，颜色由顶点色决定） */
export function sandDetailTextures(size = 256) {
  return surface('sanddetail', size, (ctx, s) => {
    ctx.fillStyle = '#e9e4d8';
    ctx.fillRect(0, 0, s, s);
    const rnd = mulberry32(311);
    for (let i = 0; i < s * 22; i++) {
      const v = rnd();
      ctx.fillStyle = v < 0.5 ? 'rgba(150,132,104,0.16)' : 'rgba(255,255,255,0.22)';
      ctx.beginPath();
      ctx.arc(rnd() * s, rnd() * s, 0.5 + rnd() * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // 风纹
    for (let i = 0; i < 12; i++) {
      ctx.strokeStyle = i % 2 ? 'rgba(150,132,104,0.09)' : 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 1 + rnd() * 3;
      const y0 = rnd() * s;
      ctx.beginPath();
      for (let x = 0; x <= s; x += 6) {
        const y = y0 + Math.sin(x * 0.05 + i) * (1.5 + rnd() * 2);
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, (h, s) => {
    const rnd = mulberry32(312);
    for (let i = 0; i < s * 26; i++) {
      const v = Math.floor(100 + rnd() * 70);
      h.fillStyle = `rgb(${v},${v},${v})`;
      h.fillRect(rnd() * s, rnd() * s, 1 + rnd() * 2, 1 + rnd() * 2);
    }
  }, { strength: 0.55 });
}

/** 把 hex 颜色按系数提亮/压暗 */
function shadeColor(hex, k) {
  const c = new THREE.Color(hex).multiplyScalar(k);
  return `#${c.getHexString()}`;
}

/* ------------------------- 起点门横幅 ------------------------- */
/**
 * 沙滩杯起点门的横幅。
 *
 * 两个坑都得在这里一次性解决：
 *
 * 1. UV 是米制的平面投影（横幅前后两面 u=x、v=z），所以横幅在 Blender 里
 *    是 18.6 m × 1.15 m —— 一块 16:1 的窄条。画布直接按 2048×160 画，
 *    横向一像素代表 0.015 m、纵向一像素代表 0.0072 m，字会被拉成胖体。
 *    这里用 ctx.scale 把**逻辑坐标系**改成和最终屏幕比例一致（2048×77），
 *    之后所有坐标都按「看到的比例」写，字宽自然。
 *
 * 2. 起点门要跟着赛道宽度沿 X 拉伸（实例矩阵 kx≈1.65）。贴图是按 UV 铺的，
 *    拉伸发生在几何上，所以最终长宽比是 30.7 m : 1.15 m。上面的 26.7 就是
 *    这个比例。
 */
export function bannerTexture(w = 2048, h = 160) {
  return once(`banner${w}x${h}`, () => {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    const FINAL = 30.7 / 1.15;              // 拉伸后的长宽比
    const LOG_H = w / FINAL;                // 逻辑高度（≈77）
    ctx.scale(1, h / LOG_H);                // 之后按 2048×77 的逻辑坐标画

    // 布底：上亮下暗一点点，不做渐变背景的假立体
    ctx.fillStyle = '#f7f0dd';
    ctx.fillRect(0, 0, w, LOG_H);
    const g = ctx.createLinearGradient(0, 0, 0, LOG_H);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(0.55, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(120,96,60,0.13)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, LOG_H);
    // 帆布竖缝
    ctx.fillStyle = 'rgba(120,100,64,0.10)';
    for (let x = 128; x < w; x += 128) ctx.fillRect(x, 0, 1, LOG_H);

    // 两端黑白格：一眼就是赛车场
    const cell = LOG_H / 5;
    for (const x0 of [0, w - cell * 6]) {
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 6; c++) {
          ctx.fillStyle = (r + c) % 2 ? '#f7f0dd' : '#20395b';
          ctx.fillRect(x0 + c * cell, r * cell, cell + 0.5, cell + 0.5);
        }
      }
    }

    /* 一行字，顶到横幅的八成高。
     *
     * 一开始写成「中文主标 + 英文副标」两行，字号 40 / 15 —— 放到 30 m
     * 宽、1.15 m 高的横幅上，字只占宽度的 10%，实机里就是中间一条淡蓝色
     * 的糊斑，等于没写。横幅长宽比 26:1，能用的只有高度：字号顶到 60
     * （逻辑单位，约 0.9 m 高），一行排下来正好占一半宽度，远处也读得清。 */
    /* 一行字，顶到横幅高度的八成。
     *
     * 一开始写成「中文主标 + 英文副标」两行，字号 40 / 15 —— 放到 30 m
     * 宽、1.15 m 高的横幅上，字只占宽度的 10%，实机里就是中间一条淡蓝色
     * 的糊斑，等于没写。横幅长宽比 26:1，能用的只有高度：字号顶到 60
     * （逻辑单位，约 0.9 m 高），一行排下来占一半宽度，远处也读得清。 */
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#17527e';
    ctx.font = 'bold 60px "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';
    ctx.fillText('阳光沙滩杯 · SUNSHINE BEACH CUP', w / 2, LOG_H * 0.52);

    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  });
}
