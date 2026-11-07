/* 第一阶段测试的公共件：静态服务器 + 无头浏览器启动 + 断言收集。
 *
 * 与 .smoke/serve.mjs 的区别：这份是**交付源码的一部分**，不依赖工作区里
 * 任何临时脚本，路径全部相对 little-racing-v2/ 解析，换台机器也能跑。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../..');          // little-racing-v2/
export const DIST = path.join(ROOT, 'dist');
export const OUT = path.join(ROOT, 'tools', 'out');
export const SHOTS = path.join(OUT, 'shots');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

/**
 * 起一个静态服务器，按 GitHub Pages 的方式服务 dist/。
 *
 * @param {string} dir  要服务的目录（默认 DIST）。
 * @param {object} [opts]
 * @param {string} [opts.base='']  站点基路径。设为 '/little-racing-v2-test/' 时，
 *   服务器会把该前缀从请求路径里剥掉再映射到 dir 根目录，从而正确模拟
 *   GitHub Pages 项目站点（https://<user>.github.io/<repo>/）下的子路径访问，
 *   让 /<base>/assets/xxx 这类请求落到 dir/assets/xxx。
 *   空字符串表示根路径（默认行为），与旧版回归测试（reward/stage1/chapter2/…）兼容。
 */
export function startServer(dir = DIST, { base = '' } = {}) {
  const ROOTDIR = path.resolve(dir);
  // 归一化 base：去掉两端斜杠后保证「/base/」形式（无 base 时为空串）
  const baseN = base ? '/' + base.replace(/^\/+|\/+$/g, '') + '/' : '/';
  const hasBase = baseN !== '/';
  const misses = [];
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0]);
    // 先剥掉站点基路径前缀，再按 dir 根目录解析（仅当有显式 base 时）。例如
    // base = '/little-racing-v2-test/' 时：
    //   /little-racing-v2-test/          -> '/'         （目录根 → index.html）
    //   /little-racing-v2-test/assets/x  -> '/assets/x'  （正确映射到 dir/assets/x）
    if (hasBase && rel.startsWith(baseN)) {
      rel = rel.slice(baseN.length - 1); // 保留开头斜杠
    } else if (hasBase && rel === baseN.slice(0, -1)) {
      rel = '/'; // 缺尾斜杠的目录根请求
    }
    if (rel === '/' || rel === '') rel = '/index.html';
    if (!path.extname(rel)) rel = rel.replace(/\/$/, '') + '/index.html';
    const file = path.resolve(ROOTDIR, '.' + rel);
    if (!file.startsWith(ROOTDIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      misses.push(rel);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    const stat = fs.statSync(file);
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? Math.min(parseInt(m[2], 10), stat.size - 1) : stat.size - 1;
      res.writeHead(206, {
        'Content-Type': type, 'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': end - start + 1,
      });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': stat.size });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        url: `http://127.0.0.1:${server.address().port}`,
        base: baseN,
        // 浏览器实际打开页面的根地址（含基路径前缀）
        pageUrl: `http://127.0.0.1:${server.address().port}${baseN === '/' ? '' : baseN}`,
        misses,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

/** Edge / Chrome 的可执行文件：环境变量 → 常见安装路径 */
export function findBrowser() {
  const cands = [
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:/Program Files (x86)/Microsoft/EdgeCore/156.0.4314.58/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  throw new Error('找不到 Edge/Chrome：请设置 CHROME_PATH 环境变量');
}

export const CHROME_ARGS = [
  '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
  '--use-gl=angle', '--use-angle=swiftshader', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
];

/** puppeteer-core 装在 .smoke/ 里（开发机的临时环境），按候选路径找 */
export async function loadPuppeteer() {
  const cands = [
    'puppeteer-core',
    path.join(ROOT, 'node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js'),
    path.join(ROOT, '../.smoke/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js'),
  ];
  for (const c of cands) {
    try {
      // Windows 下动态 import 绝对路径必须是 file:// URL，裸路径会报 protocol 'c:'
      const spec = path.isAbsolute(c) ? pathToFileURL(c).href : c;
      return (await import(spec)).default;
    } catch { /* 换下一个 */ }
  }
  throw new Error('找不到 puppeteer-core：请在 little-racing-v2/ 或 .smoke/ 下安装');
}

/* ------------------------------ 断言 ------------------------------ */
export function createReport(title) {
  const items = [];
  return {
    title,
    items,
    check(name, ok, detail = '') {
      items.push({ name, ok: !!ok, detail });
      const mark = ok ? '✓' : '✗';
      console.log(`  ${mark} ${name}${detail ? ` — ${detail}` : ''}`);
      return !!ok;
    },
    near(name, actual, target, tol, unit = '') {
      const ok = Number.isFinite(actual) && Math.abs(actual - target) <= tol;
      return this.check(name, ok, `实测 ${Number.isFinite(actual) ? actual.toFixed(2) : actual}${unit} / 目标 ${target}±${tol}${unit}`);
    },
    get ok() { return items.every((i) => i.ok); },
    get failed() { return items.filter((i) => !i.ok); },
    write(file) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({
        title, ok: this.ok,
        generatedAt: new Date().toISOString(),
        passed: items.filter((i) => i.ok).length,
        failed: items.filter((i) => !i.ok).length,
        items,
      }, null, 2));
    },
  };
}

export function ensureDirs() {
  fs.mkdirSync(SHOTS, { recursive: true });
}

/** 打开一局指定赛道的游戏，等 __sim 就绪。
 *  对导航超时做有限重试：swiftshader 软件渲染在长时运行下偶发卡顿导致导航未提交，
 *  重试通常即可恢复，避免把「环境偶发卡顿」误判为游戏回归失败。 */
export async function openGame(page, baseUrl, { course = 'beach', width = 1280, height = 720 } = {}) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(`${baseUrl}/?course=${course}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
      await page.waitForFunction(() => !!window.__sim && !!window.__game, { timeout: 240000, polling: 300 });
      return page.evaluate(() => window.__sim.trackInfo());
    } catch (e) {
      lastErr = e;
      console.warn(`  ⚠ openGame 导航重试 ${attempt}/3：${e.message}`);
    }
  }
  throw lastErr;
}
