/* ------------------------------------------------------------------ *
 * 全屏。
 *
 * 分三种情况，绝不假装：
 *   1. 支持 Fullscreen API（桌面 Chrome/Edge/Firefox、Android Chrome、
 *      iPadOS 上的部分浏览器）→ 真的 requestFullscreen。
 *   2. iPhone Safari **不支持**普通网页元素全屏（document.fullscreenEnabled
 *      为 false）。这时不写任何「伪全屏」样式，而是给一条能真正解决问题的路：
 *      分享 → 添加到主屏幕，从桌面图标打开就是没有地址栏的独立窗口。
 *   3. 已经以独立 Web App 方式运行（display-mode: standalone）→ 本来就是全屏，
 *      入口自动收起。
 * ------------------------------------------------------------------ */

import { isIOS } from '../core/device.js';

import { K_FS_HINT } from '../garage/save.js';

const KEY_SEEN = K_FS_HINT;

/** 是否已经从主屏幕 / 独立窗口打开（此时浏览器工具栏不存在）。 */
export function isStandalone() {
  try {
    if (window.navigator.standalone === true) return true;      // iOS Safari
    if (matchMedia('(display-mode: standalone)').matches) return true;
    if (matchMedia('(display-mode: fullscreen)').matches) return true;
    if (matchMedia('(display-mode: minimal-ui)').matches) return true;
  } catch { /* 老浏览器不支持 matchMedia(display-mode) */ }
  return false;
}

/** 普通网页 Fullscreen API 是否可用（iPhone Safari 恒为 false）。 */
export function fsSupported() {
  const d = document;
  return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
}

export function inFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

let helpEl = null;
let buttons = [];
let onChange = null;

function buildHelp() {
  if (helpEl) return helpEl;
  const div = document.createElement('div');
  div.id = 'fsHelp';
  div.className = 'hidden';
  div.setAttribute('role', 'dialog');
  div.setAttribute('aria-modal', 'true');
  div.setAttribute('aria-label', '全屏玩法');
  div.innerHTML = `
    <div class="fshCard">
      <h3 id="fshTitle">全屏玩更爽</h3>
      <p class="fshLead" id="fshLead"></p>
      <ol class="fshSteps" id="fshSteps"></ol>
      <p class="fshNote" id="fshNote"></p>
      <button id="fshClose" type="button">好啦，知道了</button>
    </div>`;
  (document.getElementById('ui') || document.body).appendChild(div);
  div.addEventListener('click', (e) => {
    if (e.target === div || e.target.id === 'fshClose') closeHelp();
  });
  helpEl = div;
  return div;
}

const STEPS_IOS = [
  '点 Safari 底部中间的「分享」按钮 <b>⤴</b>',
  '在列表里往下找，选「<b>添加到主屏幕</b>」',
  '回到桌面，点「<b>小小赛车</b>」图标打开 —— 没有地址栏，就是全屏',
];

const STEPS_OTHER = [
  '点浏览器右上角的菜单按钮 <b>⋮</b>',
  '选「<b>添加到主屏幕</b>」或「安装应用」',
  '从桌面图标打开，就是全屏',
];

/**
 * 显示全屏 / 主屏幕指引。
 * @param {'ios'|'other'} kind
 * @param {string} [lead] 覆盖第一句话（比如「全屏没打开成功」时用）
 */
export function showFullscreenHelp(kind = isIOS ? 'ios' : 'other', lead) {
  const box = buildHelp();
  const steps = kind === 'ios' ? STEPS_IOS : STEPS_OTHER;
  box.querySelector('#fshTitle').textContent = kind === 'ios' ? 'iPhone 上这样全屏' : '这样全屏玩';
  box.querySelector('#fshLead').innerHTML = lead || (kind === 'ios'
    ? 'iPhone 的 Safari 不让网页自己全屏。<b>别担心，加一个桌面图标就行</b>，以后每次点开都是全屏。'
    : '这个浏览器不支持网页全屏。把它加到主屏幕，从图标打开就是全屏。');
  box.querySelector('#fshSteps').innerHTML = steps.map((t) => `<li>${t}</li>`).join('');
  box.querySelector('#fshNote').textContent = isStandalone()
    ? '你现在已经在全屏模式里了。'
    : '加好之后，游戏会记住金币和赛车，和现在完全一样。';
  box.classList.remove('hidden');
  try { localStorage.setItem(KEY_SEEN, '1'); } catch { /* 无痕模式忽略 */ }
  return box;
}

export function closeHelp() {
  helpEl?.classList.add('hidden');
}

function sync() {
  const fs = inFullscreen();
  /* 注意：进入元素全屏后 `(display-mode: fullscreen)` 也会变成 true，
   * 所以"已经是独立窗口"必须排除掉"正在元素全屏"的情况，
   * 否则按钮会在刚进全屏的瞬间把自己藏起来，再也退不出去。 */
  const sa = isStandalone() && !fs;
  for (const b of buttons) {
    if (!b) continue;
    b.classList.toggle('hidden', sa);
    const label = b.querySelector('.gfsLabel, .fsLabel');
    if (label) label.textContent = fs ? '退出全屏' : '全屏';
    b.setAttribute('aria-label', fs ? '退出全屏' : '全屏');
    b.dataset.fs = fs ? 'on' : 'off';
  }
  onChange?.();
}

async function requestFs(el) {
  const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
  if (!fn) throw new Error('no-request');
  await fn.call(el, { navigationUI: 'hide' });
  // 横屏锁定只是加分项：iOS 不支持、桌面会直接拒绝，失败不影响游戏
  try { await screen.orientation?.lock?.('landscape'); } catch { /* 忽略 */ }
}

async function exitFs() {
  const fn = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
  if (fn) await fn.call(document);
}

/**
 * 点击「全屏」按钮时要做什么。返回描述结果的字符串，方便测试断言。
 * @returns {Promise<'entered'|'exited'|'help'|'standalone'>}
 */
export async function toggleFullscreen() {
  /* 先判断"正在全屏" —— 元素全屏时 display-mode 也是 fullscreen，
   * 若先判断 standalone 就会把退出请求当成"已经是独立窗口"而吞掉。 */
  if (inFullscreen()) {
    try { await exitFs(); } catch { /* 忽略 */ }
    sync();
    return 'exited';
  }
  if (isStandalone()) {
    // 本来就是独立窗口，没有"退出"这回事，也不该骗人
    return 'standalone';
  }
  if (!fsSupported()) {
    showFullscreenHelp(isIOS ? 'ios' : 'other');
    return 'help';
  }
  try {
    await requestFs(document.documentElement);
    sync();
    return 'entered';
  } catch {
    // 有 API 但被拒绝（比如 iframe 没有 allowfullscreen）—— 给指引，不假装成功
    showFullscreenHelp(isIOS ? 'ios' : 'other', '这台设备没能自动全屏，可以试试下面的办法：');
    return 'help';
  }
}

/**
 * 初始化：接管传入的按钮点击，并在全屏状态变化时同步标签。
 * @param {{buttons?: HTMLElement[], onChange?: () => void}} opts
 */
export function initFullscreen({ buttons: btns = [], onChange: cb } = {}) {
  buttons = btns.filter(Boolean);
  onChange = cb || null;
  for (const b of buttons) {
    b.addEventListener('click', () => { toggleFullscreen(); });
  }
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
  sync();
  return { sync, showFullscreenHelp, closeHelp };
}
