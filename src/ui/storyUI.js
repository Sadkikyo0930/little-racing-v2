/**
 * 剧情界面 — 纯 DOM，挂在 #ui 里。
 *
 * 布局原则（iPhone 横屏优先）：
 *   · 字幕条只占屏幕下方约 20%，人物脸部稳定在画面上半部，两者不重叠。
 *   · 按钮最小 44×44 触控面积，双拇指都够得到。
 *   · 左右留出安全区（刘海 / home indicator）。
 *   · 不新增任何会挡住比赛 HUD 的常驻元素 —— 这一层只在剧情状态出现。
 */

const TEMPLATE = /* html */ `
<div id="storyFade" aria-hidden="true"></div>
<div id="story" class="hidden">
  <div class="storyTop">
    <span class="storyChip" id="storyChapter">第一章 · 海滨赛车节开幕</span>
    <span class="storyVoiceChip hidden" id="storyVoiceChip">字幕模式</span>
    <!-- Safari 拦下自动播放时，给玩家一个明确的出口：点一下就把这句读出来。
         不假装播过，也不回退到系统机器人朗读。 -->
    <button id="storyVoiceTap" class="hidden" type="button">
      <span class="vtIcon" aria-hidden="true">🔊</span>点击播放语音
    </button>
  </div>
  <button id="storySkip" type="button">跳过剧情</button>
  <!-- 3D 舞台加载失败时的降级说明：不假装有画面，也不让页面看起来是坏的 -->
  <div id="storyFallback" class="hidden">
    <span class="fbTag">绘本模式</span>
    <p class="fbText">画面暂时载入不出来，先用字幕把故事讲完</p>
  </div>
  <div id="storyPanel">
    <div class="storyBody">
      <span class="storyName" id="storyName">灯塔爷爷</span>
      <p class="storyText" id="storyText"></p>
    </div>
    <div class="storyActions" id="storyActions">
      <button id="storyNext" class="stBtn primary" type="button">下一句</button>
    </div>
  </div>
</div>
`;

export class StoryUI {
  constructor(root) {
    const box = document.createElement('div');
    box.innerHTML = TEMPLATE;
    while (box.firstElementChild) root.appendChild(box.firstElementChild);

    this.el = {
      fade: root.querySelector('#storyFade'),
      root: root.querySelector('#story'),
      chapter: root.querySelector('#storyChapter'),
      voiceChip: root.querySelector('#storyVoiceChip'),
      voiceTap: root.querySelector('#storyVoiceTap'),
      skip: root.querySelector('#storySkip'),
      panel: root.querySelector('#storyPanel'),
      name: root.querySelector('#storyName'),
      text: root.querySelector('#storyText'),
      actions: root.querySelector('#storyActions'),
      fallback: root.querySelector('#storyFallback'),
    };

    this.onSkip = null;
    this.onNext = null;
    this.onChoice = null;
    this.onVoiceTap = null;
    this._choiceBtns = [];
    this._nextVisible = true;

    this.el.skip.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onSkip?.();
    });
    this.el.voiceTap.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onVoiceTap?.();
    });
    this.el.nextBtn = root.querySelector('#storyNext');
    this.el.nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._mode === 'choice') return;
      this.onNext?.();
    });
  }

  /* ------------------------------ 显示 ------------------------------ */

  show() { this.el.root.classList.remove('hidden'); }
  hide() { this.el.root.classList.add('hidden'); }

  /** 没有 3D 舞台（模型加载失败）时的字幕回退背景。 */
  setStageLess(on) {
    this.el.root.classList.toggle('no-stage', !!on);
    this.el.fallback?.classList.toggle('hidden', !on);
  }

  setChapter(text) {
    if (text) this.el.chapter.textContent = text;
  }

  /** 配音是否就绪 —— 不就绪时如实标注「字幕模式」，不假装有声音。 */
  setVoiceReady(ok) {
    this.el.voiceChip.classList.toggle('hidden', !!ok);
  }

  /**
   * 配音被系统拦下 / 文件出错时，显示「点击播放语音」。
   * 这是**如实上报**：声音没出来就说出来，并给一个明确的自救按钮。
   */
  setVoiceBlocked(on) {
    this.el.voiceTap?.classList.toggle('hidden', !on);
  }

  /** 加载中：藏起名字牌和按钮，只留一行状态文字。 */
  setBusy(on) {
    this.el.root.classList.toggle('busy', !!on);
  }

  setSpeaker(name, color) {
    this.el.name.textContent = name;
    this.el.name.style.color = color || '#ffd66b';
    this.el.name.style.borderColor = color ? `${color}66` : 'rgba(255,214,107,.4)';
  }

  setText(text) {
    this.el.text.textContent = text;
  }

  /** 一行成绩，结尾剧情顶部显示（不是奖励系统，只是本轮结果）。 */
  setResultLine(text) {
    this.el.chapter.dataset.result = text || '';
  }

  /* ------------------------------ 按钮 ------------------------------ */

  _clearActions() {
    for (const b of this._choiceBtns) b.remove();
    this._choiceBtns = [];
    this.el.nextBtn.classList.remove('hidden');
    this.el.nextBtn.textContent = '下一句';
    this._mode = 'line';
  }

  /** 正常对白态：只显示「下一句」。 */
  showLine() {
    this._clearActions();
    this._mode = 'line';
    this.el.skip.classList.remove('hidden');
    this.setVoiceBlocked(false);
  }

  /**
   * 选项态：底部换成剧本声明的按钮（出发比赛！/ 再来一局 / 返回首页）。
   * 这时候「下一句」隐藏，「跳过剧情」也隐藏 —— 已经没得跳了。
   */
  showChoices(buttons, onPick) {
    this._clearActions();
    this._mode = 'choice';
    this.el.nextBtn.classList.add('hidden');
    this.el.skip.classList.add('hidden');
    this.onChoice = onPick;
    for (const spec of buttons) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `stBtn ${spec.kind === 'primary' ? 'primary' : 'ghost'}`;
      b.textContent = spec.label;
      b.dataset.choice = spec.id;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        onPick?.(spec.id);
      });
      this.el.actions.appendChild(b);
      this._choiceBtns.push(b);
    }
  }

  /* ------------------------------ 黑场 ------------------------------ */

  /** 0 = 透明，1 = 全黑。返回 Promise，转场可以 await。 */
  fade(to, ms = 320) {
    const el = this.el.fade;
    el.style.transition = `opacity ${ms}ms ease`;
    el.classList.toggle('on', to >= 0.5);
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; clearTimeout(t); resolve(); } };
      el.addEventListener('transitionend', finish, { once: true });
      const t = setTimeout(finish, ms + 90);
    });
  }

  /* --------------------------- 测试观测 --------------------------- */

  measure() {
    const r = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), bottom: +b.bottom.toFixed(1) };
    };
    return {
      viewport: { w: innerWidth, h: innerHeight },
      panel: r(this.el.panel),
      name: r(this.el.name),
      text: r(this.el.text),
      skip: r(this.el.skip),
      next: this.el.nextBtn.classList.contains('hidden') ? null : r(this.el.nextBtn),
      choices: this._choiceBtns.map((b) => ({ id: b.dataset.choice, label: b.textContent, ...r(b) })),
      mode: this._mode,
      speaker: this.el.name.textContent,
      line: this.el.text.textContent,
      voiceReady: !this.el.voiceChip.classList.contains('hidden') ? false : true,
      voiceTap: this.el.voiceTap && !this.el.voiceTap.classList.contains('hidden')
        ? r(this.el.voiceTap) : null,
    };
  }
}

export default StoryUI;
