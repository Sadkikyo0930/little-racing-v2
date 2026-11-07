/* ------------------------------------------------------------------ *
 * 车库车辆目录
 *
 * 这里是**唯一**的车辆清单：车库卡片、右侧解锁面板、比赛出场逻辑全部读它。
 * 新增一辆车只需要在这里加一条 + 在 garage/stage.js 里给它一个展示模型。
 *
 * available 的含义是「这辆车在当前版本里有没有能开上赛道的模型」：
 *   · true  —— 已接入真实模型，可以装备、可以比赛
 *   · false —— 只有卡片与解锁条件，买/解锁了也还不能下场（不生成假模型）
 *
 * 现阶段红车、海龟车、闪电小摩托都 available；学习奖励车要等成长工坊 V6
 * 接上，才把 available 改成 true。
 * ------------------------------------------------------------------ */

/** 车辆状态（存档 + 目录算出来的展示态） */
export const VEHICLE_STATE = Object.freeze({
  EQUIPPED: 'equipped',      // 当前使用
  OWNED: 'owned',            // 已拥有，可装备
  BUYABLE: 'buyable',        // 金币够，可以买
  NEED_COINS: 'need-coins',  // 金币不足
  LOCKED: 'locked',          // 未解锁（剧情 / 学习条件没满足）
  COMING_SOON: 'coming-soon',// 解锁方式已定，但模型还没做好
});

export const STATE_LABEL = Object.freeze({
  [VEHICLE_STATE.EQUIPPED]: '正在使用',
  [VEHICLE_STATE.OWNED]: '已拥有',
  [VEHICLE_STATE.BUYABLE]: '可以购买',
  [VEHICLE_STATE.NEED_COINS]: '金币不足',
  [VEHICLE_STATE.LOCKED]: '未解锁',
  [VEHICLE_STATE.COMING_SOON]: '敬请期待',
});

/**
 * 车辆清单。
 *
 * stats 都是 1–5 的整数，只用于界面上的五格进度条（不是物理参数）。
 * 真正的驾驶手感受 kart/model.js 与 CHARACTERS 决定，这里**不参与物理**。
 */
export const VEHICLES = Object.freeze([
  Object.freeze({
    id: 'red',
    name: '红色赛车',
    short: '红车',
    tag: '全能',
    available: true,
    stats: { speed: 3, accel: 4, control: 4, stability: 4 },
    desc: '最容易上手，转弯很稳。',
    unlock: Object.freeze({ type: 'default', label: '默认赠送' }),
    color: 0xe02b16,
    accent: 0xffd23f,
    // 红色赛车保持原来的选车流程：装备红车后仍然会进角色格挑车手
    keepsCharacterSelect: true,
  }),
  Object.freeze({
    id: 'turtle',
    name: '海龟冲浪车',
    short: '海龟车',
    tag: '抓地',
    available: true,
    stats: { speed: 4, accel: 3, control: 5, stability: 5 },
    desc: '海浪冲刺，转弯特别稳。',
    unlock: Object.freeze({ type: 'story', chapter: 'chapter1', label: '完成第一章' }),
    color: 0x36c98f,
    accent: 0xffd23f,
  }),
  Object.freeze({
    id: 'moto',
    name: '闪电小摩托',
    short: '小摩托',
    tag: '速度',
    available: true,           // 骑乘版 GLB（人 + 车同一个文件）已接入
    price: 1500,
    stats: { speed: 5, accel: 4, control: 3, stability: 2 },
    desc: '轻巧灵活，弯道更快。',
    unlock: Object.freeze({ type: 'coins', price: 1500, label: '金币购买' }),
    color: 0x1f6fe0,
    accent: 0xffd23f,
  }),
  Object.freeze({
    id: 'scholar',
    name: '学习奖励车',
    short: '奖励车',
    tag: '学习',
    available: false,          // ← 等成长工坊 V6 接上
    stats: { speed: 4, accel: 4, control: 4, stability: 4 },
    desc: '认真学习就能拿到。',
    unlock: Object.freeze({ type: 'study', label: '学习挑战奖励' }),
    color: 0x7b5cff,
    accent: 0xffd23f,
  }),
]);

const BY_ID = new Map(VEHICLES.map((v) => [v.id, v]));

/**
 * 运行时覆盖「这辆车有没有模型」。
 *
 * 产品逻辑里没有任何地方会调用它 —— 它只是给自动化测试用的：
 * 学习奖励车还没有模型，但购买 / 装备链路要能验证，所以测试里临时把它标成
 * 可用，跑完就没了（不写盘、刷新即失效）。
 */
const availableOverride = new Map();

export function setAvailableOverride(id, on) {
  if (on) availableOverride.set(id, true);
  else availableOverride.delete(id);
}

export function isAvailable(v) {
  if (!v) return false;
  return availableOverride.get(v.id) ?? !!v.available;
}

export function getVehicle(id) {
  return BY_ID.get(id) || null;
}

/** 默认车辆：永远是红色赛车（默认赠送、永久拥有）。 */
export const DEFAULT_VEHICLE_ID = 'red';

/** 只有 available 的车才能真的开出去。 */
export function isDrivable(id) {
  return isAvailable(BY_ID.get(id));
}

/** 能不能装备：已拥有 + 有模型。 */
export function canEquip(id, save) {
  const v = getVehicle(id);
  if (!v || !isAvailable(v)) return false;
  if (v.unlock.type === 'default') return true;
  return !!save?.owned?.[id];
}

/**
 * 算出一辆车的展示状态。纯函数，不碰 localStorage。
 * @param {object} v 目录项
 * @param {object} save 存档快照（load() 的返回值）
 */
export function vehicleState(v, save) {
  const owned = !!save?.owned?.[v.id];
  if (owned) {
    return save?.current === v.id ? VEHICLE_STATE.EQUIPPED : VEHICLE_STATE.OWNED;
  }
  switch (v.unlock.type) {
    case 'default':
      return save?.current === v.id ? VEHICLE_STATE.EQUIPPED : VEHICLE_STATE.OWNED;
    case 'coins':
      // 模型没做好 → 只展示卡片，不开放购买（不给假的可驾驶车）
      if (!isAvailable(v)) return VEHICLE_STATE.COMING_SOON;      return (save?.coins || 0) >= v.unlock.price
        ? VEHICLE_STATE.BUYABLE
        : VEHICLE_STATE.NEED_COINS;
    default:
      return VEHICLE_STATE.LOCKED;
  }
}

/** 解锁条件面板：把当前进度翻译成三行（需求 / 进度）。 */
export function unlockRows(v, save, storyState) {
  const rows = [];
  if (v.unlock.type === 'default') {
    rows.push({ icon: 'gift', text: '默认赠送', value: '已拥有', done: true });
    return rows;
  }
  if (v.unlock.type === 'coins') {
    rows.push({
      icon: 'coin',
      text: '金币购买',
      value: `${fmt(save?.coins || 0)} / ${fmt(v.unlock.price)}`,
      done: (save?.coins || 0) >= v.unlock.price,
      progress: Math.min(1, (save?.coins || 0) / v.unlock.price),
    });
    return rows;
  }
  if (v.unlock.type === 'story') {
    rows.push({
      icon: 'book',
      text: '完成第一章剧情',
      value: storyState === 'done' ? '1 / 1' : '0 / 1',
      done: storyState === 'done',
    });
    // 兼容：老玩家在旧版本里已经用过这辆车
    if (save?.owned?.[v.id]) {
      rows.push({ icon: 'check', text: '旧版本已解锁', value: '已继承', done: true });
    }
    return rows;
  }
  // study
  rows.push({ icon: 'school', text: '学习平台挑战', value: '0 / 1', done: false });
  rows.push({ icon: 'star', text: '月度测评 ≥ 90 分', value: '待开放', done: false });
  return rows;
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US');
}
