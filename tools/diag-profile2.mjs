/* 打印礁石岬角段的横向高程剖面，确认水线附近的坡度是否真的有斜度。
 * 用法：node tools/diag-profile2.mjs
 */
import { startServer, findBrowser, CHROME_ARGS, loadPuppeteer } from './test/lib.mjs';

const puppeteer = await loadPuppeteer();
const srv = await startServer();
const browser = await puppeteer.launch({
  executablePath: findBrowser(), headless: true, args: CHROME_ARGS, protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 640, height: 360 });
await page.goto(`${srv.url}/?course=beach`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__sim, { timeout: 600000, polling: 400 });

const out = await page.evaluate(() => {
  const S = window.__sim, T = window.__game.track, B = window.__game.beach;
  const rows = [];
  for (const t of [0.15, 0.5, 0.85]) {
    const a = S.pointAt('point', t, 0);
    const p = S.pointAt('point', t - 0.01, 0), q = S.pointAt('point', t + 0.01, 0);
    let tx = q.x - p.x, tz = q.z - p.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const rx = -tz, rz = tx;
    const sgn = Math.sign(T.sea[a.i]) || 1;
    const w = T.width[a.i];
    const prof = [];
    for (let d = w - 2; d <= w + 56; d += 4) {
      const x = a.x + rx * sgn * d, z = a.z + rz * sgn * d;
      prof.push([+d.toFixed(0), +B.heightAt(x, z).toFixed(2)]);
    }
    rows.push({ t, w: +w.toFixed(1), i: a.i, prof });
  }
  return rows;
});
for (const r of out) {
  console.log(`\npoint t=${r.t} width=${r.w} i=${r.i}`);
  console.log('  ' + r.prof.map(([d, h]) => `${d}:${h}`).join('  '));
}
await browser.close();
process.exit(0);
