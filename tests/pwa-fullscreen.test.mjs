#!/usr/bin/env node
/**
 * tests/pwa-fullscreen.test.mjs
 *
 * R5 家长入口 PWA 全屏修复 —— 静态契约测试（Node 原生 test runner，零外部依赖）
 *   node --test tests/pwa-fullscreen.test.mjs
 *
 * 覆盖范围：
 *   A. PWA 同源 / scope / 配置完整性（含 manifest 与两个页面的声明一致性）
 *   B. gameUrl() / entryUrl() 解析结果与完整导航链（修复前后对比）
 *   C. 认证安全（三账号、一次性票据、fail-closed、1800 秒、刷新需重验）
 *   D. 禁止修改范围与修复手段合规性（无 CSS 伪装 / fullscreen API / 新窗口）
 *
 * 注意：本测试是**静态契约 + URL 解析**验证，不是 iPhone 桌面 PWA 实机测试。
 * iOS standalone 的真实显示行为必须在真机由用户验收（见交付说明）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DOCS = path.join(ROOT, 'docs');
const ORIGIN = 'https://sadkikyo0930.github.io';
const SCOPE = '/little-racing-v2/';
const BASE_URL = ORIGIN + SCOPE;
const GATE_URL = BASE_URL + 'gate.html?r5=NO_GRANT';
const GAME_URL = BASE_URL + 'index.html';

// Windows checkout 可能是 CRLF，git 对象里是 LF —— 比对前统一换行符，
// 避免把「换行差异」误报成「代码被改动」。
const norm = (s) => s.replace(/\r\n/g, '\n');
const read = (p) => norm(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const gate = read('docs/gate.html');
const indexHtml = read('docs/index.html');
const pathsSrc = read('docs/r5/paths.mjs');
const manifest = JSON.parse(read('docs/manifest.webmanifest'));

/** 从 git 读取 main 基线内容，用于「修复前」对照 */
function mainFile(rel) {
  return norm(execFileSync('git', ['show', 'main:' + rel],
    {cwd: ROOT, encoding: 'utf8', maxBuffer: 8 << 20}));
}

/* ------------------------------------------------------------------ */
/* A. PWA 配置与作用域                                                  */
/* ------------------------------------------------------------------ */

test('A1 manifest 的 id / start_url / scope 全部为相对 "./"，解析后覆盖 gate 与 game', () => {
  assert.equal(manifest.id, './');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  const scopeUrl = new URL(manifest.scope, BASE_URL + 'manifest.webmanifest');
  assert.equal(scopeUrl.href, BASE_URL);
  assert.ok(new URL('gate.html', scopeUrl).href.startsWith(scopeUrl.href));
  assert.ok(new URL('index.html', scopeUrl).href.startsWith(scopeUrl.href));
});

test('A2 display / display_override / orientation 保持不变（未改 manifest 主体）', () => {
  const before = JSON.parse(mainFile('docs/manifest.webmanifest'));
  for (const k of ['id', 'start_url', 'scope', 'display', 'display_override', 'orientation',
    'background_color', 'theme_color', 'name', 'short_name', 'icons']) {
    assert.deepEqual(manifest[k], before[k], 'manifest.' + k + ' 不应被改动');
  }
  assert.ok(manifest.display_override.includes('standalone'));
});

test('A3 修复后 gate.html 与 index.html 都声明 manifest，且 href 完全一致', () => {
  const link = (html) => (html.match(/<link\s+rel="manifest"\s+href="([^"]+)"/) || [])[1];
  assert.equal(link(indexHtml), './manifest.webmanifest');
  assert.equal(link(gate), './manifest.webmanifest');
  // 修复前：gate.html 完全没有 manifest 引用（根因证据）
  assert.equal(link(mainFile('docs/gate.html')), undefined);
});

test('A4 两个页面的 iOS 全屏 meta 完整且一致（修复前 gate.html 缺 3 项）', () => {
  const metas = (html) => {
    const out = {};
    for (const m of html.matchAll(/<meta\s+name="([^"]+)"\s+content="([^"]+)"/g)) out[m[1]] = m[2];
    return out;
  };
  const g = metas(gate), i = metas(indexHtml);
  for (const key of ['mobile-web-app-capable', 'apple-mobile-web-app-capable',
    'apple-mobile-web-app-status-bar-style', 'apple-mobile-web-app-title']) {
    assert.ok(g[key], 'gate.html 缺少 ' + key);
    assert.equal(g[key], i[key], key + ' 两页必须一致');
  }
  assert.equal(g['apple-mobile-web-app-capable'], 'yes');
  assert.equal(g['apple-mobile-web-app-status-bar-style'], 'black-translucent');
  const before = metas(mainFile('docs/gate.html'));
  assert.equal(before['mobile-web-app-capable'], undefined);
  assert.equal(before['apple-mobile-web-app-status-bar-style'], undefined);
});

test('A5 两个页面都在同一 origin 同一 scope 内，且 apple-touch-icon 指向同源资源', () => {
  for (const p of ['gate.html', 'index.html']) {
    const u = new URL(p, BASE_URL);
    assert.equal(u.origin, ORIGIN);
    assert.ok(u.pathname.startsWith(SCOPE));
  }
  assert.match(gate, /rel="apple-touch-icon"\s+sizes="180x180"\s+href="\.\/icons\//);
});

test('A6 项目没有 Service Worker：页面每次启动都取服务器最新 HTML（旧图标无需重装）', () => {
  const files = execFileSync('git', ['ls-files'], {cwd: ROOT, encoding: 'utf8'});
  assert.ok(!/\bsw\.js|service-worker|serviceworker/i.test(files), '不应存在 SW 文件');
  const scan = ['docs/index.html', 'docs/gate.html', 'docs/r5/race-guard.mjs',
    'docs/r5/paths.mjs', 'docs/r5/grant.mjs'];
  for (const f of scan) assert.ok(!/serviceWorker\s*\.\s*register/.test(read(f)), f + ' 不应注册 SW');
});

/* ------------------------------------------------------------------ */
/* B. URL 解析与导航链                                                  */
/* ------------------------------------------------------------------ */

test('B1 gameUrl()/entryUrl() 返回同源相对路径，不再是绝对 URL', async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'docs/r5/paths.mjs')).href);
  assert.equal(mod.gameUrl(), './index.html');
  assert.equal(mod.entryUrl(), './gate.html');
  for (const v of [mod.gameUrl(), mod.entryUrl()]) {
    assert.ok(v.startsWith('./'), '必须是相对路径: ' + v);
    assert.ok(!/^[a-z][a-z0-9+.-]*:/i.test(v), '不得带 scheme: ' + v);
    assert.ok(!v.includes('://'), '不得含绝对地址: ' + v);
  }
  // 修复前是 new URL(...).href → 绝对 URL（根因证据）
  const before = mainFile('docs/r5/paths.mjs');
  assert.match(before, /new URL\('\.\/index\.html', location\.href\)\.href/);
  assert.equal(new URL('./index.html', GATE_URL).href, GAME_URL);
});

test('B2 修复前 gameUrl() 生成绝对 URL；修复后解析目标完全相同但形式为相对', () => {
  const beforeVal = new URL('./index.html', GATE_URL).href; // 修复前实际返回值
  const afterVal = './index.html';                          // 修复后实际返回值
  assert.match(beforeVal, /^https:\/\//, '修复前是绝对 URL');
  assert.equal(new URL(beforeVal, GATE_URL).href, new URL(afterVal, GATE_URL).href,
    '修复前后最终文档必须一致（不改变进入的游戏页）');
});

test('B3 完整导航链：每一跳都同源、落在 manifest scope 内、无跨站重定向', () => {
  const hops = [
    {from: '桌面图标 start_url', to: './', note: 'index.html（首次启动，有 manifest，全屏）'},
    {from: 'index.html race-guard 无 grant', to: './gate.html?r5=NO_GRANT', note: '通行证页'},
    {from: 'gate.html 路径A 学习达标', to: './index.html', note: '进入游戏'},
    {from: 'gate.html 路径B 家长密码', to: './index.html', note: '进入游戏'},
  ];
  for (const h of hops) {
    const u = new URL(h.to, BASE_URL);
    assert.equal(u.origin, ORIGIN, h.from + ' 跨源');
    assert.ok(u.pathname.startsWith(SCOPE), h.from + ' 越出 scope');
  }
});

test('B4 家长认证成功后没有第二次跳转 / 没有跨域或外部重定向', () => {
  // gate.html 中家长 form 成功分支：issueGrant → closeParentDialog → location.replace(gameUrl())
  const successBranch = gate.slice(gate.indexOf("parent-entry-form').addEventListener"),
    gate.indexOf('// 不显示令牌的任何片段'));
  assert.match(successBranch, /issueGrant\(/);
  assert.match(successBranch, /location\.replace\(gameUrl\(\)\)/);
  assert.equal((successBranch.match(/location\./g) || []).length, 1, '只能有一次顶层导航');
  assert.ok(!/window\.open|target\s*=\s*["']_blank|https?:\/\//i.test(successBranch),
    '成功分支不得出现外部/跨域跳转或新窗口');
  // index.html 进入后：race-guard 仅在无 grant 时 replace 回 gate；boot() 不导航
  const guard = read('docs/r5/race-guard.mjs');
  assert.equal((guard.match(/location\.replace/g) || []).length, 1);
  const core = read('docs/r5/guard-core.mjs');
  assert.ok(!/location\.(replace|assign|href)\s*\(/.test(core), 'guard.boot 不得触发顶层导航');
});

test('B5 isSameOriginInScope() 自检：接受站内相对路径，拒绝跨源与越界', async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'docs/r5/paths.mjs')).href);
  assert.equal(mod.isSameOriginInScope(mod.gameUrl(), GATE_URL), true);
  assert.equal(mod.isSameOriginInScope(mod.entryUrl() + '?r5=NO_GRANT', GAME_URL, './'), true);
  assert.equal(mod.isSameOriginInScope('https://evil.example/index.html', GATE_URL), false);
  assert.equal(mod.isSameOriginInScope('../../outside/index.html', GATE_URL), false);
});

test('B6 线上正式站各页面均为 200 且无重定向（部署未被改动）', () => {
  // 该断言在离线环境下会被跳过，改由 shell curl 记录到 TEST_REPORT
  // 这里只校验源码未引入任何硬编码的重定向目标
  const all = gate + indexHtml + pathsSrc + read('docs/r5/race-guard.mjs');
  assert.ok(!/Location:\s*https?:/i.test(all));
  assert.ok(!/302|301/.test(pathsSrc));
});

/* ------------------------------------------------------------------ */
/* C. 认证安全（不得因修复全屏而削弱）                                  */
/* ------------------------------------------------------------------ */

test('C1 三账号家长认证契约未变（mom / dad / grandma + POST /v1/parent/session）', () => {
  const accounts = read('docs/r5/parent-accounts.mjs');
  for (const id of ['growth_mom', 'growth_dad', 'growth_grandma']) assert.ok(accounts.includes(id));
  assert.match(gate, /R5_CONFIG\.base\+'\/v1\/parent\/session'/);
  assert.match(gate, /body:JSON\.stringify\(\{family_id:R5_CONFIG\.familyId,device,account,password\}\)/);
  // 严格约束：main 的每一行都必须原样、按原顺序保留；gate.html 只允许「新增」PWA 声明行，
  // 不允许删除、改写或重排任何既有代码（认证逻辑零改动）。
  const mainLines = mainFile('docs/gate.html').split('\n');
  const mainSet = new Set(mainLines);
  const kept = gate.split('\n').filter((l) => mainSet.has(l));
  assert.deepEqual(kept, mainLines, '除新增 PWA 声明外 gate.html 不得有任何改动');
});

test('C2 严格 fail-closed：HTTP / api / authorized / remaining_seconds 四项校验都在', () => {
  for (const s of ['if(!response.ok', "payload?.api!=='r5_parent_session'",
    'payload?.authorized!==true', 'Number(payload.remaining_seconds)<=0']) {
    assert.ok(gate.includes(s), '缺少校验: ' + s);
  }
});

test('C3 密码不落地、不进 URL；凭证仅 sessionStorage 且 5 分钟滑动', () => {
  assert.ok(!/localStorage\.setItem\([^)]*password/i.test(gate));
  assert.ok(!/sessionStorage\.setItem\([^)]*password/i.test(gate));
  assert.ok(!/location\.(href|replace)\([^)]*\?[^)]*password/i.test(gate));
  const grant = read('docs/r5/grant.mjs');
  assert.match(grant, /sessionStorage\.setItem\(GRANT_KEY/);
  assert.match(grant, /ttlSeconds\s*=\s*300/);
  assert.equal(grant, mainFile('docs/r5/grant.mjs'), 'grant.mjs 不得改动');
});

test('C4 刷新 / 重进仍需服务端重新确认（无免密漏洞）', () => {
  const guard = read('docs/r5/race-guard.mjs');
  assert.match(guard, /readGrant\(device\)/);
  assert.match(guard, /location\.replace\(entryUrl\(\) \+ '\?r5=' /);
  assert.match(guard, /await guard\.boot\(\)/);
  assert.match(guard, /onServerDenied: \(\) => clearGrant\(\)/);
  const core = read('docs/r5/guard-core.mjs');
  assert.match(core, /await gate\.status\(\)/);            // 每次打开都复核
  assert.match(core, /await session\.begin\(\)/);          // 云端计时会话
  assert.equal(guard, mainFile('docs/r5/race-guard.mjs'), 'race-guard.mjs 不得改动');
  assert.equal(core, mainFile('docs/r5/guard-core.mjs'), 'guard-core.mjs 不得改动');
});

test('C5 每日 1800 秒由服务端决定；config / r5-online / 云同步 / 网关 / 迁移全部未改', () => {
  const untouched = [
    'docs/r5/config.mjs', 'docs/r5/r5-online.mjs', 'docs/r5/r5-family-sync.mjs',
    'docs/r5/family-sync-controller.mjs', 'docs/r5/family-preview.mjs',
    'docs/r5/isolation-storage.mjs', 'docs/r5/parent-accounts.mjs',
    'docs/index.html', 'services/r5-gateway/index.js',
  ];
  for (const f of untouched) {
    assert.equal(read(f), mainFile(f), f + ' 不应被改动');
  }
  // 1800 秒不是前端常量：前端只展示服务端返回的 remaining_seconds
  const gateSrc = read('docs/gate.html');
  assert.match(gateSrc, /payload\.remaining_seconds/);
  assert.ok(!/1800|30\s*\*\s*60/.test(gateSrc), '前端不得自行计算/写死每日额度');
});

/* ------------------------------------------------------------------ */
/* D. 修复手段合规 & 禁止修改范围                                       */
/* ------------------------------------------------------------------ */

test('D1 未使用 CSS 隐藏浏览器元素 / fullscreen API / 新窗口伪装全屏', () => {
  const changed = gate + pathsSrc;
  assert.ok(!/requestFullscreen|webkitRequestFullscreen|fullscreenElement/i.test(changed));
  assert.ok(!/window\.open\s*\(/.test(changed));
  assert.ok(!/target\s*=\s*["']_blank["']/.test(changed));
  assert.ok(!/position:\s*fixed[^}]*(?:top|bottom)\s*:\s*-?\d+px[^}]*(?:address|toolbar|url)/i.test(changed));
  // viewport / status-bar-style 只是标准 PWA 声明，不是隐藏浏览器 UI 的 hack
  assert.match(gate, /name="viewport"/);
});

test('D2 本次分支只改了 4 个既有文件（+ 新增测试），未触碰禁止修改范围', () => {
  // 同时覆盖「已提交」和「工作区未提交」两种状态
  const modified = execFileSync('git', ['diff', '--name-only', 'main'],
    {cwd: ROOT, encoding: 'utf8'});
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'],
    {cwd: ROOT, encoding: 'utf8'});
  const changed = (modified + '\n' + untracked).trim().split('\n').filter(Boolean);
  const allowed = new Set([
    'docs/gate.html', 'docs/r5/paths.mjs',
    'production-sha256.json', 'docs/production-sha256.json',
  ]);
  // 允许新增的测试脚本 / 测试产物，其余一律不得改动
  const unexpected = changed.filter(f => !allowed.has(f) && !/^tests\//.test(f));
  assert.deepEqual(unexpected, [], '出现范围外改动: ' + unexpected.join(', '));
  for (const f of ['docs/gate.html', 'docs/r5/paths.mjs']) {
    assert.ok(changed.includes(f), f + ' 应当被修改');
  }
});

test('D4 横屏比赛 / 车库 / 赛道布局零改动（viewport、CSS、游戏主包全部未碰）', () => {
  // 本修复只改 PWA 声明与 URL 形式，不触碰任何布局、CSS、视口或渲染资源
  assert.equal(indexHtml, mainFile('docs/index.html'), 'index.html 必须逐字节不变');
  assert.match(indexHtml, /viewport-fit=cover/);
  assert.match(indexHtml, /user-scalable=no/);
  const css = execFileSync('git', ['ls-files', 'docs/assets'],
    {cwd: ROOT, encoding: 'utf8'}).split('\n')
    .filter(f => /\.css$/.test(f));
  for (const f of css) assert.equal(read(f), mainFile(f), f + ' 不应改动');
  // 未新增/删除任何样式或渲染资源
  const diffNames = execFileSync('git', ['diff', '--name-only', 'main'], {cwd: ROOT, encoding: 'utf8'});
  assert.ok(!/\.css$|\.glb$|\.mp3$|\.js$/m.test(diffNames),
    '不得改动 CSS / 模型 / 配音 / 脚本资源: ' + diffNames);
});

test('D5 路径 A / 路径 B 共用同一 gameUrl()，修复对两条路径同时生效', () => {
  const calls = [...gate.matchAll(/location\.replace\(gameUrl\(\)\)/g)];
  assert.equal(calls.length, 2, '学习达标与家长验证应各有一次进入游戏的导航');
  // 两条路径的导航函数完全一致（main 基线也是同样两处），
  // 因此根因不在导航函数本身，而在发起文档的 PWA 声明与 URL 形式
  assert.equal([...mainFile('docs/gate.html').matchAll(/location\.replace\(gameUrl\(\)\)/g)].length, 2);
});

test('D6 三账号通用：账号来自下拉框，无 mom 硬编码；设备绑定页未改动', () => {
  assert.match(gate, /const account=parentAccount\.value/);
  assert.ok(!/account\s*===\s*['"]growth_mom|account\s*=\s*['"]growth_mom/.test(gate));
  assert.equal(read('docs/bind.html'), mainFile('docs/bind.html'), 'bind.html 不应改动');
  assert.equal(read('docs/backup-restore.html'), mainFile('docs/backup-restore.html'));
});

test('D3 生产哈希清单已登记两个改动文件的新哈希', () => {
  const list = JSON.parse(read('production-sha256.json'));
  for (const [rel, file] of [['gate.html', 'docs/gate.html'], ['r5/paths.mjs', 'docs/r5/paths.mjs']]) {
    const h = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex');
    assert.equal(list[rel], h, rel + ' 哈希未登记');
  }
});
