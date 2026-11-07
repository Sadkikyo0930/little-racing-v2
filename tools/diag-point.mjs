/* 礁石岬角：一次拍 4 个候选弧长 + 1 个岸边定点机位，挑构图最好的。 */
import path from 'node:path';
import { startServer, findBrowser, CHROME_ARGS, loadPuppeteer, SHOTS } from './test/lib.mjs';

const puppeteer = await loadPuppeteer();
const srv = await startServer();
const browser = await puppeteer.launch({
  executablePath: findBrowser(), headless: true, args: CHROME_ARGS, protocolTimeout: 900000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto(`${srv.url}/?course=beach`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__sim, { timeout: 600000, polling: 400 });
await page.evaluate(async () => {
  await window.__sim.start({ vehicle: 'red' });
  const bf = window.__game.items?.boxField;
  if (bf?.meshes) for (const m of bf.meshes) m.visible = false;
  const S = window.__sim;
  const T = S.trackInfo();
  S.place(0, Math.round(30 / (T.length / T.samples)), 0);
  S.step(1 / 60, 20);
});
await new Promise((r) => setTimeout(r, 4200));
await page.screenshot({ path: path.join(SHOTS, 'stage2', '_warmup.png') });

for (const d of [370, 400, 430, 460]) {
  await page.evaluate((d) => {
    const S = window.__sim;
    const T = S.trackInfo();
    S.releaseCam();
    S.place(0, Math.round(d / (T.length / T.samples)), 0);
    S.control({ throttle: 0.5 });
    S.step(1 / 60, 26);
    S.control({ throttle: 0 });
  }, d);
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(SHOTS, 'stage2', `pt-${d}.png`) });
  console.log('  pt-' + d);
}

// 岸边定点：t=0.78 处向海侧 34 m，贴近水面回望礁石与路面
await page.evaluate(() => {
  const S = window.__sim;
  const c = S.pointAt('point', 0.78, 0);
  const p = S.pointAt('point', 0.76, 0);
  const q = S.pointAt('point', 0.80, 0);
  let tx = q.x - p.x, tz = q.z - p.z;
  const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
  const rx = -tz, rz = tx;
  S.cam([c.x + rx * 34, 2.2, c.z + rz * 34], [c.x + rx * 6, 3.0, c.z + rz * 6], 52);
});
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: path.join(SHOTS, 'stage2', 'pt-cove.png') });
console.log('  pt-cove');
await browser.close();
process.exit(0);
