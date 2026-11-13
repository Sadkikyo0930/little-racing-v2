#!/usr/bin/env node
/**
 * tests/pwa-nav-chain.e2e.mjs
 *
 * 浏览器导航链验证：把 docs/ 映射成 /little-racing-v2/ 起本地静态服务，
 * 用真实 Chromium 走一遍「通行证页 → 家长入口 → 选 mom → 输入密码 → 验证成功 → 进入游戏」，
 * 拦截网关请求（不触碰真实 CloudBase / 不读取任何凭据），记录完整导航链。
 *
 * 同时跑 main 基线（修复前）与工作区（修复后）两套页面，输出对比。
 *
 * ⚠️ 重要边界：
 *   这是**桌面 Chromium 的逻辑验证**，验证的是 URL 形式、同源/scope、
 *   跳转次数、认证请求、sessionStorage、无 popup / 无跨域导航。
 *   Chromium 没有 iOS Home Screen Web App 的 standalone 显示模式，
 *   **不能证明 iPhone 桌面 PWA 是否保持全屏**，也绝不能被当作实机验收结果。
 *   iPhone 全屏必须由用户用原来的桌面图标亲自验收。
 *
 * 用法：node tests/pwa-nav-chain.e2e.mjs [--out=tests/out]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DOCS = path.join(ROOT, 'docs');
const PREFIX = '/little-racing-v2/';
const PORT = 8127;
const OUT = (process.argv.find(a => a.startsWith('--out=')) || '').slice(6)
  || path.join(HERE, 'out');
fs.mkdirSync(OUT, {recursive: true});

const MIME = {
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml',
};

/** 读取文件内容：'after' = 工作区（修复后）；'before' = git main（修复前） */
const beforeCache = new Map();
function mainFile(rel) {
  if (!beforeCache.has(rel)) {
    beforeCache.set(rel, execFileSync('git', ['show', 'main:' + rel],
      {cwd: ROOT, encoding: 'utf8', maxBuffer: 8 << 20}));
  }
  return beforeCache.get(rel);
}
function content(mode, rel) {
  if (mode === 'before' && (rel === 'gate.html' || rel === 'r5/paths.mjs')) {
    return mainFile('docs/' + rel);
  }
  const p = path.join(DOCS, rel);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

let MODE = 'after';
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (!u.pathname.startsWith(PREFIX)) { res.writeHead(404).end(); return; }
  let rel = u.pathname.slice(PREFIX.length) || 'index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  const data = content(MODE, rel);
  if (data === null) { res.writeHead(404).end('not found: ' + rel); return; }
  res.writeHead(200, {
    'content-type': MIME[path.extname(rel)] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(data);
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** 加载 Playwright：优先本地依赖，其次已知的相邻工程副本；都找不到则明确 SKIP */
function loadPlaywright() {
  const candidates = [
    path.join(ROOT, 'node_modules/playwright'),
    'C:/Users/Administrator/WorkBuddy/2026-11-13-09-09-50/ae86/e2e/node_modules/playwright',
  ];
  for (const c of candidates) {
    try { return createRequire(path.join(c, 'noop.js'))('playwright'); } catch { /* next */ }
  }
  try { return createRequire(import.meta.url)('playwright'); } catch { return null; }
}

async function runScenario(browser, mode) {
  MODE = mode;
  const context = await browser.newContext({viewport: {width: 844, height: 390}});
  const page = await context.newPage();
  const log = {
    mode,
    navigations: [],       // 页面顶层导航（framenavigated）
    navRequests: [],       // isNavigationRequest 的 URL
    popups: [],            // 新窗口 / 新标签（应为 0）
    crossOriginTopLevel: [], // 跨源顶层导航（应为 0）
    parentAuth: [],        // 家长验证请求（不记录 body 内容，只记录是否已发 + 路径）
    gatewayCalls: [],      // 所有发往网关的请求路径
    consoleErrors: [],
  };

  // 模拟「已绑定设备」+「standalone 上下文标志」；不写入任何真实凭据
  await page.addInitScript(() => {
    try { localStorage.setItem('r5_device', 'r5e2e_device_0001'); } catch {}
    try { Object.defineProperty(navigator, 'standalone', {get: () => true, configurable: true}); } catch {}
    // 记录 sessionStorage 写入事件到 localStorage（同源跨文档保留、不会被守卫清除），
    // 因此即使 index.html 的 race-guard 之后 fail-closed 清掉凭证，仍可证明「签发过」。
    try {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        try {
          if (this === sessionStorage && k !== '__e2e_writes') {
            let arr = [];
            try { arr = JSON.parse(localStorage.getItem('__e2e_writes') || '[]'); } catch {}
            arr.push(k);
            orig.call(localStorage, '__e2e_writes', JSON.stringify(arr));
          }
        } catch {}
        return orig.call(this, k, v);
      };
    } catch {}
  });

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) log.navigations.push(frame.url());
  });
  page.on('request', (r) => {
    if (r.isNavigationRequest()) log.navRequests.push({url: r.url(), type: r.resourceType()});
    try {
      const o = new URL(r.url());
      if (o.hostname.includes('tcloudbase') || o.pathname.startsWith('/r5')) {
        log.gatewayCalls.push(o.pathname);
      }
    } catch {}
  });
  page.on('popup', (p) => log.popups.push(p.url()));
  page.on('console', (m) => { if (m.type() === 'error') log.consoleErrors.push(m.text().slice(0, 200)); });

  // 网关全部拦截：家长验证返回「成功」，其余返回 fail-closed 形态（不触碰真实云端）
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.includes('tcloudbase') || url.includes('/r5/v1/')) {
      if (url.includes('/v1/parent/session')) {
        log.parentAuth.push({path: new URL(url).pathname, method: req.method()});
        await route.fulfill({status: 200, contentType: 'application/json',
          body: JSON.stringify({api: 'r5_parent_session', authorized: true,
            remaining_seconds: 1800, session_origin: 'parent_override'})});
        return;
      }
      await route.fulfill({status: 200, contentType: 'application/json', body: '{}'});
      return;
    }
    await route.continue();
  });

  const base = `http://127.0.0.1:${PORT}${PREFIX}`;
  await page.goto(base + 'gate.html?r5=NO_GRANT', {waitUntil: 'domcontentloaded'});
  await sleep(1200);

  // 读取该场景下 gameUrl() 的实际返回值（URL 形式的核心证据）
  log.gameUrlValue = await page.evaluate(async () => {
    try {
      const m = await import('./r5/paths.mjs');
      return m.gameUrl();
    } catch (e) { return 'IMPORT_ERROR: ' + e.message; }
  }).catch(e => 'EVAL_ERROR: ' + e.message);

  // 记录 gate.html 是否声明 manifest（修复前没有）
  log.gateManifest = await page.evaluate(() =>
    !!document.querySelector('link[rel="manifest"]')).catch(() => null);
  log.gateIosMetas = await page.evaluate(() => ({
    capable: !!document.querySelector('meta[name="apple-mobile-web-app-capable"]'),
    mobileCapable: !!document.querySelector('meta[name="mobile-web-app-capable"]'),
    statusBar: !!document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]'),
  })).catch(() => null);

  // 走家长入口：打开弹窗 → 选 mom → 输入密码 → 提交
  await page.click('#parent-entry-open');
  await page.selectOption('#parent-entry-account', 'growth_mom');
  await page.fill('#parent-entry-password', 'e2e-placeholder-not-a-real-password');
  const beforeNavCount = log.navigations.length;
  await page.click('#parent-entry-submit');
  await sleep(2500);

  log.postAuthNavigations = log.navigations.slice(beforeNavCount);
  log.finalUrl = page.url();
  log.grantIssued = await page.evaluate(() => {
    try {
      const arr = JSON.parse(localStorage.getItem('__e2e_writes') || '[]');
      return arr.includes('r5.grant');
    } catch { return false; }
  }).catch(() => false);
  // 导航后凭证是否仍存活：mock 网关返回「拒绝」，守卫应 fail-closed 清除它（安全行为）
  log.grantPresent = await page.evaluate(() => {
    try { return !!sessionStorage.getItem('r5.grant'); } catch { return false; }
  }).catch(() => false);
  log.passwordLeaked = await page.evaluate(() => {
    try {
      const s = JSON.stringify({ls: {...localStorage}, ss: {...sessionStorage}, href: location.href});
      return /e2e-placeholder/i.test(s);
    } catch { return false; }
  }).catch(() => false);

  // 检查是否有跨源顶层导航
  for (const n of log.navRequests) {
    try {
      const o = new URL(n.url);
      if (o.origin !== `http://127.0.0.1:${PORT}`) log.crossOriginTopLevel.push(n.url);
    } catch {}
  }

  await context.close();
  return log;
}

const report = {
  generatedAt: new Date().toISOString(),
  engine: null,
  note: '桌面 Chromium 逻辑验证，非 iPhone 桌面 PWA 实机验证；iOS standalone 全屏需用户真机验收',
  scenarios: {},
  assertions: [],
};

function check(name, cond, detail = '') {
  report.assertions.push({name, pass: !!cond, detail});
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' → ' + detail : ''));
  return !!cond;
}

const pw = loadPlaywright();
if (!pw) {
  report.engine = 'SKIPPED (playwright 未安装)';
  console.log('SKIP: 未找到 playwright，浏览器导航链测试未运行（不视为通过）');
  fs.writeFileSync(path.join(OUT, 'pwa-nav-chain.json'), JSON.stringify(report, null, 2));
  process.exit(2);
}
report.engine = 'Chromium (desktop, headless)';

await new Promise(r => server.listen(PORT, '127.0.0.1', r));
let browser;
try {
  const exe = 'C:/Users/Administrator/WorkBuddy/2026-11-13-09-09-50/ae86/e2e/browser/chrome-win/chrome.exe';
  browser = await pw.chromium.launch({
    headless: true,
    ...(fs.existsSync(exe) ? {executablePath: exe} : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  for (const mode of ['before', 'after']) {
    console.log('\n--- 场景: ' + (mode === 'before' ? '修复前 (main 基线)' : '修复后 (本分支)') + ' ---');
    report.scenarios[mode] = await runScenario(browser, mode);
    const s = report.scenarios[mode];
    console.log('  gameUrl()      =', s.gameUrlValue);
    console.log('  gate manifest  =', s.gateManifest, JSON.stringify(s.gateIosMetas));
    console.log('  认证后导航     =', JSON.stringify(s.postAuthNavigations));
    console.log('  最终 URL       =', s.finalUrl);
    console.log('  grant 已签发   =', s.grantIssued, '| 导航后存活 =', s.grantPresent,
      '| 弹窗数 =', s.popups.length, '| 跨源顶层导航 =', s.crossOriginTopLevel.length);
  }

  const b = report.scenarios.before, a = report.scenarios.after;

  console.log('\n=== 断言 ===');
  check('修复前 gameUrl() 返回绝对 URL（根因证据）',
    /^https?:\/\//.test(b.gameUrlValue), b.gameUrlValue);
  check('修复后 gameUrl() 返回相对路径',
    a.gameUrlValue === './index.html', a.gameUrlValue);
  check('修复前后最终进入同一个游戏页文档',
    new URL(b.finalUrl).pathname === new URL(a.finalUrl).pathname,
    b.finalUrl + ' vs ' + a.finalUrl);
  check('修复前 gate.html 未声明 manifest（根因证据）', b.gateManifest === false);
  check('修复后 gate.html 已声明 manifest', a.gateManifest === true);
  check('修复后 gate.html 三项 iOS meta 齐全',
    a.gateIosMetas && a.gateIosMetas.capable && a.gateIosMetas.mobileCapable
    && a.gateIosMetas.statusBar, JSON.stringify(a.gateIosMetas));
  check('修复前 gate.html 缺 iOS meta（根因证据）',
    b.gateIosMetas && !b.gateIosMetas.mobileCapable && !b.gateIosMetas.statusBar,
    JSON.stringify(b.gateIosMetas));
  check('两条路径都只发生一次顶层导航（无第二次跳转）',
    a.postAuthNavigations.length === 1, String(a.postAuthNavigations.length));
  check('家长验证成功确实调用了 /v1/parent/session',
    a.parentAuth.length >= 1, JSON.stringify(a.parentAuth));
  check('验证成功后确实签发过 sessionStorage 凭证（r5.grant）',
    a.grantIssued === true, String(a.grantIssued));
  check('网关拒绝时守卫 fail-closed 清除凭证（刷新/重进不会免密放行）',
    a.grantPresent === false, 'grantPresent=' + a.grantPresent);
  check('密码未落入 URL / localStorage / sessionStorage', a.passwordLeaked === false);
  check('未打开任何新窗口 / 新标签', a.popups.length === 0);
  check('无跨源顶层导航（同源同 scope）',
    a.crossOriginTopLevel.length === 0, JSON.stringify(a.crossOriginTopLevel));
  check('最终 URL 落在 PWA scope 内',
    new URL(a.finalUrl).pathname.startsWith(PREFIX), a.finalUrl);
  check('修复后无致命控制台错误',
    a.consoleErrors.filter(e => !/favicon|404|net::ERR/i.test(e)).length === 0,
    JSON.stringify(a.consoleErrors.slice(0, 3)));

  report.pass = report.assertions.every(x => x.pass);
  report.summary = `${report.assertions.filter(x => x.pass).length}/${report.assertions.length}`;
  console.log('\n结果: ' + report.summary + '   (桌面 Chromium 逻辑验证，非 iOS 实机)');
} catch (e) {
  report.engine = 'ERROR';
  report.error = String(e && e.stack || e);
  console.error('浏览器测试异常:', e);
} finally {
  if (browser) await browser.close();
  server.close();
}
fs.writeFileSync(path.join(OUT, 'pwa-nav-chain.json'), JSON.stringify(report, null, 2));
console.log('报告:', path.join(OUT, 'pwa-nav-chain.json'));
process.exit(report.pass ? 0 : 1);
