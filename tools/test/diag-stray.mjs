/* 诊断：把车横向扔出赛道 60 m 后，locate / stray / respawn 各自看到了什么 */
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

const out = await page.evaluate(async () => {
  const S = window.__sim;
  const T = S.trackInfo();
  await S.start({ vehicle: 'red' });
  const sec = T.sections.find((s) => s.id === 'sand');
  const span = (sec.i1 - sec.i0 + T.samples) % T.samples;
  const i0 = Math.round(sec.i0 + span * 0.3);
  S.place(0, i0, 60);
  const g = window.__game;
  const k = g.player;
  const tr = [];
  let respawns = 0;
  const orig = g.race.respawn.bind(g.race);
  g.race.respawn = (x) => { if (x.isPlayer) respawns++; return orig(x); };
  for (let f = 0; f < 180; f++) {
    S.step(1 / 60, 1);
    if (f % 15 === 0) {
      const loc = g.track.locate(k.position, k.trackIndex);
      tr.push({
        f, idx: k.trackIndex, locIdx: loc.index,
        lat: +loc.lat.toFixed(1), w: +g.track.width[loc.index].toFixed(1),
        stray: Math.abs(loc.lat) > g.track.width[loc.index] * 3.2,
        y: +k.position.y.toFixed(1), rt: +k.respawnTimer.toFixed(2),
        spd: +k.speed.toFixed(1), grounded: k.grounded, stuck: !!k.stuck,
      });
    }
  }
  g.race.respawn = orig;
  return { i0, respawns, tr };
});
console.log('start index', out.i0, 'respawns', out.respawns);
for (const r of out.tr) console.log(JSON.stringify(r));
await browser.close();
process.exit(0);
