/**
 * r5/paths.mjs — 页面地址解析（唯一来源）· v1.8.1-pwa
 *
 * 正式仓库 little-racing-v2 的 GitHub Pages 发布的是 **docs/ 目录**：
 *   https://sadkikyo0930.github.io/little-racing-v2/          → docs/index.html（游戏）
 *   https://sadkikyo0930.github.io/little-racing-v2/gate.html → docs/gate.html（通行证）
 * 因此 gate.html、index.html、r5/ 永远同级，一律用「相对当前页面」解析。
 * 不依赖仓库名、不依赖本地目录结构，也不改任何资源绝对路径。
 *
 * ---------------------------------------------------------------------------
 * PWA 全屏修复（fix/r5-parent-pwa-fullscreen-20261113）
 *
 * 旧实现返回 new URL('./index.html', location.href).href，即带 scheme + host
 * 的**绝对 URL**（https://sadkikyo0930.github.io/little-racing-v2/index.html）。
 * iOS 11.3+ 依据 manifest 的 scope 判断「一次跨文档导航是否留在已安装的
 * 主屏幕 Web App 内」；当导航从没有 manifest 引用的文档发起、且目标写成
 * 带 scheme+host 的绝对 URL 时，iOS 会把这次导航判定为离开应用，转交 Safari
 * 打开 —— 表现就是家长密码验证成功后退出全屏、出现地址栏与工具栏。
 *
 * 现在一律返回**同源相对路径**：
 *   - 相对路径天然与当前文档同源，且必然落在 manifest 的 scope './' 内；
 *   - 不会引入绝对 URL / 跨源 / 跨站跳转；
 *   - gate.html 与 index.html 同级，解析结果与 GitHub Pages 项目子路径无关。
 *
 * 注意：manifest 的 id / start_url / scope 均保持不变，已安装的桌面图标身份
 * 不变；项目没有 Service Worker，页面每次启动都从服务器取最新 HTML，所以
 * 旧图标无需删除或重新添加即可吃到修复。
 * ---------------------------------------------------------------------------
 */

/** 与当前页面同级的游戏页（相对路径，用于 location.replace / assign） */
export function gameUrl() {
  return './index.html';
}

/** 与当前页面同级的通行证页（相对路径；调用方会再拼 '?r5=<reason>'） */
export function entryUrl() {
  return './gate.html';
}

/**
 * 仅供自检 / 自动化测试：确认一个导航目标与当前页面同源，且落在 PWA scope 内。
 * **不用于导航**，避免再把绝对 URL 交给 location.*。
 */
export function isSameOriginInScope(relative, base = location.href, scope = './') {
  const target = new URL(relative, base);
  const current = new URL(base);
  const scopeUrl = new URL(scope, current);
  return target.origin === current.origin
    && target.pathname.startsWith(scopeUrl.pathname);
}
