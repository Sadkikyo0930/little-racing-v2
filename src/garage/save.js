/* ------------------------------------------------------------------ *
 * 车库存档 —— 金币 / 交易记录 / 车辆所有权 / 当前车辆 / 奖励领取
 *
 * 设计原则（本轮的硬要求）：
 *
 *   1. **分别保存**。每一类数据一个 localStorage 键，而不是塞进一个 JSON。
 *      好处：某一片损坏只会丢那一片，其余照常；也方便单独导出排查。
 *   2. **绝不清空旧数据**。旧键（lrv2.vehicle / lrv2.driverSkin /
 *      littleRacingV2.story.chapter1 / 音频设置）只读不写不删。
 *   3. **失败一律降级**。隐私模式、配额满、JSON 损坏 → 用内存默认值，
 *      游戏照常玩，只是这次不持久化。
 *   4. **写入是幂等的**。同一场比赛的奖励用 raceId 去重，重复结算不会加钱。
 *
 * 键一览（前缀由构建期 VITE_SAVE_PREFIX 决定，正式版=lrv2、测试版=lrv2test）：
 *   ${PREFIX}.garage.meta            版本 / 创建时间
 *   ${PREFIX}.garage.coins           金币余额
 *   ${PREFIX}.garage.tx              金币交易记录（最多 120 条）
 *   ${PREFIX}.garage.owned           车辆拥有情况
 *   ${PREFIX}.garage.current         当前使用车辆
 *   ${PREFIX}.garage.rewards.story   剧情车辆奖励记录
 *   ${PREFIX}.garage.rewards.study   学习奖励领取记录
 *   ${PREFIX}.garage.claims          已发奖的比赛 id（防重复领取）
 * ------------------------------------------------------------------ */

/* v4：迁移改成「先落数据、核对成功、再写版本号」，旧版本号 3 的存档会重跑一次
 * 幂等迁移（已经拥有海龟车的不会重复发）。 */
export const GARAGE_VERSION = 4;

/* 存档键前缀（隔离核心，对应需求 1）：
 *   由构建期环境变量 VITE_SAVE_PREFIX 决定 ——
 *     正式版（默认、未设置时）：'lrv2'     → 键以 `lrv2.garage.` 开头，
 *                                    与现有正式版用户存档完全一致，一字不改；
 *     测试版：              'lrv2test' → 键以 `lrv2test.garage.` 开头，
 *                                    与正式版 localStorage 零重叠，互不串台。
 *   同一浏览器里正式版与测试版的金币 / 车辆 / 章节进度 / 奖励 / 成就彻底隔离。
 *   注意：这里读的是构建期注入的 VITE_SAVE_PREFIX（Vite 在构建期静态替换），
 *   运行期拿不到它；配置见各部署工作流与 vite.config.js。 */
const SAVE_PREFIX = (import.meta.env && import.meta.env.VITE_SAVE_PREFIX) || 'lrv2';
/* 'lrv2' → '' ；'lrv2test' → 'test'，用于派生章节进度的命名空间。 */
const STORY_SUFFIX = SAVE_PREFIX.startsWith('lrv2') ? SAVE_PREFIX.slice(4) : SAVE_PREFIX;
const STORY_NS = `littleRacingV2${STORY_SUFFIX}`;

const garageKey = (name) => `${SAVE_PREFIX}.garage.${name}`;

export const K = Object.freeze({
  meta: garageKey('meta'),
  coins: garageKey('coins'),
  tx: garageKey('tx'),
  owned: garageKey('owned'),
  current: garageKey('current'),
  story: garageKey('rewards.story'),
  study: garageKey('rewards.study'),
  claims: garageKey('claims'),
  achievements: garageKey('achievements'),
  /** 奖励账本（事务表）：每个奖励一条，记录 pending / completed 与已完成的步骤。 */
  rewardLedger: garageKey('reward-ledger'),
});

/* ------------------------------------------------------------------ *
 * 成就定义 & 第二章首次通关奖励
 *
 *   REWARD_ID_CH2_FIRST_CLEAR —— 独立奖励 ID，写进存档的 firstClear 记录，
 *     用它做「已领取」判断，绝不和普通比赛奖励（claims 数组）或车辆奖励混用。
 *   CH2_FIRST_CLEAR_COINS     —— 首通奖励的金币数（500）。
 *   CH2_ACHIEVEMENT           —— 「阳光沙滩冠军」成就定义。
 *
 *   设计硬要求（第四阶段）：
 *     1. 只在真正完成第二章比赛 + 有效结尾后发放；
 *     2. 普通比赛 / 第一章不能触发；
 *     3. 只发一次（已领取标记 = 唯一闸门）；
 *     4. 刷新 / 重玩 / 重复结算 / 重播结尾都不重发；
 *     5. 「加 500 金币」与「标记已领取」必须是一次性状态提交，
 *        写入失败不能显示成功、也不能留下可重复领取的漏洞。
 * ------------------------------------------------------------------ */
export const REWARD_ID_CH2_FIRST_CLEAR = 'chapter2.first_clear';
export const CH2_FIRST_CLEAR_COINS = 500;
export const CH2_ACHIEVEMENT = Object.freeze({
  id: 'beach-champion',
  name: '阳光沙滩冠军',
  desc: '完成第二章《阳光沙滩大冒险》并找回冠军奖杯',
  icon: 'star',
});

/** 全部成就（目前仅第二章一个；后续扩展只往这里加）。 */
export const ACHIEVEMENTS = Object.freeze([CH2_ACHIEVEMENT]);

/** 旧键：只读，不写、不删。 */
export const LEGACY = Object.freeze({
  vehicle: `${SAVE_PREFIX}.vehicle`,             // 阶段 3 的车型偏好（与正式版按前缀隔离）
  driverSkin: `${SAVE_PREFIX}.driverSkin`,       // 更早的驾驶员开关（与本系统无关）
  chapter1: `${STORY_NS}.story.chapter1`,        // 第一章进度（命名空间随前缀切换）
});

/* 与存档前缀联动的其余键（供其它模块复用，避免各自硬编码导致遗漏 / 串台）：
 *   - 第二章进度：正式版 littleRacingV2.story.chapter2 / 测试版 littleRacingV2test.story.chapter2
 *   - 音乐 / 语音 / 全屏提示 等偏好（设备级，但同样按前缀隔离，测试版不读正式版）
 *   - 备份键统一前缀，便于 listBackups / restoreBackup 精准筛选。 */
export const K_CHAPTER2 = `${STORY_NS}.story.chapter2`;
export const K_MUSIC = `${STORY_NS}.music`;
export const K_VOICE = `${STORY_NS}.voice`;
export const K_FS_HINT = `${SAVE_PREFIX}.fsHintSeen`;
export const BACKUP_PREFIX = `${SAVE_PREFIX}.garage.backup.`;
export const SAVE_PREFIX_NAME = SAVE_PREFIX;

/** 名次 → 金币。第 4–8 名统一 40。 */
export const RACE_REWARD = Object.freeze({ 1: 120, 2: 90, 3: 70, other: 40 });

const TX_LIMIT = 120;
const CLAIM_LIMIT = 60;

/* ----------------------------- storage ---------------------------- */
function store() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

/* 测试用：模拟写入失败（配额满 / 隐私模式）。
 *   _failAll    —— 所有写入都失败；
 *   _failKeys   —— 只让指定的键失败（用于验证「标记写成功、金币写失败」的
 *                   部分失败场景，确认不会留下可重复领取的漏洞）。 */
let _failAll = false;
let _failKeys = null;

export function __forceWriteFail(on) {
  _failAll = !!on;
  _failKeys = null;
}
export function __forceFailKeys(keys) {
  _failKeys = keys ? new Set(keys) : null;
  _failAll = false;
}

function readRaw(key) {
  try {
    return store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeRaw(key, text) {
  if (_failAll || (_failKeys && _failKeys.has(key))) return false;
  try {
    store()?.setItem(key, text);
    return true;
  } catch {
    return false;   // 配额满 / 隐私模式：静默失败，游戏继续
  }
}

function readJSON(key, fallback) {
  const raw = readRaw(key);
  if (raw == null) return fallback;
  try {
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    return writeRaw(key, JSON.stringify(value));
  } catch {
    return false;
  }
}

/** 写完立刻读回来核对，确认存储里的内容确实等于我们想写的（防「写一半 / 被挤掉」）。 */
function sameStored(key, value) {
  try {
    const back = readJSON(key, null);
    return JSON.stringify(back) === JSON.stringify(value);
  } catch {
    return false;
  }
}

/* ------------------------------ state ----------------------------- */
let cache = null;

function blank() {
  return {
    version: GARAGE_VERSION,
    createdAt: 0,
    migratedAt: 0,
    coins: 0,
    tx: [],
    owned: {},
    current: 'red',
    story: {},
    study: {},
    claims: [],
    achievements: {},
    /** 已随金币余额「原子」发放过的奖励 rewardId 列表（写在 K.coins 同一条记录里）。
     *  恢复时据此判断「金币是否已发放」，杜绝「金币写了、标记没写」的重复发放窗口。 */
    coinRewardIds: [],
    // 运行时标记（不持久化）
    _readOnly: !store(),
  };
}

function normalize(d) {
  d.coins = Math.max(0, Math.floor(Number(d.coins) || 0));
  d.tx = Array.isArray(d.tx) ? d.tx.filter((t) => t && typeof t === 'object') : [];
  if (d.tx.length > TX_LIMIT) d.tx = d.tx.slice(-TX_LIMIT);
  d.owned = (d.owned && typeof d.owned === 'object') ? d.owned : {};
  d.current = typeof d.current === 'string' ? d.current : 'red';
  d.story = (d.story && typeof d.story === 'object') ? d.story : {};
  d.study = (d.study && typeof d.study === 'object') ? d.study : {};
  d.claims = Array.isArray(d.claims) ? d.claims.filter((x) => typeof x === 'string') : [];
  if (d.claims.length > CLAIM_LIMIT) d.claims = d.claims.slice(-CLAIM_LIMIT);
  d.achievements = (d.achievements && typeof d.achievements === 'object') ? d.achievements : {};
  d.coinRewardIds = Array.isArray(d.coinRewardIds) ? d.coinRewardIds : [];
  return d;
}

/** 把分散的 8 个键读成一份内存对象。首次调用会顺带跑迁移。 */
export function load() {
  if (cache) return cache;

  const meta = readJSON(K.meta, null);
  const coinRec = readJSON(K.coins, null);
  const owned = readJSON(K.owned, null);
  const current = readJSON(K.current, null);

  const d = blank();
  d.version = GARAGE_VERSION;
  d.createdAt = Number(meta?.createdAt) || Date.now();
  d.migratedAt = Number(meta?.migratedAt) || 0;
  d.coins = Number(coinRec?.coins) || 0;
  d.coinRewardIds = Array.isArray(coinRec?.appliedRewards) ? coinRec.appliedRewards : [];
  d.tx = readJSON(K.tx, []);
  d.owned = (owned && typeof owned === 'object') ? owned : {};
  d.current = typeof current?.vehicle === 'string' ? current.vehicle : 'red';
  d.story = readJSON(K.story, {});
  d.study = readJSON(K.study, {});
  d.claims = readJSON(K.claims, []);
  d.achievements = readJSON(K.achievements, {});

  normalize(d);
  cache = d;
  return d;
}

/**
 * 全量写回 8 个键。只在数据真的变了之后调用。
 *
 * **顺序是有意的，别改**：先写金币 / 车辆 / 记录这些「数据键」，最后才写
 * meta —— meta 里带着 version 和 migratedAt，相当于这次写入的提交标记。
 *
 * 如果反过来先写 meta，一旦写到一半配额满了（owned 失败、meta 已经落盘），
 * 下次启动会看到「版本号说已经迁移过」直接跳过迁移，车辆所有权就永远补不
 * 回来了。这是本轮专门修的一个坑。
 *
 * 返回值：是否全部写成功。失败项记在 d._writeFailed 里，UI 可以据此提示
 * 「这台浏览器现在存不下存档」，而不是假装存好了。
 */
function persist() {
  const d = cache;
  if (!d) return false;
  const order = [
    [K.coins, { coins: d.coins, updatedAt: Date.now(), appliedRewards: d.coinRewardIds }],
    [K.tx, d.tx],
    [K.owned, d.owned],
    [K.current, { vehicle: d.current, updatedAt: Date.now() }],
    [K.story, d.story],
    [K.study, d.study],
    [K.claims, d.claims],
    [K.achievements, d.achievements],
    [K.meta, { version: GARAGE_VERSION, createdAt: d.createdAt, migratedAt: d.migratedAt }],
  ];
  const failed = [];
  for (const [key, value] of order) {
    if (!writeJSON(key, value)) failed.push(key);
  }
  d._writeFailed = failed;
  return failed.length === 0;
}

/** 当前这台设备还能不能存存档（无痕模式 / 配额满时会返回 false）。 */
export function persistHealth() {
  const d = load();
  const failed = d._writeFailed || [];
  return { ok: failed.length === 0, failed: failed.slice(), readOnly: !!d._readOnly };
}

/* ---------------------------- listeners --------------------------- */
const listeners = new Set();

/** 订阅存档变化（车库 UI / 首页金币共用）。返回退订函数。 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(reason) {
  const snap = snapshot();
  for (const fn of [...listeners]) {
    try { fn(snap, reason); } catch { /* 订阅者自己的错不该影响存档 */ }
  }
}

/** 只读快照：UI 只拿它渲染，避免直接改内存对象。 */
export function snapshot() {
  const d = load();
  return {
    version: d.version,
    coins: d.coins,
    tx: d.tx.map((t) => ({ ...t })),
    owned: { ...d.owned },
    current: d.current,
    story: { ...d.story },
    study: { ...d.study },
    claims: d.claims.slice(),
    readOnly: !!d._readOnly,
    writeFailed: (d._writeFailed || []).length > 0,
  };
}

/* ------------------------------ 金币 ------------------------------ */
function pushTx(kind, amount, reason, balance) {
  const d = cache;
  d.tx.push({
    id: `tx_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    kind,                         // 'race' | 'purchase' | 'grant' | 'import'
    amount,                       // 正数进账、负数消费
    reason,
    balance,
    at: Date.now(),
  });
  if (d.tx.length > TX_LIMIT) d.tx = d.tx.slice(-TX_LIMIT);
}

export function getCoins() {
  return load().coins;
}

/** 加金币（内部用；外部一般走 claimRaceReward / grantCoins）。 */
function addCoins(amount, reason, kind = 'grant') {
  const d = load();
  const n = Math.floor(Number(amount) || 0);
  if (!n) return d.coins;
  d.coins = Math.max(0, d.coins + n);
  pushTx(kind, n, reason, d.coins);
  persist();
  return d.coins;
}

/**
 * 手动发放金币（调试 / 未来的活动奖励）。返回新的余额。
 * 正式比赛奖励请走 claimRaceReward()，那条路径有去重。
 */
export function grantCoins(amount, reason = '奖励') {
  const before = getCoins();
  const after = addCoins(amount, reason, 'grant');
  if (after !== before) emit('coins');
  return after;
}

/* ---------------------------- 比赛奖励 ---------------------------- */
/** 生成一场比赛的唯一 id（结算去重靠它）。 */
export function makeRaceId() {
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function rewardForRank(rank) {
  const r = Math.floor(Number(rank) || 0);
  return RACE_REWARD[r] ?? RACE_REWARD.other;
}

export function hasClaimedRace(raceId) {
  if (!raceId) return true;
  return load().claims.includes(raceId);
}

/**
 * 领取一场比赛的结算奖励。
 *
 * @param {object} o
 * @param {string} o.raceId   本局唯一 id（必填，缺了就不发，避免重复）
 * @param {number} o.rank     最终名次（1–8）
 * @param {boolean} o.finished 是否真的跑完了全部圈数
 * @param {string} [o.note]   记进交易记录的说明
 * @returns {{granted:boolean, amount:number, coins:number, reason:string}}
 */
export function claimRaceReward({ raceId, rank, finished, note } = {}) {
  const d = load();
  if (!raceId) {
    return { granted: false, amount: 0, coins: d.coins, reason: 'no-race-id' };
  }
  if (!finished) {
    return { granted: false, amount: 0, coins: d.coins, reason: 'not-finished' };
  }
  if (d.claims.includes(raceId)) {
    return { granted: false, amount: 0, coins: d.coins, reason: 'duplicate' };
  }

  const amount = rewardForRank(rank);
  d.claims.push(raceId);
  if (d.claims.length > CLAIM_LIMIT) d.claims = d.claims.slice(-CLAIM_LIMIT);

  d.coins = Math.max(0, d.coins + amount);
  pushTx('race', amount, note || `比赛第 ${rank} 名`, d.coins);
  persist();
  emit('race-reward');

  return { granted: true, amount, coins: d.coins, reason: 'ok' };
}

/* ---------------------------- 车辆所有权 -------------------------- */
export function owns(vehicleId) {
  const d = load();
  if (vehicleId === 'red') return true;   // 默认赠送，永久拥有
  return !!d.owned[vehicleId];
}

/**
 * 授予车辆（剧情奖励 / 旧存档继承都走这里）。
 * 已经有车就**不重复发放**，返回 false。
 */
export function grantVehicle(vehicleId, source = 'reward', extra = {}) {
  const d = load();
  if (!vehicleId || vehicleId === 'red') return false;
  if (d.owned[vehicleId]) return false;
  d.owned[vehicleId] = { at: Date.now(), source, ...extra };
  persist();
  emit('vehicle-granted');
  return true;
}

/**
 * 金币购买。三步必须原子：检查 → 扣款 → 写所有权。
 * 任何一步不满足就整体不生效（不会出现「扣了钱没拿到车」）。
 *
 * @returns {{ok:boolean, reason:string, coins:number}}
 */
export function purchaseVehicle(vehicleId, price) {
  const d = load();
  const cost = Math.floor(Number(price) || 0);

  if (d.owned[vehicleId]) {
    return { ok: false, reason: 'already-owned', coins: d.coins };
  }
  if (cost <= 0) {
    return { ok: false, reason: 'no-price', coins: d.coins };
  }
  if (d.coins < cost) {
    return { ok: false, reason: 'not-enough-coins', coins: d.coins };
  }

  d.coins -= cost;
  d.owned[vehicleId] = { at: Date.now(), source: 'purchase', price: cost };
  pushTx('purchase', -cost, `购买车辆 ${vehicleId}`, d.coins);
  persist();
  emit('purchase');
  return { ok: true, reason: 'ok', coins: d.coins };
}

/* ---------------------------- 当前车辆 ---------------------------- */
export function getCurrent() {
  return load().current;
}

/**
 * 装备车辆。没拥有 / 没有模型就不能装备。
 * @returns {boolean} 是否真的切过去了
 */
export function setCurrent(vehicleId, { drivable } = {}) {
  const d = load();
  if (!vehicleId) return false;
  if (vehicleId !== 'red' && !d.owned[vehicleId]) return false;
  if (drivable !== undefined && !drivable) return false;
  if (d.current === vehicleId) return true;
  d.current = vehicleId;
  persist();
  emit('equip');
  return true;
}

/* ---------------------------- 剧情奖励 ---------------------------- */
/**
 * 第一章完成 → 授予海龟车。幂等：重复调用只发一次。
 * @returns {boolean} 这次是不是真的发了
 */
export function grantStoryChapter1() {
  const d = load();
  const already = d.story.chapter1?.granted;
  const granted = grantVehicle('turtle', 'story-chapter1', { chapter: 'chapter1' });
  if (!already) {
    d.story.chapter1 = {
      granted: true,
      at: Date.now(),
      vehicleId: 'turtle',
      ...(already ? { firstAt: d.story.chapter1.at } : {}),
    };
    persist();
  }
  return granted;
}

export function storyRewardState() {
  return { ...(load().story.chapter1 || {}) };
}

/* ------------------------------------------------------------------ *
 * 第二章首次通关奖励（500 金币 + 阳光沙滩冠军成就）—— 可恢复的事务
 *
 * 第四阶段上线前修复：把「一次性发奖」改成一个**可恢复的事务**，彻底消除
 * 「标记写成功、金币写失败 → 玩家被记为已领取却没拿到金币、且不能再领」的死锁。
 *
 * 设计（对应需求「可恢复的一次性奖励事务」）：
 *   · 每个奖励有唯一 rewardId（chapter2.first_clear），事务记录写进独立的
 *     lrv2.garage.reward-ledger（按 rewardId 单条）。
 *   · 事务有 pending / completed 两种持久化状态。先写「待完成事务」（WAL），
 *     落盘并核对后，才真正去动金币 / 成就。
 *   · 每一步都用 sameStored() 读回核对 —— 不只信内存，必须验证持久化后的结果。
 *   · 写入中途失败：事务留在 pending，已完成的步骤记在 applied 里，
 *     下次 reload / import / 手动 recover 时只补做缺失的部分，绝不重复发。
 *   · 旧存档（只有 firstClear.granted、没有 ledger）在启动时迁移成 completed，
 *     已正常领取的玩家不会多领。
 *
 * 幂等保证：无论重复结算 / 刷新 / 导入导出 / 存储部分失败，
 *   - 已 completed → 永不重发；
 *   - pending 且金币已落盘 → 视为已发放，只补完剩余步骤；
 *   - 同一份存档反复导入 → 合并 applied，最多补发一次。
 * ------------------------------------------------------------------ */

/** 奖励账本（事务表）。独立于其它键，单独读写，便于「先落盘事务、再动金币」。 */
function readLedger() {
  return readJSON(K.rewardLedger, {});
}
function writeLedger(ledger) {
  return writeJSON(K.rewardLedger, ledger);
}
function makeTxId() {
  return `rl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 严格校验「外部存档」的奖励账本，杜绝通过导入创建额外 / 异常奖励事务。
 *
 * 规则（对应需求「导入奖励账本的内容验证」）：
 *   1. 只允许官方定义的 rewardId（键名与记录内 rewardId 必须一致）；
 *   2. chapter2.first_clear 金额固定为 500（数字、有限、非负、且恰好等于固定值）；
 *   3. achievementId 必须是 beach-champion；
 *   4. status 只能是 pending 或 completed；
 *   5. applied 只能包含 coin / achievement 两个布尔字段；
 *   6. 未知奖励 ID / 异常金额 / 负数 / 非数字 / 错误成就 / 非法状态 / 非法 applied → 一律拒绝。
 *
 * 任何一条记录不合法 → 整份账本拒绝（返回 ok:false + 具体 reason），导入会整体失败，
 * 绝不会把脏数据写进存储、也不会据此多发一分钱。
 *
 * @returns {{ok:boolean, reason?:string, sanitized?:object}}
 */
function validateImportedRewardLedger(inLedger) {
  const known = new Set([REWARD_ID_CH2_FIRST_CLEAR]);
  const sanitized = {};
  for (const [id, rec] of Object.entries(inLedger || {})) {
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) {
      return { ok: false, reason: 'invalid-reward-ledger' };
    }
    // 1/6：只允许官方定义的 rewardId；键名与 rewardId 必须一致，否则视为未知 ID
    if (!known.has(id) || rec.rewardId !== id || !known.has(rec.rewardId)) {
      return { ok: false, reason: 'unknown-reward-id' };
    }
    // 2/7：金额固定为 500，必须是有限数字、非负、且恰好等于固定值（拒绝伪造 / 负数 / 非数字）
    const cd = rec.coinDelta;
    if (typeof cd !== 'number' || !Number.isFinite(cd) || cd < 0 || cd !== CH2_FIRST_CLEAR_COINS) {
      return { ok: false, reason: 'invalid-coin-delta' };
    }
    // 3：成就 id 必须是 beach-champion
    if (rec.achievementId !== CH2_ACHIEVEMENT.id) {
      return { ok: false, reason: 'invalid-achievement-id' };
    }
    // 4：状态只能是 pending 或 completed
    if (rec.status !== 'pending' && rec.status !== 'completed') {
      return { ok: false, reason: 'invalid-ledger-status' };
    }
    // 5：applied 只能含 coin / achievement 两个布尔字段
    const ap = rec.applied;
    if (ap != null) {
      if (typeof ap !== 'object' || Array.isArray(ap)) return { ok: false, reason: 'invalid-ledger-applied' };
      const keys = Object.keys(ap);
      if (keys.some((k) => k !== 'coin' && k !== 'achievement')) return { ok: false, reason: 'invalid-ledger-applied' };
      for (const k of ['coin', 'achievement']) {
        if (k in ap && typeof ap[k] !== 'boolean') return { ok: false, reason: 'invalid-ledger-applied' };
      }
    }
    sanitized[id] = {
      rewardId: rec.rewardId,
      txId: typeof rec.txId === 'string' ? rec.txId : makeTxId(),
      status: rec.status,
      coinDelta: cd,
      achievementId: rec.achievementId,
      applied: { coin: !!(ap && ap.coin), achievement: !!(ap && ap.achievement) },
      at: Number(rec.at) || Date.now(),
      completedAt: Number(rec.completedAt) || 0,
    };
  }
  return { ok: true, sanitized };
}

/**
 * 把某个奖励的「待完成事务」推进到完成。幂等：每步先查持久化真相，只补缺失部分。
 * 任何一步写入失败 → 立即返回 partial（ledger 仍是 pending），不伪造成功、绝不重复发。
 */
function applyRewardTx(rewardId) {
  const ledger = readLedger();
  const tx = ledger[rewardId];
  if (!tx) return { granted: false, reason: 'no-transaction', coins: load().coins, claimed: false };
  if (tx.status === 'completed') return { granted: false, reason: 'already-completed', coins: load().coins, claimed: true };

  const d = load();
  let stepFailed = null;

  // 步骤 1：金币 + rewardId 标记，必须在同一次 setItem 原子持久化。
  // 「金币已到账」与「本奖励已发放」是同一个不可拆分的存储记录：
  // 要么一起落盘，要么一起失败，绝不会出现「金币写了、标记没写」的中间态。
  if (!d.coinRewardIds.includes(rewardId)) {
    const newCoins = d.coins + tx.coinDelta;
    const newRec = {
      coins: newCoins,
      updatedAt: Date.now(),
      appliedRewards: [...d.coinRewardIds, rewardId],
    };
    if (!writeJSON(K.coins, newRec) || !sameStored(K.coins, newRec)) {
      // 原子写没落盘：金币和标记都没进存储，下次 reload 会重新发放，不会重复。
      stepFailed = 'coins';
    } else {
      d.coins = newCoins;
      d.coinRewardIds = newRec.appliedRewards;
      tx.applied.coin = true;
      pushTx('grant', tx.coinDelta, '第二章首次通关奖励 · 阳光沙滩冠军', newCoins);
      writeJSON(K.tx, d.tx);   // 交易日志（best-effort，失败不阻断发奖，标记已保证不重复）
    }
  } else {
    // 持久化记录里已经有本奖励的标记 → 金币当初是和标记一起写进去的，视为已发放。
    tx.applied.coin = true;
  }

  // 步骤 2：成就（写 K.achievements，核对）
  if (!stepFailed && !tx.applied.achievement) {
    if (!d.achievements[tx.achievementId]) {
      d.achievements[tx.achievementId] = { id: tx.achievementId, name: CH2_ACHIEVEMENT.name, at: Date.now() };
    }
    if (!writeJSON(K.achievements, d.achievements) || !sameStored(K.achievements, d.achievements)) {
      delete d.achievements[tx.achievementId];
      stepFailed = 'achievement';
    } else {
      tx.applied.achievement = true;
    }
  }

  // 任一步失败 → 写回 ledger（只记已完成的步骤），返回 partial；绝不伪造成功
  if (stepFailed) {
    ledger[rewardId] = { ...tx };
    writeLedger(ledger);
    return { granted: false, reason: 'persist-failed', step: stepFailed, coins: d.coins, claimed: false, partial: true };
  }

  // 全部完成 → ledger 置 completed（写前日志先落盘并核对）
  tx.status = 'completed';
  tx.completedAt = Date.now();
  ledger[rewardId] = { ...tx };
  if (!writeLedger(ledger) || !sameStored(K.rewardLedger, ledger)) {
    // ledger 没落盘：金币/成就已写入存储，不能回滚它们，只能让 ledger 重新 pending，
    // 下次 reload 继续补完（不重复发金币，因为 applied.coin 仍是 true）。
    tx.status = 'pending';
    tx.completedAt = 0;
    ledger[rewardId] = { ...tx };
    writeLedger(ledger);
    return { granted: false, reason: 'persist-failed', coins: d.coins, claimed: false, partial: true };
  }

  // 顺带把 firstClear 展示标记写进 d.story（best-effort，失败不阻塞完成判定）
  d.story = {
    ...(d.story || {}),
    chapter2: { ...(d.story?.chapter2 || {}), firstClear: {
      rewardId: tx.rewardId, granted: true, at: tx.at, coins: tx.coinDelta,
      achievementId: tx.achievementId, achievementName: CH2_ACHIEVEMENT.name,
    } },
  };
  writeJSON(K.story, d.story);
  emit('chapter2-reward');
  return {
    granted: true, amount: tx.coinDelta, coins: d.coins, claimed: true,
    rewardId: tx.rewardId, achievementId: tx.achievementId,
    achievementName: CH2_ACHIEVEMENT.name, partial: false,
  };
}

/**
 * 旧存档兼容：只有 firstClear.granted、没有 ledger 的，迁移成已完成事务（已正常领取的不多领）。
 *
 * 返回结构（便于 importSave 区分「无需迁移」与「迁移失败」）：
 *   { done, migrated, failed }
 *   - migrated=true  确实写了一条 completed 账本 + 原子补了 coinRewards 标记；
 *   - failed=true    迁移被尝试但存储写入核对失败（绝不可以假装成功）。
 */
export function migrateRewards() {
  const d = load();
  const ledger = readLedger();
  const fc = d.story?.chapter2?.firstClear;
  // 旧存档兼容：firstClear 已领取、且账本里还没有这条记录的，迁移成已完成事务。
  // 不强制要求旧存档带 rewardId（更老的存档可能没有该字段）；只要 granted 为真且
  // rewardId 字段（若有）属于本奖励即可，避免漏迁移。已正常领取的玩家不会多领。
  if (fc?.granted && (fc.rewardId == null || fc.rewardId === REWARD_ID_CH2_FIRST_CLEAR) && !ledger[REWARD_ID_CH2_FIRST_CLEAR]) {
    ledger[REWARD_ID_CH2_FIRST_CLEAR] = {
      rewardId: REWARD_ID_CH2_FIRST_CLEAR,
      txId: makeTxId(),
      status: 'completed',
      coinDelta: Number(fc.coins) || CH2_FIRST_CLEAR_COINS,
      achievementId: fc.achievementId || CH2_ACHIEVEMENT.id,
      applied: { coin: true, achievement: true },
      at: Number(fc.at) || Date.now(),
      completedAt: Number(fc.at) || Date.now(),
    };
    // 同步把 rewardId 写进金币记录（原子：余额 + 标记）。旧存档余额里已经有那 500，
    // 这里只补标记、不动余额，避免重复发放；写入必须核对成功，否则不假装迁移成功。
    if (!d.coinRewardIds.includes(REWARD_ID_CH2_FIRST_CLEAR)) {
      const coinRec = {
        coins: d.coins,
        updatedAt: Date.now(),
        appliedRewards: [...d.coinRewardIds, REWARD_ID_CH2_FIRST_CLEAR],
      };
      if (!writeJSON(K.coins, coinRec) || !sameStored(K.coins, coinRec)) {
        return { done: true, migrated: false, failed: true };
      }
      d.coinRewardIds = coinRec.appliedRewards;
    }
    if (!writeLedger(ledger) || !sameStored(K.rewardLedger, ledger)) {
      return { done: true, migrated: false, failed: true };
    }
    return { done: true, migrated: true, failed: false };
  }
  return { done: true, migrated: false, failed: false };
}

/** 重新加载后自动恢复未完成的事务：只补缺失的金币 / 成就，不重复发。幂等。 */
export function recoverRewardTransactions() {
  const ledger = readLedger();
  let recovered = 0;
  for (const tx of Object.values(ledger)) {
    if (tx && tx.status === 'pending') {
      const r = applyRewardTx(tx.rewardId);
      if (r && (r.granted || r.partial)) recovered++;
    }
  }
  return recovered;
}

export function chapter2FirstClearState() {
  const ledger = readLedger();
  const rec = ledger[REWARD_ID_CH2_FIRST_CLEAR];
  if (rec && rec.status === 'completed') {
    return {
      claimed: true,
      at: rec.completedAt || rec.at || 0,
      coins: Number(rec.coinDelta) || 0,
      rewardId: rec.rewardId,
      achievementId: rec.achievementId,
      achievementName: CH2_ACHIEVEMENT.name,
    };
  }
  // 兼容旧存档：firstClear.granted 仍作为已领取信号
  const d = load();
  const fc = d.story?.chapter2?.firstClear;
  return {
    claimed: !!fc?.granted,
    at: fc?.at || 0,
    coins: Number(fc?.coins) || 0,
    rewardId: fc?.rewardId || '',
    achievementId: fc?.achievementId || '',
    achievementName: fc?.achievementName || CH2_ACHIEVEMENT.name,
  };
}

export function grantChapter2FirstClear() {
  const ledger = readLedger();
  const tx = ledger[REWARD_ID_CH2_FIRST_CLEAR];
  const d = load();

  // 已经完整完成过 → 永不重发
  if (tx && tx.status === 'completed') {
    return { granted: false, reason: 'already-claimed', coins: d.coins, claimed: true };
  }
  // 金币记录的 rewardId 标记已在存储里（原子写入：余额 + 标记同一次 setItem）
  // → 视为金币已发放，只补完成就与账本状态，绝不再加金币。
  if (d.coinRewardIds.includes(REWARD_ID_CH2_FIRST_CLEAR)) {
    let cur = tx;
    if (!cur) {
      // 极端情况：金币+标记已落盘、账本却丢了 → 重建 completed 账本并补成就
      const rebuilt = readLedger();
      rebuilt[REWARD_ID_CH2_FIRST_CLEAR] = {
        rewardId: REWARD_ID_CH2_FIRST_CLEAR,
        txId: makeTxId(),
        status: 'completed',
        coinDelta: CH2_FIRST_CLEAR_COINS,
        achievementId: CH2_ACHIEVEMENT.id,
        applied: { coin: true, achievement: false },
        at: Date.now(),
        completedAt: Date.now(),
      };
      if (!writeLedger(rebuilt) || !sameStored(K.rewardLedger, rebuilt)) {
        return { granted: false, reason: 'persist-failed', coins: d.coins, claimed: true };
      }
      cur = rebuilt[REWARD_ID_CH2_FIRST_CLEAR];
    }
    cur.applied.coin = true;
    const r = applyRewardTx(REWARD_ID_CH2_FIRST_CLEAR);
    return { granted: r.granted, ...r, claimed: true };
  }

  // 全新发放：先写「待完成事务」（WAL），落盘并核对后才开始动金币
  if (!tx) {
    const at = Date.now();
    ledger[REWARD_ID_CH2_FIRST_CLEAR] = {
      rewardId: REWARD_ID_CH2_FIRST_CLEAR,
      txId: makeTxId(),
      status: 'pending',
      coinDelta: CH2_FIRST_CLEAR_COINS,
      achievementId: CH2_ACHIEVEMENT.id,
      applied: { coin: false, achievement: false },
      at,
      completedAt: 0,
    };
    if (!writeLedger(ledger) || !sameStored(K.rewardLedger, ledger)) {
      return { granted: false, reason: 'persist-failed', coins: d.coins, claimed: false };
    }
  }
  return applyRewardTx(REWARD_ID_CH2_FIRST_CLEAR);
}

/** 测试用：返回奖励账本当前状态（事务 / 步骤完成度）。 */
export function debugRewardLedger() {
  const ledger = readLedger();
  const tx = ledger[REWARD_ID_CH2_FIRST_CLEAR];
  return {
    exists: !!tx,
    status: tx?.status || 'none',
    applied: tx ? { ...tx.applied } : null,
    rewardId: tx?.rewardId || '',
    coinDelta: tx ? Number(tx.coinDelta) : 0,
  };
}

/** 成就列表（含解锁状态），供成就墙渲染。 */
export function getAchievements() {
  const d = load();
  return ACHIEVEMENTS.map((a) => ({
    ...a,
    unlocked: !!d.achievements?.[a.id],
    at: Number(d.achievements?.[a.id]?.at) || 0,
  }));
}

export function isAchievementUnlocked(id) {
  return !!load().achievements?.[id];
}

/* ---------------------------- 学习奖励 ---------------------------- */
/** 记录一次学习奖励领取（真正的校验在 garage/studyReward.js）。 */
export function recordStudyClaim(code, vehicleId, meta = {}) {
  const d = load();
  if (d.study[code]) return false;
  d.study[code] = { at: Date.now(), vehicleId, ...meta };
  persist();
  emit('study-claim');
  return true;
}

export function hasStudyClaim(code) {
  return !!load().study[code];
}

export function studyClaims() {
  return { ...load().study };
}

/* ---------------------------- 旧存档迁移 -------------------------- */
/**
 * 从旧版本迁移。只读旧键，不删不改。
 *
 * 判定「老玩家拥有海龟车」的三条独立证据（任一成立就算）：
 *   A. lrv2.vehicle 存在 —— 这个键是阶段 3 才有的，出现过就说明当时用过
 *      那个版本，而那个版本里海龟车是零门槛可选的，不能因为新版本改规则
 *      就把车收回去。
 *   B. lrv2.vehicle === 'turtle' —— 明确选过。
 *   C. 第一章已完成 —— 现在的解锁条件本来就满足。
 *
 * 注意 B 里的「选回红车」也算：旧键值是 'red' 只说明当前开的是红车，
 * 而那个版本里海龟车依然可选 —— 所以只要键存在就继承，不看它存的是谁。
 *
 * 提交方式是「两段式」：
 *   1. 先把 owned / story / current 写进存储，并**读回来核对**；
 *   2. 核对通过才写 meta（version + migratedAt）。
 * 任何一步失败都不写版本号，下次启动会重新跑一遍（幂等，不会重复发车）。
 *
 * @returns {{migrated:boolean, steps:string[], fromVersion:number,
 *            repaired:boolean, persisted:boolean, pending:boolean}}
 */
export function migrate() {
  const d = load();
  const meta = readJSON(K.meta, null);
  const fromVersion = Number(meta?.version) || 0;

  const legacyVehicle = readRaw(LEGACY.vehicle);
  const ch1 = readJSON(LEGACY.chapter1, null);
  const ch1Done = ch1?.state === 'done';
  const hasEvidence = legacyVehicle != null || ch1Done;

  // 快路径：版本号已经是新的、迁移做过、而且该有的车确实在。
  // 如果版本号说迁移过、但证据对应的车不在（说明上次写到一半失败了），
  // 这里**不会**提前返回，而是继续往下跑一遍修复。
  if (fromVersion >= GARAGE_VERSION && d.migratedAt && (!hasEvidence || d.owned.turtle)) {
    return { migrated: false, steps: [], fromVersion, repaired: false, persisted: true, pending: false };
  }
  const repaired = fromVersion >= GARAGE_VERSION || !!d.migratedAt;

  const steps = [];

  // A / B：旧版本用过车
  if (legacyVehicle != null) {
    if (!d.owned.turtle) {
      d.owned.turtle = { at: Date.now(), source: 'legacy-version', note: '旧版本已可驾驶' };
      steps.push(`旧存档存在 ${LEGACY.vehicle} → 继承海龟冲浪车`);
    }
    if (legacyVehicle === 'turtle' || legacyVehicle === 'red') {
      // 旧键只允许这两个值；保持一致，但只有真能开才写进去（下面 canEquip 会兜底）
      if (legacyVehicle === 'red' || d.owned.turtle) d.current = legacyVehicle;
      steps.push(`当前车辆从旧键迁移：${legacyVehicle}`);
    }
  }

  // C：第一章已完成
  if (ch1Done) {
    if (!d.owned.turtle) {
      d.owned.turtle = { at: Date.now(), source: 'story-chapter1' };
      steps.push('第一章已完成 → 解锁海龟冲浪车');
    }
    if (!d.story.chapter1) {
      d.story.chapter1 = {
        granted: true, at: Number(ch1.updatedAt) || Date.now(), vehicleId: 'turtle', migrated: true,
      };
      steps.push('补记第一章车辆奖励记录');
    }
  }

  // 红色赛车：默认赠送，永久拥有（不写 owned，靠 owns() 的默认值）
  if (d.current !== 'red' && !d.owned[d.current]) {
    d.current = 'red';
    steps.push('当前车辆无效 → 回到红色赛车');
  }

  if (!d.createdAt) d.createdAt = Date.now();

  /* ---- 第一段：数据键先落盘 ---- */
  const dataWritten = [
    writeJSON(K.owned, d.owned),
    writeJSON(K.story, d.story),
    writeJSON(K.current, { vehicle: d.current, updatedAt: Date.now() }),
  ].every(Boolean);

  /* ---- 核对：不是信写入函数的返回值，而是把存储读回来对一遍 ---- */
  const storedOwned = readJSON(K.owned, null);
  const missing = storedOwned
    ? Object.keys(d.owned).filter((id) => !storedOwned[id])
    : Object.keys(d.owned);
  const verified = dataWritten && missing.length === 0;

  /* ---- 第二段：核对通过才提交版本号 ---- */
  let metaOk = false;
  if (verified) {
    metaOk = writeJSON(K.meta, {
      version: GARAGE_VERSION, createdAt: d.createdAt, migratedAt: Date.now(),
    });
    if (metaOk) d.migratedAt = Date.now();
  }
  if (!verified || !metaOk) {
    // 不写版本号 → 下次启动重新迁移。内存里保留这次解锁（这一局照常能开），
    // 但绝不假装已经存好了。
    d.migratedAt = 0;
    d._writeFailed = verified ? [K.meta] : [K.owned];
    console.warn('[garage] 迁移没能写进存储：', d._writeFailed.join(', '));
  }

  return {
    migrated: true,
    steps,
    fromVersion,
    repaired,
    persisted: verified && metaOk,
    pending: !(verified && metaOk),
  };
}

/* --------------------------- 导出 / 导入 -------------------------- */
const EXPORT_KEYS = [K.meta, K.coins, K.tx, K.owned, K.current, K.story, K.study, K.claims, K.achievements, K.rewardLedger];

function fmtDate(ts) {
  const d = new Date(ts || Date.now());
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** 备份键用的时间戳（带秒），避免一分钟内连续导入两份时互相覆盖。 */
function fmtStamp(ts) {
  const d = new Date(ts || Date.now());
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-`
    + `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * 导出一份存档文本（给用户抄 / 保存）。
 * 包含：车库全部数据 + 第一章进度（换手机时剧情也不丢）。
 * **不包含**音乐 / 静音 / 音量等设备偏好 —— 那些是这台手机的习惯，不该跨设备覆盖。
 */
export function exportSave() {
  const d = load();
  const payload = {
    app: 'little-racing-v2',
    kind: 'garage-save',
    version: GARAGE_VERSION,
    exportedAt: Date.now(),
    exportedAtText: fmtDate(Date.now()),
    coins: d.coins,
    tx: d.tx,
    owned: d.owned,
    current: d.current,
    story: d.story,
    study: d.study,
    claims: d.claims,
    achievements: d.achievements,
    rewardLedger: readLedger(),
    coinRewards: d.coinRewardIds.slice(),
    chapter1: readJSON(LEGACY.chapter1, null),
    chapter2: readJSON(K_CHAPTER2, null),
  };
  return JSON.stringify(payload, null, 2);
}

/** 导出文件名（不含路径）。 */
export function exportFileName() {
  return `小小赛车-存档-${fmtDate(Date.now())}.json`;
}

/**
 * 导入存档。
 *
 * @param {string} text 导出的 JSON 文本
 * @param {'replace'|'merge'} mode
 *   replace —— 覆盖金币 / 车辆；剧情进度只在「导入的更新」时才覆盖
 *   merge   —— 金币取较大值、车辆取并集、当前车辆优先导入的
 * @param {object} [opts]
 * @param {boolean} [opts.allowNoBackup=false]
 *   备份失败时是否仍然允许导入。**默认 false**：备份没写成功就原地返回
 *   `reason:'backup-failed'`，一个字节都不改，让界面去问用户「要不要冒险」。
 *   只有用户明确点了「仍然导入」才会传 true。
 * @returns {{ok:boolean, reason:string, backupKey?:string, coins?:number, steps?:string[]}}
 */
export function importSave(text, mode = 'replace', opts = {}) {
  let data;
  try {
    data = JSON.parse(String(text || '').trim());
  } catch {
    return { ok: false, reason: 'bad-json' };
  }
  if (!data || data.kind !== 'garage-save' || data.app !== 'little-racing-v2') {
    return { ok: false, reason: 'not-our-save' };
  }
  if (Number(data.version) > GARAGE_VERSION) {
    return { ok: false, reason: 'too-new' };
  }

  const d = load();
  // 先备份：导入是破坏性操作，必须留一条回滚路。
  // 备份失败时**不往下走** —— 覆盖了却回不去，比不让导入糟糕得多。
  const bk = backupNow('before-import');
  if (!bk.ok && !opts.allowNoBackup) {
    return { ok: false, reason: 'backup-failed', backupReason: bk.reason, canForce: true };
  }
  const backupKey = bk.ok ? bk.key : '';

  const steps = [];
  const inCoins = Math.max(0, Math.floor(Number(data.coins) || 0));
  const inOwned = (data.owned && typeof data.owned === 'object') ? data.owned : {};

  if (mode === 'merge') {
    if (inCoins > d.coins) { d.coins = inCoins; steps.push(`金币 ${inCoins} > ${d.coins}，取较大值`); }
    for (const [id, rec] of Object.entries(inOwned)) {
      if (!d.owned[id] && rec) { d.owned[id] = rec; steps.push(`合并车辆 ${id}`); }
    }
    for (const [k, v] of Object.entries(data.story || {})) {
      if (!d.story[k] && v) d.story[k] = v;
    }
    for (const [k, v] of Object.entries(data.study || {})) {
      if (!d.study[k] && v) d.study[k] = v;
    }
    if (Array.isArray(data.claims)) {
      for (const id of data.claims) if (!d.claims.includes(id)) d.claims.push(id);
      if (d.claims.length > CLAIM_LIMIT) d.claims = d.claims.slice(-CLAIM_LIMIT);
    }
    if (Array.isArray(data.tx)) {
      const ids = new Set(d.tx.map((t) => t?.id));
      for (const t of data.tx) if (t?.id && !ids.has(t.id)) d.tx.push(t);
      if (d.tx.length > TX_LIMIT) d.tx = d.tx.slice(-TX_LIMIT);
    }
    if (data.current && (data.current === 'red' || d.owned[data.current])) d.current = data.current;
    for (const [k, v] of Object.entries(data.achievements || {})) {
      if (!d.achievements[k] && v) d.achievements[k] = v;
    }
    const inRewards = Array.isArray(data.coinRewards) ? data.coinRewards : [];
    d.coinRewardIds = [...new Set([...d.coinRewardIds, ...inRewards])];
  } else {
    d.coins = inCoins;
    d.coinRewardIds = Array.isArray(data.coinRewards) ? data.coinRewards : [];
    d.owned = {};
    for (const [id, rec] of Object.entries(inOwned)) if (rec) d.owned[id] = rec;
    d.story = (data.story && typeof data.story === 'object') ? data.story : {};
    d.study = (data.study && typeof data.study === 'object') ? data.study : {};
    d.claims = Array.isArray(data.claims) ? data.claims.filter((x) => typeof x === 'string') : [];
    d.tx = Array.isArray(data.tx) ? data.tx.slice(-TX_LIMIT) : [];
    d.achievements = (data.achievements && typeof data.achievements === 'object') ? data.achievements : {};
    d.current = (data.current === 'red' || d.owned[data.current]) ? data.current : 'red';
    steps.push('已覆盖金币 / 车辆 / 奖励记录');
  }

  // 第一章进度：只在导入的「更靠后」时才覆盖，绝不让 DONE 退回 PLAYING
  const inCh1 = data.chapter1;
  if (inCh1 && typeof inCh1 === 'object') {
    const cur = readJSON(LEGACY.chapter1, null);
    const rank = (s) => (s === 'done' ? 2 : s === 'playing' ? 1 : 0);
    if (rank(inCh1.state) > rank(cur?.state)) {
      writeJSON(LEGACY.chapter1, { state: inCh1.state, updatedAt: Number(inCh1.updatedAt) || Date.now() });
      steps.push(`第一章进度更新：${cur?.state || 'idle'} → ${inCh1.state}`);
    }
  }

  // 第二章进度：同样只在导入的「更靠后」时才覆盖（KEY2 在 progress.js，这里用字面值）
  const inCh2 = data.chapter2;
  if (inCh2 && typeof inCh2 === 'object') {
    const cur = readJSON(K_CHAPTER2, null);
    const rank = (s) => (s === 'done' ? 2 : s === 'playing' ? 1 : 0);
    if (rank(inCh2.state) > rank(cur?.state)) {
      writeJSON(K_CHAPTER2, { state: inCh2.state, updatedAt: Number(inCh2.updatedAt) || Date.now() });
      steps.push(`第二章进度更新：${cur?.state || 'idle'} → ${inCh2.state}`);
    }
  }

  /* 奖励账本：永远「合并」而非覆盖，避免导入把已完成的奖励打回 pending 后重复发。
   *   · 已完成优先（completed > pending）；
   *   · 两个都 pending 时合并 applied（OR），已完成的步骤不会回退。
   * 之后统一跑一次回收，补全导入存档里残留的 pending 事务（最多补发一次）。 */
  {
    const curLedger = readLedger();
    const inLedger = (data.rewardLedger && typeof data.rewardLedger === 'object' && !Array.isArray(data.rewardLedger)) ? data.rewardLedger : {};
    // 严格校验导入的账本：未知奖励 ID / 异常金额 / 错误成就 / 非法状态 / 非法 applied 一律拒绝。
    // 校验失败 → 整份导入作废，绝不把脏账本写进存储、也绝不据此多发钱。
    const v = validateImportedRewardLedger(inLedger);
    if (!v.ok) {
      return { ok: false, reason: v.reason, backupKey, coins: d.coins, steps };
    }
    for (const [id, rec] of Object.entries(v.sanitized)) {
      const cur = curLedger[id];
      if (!cur) { curLedger[id] = rec; continue; }
      if (cur.status === 'completed') continue;             // 已完成优先
      if (rec.status === 'completed') { curLedger[id] = rec; continue; }
      curLedger[id] = {
        ...cur,
        applied: {
          coin: cur.applied?.coin || rec.applied?.coin,
          achievement: cur.applied?.achievement || rec.applied?.achievement,
        },
      };
    }
    if (!writeJSON(K.rewardLedger, curLedger) || !sameStored(K.rewardLedger, curLedger)) {
      // 账本没写进存储：不能假装导入成功（否则后续回收可能补发错乱）。
      return { ok: false, reason: 'reward-ledger-write-failed', backupKey, coins: d.coins, steps };
    }
  }

  normalize(d);
  persist();
  // 问题一修复：导入后立即把「firstClear.granted 但无账本」的旧奖励迁移成已完成事务，
  // 避免用户在「不刷新页面」的情况下立刻重玩第二章导致重复领取（800 → 1300）。
  // 迁移是原子的（余额 + 标记同一次 setItem），只补标记、不动余额；
  // 迁移被尝试却写入失败 → 必须显式返回导入未完成，绝不假装成功。
  const mr = migrateRewards();
  if (mr.failed) {
    return { ok: false, reason: 'migrate-failed', backupKey, coins: d.coins, steps };
  }
  recoverRewardTransactions();
  pushTx('import', 0, `导入存档（${mode === 'merge' ? '合并' : '覆盖'}）`, d.coins);
  persist();
  emit('import');
  return { ok: true, reason: 'ok', backupKey, forced: !bk.ok, coins: d.coins, steps };
}

/**
 * 把当前存档另存一份备份（同一个浏览器内的保险）。
 * 键名形如 lrv2.garage.backup.2026-11-05-1054
 */
/**
 * 把当前存档另存一份备份（同一个浏览器内的保险）。
 * 键名形如 lrv2.garage.backup.2026-11-05-105432
 *
 * **会核对**：写完立刻读回来，确认 keys 真的在。配额满的时候 setItem 有可能
 * 直接把旧值挤掉或写一半，所以不能只看是不是抛异常。
 *
 * @returns {{ok:boolean, key:string, reason:string}}
 */
export function backupNow(tag = 'manual') {
  const key = `${BACKUP_PREFIX}${fmtStamp(Date.now())}${tag === 'manual' ? '' : `-${tag}`}`;
  const dump = {};
  for (const k of EXPORT_KEYS) dump[k] = readRaw(k);
  if (!writeJSON(key, { at: Date.now(), tag, keys: dump })) {
    return { ok: false, key: '', reason: 'write-failed' };
  }
  const back = readJSON(key, null);
  if (!back || !back.keys || typeof back.keys !== 'object') {
    try { store()?.removeItem(key); } catch { /* 忽略 */ }
    return { ok: false, key: '', reason: 'verify-failed' };
  }
  // 只保留最近 5 份备份，避免撑爆配额
  try {
    const all = [];
    const ls = store();
    for (let i = 0; i < (ls?.length || 0); i++) {
      const k = ls.key(i);
      if (k && k.startsWith(BACKUP_PREFIX)) all.push(k);
    }
    all.sort();
    for (const k of all.slice(0, Math.max(0, all.length - 5))) ls.removeItem(k);
  } catch { /* 忽略 */ }
  return { ok: true, key, reason: 'ok' };
}

/** 备份列表（给「回滚」用）。 */
export function listBackups() {
  const out = [];
  try {
    const ls = store();
    for (let i = 0; i < (ls?.length || 0); i++) {
      const k = ls.key(i);
      if (k && k.startsWith(BACKUP_PREFIX)) {
        const v = readJSON(k, null);
        out.push({ key: k, at: Number(v?.at) || 0, tag: v?.tag || '' });
      }
    }
  } catch { /* 忽略 */ }
  return out.sort((a, b) => b.at - a.at);
}

/**
 * 从某个备份回滚（只恢复车库的 8 个键）。
 *
 * 回滚本身也是破坏性操作：先把**当前**状态另存一份 `before-restore`，
 * 万一回错了还能再回来一次，不会一步走死。
 */
export function restoreBackup(key) {
  const snap = readJSON(key, null);
  if (!snap?.keys) return { ok: false, reason: 'no-backup' };
  const safety = backupNow('before-restore');
  const failed = [];
  for (const k of EXPORT_KEYS) {
    const raw = snap.keys[k];
    if (typeof raw === 'string' && !writeRaw(k, raw)) failed.push(k);
  }
  cache = null;                 // 丢掉内存副本，下次 load() 重新读
  emit('restore');
  if (failed.length) {
    return { ok: false, reason: 'write-failed', failed, backedUp: safety.ok, coins: load().coins };
  }
  return { ok: true, reason: 'ok', backedUp: safety.ok, coins: load().coins };
}

/** 测试用：只丢内存缓存（等于「重新打开游戏」），不动任何存储。 */
export function __dropCacheForTests() {
  cache = null;
}

/** 测试用：把内存与存储整份清掉（只清车库，不碰剧情 / 音频 / 旧键）。 */
export function __resetGarageForTests() {
  for (const k of EXPORT_KEYS) {
    try { store()?.removeItem(k); } catch { /* 忽略 */ }
  }
  cache = null;
}
