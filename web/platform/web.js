// -*- coding: utf-8 -*-
/* ============================================================================
   platform/web.js —— 浏览器适配层（★ 全项目**唯一**允许碰 DOM 的文件）

   为什么要有这一层（方案 §1.3）：
     微信 / 抖音小游戏**没有浏览器 DOM**。将来上小程序时只要把这一层换成
     platform/weapp.js（画布用 wx.createCanvas、网络用 wx.connectSocket、
     存储用 wx.setStorageSync、帧循环用 canvas.requestAnimationFrame），
     core/ 里一行都不用改。

   这一层只做「平台能力」，不含游戏规则：
     UI.*     画布 / 元素 / 文本 / 样式 / 离屏画布 / resize / 帧循环 / 存储
     音频     loadSfx / sfx
     网络     wsConnect / wsOnMessage（浏览器 WebSocket API）
     界面     名牌 / 飘字 / 提示 / 血条 / 设置面板 / 死亡遮罩 / 登录浮层
     输入     bindInput（键盘 / 触摸 / 摇杆）

   验收闸门：python tools\check_core_dom.py
   ============================================================================ */

/* 已放置对象缓存（core/town.js 读取，避免 core 碰 window） */
var TOWN_OBJECTS_CACHE = [];
/* ★ 主城切换：默认不画旧静态建筑/椅子；?static=1 回滚成旧渲染 */
var TOWN_STATIC_ON = (function () {
  try { return ((location && location.search) || '').indexOf('static=1') >= 0; }
  catch (e) { return false; }
})();
/* ★ 2026-10-22：住宅/道具已从主城移除；?keepstatic=1 可回滚 */
var TOWN_KEEP_STATIC = (function () {
  try { return ((location && location.search) || '').indexOf('keepstatic=1') >= 0; }
  catch (e) { return false; }
})();
var UI = {
  /* ---- 画布与窗口 ---- */
  mainCanvas: function () { return document.getElementById('cv'); },
  /* ★ 2026-10-23：core 层不许碰 DOM ✗ 这几个给 game.js 用 ✓
     （WebGL 上下文拿不到时的降级链要用：换画布 / 重试计数 / 硬刷新）*/
  /* ★★★ 2026-10-23（用户："直接避免 WebGL 失败" / 选"共用主渲染器"）★★★
     整个页面【只允许一个 WebGL 上下文】= 主画布 #cv ✓
     皮肤预览 / 自定义小头像 都改成"借主渲染器渲染 → readPixels → 画到 2D canvas"
     · 为什么：手机给一个页面的 WebGL 上下文有上限（常见 8~16 个）
       以前每开一次皮肤页/自定义就多一个 ✗ 累计几次主画布就创建失败 ✓
     · 借用时要【存好并恢复】主渲染器的 尺寸/像素比/清屏设置 ✗ 不然主画面会被弄坏 ✓
     参数：scene / camera / 目标 2D canvas / 像素宽高 */
  /* ★★★ 2026-10-23 重写（用户："看完皮肤页退出来，界面一直闪黑"）★★★
     ★ 旧实现的致命缺陷：直接改主渲染器的尺寸来渲小图 ✗
       ① setSize(420,170) 会把主画布的 drawing buffer 缩成 420×170 ✓
       ② render() 又把主画布【清成黑底 + 画上皮肤模型】✓
       → 主循环下一帧之前，玩家看到的就是"黑一下/闪一下" ✓
       → 皮肤页反复开合 = 一直闪黑 ✓ 一字不差
     ★ 现在：改用【离屏渲染目标 RenderTarget】✗ 主画布一个像素都不碰 ✓
       · 主渲染器只负责"渲到离屏缓冲" ✓
       · 尺寸/视口/清屏色/autoClear 全部不动 ✓
       · 各预览各占一个 RT（很小 ✗ 不占 WebGL 上下文名额 ✓）*/
  _rtCache: {},
  _getRT: function (pw, ph) {
    var k = pw + 'x' + ph;
    var rt = this._rtCache[k];
    if (rt) { return rt; }
    rt = new THREE.WebGLRenderTarget(pw, ph, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      stencilBuffer: false
    });
    this._rtCache[k] = rt;
    return rt;
  },
  renderSceneTo2D: function (scene, cam, cv2d, pw, ph, bgColor) {
    try {
      if (typeof rd === 'undefined' || !rd || !scene || !cam || !cv2d) { return false; }
      var rt = this._getRT(pw, ph);
      var _oldRT = rd.getRenderTarget();
      var _autoClear = rd.autoClear;
      var _clearA = rd.getClearAlpha();
      var _clearC = null;
      try { _clearC = rd.getClearColor(new THREE.Color()); } catch (eC) { }
      var ok = false;
      try {
        /* ★ 只切"渲到哪"✗ 主画布的尺寸/视口一律不动 ✓ */
        rd.autoClear = true;
        rd.setClearColor((bgColor == null ? 0x000000 : bgColor), 0);
        rd.setRenderTarget(rt);
        rd.clear();
        rd.render(scene, cam);
        var buf = new Uint8Array(pw * ph * 4);
        rd.readRenderTargetPixels(rt, 0, 0, pw, ph, buf);
        if (cv2d.width !== pw) { cv2d.width = pw; }
        if (cv2d.height !== ph) { cv2d.height = ph; }
        var ctx2 = cv2d.getContext('2d');
        var img = ctx2.createImageData(pw, ph);
        for (var y = 0; y < ph; y++) {
          var src = (ph - 1 - y) * pw * 4;      /* WebGL 上下颠倒 ✓ 翻过来 */
          var dst = y * pw * 4;
          img.data.set(buf.subarray(src, src + pw * 4), dst);
        }
        ctx2.putImageData(img, 0, 0);
        ok = true;
      } finally {
        try {
          rd.setRenderTarget(_oldRT || null);
          if (_clearC) { rd.setClearColor(_clearC, _clearA); }
          else { rd.setClearAlpha(_clearA); }
          rd.autoClear = _autoClear;
        } catch (eR) { }
      }
      return ok;
    } catch (e) {
      return false;
    }
  },
  rebuildMainCanvas: function () {
    try {
      var old = document.getElementById('cv');
      if (!old || !old.parentNode) { return null; }
      var cv = document.createElement('canvas');
      cv.id = 'cv';
      if (old.className) { cv.className = old.className; }
      var st = old.getAttribute('style');
      if (st) { cv.setAttribute('style', st); }
      old.parentNode.replaceChild(cv, old);
      return cv;
    } catch (e) { return null; }
  },
  glBootRetryGet: function () {
    try { return +(sessionStorage.getItem('glBootRetry') || 0); } catch (e) { return 0; }
  },
  glBootRetrySet: function (n) {
    try { sessionStorage.setItem('glBootRetry', String(n)); } catch (e) { }
  },
  glBootRetryClear: function () {
    try { sessionStorage.removeItem('glBootRetry'); } catch (e) { }
  },
  hardReload: function (why) {
    try {
      if (typeof netHardReload === 'function') { netHardReload(why || 'reload'); return; }
    } catch (e) { }
    try { location.reload(); } catch (e2) { }
  },
  win: function () { return window; },
  search: function () { return location.search; },
  onResize: function (fn) { addEventListener('resize', fn); },
  raf: function (fn) { return requestAnimationFrame(fn); },
  offscreen: function (w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  },

  /* ---- 元素 ---- */
  el: function (id) { return document.getElementById(id); },
  /* ★ round426：性能面板（core 每 30 帧调一次 ✓ 只有开了才执行 ✓）*/
  perfBar: function (st) { return perfBar(st); },
  /* ★ round437：挂机击杀数（临时显示 ✗ 关了就隐藏 ✓）*/
  autoStat: function (on, kills, secs) { return autoStatShow(on, kills, secs); },
  /* ★ round437：屏幕白闪（升级特效用 ✓）*/
  flashWhite: function (secs, color) { return flashWhite(secs, color); },
  text: function (id, s) {
    var e = document.getElementById(id);
    if (e) { e.textContent = s; }
  },
  html: function (id, s) {
    var e = document.getElementById(id);
    if (e) { e.innerHTML = s; }
  },
  style: function (id, prop, v) {
    var e = document.getElementById(id);
    if (e) { e.style[prop] = v; }
  },
  show: function (id, on) {
    var e = document.getElementById(id);
    if (e) { e.style.display = on ? '' : 'none'; }
  },
  /* ★ 刷新左上角的角色 HUD（名字/等级/经验）——第 35 轮加的
     core 里"服务器说我的经验变了"要刷 HUD，但 core 不能碰 DOM ✗
     所以走 UI.* ✓（原来的写法是 core 里读 window.showRole ✗ 分层闸门直接拦下来了）*/
  role: function (r) { if (r) { showRole(r); } },
  onError: function (fn) { window.onerror = function (msg) { fn(msg); return true; }; },
  on: function (id, evt, fn) {
    var e = document.getElementById(id);
    if (e) { e.addEventListener(evt, fn); }
  },

  /* ---- 存储 ---- */
  store: {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { } }
  }
};


/* ---- 名牌（头顶 UI）----
   ★ core 只说"显示/移动/改血条/改名字"，不碰 style 属性名 ——
     小游戏里这套要换成 canvas 自绘，只要改这里 ✓ */
/* ★★ round425（用户："奖牌怎么变成文字了"）：奖牌改成【自画的 SVG】★★
   ★ 为什么不用 emoji（🥇🥈🥉）：
     ① 老安卓 / 部分浏览器的字体里没有 emoji → 显示成豆腐块 ✗
     ② 这个项目里 emoji 已经被编码坑过两次（写文件都能被截断）✗
   ★ 为什么不用「金/银/铜」文字：
     用户要的是【奖牌】✗ 文字牌不像奖牌 ✓
   ★ 这个画法：红绶带（两条斜的）+ 圆牌 + 内圈 + 描边
     金/银/铜只换填充色 ✓ 一份代码三种牌 ✓ 不依赖任何字体/素材 ✓ */
function medalSvg(rank, size) {
  var r = rank | 0;
  var col = r === 1 ? '#ffd83d' : (r === 2 ? '#d7e0ea' : (r === 3 ? '#e3a06a' : ''));
  if (!col) { return ''; }
  var dark = r === 1 ? '#8a6a12' : (r === 2 ? '#6d7784' : '#8a5230');
  var s = size || 13;
  /* 绶带：两条从左上/右上斜下来，在圆牌上方交叉 */
  return '<svg viewBox="0 0 16 19" width="' + s + '" height="' + Math.round(s * 19 / 16) + '"'
    + ' style="vertical-align:-3px;margin-right:2px;flex:0 0 auto" aria-hidden="true">'
    + '<polygon points="3.0,0 5.6,0 9.0,8.0 6.4,8.0" fill="#cf5b5b"/>'
    + '<polygon points="10.4,0 13.0,0 7.0,8.0 4.4,8.0" fill="#9d3f3f"/>'
    + '<circle cx="8" cy="12.6" r="5.6" fill="' + col + '" stroke="' + dark + '" stroke-width="1.1"/>'
    + '<circle cx="8" cy="12.6" r="3.4" fill="none" stroke="' + dark + '" stroke-width="0.9" opacity="0.75"/>'
    + '<circle cx="6.3" cy="10.9" r="1.1" fill="#ffffff" opacity="0.55"/>'
    + '</svg>';
}

/* ★★★ round437（用户："自动挂机时做一个显示击杀了多少数量的显示，挂机结束时关闭显示"）★★★
   ★ 临时显示 ✗ 不存盘、不发给服务器 ✓ 关掉挂机就消失 ✓
   ★ 放在屏幕上方中间（不挡名牌、不挡技能键 ✓） */
var _autoStatEl = null;
function autoStatMake() {
  if (_autoStatEl) { return _autoStatEl; }
  var d = document.createElement('div');
  d.id = 'autoStat';
  d.style.cssText = 'position:fixed;top:120px;left:50%;transform:translateX(-50%);z-index:55;'
    + 'display:none;padding:5px 12px;border-radius:14px;'
    + 'background:rgba(12,16,12,.72);border:1px solid #8ee0a855;'
    + 'font:12.5px/1.5 ui-monospace,Consolas,monospace;color:#dfe8d4;white-space:nowrap;'
    + 'pointer-events:none;text-shadow:0 1px 2px #000';
  document.body.appendChild(d);
  _autoStatEl = d;
  return d;
}
/* on=false → 隐藏；kills/secs 只在 on 时用 ✓ */
function autoStatShow(on, kills, secs) {
  var d = autoStatMake();
  if (!on) {
    d.style.display = 'none';
    d.textContent = '';
    return;
  }
  d.style.display = 'block';
  /* ★★ round439（用户："挂机击杀数显示的位置再往下面些，不然会和系统提示详细遮挡在一起"）★★
     → 不写死 top ✗ 而是按【弹幕/系统提示底边 + 44px】动态让开 ✓
     （弹幕开两行时它也会自动再往下 ✓）*/
  var _top = 120;
  try { if (typeof tkToastTop === 'function') { _top = tkToastTop() + 44; } } catch (e1) { }
  if (_top > innerHeight * 0.45) { _top = Math.round(innerHeight * 0.45); }
  d.style.top = _top + 'px';
  var t = Math.max(0, Math.round(+secs || 0));
  var mm = Math.floor(t / 60), ss = t % 60;
  try { autoStatSave(); } catch (e3) { }
  d.innerHTML = '挂机中 · 击杀 <b style="color:#ffd83d">' + (kills | 0)
    + '</b> · ' + mm + ':' + (ss < 10 ? '0' + ss : ss);
}

/* ★ round437：屏幕白闪（升级/突破那一下用 ✗ 纯表现 ✓）*/
var _flashEl = null;
function flashWhite(secs, color) {   /* ★ round438：可以传颜色（升级用冷白 ✓）*/
  if (!_flashEl) {
    var d = document.createElement('div');
    d.id = 'whiteFlash';
    d.style.cssText = 'position:fixed;inset:0;z-index:70;pointer-events:none;'
      + 'background:#eaf6ff;opacity:0;transition:none';
    document.body.appendChild(d);
    _flashEl = d;
  }
  if (color) { _flashEl.style.background = color; }
  _flashEl.style.transition = 'none';
  _flashEl.style.opacity = '0.55';
  /* 下一帧开始淡出（不然浏览器把两次设置合并 → 不动 ✗）*/
  requestAnimationFrame(function () {
    if (!_flashEl) { return; }
    _flashEl.style.transition = 'opacity ' + Math.max(0.08, +secs || 0.14) + 's ease-out';
    _flashEl.style.opacity = '0';
  });
}

/* ★ round440：挂机击杀数的临时存档（刷新不丢 ✗ 服务器重启就清 ✓）
   存的是 { boot, kills, t0ms }：boot = 服务器启动号 ✗ 不一样就当作旧数据丢掉 ✓ */
var AUTOSTAT_KEY = 'xx3d_autostat';
function autoStatSave() {
  try {
    if (typeof AUTO === 'undefined' || !AUTO.on) { return; }
    /* 存"已经挂了多少秒"比存时间戳更稳（不受页面/系统时钟调整影响 ✓）*/
    var el = AUTO.t0 ? Math.max(0, (performance.now() - AUTO.t0) / 1000) : 0;
    localStorage.setItem(AUTOSTAT_KEY, JSON.stringify({
      boot: (typeof WSC !== 'undefined' && WSC.boot) ? WSC.boot : 0,
      kills: AUTO.kills | 0,
      el: Math.round(el)
    }));
  } catch (e) { }
}
function autoStatReset() {
  try { localStorage.removeItem(AUTOSTAT_KEY); } catch (e) { }
  if (typeof AUTO !== 'undefined') { AUTO.kills = 0; AUTO.t0 = performance.now(); AUTO.statT = 0; }
}
function autoStatRestore() {
  if (typeof AUTO === 'undefined') { return; }
  var d = null;
  try { var raw = localStorage.getItem(AUTOSTAT_KEY); d = raw ? JSON.parse(raw) : null; } catch (e) { d = null; }
  if (d && typeof d.kills === 'number' && typeof d.el === 'number') {
    /* ★ 有存档就接着算 ✗ 不管是不是刚刷新/刚重启服务器 ✓
       （用户：只有关掉自动战斗才清零 ✓）*/
    AUTO.kills = d.kills | 0;
    AUTO.t0 = performance.now() - Math.max(0, d.el) * 1000;
  } else {
    AUTO.kills = 0;
    AUTO.t0 = performance.now();
  }
  AUTO.statT = 0;
  try { autoStatShow(AUTO.on, AUTO.kills, AUTO.t0 ? (performance.now() - AUTO.t0) / 1000 : 0); } catch (e4) { }
}

/* ★ round582（A8）：左上角护盾条 */
var _shieldHud = null;
function skShieldHud(v) {
  var n = Math.max(0, Math.round(+v || 0));
  if (!_shieldHud) {
    var d = document.createElement('div');
    d.id = 'skShieldHud';
    d.style.cssText = 'margin-top:3px;font-size:10px;font-weight:700;color:#7fd4ff;'
      + 'text-shadow:0 1px 2px #000;display:none';
    var top = document.getElementById('top');
    if (top) { top.appendChild(d); } else { return; }
    _shieldHud = d;
  }
  if (n <= 0) { _shieldHud.style.display = 'none'; _shieldHud.textContent = ''; return; }
  _shieldHud.style.display = 'block';
  _shieldHud.textContent = '护盾 ' + n;
}

/* ★ round577（用户："坦克引擎击杀后显示叠了多少层 + 图标"）*/
var _tankEl = null, _tankTimer = 0;
function skTankNotice(n, bonus) {
  if (!_tankEl) {
    var d = document.createElement('div');
    d.id = 'tankNotice';
    /* ★ round579（用户要求）：往上、小一点、半透明 */
    d.style.cssText = 'position:fixed;left:50%;top:32%;transform:translate(-50%,-50%);'
      + 'z-index:60;display:flex;align-items:center;gap:6px;padding:4px 9px;'
      + 'border-radius:8px;background:rgba(26,18,8,.55);border:1px solid rgba(255,179,71,.6);'
      + 'box-shadow:0 0 12px rgba(255,154,60,.35);pointer-events:none;'
      + 'opacity:0;transition:opacity .2s;white-space:nowrap';
    document.body.appendChild(d);
    _tankEl = d;
  }
  var ic = '';
  try { if (window.SKI) { ic = SKI.icon('tank', 'B', 24); } } catch (e) { }
  _tankEl.innerHTML =
    (ic ? ('<img src="' + ic + '" style="width:24px;height:24px;display:block;opacity:.95">') : '')
    + '<div style="line-height:1.2">'
    + '<div style="color:#ffd83d;font-size:12px;font-weight:800">坦克引擎 ×' + (n | 0) + '</div>'
    + (bonus > 0 ? ('<div style="color:#ffc98a;font-size:10px">生命 +' + (bonus | 0) + '</div>') : '')
    + '</div>';
  _tankEl.style.opacity = '0.92';
  try { clearTimeout(_tankTimer); } catch (e2) { }
  _tankTimer = setTimeout(function () {
    if (_tankEl) { _tankEl.style.opacity = '0'; }
  }, 1600);
}

UI.plate = {
  show: function (ui, on) { if (ui && ui.wrap) {
    on = !!on;
    if (ui._shown === on) { return; }
    ui._shown = on;
    ui.wrap.style.display = on ? 'block' : 'none';
  } },
  move: function (ui, sx, sy) {
    if (ui && ui.wrap) {
      var _tr = 'translate(-50%,-100%) translate(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px)';
      if (ui._tr === _tr) { return; }
      ui._tr = _tr;
      ui.wrap.style.transform = _tr;
    }
  },
  /* ★★ 第 155 轮（用户要求）：魔气【单独一行】，在名字那行上面 ★★
     · 格式：👿 500（红色，五档递增 ✓）
     · v<=0 → 整行隐藏（不显示"0"✗）
     · ★ 为什么单独一个元素：
         ① 用户明确说"第一行是他的名字"✗ 魔气要另起一行 ✓
         ② 拼进名字会撞上"两处都在写名字"那个老坑 ✓（我踩过 4 次 ✗）
           独立元素只有一处写 ✓ 谁都不会覆盖谁 ✓
     · ★ 只建一次，之后只改文字和颜色 ✗（每帧都会调 ✓ 不能每次建元素 ✓）*/
  /* ★★★ round424（用户："可以设置其中一个排行榜排名显示在玩家头上…不要和名字以及魔气冲突了，
                  把这个显示在最顶上"）★★★
     ★ 做法：在名牌上方建一个【竖排容器】（绝对定位 + 居中 ✗ 不占布局 ✓）
       里面从上到下：称号 → 魔气（原来那个 ✓）→（名牌本身：名字+血条）
     ★ 为什么要容器：两个绝对定位元素都写 bottom:100% 会重叠 ✗
       放进 flex 竖排就自动堆叠 ✗ 以后再加第三行也不用改坐标 ✓
     ★ 旧坑回归点：魔气那个「居中」修过 3 次 ✗ 改完必须看它还居中 ✓ */
  _top: function (ui) {
    if (ui.topEl && ui.topEl.parentNode) { return ui.topEl; }
    var box = document.createElement('div');
    box.style.cssText = 'position:absolute;left:50%;transform:translateX(-50%);bottom:100%;'
      + 'display:flex;flex-direction:column;align-items:center;gap:1px;'
      + 'white-space:nowrap;pointer-events:none';
    ui.wrap.appendChild(box);
    ui.topEl = box;
    return box;
  },
  /* 称号：国服在线top1（前三名前面加金/银/铜牌 ✓）
     text 空 = 隐藏 ✗ medal = 1/2/3 ✓ */
  /* ★ 2026-10-22（用户："头上的信息框要能看见经验这些，需要同步显示"）
     打工进度行：打工中 00:23 · +3194金 +13经验
     ★ 和称号/魔气一样走 _top 容器 ✓ 不拼进名字（避免互相覆盖 ✓）*/
  job: function (ui, text) {
    if (!ui || !ui.wrap) { return; }
    var t = String(text || '');
    if (!t) {
      if (ui.jobEl) { ui.jobEl.style.display = 'none'; }
      return;
    }
    if (!ui.jobEl) {
      var el = document.createElement('div');
      el.style.cssText = 'font-size:10px;font-weight:700;line-height:1.25;color:#ffd83d;'
        + 'text-shadow:0 1px 2px #000,0 0 4px #000;letter-spacing:.2px';
      var box = this._top(ui);
      box.appendChild(el);
      ui.jobEl = el;
    }
    if (ui.jobEl.textContent !== t) { ui.jobEl.textContent = t; }
    if (ui.jobEl.style.display === 'none') { ui.jobEl.style.display = 'block'; }
  },
  title: function (ui, text, medal) {
    if (!ui || !ui.wrap) { return; }
    var t = String(text || '');
    if (!t) {
      if (ui.ttlEl) { ui.ttlEl.style.display = 'none'; }
      return;
    }
    if (!ui.ttlEl) {
      var el = document.createElement('div');
      el.style.cssText = 'font-size:10px;font-weight:700;line-height:1.25;'
        + 'text-shadow:0 1px 2px #000,0 0 4px #000;letter-spacing:.3px';
      var box = this._top(ui);
      /* ★ round491（用户："魔气和称号换个位置，魔气在最上边"）
         → 称号不再插到第一个 ✗ 改成追加 ✓（魔气才是第一行 ✓）*/
      box.appendChild(el);
      ui.ttlEl = el;
    }
    var m = medal | 0;
    var col = m === 1 ? '#ffd83d' : (m === 2 ? '#d7e0ea' : (m === 3 ? '#e3a06a' : '#c9d3ba'));
    /* ★ round425：奖牌 = 自画 SVG（金牌/银牌/铜牌 ✓ 不依赖字体 ✓）*/
    var badge = medalSvg(m, 12);
    var html = badge + '<span>' + rankEsc(t) + '</span>';
    if (ui._ttlHtml !== html) {
      ui._ttlHtml = html;
      ui.ttlEl.innerHTML = html;
    }
    if (ui._ttlCol !== col) { ui._ttlCol = col; ui.ttlEl.style.color = col; }
    ui.ttlEl.style.display = 'block';
  },
  mq: function (ui, v) {
    if (!ui || !ui.wrap) { return; }
    v = Math.round(+v || 0);
    if (v <= 0) {
      if (ui.mqEl) { ui.mqEl.style.display = 'none'; }
      return;
    }
    if (!ui.mqEl) {
      var el = document.createElement('div');
      /* ★ 第 162 轮（用户：恶魔头没有居中）：
         原因：这个 div 是块级元素（占满一行）✗
               而 SVG 是行内元素 → 只靠父级的 text-align 不一定靠调✗
         修：自己也声明一次居中 + 用 flex 再保险一层 ✓ */
      /* ★★ 第 165 轮（用户：恶魔头没居中，要相对【血条】居中）★★
         前两版我都用“块级元素撑满 + flex 居中”✗
         这种写法受【宽度由谁决定】影响 ✗
           名牌是 shrink-to-fit（谁宽就跟谁 ✗）
           而名字、血条、恶魔头三个宽度各不相同 ✗
           → 就算 flex 居中，也只是“在它自己那个宽度里居中” ✗
         ★ 修法：【绝对定位】钉死 ✓
             left:50% + translateX(-50%) → 中心永远在名牌正中央 ✓
             bottom:100% → 正好贴在名牌上方（不挤压名字/血条 ✓）
         ★ 兼得：它不占布局了 → 名牌不会被恶魔头顶得往上跑 ✗（之前会 ✗）*/
      /* ★ round424：改成放进【顶部竖排容器】✗ 和称号一起堆 ✓
         （原来是自己绝对定位：一旦上面再多一行称号就会重叠 ✗）*/
      el.style.cssText = 'font-size:11px;font-weight:700;line-height:1.15;white-space:nowrap;'
        + 'text-shadow:0 1px 2px #000,0 0 3px #000';
      /* ★ round491：魔气插到【第一个】→ 名牌最上面那一行 ✓
         （称号改成追加 → 排在魔气下面 ✓）*/
      var _tb = this._top(ui);
      _tb.insertBefore(el, _tb.firstChild);
      ui.mqEl = el;
    }
    /* ★ 第 157 轮：改成【自画的恶魔头】✗ 数字在头里面 ✓（用户要求 ✓）
       ★ 只在值变了才重建 ✗（这个函数每帧都调 ✓ 每帧重画 SVG 会白烧 CPU ✓）*/
    if (ui._mqV !== v) {
      ui._mqV = v;
      ui.mqEl.innerHTML = mqSvg(v);
    }
    ui.mqEl.style.display = 'block';
  },
  hpWidth: function (ui, pct) {
    if (ui && ui.bar && ui._hpw !== pct) { ui._hpw = pct; ui.bar.style.width = pct; }
  },
  hpColor: function (ui, color) {
    if (ui && ui.bar && ui._hpc !== color) { ui._hpc = color; ui.bar.style.background = color; }
  },
  /* ★ 第 87 轮：加颜色参数 ✓
     ★ 踩过的坑：第 86 轮我插"带颜色的 name"时锚点是 remove: function (m) ✗
       结果插进了【UI.mark】✗ 而 plate 这个两参数的没动 ✗
       → 表现是"五角星有了、但颜色没变"✓（静默失效，最难查 ✗）*/
  name: function (ui, s, color) {
    if (!ui || !ui.name) { return; }
    if (ui.name.textContent !== s) { ui.name.textContent = s; }
    if (color && ui.name.style.color !== color) { ui.name.style.color = color; }
  },
  /* ★ round584：头顶状态标签（冰冻等）*/
  tag: function (ui, s, color) {
    if (!ui || !ui.wrap) { return; }
    if (!ui.tagEl) {
      var el = document.createElement('div');
      el.style.cssText = 'font-size:11px;font-weight:800;line-height:1.1;white-space:nowrap;'
        + 'text-shadow:0 1px 2px #000,0 0 5px #0a2a44;display:none';
      var _tb = this._top(ui);
      _tb.insertBefore(el, _tb.firstChild);
      ui.tagEl = el;
    }
    if (!s) { ui.tagEl.style.display = 'none'; ui.tagEl.textContent = ''; return; }
    ui.tagEl.style.display = 'block';
    if (ui.tagEl.style.color !== (color || '#9fe8ff')) {
      ui.tagEl.style.color = color || '#9fe8ff';
    }
    if (ui.tagEl.textContent !== s) { ui.tagEl.textContent = s; }
  },
  /* ★ 持续技能/被动触发：头顶小进度条 */
  buffs: function (ui, list) {
    if (!ui || !ui.wrap) { return; }
    if (!ui.buffEl) {
      var box = document.createElement('div');
      box.style.cssText = 'display:flex;flex-direction:column;gap:1px;margin-bottom:2px;'
        + 'pointer-events:none;white-space:nowrap';
      this._top(ui).appendChild(box);
      ui.buffEl = box;
      ui._buffRows = {};
    }
    var rows = ui._buffRows || (ui._buffRows = {});
    var seen = {};
    list = list || [];
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (!b || !b.n) { continue; }
      seen[b.n] = 1;
      var r = rows[b.n];
      if (!r) {
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:3px;font-size:8px;'
          + 'font-weight:700;color:#dff3ff;text-shadow:0 1px 2px #000';
        var nm = document.createElement('span');
        nm.style.cssText = 'min-width:30px;text-align:right;opacity:.9';
        var bw = document.createElement('div');
        bw.style.cssText = 'width:44px;height:3px;background:#00000099;border-radius:2px;overflow:hidden';
        var bar = document.createElement('div');
        bar.style.cssText = 'height:100%;width:100%;background:' + (b.c || '#8ee0a8') + ';border-radius:2px';
        bw.appendChild(bar); row.appendChild(nm); row.appendChild(bw); ui.buffEl.appendChild(row);
        r = rows[b.n] = { row: row, nm: nm, bar: bar };
      }
      var pct = Math.max(0, Math.min(100, (b.t / Math.max(0.01, b.m)) * 100));
      var txt = b.n + ' ' + Math.ceil(b.t) + 's';
      if (r.nm.textContent !== txt) { r.nm.textContent = txt; }
      r.bar.style.width = pct.toFixed(0) + '%';
      r.row.style.display = 'flex';
    }
    for (var k2 in rows) {
      if (!seen[k2] && rows[k2]) { rows[k2].row.style.display = 'none'; }
    }
  },
  /* ★ 第 88 轮（用户要求）：把数字放到【血条里面】✗ 不是条上面 ✓
     · 把血条那层加高到 13px（原来的 6px 放不下 9px 的字 ✗）
     · 在条里叠一层居中的文字（绝对定位 ✓ 不占布局 ✓）
     · 只建一次，之后只改 textContent ✓（这是每帧可能调用的 ✓ 不能每次建元素 ✗）*/
  barText: function (ui, s, color, h) {
    if (!ui || !ui.wrap || !ui.bar) { return; }
    var w = ui.bar.parentElement;
    if (!w) { return; }
    var _H = h || 13;                     // ★ 第 89 轮：加个高度参数（僵尸/玩家用 10 ✓）
    if (!ui.bt) {
      w.style.height = _H + 'px';         // ★ 加高（原来 6px ✗ 字放不下）
      w.style.position = 'relative';
      var sp = document.createElement('span');
      sp.style.cssText = 'position:absolute;left:0;right:0;top:0;bottom:0;display:flex;' +
        'align-items:center;justify-content:center;font-size:' + (_H <= 10 ? 8 : 9) +
        'px;font-weight:700;' +
        'color:#fff;text-shadow:0 1px 2px #000,0 0 3px #000;pointer-events:none;' +
        'letter-spacing:0.2px';
      w.appendChild(sp);
      ui.bt = sp;
      // ★ 注意：只有【自己的血条】才藏名字 ✓
      //   （僵尸那行还有"职业+等级"✗ 玩家那行还有名字 ✗ 藏了就丢信息了 ✓）
    }
    if (ui.bt.textContent !== s) { ui.bt.textContent = s; }
    if (color && ui.bt.style.color !== color) { ui.bt.style.color = color; }
  },
  remove: function (ui) {
    if (ui && ui.wrap && ui.wrap.parentNode) { ui.wrap.parentNode.removeChild(ui.wrap); }
  }
};

/* 元素是否真的在屏幕上（小游戏里恒为 true，无所谓） */
UI.visible = function (id) {
  var e = document.getElementById(id);
  return !!(e && e.offsetParent !== null);
};

/* ---------- setDetail ---------- */
/* ★★ 第 79 轮：阴影质量开关（用户要求做个开关自己 A/B）★★
   为什么做成【手动开关】而不是自动降画质 ✗：
     用户明确说过不要自动降画质 ✓，而且手动切换能让他两下就看出
     "到底是不是阴影的锅" ✓（比我在代码里猜准得多 ✓）
   high = 2048² 每 2 帧（和以前完全一样 ✓ 默认值 ✓ 不改变现状 ✓）
   mid  = 1024² 每 4 帧（方块影子肉眼几乎看不出差别 ✓ 开销约 1/8）
   off  = 完全不画影子（最省 ✓）*/
function setShadow() { return (SETCFG && SETCFG.shadow) || 'high'; }

function setDetail() { return (SETCFG && SETCFG.detail) ? SETCFG.detail : SET_DEF.detail; }

/* ---------- E ---------- */
function E(m) { var e = document.getElementById('err'); if (e) { e.textContent = String(m); } }

/* ★★★ 第 80 轮：音频改走 WebAudio（用户实测确认：关音效就不卡了）★★★

   【为什么原来会卡（用户的设备实测 ✓）】
     · 原来每个音效是一个 <audio> 元素 ✓ 播放 = el.play() ✗
     · iOS(WebKit) 上每播一次都要走 AVFoundation 的播放路径 ✗
       解码调度 / 音频会话 / 和主线程抢时间 ✗ → 每次挥砍卡一下 ✓
     · 安卓(Blink)那条路径便宜得多 → 所以 OPPO 不卡、iPhone/iPad 卡 ✓✓
     · 走路一声不放 → 所以走路完全不卡 ✓✓（用户观察完全对得上 ✓）

   【为什么上次我改错了】
     我第 75 轮是"每个音源预建 4 个 <audio>"✗ → 24 份解码 ✗ 更卡 ✓
     方向反了 ✗ 问题不在"复用"，在【用不用 <audio> 这条路】✗

   【正确做法】WebAudio：
     · 启动时把每个音效 decodeAudioData 一次 → 存成 AudioBuffer（内存里）✓
     · 播放 = createBufferSource + 接一个 GainNode ✓
       纯内存操作 ✓ 不碰解码器 ✗ 不起音频会话 ✗
     · 顺便：每次播放轻微随机音高 ✓ 听感更自然 ✓（同一段音反复播不"打点"✓）
     · 并发上限 6 ✓ 超了丢（听不出来 ✓）
     · ★ 解码失败/不支持 → 自动退回老的 <audio> 路径 ✓ 不会没声音 ✓
*/
var _actx = null, _aVoices = 0, _aGestured = false;
/* ★ 第 83 轮：消掉 "AudioContext was not allowed to start" 警告 ✗
   浏览器规矩：上下文必须在【用户手势】里 resume 才能出声 ✓
   之前我只在播放那一刻 resume ✗ 而那时可能已经错过了手势窗口 ✗
   → 现在监听【第一次】点击/触摸/按键 → 立即 resume ✓ 一次性 ✗不重复绑 ✗ */
function _aGesture() {
  if (_aGestured) { return; }
  _aGestured = true;
  try {
    var ac = audioCtx();
    if (ac && ac.state === 'suspended') { ac.resume(); }
  } catch (e) { }
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('pointerdown', _aGesture, { passive: true });
  document.addEventListener('touchstart', _aGesture, { passive: true });
  document.addEventListener('keydown', _aGesture, { passive: true });
}
var SFX_PITCH = 0.06;          // 音高随机幅度（±6% ✓）
var SFX_MAX_VOICES = 6;        // 同时最多几个音
function audioCtx() {
  if (_actx === null) {
    var AC = (typeof window !== 'undefined') &&
             (window.AudioContext || window.webkitAudioContext);
    try { _actx = AC ? new AC() : false; } catch (e) { _actx = false; }
  }
  return _actx || null;
}

/* ---------- loadSfx ---------- */
var SFX_LAZY = {};        /* ★ 还没加载的音效（key → 文件名数组）*/
var _sfxCoreLoaded = false;

/* ★ 单独加载一个键（""用到了才拉"" 和"后台补齐"都走这里 ✓）*/
/* ★ round445：按键选格式（优先 ogg；只有 wav 的就直接 wav ✓）*/
function _sfxUrl(k, wavName) {
  /* ★ round447：三种优先级 —— mp3优先 / 只有 wav / 默认 ogg ✓ */
  var mp3Only = (typeof SFX_MP3_ONLY !== 'undefined' && SFX_MP3_ONLY) ? SFX_MP3_ONLY.indexOf(k) >= 0 : false;
  if (mp3Only) { return { url: wavName.replace(/\.wav$/, '.mp3'), attempt: 0 }; }
  var wavOnly = (typeof SFX_WAV_ONLY !== 'undefined' && SFX_WAV_ONLY) ? SFX_WAV_ONLY.indexOf(k) >= 0 : false;
  if (wavOnly) { return { url: wavName, attempt: 2 }; }
  return { url: wavName.replace(/\.wav$/, '.ogg'), attempt: 1 };
}
function loadSfxKey(k) {
  var list = SFX_LAZY[k];
  if (!list) { return; }
  delete SFX_LAZY[k];
  if (!SFX_BANK[k]) { SFX_BANK[k] = []; }
  for (var i = 0; i < list.length; i++) {
    SFX_TOTAL++;
    var u = _sfxUrl(k, list[i]);
    tryOne(k, '/assets/sfx/' + u.url, u.attempt);
  }
}

/* ★ 进世界之后在后台把剩下的慢慢补齐（一个一个来，不抢带宽 ✓）*/
function warmSfxRest() {
  var keys = [];
  for (var k in SFX_LAZY) { keys.push(k); }
  var i = 0;
  (function next() {
    if (i >= keys.length) { return; }
    loadSfxKey(keys[i++]);
    setTimeout(next, 260);
  })();
}

function loadSfx() {
  /* ★★ round443/445：首屏只拉【核心 3 个】音效 ✗ 其余的进世界后在后台补齐 ✓
     实测：全部 wav = 1935KB ✗ 全部 ogg 仅约 250KB ✗ 核心 3 个的 ogg 约 30KB ✓ */
  var core = (typeof SFX_CORE !== 'undefined' && SFX_CORE) ? SFX_CORE : null;
  for (var k in SFX_FILES_WAV) {
    var isCore = !core || core.indexOf(k) >= 0;
    if (!isCore) { SFX_LAZY[k] = SFX_FILES_WAV[k]; continue; }
    SFX_BANK[k] = [];
    var list = SFX_FILES_WAV[k];
    for (var i = 0; i < list.length; i++) {
      SFX_TOTAL++;
      var u = _sfxUrl(k, list[i]);
      tryOne(k, '/assets/sfx/' + u.url, u.attempt);   // ★ round445：ogg 优先
    }
  }
  // 每秒检查一次：全部加载完 → 补播排队 ✓
  // ★ 第 32 轮：原来这里还会把"音效 x/31"写进 #diag，用户要求诊断里不要音效 → 删掉 ✓
  var chk = setInterval(function () {
    if (SFX_LOADED >= SFX_TOTAL && SFX_TOTAL > 0) {
      clearInterval(chk);
      flushQueue();
    }
  }, 500);
}

/* ---------- tryOne ---------- */
function tryOne(key, url, attempt) {
  var label = (attempt === 0) ? 'mp3' : ((attempt === 1) ? 'ogg' : 'wav');
  fetch(url).then(function (r) {
    if (!r.ok) { throw new Error('HTTP ' + r.status); }
    return r.arrayBuffer();
  }).then(function (buf) {
    if (buf.byteLength < 40) { throw new Error('文件太小 ' + buf.byteLength); }
    var mime = (label === 'mp3') ? 'audio/mpeg' : ((label === 'ogg') ? 'audio/ogg' : 'audio/wav');
    /* ★ 第 80 轮：优先走 WebAudio —— 一次解码，之后播放全是内存操作 ✓ */
    var ac = audioCtx();
    if (ac && ac.decodeAudioData) {
      ac.decodeAudioData(buf.slice(0), function (abuf) {
        SFX_BANK[key].push({ buf: abuf });      // ★ 只存 AudioBuffer ✓ 不是 <audio> ✗
        SFX_LOADED++;
      }, function () {
        _sfxFallback(key, buf, mime, label, attempt);
      });
      return;
    }
    _sfxFallback(key, buf, mime, label, attempt);
  }).catch(function (e) {
    SFX_ERR.push(key + ':' + label + ' ' + e.message);
    nextTry(key, attempt);
  });
}

/* ★ 老路径（<audio>）留作兜底 ✓ 只在 WebAudio 不可用/解码失败时才走到 ✓ */
function _sfxFallback(key, buf, mime, label, attempt) {
  try {
    var objUrl = URL.createObjectURL(new Blob([buf], { type: mime }));
    var a = new Audio();
    a.preload = 'auto';
    a.volume = SFX_VOL;
    a.addEventListener('canplaythrough', function () { SFX_LOADED++; }, { once: true });
    a.addEventListener('error', function () {
      SFX_ERR.push(key + ':' + label + ' 解码失败(' + (a.error ? a.error.code : '?') + ')');
      nextTry(key, attempt);
    }, { once: true });
    a.src = objUrl;
    a.load();
    SFX_BANK[key].push(a);
  } catch (e) {
    SFX_ERR.push(key + ':兜底失败 ' + e.message);
    nextTry(key, attempt);
  }
}


/* ---------- sfx ---------- */
/* ★★ 第 76 轮：音频池撤了（用户反馈“这样改感觉更卡”）★★
   我上一版给每个音源预建 4 个声道 ✗
     而挥砍声有 6 个变体 → 一上来就是 24 份音频在解码 ✗✗
     iOS 上这比“每次新建”还重 ✗（改错了方向 ✗）

   现在改成【最省】的做法：
     每个变体只保留 1 个 Audio ✓
     它还在响 → 【直接丢掉这一声】✓ 不新建、也不预建 ✗
       （重叠的一声本来就听不出来 ✗ 丢了也没关系 ✓）

   ★ 如果还是卡，请直接把设置里的音效关掉打一局 ✓
     关了就不卡 → 确实是音频问题 ✓ 我再想别的方法
     关了还卡 → 不是音频 ✗ 我去查别的（下一个怀疑：每帧投影血条）
*/
/* ★ round348（用户："如果没来得及逃跑或者没放完就死了要把音效停止"）
   ★ 按【频道】播放：同频道再播会先掐掉旧的 ✗ 可以单独 stop ✓
   ★ 为什么不用全局 stop：会把打斗音效一起掐掉 ✓ */
var SFX_CH = {};
var STICK_ACTIVE = false;   // ★ round372：手指在摇杆上（core 据此决定能不能清摇杆值）
function sfxStop(ch) {
  var e = SFX_CH[ch];
  if (!e) { return; }
  try { e.src.stop(0); } catch (e2) { }
  try { e.gn.disconnect(); } catch (e3) { }
  delete SFX_CH[ch];
}
function sfx(name, volScale, ch) {
  if (!SFX_ON) { return; }
  /* ★★ 第 183 轮（用户："游戏还没有登录就有打斗的声音了"）★★
     原因：登录框是【盖在游戏画面上的一个层】✗
       游戏世界在它后面一直在跑 ✓ 单机兜底还会刷本地僵尸 ✓
       → 僵尸打你 → 挨打音效 / 挥砍音效全都在响 ✓ 而你还停在登录界面 ✓
     修：没登录就一声都不出 ✓（一个判断管住所有音效 ✓ 最省事也最不容易漏 ✓）*/
  if (typeof WSC !== 'undefined' && !WSC.role) { return; }
  if (!_audioUnlocked) { unlockAudio(); }
  var bank = SFX_BANK[name];
  /* ★ round443：这个音效还在"待加载"里 → 当场拉它（不进排队 ✗ 避免开了一半才响 ✓）*/
  if ((!bank || !bank.length) && SFX_LAZY[name]) {
    loadSfxKey(name);
    return;
  }
  if (!bank || !bank.length) {
    // ★ 还没加载好 → 排队（最多 8 条 ✓ 加载完补播 ✓）
    if (SFX_QUEUE.length < 8) { SFX_QUEUE.push({ n: name, v: volScale, t: performance.now() }); }
    return;
  }
  var now = performance.now();
  if (_lastSfx[name] && now - _lastSfx[name] < 40) { return; }
  _lastSfx[name] = now;
  var a = bank[Math.floor(Math.random() * bank.length)];
  var vol = Math.max(0.05, Math.min(1, SFX_VOL * (volScale || 1)));
  /* ★★ 第 80 轮：WebAudio 路径（内存播放 ✓ iOS 上不卡 ✓）★★ */
  if (a && a.buf) {
    var ac2 = audioCtx();
    if (!ac2) { return; }
    if (ac2.state === 'suspended') { try { ac2.resume(); } catch (e3) { } }
    if (_aVoices >= SFX_MAX_VOICES) { return; }        // 并发上限 ✓ 超了丢
    try {
      var src = ac2.createBufferSource();
      src.buffer = a.buf;
      src.playbackRate.value = 1 + (Math.random() * 2 - 1) * SFX_PITCH;   // 轻微变调 ✓
      var gn = ac2.createGain();
      gn.gain.value = vol;
      src.connect(gn); gn.connect(ac2.destination);
      _aVoices++;
      src.onended = function () {
        _aVoices = Math.max(0, _aVoices - 1);
        if (ch && SFX_CH[ch] && SFX_CH[ch].src === src) { delete SFX_CH[ch]; }
      };
      if (ch) {
        sfxStop(ch);                     // ★ 同频道正在播的 → 先掐掉 ✓
        SFX_CH[ch] = { src: src, gn: gn };
      }
      src.start(0);
    } catch (e4) { SFX_ERR.push(name + ':webaudio 异常'); }
    return;
  }
  if (!a || !a.src) { return; }
  try {
    /* ★ 第 77 轮：音频改回【原样】✓（用户已排除音频 ✗）
       不过"new Audio" 那一分支不要了 ✗（叠就叠吧 ✓）*/
    var use = a;
    try { use.currentTime = 0; } catch (e) { }
    use.volume = vol;
    var p = use.play();
    if (p && p.catch) { p.catch(function (err) { SFX_ERR.push(name + ':' + (err && err.name ? err.name : '失败')); }); }
  } catch (e) { SFX_ERR.push(name + ':异常'); }
}

/* ---------- mkMobUI ---------- */
/* ★ 第 70 轮：掉落物的名字牌（没有血条 ✗ 颜色按品阶 ✓）
   ★ 为什么单独写一个：core 里不允许碰 .style ✗（分层铁律 ✓）
     上一版我在 core 里直接改了 ui.bar.style → 闸门直接拦下 ✗ */
function mkLootUI(name, colorHex) {
  var wrap = document.createElement('div');
  wrap.style.cssText = 'position:absolute;transform:translate(-50%,-100%);pointer-events:none;' +
    'text-align:center;will-change:transform';
  var nm = document.createElement('div');
  nm.textContent = name;
  nm.style.cssText = 'font-size:11px;font-weight:700;text-shadow:0 1px 3px #000,0 0 6px #000;' +
    'white-space:nowrap;color:' + (colorHex || '#fff');
  wrap.appendChild(nm);
  var host = document.getElementById('mobui');
  if (host) { host.appendChild(wrap); }
  return { wrap: wrap, name: nm, bar: null };
}

function mkMobUI(name, hpMax, alpha) {   // ★ 第 112 轮：第三个参数 = 透明度（僵尸用 0.8 ✓）
  var wrap = document.createElement('div');
  wrap.style.cssText = 'position:absolute;transform:translate(-50%,-100%);pointer-events:none;'
    + 'text-align:center;will-change:transform'
    + (alpha ? (';opacity:' + alpha) : '');   // ★ 第 112 轮：僵尸那套改成半透明 ✓
  var nm = document.createElement('div');
  nm.textContent = name;
  nm.style.cssText = 'font-size:10px;font-weight:700;color:#fff;text-shadow:0 1px 3px #000,0 0 6px #000;margin-bottom:1px;white-space:nowrap';
  var barW = document.createElement('div');
  barW.style.cssText = 'display:inline-block;min-width:54px;height:13px;background:#000000cc;border:1px solid #ffffff55;border-radius:4px;overflow:hidden;margin:0 auto;position:relative;padding:0 5px';
  var bar = document.createElement('div');
  /* ★ 第 112 轮：填充条改成【绝对定位】✗
   上一轮把容器改成自适应宽度 + 内边距了 ✓
   但填充条是普通块级元素 → width% 只算【内容区】✗
   → 表现就是"条子变长了，里面的进度没跟着变"✗✓
   改成 absolute + 四边贴齐 → 填充条始终铺满整个容器 ✓ */
  bar.style.cssText = 'position:absolute;left:0;top:0;height:100%;width:100%;background:linear-gradient(180deg,#7ee08a,#3aa04a);border-radius:3px;transition:width .12s';
  barW.appendChild(bar);
  wrap.appendChild(nm); wrap.appendChild(barW);
  var host = document.getElementById('mobui');
  if (host) { host.appendChild(wrap); }
  return { wrap: wrap, name: nm, bar: bar };
}

/* ---------- dmg ---------- */

/* ★★★ 第 77 轮：飘字【复用池】（这次应该才是 iPad 掉帧的真凶）★★★
   用户线索（非常关键）：
     "光是走路没有问题，哪怕怪多也不会卡 ✓
      但一旦攻击或者挨打就开始掉帧 ✗"
   → 共同的差别不是"怪多"，而是【这两条路径都要弹飘字】✓
   → 而我上一轮只修掉了"每帧改 top 触发布局"✗
     没修掉"【每次都 new 一个 div】"✗✗

   iOS 上 new 一个 div 的代价：
     · 建一个合成层（它 position:fixed + text-shadow ✓ 必成层）✗
     · 光栅化文字（font-weight:800 + 阴影 ✗ 比普通文字贵得多）✗
     · 移除时再回收一次 ✗
   → 一秒钟几次还能忍 ✓ 但命中密集时是几十次 ✗ 每次都是一次光栅化 ✗
   → 这就是"攻击/挨打掉帧，走路不卡"✓✓

   修法：预建 16 个飘字 div 循环复用 ✓
     · 永不 create/remove ✓ 只改 textContent + transform + opacity ✓
     · 不用的改成 display:none ✓（比 remove 便宜得多 ✓ 层还在、下次直接用 ✓）
     · 满了就抢最老的 ✓（一屏也看不清更多 ✗）
*/
var NUM_CAP = 32, _numPool = [], _numNext = 0, _numLive = 0;   /* ★ 2026-10-23：16→32 ✗ 多段伤害不再互相抢位 ✓ */
function _numSlot() {
  if (_numPool.length < NUM_CAP) {
    var el = document.createElement('div');
    el.className = 'dmgNum';
    el.style.cssText = 'position:fixed;z-index:12;font-weight:800;pointer-events:none;' +
      'text-shadow:0 2px 5px #000;will-change:transform,opacity;display:none;' +
      'left:0;top:0;transform:translate3d(-9999px,0,0)';
    document.body.appendChild(el);
    var o = { el: el, busy: false, t0: 0, life: 1, y0: 0, x0: 0 };
    _numPool.push(o);
    return o;
  }
  // 先找空闲的
  for (var i = 0; i < _numPool.length; i++) {
    var k = (_numNext + i) % _numPool.length;
    if (!_numPool[k].busy) { _numNext = (k + 1) % _numPool.length; return _numPool[k]; }
  }
  // 都忙 → 抢最老的（那个本来就快消失了 ✓）
  var w = _numPool[_numNext]; _numNext = (_numNext + 1) % _numPool.length;
  return w;
}
/* ★★★ 2026-10-23（用户："战斗飘字和网页上展示的完全不一样"）★★★
   ★ 之前只在预览页做了样式 ✗ 真实游戏的 dmg()/dmgSkill() 还是纯色文字 ✓
   → 这次把 9 类飘字的【金属渐变 + 双层投影 + 重砸动效】真正接进来 ✓
   ★ 性能：样式定义一次注入 ✗ 每个飘字只切 class ✓ 不产生额外 DOM ✓ */
(function sysDmgStyles() {
  if (document.getElementById('dmgStyleCSS')) { return; }
  var st = document.createElement('style');
  st.id = 'dmgStyleCSS';
  st.textContent = `
  .dmgNum{font-weight:900;letter-spacing:.6px;font-style:italic;
    background-clip:text;-webkit-background-clip:text;color:transparent;
    -webkit-text-fill-color:transparent;transform-origin:50% 60%}
  /* ★★★ 2026-10-23（用户："太透明 / 颜色气雾减少"）★★★
     ★ 两个改动：
       ① 渐变不再往【深色】收尾 ✗ 尾巴换成同色系亮色 ✓
          （原来 #9a5b00 / #0b3f6b 那种深色压在暗背景上 = 发黑发透 ✓）
       ② 光晕半径和透明度都减半（.62~.95 → .38~.55）✗ 不再"糊成一团气"✓
     ★ 保留：向下 2~3px 的黑色实心投影（这是"可读性"，不能去掉 ✓）
  */
  /* ① 普通攻击 白→金（尾巴不要太深）*/
  .dmgNum.dAtk{background-image:linear-gradient(180deg,#fff 0%,#fff8dc 38%,#ffd75e 66%,#e8a020 100%);
    filter:drop-shadow(0 2px 0 rgba(0,0,0,.95)) drop-shadow(0 0 4px rgba(255,180,40,.34))}
  /* ② 普攻暴击 白→亮金→橙 */
  .dmgNum.dAtkC{background-image:linear-gradient(180deg,#fff 0%,#fff0a0 32%,#ffb020 68%,#e05a00 100%);
    filter:drop-shadow(0 3px 0 rgba(0,0,0,.95)) drop-shadow(0 0 8px rgba(255,120,0,.48))}
  /* ③ 技能伤害 —— ★ 2026-10-23（用户选 B）：白→中品红→#c8409e
     和技能暴击（深品红）同色系 ✗ 一眼看出是技能 ✓ 但明显更浅 ✓ */
  .dmgNum.dSk{background-image:linear-gradient(180deg,#fff 0%,#ffd8f2 32%,#ff7ad8 64%,#c8409e 100%);
    filter:drop-shadow(0 2px 0 rgba(0,0,0,.95)) drop-shadow(0 0 6px rgba(255,110,210,.44))}
  /* ④ 技能暴击 —— ★ 2026-10-23（用户选 D）：加深
     起手 #fff0fb 直接进粉 ✗ 尾巴 #8a0060 更深 ✓ 和技能伤害的差距拉开 ✓ */
  .dmgNum.dSkC{background-image:linear-gradient(180deg,#fff0fb 0%,#ff9ee0 28%,#e832a8 62%,#8a0060 100%);
    filter:drop-shadow(0 3px 0 rgba(0,0,0,.95)) drop-shadow(0 0 10px rgba(235,60,175,.5))}
  /* ⑤ 玩家受伤 白→红 */
  .dmgNum.dHurt{background-image:linear-gradient(180deg,#fff 0%,#ffc4c4 34%,#f03030 66%,#c01010 100%);
    filter:drop-shadow(0 2px 0 rgba(0,0,0,.95)) drop-shadow(0 0 6px rgba(255,40,40,.42))}
  /* ⑥ 治疗/吸血 白→薄荷绿 */
  .dmgNum.dHeal{background-image:linear-gradient(180deg,#fff 0%,#ccffe0 36%,#4ade80 66%,#22a050 100%);
    filter:drop-shadow(0 2px 0 rgba(0,0,0,.92)) drop-shadow(0 0 5px rgba(70,220,130,.38))}
  /* ⑦ 经验/突破 白→淡蓝 */
  .dmgNum.dExp{background-image:linear-gradient(180deg,#fff 0%,#e4f0ff 36%,#8cc0ff 66%,#4a7fd0 100%);
    filter:drop-shadow(0 2px 0 rgba(0,0,0,.92)) drop-shadow(0 0 5px rgba(120,170,255,.38))}
  /* ⑧ 武器特效 白→青绿（不斜体）*/
  .dmgNum.dFx{background-image:linear-gradient(180deg,#fff 0%,#dcfff5 36%,#4fe0bc 66%,#1a9c80 100%);
    filter:drop-shadow(0 2px 0 rgba(0,0,0,.9)) drop-shadow(0 0 4px rgba(70,220,180,.3));
    font-style:normal}
  /* ⑨ 击败/复活 纯白银灰 */
  .dmgNum.dSys{background-image:linear-gradient(180deg,#fff 0%,#f0f4fa 42%,#c0ccda 70%,#7a8898 100%);
    filter:drop-shadow(0 2px 0 rgba(0,0,0,.92)) drop-shadow(0 0 4px rgba(200,220,255,.28))}
  `;
  document.head.appendChild(st);
})();

/* 飘字"种类" → class（dmg 用 dAtk / dmgSkill 用 dSk / 受伤 dHurt …）*/
var DMG_CLS = {
  atk: 'dAtk', atkC: 'dAtkC', sk: 'dSk', skC: 'dSkC',
  hurt: 'dHurt', heal: 'dHeal', exp: 'dExp', fx: 'dFx', sys: 'dSys'
};
/* 每种类型的运动参数：[字号, 寿命, 是否重砸弹跳] */
var DMG_MOTION = {
  dAtk:  [24, 1150, false],
  dAtkC: [34, 1250, true],
  dSk:   [32, 1200, false],
  dSkC:  [42, 1350, true],
  dHurt: [28, 1150, false],
  dHeal: [26, 1150, false],
  dExp:  [22, 1100, false],
  dFx:   [22, 1100, false],
  dSys:  [26, 1200, false]
};

function _numFlyAt(txt, color, sx, sy, big, life, px, cls, crit) {
  var o = _numSlot();
  o.busy = true; o.life = life; o.x0 = sx; o.y0 = sy; o.drift = undefined; o.rise = undefined;
  o.el.textContent = txt;
  o.el.style.display = 'block';
  o.el.style.color = color;
  o.el.style.fontSize = (px || (big ? 22 : 16)) + 'px';
  /* ★ 2026-10-23：带上风格 class（金属渐变 / 红字 / 绿字 …）*/
  o.el.className = cls ? ('dmgNum ' + cls) : '';
  o.crit = !!crit;
  o.el.style.transform = 'translate3d(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px,0)';
  o.el.style.opacity = '1';
  o.t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (!o.anim) {
    o.anim = true;
    (function loop() {
      var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      var k = (now - o.t0) / o.life;
      if (!o.busy || k >= 1) {
        o.busy = false; o.el.style.display = 'none';
      } else {
        /* ★ 重砸动效：前 12% 从 2.15 倍砸到 1 倍（暴击再多弹一下）*/
        var _s = 1, _dy = 0;
        if (o.el.className && o.el.className.indexOf('dmgNum') >= 0) {
          if (k < .12) { _s = 2.15 - 9.6 * k; }
          else if (o.crit && k < .20) { _s = 1 + .22 * Math.sin((k - .12) / .08 * Math.PI); }
          _dy = (k < .10 ? 6 * (k / .10) : 6);
        }
        /* ★ 2026-10-23：每条的上升高度随机 40~96px ✗ 不会全部停在同一个高度 ✓ */
        if (o.rise === undefined) { o.rise = 40 + Math.random() * 56; }
        var _rise = (o.el.className && o.el.className.indexOf('dmgNum') >= 0) ? o.rise : 46;
        var _y = o.y0 + _dy - _rise *
                 (o.el.className && o.el.className.indexOf('dmgNum') >= 0
                    ? (1 - Math.pow(1 - k, 1.9)) : k);
        /* ★ 2026-10-23：上升时往自己那个方向再偏一点 ✗ 不会排成一条直线 ✓ */
        /* ★ 2026-10-23：漂移幅度 40 → 110px ✗ 上升时彻底散开，不会又聚成一束 ✓ */
        if (o.drift === undefined) { o.drift = (Math.random() * 170 - 85); }
        var _xx = o.x0 + o.drift * k;
        o.el.style.transform = 'translate3d(' + _xx.toFixed(1) + 'px,' +
          _y.toFixed(1) + 'px,0)' + (_s !== 1 ? ' scale(' + _s.toFixed(3) + ')' : '');
        o.el.style.opacity = String(1 - k);
        requestAnimationFrame(loop);
      }
    })();
  } else {
    // 已经在跑循环 → 它自己会发现 t0 变了（重播 ✓）
    // ★ 但那个循环只在自己那格空闲时退出 ✗ 所以这里补一次唤醒
    requestAnimationFrame(function () { if (o.busy && !o.wake) { o.wake = true; (function lp() {
      var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      var k = (now - o.t0) / o.life;
      if (!o.busy || k >= 1) { o.busy = false; o.el.style.display = 'none'; o.wake = false; }
      else {
        var _s2 = 1, _dy2 = 0;
        if (o.el.className && o.el.className.indexOf('dmgNum') >= 0) {
          if (k < .12) { _s2 = 2.15 - 9.6 * k; }
          else if (o.crit && k < .20) { _s2 = 1 + .22 * Math.sin((k - .12) / .08 * Math.PI); }
          _dy2 = (k < .10 ? 6 * (k / .10) : 6);
        }
        var _y2 = o.y0 + _dy2 - (o.el.className && o.el.className.indexOf('dmgNum') >= 0 ? 62 : 46) *
                  (o.el.className && o.el.className.indexOf('dmgNum') >= 0
                     ? (1 - Math.pow(1 - k, 1.9)) : k);
        o.el.style.transform = 'translate3d(' + o.x0.toFixed(1) + 'px,' +
          _y2.toFixed(1) + 'px,0)' + (_s2 !== 1 ? ' scale(' + _s2.toFixed(3) + ')' : '');
        o.el.style.opacity = String(1 - k);
        requestAnimationFrame(lp); }
    })(); } });
  }
}
/* 老接口保留 ✓ 内部全部走池 */
function _numProject(x, y, z, txt, color, big, life, px, cls, crit) {
  /* ★★★ 2026-10-23（用户："伤害飘字堆叠，太密集了散开一点"）★★★
     ★ 上一版的散布太窄（±0.9 米 / 0~90ms）✗ 短时间多段伤害照样叠成一坨 ✓
     ★ 现在改成【环形均分 + 时间错开】✗ 比纯随机更均匀 ✓
       ① 同一时刻来的飘字按【环形槽位】分配角度 ✗ 均匀铺开，不会有两三个撞在同一点
       ② 半径随"当前在飞的条数"放大（2 条时小、8 条时大）✗ 越多越铺开
       ③ 时间错开 0~260ms（原来 90ms 太短 ✗ 几乎同时出现 = 视觉上就是重叠）
       ④ 再加一点随机抖动 ✗ 环形不至于太规律 ✓
  */
  var _cx = x, _cy = y, _cz = z;
  /* 当前在飞的条数（池子本来就在维护 ✓ 直接数）*/
  var _alive = 0;
  for (var _i = 0; _i < _numPool.length; _i++) { if (_numPool[_i].busy) { _alive++; } }
  /* ★ 2026-10-23 实测：半径 0.8~2.6 米投到屏幕上只有几十 px ✗ 12 段时重叠 17 组 ✓
     → 半径放大到 1.6~5.2 米（屏幕上 90~300px）+ 时间错开 0~420ms ✓ */
  _NUM_SLOT = (_NUM_SLOT + 1) % 12;
  var _ang = (_NUM_SLOT / 12) * Math.PI * 2 + (Math.random() * 0.6 - 0.3);
  /* 半径：2 条以内 1.6 米，之后每多一条 +0.36 米，最多 5.2 米 */
  var _rad = 1.6 + Math.min(3.6, Math.max(0, _alive - 1) * 0.36);
  var _sx = Math.cos(_ang) * _rad;
  var _sz = Math.sin(_ang) * _rad * 0.75;     /* 前后也错开（透视下变成上下位移）*/
  var _sy = (Math.random() * 2.6 - 1.0);      /* 高度也拉开 ✗ 原来只有 0.95 米 */
  var _delay = Math.floor(Math.random() * 420);   /* ★ 0~420ms，错得更开 */
  var _go = function () {
    _numProjectNow(_cx + _sx, _cy + _sy, _cz + _sz, txt, color, big, life, px, cls, crit);
  };
  if (_delay > 6) { setTimeout(_go, _delay); } else { _go(); }
}
var _NUM_SLOT = 0;
function _numProjectNow(x, y, z, txt, color, big, life, px, cls, crit) {
  if (!REUSE_V3.v) { REUSE_V3.v = new THREE.Vector3(); }
  var v = REUSE_V3.v.set(x, y, z).project(cam);
  if (v.z < -1 || v.z > 2) { return; }
  /* ★ 2026-10-23：按类型选字号/寿命/动效（见 DMG_MOTION）*/
  var m = cls && DMG_MOTION[cls];
  if (m) { px = px || m[0]; life = m[1]; crit = !!crit || m[2]; }
  _numFlyAt(txt, color, (v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight,
            big, life, px, cls, crit);
}

function dmg(txt, x, y, z, big) {
  /* ★ 2026-10-23：普通攻击 → 白金渐变；暴击 → 更烫的金橙 + 重砸弹跳 */
  _numProject(x, y, z, txt, '#fff6e8', big, big ? 1250 : 1150, 0,
              big ? DMG_CLS.atkC : DMG_CLS.atk, !!big);
}

/* ★ round585：技能伤害数字（比普攻大 100%；技能暴击大 150%）
   普攻：16px 白 / 22px 金黄；技能：32px 淡红 / 40px 深红（已加粗 ✓）*/
function dmgSkill(txt, x, y, z, crit) {
  /* ★ 2026-10-23：技能 → 白青蓝渐变；技能暴击 → 白品红紫 + 重砸弹跳 */
  _numProject(x, y, z, txt, '#ffffff', true, crit ? 1350 : 1200, 0,
              crit ? DMG_CLS.skC : DMG_CLS.sk, !!crit);
}

/* ---------- healNum（治疗数字：绿色 + 号 ✓ 第 46 轮）----------
   ★ 用户反馈"医生的治疗效果看不出关联" —— 所以被治的僵尸头顶要弹一个绿字 ✓
     和 dmg 一套做法（core 只说"在哪个像素、写什么字"，不碰 style ✓） */
/* ★ 第 62 轮：指定颜色的飘字（dmg 的颜色写死了 ✗ 效果文字要区分颜色 ✓）*/
function fxNum(txt, color, x, y, z) {
  /* ★ 2026-10-23：按调用方给的颜色自动归类
     红/橙(受伤) → dHurt；绿(吸血) → dHeal；蓝紫(经验/突破) → dExp；其余 → dFx */
  var c = String(color || '').toLowerCase();
  var cls = DMG_CLS.fx;
  if (c === '#ff5a4a' || c === '#ff9a3c' || c === '#ff7a6a' || c === '#e01818') { cls = DMG_CLS.hurt; }
  else if (c === '#6ee06e' || c === '#7ee08a') { cls = DMG_CLS.heal; }
  else if (c === '#9fd0ff' || c === '#b8ff8a' || c === '#8ee0ff' || c === '#9fe8ff') { cls = DMG_CLS.exp; }
  else if (c === '#ffd83d') { cls = DMG_CLS.fx; }
  _numProject(x, y, z, txt, color, false, 1100, 0, cls);
}

function healNum(txt, x, y, z) {
  /* ★ 2026-10-23：治疗/吸血 → 白薄荷绿渐变 */
  _numProject(x, y, z, txt, '#7ee08a', false, 1150, 0, DMG_CLS.heal);
}
/* ---------- 方位标记（屏幕边缘的队友箭头）----------
   ★ 和名牌一样：core 只说"在哪个像素、朝哪个角度、写什么字"，不碰 style 属性名 ✓
     （小游戏里这套换成 canvas 自绘，只要改这里 ✓） */
function mkMark() {
  var wrap = document.createElement('div');
  wrap.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;display:none;' +
    'transform:translate(-50%,-50%);text-align:center;will-change:transform';
  var ar = document.createElement('div');
  ar.textContent = '➤';   // 默认朝右（0°），core 给的屏幕角度直接转它 ✓
  ar.style.cssText = 'font-size:17px;line-height:17px;color:#5aa8ff;' +   // ★ 第 85 轮：队友箭头改蓝 ✓
    'text-shadow:0 1px 4px #000,0 0 6px #000;will-change:transform';
  var tx = document.createElement('div');
  tx.style.cssText = 'font-size:9px;line-height:11px;color:#cfe8d4;margin-top:-1px;' +
    'text-shadow:0 1px 3px #000,0 0 5px #000;white-space:nowrap';
  wrap.appendChild(ar); wrap.appendChild(tx);
  var host = document.getElementById('markui');
  if (host) { host.appendChild(wrap); }
  return { wrap: wrap, ar: ar, tx: tx };
}
UI.fxGhost = function (x, z, yaw) {
  try {
    if (window.VFX && typeof scene !== 'undefined') {
      VFX.spawn('ghost', { x: x, z: z, yaw: yaw || 0, dur: 0.5,
                           seed: (Date.now() & 0xffff) }, scene);
    }
  } catch (e) { }
};
UI.fxIce = function (attach) {
  try { return (window.VFX && attach) ? VFX.spawn('iceblock', { attach: attach, dur: 5 }, null) : null; }
  catch (e) { return null; }
};
UI.fxIceStop = function (h) {
  try { if (h && window.VFX) { VFX.kill(h); } } catch (e) { }
};
/* ★ 自动战斗：自动用已装配的主动技能（服务器仍做全部校验）*/
var _autoSkAt = 0;
var _autoTgAt = {};   /* ★ 2026-10-23：开关型技能的自动开启时间 ✗ 防抖用 ✓ */
var SK_ACT = { n: '', m: 0, until: 0 };   /* 最近一次主动技能的持续时间 */
UI.skCastStart = function (key) {
  try {
    var d = SK.byKey[key];
    if (!d || d.tg2 || d.cast === 'self') { return; }
    var m = (+d.dur || 0) * (MY_SKDUR_MUL || 1);
    if (m < 1) { return; }
    SK_ACT.n = d.n || key;
    SK_ACT.m = m;
    SK_ACT.until = performance.now() + m * 1000;
  } catch (e) { }
};

/* ★ round600：精英/Boss 方向 HUD（服务端 mobmarks，1Hz 数据 + 本地 8Hz 投影）*/
var BOSS_SKILL_FX = {
  rift_dash: { m: 'beam', c: 0xff8a4a }, rift_maw: { m: 'wave', c: 0xff6a4a },
  guard_bash: { m: 'wave', c: 0xffd36a }, guard_quake: { m: 'burst', c: 0xffb347 },
  ember_breath: { m: 'beam', c: 0xff7a2a }, ember_burst: { m: 'burst', c: 0xff4a1a },
  toad_spit: { m: 'pool', c: 0x9be85a }, toad_tongue: { m: 'wave', c: 0xb6e85a },
  beetle_charge: { m: 'beam', c: 0xffc45a }, beetle_saw: { m: 'wave', c: 0xffb347 },
  wolf_pounce: { m: 'beam', c: 0x8fe8ff }, wolf_howl: { m: 'wave', c: 0x9fe8ff },
  butcher_slam: { m: 'burst', c: 0xff5a3a }, butcher_hook: { m: 'beam', c: 0xff9a5c },
  butcher_whirl: { m: 'wave', c: 0xff4a2a },
  mage_rune: { m: 'rune', c: 0xb58cff }, mage_barrage: { m: 'burst', c: 0x9b7cff },
  mage_summon: { m: 'summon', c: 0x8f6cff },
  mech_cannon: { m: 'burst', c: 0xffb066 }, mech_charge: { m: 'beam', c: 0xff8a4a },
  mech_overload: { m: 'wave', c: 0xff4a20 },
  dragon_breath: { m: 'beam', c: 0x8fe8ff }, dragon_wings: { m: 'wave', c: 0xbfe9ff },
  dragon_summon: { m: 'summon', c: 0x7fe8ff },
  serpent_eruption: { m: 'burst', c: 0xff6a1f }, serpent_coil: { m: 'wave', c: 0xff8a4a },
  serpent_pools: { m: 'pool', c: 0xff5a1f },
  eye_gaze: { m: 'beam', c: 0xb58cff }, eye_tentacles: { m: 'wave', c: 0x8f6cff },
  eye_collapse: { m: 'pool', c: 0x5bd8ff }
};
function bossCastStyle(key) {
  key = String(key || '');
  if (/breath|gaze|hook|cannon/.test(key)) { return 'aim'; }
  if (/summon/.test(key)) { return 'summon'; }
  if (/charge/.test(key)) { return 'charge'; }
  if (/whirl|wings|coil|tentacles/.test(key)) { return 'wave'; }
  if (/collapse|overload|quake|slam|eruption/.test(key)) { return 'slam'; }
  return 'cast';
}

function bossSkillFx(key) {
  return BOSS_SKILL_FX[String(key || '')] || { m: 'burst', c: 0xff5a3a };
}
var MOBMARKS = [], _mmBox = null, _mmEls = {}, _mmTimer = null;
function _mmTick() {
  try {
    if (!_mmBox) {
      _mmBox = document.createElement('div');
      _mmBox.id = 'mobMarks';
      _mmBox.style.cssText = 'position:fixed;inset:0;z-index:45;pointer-events:none;overflow:hidden';
      document.body.appendChild(_mmBox);
    }
    _mmBox.style.display = MOBMARKS.length ? 'block' : 'none';
    var now = MOBMARKS;
    var live = {};
    for (var i = 0; i < now.length; i++) {
      var m = now[i];
      var id = String(m.mid);
      live[id] = 1;
      var el = _mmEls[id];
      if (!el) {
        el = document.createElement('div');
        el.style.cssText = 'position:absolute;transform:translate(-50%,-50%);'
          + 'display:flex;align-items:center;gap:3px;font:800 11px "Microsoft YaHei";'
          + 'text-shadow:0 1px 3px #000;white-space:nowrap';
        el.innerHTML = '<span class="arr" style="font-size:15px">▲</span>'
          + '<span class="txt"></span>';
        _mmBox.appendChild(el);
        _mmEls[id] = el;
      }
      var boss = (+m.rank || 0) >= 2;
      var _rmm = NET.rmobs[id];
      if (_rmm && m.name && _rmm.name !== m.name) {
        _rmm.name = m.name;
        if (_rmm.ui) { UI.plate.name(_rmm.ui, m.name); }
      }
      var col = boss ? '#ff6a5c' : '#ffb35a';
      el.querySelector('.arr').style.color = col;
      el.querySelector('.txt').style.color = col;
      var txt = (boss ? 'BOSS ' : '') + (m.name || '') +
        ' ' + Math.round(Math.hypot(m.x - P.x, m.z - P.z)) + 'm';
      var tx = el.querySelector('.txt');
      if (tx.textContent !== txt) { tx.textContent = txt; }
      var v = new THREE.Vector3(m.x, 1.5, m.z).project(cam);
      var sx = 0, sy = 0;
      var _view = new THREE.Vector3(m.x, 1.5, m.z).applyMatrix4(cam.matrixWorldInverse);
      var _behind = _view.z > 0;
      var _onScreen = !_behind && v.z > -1 && v.z < 1 &&
        Math.abs(v.x) < 0.92 && Math.abs(v.y) < 0.88;
      var arr = el.querySelector('.arr');
      if (_onScreen) {
        /* 和组队箭头同一套规则：人已经在画面里 → 整个标记收掉，不挡视线 */
        el.style.display = 'none';
        continue;
      }
      var cx = innerWidth / 2, cy = innerHeight / 2;
      var _nx = v.x, _ny = -v.y;
      if (_behind) { _nx = -_nx; _ny = -_ny; }
      var a = Math.atan2(_ny, _nx);
      var padX = 30, padTop = 78, padBot = 44;
      var hw = innerWidth / 2 - padX;
      var hh = (_ny < 0) ? Math.max(10, innerHeight / 2 - padTop)
                         : Math.max(10, innerHeight / 2 - padBot);
      var t = Math.min(hw / Math.max(0.001, Math.abs(Math.cos(a))),
                       hh / Math.max(0.001, Math.abs(Math.sin(a))));
      sx = cx + Math.cos(a) * t;
      sy = cy + Math.sin(a) * t;
      arr.style.display = 'inline-block';
      arr.style.transform = 'rotate(' + (a + Math.PI / 2) + 'rad)';
      el.style.left = sx.toFixed(1) + 'px';
      el.style.top = sy.toFixed(1) + 'px';
      el.style.display = 'flex';
    }
    for (var k in _mmEls) {
      if (!live[k]) { _mmEls[k].style.display = 'none'; }
    }
  } catch (e) { }
}
UI.mobMarks = function (list) {
  MOBMARKS = Array.isArray(list) ? list : [];
  if (_mmTimer === null) { _mmTimer = setInterval(_mmTick, 120); }
  _mmTick();
};
UI.autoSkill = function (tgt, now) {
  try {
    if (typeof SK === 'undefined' || !SK.load || !SK.byKey) { return; }
    if (typeof MY_FROZEN !== 'undefined' && MY_FROZEN) { return; }
    if (typeof MY_DOWN !== 'undefined' && MY_DOWN > 0) { return; }
    if (now - _autoSkAt < 350) { return; }
    var list = SK.load.A || [];
    for (var i = 0; i < list.length; i++) {
      var k = list[i];
      if (!k) { continue; }
      var d = SK.byKey[k];
      /* ★★★ 2026-10-23（用户："病毒扩散要改成自动战斗时自动开启"）★★★
         ★ 原来 tg2（开关型技能）一律跳过 ✗ 自动战斗里永远不开 ✓
         ★ 现在：开关型技能【只在没开的时候开一次】✗ 不会反复开关 ✓
           · 已开启（MY_PLAGUE === 1）→ 跳过 ✓
           · 没开 → 发一次 skillcast ✓
           · 死亡复活后服务端会把它关掉 → 自动战斗会重新开 ✓
         ★ 其它开关型技能（如果有）同样适用 ✗ 逻辑是通用的 ✓ */
      if (!d) { continue; }
      if (d.tg2) {
        /* 开关型：只处理"开启"这一个方向 */
        var _on = 0;
        if (k === 'plague') { _on = (typeof MY_PLAGUE !== 'undefined') ? MY_PLAGUE : 0; }
        if (_on) { continue; }                       /* 已经开着 → 跳过 ✓ */
        if ((MY_QI || 0) < (d.qi || 0)) { continue; } /* 灵气不够 → 跳过 ✓ */
        if (typeof MY_JOB !== 'undefined' && MY_JOB) { continue; }
        /* ★ 2026-10-23：给 1 秒防抖 ✗ 服务端有 0.3 秒冷却，
           发太勤会收到"技能冷却中"的提示刷屏 ✓ */
        if (now - (_autoTgAt[k] || 0) < 1000) { continue; }
        _autoTgAt[k] = now;
        _autoSkAt = now;
        wsSend('skillcast', { key: k });
        return;
      }
      if ((SKCD[k] || 0) > 0) { continue; }
      if ((MY_QI || 0) < (d.qi || 0)) { continue; }
      var dist = tgt ? Math.hypot(tgt.x - P.x, tgt.z - P.z) : 0;
      if (d.rg > 0 && (!tgt || dist > d.rg)) { continue; }
      _autoSkAt = now;
      if (d.cast === 'self') {
        if (typeof MY_JOB === 'undefined' || !MY_JOB) { wsSend('skillcast', { key: k }); }
      } else if (tgt) {
        if (typeof MY_JOB === 'undefined' || !MY_JOB) { wsSend('skillcast', { key: k, x: tgt.x, z: tgt.z }); }
      }
      return;
    }
  } catch (e) { }
};
UI.mark = {
  make: function () { return mkMark(); },
  show: function (m, on) { if (m && m.wrap) { m.wrap.style.display = on ? 'block' : 'none'; } },
  /* sx/sy = 屏幕像素；deg = 屏幕角度（0 = 朝右，顺时针为正）；txt = 距离等文字 ✓ */
  at: function (m, sx, sy, deg, txt, col) {
    if (!m || !m.wrap) { return; }
    m.wrap.style.transform = 'translate(-50%,-50%) translate(' + sx.toFixed(0) + 'px,' + sy.toFixed(0) + 'px)';
    if (m.ar) {
      m.ar.style.transform = 'rotate(' + deg.toFixed(1) + 'deg)';
      if (col) { m.ar.style.color = col; }
    }
    if (m.tx && txt !== undefined && txt !== null) { m.tx.textContent = txt; }
  },
  /* ★ 第 86 轮：改头顶名字（队伍成员前面要加蓝色五角星 ✓）
     ★ 为什么放平台层：core 里不许碰 .style ✗（分层铁律 ✓）*/
  name: function (m, text, color) {
    if (!m || !m.name) { return; }
    if (m.name.textContent !== text) { m.name.textContent = text; }
    if (color && m.name.style.color !== color) { m.name.style.color = color; }
  },
  remove: function (m) {
    if (m && m.wrap && m.wrap.parentNode) { m.wrap.parentNode.removeChild(m.wrap); }
  }
};

/* ---------- evKey / evTouches（事件字段的容错小工具）---------- */
/* ★ 事件对象上的字段不能想当然（第 27 轮实测踩的坑）：
     · e.key 有可能是 undefined —— 中文输入法 / 手机软键盘的 keydown 就会这样。
       以前直接写 e.key.toLowerCase() → 未捕获 TypeError
       → 全局错误处理把它显示成"出错：Cannot read properties of undefined (reading 'toLowerCase')"，
       看着像整个游戏都坏了 ✗
     · e.changedTouches 也可能整个不存在 → 既不能直接 [0]，也不能直接 .length ✗
       （这两种写法各炸过一次，都是浏览器测试抓出来的）
   统一走这几个小工具：取不到就当这次事件没发生（不影响操作 ✓）*/
function evKey(e) {
  var k = e && e.key;
  return (typeof k === 'string' && k) ? k.toLowerCase() : '';
}
function evTouches(e) {
  var t = e && e.changedTouches;
  return (t && typeof t.length === 'number') ? t : [];
}
function evTouch(e, i) {
  i = i || 0;
  return evTouches(e)[i] || null;
}

/* ---------- bindInput ---------- */
function bindInput() {
  var cv = document.getElementById('cv'), atk = document.getElementById('atk');
  // ★ 首次触摸解锁音频（浏览器要求 ✓）
  function firstTouch() {
    unlockAudio();
    document.removeEventListener('touchstart', firstTouch);
    document.removeEventListener('mousedown', firstTouch);
  }
  document.addEventListener('touchstart', firstTouch, { passive: true });
  document.addEventListener('mousedown', firstTouch);
  function atkDown(e) { if (e) { e.preventDefault(); } if (UI_EDIT) { return; }
  /* ★ 2026-10-22（用户："按钮要一直保持交互状态，不然万一出现无法结算的情况"）
     打工期间按钮【永远是结算打工】✗ 不看距离/其它交互 ✓ */
  if (typeof MY_JOB !== 'undefined' && MY_JOB) {
    try { jobStop(); } catch (eJ0) { }
    return;
  }
  /* ★ 2026-10-22：坐着 / 躺着时，按钮就是【起身 / 起床】—— 不能先弹交互菜单 */
  if (typeof MY_SLEEP !== 'undefined' && MY_SLEEP) { tryWake(); return; }
  if (typeof MY_SEAT !== 'undefined' && MY_SEAT) {
    if (typeof orderShopNear === 'function' && orderShopNear()) { orderOpen(); return; }
    tryStand(); return;
  }
  /* 附近有多个可交互对象 → 先弹窗选，不直接执行 */
  if (typeof NEAR_CANDS !== 'undefined' && NEAR_CANDS.length > 1) { nearPickOpen(); return; }
  if (typeof SLEEP_NEAR !== 'undefined' && SLEEP_NEAR) { trySleep(); return; }
  if (typeof FRIDGE_NEAR !== 'undefined' && FRIDGE_NEAR) { fridgeOpen(FRIDGE_NEAR.id); return; }
  if (typeof SHOP_NEAR !== 'undefined' && SHOP_NEAR) { shopOpen(); return; }
  if (typeof SEAT_NEAR !== 'undefined' && SEAT_NEAR) { trySit(); return; }
  if (typeof TP_NEAR !== 'undefined' && TP_NEAR) { tpOpen(); return; }
  if (typeof HOUSE_NEAR !== 'undefined' && HOUSE_NEAR) { houseOpen(); return; }
  if (typeof WH_OPEN !== 'undefined' && WH_OPEN) { return; }
  if (typeof WH_NEAR !== 'undefined' && WH_NEAR) { try { whOpen(); } catch (eW) { } return; }
    if ((typeof MY_FROZEN !== 'undefined' && MY_FROZEN) ||
        (typeof MY_DOWN !== 'undefined' && MY_DOWN > 0)) { return; }
    atkHeld = true; }
  function atkUp(e) { if (e) { e.preventDefault(); } atkHeld = false; }
  if (atk) {
    atk.addEventListener('touchstart', atkDown, { passive: false });
    atk.addEventListener('touchend', atkUp, { passive: false });
    atk.addEventListener('touchcancel', atkUp, { passive: false });
    atk.addEventListener('mousedown', atkDown);
    /* ★ 宣传片录制：?rec=1 时把 J 键映射为攻击（挥剑/挖矿），方便脚本按键录制 */
    try {
      if (new window.URLSearchParams(location.search).get('rec') === '1') {
        addEventListener('keydown', function (e) { if (e.code === 'KeyJ') { atkDown(); } });
        addEventListener('keyup', function (e) { if (e.code === 'KeyJ') { atkUp(); } });
      }
    } catch (eR2) { }
    addEventListener('mouseup', atkUp);
  }
  cv.addEventListener('touchstart', function (e) {
    e.preventDefault();
    var t = evTouch(e);
    if (!t) { return; }
    if (t.clientX < innerWidth * 0.5 && joyId === null) { joyId = t.identifier; jox = t.clientX; joy0 = t.clientY; }
  }, { passive: false });
  cv.addEventListener('touchmove', function (e) {
    e.preventDefault();
    var ts = evTouches(e);
    for (var i = 0; i < ts.length; i++) {
      var t = ts[i];
      if (t.identifier !== joyId) { continue; }
      var dx = t.clientX - jox, dy = t.clientY - joy0, len = Math.hypot(dx, dy), R = 42;
      if (len > R) { dx = dx / len * R; dy = dy / len * R; }
      var l2 = Math.hypot(dx, dy);
      jx = (l2 < 10) ? 0 : dx / R;
      jy = (l2 < 10) ? 0 : dy / R;
      STICK_ACTIVE = true;            // ★ round372：手指真的在摇杆上 ✓
    }
  }, { passive: false });
  cv.addEventListener('touchend', function (e) {
    e.preventDefault();
    var ts = evTouches(e);
    for (var i = 0; i < ts.length; i++) {
      if (ts[i].identifier === joyId) { joyId = null; jx = 0; jy = 0; }
      if (joyId === null) { STICK_ACTIVE = false; }
    }
  }, { passive: false });
  cv.addEventListener('touchcancel', function (e) { e.preventDefault(); joyId = null; jx = 0; jy = 0; STICK_ACTIVE = false; }, { passive: false });
  addEventListener('keydown', function (e) {
    var k = evKey(e);
    if (k) { keys[k] = true; }
    /* ★ 第 306 轮：空格 = 跳（电脑端 ✗ 手机用 #jmp 按钮 ✓）
       ★ 按住不放只跳一次 ✗ 要再跳得抬手重按 ✓
         （和"只能跳一格"的设定一致 ✗ 不能靠按住刷位移 ✓）*/
    if (e.code === 'Space' && !e.repeat) {
      if (typeof jumpHeld !== 'undefined') { jumpHeld = 1; }
      e.preventDefault();
    }
  });
  addEventListener('keyup', function (e) { var k = evKey(e); if (k) { keys[k] = false; } });
}

/* ---------- loadProfile ---------- */
function loadProfile() {
  var token = '';
  try { token = localStorage.getItem('token') || ''; } catch (e) { }
  var el = document.getElementById('uStat');
  if (!token) { if (el) { el.textContent = '未登录'; } return; }
  if (el) { el.textContent = '连接中…'; }
}

/* ---------- showRole ---------- */
function showRole(r) {
  if (!r) { return; }
  NET.myName = r.name || '';
  var e1 = document.getElementById('uName'); if (e1) { e1.textContent = r.name || '—'; }
  var e2 = document.getElementById('uRealm'); if (e2) { e2.textContent = '炼气 ' + (r.level || 1) + ' 层'; }
  var e3 = document.getElementById('uStat');
  /* ★★ 第 125 轮（用户：左上角的经验和天赋点都不用显示了）★★
     经验：左上角本来就有一条经验进度条 ✓ 重复了 ✗
     天赋点：菜单里有专门的天赋页 ✓（而且带高亮提醒 ✓）也重复了 ✗
     → 这行直接清空 ✗（不是隐藏 ✗ 是不写了 ✓ 省得占地方 ✓）*/
  if (e3) { e3.textContent = ''; }
  updExp(r);   // ★ 经验条（第 38 轮，用户要求）跟着角色数据一起刷 ✓
}

/* ---------- 经验条（第 38 轮）----------
   ★ "升级还需要多少经验"由【服务器】算（mobs.level_up_need）——
     welcome 和 me 两条都会带 need ✓（客户端不要去猜服务器怎么算的 ✗）
   ★ 万一没带（老服务端/单机）就按同一套公式本地兜一个：
     need = (6 + 1.3L) × (10 + 4L + 0.12L²)   —— 方案 §9.1 ✓ */
/* ★ 第 233 轮（用户："耐久掉了一半"）★
   格子上的耐久：如果这件就是身上正穿着的那件 ✗
   就显示【身上那份】（服务器实时推的 ✓）而不是 item_json 里的旧值 ✓
   ★ 为什么：穿在身上期间服务端把耐久记在 p.wDur / p.aDur ✓
     item_json 里那份只在穿和脱的那一刻同步 ✓ 所以是旧的 ✓ */
function itDur(it, id) {
  var w = (typeof MY_WEAPON !== 'undefined') ? MY_WEAPON : null;
  /* ★ 闸门提醒过我：MY_ARMOR 这个全局根本不存在 ✗ 只有 MY_WEAPON ✓
     防具走 BAG.armor（背包加载时一起存下的 ✓）*/
  var a = (typeof BAG !== 'undefined' && BAG.armor) ? BAG.armor : null;
  if (w && String(BAG.weaponItemId || '') === String(id || '') && typeof w.dur === 'number') { return w.dur; }
  if (a && String(BAG.armorItemId || '') === String(id || '') && typeof a.dur === 'number') { return a.dur; }
  return (typeof it.dur === 'number') ? it.dur : (it.durMax || 0);
}

function expNeed(lv) {
  var L = Math.max(1, Math.round(lv || 1));
  return Math.round((6 + 1.3 * L) * (10 + 4 * L + 0.12 * L * L));
}
function updExp(r) {
  r = r || (typeof WSC !== 'undefined' && WSC.role) || {};
  /* ★ 第 230 轮：这里原来写的是 r.need || expNeed(...) ✗
     优先信【登录时缓存的那份 need】→ 升级后分母不刷新 → 看着够了却没升 ✓
     改成【一律现算】✗ expNeed 和第 223 轮修对的服务端公式完全一致 ✓
     （服务器真给了 need 也要按当前等级判断 ✗ 缓存分不清是哪个等级的 ✓）*/
  var need = Math.round(expNeed(r.level || 1));
  var cur = Math.max(0, Math.round(r.exp || 0));
  var pct = (need > 0) ? Math.max(0, Math.min(100, cur / need * 100)) : 0;
  var b = document.getElementById('exp');
  if (b) { b.style.width = pct.toFixed(1) + '%'; }
  var t = document.getElementById('expTxt');
  if (t) { t.textContent = '经验 ' + cur + ' / ' + need; }
}

/* ★ round583：灵气条（蓝色 + 条内数字）*/
function updQi() {
  var mx = Math.max(1, Math.round(MY_QIMAX || 100));
  var q = Math.max(0, Math.min(mx, Math.round(MY_QI || 0)));
  var e = document.getElementById('qi');
  if (e) { e.style.width = (q / mx * 100) + '%'; }
  var t = document.getElementById('qiTxt');
  if (t) { t.textContent = q + ' / ' + mx; }
}

/* ---------- updHP ---------- */
function updHP() {
  var e = document.getElementById('hp');
  if (e) { e.style.width = Math.max(0, HP / HPMAX * 100) + '%'; }
  // ★ 血条上的数字（第 36 轮，用户要求）—— 和血条一起刷，不用管调用点 ✓
  var t = document.getElementById('hpTxt');
  if (t) { t.textContent = Math.max(0, Math.round(HP)) + ' / ' + Math.round(HPMAX); }
  /* round295: gold on the top-left HUD. The user meant THIS panel (hp + exp bars),
     not the stSelf/stTotal divs - those belong to the menu's stat page and stay
     empty until that page is opened, which is why the first attempt looked
     "missing". Refreshed together with the hp bar, so it updates every frame. */
  var gt = document.getElementById('goldTxt');  if (gt) {
    var g = (WSC.role && WSC.role.gold) || 0;
    gt.textContent = '金币 ' + fmtGold(g);
  }
}

/* ---------- saveSet ---------- */
function saveSet() { try { SETCFG.v = SETCFG_VER; localStorage.setItem('xx3d_set', JSON.stringify(SETCFG)); } catch (e) { } }

/* ---------- applySet ---------- */
function applyShadow() {
  var sh = setShadow();
  var on = (sh !== 'off');
  if (!rd) { return; }
  rd.shadowMap.enabled = on;
  if (sun && sun.shadow) {
    var sz = (sh === 'mid') ? 1024 : 2048;
    if (sun.shadow.mapSize.x !== sz) {
      sun.shadow.mapSize.set(sz, sz);
      /* ★ 改了 mapSize 必须把旧的贴图释放掉 ✗
         不然 three.js 不会重建 → 改了没效果 ✗（这个坑很容易踩 ✗）*/
      if (sun.shadow.map) {
        try { sun.shadow.map.dispose(); } catch (e1) { }
        sun.shadow.map = null;
      }
    }
  }
  rd.shadowMap.needsUpdate = true;
  /* ★ round426：阴影范围跟着可见范围收（纯画质提升 ✓ 见 core 里 applyShadowExtent）*/
  if (typeof applyShadowExtent === 'function') { applyShadowExtent(); }
}

/* ★★★ round426：性能诊断面板（用户："从性能角度优化"）★★★
   为什么要这个：之前所有优化都是靠"读代码猜" ✗ 这次要量 ✗
   显示什么（一行，底部）：
     帧时间 / 绘制调用 / 三角形 / 材质数 / 几何体 / 怪数 / 显存贴图
   ★ 为什么默认关：它自己也要遍历场景数材质（约 0.1ms / 次），
     不需要的时候不能白花 ✓ 设置 → 显示 → 「性能面板」打开 ✓
   ★ 3D 里能直接拿到的：rd.info（calls/triangles/geometries/textures）
     材质数要遍历场景 → 每 2 秒数一次，不每帧数 ✓ */
var PERF = { on: false, el: null, t: 0, mats: 0, matsAt: 0, worst: 0 };

function perfBarInit() {
  if (PERF.el) { return PERF.el; }
  var d = document.createElement('div');
  d.id = 'perfBar';
  d.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:60;display:none;'
    + 'font:11px/1.45 ui-monospace,Consolas,monospace;color:#d9e6d4;'
    + 'background:rgba(10,14,10,.62);border:1px solid #ffffff22;border-radius:7px;'
    + 'padding:5px 8px;pointer-events:none;white-space:pre;text-shadow:0 1px 2px #000';
  document.body.appendChild(d);
  PERF.el = d;
  return d;
}

function perfBarShow(on) {
  PERF.on = !!on;
  var d = perfBarInit();
  d.style.display = PERF.on ? 'block' : 'none';
  if (PERF.on) { PERF.worst = 0; }
}

/* core 每 30 帧调一次（只在开着时才会被调 ✓）*/
function perfBar(st) {
  if (!PERF.on) { return; }
  var d = perfBarInit();
  var now = (typeof performance !== 'undefined') ? performance.now() : 0;
  if (now - PERF.matsAt > 2000) {
    PERF.matsAt = now;
    var seen = {}, n = 0;
    try {
      scene.traverse(function (o) {
        var m = o.material;
        if (!m) { return; }
        var arr = Array.isArray(m) ? m : [m];
        for (var i = 0; i < arr.length; i++) {
          if (arr[i] && !seen[arr[i].uuid]) { seen[arr[i].uuid] = 1; n++; }
        }
      });
    } catch (e) { }
    PERF.mats = n;
  }
  var ms = (st && st.ms) ? st.ms : 0;
  if (ms > PERF.worst) { PERF.worst = ms; }
  var info = (rd && rd.info) ? rd.info : null;
  var r = info ? info.render : {};
  var mem = info ? info.memory : {};
  d.textContent =
    '帧 ' + ms.toFixed(1) + 'ms / 最差 ' + PERF.worst.toFixed(1) + 'ms'
    + '  (' + Math.round(1000 / Math.max(1, ms)) + 'fps)\n'
    + '绘制 ' + (r.calls || 0) + ' · 三角 ' + Math.round((r.triangles || 0) / 1000) + 'k'
    + ' · 材质 ' + PERF.mats + ' · 几何 ' + (mem.geometries || 0)
    + ' · 贴图 ' + (mem.textures || 0)
    + ' · 程序 ' + ((info && info.programs) ? info.programs.length : 0) + '\n'
    + '怪 ' + Object.keys((typeof NET !== 'undefined' && NET.rmobs) ? NET.rmobs : {}).length
    + ' · 玩家 ' + Object.keys((typeof NET !== 'undefined' && NET.others) ? NET.others : {}).length
    + ' · 掉落 ' + Object.keys((typeof NET !== 'undefined' && NET.rloot) ? NET.rloot : {}).length
    + ' · 像素比 ' + (rd ? rd.getPixelRatio() : 1).toFixed(2)
    + ' · 阴影 ' + ((typeof setShadow === 'function') ? setShadow() : '?');
}

var DETAIL_RANGE = { low: 16, mid: 28, high: 40 };

function applySet() {
  applyShadow();          // ★ 第 79 轮：阴影质量 ✓
  try {
    var dpr = setDpr();
    G.PROP_R = (DETAIL_RANGE && DETAIL_RANGE[setDetail()]) ? DETAIL_RANGE[setDetail()] : 28;
    if (rd) { rd.setPixelRatio(Math.min(dpr, devicePixelRatio || 1)); }
    if (cam) { cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); }
    /* ★ 第 32 轮：帧数和诊断合成一块了（#topright）→ 这个开关直接管整块 ✓
       （原来那块"物件/Mesh/地顶点"的 #stat 已经删掉了 ✓）*/
    var show = (SETCFG && SETCFG.showFps !== false);
    var tr = document.getElementById('topright');
    if (tr) { tr.style.display = show ? 'block' : 'none'; }
    /* ★ round426：性能面板（设置里单独开关 ✓）*/
    if (typeof perfBarShow === 'function') { perfBarShow(!!SETCFG.perf); }
    /* ★ 攻击键大小（第 31 轮）：写进 CSS 变量 --atk，#atk 的宽高/字号都跟着它走 ✓
       （用变量而不是直接改 style，是为了让"按下缩放"那类 CSS 动画还能正常工作 ✓）*/
    try {
      document.documentElement.style.setProperty('--atk', setAtkSize() + 'px');
      if (typeof uiApplyAtkScale === 'function') { uiApplyAtkScale(); }
    } catch (e2) { }
    /* ★ round422：画面放大（只动 3D 画面 ✗ UI 一个字都不动 ✓）*/
    if (typeof applyWorldZoom === 'function') { applyWorldZoom(); }
    refreshProps();
  } catch (e) { }
}

/* ---------- mkOpts ---------- */

/* ★★★ 第 83 轮：组队（独立页）★★★
   用户要求：大厅独立成页 · 看在线玩家 + 简单信息 + 点邀请 + 搜名字
             队长可以邀请 · 玩家可以申请加入
             ★ 不仅有弹窗，界面里也要有同意/拒绝的地方（所以"待处理"区 ✓）
   数据来源：
     队伍 / 待处理 → 走 WS（服务器每秒补推 ✓ 刷新不丢 ✓）
     大厅          → 走 HTTP /api/lobby（4 秒拉一次就够 ✓ 不用 30Hz ✗）
   分层：全部在平台层 ✓ core 里不碰 DOM ✗
*/
var PARTY = { roster: null, pid: null, leader: null, me: null, inv: [], app: [] };
var LOBBY = { players: [], parties: [], online: 0, err: '' };
var _ptSearch = '';

/* ★ 第 84 轮：屏幕正中的横幅（用户报"邀请提示字太大、不居中、看不完"✗）
   原来往 3D 世界里飘一行大字 ✗ 那是世界坐标投影 → 当然不居中 ✓
   现在改成顶部居中的 DOM 横幅：正常字号 ✓ 4 秒自动消失 ✓ */
var _ptBanT = null;
function ptBanner(text, color) {
  var el = document.getElementById('ptBanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ptBanner';
    el.style.cssText = 'position:fixed;left:50%;top:24%;transform:translateX(-50%);' +
      'z-index:30;background:#000000cc;color:#fff;padding:8px 16px;border-radius:10px;' +
      'font-size:14px;font-weight:600;text-align:center;max-width:80vw;pointer-events:none;' +
      'box-shadow:0 2px 10px #0008;display:none';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.color = color || '#fff';
  el.style.display = 'block';
  if (_ptBanT) { clearTimeout(_ptBanT); }
  _ptBanT = setTimeout(function () { el.style.display = 'none'; }, 4000);
}

/* ★★ 第 113 轮（用户要求）：玩家属性页 ★★
   把散在各处的数值集中到一页：人物 / 武器 / 防具 / 合计 ✓
   ★ 数据来源都是现成的（WSC.role ✓ MY_WEAPON ✓ BAG.armor ✓）不新加协议 ✓ */
function stRow(k, v, note) {
  return '<div class="ptLine"><span style="min-width:88px;opacity:.85">' + k +
    '</span><b style="color:#8ee0ff">' + v + '</b>' +
    (note ? '<span class="bagTip">' + note + '</span>' : '') + '</div>';
}
/* ★★ 第 116 轮：天赋页（方案 §7.2 + §8）★★
   ★ 12 个属性表的【中文名和顺序】从服务器发来的 raw/pts 里推不出来 ✗
     所以这里带一份"显示用"的对照表 ✓
     （数值规则仍然只有服务器一份 ✓ 这里只管显示 ✓ 不参与计算 ✓）*/
var HP_FULL_PENDING = false;   /* 第 192 轮：等有效上限到了就把血填满 ✓ */
var MY_MQ = 0;      // ★ 第 152 轮：我自己的魔气（登录从 role 读 ✓ 变了服务器推 ✓）
var MY_TT = '';     // ★ round424：我的头顶称号文本（'' = 不显示）
/* ★ round488：皮肤页状态 */
var SKIN = { sel: '', items: [], start: 20000, step: 5000, gold: 0,
             r: null, scene: null, cam: null, hero: null, rot: 0, ready: false };
var MY_TM = 0;      // ★ round424：奖牌名次 1/2/3（0 = 没牌）
/* ★ 第 160 轮：构建号（服务器在 ws-config.js 里给的）
   ★ 为什么在 platform 里读 window、不在 core 里读：
     core 不许碰浏览器对象（分层铁律，check_core_dom 盯着）
     这里读好、变成普通字符串，core 直接用就行 */
var BUILD_TAG = (typeof window !== 'undefined' && window.BUILD)
  ? String(window.BUILD) : '?';
var TAL = { free: 0, pts: {}, raw: {}, eff: {}, live: [], perLevel: 3, ready: false };
var TAL_META = [
  ['hp', '血量', '点'], ['atk', '攻击力', '点'],
  ['dr', '减伤', '%'], ['speed', '移速', '%'],
  ['qi', '灵气', '点'],
  ['crit', '暴击', '%'], ['anticrit', '免爆', '%'],
  ['dodge', '闪避', '%'], ['hit', '命中', '%'],
  ['critdmg', '爆伤', '%'],
  /* ★ round473：抗爆 —— 降低受到的暴击伤害（爆伤的克制属性 ✓）*/
  ['anticritdmg', '抗爆', '%'], ['pen', '穿透', '%']
];
function talRow(k, nm, unit) {
  var pts = TAL.pts[k] || 0;
  var raw = TAL.raw[k] || 0;
  var eff = (typeof TAL.eff[k] === 'number') ? TAL.eff[k] : raw;
  var live = TAL.live.indexOf(k) >= 0;
  /* ★ 对抗类显示【原始值 → 有效值】✗
     否则玩家堆到 40% 却看到 30%，会以为点数白花了 ✗（方案 §8.4）*/
  var show = (unit === '%')
    ? ((Math.abs(raw - eff) > 0.01)
        ? (raw.toFixed(1) + '% → <b style="color:#ffd83d">' + eff.toFixed(1) + '%</b>')
        : (eff.toFixed(1) + '%'))
    : (Math.round(eff) + ' 点');
  /* ★★★ 2026-10-23（用户："天赋加点页面手机上显示不够宽，+ 号点不到"）★★★
     ★ 病根：一行 5 个元素 + 写死的 min-width（74+96+52=222px + 两个按钮）
       手机窄屏时总宽超了 → + 号被挤出可视区 / 点不到 ✓
     ★ 修法：
       ① 名称用 flex:1 自动伸缩（不再 min-width:74 撑宽）
       ② 数值不再 min-width:96，改成能换行、省略不撑破
       ③ 两个按钮 flex:0 0 auto + 加宽加大点击区（44px 是移动端最小舒适尺寸）
       ④ "N 点投" 缩成小字，放名称下面一行 → 一行只留 3 个横向块 ✓
       ⑤ 整体允许换行（flex-wrap）✗ 实在窄就折行，绝不会挤出去 ✓ */
  return '<div class="ptLine talRow2">' +
    '<span class="talName">' + nm + (live ? '' :
      ' <span class="bagTip" style="color:#9aa4b2">待PvP</span>') +
      '<small class="talPts">已投 ' + pts + '</small></span>' +
    '<span class="talVal">' + show + '</span>' +
    '<span class="talBtns">' +
      '<button class="bagB talB" data-k="' + k + '" data-n="-1"' +
        (pts > 0 ? '' : ' disabled') + '>−</button>' +
      '<button class="bagB talB" data-k="' + k + '" data-n="1"' +
        (TAL.free > 0 ? '' : ' disabled') + '>+</button>' +
    '</span>' +
    '</div>';
}
function talRender() {
  var el = document.getElementById('talList');
  if (!el) { return; }
  var free = document.getElementById('talFree');
  if (free) {
    free.textContent = TAL.free;
    /* ★ 有未花点数时金色提醒 ✓（方案 §8.0 第二个入口）*/
    free.style.color = TAL.free > 0 ? '#ffd83d' : '#9aa4b2';
  }
  var out = [];
  for (var i = 0; i < TAL_META.length; i++) {
    out.push(talRow(TAL_META[i][0], TAL_META[i][1], TAL_META[i][2]));
  }
  el.innerHTML = out.join('');
}
function talSend(op, stat, n) {
  if (!NET.on || !WSC.ready) { return; }
  wsSend('talent', { op: op, stat: stat, n: n || 1 });
}
function talBind() {
  var el = document.getElementById('talList');
  if (el && !el._b) {
    el._b = true;
    el.addEventListener('click', function (e) {
      var b = e.target;
      if (!b || !b.getAttribute || !b.getAttribute('data-k')) { return; }
      var k = b.getAttribute('data-k');
      var n = +b.getAttribute('data-n') || 1;
      /* ★ 乐观更新 ✓ 先改数字再发协议 ✗
         （点了没反应是玩家最恨的 ✗ 服务器回执到了会直接覆盖 ✓）*/
      if (n > 0) { if (TAL.free <= 0) { return; } TAL.free -= 1; }
      else { if ((TAL.pts[k] || 0) <= 0) { return; } TAL.pts[k] -= 1; }
      talRender();
      talSend('add', k, n);
    });
  }
  var rb = document.getElementById('talReset');
  if (rb && !rb._b) {
    rb._b = true;
    rb.addEventListener('click', function () { talSend('reset', '', 1); });
  }
  /* ★ 左上角那行"天赋点 N"可以点 ✓（方案 §8.0 第二个入口）*/
  var u = document.getElementById('uStat');
  if (u && !u._b) {
    u._b = true;
    u.style.cursor = 'pointer';
    u.addEventListener('click', function () { openSet(); setTab('talent'); talRender(); });
  }
}
/* ★★★ 第 148 轮（用户要求）：菜单里的【百科全书】★★★
   用户原话："菜单里加一个百科全书，简单写一下魔气的说明让玩家知道多少魔气的作用，
             后续也可以加其它说明"
   ★ 三条原则：
     ① 说人话 + 带【真实数值】✗ 不许写"较高/较低"这种模糊话 ✓
     ② 内容写死在前端 ✓（这是说明文字 ✗ 不是权威数据 ✓）
        ★ 改了游戏规则要记得同步改这里 ✗（见文件末尾的提示 ✓）
     ③ 加新条目 = 在 WIKI 数组里加一条 ✓ 不用改任何结构 ✓ */
/* ★★ round409：冷却秒数 → 人话（★ 服务端 world.cd_human 是同一套规则 ✓
   两边都显示"10 分钟"这种话 ✗ 不许一边写 600 一边写 10 分钟 ✓）*/
function cdHuman(sec) {
  var s = +sec;
  if (!isFinite(s) || s <= 0) { return '不冷却'; }
  if (s < 60) { return Math.round(s) + ' 秒'; }
  var m = s / 60;
  if (Math.abs(m - Math.round(m)) < 0.05) { return Math.round(m) + ' 分钟'; }
  return m.toFixed(1) + ' 分钟';
}
/* 夺取 / 魔气两条冷却的说明行 —— 值来自 welcome 的 cfg（服务器现读配置发的 ✓）
   ★ 没收到 cfg 时给个"以游戏内提示为准"✗ 绝不编一个数字 ✓ */
function mqCdLine() {
  var c = (typeof WSC !== 'undefined' && WSC.cfg) ? WSC.cfg : null;
  if (!c || (!c.stealCd && !c.pairCd)) {
    return '同一个人：夺取和魔气各有一条冷却（具体时长以游戏内提示为准）';
  }
  return '同一个人：夺取（经验/背包）最多 ' + cdHuman(c.stealCd) +
         '一次，魔气最多 ' + cdHuman(c.pairCd) + '一次';
}
var WIKI = [
  { k: 'auto', t: '自动战斗', h: [
    ['怎么开关', [
      '★ <b>按住右下角攻击键 3 秒</b> → 自动战斗开启（按钮变绿 + 弹提示）',
      '★ 再按住 3 秒 → 关闭',
      '也可以走 菜单 → 操作 → 勾选"自动战斗"（和右下角那个按钮是同一个开关）'
    ]],
    ['它怎么打', [
      '自己找怪（优先打<b>正在打你的</b>，其次打最近的）→ 走过去 → 砍一刀',
      '★ <b>打完就往后撤</b>，不站着挨打（僵尸咬人前要蓄力 0.45 秒，',
      '　　这时候退开，它这一口就废了 —— 所以打带跑是真的能躲）',
      '被围住也一样打一下撤一下；只有被墙挡住退不动时才原地打'
    ]],
    ['它不会做什么', [
      '不会走进<b>安全区</b>（里面不能攻击，追进去等于发呆）；',
      '　　万一人已经在里面了，它会原地待命，你走出去它再接着干',
      '不会追太远（超过 30 米就换目标，不会满地图乱跑）',
      '不会自动打玩家（只打僵尸）'
    ]],
    ['打不到怎么办', [
      '它会盯着怪的血：<b>超过 3 秒血没掉</b> → 认为被建筑挡住了',
      '→ 左右随机绕一下再打；绕 3 次还打不到 → 放弃这个目标换一个'
    ]],
    ['死了怎么办', [
      '★ 会<b>原地自动复活</b>继续打（不回安全区）',
      '复活后先退两步（利用 1.5 秒无敌脱离怪堆）再继续',
      '★ 防送死保险：30 秒内死第 2 次 → 停手 8 秒；',
      '　　<b>连死 3 次会自动关掉自动战斗</b>（免得挂机一晚上把魔气掉光）'
    ]],
    ['你手动操作时', [
      '推摇杆 / 按 WASD / 点攻击键 → 自动战斗<b>暂停 3 秒</b>（不是关掉）',
      '松开手 3 秒后它自己接着干 —— 方便你临时接管一下'
    ]],
    ['自动捡东西', [
      '周围<b>没有僵尸</b>的时候，它会走过去捡地上掉的东西（12 米内）',
      '可关：菜单 → 操作 → 取消勾选"自动捡东西"'
    ]]
  ]},
  { k: 'mq', t: '魔气值', h: [
    ['什么是魔气', '杀人杀出来的"凶名"。杀得越多魔气越高，别人看你就越危险。'],
    ['怎么涨 / 怎么掉', [
      '击杀一名玩家：<b>+2</b>',
      '被杀（玩家或僵尸）：<b>−1</b>',
      '自然衰减：<b>每小时 −1</b>（下线也算，最多掉到 0）'
    ]],
    ['魔气有什么用', [
      '<b>伤害加成</b>：每 1 点 +1%，最多 <b>+50%</b>（打怪、打人都算）',
      '<b>夺取概率</b>：基础 5%，每 2 点 +0.2%，最多 <b>15%</b>',
      '<b>夺取经验的比例</b>（看夺取方自己的魔气）：'
    ]],
    ['夺取经验的比例表', [
      '魔气 0 ~ 99 → 夺走对方当前经验的 <b>5%</b>',
      '魔气 100 ~ 199 → <b>8%</b>',
      '魔气 200 ~ 500 → <b>10%</b>',
      '魔气 500 以上 → <b>15%</b>'
    ]],
    ['魔气的代价（很重要）', [
      '你被杀时，<b>魔气比你高的人会反过来夺你</b>。',
      '规则：算双方的概率，<b>用魔气高那边</b>的概率，掷一次骰子 —— 中了就是魔气高的人夺。',
      '所以魔气高的人，也是别人眼里最肥的猎物。'
    ]],
    ['夺取会拿走什么', [
      '经验：按上面的比例表',
      '背包物品：随机 1 件<b>没装备的</b>，必夺（弹幕里会写出名字）',
      '★ 穿戴中的装备也可能被扒走，但只有 <b>1%</b> 概率（耐久原样保留）',
      mqCdLine,                          /* ★ round409：动态读服务器配置 ✗ 不写死 ✓
                                            ★ 这里放【函数】不是字符串 ✗ 因为 WIKI 数组是
                                              页面加载时就建好的 ✓ 那会儿 welcome 还没到 ✓
                                              （写字符串 = 永远是加载那一刻的默认值 ✓）*/
      '对方没经验了 → 改扣 <b>100 金币</b>；金币也没有 → 什么都不扣'
    ]],
    ['头顶怎么显示', [
      '有魔气时头顶显示 <b>👿 + 数字</b>，红色，魔气越高颜色越深',
      '魔气 0 → 这个标记完全消失',
      '分档：1~49 浅红 · 50~99 正红 · 100~199 深红 · 200~499 暗红 · 500+ 血红偏黑'
    ]]
  ]},
  { k: 'safe', t: '安全区 / 离线', h: [
    ['安全区', [
      '主城范围内的 <b>500×500</b> 是安全区（地面是浅色石板 + 金色边线，一眼认得出）；'
      + '点「回安全区」会把你送到<b>中央广场</b>',
      '★ <b>僵尸进不来</b>：它们会在边界外面停下',
      '★ 你一进去，追你的僵尸就 <b>丢失目标</b>',
      '★ 在里面<b>不能攻击</b>（也不会被玩家打）—— 这里是完全的和平区',
      '菜单 → 操作 里可以<b>传送回安全区</b>：读条 <b>6 秒</b>',
      '★ 读条期间<b>受到任何伤害都会中断</b>（想跑得先脱离战斗）',
      '传送到达后会给 <b>1.5 秒无敌</b>（防止一落地就被围）'
    ]],
    ['离线宽限 6 秒', [
      '你退出游戏后，角色会在世界里再留 6 秒',
      '这 6 秒里怪物还能把你打死、也能被其他玩家攻击',
      '★ 所以“打不过就直接退游戏”没用：该跑还得跑'
    ]],
    ['升级', '升级会恢复满血（包括防具加的那部分上限）']
  ]},

  { k: 'pvp', t: 'PVP 规则', h: [
    ['谁能打谁', [
      '<b>只要不是队友</b>，就能互相打（不需要宣战）',
      '★ <b>队友之间永远打不到</b>',
      '★ 管理员可以关掉 PVP（全服或单独某人）→ 关了就打不到'
    ]],
    ['怎么打', [
      '普通攻击就能打到（挥砍范围内有玩家就会判定命中）',
      '以后做的技能也能打到',
      '被打的人屏幕上是<b>红色伤害数字</b> + 显示是谁打的'
    ]],
    ['伤害怎么算', '和打怪完全一样：固有攻击 + 武器 + 词条 + 天赋 + 魔气加成，再减对方的防具减伤。暴击和词条特效对玩家也生效。']
  ]},
  { k: 'attr', t: '属性 / 天赋', h: [
    ['三类属性', [
      '<b>池 / 强度类</b>：血量 · 灵气 · 法力 · 攻击力（点数直接换数值）',
      '<b>对抗类</b>：减伤 / 穿透 · 暴击 / 免爆 · 闪避 / 命中（1 点 = 0.5%，成对相减）',
      '<b>增益类</b>：爆伤 / 移速（1 点 = 1%）'
    ]],
    ['上限只管有效值', '投入点数没有上限。比如闪避堆到 60% 也没关系，只有"有效闪避"被压在 50%。'],
    ['各项上限', '减伤 80% · 闪避 50% · 暴击率 40% · 爆伤 500% · 攻速 4.4 · 移速 30%'],
    ['天赋点', '每级 +3 点，自由分配。洗点免费（5 分钟冷却）。']
  ]},
  { k: 'gear', t: '装备', h: [
    ['武器', '8 种类型 × 12 个品阶。攻速 / 范围 / 打击面各不相同。等级不够不是不能装，而是"发挥度"打折。'],
    ['防具', '减伤 + 生命上限 + 闪避 / 回灵气等词条。穿在武器槽右边那个槽。'],
    ['耐久', '武器每挥一次 −1，防具每挨打一次 −1。归零就损坏消失。背包格子上有耐久条，悬停看具体数字。'],
    ['词条', '装备掉落时随机附带，数量跟品阶走（越高越多）。']
  ]},
  { k: 'drop', t: '掉落', h: [
    ['装备掉率', '每只僵尸约 25% 掉武器，其中 25% 换成防具。'],
    ['品阶', [
      '品阶大致跟着僵尸等级走：<b>最高品阶 ≈ 僵尸等级 ÷ 10</b>',
      '★ 但任何等级都有极小概率掉 12 阶（1 级怪约 25 万分之一）',
      '120 级封顶：12 阶概率最高 2%（再往上练也不会更高）'
    ]]
  ]},
  { k: 'team', t: '组队', h: [
    ['上限', '一队最多 5 人。'],
    ['经验分享', '自己杀的拿 100%；队友杀的，' +
      '★ 队伍里每个队友都拿该僵尸经验的 10%（和人数无关，也不限距离）。'],
    ['队友标识', '100 米内会显示蓝色箭头；头顶名字前面有蓝色五角星。']
  ]},
  { k: 'realm', t: '境界 / 等级', h: [
    ['每级加血（★ 常被问）', [
      '★ 血量上限是【跟着等级涨】的 ✗ 不是固定值 ✓',
      '公式：<b>100 + 22×等级 + 0.6×等级²</b>',
      '  1 级 123 · 10 级 380 · 30 级 1300 · 62 级 3867',
      '★ 另外还有：攻击 <b>10 + 3×等级 + 0.08×等级²</b>（和装备无关的"固有攻击"）',
      '★ 防具加的血是在这个基础上【再加】的 ✓ 天赋点也再加 ✓'
    ]],
    ['等级', '打怪、做任务都会给经验。升级自动加固有属性（攻击 / 生命 / 灵气）。'],
    ['天赋点', '每升 1 级给 3 点，在菜单的【天赋】页分配。']
  ]},
  { k: 'broken', t: '装备损坏与修理', h: [
    ['怎么才会坏', [
      '武器：每挥一次 −1 耐久；防具：每挨一次打 −1 耐久。',
      '★ 耐久归零就【损坏】✗ —— 但物品【不会消失】✓'
    ]],
    ['损坏之后什么样', [
      '· 它还是留在你的背包里 ✓ 格子上会有一个红框 + 红叉 + 变灰 ✓',
      '· 如果是穿在身上的 ✗ 穿戴格子上会显示「已损坏」✓',
      '· 已经损坏的【不能再穿上】✓ 点了会提示',
      '· 而且它也不再提供任何效果（武器按空手算 ✗ 防具不加血 ✓）'
    ]],
    ['为什么要这样改', [
      '★ 以前的设定是「归零就消失」✗',
      '→ 挂机一晚上回来只看到"背包里少了一件"✓',
      '→ 分不清是被偷了、丢了、还是坏了 ✓',
      '→ 现在会一直留着 ✓ 你一眼就知道"哦，是坏了" ✓'
    ]],
    ['怎么办', [
      '目前没有修理功能 ✗ 坏了就只能丢掉 / 换新的 ✓',
      '★ 所以挂机前看一眼耐久 ✗ 快坏了（低于 20%）会有橙色 ⚠ 提示 ✓'
    ]]
  ]},

];

function wikiRender(k) {
  var nav = document.getElementById('wikiNav');
  var body = document.getElementById('wikiBody');
  if (!nav || !body) { return; }
  var cur = k || nav._k || WIKI[0].k;
  nav._k = cur;
  var html = [];
  for (var i = 0; i < WIKI.length; i++) {
    var w = WIKI[i];
    html.push('<button class="bagB' + (w.k === cur ? '' : ' off') +
      '" data-wk="' + w.k + '">' + w.t + '</button>');
  }
  nav.innerHTML = html.join('');
  var one = null;
  for (var j = 0; j < WIKI.length; j++) { if (WIKI[j].k === cur) { one = WIKI[j]; } }
  if (!one) { one = WIKI[0]; }
  var out = ['<div style="color:#ffd83d;font-weight:700;margin-bottom:6px">' + one.t + '</div>'];
  for (var h = 0; h < one.h.length; h++) {
    var sec = one.h[h];
    out.push('<div style="color:#8ee0ff;margin-top:6px">' + sec[0] + '</div>');
    if (typeof sec[1] === 'string') {
      out.push('<div style="opacity:.9">' + sec[1] + '</div>');
    } else {
      out.push('<div style="opacity:.9">');
      for (var l = 0; l < sec[1].length; l++) {
        /* ★ round409：数组里可以放【函数】✗ 渲染时才求值 ✓
           （冷却这种"管理里改了要跟着变"的文字必须这样 ✓ 写死就永远是旧值 ✓）*/
        var _ln = sec[1][l];
        out.push('· ' + (typeof _ln === 'function' ? _ln() : _ln) + '<br>');
      }
      out.push('</div>');
    }
  }
  body.innerHTML = out.join('');
}
function wikiBind() {
  var nav = document.getElementById('wikiNav');
  if (!nav || nav._b) { return; }
  nav._b = true;
  nav.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.getAttribute) { return; }
    var k = t.getAttribute('data-wk');
    if (k) { wikiRender(k); }
  });
}
/* ★★ 第 152 轮：魔气的显示工具 ★★
   ★ 为什么用表情图标而不是自画 SVG：
     头顶那一行是纯文本（textContent ✗）放不了 SVG ✗
     而表情图标在所有浏览器/手机上都渲染得出来 ✓
     （以后想换成自画像素图：把 UI.plate.name 改成支持 HTML 就行 ✗ 结构不用动 ✓）*/
/* ★★ 第 157 轮（用户要求）：自己画的红色恶魔头 ★★
   用户原话："自己做一个红色恶魔头，把数字放到恶魔头里，魔气越高恶魔头越大"

   ① 手画：两只角 + 额头宽下巴尖 + 怒眼 + 数字在头里 —— 不抄任何素材 ✓
   ② 数字在头【里面】（眼睛下面 ✓ 四位数自动缩小字号 ✓）
   ③ 魔气越高头越大：22px（低）→ 40px（约 540 点封顶 ✓）
     颜色仍是五档递增（浅红 → 正红 → 深红 → 暗红 → 血红偏黑 ✓）
   ★ 只返回 SVG 字符串 ✗ "值变了才重建"由调用方负责 ✓
     （这个函数每帧都会被调 ✓ 每帧重画 SVG 会白烧 CPU ✓）*/
function mqSvg(v) {
  v = Math.round(+v || 0);
  var col = mqColor(v);
  var sz = 22 + Math.min(18, Math.floor(v / 30));       // 22 → 40px
  var fs = (v >= 1000) ? 9.5 : (v >= 100) ? 11 : 13;    // 数字越长越小
  var dark = '#2a0505';
  return '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 40 40" '
    + 'style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.85))">'
    + '<path d="M9 14 L3 2 L16 9 Z" fill="' + col + '" stroke="' + dark + '" stroke-width="1.6"/>'
    + '<path d="M31 14 L37 2 L24 9 Z" fill="' + col + '" stroke="' + dark + '" stroke-width="1.6"/>'
    + '<path d="M20 6 C31 6 35 13 34 21 C33 30 27 37 20 37 C13 37 7 30 6 21 '
    + 'C5 13 9 6 20 6 Z" fill="' + col + '" stroke="' + dark + '" stroke-width="1.8"/>'
    + '<path d="M10 17 L18 21 L10 23 Z" fill="' + dark + '"/>'
    + '<path d="M30 17 L22 21 L30 23 Z" fill="' + dark + '"/>'
    + '<text x="20" y="33" text-anchor="middle" font-size="' + fs + '" '
    + 'font-weight="700" fill="#fff" stroke="' + dark + '" stroke-width="0.7" '
    + 'paint-order="stroke">' + v + '</text>'
    + '</svg>';
}

var MQ_ICON = '\uD83D\uDC7F ';          // 👿 小恶魔
function mqColor(mq) {
  mq = +mq || 0;
  if (mq <= 0) { return '#fff'; }
  if (mq < 50) { return '#ff7a6a'; }      // 浅红
  if (mq < 100) { return '#ff4a3a'; }     // 正红
  if (mq < 200) { return '#e02020'; }     // 深红
  if (mq < 500) { return '#b31414'; }     // 暗红
  return '#7d0a0a';                        // 血红偏黑（最高档 ✓）
}
function mqStealPct(mq) { return Math.min(15, 5 + (+mq || 0) / 2 * 0.2); }
function mqExpPct(mq) {
  mq = +mq || 0;
  return (mq >= 501) ? '15%' : (mq >= 200) ? '10%' : (mq >= 100) ? '8%' : '5%';
}

/* round294: gold display helpers.
   fmtGold(): plain digits below 10000, short form above (12,345 / 1.2wan).
   GOLD_COL is the same yellow used by the ticker's level-up colour. */
var GOLD_COL = '#ffd83d';
/* round303b ★ 用户的规矩：5 阶及以上的装备 ✗ 卖掉之前要再问一次 ✓
   ★ 阶数是【显示用】的（1 起）✗ 而数据里的 tier 是 0 起 ✓
     所以判断一律用 (tier+1) >= HIGH_TIER_CONFIRM ✓ 别在别处写死 5 ✓ */
var HIGH_TIER_CONFIRM = 5;
function fmtGold(n) {
  n = Math.max(0, Math.floor(+n || 0));
  if (n < 10000) { return String(n); }
  if (n < 100000000) { return (n / 10000).toFixed(n < 100000 ? 1 : 0) + '万'; }
  return (n / 100000000).toFixed(2) + '亿';
}
function statRender() {
  /* \u2605\u2605\u2605 round465\uff08\u7528\u6237\uff1a"\u4e0d\u8981\u624b\u4e0a\u6b66\u5668\u548c\u8eab\u4e0a\u9632\u5177\u8fd9\u4e9b\uff0c\u5c31\u53ea\u8981\u5c5e\u6027\u603b\u63c0"\uff09\u2605\u2605\u2605
     \u5c5e\u6027\u9875 = \u53ea\u6709\u3010\u5c5e\u6027\u603b\u89c8\u3011\u2717
     \u6b66\u5668 / \u9632\u5177 / \u4eba\u7269\u4e09\u5757\u5168\u90e8\u4e0d\u518d\u6e32\u67d3\uff08\u90a3\u4e9b\u5728\u80cc\u5305\u91cc\u770b \u2713\uff09*/
  var r = WSC.role || {};
  var lv = r.level || 1;
  /* ★ round465b：人物/武器/防具三块已从 index.html 删掉 ✗
     所以不能再用 "el1 存在吗" 当开关 ✗ 否则整页不渲染 ✓ */
  var el4 = document.getElementById('stTotal');
  if (!el4) { return; }

  var need = Math.round((WSC.role && WSC.role.need) || expNeed(lv));
  if (WSC.role && typeof WSC.role.needExp === 'number' && WSC.role.needExp > 0) {
    need = WSC.role.needExp;
  }
  var head =
    '<div class="bagTip" style="margin-bottom:6px">' +
      '<b style="color:#ffd83d;font-size:14px">' + (r.name || '?') + '</b>' +
      ' \u00b7 \u70bc\u6c14 ' + lv + ' \u5c42' +
      ' \u00b7 \u7ecf\u9a8c ' + (r.exp || 0) + (need ? (' / ' + need) : '') +
      ' \u00b7 \u91d1\u5e01 ' + fmtGold((WSC.role && WSC.role.gold) || 0) +
    '</div>';
  var mqTxt = (typeof MY_MQ !== 'undefined' && MY_MQ > 0)
    ? ('<div class="bagTip" style="margin-bottom:6px">\u9b54\u6c14 ' + MY_MQ +
       ' \u00b7 \u4f24\u5bb3 +' + Math.min(50, MY_MQ) + '% \u00b7 \u593a\u53d6\u6982\u7387 ' +
       mqStealPct(MY_MQ).toFixed(1) + '%</div>')
    : '';
  el4.innerHTML = head + mqTxt + statSheetHTML() +
    '<div class="bagTip" style="margin-top:8px">\u2605 \u6539\u4e86\u88c5\u5907 / \u5347\u4e86\u7ea7 / \u52a0\u4e86\u5929\u8d4b \u2192 \u8fd9\u4e00\u9875\u4f1a\u81ea\u52a8\u5237\u65b0</div>';
}

function statSheetHTML() {
  /* \u2605 round465\uff1a\u56db\u7ec4\uff08\u751f\u5b58 / \u8f93\u51fa / \u624b\u611f / \u9644\u52a0\uff09\u2717 \u6bcf\u7ec4\u4e00\u4e2a\u5c0f\u6807\u9898 \u2713
     \u6bcf\u884c\uff1a\u540d\u5b57 \u00b7 \u5f53\u524d\u503c \u00b7 \u4e0a\u9650 \u00b7 \u6765\u6e90\uff08\u4eba\u7269/\u88c5\u5907/\u5929\u8d4b\uff09\u2713 */
  var rows = (typeof TAL !== 'undefined' && TAL.stats) ? TAL.stats : null;
  if (!rows || !rows.length) {
    return '<div class="bagTip" style="margin-top:8px">\u5c5e\u6027\u603b\u89c8\uff1a\u6b63\u5728\u5411\u670d\u52a1\u5668\u8981\u2026</div>';
  }
  var ORDER = ['\u751f\u5b58', '\u8f93\u51fa', '\u624b\u611f', '\u9644\u52a0'];
  var byGrp = {};
  for (var i = 0; i < rows.length; i++) {
    var g = rows[i].grp || '\u5176\u5b83';
    (byGrp[g] = byGrp[g] || []).push(rows[i]);
  }
  function fmtVal(r) {
    var u = (r.unit === '%') ? '%' : '';
    /* round470: new unit "\u00d7" (attack speed shown as x1.32) */
    if (r.unit === '\u00d7') {
      return '\u00d7' + (Math.round(+r.v * 100) / 100);
    }
    /* round471: "刀/秒" (attacks per second) */
    if (r.unit === '\u5200/\u79d2') {
      return (Math.round(+r.v * 100) / 100) + ' 刀/秒';
    }
    if (r.unit === '\u79d2' || r.unit === '\u7c73/\u79d2') {
      return (Math.round(+r.v * 100) / 100) + ' ' + r.unit;
    }
    if (r.unit === '%') { return (Math.round(+r.v * 10) / 10) + '%'; }
    return Math.round(+r.v) + ' \u70b9';
  }
  var h = '';
  for (var oi = 0; oi < ORDER.length; oi++) {
    var gname = ORDER[oi];
    var list = byGrp[gname];
    if (!list || !list.length) { continue; }
    h += '<div style="color:#ffd83d;font-weight:700;margin:10px 0 4px;font-size:13px">' +
      '\u25b8 ' + gname + '</div>';
    for (var j = 0; j < list.length; j++) {
      var r = list[j];
      var parts = [];
      /* round470: attack speed base comes from the WEAPON; server sends r.bn */
      if (Math.abs(+r.base) > 0.001) {
        parts.push((r.bn || '\u4eba\u7269') + ' ' + fmtVal({ v: r.base, unit: r.unit }));
      }
      if (Math.abs(+r.gear) > 0.001) {
        var sign = (+r.gear > 0 ? '+' : '');
        parts.push('\u88c5\u5907 ' + sign + fmtVal({ v: r.gear, unit: r.unit }));
      }
      if (Math.abs(+r.tal) > 0.001) {
        parts.push('\u5929\u8d4b +' + fmtVal({ v: r.tal, unit: r.unit }));
      }
      var src = parts.length ? parts.join(' \u00b7 ') : '';
      var capTxt = (+r.cap > 0) ? ('\u4e0a\u9650 ' + fmtVal({ v: r.cap, unit: r.unit })) : '';
      /* ★ round465b：0 值的行调暗（看得出存在、但还没加成 ✓）*/
      var zero = Math.abs(+r.v) < 0.001;
      h += '<div style="display:flex;align-items:baseline;justify-content:space-between;' +
        'padding:5px 10px 5px 0;border-bottom:1px solid #ffffff10' + (zero ? ';opacity:.5' : '') + '">' +
        '<span style="color:#cfd8e4">' + r.n + '</span>' +
        '<span><b style="color:#8ee0ff">' + fmtVal(r) + '</b>' +
        (capTxt ? '<span class="bagTip" style="margin-left:6px">' + capTxt + '</span>' : '') +
        '</span></div>' +
        (src ? ('<div class="bagTip" style="margin:-3px 0 4px">' + src + '</div>') : '');
    }
  }
  h += '<div class="bagTip" style="margin-top:8px">' +
    '\u2605 \u5bf9\u6297\u7c7b\u6210\u5bf9\u76f8\u51cf\uff1a\u547d\u4e2d\u62b5\u95ea\u907f \u00b7 \u514d\u7206\u62b5\u66b4\u51fb \u00b7 \u7a7f\u900f\u62b5\u56fa\u5b9a\u51cf\u4f24<br>' +
    '\u2605 \u4e0a\u9650\u53ea\u538b\u5728\u3010\u5929\u8d4b\u90a3\u4e00\u90e8\u5206\u3011\uff0c\u57fa\u7840\u503c\u548c\u88c5\u5907\u8bcd\u6761\u4e0d\u53d7\u9650</div>';
  return h;
}
function ptEsc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function partySend(op, d) {
  if (!NET.on || !WSC.ready) { return false; }
  var body = { op: op };
  for (var k in (d || {})) { body[k] = d[k]; }
  return wsSend('party', body);
}
function lobbyFetch(cb) {
  fetch('/api/lobby', { headers: { 'X-Token': bagToken() } })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (j && j.ok) {
        LOBBY.players = j.players || [];
        LOBBY.parties = j.parties || [];
        LOBBY.online = j.online || 0;
        LOBBY.err = '';
      } else { LOBBY.err = (j && j.error) || '读大厅失败'; }
      if (cb) { cb(); }
      ptRender();
    })
    .catch(function () { LOBBY.err = '连不上服务器'; if (cb) { cb(); } ptRender(); });
}
function ptBar(pct, col) {
  var k = Math.max(0, Math.min(100, pct || 0));
  return '<span class="ptBar"><i style="width:' + k + '%;background:' + col + '"></i></span>';
}
function ptWeapon(look, tier) {
  try {
    return '<span style="color:' + tierHex(tier || 0) + ';vertical-align:-3px">' +
      weaponIconSvg(look || 'sword', tier || 0) + '</span>';
  } catch (e) { return ''; }
}

/* ★ 2026-10-22（用户要求）：组队页下面的「自己刷怪上限」滑块（1~100）
   · 拖动 → 发包 mobcap{n}
   · 服务器回 mobcap{n,max} → 回写滑块和数字（以服务器为准，防越界）
   · 进世界时服务器也会推一条 → 初值就是真实的 */
var PT_MOBCAP = 8;
try {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { try { ptMobCapBind(); } catch (e0) { } });
  } else {
    setTimeout(function () { try { ptMobCapBind(); } catch (e1) { } }, 0);
  }
} catch (eMc0) { }
function ptMobCapBind() {
  /* ★ 2026-10-22：改成【全局事件委托】——
     以前只在组队页 ptRender() 里绑，没打开过组队页就=没绑上，
     拖滑块毫无反应。委托不关心元素什么时候出现。 */
  if (!window._mobCapDelegated) {
    window._mobCapDelegated = true;
    document.addEventListener('input', function (e) {
      var el = e.target;
      if (!el || el.id !== 'ptMobCap') { return; }
      ptMobCapPaint(Math.max(1, Math.min(100, parseInt(el.value, 10) || 1)));
    }, true);
    document.addEventListener('change', function (e) {
      var el = e.target;
      if (!el || el.id !== 'ptMobCap') { return; }
      var v = Math.max(1, Math.min(100, parseInt(el.value, 10) || 1));
      try { wsSend('mobcap', { n: v }); } catch (e2) { }
    }, true);
  }
  ptMobCapPaint(PT_MOBCAP);
}
function ptMobCapPaint(v) {
  var sl = document.getElementById('ptMobCap');
  var tx = document.getElementById('ptMobCapVal');
  var n = Math.max(1, Math.min(100, parseInt(v, 10) || 1));
  if (sl && String(sl.value) !== String(n)) { sl.value = n; }
  if (tx) { tx.textContent = n + ' 只'; }
}
function ptMobCapApply(d) {
  if (!d) { return; }
  PT_MOBCAP = Math.max(1, Math.min(100, parseInt(d.n, 10) || 1));
  if (+d.max) {
    var sl = document.getElementById('ptMobCap');
    if (sl) { sl.max = +d.max; }
  }
  ptMobCapPaint(PT_MOBCAP);
}

function ptRender() {
  try { ptMobCapBind(); } catch (eMcb) { }   // ★ 滑块：第一次渲染就绑上
  var mine = document.getElementById('ptMine');
  var pend = document.getElementById('ptPend');
  var pls = document.getElementById('ptPlayers');
  var pts = document.getElementById('ptParties');
  var inf = document.getElementById('ptInfo');
  if (!mine || !pend || !pls || !pts) { return; }

  /* ① 我的队伍 */
  if (!PARTY.roster || !PARTY.roster.length) {
    mine.innerHTML = '<div class="bagTip">还没有队伍 —— 在下面大厅点【邀请】拉人，' +
      '或者申请加入别人的队伍 ✓</div>';
  } else {
    var h = [];
    for (var i = 0; i < PARTY.roster.length; i++) {
      var m = PARTY.roster[i];
      var rid = m[0], nm = m[1], lv = m[2], hp = m[3], hpm = m[4], qi = m[5];
      var qim = m[6], lk = m[7], tr = m[8], down = m[9], lead = m[10];
      var isMe = (rid === PARTY.me);
      h.push('<div class="ptLine"' + (isMe ? ' style="background:#ffffff10"' : '') + '>' +
        /* ★ 第 85 轮：名字可点 → 弹小窗（踢出 / 给队长）*/
        '<b class="ptName" data-pt="menu" data-id="' + rid + '"' +
        (isMe ? '' : ' style="cursor:pointer;text-decoration:underline dotted #ffffff44"') +
        '>' + (lead ? '<span style="color:#ffd83d">队长 </span>' : '队员 ') +
          ptEsc(nm) + '</b><span class="bagTip">Lv' + lv + '</span>' +
        (down ? ' <span style="color:#ff7a6a">倒地</span>' : '') +
        ptWeapon(lk, tr) +
        ptBar(hpm ? hp * 100 / hpm : 0, '#7ee08a') +
        ptBar(qim ? qi * 100 / qim : 0, '#8ee0ff') +
        '</div>');
    }
    h.push('<div class="ptRow" style="margin-top:6px">' +
      '<button class="bagB" data-pt="leave">退队</button>' +
      (PARTY.leader === PARTY.me
        ? '<button class="bagB" data-pt="recruit">招募：开/关</button>' +
          '<button class="bagB" data-pt="disband">解散队伍</button>' : '') +
      '</div>');
    mine.innerHTML = h.join('');
  }

  /* ② 待处理（★ 用户点名要的：界面里也要能同意/拒绝 ✓）*/
  var ph = [];
  var _nowS = Date.now() / 1000;
  for (var a = 0; a < PARTY.inv.length; a++) {
    var iv = PARTY.inv[a];
    var _left = Math.max(0, Math.round((+iv[2] || 0) - _nowS));
    if (_left <= 0) { continue; }        // ★ 本地判断过期 → 不显示 ✓
    ph.push('<div class="ptLine"><b>' + ptEsc(iv[1]) + '</b>' +
      '<span class="bagTip">邀请你组队（还剩 ' + _left + ' 秒）</span>' +
      '<button class="bagB" data-pt="acc" data-id="' + iv[0] + '">接受</button>' +
      '<button class="bagB" data-pt="dec" data-id="' + iv[0] + '">拒绝</button></div>');
  }
  for (var b = 0; b < PARTY.app.length; b++) {
    var ap = PARTY.app[b];
    var _left2 = Math.max(0, Math.round((+ap[2] || 0) - _nowS));
    if (_left2 <= 0) { continue; }
    ph.push('<div class="ptLine"><b>' + ptEsc(ap[1]) + '</b>' +
      '<span class="bagTip">申请加入（还剩 ' + _left2 + ' 秒）</span>' +
      '<button class="bagB" data-pt="oka" data-id="' + ap[0] + '">同意</button>' +
      '<button class="bagB" data-pt="noa" data-id="' + ap[0] + '">拒绝</button></div>');
  }
  pend.innerHTML = ph.length ? ph.join('') :
    '<div class="bagTip">没有待处理的邀请或申请 ✓</div>';

  /* ③ 大厅 */
  var kw = (_ptSearch || '').trim().toLowerCase();
  if (inf) {
    inf.textContent = '在线 ' + LOBBY.online + ' 人 · 招募中 ' + LOBBY.parties.length +
      ' 队' + (LOBBY.err ? (' · ' + LOBBY.err) : '');
  }
  var rows = [];
  for (var c = 0; c < LOBBY.players.length; c++) {
    var p = LOBBY.players[c];
    if (kw && String(p.name || '').toLowerCase().indexOf(kw) < 0) { continue; }
    /* ★ 第 264 轮修的真 bug：这里原来【写死 3】✗
   队伍上限第 244 轮已经改成 5 了 ✗ 但客户端这个判断没跟着改 ✓
   → 满 3 人之后邀请按钮就不给用了 ✓（服务器明明允许 5 个 ✓）
   ★ 现在用服务器发来的上限（'max' ✓ 没给就退回 5 ✓）*/
  var _pmax = (PARTY && PARTY.max) ? PARTY.max : 5;
  var canInv = !p.party && (!PARTY.roster || PARTY.roster.length < _pmax);
    rows.push('<div class="ptLine"><b>' + ptEsc(p.name) + '</b>' +
      '<span class="bagTip">Lv' + (p.lv || 1) + '</span>' + ptWeapon(p.look, p.tier) +
      ptBar(p.hp, '#7ee08a') +
      '<span class="bagTip">' + ((p.dist === null || p.dist === undefined)
        ? '?米' : (p.dist + ' 米')) + '</span>' +
      (p.party ? '<span class="bagTip">已组队</span>' : '') +
      (canInv ? '<button class="bagB" data-pt="inv" data-id="' + p.id + '">邀请</button>'
              : '') + '</div>');
  }
  pls.innerHTML = rows.length ? rows.join('') : '<div class="bagTip">没有匹配的玩家</div>';

  var pr = [];
  for (var d2 = 0; d2 < LOBBY.parties.length; d2++) {
    var q = LOBBY.parties[d2];
    var blob = (String(q.leader || '') + ' ' + (q.names || []).join(' ')).toLowerCase();
    if (kw && blob.indexOf(kw) < 0) { continue; }
    pr.push('<div class="ptLine"><b>' + ptEsc(q.leader) + ' 的队伍</b>' +
      '<span class="bagTip">' + q.n + '/' + q.max + '</span>' +
      '<span class="bagTip">' + ptEsc((q.names || []).join('、')) + '</span>' +
      (PARTY.roster ? '<span class="bagTip">你已有队伍</span>'
                    : '<button class="bagB" data-pt="apply" data-pid="' + q.pid +
                      '">申请加入</button>') + '</div>');
  }
  pts.innerHTML = pr.length ? pr.join('') : '<div class="bagTip">现在没有队伍在招募</div>';
}

/* ★ 第 85 轮：点名字弹的小窗（踢出 / 给队长）
   用户要求：不要行内按钮 ✗ 改成点名字弹小窗 ✓
   只有【我是队长 + 不是我自己】才有菜单 ✓ 点别处自动关 ✓ */
function ptMenuClose() {
  var old = document.getElementById('ptMenu');
  if (old && old.parentNode) { old.parentNode.removeChild(old); }
}
function ptMenuOpen(rid, name, sx, sy) {
  ptMenuClose();
  var isMe = (String(rid) === String(PARTY.me));
  var canLead = (PARTY.leader === PARTY.me) && !isMe;
  var d = document.createElement('div');
  d.id = 'ptMenu';
  var inner = '<div style="font-weight:700;margin-bottom:6px">' + ptEsc(name) + '</div>';
  if (canLead) {
    inner += '<button class="bagB" data-pt="kick" data-id="' + rid + '">踢出队伍</button>' +
             '<button class="bagB" data-pt="promote" data-id="' + rid + '">转让队长</button>';
  } else {
    inner += '<div class="bagTip">' + (isMe ? '这是你自己' : '只有队长能管理成员') + '</div>';
  }
  d.innerHTML = inner;
  d.style.cssText = 'position:fixed;z-index:40;background:#1b2430f2;border:1px solid #ffffff33;' +
    'border-radius:10px;padding:10px 12px;box-shadow:0 4px 16px #000a;display:flex;' +
    'flex-direction:column;gap:6px;min-width:120px';
  d.style.left = Math.max(8, Math.min(innerWidth - 150, (sx || 0) - 40)) + 'px';
  d.style.top = Math.max(8, Math.min(innerHeight - 120, sy || 0)) + 'px';
  document.body.appendChild(d);
  setTimeout(function () {
    document.addEventListener('pointerdown', function once(ev) {
      if (!d.contains(ev.target)) { ptMenuClose(); document.removeEventListener('pointerdown', once); }
    });
  }, 0);
}

function ptBind() {
  var pane = document.querySelector('.tabpane[data-pane="party"]');
  if (!pane || pane.__ptBound) { return; }
  pane.__ptBound = true;
  pane.addEventListener('click', function (e) {
    var b = e.target;
    if (!b || b.tagName !== 'BUTTON') { return; }
    var op = b.getAttribute('data-pt');
    if (!op) { return; }
    e.preventDefault();
    var id = b.getAttribute('data-id');
    if (op === 'menu') {          // ★ 点名字 → 开小窗 ✓
      ptMenuOpen(id, (b.textContent || '').replace(/^\s*(队长|队员)\s*/, ''),
                 e.clientX, e.clientY);
      return;
    }
    ptMenuClose();                 // 干别的动作时顺手关掉 ✓
    /* ★ 第 84 轮：点了接受/拒绝 → 【本地立刻移除】✓ 不等服务器回包 ✗
       （用户：点击接受或拒绝后应该消失 ✓）*/
    if (op === 'acc' || op === 'dec') {
      PARTY.inv = PARTY.inv.filter(function (x) { return String(x[0]) !== String(id); });
      ptRender();
    }
    if (op === 'oka' || op === 'noa') {
      PARTY.app = PARTY.app.filter(function (x) { return String(x[0]) !== String(id); });
      ptRender();
    }
    if (op === 'inv') { partySend('invite', { cid: +id }); }
    else if (op === 'acc') { partySend('accept', { cid: +id }); }
    else if (op === 'dec') { partySend('decline', { cid: +id }); }
    else if (op === 'oka') { partySend('okapply', { cid: +id }); }
    else if (op === 'noa') { partySend('noapply', { cid: +id }); }
    else if (op === 'kick') { partySend('kick', { cid: +id }); }
    else if (op === 'promote') { partySend('promote', { cid: +id }); }
    else if (op === 'apply') { partySend('apply', { pid: b.getAttribute('data-pid') }); }
    else if (op === 'leave') { partySend('leave', {}); }
    else if (op === 'disband') { partySend('disband', {}); }
    else if (op === 'recruit') { partySend('recruit', { on: true }); }
    lobbyFetch();
  });
  var si = document.getElementById('ptSearch');
  if (si) { si.addEventListener('input', function () { _ptSearch = si.value || ''; ptRender(); }); }
  var rf = document.getElementById('ptRefresh');
  if (rf) { rf.addEventListener('click', function (e) { e.preventDefault(); lobbyFetch(); }); }
}
setInterval(function () {
  if ((SETCFG.setTab || '') === 'party' && NET.on) { lobbyFetch(); }
}, 4000);
/* ★ 第 84 轮：每秒本地重绘 → 倒计时自己走 ✓
   （用户报"剩余时间不会动"✗ 因为原来只靠服务器每秒补推算 ✓
     推送一丢就卡住 ✗ 现在拿绝对时刻本地算 ✓ 一定在动 ✓）*/
setInterval(function () {
  if ((SETCFG.setTab || '') === 'party' &&
      (PARTY.inv.length || PARTY.app.length)) { ptRender(); }
}, 1000);

function mkOpts(rowId, items, key, cur) {
  var row = document.getElementById(rowId);
  if (!row) { return; }
  row.innerHTML = '';
  for (var i = 0; i < items.length; i++) {
    (function (it) {
      var d = document.createElement('div');
      d.className = 'opt' + (cur === it.v ? ' on' : '');
      d.innerHTML = it.t + (it.s ? '<small>' + it.s + '</small>' : '');
      var pick = function (e) { if (e) { e.preventDefault(); } SETCFG[key] = it.v; saveSet(); applySet(); openSet(); };
      d.addEventListener('touchstart', pick, { passive: false });
      d.addEventListener('click', pick);
      row.appendChild(d);
    })(items[i]);
  }
}

/* ---------- 2026-10-22：交互提示统一显示（3 秒自动消失）----------
   ★ 用户要求："提示信息显示三秒后应该自动消失"
   ★ 所有 xxxPrompt 共用一份计时器；换成别的内容时重新计时 */
var _PROMPT_TIMERS = {};
var PROMPT_MS = 3000;
function showPrompt(id, text, sticky) {
  var el = document.getElementById(id);
  if (!el) { return; }
  if (_PROMPT_TIMERS[id]) { clearTimeout(_PROMPT_TIMERS[id]); _PROMPT_TIMERS[id] = null; }
  if (!text) {
    el.style.display = 'none';
    return;
  }
  el.textContent = text;
  el.style.display = 'block';
  /* ★ 2026-10-22：交互提示是"状态"，要一直显示（以前 3 秒后自己消失，玩家得走开再靠近）
     只有一次性的提示才用 3 秒自动消失。 */
  if (sticky) { return; }
  _PROMPT_TIMERS[id] = setTimeout(function () {
    _PROMPT_TIMERS[id] = null;
    try { el.style.display = 'none'; } catch (e) { }
  }, PROMPT_MS);
}
window.showPrompt = showPrompt;

/* ---------- 2026-10-22：多个可交互对象 → 点按钮弹窗选择 ----------
   ★ 用户要求："如果近距离出现多个可交互的对象，点击后就弹窗进行选择，
                 同时提示信息也合并显示"
   ★ 候选列表由 core/game.js 每帧算好（NEAR_LIST），这里只负责显示与派发。 */
var NEAR_CANDS = [];
var NEAR_SIG = '';        /* 上一次的候选签名：只在变化时弹提示 */
var NEAR_PICK_OPEN = false;
var NEAR_KIND_LABEL = {
  sit: '坐下', tp: '传送阵', sleep: '睡觉', house: '房屋',
  fridge: '冰箱', shop: '商店', warehouse: '仓库'
};
function nearPickRender() {
  var body = document.getElementById('nearPickBody');
  if (!body) { return; }
  body.innerHTML = NEAR_CANDS.map(function (c, i) {
    return '<div class="nearRow" data-near="' + i + '">' +
      '<b>' + (c.title || NEAR_KIND_LABEL[c.kind] || '交互') + '</b>' +
      '<span class="tip">' + (c.sub || '') + (c.dist != null ? ' · ' + c.dist.toFixed(1) + 'm' : '') + '</span>' +
      '</div>';
  }).join('') || '<div class="tip">附近没有可交互的东西</div>';
}
function nearPickOpen() {
  if (!NEAR_CANDS.length) { return; }
  NEAR_PICK_OPEN = true;
  var box = document.getElementById('nearPick');
  if (box) { box.style.display = 'flex'; }
  nearPickRender();
}
function nearPickClose() {
  NEAR_PICK_OPEN = false;
  var box = document.getElementById('nearPick');
  if (box) { box.style.display = 'none'; }
}
window.nearPickClose = nearPickClose;
(function nearPickBind() {
  var body = document.getElementById('nearPickBody');
  if (body && !body._bound) {
    body._bound = true;
    body.addEventListener('click', function (e) {
      var row = e.target && e.target.closest ? e.target.closest('[data-near]') : null;
      if (!row) { return; }
      window.nearPickChoose(+row.getAttribute('data-near'));
    });
  }
})();
window.nearPickChoose = function (i) {
  var c = NEAR_CANDS[+i];
  nearPickClose();
  if (!c) { return; }
  try { doNearAction(c); } catch (e) { }
};
function doNearAction(c) {
  if (!c) { return; }
  if (c.kind === 'sit') { trySit(); return; }
  if (c.kind === 'tp') { tpOpen(); return; }
  if (c.kind === 'sleep') { trySleep(); return; }
  if (c.kind === 'house') { houseOpen(); return; }
  if (c.kind === 'fridge') { fridgeOpen(c.ref && c.ref.id); return; }
  if (c.kind === 'shop') { shopOpen(); return; }
  if (c.kind === 'warehouse') { try { whOpen(); } catch (e) { } return; }
  if (c.kind === 'work') {
    /* ★ 2026-10-22：打工入口（以前 jobStart 没人调 → 按钮都不存在）*/
    try {
      if (typeof MY_JOB !== 'undefined' && MY_JOB) { jobStop(); } else { jobStart(); }
    } catch (eJ) { }
    return;
  }
}

/* 0 个：清空；1 个：沿用单项提示；多个：合并提示 + 按钮变"交互 N" */
UI.interactNear = function (list) {
  /* 坐着/睡着时由 seatState / bedNear 那套接管，别把"起身/起床"按钮冲掉 */
  if (typeof MY_SEAT !== 'undefined' && MY_SEAT) {
    /* 坐下之后提示要收掉（用户要求：坐下不需要提示） */
    ['sitPrompt', 'tpPrompt', 'shopPrompt', 'sleepPrompt', 'housePrompt', 'whPrompt']
      .forEach(function (id) { showPrompt(id, ''); });
    return;
  }
  if (typeof MY_SLEEP !== 'undefined' && MY_SLEEP) { return; }
  NEAR_CANDS = (list || []).slice();
  /* ★ 2026-10-22（用户：走近时提示"显示 3 秒后消失，再走近要重新出现"）：
     只在【候选集合变化】那一刻弹提示（进入范围 / 换成别的东西），3 秒后自己消失；
     站着不动不反复刷。 */
  var _sig = NEAR_CANDS.map(function (x) {
    return (x.kind || '') + ':' + (x.title || '');
  }).join('|');
  var _changed = (_sig !== NEAR_SIG);
  NEAR_SIG = _sig;
  var atk = document.getElementById('atk');
  var ids = ['sitPrompt', 'tpPrompt', 'shopPrompt', 'sleepPrompt',
             'housePrompt', 'whPrompt'];
  if (!NEAR_CANDS.length) {
    ids.forEach(function (id) { showPrompt(id, ''); });
    if (atk) {
      atk.classList.remove('seat', 'shop', 'sleep', 'house', 'teleport', 'interact', 'fridge', 'work');
      atk.title = '';
      var badge = document.getElementById('atkBadge');
      if (badge) { badge.style.display = 'none'; }
    }
    return;
  }
  if (NEAR_CANDS.length === 1) {
    var c = NEAR_CANDS[0];
    /* 单项：只留它自己的那个提示（其它统一关掉），行为保持原样 */
    ids.forEach(function (id) { if (id !== c.prompt) { showPrompt(id, ''); } });
    if (_changed && c.prompt) { showPrompt(c.prompt, c.text); }
    if (atk) {
      atk.classList.remove('seat', 'shop', 'sleep', 'house', 'teleport', 'interact', 'fridge', 'work');
      if (c.cls) { atk.classList.add(c.cls); }
      atk.title = c.title || '';
      var b1 = document.getElementById('atkBadge');
      if (b1) { b1.style.display = 'none'; }
    }
    return;
  }
  /* 多个：统一一条提示，按钮显示"交互 N"，点击弹选择 */
  ids.forEach(function (id) { showPrompt(id, ''); });
  var names = NEAR_CANDS.map(function (x) { return x.title || NEAR_KIND_LABEL[x.kind] || '交互'; });
  if (_changed) {
    showPrompt('sitPrompt', '附近可交互：' + names.join(' · ') + '（点按钮选择）');
  }
  if (atk) {
    atk.classList.remove('seat', 'shop', 'sleep', 'house', 'teleport', 'interact', 'fridge', 'work');
    atk.classList.add('interact');
    atk.title = '交互：' + names.join(' / ');
    var b2 = document.getElementById('atkBadge');
    if (b2) { b2.style.display = 'block'; b2.textContent = String(NEAR_CANDS.length); }
  }
  if (NEAR_PICK_OPEN) { nearPickRender(); }
};

/* ---------- UI.atkCool（攻击键的冷却表现，第 33 轮）---------- */
/* core 每帧把"还剩多少冷却"（0~1）推过来，这里只负责贴到 DOM 上 ✓
   做法：写进 --cd 变量 → CSS 里那层 conic-gradient 就转一圈 ✓
   core 那边只在变化超过 4% 时才调，所以这里不用再做节流 ✓ */
UI.atkCool = function (p) {
  var el = document.getElementById('atk');
  if (!el) { return; }
  if (!(p > 0)) { p = 0; }
  if (p > 1) { p = 1; }
  el.style.setProperty('--cd', String(p));
  el.className = (p > 0.001) ? 'cool' : 'ready';
};

/* ---------- setTab（设置面板的分类导航）---------- */
/* ★ 第 31 轮加的：设置项变多了，堆一屏又长又难找 →
   顶部分类（画面/操作/音效/调试/信息），点哪类显示哪页 ✓
   停在哪个分类会记住（SETCFG.setTab）→ 下次打开还在原地 ✓ */
/* ★★ 第 115 轮（用户："滑动不了"）★★
   根因：桌面端【鼠标滚轮是纵向的】✗
        而我在 #setTabs 上把纵向隐藏了（overflow-y:hidden ✓）
        → 滚轮事件没有可滚动方向 → 什么也不发生 ✓✓ 用户："滑动不了"✓
        （CSS 的 overflow-x:auto 只在【触屏拖动】和【shift+滚轮】下才响应 ✗
          鼠标用户根本不知道要按 shift ✗ 这是网页横向滚动最常见的坑 ✓）
   修三件事：
     ① 鼠标【按住拖动】可以滑 ✓（最直觉 ✓）
     ② 滚轮直接横滑 ✓（不用按 shift ✓）
     ③ 拖动时不要误触发"点了某个页签"✗（位移超过 5px 就吞掉这次点击 ✓）
   ★ 注意用 window 上挂 move/up ✗ 不是元素上 ✗
     否则鼠标拖出元素范围就断了 ✓（手感会一卡一卡的 ✗）*/
var _tabDrag = null;
/* ★ 第 169 轮（用户 #3）：滚动提示的开关
   能往右滚 → 显示渐隐 + 箭头 ✓
   已经滚到尾或者根本不用滚 → 收掉 ✗（不然一直闪很烦 ✗）*/
function setTabsHintUpd() {
  var wrap = document.getElementById('setTabsWrap');
  var box = document.getElementById('setTabs');
  if (!wrap || !box) { return; }
  var can = (box.scrollWidth - box.clientWidth) > 6;
  var atEnd = (box.scrollLeft + box.clientWidth) >= (box.scrollWidth - 6);
  if (can && !atEnd) { wrap.classList.remove('on'); } else { wrap.classList.add('on'); }
}
function tabScrollInit() {
  var _sb = document.getElementById('setTabs');
  if (_sb && !_sb._hint) { _sb._hint = true; _sb.addEventListener('scroll', setTabsHintUpd); }
  if (!window._hintRz) { window._hintRz = true; addEventListener('resize', setTabsHintUpd); }
  setTabsHintUpd();                                     // ★ 第 169 轮：初始化时先算一次 ✓
  var box = document.getElementById('setTabs');
  if (!box || box._dragOk) { return; }
  box._dragOk = true;

  box.addEventListener('pointerdown', function (e) {
    _tabDrag = { x: e.clientX, sl: box.scrollLeft, moved: 0, id: e.pointerId };
    try { box.setPointerCapture(e.pointerId); } catch (e2) { }
  });
  window.addEventListener('pointermove', function (e) {
    if (!_tabDrag) { return; }
    var dx = e.clientX - _tabDrag.x;
    if (Math.abs(dx) > _tabDrag.moved) { _tabDrag.moved = Math.abs(dx); }
    if (_tabDrag.moved > 5) {
      box.scrollLeft = _tabDrag.sl - dx;
      box.style.cursor = 'grabbing';
    }
  });
  /* ★ 第 172 轮（用户：导航可以按着不松手滑动）：
     补两个场景 —— 手指滑出屏幕/被系统打断时，拖动状态要清掉 ✗
     不然会"卡在拖动中" ✓ 之后点页签全都不灵 ✓ */
  window.addEventListener('pointercancel', function () {
    _tabDrag = null;
    box.style.cursor = '';
  });
  box.addEventListener('dragstart', function (e) { e.preventDefault(); });   /* 别触发浏览器原生拖拽 ✓ */
  window.addEventListener('pointerup', function () {
    if (_tabDrag && _tabDrag.moved > 5) {
      /* ★ 拖过就不能算"点击"✗ 否则想滑一下结果切到了别的页签 ✓ */
      box._swallow = true;
      setTimeout(function () { box._swallow = false; }, 60);
    }
    _tabDrag = null;
    box.style.cursor = '';
  });
  /* ③ 吞掉"拖动结束时的那次点击" ✓（捕获阶段 ✓ 比页签自己的监听更早 ✓）*/
  box.addEventListener('click', function (e) {
    if (box._swallow) { e.stopPropagation(); e.preventDefault(); }
  }, true);
  /* ② 滚轮横滑 ✓ */
  box.addEventListener('wheel', function (e) {
    var d = (Math.abs(e.deltaX) > Math.abs(e.deltaY)) ? e.deltaX : e.deltaY;
    if (!d) { return; }
    var before = box.scrollLeft;
    box.scrollLeft += d;
    if (box.scrollLeft !== before) { e.preventDefault(); }   // 还有得滑才拦 ✓ 到底了放行 ✓
  }, { passive: false });
  box.style.cursor = 'grab';
}
/* ★★★ round424：排行榜页（用户要求放在设置里 ✗ 不占主菜单 ✓）
   · 数据走 HTTP /api/rank（只读 ✓ 离线也能看 ✓）
   · 前 100 名 · 每页 10 个 · 底部「我的名次」永远显示（用户定 ✓）
   · 15 秒刷一次（只在排行页开着时 ✓）*/
var RANK = { board: 'level', page: 1, data: null, ts: 0, timer: 0, busy: false };
var RANK_NAME = { level: '境界', gold: '财富', kills: '屠戮', mq: '魔气', time: '在线', charm: '魅力' };
var RANK_KEYS = ['level', 'gold', 'kills', 'mq', 'time', 'charm'];

function rankEsc(t) {
  return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

function rankApi(qs) {
  var tk = (typeof WSC !== 'undefined' && WSC.token) ? WSC.token : '';
  var h = tk ? { 'X-Token': tk } : {};
  return fetch('/api/rank' + (qs || ''), { headers: h, cache: 'no-store' })
    .then(function (r) { return r.json(); });
}

function rankChipsRender() {
  var box = document.getElementById('rankChips');
  if (!box) { return; }
  box.innerHTML = '';
  for (var i = 0; i < RANK_KEYS.length; i++) {
    (function (k) {
      var d = document.createElement('div');
      d.className = 'rchip' + (RANK.board === k ? ' on' : '');
      d.textContent = RANK_NAME[k];
      d.onclick = function () {
        RANK.board = k; RANK.page = 1; rankChipsRender(); rankFetch(true);
      };
      box.appendChild(d);
    })(RANK_KEYS[i]);
  }
}

function rankRowsRender() {
  var list = document.getElementById('rankList');
  if (!list) { return; }
  var d = RANK.data || {};
  var rows = d.rows || [];
  var me = d.me || null;
  list.innerHTML = '';
  if (!rows.length) {
    list.innerHTML = '<div style="padding:14px;color:#7b8794;font-size:12.5px">' +
      '还没有人上榜（打几只怪、玩一会儿就有了 ✓）</div>';
  }
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var isMe = !!(me && me.r === r.r);
    var row = document.createElement('div');
    row.className = 'rrow' + (isMe ? ' me' : '');
    var medal = r.medal || 0;
    /* ★ round425：奖牌用自画的 SVG（金/银/铜 ✓ 不依赖字体/emoji ✓）*/
    var rk = (medal ? medalSvg(medal, 14) : '') + r.r;
    row.innerHTML =
      '<div class="rk' + (medal ? ' m' + medal : '') + '">' + rk + '</div>' +
      '<div class="rn">' + rankEsc(r.name || '?') +
      (r.on ? ' <span class="on">在线</span>' : '') + '</div>' +
      '<div class="rv">' + rankEsc(r.sub || '') + '</div>';
    list.appendChild(row);
  }
  var meEl = document.getElementById('rankMe');
  if (meEl) {
    if (me && me.r > 0) {
      meEl.innerHTML = '我的名次：<b>#' + me.r + '</b> / ' + (d.total || '?') +
        (me.in100 ? '' : '（没进前 100 → 头顶不显示称号）');
    } else {
      meEl.innerHTML = '我的名次：未上榜（先进游戏吧 ✓）';
    }
  }
  var pages = d.pages || 10;
  var txt = document.getElementById('rankPageTxt');
  if (txt) { txt.textContent = '第 ' + (RANK.page || 1) + '/' + pages + ' 页'; }
  var prev = document.getElementById('rankPrev'), next = document.getElementById('rankNext');
  if (prev) { prev.disabled = (RANK.page <= 1); }
  if (next) { next.disabled = (RANK.page >= pages); }
  var tag = document.getElementById('rankTag');
  if (tag) { tag.textContent = '服务器缓存 ' + (d.cacheAge || 0) + ' 秒前'; }
  /* ★★ round425（用户："显示什么称号可以选择，现在只能选择境界排行"）★★
     原来是个勾选框 ✗ 只会挂【当前正在看的那一页】✗ 想换榜要先取消再勾 ✓ 反人类 ✓
     → 现在是一排按钮：【不显示】+ 五个榜，点哪个就挂哪个 ✓ */
  var cur = (typeof WSC !== 'undefined' && WSC.role && WSC.role.titleBoard) ? WSC.role.titleBoard : '';
  rankTitleChipsRender(me, cur);
  var tip = document.getElementById('rankTitleTip');
  if (tip) {
    if (!me || me.r <= 0) { tip.textContent = ''; }
    else if (!me.in100) { tip.textContent = '没进前 100，不能挂称号'; }
    else if (cur && cur.indexOf('skin:') === 0) { tip.textContent = '当前：皮肤称号（独占期间有效）'; }
    else if (cur) { tip.textContent = '当前：国服' + (RANK_NAME[cur] || '') + 'top' + me.r; }
    else { tip.textContent = '当前：不显示'; }
  }
}

/* 头顶称号的那排按钮（★ 每个榜都能选 ✓ 第一个是"不显示" ✓）*/
function rankTitleChipsRender(me, cur) {
  var box = document.getElementById('rankTitleChips');
  if (!box) { return; }
  var can = !!(me && me.in100);
  var opts = [['', '不显示']].concat(RANK_KEYS.map(function (k) { return [k, RANK_NAME[k]]; }));
  /* ★ round489：我独占的皮肤 → 也能挂"独·XXX"称号 ✓ 没独占就没有这一档 ✓ */
  var _solo = [];
  for (var _si = 0; _si < (SKIN.items || []).length; _si++) {
    var _it = SKIN.items[_si];
    if (_it && _it.solo) { _solo.push(['skin:' + _it.k, '独·' + (_it.n || _it.k)]); }
  }
  opts = opts.concat(_solo);
  box.innerHTML = '';
  for (var i = 0; i < opts.length; i++) {
    (function (k, label) {
      var el = document.createElement('div');
      var on = (cur || '') === k;
      el.className = 'tchip' + (on ? ' on' : '') + ((k && !can) ? ' off' : '');
      el.textContent = label;
      el.onclick = function () {
        if (k && !can && k.indexOf('skin:') !== 0) { toast('没进前 100，不能挂称号'); return; }
        try { wsSend('ranktitle', { board: k }); } catch (e) { }
        el.classList.add('off');
      };
      box.appendChild(el);
    })(opts[i][0], opts[i][1]);
  }
}

function rankFetch(force) {
  if (!force && RANK.busy) { return; }
  RANK.busy = true;
  rankApi('?board=' + encodeURIComponent(RANK.board) + '&page=' + RANK.page + '&size=10')
    .then(function (d) {
      RANK.busy = false;
      if (!d || !d.ok) {
        var list = document.getElementById('rankList');
        if (list) {
          list.innerHTML = '<div style="padding:12px;color:#ff9a5c">拉榜单失败：' +
            rankEsc((d && d.error) || '?') + '</div>';
        }
        return;
      }
      RANK.data = d;
      rankRowsRender();
    })
    .catch(function () {
      RANK.busy = false;
      var list = document.getElementById('rankList');
      if (list) { list.innerHTML = '<div style="padding:12px;color:#ff9a5c">连不上服务器</div>'; }
    });
}

function rankBindOnce() {
  if (rankBindOnce._ok) { return; }
  rankBindOnce._ok = true;
  var b = document.getElementById('rankRefresh');
  if (b) { b.onclick = function () { rankFetch(true); }; }
  var p = document.getElementById('rankPrev');
  if (p) { p.onclick = function () { if (RANK.page > 1) { RANK.page--; rankFetch(true); } }; }
  var n = document.getElementById('rankNext');
  if (n) {
    n.onclick = function () {
      var pages = (RANK.data && RANK.data.pages) || 10;
      if (RANK.page < pages) { RANK.page++; rankFetch(true); }
    };
  }
  /* ★ round425：称号那排按钮在自己的渲染函数里绑事件 ✗ 这里不用再绑 ✓ */
  if (!RANK.timer) {
    RANK.timer = setInterval(function () {
      if ((SETCFG.setTab || '') === 'rank') { rankFetch(false); }
    }, 15000);
  }
}

/* ★ round424/425：头顶称号设置的回执 */
function rankOnTitleOk(d) {
  d = d || {};
  try { if (WSC.role) { WSC.role.titleBoard = d.board || ''; } } catch (e) { }
  /* ★ 重新画那排按钮（高亮当前那个 ✓）*/
  var me = null;
  try { me = (RANK.data && RANK.data.me) || null; } catch (e) { }
  if (typeof rankTitleChipsRender === 'function') {
    rankTitleChipsRender(me, d.board || '');
  }
  var tip = document.getElementById('rankTitleTip');
  if (tip) {
    tip.textContent = d.text ? ('当前：' + d.text) : '当前：不显示';
  }
  toast(d.text ? ('头顶称号：' + d.text) : '已关闭头顶称号');
}

/* ★★ round531：设置的二级导航（画面 / 操作 / 音效）
   ★ 点一下切到对应的 tabpane ✗ 顶部那排大 tab 仍然同步 ✓ */
function setSubBind() {
  var boxs = document.querySelectorAll('#setPanel .setSub');
  for (var i = 0; i < boxs.length; i++) {
    (function (box) {
      if (box._b) { return; }
      box._b = true;
      box.addEventListener('click', function (e) {
        var t = e.target, hit = null;
        while (t && t !== box) {
          if (t.getAttribute && t.getAttribute('data-sub')) { hit = t; break; }
          t = t.parentNode;
        }
        if (!hit) { return; }
        var k = hit.getAttribute('data-sub');
        /* 二级导航真正切页：只显示 画面 / 操作 / 音效 中的一页 */
        try { setTab(k); } catch (e2) { }
        try { setSubPaint(); } catch (e3) { }
        try {
          var sc = document.getElementById('setBody');
          if (sc) { sc.scrollTop = 0; }
        } catch (e4) { }
      });
    })(boxs[i]);
  }
  setSubPaint();
}
function setSubPaint() {
  var cur = (SETCFG && SETCFG.setTab) || 'view';
  var boxs = document.querySelectorAll('#setPanel .setSub');
  for (var i = 0; i < boxs.length; i++) {
    var subs = boxs[i].querySelectorAll('.sub');
    for (var j = 0; j < subs.length; j++) {
      var on = (subs[j].getAttribute('data-sub') === cur);
      subs[j].className = 'sub' + (on ? ' on' : '');
    }
  }
}


/* ===================================================================
   技能面板（round538）
   ★ 只负责【看 / 学 / 装配 / 遗忘】，技能效果在 P2 才接
   =================================================================== */
var MY_QI = 0, MY_QIMAX = 100;
var MY_SHIELD = 0;      // ★ round588：护盾量（技能图标上显示 1k）
var MY_GALE_T = 0;      // ★ round588：疾风步剩余秒（动态残影）
var MY_BERSERK_T = 0;   // ★ round592：暴走剩余秒（红色残影）
var MY_BLOODRAGE_T = 0; // ★ round593：血怒剩余秒（持续光环）
var MY_PLAGUE = 0;      // ★ round594：病毒扩散开关（绿色齿轮）
var MY_SHIELD_T = 0, MY_BLOODTHIRST_T = 0;   // ★ 持续 buff 进度条
var MY_SKDUR_MUL = 1.0;                       // ★ 技能持续被动倍率
var SKCD = {};          /* {技能key: 剩余秒} */
var SKBAR_BAD = false;
var SK = { defs: [], byKey: {}, learn: {}, load: { A: [], B: [], C: [] },
           kind: 'A', forget: false, msg: '' };


/* ===================================================================
   技能栏（round550）：主动第一排 5 格
   ★ 点一下 = 自动打最近的怪（服务端选目标）
   ★ 收到 skillfx → 用 vfx.js 播动画（别人也看到同一套 ✓）
   =================================================================== */

/* ===================================================================
   技能落点指示圈（round551）
   ★ 画面上的圈只是"给你看"✗ 真正的落点以服务端夹紧后的为准 ✓
   =================================================================== */
var _skInd = { g: null, ring: null, max: null, def: null };
function skGround(x, y) {
  try {
    if (typeof cam === 'undefined' || !cam) { return null; }
    var nx = (x / innerWidth) * 2 - 1, ny = -(y / innerHeight) * 2 + 1;
    var rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(nx, ny), cam);
    var pl = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    var pt = new THREE.Vector3();
    var hit = rc.ray.intersectPlane(pl, pt);
    return hit ? { x: pt.x, z: pt.z } : null;
  } catch (e) { return null; }
}
function skIndicatorShow(key) {
  var sc = (typeof scene !== 'undefined') ? scene : null;
  var d = (SK.byKey || {})[key] || {};
  if (!sc) { return; }
  skIndicatorHide();
  var g = new THREE.Group();
  var r = Math.max(1, d.r || 3);
  var rg = Math.max(r + 1, d.rg || r + 3);
  var m1 = new THREE.Mesh(new THREE.RingGeometry(r - 0.12, r, 48),
    new THREE.MeshBasicMaterial({ color: 0xffd83d, transparent: true, opacity: 0.85,
      side: THREE.DoubleSide, depthWrite: false }));
  m1.rotation.x = -Math.PI / 2; m1.position.y = 0.06; g.add(m1);
  var fill = new THREE.Mesh(new THREE.CircleGeometry(r, 48),
    new THREE.MeshBasicMaterial({ color: 0xffd83d, transparent: true, opacity: 0.12,
      side: THREE.DoubleSide, depthWrite: false }));
  fill.rotation.x = -Math.PI / 2; fill.position.y = 0.05; g.add(fill);
  var m2 = new THREE.Mesh(new THREE.RingGeometry(rg - 0.06, rg, 64),
    new THREE.MeshBasicMaterial({ color: 0x8ecbff, transparent: true, opacity: 0.55,
      side: THREE.DoubleSide, depthWrite: false }));
  m2.rotation.x = -Math.PI / 2; m2.position.y = 0.04; g.add(m2);
  sc.add(g);
  _skInd = { g: g, ring: m1, max: m2, def: d, fill: fill };
}
function skIndicatorMove(x, y) {
  var pt = skGround(x, y);
  if (!pt || !_skInd.g) { return pt; }
  var d = _skInd.def || {};
  var px = 0, pz = 0;
  try { px = P.x; pz = P.z; } catch (e) { }
  var rg = Math.max(1, d.rg || 0);
  var dx = pt.x - px, dz = pt.z - pz;
  var dist = Math.hypot(dx, dz);
  if (rg > 0 && dist > rg) {                 /* 超出射程 → 贴在边界 */
    pt.x = px + dx / dist * rg;
    pt.z = pz + dz / dist * rg;
  }
  _skInd.g.position.set(pt.x, 0, pt.z);
  return pt;
}
function skIndicatorHide() {
  if (_skInd.g) {
    try { _skInd.g.parent && _skInd.g.parent.remove(_skInd.g); } catch (e) { }
  }
  _skInd = { g: null };
}

function skBarRender() {
  var box = document.getElementById('skBar');
  if (!box) { return; }
  if (typeof SK === 'undefined' || !SK.load) { return; }

  var layout = 'row', hideA = false;
  try {
    layout = localStorage.getItem('skBarLayout') || 'row';
    hideA = (localStorage.getItem('skHideA') === '1');
  } catch (e) { }
  box.style.flexDirection = (layout === 'row') ? 'column' : 'row';

  /* ★ round555（用户要求）：
     ① 主动：只显示【装了的】✗ 空格子不再占位 ✓ 可整体隐藏
     ② 被动 / 被动加成：平时不显示 ✗ 触发时才冒出来 ✓
     ③ 格子更透（半透明底）✓ */
  var SLOT = 'width:34px;height:34px;border-radius:8px;overflow:hidden;position:relative;' +
    'background:#0d141c66;backdrop-filter:blur(2px);';

  function skShort(v) {
    v = Math.max(0, Math.round(+v || 0));
    if (v < 1000) { return String(v); }
    var n = v / 1000;
    return (n >= 10 ? Math.round(n) : (Math.round(n * 10) / 10)) + 'k';
  }
  function icon(k, kind, glow, cd, poor, dim) {
    var ic = (window.SKI ? SKI.icon(k, kind, 34) : '');
    return '<div data-skcast="' + k + '" data-skkind="' + kind + '" style="' + SLOT +
      'cursor:' + (kind === 'A' ? 'pointer' : 'default') + ';touch-action:none;' +
      'border:1.5px solid ' + (glow ? '#8ee0a8' : (poor ? '#ff5a4a99' : '#ffffff1f')) + ';' +
      (glow ? 'box-shadow:0 0 10px #8ee0a8aa;' : '') +
      /* ★ round575（用户："技能图标改成不透明的"）
         → 图标和格子都 100% 不透明 ✓
         ★ "灵气不够"不再靠整体变淡提示 ✗ 靠红色边框 + 冷却数字 ✓ */
      'opacity:1">' +
      '<img src="' + ic + '" style="width:100%;height:100%;display:block;opacity:1">' +
      /* ★ round588：灵能护盾剩余护盾量直接显示在图标底部（1000 → 1k）*/
      (k === 'shield' && MY_SHIELD > 0 ? ('<div style="position:absolute;left:0;right:0;bottom:0;' +
        'text-align:center;font-size:9px;line-height:11px;font-weight:900;color:#bdefff;' +
        'background:#001a2acc;text-shadow:0 1px 2px #000;z-index:2">' +
        skShort(MY_SHIELD) + '</div>') : '') +
      (cd > 0 ? ('<div style="position:absolute;inset:0;background:#00000088;display:flex;' +
        'align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:800">' +
        Math.ceil(cd) + '</div>') : '') +
      '</div>';
  }

  var h = '';
  /* 小工具条（透明，只有图标）*/
  /* ★★ round560（用户："就用把手当隐藏按钮，不要多余按钮"）
     → 把手「⠿⠿」点一下 = 收起/展开；按住拖 = 移动 ✓
       （用位移判断：< 4px 算点击 ✓ 否则算拖动 ✓）*/
  /* ★ round561（用户："点 ⠿⠿ 隐藏时把横排按钮一起隐藏，横排按钮放到 ⠿⠿ 下方"）
     → 竖着排：上面把手 ✗ 下面布局键 ✓；收起时【连布局键一起收】✓ */
  h += '<div style="display:flex;flex-direction:column;gap:3px;align-items:flex-start;' +
    'margin-bottom:4px;opacity:0.7">' +
    '<div id="skGrip" title="点一下收起 / 按住拖动" style="cursor:pointer;padding:2px 7px;' +
    'border-radius:6px;background:#0d141c99;color:' + (hideA ? '#8ee0a8' : '#c9d6e4') + ';' +
    'font-size:11px;line-height:1;letter-spacing:1px;user-select:none;touch-action:none">' +
    (hideA ? '⠿ 展开' : '⠿⠿') + '</div>' +
    (hideA ? '' : ('<div id="skLayoutBtn" style="font-size:10px;color:#c9d6e4;cursor:pointer;' +
      'padding:1px 6px;border-radius:5px;background:#0d141c88">' +
      (layout === 'row' ? '竖排' : '横排') + '</div>')) +
    '</div>';

  /* ① 主动排（可隐藏 · 只显示装了的）*/
  if (!hideA) {
    var sa = (SK.load.A || []);
    var rowA = '';
    for (var i = 0; i < sa.length; i++) {
      var k = sa[i];
      if (!k) { continue; }
      var d = (SK.byKey || {})[k] || {};
      rowA += icon(k, 'A', false, SKCD[k] || 0, MY_QI < (d.qi || 0), false);
    }
    if (rowA) {
      h += '<div class="skRow" data-skrow="A" style="display:flex;gap:6px;' +
        'flex-direction:' + (layout === 'row' ? 'row' : 'column') + '">' + rowA + '</div>';
    }
  }

  /* ② 被动释放 + 被动加成：只有【正在触发】的才显示 */
  function trigRow(kind) {
    var sl = (SK.load[kind] || []), out = '';
    for (var j = 0; j < sl.length; j++) {
      var kk = sl[j];
      if (!kk || !(SK_TRIG[kk] > 0)) { continue; }
      out += icon(kk, kind, true, 0, false, false);
    }
    if (!out) { return ''; }
    return '<div class="skRow" data-skrow="' + kind + '" style="display:flex;gap:6px;' +
      'flex-direction:' + (layout === 'row' ? 'row' : 'column') + '">' + out + '</div>';
  }
  h += trigRow('B');
  h += trigRow('C');

  if (box._lastHtml === h) { return; }
  box._lastHtml = h;
  box.innerHTML = h;

  var lb = document.getElementById('skLayoutBtn');
  if (lb) {
    lb.onclick = function (e) {
      e.stopPropagation();
      var _ly = 'row';
      try { _ly = localStorage.getItem('skBarLayout') || 'row'; } catch (e9) { }
      try { localStorage.setItem('skBarLayout', _ly === 'row' ? 'col' : 'row'); } catch (e3) { }
      skBarRender();
    };
  }

  if (!box._b) {
    box._b = true;
    var mv = null;
    box.addEventListener('pointerdown', function (e) {
      /* ★ round562（用户："技能框要点击键位后才能移动"）
         → 只有 UI 编辑模式才允许拖整排 ✓（平时按到空白处就当没事）*/
      if (typeof UI_EDIT !== 'undefined' && !UI_EDIT) {
        if (e.target && e.target.id === 'skGrip') { /* 把手仍然可以点（收起）*/ }
        else { return; }
      }
      if (e.target && e.target.getAttribute && e.target.getAttribute('data-skcast')) { return; }
      if (e.target && e.target.id === 'skLayoutBtn') { return; }
      var r = box.getBoundingClientRect();
      mv = { x: e.clientX, y: e.clientY, l: r.left, t: r.top, id: e.pointerId, moved: 0,
             onGrip: !!(e.target && e.target.id === 'skGrip'),
             allowMove: (typeof UI_EDIT !== 'undefined' && !!UI_EDIT) }
      try { box.setPointerCapture(e.pointerId); } catch (e0) { }
    });
    document.addEventListener('pointermove', function (e) {
      if (!mv) { return; }
      var dx = e.clientX - mv.x, dy = e.clientY - mv.y;
      mv.moved = Math.max(mv.moved, Math.hypot(dx, dy));
      if (!mv.allowMove || mv.moved < 3) { return; }
      box.style.left = Math.max(0, Math.min(innerWidth - 60, mv.l + dx)) + 'px';
      box.style.top = Math.max(0, Math.min(innerHeight - 60, mv.t + dy)) + 'px';
      box.style.bottom = 'auto';
    });
    document.addEventListener('pointerup', function () {
      if (!mv) { return; }
      if (mv.moved >= 3) {
        if (mv.allowMove) {
          try { localStorage.setItem('skBarPos', JSON.stringify({ l: box.style.left, t: box.style.top })); } catch (e1) { }
        }
      } else if (mv.onGrip) {
        /* ★ 点把手（没拖动）= 收起 / 展开 ✓
           ★ 必须读【当前】localStorage ✗ 不能用闭包里的 hideA（那是首帧的值 ✓）*/
        var _h = false;
        try { _h = (localStorage.getItem('skHideA') === '1'); } catch (e3) { }
        try { localStorage.setItem('skHideA', _h ? '0' : '1'); } catch (e4) { }
        skBarRender();
      }
      mv = null;
    });

    var drag = null;
    function slotOf(el) {
      var t = el;
      while (t && t !== box) {
        if (t.getAttribute && t.getAttribute('data-skcast')) { return t; }
        t = t.parentNode;
      }
      return null;
    }
    box.addEventListener('pointerdown', function (e) {
      var el = slotOf(e.target);
      if (!el) { return; }
      if ((el.getAttribute('data-skkind') || 'A') !== 'A') { return; }
      var k = el.getAttribute('data-skcast');
      if ((SKCD[k] || 0) > 0) { return; }
      /* ★ round587：直接释放类（灵能护盾/燃血斩）不进入拖动 */
      try {
        var _sd = (typeof SK !== 'undefined' && SK.byKey) ? SK.byKey[k] : null;
        if (_sd && _sd.cast === 'self') {
          wsSend('skillcast', { key: k });
          return;
        }
      } catch (eSd) { }
      drag = { key: k, x: e.clientX, y: e.clientY, t: performance.now(), moved: 0,
               el: el, id: e.pointerId };
      window._skDrag = drag;
      try { el.setPointerCapture(e.pointerId); } catch (e2) { }
      skIndicatorShow(k);
      skIndicatorMove(e.clientX, e.clientY);
    });
    document.addEventListener('pointermove', function (e) {
      if (!drag) { return; }
      drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.x, e.clientY - drag.y));
      skIndicatorMove(e.clientX, e.clientY);
    });
    function endDrag(e) {
      if (!drag) { return; }
      var d = drag; drag = null; window._skDrag = null;
      var dt = performance.now() - d.t;
      var isTap = (d.moved < 12 && dt < 350);
      var pt = isTap ? null : skIndicatorMove(e.clientX, e.clientY);
      skIndicatorHide();
      try {
        if (isTap) { if (typeof MY_JOB === 'undefined' || !MY_JOB) { wsSend('skillcast', { key: d.key }); } }
        else if (pt) { if (typeof MY_JOB === 'undefined' || !MY_JOB) { wsSend('skillcast', { key: d.key, x: pt.x, z: pt.z }); } }
        else { wsSend('skillcast', { key: d.key }); }
      } catch (e3) { }
    }
    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', function () {
      drag = null; window._skDrag = null; skIndicatorHide();
    });
  }
}

/* skillfx：服务端广播的特效（含自己 ✓）→ 调 vfx.js 播 */
var _fxPend = [];
var _myGaleFx = null, _myShieldFx = null;   // ★ round587：跟随自己的持续特效
var _myBerserkFx = null;                    // ★ round592：暴走自身特效
var _myBloodrageFx = null;                  // ★ round593：血怒持续光环
var _myIceFx = null;                        // ★ round593：自身冰封冰块
var _myTankFx = null;                       // ★ round593：坦克体型光环
var _myPlagueFx = null;                     // ★ round594：病毒扩散绿色齿轮
var _galeAcc = 0, _galeLX = null, _galeLZ = null;   // ★ round588：动态残影
/* ★★★ round572（用户："分身头顶的名字和血条要和玩家那套一模一样"）★★★
   ★ 旧做法（已删）：自己用 THREE.Sprite + PlaneGeometry 画 3D 名牌/血条
     → 字号、条宽、绿色渐变、血量数字全和玩家不一样 ✗
   ★ 新做法：**整条复用玩家那一套** ✗ 一行样式都不自己写 ✓
     · 模型：hero()（和本体同一个构建器 ✓ 体型天然一致 ✓）
     · 名牌：mkMobUI()（其他玩家用的就是它 ✓ 同名/同条/同数字 ✓）
     · 位置：每帧 project(cam) + UI.plate.move（和 netUpdate 里那段一字不差 ✓）
     · 血量：直接读"主人本人"的 HP/HPMAX → 和本体那块牌完全相同 ✓
   ★ 铁律：这里只准调用 core 已有的构建器 / 动画函数 ✗ 不准再手搓 Sprite ✓ */
var CLONES = {};
var _skcV3 = null;

/* 分身的"主人"血量（显示和本人一致 ✓）
   ★ 自己的分身：读本地 HP/HPMAX ✓
   ★ 别人的分身：读 NET.others[role_id]（服务器快照里的权威血量 ✓）*/
function skCloneOwnerHp(owner) {
  if (owner == null) { return null; }
  try {
    if (typeof WSC !== 'undefined' && WSC && WSC.myId != null &&
        String(WSC.myId) === String(owner)) {
      return {
        hp: (typeof HP === 'number') ? HP : 100,
        mx: (typeof HPMAX === 'number' && HPMAX > 0) ? HPMAX : 100
      };
    }
    var o = (typeof NET !== 'undefined' && NET.others) ? NET.others[owner] : null;
    if (o) {
      return {
        hp: (typeof o.hp === 'number') ? o.hp : 100,
        mx: (typeof o.hpMax === 'number' && o.hpMax > 0) ? o.hpMax : 100
      };
    }
  } catch (e) { }
  return null;
}

/* 真正移除（淡出结束后 / 没有模型时）*/
function skCloneRemove(cid) {
  var g = CLONES[cid];
  if (!g) { return; }
  try { if (g._ui && typeof UI !== 'undefined' && UI.plate) { UI.plate.remove(g._ui); } } catch (e1) { }
  try { if (typeof scene !== 'undefined' && scene) { scene.remove(g); } } catch (e2) { }
  delete CLONES[cid];
}

/* ★★★ round573（用户："补一个 AI 分身消失的淡出动画"）★★★
   · 模型：材质 opacity 从原值（0.78 / 兜底 0.55）线性降到 0 ✓ 0.5 秒
   · 名牌：同一个时长淡出（用 opacity ✗ 不用 display
     —— display 会被 skClonePlate / UI.plate.show 每帧覆盖，opacity 不会 ✓）
   · 淡出期间【不再走、不再挥刀、不再更新名牌】✓ 只做一件事：变淡 ✓
   · 到 0 才真正 scene.remove + 移除名牌 div ✓（不留孤儿 ✓）*/
var SK_CLONE_FADE = 0.5;
function skCloneDrop(cid) {
  var g = CLONES[cid];
  if (!g) { return; }
  if (g._dying != null) { return; }         // 已经在淡出了 ✗ 不重来 ✓
  g._dying = 0;
  g._fadeMats = [];
  try {
    g.traverse(function (o) {
      if (!o.isMesh || !o.material) { return; }
      var m = o.material;
      for (var i = 0; i < g._fadeMats.length; i++) {
        if (g._fadeMats[i].m === m) { return; }   // 同一份材质只记一次 ✓
      }
      m.transparent = true;
      g._fadeMats.push({ m: m, o: (typeof m.opacity === 'number') ? m.opacity : 0.78 });
    });
  } catch (e0) { }
  try {
    if (g._ui && g._ui.wrap) {
      g._ui.wrap.style.transition = 'opacity ' + SK_CLONE_FADE + 's linear';
      g._ui.wrap.style.opacity = '0';
    }
  } catch (e1) { }
}
function skCloneFadeTick(g, dt, cid) {
  g._dying += dt;
  var k = Math.min(1, g._dying / SK_CLONE_FADE);
  var a = 1 - k;
  try {
    for (var i = 0; i < g._fadeMats.length; i++) {
      g._fadeMats[i].m.opacity = g._fadeMats[i].o * a;
    }
  } catch (e) { }
  if (k >= 1) { skCloneRemove(cid); }
}

/* 头顶名牌：照抄其他玩家那条路（mkMobUI + 每帧投影到屏幕 ✓）*/
function skClonePlate(g) {
  var ui = g._ui;
  if (!ui) { return; }
  if (typeof cam === 'undefined' || !cam || typeof THREE === 'undefined') { return; }
  if (!_skcV3) { _skcV3 = new THREE.Vector3(); }
  var py = (typeof heroPlateY === 'function')
    ? heroPlateY({ h: g._h }) : ((g._h || 2.97) * 0.42 + 0.61);
  _skcV3.set(g.position.x, py, g.position.z).project(cam);
  var vis = (_skcV3.z > -1 && _skcV3.z < 1 &&
             Math.abs(_skcV3.x) < 1.35 && Math.abs(_skcV3.y) < 1.5);
  UI.plate.show(ui, vis);
  if (!vis) { return; }
  var sx = (_skcV3.x * 0.5 + 0.5) * innerWidth;
  var sy = (-_skcV3.y * 0.5 + 0.5) * innerHeight;
  var _ox = sx | 0, _oy = sy | 0;
  if (g._mvx !== _ox || g._mvy !== _oy) {
    g._mvx = _ox; g._mvy = _oy;
    UI.plate.move(ui, sx, sy);
  }
  /* ★ round575：优先用【分身自己的血】✓ 服务器没带才退回显示主人的血 */
  var hp, mx;
  if (typeof g._hp === 'number' && typeof g._hpm === 'number' && g._hpm > 0) {
    hp = g._hp; mx = g._hpm;
  } else {
    var inf = skCloneOwnerHp(g._owner);
    hp = inf ? inf.hp : 100; mx = inf ? inf.mx : 100;
  }
  var pct = Math.max(0, Math.min(100, hp / Math.max(1, mx) * 100));
  var pi = Math.round(pct);
  if (g._hpi !== pi) { g._hpi = pi; UI.plate.hpWidth(ui, pi + '%'); }
  if (g._hpc !== 1) {
    g._hpc = 1;
    UI.plate.hpColor(ui, (typeof BAR_PLR === 'string')
      ? BAR_PLR : 'linear-gradient(180deg,#7ee08a,#3aa04a)');
  }
  var bt = String(Math.max(0, Math.round(hp)));
  if (g._bts !== bt) { g._bts = bt; UI.plate.barText(ui, bt, '#fff', 10); }
}

/* 每帧：位置插值 + 走路 + 挥刀 + 名牌
   ★ 原来的 40ms setInterval 已删 ✗ 改成跟主循环同一帧率 ✓
     （不然走路是一顿一顿的 ✗ 而且和动画不同步 ✓）*/
function skCloneTick(dt) {
  var now = performance.now();
  for (var k in CLONES) {
    var g = CLONES[k];
    if (!g) { continue; }
    /* ★ round573：正在淡出 → 只推进透明度，其它一律不动 ✓ */
    if (g._dying != null) { skCloneFadeTick(g, dt, k); continue; }
    if (g._lastSync && (now - g._lastSync) > 35000) { skCloneDrop(k); continue; }
    var hh = g._hh;
    /* --- ① 逻辑位置插值（追服务器目标点 ✓）--- */
    var tx = g.userData.tx, tz = g.userData.tz;
    var lx = (typeof g._lx === 'number') ? g._lx : g.position.x;
    var lz = (typeof g._lz === 'number') ? g._lz : g.position.z;
    var moved = 0;
    if (tx != null && tz != null) {
      var dx = tx - lx, dz = tz - lz;
      if (Math.abs(dx) + Math.abs(dz) > 0.01) {
        var f = 1 - Math.pow(0.8, Math.max(0.001, dt) / 0.04);   // 和原来 0.2/40ms 等效 ✓
        lx += dx * f; lz += dz * f;
        g._yaw = Math.atan2(dx, dz);
        moved = Math.abs(dx * f) + Math.abs(dz * f);
      }
    }
    g._lx = lx; g._lz = lz;
    /* --- ② 走路（和玩家 walkT 同一套角度 ✓）--- */
    if (hh && g._atkT < 0) {
      g.position.x = lx; g.position.z = lz;
      g.rotation.y = g._yaw || 0;
      if (moved > 0.002) {
        g._walkT = (g._walkT || 0) + dt * 7.5;
        var sw = Math.sin(g._walkT) * 0.72;
        hh.legL.rotation.x = sw; hh.legR.rotation.x = -sw;
        hh.armL.rotation.x = -sw * 0.75; hh.armR.rotation.x = sw * 0.45;
        g.position.y = 0.1 + Math.abs(Math.sin(g._walkT)) * 0.05;
      } else {
        hh.legL.rotation.x *= 0.9; hh.legR.rotation.x *= 0.9;
        hh.armL.rotation.x *= 0.9; hh.armR.rotation.x *= 0.9;
        g.position.y += (0.1 - g.position.y) * Math.min(1, dt * 10);
      }
    }
    /* --- ③ 挥刀（自动战斗/其他玩家同一套 heroAtkPose ✓）--- */
    if (hh && g._atkT >= 0) {
      g._atkT += dt * ((typeof ATK_ANIM_SPD === 'number') ? ATK_ANIM_SPD : 1.2);
      var alive = false;
      try {
        if (typeof heroAtkPose === 'function') {
          alive = heroAtkPose(hh, g._atkT, lx, lz, g._yaw || 0,
                              g._wlook || 'sword', 0.1, 0);
        }
      } catch (e1) { alive = false; }
      if (!alive) {
        g._atkT = -1;
        try {
          if (typeof heroAtkReset === 'function') {
            heroAtkReset(hh, lx, lz, g._yaw || 0);
          }
        } catch (e2) { }
        g.position.set(lx, 0.1, lz);   // heroAtkReset 会写 y=0 ✗ 分身基线是 0.1 ✓
        g.rotation.y = g._yaw || 0;
      }
    }
    /* --- ④ 名牌（和玩家完全是同一个 DOM 组件 ✓）--- */
    skClonePlate(g);
  }
}
function skCloneHandle(d) {
  var sc = (typeof scene !== 'undefined') ? scene : null;
  if (!sc || !window.THREE) { return; }
  var cid = d.cid || 'c';
  /* 消散（模型 + 名牌一起收 ✓）*/
  if (d.gone) { skCloneDrop(cid); return; }
  /* 挥刀信号：服务器每 0.9 秒发一次 ✗ 这里只记"该起手了" ✓
     ★ 动画由 skCloneTick 每帧推进（和自动战斗的 atkT 那条路一模一样 ✓）
     ★ 旧版是"摆个姿势 + 260ms 后复位" ✗ 只会闪一下、也没有摆腿/收招 ✓ */
  if (d.atk) {
    var ga = CLONES[cid];
    if (ga && ga._hh) {
      ga._atkT = 0;
      ga._lastSync = performance.now();
    }
    return;
  }
  /* 位置同步：只记目标点 ✗ 实际位移交给每帧插值（60fps 才顺 ✓）*/
  if (d.move) {
    var gm = CLONES[cid];
    if (gm) {
      gm.userData.tx = d.x; gm.userData.tz = d.z;
      /* ★ round575：分身血条跟着服务器走（它现在会被打 ✓）*/
      if (typeof d.hp === 'number') { gm._hp = d.hp; }
      if (typeof d.hpm === 'number' && d.hpm > 0) { gm._hpm = d.hpm; }
      gm._lastSync = performance.now();
    }
    return;
  }
  if (CLONES[cid]) { return; }
  /* 生成：先播一个短暂的"出现"烟雾 ✓ 和分身本身没关系 ✓ */
  try {
    VFX.spawn('puff', { x: d.x, z: d.z, size: 0.62, dur: 0.6, seed: 7 }, sc);
  } catch (e1) { }
  var g = null, hh = null;
  /* ★ round569（用户："直接用玩家的模型"）→ 用 core 里那个 hero() ✓
     ★ 它和【本体】是同一个构建器 ✗ 体型天然一致 ✓（不用再猜缩放）*/
  try {
    if (typeof hero === 'function') {
      var _h = hero(d.sk || 'f01', d.skc || {});
      if (_h && _h.g) { g = _h.g; hh = _h; }
    }
  } catch (e0) { g = null; hh = null; }
  if (!g) {
    try {
      if (typeof skBuildHero === 'function') {
        var _h2 = skBuildHero(d.sk || 'f01', d.skc || {});
        if (_h2 && _h2.g) { g = _h2.g; hh = _h2; }
      }
    } catch (e1) { }
  }
  if (!g) {
    g = new THREE.Group();
    var mat = new THREE.MeshBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.55 });
    var body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, 0.55), mat);
    body.position.y = 1.0; g.add(body);
    var head = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.62), mat);
    head.position.y = 2.1; g.add(head);
  } else {
    g.traverse(function (o) {
      if (o.isMesh && o.material) {
        o.material = o.material.clone();
        o.material.transparent = true;
        o.material.opacity = 0.78;
        if (o.material.color) { o.material.color.lerp(new THREE.Color(0x66aaff), 0.3); }
      }
    });
  }
  /* ★★ round571：玩家模型都乘 G.HERO_SCALE（0.42）✗ 之前没乘 → 大了 2.4 倍 ✓ */
  try {
    if (typeof G !== 'undefined' && G.HERO_SCALE) {
      g.scale.set(G.HERO_SCALE, G.HERO_SCALE, G.HERO_SCALE);
    }
  } catch (e8) { }
  /* ★★★ round572：头顶名牌【整条复用玩家的】★★★
     mkMobUI = 其他玩家头顶那块牌（名字 + 绿条 + 条内数字 ✓）
     ★ 不再用 CanvasTexture/Sprite/PlaneGeometry 自己画 ✗（旧代码已删 ✓）
     ★ 每帧在 skClonePlate 里 project(cam) + UI.plate.move ✓ 和 netUpdate 一样 */
  var ui = null;
  try {
    if (typeof mkMobUI === 'function') {
      ui = mkMobUI(d.nm || '道友', 100);
      if (ui) { UI.plate.name(ui, d.nm || '道友'); }
    }
  } catch (e7) { ui = null; }
  g.position.set(d.x, 0.1, d.z);
  g._hh = hh;
  g._h = (hh && hh.h) ? hh.h : 2.97;
  g._ui = ui;
  g._owner = (d.owner != null) ? d.owner : null;
  /* ★ round575：分身自己的血（可被攻击了 ✓ 没带就退回显示主人的血）*/
  g._hp = (typeof d.hp === 'number') ? d.hp : null;
  g._hpm = (typeof d.hpm === 'number' && d.hpm > 0) ? d.hpm : null;
  g._walkT = 0;
  g._walk = 0;
  g._atkT = -1;
  g._yaw = 0;
  g._lx = d.x; g._lz = d.z;
  g._wlook = (typeof MY_WEAPON !== 'undefined' && MY_WEAPON && MY_WEAPON.look)
    ? MY_WEAPON.look : 'sword';
  g.userData = g.userData || {};
  g.userData.tx = d.x; g.userData.tz = d.z;
  g._lastSync = performance.now();
  sc.add(g);
  CLONES[cid] = g;
  skClonePlate(g);        /* 第一帧就摆好名牌 ✗ 不然要等一帧才出现 ✓ */
}
function skFxPlay(d) {
  if (!d || !d.k) { return; }
  /* ★ round564：分身（生成 / 消散）单独处理 ✗ 不走通用特效 ✓ */
  /* ★★ round571：凡是 clone 相关的消息【一律】不走通用特效
     （不然会再播一遍网页里那套云雾 → 就是看到的一堆大白球 ✓）*/
  if (d.k === 'clone') {
    if (d.spawn || d.gone || d.move || d.atk) { try { skCloneHandle(d); } catch (e) { } }
    return;
  }
  _fxPend.push(d);
}
function skFxTick(dt) {
  if (window.VFX && _fxPend.length) {
    var sc = (typeof scene !== 'undefined') ? scene : null;
    for (var i = 0; i < _fxPend.length; i++) {
      var d = _fxPend[i];
      try {
        /* ★ round587：疾风步/灵能护盾贴在自己身上（跟随移动，持续到结束/破碎）*/
        var _mineFx = (d.by === undefined || d.by === null ||
                       (typeof WSC !== 'undefined' && d.by === WSC.myId));
        if (d.k === 'gale' || d.k === 'shield' || d.k === 'berserk' || d.k === 'bloodrage') {
          if (!_mineFx || typeof H === 'undefined' || !H || !H.g) { continue; }
          if (d.k === 'gale') {
            if (_myGaleFx) { VFX.kill(_myGaleFx); _myGaleFx = null; }
            _myGaleFx = VFX.spawn('gale', { attach: H.g, dur: d.dur, n: 0,
                                           drift: 3, seed: d.seed }, null);
          } else if (d.k === 'berserk') {
            if (_myBerserkFx) { VFX.kill(_myBerserkFx); _myBerserkFx = null; }
            _myBerserkFx = VFX.spawn('berserk', { attach: H.g, dur: d.dur, n: 0,
                                                 seed: d.seed }, null);
          } else if (d.k === 'bloodrage') {
            if (_myBloodrageFx) { VFX.kill(_myBloodrageFx); _myBloodrageFx = null; }
            _myBloodrageFx = VFX.spawn('bloodrage', { attach: H.g, dur: d.dur, n: 0,
                                                     seed: d.seed }, null);
          } else {
            if (_myShieldFx) { VFX.kill(_myShieldFx); _myShieldFx = null; }
            _myShieldFx = VFX.spawn('shield', { attach: H.g, dur: d.dur,
                                                seed: d.seed }, null);
          }
          continue;
        }
        VFX.spawn(d.k, { x: d.x, z: d.z, r: d.r, dur: d.dur, seed: d.seed,
                         yaw: d.yaw, n: d.n, lh: d.lh, w: d.w, spread: d.spread }, sc);
      } catch (e) { }
    }
    _fxPend.length = 0;
  }
  if (window.VFX) { try { VFX.tick(dt); } catch (e2) { } }
  /* ★ round588/592：疾风步（蓝）/暴走（红）期间按移动轨迹连续生成残影 */
  var _trailT = Math.max(MY_GALE_T, MY_BERSERK_T);
  if (_trailT > 0 && window.VFX && typeof P !== 'undefined' && typeof scene !== 'undefined') {
    _galeAcc += dt;
    var _gmv = (_galeLX === null) ? 0 : Math.hypot(P.x - _galeLX, P.z - _galeLZ);
    if (_galeAcc >= 0.08 && _gmv > 0.035) {
      _galeAcc = 0;
      _galeLX = P.x; _galeLZ = P.z;
      try { VFX.spawn('ghost', { x: P.x, z: P.z, yaw: P.yaw || 0,
                                color: (MY_BERSERK_T > 0 ? 0xff5a3a : 0x9fe8ff),
                                dur: 0.5, seed: (Date.now() & 0xffff) }, scene); } catch (eG) { }
    }
    if (_galeLX === null) { _galeLX = P.x; _galeLZ = P.z; }
  } else if (_trailT <= 0) {
    _galeLX = null; _galeLZ = null;
  }
  /* ★ round572：分身每帧更新（走路/挥刀/名牌位置 ✓ 和主循环同帧率）*/
  try { skCloneTick(dt); } catch (e3) { }
  /* 冷却倒计时 + 每 0.2 秒刷一次图标 */
  var dirty = false;
  for (var k in SKCD) {
    if (SKCD[k] > 0) {
      SKCD[k] = Math.max(0, SKCD[k] - dt);
      if (SKCD[k] === 0) { delete SKCD[k]; dirty = true; }
    }
  }
  for (var tk in SK_TRIG) {
    SK_TRIG[tk] -= dt;
    if (SK_TRIG[tk] <= 0) { delete SK_TRIG[tk]; dirty = true; }
  }
  skBarAcc += dt;
  if (dirty || skBarAcc > 0.25) { skBarAcc = 0; skBarRender(); }
}
var skBarAcc = 0;
var SK_TRIG = {};        /* {技能key: 剩余秒} 被动触发后的状态光 */
function skTrigLight(key, sec) {
  SK_TRIG[key] = sec || 3;
  try { skBarRender(); } catch (e) { }
}
/* 恢复上次拖到的位置 */
try {
  var _pos = JSON.parse(localStorage.getItem('skBarPos') || 'null');
  if (_pos && _pos.l) {
    var _bx = document.getElementById('skBar');
    if (_bx) { _bx.style.left = _pos.l; _bx.style.top = _pos.t; _bx.style.bottom = 'auto'; }
  }
} catch (e) { }
(function skBarLoop() {
  var last = performance.now();
  function step(now) {
    var dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    try { skFxTick(dt); } catch (e) { }
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
})();

function skAsk() { try { wsSend('skillask', {}); } catch (e) { } }


/* ★★ round560：技能说明浮窗（复用背包那个 bagTipBox ✓ 不用新写一套）*/
function skSkillTip(x, y, key) {
  var d = (SK.byKey || {})[key] || {};
  if (!d.k) { return; }
  var kindName = d.kind === 'A' ? '主动' : (d.kind === 'B' ? '被动释放' : '被动加成');
  var owned = !!(SK.learn || {})[key];
  var h = '<b style="color:#ffd83d;font-size:13px">' + (d.n || key) + '</b>' +
    '<i style="color:#8fa3b8"> · ' + kindName + (owned ? ' · 已学' : ' · 未学') + '</i><br>' +
    '<i style="color:#9fb0c2">灵气 ' + (d.qi || 0) + ' · ' +
    (d.cd ? ('CD ' + d.cd + ' 秒') : '无冷却') +
    (d.r ? (' · 半径 ' + d.r + ' 米') : '') +
    (d.rg ? (' · 射程 ' + d.rg + ' 米') : '') + '</i><br>' +
    '<span style="color:#dfe8f2;line-height:1.6">' + (d.d || '（暂无说明）') + '</span>';
  if (window.bagTipShowAt) { bagTipShowAt(x, y, h); }
  if (window.bagTipStickyOn) { bagTipStickyOn(); }
}

function skRender() {
  var box = document.getElementById('skList');
  if (!box) { return; }
  var info = document.getElementById('skInfo');
  var slots = document.getElementById('skSlots');
  var tabs = document.querySelectorAll('#skKindTabs .bagB');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].className = 'bagB' + (tabs[i].getAttribute('data-sk') === SK.kind ? ' on' : '');
  }
  var learnt = [], list = SK.defs.filter(function (d) { return d.kind === SK.kind; });
  for (var k in SK.learn) { if (SK.learn[k] && SK.learn[k].kind === SK.kind) { learnt.push(k); } }
  if (info) {
    info.innerHTML = '已学 <b style="color:#ffd83d">' + learnt.length + '/20</b>' +
      ' · 装配 <b style="color:#8ee0a8">' + (SK.load[SK.kind] || []).filter(Boolean).length + '/5</b>' +
      (SK.forget ? ' · <b style="color:#ff9a8a">遗忘模式：点技能 = 遗忘（不返还）</b>' : '');
  }
  /* 5 个装配槽 */
  if (slots) {
    var sh = '';
    for (var s = 0; s < 5; s++) {
      var kk = (SK.load[SK.kind] || [])[s];
      var nm = kk ? (SK.byKey[kk] || {}).n || kk : '+';
      sh += '<div data-slotslot="' + s + '" style="flex:1 1 18%;min-width:64px;padding:6px 4px;' +
        'border-radius:9px;text-align:center;font-size:11px;cursor:pointer;' +
        'border:1px solid ' + (kk ? '#ffd83d88' : '#ffffff18') + ';' +
        'background:' + (kk ? '#ffd83d1a' : '#ffffff08') + ';color:' + (kk ? '#ffd83d' : '#7f8fa0') + '">' +
        (kk ? '<img src="' + (window.SKI ? SKI.icon(kk, SK.kind, 34) : '') + '" ' +
          'style="width:30px;height:30px;border-radius:7px;display:block;margin:0 auto 3px">' : '') +
        nm + '</div>';
    }
    slots.innerHTML = sh;
  }
  /* 技能列表 */
  var h = '';
  for (var j = 0; j < list.length; j++) {
    var d = list[j];
    var owned = !!SK.learn[d.k];
    var on = (SK.load[SK.kind] || []).indexOf(d.k) >= 0;
    var _lt = SK.learn[d.k] ? (+SK.learn[d.k].tier || 1) : 0;
    h += '<div data-skk="' + d.k + '" style="padding:8px 6px;border-radius:9px;cursor:pointer;' +
      'border:1px solid ' + (on ? '#ffd83d' : (owned ? '#8ee0a855' : '#ffffff14')) + ';' +
      'background:' + (on ? '#ffd83d1a' : '#ffffff06') + '">' +
      '<div style="display:flex;align-items:center;gap:6px">' +
      '<img src="' + (window.SKI ? SKI.icon(d.k, d.kind, 34) : '') + '" ' +
      'style="width:28px;height:28px;border-radius:7px;flex:0 0 28px;pointer-events:none">' +
      '<div style="font-size:12.5px;color:' + (owned ? '#eaf2fb' : '#8b97a6') + ';font-weight:700">' +
      d.n + ((owned && d.tmax > 1) ? '<span style="font-size:9.5px;color:#8ee0a8"> ·' + _lt + '阶</span>'
        : ((!owned && d.tmax > 1) ? '<span style="font-size:9.5px;color:#7f8fa0"> ·最高' + d.tmax + '阶</span>' : '')) +
      '</div></div>' +
      '<div style="font-size:10px;color:#7f8fa0;margin-top:3px;line-height:1.5">' +
      (d.qi ? ('灵气 ' + d.qi + ' · ') : '') + (d.cd ? ('CD ' + d.cd + 's') : '无CD') +
      '</div>' +
      (owned ? ('<div data-skequip="' + d.k + '" style="margin-top:4px;font-size:10px;' +
        'text-align:center;padding:2px 0;border-radius:5px;' +
        'background:' + (on ? '#ffd83d33' : '#8ee0a822') + ';color:' + (on ? '#ffd83d' : '#8ee0a8') +
        '">' + (on ? '卸下' : '装配') + '</div>') : '') +
      '</div>';
  }
  box.innerHTML = h;
  /* ★ round562（用户："点击会显示透明的蓝色框"）→ 关掉系统高亮 + 自定义按下效果 */
  try {
    if (!window.__skListCss) {
      window.__skListCss = true;
      var st = document.createElement('style');
      st.textContent = '#skList,#skList *{-webkit-tap-highlight-color:transparent;' +
        'outline:none!important;-webkit-user-select:none;user-select:none}' +
        '#skList [data-skk]{transition:transform .08s,border-color .12s,box-shadow .12s}' +
        '#skList [data-skk]:active{transform:scale(0.96);border-color:#ffd83d!important;' +
        'box-shadow:0 0 0 2px #ffd83d55}';
      document.head.appendChild(st);
    }
  } catch (e0) { }
  var msg = document.getElementById('skMsg');
  if (msg) { msg.textContent = SK.msg || ''; }
}

function skBind() {
  var tabs = document.getElementById('skKindTabs');
  if (tabs && !tabs._b) {
    tabs._b = true;
    tabs.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== tabs && !(t.getAttribute && t.getAttribute('data-sk'))) { t = t.parentNode; }
      if (!t || t === tabs) { return; }
      SK.kind = t.getAttribute('data-sk');
      skRender();
    });
  }
  var list = document.getElementById('skList');
  if (list && !list._b) {
    list._b = true;
    list.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== list && !(t.getAttribute && t.getAttribute('data-skk'))) { t = t.parentNode; }
      if (!t || t === list) { return; }
      /* ★ 先看是不是点了"装配/卸下"小按钮 */
      var eqBtn = e.target;
      while (eqBtn && eqBtn !== list && !(eqBtn.getAttribute && eqBtn.getAttribute('data-skequip'))) {
        eqBtn = eqBtn.parentNode;
      }
      if (eqBtn && eqBtn !== list) {
        var _ek = eqBtn.getAttribute('data-skequip');
        var _sl = SK.load[SK.kind] || [];
        var _at = _sl.indexOf(_ek);
        try {
          if (_at >= 0) { wsSend('skillload', { kind: SK.kind, slot: _at }); }
          else {
            var _e2 = _sl.indexOf(null);
            if (_e2 < 0) { SK.msg = '5 个槽都满了，先卸下一个'; skRender(); return; }
            wsSend('skillload', { kind: SK.kind, slot: _e2, key: _ek });
          }
        } catch (e4) { }
        SK.msg = '';
        skRender();
        return;
      }
      var k = t.getAttribute('data-skk');
      if (SK.forget) {
        try { wsSend('skillforget', { key: k }); } catch (e1) { }
        SK.msg = '正在遗忘…';
        skRender();
        return;
      }
      /* ★ round558（用户："点击技能可以查看说明"）
         → 点卡片正文 = 看说明（装配用上面的小按钮 ✓）*/
      var _d2 = (SK.byKey || {})[k] || {};
      var _owned = !!SK.learn[k];
      SK.msg = (_d2.n || k) +
        (_owned ? '（已学）' : '（未学）') +
        ' · ' + (_d2.qi ? ('灵气 ' + _d2.qi + ' ') : '') +
        (_d2.cd ? ('CD ' + _d2.cd + 's ') : '无CD ') +
        '· ' + (_d2.d || '暂无说明');
      /* ★ 同时弹一个浮窗（手机上也看得见 ✓）*/
      try { skSkillTip(e.clientX || 120, e.clientY || 260, k); } catch (e6) { }
      skRender();
    });
  }
  var slotsEl = document.getElementById('skSlots');
  if (slotsEl && !slotsEl._b) {
    slotsEl._b = true;
    slotsEl.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== slotsEl && !(t.getAttribute && t.getAttribute('data-slotslot'))) { t = t.parentNode; }
      if (!t || t === slotsEl) { return; }
      var idx = +t.getAttribute('data-slotslot');
      if ((SK.load[SK.kind] || [])[idx]) {
        try { wsSend('skillload', { kind: SK.kind, slot: idx }); } catch (e4) { }
        skRender();
      }
    });
  }
  var fb = document.getElementById('skForget');
  if (fb && !fb._b) {
    fb._b = true;
    fb.onclick = function () {
      SK.forget = !SK.forget;
      fb.className = 'bagB' + (SK.forget ? ' on' : '');
      skRender();
    };
  }
}

function setTab(name) {
  /* ★ round534（用户："悬浮窗离开背包界面应该自动关闭"）*/
  try { if (name !== 'bag') { bagTipHide(); } } catch (e0) { }
  if (!name) { name = SET_DEF.setTab || 'view'; }
  /* ★★★ 第 263 轮（用户："别的导航按钮又是正常的，你出现做按钮不行吗"）★★★
     用户点破了关键：别的导航按钮都正常 ✗ 只有我做的"更多"有偏移 ✓
     → 说明我不该在外面加一套坐标判定 ✗
       而应该让它【走和其他按钮完全相同的那条路】✓
     ★ 做法：给它 data-tab="more"✗ 在这里拦一下 ✗ 翻页 ✓ 然后返回 ✓
       · 必须在"找面板"之前返回 ✗ 否则会走到"没这个面板 → 退回 view"✓
       · 原来的坐标兜底已经删掉 ✗ 不然会翻两次 ✓ */
  if (name === 'more') {
    var _bar = document.getElementById('setTabs');
    if (_bar) { _bar.classList.toggle('page2'); }
    var _m = document.getElementById('tabMore');
    if (_m) { _m.textContent = (_bar && _bar.classList.contains('page2')) ? '◂ 取消' : '更多 ▸'; }
    if (window.tkToastTop) { try { tkSyncToastTop(); } catch (e) { } }
    return;
  }
  /* 画面/操作/音效共用主导航【设置】；二级导航只显示当前一页 */
  var _subNames = { view: 1, ctrl: 1, audio: 1, ui: 1 };
  var _mainName = _subNames[name] ? 'view' : name;
  var tabs = document.querySelectorAll('#setTabs .tab');
  for (var i = 0; i < tabs.length; i++) {
    var on = (tabs[i].getAttribute('data-tab') === _mainName);
    tabs[i].className = 'tab' + (on ? ' on' : '');
  }
  /* 第 272 轮（用户：把画面/操作/音效合成"设置"）
     最低风险做法：不动 HTML 结构 ✗ 三个面板还在原地 ✓
     只在这里"选设置时把它们一起显示"✓（搬 HTML 容易把别的钩子搬坏 ✗） */
  var _sp = document.getElementById('setPanel');
  if (_sp) { _sp.classList.remove('merge'); }
  /* ★ round538：切到技能页 → 绑事件 + 拉一次状态 */
  if (name === 'bag' && !(SK.defs && SK.defs.length)) {
    try { skAsk(); } catch (e0) { }     /* ★ 背包也要技能说明 ✗ 先拉一次定义 ✓ */
  }
  if (name === 'skill') {
    try { skBind(); skAsk(); skRender(); } catch (e5) { }
  }
  var _want = [name];
  var panes = document.querySelectorAll('#setPanel .tabpane');
  var hit = false;
  for (var j = 0; j < panes.length; j++) {
    var on2 = (_want.indexOf(panes[j].getAttribute('data-pane')) >= 0);
    panes[j].className = 'tabpane' + (on2 ? ' on' : '');
    if (on2) { hit = true; }
  }
  if (!hit) { return setTab('view'); }   // 存了个不存在的分类 → 退回第一页 ✓
  SETCFG.setTab = name;
  try { setSubPaint(); } catch (eSP) { }
  /* ★★★ 第 119 轮修的真 bug（用户："属性和天赋点开不会第一时间显示，
     需要关闭重新点击后才会显示"）★★★
     病根：这里【只有背包页】挂了"切过来就刷新"的钩子 ✗
           属性页 / 天赋页都是数据驱动的 ✓ 但切过来时没人调渲染 ✗
           → 第一次点开是空的 ✓ 关闭菜单再进才显示 ✓（那时走的是另一条初始化路径 ✓）
           → 用户描述一字不差 ✓
     ★ 修在 setTab() 里 ✗ 不是修在"点击那一刻"✗
       因为切页签有好几条路（点页签 / 快捷键 / 恢复上次停留 / 代码里直接调 ✓）
       修在点击处 = 只修了一条路 ✗ 迟早又漏 ✗
       —— setTab 是【唯一收口】✓ 所有路都经过它 ✓ */
  /* ★★ round304d（用户要求：交易所要独立导航按钮）★★
     MKT.open 的【唯一来源】就是这里 ✗ 别的任何地方都不许自己设它 ✓
     ★ 为什么：页签有好几条路会切过来（点页签 / 快捷键 / 恢复上次停留 / 代码跳 ✓）
       谁自己设 MKT.open ✗ 迟早出现"面板在后台还在刷"或者"切过来是空的"✓ */
  MKT.open = (name === 'mkt');
  if (name === 'mkt') { mktBindOnce(); mktAsk(true); }
  if (name === 'bag') { bagFetch(bagRender); }
  /* ★ 2026-10-23 修：系统提示框的滑块必须在【切到设置页】时绑定 ✗
     原来只在键位模式里绑 → 普通打开菜单拖动没反应 ✓ */
  try { sysMsgBindSizeBtns(); sysMsgSetTop(name === 'ui'); } catch (eSMb) { }   // ★ 切到背包页就拉一次（只读接口 ✓ 很便宜）
  /* ★★ round467（用户："把装备栏和背包分开，装备栏单独设为导航栏"）★★
     装备页要渲染两个装备槽（bagRender 里那段）+ 属性详情（equipRender）✓ */
  if (name === 'equip') { bagRender(); equipRender(); }
  if (name === 'stat') {
    statRender();                                // ★ 第 119 轮：属性页
    /* ★ round465：打开属性页就向服务器要一份最新的属性表 ✓
       （不然看到的可能是进游戏时那份旧数值 ✗）*/
    try { if (typeof wsSend === 'function' && WSC.ready) { wsSend('statask', {}); } } catch (e) { }
  }
  if (name === 'talent') { talBind(); talRender(); }   // ★ 第 119 轮：天赋页
  if (name === 'wiki') { wikiBind(); wikiRender(); }   // ★ 第 148 轮：百科页
  setTimeout(setTabsHintUpd, 0);   // ★ 第 169 轮：切页后重算滚动提示 ✓
  if (name === 'party') { ptRender(); }          // ★ 第 119 轮：组队页（一个毛病 ✓ 一起修）
  if (name === 'rank') { rankBindOnce(); rankChipsRender(); rankFetch(true); }   // ★ round424：排行榜页
  if (name === 'skin') { skinOpen(); }            // ★ round488：皮肤页
  return name;
}

/* ============================================================ 皮肤页（round488）
   ★ 40 个都在 SKIN_DEFS / skinpage 里 ✓ 没获得的也能点开看模型 ✓（用户要求）
   ★ 预览用的是游戏里【同一个构建器】skBuildHero ✓ 所以看到的就是游戏里的样子 ✓ */

/* ============================================================ 皮肤自定义 UI（round511）
   ★ 5 个部位：眼型 / 嘴型 / 瞳色 / 头发色 / 衣服色
   ★ 点一下 = 只改预览（不扣卡）✗ 点「确认更换」才发 skincustom ✓
   ★ 服务端是权威：扣卡/校验都在那边 ✓ 这里只负责"看起来对不对" */
var EYE_NF = ['标准', '圆眼', '细长', '猫眼', '下垂', '半眯', '星眼', '竖瞳', '清冷', '小豆'];
var EYE_NM = ['窄长', '方眼', '凶眼', '小圆', '眯眼', '竖瞳', '三角', '肿眼', '单眼皮', '疤眼'];
var MOUTH_N = ['平静', '微笑', '抿嘴', '张嘴', '咧嘴', '撇嘴', '八字', '嘟嘴', '大笑', '缝合'];
/* ★ 和服务端 server/skin_custom.py 的 key 表【必须一致】✗ 发的是 key 不是下标 ✓ */
var EYE_KEY_F = ['big', 'round', 'thin', 'cat', 'droop', 'half', 'star', 'slit', 'cold', 'dot'];
var EYE_KEY_M = ['narrow', 'square', 'fierce', 'small', 'squint', 'slit', 'tri', 'puffy', 'mono', 'scar'];
var MOUTH_KEY = ['calm', 'smile', 'tight', 'open', 'grin', 'smirk', 'sad', 'pout', 'laugh', 'stitch'];
var PALETTE = [0xf5f5f5, 0xe8dcc8, 0xffd83d, 0xffb03a, 0xff7a5c, 0xe2506a,
               0xc9308e, 0x9a5ce0, 0x5c7cff, 0x3ec6ff, 0x2ee0b0, 0x7ee08a,
               0xc8e05c, 0x8a6a4a, 0x5a5a66, 0x2b2b33, 0x101018, 0x8a2b2b];
var SKC = { open: false, tab: 'ey', sel: null, pending: {} };

function skcGender(k) {
  try {
    var key = k || SKIN.sel;
    return (SKIN_DEFS[key] && SKIN_DEFS[key].g === 'm') ? 'm' : 'f';
  } catch (e) { return 'f'; }
}
function skcCustomOf(skinKey) {
  var m = (typeof MY_CUSTOM_MAP !== 'undefined' && MY_CUSTOM_MAP) ? MY_CUSTOM_MAP[skinKey] : null;
  return m ? JSON.parse(JSON.stringify(m)) : {};
}
function skcPending() {
  /* 已保存的 + 这次预览改的 = 预览用的那份 ✓ */
  var base = skcCustomOf(SKIN.sel);
  for (var k in SKC.pending) { base[k] = SKC.pending[k]; }
  return base;
}
function skcPreview() {
  /* ★★ round518（用户："眼睛、嘴巴没办法预览"）
     ★ 上一版是"新建一个 hero 塞进场景"✗ 实际没换掉（画布一帧都没变 ✓ 测出来的）
     ★ 现在：直接【按新自定义重建】，替换 SKIN.hero，并立刻渲染一帧 ✓
       渲染失败也不会静默：出问题会在控制台留一行 ✓ */
  try {
    if (!SKIN.ready || !SKIN.scene) { return false; }
    var nc = skcPending();
    var nh = skBuildHero(SKIN.sel, nc);
    if (!nh) { return false; }
    var oldH = SKIN.hero;
    var px = 0, py = 0, pz = 0, ry = 0;
    if (oldH && oldH.g) {
      px = oldH.g.position.x; py = oldH.g.position.y; pz = oldH.g.position.z;
      ry = oldH.g.rotation.y;
      SKIN.scene.remove(oldH.g);
      try {
        oldH.g.traverse(function (o) { if (o.isMesh && o.geometry) { o.geometry.dispose(); } });
      } catch (e0) { }
    }
    nh.g.position.set(px, py, pz);
    nh.g.rotation.y = ry;
    SKIN.scene.add(nh.g);
    SKIN.hero = nh;
    SKIN.rot = ry;
    skinPreviewDraw();                        /* 立刻出一帧 ✗ 不等下一次 tick ✓ */
    return true;
  } catch (e) {
    console.log('[skin] 预览重建失败：' + e);
    return false;
  }
}

/* ---- 自定义面板的小头像（真实构建器渲染 ✓）----
   ★ 只建一个 WebGL 上下文 ✗ 换着渲染多次抓图 ✓（开 10 个上下文手机扛不住）*/
var SKC_TH = {};
function skcThumbCtx() {
  if (SKC._tc) { return SKC._tc; }
  /* ★★★ 2026-10-23（用户："直接避免 WebGL 失败" → 共用主渲染器）★★★
     这里原来 new THREE.WebGLRenderer(...) → 每开一次自定义就多占一个 WebGL 上下文 ✗
     手机上一个页面只有 8~16 个 ✗ 累计几次主画布就创建失败 ✓
     → 现在只建【普通 2D canvas】✗ 真正渲染时借主渲染器 ✓ 全页面只有 1 个 WebGL 上下文 */
  var cv = document.createElement('canvas');
  cv.width = 216; cv.height = 168;
  var sc = new THREE.Scene();
  sc.add(new THREE.HemisphereLight(0xd8e4f4, 0x3a3020, 1.05));
  var d1 = new THREE.DirectionalLight(0xfff3d8, 0.95); d1.position.set(2.2, 3.4, 3.6); sc.add(d1);
  var d2 = new THREE.DirectionalLight(0x8fb0ff, 0.38); d2.position.set(-2.6, 1.2, -1.6); sc.add(d2);
  SKC._tc = { sc: sc, cv: cv };
  return SKC._tc;
}
function skcThumb(skinKey, custom, field) {
  var g = skcGender(skinKey);
  var k = skinKey + '|' + g + '|' + field + '|' + JSON.stringify(custom || {});
  if (SKC_TH[k]) { return SKC_TH[k]; }
  try {
    var c = skcThumbCtx();
    var hero = skBuildHero(skinKey, custom);
    if (!hero) { return ''; }
    c.sc.add(hero.g);
    hero.g.rotation.y = 0.16;
    var hy = hero.headY, hh = hero.headH;
    var fov = 30;
    var wantH = (field === 'mo') ? hh * 0.80 : hh * 1.55;
    var midY = (field === 'mo') ? (hy - hh * 0.26) : (hy + hh * 0.02);
    var z = wantH / (2 * Math.tan(fov * Math.PI / 360));
    var cam = new THREE.PerspectiveCamera(fov, 108 / 84, 0.1, 60);
    cam.position.set(0, midY, z);
    cam.lookAt(0, midY, 0);
    /* ★ 借主渲染器渲染 → readPixels → 画到 2D canvas（不再用自己的 WebGL 渲染器 ✓）*/
    var _pw = 216, _ph = 168;
    if (!UI.renderSceneTo2D(c.sc, cam, c.cv, _pw, _ph)) { return ''; }
    /* ★★ round521（用户："眼睛和嘴巴的预览还是看不到"）
       ★ 根因：WebGL 画布默认 preserveDrawingBuffer:false ✗
         render 之后浏览器随时可以清缓冲 ✗ 这时 toDataURL 出来的可能是一张【全透明】图 ✓
         在无头/部分手机上必现 → 玩家看到的就是"一片黑/空白" ✓
       ★ 修：用 gl.readPixels 把像素【当场读出来】✗ 不依赖缓冲还在不在 ✓
         再翻一下 Y 画到 2D 画布上出 PNG ✓ 这条最稳 ✓ */
    var url = '';
    try {
      url = c.cv.toDataURL('image/png');
    } catch (e2) {
      url = '';
    }
    c.sc.remove(hero.g);
    hero.g.traverse(function (o) { if (o.isMesh && o.geometry) { o.geometry.dispose(); } });
    SKC_TH[k] = url;
    return url;
  } catch (e) {
    return '';
  }
}

/* ---- 调色盘小工具（round520）---- */
function skcRgb2Hsl(n) {
  var r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  var h = 0, s2 = 0, l = (mx + mn) / 2;
  if (d > 1e-6) {
    s2 = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) { h = ((g - b) / d) % 6; }
    else if (mx === g) { h = (b - r) / d + 2; }
    else { h = (r - g) / d + 4; }
    h *= 60;
    if (h < 0) { h += 360; }
  }
  return [h, s2, l];
}
function skcHsl2Rgb(h, s2, l) {
  h = ((h % 360) + 360) % 360;
  var c = (1 - Math.abs(2 * l - 1)) * s2;
  var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  var m = l - c / 2;
  var r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return ((Math.round((r + m) * 255) << 16) |
          (Math.round((g + m) * 255) << 8) |
          Math.round((b + m) * 255)) >>> 0;
}
function skcSlider(k, label, val, min, max, bg) {
  return '<div style="display:flex;align-items:center;gap:6px;margin:4px 0">' +
    '<span style="width:30px;font-size:10.5px;color:#8fa3b8">' + label + '</span>' +
    '<input data-skc-sl="' + k + '" type="range" min="' + min + '" max="' + max + '" value="' + val + '"' +
    ' style="flex:1 1 auto;height:14px;accent-color:#ffd83d;background:' + bg + '">' +
    '<span style="width:26px;text-align:right;font-size:10.5px;color:#b8c6d6">' + val + '</span></div>';
}

function skcRender() {
  var tabs = document.getElementById('skCTabs');
  var opts = document.getElementById('skCOpts');
  var cost = document.getElementById('skCCost');
  var okB = document.getElementById('skCOk');
  if (!tabs || !opts) { return; }
  var T = [['ey', '👁 眼睛'], ['mo', '👄 嘴巴'], ['iris', '👀 瞳色'],
           ['hair', '🎨 头发'], ['shirt', '👕 衣服'], ['skirt', '👗 裙子'], ['pants', '👖 裤子']];
  var th = '';
  for (var i = 0; i < T.length; i++) {
    var on = (SKC.tab === T[i][0]);
    th += '<div class="bagB' + (on ? ' on' : '') + '" data-skc-tab="' + T[i][0] + '"' +
      ' style="padding:3px 8px;font-size:11px">' + T[i][1] + '</div>';
  }
  tabs.innerHTML = th;

  var cur = skcPending();
  var oh = '';
  if (SKC.tab === 'ey' || SKC.tab === 'mo') {
    var isEye = (SKC.tab === 'ey');
    var names = isEye ? ((skcGender() === 'm') ? EYE_NM : EYE_NF) : MOUTH_N;
    var curV = isEye ? cur.ey : cur.mo;
    for (var e = 0; e < 10; e++) {
      var cc2 = JSON.parse(JSON.stringify(cur));
      if (isEye) { cc2.ey = e; } else { cc2.mo = e; }
      var url = skcThumb(SKIN.sel, cc2, SKC.tab);
      var on2 = (curV === e);
      /* ★ round523（用户："选择那些应该加一个选中框"）
         → 选中的格子：3px 金框 + 金光 + 右上角 ✓ 角标 ✓ 一眼看出来选的是哪个 */
      oh += '<div data-skc-val="' + e + '" style="position:relative;width:74px;border-radius:8px;' +
        'overflow:hidden;border:3px solid ' + (on2 ? '#ffd83d' : '#ffffff18') + ';' +
        'background:#0f141b;cursor:pointer;' +
        (on2 ? 'box-shadow:0 0 0 2px #ffd83d55,0 0 12px #ffd83d66;' : '') + '">' +
        (on2 ? '<span style="position:absolute;right:2px;top:2px;z-index:2;width:15px;height:15px;' +
          'border-radius:50%;background:#ffd83d;color:#1a1408;font-size:11px;font-weight:900;' +
          'line-height:15px;text-align:center">✓</span>' : '') +
        (url ? '<img src="' + url + '" style="display:block;width:100%;height:56px;object-fit:cover">'
             : '<div style="height:56px;display:flex;align-items:center;justify-content:center;' +
               'font-size:11px;color:#8fa3b8">' + names[e] + '</div>') +
        '<div style="font-size:10px;text-align:center;padding:1px 0 2px;color:' +
        (on2 ? '#ffd83d' : '#9fb0c2') + '">' + (e + 1) + ' ' + names[e] + '</div></div>';
    }
  } else {
    /* ★★ round520（用户："调色盘选了颜色没有效果；有没有更适合游戏的调色盘"）
       ★ 上一版用了系统 <input type="color"> ✗ 两个问题：
         ① 事件只绑在第一次渲染的那个元素上 ✗ 一旦重画就丢了 ✓
         ② 系统取色器在手机上是个弹层 ✗ 和游戏 UI 完全不搭 ✓
       ★ 现在：色板 + 三条滑条（色相 / 饱和 / 明度）✗ 全在游戏里 ✓ 实时预览 ✓ */
    var curCol = (typeof cur[SKC.tab] === 'number') ? cur[SKC.tab] : 0xffffff;
    var hsl = skcRgb2Hsl(curCol);
    var curHex = '#' + ('000000' + (curCol | 0).toString(16)).slice(-6);
    for (var c = 0; c < PALETTE.length; c++) {
      var col = PALETTE[c];
      var hed2 = '#' + ('000000' + col.toString(16)).slice(-6);
      var sel2 = (cur[SKC.tab] === col);
      oh += '<div data-skc-val="' + col + '" style="width:26px;height:26px;border-radius:7px;' +
        'background:' + hed2 + ';border:2px solid ' + (sel2 ? '#ffd83d' : '#ffffff22') +
        ';cursor:pointer;' + (sel2 ? 'box-shadow:0 0 0 2px #ffd83d55;' : '') + '"></div>';
    }
    oh += '</div>';   /* 关掉色板那一行 */
    oh += '<div style="margin-top:8px;padding:6px 8px;border-radius:9px;background:#111823;' +
      'border:1px solid #ffffff14">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
        '<div data-skc-preview style="width:34px;height:34px;border-radius:9px;background:' + curHex +
        ';border:2px solid #ffffff22"></div>' +
        '<div style="font-size:11px;color:#b8c6d6;line-height:1.5">调色盘' +
        '<br><b style="color:' + curHex + '">' + curHex.toUpperCase() + '</b>' +
        '<span style="color:#7f8fa0"> · 拖动下面的滑条</span></div></div>' +
      skcSlider('h', '色相', hsl[0], 0, 360, 'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)') +
      skcSlider('s', '饱和', Math.round(hsl[1] * 100), 0, 100, 'linear-gradient(90deg,#888,' + curHex + ')') +
      skcSlider('l', '明度', Math.round(hsl[2] * 100), 0, 100, 'linear-gradient(90deg,#000,' + curHex + ',#fff)') +
      '</div>';
  }
  opts.innerHTML = oh;

  var skName = (SKIN.items || []).filter ? '' : '';
  for (var q2 = 0; q2 < (SKIN.items || []).length; q2++) {
    if (SKIN.items[q2].k === SKIN.sel) { skName = SKIN.items[q2].n || SKIN.sel; }
  }
  var spent = Object.keys(SKC.pending).length;
  if (cost) {
    cost.innerHTML = spent
      ? ('本次消耗：<b style="color:#ffd83d">' + skName + ' · 皮肤卡 ×' + spent + '</b>' +
         '（改了 ' + spent + ' 个部位 · 一个部位一张卡 · 只会用这套皮肤的重复卡）')
      : '点上面的眼型/嘴型/颜色看效果 ✗ 不会扣卡 ✓';
  }
  /* ★★ round530（用户："实时显示当前所选角色剩余卡，以及本次会消耗的卡的数量"）
     ★ 剩余卡 = 服务端告诉我们的【该皮肤的重复卡】数量（skincustomok 里带回来 ✓）
     ★ 本次消耗 = 改了几个部位 */
  var worn = false;
  try {
    var _it3 = (typeof skinItemOf === 'function') ? skinItemOf(SKIN.sel) : null;
    worn = !!(_it3 && _it3.use);
  } catch (e3) { }
  var have = (typeof MY_CARD_MAP !== 'undefined' && MY_CARD_MAP && MY_CARD_MAP[SKIN.sel]) | 0;
  if (cost) {
    var _line = '剩余卡：<b style="color:' + (have >= spent ? '#8ee0a8' : '#ff9a8a') + '">' +
      have + '</b> 张 · 本次消耗：<b style="color:#ffd83d">' + spent + '</b> 张';
    if (!worn) { _line += ' · <b style="color:#ff9a8a">先用这套皮肤才能改</b>'; }
    else if (spent > have) { _line += ' · <b style="color:#ff9a8a">卡不够</b>'; }
    cost.innerHTML = _line;
  }
  if (okB) {
    if (!worn) { okB.disabled = true; okB.textContent = '先用这套皮肤'; }
    else if (spent === 0) { okB.disabled = true; okB.textContent = '确认更换'; }
    else if (spent > have) { okB.disabled = true; okB.textContent = '缺 ' + (spent - have) + ' 张卡'; }
    else { okB.disabled = false; okB.textContent = '确认更换（' + spent + ' 张）'; }
  }
}
/* ★★ round525：二级导航（皮肤 / 自定义）✗ 自定义从"浮块"变成"第二页" ✓ */
function skNavTo(which) {
  var main = document.getElementById('skMain');
  var panel = document.getElementById('skCPanel');
  var navs = document.querySelectorAll('#skNav [data-sknav]');
  for (var i = 0; i < navs.length; i++) {
    var on = (navs[i].getAttribute('data-sknav') === which);
    navs[i].className = 'bagB' + (on ? ' on' : '');
  }
  if (main) { main.style.display = (which === 'main') ? '' : 'none'; }
  if (panel) { panel.style.display = (which === 'custom') ? 'block' : 'none'; }
  if (which === 'custom') {
    if (!SKIN.sel && SKIN.items && SKIN.items.length) { skinPick(SKIN.items[0].k); }
    skcOpen();
    /* ★ 面板现在就在导航正下方 ✗ 只要把滚动条拉回顶部 ✓ 就能看到 ✓ */
    try {
      var pane3 = document.querySelector('.tabpane[data-pane="skin"]');
      if (pane3) { pane3.scrollTop = 0; }
    } catch (e0) { }
  } else { skcClose(); }
}
function skNavBind() {
  var box = document.getElementById('skNav');
  if (!box || box._b) { return; }
  box._b = true;
  box.addEventListener('click', function (e) {
    var t = e.target, hit = null;
    while (t && t !== box) {
      if (t.getAttribute && t.getAttribute('data-sknav')) { hit = t; break; }
      t = t.parentNode;
    }
    if (!hit) { return; }
    /* ★ 允许进来看（只读预览）✗ 只有"使用中"的皮肤能确认更换 ✓ */

    skNavTo(hit.getAttribute('data-sknav'));
  });
}
function skcOpen() {
  if (!SKIN.sel) { return; }
  SKC.open = true; SKC.pending = {}; SKC.tab = 'ey';
  /* ★★ round529（用户："已经改过的皮肤，点自定义应该加载已改的样子；
     再次修改要分清哪是这次改的、不要重复扣卡"）
     ★ SKC.base = 上次保存的样子（用来显示 + 判断"这一项到底改没改"）
       SKC.pending 只放【这一趟真正动过的】✗ 没动的不会收钱 ✓ */
  SKC.base = skcCustomOf(SKIN.sel);
  var p = document.getElementById('skCPanel');
  if (p) { p.style.display = 'block'; }
  skcRender();
  /* ★★ round522（用户："点击后上面模型的预览看不到"）
     ★ 全身体积里眼睛只占几个像素 ✗ 改了也看不出 ✓
     → 打开自定义就【把镜头推到脸上】✗ 关掉再恢复全身 ✓ */
  try {
    if (SKIN.hero && SKIN.hero.headY) {
      SKIN.camY = SKIN.hero.headY + (SKIN.hero.headH || 1) * 0.02;
      SKIN.zoom = 0.85;
      if (typeof skinApplyCam === 'function') { skinApplyCam(); }
      skinPreviewDraw();
    }
  } catch (eZ) { }
  /* ★ round515（用户："点开自定义后模型头看不到了，表格变长把它挤上去"）
     → 面板展开后把【预览画布】滚回视野里 ✓ 而不是让内容顶上去 ✓ */
  try {
    var pane2 = document.querySelector('.tabpane[data-pane="skin"]');
    var cv2 = document.getElementById('skCv');
    var pn2 = document.getElementById('skCPanel');
    if (pane2 && cv2) { pane2.scrollTop = Math.max(0, cv2.offsetTop - 8); }

  } catch (e) { }
}
function skcClose() {
  SKC.open = false; SKC.pending = {};
  /* ★ 关掉面板 → 镜头回到全身 ✓ */
  try {
    SKIN.zoom = 1.30; SKIN.camY = 0.98;
    if (typeof skinApplyCam === 'function') { skinApplyCam(); }
    skcPreview();
  } catch (eZ2) { }
  var p = document.getElementById('skCPanel');
  if (p) { p.style.display = 'none'; }
  skcPreview();      /* 回到已保存的样子 ✓ */
}
function skcBind() {
  var b = document.getElementById('skCustom');
  if (b && !b._cb) {
    b._cb = 1;
    b.addEventListener('click', function () {
      skNavTo('custom');           /* ★ 现在点它是切到【自定义】那一页 ✓ */
    });
  }
  var box = document.getElementById('skCPanel');
  if (!box || box._cb) { return; }
  box._cb = 1;
  box.addEventListener('click', function (e) {
    /* ★★ round524（用户："怎么点了一个就不能换了"）
       ★ 根因：e.target 是【格子里的 <img>/<span>】✗ 它们身上没有 data-skc-val ✓
         → 直接读 target 的话，点到图片/角标就"当没点"✗
         （第一次能点中是因为那次点在格子空白处 ✓）
       ★ 修：从 target 往上一层层找到带 data 的那个元素 ✓ */
    var t = e.target;
    var hit = null;
    while (t && t !== box) {
      if (t.getAttribute && (t.getAttribute('data-skc-val') !== null ||
                             t.getAttribute('data-skc-tab') !== null)) {
        hit = t; break;
      }
      t = t.parentNode;
    }
    if (!hit) { return; }
    var tab = hit.getAttribute('data-skc-tab');
    if (tab) { SKC.tab = tab; skcRender(); return; }
    var v = hit.getAttribute('data-skc-val');
    if (v !== null && v !== undefined) {
      var nv = parseInt(v, 10) || 0;
      var baseV = (SKC.base && typeof SKC.base[SKC.tab] === 'number') ? SKC.base[SKC.tab] : null;
      if (baseV !== null && nv === baseV) {
        delete SKC.pending[SKC.tab];       /* ★ 选回原样 = 不算改动 ✗ 不收钱 ✓ */
      } else {
        SKC.pending[SKC.tab] = nv;
      }
      skcRender(); skcPreview();
    }
  });
  /* ★ 滑条：事件委托在 #skCOpts 上 ✗ 内容一重画不会丢 ✓（上一版就丢在这儿）*/
  var optsBox = document.getElementById('skCOpts');
  if (optsBox && !optsBox._slb) {
    optsBox._slb = true;
    optsBox.addEventListener('input', function (e) {
      var t2 = e.target;
      if (!t2 || !t2.getAttribute) { return; }
      var k2 = t2.getAttribute('data-skc-sl');
      if (!k2) { return; }
      var box2 = document.getElementById('skCOpts');
      var hh2 = box2.querySelector('[data-skc-sl="h"]');
      var ss2 = box2.querySelector('[data-skc-sl="s"]');
      var ll2 = box2.querySelector('[data-skc-sl="l"]');
      /* ★ 拖色相时如果饱和度是 0（灰/白）✗ 颜色不会变 ✗ 玩家会以为坏了 ✓
         → 自动把饱和拉到 65%、明度至少 45% ✓ */
      if (k2 === 'h' && ss2 && +ss2.value < 8) {
        ss2.value = '65';
        if (ll2 && (+ll2.value > 88 || +ll2.value < 18)) { ll2.value = '52'; }
      }
      var col2 = skcHsl2Rgb(
        hh2 ? +hh2.value : 0,
        (ss2 ? +ss2.value : 100) / 100,
        (ll2 ? +ll2.value : 50) / 100);
      SKC.pending[SKC.tab] = col2;
      skcPreview();
      var hex2 = '#' + ('000000' + col2.toString(16)).slice(-6);
      var cost = document.getElementById('skCCost');
      if (cost) {
        cost.innerHTML = '已选 <b style="color:' + hex2 + '">' + hex2.toUpperCase() +
          '</b>（点「确认更换」才会消耗 1 张卡）';
      }
      var okB = document.getElementById('skCOk');
      if (okB) { okB.disabled = false; }
      /* 色块和数字跟着变（不整排重画 ✗ 不然滑条会抖 ✓）*/
      var sw2 = box2.querySelector('[data-skc-preview]');
      if (sw2) { sw2.style.background = hex2; }
    });
  }
  var cc = document.getElementById('skCCancel');
  if (cc) { cc.addEventListener('click', function () { skNavTo('main'); }); }
  var ck2 = document.getElementById('skCOk');
  if (ck2) {
    ck2.addEventListener('click', function () {
      var fields = Object.keys(SKC.pending);
      if (!fields.length) { return; }
      /* ★ 一次只提交一个部位（一个部位一张卡 ✓）—— 点第一个没确认的 ✓ */
      var f = fields[0];
      var v = SKC.pending[f];
      /* ★ 眼型/嘴型要转成 key ✗ 颜色直接发整数 ✓ */
      if (f === 'ey') { v = (skcGender() === 'm' ? EYE_KEY_M : EYE_KEY_F)[v] || ''; }
      else if (f === 'mo') { v = MOUTH_KEY[v] || ''; }
      /* ★ round529：这一趟改了几个部位就提交几个 ✗ 每个扣 1 张 ✓
         一次只发一条（服务端是串行扣卡的）✗ 按顺序发 ✓ */
      /* ★★ round529：先把这一趟的改动【抄一份】✗ 再逐条发 ✓
         踩过的坑：发第一条之后回执会把 SKC.pending 清空 ✗
                   第二条读 pending 就是 undefined ✗ 发出去被拒 ✓ */
      var _snap = [];
      for (var _k2 = 0; _k2 < fields.length; _k2++) {
        var _f3 = fields[_k2];
        var _v3 = SKC.pending[_f3];
        if (_f3 === 'ey') { _v3 = (skcGender() === 'm' ? EYE_KEY_M : EYE_KEY_F)[_v3] || ''; }
        else if (_f3 === 'mo') { _v3 = MOUTH_KEY[_v3] || ''; }
        _snap.push({ f: _f3, v: _v3 });
      }
      skcSay('正在保存 ' + _snap.length + ' 处…');
      var _i2 = 0;
      function _next() {
        if (_i2 >= _snap.length) { skcSay('已提交，等回执…'); return; }
        var one = _snap[_i2++];
        try { wsSend('skincustom', { skin: SKIN.sel, field: one.f, value: one.v }); } catch (e) { }
        setTimeout(_next, 320);        /* 给服务端一点时间扣卡 ✓ */
      }
      _next();
      ck2.disabled = true;
    });
  }
}
function skcSay(t) {
  var m = document.getElementById('skMsg');
  if (m) { m.textContent = t || ''; }
}

function skinOpen() {
  skinBind();
  skinCardUseBind();
  skcBind();
  skNavBind();
  try { if (WSC.ready) { wsSend('skinask', {}); } } catch (e) { }
  skinPreviewBoot();
  skinBindDrag();
  skinApplyCam();
  if (SKIN.items.length) { skinPageRender(); }
}

function skinBind() {
  if (SKIN._b) { return; }
  SKIN._b = 1;
  var u = document.getElementById('skUse');
  if (u) {
    u.addEventListener('click', function () {
      if (!SKIN.sel) { return; }
      try { wsSend('setskin', { key: SKIN.sel }); } catch (e) { }
    });
  }
  var b = document.getElementById('skBid');
  if (b) {
    b.addEventListener('click', function () {
      if (!SKIN.sel) { return; }
      var amt = parseInt((document.getElementById('skBidAmt') || {}).value, 10) || 0;
      var it = skinItemOf(SKIN.sel);
      var cur = 0;
      if (it && it.mine) { cur = +it.mine || 0; }
      var need = (cur === 0) ? SKIN.start : SKIN.step;
      if (amt < need) { skinSay('至少要出 ' + need + ' 金币'); return; }
      /* ★ 用户定：钱不退 ✗ 所以必须二次确认 ✓ */
      /* ★ 用户定：钱不退 ✗ 所以必须二次确认 ✓
         ★★ round493（用户："出价的提示弹窗，要做游戏里的，系统弹窗不合理"）
            → 换成游戏自己的 askConfirm（和批量出售/洗点同一个弹窗 ✓）✓ */
      var _it2 = skinItemOf(SKIN.sel);
      var _cur2 = (_it2 && _it2.mine) ? (+_it2.mine) : 0;
      var _tot2 = _cur2 + amt;
      var _nm2 = (_it2 && (_it2.n || _it2.k)) || SKIN.sel;
      askConfirm({
        title: '给「' + _nm2 + '」加价',
        lines: [
          '这次加价：<b style="color:#ffd83d">' + amt + '</b> 金币',
          '加完累计：<b style="color:#8ee0ff">' + _tot2 + '</b> 金币',
          '你现有：' + (SKIN.gold | 0) + ' 金币',
          '排名规则：累计前三名能用；第一名高出第二 30% 就只有他一个能用'
        ],
        warn: '★ 金币一扣就不退（被挤出前三也不退）',
        ok: '确认出价'
      }, function (yes) {
        if (!yes) { return; }
        try { wsSend('skinbid', { key: SKIN.sel, amount: amt }); } catch (e2) { }
        skinSay('正在出价…');
      });
      try { wsSend('skinbid', { key: SKIN.sel, amount: amt }); } catch (e2) { }
      skinSay('正在出价…');
    });
  }
  var grid = document.getElementById('skGrid');
  if (grid) {
    grid.addEventListener('click', function (ev) {
      var el = ev.target;
      while (el && el !== grid && !el.getAttribute('data-sk')) { el = el.parentNode; }
      if (el && el !== grid) { skinPick(el.getAttribute('data-sk')); }
    });
  }
}

function skinItemOf(k) {
  for (var i = 0; i < SKIN.items.length; i++) {
    if (SKIN.items[i].k === k) { return SKIN.items[i]; }
  }
  return null;
}

function skinSay(msg) {
  var el = document.getElementById('skMsg');
  if (el) { el.textContent = msg || ''; }
}

/* ---------- 40 宫格 ---------- */
function skinPageRender() {
  var grid = document.getElementById('skGrid');
  if (!grid) { return; }
  var html = '';
  for (var i = 0; i < SKIN.items.length; i++) {
    var it = SKIN.items[i];
    /* ★★ round494（用户："已拥有和没有区别不明显一眼看不出来"）
       → 四种状态【各有各的底色 + 边框 + 左边色条 + 图标】✓
          未获得：暗底 + 虚框 + 锁 + 灰字（一眼"没有"）
          已拥有：蓝底 + 实框 + ✓（亮）
          非前三/被独占：暗红底 + 红框（"有但不能用"）
          使用中：金底 + 粗金框 + ★（最亮）*/
    var nm2 = it.n || it.k;
    var bg, bd, fc, bar, icon, badgeTxt, badgeCol, op = '1';
    if (it.use) {
      bg = 'linear-gradient(180deg,#3a300f,#241d08)'; bd = '2px solid #ffd83d';
      fc = '#ffe9a0'; bar = '#ffd83d'; icon = '★'; badgeTxt = '使用中'; badgeCol = '#ffd83d';
    } else if (it.own && it.can) {
      bg = 'linear-gradient(180deg,#17324a,#111f2e)'; bd = '1px solid #3f86c8';
      fc = '#eaf2fb'; bar = '#4aa8e8'; icon = '✓'; badgeTxt = '已拥有'; badgeCol = '#7ee08a';
    } else if (it.own && !it.can) {
      bg = 'linear-gradient(180deg,#2b1a1a,#1c1111)'; bd = '1px solid #8a4a4a';
      fc = '#e8b8b0'; bar = '#c05050'; icon = '⊘';
      badgeTxt = (it.mode === 'solo' ? '被独占' : '非前三'); badgeCol = '#ff9a8a';
    } else {
      bg = '#0e131a'; bd = '1px dashed #ffffff1f';
      fc = '#6f7f90'; bar = '#2a3441'; icon = '🔒'; badgeTxt = '未获得'; badgeCol = '#6f7f90';
      op = '0.85';
    }
    var sel2 = (it.k === SKIN.sel) ? 'outline:2px solid #ffd83d;' : '';
    /* ★ round504：可用的皮肤 → 卡片右下角给一个「使用」小按钮
       ★ 不能用绝对定位（390 宽的手机上会盖住名字 / 跑出面板 ✗ 踩过两次）
       → 第二行用 flex 左右排：左边"已拥有 · f06"，右边"使用" ✓ 谁都不挤谁 ✓ */
    var canUse = (it.own && it.can && !it.use);
    html += '<div data-sk="' + it.k + '" style="cursor:pointer;position:relative;min-width:0;' +
      'padding:7px 8px 7px 13px;border-radius:9px;border:' + bd + ';background:' + bg + ';' +
      'opacity:' + op + ';' + sel2 + '">' +
      '<span style="position:absolute;left:0;top:0;bottom:0;width:4px;border-radius:9px 0 0 9px;' +
      'background:' + bar + '"></span>' +
      '<div style="font-size:13px;color:' + fc + ';white-space:nowrap;overflow:hidden;' +
      'text-overflow:ellipsis">' + icon + ' ' + nm2 + '</div>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:4px;margin-top:1px">' +
        '<span style="font-size:10px;color:' + badgeCol + ';white-space:nowrap;overflow:hidden;' +
        'text-overflow:ellipsis;min-width:0">' + badgeTxt +
        '<span style="color:#5a6a7a"> · ' + it.k + '</span></span>' +
        (canUse ? '<span class="sku" data-sk="' + it.k + '" style="flex:0 0 auto;padding:1px 6px;' +
          'border-radius:7px;background:#4aa8e8;color:#06121c;font-size:9.5px;font-weight:800;' +
          'letter-spacing:.5px">使用</span>' : '') +
      '</div>' +
      '</div>';
  }
  grid.innerHTML = html;
  if (!SKIN.sel && SKIN.items.length) { skinPick(SKIN.items[0].k); }
  else { skinDetail(); }
}

/* ---------- 右侧详情（榜单 / 按钮）---------- */
function skinDetail() {
  var it = skinItemOf(SKIN.sel);
  var nm = document.getElementById('skName');
  var st = document.getElementById('skState');
  var rk = document.getElementById('skRank');
  var useB = document.getElementById('skUse');
  var bidB = document.getElementById('skBid');
  var amt = document.getElementById('skBidAmt');
  if (!it) { return; }
  if (nm) { nm.textContent = (it.n || it.k) + '（' + it.k + '）'; }

  var state = '';
  if (!it.own) { state = '还没获得 —— 打怪有 1% 掉「皮肤卡」，也可以去交易所买别人的'; }
  else if (!it.can) {
    state = (it.mode === 'solo') ? '被第一名独占了（他比第二名高出 30%）' : '只有出价前三名能用';
  } else if (it.use) { state = '正在使用'; }
  else { state = '已获得 · 可以用'; }
  if (st) { st.textContent = state; }

  var top = it.top || [];
  var html = '';
  if (!top.length) {
    html = '<div style="color:#7ee08a">现在没人出价 → 所有获得的人都能用</div>';
  } else {
    for (var i = 0; i < top.length; i++) {
      var mark = ['①', '②', '③'][i] || (i + 1);
      html += '<div>' + mark + ' ' + top[i].name + ' · <b style="color:#ffd83d">' +
        (top[i].total | 0) + '</b> 金币</div>';
    }
    if (it.mode === 'solo') {
      html += '<div style="color:#ff9a9a">★ 第一名高出 30% → 只有他能用</div>';
    }
  }
  if (it.mine) { html += '<div style="color:#8ee0ff">我的累计出价：' + (it.mine | 0) + '</div>'; }
  html += '<div class="bagTip">起拍 ' + SKIN.start + ' · 每次至少加 ' + SKIN.step + '</div>';
  if (rk) { rk.innerHTML = html; }

  /* ★ round511：「自定义」只有【拥有的皮肤】能点（能不能出场另说 ✓ 染色跟竞价无关）*/
  var cusB = document.getElementById('skCustom');
  if (cusB) {
    /* ★ round528（用户："自定义皮肤，要选择使用后才能改"）
       → 只有【正在使用】的皮肤能自定义 ✓ 没穿上的点了也没意义 ✓ */
    cusB.disabled = !it.use;
    cusB.textContent = it.use ? '自定义' : '先使用';
  }
  if (useB) {
    useB.disabled = !(it.own && it.can && !it.use);
    /* ★ round504：不能用时按钮上直接写原因 ✗ 免得玩家以为是没做 ✓ */
    if (it.use) { useB.textContent = '使用中'; }
    else if (!it.own) { useB.textContent = '未获得'; }
    else if (!it.can) { useB.textContent = (it.mode === 'solo') ? '被独占' : '限前三'; }
    else { useB.textContent = '使 用'; }
  }
  if (bidB) { bidB.disabled = !it.own; }
  if (amt) { amt.value = String((it.mine ? SKIN.step : SKIN.start)); }
  skinPreviewShow(it.k);
}

/* ★ round504：卡片上那个「使用」按钮（委托在 #skGrid 上 ✓ 卡片是 innerHTML 重建的 ✓）*/
function skinCardUseBind() {
  var grid = document.getElementById('skGrid');
  if (!grid || grid._uBound) { return; }
  grid._uBound = true;
  grid.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== grid && !(t.className && String(t.className).indexOf('sku') >= 0)) {
      t = t.parentNode;
    }
    if (!t || t === grid) { return; }
    e.stopPropagation();
    var k = t.getAttribute('data-sk');
    if (!k) { return; }
    SKIN.sel = k;
    try { wsSend('setskin', { key: k }); } catch (e2) { }
    skinSay('正在换…');
  }, true);
}

function skinPick(k) {
  SKIN.sel = k;
  var cards = document.querySelectorAll('#skGrid [data-sk]');
  for (var i = 0; i < cards.length; i++) {
    cards[i].style.outline = (cards[i].getAttribute('data-sk') === k)
      ? '2px solid #ffd83d' : 'none';
  }
  skinDetail();
}

/* ---------- 3D 预览（和游戏里同一个构建器）---------- */
function skinPreviewBoot() {
  if (SKIN.ready) { return; }
  var cv = document.getElementById('skCv');
  if (!cv || typeof THREE === 'undefined') { return; }
  try {
    /* ★★★ 2026-10-23（用户："直接避免 WebGL 失败" → 共用主渲染器）★★★
       skCv 现在是普通 2D 画布 ✗ 每次要出图时借主渲染器渲一帧 → readPixels → 画到这里 ✓
       全页面 WebGL 上下文恒等于 1（只有 #cv）✓ */
    var _w0 = 420, _h0 = 170;
    cv.width = _w0; cv.height = _h0;
    SKIN.cv = cv;
    SKIN.scene = new THREE.Scene();
    SKIN.cam = new THREE.OrthographicCamera(-1.75, 1.75, 1.12, -1.12, 0.1, 100);
    SKIN.cam.position.set(0, 0.98, 40);
    SKIN.cam.lookAt(0, 0.98, 0);
    /* ★ round515（用户："预览的模型可以滑动调整角度、以及放大缩小"）
       正交相机：改 left/right/top/bottom 就是缩放 ✓ 改 position.y 就是上下看 ✓ */
    SKIN.zoom = 1.30; SKIN.camY = 0.98; SKIN.camPitch = 0;   /* ★ round526：默认拉远一点（模型别占满）*/
    /* ★ round516（用户："放大、拖动后就取消自转"）
       ★ 手动动过视角就别再自己转 ✗ 不然刚摆好的角度马上被转走 ✓
       ★ 换皮肤 / 重新打开面板时恢复自转 ✓ */
    SKIN.autoRot = true;
    SKIN.scene.add(new THREE.HemisphereLight(0xffffff, 0x2a3242, 0.65));
    var d1 = new THREE.DirectionalLight(0xffffff, 0.6); d1.position.set(5, 9, 12);
    SKIN.scene.add(d1);
    var d2 = new THREE.DirectionalLight(0x9ac0ff, 0.25); d2.position.set(-8, 4, -6);
    SKIN.scene.add(d2);
    SKIN.ready = true;
  } catch (e) { SKIN.ready = false; }
}

function skinPreviewShow(key) {
  SKIN.autoRot = true;                 /* ★ 换皮肤 → 恢复自转 ✓ */
  /* ★ 换皮肤 → 这一趟的"待提交"作废（不同皮肤的改动不能混）✓ */
  try { if (typeof SKC !== 'undefined') { SKC.pending = {}; SKC.base = (typeof skcCustomOf === 'function') ? skcCustomOf(key) : {}; } } catch (e1) { }
  if (!SKIN.ready) { skinPreviewBoot(); }
  if (!SKIN.ready) { return; }
  try {
    if (SKIN.hero) {
      SKIN.scene.remove(SKIN.hero.g);
      SKIN.hero.g.traverse(function (o) {
        if (o.isMesh && o.geometry) { o.geometry.dispose(); }
      });
      SKIN.hero = null;
    }
    /* ★★ round531（用户："选中这个皮肤就应该显示我改过的样子"）
       → 预览直接用【这套皮肤的自定义】建 ✗ 不用等点任何东西 ✓ */
    var _cs = {};
    try {
      if (typeof skcCustomOf === 'function') { _cs = skcCustomOf(key); }
    } catch (e0) { _cs = {}; }
    var h = skBuildHero(key, _cs);
    if (!h) { return; }
    h.g.scale.set(0.66, 0.66, 0.66);
    h.g.position.set(0, 0.05, 0);
    SKIN.scene.add(h.g);
    SKIN.hero = h;
    skinPreviewTick();
  } catch (e) { }
}

/* ★ 正交相机：按 zoom 重算视口 + 按 camY/camPitch 摆位置 ✓ */
function skinApplyCam() {
  if (!SKIN.cam) { return; }
  var z = Math.max(0.45, Math.min(2.6, SKIN.zoom || 1));
  SKIN.zoom = z;
  var w = 1.75 * z, h = 1.12 * z;
  SKIN.cam.left = -w; SKIN.cam.right = w;
  SKIN.cam.top = h; SKIN.cam.bottom = -h;
  var y = (SKIN.camY || 0.98);
  var p = SKIN.camPitch || 0;          /* 0 = 平视 ✗ >0 往下看 ✓ */
  SKIN.cam.position.set(0, y + 40 * Math.sin(p), 40 * Math.cos(p));
  SKIN.cam.lookAt(0, y, 0);
  SKIN.cam.updateProjectionMatrix();
}

function skinBindDrag() {
  var cv = document.getElementById('skCv');
  if (!cv || cv._dragBound) { return; }
  cv._dragBound = true;
  cv.style.cursor = 'grab';
  /* ★ 手机上也别让浏览器抢走手势（否则就是"拖不动 / 一卡一卡"）✓ */
  try { cv.style.touchAction = 'none'; } catch (e0) { }
  var st = null;
  cv.addEventListener('pointerdown', function (e) {
    /* ★ 注意别把"鼠标坐标"和"相机高度"存成同一个字段 ✗ 会算飞（踩过）✓ */
    st = { px: e.clientX, py: e.clientY, rot: SKIN.rot, cy: (SKIN.camY || 0.98) };
    SKIN.autoRot = false;               /* ★ 手动拖了 → 停自转 */
    try { cv.setPointerCapture(e.pointerId); } catch (e0) { }
    cv.style.cursor = 'grabbing';
    if (e.preventDefault) { e.preventDefault(); }
  });
  cv.addEventListener('pointermove', function (e) {
    if (!st) { return; }
    SKIN.rot = st.rot + (e.clientX - st.px) * 0.012;     /* 左右拖 = 转 */
    /* ★ 上下拖动灵敏度 0.004 → 0.006，范围也放宽一点 ✓ */
    SKIN.camY = Math.max(0.25, Math.min(2.10, st.cy - (e.clientY - st.py) * 0.006));
    if (SKIN.hero) { SKIN.hero.g.rotation.y = SKIN.rot; }
    skinApplyCam();
  });
  function up() { st = null; cv.style.cursor = 'grab'; }
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  /* 滚轮缩放（电脑）*/
  cv.addEventListener('wheel', function (e) {
    SKIN.autoRot = false;               /* ★ 手动缩放 → 停自转 */
    SKIN.zoom *= (e.deltaY > 0 ? 1.08 : 0.92);
    skinApplyCam();
    if (e.preventDefault) { e.preventDefault(); }
  }, { passive: false });
  /* 双指缩放（手机）*/
  var pd0 = 0;
  cv.addEventListener('touchmove', function (e) {
    if (!e.touches || e.touches.length !== 2) { return; }
    var dx = e.touches[0].clientX - e.touches[1].clientX;
    var dy = e.touches[0].clientY - e.touches[1].clientY;
    var d = Math.hypot(dx, dy);
    if (pd0) {
      SKIN.autoRot = false;             /* ★ 双指缩放 → 停自转 */
      SKIN.zoom *= (pd0 / d);
      skinApplyCam();
    }
    pd0 = d;
    if (e.preventDefault) { e.preventDefault(); }
  }, { passive: false });
  cv.addEventListener('touchend', function () { pd0 = 0; });
}

/* ★ 2026-10-23：皮肤预览出图（借主渲染器 ✗ 不再有自己的 WebGL 上下文 ✓）
   ★ 限频 ~20fps：readPixels 比普通 render 贵 ✗ 每帧读会拖慢主循环 ✓ */
function skinPreviewDraw(force) {
  if (!SKIN.ready || !SKIN.hero || !SKIN.cv) { return; }
  /* ★ 2026-10-23（闪黑）：页面没显示就【彻底不渲】✗ 别在后台/关掉之后还借主渲染器 ✓ */
  if (!force) {
    var _p = document.querySelector('.tabpane[data-pane="skin"]');
    if (!_p || _p.className.indexOf('on') < 0) { return; }
    var _set = document.getElementById('setPanel');
    if (_set && _set.style.display === 'none') { return; }
  }
  var now = (performance.now ? performance.now() : Date.now());
  if (!force && SKIN._lastDraw && (now - SKIN._lastDraw) < 45) { return; }
  SKIN._lastDraw = now;
  try {
    UI.renderSceneTo2D(SKIN.scene, SKIN.cam, SKIN.cv, 420, 170);
  } catch (e) { }
}

function skinPreviewTick(ts) {
  if (!SKIN.ready || !SKIN.hero) { return; }
  /* ★★ round505（用户："皮肤页面展示的预览效果自转太快了"）
     ★ 病根：原来是【每帧固定 +0.012 弧度】✗
       60Hz 屏 ≈ 41°/秒，120Hz 屏直接 ×2 ≈ 82°/秒 ✓（高刷手机看着就是"飞转"）
     ★ 修：按【真实时间】转 ✗ 0.30 弧度/秒 ≈ 17°/秒（转一圈约 21 秒 ✓ 慢慢转）*/
  var _now = (typeof ts === 'number') ? ts : (performance.now ? performance.now() : 0);
  var _dt = SKIN._t ? (_now - SKIN._t) / 1000 : 0.016;
  SKIN._t = _now;
  if (!(_dt > 0) || _dt > 0.2) { _dt = 0.016; }
  if (SKIN.autoRot !== false) { SKIN.rot += _dt * 0.30; }
  SKIN.hero.g.rotation.y = SKIN.rot;
  skinPreviewDraw();
  var pane = document.querySelector('.tabpane[data-pane="skin"]');
  if (pane && pane.className.indexOf('on') >= 0) {
    requestAnimationFrame(skinPreviewTick);
  }
}

/* ---------- closeSet / doLogout（第 32 轮）---------- */
function closeSet() {
  bagTipHide();
  var p = document.getElementById('setPanel');
  if (p) { p.style.display = 'none'; }
  try { sysMsgSetTop(false); } catch (eCS) { }
}

/* ★ 登出（清 token → 通知服务器废掉 → 断开 → 弹登录）
   原来界面上根本没有"登出/切换账号"的入口 —— 只有一个"← 回 2D 版"的外链，
   那条链在这个独立版里是错的目标（回的是旧页面），已删 ✓ 现在入口在 设置 → 信息 ✓ */
function doLogout() {
  var tk = WSC.token;
  if (tk) {
    // 通知服务器把 token 作废（失败也无所谓，本地照样清 ✓）
    try {
      fetch('/api/logout', { method: 'POST', headers: { 'X-Token': tk } })
        .catch(function () { });
    } catch (e) { }
  }
  try { localStorage.removeItem('token'); } catch (e2) { }
  WSC.token = ''; WSC.on = false; WSC.ready = false; WSC.role = null;
  netGoOffline();                                    // ★ 收掉别人 / 停发包循环 ✓
  try { if (WSC.sock) { WSC.sock.close(); } } catch (e3) { }
  closeSet();
  toast('已登出');
  showLogin('');
  if (typeof loadProfile === 'function') { loadProfile(); }
}

/* ---------- openSet ---------- */
var UI_THEME_STORE = 'uiTheme_v1';
var UI_THEMES = ['dark', 'black', 'light', 'pink', 'gray', 'blue', 'glass'];
function uiThemeApply(name) {
  if (UI_THEMES.indexOf(name) < 0) { name = 'gray'; }
  try { document.body.setAttribute('data-theme', name); } catch (e) { }
  try { localStorage.setItem(UI_THEME_STORE, name); } catch (e2) { }
  try {
    var bs = document.querySelectorAll('#themeBtns [data-theme]');
    for (var i = 0; i < bs.length; i++) {
      var on = (bs[i].getAttribute('data-theme') === name);
      bs[i].className = 'bagB' + (on ? ' on' : '');
    }
  } catch (e3) { }
}
function uiThemeBind() {
  var box = document.getElementById('themeBtns');
  if (!box) { return; }
  if (!box._b) {
    box._b = true;
    box.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== box && !(t.getAttribute && t.getAttribute('data-theme'))) { t = t.parentNode; }
      if (t && t !== box) { uiThemeApply(t.getAttribute('data-theme')); }
    });
  }
  var cur = 'gray';
  try { cur = localStorage.getItem(UI_THEME_STORE) || document.body.getAttribute('data-theme') || 'gray'; } catch (e) { }
  uiThemeApply(cur);
}
try { uiThemeApply(localStorage.getItem(UI_THEME_STORE) || 'gray'); } catch (eTh0) { }

function openSet(wantTab) {
  try { sysMsgBindSizeBtns(); } catch (eSO) { }
  var p = document.getElementById('setPanel');
  if (!p) { return; }
  try { if (typeof whClose === 'function') { whClose(); } } catch (eWhC) { }
  /* 打开菜单时收起视角工具面板，避免盖住菜单 */
  try {
    if (typeof CAMROT !== 'undefined') { CAMROT.on = false; }
    if (typeof camApplyVisual === 'function') { camApplyVisual(); }
  } catch (eCamClose) { }
  p.style.display = 'block';
  // ★ 第 48 轮：openSet('bag') 可以直接停在背包页（快捷键 B 用 ✓）
  if (wantTab) { setTab(wantTab); }
  ptBind();                                   // ★ 第 83 轮：组队页绑定 ✓
  try { camSettingsBind(); } catch (eCS) { }   // round606：设置里的视角/横竖屏
  try { uiThemeBind(); } catch (eTh) { }       // round607：界面主题
  if ((SETCFG.setTab || '') === 'party') { lobbyFetch(ptRender); }
  /* ★ 第 119 轮：这两处钩子已经收进 setTab() 里了 ✗（不留两份 ✗）*/
   // ★ 第 113 轮：属性页 ✓
  if ((SETCFG.setTab || '') === 'bag') { bagFetch(bagRender); }   // 打开时拉一次背包 ✓
  mkOpts('rowDpr', [{ v: 1.0, t: '1.0x', s: '省' }, { v: 1.5, t: '1.5x', s: '较快' },
                    { v: 2.0, t: '2.0x', s: '清晰' }, { v: 2.5, t: '2.5x', s: '很清晰' },
                    { v: 3.0, t: '3.0x', s: '最清晰' }], 'dpr', setDpr());
  mkOpts('rowShadow', [{ v: 'high', t: '高', s: '2048 · 默认' },
                       { v: 'mid', t: '中', s: '1024 · 省' },
                       { v: 'off', t: '关', s: '最快' }], 'shadow', setShadow());
  mkOpts('rowAA', [{ v: 'off', t: '关', s: '最快' }, { v: 'fxaa', t: 'FXAA', s: '低开销' },
                   { v: 'msaa', t: 'MSAA', s: '最干净' }], 'aa', setAA());
  mkOpts('rowDet', [{ v: 'low', t: '低', s: '±16 格' }, { v: 'mid', t: '中', s: '±28 格' },
                    { v: 'high', t: '高', s: '±40 格' }], 'detail', setDetail());
  /* ★★ round508：这两个开关【已经从界面删掉】✗（用户要求）
     DOM 没了 → _ao/_al 是 null → 下面的分支自然跳过 ✓ 留着不删：
     万一以后又想把"自动捡东西"放回来，逻辑还在 ✓
     ★ 自动战斗本身还有右下角那个「挂机」按钮 ✓ 功能没丢 ✓ */
  /* ★★ 第 210 轮：自动战斗的设置项（放在"操作"分类最前面 ✓）★★ */
  var _ao = document.getElementById('setAutoOn');
  if (_ao) {
    _ao.checked = !!(typeof AUTO !== 'undefined' && AUTO.on);
    _ao.onchange = function () {
      if (typeof AUTO === 'undefined') { return; }
      if (!!AUTO.on !== _ao.checked) { autoToggle(); }
    };
  }
  /* ★ round466：自动出售下拉（服务器为准 ✗ 存在 role.autosell 里）*/
  var _asel = document.getElementById('setAutoSell');
  if (_asel) {
    var _cur = +(((WSC.role || {}).autosell) || 0);
    _asel.value = String(_cur);
    _asel.onchange = function () {
      var v = Math.max(0, Math.min(12, +_asel.value || 0));
      try { wsSend('autosell', { tier: v }); } catch (e) { }
      try { SETCFG.autoSell = v; saveSet(); } catch (e2) { }
      try { WSC.role.autosell = v; } catch (e3) { }   /* 本地先跟上（服务器下次登录也会告诉我们）*/
      var h = document.getElementById('setAutoSellHint');
      if (h) {
        h.textContent = v > 0
          ? ('★ 当前：低于 ' + v + ' 阶的装备拾取就卖（不进背包）')
          : '★ 当前：不自动卖';
      }
    };
  }
  var _al = document.getElementById('setAutoLoot');
  if (_al) {
    _al.checked = !(typeof AUTO !== 'undefined' && AUTO.lootOn === false);
    _al.onchange = function () {
      if (typeof AUTO === 'undefined') { return; }
      AUTO.lootOn = _al.checked;
      try { SETCFG.autoLoot = _al.checked; saveSet(); } catch (e) { }
      toast(_al.checked ? '自动捡东西：开' : '自动捡东西：关');
    };
  }
  /* ★ 操作分类：攻击键大小（第 31 轮）—— 改完立刻生效（applySet 写 --atk 变量 ✓）*/
  mkOpts('rowAtk', [{ v: 64, t: '小', s: '64' }, { v: 84, t: '中', s: '84 · 默认' },
                    { v: 108, t: '大', s: '108' }, { v: 132, t: '特大', s: '132' }],
         'atkSize', setAtkSize());
  /* ★ round422：画面放大的档位（100 = 现在 ✗ 只能往大走 ✓）*/
  /* ★★ round531（用户："游戏相机画面改成大小滑动，最小 60%，最大 300%"）
     → 五档按钮换成滑条 ✗ 拖动实时生效 ✓ */
  var zr = document.getElementById('zoomRange');
  var zv = document.getElementById('zoomVal');
  if (zr) {
    var _zv0 = (typeof setWorldZoom === 'function') ? setWorldZoom() : 100;
    zr.value = String(_zv0);
    if (zv) { zv.textContent = _zv0 + '%'; }
    if (!zr._b) {
      zr._b = true;
      zr.addEventListener('input', function () {
        var v = Math.max(30, Math.min(500, parseInt(zr.value, 10) || 100));
        SETCFG.zoom = v;
        saveSet();
        if (zv) { zv.textContent = v + '%'; }
        try { applyWorldZoom(); } catch (e0) { }
      });
    }
  }
  // ★ 音效开关 + 音量 ✓
  var srow = document.getElementById('rowSfx');
  if (srow) {
    srow.innerHTML = '';
    var sd = document.createElement('div');
    sd.className = 'opt' + (SFX_ON ? ' on' : '');
    sd.innerHTML = '音效 ' + (SFX_ON ? '开' : '关');
    var st = function (e) { if (e) { e.preventDefault(); } SFX_ON = !SFX_ON; SETCFG.sfx = SFX_ON; if (SFX_ON) { unlockAudio(); sfx('hit'); } saveSet(); openSet(); };
    sd.addEventListener('touchstart', st, { passive: false }); sd.addEventListener('click', st);
    srow.appendChild(sd);
    /* ★ 音量：拖动进度条（0~100% ✓ 实时生效 ✓ 自动保存 ✓）*/
    var vwrap = document.createElement('div');
    vwrap.style.cssText = 'flex:1;display:flex;align-items:center;gap:8px;min-width:150px';
    var vlab = document.createElement('span');
    vlab.style.cssText = 'font-size:11px;color:#b9c2cf;min-width:34px';
    vlab.textContent = Math.round(SFX_VOL * 100) + '%';
    var vr = document.createElement('input');
    vr.type = 'range'; vr.min = '0'; vr.max = '100'; vr.step = '5';
    vr.value = String(Math.round(SFX_VOL * 100));
    vr.style.cssText = 'flex:1;height:26px;accent-color:#ffd83d;cursor:pointer';
    function setVol(pct) {
      SFX_VOL = Math.max(0, Math.min(1, pct / 100));
      SETCFG.vol = SFX_VOL;
      vlab.textContent = Math.round(SFX_VOL * 100) + '%';
      for (var kk in SFX_BANK) { for (var jj = 0; jj < SFX_BANK[kk].length; jj++) { SFX_BANK[kk][jj].volume = SFX_VOL; } }
      saveSet();
    }
    vr.addEventListener('input', function (e) { setVol(parseFloat(vr.value)); });
    vr.addEventListener('change', function (e) { setVol(parseFloat(vr.value)); sfx('hit', 0.8); });
    vr.addEventListener('touchstart', function (e) { e.stopPropagation(); }, { passive: true });
    vr.addEventListener('touchmove', function (e) { e.stopPropagation(); }, { passive: true });
    vwrap.appendChild(vlab); vwrap.appendChild(vr);
    srow.appendChild(vwrap);
  }
  /* ★ 调试与测试按钮 ✓ */
  var drow = document.getElementById('rowDbg');
  if (drow) {
    drow.innerHTML = '';
    function addBtn(label, fn, active) {
      var b = document.createElement('div');
      b.className = 'opt' + (active ? ' on' : '');
      b.innerHTML = label;
      var h2 = function (e) { if (e) { e.preventDefault(); } fn(); };
      b.addEventListener('touchstart', h2, { passive: false });
      b.addEventListener('click', h2);
      drow.appendChild(b);
      return b;
    }
    /* ★★ 第 48 轮：玩家端的"刷怪/发武器"全部【搬到管理页】了 ✗ ★★
       以前任何玩家点这里就能自己刷一堆怪（联机时走 spawn 意图，服务器真给他刷 ✗）
       现在服务器【默认拒绝】那条意图（config 的 allow_player_debug=false ✓）
       要临时调试：改 config 打开，或者直接用 /admin 页 ✓ */
    addBtn('刷怪已移到管理页（/admin）', function () {
      toast('刷怪/发武器在管理页：浏览器打开 /admin');
      openSet();
    });
    addBtn('生成 50 只', function () { spawnStress(50); openSet(); });
    addBtn('补满到上限 ' + G.MOB_MAX, function () { spawnStress(G.MOB_MAX); openSet(); });
    addBtn('持续生成（每秒+5）', function () { toggleGrow(); openSet(); }, _growTimer);
    addBtn('清除多余僵尸', function () { clearMobs(); openSet(); });
    addBtn('碰撞箱线框', function () { toggleBox(); openSet(); }, _boxOn);
    /* ★ 2026-10-22（用户连续报"看不见的墙"）：站到卡住的位置点这个，
       会把挡人的盒子画成红框并报出它属于哪张表 */
    addBtn('诊断卡住（红框标出挡路的东西）', function () { stuckReport(); openSet(); });
    addBtn('地面贴图调试', function () { cycleTex(); openSet(); });
    /* ★ 第 48 轮：发武器也是【管理页的能力】了（玩家端默认被拒 ✓）
       留这个按钮是为了本地调试：把 config 的 allow_player_debug 改成 true 就能用 ✓
       没开的话服务器会回一条提示、这里会弹出来（不会静默失败 ✓）*/
    addBtn('调试：给我一件武器', function () { wsSend('giveweapon', {}); closeSet(); });
    /* ★★ 玩家互相伤害（PvP）开关 —— 全服统一 ✓ 关着的时候砍人只出动作不掉血 ✓ */
    addBtn((NET.pvp ? '☑ ' : '☐ ') + '玩家互相伤害（PvP）' + (NET.on ? '' : ' · 需联机'),
           function () { netSetPvp(!NET.pvp); openSet(); }, !!NET.pvp);
    /* ★ 妖兽是否对玩家造成伤害（另一个开关 ✓ 和 PvP 互不影响 ✓ 测试/看风景用）*/
    addBtn((mobDmgOn() ? '☑ ' : '☐ ') + '妖兽对玩家造成伤害',
           function () { SETCFG.mobDmg = !mobDmgOn(); saveSet(); openSet(); }, mobDmgOn());
  }

  /* ★ 信息框（打开时刷新一次 ✓ 之后每帧自动更新 ✓）*/
  var ib = document.getElementById('infoBox');
  if (ib) { ib.textContent = infoText(); }

  /* ★ 显示（画面分类）：FPS / 面板开关 ✓ */
  var disp = document.getElementById('rowDisp');
  if (disp) {
    disp.innerHTML = '';
    var d2 = document.createElement('div');
    d2.className = 'opt' + ((SETCFG.showFps !== false) ? ' on' : '');
    d2.innerHTML = '显示 FPS / 诊断';
    var tg = function (e) { if (e) { e.preventDefault(); } SETCFG.showFps = !(SETCFG.showFps !== false); saveSet(); applySet(); openSet(); };
    d2.addEventListener('touchstart', tg, { passive: false });
    d2.addEventListener('click', tg);
    disp.appendChild(d2);
    /* ★ round426：性能面板开关（同一排 ✓ 默认关 ✓）*/
    var d3 = document.createElement('div');
    d3.className = 'opt' + (SETCFG.perf ? ' on' : '');
    d3.innerHTML = '性能面板';
    var tg3 = function (e) {
      if (e) { e.preventDefault(); }
      SETCFG.perf = !SETCFG.perf; saveSet(); applySet(); openSet();
    };
    d3.addEventListener('touchstart', tg3, { passive: false });
    d3.addEventListener('click', tg3);
    disp.appendChild(d3);
  }

  /* ★ 账号（第 32 轮）：登录 / 登出 / 切换账号都挪到这儿了 ✓ */
  var acct = document.getElementById('rowAcct');
  var ridEl = document.getElementById('rowRoleId');
  if (ridEl) {
    ridEl.textContent = (WSC.ready && WSC.role && WSC.role.id)
      ? ('#' + WSC.role.id) : '（登录后显示）';
  }
  if (acct) {
    acct.innerHTML = '';
    var who = document.createElement('div');
    who.className = 'opt';
    who.style.cssText = 'cursor:default;background:#1b2430';
    who.innerHTML = (WSC.ready && WSC.role)
      ? ('已登录：' + (WSC.role.name || '?') + '（炼气 ' + (WSC.role.level || 1) + ' 层）')
      : (WSC.on ? '连接中…' : '未登录');
    acct.appendChild(who);
    var logged = !!(WSC.on || WSC.token);
    var ab = document.createElement('div');
    ab.className = 'opt';
    ab.innerHTML = logged ? '登出 / 切换账号' : '登录 / 注册';
    var ah = function (e) {
      if (e) { e.preventDefault(); }
      if (logged) { doLogout(); } else { closeSet(); showLogin(''); }
    };
    ab.addEventListener('touchstart', ah, { passive: false });
    ab.addEventListener('click', ah);
    acct.appendChild(ab);
  }

  /* ★ 信息分类：版本 + 实时信息 ✓ */
  var av = document.getElementById('aboutVer');
  if (av) {
    /* ★ round457：把构建号也显示出来 ✗ 方便确认"刷新后到底是不是新版本" ✓ */
    var _bmeta = document.querySelector('meta[name="build"]');
    var _bver = _bmeta ? _bmeta.getAttribute('content') : '?';
    av.innerHTML = '块来修仙 · 末日丧尸 × 组队修仙<br>' +
      '协议 v' + PROTO_VER +
      (WSC && WSC.on ? ' · 已联机' : ' · 单机/未联机') +
      (WSC && WSC.role ? ' · 角色 ' + (WSC.role.name || '') : '') + '<br>' +
      '攻击键 ' + setAtkSize() + 'px';
  }

  /* ★ 分类导航：按记住的那一页显示（第 31 轮）✓ */
  tabScrollInit();   // ★ 第 115 轮：菜单导航可拖动/滚轮横滑 ✓
  /* ★★ 第 190 轮：这三行【原来在这里（openSet 里）】是错的 ✗✗
     后果：只有"打开过一次菜单"才会绑定传送按钮 ✓
           而玩家根本不用进菜单点它 ✓ → 按钮永远没反应 ✓✓
           （用户原话："我现在没有在菜单里看到按钮，而是直接在游戏界面看到的"✓
             正好说明他从来没开过菜单 ✓）
     → 已挪到【文件末尾的模块顶层】执行 ✓ 见文件最后那块 ✓ */
  setTab(SETCFG.setTab || 'view');
  /* ★ 第 119 轮：这两处钩子已经收进 setTab() 里了 ✗（不留两份 ✗）*/

}

/* ============================================================
   ★ 背包 / 装备（第 47 轮做内容，第 48 轮改成【菜单里的标签页】）
   为什么要它：武器会掉了，可是玩家【看不见、穿不上】✗ —— 那系统等于不存在 ✗
   ★ 这一层是唯一能碰 DOM 的（core 只给数值 ✓）
   ★ 穿上/脱下由【服务器】判定（是不是他的、等级够不够 ✓）—— 这里只发意图 ✓
   ============================================================ */
/* ★★ 图标：全部【程序画】的 SVG 描边 ★★
   为什么不放图片素材：和武器模型一个思路 —— 不加素材 ✓ 也就不用担心版权/加载 ✓
   颜色走 currentColor → 由【品阶色】着色（和地上掉落物用的是同一套 LOOT_COL ✓ 玩家能对上）*/
/* ★ 材料图标：描边风（class=micon 才吃到 CSS 的 stroke 样式 ✓）*/
var ICON_SVG = function (d) { return '<svg class="micon" viewBox="0 0 24 24" stroke="currentColor">' + d + '</svg>'; };
var ITEM_ICON = {
  sword:  ICON_SVG('<path d="M12 2v13"/><path d="M8.5 15h7"/><path d="M12 15v6"/>'),
  dagger: ICON_SVG('<path d="M12 5v9"/><path d="M9.5 14h5"/><path d="M12 14v5"/>'),
  saber:  ICON_SVG('<path d="M13.5 2c-1 5-3.5 9-6.5 12"/><path d="M7 14h5"/><path d="M11 14l1 6"/>'),
  staff:  ICON_SVG('<path d="M12 2v20"/><path d="M9 4h6"/><path d="M9 20h6"/>'),
  spear:  ICON_SVG('<path d="M12 4v18"/><path d="M12 3l-2.5 5M12 3l2.5 5"/><path d="M9 9h6"/>'),
  axe:    ICON_SVG('<path d="M10 3v18"/><path d="M10 6c5 0 8 2 8 5s-3 5-8 5"/>'),
  hammer: ICON_SVG('<path d="M12 4v17"/><path d="M7 4h10v6H7z"/>'),
  bow:    ICON_SVG('<path d="M6 3c6 3 6 15 0 18"/><path d="M6 3v18"/><path d="M6 3l2 3M6 21l2-3"/>'),
  cloth:  ICON_SVG('<path d="M4 8l4-4 4 4 4-4 4 4v8l-4 4-4-4-4 4-4-4z"/>'),
  iron:   ICON_SVG('<path d="M4 8h16v8H4z"/><path d="M8 8v8M16 8v8"/>'),
  gear:   ICON_SVG('<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>'),
  vial:   ICON_SVG('<path d="M10 3h4v4l3 9a3 3 0 0 1-3 4h-4a3 3 0 0 1-3-4l3-9z"/><path d="M8.5 14h7"/>'),
  crystal:ICON_SVG('<path d="M12 2l6 6-6 14-6-14z"/><path d="M6 8h12"/>'),
  bone:   ICON_SVG('<path d="M7 7l10 10"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/>'),
  batt:   ICON_SVG('<path d="M4 8h13v8H4z"/><path d="M19 11v2"/><path d="M7 10v4M10 10v4"/>'),
  glass:  ICON_SVG('<path d="M6 3l2 18M18 3l-2 18"/><path d="M7 9h10M6.6 15h10.8"/>'),
  band:   ICON_SVG('<path d="M4 14l10-10 6 6-10 10z"/><path d="M9 9l6 6M12 6l6 6"/>'),
  box:    ICON_SVG('<path d="M4 7l8-4 8 4v10l-8 4-8-4z"/><path d="M4 7l8 4 8-4M12 11v10"/>'),
  /* ★ round340（用户："石头和木材图标要看起来像对应的材料"）
     三种建材的图标：原木（带年轮）/ 石头（多面块）/ 砖头（砌法）*/
  wood:   ICON_SVG('<path d="M4 7h13l3 2-3 2H4z"/><path d="M4 13h13l3 2-3 2H4z"/><path d="M7 8.6v2.8M11 8.6v2.8M7 14.6v2.8M11 14.6v2.8"/>'),
  stone:  ICON_SVG('<path d="M6 8l5-4 7 2 2 7-4 6-7 1-4-5z"/><path d="M11 4l1 6 6-1M12 10l-3 4 5 1"/>'),
  brick:  ICON_SVG('<path d="M3 6h18v12H3z"/><path d="M3 12h18M9 6v6M15 12v6M9 12v6M15 6v6"/>')
};
var MAT_ICON_BY_NAME = {
  '破布': 'cloth', '绷带': 'band', '锈铁': 'iron', '螺丝钉': 'gear', '生锈齿轮': 'gear',
  '碎玻璃': 'glass', '灵气结晶': 'crystal', '兽骨': 'bone', '电池': 'batt',
  '疫苗': 'vial', '铜线卷': 'gear',
  '木材': 'wood', '石块': 'stone', '砖头': 'brick'
};
/* ★★ 第 99 轮：用户从 6 个候选里选了【②带肩甲的盔甲样式】★★
   （预览页在 web/preview_armor.html ✓ 以后想换回来对照着挑 ✓）
   三部分拼的：
     · 胸甲主体（圆肩 + 收腰 ✓）
     · 两侧肩甲（半透明 ✓ 一眼看出是"穿在身上的甲"✓）
     · 中缝（深色线 ✓ 不管品阶是什么颜色都看得清 ✓）*/
/* ★★★ 第 125 轮：用户从预览页里挑定了【第三期 ② 龙鳞胸甲】★★★
   （页面 web/preview_armor3.html ✓ 以后想换回来照着挑就行 ✓）
   为什么是这款：用户要的是【像衣服】的那种 ✓
     有领口 ✓ 有下摆 ✓ 一片片叠的鳞有层次 ✓ 不是硬板甲 ✓
   ★ 这段 SVG 是从预览页里【原样搬过来的】✗ 没有二次手改 ✗
     预览页看到什么样，游戏里就是什么样 ✓ 不会出现"预览好看实装变样"✗ */
var ARMOR_ICON = '<svg viewBox="0 0 24 24" width="100%" height="100%">' +
'<path d="M8.4 3 h7.2 l4.2 2 -0.5 4 -2.2 -0.6 V16.8 H6.9 V8.4 l-2.2 0.6 -0.5 -4 z"' +
    ' fill="currentColor" opacity=".85"/>' +
    '<path d="M8.8 7.2 l3.2 1.7 3.2 -1.7 M8.8 10.3 l3.2 1.7 3.2 -1.7 M8.8 13.4 l3.2 1.7 3.2 -1.7"' +
    ' stroke="#000" stroke-opacity=".4" stroke-width="1.05" fill="none"/>' +
    '<path d="M10 3.2 c0.6 1.2 3.4 1.2 4 0" stroke="#000" stroke-opacity=".3" stroke-width="1" fill="none"/>';

/* ★ round487：皮肤卡的图标（一张卡 + 一颗星 ✓ 一眼和材料/装备分开）*/
/* ★ round557：技能书图标（一本立着的书 ✓ 书脊 + 书页 + 一条书签）*/
var SKILL_BOOK_ICON = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" ' +
  'stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">' +
  '<path d="M4 4.6h9.4c1.4 0 2.6 1.1 2.6 2.5v12.3H6.6C5.2 19.4 4 18.3 4 16.9z" ' +
  'fill="currentColor" fill-opacity=".18"/>' +
  '<path d="M16 5.2h2.2c1 0 1.8.8 1.8 1.8v11.6c0 .6-.5 1.1-1.1 1.1H16"/>' +
  '<path d="M7 8.4h6M7 11.4h6M7 14.4h4"/>' +
  '<path d="M19.4 4.4v6.2l-1.6-1.1-1.6 1.1V4.4" stroke-width="1.3"/>' +
  '</svg>';

var SKIN_CARD_ICON = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" ' +
  'stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
  '<rect x="3.5" y="5" width="17" height="14" rx="2.2"/>' +
  '<path d="M12 8.6l1.3 2.6 2.9.4-2.1 2 .5 2.9-2.6-1.4-2.6 1.4.5-2.9-2.1-2 2.9-.4z" ' +
  'fill="currentColor" fill-opacity=".25"/></svg>';

var SKIN_UNIFIED_ICON = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" ' +
  'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="3.2" y="3.2" width="17.6" height="17.6" rx="3" fill="currentColor" fill-opacity=".10"/>' +
  '<path d="M9 7.2l3 1.9 3-1.9 2.8 2.7-1.8 2.6v5.3H8V12.5L6.2 9.9z" ' +
  'fill="currentColor" fill-opacity=".30"/>' +
  '<path d="M12 9.1v8.7M10 21l2-3.2L14 21"/></svg>';

function iconOfItem(it) {
  if (!it) { return ITEM_ICON.box; }
  if (it.kind === 'skin') {
    /* ★ round590：皮肤卡统一用“衣服/皮肤”图标，不再显示一张脸 */
    return SKIN_UNIFIED_ICON;
  }
  if (it.kind === 'skillbook') {
    /* ★ round583：技能书直接用【那个技能的图标】*/
    try {
      if (it.key && window.SKI) {
        var _kd = 'A';
        try {
          if (window.SK && SK.byKey && SK.byKey[it.key]) { _kd = SK.byKey[it.key].kind; }
        } catch (e1) { }
        return '<img src="' + SKI.icon(it.key, _kd, 34) + '" style="width:34px;height:34px;'
          + 'display:block;border-radius:4px">';
      }
    } catch (e2) { }
    return SKILL_BOOK_ICON;
  }
  // ★ 第 104 轮：必须【有 base】才算防具 ✓（假防具按材料显示 ✓ 兜底 ✓）
  if (it.slot === 'armor' && it.base) { return ARMOR_ICON; }
  /* ★★ 武器图标 = 那把武器的【平面微缩版】★★（用户要求）
     它不是画出来的线条，而是把同一份零件数据投影成 SVG 矩形 ——
     所以它永远长得就像手上那把 ✓ 而且换武器/改模型图标自动跟着变 ✓ */
  if (it.slot === 'weapon') { return weaponIconSvg(it.look, it.tier); }
  return ITEM_ICON[MAT_ICON_BY_NAME[it.name] || 'box'];
}
/* 品阶色 → 带透明度的 rgba（做图标【底色】用 ✓ 第 54 轮用户要求）*/
function tierRgba(tier, a) {
  var h = tierHex(tier);
  var r = parseInt(h.substr(1, 2), 16), g = parseInt(h.substr(3, 2), 16),
      b = parseInt(h.substr(5, 2), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}

/* 品阶色 —— 和 core 里地上掉落物同一套 LOOT_COL ✓ */
function tierHex(tier) {
  var n = Math.max(0, Math.min(11, tier | 0));
  var v = (typeof LOOT_COL !== 'undefined' && LOOT_COL[n]) || 0xffffff;
  var s = v.toString(16);
  while (s.length < 6) { s = '0' + s; }
  return '#' + s;
}

/* ★ round507：穿/脱装备"就地更新"标记 —— 服务器推了 weapon/armor 就不重拉整包 ✓
   万一 2.5 秒内没收到推送（掉包/断线）→ 才退回老的 bagFetch ✓ 有兜底不会白屏 ✓ */
/* ★ round511：我的皮肤自定义（服务端回执填充 ✓ {皮肤key: {ey,mo,iris,hair,shirt}}）*/
var MY_CUSTOM_MAP = {};
/* ★ round530：{皮肤key: 该皮肤【重复卡】张数}（服务端算好发回来 ✓）*/
var MY_CARD_MAP = {};
var _bagLocalApplied = false;
var _bagFallbackT = null;
function bagAfterEquip() {
  _bagLocalApplied = false;
  if (_bagFallbackT) { clearTimeout(_bagFallbackT); }
  _bagFallbackT = setTimeout(function () {
    _bagFallbackT = null;
    if (_bagLocalApplied) { return; }          /* 服务器推过了 → 什么都不做 ✓ */
    BAG.busy = false;
    if ((SETCFG.setTab || '') === 'bag') { bagFetch(bagRender); }
  }, 2500);
}

var BAG = { items: [], weapon: null, weaponItemId: null,
            armor: null, armorItemId: null,     // ★ 第 67 轮：防具 ✓
            busy: false, msg: '', sel: null,
            /* round303: 批量出售 —— multi = 是否在勾选模式 ✗ pick = 勾中的 id 列表 ✓ */
            multi: false, pick: [] };

function bagToken() {
  try { return localStorage.getItem('token') || ''; } catch (e) { return ''; }
}

/* 拉一次背包（只读接口 ✓ 不用占 tick 线程）*/
function bagFetch(cb) {
  if (!NET.on || !WSC.ready) {           // 单机/离线：没有背包这个东西 ✓
    BAG.items = []; BAG.weapon = MY_WEAPON;
    /* ★★★ 第 231 轮修的真 bug（用户："穿戴之后在背包里看不到对应的小绿点了"）★★★
       病根：这里原来把 weaponItemId / armorItemId 清成 null ✗
         → 然后才去请求背包数据 ✓ 等响应回来再设上 ✓
         → 只要有一次【请求失败 / 响应晚到 / 中途又被重跑】✗
           这两个值就停在 null ✓ 所有绿点全没 ✓
         → 穿戴之后如果又触发一次重载 ✗ 也会先被清空 ✓
           表现就是"概率会看不到绿点"✓✓
       ★ 修：不清空 ✗ 保留上一次的值 ✓
         宁可旧一点点 ✗ 也不要整片绿点消失 ✓
         （服务器那边本来就发这两个字段 ✓ app.py 第 675/677 行 ✓）*/
    BAG.armorItemId = BAG.armorItemId || null;
    BAG.msg = '单机模式没有背包（联机才有 ✓）';
    if (cb) { cb(); }
    return;
  }
  /* ★★★ round304k：晚到的旧响应不许覆盖新的（自测抓到的真竞态）★★★
     现象：连着拉两次背包 ✗ 第一次的响应【晚一点才回来】✗
       → 它把第二次（更新的）结果盖掉了 ✓
       → 表现：明明刚捡/刚被发了东西 ✗ 背包里少一件 ✓
     ★ 为什么真机会发生：切页签会拉一次、卖完东西又拉一次、服务器推 me 还会再拉 ✓
       三次请求乱序回来完全可能 ✓（本地快的时候看不出来 ✓）
     ★ 修法：给每次请求发一个序号 ✗ 回来时不是最新的就【丢掉】✓
       （和"防连点/防重复提交"是同一套思路 ✗ 这个项目里迟早都要有 ✓）*/
  BAG._seq = (BAG._seq || 0) + 1;
  var _mySeq = BAG._seq;
  fetch('/api/bag', { headers: { 'X-Token': bagToken() } })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (_mySeq !== BAG._seq) { if (cb) { cb(); } return; }   /* 过期了 ✗ 丢掉 ✓ */
      if (!j || !j.ok) { BAG.msg = (j && j.error) || '读背包失败'; }
      else {
        BAG.items = j.items || [];
        BAG.weapon = j.weapon || null;
        BAG.weaponItemId = j.weaponItemId || null;
        BAG.armor = j.armor || null;                 // ★ 第 68 轮：防具 ✓
        BAG.armorItemId = j.armorItemId || null;
        BAG.msg = '';
        setWeapon(BAG.weapon);           // ★ 手上的武器 → 射程/攻击弧/冷却一起换 ✓
      }
      if (cb) { cb(); }
    })
    .catch(function () { BAG.msg = '读背包失败（网络）'; if (cb) { cb(); } });
}

/* ============================================================
   ★ 第 51 轮：显示改成【武器自己的伤害】（用户要求）
   为什么不掺玩家等级：同一把武器在 1 级和 50 级显示的数完全不同 → 没法横向比 ✗
     现在显示的是"这件武器本身的分数" → 两把一比就知道哪把好 ✓
   ★ 真正代入伤害时还是"固有 × 系数 + 平伤"（服务器算 ✓ 见 weapons.player_atk_with）
     面板里不再显示那个数（用户说加上等级不直观 ✗）
   ★ 这里的算法和 server/weapons.py 的 weapon_damage/crit_damage/dps_of 是同一个 ✓
     （两边一旦不一致，就是显示和实际不符 —— 所以这里必须逐条对齐 ✓）
   ============================================================ */
var W_TIER_FLAT = [3, 6, 10, 16, 24, 36, 52, 74, 104, 146, 205, 290];
var W_REF = 100;                 // 系数折算基准（纯比较用 ✓）

function wBase(it) { return (it && it.base) || null; }
/* ★★ round472：【有效装备等级】= min(装备等级, 你的等级) ✗
   超过你等级的部分不算数 ✓（和 server/weapons.py eff_level 一致 ✗）*/
function effGearLv(it) {
  var il = +((it && it.itemLv) || 1);
  var lv = (WSC.role && WSC.role.level) || 1;
  return Math.max(1, Math.min(il, lv));
}
function wFlat(it) {
  var b = wBase(it);
  if (!b) { return 0; }
  if (it && it.flat0) { return 0; }        // ★ 空手没有平伤（第 58 轮 ✓）
  var ti = Math.max(0, Math.min(11, it.tier || 0));
  var lv = effGearLv(it);
  return W_TIER_FLAT[ti] * (1 + 0.06 * (lv - 1));
}
/* ★ round472：防具的【打折后】属性（和 server/armor.py stats_of 同一口径 ✓）*/
function aStatsOf(ar) {
  var b = (ar && ar.base) || {};
  var il = +((ar && ar.itemLv) || 1);
  var lvv = (WSC.role && WSC.role.level) || 1;
  var el = Math.max(1, Math.min(il, lvv));
  var sc = (il > 1) ? ((1 + 0.06 * (el - 1)) / (1 + 0.06 * (il - 1))) : 1;
  var m = aMastery(ar);
  return { dr: (+b.dr || 0) * sc * m, hp: (+b.hp || 0) * sc * m,
           drFull: (+b.dr || 0), hpFull: (+b.hp || 0), mastery: m, scale: sc };
}
function wDamage(it) {          // 武器伤害 = 平伤 + 系数 × 100
  var b = wBase(it);
  if (!b) { return 0; }
  return wFlat(it) + (+b.coeff || 1) * W_REF;
}
function wCrit(it) { return wDamage(it) * 1.5; }
/* ★★★ round470：攻速上下限是【全局常量】✗ 既不是按武器、也不是按人物 ✓
   来源：server/weapons.py  S_MIN=0.6  S_MAX=4.4  BASE_INTERVAL=0.62
      间隔 = 0.62 / S（秒） → 最快 ×2.2 = 0.282 秒 · 最慢 ×0.6 = 1.033 秒
   ★ 每把武器自己的【基础 S】是固定的（匕首 1.45 · 锤 0.66…）✗
     词条【攻速 %】乘在基础 S 上 → 再夹回 [0.6, 2.2] ✓
   ★ 以前这里没算词条 ✗ 而服务器算了 ✗✗（两边不一致）*/
var W_SPD_MIN = 0.6, W_SPD_MAX = 2.2, W_BASE_INTERVAL = 0.62;

function wSpdPct(it) {
  var af = (it && it.affixes) || [];
  var pct = 0;
  for (var i = 0; i < af.length; i++) {
    if (af[i] && af[i].key === 'spd_pct') { pct += (+af[i].val || 0); }
  }
  return pct;
}
function wSpdBase(it) {
  var b = wBase(it);
  return b ? (+b.atkSpeed || 1.15) : 1.15;
}
function wSpdTotal(it) {
  var v = wSpdBase(it) * (1.0 + wSpdPct(it) / 100.0);
  return Math.max(W_SPD_MIN, Math.min(W_SPD_MAX, v));
}
function wInterval(it) {
  return W_BASE_INTERVAL / wSpdTotal(it);
}
function wDps(it) {             // 每秒伤害（含 20% 暴击期望 ×1.1 ✓）
  return wDamage(it) * 1.1 / Math.max(0.05, wInterval(it));
}
/* 射程 → 文字（用户要求"射程改成范围"✓）*/
function rangeWord(m) {
  if (m <= 2.0) { return '贴身'; }
  if (m <= 2.6) { return '短'; }
  if (m <= 3.2) { return '中'; }
  if (m <= 5.0) { return '长'; }
  return '超远';
}
/* 弧 → 文字（用户要求"弧改成文字描述"✓）*/
function arcWord(arc) {
  if (arc <= 0.80) { return '窄 · 近乎直线突刺'; }
  if (arc <= 1.05) { return '中 · 常规挥砍'; }
  if (arc <= 1.30) { return '宽 · 一片'; }
  return '横扫 · 一大片';
}
function wStatsOf(it) {
  var b = wBase(it);
  var reach = b ? (+b.reach || 2.4) : 2.4;
  var arc = b ? (+b.arc || 1.05) : 1.05;
  /* ★ round470：spd = 当前攻速（含词条、已夹限）✗ spdBase = 基础 ✗ spdPct = 词条 % ✓ */
  return { reach: reach, arc: arc,
           spd: wSpdTotal(it), spdBase: wSpdBase(it), spdPct: wSpdPct(it) };
}
/* ★ 空手时按【默认单手剑】算（服务器就是这么兜底的 ✓ 见 world.py 的 Player）
   踩过：不兜底的话面板显示"武器伤害 0"✗ —— 玩家会以为坏了 ✗ */
/* ★ 第 58 轮：空手改成弱基线（系数 0.75、没有平伤 ✓）
   ★ 必须和 server/weapons.py 的 FIST 完全一致 ✓（不一致就是"显示的和实际不符"✗）*/
var DEFAULT_W = { slot: 'weapon', look: 'sword', tier: 0, itemLv: 1, flat0: true,
                  name: '空手',
                  base: { coeff: 0.75, atkSpeed: 1.15, reach: 2.4, arc: 1.05 } };
function shownWeapon() { return (BAG.weapon && BAG.weapon.base) ? BAG.weapon : DEFAULT_W; }

/* ★★ 第 52 轮：分清两件事 ★★
   wStrength = 纯武器分数（平伤 + 系数×100）→ 用来【比较哪把好】（不含你的等级 ✓）
   wRealHit  = 你穿上之后【真正每击多少】 → 服务器口径：固有 × 系数 + 平伤，再封顶 ✓
   ★ 为什么两个都要：只给"强度"会被当成伤害（用户就是被这个误导的 ✗）；
     只给"实际"又会被自己的等级干扰、不好横向比武器 ✗ */
function wStrength(it) { return wDamage(it); }

function wInherent() {
  var lv = (WSC.role && WSC.role.level) || 1;
  return 10 + 3 * lv + 0.08 * lv * lv;
}
/* ★★ 第 53/54 轮：等级不够【不是不能穿】，而是"发挥度打折" ★★
   （方案 §7.8 原来写"不能装"✗ → 用户改成"能装、只是发挥不出最大伤害" ✓）
   算法和 server/weapons.py 的 mastery_of 逐位一致 ✓（不一致就是显示和实际不符 ✗）*/
/* ★★★ round472：发挥度 = 1 / (1 + 等级差 / 10)，下限 0.02 ✗
   必须和 server/weapons.py 的 mastery_for_gap 一字不差 ✗
   （不一致就是"面板显示 90% 实际只有 2%"这种事 ✗）*/
var MASTERY_FLOOR = 0.02, MASTERY_K = 10.0;
function masteryGap(req, lv) {
  req = +req || 1; lv = +lv || 1;
  if (req <= 1 || lv >= req) { return 1; }
  var gap = req - lv;
  return Math.max(MASTERY_FLOOR, Math.min(1, 1 / (1 + gap / MASTERY_K)));
}
function wMastery(it) {
  var req = +((it && it.reqLevel) || 1);
  var lv = (WSC.role && WSC.role.level) || 1;
  return masteryGap(req, lv);
}
/* ★ round472：防具也吃发挥度（和武器一个口径 ✓）*/
function aMastery(ar) { return wMastery(ar); }
/* 满发挥（不打折、不封顶）—— 用来告诉玩家"你只发挥了它的多少" ✓ */
function wFull(it) {
  var b = wBase(it);
  if (!b) { return 0; }
  // ★ 第 65 轮：平伤 ÷ S（弓例外 ✓ 和服务器 weapons.player_atk_with 一致 ✓）
  var S = Math.max(0.6, Math.min(2.2, +b.atkSpeed || 1.15));
  var fl = wFlat(it);
  if (it && it.look !== 'bow') { fl = fl / S; }
  return wInherent() * (+b.coeff || 1) + fl;
}
function wRealHit(it) {
  var b = wBase(it);
  if (!b) { return 0; }
  var inh = wInherent();
  /* ★ 第 65 轮：平伤也要 ÷ S（和服务器一致 ✓ 不一�致就是"显示和实际不符"✗）*/
  var v = wFull(it) * wMastery(it);       // ★ 先按等级发挥度打折
  // ★ 第 60 轮：封顶跟着品阶抬（2.5 + 0.06×阶 ✓ 和服务器一致）
  var cap = inh * (2.5 + 0.06 * Math.max(0, Math.min(11, (it && it.tier) || 0)));
  return Math.min(v, cap);
}
function wRealDps(it) {
  return wRealHit(it) * 1.1 / Math.max(0.05, wInterval(it));
}
/* 等级不够 → 返回需要的等级；够 → 0 */
function wNeedLevel(it) {
  var need = +((it && it.reqLevel) || 1);
  var lv = (WSC.role && WSC.role.level) || 1;
  return need > lv ? need : 0;
}

/* 面板用的一整块文字（实际每击 / 武器强度 / 范围 / 打击面 / 攻速 ✓）*/
function wStatHtml(it, dim) {
  /* ★ 第 67 轮：防具显示【自己的】属性（减伤/生命 ✓ 不是武器的攻速射程 ✗）*/
  if (it && it.slot === 'armor') {
    /* ★ 第 102 轮（用户："防具点击装备的弹窗的文字信息太少了"）✗
       补上：部位 / 品阶 / 建议等级 / 减伤 / 生命 / 词条 / 穿上后的对比 ✓ */
    var bb = it.base || {};
    var afs = it.affixes || [];
    var o2 = '<span style="color:#8ee0ff">防具 · 穿在【武器槽右边】那个槽</span>' +
      '<span>品阶 <s>' + ((it.tier || 0) + 1) + '</s> 阶 · 建议等级 <s>' +
        (it.reqLevel || 1) + '</s></span>' +
      '<span>基础减伤 <s>' + (Math.round((+bb.dr || 0) * 10) / 10) + '</s> 点' +
        '（挨打时先扣这么多，最少留 1 点）</span>' +
      '<span>基础生命上限 <s>+' + Math.round(+bb.hp || 0) + '</s> 点</span>' +
      '<span>你当前生命上限 <s>' + Math.round(HPMAX) + '</s>' +
        '（穿上后服务器会重算 ✓）</span>';
    if (afs.length) {
      o2 += '<span style="color:#ffd83d">词条 ' + afs.length + ' 条：</span>';
      for (var i2 = 0; i2 < afs.length; i2++) {
        o2 += '<span style="color:#8ee0ff">· ' + (afs[i2].text || '') + '</span>';
      }
    } else {
      o2 += '<span style="opacity:.7">（这件没有词条）</span>';
    }
    /* ★★ 第 106 轮（用户第 3、4 条）★★
       · 耐久要能看到：原来防具这段【没写耐久】✗（武器的有 ✓）→ 用户："耐久度是多少看不到"✓
       · 信息"太简单"：把能写的都写上 ✓ 并且说清每条是什么意思 ✓ */
    o2 += ((+it.durMax > 0) ? ('<span>耐久 <s>' +
        itDur(it, null) + '</s> / ' + it.durMax +
        ' 次挨打' + (function () {
          var k = itDur(it, null) / it.durMax;
          return k <= 0.2 ? ' <i style="color:#ff7a6a;font-style:normal">⚠ 快坏了</i>'
                          : (k <= 0.5 ? ' <i style="color:#ffd83d;font-style:normal">磨损过半</i>' : '');
        })() + '（每挨一次 -1，归零就损坏消失）</span>') : '') +
      '<span style="opacity:.75">穿上它只是【带上减伤和生命】✓ 不影响你的攻击' +
        '（攻击看手上那把武器 ✓）</span>' +
      '<span style="opacity:.75">点【使用】穿上 · 点武器槽右边的防具槽脱下</span>';
    return o2;
  }
  var s = wStatsOf(it);
  var m = wMastery(it);
  var req = +((it && it.reqLevel) || 1);
  var lv = (WSC.role && WSC.role.level) || 1;
  var head = '';
  if (m < 1) {
    // ★ 不拦穿戴 ✓ 只提示"你现在发挥不出它的全部"（用户要的就是这个 ✓）
    head = '<span style="color:#ffd83d">⚠ 建议 ' + req + ' 级（你现在 ' + lv +
      ' 级）· 只能发挥 <s style="color:#ffd83d">' + Math.round(m * 100) + '%</s></span><br>';
  } else if (dim) {
    head = '<span style="opacity:.65">空手 · 按默认单手剑算</span><br>';
  }
  var real = wRealHit(it);
  var fullCapped = Math.min(wFull(it), wInherent() * 2.5);
  return head +
    '<span>实际每击 <s>' + real.toFixed(0) + '</s>（暴击 <s>' +
      (real * 1.5).toFixed(0) + '</s> · 20% 概率）' +
      (m < 1 ? ' <i style="opacity:.7;font-style:normal">← 满发挥 ' +
        fullCapped.toFixed(0) + '</i>' : '') + '</span>' +
    '<span>每秒伤害 <s>' + wRealDps(it).toFixed(0) + '</s>（含暴击期望 ✓）</span>' +
    '<span>武器强度 <s>' + wStrength(it).toFixed(0) +
      '</s> <i style="opacity:.7;font-style:normal">← 只比武器、不含你的等级</i></span>' +
    '<span>范围 <s>' + s.reach.toFixed(1) + '</s> 米 · ' + rangeWord(s.reach) + '</span>' +
    '<span>打击面 ' + arcWord(s.arc) + '（正前方 ' +
      Math.round(s.arc * 2 * 180 / Math.PI) + '°）</span>' +
    '<span>攻速 <s>×' + s.spd.toFixed(2) + '</s>（' + wInterval(it).toFixed(2) + ' 秒一刀）</span>' +
    /* ★★ 第 60 轮：词条也要写进文案 ★★
       （用户："这些效果也要写到文案里，不然玩家不知道" ✓）
       ★ 文案来自服务器（物品数据里的 affixes ✓）—— 不在 JS 里再抄一份表 ✗ */
    ((it.affixes && it.affixes.length) ? (function () {
      /* ★ round468：一条一行（用户要求换行 ✓）*/
      var out = '<span style="color:#ffd83d">词条 ' + it.affixes.length + ' 条：</span>' +
        '<span style="display:block;margin-top:2px"></span>';
      for (var ai = 0; ai < it.affixes.length; ai++) {
        var af = it.affixes[ai];
        out += '<span style="color:#8ee0ff;display:block;padding-left:6px">• ' +
          (af.text || af.name || '') + '</span>';
      }
      return out;
    })() : '') +
    /* ★★ 第 59 轮：机制 + 耐久【必须写进文案】★★
       （用户原话："这些效果也要写到文案里，不然玩家不知道" ✓）
       ★ 机制文案来自服务器（物品数据里的 fx ✓）—— 不在 JS 里再抄一份表 ✗ */
    (it.fx ? '<span style="color:#8ee0ff">特效：' + it.fx.text + '</span>' : '') +
    ((+it.durMax > 0) ? ('<span>耐久 <s>' + itDur(it, null) +
      '</s> / ' + it.durMax + ' 次挥砍' +
      (function () { var k = itDur(it, null) / it.durMax;
        return k <= 0.2 ? ' <i style="color:#ff7a6a;font-style:normal">⚠ 快坏了</i>' : ''; })() +
      '</span>') : '');
}

/* ============================================================
   bagRender —— 画背包（第 54 轮：格子/品阶底色/阶数/数量/选中/使用按钮）
   ★ 这一版把用户这一轮提的全部要求都写进去了：
       · 品阶 → 图标【底色】
       · 阶数 → 武器【左上角】
       · 数量 → 材料【右下角】（武器永不堆叠 ✓）
       · 点格子 = 选中；面板显示【选中那件】的数值；下面出现【使用】/【脱下】
   ============================================================ */
/* ★★ 第 171 轮（用户 #4）：背包分页 ★★
   每页 30 格 = 5 行 × 6 列 ✓（宽 6 ✓）
   ★ 为什么在客户端分页而不是服务器分批取：
     背包本来就只有几十件 ✗ 客户端一次拿全 ✓ 翻页只是"少画一些格子"✓
     服务器那边一个字都不用改 ✓（也不用改协议 ✓）
   ★ 空位也要画满 30 个 ✓ 不然最后一页会"越画越小"✗ 看着不像格子 ✓ */
var BAG_PAGE_SIZE = 30;
var BAG_PAGE = 0;

function bagPageCount() {
  var n = (BAG.items || []).length;
  return Math.max(1, Math.ceil(n / BAG_PAGE_SIZE));
}
/* ★ round409（用户："整页勾选"）：当前这一页（30 格）里【可以卖】的物品 id
   ★ 装备在身上 / 上架锁定中 / 默认那把 → 不给勾 ✓（勾了也卖不掉 ✓）
   ★ 现算 ✗ 不缓存 ✓（翻页、卖东西、整理之后马上就是对的 ✓）*/
function bagPageIds() {
  var out = [];
  var ps = (typeof BAG_PAGE_SIZE === 'number') ? BAG_PAGE_SIZE : 30;
  var from = (typeof BAG_PAGE === 'number' ? BAG_PAGE : 0) * ps;
  var list = BAG.items || [];
  var to = Math.min(list.length, from + ps);
  for (var i = from; i < to; i++) {
    var e = list[i];
    if (!e || e.id === undefined || e.id === null) { continue; }
    var it = e.item || {};
    if (String(e.id) === String(BAG.weaponItemId) ||
        String(e.id) === String(BAG.armorItemId)) { continue; }
    if (it.locked_by || it.locked) { continue; }
    out.push(String(e.id));
  }
  return out;
}
/* 勾选列表里找一下（返回下标 ✗ -1 = 没勾 ✓）—— 统一按字符串比 ✓ */
function _pickHas(id) {
  var p = BAG.pick || [];
  for (var i = 0; i < p.length; i++) {
    if (String(p[i]) === String(id)) { return i; }
  }
  return -1;
}
function bagPagerUpd() {
  var box = document.getElementById('bagPager');
  var txt = document.getElementById('bagPageTxt');
  if (!box) { return; }
  var n = bagPageCount();
  if (BAG_PAGE > n - 1) { BAG_PAGE = n - 1; }
  if (BAG_PAGE < 0) { BAG_PAGE = 0; }
  /* 只有一页就不显示翻页行 ✓（不然多一行没用的东西 ✗）*/
  box.style.display = (n > 1) ? 'flex' : 'none';
  if (txt) { txt.textContent = (BAG_PAGE + 1) + ' / ' + n + ' 页'; }
}
function bagPageBind() {
  var pv = document.getElementById('bagPrev');
  var nx = document.getElementById('bagNext');
  if (pv && !pv._b) {
    pv._b = true;
    pv.onclick = function () { BAG_PAGE = Math.max(0, BAG_PAGE - 1); bagRender(); };
  }
  if (nx && !nx._b) {
    nx._b = true;
    nx.onclick = function () { BAG_PAGE = Math.min(bagPageCount() - 1, BAG_PAGE + 1); bagRender(); };
  }
}

/* 第 173 轮（用户 #6）：传送读条的界面部分
   ★ 计时以【服务器给的秒数】为准 ✗ 客户端只用本地时间做平滑显示 ✓
     断线或者被打断时服务器会再发一条 tpcast（t=0）→ 立刻收掉进度条 ✓ */
var TPCAST = { left: 0, at: 0 };

function tpBarRender() {
  /* ★★ 第 189 轮：在这里【顺手确保绑定过】★★
     为什么放这：这个函数被一个 100ms 的定时器一直调 ✓ 一定会跑到 ✓
     而"初始化那一段"实测【根本没执行到】✗（按钮的 onclick 一直是空 ✓）
     ★ tpBind 自己是幂等的（document._tpBound 挡着 ✓）→ 放心每帧调 ✓
     ★ 这是"把初始化挂在一个必然会发生的事件上"✗ 比去追查初始化顺序稳得多 ✓ */
  safeTpBind();
  var btn = document.getElementById('safeTp');
  var fill = document.getElementById('safeTpFill');
  var txt = document.getElementById('safeTpTxt');
  if (!btn || !fill || !txt) { return; }
  var left = TPCAST.left - (performance.now() / 1000 - TPCAST.at);
  if (left <= 0) {
    btn.classList.remove('casting');
    fill.style.width = '0%';
    txt.textContent = '回安全区';
    return;
  }
  btn.classList.add('casting');
  var total = 6.0;
  fill.style.width = Math.min(100, (1 - left / total) * 100).toFixed(1) + '%';
  txt.textContent = '传送中 ' + left.toFixed(1) + 's';
}

/* ★ 第 189 轮：改成事件委托（原来的写法依赖"绑定那一刻按钮已经存在"✗
   实测就是栽在这上面：初始化跑在按钮解析出来之前 → getElementById 是 null
   → 直接 return → 按钮永远没有 onclick ✓）
   ★ 委托的好处：不管元素什么时候出现、被谁重建，都能点到 ✓ */
/* ★ 第 190 轮：点击动作抽出来（委托和直接绑定共用一份 ✓ 不会两边不一致）*/
/* ============================================================================
   ★★ 第 206 轮：自动战斗开关（用户指定：长按【攻击按钮】5 秒）★★
   不做单独按钮 ✓ 省屏幕空间 ✓ 藏进已有操作里 ✓
   ★ 必须给足视觉提示 ✗ 不然不知道状态、也不知道怎么关：
       ① 攻击按钮变绿 + 呼吸光   ② 上方一行小字显示它在干嘛
       ③ 开/关各弹一次提示       ④ 菜单里也留开关（万一忘了长按 ✓）
   ============================================================================ */
var AUTO_LONG_PRESS = 3000;   /* round253: 用户要求长按 3 秒（原 5 秒）*/
var _autoHold = null;

function autoUiUpd() {
  if (typeof AUTO === 'undefined') { return; }
  var b = document.getElementById('atk');
  if (b) { if (AUTO.on) { b.classList.add('auto'); } else { b.classList.remove('auto'); } }
  var info = document.getElementById('autoInfo');
  if (info) {
    if (AUTO.on) {
      info.style.display = 'block';
      info.textContent = AUTO.info || '自动战斗：启动中…';
    } else {
      info.style.display = 'none';
    }
  }
  var chk = document.getElementById('setAuto');
  if (chk) { chk.checked = !!AUTO.on; }
  /* ★ round353：屏幕上那个自动战斗按钮的状态（绿框 + 呼吸 ✓）*/
  var ab = document.getElementById('auto');
  if (ab) {
    if (AUTO.on) { ab.classList.add('on'); } else { ab.classList.remove('on'); }
  }
}

/* ★★★ round353（用户："攻击/跳跃/自动战斗按钮改成可移动的"）★★★
   ★ 做法：pointerdown 记起点 ✗ 移动超过 8px 就开始拖 ✓
     → 位置存 localStorage ✗ 刷新后还在 ✓
   ★ 为什么不用 HTML5 拖放：手机上不认 ✗ pointer 事件两端通用 ✓
   ★ 拖动阈值 8px：手指微抖不会误判成拖动 ✓ */
function uiOrientTag() {
  return document.body.classList.contains('landscape') ? 'L' : 'P';
}
function uiPosKey(id) { return 'uiPos_' + id + '_' + uiOrientTag(); }
function uiApplySavedPos(el, id) {
  try {
    var raw = localStorage.getItem(uiPosKey(id)) || localStorage.getItem('uiPos_' + id);
    if (!raw) { return false; }
    var o = JSON.parse(raw);
    if (!o) { return false; }
    var W = Math.max(1, window.innerWidth), H = Math.max(1, window.innerHeight);
    var l, t;
    if (typeof o.rx === 'number' && typeof o.ry === 'number') {
      l = o.rx * W; t = o.ry * H;
    } else if (typeof o.l === 'number') {
      l = o.l; t = o.t || 0;
    } else { return false; }
    var w = el.offsetWidth || 70, h = el.offsetHeight || 70;
    l = Math.max(4, Math.min(Math.max(4, W - w - 4), l));
    t = Math.max(4, Math.min(Math.max(4, H - h - 4), t));
    el.style.left = l.toFixed(1) + 'px';
    el.style.top = t.toFixed(1) + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    return true;
  } catch (e) { return false; }
}
function uiSavePos(id, l, t) {
  try {
    var W = Math.max(1, window.innerWidth), H = Math.max(1, window.innerHeight);
    var o = { l: Math.round(l), t: Math.round(t),
      rx: +(l / W).toFixed(5), ry: +(t / H).toFixed(5) };
    localStorage.setItem('uiPos_' + id, JSON.stringify(o));
    localStorage.setItem(uiPosKey(id), JSON.stringify(o));
  } catch (e) { }
}
function uiApplyAllSaved() {
  if (_dragSt) { return; }
  var ids = ['atk', 'jmp', 'auto', 'cam'];
  for (var i = 0; i < ids.length; i++) {
    var el = document.getElementById(ids[i]);
    if (!el) { continue; }
    var raw = null;
    try { raw = localStorage.getItem(uiPosKey(ids[i])) || localStorage.getItem('uiPos_' + ids[i]); } catch (e) { }
    if (raw) {
      uiApplySavedPos(el, ids[i]);
    } else {
      el.style.left = ''; el.style.top = '';
      el.style.right = ''; el.style.bottom = '';
    }
  }
}

function makeDraggable(id) {
  var el = document.getElementById(id);
  if (!el || el._dragInit) { return; }
  el._dragInit = true;
  // ★ 先恢复上次的位置（按当前横屏/竖屏 + 屏幕比例）
  uiApplySavedPos(el, id);
  /* ★★★ round357 修的真 bug（用户："点了键位按钮后无法拖动"）★★★
     ★ 根因：原来 pointermove / pointerup 绑在【元素自己】身上 ✗
       而 pointerdown 里调了 setPointerCapture ✗
       一旦 capture 没成功（或浏览器把它转给了别人）✗
       后续 move 事件就不会派发到这个元素 ✓ → 一条都收不到 ✓
     ★ 改成：【document 上监听】✗ 不管你拖到哪儿都收得到 ✓
       这也是拖拽最稳的写法 ✓ 元素被重建也不会丢 ✓ */
  el.addEventListener('pointerdown', function (e) {
    /* ★★★ round359（用户："现在不管点不点键位都能拖，应该只在键位模式下能拖"）★★★
       ★ 根因：拖动入口没判模式 ✗ 任何时候按下去都能拖 ✓
       ★ 修：不在键位模式 → 直接 return ✗ 按钮走它本来的功能 ✓
         （攻击键按住就砍 ✗ 跳跃键按下就跳 ✓ 和以前一样 ✓）*/
    if (!UI_EDIT) { return; }
    if (e && e.preventDefault) { e.preventDefault(); }
    var r = el.getBoundingClientRect();
    _dragSt = { el: el, id: id, x: e.clientX, y: e.clientY,
                l: r.left, t: r.top, moved: false, nl: r.left, nt: r.top };
  });
}
/* 全局拖拽状态（一次只拖一个 ✓）*/
var _dragSt = null;
(function dragDocHandlers() {
  if (window._dragDocBound) { return; }
  window._dragDocBound = true;
  document.addEventListener('pointermove', function (e) {
    var st = _dragSt;
    if (!st) { return; }
    if (!UI_EDIT) {                 // ★ 拖到一半退出键位模式 → 立刻停 ✓
      st.el.classList.remove('uiDrag');
      st.el.style.transform = '';
      _dragSt = null;
      return;
    }
    var dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (!st.moved) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) { return; }
      st.moved = true;
      st.el.classList.add('uiDrag');
      /* ★★ round531（用户："拖动时应该流畅地看见移动，而不是松手后才跳到新位置"）
         → 拖的时候【关掉过渡】+ 关掉动画 ✗ 否则每次 transform 都会被 0.07s 的
           transition 拖一下 ✗ 连起来就是"一顿一顿" ✓ */
      st.el.style.transition = 'none';
      st.el.style.animation = 'none';
      /* ★★ round533（用户："还是看不到移动的过程"）
         → 干脆不用 transform ✗ 直接把 left/top 改掉 ✓
           有些 WebView / 省电模式下 transform 那一层不重绘 ✗
           改 left/top 是【布局属性】✗ 一定会重绘 ✓（按钮只有几个，开销可忽略） */
      st.el.style.right = 'auto';
      st.el.style.bottom = 'auto';
      st.el.style.left = st.l + 'px';
      st.el.style.top = st.t + 'px';
      try { st.el.style.touchAction = 'none'; } catch (e4) { }
    }
    var w = st.el.offsetWidth, h = st.el.offsetHeight;
    var nl = Math.max(0, Math.min(window.innerWidth - w, st.l + dx));
    var nt = Math.max(0, Math.min(window.innerHeight - h, st.t + dy));
    st.nl = nl; st.nt = nt;
    /* ★ 一帧只写一次（pointermove 一秒可能来 120 次 ✗ 每帧写一次最顺 ✓）*/
    /* ★ round533：直接改 left/top（布局属性 ✗ 一定重绘 ✓）*/
    st.el.style.left = nl + 'px';
    st.el.style.top = nt + 'px';
  }, { passive: false });
  document.addEventListener('pointerup', function () {
    var st = _dragSt;
    if (!st) { return; }
    _dragSt = null;
    st.el.classList.remove('uiDrag');
    if (!st.moved) { return; }
    st.el._dragged = true;
    setTimeout(function () { st.el._dragged = false; }, 250);
    var nl = st.nl, nt = st.nt;
    st.el.style.transition = '';
    st.el.style.animation = '';
    st.el.style.transform = '';
    st.el.style.left = nl + 'px';
    st.el.style.top = nt + 'px';
    st.el.style.right = 'auto';
    st.el.style.bottom = 'auto';
    uiSavePos(st.id, nl, nt);
  });
  document.addEventListener('pointercancel', function () {
    if (!_dragSt) { return; }
    _dragSt.el.classList.remove('uiDrag');
    _dragSt = null;
  });
})();

/* ★★★ round355（用户："键位按钮：点一下进入调整，再点保存；调整时三个键不能用"）★★★
   ★ 为什么调整时要禁用功能：
     ① 拖跳跃键会顺手跳一下 ✗
     ② 拖攻击键会一直挥刀 ✗ 还可能打到怪 ✓
     ③ 拖自动键会开关自动战斗 ✗ 越调越乱 ✓ */
var UI_EDIT = false;
function uiEditToggle() {
  UI_EDIT = !UI_EDIT;
  /* ★ 2026-10-23：系统提示框也参与键位调整（能拖、能看见） */
  try {
    var _smb = sysMsgEl();
    _smb.style.pointerEvents = UI_EDIT ? 'auto' : 'none';
    if (UI_EDIT) {
      _smb.style.display = 'block';
      _smb.style.opacity = '1';
      if (!SYSMSG.live.length) { sysMsgPush('拖动这里可以移动提示框'); }
      sysMsgBindDrag();
    }
  } catch (eSm) { }
  var b = document.getElementById('uiEdit');
  if (b) {
    b.textContent = UI_EDIT ? '保存' : '键位';
    if (UI_EDIT) { b.classList.add('on'); } else { b.classList.remove('on'); }
  }
  // ★ 退出时把"按住"的状态清掉 ✗ 免得正好卡在按下 ✓
  if (!UI_EDIT) {
    try { atkHeld = false; } catch (e) { }
    try { jumpHeld = 0; } catch (e2) { }
  }
}
function uiEditBind() {
  var b = document.getElementById('uiEdit');
  if (!b || b._bound) { return; }
  b._bound = true;
  b.addEventListener('pointerdown', function (e) {
    if (e && e.preventDefault) { e.preventDefault(); }
    uiEditToggle();
  });
}

/* ============================================================ 仓库 UI（round609）
   ★ 服务端权威：只有靠近柜台才允许 open/move
   ★ 背包和仓库各 30 格/页；仓库 90 格；主题跟随 #setPanel 的 CSS 变量
   ============================================================ */
var WH = { open: false, bag: [], store: [], cap: 90, used: 0,
  pageB: 0, pageS: 0, selB: null, selS: null, busy: false, reqT: 0,
  pickB: {}, pickS: {} };
var WH_PAGE = 30;

function whMsg(s) {
  var el = document.getElementById('whMsg');
  if (el) { el.textContent = s || ''; }
}
function whSetOpen(on) {
  WH.open = !!on;
  WH_OPEN = !!on;
  var p = document.getElementById('whPanel');
  if (p) { p.style.display = on ? 'block' : 'none'; }
  var pr = document.getElementById('whPrompt');
  if (pr) { pr.style.display = (!on && WH_NEAR) ? 'block' : 'none'; }
  if (!on) {
    WH.selB = null; WH.selS = null;
    try { if (window.bagTipHide) { bagTipHide(); } } catch (eBT) { }
    try { wsSend('warehouse_close', {}); } catch (e) { }
  }
}
function whOpen() {
  if (WH.open) { return; }
  if (typeof WSC !== 'undefined' && !WSC.ready) { toast('连接中，请稍后再试'); return; }
  whSetOpen(true);
  whMsg('正在打开仓库…');
  WH.reqT = Date.now();
  try { wsSend('warehouse_open', {}); } catch (e) { whMsg('连接失败'); }
  setTimeout(function () {
    if (WH.open && !WH.bag.length && !WH.store.length && Date.now() - WH.reqT > 1800) {
      whMsg('没有反应：请确认你在仓库柜台旁');
    }
  }, 1900);
}
function whClose() { whSetOpen(false); }
function whApply(d) {
  if (!d) { return; }
  WH.bag = d.bag || [];
  WH.store = d.store || [];
  WH.cap = +d.capacity || 90;
  WH.used = +d.used || WH.store.length;
  WH.busy = false;
  WH.pickB = {}; WH.pickS = {};
  whSetOpen(true);
  whRender();
  whMsg('已连接仓库');
}
function whSlotHtml(it, kind) {
  if (!it) { return '<div class="whSlot empty"></div>'; }
  var o = it.item || {};
  var tier = +o.tier || 0;
  var col = tierHex(tier);
  var ic = iconOfItem(o);
  var sel = (kind === 'bag' ? WH.selB : WH.selS);
  var on = (String(sel) === String(it.id));
  var picked = !!(kind === 'bag' ? WH.pickB[it.id] : WH.pickS[it.id]);
  return '<div class="whSlot' + (on ? ' sel' : '') + (picked ? ' picked' : '') + '" data-whkind="' + kind + '" data-whid="' + it.id +
    '" style="background:' + tierRgba(tier, 0.26) + '">' + '<span class="chk">✓</span>' + ic +
    '<span class="t" style="color:' + col + '">' + (tier + 1) + '</span>' +
    ((+it.stack || 1) > 1 ? '<span class="n">' + it.stack + '</span>' : '') + '</div>';
}
function whGrid(kind) {
  var list = kind === 'bag' ? WH.bag : WH.store;
  var page = kind === 'bag' ? WH.pageB : WH.pageS;
  var n = Math.max(1, Math.ceil((list.length || 0) / WH_PAGE));
  if (page >= n) { page = n - 1; if (page < 0) { page = 0; } }
  if (kind === 'bag') { WH.pageB = page; } else { WH.pageS = page; }
  var from = page * WH_PAGE;
  var h = '';
  for (var i = 0; i < WH_PAGE; i++) { h += whSlotHtml(list[from + i], kind); }
  var g = document.getElementById(kind === 'bag' ? 'whBag' : 'whStore');
  if (g) { g.innerHTML = h; }
  var lab = document.getElementById(kind === 'bag' ? 'whBagPage' : 'whStorePage');
  if (lab) { lab.textContent = (page + 1) + ' / ' + n; }
}
function whRender() {
  WH.used = WH.store.length;
  var c = document.getElementById('whCount');
  if (c) { c.textContent = WH.used + ' / ' + WH.cap; }
  whGrid('bag'); whGrid('store');
  var sb = document.getElementById('whStoreBtn'), tb = document.getElementById('whTakeBtn');
  if (sb) { sb.disabled = !WH.selB || WH.busy; }
  if (tb) { tb.disabled = !WH.selS || WH.busy; }
  var bsel = Object.keys(WH.pickB).length, ssel = Object.keys(WH.pickS).length;
  var ss = document.getElementById('whStoreSel'), tt = document.getElementById('whTakeSel');
  if (ss) { ss.disabled = !bsel || WH.busy; ss.textContent = '批量存入(' + bsel + ')'; }
  if (tt) { tt.disabled = !ssel || WH.busy; tt.textContent = '批量取出(' + ssel + ')'; }
}
function whSelect(kind, id) {
  if (kind === 'bag') {
    WH.selB = id;
    if (WH.pickB[id]) { delete WH.pickB[id]; } else { WH.pickB[id] = 1; }
  } else {
    WH.selS = id;
    if (WH.pickS[id]) { delete WH.pickS[id]; } else { WH.pickS[id] = 1; }
  }
  whRender();
  var list = kind === 'bag' ? WH.bag : WH.store;
  var hit = null;
  for (var i = 0; i < list.length; i++) { if (String(list[i].id) === String(id)) { hit = list[i]; break; } }
  if (hit && typeof bagTipHTML === 'function' && window.bagTipShowAt) {
    try {
      var h = bagTipHTML(hit.item || {}, hit.id, 'none');
      bagTipShowAt((window.innerWidth / 2), (window.innerHeight / 2), h);
      if (window.bagTipStickyOn) { bagTipStickyOn(); }
    } catch (eT) { }
  }
}
function whMove(to) {
  var id = to === 'store' ? WH.selB : WH.selS;
  if (!id || WH.busy) { return; }
  if (typeof WSC !== 'undefined' && !WSC.ready) { whMsg('连接已断开'); return; }
  WH.busy = true; whRender(); whMsg('处理中…');
  try { wsSend('warehouse_move', { id: id, to: to }); }
  catch (e) { WH.busy = false; whMsg('发送失败'); whRender(); }
}
function whPickPage(kind) {
  var list = kind === 'bag' ? WH.bag : WH.store;
  var page = kind === 'bag' ? WH.pageB : WH.pageS;
  var from = page * WH_PAGE, to = Math.min(list.length, from + WH_PAGE);
  var map = kind === 'bag' ? WH.pickB : WH.pickS;
  var all = true;
  for (var i = from; i < to; i++) { if (!map[list[i].id]) { all = false; break; } }
  for (var j = from; j < to; j++) {
    if (all) { delete map[list[j].id]; } else { map[list[j].id] = 1; }
  }
  whRender();
}
function whMoveMany(to) {
  var map = to === 'store' ? WH.pickB : WH.pickS;
  var ids = Object.keys(map).map(function (x) { return +x; });
  if (!ids.length || WH.busy) { return; }
  if (typeof WSC !== 'undefined' && !WSC.ready) { whMsg('连接已断开'); return; }
  WH.busy = true; whRender(); whMsg('批量处理中…');
  try { wsSend('warehouse_move_many', { ids: ids, to: to }); }
  catch (e) { WH.busy = false; whMsg('发送失败'); whRender(); }
}
(function whBind() {
  if (window._whBound) { return; }
  window._whBound = true;
  var close = document.getElementById('whClose');
  if (close) { close.addEventListener('click', whClose); }
  ['whBag', 'whStore'].forEach(function (id) {
    var g = document.getElementById(id);
    if (!g) { return; }
    g.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== g && !(t.getAttribute && t.getAttribute('data-whid'))) { t = t.parentNode; }
      if (t && t !== g) { whSelect(t.getAttribute('data-whkind'), +t.getAttribute('data-whid')); }
    });
  });
  var sb = document.getElementById('whStoreBtn'), tb = document.getElementById('whTakeBtn');
  if (sb) { sb.addEventListener('click', function () { whMove('store'); }); }
  if (tb) { tb.addEventListener('click', function () { whMove('bag'); }); }
  var p1 = document.getElementById('whPickPageB'), p2 = document.getElementById('whPickPageS');
  if (p1) { p1.addEventListener('click', function () { whPickPage('bag'); }); }
  if (p2) { p2.addEventListener('click', function () { whPickPage('store'); }); }
  var s1 = document.getElementById('whStoreSel'), t1 = document.getElementById('whTakeSel');
  if (s1) { s1.addEventListener('click', function () { whMoveMany('store'); }); }
  if (t1) { t1.addEventListener('click', function () { whMoveMany('bag'); }); }
  var bp = document.getElementById('whBagPrev'), bn = document.getElementById('whBagNext');
  var sp = document.getElementById('whStorePrev'), sn = document.getElementById('whStoreNext');
  if (bp) { bp.addEventListener('click', function () { WH.pageB = Math.max(0, WH.pageB - 1); whRender(); }); }
  if (bn) { bn.addEventListener('click', function () { WH.pageB++; whRender(); }); }
  if (sp) { sp.addEventListener('click', function () { WH.pageS = Math.max(0, WH.pageS - 1); whRender(); }); }
  if (sn) { sn.addEventListener('click', function () { WH.pageS++; whRender(); }); }
  document.addEventListener('keydown', function (e) {
    var k = e.key || '';
    if (k === 'Escape' && WH.open) { whClose(); e.preventDefault(); return; }
    if (k === 'e' || k === 'E') {
      if (typeof MY_SLEEP !== 'undefined' && MY_SLEEP) { tryWake(); e.preventDefault(); return; }
      if (typeof SLEEP_NEAR !== 'undefined' && SLEEP_NEAR) { trySleep(); e.preventDefault(); return; }
      if (typeof MY_JOB !== 'undefined' && MY_JOB) {
        try { jobStop(); } catch (eJ1) { }
        e.preventDefault(); return;
      }
      if (typeof FRIDGE_NEAR !== 'undefined' && FRIDGE_NEAR) { fridgeOpen(FRIDGE_NEAR.id); e.preventDefault(); return; }
      if (typeof SHOP_NEAR !== 'undefined' && SHOP_NEAR) { shopOpen(); e.preventDefault(); return; }
      if (typeof MY_SEAT !== 'undefined' && MY_SEAT) {
        if (orderShopNear()) { orderOpen(); e.preventDefault(); return; }
        tryStand(); e.preventDefault(); return;
      }
      if (typeof SEAT_NEAR !== 'undefined' && SEAT_NEAR) { trySit(); e.preventDefault(); return; }
      if (typeof TP_NEAR !== 'undefined' && TP_NEAR) { tpOpen(); e.preventDefault(); return; }
      if (typeof HOUSE_NEAR !== 'undefined' && HOUSE_NEAR) { houseOpen(); e.preventDefault(); return; }
      if (!WH.open && typeof WH_NEAR !== 'undefined' && WH_NEAR) { whOpen(); e.preventDefault(); }
    }
  });
})();
UI.warehouseFloat = function (sx, sy, on, text) {
  var el = document.getElementById('interactFloat');
  if (!el) { return; }
  if (!on) { el.style.display = 'none'; return; }
  el.textContent = text || '仓库';
  el.style.display = 'block';
  el.style.left = Math.round(sx) + 'px';
  el.style.top = Math.round(sy) + 'px';
};
/* core 层不能碰 DOM：文字招牌/光晕贴图需要的 canvas 从这里拿 */
UI.setSafeMode = function (on) {
  try { document.body.classList.toggle('safe-mode', !!on); } catch (e) { }
};

/* ★ 2026-10-22：记住"我正坐在哪 / 睡在哪"，刷新页面后自动恢复 */
/* 重连后恢复上次的坐/睡（服务端已经没这个状态了 → 重新发一次请求） */
UI.townCanvas = function (w, h) {
  var c = document.createElement('canvas');
  c.width = w || 256; c.height = h || 128;
  return c;
};

var TOWN_TELEPORTS = (typeof TOWN_TELEPORTS !== 'undefined') ? TOWN_TELEPORTS : [];
var TOWN_HOUSE_INFO = (typeof TOWN_HOUSE_INFO !== 'undefined') ? TOWN_HOUSE_INFO : {};
var townHouseFridge = (typeof townHouseFridge !== 'undefined') ? townHouseFridge : null;
var townShopById = (typeof townShopById !== 'undefined') ? townShopById : null;
var TOWN_BUILDINGS = (typeof TOWN_BUILDINGS !== 'undefined') ? TOWN_BUILDINGS : [];
var TOWN_HOUSES = (typeof TOWN_HOUSES !== 'undefined') ? TOWN_HOUSES : [];
var TOWN_SHOPS = (typeof TOWN_SHOPS !== 'undefined') ? TOWN_SHOPS : [];
var TOWN_DATA = (typeof TOWN_DATA !== 'undefined') ? TOWN_DATA : null;
var townHouseSignSet = (typeof townHouseSignSet !== 'undefined') ? townHouseSignSet : null;

/* ---------- 小镇地图 ---------- */
var MAP_OPEN = false, MAP_ZOOM = 1, MAP_HITS = [], MAP_SEL = null, MAP_COPY_TXT = '';
var MAP_LIVE_ID = 0;
var MAP_FILTER = 'all', MAP_CX = 0, MAP_CZ = 0, MAP_MOBILE = false;
function mapKindName(b) {
  var k = b.k || '';
  if (b.tier === 'villa') { return '别墅'; }
  if (b.tier === 'yard') { return '小院'; }
  if (b.tier === 'flat') { return '小平楼'; }
  var m = { mart: '超市', dessert: '奶茶店', cafe: '咖啡店', ramen: '饭店', izakaya: '居酒屋',
    bakery: '面包店', clinic: '药铺', tea: '茶馆', flower: '花店', general: '杂货铺',
    bookstore: '书店', post: '邮局', inn: '旅店', bathhouse: '澡堂', smith: '铁匠铺',
    warehouse: '仓库', hall: '新手大厅', shrine: '神社', koban: '派出所', apartment: '公寓' };
  return m[k] || '建筑';
}
function mapShopOf(k) {
  for (var i = 0; i < TOWN_SHOPS.length; i++) { if (TOWN_SHOPS[i].id === k) { return i + 1; } }
  return 0;
}
function mapDraw() {
  MAP_HITS = [];
  var cv = document.getElementById('townMapCanvas');
  if (!cv) { return; }
  var box = cv.parentNode;
  var W = Math.max(320, cv.clientWidth || box.clientWidth || 800);
  var H = Math.max(320, cv.clientHeight || box.clientHeight || 700);
  var dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  var c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  var span = 520 / MAP_ZOOM;
  var sc = Math.min(W, H) / span;
  var cx = W / 2 - MAP_CX * sc, cy = H / 2 - MAP_CZ * sc;
  function X(wx) { return cx + wx * sc; }
  function Y(wz) { return cy + wz * sc; }
  function mapPass(group, wx, wz) {
    if (MAP_FILTER === 'all') { return true; }
    if (MAP_FILTER === 'center') { return wx >= -180 && wx <= -80 && wz >= 85 && wz <= 175; }
    if (MAP_FILTER === 'villa' || MAP_FILTER === 'yard' || MAP_FILTER === 'flat') { return group === MAP_FILTER; }
    if (MAP_FILTER === 'shop') { return group === 'shop'; }
    if (MAP_FILTER === 'road') { return group === 'road'; }
    return true;
  }
  c.fillStyle = '#5b7048'; c.fillRect(0, 0, W, H);
  /* 区域底色 */
  function rect(x0, z0, x1, z1, col) { c.fillStyle = col; c.fillRect(X(x0), Y(z0), (x1 - x0) * sc, (z1 - z0) * sc); }
  rect(-250, -250, 250, 250, '#667b51');
  rect(-210, -210, -110, -70, '#5e7350');
  rect(-210, 120, -100, 210, '#5e7350');
  rect(100, 120, 210, 210, '#5e7350');
  rect(-210, -80, -100, 80, '#5b7048');
  rect(-45, -45, 45, 45, '#7d7a68');
  c.strokeStyle = '#c8b88a'; c.lineWidth = 3; c.strokeRect(X(-250), Y(-250), 500 * sc, 500 * sc);
  /* 道路 */
  var roads = (TOWN_DATA && TOWN_DATA.roads) ? TOWN_DATA.roads : [];
  for (var ri = 0; ri < roads.length; ri++) {
    var r = roads[ri];
    var rmx = (r.x0 + r.x1) / 2, rmz = (r.z0 + r.z1) / 2;
    if (!mapPass('road', rmx, rmz)) { continue; }
    c.fillStyle = '#454842';
    c.fillRect(X(r.x0), Y(r.z0), Math.max(1.5, (r.x1 - r.x0) * sc), Math.max(1.5, (r.z1 - r.z0) * sc));
    c.strokeStyle = '#5f625a'; c.lineWidth = 1;
    c.strokeRect(X(r.x0), Y(r.z0), Math.max(1.5, (r.x1 - r.x0) * sc), Math.max(1.5, (r.z1 - r.z0) * sc));
    var mx = rmx, mz = rmz;
    var vertical = (r.z1 - r.z0) > (r.x1 - r.x0);
    var nm = r.name || ('道路 ' + (ri + 1));
    c.save(); c.translate(X(mx), Y(mz)); if (vertical) { c.rotate(-Math.PI / 2); }
    c.font = '600 10px "Microsoft YaHei",system-ui,sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = 'rgba(235,228,200,.88)';
    if (!MAP_MOBILE && MAP_ZOOM >= 1.45) { c.fillText(nm, 0, 0); }
    c.restore();
    MAP_HITS.push({ x0: X(r.x0), y0: Y(r.z0), x1: X(r.x1), y1: Y(r.z1),
      num: 'R' + (ri < 9 ? '0' : '') + (ri + 1), name: nm, kind: '道路', group: 'road', wx: mx, wz: mz });
  }
  /* 住宅 */
  var hIdx = 1;
  for (var hi = 0; hi < TOWN_HOUSES.length; hi++) {
    var h = TOWN_HOUSES[hi];
    var hcx = (h.x0 + h.x1) / 2, hcz = (h.z0 + h.z1) / 2;
    if (!mapPass(h.tier, hcx, hcz)) { continue; }
    var num = 'H' + (hIdx < 10 ? '0' : '') + hIdx++;
    var col = h.tier === 'villa' ? '#9b7a55' : (h.tier === 'yard' ? '#6f8a5a' : '#7b6a86');
    c.fillStyle = col; c.strokeStyle = 'rgba(255,240,210,.75)'; c.lineWidth = 1;
    c.fillRect(X(h.x0), Y(h.z0), (h.x1 - h.x0) * sc, (h.z1 - h.z0) * sc);
    c.strokeRect(X(h.x0), Y(h.z0), (h.x1 - h.x0) * sc, (h.z1 - h.z0) * sc);
    if (!MAP_MOBILE) {
      c.fillStyle = '#fff4d6'; c.font = '700 11px "Microsoft YaHei",system-ui,sans-serif';
      c.textAlign = 'left'; c.textBaseline = 'top';
      c.fillText(num, X(h.x0) + 3, Y(h.z0) + 2);
    }
    if (!MAP_MOBILE && MAP_ZOOM >= 1.45) {
      c.font = '600 9px "Microsoft YaHei",system-ui,sans-serif';
      c.fillStyle = 'rgba(36,26,16,.85)';
      c.fillText(h.name || '', X(h.x0) + 3, Y(h.z0) + 15);
    }
    MAP_HITS.push({ x0: X(h.x0), y0: Y(h.z0), x1: X(h.x1), y1: Y(h.z1),
      num: num, name: h.name || '住宅', kind: '住宅', group: h.tier, wx: hcx, wz: hcz });
  }
  /* 建筑 */
  var bIdx = 1;
  for (var bi = 0; bi < TOWN_BUILDINGS.length; bi++) {
    var b = TOWN_BUILDINGS[bi];
    var bcx = (b.x0 + b.x1) / 2, bcz = (b.z0 + b.z1) / 2;
    var isShop = mapShopOf(b.k) > 0;
    if (!mapPass(isShop ? 'shop' : 'building', bcx, bcz)) { continue; }
    var num2 = isShop ? ('S' + (mapShopOf(b.k) < 10 ? '0' : '') + mapShopOf(b.k)) : ('B' + (bIdx < 10 ? '0' : '') + bIdx);
    if (!isShop) { bIdx++; }
    var fill = isShop ? '#c08a52' : (b.k === 'hall' ? '#c8a85a' : '#6f7f86');
    if (b.k === 'shrine') { fill = '#9a6a5a'; }
    c.fillStyle = fill; c.strokeStyle = 'rgba(255,240,210,.85)'; c.lineWidth = 1.2;
    c.fillRect(X(b.x0), Y(b.z0), (b.x1 - b.x0) * sc, (b.z1 - b.z0) * sc);
    c.strokeRect(X(b.x0), Y(b.z0), (b.x1 - b.x0) * sc, (b.z1 - b.z0) * sc);
    if (!MAP_MOBILE) {
      c.fillStyle = '#fff4d6'; c.font = '700 11px "Microsoft YaHei",system-ui,sans-serif';
      c.textAlign = 'left'; c.textBaseline = 'top';
      c.fillText(num2, X(b.x0) + 3, Y(b.z0) + 2);
    }
    if (!MAP_MOBILE && MAP_ZOOM >= 1.45) {
      c.font = '700 9px "Microsoft YaHei",system-ui,sans-serif';
      c.fillStyle = 'rgba(33,24,14,.9)';
      c.fillText(b.name || mapKindName(b), X(b.x0) + 3, Y(b.z0) + 15);
    }
    MAP_HITS.push({ x0: X(b.x0), y0: Y(b.z0), x1: X(b.x1), y1: Y(b.z1),
      num: num2, name: b.name || mapKindName(b), kind: isShop ? '商店' : '建筑',
      group: isShop ? 'shop' : 'building', wx: bcx, wz: bcz });
  }
  /* 传送点 */
  var _tpList = (typeof townTeleportList === 'function') ? townTeleportList() : TOWN_TELEPORTS;
  for (var ti = 0; ti < _tpList.length; ti++) {
    var t = _tpList[ti];
    if (!mapPass('tp', t.x, t.z)) { continue; }
    c.fillStyle = '#6fd6ff'; c.strokeStyle = '#d8f8ff'; c.lineWidth = 1.5;
    c.beginPath(); c.arc(X(t.x), Y(t.z), Math.max(3, 4.2 * sc / 2), 0, Math.PI * 2); c.fill(); c.stroke();
    if (!MAP_MOBILE) {
      c.fillStyle = '#0e2733'; c.font = '800 9px "Microsoft YaHei",system-ui,sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('T' + (ti + 1), X(t.x), Y(t.z));
    }
    MAP_HITS.push({ x0: X(t.x) - 8, y0: Y(t.z) - 8, x1: X(t.x) + 8, y1: Y(t.z) + 8,
      num: 'T' + (ti + 1), name: t.name || '传送阵', kind: '传送', group: 'tp', wx: t.x, wz: t.z });
  }
  /* ★ 2026-10-22：把【已放置的物件】也画上来（以前地图只画静态布局 → 放/挪/删都看不出来）
     每次 mapDraw 都重新读 MY_OBJECTS，所以是实时的。 */
  try {
    var _objs = (window.MY_OBJECTS || []);
    var _cats = {};
    (window.MY_TOWN_CATALOG || []).forEach(function (cc) { _cats[cc.id] = cc; });
    var _onum = 0;
    for (var _oi = 0; _oi < _objs.length; _oi++) {
      var _o = _objs[_oi];
      if (!_o || _o.parent) { continue; }
      var _cd = _cats[_o.catalog];
      if (!_cd) { continue; }
      var _hw = (+_cd.size_w || 1) / 2, _hd = (+_cd.size_d || 1) / 2;
      var _rr = +_o.rot || 0;
      var _ca = Math.abs(Math.cos(_rr)), _sa = Math.abs(Math.sin(_rr));
      var _ex = _hw * _ca + _hd * _sa, _ez = _hw * _sa + _hd * _ca;
      var _x0 = X(+_o.x - _ex), _y0 = Y(+_o.z - _ez);
      var _w = _ex * 2 * sc, _h = _ez * 2 * sc;
      var _isB = (_cd.category === 'building');
      if (_isB) {
        c.fillStyle = 'rgba(58,64,74,.92)'; c.strokeStyle = 'rgba(200,214,232,.75)';
        c.lineWidth = 1.2;
      } else {
        c.fillStyle = 'rgba(150,140,120,.55)'; c.strokeStyle = 'rgba(210,196,168,.35)';
        c.lineWidth = 0.8;
      }
      c.fillRect(_x0, _y0, _w, _h);
      c.strokeRect(_x0, _y0, _w, _h);
      if (_isB && !MAP_MOBILE) {
        _onum++;
        c.fillStyle = '#0e1418'; c.font = '800 9px "Microsoft YaHei",system-ui,sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('O' + _onum, _x0 + _w / 2, _y0 + _h / 2);
      }
      MAP_HITS.push({ x0: _x0, y0: _y0, x1: _x0 + _w, y1: _y0 + _h,
        num: 'O' + _onum, name: (_cd.name || _o.catalog), kind: (_cd.category === 'building' ? '放置建筑' : '放置家具'),
        group: 'obj', wx: +_o.x, wz: +_o.z });
    }
  } catch (eMapObj) { }
  /* 区域名 */
  c.font = '800 13px "Microsoft YaHei",system-ui,sans-serif'; c.textAlign = 'center'; c.fillStyle = 'rgba(255,240,210,.55)';
  c.fillText('别墅区', X(-196), Y(36));
  c.fillText('小院区', X(-196), Y(226));
  c.fillText('小平楼区', X(-64), Y(226));
  c.fillText('中央公园', X(-210), Y(105));
  c.fillText('商业街', X(-105), Y(105));
  /* 自己（带朝向的三角，看得出面朝哪边） */
  var _px = X(P.x), _py = Y(P.z), _pyaw = P.yaw || 0;
  c.save();
  c.translate(_px, _py);
  c.rotate(-_pyaw + Math.PI);
  c.fillStyle = '#ff6a6a'; c.strokeStyle = '#fff'; c.lineWidth = 2;
  c.beginPath();
  c.moveTo(0, -8); c.lineTo(5.5, 5); c.lineTo(-5.5, 5); c.closePath();
  c.fill(); c.stroke();
  c.restore();
  c.fillStyle = '#ffe0e0'; c.font = '700 10px "Microsoft YaHei",system-ui'; c.textAlign = 'center';
  c.fillText('你', _px, _py - 13);
  /* 选中高亮 */
  if (MAP_SEL) {
    c.strokeStyle = '#ff6a5a'; c.lineWidth = 3;
    c.strokeRect(MAP_SEL.x0 - 2, MAP_SEL.y0 - 2, MAP_SEL.x1 - MAP_SEL.x0 + 4, MAP_SEL.y1 - MAP_SEL.y0 + 4);
  }
}
function mapShowHit(hit) {
  MAP_SEL = hit;
  var info = document.getElementById('mapInfo');
  var cp = document.getElementById('mapCopy');
  if (hit) {
    MAP_COPY_TXT = Math.round(hit.wx) + ', ' + Math.round(hit.wz);
    if (info) {
      info.innerHTML = '<b>' + hit.num + '</b> · ' + hit.name + '<br>' +
        '<span style="color:#9fe8ff">' + hit.kind + '</span><br>' +
        '坐标：' + MAP_COPY_TXT;
    }
    if (cp) { cp.style.display = 'block'; cp.textContent = '复制坐标'; }
  } else {
    MAP_COPY_TXT = '';
    if (info) { info.innerHTML = '这里没有建筑。<br><span class="mapHint">点击编号查看详情；地图可缩放。</span>'; }
    if (cp) { cp.style.display = 'none'; }
  }
  mapDraw();
}
function mapSelect(num) {
  for (var i = 0; i < MAP_HITS.length; i++) {
    if (MAP_HITS[i].num === num) { mapShowHit(MAP_HITS[i]); return; }
  }
}
function mapBuildList() {
  var box = document.getElementById('mapList');
  if (!box) { return; }
  var groups = [['建筑', 'B'], ['住宅', 'H'], ['商店', 'S'], ['传送', 'T'], ['道路', 'R']];
  var h = '';
  for (var gi = 0; gi < groups.length; gi++) {
    var pfx = groups[gi][1];
    h += '<div class="mapCat">' + groups[gi][0] + '</div>';
    var n = 0;
    for (var i = 0; i < MAP_HITS.length; i++) {
      var it = MAP_HITS[i];
      if (it.num.charAt(0) !== pfx) { continue; }
      h += '<div class="mapItem' + (pfx === 'R' ? ' road' : '') + '" onclick="mapSelect(\'' + it.num + '\')">' +
        '<b>' + it.num + '</b><span>' + it.name + '</span></div>';
      n++;
    }
    if (!n) { h += '<div class="mapHint">暂无</div>'; }
  }
  box.innerHTML = h;
}
function mapFilter(f) {
  MAP_FILTER = f || 'all';
  var bs = document.querySelectorAll('.mapF');
  for (var i = 0; i < bs.length; i++) {
    var on = bs[i].getAttribute('data-f') === MAP_FILTER;
    if (on) { bs[i].classList.add('on'); } else { bs[i].classList.remove('on'); }
  }
  mapDraw();
  mapBuildList();
}
function mapFit(which) {
  if (which === 'town') {
    MAP_ZOOM = 2.15; MAP_CX = -125; MAP_CZ = 140;
    if (MAP_FILTER !== 'villa' && MAP_FILTER !== 'yard' && MAP_FILTER !== 'flat' && MAP_FILTER !== 'shop') { MAP_FILTER = 'center'; mapFilter('center'); return; }
  } else {
    MAP_ZOOM = 0.95; MAP_CX = 0; MAP_CZ = 0;
  }
  mapDraw();
}
function mapListToggle() {
  var side = document.getElementById('mapSide');
  var b = document.getElementById('mapListBtn');
  if (!side) { return; }
  var on = !side.classList.contains('listOn');
  if (on) { side.classList.add('listOn'); if (b) { b.textContent = '收起编号列表'; } }
  else { side.classList.remove('listOn'); if (b) { b.textContent = '展开编号列表'; } }
}
function mapOpen() {
  MAP_OPEN = true;
  MAP_SEL = null; MAP_COPY_TXT = '';
  var _mi = document.getElementById('mapInfo');
  if (_mi) { _mi.innerHTML = '点击地图上的编号查看名称、类型、坐标。'; }
  MAP_MOBILE = (window.innerWidth <= 760 || window.innerHeight <= 620);
  /* 2026-10-22: centre the map on the town the player is actually in */
  var _tcx = (typeof TOWN_CX === 'number') ? TOWN_CX : -130;
  var _tcz = (typeof TOWN_CZ === 'number') ? TOWN_CZ : 130;
  MAP_FILTER = MAP_MOBILE ? 'center' : 'all';
  MAP_ZOOM = MAP_MOBILE ? 2.15 : 1.0;
  MAP_CX = _tcx;
  MAP_CZ = _tcz;
  try {
    var _tname = '新手小镇';
    var _ts = (window.MY_TOWNS || [])[0];
    if (_ts && _ts.name) { _tname = _ts.name; }
    var _tt = document.getElementById('mapTitle');
    if (_tt) { _tt.textContent = _tname + ' · 全景地图' + (_ts ? ('（' + _ts.tier + ' 格）') : ''); }
  } catch (eTName) { }
  var side = document.getElementById('mapSide');
  if (side) { side.classList.remove('listOn'); }
  var p = document.getElementById('mapPanel');
  if (p) { p.style.display = 'block'; }
  setTimeout(function () {
    mapFilter(MAP_FILTER);
    mapDraw();
    mapBuildList();
  }, 40);
  if (MAP_LIVE_ID) { clearInterval(MAP_LIVE_ID); }
  MAP_LIVE_ID = setInterval(function () {
    if (!MAP_OPEN) { clearInterval(MAP_LIVE_ID); MAP_LIVE_ID = 0; return; }
    try { mapDraw(); } catch (eL) { }
  }, 200);
}
function mapClose() {
  MAP_OPEN = false;
  if (MAP_LIVE_ID) { clearInterval(MAP_LIVE_ID); MAP_LIVE_ID = 0; }
  var p = document.getElementById('mapPanel');
  if (p) { p.style.display = 'none'; }
}
function mapZoom(d) {
  MAP_ZOOM = Math.max(0.7, Math.min(2.8, MAP_ZOOM + d * 0.25));
  mapDraw();
}
function mapPick(e) {
  var cv = document.getElementById('townMapCanvas');
  if (!cv) { return; }
  var r = cv.getBoundingClientRect();
  var mx = e.clientX - r.left, my = e.clientY - r.top;
  var hit = null;
  for (var i = MAP_HITS.length - 1; i >= 0; i--) {
    var h = MAP_HITS[i];
    if (mx >= h.x0 && mx <= h.x1 && my >= h.y0 && my <= h.y1) { hit = h; break; }
  }
  mapShowHit(hit);
}
function mapCopy() {
  if (!MAP_COPY_TXT) { return; }
  try { navigator.clipboard.writeText(MAP_COPY_TXT); } catch (e) { }
  var cp = document.getElementById('mapCopy');
  if (cp) { cp.textContent = '已复制 ' + MAP_COPY_TXT; setTimeout(function () { cp.textContent = '复制坐标'; }, 1200); }
}
(function mapBind() {
  var b = document.getElementById('mapBtn');
  if (b && !b._bound) { b._bound = true; b.addEventListener('click', function () { if (MAP_OPEN) { mapClose(); } else { mapOpen(); } }); }
  var c = document.getElementById('mapClose');
  if (c && !c._bound) { c._bound = true; c.addEventListener('click', mapClose); }
  var cv = document.getElementById('townMapCanvas');
  if (cv && !cv._bound) { cv._bound = true; cv.addEventListener('click', mapPick); }
  if (!window._mapKeyBound) {
    window._mapKeyBound = true;
    document.addEventListener('keydown', function (e) {
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') { return; }
      if (e.key === 'm' || e.key === 'M') { if (MAP_OPEN) { mapClose(); } else { mapOpen(); } e.preventDefault(); }
      if (e.key === 'Escape' && MAP_OPEN) { mapClose(); e.preventDefault(); }
    });
  }
  window.addEventListener('resize', function () { if (MAP_OPEN) { mapDraw(); } });
})();

UI.fridgeNear = function (h) {
  FRIDGE_NEAR = h || null;
  var atk = document.getElementById('atk');
  var pr = document.getElementById('shopPrompt');
  if (h) {
    if (atk) { atk.classList.remove('seat', 'sleep', 'house', 'teleport', 'interact', 'shop'); atk.classList.add('fridge'); atk.title = '冰箱'; }
    if (pr) { pr.textContent = '按 E / 点击交互按钮 打开冰箱'; pr.style.display = 'block'; }
  } else {
    if (atk) { atk.classList.remove('fridge'); }
    if (pr) { pr.style.display = 'none'; }
  }
};
var FRIDGE_NEAR = (typeof FRIDGE_NEAR !== 'undefined') ? FRIDGE_NEAR : null;

/* ---------- 点单 / 传菜 ---------- */
var ORDER_OPEN = false, ORDER_ID = '', ORDER_ITEMS = [], ORDER_MSG = '', ORDER_TITLE = '';
function orderShopNear() {
  if (typeof TOWN_SHOPS === 'undefined' || !TOWN_SHOPS) { return null; }
  for (var i = 0; i < TOWN_SHOPS.length; i++) {
    var s = TOWN_SHOPS[i];
    if (!s.served) { continue; }
    var dx = s.x - P.x, dz = s.z - P.z;
    if (dx * dx + dz * dz <= 4.6 * 4.6) { return s; }
  }
  return null;
}
function orderOpen() {
  var s = orderShopNear();
  if (!s) { toast('请先走到店里点单'); return; }
  if (typeof MY_SEAT === 'undefined' || !MY_SEAT) { toast('请先坐下再点单'); return; }
  ORDER_ID = s.id;
  ORDER_ITEMS = s.items || [];
  ORDER_MSG = '';
  ORDER_TITLE = s.name || '点单';
  ORDER_OPEN = true;
  var p = document.getElementById('orderPanel');
  if (p) { p.style.display = 'block'; }
  try { wsSend('order_open', {}); } catch (e) { }
  orderRender();
}
function orderClose() {
  ORDER_OPEN = false;
  var p = document.getElementById('orderPanel');
  if (p) { p.style.display = 'none'; }
  try { wsSend('order_close', {}); } catch (e) { }
}
function orderRender() {
  var body = document.getElementById('orderBody');
  var t = document.getElementById('orderTitle');
  if (t) { t.textContent = ORDER_TITLE; }
  if (!body || !ORDER_OPEN) { return; }
  var h = cupRowsHtml();
  if (!h) { h = '<div id="orderMsg">' + (ORDER_MSG || '选好的菜会由传菜员送到你桌上。') + '</div>'; }
  for (var i = 0; i < ORDER_ITEMS.length; i++) {
    var it = ORDER_ITEMS[i];
    h += '<div class="shopRow" data-key="' + (it.key || '') + '" data-fx="' +
      String(it.fx || it.desc || '').replace(/"/g, '&quot;') + '" data-nm="' +
      String(it.name || '').replace(/"/g, '&quot;') + '" data-pr="' + (it.price || 0) +
      '"><div class="shopIco">' + (it.icon || '🍽') + '</div>' +
      '<div class="shopMain"><div class="shopName">' + (it.name || '') + '</div>' +
      '<div class="shopDesc">' + (it.desc || '') + '</div></div>' +
      '<div><span class="shopPrice">' + (it.price || 0) + '</span>' +
      '<button class="shopBuy" onclick="orderBuy(\'' + it.key + '\')">点单</button></div></div>';
  }
  body.innerHTML = h;
  try { bindShopTip(body); } catch (eOT) { }
}
function orderApply(d) {
  if (!d) { return; }
  if (d.items) { ORDER_ITEMS = d.items; }
  if (d.name) { ORDER_TITLE = d.name; }
  if (d.msg) { ORDER_MSG = d.msg; }
  if (d.table && d.table.id) {
    TABLE_CUPS[d.table.id] = d.table;
    MY_TABLE = d.table.id;
    renderCups();
  }
  if (ORDER_OPEN) { orderRender(); }
  if (d.ok && d.msg && typeof toast === 'function') { toast(d.msg); }
}
function orderBuy(key) {
  try { wsSend('order_buy', { item: key }); ORDER_MSG = '点单中…'; orderRender(); } catch (e) { }
}
(function orderBind() {
  var c = document.getElementById('orderClose');
  if (c && !c._bound) { c._bound = true; c.addEventListener('click', orderClose); }
})();

/* ================= 桌上杯子 / 传菜员（A2） =================
 * 服务端 tablecups 给出每杯的世界坐标；这里只负责画出来。
 * 传菜员是一条 2.5s 的路径动画，起点=出餐口，终点=桌边。
 */
var TABLE_CUPS = {};        // tableId -> {id,x,z,max,cups[]}
var MY_TABLE = '';          // 当前坐的桌子（点单面板用）
var CUP_GROUP = null;
var WAITERS = [];
var WAITER_TIMER = null;

function cupScene() {
  if (typeof scene !== 'undefined' && scene) { return scene; }
  return window.scene || null;
}
function ensureCupGroup() {
  var S = cupScene();
  if (!S) { return null; }
  if (CUP_GROUP && CUP_GROUP.parent) { return CUP_GROUP; }
  CUP_GROUP = new THREE.Group();
  CUP_GROUP.name = 'tableCups';
  S.add(CUP_GROUP);
  return CUP_GROUP;
}
function cupMesh(model) {
  /* ★ 2026-10-22（用户："点单后桌子上要有对应的商品模型"）：
     以前只有 cup/bottle/plate/bowl/cake/crystal 六种，其余（卷轴/木箱/石头/
     砖/票…）全画成杯子。现在按商品 model 逐个给形状。 */
  var g = new THREE.Group();
  function M(c) { return new THREE.MeshLambertMaterial({ color: c }); }
  function cyl(rt, rb, h, c, y, seg) {
    var m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 12), M(c));
    m.position.y = y || 0; g.add(m); return m;
  }
  function box(w, h, d, c, x, y, z) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M(c));
    m.position.set(x || 0, y || 0, z || 0); g.add(m); return m;
  }
  switch (model) {
    case 'bottle':
      cyl(0.05, 0.06, 0.24, 0x8fb8c8, 0.12);
      cyl(0.022, 0.028, 0.08, 0x6a8a96, 0.28);
      break;
    case 'plate':
      cyl(0.17, 0.16, 0.02, 0xe8e0d0, 0.01, 18);
      cyl(0.13, 0.13, 0.02, 0xf4ecd8, 0.03, 16);
      box(0.11, 0.05, 0.11, 0xc88a4a, 0, 0.06, 0);
      break;
    case 'bowl':
      cyl(0.14, 0.10, 0.09, 0xcf6a4a, 0.045, 14);
      cyl(0.12, 0.12, 0.02, 0xe8d0b0, 0.10, 14);
      box(0.07, 0.03, 0.07, 0xd8a45a, 0, 0.11, 0);
      break;
    case 'cake':
      box(0.16, 0.09, 0.16, 0xf2d9a0, 0, 0.045, 0);
      box(0.17, 0.02, 0.17, 0xe8a8b8, 0, 0.10, 0);
      cyl(0.015, 0.015, 0.05, 0xff6a6a, 0, 0.13, 6);
      break;
    case 'bread':
      box(0.20, 0.10, 0.13, 0xd8a45a, 0, 0.05, 0);
      box(0.21, 0.03, 0.14, 0xe8c07a, 0, 0.11, 0);
      break;
    case 'crystal': {
      var cm = new THREE.Mesh(new THREE.OctahedronGeometry(0.08, 0), M(0x9ad0e8));
      cm.position.y = 0.09; g.add(cm);
      break;
    }
    case 'scroll': {
      var sc = cyl(0.045, 0.045, 0.22, 0xe8dcc8, 0.05, 8);
      sc.rotation.z = Math.PI / 2;
      cyl(0.05, 0.05, 0.02, 0xb08a5a, 0.05).rotation.z = Math.PI / 2;
      break;
    }
    case 'crate':
      box(0.22, 0.15, 0.20, 0xa87a4a, 0, 0.075, 0);
      box(0.23, 0.025, 0.21, 0x8a6038, 0, 0.155, 0);
      box(0.24, 0.02, 0.03, 0x8a6038, 0, 0.06, 0);
      break;
    case 'stone':
      cyl(0.09, 0.11, 0.08, 0x9a9a94, 0.04, 8);
      break;
    case 'brick':
      box(0.18, 0.10, 0.12, 0x9a6a4a, 0, 0.05, 0);
      box(0.185, 0.012, 0.125, 0x7a5238, 0, 0.10, 0);
      break;
    case 'ticket':
      box(0.16, 0.012, 0.10, 0xf0e8d0, 0, 0.006, 0);
      box(0.03, 0.014, 0.10, 0xd8c8a8, 0.06, 0.007, 0);
      break;
    default:
      cyl(0.07, 0.06, 0.11, 0xf0e6d6, 0.055, 12);
      var hd = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.011, 6, 10), M(0xf0e6d6));
      hd.position.set(0.095, 0.062, 0);
      hd.rotation.y = Math.PI / 2;
      g.add(hd);
      cyl(0.06, 0.06, 0.01, 0xb4784a, 0.10, 12);
      break;
  }
  return g;
}

function renderCups() {
  var grp = ensureCupGroup();
  if (!grp) { return; }
  while (grp.children.length) {
    var old = grp.children[0];
    grp.remove(old);
    if (old.traverse) { old.traverse(function (o) { if (o.geometry) { o.geometry.dispose(); } }); }
  }
  for (var tid in TABLE_CUPS) {
    var t = TABLE_CUPS[tid];
    if (!t || !t.cups) { continue; }
    for (var i = 0; i < t.cups.length; i++) {
      var c = t.cups[i];
      if (c.state === 'drunk' || c.state === 'gone') { continue; }
      var m = cupMesh(c.model || 'cup');
      /* 还在传菜路上的杯子做小一点/半透明，桌面只显示已到的 */
      if (c.state === 'cooking') {
        m.scale.set(0.6, 0.6, 0.6);
        m.traverse(function (o) { if (o.material) { o.material.transparent = true; o.material.opacity = 0.45; } });
      }
      /* ★ 2026-10-22：以前写死 0.78 → 杯子浮在桌面上方；现在用服务端按目录 height 算的 t.top */
      m.position.set(+c.x || +t.x, (+t.top > 0 ? +t.top : 0.78), +c.z || +t.z);
      grp.add(m);
    }
  }
}
function cupsApply(d) {
  if (!d || !d.table || !d.table.id) { return; }
  TABLE_CUPS[d.table.id] = d.table;
  if (MY_TABLE === d.table.id && ORDER_OPEN) { orderRender(); }
  renderCups();
}
function cupTake(slot, drink) {
  try {
    if (drink) {
      /* ★ 2026-10-22（用户："我们使用的喝的吃的是否有动画，手上有没有拿"）：
         在桌上"喝掉"以前只发包、没有任何动作。这里复用背包吃药的同一套动画
         （右手拿起杯子 → 抬手 → 放下）。 */
      var _t = TABLE_CUPS[MY_TABLE];
      var _c = null;
      if (_t && _t.cups) {
        for (var _i = 0; _i < _t.cups.length; _i++) {
          if (+_t.cups[_i].slot === +slot) { _c = _t.cups[_i]; break; }
        }
      }
      if (typeof eatStart === 'function') { eatStart((_c && _c.model) || 'cup'); }
    }
    wsSend('cup_take', { table: MY_TABLE, slot: slot, drink: drink ? 1 : 0 });
    ORDER_MSG = drink ? '喝一口…' : '收走…';
    orderRender();
  } catch (e) { }
}
window.cupTake = cupTake;

function waiterModel(shopName) {
  /* ★ 2026-10-22（用户："送过来要和现在在店里的人皮肤一样"）：
     传菜员的皮肤 = 同一家店【店员】的皮肤。
     店员名字是「店名 + 掌柜」，镇上的 clerk 就是用这个名字选皮肤的，
     所以这里用同一个 townNpcSkinId() 就能保证两张脸一模一样。 */
  try {
    if (typeof hero === 'function') {
      var _skin = 'f02';
      try {
        if (typeof townNpcSkinId === 'function') {
          _skin = townNpcSkinId(String(shopName || '') + '掌柜');
        }
      } catch (eSk) { }
      var r = hero(_skin, {});
      if (r && r.g) {
        if (r.sw) { r.sw.visible = false; }
        if (r.swL) { r.swL.visible = false; }
        var gg = r.g;
        if (typeof G !== 'undefined' && G.HERO_SCALE) {
          gg.scale.set(G.HERO_SCALE, G.HERO_SCALE, G.HERO_SCALE);
        }
        /* 托盘端在胸前（以前写 y=2.05 → 飘在头顶上方，看着根本不像在端东西） */
        var tray = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.035, 0.32),
          new THREE.MeshLambertMaterial({ color: 0xc8c0b0 }));
        tray.position.set(0, 1.02, 0.30);
        gg.add(tray);
        var dish = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.05, 12),
          new THREE.MeshLambertMaterial({ color: 0xe8e0d0 }));
        dish.position.set(0, 1.06, 0.30);
        gg.add(dish);
        /* 端着东西的姿势：两只手抬到身前，不再跟着走路甩 */
        try {
          if (r.armR) { r.armR.rotation.x = -1.15; r.armR.rotation.z = 0.12; }
          if (r.armL) { r.armL.rotation.x = -0.95; r.armL.rotation.z = -0.12; }
        } catch (eArm) { }
        gg.userData.hh = r;
        gg.userData.carry = true;
        return gg;
      }
    }
  } catch (e) { }
  var g = new THREE.Group();
  var b = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.8, 0.3),
    new THREE.MeshLambertMaterial({ color: 0x8a5a4a }));
  b.position.y = 0.9; g.add(b);
  return g;
}
function pathLength(path) {
  var n = 0;
  for (var i = 1; i < path.length; i++) {
    n += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  }
  return n;
}
function pathAt(path, k) {
  var total = pathLength(path), want = total * k, run = 0;
  for (var i = 1; i < path.length; i++) {
    var ax = path[i - 1][0], az = path[i - 1][1];
    var bx = path[i][0], bz = path[i][1];
    var seg = Math.hypot(bx - ax, bz - az);
    if (run + seg >= want || i === path.length - 1) {
      var t = seg > 0 ? (want - run) / seg : 0;
      if (t > 1) { t = 1; }
      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, yaw: Math.atan2(bx - ax, bz - az) };
    }
    run += seg;
  }
  return { x: path[0][0], z: path[0][1], yaw: 0 };
}
function spawnWaiter(d) {
  var path = d && d.path;
  if (!path || path.length < 2) { return; }
  var S = cupScene();
  if (!S) { return; }
  var m = waiterModel(d && d.name);
  m.position.set(+path[0][0], 0, +path[0][1]);
  S.add(m);
  WAITERS.push({ mesh: m, hh: m.userData.hh || null, path: path,
                 t0: Date.now(), secs: +(d.secs || 2.5) });
  if (!WAITER_TIMER) { WAITER_TIMER = setInterval(waiterTick, 50); }
}
function waiterTick() {
  var now = Date.now();
  for (var i = WAITERS.length - 1; i >= 0; i--) {
    var w = WAITERS[i];
    var k = (now - w.t0) / (w.secs * 1000);
    if (k >= 1) {
      if (w.mesh.parent) { w.mesh.parent.remove(w.mesh); }
      WAITERS.splice(i, 1);
      continue;
    }
    var pt = pathAt(w.path, k);
    w.mesh.position.set(pt.x, 0.1, pt.z);
    w.mesh.rotation.y = pt.yaw;
    /* 走路：和玩家/分身同一套肢体角度 */
    if (w.hh) {
      var sw = Math.sin((now - w.t0) * 0.008) * 0.7;
      w.hh.legL.rotation.x = sw;
      w.hh.legR.rotation.x = -sw;
      /* ★ 端着东西：手臂保持端盘姿势，只有轻微上下颠（不再左右大甩） */
      var bob = Math.sin((now - w.t0) * 0.008) * 0.06;
      w.hh.armL.rotation.x = -0.95 + bob;
      w.hh.armR.rotation.x = -1.15 + bob;
    }
  }
  if (!WAITERS.length && WAITER_TIMER) {
    clearInterval(WAITER_TIMER);
    WAITER_TIMER = null;
  }
}
/* ================= 小镇范围（地图选点 / 安全区视觉） ================= */
var TOWN_ZONES = [];
var ZONE_GROUP = null;
function zonesScene() {
  if (typeof scene !== 'undefined' && scene) { return scene; }
  return window.scene || null;
}
function renderTownZones() {
  var S = zonesScene();
  if (!S || typeof THREE === 'undefined') { return; }
  if (!ZONE_GROUP) {
    ZONE_GROUP = new THREE.Group();
    ZONE_GROUP.name = 'townZones';
    S.add(ZONE_GROUP);
  }
  while (ZONE_GROUP.children.length) {
    var old = ZONE_GROUP.children[0];
    ZONE_GROUP.remove(old);
    if (old.traverse) {
      old.traverse(function (o) {
        if (o.geometry) { o.geometry.dispose(); }
        if (o.material) { o.material.dispose(); }
      });
    }
  }
  for (var i = 0; i < TOWN_ZONES.length; i++) {
    var z = TOWN_ZONES[i];
    if (!z || +z.system) { continue; }       /* 主城 500m 的框不画，太吵 */
    var size = +z.size || 0;
    if (size <= 0) { continue; }
    var col = (z.status === 'active') ? 0x66d9ff : 0xffaa55;
    var geo = new THREE.PlaneGeometry(size, size);
    var face = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: col, transparent: true, opacity: 0.055, depthWrite: false,
      side: THREE.DoubleSide }));
    face.rotation.x = -Math.PI / 2;
    face.position.set(+z.x, 0.035, +z.z);
    ZONE_GROUP.add(face);
    var edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.55 }));
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(+z.x, 0.04, +z.z);
    ZONE_GROUP.add(edge);
  }
}
function townZonesApply(d) {
  TOWN_ZONES = (d && d.list) || [];
  /* ★ 2026-10-22：把最大的一座镇同步给 core 的旧兜底常量
     （TOWN_DATA 已经不用了 → TOWN_HALF 之前是默认 35 米 ✗ 导致"镇外"误判）*/
  try {
    var best = null;
    for (var i = 0; i < TOWN_ZONES.length; i++) {
      var t = TOWN_ZONES[i];
      if (!t || String(t.status || 'active') !== 'active') { continue; }
      if (!best || (+t.size || 0) > (+best.size || 0)) { best = t; }
    }
    if (best) {
      if (typeof TOWN_HALF !== 'undefined') { TOWN_HALF = (+best.size || 0) / 2; }
      if (typeof TOWN_CX !== 'undefined') { TOWN_CX = +best.x || 0; }
      if (typeof TOWN_CZ !== 'undefined') { TOWN_CZ = +best.z || 0; }
    }
  } catch (e2) { }
  try { renderTownZones(); } catch (e1) { }
}

function townClearedApply(d) {
  var x = +d.x || 0, z = +d.z || 0, r = +d.r || 60;
  try {
    var list = (typeof TOWN_OBJECTS_CACHE !== 'undefined' && TOWN_OBJECTS_CACHE) || [];
    var keep = [];
    for (var i = 0; i < list.length; i++) {
      var o = list[i], dx = (+o.x) - x, dz = (+o.z) - z;
      if (dx * dx + dz * dz > r * r) { keep.push(o); }
    }
    TOWN_OBJECTS_CACHE = keep;
    try { window.MY_OBJECTS = keep; } catch (e1) { }
  } catch (e2) { }
  try {
    if (window.PlaceMode && typeof window.PlaceMode.clearArea === 'function') {
      window.PlaceMode.clearArea(x, z, r);
    }
  } catch (e3) { }
  if (typeof toast === 'function') { toast('附近的小镇已冻结，建筑已移除'); }
}

function cupRowsHtml() {
  var t = TABLE_CUPS[MY_TABLE];
  if (!t || !t.cups || !t.cups.length) { return ''; }
  var h = '<div id="orderMsg">桌上：' + t.cups.length + ' / ' + (t.max || 0) + ' 杯</div>';
  for (var i = 0; i < t.cups.length; i++) {
    var c = t.cups[i];
    if (c.state === 'cooking') {
      h += '<div class="shopRow"><div class="shopIco">⏳</div><div class="shopMain">' +
        '<div class="shopName">' + (c.name || '') + '</div>' +
        '<div class="shopDesc">传菜员正在送…</div></div></div>';
      continue;
    }
    h += '<div class="shopRow"><div class="shopIco">' + (c.icon || '☕') + '</div><div class="shopMain">' +
      '<div class="shopName">' + (c.name || '') + '（桌上）</div>' +
      '<div class="shopDesc">喝掉会生效，收走只释放杯位</div></div>' +
      '<div><button class="shopBuy" onclick="cupTake(' + c.slot + ',1)">喝掉</button>' +
      '<button class="shopBuy" onclick="cupTake(' + c.slot + ',0)">收走</button></div></div>';
  }
  return h;
}

UI.seatedUpdate = function (s) {
  var atk = document.getElementById('atk');
  var pr = document.getElementById('orderPrompt');
  var s2 = orderShopNear();
  if (s && s2) {
    if (atk) { atk.classList.remove('seat', 'sleep', 'house', 'shop', 'fridge', 'interact', 'teleport'); atk.classList.add('order'); atk.title = '点单'; }
    if (pr) { pr.textContent = '按 E / 点击交互按钮 点单 · ' + (s2.name || ''); pr.style.display = 'block'; }
  } else {
    if (atk) { atk.classList.remove('order'); }
    if (pr) { pr.style.display = 'none'; }
  }
};

/* ---------- 打工 ---------- */
var MY_JOB = '', JOB_T = 0, JOB_LOOP = -1, JOB_DONE_N = 0;
function jobShopNear() { return (typeof SHOP_NEAR !== 'undefined' && SHOP_NEAR) ? SHOP_NEAR : null; }
function jobStart() {
  var s = jobShopNear();
  if (!s) { toast('请靠近店员'); return; }
  try { wsSend('work_start', { id: s.id, slot: 'serve' }); } catch (e) { }
}
function jobStop() {
  try { wsSend('work_stop', {}); } catch (e) { }
}
/* ★ 2026-10-22（用户："离线也继续挂机" / "按钮要一直保持结算状态"）
   打工点 + 累计开始时刻（存档里那个时间已经由服务端算好 ✓ 这里只管显示）*/
var MY_JOB_X = 0, MY_JOB_Z = 0, MY_JOB_T0 = 0, MY_JOB_REF = null, _JOB_SETTLED_AT = 0;
var MY_JOB_EXPH = 0, MY_JOB_PAYH = 0, MY_JOB_BASE = 0;
function jobHudSync() {
  var el = document.getElementById('jobHud');
  if (!el) { return; }
  if (!(typeof MY_JOB !== 'undefined' && MY_JOB)) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  /* ★ 2026-10-22（用户："打工中能看到已获得多少、打了多久"）
     sec = 服务端给的已累计（含离线）+ 本次在线时长 ✓ */
  var sec = Math.max(0, Math.floor((Date.now() - MY_JOB_T0) / 1000)) + (MY_JOB_BASE || 0);
  var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s2 = sec % 60;
  var t = (h > 0 ? (h + ':') : '') + (m < 10 ? '0' + m : m) + ':' + (s2 < 10 ? '0' + s2 : s2);
  var pay = Math.round((MY_JOB_PAYH || 0) * sec / 3600);
  var exp = Math.round((MY_JOB_EXPH || 0) * sec / 3600);
  var txt = document.getElementById('jobHudTxt');
  if (txt) {
    txt.innerHTML = '打工中 · <b>' + t + '</b><br>' +
      '<span style="color:#ffd83d">已赚 ' + pay.toLocaleString() + ' 金币</span> · ' +
      '<span style="color:#9fe8ff">' + exp.toLocaleString() + ' 经验</span>' +
      '<div style="opacity:.65;font-size:11px;margin-top:2px">点【结算打工】才会真正到手</div>';
  }
}
function jobHudBind() {
  var b = document.getElementById('jobHudBtn');
  if (b && !b._b) { b._b = true; b.onclick = function (e) { if (e) { e.preventDefault(); } jobStop(); }; }
}
function jobHudTick() { try { jobHudSync(); } catch (e) { } }

function workApply(d) {
  if (!d) { return; }
  if (d.ok && d.on) {
    MY_JOB = d.slot || 'serve';
    JOB_T = 0; JOB_DONE_N = 0;
    /* ★ 记住打工点：人物会被钉在这里（不能离开建筑 ✓）*/
    MY_JOB_X = (typeof d.x === 'number') ? +d.x : 0;
    MY_JOB_Z = (typeof d.z === 'number') ? +d.z : 0;
    MY_JOB_T0 = Date.now();
    MY_JOB_EXPH = +((d && d.expH) || 0);
    MY_JOB_PAYH = +((d && d.payH) || 0);
    MY_JOB_BASE = +((d && d.sec) || 0);
    try { jobHudBind(); jobHudSync(); } catch (eH) { }
    toast(d.msg === 'WORK_RESTORED' ? '继续打工中（只能点结算）' : (d.msg || '开始打工'));
    if (JOB_LOOP < 0 && typeof setInterval === 'function') {
      JOB_LOOP = setInterval(function () {
        if (!MY_JOB) { clearInterval(JOB_LOOP); JOB_LOOP = -1; return; }
        JOB_T += 0.25;
        try { wsSend('jobstep', { t: JOB_T }); } catch (e) { }
        /* 每 12 秒一轮：回柜台 -> 出餐口 -> 巡视 -> 回柜台 */
        if (JOB_T >= 12) {
          JOB_T = 0; JOB_DONE_N++;
          try { wsSend('jobdone', {}); } catch (e) { }
        }
      }, 250);
    }
  } else if (d.ok && d.on === 0) {
    MY_JOB = '';
    MY_JOB_X = 0; MY_JOB_Z = 0; MY_JOB_T0 = 0; MY_JOB_EXPH = 0; MY_JOB_PAYH = 0; MY_JOB_BASE = 0;
    try { jobHudSync(); } catch (eH2) { }
    if (Date.now() - (typeof _JOB_SETTLED_AT === 'number' ? _JOB_SETTLED_AT : 0) > 2500) {
      toast(d.msg === 'WORK_STOPPED' ? '已结束打工' : (d.msg || '已结束打工'));
    }
  } else if (d.msg) { toast(d.msg); }
}
function jobRemote(d) {
  if (!d || !NET.others) { return; }
  var o = NET.others[d.cid] || NET.others[String(d.cid)];
  if (!o) { return; }
  o.job = d.job; o.jobT = d.t;
}

/* ---------- 冰箱 ---------- */
var FRIDGE_OPEN = false, FRIDGE_ID = '', FRIDGE_ITEMS = [], FRIDGE_MSG = '', FRIDGE_CAP = 12;
function fridgeSlots() {
  var out = [], i, it;
  for (i = 0; i < FRIDGE_CAP; i++) { out.push(null); }
  for (i = 0; i < FRIDGE_ITEMS.length; i++) {
    it = FRIDGE_ITEMS[i];
    if (it && it.slot >= 0 && it.slot < FRIDGE_CAP) { out[it.slot] = it; }
  }
  return out;
}
function fridgeOpen(id) {
  FRIDGE_ID = id;
  FRIDGE_OPEN = true;
  FRIDGE_MSG = '';
  var p = document.getElementById('fridgePanel');
  if (p) { p.style.display = 'block'; }
  try { wsSend('fridge_open', { id: id }); } catch (e) { }
  /* ★ 2026-10-22（用户："打开冰箱时没有同时打开背包，怎么存放东西"）
     → 打开冰箱先把背包拉一次，再把面板画出来 ✓（面板下半截就是背包里的食品/饮料）*/
  try {
    if (typeof bagFetch === 'function') {
      bagFetch(function () { try { fridgeRender(); } catch (e2) { } });
    }
  } catch (e1) { }
  fridgeRender();
}
function fridgeClose() {
  FRIDGE_OPEN = false;
  var p = document.getElementById('fridgePanel');
  if (p) { p.style.display = 'none'; }
  try { wsSend('fridge_close', {}); } catch (e) { }
}
function fridgeRender() {
  var body = document.getElementById('fridgeBody');
  if (!body || !FRIDGE_OPEN) { return; }
  var slots = fridgeSlots();
  var h = '<div id="fridgeMsg">' + (FRIDGE_MSG || '') + '</div>';
  h += '<div id="fridgeGrid">';
  for (var i = 0; i < FRIDGE_CAP; i++) {
    var st = slots[i];
    if (st) {
      var nm = (st.item && st.item.name) || '饮料';
      h += '<div class="frSlot" data-slot="' + i + '" onclick="fridgeTake(' + i + ')">' +
        '<span class="ico">' + ((st.item && st.item.icon) || '🥤') + '</span>' + nm + '</div>';
    } else {
      h += '<div class="frSlot" style="opacity:.4">空</div>';
    }
  }
  h += '</div>';
  h += '<div id="fridgeBag"><div style="font-weight:800;margin-bottom:4px;color:#9fe8ff">背包里的饮料/食品（点一下放进冰箱）</div>';
  var n = 0;
  var items = (typeof BAG !== 'undefined' && BAG.items) ? BAG.items : [];
  for (var k = 0; k < items.length; k++) {
    var rec = items[k];
    if (!rec || !rec.item || rec.item.kind !== 'food') { continue; }
    n++;
    h += '<div class="frItem"><span>' + (rec.item.icon || '🥤') + '</span><span style="flex:1">' +
      (rec.item.name || 'drink') + ((rec.stack || 1) > 1 ? ' ×' + rec.stack : '') + '</span>' +
      '<button class="shopBuy" onclick="fridgePut(\'' + rec.id + '\')">放入</button></div>';
  }
  if (!n) { h += '<div style="opacity:.6;font-size:12px;padding:6px 0">背包里没有饮料/食品。去商店买点吧。</div>'; }
  h += '</div>';
  body.innerHTML = h;
}
function fridgeApply(d) {
  if (!d) { return; }
  if (typeof d.cap === 'number') { FRIDGE_CAP = d.cap; }
  if (d.items) { FRIDGE_ITEMS = d.items; }
  if (d.msg) { FRIDGE_MSG = d.msg; }
  if (FRIDGE_OPEN) { fridgeRender(); }
  if (d.ok && d.items) {
    setTimeout(function () { try { if (typeof bagFetch === 'function') { bagFetch(); } } catch (e) { } }, 400);
  }
}
function fridgePut(iid) {
  if (!FRIDGE_ID) { return; }
  try { wsSend('fridge_put', { id: FRIDGE_ID, iid: iid }); FRIDGE_MSG = '放入中…'; fridgeRender(); } catch (e) { }
}
function fridgeTake(slot) {
  if (!FRIDGE_ID) { return; }
  try { wsSend('fridge_take', { id: FRIDGE_ID, slot: slot }); FRIDGE_MSG = '取出中…'; fridgeRender(); } catch (e) { }
}
(function fridgeBind() {
  var c = document.getElementById('fridgeClose');
  if (c && !c._bound) { c._bound = true; c.addEventListener('click', fridgeClose); }
})();

/* ---------- 商店 ---------- */
var SHOP_WORKERS = {};
var SHOP_OPEN = false, SHOP_ID = '', SHOP_ITEMS = [], SHOP_GOLD = 0, SHOP_MSG = '', SHOP_NEAR = null;
function shopNearApply(s) {
  SHOP_NEAR = s || null;
  var atk = document.getElementById('atk');
  var pr = document.getElementById('shopPrompt');
  if (s) {
    if (atk) { atk.classList.remove('seat', 'sleep', 'house', 'teleport', 'interact'); atk.classList.add('shop'); atk.title = '购买'; }
    if (pr) { pr.textContent = '按 E / 点击交互按钮 购买 · ' + (s.name || ''); pr.style.display = 'block'; }
  } else {
    if (atk) { atk.classList.remove('shop'); }
    if (pr) { pr.style.display = 'none'; }
  }
}
UI.shopNear = function (s) { shopNearApply(s); };
function shopClose() {
  SHOP_OPEN = false;
  var p = document.getElementById('shopPanel');
  if (p) { p.style.display = 'none'; }
  try { wsSend('shop_close', {}); } catch (e) { }
}
function shopOpen() {
  if (!SHOP_NEAR) { return; }
  SHOP_OPEN = true;
  SHOP_ID = SHOP_NEAR.id;
  SHOP_ITEMS = SHOP_NEAR.items || [];
  SHOP_WORKERS = {};
  SHOP_GOLD = +(WSC.role && WSC.role.gold) || 0;
  SHOP_MSG = '';
  var p = document.getElementById('shopPanel');
  if (p) { p.style.display = 'block'; }
  try { wsSend('shop_open', { id: SHOP_ID }); } catch (e) { }
  shopRender();
}
/* ★ 2026-10-22（用户："悬浮窗口说明效果"）：商店/点单的商品行 → 悬浮显示说明
   以前这段绑错了函数（绑到点单面板）✗ 而且只绑一次 ✗ 换店就不生效 ✓ */
function bindShopTip(body) {
  if (!body || body._tipBound) { return; }
  body._tipBound = true;
  body.addEventListener('mouseover', function (e) {
    var t2 = e.target;
    while (t2 && t2 !== body && !(t2.getAttribute && t2.getAttribute('data-key'))) { t2 = t2.parentNode; }
    if (!t2 || t2 === body) { return; }
    var nm = t2.getAttribute('data-nm') || '';
    var fx = t2.getAttribute('data-fx') || '';
    var pr = t2.getAttribute('data-pr') || '0';
    var html = '<div style="font-weight:800;color:#ffd83d;margin-bottom:4px">' + nm + '</div>' +
      '<div style="color:#cfd8e4">' + fx + '</div>' +
      '<div style="margin-top:4px;color:#8ee0ff">价格 ' + pr + ' 金币</div>';
    try { bagTipShowAt(e.clientX, e.clientY, html); } catch (e3) { }
  });
  body.addEventListener('mouseout', function (e) {
    var t3 = e.target;
    if (t3 && t3.getAttribute && t3.getAttribute('data-key')) {
      try { bagTipHide(); } catch (e4) { }
    }
  });
  body.addEventListener('scroll', function () { try { bagTipHide(); } catch (e5) { } }, true);
}

function shopRender() {
  var body = document.getElementById('shopBody');
  var title = document.getElementById('shopTitle');
  var gold = document.getElementById('shopGold');
  if (!body || !SHOP_OPEN) { return; }
  var s = (typeof townShopById === 'function') ? townShopById(SHOP_ID) : null;
  if (title) { title.textContent = (s ? s.name : '商店') + (s && s.keeper ? ' · ' + s.keeper : ''); }
  if (gold) { gold.textContent = '金币 ' + Math.round(SHOP_GOLD); }
  var h = '<div id="shopMsg">' + (SHOP_MSG || '') + '</div>';
  /* ★ 2026-10-22（用户："下线了也可以看到"）：岗位占用写在店铺面板顶上
     离线的工人也算（服务端 dyn_shops.workers 里带名字 ✓）*/
  try {
    var _wk = SHOP_WORKERS || (s && s.workers) || {};
    var _wkNames = [];
    for (var _ks in _wk) {
      var _wv = _wk[_ks] || {};
      _wkNames.push((_wv.name || '有人') + (_wv.off ? '（离线打工中）' : '（打工中）'));
    }
    if (_wkNames.length) {
      h += '<div style="margin:6px 0;padding:6px 10px;border-radius:8px;' +
        'background:#1b2733;color:#9fe8ff;font-size:13px">岗位：' +
        _wkNames.join(' · ') + '</div>';
    }
  } catch (eWk) { }
  for (var i = 0; i < SHOP_ITEMS.length; i++) {
    var it = SHOP_ITEMS[i];
    var can = SHOP_GOLD >= (+it.price || 0);
    var _fx = String(it.fx || it.desc || '');
    h += '<div class="shopRow" data-key="' + (it.key || '') + '" data-fx="' + _fx.replace(/"/g, '&quot;') +
      '" data-nm="' + String(it.name || '').replace(/"/g, '&quot;') +
      '" data-pr="' + (it.price || 0) + '"><div class="shopIco">' + (it.icon || '🛒') + '</div>' +
      '<div class="shopMain"><div class="shopName">' + (it.name || '') + '</div>' +
      '<div class="shopDesc">' + (it.desc || '') + '</div></div>' +
      '<div><span class="shopPrice">' + (it.price || 0) + '</span>' +
      '<button class="shopBuy" ' + (can ? '' : 'disabled ') +
      'onclick="shopBuy(\'' + it.key + '\')">购买</button></div></div>';
  }
  body.innerHTML = h;
  try { bindShopTip(body); } catch (eST) { }
}
function shopApply(d) {
  if (!d) { return; }
  if (typeof d.gold === 'number') { SHOP_GOLD = d.gold; }
  if (d.items) { SHOP_ITEMS = d.items; }
  /* ★ 2026-10-22（用户："下线了也可以看到"）：岗位占用从服务端来（离线也带名字）*/
  if (d.workers && typeof d.workers === 'object') { SHOP_WORKERS = d.workers; }
  if (d.msg) { SHOP_MSG = d.msg; }
  if (d.ok === 0 && d.msg) { SHOP_MSG = d.msg; }
  if (SHOP_OPEN) { shopRender(); }
  if (d.ok && d.bagsig) {
    setTimeout(function () { try { if (typeof bagFetch === 'function') { bagFetch(); } } catch (e) { } }, 500);
  }
}
function shopBuy(key) {
  if (!SHOP_ID) { return; }
  try { wsSend('shop_buy', { id: SHOP_ID, item: key }); SHOP_MSG = '购买中…'; shopRender(); } catch (e) { }
}
(function shopBind() {
  var c = document.getElementById('shopClose');
  if (c && !c._bound) { c._bound = true; c.addEventListener('click', shopClose); }
})();

/* ---------- 睡觉 ---------- */
function trySleep() {
  if (!SLEEP_NEAR) { return; }
  var pr = document.getElementById('sleepPrompt');
  if (pr) { pr.style.display = 'none'; }
  try { wsSend('house_sleep', { id: SLEEP_NEAR.id }); } catch (e) { }
}
function tryWake() {
  try { wsSend('house_wake', {}); } catch (e) { }
}
function sleepApply(d) {
  if (!d) { return; }
  /* ★ 2026-10-22：只有"我自己的"睡觉/起床消息才能动我（以前别人一睡觉你也跟着上床） */
  if (!d.self) { return; }
  if (d.on) {
    MY_SLEEP = d.id || '';
    if (typeof d.x === 'number') { P.x = +d.x; P.z = +d.z; }
    /* ★ 2026-10-22：床的朝向（服务端给的），躺姿用它，不要用玩家自己的朝向 */
    if (typeof d.yaw === 'number') { P.sleepYaw = +d.yaw; P.yaw = +d.yaw; }
    SLEEP_NEAR = null;
    try { if (UI.bedNear) { UI.bedNear(null); } } catch (e1) { }
    try { if (UI.houseNear) { UI.houseNear(null); } } catch (e2) { }
    try { if (UI.sleepState) { UI.sleepState(true); } } catch (e3) { }
  } else {
    MY_SLEEP = '';
    if (typeof d.x === 'number') { P.x = +d.x; P.z = +d.z; }
    try { if (UI.sleepState) { UI.sleepState(false); } } catch (e4) { }
  }
}
UI.bedNear = function (h) {
  SLEEP_NEAR = h || null;
  var atk = document.getElementById('atk');
  var pr = document.getElementById('sleepPrompt');
  if (h) {
    if (atk) { atk.classList.remove('seat', 'teleport', 'house', 'interact'); atk.classList.add('sleep'); atk.title = '睡觉'; }
    if (pr) { pr.textContent = '按 E / 点击交互按钮 睡觉'; pr.style.display = 'block'; }
  } else {
    if (atk) { atk.classList.remove('sleep'); }
    if (pr) { pr.style.display = 'none'; }
  }
};
UI.sleepState = function (on) {
  var atk = document.getElementById('atk');
  var pr = document.getElementById('sleepPrompt');
  if (on) {
    if (atk) { atk.classList.remove('sleep', 'seat', 'teleport', 'house', 'interact'); atk.classList.add('wake'); atk.title = '起床'; }
    if (pr) { pr.textContent = '睡觉中 · 按 E / 点按钮 起床'; pr.style.display = 'block'; }
  } else {
    if (atk) { atk.classList.remove('wake'); }
    if (pr) { pr.style.display = 'none'; }
  }
};

/* ---------- 住宅 ---------- */
var HOUSE_DATA = {}, HOUSE_NEAR = null, HOUSE_OPEN = false, HOUSE_SEL = null, HOUSE_DAYS = 1, HOUSE_MSG = '';
function houseTierName(t) { return t === 'villa' ? '别墅' : (t === 'yard' ? '小院' : '小平楼'); }
function houseGold(v) {
  v = Math.round(+v || 0);
  if (v >= 10000) { return (v / 10000).toFixed(v % 10000 ? 1 : 0) + ' 万'; }
  return String(v);
}
function housesApply(list) {
  for (var i = 0; i < (list || []).length; i++) {
    var h = list[i];
    if (!h || !h.id) { continue; }
    HOUSE_DATA[h.id] = h;
    try { TOWN_HOUSE_INFO[h.id] = h; } catch (eTI) { }
    try {
      if (typeof townHouseSignSet === 'function') {
        townHouseSignSet(h.id, h.owner_name || '', h.remaining_days || 0);
      }
    } catch (eS) { }
  }
  if (HOUSE_OPEN) { houseRender(); }
}
function houseApply(d) {
  if (!d) { return; }
  if (d.list) { housesApply(d.list); }
  if (d.msg) { HOUSE_MSG = d.msg; }
  try {
    var _hh = HOUSE_DATA[HOUSE_SEL];
    var _me = +(WSC.role && WSC.role.id) || 0;
    if (_hh && +_hh.owner_id === _me && (+_hh.remaining_days || 0) > 0 && (+_hh.remaining_days || 0) < 7) {
      HOUSE_DAYS = Math.min(7, (+_hh.remaining_days || 0) + 1);
    }
  } catch (eD) { }
  houseRender();
}
function houseNearApply(h) {
  HOUSE_NEAR = h || null;
  var atk = document.getElementById('atk');
  var pr = document.getElementById('housePrompt');
  if (h) {
    if (atk) { atk.classList.remove('seat', 'teleport', 'interact'); atk.classList.add('house'); atk.title = '查看住宅'; }
    if (pr) { pr.textContent = '按 E / 点击交互按钮 查看住宅 · ' + (h.name || ''); pr.style.display = 'block'; }
  } else {
    if (atk) { atk.classList.remove('house'); }
    if (pr) { pr.style.display = 'none'; }
  }
}
UI.houseNear = function (h) { houseNearApply(h); };
function houseClose() {
  HOUSE_OPEN = false;
  var p = document.getElementById('housePanel');
  if (p) { p.style.display = 'none'; }
}
function houseOpen() {
  if (!HOUSE_NEAR) { return; }
  HOUSE_OPEN = true;
  HOUSE_SEL = HOUSE_NEAR.id;
  HOUSE_DAYS = 1;
  var p = document.getElementById('housePanel');
  if (p) { p.style.display = 'block'; }
  try { wsSend('house_info', { id: HOUSE_SEL }); } catch (e) { }
  houseRender();
}
function houseEstimate(h, days) {
  if (!h) { return 0; }
  var price = +h.price_day || 0, rem = +h.remaining_days || 0;
  var owner = +h.owner_id || 0, me = +(WSC.role && WSC.role.id) || 0;
  if (owner && owner === me) { return Math.max(0, days - rem) * price; }
  if (owner && rem > 0) {
    return Math.ceil(rem * price * 1.5) + Math.max(0, days - rem) * price;
  }
  return days * price;
}
function houseRender() {
  var body = document.getElementById('houseBody');
  if (!body || !HOUSE_OPEN) { return; }
  var h = HOUSE_DATA[HOUSE_SEL] || HOUSE_NEAR;
  if (!h) { body.innerHTML = '<div class="hMuted">房屋数据加载中…</div>'; return; }
  var me = +(WSC.role && WSC.role.id) || 0;
  var owner = +h.owner_id || 0;
  var rem = +h.remaining_days || 0;
  var price = +h.price_day || 0;
  var mine = owner && owner === me;
  var occupied = owner && owner !== me;
  var minDays = occupied ? Math.max(1, rem) : 1;
  var days = Math.max(minDays, Math.min(7, +HOUSE_DAYS || 1));
  HOUSE_DAYS = days;
  var est = houseEstimate(h, days);
  var opts = '';
  for (var d = 1; d <= 7; d++) {
    opts += '<option value="' + d + '"' + (d === days ? ' selected' : '') + '>' + d + ' 天</option>';
  }
  var html = '';
  html += '<div class="hRow"><b style="font-size:18px">' + (h.name || '') + '</b><span class="hMuted">' + houseTierName(h.tier) + '</span></div>';
  html += '<div class="hRow"><span>日价</span><span class="hPrice">' + houseGold(price) + ' / 天</span></div>';
  html += '<div class="hRow"><span>房主</span><span>' + (owner ? (h.owner_name || '—') : '待售') + '</span></div>';
  html += '<div class="hRow"><span>剩余</span><span>' + (rem > 0 ? rem + ' 天' : '—') + '</span></div>';
  if (occupied) {
    html += '<div class="hRow"><span>买断底价</span><span class="hPrice">' + houseGold(Math.ceil(rem * price * 1.5)) + '</span></div>';
    html += '<div class="hMuted">买断需接手剩余 ' + rem + ' 天；原房主按剩余天数 + 溢价 10% 退款。</div>';
  } else if (mine) {
    html += '<div class="hMuted">续期最多到 7 天；退房返还剩余天数 50%。</div>';
  } else {
    html += '<div class="hMuted">购买 1~7 天，到期自动待售。</div>';
  }
  html += '<div class="hRow" style="margin-top:10px"><span>选择天数</span><span class="hPrice" id="houseEst">' + houseGold(est) + '</span></div>';
  html += '<select id="houseDays" onchange="HOUSE_DAYS=+this.value;houseRender();">' + opts + '</select>';
  html += '<div id="houseMsg" class="hMuted"></div>';
  if (occupied) {
    html += '<button class="hBtn alt" onclick="houseDoBuy()">买断 · 支付 ' + houseGold(est) + '</button>';
  } else if (mine) {
    html += '<button class="hBtn" onclick="houseDoBuy()">续期 · 支付 ' + houseGold(est) + '</button>';
    html += '<button class="hBtn danger" onclick="houseDoLeave()">退房 · 返还剩余 50%</button>';
  } else {
    html += '<button class="hBtn" onclick="houseDoBuy()">购买 · 支付 ' + houseGold(est) + '</button>';
  }
  body.innerHTML = html;
  var m = document.getElementById('houseMsg');
  if (m && HOUSE_MSG) { m.textContent = HOUSE_MSG; }
}
var HOUSE_MSG = HOUSE_MSG || '';
function houseDoBuy() {
  if (!HOUSE_SEL) { return; }
  try { wsSend('house_buy', { id: HOUSE_SEL, days: HOUSE_DAYS }); HOUSE_MSG = '处理中…'; houseRender(); } catch (e) { }
}
function houseDoLeave() {
  if (!HOUSE_SEL) { return; }
  try { wsSend('house_leave', { id: HOUSE_SEL }); HOUSE_MSG = '处理中…'; houseRender(); } catch (e) { }
}
function houseBind() {
  var c = document.getElementById('houseClose');
  if (c && !c._bound) { c._bound = true; c.addEventListener('click', houseClose); }
}
(function houseInit() {
  var c = document.getElementById('houseClose');
  if (c && !c._bound) { c._bound = true; c.addEventListener('click', houseClose); }
})();

/* ---------- 传送阵 ---------- */
var TP = { open: false };
function tpApply(d) {
  if (!d) { return; }
  P.x = +d.x; P.z = +d.z;
  TP.open = false;
  var p = document.getElementById('tpPanel');
  if (p) { p.style.display = 'none'; }
  var pr = document.getElementById('tpPrompt');
  if (pr) { pr.style.display = 'none'; }
  toast('已传送：' + (d.name || ''));
}
function tpClose() {
  TP.open = false;
  var p = document.getElementById('tpPanel');
  if (p) { p.style.display = 'none'; }
}
function tpOpen() {
  if (!TP_NEAR) { return; }
  /* ★ 2026-10-22（用户："传送菜单只能选择传送点后才能关闭，不能点 X 关闭"）：
     根因 = 右上角 X 的点击事件【从来没绑定过】。
     tpBind() 原来只在 UI.teleportNear() 里调，传送阵改成放置物件后那条路不走了，
     面板却是直接 tpOpen() 打开的 → X 是个死按钮。这里打开时强制绑定一次。 */
  tpBind();
  TP.open = true;
  var p = document.getElementById('tpPanel');
  if (p) { p.style.display = 'block'; }
  tpRender();
}
function tpRender() {
  var box = document.getElementById('tpList');
  if (!box) { return; }
  var h = '';
  /* ★ 2026-10-22：传送阵现在是可放置物件，列表也按实际放置的算 */
  var list = (typeof townTeleportList === 'function') ? townTeleportList()
    : ((typeof TOWN_TELEPORTS !== 'undefined') ? TOWN_TELEPORTS : []);
  for (var i = 0; i < list.length; i++) {
    h += '<button class="tpBtn" data-tpid="' + list[i].id + '" onclick="tpPick(\'' + list[i].id + '\')">' +
      '<b>' + list[i].name + '</b><span>传送</span></button>';
  }
  box.innerHTML = h;
}
function tpPick(id) {
  var pr = document.getElementById('tpPrompt');
  if (pr) { pr.style.display = 'none'; }
  try { wsSend('teleport', { id: id }); } catch (e) { }
  tpClose();
}
function tpBind() {
  var c = document.getElementById('tpClose');
  if (c && !c._bound) { c._bound = true; c.addEventListener('click', tpClose); }
  if (window._tpDocBound) { return; }
  window._tpDocBound = true;
  document.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== document && !(t.getAttribute && t.getAttribute('data-tpid'))) { t = t.parentNode; }
    if (!t || t === document) { return; }
    var tid = t.getAttribute('data-tpid');
    if (!tid) { return; }
    try { wsSend('teleport', { id: tid }); } catch (e2) { }
    tpClose();
  });
}
UI.teleportNear = function (t) {
  TP_NEAR = t || null;
  var atk = document.getElementById('atk');
  var pr = document.getElementById('tpPrompt');
  if (t) {
    if (atk) { atk.classList.remove('seat', 'interact'); atk.classList.add('teleport'); atk.title = '传送'; }
    if (pr) { pr.textContent = '按 E / 点击交互按钮 打开传送阵 · ' + (t.name || ''); pr.style.display = 'block'; }
  } else {
    if (atk) { atk.classList.remove('teleport'); }
    if (pr) { pr.style.display = 'none'; }
  }
  if (t) { tpBind(); }
};

/* ---------- 椅子交互 ---------- */
var SEAT_NEAR = (typeof SEAT_NEAR !== 'undefined') ? SEAT_NEAR : null;
function trySit() {
  if (!SEAT_NEAR) { return; }
  if (typeof WSC !== 'undefined' && !WSC.ready) { toast('连接中，请稍后再试'); return; }
  try { SIT_PENDING = true; } catch (eP) { }
  setTimeout(function () {
    try {
      SIT_PENDING = false;
      if (!MY_SEAT && SEAT_NEAR && UI.seatNear) { UI.seatNear(SEAT_NEAR); }
    } catch (eP2) { }
  }, 1600);
  var pr = document.getElementById('sitPrompt');
  if (pr) { pr.textContent = '正在坐下…'; }
  /* ★ 2026-10-22：放置的家具椅子没有 idx（只有 id=obj<id>）→ 以前这里发出 id=undefined */
  var _sid = (SEAT_NEAR.idx != null) ? SEAT_NEAR.idx : SEAT_NEAR.id;
  try { wsSend('sit', { id: _sid }); } catch (eS) { toast('坐下失败'); }
}
function tryStand() {
  if (typeof WSC !== 'undefined' && !WSC.ready) { return; }
  try { wsSend('stand', {}); } catch (eT) { }
}
UI.seatNear = function (seat) {
  SEAT_NEAR = seat || null;
  var atk = document.getElementById('atk');
  var prompt = document.getElementById('sitPrompt');
  var wp = document.getElementById('whPrompt');
  if (seat) {
    if (atk) {
      atk.classList.remove('interact'); atk.classList.add('seat');
      atk.title = '坐下：' + (seat.label || '椅子');
    }
    if (prompt) {
      prompt.textContent = '按 E / 点击交互按钮 坐下 · ' + (seat.label || '椅子');
      prompt.style.display = 'block';
    }
    if (wp) { wp.style.display = 'none'; }
  } else {
    if (atk) { atk.classList.remove('seat'); }
    if (prompt) { prompt.style.display = 'none'; }
  }
};
UI.seatState = function (on) {
  var atk = document.getElementById('atk');
  var prompt = document.getElementById('sitPrompt');
  var wp = document.getElementById('whPrompt');
  if (on) {
    if (atk) { atk.classList.remove('interact', 'seat'); atk.classList.add('stand'); atk.title = '起身'; }
    /* ★ 2026-10-22（用户：坐下后提示又显示出来，坐下不需要提示）
       坐着时只把按钮改成"起身"，不再弹提示文字 */
    if (prompt) { prompt.style.display = 'none'; }
    if (wp) { wp.style.display = 'none'; }
  } else {
    if (atk) { atk.classList.remove('stand'); }
    if (prompt) { prompt.style.display = 'none'; }
  }
};

UI.warehouseNear = function (on) {
  WH_NEAR = !!on;
  var atk = document.getElementById('atk');
  if (atk) { atk.classList.toggle('interact', !!on); atk.title = on ? '交互：打开仓库' : ''; }
  var pr = document.getElementById('whPrompt');
  if (pr) { pr.style.display = on ? 'block' : 'none'; }
};

/* ============================================================ 视角转动（round497）
   ★ 用户："加一个按钮，点击后开启，再点击锁定视角；长按恢复默认；图标带状态；
           像攻击键一样可以移动"
   ★ 状态只有两个：
       CAMROT.on = false → 锁定（默认）：手势不响应旋转 ✓
       CAMROT.on = true  → 可转：右半屏单指 / 双指任意位置 拖动 → 转视角 ✓
   ★ 角度存在 localStorage（core 不碰浏览器 ✓）
   ============================================================ */
var CAMROT = { on: false, dragId: null, lx: 0, ly: 0, moved: false,
               pressT: 0, timer: null, saved: 0, saveT: null, loaded: false };
var CAM_STORE = 'camView_v1';
var CAM_LAND_ON = null;
var WH_OPEN = false;
var WH_NEAR = false;
var CAM_VIEW_START, CAM_PITCH_START;
var CAM_VIEW_STORE = 'camViewMode_v1';
var CAM_LAND_STORE = 'camOrient_v1';

function camEl() { return document.getElementById('cam'); }

function camApplyVisual() {
  var el = camEl();
  if (el) {
    if (CAMROT.on) { el.classList.add('on'); } else { el.classList.remove('on'); }
    el.title = CAMROT.on ? '视角：可转（点一下锁定 · 长按回正）'
                         : '视角：已锁定（点一下解锁）';
  }
  camToolsSync();
}

function camLandApply(on) {
  var target = on ? 'landscape' : 'portrait';
  function finish(ok, why) {
    if (ok) {
      CAM_LAND_ON = !!on;
      try { localStorage.setItem(CAM_LAND_STORE, on ? '1' : '0'); } catch (eSaveL) { }
      try { document.body.classList.toggle('landscape', !!on); } catch (e0) { }
      setTimeout(function () { uiApplyAllSaved(); uiApplyAtkScale(); uiClampPositions(); }, 50);
      try { camToolsSync(); } catch (e1) { }
      try { toast(on ? '已切换为横屏' : '已切换为竖屏'); } catch (e2) { }
    } else {
      /* 系统不允许实际转屏时，明确退化为布局切换，保证按钮/界面跟着用户选择走 */
      CAM_LAND_ON = !!on;
      try { localStorage.setItem(CAM_LAND_STORE, on ? '1' : '0'); } catch (eSaveL2) { }
      try { document.body.classList.toggle('landscape', !!on); } catch (e3) { }
      setTimeout(function () { uiApplyAllSaved(); uiApplyAtkScale(); uiClampPositions(); }, 50);
      try { camToolsSync(); } catch (e4) { }
      try {
        var t = on ? '横屏' : '竖屏';
        toast('设备不支持实际转屏，已切换为' + t + '布局（原因：' + (why || '系统拒绝了方向锁') + '）');
      } catch (e5) { }
    }
  }
  function lockNow() {
    try {
      var nativeShell = window.AndroidShell;
      if (nativeShell && nativeShell.setOrientation) {
        nativeShell.setOrientation(on ? 'landscape' : 'portrait');
        finish(true);
        /* ★★★ 2026-10-23（用户："我手机无法横屏，从 APK 层面解决"）★★★
           ★ 系统那边已经开始转了 ✗ 但转完是异步的 ✓
           ★ finish(true) 已经切了 CSS 类 ✗ 但这时视口还是旧尺寸
             → 按钮位置会按旧尺寸算 ✗ 旋转完成后就对不上了 ✓
           → 这里等 400ms（旋转动画通常 300ms 内）再【按真实尺寸重算一次】✓
           ★ 这次重算的是【布局坐标】✗ 不是方向 ✗ 所以画面不会跳 ✓ */
        setTimeout(function () {
          try { camLandApply(on); } catch (eRL) { }
        }, 420);
        setTimeout(function () {
          try { camLandApply(on); } catch (eRL2) { }
        }, 900);
        return;
      }
    } catch (eNative) { }
    if (!window.isSecureContext) { finish(false, '需要 HTTPS 或 localhost'); return; }
    var so = (typeof screen !== 'undefined') ? screen.orientation : null;
    if (!so || !so.lock) { finish(false, '此浏览器没有方向锁 API'); return; }
    var cur = String(so.type || '');
    if (on && (cur.indexOf('landscape') >= 0)) { finish(true); return; }
    if (!on && (cur.indexOf('portrait') >= 0)) { finish(true); return; }
    var list = on ? ['landscape', 'landscape-primary'] : ['portrait-primary', 'portrait'];
    var retried = false;
    function failOrRetry(why) {
      if (!retried) {
        retried = true;
        try { if (so.unlock) { so.unlock(); } } catch (eU) { }
        setTimeout(function () { attempt(0); }, 100);
      } else {
        finish(false, why || '系统拒绝了方向锁');
      }
    }
    function attempt(i) {
      if (i >= list.length) { failOrRetry('系统拒绝了方向锁'); return; }
      try {
        var pr = so.lock(list[i]);
        if (pr && pr.then) {
          pr.then(function () { finish(true); }).catch(function () { attempt(i + 1); });
        } else {
          finish(true);
        }
      } catch (eL) { attempt(i + 1); }
    }
    attempt(0);
  }
  try {
    if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(lockNow).catch(lockNow);
    } else {
      lockNow();
    }
  } catch (eF) {
    lockNow();
  }
}

/* ★★★ 2026-10-23（用户："显卡上下文创建不出来，玩家反复反馈"）★★★
   ABK 的 AndroidShell 提供了一个"真的能修好"的重启：
     销毁整个 WebView → 新渲染进程 → GL 上下文重新分配 ✓
   （JS 里 location.reload 治不了这个病 ✗ 同一个渲染进程里永远拿不到新上下文 ✓）
   ★ core 不许碰 window ✗ 所以在这里包成 UI.* 给它用 ✓ */
UI.canNativeRestart = function () {
  try {
    return !!(window.AndroidShell && typeof window.AndroidShell.hardRestart === 'function');
  } catch (e) { return false; }
};
UI.nativeRestart = function () {
  try {
    if (window.AndroidShell && typeof window.AndroidShell.hardRestart === 'function') {
      window.AndroidShell.hardRestart();
      return true;
    }
  } catch (e) { }
  return false;
};

function camRequestLandscape() {
  var isLand = (CAM_LAND_ON === true) ||
    ((CAM_LAND_ON !== false) && window.innerWidth > window.innerHeight + 40);
  camLandApply(!isLand);
}

/* ★★★ 2026-10-23（用户："我手机无法横屏，从 APK 层面解决"）★★★
   ★ APK 的 AndroidShell.setOrientation 已经把【系统】转过去了 ✓
     但系统旋转是【异步】的 ✗ 转完视口才变 ✓
     → 这里监听视口变化，等系统转完再把 CSS 布局切过去 ✓
     → 这样"界面横屏"和"系统横屏"才真正一致 ✓

   ★ 为什么不用 screen.orientation.onchange：
     部分 WebView 版本不触发 ✗ 而 resize 一定会触发 ✓
   ★ 为什么要延迟 2 帧：旋转刚结束视口尺寸可能还在跳 ✓
     等两帧拿到的是最终尺寸 ✓ 否则会算错按钮位置 ✓
*/
(function watchOrientationForShell() {
  var _lastLand = null;
  function applyBodyClass() {
    try {
      var land = window.innerWidth > window.innerHeight + 40;
      if (land === _lastLand) { return; }
      _lastLand = land;
      /* ★ 2026-10-23：系统和 CSS 必须【一起】变 ✗ 只改一个就会错位 ✓
         这里同时更新 CAM_LAND_ON（其它地方读它判断当前朝向 ✓）*/
      try { CAM_LAND_ON = land; } catch (eC) { }
      try { localStorage.setItem(CAM_LAND_STORE, land ? '1' : '0'); } catch (eS) { }
      document.body.classList.toggle('landscape', land);
      setTimeout(function () {
        try { uiApplyAllSaved(); } catch (e1) { }
        try { uiApplyAtkScale(); } catch (e2) { }
        try { uiClampPositions(); } catch (e3) { }
        try { camToolsSync(); } catch (e4) { }
      }, 80);
    } catch (e) { }
  }
  /* ★ 旋转后视口可能多次跳变 ✗ 延迟 2 帧 + 320ms 各算一次 ✓ 以最终尺寸为准 ✓ */
  var _t2 = null;
  function schedule() {
    requestAnimationFrame(function () {
      requestAnimationFrame(applyBodyClass);
    });
    if (_t2) { clearTimeout(_t2); }
    _t2 = setTimeout(applyBodyClass, 320);
  }
  try {
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    schedule();
  } catch (e0) { }
})();

function camSetViewMode(v) {
  try { CAM_VIEW = v; } catch (e0) { }
  try { localStorage.setItem(CAM_VIEW_STORE, v); } catch (eSave) { }
  if (v === 'third') {
    try { CAM_PITCH_T = 0.42; CAM_PITCH = 0.42; } catch (e1) { }
  } else if (v === 'first') {
    try { CAM_PITCH_T = 1.0; CAM_PITCH = 1.0; } catch (e1b) { }
  }
  try { if (typeof applyWorldZoom === 'function') { applyWorldZoom(); } } catch (e2) { }
  try { toast(v === 'first' ? '第一人称' : (v === 'third' ? '第三人称' : '自由视角')); } catch (e3) { }
  try { camToolsSync(); } catch (e4) { }
}
function camSettingsSync() {
  var map = [['setCamFirst','first'],['setCamThird','third'],['setCamFree','free']];
  var cur = (typeof CAM_VIEW !== 'undefined') ? CAM_VIEW : 'third';
  for (var i = 0; i < map.length; i++) {
    var el = document.getElementById(map[i][0]);
    if (el) { el.className = 'bagB' + (cur === map[i][1] ? ' on' : ''); }
  }
  var land = document.getElementById('setCamLand'), port = document.getElementById('setCamPortrait');
  var isLand = (CAM_LAND_ON === true) || ((CAM_LAND_ON !== false) && window.innerWidth > window.innerHeight + 40);
  if (land) { land.className = 'bagB' + (isLand ? ' on' : ''); }
  if (port) { port.className = 'bagB' + (!isLand ? ' on' : ''); }
}
function camSettingsBind() {
  var f = document.getElementById('setCamFirst'), t = document.getElementById('setCamThird'), r = document.getElementById('setCamFree');
  if (f && !f._b) { f._b = true; f.addEventListener('click', function () { camSetViewMode('first'); camSettingsSync(); }); }
  if (t && !t._b) { t._b = true; t.addEventListener('click', function () { camSetViewMode('third'); camSettingsSync(); }); }
  if (r && !r._b) { r._b = true; r.addEventListener('click', function () { camSetViewMode('free'); camSettingsSync(); }); }
  var l = document.getElementById('setCamLand'), p = document.getElementById('setCamPortrait');
  if (l && !l._b) { l._b = true; l.addEventListener('click', function () { camLandApply(true); camSettingsSync(); }); }
  if (p && !p._b) { p._b = true; p.addEventListener('click', function () { camLandApply(false); camSettingsSync(); }); }
  camSettingsSync();
}
function camToolsSync() {
  var box = document.getElementById('camTools');
  if (box) { box.style.display = CAMROT.on ? 'block' : 'none'; }
  var z = document.getElementById('camZoom');
  var zv = document.getElementById('camZoomVal');
  if (z) {
    var v = (typeof setWorldZoom === 'function') ? setWorldZoom() : 100;
    if (!z._b) {
      z._b = true;
      z.addEventListener('input', function () {
        /* ★ 2026-10-22（用户要求）：第一人称也能调画面大小（以前只允许自由视角） */
        if (CAM_VIEW !== 'free' && CAM_VIEW !== 'first') {
          try { toast('自由 / 第一视角才能缩放画面'); } catch (eZZ) { }
          z.value = String((typeof setWorldZoom === 'function') ? setWorldZoom() : 100);
          return;
        }
        var nv = Math.max(30, Math.min(500, parseInt(z.value, 10) || 100));
        try {
          SETCFG.zoom = nv;
          if (typeof saveSet === 'function') { saveSet(); }
          if (typeof applyWorldZoom === 'function') { applyWorldZoom(); }
          var zr = document.getElementById('zoomRange');
          if (zr) { zr.value = String(nv); }
          var zrv = document.getElementById('zoomVal');
          if (zrv) { zrv.textContent = nv + '%'; }
        } catch (eZ) { }
        if (zv) { zv.textContent = nv + '%'; }
      });
    }
    z.value = String(v);
    if (zv) { zv.textContent = v + '%'; }
  }
  var fp = document.getElementById('camFirst'), tp = document.getElementById('camThird');
  var fr = document.getElementById('camFree');
  function camSetMode(v) {
    try { CAM_VIEW = v; } catch (e0) { }
    try { localStorage.setItem(CAM_VIEW_STORE, v); } catch (eSave0) { }
    if (v === 'third') {
      try { CAM_PITCH_T = 0.42; CAM_PITCH = 0.42; } catch (e1) { }
    }
    else if (v === 'first') {
      try { CAM_PITCH_T = 1.0; CAM_PITCH = 1.0; } catch (e1b) { }
    }
    try { if (typeof applyWorldZoom === 'function') { applyWorldZoom(); } } catch (e2) { }
    try { toast(v === 'first' ? '第一人称' : (v === 'third' ? '第三人称' : '自由视角')); } catch (e3) { }
    camToolsSync();
  }
  if (fp && !fp._b) {
    fp._b = true;
    fp.addEventListener('click', function () { camSetMode('first'); });
  }
  if (tp && !tp._b) {
    tp._b = true;
    tp.addEventListener('click', function () { camSetMode('third'); });
  }
  if (fr && !fr._b) {
    fr._b = true;
    fr.addEventListener('click', function () { camSetMode('free'); });
  }
  var view = (typeof CAM_VIEW !== 'undefined') ? CAM_VIEW : 'third';
  if (fp) {
    var _on = view === 'first';
    fp.style.background = _on ? '#ffd83d33' : '#ffffff10';
    fp.style.color = _on ? '#ffd83d' : '#dfe8f2';
  }
  if (tp) {
    var _on2 = view === 'third';
    tp.style.background = _on2 ? '#ffd83d33' : '#ffffff10';
    tp.style.color = _on2 ? '#ffd83d' : '#dfe8f2';
  }
  if (fr) {
    var _on3 = view === 'free';
    fr.style.background = _on3 ? '#ffd83d33' : '#ffffff10';
    fr.style.color = _on3 ? '#ffd83d' : '#dfe8f2';
  }
  if (z) {
    var _free = (view === 'free');
    z.disabled = false;
    z.style.opacity = _free ? '1' : '0.55';
    z.title = _free ? '' : '自由视角才能缩放画面';
  }
  if (zv) {
    zv.style.opacity = (view === 'free') ? '1' : '0.42';
  }
  var land = document.getElementById('camLand');
  if (land && !land._b) {
    land._b = true;
    land.addEventListener('click', camRequestLandscape);
  }
  if (land) {
    var _land = false;
    try { _land = (CAM_LAND_ON === true) || ((CAM_LAND_ON !== false) && !!(window.matchMedia && window.matchMedia('(orientation: landscape)').matches)); } catch (eL) { }
    land.textContent = _land ? '竖屏' : '横屏';
    land.style.background = _land ? '#ffd83d33' : '#ffffff10';
    land.style.color = _land ? '#ffd83d' : '#dfe8f2';
  }
  try { if (typeof camSettingsSync === 'function') { camSettingsSync(); } } catch (eS) { }
  if (!window._camOriBind) {
    window._camOriBind = true;
    try {
      window.addEventListener('orientationchange', function () { try { camToolsSync(); } catch (e0) { } });
      window.addEventListener('resize', function () { try { camToolsSync(); } catch (e1) { } });
    } catch (e2) { }
  }
}

function uiApplyAtkScale() {
  try {
    var base = (typeof setAtkSize === 'function') ? (+setAtkSize() || 84) : 84;
    var land = document.body.classList.contains('landscape');
    var v = land ? base : Math.min(base, Math.max(58, window.innerWidth * 0.20), Math.max(58, window.innerHeight * 0.14));
    document.documentElement.style.setProperty('--atk', Math.round(v) + 'px');
  } catch (e) { }
}

function uiClampPositions() {
  try {
    var ids = ['atk', 'jmp', 'auto', 'cam', 'uiEdit', 'setBtn', 'skBar'];
    var W = window.innerWidth, H = window.innerHeight;
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (!el) { continue; }
      var r = el.getBoundingClientRect();
      if (!r || r.width <= 0 || r.height <= 0) { continue; }
      var l = Math.max(6, Math.min(Math.max(6, W - r.width - 6), r.left));
      var t = Math.max(6, Math.min(Math.max(6, H - r.height - 6), r.top));
      if (Math.abs(l - r.left) > 0.6 || Math.abs(t - r.top) > 0.6) {
        el.style.left = l.toFixed(1) + 'px';
        el.style.top = t.toFixed(1) + 'px';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
      }
    }
  } catch (e) { }
}

function camPrefsLoad() {
  try {
    var v = localStorage.getItem(CAM_VIEW_STORE);
    if (v !== 'first' && v !== 'third' && v !== 'free') { v = 'free'; }
    /* platform 比 core 先执行：先写 START，core 声明 CAM_VIEW 时再取，避免被 core 默认值覆盖 */
    CAM_VIEW_START = v;
    try { CAM_VIEW = v; } catch (eVC) { }
    var l = localStorage.getItem(CAM_LAND_STORE);
    CAM_LAND_ON = (l === '1') ? true : ((l === '0') ? false : null);
    if (v === 'first') { CAM_PITCH_START = 1.0; CAM_PITCH_T = 1.0; CAM_PITCH = 1.0; }
    else if (v === 'third') { CAM_PITCH_START = 0.42; CAM_PITCH_T = 0.42; CAM_PITCH = 0.42; }
    else { CAM_PITCH_START = 1.02; CAM_PITCH_T = 1.02; CAM_PITCH = 1.02; }
    try {
      if (window.AndroidShell && window.AndroidShell.setOrientation && CAM_LAND_ON !== null) {
        window.AndroidShell.setOrientation(CAM_LAND_ON ? 'landscape' : 'portrait');
      }
    } catch (eN) { }
  } catch (e) { }
}
camPrefsLoad();
(function uiOrientationBind() {
  function apply() {
    try {
      var land = (CAM_LAND_ON === true) ? true : ((CAM_LAND_ON === false) ? false : (window.innerWidth > window.innerHeight + 40));
      if (land) { document.body.classList.add('landscape'); }
      else { document.body.classList.remove('landscape'); }
      setTimeout(function () { uiApplyAllSaved(); uiApplyAtkScale(); uiClampPositions(); }, 40);
    } catch (e) { }
  }
  apply();
  try {
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', function () { setTimeout(apply, 120); });
    if (window.visualViewport) { window.visualViewport.addEventListener('resize', apply); }
  } catch (e2) { }
})();

function camToggle() {
  CAMROT.on = !CAMROT.on;
  camApplyVisual();
  try {
    toast(CAMROT.on ? '视角面板已展开' : '视角面板已收起：仍可拖动转视角');
  } catch (e) { }
}

/* 长按 1 秒 → 回默认视角（并锁回锁定态 ✓）*/
function camResetNow() {
  try { if (typeof camReset === 'function') { camReset(); } } catch (e) { }
  try { CAM_VIEW = 'free'; localStorage.setItem(CAM_VIEW_STORE, 'free'); } catch (e1) { }
  CAMROT.on = false;
  camApplyVisual();
  var el = camEl();
  if (el) {
    el.classList.add('reset');
    setTimeout(function () { el.classList.remove('reset'); }, 900);
  }
  camSaveNow();
  try { toast('视角已恢复默认'); } catch (e2) { }
}

function camBind() {
  var el = camEl();
  if (!el || el._camBound) { return; }
  el._camBound = true;

  el.addEventListener('pointerdown', function (e) {
    if (e && e.preventDefault) { e.preventDefault(); }
    if (typeof UI_EDIT !== 'undefined' && UI_EDIT) { return; }  /* 键位模式：只拖不带功能 ✓ */
    CAMROT.pressT = Date.now();
    CAMROT.moved = false;
    if (CAMROT.timer) { clearTimeout(CAMROT.timer); }
    /* ★ 长按 1 秒 = 回正（用户要求）✗ 短按 = 开/关 ✓ */
    CAMROT.timer = setTimeout(function () {
      CAMROT.timer = null;
      CAMROT.moved = true;          /* 标记成"已消费"→ 抬手不再触发开关 ✓ */
      camResetNow();
    }, 1000);
  });
  function up() {
    if (CAMROT.timer) { clearTimeout(CAMROT.timer); CAMROT.timer = null; }
    if (el._dragged) { el._dragged = false; return; }   /* 刚拖过 → 不算点击 ✓ */
    if (CAMROT.moved) { CAMROT.moved = false; return; } /* 长按已经处理过 ✓ */
    camToggle();
  }
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', function () {
    if (CAMROT.timer) { clearTimeout(CAMROT.timer); CAMROT.timer = null; }
    CAMROT.moved = false;
  });
  camApplyVisual();
}

/* ---------------- 手势：右半屏单指 / 双指任意位置 ----------------
   ★ 左半屏是摇杆（走路）✗ 绝对不能抢 ✓
   ★ 双指时不管在哪都算旋转 ✓（很多人的习惯）*/
function camGestureBind() {
  var cv = document.getElementById('cv') || document.querySelector('canvas');
  if (!cv || cv._camGest) { return; }
  cv._camGest = true;

  function findTouch(list, id) {
    for (var i = 0; i < (list || []).length; i++) {
      if (list[i].identifier === id) { return list[i]; }
    }
    return null;
  }
  function startRotate(t) {
    CAMROT.dragId = t.identifier;
    CAMROT.lx = t.clientX; CAMROT.ly = t.clientY;
  }
  cv.addEventListener('touchstart', function (e) {
    var ts = e.touches || [];
    if (CAMROT.dragId !== null) { return; }
    if (ts.length >= 2) { startRotate(ts[1]); return; }      /* 双指 → 用第二根 ✓ */
    var t0 = ts[0];
    if (t0 && t0.clientX >= window.innerWidth * 0.5) { startRotate(t0); }
  }, { passive: true });

  cv.addEventListener('touchmove', function (e) {
    if (CAMROT.dragId === null) { return; }
    var t = findTouch(e.touches, CAMROT.dragId);
    if (!t) { return; }
    var dx = t.clientX - CAMROT.lx, dy = t.clientY - CAMROT.ly;
    CAMROT.lx = t.clientX; CAMROT.ly = t.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 0.5) { CAMROT.moved = true; }
    try { if (typeof camAdd === 'function') { camAdd(dx, dy); } } catch (e2) { }
    camSaveSoon();
  }, { passive: true });

  function endTouch(e) {
    if (CAMROT.dragId === null) { return; }
    var ts = e.touches || [];
    if (!findTouch(ts, CAMROT.dragId)) {
      CAMROT.dragId = null;
      /* ★ round500：松手立刻存一次 ✗ 别等防抖（用户可能马上刷新/切后台 ✓）*/
      camSaveNow();
    }
  }
  cv.addEventListener('touchend', endTouch, { passive: true });
  cv.addEventListener('touchcancel', function () { CAMROT.dragId = null; }, { passive: true });

  /* 电脑端：右键拖 / 按住 Shift 拖 也能转（顺手 ✓ 不然没法测）*/
  cv.addEventListener('mousedown', function (e) {
    /* 右键随时可转；左键只在面板展开时转，避免抢攻击 */
    if (!(e.button === 2 || (CAMROT.on && e.button === 0))) { return; }
    CAMROT.mouseDrag = true;
    CAMROT.lx = e.clientX; CAMROT.ly = e.clientY;
  });
  window.addEventListener('mousemove', function (e) {
    if (!CAMROT.mouseDrag) { return; }
    var dx = e.clientX - CAMROT.lx, dy = e.clientY - CAMROT.ly;
    CAMROT.lx = e.clientX; CAMROT.ly = e.clientY;
    try { if (typeof camAdd === 'function') { camAdd(dx, dy); } } catch (e2) { }
    camSaveSoon();
  });
  window.addEventListener('mouseup', function () {
    if (CAMROT.mouseDrag) { CAMROT.mouseDrag = false; camSaveNow(); }
  });
  camToolsSync();
}

/* ---------------- 存档 ---------------- */
function camSaveNow() {
  try {
    if (typeof camState !== 'function') { return; }
    var st = camState();
    localStorage.setItem(CAM_STORE, JSON.stringify({ y: st.yaw, p: st.pitch }));
  } catch (e) { }
}
function camSaveSoon() {
  /* ★★ round500（用户："这个锁定视角的数据有保存吗，重启游戏/服务器后会不会恢复默认"）
     ★ 原来那个"400ms 节流"有个洞：最后一下拖动如果落在节流窗口里就【永远没存】✗
       → 拖动结束后角度可能回到上次存的位置 ✓ 看起来像"没保存" ✓
     ★ 改成【防抖 + 尾随】：每次变化都重置 450ms 定时器 ✗ 停手 450ms 后必存一次 ✓
       拖动过程中也照存（不会丢）✓ 代价是把写 localStorage 的次数压到最低 ✓ */
  if (CAMROT.saveT) { clearTimeout(CAMROT.saveT); }
  CAMROT.saveT = setTimeout(function () {
    CAMROT.saveT = null;
    camSaveNow();
  }, 450);
}
/* 切后台 / 关页面：补存一次（有些手机直接杀进程，尾随定时器来不及跑）*/
(function camFlushBind() {
  if (window._camFlush) { return; }
  window._camFlush = true;
  function flush() { try { camSaveNow(); } catch (e) { } }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { flush(); }
  });
  window.addEventListener('pagehide', flush);
})();

function camLoadSaved() {
  /* ★★★ round499 真 bug（用户："拖动来回抖动，还拖不太动"）★★★
     病根：`uiDragInit()` 是【每 100ms 调一次】的（为了保证按钮一定挂上 ✓）
          而我在里面调了 camLoadSaved() ✗
       → 每 100ms 就把视角【读回上次存的角度】✗
       → 一边拖一边被拽回去 → 看起来就是"抖 + 拖不动" ✓✓ 一字不差
     ★ 修：读档只做一次 ✓（存档照样每 400ms 写 ✓）
     ★ 教训：往一个"幂等初始化"函数里加东西前，先确认它到底被调几次 ✗ */
  if (CAMROT.loaded) { return; }
  CAMROT.loaded = true;
  try {
    var raw = localStorage.getItem(CAM_STORE);
    if (!raw) { return; }
    var o = JSON.parse(raw);
    if (typeof camSet === 'function' && o && typeof o.y === 'number') {
      camSet(o.y, o.p);
    }
  } catch (e) { }
}

/* ============================================================ 界面刷新（round508）
   ★ 用户："信息界面那两个自动开关删了，换成【界面刷新】✗ 60 秒 CD ✗ 防止一直按"
   ★ 用途：界面卡住 / 热更新之后，不用重开 APP ✓
   ★ CD 存 localStorage ✗ 刷新之后依然记着 ✓（不然刷新完又能立刻点 = 没 CD ✓）
   ★ 为什么 60 秒：热更新传文件一般几十秒内传完 ✗ 60 秒刚好一个来回 ✓ */
var UI_RELOAD_CD = 60;
var UI_RELOAD_KEY = 'uiReloadAt';

function uiReloadLeft() {
  var last = 0;
  try { last = +(localStorage.getItem(UI_RELOAD_KEY) || 0) || 0; } catch (e) { }
  var left = UI_RELOAD_CD - Math.floor((Date.now() - last) / 1000);
  return left > 0 ? left : 0;
}

function uiReloadPaint() {
  var b = document.getElementById('uiReload');
  var tip = document.getElementById('uiReloadTip');
  if (!b) { return; }
  var left = uiReloadLeft();
  if (left > 0) {
    b.textContent = '刷新（' + left + 's）';
    b.style.opacity = '0.45';
    b.style.cursor = 'not-allowed';
    b.style.pointerEvents = 'none';
    if (tip) { tip.textContent = '刚刷过 · 还要等 ' + left + ' 秒才能再点'; }
  } else {
    b.textContent = '界面刷新';
    b.style.opacity = '1';
    b.style.cursor = 'pointer';
    b.style.pointerEvents = 'auto';
    if (tip) {
      tip.textContent = '界面卡住 / 热更新后用 · 点一下重新载入（60 秒只能点一次）';
    }
  }
}

function uiReloadBind() {
  var b = document.getElementById('uiReload');
  if (!b || b._rb) { return; }
  b._rb = true;
  b.addEventListener('click', function () {
    if (uiReloadLeft() > 0) { return; }
    try { localStorage.setItem(UI_RELOAD_KEY, String(Date.now())); } catch (e) { }
    try { toast('正在刷新界面…'); } catch (e2) { }
    /* ★ 给 toast 一帧时间画出来 ✗ 再刷 ✓ */
    setTimeout(function () {
      try { location.reload(); } catch (e3) { }
    }, 160);
  });
  uiReloadPaint();
  /* 冷却中每秒把秒数往下减 ✓（不用重建 DOM）*/
  setInterval(function () {
    var pane = document.querySelector('.tabpane[data-pane="about"]');
    if (!pane || pane.className.indexOf('on') < 0) { return; }
    uiReloadPaint();
  }, 1000);
}

function uiDragInit() {
  makeDraggable('atk');
  makeDraggable('jmp');
  makeDraggable('run');
  makeDraggable('auto');
  autoBind();
  /* ★ round497：视角按钮（同一个拖动系统 → 像攻击键一样能移动 ✓）*/
  makeDraggable('cam');
  camBind();
  uiReloadBind();
  setSubBind();
  camGestureBind();
  camLoadSaved();
}

/* ★ round353：自动战斗按钮绑定（点一下开/关 ✓ 拖动时不触发 ✓ 见 makeDraggable）*/
function autoBind() {
  var b = document.getElementById('auto');
  if (!b || b._bound) { return; }
  b._bound = true;
  b.addEventListener('pointerdown', function (e) {
    if (e && e.preventDefault) { e.preventDefault(); }
    if (b._dragged) { b._dragged = false; return; }   // ★ 刚拖过 → 不算点击 ✓
    if (UI_EDIT) { return; }                          // ★ 调整模式：不切换自动战斗 ✓
    autoToggle();
  });
}

function autoToggle() {
  if (typeof AUTO === 'undefined') { return; }
  /* ★★★ round371（用户："取消自动战斗后一直往一个方向跑"）★★★
     ★ 可能的原因：切换被触发【两次】→ 开了又关、关了又开 ✓
       来源：新按钮的 pointerdown + 旧的长按攻击键（两个入口 ✓）
     ★ 修：250 毫秒内只认一次切换 ✓ 人手不可能 4 次/秒地开关 ✓ */
  var _nowT = Date.now();
  if (_nowT - (autoToggle._last || 0) < 250) { return; }
  autoToggle._last = _nowT;
  AUTO.on = !AUTO.on;
  /* ★★ round442（用户："挂机的击杀数和时间，只有关闭了自动战斗才会清零"）★★
     → 关掉才清零 ✗ 打开时接着上次的继续 ✓ */
  try {
    if (AUTO.on) { autoStatRestore(); } else { autoStatReset(); }
  } catch (e0) { }
  /* ★ 关掉时把阶段和目标一起清掉 ✗ 免得下一帧 AI 还接着跑 ✓ */
  if (!AUTO.on) { AUTO.phase = 'find'; AUTO.tgt = ''; AUTO.detourT = 0; }
  AUTO.tgt = ''; AUTO.phase = 'find'; AUTO.t = 0; AUTO.kills = 0;
  AUTO.deaths = []; AUTO.pauseUntil = 0; AUTO.stuckT = 0;
  AUTO.info = AUTO.on ? '自动战斗：正在找目标…' : '';
  /* ★ round437：开始记时 + 开/关那个击杀数面板 ✓ */
  AUTO.t0 = performance.now();
  AUTO.statT = 0;
  try { autoStatShow(!!AUTO.on, 0, 0); } catch (e0) { }
  /* ★ 第 209 轮：关掉时立刻把摇杆还回去 ✗ 不然人会一直往前走 ✓ */
  try { if (typeof autoRelease === 'function') { autoRelease(); } } catch (e) { }
  try { if (typeof SETCFG !== 'undefined') { SETCFG.auto = AUTO.on; } saveSet(); } catch (e) { }
  autoUiUpd();
  toast(AUTO.on ? '自动战斗已开启' : '自动战斗已关闭');
}

/* 手动操作 → 暂停 3 秒（不是关掉 ✓ 方便临时接管 ✓）
   ★ 摇杆/键盘那两种在 core 里自己判 ✓ 这里只管点攻击键 ✓ */
function autoPauseManual() {
  if (typeof AUTO !== 'undefined' && AUTO.on) {
    AUTO.pauseUntil = performance.now() + 3000;
  }
}

function autoBindAtk() {
  var b = document.getElementById('atk');
  if (!b || b._autoB) { return; }
  b._autoB = true;
  /* ★★★ round379（用户："长按自动战斗的设定删了，现在有单独按钮"）★★★
     ★ 只保留"按下攻击键 = 手动操作 → 暂停自动战斗 3 秒"✓
       （那个是有用的：你手打的时候 AI 让位 ✓）
     ★ 长按 3 秒开自动战斗 → 删掉 ✓ 免得和按钮重复/互相打架 ✓ */
  var down = function () {
    autoPauseManual();
  };
  var up = function () {
    if (_autoHold) { clearTimeout(_autoHold); _autoHold = null; }
    autoPauseManual();
  };
  b.addEventListener('pointerdown', down);
  b.addEventListener('pointerup', up);
  b.addEventListener('pointercancel', up);
  b.addEventListener('pointerleave', up);
}

/* ---------- 跳跃键（第 306 轮 ✗ 地形方案 §3.4）----------
   ★ 为什么用 pointerdown 而不是 click：
     跳跃要"按下就跳"✗ 不能等抬手 ✓ 手游手感全靠这个 ✓
   ★ 为什么按一下就清 jumpHeld：
     只能跳 1 格 ✗ 按住不放不该一直跳 ✓
     （想连续跳就连续点 ✗ 和"跳"这个动作的直觉一致 ✓）
   ★ 桌面端也可以用空格（见 KEY 绑定 ✓）*/
function jumpBind() {
  var b = document.getElementById('jmp');
  if (!b || b._jmpB) { return; }
  b._jmpB = true;
  /* ★★★ round326（用户："点按键跳僵尸会停顿，空格跳没事，手机不卡"）★★★
     ★ 原来是 classList.add('on') + setTimeout(remove) ✗
       一次点击 = 两次 DOM 变更 + 两次 backdrop-filter 重算 ✓
       而这一帧正在画 3D ✗ 撞一起就掉帧 ✓ 僵尸的插值就"冻"一下 ✓
     ★ 现在完全不碰 DOM ✗ 按下效果交给 CSS 的 :active ✓ */
  var press = function (e) {
    if (e && e.preventDefault) { e.preventDefault(); }
    if (UI_EDIT) { return; }                          // ★ 调整模式：不跳 ✓
    if (typeof jumpHeld !== 'undefined') { jumpHeld = 1; }
  };
  b.addEventListener('pointerdown', press);
  b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
}
/* ★ 2026-10-22：跑步按钮（点一下持续跑，再点停下；每秒 1 点灵气） */
function runUiState() {
  var b = document.getElementById('run');
  if (!b) { return; }
  if (RUN && RUN.on) { b.classList.add('on'); }
  else { b.classList.remove('on'); }
}
function runToggle() {
  if (typeof UI_EDIT !== 'undefined' && UI_EDIT) { return; }
  var want = !(RUN && RUN.want);
  RUN.want = want;
  try { wsSend('run', { on: want ? 1 : 0 }); } catch (e) { }
}
function runBind() {
  var b = document.getElementById('run');
  if (!b || b._runB) { return; }
  b._runB = true;
  b.addEventListener('pointerdown', function (e) {
    if (e && e.preventDefault) { e.preventDefault(); }
    runToggle();
  });
  b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  runUiState();
}
function runApply(d) {
  if (!d) { return; }
  RUN.on = !!d.on;
  if (!RUN.on) { RUN.want = false; }
  runUiState();
  if (d.reason === 'no_qi') { try { toast('灵气不足，跑不动'); } catch (e) { } }
}

function jumpCoolUi(p) {
  var b = document.getElementById('jmp');
  if (!b) { return; }
  if (p > 0) { b.classList.add('cool'); } else { b.classList.remove('cool'); }
}

function tpDo(e) {
  if (e && e.preventDefault) { e.preventDefault(); }
  var btn = document.getElementById('safeTp');
  if (btn && btn.classList.contains('casting')) { return; }   /* 正在读条，忽略 ✓ */
  /* 点了先关菜单（用户要求 ✓）*/
  try { if (typeof closeSet === 'function') { closeSet(); } } catch (e2) { }
  /* ★ 乐观反馈：先本地走秒 ✗ 服务器回了 tpcast 就以服务器为准 ✓
     这样网络慢也不会像"没反应"✓ 服务器不同意时会给 notice 说明原因 ✓ */
  TPCAST.left = 6.0;
  TPCAST.at = performance.now() / 1000;
  tpBarRender();
  wsSend('safetp', {});                                /* 真正的请求 ✓ 服务器说了算 ✓ */
}

/* ★ 两条路一起挂（用户报过"点了没反应"✗ 一条路出问题还有另一条 ✓）
   ① 事件委托（挂在 document 上 ✓ 不怕元素重建 ✓）
   ② 直接挂 onclick（在 tpEnsureBtn 里每 100ms 检查一次 ✓ 挂上为止 ✓）*/
/* ★ 2026-10-22（用户："传送菜单只能选择传送点后才能关闭，不能点 X"）：
   这里原来也叫 tpBind —— 和上面【传送面板】的 tpBind 同名。
   JS 里后定义的覆盖先定义的 → 面板右上角 X 的 click 永远绑不上。
   改名 safeTpBind（只管安全区那个传送按钮）。 */
function safeTpBind() {
  if (window._tpBound) { return; }
  window._tpBound = true;
  document.addEventListener('click', function (e) {
    var el = e.target, hit = null;
    while (el && el !== document) {
      if (el.id === 'safeTp') { hit = el; break; }
      el = el.parentNode;
    }
    if (hit) { tpDo(e); }
  });
}

/* 每 100ms 检查一次：按钮在不在、onclick 挂上没有 ✓ 挂上就什么都不做 ✓ */
function tpEnsureBtn() {
  var btn = document.getElementById('safeTp');
  if (btn && btn.onclick !== tpDo) { btn.onclick = tpDo; }
}

/* ★★★ round467：装备页的「属性详情」✗
   数值全部用现成的客户端工具函数算（wStatsOf / wRealHit / wInterval / wMastery）✓
   ★ 不重写公式 ✗ 和背包里看到的完全一致 ✓ */
/* ★ round468：词条块（一条一行 ✗ 没词条时只写一句）*/
function affixBlock(title, list) {
  if (!list || !list.length) {
    return stRow(title, '无', '');
  }
  /* ★★ round468b：外层 .bagStat 是 display:flex;flex-wrap:wrap ✗
     所以我直接放进去的每个 div 都变成了【flex 项】✗
     → 三条词条被排成一行 ✗✗（截图里就是挤在一起）
     修：整块包一个 flex:0 0 100% 的容器 ✗ 里面才老老实实换行 ✓ */
  var h = '<div style="flex:0 0 100%;width:100%;display:block;padding:2px 0">' +
    '<div class="ptLine" style="justify-content:space-between;padding:2px 0">' +
    '<span style="color:#cfd8e4">' + title + '</span>' +
    '<span class="bagTip">' + list.length + ' 条</span></div>';
  for (var i = 0; i < list.length; i++) {
    h += '<div style="display:block;color:#8ee0ff;font-size:13px;padding:2px 0 2px 8px">• ' +
      (list[i].text || list[i].name || '') + '</div>';
  }
  h += '</div>';
  return h;
}

function equipRender() {
  var box = document.getElementById('eqDetail');
  if (!box) { return; }
  var h = '';
  /* ★ round472b：下面防具段用到 lv ✗ 之前没声明 → ReferenceError ✗（已修）*/
  var lv = (WSC.role && WSC.role.level) || 1;
  var w = (typeof MY_WEAPON !== 'undefined') ? MY_WEAPON : null;
  if (w && w.slot === 'weapon') {
    var ws = wStatsOf(w);
    var wm = wMastery(w);
    h += '<div style="color:' + tierHex(w.tier || 0) + ';font-weight:700;margin-bottom:4px">' +
      '武器 · ' + (w.name || '?') + '（' + ((w.tier || 0) + 1) + ' 阶）' +
      (w.broken ? '<span style="color:#ff5a4a"> · 已损坏</span>' : '') + '</div>' +
      stRow('发挥度', Math.round(wm * 100) + '%',
            wm < 1 ? ('建议 ' + (w.reqLevel || 1) + ' 级') : '已满') +
      /* ★ round470：基础属性单独列出来（和防具一个口径 ✓）*/
      stRow('基础伤害', Math.round(wFlat(w)) + ' 点', '随品阶和物品等级长') +
      stRow('武器系数', '×' + (+((w.base || {}).coeff) || 1.0).toFixed(2),
            '乘在你的固有攻击上') +
      stRow('实际每击', Math.round(wRealHit(w)), '含发挥度和封顶') +
      stRow('每秒伤害', Math.round(wRealDps(w)), '含暴击期望') +
      stRow('攻速', '×' + ws.spd.toFixed(2) + '（' + wInterval(w).toFixed(2) + ' 秒一刀）',
            '基础 ×' + ws.spdBase.toFixed(2) +
            (ws.spdPct ? (' + 词条 ' + ws.spdPct.toFixed(1) + '%') : '') +
            ' · 上限 ×' + W_SPD_MAX) +
      stRow('每秒攻击', (1 / wInterval(w)).toFixed(2) + ' 刀/秒',
            '×' + ws.spd.toFixed(2) + ' = 0.62 ÷ ' + ws.spd.toFixed(2) + ' 秒一刀') +
      stRow('范围', ws.reach.toFixed(1) + ' 米 · ' + rangeWord(ws.reach), arcWord(ws.arc)) +
      /* ★★ round468（用户："词条每一条要换行显示，更清楚"）★★ */
      affixBlock('武器词条', w.affixes) +
      ((+w.durMax > 0)
        ? stRow('耐久', ((typeof w.dur === 'number') ? w.dur : w.durMax) + ' / ' + w.durMax,
                '还能挥这么多次')
        : '');
  } else {
    h += '<div class="bagTip">空手（在背包里点武器 → 使用）</div>';
  }
  h += '<div style="height:10px"></div>';

  var ar = (typeof BAG !== 'undefined') ? BAG.armor : null;
  if (ar && ar.base) {
    var b = ar.base || {};
    /* round468：防具词条也一条一行（affixBlock）*/
    h += '<div style="color:' + tierHex(ar.tier || 0) + ';font-weight:700;margin-bottom:4px">' +
      '防具 · ' + (ar.name || '?') + '（' + ((ar.tier || 0) + 1) + ' 阶）' +
      (ar.broken ? '<span style="color:#ff5a4a"> · 已损坏</span>' : '') + '</div>' +
      stRow('发挥度', Math.round(aStatsOf(ar).mastery * 100) + '%',
            aStatsOf(ar).mastery < 0.999
              ? ('装备 ' + (+ar.itemLv || 1) + ' 级，你现在 ' + lv + ' 级')
              : '已满') +
      stRow('减伤（固定）', (Math.round(aStatsOf(ar).dr * 10) / 10) + ' 点',
            '挨打时先扣这么多' +
            (aStatsOf(ar).mastery < 0.999 ? ('（满发挥 ' + Math.round(aStatsOf(ar).drFull) + '）') : '')) +
      stRow('生命上限', '+' + Math.round(aStatsOf(ar).hp),
            aStatsOf(ar).mastery < 0.999 ? ('满发挥 +' + Math.round(aStatsOf(ar).hpFull)) : '') +
      affixBlock('防具词条', ar.affixes) +
      ((+ar.durMax > 0)
        ? stRow('耐久', ((typeof ar.dur === 'number') ? ar.dur : ar.durMax) + ' / ' + ar.durMax,
                '还能挨这么多次')
        : '');
  } else {
    h += '<div class="bagTip">没穿防具（在背包里点防具 → 使用）</div>';
  }
  box.innerHTML = h;
}

function bagRender() {
  var grid = document.getElementById('bagGrid');
  var eqs = document.getElementById('bagEqSlot');
  var st = document.getElementById('bagStat');
  var mg = document.getElementById('bagMsg');
  var cnt = document.getElementById('bagCount');
  if (!grid || !eqs || !st) { return; }

  /* ---- 背包格子（6 列 ✓ 每页 30 格 ✓ 空位也画出来 → 才像格子而不是列表 ✓）---- */
  bagPagerUpd();
  bagPageBind();
  var html = '';
  var _from = BAG_PAGE * BAG_PAGE_SIZE;
  var _to = Math.min((BAG.items || []).length, _from + BAG_PAGE_SIZE);
  for (var i = _from; i < _to; i++) {
    var e = BAG.items[i];
    var it = e.item || {};
    /* ★★ 第 97 轮修的 bug：这里原来只认 weapon ✗
       → 防具被当成【材料】渲染（数量角标、材料图标分支…）✗✓✓
       → 改成"武器或防具都算装备"✓（变量名保留 isW 免得改一堆引用 ✗
         但它现在的含义是 isEquipment ✓）*/
    var isW = (it.slot === 'weapon' || it.slot === 'armor');
    var col = tierHex(it.tier || 0);
    // ★ 第 68 轮：防具也要能标"已装备"（不然穿上之后格子上没有绿点 ✗）
    var cur = ((BAG.weaponItemId && String(e.id) === String(BAG.weaponItemId)) ||
               (BAG.armorItemId && String(e.id) === String(BAG.armorItemId))) ? ' cur' : '';
    var sel = (BAG.sel && String(BAG.sel) === String(e.id)) ? ' sel' : '';
    /* round303: 批量勾选 —— 勾中的格子加 pick 类 ✗ 左上角一个方框 ✓ */
    var _pk = false;
    if (BAG.multi) {
      for (var _pc = 0; _pc < (BAG.pick || []).length; _pc++) {
        if (String(BAG.pick[_pc]) === String(e.id)) { _pk = true; break; }
      }
    }
    /* ★ 第 233 轮：损坏的装备要有明显样式（挂机回来一眼看得出来 ✓）*/
    var brk = !!it.broken;
    if (brk) { cur = ''; }   /* 坏了的显示损坏 ✗ 不显示已装备绿点 ✓ */
    /* ★ round410：锁住的物品右上角一把小锁 ✓ 一眼看得出为什么卖不掉 ✓ */
    var lkd = !!it.locked;
    var lowm = isW ? (wMastery(it) < 1) : false;      // 发挥不满 → 黄标（不是锁 ✓）
    var n = (e.stack || 1);
    var bg = 'background:linear-gradient(180deg,' + tierRgba(it.tier || 0, 0.40) + ','
             + tierRgba(it.tier || 0, 0.18) + ')';
    html += '<div class="slot' + cur + sel + (_pk ? ' pick' : '') + (lowm ? ' lowmastery' : '') +(brk ? ' broken' : '') + (lkd ? ' locked' : '') +  '" style="' + bg + '"' +
      ' data-id="' + e.id + '" data-w="' + (isW ? 1 : 0) + '" data-i="' + i + '"' +
      (lowm ? (' title="建议 ' + (it.reqLevel || 1) + ' 级（发挥 ' +
        Math.round(wMastery(it) * 100) + '%）"') : '') + '>' +
      (BAG.multi ? ('<span class="pickbox">' + (_pk ? '✓' : '') + '</span>') : '') +
      (lkd ? '<span class="lk">🔒</span>' : '') +
      '<span style="color:' + col + '">' + iconOfItem(it) + '</span>' +
      '<span class="tg">' + ((it.tier || 0) + 1) + '</span>' +      // ★ 显示 1~12 ✓
      (!isW && n > 1 ? '<span class="cnt">' + n + '</span>' : '') +
      // ★ 第 60 轮：武器有几条词条，右上角点一个小圆点数字（一眼分得出极品 ✓）
      /* ★ 第 92 轮（用户要求）：去掉右上角的词条角标 ✗
         词条条数只在【点开的弹窗/悬停】里看 ✓（那里写着“词条 N 条：…” ✓）*/
      /* ★ 第 91 轮（用户要求）：耐久直接显示在【格子下方】✓
         条 + 数字；点开详情（悬停/选中）里还有完整的"剩多少 / 共多少" ✓ */
      ((+it.durMax > 0) ? (function () {
        var _dd = (typeof it.dur === 'number') ? it.dur : it.durMax;
        var _k = Math.max(0, Math.min(1, _dd / it.durMax));
        var _col = (_k > 0.5) ? '#7ee08a' : (_k > 0.2 ? '#ffd83d' : '#ff7a6a');
        return '<span class="durbar"><i style="width:' + (_k * 100).toFixed(1) +
          '%;background:' + _col + '"></i></span>' +
          '';   // ★ 第 92 轮（用户要求）：数字不显示在条下面 ✗
                //   只在【点开的弹窗/悬停】里看完整的剩多少 ✓
      })() : '') +
      (lowm ? '<span class="lvl">' + Math.round(wMastery(it) * 100) + '%</span>' : '') + '</div>';
  }
  var total = Math.max(16, Math.min(BAG_PAGE_SIZE + 8, Math.ceil((BAG.items.length + 1) / 8) * 8));   /* round252: cap slots (was 800 empty divs at 797 items -> GPU pressure -> WebGL lost -> white screen) */
  /* 第 171 轮（用户 #4）：空位要按【每页 30 格】补。
     不能按背包总容量补 —— 不然第二页开头一个空位都没有，页面长短不一。 */
  var _filled = (_to - _from);
  for (var p = _filled; p < BAG_PAGE_SIZE; p++) { html += '<div class="slot empty"></div>'; }
  grid.innerHTML = html;
  if (cnt) { cnt.textContent = BAG.items.length ? (BAG.items.length + ' 件') : ''; }

  /* ---- 装备槽 ---- */
  var w = BAG.weapon;
  if (!w) {
    eqs.className = 'slot eqslot empty';
    eqs.innerHTML = '<span style="opacity:.35">' + weaponIconSvg('sword', 0) + '</span>';
    eqs.setAttribute('data-w', '0');
  } else {
    eqs.className = 'slot eqslot';
    eqs.innerHTML = '<span style="color:' + tierHex(w.tier || 0) + '">' + iconOfItem(w) + '</span>' +
      '<span class="tg">' + ((w.tier || 0) + 1) + '</span>' +       // ★ 显示 1~12 ✓
      // ★ 第 59 轮：耐久条（绿→黄→红 ✓ 一眼看得见还有多少寿命）
      (function () {
        var dm = +w.durMax || 0;
        if (!dm) { return ''; }
        var dd = (typeof w.dur === 'number') ? w.dur : dm;
        var k = Math.max(0, Math.min(1, dd / dm));
        var col = (k > 0.5) ? '#7ee08a' : (k > 0.2 ? '#ffd83d' : '#ff7a6a');
        return '<span class="durbar"><i style="width:' + (k * 100).toFixed(1) +
          '%;background:' + col + '"></i></span>';
      })();
    eqs.setAttribute('data-w', '1');
  }

  /* ★★ 第 68 轮：防具槽（用户："只有武器穿戴格子"✗）★★ */
  var ars = document.getElementById('bagEqArmor');
  if (ars) {
    var ar2 = BAG.armor;
    if (!ar2) {
      ars.className = 'slot eqslot eqarmor empty';
      ars.innerHTML = '<span style="opacity:.35">' + ARMOR_ICON + '</span>';
      ars.setAttribute('data-a', '0');
      ars.title = '没穿防具（点背包里的防具 → 使用）';
    } else {
      ars.className = 'slot eqslot eqarmor';
      ars.innerHTML = '<span style="color:' + tierHex(ar2.tier || 0) + '">' +
        iconOfItem(ar2) + '</span>' +
        '<span class="tg">' + ((ar2.tier || 0) + 1) + '</span>' +
        /* ★★ 第 234 轮（用户："防具下面穿搭后不要显示文字 ✗ 跟武器一样显示耐久度"）★★
           这里原来显示的是文字「减伤 N」✗ 而武器格子显示的是耐久条 ✓
           两个格子长得不一样 ✗ 用户要求统一成耐久条 ✓
           ★ 减伤那个信息不删 ✗ 挪到悬停提示里（鼠标放上去还能看到 ✓）
           ★ 数据用 BAG.armor 身上那份（实时 ✓ 和武器一个来源 ✓）*/
        ((+ar2.durMax > 0) ? (function () {
          var _dm = +ar2.durMax || 0;
          var _dd = (typeof ar2.dur === 'number') ? ar2.dur : _dm;
          var _k = Math.max(0, Math.min(1, _dd / _dm));
          var _col = (_k > 0.5) ? '#7ee08a' : (_k > 0.2 ? '#ffd83d' : '#ff7a6a');
          return '<span class="durbar"><i style="width:' + (_k * 100).toFixed(1) +
            '%;background:' + _col + '"></i></span>';
        })() : '');
      ars.setAttribute('data-a', '1');
      /* ★ 第 234 轮：提示语也要跟着改 ✗
         第 231 轮起"点已装备的格子"已经不再卸下了 ✓
         提示里还写着"点一下脱下"✗ 会误导 ✓ 改成指路【脱下】按钮 ✓ */
      ars.title = (ar2.name || '防具') + ' · 减伤 ' +
        Math.round((+((ar2.base || {}).dr) || 0)) +
        (ar2.broken ? ' · ★ 已损坏' : '') +
        ' —— 要脱下请点下面的【脱下】按钮';
    }
  }

  /* ★ 第 68 轮：防具槽的点击（脱下）+ 悬停（看属性 ✓）*/
  var arsEl = document.getElementById('bagEqArmor');
  if (arsEl) {
    arsEl.onclick = function (e) {
      if (e) { e.preventDefault(); }
      if (arsEl.getAttribute('data-a') !== '1') { return; }
      bagUnequipArmor();
    };
    arsEl.onmousemove = function (e) {
      var box2 = document.getElementById('bagTipBox');
      var a2 = BAG.armor;
      if (!box2 || !a2) { bagTipHide(); return; }
      box2.innerHTML = '<b style="color:' + tierHex(a2.tier || 0) + '">' + (a2.name || '?') +
        '</b><i> · ' + ((a2.tier || 0) + 1) + ' 阶 · 已装备</i>' +
        /* ★ 第 231 轮（用户要求）：防具穿上后也显示耐久 ✗ 不再只写"已装备"✓
           和武器一个口径 ✓ 耐久从身上那份取（穿在身上时 item_json 里是旧值 ✓）*/
        (a2.broken ? '<i style="color:#ff5a4a"> · 已损坏</i>' : '') +
        ((+a2.durMax > 0) ? ('<i style="color:#ffd83d"> · 耐久 ' +
          ((typeof a2.dur === 'number') ? a2.dur : a2.durMax) +
          ' / ' + a2.durMax + '</i>') : '') + wStatHtml(a2, true);
      bagTipAt(e, box2);
    };
    arsEl.onmouseleave = function () { bagTipHide(); };
  }

  /* ---- 数值：显示【当前选中】的那件（默认 = 已装备 ✓）---- */
  var selItem = null, selIsEquipped = false;
  for (var q = 0; q < BAG.items.length; q++) {
    if (BAG.sel && String(BAG.items[q].id) === String(BAG.sel)) {
      selItem = BAG.items[q].item;
      selIsEquipped = !!((BAG.weaponItemId &&
                          String(BAG.weaponItemId) === String(BAG.items[q].id)) ||
                         (BAG.armorItemId &&
                          String(BAG.armorItemId) === String(BAG.items[q].id)));
      break;
    }
  }
  if (!selItem) { selItem = shownWeapon(); selIsEquipped = !!w; }
  st.innerHTML = wStatHtml(selItem, !selItem);

  /* ---- 使用 / 脱下（用户要求：点武器出现"使用"，穿上后变"脱下"）---- */
  var useBtn = document.getElementById('bagUse');
  if (useBtn) {
    if (selItem && selItem.kind === 'skillbook') {
      /* ★ round538：技能书 → "学习"（学完书消耗掉）*/
      useBtn.textContent = '学 习';
      useBtn.className = 'bagB';
      useBtn.disabled = false;
      useBtn.setAttribute('data-act', 'useskillbook');
    } else if (selItem && selItem.kind === 'food') {
      useBtn.textContent = '食 用';
      useBtn.className = 'bagB';
      useBtn.disabled = false;
      useBtn.setAttribute('data-act', 'usefood');
    } else if (selItem && selItem.kind === 'skin') {
      /* ★ round487：皮肤卡 → "使用"= 解锁（不是穿上）*/
      useBtn.textContent = '解 锁';
      useBtn.className = 'bagB';
      useBtn.disabled = false;
      useBtn.setAttribute('data-act', 'useskin');
    } else if (selIsEquipped) {
      useBtn.textContent = '脱 下';
      useBtn.className = 'bagB off';
      useBtn.disabled = false;
      useBtn.setAttribute('data-act', 'off');
    /* ★★ 第 97 轮修的 bug（用户报："防具点开就是材料，使用按钮也是灰的"）★★
       这里原来写死了 slot === 'weapon' ✗ → 防具永远点不了"使用" ✗✓✓
       （也就是说：防具做完了、格子也画了，但【根本穿不上】✗）
       → 改成 武器 和 防具 都能用 ✓ */
    } else if (selItem && (selItem.slot === 'weapon' || selItem.slot === 'armor') &&
               selItem !== DEFAULT_W) {
      useBtn.textContent = '使 用';
      useBtn.className = 'bagB';
      useBtn.disabled = false;
      useBtn.setAttribute('data-act', 'use');
    } else {
      useBtn.textContent = '使 用';
      useBtn.className = 'bagB';
      useBtn.disabled = true;
      useBtn.setAttribute('data-act', '');
    }
  }
  /* ★ 第 56 轮（用户第 5 条）：名字和数值挂在【选中的武器】标题下 ✓
     不再写进"装备"那一段（那样点别的武器时，看着像已装备的数值变了 ✗）*/
  /* round299: sell-to-system button (small step 2: only enable/disable).
     Placed here - at the END of the bagUse block - because inserting it
     right after `var useBtn = ...` last time ran before selItem was set,
     so the button never lit up. Price itself is computed by the SERVER. */
  var sellBtn = document.getElementById('bagSell');
  /* round299d: the CLICK needs the DB row id, and that lives on the OUTER record
     ({id, item, stack}) - the inner `item` dict has no id at all. */
  /* round301: find the DB row id of the item that is selected RIGHT NOW.
     ---------------------------------------------------------------
     Why this is a function and not just a local `var sellId`:
     the click handler is bound exactly once per page load (guarded by `_b`), and the
     binding happens on the FIRST bagRender() - which runs with an EMPTY bag right after
     login. At that moment sellId is null. The closure kept that null forever, so the
     click handler hit `if (sellBtn.disabled || !sellId) return;` and returned without a
     single request, while the ENABLED state (recomputed here on every render) happily
     lit the button up. Symptom: bright button, click does nothing, no network at all.
     => resolve the id at CLICK time; never trust a captured value. */
  function sellIdNow() {
    if (typeof BAG === 'undefined' || !BAG || !BAG.items || !BAG.sel) { return null; }
    for (var _si = 0; _si < BAG.items.length; _si++) {
      if (String(BAG.items[_si].id) === String(BAG.sel)) { return BAG.items[_si].id; }
    }
    return null;
  }
  var sellId = null;
  if (selItem && typeof BAG !== 'undefined' && BAG.items) {
    for (var _bi = 0; _bi < BAG.items.length; _bi++) {
      if (BAG.items[_bi].item === selItem) { sellId = BAG.items[_bi].id; break; }
    }
  }
  /* ★ round409（用户："坏掉的武器只能出售给系统，并且只值 10 金币"）
     ★ 所以【卖给系统】要放行坏装备 ✗【挂交易所】不行 ✓
     （这行以前是 !selItem.broken ✗ 结果坏武器根本卖不掉 ✓）*/
  var sellable = !!(selItem && !selIsEquipped && selItem !== DEFAULT_W && sellId
                       && !selItem.locked_by && !selItem.locked);
  var mktOk = !!(sellable && !selItem.broken);
  if (sellBtn) {
    sellBtn.disabled = !sellable;
    sellBtn.className = sellable ? 'bagB' : 'bagB off';
  }
  /* ★ round411：上锁按钮【搬到格子浮窗】里了 ✗ 这里不再画一行藏起来的按钮 ✓
     （round410 就错在往 #bagRowUse 里加 ✗ 那一排是 display:none 的 ✓
       玩家永远看不到那个按钮 ✓
       而我当时只查了 DOM 存在 ✗ 没查它能不能被看到 ✓）*/
  /* round303: 批量按钮的亮/灰 + 提示文字 ✓（勾了几件也写在那里 ✓）*/
  var _sortBtn = document.getElementById('bagSort');
  if (_sortBtn && !_sortBtn._b) {
    _sortBtn._b = true;
    _sortBtn.onclick = function () {
      /* ★ round304v（用户："一键整理"）★
         ★ round416（用户："最高品质的装备放前面，其次再按类型分类"）
           → 规则改成【品阶优先】✗ 仍然全在服务端算 ✓
         ★ 顺序由【服务端】定 ✗ 客户端不自己排 ✓
           （排序规则和 slot_index 都在服务端 ✓ 两端各排一次迟早不一致 ✓）
         ★ 发完只等着 notice"（背包已更新）"✗ 它会自动重拉背包 ✓ */
      if (MKT.busy) { return; }
      BAG.msg = '正在整理…';
      bagRender();
      wsSend('bagsort', {});
    };
  }
  var _pickBtn = document.getElementById('bagPick');
  var _multiBtn = document.getElementById('bagSellMulti');
  var _pageBtn = document.getElementById('bagPickPage');
  var _pickTip = document.getElementById('bagPickTip');
  /* 勾中的东西要是已经不在背包里了（卖掉了/换页了）✗ 顺手清掉 ✓ */
  if (BAG.pick && BAG.pick.length) {
    BAG.pick = BAG.pick.filter(function (id) {
      for (var _z = 0; _z < (BAG.items || []).length; _z++) {
        if (String(BAG.items[_z].id) === String(id)) { return true; }
      }
      return false;
    });
  }
  if (_pickBtn) {
    _pickBtn.textContent = BAG.multi ? '退出批量' : '批量选择';
    _pickBtn.className = BAG.multi ? 'bagB on' : 'bagB';
  }
  if (_multiBtn) {
    var _pn = (BAG.pick || []).length;
    _multiBtn.textContent = _pn ? ('批量出售 (' + _pn + ')') : '批量出售';
    _multiBtn.disabled = !_pn;
  }
  if (_pickTip) {
    _pickTip.textContent = BAG.multi
      ? '点格子勾选 / 【整页勾选】勾这一页 30 格 ✗ 再点【批量出售】'
      : '勾选多件一起卖（5 阶以上会再确认一次）';
  }
  /* ★★★ round409（用户："背包出售再增加一个整页勾选的按钮"）★★★
     ★ 只勾【当前这一页】（30 格）✗ 不碰别的页的勾 ✓
     ★ 装备在身上 / 上架锁定中 / 默认那把 → 不勾 ✓（勾了也卖不掉 ✗ 只会让人困惑 ✓）
     ★ 再点一次 = 取消本页的勾 ✓（不用手动一个个点掉 ✓）
     ★ 闭包规矩：这里只绑一次 ✗ 每次点击【现算】当前页 ✓（round301 的教训 ✓）*/
  if (_pageBtn) {
    _pageBtn.className = BAG.multi ? 'bagB' : 'bagB';
    if (!_pageBtn._b) {
      _pageBtn._b = true;
      _pageBtn.onclick = function () {
        if (!BAG.multi) { BAG.multi = true; BAG.pick = []; }
        try { bagTipHide(); } catch (e0) { }     /* ★ 进出批量都先把浮窗关掉 ✓ */
        var ids = bagPageIds();
        var _allOn = true;
        for (var _q = 0; _q < ids.length; _q++) {
          if (_pickHas(ids[_q]) < 0) { _allOn = false; break; }
        }
        if (_allOn) {
          BAG.pick = BAG.pick.filter(function (id) { return ids.indexOf(id) < 0; });
        } else {
          for (var _r2 = 0; _r2 < ids.length; _r2++) {
            if (_pickHas(ids[_r2]) < 0) { BAG.pick.push(ids[_r2]); }
          }
        }
        bagRender();
      };
    }
  }
  /* ============================================================
     round304c：交易所那一行（★ 只在这里算"亮/灰"✗ 判定一律现算 ✓）
     ★ 为什么把【挂交易所】放在这一段里：它和【卖给系统】是同一类判断
       （选中了一件 + 这件能不能动 ✓）→ 共用同一个 sellable ✓
       分两处各算一遍 ✗ 迟早出现"卖系统的亮着、挂交易所灰着"✓
     ★ 闭包教训（round301 ✗ 这个文件里最贵的一课）：
       这里只设 disabled / 文案 ✗ click 里现取 id ✗ 绝不捕获 ✓
     ============================================================ */
  var mktBtn = document.getElementById('bagMkt');
  if (mktBtn) {
    mktBtn.disabled = !mktOk;
    mktBtn.className = mktOk ? 'bagB' : 'bagB off';
    if (!mktBtn._b) {
      mktBtn._b = true;
      var _mktGo = function () {
        if (mktBtn.disabled) { return; }
        var _now2 = Date.now();
        if (mktBtn._t && _now2 - mktBtn._t < 600) { return; }
        mktBtn._t = _now2;
        mktList();
      };
      /* ★ 和卖系统同一个套路：pointerdown + click 双绑 ✗ 防被拖动处理器吞掉 ✓ */
      mktBtn.addEventListener('pointerdown', function (e) { e.preventDefault(); _mktGo(); });
      mktBtn.onclick = function () { _mktGo(); };
    }
    /* 参考价：换了一件就问一次它的【系统收购价】✗ 填进输入框 ✓
       ★ 只在"换了另一件"时覆盖 ✗ 免得玩家刚改完价格就被冲掉 ✓ */
    var _priceEl = document.getElementById('bagMktPrice');
    if (_priceEl && mktOk && String(mktBtn._sid) !== String(sellId)) {
      mktBtn._sid = String(sellId);
      _priceEl.value = '';
      if (typeof sellQuote === 'function') {
        sellQuote([sellId], function (total) {
          /* ★ 问价回来时可能已经换了别的格子 ✗ 再对一次 ✓（round301 的教训 ✓）*/
          if (!_priceEl) { return; }
          if (String(mktBtn._sid) !== String(sellIdNow())) { return; }
          if (total > 0 && !_priceEl.value) { _priceEl.value = String(total); }
        });
      }
    }
  }
  /* round299 step 3: the click. Only asks the server - the price comes back from
     /api/sell (value.py). On success the bag refreshes and `me` carries the new
     balance on the next push, so the HUD updates by itself. */
  if (sellBtn && !sellBtn._b) {
    sellBtn._b = true;
    /* round300: bind BOTH pointerdown and click.
       The bag panel has drag/scroll handling that can swallow the `click` event
       (the same class of bug we hit with the "more" button: a handler called
       preventDefault on pointerdown, so click never fired). pointerdown always
       arrives first and cannot be swallowed that way. `_t` debounces the pair so
       one tap does not sell twice. */
    var _sellGo = function () {
      /* round301: resolve the item HERE, not at bind time (see sellIdNow above). */
      var iid = sellIdNow();
      if (!iid) { return; }
      var _now = Date.now();
      if (sellBtn._t && _now - sellBtn._t < 600) { return; }
      sellBtn._t = _now;
      /* round303b ★ 用户的规矩：5 阶以上的装备要二次确认 ✗
         单件也一样 ✗（"装备"不分单卖还是批量 ✓ 7 阶手一滑就没了才叫亏 ✓）
         ★ 低阶单件保持"点一下就走"✗ 不给每次卖垃圾都弹框 ✓
         ★ 确认框里写清楚能卖多少钱（用户要求 ✓ 价格问服务器 ✓） */
      var _tierN = 0, _nm = '';
      for (var _q = 0; _q < (BAG.items || []).length; _q++) {
        if (String(BAG.items[_q].id) === String(iid)) {
          _tierN = (((BAG.items[_q].item || {}).tier) || 0) + 1;
          _nm = (BAG.items[_q].item || {}).name || '物品';
          break;
        }
      }
      if (_tierN < HIGH_TIER_CONFIRM) {
        sellItems([iid], false);
        return;
      }
      if (sellBtn.disabled) { return; }
      sellBtn.disabled = true;
      toast('正在算价…');
      sellQuote([iid], function (total) {
        sellBtn.disabled = false;
        askConfirm({
          title: '确认卖出',
          lines: ['要卖出【' + _nm + '】吗？',
                  (total > 0)
                    ? ('★ 本次可得 <b style="color:' + GOLD_COL + '">' +
                       fmtGold(total) + '</b> 金币')
                    : '<span style="color:#ff7a6a">这件东西现在卖不了钱</span>'],
          warn: '★ 这是 ' + _tierN + ' 阶的东西 ✗ 卖掉就拿不回来了',
          ok: '确认出售'
        }, function (yes) {
          if (!yes) { return; }
          sellItems([iid], false);
        });
      });
    };
    sellBtn.addEventListener('pointerdown', function (e) { e.preventDefault(); _sellGo(); });
    sellBtn.onclick = function () { _sellGo(); };
  }
  var selNameEl = document.getElementById('bagSelName');
  // ★ 第 97 轮：防具也算"装备"✓（原来只认 weapon ✗ → 防具被当成材料显示 ✗）
  var isW8 = !!(selItem && (selItem.slot === 'weapon' || selItem.slot === 'armor') &&
                selItem !== DEFAULT_W);
  if (selNameEl) {
    if (isW8 && selItem.slot === 'armor') {
      /* ★ 第 97 轮：防具单独一行文案 ✗
         不然会去算"发挥度"（那是武器专属的 ✗ 对防具没意义 ✓）*/
      var rqA = +((selItem.reqLevel) || 1);
      var lvA = (WSC.role && WSC.role.level) || 1;
      selNameEl.textContent = (selItem.name || '防具') + ' · ' +
        ((selItem.tier || 0) + 1) + ' 阶 · ' +
        ((selItem.affixes && selItem.affixes.length)
          ? (selItem.affixes.length + ' 词条 · ') : '') +
        '建议 ' + rqA + ' 级（你 ' + lvA + ' 级）';
    } else if (isW8) {
      var m8 = wMastery(selItem);
      var rq8 = +((selItem.reqLevel) || 1);
      var lv8 = (WSC.role && WSC.role.level) || 1;
      selNameEl.textContent = (selItem.name || '武器') + ' · ' + ((selItem.tier || 0) + 1) + ' 阶 · ' +
        ((selItem.affixes && selItem.affixes.length) ? (selItem.affixes.length + ' 词条 · ') : '') + '建议 ' +
        rq8 + ' 级（你 ' + lv8 + ' 级）· 发挥 ' + Math.round(m8 * 100) + '%';
    } else {
      // ★ 第 98 轮：按【部位】自动说话 ✗ 不要写死"武器"（用户要求 ✓）
      var _sl9 = selItem ? (selItem.slot || '') : '';
      selNameEl.textContent = _sl9 === 'armor'
        ? '选中的防具（点「使用」穿上）'
        : (_sl9 === 'weapon' ? '选中的武器（点「使用」穿上）'
                             : '没选中装备（点上面的格子选一件）');
    }
  }
  /* ★★ round304e：这一行提示是【唯一】的 ✗ 别在两处各写一遍 ✓
     自测踩到：我新加的那一段先写、这里又覆盖回去 ✗ 结果提示永远停在默认那句 ✓
     （★ 同一个节点被两处赋值 ✗ 谁在后面谁赢 ✗ 这类 bug 看着像"没生效"✓）*/
  /* ★ round304f：这一排【整排都不显示了】✗ 动作搬进格子浮窗 ✓
     它的元素留着（程序要往里写状态、上架要读价格 ✓）✗ 但用户看不见 ✓
     ★ 别再改成"选中时才显示" ✗ 那会和浮窗里那套重复 ✓
       两处都能点同一件事 ✗ 迟早一边忘了同步状态 ✓ */
  var selTip = document.getElementById('bagSelTip');
  if (selTip) {
    if (isW8) {
      selTip.textContent = selIsEquipped
        ? '这件正拿在手上 ✓（要脱下来点下面的【脱下】）'
        : (BAG.multi ? '点格子勾选 ✓ 再点【批量出售】'
                     : ('已选中：' + ((selItem && selItem.name) || '这件') +
                        ' · 点【使用】穿上它 · 价格框已填系统收购价'));
    } else if (BAG.multi) {
      selTip.textContent = '点格子勾选 ✓ 再点【批量出售】';
    } else if (sellable) {
      selTip.textContent = '已选中：' + ((selItem && selItem.name) || '这件') +
        ' · 可以【卖给系统】或填价格【挂交易所】';
    } else {
      selTip.textContent = '点上面的格子选中一件（武器或防具）';
    }
  }
  if (mg) {
    mg.textContent = BAG.msg || (BAG.items.length ? '' :
      '背包是空的 —— 打僵尸有机会掉武器（走过去自动捡 ✓）');
  }
}

/* ============================================================
   round303: 卖给系统（单件 / 批量共用一套）
   ------------------------------------------------------------
   ★ 服务器权威：价格由服务器算（value.py ✓）✗ 客户端不猜 ✓
   ★ 卖出去之后【本地先删掉那一行】✗ 再拉一次背包 ✓
     为什么要本地先删：用户报过"卖完了背包里还在 ✗ 重进才消失"✓
     只有 bagFetch 一条路的话 ✗ 那一次请求慢一点/失败一点
     界面就停在旧样子 ✗ 看着就像没卖成功 ✓
   ★ 批量：服务端一次最多 100 件 ✓（超了只卖前 100 ✓ 会明确告诉你 ✓）
   ============================================================ */
function sellItems(ids, isBatch) {
  ids = (ids || []).filter(function (v) { return v !== null && v !== undefined; });
  if (!ids.length) { return; }
  /* ★★★ round412（用户："用批量出售上锁的物品会显示 POST /api/sell 400"）★★★
     ★ 病根：勾选之后才上锁的物品还留在 BAG.pick 里 ✗ 一起发过去 ✓
       服务端逐件拒 ✗ 如果【一件都没卖成】就回 400 → 浏览器控制台一条红字 ✓
       而且玩家只看到"卖不了"✗ 不知道是锁的问题 ✓
     ★ 修法：发请求之前把【锁住的】摘掉 ✓
       · 全都锁着 → 一条请求都不发（不会再有 400 ✓）只提示一句
       · 混着 → 只卖没锁的 ✓ 并告诉玩家跳过了几件 */
  var _locked = [];
  ids = ids.filter(function (v) {
    for (var i = 0; i < (BAG.items || []).length; i++) {
      if (String(BAG.items[i].id) === String(v)) {
        if ((BAG.items[i].item || {}).locked) { _locked.push(v); return false; }
        return true;
      }
    }
    return true;     /* 本地找不到就别拦 ✗ 交给服务端判 ✓ */
  });
  if (_locked.length) {
    if (typeof toast === 'function') {
      toast('跳过 ' + _locked.length + ' 件锁住的（要卖先解锁）');
    }
    if (!isBatch) { bagRender(); return; }
  }
  if (!ids.length) { bagRender(); return; }
  var tok = '';
  try { tok = localStorage.getItem('token') || ''; } catch (e) {}
  var sellBtn = document.getElementById('bagSell');
  var multiBtn = document.getElementById('bagSellMulti');
  if (sellBtn) { sellBtn.disabled = true; }
  if (multiBtn) { multiBtn.disabled = true; }
  fetch('/api/sell', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Token': tok },
    body: JSON.stringify(isBatch ? { iids: ids } : { iid: ids[0] })
  }).then(function (r) { return r.json(); }).then(function (j) {
    if (j && j.ok) {
      var gone = (j.sold && j.sold.length) ? j.sold : ids;
      /* 本地先删 ✗ 界面立刻正确 ✓（下面的 bagFetch 只是跟服务器再对一次账 ✓）*/
      try {
        if (typeof BAG !== 'undefined' && BAG && BAG.items) {
          BAG.items = BAG.items.filter(function (x) {
            for (var k = 0; k < gone.length; k++) {
              if (String(gone[k]) === String(x.id)) { return false; }
            }
            return true;
          });
          if (BAG.sel !== null && BAG.sel !== undefined) {
            var _still = false;
            for (var q = 0; q < BAG.items.length; q++) {
              if (String(BAG.items[q].id) === String(BAG.sel)) { _still = true; break; }
            }
            if (!_still) { BAG.sel = null; }
          }
          if (typeof bagRender === 'function') { bagRender(); }
        }
      } catch (e) { }
      if (typeof toast === 'function') {
        if (j.total !== undefined && j.sold && j.sold.length > 1) {
          toast('卖出 ' + j.sold.length + ' 件 +' + fmtGold(j.total) + ' 金币');
        } else {
          toast('卖出【' + (j.name || '物品') + '】+' + fmtGold(j.total !== undefined ? j.total : j.gold) + ' 金币');
        }
      }
      if (j && j.failed) {
        toast('有 ' + j.failed + ' 件没能卖出' + (j.error ? ('：' + j.error) : '（状态已变化）'));
      }
      if (typeof bagFetch === 'function') { bagFetch(bagRender); }
    } else if (typeof toast === 'function') {
      toast((j && j.error) || '卖不了');
    }
  }).catch(function () {
    if (typeof toast === 'function') { toast('网络错误'); }
  }).then(function () {
    /* 只负责解禁 ✗ 真正的亮/灰还是 bagRender 说了算 ✓ */
    if (sellBtn) { sellBtn.disabled = false; }
    if (typeof bagRender === 'function') { bagRender(); }
    if (multiBtn) { multiBtn.disabled = !(typeof BAG !== 'undefined' && BAG.pick && BAG.pick.length); }
  });
}

/* ============================================================
   round304c: 交易所（客户端）—— 方案 v3 §8 / §8b 的落地
   ------------------------------------------------------------
   ★ 服务端已经在跑（round304b ✗ 95+41 项验证过 ✓），这里只做界面 ✓
   ★ 三条设计口径（都是方案里定死的 ✗ 别改）：
     ① 面板放进【背包】里 ✗ 不新增菜单标签（菜单那一行刚好够 ✓）
     ② 图标直接复用 iconOfItem()：交易所里的和背包里的【必须一模一样】✓
        换武器模型 / 加新材料时自动跟着变 ✗ 不用改两处 ✓
     ③ 文案一律由【服务器】写（listres.msg ✗ 客户端不编 ✓）
        这里是显示层 ✗ 不自己拼"上架成功"这种话 ✓
   ★ 两种消息的分工（服务端定的 ✗ 别搞混）：
     mktopen = 打开面板 / 刚捡了东西 → 服务器【重读库】✓ 慢一点没关系（低频 ✓）
     lists   = 翻页/换分类/搜索   → 服务器只用【内存】✓ 快（高频 ✓）
   ★ 回执是 [lid, price, cat, tier, lv, name, seller, left, stack, icon]
     （紧凑数组 ✗ 一条省几十字节 ✗ 一页 20 条就省下不少 ✓）
   ============================================================ */

var MKT = {
  /* open = 面板开着吗 ✗ tab = 'all' | 'mine' ✗ rows = 当前页 ✓ */
  open: false, tab: 'all', rows: [], mine: [],
  total: 0, page: 1, pages: 1, pageSize: 20, on: 0, onMax: 10,
  gold: 0, msg: '', busy: false, afford: false,
  /* 筛选条件（★ 换分类不重置搜索词 ✗ 方案 §8b 明确要求 ✓）*/
  cat: 'all', sort: 'price', tier: 0, q: ''
};

/* 面板 DOM 是不是第一次用（★ 绑定只做一次 ✗ 但取值一律现算 ✓
   —— 这就是 round301 那个"闭包记住 null"的教训 ✓）*/
function mktBindOnce() {
  /* ★ 我自己的角色 id：用来标"这是你自己的商品"✗ 从 WSC.role 现取 ✓ */
  MKT.myRole = (WSC.role && WSC.role.id) ? WSC.role.id : null;
  var p = document.getElementById('mktPanel');
  if (!p || p._b) { return; }
  p._b = true;
  /* ★ round304d：没有"关闭"按钮了 ✗ 交易所是独立页签（点别的页签就走 ✓）
     自测会断言 #mktClose 不存在 ✗ 免得以后有人又加回来 ✓ */
  var tAll = document.getElementById('mktTabAll');
  var tMine = document.getElementById('mktTabMine');
  if (tAll) { tAll.onclick = function () { MKT.tab = 'all'; mktAsk(true); }; }
  if (tMine) { tMine.onclick = function () { MKT.tab = 'mine'; mktAsk(false); }; }
  var tLog = document.getElementById('mktTabLog');
  if (tLog) {
    tLog.onclick = function () {
      MKT.tab = 'log';
      MKT.page = 1;
      /* ★★ round304r：先【立刻重画一次】✗ 再去拉数据 ✓
         自测抓到的真 bug：只调了 mktLogAsk ✗ 而它遇到"还没登录/还没数据"会直接
         return ✗ 于是页面状态是"记录页"✗ 显示的却还是【商品列表】✓
         （用户点一下就会看到这个 ✗ 点完像是没反应 ✓）
         ★ 而且重画里带着"商品列表藏起来 / 记录页显示出来"那段 ✗
           不重画 = 两块同时显示或者两块都不对 ✓ */
      mktRender();
      mktLogAsk(0);
    };
  }
  /* 分类 / 阶数 / 排序：一组按钮共用一个处理器（★ 取值一律现算 ✓）*/
  var cats = document.querySelectorAll('#mktCatRow .mktCat');
  for (var i = 0; i < cats.length; i++) {
    cats[i].onclick = function () {
      MKT.cat = this.getAttribute('data-cat') || 'all';
      MKT.page = 1;
      mktAsk(false);
    };
  }
  var tiers = document.querySelectorAll('#mktSortRow .mktTierBtn');
  for (var j = 0; j < tiers.length; j++) {
    tiers[j].onclick = function () {
      MKT.tier = +(this.getAttribute('data-tier') || 0);
      MKT.page = 1;
      mktAsk(false);
    };
  }
  var sorts = document.querySelectorAll('#mktSortRow .mktSort');
  for (var k = 0; k < sorts.length; k++) {
    sorts[k].onclick = function () {
      MKT.sort = this.getAttribute('data-sort') || 'price';
      MKT.page = 1;
      mktAsk(false);
    };
  }
  var af = document.getElementById('mktAfford');
  if (af) {
    af.onclick = function () {
      MKT.afford = !MKT.afford;
      MKT.page = 1;
      mktAsk(false);
    };
  }
  var se = document.getElementById('mktSearch');
  if (se) {
    se.onclick = function () {
      var q = document.getElementById('mktQ');
      MKT.q = q ? String(q.value || '').trim() : '';
      MKT.page = 1;
      mktAsk(false);
    };
  }
  var qEl = document.getElementById('mktQ');
  if (qEl) {
    /* 回车 = 搜索 ✓（手机上"搜索"键也是回车 ✓）*/
    qEl.onkeydown = function (e) {
      if (e && (e.key === 'Enter' || e.keyCode === 13)) {
        MKT.q = String(qEl.value || '').trim();
        MKT.page = 1;
        mktAsk(false);
      }
    };
  }
  var pv = document.getElementById('mktPrev');
  if (pv) {
    pv.onclick = function () {
      if (MKT.page > 1) { MKT.page--; mktAsk(false); }
    };
  }
  var nx = document.getElementById('mktNext');
  if (nx) {
    nx.onclick = function () {
      if (MKT.page < MKT.pages) { MKT.page++; mktAsk(false); }
    };
  }
  var rf = document.getElementById('mktRefresh');
  if (rf) { rf.onclick = function () { mktAsk(true); }; }
  /* ★ round304m：记录页那三个筛选 + 翻页（★ 只在第一次画的时候绑 ✓）*/
  var lgAll = document.getElementById('mktLogAll');
  if (lgAll && !lgAll._b) {
    lgAll._b = true;
    document.getElementById('mktLogAll').onclick = function () { MKTLOG.side = 'all'; mktLogRender(); };
    document.getElementById('mktLogBuy').onclick = function () { MKTLOG.side = 'buy'; mktLogRender(); };
    document.getElementById('mktLogSell').onclick = function () { MKTLOG.side = 'sell'; mktLogRender(); };
    document.getElementById('mktLogPrev').onclick = function () {
      if (MKTLOG.page > 0) { mktLogAsk(MKTLOG.page - 1); }
    };
    document.getElementById('mktLogNext').onclick = function () {
      if (MKTLOG.page < MKTLOG.pages - 1) { mktLogAsk(MKTLOG.page + 1); }
    };
  }
  mktGridBind();
}

/* 打开交易所（★ round304d：现在它是一个【独立页签】✗ 不再是浮层 ✓）
   ★ 为什么保留这个函数：背包里的【挂交易所】成功后要跳过去看一眼 ✓
     跳转 = openSet('mkt') ✗ 和用户自己点那个导航按钮【走同一条路】✓
     （★ 别再自己管显隐 ✗ 页签那套逻辑在 setTab 里只有一份 ✓）*/
function mktOpen() {
  if (typeof openSet === 'function') { openSet('mkt'); return; }
  mktBindOnce();
  MKT.open = true;
  MKT.tab = 'all';
  MKT.page = 1;
  mktAsk(true);
}

/* 问一次服务器（fresh=true 走 mktopen ✗ 否则走纯内存的 lists ✓）*/
function mktAsk(fresh) {
  if (!NET.on || !WSC.ready) { MKT.msg = '单机模式没有交易所（联机才有 ✓）'; mktRender(); return; }
  var b = { cat: MKT.cat, sort: MKT.sort, tier: MKT.tier, page: MKT.page,
            q: MKT.q };
  if (MKT.afford) { b.afford = 1; }
  if (MKT.tab === 'mine') { MKT.msg = ''; wsSend('mylists', {}); return; }
  MKT.msg = fresh ? '正在读货架…' : '';
  var ok = wsSend(fresh ? 'mktopen' : 'lists', b);
  if (!ok) { MKT.msg = '没连上服务器'; }
  mktRender();
}

/* 买 / 下架 / 领取：都要问一次确认（★ 都是花真钱或真东西 ✗ 手一滑就没了 ✓）*/
function mktBuy(lid, name, price, qty) {
  if (MKT.busy) { return; }
  qty = Math.max(1, parseInt(qty, 10) || 1);
  /* ★ round304o：price 是【单价】✗ 总价 = 单价 × 数量 ✓
     ★ 全部在客户端只做"显示"✗ 真正的钱由服务端按同一算法规（unit × qty ✓）*/
  var total = price * qty;
  var net = total - Math.floor(total * 5 / 100);
  askConfirm({
    title: '确认购买',
    lines: ['要买下【' + name + '】' + (qty > 1 ? (' ×<b>' + qty + '</b> 个') : '') + '吗？',
            '★ ' + (qty > 1
              ? ('单价 ' + fmtGold(price) + ' × ' + qty + ' = 要花 <b style="color:' +
                 GOLD_COL + '">' + fmtGold(total) + '</b> 金币')
              : ('要花 <b style="color:' + GOLD_COL + '">' + fmtGold(total) + '</b> 金币')),
            '<span style="color:#9aa4b2">卖家到手 ' + fmtGold(net) +
            '（成交税 5% ✗ 方案定稿）</span>'],
    warn: '买下来就进你的背包 ✗ 退不回去',
    ok: '确认购买'
  }, function (yes) {
    if (!yes) { return; }
    /* sid = 幂等键 ✗ 服务器拿它挡重复成交（方案 v3 §5 ✓）*/
    MKT.busy = true;
    MKT.msg = '正在买…';
    mktRender();
    wsSend('buyitem', { lid: lid, qty: qty, sid: mktSid() });
  });
}
function mktUnlist(lid, expired) {
  if (MKT.busy) { return; }
  askConfirm({
    title: expired ? '取回过期的商品' : '确认下架',
    lines: [expired ? '这件已经过期了 ✗ 取回背包吗？' : '要把这件从货架上拿下来吗？'],
    warn: expired ? '' : '★ 上架费不退（方案定稿）',
    ok: '确 定'
  }, function (yes) {
    if (!yes) { return; }
    MKT.busy = true;
    MKT.msg = '处理中…';
    mktRender();
    wsSend(expired ? 'listclaim' : 'unlist', { lid: lid });
  });
}

/* 上架（★ 价格是玩家填的 ✗ 客户端不做任何"合不合法"的判断 ✓
   服务器说"最低 10 金币"就照它说的显示 ✓ 两套规则迟早对不上 ✓）*/
function mktList() {
  var priceEl = document.getElementById('bagMktPrice');
  var iid = bagSellSelId();
  if (!iid) { toast('先在背包里选中一件'); return; }
  var price = priceEl ? String(priceEl.value || '').replace(/[^0-9]/g, '') : '';
  if (!price) { toast('先填一个价格'); return; }
  /* ★ round304o：数量从浮窗那条滑条来 ✗ 没有就是 1 ✓
     （存在 BAG.mktQty ✗ 由浮窗的按钮写进去 ✓）*/
  var qty = Math.max(1, parseInt(BAG.mktQty, 10) || 1);
  if (MKT.busy) { return; }
  var nm = '';
  for (var i = 0; i < (BAG.items || []).length; i++) {
    if (String(BAG.items[i].id) === String(iid)) { nm = (BAG.items[i].item || {}).name || '物品'; break; }
  }
  askConfirm({
    title: '确认上架',
    lines: ['要把【' + nm + '】' + (qty > 1 ? (' ×<b>' + qty + '</b> 个') : '') +
            '挂到交易所吗？',
            '★ ' + (qty > 1
              ? ('单价 <b style="color:' + GOLD_COL + '">' + fmtGold(price) + '</b> × ' +
                 qty + ' = 共 <b style="color:' + GOLD_COL + '">' + fmtGold(+price * qty) +
                 '</b> 金币')
              : ('价格 <b style="color:' + GOLD_COL + '">' + fmtGold(price) + '</b> 金币')),
            '<span style="color:#9aa4b2">手续费 1%（最低 1 ✗ 最高 100 ✗ 余额不足 1000 免）</span>'],
    warn: '上架期间这' + (qty > 1 ? (qty + ' 个') : '件') +
          '东西【不在背包里】✗ 别人可以买走',
    ok: '确认上架'
  }, function (yes) {
    if (!yes) { return; }
    MKT.busy = true;
    BAG.msg = '正在上架…';
    bagRender();
    wsSend('mklist', { iid: iid, price: +price, qty: qty, sid: mktSid() });
  });
}

/* 幂等键：'c' + 毫秒 + 序号（★ 服务端的格式要求是"唯一"✗ 客户端只要不撞就行 ✓）*/
var _mktSidSeq = 0;
function mktSid() {
  _mktSidSeq++;
  return 'c' + Date.now().toString(36) + '.' + _mktSidSeq;
}

/* 当前选中的那件在【数据库里的 id】（★ 现算 ✗ 绝不进闭包 ✓ round301 的教训 ✓）*/
function bagSellSelId() {
  if (typeof BAG === 'undefined' || !BAG || !BAG.items || !BAG.sel) { return null; }
  for (var i = 0; i < BAG.items.length; i++) {
    if (String(BAG.items[i].id) === String(BAG.sel)) { return BAG.items[i].id; }
  }
  return null;
}

/* 行 → 图标单元格
   ★★★ round304g（用户："交易所里物品的图标为什么没有采用原来的"）★★★
     根因：第一版这里是【自己拼了一个假物品】✗（fake = {tier, slot, look, ...} ✓）
       而武器图标是按 look + tier 画的 ✗ 少了 base/affixes/dur ✓
       → 画出来和背包里那把【不是同一个东西】✗ 用户一眼就看出不一样 ✓
     ★ 正解：服务端现在把【完整 item_json】发过来了（pub_row 第 11 格 ✓）
       直接把那一份喂给 iconOfItem ✗ 和背包里【同一个函数 + 同一个输入】✓
       → 零新代码 ✗ 而且换武器模型/加新材料自动跟着变 ✓
     ★ 老的"图标三要素"那格留着当兜底（万一是旧服务端 ✗ 也不至于画不出来 ✓）*/
function mktIcon(it, tier, icon) {
  if (it && (it.slot || it.kind)) {
    return '<span style="color:' + tierHex(it.tier || tier || 0) + '">' +
      iconOfItem(it) + '</span>';
  }
  var fake = { tier: tier | 0, slot: (icon || {}).slot || null,
               look: (icon || {}).look || null, kind: (icon || {}).kind || null,
               key: (icon || {}).key || null,
               name: mktMatName(icon, tier), rarity: (icon || {}).rarity || null };
  return '<span style="color:' + tierHex(tier) + '">' + iconOfItem(fake) + '</span>';
}
/* 材料名（★ 服务端把材料名放在 icon.look 里 ✗ 详见它 pub_row 的注释 ✓）
   ★ 为什么不让客户端自己认：材料图标表在 MAT_ICON_BY_NAME 里 ✓
     在这里复制一份 = 两张表 ✗ 以后加材料必然不同步 ✓（方案 §8b 的原话 ✓）
   → 服务器把它自己的名字带过来 ✗ 客户端只做一次查表 ✓ 永远同步 ✓*/
function mktMatName(icon, tier) {
  if (!icon) { return ''; }
  if (icon.slot === 'weapon' || icon.slot === 'armor') { return ''; }
  return String(icon.look || '');
}

/* ============================================================
   渲染
   ============================================================ */
function mktRender() {
  if (!MKT.open) { return; }
  var g = document.getElementById('mktGold');
  if (g) { g.textContent = fmtGold(MKT.gold || 0); }
  var mm = document.getElementById('mktMine');
  if (mm) { mm.textContent = '我的上架 ' + (MKT.on || 0) + '/' + (MKT.onMax || 10); }
  var msg = document.getElementById('mktMsg');
  if (msg) { msg.textContent = MKT.msg || ''; }
  /* 按钮高亮：分类 / 阶数 / 排序 / 只看买得起（★ 全部现算 ✓）*/
  mktHilite('#mktCatRow .mktCat', 'data-cat', MKT.cat);
  mktHilite('#mktSortRow .mktTierBtn', 'data-tier', String(MKT.tier));
  mktHilite('#mktSortRow .mktSort', 'data-sort', MKT.sort);
  var af = document.getElementById('mktAfford');
  if (af) { af.className = MKT.afford ? 'bagB on mktAfford' : 'bagB mktAfford'; }
  var ta = document.getElementById('mktTabAll');
  var tm = document.getElementById('mktTabMine');
  var tl = document.getElementById('mktTabLog');
  if (ta) { ta.className = (MKT.tab === 'all') ? 'bagB on' : 'bagB'; }
  if (tm) { tm.className = (MKT.tab === 'mine') ? 'bagB on' : 'bagB'; }
  if (tl) { tl.className = (MKT.tab === 'log') ? 'bagB on' : 'bagB'; }
  var tip = document.getElementById('mktTabTip');
  if (tip) {
    tip.textContent = (MKT.tab === 'mine')
      ? '你自己挂的东西 ✗ 可下架（上架费不退）✓'
      : ((MKT.tab === 'log')
          ? '买到的 + 卖掉的都在这 ✗ 一页 20 条 ✓'
          : '看别人挂的东西 ✗ 点购买就能买走');
  }
  /* ★ round304m：记录页和商品列表【互斥显示】✗ 一起由这里管 ✓
     （两块的分页语义不同 ✗ 不能塞进同一个列表 ✓ 也不能同时显示 ✓）*/
  var _isLog = (MKT.tab === 'log');
  var _logWrap = document.getElementById('mktLogWrap');
  var _listBox = document.getElementById('mktList');
  if (_logWrap) { _logWrap.style.display = _isLog ? 'block' : 'none'; }
  if (_listBox) { _listBox.style.display = _isLog ? 'none' : 'grid'; }
  if (_isLog) {
    mktLogRender();
    return;                       /* 记录页不用管商品那套翻页 ✓ */
  }
  /* 翻页行：只有一页就不显示 ✓ */
  var pg = document.getElementById('mktPager');
  if (pg) { pg.style.display = (MKT.pages > 1) ? 'flex' : 'none'; }
  var pt = document.getElementById('mktPageTxt');
  if (pt) {
    pt.textContent = '第 ' + MKT.page + ' / ' + MKT.pages + ' 页 · 共 ' +
      MKT.total + ' 件';
  }
  /* 列表 */
  var box = document.getElementById('mktList');
  if (!box) { return; }
  var rows = (MKT.tab === 'mine') ? MKT.mine : MKT.rows;
  if (!rows || !rows.length) {
    box.innerHTML = '<div class="mktEmpty">' +
      (MKT.tab === 'mine' ? '你还没挂东西 ✗ 在背包里选中一件 → 填价格 → 挂交易所'
                          : '货架是空的 ✗ 去【我的上架】挂一件试试') + '</div>';
    return;
  }
  var h = '';
  for (var i = 0; i < rows.length; i++) {
    h += (MKT.tab === 'mine') ? mktMineRow(rows[i]) : mktRow(rows[i]);
  }
  box.innerHTML = h;
  /* ★★ round304g：把"这一行是哪个物品"挂到元素上 ✗ 浮窗要用 ✓
     为什么不用 HTML 属性传：完整 item_json 里有引号/中文 ✗ 塞进属性要转义一堆 ✓
     挂 JS 属性最省事 ✗ 反正每次重画都重新挂 ✓（不存在闭包记旧值的问题 ✓）
     ★ 顺手把 __seller / __price 清掉 ✗ 它们是给按钮判断用的 ✓
       留着会跟着 item 一起进 iconOfItem 之类的函数（那边不认这些键 ✓ 但别留脏数据 ✓）*/
  var els = box.querySelectorAll('.mktRow');
  for (var j = 0; j < els.length; j++) {
    var lid = els[j].getAttribute('data-mktrow');
    var src = null;
    var list = (MKT.tab === 'mine') ? MKT.mine : MKT.rows;
    for (var k = 0; k < (list || []).length; k++) {
      var lid2 = (MKT.tab === 'mine') ? list[k].lid : list[k][0];
      if (String(lid2) === String(lid)) { src = list[k]; break; }
    }
    var it2 = (MKT.tab === 'mine') ? (src && src.it) : (src && src[10]);
    /* ★ round304q：把"原来那件物品的 id"（第 13 格 iid ✓）也挂在元素上
       ✗ 用名字认东西会认错（同名多件 ✗ 同一个名字可能挂了好几单 ✓）*/
    var _iid2 = (MKT.tab === 'mine') ? (it2 && it2.__iid) : (src && src[12]);
    if (!it2) { continue; }
    var clean = {};
    for (var kk in it2) {
      if (kk !== '__seller' && kk !== '__price') { clean[kk] = it2[kk]; }
    }
    clean.__iid = _iid2 || 0;
    els[j]._it = clean;
    els[j]._seller = it2.__seller;
  }
}

function mktHilite(sel, attr, val) {
  var list = document.querySelectorAll(sel);
  for (var i = 0; i < list.length; i++) {
    var base = list[i].className.replace(/\s*on/g, '');
    list[i].className = (String(list[i].getAttribute(attr)) === String(val))
      ? (base + ' on') : base;
  }
}

/* 一行商品（★ 左边 3px 品阶色条 ✗ 44×44 图标 ✗ 名字/阶数/等级/卖家/剩余 ✓）*/
function mktRow(r) {
  var lid = r[0], price = r[1], tier = r[3], lv = r[4], name = r[5];
  var seller = r[6], left = r[7], stack = r[8], icon = r[9] || {};
  /* 浏览行里的 left 是【秒】（服务端 pub_row 算好的 ✓ 单位就这一种 ✓）*/
  var mins = Math.round((+left || 0) / 60);
  var long = (mins >= 1440) ? (Math.floor(mins / 1440) + ' 天')
    : (mins >= 60 ? (Math.floor(mins / 60) + ' 小时') : (mins + ' 分'));
  var isMe = (MKT.myRole && String(seller) === String(MKT.myRole));
  var it = r[10] || null;                 /* ★ 完整物品（服务端第 11 格 ✓）*/
  if (it) { it.__seller = seller; it.__price = price; }   /* ★ 浮窗里要判"是不是我的"+ 买价 ✓ */
  /* ★★ round304t（用户："商品文字信息显示不全，把文字改小点" +
     "买家的数量滑条，你把它做到图标点击后显示了而不是购买的时候显示"）★★
     ★ 量出来的数据：两列布局里每一行只有 217px ✗
       其中 图标 36 + 价格 44 + 【购买按钮】60 + 间距 ≈ 150 ✓
       → 留给名字的只有 55px ✗ 而真实名字（5 个字）在 12px 下要 60px ✓
       所以名字必然被截 ✗（我把字体调小也没用 ✗ 空间是被按钮吃掉的 ✓）
     ★ 正解（也是用户要的）：把【购买按钮从行里去掉】✗ 改成点整行出详情浮窗 ✓
       → 名字那一格立刻多出 60px ✗ 5 个字的装备名能完整显示 ✓
       → 数量滑条也就在【点开之后】出现（用户第 3 条要的正是这个 ✓）
     ★ 顺手把字都调小半号（用户："把文字改小点"✓）*/
  /* ★★ round304u（用户："卖家名字看不到，可以把它改到点击商品的悬浮信息中"）★★
     ★ 原来这里塞了"★N 阶 · LvN · ×N · 卖家 #1234" ✗ 在半屏宽里必然被截 ✓
       （卖家 id 又长又不好看 ✓ 截断的还正好是它 ✓）
     ★ 现在行里只留【阶数 / 物品等级 / 买几个】✗ 卖家挪进详情浮窗 ✓
       → 行里短了 ✗ 而且这些字【不用再缩】✗ 可以回到 12px ✓
     ★ "你自己的"也挪走了 ✗ 详情浮窗里会写（那边判得更准 ✓）*/
  var sub = '★' + (tier + 1) + ' 阶' + (lv ? (' · Lv' + lv) : '');
  return '<div class="mktRow" data-mktrow="' + lid + '"' +
    ' style="border-left-color:' + tierHex(tier) + '">' +
    '<span class="mktIco" style="background:' + tierRgba(tier, 0.18) + '">' +
      '<span class="mktTier">' + (tier + 1) + '</span>' + mktIcon(it, tier, icon) +
      /* ★★ round304u（用户："商品的图标上要显示物品数量"）★★
         ★ 显示的是【还剩几个】= 第 12 格 ✗ 不是原来那一堆有几个 ✓
           （买走 2 个之后要变成 ×2 ✗ 这才是买家想看的数 ✓）
         ★ 1 个就不显示（大多数装备都是 1 ✗ 挂个 ×1 只是噪音 ✓）*/
      ((+r[11] || 1) > 1 ? ('<span class="mktCnt">×' + (+r[11]) + '</span>') : '') +
      /* ★★ round304j（用户："耐久度的进度条显示在图标下方和背包一样"）★★
         挪到【图标那一格里】✗ 和背包格子上那条【同一个类、同一个位置、同一套色】✓
         （原来我放在名字那一行 ✗ 用户要的是和背包一致的观感 ✓）*/
      durBarHTML(it) + '</span>' +
    '<span class="mktMain"><span class="mktName">' + mktEsc(name) + '</span>' +
      '<span class="mktSub">' + sub + '</span></span>' +
    '<span class="mktPrice">' + fmtGold(price) + '<small>剩 ' + long + '</small></span>' +
    /* ★ 这里原来有个【购买】按钮 ✗ 现在没了 ✓
       为什么可以拿掉：点整行就会弹出详情浮窗 ✗ 里面就有【购买】+ 数量滑条 ✓
       拿掉之后名字那一格宽了 60px ✗ 长名字才显示得下 ✓
       ★ "你自己的"那三个字也一并去掉 ✗ 名字那行已经写了"（你自己）"✓ */
    '</div>';
}

/* 我的上架那一行（★ 多显示"到手多少"✗ 卖家最关心这个 ✓）*/
function mktMineRow(r) {
  var lid = r.lid, price = r.price, tier = r.tier || 0, name = r.name || '';
  var st = r.state || 'on', net = r.net || 0, tax = r.tax || 0;
  var expired = (st !== 'on');
  /* ★★ 服务端【没发 left】✗ 自测当场把这个坑照出来了★★
     坏样子：界面显示"剩 20729074 天后过期"✓（因为 +r.left 是 undefined → 0 ✓
     而下面又拿它当秒数算 ✗ 两个口径混在一起）
     ★ 正解：用服务端回灌的【绝对到期时刻】exp（毫秒 ✗ 和 Date.now() 同一把尺子 ✓）
       没有 exp 才退回 left（秒 ✗ 单位写清楚 ✓）*/
  var leftMs = (typeof r.exp === 'number' && r.exp > 0)
    ? (r.exp - Date.now())          /* exp 是毫秒 ✗ 和 Date.now() 同一把尺子 ✓ */
    : ((+r.left || 0) * 1000);      /* left 是秒 ✗ 只在服务端没给 exp 时才走这条 ✓ */
  var mins = Math.max(0, Math.round(leftMs / 60000));
  var long = expired ? '已过期' :
    ((mins >= 1440) ? (Math.floor(mins / 1440) + ' 天后过期')
                    : (mins >= 60 ? (Math.floor(mins / 60) + ' 小时后过期')
                                  : (mins + ' 分钟后过期')));
  if (r.it) { r.it.__seller = MKT.myRole; r.it.__price = price; }
  return '<div class="mktRow' + (expired ? ' gone' : '') +
    '" data-mktrow="' + lid + '" style="border-left-color:' + tierHex(tier) + '">' +
    '<span class="mktIco" style="background:' + tierRgba(tier, 0.18) + '">' +
      '<span class="mktTier">' + (tier + 1) + '</span>' +
      mktIcon(r.it, tier, null) + durBarHTML(r.it) + '</span>' +
    '<span class="mktMain"><span class="mktName">' + mktEsc(name) + '</span>' +
      '<span class="mktSub">★' + (tier + 1) + ' 阶 · ' + long +
      ' · 到手 ' + fmtGold(net) + '（税 ' + fmtGold(tax) + '）</span></span>' +
    '<span class="mktPrice">' + fmtGold(price) + '<small>' +
      (expired ? '待取回' : '在售') + '</small></span>' +
    '<button class="bagB" data-mktun="' + lid + '" data-mktexp="' +
      (expired ? 1 : 0) + '">' + (expired ? '取 回' : '下 架') + '</button>' +
    '</div>';
}

/* 名字里有 < > & 就直接拼进 HTML ✗ 必须转义（★ 玩家名字/物品名都可能带 ✓）*/
function mktEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* 交易所里弹一行的说明（★ 内容走 bagTipHTML ✗ 和背包里一字不差 ✓）
   ★ 动作按钮由 acts='market' 决定：购买 / 下架 / 取回 ✓
   ★ 记住"这个浮窗是给哪一行的"（b._for ✓）→ 同一行不重画 ✗ 点第二次收起来 ✓*/
function mktTipShow(rowEl, x, y) {
  if (!rowEl || !rowEl._it) { return; }
  var src = null;
  var list = (MKT.tab === 'mine') ? MKT.mine : MKT.rows;
  for (var i = 0; i < (list || []).length; i++) {
    var lid = (MKT.tab === 'mine') ? list[i].lid : list[i][0];
    if (String(lid) === String(rowEl.getAttribute('data-mktrow'))) { src = list[i]; break; }
  }
  if (!src) { return; }
  var it = rowEl._it;
  var lid2 = (MKT.tab === 'mine') ? src.lid : src[0];
  /* ★ round304o：把"单价 / 还能买几个"也传进去 ✗ 数量滑条要拿它当最大值 ✓
     （qty 是第 12 格 ✓ 单价是第 2 格 ✓ 两个都从服务端来 ✓ 客户端不自己算 ✓）*/
  var sinfo = { seller: rowEl._seller,
                unit: (MKT.tab === 'mine') ? (src.price || 0) : (src[1] || 0),
                qty: (MKT.tab === 'mine') ? 1 : (src[11] || 1) };
  /* ★★ round304u：单价要【单独记在行元素上】★★
     （用户报："点击购买时显示需要 0 金币"✓）
     根因：_it 上的 __price 被 mktRender 当脏字段清掉了 ✗
       （它只留 __seller ✗ 因为按钮要判"是不是我自己的"✓）
       → 点购买时读 it.__price 得到 undefined ✗ 兜底成 0 ✓
       → 确认框写"要花 0 金币"✗ 而真正扣钱走的是服务端的价 ✗ 所以扣得对 ✓
     ★ 现在：sinfo 里已经有 unit（服务端第 2 格 ✓）✗ 直接记在行上 ✓
       买的时候从这里读 ✗ 不再碰 _it 上的字段 ✓ */
  rowEl._unit = sinfo.unit;
  rowEl._qty = sinfo.qty;
  /* ★ round304u：卖家 / 买家看得到的那些信息，挪进详情浮窗（行里放不下 ✓）
     ★ 一行一条 ✗ 写在名字下面最显眼的位置 ✓
     ★ "你自己的"也写在这（行里已经不写了 ✓）*/
  var extra = '<span style="opacity:.75;font-size:11px">' +
    (MKT.tab === 'mine'
      ? ('挂单 #' + lid2 + ' · 单价 ' + fmtGold(sinfo.unit) + ' · 还剩 ' + sinfo.qty + ' 个')
      : ('卖家：' + (String(rowEl._seller) === String(MKT.myRole)
          ? '你自己' : ('#' + rowEl._seller)) +
         ' · 单价 ' + fmtGold(sinfo.unit) +
         ((+sinfo.qty || 1) > 1 ? (' · 还剩 ' + sinfo.qty + ' 个') : ''))) +
    '</span><br>';
  var box = document.getElementById('bagTipBox');
  bagTipShowAt(x, y, extra + bagTipHTML(it, lid2, 'market', sinfo));
  if (box) { box._for = rowEl; }
}

/* 列表的点击：事件委托（★ 行是 innerHTML 拼的 ✗ 每行绑一次会漏 ✓）*/
function mktGridBind() {
  var box = document.getElementById('mktList');
  if (!box || box._b) { return; }
  box._b = true;
  /* ★ round304g：点一行先弹/收【说明浮窗】✗ 真正的买/下架在浮窗的按钮里 ✓
     （用户要求："点击商品时应该弹出悬浮窗口展示详细的商品介绍"✓）
     ★ 那一行上的【购买】按钮还在 ✗ 想快买的人不用绕 ✓ */
  box.onclick = function (e) {
    var el = e.target;
    while (el && el !== box && !el.getAttribute) { el = el.parentNode; }
    if (!el || el === box) { return; }
    /* ★ round304t：行里已经没有购买按钮了 ✗ 购买只在详情浮窗里 ✓
       所以这里【不再有】"点到按钮就快买"那条分支 ✓
       （留一条永远走不到的分支 = 以后有人以为它还有用 ✗ 直接删掉 ✓）*/
    /* 点在行上（不是按钮）→ 弹说明 */
    var row = el;
    while (row && row !== box && !(row.className && String(row.className).indexOf('mktRow') >= 0)) {
      row = row.parentNode;
    }
    if (!row || row === box) { return; }
    var b = document.getElementById('bagTipBox');
    if (b && getComputedStyle(b).display !== 'none' && b._for === row) {
      bagTipHide();                       /* 再点一下 = 收起来 ✓ */
      return;
    }
    mktTipShow(row, e.clientX, e.clientY);
    /* ★★ round304t（用户："买家的数量滑条，你把它做到【图标点击后】显示"）★★
       ★ 关键：点开的这一份必须【停住】✗ 不能跟划过的浮窗一样"鼠标一走就关"✓
         否则玩家手一抖（或者手指抬起来 ✓）浮窗就没了 ✗ 根本拖不到滑条 ✓
       ★ 滑条本来就在浮窗里（只剩 >1 个才有 ✓）—— 之前的问题是
         "只有鼠标恰好停在那一行上才看得到"✗ 现在点一下就固定住了 ✓
       ★ 点别处 / 再点同一行 / 点 ✕ 都会关（那几条路已经有了 ✓）*/
    bagTipStickyOn();
  };
  /* 鼠标划过也弹一份（★ 不"停住"✗ 用和背包一样的延时关 ✓）
     ★ round304t：划过的那份【不能】继承"停住"状态 ✗
       所以下面每次划到新的一行都先 bagTipStickyOn 的反面走一遍 ✓
       （点开 → 停住；再划别的行 → 换成划过模式 ✓ 这样两种用法不打架 ✓）*/
  box.onmousemove = function (e) {
    var row = e.target;
    while (row && row !== box && !(row.className && String(row.className).indexOf('mktRow') >= 0)) {
      row = row.parentNode;
    }
    if (!row || row === box) { bagTipHideSoon(120); return; }
    if (_mktTipHold) { return; }          /* 鼠标在浮窗上 ✗ 别抢 ✓ */
    var b = document.getElementById('bagTipBox');
    if (b && b._for === row) { return; }  /* 已经是这一行了 ✗ 别重画（会闪）✓ */
    if (_mktTipSticky) { return; }        /* ★ 停住的那份别被划过覆盖掉 ✓ */
    mktTipShow(row, e.clientX, e.clientY);
  };
  box.onmouseleave = function () { bagTipHideSoon(200); };
  /* ★ round304n（用户选的"按你推荐的做"）：翻页按钮之外再给一条【滚动到底自动下一页】✓
     ★ 为什么要它：手机上翻页按钮要"回到底部再点"✗ 滚到尽头自动续上更顺 ✓
     ★ 防重复：正在翻 or 已经是最后一页就什么都不做 ✓（_mktScrollBusy）*/
  var pane = document.querySelector('.tabpane[data-pane=mkt]');
  if (pane && !pane._sb) {
    pane._sb = true;
    pane.addEventListener('scroll', function () {
      if (MKT.tab !== 'all') { return; }            /* 只有商品列表要自动续 ✓ */
      if (_mktScrollBusy || MKT.page >= MKT.pages) { return; }
      if (pane.scrollTop + pane.clientHeight < pane.scrollHeight - 40) { return; }
      _mktScrollBusy = true;
      MKT.page++;
      mktAsk(false);
      setTimeout(function () { _mktScrollBusy = false; }, 600);
    });
  }
  box.addEventListener('touchstart', function (e) {
    var row = e.target;
    while (row && row !== box && !(row.className && String(row.className).indexOf('mktRow') >= 0)) {
      row = row.parentNode;
    }
    if (!row || row === box) { return; }
    var t = (e.touches && e.touches[0]) || e;
    bagTipStickyOn();
    mktTipShow(row, t.clientX, t.clientY);
  }, { passive: true });
}

/* ============================================================
   收到服务器的两条交易所消息
   ============================================================ */
function mktOnPage(d) {
  mktBindOnce();
  /* ★ 金币以服务器给的为准 ✗ 没带就用 me.gold（同一个来源 ✓）*/
  if (typeof d.gold !== 'number' && WSC.role && typeof WSC.role.gold === 'number') {
    MKT.gold = WSC.role.gold;
  }
  if (d.mine) {
    /* "我的上架"（mylists 或 mktopen 顺带发的那条 ✓）*/
    MKT.mine = d.rows || [];
    MKT.on = +(d.on || 0);
    MKT.onMax = +(d.max || 10);
    if (typeof d.gold === 'number') { MKT.gold = d.gold; }
    mktRender();
    return;
  }
  MKT.rows = d.rows || [];
  MKT.total = +(d.total || 0);
  MKT.page = +(d.page || 1);
  MKT.pages = +(d.pages || 1);
  MKT.pageSize = +(d.pageSize || 20);
  if (typeof d.gold === 'number') { MKT.gold = d.gold; }
  MKT.busy = false;
  MKT.msg = '';
  mktRender();
}

function mktOnRes(d) {
  mktBindOnce();
  MKT.busy = false;
  /* ★ 那句尾巴是给 wsOnMessage 认的记号 ✗ 玩家不该看到它 ✓ */
  var msg = String(d.msg || '').replace('（背包已更新）', '');
  if (!d.ok) {
    MKT.msg = '✗ ' + msg;
    toast('✗ ' + msg);
    mktRender();
    /* 失败可能是"这东西已经不在背包了"→ 顺手把背包刷新一下 ✓ */
    if (msg.indexOf('背包') >= 0) { bagFetch(bagRender); }
    return;
  }
  if (d.refresh) {
    /* ★ 最终回执（落库之后那条 ✓）才刷新界面 ✗ 乐观那条不刷 ✓
       为什么：乐观那条只是"正在上架…"✗ 刷了反而闪并且 lid 还没有 ✓ */
    MKT.msg = msg || '完成';
    toast(msg || '完成');
    if (typeof bagFetch === 'function') { bagFetch(bagRender); }
    if (MKT.open) { mktAsk(false); }
  } else {
    MKT.msg = msg || '处理中…';
    mktRender();
  }
}

/* ============================================================
   ★★★ round304m（用户："增加一个购买和卖出记录查看，也要写分页"）★★★
   我的记录：买到的 + 卖掉的（服务端 /api/trades ✗ 只读 + 分页 ✓）
   · 数据来自 trade_log ✗ 从交易所第 1 步就在写了 ✓（一直没人读而已 ✓）
   · 一页 20 条 ✗ 服务端算好 pages ✗ 客户端只管翻 ✓
   · side='sell' 时显示"到手多少"（扣了税 ✓）· side='buy' 时显示"花了多少"✓
   ============================================================ */
var MKTLOG = { rows: [], page: 0, pages: 1, total: 0, side: 'all',
               busy: false, sumBuy: 0, sumSell: 0 };

function mktLogAsk(page) {
  if (!NET.on || !WSC.ready) { return; }
  if (MKTLOG.busy) { return; }
  MKTLOG.busy = true;
  var tok = bagToken();
  var p = Math.max(0, parseInt(page, 10) || 0);
  fetch('/api/trades?page=' + p, { headers: { 'X-Token': tok } })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      MKTLOG.busy = false;
      if (!j || !j.ok) { MKT.msg = (j && j.error) || '读记录失败'; mktRender(); return; }
      MKTLOG.rows = j.rows || [];
      MKTLOG.page = +j.page || 0;
      MKTLOG.pages = +j.pages || 1;
      MKTLOG.total = +j.total || 0;
      mktLogRender();
    })
    .catch(function () { MKTLOG.busy = false; MKT.msg = '读记录失败（网络）'; mktRender(); });
}

function mktLogRender() {
  var wrap = document.getElementById('mktLogWrap');
  var list = document.getElementById('mktLogList');
  var pager = document.getElementById('mktLogPager');
  var txt = document.getElementById('mktLogPageTxt');
  var sum = document.getElementById('mktLogSum');
  if (!list) { return; }
  /* 三个筛选按钮的高亮 */
  var btns = [['mktLogAll', 'all'], ['mktLogBuy', 'buy'], ['mktLogSell', 'sell']];
  for (var b = 0; b < btns.length; b++) {
    var el = document.getElementById(btns[b][0]);
    if (el) { el.className = (MKTLOG.side === btns[b][1]) ? 'bagB on' : 'bagB'; }
  }
  var rows = MKTLOG.rows.filter(function (x) {
    return (MKTLOG.side === 'all') || (x.side === MKTLOG.side);
  });
  var sb = 0, ss = 0;
  for (var i = 0; i < MKTLOG.rows.length; i++) {
    if (MKTLOG.rows[i].side === 'buy') { sb += (+MKTLOG.rows[i].price || 0); }
    else { ss += (+MKTLOG.rows[i].net || 0); }
  }
  MKTLOG.sumBuy = sb; MKTLOG.sumSell = ss;
  if (sum) {
    sum.textContent = '本页：买到 ' + fmtGold(sb) + ' ✗ 卖出到手 ' + fmtGold(ss) +
      ' · 共 ' + MKTLOG.total + ' 笔';
  }
  if (!rows.length) {
    list.innerHTML = '<div class="mktEmpty">' +
      (MKTLOG.total ? '这一类还没有记录' : '还没有交易记录 ✗ 去买卖一笔试试') + '</div>';
  } else {
    var h = '';
    for (var j = 0; j < rows.length; j++) { h += mktLogRow(rows[j]); }
    list.innerHTML = h;
  }
  if (pager) { pager.style.display = (MKTLOG.pages > 1) ? 'flex' : 'none'; }
  if (txt) { txt.textContent = '第 ' + (MKTLOG.page + 1) + ' / ' + MKTLOG.pages + ' 页'; }
}

function mktLogRow(r) {
  var sell = (r.side === 'sell');
  var t = r.tier || 0;
  var when = '';
  try {
    var d = new Date(r.ts || 0);
    when = (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
      ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  } catch (e) { when = ''; }
  var sub = (sell ? '卖给 ' : '从 ') + mktEsc(r.who || '?') + (sell ? '' : ' 买到') +
    (r.qty > 1 ? (' · ×' + r.qty + '（单价 ' + fmtGold(r.unit) + '）') : '') +
    ' · ' + when;
  return '<div class="mktRow" style="border-left-color:' + tierHex(t) + '">' +
    '<span class="mktIco" style="background:' + tierRgba(t, 0.18) + '">' +
      '<span class="mktTier">' + (t + 1) + '</span>' +
      mktIcon(r.icon && r.icon.slot ? { name: r.name, tier: t, slot: r.icon.slot,
                                        look: r.icon.look, kind: r.icon.kind,
                                        dur: r.dur, durMax: r.durMax } : null,
              t, r.icon) + '</span>' +
    '<span class="mktMain"><span class="mktName">' + mktEsc(r.name) + '</span>' +
      '<span class="mktSub">' + sub + '</span></span>' +
    '<span class="mktPrice" style="color:' + (sell ? GOLD_COL : '#ff9d7a') + '">' +
      (sell ? ('+' + fmtGold(r.net)) : ('-' + fmtGold(r.price))) +
      '<small>' + (sell ? ('税 ' + fmtGold(r.tax)) : '买入') + '</small></span>' +
    '</div>';
}

/* 服务器在 notice 尾巴上带的约定：见到"（背包已更新）"就去重拉背包 ✓
   （服务端 _mkt_ack 里写死的 ✗ 两边必须一致 ✓ 改一边要改另一边 ✓）*/
function mktNoticeSaysRefresh(text) {
  return String(text || '').indexOf('（背包已更新）') >= 0;
}

/* round303b: 问服务器【这批东西现在能卖多少钱】✗ 只读 ✓ 不卖 ✓
   ★ 为什么非要问服务器：价格公式只在 server/value.py 里 ✗
     客户端自己再算一遍 = 两套公式 ✓ 迟早对不上 ✓（这个项目被这个坑过 ✓）
   ★ 打不通就回 0 ✗ 确认框改成"价格待定"✗ 绝不编一个数出来 ✓ */
function sellQuote(ids, cb) {
  var tok = '';
  try { tok = localStorage.getItem('token') || ''; } catch (e) {}
  var q = [];
  for (var i = 0; i < (ids || []).length && i < 100; i++) { q.push(encodeURIComponent(ids[i])); }
  if (!q.length) { cb(0, {}); return; }
  fetch('/api/sellquote?iids=' + q.join(','), { headers: { 'X-Token': tok } })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (j && j.ok) { cb(+(j.total || 0), j.prices || {}); }
      else { cb(0, {}); }
    })
    .catch(function () { cb(0, {}); });
}

/* 批量出售入口（被按钮调用 ✓）★ 先弹二次确认 ✗ 确认了才真的卖 ✓ */
function bagPickHas(id) {
  for (var k = 0; k < ((BAG.pick) || []).length; k++) {
    if (String(BAG.pick[k]) === String(id)) { return true; }
  }
  return false;
}
function bagSellBatch() {
  if (typeof BAG === 'undefined' || !BAG) { return; }
  var ids = [], hi = 0;
  for (var j = 0; j < (BAG.items || []).length; j++) {
    var r2 = BAG.items[j];
    if (!bagPickHas(r2.id)) { continue; }
    ids.push(r2.id);
    var t = (((r2.item || {}).tier) || 0) + 1;      /* tier 是 0 起的 ✗ 显示要 +1 ✓ */
    if (t > hi) { hi = t; }
  }
  if (!ids.length) { toast('先勾选要卖的东西'); return; }
  var n = ids.length;
  var capped = ids.slice(0, 100);
  /* ★ 先问价 ✗ 再弹框 ✓（用户要求：确认框里要写这次卖多少钱 ✓）
     问价是只读的 ✗ 慢一点也不会出事 ✓ 但按钮先禁掉防连点 ✓ */
  var mb = document.getElementById('bagSellMulti');
  if (mb) { mb.disabled = true; }
  toast('正在算价…');
  sellQuote(capped, function (total, prices) {
    if (mb) { mb.disabled = false; }
    var perItem = [];
    for (var q = 0; q < capped.length; q++) {
      var pr = prices[String(capped[q])];
      if (pr) { perItem.push(pr); }
    }
    var lines = ['要卖出【' + n + '】件物品吗？'];
    if (total > 0) {
      lines.push('★ 本次可得 <b style="color:' + GOLD_COL + '">' +
        fmtGold(total) + '</b> 金币');
      if (n > 1 && perItem.length > 1) {
        lines.push('<span style="color:#9aa4b2">（' + perItem.length + ' 件有收购价的合计 ✗ ' +
          '没有价的卖不了）</span>');
      }
    } else {
      lines.push('<span style="color:#ff7a6a">这些东西现在卖不了钱</span>');
    }
    if (n > 100) { lines.push('一次最多 100 件 ✗ 这次只会卖前 100 件'); }
    askConfirm({
      title: '批量出售确认',
      lines: lines,
      warn: (hi >= HIGH_TIER_CONFIRM) ? ('★ 里面有 ' + hi + ' 阶的东西 ✗ 卖掉就拿不回来了') : '',
      ok: '确认出售'
    }, function (yes) {
      if (!yes) { return; }
      sellItems(capped, true);
    });
  });
}

/* ★★★ round304g（用户："点击商品时应该弹出悬浮窗口展示详细的商品介绍"）★★★
   把这段说明拆成【两半】✗ 让背包和交易所【共用同一份】✓
     · bagTipHTML(it, id, acts) → 说明 + 按钮的 HTML
     · bagTipShowAt(x, y, html)  → 摆位置 + 显示
   ★ 为什么必须共用：用户在交易所里看到的属性 ✗ 必须和背包里【一字不差】✓
     抄一份的话 ✗ 以后改数值显示就要改两处 ✓（这个项目被"两套公式"坑过 ✓）*/
/* ★★★ round304i（用户："把耐久条做出来吧，这样如果有人卖没有耐久的装备一眼可以看出来"）★★★
   画一条耐久条（★ 和背包格子上那条长得一样 ✗ 颜色规则也同一套 ✓）
     · 绿 >50% · 黄 >20% · 红 ≤20%
     · 没耐久的物品（材料）返回空串 ✗ 免得多一条空的 ✓
   ★ 为什么做成函数：这条东西现在有【四处】要用（背包格子/装备槽/防具槽/交易所 ✓）
     原来那三处是各写各的 ✗ 加第四处就该收口了 ✓（免得改颜色要改四个地方 ✓）
   ★ scale 参数：不同地方宽度不一样 ✗ 默认 8 个字符 ✓*/
function durBarHTML(it, inline) {
  if (!it || !(+it.durMax > 0)) { return ''; }
  var d = (typeof it.dur === 'number') ? it.dur : it.durMax;
  var k = Math.max(0, Math.min(1, d / it.durMax));
  var col = (k > 0.5) ? '#7ee08a' : (k > 0.2 ? '#ffd83d' : '#ff7a6a');
  var w = (k * 100).toFixed(1);
  /* 破损的：条直接变红 ✗ 而且画满（一眼看出"这条命没了"✓）*/
  if (it.broken) { col = '#ff7a6a'; w = '100'; }
  if (inline) {
    /* 说明浮窗里那种：跟着文字走的小条 ✓ */
    return '<span class="durbarTick"><i style="width:' + w + '%;background:' +
      col + '"></i></span>';
  }
  /* ★ 图标里那种：和背包格子【同一个类名 durbar】✗ 靠 absolute 贴底 ✓ */
  return '<span class="durbar"><i style="width:' + w + '%;background:' +
    col + '"></i></span>';
}
/* 说明浮窗里那种（★ 就是那条小条 ✗ 跟在"耐久"那行后面 ✓）*/
function _durBar(it) {
  var h = durBarHTML(it, true);      /* true = 文字里那种（inline ✓）*/
  return h ? (' <span style="opacity:.9">' + h + '</span>') : '';
}

function bagTipHTML(it, id, acts, seller) {
  if (!it) { return ''; }
  var s = wStatsOf(it);
  var extra = '';
  if (it.slot === 'weapon') {
    var mT = wMastery(it);
    if (mT < 1) {
      extra += '<b style="color:#ffd83d">⚠ 建议 ' + (it.reqLevel || 1) + ' 级（你现在 ' +
        ((WSC.role && WSC.role.level) || 1) + ' 级）· 只能发挥 ' +
        Math.round(mT * 100) + '%</b><br>';
    }
    /* ★★ round470（用户："武器的基础属性要显示出来，例如基础伤害"）★★
       防具那边写的是装备自己的基础值（减伤/生命）✗ 武器这边只有"实际每击" ✗
       → 补：基础伤害 · 武器系数 · 基础攻速 → 当前攻速（含词条）✓ */
    extra += '基础伤害 <b>' + wFlat(it).toFixed(0) + '</b> 点<br>' +
      '武器系数 <b>×' + (+((it.base || {}).coeff) || 1.0).toFixed(2) + '</b><br>' +
      '基础攻速 <b>×' + s.spdBase.toFixed(2) + '</b>' +
      (s.spdPct ? (' · 词条 <b style="color:#8ee0ff">+' + s.spdPct.toFixed(1) + '%</b>') : '') +
      ' → 当前 <b style="color:#ffd83d">×' + s.spd.toFixed(2) + '</b>' +
      '（' + wInterval(it).toFixed(2) + ' 秒一刀 = <b>每秒 ' +
      (1 / wInterval(it)).toFixed(2) + ' 刀</b> · 上限 ×' + W_SPD_MAX + '）<br>' +
      '实际每击 <b>' + wRealHit(it).toFixed(0) + '</b> · 每秒 <b>' +
      wRealDps(it).toFixed(0) + '</b><br>' +
      '武器强度 <b>' + wStrength(it).toFixed(0) + '</b>（纯比较用、不含你的等级）<br>' +
      '范围 <b>' + s.reach.toFixed(1) + '</b> 米（' + rangeWord(s.reach) + '）<br>' +
      '打击面：' + arcWord(s.arc) + '<br>';
  } else if (it.slot === 'armor' && it.base) {
    /* ★★ 第 107 轮（用户选的 B：悬停那个浮窗信息太少）★★
       根因：这段"详细信息"原来【只给武器拼】✗（if slot === 'weapon' ✓）
            防具进来是空的 → 浮窗只剩名字和品阶 ✓ 用户："提示信息太简单了"✓
       用户要求：不用补得特别完整，重要的有就行 ✓
       → 只放四样：减伤 / 生命上限 / 词条条数 / 耐久 ✓ */
    var bA = it.base || {};
    /* ★ round472：显示【打折后】的数值 ✗ 并标出发挥度 ✓
       （不然 1 级看到 1000 级防具写着"减伤 3000"会以为真能减这么多 ✗）*/
    var aS = aStatsOf(it);
    extra += '减伤 <b>' + (Math.round(aS.dr * 10) / 10) + '</b> 点' +
      (aS.mastery < 0.999 ? ('<i>（满发挥 ' + Math.round(aS.drFull) + '）</i>') : '') +
      ' · 生命上限 <b>+' + Math.round(aS.hp) + '</b>' +
      (aS.mastery < 0.999 ? ('<i>（满 ' + Math.round(aS.hpFull) + '）</i>') : '') + '<br>' +
      (aS.mastery < 0.999
        ? ('<b style="color:#ffd83d">⚠ 装备 ' + (+it.itemLv || 1) + ' 级（建议 ' +
           (+it.reqLevel || 1) + '），你现在 ' +
           ((WSC.role && WSC.role.level) || 1) + ' 级 · 只发挥 ' +
           Math.round(aS.mastery * 100) + '%</b><br>')
        : '');
  }
  /* ★★★ round304h（用户："耐久的显示有做吗，如果有词条这些能看到吗"）★★★
     问出来的真相：词条和耐久这两行原来【只写在防具那个分支里】✗
       → 武器一件都看不到 ✗ 而武器恰恰是最需要看耐久的（每挥一刀 −1 ✓）
     ★ 为什么以前没人发现：那段代码是"给防具补信息"时写的（第 107 轮 ✓）
       写的时候只想着防具 ✗ 顺手把"通用"的东西（词条/耐久）也放进去了 ✓
       —— 于是它变成了"防具专属"✗ 而看武器的人永远看不到 ✓
     ★ 修法：挪出来 ✗ 放到"只要它是装备就显示"的位置 ✓
       而且【耐久和词条对武器防具本来就一样】（都是 dur/durMax + affixes ✓）
       唯一不同的是那行小提示（穿哪个槽 / 挥刀还是挨打 ✓）*/
  if (it.slot === 'weapon' || it.slot === 'armor') {
    var afG = it.affixes || [];
    if (afG.length) {
      /* ★★ round469（用户："把悬停的信息显示的词条也换行，交易所的悬停也是"）★★
         原来是 afGTxt.join(' · ') ✗ 三条挤成一行 ✗
         现在一条一行 ✗
         ★ 交易所的悬停也走这个函数（mktTipShow → bagTipHTML）→ 一处改两处生效 ✓ */
      extra += '<span style="color:#ffd83d">词条 ' + afG.length + ' 条：</span>';
      for (var ig = 0; ig < afG.length; ig++) {
        extra += '<span style="display:block;color:#8ee0ff;padding-left:6px;line-height:1.55">• ' +
          (afG[ig].text || '') + '</span>';
      }
      extra += '';
    } else {
      extra += '<span style="opacity:.7">这件没有词条</span><br>';
    }
    if (+it.durMax > 0) {
      var ddG = (typeof it.dur === 'number') ? it.dur : it.durMax;
      var kG = Math.max(0, Math.min(1, ddG / it.durMax));
      /* ★★★ round304i（用户："出售的如果不是满耐久的能看到吗"）★★★
         能 ✗ 而且要说清楚"满没满"✗ 光给两个数字玩家还得自己算 ✓
         · 满耐久 → 绿字"满"
         · 不满   → 黄/红字"78%" + "（用了 22%）"
         · 已损坏 → 红字（这件基本上就是废的 ✓ 但交易所允许挂着卖 ✓）
         ★ 数字旁边永远写清楚"是被什么消耗的"（武器挥砍 / 防具挨打 ✓）*/
      var _full = (ddG >= it.durMax);
      var _pct = Math.round(kG * 100);
      var _colG = it.broken ? '#ff7a6a'
        : (_full ? '#7ee08a' : (kG > 0.5 ? '#ffd83d' : '#ff7a6a'));
      extra += '耐久 <b style="color:' + _colG + '">' + ddG + '</b> / ' +
        it.durMax + ' 次' + (it.slot === 'weapon' ? '挥砍' : '挨打') +
        ' · <b style="color:' + _colG + '">' +
        (it.broken ? '已损坏 ✗ 不能用了' : (_full ? '满耐久 ✓' : ('只剩 ' + _pct + '%'))) +
        '</b>' + _durBar(it) + '<br>';
    } else {
      extra += '<span style="opacity:.7">这件没有耐久属性</span><br>';
    }
    extra += '<span style="opacity:.7">' + (it.slot === 'weapon'
      ? '拿在手上 · 点下面的【使用】装上'
      : '穿在武器槽右边那个槽 · 点下面的【使用】穿上') + '</span><br>';
  } else if (it.kind === 'skin') {
    /* ★★ round505：皮肤卡的说明（以前当成"材料 · skin"✗ 说的是卖钱 ✓ 不对）*/
    var _skOwn = false;
    try {
      if (it._unlocked !== undefined && it._unlocked !== null) {
        _skOwn = !!it._unlocked;
      } else {
        var _sl = (SKIN.items || []);
        for (var _si = 0; _si < _sl.length; _si++) {
          if (_sl[_si].k === it.key) { _skOwn = !!_sl[_si].own; break; }
        }
      }
    } catch (e) { }
    extra += '皮肤卡 · <b style="color:#8ee0ff">' + (it.key || '') + '</b>' +
      (_skOwn ? '（<b style="color:#7ee08a">已拥有</b>）' : '（还没解锁）') + '<br>';
    extra += '<span style="opacity:.75">点【使用】= 解锁这套皮肤 ✗ 解锁后<b>永久</b>拥有，随时在 菜单→皮肤 换 ✓</span><br>';
    extra += '<span style="opacity:.7">重复的可以【卖给系统】' +
      '<b style="color:#ffd83d">5000</b> 金币，或者【挂交易所】卖给别人 ✓</span><br>';
  } else if (!it.slot) {
    var rar = it.rarity || '';
    extra += '材料' + (rar ? (' · 稀有度 ' + rar) : '') +
      (it.kind ? (' · ' + it.kind) : '') + '<br>';
    extra += '<span style="opacity:.7">可以【卖给系统】换金币 ✗ 也可以【挂交易所】卖给别人 ✓</span><br>';
  }
  /* ★★ 第 55 轮：等级需求 + 发挥度【写进文案】★★
     用户要求："武器等级需求还是没有显示，把它改到文案里吧，以及发挥度"
     → 不再只靠角上那个小黄标（太小、还得对上位置 ✗）→ 直接在名字这行写成字 ✓ */
  var m5 = (it.slot === 'weapon') ? wMastery(it) : 1;
  var req5 = +((it && it.reqLevel) || 1);
  var lv5 = (WSC.role && WSC.role.level) || 1;
  var lvlTxt = '';
  if (it.slot === 'weapon') {
    lvlTxt = (m5 < 1)
      ? '<i> · 建议 ' + req5 + ' 级（你 ' + lv5 + ' 级）· 发挥 ' + Math.round(m5 * 100) + '%</i>'
      : '<i> · 建议 ' + req5 + ' 级（已达标 · 发挥 100%）</i>';
  }
  /* ★ 背包那条路要把"一堆有几个"传下去 ✗ 数量滑条要用 ✓
     （交易所有自己的数量信息 ✗ 两边都在 seller 这个参数里 ✓）*/
  var _seller = seller;
  if (acts === 'bag' && typeof BAG !== 'undefined' && BAG.items) {
    for (var _bi = 0; _bi < BAG.items.length; _bi++) {
      if (String(BAG.items[_bi].id) === String(id)) {
        _seller = { stack: Math.max(1, parseInt(BAG.items[_bi].stack, 10) || 1) };
        break;
      }
    }
  }
  return '<b style="color:' + tierHex(it.tier || 0) + '">' + (it.name || '?') + '</b>' +
    (it.locked ? ' <span style="color:#ffd83d">🔒 已锁</span>' : '') +
    '<i> · ' + ((it.tier || 0) + 1) + ' 阶' + (it.itemLv ? (' · 物品 ' + it.itemLv + ' 级') : '') +
    '</i>' + lvlTxt + '<br>' + extra +
    (it.locked ? '<span style="color:#ffd83d">🔒 已锁住：不能卖、不能挂交易所、不会被批量出售' +
      '（点【解 锁】放开）</span><br>' : '') +
    (acts === 'none' ? '' : bagTipBtnsHTML(it, id, acts, _seller));
}

/* 摆位置 + 显示（★ 坐标是视口坐标 ✗ 和 fixed 定位配套 ✓）*/
function bagTipShowAt(x, y, html) {
  var box = document.getElementById('bagTipBox');
  if (!box) { return; }
  box.innerHTML = html;
  box.style.display = 'block';
  /* ★★ round304f：定位要【避开鼠标】✗ 因为鼠标现在要能移进来点按钮 ✓
     · 先按"鼠标右侧 14px"摆 ✗ 摆不下就翻到左边 ✓
     · 高度按实际算（里面有按钮 ✗ 比以前高 ✓）*/
  var bw = box.offsetWidth || 240, bh = box.offsetHeight || 160;
  var px = x + 14;
  if (px + bw > window.innerWidth - 6) { px = Math.max(6, x - bw - 14); }
  var py = y + 12;
  if (py + bh > window.innerHeight - 6) { py = Math.max(6, window.innerHeight - bh - 6); }
  box.style.left = Math.round(px) + 'px';
  box.style.top = Math.round(py) + 'px';
}

/* 背包格子的浮窗（★ 只是"从格子里取物品"✗ 说明本身在 bagTipHTML ✓）*/
function bagTipAt(e, el) {
  var idx = +el.getAttribute('data-i');
  var rec = BAG.items[idx] || {};
  if (!rec.item) { return; }
  bagTipShowAt(e.clientX, e.clientY, bagTipHTML(rec.item, rec.id, 'bag'));
}


/* ★★★ round304o（用户："拉动数量条选择数量上架 / 购买时也是一样"）★★★
   一条数量滑条（★ 上架和购买共用同一段 HTML ✗ 参数不同而已 ✓）
     · max = 最多能选几个（上架 = 你那一堆有几个 ✗ 购买 = 货架上还剩几个 ✓）
     · val = 默认值（上架 = 全挂 ✓ 购买 = 买 1 个 ✓ —— 买一个是最常见的 ✓）
     · unit = 单价（拖动时实时算总价 ✗ 玩家最需要这个数 ✓）
   ★ 为什么用 range：手机上是原生控件 ✗ 好拖 ✗ 不用自己写触摸逻辑 ✓
   ★ 数字框也留着（range 拖不准的时候可以直接填 ✓ 两边【双向同步】✓）*/
/* 这件东西能不能按数量卖（★ 判据必须和服务端 market.is_stack 一致 ✓）
   · 有 slot 的（武器/防具）→ 不能堆叠 ✗ 只能 1 件 ✓
   · 没 slot 的（材料/黄金）→ 能 ✓
   ★ 为什么不在客户端"猜"：判据只有一条（有没有 slot ✓）✗
     两端写的是同一句 ✗ 不存在两套规则对不上的问题 ✓ */
function isStackItem(it) {
  return !(it && it.slot);
}

function qtyHTML(max, val, unit) {
  max = Math.max(1, parseInt(max, 10) || 1);
  val = Math.max(1, Math.min(max, parseInt(val, 10) || 1));
  var h = '<div class="qtyRow" data-qtymax="' + max + '" data-qtyunit="' + unit + '">' +
    '<span class="qtyLab">数量</span>' +
    '<input type="range" class="qtyRange" min="1" max="' + max + '" value="' + val + '">' +
    '<input type="number" class="mktInput qtyNum" min="1" max="' + max + '" value="' + val + '">' +
    '<span class="qtyTotal"></span></div>';
  return h;
}

/* 浮窗里那排按钮的 HTML（★ 两处共用 ✗ acts 决定画哪种 ✓）
   acts = 'bag'    → 使用 / 脱下 / 卖给系统 / 挂交易所 + 价格框（背包里那件 ✓）
   acts = 'market' → 购买 / 下架 / 取回（交易所里那件 ✓）
   ★ 为什么不让交易所也显示"卖给系统"：那不是交易所干的事 ✗ 玩家会懵 ✓
     （用户要看的是"属性 + 词条 + 耐久" ✗ 动作按场景给 ✓）*/
function bagTipBtnsHTML(it, id, acts, seller) {
  var h = '<div class="bagTipBtns" data-tipfor="' + (id || '') + '" data-tipacts="' +
    (acts || 'bag') + '">';
  if (acts === 'market') {
    var mine = MKT.tab === 'mine';
    if (mine) {
      var expired = false;
      for (var mi = 0; mi < (MKT.mine || []).length; mi++) {
        if (String(MKT.mine[mi].lid) === String(id)) { expired = (MKT.mine[mi].state !== 'on'); }
      }
      h += '<button class="bagB" data-tipact="' + (expired ? 'claim' : 'unlist') + '">' +
        (expired ? '取 回' : '下 架') + '</button>';
    } else if (MKT.myRole && String((seller && seller.seller) || '') === String(MKT.myRole)) {
      h += '<button class="bagB" disabled>你自己的</button>';
    } else {
      h += '<button class="bagB" data-tipact="buy">购 买</button>';
      /* ★ 货架上还有多个 ✗ 才能选数量（只剩 1 个就别给滑条了 ✓）*/
      var _avail = Math.max(1, parseInt(seller && seller.qty, 10) || 1);
      if (_avail > 1) {
        /* ★★ round304t：滑条上限就是【货架上还剩几个】✗ 不再按余额夹一次 ✓
           为什么原来那个夹法是错的：它拿客户端的【金币快照】算能买几个 ✗
             · 快照可能是旧的（刚花过钱 / 刚登录还没推 ✓）
             · 结果是"有 8 个也最多只能选 1 个"✗ 看着像坏了 ✓
               （自测量到过：qmax 变成 "1" ✓）
           ★ 现在：想选几个选几个 ✗ 钱不够由【服务端】拒 ✓
             而且它回的话就是"金币不够（要 N ✗ 你有 M）"✗ 够清楚了 ✓ */
        h += qtyHTML(_avail, 1, (seller && seller.unit) || 0);
      }
    }
    h += '<button class="bagB" data-tipact="close">✕</button></div>';
    return h;
  }
  /* ---- 背包那种 ---- */
  var isW = (it.slot === 'weapon' || it.slot === 'armor');
  var equipped = ((BAG.weaponItemId && String(id) === String(BAG.weaponItemId)) ||
                  (BAG.armorItemId && String(id) === String(BAG.armorItemId)));
  var sellable = !!(id && !equipped && it !== DEFAULT_W && !it.broken &&
                    !it.locked_by && !it.locked);
  if (isW) {
    h += '<button class="bagB" data-tipact="' +
      (equipped ? 'off' : 'use') + '">' + (equipped ? '脱 下' : '使 用') + '</button>';
  }
  /* ★★ round505（用户："背包里点开卡片的悬浮窗口应该有皮肤的使用按钮"）
     → 皮肤卡在这排加一个「使 用」✗ 点了直接解锁并换上 ✓
       （以前只有选中后【详情区】那个「解 锁」✗ 浮窗里没有 ✓）
     ★ 锁定的卡不给用（和上锁的装备一个道理 ✓ 先解锁再换）*/
  if (!isW && it.kind === 'skin' && it.key && id && !it.locked && !it.locked_by) {
    var _skOwnBtn = false;
    try {
      if (it._unlocked !== undefined && it._unlocked !== null) {
        _skOwnBtn = !!it._unlocked;
      } else {
        for (var _sb2 = 0; _sb2 < (SKIN.items || []).length; _sb2++) {
          if (SKIN.items[_sb2].k === it.key) { _skOwnBtn = !!SKIN.items[_sb2].own; break; }
        }
      }
    } catch (eB2) { }
    if (_skOwnBtn) {
      h += '<button class="bagB" disabled>已解锁</button>';
    } else {
      h += '<button class="bagB" data-tipact="useskin">使 用</button>';
    }
  }
  /* ★ 2026-10-22（用户："悬浮窗口上加上使用的按钮"）食物/饮料在浮窗里直接能用 */
  if (!isW && it.kind === 'food' && id && !it.locked && !it.locked_by) {
    h += '<button class="bagB" data-tipact="usefood">使 用</button>';
  }
  /* ★ round557（用户："技能书的悬浮窗口没有学习按钮"）
     ★ 之前把【皮肤】那条改成了 useskillbook ✗ 技能书反而没有按钮 ✓ 已修 */
  /* ★ round560（用户："背包里技能书的浮窗要有技能效果说明"）*/
  if (it.kind === 'skillbook' && it.key) {
    var sd = (typeof SK !== 'undefined' && SK.byKey) ? (SK.byKey[it.key] || {}) : {};
    var _kn = sd.kind === 'A' ? '主动' : (sd.kind === 'B' ? '被动释放' : '被动加成');
    h += '<div style="margin:6px 0 4px;padding:6px 8px;border-radius:7px;background:#0e141c;' +
      'border:1px solid #ffffff14;font-size:11.5px;line-height:1.6;color:#cfdae6">' +
      '<b style="color:#ffd83d">' + (sd.n || it.key) + '</b>' +
      (sd.k ? ('<i style="color:#8fa3b8"> · ' + _kn + '</i>') : '') + '<br>' +
      '<i style="color:#9fb0c2">' + (sd.qi ? ('灵气 ' + sd.qi + ' · ') : '') +
      (sd.cd ? ('CD ' + sd.cd + ' 秒') : '无冷却') +
      (sd.r ? (' · 半径 ' + sd.r + ' 米') : '') + '</i><br>' +
      '<span>' + (sd.d || '（说明拉取中…）') + '</span></div>';
  }
  if (!isW && it.kind === 'skillbook' && id && !it.locked && !it.locked_by) {
    h += '<button class="bagB" data-tipact="useskillbook">学 习</button>';
  }
  /* ★★★ round411（用户："我没看到上锁的按钮在哪"）★★★
     ★ 之前放在 #bagRowUse 里 ✗ 那一排是故意藏起来的（display:none ✓）
       → 玩家永远看不到 ✓
     ★ 现在放进【格子浮窗】✗ 和 使用/卖给系统 并排 ✓
     ★ 锁住的也要显示（不然锁上以后就再也解锁不了了 ✓）*/
  if (id) {
    h += '<button class="bagB" data-tipact="lock">' +
      (it.locked ? '解 锁' : '上 锁') + '</button>';
  }
  if (sellable) {
    h += '<button class="bagB off" data-tipact="sell">卖给系统</button>';
    var _canStack = (typeof isStackItem === 'function') ? isStackItem(it) : !it.slot;
    /* ★★★ 自测当场抓到的 bug：拆函数时把 rec 留在了外面 ✗
       而这段代码在 bagTipBtnsHTML 里 ✗ 那里【没有 rec】（它是背包格的记录 ✓）
       → ReferenceError → 背包浮窗一画就抛错 ✗ 整个悬停都废了 ✓
       ★ 数从哪来：bagTipHTML 已经把"有几个"算好放在 seller.stack 里 ✓
         （那边有 rec ✗ 这边没有 ✓ 所以走参数 ✓）
       ★ 教训：拆函数时【只搬代码不搬变量】= 必然漏一个 ✗
         而且这种错只在"那条分支被执行到"时才炸 ✗ 很容易漏测 ✓ */
    var _have = Math.max(1, parseInt((seller && seller.stack) || 1, 10) || 1);
    h += '<button class="bagB off" data-tipact="mkt">挂交易所</button>' +
      '<input class="mktInput" data-tipprice="1" type="text" inputmode="numeric"' +
      ' placeholder="单价" maxlength="10" value="">';
    if (_canStack && _have > 1) {
      h += qtyHTML(_have, _have, 0);   /* 上架默认【全挂】✗ 单价等输入框填了再算 ✓ */
    }
  }
  h += '<button class="bagB" data-tipact="close">✕</button></div>';
  /* ★★ 价格框要【自动填系统收购价】✗ 自测抓到的：不填就点"挂交易所"
     会静默返回（mktList 里"先填一个价格"那句只 toast ✗ 看起来就是没反应 ✓）
     ★ 注意：这里只填【浮窗里那个输入框】✗ 不管 #bagMktPrice ✓
       真正点击时 bagTipBind 会把值搬过去 ✓（一条路 ✓）*/
  if (sellable && typeof sellQuote === 'function') {
    var _bid = id;
    sellQuote([_bid], function (total) {
      var b2 = document.getElementById('bagTipBox');
      if (!b2 || getComputedStyle(b2).display === 'none') { return; }
      var row2 = b2.querySelector('[data-tipfor="' + _bid + '"]');
      var inp = row2 ? row2.querySelector('input[data-tipprice]') : null;
      /* ★ 回来时可能已经换了另一格 ✗ 对一下再填 ✓（round301 的教训 ✓）*/
      if (inp && total > 0 && !inp.value) { inp.value = String(total); }
    });
  }
  return h;
}

/* 鼠标有没有停在浮窗上（★ true 时"离开格子"不许关窗 ✓）*/
var _mktScrollBusy = false;
var _mktTipHold = false;
var _mktTipTimer = null;

/* 手机：点一下格子 = 浮窗【停住】✗ 直到点按钮或点别处 ✓
   （★ 手机上没有 hover ✗ 不停住的话按钮根本点不到 ✓）*/
var _mktTipSticky = false;

function bagTipHold(on) {
  _mktTipHold = !!on;
  if (on && _mktTipTimer) { clearTimeout(_mktTipTimer); _mktTipTimer = null; }
}

/* 延时关窗（★ 给鼠标一点时间从格子挪到浮窗上 ✓）*/
function bagTipHideSoon(ms) {
  if (_mktTipHold || _mktTipSticky) { return; }
  if (_mktTipTimer) { clearTimeout(_mktTipTimer); }
  _mktTipTimer = setTimeout(function () {
    _mktTipTimer = null;
    if (!_mktTipHold && !_mktTipSticky) { bagTipHide(); }
  }, (ms === undefined) ? 180 : ms);
}

/* 停住（点格子时用 ✓ 顺便把鼠标那句免掉）*/
function bagTipStickyOn() {
  _mktTipSticky = true;
  if (_mktTipTimer) { clearTimeout(_mktTipTimer); _mktTipTimer = null; }
}

/* 滑条 / 数字框的双向同步 + 总价预览（★ 事件委托在浮窗上 ✗ 画一次绑一次 ✓）
   ★ 为什么两向都要同步：滑条拖不准（手机上尤其 ✓）✗ 数字框能精确填 ✓
     两边要是各管各的 ✗ 玩家会不知道最后按哪个走 ✓ */
function qtySync(e) {
  var box = document.getElementById('bagTipBox');
  if (!box) { return; }
  var row = e.target && e.target.parentNode;
  while (row && row !== box && !(row.className && String(row.className).indexOf('qtyRow') >= 0)) {
    row = row.parentNode;
  }
  if (!row || row === box) { return; }
  var mx = Math.max(1, parseInt(row.getAttribute('data-qtymax'), 10) || 1);
  var unit = parseFloat(row.getAttribute('data-qtyunit')) || 0;
  var rng = row.querySelector('.qtyRange');
  var num = row.querySelector('.qtyNum');
  var tot = row.querySelector('.qtyTotal');
  var v = parseInt((e.target === num ? num.value : rng.value), 10);
  if (isNaN(v)) { v = 1; }
  v = Math.max(1, Math.min(mx, v));
  if (rng) { rng.value = String(v); }
  if (num) { num.value = String(v); }
  if (tot) {
    /* ★ 单价还没填（背包上架那条 ✓）就先不显示总价 ✗ 免得显示"0 金币"误导 ✓ */
    var priceEl = box.querySelector('input[data-tipprice]');
    var up = unit || (priceEl ? parseFloat(String(priceEl.value).replace(/[^0-9]/g, '')) : 0);
    tot.textContent = (up > 0 && v > 1) ? ('共 ' + fmtGold(up * v) + ' 金币') : '';
  }
}

/* 浮窗里那些按钮的点击（★ 委托在浮窗上 ✗ 画一次绑一次 ✓ 幂等 ✓）*/
function bagTipBind() {
  var box = document.getElementById('bagTipBox');
  if (!box || box._ab) { return; }
  box._ab = true;
  box.onmouseenter = function () { bagTipHold(true); };
  box.onmouseleave = function () { bagTipHold(false); bagTipHideSoon(120); };
  /* ★ 点在浮窗里【别让 document 那个捕获监听关窗】✗ 也别冒泡到格子 ✓ */
  box.addEventListener('mousedown', function (e) { e.stopPropagation(); }, true);
  /* ★ 数量滑条：拖 / 填都要同步 + 算总价 ✓（'input' 两种控件都会触发 ✓）*/
  box.addEventListener('input', function (e) {
    /* ★ 只关心这三种：滑条 / 数量框 / 单价框 ✗ 别的输入（搜索框之类）别理 ✓ */
    var t = e.target;
    if (!t || !t.className) { return; }
    var cn = String(t.className);
    var isQty = (cn.indexOf('qtyRange') >= 0) || (cn.indexOf('qtyNum') >= 0);
    var isPrice = !!(t.getAttribute && t.getAttribute('data-tipprice'));
    if (!isQty && !isPrice) { return; }
    /* ★ 单价改了 → 总价那条要重算 ✗ 就借"滑条自己动一下"来触发 ✓
       （qtySync 里统一算总价 ✗ 只有一份算法 ✓）*/
    var box2 = document.getElementById('bagTipBox');
    var rng = (isQty && cn.indexOf('qtyRange') >= 0) ? t
      : (box2 ? box2.querySelector('.qtyRow .qtyRange') : null);
    if (rng) { qtySync({ target: rng }); }
  });
  box.onclick = function (e) {
    e.stopPropagation();
    var el = e.target;
    var act = el && el.getAttribute ? el.getAttribute('data-tipact') : null;
    if (!act) { return; }
    var row = el;
    while (row && row !== box && !(row.getAttribute && row.getAttribute('data-tipfor'))) {
      row = row.parentNode;
    }
    var id = row ? row.getAttribute('data-tipfor') : null;
    var kind = row ? row.getAttribute('data-tipacts') : 'bag';
    var it = (typeof MKT !== 'undefined' && row) ? row._it : null;
    if (act === 'close') { bagTipHide(); return; }
    if (!id) { return; }
    /* ★★ round304g：交易所那一套（购买 / 下架 / 取回）★★
       ★ 走的还是原来那两条路（mktBuy / mktUnlist）✗ 没有第二条实现 ✓ */
    if (kind === 'market') {
      /* ★★ 自测抓到的：原来这里是无条件先 bagTipHide() ✗
         而"点一行弹说明"和"点按钮做动作"走的是【同一个处理器】✓
         → 点头一下就把自己刚弹出的浮窗关掉了 ✗ 表现是"点了没反应"✓
         ★ 现在：只有真的点了【动作按钮】才关 ✗ 点别的地方（空白）不动它 ✓ */
      if (act === 'buy') {
        var qb = box.querySelector('.qtyRow .qtyRange');
        var nq = qb ? (parseInt(qb.value, 10) || 1) : 1;
        /* ★ 单价从【那一行】上读（mktTipShow 记的 ✓）✗ 不用 _it.__price（已清 ✓）*/
        var _rowEl = box._for;
        var _unit = (_rowEl && _rowEl._unit) || (it && it.__price) || 0;
        bagTipHide();
        mktBuy(+id, (it && it.name) || '物品', _unit, nq);
      }
      else if (act === 'unlist') { bagTipHide(); mktUnlist(+id, false); }
      else if (act === 'claim') { bagTipHide(); mktUnlist(+id, true); }
      return;
    }
    /* ★ 先把价格从浮窗那个输入框里读出来 ✗ 再交给"挂交易所"用 ✓
       （所以让 _priceEl 的 id 指向它也说得通：但我不改 id ✗
        而是把值【搬进】原来的 #bagMktPrice 再走原路 ✓ 一条路 ✓）*/
    if (act === 'mkt') {
      var src = box.querySelector('input[data-tipprice]');
      var dst = document.getElementById('bagMktPrice');
      if (dst && src) { dst.value = String(src.value || ''); }
      BAG.sel = id;                    /* 上架用的是"当前选中"✗ 这里对齐一下 ✓ */
      /* ★ round304o：滑条上选了几个就挂几个 ✓（没有滑条 = 1 ✓）*/
      var qr = box.querySelector('.qtyRow .qtyRange');
      BAG.mktQty = qr ? (parseInt(qr.value, 10) || 1) : 1;
      mktList();
      bagTipHide();
      return;
    }
    if (act === 'sell') { sellItems([id], false); bagTipHide(); return; }
    if (act === 'use') { bagEquip(id); bagTipHide(); return; }
    if (act === 'usefood') {
      /* ★ 2026-10-22：浮窗里直接吃喝（和详情区那个按钮走同一条路）*/
      var _uRec = null;
      for (var _ui2 = 0; _ui2 < (BAG.items || []).length; _ui2++) {
        if (String(BAG.items[_ui2].id) === String(id)) { _uRec = BAG.items[_ui2]; break; }
      }
      var _uMdl = (_uRec && _uRec.item && _uRec.item.model) || 'cup';
      try { wsSend('useitem', { iid: id }); } catch (eUF2) { }
      try { if (typeof eatStart === 'function') { eatStart(_uMdl); } } catch (eEF2) { }
      bagTipHide();
      return;
    }
    if (act === 'useskillbook') {
      var _bkId = null;
      for (var _bi = 0; _bi < (BAG.items || []).length; _bi++) {
        if (String(BAG.items[_bi].id) === String(id)) { _bkId = BAG.items[_bi].id; break; }
      }
      if (_bkId) { try { wsSend('useskillbook', { iid: _bkId }); } catch (e3) { } }
      bagTipHide();
      return;
    }
    if (act === 'useskin') {
      /* ★ round487：发 iid + key（服务器会核对这张卡真是他的、key 也对 ✓）
         ★ round505：按【浮窗这一格】的 id 找 ✗ 不再用 BAG.sel（可能是别的格子 ✓）*/
      var _skIt = null, _skId = null;
      for (var _i2 = 0; _i2 < (BAG.items || []).length; _i2++) {
        if (String(BAG.items[_i2].id) === String(id)) {
          _skIt = BAG.items[_i2].item; _skId = BAG.items[_i2].id; break;
        }
      }
      if (_skIt && _skIt.kind === 'skin' && _skIt.key) {
        /* ★ round598：已经解锁的皮肤，前端先拦一次（服务器仍会再校验）*/
        var _ownSkin = false;
        try {
          if (_skIt._unlocked !== undefined && _skIt._unlocked !== null) {
            _ownSkin = !!_skIt._unlocked;
          } else {
            for (var _oi = 0; _oi < (SKIN.items || []).length; _oi++) {
              if (SKIN.items[_oi].k === _skIt.key && SKIN.items[_oi].own) { _ownSkin = true; break; }
            }
          }
        } catch (eOwn) { }
        if (_ownSkin) {
          toast('这个皮肤已经解锁过了，不用再用卡');
          bagTipHide();
          return;
        }
        try { wsSend('useskin', { iid: _skId, key: _skIt.key }); } catch (e2) { }
        /* ★ round597：先本地扣 1 张，卡片立刻消失/减数量；服务器 bagrefresh 会再校准 */
        try {
          for (var _si3 = 0; _si3 < (BAG.items || []).length; _si3++) {
            if (String(BAG.items[_si3].id) === String(_skId)) {
              if ((BAG.items[_si3].stack || 1) > 1) { BAG.items[_si3].stack -= 1; }
              else { BAG.items.splice(_si3, 1); }
              break;
            }
          }
          if (String(BAG.sel) === String(_skId)) { BAG.sel = null; }
          bagRender();
        } catch (eBag3) { }
        /* ★ round504：解锁完了要【告诉玩家下一步去哪换】✗ 不然以为只是解锁 ✓ */
        toast('正在解锁「' + ((_skIt.n || _skIt.key)) + '」…');
      }
      bagTipHide();
      return;
    }
    if (act === 'off') { bagUnequip(); bagTipHide(); return; }
    /* ★★★ round411（用户："我没看到上锁的按钮在哪"）★★★
       ★ 病根：round410 我把按钮加进了 #bagRowUse ✗
         而那一排是 round304f【故意藏起来】的（display:none ✗ 只给程序读状态 ✓）
         → 按钮确实存在、但玩家永远看不见 ✓✓ 一字不差
       ★ 现在：加进【格子浮窗】这一排 ✗ 玩家点/悬停格子就看得到 ✓
       ★ 同一个按钮两态：上 锁 / 解 锁 ✓ 再点一次解锁 ✓ */
    if (act === 'lock') {
      /* ★ 背包格子上没有 row._it（那是交易所那些行才挂的 ✓）
           所以以 BAG.items 为准 ✗ 读不到才退回 row._it ✓ */
      var _cur = false;
      var _found = false;
      for (var _i2 = 0; _i2 < (BAG.items || []).length; _i2++) {
        if (String(BAG.items[_i2].id) === String(id)) {
          _cur = !!(BAG.items[_i2].item || {}).locked;
          _found = true;
          break;
        }
      }
      if (!_found && it && typeof it === 'object') { _cur = !!it.locked; }
      BAG.msg = _cur ? '正在解锁…' : '正在上锁…';
      wsSend('baglock', { iid: id, lock: _cur ? 0 : 1 });
      bagTipHide();
      return;
    }
  };
}
function bagTipHide() {
  var box = document.getElementById('bagTipBox');
  if (box) { box.style.display = 'none'; }
  /* ★ 顺手清掉"停住"和"鼠标在上面"✗ 不然下一次划过格子行为会很怪 ✓ */
  _mktTipSticky = false;
  _mktTipHold = false;
  if (_mktTipTimer) { clearTimeout(_mktTipTimer); _mktTipTimer = null; }
}

/* ★ 第 67 轮：按【部位】决定发哪条装备消息（防具走 equiparmor ✓）*/
function itemSlotOf(id) {
  /* ★★★ 第 100 轮修的真 bug★★★
     用户报：防具无法穿戴，提示“这不是武器”
     根因：这里原来是【严格比较】：BAG.items[i].id === id ✗
       服务器给的 id 是数字 ✓   DOM 上 data-id 拿来的是字符串 ✓
       → 永远不相等 ✗ → 找不到部位 → 兜底返回 'weapon' ✗
       → 于是防具也被当成武器发出去 → 服务器回“这不是武器”✗
     修：两边都转字符串再比 ✓（数字/字符串混用是 JS 的经典坑 ✗）*/
  for (var i = 0; i < BAG.items.length; i++) {
    if (String(BAG.items[i].id) === String(id)) {
      return (BAG.items[i].item || {}).slot || 'weapon';
    }
  }
  return 'weapon';
}
function bagEquip(id) {
  if (!NET.on || !WSC.ready) { return; }
  if (BAG.busy) { return; }
  BAG.busy = true;
  BAG.msg = '正在穿上…';
  bagRender();
  /* ★ 第 67 轮：按【部位】决定发哪条消息（防具走 equiparmor ✓）*/
  var _slot = itemSlotOf(id);
  var _mtype = (_slot === 'armor') ? 'equiparmor' : 'equip';
  BAG.msg = (_slot === 'armor') ? '正在穿上防具…' : '正在穿上…';
  if (!wsSend(_mtype, { itemId: id })) { BAG.busy = false; BAG.msg = '没连上服务器'; bagRender(); return; }
  // ★ 服务器的回执走 ws（notice + weapon 消息）→ 这里稍等一下重新拉一次 ✓
  bagAfterEquip();
}

/* ★ 第 68 轮：点防具槽 = 脱下防具 ✓（和武器槽一个手感 ✓）*/
function bagUnequipArmor() {
  if (!NET.on || !WSC.ready || BAG.busy) { return; }
  if (!BAG.armor) { return; }
  BAG.busy = true;
  BAG.msg = '正在脱下防具…';
  bagRender();
  if (!wsSend('unequiparmor', {})) {
    BAG.busy = false; BAG.msg = '没连上服务器'; bagRender(); return;
  }
  bagAfterEquip();
}

function bagUnequip() {
  if (!NET.on || !WSC.ready || BAG.busy) { return; }
  BAG.busy = true;
  BAG.msg = '正在脱下…';
  bagRender();
  /* ★ 第 67 轮：防具走 unequiparmor ✓ */
  var _slot2 = BAG.sel ? itemSlotOf(BAG.sel) : 'weapon';
  if (!wsSend(_slot2 === 'armor' ? 'unequiparmor' : 'unequip', {})) {
    BAG.busy = false; BAG.msg = '没连上服务器'; bagRender(); return;
  }
  bagAfterEquip();
}

function bindBag() {
  /* ★★ 第 51 轮踩的坑：提示框一定要挂到 <body> 下 ★★
     设置面板上有 backdrop-filter: blur() —— 按 CSS 规范，它会给 position:fixed 的
     子元素【另建一个包含块】✗ 于是我在 JS 里按"视口坐标"算的 left/top 全错位，
     提示框被挤到面板外面、还被裁掉 ✗
     → 把它 appendChild 到 body 下，fixed 才真的是相对视口 ✓ */
  var tip = document.getElementById('bagTipBox');
  if (tip && tip.parentNode !== document.body) { document.body.appendChild(tip); }
  bagTipBind();      /* ★ round304f：浮窗里那排动作按钮（幂等 ✓ 只绑一次 ✓）*/
  /* ★ 第 56 轮（用户第 6 条）：点别的地方要自动关掉介绍框 ✓
     用捕获阶段监听 document —— 点格子之外任何地方（包括面板外）都收起来 ✓
     ★ 点格子本身不关（mousemove 会重新弹出来 ✓）*/
  if (!window.__bagTipDoc) {
    window.__bagTipDoc = true;
    document.addEventListener('mousedown', function (e) {
      var el = e.target;
      while (el) {
        if (el.id === 'bagTipBox') { return; }        // 点在介绍框里 → 不管 ✓
        if (el.className && String(el.className).indexOf('slot') >= 0) { return; }  // 点在格子上 → 由格子逻辑管 ✓
        el = el.parentNode;
      }
      bagTipHide();
    }, true);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { bagTipHide(); }
    });
  }
  /* ★★★ round304v（用户："批量出售时可以滑动多选，像手机图库删除照片一样"）★★★
     做法：按住不放划过格子 = 一路勾上（图库那套 ✓）
       · 按下时记住"这一笔是【勾】还是【取消】"✗ 一路按同一个动作走 ✓
         （从已勾的开始划 = 一路取消 ⚠ 这样手滑了也能划回去 ✓）
       · 鼠标松开 / 手指抬起 → 结束这一笔 ✓
       · 不阻止默认行为：不然页面滚不动（手机上很关键 ✓）
     ★ 为什么要它：一个一个点 ✗ 卖 50 件材料要点 50 下 ✓ 用户说得对 ✓ */
  /* ★★ 严重 bug（我自己造的 ✗ 导致整个游戏启动失败）★★
     这一段原来直接用 bagRender() 里的局部变量 grid ✗
       → 别的函数里引用它 = ReferenceError: grid is not defined ✓
       → 而这个函数会在【首次渲染背包】时被调用 ✓
       → 于是启动失败卡在"正在载入资源…"✓（用户报的就是这个 ✓）
     ★ 教训：往一个已经很大的文件里插代码 ✗ 先确认【那个变量在这个作用域里存不存在】✓
       我当时的"验证"只查了函数声明顺序（那个确实没问题 ✓）
       却没查变量作用域 ✗ 而这次的错误刚好就出在作用域上 ✓
     ★ 现在：自己取元素 ✗ 而且只绑一次 ✓ */
  var grid = document.getElementById('bagGrid');
  var _drag = null;                  /* {on:true/false} = 这一笔是勾还是取消 ✓ */
  var _dragSlot = function (node) {
    var el = node;
    while (el && el !== grid && !(el.getAttribute && el.getAttribute('data-id'))) { el = el.parentNode; }
    if (!el || el === grid || !el.getAttribute) { return null; }
    return el;
  };
  var _dragApply = function (el) {
    if (!_drag || !el) { return; }
    var id = el.getAttribute('data-id');
    if (!id || el._dragDone === _drag) { return; }   /* 同一格不重复处理 ✓ */
    el._dragDone = _drag;
    var has = bagPickHas(id);
    if (_drag.on && !has) {
      if ((BAG.pick || []).length >= 100) { toast('一次最多勾 100 件'); return; }
      /* ★ round410：锁住的不能勾进批量出售 ✗ 免得勾完才发现卖不掉 ✓ */
      for (var _lk = 0; _lk < (BAG.items || []).length; _lk++) {
        if (String(BAG.items[_lk].id) === String(id)) {
          if ((BAG.items[_lk].item || {}).locked) {
            toast('这件锁住了，先解锁');
            return;
          }
          break;
        }
      }
      BAG.pick.push(id);
    } else if (!_drag.on && has) {
      for (var k = 0; k < (BAG.pick || []).length; k++) {
        if (String(BAG.pick[k]) === String(id)) { BAG.pick.splice(k, 1); break; }
      }
    } else {
      return;                                        /* 状态没变 ✗ 不用重画 ✓ */
    }
    BAG.msg = '';
    bagRender();
  };
  var _dragEnd = function () {
    _drag = null;
    var all = grid ? grid.querySelectorAll('.slot') : [];
    for (var i = 0; i < all.length; i++) { all[i]._dragDone = null; }
  };
  if (grid && !grid._dragBound) {
    grid._dragBound = true;
    grid.addEventListener('mousedown', function (e) {
      if (!BAG.multi) { return; }
      var el = _dragSlot(e.target);
      if (!el) { return; }
      _drag = { on: !bagPickHas(el.getAttribute('data-id')) };
      _dragApply(el);
    });
    grid.addEventListener('mouseover', function (e) {
      if (!_drag) { return; }
      _dragApply(_dragSlot(e.target));
    });
    /* 松手可能在棋盘外面 ✗ 所以挂在 window 上 ✓ */
    window.addEventListener('mouseup', _dragEnd);
    /* 手机上：touchmove 要 preventDefault 才不会一边滚一边勾 ✗
       但那样就滚不动列表了 ✓ → 用【长按 250ms 才进入滑动多选】两全 ✓ */
    var _tTimer = null;
    grid.addEventListener('touchstart', function (e) {
      if (!BAG.multi) { return; }
      var el = _dragSlot(e.target);
      if (!el) { return; }
      var t = (e.touches && e.touches[0]) || {};
      _tTimer = setTimeout(function () {
        _tTimer = null;
        _drag = { on: !bagPickHas(el.getAttribute('data-id')) };
        _dragApply(el);
        if (navigator.vibrate) { try { navigator.vibrate(15); } catch (x) { } }
      }, 250);
    }, { passive: true });
    grid.addEventListener('touchmove', function (e) {
      if (_tTimer) { clearTimeout(_tTimer); _tTimer = null; }
      if (!_drag) { return; }                     /* 没进多选就让它正常滚动 ✓ */
      if (e.cancelable) { e.preventDefault(); }   /* 进了多选就别滚了 ✓ */
      var t = (e.touches && e.touches[0]) || null;
      if (t) { _dragApply(_dragSlot(document.elementFromPoint(t.clientX, t.clientY))); }
    }, { passive: false });
    grid.addEventListener('touchend', function () {
      if (_tTimer) { clearTimeout(_tTimer); _tTimer = null; }
      _dragEnd();
    }, { passive: true });
  }
  if (grid) {
    grid.onclick = function (e) {
      var el = e.target;
      while (el && el !== grid && !(el.getAttribute && el.getAttribute('data-id'))) { el = el.parentNode; }
      if (!el || el === grid || !el.getAttribute) { return; }
      /* ★ 滑动多选的那一笔已经处理过了 ✗ 别在 click 里再翻一次 ✓
         （不然划过去=勾上 ✗ 松手时 click 又把它取消 ✓ 表现就是"划不动"✓）*/
      if (el._dragDone) { el._dragDone = null; return; }
      /* round303: 批量模式下点格子 = 勾选/取消勾选 ✗ 不再走"选中看数值" ✓
         （两种模式分开 ✗ 免得手滑一下既勾了又换了选中 ✓）*/
      if (BAG.multi) {
        var _id = el.getAttribute('data-id');
        var _hit = -1;
        for (var _k = 0; _k < (BAG.pick || []).length; _k++) {
          if (String(BAG.pick[_k]) === String(_id)) { _hit = _k; break; }
        }
        if (_hit >= 0) { BAG.pick.splice(_hit, 1); }
        else {
          /* 一次最多 100 件（和服务端一致 ✓ 到顶了就直接说 ✓ 不然白勾 ✓）*/
          if ((BAG.pick || []).length >= 100) { toast('一次最多勾 100 件'); }
          else { BAG.pick.push(_id); }
        }
        BAG.msg = '';
        bagRender();
        return;
      }
      /* ★ 第 54 轮（用户要求）：点武器 = 【选中】它（面板显示它的数值 ✓）
         真正穿上要再按【使用】按钮 ✓ —— 免得手一滑就换了装备 ✗
         ★ 材料只选中看一眼，不参与穿 ✓ */
      BAG.sel = el.getAttribute('data-id');
      BAG.msg = '';
      bagRender();
    };
    grid.onmousemove = function (e) {
      /* ★ round304f：鼠标或手指【回到格子上】就取消"准备关"✗ 浮窗继续留着 ✓
         为什么需要：鼠标从格子挪到浮窗的路上会经过别的格子 ✗
           没有这一句的话，路上每停一下都会重画浮窗（闪）✓ */
      bagTipHold(false);
      if (_mktTipTimer) { clearTimeout(_mktTipTimer); _mktTipTimer = null; }
      var el = e.target;
      while (el && el !== grid && !(el.getAttribute && el.getAttribute('data-id'))) { el = el.parentNode; }
      if (!el || el === grid || !el.getAttribute) { bagTipHideSoon(120); return; }
      /* ★★ round534（用户："批量选择时不要弹悬浮窗，会影响点选"）
         → 批量模式下一律不弹 ✓ */
      if (BAG.multi) { bagTipHide(); return; }
      bagTipAt(e, el);
    };
    /* ★ 离开整个格子区 → 延时关 ✗ 不再"立刻关" ✓
       为什么：鼠标要能挪到浮窗上点按钮 ✗ 立刻关就永远点不到 ✓ */
    grid.onmouseleave = function () { bagTipHideSoon(200); };
    /* ★ 手机：点一下格子 = 浮窗停住（★ 没有 hover ✗ 这是手机唯一能点到按钮的路 ✓）
       ★ 用 touchstart 而不是 click ✗ 因为 click 太晚（组件里别的处理器也吃它 ✓）
       ★ preventDefault 不能加：加了格子那个"选中"就没了 ✓ */
    grid.addEventListener('touchstart', function (e) {
      var el = e.target;
      while (el && el !== grid && !(el.getAttribute && el.getAttribute('data-id'))) { el = el.parentNode; }
      if (!el || el === grid || !el.getAttribute) { return; }
      if (BAG.multi) { bagTipHide(); return; }     /* ★ 批量模式：不弹浮窗 ✓ */
      bagTipStickyOn();
      var t = (e.touches && e.touches[0]) || e;
      bagTipAt({ clientX: t.clientX, clientY: t.clientY }, el);
    }, { passive: true });
  }
  /* ★ 使用 / 脱下 按钮（第 54 轮 用户要求：点武器出现"使用"，穿上后变"脱下"）*/
  var useBtn = document.getElementById('bagUse');
  if (useBtn) {
    useBtn.onclick = function (e) {
      if (e) { e.preventDefault(); }
      var act = useBtn.getAttribute('data-act');
      if (act === 'use' && BAG.sel) { bagEquip(BAG.sel); }
      else if (act === 'usefood' && BAG.sel) {
        var _rec = null;
        for (var _bi = 0; _bi < BAG.items.length; _bi++) { if (String(BAG.items[_bi].id) === String(BAG.sel)) { _rec = BAG.items[_bi]; break; } }
        var _mdl = (_rec && _rec.item && _rec.item.model) || 'cup';
        try { wsSend('useitem', { iid: BAG.sel }); } catch (eUF) { }
        try { if (typeof eatStart === 'function') { eatStart(_mdl); } } catch (eEF) { }
      }
      else if (act === 'off') { bagUnequip(); }
    };
  }
  /* round303: 批量选择的开关 + 批量出售（用户要求 ✓）
     ★ 退出批量时把勾全清掉 ✗ 不然下次进来还留着上次的勾 ✓ 会误卖 ✓ */
  var pickBtn = document.getElementById('bagPick');
  if (pickBtn) {
    pickBtn.onclick = function (e) {
      if (e) { e.preventDefault(); }
      BAG.multi = !BAG.multi;
      if (!BAG.multi) { BAG.pick = []; }
      try { bagTipHide(); } catch (e0) { }   /* ★ round534：进批量先关浮窗 ✓ */
      BAG.msg = '';
      bagRender();
    };
  }
  var multiBtn = document.getElementById('bagSellMulti');
  if (multiBtn) {
    multiBtn.onclick = function (e) {
      if (e) { e.preventDefault(); }
      if (BAG.busy) { return; }
      bagSellBatch();
    };
  }
  // 点装备槽 = 脱下（MC 那种"点一下就摘"✓）
  var eqs = document.getElementById('bagEqSlot');
  if (eqs) {
    eqs.onclick = function (e) {
      if (e) { e.preventDefault(); }
      /* ★★ 第 231 轮（用户要求）：点已装备的格子【不要卸下】★★
         要卸下只能点明确的"脱下"按钮 ✗
         为什么：已装备的格子和背包格子长得很像 ✗
           手一抖点一下就脱了 ✓ 挂机时更容易误触 ✓
         ★ 这里直接 return ✗ 什么也不做 ✓
           （下面那两条才是真正的卸下入口：
             防具 wsSend('unequiparmor') · 武器 wsSend('unequip') ✓）*/
      if (eqs.getAttribute('data-w') === '1') { return; }
      if (eqs.getAttribute('data-w') !== '1') { return; }
      bagUnequip();
    };
    eqs.onmousemove = function (e) {
      var box = document.getElementById('bagTipBox');
      var w = BAG.weapon;
      if (!box || !w) { bagTipHide(); return; }
      var m6 = wMastery(w);
      var lv6 = (WSC.role && WSC.role.level) || 1;
      box.innerHTML = '<b style="color:' + tierHex(w.tier || 0) + '">' + (w.name || '?') + '</b>' +
        '<i> · ' + ((w.tier || 0) + 1) + ' 阶 · 已装备' +
        (w.broken ? ' · 已损坏' : '') +
        ((+w.durMax > 0) ? (' · 耐久 ' +
          ((typeof w.dur === 'number') ? w.dur : w.durMax) +
          ' / ' + w.durMax) : '') + '</i>' +
        (m6 < 1 ? ('<i> · 建议 ' + (w.reqLevel || 1) + ' 级（你 ' + lv6 + ' 级）· 发挥 ' +
                   Math.round(m6 * 100) + '%</i>') : '') + '<br>实际每击 <b>' +
        wRealHit(w).toFixed(0) + '</b> · 每秒 <b>' + wRealDps(w).toFixed(0) + '</b><br>' +
        '<i>武器强度 ' + wStrength(w).toFixed(0) + ' · 点一下脱下</i>';
      box.style.display = 'block';
      box.style.left = Math.min(window.innerWidth - 240, e.clientX + 14) + 'px';
      box.style.top = Math.min(window.innerHeight - 70, e.clientY + 12) + 'px';
    };
    eqs.onmouseleave = bagTipHide;
  }
  // ★ 快捷键 B：打开菜单并停在背包页
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'b' && e.key !== 'B') { return; }
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') { return; }
    var panel = document.getElementById('setPanel');
    if (panel && panel.style.display === 'block') { closeSet(); return; }
    openSet('bag');
  });
}

/* ---------- bindSet ---------- */
function bindSet() {
  /* ★ 第 56 轮（用户第 2 条）：右上角统一的 X（不再只有"信息"页里有关闭 ✗）*/
  var xbtn = document.getElementById('setX');
  if (xbtn) { xbtn.onclick = function (e) { if (e) { e.preventDefault(); } closeSet(); }; }
  // Esc 也能关（顺便收掉介绍框 ✓）
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') { return; }
    bagTipHide();
    var panel = document.getElementById('setPanel');
    if (panel && panel.style.display === 'block') { closeSet(); }
  });
  var b = document.getElementById('setBtn');
  if (b) { var op = function (e) { if (e) { e.preventDefault(); } openSet(); }; b.addEventListener('touchstart', op, { passive: false }); b.addEventListener('click', op); }
  var c = document.getElementById('setClose');
  if (c) { var cl = function (e) { if (e) { e.preventDefault(); } closeSet(); }; c.addEventListener('touchstart', cl, { passive: false }); c.addEventListener('click', cl); }
  /* ★ 分类导航：点一下切一页（第 31 轮）✓ 顺便记住停在哪儿 ✓ */
  var tabs = document.querySelectorAll('#setTabs .tab');
  for (var ti = 0; ti < tabs.length; ti++) {
    (function (tab) {
      var go = function (e) {
        if (e) { e.preventDefault(); }
        setTab(tab.getAttribute('data-tab'));
        saveSet();
      };
      tab.addEventListener('touchstart', go, { passive: false });
      tab.addEventListener('click', go);
    })(tabs[ti]);
  }
  var r = document.getElementById('setReset');
  if (r) {
    var rs = function (e) {
      if (e) { e.preventDefault(); }
      SETCFG = { v: SETCFG_VER, dpr: SET_DEF.dpr, aa: SET_DEF.aa, detail: SET_DEF.detail,
                 showFps: true, mobDmg: true, atkSize: SET_DEF.atkSize, setTab: SET_DEF.setTab };
      saveSet(); applySet(); openSet();
    };
    r.addEventListener('touchstart', rs, { passive: false }); r.addEventListener('click', rs);
  }
}

/* ---------- toast ---------- */
/* ============================================================================
   ★★★ 第 248 轮（用户要求）：弹幕滚动通知 ★★★

   要求原文："系统通知的方式改成向左移动滚动通知，像弹幕一样，做一下边框"
   参数（和用户确认过的）：
     · 单行 26px 高 ✗ 字 12.5px ✗ 速度 110 像素/秒 ✓
     · 排队 > 5 条 → 开两行（两条同时滚 ✗ 消化速度翻倍 ✗ 不用变速 ✓）
     · 排队 <= 2 条 → 收回单行（★ 迟滞 ✗ 不然会在单双行之间反复跳 ✓）
     · 队列上限 10 条 ✗ 超了丢最旧的（挂机一晚上回来不会滚半小时 ✓）
     · 每行时长 = (文字宽 + 屏宽) ÷ 速度 → 短 4.5 秒 ✗ 长 7 秒 ✓
     · 五类配色：升级 金 / 击杀 红 / 高阶装备 紫 / 魔气 橙 / 系统 蓝 ✓
   ★ 普通提示（toast）会跟着它下移 ✗ 两者永不重叠 ✓
   ============================================================================ */
var TK = {
  on: false,              /* 条子是否已经出现 ✓ */
  rows: 1,                /* 当前几行（1 或 2 ✓） */
  q: [],                  /* 等着的（最多 10 条 ✓） */
  lane: [null, null]      /* 两条轨道各自的当前消息 + 进度 ✓ */
};
var TK_SPEED = 110;       /* 像素/秒（固定 ✗ 长句子不会滚得更快 ✓） */
var TK_MAXQ = 10;
var TK_TWO_AT = 5;        /* 排队超过它 → 开两行 ✓ */
var TK_ONE_AT = 2;        /* 排队降到它 → 收回单行 ✓（迟滞 ✓） */

function tkEl() {
  var e = document.getElementById('ticker');
  if (!e) {
    e = document.createElement('div');
    e.id = 'ticker';
    e.className = 'off';
    e.innerHTML = '<div class="tkrow"><div class="tk"></div></div>' +
                  '<div class="tkrow"><div class="tk"></div></div>';
    document.body.appendChild(e);
  }
  return e;
}

/* ★ 弹幕条高度变了 → 顺手把普通提示挪下去 ✗ 不让它们重叠 ✓ */
function tkSyncToastTop() {
  var e = document.getElementById('ticker');
  var h = (e && !e.classList.contains('off')) ? e.offsetHeight : 0;
  var top = tkToastTop();                   /* ★ 现算（62 + 弹幕高 + 8 ✓）*/
  var te = document.getElementById('_toastEl');
  if (window._toastElRef) { te = window._toastElRef; }
  if (te) { te.style.top = top + 'px'; }
  window._toastTop = top;                   /* 给 toast() 用 ✓ */
  return top;
}

/* ★ 第 248 轮修补：给 toast 现算位置（弹幕条多高就往下让多少 ✓）
   为什么不复用 tkSyncToastTop 的返回值：那个是"上次同步时"的值 ✗
   弹幕条切行以后就过期了 ✓ 实测踩到过一次重叠 ✓ */
function tkToastTop() {
  var e = document.getElementById('ticker');
  var h = (e && !e.classList.contains('off')) ? e.offsetHeight : 0;
  return 62 + h + 8;
}


function tkPush(text, kind) {
  if (!text) { return; }
  if (TK.q.length >= TK_MAXQ) { TK.q.shift(); }   /* 满了丢最旧的 ✓ 永远留最新 ✓ */
  TK.q.push({ t: String(text), k: kind || 'sys' });
  tkMaybeRows();
  if (!TK.on) { tkStart(); }
}

function tkMaybeRows() {
  var e = tkEl();
  var want = TK.rows;
  if (TK.rows === 1 && TK.q.length > TK_TWO_AT) { want = 2; }
  else if (TK.rows === 2 && TK.q.length <= TK_ONE_AT) { want = 1; }
  if (want !== TK.rows) {
    TK.rows = want;
    e.classList.toggle('two', want === 2);
    e.style.height = (want === 2 ? 52 : 26) + 'px';
    tkSyncToastTop();
  }
}

function tkStart() {
  var e = tkEl();
  TK.on = true;
  e.classList.remove('off');
  e.style.height = (TK.rows === 2 ? 52 : 26) + 'px';
  tkSyncToastTop();
  tkTick(true);
}

/* 每条消息一行轨道各自滚 ✓ 滚完了取队列里的下一条 ✓ */
function tkTick(first) {
  var e = tkEl();
  var rows = e.querySelectorAll('.tkrow');
  var W = window.innerWidth;
  var now = Date.now();
  var busy = false;
  for (var i = 0; i < TK.rows; i++) {
    var lane = TK.lane[i];
    var el = rows[i] ? rows[i].querySelector('.tk') : null;
    if (!el) { continue; }
    if (!lane) {
      var nx = TK.q.shift();
      if (!nx) { el.textContent = ''; el.style.transform = ''; continue; }
      el.className = 'tk tk-' + nx.k;
      el.textContent = nx.t;
      /* ★ 先量宽度再算总路程 ✗ 长句子只影响时长 ✗ 不影响速度 ✓ */
      var w = el.offsetWidth || 200;
      lane = TK.lane[i] = { x: W + 10, w: w, end: -(w + 20) };
      el.style.transform = 'translateX(' + lane.x + 'px)';
    }
    var dt = first ? 0 : Math.min(0.1, (now - (TK.last || now)) / 1000);
    lane.x -= TK_SPEED * dt;
    el.style.transform = 'translateX(' + lane.x.toFixed(1) + 'px)';
    if (lane.x <= lane.end) { TK.lane[i] = null; }     /* 滚完了 ✗ 下一帧取新的 ✓ */
    busy = true;
  }
  TK.last = now;
  tkMaybeRows();
  /* ★ 第 259 轮修 bug（用户："滚动条消息播放后，没有内容了很久才消失"）
     病根：只有"显示"（remove off）✗ 从来没有"隐藏"（add off）✓
     → 消息滚完之后条子还空着挂在那里 ✓ 用户看到的就是"没内容但一直不消失"✓
     ★ 修：队列空 + 两条轨道都空 → 收起来并停掉 rAF ✓ */
  var _empty = (TK.q.length === 0 && !TK.lane[0] && !TK.lane[1]);
  if (_empty && TK.on) {
    TK.on = false;
    var _e2 = document.getElementById("ticker");
    if (_e2) { _e2.classList.add("off"); }
    tkSyncToastTop();
    return;                          /* ★ 停掉 rAF ✗ 不再空转 ✓ */
  }
  if (TK.on) { requestAnimationFrame(function () { tkTick(false); }); }
}


/* ★★★ 2026-10-23（用户："系统通知改成固定的半透明框，文字向上滚动"）★★★
   ★ 和弹幕 / 聊天滚屏【不是一回事】：这个只放"捡到什么 / 加了多少金币"这类即时反馈 ✓
   ★ 三个要求：
     ① 框固定不动 ✗ 只有里面的行往上滚 ✓
     ② 没通知时完全隐藏（连底板一起 ✗ 不留半透明块 ✓）
     ③ 键位模式下可以拖动改位置 ✗ 菜单里能调字号 ✓
   ★ 性能：和飘字一样走【复用池】✗ 不 new div ✓
       行元素预建 6 个循环用 ✓ 超出上限就把最老那行淡出收回池子 ✓
*/
var SYSMSG = {
  el: null,        /* 外框 */
  rowsBox: null,   /* 里面装行的容器 */
  live: [],        /* 正在显示的行元素（newest 在末尾）*/
  pool: [],        /* 回收池 */
  t: null,         /* 自动隐藏计时器 */
  MAX: 6,          /* 最多同时显示几行 */
  SIZE: 11,        /* 字号（菜单可调）*/
  W: 136,          /* ★ 2026-10-23（用户）：宽度可调 */
  H: 134           /* ★ 高度可调 */
};
var SYSMSG_SIZES = [10, 11, 12, 13.5];   /* 小 / 标准 / 大 / 特大（2026-10-23 整体缩小）*/

/* ★★★ 2026-10-23（用户："为什么没有字体颜色，要跟网页版一样"）★★★
   ★ 病根：预览页的颜色是 CSS 规则给的（.pA .row b{color:#ffd83d}）✗
     游戏里我只写了内联 color ✓ 没有这条规则 → <b> 跟着继承父色 → 全是一个颜色 ✓
   → 这里把预览页那套 CSS 真正注入进来 ✓（用 id 防重复）*/
(function sysMsgStyles() {
  if (document.getElementById('sysMsgCSS')) { return; }
  var st = document.createElement('style');
  st.id = 'sysMsgCSS';
  st.textContent = `
  /* ★ 2026-10-23（用户："不够显示就换行"）nowrap → normal，去掉省略号 ✓ */
  #sysMsgBox .row{white-space:normal;word-break:break-all;overflow-wrap:anywhere;
    padding:0 10px;line-height:1.75;color:#b9c6d2;text-align:left;
    text-shadow:0 1px 2px rgba(0,0,0,.9);
    transition:opacity .3s ease,transform .3s ease}
  /* A 版彩色标签（和预览页一字不差 ✓）*/
  #sysMsgBox .row b{color:#ffd83d;font-weight:800}
  /* ★ 2026-10-23：按类型分色（经验蓝 / 金币金 / 突破紫 / 皮肤粉 / 警告红）*/
  #sysMsgBox .row b.c-exp{color:#6fb8ff}
  #sysMsgBox .row b.c-gold{color:#ffd83d}
  #sysMsgBox .row b.c-lv{color:#c79bff}
  #sysMsgBox .row b.c-skin{color:#ff8ad8}
  #sysMsgBox .row b.c-bad{color:#ff7a6a}
  #sysMsgBox .row i{color:#8ee0ff;font-style:normal;font-weight:700}
  #sysMsgBox .row.g b{color:#ffcf3a}
  #sysMsgBox .row.it b{color:#8ee0ff}
  #sysMsgBox .row.ex b{color:#b8ff8a}
  `;
  document.head.appendChild(st);
})();

function sysMsgEl() {
  if (SYSMSG.el) { return SYSMSG.el; }
  /* 读回上次设的字号 ✓ */
  /* ★ 2026-10-23：优先用 SETCFG 里那份（和其它设置一起存档 ✓）再退回 localStorage */
  try {
    var _sm = (typeof SETCFG !== 'undefined' && SETCFG && SETCFG.sysMsg) || null;
    var _sz, _w, _hh;
    if (_sm) { _sz = +_sm.f; _w = +_sm.w; _hh = +_sm.h; }
    if (!(_sz > 8 && _sz < 22)) { _sz = parseFloat(localStorage.getItem('sysMsgSize') || ''); }
    if (!(_w >= 90 && _w <= 420)) { _w = parseInt(localStorage.getItem('sysMsgW') || '', 10); }
    if (!(_hh >= 40 && _hh <= 360)) { _hh = parseInt(localStorage.getItem('sysMsgH') || '', 10); }
    if (_sz > 8 && _sz < 22) { SYSMSG.SIZE = _sz; }
    if (_w >= 90 && _w <= 420) { SYSMSG.W = _w; }
    if (_hh >= 40 && _hh <= 360) { SYSMSG.H = _hh; }
  } catch (e0) { }
  var b = document.createElement('div');
  b.id = 'sysMsgBox';
  /* ★ 2026-10-23（用户："不是让你固定大小吗"）
     高度按【最大行数】算死 ✗ 不随内容伸缩 ✓
     行少的时候框也保持这个高度（文字贴着底部往上排 ✓）*/
  b.style.cssText =
    /* ★ 2026-10-23（用户："位置默认调整到左边靠边"）*/
    'position:fixed;left:16px;top:' + Math.round(Math.max(240, (typeof innerHeight === 'number' ? innerHeight : 600)) * 0.16) + 'px;transform:none;' +
    'width:' + SYSMSG.W + 'px;height:' + SYSMSG.H + 'px;box-sizing:border-box;' +
    'padding:0;pointer-events:none;z-index:50;' +   /* ★ 2026-10-23：压到菜单(60)下面 ✗ 不挡菜单 ✓ */
    /* ★★★ 2026-10-23（用户选：版 1 · 无框文字条）★★★
       不要边框、不要圆角、不要投影 ✗ 只有一条【左右渐隐】的半透明底 ✓
       → 存在感最低、最不挡画面 ✓ */
    'background:linear-gradient(90deg,' +
    'rgba(8,11,14,0) 0%,rgba(8,11,14,.52) 18%,' +
    'rgba(8,11,14,.52) 82%,rgba(8,11,14,0) 100%);' +
    /* 上下渐隐遮罩：文字从框边淡出 ✓ */
    /* ★ 2026-10-23：遮罩收窄 ✗ 原来上下各 10% 会让第一/最后一行变淡甚至看不见 ✓ */
    '-webkit-mask-image:linear-gradient(180deg,transparent 0,#000 5%,#000 95%,transparent 100%);' +
    'mask-image:linear-gradient(180deg,transparent 0,#000 5%,#000 95%,transparent 100%);' +
    'overflow:hidden;opacity:0;display:none;transition:opacity .22s ease';
  /* ★★★ 2026-10-23（用户："滚动字也加上，我现在什么也看不到"）★★★
     ★ 病根：行容器 absolute + bottom:0 ✗ 但没有【高度】和【上边】✗
       → 内容从 bottom 往下长 ✗ 直接溢出到框外 → 被 overflow:hidden 裁掉 ✓
       （实测：框 103~237，第一行文字 top=217 已经贴底，第二行就直接出框了 ✓）
     ★ 修：容器铺满整个框（top:0;bottom:0）✗ 用 justify-content:flex-end
       让行从底部往上堆 ✓ 无论几行都在框内 ✓ */
  var rb = document.createElement('div');
  rb.style.cssText = 'position:absolute;left:0;right:0;top:0;bottom:0;' +
    'display:flex;flex-direction:column;justify-content:flex-end;' +
    'padding:6px 0;box-sizing:border-box;overflow:hidden';
  b.appendChild(rb);
  document.body.appendChild(b);
  SYSMSG.el = b; SYSMSG.rowsBox = rb;
  window._toastElRef = b;            /* 兼容旧代码里对 _toastElRef 的引用 ✓ */
  sysMsgApplyPos();
  sysMsgApplySize();
  try { sysMsgBindSizeBtns(); } catch (eSB2) { }
  /* ★★★ 2026-10-23（用户："重启服务器后还是跑到默认位置"）★★★
     ★ 兜底：如果这一刻 SETCFG / 存档还没就绪 ✗ 稍后再套一次位置 ✓
       ① 300ms 后重试（等 game.js 的 SETCFG 加载完 ✓）
       ② 页面完全加载后（window.onload）再试一次 ✓
       两次都是【幂等】的 ✗ 有存档就一定套上 ✓ 没存档就当默认值 ✓ */
  setTimeout(function () {
    try {
      var _b = SYSMSG.el; if (!_b) { return; }
      var _had = (typeof SETCFG !== 'undefined' && SETCFG && SETCFG.sysMsgPos) ||
                 localStorage.getItem('uiPos_sysmsg_' + (document.body.classList.contains('landscape') ? 'L' : 'P')) ||
                 localStorage.getItem('uiPos_sysmsg');
      if (_had) { sysMsgApplyPos(); }
      sysMsgApplySize();
    } catch (eR) { }
  }, 300);
  try {
    window.addEventListener('load', function () {
      try {
        var _b2 = SYSMSG.el; if (!_b2) { return; }
        var _had2 = (typeof SETCFG !== 'undefined' && SETCFG && SETCFG.sysMsgPos) ||
                    localStorage.getItem('uiPos_sysmsg_L') || localStorage.getItem('uiPos_sysmsg_P') ||
                    localStorage.getItem('uiPos_sysmsg');
        if (_had2) { sysMsgApplyPos(); }
        sysMsgApplySize();
      } catch (eL) { }
    }, { once: true });
  } catch (eL2) { }
  return b;
}

/* 位置：默认在屏幕上方中间 ✗ 键位模式拖过就按存的来 ✓ */
function sysMsgApplyPos() {
  var b = SYSMSG.el; if (!b) { return; }
  /* ★ 2026-10-23：先看 SETCFG 里那份（和尺寸同一个存档 ✓）*/
  try {
    var _p = (typeof SETCFG !== 'undefined' && SETCFG && SETCFG.sysMsgPos) || null;
    if (_p && (typeof _p.rx === 'number' || typeof _p.l === 'number')) {
      var _W = Math.max(1, innerWidth), _H = Math.max(1, innerHeight);
      /* ★ 2026-10-23（用户："战斗时提示框自己往上跑"）
         ★ 优先用【固定像素 l/t】✗ 窗口只要没大变就不动 ✓
         ★ 只有当屏幕尺寸变化超过 15% 时（换设备/转屏）才退回按比例换算 ✓
           这样战斗中常见的 innerHeight 小幅抖动（地址栏收起）
           就不会让框上下漂移 ✓✓ */
      var _l, _t;
      var _dw = (typeof _p.sw === 'number') ? Math.abs(_W - _p.sw) / Math.max(1, _p.sw) : 1;
      var _dh = (typeof _p.sh === 'number') ? Math.abs(_H - _p.sh) / Math.max(1, _p.sh) : 1;
      if (typeof _p.l === 'number' && _dw < 0.15 && _dh < 0.15) {
        _l = _p.l; _t = (_p.t || 0);                    /* ★ 尺寸没变 → 用原像素 ✓ */
      } else if (typeof _p.rx === 'number') {
        _l = _p.rx * _W; _t = _p.ry * _H;               /* 换了屏幕 → 按比例 ✓ */
      } else {
        _l = _p.l; _t = (_p.t || 0);
      }
      var _w = b.offsetWidth || SYSMSG.W, _h = b.offsetHeight || SYSMSG.H;
      _l = Math.max(4, Math.min(Math.max(4, _W - _w - 4), _l));
      _t = Math.max(4, Math.min(Math.max(4, _H - _h - 4), _t));
      b.style.left = _l.toFixed(1) + 'px';
      b.style.top = _t.toFixed(1) + 'px';
      b.style.transform = 'none';
      return;
    }
  } catch (e6) { }
  if (typeof uiApplySavedPos === 'function') {
    if (uiApplySavedPos(b, 'sysmsg')) { return; }
  }
  /* ★★★ 2026-10-23（用户："战斗的时候提示框会自己慢慢移动上去"）★★★
     ★ 病根：【top 用了百分比 16%】✗
       百分比是相对 innerHeight 算的 ✓ 而战斗中 innerHeight 会变：
         · 手机横竖屏切换 / 地址栏收起展开 / 软键盘弹出
       → 16% 对应的绝对像素就跟着变 → 框看起来"自己往上跑" ✓✓
     ★ 修：默认位置改成【固定像素】✗ 窗口怎么变都不动 ✓
       高度按当前 innerHeight 的 16% 算一次，存成 px ✓ */
  var _H0 = Math.max(240, innerHeight || 600);
  b.style.left = '16px';
  b.style.top = Math.round(_H0 * 0.16) + 'px';
  b.style.transform = 'none';
}
/* 字号：菜单里调的 ✓ */
function sysMsgApplySize() {
  var b = SYSMSG.el; if (!b) { return; }
  var s = SYSMSG.SIZE;
  for (var i = 0; i < SYSMSG.live.length; i++) {
    SYSMSG.live[i].style.fontSize = s + 'px';
    SYSMSG.live[i].style.lineHeight = '1.75';
  }
  /* ★ 2026-10-23（用户："可以设置宽度和长度"）宽高都由滑块决定 ✗ 不再自动算 ✓ */
  b.style.width = SYSMSG.W + 'px';
  b.style.height = SYSMSG.H + 'px';
}
/* ★★★ 2026-10-23（用户："改成可以设置宽度和长度，滑动设置"）★★★
   三个滑块：宽度 / 高度 / 字号 ✗ 拖动即时生效 ✓ 存 localStorage ✓ */
function sysMsgBindSizeBtns() {
  var wEl = document.getElementById('sysMsgW');
  var hEl = document.getElementById('sysMsgH');
  var fEl = document.getElementById('sysMsgF');
  var wv = document.getElementById('sysMsgWVal');
  var hv = document.getElementById('sysMsgHVal');
  var fv = document.getElementById('sysMsgFVal');
  if (!wEl || wEl._b) { return; }
  wEl._b = 1;
  function paint() {
    if (wEl) { wEl.value = SYSMSG.W; }
    if (hEl) { hEl.value = SYSMSG.H; }
    if (fEl) { fEl.value = SYSMSG.SIZE; }
    if (wv) { wv.textContent = SYSMSG.W + 'px'; }
    if (hv) { hv.textContent = SYSMSG.H + 'px'; }
    if (fv) { fv.textContent = SYSMSG.SIZE + 'px'; }
  }
  function apply(which) {
    try {
      if (which === 'w') {
        SYSMSG.W = Math.max(90, Math.min(420, parseInt(wEl.value, 10) || 136));
        localStorage.setItem('sysMsgW', String(SYSMSG.W));
      } else if (which === 'h') {
        SYSMSG.H = Math.max(40, Math.min(360, parseInt(hEl.value, 10) || 134));
        localStorage.setItem('sysMsgH', String(SYSMSG.H));
      } else if (which === 'f') {
        SYSMSG.SIZE = Math.max(9, Math.min(18, parseFloat(fEl.value) || 11));
        localStorage.setItem('sysMsgSize', String(SYSMSG.SIZE));
      }
      /* ★ 2026-10-23（用户："设置需要保存，刷新重启服务器也不能失效"）
         · localStorage 已经能扛住刷新 / 服务器重启 ✓（浏览器本地存储 ✓）
         · 再写一份进 SETCFG（和其它设置项同一个存档 ✓）双保险 ✓ */
      try {
        if (typeof SETCFG !== 'undefined' && SETCFG) {
          SETCFG.sysMsg = { w: SYSMSG.W, h: SYSMSG.H, f: SYSMSG.SIZE };
          if (typeof saveSet === 'function') { saveSet(); }
        }
      } catch (e4) { }
      /* ★ 2026-10-23 修：框可能还没创建 ✗ 先建出来再套尺寸 ✓
         （原来只调 sysMsgEl() 不复用返回值 → 已有框时改动没应用 ✓）*/
      var _b = sysMsgEl();
      if (_b) {
        _b.style.width = SYSMSG.W + 'px';
        _b.style.height = SYSMSG.H + 'px';
        for (var _i = 0; _i < SYSMSG.live.length; _i++) {
          SYSMSG.live[_i].style.fontSize = SYSMSG.SIZE + 'px';
        }
        /* 菜单里预览一下效果：推一条示例消息 ✓ */
        if (!SYSMSG.live.length) {
          try { sysMsgPush('宽度 ' + SYSMSG.W + ' · 高度 ' + SYSMSG.H); } catch (e3) { }
        }
      }
      paint();
    } catch (e) { }
  }
  /* input 事件 = 拖动过程中就实时生效 ✓ */
  if (wEl) { wEl.addEventListener('input', function () { apply('w'); }); }
  if (hEl) { hEl.addEventListener('input', function () { apply('h'); }); }
  if (fEl) { fEl.addEventListener('input', function () { apply('f'); }); }
  paint();
  sysMsgBindSizeBtns._paint = paint;
}
/* ★★★ 2026-10-23（用户："开始设置它的时候再显示到最上面来"）★★★
   · 平时 z-index 50（在菜单 60 下面）→ 打开菜单看不见它 ✓
   · 只有【切到设置 UI 页并且系统提示框在设置项可见范围】时才抬到 95 ✓
   · 退出设置页 / 关菜单 → 回到 50 ✓ */
function sysMsgSetTop(on) {
  try {
    var b = sysMsgEl();
    if (!b) { return; }
    b.style.zIndex = on ? '95' : '50';
    if (on) {
      /* 抬上来时顺便演示一条 ✗ 让用户看到当前尺寸效果 ✓ */
      if (!SYSMSG.live.length) {
        sysMsgPush('宽度 ' + SYSMSG.W + ' · 高度 ' + SYSMSG.H + ' · 字号 ' + SYSMSG.SIZE);
      }
    }
  } catch (e) { }
}

function sysMsgSetSize(px) {
  SYSMSG.SIZE = Math.max(9, Math.min(20, +px || 11));
  try { localStorage.setItem('sysMsgSize', String(SYSMSG.SIZE)); } catch (e) { }
  sysMsgApplySize();
  try { if (sysMsgBindSizeBtns._paint) { sysMsgBindSizeBtns._paint(); } } catch (e2) { }
}



/* 一行元素（复用池） */
function sysMsgRow() {
  var el = SYSMSG.pool.pop();
  if (!el) {
    el = document.createElement('div');
    el.className = 'row';          /* ★ 样式走 #sysMsgBox .row（彩色 b/i 才生效 ✓）*/
  }
  el.style.fontSize = SYSMSG.SIZE + 'px';
  return el;
}

/* 推一条（★ 对外只用 toast 就行 ✓ 这里内部用）*/
function sysMsgPush(msg) {
  var b = sysMsgEl();
  var el = sysMsgRow();
  /* ★ 2026-10-23（用户："为什么没有字体颜色，要跟网页版一样"）
     ★★ 我上一版理解错了：用户说"字体用 C"只是要【字号/居中】✗ 不是要去掉颜色 ✓
     A 版的彩色就是它的一部分：金币金黄、物品浅蓝、正文浅灰 ✓
     → 恢复 <b>/<i> 标签 ✓ 并给每类配对应颜色 ✓ */
  /* ★★★ 2026-10-23（用户："颜色你有做分类吗，经验是蓝色，不同品阶物品颜色"）★★★
     ★ 之前所有高亮都是同一个金色 ✗ 等于没分类 ✓
     ★ 现在按【类型】分色（和飘字/品阶色同一套观感 ✓）：
       · 经验       → 蓝   #6fb8ff
       · 金币       → 金   #ffd83d
       · 物品名     → 按【品阶】上色（tierHex，和地上掉落物一模一样 ✓）
       · 突破/升级   → 紫   #c79bff
       · 皮肤       → 粉   #ff8ad8
       · 伤害/警告   → 红   #ff7a6a
       · 其它        → 正文浅灰，不染色
     ★ 实现：用 <b class="c-xxx"> + CSS 变量色 ✗ 不改原有 <b> 规则 ✓ */
  var _raw = String(msg == null ? '' : msg).replace(/&nbsp;/g, ' ');
  if (_raw.indexOf('<b>') < 0 && _raw.indexOf('<i>') < 0) {
    /* ① 经验 → 蓝 */
    if (/(经验|精验|EXP)/i.test(_raw)) {
      _raw = _raw.replace(/(\+?[\d,]+)/, '<b class="c-exp">$1</b>');
    }
    /* ② 金币 → 金 */
    else if (/金币/.test(_raw)) {
      _raw = _raw.replace(/(\+?[\d,]+)/, '<b class="c-gold">$1</b>');
    }
    /* ③ 突破 / 升级 → 紫 */
    else if (/突破|升级|第\s*\d+\s*层/.test(_raw)) {
      _raw = _raw.replace(/(\d+)/, '<b class="c-lv">$1</b>');
    }
    /* ④ 皮肤 → 粉 */
    else if (/皮肤/.test(_raw)) {
      _raw = _raw.replace(/皮肤[·:：]?\s*([^\s（(]+)/, '皮肤 <b class="c-skin">$1</b>');
    }
    /* ⑤ 物品（拾取/掉落/获得/购买）→ 按品阶上色 */
    else if (/^(拾取|掉落|获得|买到|捡到)[:：\s]/.test(_raw)) {
      _raw = _raw.replace(/^(拾取|掉落|获得|买到|捡到)[:：\s]*([^\s（(]+)(（(\d+)\s*阶）)?/,
        function (all, verb, name, brk, tier) {
          var n = tier ? Math.max(0, Math.min(11, (parseInt(tier, 10) || 1) - 1)) : -1;
          var col = n >= 0 ? tierHex(n) : '#9fd0ff';
          return verb + ' <b style="color:' + col + '">' + name + '</b>' + (brk || '');
        });
    }
    /* ⑥ 伤害 / 警告 → 红 */
    else if (/伤害|受伤|不足|失败|满了|不能/.test(_raw)) {
      _raw = _raw.replace(/(\+?[\d,]+)/, '<b class="c-bad">$1</b>');
    }
  }
  el.innerHTML = _raw;
  el.style.textAlign = 'left';     /* ★ 2026-10-23（用户：文字向左对齐）*/
  el.style.opacity = '0';
  el.style.transform = 'translateY(10px)';
  SYSMSG.rowsBox.appendChild(el);
  SYSMSG.live.push(el);
  requestAnimationFrame(function () { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
  /* ★ 2026-10-23（用户："滚动要匀速，不能因为消息很多就特别快，只能快一点点"）
     ★ 病根：原来每条消息都触发一次 .26s 平移 ✗
       消息密集时前面的还没走完就被打断 → 视觉上"嗖嗖往上冲"✓
     ★ 修：固定【每秒移动多少像素】✗ 位移多大就花多长时间 ✓
       SPEED = SIZE*1.85 每秒（一行一个字高 ✓ 不随消息数量变）
       消息再多也只是"持续滚动"，不会加速 ✓ */
  /* ★★★ 2026-10-23（用户："滚动感不够，要流畅一点"）★★★
     ★ 病根：原来每次加一行就【平移一行 → .42s → 立刻回正】✗
       → 每来一条消息就"顿一下"再"弹回来"✗ 看着一格一格的 ✓
     ★ 现在：真正的【连续滚动】✗
       ① 新行插到底部，容器先垫一行的位移（视觉上不多出来）
       ② requestAnimationFrame 每帧按【固定速度】把位移推到 0
       ③ 顶出框的那一行在滚动过程中逐渐变淡、滚完才回收
       → 不论消息多密集，滚动速度恒定、没有跳变 ✓ */
  /* ★★★ 2026-10-23（用户："还是不行，把滚动方式改回原来的吧"）★★★
     ★ 连续滚动（rAF 推位移）在窄框 + 换行下不好看 ✗ 用户否掉了 ✓
     ★ 改回原来那版：容器【一动不动】✗ 只有内容在动 ✓
       · 新消息在底部淡入 + 轻微上浮
       · 超出 MAX 行 → 最老的淡出 + 上移 14px → 删掉
       → 视觉上一条条往上滚 ✗ 速度由消息节奏决定 ✓
         没有额外计时器 ✓ 也不会"滚太快看不清"✓ */
  while (SYSMSG.live.length > SYSMSG.MAX) {
    var _old = SYSMSG.live.shift();
    (function (o) {
      o.style.transition = 'opacity .32s ease, transform .32s ease';
      o.style.opacity = '0';
      o.style.transform = 'translateY(-14px)';
      setTimeout(function () {
        if (o.parentNode) { o.parentNode.removeChild(o); }
        o.innerHTML = '';
        o.style.transform = '';
        SYSMSG.pool.push(o);
      }, 330);
    })(_old);
  }
  b.style.display = 'block';
  void b.offsetHeight;              /* 强制回流 ✗ 让 opacity 过渡生效 ✓ */
  b.style.opacity = '1';
  if (SYSMSG.t) { clearTimeout(SYSMSG.t); }
  SYSMSG.t = setTimeout(sysMsgHideAll, 4200);   /* ★ 2026-10-23 2600→4200：没新消息后多留一会 ✓ */
}

/* 没通知 → 整个框（连底板）消失 ✓ */
function sysMsgHideAll() {
  var b = SYSMSG.el;
  if (!b) { return; }
  /* ★ 2026-10-23：收起时把滚动状态清干净 ✗ 下次弹出不会错位 ✓ */
  if (SYSMSG.rowsBox) { SYSMSG.rowsBox.style.transform = ''; }
  b.style.opacity = '0';
  SYSMSG.t = setTimeout(function () {
    b.style.display = 'none';
    for (var i = 0; i < SYSMSG.live.length; i++) {
      var o = SYSMSG.live[i];
      if (o.parentNode) { o.parentNode.removeChild(o); }
      o.innerHTML = '';
      SYSMSG.pool.push(o);
    }
    SYSMSG.live = [];
  }, 240);
}

/* ★ 键位模式：可以拖动这个框（和技能键/攻击键同一套 ✓）*/
function sysMsgBindDrag() {
  try { sysMsgBindSizeBtns(); } catch (eSB) { }
  var b = sysMsgEl();
  if (b._dragBound) { return; }
  b.style.pointerEvents = 'auto';      /* 只有键位模式才吃事件 ✗ 平时穿透 ✓ */
  b._dragBound = true;
  var st = null;
  b.addEventListener('pointerdown', function (e) {
    if (!UI_EDIT) { return; }              /* 非键位模式不许拖 ✓ */
    var r = b.getBoundingClientRect();
    st = { dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false };
    b.style.transform = 'none';
    b.style.left = r.left + 'px';
    b.style.top = r.top + 'px';
    try { b.setPointerCapture(e.pointerId); } catch (e2) { }
    e.preventDefault();
  });
  b.addEventListener('pointermove', function (e) {
    if (!st) { return; }
    var W = innerWidth, H = innerHeight;
    var l = Math.max(4, Math.min(W - (b.offsetWidth || 340) - 4, e.clientX - st.dx));
    var t = Math.max(4, Math.min(H - (b.offsetHeight || 60) - 4, e.clientY - st.dy));
    b.style.left = l + 'px'; b.style.top = t + 'px';
    st.moved = true;
  });
  b.addEventListener('pointerup', function (e) {
    if (!st) { return; }
    var moved = st.moved; st = null;
    try { b.releasePointerCapture(e.pointerId); } catch (e3) { }
    if (moved && typeof uiSavePos === 'function') {
      var _L = parseFloat(b.style.left) || 0, _T = parseFloat(b.style.top) || 0;
      uiSavePos('sysmsg', _L, _T);
      /* ★ 2026-10-23：再写一份进 SETCFG ✓ 和尺寸一起走同一个存档 ✓ */
      try {
        if (typeof SETCFG !== 'undefined' && SETCFG) {
          SETCFG.sysMsgPos = { l: Math.round(_L), t: Math.round(_T),
                               rx: +( _L / Math.max(1, innerWidth)).toFixed(5),
                               ry: +( _T / Math.max(1, innerHeight)).toFixed(5),
                               sw: innerWidth, sh: innerHeight };   /* ★ 记下当时的屏幕尺寸 ✓ */
          if (typeof saveSet === 'function') { saveSet(); }
        }
      } catch (e5) { }
    }
  });
}

function toast(msg) {
  /* ★ 2026-10-23（用户）：改走【固定系统提示框】
     ① 框不动 ✗ 只有里面的行向上滚 ✓
     ② 没通知 → 连底板一起隐藏 ✓
     ③ 键位模式可拖动 / 菜单可调字号 ✓ */
  try { sysMsgPush(msg); } catch (e) { }
}

/* ============================================================ 公告弹窗（round496）
   ★ 用户："玩家打开游戏先看到公告 15 秒自动关闭，点击滑动了就手动关闭"
   ★ 渲染用 web/lib/annrender.js（和发群的图同一套样式 ✓）
   ★ 关掉那一刻才发 annread ✗ 中途掉线不算看过 ✓ */
var ANN = { el: null, left: 0, timer: null, id: 0, cd: null, closing: false };
/* ★ round496：渲染器在 /lib/annrender.js（index.html 里先加载 ✓）
   ★ 这里显式声明一下：① 门禁认它是"已声明" ② 万一没加载也不炸（null ✓）*/
var AnnRender = (typeof window !== 'undefined' && window.AnnRender) || null;

function annShow(a) {
  try {
    if (!a || !a.id) { return; }
    if (ANN.el) { return; }              /* 同时只弹一个 ✓ */
    ANN.id = a.id; ANN.left = 15; ANN.closing = false;

    var ov = document.createElement('div');
    ov.id = 'annBox';
    ov.style.cssText = 'position:fixed;inset:0;z-index:120;display:flex;' +
      'align-items:center;justify-content:center;background:#000000cc;padding:12px';

    var panel = document.createElement('div');
    panel.style.cssText = 'position:relative;width:min(560px,94vw);max-height:86vh;' +
      'overflow:auto;-webkit-overflow-scrolling:touch;border-radius:14px;' +
      'border:1px solid #ffd83d55;box-shadow:0 16px 46px #000d;background:#14120d';

    var inner = (AnnRender && AnnRender.html)
      ? AnnRender.html(a, { scale: 0.62 })
      : ('<div style="padding:18px;color:#dfe8d4">' +
         AnnRenderFallback(a) + '</div>');
    panel.innerHTML = inner +
      '<div style="position:sticky;bottom:0;display:flex;justify-content:center;' +
      'padding:10px 0 12px;background:linear-gradient(180deg,#14120d00,#14120d 40%)">' +
      '<button id="annOk" style="min-width:120px;padding:8px 20px;border-radius:9px;' +
      'border:1px solid #ffd83d88;background:#3a300f;color:#ffe9a0;font-size:14px;' +
      'font-weight:700;cursor:pointer">知道了</button></div>';

    /* 右上角倒计时圈 */
    var cd = document.createElement('div');
    cd.style.cssText = 'position:fixed;right:18px;top:16px;width:46px;height:46px;' +
      'border-radius:50%;display:flex;align-items:center;justify-content:center;' +
      'font-size:14px;font-weight:800;color:#ffd83d;background:#14120dd9;' +
      'border:2px solid #ffd83d55;pointer-events:none;z-index:121';
    cd.textContent = '15';

    ov.appendChild(panel);
    ov.appendChild(cd);
    document.body.appendChild(ov);
    ANN.el = ov; ANN.cd = cd;
    panel.scrollTop = 0;

    /* ★★★ round498（用户："公告要点关闭按钮才能关，我随便点一个地方都自己关了"）
       → 只留两条关闭路径：
           ① 点【知道了】按钮 ✓
           ② 15 秒倒计时到 ✓
       ✗ 点遮罩不关（防止手滑）
       ✗ 面板里滑动不关（长公告要能滚着看完）
       ✗ 键盘不关（按 WASD 走路时顺手关掉太冤） */
    var okBtn = document.getElementById('annOk');
    if (okBtn) { okBtn.addEventListener('click', function (e) {
      if (e && e.stopPropagation) { e.stopPropagation(); }
      annClose();
    }); }
    /* ★ 遮罩挡住点击（不让它穿透到下面的游戏按钮）✗ 但不触发关闭 ✓ */
    ov.addEventListener('click', function (e) {
      if (e && e.stopPropagation) { e.stopPropagation(); }
      if (e && e.preventDefault) { e.preventDefault(); }
    });
    /* ★ 面板里的滑动只滚公告 ✗ 不关（阻止冒泡给游戏）✓ */
    panel.addEventListener('touchmove', function (e) {
      if (e && e.stopPropagation) { e.stopPropagation(); }
    }, { passive: true });

    /* 倒计时 */
    ANN.timer = setInterval(function () {
      ANN.left -= 0.1;
      var n = Math.max(0, Math.ceil(ANN.left));
      if (ANN.cd) {
        ANN.cd.textContent = String(n);
        var deg = Math.max(0, Math.min(360, (ANN.left / 15) * 360));
        ANN.cd.style.background = 'conic-gradient(#ffd83d55 ' + deg + 'deg,#14120dd9 ' +
          deg + 'deg)';
      }
      if (ANN.left <= 0) { annClose(); }
    }, 100);
  } catch (e) {
    console.log('[ann] 显示失败', e);
    annClose();
  }
}

function AnnRenderFallback(a) {
  /* 渲染器没加载时的兜底（极简 ✓ 至少能看到标题和条目）*/
  var out = '<div style="font-size:18px;color:#ffd83d;font-weight:800">' +
    (a.title || '公告') + '</div>';
  var its = a.items || [];
  for (var i = 0; i < its.length; i++) {
    out += '<div style="margin-top:8px;font-size:13px">' + (i + 1) + '. ' +
      (its[i].t || '') + '</div>';
  }
  return out;
}

function annClose() {
  if (ANN.closing) { return; }
  ANN.closing = true;
  try {
    if (ANN.timer) { clearInterval(ANN.timer); }
    ANN.timer = null;
    if (ANN._key) { window.removeEventListener('keydown', ANN._key); ANN._key = null; }
    if (ANN.el && ANN.el.parentNode) { ANN.el.parentNode.removeChild(ANN.el); }
    ANN.el = null; ANN.cd = null;
    /* ★ 关掉那一刻才上报已读 ✓（没关 = 没看 ✓ 下次还弹 ✓）*/
    if (ANN.id && typeof wsSend === 'function') {
      try { wsSend('annread', { id: ANN.id }); } catch (e2) { }
    }
    ANN.id = 0;
  } catch (e) { }
  ANN.closing = false;
}

/* ============================================================
   round303: 二次确认弹窗（用户要求：批量出售 / 5 阶以上装备 都要再问一次）
   ------------------------------------------------------------
   ★ 为什么不用浏览器自带的 confirm()：
     · 它是【原生窗口】✗ 手机上难看 ✗ 还会卡住整个页面（渲染循环也停 ✓）
     · 这个项目的界面全是自己画的 ✓ 保持一套观感 ✓
   ★ 用法（回调式 ✗ 不阻塞）：
       askConfirm({ title, lines:[], warn, ok }, function (yes) { ... });
   ★ 同时只允许一个弹窗 ✓ 重复调用会把上一个直接当"取消"结束掉（不会泄漏回调 ✓）
   ============================================================ */
var _askEl = null, _askCb = null;
function askConfirm(o, cb) {
  if (_askCb) { var _prev = _askCb; _askCb = null; try { _prev(false); } catch (e) { } }
  if (!_askEl) {
    _askEl = document.createElement('div');
    _askEl.id = 'askBox';
    _askEl.style.cssText = 'position:fixed;inset:0;z-index:95;display:none;' +
      'background:#000000aa;align-items:center;justify-content:center';
    var box = document.createElement('div');
    /* 点遮罩 = 取消 ✓（和大多数游戏一致 ✓）*/
    _askEl.onclick = function (e) { if (e.target === _askEl) { askClose(false); } };
    box.id = 'askInner';
    box.style.cssText = 'min-width:250px;max-width:86vw;background:#141a22;' +
      'border:1px solid #ffd83d55;border-radius:12px;padding:16px 18px;' +
      'box-shadow:0 10px 34px #000c;color:#e8eef6;font-size:13px;line-height:1.7';
    box.innerHTML = '<div id="askTitle" style="color:#ffd83d;font-weight:700;' +
      'font-size:15px;margin-bottom:8px"></div>' +
      '<div id="askBody"></div>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">' +
      '<button id="askNo" class="bagB">取 消</button>' +
      '<button id="askYes" class="bagB off">确 定</button></div>';
    _askEl.appendChild(box);
    document.body.appendChild(_askEl);
    box.querySelector('#askNo').onclick = function () { askClose(false); };
    box.querySelector('#askYes').onclick = function () { askClose(true); };
  }
  document.getElementById('askTitle').textContent = o.title || '确认';
  document.getElementById('askBody').innerHTML = (o.lines || []).map(function (s) {
    return '<div>' + s + '</div>';
  }).join('') + (o.warn
    ? '<div style="color:#ff7a6a;margin-top:6px">' + o.warn + '</div>' : '');
  document.getElementById('askYes').textContent = o.ok || '确 定';
  _askCb = cb;
  _askEl.style.display = 'flex';
}
function askClose(yes) {
  var cb = _askCb;
  _askCb = null;
  if (_askEl) { _askEl.style.display = 'none'; }
  if (cb) { try { cb(!!yes); } catch (e) { } }
}

/* ---------- wsUrl ---------- */
/* ★ round286（审查报告 §1.9-③）：给上报时间戳算一个【跨刷新不变】的基准
   = 墙钟秒数 − 页面已运行秒数 ✓
   ★ 存 sessionStorage ✗ 所以 F5 之后基准不变 ✗
     于是 基准 + performance.now() 会【继续往上走】✗ 不再倒退 ✓✓
   ★ 这一行必须在 platform 层 ✗ 因为 core 不许碰浏览器 API ✓（分层闸门会拦 ✓） */
(function netTimeBaseInit() {
  try {
    var v = +(sessionStorage.getItem('xiuxian_tbase') || 0);
    if (!v) {
      v = Date.now() / 1000 - performance.now() / 1000;
      sessionStorage.setItem('xiuxian_tbase', String(v));
      console.log('[sync] 时间基准已建立：' + v.toFixed(3));
    }
    NET_TIME_BASE = v;
  } catch (e) {
    NET_TIME_BASE = 0;    /* 拿不到 sessionStorage 就退回旧行为 ✓（不会更糟 ✓） */
  }
})();

function wsUrl() {
  var port = window.WS_PORT || 8900;
  var proto = (location.protocol === 'https:') ? 'wss:' : 'ws:';
  return proto + '//' + location.hostname + ':' + port + '/ws';
}

/* ---------- wsConnect ---------- */
function wsConnect() {
  var s0 = WSC.sock;
  if (s0 && (s0.readyState === 0 || s0.readyState === 1)) { return; }
  var s;
  try { s = new WebSocket(wsUrl()); } catch (e) { return wsRetry('建连接失败'); }
  WSC.sock = s;
  s.onopen = function () {
    WSC.retry = 0;
    WSC.lastPing = performance.now() / 1000;
    wsSend('hello', { token: WSC.token, ver: PROTO_VER });
  };
  s.onmessage = function (ev) { wsOnMessage(ev.data); };
  s.onclose = function () {
    var wasReady = WSC.ready;
    WSC.ready = false;
    /* ★ round463b：先把横幅显示出来（玩家能看见、能点重连 ✓）*/
    try { if (WSC.on) { netBarShow(wasReady ? '连接已断开，正在重连…' : '连不上服务器'); } } catch (eNB) { }
    if (WSC.on) { wsRetry(wasReady ? '连接断开' : '连不上服务器'); }
    /* ★★ 第 186 轮（用户）：断开后【自动刷新一次】★★
       用户原话："断开连接后自动刷新一次，这样可以同步一下服务器的界面改动"
       目的：每次重新连上就顺手把前端代码也更新一遍 ✓
             （服务器改了界面之后，不用手工清缓存 ✓）

       ★★ 必须防死循环 ✗ 不然服务器没开的时候会无限刷新 ✓✓
         做法：用 sessionStorage 记"上次自动刷新是什么时候"
              20 秒内只允许刷一次 ✓
              而且【只在"本来连上过"的情况下刷】✗
              （一开始就连不上 → 不刷 ✓ 只显示"连不上服务器"提示 ✓）
       ★ 为什么用 sessionStorage 而不是 localStorage：
         标签页关掉就清 ✓ 下次打开是干净的一次 ✓ 不会越攒越多 ✓ */
    /* ★★★ round464（用户："点重连加载不进去了，只能关了 APP 重新进"）★★★
       病根：这里以前会 `location.reload()` ✗✗
         整页刷新要经过 Service Worker + 加载遮罩 ✗
         在 APK 的 WebView 里这一刷就卡住（一直"正在载入资源…"）✗✗
       修：【不再刷新页面】✗ 只重新连 socket ✓
         （页面不动 → 不会卡在加载中；真想刷新，横幅上有按钮 ✓）*/
    console.log('[net] 断开（wasReady=' + wasReady + '）→ 原地重连（不刷新页面）');
  };
  s.onerror = function () { };
}

/* ★★★ round463b：断线横幅 + “重连”按钮 ✗
   用户："点重连没办法连接进不去，要重启 APK 才行"✗
   → 至少要让玩家看得见"断了"、点得动"重连"，而不是对着冻结的画面发呆 ✓ */
var _netBar = null;
function netBarMake() {
  if (_netBar) { return _netBar; }
  var d = document.createElement('div');
  d.id = 'netBar';
  d.style.cssText = 'position:fixed;left:50%;top:0;transform:translateX(-50%);z-index:96;' +
    'display:none;align-items:center;gap:10px;padding:8px 14px;' +
    'background:#3a0d0d;color:#ffd0c8;border:2px solid #ff6a5a;border-bottom-left-radius:10px;' +
    'border-bottom-right-radius:10px;font:13px/1.4 system-ui,"Microsoft YaHei",sans-serif;' +
    'box-shadow:0 6px 18px rgba(0,0,0,.5);white-space:nowrap';
  d.innerHTML = '<span id="netBarTxt">连接已断开</span>' +
    '<button id="netBarBtn" style="border:2px solid #7a1f14;background:#f2c14a;color:#2a1c00;' +
    'font-weight:800;padding:5px 14px;border-radius:0;cursor:pointer;letter-spacing:2px">重 连</button>' +
    '<button id="netBarReload" style="border:2px solid #445;background:#2a3140;color:#cfe0f5;' +
    'font-weight:700;padding:5px 10px;border-radius:0;cursor:pointer;letter-spacing:1px;font-size:12px">刷新</button>';
  document.body.appendChild(d);
  d.querySelector('#netBarBtn').onclick = function () {
    try { netHardReconnect('手动重连'); } catch (e) { }
  };
  /* ★ round464：真要整页刷新时用它 ✗ ?fresh= 能绕开 Service Worker 的缓存副本 ✓ */
  d.querySelector('#netBarReload').onclick = function () { netHardReload('玩家点了刷新'); };
  _netBar = d;
  return d;
}
function netBarShow(msg) {
  var d = netBarMake();
  var t = d.querySelector('#netBarTxt');
  if (t) { t.textContent = msg || '连接已断开'; }
  d.style.display = 'flex';
}
function netBarHide() {
  if (_netBar) { _netBar.style.display = 'none'; }
}

/* ★ 硬重连：把旧连接彻底扒掉 → 重新建连接并重新 hello ✓
   （软重连只是等下一次尝试 ✗ 半死的握手会一直卡着 ✓）*/
/* ★ round464：硬刷新（带 ?fresh= 时间戳）✗
   为什么带参数：Service Worker 对导航请求是 network-first ✗
     但一旦离线/超时它会回退到缓存里的【旧 index.html】✗
     加一个不同的 URL → 它就不会拿那份旧的 ✓ */
function netHardReload(why) {
  console.log('[net] 硬刷新：' + (why || ''));
  try {
    var u = '/?fresh=' + Date.now();
    location.replace(u);
  } catch (e) {
    try { location.reload(); } catch (e2) { }
  }
}
function netBarHardReload(msg) { try { netBarShow(msg); } catch (e) { } }

function netHardReconnect(why) {
  console.log('[net] 硬重连：' + (why || ''));
  try {
    if (WSC.sock) {
      WSC.sock.onclose = null;
      WSC.sock.onerror = null;
      WSC.sock.onmessage = null;
      try { WSC.sock.close(); } catch (e0) { }
      WSC.sock = null;
    }
  } catch (e1) { }
  WSC.ready = false;
  WSC.retrying = false;
  if (WSC.timer) { clearTimeout(WSC.timer); WSC.timer = null; }
  WSC.retry = 0;
  netBarShow('正在重新连接…');
  setTimeout(function () {
    if (WSC.on) { wsConnect(); }
  }, 120);
}

/* ---------- wsOnMessage ---------- */
function wsOnMessage(raw) {
  var m;
  try { m = JSON.parse(raw); } catch (e) { return; }
  var t = m.t, d = m.d || {};
  if (t === 'order') { try { orderApply(d); } catch (eOr) { } return; }
  if (t === 'tablecups') { try { cupsApply(d); } catch (eCup) { } return; }
  if (t === 'waiter') { try { spawnWaiter(d); } catch (eWt) { } return; }
  if (t === 'towncleared') { try { townClearedApply(d); } catch (eTc) { } return; }
  if (t === 'townzones') { try { townZonesApply(d); } catch (eTz) { } return; }
  if (t === 'work') { try { workApply(d); } catch (eWk) { } return; }
  if (t === 'jobstep') { try { jobRemote(d); } catch (eJs) { } return; }
  if (t === 'fridge') { try { fridgeApply(d); } catch (eFr) { } return; }
  if (t === 'shop') { try { shopApply(d); } catch (eShop) { } return; }
  if (t === 'sleep_state') { try { sleepApply(d); } catch (eSl) { } return; }
  if (t === 'houses') { try { housesApply(d.list || []); } catch (eH) { } return; }
  if (t === 'house') { try { houseApply(d); } catch (eH2) { } return; }
  if (t === 'teleported') { try { tpApply(d); } catch (eT) { } return; }
  if (t === 'seated') { try { townSeatApply(d); } catch (eS) { } return; }
  if (t === 'stood') { try { townSeatClear(d); } catch (eT) { } MY_TABLE = ''; return; }
  if (t === 'warehouse') { whApply(d); return; }
  if (t === 'welcome') {
    /* ★ 2026-10-22（用户："怪的总上限按管理页面为准，不要设置固定值了"）：
       管理页的僵尸上限随 welcome 下发 → 覆盖客户端写死的 G.MOB_MAX */
    try {
      var _mc = +(d && d.mobCap);
      if (_mc > 0) {
        window.MY_MOB_CAP = _mc;
        if (typeof G !== 'undefined') { G.MOB_MAX = _mc; }
      }
    } catch (eMc) { }
    try { setTimeout(function () { skAsk(); }, 600); } catch (e9) { } wsWelcome(d);
    try {
      setTimeout(function () { try { wsSend('town_objects', {}); } catch (eTo) { } }, 900);
    } catch (eTp) { }
    return; }
  if (t === 'world') {
    window._lastWorldT = Date.now();
    wsApplyWorld(d);
    try { skShieldHud(d && d.me ? d.me.shield : 0); } catch (eS) { }
    /* ★ round587：护盾/疾风步状态断线重连也能恢复，结束/破碎就淡出 */
    try {
      if (window.VFX && typeof H !== 'undefined' && H && H.g && d && d.me) {
        var _shv2 = +d.me.shield || 0, _sht = +d.me.shieldT || 0;
        if (_shv2 <= 0 && _myShieldFx) { VFX.kill(_myShieldFx); _myShieldFx = null; }
        else if (_shv2 > 0 && !_myShieldFx && _sht > 0) {
          _myShieldFx = VFX.spawn('shield', { attach: H.g, dur: _sht }, null);
        }
        var _gvt = +d.me.galeT || 0;
        if (_gvt <= 0 && _myGaleFx) { VFX.kill(_myGaleFx); _myGaleFx = null; }
        else if (_gvt > 0 && !_myGaleFx) {
          _myGaleFx = VFX.spawn('gale', { attach: H.g, dur: _gvt, n: 0, drift: 3 }, null);
        }
        var _bkt = +d.me.berserkT || 0;
        if (_bkt <= 0 && _myBerserkFx) { VFX.kill(_myBerserkFx); _myBerserkFx = null; }
        else if (_bkt > 0 && !_myBerserkFx) {
          _myBerserkFx = VFX.spawn('berserk', { attach: H.g, dur: _bkt, n: 0 }, null);
        }
        var _brt = +d.me.bloodrageT || 0;
        if (_brt <= 0 && _myBloodrageFx) { VFX.kill(_myBloodrageFx); _myBloodrageFx = null; }
        else if (_brt > 0 && !_myBloodrageFx) {
          _myBloodrageFx = VFX.spawn('bloodrage', { attach: H.g, dur: _brt, n: 0 }, null);
        }
        if (MY_FROZEN && !_myIceFx) {
          _myIceFx = VFX.spawn('iceblock', { attach: H.g, dur: 5 }, null);
        } else if (!MY_FROZEN && _myIceFx) {
          VFX.kill(_myIceFx); _myIceFx = null;
        }
        var _tsz = (typeof MY_SIZE === 'number') ? MY_SIZE : 1;
        if (_tsz > 1.01 && !_myTankFx) {
          _myTankFx = VFX.spawn('tank', { attach: H.g, dur: 3600,
                                          r: Math.min(3.5, 1.05 + _tsz * 0.18),
                                          spin: 2.2 }, null);
        } else if (_tsz <= 1.01 && _myTankFx) {
          VFX.kill(_myTankFx); _myTankFx = null;
        }
        if (MY_PLAGUE && !_myPlagueFx) {
          _myPlagueFx = VFX.spawn('tank', { attach: H.g, dur: 3600, r: 1.25,
                                            spin: 3.0, color: 0x58e878,
                                            color2: 0x9dffb0 }, null);
        } else if (!MY_PLAGUE && _myPlagueFx) {
          VFX.kill(_myPlagueFx); _myPlagueFx = null;
        }
      }
    } catch (eFx2) { }
    try {
      if (d && d.me && typeof d.me.qimax === 'number' && d.me.qimax > 0) {
        MY_QIMAX = d.me.qimax;
      }
      if (d && d.me) { MY_SHIELD = Math.max(0, Math.round(+d.me.shield || 0)); }
      if (d && d.me) { MY_GALE_T = Math.max(0, +d.me.galeT || 0); }
      if (d && d.me) { MY_BERSERK_T = Math.max(0, +d.me.berserkT || 0); }
      if (d && d.me) { MY_BLOODRAGE_T = Math.max(0, +d.me.bloodrageT || 0); }
      if (d && d.me) { MY_BLOODTHIRST_T = Math.max(0, +d.me.bloodthirstT || 0); }
      if (d && d.me) { MY_SHIELD_T = Math.max(0, +d.me.shieldT || 0); }
      if (d && d.me) { MY_SKDUR_MUL = Math.max(1, +d.me.skdur || 1); }
      if (d && d.me) { MY_PLAGUE = (+d.me.plague || 0) ? 1 : 0; }
      updQi();
    } catch (eQ) { }
    /* ★ 第 219 轮：兜住"假死"（用户实测："别人看你已经死了，自己看还活着"）✗
       服务器本来会发一条 dead 消息 ✓ 但它只在【状态翻转那一刻】发一次 ✗
       万一那次丢了 / 被别的东西盖住了 → 客户端就永远显示活着 ✓✓
       → 这里每帧看一眼：服务器说你没血了 + 我这边还活着 → 补一次死亡 ✓
       （走现成的 playerDie ✓ 和收到 dead 消息是同一条路 ✓ 不会两套逻辑 ✓）*/
    if (window._lastWorldT && d && d.me && typeof d.me.hp === 'number' &&
        d.me.hp <= 0 && !dead && typeof playerDie === 'function') {
      playerDie('');
    }
    return;
  }
  if (t === 'pong') { WSC.rtt = (performance.now() / 1000 - WSC.lastPing) * 1000; return; }
  if (t === 'kick') {
    /* ★★ round464：只有【真的认证失败】才清 token ✗
       以前不管什么 kick（版本不符 / 别处登录）都清 ✗✗
       → 刷新后直接掉回登录框 → APK 里不好输入 → "进不去" ✓ */
    var _code = d.code || '';
    var _kill = (_code === 'auth' || _code === 'norole');
    WSC.on = false; WSC.ready = false;
    if (_kill) {
      try { localStorage.removeItem('token'); } catch (e2) { }
      netGoOffline();
      if (window.showLogin) { showLogin(d.msg || '请重新登录'); }
    } else {
      /* 保留 token（下次连接还能用），只提示 + 特定情况给刷新按钮 ✓ */
      try { netBarShow(d.msg || ('被断开（' + _code + '）')); } catch (e3) { }
      if (_code === 'ver' && window.netBarHardReload) {
        try { netBarHardReload('版本不一致，需要刷新'); } catch (e4) { }
      }
    }
    return;
  }
  /* ★ 第 248 轮：弹幕（全服滚动通知 ✓）*/
  if (t === 'ticker') { tkPush(d.text, d.kind); return; }
  /* ★ round577：坦克引擎叠层提示（图标 + 当前层数）*/
  if (t === 'tank') {
    try { skTankNotice(+d.n || 0, +d.bonus || 0); } catch (e) { }
    return;
  }
  if (t === 'error' || t === 'notice') {
    var _tx = d.msg || d.text || '';
    /* ★ round304c：交易所的最终回执会在 notice 尾巴上带这个记号 ✗
       见到就去重拉背包 ✓（服务端 _mkt_ack 写死的 ✗ 两边必须一致 ✓）
       ★ 为什么用"约定一个尾巴"这种土办法：notice 本来就是【服务器写文案】的通道 ✓
         为这一件事新加一种消息 ✗ 协议表就得多一条 ✓ 不值得 ✓ */
    if (typeof mktNoticeSaysRefresh === 'function' && mktNoticeSaysRefresh(_tx)) {
      if (typeof bagFetch === 'function') { bagFetch(bagRender); }
    }
    /* ★ 第 52 轮：服务器说"等级不够"这类拒绝，除了 toast 还要【留在背包面板里】✓
       （toast 一闪而过，玩家会以为"点了没反应"✗）*/
    if (_tx.indexOf('等级不够') >= 0 || _tx.indexOf('不是武器') >= 0 ||
        _tx.indexOf('没有这件') >= 0) {
      BAG.msg = '✗ ' + _tx;
      BAG.busy = false;
      if ((SETCFG.setTab || '') === 'bag') { bagFetch(bagRender); }
    }
    if (_tx) { toast(_tx); }
    return;
  }
  /* ★ 第 47 轮：服务器告诉我「手上的武器换了」（穿上/脱下之后它主动推 ✓）
     → 本地预测的射程/攻击弧/冷却跟着换 ✓ 背包页开着的话顺手刷一下 ✓ */
  /* ★★ 第 62 轮：武器效果的飘字 ★★
     服务器一直在发这些（背击在 mhits 里 ✓ 其余走 fx ✓）
     但客户端【以前根本没处理 fx】✗ → 效果发生了玩家却看不到 ✓ */
  if (t === 'fx') {
    /* ★★ 第 127 轮修的真 bug（用户："组队后获得队友经验显示【特效】两个字"）★★
       病根：第 86 轮我给队伍经验发的是 {t:'fx', kind:'pexp'} ✓
             但处理写在下面【通用 fx】之后 ✗
             通用那个先跑 ✓ 查不到 pexp → 走兜底 ['特效'] ✗✓
             → 玩家看到的就是【特效】两个字 ✗ 而不是加了多少经验 ✗
       修：直接加进 FX_C ✓（并且带上数字 ✓）*/
    /* ★ round381：锤子旋击 → 飘一个"旋击"并且开始转圈 ✓ */
    /* ★ round392：长棍横扫 → 棍子变长变大 + 飘字 */
    /* ★★★ round398（用户："这些动画要做同步，不然别人看不到"）★★★
       ★ 服务端现在会把特效广播给周围 ✗ 带上 by = 谁在放 ✓
       ★ 不是我就记到那个玩家身上 ✗ 渲染时按他的状态播 ✓ */
    /* ★ round406（用户："玩家也会被长棍击退"）
       ★ 玩家位置是客户端权威 ✗ 服务端只能发"推多少"让客户端自己执行 ✓
       ★ 用 moveWithCollision → 撞墙不会穿过去 ✓ */
    /* ★ round575：黑洞吸力 —— 和击退一样走 moveWithCollision（撞墙不穿 ✓）
       ★ 单独一个 kind ✗ 不用 kb：kb 会震屏，吸力每帧都来 → 画面会一直抖 ✓ */
    if (d.kind === 'pull') {
      try {
        if (typeof moveWithCollision === 'function' && typeof P !== 'undefined') {
          moveWithCollision(+d.dx || 0, +d.dz || 0, G.BODY_W / 2, G.BODY_D / 2, true, null);
        }
      } catch (e) { }
      return;
    }
    if (d.kind === 'kb') {
      try {
        if (typeof moveWithCollision === 'function' && typeof P !== 'undefined') {
          moveWithCollision(+d.dx || 0, +d.dz || 0, G.BODY_W / 2, G.BODY_D / 2, true, null);
          if (typeof shake !== 'undefined') { shake = 0.3; }
        }
      } catch (e) { }
      return;
    }
    /* ★ round404（用户："长枪挑飞，落地加落地音效"）*/
    if (d.kind === 'launch') {
      if (typeof NET !== 'undefined' && NET.rmobs && NET.rmobs[d.mid]) {
        NET.rmobs[d.mid].flyUntil = performance.now() + 1500;
        NET.rmobs[d.mid].flyH = 6 * 0.62;
      }
      return;
    }
    if (d.kind === 'land') {
      if (typeof sfx === 'function') { sfx('land', 1.0); }
      if (typeof hitFlash === 'function') { hitFlash(+d.x, 0.4, +d.z, true); }
      return;
    }
    /* ★★★ round407（交接文档第四节 ④）：长枪把【玩家】挑到空中 ★★★
       ★ launch_me  = 我自己被挑飞 → 由 core 的 flyYNow() 接管 1.5 秒的高度 ✓
         （位置是客户端权威 ✗ 服务端只能发事件 ✓ 高度绝对不能由服务端推 ✓）
       ★ launch_him = 别人被挑飞 → 记到那个人头上，渲染时按他自己的弧线抬 ✓
         （和 saber/staff/spin 那种"记到作者头上"一个套路 ✓）*/
    if (d.kind === 'launch_me') {
      _flyT0 = performance.now();
      _flyDur = Math.max(0.2, +d.t || 1.5) * 1000;
      _flyH = +d.h || 3.72;
      if (typeof shake !== 'undefined') { shake = 0.35; }
      return;
    }
    if (d.kind === 'launch_him') {
      var _rofly = (typeof NET !== 'undefined' && NET.others &&
                    NET.others[d.who]) ? NET.others[d.who] : null;
      if (_rofly) {
        _rofly.flyT0 = performance.now();
        _rofly.flyDur = Math.max(0.2, +d.t || 1.5) * 1000;
        _rofly.flyH = +d.h || 3.72;
      }
      return;
    }
    /* ★ round586：全能吸血回血飘字（服务端已算好，0 不显示）*/
    if (d.kind === 'heal') {
      if (+d.v > 0) { healNum('+' + Math.round(+d.v), +d.x, 2.9, +d.z); }
      return;
    }
    /* ★ round590：服务端广播的疾风步残影 */
    if (d.kind === 'ghost') {
      try { VFX.spawn('ghost', { x: +d.x, z: +d.z, yaw: +d.yaw || 0,
                                color: (+d.color || 0x9fe8ff),
                                dur: 0.5, seed: (Date.now() & 0xffff) }, scene); } catch (eG) { }
      return;
    }
    /* ★ round400：别人打的伤害 → 弹一个灰色数字 */
    if (d.kind === 'dmg') {
      var _dmgTxt = String(+d.v || 0) + (d.crit ? ' 暴击' : '');
      if (d.sk) { dmgSkill(_dmgTxt, +d.x, 2.4, +d.z, !!d.crit); }
      else { dmg(_dmgTxt, +d.x, 2.4, +d.z, !!d.crit); }
      return;
    }
    var _fxOp = d.by;
    var _fxMine = (_fxOp === undefined) || (_fxOp === null) ||
                  (typeof WSC !== 'undefined' && _fxOp === WSC.myId);
    if (!_fxMine) {
      var _ro = (NET.others && NET.others[_fxOp]) ? NET.others[_fxOp] : null;
      if (_ro) {
        // ★ 记到那个玩家头上 ✓
        if (d.kind === 'saber') { _ro.multiN = Math.max(2, Math.min(13, +d.n || 2)); _ro.multiT0 = performance.now(); }
        if (d.kind === 'staff') { _ro.staffT0 = performance.now() - 120; _ro.staffLen = +d.len || 4; }
        if (d.kind === 'spin') { _ro.spinUntil = performance.now() + 560; }
        if (d.kind === 'crit') { _ro.critUntil = performance.now() + 400; }
        if (d.kind === 'crit' || d.kind === 'spin' || d.kind === 'staff' ||
            d.kind === 'saber') { return; }
      }
    }
    /* ★ round395：弯刀连砍 → 循环播 N 刀的动画 */
    if (d.kind === 'saber') {
      _multiN = Math.max(2, Math.min(13, +d.n || 2));
      _multiT0 = performance.now();
      fxNum('连砍 ' + _multiN + ' 刀', '#ffd83d', P.x, 2.9, P.z);
      return;
    }
    if (d.kind === 'staff') {
      /* ★ round393：触发时刻提前一点 ✗ 让"变大"发生在砸下去之前 ✓
         （事件是命中瞬间到的，往前挪 120ms 相当于"起手就已经在变大了"）*/
      _staffT0 = performance.now() - 120;
      _staffLen = +d.len || 4;
      /* 峰值放大：4 米 → 2.8 倍 · 10 米 → 5.4 倍（用户要求"至少再长一倍"）*/
      _staffPeak = 1 + Math.min(4.4, (_staffLen / 10) * 4.4);
      fxNum('横扫 ' + _staffLen.toFixed(0) + 'm', '#8ee0ff', P.x, 2.9, P.z);
      return;
    }
    if (d.kind === 'spin') {
      _spinUntil = performance.now() + _spinDur;
      fxNum('旋击', '#ffd83d', P.x, 2.9, P.z);
      return;
    }
    var FX_C = { bleed: ['流血', '#ff7a6a'], stun: ['眩晕', '#ffd83d'],
                 knock: ['击退', '#8ee0ff'], parry: ['招架', '#8ee0ff'],
                 dodge: ['闪避', '#8ee0ff'],
                 pexp: ['+' + (d.n || 0) + ' 队伍经验', '#7ee08a'] };
    var fc = FX_C[d.kind] || ['特效', '#cfc9bf'];
    var fx = 0, fz = 0;
    if (d.mid && NET.rmobs && NET.rmobs[d.mid]) {
      var rm = NET.rmobs[d.mid];
      fx = rm.x; fz = rm.z;
    } else {
      fx = P.x; fz = P.z;          // 招架这种是对着自己 ✓
    }
    fxNum(fc[0], fc[1], fx, 2.6, fz);
    return;
  }
  /* ★★ 第 63 轮：登场事件（复活 / 上线）★★
     ★ 只发给【附近】的人（远处的人不关心 ✓ 服务器那边也是这么做的 ✓）*/
  if (t === 'evt') {
    spawnFx(+d.x || P.x, +d.z || P.z, d.kind || 'join', d.name || '');
    var who = d.name || '有人';
    fxNum(d.kind === 'revive' ? (who + ' 复活了') : (who + ' 上线了'),
          d.kind === 'revive' ? '#8ee0ff' : '#ffe0a0', +d.x || P.x, 3.2, +d.z || P.z);
    return;
  }
  /* ★ 第 67 轮：防具穿上/脱下 */
  /* ★★ 第 83 轮：组队 ★★ */
  if (t === 'party') {
    PARTY.roster = d.roster || null;
    PARTY.pid = d.pid || null;
    PARTY.leader = d.leader || null;
    if (d.me !== undefined && d.me !== null) { PARTY.me = d.me; }
    ptRender();
    return;
  }
  /* ★ 第 127 轮：pexp 已经并进上面的 FX_C 了 ✗（不留两份 ✗）*/
  if (t === 'partyinv') {
    /* ★ 第 84 轮：两种形态都要【去重】✓（用户：同一个人只显示一条 ✓）
       d.list = 服务器补推的完整列表（第三项是【绝对到期时刻】✓）
       d.name = 一次性事件（刚有人邀请我）→ 自己并进去，同源覆盖旧的 ✓ */
    if (d.list) {
      PARTY.inv = d.list;
    } else if (d.name) {
      var _keep = [], _hit = false;
      for (var _i = 0; _i < PARTY.inv.length; _i++) {
        if (PARTY.inv[_i][0] === d.pid) { _hit = true; } else { _keep.push(PARTY.inv[_i]); }
      }
      _keep.push([d.pid, d.name, (Date.now() / 1000) + 60]);
      PARTY.inv = _keep;
      ptBanner((d.name || '有人') + ' 邀请你组队 —— 菜单 → 组队 里同意', '#ffd83d');
    }
    ptRender();
    return;
  }
  if (t === 'partyapply') {
    if (d.list) { PARTY.app = d.list; }
    else if (d.name) {
      var _kp = [];
      for (var _j = 0; _j < PARTY.app.length; _j++) {
        if (PARTY.app[_j][0] !== d.cid) { _kp.push(PARTY.app[_j]); }
      }
      _kp.push([d.cid, d.name, (Date.now() / 1000) + 60]);
      PARTY.app = _kp;
      ptBanner((d.name || '有人') + ' 申请加入队伍 —— 组队页里同意', '#8ee0ff');
    }
    ptRender();
    return;
  }
  if (t === 'partychat') {
    fxNum('[队伍] ' + (d.name || '?') + '：' + (d.text || ''), '#8ee0ff', P.x, 2.8, P.z);
    return;
  }
  /* 第 173 轮（用户 #6）：传送相关
     tpcast = 服务器说"开始读条 / 读条被打断"（t=秒数，0 表示断了）
     tp     = 服务器说"到了"（给最终坐标，客户端跟着摆 ✓）*/
  if (t === 'tpcast') {
    /* ★ 第 189 轮：服务器说了算 —— 它说开始读条就重新计时 ✓
       它说 t=0（被打断）就立刻收掉 ✓ 覆盖掉我们本地那次乐观显示 ✓ */
    TPCAST.left = +d.t || 0;
    TPCAST.at = performance.now() / 1000;
    tpBarRender();
    return;
  }
  if (t === 'tp') {
    TPCAST.left = 0;
    tpBarRender();
    if (typeof d.x === 'number' && typeof d.z === 'number') {
      P.x = d.x; P.z = d.z;          /* 位置由服务器说了算（传送这一下）✓ */
    }
    return;
  }
  /* ★★ round304c：交易所的两条下行（listpage = 一页货架 ✗ listres = 操作结果）★★ */
  if (t === 'listpage') {
    if (typeof mktOnPage === 'function') { mktOnPage(d); }
    return;
  }
  if (t === 'listres') {
    if (typeof mktOnRes === 'function') { mktOnRes(d); }
    return;
  }
  if (t === 'mq') {              // ★ 第 152 轮：服务器告诉我魔气变了 ✓
    MY_MQ = +d.v || 0;
    if ((SETCFG.setTab || '') === 'stat') { statRender(); }
    return;
  }
  if (t === 'skillok') {
    /* ★ round538：技能全量状态（定义 + 学习 + 装配 + 提示）*/
    var _sd = m.d || {};
    SK.defs = _sd.defs || [];
    SK.byKey = {};
    for (var _si = 0; _si < SK.defs.length; _si++) { SK.byKey[SK.defs[_si].k] = SK.defs[_si]; }
    SK.learn = _sd.learn || {};
    SK.load = _sd.load || { A: [], B: [], C: [] };
    if (_sd.err) {
      SK.msg = String(_sd.err);
      /* ★ round558（用户："学习技能没有提示"）→ 弹个小提示 ✓ */
      try { toast(SK.msg); } catch (eT) { }
    }
    try { skRender(); } catch (e0) { }
    try { skBarRender(); } catch (e1) { }
    return;
  }
  if (t === 'skillfx') {
    try { skFxPlay(m.d); } catch (e2) { }
    return;
  }
  if (t === 'skillcd') {
    var _cd = (m.d || {}).cd || {};
    SKCD = {};
    for (var _k in _cd) { SKCD[_k] = +_cd[_k] || 0; }
    try { skBarRender(); } catch (e3) { }
    return;
  }
  if (t === 'towns') {
    try {
      if (d.catalog && d.catalog.length) {
        window.MY_TOWN_CATALOG = d.catalog;
        try {
          if (window.PlaceMode && window.PlaceMode.refreshAux) { window.PlaceMode.refreshAux(); }
        } catch (eAux) { }
      }
      if (d.list) { window.MY_TOWNS = d.list; }
      if (d.perms) { window.MY_TOWN_PERMS = d.perms; }
      if (typeof window.townRender === 'function') { window.townRender(); }
    } catch (eT) { }
    return;
  }
  if (t === 'townresult') {
    try { if (d.msg && typeof toast === 'function') { toast(d.msg); } } catch (eT2) { }
    if (d.town) { window.MY_TOWNS = [d.town]; }
    try { if (typeof window.townRender === 'function') { window.townRender(); } } catch (eT3) { }
    if (d.ok && typeof window.townRefresh === 'function') { window.townRefresh(); }
    return;
  }
  /* ---- v4.2 物件放置 ---- */
  if (t === 'objects') {
    try {
      window.MY_OBJECTS = d.list || [];
      /* ★ 2026-10-22（用户："权限管理真的有生效吗"）：把本人在本镇的权限位存下来，
         没「可移动(1)」就不让进建造/编辑模式（服务端也会拒绝，这里是提前拦住） */
      if (d.mask != null) { window.MY_TOWN_MASK = +d.mask || 0; }
      if (d.town != null) { window.MY_TOWN_ID = +d.town || 0; }   /* 系统主城也能管权限 */
      try { TOWN_OBJECTS_CACHE = window.MY_OBJECTS; } catch (eC) { }
      if (d.catalog && d.catalog.length) {
        window.MY_TOWN_CATALOG = d.catalog;
      }
      try {
        if (window.PlaceMode && window.PlaceMode.refreshAux) { window.PlaceMode.refreshAux(); }
      } catch (eAux2) { }
      if (typeof window.onObjects === 'function') { window.onObjects(window.MY_OBJECTS, d.town); }
    } catch (eO) { }
    return;
  }
  if (t === 'placed') {
    try {
      var _add = [d.object].concat(d.list || []);
      window.MY_OBJECTS = (window.MY_OBJECTS || []).concat(_add);
      try { TOWN_OBJECTS_CACHE = window.MY_OBJECTS; } catch (eC2) { }
      if (typeof window.onPlaced === 'function') { window.onPlaced(d.object, d.furniture, d.list || []); }
      if (typeof toast === 'function') {
        toast((d.furniture ? ('放置成功，附家具 ' + d.furniture + ' 件') : '放置成功'));
      }
    } catch (eP) { }
    return;
  }
  if (t === 'moved') {
    try {
      /* ★ 2026-10-22：同步池子 + 重建模型（以前只回调，缓存还是旧坐标） */
      var _mo = d.object || null;
      if (_mo && _mo.id != null) {
        var _l = window.MY_OBJECTS || [];
        for (var _i = 0; _i < _l.length; _i++) {
          if (String(_l[_i].id) === String(_mo.id)) {
            _l[_i] = Object.assign({}, _l[_i], _mo);
            break;
          }
        }
        window.MY_OBJECTS = _l;
        try { TOWN_OBJECTS_CACHE = window.MY_OBJECTS; } catch (eC3) { }
      }
      if (typeof window.onMoved === 'function') { window.onMoved(_mo); }
    } catch (eM) { }
    return;
  }
  if (t === 'removed') {
    try {
      /* ★ 2026-10-22：d.kids = 被级联删掉的子家具（建筑自带的桌椅/遮阳伞…）——
         以前只删建筑本身，里面的家具还留在场景里 */
      var _gone = [String(d.id)].concat((d.kids || []).map(String));
      window.MY_OBJECTS = (window.MY_OBJECTS || []).filter(function (o) {
        return _gone.indexOf(String(o.id)) < 0;
      });
      try { TOWN_OBJECTS_CACHE = window.MY_OBJECTS; } catch (eC4) { }
      if (typeof window.onRemoved === 'function') {
        window.onRemoved(d.id);
        (d.kids || []).forEach(function (k) {
          try { window.onRemoved(k); } catch (eK) { }
        });
      }
      /* ★ 2026-10-22：再向服务端要一次最新列表，彻底对齐（防止本地残留）。
         服务端只回 active 的物件，这样删掉的绝不会再出现。 */
      try { setTimeout(function () { wsSend('town_objects', {}); }, 240); } catch (eRef) { }
    } catch (eR) { }
    return;
  }
  if (t === 'run') { runApply(d); return; }
  if (t === 'qi') {
    MY_QI = +((m.d || {}).q || 0);
    try { updQi(); } catch (e4) { }
    try { skBarRender(); } catch (e4b) { }
    return;
  }
  if (t === 'mobmarks') {
    try { UI.mobMarks(d.list || []); } catch (eMM) { }
    return;
  }
  if (t === 'mobspawn') {
    try {
      var _sm = NET.rmobs[String(d.mid)];
      if (_sm) {
        _sm.name = d.name || _sm.name;
        _sm.rank = +d.rank || _sm.rank || 0;
        _sm.skin = d.skin || _sm.skin || '';
        _sm.affixes = d.affixes || [];
        var _at = (_sm.affixes || []).slice(0, 3).map(function (a) { return a.n; }).join(' · ');
        if (_sm.ui && d.name) { UI.plate.name(_sm.ui, d.name + (_at ? ' · ' + _at : '')); }
      }
    } catch (eMS) { }
    return;
  }
  if (t === 'mobzone') {
    try {
      VFX.spawn('boss_zone', { x: +d.x || 0, z: +d.z || 0,
        r: +d.r || 4, dur: +d.dur || 6 }, scene);
    } catch (eZone) { }
    return;
  }
  if (t === 'mobshot') {
    try {
      VFX.spawn('mob_shot', {
        x: +d.x || 0, z: +d.z || 0, tx: +d.tx || 0, tz: +d.tz || 0,
        rank: +d.rank || 0, dur: +d.dur || 0.18
      }, scene);
    } catch (eShot) { }
    return;
  }
  if (t === 'mobskill') {
    try {
      var _mk = NET.rmobs[String(d.mid)];
      var _bfx = bossSkillFx(d.key);
      if (_mk && d.phase === 'windup') {
        _mk.castT = +(d.cast_time || 1.0);
        _mk.castDur = +(d.cast_time || 1.0);
        _mk.castKey = d.key || '';
        _mk.castStyle = bossCastStyle(d.key);
        _mk.castPhase = d.phase;
        _mk.castYaw = +d.yaw || 0;
      }
      if (d.phase === 'windup' && d.name) {
        try {
          VFX.spawn('boss_cast', {
            x: +d.x || 0, z: +d.z || 0, r: +(d.radius || 3),
            dur: +(d.cast_time || 1.2), color: _bfx.c,
            shape: String(d.shape || 'aoe'), cone: +(d.cone || 70), yaw: +(d.yaw || 0)
          }, scene);
        } catch (eCast) { }
        if (d.tx !== undefined) {
          try {
            VFX.spawn('boss_lock', {
              x: +d.tx || 0, z: +d.tz || 0, r: Math.min(3.2, +(d.radius || 2.2)),
              dur: +(d.cast_time || 1.2), color: _bfx.c
            }, scene);
          } catch (eLock) { }
        }
        try {
          VFX.spawn('skillname', {
            text: d.name, color: '#' + _bfx.c.toString(16).padStart(6, '0'),
            x: +d.x || 0, z: +d.z || 0,
            boss: +d.rank >= 2,
            h: (+d.rank >= 2 ? 3.0 : 2.15)
          }, scene);
        } catch (eSN) {
          if (+d.rank >= 2) { try { toast('BOSS技能：' + d.name); } catch (eTN) { } }
        }
      }
      if (d.phase === 'strike' && _mk) {
        try {
          _mk.castPhase = 'strike';
          _mk.castDur = 0.25;
          _mk.castT = 0.25;
          if (d.key !== 'serpent_pools') {
            VFX.spawn('boss_hit', { x: +d.x || 0, z: +d.z || 0, r: +(d.radius || 2),
              color: _bfx.c, mode: _bfx.m, seed: (Date.now() % 997) | 0 }, scene);
          }
        } catch (eStrike) { }
      }
    } catch (eMSk) { }
    return;
  }
  if (t === 'mobevt') {
    try {
      var _me = NET.rmobs[String(d.mid)];
      if (_me && d.kind === 'crit') {
        _me.critJumpT = 0.35;
        _me.jumpCrit = 1;
      }
    } catch (eME) { }
    return;
  }
  if (t === 'skillerr') {
    SK.msg = String((m.d || {}).msg || '操作失败');
    try { toast(SK.msg); skRender(); } catch (e1) { }
    return;
  }
  if (t === 'skincustomok') {      // ★ round511：我的皮肤自定义（全量 map）
    MY_CUSTOM_MAP = (d && d.custom && typeof d.custom === 'object') ? d.custom : {};
    if (d && d.cards && typeof d.cards === 'object') { MY_CARD_MAP = d.cards; }
    try {
      var _mk = (WSC.role && WSC.role.skin) || MY_SKIN || '';
      if (_mk) { skinApplySelf(_mk, MY_CUSTOM_MAP[_mk] || null); }
    } catch (eC0) { }
    if (typeof SKC !== 'undefined' && SKC.open) {
      SKC.base = skcCustomOf(SKIN.sel);   /* ★ 保存过的东西 → 变成新的"上次" ✓ */
      SKC.pending = {};                    /* ★ 这趟的改动都落地了 ✗ 清空 ✓ */
      skcRender(); skcPreview();
    }
    skcSay('');
    try { toast('自定义已保存 ✓'); } catch (eT) { }
    return;
  }
  if (t === 'mobcap') {          // ★ 2026-10-22：自己刷怪上限（1~100）
    try { ptMobCapApply(d); } catch (eMc) { }
    return;
  }
  if (t === 'worksettle') {
    /* ★ 2026-10-22：打工结算（服务端早就发这个包 ✗ 客户端没人接 → 结算看不到）*/
    var _wsec = +(d && d.sec) || 0;
    var _wpay = +(d && d.pay) || 0;
    var _wexp = +(d && d.exp) || 0;
    var _wtxt;
    if ((d && d.msg) === 'TIME_TOO_SHORT') {
      _wtxt = '打工时间太短（不足 30 秒），这次没有结算';
    } else {
      var _mm = Math.floor(_wsec / 60), _ss = _wsec % 60;
      _wtxt = '打工结算：' + (_mm > 0 ? (_mm + ' 分 ') : '') + (_ss > 0 ? (_ss + ' 秒 ') : '') +
              '· 工资 ' + _wpay + ' · 经验 ' + _wexp;
    }
    _JOB_SETTLED_AT = Date.now();       /* 紧接着的 WORK_STOPPED 提示就别再刷了 ✓ */
    try { toast(_wtxt); } catch (eW1) { }
    try {
      if (_wpay > 0 && typeof fxNum === 'function') { fxNum('+' + _wpay + ' 金币', '#ffd83d', P.x, 2.9, P.z); }
    } catch (eW2) { }
    return;
  }
  if (t === 'jobround') {
    /* 打工轮次（每 12 秒一轮）：只弹小字，不刷屏 */
    try {
      var _wr = +(d && d.n) || 0;
      if (_wr > 0 && typeof fxNum === 'function') { fxNum('第 ' + _wr + ' 轮', '#9fe8ff', P.x, 3.2, P.z); }
    } catch (eW3) { }
    return;
  }
  if (t === 'eatfx') {
    /* ★ 2026-10-22（用户："使用后有效果提示，例如恢复了多少血"）
       服务端发的是【实际】恢复量（受上限影响后）*/
    var _en = String((d && d.name) || '食物');
    var _parts = [];
    if (+(d && d.hp) > 0) { _parts.push('生命 +' + d.hp); }
    if (+(d && d.qi) > 0) { _parts.push('灵气 +' + d.qi); }
    if (+(d && d.exp) > 0) { _parts.push('经验 +' + d.exp); }
    var _line = _en + (_parts.length ? ('：' + _parts.join(' · ')) : '（已满，没变化）');
    try { toast(_line); } catch (eEat1) { }
    try {
      if (typeof fxNum === 'function') { fxNum(_line, '#7ee08a', P.x, 2.9, P.z); }
    } catch (eEat2) { }
    try { if (typeof eatStart === 'function') { eatStart((d && d.model) || 'cup'); } } catch (eEat3) { }
    return;
  }
  if (t === 'skin') {              // ★ round485：服务器说"你的皮肤换了"
    try {
      if (typeof skinApplySelf === 'function') {
        skinApplySelf(d.key || '', (d && d.c) ? d.c : null);
      }
    } catch (eS1) { }
    return;
  }
  if (t === 'skinpage') {          // ★ round485：皮肤页数据（40 个状态 + 榜单）
    try {
      SKIN.items = d.items || [];
      SKIN.start = +d.start || 20000;
      SKIN.step = +d.step || 5000;
      SKIN.gold = +d.gold || 0;
      skinPageRender();
    } catch (eS2) { }
    return;
  }
  if (t === 'talents') {          // ★ 第 116 轮：天赋状态 ✓
    TAL.free = +d.free || 0;
    TAL.pts = d.pts || {};
    TAL.raw = d.raw || {};
    TAL.eff = d.eff || {};
    TAL.live = d.live || [];
    /* ★ round411：属性总览（服务器算好的：当前值 / 人物 / 装备 / 天赋 / 上限 ✓）
       ★ 客户端【不再自己算一遍】✗ 不然又是两套公式 ✓ */
    TAL.stats = d.stats || [];
    /* ★ round474：防具移速词条（走路速度要用 ✗ 不然只有数字没效果 ✓）*/
    TAL.speedGear = +d.speedGear || 0;
    TAL.perLevel = +d.perLevel || 3;
    TAL.ready = true;
    /* ★★ 第 117 轮：血量天赋会改生命上限 → 服务器会一并带上 hpm ✓
       这里必须接，不然加完血量界面不动 ✗（用户一定会问"生效了吗"✗）*/
    if (typeof d.hpm === 'number' && d.hpm > 0) {
      HPMAX = d.hpm;
      if (HP > HPMAX) { HP = HPMAX; }
      /* 第 192 轮：如果是【死着登录】的（存档 hp=0），
         服务器发来有效上限的这一刻就把血填满 ✓
         （服务器那边本来就是满血 ✓ 只是客户端自己记着 0 ✗）*/
      if (HP_FULL_PENDING) { HP_FULL_PENDING = false; HP = HPMAX; updHP(); }
      updHP();
    }
    if ((SETCFG.setTab || '') === 'talent') { talRender(); }
    /* ★ round467：正在看装备页时吃到装备变化 → 重画 ✓ */
    if ((SETCFG.setTab || '') === 'equip') { try { bagRender(); equipRender(); } catch (eE) { } }
    return;
  }
  /* ★ round310（P1 破坏）：服务端说"这几格变了"→ 改覆盖 + 重建那几片瓦片 ✓ */
  /* ★ F1：流体变了（流动 ✓）→ 改覆盖 + 重建那几片瓦片 ✓ */
  /* ★ round329：树/石被砍掉了 → 重建那一块 ✓ */
  /* ★ round348：外卖僵尸开始逃跑 → 播逃跑音效 ✓ */
  if (t === 'flee') {
    if (typeof fleePlay === 'function') { fleePlay(d && d.mid); }
    return;
  }
  if (t === 'propedit') {
    if (typeof propApplyEdits === 'function') { propApplyEdits(d && d.cells); }
    return;
  }
  if (t === 'fluedit') {
    if (typeof fluApplyEdits === 'function') { fluApplyEdits(d && d.cells); }
    return;
  }
  if (t === 'teredit') {
    if (typeof terApplyEdits === 'function') { terApplyEdits(d && d.cells); }
    return;
  }
  if (t === 'armor') {
    BAG.armor = d.a || null;
    if (d && d.iid !== undefined) { BAG.armorItemId = d.iid; }
    /* ★★★ 第 105 轮：这段我第 102 轮加过，但被后面的补丁冲掉了 ✗ 现在补回来 ★★★
       用户报："穿戴防具后血量还是没有变化"
       根因：客户端的 HPMAX 只在 core 里由 me 通道赋过值 ✗
            而【换防具】走的是这条 armor 消息 ✗ 这里没更新 → 上限当然不动 ✗
       （挨打其实已经变少了 ✓ 服务器算得没错 ✓ 只是显示的上限没跟上 ✗）
       ★ 又一次"同一处代码被多次改写、前一次的有效改动被冲掉"✗
         这已经是第 4 次了（弓朝向/五角星/continue 跳过/这次）✗
         → 以后我改这些 UI 处理块，改完会【立刻回头读一遍】✗ 别只信"脚本说 OK"✓ */
    if (typeof d.hpm === 'number' && d.hpm > 0) {
      HPMAX = d.hpm;
      if (HP > HPMAX) { HP = HPMAX; }
      /* 第 192 轮：如果是【死着登录】的（存档 hp=0），
         服务器发来有效上限的这一刻就把血填满 ✓
         （服务器那边本来就是满血 ✓ 只是客户端自己记着 0 ✗）*/
      if (HP_FULL_PENDING) { HP_FULL_PENDING = false; HP = HPMAX; updHP(); }
      updHP();
    }
    if ((SETCFG.setTab || '') === 'bag') { bagRender(); }
    return;
  }
  if (t === 'dur') {
    // ★ 第 59 轮：服务器定期推耐久（不推的话界面上的条子会停在旧值 ✗）
    if (BAG.weapon) { BAG.weapon.dur = d.d; BAG.weapon.durMax = d.m; }
    /* ★ 第 103 轮：防具耐久也一起更新 ✓（用户要求：防具的耐久度也补上 ✓）*/
    if (BAG.armor && typeof d.ad === 'number') {
      BAG.armor.dur = d.ad;
      BAG.armor.durMax = d.am;
    }
    BAG.dur = d.d; BAG.durMax = d.m;
    if ((SETCFG.setTab || '') === 'bag') { bagRender(); }
    return;
  }
  if (t === 'bagrefresh') {
    if (typeof bagFetch === 'function') { bagFetch(bagRender); }
    return;
  }
  if (t === 'ranktitleok') {
    /* ★★ round425：称号设置的回执（原来【没接这个包】✗
       表现：点了按钮头像上确实变了（服务器那边生效了 ✓）
             但界面上的高亮/说明不变 ✗ 看着像"没点上" ✓
       ★ 这就是"服务器做对了、客户端少接一条消息"的老坑 ✓）*/
    if (typeof rankOnTitleOk === 'function') { rankOnTitleOk(d || {}); }
    return;
  }
  if (t === 'baglockok') {
    /* ★★★ round412（用户："上锁后不能马上看到图标，得刷新"）★★★
       ★ 不能用 bagFetch：那要等【落库】✗ 而落库是排队的 ✓
         → 拉回来的还是旧数据 ✗ 图标不变 → 看着就是"没生效" ✓
       ★ 现在：服务器把【新状态】直接发过来 ✗ 客户端改这一格 + 重画 ✓ */
    var _bi2 = null;
    for (var _i3 = 0; _i3 < (BAG.items || []).length; _i3++) {
      if (String(BAG.items[_i3].id) === String(d.iid)) { _bi2 = BAG.items[_i3]; break; }
    }
    if (_bi2 && _bi2.item) {
      if (d.lock) { _bi2.item.locked = 1; } else { delete _bi2.item.locked; }
    }
    bagTipHide();                    /* 浮窗里那集按钮是旧的 ✗ 先收掉 ✓ */
    BAG.msg = d.lock ? ('已上锁：' + (d.name || '')) : ('已解锁：' + (d.name || ''));
    if ((SETCFG.setTab || '') === 'bag' || typeof bagRender === 'function') { bagRender(); }
    return;
  }
  /* ★★ round507：一键整理的回执（纯 id 数组）→ 就地重排 ✗ 不再重拉 647KB ✓ */
  if (t === 'bagsortok') {
    var _ord = (d && d.ids) || [];
    if (_ord.length) {
      var _byId = {}, _rest = [];
      for (var _bi = 0; _bi < (BAG.items || []).length; _bi++) {
        var _rec = BAG.items[_bi];
        _byId[String(_rec.id)] = _rec;
      }
      var _new = [];
      for (var _oi = 0; _oi < _ord.length; _oi++) {
        var _r2 = _byId[String(_ord[_oi])];
        if (_r2) { _new.push(_r2); delete _byId[String(_ord[_oi])]; }
      }
      for (var _lk in _byId) { if (_byId.hasOwnProperty(_lk)) { _rest.push(_byId[_lk]); } }
      BAG.items = _new.concat(_rest);       /* 服务器没列到的（理论上没有）放最后 ✓ */
      try { BAG_PAGE = 0; } catch (e0) { }   /* ★ 页号是全局 BAG_PAGE ✗ 不是 BAG.page ✓ */
      BAG.total = BAG.items.length;
      BAG.msg = '';
      bagRender();
      toast('背包已整理');
    }
    return;
  }
  if (t === 'weapon') {
    setWeapon(d.w || null);
    BAG.weapon = d.w || null;
    /* ★★ round507：服务器把 iid 一起推下来了 ✗ 就地改这两格就行 ✓
       以前：这里无条件 bagFetch → 一次穿装备 = 647KB（1420 件的号） → 5 秒 ✓✓ */
    if (d && d.iid !== undefined) { BAG.weaponItemId = d.iid; }
    BAG.busy = false;
    BAG.msg = '';
    _bagLocalApplied = true;
    if ((SETCFG.setTab || '') === 'bag') { bagRender(); }
    return;
  }
  if (t === 'chat') { toast('[' + (d['from'] || '?') + '] ' + (d.text || '')); return; }
  if (t === 'snd') {
    if (d.name) {
      var _sx = (typeof d.x === 'number') ? d.x : P.x;
      var _sz = (typeof d.z === 'number') ? d.z : P.z;
      sfxAt(d.name, _sx, _sz, (+d.v > 0 ? +d.v : 1.0));
    }
    return;
  }
  if (t === 'hurt') { netApplyHurt(d); return; }
  if (t === 'dead') { playerDie(d.by); return; }
  if (t === 'revived') {
    playerRevive();
    // ★ 以服务器给的时长为准（它才是权威 ✓）
    if (typeof INVULN_T !== 'undefined' && d.invuln) { INVULN_T = +d.invuln; }
    return;
  }
}

/* ---------- wsWelcome ---------- */
function wsWelcome(d) {
  /* ★ round463b：连上了 → 收横幅 ✓ */
  try { netBarHide(); } catch (eB) { }
  WSC.ready = true;
  WSC.role = d.role || null;
  if (d.cfg) { WSC.cfg = d.cfg; }
  /* ★ round442：记下服务器启动号（以后要判"重启过没"用得上 ✓ 现在挂机计数不用它 ✓）*/
  if (typeof d.boot === 'number') { WSC.boot = d.boot; }
  setWeapon((d.role && d.role.weapon) || null);   // ★ 第 47 轮：进世界就知道手上拿的是啥 ✓
  /* ★ round496：有未读公告 → 进世界第一件事先弹它 ✓
     （服务端只在"没看过"时才带 ann ✗ 所以这里不用再判断 ✓）*/
  try { if (d.ann && typeof annShow === 'function') { annShow(d.ann); } } catch (eA) { }
  /* ★ round485：进世界先套用自己的皮肤（服务端给 '' 就用老外观 ✓）*/
  try { if (typeof skinApplySelf === 'function') { skinApplySelf((d.role && d.role.skin) || ''); } } catch (eSk) { }
  /* ★ round511：拉我的皮肤自定义（瞳色/发色/眼型/嘴型）*/
  try { wsSend('skincustomask', {}); } catch (eSk2) { }
  MY_MQ = +((d.role && d.role.mq) || 0);   // ★ 第 152 轮：进世界先读自己的魔气 ✓
  WSC.myId = (d.role && d.role.id) || 0;
  NET.myUid = WSC.myId;
  /* ★★★ 第 110 轮修的真 bug（用户："坐标和血量没有保存退出时的"）★★★
     ★ 根因：服务器存了 ✓ 而 welcome 里也把 role（含 x/z/hp）发过来了 ✓
              但客户端【没有采用】✗
        · 位置：客户端是权威 ✓ → 它一进游戏就从 (0,0) 开始发位置包 ✗
                → 把服务器上存的位置【覆盖】掉了 ✗✓
        · 血量：客户端自己的 HP 从 200 开始 ✗ 没从服务器拿 ✗
     修：进游戏的第一件事 —— 先采用存档里的位置和血量 ✓
     （★ hp = 0 表示"按公式满值"✗ 这个约定不能忘 ✗ 所以只在 >0 时采用 ✓）*/
  if (d.role) {
    if (typeof d.role.x === 'number' && typeof d.role.z === 'number') {
      P.x = d.role.x; P.z = d.role.z;
      if (typeof d.role.yaw === 'number') { P.yaw = d.role.yaw; }
    }
    if (typeof d.role.hp === 'number' && d.role.hp > 0) {
      HP = d.role.hp;
    } else {
      /* ★★ 第 192 轮（用户："死亡后不是点复活、而是刷新，血量不会恢复满"）★★
         根因：存档里 hp=0 有两种含义 ✗
           ① 新角色（按公式满值 ✓）
           ② 上次死在世界里、下线时被写了 0 ✓
         服务器那边两种都按【满血】处理 ✓（进世界就是满的 ✓ 还能被打 ✓）
         但客户端这里只认 >0 ✗ → 它记着自己死前的 0 ✗
         → 表现：服务器满血 ✓ 你屏幕上血条是空的 ✓✓ 一字不差 ✓
         修：0 或缺省 → 先记个标记 ✗ 等服务器把【有效上限】发过来就填满 ✓
           （★ 不能现在就填 ✗ 那会儿还不知道上限（含防具加成）✓）*/
      HP_FULL_PENDING = true;
    }
    /* ★★ 第 111 轮修的真 bug（用户："血量只保存到了等级血量，防具加的血量没保存"）★★
       病根：这里原来拿 role.hpMax 当上限 ✗
            而 role.hpMax 是【角色基础】上限 ✗ 不含防具加成 ✗
            紧接着 `if (HP > HPMAX) HP = HPMAX` 就把存档里的血【夹回了 200】✗✓✓
            → 用户："退出时满血，进去只有 200 血"✓ 一字不差 ✓
       修：
         · role.hpMax 只当作【临时值】（防具消息马上就到 ✓）
         · ★ 关键：不要在这里夹血量 ✗ 交给服务器下发的有效上限去夹 ✓
           （服务器在进世界时会推一条 armor 消息，里面带 hpm = 有效上限 ✓）*/
    if (typeof d.role.hpMax === 'number' && d.role.hpMax > 0) {
      HPMAX = Math.max(HPMAX, d.role.hpMax);
    }
    updHP();
  }
  if (window.hideLogin) { hideLogin(); }
  /* ★ round443：进世界了 → 剩下的音效在后台慢慢加载 ✓ */
  try { if (!_sfxCoreLoaded) { _sfxCoreLoaded = true; setTimeout(warmSfxRest, 800); } } catch (e7) { }
  netGoOnline();        // ★ 清掉本地自己模拟的那几只 → 世界归服务器 ✓
  /* ★ 第 206 轮：进游戏时恢复上次的自动战斗开关（存了 SETCFG.auto ✓）*/
  try {
    if (typeof AUTO !== 'undefined' && typeof SETCFG !== 'undefined' && SETCFG.auto) {
      AUTO.on = true; AUTO.tgt = ''; AUTO.phase = 'find'; AUTO.info = '自动战斗：正在找目标…';
      /* ★★ round440：这一条路以前没设 t0 → 计时永远 0:00 ✗✗
         （用户："挂机的时间不会动"）→ 现在读上次存的，没有就从现在算 ✓ */
      try { autoStatRestore(); } catch (e9) { }
      if (SETCFG.autoLoot === false) { AUTO.lootOn = false; }
      autoUiUpd();
    }
  } catch (e) { }
  var nm = (d.role && d.role.name) || '';
  var lv = (d.role && d.role.level) || 1;
  if (window.showRole) { showRole(d.role); }
  toast('已进入世界：' + nm + '（炼气 ' + lv + ' 层）');
}

/* ---------- netInit ---------- */
function netInit() {
  var tk = '';
  try { tk = localStorage.getItem('token') || ''; } catch (e) { }
  if (!tk) { if (window.showLogin) { showLogin(''); } return; }
  WSC.token = tk;
  WSC.on = true;
  wsConnect();
}

/* ---------- autoLogin ---------- */
function autoLogin(name, pw) { doAuth('login', name, pw); }

/* ---------- playerDie ---------- */
function playerDie(byName) {
  HP = 0; dead = true; updHP();
  var d = document.getElementById('dead');
  var t = document.getElementById('deadBy');
  if (t) { t.textContent = byName ? ('你被 ' + byName + ' 击败') : '你被妖兽击败'; }
  if (d) { d.className = 'on'; }
  jx = 0; jy = 0; keys = {}; atkHeld = false;   // ★ 松开操作（不然倒下后还拖得动 ✗）
  try { if (typeof townSeatClear === 'function') { townSeatClear(null); } } catch (eD) { }
  sfx('zdeath', 1.0);
}

/* ---------- playerRevive ---------- */
function playerRevive() {
  if (!dead) { return; }
  dead = false; HP = HPMAX; updHP();
  /* ★★ 第 56 轮：复活要【告诉服务器】★★
     以前复活是纯本地的 ✗ → 服务器不知道 → 也就给不了无敌 ✗
     现在发 revive 意图：服务器补满血 + 1.5 秒无敌 ✓
     ★ 本地也先给自己 1.5 秒（乐观）—— 就算包慢，也不会在无敌生效前先挨一口 ✓ */
  if (typeof INVULN_T !== 'undefined') { INVULN_T = 1.5; }
  if (NET.on && WSC.ready) { wsSend('revive', {}); }
  var d = document.getElementById('dead');
  if (d) { d.className = ''; }
  shake = 0;
  dmg('复活', P.x, 3.2, P.z, true);
  toast('已复活 ✓');
}

/* ---------- bindDead ---------- */
function bindDead() {
  var b = document.getElementById('reviveBtn');
  if (!b) { return; }
  var go = function (e) { if (e) { e.preventDefault(); } playerRevive(); };
  b.addEventListener('touchstart', go, { passive: false });
  b.addEventListener('click', go);
}

/* ===== 登录浮层 ===== */


/* ============================================================
   登录 / 注册（独立版：自建账号，不再跟 MC 客户端共用）
   ============================================================ */
/* ============================================================================
   ★★ 第 213 轮（用户）★★
   ① 加载动画：云服务器慢的时候别让玩家看半成品
   ② 不同步检测：看门狗发现"服务器数据停了"就自动刷新一次
   ============================================================================ */

/* 揭开加载动画（能玩了才揭 ✓）*/
/* ============================================================================
   ★★★ 第 246 轮（用户："有玩家玩着玩着会白屏"）★★★

   白屏的现象（用户截图）：
     · 3D 世界全白 ✗ 没有地面、没有人物
     · 但 HUD 正常 ✓ 僵尸的名字和血条也正常 ✓（那些是 DOM ✓）
   → 说明【WebGL 画布死了 ✗ DOM 还活着】✓✓

   代码里原来【完全没有处理】✗ 所以一旦丢了就永久白屏 ✓

   两条保护：
     ① 渲染看门狗：主循环 5 秒没跑 → 自动刷新一次
        （WebGL 丢失 / 主循环抛异常 / 渲染卡死 都能兜住 ✓）
     ② WebGL 上下文丢失：先提示 ✗ 5 秒没恢复 → 刷新 ✓
   ★ 两种都复用现成的 20 秒防抖（sessionStorage ✓）不会刷成死循环 ✓
   ============================================================================ */
window._renderStalls = 0;

/* ★★★ round463b：世界快照看门狗 ✗✗
   为什么需要它：手机锁屏 / 切后台 → webview 的 JS 被挂起 ✗
     回来时 socket 已经死了，但 onclose 可能迟迟不触发 ✗
     → 界面停在旧画面，玩家看着像“还活着”，实际上已经断了 ✓
   做法：8 秒没收到 world → 直接硬重连（不等 onclose ✗）✓ */
(function worldWatchdog() {
  setInterval(function () {
    if (typeof WSC === 'undefined' || !WSC.ready || !WSC.on) { return; }
    /* ★ 后台时不判（手机锁屏后 rAF/计时器本来就会停 ✗ 误判会一直重连 ✓）*/
    if (document.visibilityState !== 'visible') { window._lastWorldT = Date.now(); return; }
    var gap = (Date.now() - (window._lastWorldT || Date.now())) / 1000;
    if (gap > 8) {
      console.log('[net] ' + gap.toFixed(1) + ' 秒没收到世界快照 → 硬重连');
      try { netBarShow('连接已断开，正在重连…'); } catch (e1) { }
      window._lastWorldT = Date.now();
      netHardReconnect('快照超时 ' + gap.toFixed(0) + ' 秒');
    }
  }, 2000);
})();

/* ★ round463b：从后台回到前台，立刻探一下连接还在不在 ✓ */
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState !== 'visible') { return; }
  if (typeof WSC === 'undefined' || !WSC.on) { return; }
  var gap = (Date.now() - (window._lastWorldT || Date.now())) / 1000;
  if (gap > 5 || !WSC.ready) {
    netHardReconnect('回到前台（' + gap.toFixed(0) + ' 秒没数据）');
  }
});

(function renderWatchdog() {
  var lastReload = 0;
  function softReload(why) {
    var now = Date.now();
    if (now - lastReload < 20000) { return; }
    lastReload = now;
    window._renderStalls++;
    try {
      var k = +(sessionStorage.getItem('autoReloadAt') || 0);
      if (now - k < 20000) { return; }        /* 和"断线重连"那套共用一个防抖 ✓ */
      sessionStorage.setItem('autoReloadAt', String(now));
    } catch (e) { }
    console.log('[render] ' + why + ' → 硬刷新一次（带 ?fresh 绕开缓存）');
    netHardReload('主循环卡住');
  }
  setInterval(function () {
    /* ★ 标签页在后台时 rAF 本来就会停 ✗ 别误判 ✓ */
    if (document.visibilityState !== 'visible') { return; }
    if (typeof WSC === 'undefined' || !WSC.ready) { return; }   /* 没进游戏前不管 ✓ */
    if (typeof LAST_FRAME_MS === 'undefined' || !LAST_FRAME_MS) { return; }
    var gap = (Date.now() - LAST_FRAME_MS) / 1000;
    if (gap > 5) { softReload('主循环卡住 ' + gap.toFixed(1) + ' 秒'); }
  }, 2000);

  /* ---- ② WebGL 上下文丢失 ---- */
  var cv = document.getElementById('cv');
  if (cv) {
    cv.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();                      /* ★ 不阻止的话浏览器不会尝试恢复 ✓ */
      console.log('[render] WebGL 上下文丢失了（画面会白 ✗ 正在等恢复）');
      showCanvasDead('画面恢复中…');
      setTimeout(function () {
        /* 5 秒还没恢复 → 刷新（比一直白着强 ✓） */
        if (document.getElementById('cvDead')) { softReload('WebGL 没恢复'); }
      }, 5000);
    }, false);
    cv.addEventListener('webglcontextrestored', function () {
      console.log('[render] WebGL 恢复了 ✓');
      hideCanvasDead();
    }, false);
  }
})();

/* 白屏期间给玩家一个说明（不让他以为是死机 ✓） */
function showCanvasDead(msg) {
  if (document.getElementById('cvDead')) { return; }
  var d = document.createElement('div');
  d.id = 'cvDead';
  d.style.cssText = 'position:fixed;left:0;right:0;top:38%;text-align:center;z-index:60;' +
    'color:#ffd83d;font-size:15px;font-weight:700;letter-spacing:1px;' +
    'text-shadow:0 2px 6px #000;pointer-events:none';
  d.textContent = msg || '画面恢复中…';
  document.body.appendChild(d);
}
function hideCanvasDead() {
  var d = document.getElementById('cvDead');
  if (d && d.parentNode) { d.parentNode.removeChild(d); }
}

/* ★★ round464：加载遮罩的【铁超时】✗✗
   以前只有一个出口（进了世界才收）✗
   任何一步卡住（SW、音效、网络）→ 永远盖着 → "下载不进去" ✓
   现在：20 秒到点无论如何都收掉 ✓（收了之后界面自己会说明状态 ✓）*/
setTimeout(function () {
  try {
    var b = document.getElementById('boot');
    if (b && !b._gone) {
      console.log('[boot] 20 秒超时 → 强制收掉加载遮罩');
      bootDone();
    }
  } catch (e) { }
}, 20000);

function bootDone() {
  var b = document.getElementById('boot');
  if (!b || b._gone) { return; }
  b._gone = true;
  b.classList.add('gone');
  setTimeout(function () { if (b.parentNode) { b.parentNode.removeChild(b); } }, 500);
}

/* 加载动画里的"重新载入"按钮 + 超时提示 */
(function bootGuard() {
  var t0 = Date.now();
  var iv = setInterval(function () {
    var b = document.getElementById('boot');
    if (!b || b._gone) { clearInterval(iv); return; }
    var s = (Date.now() - t0) / 1000;
    var m = document.getElementById('bootMsg');
    if (m) {
      if (s > 4) { m.textContent = '正在载入资源…（' + Math.floor(s) + ' 秒）'; }
    }
    if (s > 12) {
      var h = document.getElementById('bootHint');
      if (h) { h.style.display = 'block'; }
    }
  }, 1000);
  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'bootReload') { netHardReload('加载遮罩上的重新载入'); }
  });
})();

/* ★★ ② 不同步看门狗 ★★
   用户报的现象："看不到别人在移动，其实那个玩家就在身边"
   怎么可靠地判断（不靠"别人没动"✗ 因为人家可能真站着 ✓）：
     看【服务器数据还来不来】✗
       每个世界快照都会刷新 _lastWorldT ✓
       如果连接是好的（WSC.ready ✓）却 8 秒没收到任何快照
       → 说明客户端和服务器脱节了 → 刷新一次 ✓
   刷新有 20 秒防抖（复用断开重连那套 sessionStorage ✓ 不会刷成死循环 ✓）
   ★ 命令行 / 界面上都能看：window._desyncCount 记录刷新了几次 */
window._desyncCount = 0;
window._lastWorldT = Date.now();
setInterval(function () {
  if (typeof WSC === 'undefined' || !WSC.ready) { window._lastWorldT = Date.now(); return; }
  var gap = (Date.now() - window._lastWorldT) / 1000;
  if (gap > 8) {
    /* ★★★ round464（用户："点重连加载不进去了，只能关了 APP"）★★★
       这里以前也是 `location.reload()` ✗ 而且这条几乎每次掉线都会触发 ✗✗
       整页刷新在 APK 的 WebView 里会卡在加载遮罩（没法自拔）✗
       修：原地硬重连（不动页面）✓ 真要刷新就点横幅上的「刷新」✓ */
    window._desyncCount++;
    console.log('[net] 与服务器不同步（' + gap.toFixed(1) + ' 秒没收到世界数据）→ 原地重连');
    window._lastWorldT = Date.now();
    try { netBarShow('与服务器不同步，正在重连…'); } catch (e1) { }
    netHardReconnect('快照看门狗 ' + gap.toFixed(0) + ' 秒');
  }
}, 2000);

/* ★★★ round448：登录界面的氛围层（灰烬 + 远处闪电 ✗ 全程 2D canvas，零素材 ✓）
   ★ 只在登录界面显示时跑 ✗ 进游戏就停（不占帧 ✓） */
function showLogin(msg) {
  var el = document.getElementById('login');
  if (!el) { return; }
  el.classList.add('show');
  /* ★★★ round453b：先把加载遮罩关掉 ✗✗
     病根：#boot 一直盖在 canvas 上面（z-index 9999），
           而登录层是半透明的 → 透出来的是【遮罩的深褐背景】，
           根本不是游戏画面 ✗（难怪看着就是一片黑 + 背景不搭）
     修：登录层出现时就把加载遮罩收掉 ✓ */
  try { bootDone(); } catch (eB) { }
  /* ★★ round452/453：登录界面 → 电影镜头 + 藏掉 HUD（背景就是游戏画面 ✓） */
  try { window.LOGIN_CINE = true; } catch (e0) { }
  try { document.body.classList.add('atLogin'); } catch (e0b) { }
  if (msg) { document.getElementById('loginHint').textContent = msg; }
  var n = document.getElementById('loginName');
  if (n && !n.value) { setTimeout(function () { n.focus(); }, 60); }
}
function hideLogin() {
  bootDone();   /* ★ 第 213 轮：真正进游戏了才揭开加载动画 ✓ */
  /* ★ round452：进游戏 → 关掉电影镜头，回到正常跟随相机 ✓ */
  try { window.LOGIN_CINE = false; } catch (e0) { }
  try { document.body.classList.remove('atLogin'); } catch (e0b) { }
  var el = document.getElementById('login');
  if (el) { el.classList.remove('show'); }
}
function authBusy(on) {
  var a = document.getElementById('btnLogin'), b = document.getElementById('btnReg');
  if (a) { a.disabled = !!on; }
  if (b) { b.disabled = !!on; }
}
function doAuth(kind, nameIn, pwIn) {
  var name = nameIn || (document.getElementById('loginName') || {}).value || '';
  var pw = pwIn || (document.getElementById('loginPass') || {}).value || '';
  /* ★ 宣传片录制专用：URL 带 ?rec=1 时自动填录录制账号并登录（不做宣传时此分支永不触发）*/
  name = (name + '').trim();
  if (!name || !pw) {
    document.getElementById('loginHint').textContent = '游戏名和密码都要填';
    return;
  }
  authBusy(true);
  document.getElementById('loginHint').textContent = kind === 'reg' ? '注册中…' : '登录中…';
  fetch('/api/' + (kind === 'reg' ? 'register' : 'login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, password: pw })
  }).then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }); })
    .then(function (o) {
      authBusy(false);
      var j = o.j || {};
      if (!j.ok || !j.token) {
        document.getElementById('loginHint').textContent = j.error || ('失败（HTTP ' + o.s + '）');
        return;
      }
      try { localStorage.setItem('token', j.token); } catch (e) { }
      WSC.token = j.token;
      WSC.on = true;
      document.getElementById('loginHint').textContent = '';
      wsConnect();
    })
    .catch(function (e) {
      authBusy(false);
      document.getElementById('loginHint').textContent = '连不上服务器：' + e;
    });
}
function bindLogin() {
  var ln = document.getElementById('loginName'), lp = document.getElementById('loginPass');
  var bl = document.getElementById('btnLogin'), br = document.getElementById('btnReg');
  if (bl) { bl.onclick = function () { doAuth('login'); }; }
  if (br) { br.onclick = function () { doAuth('reg'); }; }
  var onKey = function (ev) { if (ev.key === 'Enter') { doAuth('login'); } };
  if (ln) { ln.onkeydown = onKey; }
  if (lp) { lp.onkeydown = onKey; }
  /* ★ 宣传片录制：URL 带 ?rec=1 → 自动填 bot01 并登录（录完删此段即可）*/
  try {
    if (new window.URLSearchParams(location.search).get('rec') === '1') {
      setTimeout(function () {
        var n = document.getElementById('loginName'), p = document.getElementById('loginPass');
        if (n) { n.value = 'bot01'; }
        if (p) { p.value = 'bot12345'; }
        doAuth('reg', 'bot01', 'bot12345');
        /* 已注册过会自动报"已存在"，再兜底登录一次 */
        setTimeout(function () { doAuth('login', 'bot01', 'bot12345'); }, 1500);
      }, 800);
    }
  } catch (eR) { }
}

/* ============================================================
   PWA：注册 Service Worker（离线缓存 / "添加到主屏幕" / 打 APK 必需）
   ★ 放在【平台层】—— 这是全项目唯一允许碰浏览器 API 的文件 ✓ core 一行都不用改
   ★ 第 28 轮之前这里根本没注册过：sw.js 写了但没人装 → 文档里"离线可开"是假的 ✗
   ★ 浏览器规定只有 https / localhost / 127.0.0.1 能用 SW（http + 局域网 IP 不行）——
     所以手机上通过 http://192.168.x.x 打开时【注册会失败】，这很正常，直接跳过就行，
     不影响游戏本身 ✓ 想要 PWA 就用 https（或走 APK 壳）✓
   ============================================================ */
/* ★★★ 2026-10-23（用户："推送时可以让用户自动刷新，而不是还要手动刷新"）★★★
   ★ 机制：/ws-config.js 里的 window.BUILD = 前端文件的最新 mtime ✗
     → 每 60 秒重新拉一次 /ws-config.js（带 cache-busting）✓
     → BUILD 变了 = 服务器更新过前端 → 自动刷新页面 ✓
   ★ 三个保护（不然会打断玩家 / 刷不停）：
     ① 只在【页面可见 + 不在战斗中】才刷 ✗ 战斗中推迟到脱战 ✓
     ② 刷新前给 6 秒缓冲 ✗ 顶部提示"游戏已更新，即将刷新"✓
     ③ 同一个 BUILD 只刷一次（sessionStorage 记着）✗ 防止死循环 ✓
*/
var UPD = { myBuild: '', timer: null, armed: false, done: false };
function updInit() {
  try { UPD.myBuild = String((typeof BUILD_TAG !== 'undefined' && BUILD_TAG) || ''); } catch (e) { }
  if (!UPD.myBuild || UPD.myBuild === '?') { return; }
  /* 上次已经因为这个 build 刷过 → 不再重复（防死循环）*/
  try {
    if (sessionStorage.getItem('updatedFor') === UPD.myBuild) { UPD.done = true; }
  } catch (e2) { }
  updSchedule();
}
function updSchedule() {
  if (UPD.timer) { clearTimeout(UPD.timer); }
  UPD.timer = setTimeout(updCheck, 60000);
}
function updCheck() {
  if (UPD.done) { return; }
  /* ★ 2026-10-23 修正：服务端生成 build 的接口是 /ws-config.js（不是 /boot.js ✗）*/
  var url = '/ws-config.js?_=' + Date.now();
  fetch(url, { cache: 'no-store' })
    .then(function (r) { return r.text(); })
    .then(function (txt) {
      var m = /window\.BUILD\s*=\s*"([^"]*)"/.exec(String(txt || ''));
      var srv = m ? m[1] : '';
      if (srv && srv !== UPD.myBuild && srv !== '0') {
        UPD.armed = true;
        try { sessionStorage.setItem('updatedFor', srv); } catch (e) { }
        updAnnounce();
      }
    })
    .catch(function () { })
    .then(function () { updSchedule(); });
}
/* 宣布更新：等他脱离战斗再刷 */
function updAnnounce() {
  try { toast('游戏已更新 · 即将自动刷新'); } catch (e) { }
  var waited = 0;
  var iv = setInterval(function () {
    waited += 1;
    /* 战斗中（有怪在打你 / 自己在挥刀）就继续等 ✗ 最多等 5 分钟 ✓ */
    var busy = false;
    try {
      /* 附近有活着的怪 → 算战斗中；最多等 5 分钟（waited 到 150 次 = 300 秒）*/
      if (waited < 150) {
        var rm = (typeof NET !== 'undefined' && NET.rmobs) ? NET.rmobs : null;
        if (rm) {
          for (var k in rm) {
            var o = rm[k];
            if (o && (o.hp === undefined || o.hp > 0)) { busy = true; break; }
          }
        }
      }
    } catch (e2) { busy = false; }
    if (!busy) {
      clearInterval(iv);
      UPD.done = true;
      setTimeout(function () {
        /* ★★★ 2026-10-23（用户："系统提示框还是没有位置记忆，重启服务器后跑到默认位置"）★★★
           ★ 病根：原来用 location.replace(pathname + '?u=...') ✗
             · 原地址可能是 "/" ✗ 替换成 "/index.html?u=xxx" → 换了文档名 ✓
             · 这种"换地址"的刷新在某些浏览器/Service Worker 下会
               重新起一个存储上下文 → localStorage 里刚存的设置读不到 ✓
           ★ 修：用最干净的 location.reload() ✓
             · SW 本来就有 CACHE_VERSION + skipWaiting ✓ 不需要靠 URL 参数破缓存 ✓
             · 同地址刷新 → localStorage / sessionStorage 完全不变 ✓ */
        try { location.reload(); }
        catch (e3) { location.href = location.href; }
      }, 800);
    }
  }, 2000);
}

(function bootServiceWorker() {
  try {
    if (!navigator.serviceWorker) { return; }
    var h = location.hostname;
    var okHost = (location.protocol === 'https:') || h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
    if (!okHost) { return; }
    navigator.serviceWorker.register('/sw.js').catch(function () { /* 装不上也照玩 ✓ */ });
  } catch (e) { /* 老浏览器没有 SW —— 无所谓 ✓ */ }
})();
/* ★ 2026-10-23：启动自动更新检查 */
try { updInit(); } catch (eUpd) { }





/* ============================================================
   ★★ 第 190 轮：传送按钮的启动代码 —— 【必须放在这里】★★
   为什么单独放文件末尾、而不是塞进某个函数：
     传送按钮是【常驻界面】的东西 ✗ 玩家不进菜单也要能用 ✓
     之前我把绑定写进了 openSet() ✓ → 只有开过菜单才生效 ✓✓
     （用户报的"点了没反应"就是这个 ✓）
   ★ 这里用 DOMContentLoaded 兜一下 ✗ 保证按钮元素已经解析出来 ✓
   ============================================================ */
(function tpBoot() {
  function go() {
    if (window.TP_BOOT_DONE) { return; }
    window.TP_BOOT_DONE = true;
    try { safeTpBind(); } catch (e) { }
    TPCAST.at = performance.now() / 1000;
    setInterval(function () { tpEnsureBtn(); tpBarRender(); autoBindAtk(); jumpBind(); runBind(); autoUiUpd();
      if (typeof uiDragInit === 'function') { uiDragInit(); }
      if (typeof uiEditBind === 'function') { uiEditBind(); } }, 100);   /* 100ms 一次 ✓ 便宜 ✓ 而且顺带保证按钮一定挂上 ✓ */
    tpBarRender();                      /* 先画一次，把按钮恢复成正常样子 ✓ */
  }
  if (typeof document === 'undefined') { return; }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', go);
  } else {
    go();
  }
})();
