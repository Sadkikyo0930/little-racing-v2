import * as THREE from 'three';
import { Engine } from './core/engine.js';
import { Input } from './core/input.js';
import { Audio } from './core/audio.js';
import { MusicManager } from './audio/musicManager.js';
import { Environment } from './world/sky.js';
import { Track } from './world/track.js';
import { Terrain } from './world/terrain.js';
import { City } from './world/city.js';
import { COURSES, getCourse } from './world/courses.js';
import { Traffic } from './world/traffic.js';
import { Highway } from './world/highway.js';
import { BeachWorld } from './world/beach.js';
import { Ch2Lib, CH2_ASSETS } from './world/ch2/assets.js';
import { bakeClearance } from './world/clearance.js';
import { Kart, CameraRig } from './kart/kart.js';
import { CHARACTERS } from './kart/model.js';
import { AIDriver } from './ai/ai.js';
import { Particles } from './fx/particles.js';
import { ItemSystem, ITEMS } from './items/items.js';
import { Race, RaceState, formatTime } from './race/race.js';
import { WrongWayWatcher } from './race/wrongway.js';
import { HUD } from './ui/hud.js';
import { StoryUI } from './ui/storyUI.js';
import { VoiceManager } from './audio/voiceManager.js';
import { StoryDirector } from './story/director.js';
import { CHAPTER_01 } from './story/chapter1.js';
import { CHAPTER_02 } from './story/chapter2.js';
import {
  readChapter1, advanceChapter1, writeChapter1, chapter1Label, STORY_STATE,
  readChapter2, advanceChapter2, writeChapter2, chapter2Label,
  readChapter, advanceChapter, writeChapterDone, chapterLabelOf,
} from './story/progress.js';
import { TouchControls } from './core/touch.js';
import { isTouch } from './core/device.js';
import { GarageUI } from './garage/garageUI.js';
import { initViewport, onViewportResize, viewSize } from './ui/viewport.js';
import { initFullscreen, isStandalone, fsSupported, inFullscreen, toggleFullscreen } from './ui/fullscreen.js';
import * as Garage from './garage/save.js';
import {
  VEHICLES, getVehicle, vehicleState, canEquip, isDrivable, setAvailableOverride,
} from './garage/vehicles.js';
import { STUDY_ENABLED, studyStatus } from './garage/studyReward.js';

/* 测试钩子门控：VITE_TEST_HOOKS=1（测试构建）或 dev 服务器时为 true；
 * 正式 Pages 构建为 false，以下所有调试 / 模拟 / 自动化接口会被 tree-shake 掉。 */
const TEST_HOOKS = import.meta.env.VITE_TEST_HOOKS === '1' || import.meta.env.DEV;

/* ------------------------------------------------------------------ *
 * Old San Juan Kart — bootstrap and game state machine.
 * ------------------------------------------------------------------ */

const FIELD = 8;
// ?course=expreso picks a circuit before the selection UI exists on screen.
const course = getCourse(new URLSearchParams(location.search).get('course'));

/* ---------------------------- boot ------------------------------- *
 * The world is built procedurally and synchronously, which takes long
 * enough on a phone to look like a hung tab. Yielding two frames between
 * phases lets the loading screen actually repaint in between.           */
const bootFill = document.getElementById('bootFill');
const bootLabel = document.getElementById('bootLabel');
const bootBar = document.querySelector('.bootBar');

function paint() {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    // requestAnimationFrame never fires while the tab is hidden, so race it
    // against a timer — otherwise loading deadlocks forever if the player
    // switches apps or tabs part-way through the build.
    requestAnimationFrame(() => requestAnimationFrame(finish));
    setTimeout(finish, 120);
  });
}

async function phase(pct, label) {
  if (bootFill) bootFill.style.width = `${pct}%`;
  if (bootLabel) bootLabel.textContent = label;
  bootBar?.setAttribute('aria-valuenow', String(pct));
  await paint();
}

await phase(6, '启动引擎');
const engine = new Engine(document.getElementById('scene'));
const input = new Input();
const audio = new Audio();
/* 背景音乐：唯一入口。启动加载页不播放，等用户点击「开始游戏」才启动，
 * 这是 iOS Safari 允许出声的必要条件。 */
const music = new MusicManager();

await phase(18, '升起天空');
const env = new Environment(engine);

/* 贝壳湾的海面由 BeachWorld 自己铺（带水深图、浅滩色、白浪带）。
 * Environment 里那张 5 km 的旧海面高度同样是 -7.5 m，两张面完全重合，
 * 每帧互相抢深度 —— 海面会变成一块蓝白相间的碎斑。海滨赛道必须关掉它。 */
if (course.scenery === 'beach') env.ocean.visible = false;

/* 第二章的海滨资产（小屋 / 礁石 / 棕榈 / 木桥模块）是外部 GLB。
 * 必须在建 BeachWorld 之前读完 —— 木桥的桥板、栏杆、桥墩都要在构建时
 * 一次性摆好，无法等异步回调再补。
 * 读失败不阻塞开局：BeachWorld 会跳过对应道具并在控制台留下记录。 */
let ch2 = null;
if (course.scenery === 'beach') {
  await phase(24, '装载海滨资产');
  ch2 = await new Ch2Lib().load(document.baseURI, CH2_ASSETS, (done, total) => {
    if (bootLabel) bootLabel.textContent = `装载海滨资产 ${done}/${total}`;
  });
}

const SURFACE_LABEL = { asphalt: '柏油路', sand: '沙滩路面', adoquin: '石板路' };
await phase(34, `铺设${SURFACE_LABEL[course.surface] || '路面'}`);
const track = new Track(course);
engine.scene.add(track.group);

/* 第二章的沙地地形由 beach.js 自己铺（沙嘴、沙丘、河床、海床），
 * 第一章/高速仍然用原来的半岛地形。两边互不引用。 */
await phase(48, '塑形海岸');
const terrain = course.scenery === 'beach' ? null : new Terrain(track, engine.scene);

await phase(62, course.scenery === 'city' ? '搭建海滨街区'
  : course.scenery === 'beach' ? '铺开贝壳湾沙滩' : '架起高速公路');
const city = course.scenery === 'city' ? new City(track, engine.scene) : null;
const highway = course.scenery === 'highway' ? new Highway(track, engine.scene, terrain) : null;
const beach = course.scenery === 'beach' ? new BeachWorld(track, engine.scene, ch2) : null;

await phase(84, '设置护栏');
const traffic = course.traffic ? new Traffic(track, engine.scene, course.traffic) : null;
track.clearance = bakeClearance(track, city
  ? [city.group]
  : [track.obstacles, highway?.group, beach?.obstacles].filter(Boolean));
if (import.meta.env?.DEV && track.clearance.intrusions.length) {
  console.warn(`[clearance] ${track.clearance.intrusions.length} samples where art intrudes on the road`,
    track.clearance.intrusions.slice(0, 12));
}

await phase(94, '赛车就位');
const particles = new Particles(engine.scene);
const rig = new CameraRig(engine.camera);
const hud = new HUD(document.getElementById('ui'));
/* 剧情层的 DOM 必须在 HUD 之后建 —— HUD 构造时会把 #ui 的 innerHTML 整个换掉。 */
const storyUI = new StoryUI(document.getElementById('ui'));
/* 车库层同理：必须在 HUD 之后。 */
const garageUI = new GarageUI(document.getElementById('ui'));

const touch = isTouch ? new TouchControls(input, document.getElementById('ui')) : null;
/* 配音：只播固定的本地文件，没有任何 SpeechSynthesis 回退。 */
const voice = new VoiceManager();
const wrongWay = new WrongWayWatcher();

const game = {
  engine, track, city, beach, env, particles, rig, audio, music, hud, terrain, input, touch,
  voice, storyUI, wrongWay, ch2,
  karts: [], drivers: [], player: null, race: null, items: null,
  time: 0, hazards: [], state: 'menu', mode: 'kids',
  /** 测试开关：玩家车由 AI 接管。产品流程里永远是 false。 */
  autopilot: false,
  /** 故事模式的一局：只有真正跑完才会播结尾剧情 */
  storyRun: false,
  storyStage: null,
  /** 第二章：本局故事比赛是否真的跑完了三圈。只有它为真时，进入结尾才会
   *  发放首次通关奖励 —— 杜绝「只改网页参数 / 直接跳结尾」白嫖 500 金币。 */
  _storyRaceFinished: false,
};

/* ---------------------- 视口 / 全屏（必须在 game 之后） ---------------------- */
/* 视口：把 visualViewport 的实测高度写进 --vvh，并在工具栏收放、旋转、
 * 进出全屏时重新量一次。
 *   · UI 层高度用它（不用裸 100dvh），底部按钮不会被 Safari 工具栏压住；
 *   · 渲染器也用它，canvas 与可见区严格等高，画面不会被裁。
 *
 * 放在 game 之后是因为回调里要读 game.state —— 写在前面的话，
 * 启动过程中若恰好触发一次 resize 会撞上 TDZ。 */
initViewport();
onViewportResize(() => {
  engine.resize();
  relayoutGarageViews();
});

/* 全屏入口：首页左上角 + 车库顶栏。iPhone Safari 不支持元素全屏时
 * 会弹出「添加到主屏幕」三步指引，不假装已经全屏。 */
const fullscreen = initFullscreen({
  buttons: [document.getElementById('fsBtn'), garageUI.el.fsBtn],
  onChange: () => {
    // 进出全屏后尺寸会变，等一帧再量，避免量到过渡中的尺寸
    requestAnimationFrame(() => {
      engine.resize();
      relayoutGarageViews();
    });
  },
});

/** 车库层重排。函数声明会提升，供上面的回调使用。 */
function relayoutGarageViews() {
  if (game.state !== 'garage') return;
  garageUI.relayout();
  garageStage?.resize();
}

/* --------------------------- field setup -------------------------- */
/* ================================================================== *
 * 主角 A + 车库里的赛车
 *
 *   · 红色赛车     —— 原来的程序化卡丁车，一行代码没动（默认赠送）
 *   · 海龟冲浪车   —— 外部 GLB，完成第一章解锁（老存档自动继承）
 *   · 闪电小摩托   —— 外部 GLB（人 + 车同文件），1500 金币购买
 *   · 学习奖励车   —— 本阶段只有卡片，没有可驾驶模型
 *
 * 车型不再在首页选，改成进「我的车库」里挑。当前车辆存在
 * lrv2.garage.current，旧键 lrv2.vehicle 只做向后兼容写入。
 *
 * 三个模型文件都只在真正用到时才动态 import：不选就不下载，
 * 首屏 / 剧情 / 原有比赛完全不受影响。加载失败或还没加载完，就退回红色赛车
 * + 原版程序化驾驶员 —— 不卡、不假称成功。
 * ================================================================== */
const VEHICLE_PREF_KEY = Garage.LEGACY.vehicle;     // 旧键：仍写（回滚友好），但读走车库存档
const LEGACY_DRIVER_KEY = Garage.LEGACY.driverSkin;  // 旧版开关留下的键：只保留，不清除
/* 角色格的下标：0 = 勇敢小绿（原版默认），1 = 闪电小红（红色那台）。
   海龟冲浪车 / 闪电小摩托沿用闪电小红的性能数据，所以「驾驶物理」和红车
   完全一致 —— 新载具只换外观和操控表现，不改平衡。 */
const RED_KART_INDEX = 1;
/* 海龟车的「角色数据」：性能整份照抄闪电小红 —— 驾驶物理一点都不能变，
 * 只换显示用的名字和排行榜圆点颜色。 */
const TURTLE_CHARACTER = Object.freeze({
  ...CHARACTERS[RED_KART_INDEX],
  name: '海龟冲浪车',
  tag: '海龟',
  body: 0x36c98f,
  accent: 0xffd23f,
});
/** 闪电小摩托：同样照抄闪电小红的性能，只换显示信息。 */
const MOTO_CHARACTER = Object.freeze({
  ...CHARACTERS[RED_KART_INDEX],
  name: '闪电小摩托',
  tag: '小摩托',
  body: 0x1f6fe0,
  accent: 0xffd23f,
});
/** 有独立 3D 模型的载具（其余走原来的程序化卡丁车）。 */
const MODEL_VEHICLES = Object.freeze(['turtle', 'moto']);

let heroMod = null;
let heroLoading = null;
let turtleMod = null;
let turtleLoading = null;
let motoMod = null;
let motoLoading = null;

/** 车库存档的迁移必须在这里跑完 —— 后面所有读 current / owned 都依赖它。 */
const MIGRATION = Garage.migrate();
if (MIGRATION.migrated && MIGRATION.steps.length) {
  console.info('[garage] 存档迁移：', MIGRATION.steps.join('；'));
}
if (MIGRATION.pending) {
  /* 迁移算出来了、但没写进存储（配额满 / 无痕模式）。
   * 这一局仍然能用继承来的车；版本号没有落盘，下次启动会重跑一遍修复。 */
  console.warn('[garage] 迁移结果没能持久化，下次启动会重试：', MIGRATION.steps.join('；'));
}

/* 奖励事务修复（第四阶段上线前）：
 *   1) 旧存档兼容：只有 firstClear.granted、没有 reward-ledger 的，迁移成已完成事务；
 *   2) 自动恢复：若上次发奖中途写入失败（金币/成就没落盘），这里只补全缺失部分，
 *      绝不重复发。生产环境也跑（这是安全修复，不是测试钩子）。 */
Garage.migrateRewards();
Garage.recoverRewardTransactions();

function readVehiclePref() {
  const id = Garage.getCurrent();
  if (!id || id === 'red') return 'red';
  // 存档里写着某辆车、但实际上没拥有 / 没模型（比如导入了一份坏存档）→ 回退红车
  if (!canEquip(id, Garage.load()) || !isDrivable(id)) return 'red';
  return id;
}

function writeVehiclePref(v) {
  const val = MODEL_VEHICLES.includes(v) ? v : 'red';
  const before = Garage.getCurrent();
  const ok = Garage.setCurrent(val, { drivable: isDrivable(val) });
  if (!ok) return false;
  // 向后兼容：旧版本只认 lrv2.vehicle。只在真的变了的时候写，
  // 避免每次启动都糊一遍 localStorage。
  // 写它不会影响车库存档，也不会让「旧玩家继承海龟车」的迁移逻辑出错
  //（迁移只看 lrv2.garage.meta 的 migratedAt）。
  if (before !== val) {
    try { globalThis.localStorage?.setItem(VEHICLE_PREF_KEY, val); } catch { /* 忽略 */ }
  }
  return true;
}

function ensureHeroA() {
  if (heroMod) return Promise.resolve(true);
  if (heroLoading) return heroLoading;
  heroLoading = (async () => {
    try {
      const mod = await import('./kart/heroA.js');
      const proto = await mod.loadHeroA();
      if (!proto) { heroLoading = null; return false; }
      heroMod = mod;
      heroLoading = null;
      return true;
    } catch (err) {
      console.warn('[heroA] 驾驶模型加载失败，本局仍用原版主角：', err?.message || err);
      heroLoading = null;
      return false;
    }
  })();
  return heroLoading;
}

function ensureTurtleKart() {
  if (turtleMod) return Promise.resolve(true);
  if (turtleLoading) return turtleLoading;
  turtleLoading = (async () => {
    try {
      const mod = await import('./kart/turtleKart.js');
      const proto = await mod.loadTurtleKart();
      if (!proto) { turtleLoading = null; return false; }
      turtleMod = mod;
      turtleLoading = null;
      return true;
    } catch (err) {
      console.warn('[turtleKart] 海龟车加载失败，本局仍用红色赛车：', err?.message || err);
      turtleLoading = null;
      return false;
    }
  })();
  return turtleLoading;
}

function ensureMotoKart() {
  if (motoMod) return Promise.resolve(true);
  if (motoLoading) return motoLoading;
  motoLoading = (async () => {
    try {
      const mod = await import('./kart/motoKart.js');
      const proto = await mod.loadMotoKart();
      if (!proto) { motoLoading = null; return false; }
      motoMod = mod;
      motoLoading = null;
      return true;
    } catch (err) {
      console.warn('[motoKart] 闪电小摩托加载失败，本局仍用红色赛车：', err?.message || err);
      motoLoading = null;
      return false;
    }
  })();
  return motoLoading;
}

function buildField(playerCharIndex) {
  for (const k of game.karts) k.dispose?.();
  game.items?.dispose?.();
  game.karts.length = 0;
  game.drivers.length = 0;

  /* 海龟车 / 闪电小摩托只在玩家这一台上用；对手全部保持原来的程序化卡丁车。
   * 模型没到位就退回红车 —— 宁可开红车，也不给一台缺驾驶员/缺轮子的车。 */
  const want = MODEL_VEHICLES.includes(hud.vehicle) ? hud.vehicle : null;
  const wantTurtle = want === 'turtle';
  const wantMoto = want === 'moto';
  const turtleReady = wantTurtle && !!turtleMod && !!heroMod;
  const motoReady = wantMoto && !!motoMod;
  if (wantTurtle && !turtleReady) {
    console.warn('[turtleKart] 模型未就绪，本局改用红色赛车');
  }
  if (wantMoto && !motoReady) {
    console.warn('[motoKart] 模型未就绪，本局改用红色赛车');
  }

  const order = [playerCharIndex, ...CHARACTERS.map((_, i) => i).filter((i) => i !== playerCharIndex)];
  for (let i = 0; i < FIELD; i++) {
    const ci = order[i % order.length];
    const isPlayer = i === 0;
    /* 主角 A 只坐玩家的车：对手仍然是原来的程序化驾驶员。
     * 座位参数随车不同：红车用默认值，海龟车用它自己的标定。
     * 闪电小摩托的骑手是烘在同一个 GLB 里的，不需要（也不能）再叠一个。 */
    const useTurtle = turtleReady && isPlayer;
    const useMoto = motoReady && isPlayer;
    const driver = isPlayer && heroMod && !useMoto
      ? heroMod.createHeroADriver(useTurtle ? turtleMod.TURTLE_SEAT : undefined)
      : null;
    /* 海龟车 / 摩托把主角一起挂进自己的节点树，所以这里不再把 driver 交给 Kart。 */
    const model = useMoto ? motoMod.createMotoModel()
      : useTurtle ? turtleMod.createTurtleModel(driver)
        : null;
    const char = useMoto ? MOTO_CHARACTER : useTurtle ? TURTLE_CHARACTER : CHARACTERS[ci];
    const kart = new Kart(engine.scene, char, {
      isPlayer, index: i, mode: game.mode,
      driver: model ? null : driver,
      model,
      course,
    });
    game.karts.push(kart);
    if (!isPlayer) {
      const diff = 1 + Math.floor((i / FIELD) * 2.6);
      game.drivers.push(new AIDriver(kart, track, Math.min(3, diff)));
    }
  }
  game.player = game.karts[0];

  game.items = new ItemSystem(engine.scene, track, game.karts, particles);
  game.hazards = game.items.hazards;
  game.items.onEvent = onItemEvent;

  game.race = new Race(track, game.karts, { laps: course.laps, onEvent: onRaceEvent, introDuration: 5.5 });
}

/* ----------------------------- events ----------------------------- */
function onItemEvent(kind, kart) {
  const p = kart && (kart.position || (kart.isVector3 ? kart : null));
  const near = !!p && p.distanceTo(game.player.position) < 46;
  switch (kind) {
    case 'pickup': if (near) audio.pickup(); break;
    case 'itemReady': audio.itemReady(); break;
    case 'boost':
      if (near) audio.boost();
      if (kart === game.player) rig.addShake(0.35);
      break;
    case 'throw': if (near) audio.throwItem(); break;
    case 'hit':
      if (near) audio.hit();
      if (kart === game.player) { rig.addShake(0.9); hud.toast('哎呀，被撞到啦！', 'bad'); }
      break;
    case 'explode': if (near) audio.explode(); break;
    case 'horn': if (near) audio.horn(); break;
    case 'star':
      if (kart === game.player) hud.toast('我变强啦！', 'good');
      if (near) audio.boost();
      break;
    case 'huracan':
      if (kart === game.player) hud.toast('旋风出击！', 'good');
      audio.explode();
      rig.addShake(0.7);
      break;
  }
}

function onRaceEvent(kind, arg) {
  switch (kind) {
    case 'countdown': hud.countdown(arg); audio.count(arg); audio.setMusicState('countdown'); break;
    case 'go': hud.go(); audio.go(); audio.setMusicState('race'); break;
    case 'rocketStart':
      if (arg === game.player) { hud.toast('火箭起步！', 'good'); rig.addShake(0.5); }
      break;
    case 'lap':
      if (arg === game.player) {
        const left = game.race.laps - arg.lap;
        hud.lapFlash(left === 1 ? '最后一圈' : `第 ${arg.lap + 1} 圈`);
        audio.lap();
        if (left === 1) audio.setMusicState('finalLap');
      }
      break;
    case 'respawn':
      if (arg === game.player) hud.toast('回到赛道', '');
      break;
    case 'finish':
      if (arg === game.player) { audio.setMusicState('finished'); audio.finish(); }
      break;
    case 'raceOver': {
      game.state = 'results';
      document.documentElement.classList.remove('in-race');
      const rank = game.player.finalRank || game.player.rank || 1;

      /* 金币结算 —— 只在这里发，别处没有第二条发钱路径。
       *
       *   · 必须真的跑完（finished），中途退出走不到这个事件；
       *   · 每局有唯一 raceId，同一局重复结算会被 save.js 挡掉，
       *     所以刷新结算页 / 反复点按钮都不会加钱；
       *   · 故事模式也发（同样是三圈正式比赛），只是不显示结算面板。 */
      const reward = Garage.claimRaceReward({
        raceId: game.raceId,
        rank,
        finished: !!game.player.finished,
        note: `第 ${rank} 名`,
      });
      game.lastReward = reward;
      if (reward.granted) {
        hud.setCoins(reward.coins);
        console.info(`[garage] 比赛奖励 +${reward.amount}，余额 ${reward.coins}`);
      }

      if (game.storyRun) {
        /* 故事模式：不弹传统的成绩榜，直接进结尾剧情。
         * 名次和总时间会放在结尾对白的标题旁，所以信息没丢。
         * 注意这里 game.storyRun 一旦在 startStory() 里被清掉，
         * 中途退出（quitStoryRace / goHome）就绝不会再触发结尾。 */
        hud.hideHUD();
        touch?.show(false);
        hud.setQuitVisible(false);
        wrongWay.reset();
        music.play('home');            // 比赛曲淡出，恢复剧情 / 首页曲
        if (game.storyChapter?.id === 'chapter-02') {
          storyResultLine = `已找到冠军奖杯！　本次成绩：第 ${rank} 名 · ${formatTime(game.race.raceTime)}`;
          game._storyRaceFinished = true;   // ← 只有真正跑完第二章比赛，结尾才会发奖励
        } else {
          storyResultLine = `本次成绩：第 ${rank} 名 · ${formatTime(game.race.raceTime)}`
            + (reward.granted ? ` · +${reward.amount} 金币` : '');
        }
        setTimeout(() => {
          if (game.storyRun) startStory('ending');
        }, 1600);
      } else {
        music.stop(true);              // 自由比赛：比赛曲淡出 1 秒
        setTimeout(() => {
          touch?.show(false);
          hud.results(game.race, game.player, restart, goHome, reward);
        }, 2200);
      }
      break;
    }
  }
}

/* ------------------------------ flow ------------------------------ */
async function startRace(charIndex) {
  game.mode = hud.gameMode || 'kids';
  voice.mode = 'race';
  /* 模型先到位再建车，否则这一局会静默退回红车，玩家会以为车库没生效。
   * 三辆车里红车是程序化的，海龟车和摩托各要自己的 GLB（前两辆还要主角 A）。 */
  let want = MODEL_VEHICLES.includes(hud.vehicle) ? hud.vehicle : null;
  /* 兜底：装备的车必须真的拥有、真的有模型。
   * 界面上点不出这个状态（没拥有的车装不上），但存档可以被导入覆盖，
   * 所以比赛入口再查一次 —— 未拥有的车绝不能下赛道。 */
  if (want && (!canEquip(want, Garage.load()) || !isDrivable(want))) {
    console.warn(`[garage] ${want} 未拥有或不可驾驶，本局改用红色赛车`);
    hud.setVehicle('red');
    want = null;
  }
  if (want === 'moto') {
    await ensureMotoKart();
  } else {
    await ensureHeroA();
    if (want === 'turtle') await ensureTurtleKart();
  }
  buildField(want ? RED_KART_INDEX : charIndex);
  // 车队是全新的，上一局缓存的玩家自动驾驶一定绑在别的车上，直接丢弃
  game.playerAuto = null;
  /* 这一局的唯一 id：金币结算靠它去重，重开结算 / 刷新都不会重复加钱。 */
  game.raceId = Garage.makeRaceId();
  game.lastReward = null;
  game.state = 'race';
  hud.hideTitle?.();
  rig.reset?.();
  hud.showHUD();
  hud.hideResults();
  hud.setMusicPanel(false);
  hud.setQuitVisible(game.storyRun);   // 只有故事模式才给「退出比赛」
  wrongWay.reset();
  hud.wrongWay(false);
  music.setDuck(false);
  voice.stop();
  touch?.show(true);
  document.documentElement.classList.add('in-race');
  // 进入比赛 → 切换比赛主题曲（约 1 秒淡出淡入）
  music.play('race');
  audio.setIdle(false);
  // Little Racing V2 — wire the on-screen "back to track" button (touch) so a
  // stuck child can recover with one tap.
  if (touch) touch.onReset = () => {
    if (game.race && game.player && !game.player.finished) game.race.respawn(game.player);
  };
  audio.init();
  audio.resume();
  audio.setMusicState('countdown');
}

function restart() {
  startRace(hud.selected);
}

/** 返回首页：软返回而不重载。重载会打断音频、iOS Safari 又需要一次新的
 *  用户手势才能重新出声，做不到「返回首页恢复首页曲」。游戏本身在 menu
 *  状态下本来就有完整的跳过逻辑（fixedUpdate/frameUpdate 都直接 return）。 */
function goHome() {
  game.state = 'menu';
  voice.mode = 'menu';
  game.storyRun = false;          // 回首页 = 放弃这一局故事，结尾剧情绝不会再触发
  touch?.show(false);
  audio.setIdle(true);
  hud.hideHUD();
  hud.hideResults();
  hud.setMusicPanel(false);
  hud.setQuitVisible(false);
  hud.wrongWay(false);
  document.documentElement.classList.remove('in-race');
  storyUI.hide();
  storyUI.fade(0, 10);
  garageUI.hide();
  engine.useWorld();
  director?.stop();
  director = null;
  voice.stop();
  music.setDuck(false);
  music.play('home');
  audio.setMusicState('menu');
  // 把相机放回菜单机位
  const pose = track.startPose(0);
  engine.camera.position.copy(pose.position).add(new THREE.Vector3(0, 7, 0))
    .sub(pose.forward.clone().multiplyScalar(16));
  engine.camera.lookAt(pose.position.clone().add(new THREE.Vector3(0, 2, 0)));
  showHomeTitle();
}

/**
 * 章节 → 当前世界需要的赛道 id。两章用不同赛道，世界在启动时一次性建好，
 * 切章必须重载页面换世界（和「选不同赛道重载」同一条路）。
 */
function chapterForCourse(id) {
  return id === 'beach' ? CHAPTER_02 : CHAPTER_01;
}

/** 进入某章的开场剧情；若当前世界不是该章赛道，重载到正确世界再自动开场。 */
function enterChapter(chapter) {
  const want = chapter.courseId;
  if (course.id !== want) {
    // 带上 chapter 标记，boot 读完世界后自动 startStory 本章开场。
    location.search = `?course=${want}&chapter=${chapter.id}`;
    return;
  }
  startStory('intro', chapter);
}

/** 首页（含两章独立入口与各自进度）。 */
function showHomeTitle() {
  const p1 = readChapter1();
  const p2 = readChapter2();
  const ch1Done = p1.state === 'done';
  hud.setCoins(Garage.getCoins());       // 首页车库按钮上的余额
  hud.setVehicle(hud.vehicle);           // 角色格下标与车型保持一致
  hud.showTitle(onStart, {
    onStory: () => enterChapter(CHAPTER_01),
    storyLabel: `第一章 · ${chapter1Label(p1.state)}`,
    storyState: p1.state,
    // 第二章：第一章通关后才解锁；赛道是 beach，跨世界必须重载。
    onStory2: () => enterChapter(CHAPTER_02),
    storyLabel2: ch1Done ? `第二章 · ${chapter2Label(p2.state)}` : '第二章 · 先通关第一章',
    storyState2: p2.state,
    storyDisabled2: !ch1Done,
  });
  if (pendingUnlockToast) {
    const msg = pendingUnlockToast;
    pendingUnlockToast = '';
    setTimeout(() => hud.toast(msg, 'good'), 420);
  }
  if (pendingAchievement) {
    console.info('[garage] 成就解锁：', pendingAchievement.name);
    pendingAchievement = null;
  }
}

/** 首次点击「开始游戏」——iOS Safari 要求的那一次明确用户交互。
 *  首页 / 赛道选择 / 赛车手选择共用首页主题曲，重复 play('home') 不会重启。 */
function onStart() {
  music.unlock();
  music.play('home');
  audio.init();
  audio.resume();
  audio.setMusicState('menu');
  hud.showCourses(COURSES, course.id, (id) => {
    if (id !== course.id) {
      // Different circuit: rebuild the world from scratch on the way in.
      location.search = `?course=${encodeURIComponent(id)}`;
      return;
    }
    music.play('home');   // 同一首：不从头播放
    /* 海龟冲浪车、闪电小摩托只有一辆、性能固定，不需要再挑角色格里的车手。
     * 红色赛车沿用原来的选人流程，一步都没变。 */
    if (MODEL_VEHICLES.includes(hud.vehicle)) {
      startRace(RED_KART_INDEX);
      return;
    }
    hud.showSelect({ confirm: (i) => startRace(i) });
  });
}

/* ================================================================== *
 * 我的车库
 *
 *   首页「我的车库」 → 3D 展台 + 卡片 + 解锁面板 → 装备 / 购买 → 返回首页
 *
 * 3D 舞台是独立 Scene，玩法同剧情：通过 engine.useScene() 换过去，
 * 比赛场景一个对象都不动。舞台模块按需动态 import，不进首屏。
 * ================================================================== */
let garageStage = null;
let garageStagePromise = null;
let garageStageFailed = null;

async function ensureGarageStage() {
  if (garageStage) return garageStage;
  if (garageStagePromise) return garageStagePromise;
  garageStagePromise = (async () => {
    try {
      const mod = await import('./garage/stage.js');
      const stage = new mod.GarageStage(engine);
      garageStage = stage;
      return stage;
    } catch (err) {
      garageStageFailed = String(err?.message || err);
      console.warn('[garage] 3D 车库舞台创建失败，车库仍然可用：', garageStageFailed);
      return null;
    }
  })();
  return garageStagePromise;
}

async function openGarage() {
  if (game.state === 'garage') return;
  game.state = 'garage';
  voice.mode = 'menu';
  hud.hideTitle();
  hud.hideHUD();
  hud.hideResults();
  hud.setMusicPanel(false);
  hud.setQuitVisible(false);
  hud.wrongWay(false);
  touch?.show(false);
  document.documentElement.classList.remove('in-race');
  music.play('home');                 // 车库沿用首页曲，不另起一首
  audio.setMusicState('menu');
  audio.setIdle(true);

  garageUI.show({
    save: Garage.snapshot(),
    selectedId: readVehiclePref(),
    storyState: readChapter1().state,
  });
  garageUI.setStageFailed(false);

  /* 存档写不进去（无痕模式 / 配额满）：明确告诉家长，不假装存好了。
   * 这一局照常能玩，只是关掉页面后金币和车辆会回到上次成功保存的状态。 */
  const health = Garage.persistHealth();
  garageUI.setSaveWarn(health.ok ? '' : '这台浏览器现在存不下存档（可能是无痕模式或空间已满）。可以照常玩，但关掉页面后金币和赛车会退回上一次保存的样子。');

  const stage = await ensureGarageStage();
  if (game.state !== 'garage') return;          // 加载期间用户已经退出
  if (!stage) {
    garageUI.setStageFailed(true, garageStageFailed || 'no-stage');
    return;
  }

  engine.useScene(stage.scene, stage.camera);
  stage.setFocusRect(garageUI.measureShowRect());
  await loadGarageCar(garageUI.selectedId);
}

/** 把某辆车放上展台。没模型的车（小摩托 / 学习车）放一个灰色剪影，不假装有车。 */
async function loadGarageCar(id) {
  if (!garageStage || game.state !== 'garage') return;
  const ok = await garageStage.show(id);
  if (game.state !== 'garage') return;
  if (!ok) {
    garageUI.setStageFailed(true, 'no-model');
    return;
  }
  garageUI.setStageFailed(false);
  garageStage.setFocusRect(garageUI.measureShowRect());
}

function closeGarage() {
  if (game.state !== 'garage') return;
  garageUI.hide();
  engine.useWorld();
  game.state = 'menu';
  const pose = track.startPose(0);
  engine.camera.position.copy(pose.position).add(new THREE.Vector3(0, 7, 0))
    .sub(pose.forward.clone().multiplyScalar(16));
  engine.camera.lookAt(pose.position.clone().add(new THREE.Vector3(0, 2, 0)));
  showHomeTitle();
}

/** 点卡片 = 预览（不装备）。 */
async function selectGarageVehicle(id) {
  const v = getVehicle(id);
  if (!v) return;
  garageUI.setSelected(id);
  await loadGarageCar(id);
}

/** 装备 —— 只有「已拥有 + 有模型」才成功。 */
function equipVehicle(id) {
  const v = getVehicle(id);
  if (!v) return;
  if (!canEquip(id, Garage.load())) {
    garageUI.toast('还没有这辆车呢', 'bad');
    garageUI.update(Garage.snapshot(), { storyState: readChapter1().state });
    return;
  }
  if (!isDrivable(id)) {
    garageUI.toast('这辆车还不能下赛道', 'bad');
    return;
  }
  if (!writeVehiclePref(id)) {
    garageUI.toast('暂时换不了，再试一次', 'bad');
    return;
  }
  hud.setVehicle(id);
  ensureHeroA();
  if (id === 'turtle') ensureTurtleKart();
  if (id === 'moto') ensureMotoKart();
  garageUI.update(Garage.snapshot(), { storyState: readChapter1().state });
  garageUI.toast(`已换上${v.name}`, 'good');
}

/** 金币购买 —— 扣款与写所有权是原子的（见 save.js purchaseVehicle）。 */
function buyVehicle(id) {
  const v = getVehicle(id);
  if (!v || v.unlock.type !== 'coins') return;
  const r = Garage.purchaseVehicle(id, v.unlock.price);
  if (!r.ok) {
    const msg = r.reason === 'not-enough-coins' ? '金币还不够哦'
      : r.reason === 'already-owned' ? '这辆车已经是你的啦'
        : '现在买不了';
    garageUI.toast(msg, 'bad');
    garageUI.update(Garage.snapshot(), { storyState: readChapter1().state });
    return;
  }
  garageUI.update(Garage.snapshot(), { storyState: readChapter1().state });
  garageUI.flashCoins(-v.unlock.price);
  garageUI.toast(`买到了${v.name}！`, 'good');
  hud.setCoins(Garage.getCoins());

  /* 买到就直接换上：小孩不必再找第二下点「使用这辆车」。
   * 之后仍然可以自由切回别的车（装备是独立的操作）。 */
  if (isDrivable(id) && writeVehiclePref(id)) {
    hud.setVehicle(id);
    ensureHeroA();
    if (id === 'moto') ensureMotoKart();
    if (id === 'turtle') ensureTurtleKart();
    garageUI.update(Garage.snapshot(), { storyState: readChapter1().state });
  }
}

/* --------------------------- 存档导出/导入 --------------------------- */
function exportGarageSave(mode) {
  const text = Garage.exportSave();
  garageUI.setSaveText(text);

  if (mode === 'download') {
    try {
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = Garage.exportFileName();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      garageUI.setSaveMsg('存档文件已保存，记得放到安全的地方', 'good');
    } catch {
      garageUI.setSaveMsg('这台设备不支持存文件，请用「复制存档」', 'bad');
    }
    return;
  }

  const fallback = () => garageUI.setSaveMsg('存档已生成在下面，长按全选复制', 'good');
  try {
    const p = navigator.clipboard?.writeText(text);
    if (p?.then) p.then(() => garageUI.setSaveMsg('已复制，粘贴到备忘录里保存好', 'good'), fallback);
    else fallback();
  } catch {
    fallback();
  }
}

function importGarageSave(text, { force = false } = {}) {
  const r = Garage.importSave(text, 'replace', { allowNoBackup: force });
  if (!r.ok) {
    /* 备份没写成功：不覆盖，先把风险摊开让家长决定。
     * 这里刻意返回而不是「再试一次」—— 备份失败往往就是空间满了，
     * 再试一次只会把原来的存档挤掉。 */
    if (r.reason === 'backup-failed') {
      garageUI.showRisk(
        true,
        '备份没有保存成功（这台浏览器可能空间满了）。继续导入会直接覆盖现在的金币和赛车，而且没法撤销。',
      );
      garageUI.setSaveMsg('备份失败：先别导入，或者确认风险后再继续', 'bad');
      return;
    }
    const msg = r.reason === 'bad-json' ? '这段文字不是有效的存档'
      : r.reason === 'not-our-save' ? '这不是小小赛车的存档'
        : r.reason === 'too-new' ? '存档来自更新版本的游戏，先更新游戏再导入'
          : '导入失败，存档没有变化';
    garageUI.setSaveMsg(msg, 'bad');
    return;
  }
  garageUI.update(Garage.snapshot(), { storyState: readChapter1().state });
  hud.setCoins(Garage.getCoins());
  /* persist: 存档里的 current 若指向一辆没拥有 / 没模型的车（导入坏了、
   * 或者被手动改过），这里会把它修正回红车并写盘 —— 否则界面显示红车、
   * 存档里却一直留着 turtle，下次解锁时又会莫名其妙跳回去。 */
  applyVehicle(readVehiclePref(), { persist: true });
  loadGarageCar(garageUI.selectedId);
  garageUI.setSaveMsg(
    r.forced
      ? `导入成功：${Garage.getCoins()} 金币。这次没有备份，无法回滚。`
      : `导入成功：${Garage.getCoins()} 金币。导入前的存档已自动备份。`,
    'good',
  );
}

function restoreGarageBackup() {
  const list = Garage.listBackups();
  if (!list.length) {
    garageUI.setSaveMsg('还没有备份。导入存档时会自动备份一份。', 'bad');
    return;
  }
  const r = Garage.restoreBackup(list[0].key);
  if (!r.ok) {
    garageUI.setSaveMsg('恢复失败，存档没有变化', 'bad');
    return;
  }
  garageUI.update(Garage.snapshot(), { storyState: readChapter1().state });
  hud.setCoins(Garage.getCoins());
  /* persist: 存档里的 current 若指向一辆没拥有 / 没模型的车（导入坏了、
   * 或者被手动改过），这里会把它修正回红车并写盘 —— 否则界面显示红车、
   * 存档里却一直留着 turtle，下次解锁时又会莫名其妙跳回去。 */
  applyVehicle(readVehiclePref(), { persist: true });
  loadGarageCar(garageUI.selectedId);
  const stamp = list[0].key.split('.').pop();
  garageUI.setSaveMsg(
    `已恢复到 ${stamp}，金币 ${r.coins}`
      + (r.backedUp ? '（回滚前的状态也留了一份）' : '（没能备份回滚前的状态）'),
    'good',
  );
}

/* 车库界面事件（UI 只发事件，业务都在这里） */
garageUI.onBack = () => closeGarage();
garageUI.onSelect = (id) => selectGarageVehicle(id);
garageUI.onEquip = (id) => equipVehicle(id);
garageUI.onBuy = (id) => buyVehicle(id);
garageUI.onGoStory = () => { closeGarage(); enterChapter(chapterForCourse(course.id)); };
garageUI.onGeometry = (rect) => garageStage?.setFocusRect(rect);
garageUI.onExport = (mode) => exportGarageSave(mode);
garageUI.onImport = (text) => importGarageSave(text);
garageUI.onImportForce = (text) => importGarageSave(text, { force: true });
garageUI.onRestore = () => restoreGarageBackup();
garageUI.onAchievements = () => {
  garageUI.renderAchievements(Garage.getAchievements());
  garageUI.setAchPanel(true);
};

/** 首页「我的车库」按钮。 */
hud.onGarage = () => openGarage();

/* 存档一变，首页金币与车库界面都跟着刷新（不需要各自轮询）。 */
Garage.subscribe((snap) => {
  hud.setCoins(snap.coins);
  if (garageUI.visible) garageUI.update(snap, { storyState: readChapter1().state });
});

/** 屏幕尺寸变化：车库要么重排卡片，要么重算 3D 展示区。 */
addEventListener('resize', () => {
  if (game.state !== 'garage') return;
  garageUI.relayout();
  garageStage?.resize();
});
addEventListener('orientationchange', () => {
  setTimeout(() => {
    if (game.state !== 'garage') return;
    garageUI.relayout();
    garageStage?.resize();
  }, 320);
});

/* ================================================================== *
 * 第一章《海滨赛车节开幕》— 剧情流程
 *
 *   首页「故事冒险」 → 开场剧情（3 句） → 出发比赛
 *   → 跑完三圈 → 结尾剧情（2 句） → 再来一局 / 返回首页
 *
 * 3D 舞台（StoryStage）是**按需动态 import** 的：玩家不点故事冒险，
 * 两个 GLB 和整个剧情场景一个字节都不会下载，首屏完全不受影响。
 * ================================================================== */

let storyStage = null;
let stagePromise = null;
let stageLoadFailed = null;
let director = null;
let storyResultLine = '';
/** 剧情解锁了新车，回到首页时提示一次（剧情层里没有 toast 的位置）。 */
let pendingUnlockToast = '';
/** 剧情解锁了成就（第二章首通 → 阳光沙滩冠军），回到首页时可展示成就墙。 */
let pendingAchievement = null;

async function ensureStage() {
  if (storyStage) return storyStage;
  if (stagePromise) return stagePromise;
  stagePromise = (async () => {
    try {
      const mod = await import('./story/stage.js');
      const stage = new mod.StoryStage(engine);
      // 只加载本章角色：第一章 = 爷爷 + 小红，第二章再多加载主角 A 站姿。
      const charIds = game.storyChapter?.characters || CHAPTER_01.characters;
      await stage.load(charIds, (name) => {
        storyUI.setBusy(true);
        storyUI.setText(`正在载入${name}……`);
        storyUI.setSpeaker('剧情准备中', '#9fd7ff');
      });
      storyStage = stage;
      game.storyStage = stage;
      return stage;
    } catch (err) {
      // 模型加载失败 → 字幕剧情回退（不卡死、不假装有 3D）
      stageLoadFailed = String(err?.message || err);
      console.warn('[story] 角色模型加载失败，退回字幕剧情：', stageLoadFailed);
      return null;
    }
  })();
  return stagePromise;
}

/**
 * 播放一段剧情。
 * @param {'intro'|'ending'} mode
 */
async function startStory(mode = 'intro', chapter = game.storyChapter || CHAPTER_01) {
  game.storyChapter = chapter;           // 记住当前章节，结尾剧情据此写进度
  game.state = 'story';                  // 引擎的 fixed/frame 更新据此让出控制权
  voice.mode = 'story';
  game.storyRun = false;                 // 先清标记：这一局还没开始跑
  hud.hideTitle();                       // 首页大标题必须自己收，不能只靠按钮回调
  hud.hideHUD();
  hud.hideResults();
  hud.setMusicPanel(false);
  hud.setQuitVisible(false);
  hud.wrongWay(false);
  touch?.show(false);
  document.documentElement.classList.remove('in-race');

  music.play('home');                    // 首页 / 剧情共用首页主题曲
  audio.setMusicState('menu');
  audio.setIdle(true);

  storyUI.show();
  storyUI.setVoiceReady(voice.isReady());   // 六段配音已就位 → 不显示「字幕模式」
  storyUI.setChapter(mode === 'ending'
    ? `${chapter.title} · 结尾${storyResultLine ? `　${storyResultLine}` : ''}`
    : chapter.title);
  storyUI.setResultLine(mode === 'ending' ? storyResultLine : '');
  storyUI.setBusy(true);
  storyUI.setText(mode === 'ending' ? '正在准备结尾……' : '正在准备剧情……');
  storyUI.setSpeaker('　', '#9fd7ff');

  director?.stop();
  await storyUI.fade(1, 260);

  const stage = await ensureStage();
  storyUI.setStageLess(!stage);

  if (stage) {
    engine.useScene(stage.scene, stage.camera);
    // 先回到干净舞台（跨剧情缓存的实例会把上一次的道具/主角 A 带过来）
    stage.reset();
    // 第二章三人同框：主角 A 进场；第一章不带主角 A。
    if (chapter.characters?.includes('hero-a')) stage.setCast({ heroA: true });
    // 开场用低机位远景推近，角色"登场"；结尾直接从双人中景开始
    stage.setShot(mode === 'ending' ? 'two' : 'entrance', true);
    stage.rest();
  } else {
    engine.useWorld();
  }

  director = new StoryDirector({ stage, ui: storyUI, voice, music });
  director.onChoice = onStoryChoice;
  storyUI.onNext = () => director?.next(true);
  storyUI.onSkip = () => director?.skip();

  const seg = mode === 'ending' ? chapter.ending : chapter.intro;
  storyUI.setBusy(false);
  storyUI.showLine();
  director.play(seg);

  // 章节进度：进入开场 = 进行中；进入结尾 = 已完成
  if (mode === 'ending') {
    if (chapter.id === 'chapter-02') {
      // 第二章完成 → 先写「已完成」状态（三态之一，刷新后保留）。
      writeChapter2(STORY_STATE.DONE);
      // 第四阶段：首次通关奖励（500 金币 + 阳光沙滩冠军成就）。
      // 仅在「本局故事比赛真的跑完了三圈」时发放，杜绝改参数 / 跳结尾白嫖。
      if (game._storyRaceFinished) {
        const r = Garage.grantChapter2FirstClear();
        game._storyRaceFinished = false;
        if (r.granted) {
          hud.setCoins(r.coins);                 // 车库金币立即更新
          pendingUnlockToast = '第二章首次通关！获得 500 金币 + 成就「阳光沙滩冠军」';
          pendingAchievement = Garage.CH2_ACHIEVEMENT;
          console.info(`[garage] 第二章首通奖励：+${r.amount} 金币，成就${r.achievementName}`);
        } else if (r.partial) {
          // 标记已落盘但金币键没存上（存储满）：不假装成功，提示用户
          hud.toast('奖励已记录，但金币未能保存（存储空间不足）', 'bad');
          console.warn('[garage] 第二章首通奖励：标记已存、金币写入失败', Garage.persistHealth());
        }
      }
    } else {
      writeChapter1(STORY_STATE.DONE);
      /* 第一章完成 → 解锁海龟冲浪车。
       * 走的是和「金币购买」完全相同的一份车辆所有权数据（lrv2.garage.owned），
       * 所以不会出现「剧情发过一次、购买又发一次」的重复发放。 */
      if (Garage.grantStoryChapter1()) {
        pendingUnlockToast = '第一章完成！海龟冲浪车解锁啦';
        console.info('[garage] 剧情奖励：解锁海龟冲浪车');
      }
    }
  } else {
    game._storyRaceFinished = false;   // 重新开场 = 这一局还没跑完比赛
    if (chapter.id === 'chapter-02') {
      advanceChapter2(STORY_STATE.PLAYING);
    } else {
      advanceChapter1(STORY_STATE.PLAYING);
    }
  }

  storyUI.fade(0, 420);
}

/** 剧情里的按钮：出发比赛！/ 再来一局 / 返回首页 */
async function onStoryChoice(id) {
  if (id === 'start' || id === 'again') {
    await enterStoryRace();
  } else if (id === 'home') {
    await leaveStoryToHome();
  }
}

/** 从剧情进入正式比赛（沿用现有比赛，不改任何驾驶逻辑）。 */
async function enterStoryRace() {
  director?.stop();
  director = null;
  await storyUI.fade(1, 260);
  storyUI.hide();
  engine.useWorld();
  game.storyRun = true;                  // ← 只有这里会把「跑完要播结尾」打开
  await startRace(hud.selected || 0);
  storyUI.fade(0, 380);
}

async function leaveStoryToHome() {
  director?.stop();
  director = null;
  await storyUI.fade(1, 260);
  storyUI.hide();
  engine.useWorld();
  goHome();
  storyUI.fade(0, 380);
}

/**
 * 中途退出比赛（音乐面板里的「退出比赛」）。
 * 清掉 storyRun 就切断了结尾剧情的触发路径。
 */
function quitStoryRace() {
  if (!game.storyRun) return false;
  game.storyRun = false;
  hud.wrongWay(false);
  voice.stop();
  music.setDuck(false);
  leaveStoryToHome();
  return true;
}

/* ---------------- 逆行提醒 ---------------- */
function triggerWrongWay() {
  hud.wrongWay(true);
  // 有固定配音就放；没有就只显示中文提示。
  // 这里**不会**回退到 SpeechSynthesis —— voiceManager 里根本没有那条分支。
  voice.playWrongWay();
}

/* 启动入口：
 *   · 正常首页：直接 showHomeTitle()（默认 viejo 世界）。
 *   · ?chapter=chapter-02：说明是从「第二章入口」重载进来的（beach 世界已建好），
 *     若第一章已通关则自动播放第二章开场；否则退回首页（防止越级进入）。 */
(function bootEntry() {
  const params = new URLSearchParams(location.search);
  if (params.get('chapter') === 'chapter-02') {
    if (readChapter1().state === 'done') {
      startStory('intro', CHAPTER_02);
      return;
    }
    // 没通关第一章就带着 chapter 标记进来：清掉标记回首页，避免卡死在 beach 世界。
    location.search = '?course=viejo';
    return;
  }
  showHomeTitle();
})();

/* --------------------------- simulation --------------------------- */
const CTRL_IDLE = { throttle: 0, brake: 0, steer: 0, drift: false, driftPressed: false };

function fixedUpdate(dt) {
  touch?.update(dt);
  input.update();
  game.time += dt;
  /* 车库是独立的 3D 场景，世界（赛道 / 城市 / 车流）完全不用推进。 */
  if (game.state === 'garage') return;
  if (game.state === 'menu' || game.state === 'story') {
    env.update(dt, new THREE.Vector3(0, 20, 0));
    return;
  }

  const race = game.race;
  race.update(dt);

  const racing = race.state === RaceState.RACING || race.state === RaceState.FINISHED;

  // player controls
  let ctrl = CTRL_IDLE;
  if (game.autopilot && racing && !game.player.finished) {
    // 测试用：让玩家车也交给 AI 开，用于自动化跑完整场。
    /* 这个 AI 必须绑在当前这台车上。重新开局会 buildField 出全新的 kart 对象，
     * 缓存下来的旧 driver 还在指挥上一台车 —— 新车拿不到油门，只能靠惯性挪，
     * 表现就是「跑了几分钟却只记一圈」。所以每次都核对一下绑定的 kart。 */
    if (!game.playerAuto || game.playerAuto.kart !== game.player) {
      game.playerAuto = new AIDriver(game.player, track, 2);
    }
    ctrl = game.playerAuto.update(dt, game);
  } else if (racing && !game.player.finished) {
    ctrl = { ...input.state, driftPressed: input.driftPressed };
    if (input.itemPressed) {
      const back = input.state.look ? -1 : 1;
      if (game.player.item) {
        game.items.use(game.player, back);
        audio.throwItem();
      }
    }
  } else if (race.state === RaceState.COUNTDOWN) {
    // rocket-start charge window
    if (input.state.throttle > 0) game.player.chargedStart += dt / Math.max(0.001, race.countdown + 0.35);
    ctrl = { ...CTRL_IDLE, steer: input.state.steer };
  } else if (game.player.finished) {
    // AI takes over once the player has crossed the line
    ctrl = game.playerAuto ? game.playerAuto.update(dt, game) : CTRL_IDLE;
  }

  const wasDrifting = game.player.drifting;
  const prevTier = game.player.driftTier;
  game.player.update(dt, ctrl, track);
  if (!wasDrifting && game.player.drifting) audio.hop();
  if (game.player.driftTier > prevTier) audio.drift();
  if (game.player.justBoosted) { audio.boost(); rig.addShake(0.25 * game.player.justBoosted); game.player.justBoosted = 0; }

  // AI
  for (const d of game.drivers) {
    let c = CTRL_IDLE;
    if (racing && !d.kart.finished) c = d.update(dt, game);
    else if (race.state === RaceState.COUNTDOWN) {
      d.kart.chargedStart = 0.6 + Math.random() * 0.5; // bots sometimes nail the start
    }
    d.kart.update(dt, c, track);
    d.kart.justBoosted = 0;
  }

  if (racing) game.items.update(dt);

  // 逆行提醒：连续逆向约 2 秒才触发，触发后 8 秒内不再提醒
  if (racing && !game.player.finished && wrongWay.update(dt, game.player, track)) {
    triggerWrongWay();
  }

  kartCollisions();
  if (traffic) {
    traffic.update(dt);
    for (const { kart, force } of traffic.collide(game.karts)) {
      if (kart === game.player) {
        rig.addShake(force * 0.55);
        audio.crash(force);
      }
      if (force > 0.8 && kart.spinOut(0.7)) onItemEvent('hit', kart);
    }
  }
  env.update(dt, game.player.position);
}

/** Elastic kart-vs-kart bumping. */
function kartCollisions() {
  const ks = game.karts;
  for (let a = 0; a < ks.length; a++) {
    for (let b = a + 1; b < ks.length; b++) {
      const A = ks[a], B = ks[b];
      const d = B.position.clone().sub(A.position);
      d.y = 0;
      const dist = d.length();
      const min = A.radius + B.radius;
      if (dist > min || dist < 1e-4) continue;
      const push = d.normalize().multiplyScalar((min - dist) * 0.5);
      A.position.sub(push);
      B.position.add(push);
      /* 推挤只动 x/z，但脚下地面会跟着变（路肩外侧的地形是往下掉的），
       * 这一帧车相对地面就会「陷」进去几厘米。给自动化统计留个记号。 */
      A._pushedAt = game.race?.raceTime ?? 0;
      B._pushedAt = game.race?.raceTime ?? 0;
      // heavier karts shove lighter ones around
      const mA = A.stats.weight, mB = B.stats.weight;
      const swap = (mB - mA) * 3.0;
      A.speed -= swap * 0.1;
      B.speed += swap * 0.1;
      A.lateral -= push.dot(A.right) * 26;
      B.lateral += push.dot(B.right) * 26;
      // a star-powered racer sends anyone it touches spinning
      if (A.starTime > 0 && B.starTime <= 0) { if (B.spinOut(1.4)) onItemEvent('hit', B); }
      else if (B.starTime > 0 && A.starTime <= 0) { if (A.spinOut(1.4)) onItemEvent('hit', A); }
      if (A === game.player || B === game.player) rig.addShake(0.12);
    }
  }
}

/* ----------------------------- visuals ---------------------------- */
function frameUpdate(dt) {
  if (game.state === 'menu') return;
  if (game.state === 'garage') {
    // 车库：只推进展台（自转 / 切换动画 / 相机聚焦），不碰比赛对象
    garageStage?.update(dt);
    return;
  }
  if (game.state === 'story') {
    // 剧情：只推进舞台（角色动作 + 镜头插值）和导演（同句内的动作时间表）
    storyStage?.update(dt);
    director?.update(dt);
    return;
  }

  for (const k of game.karts) {
    k.syncVisual(dt);
    emitFx(k, dt);
  }

  particles.update(dt);
  beach?.update(dt);
  if (!game.freeCam) rig.update(dt, game.player, { lookBack: input.state.look });
  engine.setSpeedFx(Math.min(1, Math.abs(game.player.speed) / (game.player.cruiseSpeed || 33) + (game.player.boostTime > 0 ? 0.35 : 0)));
  audio.update(dt, game.player);
  hud.update(dt, game);
}

function emitFx(k, dt) {
  const p = k.position;
  const back = k.forward.multiplyScalar(-1.05);
  const rgt = k.right;

  if (k.drifting && k.grounded && Math.abs(k.speed) > 6) {
    for (const s of [-1, 1]) {
      particles.driftSparks(
        p.x + back.x + rgt.x * s * 0.72, p.y + 0.16, p.z + back.z + rgt.z * s * 0.72,
        k.driftDir, k.driftTier, Math.abs(k.speed)
      );
    }
    if (Math.random() < dt * 30) {
      particles.tireSmoke(p.x + back.x, p.y + 0.14, p.z + back.z, 0.7);
    }
  }

  if (k.offroad && k.grounded && Math.abs(k.speed) > 4 && Math.random() < dt * 40) {
    particles.dust(p.x + back.x, p.y + 0.1, p.z + back.z);
  }

  if (k.boostTime > 0 && Math.random() < dt * 60) {
    for (const s of [-1, 1]) {
      particles.boostFlame(
        p.x + back.x * 1.2 + rgt.x * s * 0.4, p.y + 0.42, p.z + back.z * 1.2 + rgt.z * s * 0.4,
        -k.forward.x * 6, -k.forward.z * 6
      );
    }
  }

  if (k.starTime > 0 && Math.random() < dt * 40) {
    particles.sparkle(p.x, p.y + 0.6, p.z, new THREE.Color().setHSL((game.time * 1.4) % 1, 1, 0.6).getHex(), 1.4);
  }
}

engine.add(fixedUpdate, frameUpdate);
engine.start();

// place the camera somewhere flattering behind the start line for the menu
{
  const pose = track.startPose(0);
  engine.camera.position.copy(pose.position).add(new THREE.Vector3(0, 7, 0)).sub(pose.forward.clone().multiplyScalar(16));
  engine.camera.lookAt(pose.position.clone().add(new THREE.Vector3(0, 2, 0)));
}

/* Hold the loader until a frame has actually been composited — the first
 * render compiles every shader, which is the longest single stall of all. */
await phase(100, '出发！');
await paint();
const bootEl = document.getElementById('boot');
if (bootEl) {
  bootEl.classList.add('done');
  setTimeout(() => bootEl.remove(), 600);
}

/* 静音总控：一个入口同时驱动「现有音效系统」和「背景音乐」，
 * 明确处理两套系统的静音状态同步。Audio 用 localStorage 持久化静音，
 * MusicManager 持久化音乐开关与音量。 */
function syncMusicUI() {
  hud.syncMusicSettings({ enabled: music.enabled, volume: music.volume, muted: audio.muted });
}
function applyMute(muted) {
  audio.toggleMute(muted);          // 引擎/轮胎/道具/撞击等音效
  music.setMuted(audio.muted);      // 背景音乐
  voice.setMuted(audio.muted);      // 角色配音（静音时一句都不放）
  hud.setMuted(audio.muted);        // 复用原有静音按钮
  syncMusicUI();
}

/* 角色说话 → 背景音乐压低；说完 → 恢复。导演会接管同一个回调，
   这里给的是「没有剧情时」也成立的默认值。 */
voice.onSpeaking = (on) => music.setDuck(on);
hud.onQuitRace = () => quitStoryRace();

/* 车型：真正的来源是车库存档（lrv2.garage.current）。这里只做三件事 ——
 * 把车型同步给 HUD、按需预载模型、必要时把角色格下标对齐。
 * 旧键 lrv2.driverSkin 原样留在 localStorage 里，不读也不删。
 *
 * 车型状态、出场车型、角色格下标是**三件必须同时对齐的事**：
 * 刷新后如果只写了一个，海龟车会带着上一次选的角色格出发。
 * 所以首页初始化也必须走这里。 */
function applyVehicle(v, { persist = false, preload = false } = {}) {
  let val = MODEL_VEHICLES.includes(v) ? v : 'red';
  if (val !== 'red' && !canEquip(val, Garage.load())) val = 'red';
  if (persist) writeVehiclePref(val);
  hud.setVehicle(val);       // 内部在非红车时会把 hud.selected 对齐到红车
  // 只有真正需要的时候才预载模型；停在首页时仍按需加载，
  // 不点「开始游戏」这些模型一个字节都不下来。
  if (preload) {
    if (val === 'moto') {
      ensureMotoKart();                  // 人和车同一个文件，不需要主角 A
    } else {
      ensureHeroA();                     // 红车 / 海龟车都要主角 A
      if (val === 'turtle') ensureTurtleKart();
    }
  }
  return val;
}

/* persist: 存档里的 current 若指向一辆没拥有 / 没模型的车（导入坏了、
 * 或者被手动改过），这里会把它修正回红车并写盘 —— 否则界面显示红车、
 * 存档里却一直留着 turtle，下次解锁时又会莫名其妙跳回去。 */
applyVehicle(readVehiclePref(), { persist: true });
/* 剧情里被系统拦下时的自救按钮：这一次是真实点击，解锁 + 重播当前句。 */
storyUI.onVoiceTap = () => {
  voice.unlock();
  director?.replayVoice();
};

/* iPhone Safari 的音频解锁 —— 关键改动（v2）：
 *
 * 旧写法是 `{ once: true }`：只在页面第一次点击时试一次，而且是对 6 个
 * <audio> 元素分别静音 play()。真机上只有其中一个能拿到许可，其余被拒，
 * 于是「第一句有声、后面全哑」。新版含义完全不同：
 *
 *   · 每次 pointerdown / keydown 都调用一次（幂等、极便宜）；
 *   · voice.unlock() 只做一件事：把**同一个 AudioContext** resume 到 running。
 *     一旦 running，之后所有 AudioBufferSourceNode 都不再受自动播放策略限制；
 *   · 如果某一刻仍然被拦，voice 会把那一句记成 pending，并在下一次手势
 *     （包括玩家点「下一句」那一下）立刻补播，同时让剧情层显示
 *     「点击播放语音」—— 声音没出来就明说，不假装。
 */
function onUserGestureAudio() {
  audio.resume();
  voice.unlock();
}
addEventListener('pointerdown', onUserGestureAudio, { capture: true, passive: true });
addEventListener('keydown', onUserGestureAudio, { capture: true });
addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !e.repeat) applyMute(!audio.muted);
});
// Little Racing V2 — keyboard "back to track" shortcut (desktop testing).
addEventListener('keydown', (e) => {
  if (e.code === 'KeyR' && !e.repeat && game.state === 'race'
      && game.race && game.player && !game.player.finished) {
    game.race.respawn(game.player);
  }
});
/* 桌面调试：Esc = 跳过剧情 / 退出故事里的这一局 */
addEventListener('keydown', (e) => {
  if (e.code !== 'Escape' || e.repeat) return;
  if (game.state === 'story') director?.skip();
  else if (game.state === 'race' && game.storyRun) quitStoryRace();
});
hud.onMuteToggle = () => applyMute(!audio.muted);
hud.onMusicEnabledChange = (on) => { music.setEnabled(on); syncMusicUI(); };
hud.onMusicVolumeChange = (v) => { music.setVolume(v); syncMusicUI(); };
applyMute(audio.muted);   // 刷新后恢复静音偏好，并同步给音乐模块
syncMusicUI();

if (TEST_HOOKS) window.__game = game;
if (TEST_HOOKS) window.__music = music;   // 自动化测试的只读观察点（仅测试构建）

/* ================================================================== *
 * 仿真测试接口（只在控制台与自动化测试里用，儿童界面上没有任何入口）
 *
 * 为什么要它：无头浏览器里跑 3 圈 × 8 台车，靠 rAF 等着太慢也太不稳定
 * （掉帧会让物理步长变化，两次测试结果对不上）。这里直接把 fixedUpdate
 * 抽出来按固定步长推进，测试就变成确定性的。
 * ================================================================== */
/* 自动化测试用的「按住不放」输入。屏幕摇杆每帧都会往中间回一点，
 * 所以测试里设定的油门/方向必须逐帧重新写一次，否则几帧之后就被清掉了。 */
let heldCtrl = null;

function applyTouch(c) {
  input.touch.throttle = c.throttle;
  input.touch.brake = c.brake;
  input.touch.steer = c.steer;
  input.touch.drift = c.drift;
}

if (TEST_HOOKS) window.__sim = {
  /** 开一局，并跳过出场/倒计时，直接进 RACING */
  async start({ vehicle = null, charIndex = 0 } = {}) {
    if (vehicle) hud.setVehicle(vehicle);
    await startRace(charIndex);
    game.race.state = RaceState.RACING;
    game.race.introTime = game.race.introDuration;
    game.race.countdown = 0;
    return { vehicle: hud.vehicle, karts: game.karts.length, laps: game.race.laps };
  },
  /**
   * 固定步长推进；返回推进了多少秒。
   * 按住不放的输入会逐帧重新施加 —— 屏幕摇杆每帧都会自己回中，
   * 只在开头设一次值，转向 1 秒后就衰减到 0.02 了（测试会量到「没有转向」）。
   */
  step(seconds = 1 / 60, sub = 1) {
    for (let i = 0; i < sub; i++) {
      if (heldCtrl) applyTouch(heldCtrl);
      fixedUpdate(seconds);
    }
    return seconds * sub;
  },
  /**
   * 只做视觉同步（轮子自转 / 前轮转向 / 压弯这类量都在 syncVisual 里写进
   * 场景图，而正常的渲染循环在自动化测试里不跑）。
   * 检查「摩托前轮有没有转」「车身压不压弯」必须走这一个口子。
   */
  sync(dt = 1 / 60) {
    for (const k of game.karts) k.syncVisual(dt);
    return true;
  },
  /** 直接设定玩家输入（走 touch 通道，input.update() 会把它合进去） */
  control({ throttle = 0, brake = 0, steer = 0, drift = false } = {}) {
    heldCtrl = { throttle, brake, steer, drift };
    applyTouch(heldCtrl);
    return heldCtrl;
  },
  /** 把某台车放到第 i 个采样点、横向 lat 处，对齐切线 */
  place(kartIndex, i, lat = 0) {
    const k = game.karts[kartIndex];
    if (!k) return null;
    const p = track.pointAt(i, lat);
    const t = track.getTangent(i);
    k.placeAt(p.clone().setY(p.y + 0.4), t);
    k.trackIndex = ((i % track.n) + track.n) % track.n;
    k.speed = 0;
    k.lateral = 0;
    k.vy = 0;
    return { i: k.trackIndex, pos: [p.x, p.y, p.z] };
  },
  /** 赛道结构快照，用于断言（不依赖任何渲染） */
  trackInfo() {
    const hist = {};
    for (let i = 0; i < track.n; i++) hist[track.kind[i]] = (hist[track.kind[i]] || 0) + 1;
    return {
      course: track.course.id,
      name: track.course.name,
      laps: track.course.laps,
      length: +track.length.toFixed(2),
      samples: track.n,
      seg: +(track.length / track.n).toFixed(4),
      controlPoints: track.control.length,
      sections: track.sections
        ? track.sections.map((s) => ({
          id: s.id, name: s.name, len: +s.len.toFixed(1), kind: s.kind,
          i0: s.i0, i1: s.i1, d0: +s.d0.toFixed(1), d1: +s.d1.toFixed(1),
        }))
        : null,
      bridge: track.bridgeRange
        ? { i0: track.bridgeRange.i0, i1: track.bridgeRange.i1, len: +track.bridgeRange.len.toFixed(1) }
        : null,
      kindHistogram: hist,
      kind3OutsideBridge: track.bridgeRange
        ? (() => {
          let bad = 0;
          const { i0, i1 } = track.bridgeRange;
          for (let i = 0; i < track.n; i++) {
            const inside = i1 > i0 ? (i >= i0 && i < i1) : (i >= i0 || i < i1);
            if (track.kind[i] === 3 && !inside) bad++;
          }
          return bad;
        })()
        : 0,
      checkpoints: track.checkpoints.slice(),
      checkpointOrderOk: track.checkpoints.every((v, k, a) => k === 0 || v > a[k - 1]),
      clearance: track.clearance
        ? { min: +Math.min(...track.clearance.left, ...track.clearance.right).toFixed(2) }
        : null,
      widths: {
        min: +(Math.min(...track.width) * 2).toFixed(2),
        max: +(Math.max(...track.width) * 2).toFixed(2),
      },
      surfaceGrips: track.course.surfaceGrips || null,
    };
  },
  /** 全场快照：圈数 / 排名 / 检查点进度 / 是否出界 */
  snapshot() {
    return {
      state: game.race?.state,
      time: +(game.race?.raceTime || 0).toFixed(2),
      player: game.player ? {
        vehicle: hud.vehicle,
        speed: +game.player.speed.toFixed(2),
        lap: game.player.lap,
        rank: game.player.rank,
        finished: game.player.finished,
        progressTotal: +game.player.progressTotal.toFixed(3),
        offroad: game.player.offroad,
        surfaceGrip: +game.player.surfaceGrip.toFixed(3),
        kind: track.kind[game.player.trackIndex],
        y: +game.player.position.y.toFixed(2),
        groundY: +(game.player.groundY ?? 0).toFixed(2),
        lat: +(track.locate(game.player.position, game.player.trackIndex).lat || 0).toFixed(2),
        width: +track.width[game.player.trackIndex].toFixed(2),
        wallHit: +(game.player.wallHit || 0).toFixed(3),
      } : null,
      karts: game.karts.map((k, i) => ({
        i,
        lap: k.lap,
        rank: k.rank,
        finished: k.finished,
        speed: +k.speed.toFixed(2),
        progressTotal: +k.progressTotal.toFixed(3),
        index: k.trackIndex,
        lat: +(track.locate(k.position, k.trackIndex).lat || 0).toFixed(2),
        offroad: k.offroad,
        respawns: k._respawnCount || 0,
      })),
    };
  },
  /** 把整场快进到结束（最多 maxSeconds），返回结果 */
  runToFinish({ maxSeconds = 420, dt = 1 / 60, autopilot = true } = {}) {
    if (autopilot && (!game.playerAuto || game.playerAuto.kart !== game.player)) {
      game.playerAuto = new AIDriver(game.player, track, 2);
    }
    const steps = Math.round(maxSeconds / dt);
    for (let s = 0; s < steps; s++) {
      fixedUpdate(dt);
      if (game.race.state === RaceState.FINISHED) break;
      if (game.karts.every((k) => k.finished)) break;
    }
    return this.snapshot();
  },
  /**
   * 跑完整场并给出诊断数据（AI 卡桥、圈数、复位、出界、排名）。
   * 所有统计在页面内算完再返回，避免每帧跨进程通信。
   */
  runRace({ maxSeconds = 480, dt = 1 / 60, autopilot = true } = {}) {
    game.autopilot = autopilot;
    const race = game.race;
    const N = track.n;
    const bridge = track.bridgeRange;
    const inBridge = (i) => {
      if (!bridge) return false;
      return bridge.i1 > bridge.i0
        ? (i >= bridge.i0 && i < bridge.i1)
        : (i >= bridge.i0 || i < bridge.i1);
    };

    const stat = game.karts.map((k, idx) => ({
      idx, laps: 0, finished: false, finishTime: 0, respawns: 0,
      offroadFrames: 0, maxStallSec: 0, bridgeSec: 0, bridgeStallSec: 0,
      maxBridgeStall: 0, laps0: k.lap, name: k.name,
      minY: Infinity, maxDrop: 0,
      // 最长停滞发生在哪儿：报告里要能直接指出「哪个采样点、什么路面」
      maxStallAt: 0, maxStallIndex: -1, maxStallKind: -1, maxStallRespawns: 0,
      maxDropIndex: -1, maxDropKind: -1, maxDropSpeed: 0,
      maxDropVy: 0, maxDropAir: 0, maxDropGrounded: true, maxDropLat: 0, maxDropAt: 0,
      maxVy: 0, maxVyHop: 0, maxVyIndex: -1, maxVyAt: 0,
    }));
    const lastProgress = game.karts.map((k) => k.progressTotal);
    const lastMove = game.karts.map(() => 0);
    const bridgeEnter = game.karts.map(() => -1);
    const bridgeStall = game.karts.map(() => 0);
    const lastRespawnAt = game.karts.map(() => -99);

    const origRespawn = race.respawn.bind(race);
    race.respawn = (k) => {
      const i = game.karts.indexOf(k);
      if (i >= 0) { stat[i].respawns++; lastRespawnAt[i] = race.raceTime; }
      return origRespawn(k);
    };

    const steps = Math.round(maxSeconds / dt);
    for (let s = 0; s < steps; s++) {
      fixedUpdate(dt);
      const t = (s + 1) * dt;
      for (let i = 0; i < game.karts.length; i++) {
        const k = game.karts[i];
        const st = stat[i];
        if (k.offroad) st.offroadFrames++;
        const dp = k.progressTotal - lastProgress[i];
        /* progress 是 (采样点序号 + 0.5) / n，天然被量化成 1/n（这张图 0.00056）。
         * 阈值必须小于一个采样点，否则「一直按采样点前进」也会被判成停滞，
         * 量出来的最长卡死时间会凭空翻几倍。 */
        if (dp !== 0) { lastMove[i] = t; lastProgress[i] = k.progressTotal; }
        else if (!k.finished) {
          const stall = t - lastMove[i];
          if (stall > st.maxStallSec) {
            st.maxStallSec = Math.max(st.maxStallSec, stall);
            st.maxStallAt = +t.toFixed(1);
            st.maxStallIndex = k.trackIndex;
            st.maxStallKind = track.kind[k.trackIndex];
            st.maxStallRespawns = st.respawns;
          }
        }
        if (inBridge(k.trackIndex)) {
          st.bridgeSec += dt;
          if (bridgeEnter[i] < 0) bridgeEnter[i] = t;
          /* 「卡在桥上」= 在桥面上速度接近 0 还一直待着。
           * 用「进桥后待了多久」是错的：8 台车排队过一座 17 m 宽的桥，
           * 正常通过也要好几秒，量出来像集体卡桥。 */
          if (k.speed < 2.5 && !k.finished) {
            bridgeStall[i] += dt;
            st.maxBridgeStall = Math.max(st.maxBridgeStall, bridgeStall[i]);
          } else {
            bridgeStall[i] = 0;
          }
        } else if (bridgeEnter[i] >= 0) {
          bridgeEnter[i] = -1;
          bridgeStall[i] = 0;
        }
        /* 陷地 / 弹射的度量。
         *
         * 不能用 k.groundY - k.position.y：groundY 是「这一帧移动之前」脚下的
         * 地面高度，车一帧走了 0.3 m 之后两者本来就会差几厘米，桥头下坡处
         * 能差到 0.29 m —— 量出来像陷进桥里，其实只是车正在落向桥面。
         * 正确的问法是「此刻这个位置脚下的地面有多高」。
         *
         * 而且只在「已经贴地」的帧上问：车在空中飞的时候本来就高于地面，
         * 那不算陷地。 */
        const surfNow = track.surfaceAt(k.position, k.trackIndex).y;
        st.minY = Math.min(st.minY, k.position.y);
        /* 复位会把车抬到路面上方 1.2 m 再落下来，复位后 0.6 s 内的几何不算。 */
        const justRespawned = t - lastRespawnAt[i] < 0.6;
        const justPushed = t - (k._pushedAt ?? -99) < 0.1;
        if (!justRespawned && !justPushed) {
          const pen = surfNow - k.position.y;            // >0 陷进地面
          if (k.grounded && pen > st.maxDrop) {
            st.maxDrop = pen;
            st.maxDropIndex = k.trackIndex;
            st.maxDropKind = track.kind[k.trackIndex];
            st.maxDropSpeed = +k.speed.toFixed(1);
            st.maxDropLat = +track.locate(k.position, k.trackIndex).lat.toFixed(2);
            st.maxDropAt = +t.toFixed(2);
          }
          /* 车不可能「被路面弹起来」：向上速度只有一个来源，就是漂移起跳
           * （hopImpulse 5.4）。超过这个量级就说明有别的东西在往天上扔车。 */
          if (k.vy > st.maxVy) {
            st.maxVy = +k.vy.toFixed(2);
            st.maxVyHop = +(k.hopTimer ?? 0).toFixed(2);
            st.maxVyIndex = k.trackIndex;
            st.maxVyAt = +t.toFixed(2);
          }
        }
      }
      if (race.state === RaceState.FINISHED && game.karts.every((k) => k.finished)) break;
      if (t > 30 && game.karts.every((k) => k.finished)) break;
    }
    race.respawn = origRespawn;
    game.autopilot = false;

    for (let i = 0; i < game.karts.length; i++) {
      const k = game.karts[i];
      stat[i].laps = k.lap;
      stat[i].finished = k.finished;
      stat[i].finishTime = +k.finishTime.toFixed(2);
      stat[i].rank = k.finalRank || k.rank;
      stat[i].minY = +stat[i].minY.toFixed(2);
      stat[i].maxDrop = +stat[i].maxDrop.toFixed(3);
      stat[i].maxStallSec = +stat[i].maxStallSec.toFixed(1);
      // Keep raw duration for threshold assertions; round only in report text.
      stat[i].bridgeSec = +stat[i].bridgeSec.toFixed(1);
      stat[i].offroadFrames = stat[i].offroadFrames;
      stat[i].lapTimes = k.lapTimes.map((v) => +v.toFixed(2));
      stat[i].isPlayer = !!k.isPlayer;
    }
    return {
      state: race.state,
      raceTime: +race.raceTime.toFixed(2),
      finishOrder: race.finishOrder.map((k) => game.karts.indexOf(k)),
      karts: stat,
      standings: (race.standings || []).map((k) => ({ i: game.karts.indexOf(k), rank: k.rank })),
    };
  },
  /** 定点机位（截图用）：把相机放到 eye，看向 look，悬停追尾镜头 */
  cam(eye, look, fov = 52) {
    game.freeCam = true;
    const c = game.engine.camera;
    c.position.set(eye[0], eye[1], eye[2]);
    c.lookAt(look[0], look[1], look[2]);
    c.fov = fov;
    c.updateProjectionMatrix();
  },
  releaseCam() { game.freeCam = false; },
  /** 某个分段的第几台车/第几个采样点世界坐标，用于摆机位 */
  pointAt(secId, t = 0.5, lat = 0) {
    const s = track.sections?.find((x) => x.id === secId);
    if (!s) return null;
    const N = track.n;
    const span = s.i1 >= s.i0 ? s.i1 - s.i0 : N - s.i0 + s.i1;
    const i = (s.i0 + Math.round(span * t)) % N;
    const p = track.pointAt(i, lat);
    return { i, x: p.x, y: p.y, z: p.z };
  },
};
if (TEST_HOOKS) window.__RaceState = RaceState;

/* 车库的只读观察点 + 动作接口（只给控制台 / 自动化测试，不在儿童界面上出现）。
 *
 * 安全收敛（第四阶段上线前）：直接发奖 / 改比赛闸门 / 模拟写入失败这类「能绕过正常流程」的
 * 测试接口，只在明确的开发或测试构建里存在（VITE_TEST_HOOKS=1 或 dev 服务器），
 * 正式 Pages 部署包里会被 tree-shake 掉，玩家无法在控制台直接调用它们绕过比赛发奖。 */
if (TEST_HOOKS) window.__garage = {
  save: () => Garage.snapshot(),
  vehicles: () => VEHICLES.map((v) => ({
    id: v.id,
    name: v.name,
    available: isDrivable(v.id),
    price: v.unlock.price ?? null,
    state: vehicleState(v, Garage.load()),
    owned: !!Garage.snapshot().owned[v.id],
  })),
  study: () => studyStatus(),
  stage: () => (garageStage ? garageStage.debug() : null),
  ui: () => ({
    visible: garageUI.visible,
    selected: garageUI.selectedId,
    rect: garageUI.measureShowRect(),
    carName: document.querySelector('#garageCarName')?.textContent,
    action: document.querySelector('#gpAction')?.textContent,
    actionDisabled: !!document.querySelector('#gpAction')?.disabled,
    stateText: document.querySelector('#gpState')?.textContent,
    coinsText: document.querySelector('#garageCoinsNum')?.textContent,
    cards: [...document.querySelectorAll('#garageCards .gCard')].map((c) => ({
      id: c.dataset.id, state: c.dataset.state, on: c.classList.contains('on'),
    })),
  }),
  open: () => openGarage(),
  close: () => closeGarage(),
  select: (id) => selectGarageVehicle(id),
  equip: (id) => equipVehicle(id),
  buy: (id) => buyVehicle(id),
  exportText: () => Garage.exportSave(),
  importText: (t, m, force) => Garage.importSave(t, m, { allowNoBackup: !!force }),
  backups: () => Garage.listBackups(),
  persistHealth: () => Garage.persistHealth(),
  chapter2FirstClearState: () => Garage.chapter2FirstClearState(),
  getAchievements: () => Garage.getAchievements(),
  isAchievementUnlocked: (id) => Garage.isAchievementUnlocked(id),
  studyEnabled: STUDY_ENABLED,
  migration: () => ({ ...MIGRATION }),
  /* 右侧详情滚动的只读状态（验证「中部真的能滚」而不是只写了 overflow） */
  panel: () => {
    const sc = document.getElementById('gpScroll');
    if (!sc) return null;
    const r = sc.getBoundingClientRect();
    return {
      overflow: sc.scrollHeight - sc.clientHeight,
      scrollTop: Math.round(sc.scrollTop),
      maxScroll: sc.scrollHeight - sc.clientHeight,
      clientH: sc.clientHeight,
      scrollH: sc.scrollHeight,
      hint: !document.getElementById('gpMore')?.classList.contains('hidden'),
      rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) },
      touchAction: getComputedStyle(sc).touchAction,
      overflowY: getComputedStyle(sc).overflowY,
    };
  },
  /* 测试钩子：直接滚中部（真机滚动由手指完成，这里只用来截图/断言） */
  scrollPanel: (y) => {
    const sc = document.getElementById('gpScroll');
    if (!sc) return null;
    sc.scrollTop = y === 'end' ? sc.scrollHeight : y;
    garageUI._updateScrollHint();
    return { scrollTop: Math.round(sc.scrollTop) };
  },
};

/* —— 仅开发 / 测试构建可用：直接发奖、改比赛闸门、模拟存储失败等会绕过正常流程的接口 —— */
if (TEST_HOOKS) {
  Object.assign(window.__garage, {
    grantCoins: (n) => Garage.grantCoins(n, '测试发放'),
    grantVehicle: (id) => Garage.grantVehicle(id, 'test'),
    resetGarage: () => Garage.__resetGarageForTests(),
    remigrate: () => { Garage.__dropCacheForTests?.(); return { ...Garage.migrate() }; },
    grantChapter2FirstClear: () => Garage.grantChapter2FirstClear(),
    recoverRewards: () => Garage.recoverRewardTransactions(),
    rewardLedger: () => Garage.debugRewardLedger(),
    migrateRewards: () => Garage.migrateRewards(),
    setStoryRaceFinished: (on) => { game._storyRaceFinished = !!on; },
    forceWriteFail: (on) => Garage.__forceWriteFail(!!on),
    forceFailKeys: (keys) => Garage.__forceFailKeys(keys),
    setAvailable: (id, on) => setAvailableOverride(id, on),
    claim: (o) => Garage.claimRaceReward(o),
  });
}

/* 全屏 / 视口的只读观察点（自动化测试用；界面上只有那两个按钮）。 */
if (TEST_HOOKS) window.__fs = {
  standalone: () => isStandalone(),
  supported: () => fsSupported(),
  active: () => inFullscreen(),
  toggle: () => toggleFullscreen(),
  helpOpen: () => {
    const el = document.getElementById('fsHelp');
    return !!el && !el.classList.contains('hidden');
  },
  helpSteps: () => [...document.querySelectorAll('#fshSteps li')].map((li) => li.textContent.trim()),
  closeHelp: () => fullscreen.closeHelp(),
};
if (TEST_HOOKS) window.__vp = {
  size: () => viewSize(),
  cssH: () => getComputedStyle(document.documentElement).getPropertyValue('--vvh').trim(),
  appH: () => Math.round(document.getElementById('app').getBoundingClientRect().height),
  canvasH: () => Math.round(document.getElementById('scene').getBoundingClientRect().height),
};

/* 车型 / 驾驶员的只读观察点（不给儿童界面用，只在控制台 / 自动化测试里读）：
 *   __driver() → 当前选的车、模型是否已加载、玩家车上挂的是哪台车、谁在开。 */
if (TEST_HOOKS) window.__driver = () => {
  const m = game.player?.model;
  const gname = m?.group?.name;
  const kind = gname === 'turtleKart' ? 'turtle' : gname === 'motoKart' ? 'moto' : (m ? 'red' : null);
  return {
    vehicle: hud.vehicle,
    pref: readVehiclePref(),
    legacyDriverKey: (() => {
      try { return globalThis.localStorage?.getItem(LEGACY_DRIVER_KEY); } catch { return null; }
    })(),
    heroLoaded: !!heroMod,
    heroLoading: !!heroLoading,
    heroInfo: heroMod ? heroMod.heroAInfo() : null,
    turtleLoaded: !!turtleMod,
    turtleLoading: !!turtleLoading,
    turtleInfo: turtleMod ? turtleMod.turtleKartInfo() : null,
    motoLoaded: !!motoMod,
    motoLoading: !!motoLoading,
    motoInfo: motoMod ? motoMod.motoKartInfo() : null,
    playerVehicle: kind,
    playerWheels: m?.wheels?.length ?? null,
    playerWheelSteer: m?.wheels?.filter((w) => w.steer).length ?? null,
    playerDriver: m?.driver?.name || null,
    playerDriverChildren: m?.driver?.children?.length ?? null,
    /* 摩托专用：当前车身倾角 / 车把转角 / 轮心世界坐标 / 骑手包围盒 */
    playerLean: game.player ? +(game.player.lean || 0).toFixed(4) : null,
    playerWheelSpin: game.player ? +(game.player.wheelSpin || 0).toFixed(3) : null,
    playerSteerVisual: game.player ? +(game.player.steerVisual || 0).toFixed(4) : null,
    playerProbe: m?.probe ? m.probe() : null,
    playerSteer: m?.steerInfo ? m.steerInfo() : null,
    selected: hud.selected,
    charName: game.player?.name ?? null,
    state: game.state,
  };
};

/* 音频调试信息（本轮新增）。
 * 只在开发者控制台 / 自动化测试里读取，**不在儿童游戏界面上显示任何一条**。
 * 用法：控制台输入 __audioDebug() → 得到当前模式、当前语音、文件 URL、
 * 是否解锁、是否静音、play() 结果、Promise 拒绝原因、paused/ended、
 * 加载错误、播放时间、逆行提醒是否已触发。 */
function audioDebugInfo() {
  const v = voice.debugState();
  const ww = wrongWay.debug();
  return {
    mode: game.state === 'story' ? 'story'
      : game.state === 'race' ? (game.storyRun ? 'story-race' : 'race')
        : game.state === 'results' ? 'results' : 'menu',
    voiceMode: v.mode,
    voiceId: v.playingId,
    file: v.file,
    url: v.url,
    unlocked: v.unlocked,
    ctxState: v.ctxState,
    muted: v.muted,
    enabled: v.enabled,
    playOk: v.lastResult.ok,
    playReason: v.lastResult.reason,
    rejectReason: v.lastReject,
    paused: !v.playingId,
    ended: v.phase === 'ended',
    phase: v.phase,
    loadErrors: v.loadErrors,
    currentTime: v.currentTime,
    duration: v.duration,
    level: v.level,
    decoded: v.decoded,
    pendingId: v.pendingId,
    wrongWay: {
      fired: ww.fires, held: +Number(ww.held || 0).toFixed(2),
      cooldown: +Number(ww.cool || 0).toFixed(2), dot: ww.dot ?? null,
      hudShown: document.getElementById('wrongWay')?.classList.contains('shown') ?? false,
    },
  };
}
if (TEST_HOOKS) window.__audioDebug = audioDebugInfo;
/* ?debug=1 时每次语音开始/结束都在控制台打一行，方便真机连 Safari 排查。 */
if (new URLSearchParams(location.search).has('debug')) {
  const log = (tag) => (p) => console.log('[voice]', tag, p, audioDebugInfo());
  voice.on('start', log('start'));
  voice.on('end', log('end'));
  voice.on('blocked', log('blocked'));
}
if (TEST_HOOKS) window.__ITEMS = ITEMS;
if (TEST_HOOKS) window.__THREE = THREE;

/* 剧情流程的自动化接口（只做观察与推进，不改变任何游戏规则） */
if (TEST_HOOKS) window.__story = {
  chapter: CHAPTER_01,
  chapter2: CHAPTER_02,
  ui: storyUI,
  get stage() { return storyStage; },
  get director() { return director; },
  start: (mode) => startStory(mode || 'intro'),
  startChapter: (id, mode) => startStory(mode || 'intro', id === 'chapter-02' ? CHAPTER_02 : CHAPTER_01),
  next: () => director?.next(true),
  skip: () => director?.skip(),
  choose: (id) => onStoryChoice(id),
  enterRace: () => enterStoryRace(),
  quitRace: () => quitStoryRace(),
  enterChapter: (id) => enterChapter(id === 'chapter-02' ? CHAPTER_02 : CHAPTER_01),
  wrongWayCue: () => triggerWrongWay(),   // 测试用：走一遍真实的逆行提示通路
  progress: () => readChapter1(),
  progress2: () => readChapter2(),
  resetProgress: () => writeChapter1(STORY_STATE.IDLE),
  resetProgress2: () => writeChapter2(STORY_STATE.IDLE),
  currentChapter: () => game.storyChapter?.id || null,
  headScreen: (id) => storyStage?.headScreen(id) || null,
  bounds: () => storyStage?.worldBounds() || null,
  loadFailed: () => stageLoadFailed,
  state: () => ({
    gameState: game.state,
    storyRun: game.storyRun,
    stageRendering: engine.renderingStage,
    currentChapterId: game.storyChapter?.id || null,
    progress: readChapter1(),
    progress2: readChapter2(),
    director: director ? director.debug() : null,
    stage: storyStage ? storyStage.debug() : null,
    ui: storyUI.measure(),
    voice: voice.debugState(),
    music: { ...music.debugState() },
    wrongWay: wrongWay.debug(),
    hud: {
      visible: !document.getElementById('hud')?.classList.contains('hidden'),
      wrongWayShown: document.getElementById('wrongWay')?.classList.contains('shown'),
    },
  }),
};
