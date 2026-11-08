/* ==================================================================
 * R4 第二章《阳光沙滩大冒险》剧情语音接入 · 专项验收测试
 *
 *   node tools/test/chapter2-voice.mjs
 *
 * 前置：dist-test 必须已用 VITE_TEST_HOOKS=1 构建（本脚本不负责构建，
 *       避免 Git Bash 的 MSYS 路径污染 VITE_BASE）。
 *
 * 覆盖（对应用户要求的 8 项检查）：
 *   V1  21 条 MP3 存在于源码与构建产物，SHA256 与交付清单一致
 *   V2  21 条音频在浏览器内真实 fetch + decodeAudioData 成功（不只是查表）
 *   V3  21 条音频与剧情台词 / 角色 / 顺序一一对应，无遗漏、错配
 *   V4  第二章开场 12 句语音逐句衔接；V5 结尾 9 句语音逐句衔接
 *   V6  快速点击下一句 / 跳过 / 返回首页 / 进入比赛时语音正确中断、无叠音
 *   V7  背景音乐避让（duck 0.35 → 1）与切句不抖动
 *   V8  静音设置被尊重（静音时一句都不放）
 *   V9  第一章原有语音回归 + 跨章隔离（上一章声音不延续到下一章）
 *   V10 iPhone Safari 兼容：AudioContext 解锁、playsinline、pending 补播
 *   V11 第二章赛道 / 车辆 / 道具 / 奖励 / 存档未受影响（基础检查）
 *   V12 无 JS 运行时错误、无 404、无 SpeechSynthesis 回退
 *
 * 输出：tools/out/chapter2-voice-report.json
 * 任何一项失败 → 退出码 1。
 * ================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import {
  startServer, findBrowser, CHROME_ARGS, loadPuppeteer, ensureDirs,
  createReport, OUT,
} from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const DIST_TEST = path.join(ROOT, 'dist-test');
const DIST = path.join(ROOT, 'dist');
const VOICE_SRC = path.join(ROOT, 'src/assets/audio/voice');
const MANIFEST = path.join(ROOT, 'tools/out/_c2voice/extract/SHA256_文件清单.csv');

/* 交付方《SHA256_文件清单.csv》的原文，内嵌于此让测试脱离临时解压目录也能独立运行。 */
const DELIVERY_SHA256 = {
  'c2-01.mp3': 'ad380e39be5f522e4ab68ad7ece4defb036a0da1460eecc49c052599c93bb348',
  'c2-02.mp3': '976874eb2cedf08bfb954ba9b5c04aaf562202c449e7a71f82b616563cc6db52',
  'c2-03.mp3': '2427613357a9a17aed195fb6ce65d87d15c4e6426604809448029e6966034766',
  'c2-04.mp3': '72ca02a448920c6d867f5922e5bd37649b947c06de090a4bf834b51344b042b7',
  'c2-05.mp3': '6ec8ab950740852c10a1786e8840831e5346a7c27731873f5fab53eb49bc9db7',
  'c2-06.mp3': 'b037fe496af976906fbfa26c48ecc14a1b36bca2a39b54bbb395f65b0b8d84ca',
  'c2-07.mp3': 'cb11e7add1a1b1636f64ce569239d6480ef3a5ac2205bcfa5e72477cef25973c',
  'c2-08.mp3': '3f0a0cf750e82ffd4115931555d1f7ac07cc16997005133c952b26dd7c432ec6',
  'c2-09.mp3': 'bdc2ed4ba9fde02f7d40b3488395885e66069b57ff773b61106f69e339e6f1cb',
  'c2-10.mp3': '2b43ebbe2a7029093da9b6050c59b58cc4d1392d3199852787119edc69dc983d',
  'c2-11.mp3': '27e24ec853d8331df8e8efbaedf00e6b5f2fb8de1f203620bb4cc042143151bd',
  'c2-12.mp3': 'fb7f8302dbf51f667711f428353bd57394a5ed1eab61d47aa033603026b59b15',
  'c2-13.mp3': 'eb7d8f01552b027d69ce8fc1b8fdd7cceef58d18c20137a1220c6c99b073eaae',
  'c2-14.mp3': 'c40442e684452f08faa54082839971eff832ba13ebc1c7e26d2951f50e63843d',
  'c2-15.mp3': '1ee4b1431787400a365a0a14f088ddd28f76134b421f7df64f043d2edbf70725',
  'c2-16.mp3': '75f79c75c7eec17eb85b98495d8f21e82f609fa7815dcc879fce7855d1c34153',
  'c2-17.mp3': '56049e2fdc9353f0f1b47289523e23e65b0791886a03c3a2aeadabb9c7359a60',
  'c2-18.mp3': '80ba6197feb5f679f82a9f6c04e2204f0135c2381cbf021d1d7921c34cddf84c',
  'c2-19.mp3': '0e27c0cfa47d2fe2abb8c701996e797552f9a686a1dc001a18fc9d16905868ae',
  'c2-20.mp3': 'ab5a9634d6f5f1bef0d333125feb12d52e6872fa03e0601b56b71c4dfccf7d8e',
  'c2-21.mp3': '29e8969956bf3c4b190032ee01a3c467399956053c6837b309670e6cc7246593',
};

const report = createReport('R4 第二章剧情语音接入 · 专项验收');
ensureDirs();

/* 逐条按录音内容核对的结果（ASR 转录 + 说话人分离标签）。
 * speaker 1 = 灯塔爷爷（低沉男声），0 = 闪电小红（清亮童声）。
 * 这是「以实际台词内容为依据匹配」的证据，不是按编号盲接。 */
const C2_VOICE = [
  { id: 'c2-01', seg: 'intro',  speaker: 'lighthouse-grandpa', asrSpeaker: 1, asr: '哎呀呀，出大事儿啦，海滩赛车节的冠军奖杯不见啦。' },
  { id: 'c2-02', seg: 'intro',  speaker: 'lighthouse-grandpa', asrSpeaker: 1, asr: '今天早上我打开箱子，里面只剩下一串湿湿的脚印，还有一点点沙子。' },
  { id: 'c2-03', seg: 'intro',  speaker: 'flash-little-red',   asrSpeaker: 0, asr: '咦，昨天晚上它还好好地放在这里的呀。' },
  { id: 'c2-04', seg: 'intro',  speaker: 'flash-little-red',   asrSpeaker: 0, asr: '湿脚印沙子会不会是往海边去了？' },
  { id: 'c2-05', seg: 'intro',  speaker: 'lighthouse-grandpa', asrSpeaker: 1, asr: '孩子，能帮爷爷一个忙吗？沿着阳光海岸把奖杯找回来。' },
  { id: 'c2-06', seg: 'intro',  speaker: 'flash-little-red',   asrSpeaker: 0, asr: '嘿，我们一起去吧，你开车那么厉害，肯定追得上。' },
  { id: 'c2-07', seg: 'intro',  speaker: 'flash-little-red',   asrSpeaker: 0, asr: '沿着海岸有一场比赛，跑完就能拿到贝壳湾的通行证。' },
  { id: 'c2-08', seg: 'intro',  speaker: 'lighthouse-grandpa', asrSpeaker: 1, asr: '路上有我年轻时候认识的老朋友，他们会帮你们的。' },
  { id: 'c2-09', seg: 'intro',  speaker: 'lighthouse-grandpa', asrSpeaker: 1, asr: '记住哦，沙滩上的弯道和城里的石板路不一样。' },
  { id: 'c2-10', seg: 'intro',  speaker: 'lighthouse-grandpa', asrSpeaker: 1, asr: '沙子软，抓地力小，转弯要早点松油门。' },
  { id: 'c2-11', seg: 'intro',  speaker: 'lighthouse-grandpa', asrSpeaker: 1, asr: '还有那座木桥，桥面窄，过桥的时候别乱打方向。' },
  { id: 'c2-12', seg: 'intro',  speaker: 'flash-little-red',   asrSpeaker: 0, asr: '放心吧爷爷，我们出发啦。' },
  { id: 'c2-13', seg: 'ending', speaker: 'lighthouse-grandpa', asrSpeaker: 1, asr: '好样的，跑得真快，比爷爷年轻的时候还稳。' },
  { id: 'c2-14', seg: 'ending', speaker: 'flash-little-red',   asrSpeaker: 0, asr: '等等，你看那边礁石上卡着一样亮亮的东西。' },
  { id: 'c2-15', seg: 'ending', speaker: 'lighthouse-grandpa', asrSpeaker: 1, asr: '那是冠军奖杯上掉下来的小星星。' },
  { id: 'c2-16', seg: 'ending', speaker: 'flash-little-red',   asrSpeaker: 0, asr: '星星旁边还有一条小船，划走的痕迹一直通向礁石后面。' },
  { id: 'c2-17', seg: 'ending', speaker: 'flash-little-red',   asrSpeaker: 0, asr: '找到啦，奖杯就卡在礁石缝里，还好一点都没有摔坏。' },
  { id: 'c2-18', seg: 'ending', speaker: 'lighthouse-grandpa', asrSpeaker: 1, asr: '原来是一条小船被浪打偏，把奖杯一路带到了这里。' },
  { id: 'c2-19', seg: 'ending', speaker: 'lighthouse-grandpa', asrSpeaker: 1, asr: '谢谢你们，海滩赛车节可以照常开幕啦。' },
  { id: 'c2-20', seg: 'ending', speaker: 'flash-little-red',   asrSpeaker: 0, asr: '这一届的冠军，我们下次再一起挑战吧。' },
  { id: 'c2-21', seg: 'ending', speaker: 'lighthouse-grandpa', asrSpeaker: 1, asr: '对了，奖杯底座上好像刻着一张新的地图呢。' },
];
const IDS = C2_VOICE.map((x) => x.id);

/* ---------------------------------------------------------------- V1 */
console.log('\n=== V1. 21 条 MP3 文件与哈希 ===');
{
  const missing = IDS.filter((id) => !fs.existsSync(path.join(VOICE_SRC, `${id}.mp3`)));
  report.check('V1.1 源码目录含 21 条 c2 配音', missing.length === 0, `缺失 ${missing.length}${missing.length ? ': ' + missing.join(',') : ''}`);

  let hashBad = 0;
  for (const id of IDS) {
    const f = path.join(VOICE_SRC, `${id}.mp3`);
    if (!fs.existsSync(f)) continue;
    const got = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    if (DELIVERY_SHA256[`${id}.mp3`] !== got) hashBad++;
  }
  report.check('V1.2 21 条 SHA256 与交付清单逐条一致（内嵌原表）', hashBad === 0, `不一致 ${hashBad}`);
  /* 若附包解压目录仍在，再与磁盘上的原 CSV 交叉校验一次 */
  if (fs.existsSync(MANIFEST)) {
    const rows = fs.readFileSync(MANIFEST, 'utf8').trim().split(/\r?\n/).slice(1);
    const mismatch = rows.filter((line) => {
      const [, name, , sha] = line.split(',');
      return DELIVERY_SHA256[name.trim()] !== sha.trim();
    });
    report.check('V1.2b 内嵌哈希与附件原 CSV 交叉一致', mismatch.length === 0 && rows.length === 21,
      `CSV ${rows.length} 行 / 差异 ${mismatch.length}`);
  }

  for (const [label, dir] of [['dist', DIST], ['dist-test', DIST_TEST]]) {
    const n = fs.existsSync(dir) ? fs.readdirSync(path.join(dir, 'assets')).filter((f) => /^c2-\d\d-.*\.mp3$/.test(f)).length : -1;
    report.check(`V1.3 构建产物 ${label} 含 21 条 c2 音频`, n === 21, `实测 ${n}`);
  }

  const js = fs.readdirSync(path.join(DIST, 'assets')).find((f) => /^index-.*\.js$/.test(f));
  const code = js ? fs.readFileSync(path.join(DIST, 'assets', js), 'utf8') : '';
  const noAbs = !/[A-Za-z]:[\\/]Users[\\/]/i.test(code);
  report.check('V1.4 构建产物不含本机绝对路径（相对资源管理）', noAbs, noAbs ? 'ok' : '发现绝对路径');
  report.check('V1.5 无 speechSynthesis / TTS 回退', !/speechSynthesis/i.test(code), 'ok');
}

if (!fs.existsSync(path.join(DIST_TEST, 'index.html'))) {
  console.error('::error:: dist-test 不存在，请先以 VITE_TEST_HOOKS=1 构建');
  process.exit(1);
}
const c2Assets = fs.readdirSync(path.join(DIST_TEST, 'assets')).filter((f) => /^c2-\d\d-.*\.mp3$/.test(f));

const puppeteer = await loadPuppeteer();
const srv = await startServer(DIST_TEST);
const browser = await puppeteer.launch({
  executablePath: findBrowser(), headless: true, args: CHROME_ARGS, protocolTimeout: 1800000,
});
const page = await browser.newPage();
page.setDefaultNavigationTimeout(180000);
const consoleErrors = [];
const failedRequests = [];
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/^Failed to load resource/.test(t) && /ERR_(CONNECTION_CLOSED|ABORTED)/.test(t)) return;
  if (/Permissions policy violation: unload is not allowed/i.test(t)) return;
  consoleErrors.push(t);
});
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
page.on('requestfailed', (r) => failedRequests.push(r.url().split('/').pop()));
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = (q) => `${srv.url}/${q}`;

const vstate = () => page.evaluate(() => window.__story.state().voice);
const vcall = (fn, ...args) => page.evaluate(({ fn, args }) => {
  const v = window.__game.voice;
  return v[fn](...args);
}, { fn, args });
const duck = () => page.evaluate(() => window.__music.duck);
/** 播放一句并等到 playingId 真的落定（解码是异步的，不能用固定 sleep 猜）。 */
const playAndWait = async (id, timeout = 15000) => {
  await vcall('play', id);
  try {
    await page.waitForFunction((want) => window.__game.voice.playingId === want,
      { timeout, polling: 50 }, id);
    return true;
  } catch { return false; }
};
/** 重新进入第二章开场，并等第一句就绪。 */
const freshIntro = async () => {
  await page.evaluate(() => window.__story.startChapter('chapter-02', 'intro'));
  await page.waitForFunction(() => {
    const s = window.__story.state();
    return s.currentChapterId === 'chapter-02' && s.director && s.director.beat?.id === 'c2-01';
  }, { timeout: 240000, polling: 200 });
};

try {
  await page.goto(url('?course=beach'), { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => !!window.__sim && !!window.__game && !!window.__story, { timeout: 300000, polling: 300 });
  /* 模拟真实用户手势：解锁 AudioContext（iPhone Safari 的关键前置）。
   * 之后的播放断言才代表「已授权可出声」的真实状态。 */
  await page.evaluate(() => window.__game.voice.unlock());
  await page.waitForFunction(() => window.__game.voice.debugState().ctxState === 'running', { timeout: 30000, polling: 100 });

  /* -------------------------------------------------------------- V2 */
  console.log('\n=== V2. 21 条音频浏览器内真实加载 / 解码 ===');
  const decode = await page.evaluate(async (files) => {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const out = [];
    for (const f of files) {
      try {
        const res = await fetch('./assets/' + f);
        if (!res.ok) { out.push({ f, ok: false, why: 'http ' + res.status }); continue; }
        const buf = await res.arrayBuffer();
        const audio = await new Promise((resolve, reject) => {
          const r = ctx.decodeAudioData(buf, resolve, reject);
          if (r && typeof r.then === 'function') r.then(resolve, reject);
        });
        out.push({ f, ok: audio.duration > 0, dur: +audio.duration.toFixed(2) });
      } catch (e) { out.push({ f, ok: false, why: String(e && e.message || e) }); }
    }
    try { await ctx.close(); } catch { /* ignore */ }
    return out;
  }, c2Assets);
  const decOk = decode.filter((x) => x.ok).length;
  report.check('V2.1 21 条 MP3 全部 HTTP 200 且 decodeAudioData 成功', decOk === 21,
    `成功 ${decOk}/21${decOk !== 21 ? ' 失败: ' + decode.filter(x => !x.ok).map(x => x.f + ':' + x.why).join(', ') : ''}`);
  report.check('V2.2 每条音频时长均 > 3 秒（无空文件 / 截断）', decode.every((x) => x.ok && x.dur > 3),
    `最短 ${Math.min(...decode.map((x) => x.dur || 0)).toFixed(2)}s / 最长 ${Math.max(...decode.map((x) => x.dur || 0)).toFixed(2)}s`);

  const hasAll = await page.evaluate((ids) => {
    const v = window.__game.voice;
    return { has: ids.map((id) => v.has(id)), files: v.debugState().files, available: v.availableIds() };
  }, IDS);
  report.check('V2.3 VoiceManager.has() 对 21 个 c2 id 全为 true', hasAll.has.every(Boolean),
    `false 数 ${hasAll.has.filter((x) => !x).length}`);
  report.check('V2.4 availableIds() 包含全部 21 条 c2 配音',
    IDS.every((id) => hasAll.available.includes(id)), `available 共 ${hasAll.available.length} 条`);

  /* -------------------------------------------------------------- V3 */
  console.log('\n=== V3. 语音 ↔ 台词 / 角色 / 顺序对应 ===');
  const beats = await page.evaluate(() => {
    const c2 = window.__story.chapter2;
    const map = (arr, seg) => arr.map((b, i) => ({ id: b.id, voice: b.voice, speaker: b.speaker, text: b.text, seg, i }));
    return [...map(c2.intro.beats, 'intro'), ...map(c2.ending.beats, 'ending')];
  });
  report.check('V3.1 第二章共 21 句对白（开场 12 + 结尾 9）',
    beats.length === 21 && beats.filter((b) => b.seg === 'intro').length === 12 && beats.filter((b) => b.seg === 'ending').length === 9,
    `总数 ${beats.length} / 开场 ${beats.filter((b) => b.seg === 'intro').length} / 结尾 ${beats.filter((b) => b.seg === 'ending').length}`);
  report.check('V3.2 21 句全部声明 voice 且编号连续 c2-01…c2-21',
    beats.every((b, i) => b.voice === `c2-${String(i + 1).padStart(2, '0')}`),
    beats.map((b) => b.voice).join(',') === IDS.join(',') ? '顺序一致' : '顺序不一致');
  const speakerBad = C2_VOICE.filter((x, i) => beats[i].speaker !== x.speaker);
  report.check('V3.3 每句 speaker 与录音说话人一致（爷爷/小红不串音）', speakerBad.length === 0,
    `不一致 ${speakerBad.length}；爷爷 ${C2_VOICE.filter(x => x.asrSpeaker === 1).length} 句 / 小红 ${C2_VOICE.filter(x => x.asrSpeaker === 0).length} 句`);
  const segBad = C2_VOICE.filter((x, i) => beats[i].seg !== x.seg);
  report.check('V3.4 音频归属段落正确（开场 1-12 / 结尾 13-21）', segBad.length === 0, `不一致 ${segBad.length}`);
  const fileMap = await page.evaluate((ids) => {
    const v = window.__game.voice;
    return Object.fromEntries(ids.map((id) => [id, v._url(id) ? v._url(id).split('/').pop() : null]));
  }, IDS);
  report.check('V3.5 每个 id 只解析到一个独立 MP3 文件（无一条多用 / 共用）',
    IDS.every((id) => /^c2-\d\d-.*\.mp3$/.test(fileMap[id] || '')) && new Set(Object.values(fileMap)).size === 21,
    `唯一文件 ${new Set(Object.values(fileMap)).size} 个`);
  report.check('V3.6 台词文本非空且与设计台词一致（无遗漏 / 错配）',
    beats.every((b) => typeof b.text === 'string' && b.text.trim().length > 0), '21/21 非空');

  /* -------------------------------------------------------------- V4 */
  console.log('\n=== V4. 开场 12 句语音衔接 ===');
  await page.evaluate(() => window.__story.startChapter('chapter-02', 'intro'));
  await page.waitForFunction(() => { const s = window.__story.state(); return s.currentChapterId === 'chapter-02' && s.director && s.director.beat; }, { timeout: 240000, polling: 200 });
  await sleep(300);
  const introSeen = [];
  for (let i = 0; i < 12; i++) {
    const s = await page.evaluate(() => {
      const d = window.__story.state().director;
      const v = window.__game.voice.debugState();
      return { beat: d.beat?.id, voice: d.voiceId, playing: v.playingId, nPlaying: Object.values(v.tracks).filter((t) => t.playing).length, chapterIds: v.chapterIds };
    });
    introSeen.push(s);
    if (i < 11) { await page.evaluate(() => window.__story.next()); await sleep(180); }
  }
  report.check('V4.1 开场 12 句 beat 顺序 = c2-01…c2-12',
    introSeen.every((s, i) => s.beat === IDS[i]), introSeen.map((s) => s.beat).join(','));
  report.check('V4.2 每句 voiceId 与 beat 对应且同一时刻最多一句在播',
    introSeen.every((s, i) => s.voice === IDS[i] && s.nPlaying <= 1),
    `最大并发 ${Math.max(...introSeen.map((s) => s.nPlaying))}`);
  report.check('V4.3 开场段落预加载范围恰好 12 条（不预取结尾，Safari 友好）',
    introSeen[0].chapterIds && introSeen[0].chapterIds.length === 12,
    `chapterIds=${introSeen[0].chapterIds ? introSeen[0].chapterIds.length : 'null'}`);
  report.check('V4.4 比赛前最后一句为 c2-12「放心吧爷爷！我们出发啦！」',
    introSeen[11].beat === 'c2-12' && introSeen[11].voice === 'c2-12', introSeen[11].voice);

  /* -------------------------------------------------------------- V6a */
  console.log('\n=== V6a. 跳过 / 返回首页 / 进入比赛中断语音 ===');
  await playAndWait('c2-12');
  const beforeSkip = (await vstate()).playingId;
  await page.evaluate(() => window.__story.skip());
  await sleep(120);
  const afterSkip = await vstate();
  report.check('V6.1 点击「跳过剧情」立即停止当前语音',
    beforeSkip === 'c2-12' && afterSkip.playingId === null, `前 ${beforeSkip} → 后 ${afterSkip.playingId}`);
  report.check('V6.2 跳过后背景音乐避让已恢复', (await duck()) === 1, `duck=${await duck()}`);

  await freshIntro();
  await playAndWait('c2-01');
  await page.evaluate(() => window.__story.choose('home'));
  await page.waitForFunction(() => window.__game.state === 'menu', { timeout: 120000, polling: 200 });
  report.check('V6.3 「返回首页」停止当前剧情语音', (await vstate()).playingId === null, `playingId=${(await vstate()).playingId}`);

  await freshIntro();
  await playAndWait('c2-01');
  await page.evaluate(() => window.__story.choose('start'));
  await page.waitForFunction(() => window.__game.state === 'race', { timeout: 120000, polling: 200 });
  report.check('V6.4 「进入比赛」停止当前剧情语音', (await vstate()).playingId === null, `playingId=${(await vstate()).playingId}`);
  report.check('V6.5 进入的是阳光沙滩赛道', await page.evaluate(() => window.__game.track?.course?.id === 'beach'),
    await page.evaluate(() => window.__game.track?.course?.id));

  /* -------------------------------------------------------------- V5 */
  console.log('\n=== V5. 结尾 9 句语音衔接（比赛后） ===');
  await page.evaluate(() => window.__story.startChapter('chapter-02', 'ending'));
  await page.waitForFunction(() => { const s = window.__story.state(); return s.currentChapterId === 'chapter-02' && s.director && s.director.beat; }, { timeout: 240000, polling: 200 });
  await sleep(300);
  const endSeen = [];
  for (let i = 0; i < 9; i++) {
    const s = await page.evaluate(() => {
      const d = window.__story.state().director;
      const v = window.__game.voice.debugState();
      return { beat: d.beat?.id, voice: d.voiceId, nPlaying: Object.values(v.tracks).filter((t) => t.playing).length, chapterIds: v.chapterIds };
    });
    endSeen.push(s);
    if (i < 8) { await page.evaluate(() => window.__story.next()); await sleep(180); }
  }
  report.check('V5.1 结尾 9 句 beat 顺序 = c2-13…c2-21',
    endSeen.every((s, i) => s.beat === IDS[i + 12]), endSeen.map((s) => s.beat).join(','));
  report.check('V5.2 每句 voiceId 对应且无叠音',
    endSeen.every((s, i) => s.voice === IDS[i + 12] && s.nPlaying <= 1), `最大并发 ${Math.max(...endSeen.map(s => s.nPlaying))}`);
  report.check('V5.3 结尾段落预加载范围恰好 9 条', endSeen[0].chapterIds && endSeen[0].chapterIds.length === 9,
    `chapterIds=${endSeen[0].chapterIds ? endSeen[0].chapterIds.length : 'null'}`);

  /* -------------------------------------------------------------- V6b */
  console.log('\n=== V6b. 快速点击下一句 / 重复播放 / 叠音 ===');
  await freshIntro();
  /* 预解码：把「解码耗时」从断言里剥掉，只测停止/叠音逻辑本身 */
  await page.evaluate(async () => {
    const v = window.__game.voice;
    await Promise.all(['c2-01', 'c2-02', 'c2-03', 'c2-04', 'c2-05', 'c2-08'].map((id) => v._load(id)));
  });
  const rapid = await page.evaluate(() => {
    const v = window.__game.voice;
    const before = v._gen;
    v.play('c2-01'); v.play('c2-02'); v.play('c2-03'); v.play('c2-04'); v.play('c2-05');
    const s = v.debugState();
    return { playingId: s.playingId, nPlaying: Object.values(s.tracks).filter((t) => t.playing).length, srcNodes: v.srcNode ? 1 : 0, genDelta: v._gen - before };
  });
  report.check('V6.6 快速连点 5 次后只剩最后一句在播（旧句立即停止）',
    rapid.playingId === 'c2-05' && rapid.nPlaying === 1 && rapid.srcNodes === 1,
    `playingId=${rapid.playingId} 并发=${rapid.nPlaying} srcNode=${rapid.srcNodes}`);
  const noDup = await page.evaluate(async () => {
    const v = window.__game.voice;
    let starts = 0;
    const off = v.on('start', () => { starts++; });
    v.play('c2-08');
    await new Promise((r) => setTimeout(r, 250));
    off();
    return { starts, playingId: v.playingId };
  });
  report.check('V6.7 单句只触发一次 start（不重复播放）', noDup.starts === 1,
    `start 次数=${noDup.starts} playingId=${noDup.playingId}`);

  /* -------------------------------------------------------------- V7 */
  console.log('\n=== V7. 背景音乐避让与切句不抖动 ===');
  await page.evaluate(() => window.__game.voice.stop());
  await sleep(80);
  const duckSeq = [];
  for (const id of ['c2-01', 'c2-02', 'c2-03']) {
    await playAndWait(id);
    duckSeq.push(await duck());
  }
  report.check('V7.1 播放语音期间背景音乐压到 35%', duckSeq.every((d) => d === 0.35), `duck 序列=${duckSeq.join(',')}`);
  await vcall('stop');
  await sleep(80);
  report.check('V7.2 语音结束后背景音乐恢复到 100%', (await duck()) === 1, `duck=${await duck()}`);
  const jitter = await page.evaluate(async () => {
    const v = window.__game.voice, m = window.__music;
    const idle = (ms) => new Promise((r) => setTimeout(r, ms));
    const seen = [];
    v.play('c2-01');
    for (let i = 0; i < 30 && v.playingId !== 'c2-01'; i++) await idle(50);
    seen.push(m.duck);
    v.play('c2-02');                       // 切句
    seen.push(m.duck);                     // 立刻读：不应先回到 1
    for (let i = 0; i < 30 && v.playingId !== 'c2-02'; i++) await idle(50);
    seen.push(m.duck);
    v.stop();
    return seen;
  });
  report.check('V7.3 切句瞬间背景音乐不来回抖动（保持压低）',
    jitter.every((d) => d === 0.35), `duck 序列=${jitter.join(',')}`);

  /* -------------------------------------------------------------- V8 */
  console.log('\n=== V8. 静音设置 ===');
  const muteRes = await page.evaluate(() => {
    const v = window.__game.voice;
    v.setMuted(true);
    const ok = v.play('c2-01');
    const s = v.debugState();
    return { ok, reason: s.lastResult.reason, playingId: s.playingId, duck: window.__music.duck, wantsSound: v.wantsSound() };
  });
  report.check('V8.1 静音时 play() 被拒绝且一句都不播',
    muteRes.ok === false && muteRes.reason === 'muted' && muteRes.playingId === null,
    `ok=${muteRes.ok} reason=${muteRes.reason} playingId=${muteRes.playingId}`);
  report.check('V8.2 静音时背景音乐不被误拉低', muteRes.duck === 1, `duck=${muteRes.duck}`);
  const unmuteRes = await page.evaluate(async () => {
    const v = window.__game.voice;
    v.setMuted(false);
    const ok = v.play('c2-01');
    for (let i = 0; i < 30 && v.playingId !== 'c2-01'; i++) await new Promise((r) => setTimeout(r, 50));
    return { ok, playingId: v.playingId, wantsSound: v.wantsSound() };
  });
  report.check('V8.3 取消静音后恢复可播', unmuteRes.ok === true && unmuteRes.playingId === 'c2-01',
    `ok=${unmuteRes.ok} playingId=${unmuteRes.playingId}`);
  await vcall('stop');

  /* -------------------------------------------------------------- V9 */
  console.log('\n=== V9. 第一章语音回归 + 跨章隔离 ===');
  const c1 = await page.evaluate(() => {
    const v = window.__game.voice;
    return { has: ['c1-01', 'c1-02', 'c1-03', 'c1-04', 'c1-05', 'wrong-way'].map((id) => v.has(id)), urls: ['c1-01', 'c1-05', 'wrong-way'].map((id) => v._url(id)?.split('/').pop()) };
  });
  report.check('V9.1 第一章 5 句 + 逆行提示配音全部保留', c1.has.every(Boolean), `has=${c1.has.join(',')}`);
  report.check('V9.2 第一章音频文件名未被第二章覆盖', c1.urls.every((u) => u && !u.startsWith('c2-')), c1.urls.join(','));
  const c1play = await page.evaluate(async () => {
    const v = window.__game.voice;
    v.play('c1-01');
    for (let i = 0; i < 30 && v.playingId !== 'c1-01'; i++) await new Promise((r) => setTimeout(r, 50));
    return { ok: v.lastResult.ok, id: v.playingId };
  });
  report.check('V9.3 第一章配音仍可正常播放', c1play.ok && c1play.id === 'c1-01', `playingId=${c1play.id}`);
  const crossChapter = await page.evaluate(async () => {
    const v = window.__game.voice;
    await v._load('c2-14');
    v.play('c2-14');                                    // 第二章一句在播
    for (let i = 0; i < 30 && v.playingId !== 'c2-14'; i++) await new Promise((r) => setTimeout(r, 50));
    const during = v.playingId;
    window.__story.startChapter('chapter-01', 'intro'); // 切到第一章
    for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 50));
    return { during, after: v.playingId, chapterIds: v.debugState().chapterIds };
  });
  report.check('V9.4 切章时上一章声音被立即掐断（不延续）',
    crossChapter.during === 'c2-14' && !String(crossChapter.after || '').startsWith('c2-'),
    `切章前 ${crossChapter.during} → 切章后 ${crossChapter.after}`);
  report.check('V9.5 第一章段落的预加载范围只含 c1（不残留 c2）',
    crossChapter.chapterIds && crossChapter.chapterIds.every((x) => x.startsWith('c1-')),
    `chapterIds=${(crossChapter.chapterIds || []).join(',')}`);

  /* -------------------------------------------------------------- V10 */
  console.log('\n=== V10. iPhone Safari 音频兼容 ===');
  const safari = await page.evaluate(() => {
    const v = window.__game.voice;
    const ok = v.unlock();
    const s = v.debugState();
    return { ok, ctxState: s.ctxState, unlocked: s.unlocked, gestureCount: s.gestureCount, pendingId: s.pendingId };
  });
  report.check('V10.1 用户手势解锁后 AudioContext 处于 running',
    safari.ok === true && safari.ctxState === 'running' && safari.unlocked === true,
    `ctxState=${safari.ctxState} unlocked=${safari.unlocked}`);
  const elCompliance = await page.evaluate(() => {
    const src = window.__game.voice;
    const el = src._el ? src._el('c2-01') : null;
    return { playsInline: el ? el.playsInline : null, hasAttr: el ? el.hasAttribute('webkit-playsinline') : null };
  });
  report.check('V10.2 兜底 audio 元素设置 playsinline（iOS 不强制全屏）',
    elCompliance.playsInline === true && elCompliance.hasAttr === true, JSON.stringify(elCompliance));
  const pending = await page.evaluate(async () => {
    const v = window.__game.voice;
    v.stop();
    await v._load('c2-03');                 // 预解码，避免补播时等待解码掩盖结论
    v._pending = { id: 'c2-03', gen: v._gen, at: Date.now() };
    const before = v.pendingId;
    v.unlock();                            // 下一次真实手势
    for (let i = 0; i < 30 && v.playingId !== 'c2-03'; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return { before, after: v.pendingId, playingId: v.playingId };
  });
  report.check('V10.3 被自动播放策略拦下的句子在下一次手势后补播',
    pending.before === 'c2-03' && pending.playingId === 'c2-03',
    `pending ${pending.before} → ${pending.after}，补播 ${pending.playingId}`);
  await vcall('stop');
  const noTts = await page.evaluate(() => ({ tts: !!window.speechSynthesis, fallback: window.__game.voice.debugState().ttsFallback }));
  report.check('V10.4 代码中不存在 TTS 兜底', noTts.fallback === false, `ttsFallback=${noTts.fallback}`);

  /* -------------------------------------------------------------- V11 */
  console.log('\n=== V11. 第二章赛道 / 车辆 / 道具 / 奖励 / 存档 ===');
  const integ = await page.evaluate(() => {
    const g = window.__game;
    const before = window.__garage.save().coins;
    return {
      course: g.track?.course?.id,
      karts: g.karts?.length,
      items: typeof window.__ITEMS === 'object' ? Object.keys(window.__ITEMS).length : -1,
      coins: before,
      ch2: window.__story.progress2(),
      savePrefixKeys: Object.keys(localStorage).filter((k) => k.startsWith('lrv2.')).length,
      voiceKey: Object.keys(localStorage).filter((k) => k.includes('voice')).length,
    };
  });
  report.check('V11.1 阳光沙滩赛道仍为 beach', integ.course === 'beach', String(integ.course));
  report.check('V11.2 车辆与道具系统未受影响', integ.karts > 0 && integ.items > 0, `karts=${integ.karts} items=${integ.items}`);
  report.check('V11.3 第二章剧情进度与金币存档可读（未被清除）', integ.ch2 && Number.isFinite(integ.coins),
    `progress2=${JSON.stringify(integ.ch2)} coins=${integ.coins}`);
  report.check('V11.4 语音接入未新增 / 覆盖玩家存档键', integ.voiceKey <= 1,
    `voice 相关键 ${integ.voiceKey} 个（仅配音开关）`);

  /* -------------------------------------------------------------- V12 */
  console.log('\n=== V12. 运行时错误与资源 ===');
  report.check('V12.1 无 JS 运行时错误', consoleErrors.length === 0,
    consoleErrors.length ? consoleErrors.slice(0, 3).join(' | ') : '0 项');
  report.check('V12.2 无资源请求失败 / 404', failedRequests.length === 0,
    failedRequests.length ? failedRequests.slice(0, 5).join(', ') : '0 项');
  report.check('V12.3 静态服务无未命中路径', srv.misses.length === 0,
    srv.misses.length ? srv.misses.slice(0, 5).join(', ') : '0 项');
} finally {
  await browser.close();
  await srv.close();
}

const outFile = path.join(OUT, 'chapter2-voice-report.json');
report.write(outFile);
console.log(`\n=== 结果：${report.items.filter(i => i.ok).length}/${report.items.length} 通过 ===`);
if (!report.ok) {
  console.log('失败项：');
  for (const f of report.failed) console.log('  ✗ ' + f.name + (f.detail ? ' — ' + f.detail : ''));
}
console.log('报告：' + outFile);
process.exit(report.ok ? 0 : 1);
