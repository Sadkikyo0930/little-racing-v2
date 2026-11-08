/**
 * 角色配音 —— 基于 Web Audio 的本地音频播放器（v2）
 *
 * ── 为什么从 HTMLAudioElement 改成 Web Audio ─────────────────────
 * v1 的 iOS「解锁」方式是：在一次 pointerdown 里对 6 个 <audio> 元素
 * 同时 `muted=true; play()`。真机 iPhone 上这条路不成立：
 *   · 一次同步任务里连发 6 次 play()，iOS 只会让其中一个真正获得播放许可，
 *     其余要么 reject（NotAllowedError / AbortError），要么被系统随即暂停；
 *   · v1 在循环之前就把 `_unlocked = true` 写死了，reject 被当成「已解锁」吞掉，
 *     之后再也不重试 —— 于是「只有第一句有声音，第二句起全哑」；
 *   · 每句的 `restore()` 回调是异步的，它会在正式播放开始之后才执行，
 *     又去 `pause()` + `currentTime = 0`，把已经响起来的句子掐死。
 *   · 普通比赛里 play() 不在任何手势上下文里，元素没被真正解锁 → 一句都放不出来。
 *
 * v2 改成 **AudioContext + AudioBufferSourceNode**：
 *   · 自动播放策略只认「AudioContext 是否 resume 过」，一次手势 resume 之后，
 *     之后所有 play() 都不再受限制 —— 不再有「每个元素各自解锁」的问题；
 *   · 音频在首次手势后按「当前剧情段」小并发预取（见 setChapter / _preloadAll），
 *     而不是一次性并发解码全库 —— 第二章 21 条接入后全库共 27 条，
 *     在 iPhone Safari 上同时 fetch + decodeAudioData 27 个文件会拖慢首句出声，
 *     甚至让部分解码失败；收敛到当前段后首句仍由 play() 直接触发加载，零延迟；
 *   · 同一时刻只保留一个 sourceNode，切句时先 stop 旧的 → 结构上不可能叠音；
 *   · 每句的结束/停止/失败都走同一个 `_endLine()`，状态只有一套，不会互相覆盖；
 *   · 任何异步回调（加载完成、resume 完成、ended）都要先核对**播放代号**
 *     `_gen`，过期的一律丢弃 → 不会出现「上一句被重播」这类竞争。
 *
 * ── 仍然坚守的硬性要求 ─────────────────────────────────────────
 *  1. **绝不使用 SpeechSynthesis。** 全仓库没有 `speechSynthesis`，没有任何 TTS 回退。
 *  2. 只播固定的本地音频文件。
 *  3. 文件缺失时静默降级：不探测、不重试、不产生 404（靠 `import.meta.glob` 的构建期查表）。
 *  4. 遵守全局静音：静音时一句都不放，且不会强制播报。
 *  5. 播放/结束时用 `onSpeaking` 通知外部（背景音乐压低 / 恢复）。
 *  6. 被浏览器拦下时**如实上报**（`on('blocked')`），UI 可以显示「点击播放语音」，
 *     但绝不假装播放成功，也绝不用机器人声音顶替。
 */

/** 台词 id → 文件名。文件名固定，方便你把文件直接丢进目录。 */
export const VOICE_FILES = Object.freeze({
  'c1-01': 'c1-01.mp3',
  'c1-02': 'c1-02.mp3',
  'c1-03': 'c1-03.mp3',
  'c1-04': 'c1-04.mp3',
  'c1-05': 'c1-05.mp3',
  'wrong-way': 'wrong-way.mp3',
  /* 第二章《阳光沙滩大冒险》21 句对白的配音（c2-01 ~ c2-21）。
   * 对应 .mp3 已随 R4 语音接入放入 src/assets/audio/voice/，由下方
   * import.meta.glob 在构建期自动收录；has() 对 21 个 id 均返回 true。
   * 顺序与 src/story/chapter2.js 的 beats 一致（逐条按录音内容核对，
   * 不按编号盲接）：开场 c2-01~12，结尾 c2-13~21。
   * 灯塔爷爷 / 闪电小红各自使用自己那一条录音，不共用、不串音。 */
  'c2-01': 'c2-01.mp3', 'c2-02': 'c2-02.mp3', 'c2-03': 'c2-03.mp3',
  'c2-04': 'c2-04.mp3', 'c2-05': 'c2-05.mp3', 'c2-06': 'c2-06.mp3',
  'c2-07': 'c2-07.mp3', 'c2-08': 'c2-08.mp3', 'c2-09': 'c2-09.mp3',
  'c2-10': 'c2-10.mp3', 'c2-11': 'c2-11.mp3', 'c2-12': 'c2-12.mp3',
  'c2-13': 'c2-13.mp3', 'c2-14': 'c2-14.mp3', 'c2-15': 'c2-15.mp3',
  'c2-16': 'c2-16.mp3', 'c2-17': 'c2-17.mp3', 'c2-18': 'c2-18.mp3',
  'c2-19': 'c2-19.mp3', 'c2-20': 'c2-20.mp3', 'c2-21': 'c2-21.mp3',
});

/* 构建时真实存在的文件才会进这张表（空目录 → 空对象，零请求）。 */
const BUNDLED = import.meta.glob('../assets/audio/voice/*.mp3', {
  eager: true,
  query: '?url',
  import: 'default',
});

const BY_NAME = new Map();
for (const [path, url] of Object.entries(BUNDLED)) {
  const name = path.split('/').pop();
  BY_NAME.set(name, url);
}

/**
 * 基础预加载集 = 第一章 5 句 + 比赛逆行提示，与接入第二章之前的行为完全一致，
 * 保证第一章零回归。第二章 21 条不在这里，改由 director.play() 的
 * setChapter() 按「当前段」提供（开场 12 条 / 结尾 9 条），并串行排队解码，
 * 避免 iPhone Safari 首次手势把 27 条全库音频一次性拉起来。
 */
const BASE_IDS = Object.freeze([
  'c1-01', 'c1-02', 'c1-03', 'c1-04', 'c1-05', 'wrong-way',
]);

import { K_VOICE } from '../garage/save.js';

const PREF_KEY = K_VOICE;

function readPrefs() {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(PREF_KEY) || '{}');
    return {
      enabled: raw.enabled !== false,
      volume: Number.isFinite(raw.volume) ? Math.min(1, Math.max(0, raw.volume)) : 1,
    };
  } catch {
    return { enabled: true, volume: 1 };
  }
}

export class VoiceManager {
  constructor() {
    this.prefs = readPrefs();
    this.muted = false;
    /** 'menu' | 'story' | 'race' —— 只用于调试信息，不参与任何判断 */
    this.mode = 'menu';

    /* --- Web Audio --- */
    this.ctx = null;
    this.gain = null;
    this.analyser = null;
    this.buffers = new Map();     // id -> AudioBuffer（解码完成）
    this._loads = new Map();      // id -> Promise<AudioBuffer|null>
    this.loadErrors = new Map();  // id -> 错误描述

    /* --- 当前这一句 --- */
    this.srcNode = null;
    this.playingId = null;
    this._gen = 0;                // 播放代号：过期的异步回调一律作废
    this._startedAt = 0;
    this._duration = 0;
    this._phase = 'idle';         // idle | loading | playing | ended | stopped | error
    this._speakingState = false;

    /* --- 解锁 --- */
    this._unlocked = false;       // AudioContext 真的处于 running
    this._gestureCount = 0;
    this._pending = null;         // { id, gen, at }：被拦下、等下一次手势补播的那一句
    this._resumeTried = 0;

    /* --- 当前剧情段（iPhone Safari 预加载收敛 + 跨章隔离） --- */
    this._chapterIds = null;      // 当前段会用到的 voice id 列表；null = 尚未进入剧情
    this._chapterKey = null;      // 段落指纹（只读快照 / 测试观察用）
    this._preloadChain = Promise.resolve();
    this._preloadQueued = new Set();   // 已排入串行队列、尚未解码完成的 id

    /* --- 回调 --- */
    this.onSpeaking = null;       // 只由 main.js 占用（音乐压低）
    this._hooks = { start: new Set(), end: new Set(), blocked: new Set() };

    this.lastResult = { id: null, ok: false, reason: null, at: 0 };
    this.lastReject = null;

    /* --- 兜底：完全没有 AudioContext 时才用的元素播放器 --- */
    this._els = new Map();
    this._elCurrent = null;
  }

  /* =============================== 事件 =============================== */

  /** 订阅：'start' | 'end' | 'blocked'，返回退订函数。 */
  on(evt, fn) {
    (this._hooks[evt] ||= new Set()).add(fn);
    return () => this.off(evt, fn);
  }

  off(evt, fn) {
    this._hooks[evt]?.delete(fn);
  }

  _emit(evt, payload) {
    const set = this._hooks[evt];
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(payload); } catch { /* 单个订阅者异常不影响播放 */ }
    }
  }

  /* ============================== 查询 =============================== */

  /** 某句台词是否有本地配音文件（纯查表，不发网络请求）。 */
  has(id) {
    const file = VOICE_FILES[id];
    return !!(file && BY_NAME.has(file));
  }

  availableIds() {
    return Object.keys(VOICE_FILES).filter((id) => this.has(id));
  }

  isReady() {
    return this.availableIds().length > 0;
  }

  _url(id) {
    const file = VOICE_FILES[id];
    if (!file) return null;
    return BY_NAME.get(file) || null;
  }

  /** 当前是否应该出声（未静音且未关闭配音）。 */
  wantsSound() {
    return !!this.prefs.enabled && !this.muted;
  }

  /** AudioContext 是否已解锁（iOS 上 resume 成功过）。 */
  get unlocked() {
    return this._unlocked;
  }

  /** 被浏览器拦下、正等下一次手势补播的那一句（没有则为 null）。 */
  get pendingId() {
    return this._pending?.id || null;
  }

  /* ============================ 上下文 ============================== */

  _ensureCtx() {
    if (this.ctx) return this.ctx;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    try {
      const ctx = new AC({ latencyHint: 'interactive' });
      const gain = ctx.createGain();
      gain.gain.value = this.wantsSound() ? this.prefs.volume : 0;
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      gain.connect(an);
      an.connect(ctx.destination);
      this.ctx = ctx;
      this.gain = gain;
      this.analyser = an;
      return ctx;
    } catch (e) {
      this.lastReject = `AudioContext: ${e?.message || e}`;
      return null;
    }
  }

  /**
   * 在**真实的用户手势**里调用（每次 pointerdown / keydown 都调，不是只调一次）。
   *
   * 做三件事：创建/恢复 AudioContext、预取并解码六个文件、补播被拦下的那一句。
   * 不假装成功：只有 `ctx.state === 'running'` 才把 `_unlocked` 置 true。
   */
  unlock() {
    this._gestureCount += 1;
    const ctx = this._ensureCtx();
    if (!ctx) return false;
    this._preloadAll();                      // fetch/decode 不受自动播放策略限制

    const settle = () => {
      if (ctx.state === 'running') {
        this._unlocked = true;
        this._flushPending();
      }
      return ctx.state === 'running';
    };

    if (ctx.state === 'running') { this._unlocked = true; this._flushPending(); return true; }

    this._resumeTried += 1;
    try {
      const p = ctx.resume();
      if (p && typeof p.then === 'function') {
        p.then(settle, (e) => { this.lastReject = `resume: ${e?.name || ''} ${e?.message || e}`; });
      } else settle();
    } catch (e) {
      this.lastReject = `resume: ${e?.message || e}`;
    }
    return ctx.state === 'running';
  }

  /** 被拦下的那一句，等解锁成功后立刻补上（只在 4 秒内、且没被新的一句取代时）。 */
  _flushPending() {
    const pend = this._pending;
    if (!pend) return false;
    if (pend.gen !== this._gen) { this._pending = null; return false; }
    if (Date.now() - pend.at > 4000) { this._pending = null; return false; }
    this._pending = null;
    this._start(pend.id, pend.gen);
    return true;
  }

  /* ============================== 加载 ============================== */

  /**
   * 由 StoryDirector.play(segment) 调用，告知「这一段会用到哪些配音」。
   *
   * 两个作用：
   *  1. **预加载收敛**：只把本段 + BASE_IDS 排队解码，且串行小并发，
   *     避免 iPhone Safari 首次手势同时处理 27 个 fetch + decodeAudioData。
   *     首句不会被队列挡住 —— play() 里的 _load(id) 会直接并发触发，
   *     _load 自身按 id 去重，不会重复请求。
   *  2. **跨章 / 跨段隔离**：若换段时仍有一句在播，且它不属于新段落，
   *     立刻停掉，杜绝「上一章声音延续到下一章」。
   *
   * @param {string[]} ids 本段 beat.voice 列表
   * @param {string} [key] 段落标识（如 'chapter-02:intro'），仅用于判定换段
   */
  setChapter(ids, key) {
    const list = Array.isArray(ids)
      ? [...new Set(ids.filter((id) => typeof id === 'string' && this.has(id)))]
      : [];
    /* 跨章 / 跨段隔离：判据是「当前正在播、或正等待补播的那一句，
     * 是否属于新段落」，而不是段落指纹 —— 退出剧情会清空指纹，
     * 但残留声音仍必须被掐断。第一章与第二章的 voice id 完全不同，
     * 因此不会误杀同段内的正常播放。 */
    const stale = (this.playingId && !list.includes(this.playingId))
      || (this._pending?.id && !list.includes(this._pending.id));
    if (stale) this.stop();

    this._chapterIds = list;
    this._chapterKey = key || list.join(',');
    /* 进入剧情时立刻排队预取本段（用户已点过按钮，AudioContext 已存在）。
     * 首句由 play() → _load(id) 直连加载，不受该串行队列阻塞。 */
    if (this.ctx) this._preloadAll();
    return list;
  }

  /** 退出剧情时清掉段落范围，预加载回到「只保基础提示音」的最小集。 */
  clearChapter() {
    this._chapterIds = null;
    this._chapterKey = null;
  }

  _preloadAll() {
    const ids = this._chapterIds
      ? [...new Set([...this._chapterIds, ...BASE_IDS])]
      : BASE_IDS.slice();
    for (const id of ids) {
      if (!this.has(id) || this.buffers.has(id) || this._loads.has(id)) continue;
      if (this._preloadQueued.has(id)) continue;   // 已排队，别重复追加
      // 串行排队：iOS 上 decodeAudioData 并发过多会明显拖慢首句。
      // play(id) 走的是 _load(id) 直连，不受此队列阻塞。
      this._preloadQueued.add(id);
      this._preloadChain = this._preloadChain
        .then(() => this._load(id))
        .catch(() => {})
        .finally(() => this._preloadQueued.delete(id));
    }
  }

  _load(id) {
    if (this.buffers.has(id)) return Promise.resolve(this.buffers.get(id));
    if (this._loads.has(id)) return this._loads.get(id);
    const url = this._url(id);
    const ctx = this._ensureCtx();
    if (!url || !ctx) return Promise.resolve(null);

    const job = (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`http ${res.status}`);
        const raw = await res.arrayBuffer();
        const buf = await new Promise((resolve, reject) => {
          let settled = false;
          const ok = (b) => { if (!settled) { settled = true; resolve(b); } };
          const bad = (e) => { if (!settled) { settled = true; reject(e); } };
          const r = ctx.decodeAudioData(raw, ok, bad);
          if (r && typeof r.then === 'function') r.then(ok, bad);
        });
        this.buffers.set(id, buf);
        this.loadErrors.delete(id);
        return buf;
      } catch (e) {
        this.loadErrors.set(id, String(e?.message || e));
        return null;
      } finally {
        this._loads.delete(id);
      }
    })();
    this._loads.set(id, job);
    return job;
  }

  /* ============================== 播放 ============================== */

  /**
   * 播放一句。
   * @returns {boolean} 是否**已被接受**（false 时 `lastResult.reason` 说明原因：
   *   muted / no-file / suspended / no-webaudio / play-throw）
   */
  play(id) {
    const note = (ok, reason) => {
      this.lastResult = { id, ok, reason, at: Date.now() };
      return ok;
    };
    if (!this.wantsSound()) return note(false, 'muted');
    if (!this.has(id)) return note(false, 'no-file');

    const gen = ++this._gen;
    /* 切句时保留「正在说话」状态：不先抬升背景音乐再压低，避免快速点下一句
     * 时 140ms 渐变来回翻转。真正停止（stop / 静音 / 跳过 / 退出）仍会恢复。 */
    this._halt(true);                  // 上一句立刻停：结构上不可能叠音

    const ctx = this._ensureCtx();
    if (!ctx) return this._playElement(id, gen, note);

    if (ctx.state !== 'running') {
      // 还锁着：这一次出不了声，但记下来 —— 下一次真实点击立刻补播，并上报 UI
      this._pending = { id, gen, at: Date.now() };
      this.lastReject = `suspended (${ctx.state})`;
      this._speaking(false);   // 切句保留的 duck 在这里落地恢复，不挂死
      this._emit('blocked', { id, state: ctx.state });
      try {
        const p = ctx.resume();
        if (p && typeof p.then === 'function') {
          p.then(() => { if (gen === this._gen) this._start(id, gen); }, () => {});
        }
      } catch { /* 手势外 resume 会失败，等 unlock() */ }
      return note(false, 'suspended');
    }

    this._start(id, gen);
    return note(true, null);
  }

  /** 真正开播：缓冲已在缓存里就立刻播，否则等解码（用 _gen 防止过期回调）。 */
  _start(id, gen) {
    if (gen !== this._gen) return;                 // 已被更新的一句取代
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state !== 'running') {
      this._pending = { id, gen, at: Date.now() };
      this._speaking(false);   // 切句保留的 duck 在这里落地恢复，不挂死
      this._emit('blocked', { id, state: ctx.state });
      return;
    }
    const buf = this.buffers.get(id);
    if (buf) { this._startBuffer(id, buf, gen); return; }

    this._phase = 'loading';
    this._load(id).then((b) => {
      if (gen !== this._gen) return;               // 期间玩家点了别的句子 → 丢弃
      if (!b) {
        this._phase = 'error';
        this.lastResult = { id, ok: false, reason: 'decode-failed', at: Date.now() };
        this._endLine(id, 'error');
        return;
      }
      this._startBuffer(id, b, gen);
    });
  }

  _startBuffer(id, buffer, gen) {
    const ctx = this.ctx;
    if (!ctx) return;
    let node;
    try {
      node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(this.gain);
      node.onended = () => {
        // 被 stop() 掉或被新的一句取代时，这个回调也必须无视
        if (this._gen !== gen || this.srcNode !== node) return;
        try { node.disconnect(); } catch { /* 忽略 */ }
        this.srcNode = null;
        this._endLine(id, 'ended');
      };
      node.start(0);
    } catch (e) {
      this.lastReject = `start: ${e?.message || e}`;
      this._phase = 'error';
      this.lastResult = { id, ok: false, reason: 'start-failed', at: Date.now() };
      this._endLine(id, 'error');
      return;
    }

    this.srcNode = node;
    this.playingId = id;
    this._duration = buffer.duration;
    this._startedAt = ctx.currentTime;
    this._phase = 'playing';
    this._pending = null;
    this.lastResult = { id, ok: true, reason: null, at: Date.now() };
    this._speaking(true);
    this._emit('start', { id, duration: +buffer.duration.toFixed(2) });
  }

  /** 一句结束（自然播完 / 被停 / 出错）的唯一出口。 */
  _endLine(id, reason) {
    this.playingId = null;
    this._startedAt = 0;
    this._phase = reason;
    this._speaking(false);
    this._emit('end', { id, reason });
  }

  /**
   * 停掉当前这一句（不动 _gen —— 调用方会自己决定是否接着播新的一句）。
   * @param {boolean} [keepDuck=false] 为 true 时不通知「停止说话」：
   *   用于 play() 切句，让背景音乐的压低状态连续保持；所有真正停止的入口
   *   （stop / 静音 / 跳过 / 退出 / 段落切换）都用默认 false，音乐平滑恢复。
   */
  _halt(keepDuck = false) {
    const node = this.srcNode;
    this.srcNode = null;
    const was = this.playingId;
    this.playingId = null;
    this._startedAt = 0;
    if (node) {
      node.onended = null;                 // 先摘掉回调，避免被当成本句自然结束
      try { node.stop(0); } catch { /* 已经结束 */ }
      try { node.disconnect(); } catch { /* 忽略 */ }
    }
    if (this._elCurrent) {
      try { this._elCurrent.pause(); this._elCurrent.currentTime = 0; } catch { /* 忽略 */ }
      this._elCurrent = null;
    }
    this._phase = 'idle';
    if (was) {
      if (!keepDuck) this._speaking(false);
      // end 事件照常发：导演据此判断「被我们停掉的不算播完」，不触发自动翻页
      this._emit('end', { id: was, reason: 'stopped' });
    }
  }

  playWrongWay() {
    return this.play('wrong-way');
  }

  /**
   * 停止当前配音，并作废所有在途的异步回调。
   * 剧情切句 / 退出 / 静音都走这里。
   */
  stop() {
    this._gen += 1;          // 让在途的 load/resume/ended 全部失效
    this._pending = null;
    this._halt();
  }

  /* ========================= 元素兜底（极少用） ========================= */

  _el(id) {
    if (this._els.has(id)) return this._els.get(id);
    const url = this._url(id);
    if (!url) return null;
    const el = new Audio();
    el.preload = 'auto';
    el.src = url;
    el.playsInline = true;
    el.setAttribute('playsinline', '');
    el.setAttribute('webkit-playsinline', '');
    el.addEventListener('ended', () => {
      if (this._elCurrent !== el) return;
      this._elCurrent = null;
      this._endLine(id, 'ended');
    });
    el.addEventListener('error', () => {
      this.loadErrors.set(id, 'element load error');
    });
    this._els.set(id, el);
    return el;
  }

  _playElement(id, gen, note) {
    const el = this._el(id);
    if (!el) { this._speaking(false); return note(false, 'no-file'); }
    this._elCurrent = el;
    el.muted = false;                       // 兜底路径也要明确取消 muted
    el.volume = this.prefs.volume;
    try { el.currentTime = 0; } catch { /* 忽略 */ }
    let p;
    try {
      p = el.play();
    } catch (e) {
      this.lastReject = `element play: ${e?.message || e}`;
      this._speaking(false);
      return note(false, 'play-throw');
    }
    const started = () => {
      if (gen !== this._gen) { try { el.pause(); } catch { /* 忽略 */ } return; }
      this.playingId = id;
      this._duration = Number.isFinite(el.duration) ? el.duration : 0;
      this._startedAt = 0;
      this._phase = 'playing';
      this._speaking(true);
      this._emit('start', { id, duration: this._duration });
    };
    if (p && typeof p.then === 'function') {
      p.then(started, (e) => {
        if (gen !== this._gen) return;
        this.lastReject = `${e?.name || 'play'}: ${e?.message || e}`;
        this._pending = { id, gen, at: Date.now() };
        this.lastResult = { id, ok: false, reason: 'autoplay-blocked', at: Date.now() };
        this._speaking(false);
        this._emit('blocked', { id, state: 'element' });
      });
    } else started();
    return note(true, null);
  }

  /* ============================== 状态 ============================== */

  _speaking(on) {
    on = !!on;
    if (this._speakingState === on) return;   // 只在状态真的变化时通知
    this._speakingState = on;
    try { this.onSpeaking?.(on); } catch { /* 回调异常不影响播放 */ }
  }

  /** 当前这一句已播放秒数（Web Audio 用上下文时钟算）。 */
  get currentTime() {
    if (!this.playingId) return 0;
    if (this.ctx && this._startedAt) return Math.max(0, this.ctx.currentTime - this._startedAt);
    return this._elCurrent ? this._elCurrent.currentTime : 0;
  }

  /** 输出电平（RMS）：用来客观证明「真的有声音」，不只是状态字符串。 */
  level() {
    const an = this.analyser;
    if (!an) return 0;
    if (!this._rms || this._rms.length !== an.fftSize) this._rms = new Float32Array(an.fftSize);
    try { an.getFloatTimeDomainData(this._rms); } catch { return 0; }
    let sum = 0;
    for (let i = 0; i < this._rms.length; i++) sum += this._rms[i] * this._rms[i];
    return Math.sqrt(sum / this._rms.length);
  }

  setMuted(muted) {
    this.muted = !!muted;
    if (this.gain) {
      const v = this.wantsSound() ? this.prefs.volume : 0;
      try { this.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01); } catch { this.gain.gain.value = v; }
    }
    if (this.muted) this.stop();
    return this.muted;
  }

  setVolume(v) {
    this.prefs.volume = Math.min(1, Math.max(0, Number(v) || 0));
    if (this.gain && this.wantsSound()) {
      try { this.gain.gain.setTargetAtTime(this.prefs.volume, this.ctx.currentTime, 0.01); } catch { /* 忽略 */ }
    }
    this._save();
  }

  setEnabled(on) {
    this.prefs.enabled = !!on;
    if (!on) this.stop();
    this._save();
  }

  _save() {
    try {
      globalThis.localStorage?.setItem(PREF_KEY, JSON.stringify(this.prefs));
    } catch { /* 忽略 */ }
  }

  /** 只读快照 —— 测试与「音频问题根因报告」都以此为准。 */
  debugState() {
    const ids = this.availableIds();
    const t = this.currentTime;
    return {
      /* 模式与当前句 */
      mode: this.mode,
      playingId: this.playingId,
      phase: this._phase,
      currentTime: +t.toFixed(2),
      duration: +this._duration.toFixed(2),
      level: +this.level().toFixed(4),

      /* 文件 */
      chapterIds: this._chapterIds ? [...this._chapterIds] : null,
      chapterKey: this._chapterKey,
      file: this.playingId ? VOICE_FILES[this.playingId] : null,
      url: this.playingId ? this._url(this.playingId) : null,
      declared: Object.keys(VOICE_FILES),
      available: ids,
      ready: this.isReady(),
      files: Object.fromEntries(Object.entries(VOICE_FILES).map(([id, f]) => [id, BY_NAME.has(f)])),
      decoded: Object.fromEntries(ids.map((id) => [id, this.buffers.has(id)])),
      loadErrors: Object.fromEntries(this.loadErrors),

      /* 解锁与播放结果 */
      unlocked: this._unlocked,
      gestureCount: this._gestureCount,
      ctxState: this.ctx ? this.ctx.state : 'none',
      lastResult: this.lastResult,
      lastReject: this.lastReject,
      pendingId: this._pending?.id || null,

      /* 开关 */
      enabled: this.prefs.enabled,
      muted: this.muted,
      volume: this.prefs.volume,

      /* 元素视图（兼容旧测试的 paused / t 断言） */
      tracks: Object.fromEntries(ids.map((id) => {
        const on = this.playingId === id;
        return [id, {
          playing: on,
          paused: !on,
          ended: on ? false : this._phase === 'ended',
          t: on ? +t.toFixed(2) : 0,
          volume: this.prefs.volume,
          muted: this.muted,
          src: (this._url(id) || '').split('/').pop(),
          error: this.loadErrors.get(id) || null,
        }];
      })),

      /** 明确：代码里不存在任何 SpeechSynthesis 回退 */
      ttsFallback: false,
    };
  }
}

export default VoiceManager;
