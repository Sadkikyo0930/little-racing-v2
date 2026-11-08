/**
 * 第一章《海滨赛车节开幕》— 剧情脚本数据
 *
 * 这是纯数据：不含 three.js、不解析路径、不播放任何东西。
 * 导演（src/story/director.js）读它来推进对白，舞台（src/story/stage.js）
 * 读它来切换镜头与角色动作。
 *
 * ── 对白来源 ────────────────────────────────────────────────────
 * 全部来自本轮任务的指定台词，一字不改（含标点）。
 *
 * ── 角色动作 ────────────────────────────────────────────────────
 * 只用已经验收过的免绑骨动作：站立 / 轻微摆动 / 点头 / 左转 60° / 右转 60°。
 * 挥手（wave）已在《NPC 动作修正》里彻底删除，本文件不引用，也不允许
 * 后续为了剧情需要又把它加回来 —— 要做挥手必须先检查拓扑、关节分离与
 * 骨骼权重，单独制作并验收。
 *
 * `schedule` 是「同一句台词里的连续动作」：例如闪电小红说到「下次我们
 * 一起去阳光沙滩冒险吧」时先右转看向远处的沙滩，再转回来轻轻点头。
 * 转身一律是四元数插值到目标角度后停住，不会转满一圈。
 */

/** 一句对白的结构（文档用，运行时不做校验）。 */
export const BEAT_SHAPE = Object.freeze({
  id: 'c1-01',           // 语音文件名 = `${id}.mp3`
  speaker: 'character-id',
  text: '中文台词',
  action: 'nod',         // 初始动作
  schedule: [],          // [{ at: 秒, action: 'id' }] 可选
});

export const CHAPTER_01 = Object.freeze({
  id: 'chapter-01',
  index: 1,
  title: '第一章 · 海滨赛车节开幕',
  shortTitle: '海滨赛车节开幕',
  subtitle: '灯塔爷爷主持开幕，闪电小红陪你出发',
  courseId: 'viejo',
  characters: Object.freeze(['lighthouse-grandpa', 'flash-little-red']),

  /* ------------------------------ 开场 ------------------------------ */
  intro: Object.freeze({
    id: 'c1-intro',
    beats: Object.freeze([
      Object.freeze({
        id: 'c1-01',
        speaker: 'lighthouse-grandpa',
        action: 'nod',
        text: '欢迎来到海滨岛！一年一度的赛车节就要开始啦！',
        voice: 'c1-01',
      }),
      Object.freeze({
        id: 'c1-02',
        speaker: 'flash-little-red',
        action: 'nod',
        // 介绍自己的时候先转向身边的爷爷，再转回来 —— 展示自然转身，
        // 转到目标就停住，不是原地转圈。
        schedule: Object.freeze([{ at: 0.0, action: 'turnLeft' }, { at: 2.2, action: 'nod' }]),
        text: '你好呀！我是闪电小红！今天我们一起参加比赛吧！',
        voice: 'c1-02',
      }),
      Object.freeze({
        id: 'c1-03',
        speaker: 'lighthouse-grandpa',
        action: 'nod',
        text: '遇到弯道要慢一点哦！准备好了吗？',
        voice: 'c1-03',
      }),
    ]),
    buttons: Object.freeze([
      Object.freeze({ id: 'start', label: '出发比赛！', kind: 'primary' }),
    ]),
  }),

  /* ------------------------------ 结尾 ------------------------------ */
  ending: Object.freeze({
    id: 'c1-end',
    beats: Object.freeze([
      Object.freeze({
        id: 'c1-04',
        speaker: 'lighthouse-grandpa',
        action: 'nod',
        text: '太棒啦！你顺利完成了第一场比赛！',
        voice: 'c1-04',
      }),
      Object.freeze({
        id: 'c1-05',
        speaker: 'flash-little-red',
        action: 'turnRight',
        // 先右转看向远处的阳光沙滩，再转回来点头。
        schedule: Object.freeze([{ at: 0.0, action: 'turnRight' }, { at: 2.4, action: 'nod' }]),
        text: '你开得真不错！下次我们一起去阳光沙滩冒险吧！',
        voice: 'c1-05',
      }),
    ]),
    buttons: Object.freeze([
      Object.freeze({ id: 'again', label: '再来一局', kind: 'primary' }),
      Object.freeze({ id: 'home', label: '返回首页', kind: 'ghost' }),
    ]),
  }),
});

/** 逆行提醒台词（与语音接口按 id 对应）。 */
export const WRONG_WAY_LINE = Object.freeze({
  id: 'wrong-way',
  speaker: 'flash-little-red',
  action: 'nod',
  text: '哎呀！方向反啦！快掉头哦！',
  voice: 'wrong-way',
});

/** 面板宽度、说话人配色等展示参数（UI 层读取）。 */
export const SPEAKER_STYLE = Object.freeze({
  'lighthouse-grandpa': Object.freeze({ color: '#7fd4ff', accent: '#2b6f9c' }),
  'flash-little-red': Object.freeze({ color: '#ffb347', accent: '#a8382a' }),
  // 主角 A：第二章三人同框时也要有说话人配色（不写这里会落到默认灰）
  'hero-a': Object.freeze({ color: '#ffe066', accent: '#b8860b' }),
});

export default CHAPTER_01;
