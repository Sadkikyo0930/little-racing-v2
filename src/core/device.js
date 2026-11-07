/* ------------------------------------------------------------------ *
 * Device detection and the matching quality profile.
 *
 * Everything that has to agree about "how much machine do we have"
 * (renderer, shadows, post FX, physics rate) reads from here, so there
 * is exactly one place to tune when a new class of device shows up.
 * ------------------------------------------------------------------ */

const ua = navigator.userAgent || '';
const touchPoints = navigator.maxTouchPoints || 0;
const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

// iPadOS reports itself as a Mac, so the touch-point count is the giveaway.
export const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
export const isAndroid = /Android/.test(ua);
export const isTouch = coarse || touchPoints > 0;

const shortSide = Math.min(screen.width, screen.height);
export const isMobile = isIOS || isAndroid || (isTouch && shortSide < 900);

/* Profiles are a *starting point*. Engine._autoQuality still scales the
 * pixel ratio at runtime, but pass composition and shadow map size are
 * baked at construction and can't be changed cheaply, so they live here. */
const PROFILES = {
  high: {
    maxPixelRatio: 2, minPixelRatio: 0.75,
    msaa: 0, smaa: true, bloomScale: 1, gradeTaps: 6,
    shadowMap: 2048, fixedStep: 1 / 120, far: 4000, oceanSegments: 320, trafficScale: 1.0,
    simpleWheels: false, opponentShadows: true,
  },
  mid: {
    maxPixelRatio: 1.5, minPixelRatio: 0.7,
    // Apple/Adreno tile GPUs resolve MSAA inside tile memory, which is far
    // cheaper than SMAA's three extra full-screen passes.
    msaa: 4, smaa: false, bloomScale: 0.55, gradeTaps: 3,
    shadowMap: 1024, fixedStep: 1 / 60, far: 2600, oceanSegments: 112, trafficScale: 0.75,
    simpleWheels: true, opponentShadows: true,
  },
  low: {
    maxPixelRatio: 1.25, minPixelRatio: 0.6,
    msaa: 0, smaa: false, bloomScale: 0.4, gradeTaps: 1,
    shadowMap: 512, fixedStep: 1 / 60, far: 2000, oceanSegments: 80, trafficScale: 0.5,
    // Opponents keep their baked contact-shadow blob, so dropping them from the
    // shadow pass costs far less than it saves on a phone.
    simpleWheels: true, opponentShadows: false,
  },
};

function pickTier() {
  const cores = navigator.hardwareConcurrency || (isMobile ? 4 : 8);
  if (!isMobile) return cores <= 4 ? 'mid' : 'high';
  // Anything modern enough to run WebGL2 well has >= 6 cores; older/cheaper
  // Android hardware is the main reason the 'low' tier exists.
  return cores >= 6 || isIOS ? 'mid' : 'low';
}

// ?quality=high|mid|low forces a tier, which makes A/B testing possible on a
// real phone without rebuilding.
const forced = new URLSearchParams(location.search).get('quality');
export const tier = PROFILES[forced] ? forced : pickTier();

export const quality = { tier, ...PROFILES[tier] };

if (isTouch) document.documentElement.classList.add('touch');
if (isMobile) document.documentElement.classList.add('mobile');

// iOS Safari ignores user-scalable=no and maximum-scale, so the viewport meta
// buys nothing there and CSS touch-action only covers touches the page is
// actually the target of — a finger landing on the letterboxed safe-area bars
// beside the canvas is handled by the browser itself and zooms the page.
// These guards are what actually hold the zoom shut.
if (isTouch) {
  // Only WebKit fires these; preventing them is the one reliable pinch block.
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
    addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  }

  // The controls are two-thumb, so a second finger is normal *on them*. Only
  // multi-touch that starts off the controls is a pinch attempt. touchmove is
  // guarded too: a pinch can start with one finger already on a button, which
  // would slip past the touchstart check.
  const onControl = (t) => !!(t && t.closest && t.closest('#touch, button, a, #select'));
  const blockPinch = (e) => {
    if (e.touches.length > 1 && !onControl(e.target)) e.preventDefault();
  };
  addEventListener('touchstart', blockPinch, { passive: false, capture: true });
  addEventListener('touchmove', blockPinch, { passive: false, capture: true });

  // Double-tap zoom, for browsers that won't honour touch-action on the bars.
  let lastTap = 0, lastX = 0, lastY = 0;
  addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    if (!t || onControl(e.target)) return;
    const now = performance.now();
    if (now - lastTap < 320 && Math.hypot(t.clientX - lastX, t.clientY - lastY) < 40) {
      e.preventDefault();
      lastTap = 0;
    } else {
      lastTap = now;
      lastX = t.clientX;
      lastY = t.clientY;
    }
  }, { passive: false, capture: true });

  // Last resort. If something still zooms, the page is a trap: user-scalable=no
  // means there is no gesture left that can zoom back out. Re-writing the
  // viewport meta forces the engine to re-evaluate it and snaps the scale home.
  const vv = window.visualViewport;
  if (vv) {
    let fixing = 0;
    vv.addEventListener('resize', () => {
      if (vv.scale <= 1.02 || fixing) return;
      fixing = setTimeout(() => {
        fixing = 0;
        const meta = document.querySelector('meta[name="viewport"]');
        if (!meta) return;
        const content = meta.getAttribute('content');
        meta.setAttribute('content', content + ', minimum-scale=1');
        setTimeout(() => meta.setAttribute('content', content), 50);
      }, 120);
    });
  }
}
