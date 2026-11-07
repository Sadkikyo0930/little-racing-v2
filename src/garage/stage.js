import * as THREE from 'three';
import { buildKart, CHARACTERS, contactShadowTexture } from '../kart/model.js';

/* ------------------------------------------------------------------ *
 * 车库 3D 舞台 —— 独立场景，和剧情舞台同一套做法。
 *
 *   · 自己的 Scene / Camera / 灯光，通过 engine.useScene() 换过去，
 *     比赛场景一个对象都不动，随时可以切回来。
 *   · 车是真的 3D 模型：红车用原来的 buildKart()（同一个函数、同一份材质，
 *     所以车库和赛道上的车看起来一定是同一辆），海龟车用它的 GLB。
 *   · 主角 A 坐在车里 —— 和比赛里完全一样的位置，不另做一套姿势。
 *   · 主角 A / 海龟车两个模块都是**动态 import**，不进首屏。
 * ------------------------------------------------------------------ */

const FLOOR_Y = -0.3;

/** 展台与房间尺寸（世界单位，1 = 1 米）。 */
const STAGE = Object.freeze({
  plateR: 2.12,
  plateH: 0.26,
  ringR: 2.15,
  roomW: 30,
  roomH: 13,
  wallZ: -7.2,
});

export class GarageStage {
  constructor(engine) {
    this.engine = engine;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050d1e);
    this.scene.fog = new THREE.Fog(0x071229, 16, 34);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.turntable = new THREE.Group();          // 自转的展台 + 车
    this.root.add(this.turntable);
    this.carRoot = new THREE.Group();
    this.turntable.add(this.carRoot);

    this.currentId = null;
    this._seq = 0;
    this._t = 0;
    this.spin = 0.22;
    this._phase = 'idle';                        // idle | in
    this._phaseT = 0;
    /* 两台车各缓存一份：来回切换不重建几何，也不会误 dispose 模块级共享材质
     * （buildKart 里用了 MATS.chrome 这类模块常量）。 */
    this._cars = new Map();

    this._heroMod = null;
    this._turtleMod = null;
    this._motoMod = null;
    this._modelsReady = { hero: false, turtle: false, moto: false };

    this._focus = null;                          // {x,y,w,h} CSS px
    this._focusSmooth = new THREE.Vector2(0, 0);

    this._buildRoom();
    this._buildStage();
    this._buildLights();
    this.fit();                                  // 先按默认尺寸摆好相机，车上来再 fit 一次
  }

  /* --------------------------- 房间 --------------------------- */
  _buildRoom() {
    /* 地板：深蓝金属，靠点光打出反光 */
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(STAGE.roomW, STAGE.roomW),
      new THREE.MeshStandardMaterial({ color: 0x0d1a33, roughness: 0.42, metalness: 0.55 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y;
    floor.receiveShadow = true;
    this.root.add(floor);

    /* 后墙 + 两侧墙：蓝色渐变（着色器，不用贴图） */
    const wallMat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color(0x123a78) },
        uBot: { value: new THREE.Color(0x061027) },
        uGlow: { value: new THREE.Color(0x2a7fd4) },
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform vec3 uTop, uBot, uGlow;
        varying vec2 vUv;
        void main() {
          vec3 c = mix(uBot, uTop, smoothstep(0.0, 1.0, vUv.y));
          // 中间一团柔光，让墙不是一块平色
          float d = distance(vUv, vec2(0.5, 0.62));
          c += uGlow * smoothstep(0.55, 0.0, d) * 0.55;
          // 淡淡的横向接缝，像车库墙板
          float seam = smoothstep(0.006, 0.0, abs(fract(vUv.y * 7.0) - 0.5) - 0.492);
          c *= 1.0 - seam * 0.25;
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthWrite: true,
    });

    const back = new THREE.Mesh(new THREE.PlaneGeometry(STAGE.roomW, STAGE.roomH), wallMat);
    back.position.set(0, STAGE.roomH / 2 + FLOOR_Y, STAGE.wallZ);
    this.root.add(back);

    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(STAGE.roomW * 0.7, STAGE.roomH), wallMat.clone());
      side.position.set(s * STAGE.roomW * 0.34, STAGE.roomH / 2 + FLOOR_Y, STAGE.wallZ + 3.2);
      side.rotation.y = -s * Math.PI * 0.42;
      this.root.add(side);
    }

    /* 墙面灯带：自发光，交给 engine 的 bloom 去吃 */
    const neon = (color, w, h, x, y, z, ry = 0) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92 }),
      );
      m.position.set(x, y, z);
      m.rotation.y = ry;
      this.root.add(m);
      return m;
    };
    neon(0x39c6ff, 11.5, 0.09, 0, 4.35, STAGE.wallZ + 0.03);
    neon(0x1a72c8, 6.2, 0.05, -3.1, 3.55, STAGE.wallZ + 0.03);
    neon(0xffd23f, 2.4, 0.06, 4.6, 3.55, STAGE.wallZ + 0.03);

    /* 背景道具：货架 / 轮胎堆 / 工具箱，让墙前不是空的 */
    this._buildProps();
  }

  _buildProps() {
    const props = new THREE.Group();
    this.root.add(props);
    props.position.set(0, FLOOR_Y, STAGE.wallZ + 1.2);

    const metal = new THREE.MeshStandardMaterial({ color: 0x1c3358, roughness: 0.55, metalness: 0.6 });
    const box = (w, h, d, x, y, z, mat, ry = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      m.castShadow = true;
      m.receiveShadow = true;
      props.add(m);
      return m;
    };

    // 左侧两排货架
    for (let r = 0; r < 2; r++) {
      const y = 0.85 + r * 1.15;
      box(4.6, 0.12, 0.9, -6.4, y, 0, metal);
      for (let i = 0; i < 5; i++) {
        const c = [0x2b5ea8, 0x1f7a6a, 0x8a6a1f, 0x6a2f7a, 0x2f5f8a][i % 5];
        box(0.62, 0.5, 0.55, -8.4 + i * 0.82, y + 0.31, 0,
          new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, metalness: 0.15 }));
      }
    }

    // 右侧轮胎堆
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x141a24, roughness: 0.92, metalness: 0.05 });
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j <= i; j++) {
        const t = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.16, 10, 22), tyreMat);
        t.rotation.x = Math.PI / 2;
        t.position.set(5.4 + j * 1.0 - i * 0.5, 0.17 + i * 0.33, 0.2);
        t.castShadow = true;
        props.add(t);
      }
    }

    // 黄色工具箱
    box(1.25, 0.62, 0.72, 6.9, 0.31, 1.1,
      new THREE.MeshStandardMaterial({ color: 0xe0a021, roughness: 0.5, metalness: 0.35 }), -0.22);
    box(1.1, 0.12, 0.6, 6.9, 0.68, 1.1,
      new THREE.MeshStandardMaterial({ color: 0x1a2b46, roughness: 0.6, metalness: 0.4 }), -0.22);

    // 两根立柱，撑起空间感
    for (const s of [-1, 1]) {
      box(0.42, 7.5, 0.42, s * 9.6, 3.6, 0.4, metal);
    }
  }

  /* -------------------------- 展台 -------------------------- */
  _buildStage() {
    const plateMat = new THREE.MeshStandardMaterial({ color: 0x14305c, roughness: 0.28, metalness: 0.82 });
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x0b1c38, roughness: 0.5, metalness: 0.7 });

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(STAGE.plateR * 1.06, STAGE.plateR * 1.16, STAGE.plateH, 56, 1, false),
      baseMat,
    );
    base.position.y = FLOOR_Y + STAGE.plateH / 2;
    base.receiveShadow = true;
    this.turntable.add(base);

    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(STAGE.plateR, STAGE.plateR, 0.07, 56),
      plateMat,
    );
    plate.position.y = -0.03;
    plate.receiveShadow = true;
    this.turntable.add(plate);

    // 顶面一圈发光环（bloom 会亮起来）
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(STAGE.ringR, 0.035, 8, 72),
      new THREE.MeshBasicMaterial({ color: 0x6fe3ff }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.012;
    this.turntable.add(ring);
    this._ring = ring;

    // 底部光圈
    const under = new THREE.Mesh(
      new THREE.TorusGeometry(STAGE.plateR * 1.2, 0.05, 8, 72),
      new THREE.MeshBasicMaterial({ color: 0x2f9dff, transparent: true, opacity: 0.8 }),
    );
    under.rotation.x = Math.PI / 2;
    under.position.y = FLOOR_Y + 0.02;
    this.turntable.add(under);
    this._under = under;

    /* 台面上的刻度灯块：只有它们在转，转台才看得出在动 */
    this._marks = [];
    const markMat = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.75 });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.012, 0.055), markMat);
      m.position.set(Math.cos(a) * (STAGE.plateR - 0.16), 0.006, Math.sin(a) * (STAGE.plateR - 0.16));
      m.rotation.y = -a;
      this.turntable.add(m);
      this._marks.push(m);
    }

    /* 车下方的一圈接触阴影：即使模型自带 blob 也再垫一层，车不会"飘" */
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 4.6),
      new THREE.MeshBasicMaterial({
        map: contactShadowTexture(), transparent: true, depthWrite: false, opacity: 0.75,
      }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.004;
    pad.renderOrder = -1;
    this.turntable.add(pad);
  }

  /* -------------------------- 灯光 -------------------------- */
  _buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xbfe0ff, 0x0a1730, 0.55));

    const key = new THREE.DirectionalLight(0xffffff, 1.05);
    key.position.set(3.4, 7.5, 5.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -5;
    key.shadow.camera.right = 5;
    key.shadow.camera.top = 5;
    key.shadow.camera.bottom = -5;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 22;
    key.shadow.bias = -0.0012;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x66b8ff, 0.8);
    rim.position.set(-4.2, 3.2, -4.5);
    this.scene.add(rim);

    const fill = new THREE.PointLight(0xffc23f, 14, 16, 2);
    fill.position.set(4.6, 1.6, 1.8);
    this.scene.add(fill);
    this._fill = fill;

    const cool = new THREE.PointLight(0x2f7fff, 18, 18, 2);
    cool.position.set(-4.4, 2.4, 2.6);
    this.scene.add(cool);
    this._cool = cool;

    const top = new THREE.SpotLight(0xd9f0ff, 52, 16, 0.66, 0.6, 1.6);
    top.position.set(0, 6.6, 2.4);
    top.target.position.set(0, 0.4, 0);
    this.scene.add(top);
    this.scene.add(top.target);
  }

  /* --------------------------- 模型 --------------------------- */
  async ensureModels(which) {
    const jobs = [];
    if (which.includes('hero') && !this._modelsReady.hero) {
      jobs.push((async () => {
        try {
          const mod = await import('../kart/heroA.js');
          const proto = await mod.loadHeroA();
          if (proto) { this._heroMod = mod; this._modelsReady.hero = true; }
        } catch (err) {
          console.warn('[garage] 主角 A 加载失败：', err?.message || err);
        }
      })());
    }
    if (which.includes('turtle') && !this._modelsReady.turtle) {
      jobs.push((async () => {
        try {
          const mod = await import('../kart/turtleKart.js');
          const proto = await mod.loadTurtleKart();
          if (proto) { this._turtleMod = mod; this._modelsReady.turtle = true; }
        } catch (err) {
          console.warn('[garage] 海龟车加载失败：', err?.message || err);
        }
      })());
    }
    if (which.includes('moto') && !this._modelsReady.moto) {
      jobs.push((async () => {
        try {
          const mod = await import('../kart/motoKart.js');
          const proto = await mod.loadMotoKart();
          if (proto) { this._motoMod = mod; this._modelsReady.moto = true; }
        } catch (err) {
          console.warn('[garage] 闪电小摩托加载失败：', err?.message || err);
        }
      })());
    }
    await Promise.all(jobs);
  }

  /** 造一台展示用的车（不套 Kart，车库不需要物理）。 */
  _makeCar(id) {
    const heroDriver = (seat) => (this._heroMod ? this._heroMod.createHeroADriver(seat) : null);

    if (id === 'moto') {
      /* 闪电小摩托：骑乘版 GLB 里人和车是同一个文件的两个节点，
       * 所以这里不需要再塞一个主角 A —— 塞了就会变成两个骑手叠在一起。 */
      if (!this._motoMod) return { group: this._makePlaceholder(id), info: { placeholder: true } };
      const model = this._motoMod.createMotoModel();
      return model ? { group: model.group, info: { wheels: model.wheels.length } } : null;
    }

    if (id === 'turtle') {
      if (!this._turtleMod) return null;
      const driver = heroDriver(this._turtleMod.TURTLE_SEAT);
      const model = this._turtleMod.createTurtleModel(driver);
      return model ? { group: model.group, info: { wheels: model.wheels.length } } : null;
    }

    if (id === 'red') {
      // 红色赛车：和赛道上一模一样的 buildKart()
      const driver = heroDriver(undefined);
      const model = buildKart(CHARACTERS[1], 1, { driver });
      model.group.name = 'garageRedKart';
      return { group: model.group, info: { wheels: model.wheels.length } };
    }

    // 闪电小摩托 / 学习奖励车：模型缺失时的半透明剪影（不假装有车）
    return { group: this._makePlaceholder(id), info: { placeholder: true } };
  }

  /**
   * 占位剪影。
   *
   * 这两辆车只有卡片和解锁条件，模型还没做。这里给的是**明确写着"还没做好"的
   * 半透明线框蓝图**，不是一辆假装能开的车 —— 玩家一眼能看出它还在制作中。
   * 剪影按车型分开画（摩托是两个轮子 + 斜车架 + 车把，奖励车是带驾驶舱的小车），
   * 因为"一坨方块"读不出型，反而像渲染坏了。
   */
  _makePlaceholder(id) {
    const g = new THREE.Group();
    g.name = `garagePlaceholder_${id}`;
    const tint = id === 'scholar' ? 0x7b5cff : 0x1f6fe0;
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(tint).lerp(new THREE.Color(0x8fb4d8), 0.45),
      roughness: 0.55, metalness: 0.2,
      transparent: true, opacity: 0.3,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: 0x1b2740, roughness: 0.8, metalness: 0.2,
      transparent: true, opacity: 0.55,
    });

    const lineMat = new THREE.LineBasicMaterial({
      color: 0x9fd7ff, transparent: true, opacity: 0.95,
    });
    /* rot 必须一起传给线框 —— 先建线框再转头会让线框和实体错位。 */
    const part = (geo, m, x, y, z, rot = null, wire = true) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
      mesh.castShadow = true;
      g.add(mesh);
      if (wire) {
        // 叠加一层线框：一眼能看出这是「还没建模完的蓝图」，不是一辆真车
        const l = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), lineMat);
        l.position.copy(mesh.position);
        l.rotation.copy(mesh.rotation);
        g.add(l);
      }
      return mesh;
    };

    if (id === 'moto') {
      // 摩托车：两个轮子 + 斜向车架 + 油箱/座垫 + 车把 + 前叉
      for (const z of [0.86, -0.86]) {
        part(new THREE.CylinderGeometry(0.42, 0.42, 0.16, 18), dark, 0, 0.42, z, [0, 0, Math.PI / 2]);
      }
      part(new THREE.BoxGeometry(0.34, 0.26, 1.42), mat, 0, 0.62, 0, [-0.08, 0, 0]);   // 车架
      part(new THREE.BoxGeometry(0.44, 0.32, 0.72), mat, 0, 0.84, -0.16);              // 座垫 / 油箱
      part(new THREE.BoxGeometry(0.4, 0.28, 0.44), mat, 0, 0.76, 0.6, [-0.14, 0, 0]);   // 车头整流罩
      part(new THREE.BoxGeometry(0.92, 0.07, 0.09), dark, 0, 1.02, 0.48);              // 车把
      part(new THREE.BoxGeometry(0.08, 0.52, 0.08), dark, 0, 0.72, 0.76, [0.2, 0, 0]);  // 前叉
      part(new THREE.BoxGeometry(0.34, 0.08, 0.52), dark, 0, 1.06, -0.28);             // 儿童靠背
      /* 摩托的两个轮子是绕 X 轴的，正面看只剩两根细条，读不出"两轮车"。
       * 整个剪影先转一个 3/4 角，默认视角就能看到侧面轮廓（展台本来还在自转）。 */
      g.rotation.y = 0.62;
    } else {
      // 学习奖励车：小车轮廓 —— 车身 + 车头 + 高一点的驾驶舱 + 四个轮子
      part(new THREE.BoxGeometry(1.45, 0.34, 2.2), mat, 0, 0.42, 0);
      part(new THREE.BoxGeometry(1.15, 0.42, 1.0), mat, 0, 0.62, 1.1);
      part(new THREE.BoxGeometry(0.95, 0.5, 0.9), mat, 0, 0.78, -0.35);
      for (const [sx, sz, r] of [[-0.72, 1.02, 0.3], [0.72, 1.02, 0.3], [-0.78, -1.0, 0.36], [0.78, -1.0, 0.36]]) {
        part(new THREE.CylinderGeometry(r, r, 0.22, 16), dark, sx, r, sz, [0, 0, Math.PI / 2]);
      }
    }

    return g;
  }

  /**
   * 把某辆车放上展台。
   * @returns {Promise<boolean>} 成功与否（失败时 UI 会切到兜底样式）
   */
  async show(id) {
    const seq = ++this._seq;
    /* 按车型只加载必要的东西：摩托是人和车一整个文件，不需要再去下
     * hero-a-driving.glb（省 848 KB）；红车 / 海龟车才要主角 A。 */
    const need = id === 'moto' ? ['moto'] : id === 'turtle' ? ['hero', 'turtle'] : ['hero'];
    await this.ensureModels(need);
    if (seq !== this._seq) return false;

    let group = this._cars.get(id);
    if (!group) {
      const built = this._makeCar(id);
      if (!built) {
        console.warn('[garage] 无法展示车辆：', id);
        return false;
      }
      group = built.group;
      this._cars.set(id, group);
    }

    this.carRoot.clear();                        // 只摘下来，不 dispose（见 _cars）
    this.carRoot.add(group);
    this._car = group;
    this.currentId = id;
    this.spin = id === 'turtle' ? 0.26 : 0.22;

    // 弹入：从 0.86 倍放大到 1，同时轻微抬头
    this._phase = 'in';
    this._phaseT = 0;
    this.carRoot.scale.setScalar(0.86);
    this.carRoot.position.y = -0.12;

    this.fit();
    return true;
  }

  /* --------------------------- 相机 --------------------------- */
  /** UI 把 3D 展示区的 CSS 像素矩形传进来（右边有面板、下面有卡片，车要落在中间）。 */
  setFocusRect(rect) {
    if (!rect || !rect.w || !rect.h) return;
    this._focus = rect;
  }

  /** 根据当前车辆尺寸算相机距离，让车在展示区里大小合适。 */
  fit() {
    const aspect = Math.max(0.6, innerWidth / Math.max(1, innerHeight));
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();

    let worldW = 4.2, worldH = 1.9;
    if (this._car) {
      const box = new THREE.Box3().setFromObject(this._car);
      if (!box.isEmpty()) {
        const size = box.getSize(new THREE.Vector3());
        // 转台在转：用「长度 × 0.9 + 宽度 × 0.45」估个平均投影宽
        worldW = Math.max(1.6, size.z * 0.9 + size.x * 0.45);
        worldH = Math.max(1.0, size.y);
      }
    }

    const half = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const rect = this._focus || { w: innerWidth, h: innerHeight };
    const usableW = Math.max(120, rect.w);
    const usableH = Math.max(90, rect.h);

    /* 透视会把「靠近相机的车头」放大，所以留白系数要比几何计算更保守：
     * 0.66 / 0.76 是实测出来的 —— 车正好落在展示区中间，底边不压到底部卡片。 */
    const dW = (worldW * innerHeight) / (2 * usableW * 0.76 * half);
    const dH = (worldH * innerHeight) / (2 * usableH * 0.66 * half);
    const dist = Math.min(18, Math.max(4.6, Math.max(dW, dH)));

    this._camDist = dist;
    this._targetHome = new THREE.Vector3(0, worldH * 0.46, 0);
    this._camHome = new THREE.Vector3(0, worldH * 0.46 + dist * 0.17, dist);
    this._applyCamera(true);
  }

  _applyCamera(immediate = false) {
    if (!this._camHome) return;

    // 展示区在屏幕上的中心 → NDC（-1..1）
    let fx = 0, fy = 0;
    if (this._focus) {
      const cx = (this._focus.x + this._focus.w / 2) / innerWidth;
      const cy = (this._focus.y + this._focus.h / 2) / innerHeight;
      fx = cx * 2 - 1;
      fy = 1 - cy * 2;
    }
    if (immediate) this._focusSmooth.set(fx, fy);
    else this._focusSmooth.lerp(new THREE.Vector2(fx, fy), 0.18);

    const pos = this._camHome.clone();
    const tgt = this._targetHome.clone();
    const dist = pos.distanceTo(tgt);
    const halfH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * dist;
    const halfW = halfH * this.camera.aspect;
    const dx = -this._focusSmooth.x * halfW;
    const dy = -this._focusSmooth.y * halfH;
    pos.x += dx; pos.y += dy;
    tgt.x += dx; tgt.y += dy;

    this.camera.position.copy(pos);
    this.camera.lookAt(tgt);
    this.camera.updateMatrixWorld();
  }

  /* --------------------------- 每帧 --------------------------- */
  update(dt) {
    this._t += dt;

    // 展台自转（用户没在拖，转得慢一点更好看）
    this.turntable.rotation.y += dt * this.spin;

    // 切换动画
    if (this._phase === 'in') {
      this._phaseT += dt;
      const k = Math.min(1, this._phaseT / 0.42);
      const e = 1 - Math.pow(1 - k, 3);            // easeOutCubic
      const s = 0.86 + 0.14 * e;
      this.carRoot.scale.setScalar(s);
      this.carRoot.position.y = -0.12 * (1 - e);
      if (k >= 1) {
        this.carRoot.scale.setScalar(1);
        this.carRoot.position.y = 0;
        this._phase = 'idle';
      }
    }

    // 灯光呼吸
    const b = 0.5 + 0.5 * Math.sin(this._t * 1.1);
    if (this._ring) this._ring.material.color.setRGB(0.35 + b * 0.12, 0.82 + b * 0.1, 1.0);
    if (this._under) this._under.material.opacity = 0.55 + b * 0.3;
    if (this._fill) this._fill.intensity = 13 + b * 4;
    if (this._cool) this._cool.intensity = 17 + (1 - b) * 6;
    for (let i = 0; i < this._marks.length; i++) {
      const m = this._marks[i];
      m.material.opacity = 0.45 + 0.4 * Math.abs(Math.sin(this._t * 1.6 + i * 0.5));
    }

    this._applyCamera(false);
  }

  /** UI 尺寸变化（横竖屏切换）时调用。 */
  resize() {
    this.camera.aspect = innerWidth / Math.max(1, innerHeight);
    this.camera.updateProjectionMatrix();
    this.fit();
  }

  debug() {
    return {
      currentId: this.currentId,
      cameraDist: +(this._camDist || 0).toFixed(2),
      car: this._car ? {
        name: this._car.name,
        children: this._car.children.length,
        visible: this._car.visible,
      } : null,
      models: { ...this._modelsReady },
      focusRect: this._focus ? { ...this._focus } : null,
    };
  }

  dispose() {
    this.carRoot.clear();
    this._cars.clear();
    this._car = null;
    this.scene.traverse((o) => {
      if (o.userData?.sharedAsset) return;
      o.geometry?.dispose?.();
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) m?.dispose?.();
    });
  }
}
