import {
  VEHICLES, VEHICLE_STATE, STATE_LABEL, getVehicle, vehicleState, unlockRows, canEquip,
} from './vehicles.js';

/* ------------------------------------------------------------------ *
 * 「我的车库」界面
 *
 * 只做三件事：把存档渲染成卡片 / 面板，把点击转成事件，把金币变化做成动画。
 * 所有业务判断（能不能买、能不能装备、扣多少币）都在 main.js + save.js 里，
 * 这样界面不会偷偷改存档。
 *
 * 3D 展示是独立的一层 WebGL（garage/stage.js），这里只负责告诉它
 * 「3D 画面该落在屏幕哪块矩形里」，所以右侧面板永远压不到车。
 * ------------------------------------------------------------------ */

const STAT_DEFS = [
  ['speed', '速度'],
  ['accel', '加速'],
  ['control', '操控'],
  ['stability', '稳定'],
];

const STATE_CLASS = {
  [VEHICLE_STATE.EQUIPPED]: 'is-equipped',
  [VEHICLE_STATE.OWNED]: 'is-owned',
  [VEHICLE_STATE.BUYABLE]: 'is-buyable',
  [VEHICLE_STATE.NEED_COINS]: 'is-locked',
  [VEHICLE_STATE.LOCKED]: 'is-locked',
  [VEHICLE_STATE.COMING_SOON]: 'is-soon',
};

export class GarageUI {
  constructor(root) {
    this.root = root;
    this.root.insertAdjacentHTML('beforeend', TEMPLATE);

    this.el = {
      layer: root.querySelector('#garage'),
      back: root.querySelector('#garageBack'),
      coins: root.querySelector('#garageCoins'),
      coinsNum: root.querySelector('#garageCoinsNum'),
      show: root.querySelector('#garageShow'),
      carName: root.querySelector('#garageCarName'),
      carTag: root.querySelector('#garageCarTag'),
      panel: root.querySelector('#garagePanel'),
      pName: root.querySelector('#gpName'),
      pState: root.querySelector('#gpState'),
      pDesc: root.querySelector('#gpDesc'),
      pStats: root.querySelector('#gpStats'),
      pUnlock: root.querySelector('#gpUnlock'),
      scroll: root.querySelector('#gpScroll'),
      more: root.querySelector('#gpMore'),
      fsBtn: root.querySelector('#garageFsBtn'),
      pAction: root.querySelector('#gpAction'),
      pSub: root.querySelector('#gpSub'),
      cards: root.querySelector('#garageCards'),
      toast: root.querySelector('#garageToast'),
      saveBtn: root.querySelector('#garageSaveBtn'),
      savePanel: root.querySelector('#garageSavePanel'),
      achBtn: root.querySelector('#garageAchBtn'),
      achPanel: root.querySelector('#garageAchPanel'),
      achList: root.querySelector('#garageAchList'),
      achClose: root.querySelector('#garageAchClose'),
      saveText: root.querySelector('#garageSaveText'),
      saveCopy: root.querySelector('#garageSaveCopy'),
      saveDownload: root.querySelector('#garageSaveDownload'),
      saveImport: root.querySelector('#garageSaveImport'),
      saveRestore: root.querySelector('#garageSaveRestore'),
      saveClose: root.querySelector('#garageSaveClose'),
      saveMsg: root.querySelector('#garageSaveMsg'),
      saveRisk: root.querySelector('#garageSaveRisk'),
      saveRiskYes: root.querySelector('#garageSaveRiskYes'),
      saveRiskNo: root.querySelector('#garageSaveRiskNo'),
      saveWarn: root.querySelector('#garageSaveWarn'),
      fallback: root.querySelector('#garageFallback'),
    };

    this.selectedId = 'red';
    this.save = null;
    this.storyState = 'idle';
    this._coinShown = 0;
    this._coinRaf = 0;
    this._toastT = 0;
    this._busy = false;

    this._bind();
  }

  /* ---------------------------- 绑定 ---------------------------- */
  _bind() {
    this.el.back?.addEventListener('click', () => this.onBack?.());

    // 卡片：点一下 = 预览（不装备）
    this.el.cards?.addEventListener('click', (e) => {
      const card = e.target.closest?.('.gCard');
      if (!card) return;
      const id = card.dataset.id;
      if (id && id !== this.selectedId) this.onSelect?.(id);
    });

    this.el.pAction?.addEventListener('click', () => {
      if (this._busy) return;
      const v = getVehicle(this.selectedId);
      if (!v) return;
      const st = vehicleState(v, this.save);
      if (st === VEHICLE_STATE.OWNED) this.onEquip?.(v.id);
      else if (st === VEHICLE_STATE.BUYABLE) this.onBuy?.(v.id);
      else if (st === VEHICLE_STATE.LOCKED) this.onGoStory?.(v.id);
    });

    this.el.saveBtn?.addEventListener('click', () => this.setSavePanel(true));
    this.el.saveClose?.addEventListener('click', () => this.setSavePanel(false));
    this.el.savePanel?.addEventListener('click', (e) => {
      if (e.target === this.el.savePanel) this.setSavePanel(false);
    });
    this.el.saveCopy?.addEventListener('click', () => this.onExport?.('copy'));
    this.el.saveDownload?.addEventListener('click', () => this.onExport?.('download'));
    this.el.saveImport?.addEventListener('click', () => {
      const text = this.el.saveText?.value || '';
      if (!text.trim()) { this.setSaveMsg('先把存档文字粘贴到上面的框里', 'bad'); return; }
      this.onImport?.(text);
    });
    this.el.saveRestore?.addEventListener('click', () => this.onRestore?.());

    /* 成就墙：展示已解锁 / 未解锁成就（第二章首通 → 阳光沙滩冠军）。 */
    this.el.achBtn?.addEventListener('click', () => this.onAchievements?.());
    this.el.achClose?.addEventListener('click', () => this.setAchPanel(false));
    this.el.achPanel?.addEventListener('click', (e) => {
      if (e.target === this.el.achPanel) this.setAchPanel(false);
    });

    /* 中部详情的滚动提示：只在「确实还有内容」时出现，滚到底就消失。
       passive 是必须的 —— 用主动监听会让 Safari 等滚动结束才回调，提示会滞后。 */
    this.el.scroll?.addEventListener('scroll', () => this._updateScrollHint(), { passive: true });

    // 备份失败时的「仍然导入」确认：默认是取消，必须再点一次才真的覆盖
    this.el.saveRiskNo?.addEventListener('click', () => {
      this.showRisk(false);
      this.setSaveMsg('已取消导入，现在的金币和赛车都没变', 'good');
    });
    this.el.saveRiskYes?.addEventListener('click', () => {
      this.showRisk(false);
      const text = this.el.saveText?.value || '';
      if (!text.trim()) { this.setSaveMsg('先把存档文字粘贴到上面的框里', 'bad'); return; }
      this.onImportForce?.(text);
    });
  }

  /* ---------------------------- 打开/关闭 ---------------------------- */
  show({ save, vehicles = VEHICLES, selectedId, storyState }) {
    this.save = save;
    this.storyState = storyState || 'idle';
    this.selectedId = selectedId || save?.current || 'red';
    this.el.layer.classList.remove('hidden');
    this.el.fallback?.classList.add('hidden');
    if (this.el.scroll) this.el.scroll.scrollTop = 0;
    this._renderCards(vehicles);
    this._renderPanel();
    this.setCoins(save?.coins || 0, { animate: true });
    this._measureFocus();
  }

  hide() {
    this.el.layer.classList.add('hidden');
    this.setSavePanel(false);
    this.setSaveMsg('');
  }

  get visible() {
    return !this.el.layer.classList.contains('hidden');
  }

  /** 3D 舞台要用它：展示区的 CSS 像素矩形。 */
  measureShowRect() {
    const r = this.el.show?.getBoundingClientRect();
    if (!r || !r.width) return null;
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  _measureFocus() {
    if (!this.onGeometry) return;
    const rect = this.measureShowRect();
    if (rect) this.onGeometry(rect);
  }

  /** 窗口尺寸变化后重新量一次（横竖屏切换、Safari 地址栏收起）。 */
  relayout() {
    if (!this.visible) return;
    this._measureFocus();
    this._updateScrollHint();
  }

  /**
   * 中部详情是否还能往下滚。
   *
   * 只在「真的溢出 + 还没滚到底」时显示提示条。三种情况都要正确：
   * 未解锁（条件多）、已拥有（条件少）、文案很长。
   */
  _updateScrollHint() {
    const sc = this.el.scroll;
    const more = this.el.more;
    if (!sc || !more) return;
    const overflow = sc.scrollHeight - sc.clientHeight;
    const canMore = overflow > 4 && sc.scrollTop < overflow - 4;
    more.classList.toggle('hidden', !canMore);
    // 上下渐隐：能往上回看 / 下面还有内容
    const wrap = sc.parentElement;
    wrap?.classList.toggle('has-more', canMore);
    wrap?.classList.toggle('is-scrolled', sc.scrollTop > 2);
    this.panelScroll = { overflow, top: Math.round(sc.scrollTop), canMore };
  }

  /* ---------------------------- 渲染 ---------------------------- */
  _renderCards(vehicles) {
    this.el.cards.innerHTML = vehicles.map((v) => {
      const st = vehicleState(v, this.save);
      const locked = st === VEHICLE_STATE.LOCKED || st === VEHICLE_STATE.NEED_COINS
        || st === VEHICLE_STATE.COMING_SOON || st === VEHICLE_STATE.BUYABLE;
      const price = v.unlock.type === 'coins' ? `<span class="gcPrice">${fmt(v.unlock.price)}</span>` : '';
      return `<button class="gCard ${STATE_CLASS[st] || ''} ${v.id === this.selectedId ? 'on' : ''}"
                data-id="${v.id}" data-state="${st}" type="button"
                style="--vc:#${hex(v.color)};--va:#${hex(v.accent)}">
        <span class="gcArt">${thumb(v.id)}${locked ? '<i class="gcLock"></i>' : ''}</span>
        <span class="gcName">${v.name}</span>
        <span class="gcState">${price || stateText(v, st)}</span>
      </button>`;
    }).join('');
  }

  _renderPanel() {
    const v = getVehicle(this.selectedId);
    if (!v) return;
    const st = vehicleState(v, this.save);

    this.el.carName.textContent = v.name;
    this.el.carTag.textContent = v.tag;
    this.el.pName.textContent = v.name;
    this.el.pState.textContent = STATE_LABEL[st] || '未解锁';
    this.el.pState.className = `gpState ${STATE_CLASS[st] || ''}`;
    this.el.pDesc.textContent = v.desc;

    // 属性条
    this.el.pStats.innerHTML = STAT_DEFS.map(([k, label]) => {
      const n = v.stats[k] || 0;
      const cells = Array.from({ length: 5 }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
      return `<div class="gpStat"><u>${label}</u><b>${cells}</b></div>`;
    }).join('');

    // 解锁条件
    const rows = unlockRows(v, this.save, this.storyState);
    this.el.pUnlock.innerHTML = `
      <div class="gpUnlockHead">${v.unlock.type === 'default' ? '获得方式' : '解锁条件'}</div>
      ${rows.map((r) => `<div class="gpuRow ${r.done ? 'done' : ''}">
        <span class="gpuIcon">${unlockIcon(r.icon)}</span>
        <span class="gpuText">${r.text}</span>
        <span class="gpuVal">${r.value}</span>
      </div>`).join('')}`;

    // 主按钮
    const { label, disabled, cls, sub } = actionFor(v, st, this.save);
    this.el.pAction.textContent = label;
    this.el.pAction.disabled = disabled;
    this.el.pAction.className = `gpAction ${cls}`;
    this.el.pSub.textContent = sub || '';
    this.el.pSub.classList.toggle('hidden', !sub);

    this._updateScrollHint();
  }

  setSelected(id) {
    if (!getVehicle(id)) return;
    this.selectedId = id;
    for (const c of this.el.cards.querySelectorAll('.gCard')) {
      c.classList.toggle('on', c.dataset.id === id);
    }
    // 换车时中部回到顶部 —— 上一辆滚到一半的位置对新内容没有意义
    if (this.el.scroll) this.el.scroll.scrollTop = 0;
    this._renderPanel();
  }

  /** 存档变了 → 重画（金币 / 拥有状态都会跟着变）。 */
  update(save, { storyState } = {}) {
    this.save = save;
    if (storyState !== undefined) this.storyState = storyState;
    this._renderCards(VEHICLES);
    this._renderPanel();
    this.setCoins(save.coins, { animate: true });
  }

  /* ---------------------------- 金币 ---------------------------- */
  setCoins(next, { animate = false } = {}) {
    const target = Math.max(0, Math.floor(Number(next) || 0));
    const from = this._coinShown;
    if (!animate || Math.abs(target - from) < 1) {
      this._coinShown = target;
      this.el.coinsNum.textContent = fmt(target);
      return;
    }
    cancelAnimationFrame(this._coinRaf);
    const t0 = performance.now();
    const dur = Math.min(900, 260 + Math.abs(target - from) * 3);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      this._coinShown = Math.round(from + (target - from) * e);
      this.el.coinsNum.textContent = fmt(this._coinShown);
      if (k < 1) this._coinRaf = requestAnimationFrame(step);
      else { this._coinShown = target; this.el.coinsNum.textContent = fmt(target); }
    };
    this._coinRaf = requestAnimationFrame(step);
  }

  /** 金币变化时在余额旁边浮一个 +N。 */
  flashCoins(delta) {
    if (!delta) return;
    const el = this.el.coins;
    if (!el) return;
    const fly = document.createElement('span');
    fly.className = `coinFly ${delta > 0 ? 'up' : 'down'}`;
    fly.textContent = `${delta > 0 ? '+' : ''}${delta}`;
    el.appendChild(fly);
    setTimeout(() => fly.remove(), 1200);
  }

  toast(text, kind = '') {
    const el = this.el.toast;
    if (!el) return;
    el.textContent = text;
    el.className = `shown ${kind}`;
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { el.className = ''; }, 1700);
  }

  setBusy(on) {
    this._busy = !!on;
    this.el.pAction?.classList.toggle('busy', !!on);
  }

  /** 3D 模型没加载出来时的兜底：显示一张静态说明，不假装有画面。 */
  setStageFailed(failed, reason = '') {
    this.el.fallback?.classList.toggle('hidden', !failed);
    this.el.layer.classList.toggle('no-stage', !!failed);
    if (this.el.fallback) {
      this.el.fallback.querySelector('.gfText').textContent = reason
        ? '这辆车的 3D 模型没加载出来，可以先在比赛里看看它'
        : '正在加载赛车模型……';
    }
  }

  /* ---------------------------- 存档面板 ---------------------------- */
  setSavePanel(open) {
    this.el.savePanel?.classList.toggle('hidden', !open);
    if (open) {
      this.el.saveText.value = '';
      this.setSaveMsg('');
      this.showRisk(false);
    }
  }

  /**
   * 显示 / 隐藏「备份失败，还要不要导入」这一步。
   * 只负责开关提示，不知道也不该知道备份是怎么失败的 —— 文案由调用方给。
   */
  showRisk(on, text) {
    const box = this.el.saveRisk;
    if (!box) return;
    box.classList.toggle('hidden', !on);
    this.el.savePanel?.classList.toggle('risk', !!on);
    if (on && text) {
      const p = box.querySelector('.gsrText');
      if (p) p.textContent = text;
    }
  }

  /** 存档写不进去（无痕模式 / 空间满）时，面板顶部挂一条常驻警告。 */
  setSaveWarn(text) {
    const el = this.el.saveWarn;
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('hidden', !text);
  }

  /* ---------------------------- 成就墙 ---------------------------- */
  setAchPanel(open) {
    this.el.achPanel?.classList.toggle('hidden', !open);
    if (open && !this.el.achList?.children.length) {
      // 没传过数据就拉一份默认（避免空面板）
      this.renderAchievements();
    }
  }

  /**
   * 渲染成就列表。
   * @param {Array} list 可选；缺省时内部从存档读（测试可传入模拟数据）。
   */
  renderAchievements(list) {
    const el = this.el.achList;
    if (!el) return;
    const items = Array.isArray(list) ? list : (this._lastAch || []);
    el.innerHTML = items.map((a) => {
      const icon = a.icon === 'star'
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.6 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.4l6.5-.9z" fill="#ffd23f"/></svg>'
        : unlockIcon(a.icon || 'star');
      const when = a.unlocked && a.at ? `解锁于 ${new Date(a.at).toLocaleDateString('zh-CN')}` : '尚未解锁';
      return `<div class="gAch ${a.unlocked ? 'on' : ''}">
        <span class="gAchIco">${icon}</span>
        <span class="gAchBody">
          <b class="gAchName">${a.name}</b>
          <i class="gAchDesc">${a.desc || ''}</i>
          <i class="gAchWhen">${when}</i>
        </span>
        <span class="gAchState">${a.unlocked ? '已解锁' : '未解锁'}</span>
      </div>`;
    }).join('');
    this._lastAch = items;
  }

  setSaveText(text) {
    if (!this.el.saveText) return;
    this.el.saveText.value = text;
    this.el.saveText.select?.();
  }

  setSaveMsg(msg, kind = '') {
    const el = this.el.saveMsg;
    if (!el) return;
    el.textContent = msg || '';
    el.className = `saveMsg ${kind}`;
  }

  /** 屏幕旋转 / 地址栏变化：卡片与面板都要重新量。 */
  handleResize() {
    this.relayout();
  }
}

/* ------------------------------ 文案 ------------------------------ */
function stateText(v, st) {
  switch (st) {
    case VEHICLE_STATE.EQUIPPED: return '正在使用';
    case VEHICLE_STATE.OWNED: return '已拥有';
    case VEHICLE_STATE.BUYABLE: return '可以购买';
    case VEHICLE_STATE.NEED_COINS: return '金币不足';
    case VEHICLE_STATE.COMING_SOON: return '敬请期待';
    default: return '未解锁';
  }
}

function actionFor(v, st, save) {
  switch (st) {
    case VEHICLE_STATE.EQUIPPED:
      return { label: '正在使用', disabled: true, cls: 'in-use', sub: '去赛道就能开着它出发' };
    case VEHICLE_STATE.OWNED:
      return {
        label: `使用这辆车`,
        disabled: false,
        cls: 'primary',
        sub: v.keepsCharacterSelect ? '换上后可以挑一位赛车手' : '',
      };
    case VEHICLE_STATE.BUYABLE:
      return {
        label: `${fmt(v.unlock.price)} 金币购买`,
        disabled: false,
        cls: 'primary',
        sub: `购买后还剩 ${fmt((save?.coins || 0) - v.unlock.price)} 金币`,
      };
    case VEHICLE_STATE.NEED_COINS: {
      const need = Math.max(0, v.unlock.price - (save?.coins || 0));
      return {
        label: `还差 ${fmt(need)} 金币`, disabled: true, cls: 'ghost',
        sub: '跑完比赛就能拿到金币',
      };
    }
    case VEHICLE_STATE.COMING_SOON:
      return {
        label: '敬请期待', disabled: true, cls: 'ghost',
        sub: v.id === 'moto' ? '还在制作中，做好就能买' : '等学习挑战上线后解锁',
      };
    default:
      return {
        label: v.unlock.type === 'story' ? '去玩剧情解锁' : '还没解锁',
        disabled: v.unlock.type !== 'story',
        cls: v.unlock.type === 'story' ? 'primary story' : 'ghost',
        sub: v.unlock.type === 'story' ? '玩完第一章就能拿到' : '',
      };
  }
}

function unlockIcon(kind) {
  const icons = {
    gift: '<svg viewBox="0 0 24 24"><path d="M4 10h16v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" fill="#ffd23f"/><rect x="3" y="6.5" width="18" height="4" rx="1.2" fill="#ffb300"/><rect x="10.4" y="6.5" width="3.2" height="14.5" fill="#fff3a6"/><path d="M12 6.5C10 3 6.5 3 6.5 5.2 6.5 6.6 8.6 6.5 12 6.5Zm0 0c2-3.5 5.5-3.5 5.5-1.3 0 1.4-2.1 1.3-5.5 1.3Z" fill="#e02b16"/></svg>',
    coin: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.4" fill="#ffcf3a"/><circle cx="12" cy="12" r="6" fill="#ffe680"/><text x="12" y="16.2" text-anchor="middle" font-size="9" font-weight="900" fill="#b06a00" font-family="sans-serif">¥</text></svg>',
    book: '<svg viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v16H6.5A2.5 2.5 0 0 0 4 21.5z" fill="#8fd0ff"/><path d="M19 19v2H6.5A2.5 2.5 0 0 0 4 23z" fill="#4aa8ff"/><rect x="7" y="7" width="9" height="1.6" rx=".8" fill="#fff"/><rect x="7" y="10.5" width="6" height="1.4" rx=".7" fill="#e6f4ff"/></svg>',
    school: '<svg viewBox="0 0 24 24"><path d="M12 3 22 8 12 13 2 8z" fill="#ffd23f"/><path d="M6 10.5V15c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.5L12 13z" fill="#ffb300"/><rect x="20.4" y="8" width="1.6" height="6" rx=".8" fill="#ffd23f"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="m12 2.6 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.4l6.5-.9z" fill="#ffd23f"/></svg>',
    check: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#38d67a"/><path d="m7.6 12.3 3 3 5.8-6" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  return icons[kind] || icons.star;
}

/* ---------------------------- 缩略图 ---------------------------- */
function thumb(id) {
  if (id === 'turtle') return THUMB_TURTLE;
  if (id === 'moto') return THUMB_MOTO;
  if (id === 'scholar') return THUMB_SCHOLAR;
  return THUMB_RED;
}

const THUMB_RED = `<svg viewBox="0 0 120 66" aria-hidden="true">
  <ellipse cx="60" cy="60" rx="42" ry="4.4" fill="rgba(0,0,0,.30)"/>
  <rect x="16" y="34" width="88" height="18" rx="9" fill="#c8230f"/>
  <path d="M20 40 Q26 24 44 21 L80 21 Q98 25 102 40 Z" fill="#e8412a"/>
  <path d="M50 23 Q56 13 68 13 L76 13 Q84 15 86 23 Z" fill="#7c1408"/>
  <rect x="55" y="23" width="5" height="16" fill="#ffd23f"/>
  <rect x="66" y="23" width="5" height="16" fill="#ffd23f"/>
  <rect x="86" y="20" width="16" height="4" rx="2" fill="#ff5a2b"/>
  <circle cx="33" cy="50" r="12" fill="#161d29"/><circle cx="33" cy="50" r="5" fill="#9db4d0"/>
  <circle cx="88" cy="50" r="12" fill="#161d29"/><circle cx="88" cy="50" r="5" fill="#9db4d0"/>
</svg>`;

const THUMB_TURTLE = `<svg viewBox="0 0 120 66" aria-hidden="true">
  <ellipse cx="60" cy="60" rx="42" ry="4.4" fill="rgba(0,0,0,.30)"/>
  <path d="M22 44 Q24 24 60 20 Q96 24 98 44 Q96 54 60 56 Q24 54 22 44Z" fill="#3fd39a"/>
  <path d="M34 42 Q38 30 60 28 Q82 30 86 42 Q82 50 60 51 Q38 50 34 42Z" fill="#2bb37e"/>
  <path d="M42 40 Q46 34 60 33 Q74 34 78 40" stroke="#9ff0cd" stroke-width="2.6" fill="none" stroke-linecap="round"/>
  <circle cx="60" cy="20" r="12" fill="#4fe0a6"/>
  <circle cx="55" cy="18" r="3.6" fill="#fff"/><circle cx="65" cy="18" r="3.6" fill="#fff"/>
  <circle cx="55.6" cy="18.4" r="2" fill="#12283f"/><circle cx="65.6" cy="18.4" r="2" fill="#12283f"/>
  <path d="M56 25 Q60 28 64 25" stroke="#12283f" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  <path d="M96 30 l10 -8 4 5 -9 7z" fill="#ffd23f"/>
  <circle cx="33" cy="50" r="11" fill="#161d29"/><circle cx="33" cy="50" r="4.6" fill="#ffd23f"/>
  <circle cx="88" cy="50" r="11" fill="#161d29"/><circle cx="88" cy="50" r="4.6" fill="#ffd23f"/>
</svg>`;

const THUMB_MOTO = `<svg viewBox="0 0 120 66" aria-hidden="true">
  <ellipse cx="60" cy="60" rx="40" ry="4.2" fill="rgba(0,0,0,.30)"/>
  <path d="M30 45 L52 26 L74 30 L86 44Z" fill="#1f6fe0"/>
  <path d="M50 28 L58 20 L74 22 L80 30Z" fill="#5fb0ff"/>
  <rect x="56" y="34" width="22" height="8" rx="4" fill="#ffd23f"/>
  <path d="M70 24 L88 22" stroke="#c9dcf5" stroke-width="3" stroke-linecap="round"/>
  <circle cx="34" cy="48" r="13" fill="#161d29"/><circle cx="34" cy="48" r="5" fill="#b9cfe8"/>
  <circle cx="86" cy="48" r="13" fill="#161d29"/><circle cx="86" cy="48" r="5" fill="#b9cfe8"/>
</svg>`;

const THUMB_SCHOLAR = `<svg viewBox="0 0 120 66" aria-hidden="true">
  <ellipse cx="60" cy="60" rx="42" ry="4.4" fill="rgba(0,0,0,.30)"/>
  <rect x="16" y="34" width="88" height="18" rx="9" fill="#4b3aa8"/>
  <path d="M20 40 Q26 24 44 21 L80 21 Q98 25 102 40 Z" fill="#7b5cff"/>
  <path d="M50 23 Q56 13 68 13 L76 13 Q84 15 86 23 Z" fill="#3a2a80"/>
  <path d="M12 8 L34 15 12 22 12 8Z" fill="#ffd23f"/>
  <circle cx="33" cy="50" r="12" fill="#161d29"/><circle cx="33" cy="50" r="5" fill="#b9cfe8"/>
  <circle cx="88" cy="50" r="12" fill="#161d29"/><circle cx="88" cy="50" r="5" fill="#b9cfe8"/>
</svg>`;

/* ------------------------------ 模板 ------------------------------ */
const TEMPLATE = /* html */ `
<div id="garage" class="hidden">
  <header class="gTop">
    <button id="garageBack" class="gBack" type="button" aria-label="返回首页">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5 7.5 12l7 7" stroke="currentColor" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <div class="gTitleWrap">
      <span class="gFlag l" aria-hidden="true"></span>
      <h2 class="gTitle">我的车库</h2>
      <span class="gFlag r" aria-hidden="true"></span>
    </div>
    <div class="gTopRight">
      <div class="gCoins" id="garageCoins" aria-live="polite">
        <span class="coinIco" aria-hidden="true"></span>
        <b id="garageCoinsNum">0</b>
      </div>
      <button id="garageFsBtn" class="gSaveBtn gFsBtn" type="button" aria-label="全屏">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span class="gfsLabel">全屏</span>
      </button>
      <button id="garageSaveBtn" class="gSaveBtn" type="button" aria-label="存档管理">存档</button>
      <button id="garageAchBtn" class="gSaveBtn" type="button" aria-label="成就">成就</button>
    </div>
  </header>

  <div class="gMain">
    <div class="gShow" id="garageShow">
      <div class="gShowHead">
        <span class="gCarTag" id="garageCarTag">全能</span>
        <span class="gCarName" id="garageCarName">红色赛车</span>
      </div>
      <div id="garageFallback" class="gFallback hidden">
        <span class="gfIcon" aria-hidden="true">🚗</span>
        <p class="gfText">正在加载赛车模型……</p>
      </div>
    </div>

    <aside class="gPanel" id="garagePanel">
      <div class="gpHead">
        <h3 id="gpName">红色赛车</h3>
        <span class="gpState" id="gpState">正在使用</span>
      </div>
      <!-- 面板是「固定头 + 中部滚动 + 固定底」三段式：
           · 头（车名 + 状态）永远看得见；
           · 中部（介绍 / 性能 / 解锁条件）独立滚动，海龟车那种「已拥有 + 多条剧情
             条件」的长内容不会再把自己挤出面板；
           · 底（主按钮 + 一行小字）永远贴在面板底部，任何尺寸都不会被顶出屏幕。
           以前这三段平铺在 flex 里、按钮靠 margin-top:auto 贴底，内容一超长按钮
           就被 overflow:hidden 裁掉了 —— 这就是真机上「已拥有却看不到使用按钮」。 -->
      <div class="gpScrollWrap">
        <div class="gpScroll" id="gpScroll" tabindex="-1">
          <p class="gpDesc" id="gpDesc"></p>
          <div class="gpStats" id="gpStats"></div>
          <div class="gpUnlock" id="gpUnlock"></div>
        </div>
        <!-- 还能往下看的时候才出现，滚到底自动消失 -->
        <div class="gpMore hidden" id="gpMore" aria-hidden="true"><span>下滑看更多</span></div>
      </div>
      <div class="gpFoot">
        <button class="gpAction primary" id="gpAction" type="button">使用这辆车</button>
        <p class="gpSub" id="gpSub"></p>
      </div>
    </aside>
  </div>

  <footer class="gCards" id="garageCards"></footer>

  <div id="garageToast"></div>

  <div id="garageSavePanel" class="hidden" role="dialog" aria-label="存档管理">
    <div class="gspCard">
      <h3>存档管理</h3>
      <p class="gspWarn hidden" id="garageSaveWarn"></p>
      <p class="gspNote">换手机时把下面的文字保存到备忘录，在新手机上粘贴回来就能恢复金币和赛车。</p>
      <textarea id="garageSaveText" spellcheck="false" placeholder="点「复制存档」生成文字，或在这里粘贴以前保存的存档"></textarea>
      <div class="gspRow">
        <button id="garageSaveCopy" type="button">复制存档</button>
        <button id="garageSaveDownload" type="button" class="ghost">存成文件</button>
      </div>
      <div class="gspRow">
        <button id="garageSaveImport" type="button" class="primary">导入上面的存档</button>
      </div>
      <div class="gspRisk hidden" id="garageSaveRisk" role="alert">
        <p class="gsrText">备份没有保存成功。继续导入会直接覆盖现在的金币和赛车，而且没法撤销。</p>
        <div class="gspRow">
          <button id="garageSaveRiskNo" type="button">取消，先不导入</button>
          <button id="garageSaveRiskYes" type="button" class="danger">仍然导入</button>
        </div>
      </div>
      <div class="gspRow">
        <button id="garageSaveRestore" type="button" class="ghost">恢复上一份备份</button>
      </div>
      <p class="saveMsg" id="garageSaveMsg"></p>
      <button id="garageSaveClose" class="gspClose" type="button">关掉</button>
    </div>
  </div>

  <div id="garageAchPanel" class="hidden" role="dialog" aria-label="成就">
    <div class="gAchCard">
      <h3>成就</h3>
      <p class="gAchNote">完成挑战即可解锁，解锁记录会跟着存档一起保存。</p>
      <div class="gAchList" id="garageAchList"></div>
      <button id="garageAchClose" class="gAchClose" type="button">关掉</button>
    </div>
  </div>
</div>`;

/* ------------------------------ 工具 ------------------------------ */
function hex(n) {
  return (Number(n) || 0).toString(16).padStart(6, '0');
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US');
}
