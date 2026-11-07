/* 对照：_frame(d0+(r+0.5)*PITCH) 与 bridge_plank 实例平移，逐个比。 */
import { startServer, findBrowser, CHROME_ARGS, loadPuppeteer } from './test/lib.mjs';

const puppeteer = await loadPuppeteer();
const srv = await startServer();
const browser = await puppeteer.launch({
  executablePath: findBrowser(), headless: true, args: CHROME_ARGS, protocolTimeout: 900000,
});
const page = await browser.newPage();
await page.setViewport({ width: 640, height: 360 });
await page.goto(`${srv.url}/?course=beach`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__sim, { timeout: 600000, polling: 400 });

const out = await page.evaluate(() => {
  const B = window.__game.beach;
  const T = window.__game.track;
  const d0 = T.bridgeRange.d0;
  const g = B.group.getObjectByName('ch2:bridge_plank');
  const im = g.children[0];
  const a = im.instanceMatrix.array;
  const f = () => ({
    pos: new (window.__game.engine.scene.constructor === Object ? Object : Object)(),
  });
  const rows = [];
  for (let r = 0; r < 5; r++) {
    const fr = {
      pos: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } },
      right: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }, normalize() { return this; } },
      up: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }, normalize() { return this; } },
      tan: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }, normalize() { return this; } },
      width: 0,
    };
    B._frame(d0 + (r + 0.5) * 0.30, fr);
    const i = r * 7;
    rows.push({
      r,
      d: +(d0 + (r + 0.5) * 0.30).toFixed(3),
      frame: [+fr.pos.x.toFixed(3), +fr.pos.y.toFixed(3), +fr.pos.z.toFixed(3)],
      inst: [+a[i * 16 + 12].toFixed(3), +a[i * 16 + 13].toFixed(3), +a[i * 16 + 14].toFixed(3)],
      lat0: +(-fr.width).toFixed(2),
      right: [+fr.right.x.toFixed(3), +fr.right.y.toFixed(3), +fr.right.z.toFixed(3)],
      width: +fr.width.toFixed(2),
    });
  }
  return rows;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
process.exit(0);
