/* 直接调 BeachWorld._frame 看它一步 0.30 m 到底走了多远。 */
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
  const mk = () => ({
    pos: { x: 0, y: 0, z: 0, set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; } },
    right: { x: 0, y: 0, z: 0, set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; }, normalize() { return this; } },
    up: { x: 0, y: 0, z: 0, set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; }, normalize() { return this; } },
    tan: { x: 0, y: 0, z: 0, set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; }, normalize() { return this; } },
    width: 0,
  });
  const a = mk(), b = mk();
  const rows = [];
  for (let k = 0; k < 6; k++) {
    B._frame(940.3 + 0.3 * k, a);
    B._frame(940.3 + 0.3 * (k + 1), b);
    rows.push(+Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y, b.pos.z - a.pos.z).toFixed(4));
  }
  return {
    bridge: T.bridgeRange ? { d0: T.bridgeRange.d0, len: T.bridgeRange.len } : null,
    rows,
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
process.exit(0);
