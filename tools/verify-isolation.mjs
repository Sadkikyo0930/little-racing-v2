/**
 * verify-isolation.mjs —— 存档隔离验证（对应需求 1 / E）
 *
 * 证明：
 *   1) 存档键前缀真正由 VITE_SAVE_PREFIX 驱动；
 *   2) 正式版（lrv2）与测试版（lrv2test）的键集合零重叠；
 *   3) 同一 localStorage 下，正式版写入的数据测试版读不到，反之亦然；
 *   4) 金币 / 车辆 / 奖励在两种前缀下功能都正常（前缀不影响游戏逻辑）。
 *
 * 实现：把 src/garage/save.js 复制为两份临时模块，分别把
 *   `import.meta.env.VITE_SAVE_PREFIX` 读取整行替换成字面量 'lrv2' / 'lrv2test'，
 *   再在共享的 fake localStorage 上分别加载、交叉验证。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SAVE_SRC = path.join(ROOT, 'src/garage/save.js');

/** 内存版 localStorage：同一进程共享，用来验证「跨前缀隔离」。 */
class MemStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  key(i) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
}

const PREFIX_LINE =
  /const SAVE_PREFIX = \(import\.meta\.env && import\.meta\.env\.VITE_SAVE_PREFIX\) \|\| 'lrv2';/;

function makeBuild(prefix) {
  let src = fs.readFileSync(SAVE_SRC, 'utf8');
  if (!PREFIX_LINE.test(src)) {
    throw new Error('未能在 save.js 中找到 SAVE_PREFIX 定义行，无法注入前缀');
  }
  src = src.replace(PREFIX_LINE, `const SAVE_PREFIX = ${JSON.stringify(prefix)};`);
  if (src.includes('import.meta.env')) {
    throw new Error('替换失败：save.js 中仍残留 import.meta.env');
  }
  const cacheDir = path.join(ROOT, 'node_modules/.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const tmp = path.join(cacheDir, `iso-save-${prefix}.mjs`);
  fs.writeFileSync(tmp, src);
  return tmp;
}

async function loadBuild(tmp) {
  // 加 query 防模块缓存复用
  return import(pathToFileURL(tmp).href + `?t=${Date.now()}-${Math.random()}`);
}

function assert(cond, msg) {
  if (!cond) throw new Error('断言失败: ' + msg);
  console.log('  ✓ ' + msg);
}

const results = { pass: true, errors: [], prodKeys: [], testKeys: [] };

try {
  const store = new MemStorage();
  globalThis.localStorage = store;

  const prodTmp = makeBuild('lrv2');
  const testTmp = makeBuild('lrv2test');
  const Prod = await loadBuild(prodTmp);
  const Test = await loadBuild(testTmp);

  // --- A. 键前缀正确性 ---
  console.log('\n[A] 正式版（lrv2）键前缀');
  assert(Prod.K.coins === 'lrv2.garage.coins', 'coins -> lrv2.garage.coins');
  assert(Prod.K.owned === 'lrv2.garage.owned', 'owned -> lrv2.garage.owned');
  assert(Prod.K.current === 'lrv2.garage.current', 'current -> lrv2.garage.current');
  assert(Prod.K.story === 'lrv2.garage.rewards.story', 'story -> lrv2.garage.rewards.story');
  assert(Prod.K.study === 'lrv2.garage.rewards.study', 'study -> lrv2.garage.rewards.study');
  assert(Prod.K.claims === 'lrv2.garage.claims', 'claims -> lrv2.garage.claims');
  assert(Prod.K.achievements === 'lrv2.garage.achievements', 'achievements -> lrv2.garage.achievements');
  assert(Prod.K.rewardLedger === 'lrv2.garage.reward-ledger', 'rewardLedger -> lrv2.garage.reward-ledger');
  assert(Prod.LEGACY.vehicle === 'lrv2.vehicle', 'legacy vehicle -> lrv2.vehicle');
  assert(Prod.LEGACY.driverSkin === 'lrv2.driverSkin', 'legacy driverSkin -> lrv2.driverSkin');
  assert(Prod.LEGACY.chapter1 === 'littleRacingV2.story.chapter1', 'chapter1 -> littleRacingV2.story.chapter1');
  assert(Prod.K_CHAPTER2 === 'littleRacingV2.story.chapter2', 'chapter2 -> littleRacingV2.story.chapter2');
  assert(Prod.K_MUSIC === 'littleRacingV2.music', 'music -> littleRacingV2.music');
  assert(Prod.K_VOICE === 'littleRacingV2.voice', 'voice -> littleRacingV2.voice');
  assert(Prod.K_FS_HINT === 'lrv2.fsHintSeen', 'fsHint -> lrv2.fsHintSeen');
  assert(Prod.BACKUP_PREFIX === 'lrv2.garage.backup.', 'backup prefix -> lrv2.garage.backup.');

  console.log('\n[A] 测试版（lrv2test）键前缀');
  assert(Test.K.coins === 'lrv2test.garage.coins', 'coins -> lrv2test.garage.coins');
  assert(Test.K.owned === 'lrv2test.garage.owned', 'owned -> lrv2test.garage.owned');
  assert(Test.K.current === 'lrv2test.garage.current', 'current -> lrv2test.garage.current');
  assert(Test.K.story === 'lrv2test.garage.rewards.story', 'story -> lrv2test.garage.rewards.story');
  assert(Test.K.study === 'lrv2test.garage.rewards.study', 'study -> lrv2test.garage.rewards.study');
  assert(Test.K.claims === 'lrv2test.garage.claims', 'claims -> lrv2test.garage.claims');
  assert(Test.K.achievements === 'lrv2test.garage.achievements', 'achievements -> lrv2test.garage.achievements');
  assert(Test.K.rewardLedger === 'lrv2test.garage.reward-ledger', 'rewardLedger -> lrv2test.garage.reward-ledger');
  assert(Test.LEGACY.vehicle === 'lrv2test.vehicle', 'legacy vehicle -> lrv2test.vehicle');
  assert(Test.LEGACY.driverSkin === 'lrv2test.driverSkin', 'legacy driverSkin -> lrv2test.driverSkin');
  assert(Test.LEGACY.chapter1 === 'littleRacingV2test.story.chapter1', 'chapter1 -> littleRacingV2test.story.chapter1');
  assert(Test.K_CHAPTER2 === 'littleRacingV2test.story.chapter2', 'chapter2 -> littleRacingV2test.story.chapter2');
  assert(Test.K_MUSIC === 'littleRacingV2test.music', 'music -> littleRacingV2test.music');
  assert(Test.K_VOICE === 'littleRacingV2test.voice', 'voice -> littleRacingV2test.voice');
  assert(Test.K_FS_HINT === 'lrv2test.fsHintSeen', 'fsHint -> lrv2test.fsHintSeen');
  assert(Test.BACKUP_PREFIX === 'lrv2test.garage.backup.', 'backup prefix -> lrv2test.garage.backup.');

  // --- B. 功能正确性（前缀不影响游戏逻辑）---
  console.log('\n[B] 功能正确性（前缀不影响游戏逻辑）');
  store.clear();
  Prod.__resetGarageForTests();
  Prod.grantCoins(120, 'test');
  assert(Prod.getCoins() === 120, '正式版发放金币后余额=120');
  Prod.grantVehicle('turtle', 'story-chapter1');
  assert(Prod.owns('turtle') === true, '正式版授予海龟车');

  Test.__resetGarageForTests();
  Test.grantCoins(500, 'test');
  assert(Test.getCoins() === 500, '测试版发放金币后余额=500');
  Test.grantVehicle('moto', 'purchase');
  assert(Test.owns('moto') === true, '测试版授予摩托');

  // --- C. 跨前缀隔离：写入正式版后，测试版读不到；反之亦然 ---
  console.log('\n[C] 跨前缀隔离（同浏览器内互不串台）');
  store.clear();
  Prod.__resetGarageForTests();
  Prod.grantCoins(999, 'prod-only');
  Prod.grantVehicle('turtle', 'story-chapter1');
  Test.__dropCacheForTests();
  assert(Test.getCoins() === 0, '测试版读不到正式版的 999 金币（隔离）');
  const testSnap = Test.snapshot();
  assert(testSnap.owned.turtle === undefined, '测试版看不到正式版的海龟车');

  store.clear();
  Test.__resetGarageForTests();
  Test.grantCoins(777, 'test-only');
  Test.grantVehicle('moto', 'purchase');
  Prod.__dropCacheForTests();
  assert(Prod.getCoins() === 0, '正式版读不到测试版的 777 金币（隔离）');
  const prodSnap = Prod.snapshot();
  assert(prodSnap.owned.moto === undefined, '正式版看不到测试版的摩托');

  // --- D. 键集合零重叠 ---
  console.log('\n[D] 键集合零重叠');
  store.clear();
  Prod.__resetGarageForTests();
  Test.__resetGarageForTests();
  Prod.grantCoins(100, 'a'); Prod.grantVehicle('turtle', 'story-chapter1');
  Test.grantCoins(200, 'b'); Test.grantVehicle('moto', 'purchase');
  const allKeys = [...store.m.keys()];
  const prodKeys = allKeys.filter((k) => k.startsWith('lrv2.') || k.startsWith('littleRacingV2.'));
  const testKeys = allKeys.filter((k) => k.startsWith('lrv2test.') || k.startsWith('littleRacingV2test.'));
  const overlap = prodKeys.filter((k) => testKeys.includes(k));
  assert(overlap.length === 0, `正式版与测试版键集合零重叠（prod=${prodKeys.length}, test=${testKeys.length}）`);
  assert(prodKeys.length > 0 && testKeys.length > 0, '两版都确实写入了各自的键');
  results.prodKeys = prodKeys;
  results.testKeys = testKeys;

  console.log('\n隔离验证全部通过 ✅');
} catch (e) {
  results.pass = false;
  results.errors.push(String((e && e.stack) || e));
  console.error('\n隔离验证失败 ❌\n', e);
}

const outDir = path.join(ROOT, 'tools/out');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'isolation-report.json'), JSON.stringify(results, null, 2));
process.exit(results.pass ? 0 : 1);
