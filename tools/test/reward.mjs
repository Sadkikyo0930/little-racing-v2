/* ==================================================================
 * 第二章第四阶段 · 金币奖励 / 成就 / 存档安全 验收测试
 *
 *   node tools/test/reward.mjs
 *   node tools/test/reward.mjs --no-build   跳过 vite 构建
 *
 * 覆盖（对应需求「新增奖励专项测试」≥10 项）：
 *   S1   首次通关（完成比赛 + 有效结尾）发放 500 金币 + 阳光沙滩冠军成就
 *   S2   重复结算不重复发放
 *   S3   重播结尾（未真正完成比赛）不发放 —— 防改参数 / 跳结尾白嫖
 *   S4   重新进入第二章（重玩）不重复发放
 *   S5   刷新游戏不重复发放（持久化）
 *   S6   存档写入失败：不显示成功、不留下可重复领取漏洞（含部分失败场景）
 *   S7   旧存档迁移 + 导入导出（含重复导入不漏发）
 *   S8   导入导出健壮性（非法 JSON / 过高版本 / 不损坏原存档）
 *   S9   切换车辆后重玩不重复发放
 *   S10  第一章 / 普通比赛隔离（不触发第二章奖励）
 *   S11  第一章剧情与音频回归（字幕非空、无 c2 误触发）
 *   S12  桌面 844×390 效果（无报错、金币显示）
 *
 * 输出：tools/out/reward-report.json + tools/out/shots/*.png + deliver/*.png
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

if (!NO_BUILD) {
  console.log('· 构建 dist-test（含测试钩子）…');
  execFileSync('npx', ['vite', 'build', '--outDir', 'dist-test'], {
    env: { ...process.env, VITE_TEST_HOOKS: '1' },
    cwd: path.resolve('.'), stdio: ['ignore', 'ignore', 'inherit'], shell: true,
  });
}

const report = createReport('第二章第四阶段 · 金币奖励 / 成就 / 存档安全 验收');
ensureDirs();

const puppeteer = await loadPuppeteer();
const srv = await startServer(path.resolve('dist-test'));
const browser = await puppeteer.launch({
  executablePath: findBrowser(), headless: true, args: CHROME_ARGS, protocolTimeout: 1800000,
});

const page = await browser.newPage();
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 导航到游戏首页并等待 boot 完成（window.__garage / window.__sim / window.__story 就绪）。
 *  对导航超时做有限重试：swiftshader 软件渲染在长时运行下偶发单帧卡死导致导航未提交，
 *  重试通常即可恢复，避免把「环境偶发卡顿」误判为游戏回归失败。 */
async function boot() {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(`${srv.url}/`, { waitUntil: 'domcontentloaded', timeout: 180000 });
      await page.waitForFunction(
        () => !!window.__garage && !!window.__sim && !!window.__story,
        { timeout: 300000, polling: 300 });
      return;
    } catch (e) {
      lastErr = e;
      console.warn(`  ⚠ boot 导航重试 ${attempt}/3：${e.message}`);
    }
  }
  throw lastErr;
}

async function fresh() {
  await boot();
  await page.evaluate(() => {
    window.__garage.resetGarage();
    window.__story.resetProgress();
    window.__story.resetProgress2();
    window.__game._storyRaceFinished = false;
  });
}
async function state() {
  return page.evaluate(() => ({
    coins: window.__garage.save().coins,
    claimed: window.__garage.chapter2FirstClearState().claimed,
    ach: window.__garage.getAchievements().map((a) => ({ id: a.id, unlocked: a.unlocked })),
    ch1: window.__story.progress().state,
    ch2: window.__story.progress2().state,
    turtle: !!window.__garage.save().owned.turtle,
  }));
}
async function completeChapter2() {
  await page.evaluate(async () => {
    window.__game._storyRaceFinished = true;
    await window.__story.startChapter('chapter-02', 'ending');
  });
}
async function shot(name) {
  await sleep(400);
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
  // 同时存一份到 deliver/ 作为交付物
  try { fs.copyFileSync(path.join(SHOTS, name + '.png'), path.join(DELIVER, name + '.png')); } catch { /* noop */ }
}

/* ================================================================== *
 * S1. 首次通关
 * ================================================================== */
console.log('\n=== S1. 首次通关 ===');
await fresh();
const s1Before = (await state()).coins;
await completeChapter2();
await sleep(150);
const s1 = await state();
report.check('S1.1 首次通关发放 +500 金币', s1.coins === s1Before + 500, `前=${s1Before} 后=${s1.coins}`);
report.check('S1.2 标记为已领取（持久化依据）', s1.claimed === true);
report.check('S1.3 「阳光沙滩冠军」成就解锁', s1.ach.some((a) => a.id === 'beach-champion' && a.unlocked));
report.check('S1.4 第二章进度 = done', s1.ch2 === 'done');
report.check('S1.5 奖励不影响原有车辆所有权', s1.turtle === false);

/* 截图：车库金币实际页面（500） */
await page.evaluate(() => window.__garage.open());
await sleep(300);
await shot('reward-500-coins-garage');
/* 截图：阳光沙滩冠军成就墙 */
await page.evaluate(() => document.querySelector('#garageAchBtn')?.click());
await sleep(300);
await shot('reward-achievement-beach-champion');
await page.evaluate(() => window.__garage.close());

/* ================================================================== *
 * S2. 重复结算
 * ================================================================== */
console.log('\n=== S2. 重复结算 ===');
{
  const before = (await state()).coins;
  await completeChapter2();
  await sleep(120);
  const after = (await state()).coins;
  report.check('S2 重复结算不重复发放', after === before && before === 500, `coins=${after}`);
}

/* ================================================================== *
 * S3. 重播结尾（未真正完成比赛）—— 防改参数 / 跳结尾白嫖
 * ================================================================== */
console.log('\n=== S3. 重播结尾（无比赛完成）===');
await fresh();
{
  const before = (await state()).coins;
  await page.evaluate(async () => {
    window.__game._storyRaceFinished = false;   // 没跑完比赛
    await window.__story.startChapter('chapter-02', 'ending');
  });
  await sleep(120);
  const s = await state();
  report.check('S3.1 直接跳结尾不发放金币', s.coins === before, `coins=${s.coins}`);
  report.check('S3.2 直接跳结尾不标记已领取', s.claimed === false);
}

/* ================================================================== *
 * S4. 重新进入第二章（重玩）
 * ================================================================== */
console.log('\n=== S4. 重新进入第二章（重玩）===');
{
  await fresh();
  await completeChapter2();            // 首次完成 → 发 500
  await sleep(120);
  const base = (await state()).coins;  // 500
  await page.evaluate(() => window.__story.resetProgress2());   // 进度回到未开始，但奖励已领取
  await completeChapter2();            // 重玩 → 不应再发
  await sleep(120);
  const s = await state();
  report.check('S4.1 重玩不重复发放', s.coins === base && base === 500, `coins=${s.coins}`);
  report.check('S4.2 重玩后进度仍为 done', s.ch2 === 'done');
  /* 截图证据：重玩后车库金币仍为 500（不是 1000） */
  await page.evaluate(() => window.__garage.open());
  await sleep(300);
  await shot('reward-replay-no-dup');
  await page.evaluate(() => window.__garage.close());
}

/* ================================================================== *
 * S5. 刷新游戏
 * ================================================================== */
console.log('\n=== S5. 刷新游戏 ===');
{
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => !!window.__sim, { timeout: 300000, polling: 300 });
  const after = await state();
  report.check('S5.1 刷新后金币持久（500）', after.coins === 500, `coins=${after.coins}`);
  report.check('S5.2 刷新后已领取持久', after.claimed === true);
  const before = after.coins;
  await completeChapter2();
  await sleep(120);
  const after2 = (await state()).coins;
  report.check('S5.3 刷新后重放结尾不重复发放', after2 === before, `coins=${after2}`);
}

/* ================================================================== *
 * S6. 存档写入失败 + 可恢复事务（上线前修复重点）
 * ================================================================== */
console.log('\n=== S6. 存档写入失败 ===');
await fresh();
{
  const before = (await state()).coins;
  // 6a：全部写入失败 → grant 返回失败、不加金币
  await page.evaluate(() => window.__garage.forceWriteFail(true));
  const r = await page.evaluate(() => window.__garage.grantChapter2FirstClear());
  await page.evaluate(() => window.__garage.forceWriteFail(false));
  report.check('S6.1 写入失败返回 granted:false', r.granted === false && r.reason === 'persist-failed', JSON.stringify(r));
  report.check('S6.2 写入失败时不加金币', before === 0, `coins before=${before}`);

  // 6b：修复后重新完成 → 能正常发一次（说明之前没被错误标记）
  await completeChapter2();
  await sleep(120);
  const s = await state();
  report.check('S6.3 失败后重新完成可正常发放一次', s.coins === 500 && s.claimed === true, `coins=${s.coins}`);
}

/* 6c：事务（WAL）写成功、但金币键写失败 —— 当前不发，刷新后自动补偿 500。
 * 关键：玩家不会被记为「已领取却没拿到金币」，也不会重复领取。 */
console.log('\n=== S6c. 部分失败：事务成功 / 金币键损坏 ===');
await fresh();
{
  const base = (await state()).coins;   // 0
  await page.evaluate(() => window.__garage.forceFailKeys(['lrv2.garage.coins']));
  const r = await page.evaluate(() => window.__garage.grantChapter2FirstClear());
  await page.evaluate(() => window.__garage.forceFailKeys(null));
  report.check('S6c.1 金币键失败时返回 partial（事务留在 pending）',
    r.granted === false && r.partial === true && r.step === 'coins', JSON.stringify(r));
  const l1 = await page.evaluate(() => window.__garage.rewardLedger());
  report.check('S6c.2 账本状态为 pending（未假装成功）', l1.status === 'pending', JSON.stringify(l1));
  report.check('S6c.3 当前金币未增加', (await state()).coins === base, `coins=${(await state()).coins}`);

  // 刷新：boot 自动 recover → 金币补偿 500，成就补发，状态 completed
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => !!window.__sim, { timeout: 300000, polling: 300 });
  const s = await state();
  report.check('S6c.4 刷新后自动补偿 +500 金币', s.coins === base + 500, `coins=${s.coins}`);
  report.check('S6c.5 刷新后已领取持久', s.claimed === true, `claimed=${s.claimed}`);
  report.check('S6c.6 刷新后成就解锁', s.ach.some((a) => a.id === 'beach-champion' && a.unlocked));
  const l2 = await page.evaluate(() => window.__garage.rewardLedger());
  report.check('S6c.7 账本已 completed', l2.status === 'completed', JSON.stringify(l2));
  await page.evaluate(() => window.__garage.open());
  await sleep(300);
  await shot('reward-recovery-coins-500');
  await page.evaluate(() => window.__garage.close());

  await completeChapter2();
  await sleep(120);
  report.check('S6c.8 补偿后重复结算不重复发放', (await state()).coins === base + 500, `coins=${(await state()).coins}`);
}

/* 6d：金币成功、成就键写失败 → 金币已入账，刷新后只补成就、金币不重复。 */
console.log('\n=== S6d. 部分失败：金币成功 / 成就键损坏 ===');
await fresh();
{
  const base = (await state()).coins;
  await page.evaluate(() => window.__garage.forceFailKeys(['lrv2.garage.achievements']));
  const r = await page.evaluate(() => window.__garage.grantChapter2FirstClear());
  await page.evaluate(() => window.__garage.forceFailKeys(null));
  report.check('S6d.1 成就键失败时返回 partial（step=achievement）',
    r.granted === false && r.partial === true && r.step === 'achievement', JSON.stringify(r));
  const s0 = await state();
  report.check('S6d.2 金币已入账（+500）', s0.coins === base + 500, `coins=${s0.coins}`);

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => !!window.__sim, { timeout: 300000, polling: 300 });
  const s = await state();
  report.check('S6d.3 刷新后金币仍为 500（不重复发）', s.coins === base + 500, `coins=${s.coins}`);
  report.check('S6d.4 刷新后成就已补发', s.ach.some((a) => a.id === 'beach-champion' && a.unlocked));
  report.check('S6d.5 刷新后已领取', s.claimed === true, `claimed=${s.claimed}`);
}

/* 6e：重复运行恢复程序仍只发一次（多次手动 recover 幂等）。 */
console.log('\n=== S6e. 恢复程序幂等 ===');
await fresh();
{
  await page.evaluate(() => window.__garage.forceFailKeys(['lrv2.garage.coins']));
  await page.evaluate(() => window.__garage.grantChapter2FirstClear());
  await page.evaluate(() => window.__garage.forceFailKeys(null));
  const c0 = (await state()).coins;
  await page.evaluate(() => window.__garage.recoverRewards());
  await page.evaluate(() => window.__garage.recoverRewards());
  await page.evaluate(() => window.__garage.recoverRewards());
  const c1 = (await state()).coins;
  report.check('S6e.1 多次 recover 只补发一次（金币=500）', c1 === c0 + 500 && c0 === 0, `c0=${c0} c1=${c1}`);
}

/* 6f：旧存档（firstClear.granted 但没有 ledger）→ 迁移为 completed，不多领。 */
console.log('\n=== S6f. 旧存档迁移（firstClear.granted 无 ledger）===');
await fresh();
{
  const oldSave = JSON.stringify({
    app: 'little-racing-v2', kind: 'garage-save', version: 4,
    coins: 300, tx: [], owned: {}, current: 'red',
    story: { chapter2: { firstClear: {
      rewardId: 'chapter2.first_clear', granted: true, at: 1700000000000,
      coins: 500, achievementId: 'beach-champion', achievementName: '阳光沙滩冠军' } } },
    study: {}, claims: [], achievements: { 'beach-champion': { id: 'beach-champion', name: '阳光沙滩冠军', at: 1700000000000 } },
    chapter1: { state: 'done' }, chapter2: { state: 'done' },
  });
  const r = await page.evaluate((t) => window.__garage.importText(t, 'replace'), oldSave);
  const s = await state();
  report.check('S6f.1 旧存档导入成功', r.ok === true, JSON.stringify(r));
  report.check('S6f.2 旧存档金币未被重复 +500（=300）', s.coins === 300, `coins=${s.coins}`);
  report.check('S6f.3 旧存档已领取（firstClear.granted 回退判定）', s.claimed === true, `claimed=${s.claimed}`);
  // 刷新：启动时会把旧 firstClear.granted 迁移成 completed 账本
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => !!window.__sim, { timeout: 300000, polling: 300 });
  const s2 = await state();
  report.check('S6f.4 迁移后金币仍为 300（不多领）', s2.coins === 300, `coins=${s2.coins}`);
  const l2 = await page.evaluate(() => window.__garage.rewardLedger());
  report.check('S6f.5 账本已迁移为 completed', l2.status === 'completed', JSON.stringify(l2));
  await completeChapter2();
  await sleep(120);
  report.check('S6f.6 旧玩家重玩不再多领', (await state()).coins === 300, `coins=${(await state()).coins}`);
}

/* 6g：导入带 pending 账本的存档 → 回收补一次；同一份反复导入不重领。 */
console.log('\n=== S6g. 导入 pending 账本 + 重复导入 ===');
await fresh();
{
  // 先正常领一次，导出（completed），再把账本改回 pending 模拟“上次写到一半”
  await completeChapter2();
  await sleep(120);
  const exp = await page.evaluate(() => window.__garage.exportText());
  const patched = JSON.parse(exp);
  patched.coins = 0;
  // 原子设计下，「金币没到账」必然意味着 rewardId 标记也没落盘（同一次 setItem）。
  // 这里把导出里自带的 coinRewards 一并清空，才是真实「写到一半」的状态，
  // 否则恢复时会因为标记还在而误判已发放、导致 S6g.1 不发钱。
  patched.coinRewards = [];
  patched.rewardLedger['chapter2.first_clear'].status = 'pending';
  patched.rewardLedger['chapter2.first_clear'].applied = { coin: false, achievement: false };
  const patchedText = JSON.stringify(patched);

  await fresh();
  const r1 = await page.evaluate((t) => window.__garage.importText(t, 'replace'), patchedText);
  const s1 = await state();
  report.check('S6g.1 导入 pending 账本后自动回收补发 500', r1.ok && s1.coins === 500, `coins=${s1.coins}`);
  report.check('S6g.2 回收后账本 completed',
    (await page.evaluate(() => window.__garage.rewardLedger())).status === 'completed');

  // 同一份 pending 存档再导入到另一份全新存档：仍只补发 500，不叠加成 1000
  await fresh();
  await page.evaluate((t) => window.__garage.importText(t, 'replace'), patchedText);
  report.check('S6g.3 同一份 pending 存档重复导入仍只发 500', (await state()).coins === 500, `coins=${(await state()).coins}`);

  // 已 completed 的导出反复导入也不重领
  await fresh();
  await completeChapter2();
  await sleep(120);
  const done = await page.evaluate(() => window.__garage.exportText());
  await fresh();
  await page.evaluate((t) => window.__garage.importText(t, 'replace'), done);
  const cA = (await state()).coins;
  await page.evaluate((t) => window.__garage.importText(t, 'replace'), done);
  report.check('S6g.4 已领取存档重复导入不重领（仍 500）', cA === 500 && (await state()).coins === 500, `a=${cA} b=${(await state()).coins}`);
}

/* ================================================================== *
 * A–F. 中断恢复专项（原子 coin+rewardId 设计下的重复发放防护）
 *
 *   核心保证：金币余额与「已发放 rewardId 标记」写在同一条 localStorage
 *   记录里、通过同一次 setItem 落盘。因此「金币写了、标记没写」的中间态从
 *   根上不存在；恢复时只认持久化的 coinRewardIds，绝不重复发。
 *
 *   A  金币+标记写入后立即中断 → 重载只补完、余额只 +500
 *   B  成就已写、ledger 未完成前中断 → 恢复金币不重复
 *   C  ledger 完成写入反复失败 → 多次恢复余额始终 500
 *   D  多次刷新 / 多次恢复 → 余额始终只 +500
 *   E  旧存档（已领取）迁移 → 不重复领取
 *   F  导入 pending 存档 → 恢复只发一次
 * ================================================================== */
const _RID = 'chapter2.first_clear';
const _COINS = 'lrv2.garage.coins';
const _ACH = 'lrv2.garage.achievements';
const _LEDGER = 'lrv2.garage.reward-ledger';

/** 直接在已加载页面的 localStorage 上构造一条「写到一半」的存档，然后由调用方 reload 触发恢复。 */
async function writeHalfSave({ coins, marker, achievement, ledgerPending }) {
  await page.evaluate(({ coins, marker, achievement, ledgerPending, RID, COINS, ACH, LEDGER }) => {
    const now = Date.now();
    localStorage.setItem(COINS, JSON.stringify({ coins, updatedAt: now, appliedRewards: marker ? [RID] : [] }));
    localStorage.setItem(ACH, JSON.stringify(achievement ? { 'beach-champion': { id: 'beach-champion', name: '阳光沙滩冠军', at: now } } : {}));
    localStorage.setItem(LEDGER, JSON.stringify({
      [RID]: {
        rewardId: RID, txId: 't_' + now, status: ledgerPending ? 'pending' : 'completed',
        coinDelta: 500, achievementId: 'beach-champion',
        applied: { coin: false, achievement: false }, at: now, completedAt: 0,
      },
    }));
  }, { coins, marker, achievement, ledgerPending, RID: _RID, COINS: _COINS, ACH: _ACH, LEDGER: _LEDGER });
}

console.log('\n=== A. 金币+标记写入后立即中断 → 重载只补完、余额只 +500 ===');
await fresh();
await writeHalfSave({ coins: 500, marker: true, achievement: false, ledgerPending: true });
await boot();                 // reload 触发 migrateRewards + recoverRewardTransactions
await sleep(150);
{
  const s = await state();
  report.check('A.1 中断后恢复：金币恰好 500（未重复发放）', s.coins === 500, `coins=${s.coins}`);
  report.check('A.2 中断后恢复：奖励标记已持久化（claimed=true）', s.claimed === true, `claimed=${s.claimed}`);
  const achUnlocked = s.ach.some((a) => a.id === 'beach-champion' && a.unlocked);
  report.check('A.3 中断后恢复：成就已补发', achUnlocked === true, JSON.stringify(s.ach));
  // 再正常完成一次比赛（重玩），确认不会叠加成 1000
  await completeChapter2();
  await sleep(150);
  const s2 = await state();
  report.check('A.4 恢复后再完成比赛：金币仍 500（不重复）', s2.coins === 500, `coins=${s2.coins}`);
}

console.log('\n=== B. 成就已写、ledger 未完成前中断 → 恢复金币不重复 ===');
await fresh();
await writeHalfSave({ coins: 500, marker: true, achievement: true, ledgerPending: true });
await boot();
await sleep(150);
{
  const s = await state();
  // 关键点：成就写入在前、ledger 完成在后，即便如此金币也只认原子标记，绝不能变 1000
  report.check('B.1 成就已写+ledger pending：金币仍 500（不重复发）', s.coins === 500, `coins=${s.coins}`);
  report.check('B.2 成就已写+ledger pending：ledger 被补成 completed',
    (await page.evaluate(() => window.__garage.rewardLedger())).status === 'completed');
  report.check('B.3 成就保持解锁', s.ach.some((a) => a.id === 'beach-champion' && a.unlocked), JSON.stringify(s.ach));
}

console.log('\n=== C. ledger 完成写入反复失败 → 多次恢复余额始终 500 ===');
await fresh();
await writeHalfSave({ coins: 500, marker: true, achievement: false, ledgerPending: true });
await boot();
await sleep(150);
{
  const s1 = await state();
  report.check('C.1 首次恢复：金币 500', s1.coins === 500, `coins=${s1.coins}`);
  // 模拟「ledger 完成写每次都失败」：把 ledger 手动打回 pending
  await page.evaluate((LEDGER, RID) => {
    const l = JSON.parse(localStorage.getItem(LEDGER));
    l[RID].status = 'pending';
    l[RID].applied = { coin: false, achievement: false };
    localStorage.setItem(LEDGER, JSON.stringify(l));
  }, _LEDGER, _RID);
  await boot();   // 再恢复一次
  await sleep(150);
  const s2 = await state();
  report.check('C.2 第二次恢复（ledger 仍 pending）：金币仍 500，不重复', s2.coins === 500, `coins=${s2.coins}`);
  await boot();   // 第三次恢复
  await sleep(150);
  const s3 = await state();
  report.check('C.3 第三次恢复：金币仍 500', s3.coins === 500, `coins=${s3.coins}`);
}

console.log('\n=== D. 多次刷新 / 多次恢复 → 余额始终只 +500 ===');
await fresh();
await completeChapter2();
await sleep(150);
{
  const s0 = await state();
  report.check('D.0 首次通关发放 +500', s0.coins === 500, `coins=${s0.coins}`);
  for (let i = 1; i <= 4; i++) {
    await boot();
    await sleep(120);
    const s = await state();
    report.check(`D.${i} 第 ${i} 次刷新恢复：余额仍为 500`, s.coins === 500, `coins=${s.coins}`);
  }
  // 重玩一次第二章，确认不会叠加
  await completeChapter2();
  await sleep(150);
  const sEnd = await state();
  report.check('D.5 多次恢复后再重玩：余额仍 500', sEnd.coins === 500, `coins=${sEnd.coins}`);
}

console.log('\n=== E. 旧存档（已领取）迁移 → 不重复领取 ===');
await fresh();
{
  const oldSave = JSON.stringify({
    app: 'little-racing-v2', kind: 'garage-save', version: 4,
    coins: 800,             // 800 已经包含上一版本发过的 +500
    tx: [], owned: {}, current: 'red',
    story: { chapter2: { firstClear: { rewardId: 'chapter2.first_clear', granted: true, at: Date.now(), coins: 500, achievementId: 'ch2_first_clear', achievementName: '阳光沙滩冠军' } } },
    study: {}, claims: [], achievements: {},
    chapter1: { state: 'done' }, chapter2: { state: 'done' },
  });
  const r = await page.evaluate((t) => window.__garage.importText(t, 'replace'), oldSave);
  const s1 = await state();
  report.check('E.1 导入已领取旧存档：迁移不额外发钱（仍 800）', r.ok && s1.coins === 800, `ok=${r.ok} coins=${s1.coins}`);
  report.check('E.2 导入已领取旧存档：标记 claimed', s1.claimed === true, `claimed=${s1.claimed}`);
  await boot();             // reload → 再次 migrateRewards
  await sleep(150);
  const s2 = await state();
  report.check('E.3 迁移后 reload：金币仍 800（不重复）', s2.coins === 800, `coins=${s2.coins}`);
  await completeChapter2(); // 重玩第二章
  await sleep(150);
  const s3 = await state();
  report.check('E.4 重玩第二章：金币仍 800（不重复领）', s3.coins === 800, `coins=${s3.coins}`);
}

console.log('\n=== F. 导入 pending 存档 → 恢复只发一次 ===');
await fresh();
{
  const pendingSave = JSON.stringify({
    app: 'little-racing-v2', kind: 'garage-save', version: 4,
    coins: 0, coinRewards: [], tx: [], owned: {}, current: 'red',
    story: {}, study: {}, claims: [], achievements: {},
    rewardLedger: { 'chapter2.first_clear': { rewardId: 'chapter2.first_clear', txId: 'tp', status: 'pending', coinDelta: 500, achievementId: 'beach-champion', applied: { coin: false, achievement: false }, at: Date.now(), completedAt: 0 } },
    chapter1: { state: 'idle' }, chapter2: { state: 'idle' },
  });
  const r1 = await page.evaluate((t) => window.__garage.importText(t, 'replace'), pendingSave);
  const s1 = await state();
  report.check('F.1 导入 pending 存档自动回收补发 500', r1.ok && s1.coins === 500, `ok=${r1.ok} coins=${s1.coins}`);
  // 同一份 pending 存档导入到「另一份全新存档」：仍只补发一次（不叠加成 1000）
  await fresh();
  await page.evaluate((t) => window.__garage.importText(t, 'replace'), pendingSave);
  const s2 = await state();
  report.check('F.2 同一份 pending 存档重复导入（全新目标）仍只 500', s2.coins === 500, `coins=${s2.coins}`);
  await boot();             // reload 后再确认
  await sleep(150);
  const s3 = await state();
  report.check('F.3 reload 后余额仍 500（不重复）', s3.coins === 500, `coins=${s3.coins}`);
}

/* ================================================================== *
 * 问题一 / 问题二 专项（第三轮小范围修复）
 *
 * 问题一：导入旧存档（firstClear.granted、无账本）后，若不刷新页面立即重玩
 *         第二章，会因「账本还没迁移」而重复领取（800 → 1300）。修复：importSave
 *         内部立即 migrateRewards()，把旧奖励迁移成 completed 账本 + 原子标记。
 *   P1.A  导入旧已领取存档：金币=800、不额外发钱
 *   P1.B  导入后不刷新，立即重玩第二章：金币仍 800（不重复）
 *   P1.C  金币未变成 1300
 *   P1.D  奖励状态已领取、账本 completed（无需刷新即迁移）
 *   P1.E  刷新后金币仍 800
 *
 * 问题二：导入存档的 rewardLedger 内容严格校验，拒绝伪造金额 / 未知 ID / 错误成就 /
 *         非法状态，正常 pending 仍能恢复、正常 completed 不重复、原有数据不丢。
 *   P2.a  伪造 coinDelta=999999 → 拒绝
 *   P2.b  未知 rewardId → 拒绝
 *   P2.c  错误 achievementId → 拒绝
 *   P2.d  非法 status → 拒绝
 *   P2.e  正常 pending 存档 → 正确恢复 500
 *   P2.f  正常 completed 存档 → 不重复发钱
 *   P2.g  原有金币 / 车辆所有权 / 第一章进度不丢失
 * ================================================================== */
function buildImportSave(extra) {
  return JSON.stringify(Object.assign({
    app: 'little-racing-v2', kind: 'garage-save', version: 4,
    coins: 1234, tx: [], owned: { turtle: { at: 1, source: 'story-chapter1' }, moto: { at: 2, source: 'purchase' } },
    current: 'red',
    story: { chapter1: { granted: true } }, study: {}, claims: [],
    achievements: { 'beach-champion': { id: 'beach-champion', name: '阳光沙滩冠军', at: 1 } },
    coinRewards: [], rewardLedger: {},
    chapter1: { state: 'done' }, chapter2: { state: 'idle' },
  }, extra));
}

console.log('\n=== 问题一：导入旧存档后不刷新立即重玩（防重复领取）===');
await fresh();
{
  const oldSave = buildImportSave({
    coins: 800, owned: {}, story: { chapter2: { firstClear: {
      rewardId: 'chapter2.first_clear', granted: true, at: Date.now(), coins: 500,
      achievementId: 'beach-champion', achievementName: '阳光沙滩冠军' } } },
    achievements: {}, chapter1: { state: 'idle' },
  });
  const r = await page.evaluate((t) => window.__garage.importText(t, 'replace'), oldSave);
  const s1 = await state();
  report.check('P1.A 导入旧的已领取存档：成功且金币=800（不多领）', r.ok && s1.coins === 800, `ok=${r.ok} coins=${s1.coins}`);
  // B/C：不刷新（同一页会话），立即重新完成第二章（直接走游戏发奖入口 grantChapter2FirstClear）
  await page.evaluate(() => window.__garage.grantChapter2FirstClear());
  const s2 = await state();
  report.check('P1.B 导入后不刷新立即重玩：金币仍 800（不重复发）', s2.coins === 800, `coins=${s2.coins}`);
  report.check('P1.C 金币未变成 1300', s2.coins === 800 && s2.coins !== 1300, `coins=${s2.coins}`);
  report.check('P1.D 奖励状态为已领取', s2.claimed === true, `claimed=${s2.claimed}`);
  const l = await page.evaluate(() => window.__garage.rewardLedger());
  report.check('P1.D2 导入后账本立即迁移为 completed（无需刷新）', l.status === 'completed', JSON.stringify(l));
  // E：刷新后再次检查
  await boot();
  await sleep(150);
  const s3 = await state();
  report.check('P1.E 刷新后金币仍为 800（不重复领取）', s3.coins === 800, `coins=${s3.coins}`);
}

console.log('\n=== 问题二：导入奖励账本严格校验 ===');
await fresh();
{
  // P2.a 伪造金额
  const a = buildImportSave({ rewardLedger: { 'chapter2.first_clear': {
    rewardId: 'chapter2.first_clear', txId: 'x', status: 'completed', coinDelta: 999999,
    achievementId: 'beach-champion', applied: { coin: true, achievement: true }, at: Date.now(), completedAt: Date.now() } } });
  const ra = await page.evaluate((t) => window.__garage.importText(t, 'replace'), a);
  report.check('P2.a 拒绝伪造 coinDelta=999999 的奖励账本', ra.ok === false && ra.reason === 'invalid-coin-delta', JSON.stringify(ra));
  await boot(); await sleep(120);
  report.check('P2.a2 拒绝后原存档未被污染（金币仍为 0）', (await state()).coins === 0, `coins=${(await state()).coins}`);

  // P2.b 未知 rewardId
  const b = buildImportSave({ rewardLedger: { 'chapter9.foo': {
    rewardId: 'chapter9.foo', txId: 'x', status: 'pending', coinDelta: 500,
    achievementId: 'beach-champion', applied: { coin: false, achievement: false }, at: Date.now(), completedAt: 0 } } });
  const rb = await page.evaluate((t) => window.__garage.importText(t, 'replace'), b);
  report.check('P2.b 拒绝未知 rewardId', rb.ok === false && rb.reason === 'unknown-reward-id', JSON.stringify(rb));

  // P2.c 错误 achievementId
  const c = buildImportSave({ rewardLedger: { 'chapter2.first_clear': {
    rewardId: 'chapter2.first_clear', txId: 'x', status: 'pending', coinDelta: 500,
    achievementId: 'wrong-ach', applied: { coin: false, achievement: false }, at: Date.now(), completedAt: 0 } } });
  const rc = await page.evaluate((t) => window.__garage.importText(t, 'replace'), c);
  report.check('P2.c 拒绝错误 achievementId', rc.ok === false && rc.reason === 'invalid-achievement-id', JSON.stringify(rc));

  // P2.d 非法 status
  const d2 = buildImportSave({ rewardLedger: { 'chapter2.first_clear': {
    rewardId: 'chapter2.first_clear', txId: 'x', status: 'half', coinDelta: 500,
    achievementId: 'beach-champion', applied: { coin: false, achievement: false }, at: Date.now(), completedAt: 0 } } });
  const rd = await page.evaluate((t) => window.__garage.importText(t, 'replace'), d2);
  report.check('P2.d 拒绝非法 status', rd.ok === false && rd.reason === 'invalid-ledger-status', JSON.stringify(rd));

  // P2.e 正常 pending → 正确恢复 500
  await fresh();
  const e = buildImportSave({ coins: 0, owned: {}, achievements: {},
    rewardLedger: { 'chapter2.first_clear': {
      rewardId: 'chapter2.first_clear', txId: 'p', status: 'pending', coinDelta: 500,
      achievementId: 'beach-champion', applied: { coin: false, achievement: false }, at: Date.now(), completedAt: 0 } } });
  const re = await page.evaluate((t) => window.__garage.importText(t, 'replace'), e);
  const se = await state();
  report.check('P2.e 正常 pending 存档导入后自动恢复 500', re.ok && se.coins === 500, `ok=${re.ok} coins=${se.coins}`);

  // P2.f 正常 completed → 不重复发钱（重玩也不多领）
  await fresh();
  const f = buildImportSave({ coins: 500, coinRewards: ['chapter2.first_clear'],
    rewardLedger: { 'chapter2.first_clear': {
      rewardId: 'chapter2.first_clear', txId: 'c', status: 'completed', coinDelta: 500,
      achievementId: 'beach-champion', applied: { coin: true, achievement: true }, at: Date.now(), completedAt: Date.now() } } });
  const rf = await page.evaluate((t) => window.__garage.importText(t, 'replace'), f);
  const sf = await state();
  report.check('P2.f 正常 completed 存档导入：金币=500 且不重复', rf.ok && sf.coins === 500, `ok=${rf.ok} coins=${sf.coins}`);
  await page.evaluate(() => window.__garage.grantChapter2FirstClear());
  const sf2 = await state();
  report.check('P2.f2 completed 存档重玩：金币仍 500（不重复）', sf2.coins === 500, `coins=${sf2.coins}`);

  // P2.g 原有金币 / 车辆所有权 / 第一章进度不丢失
  await fresh();
  const base = buildImportSave({});   // coins=1234, owned turtle+moto, ch1 done
  const rg = await page.evaluate((t) => window.__garage.importText(t, 'replace'), base);
  const sg = await page.evaluate(() => window.__garage.save());
  const prog = await page.evaluate(() => window.__story.progress().state);
  report.check('P2.g 导入成功', rg.ok === true, JSON.stringify(rg));
  report.check('P2.g2 原有金币保留（1234）', sg.coins === 1234, `coins=${sg.coins}`);
  report.check('P2.g3 车辆所有权保留（turtle+moto）', !!sg.owned.turtle && !!sg.owned.moto, JSON.stringify(sg.owned));
  report.check('P2.g4 第一章进度保留（done）', prog === 'done', `ch1=${prog}`);
}

/* ================================================================== *
 * S7. 旧存档迁移 + 导入导出
 * ================================================================== */
console.log('\n=== S7. 旧存档迁移 + 导入导出 ===');
await fresh();
{
  // 7a：构造一份「第三阶段旧存档」（chapter2 已是 done，但没有 firstClear 记录）
  const oldSave = JSON.stringify({
    app: 'little-racing-v2', kind: 'garage-save', version: 4,
    coins: 800, tx: [], owned: {}, current: 'red',
    story: {}, study: {}, claims: [], achievements: {},
    chapter1: { state: 'done' }, chapter2: { state: 'done' },
  });
  const r = await page.evaluate((t) => window.__garage.importText(t, 'replace'), oldSave);
  const s = await state();
  report.check('S7.1 导入旧存档成功', r.ok === true, JSON.stringify(r));
  report.check('S7.2 导入旧存档：金币 / 双章进度正确', s.coins === 800 && s.ch1 === 'done' && s.ch2 === 'done', JSON.stringify(s));
  report.check('S7.3 导入旧存档未自发发奖励', s.claimed === false && s.coins === 800, `coins=${s.coins}`);
  // 旧存档玩家完成第二章 → 应发 500（之前从未拿到）
  await completeChapter2();
  await sleep(120);
  const s2 = await state();
  report.check('S7.4 旧存档玩家完成第二章发 +500', s2.coins === 1300 && s2.claimed === true, `coins=${s2.coins}`);
  /* 截图证据：旧存档迁移后车库金币 1300 */
  await page.evaluate(() => window.__garage.open());
  await sleep(300);
  await shot('reward-migration-old-save');
  await page.evaluate(() => window.__garage.close());

  // 7b：导出「已领取」存档 → 重置 → 导入 → claim 保留、重玩不重发
  const exp = await page.evaluate(() => window.__garage.exportText());
  await fresh();
  const imported = await page.evaluate((t) => {
    window.__garage.importText(t, 'replace');
    return window.__garage.save().coins;
  }, exp);
  const s3 = await state();
  report.check('S7.5 导入已领取存档：claim 状态保留', s3.claimed === true, JSON.stringify(s3));
  await completeChapter2();
  await sleep(120);
  const s4 = (await state()).coins;
  report.check('S7.6 导入已领取存档后重玩不重复发', s4 === imported, `imported=${imported} after=${s4}`);

  // 7c：同一份存档重复导入不漏发
  await fresh();
  const c1 = await page.evaluate((t) => { window.__garage.importText(t, 'replace'); return window.__garage.save().coins; }, exp);
  const c2 = await page.evaluate((t) => { window.__garage.importText(t, 'replace'); return window.__garage.save().coins; }, exp);
  const s5 = await state();
  report.check('S7.7 同一份存档重复导入不重复发金币', c1 === c2, `c1=${c1} c2=${c2}`);
  report.check('S7.8 重复导入后 claim 仍在', s5.claimed === true);
}

/* ================================================================== *
 * S8. 导入导出健壮性
 * ================================================================== */
console.log('\n=== S8. 导入导出健壮性 ===');
await fresh();
{
  const before = (await state()).coins;
  const bad = await page.evaluate(() => window.__garage.importText('这不是 JSON', 'replace'));
  const afterBad = (await state()).coins;
  report.check('S8.1 非法 JSON 导入失败且不损坏原存档', bad.ok === false && afterBad === before, `r=${JSON.stringify(bad)} coins=${afterBad}`);

  const tooNew = JSON.stringify({
    app: 'little-racing-v2', kind: 'garage-save', version: 9999,
    coins: 1, tx: [], owned: {}, current: 'red', story: {}, study: {}, claims: [], achievements: {},
    chapter1: null, chapter2: null,
  });
  const r2 = await page.evaluate((t) => window.__garage.importText(t, 'replace'), tooNew);
  report.check('S8.2 拒绝过高版本存档', r2.ok === false && r2.reason === 'too-new', JSON.stringify(r2));

  // 备份失败必须明确提示并允许取消（不覆盖）
  await page.evaluate(() => window.__garage.forceWriteFail(true));
  const r3 = await page.evaluate(() => window.__garage.importText(window.__garage.exportText(), 'replace'));
  await page.evaluate(() => window.__garage.forceWriteFail(false));
  report.check('S8.3 备份失败时不覆盖（canForce 提示）', r3.ok === false && r3.canForce === true, JSON.stringify(r3));
}

/* ================================================================== *
 * S9. 切换车辆
 * ================================================================== */
console.log('\n=== S9. 切换车辆 ===');
await fresh();
{
  await page.evaluate(() => { window.__garage.grantVehicle('turtle'); window.__garage.grantVehicle('moto'); });
  await completeChapter2();
  await sleep(120);
  const c1 = (await state()).coins;   // 500
  await page.evaluate(() => window.__garage.equip('turtle'));
  await completeChapter2();
  await sleep(120);
  const c2 = (await state()).coins;
  report.check('S9 切换车辆后重玩不重复发放', c2 === c1 && c1 === 500, `c1=${c1} c2=${c2}`);
}

/* ================================================================== *
 * S10. 第一章 / 普通比赛隔离
 * ================================================================== */
console.log('\n=== S10. 第一章 / 普通比赛隔离 ===');
await fresh();
{
  // 完成第一章（不走比赛，直接结尾）→ 解海龟车，绝不应触发第二章奖励
  await page.evaluate(async () => { await window.__story.startChapter('chapter-01', 'ending'); });
  await sleep(120);
  const s = await state();
  report.check('S10.1 第一章完成：海龟车解锁', s.turtle === true);
  report.check('S10.2 第一章完成不触发第二章奖励', s.claimed === false, JSON.stringify(s));

  // 普通比赛名次奖励（独立 id，去重），不应触发第二章奖励
  const race = await page.evaluate(() => window.__garage.claim({ raceId: 'r_iso_test_1', rank: 1, finished: true, note: 'iso' }));
  const s2 = await state();
  report.check('S10.3 普通比赛发名次奖励', race.granted === true && s2.coins === 120, `race=${JSON.stringify(race)} coins=${s2.coins}`);
  report.check('S10.4 普通比赛不触发第二章奖励', s2.claimed === false);

  // 即便之后「完成第二章」也只发一次（此时 claimed 仍 false → 发 +500，总计 620）
  await completeChapter2();
  await sleep(120);
  const s3 = await state();
  report.check('S10.5 隔离后首次完成第二章正常发 +500', s3.coins === 620 && s3.claimed === true, `coins=${s3.coins}`);
}

/* ================================================================== *
 * S11. 第一章剧情与音频回归
 * ================================================================== */
console.log('\n=== S11. 第一章剧情与音频回归 ===');
await fresh();
{
  await page.evaluate(async () => { await window.__story.startChapter('chapter-01', 'intro'); });
  await sleep(120);
  const lines = await page.evaluate(async () => {
    const out = [];
    for (let i = 0; i < 3; i++) {
      const st = window.__story.state();
      out.push({ id: st.director.beat?.id, text: st.ui.line });
      window.__story.next();
      await new Promise((r) => setTimeout(r, 30));
    }
    return out;
  });
  report.check('S11.1 第一章字幕非空', lines.length > 0 && lines.every((l) => l.text && l.text.length > 0),
    JSON.stringify(lines.map((l) => l.text)));
  const audio = await page.evaluate(() => window.__audioDebug());
  report.check('S11.2 第一章音频为字幕模式（无 c2 误触发）',
    audio.voiceMode === 'menu' || audio.voiceMode === 'story', `mode=${audio.voiceMode}`);
  report.check('S11.3 无 c2 配音被播放', !audio.playingId || !/^c2-/.test(audio.playingId), `playingId=${audio.playingId}`);
}

/* ================================================================== *
 * S12. 桌面 844×390 效果
 * ================================================================== */
console.log('\n=== S12. 桌面 844×390 ===');
{
  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 1 });
  let navOk = false;
  for (let attempt = 1; attempt <= 3 && !navOk; attempt++) {
    try {
      await page.goto(`${srv.url}/`, { waitUntil: 'domcontentloaded', timeout: 180000 });
      navOk = true;
    } catch (e) { console.warn(`  ⚠ S12 导航重试 ${attempt}/3：${e.message}`); }
  }
  await page.waitForFunction(() => !!window.__sim, { timeout: 300000, polling: 300 });
  await sleep(400);
  await shot('reward-844x390');
  const ok = await page.evaluate(() => !!document.querySelector('#garageCoinsNum') || !!document.getElementById('hud'));
  report.check('S12 844×390 正常加载（无致命错误）', ok && consoleErrors.length === 0,
    `errors=${consoleErrors.length}`);
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
}

/* ================================================================== *
 * 收尾
 * ================================================================== */
report.check('Z1 全程无 JS 运行时报错', consoleErrors.length === 0,
  consoleErrors.slice(0, 3).map((e) => e.slice(0, 120)).join(' | '));

await browser.close();
await srv.close();

report.write(path.join(OUT, 'reward-report.json'));
const passed = report.items.filter((i) => i.ok).length;
console.log(`\n============================`);
console.log(`通过 ${passed} / ${report.items.length}`);
if (!report.ok) {
  console.log('失败项：');
  for (const f of report.failed) console.log(`  ✗ ${f.name} — ${f.detail}`);
}
console.log(`报告：${path.join(OUT, 'reward-report.json')}`);
console.log(`截图目录：${SHOTS}`);
process.exit(report.ok ? 0 : 1);
