import * as THREE from 'three';

/* ------------------------------------------------------------------ *
 * AI racers.
 *
 * Each bot drives a racing line derived from the track's own curvature
 * table (turn in wide, clip the apex, drift out), brakes for what it can
 * see ahead, drifts to bank mini-turbos, dodges hazards and traffic, and
 * is gently rubber-banded so the pack stays entertaining.
 * ------------------------------------------------------------------ */

const SKILLS = [
  { name: 'Novato', pace: 0.90, look: 34, react: 0.34, driftSkill: 0.4, itemDelay: [1.6, 3.4] },
  { name: 'Corredor', pace: 0.95, look: 40, react: 0.24, driftSkill: 0.65, itemDelay: [1.0, 2.4] },
  { name: 'Veterano', pace: 0.99, look: 46, react: 0.16, driftSkill: 0.85, itemDelay: [0.6, 1.6] },
  { name: 'Maestro', pace: 1.02, look: 52, react: 0.1, driftSkill: 1.0, itemDelay: [0.3, 1.0] },
];

export class AIDriver {
  constructor(kart, track, difficulty = 2) {
    this.kart = kart;
    this.track = track;
    this.skill = SKILLS[THREE.MathUtils.clamp(difficulty, 0, SKILLS.length - 1)];
    this.ctrl = { throttle: 1, brake: 0, steer: 0, drift: false, driftPressed: false, item: false };
    this.targetLat = 0;
    this.smoothSteer = 0;
    this.itemTimer = this._nextItemDelay();
    this.recoverTimer = 0;
    this.personality = Math.random();
    this.wobblePhase = Math.random() * 6.28;
    this.rubber = 1;
  }

  _nextItemDelay() {
    const [a, b] = this.skill.itemDelay;
    return a + Math.random() * (b - a);
  }

  /**
   * Compute the ideal lateral offset: swing wide before a corner, tighten
   * to the apex, then drift back out on exit.
   */
  _racingLine(i) {
    const t = this.track;
    const look = this.skill.look;
    // average curvature over the next stretch of road
    let ahead = 0;
    for (let k = 6; k < look; k += 4) ahead += t.curvature[(i + k) % t.n];
    ahead /= Math.max(1, Math.floor((look - 6) / 4));
    let behind = 0;
    for (let k = 4; k < 24; k += 4) behind += t.curvature[(i - k + t.n) % t.n];
    behind /= 5;

    const w = t.width[i];
    /* 桥面只有 16 m 宽。7 个 AI 都按 0.72×半宽（5.8 m）散开，进桥口一定
     * 互相顶下河，所以 track 会按段给出一个更小的系数（桥段 0.5）。
     * 第一章没有这个数组/全是默认 0.72，行为不变。 */
    const usable = w * (t.aiWidth ? t.aiWidth[i] : 0.72);
    // Sign convention here is empirical: `ahead` is curvature averaged over the
    // look window, and apexing on its positive side measures out ~9 s a lap
    // quicker with a third of the off-track time. Do not "correct" it from the
    // instantaneous curvature sign — the window average is what matters.
    const apex = THREE.MathUtils.clamp(ahead * 260, -1, 1);
    const exit = THREE.MathUtils.clamp(behind * 160, -1, 1);
    return THREE.MathUtils.clamp((apex * 0.85 + exit * 0.35), -1, 1) * usable;
  }

  /** Speed the line can carry through the corners just ahead. */
  _cornerSpeed(i) {
    const t = this.track;
    let worst = 0;
    for (let k = 4; k < this.skill.look * 1.4; k += 4) {
      const c = Math.abs(t.curvature[(i + k) % t.n]);
      // discount curvature that's still far away
      const w = 1 - (k / (this.skill.look * 1.6)) * 0.55;
      worst = Math.max(worst, c * w);
    }
    // empirical mapping from curvature to a comfortable entry speed
    return THREE.MathUtils.clamp(34 - worst * 1350, 12, 40);
  }

  update(dt, world) {
    const k = this.kart;
    const t = this.track;
    const i = k.trackIndex;
    const ctrl = this.ctrl;
    ctrl.driftPressed = false;

    /* ------------------------- rubber banding ------------------------ */
    const player = world.player;
    if (player && !player.finished) {
      const diff = k.progressTotal - player.progressTotal;
      // trailing bots get a nudge, leaders are reined in slightly
      this.rubber = THREE.MathUtils.clamp(1 - diff * 0.11, 0.9, 1.14);
    }

    /* --------------------------- racing line ------------------------- */
    let want = this._racingLine(i);

    // avoid hazards and slower traffic sitting on the line
    for (const h of world.hazards) {
      const loc = t.locate(h.position, i);
      const gap = ((loc.index - i + t.n) % t.n);
      if (gap < 46 && Math.abs(loc.lat - want) < 3.2) {
        want += Math.sign(want - loc.lat || 1) * 4.2;
      }
    }
    for (const other of world.karts) {
      if (other === k) continue;
      const d = other.position.clone().sub(k.position);
      const fwd = k.forward;
      const along = d.dot(fwd);
      if (along > 0.5 && along < 9) {
        const side = d.dot(k.right);
        if (Math.abs(side) < 2.0) want += (side >= 0 ? -1 : 1) * 4.0;
      }
    }
    // a little personality so the pack doesn't drive in a single file
    want += Math.sin(world.time * 0.5 + this.wobblePhase) * 1.1 * this.personality;
    // Respect the baked barrier rather than a flat fraction of the width, so
    // bots don't aim at a monument standing inside a wide plaza.
    const cl = t.clearance;
    const capL = cl ? cl.limitAt(i, 1) - 1.4 : t.width[i] * 0.86;
    const capR = cl ? cl.limitAt(i, -1) - 1.4 : t.width[i] * 0.86;
    want = THREE.MathUtils.clamp(
      want,
      -Math.max(1, Math.min(capR, t.width[i] * 0.86)),
      Math.max(1, Math.min(capL, t.width[i] * 0.86))
    );
    this.targetLat = THREE.MathUtils.damp(this.targetLat, want, 3.2, dt);

    /* ---------------------------- steering --------------------------- */
    const leadDist = 7 + Math.abs(k.speed) * 0.42;
    const leadSamples = Math.round(leadDist / (t.length / t.n));
    const aim = t.pointAt(i + leadSamples, this.targetLat, new THREE.Vector3());
    const to = aim.sub(k.position);
    const wantYaw = Math.atan2(to.x, to.z);
    let dYaw = wantYaw - k.yaw;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;

    let steer = THREE.MathUtils.clamp(dYaw * 2.4, -1, 1);
    // reaction lag makes the bots feel human rather than robotic
    this.smoothSteer = THREE.MathUtils.damp(this.smoothSteer, steer, 1 / Math.max(0.03, this.skill.react), dt);
    ctrl.steer = this.smoothSteer;

    /* -------------------------- speed control ------------------------ */
    const target = this._cornerSpeed(i) * this.skill.pace * this.rubber;
    const over = k.speed - target;
    ctrl.throttle = over > 1.5 ? 0 : 1;
    ctrl.brake = over > 5.5 ? 1 : 0;

    // off track or facing the wrong way: recover
    const loc = t.locate(k.position, i);
    if (Math.abs(loc.lat) > t.width[i] * 1.3 || loc.fwd < -0.2) this.recoverTimer = 0.7;
    if (this.recoverTimer > 0) {
      this.recoverTimer -= dt;
      ctrl.throttle = 1;
      ctrl.brake = 0;
    }
    if (Math.abs(k.speed) < 1.5 && k.spinTime <= 0) ctrl.throttle = 1;

    /* ----------------------------- drifting -------------------------- */
    const curv = t.curvature[i];
    const wantDrift =
      Math.abs(curv) > 0.0022 &&
      Math.abs(k.speed) > 15 &&
      Math.sign(curv) === Math.sign(ctrl.steer || curv) &&
      Math.random() < 0.5 + this.skill.driftSkill * 0.5;

    if (wantDrift && !k.drifting && this.skill.driftSkill > 0.3) {
      if (!this._driftHeld) ctrl.driftPressed = true;
      ctrl.drift = true;
      this._driftHeld = true;
      // bias the steering so the drift latches
      ctrl.steer = THREE.MathUtils.clamp(ctrl.steer + Math.sign(curv) * 0.4, -1, 1);
    } else if (k.drifting) {
      // hold until the corner unwinds or a good tier is banked
      const done = Math.abs(t.curvature[(i + 20) % t.n]) < 0.0012 ||
        k.driftTier >= (this.skill.driftSkill > 0.8 ? 3 : 2);
      ctrl.drift = !done;
      if (done) this._driftHeld = false;
      ctrl.steer = THREE.MathUtils.clamp(ctrl.steer + k.driftDir * 0.25, -1, 1);
    } else {
      ctrl.drift = false;
      this._driftHeld = false;
    }

    /* ------------------------------ items ---------------------------- */
    if (k.item) {
      this.itemTimer -= dt;
      if (this.itemTimer <= 0) {
        let dir = 1;
        // defensive items go backwards when someone is close behind
        if (k.item === 'piragua' || k.item === 'cocoGreen') {
          for (const other of world.karts) {
            if (other === k) continue;
            const d = other.position.clone().sub(k.position);
            if (d.dot(k.forward) < 0 && d.length() < 16) { dir = -1; break; }
          }
        }
        world.items.use(k, dir);
        this.itemTimer = this._nextItemDelay();
      }
    } else {
      this.itemTimer = this._nextItemDelay();
    }

    // Everything above works in the yaw-math convention (+steer raises yaw).
    // ctrl.steer is published in the driver-facing convention (+1 = turn
    // right on screen), so flip it on the way out.
    ctrl.steer = -ctrl.steer;
    return ctrl;
  }
}

export { SKILLS };
