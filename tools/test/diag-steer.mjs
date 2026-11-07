/* 诊断：摩托 steerVisual 为什么几乎为 0 */
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
  await window.__garage.grantVehicle('moto');
  await S.start({ vehicle: 'moto' });
  const g = window.__game;
  const k = g.player;
  const T = S.trackInfo();
  const sec = T.sections.find((s) => s.id === 'sand');
  const span = (sec.i1 - sec.i0 + T.samples) % T.samples;
  S.place(0, Math.round((sec.i0 + span * 0.4) % T.samples), 0);
  const trace = [];
  S.control({ throttle: 1 });
  for (let i = 0; i < 90; i++) S.step(1 / 60, 1);
  trace.push({ phase: 'after-90-throttle', spd: +k.speed.toFixed(1), sv: +k.steerVisual.toFixed(3) });
  S.control({ throttle: 1, steer: 1 });
  for (let i = 0; i < 60; i++) {
    S.step(1 / 60, 1);
    if (i % 10 === 0) {
      trace.push({
        i, spd: +k.speed.toFixed(1), sv: +k.steerVisual.toFixed(3),
        inSteer: +g.input.state.steer.toFixed(3),
        tSteer: +g.input.touch.steer.toFixed(3),
        yaw: +k.yaw.toFixed(3), drifting: k.drifting, spin: +k.spinTime.toFixed(2),
      });
    }
  }
  S.sync();
  return {
    trace,
    modelSteerMax: k.model.steerMax,
    pivotY: +k.model.wheels[0].pivot.rotation.y.toFixed(4),
    bodyZ: +k.model.body.rotation.z.toFixed(4),
    lean: +k.lean.toFixed(3),
    state: g.race.state, fin: k.finished, autopilot: g.autopilot,
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
process.exit(0);
