import * as THREE from 'three';
import { buildKart } from './model.js';
import { quality } from '../core/device.js';
import { getMode } from '../config.js';

/* ------------------------------------------------------------------ *
 * Arcade kart physics.
 *
 * Deliberately *not* a simulator: it is a hand-tuned arcade model with
 * a separated visual yaw (the kart "slides" pointing into the corner),
 * charge-based mini-turbos, a coyote-time hop, and hard speed caps so
 * the racing stays readable at 125 mph.
 * ------------------------------------------------------------------ */

const TAU = Math.PI * 2;

export const TUNING = {
  maxSpeed: 33.0,          // m/s ≈ 74 mph base
  reverseSpeed: 9.0,
  accel: 24.0,
  brakeForce: 44.0,
  coastDrag: 0.42,
  rollResist: 1.8,
  maxYawRate: 2.05,        // rad/s at optimal speed
  driftYawBonus: 1.5,
  gripLateral: 12.0,
  driftGrip: 2.4,
  gravity: 26.0,
  hopImpulse: 5.4,
  offroadFactor: 0.52,
  offroadDrag: 6.5,
  miniTurboTiers: [1.15, 2.3, 3.6],   // seconds of charge
  miniTurboPower: [7.5, 11.0, 15.0],  // m/s of extra top speed
  miniTurboTime: [0.85, 1.35, 1.9],
  boostAccel: 60,
  wallBounce: 0.42,
  // Steering held against the slide, and for how long, before the drift breaks.
  counterSteer: 0.55,
  counterSteerTime: 0.16,
};

export class Kart {
  constructor(scene, character, opts = {}) {
    this.character = character;
    this.isPlayer = !!opts.isPlayer;
    this.name = opts.name || character.name;
    this.index = opts.index ?? 0;

    /* 视觉模型有三种来源：默认的程序化卡丁车、海龟冲浪车（外部 GLB，
     * 由 kart/turtleKart.js 造好后用 opts.model 传进来）、以及将来更多车型。
     * 三者字段同构，下面的 syncVisual 只认字段不认来源。 */
    const model = opts.model || buildKart(character, this.index + 1, { driver: opts.driver });
    this.model = model;
    this.object = model.group;
    this.scene = scene;
    scene.add(this.object);

    // On the low tier the opponents' shadow-map contribution isn't worth a
    // second pass over ~28 meshes each; their contact-shadow blob still grounds
    // them. The player always casts, since that's the kart you actually watch.
    if (!this.isPlayer && !quality.opponentShadows) {
      this.object.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    }

    // --- state ---
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.visualYaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.groundPitch = 0;
    this.groundRoll = 0;
    this.vy = 0;
    this.grounded = true;
    this.airTime = 0;

    this.speed = 0;             // signed forward speed
    this.lateral = 0;           // signed sideways speed
    this.drifting = false;
    this.driftDir = 0;
    this.driftCharge = 0;
    this.driftTier = 0;
    this._counterT = 0;
    this._hopSteerLatch = false;
    this._driftWanted = false;
    this.hopTimer = 0;
    this.boostTime = 0;
    this.boostPower = 0;
    this.offroad = false;
    /* 路面抓地：1 = 柏油/石板（第一章原样）。第二章按 kind 给值，沙地 0.86。
     * surfaceGrip 只乘在**纵向最高速**上；横向抓地另有一个很轻的系数，
     * 因为沙地上如果连转向都削弱，车会转不动弯，比"滑一点"更难开。 */
    this.surfaceGrip = 1;
    this.surfaceLateral = 1;
    this.offroadFactor = opts.course?.offroadFactor ?? TUNING.offroadFactor;
    this.spinTime = 0;
    this.squashTime = 0;
    this.stunTime = 0;
    this.invulnTime = 0;
    this.shrinkTime = 0;
    this.slipTime = 0;
    this.starTime = 0;
    this.chargedStart = 0;
    this.progressTotal = 0;
    this.respawnTimer = 0;
    this.halfway = false;
    this._lastGoodLat = 0;

    // race bookkeeping
    this.lap = 0;
    this.checkpoint = 0;
    this.trackIndex = 0;
    this.progress = 0;
    this.rank = 1;
    this.finished = false;
    this.finishTime = 0;
    this.lapTimes = [];
    this.item = null;
    this.itemRolling = 0;
    this.coins = 0;

    this.wheelSpin = 0;
    this.steerVisual = 0;
    this.lean = 0;                 // 摩托车的车身内倾（卡丁车为 0，用 roll）
    this.suspension = [0, 0, 0, 0];

    this.stats = character.stats;

    // ---- Little Racing V2: game-mode handling profile ----
    // Kids (default) caps top speed and softens every input; Normal keeps the
    // original Old San Juan Kart feel. All ratios live in src/config.js.
    const profile = getMode(opts.mode);
    this.profile = profile;
    this.speedCap = TUNING.maxSpeed * profile.speed;
    this.respawnSpeed = profile.respawnSpeed;
    this._steerSmooth = 0;

    this.radius = 1.15;
    this._tmp = new THREE.Vector3();
    this._surfaceNormal = new THREE.Vector3(0, 1, 0);
    this._visualNormal = new THREE.Vector3(0, 1, 0);
  }

  get forward() {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }
  get right() {
    return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  get cruiseSpeed() {
    return this.speedCap * this.stats.speed;
  }

  get topSpeed() {
    let v = this.speedCap * this.stats.speed;
    if (this.offroad) v *= this.offroadFactor;
    v *= this.surfaceGrip;
    if (this.shrinkTime > 0) v *= 0.66;
    if (this.boostTime > 0) v += this.boostPower;
    return v;
  }

  get mph() {
    return Math.abs(this.speed) * 2.2369363;
  }

  placeAt(position, forward) {
    this.position.copy(position);
    this.yaw = Math.atan2(forward.x, forward.z);
    this.visualYaw = this.yaw;
    this.object.position.copy(position);
    this.object.rotation.y = this.yaw;
  }

  dispose() {
    this.scene?.remove(this.object);
    this.object.traverse((o) => {
      /* 新版主角 A 的几何/材质是跨局共享的（只加载一次、每局 clone 一份外壳），
       * 在这里释放会让下一局重新上传贴图，所以标记过的资源一律跳过。 */
      if (o.userData?.sharedAsset) return;
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
  }

  applyBoost(power, time) {
    this.boostPower = Math.max(this.boostPower, power * this.profile.boostScale);
    this.boostTime = Math.max(this.boostTime, time);
    this.speed = Math.max(this.speed, this.topSpeed * 0.72);
  }

  spinOut(duration = 1.5) {
    if (this.invulnTime > 0 || this.starTime > 0) return false;
    this.spinTime = duration;
    this.drifting = false;
    this.driftCharge = 0;
    this._counterT = 0;
    this.boostTime = 0;
    this.speed *= 0.25;
    return true;
  }

  squash(duration = 2.2) {
    if (this.invulnTime > 0) return false;
    this.squashTime = duration;
    this.shrinkTime = duration;
    this.speed *= 0.3;
    return true;
  }

  slip(duration = 1.1) {
    if (this.invulnTime > 0) return false;
    this.slipTime = duration;
    this.speed *= 0.6;
    return true;
  }

  /* ------------------------------ physics ----------------------------- */
  update(dt, ctrl, track) {
    const stunned = this.spinTime > 0 || this.squashTime > 0;

    /* 路面抓地过渡。
     *
     * 这里刻意用 0.3 s 的时间常数，而不是直接赋值：段边界上如果让速度
     * 从 0.97 一步跳到 0.86，车会在线上"顿一下"，看起来像碾了个坎。
     * 反过来，过渡太长（>0.6 s）又会让车在沙滩直道末尾还留着木桥的速度。
     * 3.4 的 lambda 约等于 0.3 s 到 95%。
     */
    {
      const kind = track.kind[this.trackIndex ?? 0] ?? 0;
      const g = track.gripAt ? track.gripAt(kind) : null;
      if (g != null) {
        this.surfaceGrip = THREE.MathUtils.damp(this.surfaceGrip, g, 3.4, dt);
        const lat = track.course?.surfaceLateral?.[kind] ?? 1;
        this.surfaceLateral = THREE.MathUtils.damp(this.surfaceLateral, lat, 3.4, dt);
      }
    }

    // timers
    this.spinTime = Math.max(0, this.spinTime - dt);
    this.squashTime = Math.max(0, this.squashTime - dt);
    this.shrinkTime = Math.max(0, this.shrinkTime - dt);
    this.invulnTime = Math.max(0, this.invulnTime - dt);
    this.slipTime = Math.max(0, this.slipTime - dt);
    this.starTime = Math.max(0, this.starTime - dt);
    this.boostTime = Math.max(0, this.boostTime - dt);
    if (this.boostTime === 0) this.boostPower = 0;

    const throttle = stunned ? 0 : ctrl.throttle;
    const brake = stunned ? 0 : ctrl.brake;
    // ctrl.steer is driver-facing: +1 means "turn right on screen". Because
    // forward is (sin yaw, 0, cos yaw), screen-right is -X, which is reached
    // by *decreasing* yaw — so flip into the internal yaw-math convention.
    let steer = stunned ? 0 : -ctrl.steer;
    if (this.slipTime > 0) steer += Math.sin(this.slipTime * 22) * 0.85;

    // Little Racing V2 — ease the driver's steering input. Kids mode softens
    // it so small thumb twitches don't snap the wheel; Normal is snappy.
    this._steerSmooth = THREE.MathUtils.damp(this._steerSmooth || steer, steer, this.profile.steerSmoothLambda, dt);
    steer = this._steerSmooth;

    /* ------------------------- longitudinal ------------------------- */
    const top = this.topSpeed;
    const accel = TUNING.accel * this.stats.accel * this.profile.accel * (this.boostTime > 0 ? 2.4 : 1);

    if (throttle > 0) {
      const t = THREE.MathUtils.clamp(1 - this.speed / top, 0, 1);
      // accel curve: strong off the line, tapering as you approach v-max
      this.speed += accel * throttle * (0.35 + 0.65 * Math.pow(t, 0.8)) * dt;
    }
    if (brake > 0) {
      if (this.speed > 0.4) this.speed -= TUNING.brakeForce * this.profile.brake * brake * dt;
      else this.speed -= TUNING.accel * 0.55 * brake * dt;
    }
    if (throttle === 0 && brake === 0) {
      this.speed -= Math.sign(this.speed) * TUNING.rollResist * this.profile.rollResist * dt;
      if (Math.abs(this.speed) < 0.3) this.speed = 0;
    }
    // aero drag — gentler coast-down in kids mode
    this.speed -= Math.sign(this.speed) * TUNING.coastDrag * this.profile.coastDrag * (this.speed * this.speed) / (top || 1) * dt;
    if (this.offroad) {
      this.speed -= Math.sign(this.speed) * TUNING.offroadDrag
        * (this.offroadFactor / TUNING.offroadFactor) * dt;
    }

    this.speed = THREE.MathUtils.clamp(this.speed, -TUNING.reverseSpeed, top);

    /* ----------------------------- drift ---------------------------- */
    const speedFrac = THREE.MathUtils.clamp(Math.abs(this.speed) / this.speedCap, 0, 1.4);

    // Little Racing V2 — kids mode gently trails the brakes into a hard turn
    // so a child doesn't overshoot the corner and spin out.
    if (this.profile.turnAutoBrake > 0 && Math.abs(steer) > 0.25 && speedFrac > 0.4) {
      this.speed -= this.profile.turnAutoBrake * Math.abs(steer) * speedFrac * 7 * dt;
    }

    if (this.hopTimer > 0) this.hopTimer -= dt;

    // Pressing drift is a request, not a one-shot: the press often lands while
    // you are still below the hop threshold — braking into a hairpin, or on a
    // touch screen where the blip is what asks for the drift. Remembering it
    // means the hop fires the moment it becomes legal instead of being lost.
    if (!stunned && ctrl.driftPressed) this._driftWanted = true;

    if (this._driftWanted && !this.drifting && !this._hopSteerLatch
        && this.grounded && Math.abs(this.speed) > 6) {
      // hop — the drift only latches if you're already turning
      this.vy = TUNING.hopImpulse;
      this.grounded = false;
      this.hopTimer = 0.24;
      this._hopSteerLatch = true;
      this._driftWanted = false;
    }
    if (this._hopSteerLatch && !this.drifting && ctrl.drift && Math.abs(steer) > 0.22) {
      this.drifting = true;
      this.driftDir = Math.sign(steer);
      this.driftCharge = 0;
      this.driftTier = 0;
      this._hopSteerLatch = false;
    }
    // Releasing the button (or being spun out) cancels a pending request, but
    // crawling below the release speed must not: that is exactly the hairpin
    // case the request exists to cover.
    if (!ctrl.drift || stunned) this._driftWanted = false;
    if (!ctrl.drift || Math.abs(this.speed) < 4 || stunned) {
      if (this.drifting) this._releaseDrift();
      this._hopSteerLatch = false;
    }

    if (this.drifting) {
      this.driftCharge += dt * (0.7 + 0.5 * speedFrac);
      let tier = 0;
      for (let i = 0; i < TUNING.miniTurboTiers.length; i++) {
        if (this.driftCharge >= TUNING.miniTurboTiers[i]) tier = i + 1;
      }
      this.driftTier = tier;

      // Counter-steering has to be able to break the slide. The drift's base
      // yaw (maxYawRate * 0.62) is larger than the steering modulation can
      // ever offset (driftYawBonus * 0.42), so holding the wheel hard against
      // the slide used to do nothing at all — the kart kept rotating one way
      // and the only way out was to drop below the release speed, i.e. crash.
      // Fighting the slide now ends it and still pays out the mini-turbo.
      if (this.driftDir && Math.sign(steer) === -this.driftDir
          && Math.abs(steer) > TUNING.counterSteer) {
        this._counterT += dt;
      } else {
        this._counterT = 0;
      }
      if (this._counterT > TUNING.counterSteerTime) this._releaseDrift();
    }

    /* ---------------------------- steering -------------------------- */
    // yaw authority peaks around 60% of v-max, falls off at both extremes
    const authority = THREE.MathUtils.clamp(
      Math.sin(THREE.MathUtils.clamp(speedFrac, 0, 1) * Math.PI * 0.72) * 1.25,
      0.05, 1.0
    );
    let yawRate;
    if (this.drifting) {
      // inside the drift, steering modulates a base rotation
      const base = TUNING.maxYawRate * 0.62 * this.driftDir;
      const mod = TUNING.driftYawBonus * 0.42 * steer;
      yawRate = (base + mod) * authority * this.stats.grip * this.profile.yawRate;
    } else {
      yawRate = steer * TUNING.maxYawRate * authority * this.stats.grip * this.profile.yawRate;
    }
    if (this.speed < -0.2) yawRate *= -1;
    if (!this.grounded) yawRate *= 0.45;
    if (this.spinTime > 0) yawRate = TAU * 2.2 * Math.min(1, this.spinTime);

    this.yaw += yawRate * dt;

    // Little Racing V2 — gentle "straighten out" assist in kids mode: when the
    // child isn't steering and the kart is still sliding sideways, ease the
    // nose back toward the direction of travel so they don't keep driving at
    // an angle. Keeps the feel of active driving, just more forgiving.
    if (this.profile.autoCenter > 0 && Math.abs(steer) < 0.08 && !this.drifting
        && this.grounded && Math.abs(this.speed) > 4) {
      const velYaw = Math.atan2(this.velocity.x, this.velocity.z);
      this.yaw = dampAngle(this.yaw, velYaw, this.profile.autoCenter * 4, dt);
    }

    this.yaw = ((this.yaw % TAU) + TAU) % TAU;

    /* ------------------------- lateral slip ------------------------- */
    const gripLat = (this.drifting ? TUNING.driftGrip : TUNING.gripLateral * this.profile.gripLateral)
      * this.stats.grip * this.surfaceLateral;
    // centrifugal push
    this.lateral += -yawRate * this.speed * (this.drifting ? 0.62 : 0.2) * dt;
    this.lateral -= this.lateral * Math.min(1, gripLat * dt);
    this.lateral = THREE.MathUtils.clamp(this.lateral, -16, 16);

    /* -------------------------- integrate --------------------------- */
    const fwd = this.forward;
    const rgt = this.right;
    this.velocity.set(
      fwd.x * this.speed + rgt.x * this.lateral,
      0,
      fwd.z * this.speed + rgt.z * this.lateral
    );
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    /* ---------------------------- ground ---------------------------- */
    const surf = track.surfaceAt(this.position, this.trackIndex);
    this.trackIndex = surf.loc.index;
    this._surfaceNormal.copy(surf.normal);
    const groundY = surf.y;

    this.vy -= TUNING.gravity * dt;
    this.position.y += this.vy * dt;

    if (this.position.y <= groundY) {
      if (!this.grounded && this.airTime > 0.35) {
        // landing squash + small speed penalty on hard landings
        this.suspension = this.suspension.map(() => -0.18);
        this.speed *= 0.97;
      }
      this.position.y = groundY;
      this.vy = 0;
      this.grounded = true;
      this.airTime = 0;
    } else {
      this.grounded = false;
      this.airTime += dt;
    }

    const absLat = Math.abs(surf.loc.lat);
    this.offroad = absLat > surf.loc.width * 0.98;
    this.groundY = groundY;
    if (absLat < surf.loc.width * 0.9) this._lastGoodLat = surf.loc.lat;

    /* --------------------------- barriers --------------------------- */
    // Baked from the real facades where available, so the kart's body stops
    // at the stucco instead of sinking into it.
    const limit = track.clearance
      ? track.clearance.limitAt(surf.loc.index, surf.loc.lat)
      : surf.loc.width + 2.5;
    if (absLat > limit) {
      const over = absLat - limit;
      const sign = Math.sign(surf.loc.lat);
      const right = track.getRight(surf.loc.index);
      this.position.add(right.clone().multiplyScalar(-sign * over));
      this._barrierPushed = true;

      // slide along the barrier: kill only the component driving into it,
      // keep (most of) the component running along it. Head-on hits scrub
      // hard, glancing hits barely cost anything — the arcade wall feel.
      const inward = right.clone().multiplyScalar(-sign);      // points back to the road
      const tan = track.getTangent(surf.loc.index);
      const heading = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const intoWall = -heading.dot(inward);                   // 1 = straight into it
      if (intoWall > 0) {
        // scrub proportional to how square the impact is (kids mode gentler)
        const scrub = intoWall * intoWall * 0.9 * this.profile.wallScrub + over * 0.08 * this.profile.wallScrub;
        this.speed *= 1 - Math.min(0.55 * this.profile.wallScrub, scrub);
        // deflect the nose toward the wall's tangent so throttle still carries
        // you forward instead of grinding to a halt
        const along = Math.sign(this.speed) * Math.sign(heading.dot(tan) || 1);
        const glide = tan.clone().multiplyScalar(along);
        const wantYaw = Math.atan2(glide.x, glide.z) - (this.speed < 0 ? Math.PI : 0);
        this.yaw = dampAngle(this.yaw, wantYaw, 3.5 + 9 * intoWall, dt);
      }
      // Cancel only the outward slide; a glancing inward drift is left alone.
      // `lateral` lives on the kart's own lateral axis, which is not the track
      // right vector (and is flipped relative to it), so project rather than
      // comparing against the track-space sign.
      const outward = right.clone().multiplyScalar(sign);
      if (this.lateral * this.right.dot(outward) > 0) this.lateral *= -TUNING.wallBounce * this.profile.wallBounce;
      this.wallHit = Math.min(1, over + intoWall * 0.5);
      if (this.drifting && intoWall > 0.35) this._releaseDrift();

      // last resort: if you've been mashed against a wall going nowhere,
      // pop back onto the racing line rather than sitting there forever
      this._pinned = (Math.abs(this.speed) < 3 && throttle > 0) ? (this._pinned || 0) + dt : 0;
      if (this._pinned > this.profile.stuckThreshold) this.stuck = true;
    } else {
      this.wallHit = 0;
      this._pinned = 0;
    }

    /* 护栏把车横着推回来之后，脚下的地面也跟着变了（路肩外侧是往下掉的，
     * 推回路面就变高）。这里的 y 还是推之前那一点的，如果不重算，这一帧
     * 车就实实在在陷进路面里 —— 实测桥头能陷 33 cm，看上去像掉进了桥板。
     * 推挤是低频事件，只在真的碰到护栏时才多算一次地表。 */
    if (this._barrierPushed) {
      this._barrierPushed = false;
      const after = track.surfaceAt(this.position, surf.loc.index);
      this.trackIndex = after.loc.index;
      this._surfaceNormal.copy(after.normal);
      this.groundY = after.y;
      if (this.grounded) { this.position.y = after.y; this.vy = 0; }
    }

    /* ------------------------ visual response ----------------------- */
    // the body yaws *into* the slide, the classic kart look
    const slideAngle = Math.atan2(this.lateral, Math.max(4, Math.abs(this.speed)));
    const targetVisual = this.yaw - slideAngle * (this.drifting ? 1.25 : 0.55);
    this.visualYaw = dampAngle(this.visualYaw, targetVisual, 14, dt);

    /* 车身侧倾分两种车型，方向和来源都不一样：
     *
     *   · 四轮卡丁车 —— 向外侧倾（离心力把车身压向外侧），由 yawRate 决定；
     *   · 两轮摩托   —— 向弯**内**倾（车手主动压弯），由转向量 + 速度决定。
     *
     * 两者符号相反，所以不能共用一套。model.lean 只有摩托车才有。 */
    const lp = this.model.lean;
    if (lp) {
      const sf = THREE.MathUtils.clamp(Math.abs(this.speed) / (this.speedCap * lp.full), 0, 1);
      /* 符号说明：车头朝 +Z、车顶朝 +Y，车的**右侧是 −X**。
       * rotation.z > 0 把 +X（左侧）抬起来 = 向右倒，所以右转（steer < 0）
       * 要取 −steer 才能压向弯内。 */
      const targetLean = THREE.MathUtils.clamp(
        -steer * lp.gain * (this.drifting ? lp.drift : 1) * Math.pow(sf, 0.75),
        -lp.max, lp.max
      );
      this.lean = THREE.MathUtils.damp(this.lean, targetLean, lp.lambda, dt);
      this.roll = 0;
    } else {
      this.lean = 0;
      const targetRoll = THREE.MathUtils.clamp(-yawRate * 0.16 - this.lateral * 0.012, -0.3, 0.3);
      this.roll = THREE.MathUtils.damp(this.roll, targetRoll, 9, dt);
    }

    const accelG = (this.boostTime > 0 ? 1 : throttle) - brake;
    /* 俯仰是「绕着车身原点转」的纯视觉动作：前后轮会一上一下各挪 r·sinθ。
     * 卡丁车有悬挂行程、看不出来；摩托车只有两个轮子，抬起 3° 就会让
     * 前轮离地 2.7 cm、后轮陷进路面 2.7 cm。所以摩托车把这个量压到很小
     * （model.pitchScale），靠压弯来表达重心，轮胎始终贴着地面。 */
    const targetPitch = THREE.MathUtils.clamp(
      (-accelG * 0.035 + (this.grounded ? 0 : -0.06)) * (this.model.pitchScale ?? 1),
      -0.12, 0.12
    );
    this.pitch = THREE.MathUtils.damp(this.pitch, targetPitch, 7, dt);

    this.steerVisual = THREE.MathUtils.damp(
      this.steerVisual,
      this.drifting ? this.driftDir * 0.55 + steer * 0.35 : steer,
      12, dt
    );
    this.wheelSpin += (this.speed / (this.model.wheelRadius || 0.42)) * dt;

    // suspension travel per wheel
    for (let i = 0; i < 4; i++) {
      const isRear = i > 1;
      const load = (isRear ? accelG * 0.05 : -accelG * 0.05) +
        (i % 2 === 0 ? -1 : 1) * this.roll * 0.22;
      this.suspension[i] = THREE.MathUtils.damp(this.suspension[i], load, 11, dt);
    }

    this.progress = track.progress(surf.loc);
    return surf;
  }

  _releaseDrift() {
    if (this.driftTier > 0) {
      const t = this.driftTier - 1;
      this.applyBoost(TUNING.miniTurboPower[t], TUNING.miniTurboTime[t]);
      this.justBoosted = this.driftTier;
    }
    this.drifting = false;
    this.driftCharge = 0;
    this.driftTier = 0;
    this._counterT = 0;
  }

  /** Push the visual model to match the simulated state. */
  syncVisual(dt) {
    const o = this.object;
    o.position.copy(this.position);

    const b = this.model.body;
    o.rotation.set(0, this.visualYaw, 0);

    /* Sit the chassis in the plane of the road.
     *
     * The smoothing has to happen on the *world-space* normal, not on the
     * resulting angles: the road's tilt is fixed in world space, so its
     * decomposition into the kart's own roll/pitch swings around as the
     * kart yaws. Damping those angles would lag hardest mid-corner, which
     * is precisely where the kart needs to look planted. */
    const rate = this.grounded ? 14 : 3;
    const vn = this._visualNormal;
    vn.x = THREE.MathUtils.damp(vn.x, this._surfaceNormal.x, rate, dt);
    vn.y = THREE.MathUtils.damp(vn.y, this._surfaceNormal.y, rate, dt);
    vn.z = THREE.MathUtils.damp(vn.z, this._surfaceNormal.z, rate, dt);
    vn.normalize();

    // Resolve it onto the kart's axes: the component along local +X is the
    // camber, along local +Z the gradient. The signs differ because a
    // positive rotation.z lifts the right-hand side while a positive
    // rotation.x drops the nose.
    const c = Math.cos(this.visualYaw), s = Math.sin(this.visualYaw);
    this.groundRoll = -Math.atan2(vn.x * c - vn.z * s, vn.y);
    this.groundPitch = Math.atan2(vn.x * s + vn.z * c, vn.y);

    b.rotation.set(this.pitch + this.groundPitch, 0, this.lean + this.roll + this.groundRoll);

    /* 压弯时轮胎会「切进」地面一点点（绕纵轴转 φ，圆盘最低点下沉 r(1−cos φ)）。
     * 这里把整车抬回去，保证两个轮子始终贴着地面，不浮空也不陷进去。 */
    if (this.model.lean && this.model.wheelRadius) {
      b.position.y = this.model.wheelRadius * (1 - Math.cos(this.lean));
    }

    const scale = this.shrinkTime > 0 ? 0.55 : 1;
    const squash = this.squashTime > 0 ? 0.35 : 1;
    b.scale.set(
      THREE.MathUtils.damp(b.scale.x, scale, 10, dt),
      THREE.MathUtils.damp(b.scale.y, scale * squash, 10, dt),
      THREE.MathUtils.damp(b.scale.z, scale, 10, dt)
    );

    /* 车轮数量按车型来（卡丁车 4 个、摩托 2 个），不再写死 4。
     * 摩托的 pivot 同时承担转向和自转（网格原点不在轮心），所以 spin 指回 pivot。 */
    const wheelSteer = this.model.steerMax ?? 0.52;
    const wheelList = this.model.wheels;
    for (let i = 0; i < wheelList.length; i++) {
      const w = wheelList[i];
      if (!w || !w.pivot) continue;            // 外部模型少轮子也不崩，只是少画一个
      w.pivot.position.y = w.restY + this.suspension[i] * (w.suspension ?? 1);
      if (w.steer) w.pivot.rotation.y = this.steerVisual * wheelSteer;
      w.spin.rotation.x = this.wheelSpin;
    }
    if (this.model.steering) this.model.steering.rotation.y = -this.steerVisual * 0.9;

    // driver leans into the corner and ducks at speed
    /* 海龟车的主角是烘死姿态，手到轮缘只有 7 mm，侧倾必须收敛，
     * 否则转弯时手会肉眼可见地离开方向盘（driverLean = 0.3）。 */
    const lean = this.model.driverLean ?? 1;
    const d = this.model.driver;
    d.rotation.z = -this.steerVisual * 0.14 * lean;
    d.rotation.x = -Math.min(0.14, Math.abs(this.speed) / (this.speedCap || 33) * 0.14) * lean;

    // boost flames
    const flameOn = this.boostTime > 0 ? 1 : 0;
    for (const f of this.model.flames) {
      const target = flameOn * (0.55 + Math.random() * 0.45);
      f.material.opacity = THREE.MathUtils.damp(f.material.opacity, target, 18, dt);
      const s = 0.6 + flameOn * (0.8 + Math.random() * 0.5);
      f.scale.set(s, s, s * (1 + flameOn * 1.4));
      f.material.color.setHSL(0.06 + Math.random() * 0.05, 1, 0.55);
    }

    // contact shadow follows the ground, fades when airborne
    const air = Math.max(0, this.position.y - (this.groundY ?? this.position.y));
    this.model.blob.position.y = 0.03 - air;
    this.model.blob.scale.setScalar(1 / (1 + air * 0.22));
    this.model.blob.material.opacity = this.grounded ? 0.85 : Math.max(0, 0.85 - this.airTime * 1.6);

    /* 车型自己的收尾（目前只有摩托车用：车把转到前叉轴上、骑手绕髋跟一点）。
     * 红车 / 海龟车没有这个钩子，一行都没变。 */
    this.model.visualHook?.(this, dt);
  }
}

function dampAngle(current, target, lambda, dt) {
  let diff = target - current;
  while (diff > Math.PI) diff -= TAU;
  while (diff < -Math.PI) diff += TAU;
  return current + diff * (1 - Math.exp(-lambda * dt));
}

/* ------------------------------------------------------------------ *
 * Chase camera: spring-damped follow with speed FOV, drift lead, and
 * an impulse shake channel.
 * ------------------------------------------------------------------ */
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.shake = 0;
    this.baseFov = 62;
    this.mode = 0; // 0 = chase, 1 = close, 2 = far
    this._init = false;
  }

  addShake(v) {
    this.shake = Math.min(1.4, this.shake + v);
  }

  update(dt, kart, opts = {}) {
    /* 车型可以改写追尾镜头：摩托车比卡丁车矮、短，用同一组距离会显得车很小，
     * 追尾时只看得到后半截。model.cam 只有摩托车提供，别的车型走原参数。 */
    /* 摩托车的两个机位：桌面 / 手机横屏。
     *
     * 手机横屏（touch 布局）会把速度表挪到**屏幕正中底部**，而摩托车在追尾
     * 画面里正好压在那一块——实测 844×390 下后轮有 47px 落在表盘后面。
     * 短屏改用「稍微拉远 + 视线压低」的机位，把整车抬到表盘上方；
     * 桌面沿用原来的近距离机位（那里速度表在右下角，不冲突）。 */
    const shortView = typeof innerHeight === 'number' && innerHeight <= 480;
    const mc = (shortView && kart.model?.camShort) ? kart.model.camShort : (kart.model?.cam || {});
    /* 摩托车还可以改 FOV：默认 62° 的广角在 4 m 外只留得下小小一个人影，
     * 收窄到 56° 以后头肩和两个轮胎都能看清，速度感仍然在。 */
    const baseFov = mc.fov ?? this.baseFov;
    const cfg = [
      { dist: mc.dist ?? 7.0, height: mc.height ?? 3.15, lookAhead: mc.lookAhead ?? 6.5 },
      { dist: 5.0, height: 2.35, lookAhead: 7.5 },
      { dist: 9.6, height: 4.3, lookAhead: 6.0 },
    ][this.mode];
    const lookY = mc.lookY ?? 1.35;

    const back = opts.lookBack ? -1 : 1;
    const yaw = kart.visualYaw + (opts.lookBack ? Math.PI : 0);
    const speedFrac = THREE.MathUtils.clamp(Math.abs(kart.speed) / (kart.speedCap || 33), 0, 1.6);

    // drift makes the camera swing wide toward the outside of the corner
    const driftOffset = kart.drifting ? -kart.driftDir * 1.5 : 0;
    const dist = cfg.dist + speedFrac * 1.1 + (kart.boostTime > 0 ? 0.9 : 0);

    const desired = new THREE.Vector3(
      kart.position.x - Math.sin(yaw) * dist + Math.cos(yaw) * driftOffset,
      kart.position.y + cfg.height + (kart.grounded ? 0 : Math.min(2.2, kart.airTime * 2.4)),
      kart.position.z - Math.cos(yaw) * dist - Math.sin(yaw) * driftOffset
    );

    if (!this._init) {
      this.pos.copy(desired);
      this._init = true;
    }
    // stiffer spring at high speed keeps the kart from outrunning the camera
    const lambda = 6.5 + speedFrac * 5.0;
    this.pos.x = THREE.MathUtils.damp(this.pos.x, desired.x, lambda, dt);
    this.pos.y = THREE.MathUtils.damp(this.pos.y, desired.y, lambda * 0.85, dt);
    this.pos.z = THREE.MathUtils.damp(this.pos.z, desired.z, lambda, dt);

    const lookTarget = new THREE.Vector3(
      kart.position.x + Math.sin(yaw) * cfg.lookAhead * back,
      kart.position.y + lookY,
      kart.position.z + Math.cos(yaw) * cfg.lookAhead * back
    );
    this.look.lerp(lookTarget, 1 - Math.exp(-12 * dt));

    this.camera.position.copy(this.pos);

    // shake
    if (this.shake > 0.001) {
      const s = this.shake * 0.22;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 2.6);
    }
    if (kart.offroad && Math.abs(kart.speed) > 6) this.addShake(dt * 1.6);

    this.camera.lookAt(this.look);
    // subtle dutch angle while drifting
    const targetRoll = kart.drifting ? -kart.driftDir * 0.045 : 0;
    this._roll = THREE.MathUtils.damp(this._roll || 0, targetRoll, 6, dt);
    this.camera.rotateZ(this._roll);

    const targetFov = baseFov + speedFrac * 9 + (kart.boostTime > 0 ? 8 : 0);
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 5, dt);
    this.camera.updateProjectionMatrix();
  }
}
