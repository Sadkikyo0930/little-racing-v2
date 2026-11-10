/* ===========================================================================
 * story-mode.js — 「剧情模式」统一入口 + 章节选择页（R5 生日版）
 *
 * 设计原则（满足交付要求）：
 *  1. 不重做第一章 / 第二章剧情，不删除 / 覆盖任何剧情音频、配音、角色、道具。
 *  2. 第二章 21 条配音文件路径（c2-01 … c2-21）与第一章（c1-01 … c1-05）完全不变。
 *  3. 保留已有剧情存档的读取与写入逻辑：本脚本不碰存档，只把点击“转发”给游戏
 *     原本就为 #storyBtn / #storyBtn2 准备好的 handler（resume / start）。
 *  4. 首页只保留一个「剧情模式」入口，点击进入章节选择，再分别进入两章。
 *  5. 章节选择页适配手机横屏与常见浏览器；返回首页便捷；剧情结束后回到正确页面。
 *  6. 不影响赛车模式 / 车库 / 设置 / 家长控制 / 学习联动。
 *  7. 章节入口结构与存档结构分离：本脚本只改首页 UI，重置试玩记录（localStorage
 *     赛车存档）不会影响剧情资源。
 *
 * 实现方式：非侵入式覆盖层。原两个剧情按钮保留在 DOM 中（仅隐藏），其 onclick
 * 仍由游戏自身在每次 showTitle 时接管；本脚本转发点击，因此对游戏内部逻辑零改动。
 * ===========================================================================*/
(function () {
  'use strict';

  var STORY_MODE_BTN_ID = 'storyModeBtn';
  var OVERLAY_ID = 'storyChapterSelect';

  function $(id) { return document.getElementById(id); }

  function parseState(txt) {
    if (!txt) return '未开始';
    var i = String(txt).indexOf('·');
    return i >= 0 ? String(txt).slice(i + 1).trim() : String(txt).trim();
  }

  /* 把“第一章/第二章”的完整标题（如“海滨赛车节开幕”）单独取出来；
     完整章节名在章节进入时由 #storyChapter 显示，这里用常量保证首页展示稳定。 */
  var CHAPTER_NAMES = {
    storyBtn: '海滨赛车节开幕',
    storyBtn2: '阳光沙滩大冒险'
  };

  function inject() {
    var title = $('title');
    var titleBtns = title && title.querySelector('.titleBtns');
    var storyBtn = $('storyBtn');
    var storyBtn2 = $('storyBtn2');
    if (!titleBtns || !storyBtn || !storyBtn2) return false; // 标题尚未构建，继续轮询
    if ($('storyModeBtn')) return true;                      // 已注入，跳过

    // 1) 隐藏两个独立剧情按钮（保留在 DOM，使其 handler 持续有效）
    storyBtn.style.display = 'none';
    storyBtn2.style.display = 'none';

    // 2) 统一的「剧情模式」按钮，插到原剧情按钮的位置
    var modeBtn = document.createElement('button');
    modeBtn.id = STORY_MODE_BTN_ID;
    modeBtn.type = 'button';
    modeBtn.className = 'storyModeBtn';
    modeBtn.innerHTML =
      '<span class="sbLabel">剧情模式</span>' +
      '<span class="sbBadge" id="storyModeBadge">故事冒险</span>';
    titleBtns.insertBefore(modeBtn, storyBtn);

    // 3) 章节选择覆盖层
    var overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'hidden';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', '选择剧情章节');
    overlay.innerHTML =
      '<div class="scsCard">' +
        '<div class="scsHead">' +
          '<button class="scsBack" id="scsBack" type="button">‹ 返回首页</button>' +
          '<h2>剧情模式 · 选择章节</h2>' +
        '</div>' +
        '<div class="scsGrid">' +
          '<button class="scsChapter ch1" id="scsCh1" type="button" data-target="storyBtn">' +
            '<div class="scsIllu illu1" aria-hidden="true"></div>' +
            '<div class="scsInfo">' +
              '<span class="scsKicker">第一章</span>' +
              '<span class="scsName" id="scsName1">' + CHAPTER_NAMES.storyBtn + '</span>' +
              '<span class="scsProgress" id="scsProg1">未开始</span>' +
            '</div>' +
            '<span class="scsArrow" aria-hidden="true">›</span>' +
          '</button>' +
          '<button class="scsChapter ch2" id="scsCh2" type="button" data-target="storyBtn2">' +
            '<div class="scsIllu illu2" aria-hidden="true"></div>' +
            '<div class="scsInfo">' +
              '<span class="scsKicker">第二章</span>' +
              '<span class="scsName" id="scsName2">' + CHAPTER_NAMES.storyBtn2 + '</span>' +
              '<span class="scsProgress" id="scsProg2">未开始</span>' +
            '</div>' +
            '<span class="scsArrow" aria-hidden="true">›</span>' +
          '</button>' +
        '</div>' +
      '</div>';
    (document.getElementById('ui') || document.body).appendChild(overlay);

    // 4) 交互绑定
    function openSelect() { syncSelect(); overlay.classList.remove('hidden'); }
    function closeSelect() { overlay.classList.add('hidden'); }

    modeBtn.addEventListener('click', openSelect);
    $('scsBack').addEventListener('click', closeSelect);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeSelect(); });

    function launch(targetId) {
      var t = $(targetId);
      if (!t || t.disabled) return; // 尊重游戏既有的解锁 / 锁定规则
      closeSelect();
      t.click(); // 转发给游戏原本为 #storyBtn / #storyBtn2 准备好的 handler
    }
    $('scsCh1').addEventListener('click', function () { launch('storyBtn'); });
    $('scsCh2').addEventListener('click', function () { launch('storyBtn2'); });

    // 5) 同步章节名 / 进度 / 锁定状态：始终以游戏真实状态为准（徽标 + 锁定类）
    function syncSelect() {
      var b1 = $('storyBadge'), b2 = $('storyBadge2');
      if (b1) $('scsProg1').textContent = parseState(b1.textContent);
      if (b2) $('scsProg2').textContent = parseState(b2.textContent);
      var ch1 = $('scsCh1'), ch2 = $('scsCh2');
      if (ch1) ch1.classList.toggle('done', !!storyBtn.classList.contains('done'));
      if (ch2) {
        var locked = storyBtn2.disabled || storyBtn2.classList.contains('locked');
        ch2.classList.toggle('locked', !!locked);
      }
    }

    syncSelect();

    // 标题每次重新显示（从剧情返回 / 重新渲染）时，重新同步进度与锁定态
    if (typeof MutationObserver !== 'undefined' && title) {
      var obs = new MutationObserver(function () {
        if (!title.classList.contains('hidden')) syncSelect();
      });
      obs.observe(title, { attributes: true, attributeFilter: ['class'] });
    }

    return true;
  }

  function start() {
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      try { if (inject()) clearInterval(iv); }
      catch (e) { if (window.console) console.error('[storyMode]', e); }
      if (tries > 250) clearInterval(iv); // ~30s 超时后停止轮询，避免无谓占用
    }, 120);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
