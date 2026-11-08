/* ------------------------------------------------------------------ *
 * Little Racing V2 — central game-mode configuration.
 *
 * Every driving "feel" ratio lives here so it can be tuned in ONE place.
 * `kids` is the default and is tuned so a 6–8 year old can complete a lap
 * without fighting the car. `normal` preserves the original Old San Juan
 * Kart handling (every ratio is 1.0).
 *
 * Ratios are multipliers against the original TUNING values in kart.js,
 * except where noted. A value < 1 makes that behaviour gentler / slower.
 * ------------------------------------------------------------------ */

export const GAME_MODES = {
  kids: {
    id: 'kids',
    label: '轻松模式',
    subtitle: '速度更慢，更容易转弯',
    default: true,

    // ----- top speed -----
    // Cap cruising speed at 60% of the original (~44 mph). A boost can still
    // briefly exceed this, which is fine and fun.
    speed: 0.60,

    // ----- longitudinal feel -----
    accel: 0.72,        // softer launch off the line
    brake: 0.90,        // a touch gentler braking
    rollResist: 0.50,   // coast down *more gently* when the gas is released
    coastDrag: 0.55,    // gentler aero drag at speed

    // ----- steering / handling -----
    yawRate: 0.82,            // turn less sharply → far less likely to spin out
    steerSmoothLambda: 9,     // how quickly steering eases (lower = softer)
    autoCenter: 0.6,          // gentle "straighten out" assist when not steering
    gripLateral: 1.12,        // a bit more cornering grip → less sliding
    // Extra drag applied while steering hard at speed: the kart "trails the
    // brakes" into a corner on its own so kids don't overshoot.
    turnAutoBrake: 0.18,

    // ----- boosts / drift -----
    boostScale: 0.6,          // milder mini-turbo / item boost top-speed add

    // ----- collision protection -----
    wallBounce: 0.15,         // tiny rebound instead of a hard bounce
    wallScrub: 0.35,          // gentler speed loss on a guardrail graze
    stuckThreshold: 1.0,      // auto-recover sooner when wedged (original 1.4)
    respawnSpeed: 10,         // a little quicker off the line after a reset
  },

  normal: {
    id: 'normal',
    label: '普通模式',
    subtitle: '速度更快，更有挑战',
    default: false,
    // Original Old San Juan Kart parameters — every ratio is 1.0.
    speed: 1, accel: 1, brake: 1, rollResist: 1, coastDrag: 1,
    yawRate: 1, steerSmoothLambda: 30, autoCenter: 0, gripLateral: 1,
    turnAutoBrake: 0, boostScale: 1, wallBounce: 1, wallScrub: 1,
    stuckThreshold: 1.4, respawnSpeed: 8,
  },
};

export const DEFAULT_MODE = GAME_MODES.kids.default ? 'kids' : 'normal';

export function getMode(id) {
  return GAME_MODES[id] || GAME_MODES[DEFAULT_MODE];
}
