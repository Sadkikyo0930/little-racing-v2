/* 诊断：木桥前后桥面高度曲线，找有没有台阶（会让车陷下去/弹起来） */
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
  const rows = [];
  for (let i = 1540; i < 1700; i++) {
    const y = t.pos[i * 3 + 1];
    const yNext = t.pos[((i + 1) % t.n) * 3 + 1];
    rows.push({
      i, y: +y.toFixed(3), dy: +(yNext - y).toFixed(3),
      kind: t.kind[i], w: +t.width[i].toFixed(2), d: +t.dist[i].toFixed(1),
    });
  }
  return { bridge: t.bridgeRange, n: t.n, rows };
});
console.log('bridgeRange', JSON.stringify(out.bridge));
let prev = null;
for (const r of out.rows) {
  const flag = prev != null && Math.abs(r.dy) > 0.08 ? '  <<<' : '';
  console.log(`${r.i}\ty=${r.y}\tdy=${r.dy}\tkind=${r.kind}\tw=${r.w}\td=${r.d}${flag}`);
  prev = r;
}
await browser.close();
process.exit(0);
