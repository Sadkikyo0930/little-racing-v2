/* 桥面近景俯拍：看板缝到底有多宽、暗带是几何缝隙还是着色。 */
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
  const bf = window.__game.items?.boxField;
  if (bf?.meshes) for (const m of bf.meshes) m.visible = false;
});

// 1) 正俯视 6 m
await page.evaluate(() => {
  const S = window.__sim;
  const c = S.pointAt('bridge', 0.5, 0);
  S.cam([c.x, c.y + 6, c.z + 0.01], [c.x, c.y, c.z], 55);
});
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: path.join(SHOTS, 'stage2', 'dbg-deck-top.png') });
console.log(' dbg-deck-top');

// 1b) 小视场角俯视 ≈ 放大 4 倍，看清单块板与板缝
await page.evaluate(() => {
  const S = window.__sim;
  const c = S.pointAt('bridge', 0.5, 0);
  S.cam([c.x, c.y + 8, c.z + 0.01], [c.x, c.y, c.z], 16);
});
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: path.join(SHOTS, 'stage2', 'dbg-deck-zoom.png') });
console.log(' dbg-deck-zoom');

// 2) 低角度掠视
await page.evaluate(() => {
  const S = window.__sim;
  const c = S.pointAt('bridge', 0.5, 0);
  const p = S.pointAt('bridge', 0.48, 0);
  const q = S.pointAt('bridge', 0.52, 0);
  let tx = q.x - p.x, tz = q.z - p.z;
  const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
  S.cam([c.x - tx * 8 + -tz * 3, c.y + 1.2, c.z - tz * 8 + tx * 3], [c.x, c.y + 0.2, c.z], 50);
});
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: path.join(SHOTS, 'stage2', 'dbg-deck-graze.png') });
console.log(' dbg-deck-graze');

// 3) 去掉板缝（scaleZ 改成刚好 0.34 的整数倍）验证是否缝隙导致
await page.evaluate(() => {
  const B = window.__game.beach;
  const g = B.group.getObjectByName('ch2:bridge_plank');
  for (const im of g.children) im.material = im.material.clone(), im.material.color.set(0xffffff), im.material.map = null, im.material.normalMap = null;
});
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: path.join(SHOTS, 'stage2', 'dbg-deck-flat.png') });
console.log(' dbg-deck-flat');

await browser.close();
process.exit(0);
