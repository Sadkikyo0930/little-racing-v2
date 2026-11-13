#!/usr/bin/env node
/**
 * regen-hash.mjs — 重算某个站点根目录的 production-sha256.json
 *
 * 用法：
 *   node tools/regen-hash.mjs <站点根目录>          # 重算并写入
 *   node tools/regen-hash.mjs <站点根目录> --check  # 只比对
 *
 * 规则与仓库自带 docs/r5/regen-production-hash.mjs 一致：
 * 相对站点根目录的扁平 map，跳过 0 字节占位文件与 .nojekyll。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(process.argv[2] || '');
const checkOnly = process.argv.includes('--check');
if (!root || !fs.existsSync(root)) {
  console.error('usage: node tools/regen-hash.mjs <siteRoot> [--check]');
  process.exit(2);
}

const MANIFEST = path.join(root, 'production-sha256.json');

function walk(dir, base = dir, out = {}) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) { walk(full, base, out); continue; }
    const rel = path.relative(base, full).split(path.sep).join('/');
    if (stat.size === 0) continue;
    out[rel] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
  }
  return out;
}

const actual = walk(root);
delete actual['production-sha256.json'];

const expected = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};
delete expected['production-sha256.json'];

const added = Object.keys(actual).filter(k => !(k in expected)).sort();
const removed = Object.keys(expected).filter(k => !(k in actual)).sort();
const changed = Object.keys(actual).filter(k => k in expected && expected[k] !== actual[k]).sort();

console.log(`文件数：${Object.keys(actual).length}（原 ${Object.keys(expected).length}）`);
if (added.length) console.log('新增：\n  ' + added.join('\n  '));
if (removed.length) console.log('删除：\n  ' + removed.join('\n  '));
if (changed.length) console.log('内容变化：\n  ' + changed.join('\n  '));

if (checkOnly) {
  const same = !added.length && !removed.length && !changed.length;
  console.log(same ? 'MATCH' : 'DIFF');
  process.exit(same ? 0 : 1);
}

fs.writeFileSync(MANIFEST, JSON.stringify(actual) + '\n');
console.log('已写入 ' + path.relative(process.cwd(), MANIFEST));
