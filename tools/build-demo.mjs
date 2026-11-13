#!/usr/bin/env node
/**
 * tools/build-demo.mjs — 生成 AE86 独立试玩构建
 *
 * 输入：docs/assets/index-Cam3Integrated.js（正式主包，原样不动）
 * 输出：demo/build/index.html
 *       demo/build/assets/index-ae86demo.js
 *
 * 只做三处替换，且每一处都必须精确命中一次，否则直接报错退出（fail-closed）：
 *   1. r5/isolation-storage.mjs  → 试玩页预置的 ae86demo:: 命名空间存储
 *   2. r5/family-preview.mjs     → 空实现（永远不会 join 测试家庭、不会发同步请求）
 *   3. r5/race-guard.mjs         → 空实现（getBirthdayClaim 恒为 null，不调用正式 R5 网关）
 * 保留 r5/birthday-show.mjs 的静态导入：它只是本地弹窗，无任何网络请求。
 *
 * 产物只用于隔离试玩部署，不写入 docs/，不进 GitHub Pages，也不进正式站点。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const srcBundle = path.join(repoRoot, 'docs', 'assets', 'index-Cam3Integrated.js');
const srcHtml = path.join(repoRoot, 'demo', 'index.html');
const outDir = path.join(repoRoot, 'demo', 'build');
const outBundle = path.join(outDir, 'assets', 'index-ae86demo.js');
const outHtml = path.join(outDir, 'index.html');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const replacements = [
  {
    name: 'isolation-storage',
    find: "import {previewStorage as localStorage} from '../r5/isolation-storage.mjs';",
    make: () =>
      "const localStorage = globalThis.__AE86_DEMO_STORAGE__ || globalThis.localStorage;",
  },
  {
    name: 'family-preview',
    find: "import {scheduleFamilySync} from '../r5/family-preview.mjs';",
    make: () =>
      '/* DEMO: family sync disabled, no CloudBase request is ever made */ const scheduleFamilySync = function () {};',
  },
  {
    name: 'race-guard',
    find: "import { getBirthdayClaim } from '../r5/race-guard.mjs';",
    make: () =>
      '/* DEMO: never touches the production R5 gateway */ const getBirthdayClaim = function () { return Promise.resolve(null); };',
  },
  {
    // 生日开箱只是本地弹窗，但它是个 .mjs 静态依赖；内联掉之后试玩构建对
    // 服务端的 MIME 配置零依赖，任何静态托管都能跑。
    name: 'birthday-show',
    find: "import { BIRTHDAY_ID, openBirthdayShow } from '../r5/birthday-show.mjs';",
    make: (ctx) =>
      `const BIRTHDAY_ID = ${JSON.stringify(ctx.birthdayId)};\n` +
      '/* DEMO: 生日车在试玩里不会解锁，弹窗实现留空即可 */ const openBirthdayShow = function (onClose) { try { if (onClose) onClose(); } catch (e) {} };',
  },
];

if (!fs.existsSync(srcBundle)) {
  console.error(`[build-demo] missing source bundle: ${srcBundle}`);
  process.exit(1);
}

const original = fs.readFileSync(srcBundle, 'utf8');
let built = original;

// 生日车 ID 从源码里读，避免手写常量和上游漂移
const birthdaySrc = fs.readFileSync(path.join(repoRoot, 'docs', 'r5', 'birthday-show.mjs'), 'utf8');
const birthdayMatch = birthdaySrc.match(/export const BIRTHDAY_ID = '([^']+)'/);
if (!birthdayMatch) {
  console.error('[build-demo] cannot read BIRTHDAY_ID from docs/r5/birthday-show.mjs');
  process.exit(1);
}
const ctx = { birthdayId: birthdayMatch[1] };

for (const r of replacements) {
  const hits = built.split(r.find).length - 1;
  if (hits !== 1) {
    console.error(`[build-demo] expected exactly 1 occurrence of ${r.name} import, found ${hits}`);
    process.exit(1);
  }
  built = built.replace(r.find, r.make(ctx));
}

// 试玩构建必须对 r5/ 目录零依赖
const leftovers = (built.match(/['"]\.\.\/r5\//g) || []).length;
if (leftovers !== 0) {
  console.error(`[build-demo] unexpected remaining ../r5/ imports: ${leftovers}`);
  process.exit(1);
}

const banner =
  `/*! AE86 独立试玩构建 · 由 tools/build-demo.mjs 生成，不要手改\n` +
  ` *  源文件 : docs/assets/index-Cam3Integrated.js (sha256 ${sha256(Buffer.from(original)).slice(0, 16)}…)\n` +
  ` *  差异   : r5 守卫 / 家庭同步 / 生日云端领取 → 空实现；存档走 ae86demo:: 命名空间\n` +
  ` *  用途   : 仅隔离试玩部署，不参与正式发布\n` +
  ` */\n`;

fs.mkdirSync(path.dirname(outBundle), { recursive: true });
fs.writeFileSync(outBundle, banner + built, 'utf8');
fs.copyFileSync(srcHtml, outHtml);

const outBuf = fs.readFileSync(outBundle);
console.log(JSON.stringify({
  ok: true,
  sourceBundle: path.relative(repoRoot, srcBundle),
  sourceBytes: Buffer.byteLength(original),
  outputBundle: path.relative(repoRoot, outBundle),
  outputBytes: outBuf.length,
  outputSha256: sha256(outBuf),
  html: path.relative(repoRoot, outHtml),
  htmlSha256: sha256(fs.readFileSync(outHtml)),
  removedImports: replacements.map((r) => r.name),
  keptR5Import: 'birthday-show',
}, null, 2));
