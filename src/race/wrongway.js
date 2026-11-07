import * as THREE from 'three';

/**
 * 逆行检测 —— 只用几何，不猜。
 *
 * 判定用的是**实际运动方向**，不是车头朝向：
 *   速度矢量 = forward * speed + right * lateral
 * 然后与赛道在当前位置的切线单位向量点乘。
 *   dot ≈ +1  顺着赛道跑
 *   dot < 0   在倒退
 *
 * 阈值取 -0.62（约 128°）。为什么不是 -0.2：
 *   · 正常转弯时车头最多偏到切线两侧 ±90°，点乘约 0，碰不到阈值；
 *   · 漂移是横向滑移，速度矢量的切向分量仍然朝前，也不会误报；
 *   · 低速掉头（磨车头）速度低于 minSpeed，直接被速度门槛挡掉。
 *
 * 再加上「连续保持 2 秒」才触发，单次打滑、碰撞转圈、被撞飞都不会冒提示。
 * 触发后进入 8 秒冷却，一个提示不会连播。
 */
export class WrongWayWatcher {
  constructor(opts = {}) {
    this.holdSeconds = opts.holdSeconds ?? 2.0;   // 连续逆向多久才提示
    this.cooldownSeconds = opts.cooldownSeconds ?? 8.0;
    this.minSpeed = opts.minSpeed ?? 3.2;         // m/s，约 11.5 km/h
    this.enterDot = opts.enterDot ?? -0.62;
    this.exitDot = opts.exitDot ?? -0.30;

    this.held = 0;
    this.cool = 0;
    this.wrong = false;
    this.fires = 0;
    this.lastDot = 1;
    this._tan = new THREE.Vector3();
    this._v = new THREE.Vector3();
  }

  reset() {
    this.held = 0;
    this.cool = 0;
    this.wrong = false;
    this.lastDot = 1;
  }

  /** 车是否处于「逆行」判定态（提示灯 / 测试用）。 */
  get active() { return this.wrong; }

  /**
   * @param {number} dt 固定步长
   * @param {object} kart 玩家车（需要 forward / right / speed / lateral / trackIndex）
   * @param {object} track 赛道（getTangent）
   * @returns {boolean} 这一帧是否需要弹提醒
   */
  update(dt, kart, track) {
    const d = Math.min(Math.max(dt || 0, 0), 0.1);
    if (this.cool > 0) this.cool = Math.max(0, this.cool - d);

    const speed = Number(kart?.speed) || 0;
    const lateral = Number(kart?.lateral) || 0;
    const v = this._v.set(
      kart.forward.x * speed + kart.right.x * lateral,
      0,
      kart.forward.z * speed + kart.right.z * lateral
    );
    const mag = Math.hypot(v.x, v.z);

    if (mag < this.minSpeed) {
      // 慢速蠕动 / 原地掉头：不算逆行，进度直接清零
      this.held = 0;
      this.wrong = false;
      this.lastDot = 0;
      return false;
    }

    const tan = track.getTangent(kart.trackIndex ?? 0, this._tan);
    const tlen = Math.hypot(tan.x, tan.z) || 1;
    const dot = (v.x * tan.x + v.z * tan.z) / (mag * tlen);
    this.lastDot = dot;

    // 进入 / 退出用不同阈值（施密特触发），避免在阈值上来回抖
    if (!this.wrong) {
      if (dot <= this.enterDot) this.wrong = true;
    } else if (dot >= this.exitDot) {
      this.wrong = false;
      this.held = 0;
      return false;
    }

    if (!this.wrong) {
      this.held = 0;
      return false;
    }

    this.held += d;
    if (this.held < this.holdSeconds) return false;
    if (this.cool > 0) return false;

    this.cool = this.cooldownSeconds;
    this.fires += 1;
    return true;
  }

  debug() {
    return {
      wrong: this.wrong,
      held: +this.held.toFixed(2),
      cool: +this.cool.toFixed(2),
      fires: this.fires,
      dot: +this.lastDot.toFixed(3),
      holdSeconds: this.holdSeconds,
      cooldownSeconds: this.cooldownSeconds,
      minSpeed: this.minSpeed,
    };
  }
}

export default WrongWayWatcher;
