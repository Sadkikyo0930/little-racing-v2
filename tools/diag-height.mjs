/* 赛道竖向剖面 + 各段离水距离勘察。改海面高度前必须先看清这张表。 */
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

const rows = await page.evaluate(() => {
  const S = window.__sim;
  const T = S.trackInfo();
  const t = window.__game.track;
  const out = [];
  for (const s of T.sections) {
    let y0 = Infinity, y1 = -Infinity, wy = 0;
    const N = T.samples;
    for (let i = s.i0; i !== s.i1; i = (i + 1) % N) {
      const y = t.pos[i * 3 + 1];
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    out.push({ id: s.id, d0: s.d0, d1: s.d1, yMin: +y0.toFixed(2), yMax: +y1.toFixed(2) });
  }
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < T.samples; i++) {
    const y = t.pos[i * 3 + 1];
    lo = Math.min(lo, y); hi = Math.max(hi, y);
  }
  return { out, lo: +lo.toFixed(2), hi: +hi.toFixed(2) };
});
console.log('全赛道 y', rows.lo, '..', rows.hi);
for (const r of rows.out) console.log(r.id.padEnd(12), 'y', String(r.yMin).padStart(7), '..', String(r.yMax).padStart(7));
await browser.close();
process.exit(0);
