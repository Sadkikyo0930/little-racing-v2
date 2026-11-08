/**
 * 故事进度 — localStorage 持久化（只记录第一章）
 *
 * 只有三个状态：
 *   idle    未开始
 *   playing 进行中
 *   done    已完成（允许重新游玩）
 *
 * 不做金币 / 星星 / 奖杯之类的奖励系统 —— 本轮明确不制作。
 *
 * 隐私模式或存储被禁用时，localStorage 可能抛错；这里全部静默降级为
 * 「未开始」，绝不让存档失败影响游戏本身。
 */

import { LEGACY, K_CHAPTER2 } from '../garage/save.js';

const KEY = LEGACY.chapter1;

export const STORY_STATE = Object.freeze({
  IDLE: 'idle',
  PLAYING: 'playing',
  DONE: 'done',
});

const LABELS = Object.freeze({
  [STORY_STATE.IDLE]: '未开始',
  [STORY_STATE.PLAYING]: '进行中',
  [STORY_STATE.DONE]: '已完成',
});

const VALID = new Set(Object.values(STORY_STATE));

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

/** 读取第一章状态；任何异常都返回「未开始」。 */
export function readChapter1() {
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return { state: STORY_STATE.IDLE, updatedAt: 0 };
    const parsed = JSON.parse(raw);
    const state = VALID.has(parsed?.state) ? parsed.state : STORY_STATE.IDLE;
    return { state, updatedAt: Number(parsed?.updatedAt) || 0 };
  } catch {
    return { state: STORY_STATE.IDLE, updatedAt: 0 };
  }
}

/** 写入第一章状态；写入失败不影响游戏。 */
export function writeChapter1(state) {
  const next = VALID.has(state) ? state : STORY_STATE.IDLE;
  try {
    storage()?.setItem(KEY, JSON.stringify({ state: next, updatedAt: Date.now() }));
  } catch {
    /* 隐私模式下忽略：进度存不下，游戏照常玩 */
  }
  return next;
}

/** 只在「比现在更进一步」时写入，避免重玩时把 done 退回 playing。 */
export function advanceChapter1(state) {
  const cur = readChapter1().state;
  if (cur === STORY_STATE.DONE) return cur;
  return writeChapter1(state);
}

export function chapter1Label(state) {
  return LABELS[state] || LABELS[STORY_STATE.IDLE];
}

/** 调试/测试用：清空第一章进度。 */
export function resetChapter1() {
  try {
    storage()?.removeItem(KEY);
  } catch {
    /* 忽略 */
  }
}

/* ------------------------------------------------------------------ *
 * 第二章《阳光沙滩大冒险》— 进度（与第一章完全并行的三态实现）
 *
 *   · 独立的 localStorage key，绝不读写第一章的 KEY；
 *   · 三态同构：idle / playing / done；
 *   · advanceChapter2 同样「只前进不退回」，重玩不会把 done 退回 playing；
 *   · 本轮**不发放**任何金币或成就（500 金币奖励 ID、阳光沙滩冠军成就 ID
 *     都已在 save.js / 设计文档里预留），实际发放与幂等校验留到第四阶段。
 * ------------------------------------------------------------------ */

const KEY2 = K_CHAPTER2;

export function readChapter2() {
  try {
    const raw = storage()?.getItem(KEY2);
    if (!raw) return { state: STORY_STATE.IDLE, updatedAt: 0 };
    const parsed = JSON.parse(raw);
    const state = VALID.has(parsed?.state) ? parsed.state : STORY_STATE.IDLE;
    return { state, updatedAt: Number(parsed?.updatedAt) || 0 };
  } catch {
    return { state: STORY_STATE.IDLE, updatedAt: 0 };
  }
}

export function writeChapter2(state) {
  const next = VALID.has(state) ? state : STORY_STATE.IDLE;
  try {
    storage()?.setItem(KEY2, JSON.stringify({ state: next, updatedAt: Date.now() }));
  } catch {
    /* 隐私模式下忽略 */
  }
  return next;
}

export function advanceChapter2(state) {
  const cur = readChapter2().state;
  if (cur === STORY_STATE.DONE) return cur;
  return writeChapter2(state);
}

export function chapter2Label(state) {
  return LABELS[state] || LABELS[STORY_STATE.IDLE];
}

export function resetChapter2() {
  try {
    storage()?.removeItem(KEY2);
  } catch {
    /* 忽略 */
  }
}

/** 通用包装：剧情流程入口按章节对象取进度，避免在大段逻辑里散落 if/else。 */
export function readChapter(id) {
  return id === 'chapter-02' ? readChapter2() : readChapter1();
}
export function advanceChapter(id, state) {
  return id === 'chapter-02' ? advanceChapter2(state) : advanceChapter1(state);
}
export function writeChapterDone(id) {
  return id === 'chapter-02' ? writeChapter2(STORY_STATE.DONE) : writeChapter1(STORY_STATE.DONE);
}
export function chapterLabelOf(id, state) {
  return id === 'chapter-02' ? chapter2Label(state) : chapter1Label(state);
}
