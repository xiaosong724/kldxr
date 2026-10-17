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

var UI = {
  /* ---- 画布与窗口 ---- */
  mainCanvas: function () { return document.getElementById('cv'); },
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
UI.plate = {
  show: function (ui, on) { if (ui && ui.wrap) { ui.wrap.style.display = on ? 'block' : 'none'; } },
  move: function (ui, sx, sy) {
    if (ui && ui.wrap) {
      ui.wrap.style.transform =
        'translate(-50%,-100%) translate(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px)';
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
      el.style.cssText = 'position:absolute;left:50%;transform:translateX(-50%);bottom:100%;'
        + 'font-size:11px;font-weight:700;line-height:1.15;white-space:nowrap;'
        + 'text-shadow:0 1px 2px #000,0 0 3px #000';
      ui.wrap.insertBefore(el, ui.wrap.firstChild);   // ★ 插到最前面 = 名字上面那行 ✓
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
  hpWidth: function (ui, pct) { if (ui && ui.bar) { ui.bar.style.width = pct; } },
  hpColor: function (ui, color) { if (ui && ui.bar) { ui.bar.style.background = color; } },
  /* ★ 第 87 轮：加颜色参数 ✓
     ★ 踩过的坑：第 86 轮我插"带颜色的 name"时锚点是 remove: function (m) ✗
       结果插进了【UI.mark】✗ 而 plate 这个两参数的没动 ✗
       → 表现是"五角星有了、但颜色没变"✓（静默失效，最难查 ✗）*/
  name: function (ui, s, color) {
    if (!ui || !ui.name) { return; }
    if (ui.name.textContent !== s) { ui.name.textContent = s; }
    if (color && ui.name.style.color !== color) { ui.name.style.color = color; }
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
function loadSfx() {
  /* ★ 优先 WAV（PCM 解码瞬时 ✓ 比 MP3 快得多 ✓）
     失败回退 MP3 → OGG ✓ 三级保障 ✓ 加载完自动补播排队音效 ✓ */
  for (var k in SFX_FILES_WAV) {
    SFX_BANK[k] = [];
    var list = SFX_FILES_WAV[k];
    for (var i = 0; i < list.length; i++) {
      SFX_TOTAL++;
      tryOne(k, '/assets/sfx/' + list[i], 2);   // 2 = wav
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
var NUM_CAP = 16, _numPool = [], _numNext = 0, _numLive = 0;
function _numSlot() {
  if (_numPool.length < NUM_CAP) {
    var el = document.createElement('div');
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
function _numFlyAt(txt, color, sx, sy, big, life) {
  var o = _numSlot();
  o.busy = true; o.life = life; o.x0 = sx; o.y0 = sy;
  o.el.textContent = txt;
  o.el.style.display = 'block';
  o.el.style.color = color;
  o.el.style.fontSize = (big ? 22 : 16) + 'px';
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
        o.el.style.transform = 'translate3d(' + o.x0.toFixed(1) + 'px,' +
          (o.y0 - 46 * k).toFixed(1) + 'px,0)';
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
      else { o.el.style.transform = 'translate3d(' + o.x0.toFixed(1) + 'px,' +
             (o.y0 - 46 * k).toFixed(1) + 'px,0)'; o.el.style.opacity = String(1 - k);
             requestAnimationFrame(lp); }
    })(); } });
  }
}
/* 老接口保留 ✓ 内部全部走池 */
function _numProject(x, y, z, txt, color, big, life) {
  if (!REUSE_V3.v) { REUSE_V3.v = new THREE.Vector3(); }
  var v = REUSE_V3.v.set(x, y, z).project(cam);
  if (v.z < -1 || v.z > 2) { return; }
  _numFlyAt(txt, color, (v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight,
            big, life);
}

function dmg(txt, x, y, z, big) {
  // ★ 第 77 轮：全部走复用池 ✓ 不再 new div ✗
  _numProject(x, y, z, txt, big ? '#ffd83d' : '#fff6e8', big, 700);
}

/* ---------- healNum（治疗数字：绿色 + 号 ✓ 第 46 轮）----------
   ★ 用户反馈"医生的治疗效果看不出关联" —— 所以被治的僵尸头顶要弹一个绿字 ✓
     和 dmg 一套做法（core 只说"在哪个像素、写什么字"，不碰 style ✓） */
/* ★ 第 62 轮：指定颜色的飘字（dmg 的颜色写死了 ✗ 效果文字要区分颜色 ✓）*/
function fxNum(txt, color, x, y, z) {
  // ★ 第 77 轮：走池 ✓
  _numProject(x, y, z, txt, color, false, 660);
}

function healNum(txt, x, y, z) {
  // ★ 第 77 轮：走池 ✓
  _numProject(x, y, z, txt, '#7ee08a', false, 660);
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
  function atkDown(e) { if (e) { e.preventDefault(); } if (UI_EDIT) { return; } atkHeld = true; }
  function atkUp(e) { if (e) { e.preventDefault(); } atkHeld = false; }
  if (atk) {
    atk.addEventListener('touchstart', atkDown, { passive: false });
    atk.addEventListener('touchend', atkUp, { passive: false });
    atk.addEventListener('touchcancel', atkUp, { passive: false });
    atk.addEventListener('mousedown', atkDown);
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
  var gt = document.getElementById('goldTxt');
  if (gt) {
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
}

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
    /* ★ 攻击键大小（第 31 轮）：写进 CSS 变量 --atk，#atk 的宽高/字号都跟着它走 ✓
       （用变量而不是直接改 style，是为了让"按下缩放"那类 CSS 动画还能正常工作 ✓）*/
    try {
      document.documentElement.style.setProperty('--atk', setAtkSize() + 'px');
    } catch (e2) { }
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
  ['qi', '灵气', '点'], ['mana', '法力', '点'],
  ['crit', '暴击', '%'], ['anticrit', '免爆', '%'],
  ['dodge', '闪避', '%'], ['hit', '命中', '%'],
  ['critdmg', '爆伤', '%'], ['pen', '穿透', '%']
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
  return '<div class="ptLine" style="justify-content:space-between">' +
    '<span style="min-width:74px">' + nm + (live ? '' :
      ' <span class="bagTip" style="color:#9aa4b2">待PvP</span>') + '</span>' +
    '<span style="min-width:96px;text-align:right;color:#8ee0ff">' + show + '</span>' +
    '<span class="bagTip" style="min-width:52px;text-align:right">' + pts + ' 点投</span>' +
    '<button class="bagB talB" data-k="' + k + '" data-n="-1"' +
      (pts > 0 ? '' : ' disabled') + '>−</button>' +
    '<button class="bagB talB" data-k="' + k + '" data-n="1"' +
      (TAL.free > 0 ? '' : ' disabled') + '>+</button>' +
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
var WIKI = [
  { k: 'auto', t: '自动战斗', h: [
    ['怎么开关', [
      '★ <b>按住右下角攻击键 3 秒</b> → 自动战斗开启（按钮变绿 + 弹提示）',
      '★ 再按住 3 秒 → 关闭',
      '也可以走 菜单 → 操作 → 勾选"自动战斗"（和长按是同一个开关）'
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
      '背包物品：随机 1 件<b>没装备的</b>，必夺',
      '★ 穿戴中的装备也可能被扒走，但只有 <b>1%</b> 概率（耐久原样保留）',
      '同一个人：夺取（经验/背包）最多 10 秒一次，魔气最多 15 秒一次',
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
      '出生点周围 <b>30×30</b> 的方块是安全区（地面是浅色石板 + 金色边线，一眼认得出）',
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
    ['上限只管有效值', '投入点数没有上限。比如闪避堆到 40% 也没关系，只有"有效闪避"被压在 30%。'],
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
      for (var l = 0; l < sec[1].length; l++) { out.push('· ' + sec[1][l] + '<br>'); }
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
  var r = WSC.role || {};
  var lv = r.level || 1;
  var el1 = document.getElementById('stSelf');
  var el2 = document.getElementById('stWeapon');
  var el3 = document.getElementById('stArmor');
  var el4 = document.getElementById('stTotal');
  if (!el1) { return; }

  /* ---- 人物 ---- */
  /* ★★★ 第 223 轮修的真 bug（用户问"needExp 是什么问题"时查出来的）★★★
     这里原来自己写了一套公式： 60 + 24L + 2.4L²
     而服务器（和客户端上面那个 expNeed）用的是：
         (6 + 1.3L) × (10 + 4L + 0.12L²)
     两套差多少（实测）：
         等级 13 → 真实需要 1884 ✗ 这里显示 778（少了 59%）
         等级 62 → 真实需要 62290 ✗ 这里显示 10774（少了 83%）
     → 玩家在角色信息页看到"经验 1780 / 778"
     → 看起来早就该升级了 ✓✓
     → ★ 这就是用户之前那个"怎么杀一只就够升级了"的印象来源 ✓
     ★ 而且注释里写着"和服务器同一个公式"✗ 其实根本不是 ✗
       （写注释的时候是这么打算的 ✓ 实现的时候写错了 ✓）
     修：直接用上面那个 expNeed()（已经是正确公式 ✓）
         服务器的 need 优先 ✗ 没有才本地兜 ✓（和 updExp 的写法保持一致 ✓）*/
  var need = Math.round((WSC.role && WSC.role.need) || expNeed(lv));
  if (WSC.role && typeof WSC.role.needExp === 'number' && WSC.role.needExp > 0) {
    need = WSC.role.needExp;
  }
  el1.innerHTML =
    stRow('名字', (r.name || '?'), '') +
    stRow('境界', '炼气 ' + lv + ' 层', '') +
    stRow('经验', (r.exp || 0) + (need ? (' / ' + need) : ''), need ? '满了就升级' : '') +
    stRow('固有攻击', Math.round((typeof wInherent === 'function') ? wInherent() : 0),
          '只跟等级有关，和装备无关') +
    /* ★★ 第 118 轾（方案第 5 步）：属性页里标出【天赋贡献】★★
       不标的话，玩家只知道自己变强了，不知道是天赋带来的 ✗ */
    (((typeof TAL !== 'undefined') && TAL.raw && TAL.raw.atk)
      ? stRow('其中天赋', '+' + Math.round(TAL.raw.atk), '天赋里点的攻击') : '') +
    stRow('生命', Math.round(HP) + ' / ' + Math.round(HPMAX), '') +
    (((typeof TAL !== 'undefined') && TAL.raw && TAL.raw.hp)
      ? stRow('其中天赋', '+' + Math.round(TAL.raw.hp), '天赋里点的血量') : '') +
    stRow('灵气', '等技能系统做了一起展示', '现在灵气还没有用处');
    /* ★ 第 152 轮：自己的魔气（属性页 ✓）*/
    + stRow('魔气值', (MY_MQ > 0 ? (MQ_ICON + MY_MQ) : '0'),
        (MY_MQ > 0
          ? ('伤害 +' + Math.min(50, MY_MQ) + '% · 夺取概率 ' + mqStealPct(MY_MQ).toFixed(1) +
             '% · 夺取经验 ' + mqExpPct(MY_MQ) + '（详见 菜单→百科→魔气值）')
    /* round294: gold. Read from the `me` payload (WSC.role.gold) - the
       server sends it every tick, so this never goes stale. */
    + stRow('金币', fmtGold((WSC.role && WSC.role.gold) || 0), GOLD_COL)
          : '没有魔气（杀人才会涨，详见百科）'))

  /* ---- 武器 ---- */
  var w = MY_WEAPON;
  if (w && w.slot === 'weapon') {
    var s = wStatsOf(w);
    var m = wMastery(w);
    el2.innerHTML =
      stRow('武器', (w.name || '?') + '（' + ((w.tier || 0) + 1) + ' 阶）', '') +
      stRow('发挥度', Math.round(m * 100) + '%',
            m < 1 ? ('建议 ' + (w.reqLevel || 1) + ' 级，你现在 ' + lv + ' 级') : '已满') +
      stRow('实际每击', Math.round(wRealHit(w)), '含发挥度和封顶') +
      stRow('每秒伤害', Math.round(wRealDps(w)), '含暴击期望') +
      stRow('攻速', '×' + s.spd.toFixed(2) + '（' + wInterval(w).toFixed(2) + ' 秒一刀）', '') +
      stRow('范围', s.reach.toFixed(1) + ' 米 · ' + rangeWord(s.reach), arcWord(s.arc)) +
      ((w.affixes && w.affixes.length) ? stRow('词条', w.affixes.length + ' 条',
        w.affixes.map(function (a) { return a.text; }).join(' · ')) : '') +
      ((+w.durMax > 0) ? stRow('耐久', ((typeof w.dur === 'number') ? w.dur : w.durMax) +
        ' / ' + w.durMax, '还能挥这么多次') : '');
  } else {
    el2.innerHTML = '<div class="bagTip">空手（捡到武器后在背包里点【使用】）</div>';
  }

  /* ---- 防具 ---- */
  var ar = BAG.armor;
  if (ar && ar.base) {
    var b = ar.base || {};
    el3.innerHTML =
      stRow('防具', (ar.name || '?') + '（' + ((ar.tier || 0) + 1) + ' 阶）', '') +
      stRow('减伤', (Math.round((+b.dr || 0) * 10) / 10) + ' 点',
            '挨打时先扣这么多（最多扣到只剩 30%）') +   // ★ 第 118 轮：地板 30% ✓
      stRow('生命上限', '+' + Math.round(+b.hp || 0), '') +
      ((ar.affixes && ar.affixes.length) ? stRow('词条', ar.affixes.length + ' 条',
        ar.affixes.map(function (a) { return a.text; }).join(' · ')) : '') +
      ((+ar.durMax > 0) ? stRow('耐久', ((typeof ar.dur === 'number') ? ar.dur : ar.durMax) +
        ' / ' + ar.durMax, '还能挨这么多次') : '');
  } else {
    el3.innerHTML = '<div class="bagTip">没穿防具（背包里点防具 → 使用 → 会穿到武器槽右边）</div>';
  }

  /* ---- 合计 ---- */
  var mates = (typeof PARTY !== 'undefined' && PARTY.roster) ? PARTY.roster.length : 0;
  el4.innerHTML =
    stRow('生命上限', Math.round(HPMAX), '基础 + 防具 + 词条') +
    stRow('减伤（固定）', (BAG.armor && BAG.armor.base)
      ? (Math.round((+BAG.armor.base.dr || 0) * 10) / 10) + ' 点' : '0 点', '防具给的，先扣') +
    stRow('减伤（百分比）',
      ((typeof TAL !== 'undefined') && TAL.eff && TAL.eff.dr)
        ? (TAL.eff.dr.toFixed(1) + '%') : '0.0%',
      '天赋给的，后算（最多减到只剩 30%）') +
    stRow('队伍', mates ? (mates + ' 人（' + mates * 0 + '队友击杀你拿 10% 经验）') : '没组队',
          mates ? '' : '菜单 → 组队 里可以组队') +
    '<div class="bagTip" style="margin-top:6px">★ 敌人打你的伤害 = 它的攻击力 − 你的减伤，' +
    '最后至少留 30% ✓</div>';
  /* ★★ round304e（用户要求）：【金币】页签删掉了 ✗ 这段同步代码跟着删 ✓
     round294b 当时为什么把它放这儿：它必须写在【语句位置】✗
       塞进上面那串 stRow() 拼接里会把语法弄坏（真发生过 ✓）
     ★ 现在删掉是安全的 ✗ 因为金币在别处都看得到：
       左上角常驻那一行 / 背包顶部 / 交易所页面顶部 ✓
     ★ 顺手确认：没有任何地方还引用 goldBig / goldDetail ✓（自测会扫一遍 ✓）*/
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

function ptRender() {
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
function setTab(name) {
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
  var tabs = document.querySelectorAll('#setTabs .tab');
  for (var i = 0; i < tabs.length; i++) {
    var on = (tabs[i].getAttribute('data-tab') === name);
    tabs[i].className = 'tab' + (on ? ' on' : '');
  }
  /* 第 272 轮（用户：把画面/操作/音效合成"设置"）
     最低风险做法：不动 HTML 结构 ✗ 三个面板还在原地 ✓
     只在这里"选设置时把它们一起显示"✓（搬 HTML 容易把别的钩子搬坏 ✗） */
  var _mergePanes = { view: ['view', 'ctrl', 'audio'] };
  /* ★★★ 第 273 轮（用户："为什么变成三个滑动条，我需要他们是在一个页面里"）★★★
     病根：三个面板各自带 overflow-y:auto ✗
       → 于是变成三条独立滚动条 ✓（用户看到的 ✓）
     ★ 修：给外层 #setPanel 加一个 merge 类 ✗
       CSS 里在这个类下把三个面板的【滚动关掉 + 高度放开】✓
       → 它们就拼成一个连续页面 ✗ 只有一条滚动条 ✓✓ */
  var _sp = document.getElementById('setPanel');
  if (_sp) {
    if (_mergePanes[name]) { _sp.classList.add('merge'); }
    else { _sp.classList.remove('merge'); }
  }
  var _want = _mergePanes[name] || [name];
  var panes = document.querySelectorAll('#setPanel .tabpane');
  var hit = false;
  for (var j = 0; j < panes.length; j++) {
    var on2 = (_want.indexOf(panes[j].getAttribute('data-pane')) >= 0);
    panes[j].className = 'tabpane' + (on2 ? ' on' : '');
    if (on2) { hit = true; }
  }
  if (!hit) { return setTab('view'); }   // 存了个不存在的分类 → 退回第一页 ✓
  SETCFG.setTab = name;
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
  if (name === 'bag') { bagFetch(bagRender); }   // ★ 切到背包页就拉一次（只读接口 ✓ 很便宜）
  if (name === 'stat') { statRender(); }         // ★ 第 119 轮：属性页
  if (name === 'talent') { talBind(); talRender(); }   // ★ 第 119 轮：天赋页
  if (name === 'wiki') { wikiBind(); wikiRender(); }   // ★ 第 148 轮：百科页
  setTimeout(setTabsHintUpd, 0);   // ★ 第 169 轮：切页后重算滚动提示 ✓
  if (name === 'party') { ptRender(); }          // ★ 第 119 轮：组队页（一个毛病 ✓ 一起修）
  return name;
}

/* ---------- closeSet / doLogout（第 32 轮）---------- */
function closeSet() {
  bagTipHide();
  var p = document.getElementById('setPanel');
  if (p) { p.style.display = 'none'; }
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
function openSet(wantTab) {
  var p = document.getElementById('setPanel');
  if (!p) { return; }
  p.style.display = 'block';
  // ★ 第 48 轮：openSet('bag') 可以直接停在背包页（快捷键 B 用 ✓）
  if (wantTab) { setTab(wantTab); }
  ptBind();                                   // ★ 第 83 轮：组队页绑定 ✓
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
  /* ★★ 第 210 轮：自动战斗的设置项（放在"操作"分类最前面 ✓）★★ */
  var _ao = document.getElementById('setAutoOn');
  if (_ao) {
    _ao.checked = !!(typeof AUTO !== 'undefined' && AUTO.on);
    _ao.onchange = function () {
      if (typeof AUTO === 'undefined') { return; }
      if (!!AUTO.on !== _ao.checked) { autoToggle(); }
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
  }

  /* ★ 账号（第 32 轮）：登录 / 登出 / 切换账号都挪到这儿了 ✓ */
  var acct = document.getElementById('rowAcct');
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
    av.innerHTML = '末日丧尸 × 组队修仙 · 独立版<br>' +
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

function iconOfItem(it) {
  if (!it) { return ITEM_ICON.box; }
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
function wFlat(it) {
  var b = wBase(it);
  if (!b) { return 0; }
  if (it && it.flat0) { return 0; }        // ★ 空手没有平伤（第 58 轮 ✓）
  var ti = Math.max(0, Math.min(11, it.tier || 0));
  var lv = Math.max(1, it.itemLv || 1);
  return W_TIER_FLAT[ti] * (1 + 0.06 * (lv - 1));
}
function wDamage(it) {          // 武器伤害 = 平伤 + 系数 × 100
  var b = wBase(it);
  if (!b) { return 0; }
  return wFlat(it) + (+b.coeff || 1) * W_REF;
}
function wCrit(it) { return wDamage(it) * 1.5; }
function wInterval(it) {
  var b = wBase(it);
  var spd = b ? (+b.atkSpeed || 1.15) : 1.15;
  return 0.62 / Math.max(0.6, Math.min(2.2, spd));
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
  var spd = b ? (+b.atkSpeed || 1.15) : 1.15;
  var reach = b ? (+b.reach || 2.4) : 2.4;
  var arc = b ? (+b.arc || 1.05) : 1.05;
  return { reach: reach, arc: arc, spd: spd };
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
function wMastery(it) {
  var req = +((it && it.reqLevel) || 1);
  var lv = (WSC.role && WSC.role.level) || 1;
  if (req <= 1 || lv >= req) { return 1; }
  // ★ 第 60 轮：下限 0.40 → 0.90（和 server/weapons.py 的 MASTERY_FLOOR 一致 ✓）
  var F = 0.90;
  var v = F + (1 - F) * (lv / req);
  return Math.max(F, Math.min(1, v));
}
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
      var out = '<span style="color:#ffd83d">词条 ' + it.affixes.length + ' 条：</span>';
      for (var ai = 0; ai < it.affixes.length; ai++) {
        var af = it.affixes[ai];
        out += '<span style="color:#8ee0ff">· ' + (af.text || af.name || '') +
          '</span>';
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
   每页 35 格 = 5 行 × 7 列 ✓（宽 7 ✓）
   ★ 为什么在客户端分页而不是服务器分批取：
     背包本来就只有几十件 ✗ 客户端一次拿全 ✓ 翻页只是"少画一些格子"✓
     服务器那边一个字都不用改 ✓（也不用改协议 ✓）
   ★ 空位也要画满 35 个 ✓ 不然最后一页会"越画越小"✗ 看着不像格子 ✓ */
var BAG_PAGE_SIZE = 35;
var BAG_PAGE = 0;

function bagPageCount() {
  var n = (BAG.items || []).length;
  return Math.max(1, Math.ceil(n / BAG_PAGE_SIZE));
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
  tpBind();
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
function makeDraggable(id) {
  var el = document.getElementById(id);
  if (!el || el._dragInit) { return; }
  el._dragInit = true;
  var KEY = 'uiPos_' + id;
  // ★ 先恢复上次的位置
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && typeof saved.l === 'number') {
      el.style.left = saved.l + 'px';
      el.style.top = saved.t + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    }
  } catch (e) { }
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
    _dragSt = { el: el, key: KEY, x: e.clientX, y: e.clientY,
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
    }
    var w = st.el.offsetWidth, h = st.el.offsetHeight;
    var nl = Math.max(0, Math.min(window.innerWidth - w, st.l + dx));
    var nt = Math.max(0, Math.min(window.innerHeight - h, st.t + dy));
    st.nl = nl; st.nt = nt;
    st.el.style.transform = 'translate(' + (nl - st.l) + 'px,' + (nt - st.t) + 'px)';
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
    st.el.style.transform = '';
    st.el.style.left = nl + 'px';
    st.el.style.top = nt + 'px';
    st.el.style.right = 'auto';
    st.el.style.bottom = 'auto';
    try {
      localStorage.setItem(st.key, JSON.stringify({ l: Math.round(nl), t: Math.round(nt) }));
    } catch (e3) { }
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

function uiDragInit() {
  makeDraggable('atk');
  makeDraggable('jmp');
  makeDraggable('auto');
  autoBind();
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
  /* ★ 关掉时把阶段和目标一起清掉 ✗ 免得下一帧 AI 还接着跑 ✓ */
  if (!AUTO.on) { AUTO.phase = 'find'; AUTO.tgt = ''; AUTO.detourT = 0; }
  AUTO.tgt = ''; AUTO.phase = 'find'; AUTO.t = 0; AUTO.kills = 0;
  AUTO.deaths = []; AUTO.pauseUntil = 0; AUTO.stuckT = 0;
  AUTO.info = AUTO.on ? '自动战斗：正在找目标…' : '';
  /* ★ 第 209 轮：关掉时立刻把摇杆还回去 ✗ 不然人会一直往前走 ✓ */
  try { if (typeof autoRelease === 'function') { autoRelease(); } } catch (e) { }
  try { if (typeof SETCFG !== 'undefined') { SETCFG.auto = AUTO.on; } saveSet(); } catch (e) { }
  autoUiUpd();
  toast(AUTO.on ? '自动战斗已开启（再长按攻击键 3 秒关闭）' : '自动战斗已关闭');
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
function tpBind() {
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

function bagRender() {
  var grid = document.getElementById('bagGrid');
  var eqs = document.getElementById('bagEqSlot');
  var st = document.getElementById('bagStat');
  var mg = document.getElementById('bagMsg');
  var cnt = document.getElementById('bagCount');
  if (!grid || !eqs || !st) { return; }

  /* ---- 背包格子（7 列 ✓ 每页 35 格 ✓ 空位也画出来 → 才像格子而不是列表 ✓）---- */
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
    var lowm = isW ? (wMastery(it) < 1) : false;      // 发挥不满 → 黄标（不是锁 ✓）
    var n = (e.stack || 1);
    var bg = 'background:linear-gradient(180deg,' + tierRgba(it.tier || 0, 0.40) + ','
             + tierRgba(it.tier || 0, 0.18) + ')';
    html += '<div class="slot' + cur + sel + (_pk ? ' pick' : '') + (lowm ? ' lowmastery' : '') +(brk ? ' broken' : '') +  '" style="' + bg + '"' +
      ' data-id="' + e.id + '" data-w="' + (isW ? 1 : 0) + '" data-i="' + i + '"' +
      (lowm ? (' title="建议 ' + (it.reqLevel || 1) + ' 级（发挥 ' +
        Math.round(wMastery(it) * 100) + '%）"') : '') + '>' +
      (BAG.multi ? ('<span class="pickbox">' + (_pk ? '✓' : '') + '</span>') : '') +
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
  /* 第 171 轮（用户 #4）：空位要按【每页 35 格】补。
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
    if (selIsEquipped) {
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
  var sellable = !!(selItem && !selIsEquipped && selItem !== DEFAULT_W && sellId
                       && !selItem.broken && !selItem.locked_by && !selItem.locked);
  if (sellBtn) {
    sellBtn.disabled = !sellable;
    sellBtn.className = sellable ? 'bagB' : 'bagB off';
  }
  /* round303: 批量按钮的亮/灰 + 提示文字 ✓（勾了几件也写在那里 ✓）*/
  var _sortBtn = document.getElementById('bagSort');
  if (_sortBtn && !_sortBtn._b) {
    _sortBtn._b = true;
    _sortBtn.onclick = function () {
      /* ★ round304v（用户："一键整理"）★
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
      ? '点格子勾选 ✓ 再点【批量出售】'
      : '勾选多件一起卖（5 阶以上会再确认一次）';
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
    mktBtn.disabled = !sellable;
    mktBtn.className = sellable ? 'bagB' : 'bagB off';
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
    if (_priceEl && sellable && String(mktBtn._sid) !== String(sellId)) {
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
      if (j && j.failed) { toast('有 ' + j.failed + ' 件没能卖出（状态已变化）'); }
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
    extra += '实际每击 <b>' + wRealHit(it).toFixed(0) + '</b> · 每秒 <b>' +
      wRealDps(it).toFixed(0) + '</b><br>' +
      '武器强度 <b>' + wStrength(it).toFixed(0) + '</b>（纯比较用、不含你的等级）<br>' +
      '范围 <b>' + s.reach.toFixed(1) + '</b> 米（' + rangeWord(s.reach) + '）<br>' +
      '打击面：' + arcWord(s.arc) + '<br>' +
      '攻速 ×' + s.spd.toFixed(2) + '（' + wInterval(it).toFixed(2) + ' 秒一刀）<br>';
  } else if (it.slot === 'armor' && it.base) {
    /* ★★ 第 107 轮（用户选的 B：悬停那个浮窗信息太少）★★
       根因：这段"详细信息"原来【只给武器拼】✗（if slot === 'weapon' ✓）
            防具进来是空的 → 浮窗只剩名字和品阶 ✓ 用户："提示信息太简单了"✓
       用户要求：不用补得特别完整，重要的有就行 ✓
       → 只放四样：减伤 / 生命上限 / 词条条数 / 耐久 ✓ */
    var bA = it.base || {};
    extra += '减伤 <b>' + (Math.round((+bA.dr || 0) * 10) / 10) + '</b> 点 · ' +
      '生命上限 <b>+' + Math.round(+bA.hp || 0) + '</b><br>';
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
      var afGTxt = [];
      for (var ig = 0; ig < afG.length; ig++) { afGTxt.push(afG[ig].text || ''); }
      extra += '<span style="color:#8ee0ff">词条 ' + afG.length + ' 条：' +
        afGTxt.join(' · ') + '</span><br>';
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
  } else if (!it.slot) {
    /* ★ round304g：材料也要说清楚（原来只写"材料（以后做合成用）"✓）*/
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
    '<i> · ' + ((it.tier || 0) + 1) + ' 阶' + (it.itemLv ? (' · 物品 ' + it.itemLv + ' 级') : '') +
    '</i>' + lvlTxt + '<br>' + extra +
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
    if (act === 'off') { bagUnequip(); bagTipHide(); return; }
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
  setTimeout(function () { BAG.busy = false; bagFetch(bagRender); }, 420);
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
  setTimeout(function () { BAG.busy = false; bagFetch(bagRender); }, 420);
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
  setTimeout(function () { BAG.busy = false; bagFetch(bagRender); }, 420);
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


function toast(msg) {
  if (!_toastEl) {
    _toastEl = document.createElement('div');
    window._toastElRef = _toastEl;      /* 第 248 轮：弹幕挪动时要用它 ✓ */
    _toastEl.style.cssText = /* ★ 第 248 轮：原来写死 top:64px ✗ 正好压在弹幕条上 ✗
   现在跟着弹幕条的高度走 ✓（弹幕开两行时自动再往下挪 ✓）*/
      /* ★ 第 248 轮修补：原来用 window._toastTop 缓存值 ✗
         但弹幕条在单行/两行之间切换时那个值会过期 ✗
         实测过：弹幕底边 118 ✗ toast 的 top 还是 100 → 仍然重叠 ✓
         ★ 改成【每次显示时现算】✗ 永远不会过期 ✓ */
      'position:fixed;left:50%;top:' + tkToastTop() + 'px;' +
      'transform:translateX(-50%);z-index:70;' +
      'background:#000000cc;color:#ffd83d;font-size:13px;padding:8px 14px;border-radius:9px;' +
      'border:1px solid #ffd83d55;pointer-events:none;opacity:0;transition:opacity .2s;white-space:nowrap';
    document.body.appendChild(_toastEl);
  }
  _toastEl.textContent = msg;
  _toastEl.style.opacity = '1';
  if (_toastTimer) { clearTimeout(_toastTimer); }
  _toastTimer = setTimeout(function () { _toastEl.style.opacity = '0'; }, 1600);
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
    try {
      if (wasReady) {
        var K = 'autoReloadAt';
        var last = +(sessionStorage.getItem(K) || 0);
        var now = Date.now();
        if (now - last > 20000) {
          sessionStorage.setItem(K, String(now));
          console.log('[net] 断开 → 自动刷新一次（同步服务器上的界面改动）');
          location.reload();
        } else {
          console.log('[net] 断开 → 20 秒内已经刷过一次了，这次只重连不刷新');
        }
      }
    } catch (e) { }
  };
  s.onerror = function () { };
}

/* ---------- wsOnMessage ---------- */
function wsOnMessage(raw) {
  var m;
  try { m = JSON.parse(raw); } catch (e) { return; }
  var t = m.t, d = m.d || {};
  if (t === 'welcome') { wsWelcome(d); return; }
  if (t === 'world') {
    window._lastWorldT = Date.now();
    wsApplyWorld(d);
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
    WSC.on = false; WSC.ready = false;
    try { localStorage.removeItem('token'); } catch (e2) { }
    netGoOffline();
    if (window.showLogin) { showLogin(d.msg || '请重新登录'); }
    return;
  }
  /* ★ 第 248 轮：弹幕（全服滚动通知 ✓）*/
  if (t === 'ticker') { tkPush(d.text, d.kind); return; }
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
  if (t === 'talents') {          // ★ 第 116 轮：天赋状态 ✓
    TAL.free = +d.free || 0;
    TAL.pts = d.pts || {};
    TAL.raw = d.raw || {};
    TAL.eff = d.eff || {};
    TAL.live = d.live || [];
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
  if (t === 'weapon') {
    setWeapon(d.w || null);
    BAG.weapon = d.w || null;
    BAG.busy = false;
    if ((SETCFG.setTab || '') === 'bag') { bagFetch(bagRender); }
    return;
  }
  if (t === 'chat') { toast('[' + (d['from'] || '?') + '] ' + (d.text || '')); return; }
  if (t === 'snd') { if (d.name) { sfxAt(d.name, d.x || P.x, d.z || P.z, 1.0); } return; }
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
  WSC.ready = true;
  WSC.role = d.role || null;
  if (d.cfg) { WSC.cfg = d.cfg; }
  setWeapon((d.role && d.role.weapon) || null);   // ★ 第 47 轮：进世界就知道手上拿的是啥 ✓
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
  netGoOnline();        // ★ 清掉本地自己模拟的那几只 → 世界归服务器 ✓
  /* ★ 第 206 轮：进游戏时恢复上次的自动战斗开关（存了 SETCFG.auto ✓）*/
  try {
    if (typeof AUTO !== 'undefined' && typeof SETCFG !== 'undefined' && SETCFG.auto) {
      AUTO.on = true; AUTO.tgt = ''; AUTO.phase = 'find'; AUTO.info = '自动战斗：正在找目标…';
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
    console.log('[render] ' + why + ' → 自动刷新一次');
    location.reload();
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
    if (e.target && e.target.id === 'bootReload') { location.reload(); }
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
    try {
      var last = +(sessionStorage.getItem('autoReloadAt') || 0);
      if (Date.now() - last > 20000) {
        sessionStorage.setItem('autoReloadAt', String(Date.now()));
        window._desyncCount++;
        console.log('[net] 检测到与服务器不同步（' + gap.toFixed(1) + ' 秒没收到世界数据）→ 自动刷新');
        location.reload();
      }
    } catch (e) { }
    window._lastWorldT = Date.now();
  }
}, 2000);

function showLogin(msg) {
  var el = document.getElementById('login');
  if (!el) { return; }
  el.classList.add('show');
  if (msg) { document.getElementById('loginHint').textContent = msg; }
  var n = document.getElementById('loginName');
  if (n && !n.value) { setTimeout(function () { n.focus(); }, 60); }
}
function hideLogin() {
  bootDone();   /* ★ 第 213 轮：真正进游戏了才揭开加载动画 ✓ */
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
}

/* ============================================================
   PWA：注册 Service Worker（离线缓存 / "添加到主屏幕" / 打 APK 必需）
   ★ 放在【平台层】—— 这是全项目唯一允许碰浏览器 API 的文件 ✓ core 一行都不用改
   ★ 第 28 轮之前这里根本没注册过：sw.js 写了但没人装 → 文档里"离线可开"是假的 ✗
   ★ 浏览器规定只有 https / localhost / 127.0.0.1 能用 SW（http + 局域网 IP 不行）——
     所以手机上通过 http://192.168.x.x 打开时【注册会失败】，这很正常，直接跳过就行，
     不影响游戏本身 ✓ 想要 PWA 就用 https（或走 APK 壳）✓
   ============================================================ */
(function bootServiceWorker() {
  try {
    if (!navigator.serviceWorker) { return; }
    var h = location.hostname;
    var okHost = (location.protocol === 'https:') || h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
    if (!okHost) { return; }
    navigator.serviceWorker.register('/sw.js').catch(function () { /* 装不上也照玩 ✓ */ });
  } catch (e) { /* 老浏览器没有 SW —— 无所谓 ✓ */ }
})();




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
    try { tpBind(); } catch (e) { }
    TPCAST.at = performance.now() / 1000;
    setInterval(function () { tpEnsureBtn(); tpBarRender(); autoBindAtk(); jumpBind(); autoUiUpd();
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
