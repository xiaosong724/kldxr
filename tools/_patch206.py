# -*- coding: utf-8 -*-
# 第 206 轮：自动战斗 —— 第 1~2 步（核心逻辑 + 长按攻击键 5 秒开关）
#
# 方案：docs/自动战斗方案.md（第 13/14 节是定稿）
#   · 永远打带跑（砍一刀 → 退 0.45 秒 → 再砍）· 数量多少都一样
#   · 只保留一个技术性例外：退不动（被墙挡住）→ 原地打
#   · 开关 = 长按【攻击按钮】5 秒（不加单独按钮）
#   · 死了原地自动复活继续打（不回安全区）+ 三层防送死
#
# ★ 接入点（都查过了 ✓ 全部复用现有代码 ✗ 不新写移动/攻击）：
#     移动：主循环读 jx / jy（摇杆值）→ 自动战斗直接改这两个数 ✓
#     攻击：主循环读 atkHeld ✓ 自动战斗直接置 true ✓
#     目标：NET.rmobs[mid]（有 x/z/hp/alive/atkT ✓ atkT>=0 表示正在挥爪 ✓）

import io

# ============================================================
# 一、core/game.js：核心逻辑
# ============================================================
P = 'web/core/game.js'
t = io.open(P, encoding='utf-8').read()

# ---- 1a 插在主循环前面（autoTick 要用到的都在它上面 ✓）----
ANCHOR = "/* ---- 移动 ---- */"
assert t.count(ANCHOR) == 1, ('移动锚点: %d' % t.count(ANCHOR))

CORE = r'''/* ============================================================================
   ★★ 第 206 轮：自动战斗（方案 docs/自动战斗方案.md）★★

   设计要点（都是用户拍板的）：
     · 永远"打带跑"：砍一刀 → 往后退 0.45 秒 → 它追进来 → 再砍
       （0.45 秒 ≈ 僵尸的蓄力时间 ✓ 正好卡掉它那一口 ✓ 服务器那边
         "走开了就取消蓄力"✓ 所以是真的躲掉了 ✓ 不是心理安慰 ✓）
     · 数量多少都一样打带跑 ✗ 不做"被围就站撸"✓
       唯一例外：退不动了（被墙/树挡住）→ 原地打 ✓
     · 死了原地自动复活继续打 ✓（不回安全区 ✓ 用户指定）
       + 三层防送死（退两步 / 停手 8 秒 / 连死 3 次自动关掉 ✓）
     · 手动操作会暂停 3 秒（不是关掉 ✓ 方便临时接管 ✓）

   ★ 为什么放客户端：这个项目里【位置归客户端】✓ 伤害归服务器 ✓
     所以自动战斗只要"改自己的摇杆值 + 置 atkHeld"✓
     和真人操作走完全同一套代码 ✓ 服务器一行都不用改 ✓
   ============================================================================ */
var AUTO = {
  on: false,          /* 开关 ✓ */
  tgt: '',            /* 当前目标 mid */
  phase: 'find',      /* find / approach / strike / retreat */
  t: 0,               /* 当前阶段已经过了多久 */
  pauseUntil: 0,      /* 手动操作后暂停到什么时候（performance.now 毫秒）*/
  stuckT: 0,          /* "退不动"累计时间 */
  lastX: 0, lastZ: 0, /* 上一帧位置（用来判退不动 ✓）*/
  deaths: [],         /* 最近几次死亡的时间戳（判连死 ✓）*/
  reviveT: 0,         /* 复活节流 */
  holdT: 0,           /* 长按攻击键的计时（平台那边也会用 ✓）*/
  info: '',           /* 给界面显示的一行状态 ✓ */
  kills: 0            /* 这次开启后打了多少只（界面上给点成就感 ✓）*/
};

/* 可调参数（方案里的默认值 ✓ 第 3 步会做进设置界面）*/
var AUTO_RANGE = 30.0;      /* 搜索/追击半径（米）*/
var AUTO_STAND = 3.0;       /* 停手 8 秒的阈值（30 秒内死第 2 次 ✓）*/
var AUTO_RETREAT = 0.45;    /* 每次后退多久（≈ 僵尸蓄力 ✓）*/
var AUTO_STUCK_MOVE = 0.12; /* 这 0.25 秒里位移小于它 → 认定退不动 ✓ */

function autoFacing(dx, dz) {
  /* ★ 和主循环算朝向用的是【同一个公式】✓ 不自己发明 ✓
     （主循环：wx = nx, wz = nz * G.FLIP_Z, yaw = atan2(wx, wz) ✓）*/
  return Math.atan2(dx, dz * G.FLIP_Z);
}

function autoInSafe(x, z) {
  return (typeof SAFE_HALF === 'number') &&
    Math.abs(x) <= SAFE_HALF && Math.abs(z) <= SAFE_HALF;
}

function autoPickTarget() {
  var best = '', bestD = AUTO_RANGE * AUTO_RANGE;
  var threat = '', threatD = 4.0 * 4.0;      /* 4 米内正在挥爪的 = 正在打我 ✓ */
  for (var mid in NET.rmobs) {
    var m = NET.rmobs[mid];
    if (!m || !m.alive || !(m.hp > 0)) { continue; }
    if (m.dying >= 0) { continue; }           /* 正在倒地动画 ✓ 不算 */
    var dx = m.cur.x - P.x, dz = m.cur.z - P.z;
    var d2 = dx * dx + dz * dz;
    if (autoInSafe(m.cur.x, m.cur.z)) { continue; }   /* 安全区里的不打 ✓ */
    if (m.atkT >= 0 && d2 < threatD) { threat = mid; threatD = d2; }  /* 正在打我 ✓ */
    if (d2 < bestD) { best = mid; bestD = d2; }
  }
  /* 优先级：正在打我的 > 最近的（用户拍板 ✓）*/
  return threat || best;
}

function autoRevive() {
  var now = performance.now();
  if (now - AUTO.reviveT < 1500) { return; }   /* 节流 ✓ 别一帧发几十次 */
  AUTO.reviveT = now;
  /* 记一次死亡（判连死 ✓）*/
  AUTO.deaths.push(now);
  while (AUTO.deaths.length > 5) { AUTO.deaths.shift(); }
  var recent = 0;
  for (var i = 0; i < AUTO.deaths.length; i++) {
    if (now - AUTO.deaths[i] < 30000) { recent++; }
  }
  if (recent >= 3) {
    /* ★★ 硬保险：连死 3 次自动关掉 ✗ 防挂机一晚上送死几百次 ✓
       （每死一次魔气 -1 ✓ 一晚上能把魔气清空 ✓）*/
    AUTO.on = false;
    AUTO.info = '你被反复击杀，自动战斗已关闭';
    if (typeof toast === 'function') { toast('你被反复击杀，自动战斗已关闭'); }
    if (typeof autoUiUpd === 'function') { autoUiUpd(); }
    return;
  }
  /* 原地复活 ✓（不回安全区 ✓ 用户指定）*/
  wsSend('revive', {});
  AUTO.phase = 'retreat';      /* 复活后先退两步 ✓ 利用 1.5 秒无敌 ✓ */
  AUTO.t = 0;
  if (recent >= 2) { AUTO.pauseUntil = now + 8000; }   /* 30 秒内死第 2 次 → 停手 8 秒 ✓ */
}

function autoTick(dt) {
  var now = performance.now();
  if (!AUTO.on) { return; }
  /* 手动操作过 → 暂停 3 秒（不是关掉 ✓）*/
  if (now < AUTO.pauseUntil) { AUTO.info = '自动战斗：你正在手动操作，稍后继续'; return; }
  if (dead) { AUTO.info = '自动战斗：已倒下，正在复活…'; autoRevive(); return; }

  /* ---- 找目标 ---- */
  if (!AUTO.tgt || !NET.rmobs[AUTO.tgt] || !NET.rmobs[AUTO.tgt].alive ||
      !(NET.rmobs[AUTO.tgt].hp > 0) || NET.rmobs[AUTO.tgt].dying >= 0) {
    if (AUTO.tgt) { AUTO.kills++; }        /* 上一只没了 ✓ 记一笔 */
    AUTO.tgt = autoPickTarget();
    AUTO.phase = AUTO.tgt ? 'approach' : 'find';
    AUTO.t = 0;
  }
  if (!AUTO.tgt) {
    /* 没怪 → 站着（不乱跑 ✓）顺手看看脚下有没有东西捡 ✓ */
    jx = 0; jy = 0;
    AUTO.info = '自动战斗：附近没有僵尸';
    return;
  }

  var m = NET.rmobs[AUTO.tgt];
  var dx = m.cur.x - P.x, dz = m.cur.z - P.z;
  var d = Math.hypot(dx, dz);
  /* 追太远 → 丢掉（别追得满地图跑 ✓）*/
  if (d > AUTO_RANGE * 1.35) {
    AUTO.tgt = ''; AUTO.phase = 'find'; jx = 0; jy = 0;
    AUTO.info = '自动战斗：目标太远了，换一个';
    return;
  }
  var reach = (G.ATK_RANGE || 2.4) * 0.92;

  AUTO.t += dt;
  if (AUTO.phase === 'find') { AUTO.phase = 'approach'; AUTO.t = 0; }

  if (AUTO.phase === 'approach') {
    P.yaw = autoFacing(dx, dz);
    if (d <= reach) {
      /* 到射程了 → 停下、转向、挥刀 ✓ */
      AUTO.phase = 'strike'; AUTO.t = 0;
      jx = 0; jy = 0;
      P.yaw = autoFacing(dx, dz);
      atkHeld = true;
    } else {
      var nx = dx / d, nz = dz / d;
      jx = nx; jy = nz;                 /* ★ 直接喂摇杆值 ✗ 和手推走的是同一套 ✓ */
      atkHeld = false;
    }
    AUTO.info = '自动战斗：接近 ' + (m.lv ? ('Lv.' + m.lv + ' ') : '') + d.toFixed(1) + 'm';
    return;
  }

  if (AUTO.phase === 'strike') {
    jx = 0; jy = 0;
    P.yaw = autoFacing(dx, dz);
    atkHeld = (atkT < 0);               /* 冷却好了就再挥 ✓ 挥出去就能退 ✓ */
    AUTO.info = '自动战斗：挥砍中 · ' + d.toFixed(1) + 'm';
    if (AUTO.t > 0.12 && atkT >= 0) { AUTO.phase = 'retreat'; AUTO.t = 0; AUTO.lastX = P.x; AUTO.lastZ = P.z; AUTO.stuckT = 0; }
    if (AUTO.t > 0.8) { AUTO.phase = 'retreat'; AUTO.t = 0; AUTO.lastX = P.x; AUTO.lastZ = P.z; AUTO.stuckT = 0; }
    return;
  }

  if (AUTO.phase === 'retreat') {
    /* 往【远离目标】的方向退 ✓ 这是"躲"的关键 ✓ */
    atkHeld = false;
    var rx = -dx / (d || 1), rz = -dz / (d || 1);
    jx = rx; jy = rz;
    P.yaw = autoFacing(dx, dz);          /* 退的时候脸还朝着它 ✓ 好看 ✓ */
    /* 退不动检测：被墙/树挡住了 ✓ → 原地打（唯一的技术性例外 ✓）*/
    if (Math.hypot(P.x - AUTO.lastX, P.z - AUTO.lastZ) < AUTO_STUCK_MOVE) {
      AUTO.stuckT += dt;
    } else {
      AUTO.stuckT = 0; AUTO.lastX = P.x; AUTO.lastZ = P.z;
    }
    AUTO.info = '自动战斗：后撤 ' + d.toFixed(1) + 'm';
    if (AUTO.t >= AUTO_RETREAT || AUTO.stuckT > 0.25) {
      AUTO.phase = 'approach'; AUTO.t = 0;
      if (AUTO.stuckT > 0.25) { AUTO.info = '自动战斗：退不动了，原地打'; }
    }
    return;
  }
}

'''

t = t.replace(ANCHOR, CORE + ANCHOR)

# ---- 1b 在主循环里调 autoTick（★ 必须在读 jx/jy 之前 ✓）----
OLD2 = """  /* ---- 移动 ---- */
  var ix = jx, iz = jy;"""
assert t.count(OLD2) == 1, ('主循环移动锚点: %d' % t.count(OLD2))
NEW2 = """  /* ---- 移动 ---- */
  /* ★ 第 206 轮：自动战斗在这一刻决定"这一帧往哪走、要不要挥刀"✗
     放在读 jx/jy 之前 ✓ 因为它就是通过改 jx/jy 来走路的 ✓
     （和手推摇杆走的是【同一条路】✓ 手感/音效/碰撞全一致 ✓）*/
  if (typeof autoTick === 'function') { autoTick(dt); }
  var ix = jx, iz = jy;"""
t = t.replace(OLD2, NEW2)

io.open(P, 'w', encoding='utf-8', newline='\n').write(t)
print('  OK core/game.js：AUTO 状态机 + autoTick 已植入（在移动之前调用）')

# ============================================================
# 二、platform：长按攻击键 5 秒开关 + 界面提示
# ============================================================
P2 = 'web/platform/web.js'
t2 = io.open(P2, encoding='utf-8').read()

# ---- 2a 长按逻辑 + 界面刷新 ----
ANCHOR2 = "function tpDo(e) {"
assert t2.count(ANCHOR2) == 1, ('tpDo 锚点: %d' % t2.count(ANCHOR2))
PLAT = r'''/* ============================================================================
   ★★ 第 206 轮：自动战斗的开关（用户指定：长按【攻击按钮】5 秒）★★
   为什么不做单独按钮：省一块屏幕空间 ✓ 而且藏进已有的操作里更利落 ✓
   ★ 必须给足视觉提示 ✗ 不然用户不知道现在是什么状态、也不知道怎么关 ✓
       ① 攻击按钮变绿 + 一圈呼吸光
       ② 按钮上方一行小字："自动战斗：……"
       ③ 开/关各弹一次提示
       ④ 菜单里也留一个开关（万一忘了长按这回事 ✓）
   ============================================================================ */
var AUTO_LONG_PRESS = 5000;   /* 5 秒 ✓ */
var _autoHold = null;

function autoUiUpd() {
  var b = document.getElementById('atk');
  var info = document.getElementById('autoInfo');
  var on = (typeof AUTO !== 'undefined') && AUTO.on;
  if (b) {
    if (on) { b.classList.add('auto'); } else { b.classList.remove('auto'); }
  }
  if (info) {
    if (on) {
      info.style.display = 'block';
      info.textContent = (typeof AUTO !== 'undefined' && AUTO.info)
        ? AUTO.info : '自动战斗：启动中…';
    } else {
      info.style.display = 'none';
    }
  }
}

function autoToggle() {
  if (typeof AUTO === 'undefined') { return; }
  AUTO.on = !AUTO.on;
  AUTO.tgt = ''; AUTO.phase = 'find'; AUTO.t = 0; AUTO.kills = 0;
  AUTO.deaths = []; AUTO.pauseUntil = 0;
  AUTO.info = AUTO.on ? '自动战斗：正在找目标…' : '';
  saveSet();
  autoUiUpd();
  toast(AUTO.on ? '自动战斗已开启（再长按攻击键 5 秒可关闭）' : '自动战斗已关闭');
}

/* 手动操作 → 暂停自动 3 秒（不是关掉 ✓ 方便临时接管 ✓）*/
function autoPauseManual() {
  if (typeof AUTO !== 'undefined' && AUTO.on) {
    AUTO.pauseUntil = performance.now() + 3000;
  }
}

function autoBindAtk() {
  var b = document.getElementById('atk');
  if (!b || b._autoB) { return; }
  b._autoB = true;
  var down = function (e) {
    if (_autoHold) { return; }
    _autoHold = setTimeout(function () {
      _autoHold = null;
      autoToggle();                    /* ★ 满 5 秒 → 切换 ✓ */
    }, AUTO_LONG_PRESS);
  };
  var up = function () {
    if (_autoHold) { clearTimeout(_autoHold); _autoHold = null; }
    autoPauseManual();                 /* 点/按过攻击键 → 手动接管 3 秒 ✓ */
  };
  b.addEventListener('pointerdown', down);
  b.addEventListener('pointerup', up);
  b.addEventListener('pointercancel', up);
  b.addEventListener('pointerleave', up);
}

'''
t2 = t2.replace(ANCHOR2, PLAT + ANCHOR2)

# ---- 2b 模块顶层启动块里加上绑定 + 定时刷新状态 ----
OLD3 = "    setInterval(function () { tpEnsureBtn(); tpBarRender(); }, 100);"
assert t2.count(OLD3) == 1, ('启动块锚点: %d' % t2.count(OLD3))
t2 = t2.replace(OLD3, "    setInterval(function () { tpEnsureBtn(); tpBarRender(); autoBindAtk(); autoUiUpd(); }, 100);")

# ---- 2c 摇杆/键盘一动就暂停（手动接管 ✓）----
OLD4 = "var keys = {}, atkHeld = false;"
if t2.count(OLD4) == 0:
    OLD4 = "function netGoOffline() {"
    assert t2.count(OLD4) == 1, ('netGoOffline 锚点: %d' % t2.count(OLD4))
    t2 = t2.replace(OLD4, """window.addEventListener('keydown', function (e) {
  /* ★ 第 206 轮：按了 WASD/方向键 → 自动战斗暂停 3 秒（手动接管 ✓）*/
  if (e && e.key && 'wasdWASD'.indexOf(e.key) >= 0) { autoPauseManual(); }
}, true);

""" + OLD4)
io.open(P2, 'w', encoding='utf-8', newline='\n').write(t2)
print('  OK platform：长按 5 秒开关 + 状态提示 + 手动暂停钩子')

# ============================================================
# 三、index.html：状态小字 + 攻击按钮变绿样式
# ============================================================
P3 = 'web/index.html'
t3 = io.open(P3, encoding='utf-8').read()

CSS = """/* ★★ 第 206 轮：自动战斗的视觉提示（用户要求 ✓ 不然不知道状态）★★ */
#atk.auto{
  box-shadow:0 4px 12px #00000055, 0 0 0 3px #6ee08a55, inset 0 1px 0 #ffffff22;
  border-color:#6ee08a99 !important;
  animation:autoBreath 1.8s ease-in-out infinite
}
@keyframes autoBreath{
  0%,100%{box-shadow:0 4px 12px #00000055, 0 0 0 2px #6ee08a44, inset 0 1px 0 #ffffff22}
  50%    {box-shadow:0 4px 12px #00000055, 0 0 0 6px #6ee08a33, inset 0 1px 0 #ffffff22}
}
#autoInfo{
  position:fixed;left:50%;transform:translateX(-50%);bottom:150px;display:none;
  padding:4px 12px;border-radius:12px;background:rgba(10,16,12,.72);
  border:1px solid #6ee08a55;color:#c8f5d4;font-size:11px;letter-spacing:.3px;
  z-index:31;white-space:nowrap;pointer-events:none;text-shadow:0 1px 2px #000
}
"""
i = t3.find('#safeTp{')
assert i > 0, '找不到 #safeTp（样式插入点）'
# 插在 safeTp 规则之前（那块是顶层 ✓ 前面是注释结尾 ✓）
j = t3.rfind('/*', 0, i)
t3 = t3[:j] + CSS + t3[j:]

# 加元素（放在传送按钮旁边 ✓）
OLD5 = '<div id="safeTp">'
assert t3.count(OLD5) == 1, ('safeTp 元素锚点: %d' % t3.count(OLD5))
t3 = t3.replace(OLD5, '<div id="autoInfo"></div>\n' + OLD5)
io.open(P3, 'w', encoding='utf-8', newline='\n').write(t3)
print('  OK index.html：状态小字 + 攻击键变绿呼吸样式')
print('  DONE')
