/* ------------------------------------------------------------------ *
 * 小小赛车 V2 — 背景音乐管理器（独立模块）
 *
 * 这是全游戏唯一播放背景音乐的地方。UI / 流程文件只调用 play() / stop() /
 * setMuted() / setEnabled() / setVolume()，不自己碰 <audio>。
 *
 * 设计要点
 *  - 两个固定的 HTMLAudioElement，构造时创建一次，永不重复创建，
 *    永不叠加新音轨（没有内存泄漏）。
 *  - 循环由音频文件本身保证：两首 MP3 已经过波形/节拍分析，在完整
 *    小节线上做了等功率短交叉淡化，HTMLAudioElement.loop = true 即可无缝
 *    循环，运行时不需要 Web Audio API，也不需要定时器去跳 currentTime。
 *  - 切曲采用「淡出 0.5s → 新曲从 0 淡入 0.5s」，合计约 1 秒。
 *    淡出完成后才 pause 旧曲并启动新曲，所以任何稳态时刻只有一首
 *    背景音乐在响，不会出现两首歌叠在一起。
 *  - 同一首曲目重复 play() 不重启（首页 → 赛道选择 → 角色选择 音乐会连续）。
 *  - 浏览器自动播放限制：play() 只在用户手势里首次调用；若被拒绝，
 *    只挂载一次性的 pointerdown / keydown 监听，下一次交互再试一次，
 *    绝不轮询重试、绝不阻塞游戏。
 *  - 静音是「粘性」的：静音期间任何场景切换都不会把音量拉回来。
 * ------------------------------------------------------------------ */

import homeUrl from '../assets/audio/music-home.mp3?url';
import raceUrl from '../assets/audio/music-race.mp3?url';

import { K_MUSIC } from '../garage/save.js';

const PREF_KEY = K_MUSIC;

/** 两首曲子各自的默认音量（100% 设置时生效）。 */
const BASE_VOLUME = { home: 0.35, race: 0.45 };

const SWITCH_HALF_MS = 500;   // 淡出 / 淡入各 0.5s → 切曲约 1s
const STOP_FADE_MS = 1000;    // 比赛结束淡出 1s
const VOL_MS = 140;           // 静音 / 音量滑块的即时渐变
const DUCK_FACTOR = 0.35;     // 角色说话时背景音乐压到 35%
const TICK_MS = 25;

function clamp01(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

function loadPrefs() {
  try {
    const raw = globalThis.localStorage?.getItem(PREF_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        enabled: typeof p.enabled === 'boolean' ? p.enabled : true,
        volume: Number.isFinite(p.volume) ? clamp01(p.volume) : 1,
      };
    }
  } catch {
    // 隐私模式下 localStorage 可能抛错，音乐仍然可用，只是不持久化。
  }
  return { enabled: true, volume: 1 };
}

export class MusicManager {
  constructor() {
    this.prefs = loadPrefs();
    /** 全局静音状态，由 Audio（静音按钮 / M 键）驱动。 */
    this.muted = false;
    /** 角色正在说话时的压低倍率（1 = 不压低）。由 VoiceManager 驱动。 */
    this.duck = 1;
    this.hidden = typeof document !== 'undefined' && !!document.hidden;
    /** 期望播放的曲目；null 表示不播放（启动页 / 比赛结束）。 */
    this.wanted = null;
    /** 当前正在发声（或正在淡出）的曲目。 */
    this.current = null;
    this.unlocked = false;
    this.failed = Object.create(null);
    this.tracks = Object.create(null);
    this._created = false;
    this._token = 0;                 // 取消过期的切换 / 淡出回调
    this._ramps = new Map();         // element -> 当前音量渐变
    this._retryArmed = false;
    this._ensureCreated();
    this._bindVisibility();
  }

  /* ------------------------- 单例创建 ------------------------- */
  _ensureCreated() {
    if (this._created) return;       // 多次点击「开始游戏」不会重建播放器
    this._created = true;
    const defs = [
      ['home', homeUrl, 'auto'],     // 首页曲随页面一起预加载
      ['race', raceUrl, 'none'],     // 比赛曲等用户交互后再预加载，不与首屏抢带宽
    ];
    for (const [key, url, preload] of defs) {
      const el = new Audio();
      el.src = url;
      el.loop = true;               // 音频文件本身已做无缝循环处理
      el.preload = preload;
      el.volume = 0;
      el.playsInline = true;        // iOS Safari：不要切到全屏播放器
      el.setAttribute('playsinline', '');
      el.setAttribute('webkit-playsinline', '');
      el.addEventListener('error', () => {
        // 加载失败只记录，游戏照常跑；绝不抛错、绝不重试循环。
        this.failed[key] = true;
      });
      this.tracks[key] = el;
    }
  }

  /**
   * 在用户首次交互（点击「开始游戏」）后调用：提前把比赛曲拉进缓存，
   * 这样倒计时 5.5 秒里它已经准备好。不可播放时也不影响游戏。
   */
  unlock() {
    const race = this.tracks.race;
    if (race && race.preload === 'none') {
      try { race.preload = 'auto'; race.load(); } catch { /* 忽略 */ }
    }
  }

  /* ------------------------- 对外 API ------------------------- */

  /** 请求播放某首曲子。重复请求同一首不会重启。 */
  play(name) {
    if (name !== 'home' && name !== 'race') return;
    if (!this.tracks[name] || this.failed[name]) return;
    this.wanted = name;
    if (this.current === name) {
      // 场景切换（首页 → 赛道 → 选角）保持同一首，只校正音量。
      // 若用户恰好在 1 秒切曲窗口内又切回原曲，取消那次未完成的切换。
      if (this._hasProtectedRamp()) this._cancelPendingSwitch();
      this._applyTarget(name);
      return;
    }
    this._switchTo(name);
  }

  /** 统一校正音量，并确保该响的时候确实在播放（例如从后台/静音恢复）。 */
  _applyTarget(name = this.current, ms = VOL_MS) {
    if (!name || !this.tracks[name]) return;
    const target = this._targetFor(name);
    const el = this.tracks[name];
    if (target > 0 && el.paused && !this.hidden) this._tryPlay(el);
    if (this._switchProtected(el)) return;   // 不打断正在进行的切曲渐变
    this._fade(el, target, ms);
  }

  _switchProtected(el) {
    const ramp = this._ramps.get(el);
    return !!(ramp && ramp.protect);
  }

  _hasProtectedRamp() {
    for (const ramp of this._ramps.values()) if (ramp.protect) return true;
    return false;
  }

  _cancelPendingSwitch() {
    this._token++;
    for (const [el, ramp] of this._ramps) {
      if (ramp.protect) { clearInterval(ramp.timer); this._ramps.delete(el); }
    }
  }

  /** 停止播放并淡出（比赛结束）。 */
  stop(fade = true) {
    this.wanted = null;
    if (!this.current) return;
    const el = this.tracks[this.current];
    const token = ++this._token;
    if (!fade) {
      try { el.pause(); } catch { /* 忽略 */ }
      el.volume = 0;
      this.current = null;
      return;
    }
    this._fade(el, 0, STOP_FADE_MS, () => {
      if (token !== this._token) return;   // 期间又切了新曲，别把新曲停掉
      try { el.pause(); } catch { /* 忽略 */ }
      this.current = null;
    }, true);   // 可以打断尚未完成的切曲淡出
  }

  /** 与现有静音按钮同步：静音期间切页不会自动恢复声音。 */
  setMuted(muted) {
    this.muted = !!muted;
    this._applyTarget(this.current);
    return this.muted;
  }

  /** 设置界面里的「音乐 开 / 关」。 */
  setEnabled(on) {
    this.prefs.enabled = !!on;
    this._savePrefs();
    if (!this.prefs.enabled) {
      this._applyTarget(this.current);     // 淡出到 0，但不改 wanted
      return this.prefs.enabled;
    }
    if (!this.current && this.wanted) this.play(this.wanted);
    else this._applyTarget(this.current);
    return this.prefs.enabled;
  }

  /**
   * 角色说话时把背景音乐压低（不是静音），说完恢复。
   * 与静音设置叠加：静音时目标音量本来就是 0，压低不会把声音拉回来。
   * 140ms 渐变，不会「咔」一下。
   */
  setDuck(on) {
    const next = on ? DUCK_FACTOR : 1;
    if (Math.abs(next - this.duck) < 1e-6) return this.duck;
    this.duck = next;
    this._applyTarget(this.current);
    return this.duck;
  }

  /** 设置界面里的「音乐音量 0～100%」（相对各曲目默认音量的倍率）。 */
  setVolume(v) {
    this.prefs.volume = clamp01(v);
    this._savePrefs();
    this._applyTarget(this.current);
    return this.prefs.volume;
  }

  get enabled() { return this.prefs.enabled; }
  get volume() { return this.prefs.volume; }

  /* ------------------------- 内部逻辑 ------------------------- */
  _targetFor(name) {
    if (!name) return 0;
    if (!this.prefs.enabled || this.muted || this.hidden || this.wanted !== name) return 0;
    if (this.failed[name]) return 0;
    return clamp01(BASE_VOLUME[name] * this.prefs.volume * this.duck);
  }

  _switchTo(name) {
    const token = ++this._token;
    const startNew = () => {
      if (token !== this._token) return;
      const el = this.tracks[name];
      if (!el || this.failed[name]) return;
      this.current = name;
      el.volume = 0;
      try { el.currentTime = 0; } catch { /* 尚未加载时设置会抛错，忽略 */ }
      this._tryPlay(el).then((ok) => {
        if (!ok || token !== this._token) return;
        this._fade(el, this._targetFor(name), SWITCH_HALF_MS);
        // 切曲窗口结束后按「此刻」的设置再收敛一次：窗口里用户改静音
        // 或拉音量，也不会让新曲停在旧的目标音量上。
        setTimeout(() => {
          if (token === this._token) this._applyTarget(name);
        }, SWITCH_HALF_MS + 30);
      });
    };

    if (this.current && this.current !== name) {
      // 旧曲淡出用 protected 渐变 + 独立定时器推进：外部改静音/音量时
      // _applyTarget 不会覆盖它，切曲流程就不会卡在半路。
      const old = this.tracks[this.current];
      this._fade(old, 0, SWITCH_HALF_MS, null, true);
      setTimeout(() => {
        if (token !== this._token) return;
        try { old.pause(); } catch { /* 忽略 */ }
        old.volume = 0;
        startNew();
      }, SWITCH_HALF_MS);
    } else {
      startNew();
    }
  }

  /** 线性音量渐变。protected 渐变（切曲淡出）不会被普通的设置变更覆盖。 */
  _fade(el, to, ms, done, protect = false) {
    const prev = this._ramps.get(el);
    if (prev) {
      if (prev.protect && !protect) return;
      clearInterval(prev.timer);
    }
    const toV = clamp01(to);
    const steps = Math.max(1, Math.round(ms / TICK_MS));
    const from = el.volume;
    let i = 0;
    const ramp = { timer: null, protect };
    const timer = setInterval(() => {
      i++;
      const k = Math.min(1, i / steps);
      el.volume = clamp01(from + (toV - from) * k);
      if (i >= steps) {
        clearInterval(timer);
        if (this._ramps.get(el) === ramp) {
          this._ramps.delete(el);
          el.volume = toV;
          done?.();
        }
      }
    }, TICK_MS);
    ramp.timer = timer;
    this._ramps.set(el, ramp);
  }

  async _tryPlay(el) {
    try {
      await el.play();
      this.unlocked = true;
      return true;
    } catch {
      // iOS Safari / 微信等可能拒绝自动播放：不重试、不阻塞、不报错。
      this.unlocked = false;
      this._armGestureRetry();
      return false;
    }
  }

  /** 只挂一次性的手势监听，下一次点击/按键再尝试一次。 */
  _armGestureRetry() {
    if (this._retryArmed) return;
    this._retryArmed = true;
    const onGesture = () => {
      this._retryArmed = false;
      document.removeEventListener('pointerdown', onGesture, true);
      document.removeEventListener('keydown', onGesture, true);
      const name = this.current || this.wanted;
      if (!name) return;
      const el = this.tracks[name];
      if (!el || this._targetFor(name) <= 0) return;
      this._tryPlay(el).then((ok) => {
        if (ok) this._fade(el, this._targetFor(name), SWITCH_HALF_MS);
      });
    };
    document.addEventListener('pointerdown', onGesture, true);
    document.addEventListener('keydown', onGesture, true);
  }

  _bindVisibility() {
    if (typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', () => {
      this.hidden = !!document.hidden;
      if (this.hidden) {
        // 进入后台：暂停（省电、避免后台偷偷出声）。
        for (const el of Object.values(this.tracks)) {
          try { if (!el.paused) el.pause(); } catch { /* 忽略 */ }
        }
        return;
      }
      // 回到前台：严格按用户当前设置恢复，静音/关闭的音乐不会自己响起来。
      const name = this.current;
      if (!name || this._targetFor(name) <= 0) return;
      const el = this.tracks[name];
      this._tryPlay(el).then((ok) => {
        if (ok) this._fade(el, this._targetFor(name), VOL_MS);
      });
    });
  }

  _savePrefs() {
    try {
      globalThis.localStorage?.setItem(PREF_KEY, JSON.stringify({
        enabled: this.prefs.enabled,
        volume: this.prefs.volume,
      }));
    } catch { /* 非关键 */ }
  }

  /** 自动化测试用的只读快照。 */
  debugState() {
    const tracks = {};
    for (const [key, el] of Object.entries(this.tracks)) {
      tracks[key] = {
        paused: el.paused,
        volume: +el.volume.toFixed(3),
        currentTime: +el.currentTime.toFixed(2),
        loop: el.loop,
        readyState: el.readyState,
        error: el.error ? el.error.code : null,
        src: (el.currentSrc || el.src).split('/').pop(),
      };
    }
    return {
      wanted: this.wanted, current: this.current,
      enabled: this.prefs.enabled, volume: this.prefs.volume,
      muted: this.muted, duck: this.duck, hidden: this.hidden, unlocked: this.unlocked,
      failed: { ...this.failed }, created: this._created,
      elementCount: Object.keys(this.tracks).length, tracks,
    };
  }
}
