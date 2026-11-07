/* 分组隐藏，定位 11-bridge-side 里的黑色穹顶来自哪一层。 */
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
await page.evaluate(async () => { await window.__sim.start({ vehicle: 'red' }); });

await page.evaluate(() => {
  const S = window.__sim;
  const a = S.pointAt('bridge', 0.5, 0);
  const p = S.pointAt('bridge', 0.49, 0);
  const q = S.pointAt('bridge', 0.51, 0);
  let tx = q.x - p.x, tz = q.z - p.z;
  const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
  const rx = -tz, rz = tx;
  S.cam([a.x + rx * 46, 8.6, a.z + rz * 46], [a.x, 3.4, a.z], 40);
});

const variants = [
  ['iso-0-base', () => {}],
  ['iso-1-noshadow', () => {
    window.__game.engine.scene.traverse((o) => { if (o.isMesh) o.receiveShadow = false; });
  }],
  ['iso-2-nobeach', () => {
    window.__game.beach.group.visible = false;
  }],
];
for (const [name, fn] of variants) {
  await page.evaluate(fn);
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: path.join(SHOTS, 'stage2', name + '.png') });
  console.log(' ', name);
}
await browser.close();
process.exit(0);
