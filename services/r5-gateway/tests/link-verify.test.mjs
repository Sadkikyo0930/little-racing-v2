// 家长入口前端 ↔ CloudBase 网关「真实联通」验证
//
// 复刻 docs/gate.html 里 $('parent-entry-form').submit 的请求：
//   POST {base}/v1/parent/game-override
//   headers: content-type: application/json, x-r5-parent: <口令>
//   body:    {family_id, device, action:"grant"}
// 并带 Origin 头，模拟从静态托管域名发起的跨域请求。
//
// 口令来源（按顺序）：
//   1) 环境变量 R5_PARENT_SECRET
//   2) C:/Users/Administrator/WorkBuddy/2026-11-08-13-47-44/.r5-local/parent_secret.txt
// 只在内存使用，不打印、不落盘。
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://normal-goose-d5g4qyzr8bb389a4a.service.tcloudbase.com/r5';
const ORIGIN = 'https://normal-goose-d5g4qyzr8bb389a4a-1526110019.tcloudbaseapp.com';
const SITE = ORIGIN + '/r5-accept';
const FAMILY = 'r5-selftest-family';
const DEVICE = 'r5dev_parent_accept_01';

const SECRET_CANDIDATES = [
  process.env.R5_PARENT_SECRET,
  'C:/Users/Administrator/WorkBuddy/2026-11-08-13-47-44/.r5-local/parent_secret.txt',
];
function loadSecret() {
  for (const c of SECRET_CANDIDATES) {
    if (!c) continue;
    if (c.length > 0 && !c.includes('/') && !c.includes('\\')) return c.trim();
    try {
      const v = fs.readFileSync(c, 'utf8').trim();
      if (v) return v;
    } catch { /* 继续找下一个 */ }
  }
  return null;
}

const results = [];
const log = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  | ${detail}`);
}
async function timed(fn) {
  const t0 = Date.now();
  const r = await fn();
  return { ...r, ms: Date.now() - t0 };
}

async function main() {
  const secret = loadSecret();
  check('L0 家长口令已就绪（不打印内容）', !!secret, secret ? '已从本地安全文件加载' : '未找到口令');

  // 1) 预检：浏览器跨域前先 OPTIONS
  const pre = await timed(async () => {
    const r = await fetch(`${BASE}/v1/parent/game-override`, {
      method: 'OPTIONS',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-r5-parent',
      },
    });
    return { status: r.status, acao: r.headers.get('access-control-allow-origin') };
  });
  log.push(`OPTIONS /v1/parent/game-override -> ${pre.status} (${pre.ms}ms)`);
  check('L1 跨域预检放行', pre.status === 204 || pre.status === 200, `status=${pre.status}`);

  // 2) 按前端完全相同的请求格式签发授权
  const ok = await timed(() => fetch(`${BASE}/v1/parent/game-override`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-r5-parent': secret || '', origin: ORIGIN },
    body: JSON.stringify({ family_id: FAMILY, device: DEVICE, action: 'grant' }),
  }).then(async (r) => ({ status: r.status, acao: r.headers.get('access-control-allow-origin'), json: await r.json().catch(() => null) })));

  const j = ok.json || {};
  log.push(`POST grant -> ${ok.status} api=${j.api} authorized=${j.authorized} remaining=${j.remaining_seconds} ttl=${j.ttl_seconds}`);
  check('L2 前端同款请求返回 200 且 api=r5_parent_game_override', ok.status === 200 && j.api === 'r5_parent_game_override', `status=${ok.status} api=${j.api}`);
  check('L3 authorized=true（前端据此才放行）', j.authorized === true, `authorized=${j.authorized}`);
  check('L4 remaining_seconds>0（前端第二道校验）', Number(j.remaining_seconds) > 0, `remaining=${j.remaining_seconds}`);
  check('L5 授权有效期 <= 300 秒', Number(j.ttl_seconds) <= 300, `ttl=${j.ttl_seconds}`);
  check('L6 响应带跨域头，浏览器可读', ok.acao === '*' || ok.acao === ORIGIN, `acao=${ok.acao}`);

  // 3) 被授权设备在 child/entry 得到放行（游戏守卫真正认的服务端接口）
  const entry = await timed(() => fetch(`${BASE}/v1/child/entry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-r5-device': DEVICE, origin: ORIGIN },
    body: JSON.stringify({ family_id: FAMILY }),
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) })));
  const e = entry.json || {};
  log.push(`POST /v1/child/entry -> ${entry.status} allowed=${e.allowed} reason=${e.reason} parent_override=${e.parent_override}`);
  check('L7 child/entry 放行被授权设备', e.allowed === true, `allowed=${e.allowed} reason=${e.reason}`);
  check('L8 放行原因标注为家长授权', e.parent_override === true || e.reason === 'STUDY_PASSED_WITH_WAIVER', `parent_override=${e.parent_override} reason=${e.reason}`);

  // 4) 错误口令不得签发
  const bad = await timed(() => fetch(`${BASE}/v1/parent/game-override`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-r5-parent': 'definitely-wrong-' + Date.now(), origin: ORIGIN },
    body: JSON.stringify({ family_id: FAMILY, device: DEVICE, action: 'grant' }),
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) })));
  log.push(`POST grant(bad secret) -> ${bad.status} error=${bad.json?.error}`);
  check('L9 错误口令被拒绝', bad.status === 401 || bad.status === 429, `status=${bad.status} error=${bad.json?.error}`);

  // 5) 验收站点静态资源可用
  for (const p of ['gate.html', 'index.html', 'r5/config.mjs', 'r5/grant.mjs']) {
    const r = await fetch(`${SITE}/${p}`, { method: 'GET' });
    log.push(`GET ${SITE}/${p} -> ${r.status}`);
    check(`L10 验收站点 ${p} 可访问`, r.status === 200, `status=${r.status}`);
  }
  const cfg = await fetch(`${SITE}/r5/config.mjs`).then((r) => r.text());
  check('L11 验收站点家庭为 r5-selftest-family', cfg.includes(FAMILY) && !cfg.includes('little-growth-family-001'), 'config 已隔离');

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  const out = {
    suite: 'parent-override-link',
    base: BASE,
    site: SITE,
    family: FAMILY,
    device: DEVICE,
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
