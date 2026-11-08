/* ==================================================================
 * 第二章第一阶段 · 实装验收测试
 *
 *   node tools/test/stage1.mjs            跑全部
 *   node tools/test/stage1.mjs --only=drive   只跑某一组
 *
 * 覆盖：
 *   A 赛道结构（长度 / 九段 / 桥 / 检查点 / kind=3 覆盖）
 *   B 路面抓地（沙地 0.86、木栈道 0.97、木桥 0.94，过渡无跳变）
 *   C 三车驾驶（红车 / 海龟车 / 摩托：起步 加速 刹车 转向 沙丘 S 弯 木桥 冲线三圈）
 *   D 摩托专项（前轮转向 / 双轮自转 / 压弯与回正）
 *   E 8 车三圈（AI 不卡桥、圈数、排名、检查点）
 *   F 碰撞与复位（桥栏、逆行提示）
 *   G 第一章回归（老城赛道数据未变、能开）
 *
 * 输出：tools/out/stage1-report.json + tools/out/shots/*.png
 * 任何一项失败 → 退出码 1。
 * ================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  startServer, findBrowser, CHROME_ARGS, loadPuppeteer, ensureDirs,
  createReport, SHOTS, OUT,
} from './lib.mjs';

const ARG = process.argv.slice(2);
const ONLY = (ARG.find((a) => a.startsWith('--only=')) || '').split('=')[1] || null;
const should = (k) => !ONLY || ONLY === k;

/* 测试跑的是 dist/ 里构建出来的包。忘了重新构建，测的就是上一版代码 ——
 * 曾经因此得出「摩托没有前轮转向」这种假结论。默认先构建，--no-build 才跳过。 */
if (!ARG.includes('--no-build')) {
  console.log('· 构建 dist-test（含测试钩子）…');
  execFileSync('npx', ['vite', 'build', '--outDir', 'dist-test'], {
    env: { ...process.env, VITE_TEST_HOOKS: '1' },
    cwd: path.resolve('.'), stdio: ['ignore', 'ignore', 'inherit'], shell: true,
  });
}

const report = createReport('第二章第一阶段实装验收');
ensureDirs();

const puppeteer = await loadPuppeteer();
const srv = await startServer(path.resolve('dist-test'));
const browser = await puppeteer.launch({
  executablePath: findBrowser(), headless: true, args: CHROME_ARGS, protocolTimeout: 1800000,
});

const page = await browser.newPage();
page.setDefaultNavigationTimeout(180000);
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  /* 每次 loadCourse 都会整页跳转，上一条还没下完的请求会被掐断，
   * Chrome 就报一条 ERR_CONNECTION_CLOSED / ERR_ABORTED。那是测试自己
   * 制造的噪音，不是页面的 JS 报错，不能算到游戏头上。 */
  if (/^Failed to load resource/.test(t) && /ERR_(CONNECTION_CLOSED|ABORTED)/.test(t)) return;
  // Chrome 117+ 对文档默认限制 unload，会在控制台打印「Permissions policy violation:
  // unload is not allowed」；与游戏运行时无关，属环境噪音，排除以免误判「JS 运行时报错」。
  if (/Permissions policy violation: unload is not allowed/i.test(t)) return;
  consoleErrors.push(t);
});
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });

async function loadCourse(course) {
  await page.goto(`${srv.url}/?course=${course}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => !!window.__sim, { timeout: 300000, polling: 300 });
  return page.evaluate(() => window.__sim.trackInfo());
}

async function shot(name) {
  await new Promise((r) => setTimeout(r, 350));
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}

/* ================================================================== *
 * A. 赛道结构
 * ================================================================== */
let info;
if (should('structure')) {
  console.log('\n=== A. 赛道结构 ===');
  info = await loadCourse('beach');
  report.check('A1 赛道 ID = beach', info.course === 'beach', info.course);
  report.check('A2 名称 = 贝壳湾海滨环线', info.name === '贝壳湾海滨环线', info.name);
  report.check('A3 圈数 = 3', info.laps === 3, String(info.laps));
  report.check('A4 控制点 = 23', info.controlPoints === 23, String(info.controlPoints));
  report.near('A5 单圈全长', info.length, 1057.5, 4, ' m');
  report.check('A6 九段齐全', info.sections?.length === 9, `${info.sections?.length} 段`);
  const sumSec = info.sections.reduce((a, s) => a + s.len, 0);
  report.near('A7 九段之和 = 全长', sumSec, info.length, 0.5, ' m');

  const expectLen = {
    plaza: 70, sand: 284.3, point: 108.5, dune: 70.1, palm: 128.1,
    village: 207.1, bridgehead: 72.2, bridge: 48.1, return: 69.3,
  };
  for (const s of info.sections) {
    report.near(`A8 分段 ${s.name}`, s.len, expectLen[s.id], 1.5, ' m');
  }

  report.near('A9 木桥长度', info.bridge.len, 48, 1, ' m');
  report.check('A10 桥段外无 kind=3', info.kind3OutsideBridge === 0, `${info.kind3OutsideBridge} 点`);
  const bridgeSamples = (info.bridge.i1 > info.bridge.i0
    ? info.bridge.i1 - info.bridge.i0
    : info.samples - info.bridge.i0 + info.bridge.i1);
  report.near('A11 桥面采样数 × 段长 = 48 m', bridgeSamples * info.seg, 48, 1, ' m');

  report.check('A12 检查点 32 个', info.checkpoints.length === 32, String(info.checkpoints.length));
  report.check('A13 检查点严格递增', info.checkpointOrderOk);
  report.check('A14 检查点从 0 开始', info.checkpoints[0] === 0);
  report.check('A15 检查点不越界', info.checkpoints[31] < info.samples);
  report.near('A16 路面最窄', info.widths.min, 16, 0.2, ' m');
  report.near('A17 路面最宽', info.widths.max, 24.25, 0.5, ' m');
  report.check('A18 清障烘焙存在', !!info.clearance && info.clearance.min > 3,
    `最小半宽 ${info.clearance?.min} m`);
}

/* ================================================================== *
 * B. 路面抓地
 * ================================================================== */
if (should('grip')) {
  console.log('\n=== B. 路面抓地 ===');
  if (!info) info = await loadCourse('beach');
  const r = await page.evaluate(async () => {
    const S = window.__sim;
    await S.start({ vehicle: 'red' });
    const T = S.trackInfo();
    const out = { unit: {}, observed: {} };

    /* 1) 表值：赛道自己的 kind → 抓地系数 */
    for (const kind of [0, 1, 2, 3, 4]) out.unit[kind] = window.__game.track.gripAt(kind);

    /* 2) 实测：把车放在该段起点，开进去，取样时保证还在这段路面上。
     *    直接在段中点开 4 s 是不行的 —— 沙滩直道 284 m 够，广场只有 70 m，
     *    4 s 后车已经开进沙地，量到的是沙地的 0.86。 */
    const probe = (secId, aheadM, frames) => {
      const sec = T.sections.find((s2) => s2.id === secId);
      const back = Math.round(aheadM / T.seg);
      const span = (sec.i1 - sec.i0 + T.samples) % T.samples;
      // 广场/木桥都比较短：从段头前 aheadM 米处出发，冲进去再取
      const i = secId === 'plaza' ? sec.i0 : sec.i0;
      S.place(0, Math.max(0, i - back), 0);
      S.control({ throttle: 1 });
      let best = null;
      for (let k = 0; k < frames; k++) {
        S.step(1 / 60, 1);
        const p = S.snapshot().player;
        if (p.kind === sec.kind) best = p;
      }
      return best;
    };

    out.observed.plaza = probe('plaza', 6, 100);
    out.observed.sand = probe('sand', 30, 260);
    out.observed.dune = probe('dune', 20, 200);
    out.observed.bridge = probe('bridge', 30, 160);
    out.observed.village = probe('village', 20, 200);

    /* 3) 过渡平滑：从木栈道开进沙滩，逐帧记录速度变化。
     *
     * 这里必须区分两件事：
     *   · 路面切换导致的掉速 —— 抓地力用 damp 过渡，单帧只该动几厘米每秒；
     *   · 撞到东西导致的掉速 —— 撞沙地木桩一帧能掉 7 m/s，是碰撞该有的手感。
     * 一开始没分开，量到 6.99 m/s 就报「路面跳变」，其实是车已经撞在木桩上了。
     * 所以只统计「没撞到任何东西」的帧。 */
    const sec = T.sections.find((s2) => s2.id === 'sand');
    S.place(0, Math.max(0, sec.i0 - 30), 0);
    S.control({ throttle: 1 });
    S.step(1 / 60, 120);
    let maxJump = 0, maxGripJump = 0, prev = null, prevGrip = null, hits = 0;
    for (let k = 0; k < 240; k++) {
      S.step(1 / 60, 1);
      const s2 = S.snapshot().player;
      if (s2.wallHit > 0) hits++;
      if (prev != null && s2.wallHit === 0) maxJump = Math.max(maxJump, Math.abs(s2.speed - prev));
      if (prevGrip != null) maxGripJump = Math.max(maxGripJump, Math.abs(s2.surfaceGrip - prevGrip));
      prev = s2.speed;
      prevGrip = s2.surfaceGrip;
    }
    out.maxSpeedJumpPerFrame = +maxJump.toFixed(3);
    out.maxGripJumpPerFrame = +maxGripJump.toFixed(4);
    out.wallHitFrames = hits;
    S.control({ throttle: 0 });
    return out;
  });
  report.near('B1 沙地表值', r.unit[0], 0.86, 0.001);
  report.near('B2 沙丘表值', r.unit[1], 0.88, 0.001);
  report.near('B3 木栈道表值', r.unit[2], 0.97, 0.001);
  report.near('B4 木桥表值', r.unit[3], 0.94, 0.001);
  report.near('B5 渔村土路表值', r.unit[4], 0.90, 0.001);

  const obs = (k) => r.observed[k] || {};
  report.near('B6 广场实测抓地', obs('plaza').surfaceGrip, 0.97, 0.03);
  report.near('B7 沙滩实测抓地', obs('sand').surfaceGrip, 0.86, 0.02);
  report.near('B8 沙丘实测抓地', obs('dune').surfaceGrip, 0.88, 0.02);
  report.near('B9 木桥实测抓地', obs('bridge').surfaceGrip, 0.94, 0.03);
  report.near('B10 渔村实测抓地', obs('village').surfaceGrip, 0.90, 0.02);
  report.check('B11 沙地最高速 ≈ 19.8×0.86',
    Math.abs(obs('sand').speed - 19.8 * 0.86) < 1.5,
    `${obs('sand').speed} m/s（期望 ≈ ${(19.8 * 0.86).toFixed(1)}）`);
  report.check('B12 未复用 offroad 0.52', r.unit[0] > 0.8, `沙地 ${r.unit[0]}`);
  report.check('B13 路面过渡无速度跳变（不计碰撞帧）', r.maxSpeedJumpPerFrame < 0.45,
    `单帧最大变化 ${r.maxSpeedJumpPerFrame} m/s（撞墙帧 ${r.wallHitFrames} 帧已排除）`);
  report.check('B13b 抓地系数是渐变不是瞬切', r.maxGripJumpPerFrame < 0.03,
    `单帧最大变化 ${r.maxGripJumpPerFrame}`);

  const drops = Object.entries(r.observed).map(([k, v]) => [k, v ? +(v.y - v.groundY).toFixed(3) : 'n/a']);
  report.check('B14 所有路面车辆贴地（不陷地不跳起）',
    drops.every(([, d]) => typeof d === 'number' && Math.abs(d) < 0.08),
    drops.map(([k, d]) => `${k}:${d}`).join(' '));
  report.data = r;

  report.data = r;
}

/* ================================================================== *
 * C. 三车驾驶
 * ================================================================== */
const vehicles = ['red', 'turtle', 'moto'];
const driveResults = {};

/* 三辆车都要真的拥有才能装备（模拟玩家已解锁：海龟=第一章通关，摩托=金币购买）。
 * 这一段必须放在分组外面 —— 否则单独跑 --only=moto 时车没解锁，游戏会
 * （按设计）回退成红车，测出来的「摩托四轮」其实是红车的四驱底盘。 */
{
  info = info || await loadCourse('beach');
  await page.evaluate(() => {
    const g = window.__garage;
    g.grantVehicle('turtle');
    g.grantVehicle('moto');
  });
}

if (should('drive')) {
  console.log('\n=== C. 三车驾驶 ===');
  if (!info) info = await loadCourse('beach');

  for (const v of vehicles) {
    console.log(`\n-- ${v} --`);
    const r = await page.evaluate(async (vehicle) => {
      const S = window.__sim;
      const T = S.trackInfo();
      const out = { vehicle };

      const placed = async (secId, t = 0.5, lat = 0) => {
        const sec = T.sections.find((s) => s.id === secId);
        const span = (sec.i1 - sec.i0 + T.samples) % T.samples;
        const i = Math.round((sec.i0 + span * t) % T.samples);
        S.place(0, i, lat);
        return i;
      };

      // 起步 + 加速
      await S.start({ vehicle });
      out.built = S.snapshot().player.vehicle;
      S.control({ throttle: 1 });
      S.step(1 / 60, 180);
      const a3 = S.snapshot().player;
      out.accelSpeed = a3.speed;
      out.accelKind = a3.kind;

      // 刹车
      S.control({ throttle: 0, brake: 1 });
      S.step(1 / 60, 90);
      out.brakeSpeed = S.snapshot().player.speed;

      // 左转 / 右转（用 yaw 变化判断，不依赖画面）
      const yawOf = () => window.__game.player.yaw;
      placed('sand', 0.5, 0);
      S.control({ throttle: 1 });
      S.step(1 / 60, 60);
      let y0 = yawOf();
      S.control({ throttle: 1, steer: -1 });
      S.step(1 / 60, 45);
      out.turnLeft = Math.abs(yawOf() - y0);
      S.control({ throttle: 1 });
      S.step(1 / 60, 30);
      y0 = yawOf();
      S.control({ throttle: 1, steer: 1 });
      S.step(1 / 60, 45);
      out.turnRight = Math.abs(yawOf() - y0);

      // 沙丘上坡：海拔必须上升
      const dune = T.sections.find((s) => s.id === 'dune');
      const iDune = S.place(0, dune.i0 + 4, 0).i;
      const yStart = S.snapshot().player.y;
      S.control({ throttle: 1 });
      S.step(1 / 60, 300);
      out.duneRise = +(S.snapshot().player.y - yStart).toFixed(2);

      // 渔村 S 弯：交给 AI 跑 8 s，看是否仍在赛道上、是否复位
      const vil = T.sections.find((s) => s.id === 'village');
      S.place(0, vil.i0 + 6, 0);
      window.__game.autopilot = true;
      const resp0 = window.__game.race.raceTime;
      S.step(1 / 60, 480);
      window.__game.autopilot = false;
      const afterV = S.snapshot().player;
      out.villageOffroad = afterV.offroad;
      out.villageLat = afterV.lat;
      out.villageKind = afterV.kind;

      // 木桥：从桥头前 20 m 开进去，记录是否连续通过、有没有掉下去
      const br = T.bridge;
      const iBefore = (br.i0 - 34 + T.samples) % T.samples;
      /* 这一段必须自己重开一局再跑。
       * 上面「渔村 S 弯」把自动驾驶开了一段，车上还挂着那一段留下的
       * 速度和状态；直接接着跑，慢车（海龟车）在测速窗口里还在从 4 m/s
       * 往上爬，48 m 的桥要走 5 s 以上 —— 那是上一段留下的状态，不是桥
       * 的问题。单独跑 --only=drive 时同一台车只要 2.9 s，和第一阶段一致。 */
      await S.start({ vehicle });
      S.step(1 / 60, 4);
      S.place(0, iBefore, 0);
      S.control({ throttle: 1 });
      let onBridge = 0, minY = Infinity, maxDrop = 0, respawns = 0;
      const origRespawn = window.__game.race.respawn.bind(window.__game.race);
      window.__game.race.respawn = (k) => { if (k.isPlayer) respawns++; return origRespawn(k); };
      for (let k = 0; k < 600; k++) {
        // 桥面窄：给一点修正，模拟玩家扶着方向
        const p = S.snapshot().player;
        S.control({ throttle: 1, steer: -Math.max(-0.35, Math.min(0.35, p.lat * 0.09)) });
        S.step(1 / 60, 1);
        const s2 = S.snapshot().player;
        if (s2.kind === 3) onBridge++;
        minY = Math.min(minY, s2.y);
        maxDrop = Math.max(maxDrop, s2.groundY - s2.y);
      }
      window.__game.race.respawn = origRespawn;
      out.bridgeFrames = onBridge;
      out.bridgeSeconds = +(onBridge / 60).toFixed(2);
      out.bridgeMinY = +minY.toFixed(2);
      out.bridgeMaxDrop = +maxDrop.toFixed(3);
      out.bridgeRespawns = respawns;
      out.bridgeY = +S.snapshot().player.y.toFixed(2);

      // 三圈完赛（自动驾驶）
      await S.start({ vehicle });
      const race = S.runRace({ maxSeconds: 320 });
      const me = race.karts.find((k) => k.isPlayer);
      out.race = {
        finished: me.finished, laps: me.laps, lapTimes: me.lapTimes,
        finishTime: me.finishTime, rank: me.rank, respawns: me.respawns,
        maxStallSec: me.maxStallSec, maxDrop: me.maxDrop, state: race.state,
        maxStallAt: me.maxStallAt, maxStallIndex: me.maxStallIndex,
        maxStallKind: me.maxStallKind,
      };
      return out;
    }, v);

    driveResults[v] = r;
    report.check(`C-${v} 车辆真的换成了 ${v}`, r.built === v, r.built);
    report.check(`C-${v} 起步 3 s 内加速`, r.accelSpeed > 8, `${r.accelSpeed} m/s`);
    report.check(`C-${v} 刹车把车停住`, r.brakeSpeed <= 0.5,
      `${r.accelSpeed} → ${r.brakeSpeed} m/s`);
    report.check(`C-${v} 按住刹车缓慢倒车（可控）`, r.brakeSpeed > -12,
      `倒车 ${r.brakeSpeed} m/s`);
    report.check(`C-${v} 左转有效`, r.turnLeft > 0.1, `${r.turnLeft.toFixed(3)} rad`);
    report.check(`C-${v} 右转有效`, r.turnRight > 0.1, `${r.turnRight.toFixed(3)} rad`);
    report.check(`C-${v} 沙丘上坡有海拔变化`, Math.abs(r.duneRise) > 0.8, `${r.duneRise} m`);
    report.check(`C-${v} 渔村 S 弯未飞出赛道`, Math.abs(r.villageLat) < 20, `lat ${r.villageLat}`);
    report.check(`C-${v} 木桥连续通行`, r.bridgeSeconds > 2.0 && r.bridgeSeconds < 5.0, `${r.bridgeSeconds} s`);
    report.check(`C-${v} 木桥未掉下去`, r.bridgeMaxDrop < 0.2 && r.bridgeRespawns === 0,
      `落差 ${r.bridgeMaxDrop} m，复位 ${r.bridgeRespawns} 次`);
    report.check(`C-${v} 三圈完赛`, r.race.finished && r.race.laps >= 3,
      `圈数 ${r.race.laps}，用时 ${r.race.finishTime} s`);
    report.check(`C-${v} 完赛时间合理（2:20–5:30）`, r.race.finishTime > 140 && r.race.finishTime < 330,
      `${r.race.finishTime} s`);
    report.check(`C-${v} 全程无长时间卡死`, r.race.maxStallSec < 6,
      `最长 ${r.race.maxStallSec} s @ ${r.race.maxStallAt}s · 采样点 ${r.race.maxStallIndex} · kind ${r.race.maxStallKind}`);
  }

  /* ---- 三车驾驶截图 ---- */
  for (const v of vehicles) {
    await page.evaluate(async (vehicle) => {
      const S = window.__sim;
      const T = S.trackInfo();
      await S.start({ vehicle });
      const sec = T.sections.find((s) => s.id === 'sand');
      const span = (sec.i1 - sec.i0 + T.samples) % T.samples;
      S.place(0, Math.round((sec.i0 + span * 0.45) % T.samples), -1.5);
      window.__game.autopilot = true;
      S.step(1 / 60, 150);
      window.__game.autopilot = false;
      S.control({ throttle: 0.6 });
      S.step(1 / 60, 6);
    }, v);
    await shot(`drive-${v}`);
  }

  /* ---- 木桥：驾驶视角 + 侧视 ---- */
  await page.evaluate(async () => {
    const S = window.__sim;
    const T = S.trackInfo();
    await S.start({ vehicle: 'red' });
    const br = T.bridge;
    S.place(0, (br.i0 - 26 + T.samples) % T.samples, 0);
    window.__game.autopilot = true;
    S.step(1 / 60, 150);
    window.__game.autopilot = false;
    S.control({ throttle: 0.55 });
    S.step(1 / 60, 4);
  });
  await shot('bridge-drive');

  await page.evaluate(() => {
    const S = window.__sim;
    const a = S.pointAt('bridge', 0.5);
    S.cam([a.x + 44, a.y + 16, a.z + 30], [a.x, a.y - 1, a.z], 50);
  });
  await shot('bridge-side');
}

/* ================================================================== *
 * D. 摩托专项
 * ================================================================== */
if (should('moto')) {
  console.log('\n=== D. 摩托专项 ===');
  if (!info) info = await loadCourse('beach');
  const r = await page.evaluate(async () => {
    const S = window.__sim;
    const T = S.trackInfo();
    await S.start({ vehicle: 'moto' });
    const k = window.__game.player;
    const m = k.model;
    const out = {
      vehicle: S.snapshot().player.vehicle,
      wheels: m.wheels?.length || 0,
      steerFront: !!m.wheels?.[0]?.steer,
      steerRear: !!m.wheels?.[1]?.steer,
      hasLeanGroup: !!m.body,
    };
    const sec = T.sections.find((s) => s.id === 'sand');
    const span = (sec.i1 - sec.i0 + T.samples) % T.samples;
    S.place(0, Math.round((sec.i0 + span * 0.4) % T.samples), 0);
    S.control({ throttle: 1 });
    S.step(1 / 60, 90);
    out.speed = +k.speed.toFixed(1);

    /* 自转：wheelSpin 是仿真里的累计角，syncVisual 才把它写进场景图。
     * 两条都测 —— 一条证明物理在累加，一条证明画面真的转了。 */
    const spin0 = m.wheels.map((w) => w.spin.rotation.x);
    const spinSim0 = k.wheelSpin;
    S.step(1 / 60, 20);
    S.sync();
    const spin1 = m.wheels.map((w) => w.spin.rotation.x);
    out.wheelSpinDelta = spin1.map((v, i) => +Math.abs(v - spin0[i]).toFixed(3));
    out.wheelSpinSimDelta = +(k.wheelSpin - spinSim0).toFixed(3);

    // 前轮转向（只有前轮动）。低速满舵才有设计值那么大的转角：
    // 高速时转向权限本身就被压低，量出来会比设计值小很多。
    S.place(0, Math.round((sec.i0 + span * 0.4) % T.samples), 0);
    S.step(1 / 60, 30);
    const yawW0 = m.wheels.map((w) => w.pivot.rotation.y);
    S.control({ throttle: 0.35, steer: 1 });
    S.step(1 / 60, 60);
    S.sync();
    const yawW1 = m.wheels.map((w) => w.pivot.rotation.y);
    out.frontSteerDelta = +(yawW1[0] - yawW0[0]).toFixed(3);
    out.rearSteerDelta = +(yawW1[1] - yawW0[1]).toFixed(3);
    out.steerVisual = +k.steerVisual.toFixed(3);
    out.steerMax = +(m.steerMax ?? 0).toFixed(3);
    out.lowSpeed = +k.speed.toFixed(1);

    // 压弯：车身绕纵轴倾斜（摩托车是内倾，方向和卡丁车外倾相反）
    out.leanTurning = +(m.body.rotation.z).toFixed(3);
    out.leanTurningSim = +k.lean.toFixed(3);
    const leanSign = Math.sign(m.body.rotation.z);

    // 回正：松开方向继续直行
    S.control({ throttle: 1, steer: 0 });
    S.step(1 / 60, 90);
    S.sync();
    out.leanStraight = +(m.body.rotation.z).toFixed(3);
    out.steerVisualStraight = +k.steerVisual.toFixed(3);
    out.leanSign = leanSign;
    return out;
  });
  report.check('D0 车辆真的是摩托', r.vehicle === 'moto', r.vehicle);
  report.check('D1 摩托两轮', r.wheels === 2, `${r.wheels} 轮`);
  report.check('D2 前轮转向节点', r.steerFront === true);
  report.check('D3 后轮不转向', r.steerRear === false);
  report.check('D4 两轮都在自转', r.wheelSpinDelta.every((d) => d > 0.05) && r.wheelSpinSimDelta > 1,
    `画面 ${JSON.stringify(r.wheelSpinDelta)} rad，仿真累计 ${r.wheelSpinSimDelta} rad`);
  report.check('D5 前轮有转向角', Math.abs(r.frontSteerDelta) > 0.08 &&
    Math.abs(Math.abs(r.frontSteerDelta) - Math.abs(r.steerVisual) * r.steerMax) < 0.02,
    `${r.frontSteerDelta} rad（steerVisual ${r.steerVisual} × 设计上限 ${r.steerMax}，车速 ${r.lowSpeed} m/s）`);
  report.check('D6 后轮转向角不变', Math.abs(r.rearSteerDelta) < 0.001, `${r.rearSteerDelta} rad`);
  report.check('D7 有压弯（车身侧倾）', Math.abs(r.leanTurning) > 0.02,
    `${r.leanTurning} rad（sim ${r.leanTurningSim}）`);
  report.check('D8 松手后回正',
    Math.abs(r.leanStraight) < Math.abs(r.leanTurning) * 0.25 && Math.abs(r.steerVisualStraight) < 0.05,
    `${r.leanTurning} → ${r.leanStraight} rad，方向 ${r.steerVisual} → ${r.steerVisualStraight}`);
}

/* ================================================================== *
 * E. 8 车三圈
 * ================================================================== */
if (should('field')) {
  console.log('\n=== E. 8 车三圈 ===');
  if (!info) info = await loadCourse('beach');
  const race = await page.evaluate(async () => {
    const S = window.__sim;
    await S.start({ vehicle: 'red' });
    return S.runRace({ maxSeconds: 420 });
  });
  const ks = race.karts;
  report.check('E1 场上 8 台车', ks.length === 8, String(ks.length));
  report.check('E2 8 台车全部完成三圈', ks.every((k) => k.finished && k.laps >= 3),
    `圈数 ${ks.map((k) => k.laps).join(',')} · 出界帧 ${ks.map((k) => k.offroadFrames).join(',')} · 完赛 ${ks.map((k) => k.finishTime).join(',')}`);
  const worstStall = Math.max(...ks.map((k) => k.maxStallSec));
  report.check('E3 无车长时间卡死', worstStall < 8, `最长 ${worstStall} s`);
  const worstBridge = Math.max(...ks.map((k) => k.maxBridgeStall));
  report.check('E4 桥面没有长时间停滞', worstBridge < 3, `桥面最长低速停留 ${worstBridge.toFixed(1)} s`);
  const bridgeTimes = ks.map((k) => k.bridgeSec);
  report.check('E5 每台车都真的过了桥', bridgeTimes.every((t) => t > 0.5),
    bridgeTimes.join(','));
  const drop = Math.max(...ks.map((k) => k.maxDrop));
  const worst = ks.reduce((a, b) => (b.maxDrop > a.maxDrop ? b : a));
  const maxVy = Math.max(...ks.map((k) => k.maxVy));
  const vyWorst = ks.reduce((a, b) => (b.maxVy > a.maxVy ? b : a));
  report.check('E6 无陷地（贴地帧）', drop < 0.08,
    `最大穿透 ${drop.toFixed(3)} m @ 采样点 ${worst.maxDropIndex} · kind ${worst.maxDropKind} · ${worst.maxDropSpeed} m/s`);
  report.check('E6b 无异常弹射（向上速度只来自漂移起跳 5.4）', maxVy < 5.6,
    `最大 vy ${maxVy} m/s @ 采样点 ${vyWorst.maxVyIndex} · hop 剩余 ${vyWorst.maxVyHop}s · t=${vyWorst.maxVyAt}s`);
  report.check('E7 完赛顺序唯一', new Set(race.finishOrder).size === race.finishOrder.length);
  report.check('E8 排名 1..8 唯一', new Set(ks.map((k) => k.rank)).size === 8,
    ks.map((k) => k.rank).join(','));
  report.check('E9 冠军完成时间合理', ks.find((k) => k.rank === 1).finishTime > 130,
    `${ks.find((k) => k.rank === 1).finishTime} s`);
  const worstOffroad = Math.max(...ks.map((k) => k.offroadFrames));
  report.check('E10 出界帧数可控（<25% 帧）', worstOffroad < 420 * 60 * 0.25,
    `最多 ${worstOffroad} 帧`);
  report.data = { race };
}

/* ================================================================== *
 * F. 碰撞与复位
 * ================================================================== */
if (should('collide')) {
  console.log('\n=== F. 碰撞与复位 ===');
  if (!info) info = await loadCourse('beach');
  const r = await page.evaluate(async () => {
    const S = window.__sim;
    const T = S.trackInfo();
    const out = {};

    // 1) 桥栏：在桥中间强行往右打满，车不能越过半宽
    await S.start({ vehicle: 'red' });
    const br = T.bridge;
    const mid = Math.round((br.i0 + (br.i1 - br.i0) * 0.5) % T.samples);
    S.place(0, mid, 0);
    let maxLat = 0;
    for (let k = 0; k < 240; k++) {
      S.control({ throttle: 0.7, steer: 1 });
      S.step(1 / 60, 1);
      const p = S.snapshot().player;
      maxLat = Math.max(maxLat, Math.abs(p.lat));
    }
    out.bridgeMaxLat = +maxLat.toFixed(2);
    out.bridgeHalfWidth = +(window.__game.track.width[mid]).toFixed(2);

    // 2) 逆行：倒着开，watcher 应该报出来
    await S.start({ vehicle: 'red' });
    const sec = T.sections.find((s) => s.id === 'sand');
    const span = (sec.i1 - sec.i0 + T.samples) % T.samples;
    S.place(0, Math.round((sec.i0 + span * 0.5) % T.samples), 0);
    const k0 = window.__game.player;
    k0.yaw += Math.PI;                       // 掉头
    k0.visualYaw = k0.yaw;
    S.control({ throttle: 1 });
    let warned = false;
    for (let k = 0; k < 400 && !warned; k++) {
      S.step(1 / 60, 1);
      if (window.__game.wrongWay.active) warned = true;
    }
    out.wrongWay = warned;

    /* 3) 安全网：把车压到路面下方 20 m（= 从桥上掉下去 / 陷进地形）。
     *
     * 为什么不是「横向扔出赛道」：沙滩赛道两侧本来就有烘焙好的护栏，
     * 车根本到不了 3.2 倍半宽以外 —— 实测扔到 60 m 那一帧就被护栏弹回
     * 路肩，永远不会触发 race.respawn 的出界分支。
     * 真正要看的是结果：落下去之后必须回到路面上，不能一直往下掉。 */
    await S.start({ vehicle: 'red' });
    S.place(0, Math.round(sec.i0 + span * 0.3), 0);
    S.step(1 / 60, 10);
    const p = window.__game.player;
    const roadY0 = window.__game.track.pointAt(p.trackIndex, 0).y;
    p.position.y -= 20;
    let respawned = false;
    const orig = window.__game.race.respawn.bind(window.__game.race);
    window.__game.race.respawn = (k) => { if (k.isPlayer) respawned = true; return orig(k); };
    S.step(1 / 60, 120);
    window.__game.race.respawn = orig;
    out.fellRespawnCalled = respawned;
    out.afterLat = +S.snapshot().player.lat.toFixed(2);
    out.dyFromRoad = +(window.__game.player.position.y - roadY0).toFixed(2);

    /* 4) 手动复位接口 = 屏幕上「回到赛道」按钮走的那条路（touch.onReset →
     *    race.respawn(player)）。儿童卡在护栏边时全靠它，必须真的把人送回路面。 */
    await S.start({ vehicle: 'red' });
    const corner = T.sections.find((s) => s.id === 'village');
    const iCorner = Math.round((corner.i0 + (corner.i1 - corner.i0) * 0.5) % T.samples);
    S.place(0, iCorner, window.__game.track.width[iCorner] - 0.6);
    const kk = window.__game.player;
    kk.yaw += Math.PI * 0.35;                       // 车头顶着护栏
    kk.visualYaw = kk.yaw;
    kk.speed = 0;
    window.__game.race.respawn(kk);
    const afterManual = S.snapshot().player;
    out.manualLat = Math.abs(afterManual.lat);
    const tan = window.__game.track.getTangent(kk.trackIndex);
    const head = { x: Math.sin(kk.yaw), z: Math.cos(kk.yaw) };
    out.manualAlign = +(head.x * tan.x + head.z * tan.z).toFixed(3);
    out.manualSpeed = +kk.speed.toFixed(2);
    return out;
  });
  report.check('F1 桥栏挡住车辆', r.bridgeMaxLat <= r.bridgeHalfWidth + 0.6,
    `最大横向 ${r.bridgeMaxLat} m / 半宽 ${r.bridgeHalfWidth} m`);
  report.check('F2 逆行提示会触发', r.wrongWay);
  report.check('F3 掉下路面后自动回到路面',
    Math.abs(r.afterLat) < 6 && Math.abs(r.dyFromRoad) < 1.5,
    `lat ${r.afterLat} m，距路面 ${r.dyFromRoad} m${r.fellRespawnCalled ? '（走 respawn）' : '（物理吸附）'}`);
  report.check('F4 手动复位把车送回路面', r.manualLat < 4, `lat ${r.manualLat} m`);
  report.check('F5 复位后朝向沿赛道、速度合理',
    r.manualAlign > 0.8 && r.manualSpeed > 0 && r.manualSpeed < 12,
    `朝向·切线 ${r.manualAlign}，速度 ${r.manualSpeed} m/s`);
}

/* ================================================================== *
 * G. 第一章回归
 * ================================================================== */
if (should('regress')) {
  console.log('\n=== G. 第一章回归 ===');
  const viejo = await loadCourse('viejo');
  report.check('G1 第一章仍是默认赛道', viejo.course === 'viejo', viejo.course);
  /* 基线不是手写的：拿 Git HEAD 里的老 courses.js 单独跑一遍
   * CatmullRomCurve3（closed / catmullrom / 0.5）复算出来的就是
   * viejo = 1295.32 m、expreso = 2433.90 m。实测必须一毫米不差。 */
  report.near('G2 第一章全长未变', viejo.length, 1295.32, 0.5, ' m');
  report.check('G3 第一章没有分段表（不受第二章影响）', viejo.sections === null);
  report.check('G4 第一章仍是 3 圈', viejo.laps === 3, String(viejo.laps));
  report.check('G5 第一章检查点 32 个', viejo.checkpoints.length === 32);
  report.check('G5b 第一章控制点仍是 23 个', viejo.controlPoints === 23, String(viejo.controlPoints));

  const run = await page.evaluate(async () => {
    const S = window.__sim;
    await S.start({ vehicle: 'red' });
    S.control({ throttle: 1 });
    S.step(1 / 60, 240);
    const a = S.snapshot();
    return { speed: a.player.speed, lat: a.player.lat, kind: a.player.kind, grip: a.player.surfaceGrip };
  });
  report.check('G6 第一章能开（4 s 内加速）', run.speed > 8, `${run.speed} m/s`);
  report.check('G7 第一章抓地系数仍为 1.0', Math.abs(run.grip - 1) < 0.01, String(run.grip));

  const race = await page.evaluate(() => window.__sim.runRace({ maxSeconds: 300 }));
  report.check('G8 第一章 8 车仍能跑完三圈',
    race.karts.every((k) => k.finished) && race.karts.length === 8,
    race.karts.map((k) => `${k.laps}L`).join(','));
  report.check('G9 第一章无掉出路面 / 陷地',
    race.karts.every((k) => k.maxDrop < 0.5),
    `最大落差 ${Math.max(...race.karts.map((k) => k.maxDrop))} m`);

  // 高速环线也要一起回归：第二章改了 courses.js 的导出方式，别把老赛道弄丢
  const ex = await loadCourse('expreso');
  report.near('G10 高速环线全长未变', ex.length, 2433.9, 1, ' m');
  report.check('G11 高速环线仍是 2 圈', ex.laps === 2, String(ex.laps));
  report.data = { viejo, expreso: ex.length, race };
}

/* ================================================================== *
 * 收尾
 * ================================================================== */
report.check('Z1 无 JS 运行时报错', consoleErrors.length === 0,
  consoleErrors.slice(0, 3).map((e) => e.slice(0, 120)).join(' | '));

await browser.close();
await srv.close();

report.write(path.join(OUT, 'stage1-report.json'));
console.log(`\n============================`);
console.log(`通过 ${report.items.filter((i) => i.ok).length} / ${report.items.length}`);
if (!report.ok) {
  console.log('失败项：');
  for (const f of report.failed) console.log(`  ✗ ${f.name} — ${f.detail}`);
}
console.log(`报告：${path.join(OUT, 'stage1-report.json')}`);
process.exit(report.ok ? 0 : 1);
