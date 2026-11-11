/**
 * 《小小赛车 V2》R5 · 家庭级赛车存档同步 —— 客户端最小接入包（P4，交 ChatGPT Work）
 *
 * 边界（硬约束）：
 *  - 本文件不写 GitHub main，不改动游戏现有存档读写封装；通过独立模块接入。
 *  - family_id 一律由服务端从设备绑定表取得；本模块**不发送** family_id / authenticated。
 *  - 六星闪耀生日车永远不写入 localStorage / owned / current；
 *    birthday_owned 只从 GET 响应派生，仅作为返回值交给现有 getBirthdayClaim() UI 逻辑。
 *  - 音量 / 画质 / r5_device / r5.grant 等设备私有键绝不上传、绝不被云端覆盖。
 *  - 断网时本地 14 键照常写；事件进本地队列；恢复后按 event_id 重放。
 *  - 同步失败必须返回明确状态，绝不假报成功。
 *
 * 依赖：无第三方库；浏览器原生 fetch + localStorage（可注入，便于测试）。
 * 审计基准：GitHub main fddf06450205955ebae46cf0c59e50d23a9c7a6a。
 */

export const DEFAULT_BASE = 'https://normal-goose-d5g4qyzr8bb389a4a.service.tcloudbase.com/r5';
export const SAVE_VERSION = 4;

/** 车库存档 10 键 + 剧情 2 键 + 旧键 2 键（与备份工具 v2.0 的 RESET_KEYS 一致） */
export const SYNC_KEYS = Object.freeze([
  'lrv2.garage.meta', 'lrv2.garage.coins', 'lrv2.garage.tx', 'lrv2.garage.owned',
  'lrv2.garage.current', 'lrv2.garage.rewards.story', 'lrv2.garage.rewards.study',
  'lrv2.garage.claims', 'lrv2.garage.achievements', 'lrv2.garage.reward-ledger',
  'littleRacingV2.story.chapter1', 'littleRacingV2.story.chapter2',
  'lrv2.vehicle', 'lrv2.driverSkin',
  'lrv2.garage.items', 'lrv2.garage.fragments',
]);

/** 设备私有：绝不上传、绝不被云端覆盖 */
export const DEVICE_PRIVATE_KEYS = Object.freeze([
  'littleRacingV2.music', 'littleRacingV2.voice', 'oldSanJuanKart.audio',
  'lrv2.fsHintSeen', 'r5_device', 'r5_device_pending',
]);

export const BIRTHDAY_IDS = Object.freeze(['birthday-star-6', 'six-star-supercar-2026']);
export const QUEUE_KEY = 'lrv2.sync.queue';
export const DEAD_KEY = 'lrv2.sync.rejected';
export const STATE_KEY = 'lrv2.sync.state';
export const CH_STATE = Object.freeze(['idle', 'playing', 'done']);

/* ---------- 工具（canonical 必须与服务端逐字一致） ---------- */

export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}
export async function sha256Hex(s) {
  const t = typeof s === 'string' ? s : canonical(s);
  if (globalThis.crypto && globalThis.crypto.subtle) {
    const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // 非浏览器环境（Node 测试）由注入的 hashImpl 提供
  throw new Error('SHA256_UNAVAILABLE');
}
const asObj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
const asArr = v => Array.isArray(v) ? v : [];
const clone = v => JSON.parse(JSON.stringify(v));
const nowIso = () => new Date().toISOString();

function safeParse(s, fallback) {
  if (typeof s !== 'string' || !s) return fallback;
  try { return JSON.parse(s); } catch (_) { return fallback; }
}

/* ---------- 本地存档读取 ---------- */

export function readLocalSave(storage) {
  const g = k => storage.getItem(k);
  const j = (k, d) => safeParse(g(k), d);
  const coinsObj = asObj(j('lrv2.garage.coins', {}));
  return {
    coins: coinsObj,
    tx: asArr(j('lrv2.garage.tx', [])),
    owned: asObj(j('lrv2.garage.owned', {})),
    current: asObj(j('lrv2.garage.current', { vehicle: 'red' })),
    story: asObj(j('lrv2.garage.rewards.story', {})),
    study: asObj(j('lrv2.garage.rewards.study', {})),
    claims: asArr(j('lrv2.garage.claims', [])),
    achievements: asObj(j('lrv2.garage.achievements', {})),
    rewardLedger: asObj(j('lrv2.garage.reward-ledger', {})),
    chapter1: asObj(j('littleRacingV2.story.chapter1', { state: 'idle' })),
    chapter2: asObj(j('littleRacingV2.story.chapter2', { state: 'idle' })),
    meta: asObj(j('lrv2.garage.meta', { version: SAVE_VERSION })),
    items: asObj(j('lrv2.garage.items', {})), fragments: asObj(j('lrv2.garage.fragments', {})),
    raw: Object.fromEntries(SYNC_KEYS.map(k => [k, g(k)])),
  };
}

/** 把云端权威存档写回本地 14 键；绝不触碰设备私有键，绝不写生日车 */
export function writeLocalSave(storage, save) {
  const s = asObj(save);
  if (!Object.keys(s).length) return { written: 0, skipped: true };
  const owned = Object.assign({}, asObj(s.owned));
  for (const id of BIRTHDAY_IDS) delete owned[id];
  let current = typeof s.current_vehicle === 'string' ? s.current_vehicle : 'red';
  if (BIRTHDAY_IDS.includes(current)) current = 'red';
  const at = Date.now();
  const put = (k, v) => storage.setItem(k, JSON.stringify(v));
  put('lrv2.garage.coins', {
    coins: Number(s.coins_balance || 0), updatedAt: at,
    appliedRewards: asArr(s.coin_rewards),
  });
  put('lrv2.garage.owned', owned);
  put('lrv2.garage.current', { vehicle: current, updatedAt: at });
  put('lrv2.garage.rewards.story', asObj(s.story));
  put('lrv2.garage.rewards.study', asObj(s.study));
  put('lrv2.garage.claims', asArr(s.claims).slice(-60));
  put('lrv2.garage.achievements', asObj(s.achievements));
  put('lrv2.garage.reward-ledger', asObj(s.reward_ledger));
  put('littleRacingV2.story.chapter1', { state: CH_STATE.includes(s.chapter1_state) ? s.chapter1_state : 'idle', updatedAt: at });
  put('littleRacingV2.story.chapter2', { state: CH_STATE.includes(s.chapter2_state) ? s.chapter2_state : 'idle', updatedAt: at });
  storage.setItem('lrv2.vehicle', current);
  let written = 11;
  for (const field of ['items', 'fragments']) {
    if (s[field] && typeof s[field] === 'object' && !Array.isArray(s[field])) { put('lrv2.garage.' + field, asObj(s[field])); written++; }
  }
  // lrv2.garage.meta / .tx / .driverSkin 保留本地：tx 仅作展示，meta 版本由本地 persist 维护
  return { written, skipped: false, birthday_excluded: true };
}

/* ---------- 事件与补丁 ---------- */

const TX_KIND = Object.freeze({
  race: 'race_reward', purchase: 'purchase', grant: 'grant',
  import: 'grant', story: 'story_reward', reward: 'story_reward',
});

/** 从本地 tx 生成唯一事件；event_id = tx.id（跨设备稳定天然幂等键） */
export function eventsFromTx(tx) {
  const out = [];
  for (const t0 of asArr(tx)) {
    const t = asObj(t0);
    const id = String(t.id || '');
    const delta = Number(t.amount || 0);
    if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(id) || !Number.isInteger(delta)) continue;
    const payload = { txId: id, reason: String(t.reason || '') };
    if (t.vehicle_id) payload.vehicle_id = String(t.vehicle_id);
    const txt = JSON.stringify(payload);
    if (BIRTHDAY_IDS.some(b => txt.includes(b))) continue; // 生日车相关事件一律不上送
    out.push({ event_id: id, kind: TX_KIND[String(t.kind || '')] || 'grant', coin_delta: delta, payload });
  }
  return out;
}

/** 构造单调合并补丁；生日车 ID 在客户端就先剔除 */
export function buildPatch(local) {
  const l = asObj(local);
  const owned = Object.assign({}, asObj(l.owned));
  for (const id of BIRTHDAY_IDS) delete owned[id];
  let current = asObj(l.current).vehicle || 'red';
  if (BIRTHDAY_IDS.includes(current)) current = 'red';
  return {
    owned,
    current_vehicle: current,
    chapter1_state: CH_STATE.includes(asObj(l.chapter1).state) ? asObj(l.chapter1).state : 'idle',
    chapter2_state: CH_STATE.includes(asObj(l.chapter2).state) ? asObj(l.chapter2).state : 'idle',
    story: asObj(l.story), study: asObj(l.study), achievements: asObj(l.achievements),
    reward_ledger: asObj(l.rewardLedger), claims: asArr(l.claims),
    coin_rewards: asArr(asObj(l.coins).appliedRewards),
  };
}

function readQueue(storage) {
  const q = asObj(safeParse(storage.getItem(QUEUE_KEY), {}));
  return asArr(q.events);
}
function writeQueue(storage, events) {
  storage.setItem(QUEUE_KEY, JSON.stringify({ updatedAt: Date.now(), events }));
}

/* ---------- 主模块 ---------- */

export function createFamilySync(opts = {}) {
  const base = String(opts.baseUrl || DEFAULT_BASE).replace(/\/$/, '');
  const storage = opts.storage || globalThis.localStorage;
  const fetchImpl = opts.fetchImpl || globalThis.fetch.bind(globalThis);
  const hashImpl = opts.hashImpl || sha256Hex;
  const deviceToken = String(opts.deviceToken || storage.getItem('r5_device') || '');
  const onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : () => {};
  const MAX_EVENTS = 100;

  function setState(status, extra) {
    const st = Object.assign({ status, at: nowIso(), synced: status === 'SYNCED' }, extra || {});
    try { storage.setItem(STATE_KEY, JSON.stringify(st)); } catch (_) { /* 存储不可用不影响返回 */ }
    onStatus(st);
    return st;
  }

  async function post(route, body) {
    const r = await fetchImpl(base + route, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-r5-device': deviceToken },
      body: JSON.stringify(body || {}),
    });
    const text = await r.text();
    let j; try { j = JSON.parse(text); } catch (_) { j = { raw: text }; }
    if (!r.ok) { const e = new Error(j.error || ('HTTP_' + r.status)); e.status = r.status; e.body = j; throw e; }
    return j;
  }

  function quarantineRejected(rejected) {
    const dead = asArr(rejected).filter(x => x.reason !== 'DUPLICATE_EVENT_ID_IN_REQUEST');
    if (!dead.length) return;
    const queued = readQueue(storage), old = asArr(safeParse(storage.getItem(DEAD_KEY), []));
    for (const rejection of dead) {
      const event = queued.find(e => e.event_id === rejection.event_id);
      old.push({event: event || null, ...rejection, at: nowIso()});
    }
    storage.setItem(DEAD_KEY, JSON.stringify(old));
    const ids = new Set(dead.map(x => x.event_id));
    writeQueue(storage, queued.filter(e => !ids.has(e.event_id)));
  }

  /** 断网/离线时把事件安全入队；恢复后由 sync() 重放 */
  function queueEvent(e) {
    const q = readQueue(storage);
    q.push(e);
    writeQueue(storage, q);
    return setState('QUEUED_OFFLINE', { queued: q.length });
  }

  function grantItem(itemId, qty = 1, kind = 'item_grant') {
    return queueEvent({ event_id: 'item_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9),
      kind, coin_delta: 0, payload: { item_id: String(itemId), quantity_delta: Number(qty) } });
  }

  /** 核心同步：GET → POST sync（含冲突重试）→ 写回本地；任何失败都不假报成功 */
  async function sync() {
    if (!deviceToken) return setState('ERROR', { error: 'R5_DEVICE_REQUIRED' });
    let view;
    try {
      view = await post('/v1/racing/save/get', {});
    } catch (e) {
      return setState('OFFLINE', { error: String(e.message || e), http: e.status || 0 });
    }
    if (view.status !== 'OK') {
      return setState(view.status || 'ERROR', { error: view.status, birthday_owned: view.birthday_owned === true });
    }

    const local = readLocalSave(storage);
    const patch = buildPatch(local);
    const queued = readQueue(storage);
    const events = queued.concat(eventsFromTx(local.tx)).slice(0, MAX_EVENTS);
    let revision = view.save ? Number(view.save.revision) : 0;
    let out;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        out = await post('/v1/racing/save/sync', { expected_revision: revision, events, patch });
      } catch (e) {
        return setState('OFFLINE', { error: String(e.message || e), http: e.status || 0, queued: queued.length });
      }
      if (out.status === 'APPLIED') break;
      if (out.status === 'REVISION_CONFLICT' && Number.isInteger(out.revision)) {
        const refreshed = await post('/v1/racing/save/get', {});
        if (refreshed.status !== 'OK' || !refreshed.save) return setState(refreshed.status || 'ERROR');
        revision = Number(refreshed.save.revision); continue;
      }
      // Permanent rejects are archived with payload, never silently discarded.
      quarantineRejected(out.rejected_events);
      // DENIED / ERROR / SYNC_DISABLED_PROD / MIGRATION_* 一律明确失败
      return setState(out.status || 'ERROR', { error: out.error || out.status, zero_write: out.zero_write !== false, rejected_events: asArr(out.rejected_events),
        coins: out.coins_balance ?? out.save?.coins_balance ?? null,
        existing_event_conflicts: out.existing_event_conflicts || 0, save: out.save || null });
    }
    if (!out || out.status !== 'APPLIED' || !out.save) {
      return setState(out?.status === 'REVISION_CONFLICT' ? 'REVISION_CONFLICT' : 'ERROR', { error: 'R5_SYNC_NO_CONFIRMED_RESULT', queued: readQueue(storage).length });
    }

    quarantineRejected(out.rejected_events);
    writeLocalSave(storage, out.save);
    // 只清除服务端明确确认（applied / duplicate）的队列事件；
    // 被拒绝或未确认的必须保留，否则断网期间的道具/碎片事件会被误清空
    const confirmed = new Set([...asArr(out.applied_events), ...asArr(out.duplicate_events)]);
    const unconfirmed = readQueue(storage).filter(e => !confirmed.has(e.event_id));
    writeQueue(storage, unconfirmed);
    return setState(asArr(out.rejected_events).length ? 'REVIEW_REQUIRED' : 'SYNCED', {
      revision: out.revision, coins: Number(out.save.coins_balance || 0),
      birthday_owned: out.birthday_owned === true,
      warnings: asArr(out.warnings), rejected_events: asArr(out.rejected_events),
    });
  }

  /** 首次迁移：导出每设备原始备份（与备份工具 v2.0 同形），不做任何自动合并 */
  async function exportRawBackup(deviceLabel = 'device') {
    const keys = [];
    const exportKeys = new Set(SYNC_KEYS);
    for (let i=0; i < (storage.length || 0); i++) { const k = storage.key(i); if (k?.startsWith('lrv2.garage.backup.')) exportKeys.add(k); }
    for (const k of [...exportKeys].sort()) {
      const value = storage.getItem(k);
      if (typeof value !== 'string') continue;
      keys.push({ key: k, value, bytes: new TextEncoder().encode(value).length,
        chars: value.length, sha256: await hashImpl(value) });
    }
    return {
      tool: 'lrv2-backup-restore', version: '2.0', hashAlgo: 'SHA-256', scope: 'racing-save-only',
      exportedAt: nowIso(), origin: globalThis.location ? globalThis.location.origin : 'unknown',
      device: deviceLabel, count: keys.length,
      manifestSha256: await hashImpl(keys.map(k => k.key + ':' + k.sha256).sort().join('\n')), keys,
    };
  }

  async function uploadBackup(payload) {
    const digest = await hashImpl(canonical(payload));
    return post('/v1/racing/backup/put', { payload, sha256: digest, source: 'A-raw-backup-v2.0' });
  }
  const getMigrationReport = () => post('/v1/racing/migration/report', {});
  /** 必须由家长显式确认后才调用；服务端仍会做冲突复核 */
  const confirmMigration = confirmation => post('/v1/racing/migration/confirm', {
    expected_revision: confirmation.expected_revision, confirmation,
  });

  return {
    sync, queueEvent, grantItem, useItem: (id, q) => grantItem(id, -(Math.abs(Number(q) || 1)), 'item_use'),
    changeFragment: (id, delta) => queueEvent({
      event_id: 'frag_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9),
      kind: 'fragment_change', coin_delta: 0,
      payload: { item_id: String(id), quantity_delta: Number(delta) },
    }),
    exportRawBackup, uploadBackup, getMigrationReport, confirmMigration,
    readLocalSave: () => readLocalSave(storage),
    writeLocalSave: s => writeLocalSave(storage, s),
    buildPatch: () => buildPatch(readLocalSave(storage)),
    getState: () => asObj(safeParse(storage.getItem(STATE_KEY), {})),
    deviceReady: Boolean(deviceToken),
  };
}

export default createFamilySync;
