/* 视觉检查：把相机摆到关键位置各拍一张，用来肉眼确认几何对不对。
 *   node tools/test/views.mjs
 */
import { startServer, findBrowser, CHROME_ARGS, loadPuppeteer, ensureDirs, SHOTS } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

const puppeteer = await loadPuppeteer();
const srv = await startServer();
ensureDirs();
const browser = await puppeteer.launch({
  executablePath: findBrowser(), headless: true, args: CHROME_ARGS, protocolTimeout: 900000,
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
await page.goto(`${srv.url}/?course=beach`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__sim, { timeout: 240000, polling: 300 });
await page.evaluate(async () => {
  await window.__sim.start({ vehicle: 'red' });
  window.__sim.control({ throttle: 0 });
  window.__sim.step(1 / 60, 5);
});

const views = process.argv.slice(2).length ? process.argv.slice(2) : [
  'plaza', 'sand', 'dune', 'village', 'bridge', 'bridgeSide', 'aerial',
];

for (const v of views) {
  const shot = await page.evaluate((name) => {
    const S = window.__sim;
    const set = (eye, look, fov = 52) => S.cam(eye, look, fov);
    const p = (id, t, lat = 0) => S.pointAt(id, t, lat);
    if (name === 'plaza') { const a = p('plaza', 0.5); set([a.x + 8, a.y + 9, a.z + 22], [a.x, a.y, a.z]); }
    if (name === 'sand') { const a = p('sand', 0.45); set([a.x + 6, a.y + 8, a.z + 26], [a.x, a.y, a.z]); }
    if (name === 'dune') { const a = p('dune', 0.5); set([a.x + 26, a.y + 12, a.z + 20], [a.x, a.y, a.z]); }
    if (name === 'village') { const a = p('village', 0.5); set([a.x + 10, a.y + 16, a.z + 26], [a.x, a.y, a.z], 60); }
    if (name === 'bridge') { const a = p('bridge', 0.12); set([a.x + 12, a.y + 6, a.z - 16], [a.x, a.y, a.z]); }
    if (name === 'bridgeSide') { const a = p('bridge', 0.5); set([a.x + 40, a.y + 18, a.z + 34], [a.x, a.y, a.z - 2], 50); }
    if (name === 'aerial') { const a = p('bridge', 0.5); set([a.x + 120, a.y + 210, a.z + 210], [a.x - 30, 0, a.z - 40], 55); }
    if (name === 'aerialNoSea') {
      const a = p('bridge', 0.5);
      set([a.x + 120, a.y + 210, a.z + 210], [a.x - 30, 0, a.z - 40], 55);
      window.__game.engine.scene.getObjectByName('sea').visible = false;
    }
    if (name === 'horn') { const a = p('plaza', 0.5); set([a.x + 60, a.y + 40, a.z + 70], [a.x - 60, 0, a.z - 60], 60); }
    return name;
  }, v);
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: path.join(SHOTS, `view-${shot}.png`) });
  console.log('shot', shot);
}
console.log('errors:', errors.length);
for (const e of errors.slice(0, 6)) console.log('  ', e.slice(0, 180));
await browser.close();
await srv.close();
