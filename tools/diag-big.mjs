/* 找出场景里尺寸过大的对象：遍历一遍，报包围球半径 > 6 m 且不是地形/海面的。 */
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
await page.evaluate(async () => { await window.__sim.start({ vehicle: 'red' }); });

const rows = await page.evaluate(() => {
  const scene = window.__game.engine.scene;
  const out = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    if (!g.boundingSphere) { g.computeBoundingSphere(); }
    const bs = g.boundingSphere;
    if (!bs) return;
    const m = o.matrixWorld.elements;
    const sx = Math.hypot(m[0], m[1], m[2]);
    const sy = Math.hypot(m[4], m[5], m[6]);
    const sz = Math.hypot(m[8], m[9], m[10]);
    const r = bs.radius * Math.max(sx, sy, sz);
    if (r < 6) return;
    out.push({
      name: o.name || '(anon)',
      parent: o.parent?.name || '',
      r: +r.toFixed(1),
      pos: [+m[12].toFixed(1), +m[13].toFixed(1), +m[14].toFixed(1)],
      visible: o.visible,
      count: o.isInstancedMesh ? o.count : 1,
      mat: Array.isArray(o.material) ? o.material.map((x) => x.name || x.type).join(',') : (o.material.name || o.material.type),
      color: o.material?.color ? '#' + o.material.color.getHexString() : '',
    });
  });
  return out.sort((a, b) => b.r - a.r).slice(0, 40);
});
for (const r of rows) {
  console.log(String(r.r).padStart(7), r.name.padEnd(28), 'pos', JSON.stringify(r.pos).padEnd(24), 'n=' + r.count, r.color, r.mat);
}
await browser.close();
process.exit(0);
