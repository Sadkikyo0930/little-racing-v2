/* ------------------------------------------------------------------ *
 * 真实可用视口（visualViewport）。
 *
 * 为什么需要它：
 *   iPhone Safari 横屏时，地址栏 + 底部工具栏会吃掉 60～90px。`100vh`
 *   算的是「工具栏收起时」的高度，`100dvh` 虽然会跟着变，但地址栏正在
 *   收放的过程中它更新得比 visualViewport 晚一帧，期间底部按钮会被压在
 *   工具栏下面（车库的「使用这辆车」正好在最下面）。
 *
 * 做法：
 *   1. 把 visualViewport 的宽高写进 CSS 变量 --vvw / --vvh；
 *   2. 布局用 var(--vvh, 100dvh) 而不是裸的 100dvh；
 *   3. 渲染尺寸也走这里（engine.resize），保证 canvas 与 UI 一样高，
 *      不会出现「画布比可见区高、下半截被裁掉」。
 *
 * 键盘例外：车库存档面板里有一个 textarea，iOS 弹键盘会让
 * visualViewport 矮一大截。这时保持布局高度不变（用 innerHeight），
 * 否则整个游戏会瞬间被压扁。
 * ------------------------------------------------------------------ */

let lastW = 0;
let lastH = 0;
const listeners = new Set();

const isTextEntry = (el) => !!el && (
  el.tagName === 'TEXTAREA'
  || (el.tagName === 'INPUT' && !['button', 'checkbox', 'radio', 'range', 'submit'].includes(el.type))
);

/**
 * 当前应该用的像素尺寸。
 * @returns {{w:number, h:number, keyboard:boolean, vv:boolean}}
 */
export function viewSize() {
  const vv = window.visualViewport;
  const layoutH = Math.max(1, Math.round(window.innerHeight));
  const layoutW = Math.max(1, Math.round(window.innerWidth));
  if (!vv) return { w: layoutW, h: layoutH, keyboard: false, vv: false };

  const vw = Math.max(1, Math.round(vv.width));
  const vh = Math.max(1, Math.round(vv.height));

  // 键盘判定：可视高度突然掉到布局高度的 62% 以下，且焦点在输入框里。
  // 只按比例判断会把「浏览器工具栏占太多」的极端情况误伤，所以两个条件都要。
  const keyboard = vh < layoutH * 0.62 && isTextEntry(document.activeElement);
  if (keyboard) return { w: layoutW, h: layoutH, keyboard: true, vv: true };

  // 页面被双指放大时 vv.width 会小于布局宽度；这时仍以布局尺寸为准，
  // 避免放大状态下整个界面被重新排版。
  if (vv.scale > 1.02) return { w: layoutW, h: layoutH, keyboard: false, vv: true };

  return { w: vw, h: Math.min(vh, layoutH), keyboard: false, vv: true };
}

/** 把尺寸写进 CSS 变量，并在真的变化时通知订阅者。 */
export function applyViewport() {
  const { w, h, keyboard } = viewSize();
  const root = document.documentElement;
  root.style.setProperty('--vvw', `${w}px`);
  root.style.setProperty('--vvh', `${h}px`);
  root.classList.toggle('vv-keyboard', keyboard);
  // 高度分档：紧凑（有工具栏）/ 很紧凑（小屏 + 工具栏）
  root.classList.toggle('vv-short', h < 400);
  root.classList.toggle('vv-tiny', h < 340);

  if (w === lastW && h === lastH) return { w, h, changed: false };
  lastW = w;
  lastH = h;
  for (const cb of listeners) {
    try { cb({ w, h }); } catch { /* 一个订阅者出错不该拖垮其他 */ }
  }
  return { w, h, changed: true };
}

/** 订阅尺寸变化（只在实际像素变化时触发）。 */
export function onViewportResize(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * 开始监听。iOS 上 visualViewport 的 resize 在地址栏动画期间会连续触发，
 * 用 rAF 合并，避免每帧都重排 3D 场景。
 */
export function initViewport() {
  applyViewport();
  const vv = window.visualViewport;
  let raf = 0;
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      applyViewport();
    });
  };
  vv?.addEventListener('resize', schedule);
  vv?.addEventListener('scroll', schedule);
  addEventListener('resize', schedule);
  addEventListener('orientationchange', () => {
    // 旋转动画结束后再量一次：iOS 在 rotate 过程中报的尺寸是旧值
    schedule();
    setTimeout(schedule, 120);
    setTimeout(schedule, 360);
  });
  // 全屏 / 退出全屏 / 从主屏幕回到前台，都重新量一次
  document.addEventListener('fullscreenchange', schedule);
  document.addEventListener('webkitfullscreenchange', schedule);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
  return schedule;
}
