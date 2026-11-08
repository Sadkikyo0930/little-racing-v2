import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../world/textures.js';
import { quality } from '../core/device.js';

/* ------------------------------------------------------------------ *
 * Procedural kart + driver.
 * Built entirely from primitives with car-paint / rubber / chrome
 * materials so it holds up under the ACES + bloom pipeline.
 * ------------------------------------------------------------------ */

/* Collapses the direct mesh children of a group into one mesh per material.
 *
 * A kart is modelled as ~90 primitives, and with a full grid that was ~750
 * draw calls a frame — by far the heaviest thing in the scene and well past
 * what a phone GPU is happy with. Every group we merge here animates as a
 * rigid unit, and merging preserves the material instances, so the result is
 * pixel-identical.
 */
function mergeByMaterial(group, exclude = new Set()) {
  const buckets = new Map();
  for (const child of [...group.children]) {
    if (!child.isMesh || exclude.has(child) || !child.material || Array.isArray(child.material)) continue;
    const key = child.material.uuid;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(child);
  }

  for (const [, meshes] of buckets) {
    if (meshes.length < 2) continue;
    const geoms = [];
    let ok = true;
    for (const m of meshes) {
      m.updateMatrix();
      const g = m.geometry.clone().applyMatrix4(m.matrix);
      // mergeGeometries needs a matching attribute set across the batch.
      if (!g.attributes.uv) { ok = false; g.dispose(); break; }
      g.deleteAttribute('uv1');
      g.deleteAttribute('color');
      geoms.push(g);
    }
    if (!ok || geoms.length < 2) { geoms.forEach((g) => g.dispose()); continue; }

    // RoundedBoxGeometry is non-indexed while the primitives are indexed, and
    // mergeGeometries refuses to mix the two. Drop to non-indexed for the
    // whole batch when they disagree.
    if (geoms.some((g) => !g.index) && geoms.some((g) => g.index)) {
      for (let i = 0; i < geoms.length; i++) {
        if (geoms[i].index) { const n = geoms[i].toNonIndexed(); geoms[i].dispose(); geoms[i] = n; }
      }
    }

    const merged = mergeGeometries(geoms, false);
    geoms.forEach((g) => g.dispose());
    if (!merged) continue;

    const out = new THREE.Mesh(merged, meshes[0].material);
    out.castShadow = meshes.some((m) => m.castShadow);
    out.receiveShadow = meshes.some((m) => m.receiveShadow);
    for (const m of meshes) { group.remove(m); m.geometry.dispose(); }
    group.add(out);
  }
}

/* One 128px radial gradient shared by every kart instead of one each.
 * 海龟冲浪车（kart/turtleKart.js）也用这一张，别再各画一张。 */
let CONTACT_SHADOW_TEX = null;
export function contactShadowTexture() {
  if (CONTACT_SHADOW_TEX) return CONTACT_SHADOW_TEX;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.28)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  CONTACT_SHADOW_TEX = new THREE.CanvasTexture(cv);
  CONTACT_SHADOW_TEX.colorSpace = THREE.SRGBColorSpace;
  return CONTACT_SHADOW_TEX;
}

export const CHARACTERS = [
  {
    id: 'coqui', name: '勇敢小绿', tag: '均衡',
    body: 0x2fbf6a, accent: 0xf7f3e6, skin: 0x9fe06a, helmet: 0x1f8a4c,
    stats: { speed: 1.0, accel: 1.0, grip: 1.0, weight: 1.0 },
  },
  {
    id: 'vejigante', name: '闪电小红', tag: '力量',
    body: 0xd8342c, accent: 0xffc93c, skin: 0xb5563f, helmet: 0xff7a1a,
    stats: { speed: 1.06, accel: 0.9, grip: 0.94, weight: 1.22 },
  },
  {
    id: 'piraguero', name: '海风小蓝', tag: '加速',
    body: 0x2b7fd4, accent: 0xffffff, skin: 0xd8a271, helmet: 0xffd23f,
    stats: { speed: 0.95, accel: 1.14, grip: 1.05, weight: 0.86 },
  },
  {
    id: 'garita', name: '阳光小黄', tag: '抓地',
    body: 0xf2e3c4, accent: 0x8a7a5e, skin: 0xe0b98a, helmet: 0x6b7f9e,
    stats: { speed: 0.98, accel: 1.02, grip: 1.14, weight: 1.05 },
  },
  {
    id: 'flamboyan', name: '火焰小橙', tag: '速度',
    body: 0xff5a2b, accent: 0x2f6b3a, skin: 0xc98c5a, helmet: 0xd4262e,
    stats: { speed: 1.1, accel: 0.92, grip: 0.92, weight: 1.05 },
  },
  {
    id: 'salsero', name: '冠军小紫', tag: '漂移',
    body: 0x8e44d8, accent: 0xffd23f, skin: 0x8a5a3a, helmet: 0x24123f,
    stats: { speed: 1.0, accel: 1.0, grip: 1.08, weight: 0.95 },
  },
  {
    id: 'cafetero', name: '可可小棕', tag: '力量',
    body: 0x6b4226, accent: 0xe8d2a0, skin: 0xa06b45, helmet: 0x3a2416,
    stats: { speed: 1.04, accel: 0.94, grip: 1.0, weight: 1.16 },
  },
  {
    id: 'marejada', name: '浪花小靛', tag: '均衡',
    body: 0x14c3c9, accent: 0x0a3d62, skin: 0xe8c39e, helmet: 0x0a7c86,
    stats: { speed: 1.02, accel: 1.0, grip: 1.02, weight: 0.98 },
  },
];

/* Paints are cached by their full recipe. mergeByMaterial() buckets on
 * material.uuid, so two identical-looking paints built by separate calls used
 * to stay two unmergeable meshes — the accent colour alone cost every kart an
 * extra draw call. */
const paintCache = new Map();

function carPaint(color, { metalness = 0.35, roughness = 0.24, clearcoat = true } = {}) {
  const key = `${color}|${metalness}|${roughness}|${clearcoat}`;
  let m = paintCache.get(key);
  if (m) return m;
  m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    metalness,
    roughness,
    clearcoat: clearcoat ? 1.0 : 0,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.35,
    sheen: 0.25,
    sheenColor: new THREE.Color(0xffffff),
  });
  paintCache.set(key, m);
  return m;
}

const MATS = {
  rubber: new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.92, metalness: 0.0 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xd8dde3, roughness: 0.12, metalness: 1.0, envMapIntensity: 1.8 }),
  darkMetal: new THREE.MeshStandardMaterial({ color: 0x2a2e35, roughness: 0.42, metalness: 0.85 }),
  glass: new THREE.MeshPhysicalMaterial({
    color: 0x88aacc, transmission: 0.9, roughness: 0.05, metalness: 0,
    thickness: 0.4, transparent: true, opacity: 0.55, envMapIntensity: 2,
  }),
  glow: new THREE.MeshStandardMaterial({ color: 0xff5a1a, emissive: 0xff4400, emissiveIntensity: 3.0, roughness: 0.4 }),
  tread: new THREE.MeshStandardMaterial({ color: 0x0c0e11, roughness: 0.98 }),
};

const rimCache = new Map();
function rimMaterial(color) {
  let m = rimCache.get(color);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ color, roughness: 0.18, metalness: 0.95, envMapIntensity: 1.7 });
  rimCache.set(color, m);
  return m;
}

function tireGeometry(radius, width) {
  const g = new THREE.CylinderGeometry(radius, radius, width, 26, 1, false);
  g.rotateZ(Math.PI / 2);
  return g;
}

function buildWheel(radius, width, rimColor, simple = false) {
  const wheel = new THREE.Group();
  const rimMat = rimMaterial(rimColor);
  // The simplified wheel drops the sidewall bulges and the tread ring, and
  // paints the spokes in rim metal so the whole hub side merges into a single
  // mesh: 2 draw calls per wheel instead of 4, invisible at racing distance.
  const spokeMat = simple ? rimMat : MATS.chrome;

  const tire = new THREE.Mesh(tireGeometry(radius, width), MATS.rubber);
  tire.castShadow = true;
  wheel.add(tire);

  if (!simple) {
    // sidewall bulge for a fat slick look
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(
        new THREE.TorusGeometry(radius * 0.86, radius * 0.16, 10, 26),
        MATS.rubber
      );
      side.rotation.y = Math.PI / 2;
      side.position.x = (s * width) / 2;
      wheel.add(side);
    }

    // tread blocks
    const tread = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 1.012, radius * 1.012, width * 0.82, 26, 1, true),
      MATS.tread
    );
    tread.geometry.rotateZ(Math.PI / 2);
    wheel.add(tread);
  }

  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.58, radius * 0.58, width * 1.02, simple ? 14 : 20),
    rimMat
  );
  rim.geometry.rotateZ(Math.PI / 2);
  wheel.add(rim);

  // five spokes + hub
  for (let i = 0; i < 5; i++) {
    const spoke = new THREE.Mesh(
      new THREE.BoxGeometry(width * 1.06, radius * 0.9, radius * 0.14),
      spokeMat
    );
    spoke.rotation.x = (i / 5) * Math.PI * 2;
    wheel.add(spoke);
  }
  const hub = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.2, 12, 10), spokeMat);
  hub.scale.x = 1.6;
  wheel.add(hub);

  return wheel;
}

function buildDriver(cfg) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: cfg.skin, roughness: 0.62, metalness: 0 });
  const suit = carPaint(cfg.body, { metalness: 0.05, roughness: 0.6, clearcoat: false });
  const helmetMat = carPaint(cfg.helmet, { metalness: 0.25, roughness: 0.16 });

  // torso — leaning forward like a racer
  const torso = new THREE.Mesh(new RoundedBoxGeometry(0.52, 0.6, 0.4, 4, 0.14), suit);
  torso.position.set(0, 0.36, 0.02);
  torso.rotation.x = -0.16;
  torso.castShadow = true;
  g.add(torso);

  // shoulders
  for (const s of [-1, 1]) {
    const sh = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 12), suit);
    sh.position.set(s * 0.28, 0.55, 0.0);
    g.add(sh);
    // upper arm reaching to the wheel
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.34, 6, 12), suit);
    arm.position.set(s * 0.3, 0.42, 0.2);
    arm.rotation.set(-0.95, 0, s * 0.16);
    arm.castShadow = true;
    g.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), skin);
    hand.position.set(s * 0.26, 0.36, 0.44);
    g.add(hand);
    // legs tucked under the wheel
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.4, 6, 12), suit);
    leg.position.set(s * 0.16, 0.12, 0.42);
    leg.rotation.set(1.32, 0, 0);
    g.add(leg);
    const boot = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.13, 0.26, 3, 0.05), MATS.rubber);
    boot.position.set(s * 0.16, 0.06, 0.68);
    g.add(boot);
  }

  // neck + helmet
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.1, 10), skin);
  neck.position.set(0, 0.68, 0.0);
  g.add(neck);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.235, 24, 20), helmetMat);
  helmet.position.set(0, 0.86, -0.01);
  helmet.castShadow = true;
  g.add(helmet);

  // visor
  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.243, 24, 20, -0.9, 1.8, 1.0, 0.62),
    new THREE.MeshPhysicalMaterial({
      color: 0x1a2230, metalness: 1.0, roughness: 0.05,
      envMapIntensity: 2.4, iridescence: 0.8, iridescenceIOR: 1.6,
    })
  );
  visor.position.copy(helmet.position);
  visor.rotation.x = 0.1;
  g.add(visor);

  // stripe across the helmet crown
  const stripe = new THREE.Mesh(
    new THREE.TorusGeometry(0.236, 0.028, 8, 28, Math.PI),
    carPaint(cfg.accent, { metalness: 0.2, roughness: 0.3 })
  );
  stripe.position.copy(helmet.position);
  stripe.rotation.set(0, Math.PI / 2, -Math.PI / 2);
  g.add(stripe);

  return g;
}

/**
 * Build a complete kart. Returns { group, wheels, driver, steering, ... }
 *
 * `opts.driver` 可以换掉程序化驾驶员（新版主角 A 就是这样接进来的）。
 * 外部驾驶员自带位置、自带材质，因此不参与程序化部件的合批：它本来就是
 * 一个 mesh，合了也没得合，硬合反而会动到它自己的材质。
 */
export function buildKart(cfg, seed = 1, opts = {}) {
  const rnd = mulberry32(seed);
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const paint = carPaint(cfg.body);
  const accent = carPaint(cfg.accent, { metalness: 0.2, roughness: 0.3 });

  /* ------------------------------ chassis ------------------------------ */
  const tub = new THREE.Mesh(new RoundedBoxGeometry(1.16, 0.36, 2.0, 6, 0.22), paint);
  tub.position.set(0, 0.36, 0);
  tub.castShadow = true;
  tub.receiveShadow = true;
  body.add(tub);

  // pointed nose cone
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.52, 0.9, 4, 1), paint);
  nose.geometry.rotateX(-Math.PI / 2);
  nose.geometry.rotateZ(Math.PI / 4);
  nose.geometry.scale(1.0, 0.52, 1.0);
  nose.position.set(0, 0.34, 1.32);
  nose.castShadow = true;
  body.add(nose);

  // front splitter
  const splitter = new THREE.Mesh(new RoundedBoxGeometry(1.25, 0.08, 0.5, 3, 0.035), accent);
  splitter.position.set(0, 0.19, 1.42);
  splitter.castShadow = true;
  body.add(splitter);

  // side pods
  for (const s of [-1, 1]) {
    const pod = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.3, 1.3, 5, 0.13), paint);
    pod.position.set(s * 0.72, 0.34, 0.05);
    pod.castShadow = true;
    body.add(pod);
    const stripe = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.09, 1.1, 3, 0.04), accent);
    stripe.position.set(s * 0.73, 0.44, 0.05);
    body.add(stripe);
    // nerf bar linking pod to chassis
    const bar = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.035, 8, 18, Math.PI), MATS.chrome);
    bar.position.set(s * 0.78, 0.24, 0.75);
    bar.rotation.set(Math.PI / 2, 0, 0);
    body.add(bar);
  }

  // floor pan
  const floor = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.08, 2.35, 3, 0.035), MATS.darkMetal);
  floor.position.set(0, 0.16, 0.05);
  floor.castShadow = true;
  body.add(floor);

  /* ------------------------------- seat -------------------------------- */
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x16181d, roughness: 0.78, metalness: 0.05 });
  const seatBase = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.14, 0.62, 4, 0.08), seatMat);
  seatBase.position.set(0, 0.55, -0.16);
  body.add(seatBase);
  const seatBack = new THREE.Mesh(new RoundedBoxGeometry(0.66, 0.72, 0.16, 4, 0.08), seatMat);
  seatBack.position.set(0, 0.86, -0.44);
  seatBack.rotation.x = 0.2;
  seatBack.castShadow = true;
  body.add(seatBack);
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.5, 0.34, 4, 0.07), seatMat);
    wing.position.set(s * 0.3, 0.82, -0.32);
    wing.rotation.y = -s * 0.3;
    body.add(wing);
  }

  /* ---------------------------- engine bay ----------------------------- */
  const engine = new THREE.Mesh(new RoundedBoxGeometry(0.72, 0.5, 0.62, 4, 0.09), MATS.darkMetal);
  engine.position.set(0, 0.55, -1.02);
  engine.castShadow = true;
  body.add(engine);

  const airbox = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.23, 0.34, 16), MATS.chrome);
  airbox.position.set(0.3, 0.85, -1.0);
  airbox.rotation.z = -0.2;
  body.add(airbox);

  const exhausts = [];
  for (const s of [-1, 1]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.078, 1.0, 14), MATS.chrome);
    pipe.position.set(s * 0.32, 0.72, -1.32);
    pipe.rotation.set(1.28, 0, s * 0.1);
    pipe.castShadow = true;
    body.add(pipe);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.075, 0.16, 14), MATS.darkMetal);
    tip.position.set(s * 0.32, 0.86, -1.62);
    tip.rotation.set(1.28, 0, s * 0.1);
    body.add(tip);
    exhausts.push(new THREE.Vector3(s * 0.32, 0.88, -1.68));
  }

  /* ------------------------------ spoiler ------------------------------ */
  const wing = new THREE.Mesh(new RoundedBoxGeometry(1.32, 0.07, 0.36, 3, 0.03), accent);
  wing.position.set(0, 1.16, -1.28);
  wing.rotation.x = -0.22;
  wing.castShadow = true;
  body.add(wing);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.42, 0.16, 3, 0.03), MATS.darkMetal);
    post.position.set(s * 0.5, 0.95, -1.26);
    body.add(post);
    const endplate = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.24, 0.46, 3, 0.02), paint);
    endplate.position.set(s * 0.66, 1.14, -1.28);
    body.add(endplate);
  }

  /* --------------------------- steering column -------------------------- */
  const steering = new THREE.Group();
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.46, 10), MATS.darkMetal);
  column.rotation.x = 0.72;
  column.position.set(0, 0.62, 0.62);
  body.add(column);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.031, 10, 28), MATS.rubber);
  steering.add(rim);
  for (let i = 0; i < 3; i++) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.19, 0.05), MATS.chrome);
    sp.position.y = -0.09;
    sp.rotation.z = (i / 3) * Math.PI * 2;
    const holder = new THREE.Group();
    holder.rotation.z = (i / 3) * Math.PI * 2;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.18, 0.04), MATS.chrome);
    arm.position.y = 0.09;
    holder.add(arm);
    steering.add(holder);
  }
  const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.05, 12), accent);
  boss.rotation.x = Math.PI / 2;
  steering.add(boss);
  steering.position.set(0, 0.78, 0.78);
  steering.rotation.x = -0.86;
  body.add(steering);

  /* ------------------------------ wheels ------------------------------- */
  const rimColor = new THREE.Color(cfg.accent).offsetHSL(0, -0.2, 0.15).getHex();
  const wheels = [];
  const FR = 0.34, RR = 0.42;
  const defs = [
    { x: -0.82, y: FR, z: 1.02, r: FR, w: 0.26, steer: true, drive: false },
    { x: 0.82, y: FR, z: 1.02, r: FR, w: 0.26, steer: true, drive: false },
    { x: -0.88, y: RR, z: -1.02, r: RR, w: 0.42, steer: false, drive: true },
    { x: 0.88, y: RR, z: -1.02, r: RR, w: 0.42, steer: false, drive: true },
  ];
  for (const d of defs) {
    const pivot = new THREE.Group();
    pivot.position.set(d.x, d.y, d.z);
    const spin = buildWheel(d.r, d.w, rimColor, quality.simpleWheels);
    pivot.add(spin);
    body.add(pivot);
    wheels.push({ pivot, spin, ...d, restY: d.y });
  }

  // rear axle
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1.7, 10), MATS.chrome);
  axle.rotation.z = Math.PI / 2;
  axle.position.set(0, 0.42, -1.02);
  body.add(axle);

  /* ------------------------------ driver ------------------------------- */
  const externalDriver = opts.driver || null;
  const driver = externalDriver || buildDriver(cfg);
  if (!externalDriver) driver.position.set(0, 0.5, -0.1);
  body.add(driver);

  /* --------------------------- number plate ---------------------------- */
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.44, 0.3),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 })
  );
  plate.position.set(0, 0.52, 1.02);
  plate.rotation.x = -0.1;
  body.add(plate);

  /* ------------------------- boost flame emitters ----------------------- */
  const flames = [];
  for (const p of exhausts) {
    const f = new THREE.Mesh(
      new THREE.ConeGeometry(0.13, 0.6, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xff8a2a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    f.geometry.rotateX(Math.PI / 2);
    f.position.copy(p).add(new THREE.Vector3(0, 0, -0.28));
    f.rotation.x = -0.24;
    body.add(f);
    flames.push(f);
  }

  // soft contact shadow so the kart never looks like it floats
  const shadowTex = contactShadowTexture();
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(2.8, 3.3),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.85 })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.03;
  blob.renderOrder = -1;
  group.add(blob);

  /* Collapse everything that moves as a rigid unit down to one mesh per
   * material. Wheels, driver and steering each animate as a whole group, so
   * only the individually-animated boost flames have to stay separate. */
  for (const w of wheels) mergeByMaterial(w.spin);
  if (!externalDriver) mergeByMaterial(driver);
  mergeByMaterial(steering);
  mergeByMaterial(body, new Set(flames));

  return { group, body, wheels, driver, steering, flames, exhausts, blob, paint, accent };
}
