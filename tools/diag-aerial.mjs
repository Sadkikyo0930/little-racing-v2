/* 高空俯瞰，用来看地形轮廓/远场/海面接缝有没有硬边。 */
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

const shots = [
  ['aerial-a', 200, 40, 150],
  ['aerial-b', 320, 30, 60],
];
for (const [name, alt, fwd, up] of shots) {
  await page.evaluate((alt, fwd, up) => {
    const S = window.__sim;
    const c = S.pointAt('village', 0.4, 0);
    S.cam([c.x, c.y + alt, c.z + fwd], [c.x, c.y - up, c.z], 55);
  }, alt, fwd, up);
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: path.join(SHOTS, 'stage2', name + '.png') });
  console.log(' ', name);
}
// 沿桥看内陆，找那个黑色穹顶
await page.evaluate(() => {
  const S = window.__sim;
  const c = S.pointAt('bridge', 0.5, 0);
  S.cam([c.x, c.y + 26, c.z + 90], [c.x, c.y + 4, c.z], 55);
});
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: path.join(SHOTS, 'stage2', 'aerial-c.png') });
console.log('  aerial-c');
await browser.close();
process.exit(0);
