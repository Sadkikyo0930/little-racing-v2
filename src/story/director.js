import { getCharacter } from '../characters/characters.js';
import { SPEAKER_STYLE } from './chapter1.js';

/**
 * 剧情导演 —— 把「一句对白」需要的所有副作用串起来：
 *   字幕、说话人高亮、镜头推近、角色动作、配音、背景音乐压低。
 *
 * 设计要求（逐条对应验收项）：
 *   · 「下一句」手动推进；点了就把当前配音停掉，绝不出现两段声音叠在一起。
 *   · 「跳过剧情」随时退出到选项（出发比赛 / 再来一局 / 返回首页）。
 *   · 配音放完后**允许**自动接下一句，但会留 1.2 秒；玩家手动点过就取消
 *     这个定时器，不会出现「还没看完就被翻页」。
 *   · 没有配音文件 / 静音时只显示字幕，什么都不会回退到 TTS。
 *   · 配音被浏览器拦下（iOS 自动播放策略）时，如实通知 UI 显示
 *     「点击播放语音」，而不是假装播过、也不替玩家翻页。
 *   · stage 可以是 null（模型加载失败）—— 那样就退化成纯字幕剧情，不卡死。
 *
 * 注意：**不再覆盖 `voice.onSpeaking`**。那个槽位由 main.js 独占（音乐压低），
 * 导演通过 `voice.on('start'|'end'|'blocked')` 订阅自己关心的事件，
 * 多个导演实例之间不会互相踩掉回调。
 */
export class StoryDirector {
  constructor({ stage, ui, voice, music }) {
    this.stage = stage || null;
    this.ui = ui;
    this.voice = voice;
    this.music = music;

    this.segment = null;
    this.i = 0;
    this.beat = null;
    this.beatT = 0;
    this.scheduleList = [];
    this.choiceMode = false;
    this.onChoice = null;

    this._waitVoice = false;      // 正在等这一句的配音结束
    this._autoTimer = null;
    this._voiceReady = false;
    this._blocked = false;        // 配音被系统拦下，需要玩家点一下
    this._offs = [];

    if (this.voice?.on) {
      this._offs.push(this.voice.on('start', ({ id }) => this._onVoiceStart(id)));
      this._offs.push(this.voice.on('end', ({ id, reason }) => this._onVoiceEnd(id, reason)));
      this._offs.push(this.voice.on('blocked', () => this._onBlocked()));
    }
  }

  get active() { return !!this.segment; }

  /** 播放一段剧情（开场 / 结尾）。返回第一句。 */
  play(segment) {
    this.segment = segment;
    this.i = 0;
    this.choiceMode = false;
    this._voiceReady = !!this.voice?.isReady?.();
    this.ui.setVoiceReady(this._voiceReady);
    this._setBlocked(false);
    /* 把本段的配音范围告诉 VoiceManager：
     *  · 只预取这一段会用到的文件，避免 iPhone Safari 首次手势并发解码全库
     *    （第一章 6 条 + 第二章 21 条）；
     *  · 段标识变化时，若上一章/上一段仍有声音在播，会被立刻掐断，
     *    不允许「上一章声音延续到下一章」。
     * 第一章的 beat 同样带 voice 字段，因此两章都走同一条路径。 */
    this.voice?.setChapter?.(
      segment.beats.map((b) => b.voice).filter(Boolean),
      `${segment.id || 'segment'}:${segment.beats.length}`,
    );
    this.ui.showLine();
    this._show(0);
    return this.beat;
  }

  _show(index) {
    const seg = this.segment;
    const beat = seg.beats[index];
    this.beat = beat;
    this.beatT = 0;
    this.scheduleList = (beat.schedule || []).map((s) => ({ ...s, fired: false }));

    const char = getCharacter(beat.speaker);
    const style = SPEAKER_STYLE[beat.speaker] || {};
    this.ui.setSpeaker(char ? char.name : beat.speaker, style.color);
    this.ui.setText(beat.text);

    if (this.stage) {
      /* 第二章的 beat 可能带 stage 提示：
       *   stage.shot  → 强制切到某个镜头（如开场 'wide3' 三人同框）
       *   stage.props → 切道具（空奖杯台 / 找回的奖杯 / 礁石微光 / 新地图）
       *   stage.hero  → 给主角 A 单独下一个动作（不影响说话人镜头）
       * 第一章的 beat 没有 stage 字段，全部走 else 分支，行为不变。 */
      if (beat.stage?.shot) this.stage.setShot(beat.stage.shot);
      else this.stage.speaker(beat.speaker);
      this.stage.setAction(beat.speaker, beat.action || 'nod');
      if (beat.stage?.props) this.stage.applyProps(beat.stage.props);
      if (beat.stage?.hero) this.stage.actorAction('hero-a', beat.stage.hero);
    }

    /* 语音：先判断「这一句本来该不该出声」。
     * 只有文件存在、未静音、配音开关打开时才等它结束；
     * 否则（或播放被拒）绝不拦住剧情推进。 */
    this._waitVoice = !!(beat.voice && this.voice?.has?.(beat.voice) && this.voice.wantsSound?.());
    if (this._waitVoice) this.voice.play(beat.voice);
  }

  /** 每帧推进「同一句里的连续动作」 */
  update(dt) {
    if (!this.segment || this.choiceMode) return;
    this.beatT += Math.min(Math.max(dt || 0, 0), 0.1);
    if (!this.stage || !this.beat) return;
    for (const s of this.scheduleList) {
      if (!s.fired && this.beatT >= s.at) {
        s.fired = true;
        this.stage.setAction(this.beat.speaker, s.action);
      }
    }
  }

  /* ------------------------ 配音事件 ------------------------ */

  _onVoiceStart() {
    this._setBlocked(false);
    this._waitVoice = true;
  }

  _onVoiceEnd(id, reason) {
    // 我们自己停的（切句 / 跳过 / 静音 / 退出）不算「这一句放完了」
    if (reason === 'stopped') return;
    // 只关心「当前这句」；别的（比如比赛里的逆行播报）跟我们无关
    if (!this._waitVoice || (this.beat?.voice && id !== this.beat.voice)) return;
    this._waitVoice = false;
    if (this.choiceMode) return;
    if (reason === 'ended') {
      // 只在「这一句确实完整放过」时才自动接下一句：六段配音最短的
      // wrong-way 也有 3 秒，1.5 秒内就结束说明是被拦/文件坏了，不能替玩家翻页。
      if (this.beatT >= 1.5) this._armAutoNext();
    } else if (reason === 'error') {
      this._setBlocked(true);         // 文件坏了也给玩家一个「再点一次」的出口
    }
  }

  _onBlocked() {
    this._setBlocked(true);
  }

  _setBlocked(on) {
    on = !!on;
    if (this._blocked === on) return;
    this._blocked = on;
    this.ui.setVoiceBlocked?.(on);
  }

  /** 「点击播放语音」：用这一次真实点击重新解锁 + 重播当前句。 */
  replayVoice() {
    if (!this.segment || this.choiceMode) return false;
    const id = this.beat?.voice;
    if (!id) return false;
    this.voice?.unlock?.();
    const ok = !!this.voice?.play?.(id);
    if (ok || this.voice?.pendingId === id) this._waitVoice = true;
    return ok;
  }

  /** 下一句。manual=false 表示由「语音播完」触发。 */
  next(manual = true) {
    if (!this.segment || this.choiceMode) return false;
    if (manual) this._cancelAuto();

    this._waitVoice = false;
    this.voice?.stop?.();          // 手动翻页先掐掉当前这句，避免声音叠加

    if (this.i + 1 >= this.segment.beats.length) {
      this._finish();
      return true;
    }
    this.i += 1;
    this._show(this.i);
    return true;
  }

  /** 跳过剧情：直接到这一段后面的选项按钮。 */
  skip() {
    if (!this.segment || this.choiceMode) return false;
    this._cancelAuto();
    this._waitVoice = false;
    this.voice?.stop?.();
    this._finish();
    return true;
  }

  _finish() {
    this.choiceMode = true;
    this._setBlocked(false);
    const seg = this.segment;
    if (this.stage) this.stage.rest();
    this.ui.showChoices(seg.buttons, (id) => {
      this.onChoice?.(id, seg);
    });
  }

  _armAutoNext() {
    this._cancelAuto();
    this._autoTimer = setTimeout(() => {
      this._autoTimer = null;
      this.next(false);
    }, 1200);
  }

  _cancelAuto() {
    if (this._autoTimer) {
      clearTimeout(this._autoTimer);
      this._autoTimer = null;
    }
  }

  stop() {
    this._cancelAuto();
    this._waitVoice = false;
    this.voice?.stop?.();
    this.voice?.clearChapter?.();   // 退出剧情：预加载范围收回基础集
    this.music?.setDuck?.(false);
    for (const off of this._offs) { try { off(); } catch { /* 忽略 */ } }
    this._offs.length = 0;
    this.segment = null;
    this.beat = null;
    this.choiceMode = false;
    this._setBlocked(false);
    this.ui.setResultLine('');
  }

  debug() {
    return {
      active: this.active,
      segment: this.segment?.id || null,
      index: this.i,
      total: this.segment?.beats?.length || 0,
      choiceMode: this.choiceMode,
      beat: this.beat ? { id: this.beat.id } : null,
      speaker: this.beat?.speaker || null,
      text: this.beat?.text || '',
      voiceReady: this._voiceReady,
      lastVoicePlayed: this._waitVoice,
      voiceId: this.beat?.voice || null,
      voiceBlocked: this._blocked,
      beatT: +this.beatT.toFixed(2),
      beats: this.segment?.beats?.map((b) => b.id) || [],
    };
  }
}

export default StoryDirector;
