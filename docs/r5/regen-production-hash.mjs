#!/usr/bin/env node
/**
 * regen-production-hash.mjs — 重算正式赛车仓库 production-sha256.json
 *
 * 正式仓库的清单是「相对 docs/ 目录」的扁平 map（82 项，与线上一致）。
 * 本候选版本会新增 docs/gate.html、docs/r5/*.mjs，并改动 docs/index.html，
 * 因此发布前必须重算，否则 CI 校验会失败。
 *
 * 用法（在 little-racing-v2 仓库根目录执行）：
 *   node docs/r5/regen-production-hash.mjs
 *   node docs/r5/regen-production-hash.mjs --check    # 只比对，不改文件
 *
 * 保证：只写 production-sha256.json，一个资源文件都不碰；
 *       --check 会列出新增 / 删除 / 内容变化的文件，供 ChatGPT 验收。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const DOCS = path.join(ROOT, 'docs');
const MANIFEST = path.join(ROOT, 'production-sha256.json');

if (!fs.existsSync(DOCS)) {
  console.error('[regen] 找不到 docs/，请在 little-racing-v2 仓库根目录执行');
  process.exit(2);
}

// 与正式仓库现有清单保持一致：忽略 .gitkeep / .nojekyll 等 0 字节占位
function walk(dir, base = dir, out = {}) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) { walk(full, base, out); continue; }
    const rel = path.relative(base, full).split(path.sep).join('/');
    if (rel === '.gitkeep' || rel === '.nojekyll' || rel === 'assets/.gitkeep') continue;
    if (stat.size === 0) continue;
    out[rel] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
  }
  return out;
}

const actual = walk(DOCS);
const expected = fs.existsSync(MANIFEST)
  ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};

const added = Object.keys(actual).filter((k) => !(k in expected)).sort();
const removed = Object.keys(expected).filter((k) => !(k in actual)).sort();
const changed = Object.keys(actual).filter((k) => k in expected && expected[k] !== actual[k]).sort();

console.log(`文件数：${Object.keys(actual).length}（原 ${Object.keys(expected).length}）`);
if (added.length) console.log('新增：\n  ' + added.join('\n  '));
if (removed.length) console.log('删除：\n  ' + removed.join('\n  '));
if (changed.length) console.log('内容变化：\n  ' + changed.join('\n  '));

if (process.argv.includes('--check')) {
  const same = !added.length && !removed.length && !changed.length;
  console.log(same ? 'MATCH' : 'DIFF');
  process.exit(same ? 0 : 1);
}

fs.writeFileSync(MANIFEST, JSON.stringify(actual) + '\n');
console.log('已写入 production-sha256.json');
