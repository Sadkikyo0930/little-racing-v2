/* 用交付的 Pages ZIP 实测：解压后能不能正常开局、有没有 404、赛道对不对
 *
 *   node tools/test/pages-check.mjs <解压后的目录>
 */
import path from 'node:path';
import { startServer, findBrowser, CHROME_ARGS, loadPuppeteer } from './lib.mjs';

const DIR = process.argv[2] || process.env.PAGES_DIR || 'dist';
const COURSE = process.argv[3] || '';
const srv = await startServer(path.resolve(DIR));
const URL = srv.url;
console.log('托管目录:', path.resolve(DIR));
const puppeteer = await loadPuppeteer();
const browser = await puppeteer.launch({
  executablePath: findBrowser(), headless: true, args: CHROME_ARGS, protocolTimeout: 600000,
});
const page = await browser.newPage();
const errors = [];
const misses = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('requestfailed', (r) => misses.push(r.url().replace(URL, '')));
page.on('response', (r) => { if (r.status() >= 400) misses.push(r.status() + ' ' + r.url().replace(URL, '')); });

await page.setViewport({ width: 1280, height: 720 });
await page.goto(`${URL}/${COURSE ? '?course=' + COURSE : ''}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__sim, { timeout: 300000, polling: 300 });

const info = await page.evaluate(() => window.__sim.trackInfo());
const run = await page.evaluate(async () => {
  const S = window.__sim;
  await S.start({ vehicle: 'red' });
  S.control({ throttle: 1 });
  S.step(1 / 60, 240);
  const snap = S.snapshot();
  const race = S.runRace({ maxSeconds: 400 });
  return {
    speed: snap.player.speed, kind: snap.player.kind,
    finished: race.karts.find((k) => k.isPlayer).finished,
    laps: race.karts.find((k) => k.isPlayer).laps,
    allLaps: race.karts.map((k) => k.laps),
  };
});

console.log(`赛道 ${info.course} / ${info.name} / ${info.laps} 圈 / ${info.length} m`);
console.log(`起步 4 s 速度 ${run.speed} m/s，路面 kind=${run.kind}`);
console.log(`跑完整场：玩家 ${run.laps} 圈 / finished=${run.finished}；全场 ${run.allLaps.join(',')}`);
console.log(`404 / 加载失败：${misses.length ? misses.join(' | ') : '无'}`);
console.log(`JS 报错：${errors.length ? errors.slice(0, 5).join(' | ') : '无'}`);

await browser.close();
process.exit(misses.length || errors.length || !run.finished ? 1 : 0);
