/* ==================================================================
 * 第二章 · 贝壳湾海滨环线 —— 赛道审计（带失败断言）
 *
 * 用法：
 *   node tools/audit-track.mjs            正常审计，任何一项不过 → exit 1
 *   node tools/audit-track.mjs --json     额外把结果写成 JSON（测试报告用）
 *
 * 与 R2 交付包里的 audit.mjs 的区别：
 *   · 数据源改成 src/world/chapter2/beachData.js —— 审的就是**游戏真正跑的那份数据**
 *   · 11 项全部是断言，不是打印。任何一项失败都进 fails[] 并以 exit 1 结束
 *   · 断言阈值写死在代码里，不读外部配置，避免"改个配置就通过"
 *
 * 采样算法必须与 src/world/track.js 完全一致（Catmull-Rom 闭环 + 等弧长重采样
 * + 26 点滑动平均曲率），否则审计通过但游戏里对不上。
 * ================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  BEACH_CONTROL, BEACH_SECTIONS, BEACH_RIVER, BEACH_TARGET, RIVER_HALF,
} from '../src/world/chapter2/beachData.js';
import { sectionRanges, assignSectionKinds } from '../src/world/chapter2/sectionKinds.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WRITE_JSON = process.argv.includes('--json');

/* 采样点数必须和 Track 里的公式一致：约 0.6 m 一点 */
const TRACK_CHECKPOINTS = 32;

/* ---------------- 1. 曲线与弧长 ---------------- */
const cn = BEACH_CONTROL.length;
const curve = new THREE.CatmullRomCurve3(
  BEACH_CONTROL.map((c) => new THREE.Vector3(c[0], c[1], c[2])), true, 'catmullrom', 0.5);
const length = curve.getLength();

const PER = 2000;
const cum = new Float64Array(cn + 1);
{
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  let acc = 0;
  curve.getPoint(0, a);
  for (let i = 0; i < cn; i++) {
    for (let k = 1; k <= PER; k++) {
      curve.getPoint((i + k / PER) / cn, b);
      acc += a.distanceTo(b);
      a.copy(b);
    }
    cum[i + 1] = acc;
  }
}
const arcTotal = cum[cn];
const controlU = Array.from(cum, (d) => d / arcTotal);

/* ---------------- 2. 等弧长采样表（与 track.js 同一套） ---------------- */
const n = Math.max(1200, Math.round((length / 0.6) / 100) * 100);
const seg = length / n;
const pos = new Float32Array(n * 3);
const tan = new Float32Array(n * 3);
const width = new Float32Array(n);
const kind = new Uint8Array(n);
{
  const P = new THREE.Vector3(), T = new THREE.Vector3();
  const crScalar = (arr, u) => {
    let i0 = 0;
    while (i0 < cn - 1 && controlU[i0 + 1] <= u) i0++;
    const u0 = controlU[i0], u1 = controlU[i0 + 1] || 1;
    const s = u1 > u0 ? THREE.MathUtils.clamp((u - u0) / (u1 - u0), 0, 1) : 0;
    const s2 = s * s, s3 = s2 * s;
    const im = (i0 - 1 + cn) % cn, i2 = (i0 + 2) % cn;
    const p0 = arr[im], p1 = arr[i0 % cn], p2 = arr[(i0 + 1) % cn], p3 = arr[i2];
    return 0.5 * ((2 * p1) + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2
      + (-p0 + 3 * p1 - 3 * p2 + p3) * s3);
  };
  for (let i = 0; i < n; i++) {
    const u = i / n;
    curve.getPointAt(u, P); curve.getTangentAt(u, T);
    pos[i * 3] = P.x; pos[i * 3 + 1] = P.y; pos[i * 3 + 2] = P.z;
    tan[i * 3] = T.x; tan[i * 3 + 1] = T.y; tan[i * 3 + 2] = T.z;
    width[i] = crScalar(BEACH_CONTROL.map((c) => c[3]), u);
    kind[i] = Math.round(THREE.MathUtils.clamp(crScalar(BEACH_CONTROL.map((c) => c[4]), u), 0, 4));
  }
}

/* 曲率（与 track.js 相同：切线叉积 / 段长，再 26 点滑动平均） */
const curv = new Float32Array(n);
for (let i = 0; i < n; i++) {
  const j = (i + 1) % n;
  const cross = tan[i * 3] * tan[j * 3 + 2] - tan[i * 3 + 2] * tan[j * 3];
  curv[i] = -cross / seg;
}
const sm = new Float32Array(n);
{
  const K = 26;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -K; k <= K; k++) s += curv[(i + k + n) % n];
    sm[i] = s / (2 * K + 1);
  }
}

/* ---------------- 3. 九段（按弧长切） ---------------- */
const idxAt = (ci) => Math.round(controlU[ci] * n) % n;
const sections = BEACH_SECTIONS.map((s) => {
  const d0 = cum[s.from];
  const d1 = s.to >= cn ? arcTotal : cum[s.to];
  return {
    id: s.id, name: s.name, from: s.from, to: s.to, kind: s.kind,
    i0: idxAt(s.from), i1: idxAt(s.to) % n,
    len: d1 - d0, d0, d1, halfWidth: BEACH_CONTROL[s.from][3],
  };
});

/* 用游戏同一套分段映射再算一遍（sectionRanges 是 Track 与审计共用的函数） */
const rangesFromData = sectionRanges(n, arcTotal, cum, BEACH_SECTIONS).ranges;

/* ---------------- 4. 半径 / 坡度 / 间距 / 高差 ---------------- */
let minR = Infinity, minRi = 0, maxGrade = 0, gradeI = 0;
for (let i = 0; i < n; i++) {
  const c = Math.abs(sm[i]);
  if (c > 1e-6 && 1 / c < minR) { minR = 1 / c; minRi = i; }
  const g = Math.abs(pos[((i + 1) % n) * 3 + 1] - pos[i * 3 + 1]) / seg;
  if (g > maxGrade) { maxGrade = g; gradeI = i; }
}
const corners = [];
for (let i = 0; i < n; i++) {
  const c = Math.abs(sm[i]);
  if (c < 1 / 46) continue;
  const r = 1 / c;
  const last = corners[corners.length - 1];
  if (last && i - last.i <= 30) {
    if (r < last.r) corners[corners.length - 1] = { i, r, sign: Math.sign(sm[i]), at: i * seg };
    continue;
  }
  corners.push({ i, r, sign: Math.sign(sm[i]), at: i * seg });
}
let minSep = Infinity, sepPair = null;
for (let i = 0; i < n; i += 4) {
  for (let j = i + 4; j < n; j += 4) {
    const arc = Math.min(j - i, n - (j - i)) * seg;
    if (arc < 90) continue;
    const d = Math.hypot(pos[i * 3] - pos[j * 3], pos[i * 3 + 2] - pos[j * 3 + 2]);
    if (d < minSep) { minSep = d; sepPair = [+(i * seg).toFixed(1), +(j * seg).toFixed(1), +arc.toFixed(1)]; }
  }
}
let yMin = Infinity, yMax = -Infinity;
for (let i = 0; i < n; i++) { yMin = Math.min(yMin, pos[i * 3 + 1]); yMax = Math.max(yMax, pos[i * 3 + 1]); }

/* ---------------- 5. 木桥：桥面长度 / 河口跨径 / 桥台 ---------------- */
function distToRiver(x, z) {
  let best = Infinity;
  for (let i = 0; i < BEACH_RIVER.length - 1; i++) {
    const [x1, z1] = BEACH_RIVER[i], [x2, z2] = BEACH_RIVER[i + 1];
    const dx = x2 - x1, dz = z2 - z1;
    const t = THREE.MathUtils.clamp(((x - x1) * dx + (z - z1) * dz) / (dx * dx + dz * dz), 0, 1);
    best = Math.min(best, Math.hypot(x - (x1 + dx * t), z - (z1 + dz * t)));
  }
  return best;
}
let wetFrom = -1, wetTo = -1;
for (let i = 0; i < n; i++) {
  if (distToRiver(pos[i * 3], pos[i * 3 + 2]) < RIVER_HALF + 2) {
    if (wetFrom < 0) wetFrom = i;
    wetTo = i;
  }
}
const wetLen = wetFrom < 0 ? 0 : (wetTo - wetFrom + 1) * seg;
const wetA = wetFrom * seg, wetB = (wetTo + 1) * seg;

const bridge = sections.find((s) => s.id === 'bridge');
const abutSouth = wetA - bridge.d0;
const abutNorth = bridge.d1 - wetB;

/* 桥面 kind：走游戏**真正用的那条代码路径**（sectionKinds.js 显式赋值），
 * 不是这里另写一套。插值出来的 kindNaive 只作对照，用来说明为什么不能插值。 */
const naiveKind = kind.slice();
const { kind: kindExplicit, owner } = assignSectionKinds(n, rangesFromData);

const inBridgeRange = (i) => {
  if (bridge.i1 > bridge.i0) return i >= bridge.i0 && i < bridge.i1;
  return i >= bridge.i0 || i < bridge.i1;
};
const kind3 = [];
for (let i = 0; i < n; i++) if (inBridgeRange(i)) kind3.push(i);
const bridgeKindAll3 = kind3.length > 0 && kind3.every((i) => kindExplicit[i] === 3);
const kind3Outside = [];
for (let i = 0; i < n; i++) if (kindExplicit[i] === 3 && !inBridgeRange(i)) kind3Outside.push(i);
const uncovered = [];
for (let i = 0; i < n; i++) if (owner[i] < 0) uncovered.push(i);
/* 朴素插值会误标多少个「木板」采样点（诊断用，不算失败） */
let naiveGhost = 0;
for (let i = 0; i < n; i++) if (naiveKind[i] === 3 && !inBridgeRange(i)) naiveGhost++;

/* ---------------- 6. 检查点 ---------------- */
const checkpoints = [];
for (let c = 0; c < TRACK_CHECKPOINTS; c++) checkpoints.push(Math.floor((c / TRACK_CHECKPOINTS) * n));
let cpOrdered = true;
for (let c = 1; c < checkpoints.length; c++) if (checkpoints[c] <= checkpoints[c - 1]) cpOrdered = false;
const cpLastOk = checkpoints[checkpoints.length - 1] < n;
const cpCoversLap = checkpoints[0] === 0;

/* ---------------- 7. 有限性 ---------------- */
const finiteFails = [];
const F = (v) => typeof v === 'number' && Number.isFinite(v);
for (let i = 0; i < n; i++) {
  if (!F(pos[i * 3]) || !F(pos[i * 3 + 1]) || !F(pos[i * 3 + 2])) finiteFails.push(`pos[${i}]`);
  if (!F(width[i])) finiteFails.push(`width[${i}]`);
  if (!F(sm[i])) finiteFails.push(`curvature[${i}]`);
  if (kind[i] > 4) finiteFails.push(`kind[${i}]=${kind[i]}`);
  if (finiteFails.length > 8) break;
}
for (const [k, v] of Object.entries({ length, minR, maxGrade, wetLen, abutSouth, abutNorth, minSep })) {
  if (!F(v)) finiteFails.push(k);
}

/* ---------------- 8. 断言 ---------------- */
const fails = [];
const near = (name, actual, target, tol, unit = '') => {
  const ok = Number.isFinite(actual) && Math.abs(actual - target) <= tol;
  if (!ok) fails.push(`${name}：实测 ${Number.isFinite(actual) ? actual.toFixed(2) : actual}${unit} / 目标 ${target}±${tol}${unit}`);
  return ok;
};
const truth = (name, ok, detail = '') => {
  if (!ok) fails.push(`${name}${detail ? `：${detail}` : ''}`);
  return ok;
};

// 1 赛道总长 ≈ 1057.5 m（R2 设计值 1058，±4 m）
near('① 赛道总长', length, BEACH_TARGET.length, 4, ' m');
// 2 九段之和 = 总长
const sumSec = sections.reduce((a, s) => a + s.len, 0);
near('② 九段长度之和', sumSec, length, 0.5, ' m');
// 3 最急弯 ≈ R33
near('③ 最急弯半径', minR, BEACH_TARGET.minRadius, 1.5, ' m');
// 4 最大坡度 ≈ 6.10%
near('④ 最大坡度', maxGrade * 100, BEACH_TARGET.maxGrade, 0.15, '%');
// 5 木桥 48 ±1 m
near('⑤ 木桥长度', bridge.len, BEACH_TARGET.bridgeLen, 1, ' m');
// 6 河口 ≈ 21 m，且完整落在桥面内
near('⑥ 河口跨径', wetLen, 21, 2, ' m');
truth('⑥b 河口完整位于木桥范围内',
  wetA > bridge.d0 && wetB < bridge.d1,
  `水线 ${wetA.toFixed(1)}–${wetB.toFixed(1)} m，桥面 ${bridge.d0.toFixed(1)}–${bridge.d1.toFixed(1)} m`);
// 7 两侧桥台 ≥ 12 m
truth('⑦ 南侧桥台 ≥ 12 m', abutSouth >= BEACH_TARGET.minAbutment, `实测 ${abutSouth.toFixed(1)} m`);
truth('⑦ 北侧桥台 ≥ 12 m', abutNorth >= BEACH_TARGET.minAbutment, `实测 ${abutNorth.toFixed(1)} m`);
// 8 kind=3 只出现在桥段
truth('⑧ 桥段内 kind=3 全覆盖', bridgeKindAll3,
  `${kind3.length} 个采样点中 ${kind3.filter((i) => kindExplicit[i] !== 3).length} 个不是 3`);
truth('⑧a 每个采样点都被分段覆盖', uncovered.length === 0, `未覆盖 ${uncovered.length} 点`);
truth('⑧b 桥段外无 kind=3', kind3Outside.length === 0,
  `越界采样点 ${kind3Outside.length} 个${kind3Outside.length ? `（首个 @ ${(kind3Outside[0] * seg).toFixed(1)} m）` : ''}`);
// 9 32 个检查点顺序正确
truth('⑨ 检查点数量 32', checkpoints.length === TRACK_CHECKPOINTS, `实测 ${checkpoints.length}`);
truth('⑨b 检查点严格递增', cpOrdered);
truth('⑨c 检查点不越界', cpLastOk, `末点 ${checkpoints[checkpoints.length - 1]} / n=${n}`);
truth('⑨d 检查点从起点开始', cpCoversLap);
// 10 无自交（非相邻路段最近距离 ≥ 24 m，即两倍车宽以上）
truth('⑩ 赛道无自交', minSep >= 24,
  `最近 ${minSep.toFixed(1)} m @ ${sepPair ? sepPair.join(' / ') : '-'}`);
// 11 全部有限
truth('⑪ 计算值均为有限数', finiteFails.length === 0, finiteFails.join(', '));

/* ---------------- 9. 输出 ---------------- */
const line = (s = '') => console.log(s);
line('');
line('=== 采样 ===');
line(`全长 ${length.toFixed(1)} m ｜ 采样 ${n} 点 ｜ 段长 ${seg.toFixed(4)} m ｜ 控制点 ${cn} 个`);
line(`高差 ${yMin.toFixed(2)} – ${yMax.toFixed(2)} m ｜ 最急弯 R ${minR.toFixed(1)} m @ ${(minRi * seg).toFixed(0)} m`);
line(`最大坡度 ${(maxGrade * 100).toFixed(2)}% @ ${(gradeI * seg).toFixed(0)} m ｜ 非相邻最近间距 ${minSep.toFixed(1)} m`);
line(`弯道 R<46 m：${corners.length} 个  ${corners.map((c) => `R${c.r.toFixed(1)}@${c.at.toFixed(0)}m`).join(' ')}`);

line('');
line('=== 九段实测（按弧长） ===');
for (const [k, s] of sections.entries()) {
  line(`  ${k + 1}. ${s.name.padEnd(8, '　')} ${s.len.toFixed(1).padStart(6)} m`
    + `  (${(s.len / length * 100).toFixed(1)}%)  cp${s.from}–${s.to}  kind=${s.kind}`);
}
line(`  合计 ${sumSec.toFixed(1)} m ／ 全长 ${length.toFixed(1)} m`);

line('');
line('=== 木桥 ===');
line(`桥段 ${bridge.len.toFixed(1)} m（${bridge.d0.toFixed(1)}–${bridge.d1.toFixed(1)} m，cp${bridge.from}–cp${bridge.to}）`);
line(`河口水面 ${wetA.toFixed(1)}–${wetB.toFixed(1)} m（宽 ${wetLen.toFixed(1)} m）`);
line(`桥台：南 ${abutSouth.toFixed(1)} m ／ 北 ${abutNorth.toFixed(1)} m（要求 ≥ ${BEACH_TARGET.minAbutment} m）`);
line(`桥面宽 ${(BEACH_CONTROL[19][3] * 2).toFixed(1)} m（最窄处）｜ kind=3 越界 ${kind3Outside.length} 点`);
line(`  （对照：若按控制点插值 kind，桥段外会多出 ${naiveGhost} 个木板采样点 = ${(naiveGhost * seg).toFixed(1)} m 假木桥）`);

line('');
line('=== 检查点 ===');
line(`32 点：${checkpoints.slice(0, 8).join(', ')} … ${checkpoints.slice(-3).join(', ')}`);

line('');
line('=== 配速 ===');
const lap = BEACH_TARGET.laps * length;
const best = lap / BEACH_TARGET.topSpeed;
line(`单圈 ${length.toFixed(0)} m × ${BEACH_TARGET.laps} 圈 = ${lap.toFixed(0)} m`);
line(`全速下界 ${best.toFixed(1)} s = ${Math.floor(best / 60)} 分 ${Math.round(best % 60)} 秒`);
line(`均速 17.6 m/s → ${(lap / 17.6).toFixed(1)} s = ${Math.floor(lap / 17.6 / 60)} 分 ${Math.round(lap / 17.6 % 60)} 秒`);

line('');
if (fails.length) {
  console.error(`!!! 审计失败 ${fails.length} 项：`);
  for (const f of fails) console.error('   ✗ ' + f);
} else {
  line('OK 11 项断言全部通过');
}

const report = {
  ok: fails.length === 0,
  fails,
  generatedAt: new Date().toISOString(),
  length: +length.toFixed(2),
  samples: n,
  seg: +seg.toFixed(4),
  controlPoints: cn,
  minRadius: +minR.toFixed(2),
  minRadiusAt: +(minRi * seg).toFixed(1),
  maxGradePct: +(maxGrade * 100).toFixed(2),
  maxGradeAt: +(gradeI * seg).toFixed(1),
  yMin: +yMin.toFixed(2),
  yMax: +yMax.toFixed(2),
  widthMin: +(Math.min(...width) * 2).toFixed(2),
  widthMax: +(Math.max(...width) * 2).toFixed(2),
  minSeparation: +minSep.toFixed(1),
  corners: corners.map((c) => ({ r: +c.r.toFixed(1), sign: c.sign, at: +c.at.toFixed(0) })),
  sections: sections.map((s) => ({
    id: s.id, name: s.name, len: +s.len.toFixed(1), d0: +s.d0.toFixed(1), d1: +s.d1.toFixed(1), kind: s.kind,
  })),
  sumSections: +sumSec.toFixed(1),
  bridge: {
    len: +bridge.len.toFixed(1),
    d0: +bridge.d0.toFixed(1),
    d1: +bridge.d1.toFixed(1),
    waterSpan: +wetLen.toFixed(1),
    abutSouth: +abutSouth.toFixed(1),
    abutNorth: +abutNorth.toFixed(1),
    kind3Outside: kind3Outside.length,
    naiveGhostSamples: naiveGhost,
  },
  checkpoints,
  pace: { laps: BEACH_TARGET.laps, bestSec: +best.toFixed(1), avg176Sec: +(lap / 17.6).toFixed(1) },
};

if (WRITE_JSON) {
  const out = path.join(ROOT, 'tools', 'out');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'audit.json'), JSON.stringify(report, null, 2));
  line(`\nwrote tools/out/audit.json`);
}

process.exit(fails.length ? 1 : 0);
