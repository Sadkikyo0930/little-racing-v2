import * as THREE from 'three';
import {
  BEACH_CONTROL, BEACH_SECTIONS, BEACH_SURFACES, BEACH_RIVER,
} from './chapter2/beachData.js';

/* ------------------------------------------------------------------ *
 * Course registry.
 *
 * A course is a data description of a race: the shape of the road, what
 * it is paved with, how its edges are treated, which scenery builder
 * dresses it, and whether civilian traffic is out there. Track, City,
 * Highway and Traffic all read from here, so adding a circuit is a data
 * change rather than a code change.
 * ------------------------------------------------------------------ */

/* --------------------- 1. Viejo San Juan Circuit -------------------- *
 * A closed loop through the historic quarter.
 *
 * Layout (north is -Z, the Atlantic; south-west is the bay):
 *   Plaza de Armas  →  Calle Fortaleza  →  La Fortaleza gate
 *   →  Paseo de la Princesa (bayside)  →  Puerta de San Juan (climb)
 *   →  El Morro esplanade  →  Calle Norzagaray (Atlantic cliff)
 *   →  Castillo San Cristóbal  →  cobblestone descent  →  Plaza
 * ------------------------------------------------------------------ */
// [x, y, z, halfWidth, surfaceKind]  kind: 0 cobble street, 1 esplanade, 2 promenade
const VIEJO = [
  [   0,  18,    0, 10, 0], // Plaza de Armas / start-finish
  [ -46,  17,   -4,  9, 0], // Calle Fortaleza — umbrella street
  [ -96,  15,   -2, 8.5, 0],
  [-140,  12,   14, 8.5, 0], // sweep down toward La Fortaleza
  [-168,   7,   48, 10, 2], // gate of La Fortaleza
  [-210,   4,   70, 12, 2], // Paseo de la Princesa, fountain
  [-256,   3,   52, 13, 2], // bayside promenade
  [-272,   4,    2, 12, 2],
  [-262,  10,  -52, 10, 2], // climb to Puerta de San Juan
  [-232,  20, -104, 11, 1],
  [-214,  28, -158, 16, 1], // El Morro glacis opens up
  [-160,  31, -198, 20, 1], // El Morro esplanade — widest point
  [ -86,  30, -214, 18, 1],
  [ -14,  27, -206, 14, 1], // Campo del Morro exit
  [  52,  25, -196, 10, 0], // Calle Norzagaray, cliff on the left
  [ 124,  25, -184, 9.5, 0],
  [ 182,  27, -152, 9.5, 0],
  [ 214,  30, -108, 13, 1], // Castillo San Cristóbal ramp
  [ 220,  29,  -56, 12, 1],
  [ 196,  26,  -18, 9, 0], // hairpin back into the old city
  [ 150,  24,    6, 8.5, 0],
  [  96,  22,   10, 8.5, 0], // Calle San Francisco
  [  46,  20,    4, 9.5, 0],
];

/* ------------------- 2. Expreso Las Américas ----------------------- *
 * The drive out of the old city and into the banking district:
 *
 *   El Morro  →  Puerta de Tierra  →  Ave. Fernández Juncos / PR-1
 *   →  Expreso Las Américas / PR-18  →  exit 2
 *   →  Ave. Ing. Manuel Domenech, Hato Rey
 *
 * Described here as the *corridor* — the median line of a divided
 * highway, running one way only. The loop is generated from it: you head
 * out on the right-hand carriageway, turn around at Domenech, and come
 * back on the other carriageway, which is again on your right. The real
 * route is 11.3 km; this is scaled to something you can race.
 *
 * Provenance: these control points were authored by hand from written
 * driving directions, not traced or imported from any map. That keeps the
 * course clear of map-data licences such as OpenStreetMap's ODbL — the
 * shape of a public road is a geographic fact and carries no copyright,
 * but a map *dataset* does. Keep it that way if you extend the route.
 * ------------------------------------------------------------------ */
// [x, y, z, halfWidth, kind]  kind: 3 asphalt, 4 elevated expressway
const CORRIDOR = [
  [ -250,  26, -150, 11, 3], // Campo del Morro, the exit gate
  [ -196,  22, -104, 11, 3], // dropping off the headland
  [ -150,  15,  -52, 11, 3], // Ave. Muñoz Rivera
  [  -96,   9,  -14, 12, 3], // Puerta de Tierra, the isthmus
  [  -30,   6,    6, 12, 3], // Escambrón, bay on the right
  [   44,   5,   14, 13, 3], // Ave. Fernández Juncos / PR-1
  [  120,   5,    6, 13, 3],
  [  196,   6,  -18, 13, 3], // Miramar, the lagoon opens up
  [  268,   9,  -58, 12, 4], // rising onto the PR-18 viaduct
  [  330,  16, -112, 12, 4], // Caño Martín Peña crossing
  [  382,  20, -178, 12, 4], // Expreso Las Américas, elevated
  [  428,  17, -252, 12, 4],
  [  466,  11, -324, 12, 3], // exit 2 ramp comes back to grade
  [  502,   8, -390, 11, 3],
  [  548,   7, -448, 11, 3], // Ave. Ing. Manuel Domenech
  [  606,   7, -486, 11, 3], // Hato Rey, under the towers
];

/**
 * Turn a one-way corridor into a closed divided-highway loop.
 *
 * The corridor describes the median. The returned loop runs out along the
 * carriageway to the right of it, swings around the far end, comes back
 * along the other carriageway — which, travelling the other way, is again
 * on the driver's right — and closes with a second turnaround. Right-hand
 * driving on both legs is a consequence of the geometry rather than
 * something the rest of the game has to know about.
 *
 * @param {number} off  half the median separation, in metres
 * @param {number} flare  extra half-width through the turnarounds
 */
function divided(corridor, { off = 17, flare = 5, arcPoints = 5 } = {}) {
  const m = corridor.length;
  const P = corridor.map((c) => new THREE.Vector3(c[0], c[1], c[2]));

  // Right-hand normal of the corridor at each node, averaged across the
  // two adjacent segments so the offset legs stay parallel through bends.
  const rights = [];
  for (let i = 0; i < m; i++) {
    const a = P[Math.max(0, i - 1)];
    const b = P[Math.min(m - 1, i + 1)];
    const t = new THREE.Vector3().subVectors(b, a).setY(0).normalize();
    // cross(tangent, up) is the road's right-hand side
    rights.push(new THREE.Vector3(-t.z, 0, t.x));
  }

  const node = (i, side) => {
    const c = corridor[i];
    const r = rights[i];
    return [
      c[0] + r.x * off * side,
      c[1],
      c[2] + r.z * off * side,
      c[3],
      c[4],
    ];
  };

  /* A turnaround is a half-circle around the corridor end, pushed a little
   * past it so the radius stays drivable at speed. */
  const turn = (endIdx, dir) => {
    const c = corridor[endIdx];
    const r = rights[endIdx];
    const fwd = new THREE.Vector3(r.z, 0, -r.x).multiplyScalar(dir);
    const out = [];
    const radius = off;
    const centre = new THREE.Vector3(c[0], c[1], c[2]).addScaledVector(fwd, radius * 0.55);
    for (let k = 1; k <= arcPoints; k++) {
      const a = (k / (arcPoints + 1)) * Math.PI;
      // sweep from the outbound side around to the returning side
      const s = Math.cos(a) * dir;
      const f = Math.sin(a);
      out.push([
        centre.x + r.x * radius * s + fwd.x * radius * f,
        c[1],
        centre.z + r.z * radius * s + fwd.z * radius * f,
        c[3] + flare,
        c[4] === 4 ? 3 : c[4], // never turn around on the viaduct
      ]);
    }
    return out;
  };

  const loop = [];
  for (let i = 0; i < m; i++) loop.push(node(i, 1));          // outbound
  loop.push(...turn(m - 1, 1));                                // far U-turn
  for (let i = m - 1; i >= 0; i--) loop.push(node(i, -1));     // return
  loop.push(...turn(0, -1));                                   // near U-turn
  return loop;
}

const BASE_COURSES = [
  {
    id: 'viejo',
    name: '老城海滨赛道',
    subtitle: '历史街区',
    blurb: '石板路、海堤和古老炮台。',
    flag: '🏛️',
    laps: 3,
    control: VIEJO,
    surface: 'adoquin',
    borders: 'colonial',
    scenery: 'city',
    traffic: 0,
    intro: '起点广场',
  },
  {
    id: 'expreso',
    name: '海滨高速公路',
    subtitle: '古堡 → 新城',
    blurb: '六车道高速，小心来往车辆。',
    flag: '🛣️',
    laps: 2,
    control: divided(CORRIDOR),
    surface: 'asphalt',
    borders: 'highway',
    scenery: 'highway',
    traffic: 30,
    intro: '古堡起点',
  },
];

/* --------------------- 3. 贝壳湾海滨环线 --------------------------- *
 * 第二章《阳光沙滩大冒险》。数据全部来自 chapter2/beachData.js —— 那份
 * 文件同时被 tools/audit-track.mjs 审计，改这里等于改审计的输入，跑一次
 * `npm run audit` 就知道赛道还对不对。
 *
 * 和上面两条赛道的三点不同，都是**按赛道开关**，不影响第一章：
 *   arcScalars   —— 宽度 / 海侧按弧长插值（控制点不等距，见 sectionKinds.js）
 *   sections     —— 九段显式分段，路面类型按段写死（桥面必须这样）
 *   multiSurface —— 一条路五种材质（沙 / 沙丘 / 木栈道 / 木桥 / 土路）
 * ------------------------------------------------------------------ */
export const BEACH_COURSE = {
  id: 'beach',
  name: '贝壳湾海滨环线',
  subtitle: '阳光沙滩大冒险',
  blurb: '金色沙滩、礁石岬角，还有一座 48 米的潮汐木桥。',
  flag: '🏖️',
  laps: 3,
  control: BEACH_CONTROL,
  surface: 'sand',
  borders: 'beach',
  scenery: 'beach',
  traffic: 0,
  intro: '沙滩节广场',
  chapter: 'chapter2',
  arcScalars: true,
  multiSurface: true,
  sections: BEACH_SECTIONS,
  river: BEACH_RIVER,
  /* kind → 抓地系数，kart.js 用它算纵向速度；没有这张表的赛道按 1 处理 */
  surfaceGrips: Object.fromEntries(
    Object.entries(BEACH_SURFACES).map(([k, v]) => [k, v.grip])
  ),
  surfaceLateral: Object.fromEntries(
    Object.entries(BEACH_SURFACES).map(([k, v]) => [k, v.lateral])
  ),
};

/* 顺序即赛道选择界面的顺序：老城 → 高速 → 贝壳湾 */
export const COURSES = [...BASE_COURSES, BEACH_COURSE];

export function getCourse(id) {
  return COURSES.find((c) => c.id === id) || COURSES[0];
}
