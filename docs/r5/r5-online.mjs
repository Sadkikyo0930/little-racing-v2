/**
 * r5/r5-online.mjs — R5 学习闸门 · 浏览器端 SDK（零依赖、零密钥）· v1.9.0-session-bound
 *
 * 唯一真相在服务端：
 *   /v1/child/entry      → r5_child_entry()  → r5_status()   （只读确认资格）
 *   /v1/game/action start→ r5_game_action_v2() → 云端开始计时并下发 session_id
 *   /v1/game/action tick → r5_game_action_v2() → 云端按 DB 时钟累计（必须带 session_id）
 *   /v1/game/action stop → r5_game_action_v2() → 云端结束计时并作废 session_id
 * 前端不计算经过时间、不缓存 allowed、不缓存 remaining、不做每日重置。
 *
 * v1.9.0-session-bound（相对 v1.8.0-rc2）：
 *   1. start 返回的服务端 session_id 只存内存，tick/stop 原样带回；
 *      刷新、换标签页、重放请求都没有它，家长免学习会话只能开一次。
 *   2. 切后台不再发 stop（那会把会话彻底作废），只停心跳：
 *      45 秒内回前台用同一标识原地续接，超时由服务端判失效、回家长验证。
 *   3. 页面缓存 / 真正离开时仍然 stop，让云端立刻停止计时。
 */

export const R5_DEFAULT_BASE = 'https://normal-goose-d5g4qyzr8bb389a4a.service.tcloudbase.com/r5';
export const R5_DEFAULT_FAMILY = 'little-growth-family-001';

/** 业务原因 → 给孩子看的话（6～8 岁，短句、不吓人、不指责） */
export const R5_MESSAGES = {
  STUDY_PASSED: '学习完成啦，去赛车吧！',
  STUDY_PASSED_WITH_WAIVER: '今天爸爸妈妈帮你确认过啦，去赛车吧！',
  STUDY_INCOMPLETE_OR_SCORE_UNVERIFIED: '今天的两个学习任务还没完成，先去学习吧～',
  NO_TASKS_TODAY: '今天是休息日，可以放心玩！',
  PLAN_UNPUBLISHED: '今天的学习记录还没送到云端，先等一下下～',
  TIME_LIMIT_REACHED: '今天的 30 分钟用完啦，明天再来！',
  PARENT_CONTROL_DISABLED: '今天爸爸妈妈关掉了赛车，休息一下吧～',
  PARENT_DISABLED: '今天爸爸妈妈关掉了赛车，休息一下吧～',
  R5_MEMBER_DENIED: '这台设备还没绑定，请让爸爸妈妈帮你绑定一下。',
  R5_DEVICE_REQUIRED: '没有找到设备号，请用爸爸妈妈给你的链接打开。',
  R5_INVALID_DEVICE: '设备号看起来不对，请用爸爸妈妈给你的链接打开。',
  R5_TIME_UP: '今天的 30 分钟用完啦，明天再来！',
  R5_FAMILY_NOT_ALLOWED: '这台设备没有加入家庭。',
  R5_GATEWAY_ERROR: '网络有点忙，等一下再试试。',
  R5_NETWORK: '网络连不上，先检查一下 WiFi 哦。',
  R5_BAD_RESPONSE: '服务回应看不懂，等一下再试试。',
  R5_TIMEOUT: '等太久了，再试一次吧。',
  R5_SYNC_PENDING: '学习记录还在上传，等一下再来～',
  // 会话绑定：家长免学习通行只够开一次，过期或被回收后必须重新验证
  SESSION_REQUIRED: '这次家长通行已经用掉了，请让爸爸妈妈再帮你验证一次。',
  R5_INVALID_SESSION_ID: '这次通行已经失效了，请重新打开一次。',
};

export function messageFor(reason) {
  return R5_MESSAGES[reason] || R5_MESSAGES.R5_GATEWAY_ERROR;
}

export class R5Error extends Error {
  constructor(code, status, payload) {
    super(code || 'R5_ERROR');
    this.code = code || 'R5_ERROR';
    this.status = status;
    this.payload = payload;
  }
}

export function createR5Gate(options = {}) {
  const base = String(options.base || R5_DEFAULT_BASE).replace(/\/$/, '');
  const familyId = options.familyId || R5_DEFAULT_FAMILY;
  const device = options.device || '';
  const fetchImpl = options.fetch || globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs || 15000;
  // 服务端会话标识：只在内存里，不进 localStorage / sessionStorage / URL。
  // 刷新或换标签页就拿不到它，家长免学习会话因此只能被开一次。
  let sessionId = '';

  async function post(path, body, expectedApi = 'r5_status') {
    if (!device) throw new R5Error('R5_DEVICE_REQUIRED', 0, null);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res, text;
    try {
      res = await fetchImpl(base + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-r5-device': device },
        body: JSON.stringify({
          family_id: familyId,
          ...body,
          ...(sessionId ? { session_id: sessionId } : {}),
        }),
        signal: ctrl.signal,
        keepalive: body.action === 'stop',
      });
      text = await res.text();
    } catch (e) {
      const aborted = e && (e.name === 'AbortError' || /aborted/i.test(String(e.message)));
      throw new R5Error(aborted ? 'R5_TIMEOUT' : 'R5_NETWORK', 0, String(e && e.message));
    } finally {
      clearTimeout(timer);
    }
    let json = null;
    try { json = JSON.parse(text); } catch { /* keep null */ }
    if (!json) throw new R5Error('R5_BAD_RESPONSE', res.status, text);
    if (json.error) throw new R5Error(json.error, res.status, json);
    // 服务端返回体必须带 api 标记，避免把代理错误页当成合法状态
    if (json.api !== expectedApi || (expectedApi === 'r5_birthday' && !res.ok)) throw new R5Error('R5_BAD_RESPONSE', res.status, json);
    return json;
  }

  return {
    base, familyId, device,
    currentSessionId: () => sessionId,
    status: () => post('/v1/child/entry', {}),
    start: async () => {
      const st = await post('/v1/game/action', { action: 'start' });
      if (st && st.allowed === true && typeof st.session_id === 'string'
        && /^[a-f0-9]{32}$/.test(st.session_id)) {
        sessionId = st.session_id;
      } else if (st && st.allowed !== true) {
        sessionId = '';   // 服务端拒绝即作废，避免拿死标识反复续接
      }
      return st;
    },
    tick: () => post('/v1/game/action', { action: 'tick' }),
    stop: async () => {
      const st = await post('/v1/game/action', { action: 'stop' });
      sessionId = '';
      return st;
    },
    claimBirthday: () => post('/v1/birthday/claim', {}, 'r5_birthday'),
    messageFor,
  };
}

/**
 * 计时会话：服务端下发心跳间隔、切后台暂停、回前台恢复、归零回调、退出停止。
 * 前端只展示 remaining_seconds；累计时间只由 DB 时钟在 tick/stop 时增加。
 */
export class R5Session {
  constructor(gate, handlers = {}) {
    this.gate = gate;
    this.onUpdate = handlers.onUpdate || (() => {});
    this.onEnded = handlers.onEnded || (() => {});
    this.onPaused = handlers.onPaused || (() => {});
    this.onError = handlers.onError || (() => {});
    this.heartbeatMs = (handlers.heartbeatSeconds || 10) * 1000;
    this.active = false;
    this.state = null;
    this._timer = null;
    this._pausedByVisibility = false;
    this._visBound = this._onVisibility.bind(this);
    this._listening = false;
    this._visibilityQueue = Promise.resolve();
    this._pendingStop = null;
    this._pendingStart = null;
    this._epoch = 0;
  }

  /** 服务端下发心跳间隔时采用（防止前端擅自改快改慢） */
  setHeartbeatSeconds(n) {
    const v = Number(n);
    if (Number.isFinite(v) && v >= 5 && v <= 60) {
      this.heartbeatMs = v * 1000;
      this._schedule();
    }
  }

  _emit(st) {
    this.state = st;
    this.onUpdate(st);
  }

  _listen() {
    if (this._listening || typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', this._visBound);
    this._listening = true;
  }

  _unlisten() {
    if (!this._listening || typeof document === 'undefined') return;
    document.removeEventListener('visibilitychange', this._visBound);
    this._listening = false;
  }

  _schedule() {
    clearInterval(this._timer);
    this._timer = null;
    if (!this.active) return;
    this._timer = setInterval(() => { this.beat(); }, this.heartbeatMs);
  }

  async begin() {
    if (this._pendingStop) await this._pendingStop;
    const epoch = ++this._epoch;
    const start = this.gate.start();
    this._pendingStart = start;
    let st;
    try { st = await start; }
    finally { if (this._pendingStart === start) this._pendingStart = null; }
    if (epoch !== this._epoch) return { ...st, active: false };
    if (st && Number(st.heartbeat_seconds) > 0) this.heartbeatMs = Number(st.heartbeat_seconds) * 1000;
    this._emit(st);
    if (st.allowed !== true || !(Number(st.remaining_seconds) > 0) || st.active !== true) {
      this.active = false;
      this._schedule();
      if (st.reason === 'TIME_LIMIT_REACHED') this.onEnded(st);
      return st;
    }
    this.active = true;
    this._pausedByVisibility = false;
    this._listen();
    this._schedule();
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      this._pausedByVisibility = true;
      return this.end('PAUSED');
    }
    return st;
  }

  async beat() {
    if (!this.active) return this.state;
    const epoch = this._epoch;
    try {
      const st = await this.gate.tick();
      if (epoch !== this._epoch || !this.active) return this.state;
      this._emit(st);
      if (!st.active || Number(st.remaining_seconds) <= 0 || !st.allowed) {
        await this.end('ENDED');
        this.onEnded(st);
      }
      return st;
    } catch (e) {
      this.onError(e);
      return this.state;
    }
  }

  async end(reason) {
    ++this._epoch;
    this.active = false;
    this._schedule();
    if (reason !== 'PAUSED') {
      this._pausedByVisibility = false;
      this._unlisten();
    }
    if (this._pendingStop) return this._pendingStop;
    const starting = this._pendingStart;
    if (!starting && this.state?.active === false) return this.state;
    this._pendingStop = Promise.resolve(starting).catch(() => {}).then(() => this.gate.stop()).then(st => {
      this._emit(st);
      return st;
    }).catch(error => {
      this.onError(error);
      return this.state;
    }).finally(() => { this._pendingStop = null; });
    return this._pendingStop;
  }

  pauseForPageCache() {
    if (this.active || this._pendingStart) {
      this._pausedByVisibility = true;
      return this.end('PAUSED');
    }
  }

  _onVisibility() {
    if (typeof document === 'undefined') return;
    const hidden = document.visibilityState === 'hidden';
    this._visibilityQueue = this._visibilityQueue.then(async () => {
      if (hidden && this.active && !this._pausedByVisibility) {
        // 只停心跳，不调 stop：会话标识留在内存里，45 秒内回前台可原地续接；
        // 超过 45 秒服务端判会话失效，回来必须重新家长验证（不会长期免密）。
        this._pausedByVisibility = true;
        clearInterval(this._timer);
        this._timer = null;
        this.onPaused(this.state);
      } else if (!hidden && this._pausedByVisibility) {
        this._pausedByVisibility = false;
        const st = await this.begin();
        if (st.allowed !== true || st.active !== true || !(Number(st.remaining_seconds) > 0)) {
          this.onEnded(st);
        }
      }
    }).catch(error => this.onError(error));
    return this._visibilityQueue;
  }

  destroy() {
    ++this._epoch;
    this._pausedByVisibility = false;
    clearInterval(this._timer);
    this._timer = null;
    this.active = false;
    this._unlisten();
  }
}

export function formatClock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}
