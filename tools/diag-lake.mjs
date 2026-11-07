/* 诊断：金色沙滩直道内侧那块「蓝色方形水塘」到底是什么。
 * 分别隐藏 river / ocean / terrain 各拍一张，对照定位。
 * 用法：node tools/diag-lake.mjs
 */
import path from 'node:path';
import fs from 'node:fs';
import { startServer, findBrowser, CHROME_ARGS, loadPuppeteer, SHOTS } from './test/lib.mjs';

const OUT = path.join(SHOTS, 'stage2');
fs.mkdirSync(OUT, { recursive: true });
const puppeteer = await loadPuppeteer();
const srv = await startServer();
const browser = await puppeteer.launch({
  executablePath: findBrowser(), headless: true, args: CHROME_ARGS, protocolTimeout: 900000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
await page.goto(`${srv.url}/?course=beach`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__sim, { timeout: 600000, polling: 400 });
await page.evaluate(async () => {
  await window.__garage.grantVehicle('turtle');
  await window.__garage.grantVehicle('moto');
  await window.__sim.start({ vehicle: 'red' });
  const bf = window.__game.items?.boxField;
  if (bf?.meshes) for (const m of bf.meshes) m.visible = false;
});

async function shot(name, fn) {
  await page.evaluate((fnSrc) => {
    const S = window.__sim, T = window.__game.track, B = window.__game.beach;
    const a = S.pointAt('sand', 0.55, 0);
    const p = S.pointAt('sand', 0.54, 0), q = S.pointAt('sand', 0.56, 0);
    let tx = q.x - p.x, tz = q.z - p.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const rx = -tz, rz = tx;
    const sgn = Math.sign(T.sea[a.i]) || 1;
    // 站到路的左侧（内陆侧）往内看
    S.cam([a.x - rx * sgn * 6 + tx * 8, 26, a.z - rz * sgn * 6 + tz * 8],
      [a.x - rx * sgn * 44 + tx * 34, 0, a.z - rz * sgn * 44 + tz * 34], 55);
    // eslint-disable-next-line no-new-func
    new Function('B', fnSrc)(B);
    S.step(1 / 60, 2);
  }, fn);
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: path.join(OUT, 'lk-' + name + '.png') });
  console.log('  ', name);
}

await shot('0-base', 'void B;');
await shot('1-noriver', 'if (B.river) B.river.visible = false;');
await shot('2-noocean', 'if (B.ocean) B.ocean.visible = false;');
await shot('3-norivernooc', 'if (B.river) B.river.visible = false; if (B.ocean) B.ocean.visible = false;');

/* 沿河中心线打点，看水面上方地形高度 */
const info = await page.evaluate(() => {
  const B = window.__game.beach;
  const pts = [[-236, 112], [-244, 86], [-238, 58], [-224, 32], [-206, 16],
    [-170, 10], [-128, 12], [-88, 6], [-46, -4], [-6, -8], [34, -2], [66, 14], [86, 40]];
  return pts.map(([x, z]) => [x, z, +B.heightAt(x, z).toFixed(2)]);
});
console.log('河心地形高度：');
for (const [x, z, h] of info) console.log(`   (${x}, ${z}) → ${h}`);

await browser.close();
process.exit(0);
