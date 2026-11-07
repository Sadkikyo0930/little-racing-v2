/* 诊断：渔村段 1360 附近（腾空 1 m）与桥头 1602（穿透 0.1 m）的路面剖面 */
import { startServer, findBrowser, CHROME_ARGS, loadPuppeteer } from './lib.mjs';

const puppeteer = await loadPuppeteer();
const srv = await startServer();
const browser = await puppeteer.launch({
  executablePath: findBrowser(), headless: true, args: CHROME_ARGS, protocolTimeout: 1800000,
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(`${srv.url}/?course=beach`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__sim, { timeout: 300000, polling: 300 });

const out = await page.evaluate(() => {
  const t = window.__game.track;
  const dump = (a, b) => {
    const rows = [];
    for (let i = a; i < b; i++) {
      const y = t.pos[i * 3 + 1];
      const y1 = t.pos[((i - 1 + t.n) % t.n) * 3 + 1];
      const y2 = t.pos[((i - 2 + t.n) % t.n) * 3 + 1];
      rows.push({
        i, y: +y.toFixed(3),
        d1: +(y - y1).toFixed(3), d2: +(y - 2 * y1 + y2).toFixed(3),
        kind: t.kind[i], w: +t.width[i].toFixed(2), ry: +t.right[i*3+1].toFixed(4), uy: +t.up[i*3+1].toFixed(4),
        grade: +((y - y1) / (t.length / t.n) * 100).toFixed(1),
      });
    }
    return rows;
  };
  return { n: t.n, seg: +(t.length / t.n).toFixed(4), village: dump(1345, 1375), bridge: dump(1592, 1612) };
});
console.log('seg', out.seg, 'n', out.n);
console.log('--- 渔村 1345..1375（腾空点 1360）---');
for (const r of out.village) console.log(`${r.i}\ty=${r.y}\td1=${r.d1}\tgrade=${r.grade}%\tkind=${r.kind}\tw=${r.w}\tright.y=${r.ry}\tup.y=${r.uy}`);
console.log('--- 桥头 1592..1612（穿透点 1602）---');
for (const r of out.bridge) console.log(`${r.i}\ty=${r.y}\td1=${r.d1}\td2=${r.d2}\tgrade=${r.grade}%\tkind=${r.kind}\tw=${r.w}`);
await browser.close();
process.exit(0);
