/**
 * r5/grant.mjs — 设备令牌与「防深链凭证」的本地存储 · v1.8.0-rc2
 *
 * 重要边界（v1.8.0-rc2 收紧）：
 *  - 这里的凭证 **不是授权**，只用于「直接打开游戏页时先退回通行证」这一个 UX 目的；
 *    每次打开游戏页都会重新向云端 r5_child_entry / r5_game_action 确认，
 *    服务端说不放行就一律不放行。伪造 sessionStorage 拿不到游戏资格。
 *  - 设备令牌只存孩子这台设备的 localStorage，绝不写进源码、URL 之外的任何地方。
 *  - 凭证存 sessionStorage，5 分钟滑动过期；关掉标签页即失效。
 *  - 剩余时间永远只显示服务端返回值，前端不自行累计、不做「每天重置」。
 */

const DEVICE_KEY = 'r5_device';
const GRANT_KEY = 'r5.grant';

/** 从 URL 的 ?d= 读设备令牌（家长给孩子的链接），并落到 localStorage */
export function captureDeviceFromUrl(search = location.search) {
  const fromQuery = new URLSearchParams(search).get('d');
  if (fromQuery && /^[A-Za-z0-9_-]{8,80}$/.test(fromQuery)) {
    try {
      localStorage.setItem(DEVICE_KEY, fromQuery);
      // Never leave a reusable device credential in browser history/address bar.
      // Keep unrelated URL parameters and hash intact.
      const u = new URL(location.href);
      if (u.searchParams.has('d')) {
        u.searchParams.delete('d');
        history.replaceState(history.state, '', u.pathname + u.search + u.hash);
      }
    } catch { /* 隐私模式或非浏览器测试：不回显令牌 */ }
    return fromQuery;
  }
  return null;
}

export function getDevice() {
  try {
    const v = localStorage.getItem(DEVICE_KEY);
    return v && /^[A-Za-z0-9_-]{8,80}$/.test(v) ? v : '';
  } catch {
    return '';
  }
}

export function setDevice(device) {
  try { localStorage.setItem(DEVICE_KEY, device); } catch { /* ignore */ }
}

export function clearDevice() {
  try { localStorage.removeItem(DEVICE_KEY); } catch { /* ignore */ }
}

/** 云端确认「可以玩」后签发防深链凭证（仅会话级） */
export function issueGrant(device, ttlSeconds = 300, extra = {}) {
  const grant = { device, at: Date.now(), exp: Date.now() + ttlSeconds * 1000, ...extra };
  try { sessionStorage.setItem(GRANT_KEY, JSON.stringify(grant)); } catch { /* ignore */ }
  return grant;
}

export function refreshGrant(ttlSeconds = 300) {
  const g = readGrantRaw();
  if (!g) return null;
  const next = { ...g, exp: Date.now() + ttlSeconds * 1000 };
  try { sessionStorage.setItem(GRANT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

export function readGrantRaw() {
  try {
    const raw = sessionStorage.getItem(GRANT_KEY);
    if (!raw) return null;
    const g = JSON.parse(raw);
    return g && typeof g === 'object' ? g : null;
  } catch {
    return null;
  }
}

/**
 * @returns {{ok:boolean, reason?:string, grant?:object}}
 *  reason: 'NO_DEVICE' | 'NO_GRANT' | 'GRANT_EXPIRED' | 'GRANT_DEVICE_MISMATCH'
 */
export function readGrant(device = getDevice(), now = Date.now()) {
  if (!device) return { ok: false, reason: 'NO_DEVICE' };
  const g = readGrantRaw();
  if (!g) return { ok: false, reason: 'NO_GRANT' };
  if (g.device !== device) return { ok: false, reason: 'GRANT_DEVICE_MISMATCH' };
  if (!(Number(g.exp) > now)) return { ok: false, reason: 'GRANT_EXPIRED' };
  return { ok: true, grant: g };
}

export function clearGrant() {
  try { sessionStorage.removeItem(GRANT_KEY); } catch { /* ignore */ }
}
