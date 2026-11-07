import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BEACH_RIVER, RIVER_HALF } from './chapter2/beachData.js';
import { sandDetailTextures, wetSandTextures, bannerTexture } from './beachTextures.js';
import { ch2Material } from './ch2/materials.js';

/* ==================================================================
 * 第二章 · 贝壳湾的海岸（第二阶段：正式美术）
 *
 * 分工：
 *   · 路面、检查点、碰撞、AI —— 全在 Track 里，这一层一个字节都不动；
 *   · 赛道两侧的「世界」—— 沙地地形、海、潮汐河、白浪、九段道具；
 *   · 道具模型来自 Blender（public/assets/ch2/*.glb），按材质实例化。
 *
 * 坐标约定：+X 东，+Z 南，海在赛道外侧（控制点第 6 列 sea = ±1）。
 *
 * 性能守则（iPhone Safari）：
 *   · 所有重复道具走 InstancedMesh，一个材质一次 draw call；
 *   · 每一类道具都有自己的三角面预算，加起来 < 20 万面；
 *   · 只有大件（小屋、棕榈、木桥构件、看台、起点门）投影阴影，
 *     草簇、浮标、小石头不投影 —— 阴影贴图是移动端最贵的一项。
 * ================================================================== */

const SEA_Y = -7.5;
const SEA_OFFSET = 74;          // 从路缘到水线的距离（沙滩宽度）
const SAND_FLAT = 8;            // 路缘外的平沙带

/* 复用的临时向量。所有对外方法都在调用期间用完即弃，不会跨帧持有。 */
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

const smoothstep = (a, b, x) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, u), THREE.MathUtils.lerp(c, d, u), v);
}
function fbm(x, y) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < 4; i++) { s += vnoise(x * f, y * f) * amp; amp *= 0.5; f *= 2.03; }
  return s;
}
/* 河床上游抬高权重：0 = 河口（深），1 = 内陆末端（干河床）。
 * 为什么需要：河水表面是一张固定 y=0.55 的带状面，如果河床沿线一路挖到
 * -3.4 不管上游，河水就会在金色沙滩直道的内侧凭空出现一汪方形水塘 ——
 * 那是河道上游的端头，正好在 d≈190 的左手边，飞到取景框里。
 * 让河床从桥下往上游逐渐抬高到 +0.95，水面（0.55）自然被埋掉，
 * 上游只剩一道浅沟，像退潮后的河床。桥下（下标 3~4）保持 0 不变。 */
const RIVER_W = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0.15, 0.45, 0.80, 1.0];
const RIVER_BED_DEEP = -3.4;
const RIVER_BED_DRY = 0.95;

/** 到河心线的距离 + 上游权重（权重按最近线段线性插值，不会一格格跳） */
function riverDepth(x, z) {
  let best = Infinity, w = 0;
  for (let i = 0; i < BEACH_RIVER.length - 1; i++) {
    const [x1, z1] = BEACH_RIVER[i], [x2, z2] = BEACH_RIVER[i + 1];
    const dx = x2 - x1, dz = z2 - z1;
    const t = THREE.MathUtils.clamp(((x - x1) * dx + (z - z1) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    const d = Math.hypot(x - (x1 + dx * t), z - (z1 + dz * t));
    if (d < best) { best = d; w = THREE.MathUtils.lerp(RIVER_W[i], RIVER_W[i + 1], t); }
  }
  return { d: best, w };
}

function distToPolyline(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
    const dx = x2 - x1, dz = z2 - z1;
    const t = THREE.MathUtils.clamp(((x - x1) * dx + (z - z1) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    best = Math.min(best, Math.hypot(x - (x1 + dx * t), z - (z1 + dz * t)));
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * 1. 高度场：沙嘴 / 沙丘 / 海床 / 河床
 * ------------------------------------------------------------------ */
function makeHeightField(track) {
  const STRIDE = 6;
  const m = Math.floor(track.n / STRIDE);
  const sx = new Float32Array(m), sy = new Float32Array(m), sz = new Float32Array(m);
  const rx = new Float32Array(m), rz = new Float32Array(m), ry = new Float32Array(m);
  const wd = new Float32Array(m), sd = new Int8Array(m), kd = new Uint8Array(m);
  for (let k = 0; k < m; k++) {
    const i = k * STRIDE;
    sx[k] = track.pos[i * 3]; sy[k] = track.pos[i * 3 + 1]; sz[k] = track.pos[i * 3 + 2];
    rx[k] = track.right[i * 3]; rz[k] = track.right[i * 3 + 2];
    ry[k] = track.right[i * 3 + 1];   // 路面有横向倾角，地形必须跟着，否则会被路面切穿
    wd[k] = track.width[i]; sd[k] = track.sea[i]; kd[k] = track.kind[i];
  }

  /* 每段的「路缘到水线」距离。全球默认 74 m，礁石岬角那一段收到 40 m。
   *
   * 为什么必须分段：整条沙滩统一 74 m 时，水线离路缘有 53 m，从驾驶位
   * 看过去海被沙脊完全挡住 —— 「礁石岬角」这一段在实机里既看不到礁石
   * 群外的水，也看不到浪，和别的直道没有区别。岬角本来就该是陆地伸进
   * 海里、水贴着岩石，所以这一段把水面拉近，坡度顺便变陡，正好当礁石
   * 海岸。两侧 40 m 内平滑过渡，不会出现台阶。 */
  const dOf = (i) => i * (track.length / track.n);
  const pointSec = (track.sections || []).find((s) => s.id === 'point');
  const od = new Float32Array(m);
  for (let k = 0; k < m; k++) {
    let off = SEA_OFFSET;
    if (pointSec && sd[k] !== 0) {
      const c = (pointSec.d0 + pointSec.d1) * 0.5;
      const half = (pointSec.d1 - pointSec.d0) * 0.5;
      const w = 1 - smoothstep(half * 0.5, half + 46, Math.abs(dOf(k * STRIDE) - c));
      off = SEA_OFFSET + (40 - SEA_OFFSET) * w;
    }
    od[k] = off;
  }

  const CELL = 40;
  const buckets = new Map();
  const key = (cx, cz) => cz * 4096 + cx;
  for (let k = 0; k < m; k++) {
    const kk = key(Math.floor(sx[k] / CELL), Math.floor(sz[k] / CELL));
    let arr = buckets.get(kk);
    if (!arr) buckets.set(kk, (arr = []));
    arr.push(k);
  }

  const nearest = (x, z) => {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    let best = -1, bestD = Infinity;
    for (let ring = 0; ring < 40; ring++) {
      for (let a = -ring; a <= ring; a++) {
        for (let b = -ring; b <= ring; b++) {
          if (ring > 0 && Math.max(Math.abs(a), Math.abs(b)) !== ring) continue;
          const arr = buckets.get(key(cx + a, cz + b));
          if (!arr) continue;
          for (const k of arr) {
            const d = (x - sx[k]) ** 2 + (z - sz[k]) ** 2;
            if (d < bestD) { bestD = d; best = k; }
          }
        }
      }
      if (best >= 0 && ring >= 2) break;
    }
    return { k: best < 0 ? 0 : best, d: Math.sqrt(bestD) };
  };

  const heightAt = (x, z) => {
    const { k, d } = nearest(x, z);
    const ccx = sx[k], ccz = sz[k], base = sy[k];
    const lat = (x - ccx) * rx[k] + (z - ccz) * rz[k];
    const s = sd[k];
    let y;

    if (s !== 0) {
      const side = lat * Math.sign(s);          // >0 = 朝海
      if (side > 0) {
        // 沙嘴：路肩平沙 → 缓坡入水
        const flat = wd[k] + SAND_FLAT;
        /* 关键：**不能用 smoothstep**。
         *
         * smoothstep 两端的导数都是 0，也就是坡顶和坡脚各有一小段平台。
         * 坡脚那段平台正好压在水位线上 —— 沙面在那儿几乎是水平的，
         * 5 m 一格的网格和 y=-7.5 求交就变成一条大锯齿，近景看海岸线
         * 像被剪刀剪过。
         *
         * 但也不能一路陡到底：路缘外那几米是车冲出赛道后要爬回来的地方，
         * 坡太陡会把冲出赛道的车困在沙里（AI 三圈里出现过 6 s 不动的记录）。
         * 用 u·(0.4+0.6u)：坡顶斜率 0.4（和原来接近，车爬得上来），
         * 坡脚斜率 1.6（水线切得干净）。两头都照顾到了。 */
        const u = THREE.MathUtils.clamp((side - flat) / Math.max(od[k] - 20, 1), 0, 1);
        const t = u * (0.4 + 0.6 * u);
        const wobble = fbm(x * 0.02, z * 0.02) * 1.1 * (1 - t);
        y = THREE.MathUtils.lerp(base - 0.25, SEA_Y - 4.6, t) + wobble * t;
      } else {
        // 内陆：抬起来长草
        const d2 = -side;
        const t = smoothstep(wd[k] + 3, wd[k] + 46, d2);
        y = base - 0.25 + t * 2.6 + fbm(x * 0.02, z * 0.02) * 1.2 * t;
      }
    } else {
      const over = Math.max(0, d - wd[k]);
      y = base - 0.25 + smoothstep(0, 34, over) * (1.6 + fbm(x * 0.015, z * 0.015) * 1.8);
    }

    /* 远场：贝壳湾是个沙嘴，不是无限大的沙盘。
     * 不处理的话，离赛道 100 m 以外会一直维持在 +4 m 的平坦沙面，
     * 一直铺到网格边缘再被一刀切断 —— 鸟瞰时像一块悬空的桌面。
     * 130 m 外开始下沉，260 m 完全没入海面，海岸线就有了形状。 */
    const far = smoothstep(130, 260, d);
    if (far > 0) y = THREE.MathUtils.lerp(y, SEA_Y - 3.5, far * 0.92);

    // 河床：靠近河心线整体压下去，越往上游越浅（详见 RIVER_W 的注释）
    const rv = riverDepth(x, z);
    if (rv.d < 46) {
      const t = smoothstep(RIVER_HALF - 3, 34, rv.d);
      const bed = THREE.MathUtils.lerp(RIVER_BED_DEEP, RIVER_BED_DRY, rv.w);
      y = THREE.MathUtils.lerp(bed, y, t);
    }
    /* 路面走廊：贴着路面高度做「路肩」，再在 3~26 m 内平滑接到自然地形。
     * 硬台阶会让桥头那种抬高路段变成一圈陡峭的高台。
     *
     * 桥段（kind=3）**必须跳过这一步**：桥是架在河口上的结构，把桥下的
     * 沙地抬到桥面高度等于把河填平 —— 桥会看起来像贴在沙滩上的一块木板，
     * 桥墩、河面、水位差全部消失。这是桥梁段落唯一的特殊处理。 */
    if (kd[k] === 3) return y;
    const w0 = wd[k];
    const roadY = base - 0.22 + ry[k] * lat;
    if (d < w0 + 3) y = roadY;
    else if (d < w0 + 26) y = THREE.MathUtils.lerp(roadY, y, smoothstep(w0 + 3, w0 + 26, d));
    return y;
  };

  return { heightAt, nearest };
}

/* ------------------------------------------------------------------ *
 * 2. 沙地网格
 * ------------------------------------------------------------------ */
function buildTerrain(track, hf, bounds) {
  const { minX, maxX, minZ, maxZ } = bounds;

  const CELL = 5;
  const nx = Math.round((maxX - minX) / CELL) + 1;
  const nz = Math.round((maxZ - minZ) / CELL) + 1;
  const count = nx * nz;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);

  /* 三种沙的手感分开：干沙亮、湿沙深、坡顶偏草绿。
   * 顶点色只负责「大色块」，颗粒感和法线由 sandDetail 贴图给。 */
  const sandDry = new THREE.Color('#e6cfa2');
  const sandWet = new THREE.Color('#b89a74');
  const duneGrass = new THREE.Color('#a9bb84');
  const rockShelf = new THREE.Color('#938b7c');
  const c = new THREE.Color();

  for (let iz = 0; iz < nz; iz++) {
    const z = minZ + iz * CELL;
    for (let ix = 0; ix < nx; ix++) {
      const x = minX + ix * CELL;
      const i = iz * nx + ix;
      let y = hf.heightAt(x, z);
      /* 网格最外两圈强制沉到海平面以下，接缝藏在海里 */
      const edge = Math.min(x - minX, maxX - x, z - minZ, maxZ - z);
      if (edge < 60) y = THREE.MathUtils.lerp(SEA_Y - 6, y, smoothstep(0, 60, edge));
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      uv[i * 2] = x / 8; uv[i * 2 + 1] = z / 8;

      c.copy(sandDry);
      // 内陆偏高处长草
      const grass = smoothstep(5.6, 8.6, y) * 0.7;
      c.lerp(duneGrass, grass * (0.55 + 0.45 * vnoise(x * 0.03, z * 0.03)));
      // 水线附近是湿沙：颜色压深，尺度带一点沿水线的拉伸
      const wet = 1 - smoothstep(SEA_Y - 0.5, SEA_Y + 2.1, y);
      c.lerp(sandWet, wet * (0.85 + 0.15 * vnoise(x * 0.07, z * 0.07)));
      // 河岸压深
      const dr = distToPolyline(x, z, BEACH_RIVER);
      if (dr < 30) c.lerp(sandWet, 0.55 * (1 - smoothstep(10, 30, dr)));
      // 岬角礁石带
      if (y < 2.6 && x > 150 && vnoise(x * 0.09 + 7, z * 0.09 - 3) > 0.62) c.lerp(rockShelf, 0.45);
      // 细碎的明暗斑，避免大面积同色
      const mottle = 0.92 + 0.16 * vnoise(x * 0.11 + 3, z * 0.11 - 5);
      col[i * 3] = c.r * mottle; col[i * 3 + 1] = c.g * mottle; col[i * 3 + 2] = c.b * mottle;
    }
  }

  const idx = [];
  for (let iz = 0; iz < nz - 1; iz++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      const a = iz * nx + ix, b = a + 1, cc = a + nx, d = cc + 1;
      idx.push(a, cc, b, b, cc, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(count > 65535 ? new THREE.BufferAttribute(new Uint32Array(idx), 1) : idx);
  geo.computeVertexNormals();

  const detail = sandDetailTextures(256);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: detail.map,
    normalMap: detail.normalMap,
    normalScale: new THREE.Vector2(0.45, 0.45),
    roughness: 0.98,
    metalness: 0,
    envMapIntensity: 0.18,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'beachTerrain';
  return mesh;
}

/* ------------------------------------------------------------------ *
 * 3. 离岸距离图（给海水着色与白浪用）
 *
 * 海面是一整块 3.6 km 的平面，如果按「到某个固定点的距离」上色，
 * 从任何角度看都是错的。这里预烘一张「水深图」：每个像素存该处
 * 地面比海平面低多少米。着色器采样它就能得到
 *   近岸浅绿 → 稍远青蓝 → 远处深蓝，
 * 白浪也只在 depth≈0 的一圈出现。
 * ------------------------------------------------------------------ */
function buildShoreMap(hf, bounds, size = 128) {
  const data = new Uint8Array(size * size * 4);
  const { minX, maxX, minZ, maxZ } = bounds;
  const dz = (maxZ - minZ) / size;
  const dx = (maxX - minX) / size;
  for (let j = 0; j < size; j++) {
    const z = minZ + (j + 0.5) * dz;
    for (let i = 0; i < size; i++) {
      const x = minX + (i + 0.5) * dx;
      const h = hf.heightAt(x, z);
      const depth = THREE.MathUtils.clamp(SEA_Y - h, 0, 16);
      const k = (j * size + i) * 4;
      data[k] = Math.round((depth / 16) * 255);
      data[k + 1] = Math.round(THREE.MathUtils.clamp((h - SEA_Y) / 6, 0, 1) * 255);
      data[k + 2] = Math.round(vnoise(x * 0.05, z * 0.05) * 255);
      data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/* ------------------------------------------------------------------ *
 * 4. 海面
 * ------------------------------------------------------------------ */
const SEA_COMMON = /* glsl */`
  uniform sampler2D uShore;
  uniform vec2 uShoreMin;
  uniform vec2 uShoreSize;

  float depthAt(vec2 p) {
    vec2 uv = (p - uShoreMin) / uShoreSize;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 16.0;
    return texture2D(uShore, uv).r * 16.0;
  }

  // 三组低频波。振幅很小：0.1 m 级，目的是水面有起伏而不是造浪。
  float waveH(vec2 p, float t) {
    return sin(p.x * 0.055 + t * 0.85) * 0.115
         + sin(p.y * 0.041 - t * 0.71) * 0.085
         + sin((p.x + p.y) * 0.021 + t * 0.49) * 0.135
         + sin((p.x - p.y * 0.7) * 0.137 + t * 1.6) * 0.028;
  }
`;

function buildSea(shoreTex, bounds) {
  /* 分段：海面本身不需要细化到 22 m —— 浪的细节在片元里给，
   * 顶点位移只负责让远处天际线不是一条直尺。 */
  /* 2600 而不是 3600：海面必须整个落在天空球（半径 1800）里面，
   * 否则海面远端会跑到天空球外面，被它的深度挡掉、露出一条硬边。 */
  const geo = new THREE.PlaneGeometry(2600, 2600, 128, 128);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uShallow: { value: new THREE.Color('#7fe6d6').convertSRGBToLinear() },
      uMid: { value: new THREE.Color('#2ab3c6').convertSRGBToLinear() },
      uDeep: { value: new THREE.Color('#0a4c86').convertSRGBToLinear() },
      uSky: { value: new THREE.Color('#bfe4f2').convertSRGBToLinear() },
      uFog: { value: new THREE.Color('#a9d3e8').convertSRGBToLinear() },
      uShore: { value: shoreTex },
      uShoreMin: { value: new THREE.Vector2(bounds.minX, bounds.minZ) },
      uShoreSize: { value: new THREE.Vector2(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) },
    },
    vertexShader: /* glsl */`
      uniform float uTime;
      varying vec3 vW;
      varying float vDepth;
      ${SEA_COMMON}
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vDepth = depthAt(wp.xz);
        // 岸边把浪压平，否则水线会在沙子上来回爬
        float damp = smoothstep(0.0, 2.2, vDepth);
        wp.y += waveH(wp.xz, uTime) * damp;
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform vec3 uShallow, uMid, uDeep, uSky, uFog;
      varying vec3 vW;
      varying float vDepth;
      ${SEA_COMMON}

      vec3 waveNormal(vec2 p, float t) {
        float e = 1.1;
        float h0 = waveH(p, t);
        float hx = waveH(p + vec2(e, 0.0), t);
        float hz = waveH(p + vec2(0.0, e), t);
        return normalize(vec3(-(hx - h0) / e, 1.0, -(hz - h0) / e));
      }

      void main() {
        float d = vDepth;

        /* 深浅三段：刚出水是透亮的松石绿，3 m 左右转青蓝，12 m 以上深蓝。
         * 用两条 smoothstep 拼接，过渡处没有色带。 */
        vec3 col = mix(uShallow, uMid, smoothstep(0.15, 3.2, d));
        col = mix(col, uDeep, smoothstep(2.6, 11.0, d));

        vec3 V = normalize(cameraPosition - vW);
        vec3 N = waveNormal(vW.xz, uTime);
        // 远处不要高频法线，否则一条一条的亮线就是摩尔纹
        float far = smoothstep(60.0, 340.0, length(cameraPosition.xz - vW.xz));
        N = normalize(mix(N, vec3(0.0, 1.0, 0.0), far * 0.85));

        // 菲涅尔：掠射角反天光，这是水面「亮」的唯一来源，不用 sin 条纹
        float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
        col = mix(col, uSky, fres * 0.55);

        // 浅水区的透底光斑
        float caustic = sin(vW.x * 0.33 + uTime * 0.6) * sin(vW.z * 0.29 - uTime * 0.5);
        col += vec3(0.055, 0.075, 0.06) * max(caustic, 0.0) * (1.0 - smoothstep(0.2, 3.5, d)) * (1.0 - far);

        // 白浪：只在 depth 很小的一圈，跟着时间起伏
        float band = 1.0 - smoothstep(0.0, 1.15, d);
        float wob = 0.5 + 0.5 * sin(vW.x * 0.35 + vW.z * 0.28 + uTime * 1.15);
        float grain = 0.55 + 0.45 * sin(vW.x * 1.7 + uTime * 2.1) * sin(vW.z * 1.9 - uTime * 1.7);
        float foam = band * band * (0.55 + 0.45 * wob) * (0.7 + 0.3 * grain);
        col = mix(col, vec3(0.97, 0.99, 1.0), clamp(foam * 1.15, 0.0, 0.92));

        float fog = smoothstep(240.0, 1100.0, length(vW.xz - cameraPosition.xz));
        col = mix(col, uFog, fog * 0.88);

        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = SEA_Y;
  mesh.name = 'sea';
  mesh.renderOrder = -1;
  return mesh;
}

/* ------------------------------------------------------------------ *
 * 5. 潮汐河
 * ------------------------------------------------------------------ */
/* 起点门横幅上的字。
 *
 * 为什么不用 GLB 里那个盒子的 UV：Blender 侧是「按面法线选主轴做平面
 * 投影」，盒子同一条边的四个面共用同一套投影，字只有贴在对的那一面才
 * 正。实机里真正朝着镜头的那一面 v 落在同一行上（横向重复、纵向被
 * clamp 成常数），画上去的文字只剩中间一条淡蓝，等于没写。
 * 这里单独做一块 18.6 × 1.15 的贴图面，UV 明确是 0..1，位置和起点门
 * 用同一个实例矩阵（含沿 X 的拉伸），贴图必然摆正。
 */
function buildGateBanner(g) {
  /* 贴图必须 clone 一份：bannerTexture() 是带缓存的，同一个对象已经被
   * ch2Material('M_Gate_Banner') 拿去设过 repeat=1/18.6、offset=(0.5,-6)。
   * 那块面用的是 0..1 的平面 UV，直接复用会采样到贴图左下角的一个点，
   * 整条横幅只剩一片空白奶油色 —— 这个坑踩了两次。 */
  const tex = bannerTexture().clone();
  tex.needsUpdate = true;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(1, 1);
  tex.offset.set(0, 0);
  const mat = new THREE.MeshStandardMaterial({
    map: tex, roughness: 0.9, metalness: 0,
    envMapIntensity: 0.25, side: THREE.DoubleSide,
  });
  const geo = new THREE.PlaneGeometry(18.6, 1.15);
  const gate = new THREE.Matrix4().compose(
    new THREE.Vector3(g.x, g.y, g.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, g.yaw, 0)),
    g.scale || new THREE.Vector3(1, 1, 1),
  );
  /* 两面都贴：车从发车格开过去、从终点回来看，两面都得有字。
   * 单面的话另一侧会被横幅盒子挡住，只剩一条空白的奶油色带。 */
  const grp = new THREE.Group();
  grp.name = 'gateBanner';
  for (const s of [-1, 1]) {
    const mesh = new THREE.Mesh(geo, mat);
    const m = gate.clone()
      .multiply(new THREE.Matrix4().makeTranslation(0, 7.50, s * 0.34))
      .multiply(new THREE.Matrix4().makeRotationY(s > 0 ? 0 : Math.PI));
    mesh.applyMatrix4(m);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    grp.add(mesh);
  }
  return grp;
}

function buildRiver() {
  const pts = BEACH_RIVER.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const verts = [], idx = [], uvs = [];
  const W = RIVER_HALF + 0.6;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const t = new THREE.Vector3().subVectors(b, a).normalize();
    const r = new THREE.Vector3(-t.z, 0, t.x);
    /* 上游收窄：河道越往里越浅，水面跟着变窄，最后消失在沙里。
     * 不收窄的话端头会是一条笔直的切口，像一块插在沙地上的蓝玻璃。 */
    const wf = 1 - smoothstep(0.35, 0.88, RIVER_W[i]);
    const wi = W * Math.max(wf, 0.0);
    for (const s of [-1, 1]) {
      verts.push(pts[i].x + r.x * wi * s, 0.55, pts[i].z + r.z * wi * s);
      uvs.push(s * 0.5 + 0.5, i * 0.5);
    }
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  /* 河水不用贴图法线。
   * 试过三轮：法线贴图会在水面上留下按 6 m 一块平铺的深色斑，
   * 斜看过去整条河像迷彩布；把 normalScale 压到 0.10 也没用 ——
   * 低粗糙度的水面里，一点点法线扰动就足以让镜面在「反射天空」和
   * 「反射沙子」之间跳。改成程序化波形：
   * 片元用差分法线算菲涅尔，没有贴图就没有平铺感。
   *
   * 频率比海面高一档（波长 3~19 m，海面是 46~300 m）：河只有 30 m 宽，
   * 用海面的波长等于整条河一起上下浮，看不出水在动。 */
  const RIVER_WAVES = /* glsl */`
    float ripple(vec2 p, float t) {
      return sin(p.x * 0.86 + t * 1.55) * 0.050
           + sin(p.y * 0.52 - t * 1.18) * 0.062
           + sin((p.x + p.y) * 1.24 + t * 1.95) * 0.022
           + sin((p.x - p.y * 0.6) * 0.33 - t * 0.74) * 0.040;
    }
  `;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uShallow: { value: new THREE.Color(0x5bd8cd).convertSRGBToLinear() },
      uDeep: { value: new THREE.Color(0x17839c).convertSRGBToLinear() },
      uSky: { value: new THREE.Color(0xbfe4f2).convertSRGBToLinear() },
      uFog: { value: new THREE.Color(0xa9d3e8).convertSRGBToLinear() },
    },
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      varying vec3 vW;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        // 顶点不做位移：河道只是一条带状面，顶点很少，位移只会让它显得
        // 一块块折面。起伏全部由片元法线给。
        vW = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform vec3 uShallow, uDeep, uSky, uFog;
      varying vec3 vW;
      varying vec2 vUv;
      ${RIVER_WAVES}

      vec3 waveNormal(vec2 p, float t) {
        float e = 0.55;
        float h0 = ripple(p, t);
        return normalize(vec3(
          -(ripple(p + vec2(e, 0.0), t) - h0) / e, 1.0,
          -(ripple(p + vec2(0.0, e), t) - h0) / e));
      }

      void main() {
        float bank = smoothstep(0.0, 0.11, vUv.x) * smoothstep(1.0, 0.89, vUv.x);
        // 河心深、两岸浅
        vec3 col = mix(uShallow, uDeep, bank * 0.85);

        vec3 V = normalize(cameraPosition - vW);
        vec3 N = waveNormal(vW.xz, uTime);
        float far = smoothstep(45.0, 280.0, length(cameraPosition.xz - vW.xz));
        N = normalize(mix(N, vec3(0.0, 1.0, 0.0), far * 0.9));
        float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
        col = mix(col, uSky, fres * 0.62);

        // 岸边一圈很薄的白沫
        float edge = 1.0 - bank;
        col = mix(col, vec3(0.95, 0.99, 1.0), edge * edge * 0.65);

        float fog = smoothstep(220.0, 900.0, length(vW.xz - cameraPosition.xz));
        col = mix(col, uFog, fog * 0.85);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'river';
  mesh.userData.flow = mat;
  return mesh;
}

/* ------------------------------------------------------------------ *
 * 6. 白浪带 + 湿沙带
 * ------------------------------------------------------------------ */
function waterline(track, hf) {
  const P = new THREE.Vector3(), R = new THREE.Vector3();
  const stepS = 4;
  const line = [];
  for (let i = 0; i < track.n; i += stepS) {
    if (track.sea[i] <= 0) { line.push(null); continue; }
    track.getPos(i, P); track.getRight(i, R);
    const sgn = Math.sign(track.sea[i]);
    let hit = -1;
    for (let d = track.width[i] + 14; d < 160; d += 2) {
      if (hf.heightAt(P.x + R.x * sgn * d, P.z + R.z * sgn * d) < SEA_Y + 0.15) { hit = d; break; }
    }
    if (hit < 0) { line.push(null); continue; }
    line.push({
      x: P.x + R.x * sgn * hit, z: P.z + R.z * sgn * hit,
      nx: R.x * sgn, nz: R.z * sgn,
    });
  }
  return line;
}

/** 岸边白浪：一条随波形脉动的带子，盖住海水与沙滩的接缝。
 *
 * 原来的三条带子分别是 16 / 12 / 9 m 宽、72% / 46% / 26% 不透明度，
 * 加起来快 40 m 的岸线被一层半透明白色盖住 —— 从低机位看就是一整片
 * 惨白的糊状物，跟「适量白色浪花」正好相反。现在：
 *   · 收窄到 5.4 / 4.2 / 3.2 m，贴着水线才有一道浪；
 *   · 横向切成 3 个顶点，中间实、两边淡出（顶点 alpha），
 *     不再是硬边的塑料条；
 *   · 沿长度方向alpha 起伏，浪是一段一段碎的，不是一条连续的白线。
 */
/**
 * 碎浪贴图：一张可平铺的柔边噪点（软白团），用来打破原本「一条笔直白带」的
 * 死板感。配合顶点位移与缓慢的 UV 滚动，近岸浪花就有了连续、自然、不闪烁的
 * 起伏，而不是一条静态反光条。RGB 全白，alpha 是软噪点 —— 只做遮罩，不发光。
 */
function makeFoamTexture() {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  // 几十个柔边白团，大小不一、互相叠在一起 → 自然碎浪
  let seed = 9173;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < 46; i++) {
    const x = rnd() * S, y = rnd() * S, r = 6 + rnd() * 22;
    const a = 0.18 + rnd() * 0.42;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/* 碎浪顶点动画用的统一时间 uniforms（两个浪层共用，避免逐材质记账）。 */
const FOAM_UNIFORMS = { uTime: { value: 0 } };
let _foamTex = null;
function foamTexture() {
  if (!_foamTex) _foamTex = makeFoamTexture();
  return _foamTex;
}

/**
 * 礁石轻量优化：给每块石头加稳定的微随机倾倒（pitch/roll）+ 底部埋入 + 灰岩明暗
 * 微差，藏住几何上的切面棱角、去掉「浮在沙面上」的摆放感，并让岸边礁石半浸在
 * 海水里与水面自然融合。不新增任何高面数模型、不改碰撞代理。
 * 用位置哈希而不是全局 rnd()，保证每次重建抖成同一副样子（不闪、可复现）。
 */
function jitterRocks(list, sink = 0.14) {
  for (const p of list) {
    const h = Math.sin(p.x * 12.9898 + p.z * 78.233) * 43758.5453;
    const f = h - Math.floor(h);
    const h2 = Math.sin(p.x * 39.346 + p.z * 11.135) * 24634.6345;
    const g = h2 - Math.floor(h2);
    const sc = typeof p.scale === 'number' ? p.scale : 1;
    p.pitch = (f - 0.5) * 0.30;
    p.roll = (g - 0.5) * 0.30;
    p.y -= sink * sc;                       // 埋进沙地 / 海床，底部不悬空
    const k = 0.82 + f * 0.26;             // 灰岩明暗微差
    p.tint = new THREE.Color(k, k * 0.98, k * 0.94);
  }
  return list;
}

function buildSurf(line) {
  const group = new THREE.Group();
  group.name = 'surf';
  /* 只留两道。
   *
   * 原来 2.4 / 7.0 / 12.0 三层、不透明度 0.88 / 0.42 / 0.20 时，低视角下
   * 三条平行白带连成一片横在水上的「白色反光条纹」。压到 0.26 / 0.10
   * 之后贴水线的第一道干净了，但第三道（12 m）在 2~3 m 眼高、正对海面
   * 看时会变成一条贯通整个画面、笔直的白细线 —— 因为 3 m 宽、0.10 的
   * 带子被掠射角压成一根线，它不是「碎浪」，而是一条明显的人工直线。
   * 那道浪对近岸观感几乎没贡献，直接去掉；保留 2.4 m 主浪 + 7.0 m 副浪，
   * 副浪紧挨着主浪，看上去就是一道有厚度的浪，而不是几条平行的线。 */
  const LAYERS = [
    { off: 2.4, w: 5.0, op: 0.88, ph: 0.0 },
    { off: 7.0, w: 3.6, op: 0.24, ph: 1.7 },
  ];
  for (const L of LAYERS) {
    const verts = [], cols = [], idx = [], uv = [];
    let run = [];
    const flush = () => {
      if (run.length < 3) { run = []; return; }
      const base = verts.length / 3;
      let arc = 0, px = null, pz = null;
      run.forEach((p, k) => {
        const cx = p.x + p.nx * L.off, cz = p.z + p.nz * L.off;
        if (px !== null) arc += Math.hypot(p.x - px, p.z - pz);
        px = p.x; pz = p.z;
        /* 沿浪线的碎浪强度：两个不同频率的正弦叠一下，不重复也不乱 */
        const wob = 0.5 + 0.5 * Math.sin(k * 0.62 + L.ph) * Math.cos(k * 0.21 + L.ph * 2.1);
        const u = arc * 0.08;                       // 每 ~12.5m 平铺一次碎浪贴图
        for (let s = 0; s < 3; s++) {
          const t = s - 1;                       // -1 内侧 / 0 中线 / 1 外侧
          verts.push(
            cx + p.nx * L.w * 0.5 * t, SEA_Y + 0.30, cz + p.nz * L.w * 0.5 * t,
          );
          // 中线实、两边透明：横截面自带柔边，不会露出带子的直边
          const a = (s === 1 ? 1 : 0) * L.op * (0.35 + 0.65 * wob);
          cols.push(1, 1, 1, a);
          uv.push(u, (s + 1) / 2);
        }
      });
      for (let k = 0; k < run.length - 1; k++) {
        const a = base + k * 3;
        idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
        idx.push(a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
      }
      run = [];
    };
    for (const p of line) { if (p) run.push(p); else flush(); }
    flush();
    if (!idx.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 4));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, vertexColors: true, transparent: true, opacity: 1,
      depthWrite: false, side: THREE.DoubleSide,
      map: foamTexture(),
    });
    // 顶点轻微起伏 + 横向呼吸：让浪花「活着」，但幅度极小（不上岸、不穿水、不闪）。
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = FOAM_UNIFORMS.uTime;
      shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float ph = position.x * 0.18 + position.z * 0.15;
         transformed.y += 0.07 + 0.07 * sin(uTime * 0.9 + ph) + 0.03 * sin(uTime * 1.7 + ph * 1.7);
         transformed.x += 0.04 * sin(uTime * 0.7 + position.z * 0.25);`,
      );
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 3;
    mesh.userData.foamPhase = L.ph;
    mesh.userData.baseOpacity = 1;
    group.add(mesh);
  }
  return group;
}

/**
 * 湿沙：水线附近一条高光带。
 *
 * 地形是靠顶点色把这里压深的，但「湿」的观感主要来自反光 —— 顶点色
 * 做不出粗糙度的差异，所以单独铺一层低粗糙度的薄面，抬高 2 cm 并开
 * polygonOffset，避免和地形打架。
 */
function buildWetBand(line, hf) {
  const verts = [], idx = [], uv = [];
  const COLS = [-6, -1.5, 3, 8];
  let run = [];
  const flush = () => {
    if (run.length < 3) { run = []; return; }
    const base = verts.length / 3;
    for (const p of run) {
      for (const o of COLS) {
        const x = p.x + p.nx * o, z = p.z + p.nz * o;
        const y = Math.max(hf.heightAt(x, z), SEA_Y - 1.2) + 0.02;
        verts.push(x, y, z);
        uv.push((o + 6) / 14, p.x * 0.05 + p.z * 0.05);
      }
    }
    for (let k = 0; k < run.length - 1; k++) {
      for (let c = 0; c < COLS.length - 1; c++) {
        const a = base + k * COLS.length + c;
        const b = a + 1;
        const cc = base + (k + 1) * COLS.length + c;
        const d = cc + 1;
        idx.push(a, cc, b, b, cc, d);
      }
    }
    run = [];
  };
  for (const p of line) { if (p) run.push(p); else flush(); }
  flush();
  if (!idx.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const wet = wetSandTextures(256);
  wet.map.repeat.set(0.35, 0.35);
  const mat = new THREE.MeshStandardMaterial({
    map: wet.map, normalMap: wet.normalMap,
    normalScale: new THREE.Vector2(0.5, 0.5),
    color: 0xb9a184, roughness: 0.34, metalness: 0.0,
    envMapIntensity: 1.15,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'wetSand';
  mesh.receiveShadow = true;
  return mesh;
}

/* ------------------------------------------------------------------ *
 * 7. 世界
 * ------------------------------------------------------------------ */
export class BeachWorld {
  constructor(track, scene, lib = null) {
    this.track = track;
    this.lib = lib;
    this.hf = makeHeightField(track);
    this.heightAt = this.hf.heightAt;
    this.bounds = BeachWorld.boundsOf(track);

    this.group = new THREE.Group();
    this.group.name = 'beachWorld';
    /* 会把车挡住的东西单独一层，交给 bakeClearance 烘焙。 */
    this.obstacles = new THREE.Group();
    this.obstacles.name = 'beachObstacles';

    this.stats = { drawCalls: 0, instances: 0, tris: 0, missing: [] };
    this._boxes = [];

    const shore = buildShoreMap(this.hf, this.bounds, 128);
    this.sea = buildSea(shore, this.bounds);
    this.group.add(this.sea);
    this.group.add(buildTerrain(track, this.hf, this.bounds));

    this.river = buildRiver();
    this.group.add(this.river);

    const line = waterline(track, this.hf);
    this.foam = buildSurf(line);
    this.group.add(this.foam);
    const wet = buildWetBand(line, this.hf);
    if (wet) this.group.add(wet);

    this._buildBridge();
    this._buildProps();
    this._flushObstacles();

    this.group.add(this.obstacles);
    scene.add(this.group);
  }

  static boundsOf(track) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < track.n; i++) {
      const x = track.pos[i * 3], z = track.pos[i * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const PAD = 320;
    return { minX: minX - PAD, maxX: maxX + PAD, minZ: minZ - PAD, maxZ: maxZ + PAD };
  }

  update(dt) {
    this.sea.material.uniforms.uTime.value += dt;
    if (this.river?.userData.flow) this.river.userData.flow.uniforms.uTime.value += dt;
    const t = this.sea.material.uniforms.uTime.value;
    // 碎浪：统一时间推进顶点动画；UV 缓慢滚动 = 浪花沿水线连续流动（不闪烁、不穿路）。
    FOAM_UNIFORMS.uTime.value = t;
    const ftex = foamTexture();
    if (ftex) ftex.offset.x = (t * 0.03) % 1;
    for (const m of this.foam.children) {
      // 极轻的整体明暗起伏（10%），替代原来 28% 的硬闪
      m.material.opacity = m.userData.baseOpacity * (0.9 + 0.1 * Math.sin(t * 0.6 + m.userData.foamPhase * 0.5));
    }
  }

  /* ------------------------------- 工具 ------------------------------- */

  /** 赛道弧长（米）→ 采样下标 */
  idxAt(d) {
    const T = this.track;
    const L = T.length;
    const dd = ((d % L) + L) % L;
    return Math.round(dd / (L / T.n)) % T.n;
  }

  /** 采样点 + 横向偏移 → 世界坐标（落在地形上） */
  _pos(i, lat, out = new THREE.Vector3()) {
    const T = this.track;
    const P = T.getPos(i, _v1);
    const R = T.getRight(i, _v2);
    const x = P.x + R.x * lat;
    const z = P.z + R.z * lat;
    out.set(x, this.hf.heightAt(x, z), z);
    return out;
  }

  /**
   * 从采样点 i 沿 sgn 方向往外走，找到地形跌破水面的横向距离。
   *
   * 为什么要这段：之前「半浸入海水的礁石」是按固定横向距离摆的
   * （ww+34 ~ ww+56），但沙滩从路缘到水线是 74 m，那个位置的地形还在
   * +1 m 以上 —— 石头被整个埋在干沙里，一张截图都看不到。水线的位置
   * 必须实测出来，不能猜。
   *
   * @returns {number|null} 横向距离（米，含符号）；找不到返回 null
   */
  _waterLat(i, sgn) {
    const T = this.track;
    let prevY = null;
    let prevLat = 0;
    for (let lat = T.width[i] + 2; lat < 150; lat += 2) {
      const y = this._pos(i, sgn * lat).y;
      if (y < SEA_Y + 0.10) {
        if (prevY === null) return lat;
        /* prevY..y 跨过水面 → 线性插值出 y = SEA_Y 的那一点 */
        const t = (prevY - SEA_Y) / (prevY - y || 1);
        return prevLat + (lat - prevLat) * THREE.MathUtils.clamp(t, 0, 1);
      }
      prevY = y; prevLat = lat;
    }
    return null;
  }

  /**
   * 任意弧长处的连续坐标系（位置 / 右 / 上 / 切线 / 半宽）。
   *
   * 为什么不能直接用 getPos(idxAt(d))：采样点间距是 0.587 m，桥板节距是
   * 0.30 m —— 取整之后相邻两块板会落到同一个采样点上完全重叠，再下一块
   * 又跳 0.587 m，铺出来是一段一段的栅栏，中间露出 25 cm 的黑缝。
   * 这里在相邻采样点之间线性插值，节距想多细就多细。
   */
  _frame(d, out) {
    const T = this.track;
    const n = T.n;
    const L = T.length;
    const sp = L / n;
    const dd = ((d % L) + L) % L;
    const f = dd / sp;
    const a = Math.floor(f) % n;
    const b = (a + 1) % n;
    const u = f - Math.floor(f);
    const mix = (arr, dst) => dst.set(
      arr[a * 3] + (arr[b * 3] - arr[a * 3]) * u,
      arr[a * 3 + 1] + (arr[b * 3 + 1] - arr[a * 3 + 1]) * u,
      arr[a * 3 + 2] + (arr[b * 3 + 2] - arr[a * 3 + 2]) * u,
    );
    mix(T.pos, out.pos);
    mix(T.right, out.right).normalize();
    mix(T.up, out.up).normalize();
    mix(T.tan, out.tan).normalize();
    out.width = T.width[a] + (T.width[b] - T.width[a]) * u;
    return out;
  }

  /** 点到路缘的最小间距（负数 = 已经压到路面上） */
  roadGap(x, z) {
    const T = this.track;
    let best = Infinity;
    for (let i = 0; i < T.n; i += 2) {
      const d = Math.hypot(x - T.pos[i * 3], z - T.pos[i * 3 + 2]) - T.width[i];
      if (d < best) best = d;
    }
    return best;
  }

  _inst(name, list, opts = {}) {
    if (!this.lib) {
      if (!this.stats.missing.includes(name)) this.stats.missing.push(name);
      return null;
    }
    if (!list.length) return null;
    const g = this.lib.instance(name, list, opts);
    if (!g) {
      if (!this.stats.missing.includes(name)) this.stats.missing.push(name);
      return null;
    }
    this.group.add(g);
    this.stats.instances += list.length;
    this.stats.drawCalls += g.children.length;
    const proto = this.lib.proto(name);
    this.stats.tris += (proto?.tris || 0) * list.length;
    return g;
  }

  /** 碰撞代理：一个站立的长方体，烘焙只看竖直面 */
  _blocker(x, z, sx, sz, yaw, height = 3.2, groundY = null) {
    const y = groundY ?? this.hf.heightAt(x, z);
    const g = new THREE.BoxGeometry(sx, height, sz);
    g.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(x, y + height / 2 - 0.25, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
      new THREE.Vector3(1, 1, 1)));
    this._boxes.push(g);
  }

  _flushObstacles() {
    if (!this._boxes.length) return;
    const merged = mergeGeometries(this._boxes.map((g) => g.toNonIndexed()), false);
    for (const g of this._boxes) g.dispose();
    this._boxes.length = 0;
    if (!merged) return;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ visible: false }));
    mesh.name = 'beachBlockers';
    this.obstacles.add(mesh);
  }

  /* ------------------------------ 木桥 ------------------------------ */
  /**
   * 48 m 潮汐木桥。
   *
   * 桥面不能用一整块直板：桥在缓弯上，而且带 13% 的横坡（这是赛道本身
   * 的属性，不能改）。所以用 0.34 m 长的桥板模块沿弧长一块一块摆，
   * 每块都用 track 的 right/up/tangent 做基向量，天然贴合弯道与横坡。
   *
   * 栏杆是老实的「立柱 + 上下横梁 + 斜撑」，可透视；碰撞仍然是 Track
   * 里那条扫掠出来的实心墙（现在改成不可见），两者位置对齐。
   */
  _buildBridge() {
    const T = this.track;
    const range = T.bridgeRange || T.sections?.find((s) => s.id === 'bridge');
    if (!range) return;
    const d0 = range.d0 ?? 0;
    const len = range.len ?? 48;

    const fr = {
      pos: new THREE.Vector3(), right: new THREE.Vector3(),
      up: new THREE.Vector3(), tan: new THREE.Vector3(), width: 0,
    };
    const basis = new THREE.Matrix4();
    const spot = new THREE.Vector3();

    /** 弧长 d、横向 lat、额外高度 dy → 该处的 (右, 上, 切) 基向量矩阵 */
    const basisAt = (d, lat, dy = 0) => {
      this._frame(d, fr);
      spot.copy(fr.pos).addScaledVector(fr.right, lat);
      spot.y += dy;
      basis.makeBasis(fr.right, fr.up, fr.tan);
      basis.setPosition(spot);
      return basis.clone();
    };

    /* ---- 桥面：0.34 m 板 + 0.30 m 节距，横向切 7 段 ----
     *
     * 关键：桥压在 R33 弯道上，**每一列的实际行距都不一样**。
     *   弯道内缘 0.229 m / 外缘 0.360 m（按中心线 0.30 m 排）。
     * 如果所有板都按固定的 0.34 m 长去摆，内缘相邻两行会重叠 0.11 m，
     * 两个共面的顶面互相抢深度（z-fighting），铺出来是一条一条明暗相间的
     * 黑缝；外缘又拉开 0.02 m 的透光缝。之前看到的就是这个。
     *
     * 所以分两遍：
     *   第一遍只求每列每行的板心世界坐标；
     *   第二遍按「本列到下一行的实际距离」逐块缩 Z 轴，让板与板在
     *   弯道上依然严丝合缝，同时留 5 mm 板缝让深色托板透出来。
     */
    const COLS = 7;
    const PITCH = 0.30;
    /* 两端各外挑 PAD：弯道外缘那一列的弧长比中心线长，只按 len 排行数
     * 会在端头短出 1 m 露白。多铺 0.8 m 落在沙质桥台上，正好当桥头搭板。 */
    const PAD = 0.8;
    const rows = Math.max(1, Math.ceil((len + PAD * 2) / PITCH));
    const planks = [];
    const tint = new THREE.Color();
    const m4 = new THREE.Matrix4();
    const PLANKS_L = 0.34;

    /* 1) 板心 + 基向量 */
    const cells = [];            // cells[r][c] = { x, y, z, right, up, tan, colW }
    for (let r = 0; r < rows; r++) {
      const d = d0 - PAD + (r + 0.5) * PITCH;
      this._frame(d, fr);
      const w = fr.width;
      const colW = (w * 2) / COLS;
      const row = [];
      for (let c = 0; c < COLS; c++) {
        const lat = -w + (c + 0.5) * colW;
        // 与路面完全一致的横坡 + 拱度，桥板才不会陷进去或浮起来
        const t = (lat / w + 1) * 0.5;
        const crown = Math.cos(t * Math.PI - Math.PI / 2) * 0.11;
        row.push({
          x: fr.pos.x + fr.right.x * lat,
          y: fr.pos.y + fr.right.y * lat + fr.up.y * crown - 0.0375,
          z: fr.pos.z + fr.right.z * lat,
          right: fr.right.clone(),
          up: fr.up.clone(),
          tan: fr.tan.clone(),
          colW,
        });
      }
      cells.push(row);
    }

    /* 2) 逐块定长度 */
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = cells[r][c];
        const q = cells[Math.min(r + 1, rows - 1)][c];
        const s = r < rows - 1 ? q : p;
        const back = r < rows - 1 ? p : cells[Math.max(r - 1, 0)][c];
        const step = Math.hypot(s.x - back.x, s.y - back.y, s.z - back.z) || PITCH;
        // 0.995：留 5 mm 板缝，托板的深色从缝里透出来
        const scaleZ = (step * 0.995) / PLANKS_L;
        m4.makeBasis(
          _v1.copy(p.right).multiplyScalar(p.colW * 0.99),
          _v2.copy(p.up),
          _v3.copy(p.tan).multiplyScalar(scaleZ));
        m4.setPosition(p.x, p.y, p.z);
        // 每块板自己的色差：同一座桥不会有两块一模一样的木头。
        // 幅度必须小 —— 0.86~1.15 时相邻行亮度差 30%，铺出来是一条条
        // 明暗横纹，看着像栅栏而不是桥面。
        const k = 0.94 + ((r * 7 + c * 13) % 13) * 0.011;
        tint.setRGB(k, k * 0.985, k * 0.945);
        planks.push({ matrix: m4.clone(), tint: tint.clone() });
      }
    }
    this._inst('bridge_plank', planks, { castShadow: false });

    /* ---- 栏杆：立柱 2.4 m 一根，上下横梁，隔一跨一根斜撑 ---- */
    const BAY = 2.4;
    const bays = Math.max(1, Math.round(len / BAY));
    const posts = [], rails = [], braces = [], kerbs = [], piers = [];

    for (let b = 0; b <= bays; b++) {
      const d = d0 + b * BAY;
      this._frame(d, fr);
      for (const side of [-1, 1]) {
        posts.push({ matrix: basisAt(d, side * (fr.width - 0.06), 0) });
        kerbs.push({ matrix: basisAt(d, side * (fr.width - 0.02), 0.06) });
      }
    }
    for (let b = 0; b < bays; b++) {
      const dA = d0 + b * BAY;
      const dB = d0 + (b + 1) * BAY;
      this._frame(dA + BAY * 0.5, fr);
      const midRight = fr.right.clone(), midUp = fr.up.clone();
      for (const side of [-1, 1]) {
        const a = this._railPoint(dA, side);
        const c = this._railPoint(dB, side);
        const mid = a.clone().add(c).multiplyScalar(0.5);
        const dir = c.clone().sub(a);
        const L = dir.length();
        dir.normalize();
        for (const hgt of [0.95, 0.56]) {
          const bs = new THREE.Matrix4().makeBasis(midRight, midUp, dir);
          bs.setPosition(mid.x, mid.y + hgt, mid.z);
          const m = bs.clone();
          m.scale(new THREE.Vector3(1, 1, L / 2.4));
          rails.push({ matrix: m });
        }
        if (b % 2 === 0) {
          const bs = new THREE.Matrix4().makeBasis(midRight, midUp, dir);
          bs.multiply(new THREE.Matrix4().makeRotationX((b % 4 === 0 ? 1 : -1) * 0.62));
          bs.setPosition(mid.x, mid.y + 0.75, mid.z);
          const m = bs.clone();
          m.scale(new THREE.Vector3(1, 1, L / 2.4));
          braces.push({ matrix: m });
        }
      }
    }
    for (let d = d0 + 4; d < d0 + len - 2; d += 6.2) {
      this._frame(d, fr);
      for (const side of [-1, 1]) {
        piers.push({ matrix: basisAt(d, side * (fr.width - 2.1), -0.10) });
      }
    }

    this._inst('bridge_post', posts, { castShadow: true });
    this._inst('bridge_rail', rails, { castShadow: true });
    this._inst('bridge_brace', braces, { castShadow: false });
    this._inst('bridge_kerb', kerbs, { castShadow: false });
    this._inst('bridge_pier', piers, { castShadow: true });
    this.bridgeInfo = { rows, planks: planks.length, posts: posts.length, bays };
  }

  /** 桥栏杆上某点的世界坐标（弧长 d、左/右） */
  _railPoint(d, side) {
    const fr = {
      pos: new THREE.Vector3(), right: new THREE.Vector3(),
      up: new THREE.Vector3(), tan: new THREE.Vector3(), width: 0,
    };
    this._frame(d, fr);
    return fr.pos.clone().addScaledVector(fr.right, side * (fr.width - 0.06));
  }

  /* ------------------------------ 道具 ------------------------------ */
  _buildProps() {
    const T = this.track;
    const lib = this.lib;
    if (!lib) { console.warn('[beach] 没有资产库，跳过全部道具'); return; }

    let seed = 20261106;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const sec = (id) => T.sections?.find((s) => s.id === id);

    /* palms = 完整模型（982 面），nearPalms/farPalms 是给棕榈林分层的
     * 两个池子：近层用完整模型，外层用 palm_lod（114 面）。 */
    const palms = [], nearPalms = [], farPalms = [];
    const rocksL = [], rocksD = [], rocksS = [], grass = [];
    const houses = { house_blue: [], house_thatch: [], house_fishing: [] };
    const umbrellas = [], loungers = [], crates = [], barrels = [], boards = [], signs = [];
    const poles = [], stands = [], buoys = [], gates = [];

    const P = new THREE.Vector3();
    const R = new THREE.Vector3();

    /* 模型正面是 -Z。要让正面指向方向 d，yaw = atan2(-dx, -dz)。
     * 这是所有「门朝路」「牌子朝路」的唯一公式，别在调用处各写一套。 */
    const yawTo = (dx, dz) => Math.atan2(-dx, -dz);

    /** 落点：路缘外 minGap 米以上，且默认不落在水里 */
    const spot = (i, lat, minGap = 5.5, dry = true) => {
      const p = this._pos(i, lat, P.clone());
      if (dry && p.y < SEA_Y + 0.8) return null;
      if (minGap > 0 && this.roadGap(p.x, p.z) < minGap) return null;
      return p;
    };

    /* ========== 1. 沙滩节广场：起点门 + 看台 + 旗杆 + 摊子 ========== */
    {
      const start = sec('plaza') || T.sections[0];
      const d0 = start?.d0 ?? 0;
      /* 起点门：模型跨度是 ±9.2 m。门柱必须站在最大跑宽（路缘 +3 m）之外，
       * 否则车贴着路肩开过去会一头撞进柱子里 —— 而且不给它碰撞代理，
       * 柱子进了碰撞网格会把整条路收窄十几米。只沿 X 拉伸，不放大高度。 */
      T.getPos(0, P); T.getRight(0, R);
      const w0 = T.width[0];
      const kx = (w0 + 3.2) / 9.2;
      gates.push({
        x: P.x, y: P.y, z: P.z,
        yaw: Math.atan2(-R.z, R.x),
        scale: new THREE.Vector3(kx, 1, 1),
      });

      /* 看台：三座在起点线之前（发车格后面的观众席），两座在门之后。
       * 全放在门前面的话，从发车方向看过去只剩一个空门框 ——
       * 「沙滩节广场」的开场画面里必须有看台。 */
      for (const [d, side, w] of [
        [d0 - 46, -1, 1.0], [d0 - 96, -1, 0.9], [d0 - 30, 1, 0.8],
        [d0 + 26, -1, 1.0], [d0 + 50, 1, 0.92],
      ]) {
        const i = this.idxAt(d);
        T.getRight(i, R);
        const p = spot(i, side * (T.width[i] + 13), 9, false);
        if (!p) continue;
        // 看台正面（-Z）朝向赛道：观众看着车
        stands.push({
          x: p.x, y: p.y, z: p.z,
          yaw: yawTo(-R.x * side, -R.z * side),
          scale: w,
        });
      }
      for (let k = 0; k < 10; k++) {
        const i = this.idxAt(d0 - 110 + k * 12);
        const side = k % 2 ? 1 : -1;
        const p = spot(i, side * (T.width[i] + 3.6), 3.4);
        if (!p) continue;
        poles.push({ x: p.x, y: p.y, z: p.z, scale: 0.9 + rnd() * 0.25 });
      }
      for (let k = 0; k < 5; k++) {
        const i = this.idxAt(d0 - 80 + k * 22);
        const p = spot(i, (k % 2 ? 1 : -1) * (T.width[i] + 9), 8);
        if (p) umbrellas.push({ x: p.x, y: p.y, z: p.z, yaw: rnd() * 6.28 });
      }
      for (let k = 0; k < 6; k++) {
        const i = this.idxAt(d0 - 70 + k * 9);
        const p = spot(i, -(T.width[i] + 7.5), 7);
        if (p) crates.push({ x: p.x, y: p.y, z: p.z, yaw: rnd() * 6.28, scale: 0.9 + rnd() * 0.3 });
      }
    }

    /* ========== 2. 金色沙滩直道：棕榈 + 彩色遮阳伞 + 躺椅 + 远景小屋 + 沙丘草 ========== */
    {
      const s = sec('sand');
      if (s) {
        // 遮阳伞配色：暖色系，和金色沙滩协调；每把随机挑，避免一排同色。
        const UMB_TINTS = [0xff5a5a, 0x5aa0ff, 0xffd24a, 0x36d6c0, 0xff9a3c, 0xff7ad0];
        const umbTint = () => new THREE.Color(UMB_TINTS[(rnd() * UMB_TINTS.length) | 0]);
        for (let d = s.d0 + 6; d < s.d1 - 4; d += 11) {
          const i = this.idxAt(d);
          const ww = T.width[i];
          if (rnd() < 0.85) {
            const p = spot(i, -(ww + 7 + rnd() * 16), 6.5);
            if (p) palms.push({ x: p.x, y: p.y, z: p.z, yaw: rnd() * 6.28, scale: 0.82 + rnd() * 0.45 });
          }
          if (rnd() < 0.35) {
            const p = spot(i, ww + 8 + rnd() * 12, 6.5);
            if (p) palms.push({ x: p.x, y: p.y, z: p.z, yaw: rnd() * 6.28, scale: 0.78 + rnd() * 0.35 });
          }
        }
        // 两侧遮阳伞 + 躺椅：错落摆放，不整齐、不挡视线（都离路缘 10m 以上）
        for (let d = s.d0 + 14; d < s.d1 - 10; d += 14) {
          const i = this.idxAt(d);
          const ww = T.width[i];
          T.getRight(i, R);
          for (const side of [-1, 1]) {
            if (rnd() < 0.55) {
              const p = spot(i, side * (ww + 12 + rnd() * 13), 9);
              if (p) {
                umbrellas.push({ x: p.x, y: p.y, z: p.z, yaw: rnd() * 6.28, scale: 0.9 + rnd() * 0.28, tint: umbTint() });
                const p2 = this._pos(i, side * (ww + 16 + rnd() * 9)).clone();
                if (p2.y > SEA_Y + 1) {
                  loungers.push({ x: p2.x, y: p2.y, z: p2.z, yaw: yawTo(R.x * side, R.z * side) + (rnd() - 0.5) * 0.6 });
                }
              }
            }
          }
        }
        // 远景小屋：只在远侧（远离赛道一侧），门朝赛道；不挡驾驶视线。
        for (let d = s.d0 + 20; d < s.d1 - 8; d += 34) {
          const i = this.idxAt(d);
          const ww = T.width[i];
          const side = rnd() < 0.5 ? -1 : 1;
          T.getRight(i, R);
          const p = spot(i, side * (ww + 26 + rnd() * 16), 16);
          if (!p) continue;
          const kind = ['house_blue', 'house_thatch', 'house_fishing'][(rnd() * 3) | 0];
          houses[kind].push({ x: p.x, y: p.y, z: p.z, yaw: yawTo(-R.x * side, -R.z * side), scale: 0.95 + rnd() * 0.35 });
        }
        // 一簇簇沙丘草，混在棕榈之间，增加金色沙滩的层次
        for (let d = s.d0 + 10; d < s.d1 - 6; d += 9) {
          const i = this.idxAt(d);
          const ww = T.width[i];
          const side = rnd() < 0.5 ? -1 : 1;
          const p = spot(i, side * (ww + 9 + rnd() * 18), 6.5);
          if (p) grass.push({ x: p.x, y: p.y, z: p.z, yaw: rnd() * 6.28, scale: 0.7 + rnd() * 0.9 });
        }
        for (let d = s.d0 + 30; d < s.d1; d += 22) {
          const i = this.idxAt(d);
          const wl = this._waterLat(i, 1);
          if (wl === null) continue;
          /* 潮池礁石必须踩在水线上：放在水线内侧 4 m 到外侧 5 m 之间，
           * 一部分露出水面、一部分泡在水里，才有「半浸」的样子。 */
          for (let k = 0; k < 2; k++) {
            const lat = wl - 4 + rnd() * 9;
            const p = this._pos(i, lat).clone();
            rocksS.push({
              x: p.x, y: SEA_Y + 0.10, z: p.z,
              yaw: rnd() * 6.28, scale: 0.8 + rnd() * 1.2,
            });
          }
        }
      }
    }

    /* ========== 3. 礁石岬角：三款礁石 + 浪 ========== */
    {
      const s = sec('point');
      if (s) {
        /* 这一段 sea 的值前后不一致（内侧一半是 0），逐点取 Math.sign 会
         * 让「海侧」在半路上翻面：前半段的礁石被摆到内陆的沙丘坡上，
         * 看起来像一排石头长在山上。整段统一用出现更多的那个方向。 */
        let seaSum = 0;
        for (let i = s.i0; i !== s.i1; i = (i + 1) % T.n) seaSum += T.sea[i];
        const seaSgn = Math.sign(seaSum) || 1;
        /* 岬角的辨识度全靠「礁石离路近」：沿整段每 3.5 m 往海侧撒一轮，
         * 先是贴着路缘的 5~14 m 大石，再是 14~45 m 的碎石带。 */
        for (let d = s.d0; d < s.d1; d += 3.2) {
          const i = this.idxAt(d);
          const ww = T.width[i];
          const sgn = seaSgn;
          /* 尺寸必须拉得开：原来统一 1.0~3.2 倍，一排石头一样高，
           * 从驾驶位看过去是一条「石头墙」，把海完全挡在后面。
           * 现在 0.7~3.3 倍，并且有一半是 0.8 倍以下的小石，
           * 石与石之间留出缝，海面从缝里透出来。 */
          if (rnd() < 0.78) {
            /* 往外挪到路肩平沙带之后（SAND_FLAT = 8 m）：贴着路缘摆的
             * 时候石头正好长在沙脊顶上，从驾驶位看是一排挡住地平线的
             * 石头墙，海一点都看不见。挪到坡面上之后石头比沙脊低，
             * 海就从石头缝上方露出来。 */
            const p = spot(i, sgn * (ww + 9.5 + rnd() * 10), 5.5, false);
            if (p) {
              const sc = rnd() < 0.45 ? 0.70 + rnd() * 0.55 : 1.05 + rnd() * 1.7;
              const item = { x: p.x, y: p.y, z: p.z, yaw: rnd() * 6.28, scale: sc };
              (rnd() < 0.45 ? rocksL : rocksD).push(item);
              /* 只有大到会挡住车的石头才做碰撞代理，而且必须先确认
               * 「代理边缘离路缘还有 3 m 以上」—— 否则清障会把可行驶
               * 宽度从 w+3 压下来，等于偷偷改了第一阶段的驾驶手感。 */
              const gap = this.roadGap(p.x, p.z);
              if (sc > 1.4 && gap - sc * 0.85 >= 3.1) {
                this._blocker(p.x, p.z, sc * 1.6, sc * 1.6, item.yaw, 2.2, p.y);
              }
            }
          }
          if (rnd() < 0.5) {
            const p = spot(i, sgn * (ww + 14 + rnd() * 31), 5.5, false);
            if (p) {
              const sc = 0.55 + rnd() * 1.5;
              (rnd() < 0.5 ? rocksL : rocksD).push({
                x: p.x, y: p.y, z: p.z, yaw: rnd() * 6.28, scale: sc,
              });
            }
          }
          /* 浪线上的潮池礁：必须实测水线，不能按固定距离摆 */
          if (rnd() < 0.45) {
            const wl = this._waterLat(i, sgn);
            if (wl !== null) {
              const lat = wl - 3 + rnd() * 7;
              const p = this._pos(i, sgn * lat).clone();
              rocksS.push({
                x: p.x, y: SEA_Y + 0.08, z: p.z,
                yaw: rnd() * 6.28, scale: 0.9 + rnd() * 1.5,
              });
            }
          }
          /* 离岸礁：真正泡在海水里、只露出上半截的大石（第三种礁石）。
           * 底比海面低 0.5~1.2 m，斜着看是一块被浪打湿的石头，
           * 不是一颗浮在水上的模型。近岸机位和桥上都看得到。 */
          if (rnd() < 0.20) {
            const wl = this._waterLat(i, sgn);
            if (wl !== null) {
              const lat = wl + 9 + rnd() * 24;
              const p = this._pos(i, sgn * lat).clone();
              const sc = 1.7 + rnd() * 2.4;
              rocksL.push({
                x: p.x, y: SEA_Y - 0.35 * sc, z: p.z,
                yaw: rnd() * 6.28, scale: sc,
              });
            }
          }
        }
      }
    }

    /* ========== 4. 沙丘爬坡：草簇 + 稀疏棕榈 ========== */
    {
      const s = sec('dune');
      if (s) {
        for (let k = 0; k < 260; k++) {
          const i = this.idxAt(s.d0 + rnd() * (s.d1 - s.d0));
          const p = spot(i, (rnd() < 0.5 ? -1 : 1) * (T.width[i] + 6 + rnd() * 26), 5.5);
          if (p) grass.push({ x: p.x, y: p.y, z: p.z, yaw: rnd() * 6.28, scale: 0.6 + rnd() * 0.9 });
        }
        for (let d = s.d0 + 8; d < s.d1; d += 24) {
          const i = this.idxAt(d);
          const p = spot(i, -(T.width[i] + 12 + rnd() * 10), 8);
          if (p) palms.push({ x: p.x, y: p.y, z: p.z, yaw: rnd() * 6.28, scale: 0.7 + rnd() * 0.3 });
        }
      }
    }

    /* ========== 5. 棕榈林：两侧成林，近中远三层 ========== */
    {
      const s = sec('palm');
      if (s) {
        /* 三层密度不同，模型也不同：
         *   近层（路缘外 5.5~10 m）用完整模型，树冠会探到路面上方，
         *     玩家从驾驶位能看见叶片从头顶掠过 —— 「进林子了」的体感；
         *   中层（10~21 m）一半完整、一半简化；
         *   外层（21~50 m）全部 palm_lod（114 面），只负责填满背景。
         * 全用完整模型的话，这一段光棕榈就是十几万面。 */
        for (let d = s.d0 + 3; d < s.d1; d += 3.2) {
          const i = this.idxAt(d);
          const ww = T.width[i];
          for (const side of [-1, 1]) {
            if (rnd() < 0.62) {
              const p = spot(i, side * (ww + 5.5 + rnd() * 4.5), 5.5);
              if (p) {
                nearPalms.push({
                  x: p.x, y: p.y, z: p.z, yaw: rnd() * 6.28,
                  scale: 0.95 + rnd() * 0.35,
                });
              }
            }
            if (rnd() < 0.58) {
              const p = spot(i, side * (ww + 10.5 + rnd() * 10.5), 5.5);
              if (p) {
                const it = { x: p.x, y: p.y, z: p.z, yaw: rnd() * 6.28, scale: 0.82 + rnd() * 0.4 };
                (rnd() < 0.5 ? nearPalms : farPalms).push(it);
              }
            }
            if (rnd() < 0.55) {
              const p = spot(i, side * (ww + 21 + rnd() * 29), 5.5);
              if (p) {
                farPalms.push({ x: p.x, y: p.y, z: p.z, yaw: rnd() * 6.28, scale: 0.72 + rnd() * 0.45 });
              }
            }
          }
        }
        for (let k = 0; k < 200; k++) {
          const i = this.idxAt(s.d0 + rnd() * (s.d1 - s.d0));
          const p = spot(i, (rnd() < 0.5 ? -1 : 1) * (T.width[i] + 6 + rnd() * 20), 5.5);
          if (p) grass.push({ x: p.x, y: p.y, z: p.z, yaw: rnd() * 6.28, scale: 0.7 + rnd() * 0.8 });
        }
      }
    }

    /* ========== 6. 渔村 S 弯：三款小屋交错 ========== */
    {
      const s = sec('village');
      if (s) {
        const kinds = ['house_blue', 'house_thatch', 'house_fishing'];
        let n = 0;
        /* 间距 12.5 m、离路缘 6.4~9 m、比例 1.05~1.35。
         * 原来 15.5 m / 8.5~12 m / 0.92~1.14 —— 在 16~24 m 宽的路面上，
         * 房子缩在 20 m 开外，追尾镜头里只有指甲盖大，三款完全分不出来。 */
        for (let d = s.d0 + 8; d < s.d1 - 5; d += 12.5) {
          const i = this.idxAt(d);
          const ww = T.width[i];
          const side = (n % 2 === 0) ? -1 : 1;
          T.getRight(i, R);
          const p = spot(i, side * (ww + 6.4 + rnd() * 2.6), 5.5);
          n++;
          if (!p) continue;
          const kind = kinds[n % 3];
          // 门朝赛道
          const yaw = yawTo(-R.x * side, -R.z * side);
          const sc = 1.05 + rnd() * 0.30;
          houses[kind].push({ x: p.x, y: p.y, z: p.z, yaw, scale: sc });
          const proto = lib.proto(kind);
          const sz = proto ? proto.box.getSize(_v1) : _v1.set(5, 4, 5);
          const bw = sz.x * sc * 0.82;
          const bd = sz.z * sc * 0.82;
          const gap = this.roadGap(p.x, p.z);
          if (gap - Math.max(bw, bd) * 0.5 >= 3.1) {
            this._blocker(p.x, p.z, bw, bd, yaw, 3.4, p.y);
          }
          if (rnd() < 0.7) {
            const c = this._pos(this.idxAt(d + 3), side * (ww + 6.5)).clone();
            if (c.y > SEA_Y + 1 && this.roadGap(c.x, c.z) > 5) {
              (rnd() < 0.5 ? crates : barrels).push({
                x: c.x, y: c.y, z: c.z, yaw: rnd() * 6.28, scale: 0.85 + rnd() * 0.3,
              });
            }
          }
          if (rnd() < 0.45) {
            const c = this._pos(this.idxAt(d + 7), side * (ww + 7.2)).clone();
            if (c.y > SEA_Y + 1 && this.roadGap(c.x, c.z) > 5.5) {
              boards.push({ x: c.x, y: c.y, z: c.z, yaw: rnd() * 6.28, pitch: 0.18, scale: 1 });
            }
          }
        }
        for (let k = 0; k < 120; k++) {
          const i = this.idxAt(s.d0 + rnd() * (s.d1 - s.d0));
          const p = spot(i, (rnd() < 0.5 ? -1 : 1) * (T.width[i] + 6 + rnd() * 14), 5.5);
          if (p) grass.push({ x: p.x, y: p.y, z: p.z, yaw: rnd() * 6.28, scale: 0.6 + rnd() * 0.7 });
        }
      }
    }

    /* ========== 7. 桥头回旋：提示牌 + 旗 + 散石 ========== */
    {
      const s = sec('bridgehead');
      if (s) {
        for (let d = s.d0 + 12; d < s.d1 - 4; d += 26) {
          const i = this.idxAt(d);
          T.getRight(i, R);
          const p = spot(i, -(T.width[i] + 6.2), 5.6);
          if (p) signs.push({ x: p.x, y: p.y, z: p.z, yaw: yawTo(R.x, R.z) });
        }
        for (let k = 0; k < 4; k++) {
          const i = this.idxAt(s.d0 + 8 + k * 14);
          const p = spot(i, -(T.width[i] + 5.0), 4.6);
          if (p) poles.push({ x: p.x, y: p.y, z: p.z, scale: 0.85 });
        }
        for (let k = 0; k < 30; k++) {
          const i = this.idxAt(s.d0 + rnd() * (s.d1 - s.d0));
          const sgn = Math.sign(T.sea[i]) || 1;
          const p = spot(i, sgn * (T.width[i] + 8 + rnd() * 26), 6, false);
          if (p) rocksL.push({ x: p.x, y: p.y, z: p.z, yaw: rnd() * 6.28, scale: 0.7 + rnd() * 1.5 });
        }
      }
    }

    /* ========== 8. 潮汐木桥：河道里的浮标 ========== */
    {
      const s = sec('bridge');
      if (s) {
        for (let k = 0; k < 8; k++) {
          const i = this.idxAt(s.d0 + 3 + rnd() * (s.d1 - s.d0 - 6));
          const sgn = (k % 2 ? 1 : -1);
          const p = this._pos(i, sgn * (T.width[i] + 6 + rnd() * 10)).clone();
          p.y = 0.52;   // 河面高度
          buoys.push({ x: p.x, y: p.y, z: p.z, yaw: rnd() * 6.28, scale: 1.0 });
        }
      }
    }

    /* ========== 9. 归途沙嘴：开阔海景 + 冲线区 ========== */
    {
      const s = sec('return');
      if (s) {
        for (let d = s.d0 + 6; d < s.d1; d += 13) {
          const i = this.idxAt(d);
          const p = spot(i, -(T.width[i] + 7 + rnd() * 14), 6.5);
          if (p) palms.push({ x: p.x, y: p.y, z: p.z, yaw: rnd() * 6.28, scale: 0.8 + rnd() * 0.4 });
        }
        for (let k = 0; k < 5; k++) {
          const i = this.idxAt(s.d0 + 10 + k * 12);
          T.getRight(i, R);
          const p = spot(i, T.width[i] + 11 + rnd() * 8, 9);
          if (p) {
            umbrellas.push({ x: p.x, y: p.y, z: p.z, yaw: rnd() * 6.28, scale: 0.9 });
            const p2 = this._pos(i, T.width[i] + 15 + rnd() * 6).clone();
            if (p2.y > SEA_Y + 1) loungers.push({ x: p2.x, y: p2.y, z: p2.z, yaw: rnd() * 6.28 });
          }
        }
        for (let k = 0; k < 4; k++) {
          const i = this.idxAt(s.d1 - 8 - k * 9);
          const p = spot(i, (k % 2 ? 1 : -1) * (T.width[i] + 3.6), 3.4);
          if (p) poles.push({ x: p.x, y: p.y, z: p.z, scale: 1.0 });
        }
      }
    }

    /* ---------- 落位 ---------- */
    /* 棕榈试过按「离路 24 m」拆成「投影」和「不投影」两个 InstancedMesh，
     * 想省掉阴影 pass 里的面数 —— 实测 723,624 → 723,522，等于没变。
     * 原因：InstancedMesh 只能整体剔除，±130 m 的阴影视锥把两批都框住了。
     * 所以退回一个 mesh；真正的阴影降本要么缩光锥、要么关掉部分物体的
     * castShadow，两条都要求逐帧判断，留给后续专门的优化轮。 */
    this._inst('palm', palms.concat(nearPalms), { castShadow: true });
    this._inst('palm_lod', farPalms, { castShadow: false });
    // 礁石轻量优化：倾倒 / 埋地 / 明暗微差（岸边礁石多埋一点，与海水融合）
    jitterRocks(rocksL); jitterRocks(rocksD);
    jitterRocks(rocksS, 0.12);
    this._inst('rock_round', rocksL, { castShadow: true });
    this._inst('rock_dark', rocksD, { castShadow: true });
    this._inst('rock_shallow', rocksS, { castShadow: false });
    this._inst('grass_tuft', grass, { castShadow: false, receiveShadow: false });
    for (const [name, list] of Object.entries(houses)) {
      this._inst(name, list, { castShadow: true });
    }
    this._inst('umbrella', umbrellas, { castShadow: true });
    this._inst('lounger', loungers, { castShadow: true });
    this._inst('crate', crates, { castShadow: true });
    this._inst('barrel', barrels, { castShadow: true });
    this._inst('surfboard', boards, { castShadow: false });
    this._inst('sign', signs, { castShadow: true });
    this._inst('flagpole', poles, { castShadow: false });
    this._inst('grandstand', stands, { castShadow: true });
    this._inst('start_gate', gates, { castShadow: true });
    if (gates.length) this.group.add(buildGateBanner(gates[0]));
    this._inst('buoy', buoys, { castShadow: false });

    this.propCounts = {
      palms: palms.length + nearPalms.length, palmsLod: farPalms.length,
      rocks: rocksL.length + rocksD.length + rocksS.length,
      rocksAtWater: rocksS.length,
      grass: grass.length,
      houses: houses.house_blue.length + houses.house_thatch.length + houses.house_fishing.length,
      umbrellas: umbrellas.length,
      props: crates.length + barrels.length + boards.length + signs.length + loungers.length,
      stands: stands.length, poles: poles.length, buoys: buoys.length,
    };
  }
}
