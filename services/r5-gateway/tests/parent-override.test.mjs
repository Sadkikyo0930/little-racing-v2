#!/usr/bin/env node
/**
 * R5 家长免学习快捷授权 · 真云隔离测试（r5-selftest-family）
 *
 * 只用环境变量里现成的家长口令（从本地口令文件读取，绝不打印、绝不写入日志）。
 * 全部请求指向线上 CloudBase 网关，正式家庭 little-growth-family-001 零写入。
 *
 * 用法：
 *   node tests/parent-override.test.mjs phase-a
 *   node tests/parent-override.test.mjs phase-b
 *   node tests/parent-override.test.mjs phase-c
 *   node tests/parent-override.test.mjs phase-d
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const BASE = process.env.R5_BASE || 'https://normal-goose-d5g4qyzr8bb389a4a.service.tcloudbase.com/r5';
const FAMILY = 'r5-selftest-family';
const SECRET_FILE = process.env.R5_PARENT_SECRET_FILE
  || 'C:/Users/Administrator/WorkBuddy/2026-11-08-13-47-44/.r5-local/parent_secret.txt';

const DEV = {
  accept: 'r5dev_parent_accept_01',
  revoke: 'r5dev_parent_revoke_01',
  ttl: 'r5dev_parent_ttl_01',
  quota: 'r5dev_parent_quota_01',
  forge: 'r5dev_parent_forge_01',
  study: 'r5dev_parent_selftest_01',
};

const phase = process.argv[2] || 'phase-a';
const results = [];
const log = [];
const t0 = Date.now();

function say(line) { log.push(line); console.log(line); }

function secret() {
  if (!existsSync(SECRET_FILE)) throw new Error('missing parent secret file: ' + SECRET_FILE);
  const s = readFileSync(SECRET_FILE, 'utf8').trim();
  if (s.length < 8) throw new Error('parent secret file looks empty');
  return s;
}

async function post(path, body, extraHeaders = {}, useAuth = false) {
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', ...extraHeaders };
  if (useAuth) headers['x-r5-parent'] = secret();
  const res = await fetch(BASE + path, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep null */ }
  return { status: res.status, json, text };
}

function check(name, cond, detail) {
  const ok = !!cond;
  results.push({ name, ok, detail });
  say(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`);
  return ok;
}

function sha(v) { return createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16); }

async function phaseA() {
  say(`# phase-a @ ${BASE} family=${FAMILY}`);

  const health = await fetch(BASE + '/health').then(r => r.json());
  check('A0 网关版本含家长快捷授权', health.parent_override_endpoint === true,
    `version=${health.version} md_families=${JSON.stringify(health.game_engines?.md_families)}`);

  const dev = await post('/v1/parent/devices', { family_id: FAMILY }, {}, true);
  const devList = dev.json?.devices?.devices || dev.json?.devices;
  check('A1 复用现有家长口令可通过服务端验证', dev.status === 200 && Array.isArray(devList),
    `status=${dev.status} devices=${Array.isArray(devList) ? devList.length : 'n/a'}`);

  // 1) 正确口令 → 成功签发短时授权
  const grant = await post('/v1/parent/game-override',
    { family_id: FAMILY, device: DEV.accept, action: 'grant' }, {}, true);
  const g = grant.json || {};
  check('A2 正确口令签发家长授权', grant.status === 200 && g.api === 'r5_parent_game_override'
    && g.authorized === true && Number(g.remaining_seconds) > 0 && typeof g.expires_at === 'string',
    `status=${grant.status} authorized=${g.authorized} remaining=${g.remaining_seconds} expires_at=${g.expires_at} ttl=${g.ttl_seconds}`);

  const ttlOk = g.expires_at ? (new Date(g.expires_at).getTime() - Date.now()) / 1000 : -1;
  check('A3 授权有效期不超过 5 分钟', ttlOk > 0 && ttlOk <= 305, `剩余约 ${ttlOk.toFixed(0)} 秒`);

  // 5) 额度查询（服务端只读）
  const statusWithOverride = await post('/v1/child/entry', { family_id: FAMILY }, { 'x-r5-device': DEV.accept });
  check('A4 被授权设备 child/entry 放行且标注家长授权', statusWithOverride.status === 200
    && statusWithOverride.json?.allowed === true && statusWithOverride.json?.parent_override === true,
    `allowed=${statusWithOverride.json?.allowed} reason=${statusWithOverride.json?.reason} remaining=${statusWithOverride.json?.remaining_seconds}`);

  // 8) 未授权设备仍然按学习规则拒绝
  const statusNoOverride = await post('/v1/child/entry', { family_id: FAMILY }, { 'x-r5-device': DEV.study });
  check('A5 未被授权设备仍按学习规则拒绝', statusNoOverride.json?.allowed === false
    && statusNoOverride.json?.parent_override === false,
    `allowed=${statusNoOverride.json?.allowed} reason=${statusNoOverride.json?.reason}`);

  // 6) 伪造授权字段：服务端完全忽略请求体
  const forged = await post('/v1/child/entry',
    { family_id: FAMILY, allowed: true, authorized: true, parent_override: true, remaining_seconds: 9999 },
    { 'x-r5-device': DEV.forge });
  check('A6 请求体伪造 authorized/allowed 无效（fail-closed）', forged.json?.allowed === false,
    `allowed=${forged.json?.allowed} reason=${forged.json?.reason}`);

  // 2) 错误口令
  const bad = await post('/v1/parent/game-override',
    { family_id: FAMILY, device: DEV.accept, action: 'grant' },
    { 'x-r5-parent': 'definitely-wrong-' + Date.now() });
  check('A7 错误口令被拒绝（401）', bad.status === 401 && bad.json?.error === 'R5_PARENT_AUTH_FAILED',
    `status=${bad.status} error=${bad.json?.error}`);

  // 缺少口令
  const none = await post('/v1/parent/game-override', { family_id: FAMILY, device: DEV.accept, action: 'grant' });
  check('A8 缺少家长口令被拒绝（401）', none.status === 401, `status=${none.status} error=${none.json?.error}`);

  // 3a) 未绑定设备
  const unbound = await post('/v1/parent/game-override',
    { family_id: FAMILY, device: 'r5dev_not_bound_zzz01', action: 'grant' }, {}, true);
  check('A9 未绑定设备被拒绝（403）', unbound.status === 403 && unbound.json?.error === 'R5_DEVICE_NOT_BOUND',
    `status=${unbound.status} error=${unbound.json?.error}`);

  // 3b) 撤销设备
  const revoke = await post('/v1/parent/revoke', { family_id: FAMILY, device: DEV.revoke }, {}, true);
  const revoked = await post('/v1/parent/game-override',
    { family_id: FAMILY, device: DEV.revoke, action: 'grant' }, {}, true);
  check('A10 已撤销设备被拒绝（403）',
    revoke.status === 200 && revoked.status === 403 && revoked.json?.error === 'R5_DEVICE_REVOKED',
    `revoke=${revoke.status} grant=${revoked.status} error=${revoked.json?.error}`);

  // 非白名单家庭
  const badFamily = await post('/v1/parent/game-override',
    { family_id: 'r5-unknown-family', device: DEV.accept, action: 'grant' }, {}, true);
  check('A11 非白名单家庭被拒绝', badFamily.status === 403, `status=${badFamily.status} error=${badFamily.json?.error}`);

  // 5) 计时：start → tick → stop（时间照旧扣减，授权不重置额度）
  const started = await post('/v1/game/action', { family_id: FAMILY, action: 'start' }, { 'x-r5-device': DEV.accept });
  const sStart = started.json || {};
  check('A12 授权设备 start 成功并开始计时', started.status === 200 && sStart.active === true
    && sStart.allowed === true, `active=${sStart.active} engine=${sStart.engine} remaining=${sStart.remaining_seconds}`);

  await new Promise(r => setTimeout(r, 6000));
  const ticked = await post('/v1/game/action', { family_id: FAMILY, action: 'tick' }, { 'x-r5-device': DEV.accept });
  const sTick = ticked.json || {};
  const usedGrew = Number(sTick.used_seconds) > Number(sStart.used_seconds || 0);
  const remainShrunk = Number(sTick.remaining_seconds) < Number(sStart.remaining_seconds);
  check('A13 心跳照旧扣减每日 1800 秒', usedGrew && remainShrunk && Number(sTick.remaining_seconds) <= 1800,
    `used ${sStart.used_seconds}->${sTick.used_seconds} remaining ${sStart.remaining_seconds}->${sTick.remaining_seconds} charged_ms=${sTick.charged_ms}`);

  // 6) 刷新页面 / 重放：重复 start 不恢复额度
  const again = await post('/v1/game/action', { family_id: FAMILY, action: 'start' }, { 'x-r5-device': DEV.accept });
  const sAgain = again.json || {};
  check('A14 重复 start（模拟刷新/重放）不会恢复额度', Number(sAgain.remaining_seconds) <= Number(sTick.remaining_seconds)
    && Number(sAgain.remaining_seconds) <= 1800,
    `remaining=${sAgain.remaining_seconds}`);

  const stopped = await post('/v1/game/action', { family_id: FAMILY, action: 'stop' }, { 'x-r5-device': DEV.accept });
  check('A15 stop 正常结束会话', stopped.status === 200 && stopped.json?.action === 'stop',
    `status=${stopped.status} active=${stopped.json?.active} used=${stopped.json?.used_seconds}`);

  // 2) 第二台设备（未授权）不能借第一台的授权进入
  const otherStart = await post('/v1/game/action', { family_id: FAMILY, action: 'start' }, { 'x-r5-device': DEV.study });
  check('A16 授权不跨设备（另一台设备仍被拒绝）', otherStart.json?.allowed === false
    && otherStart.json?.active === false, `allowed=${otherStart.json?.allowed} reason=${otherStart.json?.reason}`);

  return { secret_sha256_prefix: sha(secret()), family: FAMILY };
}

async function phaseB() {
  // 需要先由 phase-a 之外单独签发 ttl 设备授权，再把它改成过期（SQL 由调用方完成）
  say(`# phase-b 过期授权验证 @ ${BASE}`);
  const st = await post('/v1/child/entry', { family_id: FAMILY }, { 'x-r5-device': DEV.ttl });
  check('B1 授权过期后 child/entry 拒绝放行', st.json?.allowed === false
    && st.json?.parent_override === false,
    `allowed=${st.json?.allowed} reason=${st.json?.reason} parent_override=${st.json?.parent_override}`);

  const start = await post('/v1/game/action', { family_id: FAMILY, action: 'start' }, { 'x-r5-device': DEV.ttl });
  check('B2 授权过期后无法开始游戏', start.json?.allowed === false && start.json?.active === false,
    `allowed=${start.json?.allowed} active=${start.json?.active} reason=${start.json?.reason}`);
  return null;
}

async function phaseC() {
  say(`# phase-c 额度用尽 @ ${BASE}`);
  const grant = await post('/v1/parent/game-override',
    { family_id: FAMILY, device: DEV.quota, action: 'grant' }, {}, true);
  check('C1 每日 1800 秒用完后拒绝签发授权', grant.status === 403
    && grant.json?.error === 'TIME_LIMIT_REACHED',
    `status=${grant.status} error=${grant.json?.error}`);

  const st = await post('/v1/child/entry', { family_id: FAMILY }, { 'x-r5-device': DEV.quota });
  check('C2 额度用尽时 child/entry 返回 TIME_LIMIT_REACHED', st.json?.allowed === false
    && st.json?.reason === 'TIME_LIMIT_REACHED',
    `allowed=${st.json?.allowed} reason=${st.json?.reason} remaining=${st.json?.remaining_seconds}`);

  const start = await post('/v1/game/action', { family_id: FAMILY, action: 'start' }, { 'x-r5-device': DEV.quota });
  check('C3 额度用尽时无法开始游戏', start.json?.allowed === false && start.json?.active === false,
    `allowed=${start.json?.allowed} active=${start.json?.active}`);
  return null;
}

async function phaseD() {
  say(`# phase-d 正常流程与线上资源巡检 @ ${BASE}`);

  // 授权在上次 start 时已被一次性消费，会话期间仍应保持放行（绑定到本次会话）
  const bound = await post('/v1/child/entry', { family_id: FAMILY }, { 'x-r5-device': DEV.accept });
  check('D0 授权消费后已开始的会话仍可继续（额度不恢复）',
    bound.json?.parent_override === true && Number(bound.json?.remaining_seconds) <= 1800,
    `parent_override=${bound.json?.parent_override} remaining=${bound.json?.remaining_seconds}`);

  const st = await post('/v1/child/entry', { family_id: FAMILY }, { 'x-r5-device': DEV.study });
  check('D1 未授权设备仍走原学习通行证判定（未被削弱）', st.json?.allowed === false,
    `allowed=${st.json?.allowed} reason=${st.json?.reason} modules=${JSON.stringify(st.json?.modules)}`);

  const save = await post('/v1/racing/save/get', {}, { 'x-r5-device': DEV.study });
  check('D2 家庭存档接口正常（测试家庭）', save.json?.api === 'r5_racing_save' && save.json?.status === 'OK',
    `status=${save.status} api=${save.json?.api} state=${save.json?.status}`);

  const site = await fetch('https://normal-goose-d5g4qyzr8bb389a4a-1526110019.tcloudbaseapp.com/');
  const html = await site.text();
  const markers = ['六星', 'storyBtn2', '雷霆', 'cam3'];
  const found = markers.filter(m => html.includes(m) || html.includes(m.toLowerCase()));
  check('D3 正式站点可访问（未改动主站）', site.status === 200 && html.length > 1000,
    `status=${site.status} bytes=${html.length} markers=${JSON.stringify(found)}`);
  return null;
}

async function phaseE() {
  say(`# phase-e 网络异常 / 端点不可用 fail-closed @ ${BASE}`);
  const body = { family_id: FAMILY, device: DEV.accept, action: 'grant' };
  const H = { 'content-type': 'application/json', 'x-r5-parent': secret() };

  // 前端只在 HTTP 200 + api=r5_parent_game_override + authorized 才有下一步动作
  const accept = (status, json) => status === 200 && json?.api === 'r5_parent_game_override'
    && json?.authorized === true && Number(json?.remaining_seconds) > 0;

  const missing = await fetch(BASE + '/v1/parent/game-override-typo', {
    method: 'POST', headers: H, body: JSON.stringify(body),
  }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) }));
  check('E1 端点不存在时前端拒绝进入（404 且无 api 标记）',
    !accept(missing.status, missing.json),
    `status=${missing.status} error=${missing.json?.error} accept=${accept(missing.status, missing.json)}`);

  const wrongHost = await fetch(BASE + '-offline/v1/parent/game-override', {
    method: 'POST', headers: H, body: JSON.stringify(body),
  }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) }));
  check('E2 域名/路径错误时前端拒绝进入（非 200 或非 JSON）',
    !accept(wrongHost.status, wrongHost.json),
    `status=${wrongHost.status} accept=${accept(wrongHost.status, wrongHost.json)}`);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1);
  let aborted = false;
  try {
    await fetch(BASE + '/v1/parent/game-override', {
      method: 'POST', headers: H, body: JSON.stringify(body), signal: ctrl.signal,
    });
  } catch (e) {
    aborted = (e && e.name) === 'AbortError';
  } finally {
    clearTimeout(timer);
  }
  check('E3 请求超时/中断时前端抛错且不进入游戏', aborted, `aborted=${aborted}`);

  // 服务端 5xx 分支：用一条必然触发网关内部错误的请求验证不会返回 authorized
  const bad = await fetch(BASE + '/v1/parent/game-override', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-r5-parent': secret() },
    body: '{not-json',
  }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) }));
  check('E4 非法请求体不会产生授权', !accept(bad.status, bad.json),
    `status=${bad.status} authorized=${bad.json?.authorized}`);
  return null;
}

const runners = { 'phase-a': phaseA, 'phase-b': phaseB, 'phase-c': phaseC, 'phase-d': phaseD, 'phase-e': phaseE };
if (!runners[phase]) {
  console.error('unknown phase: ' + phase);
  process.exit(2);
}

try {
  const extra = await runners[phase]();
  const summary = {
    phase, base: BASE, family: FAMILY,
    started_at: new Date(t0).toISOString(),
    duration_ms: Date.now() - t0,
    passed: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    results, extra,
  };
  const outPath = `tests/artifacts/${phase}.json`;
  try {
    writeFileSync(outPath, JSON.stringify(summary, null, 2));
    say(`\n# summary ${summary.passed}/${results.length} passed -> ${outPath}`);
  } catch {
    say(`\n# summary ${summary.passed}/${results.length} passed (artifacts dir missing)`);
  }
  process.exit(summary.failed ? 1 : 0);
} catch (e) {
  console.error('FATAL', e && e.message);
  process.exit(3);
}
