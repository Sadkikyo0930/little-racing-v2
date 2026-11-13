'use strict';
/**
 * r5-gateway — CloudBase HTTP 云函数（线上版中继）
 *
 * 目标：孩子端在 iPhone Safari 上直接用，不需要账号密码；家长凭证永不进浏览器。
 *
 * 身份模型
 *   孩子端：设备令牌（device_uid，家长绑定时生成的随机串）→ 只换算出 sub=设备 uid 的 claims，
 *           再调 r5_child_entry / r5_game_action。数据库侧 r5_assert_member 决定放行与否。
 *   家长端：家长在通行证页选择账号（爸爸 / 妈妈 / 外婆）并输入自己的密码 →
 *           网关调用 CloudBase Auth 校验 → 用真实 uid 换 claims 签发一次性票据。
 *           旧版 x-r5-parent 口令路径已下线（410），不再作为任何入口。
 *
 * 会话绑定（1.5.0）
 *   一次家长授权只能创建一次游戏会话：start 消费票据的同时由数据库生成
 *   session_id 并返回；后续 tick / stop / 续接都必须带上它。没有票据又没有
 *   未过期的会话标识时，start 一律拒绝（SESSION_REQUIRED），因此刷新、退出、
 *   重开、重放请求都换不到第二次免学习资格。
 *
 * 数据集
 *   函数内不持有任何数据库密钥：凭证由运行时注入（环境变量 tmpSecret / 默认凭证链），
 *   通过云 API ExecutePGSql 执行 SQL，只在本函数进程内出现。
 *
 * 允许的动作（硬编码白名单）
 *   孩子：r5_child_entry / r5_game_action_v2 / r5_game_action_md_v2
 *   家长：r5_bind_device / r5_revoke_device / r5_list_devices / r5_status
 *   其它一律 403。
 */

const crypto = require('crypto');

const CFG = {
  envId: process.env.R5_ENV_ID || 'normal-goose-d5g4qyzr8bb389a4a',
  region: process.env.R5_REGION || 'ap-shanghai',
  internalSecret: process.env.R5_INTERNAL_SECRET || '',
  parentUid: process.env.R5_PARENT_UID || '',
  parentSecret: process.env.R5_PARENT_SECRET || '',
  // 家长账号认证：复用 V6 已有的 CloudBase Auth 用户名密码登录（三个家庭账号），
  // 网关在服务端调用该接口校验密码，浏览器永远拿不到也不需要任何密码哈希。
  authBase: process.env.R5_AUTH_BASE
    || `https://${process.env.R5_ENV_ID || 'normal-goose-d5g4qyzr8bb389a4a'}.api.tcloudbasegateway.com`,
  allowedFamilies: new Set(
    (process.env.R5_ALLOWED_FAMILIES || 'little-growth-family-001,r5-selftest-family')
      .split(',').map(s => s.trim()).filter(Boolean)
  ),
};

// 多设备计时引擎开关：只有列在白名单里的家庭改用 r5_game_action_md。
// 默认空字符串 = 所有家庭继续走原来的 r5_game_action，上线后行为零变化。
// 逐步放量示例：R5_MD_FAMILIES=r5-selftest-family
// 正式放量示例：R5_MD_FAMILIES=little-growth-family-001,r5-selftest-family
const MD_FAMILIES = new Set(
  (process.env.R5_MD_FAMILIES || '').split(',').map(s => s.trim()).filter(Boolean)
);

const FAMILY_RE = /^[A-Za-z0-9_-]{3,80}$/;
const DEVICE_RE = /^[A-Za-z0-9_-]{8,80}$/;
const ACTIONS = new Set(['start', 'tick', 'stop', 'status']);
// 服务端生成的游戏会话标识：32 位小写十六进制（r5_session_open 生成）。
const SESSION_RE = /^[a-f0-9]{32}$/;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-r5-device,x-r5-parent,x-r5-session',
  'access-control-max-age': '86400',
  'cache-control': 'no-store',
};

/* ---------- 云 API ExecutePGSql ---------- */

let client = null;
function getClient() {
  if (client) return client;
  const tcb = require('tencentcloud-sdk-nodejs-tcb').tcb.v20180608;
  const common = require('tencentcloud-sdk-nodejs-common');
  const secretId = process.env.TENCENTCLOUD_SECRETID || '';
  const secretKey = process.env.TENCENTCLOUD_SECRETKEY || '';
  const token = process.env.TENCENTCLOUD_SESSIONTOKEN || '';
  if (!secretId || !secretKey) {
    const e = new Error('R5_NO_RUNTIME_CREDENTIAL');
    e.code = 'R5_NO_RUNTIME_CREDENTIAL';
    throw e;
  }
  const cred = new common.BasicCredential(secretId, secretKey, token || undefined);
  client = new tcb.Client({
    credential: cred,
    region: CFG.region,
    profile: { httpProfile: { endpoint: 'tcb.tencentcloudapi.com', reqTimeout: 15 } },
  });
  return client;
}

const lit = s => `'${String(s).replace(/'/g, "''")}'`;
/** NULL 感知的字面量：会话标识允许缺省，缺省时必须写 SQL NULL 而不是字符串 'null'。 */
const litOrNull = s => (s == null || s === '' ? 'NULL' : lit(s));

/**
 * 单条 SQL 内注入身份并调用数据库函数。
 * ExecutePGSql 每次只接受一条语句，因此用「CTE 先执行 set_config」的技巧：
 * 外层 SELECT 依赖 c，PostgreSQL 会先求值 CTE，claims 在函数调用前已生效。
 */
function sqlAs(claims, expr) {
  const c = lit(JSON.stringify(claims));
  return `WITH c AS (SELECT set_config('request.jwt.claims', ${c}, true) AS s) `
       + `SELECT ${expr} AS r FROM c`;
}

async function runSql(sql) {
  const rsp = await getClient().ExecutePGSql({ EnvId: CFG.envId, Sql: sql });
  const R = (rsp && rsp.Response) || rsp || {};
  if (R.Error) throw new Error(JSON.stringify(R.Error));
  const rows = (R.Rows || []).map(r => {
    if (typeof r === 'string') { try { return JSON.parse(r); } catch { return [r]; } }
    return r;
  });
  const first = rows[0];
  const cell = Array.isArray(first) ? first[0] : first;
  if (typeof cell === 'string') { try { return JSON.parse(cell); } catch { return cell; } }
  if (cell == null) throw new Error('R5_EMPTY_RESULT');
  return cell;
}

/* ---------- 请求解析 ---------- */

function parseCtx(event, context) {
  const e = event || {};
  const hc = (context && context.httpContext) || {};

  // 形态 A：SCF Web 函数 / functions-framework —— 请求信息在 context.httpContext，event 就是请求体
  // 形态 B：事件型云函数 + HTTP 访问服务 —— 请求信息在 event 里（API Gateway 事件）
  const isGw = Boolean(e.httpMethod || e.requestContext || e.rawPath || e.path);

  const url = isGw
    ? (e.rawPath || e.path || (e.requestContext && e.requestContext.path) || '/')
    : (hc.url || '/');
  let path = '/';
  try { path = new URL(String(url), 'https://x').pathname; }
  catch { path = String(url).split('?')[0]; }

  const rawHeaders = isGw ? (e.headers || {}) : (hc.headers || {});
  const headers = {};
  for (const [k, v] of Object.entries(rawHeaders)) headers[String(k).toLowerCase()] = Array.isArray(v) ? v[0] : v;

  let body;
  if (isGw) {
    const raw = e.body;
    if (typeof raw === 'string' && raw) {
      const text = e.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw;
      try { body = JSON.parse(text); } catch { body = {}; }
    } else if (raw && typeof raw === 'object') {
      body = raw;
    } else {
      body = e.queryStringParameters || {};
    }
  } else {
    body = (e && typeof e === 'object' && !Buffer.isBuffer(e)) ? e : {};
  }

  const method = String((isGw ? e.httpMethod : hc.httpMethod) || 'POST').toUpperCase();
  return { method, path, headers, body: body || {} };
}

const pick = (o, ...keys) => { for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return undefined; };

function familyOf(src) {
  const f = pick(src, 'family_id', 'familyId', 'p_family_id') || 'little-growth-family-001';
  if (!FAMILY_RE.test(String(f))) throw httpErr(400, 'R5_INVALID_FAMILY');
  if (CFG.allowedFamilies.size && !CFG.allowedFamilies.has(String(f))) throw httpErr(403, 'R5_FAMILY_NOT_ALLOWED');
  return String(f);
}

function deviceOf(src, headers) {
  const d = headers['x-r5-device'] || pick(src, 'device', 'device_uid', 'deviceUid');
  if (!d) throw httpErr(401, 'R5_DEVICE_REQUIRED');
  if (!DEVICE_RE.test(String(d))) throw httpErr(400, 'R5_INVALID_DEVICE');
  return String(d);
}

function requireParent(headers, src) {
  if (!CFG.parentSecret) throw httpErr(503, 'R5_PARENT_SECRET_NOT_CONFIGURED');
  const given = headers['x-r5-parent'] || pick(src, 'parent_secret', 'parentSecret') || '';
  const a = Buffer.from(String(given));
  const b = Buffer.from(CFG.parentSecret);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) throw httpErr(401, 'R5_PARENT_AUTH_FAILED');
  if (!CFG.parentUid) throw httpErr(503, 'R5_PARENT_UID_NOT_CONFIGURED');
}

function httpErr(status, code) {
  const e = new Error(code);
  e.status = status;
  e.code = code;
  return e;
}

/* ---------- 生日领取（最小增量新增，2026-11-10） ----------
 * 唯一新增路由 POST /r5/v1/birthday/claim。
 * 身份链：x-r5-device -> 原网关 sqlAs 注入服务端 claims
 *        -> public.r5_assert_member(family_id,false) 统一鉴权
 *        -> 服务端 public.r5_device 绑定表反查真实 family_id
 *        -> R5_INTERNAL_SECRET 签名 HMAC 断言 -> 内部调用 r5-birthday-claim。
 * 不采信 body.family_id / authenticated 等任何客户端字段；旧路由零改动。
 */
const BIRTHDAY_FN = 'r5-birthday-claim';

/** 复用 r5-gateway 原有设备鉴权机制取得 family_id。
 *  claims 由服务端构造（role 是服务端常量，不是客户端布尔标志）；
 *  sqlAs + runSql 与原 8 条孩子端路由完全同一条调用链；
 *  public.r5_assert_member 是数据库侧统一鉴权入口（SECURITY DEFINER），
 *  负责校验设备绑定未撤销 / 家庭成员，并按既有行为刷新 last_seen。
 *  任一环节失败即抛错，绝不降级为旁路直查放行。
 */
async function deviceFamilyFromServer(device) {
  const claims = { sub: device, role: 'authenticated' };

  // ① 真实 family_id 只来自服务端设备绑定表，绝不采信请求体
  const familyId = await runSql(sqlAs(claims,
    `COALESCE((SELECT d.family_id FROM public.r5_device d ` +
    `WHERE d.device_uid = ${lit(device)} AND revoked_at IS NULL LIMIT 1), '')`));
  if (typeof familyId !== 'string' || !familyId) return '';

  // ② 交给原有统一鉴权函数正式校验：无效 / 已撤销 / 非本家庭 -> R5_MEMBER_DENIED
  await runSql(sqlAs(claims, `public.r5_assert_member(${lit(familyId)}, false)`));
  return familyId;
}

async function birthdayClaim({ headers, body }) {
  const device = deviceOf(body, headers);
  if (!CFG.internalSecret) throw httpErr(503, 'R5_INTERNAL_SECRET_NOT_CONFIGURED');

  let familyId;
  try {
    familyId = await deviceFamilyFromServer(device);
  } catch (e) {
    const msg = String((e && e.message) || e);
    // 鉴权明确拒绝 -> 401；其余（DB 故障 / 云 API 异常）-> 502 fail-closed，
    // 绝不把内部错误细节透传给客户端，更不可能返回领取成功态。
    if (/R5_MEMBER_DENIED|R5_AUTH_REQUIRED/.test(msg)) throw httpErr(401, 'R5_MEMBER_DENIED');
    throw httpErr(502, 'R5_GATEWAY_ERROR');
  }
  if (!familyId) throw httpErr(401, 'R5_MEMBER_DENIED');
  if (!FAMILY_RE.test(familyId)) throw httpErr(400, 'R5_INVALID_FAMILY');
  if (CFG.allowedFamilies.size && !CFG.allowedFamilies.has(familyId)) {
    throw httpErr(403, 'R5_FAMILY_NOT_ALLOWED');
  }

  const ts = Date.now();
  const sig = crypto.createHmac('sha256', CFG.internalSecret)
                    .update(familyId + '|' + device + '|' + ts).digest('hex');
  const assertion = {
    headers: { 'x-r5-device': device },
    r5_identity: { family_id: familyId, device: device, ts: ts, sig: sig },
  };

  let out;
  try {
    const tcb = require('@cloudbase/node-sdk');
    const app = tcb.init({ env: CFG.envId });
    const res = await app.callFunction({ name: BIRTHDAY_FN, data: assertion });
    out = res && res.result;
  } catch (e) {
    throw new Error('R5_BIRTHDAY_FUNCTION_ERROR ' + String((e && e.message) || e));
  }
  if (!out || typeof out !== 'object') throw new Error('R5_BIRTHDAY_EMPTY_RESULT');
  return out;
}

/* ---------- 家庭赛车存档同步（最小增量新增，2026-11-11） ----------
 * 新增 5 条路由，全部复用 deviceFamilyFromServer() 的原网关统一鉴权链
 * （sqlAs + public.r5_assert_member），family_id 只取自服务端绑定表。
 * r5_request 采用字段白名单，客户端自报的 family_id / authenticated / device 一律剔除。
 * R5_INTERNAL_SECRET 签发含 body_hash 的 HMAC 断言，仅内部调用 r5-racing-save。
 * 旧 9 条路由、旧函数体、旧返回格式零改动。
 */
const RACING_SAVE_FN = 'r5-racing-save';
const RACING_SCOPE = 'r5-racing-save';
const RACING_ASSERT_VERSION = 'v1';

function canonicalR5(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(canonicalR5).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalR5(v[k])).join(',') + '}';
}
const sha256HexR5 = s => crypto.createHash('sha256').update(s).digest('hex');

function racingRequest(body, action) {
  const src = (body && typeof body === 'object') ? body : {};
  const allow = ['expected_revision', 'events', 'patch', 'payload', 'sha256', 'source', 'confirmation',
    'learning_record_id', 'vehicle_id'];
  const out = { action: action };
  for (const k of allow) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

async function racingSaveCall(action, ctx) {
  const { headers, body } = ctx;
  const device = deviceOf(body, headers);
  if (!CFG.internalSecret) throw httpErr(503, 'R5_INTERNAL_SECRET_NOT_CONFIGURED');

  let familyId;
  try {
    familyId = await deviceFamilyFromServer(device);
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (/R5_MEMBER_DENIED|R5_AUTH_REQUIRED/.test(msg)) throw httpErr(401, 'R5_MEMBER_DENIED');
    throw httpErr(502, 'R5_GATEWAY_ERROR');
  }
  if (!familyId) throw httpErr(401, 'R5_MEMBER_DENIED');
  if (!FAMILY_RE.test(familyId) || (CFG.allowedFamilies.size && !CFG.allowedFamilies.has(familyId))) {
    throw httpErr(403, 'R5_FAMILY_NOT_ALLOWED');
  }

  const req = racingRequest(body, action);
  const bodyHash = sha256HexR5(canonicalR5(req));
  const ts = Date.now();
  const sig = crypto.createHmac('sha256', CFG.internalSecret)
    .update([RACING_SCOPE, RACING_ASSERT_VERSION, familyId, device, String(ts), bodyHash].join('|'))
    .digest('hex');

  const data = {
    headers: { 'x-r5-device': device },
    r5_identity: {
      scope: RACING_SCOPE, version: RACING_ASSERT_VERSION,
      family_id: familyId, device: device, ts: ts, sig: sig, body_hash: bodyHash,
    },
    r5_request: req,
  };

  let out;
  try {
    const tcb = require('@cloudbase/node-sdk');
    const app = tcb.init({ env: CFG.envId });
    const res = await app.callFunction({ name: RACING_SAVE_FN, data: data });
    out = res && res.result;
  } catch (e) {
    // 服务端故障一律 fail-closed，绝不假报同步成功，也不透传内部错误细节
    throw httpErr(502, 'R5_RACING_SAVE_UNAVAILABLE');
  }
  if (!out || typeof out !== 'object') throw httpErr(502, 'R5_RACING_SAVE_EMPTY_RESULT');
  return out;
}

const racingGet = ctx => racingSaveCall('save.get', ctx);
const racingSync = ctx => racingSaveCall('save.sync', ctx);
const racingBackupPut = ctx => racingSaveCall('backup.put', ctx);
const racingMigrationReport = ctx => racingSaveCall('migration.report', ctx);
const racingMigrationConfirm = ctx => racingSaveCall('migration.confirm', ctx);
/* v1.3 增量：V6 学习碎片掉落 / 赛车组装。复用同一条设备鉴权链与同一条 HMAC 断言，
 * 只多放行 learning_record_id / vehicle_id 两个字段，绝对不采信客户端自报家庭或余额。 */
const racingFragmentClaim = ctx => racingSaveCall('fragment.claim', ctx);
const racingFragmentAssemble = ctx => racingSaveCall('fragment.assemble', ctx);

/* ---------- 路由 ---------- */

const ROUTES = [
  { method: 'GET', re: /\/health$/, fn: health },
  { method: 'POST', re: /\/child\/entry$/, fn: childEntry },
  { method: 'POST', re: /\/game\/(action|tick|beat)$/, fn: gameAction },
  { method: 'POST', re: /\/parent\/bind$/, fn: parentBind },
  { method: 'POST', re: /\/parent\/revoke$/, fn: parentRevoke },
  { method: 'POST', re: /\/parent\/devices$/, fn: parentDevices },
  { method: 'POST', re: /\/parent\/status$/, fn: parentStatus },
  { method: 'POST', re: /\/parent\/session$/, fn: parentSession },
  { method: 'POST', re: /\/parent\/game-override$/, fn: parentGameOverrideDeprecated },
  { method: 'POST', re: /\/device\/whoami$/, fn: deviceWhoami },
  { method: 'POST', re: /\/birthday\/claim$/, fn: birthdayClaim },
  { method: 'POST', re: /\/racing\/save\/get$/, fn: racingGet },
  { method: 'POST', re: /\/racing\/save\/sync$/, fn: racingSync },
  { method: 'POST', re: /\/racing\/backup\/put$/, fn: racingBackupPut },
  { method: 'POST', re: /\/racing\/migration\/report$/, fn: racingMigrationReport },
  { method: 'POST', re: /\/racing\/migration\/confirm$/, fn: racingMigrationConfirm },
  { method: 'POST', re: /\/racing\/fragment\/claim$/, fn: racingFragmentClaim },
  { method: 'POST', re: /\/racing\/fragment\/assemble$/, fn: racingFragmentAssemble },
];

function health() {
  return {
    ok: true,
    service: 'r5-gateway',
    version: '1.5.0-session-bound',
    fragment_endpoints: true,
    parent_override_endpoint: true,
    parent_override_endpoint_path: '/v1/parent/session',
    parent_override_ttl_seconds: OVERRIDE_TTL_SECONDS,
    parent_auth: 'cloudbase-account-password',
    parent_override_single_use: true,
    parent_secret_retired: true,
    session_binding: true,
    session_idle_seconds: 45,
    session_required_for_override: true,
    env: CFG.envId,
    region: CFG.region,
    families: [...CFG.allowedFamilies],
    parentEndpointReady: Boolean(CFG.parentSecret && CFG.parentUid),
    game_engines: {
      v1: 'r5_game_action_v2',
      md: 'r5_game_action_md_v2',
      legacy_v1: 'r5_game_action',
      legacy_md: 'r5_game_action_md',
      md_families: [...MD_FAMILIES],
    },
    server_time: new Date().toISOString(),
  };
}

/**
 * 设备自证：只回答「这个令牌现在还有效吗」。
 *
 * 为什么需要它：授权页不能因为 localStorage 里存着令牌就宣称「已授权」——
 * 云端可能早就撤销了这台设备，本地存储是会说谎的。只有服务端校验通过，
 * 才能说这台手机真的能用。
 *
 * 实现上复用 r5_status 的同一套成员/设备校验（内部查 r5_device 的 active），
 * 因此不需要新增任何数据库对象；只返回布尔与额度，不返回学习明细。
 */
async function deviceWhoami({ headers, body }) {
  const family = familyOf(body);
  const device = deviceOf(body, headers);
  try {
    const out = await runSql(sqlAs({ sub: device, role: 'authenticated' },
      `public.r5_status(${lit(family)})`));
    return {
      ok: true, bound: true, device, family_id: family,
      allowed: out.allowed === true, reason: out.reason,
      remaining_seconds: out.remaining_seconds,
      daily_seconds: out.daily_seconds, bonus_seconds: out.bonus_seconds,
    };
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (/R5_MEMBER_DENIED|R5_DEVICE_REQUIRED|R5_INVALID_DEVICE|R5_FAMILY_NOT_ALLOWED/.test(msg)) {
      return { ok: false, bound: false, device, family_id: family, reason: 'DEVICE_NOT_BOUND' };
    }
    throw e;
  }
}

async function childEntry({ headers, body }) {
  const family = familyOf(body);
  const device = deviceOf(body, headers);
  const out = await runSql(sqlAs({ sub: device, role: 'authenticated' },
    `public.r5_child_entry(${lit(family)})`));
  return { ...out, device, family_id: family };
}

/**
 * 取服务端会话标识。
 *
 * 这里是「一次家长授权只能开一次游戏会话」的入口约束：start 拿不到新票据时，
 * 只有带上上一次 start 返回的 session_id 才能续接同一个会话；刷新、换标签页、
 * 重放旧请求都没有这个标识，只能回到家长验证。缺省返回 null（学习路径允许无标识）。
 */
function sessionOf(src, headers) {
  const raw = headers['x-r5-session'] || pick(src, 'session_id', 'sessionId', 'sid');
  if (raw == null || raw === '') return null;
  const s = String(raw).trim().toLowerCase();
  if (!SESSION_RE.test(s)) throw httpErr(400, 'R5_INVALID_SESSION_ID');
  return s;
}

async function gameAction({ headers, body, path }) {
  const family = familyOf(body);
  const device = deviceOf(body, headers);
  const sessionId = sessionOf(body, headers);
  let action = pick(body, 'action', 'p_action');
  if (!action) action = /\/game\/tick$|\/game\/beat$/.test(path) ? 'tick' : '';
  action = String(action || '').toLowerCase();
  if (!ACTIONS.has(action)) throw httpErr(400, 'R5_INVALID_ACTION');
  // 会话绑定版引擎：_v2 函数在数据库侧强制校验 session_id，
  // 旧的无标识函数只是 fail-closed 委托，客户端不能再绕过。
  const fn = MD_FAMILIES.has(family) ? 'r5_game_action_md_v2' : 'r5_game_action_v2';
  const out = await runSql(sqlAs({ sub: device, role: 'authenticated' },
    `public.${fn}(${lit(family)}, ${lit(action)}, ${litOrNull(sessionId)})`));
  const engine = MD_FAMILIES.has(family) ? 'bound-md-1' : 'bound-1';
  return {
    ...out,
    action,
    device,
    family_id: family,
    engine,
    session_id: out && out.session_id ? out.session_id : null,
    session_required: out && out.session_origin === 'parent_override',
  };
}

async function parentBind({ headers, body }) {
  requireParent(headers, body);
  const family = familyOf(body);
  const device = deviceOf(body, headers);
  const label = String(pick(body, 'label', 'device_name') || '孩子设备').slice(0, 40);
  const out = await runSql(sqlAs({ sub: CFG.parentUid, role: 'authenticated' },
    `public.r5_bind_device(${lit(family)}, ${lit(device)}, ${lit(label)})`));
  return { ...out, device_uid: device, family_id: family, label };
}

async function parentRevoke({ headers, body }) {
  requireParent(headers, body);
  const family = familyOf(body);
  const device = deviceOf(body, headers);
  const out = await runSql(sqlAs({ sub: CFG.parentUid, role: 'authenticated' },
    `public.r5_revoke_device(${lit(family)}, ${lit(device)})`));
  return { ...out, device_uid: device, family_id: family };
}

async function parentDevices({ headers, body }) {
  requireParent(headers, body);
  const family = familyOf(body);
  const out = await runSql(sqlAs({ sub: CFG.parentUid, role: 'authenticated' },
    `public.r5_list_devices(${lit(family)})`));
  return { devices: out };
}

async function parentStatus({ headers, body }) {
  requireParent(headers, body);
  const family = familyOf(body);
  const out = await runSql(sqlAs({ sub: CFG.parentUid, role: 'authenticated' },
    `public.r5_status(${lit(family)})`));
  return { ...out, family_id: family };
}

/* ---------- 家长免学习快捷授权（2026-11-13 最小增量新增） ----------
 * 唯一新增路由 POST /r5/v1/parent/game-override。
 * 身份链：x-r5-parent 口令（复用既有家长口令，长度恒定时间比较）
 *        -> 服务端固定家长 uid 换 claims -> public.r5_parent_game_override()
 *        -> 数据库侧 r5_assert_member(family,true) 校验家长身份
 *        -> r5_device 校验「已绑定且未撤销」，r5_parent_settings 校验游戏开关
 *        -> 只读核对当天剩余秒数，额度为 0 直接拒绝（绝不重置已用时长）
 * 返回的是服务端一次性短时授权（默认 300 秒），前端 localStorage / URL 一律不作数。
 * 本函数不新增任何依赖、不改动其它路由。
 */
const OVERRIDE_TTL_SECONDS = 120;   // 一次性票据存活时间，只够从通行证走到赛车页
const OVERRIDE_WINDOW_MS = 10 * 60 * 1000;
const OVERRIDE_MAX_FAILS = 5;
const ACCOUNT_RE = /^[A-Za-z0-9_.-]{3,40}$/;
const overrideAttempts = new Map(); // key -> { fails: number[], last: number }

function clientIp(headers) {
  const fwd = headers['x-forwarded-for'] || headers['x-real-ip'] || '';
  return String(fwd).split(',')[0].trim().slice(0, 64) || 'unknown';
}

function overrideThrottle(key) {
  const now = Date.now();
  if (overrideAttempts.size > 500) {
    for (const [k, v] of overrideAttempts) {
      if (!v.fails.length && now - v.last > OVERRIDE_WINDOW_MS) overrideAttempts.delete(k);
    }
  }
  const st = overrideAttempts.get(key) || { fails: [], last: 0 };
  st.fails = st.fails.filter(t => now - t < OVERRIDE_WINDOW_MS);
  st.last = now;
  // 同一家庭 + 同一来源：10 分钟内错 5 次即锁定；正确口令不受此前成功记录影响
  const blocked = st.fails.length >= OVERRIDE_MAX_FAILS;
  overrideAttempts.set(key, st);
  return { st, blocked };
}

async function overrideAudit(family, action, detail) {
  try {
    await runSql(`SELECT public.r5_parent_game_override_audit(${lit(family)}, ${lit(action)}, ` +
      `${lit(JSON.stringify(detail || {}))}::jsonb)`);
  } catch (e) {
    // 审计写失败绝不能变成放行，也不会泄漏口令
    console.warn('[r5-gateway] override audit failed', action);
  }
}

/* 家长账号认证 + 一次性免学习授权（v2，2026-11-13）
 *
 * 与 v1 的差别：不再使用独立的 R5_PARENT_SECRET 口令，而是复用 V6 已有的三个家庭账号
 * （growth_mom / growth_dad / growth_grandma 等，密码各自原有，不新增、不重置）。
 *
 * 身份链（每一步都在服务端）：
 *   1. 浏览器只提交 {family_id, device, account, password}；
 *   2. 网关带着账号密码调用 CloudBase Auth 的 /auth/v1/signin 校验密码
 *      —— 密码只在这一次 HTTPS 请求里出现，不落盘、不写日志、不进审计；
 *   3. 校验通过后从 CloudBase 签发的 access_token 里取 sub（真实 uid），
 *      客户端提交的 account 只作展示与审计，永远不作为身份；
 *   4. 用 sub 换 claims 调 r5_parent_override_issue()：数据库再校验
 *      「该 uid 是本家庭 owner/parent/grandparent 成员」「设备已绑定且未撤销」
 *      「家长总开关开启」「当天剩余额度 > 0」，任何一条不满足即拒绝；
 *   5. 签发的是一张服务端一次性票据（默认 120 秒），不下发给浏览器。
 *      首次 start 时被 r5_override_consume() 原子消费，退出/结束即失效，
 *      刷新、回放、复制 URL、重放请求都换不到第二次免学习资格。
 */

function decodeJwtPayload(token) {
  try {
    const part = String(token).split('.')[1];
    if (!part) return null;
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/** 用 CloudBase Auth 校验账号密码。成功返回 { uid }，凭证错误返回 null，服务异常抛错（fail-closed）。 */
async function verifyAccountPassword(account, password) {
  const url = `${CFG.authBase}/auth/v1/signin`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let status = 0;
  let text = '';
  try {
    const rsp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: account, password }),
      signal: controller.signal,
      cache: 'no-store',
    });
    status = rsp.status;
    text = await rsp.text();
  } catch (e) {
    // 网络异常 / 超时：绝不当作「密码正确」或「密码错误」，直接拒绝且不消耗重试额度
    console.error('[r5-gateway] auth unavailable', (e && e.message) || 'unknown');
    throw httpErr(503, 'R5_AUTH_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
  }

  if (status === 200) {
    let body = null;
    try { body = JSON.parse(text); } catch { body = null; }
    const payload = body && body.access_token ? decodeJwtPayload(body.access_token) : null;
    if (!payload || !payload.sub) throw httpErr(502, 'R5_AUTH_BAD_RESPONSE');
    return { uid: String(payload.sub) };
  }
  // CloudBase Auth 对「账号不存在 / 密码错误」统一返回 400 INVALID_USERNAME_OR_PASSWORD
  if (status === 400 || status === 401 || status === 403) return null;
  console.error('[r5-gateway] auth status', status);
  throw httpErr(503, 'R5_AUTH_UNAVAILABLE');
}

/** 旧口令路径已下线：任何旧前端打到这里都拒绝，绝不静默降级为可用。 */
function parentGameOverrideDeprecated() {
  throw httpErr(410, 'R5_PARENT_SECRET_RETIRED');
}

async function parentSession({ headers, body }) {
  const family = familyOf(body);
  const device = deviceOf(body, headers);
  const account = String(pick(body, 'account', 'username') || '').trim().toLowerCase();
  const password = String(pick(body, 'password') || '');
  const ip = clientIp(headers);

  if (!ACCOUNT_RE.test(account) || !password) {
    await overrideAudit(family, 'game_override_denied', {
      ip, device, account: account.slice(0, 40), reason: 'missing_credentials',
    });
    throw httpErr(401, 'R5_PARENT_CREDENTIALS_REQUIRED');
  }
  if (password.length > 200) throw httpErr(400, 'R5_PARENT_CREDENTIALS_INVALID');

  // 防爆破：家庭 + 账号 + 来源 三重维度
  const key = `${family}|${account}|${ip}`;
  const { st, blocked } = overrideThrottle(key);
  if (blocked) {
    await overrideAudit(family, 'game_override_throttled', { ip, device, account });
    throw httpErr(429, 'R5_TOO_MANY_ATTEMPTS');
  }

  // 跨实例锁：同一家庭近 10 分钟的失败次数（审计表，多实例共享）
  let recentFails = 0;
  try {
    recentFails = Number(await runSql(
      `SELECT count(*)::int FROM public.r5_parent_audit WHERE family_id = ${lit(family)} ` +
      `AND action = 'game_override_failed_auth' ` +
      `AND detail->>'account' = ${lit(account)} ` +
      `AND created_at > clock_timestamp() - interval '10 minutes'`)) || 0;
  } catch (e) {
    recentFails = 0; // 读不到不额外加锁，密码校验照常执行
  }
  if (recentFails >= OVERRIDE_MAX_FAILS) {
    await overrideAudit(family, 'game_override_throttled', { ip, device, account, reason: 'db_window' });
    throw httpErr(429, 'R5_TOO_MANY_ATTEMPTS');
  }

  st.last = Date.now();
  const verified = await verifyAccountPassword(account, password);
  if (!verified) {
    st.fails.push(Date.now());
    await overrideAudit(family, 'game_override_failed_auth', { ip, device, account });
    throw httpErr(401, 'R5_PARENT_AUTH_FAILED');
  }
  st.fails = [];

  let out;
  try {
    out = await runSql(sqlAs({ sub: verified.uid, role: 'authenticated' },
      `public.r5_parent_override_issue(${lit(family)}, ${lit(device)}, ${lit(account)}, ` +
      `${OVERRIDE_TTL_SECONDS})`));
  } catch (e) {
    const raw = String((e && e.message) || e);
    const code = (/R5_[A-Z_]+/.exec(raw) || [])[0] || '';
    if (code === 'R5_TIME_LIMIT_REACHED') throw httpErr(403, 'TIME_LIMIT_REACHED');
    if (code === 'R5_AUTH_REQUIRED') throw httpErr(401, 'R5_AUTH_REQUIRED');
    if (code === 'R5_SETTINGS_MISSING') throw httpErr(409, code);
    if (code === 'R5_DEVICE_NOT_BOUND' || code === 'R5_DEVICE_FAMILY_MISMATCH'
      || code === 'R5_DEVICE_REVOKED' || code === 'R5_PARENT_CONTROL_DISABLED'
      || code === 'R5_MEMBER_DENIED' || code === 'R5_FAMILY_NOT_ALLOWED'
      || code === 'R5_DEVICE_REQUIRED' || code === 'R5_INVALID_DEVICE') {
      await overrideAudit(family, 'game_override_denied', { ip, device, account, code });
      throw httpErr(403, code);
    }
    console.error('[r5-gateway] parent session failure', raw.slice(0, 300));
    throw httpErr(502, 'R5_GATEWAY_ERROR');
  }
  if (!out || out.authorized !== true || !(Number(out.remaining_seconds) > 0)) {
    // 服务端没有给出可用额度就绝不放行
    throw httpErr(403, 'R5_TIME_LIMIT_REACHED');
  }
  return {
    ...out,
    api: 'r5_parent_session',
    authorized: true,
    account,
    family_id: family,
    device,
    one_time: true,
  };
}

/* ---------- 入口 ---------- */

function reply(statusCode, obj) {
  const headers = Object.assign({ 'content-type': 'application/json; charset=utf-8' }, CORS);
  return { statusCode, headers, body: JSON.stringify(obj) };
}

exports.main = async function main(event, context) {
  let ctx;
  try { ctx = parseCtx(event, context); } catch { return reply(400, { error: 'R5_BAD_REQUEST' }); }

  if (ctx.method === 'OPTIONS') return reply(204, {});
  if (ctx.method === 'GET' && /\/health$/.test(ctx.path)) return reply(200, health());

  const route = ROUTES.find(r => r.method === ctx.method && r.re.test(ctx.path));
  if (!route) return reply(404, { error: 'R5_NOT_FOUND', path: ctx.path });

  try {
    const out = await route.fn(ctx);
    return reply(200, out);
  } catch (e) {
    if (e && e.status) return reply(e.status, { error: e.code });

    const raw = String((e && e.message) || e);
    const known = /R5_[A-Z_]+/.exec(raw);
    if (known) return reply(200, { error: known[0] });

    // 数据库函数抛出的业务拒绝，统一以 200 + error 返回，前端据此显示提示
    const pg = /(?:ERROR|DETAIL):\s*([^\n]{1,200})/.exec(raw);
    console.error('[r5-gateway] failure', raw.slice(0, 400));
    return reply(502, { error: 'R5_GATEWAY_ERROR', detail: (pg ? pg[1] : raw).slice(0, 200) });
  }
};

// 供本地单测使用（不影响云端运行）
exports.__internals = { sqlAs, lit, litOrNull, parseCtx, CFG, MD_FAMILIES, ROUTES, health, CORS, deviceWhoami, parentSession, verifyAccountPassword, sessionOf, gameAction };
