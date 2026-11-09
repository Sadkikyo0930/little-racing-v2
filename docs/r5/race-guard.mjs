/**
 * r5/race-guard.mjs — 注入到正式赛车构建产物 docs/index.html 的守卫入口
 *
 * 必须在游戏主模块之前执行（见 tools/apply-patch.mjs）。
 *  1. 首屏**同步**判断：没有有效防深链凭证 → 立刻退回 gate.html，游戏模块不启动；
 *  2. 有凭证也**不能**说明有资格：createGuard.boot() 会重新问服务端（r5_status），
 *     再启动云端计时会话（start + 10s 心跳）。服务端拒绝就清掉凭证并退回。
 *  3. 任何异常一律 fail-closed，给孩子友好提示，绝不静默放行。
 */
import { createR5Gate, R5Session, messageFor } from './r5-online.mjs';
import { R5_CONFIG, learnUrl } from './config.mjs';
import { entryUrl } from './paths.mjs';
import { getDevice, readGrant, refreshGrant, clearGrant } from './grant.mjs';
import { createGuard } from './guard-core.mjs';

// Export a promise consumed by the only game-module loader in index.html.
// No game JS may execute until the server confirms eligibility AND start succeeds.
export const ready = (async () => {
  const device = getDevice();
  const grant = readGrant(device);
  if (!device || !grant.ok) {
    try { document.documentElement.style.visibility = 'hidden'; } catch { /* ignore */ }
    const reason = !device ? 'NO_DEVICE' : grant.reason;
    location.replace(entryUrl() + '?r5=' + encodeURIComponent(reason));
    return false;
  }

  const gate = createR5Gate({
    base: R5_CONFIG.base,
    familyId: R5_CONFIG.familyId,
    device,
    timeoutMs: R5_CONFIG.timeoutMs,
  });
  gate.messageFor = messageFor;

  const session = new R5Session(gate, {
    heartbeatSeconds: R5_CONFIG.heartbeatSeconds,
    onPaused: () => console.info('[r5] 切到后台，云端计时已暂停'),
  });
  const guard = createGuard({
    doc: document,
    gate,
    session,
    learnUrl: learnUrl(),
    entryUrl: entryUrl(),
    onGrantRefresh: () => refreshGrant(R5_CONFIG.grantTtlSeconds),
    onServerDenied: () => clearGrant(),
  });
  document.addEventListener('click', (ev) => {
    if (guard.intercept(ev.target)) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  }, true);
  window.addEventListener('pagehide', event => {
    if (event.persisted) session.pauseForPageCache();
    else session.end('pagehide');
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) session._onVisibility();
  });
  window.__R5_GUARD__ = guard;
  try {
    const result = await guard.boot();
    if (!result.ok) console.info('[r5] 未放行:', result.reason || result.error);
    return !!result.ok;
  } catch (e) {
    console.error('[r5] 守卫异常:', e);
    clearGrant();
    guard.lockDown('net', 'R5_GATEWAY_ERROR');
    return false;
  }
})();
