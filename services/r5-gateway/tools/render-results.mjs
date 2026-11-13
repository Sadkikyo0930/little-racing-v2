#!/usr/bin/env node
/**
 * render-results.mjs — 把 tests/artifacts/*.json 渲染成 RESULTS.md
 *
 * 用例名与真实返回直接取自 artifacts，避免手抄误差。
 * 用法：node tools/render-results.mjs <artifactsDir> <outFile>
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || 'tests/artifacts';
const out = process.argv[3] || 'RESULTS.md';

const ORDER = [
  ['phase-a', 'A · 三个家长账号的密码校验与冒用拒绝'],
  ['phase-b', 'B · 设备状态：未绑定 / 已撤销 / 跨家庭'],
  ['phase-c', 'C · 一次性票据全链路（进场 → 开始 → 刷新被拒 → 退出 → 再进被拒）'],
  ['phase-d', 'D · 重放、缺密码、伪造字段、旧口令头'],
  ['phase-d2', 'D2 · 票据过期'],
  ['phase-e', 'E · 当天 1800 秒用尽'],
  ['phase-f', 'F · 正常学习路径与周边功能不受影响'],
  ['phase-g', 'G · 客户端直接调用数据库授权函数必须被拒'],
  ['phase-h1', 'H1 · 会话绑定：重复 start / 刷新 / 重放（本轮修复）'],
  ['phase-h2', 'H2 · 会话绑定：断线恢复、断线超时失效'],
  ['phase-h3', 'H3 · 会话绑定：多设备并发'],
  ['phase-h4', 'H4 · 正常学习路径不受影响'],
  ['phase-h5', 'H5 · 额度用尽时的会话拒绝'],
  ['link', 'L · 前端联通、旧口令下线与线上页面版本（CORS / 三账号 / 410）'],
  ['acceptance-walkthrough', 'W · 验收站点协议级"真实退出重进"走查'],
];

let total = 0;
let failed = 0;
const lines = [];

const head = [
  '# R5 家长入口（账号密码 + 会话绑定版）· 逐项实测结果',
  '',
  '> 本文件由 `tools/render-results.mjs` 从 `tests/artifacts/*.json` 直接渲染，',
  '> 每一行的 `实测返回` 都是接口真实响应的关键字段，不是人工描述。',
  '> 全部用例只访问隔离家庭 `r5-selftest-family`；正式家庭 `little-growth-family-001` 零写入。',
  '',
  '| 项 | 值 |',
  '| --- | --- |',
  '| 网关 | `https://normal-goose-d5g4qyzr8bb389a4a.service.tcloudbase.com/r5` |',
  '| 网关版本 | `1.5.0-session-bound` |',
  '| 隔离家庭 | `r5-selftest-family` |',
  '| 验收站点 | `https://normal-goose-d5g4qyzr8bb389a4a-1526110019.tcloudbaseapp.com/r5-accept/` |',
  '',
];

for (const [file, title] of ORDER) {
  const p = path.join(dir, `${file}.json`);
  if (!fs.existsSync(p)) continue;
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const rows = j.results || j.steps || [];
  const pass = rows.filter(r => r.ok).length;
  total += rows.length;
  failed += rows.length - pass;
  lines.push(`## ${title}`, '');
  lines.push(`运行时间：${j.started_at || ''}　|　${pass}/${rows.length} 通过`, '');
  lines.push('| # | 用例 | 结果 | 实测返回 |');
  lines.push('| --- | --- | --- | --- |');
  rows.forEach((r, i) => {
    const detail = String(r.detail || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    lines.push(`| ${i + 1} | ${r.name.replace(/\|/g, '\\|')} | ${r.ok ? '通过' : '**失败**'} | \`${detail}\` |`);
  });
  lines.push('');
}

const summary = [
  '## 合计',
  '',
  `- 用例总数：**${total}**`,
  `- 通过：**${total - failed}**`,
  `- 失败：**${failed}**`,
  '',
  '## 测试数据准备（两个用例需要构造数据库状态）',
  '',
  '`phase-d2`（票据过期）——先正常签发一张票据，再把时间窗整体前移，',
  '既满足表上 `r5_game_override_window_chk`（`granted_at < expires_at <= granted_at + 5min`），',
  '又让票据落在过期区间：',
  '',
  '```sql',
  "UPDATE public.r5_game_override",
  "   SET granted_at = clock_timestamp() - interval '10 minutes',",
  "       expires_at = clock_timestamp() - interval '8 minutes'",
  " WHERE family_id = 'r5-selftest-family'",
  "   AND device_uid = 'r5dev_acc_ttl_01' AND consumed_at IS NULL;",
  '```',
  '',
  '`phase-e`（额度用尽）——把当天已用时长置为 1800 秒，用例跑完立刻恢复原值：',
  '',
  '```sql',
  "UPDATE public.r5_daily_usage SET used_ms = 1800000, active = false",
  " WHERE family_id = 'r5-selftest-family' AND play_date = CURRENT_DATE;",
  '-- 用例结束后恢复为测试前的真实值，不清零、不额外加时间',
  "UPDATE public.r5_daily_usage SET used_ms = 54000, active = false",
  " WHERE family_id = 'r5-selftest-family' AND play_date = CURRENT_DATE;",
  '```',
  '',
  '`phase-f`（正常学习路径）需要当天学习计划为已发布状态，',
  '其余用例（含走查）需要"学习未完成"这一前提，因此计划在 `published = true / false` 之间切换，',
  '切换只发生在隔离家庭。',
  '',
];

fs.writeFileSync(out, [...head, ...lines, ...summary].join('\n'));
console.log(`${out}: ${total} cases, ${total - failed} passed, ${failed} failed`);
