/* 快速探针：确认 beach 赛道能进游戏、几何与分段正确、场景没有报错。
 * 开发和排查时用；正式的验收在 stage1.mjs。
 *   node tools/test/probe.mjs
 */
import { startServer, findBrowser, CHROME_ARGS, loadPuppeteer, ensureDirs, SHOTS, OUT } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

const puppeteer = await loadPuppeteer();
const srv = await startServer();
ensureDirs();
const browser = await puppeteer.launch({
  executablePath: findBrowser(), headless: true, args: CHROME_ARGS, protocolTimeout: 900000,
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
await page.goto(`${srv.url}/?course=beach`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__sim, { timeout: 240000, polling: 300 });

const info = await page.evaluate(() => window.__sim.trackInfo());
console.log(JSON.stringify(info, null, 1).slice(0, 2600));

console.log('--- errors:', errors.length);
for (const e of errors.slice(0, 8)) console.log('   ', e.slice(0, 200));

// 起飞：进比赛，跑 3 秒看是否在动
const start = await page.evaluate(async () => {
  const r = await window.__sim.start({ vehicle: 'red' });
  window.__sim.control({ throttle: 1 });
  window.__sim.step(1 / 60, 180);
  return { r, snap: window.__sim.snapshot() };
});
console.log('start', JSON.stringify(start.r));
console.log('player', JSON.stringify(start.snap.player));

await page.screenshot({ path: path.join(SHOTS, 'probe-01.png') });
await browser.close();
await srv.close();
console.log('probe done');
