/* 第二章第二阶段验收截图。
 *
 * 全部来自真实游戏渲染（SwiftShader 软件光栅化 + 无头 Edge），
 * 不用任何 AI 生成图。每个机位都是「把车放到某弧长处、按住油门跑 0.5 s
 * 让悬挂和镜头稳定，再截」，或者用 __sim.cam 摆一个定点机位。
 *
 * 用法：node tools/shots2.mjs [desktop|mobile|all]
 */
import path from 'node:path';
import fs from 'node:fs';
import { startServer, findBrowser, CHROME_ARGS, loadPuppeteer, SHOTS } from './test/lib.mjs';

const OUT = path.join(SHOTS, 'stage2');
fs.mkdirSync(OUT, { recursive: true });

const mode = process.argv[2] || 'all';
/* 只重拍几张：node tools/shots2.mjs desktop 20,21,23
 * 调机位时整轮要跑两分半，按前缀过滤能省掉大部分等待。 */
const ONLY = (process.argv[3] || '').split(',').filter(Boolean);
const want = (name) => !ONLY.length || ONLY.some((p) => name.startsWith(p));
const puppeteer = await loadPuppeteer();
const srv = await startServer();
const browser = await puppeteer.launch({
  executablePath: findBrowser(), headless: true, args: CHROME_ARGS, protocolTimeout: 900000,
});

/** 抓图 + 空帧自检重试。
 *
 * 无头 Chromium 在 preserveDrawingBuffer:false 的 WebGL canvas 上抓图，
 * 偶尔会拿到一张「只有 HUD、3D 画面全黑」的废图（同一机位重跑就好，
 * 和机位设置无关）。1280×720 的真画面 PNG 至少 400 KB，纯黑+HUD 只有
 * 70 KB 左右，所以用文件大小当廉价可信度检查：太小就同步两帧再抓，
 * 最多 4 次。 */
async function shot(page, file) {
  for (let k = 0; k < 4; k++) {
    await page.evaluate(() => new Promise((res) => {
      requestAnimationFrame(() => requestAnimationFrame(() => res(1)));
    }));
    await page.screenshot({ path: file });
    const n = fs.statSync(file).size;
    if (n > 150000) return n;
    await new Promise((r) => setTimeout(r, 700 + k * 500));
  }
  const n = fs.statSync(file).size;
  console.warn('  !! 疑似空帧（' + Math.round(n / 1024) + ' KB）：' + path.basename(file));
  return n;
}

/** 打开一局，隐藏道具方块（会挡视线），返回 page */
async function open(w, h) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.goto(`${srv.url}/?course=beach`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => !!window.__sim, { timeout: 600000, polling: 400 });
  await page.evaluate(async () => {
    await window.__garage.grantVehicle('turtle');
    await window.__garage.grantVehicle('moto');
    await window.__sim.start({ vehicle: 'red' });
    // 道具方块是正常游戏内容，但五个一排的水晶会正好压在镜头中央挡住建
    // 筑和海面，验收截图里先隐藏。
    const bf = window.__game.items?.boxField;
    if (bf?.meshes) for (const m of bf.meshes) m.visible = false;
  });
  /* 预热：刚 start() 时启动遮罩还在淡出，头一次抓图会拿到一整张黑屏
   * （只有 HUD 看得见）。空跑一段 + 丢掉第一张废图，之后每一张才是
   * 真正的画面。 */
  await page.evaluate(() => {
    const S = window.__sim;
    const T = S.trackInfo();
    S.place(0, Math.round(30 / (T.length / T.samples)), 0);
    S.step(1 / 60, 20);
  });
  await new Promise((r) => setTimeout(r, 4200));
  await shot(page, path.join(OUT, '_warmup.png'));
  return page;
}

/** 驾驶视角：把车放到弧长 d，按住油门跑 30 帧再截 */
async function driveShot(page, name, d, { lat = 0, frames = 30, throttle = 0.55 } = {}) {
  if (!want(name)) return;
  await page.evaluate((d, lat, frames, throttle) => {
    const S = window.__sim;
    const T = S.trackInfo();
    const i = Math.round(d / (T.length / T.samples));
    S.releaseCam();
    S.place(0, i, lat);
    S.control({ throttle });
    S.step(1 / 60, frames);
    S.control({ throttle: 0 });
  }, d, lat, frames, throttle);
  await new Promise((r) => setTimeout(r, 1700));
  await shot(page, path.join(OUT, name + '.png'));
  console.log('  ', name);
}

/** 定点机位。
 *  spec.sec/t/lat  → 赛道上的锚点（世界坐标）
 *  spec.rel = [右, 前]  机位相对锚点、按赛道切线展开的偏移（米）
 *  spec.aim = [右, 前]  视线落点相对锚点的偏移
 *  spec.ey / spec.ly    机位与视线的绝对高度
 *  spec.fov             视场角
 */
async function camShot(page, name, spec) {
  if (!want(name)) return;
  await page.evaluate((spec) => {
    const S = window.__sim;
    const T = window.__game.track;
    const a = S.pointAt(spec.sec, spec.t, spec.lat || 0);
    const p = S.pointAt(spec.sec, spec.t - 0.01, spec.lat || 0);
    const q = S.pointAt(spec.sec, spec.t + 0.01, spec.lat || 0);
    let tx = q.x - p.x, tz = q.z - p.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    const rx = -tz, rz = tx;                 // 右手系：右 = 切线绕 Y 转 -90°
    /* toSea 时把「右」翻到海的一侧 —— 海在第几侧是 track.sea 决定的，
     * 手写 ±1 必然有一半机位拍到内陆。 */
    const sgn = spec.toSea ? (Math.sign(T.sea[a.i]) || 1) : 1;
    const ro = spec.rel[0] * sgn, fo = spec.rel[1];
    const ra = (spec.aim?.[0] || 0) * sgn, fa = spec.aim?.[1] || 0;
    S.cam(
      [a.x + rx * ro + tx * fo, spec.ey, a.z + rz * ro + tz * fo],
      [a.x + rx * ra + tx * fa, spec.ly, a.z + rz * ra + tz * fa],
      spec.fov || 52,
    );
  }, spec);
  await new Promise((r) => setTimeout(r, 900));
  await shot(page, path.join(OUT, name + '.png'));
  console.log('  ', name);
}

/** 小屋近景：直接从 InstancedMesh 的实例矩阵取第 k 栋的位置，
 *  再从「朝向路心」的方向退 dist 米拍它。比猜横向偏移可靠。 */
async function houseShot(page, name, asset, k, dist = 13) {
  if (!want(name)) return;
  const ok = await page.evaluate((asset, k, dist) => {
    const B = window.__game.beach;
    const g = B.group.getObjectByName('ch2:' + asset);
    if (!g || !g.children.length) return false;
    const im = g.children[0];
    const arr = im.instanceMatrix.array;
    const x = arr[k * 16 + 12], y = arr[k * 16 + 13], z = arr[k * 16 + 14];
    // 朝向赛道中心：最近采样点
    const T = window.__game.track;
    let best = 0, bd = Infinity;
    for (let i = 0; i < T.n; i += 2) {
      const d = (x - T.pos[i * 3]) ** 2 + (z - T.pos[i * 3 + 2]) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    const cx = T.pos[best * 3], cz = T.pos[best * 3 + 2];
    let dx = cx - x, dz = cz - z;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl;
    // 相机站在路心一侧、稍微偏一点角度，别拍成正立面
    const ox = dx * dist - dz * dist * 0.45;
    const oz = dz * dist + dx * dist * 0.45;
    window.__sim.cam([x + ox, y + 3.4, z + oz], [x, y + 2.2, z], 46);
    return true;
  }, asset, k, dist);
  if (!ok) { console.log('   !! 找不到', asset); return; }
  await new Promise((r) => setTimeout(r, 900));
  await shot(page, path.join(OUT, name + '.png'));
  console.log('  ', name);
}

/** 贴地机位：和 camShot 一样按赛道切线展开，但**高度相对地形**。
 *
 * 之前的近景全用绝对高度（ey: 1.5 / 3.0），沙丘那一段地面就在 y≈3~4，
 * 相机直接被埋进沙子里 —— 于是 20/21/23/24 四张近景拍到的都是
 * 「从地底往上看」的一片白。这里统一改成「离地多少米」，
 * 并且 heightAt 在水面以下时按海平面算，站在海里也不会沉底。
 *
 *  spec.water = true 时 rel/aim 的第一项是「相对实测水线」的横向距离，
 *  用来把机位钉在浪线附近（岬角/沙滩的水线距离是分段变的，猜不得）。
 */
async function relShot(page, name, spec) {
  if (!want(name)) return;
  await page.evaluate((spec) => {
    const SEA = -7.5;
    const S = window.__sim, T = window.__game.track, B = window.__game.beach;
    const a = S.pointAt(spec.sec, spec.t, 0);
    const p = S.pointAt(spec.sec, spec.t - 0.01, 0), q = S.pointAt(spec.sec, spec.t + 0.01, 0);
    let tx = q.x - p.x, tz = q.z - p.z;
    const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const rx = -tz, rz = tx;
    const sgn = spec.toSea ? (Math.sign(T.sea[a.i]) || 1) : 1;
    /* 横向 0 点：默认是路缘，spec.water 时改成实测水线 */
    const lat0 = spec.water ? (B._waterLat(a.i, sgn) ?? T.width[a.i]) : T.width[a.i];
    const at = (r, f) => {
      const lat = (lat0 + r) * sgn;
      return [a.x + rx * lat + tx * f, a.z + rz * lat + tz * f];
    };
    const ground = (x, z) => Math.max(B.heightAt(x, z), SEA);
    const [cx, cz] = at(spec.rel[0], spec.rel[1]);
    const [ax, az] = at(spec.aim[0], spec.aim[1]);
    const cy = ground(cx, cz) + spec.ey;
    const ay = ground(ax, az) + spec.ly;
    S.cam([cx, cy, cz], [ax, ay, az], spec.fov || 54);
  }, spec);
  await new Promise((r) => setTimeout(r, 900));
  await shot(page, path.join(OUT, name + '.png'));
  console.log('  ', name);
}

/** 单株植物近景：取 InstancedMesh 第 k 个实例的位置，退 dist 米、仰视树冠 */
async function palmShot(page, name, k, dist, ey = 1.7, aimUp = 5.4) {
  if (!want(name)) return;
  const ok = await page.evaluate((k, dist, ey, aimUp) => {
    const B = window.__game.beach;
    const g = B.group.getObjectByName('ch2:palm');
    if (!g || !g.children.length) return false;
    const arr = g.children[0].instanceMatrix.array;
    const x = arr[k * 16 + 12], y = arr[k * 16 + 13], z = arr[k * 16 + 14];
    const T = window.__game.track;
    let best = 0, bd = Infinity;
    for (let i = 0; i < T.n; i += 2) {
      const d = (x - T.pos[i * 3]) ** 2 + (z - T.pos[i * 3 + 2]) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    // 站到「背路心」的一侧，往路那边看，背景是空的天
    let dx = x - T.pos[best * 3], dz = z - T.pos[best * 3 + 2];
    const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    const ox = x + dx * dist - dz * dist * 0.5;
    const oz = z + dz * dist + dx * dist * 0.5;
    const gy = Math.max(B.heightAt(ox, oz), -7.5);
    window.__sim.cam([ox, gy + ey, oz], [x, y + aimUp, z], 52);
    return true;
  }, k, dist, ey, aimUp);
  if (!ok) { console.log('   !! 找不到 palm'); return; }
  await new Promise((r) => setTimeout(r, 900));
  await shot(page, path.join(OUT, name + '.png'));
  console.log('  ', name);
}

/* ------------------------------------------------------------------ */
if (mode === 'desktop' || mode === 'all') {
  const page = await open(1280, 720);
  console.log('桌面 1280×720');

  const DRIVE = [
    ['02-sand', 190],
    ['03-point', 370],
    ['04-dune', 498],
    ['05-palm', 598],
    ['06-village', 762],
    ['07-bridgehead', 906],
    ['08-bridge', 962],
    ['09-return', 1024],
  ];
  /* 起点广场从「发车前 26 m」看过去：起点门、彩旗、看台全在画面前方。
   * 用驾驶视角从 d=34 往前开是拍不到门的 —— 门在车屁股后面。 */
  await camShot(page, '01-plaza', {
    sec: 'plaza', t: 0.0, rel: [0, -26], ey: 5.8, aim: [0, 40], ly: 3.4, fov: 50,
  });
  for (const [name, d] of DRIVE) await driveShot(page, name, d);

  /* 木桥三视角。桥中心弧长 964.3；桥段 y ≈ 3.56~4.58。 */
  // 正面：站在桥头正对着桥
  await camShot(page, '10-bridge-front', {
    sec: 'bridge', t: 0.0, rel: [0, -26], ey: 6.2, aim: [0, 40], ly: 3.2, fov: 50,
  });
  // 侧面：岸边 46 m 外看整座桥
  await camShot(page, '11-bridge-side', {
    sec: 'bridge', t: 0.5, rel: [46, 0], ey: 8.6, aim: [0, 0], ly: 3.4, fov: 40,
  });
  // 桥下：站在河岸上、贴着水面的高度，看桥墩从桥面落到河床
  await relShot(page, '12-bridge-under', {
    sec: 'bridge', t: 0.30, rel: [15, -12], ey: 2.2, aim: [4, 16], ly: 2.6, fov: 58,
  });
  // 驾驶视角：车停在桥中央
  await driveShot(page, '13-bridge-drive', 966, { frames: 20, throttle: 0.4 });

  /* 近景（全部相对地形定高，别再写绝对 y） */
  /* 海面：站在水线外侧、沿沙滩斜着看向远方。
   *
   * 原来正对海平线拍，画面被切成「天空 / 几条平行白线 / 沙」三层，
   * 而且低视角把浪花带压成几根笔直贯通的白细线 —— 正是要避免的
   * 「白色反光条纹」。斜 45° 拍之后浪线顺着海岸退远，近岸透亮的松石绿、
   * 3 m 外转青、远处转深蓝的过渡也才看得出来。 */
  await relShot(page, '20-close-sea', {
    sec: 'sand', t: 0.55, toSea: true, water: true,
    rel: [3, -22], ey: 2.0, aim: [-12, 46], ly: 0.6, fov: 60,
  });
  /* 沙滩：站在压实沙道边、压着镜看海 —— 一层一条带子地数过去是
   * 压实赛道（偏深橙，带白边线和路缘）→ 金色干沙 → 水线处的湿沙 → 海。
   * 之前横着从干沙上看路缘，画面被路缘的深色侧面切成三截，什么质感都看不出来。 */
  await relShot(page, '21-close-sand', {
    sec: 'sand', t: 0.42, toSea: true,
    rel: [-2, 0], ey: 2.3, aim: [26, 26], ly: 0.4, fov: 55,
  });
  /* 礁石：从浅滩回看礁石带。
   *
   * 试过一排机位（tools/diag-rockframe.mjs）：从水里正对岸边拍，画面前景
   * 永远是一整面过曝的沙坡 —— 岬角的路基比水线高 8 m 以上，正对着它必然
   * 糊成一堵墙。改成「站在海里、斜着沿水线回头」，画面里才有
   * 水 / 礁石 / 沙滩 / 木栈道栏杆 / 远处棕榈五层，也顺便证明了礁石没有
   * 侵占路面（右侧能看见红白路缘）。 */
  await relShot(page, '23-close-rock', {
    sec: 'point', t: 0.62, toSea: true, water: true,
    rel: [18, 24], ey: 2.8, aim: [-6, -40], ly: 1.2, fov: 56,
  });
  // 棕榈：仰视树冠
  await palmShot(page, '24-close-palm', 0, 9);
  // 小屋：三款各拍一栋
  await houseShot(page, '22-house-blue', 'house_blue', 0, 13);
  await houseShot(page, '22-house-thatch', 'house_thatch', 0, 13);
  await houseShot(page, '22-house-fishing', 'house_fishing', 0, 13);

  await page.close();
}

/* ------------------------------------------------------------------ */
if (mode === 'mobile' || mode === 'all') {
  const page = await open(844, 390);
  console.log('手机横屏 844×390');
  for (const [name, d] of [['30-m-sand', 190], ['31-m-village', 762], ['32-m-bridge', 962]]) {
    await driveShot(page, name, d, { frames: 24 });
  }
  await page.close();
}

await browser.close();
console.log('完成 →', OUT);
process.exit(0);
