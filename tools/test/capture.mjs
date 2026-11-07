/* ==================================================================
 * 交付物采集脚本（模型加载记录 + 九段海滨视觉前后对比）
 *   node tools/test/capture.mjs
 *
 * 产出：
 *   deliver/model-load-record.json      主角 A + 2 NPC 模型加载记录
 *   deliver/09-before-<i>.png           海滨环境「优化前」（stage2 基线）
 *   deliver/09-after-<i>.png            海滨环境「优化后」（当前构建，含 Part A）
 *   tools/out/shots/ 同步一份
 *
 * 注：stage2 基线 = deliver/little-racing-v2-pages-stage2.zip（已解压到
 * tools/out/_stage2pages）。当前构建 = dist/。两者渲染同一套赛道几何，
 * 差异只来自 Part A 的三处轻量优化（海浪 / 礁石 / 道路两侧布景），
 * 因此同机位同采样点的截图可直接对比。
 * ================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startServer, findBrowser, CHROME_ARGS, loadPuppeteer, ensureDirs, SHOTS, OUT,
} from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const DELIVER = path.join(ROOT, 'deliver');
const OLD = path.join(OUT, '_stage2pages');
fs.mkdirSync(DELIVER, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });
ensureDirs();

const C1_KEY = 'littleRacingV2.story.chapter1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const puppeteer = await loadPuppeteer();

/* ---------------- 模型加载记录（当前构建，chapter2 / chapter1） ---------------- */
console.log('· 模型加载记录 …');
const srvNow = await startServer(path.join(ROOT, 'dist'));
const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true, args: CHROME_ARGS, protocolTimeout: 600000 });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });

async function openChapter(chapter, course = 'beach') {
  await page.goto(`${srvNow.url}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => !!window.__sim, { timeout: 300000, polling: 300 });
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ state: 'done', updatedAt: Date.now() })), C1_KEY);
  // 直接走 startChapter（与验收测试一致，稳定），不依赖 bootEntry 自动进场
  await page.evaluate((ch) => window.__story.startChapter(ch, 'intro'), chapter);
  await page.waitForFunction(
    (ch) => { const s = window.__story && window.__story.state && window.__story.state(); return s && s.currentChapterId === ch && s.stage && s.stage.actors && !!s.stage.actors[(ch === 'chapter-02' ? 'hero-a' : 'lighthouse-grandpa')]; },
    { timeout: 120000, polling: 300 }, chapter);
  await sleep(800);
  return page.evaluate(() => {
    const s = window.__story.state();
    return {
      chapter: s.currentChapterId,
      stageLoaded: s.stage.loaded,
      stageLoadError: s.stage.loadError,
      actorIds: Object.keys(s.stage.actors || {}),
      heroAVisible: !!(s.stage.actors && s.stage.actors['hero-a'] && s.stage.props.heroA),
      props: s.stage.props,
    };
  });
}

const recCh2 = await openChapter('chapter-02');
const recCh1 = await openChapter('chapter-01');

const modelRecord = {
  generatedAt: new Date().toISOString(),
  note: '主角 A 复用既有站姿模型 hero-a-standing.glb，未重新生成新脸；NPC 为灯塔爷爷与闪电小红。',
  heroAGlbBytes: fs.statSync(path.join(ROOT, 'src/assets/hero/hero-a-standing.glb')).size,
  heroADrivingGlbBytes: fs.statSync(path.join(ROOT, 'src/assets/hero/hero-a-driving.glb')).size,
  chapter2: {
    actors: recCh2.actorIds,
    stageLoaded: recCh2.stageLoaded,
    stageLoadError: recCh2.stageLoadError,
    heroALoadedAndVisible: recCh2.heroAVisible,
    props: recCh2.props,
  },
  chapter1: {
    actors: recCh1.actorIds,
    stageLoaded: recCh1.stageLoaded,
    stageLoadError: recCh1.stageLoadError,
    heroAPresent: recCh1.actorIds.includes('hero-a'),
    props: recCh1.props,
  },
};
fs.writeFileSync(path.join(DELIVER, 'model-load-record.json'), JSON.stringify(modelRecord, null, 2));
fs.writeFileSync(path.join(OUT, 'model-load-record.json'), JSON.stringify(modelRecord, null, 2));
console.log('  chapter2 actors:', recCh2.actorIds.join('+'), '| heroA visible:', recCh2.heroAVisible, '| loadError:', recCh2.stageLoadError);
console.log('  chapter1 actors:', recCh1.actorIds.join('+'), '| heroA present:', recCh1.actorIds.includes('hero-a'));

/* ---------------- 海滨视觉前后对比（same 采样点，before/after） ---------------- */
console.log('· 海滨视觉前后对比截图 …');
const FRACS = [0.12, 0.27, 0.45, 0.62, 0.85]; // 沿 1057.5m 海滨赛道取 5 个机位

async function shoot(server, tag, fracs) {
  const p = await browser.newPage();
  await p.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await p.goto(`${server.url}/?course=beach`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction(() => !!window.__sim, { timeout: 300000, polling: 300 });
  await p.evaluate(async () => {
    try { await window.__garage.grantVehicle('turtle'); } catch {}
    try { await window.__garage.grantVehicle('moto'); } catch {}
    await window.__sim.start({ vehicle: 'red' });
  });
  await sleep(1200);
  const info = await p.evaluate(() => window.__sim.trackInfo());
  for (let i = 0; i < fracs.length; i++) {
    const idx = Math.round(fracs[i] * info.samples) % info.samples;
    await p.evaluate((ix) => { window.__sim.place(0, ix, 0); window.__sim.step(1 / 60, 24); }, idx);
    await sleep(700);
    const name = `09-${tag}-${i + 1}`;
    await p.screenshot({ path: path.join(SHOTS, name + '.png') });
    await p.screenshot({ path: path.join(DELIVER, name + '.png') });
  }
  await p.close();
}

const srvOld = await startServer(OLD);
await shoot(srvOld, 'before', FRACS);   // stage2 基线（Part A 优化前）
await shoot(srvNow, 'after', FRACS);    // 当前构建（Part A 优化后）

await browser.close();
await srvNow.close();
await srvOld.close();
console.log('✅ 采集完成：model-load-record.json + 09-before/after-*.png');
