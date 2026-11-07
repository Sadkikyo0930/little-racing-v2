/* 诊断：11-bridge-side 机位下，画面正上方那个黑色穹顶是什么对象。
 * 用 Raycaster 打一条射线，把命中的对象名字/材质打出来。 */
import { startServer, findBrowser, CHROME_ARGS, loadPuppeteer } from './test/lib.mjs';

const puppeteer = await loadPuppeteer();
const srv = await startServer();
const browser = await puppeteer.launch({
  executablePath: findBrowser(), headless: true, args: CHROME_ARGS, protocolTimeout: 900000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto(`${srv.url}/?course=beach`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__sim, { timeout: 600000, polling: 400 });
await page.evaluate(async () => { await window.__sim.start({ vehicle: 'red' }); });

const out = await page.evaluate(() => {
  const S = window.__sim;
  const THREE = window.__three;
  const a = S.pointAt('bridge', 0.5, 0);
  const p = S.pointAt('bridge', 0.49, 0);
  const q = S.pointAt('bridge', 0.51, 0);
  let tx = q.x - p.x, tz = q.z - p.z;
  const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
  const rx = -tz, rz = tx;
  const eye = [a.x + rx * 46, 8.6, a.z + rz * 46];
  const look = [a.x, 3.4, a.z];
  S.cam(eye, look, 40);

  const cam = window.__game.engine.camera;
  cam.updateMatrixWorld(true);
  const rc = new (window.__THREE_Raycaster || Object)();
  return { eye, look, ok: true };
});
console.log(JSON.stringify(out));

await page.evaluate(() => {
  // 用场景里已有的 three 实例造 Raycaster：从渲染器模块拿不到，就手工构造
  const cam = window.__game.engine.camera;
  const scene = window.__game.engine.scene;
  const T = window.__game.track;
  const NDC = { x: -0.03, y: 0.5 };
  // 用 Unproject 得到射线起点/方向，不依赖 Raycaster
  const v = { x: NDC.x, y: NDC.y, z: 0.5 };
  const m = cam.projectionMatrixInverse.elements;
  const vm = cam.matrixWorld.elements;
  const mul = (mat, vec) => {
    const [x, y, z, w] = vec;
    const o = [
      mat[0] * x + mat[4] * y + mat[8] * z + mat[12] * w,
      mat[1] * x + mat[5] * y + mat[9] * z + mat[13] * w,
      mat[2] * x + mat[6] * y + mat[10] * z + mat[14] * w,
      mat[3] * x + mat[7] * y + mat[11] * z + mat[15] * w,
    ];
    return o;
  };
  const a = mul(m, [v.x, v.y, -1, 1]);
  const b = mul(m, [v.x, v.y, 1, 1]);
  const p0 = mul(vm, [a[0] / a[3], a[1] / a[3], a[2] / a[3], 1]);
  const p1 = mul(vm, [b[0] / b[3], b[1] / b[3], b[2] / b[3], 1]);
  const dir = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const dl = Math.hypot(...dir);
  const D = dir.map((x) => x / dl);
  // 沿射线步进，报告每 20 m 的位置与地形高度
  const B = window.__game.beach;
  const samples = [];
  for (let s = 10; s < 600; s += 20) {
    const x = p0[0] + D[0] * s, y = p0[1] + D[1] * s, z = p0[2] + D[2] * s;
    samples.push({ s, y: +y.toFixed(1), hf: +B.hf.heightAt(x, z).toFixed(2) });
  }
  window.__diagRay = { p0: p0.map((v) => +v.toFixed(1)), D: D.map((v) => +v.toFixed(3)), samples };
});
const ray = await page.evaluate(() => window.__diagRay);
console.log(JSON.stringify(ray, null, 1));
await browser.close();
process.exit(0);
