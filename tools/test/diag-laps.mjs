/* 诊断：自动驾驶跑三圈时圈数为何只记 1 圈 */
import { startServer, findBrowser, CHROME_ARGS, loadPuppeteer } from './lib.mjs';

const puppeteer = await loadPuppeteer();
const srv = await startServer();
const browser = await puppeteer.launch({
  executablePath: findBrowser(), headless: true, args: CHROME_ARGS, protocolTimeout: 1800000,
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.setViewport({ width: 960, height: 540 });
await page.goto(`${srv.url}/?course=beach`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__sim, { timeout: 300000, polling: 300 });

const out = await page.evaluate(async () => {
  const S = window.__sim;
  const st = await S.start({ vehicle: 'red' });
  const g = window.__game;
  const race = g.race;
  const log = [];
  const dt = 1 / 60;
  const steps = Math.round(200 / dt);
  let lastLap = -99;
  let lastHalf = null;
  let minProg = 9, maxProg = -9;
  let wraps = 0;
  let prevP = g.player.progress;
  let prevIdx = g.player.trackIndex;
  const idxJumps = [];
  for (let s = 0; s < steps; s++) {
    g.autopilot = true;
    S.step(dt, 1);
    const k = g.player;
    const p = k.progress;
    if (prevP - p > 0.5) wraps++;
    if (Math.abs(k.trackIndex - prevIdx) > 300) idxJumps.push({ t: +(s * dt).toFixed(1), from: prevIdx, to: k.trackIndex });
    prevP = p; prevIdx = k.trackIndex;
    minProg = Math.min(minProg, p); maxProg = Math.max(maxProg, p);
    if (k.lap !== lastLap || k.halfway !== lastHalf) {
      log.push({
        t: +(race.raceTime).toFixed(1), lap: k.lap, half: k.halfway,
        p: +p.toFixed(3), idx: k.trackIndex, spd: +k.speed.toFixed(1),
        state: race.state, fin: k.finished,
        order: race.finishOrder.length, dnfAt: race._dnfAt,
      });
      lastLap = k.lap; lastHalf = k.halfway;
    }
    if (race.state === 'finished' && g.karts.every((x) => x.finished)) break;
  }
  return {
    startInfo: st, log, wraps, minProg: +minProg.toFixed(3), maxProg: +maxProg.toFixed(3),
    idxJumps: idxJumps.slice(0, 12), idxJumpCount: idxJumps.length,
    finalLap: g.player.lap, finalFin: g.player.finished,
    raceTime: +race.raceTime.toFixed(1), state: race.state,
    laps: race.laps, kartCount: g.karts.length,
    allFinished: g.karts.map((k) => ({ n: k.name, lap: k.lap, fin: k.finished, ft: +k.finishTime.toFixed(1) })),
  };
});

console.log('start:', JSON.stringify(out.startInfo));
console.log('laps(race.laps):', out.laps, 'karts:', out.kartCount);
console.log('wraps(progress 回绕):', out.wraps, 'progress 范围', out.minProg, '~', out.maxProg);
console.log('trackIndex 大跳变:', out.idxJumpCount, JSON.stringify(out.idxJumps));
console.log('圈数/半圈事件:');
for (const l of out.log) console.log('  ', JSON.stringify(l));
console.log('final:', out.finalLap, out.finalFin, out.raceTime, out.state);
console.log('karts:', JSON.stringify(out.allFinished, null, 1));

await browser.close();
srv.server.close();
