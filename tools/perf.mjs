/* ==================================================================
 * 画面 / 性能探针
 *
 *   node tools/perf.mjs --dir=dist --label=stage2 --out=tools/out/perf-stage2.json
 *
 * 输出两类数据：
 *   1. 与 GPU 无关、可跨机器比较的预算指标（draw call / 三角面 /
 *      几何体 / 贴图 / 着色器程序）—— 这些是真正决定手机能不能跑的东西；
 *   2. 本机帧时间（SwiftShader 软件光栅化）。
 *
 * 注意：本机没有 iPhone，这里的帧时间**只能做同机同比**，不代表
 * iPhone Safari 的真实帧率。软件光栅化比手机 GPU 慢一个数量级，
 * 绝对值没有参考意义，两组数据的**比值**有意义。
 * ================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { startServer, findBrowser, CHROME_ARGS, loadPuppeteer } from './test/lib.mjs';

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=')[1] : d;
};
const DIR = path.resolve(arg('dir', 'dist'));
const LABEL = arg('label', path.basename(DIR));
const OUT = arg('out', '');
const COURSES = (arg('courses', 'beach,city')).split(',');

const puppeteer = await loadPuppeteer();
const srv = await startServer(DIR);
const browser = await puppeteer.launch({
  executablePath: findBrowser(), headless: true, args: CHROME_ARGS, protocolTimeout: 900000,
});

async function measure(course, w, h) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.goto(`${srv.url}/?course=${course}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => !!window.__sim, { timeout: 600000, polling: 400 });
  // 开一局、放到直道上，镜头里有路面 + 场景道具，才是正常的渲染负载
  await page.evaluate(async () => {
    try { await window.__garage.grantVehicle('turtle'); } catch { /* 第一章也有 */ }
    try { await window.__garage.grantVehicle('moto'); } catch { /* 忽略 */ }
    await window.__sim.start({ vehicle: 'red' });
    const S = window.__sim, T = S.trackInfo();
    S.place(0, Math.round(240 / (T.length / T.samples)), 0);
    S.step(1 / 60, 30);
  });
  await new Promise((r) => setTimeout(r, 5000));   // 让启动遮罩淡完、阴影贴图烤好

  const res = await page.evaluate(async () => {
    const g = window.__game;
    const info = g.engine.renderer.info;
    /* renderer.info.autoReset 默认是开的，每次 render() 开头清零；后处理
     * 一帧里会跑好几次 render()，所以直接读只会读到最后一个全屏 copy pass
     * 的 1 次 draw call。这里关掉自动清零、手动 reset 一次，累计 N 帧再
     * 平均 —— 才是「一帧真正提交了多少 draw call / 三角面」。 */
    info.autoReset = false;
    info.reset();
    const ts = [];
    const FRAMES = 41;
    await new Promise((done) => {
      let n = 0;
      const tick = (now) => {
        ts.push(now);
        if (++n < FRAMES) requestAnimationFrame(tick); else done();
      };
      requestAnimationFrame(tick);
    });
    const frames = ts.length - 1;
    const acc = {
      calls: info.render.calls / frames,
      tris: info.render.triangles / frames,
    };
    // 中位数帧时间（丢头两帧，含首帧编译）
    const dt = [];
    for (let i = 2; i < ts.length; i++) dt.push(ts[i] - ts[i - 1]);
    dt.sort((a, b) => a - b);
    const med = dt[Math.floor(dt.length / 2)];
    const p95 = dt[Math.floor(dt.length * 0.95)];
    const b = g.beach;
    return {
      drawCalls: Math.round(acc.calls),
      triangles: Math.round(acc.tris),
      lines: 0,
      points: 0,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: g.engine.renderer.info.programs?.length ?? null,
      frameMedianMs: +med.toFixed(1),
      frameP95Ms: +p95.toFixed(1),
      fpsMedian: +(1000 / med).toFixed(1),
      beachStats: b ? { ...b.stats, propCounts: b.propCounts } : null,
      shadowMap: g.engine.quality?.shadowMap ?? null,
      pixelRatio: g.engine.renderer.getPixelRatio(),
    };
  });
  res.course = course;
  res.viewport = `${w}×${h}`;
  await page.close();
  return res;
}

const out = { label: LABEL, dir: DIR, machine: process.platform, note: 'SwiftShader 软件光栅化，仅作同机同比', runs: [] };
for (const course of COURSES) {
  const VPS = (arg('viewports', '1280,844')).split(',').map(Number);
const ALL = [[1280, 720], [844, 390]];
for (const [w, h] of ALL.filter(([w]) => VPS.includes(w))) {
    const r = await measure(course, w, h);
    out.runs.push(r);
    console.log(`${course} ${r.viewport}  calls=${r.drawCalls} tri=${r.triangles} ` +
      `geo=${r.geometries} tex=${r.textures} prog=${r.programs} ` +
      `帧中位=${r.frameMedianMs}ms (${r.fpsMedian} fps) p95=${r.frameP95Ms}ms`);
    if (r.beachStats?.drawCalls) {
      console.log(`   海滩层：${r.beachStats.drawCalls} draw / ${r.beachStats.instances} 实例 / ${r.beachStats.tris} 三角面`);
    }
  }
}

if (OUT) {
  fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
  fs.writeFileSync(path.resolve(OUT), JSON.stringify(out, null, 1));
  console.log('→ ' + OUT);
}
await browser.close();
process.exit(0);
