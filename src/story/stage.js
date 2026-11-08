import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getCharacter } from '../characters/characters.js';
import { NpcAnimator } from '../characters/animator.js';
import { adoquinTextures, woodTextures } from '../world/textures.js';
import grandpaUrl from '../assets/characters/lighthouse-grandpa.glb?url';
import redUrl from '../assets/characters/flash-little-red.glb?url';
import heroAStandingUrl from '../assets/hero/hero-a-standing.glb?url';

/**
 * 剧情舞台 —— 一个**完全独立**的 3D 场景，专门用来演剧情。
 *
 * 为什么另建场景而不是挪到赛道旁边：
 *   · 任务要求「优先选择一个不会干扰比赛的区域，建立独立剧情展示场景」。
 *     建一个独立 scene、用同一个 renderer 渲染，是最彻底的隔离 ——
 *     比赛用的 scene / camera / 光照 / 阴影一张贴图都不会被碰到，
 *     剧情演完切回去，画面与进剧情之前逐像素一致。
 *   · 也避免了「把 NPC 放在赛道边上被 Kart 撞到 / 挡住 / 穿模」这类问题。
 *
 * 模型：直接读取第一阶段交付并已验收的两个 GLB（541,804 B / 563,916 B），
 * 不重新生成、不重新贴图、不改比例。加载是**按需**的 —— 这个模块只在玩家
 * 真正点了「故事冒险」之后才被动态 import，所以两个 GLB 永远不会拖慢首屏。
 *
 * 动作：复用 src/characters/animator.js 的免绑骨动画（站立 / 摆动 / 点头 /
 * 左转 / 右转）。没有挥手 —— 那个动作已按验收意见彻底删除。
 */

const MODEL_URLS = {
  'lighthouse-grandpa': grandpaUrl,
  'flash-little-red': redUrl,
  'hero-a': heroAStandingUrl,
};

/** 站位：三位角色分开站好，间隔 1.55 m，不会互相穿模。 */
const SLOTS = {
  'lighthouse-grandpa': { x: -1.55, z: 0.10, yaw: 11 },
  'flash-little-red': { x: 1.55, z: 0.10, yaw: -11 },
  // 主角 A 站正中，三人同框；yaw 朝 +Z（正对镜头）
  'hero-a': { x: 0, z: 0.10, yaw: 0 },
};

/**
 * 镜头表。pos/look 是世界坐标，fov 是竖直视场角。
 * 取景原则：人物面部稳定落在画面上半部，底部 23% 留给字幕条，
 * 所以字幕永远不会盖住脸。
 */
const SHOTS = {
  /* 登场：低机位远景，随后平滑推进到说话人 */
  entrance: { pos: [0, 0.42, 9.9], look: [0, 1.55, 0], fov: 36, dur: 1.4 },
  /* 双人中景：两个角色都在画面里，脚底刚好在字幕条上沿之上 */
  wide: { pos: [0, 1.02, 5.0], look: [0, 0.72, 0], fov: 31, dur: 1.0 },
  two: { pos: [0, 1.02, 5.25], look: [0, 0.74, 0], fov: 31, dur: 0.9 },
  'lighthouse-grandpa': { pos: [-0.62, 1.02, 4.62], look: [-1.58, 0.72, 0.06], fov: 31, dur: 1.15 },
  'flash-little-red': { pos: [0.62, 1.00, 4.62], look: [1.58, 0.70, 0.06], fov: 31, dur: 1.15 },
  /* 三人同框：主角 A 站正中，爷爷与小红分列两侧。比 two 更远、视角更宽，
   * 把 ±1.55 m 的三个人都框进画面，同时给中后方的奖杯台留一点空间。 */
  wide3: { pos: [0, 1.02, 6.6], look: [0, 0.72, -0.1], fov: 33, dur: 1.1 },
  /* 主角 A 单人近景（第二章不抢台词，但偶尔给一个正脸特写）。 */
  'hero-a': { pos: [0, 1.00, 5.2], look: [0, 0.95, 0.10], fov: 30, dur: 1.0 },
};

const SKY_GLSL = {
  vertex: /* glsl */ `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragment: /* glsl */ `
    varying vec3 vDir;
    void main() {
      float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
      vec3 low  = vec3(0.72, 0.72, 0.70);
      vec3 mid  = vec3(0.34, 0.56, 0.80);
      vec3 high = vec3(0.10, 0.27, 0.56);
      vec3 c = mix(low, mid, smoothstep(0.34, 0.54, h));
      c = mix(c, high, smoothstep(0.52, 0.98, h));
      // 海平线后面一小团暖光，给角色打一点轮廓，不要成第二个太阳
      float glow = pow(max(dot(vDir, normalize(vec3(0.10, 0.16, -1.0))), 0.0), 14.0);
      c += vec3(1.0, 0.82, 0.58) * glow * 0.30;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

function canvasTexture(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** 「海滨赛车节」横幅 —— 画成超长一条，镜头怎么切都像背景而不是被裁坏。 */
function bannerTexture() {
  const W = 1536, H = 210;
  return canvasTexture(W, H, (g, w, h) => {
    g.fillStyle = '#f6efe0';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#e0432c';
    g.fillRect(0, 0, w, 18);
    g.fillRect(0, h - 18, w, 18);
    for (let i = 0; i < 30; i++) {
      const x = (i / 30) * w + w / 60;
      g.fillStyle = i % 2 ? '#e0432c' : '#ffd23f';
      g.beginPath();
      g.moveTo(x - 17, 18); g.lineTo(x + 17, 18); g.lineTo(x, 44); g.closePath(); g.fill();
      g.beginPath();
      g.moveTo(x - 17, h - 18); g.lineTo(x + 17, h - 18); g.lineTo(x, h - 44); g.closePath(); g.fill();
    }
    g.font = '900 118px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#c0392b';
    g.fillText('海滨赛车节', w / 2 + 4, h / 2 + 8);
    g.fillStyle = '#10304f';
    g.fillText('海滨赛车节', w / 2, h / 2 + 4);
  });
}

export class StoryStage {
  constructor(engine) {
    this.engine = engine;
    this.renderer = engine.renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 220);
    this.scene.fog = new THREE.Fog(0xaecde3, 16, 62);

    this.actors = new Map();      // id -> { root, anim, slot }
    this.loaded = false;
    this.loadError = null;
    this.t = 0;

    /* 镜头插值状态 */
    this.from = this._shotState(SHOTS.entrance);
    this.to = this._shotState(SHOTS.entrance);
    this.k = 1;
    this.dur = SHOTS.entrance.dur;
    this.shotName = 'entrance';

    this._tmpV = new THREE.Vector3();
    this._disposables = [];

    this._buildSet();
    this._applyCamera(1);
  }

  /* ----------------------------- 布景 ----------------------------- */

  _buildSet() {
    const scene = this.scene;

    // 天空球（BackSide，跟着相机走也不会有视差问题，因为半径足够大）
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(110, 32, 20),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader: SKY_GLSL.vertex,
        fragmentShader: SKY_GLSL.fragment,
        fog: false,
      })
    );
    sky.frustumCulled = false;
    scene.add(sky);
    this.sky = sky;

    // 灯光：整体偏暖的白天，主光从前上方打，保证脸部亮
    const hemi = new THREE.HemisphereLight(0xdcefff, 0x8a7b64, 0.62);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff2d8, 1.28);
    key.position.set(4.6, 7.2, 6.0);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -6;
    key.shadow.camera.right = 6;
    key.shadow.camera.top = 6;
    key.shadow.camera.bottom = -6;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 22;
    key.shadow.bias = -0.0012;
    key.shadow.normalBias = 0.02;
    scene.add(key);
    this.key = key;

    const fill = new THREE.DirectionalLight(0xcfe6ff, 0.30);
    fill.position.set(-6, 3.4, 3.0);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffe6c0, 0.34);
    rim.position.set(-2.0, 3.0, -6.0);
    scene.add(rim);

    scene.add(new THREE.AmbientLight(0xffffff, 0.14));

    // 广场地面：圆形石板台，台面正好在 y = 0（角色足底也在这里）
    const stone = adoquinTextures(512);
    stone.map.wrapS = stone.map.wrapT = THREE.RepeatWrapping;
    stone.normalMap.wrapS = stone.normalMap.wrapT = THREE.RepeatWrapping;
    stone.roughnessMap.wrapS = stone.roughnessMap.wrapT = THREE.RepeatWrapping;
    for (const tex of [stone.map, stone.normalMap, stone.roughnessMap]) tex.repeat.set(7, 7);
    const plaza = new THREE.Mesh(
      new THREE.CylinderGeometry(6.6, 6.8, 0.5, 64, 1),
      new THREE.MeshStandardMaterial({
        map: stone.map,
        normalMap: stone.normalMap,
        roughnessMap: stone.roughnessMap,
        color: 0xffffff,
        roughness: 0.94,
        metalness: 0.0,
      })
    );
    plaza.position.y = -0.25;
    plaza.receiveShadow = true;
    scene.add(plaza);
    this.plaza = plaza;

    // 海
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(240, 170, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x1f6f96, roughness: 0.34, metalness: 0.05 })
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, -1.15, -46);
    scene.add(sea);

    // 海堤：挡住海面近边，也给画面一条横线
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xb8a98f, roughness: 0.92 });
    const wall = new THREE.Mesh(new THREE.BoxGeometry(15, 0.62, 0.42), wallMat);
    wall.position.set(0, 0.31, -4.85);
    wall.castShadow = true;
    wall.receiveShadow = true;
    scene.add(wall);

    // 横幅：两根木杆 + 一条画着「海滨赛车节」的布
    const wood = woodTextures('#6b4526', 256);
    const poleMat = new THREE.MeshStandardMaterial({ map: wood.map, roughness: 0.85 });
    for (const x of [-4.6, 4.6]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.10, 3.4, 10), poleMat);
      pole.position.set(x, 1.70, -4.35);
      pole.castShadow = true;
      scene.add(pole);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 9.5, 8), poleMat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, 3.06, -4.35);
    bar.castShadow = true;
    scene.add(bar);

    const bannerTex = bannerTexture();
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(7.4, 1.01, 1, 1),
      new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.88, side: THREE.DoubleSide })
    );
    banner.position.set(0, 2.30, -4.33);
    banner.castShadow = true;
    scene.add(banner);

    // 三角旗：让空旷的天空不那么空
    const flagGeo = new THREE.BufferGeometry();
    flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.16, 0, 0, 0.16, 0, 0, 0, -0.30, 0,
    ], 3));
    flagGeo.computeVertexNormals();
    const flagColors = [0xe0432c, 0xffd23f, 0x3aa3e0, 0x56c98a];
    const flagXs = [-4.45, -3.85, -3.25, -2.65, 2.65, 3.25, 3.85, 4.45];
    for (let i = 0; i < flagXs.length; i++) {
      const m = new THREE.Mesh(
        flagGeo,
        new THREE.MeshStandardMaterial({ color: flagColors[i % 4], side: THREE.DoubleSide, roughness: 0.9 })
      );
      m.position.set(flagXs[i], 3.02, -4.34);
      scene.add(m);
    }

    // 锥桶：赛车节的味道，摆在两侧，不挡人
    const coneOrange = new THREE.MeshStandardMaterial({ color: 0xef5a2a, roughness: 0.7 });
    const coneWhite = new THREE.MeshStandardMaterial({ color: 0xf6f1e6, roughness: 0.7 });
    for (const [x, z] of [[-3.05, 1.05], [3.05, 1.05], [-2.55, 2.15], [2.55, 2.15]]) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.20, 0.52, 14), coneOrange);
      cone.position.set(x, 0.26, z);
      cone.castShadow = true;
      scene.add(cone);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.155, 0.09, 14), coneWhite);
      band.position.set(x, 0.30, z);
      scene.add(band);
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.42), coneOrange);
      base.position.set(x, 0.025, z);
      scene.add(base);
    }

    // 木箱：左右各一个，坐一下画面的重量
    const crateMat = new THREE.MeshStandardMaterial({ map: wood.map, color: 0xc9a878, roughness: 0.9 });
    for (const [x, z, s] of [[-3.95, -0.85, 0.62], [3.95, -0.85, 0.56]]) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
      box.position.set(x, s / 2, z);
      box.rotation.y = x > 0 ? -0.22 : 0.18;
      box.castShadow = true;
      box.receiveShadow = true;
      scene.add(box);
    }

    // 地面软阴影贴片，补一点接触感（阴影贴图在手机上常常被裁）
    const softShadow = canvasTexture(256, 256, (g) => {
      const grd = g.createRadialGradient(128, 128, 8, 128, 128, 126);
      grd.addColorStop(0, 'rgba(24,42,60,0.40)');
      grd.addColorStop(0.55, 'rgba(24,42,60,0.14)');
      grd.addColorStop(1, 'rgba(24,42,60,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 256, 256);
    });
    const contactMat = new THREE.MeshBasicMaterial({
      map: softShadow, transparent: true, depthWrite: false,
    });
    for (const id of Object.keys(SLOTS)) {
      const s = SLOTS[id];
      const patch = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), contactMat);
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(s.x, 0.006, s.z + 0.03);
      patch.renderOrder = 1;
      /* 主角 A 默认不进场（第一章用不到），它的接触阴影也一起藏起来，
       * 等 setCast({heroA:true}) 再一起显示。 */
      if (id === 'hero-a') { patch.visible = false; this._heroPatch = patch; }
      scene.add(patch);
    }

    this._buildTrophy();
  }

  /* --------------------------- 奖杯道具 --------------------------- */
  /* 空奖杯台 / 找回的冠军奖杯 / 礁石微光 / 新地图 —— 全部程序化几何，
   * 默认隐藏，由 beat.stage.props 在第二章里按需显隐。第一章完全不碰它们，
   * 所以它们永远是藏着的，绝不会跑到第一章的画面里。 */
  _buildTrophy() {
    const scene = this.scene;

    // 奖杯台：方形底座 + 圆台，放中后方（z=-1.5），三人同框时正好在人物背后露出
    const pedestal = new THREE.Group();
    pedestal.position.set(0, 0, -1.5);
    const pedMat = new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 0.72, metalness: 0.04 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.18, 1.05), pedMat);
    base.position.y = 0.09; base.castShadow = true; base.receiveShadow = true;
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.78, 24), pedMat);
    column.position.y = 0.18 + 0.39; column.castShadow = true; column.receiveShadow = true;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.46, 0.1, 24), pedMat);
    top.position.y = 0.18 + 0.78 + 0.05; top.castShadow = true; top.receiveShadow = true;
    pedestal.add(base, column, top);
    pedestal.visible = false;
    scene.add(pedestal);
    this.pedestal = pedestal;

    // 冠军奖杯：底盘 + 细柱 + 杯身 + 双耳，金色
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.28, metalness: 0.72 });
    const trophy = new THREE.Group();
    const tBase = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.12, 20), goldMat);
    tBase.position.y = 0.06;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.5, 16), goldMat);
    stem.position.y = 0.12 + 0.25;
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.12, 0.46, 24, 1, true), goldMat);
    cup.position.y = 0.12 + 0.5 + 0.23;
    const cupBottom = new THREE.Mesh(new THREE.CircleGeometry(0.12, 24), goldMat);
    cupBottom.rotation.x = -Math.PI / 2; cupBottom.position.y = 0.12 + 0.5;
    for (const sgn of [-1, 1]) {
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.028, 10, 20, Math.PI), goldMat);
      handle.position.set(sgn * 0.30, 0.12 + 0.5 + 0.18, 0);
      handle.rotation.z = sgn * Math.PI / 2;
      trophy.add(handle);
    }
    // 杯身上一颗小星（呼应「掉下来的小星星」）
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0), goldMat);
    star.position.set(0, 0.12 + 0.5 + 0.12, 0.34);
    trophy.add(tBase, stem, cup, cupBottom, star);
    trophy.position.set(0, 1.06, -1.5);   // 落在奖杯台顶面上
    trophy.castShadow = true;
    trophy.visible = false;
    scene.add(trophy);
    this.trophy = trophy;

    // 礁石微光：礁石上卡着「亮亮的小星星」+ 小船痕迹的意象，用小发光体表现
    const glint = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.17, 0),
      new THREE.MeshStandardMaterial({ color: 0xfff3b0, emissive: 0xffe066, emissiveIntensity: 1.3, roughness: 0.4 })
    );
    glint.position.set(2.7, 0.62, -2.1);
    glint.visible = false;
    scene.add(glint);
    this.glint = glint;

    // 新地图：奖杯底座上刻着的一张小地图（为第三章埋伏笔）
    const mapCanvas = document.createElement('canvas');
    mapCanvas.width = 256; mapCanvas.height = 192;
    const mg = mapCanvas.getContext('2d');
    mg.fillStyle = '#efe2bf'; mg.fillRect(0, 0, 256, 192);
    mg.strokeStyle = '#7a5a2a'; mg.lineWidth = 6;
    mg.strokeRect(8, 8, 240, 176);
    mg.strokeStyle = '#c0392b'; mg.lineWidth = 5; mg.beginPath();
    mg.moveTo(40, 150); mg.bezierCurveTo(90, 80, 150, 150, 210, 60); mg.stroke();
    mg.fillStyle = '#c0392b'; mg.font = 'bold 30px sans-serif'; mg.fillText('X', 204, 58);
    mg.fillStyle = '#1f6f96'; mg.beginPath(); mg.arc(40, 150, 9, 0, Math.PI * 2); mg.fill();
    const mapTex = new THREE.CanvasTexture(mapCanvas);
    mapTex.colorSpace = THREE.SRGBColorSpace;
    const mapCard = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.375),
      new THREE.MeshBasicMaterial({ map: mapTex, transparent: true, side: THREE.DoubleSide })
    );
    mapCard.rotation.x = -Math.PI / 2.2;
    mapCard.position.set(0, 1.07, -1.5);
    mapCard.visible = false;
    scene.add(mapCard);
    this.mapCard = mapCard;
  }

  /* --------------------------- 载入模型 --------------------------- */

  /**
   * 载入两个 GLB。失败时抛出，由上层决定「字幕剧情回退」。
   * @param {(msg:string)=>void} [onStatus]
   */
  /**
   * 加载本章需要的角色模型。
   * @param {string[]} [charIds] 角色 id 列表；缺省按第一章（爷爷 + 小红）。
   *   第二章《阳光沙滩大冒险》会传入 [...,'hero-a']，只多加载主角 A 站姿，
   *   第一章完全不碰这 677KB 的 GLB，首屏与第一章加载时间零回归。
   * @param {(msg:string)=>void} [onStatus]
   */
  async load(charIds, onStatus) {
    if (this.loaded) return this.actors;
    const loader = new GLTFLoader();
    const ids = (charIds && charIds.length)
      ? charIds
      : ['lighthouse-grandpa', 'flash-little-red'];
    this._loadedIds = ids;

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const c = getCharacter(id);
      const url = MODEL_URLS[id];
      if (!c || !url) throw new Error(`缺少角色数据或模型地址: ${id}`);
      onStatus?.(c.name);
      const gltf = await loader.loadAsync(url);
      this._addActor(c, gltf.scene);
    }
    this.loaded = true;
    return this.actors;
  }

  _addActor(char, model) {
    const slot = SLOTS[char.id];

    // 归一化：GLB 本来就是 Y-up、足底 y=0、总高 1.8，这里只是兜底校正，
    // 正常情况 scale 会算成 1、offset 会算成 0。
    const box = new THREE.Box3().setFromObject(model);
    const h = Math.max(1e-4, box.max.y - box.min.y);
    const scale = THREE.MathUtils.clamp(1.8 / h, 0.8, 1.25);
    model.scale.multiplyScalar(scale);
    model.position.y = -box.min.y * scale;
    model.position.x = 0;
    model.position.z = 0;

    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = false;
      o.frustumCulled = false;      // 顶点着色器会动，别让包围盒把它剔掉
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        m.roughness = Math.min(1, (m.roughness ?? 1) * 0.98);
        if (m.map) m.map.anisotropy = 4;
      }
    });

    const root = new THREE.Group();       // 站位容器
    root.position.set(slot.x, 0, slot.z);
    const animRoot = new THREE.Group();   // 动画根（animator 只碰这个）
    animRoot.add(model);
    root.add(animRoot);
    this.scene.add(root);
    /* 主角 A 默认不进场（第一章用不到）。setCast({heroA:true}) 再显示。
     * 显隐只动 root，模型本身一直加载好，切章零延迟。 */
    if (char.id === 'hero-a') root.visible = false;

    const anim = new NpcAnimator(animRoot, {
      ...char.rig,
      // 剧情里用 45° 的「侧身看向同伴」：比 60° 更适合对话镜头，
      // 依然在用户要求的 45°～90° 区间内，且到位即停不转圈。
      turn: { ...char.rig.turn, degrees: 45, duration: 0.95 },
      __yawDeg: slot.yaw,
    });
    anim.setAction('idle');

    this.actors.set(char.id, { root, animRoot, anim, slot, char, model });
    return this.actors.get(char.id);
  }

  /* ----------------------------- 镜头 ----------------------------- */

  _shotState(s) {
    return {
      pos: new THREE.Vector3().fromArray(s.pos),
      look: new THREE.Vector3().fromArray(s.look),
      fov: s.fov,
    };
  }

  /** 平滑切到这个镜头。instant=true 时瞬切（进场首帧用）。 */
  setShot(name, instant = false) {
    const s = SHOTS[name];
    if (!s) return false;
    const target = this._shotState(s);
    if (instant) {
      this.from = target;
      this.to = target;
      this.k = 1;
      this._applyCamera(1);
      this.shotName = name;
      return true;
    }
    if (this.shotName === name && this.k >= 1) return true;
    // 起点取「此刻实际机位」，所以连续切换镜头也不会跳
    this.from = {
      pos: this.camera.position.clone(),
      look: this._currentLook(),
      fov: this.camera.fov,
    };
    this.to = target;
    this.k = 0;
    this.dur = s.dur || 0.85;
    this.shotName = name;
    return true;
  }

  _currentLook() {
    return this._look.clone();
  }

  _applyCamera(k) {
    const e = k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k);   // smoothstep
    const pos = this._tmpV.copy(this.from.pos).lerp(this.to.pos, e);
    this.camera.position.copy(pos);
    this._look = this._look || new THREE.Vector3();
    this._look.copy(this.from.look).lerp(this.to.look, e);
    this.camera.fov = this.from.fov + (this.to.fov - this.from.fov) * e;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this._look);
  }

  /* ----------------------------- 动作 ----------------------------- */

  setAction(id, action) {
    const a = this.actors.get(id);
    if (!a) return false;
    return a.anim.setAction(action);
  }

  /** 说话的人靠近景，另一个人回到站立。 */
  speaker(id) {
    if (this.actors.has(id)) this.setShot(id);
    for (const [key, a] of this.actors) {
      if (key !== id) a.anim.setAction('idle');
    }
    return true;
  }

  /** 两个角色都回到站立（开场 / 结尾的合影镜头）。 */
  rest() {
    for (const a of this.actors.values()) if (a.root.visible) a.anim.setAction('idle');
  }

  /**
   * 进每一段剧情前把舞台状态回到「干净」：主角 A 退场、奖杯/微光/地图全收起。
   * 舞台实例是跨剧情缓存的，不重置会让上一章的道具残留到下一章。
   */
  reset() {
    this.setCast({ heroA: false });
    this.setTrophy('none');
    this.setGlint(false);
    this.setMap(false);
  }

  /* --------------- 第二章专用：演员 / 道具显隐 --------------- */

  /**
   * 控制主角 A 是否进场。第二章三人同框时开 true；第一章、纯字幕兜底时关 false。
   * 显隐只动 root（及其接触阴影），模型一直加载好，切章零延迟。
   */
  setCast({ heroA = null } = {}) {
    if (heroA === null) return;
    const a = this.actors.get('hero-a');
    if (a) a.root.visible = heroA;
    if (this._heroPatch) this._heroPatch.visible = heroA;
  }

  /** 'empty' 空奖杯台 | 'found' 找回的奖杯 | 'none' 隐藏 */
  setTrophy(mode) {
    if (mode === 'none') {
      if (this.pedestal) this.pedestal.visible = false;
      if (this.trophy) this.trophy.visible = false;
    } else if (mode === 'empty') {
      if (this.pedestal) this.pedestal.visible = true;
      if (this.trophy) this.trophy.visible = false;
    } else if (mode === 'found') {
      if (this.pedestal) this.pedestal.visible = true;
      if (this.trophy) this.trophy.visible = true;
    }
  }

  /** 礁石微光（线索段）。 */
  setGlint(on) { if (this.glint) this.glint.visible = !!on; }

  /** 奖杯底座上的新地图（为第三章埋伏笔）。 */
  setMap(on) { if (this.mapCard) this.mapCard.visible = !!on; }

  /** 导演按 beat.stage.props 一并应用。 */
  applyProps(props) {
    if (!props) return;
    if (props.trophy !== undefined) this.setTrophy(props.trophy);
    if (props.glint !== undefined) this.setGlint(props.glint);
    if (props.map !== undefined) this.setMap(props.map);
  }

  /** 给某个演员单独下一个动作（如主角 A 点头），不动镜头、不影响说话人。 */
  actorAction(id, action) {
    const a = this.actors.get(id);
    if (!a) return false;
    return a.anim.setAction(action);
  }

  /* ----------------------------- 每帧 ----------------------------- */

  update(dt) {
    const d = Math.min(Math.max(dt || 0, 0), 0.1);
    this.t += d;

    if (this.k < 1) {
      this.k = Math.min(1, this.k + d / Math.max(0.001, this.dur));
      this._applyCamera(this.k);
    } else {
      // 停下来之后只留极轻的呼吸，避免画面完全凝固
      const drift = Math.sin(this.t * 0.55) * 0.012;
      this.camera.position.x = this.to.pos.x + drift;
      this.camera.position.y = this.to.pos.y + Math.sin(this.t * 0.42 + 1.1) * 0.008;
      this.camera.lookAt(this._look);
    }

    for (const a of this.actors.values()) {
      // 主角 A 不进场时（第一章）跳过它的动画，省一点计算
      if (a.root.visible) a.anim.update(d);
    }
    // 礁石微光缓慢自转，像在海风里闪
    if (this.glint && this.glint.visible) {
      this.glint.rotation.y += d * 1.1;
      this.glint.rotation.x += d * 0.5;
    }
    // 天空球永远套在相机上（半径 110，远大于任何位移，肉眼看不出）
    this.sky.position.copy(this.camera.position);
  }

  /* --------------------------- 给测试用 --------------------------- */

  /** 角色头顶在屏幕上的位置（CSS 像素），用来断言字幕不盖脸。 */
  headScreen(id) {
    const a = this.actors.get(id);
    if (!a) return null;
    const p = new THREE.Vector3(0, 1.55, 0);
    a.root.localToWorld(p);
    p.project(this.camera);
    const w = this.engine.canvas.clientWidth || innerWidth;
    const h = this.engine.canvas.clientHeight || innerHeight;
    return {
      x: (p.x * 0.5 + 0.5) * w,
      y: (-p.y * 0.5 + 0.5) * h,
      w, h,
    };
  }

  /**
   * 把角色**物件空间**里的一个点投到屏幕上（CSS 像素）。
   * 自动化测试靠它判断「脸朝哪边」「有没有被字幕挡住」，不靠肉眼看小图。
   */
  probe(id, x, y, z) {
    const a = this.actors.get(id);
    if (!a) return null;
    const p = new THREE.Vector3(x, y, z);
    a.animRoot.localToWorld(p);
    const world = p.clone();
    p.project(this.camera);
    const w = this.engine.canvas.clientWidth || innerWidth;
    const h = this.engine.canvas.clientHeight || innerHeight;
    return {
      x: (p.x * 0.5 + 0.5) * w,
      y: (-p.y * 0.5 + 0.5) * h,
      world: world.toArray(),
    };
  }

  /**
   * 角色正面与「指向相机的方向」的夹角余弦。
   * ≈1 正对镜头；0 完全侧脸；<0 观众看到的是后脑勺（这种必须改）。
   */
  faceDot(id) {
    const a = this.actors.get(id);
    if (!a) return null;
    const p = new THREE.Vector3();
    a.root.getWorldPosition(p);
    const toCam = this.camera.position.clone().sub(p).setY(0).normalize();
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(a.animRoot.getWorldQuaternion(new THREE.Quaternion()));
    fwd.y = 0;
    fwd.normalize();
    return +fwd.dot(toCam).toFixed(3);
  }

  /** 两个角色在世界里的包围盒（检测是否离地、是否互相穿模）。 */
  worldBounds() {
    const out = {};
    for (const [id, a] of this.actors) {
      const b = new THREE.Box3().setFromObject(a.root);
      out[id] = { min: b.min.toArray(), max: b.max.toArray() };
    }
    return out;
  }

  debug() {
    const actors = {};
    for (const [id, a] of this.actors) {
      actors[id] = {
        ...a.anim.state(),
        pos: a.root.position.toArray().map(v => +v.toFixed(3)),
        faceDot: this.faceDot(id),
        hasWave: false,
      };
    }
    return {
      loaded: this.loaded,
      loadError: this.loadError,
      shot: this.shotName,
      shots: Object.keys(SHOTS),
      camera: {
        pos: this.camera.position.toArray().map(v => +v.toFixed(3)),
        fov: +this.camera.fov.toFixed(2),
      },
      actors,
      props: {
        heroA: !!this.actors.get('hero-a')?.root.visible,
        pedestal: !!this.pedestal?.visible,
        trophy: !!this.trophy?.visible,
        glint: !!this.glint?.visible,
        map: !!this.mapCard?.visible,
      },
    };
  }

  dispose() {
    for (const a of this.actors.values()) {
      a.anim.dispose();
      a.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      this.scene.remove(a.root);
    }
    this.actors.clear();
    for (const d of this._disposables) d.dispose?.();
    this._disposables.length = 0;
  }
}

export { SHOTS, SLOTS };
export default StoryStage;
