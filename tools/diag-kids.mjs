/* 列出 scene 的直接子节点，然后逐个只留一个可见，拍图定位黑色穹顶。 */
import path from 'node:path';
import { startServer, findBrowser, CHROME_ARGS, loadPuppeteer, SHOTS } from './test/lib.mjs';

const puppeteer = await loadPuppeteer();
const srv = await startServer();
const browser = await puppeteer.launch({
  executablePath: findBrowser(), headless: true, args: CHROME_ARGS, protocolTimeout: 900000,
});
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 540 });
await page.goto(`${srv.url}/?course=beach`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__sim, { timeout: 600000, polling: 400 });
await page.evaluate(async () => { await window.__sim.start({ vehicle: 'red' }); });

const kids = await page.evaluate(() => {
  const scene = window.__game.engine.scene;
  return scene.children.map((c, i) => `${i}:${c.name || c.type}:${c.children?.length ?? 0}`);
});
console.log(kids.join('\n'));

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

const n = kids.length;
for (let i = 0; i < n; i++) {
  await page.evaluate((i) => {
    const scene = window.__game.engine.scene;
    scene.children.forEach((c, k) => { c.visible = i < 0 ? true : k === i; });
  }, i);
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: path.join(SHOTS, 'stage2', `iso-k${String(i).padStart(2, '0')}.png`) });
}
console.log('done', n);
await browser.close();
process.exit(0);
