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
function sfx(name, volScale) {
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
      src.onended = function () { _aVoices = Math.max(0, _aVoices - 1); };
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
  function atkDown(e) { if (e) { e.preventDefault(); } atkHeld = true; }
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
    }
  }, { passive: false });
  cv.addEventListener('touchend', function (e) {
    e.preventDefault();
    var ts = evTouches(e);
    for (var i = 0; i < ts.length; i++) {
      if (ts[i].identifier === joyId) { joyId = null; jx = 0; jy = 0; }
    }
  }, { passive: false });
  cv.addEventListener('touchcancel', function (e) { e.preventDefault(); joyId = null; jx = 0; jy = 0; }, { passive: false });
  addEventListener('keydown', function (e) { var k = evKey(e); if (k) { keys[k] = true; } });
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
      '★ <b>按住右下角攻击键 5 秒</b> → 自动战斗开启（按钮变绿 + 弹提示）',
      '★ 再按住 5 秒 → 关闭',
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
      '同一个人：夺取最多 1 分钟一次，魔气最多 10 分钟一次',
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
    ['上限', '一队最多 3 人。'],
    ['经验分享', '自己杀的拿 100%；队友杀的，30 米内每个队友拿该僵尸经验的 10%（和人数无关）。'],
    ['队友标识', '100 米内会显示蓝色箭头；头顶名字前面有蓝色五角星。']
  ]},
  { k: 'realm', t: '境界 / 等级', h: [
    ['等级', '打怪、做任务都会给经验。升级自动加固有属性（攻击 / 生命 / 灵气）。'],
    ['天赋点', '每升 1 级给 3 点，在菜单的【天赋】页分配。']
  ]}
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
    var canInv = !p.party && (!PARTY.roster || PARTY.roster.length < 3);
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
  var tabs = document.querySelectorAll('#setTabs .tab');
  for (var i = 0; i < tabs.length; i++) {
    var on = (tabs[i].getAttribute('data-tab') === name);
    tabs[i].className = 'tab' + (on ? ' on' : '');
  }
  var panes = document.querySelectorAll('#setPanel .tabpane');
  var hit = false;
  for (var j = 0; j < panes.length; j++) {
    var on2 = (panes[j].getAttribute('data-pane') === name);
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
  box:    ICON_SVG('<path d="M4 7l8-4 8 4v10l-8 4-8-4z"/><path d="M4 7l8 4 8-4M12 11v10"/>')
};
var MAT_ICON_BY_NAME = {
  '破布': 'cloth', '绷带': 'band', '锈铁': 'iron', '螺丝钉': 'gear', '生锈齿轮': 'gear',
  '碎玻璃': 'glass', '灵气结晶': 'crystal', '兽骨': 'bone', '电池': 'batt',
  '疫苗': 'vial', '铜线卷': 'gear'
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
            busy: false, msg: '', sel: null };

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
  fetch('/api/bag', { headers: { 'X-Token': bagToken() } })
    .then(function (r) { return r.json(); })
    .then(function (j) {
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
        itDur(it, (e && e.id)) + '</s> / ' + it.durMax +
        ' 次挨打' + (function () {
          var k = itDur(it, (e && e.id)) / it.durMax;
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
    ((+it.durMax > 0) ? ('<span>耐久 <s>' + itDur(it, (e && e.id)) +
      '</s> / ' + it.durMax + ' 次挥砍' +
      (function () { var k = itDur(it, (e && e.id)) / it.durMax;
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
var AUTO_LONG_PRESS = 5000;
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
}

function autoToggle() {
  if (typeof AUTO === 'undefined') { return; }
  AUTO.on = !AUTO.on;
  AUTO.tgt = ''; AUTO.phase = 'find'; AUTO.t = 0; AUTO.kills = 0;
  AUTO.deaths = []; AUTO.pauseUntil = 0; AUTO.stuckT = 0;
  AUTO.info = AUTO.on ? '自动战斗：正在找目标…' : '';
  /* ★ 第 209 轮：关掉时立刻把摇杆还回去 ✗ 不然人会一直往前走 ✓ */
  try { if (typeof autoRelease === 'function') { autoRelease(); } } catch (e) { }
  try { if (typeof SETCFG !== 'undefined') { SETCFG.auto = AUTO.on; } saveSet(); } catch (e) { }
  autoUiUpd();
  toast(AUTO.on ? '自动战斗已开启（再长按攻击键 5 秒关闭）' : '自动战斗已关闭');
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
  var down = function () {
    if (_autoHold) { return; }
    _autoHold = setTimeout(function () {
      _autoHold = null;
      autoToggle();
    }, AUTO_LONG_PRESS);
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
    /* ★ 第 233 轮：损坏的装备要有明显样式（挂机回来一眼看得出来 ✓）*/
    var brk = !!it.broken;
    if (brk) { cur = ''; }   /* 坏了的显示损坏 ✗ 不显示已装备绿点 ✓ */
    var lowm = isW ? (wMastery(it) < 1) : false;      // 发挥不满 → 黄标（不是锁 ✓）
    var n = (e.stack || 1);
    var bg = 'background:linear-gradient(180deg,' + tierRgba(it.tier || 0, 0.40) + ','
             + tierRgba(it.tier || 0, 0.18) + ')';
    html += '<div class="slot' + cur + sel + (lowm ? ' lowmastery' : '') +(brk ? ' broken' : '') +  '" style="' + bg + '"' +
      ' data-id="' + e.id + '" data-w="' + (isW ? 1 : 0) + '" data-i="' + i + '"' +
      (lowm ? (' title="建议 ' + (it.reqLevel || 1) + ' 级（发挥 ' +
        Math.round(wMastery(it) * 100) + '%）"') : '') + '>' +
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
  var total = Math.max(16, Math.ceil((BAG.items.length + 1) / 8) * 8);
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
        '<span class="cnt" style="bottom:-1px">减伤 ' +
        Math.round((+((ar2.base || {}).dr) || 0)) + '</span>';
      ars.setAttribute('data-a', '1');
      ars.title = (ar2.name || '防具') + ' —— 点一下脱下';
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
  var selTip = document.getElementById('bagSelTip');
  if (selTip) {
    selTip.textContent = isW8
      ? (selIsEquipped ? '这件正拿在手上 ✓' : '点左边的「使用」穿上它')
      : '点上面的格子选中一件武器';
  }
  if (mg) {
    mg.textContent = BAG.msg || (BAG.items.length ? '' :
      '背包是空的 —— 打僵尸有机会掉武器（走过去自动捡 ✓）');
  }
}

/* 悬停详情（MC 那种提示框 ✓）*/
function bagTipAt(e, el) {
  var box = document.getElementById('bagTipBox');
  if (!box || !el) { return; }
  var idx = +el.getAttribute('data-i');
  var it = (BAG.items[idx] || {}).item;
  if (!it) { return; }
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
    var afA = it.affixes || [];
    extra += '减伤 <b>' + (Math.round((+bA.dr || 0) * 10) / 10) + '</b> 点 · ' +
      '生命上限 <b>+' + Math.round(+bA.hp || 0) + '</b><br>';
    if (afA.length) {
      var afTxt = [];
      for (var ia = 0; ia < afA.length; ia++) { afTxt.push(afA[ia].text || ''); }
      extra += '<span style="color:#8ee0ff">词条 ' + afA.length + ' 条：' +
        afTxt.join(' · ') + '</span><br>';
    }
    if (+it.durMax > 0) {
      var ddA = (typeof it.dur === 'number') ? it.dur : it.durMax;
      var kA = ddA / it.durMax;
      extra += '耐久 <b style="color:' + (kA > 0.5 ? '#7ee08a'
        : (kA > 0.2 ? '#ffd83d' : '#ff7a6a')) + '">' + ddA + '</b> / ' +
        it.durMax + ' 次挨打<br>';
    }
    extra += '<span style="opacity:.7">穿在武器槽右边那个槽 · 点【使用】穿上</span><br>';
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
  box.innerHTML = '<b style="color:' + tierHex(it.tier || 0) + '">' + (it.name || '?') + '</b>' +
    '<i> · ' + ((it.tier || 0) + 1) + ' 阶' + (it.itemLv ? (' · 物品 ' + it.itemLv + ' 级') : '') +
    '</i>' + lvlTxt + '<br>' + extra +
    /* ★ 第 97 轮：防具也是能穿的 ✗ 原来只有 weapon 显示"点使用穿上"✗
       其余一律显示"材料（以后做合成用）"✗✓✓
       —— 用户说的"防具点开就是材料"就是这一行 ✓ */
    '<i>' + ((it.slot === 'weapon' || it.slot === 'armor')
      ? '选中后点「使用」穿上' : '材料（以后做合成用）') + '</i>';
  box.style.display = 'block';
  box.style.left = Math.min(window.innerWidth - 260, e.clientX + 14) + 'px';
  box.style.top = Math.min(window.innerHeight - 120, e.clientY + 12) + 'px';
}
function bagTipHide() {
  var box = document.getElementById('bagTipBox');
  if (box) { box.style.display = 'none'; }
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
  var grid = document.getElementById('bagGrid');
  if (grid) {
    grid.onclick = function (e) {
      var el = e.target;
      while (el && el !== grid && !(el.getAttribute && el.getAttribute('data-id'))) { el = el.parentNode; }
      if (!el || el === grid || !el.getAttribute) { return; }
      /* ★ 第 54 轮（用户要求）：点武器 = 【选中】它（面板显示它的数值 ✓）
         真正穿上要再按【使用】按钮 ✓ —— 免得手一滑就换了装备 ✗
         ★ 材料只选中看一眼，不参与穿 ✓ */
      BAG.sel = el.getAttribute('data-id');
      BAG.msg = '';
      bagRender();
    };
    grid.onmousemove = function (e) {
      var el = e.target;
      while (el && el !== grid && !(el.getAttribute && el.getAttribute('data-id'))) { el = el.parentNode; }
      if (!el || el === grid || !el.getAttribute) { bagTipHide(); return; }
      bagTipAt(e, el);
    };
    grid.onmouseleave = bagTipHide;
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
function toast(msg) {
  if (!_toastEl) {
    _toastEl = document.createElement('div');
    _toastEl.style.cssText = 'position:fixed;left:50%;top:64px;transform:translateX(-50%);z-index:70;' +
      'background:#000000cc;color:#ffd83d;font-size:13px;padding:8px 14px;border-radius:9px;' +
      'border:1px solid #ffd83d55;pointer-events:none;opacity:0;transition:opacity .2s;white-space:nowrap';
    document.body.appendChild(_toastEl);
  }
  _toastEl.textContent = msg;
  _toastEl.style.opacity = '1';
  if (_toastTimer) { clearTimeout(_toastTimer); }
  _toastTimer = setTimeout(function () { _toastEl.style.opacity = '0'; }, 1600);
}

/* ---------- wsUrl ---------- */
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
  if (t === 'error' || t === 'notice') {
    var _tx = d.msg || d.text || '';
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
    setInterval(function () { tpEnsureBtn(); tpBarRender(); autoBindAtk(); autoUiUpd(); }, 100);   /* 100ms 一次 ✓ 便宜 ✓ 而且顺带保证按钮一定挂上 ✓ */
    tpBarRender();                      /* 先画一次，把按钮恢复成正常样子 ✓ */
  }
  if (typeof document === 'undefined') { return; }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', go);
  } else {
    go();
  }
})();
