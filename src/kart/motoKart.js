import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { contactShadowTexture } from './model.js';

/* ------------------------------------------------------------------ *
 * 闪电小摩托 —— 第三辆可选载具（第四阶段验收过的 hero-a-moto-riding.glb）。
 *
 * 这份 GLB 里**人和车是分开的节点**，层级原样保留：
 *
 *   lightning_moto
 *   ├── body_lean            ← 车身（含骑手）绕纵轴倾斜的支点
 *   │   ├── hero_a_riding    ← 主角 A（坐姿烘死的静态网格）
 *   │   ├── moto_body        ← 车壳 / 油箱 / 座椅
 *   │   └── steer_pivot      ← 前叉立管（局部 Z = 倾斜的转向轴）
 *   │       └── handlebar
 *   ├── wheel_f_pivot → wheel_f
 *   └── wheel_r_pivot → wheel_r
 *
 * 注意两件事：
 *
 *   1. **车轮不在 body_lean 下面**。摩托压弯时轮胎也要跟着倒，所以整个
 *      lightning_moto 会被套进一个我们自己的 lean 组（model.body）——
 *      三层节点名一个都没改，只是外面多包了一层。
 *   2. 车轮的枢轴是 pivot 节点本身（wheel_f 网格的原点不在轮心），
 *      所以自转必须转 pivot 的 X 轴，而不是转网格。转向（Y）和自转（X）
 *      在同一个节点上，Euler 顺序必须是 YXZ，否则高速时轮子会歪。
 *
 * 只有玩家真的拥有并选用这辆车时才会动态 import —— 不选就一个字节都不下载。
 * ------------------------------------------------------------------ */

const MODEL_URL = new URL('../assets/karts/moto-kart.glb', import.meta.url).href;

/** 车体量测（第四阶段导出的实际包围盒，单位米；给测试与镜头用）。 */
export const MOTO_METRICS = Object.freeze({
  length: 1.358,        // moto_body z −0.679 … 0.679
  width: 0.435,
  height: 0.778,        // 车壳最高点（不含人）
  riderTop: 1.633,      // 人物头顶 —— 追尾镜头必须能看到这一截
  seatTop: 0.578,
  wheelbase: 0.918,     // 两个轮心相距 0.918
  wheelRadius: 0.216,
  wheelRestY: 0.2195,   // 轮心离地高 = 半径，轮胎正好贴地
});

/** 髋关节在车体局部坐标里的位置（第四阶段 hipZ=0.7734 的实测值）。 */
const HIP = Object.freeze({ x: 0, y: 0.7734, z: -0.1593 });

/* ---- 调得很小心，动之前先看下面的注释 ---- */

/** 车把最大转角。握把到转向轴只有 0.26 m，8.5° 时握把位移 3.7 cm。 */
const STEER_MAX = THREE.MathUtils.degToRad(8.5);

/**
 * 人物跟转比例。人和车把是两个烘死的静态网格，车把一转，手套和握把之间
 * 必然出现相对位移。让骑手绕**自己的髋关节**（不是车头）转一点点：
 * 手部残差从 3.7 cm 降到 1.9 cm，看起来像上身跟着车把轻轻一带，
 * 而臀部完全不挪位、脚也不会离开脚踏。
 */
const RIDER_FOLLOW = 0.5;

/** 车身内倾：最大 17°，满倾速度取巡航速度的 86%。 */
const LEAN = Object.freeze({
  gain: 0.34,      // rad / 满舵
  max: 0.30,       // rad（≈17°）
  full: 0.86,      // 速度达到 speedCap×0.86 时到满倾
  lambda: 8.5,     // 回正 / 入弯的平滑
  drift: 1.2,      // 漂移时再压深一点
});

let proto = null;
let loading = null;
let lastError = null;
let stats = null;

export function motoKartInfo() {
  return { url: MODEL_URL, loaded: !!proto, loading: !!loading && !proto, error: lastError, stats };
}

/** 加载一次，之后每局 clone 外壳、共享几何与材质。失败不抛，返回 null。 */
export function loadMotoKart() {
  if (proto) return Promise.resolve(proto);
  if (loading) return loading;
  loading = new GLTFLoader()
    .loadAsync(MODEL_URL)
    .then((gltf) => {
      const root = gltf.scene;
      let meshes = 0;
      let tris = 0;
      root.traverse((o) => {
        if (!o.isMesh) return;
        meshes++;
        const idx = o.geometry.index;
        tris += (idx ? idx.count : o.geometry.attributes.position.count) / 3;
        o.castShadow = true;
        o.receiveShadow = false;
        // 几何/材质跨局共享：Kart.dispose() 靠这个标记跳过释放
        o.userData.sharedAsset = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!m) continue;
          // Blender 侧法线一致朝外，单面渲染省一半填充率
          m.side = THREE.FrontSide;
          m.shadowSide = THREE.FrontSide;
          if ('envMapIntensity' in m) m.envMapIntensity = 1.0;
        }
      });
      proto = root;
      stats = { meshes, tris: Math.round(tris) };
      return proto;
    })
    .catch((err) => {
      lastError = String(err?.message || err);
      console.warn('[motoKart] 闪电小摩托模型加载失败：', lastError);
      return null;
    })
    .finally(() => { loading = null; });
  return loading;
}

/* 复用同一个四元数，避免每帧 new */
const _q = new THREE.Quaternion();
const AXIS_Z = new THREE.Vector3(0, 0, 1);

/**
 * 造一台可以直接交给 Kart 的闪电小摩托。
 *
 * 返回字段和 model.js 的 buildKart() 同构（group / body / wheels / steering /
 * driver / flames / blob），另外多给几个**摩托车专用**的字段：
 *   · lean      —— 内倾参数（卡丁车是外倾，方向相反，不能共用一套）
 *   · steerMax  —— 前轮最大转角
 *   · wheelRadius / cam / visualHook
 * 这些字段全部是「有就用、没有就走原来的路」，红车和海龟车的代码没被改动。
 */
export function createMotoModel() {
  if (!proto) return null;

  const group = new THREE.Group();
  group.name = 'motoKart';

  /* lean 组 = 整车（含两个轮子）绕纵轴的倾斜支点，也就是 Kart 的 model.body。
   * 支点落在 y=0 的地面线上、x=0 的中轴线上 —— 这样压弯时轮胎接地点不动。 */
  const lean = new THREE.Group();
  lean.name = 'motoKartLean';
  group.add(lean);

  const root = proto.clone(true);
  root.name = 'lightning_moto';
  lean.add(root);

  const bodyLean = root.getObjectByName('body_lean');
  const heroNode = root.getObjectByName('hero_a_riding');
  const steerPivot = root.getObjectByName('steer_pivot');
  const wheelFPivot = root.getObjectByName('wheel_f_pivot');
  const wheelRPivot = root.getObjectByName('wheel_r_pivot');

  if (!bodyLean) console.warn('[motoKart] 缺少 body_lean 节点');
  if (!steerPivot) console.warn('[motoKart] 缺少 steer_pivot 节点');

  /* 人物：绕髋关节小幅跟转（见 RIDER_FOLLOW）。只加一层支点，节点名不动。 */
  let hipPivot = null;
  if (heroNode && heroNode.parent) {
    hipPivot = new THREE.Group();
    hipPivot.name = 'riderSteerPivot';
    hipPivot.position.set(HIP.x, HIP.y, HIP.z);
    heroNode.parent.add(hipPivot);
    hipPivot.add(heroNode);
    heroNode.position.set(-HIP.x, -HIP.y, -HIP.z);
  }

  /* 车把：记住静止朝向，每帧在它上面叠一个绕局部 Z（= 前叉轴）的转角。 */
  const steerBase = steerPivot ? steerPivot.quaternion.clone() : null;

  /* 车轮：pivot 既是转向节点也是自转节点。
   * YXZ 顺序保证「先转向、再绕转过来的轮轴自转」，高速时轮子不会歪。 */
  const wheels = [];
  for (const [pivot, steer] of [[wheelFPivot, true], [wheelRPivot, false]]) {
    if (!pivot) continue;
    pivot.rotation.order = 'YXZ';
    pivot.rotation.set(0, 0, 0);
    wheels.push({
      pivot,
      spin: pivot,                 // 网格原点不在轮心，自转必须转 pivot
      steer,
      restY: pivot.position.y,
      /* 悬挂行程对卡丁车是「车身起伏」，对摩托车就是「轮胎离开路面」：
       * 加速时 Kart 会让 4 条悬挂一起下沉 5 cm，两轮车照做就会陷进地里。
       * 直接关掉纵向行程，轮心永远在 restY，压弯的下沉由 body 抬升补掉。 */
      suspension: 0,
    });
  }
  if (wheels.length !== 2) console.warn('[motoKart] 车轮数量异常：', wheels.length);

  /* syncVisual 会往 model.steering 上写方向盘转角；摩托没有方向盘，
   * 给一个游离的空 group 让赋值落空，真正的车把转向在 visualHook 里做。 */
  const steering = new THREE.Group();
  steering.name = 'motoSteeringStub';

  /* 骑手已经烘在整车 GLB 里，不能再让 syncVisual 转 model.driver。 */
  const driverStub = new THREE.Group();
  driverStub.name = 'motoDriverStub';

  /* 尾焰：这辆车是隐藏式排气，找不到能对得上的出口，宁可不放，
   * 也不让一团火苗浮在半空。boosting 时仍有镜头拉远 / FOV / 抖动反馈。 */
  const flames = [];

  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(MOTO_METRICS.width * 2.0, MOTO_METRICS.length * 1.25),
    new THREE.MeshBasicMaterial({
      map: contactShadowTexture(), transparent: true, depthWrite: false, opacity: 0.85,
    })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.03;
  blob.renderOrder = -1;
  group.add(blob);

  const model = {
    group, body: lean, wheels, steering,
    driver: driverStub,
    flames,
    exhausts: [],
    blob,
    driverLean: 0,

    /* ---- 摩托车专用 ---- */
    lean: LEAN,
    steerMax: STEER_MAX,
    wheelRadius: MOTO_METRICS.wheelRadius,
    /* 两轮车重心低、车身短，追尾镜头必须比卡丁车近一截，
     * 否则在画面里只有一点点大、看不清头肩和两个轮子。 */
    cam: { dist: 3.1, height: 1.62, lookAhead: 4.6, lookY: 1.00, fov: 54 },
    /* 手机横屏专用：画面更矮、速度表在正中底部，要把车整体抬到表盘上面。
     * 实测 844×390：整车包围盒底边离表盘顶部还有 17px 余量，车占屏高 34%。 */
    camShort: { dist: 3.6, height: 1.70, lookAhead: 4.8, lookY: 0.05, fov: 60 },
    /* 摩托车不做「加速抬头 / 刹车点头」的整体俯仰：绕车身原点转 3° 就会让
     * 前轮离地、后轮陷进路面。压到 0.12 只剩几毫米，轮胎始终贴地。 */
    pitchScale: 0.12,
    metrics: MOTO_METRICS,

    /** 每帧（在 Kart.syncVisual 末尾）调用：车把转向 + 人物跟转。 */
    visualHook(kart) {
      const ang = kart.steerVisual * STEER_MAX;
      if (steerPivot && steerBase) {
        steerPivot.quaternion.copy(steerBase).multiply(_q.setFromAxisAngle(AXIS_Z, ang));
      }
      if (hipPivot) hipPivot.rotation.y = ang * RIDER_FOLLOW;
    },

    /** 只读：当前车把相对静止位的**带符号**转角（rad），给自动化测试用。
     * 车把的叠加旋转是绕局部 Z 的 `steerBase * qz(ang)`，所以
     * `steerBase⁻¹ * now` 就是 `qz(ang)` 本身，用 atan2 取回符号不会歧义
     * （之前用 acos(|w|) 只能拿到绝对值，左转右转看起来一模一样）。 */
    steerInfo() {
      if (!steerPivot || !steerBase) return { angle: 0, axis: [0, 0, 1] };
      const rel = steerBase.clone().invert().multiply(steerPivot.quaternion);
      if (rel.w < 0) { rel.x *= -1; rel.y *= -1; rel.z *= -1; rel.w *= -1; }
      const angle = 2 * Math.atan2(rel.z, rel.w);
      return { angle, axis: [rel.x, rel.y, rel.z] };
    },

    /** 只读：几个关键点的世界坐标，测试用它验「轮胎贴地 / 头肩可见」。 */
    probe() {
      const out = {};
      const wf = wheelFPivot, wr = wheelRPivot;
      /* 必须先把整棵子树的 matrixWorld 刷一遍：syncVisual 只改 rotation /
       * position，真正落进世界矩阵是渲染时的事。测试里读的时候如果只取出
       * pivot 的 getWorldPosition（自己会往上刷），而人物用 Box3 走的是
       * 「父节点的旧矩阵」，两套坐标就会差出好几米——曾经把头部投影到
       * 相机背后，误判成镜头没拍到人。 */
      group?.updateWorldMatrix(true, true);
      if (wf) out.wheelFront = wf.getWorldPosition(new THREE.Vector3()).toArray();
      if (wr) out.wheelRear = wr.getWorldPosition(new THREE.Vector3()).toArray();
      if (heroNode) {
        const b = new THREE.Box3().setFromObject(heroNode);
        out.riderMin = b.min.toArray();
        out.riderMax = b.max.toArray();
      }
      /* 整车（人 + 车 + 两个轮胎）的真实包围盒：判断「追尾镜头有没有把人
       * 或者轮胎切出画面」必须用它，只投影几个点会漏掉轮胎最低处。 */
      if (group) {
        const g = new THREE.Box3().setFromObject(group);
        out.groupMin = g.min.toArray();
        out.groupMax = g.max.toArray();
      }
      return out;
    },
  };

  return model;
}

/** 让 `body_lean` 这个节点能被测试直接拿到（确认层级没被克隆坏）。 */
export function motoNodeNames(group) {
  const names = [];
  group?.traverse?.((o) => { if (o.name) names.push(o.name); });
  return names;
}
