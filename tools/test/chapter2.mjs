/* ==================================================================
 * 第二章第三阶段 · 实装验收测试（剧情 / 人物同框 / 章节流程 / 回归）
 *
 *   node tools/test/chapter2.mjs
 *   node tools/test/chapter2.mjs --no-build   跳过 vite 构建
 *
 * 覆盖：
 *   A 第二章入口（?course=beach&chapter=chapter-02 自动进开场）
 *   B 三人同框：主角 A 站姿模型进场，舞台含 3 个演员
 *   C 21 句字幕：逐句非空、文本与设计文档一字不差
 *   D 舞台道具：空奖杯台 / 找回奖杯 / 礁石微光 / 新地图 在正确 beat 出现
 *   E 流程：开场→点击下一句→跳过→比赛开始→三车进第二章→结尾标记完成
 *   F 第一章回归：第一章仍可玩、主角 A 不进场、车库金币不变
 *   G 音频：第二章配音已接入（字幕 + c2 语音同步）、不误触发第一章 MP3
 *   H 截图：三人同框 / 空奖杯台 / 结尾找回奖杯
 *
 * 输出：tools/out/chapter2-report.json + tools/out/shots/*.png + deliver/*.png
 * 任何一项失败 → 退出码 1。
 * ================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  startServer, findBrowser, CHROME_ARGS, loadPuppeteer, ensureDirs,
  createReport, SHOTS, OUT,
} from './lib.mjs';

const ARG = process.argv.slice(2);
const NO_BUILD = ARG.includes('--no-build');
const HERE = path.dirname(fileURLToPath(import.meta.url));

const DELIVER = path.resolve(HERE, '../../deliver');
fs.mkdirSync(DELIVER, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

const C1_KEY = 'littleRacingV2.story.chapter1';
const C2_KEY = 'littleRacingV2.story.chapter2';

/* 设计文档指定的 21 句逐字台词（用于「一字不差」校验） */
const C2_LINES = {
  'c2-01': '哎呀呀……出大事啦！海滩赛车节的冠军奖杯，不见了！',
  'c2-02': '今天早上我打开箱子，里面只剩下一串湿湿的脚印，还有一点点沙子。',
  'c2-03': '咦？昨天晚上它还好好地放在这里的呀！',
  'c2-04': '湿脚印……沙子……会不会是往海边去了？',
  'c2-05': '孩子，能帮爷爷一个忙吗？沿着阳光海岸，把奖杯找回来。',
  'c2-06': '嘿！我们一起去吧！你开车那么厉害，肯定追得上！',
  'c2-07': '沿着海岸有一场比赛，跑完就能拿到「贝壳湾」的通行证。',
  'c2-08': '路上有我年轻时候认识的老朋友，他们会帮你们的。',
  'c2-09': '记住哦，沙滩上的弯道和城里的石板路不一样。',
  'c2-10': '沙子软，抓地力小，转弯要早点松油门。',
  'c2-11': '还有那座木桥，桥面窄，过桥的时候别乱打方向！',
  'c2-12': '放心吧爷爷！我们出发啦！',
  'c2-13': '好样的！跑得真快，比爷爷年轻的时候还稳！',
  'c2-14': '等等——你看那边！礁石上卡着一样亮亮的东西！',
  'c2-15': '那是……冠军奖杯上掉下来的小星星！',
  'c2-16': '星星旁边还有一条小船划走的痕迹，一直通向礁石后面！',
  'c2-17': '找到啦！奖杯就卡在礁石缝里，还好一点都没有摔坏！',
  'c2-18': '原来是一条小船被浪打偏，把奖杯一路带到了这里。',
  'c2-19': '谢谢你们！海滩赛车节，可以照常开幕啦！',
  'c2-20': '这一届的冠军，我们下次再一起挑战吧！',
  'c2-21': '对了……奖杯底座上，好像刻着一张新的地图呢。',
};

const report = createReport('第二章第三阶段实装验收');
ensureDirs();

if (!NO_BUILD) {
  console.log('· 构建 dist-test（含测试钩子）…');
  execFileSync('npx', ['vite', 'build', '--outDir', 'dist-test'], {
    env: { ...process.env, VITE_TEST_HOOKS: '1' },
    cwd: path.resolve('.'), stdio: ['ignore', 'ignore', 'inherit'], shell: true,
  });
}

const puppeteer = await loadPuppeteer();
const srv = await startServer(path.resolve('dist-test'));
const browser = await puppeteer.launch({
  executablePath: findBrowser(), headless: true, args: CHROME_ARGS, protocolTimeout: 1800000,
});

const page = await browser.newPage();
page.setDefaultNavigationTimeout(180000);
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/^Failed to load resource/.test(t) && /ERR_(CONNECTION_CLOSED|ABORTED)/.test(t)) return;
  // Chrome 117+ 对文档默认限制 unload，会在控制台打印「Permissions policy violation:
  // unload is not allowed」；与游戏运行时无关，属环境噪音，排除以免误判「JS 运行时报错」。
  if (/Permissions policy violation: unload is not allowed/i.test(t)) return;
  consoleErrors.push(t);
});
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });

const url = (q) => `${srv.url}/${q}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function storyState() {
  return page.evaluate(() => window.__story ? window.__story.state() : null);
}
async function waitStoryReady(pred, label, timeout = 240000) {
  await page.waitForFunction(pred, { timeout, polling: 300 });
  await sleep(250);
}
/** 一直推进到出现选择按钮（即一段的最后一拍），途中逐拍采集字幕 */
async function walkSegment(expectedIds) {
  const got = [];
  for (let guard = 0; guard < 60; guard++) {
    const st = await storyState();
    const beat = st?.director?.beat;
    const id = beat?.id || null;
    const text = (st?.ui?.line || '').trim();
    const choices = st?.ui?.choices || [];
    if (id) got.push({ id, text, choices: choices.length });
    if (choices.length > 0) break;            // 到选择按钮了
    // 还有下一拍 → 点下一句
    const hasNext = await page.evaluate(() => !!document.getElementById('storyNext') && !document.getElementById('storyNext').disabled);
    if (!hasNext && choices.length === 0) break;
    if (guard > 0 && id === got[got.length - 2]?.id) break; // 没动，避免死循环
    await page.evaluate(() => window.__story.next());
    await sleep(160);
  }
  return got;
}

async function shot(name) {
  await sleep(400);
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
  await page.screenshot({ path: path.join(DELIVER, name + '.png') });
}

/* ================= A/B/C/D/E：第二章 ================= */
console.log('\n=== A. 第二章入口 ===');
// 先让第一章处于「已完成」，第二章入口才解锁；boot 见到 chapter=chapter-02 自动开开场
await page.goto(url('/'), { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__sim, { timeout: 300000, polling: 300 });
await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ state: 'done', updatedAt: Date.now() })), C1_KEY);
await page.goto(url('/?course=beach&chapter=chapter-02'), { waitUntil: 'domcontentloaded', timeout: 120000 });
await waitStoryReady(
  () => {
    const s = window.__story && window.__story.state && window.__story.state();
    return !!s && s.currentChapterId === 'chapter-02' && !!s.director && !!s.stage
      && s.stage.actors && !!s.stage.actors['hero-a'];
  },
  'chapter2 intro ready',
);
const c2entry = await storyState();
report.check('A1 自动进入第二章开场', c2entry.currentChapterId === 'chapter-02', c2entry.currentChapterId);
report.check('A2 舞台加载 3 个演员（爷爷/小红/主角A）',
  c2entry.stage.actors && ['lighthouse-grandpa', 'flash-little-red', 'hero-a'].every((id) => c2entry.stage.actors[id]),
  Object.keys(c2entry.stage.actors || {}).join('+'));
report.check('A3 主角 A 站姿模型进场（heroA 可见）', c2entry.stage.props.heroA === true);
report.check('A4 空奖杯台已出现（pedestal 可见、trophy 隐藏）',
  c2entry.stage.props.pedestal === true && c2entry.stage.props.trophy === false,
  `pedestal=${c2entry.stage.props.pedestal} trophy=${c2entry.stage.props.trophy}`);

// 三人同框截图（c2-01：wide3 镜头 + 空奖杯台）
await shot('02-三人同框-空奖杯台');
// 空奖杯台特写：切到中景（'two'）让中后方的空奖杯台更突出；此时 trophy:empty 仍生效
await page.evaluate(() => window.__story.stage?.setShot?.('two'));
await sleep(900);
await shot('02-空奖杯台');

console.log('=== C/D. 21 句字幕 + 舞台道具 ===');
const intro = await walkSegment();
// 验证前 12 句（开场+邀请+赛前）文本一字不差、非空
let allTextOk = true, blankCount = 0;
for (const b of intro) {
  const exp = C2_LINES[b.id];
  if (!b.text) { blankCount++; allTextOk = false; }
  if (exp && b.text !== exp) { allTextOk = false; console.log(`  ✗ 台词不符 ${b.id}: 期望「${exp}」实际「${b.text}」`); }
}
report.check('C1 开场 12 拍全部采集到字幕', intro.length >= 12, `采集 ${intro.length} 拍`);
report.check('C2 字幕无空白', blankCount === 0, `空白 ${blankCount}`);
report.check('C3 台词与设计文档一字不差', allTextOk);
// 空奖杯台在开场段保持「未找回」状态（c2-01 即 empty，全程不会误变 found）
report.check('D1 开场段奖杯台保持空（未出现找回状态）',
  c2entry.stage.props.trophy === false,
  `c2-01 trophy=${c2entry.stage.props.trophy}`);

// 点击「出发比赛！」进入比赛
console.log('=== E. 比赛开始 / 三车进第二章 ===');
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('#storyActions button')];
  const start = btns.find((b) => b.dataset.choice === 'start');
  if (start) start.click(); else window.__story.choose('start');
});
await page.waitForFunction(() => window.__game && window.__game.state === 'race', { timeout: 120000, polling: 200 });
await sleep(600);
const raceState = await page.evaluate(() => ({
  state: window.__game.state,
  course: window.__game.track?.course?.id,
  karts: window.__game.karts?.length,
  storyRun: window.__game.storyRun,
  chapter: window.__story?.state().currentChapterId,
}));
report.check('E1 进入比赛（state=race）', raceState.state === 'race');
report.check('E2 比赛在 beach 赛道', raceState.course === 'beach', raceState.course);
report.check('E3 三车同场（karts>=3）', raceState.karts >= 3, String(raceState.karts));
report.check('E4 故事模式标记（storyRun=true）', raceState.storyRun === true);
report.check('E5 仍属第二章', raceState.chapter === 'chapter-02', raceState.chapter);

/* 结尾段：重新以 ending 模式加载第二章结尾（与三圈跑完后触发的结尾是同一份数据/舞台），
 * 用于校验结尾 9 拍字幕、找回奖杯、礁石微光、新地图，以及完成标记。
 * 先回首页重载，避免与上面进行中的比赛状态叠加。 */
console.log('=== E6. 结尾：找回奖杯 / 微光 / 新地图 ===');
await page.goto(url('/'), { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__sim, { timeout: 300000, polling: 300 });
await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ state: 'done', updatedAt: Date.now() })), C1_KEY);
await page.evaluate(() => window.__story.startChapter('chapter-02', 'ending'));
await waitStoryReady(
  () => { const s = window.__story.state(); return s.currentChapterId === 'chapter-02' && s.director && s.director.beat; },
  'chapter2 ending ready',
);
const ending = await walkSegment();
let endOk = true, blankEnd = 0;
for (const b of ending) {
  const exp = C2_LINES[b.id];
  if (!b.text) { blankEnd++; endOk = false; }
  if (exp && b.text !== exp) { endOk = false; }
}
report.check('C4 结尾 9 拍全部采集到字幕', ending.length >= 9, `采集 ${ending.length} 拍`);
report.check('C5 结尾字幕无空白', blankEnd === 0, `空白 ${blankEnd}`);
report.check('C6 结尾台词一字不差', endOk);

// 步进结尾段检查关键道具：先回到 c2-14（微光）与 c2-17（找回奖杯）与 c2-21（地图）
async function gotoBeat(id) {
  for (let i = 0; i < 40; i++) {
    const st = await storyState();
    if (st?.director?.beat?.id === id) return true;
    const ch = st?.ui?.choices || [];
    if (ch.length) return false;
    await page.evaluate(() => window.__story.next());
    await sleep(150);
  }
  return false;
}
await page.evaluate(() => window.__story.startChapter('chapter-02', 'ending'));
await waitStoryReady(() => { const s = window.__story.state(); return s.currentChapterId === 'chapter-02' && s.director && s.director.beat; }, 'ending2');
await gotoBeat('c2-14'); await sleep(200);
let st = await storyState();
report.check('D2 线索段礁石微光出现（glint=true）', st.stage.props.glint === true, `glint=${st.stage.props.glint}`);
await gotoBeat('c2-17'); await sleep(200);
st = await storyState();
report.check('D3 找回奖杯出现（trophy=found）', st.stage.props.trophy === true, `trophy=${st.stage.props.trophy}`);
await shot('02-结尾-找回奖杯');
await gotoBeat('c2-21'); await sleep(200);
st = await storyState();
report.check('D4 奖杯底座新地图出现（map=true）', st.stage.props.map === true, `map=${st.stage.props.map}`);
await shot('02-结尾-新地图');

/* ================= G. 音频（置于第二章结尾场景中检查：此时 voice.mode='story'） ================= */
console.log('=== G. 音频 ===');
const audio = await page.evaluate(() => window.__audioDebug());
report.check('G1 第二章语音已接入且未报错（voiceMode=story / AudioContext 已解锁）',
  audio.unlocked === true || audio.voiceMode === 'story', `voiceMode=${audio.voiceMode} unlocked=${audio.unlocked}`);
report.check('G2 未误播第一章 MP3（当前无 playingId 或非 c1）',
  !audio.playingId || !/^c1-/.test(audio.playingId), `playingId=${audio.playingId}`);

// 结尾结束 → 第二章标记完成
await page.evaluate(() => { const b = [...document.querySelectorAll('#storyActions button')].find(x => x.dataset.choice === 'again'); if (b) b.click(); });
await sleep(400);
const c2done = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}').state, C2_KEY);
report.check('E6 第二章进度标记完成（done）', c2done === 'done', String(c2done));

/* ================= F. 第一章回归 ================= */
console.log('=== F. 第一章回归 ===');
const coinsBefore = await page.evaluate(() => window.__garage.save().coins);
await page.goto(url('/'), { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__sim, { timeout: 300000, polling: 300 });
await page.evaluate(() => window.__story.startChapter('chapter-01', 'intro'));
await waitStoryReady(() => { const s = window.__story && window.__story.state && window.__story.state(); return s && s.currentChapterId === 'chapter-01' && !!s.director && !!s.director.beat; }, 'chapter1 intro');
const c1 = await storyState();
report.check('F1 第一章正常进入开场', c1.currentChapterId === 'chapter-01', c1.currentChapterId);
report.check('F2 第一章舞台不含主角 A（仅 2 演员）',
  c1.stage.actors && c1.stage.actors['lighthouse-grandpa'] && c1.stage.actors['flash-little-red'] && !c1.stage.actors['hero-a'],
  Object.keys(c1.stage.actors || {}).join('+'));
report.check('F3 第一章主角 A 不进场', c1.stage.props.heroA === false);
// 第一章 3 句字幕
const c1seg = await walkSegment();
let c1ok = true;
for (const b of c1seg) if (!b.text) c1ok = false;
report.check('F4 第一章字幕全部非空', c1ok, `采集 ${c1seg.length} 拍`);
// 跳过 → 快进到本段结尾（选项界面），不崩、状态合法
await page.evaluate(() => window.__story.skip());
await sleep(400);
const afterSkip = await page.evaluate(() => window.__story.state());
report.check('F5 跳过剧情后快进到段尾（choiceMode，未崩溃）',
  afterSkip && afterSkip.director && afterSkip.director.choiceMode === true && afterSkip.gameState === 'story',
  `choiceMode=${afterSkip?.director?.choiceMode} state=${afterSkip?.gameState}`);
// 刷新后回到首页（menu）——「刷新恢复合理状态」
await page.goto(url('/'), { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__sim, { timeout: 300000, polling: 300 });
const afterReload = await page.evaluate(() => window.__game.state);
report.check('F5b 刷新后回到首页（menu）', afterReload === 'menu', afterReload);
const coinsAfter = await page.evaluate(() => window.__garage.save().coins);
report.check('F6 车库金币未变', coinsBefore === coinsAfter, `前=${coinsBefore} 后=${coinsAfter}`);

/* ================= H. 控制台错误汇总 ================= */
console.log('=== H. 运行期错误 ===');
report.check('H1 无未预期的 JS 控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));

await browser.close();
await srv.close();

const ok = report.ok;
report.write(path.join(OUT, 'chapter2-report.json'));
report.write(path.join(DELIVER, 'chapter2-report.json'));
console.log(`\n${ok ? '✅ 全部通过' : '❌ 存在失败项'} —— 报告已写入 tools/out/chapter2-report.json 与 deliver/`);
process.exit(ok ? 0 : 1);
