import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { adoquinTextures, grassTextures, murallaTextures, asphaltTextures } from './textures.js';
import { sandTextures, plankTextures, wetSandTextures, rockTexture } from './beachTextures.js';
import { COURSES } from './courses.js';
import { sectionRanges, assignSectionKinds } from './chapter2/sectionKinds.js';

/* ------------------------------------------------------------------ *
 * The road.
 *
 * A closed cubic spline built from a course description. The track is the
 * single source of truth for the game: geometry, collision, AI racing
 * line, camera framing and minimap all read from the same sample table.
 *
 * Course layouts live in courses.js.
 * ------------------------------------------------------------------ */

const CHECKPOINTS = 32;

export class Track {
  constructor(course = COURSES[0]) {
    this.course = course;
    const CONTROL = course.control;
    this.curve = new THREE.CatmullRomCurve3(
      CONTROL.map((c) => new THREE.Vector3(c[0], c[1], c[2])),
      true,
      'catmullrom',
      0.5
    );

    this.widthCurve = CONTROL.map((c) => c[3]);
    this.kindCurve = CONTROL.map((c) => c[4]);
    /* 海在哪一侧：只有第二章的赛道填了这一列，第一章不填 → 0，
     * 地形/道具读取它来决定沙滩朝哪边铺，第一章完全不受影响。 */
    this.seaCurve = CONTROL.map((c) => (c[5] ?? 0));
    this.control = CONTROL;
    // ~0.6 m between samples whatever the course length
    this.n = Math.max(1200, Math.round(this.curve.getLength() / 0.6 / 100) * 100);

    this._buildSamples();
    this._buildSections();
    this.group = new THREE.Group();
    this.group.name = 'track';
    this._buildRoad();
    // Meshes the clearance bake must treat as solid. The colonial course gets
    // its walls from the city art; the motorway carries its own.
    this.obstacles = new THREE.Group();
    this.obstacles.name = 'trackObstacles';
    if (course.borders === 'highway') this._buildHighwayBorders();
    else if (course.borders === 'beach') this._buildBeachBorders();
    else this._buildBorders();
    this.group.add(this.obstacles);
    this._buildCheckpoints();
  }

  /* ------------------------- sampling table ------------------------- */
  _buildSamples() {
    const n = this.n;
    this.pos = new Float32Array(n * 3);
    this.tan = new Float32Array(n * 3);
    this.right = new Float32Array(n * 3);
    this.up = new Float32Array(n * 3);
    this.width = new Float32Array(n);
    this.kind = new Uint8Array(n);
    this.sea = new Int8Array(n);
    /* AI 允许的横向可用系数：桥面只有 16 m 宽，7 个 AI 都按 0.72×半宽
     * 散开就会把彼此挤下桥，这一段收窄。第一章不填 → 全是默认值。 */
    this.aiWidth = new Float32Array(n).fill(0.72);
    this.bank = new Float32Array(n);
    this.curvature = new Float32Array(n);
    this.dist = new Float32Array(n + 1);

    const P = new THREE.Vector3();
    const T = new THREE.Vector3();
    const R = new THREE.Vector3();
    const U = new THREE.Vector3();
    const WORLD_UP = new THREE.Vector3(0, 1, 0);
    const prevT = new THREE.Vector3();

    const CONTROL = this.control;
    const cn = CONTROL.length;

    /* 两个插值器，按赛道选用，互不影响：
     *
     *   indexLerp（第一章沿用）：u*cn 直接当控制点下标用。控制点大致等距时
     *   误差不大，老城赛道就是这种情况，改它等于改第一章的手感，因此不动。
     *
     *   arcLerp（第二章）：先把控制点按**弧长**定位，再在弧长区间里插值。
     *   贝壳湾的 cp12→cp13 只有 24 m，cp0→cp1 有 70 m，按序号返回会把
     *   「渔村 207 m」算成「渔村 190 m、桥头 90 m」，和审计对不上。
     *   审计脚本与这里共用 sectionKinds.js，保证两边同一个答案。 */
    const indexLerp = (arr, u) => {
      const f = u * cn;
      const i0 = Math.floor(f) % cn;
      const i1 = (i0 + 1) % cn;
      const i2 = (i0 + 2) % cn;
      const im = (i0 - 1 + cn) % cn;
      const s = f - Math.floor(f);
      // Catmull-Rom on the scalar track so width changes are smooth
      const p0 = arr[im], p1 = arr[i0], p2 = arr[i1], p3 = arr[i2];
      const s2 = s * s, s3 = s2 * s;
      return 0.5 * ((2 * p1) + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2 + (-p0 + 3 * p1 - 3 * p2 + p3) * s3);
    };

    let controlU = null;
    let arcLerp = null;
    if (this.course.arcScalars) {
      const PER = 200;                 // 每个控制点区间 200 段，弧长误差 < 5 cm
      const cum = new Float64Array(cn + 1);
      const a = new THREE.Vector3(), b = new THREE.Vector3();
      let acc = 0;
      this.curve.getPoint(0, a);
      for (let i = 0; i < cn; i++) {
        for (let k = 1; k <= PER; k++) {
          this.curve.getPoint((i + k / PER) / cn, b);
          acc += a.distanceTo(b);
          a.copy(b);
        }
        cum[i + 1] = acc;
      }
      this._controlCum = cum;
      controlU = Array.from(cum, (d) => d / acc);
      this.controlU = controlU;
      arcLerp = (arr, u) => {
        let i0 = 0;
        while (i0 < cn - 1 && controlU[i0 + 1] <= u) i0++;
        const u0 = controlU[i0], u1 = controlU[i0 + 1] || 1;
        const s = u1 > u0 ? THREE.MathUtils.clamp((u - u0) / (u1 - u0), 0, 1) : 0;
        const s2 = s * s, s3 = s2 * s;
        const im = (i0 - 1 + cn) % cn, i2 = (i0 + 2) % cn;
        const p0 = arr[im], p1 = arr[i0 % cn], p2 = arr[(i0 + 1) % cn], p3 = arr[i2];
        return 0.5 * ((2 * p1) + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2 + (-p0 + 3 * p1 - 3 * p2 + p3) * s3);
      };
    }
    const lerpCtrl = arcLerp || indexLerp;

    // pass 1: position, tangent, curvature
    for (let i = 0; i < n; i++) {
      const u = i / n;
      this.curve.getPointAt(u, P);
      this.curve.getTangentAt(u, T);
      this.pos[i * 3] = P.x; this.pos[i * 3 + 1] = P.y; this.pos[i * 3 + 2] = P.z;
      this.tan[i * 3] = T.x; this.tan[i * 3 + 1] = T.y; this.tan[i * 3 + 2] = T.z;
      this.width[i] = lerpCtrl(this.widthCurve, u);
      /* 海侧是一个标识列（+1/-1/0），取最近的整数，不能插值成 0.4 */
      this.sea[i] = Math.sign(Math.round(lerpCtrl(this.seaCurve, u)));
      const kf = lerpCtrl(this.kindCurve, u);
      this.kind[i] = Math.round(THREE.MathUtils.clamp(kf, 0, 4));
    }

    this.length = this.curve.getLength();
    const segLen = this.length / n;
    for (let i = 0; i <= n; i++) this.dist[i] = i * segLen;

    // signed curvature (positive = the tangent's yaw increases) via tangent
    // rotation
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = this.tan[i * 3], az = this.tan[i * 3 + 2];
      const bx = this.tan[j * 3], bz = this.tan[j * 3 + 2];
      const cross = ax * bz - az * bx;
      this.curvature[i] = -cross / segLen;
    }
    // smooth curvature so banking doesn't jitter
    const smoothed = new Float32Array(n);
    const K = 26;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = -K; k <= K; k++) s += this.curvature[(i + k + n) % n];
      smoothed[i] = s / (2 * K + 1);
    }
    this.curvature = smoothed;

    // pass 2: banked frames
    for (let i = 0; i < n; i++) {
      T.set(this.tan[i * 3], this.tan[i * 3 + 1], this.tan[i * 3 + 2]);
      R.crossVectors(T, WORLD_UP).normalize();
      /* Banking has to stay proportional to how hard the corner actually
       * is. A high gain just pins every sample to the clamp, which reads as
       * a permanent cant that flips sign at each inflection rather than as
       * banking — and it leaves the karts looking tilted on straights. */
      const bank = THREE.MathUtils.clamp(this.curvature[i] * 9, -0.13, 0.13);
      this.bank[i] = bank;
      U.copy(WORLD_UP).applyAxisAngle(T, -bank).normalize();
      R.crossVectors(T, U).normalize();
      this.right[i * 3] = R.x; this.right[i * 3 + 1] = R.y; this.right[i * 3 + 2] = R.z;
      this.up[i * 3] = U.x; this.up[i * 3 + 1] = U.y; this.up[i * 3 + 2] = U.z;
    }
    prevT.set(0, 0, 0);

    // coarse spatial hash for global position lookup (respawn, item homing)
    this.cell = 24;
    this.hash = new Map();
    for (let i = 0; i < n; i++) {
      const key = this._key(this.pos[i * 3], this.pos[i * 3 + 2]);
      let b = this.hash.get(key);
      if (!b) this.hash.set(key, (b = []));
      b.push(i);
    }
  }

  /**
   * 分段落位 + 路面类型显式赋值。
   *
   * 只有声明了 `course.sections` 的赛道才走这条路（第二章）。第一章没有
   * sections，kind 仍然是控制点插值的结果 —— 老城赛道的路面类型原本就是
   * 一整段石板，没有边界可言，动它只会改变已经验收过的画面。
   */
  _buildSections() {
    const course = this.course;
    if (!course.sections) {
      this.sections = null;
      this.sectionOwner = null;
      this.sectionById = null;
      return;
    }
    const n = this.n;
    const { ranges } = sectionRanges(n, this.length, this._controlCum, course.sections);
    this.sections = ranges;
    this.sectionById = new Map(ranges.map((r) => [r.id, r]));

    /* 路面类型由分段显式写死。桥面必须这样来：如果让 kind 跟着控制点插值，
     * 渔村段（1,1,4,4,4）的标量曲线会过冲到 3，在 749 m 处凭空多出 35 m
     * 木板路，桥面板、AI 抓地力和「48 m」三处就对不上了。 */
    const { kind, owner } = assignSectionKinds(n, ranges);
    this.kind = kind;
    this.sectionOwner = owner;

    /* 桥面：AI 的横向可用宽度收到 0.5 倍半宽。16 m 的桥面塞 8 台车，
     * 每台车都想占 0.72×8 = 5.8 m 的横向余量，进桥口一定会互相顶下桥。 */
    for (const r of ranges) {
      if (r.kind !== 3) continue;
      const count = r.i1 >= r.i0 ? r.i1 - r.i0 : (n - r.i0) + r.i1;
      for (let k = 0; k < count; k++) this.aiWidth[(r.i0 + k) % n] = 0.5;
      this.bridgeRange = r;
    }
  }

  /** 该采样点的路面抓地系数（纵向速度乘子）。第一章没有表 → 1。 */
  gripAt(kind) {
    const g = this.course.surfaceGrips;
    return g && g[kind] ? g[kind] : null;
  }

  _key(x, z) {
    return `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
  }

  sampleAt(i) {
    const j = ((i % this.n) + this.n) % this.n;
    return j;
  }

  getPos(i, out = new THREE.Vector3()) {
    const j = this.sampleAt(i);
    return out.set(this.pos[j * 3], this.pos[j * 3 + 1], this.pos[j * 3 + 2]);
  }
  getRight(i, out = new THREE.Vector3()) {
    const j = this.sampleAt(i);
    return out.set(this.right[j * 3], this.right[j * 3 + 1], this.right[j * 3 + 2]);
  }
  getTangent(i, out = new THREE.Vector3()) {
    const j = this.sampleAt(i);
    return out.set(this.tan[j * 3], this.tan[j * 3 + 1], this.tan[j * 3 + 2]);
  }
  getUp(i, out = new THREE.Vector3()) {
    const j = this.sampleAt(i);
    return out.set(this.up[j * 3], this.up[j * 3 + 1], this.up[j * 3 + 2]);
  }

  /** World point on the centre line offset laterally by `lat` metres. */
  pointAt(i, lat, out = new THREE.Vector3()) {
    const j = this.sampleAt(i);
    out.set(
      this.pos[j * 3] + this.right[j * 3] * lat,
      this.pos[j * 3 + 1] + this.right[j * 3 + 1] * lat,
      this.pos[j * 3 + 2] + this.right[j * 3 + 2] * lat
    );
    return out;
  }

  /**
   * Locate a world position on the track.
   * `hint` is the previous sample index — the search stays local, which is
   * both fast and immune to the ambiguity of self-approaching sections.
   */
  locate(p, hint = -1) {
    let best = -1;
    let bestD = Infinity;
    const test = (i) => {
      const j = this.sampleAt(i);
      const dx = p.x - this.pos[j * 3];
      const dz = p.z - this.pos[j * 3 + 2];
      const dy = (p.y - this.pos[j * 3 + 1]) * 0.35;
      const d = dx * dx + dz * dz + dy * dy;
      if (d < bestD) { bestD = d; best = j; }
    };

    if (hint >= 0) {
      const span = 120;
      for (let k = -span; k <= span; k++) test(hint + k);
    } else {
      // global: consult the spatial hash, expanding rings if empty
      const cx = Math.floor(p.x / this.cell);
      const cz = Math.floor(p.z / this.cell);
      for (let ring = 0; ring < 12 && best < 0; ring++) {
        for (let a = -ring; a <= ring; a++) {
          for (let b = -ring; b <= ring; b++) {
            if (ring > 0 && Math.abs(a) !== ring && Math.abs(b) !== ring) continue;
            const bucket = this.hash.get(`${cx + a},${cz + b}`);
            if (bucket) for (const i of bucket) test(i);
          }
        }
      }
      if (best < 0) for (let i = 0; i < this.n; i += 4) test(i);
    }

    const j = best;
    const dx = p.x - this.pos[j * 3];
    const dy = p.y - this.pos[j * 3 + 1];
    const dz = p.z - this.pos[j * 3 + 2];
    const lat = dx * this.right[j * 3] + dy * this.right[j * 3 + 1] + dz * this.right[j * 3 + 2];
    const fwd = dx * this.tan[j * 3] + dy * this.tan[j * 3 + 1] + dz * this.tan[j * 3 + 2];
    const height = dx * this.up[j * 3] + dy * this.up[j * 3 + 1] + dz * this.up[j * 3 + 2];
    return { index: j, lat, fwd, height, width: this.width[j], kind: this.kind[j] };
  }

  /** Surface height (and normal) of the road under a world position. */
  surfaceAt(p, hint = -1) {
    const loc = this.locate(p, hint);
    const j = loc.index;
    // shoulders fall away from the road edge so leaving the track feels bad
    const over = Math.max(0, Math.abs(loc.lat) - loc.width);
    const drop = Math.min(over * 0.14, 2.2);
    // match the drainage crown baked into the road mesh
    const t = THREE.MathUtils.clamp((loc.lat / loc.width) * 0.5 + 0.5, 0, 1);
    const crown = over > 0 ? 0 : Math.cos(t * Math.PI - Math.PI / 2) * 0.14;
    const y =
      this.pos[j * 3 + 1] +
      this.right[j * 3 + 1] * loc.lat +
      this.tan[j * 3 + 1] * loc.fwd +
      crown -
      drop;
    return {
      y,
      normal: new THREE.Vector3(this.up[j * 3], this.up[j * 3 + 1], this.up[j * 3 + 2]),
      loc,
    };
  }

  progress(loc) {
    return (loc.index + 0.5) / this.n;
  }

  /* ---------------------------- geometry ---------------------------- */
  _buildRoad() {
    if (this.course.multiSurface) return this._buildRoadBySurface();
    const n = this.n;
    const LANES = 12; // cross-section resolution
    const asphalt = this.course.surface === 'asphalt';
    const verts = [];
    const norms = [];
    const uvs = [];
    const idx = [];

    const P = new THREE.Vector3(), R = new THREE.Vector3(), U = new THREE.Vector3();
    const step = 2; // build every other sample: still ~1.3 m segments
    const rows = Math.floor(n / step);

    for (let r = 0; r < rows; r++) {
      const i = r * step;
      this.getPos(i, P);
      this.getRight(i, R);
      this.getUp(i, U);
      const w = this.width[i];
      // Cobbles tile in world units; asphalt maps U across the full width
      // so the painted lane markings stay proportional to the carriageway.
      const v = this.dist[i] / (asphalt ? 26.0 : 7.0);
      for (let c = 0; c <= LANES; c++) {
        const t = c / LANES;
        const lat = (t * 2 - 1) * w;
        // gentle crown for drainage — reads beautifully under raking light
        const crown = Math.cos(t * Math.PI - Math.PI / 2) * 0.14;
        verts.push(
          P.x + R.x * lat + U.x * crown,
          P.y + R.y * lat + U.y * crown,
          P.z + R.z * lat + U.z * crown
        );
        norms.push(U.x, U.y, U.z);
        uvs.push(asphalt ? t : lat / 7.0, v);
      }
    }
    for (let r = 0; r < rows; r++) {
      const r2 = (r + 1) % rows;
      for (let c = 0; c < LANES; c++) {
        const a = r * (LANES + 1) + c;
        const b = a + 1;
        const cc = r2 * (LANES + 1) + c;
        const d = cc + 1;
        idx.push(a, cc, b, b, cc, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    ensureUpward(geo);
    geo.computeBoundingSphere();

    const tex = asphalt ? asphaltTextures(1024, 3) : adoquinTextures(1024);
    tex.map.repeat.set(1, 1);
    tex.normalMap.repeat.set(1, 1);
    tex.roughnessMap.repeat.set(1, 1);
    this.roadMat = new THREE.MeshStandardMaterial({
      map: tex.map,
      normalMap: tex.normalMap,
      roughnessMap: tex.roughnessMap,
      normalScale: new THREE.Vector2(asphalt ? 0.35 : 0.5, asphalt ? 0.35 : 0.5),
      roughness: 1.0,
      metalness: 0.0,
      envMapIntensity: asphalt ? 0.14 : 0.22,
    });
    // Asphalt must not wrap across the width or the edge line bleeds around
    // to the opposite shoulder.
    if (asphalt) {
      for (const m of [tex.map, tex.normalMap, tex.roughnessMap]) {
        m.wrapS = THREE.ClampToEdgeWrapping;
      }
    }
    // Specular aliasing killer: a 1024px cobble normal map tiled every 7 m
    // shimmers badly once it is more than a few car lengths away, because the
    // mip chain flattens the normals but not the highlight. Fade the normal
    // and drive roughness to 1 with distance so the street settles down.
    this.roadMat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader
        .replace(
          'mapN.xy *= normalScale;',
          'mapN.xy *= normalScale * ( 1.0 - 0.88 * smoothstep( 16.0, 85.0, length( vViewPosition ) ) );'
        )
        .replace(
          '#include <roughnessmap_fragment>',
          '#include <roughnessmap_fragment>\n\troughnessFactor = mix( roughnessFactor, 1.0, 0.7 * smoothstep( 25.0, 130.0, length( vViewPosition ) ) );'
        );
    };
    this.road = new THREE.Mesh(geo, this.roadMat);
    this.road.receiveShadow = true;
    this.road.name = 'road';
    this.group.add(this.road);

    // Ground apron: a wide skirt of terrain either side of the ribbon so the
    // world never ends abruptly at the kerb.
    this._buildApron();
  }

  /**
   * 第二章：一条赛道上跑五种路面。
   *
   * 不是给整条路换一张贴图 —— 沙滩、木栈道、木桥的质感差别必须肉眼可辨，
   * 而且桥面的木板要横向铺。所以按采样点的 kind 切成若干条带，每条带一个
   * 独立材质；相邻条带共用同一行顶点坐标，接缝处不会裂开。
   *
   * 顶点色只做两件事：沙地上的白色边线、两条压实车辙。木面不画边线。
   */
  _buildRoadBySurface() {
    const n = this.n;
    const LANES = 10;
    const step = 2;
    const rows = Math.floor(n / step);
    const P = new THREE.Vector3(), R = new THREE.Vector3(), U = new THREE.Vector3();

    /* 相邻同类行合成一条带 */
    const runs = [];
    for (let r = 0; r < rows; r++) {
      const k = this.kind[(r * step) % n];
      const last = runs[runs.length - 1];
      if (last && last.kind === k) last.to = r;
      else runs.push({ kind: k, from: r, to: r });
    }
    // 首尾同类 → 合并，否则起终点线上会出现一条缝
    if (runs.length > 1 && runs[0].kind === runs[runs.length - 1].kind) {
      runs[0].from = runs.pop().from;
    }

    const LINE = new THREE.Color('#f6ecd2');
    const mats = this._surfaceMaterials();
    this.surfaceMats = mats;

    /* 每个 kind 一个 Group，材质只建一次 */
    const groups = new Map();
    const push = (kind, geo) => {
      if (!groups.has(kind)) groups.set(kind, []);
      groups.get(kind).push(geo);
    };

    for (const run of runs) {
      if (run.to <= run.from) continue;
      const verts = [], uvs = [], cols = [], idx = [];
      const kind = run.kind;
      const isWood = kind === 3 || kind === 2;
      /* 一张贴图铺多少米。木板栈道（2）的贴图里是 10.7 块板，1.6 m 一张
       * → 一块板 0.15 m，才是真栈道的尺度。之前用 2.0 m，板宽 0.19 m 看着
       * 还行，但纹理里的年轮被拉成 2 m 宽的巨环，近看像一片胶合板。 */
      const uvScale = kind === 3 ? 2.2 : kind === 2 ? 1.6 : kind === 4 ? 5.5 : 7.0;

      for (let r = run.from; r <= run.to; r++) {
        const i = (r * step) % n;
        this.getPos(i, P); this.getRight(i, R); this.getUp(i, U);
        const w = this.width[i];
        for (let c = 0; c <= LANES; c++) {
          const t = c / LANES;
          const lat = (t * 2 - 1) * w;
          const crown = Math.cos(t * Math.PI - Math.PI / 2) * 0.11;
          verts.push(
            P.x + R.x * lat + U.x * crown,
            P.y + R.y * lat + U.y * crown,
            P.z + R.z * lat + U.z * crown
          );
          uvs.push(lat / uvScale, this.dist[i] / uvScale);

          /* 边线：沙地/沙丘/渔村土路画 0.45 m 宽的白线；木面不画 */
          const edge = Math.min(t, 1 - t);
          const line = isWood ? 0 : Math.max(0, 1 - edge / 0.03);
          /* 车辙：两条压在 t≈0.28 / 0.72 的暗带，越靠边越淡 */
          const rut = Math.exp(-(((Math.abs(t - 0.5) - 0.22) ** 2) / 0.0026)) * (1 - line) * 0.16;
          const c0 = 1 - rut;
          cols.push(
            THREE.MathUtils.lerp(c0 * 0.92, LINE.r, line),
            THREE.MathUtils.lerp(c0 * 0.9, LINE.g, line),
            THREE.MathUtils.lerp(c0 * 0.88, LINE.b, line)
          );
        }
      }
      for (let r = 0; r < run.to - run.from; r++) {
        for (let c = 0; c < LANES; c++) {
          const a = r * (LANES + 1) + c;
          const b = a + 1;
          const cc = (r + 1) * (LANES + 1) + c;
          const d = cc + 1;
          idx.push(a, b, cc, b, d, cc);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      push(kind, geo);
    }

    this.surfaceRuns = runs;
    for (const [kind, geos] of groups) {
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (!merged) continue;
      ensureUpward(merged);
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mats.get(kind));
      mesh.receiveShadow = true;
      mesh.name = `road-${kind}`;
      /* 桥面那一层现在是「看不见的托板」：真正的桥板是 Blender 模块逐块
       * 拼出来的（见 world/beach.js 的 _buildBridge），板缝里露出来的
       * 深色就是从这条带上透出来的。
       *
       * 必须压到 -0.45 而不是一个板厚：两块面只要在同一次深度比较里
       * 落到同一个值上就会互相抢（z-fighting），铺出来是一整块深一块
       * 浅一块的「拼布」，看着像桥板缺了一半。压深 0.45 m 之后托板只
       * 在板缝的 5 mm 上露一条深色，其余全被桥板挡住。 */
      if (kind === 3) {
        mesh.position.y = -0.45;
        mesh.receiveShadow = false;
      }
      this.group.add(mesh);
      if (!this.road) this.road = mesh;
      if (geos.length > 1) for (const g of geos) g.dispose();
    }

    this._buildApron();
  }

  /** 五种路面的材质表（懒建一次，两圈共用） */
  _surfaceMaterials() {
    /* color 是贴图的乘子。五种路面的贴图都是暖沙/木色，如果只靠贴图，
     * 沙地直道、沙丘和渔村土路在车速下几乎分不出来 —— 玩家读不出
     * 「我现在开在什么上面」。这里用色温把它们分开：沙地暖黄、沙丘更浅、
     * 渔村土路偏灰、木面偏红棕。 */
    const mk = (tex, { rough = 1, normalScale = 0.6, env = 0.35, color = 0xffffff } = {}) => new THREE.MeshStandardMaterial({
      color,
      map: tex.map,
      normalMap: tex.normalMap || null,
      roughnessMap: tex.roughnessMap || null,
      normalScale: new THREE.Vector2(normalScale, normalScale),
      roughness: rough,
      metalness: 0,
      vertexColors: true,
      envMapIntensity: env,
    });
    const sand = sandTextures(512);
    const dune = sandTextures(512, { base: '#d2b47e', dark: '#b09362', light: '#e9d3a6', seed: 23 });
    const wet = wetSandTextures(512);
    const board = plankTextures(512, { plank: 48, gap: 3, base: '#b08a55', seed: 41 });
    const deck = plankTextures(512, { plank: 40, gap: 4, base: '#8a5c33', dark: '#5d3b1e', seed: 53 });
    return new Map([
      [0, mk(sand, { normalScale: 0.75, env: 0.3, color: 0xf0d9ae })],
      [1, mk(dune, { normalScale: 0.7, env: 0.3, color: 0xfff0d2 })],
      [2, mk(board, { rough: 0.8, normalScale: 0.8, env: 0.28, color: 0xdcc09a })],
      // 3 = 桥面托板：真正的桥板是 GLB 模块，这条带只负责从板缝里透出来的深色
      [3, mk(deck, { rough: 0.95, normalScale: 0.4, env: 0.12, color: 0x4a3320 })],
      [4, mk(wet, { normalScale: 0.65, env: 0.35, color: 0xc6b49a })],
    ]);
  }

  _buildApron() {
    // 沙滩赛道的地面由 world/beach.js 的地形网格铺满，不再铺草地裙边
    if (this.course.scenery === 'beach') return;
    const n = this.n;
    const step = 4;
    const rows = Math.floor(n / step);
    const verts = [], uvs = [], idx = [];
    const P = new THREE.Vector3(), R = new THREE.Vector3(), U = new THREE.Vector3();
    // The motorway carries its own shoulder and barriers, so its grass
    // apron has to start beyond them rather than at the edge line.
    const OUT = this.course.borders === 'highway' ? [1.22, 1.6, 3.2, 7.0] : [1.0, 1.5, 3.2, 7.0];

    for (let r = 0; r < rows; r++) {
      const i = r * step;
      this.getPos(i, P); this.getRight(i, R); this.getUp(i, U);
      const w = this.width[i];
      for (let side = -1; side <= 1; side += 2) {
        for (let k = 0; k < OUT.length; k++) {
          const lat = side * w * OUT[k];
          const drop = k === 0 ? 0.05 : Math.min((Math.abs(lat) - w) * 0.14, 2.4) + 0.05;
          verts.push(
            P.x + R.x * lat - U.x * drop,
            P.y + R.y * lat - U.y * drop,
            P.z + R.z * lat - U.z * drop
          );
          uvs.push(lat / 12, this.dist[i] / 12);
        }
      }
    }
    const perRow = OUT.length * 2;
    for (let r = 0; r < rows; r++) {
      const r2 = (r + 1) % rows;
      for (let side = 0; side < 2; side++) {
        for (let k = 0; k < OUT.length - 1; k++) {
          const base = side * OUT.length + k;
          const a = r * perRow + base;
          const b = a + 1;
          const c = r2 * perRow + base;
          const d = c + 1;
          if (side === 0) idx.push(a, b, c, b, d, c);
          else idx.push(a, c, b, b, c, d);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    ensureUpward(geo);

    const g = grassTextures(512);
    g.map.repeat.set(1, 1);
    this.apronMat = new THREE.MeshStandardMaterial({
      map: g.map,
      normalMap: g.normalMap,
      roughness: 0.95,
      metalness: 0,
      envMapIntensity: 0.6,
    });
    this.apron = new THREE.Mesh(geo, this.apronMat);
    this.apron.receiveShadow = true;
    this.group.add(this.apron);
  }

  /**
   * Edge treatment: a legible red/white kerb everywhere, a raised stone
   * sidewalk, and a parapet wall only where the track is open to the sea
   * (in the streets the buildings themselves are the barrier).
   */
  _buildBorders() {
    const n = this.n;
    const step = 3;
    const rows = Math.floor(n / step);
    const P = new THREE.Vector3(), R = new THREE.Vector3(), U = new THREE.Vector3();
    const stoneTex = murallaTextures(1024);
    const stoneMat = new THREE.MeshStandardMaterial({
      map: stoneTex.map, normalMap: stoneTex.normalMap,
      roughness: 0.92, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.7,
    });

    /**
     * Build a closed ribbon between two lateral offsets at two heights.
     * `filter` may reject rows, in which case the ribbon is split into runs.
     */
    const ribbon = (side, aLat, aUp, bLat, bUp, material, uvScale, filter, cast) => {
      let run = [];
      const flush = () => {
        if (run.length < 2) { run = []; return; }
        const verts = [], uvs = [], idx = [];
        for (const i of run) {
          this.getPos(i, P); this.getRight(i, R); this.getUp(i, U);
          const w = this.width[i];
          const la = side * (w + aLat), lb = side * (w + bLat);
          verts.push(
            P.x + R.x * la + U.x * aUp, P.y + R.y * la + U.y * aUp, P.z + R.z * la + U.z * aUp,
            P.x + R.x * lb + U.x * bUp, P.y + R.y * lb + U.y * bUp, P.z + R.z * lb + U.z * bUp
          );
          const v = this.dist[i] / uvScale;
          uvs.push(0, v, 1, v);
        }
        const closed = run.length === rows;
        const last = closed ? run.length : run.length - 1;
        for (let r = 0; r < last; r++) {
          const r2 = (r + 1) % run.length;
          const a = r * 2, b = a + 1, c = r2 * 2, d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geo.setIndex(idx);
        if (Math.abs(aUp - bUp) < 0.5) ensureUpward(geo);
        else geo.computeVertexNormals();
        const mesh = new THREE.Mesh(geo, material);
        mesh.receiveShadow = true;
        mesh.castShadow = !!cast;
        this.group.add(mesh);
        run = [];
      };
      for (let r = 0; r < rows; r++) {
        const i = r * step;
        if (filter && !filter(i)) { flush(); continue; }
        run.push(i);
      }
      flush();
    };

    for (const side of [-1, 1]) {
      // painted kerb hugging the racing surface
      ribbon(side, 0, 0.02, 1.1, 0.17, kerbMaterial(), 2.6, null, false);
      // raised acera
      ribbon(side, 1.1, 0.17, 2.6, 0.2, stoneMat, 6.0, null, false);
      // curb face of the acera
      ribbon(side, 2.6, 0.2, 2.62, -0.15, stoneMat, 4.0, null, false);

      // seaward parapet: skip the street sections
      const open = (i) => this.kind[i] !== 0;
      const H = 1.45;
      ribbon(side, 2.6, 0.2, 2.6, 0.2 + H, stoneMat, 4.0, open, true);
      ribbon(side, 2.35, 0.2 + H, 2.9, 0.2 + H + 0.16, stoneMat, 3.0, open, true);
      ribbon(side, 2.9, 0.2 + H + 0.16, 2.92, 0.2 + H, stoneMat, 3.0, open, true);
    }
  }

  /**
   * 沙滩赛道的护栏：三种完全不同的东西，按段落换。
   *
   *   · 沙地/沙丘/渔村：距路面 2 m 的木桩 + 绳索护栏，高 0.5 m。
   *     它是软的边界 —— 撞上去有手感，但不会像石墙那样把人弹回来。
   *   · 桥头回旋：木栏杆，密度加大，提示「前面是桥」。
   *   · 木桥：栏杆贴着 16 m 桥面边缘，高 0.95 m，必须进 obstacles，
   *     否则清障烘焙不知道桥有边，AI 会把车开到河里。
   *
   * 全部用 sweep 生成的实体带，不做透明面片：清障烘焙读的是三角形，
   * 透明面片会让"看起来有栏杆、实际上能穿过去"。
   */
  _buildBeachBorders() {
    const n = this.n;
    const P = new THREE.Vector3(), R = new THREE.Vector3(), U = new THREE.Vector3();

    const woodMat = new THREE.MeshStandardMaterial({
      color: 0x8a6440, roughness: 0.86, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.4,
    });
    const railMat = new THREE.MeshStandardMaterial({
      color: 0x6d4b2c, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.4,
    });
    const ropeMat = new THREE.MeshStandardMaterial({
      color: 0xd8c9a8, roughness: 0.95, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.3,
    });
    this.borderMats = [woodMat, railMat, ropeMat];

    /**
     * 沿路缘扫一条带。`profile` 是 [横向偏移, 高度] 的折线，
     * `filter(i)` 决定哪些采样点参与（用于按段落切换护栏样式）。
     *
     * `hidden: true` 表示这条带只做碰撞，不参与渲染 —— 木桥的栏杆视觉
     * 由 Blender 模块拼出来（立柱 + 横梁，能看透），碰撞仍然用这条精确
     * 贴合弯道的实心墙。清障烘焙不看 visible，所以隐藏不影响碰撞。
     */
    const sweep = (side, profile, step, material, { filter = null, solid = false, uv = 3, hidden = false } = {}) => {
      const rows = Math.floor(n / step);
      const cols = profile.length;
      let run = [];
      const flush = () => {
        if (run.length < 2) { run = []; return; }
        const verts = [], uvs = [], idx = [];
        for (const i of run) {
          this.getPos(i, P); this.getRight(i, R); this.getUp(i, U);
          const w = this.width[i];
          for (const [dl, dh] of profile) {
            const lat = side * (w + dl);
            verts.push(
              P.x + R.x * lat + U.x * dh,
              P.y + R.y * lat + U.y * dh,
              P.z + R.z * lat + U.z * dh
            );
            uvs.push(dh / uv, this.dist[i] / uv);
          }
        }
        for (let r = 0; r < run.length - 1; r++) {
          for (let c = 0; c < cols - 1; c++) {
            const a = r * cols + c, b = a + 1;
            const cc = (r + 1) * cols + c, d = cc + 1;
            if (side > 0) idx.push(a, cc, b, b, cc, d);
            else idx.push(a, b, cc, b, d, cc);
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, material);
        mesh.receiveShadow = true;
        mesh.castShadow = solid && !hidden;
        if (hidden) mesh.visible = false;
        (solid ? this.obstacles : this.group).add(mesh);
        run = [];
      };
      for (let r = 0; r < rows; r++) {
        const i = r * step;
        if (filter && !filter(i)) { flush(); continue; }
        run.push(i);
      }
      flush();
    };

    const onBridge = (i) => this.kind[i] === 3;
    const offBridge = (i) => this.kind[i] !== 3;

    for (const side of [-1, 1]) {
      /* ---- 沙地：木桩 + 绳索，离开路面 2 m，高 0.5 m ---- */
      sweep(side, [[2.0, -0.1], [2.0, 0.5], [2.14, 0.5], [2.14, -0.1]], 3, woodMat,
        { filter: offBridge, solid: true });
      sweep(side, [[1.98, 0.44], [2.16, 0.44], [2.16, 0.56], [1.98, 0.56]], 3, ropeMat,
        { filter: offBridge, solid: true, uv: 2 });

      /* ---- 木桥：碰撞墙藏起来，看得见的栏杆是 Blender 模块。
       *
       * 保留这条墙的原因：它是唯一「按 0.06 m 采样、贴着 13% 横坡和弯道
       * 走向」长出来的连续面，清障烘焙靠它才能得到 w-1.27 的精确可行驶
       * 半宽。用一堆 2.4 m 直段模块去替代，弯道内侧会在接缝处漏出缝隙，
       * 车能从桥边掉下去。                     ---- */
      sweep(side, [[-0.12, 0.0], [-0.12, 0.95], [0.06, 0.95], [0.06, 0.0]], 2, railMat,
        { filter: onBridge, solid: true, hidden: true });
      sweep(side, [[-0.2, 0.95], [0.16, 0.95], [0.16, 1.08], [-0.2, 1.08]], 2, woodMat,
        { filter: onBridge, solid: true, uv: 2, hidden: true });
    }
  }

  /**
   * Motorway edges. Because the loop is generated by offsetting a corridor
   * to the right and returning down the other side, the median always ends
   * up on the driver's left on both carriageways — so the left edge gets a
   * concrete barrier and the right edge a guardrail, with no special cases.
   */
  _buildHighwayBorders() {
    const n = this.n;
    const P = new THREE.Vector3(), R = new THREE.Vector3(), U = new THREE.Vector3();

    /** Sweep a 2-D profile (lateral, height) along the road edge. */
    const sweep = (side, profile, step, material, uvScale, cast, solid) => {
      const rows = Math.floor(n / step);
      const verts = [], uvs = [], idx = [];
      const cols = profile.length;
      for (let r = 0; r < rows; r++) {
        const i = r * step;
        this.getPos(i, P); this.getRight(i, R); this.getUp(i, U);
        const w = this.width[i];
        for (const [dl, dh] of profile) {
          const lat = side * (w + dl);
          verts.push(
            P.x + R.x * lat + U.x * dh,
            P.y + R.y * lat + U.y * dh,
            P.z + R.z * lat + U.z * dh
          );
          uvs.push(dl / uvScale, this.dist[i] / uvScale);
        }
      }
      for (let r = 0; r < rows; r++) {
        const r2 = (r + 1) % rows;
        for (let c = 0; c < cols - 1; c++) {
          const a = r * cols + c, b = a + 1;
          const cc = r2 * cols + c, d = cc + 1;
          if (side > 0) idx.push(a, cc, b, b, cc, d);
          else idx.push(a, b, cc, b, d, cc);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, material);
      mesh.receiveShadow = true;
      mesh.castShadow = !!cast;
      (solid ? this.obstacles : this.group).add(mesh);
      return mesh;
    };

    const concrete = new THREE.MeshStandardMaterial({
      color: 0xb9b6ad, roughness: 0.93, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.5,
    });
    const steel = new THREE.MeshStandardMaterial({
      color: 0xa8adb4, roughness: 0.44, metalness: 0.82, side: THREE.DoubleSide, envMapIntensity: 1.1,
    });
    const shoulderMat = new THREE.MeshStandardMaterial({
      color: 0x3d3f45, roughness: 0.97, metalness: 0,
    });
    this.borderMats = [concrete, steel, shoulderMat];

    // paved shoulder just past the edge line, both sides
    for (const side of [-1, 1]) {
      sweep(side, [[0, 0.005], [1.6, -0.03]], 4, shoulderMat, 8, false);
    }

    /* Median: the New Jersey profile — a 250 mm vertical toe, a steep
     * 55° deflection face that lifts a tyre rather than catching it, then
     * the near-vertical upper wall. It starts past the paved shoulder, so
     * the drivable surface is the full carriageway plus a run-off strip. */
    sweep(-1, [
      [1.6, 0.0], [1.6, 0.25], [1.72, 0.58], [1.78, 1.06], [1.9, 1.12],
      [2.02, 1.06], [2.08, 0.58], [2.2, 0.25], [2.2, 0.0],
    ], 3, concrete, 3.2, true, true);

    // Shoulder side: W-beam guardrail on posts.
    sweep(1, [
      [1.7, 0.44], [1.62, 0.60], [1.7, 0.72], [1.62, 0.86], [1.7, 1.02],
    ], 3, steel, 2.4, true, true);

    const postGeo = new THREE.BoxGeometry(0.14, 0.95, 0.14);
    const posts = [];
    const spacing = Math.max(1, Math.round(3.8 / (this.length / n)));
    for (let i = 0; i < n; i += spacing) {
      this.getPos(i, P); this.getRight(i, R); this.getUp(i, U);
      const lat = this.width[i] + 1.72;
      const m = new THREE.Matrix4().makeTranslation(
        P.x + R.x * lat + U.x * 0.2,
        P.y + R.y * lat + U.y * 0.2,
        P.z + R.z * lat + U.z * 0.2
      );
      posts.push(postGeo.clone().applyMatrix4(m));
    }
    if (posts.length) {
      const merged = mergeGeometries(posts, false);
      for (const g of posts) g.dispose();
      if (merged) {
        const mesh = new THREE.Mesh(merged, steel);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.obstacles.add(mesh);
      }
    }
    postGeo.dispose();
  }

  _buildCheckpoints() {
    this.checkpoints = [];
    for (let c = 0; c < CHECKPOINTS; c++) {
      this.checkpoints.push(Math.floor((c / CHECKPOINTS) * this.n));
    }
    this.startIndex = 0;
  }

  /** Grid slot pose for racer `k` of `total`, staggered behind the line. */
  startPose(k) {
    const row = Math.floor(k / 2);
    const col = k % 2 === 0 ? -1 : 1;
    const back = 14 + row * 9;
    const i = this.sampleAt(this.n - Math.round(back / (this.length / this.n)));
    const p = this.pointAt(i, col * 4.2);
    const t = this.getTangent(i);
    return { position: p, forward: t, index: i };
  }
}

/**
 * Flip triangle winding if the surface ends up facing downward. Building
 * ribbons from an arbitrary spline frame makes the winding sign easy to get
 * wrong, so we just measure it and correct rather than reasoning about it.
 */
function ensureUpward(geo) {
  geo.computeVertexNormals();
  const nrm = geo.getAttribute('normal');
  let sum = 0;
  for (let i = 0; i < nrm.count; i++) sum += nrm.getY(i);
  if (sum < 0) {
    const idx = geo.getIndex();
    const arr = idx.array;
    for (let i = 0; i < arr.length; i += 3) {
      const t = arr[i + 1];
      arr[i + 1] = arr[i + 2];
      arr[i + 2] = t;
    }
    idx.needsUpdate = true;
    geo.computeVertexNormals();
  }
  return geo;
}

let _kerbMat = null;
function kerbMaterial() {
  if (_kerbMat) return _kerbMat;
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#f2f2ef'; ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#d8342c'; ctx.fillRect(0, 0, 64, 32);
  // slight grime so it isn't a flat vector graphic
  ctx.fillStyle = 'rgba(60,50,40,0.16)';
  for (let i = 0; i < 300; i++) {
    ctx.fillRect(Math.random() * 64, Math.random() * 64, Math.random() * 6, Math.random() * 3);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  _kerbMat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, metalness: 0.0 });
  return _kerbMat;
}
