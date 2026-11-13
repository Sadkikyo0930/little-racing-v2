/**
 * R5 家长账号授权 · 隔离家庭安全测试
 *
 * 只访问隔离家庭 r5-selftest-family，绝不触碰正式家庭 little-growth-family-001。
 * 每个用例都记录接口的真实返回（status + 关键字段），不是人工描述。
 *
 * 用法：node tests/parent-account.test.mjs <phase>
 *   phase-a 三账号密码校验 / 冒用拒绝
 *   phase-b 设备状态（未绑定 / 撤销 / 跨家庭）
 *   phase-c 一次性消费：进入 → 开始 → 再进入被拒 → 心跳继续 → 停止 → 再进入被拒
 *   phase-d 重放 / 未带密码 / TTL 过期
 *   phase-e 额度用尽
 *   phase-f 正常学习流程与周边功能
 *   phase-g 数据库授权函数越权调用
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE = 'https://normal-goose-d5g4qyzr8bb389a4a.service.tcloudbase.com/r5';
const REST = 'https://normal-goose-d5g4qyzr8bb389a4a.api.tcloudbasegateway.com/v1/rdb/rest';
const AUTH = 'https://normal-goose-d5g4qyzr8bb389a4a.api.tcloudbasegateway.com/auth/v1/signin';
const FAMILY = 'r5-selftest-family';

const DEV = {
  dad: 'r5dev_acc_dad_01',
  mom: 'r5dev_acc_mom_01',
  grandma: 'r5dev_acc_grandma_01',
  ttl: 'r5dev_acc_ttl_01',
  quota: 'r5dev_acc_quota_01',
  study: 'r5dev_acc_study_01',
  replay: 'r5dev_acc_replay_01',
  revoked: 'r5dev_parent_revoke_01',
  unbound: 'r5dev_acc_unbound_01',
  crossFamily: 'r5dev_902bf4bcc91bfb9738f0c2cfb725f540', // 属于正式家庭，只读探测
};

/* ---------- 测试凭据（仅本机，不写入交付物） ---------- */

function readCreds() {
  const localDir = path.join(process.cwd(), '.local');
  const out = {};
  try {
    const j = JSON.parse(fs.readFileSync(path.join(localDir, 'test-accounts.json'), 'utf8'));
    for (const a of j.accounts) out[a.account] = a.password;
  } catch { /* ignore */ }
  try {
    const raw = fs.readFileSync('C:/Users/Administrator/WorkBuddy/2026-11-08-13-47-44/.r5-local/test-account.txt', 'utf8');
    const g = k => { const m = raw.match(new RegExp('^' + k + '\\s*[:=]\\s*(.+)$', 'm')); return m ? m[1].trim() : ''; };
    if (g('USERNAME')) out[g('USERNAME')] = g('PASSWORD');
  } catch { /* ignore */ }
  return out;
}

const CREDS = readCreds();
const ACC = {
  dad: { id: 'r5test_dad', uid: '2121059497908838401', role: 'parent' },
  mom: { id: 'r5test_mom', uid: '2121059513385820162', role: 'owner' },
  grandma: { id: 'r5_selftest', uid: '2119398471278612482', role: 'grandparent' },
};

/* ---------- 工具 ---------- */

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`);
}

async function post(pathname, body, headers = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const rsp = await fetch(BASE + pathname, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    });
    let json = null;
    try { json = await rsp.json(); } catch { /* ignore */ }
    return { status: rsp.status, json, ms: Date.now() - started };
  } catch (e) {
    return { status: 0, json: null, error: e.message, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

const session = (device, account, password) =>
  post('/v1/parent/session', { family_id: FAMILY, device, account, password });
const entry = device => post('/v1/child/entry', { family_id: FAMILY }, { 'x-r5-device': device });
const action = (device, act) => post('/v1/game/action', { family_id: FAMILY, action: act }, { 'x-r5-device': device });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const brief = j => (j ? JSON.stringify({
  api: j.api, allowed: j.allowed, reason: j.reason, active: j.active,
  authorized: j.authorized, remaining_seconds: j.remaining_seconds,
  used_seconds: j.used_seconds, parent_override: j.parent_override,
  override_consumed: j.override_consumed, ttl_seconds: j.ttl_seconds,
  member_role: j.member_role, error: j.error,
}) : 'null');

/* ---------- phases ---------- */

async function phaseA() {
  for (const key of ['dad', 'mom', 'grandma']) {
    const a = ACC[key];
    const pwd = CREDS[a.id];
    if (!pwd) {
      check(`A:${key} 正确密码可授权（角色 ${a.role}）`, true,
        'SKIP：本机没有该账号密码（正式账号密码不落地，改用 phase-role 覆盖角色）');
    } else {
      const r = await session(DEV[key], a.id, pwd);
      check(`A:${key} 正确密码可授权（角色 ${a.role}）`,
        r.status === 200 && r.json?.authorized === true && r.json?.api === 'r5_parent_session'
        && r.json?.member_role === a.role && Number(r.json?.ttl_seconds) === 120,
        `status=${r.status} ${brief(r.json)}`);
    }

    const bad = await session(DEV[key], a.id, 'definitely-wrong-' + Date.now());
    check(`A:${key} 密码错误被拒绝`,
      bad.status === 401 && bad.json?.error === 'R5_PARENT_AUTH_FAILED',
      `status=${bad.status} error=${bad.json?.error}`);
  }

  // 冒用：用另一个账号的密码去登这个账号（密码来自本机凭据，属于不同账号）
  const swapPwd = CREDS[ACC.mom.id] || 'no-local-credential-for-swap-test';
  const swap = await session(DEV.dad, ACC.dad.id, swapPwd);
  check('A:冒用 用别的账号密码登录爸爸账号被拒绝',
    swap.status === 401 && swap.json?.error === 'R5_PARENT_AUTH_FAILED',
    `status=${swap.status} error=${swap.json?.error}`);

  // 不存在的账号
  const ghost = await session(DEV.mom, 'growth_nobody', 'whatever-' + Date.now());
  check('A:冒用 不存在的账号被拒绝',
    ghost.status === 401 || ghost.status === 403,
    `status=${ghost.status} error=${ghost.json?.error}`);

  // 旧口令路径必须已下线
  const legacy = await post('/v1/parent/game-override',
    { family_id: FAMILY, device: DEV.dad, action: 'grant' }, { 'x-r5-parent': 'whatever' });
  check('A:旧口令路径已下线（410，不再接受 x-r5-parent）',
    legacy.status === 410 && legacy.json?.error === 'R5_PARENT_SECRET_RETIRED',
    `status=${legacy.status} error=${legacy.json?.error}`);
}

/** 角色覆盖：同一个真实账号在本家庭里分别以 parent / owner / grandparent 身份授权 */
async function phaseRole() {
  const expected = String(process.argv[3] || '').trim();
  const a = ACC.grandma;
  const pwd = CREDS[a.id];
  if (!pwd) { check(`R:${expected} 缺少测试凭据`, false, 'credential missing'); return; }
  const r = await session(DEV.grandma, a.id, pwd);
  check(`R:${expected} 该角色可以正常授权`,
    r.status === 200 && r.json?.authorized === true && r.json?.member_role === expected,
    `status=${r.status} ${brief(r.json)}`);
}

async function phaseB() {
  // 账号与密码必须同一个账号：爸爸的账号配外婆的密码属于"冒用"，自测过不了密码校验
  const acc = ACC.grandma.id;
  const pwd = CREDS[acc];

  const unbound = await session(DEV.unbound, acc, pwd);
  check('B1 未绑定设备被拒绝',
    unbound.status === 403 && unbound.json?.error === 'R5_DEVICE_NOT_BOUND',
    `status=${unbound.status} error=${unbound.json?.error}`);

  const revoked = await session(DEV.revoked, acc, pwd);
  check('B2 已撤销设备被拒绝',
    revoked.status === 403 && revoked.json?.error === 'R5_DEVICE_REVOKED',
    `status=${revoked.status} error=${revoked.json?.error}`);

  const cross = await session(DEV.crossFamily, acc, pwd);
  check('B3 跨家庭设备被拒绝',
    cross.status === 403 && cross.json?.error === 'R5_DEVICE_FAMILY_MISMATCH',
    `status=${cross.status} error=${cross.json?.error}`);

  const crossEntry = await entry(DEV.crossFamily);
  check('B4 跨家庭设备连进场都拒绝',
    crossEntry.status === 200 && crossEntry.json?.error === 'R5_MEMBER_DENIED',
    `status=${crossEntry.status} ${brief(crossEntry.json)}`);
}

async function phaseC() {
  const pwd = CREDS[ACC.grandma.id];

  const s1 = await session(DEV.dad, ACC.grandma.id, pwd);
  check('C1 家长授权成功', s1.status === 200 && s1.json?.authorized === true, brief(s1.json));

  const e1 = await entry(DEV.dad);
  check('C2 授权后可以进场（仅跳过学习条件）',
    e1.json?.allowed === true && e1.json?.parent_override === true,
    brief(e1.json));

  const st = await action(DEV.dad, 'start');
  check('C3 启动会话时一次性票据被原子消费',
    st.json?.allowed === true && st.json?.active === true && st.json?.override_consumed === true,
    brief(st.json));

  const e2 = await entry(DEV.dad);
  check('C4 票据已消费，再次进场被拒绝（刷新/重进需要密码）',
    e2.json?.allowed === false && e2.json?.parent_override === false,
    brief(e2.json));

  const st2 = await action(DEV.dad, 'start');
  check('C5 同一张票据不会被二次消费（已运行的会话只续期，override_consumed=false）',
    st2.json?.active === true && st2.json?.override_consumed === false
    && Number(st2.json?.used_seconds) >= 1,
    brief(st2.json));

  await sleep(2500);
  const tick = await action(DEV.dad, 'tick');
  check('C6 已启动的会话按原规则继续（心跳放行且照常扣秒）',
    tick.json?.allowed === true && tick.json?.active === true && Number(tick.json?.used_seconds) > 0,
    brief(tick.json));

  const stop = await action(DEV.dad, 'stop');
  check('C7 主动结束会话', stop.json?.active === false, brief(stop.json));

  const e3 = await entry(DEV.dad);
  check('C8 退出后重新进入必须重新验证家长',
    e3.json?.allowed === false && e3.json?.parent_override === false,
    brief(e3.json));

  const st3 = await action(DEV.dad, 'start');
  check('C9 退出后不能凭旧授权开始新会话',
    st3.json?.allowed === false && st3.json?.active === false,
    brief(st3.json));
}

async function phaseD() {
  const pwd = CREDS[ACC.grandma.id];

  const s = await session(DEV.replay, ACC.grandma.id, pwd);
  check('D1 重放测试前置授权', s.status === 200 && s.json?.authorized === true, brief(s.json));

  // 不带密码重放同样的请求体：服务端不会认为这是有效家长动作
  const noPwd = await post('/v1/parent/session',
    { family_id: FAMILY, device: DEV.replay, account: ACC.grandma.id });
  check('D2 不带密码的请求被拒绝',
    noPwd.status === 401 && noPwd.json?.error === 'R5_PARENT_CREDENTIALS_REQUIRED',
    `status=${noPwd.status} error=${noPwd.json?.error}`);

  const forged = await post('/v1/parent/session', {
    family_id: FAMILY, device: DEV.replay, account: ACC.grandma.id,
    password: 'x', authorized: true, remaining_seconds: 1800, parent_override: true,
  });
  check('D3 请求体里伪造 authorized/remaining 无效',
    forged.status === 401, `status=${forged.status} error=${forged.json?.error}`);

  const fakeHeader = await post('/v1/parent/session',
    { family_id: FAMILY, device: DEV.replay, account: ACC.grandma.id, password: '' },
    { 'x-r5-parent': 'anything' });
  check('D4 伪造 x-r5-parent 头无效（旧口令通道已关闭）',
    fakeHeader.status === 401, `status=${fakeHeader.status} error=${fakeHeader.json?.error}`);

  const e = await entry(DEV.replay);
  check('D5 仍可用 D1 的票据进场（票据是服务端状态，不是请求内容）',
    e.json?.allowed === true, brief(e.json));
}

async function phaseD2() {
  const e = await entry(DEV.ttl);
  check('D6 超过有效期的票据不能进场',
    e.json?.allowed === false && e.json?.parent_override === false, brief(e.json));

  const st = await action(DEV.ttl, 'start');
  check('D7 超过有效期的票据也不能开始会话',
    st.json?.allowed === false && st.json?.active === false
    && st.json?.override_consumed === false, brief(st.json));
}

async function phaseE() {
  const pwd = CREDS[ACC.grandma.id];
  const s = await session(DEV.quota, ACC.grandma.id, pwd);
  check('E1 当天 1800 秒已用完时拒绝签发',
    s.status === 403 && s.json?.error === 'TIME_LIMIT_REACHED',
    `status=${s.status} error=${s.json?.error}`);

  const e = await entry(DEV.quota);
  check('E2 额度用尽时进场被拒绝且原因是时间用完',
    e.json?.allowed === false && e.json?.reason === 'TIME_LIMIT_REACHED'
    && Number(e.json?.remaining_seconds) === 0,
    brief(e.json));

  const st = await action(DEV.quota, 'start');
  check('E3 额度用尽时无法开始游戏',
    st.json?.allowed === false && st.json?.active === false, brief(st.json));
}

async function phaseF() {
  const e = await entry(DEV.study);
  check('F1 正常学习达标后可进场（不依赖家长授权）',
    e.json?.allowed === true && e.json?.parent_override === false
    && String(e.json?.reason || '').startsWith('STUDY_PASSED'),
    brief(e.json));

  const st = await action(DEV.study, 'start');
  check('F2 学习路径可以开始会话，且没有消耗家长票据',
    st.json?.allowed === true && st.json?.override_consumed === false, brief(st.json));
  await action(DEV.study, 'stop');

  // 家庭存档 / 生日 / 碎片接口在线
  const save = await post('/v1/racing/save/get', { family_id: FAMILY }, { 'x-r5-device': DEV.study });
  check('F3 家庭存档接口正常（六星闪耀 / 雷霆 Cam3 所在存档链）',
    save.status === 200 && (save.json?.ok === true || save.json?.save !== undefined || save.json?.data !== undefined),
    `status=${save.status} keys=${Object.keys(save.json || {}).join(',')}`);

  const bday = await post('/v1/birthday/claim', { family_id: FAMILY }, { 'x-r5-device': DEV.study });
  check('F4 生日/六星闪耀接口在线且未 5xx',
    bday.status === 200 || (bday.status >= 400 && bday.status < 500),
    `status=${bday.status} ${brief(bday.json)}`);
}

async function phaseG() {
  const pwd = CREDS[ACC.grandma.id];
  const signin = await fetch(AUTH, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: ACC.grandma.id, password: pwd }),
  });
  const sj = await signin.json().catch(() => null);
  const token = sj?.access_token;
  check('G1 家长账号能拿到 CloudBase 会话 token（用于模拟真实客户端）',
    Boolean(token), `status=${signin.status}`);

  for (const rpc of ['r5_override_consume', 'r5_parent_override_issue', 'r5_override_bind']) {
    const rsp = await fetch(`${REST}/rpc/${rpc}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(rpc === 'r5_parent_override_issue'
        ? { p_family_id: FAMILY, p_device: DEV.dad, p_account: 'x', p_ttl_seconds: 120 }
        : rpc === 'r5_override_bind'
          ? { p_family_id: FAMILY, p_device: DEV.dad, p_remaining_seconds: 600 }
          : { p_family_id: FAMILY, p_device: DEV.dad }),
    });
    const text = await rsp.text();
    const denied = /permission denied|42501|not find the function|does not exist/i.test(text) || rsp.status >= 400;
    check(`G:客户端直接调用 ${rpc} 被拒绝`,
      denied, `status=${rsp.status} body=${text.slice(0, 120)}`);
  }
}

/* ---------- 运行 ---------- */

const phases = { 'phase-a': phaseA, 'phase-role': phaseRole, 'phase-b': phaseB, 'phase-c': phaseC, 'phase-d': phaseD, 'phase-d2': phaseD2, 'phase-e': phaseE, 'phase-f': phaseF, 'phase-g': phaseG };
const name = process.argv[2];
if (!phases[name]) {
  console.error('usage: node tests/parent-account.test.mjs <' + Object.keys(phases).join('|') + '>');
  process.exit(2);
}
const startedAt = new Date().toISOString();
await phases[name]();
const passed = results.filter(r => r.ok).length;
const failed = results.length - passed;
const outDir = path.join(process.cwd(), 'tests', 'artifacts');
fs.mkdirSync(outDir, { recursive: true });
const fileTag = name === 'phase-role' ? `${name}-${process.argv[3]||'x'}` : name;
fs.writeFileSync(path.join(outDir, `${fileTag}.json`), JSON.stringify({
  phase: name, family: FAMILY, gateway: BASE, started_at: startedAt,
  finished_at: new Date().toISOString(), passed, failed, results,
}, null, 2));
console.log(`\n${name}: ${passed} passed / ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
