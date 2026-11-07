/* ------------------------------------------------------------------ *
 * 学习挑战奖励 —— 接口与数据结构（**本阶段不启用**）
 *
 * 目标车辆：学习奖励车（vehicles.js 里 id = 'scholar'）。
 * 未来来源：成长工坊 V6
 *   https://sadkikyo0930.github.io/little-growth-workbench/v6/
 *
 * 为什么不能"自动同步"：
 *   两个 GitHub Pages 站点是**不同的源**（origin）。浏览器的同源策略下
 *   localStorage 完全隔离，赛车站读不到成长工坊的 localStorage；
 *   两个静态站之间也没有共享后端。所以任何"我们已经自动同步学习成绩"
 *   的说法都是假的。本文件只提供：
 *
 *     1. 奖励条件的数据结构（STUDY_REWARD）；
 *     2. 领取记录怎么存（save.js 的 lrv2.garage.rewards.study）；
 *     3. **一个可信的验证方案**：兑换码 + HMAC 签名（见下）。
 *
 * 可信验证方案（推荐实现路径）：
 *   · 成长工坊 V6 在"完成当月挑战 且 月末测评 ≥ 90 分"时，用两站共享的
 *     构建期密钥对 `${vehicleId}|${month}|${score}` 做 HMAC-SHA256，
 *     生成兑换码：LRV2-SCHOLAR-202611-<sig16>
 *   · 家长把码抄/扫到赛车站，赛车站离线验证签名 + 月份 + 是否用过。
 *   · 密钥打包进两个站的前端 → 只能防手误、防乱编，**防不住**决心破解的人。
 *     真正需要防作弊时，把校验搬到一个小后端（Cloudflare Worker 之类）
 *     并把密钥留在服务端，接口形状不用变，只换 verifyStudyCode 的实现。
 *
 * 当前 `STUDY_ENABLED = false`：
 *   · 车库只显示一张"敬请期待"的卡片，没有兑换码入口；
 *   · 任何调用都返回 {ok:false, reason:'not-enabled'}，不会假装成功；
 *   · 数据结构与校验函数是完整的，打开开关 + 拿到密钥即可启用。
 * ------------------------------------------------------------------ */

import { getVehicle } from './vehicles.js';
import { grantVehicle, recordStudyClaim, hasStudyClaim, studyClaims } from './save.js';

export const STUDY_REWARD = Object.freeze({
  id: 'growth-v6-monthly',
  vehicleId: 'scholar',
  source: 'little-growth-workbench-v6',
  url: 'https://sadkikyo0930.github.io/little-growth-workbench/v6/',
  /** 条件：完成当月学习挑战 + 月末综合测评 ≥ 90 分 */
  requirement: Object.freeze({
    monthlyChallenge: true,
    minScore: 90,
    window: 'calendar-month',
  }),
  /** 码的形状：LRV2-<VEHICLE>-<YYYYMM>-<SIG> */
  codePattern: /^LRV2-([A-Z]+)-(\d{6})-([0-9A-F]{16})$/,
});

/** 总开关。做成常量而不是配置项，避免误开。 */
export const STUDY_ENABLED = false;

/**
 * 构建期注入的共享密钥占位。
 * 真要启用时由打包工具写入（例如 import.meta.env.VITE_STUDY_KEY），
 * 这里留空 → verifyStudyCode 永远返回 not-configured。
 */
const SHARED_KEY = '';

export const STUDY_ERROR = Object.freeze({
  NOT_ENABLED: 'not-enabled',
  NOT_CONFIGURED: 'not-configured',
  BAD_FORMAT: 'bad-format',
  BAD_SIGNATURE: 'bad-signature',
  WRONG_VEHICLE: 'wrong-vehicle',
  ALREADY_CLAIMED: 'already-claimed',
  UNKNOWN_TASK: 'unknown-task',
});

export const STUDY_ERROR_TEXT = Object.freeze({
  [STUDY_ERROR.NOT_ENABLED]: '学习奖励还在准备中',
  [STUDY_ERROR.NOT_CONFIGURED]: '奖励校验尚未配置',
  [STUDY_ERROR.BAD_FORMAT]: '兑换码格式不对',
  [STUDY_ERROR.BAD_SIGNATURE]: '兑换码无效',
  [STUDY_ERROR.WRONG_VEHICLE]: '兑换码不属于这辆车',
  [STUDY_ERROR.ALREADY_CLAIMED]: '这个奖励已经领过了',
  [STUDY_ERROR.UNKNOWN_TASK]: '没有这个学习任务',
});

/** 车库 / 首页要显示的学习奖励概况（纯读取，不发奖）。 */
export function studyStatus() {
  const claims = studyClaims();
  const count = Object.keys(claims).length;
  return {
    ...STUDY_REWARD,
    enabled: STUDY_ENABLED,
    configured: !!SHARED_KEY,
    claimedCount: count,
    lastClaimAt: count ? Math.max(...Object.values(claims).map((c) => Number(c?.at) || 0)) : 0,
    vehicleAvailable: !!getVehicle(STUDY_REWARD.vehicleId)?.available,
  };
}

/* ------------------------------ 解析 ------------------------------ */
export function parseStudyCode(text) {
  const raw = String(text || '').trim().toUpperCase().replace(/\s+/g, '');
  const m = STUDY_REWARD.codePattern.exec(raw);
  if (!m) return { ok: false, reason: STUDY_ERROR.BAD_FORMAT };
  return {
    ok: true,
    raw,
    vehicleTag: m[1],
    month: m[2],
    sig: m[3],
    vehicleId: STUDY_REWARD.vehicleId,
  };
}

/* ------------------------------ 签名 ------------------------------ */
/* 用 Web Crypto 的 HMAC-SHA256。localhost / https 下可用；
 * file:// 或旧浏览器没有 crypto.subtle 时直接判定为不可用。 */
async function hmacHex(message, key) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('no-subtle-crypto');
  const enc = new TextEncoder();
  const k = await subtle.importKey(
    'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const buf = await subtle.sign('HMAC', k, enc.encode(message));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** 成长工坊侧要用的签名文本（两站必须一致）。 */
export function signPayload({ vehicleId = STUDY_REWARD.vehicleId, month, score }) {
  return `${vehicleId}|${month}|${score}`;
}

/** 校验兑换码。本阶段 STUDY_ENABLED=false → 恒返回 not-enabled。 */
export async function verifyStudyCode(text) {
  if (!STUDY_ENABLED) return { ok: false, reason: STUDY_ERROR.NOT_ENABLED };
  if (!SHARED_KEY) return { ok: false, reason: STUDY_ERROR.NOT_CONFIGURED };

  const parsed = parseStudyCode(text);
  if (!parsed.ok) return parsed;
  if (parsed.vehicleId !== STUDY_REWARD.vehicleId) {
    return { ok: false, reason: STUDY_ERROR.WRONG_VEHICLE };
  }

  /*
   * 兑换码里不带分数（避免暴露学习数据），签名覆盖 `${vehicleId}|${month}|ok`：
   * 「当月挑战已通过且测评 ≥ 90」这件事由成长工坊判断，赛车站只验证
   * 「这确实是成长工坊为这个月签发的」。
   */
  const expect = await hmacHex(signPayload({ month: parsed.month, score: 'ok' }), SHARED_KEY);
  if (expect.slice(0, 16) !== parsed.sig) {
    return { ok: false, reason: STUDY_ERROR.BAD_SIGNATURE };
  }
  if (hasStudyClaim(parsed.raw)) {
    return { ok: false, reason: STUDY_ERROR.ALREADY_CLAIMED };
  }
  return { ok: true, reason: 'ok', month: parsed.month, code: parsed.raw };
}

/**
 * 兑换并发放学习奖励车。
 * @returns {Promise<{ok:boolean, reason:string, granted?:boolean}>}
 */
export async function claimStudyReward(text) {
  const v = await verifyStudyCode(text);
  if (!v.ok) return v;

  const granted = grantVehicle(STUDY_REWARD.vehicleId, 'study', { month: v.month, code: v.code });
  recordStudyClaim(v.code, STUDY_REWARD.vehicleId, { month: v.month, task: STUDY_REWARD.id });
  return { ok: true, reason: 'ok', granted };
}
