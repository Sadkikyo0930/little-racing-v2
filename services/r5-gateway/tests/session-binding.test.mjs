/**
 * R5 会话绑定专项测试（v1.5.0-session-bound）
 *
 * 针对上一轮 C5 暴露的问题：家长票据被消费后，再次 start 仍返回 allowed:true。
 * 这里逐条验证「一次授权只能创建一个游戏会话」，包括：
 *   重复 start / 刷新（无标识） / 断线恢复 / 断线超时 / 会话重放 /
 *   多设备并发 / 额度上限 / 正常学习路径。
 *
 * 只访问隔离家庭 r5-selftest-family，绝不触碰正式家庭 little-growth-family-001。
 * 每个用例写的是接口真实返回，不是人工描述。
 *
 * 用法：node tests/session-binding.test.mjs <phase>
 *   phase-h1 重复 start、刷新、重放（要求：当天计划未发布，孩子只能走家长入口）
 *   phase-h2 断线恢复与超时失效（含一次真实 50 秒静默）
 *   phase-h3 多设备并发
 *   phase-h4 正常学习路径（要求：计划已发布且学习达标）
 *   phase-h5 额度用尽（要求：used_ms = 1800000）
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://normal-goose-d5g4qyzr8bb389a4a.service.tcloudbase.com/r5';
const FAMILY = 'r5-selftest-family';

const DEV = {
  a: 'r5dev_acc_grandma_01',
  b: 'r5dev_acc_dad_01',
  study: 'r5dev_acc_study_01',
  quota: 'r5dev_acc_quota_01',
  replay: 'r5dev_acc_replay_01',
};

/* ---------- 凭据（仅本机，不写入交付物，不打印） ---------- */

function readCreds() {
  const out = {};
  try {
    const j = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.local', 'test-accounts.json'), 'utf8'));
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
const ACCOUNT = 'r5_selftest';           // 隔离家庭里的 grandparent 账号
const PASSWORD = CREDS[ACCOUNT] || '';

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

const deviceHeader = d => ({ 'x-r5-device': d });
const auth = device => post('/v1/parent/session', {
  family_id: FAMILY, device, account: ACCOUNT, password: PASSWORD,
});
const entry = device => post('/v1/child/entry', { family_id: FAMILY }, deviceHeader(device));
const act = (device, action, extra = {}, headers = {}) =>
  post('/v1/game/action', { family_id: FAMILY, action, ...extra },
    { ...deviceHeader(device), ...headers });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const isSid = v => typeof v === 'string' && /^[a-f0-9]{32}$/.test(v);

const brief = j => (j ? JSON.stringify({
  api: j.api, allowed: j.allowed, reason: j.reason, active: j.active,
  used_seconds: j.used_seconds, remaining_seconds: j.remaining_seconds,
  parent_override: j.parent_override, override_consumed: j.override_consumed,
  session_id: j.session_id || null, session_origin: j.session_origin || null,
  session_resumed: j.session_resumed, session_bound: j.session_bound,
  active_devices: j.active_devices,
  authorized: j.authorized, error: j.error,
}) : 'null');

/** 清掉某设备的会话痕迹：先带一次错误的 stop 是不行的，
 *  这里靠「重新授权 → start」自然会覆盖同一设备当天的会话行。 */

/* ---------- phase-h1：重复 start / 刷新 / 重放 ---------- */

async function phaseH1() {
  const d = DEV.a;

  const s = await auth(d);
  check('H1 家长账号授权成功（票据未消费）',
    s.status === 200 && s.json?.authorized === true && s.json?.one_time === true
    && Number(s.json?.remaining_seconds) > 0, brief(s.json));

  const e = await entry(d);
  check('H2 持票据时进场放行（仅跳过学习条件）',
    e.json?.allowed === true && e.json?.parent_override === true, brief(e.json));

  const st = await act(d, 'start');
  const sid = st.json?.session_id;
  check('H3 首次 start 返回服务端会话标识，且票据被原子消费',
    st.json?.allowed === true && st.json?.active === true && isSid(sid)
    && st.json?.session_origin === 'parent_override' && st.json?.override_consumed === true,
    brief(st.json));

  const again = await act(d, 'start');
  check('H4 重复 start（不带标识）被拒绝——本轮修复的核心',
    again.json?.allowed === false && again.json?.reason === 'SESSION_REQUIRED'
    && again.json?.override_consumed === false, brief(again.json));

  check('H5 被拒绝的重复 start 不会回传会话标识',
    again.json?.session_id == null && again.json?.session_born !== true,
    `session_id=${JSON.stringify(again.json?.session_id)}`);

  const refreshed = await act(d, 'start');
  const e2 = await entry(d);
  check('H6 刷新页面（新客户端无标识）仍进不去，且票据无法二次消费',
    refreshed.json?.allowed === false && e2.json?.allowed === false
    && e2.json?.parent_override === false, `${brief(refreshed.json)} | ${brief(e2.json)}`);

  const resume = await act(d, 'start', { session_id: sid });
  check('H7 带原会话标识可以续接同一个会话（不是新会话）',
    resume.json?.allowed === true && resume.json?.active === true
    && resume.json?.session_resumed === true && resume.json?.session_id === sid,
    brief(resume.json));

  const t1 = await act(d, 'tick', { session_id: sid });
  const used1 = Number(t1.json?.used_seconds);
  check('H8 心跳带标识放行并照常计费',
    t1.json?.allowed === true && t1.json?.active === true && used1 >= 0, brief(t1.json));

  const t2 = await act(d, 'tick');
  check('H9 心跳不带标识被拒绝，且不泄漏标识',
    t2.json?.allowed === false && t2.json?.reason === 'SESSION_REQUIRED'
    && t2.json?.session_id == null, brief(t2.json));

  const t3 = await act(d, 'tick', { session_id: '0123456789abcdef0123456789abcdef' });
  check('H10 伪造会话标识被拒绝',
    t3.json?.allowed === false && t3.json?.reason === 'SESSION_REQUIRED', brief(t3.json));

  const t4 = await act(d, 'tick', { session_id: sid });
  check('H11 上述拒绝没有误杀正在进行的会话（原标识仍可心跳）',
    t4.json?.allowed === true && t4.json?.session_id === sid, brief(t4.json));

  const hdr = await act(d, 'tick', {}, { 'x-r5-session': sid });
  check('H12 会话标识也可以通过 x-r5-session 请求头传递',
    hdr.json?.allowed === true, brief(hdr.json));

  const used2 = Number(t4.json?.used_seconds);
  check('H13 累计时长单调不减（1800 秒上限只减不增）',
    used2 >= used1 && Number(t4.json?.remaining_seconds) <= Number(t1.json?.remaining_seconds),
    `used ${used1} -> ${used2}`);

  const stop = await act(d, 'stop', { session_id: sid });
  check('H14 结束会话后 active=false',
    stop.json?.active === false, brief(stop.json));

  const replay = await act(d, 'start', { session_id: sid });
  check('H15 会话重放：结束后用旧标识 start 被拒绝',
    replay.json?.allowed === false && replay.json?.reason === 'SESSION_REQUIRED',
    brief(replay.json));

  const noId = await act(d, 'start');
  check('H16 结束后不带标识 start 同样被拒绝（已消费票据不能开第二次）',
    noId.json?.allowed === false && noId.json?.override_consumed === false, brief(noId.json));

  const e3 = await entry(d);
  check('H17 结束后再进场需要重新家长验证',
    e3.json?.allowed === false && e3.json?.parent_override === false, brief(e3.json));
}

/* ---------- phase-h2：断线恢复 / 超时失效 ---------- */

async function phaseH2() {
  const d = DEV.a;

  const s = await auth(d);
  const st = await act(d, 'start');
  const sid = st.json?.session_id;
  check('H18 重新授权后可创建新会话（旧授权已作废）',
    s.json?.authorized === true && st.json?.allowed === true && isSid(sid)
    && st.json?.override_consumed === true, `${brief(s.json)} | ${brief(st.json)}`);

  await sleep(3000);
  const quick = await act(d, 'start', { session_id: sid });
  check('H19 短暂断线（3 秒无心跳）后带标识可原地恢复',
    quick.json?.allowed === true && quick.json?.session_resumed === true
    && quick.json?.session_id === sid, brief(quick.json));

  console.log('… 模拟真实断线：50 秒不发心跳（服务端空闲上限 45 秒）');
  await sleep(50000);

  const late = await act(d, 'tick', { session_id: sid });
  check('H20 断线超过空闲上限后心跳被拒绝',
    late.json?.allowed === false && late.json?.reason === 'SESSION_REQUIRED',
    brief(late.json));

  const lateStart = await act(d, 'start', { session_id: sid });
  check('H21 断线超时后旧标识无法恢复会话（不会长期免密重进）',
    lateStart.json?.allowed === false && lateStart.json?.session_resumed === false,
    brief(lateStart.json));

  const e = await entry(d);
  check('H22 断线超时后再进场需要家长重新验证',
    e.json?.allowed === false && e.json?.parent_override === false, brief(e.json));

  const s2 = await auth(d);
  const st2 = await act(d, 'start');
  check('H23 超时后重新验证家长可以重新开始，并拿到全新会话标识',
    s2.json?.authorized === true && st2.json?.allowed === true
    && isSid(st2.json?.session_id) && st2.json?.session_id !== sid,
    `${brief(s2.json)} | ${brief(st2.json)}`);

  const zombie = await act(d, 'start', { session_id: sid });
  check('H24 旧会话标识在新会话开始后仍然无效',
    zombie.json?.allowed === false && zombie.json?.session_id == null, brief(zombie.json));

  await act(d, 'stop', { session_id: st2.json?.session_id });
}

/* ---------- phase-h3：多设备并发 ---------- */

async function phaseH3() {
  const a = DEV.a;
  const b = DEV.b;

  const sa = await auth(a);
  const stA = await act(a, 'start');
  const sidA = stA.json?.session_id;
  check('H25 设备A 授权并开始会话',
    sa.json?.authorized === true && stA.json?.allowed === true && isSid(sidA),
    brief(stA.json));

  const bNoTicket = await act(b, 'start');
  check('H26 设备B 没有票据时 start 被拒绝（不能搭便车）',
    bNoTicket.json?.allowed === false && bNoTicket.json?.reason === 'SESSION_REQUIRED',
    brief(bNoTicket.json));

  const bSteal = await act(b, 'start', { session_id: sidA });
  check('H27 设备B 拿设备A 的会话标识也无法续接（标识绑定设备）',
    bSteal.json?.allowed === false && bSteal.json?.session_id == null, brief(bSteal.json));

  const sb = await auth(b);
  const stB = await act(b, 'start');
  const sidB = stB.json?.session_id;
  check('H28 设备B 自己授权后可开始自己的会话，标识与A 不同',
    sb.json?.authorized === true && stB.json?.allowed === true
    && isSid(sidB) && sidB !== sidA, brief(stB.json));

  const aUseB = await act(a, 'tick', { session_id: sidB });
  check('H29 设备A 用设备B 的标识被拒绝',
    aUseB.json?.allowed === false, brief(aUseB.json));

  const tA = await act(a, 'tick', { session_id: sidA });
  const tB = await act(b, 'tick', { session_id: sidB });
  check('H30 两台设备各自心跳都放行',
    tA.json?.allowed === true && tB.json?.allowed === true,
    `${brief(tA.json)} | ${brief(tB.json)}`);

  check('H31 服务端同时看到两个活跃会话',
    Number(tA.json?.active_devices) >= 2, `active_devices=${tA.json?.active_devices}`);

  await act(a, 'stop', { session_id: sidA });
  const afterStopA = await act(a, 'tick', { session_id: sidA });
  const stillB = await act(b, 'tick', { session_id: sidB });
  check('H32 A 结束后 A 被拒，B 不受影响',
    afterStopA.json?.allowed === false && stillB.json?.allowed === true,
    `${brief(afterStopA.json)} | ${brief(stillB.json)}`);

  const stopB = await act(b, 'stop', { session_id: sidB });
  check('H33 B 结束后两台都无活跃会话',
    stopB.json?.active === false, brief(stopB.json));
}

/* ---------- phase-h4：正常学习路径 ---------- */

async function phaseH4() {
  const d = DEV.study;

  const st = await act(d, 'start');
  const sid = st.json?.session_id;
  check('H34 学习达标时不需要票据也能开始（session_origin=study）',
    st.json?.allowed === true && st.json?.session_origin === 'study'
    && st.json?.override_consumed === false && isSid(sid), brief(st.json));

  const t1 = await act(d, 'tick', { session_id: sid });
  check('H35 学习路径带标识心跳正常',
    t1.json?.allowed === true && t1.json?.active === true, brief(t1.json));

  const t2 = await act(d, 'tick');
  check('H36 旧前端（心跳不带标识）在学习路径下仍可用',
    t2.json?.allowed === true, brief(t2.json));

  const stop = await act(d, 'stop');
  check('H37 学习路径结束会话正常',
    stop.json?.active === false, brief(stop.json));
}

/* ---------- phase-h5：额度用尽 ---------- */

async function phaseH5() {
  const d = DEV.quota;

  const s = await auth(d);
  check('H38 额度用尽时家长授权被拒绝（TIME_LIMIT_REACHED）',
    s.status === 403 && s.json?.error === 'TIME_LIMIT_REACHED',
    `status=${s.status} ${brief(s.json)}`);

  const st = await act(d, 'start');
  check('H39 额度用尽时 start 被拒绝',
    st.json?.allowed === false && st.json?.active === false, brief(st.json));

  const t = await act(d, 'tick');
  check('H40 额度用尽时心跳被拒绝',
    t.json?.allowed === false, brief(t.json));
}

/* ---------- 运行 ---------- */

const phase = (process.argv[2] || '').trim();
const runners = {
  'phase-h1': phaseH1,
  'phase-h2': phaseH2,
  'phase-h3': phaseH3,
  'phase-h4': phaseH4,
  'phase-h5': phaseH5,
};

const run = runners[phase];
if (!run) {
  console.error(`usage: node tests/session-binding.test.mjs <${Object.keys(runners).join('|')}>`);
  process.exit(2);
}
if (!PASSWORD) {
  console.error('缺少本机测试凭据，无法执行');
  process.exit(3);
}

const startedAt = new Date().toISOString();
await run();
const passed = results.filter(r => r.ok).length;
const failed = results.length - passed;

const outDir = path.join(process.cwd(), 'tests', 'artifacts');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `${phase}.json`), JSON.stringify({
  phase,
  family: FAMILY,
  gateway: BASE,
  started_at: startedAt,
  finished_at: new Date().toISOString(),
  passed,
  failed,
  results,
}, null, 2));

console.log(`--- ${phase}: ${passed} passed / ${failed} failed ---`);
process.exit(failed ? 1 : 0);
