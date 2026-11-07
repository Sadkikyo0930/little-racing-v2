import { CHARACTERS } from '../kart/model.js';
import { ITEMS } from '../items/items.js';
import { formatTime } from '../race/race.js';

/* ------------------------------------------------------------------ *
 * DOM heads-up display, menus and results.
 * Kept out of WebGL so text stays crisp at any resolution.
 *
 * 小小赛车 V2 — every player-facing string is Simplified Chinese.
 * ------------------------------------------------------------------ */

/** mph → km/h (the kart model exposes mph, we show metric). */
const MPH_TO_KMH = 1.609344;

export class HUD {
  constructor(root) {
    this.root = root;
    this.root.innerHTML = TEMPLATE;
    this.el = {
      title: root.querySelector('#title'),
      select: root.querySelector('#select'),
      grid: root.querySelector('#charGrid'),
      courseSelect: root.querySelector("#courseSelect"),
      courseGrid: root.querySelector('#courseGrid'),
      hud: root.querySelector('#hud'),
      muteBtn: root.querySelector('#muteBtn'),
      pos: root.querySelector('#pos .value'),
      lap: root.querySelector('#lap .value'),
      lapTotal: root.querySelector('#lap .total'),
      time: root.querySelector('#time'),
      speed: root.querySelector('#speedValue'),
      speedArc: root.querySelector('#speedArc'),
      itemSlot: root.querySelector('#itemSlot'),
      itemIcon: root.querySelector('#itemIcon'),
      standings: root.querySelector('#standings'),
      minimap: root.querySelector('#minimap'),
      countdown: root.querySelector('#countdown'),
      toast: root.querySelector('#toast'),
      results: root.querySelector('#results'),
      resultsBody: root.querySelector('#resultsBody'),
      resultBig: root.querySelector('#resultBig'),
      yourPos: root.querySelector('#yourPos'),
      lapFlash: root.querySelector('#lapFlash'),
      boostBar: root.querySelector('#boostFill'),
      touch: root.querySelector('#touch'),
      musicBtn: root.querySelector('#musicBtn'),
      musicSettings: root.querySelector('#musicSettings'),
      musicToggle: root.querySelector('#musicToggle'),
      musicVolume: root.querySelector('#musicVolume'),
      musicVolumeValue: root.querySelector('#musicVolumeValue'),
      musicClose: root.querySelector('#musicClose'),
      wrongWay: root.querySelector('#wrongWay'),
      storyBtn: root.querySelector('#storyBtn'),
      storyBadge: root.querySelector('#storyBadge'),
      storyBtn2: root.querySelector('#storyBtn2'),
      storyBadge2: root.querySelector('#storyBadge2'),
      quitRaceBtn: root.querySelector('#quitRaceBtn'),
      garageBtn: root.querySelector('#garageBtn'),
      garageCoins: root.querySelector('#garageBtnCoinsNum'),
      coinReward: root.querySelector('#coinReward'),
      crAmount: root.querySelector('#crAmount'),
      crTotal: root.querySelector('#crTotal'),
    };
    this.ctx = this.el.minimap.getContext('2d');
    this.rollTimer = 0;
    this.selected = 0;
    this.gameMode = 'kids';
    this.musicOpen = false;
    this._musicEnabled = true;
    this.vehicle = 'red';
    this._buildCharacters();
    this._bindMute();
    this._bindMode();
    this._bindMusicSettings();
    this.el.garageBtn?.addEventListener('click', () => this.onGarage?.());
    this.speedArcLen = 0;
  }

  /* ------------------------------ menus ---------------------------- */
  _buildCharacters() {
    this.el.grid.innerHTML = CHARACTERS.map((c, i) => `
      <button class="char" data-i="${i}" style="--c:#${c.body.toString(16).padStart(6, '0')};--a:#${c.accent.toString(16).padStart(6, '0')}">
        <span class="charFace"></span>
        <span class="charName">${c.name}</span>
        <span class="charTag">${c.tag}</span>
        <span class="charStats">
          ${statBar('速度', c.stats.speed)}
          ${statBar('加速', c.stats.accel)}
          ${statBar('抓地', c.stats.grip)}
          ${statBar('力量', c.stats.weight)}
        </span>
      </button>`).join('');
  }

  /**
   * 首页。opts.onStory = 「故事冒险」入口；opts.storyLabel = 章节进度文字。
   * 「开始游戏」仍然是原来的自由比赛流程，一行代码都没改。
   */
  showTitle(onStart, opts = {}) {
    this.el.title.classList.remove('hidden');
    this.el.title.querySelector('#playBtn').onclick = () => {
      this.el.title.classList.add('hidden');
      // Deliberately does NOT reveal #select — the track picker comes first,
      // and both panels are z-index:auto, so an early reveal would stack the
      // character grid on top of the course cards and swallow their clicks.
      onStart();
    };
    if (this.el.storyBtn) {
      this.el.storyBtn.disabled = !!opts.storyDisabled;
      this.el.storyBtn.classList.toggle('disabled', !!opts.storyDisabled);
      this.el.storyBtn.onclick = () => {
        if (opts.storyDisabled) return;
        this.el.title.classList.add('hidden');
        opts.onStory?.();
      };
      if (this.el.storyBadge && opts.storyLabel) {
        this.el.storyBadge.textContent = opts.storyLabel;
      }
      this.el.storyBtn.classList.toggle('done', opts.storyState === 'done');
    }
    if (this.el.storyBtn2) {
      this.el.storyBtn2.disabled = !!opts.storyDisabled2;
      this.el.storyBtn2.classList.toggle('disabled', !!opts.storyDisabled2);
      this.el.storyBtn2.classList.toggle('locked', !!opts.storyDisabled2);
      this.el.storyBtn2.onclick = () => {
        if (opts.storyDisabled2) return;
        this.el.title.classList.add('hidden');
        opts.onStory2?.();
      };
      if (this.el.storyBadge2 && opts.storyLabel2) {
        this.el.storyBadge2.textContent = opts.storyLabel2;
      }
      this.el.storyBtn2.classList.toggle('done', opts.storyState2 === 'done');
    }
  }

  /** 首页章节进度文字（从剧情回来时刷新）。 */
  setStoryLabel(label, state) {
    if (this.el.storyBadge && label) this.el.storyBadge.textContent = label;
    this.el.storyBtn?.classList.toggle('done', state === 'done');
  }

  /** 第二章进度文字刷新（从剧情回来、或解锁后）。 */
  setStoryLabel2(label, state) {
    if (this.el.storyBadge2 && label) this.el.storyBadge2.textContent = label;
    this.el.storyBtn2?.classList.toggle('done', state === 'done');
  }

  /**
   * Track picker. Choosing a different circuit reloads the page with a
   * ?course= override: the whole world (track, scenery, terrain, clearance
   * bake) is built once at boot, and rebuilding it in place would mean a
   * teardown path for every one of those systems for no visible gain — the
   * loading screen already covers the couple of seconds it takes.
   */
  showCourses(courses, currentId, onPick) {
    this.el.title.classList.add('hidden');
    this.el.courseSelect.classList.remove('hidden');
    this.el.courseGrid.innerHTML = courses.map((c) => `
      <button class="course${c.id === currentId ? ' on' : ''}" data-id="${c.id}">
        <span class="courseFlag">${c.flag}</span>
        <span class="courseName">${c.name}</span>
        <span class="courseSub">${c.subtitle}</span>
        <span class="courseBlurb">${c.blurb}</span>
        <span class="courseMeta">共 ${c.laps} 圈${c.traffic ? ' &middot; 有车流' : ''}</span>
      </button>`).join('');
    for (const b of this.el.courseGrid.querySelectorAll('.course')) {
      b.onclick = () => {
        this.el.courseSelect.classList.add('hidden');
        onPick(b.dataset.id);
      };
    }
  }

  showSelect(onPick) {
    this.el.select.classList.remove('hidden');
    const buttons = [...this.el.grid.querySelectorAll('.char')];
    const mark = (i) => buttons.forEach((b, j) => b.classList.toggle('on', i === j));
    mark(this.selected);
    buttons.forEach((b) => {
      b.onmouseenter = () => { this.selected = +b.dataset.i; mark(this.selected); onPick?.preview?.(this.selected); };
      b.onclick = () => {
        this.selected = +b.dataset.i;
        this.el.select.classList.add('hidden');
        onPick.confirm(this.selected);
      };
    });
  }

  showHUD() {
    this.el.hud.classList.remove('hidden');
    // clear anything left over from the previous race
    clearTimeout(this._toastT);
    this.el.toast.className = '';
    this.el.toast.textContent = '';
    if (this.el.wrongWay) this.el.wrongWay.className = '';
  }

  /** 返回首页（软返回，不重载页面，音乐才能连续切回首页曲）。 */
  hideHUD() { this.el.hud.classList.add('hidden'); }
  /** 收起首页大标题。剧情 / 比赛都自己负责收，不要依赖按钮的点击回调，
   *  否则从代码路径直接进剧情时首页会残留在画面上。 */
  hideTitle() { this.el.title?.classList.add('hidden'); }
  hideResults() { this.el.results.classList.add('hidden'); }

  _bindMute() {
    this.el.muteBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onMuteToggle?.();
    });
  }

  /** 小小赛车 V2 — pick 轻松模式 (default) or 普通模式 from the title. */
  _bindMode() {
    const btns = this.root.querySelectorAll('.modeBtn');
    btns.forEach((b) => {
      b.addEventListener('click', () => {
        this.gameMode = b.dataset.mode;
        btns.forEach((x) => x.classList.toggle('on', x === b));
      });
    });
  }

  /* ------------------------ 车型（由车库决定） ------------------------ *
   * 首页不再有车型选择行 —— 车在「我的车库」里挑，选完回首页开始比赛。
   * 这里只保留一个状态位 + 显示更新，供 main.js 决定出场哪台车。 */
  setVehicle(v) {
    this.vehicle = (v === 'turtle' || v === 'moto') ? v : 'red';
    /* 海龟车 / 闪电小摩托固定用「闪电小红」那份性能数据，所以角色格的下标
     * 必须跟着走，否则刷新后车库写着摩托、hud.selected 还停在上次选的角色。 */
    if (this.vehicle !== 'red') this.selected = 1;
  }

  /** 首页「我的车库」按钮上显示的金币余额。 */
  setCoins(n) {
    if (!this.el.garageCoins) return;
    this.el.garageCoins.textContent = Number(n || 0).toLocaleString('en-US');
  }

  /** Reflect the audio engine's mute state on the speaker button. */
  setMuted(muted) {
    const b = this.el.muteBtn;
    if (!b) return;
    b.textContent = muted ? '🔇' : '🔊';
    b.classList.toggle('off', !!muted);
  }

  /* ------------------------ 音乐设置面板 ------------------------ *
   * 只负责 DOM 呈现与事件转发，播放逻辑全在 src/audio/musicManager.js。 */
  _bindMusicSettings() {
    const btn = this.el.musicBtn;
    const panel = this.el.musicSettings;
    if (!btn || !panel) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setMusicPanel(!this.musicOpen);
    });
    this.el.musicClose?.addEventListener('click', () => this.setMusicPanel(false));
    panel.addEventListener('click', (e) => {
      if (e.target === panel) this.setMusicPanel(false);   // 点遮罩关闭
    });
    this.el.musicToggle?.addEventListener('click', () => {
      this.onMusicEnabledChange?.(!this._musicEnabled);
    });
    this.el.musicVolume?.addEventListener('input', () => {
      const pct = Number(this.el.musicVolume.value) || 0;
      if (this.el.musicVolumeValue) this.el.musicVolumeValue.textContent = `${pct}%`;
      this.onMusicVolumeChange?.(pct / 100);
    });
    this.el.quitRaceBtn?.addEventListener('click', () => {
      this.setMusicPanel(false);
      this.onQuitRace?.();
    });
  }

  /** 故事模式下才允许「退出比赛」—— 退出不会播结尾剧情。 */
  setQuitVisible(on) {
    this.el.quitRaceBtn?.classList.toggle('hidden', !on);
  }

  setMusicPanel(open) {
    this.musicOpen = !!open;
    this.el.musicSettings?.classList.toggle('hidden', !this.musicOpen);
  }

  /** 用 MusicManager 的当前状态刷新面板（含刷新后从 localStorage 恢复的值）。 */
  syncMusicSettings(state) {
    this._musicEnabled = !!state.enabled;
    const t = this.el.musicToggle;
    if (t) {
      t.textContent = state.enabled ? '开' : '关';
      t.classList.toggle('off', !state.enabled);
      t.setAttribute('aria-pressed', String(!!state.enabled));
    }
    const raw = Number(state.volume);
    const pct = Math.max(0, Math.min(100, Math.round((Number.isFinite(raw) ? raw : 1) * 100)));
    if (this.el.musicVolume) this.el.musicVolume.value = String(pct);
    if (this.el.musicVolumeValue) this.el.musicVolumeValue.textContent = `${pct}%`;
    this.el.musicBtn?.classList.toggle('muted', !!state.muted || !state.enabled);
  }

  /* ------------------------------ HUD ------------------------------ */
  update(dt, game) {
    const p = game.player;
    const race = game.race;

    this.el.pos.textContent = p.rank;
    this.el.lap.textContent = Math.min(race.laps, p.lap + 1);
    this.el.lapTotal.textContent = race.laps;
    this.el.time.textContent = formatTime(race.raceTime);

    // Metric readout: the kart model works in mph internally.
    const kmh = p.mph * MPH_TO_KMH;
    this.el.speed.textContent = Math.round(kmh);
    // Sweep scales to the kart's own top speed so the dial reads sensibly in
    // both 轻松模式 (capped) and 普通模式.
    const maxKmh = (p.cruiseSpeed || 33) * 3.6 * 1.2;
    const frac = Math.min(1, kmh / maxKmh);
    const len = 2 * Math.PI * 52 * 0.75;
    this.el.speedArc.style.strokeDasharray = `${len}`;
    this.el.speedArc.style.strokeDashoffset = `${len * (1 - frac)}`;
    this.el.speedArc.style.stroke = p.boostTime > 0 ? '#ffd23f' : (p.offroad ? '#c98a4a' : '#4fd6ff');

    // drift charge / boost meter
    const charge = p.drifting ? Math.min(1, p.driftCharge / 3.6) : (p.boostTime > 0 ? 1 : 0);
    this.el.boostBar.style.transform = `scaleX(${charge})`;
    this.el.boostBar.style.background = p.driftTier >= 3 ? '#ff3ad0'
      : p.driftTier === 2 ? '#ff9a2a' : '#66ccff';

    // item slot
    if (p.itemRolling > 0) {
      this.rollTimer += dt;
      if (this.rollTimer > 0.055) {
        this.rollTimer = 0;
        const keys = Object.keys(ITEMS);
        this.el.itemIcon.textContent = ITEMS[keys[Math.floor(Math.random() * keys.length)]].icon;
      }
      this.el.itemSlot.classList.add('rolling');
    } else {
      this.el.itemSlot.classList.remove('rolling');
      if (p.item) {
        this.el.itemIcon.textContent = ITEMS[p.item].icon;
        this.el.itemSlot.classList.add('has');
        this.el.itemSlot.dataset.charges = p.itemCharges > 0 ? `×${p.itemCharges + 1}` : '';
      } else {
        this.el.itemIcon.textContent = '';
        this.el.itemSlot.classList.remove('has');
        this.el.itemSlot.dataset.charges = '';
      }
    }

    // standings
    if (!this._standTimer || (this._standTimer -= dt) <= 0) {
      this._standTimer = 0.25;
      this.el.standings.innerHTML = (race.standings || game.karts)
        .map((k, i) => `<li class="${k.isPlayer ? 'me' : ''}">
            <b>${i + 1}</b>
            <i style="background:#${k.character.body.toString(16).padStart(6, '0')}"></i>
            <span>${k.name}</span>
          </li>`).join('');
    }

    this.drawMinimap(game);
  }

  drawMinimap(game) {
    const ctx = this.ctx;
    const cv = this.el.minimap;
    const size = cv.width;
    const t = game.track;
    if (!this._mapCache) {
      // pre-compute a normalised path
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < t.n; i += 8) {
        minX = Math.min(minX, t.pos[i * 3]); maxX = Math.max(maxX, t.pos[i * 3]);
        minZ = Math.min(minZ, t.pos[i * 3 + 2]); maxZ = Math.max(maxZ, t.pos[i * 3 + 2]);
      }
      const pad = 16;
      const sx = (size - pad * 2) / (maxX - minX);
      const sz = (size - pad * 2) / (maxZ - minZ);
      const s = Math.min(sx, sz);
      this._mapCache = {
        minX, minZ, s,
        ox: pad + ((size - pad * 2) - (maxX - minX) * s) / 2,
        oz: pad + ((size - pad * 2) - (maxZ - minZ) * s) / 2,
      };
    }
    const { minX, minZ, s, ox, oz } = this._mapCache;
    const P = (x, z) => [ox + (x - minX) * s, oz + (z - minZ) * s];

    ctx.clearRect(0, 0, size, size);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(8,12,20,0.75)';
    ctx.lineWidth = 11;
    ctx.beginPath();
    for (let i = 0; i <= t.n; i += 10) {
      const j = i % t.n;
      const [x, y] = P(t.pos[j * 3], t.pos[j * 3 + 2]);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(190,220,240,0.9)';
    ctx.lineWidth = 6;
    ctx.stroke();

    // start line
    const [sxp, syp] = P(t.pos[0], t.pos[2]);
    ctx.fillStyle = '#fff';
    ctx.fillRect(sxp - 4, syp - 4, 8, 8);

    for (const k of game.karts) {
      const [x, y] = P(k.position.x, k.position.z);
      ctx.beginPath();
      ctx.arc(x, y, k.isPlayer ? 6.5 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#' + k.character.body.toString(16).padStart(6, '0');
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = k.isPlayer ? '#fff' : 'rgba(0,0,0,0.6)';
      ctx.stroke();
    }
  }

  /* ---------------------------- messaging -------------------------- */
  countdown(n) {
    const el = this.el.countdown;
    el.textContent = n > 0 ? n : '';
    el.className = 'shown count';
    void el.offsetWidth;
    el.classList.add('pop');
    setTimeout(() => el.classList.remove('pop'), 600);
  }

  go() {
    const el = this.el.countdown;
    el.textContent = '出发！';
    el.className = 'shown go pop';
    setTimeout(() => { el.className = ''; }, 1100);
  }

  toast(text, cls = '') {
    const el = this.el.toast;
    el.textContent = text;
    el.className = 'shown ' + cls;
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { el.className = ''; }, 1600);
  }

  /** 逆行提醒：只显示中文，不承担「有没有配音」的职责（配音在 VoiceManager）。 */
  wrongWay(on) {
    const el = this.el.wrongWay;
    if (!el) return;
    clearTimeout(this._wwT);
    if (!on) { el.className = ''; return; }
    el.className = 'shown';
    this._wwT = setTimeout(() => { el.className = ''; }, 2600);
  }

  lapFlash(text) {
    const el = this.el.lapFlash;
    el.textContent = text;
    el.className = 'shown';
    clearTimeout(this._lapT);
    this._lapT = setTimeout(() => { el.className = ''; }, 1800);
  }

  /**
   * 结算面板。
   * @param {object|null} reward 金币奖励结果 { granted, amount, coins, reason }
   *   有就显示金币到账（数字滚一下），没有就不显示那一条。
   */
  results(race, player, onAgain, onHome, reward = null) {
    const rows = [...race.karts].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progressTotal - a.progressTotal;
    });
    this.el.resultsBody.innerHTML = rows.map((k, i) => `
      <li class="${k.isPlayer ? 'me' : ''}">
        <b>第${i + 1}</b>
        <i style="background:#${k.character.body.toString(16).padStart(6, '0')}"></i>
        <span>${k.name}</span>
        <em>${k.finished ? formatTime(k.finishTime) : '未完赛'}</em>
      </li>`).join('');

    const rank = player.finalRank || player.rank || 1;
    this.el.resultBig.textContent = rank === 1 ? '太棒了，你是冠军！' : '完成比赛啦！';
    this.el.resultBig.classList.toggle('win', rank === 1);
    this.el.yourPos.textContent = `第 ${rank} 名`;

    this.el.results.querySelector('#bestLap').textContent = formatTime(race.bestLap());

    this._renderCoinReward(reward);

    this.el.hud.classList.add('hidden');
    this.el.results.classList.remove('hidden');

    this.el.results.querySelector('#againBtn').onclick = () => {
      this.el.results.classList.add('hidden');
      // 「再来一局」= 新的一局，金币也要能重新领（新的 raceId 由 main.js 发）
      onAgain();
    };
    this.el.results.querySelector('#homeBtn').onclick = () => {
      this.el.results.classList.add('hidden');
      onHome?.();
    };
  }

  _renderCoinReward(reward) {
    const box = this.el.coinReward;
    if (!box) return;
    if (!reward) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    box.classList.toggle('zero', !reward.granted);

    if (!reward.granted) {
      this.el.crAmount.textContent = '这局没有金币（没跑完）';
      this.el.crTotal.textContent = '';
      return;
    }

    // 数字从 0 滚到实际金额：快、不打断，孩子能看见「金币进来了」
    const target = Math.max(0, Math.floor(reward.amount || 0));
    this.el.crTotal.textContent = `共 ${Number(reward.coins || 0).toLocaleString('en-US')}`;
    cancelAnimationFrame(this._crRaf);
    const t0 = performance.now();
    const dur = 620;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      this.el.crAmount.textContent = `+${Math.round(target * e)}`;
      if (k < 1) this._crRaf = requestAnimationFrame(step);
      else this.el.crAmount.textContent = `+${target}`;
    };
    this._crRaf = requestAnimationFrame(step);
  }
}

function statBar(label, v) {
  const pct = Math.round(((v - 0.82) / 0.4) * 100);
  return `<span class="stat"><u>${label}</u><b><i style="width:${Math.max(8, Math.min(100, pct))}%"></i></b></span>`;
}

const TEMPLATE = /* html */ `
<div id="title">
  <!-- 全屏入口：支持 Fullscreen API 就真进全屏；iPhone Safari 不支持时
       会弹出「添加到主屏幕」的可操作指引，不会假装已经全屏。 -->
  <button id="fsBtn" class="fsBtn" type="button" aria-label="全屏">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <span class="fsLabel">全屏</span>
  </button>
  <div class="titleInner">
    <h1>小小赛车</h1>
    <p class="tag">快乐卡丁车冒险</p>
    <div class="modePick" role="group" aria-label="游戏模式">
      <button class="modeBtn on" data-mode="kids" type="button">
        <b>轻松模式</b><em>速度更慢，更容易转弯</em>
      </button>
      <button class="modeBtn" data-mode="normal" type="button">
        <b>普通模式</b><em>速度更快，更有挑战</em>
      </button>
    </div>
    <div class="titleBtns">
      <button id="playBtn">开始游戏</button>
      <button id="storyBtn" type="button">
        <span class="sbLabel">故事冒险 · 第一章</span>
        <span class="sbBadge" id="storyBadge">第一章 · 未开始</span>
      </button>
      <button id="storyBtn2" type="button">
        <span class="sbLabel">故事冒险 · 第二章</span>
        <span class="sbBadge" id="storyBadge2">第二章 · 未开始</span>
      </button>
    </div>
    <!-- 车库入口：车型不再在首页挑，进车库选车 / 看金币。
         原来的「红色赛车 / 海龟冲浪车」选择行已经删除。 -->
    <button id="garageBtn" type="button">
      <svg class="gbIcon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3.2 14.4h17.6v3.1a1 1 0 0 1-1 1h-1.3v1.1a1.35 1.35 0 0 1-2.7 0v-1.1H7.2v1.1a1.35 1.35 0 0 1-2.7 0v-1.1H4.2a1 1 0 0 1-1-1z" fill="#ffd23f"/>
        <path d="M4.9 13.6 7 8.7A2.3 2.3 0 0 1 9.1 7.3h5.8a2.3 2.3 0 0 1 2.1 1.4l2.1 4.9z" fill="#9fd7ff"/>
        <circle cx="7.1" cy="12.2" r="1.05" fill="#0f2a4c"/>
        <circle cx="16.9" cy="12.2" r="1.05" fill="#0f2a4c"/>
      </svg>
      <span class="gbLabel">我的车库</span>
      <span id="garageBtnCoins"><span class="coinDot"></span><b id="garageBtnCoinsNum">0</b></span>
      <span class="gbArrow" aria-hidden="true">›</span>
    </button>
    <div class="controls">
      <span><kbd>W</kbd>/<kbd>↑</kbd> 加速</span>
      <span><kbd>S</kbd>/<kbd>↓</kbd> 刹车</span>
      <span><kbd>A</kbd><kbd>D</kbd> 转向</span>
      <span><kbd>Shift</kbd> 漂移</span>
      <span><kbd>E</kbd> 用道具</span>
      <span><kbd>C</kbd> 回头看</span>
      <span><kbd>M</kbd> 静音</span>
    </div>
    <div class="touchControls">
      <span>左手在左下角滑动，就能转向</span>
      <span>按住绿色「油门」加速，转弯时点一下可以漂移</span>
    </div>
  </div>
</div>

<!-- 音乐设置：右上角的小入口，不占拇指操作区。比赛时 CSS 会把它左移，
     给原有的静音按钮让位，因此不需要新增任何巨大的比赛画面按钮。 -->
<button id="musicBtn" type="button" aria-label="音乐设置" title="音乐设置">♪</button>
<div id="musicSettings" class="hidden" role="dialog" aria-label="音乐设置">
  <div class="musicCard">
    <h3>♪ 音乐设置</h3>
    <div class="musicRow">
      <span>音乐</span>
      <button id="musicToggle" class="musicToggle" type="button" aria-pressed="true">开</button>
    </div>
    <div class="musicRow">
      <span>音量</span>
      <input id="musicVolume" type="range" min="0" max="100" step="1" value="100" aria-label="音乐音量" />
      <b id="musicVolumeValue">100%</b>
    </div>
    <p class="musicNote">100% 为默认音量：首页 35%，比赛 45%</p>
    <button id="musicClose" type="button">好啦</button>
  </div>
</div>

<div id="courseSelect" class="hidden">
  <h2>选择赛道</h2>
  <div id="courseGrid"></div>
  <p class="hint">选一条赛道，出发吧！</p>
</div>

<div id="select" class="hidden">
  <h2>选择你的赛车手</h2>
  <div id="charGrid"></div>
  <p class="hint">点一下赛车手，就能开始比赛</p>
</div>

<div id="hud" class="hidden">
  <div id="topLeft">
    <div id="pos"><span class="pre">第</span><span class="value">8</span><span class="suffix">名</span></div>
    <div id="lap">第 <span class="value">1</span> 圈<span class="slash"> / 共</span> <span class="total">3</span> 圈</div>
  </div>
  <div id="topRight">
    <div id="time">0'00"000</div>
    <ul id="standings"></ul>
  </div>
  <div id="itemSlot"><span id="itemIcon"></span></div>
  <div id="bottomRight">
    <svg id="speedo" viewBox="0 0 120 120">
      <circle cx="60" cy="60" r="52" class="track"/>
      <circle id="speedArc" cx="60" cy="60" r="52"/>
    </svg>
    <div id="speedText"><span id="speedValue">0</span><small>公里/时</small></div>
  </div>
  <button id="muteBtn" type="button" aria-label="开关声音"></button>
  <canvas id="minimap" width="220" height="220"></canvas>
  <div id="boostMeter"><div id="boostFill"></div></div>
  <div id="countdown"></div>
  <div id="toast"></div>
  <div id="wrongWay"><b>方向反啦！</b><span>快掉头哦！</span></div>
  <!-- 只有「故事冒险」里的比赛才出现：退出这一局，不播结尾剧情。
       放在顶部中央的空白区，不占拇指操作区，也不挤动任何现有 HUD。 -->
  <button id="quitRaceBtn" class="quitRace hidden" type="button">退出比赛</button>
  <div id="lapFlash"></div>
</div>

<div id="touch" class="hidden">
  <div id="steerPad">
    <div id="steerTrack"><div id="steerKnob"></div></div>
  </div>
  <div id="touchRight">
    <button id="btnItem" class="tBtn" aria-label="使用道具">道具</button>
    <button id="btnBrake" class="tBtn" aria-label="刹车">刹车</button>
    <button id="btnGas" class="tBtn gas" aria-label="油门，点一下漂移">油门</button>
  </div>
  <button id="btnReset" class="tBtn reset" aria-label="回到赛道" type="button">↺</button>
</div>

<div id="rotate">
  <div class="rotateInner">
    <svg viewBox="0 0 64 64" aria-hidden="true"><rect x="18" y="6" width="28" height="52" rx="5"/></svg>
    <p>请把手机横过来玩</p>
  </div>
</div>

<div id="results" class="hidden">
  <div class="resultsInner">
    <h2>比赛结束</h2>
    <div class="big" id="resultBig">完成比赛啦！</div>
    <div class="yourRank">你获得 <b id="yourPos">第 1 名</b></div>
    <!-- 金币到账：就在结算卡里滚一下数字，不另开弹窗打断孩子 -->
    <div id="coinReward" class="coinReward hidden">
      <span class="crCoin" aria-hidden="true"></span>
      <span class="crAmount" id="crAmount">+120</span>
      <span class="crTotal" id="crTotal"></span>
    </div>
    <ol id="resultsBody"></ol>
    <div class="best">最快单圈 <span id="bestLap"></span></div>
    <div class="resultBtns">
      <button id="againBtn">再来一局</button>
      <button id="homeBtn" class="ghost">返回首页</button>
    </div>
  </div>
</div>
`;
