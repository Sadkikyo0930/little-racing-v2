/* 01-plaza 黑屏复现：完全照抄 shots2.open() 的序列，然后在设机位后
 * 分别在 0 / 0.9 / 1.5 / 2.5 / 4.0 s 各抓一张，看是时机问题还是机位问题。 */
import { startServer, findBrowser, CHROME_ARGS, loadPuppeteer, SHOTS } from './test/lib.mjs';
import path from 'node:path';

const OUT = path.join(SHOTS, 'stage2');
const puppeteer = await loadPuppeteer();
const srv = await startServer();
const browser = await puppeteer.launch({
  executablePath: findBrowser(), headless: true, args: CHROME_ARGS, protocolTimeout: 900000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto(`${srv.url}/?course=beach`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__sim, { timeout: 600000, polling: 400 });

/* --- 照抄 open() --- */
await page.evaluate(async () => {
  await window.__garage.grantVehicle('turtle');
  await window.__garage.grantVehicle('moto');
  await window.__sim.start({ vehicle: 'red' });
  const bf = window.__game.items?.boxField;
  if (bf?.meshes) for (const m of bf.meshes) m.visible = false;
});
await page.evaluate(() => {
  const S = window.__sim;
  const T = S.trackInfo();
  S.place(0, Math.round(30 / (T.length / T.samples)), 0);
  S.step(1 / 60, 20);
});
await new Promise((r) => setTimeout(r, 4200));
await page.screenshot({ path: path.join(OUT, 'dbg3-a-warmup.png') });

/* --- 照抄 camShot('01-plaza') --- */
await page.evaluate(() => {
  const spec = { sec: 'plaza', t: 0.0, rel: [0, -26], ey: 5.8, aim: [0, 40], ly: 3.4, fov: 50 };
  const S = window.__sim;
  const T = window.__game.track;
  const a = S.pointAt(spec.sec, spec.t, 0);
  const p = S.pointAt(spec.sec, spec.t - 0.01, 0);
  const q = S.pointAt(spec.sec, spec.t + 0.01, 0);
  let tx = q.x - p.x, tz = q.z - p.z;
  const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
  const rx = -tz, rz = tx;
  const sgn = 1;
  S.cam(
    [a.x + rx * 0 + tx * -26, spec.ey, a.z + rz * 0 + tz * -26],
    [a.x + tx * 40, spec.ly, a.z + tz * 40],
    50,
  );
  window.__dbgSec = spec.sec;
});
for (const [ms, tag] of [[0, 'b-0ms'], [900, 'c-900ms'], [600, 'd-1500ms'], [1000, 'e-2500ms'], [1500, 'f-4000ms']]) {
  await new Promise((r) => setTimeout(r, ms));
  await page.screenshot({ path: path.join(OUT, `dbg3-${tag}.png`) });
  const st = await page.evaluate(() => {
    const c = window.__game.engine.camera;
    return {
      cam: [+c.position.x.toFixed(1), +c.position.y.toFixed(2), +c.position.z.toFixed(1)],
      target: window.__game.engine.controls?.target
        ? [+window.__game.engine.controls.target.x.toFixed(1), +window.__game.engine.controls.target.y.toFixed(1), +window.__game.engine.controls.target.z.toFixed(1)]
        : null,
      overlay: (() => {
        const el = document.querySelector('.start-lights, #start-lights, .countdown');
        return el ? el.className + ' op=' + getComputedStyle(el).opacity : null;
      })(),
    };
  });
  console.log(tag, JSON.stringify(st));
}
await browser.close();
process.exit(0);
