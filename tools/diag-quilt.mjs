/* 桥面「深色格子」到底是谁：逐个隐藏 road-3 托板 / 河道 / 桥板，各拍一张俯视。 */
import path from 'node:path';
import { startServer, findBrowser, CHROME_ARGS, loadPuppeteer, SHOTS } from './test/lib.mjs';

const puppeteer = await loadPuppeteer();
const srv = await startServer();
const browser = await puppeteer.launch({
  executablePath: findBrowser(), headless: true, args: CHROME_ARGS, protocolTimeout: 900000,
});
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 600 });
await page.goto(`${srv.url}/?course=beach`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__sim, { timeout: 600000, polling: 400 });
await page.evaluate(async () => {
  await window.__sim.start({ vehicle: 'red' });
  const S = window.__sim;
  const c = S.pointAt('bridge', 0.5, 0);
  S.cam([c.x, c.y + 8, c.z + 0.01], [c.x, c.y, c.z], 16);
});

const steps = [
  ['zz-0-base', () => {}],
  ['zz-1-no-road3', () => {
    const r = window.__game.engine.scene.getObjectByName('road-3');
    if (r) r.visible = false;
  }],
  ['zz-4-road3-low', () => {
    const r = window.__game.engine.scene.getObjectByName('road-3');
    if (r) { r.visible = true; r.position.y = -0.5; }
  }],
];
console.log(await page.evaluate(() => {
  const r = window.__game.engine.scene.getObjectByName('road-3');
  if (!r) return 'no road-3';
  return { y: r.position.y, parent: r.parent?.name, pos: r.parent?.position.y };
}));
for (const [name, fn] of steps) {
  await page.evaluate(fn);
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: path.join(SHOTS, 'stage2', name + '.png') });
  console.log(' ', name);
}
await browser.close();
process.exit(0);
