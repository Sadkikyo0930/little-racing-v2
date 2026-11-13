// 校验本地迁移文件与线上部署的函数定义是否「行为等价」
//
// 背景：仓库迁移文件保留中文注释与排版；线上是用 MCP 精简格式部署的。
// 判定方式：去掉注释、去掉全部空白、转小写后取 md5，与线上 pg_proc.prosrc
//          经同一规范化处理后的 md5 比对。一致 = SQL 语句序列完全相同。
//
// 线上规范化指纹取自：
//   SELECT md5(lower(regexp_replace(regexp_replace(prosrc,'--[^\n]*',' ','g'),'\s','','g')))
//   FROM pg_proc WHERE proname IN (...)
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

const dir = 'cloudbase/migrations';

const DEPLOYED_NORMALIZED = {
  r5_game_action: '6538f2527a0a4790da12a4d902fcf3cb',
  r5_game_action_md: 'c271eec3c2e58ec50cd2efcc676a26e2',
  r5_override_bind: '8d323ca7bba43210297ecf431fda1e5a',
  r5_parent_game_override: 'fd356d8390379c7cf33a28b85135eccb',
  r5_parent_game_override_audit: '4bcecc7974b4a40a7a837e7f96141056',
  r5_status: '479e4292f7e4e94c5c82251a831719a5',
};

const normalize = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\s/g, '')
    .toLowerCase();

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

const found = {};
const DOLLAR = '$function$';
for (const f of fs.readdirSync(dir)) {
  const s = fs.readFileSync(path.join(dir, f), 'utf8');
  for (const b of s.split(/CREATE OR REPLACE FUNCTION public\./).slice(1)) {
    const name = b.match(/^(\w+)/)?.[1];
    if (!name) continue;
    const start = b.indexOf('AS ' + DOLLAR);
    if (start < 0) continue;
    const from = start + ('AS ' + DOLLAR).length;
    const end = b.lastIndexOf(DOLLAR);
    if (end <= from) continue;
    found[name] = { file: f, body: b.slice(from, end) };
  }
}

let bad = 0;
for (const [name, want] of Object.entries(DEPLOYED_NORMALIZED)) {
  const v = found[name];
  if (!v) {
    bad++;
    console.log(`MISSING  ${name}  (未在迁移文件中找到)`);
    continue;
  }
  const got = md5(normalize(v.body));
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? 'EQUIVALENT' : 'DIFF      '}  ${name.padEnd(30)} ${v.file}  ${got.slice(0, 12)}`);
}
console.log(bad === 0 ? 'OK 迁移文件与线上部署逻辑完全等价（6/6 函数）' : `FAIL ${bad} 个函数定义不一致`);
process.exit(bad === 0 ? 0 : 1);
