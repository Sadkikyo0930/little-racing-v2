/* 把起点门横幅那张 canvas 贴图直接导出成 PNG，检查到底画上了什么。 */
import fs from 'node:fs';
import path from 'node:path';
import { startServer, findBrowser, CHROME_ARGS, loadPuppeteer, SHOTS } from './test/lib.mjs';

const puppeteer = await loadPuppeteer();
const srv = await startServer();
const browser = await puppeteer.launch({
  executablePath: findBrowser(), headless: true, args: CHROME_ARGS, protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 640, height: 360 });
await page.goto(`${srv.url}/?course=beach`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__sim, { timeout: 600000, polling: 400 });

const out = await page.evaluate(() => {
  const B = window.__game.beach;
  let found = null;
  B.group.traverse((o) => {
    if (found || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m.name === 'M_Gate_Banner') found = m;
    }
  });
  if (!found) return { err: 'material not found' };
  const img = found.map.image;
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  cv.getContext('2d').drawImage(img, 0, 0);
  return {
    size: [img.width, img.height],
    repeat: [found.map.repeat.x, found.map.repeat.y],
    offset: [found.map.offset.x, found.map.offset.y],
    url: cv.toDataURL('image/png'),
    fontOK: (() => {
      const c = document.createElement('canvas').getContext('2d');
      c.font = 'bold 60px "PingFang SC", "Microsoft YaHei", sans-serif';
      return { font: c.font, w: c.measureText('阳光沙滩杯 · SUNSHINE BEACH CUP').width };
    })(),
  };
});
console.log(JSON.stringify({ ...out, url: out.url ? out.url.slice(0, 40) + '…' : null }, null, 1));
if (out.url) {
  const dir = path.join(SHOTS, 'stage2');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'dbg-banner.png'),
    Buffer.from(out.url.split(',')[1], 'base64'));
  console.log('→', path.join(dir, 'dbg-banner.png'));
}
/* 凑近起点门拍一张，看看贴图到底贴在哪个面上 */
await page.evaluate(() => {
  const S = window.__sim, T = window.__game.track;
  const P = T.pos, R = T.right;
  // 起点门在世界原点附近：直接读 start_gate 实例位置
  const B = window.__game.beach;
  const g = B.group.getObjectByName('ch2:start_gate');
  const arr = g.children[0].instanceMatrix.array;
  const x = arr[12], y = arr[13], z = arr[14];
  S.cam([x + 1, y + 6.2, z + 17], [x, y + 7.4, z], 32);
  S.step(1 / 60, 2);
});
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: path.join(SHOTS, 'stage2', 'dbg-banner-close.png') });
console.log('→ dbg-banner-close.png');

await browser.close();
process.exit(0);
