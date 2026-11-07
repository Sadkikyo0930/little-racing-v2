import * as THREE from 'three';

/**
 * NpcAnimator — 免绑骨的轻量 NPC 动画（第二阶段 · 动作修订版）
 *
 * ── 本版按验收意见做的两处修正 ────────────────────────────────
 *
 * 1. **彻底移除「挥手」**
 *    上一版用顶点着色器把整只手臂像橡皮管一样强行转起来，实际观感诡异。
 *    本版删除全部手臂相关代码：不再有 aArmS 顶点属性、不再有并查集壳体识别、
 *    不再有 uArm* uniform。模型几何因此完全回到第一阶段交付的原样。
 *    后续若要做挥手，必须先检查拓扑 / 关节分离 / 骨骼权重，单独制作并验收。
 *
 * 2. **转身改为「目标朝向插值」**
 *    上一版 `turnAngle = (t * 1.05) % (2π)` 是无限累加，会一直转圈。
 *    本版每个动作声明一个**目标朝向**（0 / ±60°），用 quaternion.slerp 从
 *    「当前实际角度」平滑插值到目标，到位即停；换方向时从当前角度续接，
 *    不会跳变，也不会转满一圈。
 *
 * ── 仍然坚持的原则 ───────────────────────────────────────────
 *   · 不动拓扑：不焊接、不拆壳、不加骨骼、不改顶点索引、不修改 GLB。
 *   · sway / nod 是连续变形场，相邻顶点旋转量几乎相同 → 结构上不可能撕裂。
 *   · 整体朝向用刚体四元数，对任何拓扑都绝对安全。
 *   · 动作关闭时角度归零，着色器退化为恒等变换，与原 GLB 逐顶点一致。
 */

const BEND_GLSL = /* glsl */ `
uniform float uSwayAngle;
uniform float uSwayPivotY;
uniform vec2  uSwayBand;
uniform float uNodAngle;
uniform vec3  uNodPivot;
uniform vec2  uNodBand;

vec3 npcRotZd(vec3 v, float a){ float c = cos(a), s = sin(a); return vec3(v.x*c - v.y*s, v.x*s + v.y*c, v.z); }
vec3 npcRotXd(vec3 v, float a){ float c = cos(a), s = sin(a); return vec3(v.x, v.y*c - v.z*s, v.y*s + v.z*c); }

/* 权重一律由「原始 position」计算，保证变形场稳定、不随中间结果漂移。 */
void npcWeights(out float wSway, out float wNod) {
  vec3 p = position;
  wSway = smoothstep(uSwayBand.x, uSwayBand.y, p.y);
  wNod  = smoothstep(uNodBand.x,  uNodBand.y,  p.y);
}

vec3 npcBendPoint(vec3 p) {
  float wS, wN; npcWeights(wS, wN);
  vec3 q = p;
  if (abs(uSwayAngle) > 1e-6 && wS > 0.0)
    q = vec3(0.0, uSwayPivotY, 0.0) + npcRotZd(q - vec3(0.0, uSwayPivotY, 0.0), uSwayAngle * wS);
  if (abs(uNodAngle) > 1e-6 && wN > 0.0)
    q = uNodPivot + npcRotXd(q - uNodPivot, uNodAngle * wN);
  return q;
}

/* 法线只做纯旋转（不减枢轴），长度不变。 */
vec3 npcBendDir(vec3 d) {
  float wS, wN; npcWeights(wS, wN);
  vec3 q = d;
  if (abs(uSwayAngle) > 1e-6 && wS > 0.0) q = npcRotZd(q, uSwayAngle * wS);
  if (abs(uNodAngle) > 1e-6 && wN > 0.0)  q = npcRotXd(q, uNodAngle * wN);
  return q;
}
`;

/** 动作 id 列表。挥手已移除；转身拆成左/右两个有限角度动作。 */
const ACTION_IDS = ['idle', 'sway', 'nod', 'turnLeft', 'turnRight'];

/**
 * 每个动作的**目标朝向**（弧度，绕 +Y）。
 * 角色正面朝 +Z；从正面相机看，+Y 旋转会让脸转向画面右侧。
 * 所以「右转」为正、「左转」为负，转身结束后就停住，不再累加。
 */
const TARGET_YAW = {
  idle: 0,
  sway: 0,
  nod: 0,
  turnLeft: -Math.PI / 3,     // -60°
  turnRight: Math.PI / 3,     // +60°
};

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const smoothstep01 = k => {
  const x = k <= 0 ? 0 : (k >= 1 ? 1 : k);
  return x * x * (3 - 2 * x);   // C1 连续：起点和终点速度都趋近 0，转向不生硬
};

function makeUniforms(rig) {
  return {
    uSwayAngle: { value: 0 },
    uSwayPivotY: { value: rig.sway.pivotY },
    uSwayBand: { value: new THREE.Vector2(rig.sway.band[0], rig.sway.band[1]) },
    uNodAngle: { value: 0 },
    uNodPivot: { value: new THREE.Vector3(rig.nod.pivot[0], rig.nod.pivot[1], rig.nod.pivot[2]) },
    uNodBand: { value: new THREE.Vector2(rig.nod.band[0], rig.nod.band[1]) },
  };
}

const PATCH_KEY = 'little-racing-v2-npc-bend-v3';

function patchMaterial(mat, uniforms) {
  if (!mat || mat.__npcPatched) return;
  mat.__npcPatched = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (typeof prev === 'function') prev(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + BEND_GLSL)
      .replace('#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\n  objectNormal = npcBendDir(objectNormal);')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\n  transformed = npcBendPoint(transformed);');
  };
  mat.customProgramCacheKey = () => PATCH_KEY;
  mat.needsUpdate = true;
}

export class NpcAnimator {
  constructor(root, rig) {
    this.root = root;
    this.rig = rig;
    this.uniforms = makeUniforms(rig);
    this.baseYaw = THREE.MathUtils.degToRad(rig.__yawDeg || 0);
    this.action = 'idle';
    this.t = 0;

    /* 转身状态：从 turnFromYaw 插值到 turnToYaw，耗时 turnDur 秒 */
    this.turnDur = Math.max(0.15, rig.turn?.duration ?? 0.9);
    this.turnDeg = THREE.MathUtils.clamp(rig.turn?.degrees ?? 60, 0, 180);
    this.turnFromYaw = 0;
    this.turnToYaw = 0;
    this.turnT0 = 0;
    this.yaw = 0;

    this._qa = new THREE.Quaternion();
    this._qb = new THREE.Quaternion();
    this._qt = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._fwd = new THREE.Vector3();

    this.patched = [];
    root.traverse(o => {
      if (!o.isMesh || !o.material) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) patchMaterial(m, this.uniforms);
      this.patched.push(o);
    });

    this.reset();
  }

  attachMaterial(mat) { patchMaterial(mat, this.uniforms); }

  /* ---------------- 朝向插值 ---------------- */

  /** 当前时刻的实际朝向偏移（弧度），smoothstep 缓动后落在 [from, to] 之间。 */
  yawAt(t) {
    const k = (t - this.turnT0) / this.turnDur;
    if (k >= 1) return this.turnToYaw;
    if (k <= 0) return this.turnFromYaw;
    return this.turnFromYaw + (this.turnToYaw - this.turnFromYaw) * smoothstep01(k);
  }

  /**
   * 设定新的目标朝向。起点永远是「此刻的实际角度」，不是上一个目标，
   * 所以半路改方向也会从当前姿势平滑续接，不会跳。
   */
  aimTurn(targetYaw) {
    const to = Number.isFinite(targetYaw) ? targetYaw : 0;
    if (Math.abs(to - this.turnToYaw) < 1e-6) return false;
    this.turnFromYaw = this.yawAt(this.t);
    this.turnT0 = this.t;
    this.turnToYaw = to;
    return true;
  }

  /**
   * 把朝向写成四元数：slerp(起点, 目标, e)，再叠加局部摆动。
   * 全程只做「设定目标姿态」，没有 rotation.y += 之类的累加。
   */
  applyPose(t, tiltZ, wobbleY) {
    const k = smoothstep01((t - this.turnT0) / this.turnDur);
    const qa = this._qa.setFromAxisAngle(Y_AXIS, this.baseYaw + this.turnFromYaw);
    const qb = this._qb.setFromAxisAngle(Y_AXIS, this.baseYaw + this.turnToYaw);
    qa.slerp(qb, k);
    if (tiltZ || wobbleY) {
      this._e.set(0, wobbleY, tiltZ);
      qa.multiply(this._qt.setFromEuler(this._e));
    }
    this.root.quaternion.copy(qa);
    this.yaw = this.root.rotation.y - this.baseYaw;
  }

  /* ---------------- 动作 ---------------- */

  setAction(id) {
    if (!ACTION_IDS.includes(id)) return false;
    this.action = id;
    this.aimTurn(this.targetYawFor(id));
    return true;
  }

  /**
   * 该动作的目标朝向。转身幅度可按角色 / 场景配置（rig.turn.degrees）：
   * 预览页用默认 60°，剧情里用 45° 的「侧身看同伴」更自然。
   * 无论幅度多少，都是 slerp 到位后停住，不会转满一圈。
   */
  targetYawFor(id) {
    const sign = id === 'turnLeft' ? -1 : id === 'turnRight' ? 1 : 0;
    return sign * THREE.MathUtils.degToRad(this.turnDeg);
  }

  /** 回到中性姿态并清空转身历史（poseAt 用它保证逐帧可复现）。 */
  reset() {
    const u = this.uniforms;
    u.uSwayAngle.value = 0;
    u.uNodAngle.value = 0;
    this.t = 0;
    this.turnFromYaw = 0;
    this.turnToYaw = 0;
    this.turnT0 = 0;
    this.yaw = 0;
    this.root.position.y = 0;
    this.applyPose(0, 0, 0);
  }

  update(dt) {
    const d = Math.min(Math.max(dt || 0, 0), 0.1);
    this.t += d;
    const u = this.uniforms;
    const t = this.t;

    this.root.position.y = 0;
    u.uSwayAngle.value = 0;
    u.uNodAngle.value = 0;
    let tiltZ = 0, wobbleY = 0;

    switch (this.action) {
      case 'sway':
        u.uSwayAngle.value = Math.sin(t * 1.25) * 0.070;
        tiltZ  = Math.sin(t * 1.25) * 0.018;
        wobbleY = Math.sin(t * 0.8) * 0.05;
        this.root.position.y = Math.sin(t * 2.5) * 0.006;
        break;

      case 'nod':
        // 0 ~ 0.26 rad（约 0~15°）的规律点头；枢轴在颈部，肩膀基本不动
        u.uNodAngle.value = 0.26 * (0.5 - 0.5 * Math.cos(t * 3.4));
        u.uSwayAngle.value = Math.sin(t * 1.1) * 0.016;
        this.root.position.y = Math.sin(t * 2.2) * 0.004;
        break;

      case 'turnLeft':
      case 'turnRight':
        // 转身完全由 slerp 驱动；这里只叠一点呼吸，不加任何横向摆动，
        // 否则「转到哪停到哪」看起来会像还在晃。
        u.uSwayAngle.value = Math.sin(t * 1.4) * 0.010;
        this.root.position.y = Math.sin(t * 2.1) * 0.003;
        break;

      case 'idle':
      default:
        // 待机 = 很轻的呼吸起伏 + 极小幅度的点头（约 2°），不摆大动作
        u.uSwayAngle.value = Math.sin(t * 1.0) * 0.016;
        u.uNodAngle.value = 0.035 * (0.5 - 0.5 * Math.cos(t * 1.45));
        this.root.position.y = Math.sin(t * 1.6) * 0.0035;
        break;
    }

    this.applyPose(t, tiltZ, wobbleY);
  }

  /** 模型当前朝向的单位向量（物件空间 (0,0,1) 经四元数变换后）。 */
  forwardVector() {
    return this._fwd.set(0, 0, 1).applyQuaternion(this.root.quaternion);
  }

  state() {
    const u = this.uniforms;
    const f = this.forwardVector();
    return {
      action: this.action,
      sway: u.uSwayAngle.value,
      nod: u.uNodAngle.value,
      yaw: this.root.rotation.y,
      /** 相对世界 +Z 的实际朝向角（度）。正 = 脸转向画面右侧。 */
      facingDeg: +(Math.atan2(f.x, f.z) * 180 / Math.PI).toFixed(3),
      /** 该动作的目标朝向（度） */
      targetDeg: +(THREE.MathUtils.radToDeg(this.baseYaw + this.turnToYaw)).toFixed(3),
      /** 转身进度 0~1 */
      turnProgress: +smoothstep01((this.t - this.turnT0) / this.turnDur).toFixed(4),
      y: this.root.position.y,
      t: +this.t.toFixed(3),
      hasWave: false,
    };
  }

  dispose() {
    for (const o of this.patched) {
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (m) { m.__npcPatched = false; m.onBeforeCompile = () => {}; m.needsUpdate = true; }
      }
    }
    this.patched.length = 0;
  }
}

export { BEND_GLSL, ACTION_IDS, TARGET_YAW };
