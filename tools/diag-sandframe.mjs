/* 礁石近景机位挑选：一次开浏览器，按 6 个候选机位各抓一张。
 * 看图选一张，再回填到 shots2.mjs。 */
import path from 'node:path';
import { startServer, findBrowser, CHROME_ARGS, loadPuppeteer, SHOTS } from './test/lib.mjs';

const OUT = path.join(SHOTS, 'stage2', 'sandtry');
const fs = await import('node:fs');
fs.mkdirSync(OUT, { recursive: true });

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
  await window.__garage.grantVehicle('turtle');
  await window.__garage.grantVehicle('moto');
  await window.__sim.start({ vehicle: 'red' });
  const bf = window.__game.items?.boxField;
  if (bf?.meshes) for (const m of bf.meshes) m.visible = false;
});
await page.evaluate(() => {
  const S = window.__sim, T = S.trackInfo();
  S.place(0, Math.round(30 / (T.length / T.samples)), 0);
  S.step(1 / 60, 20);
});
await new Promise((r) => setTimeout(r, 4200));

const VARIANTS = [
  ['A', { sec: 'sand', t: 0.42, toSea: 1, water: 0, rel: [-2, 0], ey: 2.3, aim: [26, 26], ly: 0.4, fov: 55 }],
  ['B', { sec: 'sand', t: 0.42, toSea: 1, water: 0, rel: [-5, -6], ey: 2.8, aim: [24, 30], ly: 0.3, fov: 52 }],
  ['C', { sec: 'sand', t: 0.46, toSea: 1, water: 0, rel: [1, -2], ey: 1.9, aim: [30, 34], ly: 0.2, fov: 60 }],
];

for (const [tag, spec] of VARIANTS) {
  await page.evaluate((spec) => {
    const SEA = -7.5;
    const S = window.__sim, T = window.__game.track, B = window.__game.beach;
    const a = S.pointAt(spec.sec, spec.t, 0);
    const p = S.pointAt(spec.sec, spec.t - 0.01, 0), q = S.pointAt(spec.sec, spec.t + 0.01, 0);
    let tx = q.x - p.x, tz = q.z - p.z;
    const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const rx = -tz, rz = tx;
    const sgn = Math.sign(T.sea[a.i]) || 1;
    const lat0 = spec.water ? (B._waterLat(a.i, sgn) ?? T.width[a.i]) : T.width[a.i];
    const at = (r, f) => {
      const lat = (lat0 + r) * sgn;
      return [a.x + rx * lat + tx * f, a.z + rz * lat + tz * f];
    };
    const ground = (x, z) => Math.max(B.heightAt(x, z), SEA);
    const [cx, cz] = at(spec.rel[0], spec.rel[1]);
    const [ax, az] = at(spec.aim[0], spec.aim[1]);
    S.cam([cx, ground(cx, cz) + spec.ey, cz], [ax, ground(ax, az) + spec.ly, az], spec.fov);
  }, spec);
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: path.join(OUT, tag + '.png') });
  const n = fs.statSync(path.join(OUT, tag + '.png')).size;
  console.log(tag, Math.round(n / 1024) + ' KB');
}
await browser.close();
process.exit(0);
