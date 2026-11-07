/* ==================================================================
 * 测试 G · 正式 Pages 调试接口扫描
 *
 *   构建一份「干净生产构建」（不带 VITE_TEST_HOOKS），起静态服务器，
 *   用无头浏览器打开游戏，断言以下调试 / 测试接口在正式包里均不可用：
 *     · window.__garage.claim   （可绕过比赛验证直接发奖）
 *     · window.__sim            （模拟比赛）
 *     · window.__game           （直接访问运行时 game 对象）
 *     · window.__RaceState      （直接读写比赛状态）
 *     · window.__fs             （测试用文件接口）
 *
 *   同时做产物级双重保险：dist/assets 的 JS 里不应出现这些钩子的赋值语句。
 *   任何一项存在即失败，退出码 1。
 *
 *   node tools/test/pages-interface-scan.mjs
 * ================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  startServer, findBrowser, CHROME_ARGS, loadPuppeteer, createReport, DIST, ROOT,
} from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOTDIR = ROOT;
const DISTDIR = DIST;

/* 1) 干净生产构建（不带任何测试钩子 flag）。
 *    若已存在 dist/，先 rename 到备份目录，避免 vite emptyDir 触发沙箱删文件守卫。
 *    --no-build 时跳过（由调用方预先用 `vite build --outDir dist` 构建好，绕过本地 npx shell 偶发失败）。 */
const NO_BUILD = process.argv.slice(2).includes('--no-build');
if (!NO_BUILD) {
  console.log('· 备份并构建干净生产 dist（无 VITE_TEST_HOOKS）…');
  if (fs.existsSync(DISTDIR)) {
    const bak = path.join(ROOTDIR, `.dist-bak-scan-${Date.now()}`);
    fs.renameSync(DISTDIR, bak);
  }
  execFileSync('npx', ['vite', 'build', '--outDir', 'dist'], {
    cwd: ROOTDIR, stdio: ['ignore', 'ignore', 'inherit'], shell: true,
  });
} else {
  console.log('· 跳过构建（--no-build），使用现有 dist');
}

const report = createReport('正式 Pages 调试接口扫描（测试 G）');

/* 2) 产物级双重保险：dist/assets 的 JS 里不应出现被门控钩子的「赋值」语句。 */
function collectJs(dir) {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) out.push(p);
    }
  })(dir);
  return out;
}
const assetsDir = path.join(DISTDIR, 'assets');
const jsFiles = fs.existsSync(assetsDir) ? collectJs(assetsDir) : [];
// 只有「赋值」形态才算暴露（注释 / 字符串常量里偶现的 __sim 不算）
const bannedAssign = ['window.__garage=', 'window.__sim=', 'window.__game=', 'window.__RaceState=', 'window.__fs='];
const found = {};
for (const f of jsFiles) {
  const txt = fs.readFileSync(f, 'utf8');
  for (const b of bannedAssign) if (txt.includes(b)) found[b] = (found[b] || 0) + 1;
}
report.check('G.6 产物 JS 不含被门控钩子的赋值语句', Object.keys(found).length === 0, JSON.stringify(found));

/* 3) 运行时探测：打开正式包，确认接口确实不存在。 */
const puppeteer = await loadPuppeteer();
const srv = await startServer(DISTDIR);
const browser = await puppeteer.launch({
  executablePath: findBrowser(), headless: true, args: CHROME_ARGS, protocolTimeout: 1800000,
});
const page = await browser.newPage();
page.setDefaultNavigationTimeout(180000);
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

await page.goto(`${srv.url}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
// 正式包没有 __garage 钩子，改用 canvas / readyState 判断 boot 已跑过；再留足时间
await page.waitForFunction(
  () => !!document.querySelector('canvas') || document.readyState === 'complete',
  { timeout: 120000, polling: 300 },
).catch(() => {});
await new Promise((r) => setTimeout(r, 3000));

const probe = await page.evaluate(() => ({
  garageClaim: !!(window.__garage && typeof window.__garage.claim === 'function'),
  sim: typeof window.__sim !== 'undefined',
  game: typeof window.__game !== 'undefined',
  raceState: typeof window.__RaceState !== 'undefined',
  fs: typeof window.__fs !== 'undefined',
  hasCanvas: !!document.querySelector('canvas'),
}));

report.check('G.1 正式包不存在 window.__garage.claim', probe.garageClaim === false, JSON.stringify(probe));
report.check('G.2 正式包不存在 window.__sim', probe.sim === false, `typeof __sim=${probe.sim}`);
report.check('G.3 正式包不存在 window.__game', probe.game === false, `typeof __game=${probe.game}`);
report.check('G.4 正式包不存在 window.__RaceState', probe.raceState === false, `typeof __RaceState=${probe.raceState}`);
report.check('G.5 正式包不存在 window.__fs', probe.fs === false, `typeof __fs=${probe.fs}`);
report.check('G.7 正式包正常渲染（canvas 存在）', probe.hasCanvas === true, `hasCanvas=${probe.hasCanvas}`);

report.write(path.join(ROOTDIR, 'tools/out/pages-interface-scan.json'));
await browser.close();
await srv.close();

const ok = report.ok;
console.log(`\n正式 Pages 接口扫描：${ok ? '全部通过 ✓' : '存在未消除的调试接口 ✗'}`);
console.log(`  浏览器控制台错误数：${consoleErrors.length}`);
if (consoleErrors.length) console.log('  ' + consoleErrors.slice(0, 5).join('\n  '));
process.exit(ok ? 0 : 1);
