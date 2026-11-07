import * as THREE from 'three';

/* ------------------------------------------------------------------ *
 * Race director: grid, countdown, lap counting, standings, respawn and
 * the finish sequence.
 * ------------------------------------------------------------------ */

export const RaceState = {
  INTRO: 'intro',
  COUNTDOWN: 'countdown',
  RACING: 'racing',
  FINISHED: 'finished',
};

export class Race {
  constructor(track, karts, opts = {}) {
    this.track = track;
    this.karts = karts;
    this.laps = opts.laps ?? 3;
    this.state = RaceState.INTRO;
    this.time = 0;
    this.countdown = 3.999;
    this.raceTime = 0;
    this.introTime = 0;
    this.introDuration = opts.introDuration ?? 6.5;
    this.onEvent = opts.onEvent || (() => {});
    this.finishOrder = [];

    this.grid();
  }

  grid() {
    this.karts.forEach((k, idx) => {
      const pose = this.track.startPose(idx);
      k.placeAt(pose.position, pose.forward);
      k.trackIndex = pose.index;
      k.lap = 0;
      k.halfway = false;
      k.progress = this.track.progress({ index: pose.index });
      k.progressTotal = k.progress - 1;
      /* 跨线判定靠 progress 的帧间差值，基线必须是「这一次」的发车位。
       * 留着上一局的 _prevProgress，开局那一帧就会被当成一次跨线。 */
      k._prevProgress = k.progress;
      k.rank = idx + 1;
      k.finished = false;
      k.finishTime = 0;
      k.lapTimes = [];
      k.lastLapAt = 0;
      k.speed = 0;
      k.lateral = 0;
      k.item = null;
      k.starTime = 0;
      k.respawnTimer = 0;
    });
    this.updateRanks();
  }

  start() {
    this.state = RaceState.COUNTDOWN;
    this.countdown = 3.999;
    this.onEvent('countdown', 3);
    this._lastCount = 3;
  }

  get running() {
    return this.state === RaceState.RACING;
  }

  update(dt) {
    this.time += dt;

    if (this.state === RaceState.INTRO) {
      this.introTime += dt;
      if (this.introTime >= this.introDuration) this.start();
      return;
    }

    if (this.state === RaceState.COUNTDOWN) {
      this.countdown -= dt;
      const c = Math.ceil(this.countdown);
      if (c !== this._lastCount) {
        this._lastCount = c;
        if (c > 0) this.onEvent('countdown', c);
      }
      if (this.countdown <= 0) {
        this.state = RaceState.RACING;
        this.onEvent('go');
        // rocket start for anyone holding throttle right at the lights
        for (const k of this.karts) {
          if (k.chargedStart > 0.55 && k.chargedStart < 1.0) {
            k.applyBoost(9, 1.4);
            this.onEvent('rocketStart', k);
          } else if (k.chargedStart >= 1.0) {
            k.spinOut(0.9);
          }
        }
      }
      return;
    }

    if (this.state === RaceState.RACING || this.state === RaceState.FINISHED) {
      this.raceTime += dt;
      this.updateProgress(dt);
      this._checkDnf();
      this.updateRanks();
    }
  }

  updateProgress(dt) {
    const t = this.track;
    for (const k of this.karts) {
      if (k.finished) continue;
      const p = k.progress;
      if (p > 0.42 && p < 0.62) k.halfway = true;
      if (k._prevProgress !== undefined) {
        const d = p - k._prevProgress;
        if (d < -0.5 && k.halfway) {
          // crossed the line forwards
          k.lap++;
          k.halfway = false;
          const lapTime = this.raceTime - k.lastLapAt;
          k.lastLapAt = this.raceTime;
          if (k.lap > 0) k.lapTimes.push(lapTime);
          if (k.lap >= this.laps) this.finish(k);
          else this.onEvent('lap', k);
        } else if (d > 0.5) {
          // crossed backwards
          k.lap = Math.max(0, k.lap - 1);
        }
      }
      k._prevProgress = p;
      k.progressTotal = k.lap + p;

      // respawn if a kart ends up somewhere it shouldn't be
      const loc = t.locate(k.position, k.trackIndex);
      const stray = Math.abs(loc.lat) > t.width[loc.index] * 3.2 ||
        k.position.y < t.pointAt(loc.index, 0, new THREE.Vector3()).y - 14;
      if (stray) {
        k.respawnTimer += dt;
        if (k.respawnTimer > 0.6) this.respawn(k);
      } else {
        k.respawnTimer = 0;
      }
      // wedged against a barrier with the throttle down and going nowhere
      if (k.stuck) this.respawn(k);
    }
  }

  respawn(kart) {
    const t = this.track;
    const i = kart.trackIndex;
    const p = t.pointAt(i, THREE.MathUtils.clamp(kart._lastGoodLat ?? 0, -4, 4), new THREE.Vector3());
    const tan = t.getTangent(i, new THREE.Vector3());
    kart.placeAt(p.add(new THREE.Vector3(0, 1.2, 0)), tan);
    kart.speed = kart.respawnSpeed ?? 8;
    kart.lateral = 0;
    kart.vy = 0;
    kart.spinTime = 0;
    kart.invulnTime = 1.4;
    kart.respawnTimer = 0;
    kart._pinned = 0;
    kart.stuck = false;
    this.onEvent('respawn', kart);
  }

  updateRanks() {
    const sorted = [...this.karts].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progressTotal - a.progressTotal;
    });
    sorted.forEach((k, i) => { k.rank = i + 1; });
    this.standings = sorted;
  }

  finish(kart) {
    kart.finished = true;
    kart.finishTime = this.raceTime;
    this.finishOrder.push(kart);
    kart.finalRank = this.finishOrder.length;
    this.onEvent('finish', kart);
    if (kart.isPlayer) {
      this.state = RaceState.FINISHED;
      this.onEvent('raceOver', kart);
    } else if (this.finishOrder.length >= this.karts.length - 1) {
      // last one running: give them a grace period, then call it
      this._dnfAt = this.raceTime + 45;
    }
  }

  /** Force-retire anyone still circulating after the grace period. */
  _checkDnf() {
    if (this._dnfAt == null || this.raceTime < this._dnfAt) return;
    this._dnfAt = null;
    for (const k of this.karts) if (!k.finished) this.finish(k);
  }

  /** Best lap across the field, for the results screen. */
  bestLap() {
    let best = Infinity;
    for (const k of this.karts) for (const l of k.lapTimes) best = Math.min(best, l);
    return best === Infinity ? 0 : best;
  }
}

export function formatTime(s) {
  // Only a *missing* time gets the placeholder — 0 must read as 0'00"000, or the
  // clock looks broken for the first second of every race.
  if (!isFinite(s) || s < 0) return "--'--\"---";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 1000);
  return `${m}'${String(sec).padStart(2, '0')}"${String(ms).padStart(3, '0')}`;
}
