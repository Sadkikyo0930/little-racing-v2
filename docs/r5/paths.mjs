/**
 * r5/paths.mjs — 页面地址解析（唯一来源）· v1.8.0-rc1
 *
 * 正式仓库 little-racing-v2 的 GitHub Pages 发布的是 **docs/ 目录**：
 *   https://sadkikyo0930.github.io/little-racing-v2/          → docs/index.html（游戏）
 *   https://sadkikyo0930.github.io/little-racing-v2/gate.html → docs/gate.html（通行证）
 * 因此 gate.html、index.html、r5/ 永远同级，一律用「相对当前页面」解析。
 * 不依赖仓库名、不依赖本地目录结构，也不改任何资源绝对路径。
 */

/** 游戏页：与当前页面同级的 index.html */
export function gameUrl() {
  return new URL('./index.html', location.href).href;
}

/** 通行证页：与当前页面同级的 gate.html */
export function entryUrl() {
  return new URL('./gate.html', location.href).href;
}
