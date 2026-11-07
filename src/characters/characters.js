/**
 * 小小赛车 V2 — NPC 角色数据 + 装配参数（第二阶段 · 动作修订版）
 *
 * 这个文件是纯数据，不引入 three.js、不解析资源路径、不加载任何东西，
 * 因此既能在游戏里用，也能被独立预览页原样复用。
 *
 * 模型本身不改动：几何、UV、材质、贴图全部保持第一阶段交付的原样。
 *
 * ── 动作修订说明 ──────────────────────────────────────────────
 * 挥手（wave）已**彻底移除**：上一版用整块手臂网格强行旋转来模拟挥手，
 * 实际观感诡异。连同 rig.arm 与顶点属性 aArmS 一并删除。
 * 后续要做挥手，必须先检查模型拓扑、关节分离与骨骼权重，单独制作并验收。
 *
 * 转身不再是「原地转一圈」：每个动作声明一个**目标朝向**，由四元数 slerp
 * 插值过去然后停住。左转 / 右转各 60°，都在用户要求的 45°～90° 区间内。
 * 相机上的 360° 查看（拖动 / 自动旋转）与角色动作完全分离，互不影响。
 *
 * rig 数值来源（不是拍脑袋估的）：在 three.js 里按物件空间做过实测 ——
 *   · 按顶点位置做并查集，得到真实连通壳体（爷爷 21 个 / 小红 35 个）
 *   · 头壳与躯干壳在 Y 方向互相嵌入，重叠区就是安全的旋转枢轴带
 * 详见 .npc/blender/armfit_note.md。
 *
 * 坐标系：Y 轴向上，足底 y=0，角色总高 1.8，正面朝 +Z。
 * 注意：角色面朝 +Z 时，角色自己的右手在 -X（right = forward × up）。
 */

/**
 * 动作列表：全部为免绑骨的轻量动画。
 * 动作只改变「角色自身」，不改变相机；360° 环绕查看由拖动 / 自动旋转负责。
 */
export const NPC_ACTIONS = Object.freeze([
  { id: 'idle', label: '站立', hint: '轻微呼吸与微点头' },
  { id: 'sway', label: '摆动', hint: '身体轻柔摆动' },
  { id: 'nod', label: '点头', hint: '轻轻点头' },
  { id: 'turnLeft', label: '左转', hint: '向左转 60° 后停住' },
  { id: 'turnRight', label: '右转', hint: '向右转 60° 后停住' },
]);

/** 转身动作的角度与时长（供预览页展示与测试断言使用）。 */
export const TURN_SPEC = Object.freeze({ degrees: 60, duration: 0.9 });

export const CHARACTERS = Object.freeze([
  Object.freeze({
    id: 'lighthouse-grandpa',
    name: '灯塔爷爷',
    nameEn: 'Lighthouse Grandpa',
    role: 'host',
    roleText: '海滨赛车节主持人 · 第一章',
    model: 'lighthouse-grandpa.glb',
    height: 1.8,
    yaw: 0,
    description: '白色头发与胡子、米白船长帽、深蓝外套、白蓝条纹内搭、红色领巾。',

    rig: {
      // 点头：头壳 y[1.032,1.800]，躯干壳顶 y=1.143 → 重叠区 1.032~1.143
      // 枢轴压到真实颈部 1.05（胡子下缘附近），衰减带跨过重叠区，肩膀几乎不动。
      nod: { pivot: [0, 1.05, 0.02], band: [0.94, 1.18] },
      // 身体摆动：绕腰部 y=0.78 微倾，衰减带跨过腰到肩
      sway: { pivotY: 0.78, band: [0.50, 1.00] },
      // 转身：整体刚体绕 Y 轴，四元数 slerp 到目标后停住
      turn: { degrees: TURN_SPEC.degrees, duration: TURN_SPEC.duration },
    },
  }),

  Object.freeze({
    id: 'flash-little-red',
    name: '闪电小红',
    nameEn: 'Flash Little Red',
    role: 'companion',
    roleText: '陪你一起比赛的小伙伴 · 第一章',
    model: 'flash-little-red.glb',
    height: 1.8,
    yaw: 0,
    description: '红白赛车头盔、黄色闪电、棕色短发、红色赛车外套、黄色小围巾。',

    rig: {
      // 脸壳 y[1.009,1.625]，头盔壳 y[1.182,1.800]，躯干壳顶 y=1.077 → 重叠 1.009~1.077
      nod: { pivot: [0, 1.02, 0.02], band: [0.90, 1.12] },
      // 大头小身，腰部偏低
      sway: { pivotY: 0.72, band: [0.45, 0.95] },
      turn: { degrees: TURN_SPEC.degrees, duration: TURN_SPEC.duration },
    },
  }),

  /* 主角 A（站姿）—— 第二阶段交付的 hero-a-standing.glb，纯几何 + 材质名，
   * 不重新生成、不重新贴图。剧情里和爷爷、小红三人同框时用。
   * 动作只有免绑骨的 idle/sway/nod/turn，和另外两位完全一致；没有挥手。
   * 站姿模型的顶点分布与坐姿不同，rig 枢轴按「1.8 高、足底 y=0、正面 +Z」
   * 重新估了一遍：头壳约在 1.55、颈部约 1.05、腰约 0.80。 */
  Object.freeze({
    id: 'hero-a',
    name: '主角 A',
    nameEn: 'Hero A',
    role: 'player',
    roleText: '本作主角 · 第二章',
    model: 'hero-a-standing.glb',
    height: 1.8,
    yaw: 0,
    description: '小小赛车的主角，黄色赛车服、蓝色头盔。',

    rig: {
      nod: { pivot: [0, 1.05, 0.02], band: [0.94, 1.20] },
      sway: { pivotY: 0.80, band: [0.50, 1.02] },
      turn: { degrees: TURN_SPEC.degrees, duration: TURN_SPEC.duration },
    },
  }),
]);

const BY_ID = new Map(CHARACTERS.map(c => [c.id, c]));
export const getCharacter = id => BY_ID.get(id) || null;
export const characterIds = () => CHARACTERS.map(c => c.id);
export const getAction = id => NPC_ACTIONS.find(a => a.id === id) || null;

export default CHARACTERS;
