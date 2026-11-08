import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/* ------------------------------------------------------------------ *
 * 主角 A（新版主角）— 驾驶坐姿模型。
 *
 * 模型来自 Tripo 多视图生成 + Blender 精修，坐姿是在同一份网格上摆好姿势
 * 后烘成静态网格导出的（GLB 里**没有骨架、没有蒙皮**），所以它在 iPhone
 * 上和原来的程序化驾驶员一样便宜：1 个 mesh、1 个材质、1 个 draw call。
 *
 * 这个模块只在玩家选了「新版主角 A」时才被动态 import —— 不选就一个字节
 * 都不下载，首屏和原有比赛完全不受影响。
 * ------------------------------------------------------------------ */

/** Vite 会把这个 URL 重写成带 hash 的静态资源路径（和音乐用同一套写法）。 */
const MODEL_URL = new URL('../assets/hero/hero-a-driving.glb', import.meta.url).href;

/** 座位标定：模型原点在髋关节，所以这里给的是「髋关节」在车体空间的位置。 */
export const SEAT = Object.freeze({
  y: 0.655,
  z: -0.045,
  scale: 1.0,
});

let proto = null;
let loading = null;
let lastError = null;
let stats = null;

export function heroAInfo() {
  return {
    url: MODEL_URL,
    loaded: !!proto,
    loading: !!loading && !proto,
    error: lastError,
    stats,
  };
}

/** 加载一次，之后所有 kart 共享同一份几何和材质。失败不抛，返回 null。 */
export function loadHeroA() {
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
        // 几何/材质跨局共享，Kart.dispose() 会跳过带这个标记的对象
        o.userData.sharedAsset = true;
        // 单面材质：Blender 侧已确认法线一致朝外，iPhone 省一半填充率
        const m = o.material;
        if (m) {
          m.side = THREE.FrontSide;
          m.shadowSide = THREE.FrontSide;
        }
      });
      proto = root;
      stats = { meshes, tris: Math.round(tris) };
      return proto;
    })
    .catch((err) => {
      lastError = String(err?.message || err);
      console.warn('[heroA] 驾驶模型加载失败：', lastError);
      return null;
    })
    .finally(() => { loading = null; });
  return loading;
}

/**
 * 造一个可以直接挂到 kart 上的驾驶员 group。
 * 模型已经烘好比例和朝向（Y-up、面朝 +Z、原点在髋关节），这里只摆位置。
 */
export function createHeroADriver(seat = SEAT) {
  if (!proto) return null;
  const g = new THREE.Group();
  g.name = 'heroA';
  const model = proto.clone(true);
  model.scale.setScalar(seat.scale ?? 1);
  g.add(model);
  g.position.set(0, seat.y, seat.z);
  return g;
}
