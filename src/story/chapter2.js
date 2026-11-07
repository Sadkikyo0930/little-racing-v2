/**
 * 第二章《阳光沙滩大冒险》— 剧情脚本数据
 *
 * 纯数据，结构与第一章（chapter1.js）完全一致：导演（director.js）读它推进
 * 对白，舞台（stage.js）读它切换镜头、角色动作与道具。
 *
 * ── 对白来源 ────────────────────────────────────────────────────
 * 来自 R2 设计文档《第二章设计方案》§2 的指定台词，一字不改（含标点）。
 * 21 句分五段：开场(01~05) / 邀请(06~08) / 赛前提醒(09~12) / 线索(13~16) /
 * 找回奖杯(17~21)。角色关系、故事走向完全沿用设计文档，不重写。
 *
 * ── 三人同框 ────────────────────────────────────────────────────
 * 主角 A 进入剧情：开场用三位真实角色同框（主角 A、灯塔爷爷、闪电小红）。
 * 主角 A 是玩家化身，本段对白由爷爷和小红说，主角 A 站在中间只做轻微的
 * 点头 / 呼吸（hero 字段触发的动作），不抢台词。
 *
 * ── 动作 ────────────────────────────────────────────────────────
 * 只用已验收的免绑骨动作：站立 / 摆动 / 点头 / 左转 / 右转。无挥手。
 *
 * ── stage 道具提示 ──────────────────────────────────────────────
 * 舞台可按 beat.stage 实时切换道具：
 *   props.trophy: 'empty'(空奖杯台) | 'found'(找回的奖杯) | 'none'(隐藏)
 *   props.glint:  true → 礁石上亮亮的小星星 / 小船痕迹
 *   props.map:    true → 奖杯底座上的新地图
 *   hero:          给主角 A 单独下一个动作（如 'nod'），不影响说话人镜头
 *   shot:          强制切到某个镜头（如开场 'wide3' 三人同框）
 */

export const BEAT_SHAPE = Object.freeze({
  id: 'c2-01',
  speaker: 'character-id',
  text: '中文台词',
  action: 'nod',
  voice: 'c2-01',
  stage: null,
});

export const CHAPTER_02 = Object.freeze({
  id: 'chapter-02',
  index: 2,
  title: '第二章 · 阳光沙滩大冒险',
  shortTitle: '阳光沙滩大冒险',
  subtitle: '奖杯不见了！沿着阳光海岸去把它找回来',
  courseId: 'beach',
  characters: Object.freeze(['lighthouse-grandpa', 'flash-little-red', 'hero-a']),

  /* ------------------------------ 开场 ------------------------------ */
  intro: Object.freeze({
    id: 'c2-intro',
    beats: Object.freeze([
      Object.freeze({
        id: 'c2-01',
        speaker: 'lighthouse-grandpa',
        action: 'nod',
        // 三人同框开场，同时亮出空奖杯台
        stage: Object.freeze({ shot: 'wide3', props: { trophy: 'empty' } }),
        text: '哎呀呀……出大事啦！海滩赛车节的冠军奖杯，不见了！',
        voice: 'c2-01',
      }),
      Object.freeze({
        id: 'c2-02',
        speaker: 'lighthouse-grandpa',
        action: 'sway',
        stage: Object.freeze({ props: { trophy: 'empty' } }),
        text: '今天早上我打开箱子，里面只剩下一串湿湿的脚印，还有一点点沙子。',
        voice: 'c2-02',
      }),
      Object.freeze({
        id: 'c2-03',
        speaker: 'flash-little-red',
        action: 'turnLeft',
        stage: Object.freeze({ props: { trophy: 'empty' } }),
        text: '咦？昨天晚上它还好好地放在这里的呀！',
        voice: 'c2-03',
      }),
      Object.freeze({
        id: 'c2-04',
        speaker: 'flash-little-red',
        action: 'turnRight',
        stage: Object.freeze({ props: { trophy: 'empty' } }),
        text: '湿脚印……沙子……会不会是往海边去了？',
        voice: 'c2-04',
      }),
      Object.freeze({
        id: 'c2-05',
        speaker: 'lighthouse-grandpa',
        action: 'nod',
        // 爷爷在跟主角 A 说话，让主角 A 点一下头
        stage: Object.freeze({ props: { trophy: 'empty' }, hero: 'nod' }),
        text: '孩子，能帮爷爷一个忙吗？沿着阳光海岸，把奖杯找回来。',
        voice: 'c2-05',
      }),
      Object.freeze({
        id: 'c2-06',
        speaker: 'flash-little-red',
        action: 'turnLeft',
        stage: Object.freeze({ props: { trophy: 'empty' } }),
        text: '嘿！我们一起去吧！你开车那么厉害，肯定追得上！',
        voice: 'c2-06',
      }),
      Object.freeze({
        id: 'c2-07',
        speaker: 'flash-little-red',
        action: 'nod',
        stage: Object.freeze({ props: { trophy: 'empty' } }),
        text: '沿着海岸有一场比赛，跑完就能拿到「贝壳湾」的通行证。',
        voice: 'c2-07',
      }),
      Object.freeze({
        id: 'c2-08',
        speaker: 'lighthouse-grandpa',
        action: 'nod',
        stage: Object.freeze({ props: { trophy: 'empty' } }),
        text: '路上有我年轻时候认识的老朋友，他们会帮你们的。',
        voice: 'c2-08',
      }),
      Object.freeze({
        id: 'c2-09',
        speaker: 'lighthouse-grandpa',
        action: 'nod',
        // 进入赛前提醒：把奖杯台收起来，画面回到三人
        stage: Object.freeze({ props: { trophy: 'none' } }),
        text: '记住哦，沙滩上的弯道和城里的石板路不一样。',
        voice: 'c2-09',
      }),
      Object.freeze({
        id: 'c2-10',
        speaker: 'lighthouse-grandpa',
        action: 'sway',
        stage: Object.freeze({ props: { trophy: 'none' } }),
        text: '沙子软，抓地力小，转弯要早点松油门。',
        voice: 'c2-10',
      }),
      Object.freeze({
        id: 'c2-11',
        speaker: 'lighthouse-grandpa',
        action: 'nod',
        stage: Object.freeze({ props: { trophy: 'none' } }),
        text: '还有那座木桥，桥面窄，过桥的时候别乱打方向！',
        voice: 'c2-11',
      }),
      Object.freeze({
        id: 'c2-12',
        speaker: 'flash-little-red',
        action: 'turnRight',
        stage: Object.freeze({ props: { trophy: 'none' }, hero: 'nod' }),
        text: '放心吧爷爷！我们出发啦！',
        voice: 'c2-12',
      }),
    ]),
    buttons: Object.freeze([
      Object.freeze({ id: 'start', label: '出发比赛！', kind: 'primary' }),
    ]),
  }),

  /* ------------------------------ 结尾 ------------------------------ */
  ending: Object.freeze({
    id: 'c2-end',
    beats: Object.freeze([
      Object.freeze({
        id: 'c2-13',
        speaker: 'lighthouse-grandpa',
        action: 'nod',
        stage: Object.freeze({ props: { trophy: 'none' } }),
        text: '好样的！跑得真快，比爷爷年轻的时候还稳！',
        voice: 'c2-13',
      }),
      Object.freeze({
        id: 'c2-14',
        speaker: 'flash-little-red',
        action: 'turnRight',
        // 线索：礁石上卡着亮亮的东西
        stage: Object.freeze({ props: { trophy: 'none', glint: true } }),
        text: '等等——你看那边！礁石上卡着一样亮亮的东西！',
        voice: 'c2-14',
      }),
      Object.freeze({
        id: 'c2-15',
        speaker: 'lighthouse-grandpa',
        action: 'nod',
        stage: Object.freeze({ props: { trophy: 'none', glint: true } }),
        text: '那是……冠军奖杯上掉下来的小星星！',
        voice: 'c2-15',
      }),
      Object.freeze({
        id: 'c2-16',
        speaker: 'flash-little-red',
        action: 'turnRight',
        stage: Object.freeze({ props: { trophy: 'none', glint: true } }),
        text: '星星旁边还有一条小船划走的痕迹，一直通向礁石后面！',
        voice: 'c2-16',
      }),
      Object.freeze({
        id: 'c2-17',
        speaker: 'flash-little-red',
        action: 'nod',
        // 找回奖杯：台上出现奖杯，主角 A 点头
        stage: Object.freeze({ props: { trophy: 'found' }, hero: 'nod' }),
        text: '找到啦！奖杯就卡在礁石缝里，还好一点都没有摔坏！',
        voice: 'c2-17',
      }),
      Object.freeze({
        id: 'c2-18',
        speaker: 'lighthouse-grandpa',
        action: 'nod',
        stage: Object.freeze({ props: { trophy: 'found' } }),
        text: '原来是一条小船被浪打偏，把奖杯一路带到了这里。',
        voice: 'c2-18',
      }),
      Object.freeze({
        id: 'c2-19',
        speaker: 'lighthouse-grandpa',
        action: 'sway',
        stage: Object.freeze({ props: { trophy: 'found' } }),
        text: '谢谢你们！海滩赛车节，可以照常开幕啦！',
        voice: 'c2-19',
      }),
      Object.freeze({
        id: 'c2-20',
        speaker: 'flash-little-red',
        action: 'turnLeft',
        stage: Object.freeze({ props: { trophy: 'found' } }),
        text: '这一届的冠军，我们下次再一起挑战吧！',
        voice: 'c2-20',
      }),
      Object.freeze({
        id: 'c2-21',
        speaker: 'lighthouse-grandpa',
        action: 'nod',
        // 伏笔：奖杯底座上刻着一张新地图（为第三章埋线）
        stage: Object.freeze({ props: { trophy: 'found', map: true } }),
        text: '对了……奖杯底座上，好像刻着一张新的地图呢。',
        voice: 'c2-21',
      }),
    ]),
    buttons: Object.freeze([
      Object.freeze({ id: 'again', label: '再来一局', kind: 'primary' }),
      Object.freeze({ id: 'home', label: '返回首页', kind: 'ghost' }),
    ]),
  }),
});

export default CHAPTER_02;
