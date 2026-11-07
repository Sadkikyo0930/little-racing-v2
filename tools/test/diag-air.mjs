/* 诊断：逐帧抓「车离地 1 m / 陷地 0.37 m」的现场，看前后各几帧发生了什么 */
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
await page.evaluate(() => { window.__garage.grantVehicle('moto'); });

const out = await page.evaluate(async () => {
  const S = window.__sim;
  await S.start({ vehicle: 'red' });
  const g = window.__game;
  const t = g.track;
  g.autopilot = true;
  const dt = 1 / 60;
  const ring = [];            // 最近 8 帧的全场快照
  const hits = [];
  const respawnAt = g.karts.map(() => -99);
  const orig = g.race.respawn.bind(g.race);
  g.race.respawn = (k) => { const i = g.karts.indexOf(k); if (i >= 0) respawnAt[i] = g.race.raceTime; return orig(k); };

  for (let s = 0; s < Math.round(240 / dt); s++) {
    S.step(dt, 1);
    const frame = { t: +(s * dt).toFixed(2), karts: [] };
    for (let i = 0; i < g.karts.length; i++) {
      const k = g.karts[i];
      const sy = t.surfaceAt(k.position, k.trackIndex).y;
      const air = k.position.y - sy;
      const pen = sy - k.position.y;
      const lat = t.locate(k.position, k.trackIndex).lat;
      frame.karts.push({
        i, n: k.name, idx: k.trackIndex, y: +k.position.y.toFixed(3), sy: +sy.toFixed(3),
        air: +air.toFixed(3), pen: +pen.toFixed(3), lat: +lat.toFixed(2),
        w: +t.width[k.trackIndex].toFixed(2), kind: t.kind[k.trackIndex],
        spd: +k.speed.toFixed(1), vy: +(k.vy || 0).toFixed(2),
        gr: k.grounded, airT: +(k.airTime ?? 0).toFixed(2),
        rs: +(g.race.raceTime - respawnAt[i]).toFixed(2), hop: +(k.hopTimer||0).toFixed(2),
      });
    }
    ring.push(frame);
    if (ring.length > 10) ring.shift();
    for (const c of frame.karts) {
      if ((c.air > 1.0 || c.pen > 0.2) && c.rs > 1.0 && c.hop <= 0 && hits.length < 3) {
        hits.push({ frame: frame.t, trigger: c, before: ring.slice(0, -1).map((f) => f.karts[c.i]) });
      }
    }
    if (g.race.state === 'finished' && g.karts.every((x) => x.finished)) break;
  }
  g.race.respawn = orig;
  return { hits };
});

for (const h of out.hits) {
  console.log(`\n=== 触发 t=${h.frame}s  ${h.trigger.n} ===`);
  for (const b of h.before) {
    console.log(`  t=${b.idx !== undefined ? '' : ''}idx=${b.idx} y=${b.y} surf=${b.sy} air=${b.air} pen=${b.pen} lat=${b.lat}/${b.w} kind=${b.kind} spd=${b.spd} vy=${b.vy} gr=${b.gr} airT=${b.airT} hop=${b.hop}`);
  }
  const c = h.trigger;
  console.log(`>>idx=${c.idx} y=${c.y} surf=${c.sy} air=${c.air} pen=${c.pen} lat=${c.lat}/${c.w} kind=${c.kind} spd=${c.spd} vy=${c.vy} gr=${c.gr} airT=${c.airT} hop=${c.hop}`);
}
await browser.close();
process.exit(0);
