/* ==================================================================
 * 预览运行时冒烟测试（针对最终要部署的 preview-dist）
 *
 *   这份测试运行在「用 lrv2test + VITE_TEST_HOOKS=0 + /little-racing-v2-test/
 *   构建出来的 dist」之上，用无头浏览器实际打开页面，确认这份最终产物能
 *   正常启动并渲染，且在本机用与 GitHub Pages 完全一致的方式（站点根 =
 *   仓库名，资源走 /little-racing-v2-test/assets/...）正确服务：
 *     · 页面从子路径 /little-racing-v2-test/ 打开（baseURI 正确）
 *     · 页面成功 boot —— Three.js 已创建 canvas 且 WebGL 上下文有尺寸
 *     · 加载期间没有未捕获的 JS 异常（pageerror）
 *     · 所有静态资源（JS / CSS / GLB / 音乐 / 贴图 / 图标 / manifest）均 200
 *      加载，无 404/失败 —— 既监控浏览器自身的请求，也**主动**按子路径逐个
 *      GET 各类型代表资源，确认子路径 → dist 根的映射确实正确（不靠游戏走到
 *      某一步才偶然请求到）。代表资源递归扫描整个 dist，且只强制「项目实际
 *      构建产物中真实存在的类型」；项目未使用的类型（本项目无 svg / woff2）
 *      不做存在性断言，避免把「本来就没有」误判成「构建漏产出」。
 *     · 运行时 localStorage 命名空间检查：游戏启动后实际写入的键，确实落在
 *          lrv2test / littleRacingV2test 命名空间，绝不串到正式版 lrv2 /
 *          littleRacingV2 —— 这是「隔离」的运行时实证，而非仅看产物里有没有
 *          lrv2test 字符串
 *
 *   注意：预览构建未开启 VITE_TEST_HOOKS，因此无法用 __sim 驱动游戏逻辑；
 *   游戏逻辑由「带钩子的回归套件」覆盖。这里只验证「最终产物能开机即跑」+ 隔离。
 *
 *   node tools/test/preview-smoke.mjs
 * ================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {
  startServer, findBrowser, CHROME_ARGS, loadPuppeteer, createReport, DIST, OUT,
} from './lib.mjs';

// 必须与 CI 构建的 VITE_BASE 完全一致，否则子路径模拟与线上不符
const BASE = '/little-racing-v2-test/';

if (!fs.existsSync(DIST)) {
  console.error('::error::dist 不存在，请先构建预览产物');
  process.exit(1);
}

const report = createReport(`预览运行时冒烟测试（lrv2test / hooks OFF / 子路径 ${BASE}）`);

const srv = await startServer(DIST, { base: BASE });
let browser;
const good = [];        // 浏览器实际收到的成功响应 { rel, status, ext }
const loadFails = [];   // 浏览器实际遇到的失败响应 / 网络失败
const pageErrors = [];
try {
  const puppeteer = await loadPuppeteer();
  browser = await puppeteer.launch({
    executablePath: findBrowser(), headless: true, args: CHROME_ARGS, protocolTimeout: 1800000,
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  // 预置测试版 legacy 键，触发游戏 migrate() 真实把存档落盘到 lrv2test.garage.*，
  // 从而能在运行时实证「存档命名空间确实是测试版、且未串到正式版 lrv2」。
  // （正式版构建里该键会是 lrv2.vehicle；这里只影响测试用浏览器，不碰任何用户数据。）
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem('lrv2test.vehicle', 'turtle'); } catch { /* ignore */ }
  });
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (!u.startsWith(srv.url)) return;          // 只检查本服务器资源，忽略外部 URL（CDN/字体等）
    const rel = stripBase(u);
    loadFails.push(`${rel} :: ${(r.failure() && r.failure().errorText) || 'requestfailed'}`);
  });
  page.on('response', (r) => {
    const u = r.url();
    if (!u.startsWith(srv.url)) return;          // 只关心本服务器资源（忽略外部字体等）
    const rel = stripBase(u);
    if (rel === '/favicon.ico') return;          // 浏览器自动请求的根 favicon 与子路径部署无关，忽略
    const ext = (rel.split('?')[0].match(/\.([a-z0-9]+)$/i) || [])[1] || '';
    if (r.status() >= 400) loadFails.push(`${r.status()} ${rel}`);
    else good.push({ rel, status: r.status(), ext });
  });

  await page.setViewport({ width: 1280, height: 720 });
  // 从子路径打开（pageUrl 已含 BASE）。导航偶发超时则重试（swiftshader 长时运行偶发卡顿）。
  let navOk = false;
  for (let attempt = 1; attempt <= 3 && !navOk; attempt++) {
    try {
      await page.goto(srv.pageUrl, { waitUntil: 'domcontentloaded', timeout: 180000 });
      navOk = true;
    } catch (e) {
      console.warn(`  ⚠ 预览导航重试 ${attempt}/3：${e.message}`);
    }
  }
  await page.waitForFunction(
    () => !!document.querySelector('canvas'),
    { timeout: 120000, polling: 300 },
  ).catch(() => {});
  await new Promise((r) => setTimeout(r, 4000));

  const probe = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    return {
      hasCanvas: !!c, w: c ? c.width : 0, h: c ? c.height : 0,
      readyState: document.readyState, baseURI: document.baseURI,
    };
  });

  report.check('页面从子路径打开（baseURI 含 ' + BASE + '）', probe.baseURI.includes(BASE), probe.baseURI);
  report.check('预览页面成功渲染（canvas 存在且有尺寸）',
    probe.hasCanvas && probe.w > 0 && probe.h > 0, JSON.stringify(probe));
  report.check('预览页面加载无未捕获异常', pageErrors.length === 0, `pageerror=${pageErrors.length}`);
  if (pageErrors.length) console.log('  ' + pageErrors.slice(0, 5).join('\n  '));

  // 被动加载断言只覆盖「随文档开机即加载」的类型：入口 JS 模块与 CSS。
  // 贴图 / 图标 / 模型 / 音频属于按需加载：PWA 图标是否在开机窗口内被请求取决于
  // 浏览器（同一份产物复跑可能 png 200=1，也可能 200=0），不能把「是否恰好请求
  // 到 png」当成失败条件；它们的存在性与子路径映射由下方「主动 GET + 存在性
  // 断言」权威验证。若浏览器真请求了却返回 4xx，上面的 loadFails 会捕获，并使
  // 「浏览器侧无 404 / 失败资源」失败，因此移除该被动断言不会造成漏检。
  const want = { js: 'JS 模块', css: 'CSS 样式' };
  const counts = {};
  for (const g of good) if (g.status === 200) counts[g.ext] = (counts[g.ext] || 0) + 1;
  for (const [ext, label] of Object.entries(want)) {
    report.check(`浏览器开机加载到 ${label}（${ext}）200 响应`, (counts[ext] || 0) > 0, `${ext} 200=${counts[ext] || 0}`);
  }
  report.check('浏览器侧无 404 / 失败资源', loadFails.length === 0, `失败 ${loadFails.length} 项`);
  if (loadFails.length) console.log('  ' + loadFails.slice(0, 12).join('\n  '));

  /* ---- 主动按子路径 GET 各类型代表资源，验证「子路径 → dist 根」映射 ---- */
  // 复审点名的 7 类先做「实际构建产物」实证：递归扫描整个 dist，如实打印每类数量。
  //   本项目实测（dist 递归）：js=12 css=1 glb=32 mp3=8 png=5 svg=0 woff2=0，
  //   另有 jpg=1（assets/boot.jpg）、webmanifest=1（根目录 manifest）。
  //   源码与 public/ 中无 .svg / .woff2 / @font-face 引用 → svg、woff2 是
  //   「项目根本没有使用的类型」，因此不做存在性断言（否则是把「本来就没有」
  //   误判成「构建漏产出」的假失败）。若将来项目用上了，扫描到文件会自动纳入
  //   子路径 200 校验，不会静默漏检。
  const REVIEW_EXTS = ['js', 'css', 'glb', 'mp3', 'png', 'svg', 'woff2'];
  // 项目真实产出、必须存在的类型：点名 7 类中确实存在的，加上实际产出的 jpg /
  // webmanifest，去掉本项目未使用的 svg / woff2。
  const REQUIRED_EXTS = ['js', 'css', 'glb', 'mp3', 'png', 'jpg', 'webmanifest'];
  const OPTIONAL_EXTS = REVIEW_EXTS.filter((e) => !REQUIRED_EXTS.includes(e));
  const { picks, counts: distCounts } = scanAssets(DIST); // 递归整个 dist：代表路径 + 计数

  console.log('  · 点名 7 类资源实测：' + REVIEW_EXTS.map((e) => `${e}=${distCounts[e] || 0}`).join('  '));
  for (const ext of OPTIONAL_EXTS) {
    const n = distCounts[ext] || 0;
    if (n === 0) {
      console.log(`  · .${ext}：本构建 0 个，项目未使用该类型 → 不强制要求（跳过存在性断言）`);
    } else {
      // 项目将来用上该类型时自动纳入校验，避免「有资源却没验」
      const status = await httpStatus(`${srv.pageUrl}${picks[ext]}`);
      report.check(`可选类型 ${ext} 子路径映射（HTTP ${status}）`, status === 200, `${picks[ext]} :: ${status}`);
    }
  }

  // 存在性断言 + 子路径 200 断言：每种项目真实应产出的类型，在 dist（含 assets/、
  // assets/ch2/、icons/ 等子目录）中必须真有文件，缺失即明确失败，绝不静默跳过
  // （防止「构建漏产出某类资源却仍判通过」）。请求路径 = pageUrl + 相对 dist 根
  // 的路径，保证图标 / 深层 GLB / 根 manifest 的映射也都正确。
  for (const ext of REQUIRED_EXTS) {
    const rel = picks[ext];
    if (!rel) {
      report.check(`dist 含 ${ext} 类型资源（存在性断言）`, false, `dist 中未找到 .${ext} 文件`);
      continue;
    }
    const status = await httpStatus(`${srv.pageUrl}${rel}`);
    report.check(`子路径映射 ${ext}（HTTP ${status}）`, status === 200, `${rel} :: ${status}`);
  }

  /* ---- 运行时 localStorage 命名空间检查（隔离实证）---- */
  // 确定性等待：直到游戏把存档真正落盘到测试命名空间（规避冷启动偶发漏判）
  await page.waitForFunction(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith('lrv2test.garage.') || k.startsWith('littleRacingV2test.')) return true;
    }
    return false;
  }, { timeout: 30000, polling: 200 }).catch(() => {});
  const ls = await page.evaluate(() => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    return keys;
  });
  const ns = classifyKeys(ls);
  report.check('运行时 localStorage 确实写入测试命名空间键（lrv2test.garage.* / littleRacingV2test.*）',
    ns.testKeys.length > 0, `testKeys=${ns.testKeys.length} [${ns.testKeys.slice(0, 3).join(', ')}]`);
  report.check('运行时 localStorage 无正式版命名空间泄漏（无 lrv2.garage.* / littleRacingV2.*）',
    ns.formalKeys.length === 0, `formalKeys=${ns.formalKeys.length} [${ns.formalKeys.slice(0, 5).join(', ')}]`);

  report.write(path.join(OUT, 'preview-smoke.json'));
} catch (e) {
  console.error('::error::冒烟测试异常：', (e && e.stack) || e);
  report.check('冒烟测试过程未抛异常', false, String((e && e.message) || e));
  try { report.write(path.join(OUT, 'preview-smoke.json')); } catch { /* ignore */ }
} finally {
  // 测试失败也必须清理，避免浏览器/服务器进程残留导致 CI 挂起
  if (browser) await browser.close().catch(() => {});
  await srv.close().catch(() => {});
}

const ok = report.ok;
console.log(`\n预览运行时冒烟：${ok ? '通过 ✓' : '未通过 ✗'}`);
process.exit(ok ? 0 : 1);

/* --------------------------- helpers --------------------------- */
function stripBase(url) {
  let u = url;
  if (u.startsWith(srv.url)) u = u.slice(srv.url.length);
  if (u.startsWith(BASE)) u = u.slice(BASE.length);
  return u || '/';
}

function httpStatus(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode || 0); });
    req.on('error', () => resolve(0));
    req.setTimeout(10000, () => { req.destroy(); resolve(0); });
  });
}

/**
 * 递归扫描整个 dist，返回：
 *   picks  —— 每种扩展名的第一个文件，路径「相对 dist 根」
 *             （如 assets/index-xxx.js、assets/ch2/barrel.glb、icons/icon-192.png、
 *               manifest.webmanifest），供 `${srv.pageUrl}${rel}` 直接按子路径 GET；
 *   counts —— 每种扩展名的文件总数，用于实证「哪些类型确实存在」。
 * 不能只扫 assets/ —— 图标在 dist/icons/、部分 GLB 在 assets/ch2/ 等子目录，
 * 且各类型分布随构建变化；递归才能保证请求路径映射覆盖全部真实产物。
 */
function scanAssets(distDir) {
  const picks = {};
  const counts = {};
  (function walk(dir, relDir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(path.join(dir, e.name), rel); continue; }
      const ext = e.name.toLowerCase().split('.').pop();
      counts[ext] = (counts[ext] || 0) + 1;
      if (picks[ext] === undefined) picks[ext] = rel;
    }
  })(distDir, '');
  return { picks, counts };
}

/**
 * 把 localStorage 键分成「测试版命名空间」与「正式版命名空间」。
 *   测试版：游戏真实落盘的 lrv2test.garage.* 或 littleRacingV2test.*
 *           —— 精确到存档根，不用 lrv2test.* 模糊匹配：本测试为触发 migrate
 *              预置了 legacy 键 lrv2test.vehicle，若放宽会让它假阳性通过
 *              （产物坏掉、游戏没 boot 也判成功）。与 waitForFunction 条件一致。
 *   正式版：以 lrv2.（全部，含 lrv2.garage. 等）或 littleRacingV2. 开头
 *           （注意 lrv2test. / littleRacingV2test. 不算正式版）
 * 与 verify-preview-build.mjs 的静态/运行时判定保持一致。
 * 返回 { testKeys, formalKeys }。
 */
function classifyKeys(keys) {
  const testKeys = [];
  const formalKeys = [];
  for (const k of keys) {
    // 测试版命名空间（游戏真实落盘的存档根）
    if (k.startsWith('lrv2test.garage.') || k.startsWith('littleRacingV2test.')) testKeys.push(k);
    // 正式版命名空间：全部 lrv2.* 或 littleRacingV2.*（注意 lrv2test. 不算 lrv2.）
    else if (k.startsWith('lrv2.') || k.startsWith('littleRacingV2.')) formalKeys.push(k);
  }
  return { testKeys, formalKeys };
}
