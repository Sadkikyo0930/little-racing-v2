/* 量桥板实例：几何包围盒 + 相邻行实例矩阵的平移差，看板长和节距到底是多少。 */
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

const out = await page.evaluate(() => {
  const B = window.__game.beach;
  const g = B.group.getObjectByName('ch2:bridge_plank');
  const im = g.children[0];
  const bb = im.geometry.boundingBox || (im.geometry.computeBoundingBox(), im.geometry.boundingBox);
  const a = im.instanceMatrix.array;
  const get = (i) => [a[i * 16 + 12], a[i * 16 + 13], a[i * 16 + 14]];
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  // 第 0 行第 0 列 与 第 1 行第 0 列 的间距 = 节距；第 0 行 0/1 列间距 = 列宽
  return {
    count: im.count,
    bbox: [bb.min.toArray().map((v) => +v.toFixed(3)), bb.max.toArray().map((v) => +v.toFixed(3))],
    pitch: +dist(get(0), get(7)).toFixed(3),
    colGap: +dist(get(0), get(1)).toFixed(3),
    info: B.bridgeInfo,
    firstMatrix: a.slice(0, 16).map((v) => +v.toFixed(3)),
    first9: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => get(i).map((v) => +v.toFixed(3))),
    rowSteps: (() => {
      const out = [];
      for (let r = 0; r < 6; r++) out.push(+dist(get(r * 7), get((r + 1) * 7)).toFixed(4));
      // 首尾两行的间距，验证整段桥面总长
      out.push(+dist(get(0), get(159 * 7)).toFixed(2));
      return out;
    })(),
    /* 采样点真实间距：沿桥段取 20 段量一下 */
    segs: (() => {
      const T = window.__game.track;
      const out = [];
      const i0 = Math.round(940 / (T.length / T.n));
      for (let k = 0; k < 8; k++) {
        const i = i0 + k;
        out.push(+Math.hypot(
          T.pos[(i + 1) * 3] - T.pos[i * 3],
          T.pos[(i + 1) * 3 + 1] - T.pos[i * 3 + 1],
          T.pos[(i + 1) * 3 + 2] - T.pos[i * 3 + 2],
        ).toFixed(4));
      }
      return { sp: +(T.length / T.n).toFixed(4), out, dist: [T.dist ? 1 : 0] };
    })(),
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
process.exit(0);
