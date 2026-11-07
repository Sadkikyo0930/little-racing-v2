/* 每个分段的「海在哪一侧 / 多远 / 路有多宽」实测量表。
 * 截图机位和道具落位都要靠这张表，不能靠感觉。 */
import path from 'node:path';
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
  const T = window.__sim.trackInfo();
  return { sections: T.sections, length: T.length, samples: T.samples, widths: T.widths };
});
console.log('赛道', out.length, 'm /', out.samples, '采样 / 宽', JSON.stringify(out.widths));
for (const s of out.sections) {
  console.log(String(s.id).padEnd(12), String(s.name).padEnd(12),
    `d0=${String(s.d0).padStart(7)} d1=${String(s.d1).padStart(7)} len=${String(s.len).padStart(6)} kind=${s.kind}`);
}
await browser.close();
process.exit(0);
