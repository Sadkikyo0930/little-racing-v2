/* 01-plaza 黑屏定点排查：复现 camShot 的几何，打印机位/落点的地形高度。 */
import { startServer, findBrowser, CHROME_ARGS, loadPuppeteer } from './test/lib.mjs';

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
await new Promise((r) => setTimeout(r, 4200));

const out = await page.evaluate(() => {
  const S = window.__sim, B = window.__game.beach, E = window.__game.engine;
  const a = S.pointAt('plaza', 0.0, 0);
  const p = S.pointAt('plaza', -0.01, 0);
  const q = S.pointAt('plaza', 0.01, 0);
  let tx = q.x - p.x, tz = q.z - p.z;
  const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
  const rx = -tz, rz = tx;
  const camX = a.x + rx * 0 - tx * 26, camZ = a.z + rz * 0 - tz * 26;
  const aimX = a.x + tx * 40, aimZ = a.z + tz * 40;
  const r = {
    anchor: [+a.x.toFixed(1), +a.y?.toFixed?.(2), +a.z.toFixed(1)],
    tangent: [+tx.toFixed(3), +tz.toFixed(3)],
    camXZ: [+camX.toFixed(1), +camZ.toFixed(1)],
    groundCam: +B.heightAt(camX, camZ).toFixed(2),
    groundAim: +B.heightAt(aimX, aimZ).toFixed(2),
    roadYatAnchor: +S.pointAt('plaza', 0.0, 0).y?.toFixed?.(2),
  };
  S.cam([camX, 5.8, camZ], [aimX, 3.4, aimZ], 50);
  const c = E.camera;
  r.camActual = [+c.position.x.toFixed(1), +c.position.y.toFixed(2), +c.position.z.toFixed(1)];
  return r;
});
console.log(JSON.stringify(out, null, 1));

await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: 'tools/out/shots/stage2/dbg-plaza-diag.png' });
await browser.close();
process.exit(0);
