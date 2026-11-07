/* 每个分段的 sea 方向与「从路缘到水线」的实测距离。 */
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
  const T = window.__game.track;
  const B = window.__game.beach;
  const info = window.__sim.trackInfo();
  const out = [];
  for (const s of info.sections) {
    const counts = {};
    let sum = 0, n = 0;
    const wl = [];
    for (let i = s.i0; i !== s.i1; i = (i + 1) % T.n) {
      const v = T.sea[i];
      counts[v] = (counts[v] || 0) + 1;
      sum += v; n++;
    }
    // 从段中点往两侧各找一次水线
    const mid = (s.i0 + Math.round(((s.i1 - s.i0 + T.n) % T.n) / 2)) % T.n;
    for (const side of [-1, 1]) {
      const d = B._waterLat(mid, side);
      wl.push(d === null ? null : +d.toFixed(1));
    }
    out.push({ id: s.id, seaAvg: +(sum / n).toFixed(2), counts, width: +T.width[mid].toFixed(1), waterLat: wl });
  }
  return out;
});
for (const r of rows) console.log(r.id.padEnd(12), 'sea', String(r.seaAvg).padStart(5), JSON.stringify(r.counts).padEnd(22), 'w=' + r.width, '水线', JSON.stringify(r.waterLat));
await browser.close();
process.exit(0);
