import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ch2Material } from './materials.js';

/* ==================================================================
 * 第二章 GLB 资产的加载与实例化。
 *
 * 为什么每个资产要按材质拆成 InstancedMesh：
 *   Blender 里一栋小屋是一个 mesh + 十个材质槽，导出后就是十个 primitive。
 *   游戏里同一款小屋要摆十几栋 —— 如果逐栋加进场景就是十几×十次 draw
 *   call。按材质合并成 InstancedMesh 后，一栋和十几栋都是十次。
 *
 * 为什么 InstancedMesh 必须标 noCollide：
 *   清障烘焙（world/clearance.js）是直接遍历 geometry 顶点乘 matrixWorld，
 *   它不认识 instanceMatrix —— 不标记的话，同一份几何会被当成「原点处
 *   有一堆墙」烤进碰撞网格，整条赛道会莫名其妙收窄。
 *
 * 加载失败不致命：返回 null，调用方退回程序化几何/直接跳过。
 * ================================================================== */

/** 本阶段实装的全部资产。名字与 public/assets/ch2/*.glb 一一对应。 */
export const CH2_ASSETS = [
  'house_blue', 'house_thatch', 'house_fishing',
  'rock_round', 'rock_dark', 'rock_shallow',
  'palm', 'palm_lod',
  'bridge_plank', 'bridge_plank_worn', 'bridge_post', 'bridge_rail',
  'bridge_brace', 'bridge_kerb', 'bridge_pier',
  'umbrella', 'lounger', 'crate', 'barrel', 'surfboard', 'sign',
  'flagpole', 'grandstand', 'start_gate', 'buoy', 'grass_tuft',
];

const KEEP = ['position', 'normal', 'uv'];

export class Ch2Lib {
  constructor() {
    this.protos = new Map();
    this.failed = [];
    this.tris = 0;
    this.bytes = 0;
    this.draws = 0;
  }

  get ready() { return this.protos.size; }

  /**
   * 并发加载全部资产。base 用文档基准 URL（document.baseURI），这样
   * GitHub Pages 的项目子路径和 vite dev 的根路径都能用同一份代码，
   * 测试版部署在独立的子路径下也不会指向正式版资源。
   */
  async load(base, names = CH2_ASSETS, onProgress = null) {
    const loader = new GLTFLoader();
    let done = 0;
    const tasks = names.map(async (name) => {
      const url = new URL(`assets/ch2/${name}.glb`, base).href;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        this.bytes += buf.byteLength;
        const gltf = await loader.parseAsync(buf, '');
        const proto = this._digest(name, gltf.scene);
        this.protos.set(name, proto);
        this.tris += proto.tris;
      } catch (err) {
        this.failed.push({ name, error: String(err && err.message || err) });
        console.warn(`[ch2] 资产加载失败 ${name}:`, err);
      } finally {
        done++;
        onProgress?.(done, names.length, name);
      }
    });
    await Promise.all(tasks);
    return this;
  }

  /** GLB 场景 → { parts:[{material, geometry}], box, tris } */
  _digest(name, scene) {
    scene.updateMatrixWorld(true);
    const byMat = new Map();
    let tris = 0;
    scene.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh) return;
      /* 一定要 clone：applyMatrix4 会改顶点，同一个 geometry 被多处引用时
       * 第二次就会把变换叠上去。GLB 里每个 primitive 各自独立，但谁也不能
       * 保证导出器永远这么做。 */
      const geo = o.geometry.clone();
      geo.applyMatrix4(o.matrixWorld);
      for (const key of Object.keys(geo.attributes)) {
        if (!KEEP.includes(key)) geo.deleteAttribute(key);
      }
      if (!geo.attributes.normal) geo.computeVertexNormals();
      const matName = o.material?.name || 'M_Wood';
      const arr = byMat.get(matName) || [];
      if (geo.index) tris += geo.index.count / 3;
      else tris += geo.attributes.position.count / 3;
      arr.push(geo);
      byMat.set(matName, arr);
    });

    const parts = [];
    for (const [material, geos] of byMat) {
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (!merged) continue;
      if (geos.length > 1) for (const g of geos) g.dispose();
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      parts.push({ material, geometry: merged });
    }
    const box = new THREE.Box3();
    for (const p of parts) box.union(p.geometry.boundingBox);
    return { name, parts, box, tris };
  }

  proto(name) { return this.protos.get(name) || null; }

  /**
   * 生成一组实例。
   * @param {string} name   资产名
   * @param {Array}  list   每个元素 { x,y,z, yaw, scale, tint, matrix }
   * @param {object} opts   { castShadow, receiveShadow, name }
   */
  instance(name, list, opts = {}) {
    const proto = this.protos.get(name);
    if (!proto || !list.length) return null;
    const group = new THREE.Group();
    group.name = `ch2:${name}`;

    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const ONE = new THREE.Vector3(1, 1, 1);

    for (const part of proto.parts) {
      const mat = ch2Material(part.material);
      const im = new THREE.InstancedMesh(part.geometry, mat, list.length);
      im.name = `${name}:${part.material}`;
      im.userData.noCollide = true;
      im.castShadow = opts.castShadow !== false;
      im.receiveShadow = opts.receiveShadow !== false;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (p.matrix) {
          m4.copy(p.matrix);
        } else {
          pos.set(p.x || 0, p.y || 0, p.z || 0);
          if (p.pitch || p.yaw || p.roll) {
            e.set(p.pitch || 0, p.yaw || 0, p.roll || 0, 'YXZ');
            q.setFromEuler(e);
          } else {
            q.identity();
          }
          if (typeof p.scale === 'number') scl.setScalar(p.scale);
          else if (p.scale) scl.copy(p.scale);
          else scl.copy(ONE);
          m4.compose(pos, q, scl);
        }
        im.setMatrixAt(i, m4);
        // setColorAt 首次调用会把整条实例色初始化成白色，所以只需写有色调的
        if (p.tint) im.setColorAt(i, p.tint);
      }
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      group.add(im);
      this.draws++;
    }
    return group;
  }

  /** 累计三角面（用于性能报告） */
  instanceTris(name, count) {
    const p = this.protos.get(name);
    return p ? p.tris * count : 0;
  }
}
