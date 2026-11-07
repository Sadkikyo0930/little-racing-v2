/* 桥面条纹到底来自贴图还是法线图：分别只留 map / 只留 normalMap 各拍一张。 */
import path from 'node:path';
import { startServer, findBrowser, CHROME_ARGS, loadPuppeteer, SHOTS } from './test/lib.mjs';

const puppeteer = await loadPuppeteer();
const srv = await startServer();
const browser = await puppeteer.launch({
  executablePath: findBrowser(), headless: true, args: CHROME_ARGS, protocolTimeout: 900000,
});
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 600 });
await page.goto(`${srv.url}/?course=beach`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__sim, { timeout: 600000, polling: 400 });
await page.evaluate(async () => {
  await window.__sim.start({ vehicle: 'red' });
  const S = window.__sim;
  const c = S.pointAt('bridge', 0.5, 0);
  S.cam([c.x, c.y + 8, c.z + 0.01], [c.x, c.y, c.z], 16);
});

const variants = [
  ['tx-0-orig', 'null'],
  ['tx-3-none', 'none'],
];
for (const [name, keep] of variants) {
  await page.evaluate((keep) => {
    const B = window.__game.beach;
    const g = B.group.getObjectByName('ch2:bridge_plank');
    for (const im of g.children) {
      const m = im.material.clone();
      if (keep === 'null') { /* 原样 */ } else {
        m.map = null; m.normalMap = null; m.color.set(0xffffff);
      }
      im.material = m;
    }
  }, keep);
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: path.join(SHOTS, 'stage2', name + '.png') });
  console.log(' ', name);
}

// 关掉阴影再拍一张：区分「材质暗」和「阴影暗」
await page.evaluate(() => {
  const r = window.__game.engine.renderer;
  r.shadowMap.enabled = false;
  window.__game.engine.scene.traverse((o) => { if (o.isMesh) o.material.needsUpdate = true; });
});
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: path.join(SHOTS, 'stage2', 'tx-4-noshadow.png') });
console.log('  tx-4-noshadow');
await browser.close();
process.exit(0);
