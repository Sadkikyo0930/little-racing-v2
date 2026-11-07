/* 诊断：摩托模型的节点结构（wheels / body / pivot / spin） */
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
  await S.start({ vehicle: 'moto' });
  const k = window.__game.player;
  const m = k.model;
  const dump = (o, d = 0) => {
    if (!o || d > 3) return null;
    return {
      name: o.name, type: o.type,
      children: (o.children || []).map((c) => dump(c, d + 1)).filter(Boolean),
    };
  };
  return {
    vehicle: k.vehicle || k.kind || null,
    modelKeys: Object.keys(m),
    wheels: (m.wheels || []).map((w) => ({
      keys: Object.keys(w),
      pivot: w.pivot?.name ?? null,
      spin: w.spin?.name ?? null,
      steer: w.steer ?? null,
      radius: w.radius ?? null,
    })),
    bodyName: m.body?.name ?? null,
    bodyChildren: (m.body?.children || []).map((c) => c.name),
    objectTree: dump(k.object),
    modelName: m.name ?? null,
    pitchScale: m.pitchScale,
  };
});
console.log(JSON.stringify(out, null, 1).slice(0, 6000));
await browser.close();
process.exit(0);
