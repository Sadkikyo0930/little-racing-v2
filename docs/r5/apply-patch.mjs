#!/usr/bin/env node
/**
 * apply-patch.mjs — 给正式赛车 V2 的 docs/index.html 注入 / 撤销 R5 守卫
 *
 * 正式仓库 little-racing-v2 只有构建产物（docs/），没有源码，所以只做**最小注入**：
 * 在游戏主模块 <script> 之前插一行 module script，守卫先于游戏执行。
 * 不改任何资源、章节、配音、车辆、存档逻辑；--revert 后与原文件逐字节一致。
 *
 * 用法（在 little-racing-v2 仓库根目录执行）：
 *   node docs/r5/apply-patch.mjs            # 注入（幂等）
 *   node docs/r5/apply-patch.mjs --check    # 只检查
 *   node docs/r5/apply-patch.mjs --revert   # 还原
 *   node docs/r5/apply-patch.mjs --file <path>
 *
 * 注意：本脚本只改 docs/index.html。改完必须在仓库根执行
 *   node docs/r5/regen-production-hash.mjs
 * 重算 production-sha256.json，否则发布校验会失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..'); // docs/r5/ → docs/ → 仓库根
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const file = path.resolve(opt('--file', path.join(REPO, 'docs', 'index.html')));
const MARK = '<!-- r5-prodlink-guard -->';
const GUARD_IMPORT = './r5/race-guard.mjs';
const ORIGINAL_RE = /(<script\s+type="module"[^>]*src="([^"]*\/assets\/index-[^"]+\.js)"[^>]*>\s*<\/script>)/i;
const PATCHED_RE = /<script type="module" data-r5-original="([A-Za-z0-9+/=]+)" data-r5-entry="[^"]+">[\s\S]*?<\/script><!-- r5-prodlink-guard -->/g;
function patchMain(text) {
  const m = text.match(ORIGINAL_RE);
  if (!m) throw new Error('找不到原始主模块 script，停止注入');
  const encoded = Buffer.from(m[1], 'utf8').toString('base64');
  const tag = `<script type="module" data-r5-original="${encoded}" data-r5-entry="${m[2]}">import { ready } from "${GUARD_IMPORT}"; if (await ready) await import(${JSON.stringify(m[2])});</script>${MARK}`;
  return text.replace(m[1], tag);
}
function strip(text) {
  return text.replace(PATCHED_RE, (_, encoded) => Buffer.from(encoded, 'base64').toString('utf8'));
}

if (!fs.existsSync(file)) {
  console.error(`[r5] 找不到 ${file}`);
  process.exit(2);
}

const before = fs.readFileSync(file, 'utf8');
const has = before.includes(MARK);
if (flag('--check')) {
  console.log(has && strip(before) !== before ? 'PATCHED' : 'UNPATCHED');
  process.exit(has && strip(before) !== before ? 0 : 1);
}

if (flag('--revert')) {
  if (!has) { console.log('[r5] 未注入，无需还原'); process.exit(0); }
  const reverted = strip(before);
  if (reverted.includes(MARK)) {
    console.error('[r5] 还原失败：仍残留注入标记，已中止（不写文件）');
    process.exit(4);
  }
  fs.writeFileSync(file, reverted);
  console.log('[r5] 已还原', path.relative(REPO, file));
  process.exit(0);
}

if (has) {
  console.log('[r5] 已注入过，跳过（幂等）');
  process.exit(0);
}

let out;
try { out = patchMain(before); }
catch (e) { console.error('[r5]', e.message); process.exit(3); }
if (strip(out) !== before) {
  console.error('[r5] 自检失败：无法精确还原'); process.exit(5);
}
const assets = (s) => (s.match(/\/little-racing-v2\/assets\/[A-Za-z0-9._-]+/g) || []).join('|');
// Asset URL still appears in data-r5-entry and dynamic import; no resource is renamed.
if (!out.includes(MARK) || !out.includes('if (await ready) await import(')) {
  console.error('[r5] 自检失败：没有授权等待逻辑'); process.exit(6);
}
fs.writeFileSync(file, out);
console.log('[r5] 已把主模块替换为授权后动态加载（fail-closed）');
console.log('[r5] 下一步：node docs/r5/regen-production-hash.mjs');
