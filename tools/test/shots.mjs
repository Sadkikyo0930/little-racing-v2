/* ==================================================================
 * 第二章第一阶段 · 验收截图
 *
 *   node tools/test/shots.mjs          拍全部
 *   node tools/test/shots.mjs --no-build
 *
 * 每张图都会检查「不是全黑 / 不是纯色」，避免再出现交付里塞一张黑图。
 * 输出：tools/out/shots/*.png
 * ================================================================== */
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import {
  startServer, findBrowser, CHROME_ARGS, loadPuppeteer, ensureDirs, SHOTS,
} from './lib.mjs';

const ARG = process.argv.slice(2);
if (!ARG.includes('--no-build')) {
  console.log('· 构建 dist/ …');
  execFileSync('npx', ['vite', 'build'], { cwd: path.resolve('.'), stdio: ['ignore', 'ignore', 'inherit'], shell: true });
}

const puppeteer = await loadPuppeteer();
const srv = await startServer();
const browser = await puppeteer.launch({
  executablePath: findBrowser(), headless: true, args: CHROME_ARGS, protocolTimeout: 1800000,
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/^Failed to load resource/.test(t) && /ERR_(CONNECTION_CLOSED|ABORTED)/.test(t)) return;
  consoleErrors.push(t);
});
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });

await page.goto(`${srv.url}/?course=beach`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__sim, { timeout: 300000, polling: 300 });
await page.evaluate(() => {
  window.__garage.grantVehicle('turtle');
  window.__garage.grantVehicle('moto');
});
/* 第一张图会拍到「场景还在编译 / 贴图还在上传」的黑屏，先空跑一局预热。 */
await page.evaluate(async () => {
  const S = window.__sim;
  await S.start({ vehicle: 'red' });
  S.step(1 / 60, 30);
});
await new Promise((r) => setTimeout(r, 2500));

const results = [];
async function shot(name, label) {
  /* 追尾相机是平滑跟随：S.place() 把车瞬移几百米之后，相机要好几帧才追上来。
   * 只等 0.4 s 拍到的还是「相机在半路上」的远景（车根本不在画面里）。 */
  await new Promise((r) => setTimeout(r, 1400));
  const file = path.join(SHOTS, name + '.png');
  await page.screenshot({ path: file });
  // 亮度/色彩分布：全黑或纯色都判失败
  const stat = await page.evaluate(async (dataUrl) => {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 160; c.height = 90;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 160, 90);
    const d = g.getImageData(0, 0, 160, 90).data;
    let sum = 0;
    const hist = new Set();
    for (let i = 0; i < d.length; i += 4) {
      sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
      hist.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4));
    }
    return { mean: sum / (d.length / 4), colors: hist.size };
  }, 'data:image/png;base64,' + fs.readFileSync(file).toString('base64'));
  const ok = stat.mean > 25 && stat.colors > 25;
  results.push({ name, label, ok, ...stat });
  console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(22)} ${label} — 亮度 ${stat.mean.toFixed(1)}，色块 ${stat.colors}`);
}

/* 1-3. 三辆车在金色沙滩直道上行驶 */
for (const v of ['red', 'turtle', 'moto']) {
  await page.evaluate(async (vehicle) => {
    const S = window.__sim;
    const T = S.trackInfo();
    await S.start({ vehicle });
    const sec = T.sections.find((s) => s.id === 'sand');
    const span = (sec.i1 - sec.i0 + T.samples) % T.samples;
    S.place(0, Math.round((sec.i0 + span * 0.45) % T.samples), -1.2);
    S.control({ throttle: 0.85 });
    S.step(1 / 60, 90);
  }, v);
  await shot(`drive-${v}`, `${v} 在金色沙滩直道`);
}

/* 4. 木桥驾驶视角：把车放到桥中段，低速前进，确保追尾相机在车后 */
await page.evaluate(async () => {
  const S = window.__sim;
  const T = S.trackInfo();
  await S.start({ vehicle: 'red' });
  const br = T.bridge;
  const iMid = Math.round((br.i0 + (br.i1 - br.i0) * 0.45) % T.samples);
  S.place(0, iMid, -1.0);
  S.control({ throttle: 0.45 });
  S.step(1 / 60, 40);          // 只走 0.7 s，车还在桥面上
});
await shot('bridge-drive', '木桥驾驶视角（桥面 + 栏杆 + 水面）');

/* 5. 木桥侧视：从河道外侧看整座桥，车停在桥中 */
await page.evaluate(() => {
  const S = window.__sim;
  const a = S.pointAt('bridge', 0.5);
  S.cam([a.x + 40, a.y + 13, a.z + 26], [a.x, a.y - 2.5, a.z], 50);
});
await shot('bridge-side', '木桥侧视（桥墩 + 河道 + 桥面）');

/* 6-9. 各路段 */
const secs = [
  ['point', 0.45, '礁石岬角（R33 急弯）'],
  ['dune', 0.5, '沙丘爬坡（6.10% 坡度）'],
  ['village', 0.5, '渔村 S 弯'],
  ['bridgehead', 0.5, '桥头回旋'],
  ['plaza', 0.5, '沙滩节广场（木栈道）'],
];
for (const [id, t, label] of secs) {
  await page.evaluate(async ([secId, tt]) => {
    const S = window.__sim;
    S.releaseCam();
    const T = S.trackInfo();
    const sec = T.sections.find((s) => s.id === secId);
    const span = (sec.i1 - sec.i0 + T.samples) % T.samples;
    S.place(0, Math.round((sec.i0 + span * tt) % T.samples), 0);
    S.control({ throttle: 0.75 });
    S.step(1 / 60, 60);
  }, [id, t]);
  await shot(`sec-${id}`, label);
}

/* 10. 鸟瞰：整条环线 */
await page.evaluate(() => {
  const S = window.__sim;
  const T = S.trackInfo();
  const a = S.pointAt('sand', 0.5);
  S.cam([a.x - 40, a.y + 150, a.z + 180], [a.x, a.y, a.z], 55);
});
await shot('aerial', '贝壳湾环线鸟瞰');

await browser.close();

console.log('\n============================');
const bad = results.filter((r) => !r.ok);
console.log(`截图 ${results.length - bad.length} / ${results.length} 有效`);
if (bad.length) console.log('无效：', bad.map((b) => `${b.name}(亮度${b.mean.toFixed(0)}/色块${b.colors})`).join(' '));
if (consoleErrors.length) console.log('页面报错：', consoleErrors.slice(0, 5));
process.exit(bad.length || consoleErrors.length ? 1 : 0);
