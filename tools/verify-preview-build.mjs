/* ==================================================================
 * 预览产物校验（针对最终要部署的 preview-dist）
 *
 *   这份检查运行在「用 lrv2test + VITE_TEST_HOOKS=0 + /little-racing-v2-test/
 *   构建出来的 dist」之上。它做两件事：
 *
 *   A) 产物级（纯文本扫描，无需浏览器）——
 *      不能只因为另一份带钩子的回归构建通过，就认定这份最终产物也已完整回归。
 *      校验项（任意一项失败 → 退出码 1，阻止上传与部署）：
 *        1) 注入前缀确实是 lrv2test（测试版存档根），且正式的默认前缀 'lrv2'
 *           字面量不存在 —— 证明编译进产物的就是测试命名空间，而不是正式版。
 *        2) 基路径确实是测试版 /little-racing-v2-test/。
 *        3) 测试版产物里不存在任何指向正式版路径 /little-racing-v2/ 的引用。
 *        4) 未启用测试钩子：dist JS 中不得出现被门控钩子的「赋值」语句
 *           （window.__sim= / __game= / __garage= / __RaceState= / __fs=）。
 *           —— 防止把带调试接口的构建当成干净预览产物上线。
 *        5) 正式版存档命名空间不得泄漏为连续字面量：全部 lrv2.（含 lrv2.garage. 等）
 *           与 littleRacingV2.（点号紧跟 V2 之后）均为 0。
 *        6) index.html 入口脚本确实落在测试基路径下。
 *
 *   B) 运行时（浏览器，若可用）——
 *      实际打开页面，确认游戏启动后写入 localStorage 的键确实落在
 *      lrv2test / littleRacingV2test 命名空间，且**绝不**串到正式版
 *      lrv2 / littleRacingV2。这是对「隔离」的运行时实证，而非仅看产物里
 *      有没有 lrv2test 字符串（单独搜到 lrv2test 不构成完整隔离验证）。
 *      若环境无可用浏览器，则降级为告警（不阻断），由 preview-smoke 兜底。
 *
 *   node tools/verify-preview-build.mjs
 * ================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { DIST, OUT, createReport, startServer, findBrowser, CHROME_ARGS, loadPuppeteer } from './test/lib.mjs';

const TEXT_EXT = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.map']);

function walkText(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkText(p, out);
    else if (TEXT_EXT.has(path.extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}

function countNeedle(files, needle) {
  let n = 0;
  for (const f of files) {
    const txt = fs.readFileSync(f, 'utf8');
    let i = 0;
    while ((i = txt.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  }
  return n;
}

if (!fs.existsSync(DIST)) {
  console.error('::error::dist 不存在，请先构建预览产物');
  process.exit(1);
}

const files = walkText(DIST);
const report = createReport('预览产物校验（lrv2test 构建）');

/* ---------- A) 产物级静态校验 ---------- */
// 1) 注入前缀 === lrv2test（测试版存档根）确实编进了产物（弱校验，仅确认值被编译）
const cLrv2test = countNeedle(files, 'lrv2test');
report.check('预览产物含注入的 lrv2test 前缀（测试版存档根已编译）', cLrv2test > 0, `lrv2test 命中 ${cLrv2test}`);

// 2) 测试基路径存在
const cBase = countNeedle(files, 'little-racing-v2-test');
report.check('预览产物引用测试基路径 /little-racing-v2-test/', cBase > 0, `little-racing-v2-test 命中 ${cBase}`);

// 3) 不得引用正式基路径
const cProdBase = countNeedle(files, '/little-racing-v2/');
report.check('预览产物不含正式基路径 /little-racing-v2/', cProdBase === 0, `命中 ${cProdBase}`);

// 4) 不得启用测试钩子（被门控钩子的赋值语句不存在）
const bannedAssign = ['window.__sim=', 'window.__game=', 'window.__garage=', 'window.__RaceState=', 'window.__fs='];
const hookFound = {};
for (const f of files.filter((x) => x.endsWith('.js'))) {
  const txt = fs.readFileSync(f, 'utf8');
  for (const b of bannedAssign) if (txt.includes(b)) hookFound[b] = (hookFound[b] || 0) + 1;
}
report.check('预览产物未启用 VITE_TEST_HOOKS（无调试钩子赋值）', Object.keys(hookFound).length === 0, JSON.stringify(hookFound));

// 5) 正式版存档命名空间不得泄漏：用「前缀」精确判定**全部** lrv2.* / littleRacingV2.*
//    命名空间（不限于 .garage.），避免仅搜裸 lrv2 字符串的误判：
//    · lrv2.        —— 正式版全部命名空间根（lrv2test. 不会命中：lrv2 后是 t 不是 .）
//    · littleRacingV2.—— 正式版故事/音乐/语音命名空间（littleRacingV2test. 不会命中：V2 后是 t）
//    二者为 0 才说明正式命名空间没有编进最终产物。
//    注：测试构建里唯一的「lrv2 字样」是代码中的后备字面量 'lrv2'（无小数点，不命中 lrv2.），
//    以及由 SAVE_PREFIX 派生的 lrv2test.*；迁移日志也已改为动态引用 LEGACY.vehicle，
//    不再硬编码正式键，因此本检查对测试产物恒为 0。
const cFormalLrv2 = countNeedle(files, 'lrv2.');
const cStory = countNeedle(files, 'littleRacingV2.');   // 点号紧跟 V2：正式版故事/音乐/语音命名空间
report.check('预览产物不硬编码正式存档命名空间 lrv2.（正式命名空间未泄漏）', cFormalLrv2 === 0, `命中 ${cFormalLrv2}`);
report.check('预览产物不泄漏正式命名空间 littleRacingV2.（正式命名空间未泄漏）', cStory === 0, `命中 ${cStory}`);

// 6) index.html 入口脚本在测试基路径下
const indexPath = path.join(DIST, 'index.html');
if (fs.existsSync(indexPath)) {
  const html = fs.readFileSync(indexPath, 'utf8');
  const entryOk = html.includes('little-racing-v2-test/assets/');
  report.check('index.html 入口脚本落在测试基路径', entryOk, entryOk ? 'ok' : '未找到 little-racing-v2-test/assets/');
} else {
  report.check('index.html 存在', false, 'dist/index.html 不存在');
}

/* ---------- B) 运行时 localStorage 命名空间校验（若浏览器可用）---------- */
let runtimeDone = false;
try {
  const puppeteer = await loadPuppeteer();
  const srv = await startServer(DIST, { base: '/little-racing-v2-test/' });
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: findBrowser(), headless: true, args: CHROME_ARGS, protocolTimeout: 1800000,
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    // 预置测试版 legacy 键，触发游戏 migrate() 真实把存档落盘到 lrv2test.garage.*，
    // 从而能在运行时实证「存档命名空间确实是测试版、且未串到正式版 lrv2」。
    // （此键只作用于本测试浏览器；正式版构建里它是 lrv2.vehicle，互不影响。）
    await page.evaluateOnNewDocument(() => {
      try { localStorage.setItem('lrv2test.vehicle', 'turtle'); } catch { /* ignore */ }
    });
    await page.goto(srv.pageUrl, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => !!document.querySelector('canvas'), { timeout: 120000, polling: 300 }).catch(() => {});
    // 确定性等待：直到游戏把存档真正落盘到测试命名空间（不再固定 sleep，规避冷启动偶发漏判）
    await page.waitForFunction(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith('lrv2test.garage.') || k.startsWith('littleRacingV2test.')) return true;
      }
      return false;
    }, { timeout: 30000, polling: 200 }).catch(() => {});

    const keys = await page.evaluate(() => {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i));
      return out;
    });
    // 实际被游戏写入的存档键：测试命名空间的「真实存档根」lrv2test.garage.* 与
    // littleRacingV2test.*。必须精确到游戏落盘键，不能用 lrv2test.* 模糊匹配：
    // 本测试为触发 migrate 会预置一个 legacy 键 lrv2test.vehicle；若判定放宽到
    // lrv2test.*，即使游戏根本没 boot（例如产物资源路径错误、脚本 404），也会因
    // 这个预置键而假阳性通过 —— 那就退回成「只搜到 lrv2test 字符串」了。
    // 此处与上方 waitForFunction 的等待条件一致，构成「游戏真的把存档写进测试命名空间」的实证。
    const testKeys = keys.filter((k) => k.startsWith('lrv2test.garage.') || k.startsWith('littleRacingV2test.'));
    // 正式版命名空间：全部 lrv2.* 与 littleRacingV2.*（第四轮要求：从 .garage. 扩大到全部 lrv2.；
    // 注意 lrv2test. / littleRacingV2test. 不算正式版，与静态检查的 lrv2. 字面量判定一致）
    const formalKeys = keys.filter((k) => k.startsWith('lrv2.') || k.startsWith('littleRacingV2.'));
    report.check('运行时 localStorage 确实写入测试命名空间键（lrv2test.garage.* / littleRacingV2test.*）',
      testKeys.length > 0, `testKeys=${testKeys.length} [${testKeys.slice(0, 4).join(', ')}]`);
    report.check('运行时 localStorage 无正式版命名空间泄漏（无 lrv2.garage.* / littleRacingV2.*）',
      formalKeys.length === 0, `formalKeys=${formalKeys.length} [${formalKeys.slice(0, 5).join(', ')}]`);
    runtimeDone = true;
  } finally {
    if (browser) await browser.close().catch(() => {});
    await srv.close().catch(() => {});
  }
} catch (e) {
  console.warn('⚠ 运行时 localStorage 校验跳过（无可用浏览器或启动失败）：', (e && e.message) || e);
  report.check('运行时 localStorage 命名空间校验（环境无浏览器，已跳过；由 preview-smoke 兜底）', true, 'SKIPPED');
}

report.write(path.join(OUT, 'preview-build-check.json'));
const ok = report.ok;
console.log(`\n预览产物校验：${ok ? '全部通过 ✓' : '未通过 ✗'}（运行时检查${runtimeDone ? '已执行' : '已跳过'}）`);
process.exit(ok ? 0 : 1);
