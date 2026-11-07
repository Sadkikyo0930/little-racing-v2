/* 起点广场黑屏排查：放车 → 打印相机/车的位置 → 多机位各截一张。 */
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
await page.evaluate(async () => {
  await window.__garage.grantVehicle('turtle');
  await window.__garage.grantVehicle('moto');
  await window.__sim.start({ vehicle: 'red' });
  const bf = window.__game.items?.boxField;
  if (bf?.meshes) for (const m of bf.meshes) m.visible = false;
});

for (const d of [20, 34, 50]) {
  const info = await page.evaluate((d) => {
    const S = window.__sim;
    const T = S.trackInfo();
    const i = Math.round(d / (T.length / T.samples));
    S.releaseCam();
    S.place(0, i, 0);
    S.control({ throttle: 0.55 });
    S.step(1 / 60, 30);
    S.control({ throttle: 0 });
    const cam = window.__game.engine.camera;
    const p = window.__game.player.position;
    return {
      d,
      kart: [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)],
      cam: [+cam.position.x.toFixed(1), +cam.position.y.toFixed(1), +cam.position.z.toFixed(1)],
      snap: S.snapshot().player,
    };
  }, d);
  console.log(JSON.stringify(info));
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: path.join(SHOTS, 'stage2', `pl-${d}.png`) });
}
await browser.close();
process.exit(0);
