/**
 * tests/link-verify.test.mjs — 家长入口前端 ↔ CloudBase 网关「真实联通」验证
 *
 * 复刻 docs/gate.html 的 $('parent-entry-form').submit：
 *   POST  {base}/v1/parent/session
 *   body  {family_id, device, account, password}
 * 并带 Origin 头，模拟从静态托管域名发起的跨域请求。
 *
 * 与旧版的区别（旧版已废弃）：不再使用任何共享口令 / x-r5-parent /
 * /v1/parent/game-override。账号密码来自本机 .local/test-accounts.json，
 * 只在内存使用，不打印、不落盘、不写进交付物。
 *
 * 用法：node tests/link-verify.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://normal-goose-d5g4qyzr8bb389a4a.service.tcloudbase.com/r5';
const ORIGIN = 'https://normal-goose-d5g4qyzr8bb389a4a-1526110019.tcloudbaseapp.com';
const SITE = ORIGIN + '/r5-accept';
const FAMILY = 'r5-selftest-family';
const DEVICE = 'r5dev_parent_accept_01';
const ACCOUNT = 'r5test_dad';

/* ---------- 凭据（仅本机；找不到就跳过正向用例，不 fail 整轮） ---------- */

function readCreds() {
  const out = {};
  const candidates = [
    path.join(process.cwd(), '.local', 'test-accounts.json'),
    'C:/Users/Administrator/WorkBuddy/2026-11-08-13-47-44/.r5-local/test-account.txt',
  ];
  try {
    const j = JSON.parse(fs.readFileSync(candidates[0], 'utf8'));
    for (const a of j.accounts || []) out[a.account] = a.password;
  } catch { /* ignore */ }
  try {
    const raw = fs.readFileSync(candidates[1], 'utf8');
    const g = k => { const m = raw.match(new RegExp('^' + k + '\\s*[:=]\\s*(.+)$', 'm')); return m ? m[1].trim() : ''; };
    if (g('USERNAME') && g('PASSWORD')) out[g('USERNAME')] = g('PASSWORD');
  } catch { /* ignore */ }
  return out;
}

const CREDS = readCreds();
const PWD = CREDS[ACCOUNT] || '';

const results = [];
const log = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  | ${detail}`);
}
async function timed(fn) {
  const t0 = Date.now();
  const r = await fn();
  return { ...r, ms: Date.now() - t0 };
}

async function main() {
  check('L0 隔离家庭测试账号已就绪（不打印密码）', !!PWD,
    PWD ? `${ACCOUNT} 已从 .local 加载` : '未找到 .local/test-accounts.json，跳过正向用例');

  /* 1) 跨域预检：浏览器发 POST 前先 OPTIONS */
  const pre = await timed(async () => {
    const r = await fetch(`${BASE}/v1/parent/session`, {
      method: 'OPTIONS',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-r5-device,x-r5-session',
      },
    });
    return {
      status: r.status,
      acao: r.headers.get('access-control-allow-origin'),
      acah: r.headers.get('access-control-allow-headers') || '',
    };
  });
  log.push(`OPTIONS /v1/parent/session -> ${pre.status} (${pre.ms}ms)`);
  check('L1 跨域预检放行', pre.status === 204 || pre.status === 200, `status=${pre.status}`);
  check('L2 预检允许 x-r5-device 与 x-r5-session 头',
    pre.acah.includes('x-r5-device') && pre.acah.includes('x-r5-session'), `allow-headers=${pre.acah}`);

  /* 2) 缺密码必须 fail-closed，且不消耗任何额度 */
  const noPwd = await timed(() => fetch(`${BASE}/v1/parent/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ family_id: FAMILY, device: DEVICE, account: ACCOUNT }),
  }).then(async r => ({ status: r.status, acao: r.headers.get('access-control-allow-origin'), json: await r.json().catch(() => null) })));
  log.push(`POST /v1/parent/session (无密码) -> ${noPwd.status} error=${noPwd.json?.error}`);
  check('L3 未带密码被拒绝（fail-closed）',
    noPwd.status === 401 || noPwd.status === 400, `status=${noPwd.status} error=${noPwd.json?.error}`);

  /* 3) 前端同款请求：账号 + 密码 */
  const ok = await timed(() => fetch(`${BASE}/v1/parent/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ family_id: FAMILY, device: DEVICE, account: ACCOUNT, password: PWD }),
  }).then(async r => ({ status: r.status, acao: r.headers.get('access-control-allow-origin'), json: await r.json().catch(() => null) })));

  const j = ok.json || {};
  log.push(`POST /v1/parent/session -> ${ok.status} api=${j.api} authorized=${j.authorized} remaining=${j.remaining_seconds} ttl=${j.ttl_seconds}`);
  check('L4 账号+密码返回 200 且 api=r5_parent_session',
    ok.status === 200 && j.api === 'r5_parent_session', `status=${ok.status} api=${j.api}`);
  check('L5 authorized=true（前端据此才跳转）', j.authorized === true, `authorized=${j.authorized}`);
  check('L6 remaining_seconds>0（前端第二道校验）', Number(j.remaining_seconds) > 0, `remaining=${j.remaining_seconds}`);
  check('L7 一次性票据有效期 <= 120 秒', Number(j.ttl_seconds) <= 120, `ttl=${j.ttl_seconds}`);
  check('L8 响应带跨域头，浏览器可读',
    ok.acao === '*' || ok.acao === ORIGIN, `acao=${ok.acao}`);

  /* 4) 被授权设备在 child/entry 得到放行（游戏守卫真正认的服务端接口） */
  const entry = await timed(() => fetch(`${BASE}/v1/child/entry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-r5-device': DEVICE, origin: ORIGIN },
    body: JSON.stringify({ family_id: FAMILY }),
  }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) })));
  const e = entry.json || {};
  log.push(`POST /v1/child/entry -> ${entry.status} allowed=${e.allowed} reason=${e.reason} parent_override=${e.parent_override}`);
  check('L9 受权设备 child/entry 放行（只跳过学习条件）',
    e.allowed === true && e.parent_override === true, `allowed=${e.allowed} reason=${e.reason}`);

  /* 5) 旧口令端点必须 410，绝不允许静默降级 */
  const legacy = await timed(() => fetch(`${BASE}/v1/parent/game-override`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-r5-parent': 'any-legacy-value', origin: ORIGIN },
    body: JSON.stringify({ family_id: FAMILY, device: DEVICE, action: 'grant' }),
  }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) })));
  log.push(`POST /v1/parent/game-override (legacy) -> ${legacy.status} error=${legacy.json?.error}`);
  check('L10 旧口令端点固定 410 R5_PARENT_SECRET_RETIRED',
    legacy.status === 410 && legacy.json?.error === 'R5_PARENT_SECRET_RETIRED',
    `status=${legacy.status} error=${legacy.json?.error}`);

  /* 6) 网关版本 */
  const health = await fetch(`${BASE}/health`).then(r => r.json()).catch(() => null);
  check('L11 网关版本为 1.5.0-session-bound 且开启会话绑定',
    health?.version === '1.5.0-session-bound' && health?.session_binding === true
    && health?.session_required_for_override === true,
    `version=${health?.version} session_binding=${health?.session_binding} idle=${health?.session_idle_seconds}`);

  /* 7) 验收站点静态资源 */
  for (const p of ['gate.html', 'r5/parent-accounts.mjs', 'r5/r5-online.mjs']) {
    const r = await fetch(`${SITE}/${p}`, { method: 'GET' });
    log.push(`GET ${SITE}/${p} -> ${r.status}`);
    check(`L12 验收站点 ${p} 可访问`, r.status === 200, `status=${r.status}`);
  }

  const gate = await fetch(`${SITE}/gate.html`).then(r => r.text());
  check('L13 线上 gate.html 已是三账号版（无旧口令通道）',
    gate.includes('/v1/parent/session') && !gate.includes('x-r5-parent')
    && !gate.includes('/v1/parent/game-override'),
    `len=${gate.length} session=${gate.includes('/v1/parent/session')}`);

  const cfg = await fetch(`${SITE}/r5/config.mjs`).then(r => r.text());
  check('L14 验收站点家庭为 r5-selftest-family',
    cfg.includes(FAMILY) && !cfg.includes('little-growth-family-001'), 'config 已隔离');

  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;
  const out = {
    suite: 'parent-entry-link',
    base: BASE,
    site: SITE,
    family: FAMILY,
    device: DEVICE,
    account: ACCOUNT,
    ran_at: new Date().toISOString(),
    passed,
    failed,
    request_log: log,
    results,
  };
  fs.mkdirSync('tests/artifacts', { recursive: true });
  fs.writeFileSync(path.join('tests/artifacts', 'link.json'), JSON.stringify(out, null, 2));
  console.log(`\n${passed} passed / ${failed} failed  -> tests/artifacts/link.json`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('LINK TEST ERROR', e && e.message);
  process.exit(1);
});
