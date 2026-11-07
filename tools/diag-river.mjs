/* 河水斑块来源：不透明度 / 法线图 / 床面 —— 三个变体各拍一张。 */
import path from 'node:path';
import { startServer, findBrowser, CHROME_ARGS, loadPuppeteer, SHOTS } from './test/lib.mjs';

const puppeteer = await loadPuppeteer();
const srv = await startServer();
const browser = await puppeteer.launch({
  executablePath: findBrowser(), headless: true, args: CHROME_ARGS, protocolTimeout: 900000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 620 });
await page.goto(`${srv.url}/?course=beach`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__sim, { timeout: 600000, polling: 400 });
await page.evaluate(async () => {
  await window.__sim.start({ vehicle: 'red' });
  const S = window.__sim;
  const a = S.pointAt('bridge', 0.5, 0);
  const p = S.pointAt('bridge', 0.49, 0);
  const q = S.pointAt('bridge', 0.51, 0);
  let tx = q.x - p.x, tz = q.z - p.z;
  const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
  const rx = -tz, rz = tx;
  S.cam([a.x + rx * 40, 7.0, a.z + rz * 40], [a.x, 2.0, a.z], 42);
});

const steps = [
  ['rv-0-base', () => {}],
  ['rv-1-opaque', () => { window.__game.beach.river.material.opacity = 1; window.__game.beach.river.material.transparent = false; }],
  ['rv-2-nonormal', () => {
    const m = window.__game.beach.river.material;
    m.normalMap = null; m.needsUpdate = true;
  }],
  ['rv-3-nobed', () => {
    const t = window.__game.engine.scene.getObjectByName('beachTerrain');
    if (t) t.visible = false;
  }],
];
for (const [name, fn] of steps) {
  await page.evaluate(fn);
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: path.join(SHOTS, 'stage2', name + '.png') });
  console.log(' ', name);
}
await browser.close();
process.exit(0);
