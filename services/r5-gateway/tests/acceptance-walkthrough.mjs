/**
 * R5 家长快捷入口 · 验收走查（协议级"真实退出重进"）
 *
 * 完全按 gate.html 的真实顺序打接口：
 *   打开通行证页 → 选账号+输密码 → 拿一次性授权 → 跳赛车页进场
 *   → 开始游戏（票据被消费）→ 刷新/重进被拒 → 结束游戏 → 再进被拒
 *
 * 只使用隔离家庭 r5-selftest-family 与专用验收设备，不碰正式家庭任何数据。
 * 用法：node tests/acceptance-walkthrough.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const SITE = 'https://normal-goose-d5g4qyzr8bb389a4a-1526110019.tcloudbaseapp.com/r5-accept';
const BASE = 'https://normal-goose-d5g4qyzr8bb389a4a.service.tcloudbase.com/r5';
const FAMILY = 'r5-selftest-family';
const DEVICE = 'r5dev_parent_accept_01';
const ACCOUNT = 'r5_selftest';

function readPwd(account) {
  const v6 = 'C:/Users/Administrator/WorkBuddy/2026-11-08-13-47-44/.r5-local/test-account.txt';
  try {
    const raw = fs.readFileSync(v6, 'utf8');
    const g = k => { const m = raw.match(new RegExp('^' + k + '\\s*[:=]\\s*(.+)$', 'm')); return m ? m[1].trim() : ''; };
    if (g('USERNAME') === account && g('PASSWORD')) return g('PASSWORD');
  } catch { /* ignore */ }
  const local = path.join(process.cwd(), '.local', 'test-accounts.json');
  try {
    const j = JSON.parse(fs.readFileSync(local, 'utf8'));
    const hit = (j.accounts || []).find(a => a.account === account);
    if (hit && hit.password) return hit.password;
  } catch { /* ignore */ }
  return '';
}

const PWD = readPwd(ACCOUNT);
if (!PWD) { console.error('缺少本机测试凭据，跳过'); process.exit(2); }

const steps = [];
function step(name, ok, detail) {
  steps.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`);
}

async function post(p, body, headers = {}) {
  const r = await fetch(BASE + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  let j = null;
  try { j = await r.json(); } catch { /* ignore */ }
  return { status: r.status, json: j };
}
const brief = j => (j ? JSON.stringify({
  api: j.api, allowed: j.allowed, reason: j.reason, active: j.active,
  authorized: j.authorized, remaining_seconds: j.remaining_seconds,
  used_seconds: j.used_seconds, parent_override: j.parent_override,
  override_consumed: j.override_consumed,
  session_id: j.session_id || null, session_origin: j.session_origin || null,
  session_resumed: j.session_resumed, error: j.error,
}) : 'null');

const entry = () => post('/v1/child/entry', { family_id: FAMILY }, { 'x-r5-device': DEVICE });
// 前端 createR5Gate() 的行为：start 拿到的 session_id 只存内存，
// tick / stop 原样带回；刷新或换标签页就没有它。
let sid = '';
const startCost = () => post('/v1/game/action', { family_id: FAMILY, action: 'start' }, { 'x-r5-device': DEVICE });
const startFresh = async () => {
  const r = await startCost();
  if (r.json?.allowed === true && typeof r.json?.session_id === 'string') sid = r.json.session_id;
  else if (r.json?.allowed !== true) sid = '';
  return r;
};
const resume = () => post('/v1/game/action',
  { family_id: FAMILY, action: 'start', session_id: sid }, { 'x-r5-device': DEVICE });
const stop = () => post('/v1/game/action',
  { family_id: FAMILY, action: 'stop', ...(sid ? { session_id: sid } : {}) }, { 'x-r5-device': DEVICE })
  .then(r => { sid = ''; return r; });
const session = (pwd, account = ACCOUNT) =>
  post('/v1/parent/session', { family_id: FAMILY, device: DEVICE, account, password: pwd });

/* 0. 通行证页与依赖模块可访问 */
const page = await fetch(`${SITE}/gate.html`, { cache: 'no-store' });
const html = await page.text();
const mod = await fetch(`${SITE}/r5/parent-accounts.mjs`, { cache: 'no-store' });
const modText = await mod.text();
step('页面可打开且已是账号密码版（无 x-r5-parent 旧通道）',
  page.status === 200 && /parent\/session/.test(html) && !/x-r5-parent/.test(html),
  `gate.html=${page.status} bytes=${html.length}`);
step('家长账号清单模块可加载（不含任何密码）',
  mod.status === 200 && /R5_PARENT_ACCOUNTS/.test(modText) && !/password\s*:/i.test(modText),
  `parent-accounts.mjs=${mod.status} bytes=${modText.length}`);

/* 1. 干净起点：没有授权时进不去 */
// 先把上一轮可能残留的会话关掉，保证起点确定（没有会话时 stop 是无害的空操作）
await startCost();
await stop();
const e0 = await entry();
step('未验证家长时进不去（学习未达标）', e0.json?.allowed === false, brief(e0.json));

/* 2. 密码错误被拒 */
const bad = await session('guard-wrong-password-' + Date.now());
step('密码错误被拒绝', bad.status === 401 && bad.json?.error === 'R5_PARENT_AUTH_FAILED',
  `status=${bad.status} error=${bad.json?.error}`);

/* 3. 正确密码授权 */
const ok = await session(PWD);
step('选择账号 + 正确密码 → 拿到一次性授权',
  ok.status === 200 && ok.json?.authorized === true && ok.json?.one_time === true,
  brief(ok.json));

/* 4. 跳转赛车页后进场 */
const e1 = await entry();
step('授权后进场成功（只跳过学习条件）',
  e1.json?.allowed === true && e1.json?.parent_override === true, brief(e1.json));

/* 5. 开始游戏：票据原子消费，并下发服务端会话标识 */
const s1 = await startFresh();
step('开始游戏时票据被消费，并拿到服务端会话标识',
  s1.json?.active === true && s1.json?.override_consumed === true
  && /^[a-f0-9]{32}$/.test(String(s1.json?.session_id || '')),
  brief(s1.json));

/* 6. 刷新页面 / 重进：必须重新验证 */
const e2 = await entry();
step('刷新页面后进场被拒绝（不再免密）', e2.json?.allowed === false && e2.json?.parent_override === false, brief(e2.json));

/* 7. 刷新后的新页面再点一次「开始」：没有标识就开不了（本轮修复点） */
const s2 = await startFresh();
step('刷新后再次 start 被拒绝（已消费票据 + 设备身份不再足够）',
  s2.json?.allowed === false && s2.json?.reason === 'SESSION_REQUIRED'
  && s2.json?.override_consumed === false && s2.json?.session_id == null, brief(s2.json));

/* 7b. 只有握着原会话标识的页面才能续接（模拟没被刷新的那个标签页） */
sid = s1.json?.session_id || '';
const s2b = await resume();
step('带原会话标识可以续接同一个会话，标识不变',
  s2b.json?.allowed === true && s2b.json?.session_resumed === true
  && s2b.json?.session_id === sid, brief(s2b.json));

/* 8. 退出游戏 */
const sp = await stop();
step('结束游戏', sp.json?.active === false, brief(sp.json));

/* 9. 退出后再进：必须重新输密码 */
const e3 = await entry();
step('退出后重新进入必须再次输入家长密码', e3.json?.allowed === false && e3.json?.parent_override === false, brief(e3.json));
const s3 = await startFresh();
step('退出后凭旧授权无法开始游戏', s3.json?.allowed === false && s3.json?.active === false, brief(s3.json));

/* 10. 重新验证后又可以玩一次 */
const ok2 = await session(PWD);
const e4 = await entry();
step('重新输入密码后可再次进场（额度继续累计，不清零）',
  ok2.json?.authorized === true && e4.json?.allowed === true && Number(e4.json?.used_seconds) > 0,
  brief(e4.json) + ' | session=' + brief(ok2.json));

const s4 = await startFresh();
step('重新验证后可以创建全新会话（新标识与上一次不同）',
  s4.json?.allowed === true && s4.json?.override_consumed === true
  && s4.json?.session_id !== s1.json?.session_id, brief(s4.json));

const passed = steps.filter(s => s.ok).length;
const failed = steps.length - passed;
// 收尾：把本次走查开的会话关掉，避免残留 active 影响后续用例
await stop();
const outDir = path.join(process.cwd(), 'tests', 'artifacts');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'acceptance-walkthrough.json'), JSON.stringify({
  site: SITE, gateway: BASE, family: FAMILY, device: DEVICE, account: ACCOUNT,
  prepared_state: '当天学习尚未完成（plan published=false），用于验证"只有家长授权能进场"',
  started_at: new Date().toISOString(),
  passed, failed, steps,
}, null, 2));
console.log(`\nacceptance-walkthrough: ${passed} passed / ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
