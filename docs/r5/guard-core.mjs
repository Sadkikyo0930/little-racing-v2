/**
 * r5/guard-core.mjs — 赛车页内的资格守卫（可测试核心）· v1.8.0-rc1
 *
 * 职责与边界：
 *  1. 每次打开游戏页，先向服务端做一次**只读**资格复核（r5_child_entry / r5_status）；
 *     本地 grant 只用于「防直接深链」，绝不作为授权依据；
 *  2. 通过后才调用 R5Session.begin() 启动云端计时会话（start + 10s 心跳）；
 *     剩余时间、累计时长全部来自服务端，前端不自增、不重置、不缓存；
 *  3. 未授权 / 未达标 / 成绩未同步 / 时间用完：一律 fail-closed，不启动游戏入口；
 *  4. 断网 / 超时 / 响应异常：不放行，给孩子看得懂的友好提示；
 *  5. 时间归零时允许跑完当前这一场，但禁止开始下一场。
 *
 * 只做 DOM 操作与状态机，不直接发网络请求（由注入的 gate 提供），可在 jsdom 里测。
 */

const ENTRY_SELECTORS = [
  '#playBtn',           // 普通比赛
  '#storyBtn',          // 故事冒险 · 第一章
  '#storyBtn2',         // 故事冒险 · 第二章
  '#againBtn',          // 再来一局
  '#courseGrid button', // 赛道直达
  '#charGrid button',   // 选赛车手
];

const STYLE = `
#r5-hud{position:fixed;top:calc(env(safe-area-inset-top,0px) + 10px);right:12px;z-index:2147483000;
  display:flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;
  background:rgba(8,20,38,.78);color:#fff;font:700 15px/1 -apple-system,"PingFang SC",sans-serif;
  box-shadow:0 6px 18px rgba(0,0,0,.35);backdrop-filter:blur(6px);pointer-events:none}
#r5-hud.low{background:rgba(226,59,46,.9)}
#r5-hud .dot{width:8px;height:8px;border-radius:50%;background:#2fae6a}
#r5-hud.low .dot{background:#fff}
#r5-banner{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 64px);transform:translateX(-50%);
  z-index:2147483001;padding:12px 18px;border-radius:16px;background:rgba(226,59,46,.95);color:#fff;
  font:600 15px/1.5 -apple-system,"PingFang SC",sans-serif;box-shadow:0 10px 26px rgba(0,0,0,.35);
  max-width:86vw;text-align:center;pointer-events:none}
#r5-veil{position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;
  padding:22px;background:radial-gradient(1200px 600px at 50% -10%,#1d3f6b 0%,#0a1c33 60%,#06101f 100%);
  font-family:-apple-system,"PingFang SC",sans-serif;color:#12243d}
#r5-veil .box{width:100%;max-width:460px;background:#fff;border-radius:24px;padding:24px 20px;
  box-shadow:0 24px 60px rgba(0,0,0,.45);text-align:center}
#r5-veil .emoji{font-size:46px;line-height:1;margin-bottom:10px}
#r5-veil h2{margin:0 0 8px;font-size:19px}
#r5-veil p{margin:0 0 16px;color:#5b7290;font-size:14px;line-height:1.65}
#r5-veil button{display:block;width:100%;border:0;border-radius:14px;padding:15px;font:700 16px inherit;
  cursor:pointer;margin-top:9px;font-family:inherit}
#r5-veil .primary{background:#e23b2e;color:#fff}
#r5-veil .ghost{background:#eef4fb;color:#12243d}
#r5-veil .spin{width:44px;height:44px;border-radius:50%;border:4px solid #e6eef7;border-top-color:#e23b2e;
  margin:6px auto 12px;animation:r5spin .9s linear infinite}
@keyframes r5spin{to{transform:rotate(360deg)}}
.r5-blocked{filter:grayscale(.55) brightness(.72);pointer-events:none}
`;

function ensureStyle(doc) {
  if (doc.getElementById('r5-style')) return;
  const s = doc.createElement('style');
  s.id = 'r5-style';
  s.textContent = STYLE;
  (doc.head || doc.documentElement).appendChild(s);
}

export function isInRace(doc = document) {
  const hud = doc.getElementById('hud');
  return !!hud && !hud.classList.contains('hidden');
}

/** 未达标 / 未同步 / 未授权的友好文案（孩子视角） */
export function blockMessage(reason, messageFor) {
  const m = messageFor || ((r) => r);
  if (reason === 'TIME_LIMIT_REACHED') return '今天的 30 分钟用完啦，存档都给你留着。明天学习完再来！';
  if (reason === 'PLAN_UNPUBLISHED') return '今天的学习记录还在送到云端，先等一下下，或者请爸爸妈妈看一眼～';
  if (reason === 'STUDY_INCOMPLETE_OR_SCORE_UNVERIFIED') return '今天的两个学习任务还没做完（每科要答对 80% 哦），先去学习吧～';
  if (reason === 'R5_MEMBER_DENIED' || reason === 'R5_DEVICE_REQUIRED' || reason === 'R5_INVALID_DEVICE') {
    return m(reason);
  }
  return m(reason);
}

/**
 * @param {object} opts
 * @param {Document} opts.doc
 * @param {{status:Function,start:Function,tick:Function,stop:Function,messageFor:Function}} opts.gate
 * @param {object} [opts.session] R5Session 实例（提供 begin/end + 心跳）
 * @param {Function} [opts.onUpdate]
 * @param {Function} [opts.onEnded]
 * @param {Function} [opts.onGrantRefresh]
 * @param {Function} [opts.onServerDenied] 服务端拒绝时回调（用于清除本地凭证）
 */
export function createGuard(opts) {
  const doc = opts.doc || document;
  const gate = opts.gate;
  const session = opts.session;
  const learnUrl = opts.learnUrl || 'https://sadkikyo0930.github.io/little-growth-workbench/v6/';
  const entryUrl = opts.entryUrl || '/';

  const state = {
    phase: 'boot',      // boot | playing | expired | blocked
    expired: false,
    locked: false,
    last: null,
    failures: 0,
    serverPreflight: null,
    sessionStarted: false,
  };

  ensureStyle(doc);

  const el = (tag, id, cls) => {
    const n = doc.createElement(tag);
    if (id) n.id = id;
    if (cls) n.className = cls;
    return n;
  };

  function hud() {
    let n = doc.getElementById('r5-hud');
    if (n) return n;
    n = el('div', 'r5-hud');
    n.innerHTML = '<span class="dot"></span><span id="r5-clock">--:--</span>';
    doc.body.appendChild(n);
    return n;
  }

  function setClock(seconds) {
    const n = doc.getElementById('r5-clock');
    if (!n) return;
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    n.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const box = doc.getElementById('r5-hud');
    if (box) box.classList.toggle('low', s <= 120);
  }

  function banner(text) {
    let n = doc.getElementById('r5-banner');
    if (!n) {
      n = el('div', 'r5-banner');
      n.id = 'r5-banner';
      doc.body.appendChild(n);
    }
    n.textContent = text;
    return n;
  }

  function clearBanner() {
    const n = doc.getElementById('r5-banner');
    if (n) n.remove();
  }

  function veil(html, buttons) {
    let v = doc.getElementById('r5-veil');
    if (v) v.remove();
    v = el('div', 'r5-veil');
    v.id = 'r5-veil';
    const box = el('div', 'r5-box');
    box.className = 'box';
    box.innerHTML = html;
    v.appendChild(box);
    (buttons || []).forEach((b) => {
      const btn = el('button', null, b.cls || 'ghost');
      btn.type = 'button';
      btn.textContent = b.label;
      btn.addEventListener('click', b.onClick);
      box.appendChild(btn);
    });
    doc.body.appendChild(v);
    return v;
  }

  function removeVeil() {
    const v = doc.getElementById('r5-veil');
    if (v) v.remove();
  }

  function blockEntries(on) {
    state.locked = !!on;
    (opts.entrySelectors || ENTRY_SELECTORS).forEach((sel) => {
      doc.querySelectorAll(sel).forEach((node) => {
        node.classList.toggle('r5-blocked', !!on);
        if ('disabled' in node && /^(BUTTON)$/.test(node.tagName)) node.disabled = !!on;
      });
    });
  }

  /** 点击拦截：有效期外/已锁定时，拦截所有「开始比赛」类入口 */
  function intercept(target) {
    if (!target || (!state.expired && !state.locked)) return false;
    const sel = (opts.entrySelectors || ENTRY_SELECTORS).join(',');
    const hit = target.closest ? target.closest(sel) : null;
    if (!hit) return false;
    banner(state.expired ? '今天的 30 分钟用完啦，明天再来！' : '网络不太好，先休息一下～');
    return true;
  }

  function lockDown(kind, reason) {
    state.locked = true;
    blockEntries(true);
    clearBanner();
    const isTime = kind === 'time';
    const title = isTime ? '今天的 30 分钟用完啦' : '暂时连不上学习记录';
    const body = isTime
      ? '今天的赛车时间用完了，存档都给你留着。明天学习完再来！'
      : `${blockMessage(reason, gate.messageFor)} 计时已经暂停，为了公平，先休息一下吧。`;
    veil(
      `<div class="emoji">${isTime ? '🌙' : '🛠️'}</div><h2>${title}</h2><p>${body}</p>`,
      [
        { label: '去学习（V6 学习平台）', cls: 'primary', onClick: () => { doc.location.href = learnUrl; } },
        isTime ? null : { label: '再试一次', cls: 'ghost', onClick: () => { doc.location.reload(); } },
      ].filter(Boolean),
    );
  }

  function deny(reason, kind) {
    state.phase = 'blocked';
    state.last = Object.assign({}, state.last, { reason });
    blockEntries(true);
    if (opts.onServerDenied) opts.onServerDenied(reason);
    const isTime = reason === 'TIME_LIMIT_REACHED';
    veil(
      `<div class="emoji">${isTime ? '🌙' : '📚'}</div><h2>${isTime ? '今天的 30 分钟用完啦' : '先去学习再来赛车'}</h2>
       <p>${blockMessage(reason, gate.messageFor)}</p>`,
      [{ label: '去学习（V6 学习平台）', cls: 'primary', onClick: () => { doc.location.href = learnUrl; } }],
    );
    if (kind === 'network') {
      const box = doc.querySelector('#r5-veil .box');
      if (box) {
        const b = el('button', null, 'ghost');
        b.type = 'button';
        b.textContent = '再试一次';
        b.addEventListener('click', () => doc.location.reload());
        box.appendChild(b);
      }
    }
  }

  function expire() {
    if (state.expired) return;
    state.expired = true;
    state.phase = 'expired';
    state.raceOpen = isInRace(doc);
    blockEntries(true);
    if (state.raceOpen) {
      banner('时间到啦，跑完这一场就结束哦～');
      return;
    }
    lockDown('time', 'TIME_LIMIT_REACHED');
  }

  function watchRace() {
    const check = () => {
      if (!state.expired || !state.raceOpen) return;
      if (!isInRace(doc)) {
        state.raceOpen = false;
        lockDown('time', 'TIME_LIMIT_REACHED');
      }
    };
    const target = doc.getElementById('hud');
    if (target && typeof MutationObserver !== 'undefined') {
      new MutationObserver(check).observe(target, { attributes: true, attributeFilter: ['class'] });
    }
    const timer = setInterval(check, 500);
    return () => clearInterval(timer);
  }

  // 会话回调在 boot 之前装好，避免 begin() 期间的首次状态/结束事件丢失
  if (session) {
    session.onUpdate = (s) => {
      state.last = s;
      setClock(s.remaining_seconds);
      state.failures = 0;
      if (opts.onGrantRefresh) opts.onGrantRefresh(s.remaining_seconds);
      if (opts.onUpdate) opts.onUpdate(s);
      // 只在真正进入游戏后才允许「时间到」；begin() 期间收到拒绝由 boot() 的 deny() 处理
      if (state.phase === 'playing' && (Number(s.remaining_seconds) <= 0 || !s.allowed)) expire();
    };
    session.onError = (e) => {
      state.failures += 1;
      if (!session.active || state.failures >= 3) {
        session.destroy?.();
        state.phase = 'blocked';
        if (isInRace(doc)) { blockEntries(true); banner('网络不太好，跑完这一场就休息一下吧'); }
        else lockDown('net', (e && e.code) || 'R5_NETWORK');
      }
    };
    session.onEnded = (s) => {
      expire();
      if (opts.onEnded) opts.onEnded(s);
    };
  }

  async function boot() {
    state.phase = 'boot';
    veil('<div class="spin"></div><h2>正在确认学习资格…</h2><p>只要一秒，马上就好～</p>', []);
    let st;
    try {
      // ① 服务端只读复核：本地凭证不作数，每次打开都重新问云端
      if (gate.status) {
        const pre = await gate.status();
        state.serverPreflight = pre;
        if (session && Number(pre.heartbeat_seconds) > 0) session.setHeartbeatSeconds(pre.heartbeat_seconds);
        if (!pre || pre.allowed !== true || !(Number(pre.remaining_seconds) > 0)) {
          const reason = (pre && pre.reason) || 'STUDY_INCOMPLETE_OR_SCORE_UNVERIFIED';
          deny(reason, 'study');
          return { ok: false, reason };
        }
      }
      // ② 开启云端计时会话（start + 心跳）；无 session 时退化为单次 start
      st = session ? await session.begin() : await gate.start();
      state.sessionStarted = !!(session && session.active);
    } catch (e) {
      const code = (e && e.code) || 'R5_NETWORK';
      deny(code, 'network');
      return { ok: false, error: code };
    }
    state.last = st;
    if (!st || st.allowed !== true || !(Number(st.remaining_seconds) > 0) || (session && !session.active)) {
      session?.destroy?.();
      const reason = (st && st.reason) || 'STUDY_INCOMPLETE_OR_SCORE_UNVERIFIED';
      deny(reason, 'study');
      return { ok: false, reason };
    }
    removeVeil();
    state.phase = 'playing';
    hud();
    setClock(st.remaining_seconds);
    watchRace();
    return { ok: true, status: st };
  }

  return {
    boot, expire, intercept, lockDown, deny,
    state,
    isExpired: () => state.expired,
    isLocked: () => state.locked,
    entryUrl,
  };
}
