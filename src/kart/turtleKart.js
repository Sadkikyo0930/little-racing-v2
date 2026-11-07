import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { contactShadowTexture } from './model.js';

/* ------------------------------------------------------------------ *
 * 海龟冲浪车 —— 第二辆可选赛车。
 *
 * 模型来自 Tripo 多视图 + Blender 精修，导出成 5 个网格：
 *   turtle_body（车壳，含方向盘）+ 4 个 wheel_*_pivot → wheel_*
 * 主角 A 不烘进这份 GLB，而是复用 heroA.js 的那一份（只下载一次）：
 * 座位参数在这里单独给，和红色赛车不同车不同座。
 *
 * 和 heroA.js 一样，只有玩家选了海龟车才动态 import —— 不选就一个字节
 * 都不下载，原有比赛、剧情、首屏完全不受影响。
 * ------------------------------------------------------------------ */

const MODEL_URL = new URL('../assets/karts/turtle-kart.glb', import.meta.url).href;

/** 主角 A 坐进海龟车的座位标定（blender 精修时实测得出，别随手改）。 */
export const TURTLE_SEAT = Object.freeze({
  y: 0.74,
  z: -0.05,
  scale: 1.05,
});

/**
 * 车体量测（导出时实测，供自动化测试和镜头调试读取）。
 * 长度 2.60 m 是阶段 1 定的目标尺寸，比原红车（3.92 m）短一截 ——
 * 想改成和红车一样大，把下面的 CLIP_SCALE 调大即可（等比，不改比例）。
 */
export const TURTLE_METRICS = Object.freeze({
  length: 2.6,
  width: 1.779,
  height: 1.439,
  wheelRestY: 0.3255,
  wheelbase: 1.261,
  track: 1.362,
});

/** 等比放大系数：1.0 = 保持阶段 2 验收时的尺寸。 */
const CLIP_SCALE = 1.0;

/** 尾部两个排气口（本车局部坐标，车头朝 +Z）。 */
const EXHAUSTS = [
  new THREE.Vector3(0.135, 0.185, -1.02),
  new THREE.Vector3(-0.135, 0.185, -1.02),
];

let proto = null;
let loading = null;
let lastError = null;
let stats = null;

export function turtleKartInfo() {
  return { url: MODEL_URL, loaded: !!proto, loading: !!loading && !proto, error: lastError, stats };
}

/** 加载一次，之后每局 clone 外壳、共享几何与材质。失败不抛，返回 null。 */
export function loadTurtleKart() {
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
          // 单面材质：Blender 侧已确认法线一致朝外，iPhone 省一半填充率
          m.side = THREE.FrontSide;
          m.shadowSide = THREE.FrontSide;
          // 导出时 metallic=0 / roughness=0.9 是哑光卡通质感，环境光别给太强
          if ('envMapIntensity' in m) m.envMapIntensity = 1.0;
        }
      });
      proto = root;
      stats = { meshes, tris: Math.round(tris), bytes: null };
      return proto;
    })
    .catch((err) => {
      lastError = String(err?.message || err);
      console.warn('[turtleKart] 海龟车模型加载失败：', lastError);
      return null;
    })
    .finally(() => { loading = null; });
  return loading;
}

/**
 * 造一台可以直接交给 Kart 的海龟车。
 *
 * 返回的对象字段和 model.js 的 buildKart() **完全同构**：
 *   { group, body, wheels, steering, driver, flames, exhausts, blob }
 * 所以 kart.js 的姿态 / 悬挂 / 车轮 / 尾焰代码一行都不用改。
 *
 * @param {THREE.Object3D|null} driver 主角 A 的 group（已在座位坐标系里摆好）
 */
export function createTurtleModel(driver) {
  if (!proto) return null;

  const group = new THREE.Group();
  group.name = 'turtleKart';
  const body = new THREE.Group();
  body.name = 'turtleKartBody';
  group.add(body);

  const model = proto.clone(true);
  model.name = 'turtleKartModel';
  model.scale.setScalar(CLIP_SCALE);
  body.add(model);

  /* 四个车轮：pivot 负责转向、mesh 负责自转，和红车的结构一致。
   * restY 用 pivot 原始高度，悬挂代码会在此基础上加减。 */
  const wheels = [];
  for (const key of ['fl', 'fr', 'rl', 'rr']) {
    const pivot = model.getObjectByName(`wheel_${key}_pivot`);
    const spin = model.getObjectByName(`wheel_${key}`);
    if (!pivot || !spin) {
      console.warn('[turtleKart] 缺少车轮节点 wheel_' + key);
      continue;
    }
    wheels.push({ pivot, spin, steer: key[0] === 'f', restY: pivot.position.y, key });
  }
  if (wheels.length !== 4) console.warn('[turtleKart] 车轮数量异常：', wheels.length);

  /* 方向盘是烘在车壳里的，转不了（手是烘在人物上的，转了反而会脱手）。
   * 这里给一个游离的空 group，让 syncVisual 的赋值落空而不是报错。 */
  const steering = new THREE.Group();
  steering.name = 'turtleSteeringStub';

  if (driver) body.add(driver);

  /* 尾焰：位置取车尾两个排气口，几何/材质配方照抄 model.js */
  const flames = [];
  for (const p of EXHAUSTS) {
    const f = new THREE.Mesh(
      new THREE.ConeGeometry(0.11, 0.52, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xff8a2a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    f.geometry.rotateX(Math.PI / 2);
    f.position.copy(p).add(new THREE.Vector3(0, 0, -0.24));
    body.add(f);
    flames.push(f);
  }

  /* 接地阴影：和红车共用同一张径向渐变贴图 */
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(TURTLE_METRICS.width * 1.45, TURTLE_METRICS.length * 1.2),
    new THREE.MeshBasicMaterial({
      map: contactShadowTexture(), transparent: true, depthWrite: false, opacity: 0.85,
    })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.03;
  blob.renderOrder = -1;
  group.add(blob);

  return {
    group, body, wheels, steering,
    driver: driver || new THREE.Group(),   // 没有主角时给个空 group，同步代码不炸
    flames,
    exhausts: EXHAUSTS.map((v) => v.clone().multiplyScalar(CLIP_SCALE)),
    blob,
    /* 主角在这台车上是烘死的主体的一部分，转向侧倾必须收敛：
     * 红车 1.0，这里 0.3 —— 手到轮缘只有 7 mm，倾太多会脱手。 */
    driverLean: 0.3,
    metrics: TURTLE_METRICS,
    clipScale: CLIP_SCALE,
  };
}
