// -*- coding: utf-8 -*-
/* ============================================================================
   core/game.js —— 玩法 + 渲染

   ★ 本文件里不允许出现任何浏览器专有对象（DOM / 存储 / 事件绑定 / 音频 /
     XHR 这类），平台能力一律通过 platform/web.js 的 UI.* 拿（方案 §1.3）。

   为什么：微信 / 抖音小游戏没有浏览器 DOM。core 保持干净，
   将来上小程序时只换 platform/ 一层，这里一行都不用改。

   提交前跑闸门：python tools\check_core_dom.py
   加载顺序：three.min.js → platform/web.js → core/game.js
   ============================================================================ */


/* ============================================================
   全部参数（要调什么改这里 ✓）
   ============================================================ */
var G = {
  TS: 0.62,            // 逻辑格（碰撞/生成用）
  GRID_WORLD: 2.5,     // 地面贴图每小格的世界尺寸（2.5 单位 ≈ 屏幕 80px ✓ 清晰 ✓）
  FLIP_Z: 1,           // 上下方向开关（1 或 -1）
  CAM_PITCH: 0.70,
  CAM_DIST: 21,
  HERO_SCALE: 0.42,
  MOB_SCALE: 0.42,
  PROP_SCALE: 0.48,
  BODY_R: 0.30,
  BODY_W: 0.60,        // ★ 人物碰撞箱宽（x 方向 ✓）
  BODY_D: 0.50,        // ★ 人物碰撞箱深（z 方向 ✓）
  MOB_R: 0.26,
  MOB_W: 0.55,         // ★ 妖兽碰撞箱宽 ✓
  MOB_D: 0.45,         // ★ 妖兽碰撞箱深 ✓
  SPEED: 4.4,
  MOB_SPEED: 1.35,
  ATK_CD: 0.62,          // ★ 第 47 轮：跟着手上的武器走（setWeapon 里改 ✓）
  ATK_RANGE: 2.4,
  /* ★ 攻击扇形的半角（弧度）——第 34 轮加的。
     用户反馈：原来是"离得近就打"，背对着僵尸也能打，不合理 ✗
     现在必须【正前方】才吃伤害：距离 ≤ ATK_RANGE 且 和朝向的夹角 ≤ ATK_ARC
     1.05 弧度 ≈ 60°，也就是正前方 120° 的一片扇形 ✓ 挥一刀扫一片，符合直觉 ✓
     ★ 这个值以后要和【服务器】那份判定保持一致（P2 伤害判归服务器算）*/
  ATK_ARC: 1.05,
  /* ★ 暴击倍率 —— 方案 §5：爆伤 = 150%（+爆伤%，上限 250%，P3 上装备后再接）
     ★ 必须和服务器 server/mobs.py 的 CRIT_MUL 一致（原来客户端写死 2.0 ✗ 和方案不符）*/
  CRIT_MUL: 1.5,
  PLANE_SIZE: 3000,
  PROP_R: 40,
  PROP_DENSITY: 68,   // ★ round373：34 → 68（物件数量减半 ✓ 和服务端一致 ✓）
  SPAWN_SAFE: 250,
  MOB_COUNT: 3,
  MOB_MAX: 60,          // ★ 实体上限（超过 60 手机掉到 60 帧以下 ✓ 所有生成路径都受它限制 ✓）
  FRAME_MS: 4
};

/* ============ 设置（必须在所有函数之前 ✓）============ */
/* ★ v5（第 31 轮）：新增 atkSize（攻击键大小）；顺便记住设置面板停在哪个分类（setTab）✓ */
var SET_DEF = { dpr: 2.0, aa: 'off', detail: 'mid', showFps: true, mobDmg: true,
                atkSize: 84, setTab: 'view' , shadow: 'high',
                /* ★ round422（用户："只放大游戏画面，UI 和按钮不变"）
                   百分比 ✗ 100 = 现在的大小（最小档就是它 ✓）*/
                zoom: 100 };
var SETCFG = { v: 5 };
var _savedVol = null;
try { var _sv = JSON.parse(UI.store.get('xx3d_set') || '{}'); if (_sv && _sv.v === 5) { SETCFG = _sv; } } catch (e) { }
var SETCFG_VER = 5;
/* ★ 一次性迁移：FPS 默认显示，性能面板默认关闭 */
try {
  if (UI.store.get('xx3d_fps_on_v2') !== '1') {
    SETCFG.showFps = true;
    SETCFG.perf = false;
    UI.store.set('xx3d_fps_on_v2', '1');
    try { SETCFG.v = SETCFG_VER; UI.store.set('xx3d_set', JSON.stringify(SETCFG)); } catch (eSave) { }
  }
} catch (eMig) { }
  var DETAIL_RANGE = { low: 16, mid: 28, high: 40 };

function setDpr() { return (SETCFG && SETCFG.dpr) ? SETCFG.dpr : SET_DEF.dpr; }
function setAA() { return (SETCFG && SETCFG.aa) ? SETCFG.aa : SET_DEF.aa; }
/* 攻击键直径（px）。夹一个范围，免得存档被改坏之后按钮大到点不到 ✓ */
function setAtkSize() {
  var v = (SETCFG && SETCFG.atkSize) || SET_DEF.atkSize;
  return (v >= 48 && v <= 180) ? v : SET_DEF.atkSize;
}

/* ★★ round422：画面放大（只动 3D 画面 ✗ UI/按钮一个字都不动 ✓）
   ★ 怎么做的：改【相机视野 FOV】✗ 不是放大画布也不是 CSS zoom ✓
     FOV 变窄 = 同一个场景被压进更小的视野 → 人和怪看起来变大 ✓
     ★ 为什么不用 CSS zoom：实测过 ✗ body 放大 1.25 会把画布撑到
       640×933（窗口只有 512×746）→ 四周被裁掉 ✗
       而只缩 UI 又不是用户要的（他要的是画面变大 ✓）
   ★ 数学：真正的"放大 k 倍"是 fov = 2·atan(tan(base/2)/k) ✗
     不是 base/k（那个会放大得比想象中猛很多 ✗）*/
var CAM_FOV_BASE = 52;          /* 和 new PerspectiveCamera(…) 用同一个数 ✓ */
function setWorldZoom() {
  var v = (SETCFG && SETCFG.zoom) || SET_DEF.zoom;
  /* ★ round423（用户："加一个档位还可以缩小到 80%"）
     → 下限 100 改成 80 ✗ 上限仍然 200 ✓（拿不到合法值就回默认 ✓）*/
  /* ★★ round531（用户："游戏相机画面改成大小滑动，最小 60%，最大 300%"）
     → 范围放宽到 60~300 ✗ 设置页用滑条调 ✓ */
  if (typeof v !== 'number' || !isFinite(v)) { return SET_DEF.zoom; }
  return Math.max(60, Math.min(300, Math.round(v)));
}
function applyWorldZoom() {
  if (!cam) { return; }
  /* ★ 80% 也要能用 ✗ 所以 【不能】再把 k 夹到 >= 1 ✓
     （k<1 → fov 变宽 → 看得更远 / 人更小 ✓）*/
  var k = (CAM_VIEW === 'first' || CAM_VIEW === 'third') ? 1 : setWorldZoom() / 100;
  cam.fov = 2 * Math.atan(Math.tan(CAM_FOV_BASE * Math.PI / 360) / k) * 180 / Math.PI;
  cam.updateProjectionMatrix();
}

/* setDetail 已搬到 platform/web.js */

/* ★★ round426：把阴影相机的范围收成"刚好够用"（纯画质提升 ✓）
   · 低档可见 ±16 格 → 阴影只要 ±20；中档 ±28 → ±34；高档 ±40 → 保持 ±45 ✓
   · 同样 2048² 的图，范围越小 = 每 texel 越小 = 影子边缘越锐 ✓
   · 由 applyShadow()（平台层）在切设置时调 ✓ 创建灯光时也调一次 ✓ */
var _shadowR = 0;
function applyShadowExtent() {
  if (!sun || !sun.shadow || !sun.shadow.camera) { return; }
  var d = (typeof setDetail === 'function') ? setDetail() : 'mid';
  var r = (d === 'low') ? 20 : ((d === 'high') ? 45 : 34);
  if (Math.abs(r - _shadowR) < 0.01) { return; }
  _shadowR = r;
  sun.shadow.camera.left = -r; sun.shadow.camera.right = r;
  sun.shadow.camera.top = r; sun.shadow.camera.bottom = -r;
  sun.shadow.camera.updateProjectionMatrix();
  if (rd && rd.shadowMap) { rd.shadowMap.needsUpdate = true; }
}

var QS = ('' + UI.search()).toLowerCase();
var AA_MODE = (QS.indexOf('aa=msaa') >= 0) ? 'msaa' : ((QS.indexOf('aa=off') >= 0) ? 'off' : 'fxaa');
var DPR = 2.0;
var _mDpr = /dpr=([\d.]+)/.exec(QS);
if (_mDpr) { DPR = parseFloat(_mDpr[1]) || 2.0; }
if (SETCFG.aa) { AA_MODE = SETCFG.aa; }
if (SETCFG.dpr) { DPR = SETCFG.dpr; }

/* ============ 全局（全部顶层 ✓）============ */
var scene, cam, rd, sun, loadedOk = false;
/* ★★ 这两个必须在 init() 之前就赋好值 ★★
   踩过的坑：原来写在网络那一段（init 之后才执行）→ init 里 netGoOnline() 调 netStartLoop() 时
   它还是 undefined，而判断写的是 `!== null` → undefined !== null 为真 → 直接 return ✗
   → 发包循环根本没起来 → 别人看不到你（自己还一切正常，最难查的一种 ✗）
   规矩：**凡是 init() 期间会读的顶层 var，赋值必须排在 init() 调用之前** ✓ */
var _netTimer = null, _netNext = 0;
var _growTimer = null, _boxOn = false, _texMode = 2;   // ★ 同理，也必须在 init() 之前赋值 ✓
var T = {}, M = {}, H = null, FP = null;
var P = { x: 0, z: 0, yaw: 0, y: 0, vy: 0, air: false, airY: 0 };
/* ★ 第 306 轮：地形的三件套
     y      当前脚底的世界 Y（跟着地形走 ✓）
     vy     竖直速度（跳 / 掉 ✓）
     air    是不是在空中 ✓
     airY   离地那一刻的 Y（用来算掉落落差 ✓）*/
var jx = 0, jy = 0, joyId = null, jox = 0, joy0 = 0;
var keys = {}, atkHeld = false;
var jumpHeld = 0;          // 跳跃键按住的时刻（0 = 没按 ✓）
var jumpCD = 0;            // 跳跃冷却剩余（秒 ✓）
var FALL_MIN = 3;          // 落差 ≥3 格才掉血 ✓
var _camY = 0;             // 相机当前的高度（缓动跟随【地面】✗ 跳跃才看得出来 ✓）
var lastLandSfx = 0;       // 上一次落地音的时刻（点得快时节流 ✓）
var _waterT = 0;           // 溅涟漪的节流（秒 ✓）
var MOV = { vx: 0, vz: 0, tx: 0, tz: 0 };   // 移动速度（★ 为了冰面的惯性 ✗ 原来直接改位移 ✓）
var FALL_DMG = 5;          // 每格 5 点（用户 2026-10-17 定 ✓）
var solids = [], propSolids = [], mobs = [], PROP_MESHES = [], GROUNDMESH = null;

/* 第 173 轮（用户 #6）：安全区 = 正方形 30×30（半边长 15）
   和服务器 mq.SAFE_HALF 必须一致 —— 不一致就会出现
   "看着在圈里却被打" 或者 "看着在外面其实安全" 这种鬼问题 */
var SAFE_HALF = 250.0;
/* town.js 先加载：保留它已经建好的数据 ✗ 不要在这里重置 */
var TOWN_SOLIDS = (typeof TOWN_SOLIDS !== 'undefined') ? TOWN_SOLIDS : [];
var WH_OPEN;       /* platform 声明并维护 */
var WH_NEAR = false;
var MY_SEAT = null;        /* 我正坐着的椅子（TOWN_SEATS 里的对象） */
var SEAT_NEAR = null;      /* 离我最近、可以坐的椅子 */
var TP_NEAR = null;        /* 离我最近的传送阵 */
var HOUSE_NEAR = null;     /* 离我最近的住宅 */
var SLEEP_NEAR = null;     /* 离我最近的床（房主） */
var MY_SLEEP = '';         /* 正在睡的住宅 id */
var SLEEP_OFF = 0.55;      /* 躺下时沿床朝向的偏移（脚放床尾，头不要伸出床头） */
var SHOP_NEAR = null;      /* 离我最近的商店 */
var FRIDGE_NEAR = null;    /* 离我最近的自家冰箱 */
var SIT_K = 0;             /* 坐下动画混合 0→1 */
var SIT_PENDING = false;   /* 坐下请求已发出（等她回包期间别发 move 打架）*/
function townSeatApply(d) {
  if (!d) { return; }
  var s = (typeof townSeatById === 'function') ? townSeatById(d.id) : null;
  if (!s && typeof d.x === 'number') {
    s = { idx: d.id, x: d.x, z: d.z, yaw: d.yaw || 0, y: d.y || 0.30, k: 'chair', label: '椅子' };
  }
  if (!s) { return; }
  MY_SEAT = s;
  SIT_PENDING = false;
  SIT_K = 0;
  P.x = s.x; P.z = s.z; P.yaw = s.yaw;
  MOV.vx = 0; MOV.vz = 0; MOV.tx = 0; MOV.tz = 0;
  atkHeld = false; atkT = -1; jumpHeld = 0;
  SEAT_NEAR = null;
  try { if (UI.seatNear) { UI.seatNear(null); } } catch (e1) { }
  try { if (UI.seatState) { UI.seatState(true); } } catch (e2) { }
  try { if (UI.seatedUpdate) { UI.seatedUpdate(s); } } catch (e3) { }
}
function townSeatClear(d) {
  if (!MY_SEAT) { return; }
  MY_SEAT = null;
  SIT_PENDING = false;
  SIT_K = 0;
  if (d && typeof d.x === 'number' && isFinite(d.x)) {
    P.x = +d.x; P.z = +d.z; P.yaw = +d.yaw || P.yaw;
  }
  try { if (UI.seatState) { UI.seatState(false); } } catch (e3) { }
  try { if (UI.seatedUpdate) { UI.seatedUpdate(null); } } catch (e4) { }
}
var townNearWarehouse = (typeof townNearWarehouse !== 'undefined') ? townNearWarehouse : null;
var townSeatNear = (typeof townSeatNear !== 'undefined') ? townSeatNear : null;
var townSeatById = (typeof townSeatById !== 'undefined') ? townSeatById : null;
var townHouseNear = (typeof townHouseNear !== 'undefined') ? townHouseNear : null;
var townTeleportNear = (typeof townTeleportNear !== 'undefined') ? townTeleportNear : null;
var townHouseSleepNear = (typeof townHouseSleepNear !== 'undefined') ? townHouseSleepNear : null;
var townShopNear = (typeof townShopNear !== 'undefined') ? townShopNear : null;
var townHouseFridgeNear = (typeof townHouseFridgeNear !== 'undefined') ? townHouseFridgeNear : null;
var townIn = (typeof townIn !== 'undefined') ? townIn : null;
var townRoofTick = (typeof townRoofTick !== 'undefined') ? townRoofTick : null;
var TOWN_COUNTER = (typeof TOWN_COUNTER !== 'undefined') ? TOWN_COUNTER : { x: -15, z: 9.5 };
var _townProjectV = null;
var buildTown = (typeof buildTown !== 'undefined') ? buildTown : null;
function inSafeZone(x, z) {
  return (Math.abs(x) <= SAFE_HALF) && (Math.abs(z) <= SAFE_HALF);
}

/* 第 173 轮（用户 #6）：安全区地板 —— 单独一块平面，精确 30×30
   为什么不给地形顶点上色：地形是【按块】上色的（一块 20 世界单位）
   那样只能画出 20 或 40 的方块，做不到精确 30 —— 看着就不对
   单独一块平面：精确 ✓ 只多 1 次 draw call ✓ 而且明显更好认 ✓ */
var SAFE_MESH = null, SAFE_EDGE = null;
var TOWN_CX = (typeof TOWN_CX !== 'undefined') ? TOWN_CX : 0;
var TOWN_CZ = (typeof TOWN_CZ !== 'undefined') ? TOWN_CZ : 0;
var VIL_FLOOR = 0;
var MY_JOB = (typeof MY_JOB !== 'undefined') ? MY_JOB : '';
var JOB_T = (typeof JOB_T !== 'undefined') ? JOB_T : 0;
var townVillaAt = (typeof townVillaAt !== 'undefined') ? townVillaAt : null;
var townVillaFloor = (typeof townVillaFloor !== 'undefined') ? townVillaFloor : null;
var townLabelTick = (typeof townLabelTick !== 'undefined') ? townLabelTick : null;
function buildSafeZone() {
  if (SAFE_MESH) { return; }
  /* 第 173 轮的地板/白线已替换成真正的新手小镇（town.js） */
  if (typeof buildTown === 'function') {
    SAFE_MESH = buildTown();
  }
}

var occupied = {}, GEO_CACHE = {};
var HP = 200, HPMAX = 200, ATK = 12;
var dead = false;                    // ★ 倒下状态（血空 → 必须点复活才起来 ✓）
/* ★★ 第 56 轮：复活无敌剩余（秒）★★
   用户要求：复活后 1.5 秒无敌 + 无视体积碰撞，方便逃出怪群 ✓
   ★ 是不是真免伤由【服务器】说了算（它那边也有一个 invulnT ✓）
     这里只管表现和"能不能穿怪" ✓ */
var INVULN_T = 0;/* ★ 血条配色：妖兽一律红 ✓ 玩家一律绿 ✓（不再按残血变色 ✓ 一眼分得清敌我 ✓）*/
var BAR_MOB = 'linear-gradient(180deg,#ff6a5a,#c02a1a)';
var BAR_PLR = 'linear-gradient(180deg,#7ee08a,#3aa04a)';
var walkT = 0, atkT = -1, atkCd = 0, shake = 0, hitStop = 0, mobT = 0, lastTs = 0;
/* ★ round452：登录界面的电影镜头（平台层在 showLogin/hideLogin 里切换 ✓）*/
var LOGIN_CINE = false;
/* ★ round432：自己名牌的“上次写的值”缓存 ✗ 值没变就不重写 DOM ✓ */
var _selfPlate = {};
var frameNo = 0;   /* ★ round432：帧计数（名牌隔帧更新用 ✓）*/
/* ★ round429/431：暴击只留【顿帧】（镜头推近用户说没用 → 已删✗）*/


/* ★★ 第 169 轮（用户 #2）：挥砍动画速度倍率 ★★
   ★ 只影响【动画快慢】✗ 完全不影响攻速 ✓
     攻速是服务器 weapons.interval_of 算的（多久能砍一刀）✓ 这里碰不到 ✓
   ★ 为什么僵尸不动：僵尸的 atkT 是服务器发过来的 ✗
     客户端改它的速度会和服务器错位 ✓（打中时机看着就不对了 ✓）
   ★ 自己和别人都是客户端本地累加的 ✓ 所以一起加速 ✓（看起来才一致 ✓）*/
var ATK_ANIM_SPD = 1.2;
var _shadowTick = 0;   // ★ 第 44 轮：阴影隔帧更新的计数器（★ 必须在顶层 —— 放 init() 里 frame() 看不到 ✗）
var ATK_CD = 0.62;      // ★ 挥剑冷却（秒）—— 界面上的冷却表现也按这个算 ✓
var _atkCdP = -1;       // ★ 上次推给界面的冷却比例（只在变化超过 4% 时才写 DOM ✓）
var fpsCnt = 0, fpsT = 0, fpsLastMs = 0, diagTick = 0, _lastMs = 0;
var stepTimer = 0;   // ★ 脚步声计时 ✓
var lastPCX = 1e9, lastPCZ = 1e9;
var API = '';

/* ============ 物件部件表（必须在所有函数之前 ✓）============ */
var PROP_PARTS = {
  tree:  [[0.55,2.6,0.55,'log',0,1.3,0],[2.6,1.5,2.6,'deadleaf',0,3.2,0],[2.0,1.2,2.0,'deadleaf',0,4.2,0],[1.2,0.9,1.2,'deadleaf',0,5.0,0]],
  tree2: [[0.45,3.4,0.45,'log',0,1.7,0],[3.0,1.6,3.0,'deadleaf',0,3.9,0],[2.4,1.4,2.4,'deadleaf',0,5.0,0],[1.6,1.1,1.6,'deadleaf',0,6.0,0],[0.9,0.8,0.9,'deadleaf',0,6.8,0]],
  tree3: [[0.65,1.8,0.65,'log',0,0.9,0],[3.4,1.3,3.4,'deadleaf',0,2.4,0],[2.6,1.1,2.6,'deadleaf',0,3.3,0]],
  rock:  [[1.3,1.0,1.3,'stone',0,0.5,0],[0.9,0.7,0.9,'stone',0.5,0.35,0.2]],
  rock2: [[1.8,0.8,1.6,'stone',0,0.4,0],[1.2,0.6,1.1,'stone',-0.8,0.3,0.5],[1.0,0.5,1.0,'stone',0.7,0.25,-0.5]],
  rock3: [[0.9,1.6,0.9,'stone',0,0.8,0],[0.7,0.6,0.7,'stone',0.3,1.5,0.2]],
  fence: [[2.8,0.18,0.18,'plank',0,1.0,0],[0.2,1.5,0.2,'log',-1.3,0.75,0],[0.2,1.5,0.2,'log',0,0.75,0],[0.2,1.5,0.2,'log',1.3,0.75,0]],
  fence2:[[3.6,0.16,0.16,'plank',0,1.1,0],[3.6,0.16,0.16,'plank',0,0.6,0],[0.2,1.6,0.2,'log',-1.7,0.8,0],[0.2,1.6,0.2,'log',0,0.8,0],[0.2,1.6,0.2,'log',1.7,0.8,0]],
  house: [[5.2,3.2,4.2,'plank',0,1.6,0],[5.6,0.5,4.6,'stone',0,0.25,0],[6.0,0.55,5.0,'brick',0,3.4,0],
          [5.5,0.55,4.5,'brick',0,3.9,0],[5.0,0.55,4.0,'brick',0,4.4,0],[4.5,0.55,3.5,'brick',0,4.9,0],
          [4.0,0.55,3.0,'brick',0,5.4,0],[1.2,1.8,0.2,'log',0,0.9,2.1],
          [1.0,1.0,0.2,'water',-1.7,1.9,2.1],[1.0,1.0,0.2,'water',1.7,1.9,2.1]],
  house2:[[4.0,2.6,3.4,'plank',0,1.3,0],[4.4,0.4,3.8,'stone',0,0.2,0],[4.8,0.5,4.2,'brick',0,2.8,0],
          [4.2,0.5,3.6,'brick',0,3.3,0],[3.6,0.5,3.0,'brick',0,3.8,0],[1.0,1.6,0.2,'log',0,0.8,1.8],
          [0.8,0.8,0.2,'water',-1.3,1.6,1.8],[0.8,0.8,0.2,'water',1.3,1.6,1.8]],
  /* ★ 末日残骸（第 30 轮加的）—— 全是方块拼的（和上面同一套格式：[宽,高,深,材质,偏移x,偏移y,偏移z]）
     枯树：光杆 + 几根斜插的枯枝（没有叶子 ✓ 一眼就是"死掉的树"）
     废墟堆：塌掉的砖石堆
     报废车：烧空的车壳 + 四个轮子
     油桶：几个锈桶（有的倒着）*/
  dead:  [[0.50,3.0,0.50,'log',0,1.5,0],[1.5,0.20,0.20,'log',0.55,2.55,0.15],
          [1.3,0.18,0.18,'log',-0.45,2.15,-0.30],[1.1,0.16,0.16,'log',0.20,2.90,-0.45]],
  rubble:[[1.9,0.50,1.7,'stone',0,0.25,0],[1.2,0.45,1.0,'brick',0.75,0.22,0.45],
          [1.0,0.40,0.9,'brick',-0.60,0.20,-0.40],[0.7,0.50,0.7,'stone',0.30,0.75,-0.20]],
  wreck: [[2.6,0.75,1.35,'brick',0,0.55,0],[1.5,0.60,1.15,'brick',-0.15,1.20,0],
          [0.5,0.50,0.5,'stone',-0.90,0.30,-0.65],[0.5,0.50,0.5,'stone',0.90,0.30,-0.65],
          [0.5,0.50,0.5,'stone',-0.90,0.30,0.65],[0.5,0.50,0.5,'stone',0.90,0.30,0.65]],
  barrel:[[0.75,1.00,0.75,'brick',0,0.50,0],[0.80,0.12,0.80,'stone',0,1.02,0],
          [0.70,0.90,0.70,'brick',0.95,0.45,0.35]],
  /* 废墟墙：一段断墙 + 一段折角 + 墙根的碎砖 —— 末日最标志性的东西 ✓ */
  ruin:  [[4.0,2.2,0.45,'brick',0,1.10,0],[0.45,2.2,3.2,'brick',-1.80,1.10,1.40],
          [1.6,0.60,1.2,'brick',1.00,0.30,0.60],[1.2,0.50,1.0,'stone',-0.60,0.25,-0.80],
          [0.9,0.40,0.9,'brick',0.40,0.20,1.30]]
};

/* ============ 工具 ============ */
function worldX(cx) { return cx * G.TS; }
function worldZ(cz) { return cz * G.TS; }
function cellOf(w) { return Math.round(w / G.TS); }

/* ============================================================================
   ★★★ 地形（高度 / 材质 / 斜坡）★★★
   ★★ 这一整块必须和 server/terrain.py 【逐位等价】★★
     差一点 → 服务器认为这里有墙 / 客户端看到一条路 → 僵尸穿墙 ✓
     所以：
       · 只用 + − × ÷ 和 Math.floor ✗ 不用 Math.pow / 三角函数 ✓
         （两个语言的 libm 可能差 1ulp ✗ 差一点就全错 ✓）
       · 整数哈希要模拟 JS 的 int32 语义（Python 那边也照着写 ✓）
       · 改任何一边 ✗ tools/check_terrain_sync.py 会立刻红 ✓
   单位：
     高度 h 的单位是【层】✗ 浮点 ✗ 0.0 = 地面 ✓
     一层 = TER.LEVEL_H 世界单位（= G.TS ✓ 所以是方块 ✓）
   ============================================================================ */
var TER = {
  LEVEL_H: 0.62,      // 一层多高（= G.TS ✓ 方块才是方的 ✓）
  HB: 24,             // 大山：每 24×24 格最多一座
  HB_SMALL: 12,       // 小土包：每 12×12 格
  HILL_CHANCE: 0.50,
  SMALL_CHANCE: 0.30,
  MAX_H: 5,
  STEP_WALK: 0.35,    // 走上去的最大落差（层）
  STEP_JUMP: 1.15,    // 跳上去的最大落差（层）
  TILE: 16,           // 地形瓦片边长（格）
  TILE_R: 4,          // 渲染半径（瓦片）
  TILE_BUDGET: 3,     // 一帧最多新建几片
  JUMP_V: 8.15,       // 起跳速度（世界单位/秒）→ 顶点 1.15 层 / 滞空 0.35 秒
  GRAV: 46.6          // 重力
};
/* ★★ 用户 2026-10-17 第三轮的三条改动 ★★
   ① 不要斜坡了 ✗ terSlope 恒为 0 ✓
   ② 平地必须一样高 ✗ 所以【没有低频噪声、没有每格抖动】✓
   ③ 山的样式多样 + 要有悬崖 ✓
      → 每座山 = 3 个偏心圆叠出来（形状不规整 ✗ 但只用 sqrt ✓ 两边一致 ✓）
      → 缓山（每格落差 1 ✗ 跳得上去）/ 悬崖山（落差 2 ✗ 跳不上去）✓ */

function ter32(gx, gz, salt) {
  var a = gx * 2654435761;
  var b = gz * 40503;
  var c = salt * 2246822519;
  return ((a ^ b) ^ c) >>> 0;
}
function terRand01(gx, gz, salt) {
  return (ter32(gx, gz, salt) % 1000000) / 1000000;
}
function terSmooth(t) {
  if (t <= 0) { return 0; }
  if (t >= 1) { return 1; }
  return t * t * (3 - 2 * t);
}

var _hillCache = {}, _hillCacheN = 0;
function terHillBlock(bx, bz, hb, salt, chance, hmin, hmax, rFlat, rCliff, cliffAt) {
  var k = bx + ',' + bz + ',' + hb + ',' + salt;
  if (k in _hillCache) { return _hillCache[k]; }
  var out = null;
  if (terRand01(bx, bz, salt + 0) < chance) {
    var cx = bx * hb + terRand01(bx, bz, salt + 1) * hb;
    var cz = bz * hb + terRand01(bx, bz, salt + 2) * hb;
    var hh = hmin + Math.floor(terRand01(bx, bz, salt + 3) * (hmax - hmin + 1));
    if (hh > hmax) { hh = hmax; }
    var cliff = terRand01(bx, bz, salt + 4) < cliffAt;
    var baseR = (cliff ? rCliff : rFlat) * hh + 1.2;
    baseR *= 0.80 + terRand01(bx, bz, salt + 5) * 0.55;
    var blobs = [];
    for (var i = 0; i < 3; i++) {
      blobs.push([cx + (terRand01(bx, bz, salt + 10 + i) - 0.5) * baseR * 0.75,
                  cz + (terRand01(bx, bz, salt + 20 + i) - 0.5) * baseR * 0.75,
                  baseR * (0.58 + terRand01(bx, bz, salt + 30 + i) * 0.42)]);
    }
    out = [blobs, hh];
  }
  if (_hillCacheN > 8192) { _hillCache = {}; _hillCacheN = 0; }
  _hillCache[k] = out; _hillCacheN++;
  return out;
}
function terBigHill(bx, bz) {
  return terHillBlock(bx, bz, TER.HB, 71, TER.HILL_CHANCE, 2, 5, 1.35, 0.45, 0.34);
}
function terSmallHill(bx, bz) {
  return terHillBlock(bx, bz, TER.HB_SMALL, 101, TER.SMALL_CHANCE, 1, 2, 1.40, 0.60, 0.20);
}
function terContrib(gx, gz, hill) {
  if (!hill) { return 0; }
  var blobs = hill[0], hh = hill[1], best = 0;
  for (var i = 0; i < blobs.length; i++) {
    var ddx = gx - blobs[i][0], ddz = gz - blobs[i][1];
    var dist = Math.sqrt(ddx * ddx + ddz * ddz);
    if (dist >= blobs[i][2]) { continue; }
    var t = terSmooth(1 - dist / blobs[i][2]);
    if (t > best) { best = t; }
  }
  if (best <= 0) { return 0; }
  var v = Math.floor(best * hh + 0.5);
  return v > hh ? hh : v;
}

/* ★ 缓存：几何构建时每格要问好几次邻居 ✗ 不缓存会很慢 ✓ */
var _terHc = {}, _terHcN = 0, _terMc = {}, _terSc = {};
function _terKey(gx, gz) { return ((gx & 0xffff) << 16) | (gz & 0xffff); }
function terHClear() { _terHc = {}; _terMc = {}; _terSc = {}; _terHcN = 0; }

function terHillH(gx, gz) {
  var bx = Math.floor(gx / TER.HB), bz = Math.floor(gz / TER.HB);
  var best = 0, dx, dz, v;
  for (dx = -1; dx <= 1; dx++) {
    for (dz = -1; dz <= 1; dz++) {
      v = terContrib(gx, gz, terBigHill(bx + dx, bz + dz));
      if (v > best) { best = v; }
    }
  }
  var sx = Math.floor(gx / TER.HB_SMALL), sz = Math.floor(gz / TER.HB_SMALL);
  for (dx = -1; dx <= 1; dx++) {
    for (dz = -1; dz <= 1; dz++) {
      v = terContrib(gx, gz, terSmallHill(sx + dx, sz + dz));
      if (v > best) { best = v; }
    }
  }
  return best;
}

/* ★ round310（P1 破坏）：被破坏的格子（服务端说了算 ✗ 客户端只存 ✓）
   key -> 新高度 ✗ 收到 teredit 就更新 ✓ 同时清缓存 + 重建受影响的瓦片 ✓ */
var terOver = {};
/* ★ round317（用户："水应该是在地面下一格，得有方块包围才合理"）
   水盆格的高度是 −1 ✗ 四周是 0 → 水在坑里 ✓ 四周有岸 ✓ */
function terBasin(gx, gz) {
  var b = terBiome(gx, gz);
  if (b === 'swamp') { return terNoise(gx, gz, 131, 6) > 0.52; }
  if (b === 'ruin') {
    return terNoise(gx, gz, 137, 7) > 0.62 && terNoise(gx, gz, 121, 9) > 0.855;
  }
  return false;
}

/* ★ 新手小镇 50×50：镇内地形强制平地 ✗ 不生成方块山 ✓ */
var TER_TOWN_HALF = 250.0, TER_TOWN_TRANS = 4.0;
function terTownCellDist(gx, gz) {
  var x0 = gx * TER.LEVEL_H, x1 = x0 + TER.LEVEL_H;
  var z0 = gz * TER.LEVEL_H, z1 = z0 + TER.LEVEL_H;
  if (x0 < TER_TOWN_HALF && x1 > -TER_TOWN_HALF &&
      z0 < TER_TOWN_HALF && z1 > -TER_TOWN_HALF) { return 0; }
  var cx = (x0 + x1) * 0.5, cz = (z0 + z1) * 0.5;
  var dx = Math.max(0, Math.abs(cx) - TER_TOWN_HALF);
  var dz = Math.max(0, Math.abs(cz) - TER_TOWN_HALF);
  return Math.max(dx, dz);
}
function terTownFlattenH(gx, gz, h) {
  var d = terTownCellDist(gx, gz);
  if (d <= 0) { return 0; }
  if (d < TER_TOWN_TRANS) { return h * (d / TER_TOWN_TRANS); }
  return h;
}

function terH(gx, gz) {
  var k = _terKey(gx, gz);
  var v = _terHc[k];
  if (v !== undefined) { return v; }
  var _townD = terTownCellDist(gx, gz);
  if (_townD <= 0) {
    v = 0;                 // ★ 小镇内永远平地 ✓ 旧覆盖也不生效 ✓
  } else {
    var ov = terOver[k];
    if (ov !== undefined) {
      v = ov;
    } else if (terBasin(gx, gz)) {
      v = -1;                       // ★ 水盆比其他地面低一层 ✓
    } else {
      v = terHillH(gx, gz);
      if (v < 0) { v = 0; }
      if (v > TER.MAX_H) { v = TER.MAX_H; }
    }
    v = terTownFlattenH(gx, gz, v);   // ★ 门口平滑过渡 ✓
  }
  if (_terHcN > 400000) { terHClear(); }
  _terHc[k] = v; _terHcN++;
  return v;
}
/* ★ 成片的 value noise（和 server/terrain.py 的 vnoise 逐位等价 ✓）
   ★ 自测踩到：材质原来用 terRand01（每格独立白噪声）✗
     画出来是【一格绿一格褐】的噪点 ✗ 像马赛克不像草地 ✓ */
function terNoise(gx, gz, salt, period) {
  var fx = gx / period, fz = gz / period;
  var ix = Math.floor(fx), iz = Math.floor(fz);
  var sx = terSmooth(fx - ix), sz = terSmooth(fz - iz);
  var v00 = terRand01(ix, iz, salt), v10 = terRand01(ix + 1, iz, salt);
  var v01 = terRand01(ix, iz + 1, salt), v11 = terRand01(ix + 1, iz + 1, salt);
  return (v00 + (v10 - v00) * sx) + ((v01 + (v11 - v01) * sx) - (v00 + (v10 - v00) * sx)) * sz;
}
/* ★★★ P2 地貌（和 server/terrain.py 的 biome 逐位等价 ✓）★★★ */
var TER_BIOME_SIZE = 48, TER_BIOME_SAFE = 70;
var TER_BIO_SPEED = { wild: 1.0, ice: 1.45, swamp: 0.58, ruin: 1.0 };
function terBiome(gx, gz) {
  if ((gx * gx + gz * gz) < (TER_BIOME_SAFE * TER_BIOME_SAFE)) { return 'wild'; }
  var n = terNoise(gx, gz, 91, TER_BIOME_SIZE);
  if (n > 0.62) { return 'ice'; }
  if (n > 0.545) { return 'swamp'; }
  if (n < 0.36) { return 'ruin'; }
  return 'wild';
}

/* ★★★ F0 静水（和 server/terrain.py 的 fluid_of 逐位等价 ✓）★★★ */
var TER_F_DEPTH = { 2: 0.70, 3: 0.80 };
/* ★ F1：服务端会改流体（流动 ✓）→ 覆盖表优先于"算出来的" ✓ */
var fluidOv = {};       // key -> [kind, level]   level −1 = 没有
function terFluid(gx, gz) {
  if (Math.abs(gx * TER.LEVEL_H) <= TER_TOWN_HALF && Math.abs(gz * TER.LEVEL_H) <= TER_TOWN_HALF) { return 0; }
  var _fo = fluidOv[_terKey(gx, gz)];
  if (_fo !== undefined) { return _fo[0]; }
  if (!terBasin(gx, gz)) { return 0; }
  var b = terBiome(gx, gz);
  if (b === 'swamp') { return 2; }   // 污水
  if (b === 'ruin') { return 3; }    // 地火
  return 0;
}

/* ★ 水面高度（世界单位 Y ✗ 没流体返回 null）
   ★★ 自测踩到：水盆改到地下一层之后 ✗ 涟漪还放在 P.y（= 坑底 −0.62）
      而水面在 −0.19 → 涟漪生成在水底下 ✗ 看不见 ✓
      所以任何"贴在水面上的东西"都必须用这个函数 ✗ 不能用 P.y ✓ */
function terFluidY(gx, gz) {
  var k = terFluid(gx, gz);
  if (!k) { return null; }
  var _fo = fluidOv[_terKey(gx, gz)];
  var d = TER_F_DEPTH[k] || 0.7;
  if (_fo && _fo[1] > 0) { d = d * (1 - _fo[1] / 8); }   // ★ 流出来的越远越浅
  return (terH(gx, gz) + d) * TER.LEVEL_H;
}

function terMat(gx, gz) {
  var k = _terKey(gx, gz);
  var v = _terMc[k];
  if (v !== undefined) { return v; }
  var b = terBiome(gx, gz);
  if (b === 'ice') { v = 'ice'; }
  else if (b === 'swamp') { v = 'swamp'; }
  else if (b === 'ruin') { v = 'brick'; }
  else {
    var h = terH(gx, gz);
    if (h >= 4) { v = 'stone'; }
    else if (h >= 2 && terNoise(gx, gz, 43, 5) > 0.55) { v = 'stone'; }
    else if (terNoise(gx, gz, 31, 9) > 0.62) { v = 'dirt'; }
    else { v = 'grass'; }
  }
  _terMc[k] = v;
  return v;
}
/* ★ 用户："不要斜坡了" ✗ 恒为 0 ✓（留着是为了交叉验证测试还要比这一项 ✓） */
function terSlope(gx, gz) { return 0; }
/* 格子内的地面 Y（世界单位 ✓）—— 没有斜坡，整格是平的 ✓ */
function terGroundY(gx, gz, fx, fz) { return terH(gx, gz) * TER.LEVEL_H; }
/* 裂纹进度（客户端本地记 ✗ 只为了"看得出还要几刀"✓ 服务端有自己的计数 ✓） */
var terDmg = {};
var propDmg = {};      // 树打了几下（只为了立刻给反馈 ✗ 权威在服务端 ✓）

/* ============================================================================
   ★★★ 破坏的表现（方案 §5.6 的第②③④层）★★★
   ② 碎屑粒子  【每一刀】…… 这里先做"碎块"④（第②层要按刀生成 ✗ 量大 ✗ P1.5 再说）
   ③ 裂纹贴图  【过阈值】打一半时在格子上画几道黑色的裂缝 ✓
   ④ 碎裂+尘烟 【最后一下】炸成几块飞出去 ✓
   ★ 全部用【对象池】✗ 不在运行时 new Mesh ✓（手机上 new 一个 mesh 要 1~2ms ✓）
   ============================================================================ */
var CRACK_MAX = 180, DEB_MAX = 90;
var _crackPool = [], _debPool = [], _deb = [], _poolReady = false;

function terPoolInit() {
  if (_poolReady) { return; }
  _poolReady = true;
  // ③ 裂纹：一片很细的黑条，两个交叉着放就是一道裂缝 ✓
  var cg = new THREE.PlaneGeometry(0.30, 0.035);
  var cm = new THREE.MeshBasicMaterial({ color: 0x14110e, transparent: true,
    opacity: 0.72, depthWrite: false });
  for (var i = 0; i < CRACK_MAX; i++) {
    var m = new THREE.Mesh(cg, cm);
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    m.renderOrder = 3;
    scene.add(m);
    _crackPool.push(m);
  }
  // ④ 碎块：小方块（按材质上色 ✗ 共用一个几何 ✓）
  var dg = new THREE.BoxGeometry(1, 1, 1);
  for (var j = 0; j < DEB_MAX; j++) {
    var mm = new THREE.Mesh(dg, new THREE.MeshBasicMaterial({ color: 0x8a8064 }));
    mm.visible = false;
    scene.add(mm);
    _debPool.push(mm);
    _deb.push({ on: 0, vx: 0, vy: 0, vz: 0, t: 0, life: 0, sc: 1 });
  }
}

/* 在某一格上画 got 道裂纹（★ 位置按格子的哈希定 ✗ 同一格每次都一样 ✓）*/
function terCrack(gx, gz, got, need) {
  terPoolInit();
  var key = _terKey(gx, gz);
  // 先把这一格旧的全收回去 ✗ 再按新的进度重画 ✓
  for (var i = 0; i < _crackPool.length; i++) {
    if (_crackPool[i].visible && _crackPool[i]._k === key) { _crackPool[i].visible = false; }
  }
  var h = terH(gx, gz) * TER.LEVEL_H;
  var n = Math.min(got, 5);                 // 最多画 5 道（再多也看不出来 ✓）
  var placed = 0;
  for (var c = 0; c < _crackPool.length && placed < n; c++) {
    var m = _crackPool[c];
    if (m.visible) { continue; }
    var a = (terRand01(gx, gz, 200 + placed) * Math.PI);
    var fx = 0.25 + terRand01(gx, gz, 210 + placed) * 0.5;
    var fz = 0.25 + terRand01(gx, gz, 220 + placed) * 0.5;
    m.position.set((gx + fx) * TER.LEVEL_H, h + 0.012, (gz + fz) * TER.LEVEL_H);
    m.rotation.z = a;
    m.scale.set(0.55 + 0.45 * (got / Math.max(1, need)), 1, 1);
    m.visible = true;
    m._k = key;
    placed++;
  }
}

/* ★★★ round312（用户："破坏的动画不好看，应该是有方块碎裂小石头掉落"）★★★
   上一版：8 个小方块往外飞 ✗ 一边飞一边缩小 ✗ 像"放烟花"✓ 不像"碎石头"✓
   这一版：14 块石头 ✗ 受重力【真的落到地上】✗ 停一会儿再淡出 ✓
         落地会弹一下（像石子 ✓）
   ★ 落点用【破坏前那一格的高度】✗ 不重新查地形 ✓（查了会取到已经变矮的值 ✓）*/
function terDebris(gx, gz, mat, baseH) {
  terPoolInit();
  var col = TER_COL[mat] || TER_COL.grass;
  var want = 14, made = 0;
  var cy = (baseH === undefined ? terH(gx, gz) : baseH) * TER.LEVEL_H;
  for (var i = 0; i < _deb.length && made < want; i++) {
    var d = _deb[i];
    if (d.on) { continue; }
    var m = _debPool[i];
    d.on = 1; d.t = 0; d.life = 2.0; d.landed = 0; d.fade = 0;
    d.sc = 0.055 + terRand01(gx, gz, 300 + i) * 0.085;
    var ang = terRand01(gx, gz, 320 + i) * Math.PI * 2;
    var sp = 0.7 + terRand01(gx, gz, 340 + i) * 1.9;
    d.vx = Math.cos(ang) * sp;
    d.vz = Math.sin(ang) * sp;
    d.vy = 1.8 + terRand01(gx, gz, 360 + i) * 2.4;
    d.gnd = cy + d.sc * 0.5;
    m.position.set((gx + 0.2 + terRand01(gx, gz, 380 + i) * 0.6) * TER.LEVEL_H,
                   cy + 0.3, (gz + 0.2 + terRand01(gx, gz, 390 + i) * 0.6) * TER.LEVEL_H);
    m.scale.setScalar(d.sc);
    m.rotation.x = terRand01(gx, gz, 400 + i) * 3.14;
    m.rotation.z = terRand01(gx, gz, 410 + i) * 3.14;
    m.material.color.setRGB(Math.min(1, col[0] * 0.85 + 0.10),
                            Math.min(1, col[1] * 0.85 + 0.10),
                            Math.min(1, col[2] * 0.85 + 0.10));
    m.material.transparent = false;
    m.material.opacity = 1;
    m.visible = true;
    made++;
  }
  /* ★ 尘烟：一格宽的扁片，扩散淡出（0.5 秒 ✓）
     ★ 为什么要有：光有石头会很"脆"✗ 加一层灰才像"塌了"✓ */
  terDust(gx, gz, cy, col);
}

/* ★★★ round340（用户："方块和这些可以破坏的东西打中加个轻微闪白，僵尸也是"）
   ★ 为什么用"命中点闪一下"而不是"改材质颜色"：
     方块和物件是【按材质合并】的 ✗ 改一个材质的颜色会让整片一起白 ✓
     而命中点闪白不碰材质 ✗ 只管一个独立的小面片 ✓ 开销几乎为零 ✓ */
var _flashPool = [], _flash = [];
/* ★★★ round341（用户："闪白是被攻击的对应模型闪白，而不是在上方闪白"）
   ★ 上一版是"命中点冒一个面片"✗ 看着像凭空亮了一下 ✓
   ★ 现在改成：把【被击中的那个模型】克隆一份 ✗ 整体染白 ✗ 0.12 秒淡出 ✓
     · 方块 → 克隆一个白色方块
     · 树/石头/房子 → 克隆那件物件
     · 僵尸 → 克隆那只僵尸
   ★ 为什么可以克隆：命中是低频操作（每秒几次 ✓）✗ 0.12 秒就回收 ✓ */
var _flashClones = [];
function flashCloneMesh(obj) {
  if (!obj) { return; }
  var wm = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending });
  var c;
  try { c = obj.clone(true); } catch (e) { return; }
  c.traverse(function (o) {
    if (o.isMesh || o.isInstancedMesh) { o.material = wm; o.castShadow = false; }
  });
  c.position.copy(obj.position);
  c.rotation.copy(obj.rotation);
  c.scale.copy(obj.scale);
  c.visible = true;
  if (obj.parent) { obj.parent.add(c); } else { scene.add(c); }
  _flashClones.push({ o: c, t: 0, m: wm, peak: 0.18 });
  if (_flashClones.length > 8) {
    var f0 = _flashClones.shift();
    if (f0.o.parent) { f0.o.parent.remove(f0.o); }
    f0.m.dispose();
  }
}
function flashCloneTick(dt) {
  for (var i = _flashClones.length - 1; i >= 0; i--) {
    var f = _flashClones[i];
    f.t += dt;
    /* ★ round342（用户："闪白的动画慢一点，淡入淡出，再淡一点"）
       ★ 曲线：sin(k*π) → 0 起来、峰值、再落回 0 ✗ 两头都是软的 ✓
         （原来是"一下子到峰值再线性淡出"✗ 起点很硬 ✓）
       ★ 时长 0.14 → 0.30 秒（慢一倍 ✓）
       ★ 峰值 0.34/0.30 → 0.18/0.16（淡很多 ✓）*/
    var k = f.t / 0.22;
    if (k >= 1) {
      if (f.o.parent) { f.o.parent.remove(f.o); }
      f.m.dispose();
      _flashClones.splice(i, 1);
    } else {
      f.m.opacity = f.peak * Math.sin(k * Math.PI);
    }
  }
}
/* 方块：没有现成对象 ✗ 现造一个白色方块（和地形格子同尺寸 ✓） */
var _blockFlashGeo = null;
function flashBlock(gx, gz) {
  if (!_blockFlashGeo) { _blockFlashGeo = new THREE.BoxGeometry(TER.LEVEL_H, TER.LEVEL_H, TER.LEVEL_H); }
  var wm = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending });
  var m = new THREE.Mesh(_blockFlashGeo, wm);
  m.position.set((gx + 0.5) * TER.LEVEL_H,
                 (terH(gx, gz) - 0.5) * TER.LEVEL_H,
                 (gz + 0.5) * TER.LEVEL_H);
  /* ★ 不能旋转 ✗ 转了方块就和格子的边对不上（用户报"没和方块重叠"）✓
     ★ 稍微放大 2% ✗ 盖住和地形之间的接缝 ✓ */
  m.scale.setScalar(1.02);
  scene.add(m);
  _flashClones.push({ o: m, t: 0, m: wm, peak: 0.16 });
}
function hitFlash(wx, wy, wz, big) {
  if (!_flashPool.length) {
    var fg = new THREE.PlaneGeometry(1, 1);
    for (var i = 0; i < 10; i++) {
      var mm = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
        depthTest: false, blending: THREE.AdditiveBlending }));
      mm.visible = false;
      mm.renderOrder = 20;
      scene.add(mm);
      _flashPool.push(mm);
      _flash.push({ on: 0, t: 0 });
    }
  }
  for (var j = 0; j < _flash.length; j++) {
    if (_flash[j].on) { continue; }
    var d = _flash[j], m = _flashPool[j];
    d.on = 1; d.t = 0;
    m.position.set(wx, wy + 0.35, wz);
    m.scale.setScalar((big ? 0.9 : 0.62));
    m.material.opacity = 0.55;
    m.visible = true;
    return;
  }
}
function hitFlashTick(dt) {
  for (var i = 0; i < _flash.length; i++) {
    var d = _flash[i];
    if (!d.on) { continue; }
    d.t += dt;
    var k = d.t / 0.14;
    if (k >= 1) { d.on = 0; _flashPool[i].visible = false; continue; }
    _flashPool[i].scale.setScalar(0.62 + k * 0.55);
    _flashPool[i].material.opacity = 0.55 * (1 - k);
    // ★ 面片永远朝相机（不然侧着看是一条线 ✓）
    _flashPool[i].quaternion.copy(cam.quaternion);
  }
}

/* ★ round316：沼泽涟漪（走在污水里溅一圈 ✗ 0.6 秒扩散消失 ✓）*/
var _ripplePool = [], _ripple = [];
function terRipple(wx, wz, wy) {
  if (!_ripplePool.length) {
    var rg = new THREE.RingGeometry(0.12, 0.20, 16);
    for (var i = 0; i < 8; i++) {
      var mm = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({
        color: 0xa8d8e0, transparent: true, opacity: 0, depthWrite: false,
        side: THREE.DoubleSide }));
      mm.rotation.x = -Math.PI / 2;
      mm.visible = false;
      mm.renderOrder = 5;
      scene.add(mm);
      _ripplePool.push(mm);
      _ripple.push({ on: 0, t: 0 });
    }
  }
  for (var j = 0; j < _ripple.length; j++) {
    if (_ripple[j].on) { continue; }
    var r = _ripple[j], m = _ripplePool[j];
    r.on = 1; r.t = 0;
    m.position.set(wx, wy + 0.02, wz);
    m.scale.setScalar(1);
    m.material.opacity = 0.55;
    m.visible = true;
    return;
  }
}
function rippleTick(dt) {
  for (var i = 0; i < _ripple.length; i++) {
    var r = _ripple[i];
    if (!r.on) { continue; }
    r.t += dt;
    var k = r.t / 0.6;
    if (k >= 1) { r.on = 0; _ripplePool[i].visible = false; continue; }
    _ripplePool[i].scale.setScalar(1 + k * 3.2);
    _ripplePool[i].material.opacity = 0.55 * (1 - k);
  }
}

/* 尘烟（独立小池子 ✗ 6 个就够 ✓）*/
var _dustPool = [], _dust = [];
function terDust(gx, gz, cy, col) {
  if (!_dustPool.length) {
    var dg = new THREE.PlaneGeometry(1, 1);
    for (var i = 0; i < 6; i++) {
      var mm = new THREE.Mesh(dg, new THREE.MeshBasicMaterial({
        color: 0xb9ab8e, transparent: true, opacity: 0, depthWrite: false }));
      mm.rotation.x = -Math.PI / 2;
      mm.visible = false;
      mm.renderOrder = 4;
      scene.add(mm);
      _dustPool.push(mm);
      _dust.push({ on: 0, t: 0, life: 0.5 });
    }
  }
  for (var j = 0; j < _dust.length; j++) {
    if (_dust[j].on) { continue; }
    var dd = _dust[j], m = _dustPool[j];
    dd.on = 1; dd.t = 0;
    m.position.set((gx + 0.5) * TER.LEVEL_H, cy + 0.12, (gz + 0.5) * TER.LEVEL_H);
    m.scale.setScalar(TER.LEVEL_H * 0.8);
    m.material.color.setRGB(Math.min(1, col[0] + 0.35), Math.min(1, col[1] + 0.33),
                            Math.min(1, col[2] + 0.30));
    m.material.opacity = 0.55;
    m.visible = true;
    return;
  }
}

/* 每帧推进碎块 + 尘烟（★ 只在有活的时才跑 ✓ 平时零开销 ✓）*/
function terDebTick(dt) {
  for (var i = 0; i < _deb.length; i++) {
    var d = _deb[i];
    if (!d.on) { continue; }
    var m = _debPool[i];
    d.t += dt;
    if (d.landed) {
      d.fade += dt;
      if (d.fade > 0.5) {
        m.material.transparent = true;
        m.material.opacity = Math.max(0, 1 - (d.fade - 0.5) / 0.5);
      }
      if (d.fade > 1.0) { d.on = 0; m.visible = false; m.material.transparent = false; }
      continue;
    }
    d.vy -= 13 * dt;
    m.position.x += d.vx * dt;
    m.position.y += d.vy * dt;
    m.position.z += d.vz * dt;
    m.rotation.x += dt * 7;
    m.rotation.z += dt * 5;
    if (m.position.y <= d.gnd) {
      m.position.y = d.gnd;
      if (Math.abs(d.vy) > 1.1) {
        d.vy = -d.vy * 0.32;
        d.vx *= 0.45; d.vz *= 0.45;
      } else {
        d.vy = 0; d.vx = 0; d.vz = 0;
        d.landed = 1; d.fade = 0;
      }
    }
    if (d.t > d.life) { d.on = 0; m.visible = false; }
  }
  for (var j = 0; j < _dust.length; j++) {
    var dd = _dust[j];
    if (!dd.on) { continue; }
    dd.t += dt;
    var k = dd.t / dd.life;
    if (k >= 1) { dd.on = 0; _dustPool[j].visible = false; continue; }
    var mm = _dustPool[j];
    mm.scale.setScalar(TER.LEVEL_H * (0.8 + k * 1.5));
    mm.material.opacity = 0.55 * (1 - k);
  }
}

/* ★ 收到服务端的破坏广播：改覆盖 + 清缓存 + 只重建受影响的瓦片 ✓
   ★ 为什么不全部重建：一片 16×16 格 ✗ 全重建要 20ms ✓ 只重建 1~4 片 ✓ */
/* ★★★ round338：树倒地动画（用户要求）
   ★ 难点：树的 mesh 是按材质【合并成一块】的 ✗ 没有单独对象可以旋转 ✓
   ★ 做法（不改合并结构 ✗ 不动平常的 draw call）：
       砍倒时 → 临时造一个【独立树模型】放在原位
              → 让它绕树根旋转倒地（0.75 秒）
              → 1.1 秒后移除
       同时整块重建 ✗ 原来的那棵树就消失了 ✓
   ★ 为什么绕树根：几何体是按【世界坐标】建出来的 ✗
     所以要把顶点平移成"以树根为原点"✗ 再把整个组摆到树根 ✓（见 geo.translate）*/
var _falling = [], _fallMax = 6;
/* ★ 造一件物件的独立模型（倒地动画 / 命中闪白 共用 ✓）
   ★ 顶点按世界坐标建 ✗ 所以要平移到"以物件中心为原点"✗ 再把组摆回原位 ✓ */
function buildPropSolid(kind, gx, gz, partFilter) {
  try {
    var parts = (PROP_PARTS && PROP_PARTS[kind]) || (PROP_PARTS && PROP_PARTS.tree);
    if (!parts || !parts.length) { return null; }
    if (partFilter) { parts = parts.filter(partFilter); }
    if (!parts.length) { return null; }
    var s2 = G.PROP_SCALE;
    var hh2 = ((gx * 2654435761) ^ (gz * 40503)) & 0xffffffff;
    var q2 = Math.abs(hh2 % 1000);
    var rot = ((q2 >> 3) % 4) * Math.PI / 2, cs = Math.cos(rot), sn = Math.sin(rot);
    var wx2 = worldX(gx), wz2 = worldZ(gz);
    var baseY = terYAt(wx2, wz2);
    var acc = {}, mk;
    for (var pi = 0; pi < parts.length; pi++) {
      var p = parts[pi];
      var ox = (p[4] * cs - p[6] * sn) * s2, oz = (p[4] * sn + p[6] * cs) * s2, oy = p[5] * s2;
      var gg = boxGeoAt(p[0] * s2, p[1] * s2, p[2] * s2,
                        wx2 + ox, baseY + oy, wz2 + oz, rot).toNonIndexed();
      if (!acc[p[3]]) { acc[p[3]] = []; }
      acc[p[3]].push(gg);
    }
    var grp = new THREE.Group();
    grp.position.set(wx2, baseY, wz2);
    for (mk in acc) {
      var geo = mergeGeos(acc[mk]);
      geo.translate(-wx2, -baseY, -wz2);
      var mm = new THREE.Mesh(geo, M[mk] || M.dirt);
      mm.castShadow = true;
      grp.add(mm);
      for (var di = 0; di < acc[mk].length; di++) { acc[mk][di].dispose(); }
    }
    return grp;
  } catch (e) { return null; }
}

function _pushFall(grp, gx, gz, dir, axis, delay) {
  scene.add(grp);
  if (_falling.length >= _fallMax) {
    var old0 = _falling.shift();
    scene.remove(old0.g);
    old0.g.traverse(function (o) { if (o.geometry) { o.geometry.dispose(); } });
  }
  _falling.push({ g: grp, t: -(delay || 0), life: 1.15 + (delay || 0),
                  dir: dir, axis: axis });
}

function propFallAnim(kind, gx, gz) {
  try {
    /* ★★★ round346（用户："这个断墙，动画从中间断开，分别倒下"）★★★
       断墙本来就由【两段墙】拼的（PROP_PARTS.ruin 里有 ox=−1.8 那一段 ✓）
       → 按零件的位置拆成两半 ✗ 各倒各的 ✗ 还要错开 0.08 秒 ✓
       看着就是"从中间断裂、两截先后倒下去"✓ */
    if (kind === 'ruin') {
      var ha = buildPropSolid(kind, gx, gz, function (p) { return p[4] <= 0; });
      var hb = buildPropSolid(kind, gx, gz, function (p) { return p[4] > 0; });
      var d0 = ((gx * 7 + gz * 13) % 2) ? 1 : -1;
      if (ha) { _pushFall(ha, gx, gz, d0, 'z', 0); }
      if (hb) { _pushFall(hb, gx, gz, -d0, 'x', 0.08); }
      return;
    }
    var grp = buildPropSolid(kind, gx, gz);
    if (!grp) { return; }
    _pushFall(grp, gx, gz,
              ((gx * 7 + gz * 13) % 2) ? 1 : -1,
              ((gx * 3 + gz * 5) % 2) ? 'x' : 'z', 0);
  } catch (e) { /* 动画失败不能影响砍树本身 ✓ */ }
}

/* 每帧推进倒地（★ 只在有树在倒时才跑 ✓）*/
function propFallTick(dt) {
  if (!_falling.length) { return; }
  for (var i = _falling.length - 1; i >= 0; i--) {
    var f = _falling[i];
    f.t += dt;
    var k = Math.min(1, f.t / 0.75);
    var e = 1 - Math.pow(1 - k, 3);           // ★ 先快后慢（像真的倒下去 ✓）
    var ang = e * 1.45 * f.dir;               // 1.45 rad ≈ 83°
    if (f.axis === 'x') { f.g.rotation.x = ang; } else { f.g.rotation.z = ang; }
    if (f.t > f.life) {
      scene.remove(f.g);
      f.g.traverse(function (o) { if (o.geometry) { o.geometry.dispose(); } });
      _falling.splice(i, 1);
    }
  }
}

/* ★ round348：外卖僵尸开始逃跑 → 播逃跑音效（按 mob id 分频道 ✓）*/
function fleePlay(mid) {
  if (typeof sfx !== 'function') { return; }
  sfx('flee', 0.95, 'flee_' + mid);
}

/* ★ round329：服务端说"这几棵树没了" → 记下来 + 重建那一片 ✓ */
function propApplyEdits(cells) {
  if (!cells || !cells.length) { return; }
  var dirty = {};
  for (var i = 0; i < cells.length; i++) {
    var gx = cells[i][0], gz = cells[i][1], dead = cells[i][2];
    var k = gx + ',' + gz;
    if (dead) {
      propDead[k] = 1;
      delete propDmg[k];
      // ★ 先让【独立模型】倒下去 ✗ 再重建块（把原来的挪走）✓
      var _fk2 = cells[i][5] || propAt[k] || '';   // ★ 优先用服务端给的种类 ✓
      /* ★ round345（用户："这个也做一下倒下的动画" —— 指断墙 ruin）
         ★ 断墙是立着的砖结构 ✗ 倒下去很自然 ✓
         ★ 房子仍然是"碎掉"✗ 一整栋楼倒下来反而怪 ✓（要的话说一声 ✓）*/
      if (_fk2.indexOf('tree') === 0 || _fk2 === 'dead' || _fk2.indexOf('fence') === 0 ||
          _fk2 === 'ruin') {
        propFallAnim(_fk2, gx, gz);
      }
      // ★ 木屑/石屑（复用破坏的碎块 ✓ 换成木头色 ✓）
      terDebris(gx, gz, 'dirt', terH(gx, gz));
      if (typeof sfx === 'function') {
        var _d2 = Math.pow(gx * TER.LEVEL_H - P.x, 2) + Math.pow(gz * TER.LEVEL_H - P.z, 2);
        var _dv = 1 - Math.min(1, _d2 / (30 * 30));
        if (_dv > 0.05) { sfx('break', 0.8 * _dv); }
      }
      // ★ 找到这一格属于哪个块 ✗ 整块重建（块只有 32 格 ✗ 重建很快 ✓）
      var ci = Math.floor(gx / PROP_CHUNK), cj = Math.floor(gz / PROP_CHUNK);
      dirty[ci + ',' + cj] = 1;
    } else {
      propDmg[k] = cells[i][3] | 0;
    }
  }
  for (var key in dirty) {
    if (!_chunkMesh[key]) { continue; }
    dropChunk(key);
    buildChunk(parseInt(key.split(',')[0], 10), parseInt(key.split(',')[1], 10));
  }
  /* ★★★ round343 修的真 bug（用户："被破坏的树和石头，碰撞箱没有移除"）★★★
     根因：碰撞用的是 propSolids ✗ 而它只在【玩家跨区块】时重建 ✓
           砍树走的是"重建某一块" ✗ 没同步这个数组 ✓
           → 树没了、碰撞还在 ✓
     修：重建区块之后，立刻把 propSolids 从 _chunkSolid 重算一遍 ✓ */
  if (_dirtyCount(dirty)) {
    refreshPropSolids();
  }
}

/* 从 _chunkSolid 重算碰撞数组（砍掉物件之后必须调 ✓）*/
function refreshPropSolids() {
  propSolids = [];
  for (var k in _chunkSolid) { propSolids = propSolids.concat(_chunkSolid[k]); }
  PROP_MESHES = [];
  for (var k2 in _chunkMesh) { PROP_MESHES = PROP_MESHES.concat(_chunkMesh[k2]); }
}
function _dirtyCount(o) { for (var k in o) { return 1; } return 0; }

/* ★ F1：服务端说"这些格子的水变了" → 改覆盖 + 重建那几片 ✓ */
function fluApplyEdits(cells) {
  if (!cells || !cells.length) { return; }
  var dirty = {};
  for (var i = 0; i < cells.length; i++) {
    var gx = cells[i][0], gz = cells[i][1], kind = cells[i][2], lv = cells[i][3];
    var k = _terKey(gx, gz);
    if (lv < 0 || !kind) { delete fluidOv[k]; }
    else { fluidOv[k] = [kind, lv]; }
    var ti = Math.floor(gx / TER.TILE), tj = Math.floor(gz / TER.TILE);
    dirty[ti + ',' + tj] = 1;
  }
  for (var key in dirty) {
    if (!_terTiles[key]) { continue; }
    scene.remove(_terTiles[key]);
    if (_terTiles[key]._fluid) {
      scene.remove(_terTiles[key]._fluid);
      if (_terTiles[key]._fluid.geometry) { _terTiles[key]._fluid.geometry.dispose(); }
    }
    if (_terTiles[key].geometry) { _terTiles[key].geometry.dispose(); }
    delete _terTiles[key];
    _terTileN--;
  }
}

function terApplyEdits(cells) {
  if (!cells || !cells.length) { return; }
  var dirty = {};
  var needRebuild = false;
  for (var i = 0; i < cells.length; i++) {
    var gx = cells[i][0], gz = cells[i][1], nh = cells[i][2];
    var k = _terKey(gx, gz);
    // ★ cells[i][2] === null → 这是"打了一半"的裂纹进度 ✗ 不用重建地形 ✓
    if (nh === null || nh === undefined) {
      terCrack(gx, gz, cells[i][3] | 0, cells[i][4] | 0);
      continue;
    }
    needRebuild = true;
    var mat = terMat(gx, gz);
    if (nh === -999) {
      delete terOver[k]; delete terDmg[k];
    } else {
      // ★ 破坏成功：先炸碎块 ✗ 再改覆盖 ✓（顺序反了就取不到"碎之前"的高度了）
      terDebris(gx, gz, mat, terH(gx, gz));
      /* ★ round319（用户："音效应该遵守距离规则"）：按距离衰减 ✓
         25 格内正常 ✗ 40 格外听不到 ✓（和画面的雾差不多远近 ✓）*/
      if (typeof sfx === 'function') {
        var _d2 = Math.pow((gx + 0.5) * TER.LEVEL_H - P.x, 2)
                + Math.pow((gz + 0.5) * TER.LEVEL_H - P.z, 2);
        var _dv = 1 - Math.min(1, _d2 / (30 * 30));
        if (_dv > 0.05) { sfx('break', 0.95 * _dv); }
      }
      terOver[k] = nh; delete terDmg[k];
      // 把这格的裂纹收掉（已经碎了 ✗ 留着就穿帮 ✓）
      for (var ci = 0; ci < _crackPool.length; ci++) {
        if (_crackPool[ci].visible && _crackPool[ci]._k === k) { _crackPool[ci].visible = false; }
      }
    }
    var ti = Math.floor(gx / TER.TILE), tj = Math.floor(gz / TER.TILE);
    // 相邻瓦片也要重建（边上的格子会影响邻居的侧面 ✓）
    for (var di = -1; di <= 1; di++) {
      for (var dj = -1; dj <= 1; dj++) { dirty[(ti + di) + ',' + (tj + dj)] = 1; }
    }
  }
  if (!needRebuild) { return; }
  terHClear();
  for (var key in dirty) {
    if (!_terTiles[key]) { continue; }
    scene.remove(_terTiles[key]);
    if (_terTiles[key]._fluid) {
      scene.remove(_terTiles[key]._fluid);
      if (_terTiles[key]._fluid.geometry) { _terTiles[key]._fluid.geometry.dispose(); }
    }
    if (_terTiles[key].geometry) { _terTiles[key].geometry.dispose(); }
    delete _terTiles[key];
    _terTileN--;
  }
}

/* 世界坐标 → 地面 Y */
function terYAt(wx, wz) {
  return terH(Math.floor(wx / TER.LEVEL_H), Math.floor(wz / TER.LEVEL_H)) * TER.LEVEL_H;
}

/* ★ 2026-10-22：脚下"支撑面" = max(地形, 建筑室内地板)
   解决"走进屋里踩到地下"：屋里地板比地形高 0.28m，站上去要抬起来 */
function supportYAt(wx, wz) {
  var gy = terYAt(wx, wz);
  try {
    if (typeof townFloorAt === 'function') {
      var fy = townFloorAt(wx, wz);
      if (fy > gy + 0.01) { return fy; }
    }
  } catch (e) { }
  return gy;
}

/* ★ 第 307 轮（用户："画面有点暗"）：整体提亮约 35%
   ★ 为什么是"顶点色提亮"而不是"调环境光"：
     地形用的是 MeshBasicMaterial（不吃光照 ✓）✗ 调灯没用 ✓
     只能从顶点色走 ✓（这样也最省 ✓ 手机上零额外开销 ✓）*/
var TER_COL = {
  grass: [0.60, 0.68, 0.37],
  dirt:  [0.65, 0.49, 0.31],
  stone: [0.70, 0.69, 0.65],
  /* ★ 冰面 = MC 的【蓝冰】（用户 2026-10-18 第二次改：雪白 → 冰蓝）
     ★★ 换算：地形是【贴图 × 顶点色】✗ 泥土贴图约 (0.55,0.50,0.45) 偏褐 ✓
        目标色（MC 蓝冰 #74A8F7 ≈ 0.46,0.66,0.97）÷ 贴图 ≈ (0.83,1.32,2.15)
        ★ 红通道还要再压低（贴图红多 ✗ 不压就发灰紫 ✓）
        → 最终 (0.62,1.30,2.10) ✗ 出来是那种"透亮的冰蓝"✓ */
  ice:   [0.62, 1.30, 2.10],
  swamp: [0.42, 0.48, 0.31],
  brick: [0.70, 0.42, 0.31]
};

/* E 已搬到 platform/web.js */

UI.onError(function (msg) { E('出错：' + msg); });

function markHouseCells(gx, gz) { for (var a = -7; a <= 7; a++) { for (var b = -7; b <= 7; b++) { occupied[(gx + a) + ',' + (gz + b)] = 1; } } }
function isHouseCell(gx, gz) { return occupied[gx + ',' + gz] === 1; }
function markTreeCells(gx, gz) { for (var a = -3; a <= 3; a++) { for (var b = -3; b <= 3; b++) { occupied[(gx + a) + ',' + (gz + b)] = 1; } } }

/* ===== ★ 音效配置（必须在 init 调用之前 ✓ 否则 0/0 ✗）===== */
var SFX_ON = true, SFX_VOL = 0.45;
/* 音量从 SETCFG 读取（若有保存 ✓ 在 init 之后生效 ✓）*/
var SFX_BANK = {};             // { key: [Audio,...] }
var SFX_LOADED = 0, SFX_TOTAL = 0;
var _lastSfx = {};

/* 音效清单（key → 文件列表 ✓ 都从 MC 客户端 assets 提取 ✓）*/
var SFX_FILES = {
  bite: ['bite1.mp3', 'bite2.mp3', 'bite3.mp3'],
  crit: ['crit1.mp3', 'crit2.mp3', 'crit3.mp3'],
  groan: ['groan1.mp3', 'groan2.mp3', 'groan3.mp3'],
  hit: ['hit1.mp3', 'hit2.mp3', 'hit3.mp3', 'hit4.mp3', 'hit5.mp3'],
  step: ['step1.mp3', 'step2.mp3', 'step3.mp3', 'step4.mp3'],
  strong: ['strong1.mp3', 'strong2.mp3', 'strong3.mp3', 'strong4.mp3'],
  swing: ['swing1.mp3', 'swing2.mp3', 'swing3.mp3', 'swing4.mp3', 'swing5.mp3', 'swing6.mp3'],
  zdeath: ['zdeath1.mp3'],
  /* ★ round313：破坏方块（用户提供 ✗ 立体声转成单声道 ✓ 136KB → 68KB）*/
  break: ['break1.mp3'],
  /* ★ round314：落地（用户提供 ✗ 立体声转单声道 ✓）*/
  land: ['land1.mp3'],
  /* ★ round348：外卖僵尸逃跑（用户提供 ✗ 立体声 44.1k 压成单声道 22.05k ✓ 204KB→51KB）*/
  flee: ['flee1.mp3'],
  zhurt: ['zhurt1.mp3', 'zhurt2.mp3'],
  /* ★ round447（用户提供的雷声 ✗ 压成 48kbps 单声道 22.05k）*/
  thunder: ['thunder1.mp3'],
};
var SFX_FILES_OGG = {
  bite: ['bite1.ogg', 'bite2.ogg', 'bite3.ogg'],
  crit: ['crit1.ogg', 'crit2.ogg', 'crit3.ogg'],
  groan: ['groan1.ogg', 'groan2.ogg', 'groan3.ogg'],
  hit: ['hit1.ogg', 'hit2.ogg', 'hit3.ogg', 'hit4.ogg', 'hit5.ogg'],
  step: ['step1.ogg', 'step2.ogg', 'step3.ogg', 'step4.ogg'],
  strong: ['strong1.ogg', 'strong2.ogg', 'strong3.ogg', 'strong4.ogg'],
  swing: ['swing1.ogg', 'swing2.ogg', 'swing3.ogg', 'swing4.ogg', 'swing5.ogg', 'swing6.ogg'],
  zdeath: ['zdeath1.ogg'],
  /* ★ round313：破坏方块（用户提供 ✗ 立体声转成单声道 ✓ 136KB → 68KB）*/
  break: ['break1.ogg'],
  /* ★ round314：落地（用户提供 ✗ 立体声转单声道 ✓）*/
  land: ['land1.ogg'],
  /* ★ round348：外卖僵尸逃跑（用户提供 ✗ 立体声 44.1k 压成单声道 22.05k ✓ 204KB→51KB）*/
  flee: ['flee1.ogg'],
  zhurt: ['zhurt1.ogg', 'zhurt2.ogg'],
};
var SFX_FILES_WAV = {
  bite: ['bite1.wav', 'bite2.wav', 'bite3.wav'],
  crit: ['crit1.wav', 'crit2.wav', 'crit3.wav'],
  groan: ['groan1.wav', 'groan2.wav', 'groan3.wav'],
  hit: ['hit1.wav', 'hit2.wav', 'hit3.wav', 'hit4.wav', 'hit5.wav'],
  step: ['step1.wav', 'step2.wav', 'step3.wav', 'step4.wav'],
  strong: ['strong1.wav', 'strong2.wav', 'strong3.wav', 'strong4.wav'],
  swing: ['swing1.wav', 'swing2.wav', 'swing3.wav', 'swing4.wav', 'swing5.wav', 'swing6.wav'],
  zdeath: ['zdeath1.wav'],
  /* ★ round313：破坏方块（用户提供 ✗ 立体声转成单声道 ✓ 136KB → 68KB）*/
  break: ['break1.wav'],
  /* ★ round314：落地（用户提供 ✗ 立体声转单声道 ✓）*/
  land: ['land1.wav'],
  /* ★ round348：外卖僵尸逃跑（用户提供 ✗ 立体声 44.1k 压成单声道 22.05k ✓ 204KB→51KB）*/
  flee: ['flee1.wav'],
  zhurt: ['zhurt1.wav', 'zhurt2.wav'],
  /* ★ round447（用户："把音频换成我这个并且压缩一下"）：用户提供的雷声
     ★ 源文件：立体声 44.1k 1.18s 204KB → tools/conv_thunder.py 压成
       单声道 22.05k：mp3 7.3KB（优先）/ wav 51KB（兜底）✓ */
  thunder: ['thunder1.wav'],
};

/* ★★★ round443：启动时只立即加载这些音效（战斗中马上要用的 ✓）
   其余的等进世界后在后台慢慢加载 ✗ 不抢首屏带宽 ✓
   实测：全部 35 个 1935KB → 核心 8 个约 450KB（省下 1.5MB）*/
/* ★ round446：thunder 必须在核心集里 ✗✗
   不然第一次突破时它还在"待加载" → sfx() 直接 return（不出声）✗
   等它加载完，特效早就放完了 → "两个玩家都没听到雷声" ✓✓ */
var SFX_CORE = ['swing', 'hit', 'crit', 'thunder', 'strong'];
/* ★ round445：这几个只有 wav（没 ogg/mp3）✗ 直接拉 wav ✓
   不然要先试两个不存在的格式 → 404 垃圾请求 + 控制台报错 ✗*/
var SFX_WAV_ONLY = ['break', 'land', 'flee'];
/* ★ round447：这些优先 mp3（没有 ogg 版，直接拉 mp3 就别去碰 404 了 ✓）*/
var SFX_MP3_ONLY = ['thunder'];

/* ===== ★ 多人联网配置（必须在 init 调用之前 ✓ 否则 NET undefined ✗）===== */
/* ★ 第 71 轮：箭速（必须和 server/world.py 的 ARROW_SPEED 一致 ✓）*/
var ARROW_SPEED = 14.0;

/* ★★★ round286（审查报告 §1.9-③ "治根"）：上报时间戳要【跨刷新单调】★★★
   病根：现在上报的 t = performance.now()/1000 是【页面加载起的秒数】✗
     → 谁按一次 F5 ✗ 他的时间戳就从几千秒掉回 0 ✓
     → 所有还在看他的客户端都被这个"倒退的基准"毒化 ✓（→ 飞快/冻住 ✓）
   ★ 修：在 performance.now() 上加一个【跨刷新不变的基准】✗
     基准由 platform 层算并写进这个变量 ✓
     （core 不许碰 sessionStorage ✗ 分层铁律 ✓ 所以这里只声明 ✗ 不初始化 ✓）
   ★ 效果：刷新页面时间戳【继续往上走】✗ 再也不倒退 ✓ 污染从根上消失 ✓✓ */
var NET_TIME_BASE = 0;

var NET = {  on: false, token: '', lastPost: 0, lastGet: 0,
  arrows: {},               // ★ 第 69 轮：在飞的箭（id → mesh ✓）
  rate: 0.0333,              // ★ 30Hz（33ms 一包 ✓）
  /* ★★ 自适应抖动缓冲（借用实时音视频的做法）★★
     固定延迟只有两个坏选择：调小了 → 网络一抖就得靠外推，画面打嗝 ✗
                             调大了 → 明明网很好却一直慢半拍 ✗
     所以让每个实体自己量："这些包平均迟到多少" → 网好就把延迟收到 ~38ms ✓
                                              网差就自己涨上去，宁可慢一点也不打嗝 ✓
     下限 rate×1.15（必须有下一个包可插值 ✓）  上限 250ms（再差也不至于没法玩 ✓） */
  minMul: 1.15,
  maxDelay: 0.25,
  jitRise: 0.25,             // 迟到量包络：涨得快（出事立刻防住 ✓）
  jitFall: 0.9965,           //                 落得慢（每包约 -0.35%/包 → 每秒约 -10% ✓）
  /* ★ 下面两个是 P0-9 实测调出来的（详见 netSample / netClkUpdate 里的注释） */
  delayFall: 0.02,           // 抖动缓冲"变小"时的收敛速度（变大是立刻的，不对称）
  rtCatch: 0.1,              // ★ 渲染时刻 rt 每帧最多比名义帧长多走/少走多少（单位：帧长的倍数）
                             /* 钟差/缓冲一变 rt 就会跳，位置跟着平移 v×Δdelay（看得见的一跳 ✗）
                                代价换算一下：0.1 ≈ rt 的播放速度最多偏离真实 ±10%
                                → 一帧最多偏 1.7ms ≈ 位置 5mm（看不出来），
                                  而一次 45ms 的缓冲调整约 0.45 秒补完（也没有感觉）✓
                                0.5 时一帧还能偏 8.3ms（位置 25mm）→ 抖动仍有 10% ✗ 所以收紧到 0.1
                                设 0 就等于关掉限速（回到以前"瞬时平移"的行为 ✗） */
  rtSnap: 0.35,              // ★ 偏差超过这么多秒【就不再限速、直接对齐】（单位：秒）
                             /* 限速只该管"几十毫秒的抖动"。钟差偶尔会被大幅重估
                                （新玩家第一包 ct=0、切后台、对方重登…），
                                差几十秒还按 10%/帧追 = 永远追不上 → 队友钉住不动 ✗
                                超阈值就直接贴上去：会跳一下，但比一直不动强 ✓ */
  extrapMax: 12,             // 越界外推最多几段（12 段 ≈ 0.4s ≈ 1.2m）—— 别夹太小
  jitGain: 1.15,             // 迟到量放多少进延迟（留一点余量 ✓）
  clkDrift: 1e-4,            // ★ 时钟漂移跟踪速率
                             /* 这个值必须【极小】✗ 不能用 1.5% 这种：
                                1.5%/包 跟的其实是"网络平均延迟"而不是"时钟漂移" →
                                基准线被抬到平均延迟上 ✗ 于是"迟到量"只剩毛刺、缓冲算小了 →
                                一遇到最坏的那包就耗干 → 外推 → 卡一下 ✗
                                真实晶振漂移只有 ~10-100ppm（0.001~0.01%/秒）→ 1e-4/包 足够跟 ✓ */
  clkWarm: 45,               // ★ 热身包数（1.5 秒 @30Hz）：这段内取最小延迟当基准 ✓
                             /* 之后【不再往下改基准】✗ 这点很关键：
                                均匀抖动下"最小值"会一直慢慢刷新 → 每刷一次
                                渲染时刻就往前跳一下 → 又是一次能看见的顿挫 ✗
                                锁住基准后，基准只会随漂移极慢地往上走 ✓
                                （万一天迟到量比基准还小，那也只是"缓冲多留了" ✓ 安全方向 ✓） */
  range: 60,
  others: {},                // {uid: {hh, ui, name, realm, buf, cur, walkT, last}}
  rmobs: {},                 // {mid: {...}}  ★ 世界妖兽（公共的 ✓ 服务器权威 ✓ 不分你我 ✓）
  rloot: {},                 // {lid: {...}}  ★ 地上掉的（P2 第二刀，服务器权威 ✓）
  myName: '', myRealm: '',
  pid: '',                   // ★ 单人模式本地妖兽 id 前缀（每次开页面随机一次 ✓）
  mobSeq: 0,
  bufMax: 16,                // 每个实体最多留几包（插值用 ✓）
  propsSent: false,          // ★ 静态碰撞只上传一次 ✓
  fail: 0,                   // ★ 连续失败次数（够了就切回单机 ✓）
  busy: false, busyAt: 0,    // ★ 上一发同步还没回来（不堆积请求 ✓ 抖动更小 ✓）
  srv: null,                 // ★ 服务器钟对齐 + 抖动缓冲状态（妖兽插值用 ✓）
  sndId: 0,                  // ★ 声音事件游标（只要比我这个新的 ✓）
  sndRange: 30,              // ★ 30 米外听不到（每 2 米一档衰减）
  atkSeq: 0,                 // ★ 挥剑序号（本地每砍一下 +1 → 上报 → 别人看到你抬剑下砍 ✓）
  pvp: false,                // ★ 玩家互相伤害开关（服务器给的状态 ✓ 全服统一 ✓）
  myTeam: 0                  // ★ 我的队伍号（P4 组队上线后由服务器下发 ✓
                             //   现在恒为 0 —— markColor() 靠它给队友换箭头颜色，见那里注释）
};
NET.pid = 'p' + Math.random().toString(36).slice(2, 8);

/* ★★ 启动调用【必须放在整个文件最后】★★（见文件末尾）

   踩过的大坑（P0-8 拆分 core/platform 时留下的，第 26 轮才发现）：
   原来这行写在 NET 对象后面，而 init() 要用到的顶层 var 有一大半声明在它【后面】——
     WSC(968) / PROTO_VER(966) / _toastEl(943) / SGrid(529) / SFX_QUEUE(693) / _ov3(1439) …
   `var` 只提升【声明】不提升【赋值】，所以 init() 跑到 netInit() 时 WSC 还是 undefined
   → `WSC.token = tk` 抛 "Cannot set properties of undefined (setting 'token')" ✗
   页面只显示一句"启动失败"，看起来像网络问题，其实一行代码都没连出去。
   当时 P0-8 只跑了 grep 闸门和 Node 测试，没人真正用浏览器打开过，所以一直没暴露。

   规矩（比"逐个把变量提前"稳）：**启动调用永远留在文件末尾** ✓
   以后往中间加多少个顶层 var 都不会再踩这个坑。 */

/* ============ 初始化 ============ */
function init() {
  API = '';   // 独立版：所有请求都走同源（登录/注册 + /ws-config.js），不再跨机连后端 ✓
  scene = new THREE.Scene();
  /* ★★ 末日美术（第 30 轮）★★
     不换素材，靠【天光 + 雾 + 材质调色 + 地面配色】把 MC 风的鲜亮画面压成废土感：
       · 天/雾：鲜蓝 → 灰黄雾霾；雾拉近（45~175）→ 远处糊进霾里，也顺手盖住地块边缘 ✓
       · 光：天光发灰、压暗；太阳低而脏（暖橙、强度调低）→ 没有蓝天白云那种通透感 ✓ */
  scene.background = new THREE.Color(0x9c917c);
  scene.fog = new THREE.Fog(0x9c917c, 45, 175);
  cam = new THREE.PerspectiveCamera(CAM_FOV_BASE, innerWidth / innerHeight, 0.1, 400);
  scene.add(cam);   // 第一人称手/武器挂在相机上，必须让相机进场景才会被渲染
  rd = new THREE.WebGLRenderer({ canvas: UI.mainCanvas(), antialias: (AA_MODE === 'msaa') });
  rd.setPixelRatio(Math.min(DPR, devicePixelRatio || 1));
  rd.setSize(innerWidth, innerHeight);
  rd.shadowMap.enabled = true;
  rd.shadowMap.type = THREE.PCFSoftShadowMap;
/* ★ 第 44 轮：阴影贴图不再每帧重算，改成【隔帧更新】（在 frame() 里触发）——
   实测阴影占渲染的 25% ✓ 这条直接省掉一半 ✓
   画质：这么大的方块影子，更新率从 60Hz 变 30Hz，肉眼分不出来 ✓ */
rd.shadowMap.autoUpdate = false;
initGlowLights();          // ★ 第 45 轮：2 盏发光灯在启动时就建好（后加会触发着色器重编译 ✗）
  scene.add(new THREE.HemisphereLight(0xb8b0a0, 0x33302b, 0.55));   // 天光发灰 · 地面反光压暗
  sun = new THREE.DirectionalLight(0xf5c98a, 0.72);                 // 低垂的脏太阳（暖橙但发闷）
  sun.position.set(38, 70, 26);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  /* ★★ round426：阴影相机跟着"可见范围"收（纯画质提升 ✓ 不降画质 ✓）
     ★ 原来是写死 ±45 —— 对"低/中"细节档来说太大 ✗
       阴影图 2048² 摊在 90 米上 = 4.4cm/texel（很糊 ✓）
       收到 ±20（低档）= 2.0cm/texel；±34（中档）= 3.3cm/texel ✓
     ★ 高档保持 ±45（可见 40 米，斜着算下来 ~56 米，不能更小 ✗）
     ★ 代价：零（同一张图，只是投影范围变了 ✓） */
  sun.shadow.camera.left = -45; sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 220;
  sun.shadow.bias = -0.0007;
  applyShadowExtent();
  scene.add(sun);

  /* ★ 血条一开始就要显示（第 37 轮，用户问"为什么挨打才显示血量"）——
     原来 updHP() 只在【受伤 / 死亡 / 复活】里被调，进游戏时压根没人调过 ✗
     所以血条一直停在初始的 "— / —"，挨了第一下才第一次刷出来 ✗ 现在开局就刷一次 ✓ */
  updHP();
  /* ★ 经验条同理（第 38 轮）：开局就该看到"经验 0 / 103" ✓ */
  updExp();

  var mgr = new THREE.LoadingManager(function () { loadedOk = true; });
  mgr.onError = function () { loadedOk = true; };
  function L(p) {
    var t = new THREE.TextureLoader(mgr).load('/assets/3d/' + p);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  T = { grass: L('grass_top.png'), dirt: L('dirt.png'), stone: L('stone.png'), log: L('log.png'),
        plank: L('plank.png'), leaf: L('leaf.png'), water: L('water.png'), brick: L('brick.png') };
  /* ★ 枯叶贴图（现画，不用素材 ✓）
     为什么不能只靠 TINT：材质色是【乘】在贴图上的，**只能压暗、不能加红** ——
     树叶贴图本身接近纯绿（红蓝通道≈0），乘什么色都还是绿的 ✗
     所以干脆拿 canvas 画一张棕灰斑驳的枯叶，树冠直接用它 ✓
     ★ 用【固定种子】的伪随机（不是 Math.random）→ 两个客户端画出来一模一样 ✓ */
  var _lseed = 20261014;
  function lrnd() { _lseed = (_lseed * 1103515245 + 12345) & 0x7fffffff; return _lseed / 0x7fffffff; }
  var cvL = UI.offscreen(64, 64);
  var gl = cvL.getContext('2d');
  gl.fillStyle = '#6b5f45'; gl.fillRect(0, 0, 64, 64);
  for (var li = 0; li < 110; li++) {
    var lt = lrnd();
    gl.fillStyle = (lt < 0.34) ? '#7d7050' : ((lt < 0.67) ? '#574f3e' : '#8a7a56');
    gl.fillRect(lrnd() * 64, lrnd() * 64, 3 + lrnd() * 7, 3 + lrnd() * 7);
  }
  var texDead = new THREE.CanvasTexture(cvL);
  texDead.wrapS = THREE.RepeatWrapping; texDead.wrapT = THREE.RepeatWrapping;
  texDead.magFilter = THREE.LinearFilter; texDead.minFilter = THREE.LinearMipmapLinearFilter;
  T.deadleaf = texDead;

  /* ★ 末日调色：其余贴图还是原来那套（以后换原创素材时这张表直接删掉即可），
     每个材质乘一层色 → 绿草变枯草、鲜木变朽木、砖墙变灰混凝土 ✓
     （MeshLambertMaterial 的 color 是【乘】在贴图上的 ✓ 不用改图）*/
  var TINT = {
    grass: 0x8f8a62,   // 草 → 枯黄
    dirt: 0x8a7a66,    // 土 → 干褐
    stone: 0x8e8e8c,   // 石 → 冷灰
    log: 0x6e5f4c,     // 树干 → 朽木
    plank: 0x7d6f5c,   // 木板 → 旧木
    leaf: 0x8a8258,    // （只剩调试用；树冠已经改用 deadleaf ✓）
    water: 0x51625a,   // 水 → 死水
    brick: 0x8f8a84,   // 砖 → 灰混凝土
    deadleaf: 0xffffff // 枯叶本身已经是枯色，不用再乘 ✓
  };
  for (var k in T) { M[k] = new THREE.MeshLambertMaterial({ map: T[k], color: TINT[k] || 0xffffff }); }


  refreshGround();
  H = hero(MY_SKIN, MY_SKIN_CUSTOM); H.g.scale.set(heroScaleOf(heroVisualSize()), heroScaleOf(heroVisualSize()), heroScaleOf(heroVisualSize())); scene.add(H.g);
  H.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.62, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.26, depthWrite: false }));
  H.shadow.rotation.x = -Math.PI / 2;
  H.shadow.scale.setScalar(heroVisualSize());
  scene.add(H.shadow);

  /* 第一人称手/武器：挂在相机上的独立视图模型，不跟世界里的身体走 */
  FP = makeFPView();
  cam.add(FP.root);
  fpRefreshWeapon();

  for (var i = 0; i < G.MOB_COUNT; i++) {
    var m = mob(null);
    var ang = i / G.MOB_COUNT * Math.PI * 2;
    m.g.position.set(Math.cos(ang) * 10, 0, Math.sin(ang) * 10);
    m.g.scale.set(G.MOB_SCALE, G.MOB_SCALE, G.MOB_SCALE);
    m.hp = 30; m.cd = 1.5; m.alive = true; m.atkT = -1; m.dying = -1; m.dead = 0;
    m.kbT = 0; m.kbx = 0; m.kbz = 0; m.kbUp = 0;
    m.ready = -1;   // ★ 蓄势计时（-1=未蓄势 ✓ >=0 蓄势中 ✓）
    m.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.54, 14),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.24, depthWrite: false }));
    m.shadow.rotation.x = -Math.PI / 2; scene.add(m.shadow);
    m.ui = mkMobUI('僵尸', 30, 0.8);   // ★ 血条 + 名字 ✓
    scene.add(m.g); mobs.push(m);
  }
  /* ★ 压力测试模式：?stress=N 生成 N 只僵尸（?stress=N&grow=1 每秒再增 5 只 ✓）*/
  var stressMode = false, stressN = 0, stressGrow = false;
  var ms2 = /stress=(\d+)/.exec(QS);
  if (ms2) {
    stressMode = true;
    stressN = Math.min(G.MOB_MAX, parseInt(ms2[1], 10) || 50);   // ★ 受实体上限约束 ✓
    stressGrow = QS.indexOf('grow=1') >= 0;
    for (var si = 0; si < stressN; si++) {
      if (mobs.length >= G.MOB_MAX) { break; }                   // ★ 到上限就停 ✓
      var sm = mob(randomMobKind());
      var sang = Math.random() * Math.PI * 2;
      var sr = 6 + Math.random() * 22;
      sm.g.position.set(Math.cos(sang) * sr, 0, Math.sin(sang) * sr);
      sm.g.scale.set(G.MOB_SCALE, G.MOB_SCALE, G.MOB_SCALE);
      sm.hp = 30; sm.cd = 1.5; sm.alive = true; sm.atkT = -1; sm.dying = -1; sm.dead = 0;
      sm.kbT = 0; sm.kbx = 0; sm.kbz = 0; sm.kbUp = 0; sm.ready = -1;
      scene.add(sm.g); mobs.push(sm);
    }
  }
  var sp = findOpenSpot(TOWN_CX, TOWN_CZ + 7, G.BODY_W / 2, G.BODY_D / 2);
  P.x = sp[0]; P.z = sp[1];
  if (typeof SETCFG !== 'undefined' && SETCFG && typeof SETCFG.vol === 'number') { SFX_VOL = SETCFG.vol; }
  if (typeof SETCFG !== 'undefined' && SETCFG && SETCFG.sfx === false) { SFX_ON = false; }
  loadSfx();   // ★ 预加载 MC 原版音效（31 个 ✓ 优先 wav ✓）
  // ★ ?box=1 显示碰撞箱线框（调试用 ✓）
  if (QS.indexOf('box=1') >= 0) {
    var bgeo = new THREE.BoxGeometry(1, 0.1, 1);
    var bmat = new THREE.MeshBasicMaterial({ color: 0x00ff88, wireframe: true, transparent: true, opacity: 0.8 });
    H.boxDbg = new THREE.Mesh(bgeo, bmat);
    H.boxDbg.scale.set(G.BODY_W, 1, G.BODY_D);
    scene.add(H.boxDbg);
    for (var bi = 0; bi < mobs.length; bi++) {
      var bb = new THREE.Mesh(bgeo, bmat);
      bb.scale.set(G.MOB_W, 1, G.MOB_D);
      mobs[bi].boxDbg = bb; scene.add(bb);
    }
  }
  bindInput(); bindSet(); bindBag(); bindDead(); applySet(); loadProfile();
  // ★ 第 48 轮：bindBag() = 背包/装备那套（现在是菜单里的一个标签页 ✓ 快捷键 B）
  bindLogin();   // 登录浮层的按钮
  netInit();   // ★ 初始化联网（有 token 就直接连，没有就弹登录）✓
  /* ★ 手机测试用：?user=名字&pass=密码 → 自动登录（不用先去 2D 页面登录 ✓ 不给参数就完全不影响 ✓）*/
  var um = /[?&]user=([^&]+)/.exec(UI.search());
  var pm = /[?&]pass=([^&]+)/.exec(UI.search());
  if (um && pm) { autoLogin(decodeURIComponent(um[1]), decodeURIComponent(pm[1])); }
  refreshProps();
  netUploadProps();   // ★ 地图生成完了才上传静态碰撞（早传是空的 ✗ 那服务器那边妖兽就会穿树）
  if (stressGrow) {
    setInterval(function () {
      for (var gi = 0; gi < 5; gi++) {
        if (mobs.length >= G.MOB_MAX) { return; }               // ★ 到上限就不再生成 ✓
        var gm2 = mob(null);
        var gang = Math.random() * Math.PI * 2, gr = 8 + Math.random() * 26;
        gm2.g.position.set(Math.cos(gang) * gr, 0, Math.sin(gang) * gr);
        gm2.g.scale.set(G.MOB_SCALE, G.MOB_SCALE, G.MOB_SCALE);
        gm2.hp = 30; gm2.cd = 1.5; gm2.alive = true; gm2.atkT = -1; gm2.dying = -1; gm2.dead = 0;
        gm2.kbT = 0; gm2.kbx = 0; gm2.kbz = 0; gm2.kbUp = 0; gm2.ready = -1;
        scene.add(gm2.g); mobs.push(gm2);
      }
    }, 1000);
  }
  UI.raf(frame);
  UI.onResize(function () {
    cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
    rd.setSize(innerWidth, innerHeight);
  });
}

/* ============ 地面（单平面 + 混合地块贴图 ✓ 无限延伸 ✓）============ */
/* ============ 地面（跟着玩家走，但花纹是【世界固定】的 ✓）============
   ★ 第 29 轮改的（P1「无限区块地形」第一步）：
     原来函数第一行是 `if (GROUNDMESH) { return; }` —— 整个地面只在【世界原点】周围
     建一次（±26 块 ≈ ±520 单位），走远了就看见"世界的边"、脚下空了 ✗
   现在：
     · 顶点/颜色都按【绝对块号】算 → 花纹是世界固定的
       （同一块永远同一色 ✓ 走回头路一模一样 ✓ 两个客户端看到的也一样 ✓）
     · 网格跟着玩家重建，但走出 GROUND_STEP 块（160 单位）才重算一次 → 很省 ✓
     · 走多远都不会看到边界 ✓
   注意：材质/贴图只建一次并复用 —— 每次重建都 new 一个纹理会让 GPU 反复上传 ✗
        （旧的几何体必须 dispose，不然重建一次漏一份显存 ✗）*/
var _groundBX = 1e9, _groundBZ = 1e9;
var _groundMat = null;
var GROUND_BLOCK = 8;    // 每块 8×8 格（世界尺寸 = GRID_WORLD × 8 = 20 单位 ✓ 和原来一致）
var GROUND_R = 26;       // 覆盖 ±26 块（±520 单位 ✓ 远比雾的起点 90 远 ✓）
var GROUND_STEP = 8;     // 玩家走出 8 块（160 单位）才重建一次 ✓

function groundMaterial() {
  if (_groundMat) { return _groundMat; }
  /* ★ 地面测试模式（用不同参数直接看哪一环断 ✓）
     ?tex=0 纯色（基准）· ?tex=1 贴图不带顶点色 · ?tex=2 贴图带顶点色（正常）· ?tex=3 棋盘 */
  var QSTR = ('' + UI.search()).toLowerCase();
  var TM = 2;
  var mt = /tex=(\d)/.exec(QSTR);
  if (mt) { TM = parseInt(mt[1], 10); }
  var tex = null;
  if (TM === 3) {
    var cv2 = UI.offscreen(256, 256);
    var g2 = cv2.getContext('2d');
    for (var yy = 0; yy < 8; yy++) {
      for (var xx = 0; xx < 8; xx++) {
        g2.fillStyle = ((xx + yy) % 2 === 0) ? '#ff2020' : '#f0f0f0';
        g2.fillRect(xx * 32, yy * 32, 32, 32);
      }
    }
    tex = new THREE.CanvasTexture(cv2);
  } else if (TM !== 0) {
    tex = new THREE.TextureLoader().load('/assets/3d/ground_mix.png');
  }
  if (tex) {   // ★ 原来这里没有判断就直接 tex.wrapS = ... → ?tex=0 时 tex 是 null 会抛 ✗
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.anisotropy = 4;
  }
  var gmat = (TM === 0) ? new THREE.MeshBasicMaterial({ color: 0x8a6a48 })
                        : new THREE.MeshBasicMaterial({ map: tex, vertexColors: (TM === 2) });
  gmat.side = THREE.DoubleSide;   // ★ 双面渲染（双保险 ✓）
  _groundMat = gmat;
  return gmat;
}

function refreshGround() {
  buildSafeZone();   /* 第 173 轮：安全区地板（第一次刷新地面时建一次 ✓）*/
  var BLOCK = GROUND_BLOCK, R = GROUND_R;
  var W = G.GRID_WORLD * BLOCK;
  var bx = Math.round(P.x / W), bz = Math.round(P.z / W);
  // 没走远就什么都不做（每帧调也就两次四舍五入 + 比较 ✓）
  if (GROUNDMESH && Math.abs(bx - _groundBX) < GROUND_STEP && Math.abs(bz - _groundBZ) < GROUND_STEP) {
    return;
  }
  /* ① 贴图只负责"泥土质感"（不花 ✓）
     ② 地貌变化（草/土/石/路）靠【顶点色】→ 成片大色块 ✓ 自然 ✓
     ★ 用【绝对块号 bi/bj】算色 —— 所以换到哪儿重建，花纹都和世界对得上 ✓ */
  function tintAt(bx2, bz2) {
    var n = Math.sin(bx2 * 0.42 + 1.7) * Math.cos(bz2 * 0.37 - 0.6)
          + Math.sin((bx2 + bz2) * 0.21 + 2.3) * 0.8
          + Math.sin(bx2 * 0.13 - bz2 * 0.17) * 1.2;
    var road = Math.abs(bx2 - Math.sin(bz2 * 0.7) * 2.2);
    /* ★ 末日配色（第 30 轮）：整体压暗 + 去绿
       原来是"绿草地/鲜泥土"，现在是"枯草 / 干土 / 碎石 / 沥青路" ✓
       这几个数是【乘在贴图上】的，所以低于 1 就是压暗 ✓
       对比度故意留得比原来大一点 —— 不然四种地全是褐色，看着太糊 ✗ */
    if (road < 0.9) { return [0.58, 0.57, 0.55]; }      // 压实的土路 / 沥青（发灰、明显偏暗）
    if (n > 0.95) { return [0.64, 0.65, 0.67]; }        // 碎石地（冷灰，和褐色区分得开）
    if (n > 0.05) { return [0.72, 0.71, 0.52]; }        // 枯草（发黄 —— 不再是绿的 ✓）
    return [0.74, 0.71, 0.65];                          // 干裂泥土
  }
  var verts = [], uvs = [], cols = [], idx = [], base = 0, i, j, k;
  for (i = -R; i <= R; i++) {
    for (j = -R; j <= R; j++) {
      var bi = bx + i, bj = bz + j;
      var x0 = bi * W, z0 = bj * W, x1 = x0 + W, z1 = z0 + W;
      var c = tintAt(bi, bj);
      var p4 = [[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]];
      for (k = 0; k < 4; k++) {
        verts.push(p4[k][0], p4[k][1], p4[k][2]);
        // ★ UV 用世界坐标（贴图含 4×4 格 ✓ 每格 GRID_WORLD 单位 ✓ 自然平铺不被拉伸 ✓）
        uvs.push(p4[k][0] / (G.GRID_WORLD * 4), p4[k][2] / (G.GRID_WORLD * 4));
        cols.push(c[0], c[1], c[2]);
      }
      // ★ 绕序修正（从上方看逆时针 ✓ 否则被背面剔除 → 看不见 ✓✓）
      idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      base += 4;
    }
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  geo.setIndex(idx);
  if (GROUNDMESH) {   // ★ 旧的必须 dispose，不然每重建一次就漏一份显存 ✗
    scene.remove(GROUNDMESH);
    if (GROUNDMESH.geometry) { GROUNDMESH.geometry.dispose(); }
  }
  GROUNDMESH = new THREE.Mesh(geo, groundMaterial());   // ★ MeshBasicMaterial（不受光照影响 ✓）
  GROUNDMESH.receiveShadow = true;
  /* ★ 第 306 轮：这块【远景平面】压到地形下面 0.20 ✗
     它现在只负责"远处别露黑底" ✗ 真正的地面是下面的方块地形 ✓
     0.20 比最低的地面（约 −0.04）还低 ✓ 不会和地形打架 ✓ */
  GROUNDMESH.position.y = -0.20;
  scene.add(GROUNDMESH);
  _groundBX = bx; _groundBZ = bz;
}

/* ============================================================================
   ★★★ 地形瓦片（D 档观感）★★★
   ★ 观感三条（按重要性）：
     ① 侧面明暗：每层亮度略不同 ✗ 看得出台阶 ✓
     ② 接触阴影：侧面【靠地面】那头压暗 ✗ 顶面靠边一圈也压暗 ✓
     ③ 上沿高光：侧面【顶上】那头提亮 ✗ 像被天光照到 ✓
   ★ 为什么合并成一个几何：16×16 = 256 格 ✗ 一格一个 Mesh 直接完蛋 ✓
   ★ 为什么分瓦片而不是一整块：一整块每次移动都要重建 4096 格 ✗
     分瓦片只建缺的那几片 ✗ 一帧最多建 TILE_BUDGET 片 ✓ 不会卡 ✓
   ============================================================================ */
var _terTiles = {}, _terTileN = 0;

function _terColOf(mat, h, kv) {
  var c = TER_COL[mat] || TER_COL.grass;
  // 越高越亮（每层 +7.5% ✗ 只有 5 层 ✗ 不会发光 ✓）
  // ★ 每升一层亮 11%（原来 7.5% ✗ 台阶层次不明显 ✓）
  var k = (1.0 + 0.16 * Math.max(0, h)) * kv;
  return [c[0] * k, c[1] * k, c[2] * k];
}

function buildTerrainTile(ti, tj) {
  var N = TER.TILE, LH = TER.LEVEL_H;
  var V = [], UV = [], C = [], I = [];
  var FV = [], FC = [], FI = [];      // 流体（水/地火）
  var gx0 = ti * N, gz0 = tj * N;
  var GW = G.GRID_WORLD;   // 贴图比例沿用现在的地面（每 2 格一个小格 ✓）

  function pushQuad(pts, col, uv) {
    var b = V.length / 3;
    for (var k = 0; k < 4; k++) {
      V.push(pts[k][0], pts[k][1], pts[k][2]);
      UV.push(uv[k][0], uv[k][1]);
      C.push(col[k][0], col[k][1], col[k][2]);
    }
    I.push(b, b + 2, b + 1, b, b + 3, b + 2);
  }

  for (var i = 0; i < N; i++) {
    for (var j = 0; j < N; j++) {
      var gx = gx0 + i, gz = gz0 + j;
      var h = terH(gx, gz);
      var mat = terMat(gx, gz);
      var x0 = gx * LH, x1 = x0 + LH;
      var z0 = gz * LH, z1 = z0 + LH;

      // 四个角的 Y（斜坡会让它们不一样 ✓ 和玩法判定同源 ✓）
      var y00 = terGroundY(gx, gz, 0, 0);
      var y10 = terGroundY(gx, gz, 1, 0);
      var y11 = terGroundY(gx, gz, 1, 1);
      var y01 = terGroundY(gx, gz, 0, 1);

      // 顶面：紧挨着更低处的格子压暗（假 AO ✗ 不用贴图就能看出"边缘"✓）
      /* ★ 假 AO：挨着低处的那几边压暗 ✗ 顶面边缘就有"厚度感"✓
         第 307 轮加强：每边 −0.09（原来 −0.10 但基准只有 1.0 ✗ 不明显 ✓）
         四边都低 → 0.64 ✗ 一块地就被"框"出来了 ✓ */
      var ao = 1.0;
      var nH;
      /* ★★ 第 307 轮（用户："方块立体感不够强"）：两种压暗一起做 ★★
         ① 挨着【更低】的格子 → 这里是个边 ✗ 压一点 ✓（边缘感）
         ② 挨着【更高】的格子 → 这里是悬崖脚下 ✗ 压更多 ✓（阴影感）
         ★ ② 才是立体感的来源：有阴影就知道"那边高"✓
         四个方向都被高墙围住 → 0.52 ✗ 那个坑一眼就看出是坑 ✓ */
      var edge = 0;   // ★ 这一格有几个邻居和它高度不同（0 = 在平地中间 ✓）
      nH = terH(gx + 1, gz); if (nH < h - 0.30) { ao -= 0.09; edge = 1; } else if (nH > h + 0.30) { ao -= 0.12; edge = 1; }
      nH = terH(gx - 1, gz); if (nH < h - 0.30) { ao -= 0.09; edge = 1; } else if (nH > h + 0.30) { ao -= 0.12; edge = 1; }
      nH = terH(gx, gz + 1); if (nH < h - 0.30) { ao -= 0.09; edge = 1; } else if (nH > h + 0.30) { ao -= 0.12; edge = 1; }
      nH = terH(gx, gz - 1); if (nH < h - 0.30) { ao -= 0.09; edge = 1; } else if (nH > h + 0.30) { ao -= 0.12; edge = 1; }
      /* ★ F0 流体：一格一个面（水位 = 地面 + 深度 ✓） */
      var _fk = terFluid(gx, gz);
      if (_fk) {
        var _fyv = terFluidY(gx, gz);
        var _fy = (_fyv === null) ? (h * LH) : _fyv;
        var _fc = (_fk === 3) ? [1.0, 0.42, 0.10] : [0.20, 0.52, 0.60];
        // 地火略微动一下明暗（像在烧 ✗ 但只是顶点色 ✗ 零开销 ✓）
        if (_fk === 3) {
          var _flick = 1.0 + 0.18 * Math.sin(performance.now() / 180 + gx * 1.7 + gz * 2.3);
          _fc = [_fc[0] * _flick, _fc[1] * _flick, _fc[2] * _flick];
        }
        var _ins = LH * 0.02;
        var _fb = FV.length / 3;
        FV.push(x0 + _ins, _fy, z0 + _ins, x1 - _ins, _fy, z0 + _ins,
                x1 - _ins, _fy, z1 - _ins, x0 + _ins, _fy, z1 - _ins);
        for (var _fi2 = 0; _fi2 < 4; _fi2++) { FC.push(_fc[0], _fc[1], _fc[2]); }
        FI.push(_fb, _fb + 2, _fb + 1, _fb, _fb + 3, _fb + 2);
      }

      var ct = _terColOf(mat, h, ao);
      var uvT = [[x0 / GW, z0 / GW], [x1 / GW, z0 / GW], [x1 / GW, z1 / GW], [x0 / GW, z1 / GW]];
      /* ★★★ round308（用户："方块的边框感再明显一点"）★★★
         做法：每格顶面画【两层】
           ① 满格铺一层【暗色】→ 相邻两格之间就露出一条暗缝 ✓
           ② 内缩 7.5% 再铺一层【亮色】→ 像一个一个砖块 ✓
         成本：顶面四边形从 1 个变 2 个 ✗ 三角形翻倍 ✓
              但地形是 unlit 的 ✗ 手机上画 5 万个三角形没什么压力 ✓
         ★ 为什么不用"画线"：线在 3D 里有锯齿 ✗ 而且每格 4 条线太密 ✓
           内缩的两层最干净 ✗ 而且能跟着高度/材质自动变 ✓ */
      /* ★★★ round309（用户："方块的线条太多了太密集了"）★★★
         根因：我上一版给【每一格】都画了砖缝 ✗
               → 平地上就是一张方格纸 ✓ 0.62 一格 × 屏幕上 14 像素一条线 ✓
         改：只给【边上的格子】画 ✗ 也就是邻居高度和它不同的那些 ✓
             → 平地上【一条线都没有】✓ 台阶和台地边缘才有一圈深色 ✓
             → 既看得出方块轮廓 ✗ 又没有满屏网格 ✓
         ★ 判据用 edge（见上面）✗ 已经在算了 ✓ 顺手 ✓ */
      if (edge) {
        var cb = _terColOf(mat, h, ao * 0.74);
        pushQuad([[x0, y00, z0], [x1, y10, z0], [x1, y11, z1], [x0, y01, z1]],
                 [cb, cb, cb, cb], uvT);
        var ins = TER.LEVEL_H * 0.035;
        var iy = 0.004;
        pushQuad([[x0 + ins, y00 + iy, z0 + ins], [x1 - ins, y10 + iy, z0 + ins],
                  [x1 - ins, y11 + iy, z1 - ins], [x0 + ins, y01 + iy, z1 - ins]],
                 [ct, ct, ct, ct], uvT);
      } else {
        pushQuad([[x0, y00, z0], [x1, y10, z0], [x1, y11, z1], [x0, y01, z1]],
                 [ct, ct, ct, ct], uvT);
      }

      /* ---- 四个侧面：只画比邻居高的那部分 ✗ 被挡住的完全不生成 ✓ ---- */
      // 每边：本格边上的高度（两个角的平均）/ 邻居对边的平均高度
      var ed = [
        // [本格边高, 邻居边高, 四个点(外法线方向)]
        [(y10 + y11) / 2, gx + 1, gz, 1, 0, [[x1, z0], [x1, z1]]],
        [(y00 + y01) / 2, gx - 1, gz, -1, 0, [[x0, z1], [x0, z0]]],
        [(y01 + y11) / 2, gx, gz + 1, 0, 1, [[x1, z1], [x0, z1]]],
        [(y00 + y10) / 2, gx, gz - 1, 0, -1, [[x0, z0], [x1, z0]]]
      ];
      for (var e = 0; e < 4; e++) {
        var own = ed[e][0];
        var nx2 = ed[e][1], nz2 = ed[e][2];
        var nb;
        if (ed[e][3] === 1) { nb = (terGroundY(nx2, nz2, 0, 0) + terGroundY(nx2, nz2, 0, 1)) / 2; }
        else if (ed[e][3] === -1) { nb = (terGroundY(nx2, nz2, 1, 0) + terGroundY(nx2, nz2, 1, 1)) / 2; }
        else if (ed[e][4] === 1) { nb = (terGroundY(nx2, nz2, 0, 0) + terGroundY(nx2, nz2, 1, 0)) / 2; }
        else { nb = (terGroundY(nx2, nz2, 0, 1) + terGroundY(nx2, nz2, 1, 1)) / 2; }
        if (own - nb < 0.02) { continue; }     // 邻居不比这里低 → 不画 ✓
        var A = ed[e][5][0], B = ed[e][5][1];
        // ③ 上沿高光 / ② 接触阴影：上两点亮、下两点暗 ✓
        /* ★ 第 307 轮（用户："方块立体感不够强"）：
           上沿 0.92（亮 ✗ 像被天光照到）
           底部 0.30（很暗 ✗ 像贴着地面的阴影）
           → 一个侧面里上亮下暗 = 2.4 倍反差 ✓ 立体感主要靠这个 ✓ */
        var cTop = _terColOf(mat, h, 0.92);
        var cBot = _terColOf(mat, h, 0.30);
        /* ★ 侧面用一个【固定点】的 UV ✗ 不要拉伸 ✓
           自测踩到：原来写的是 [[0.5,0],[0.5,1],…] ✗ 等于沿贴图竖直方向
           拉一根线 ✗ 碰上贴图里的亮线 → 地面上出现一片白条纹 ✓
           改成四点同一个坐标 = 只采样一个像素 = 纯色 ✓ */
        var uvS = [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5], [0.5, 0.5]];
        pushQuad([[A[0], own, A[1]], [B[0], own, B[1]], [B[0], nb, B[1]], [A[0], nb, A[1]]],
                 [cTop, cTop, cBot, cBot], uvS);
      }
    }
  }

  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(V, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  geo.setIndex(I);
  geo.computeBoundingSphere();
  var mesh = new THREE.Mesh(geo, groundMaterial());
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  scene.add(mesh);

  /* ★ F0 流体层：和地形同一个循环里顺手收集 ✗ 不用再遍历一遍 ✓
     ★ 为什么单独一个 mesh：水是【半透明】的 ✗ 和地形共用一个材质就全透了 ✓ */
  if (FV.length) {
    var fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(FV, 3));
    fg.setAttribute('color', new THREE.Float32BufferAttribute(FC, 3));
    fg.setIndex(FI);
    fg.computeBoundingSphere();
    var fm = new THREE.Mesh(fg, fluidMaterial());
    fm.renderOrder = 2;
    scene.add(fm);
    mesh._fluid = fm;
  }
  return mesh;
}

/* 流体材质（★ 水半透明 ✗ 地火不透明且很亮 ✓）共用一份 ✗ 不每片新建 ✓ */
var _fluidMat = null;
function fluidMaterial() {
  if (_fluidMat) { return _fluidMat; }
  _fluidMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.66,
    depthWrite: false, side: THREE.DoubleSide });
  return _fluidMat;
}

function refreshTerrain() {
  var S = TER.TILE * TER.LEVEL_H;
  var cti = Math.floor(P.x / S), ctj = Math.floor(P.z / S);
  var R = TER.TILE_R;
  // 需要哪些瓦片（按距离由近到远 ✗ 近的先建 ✓）
  var want = [];
  for (var di = -R; di <= R; di++) {
    for (var dj = -R; dj <= R; dj++) {
      if (di * di + dj * dj > (R + 0.4) * (R + 0.4)) { continue; }
      want.push([cti + di, ctj + dj, di * di + dj * dj]);
    }
  }
  want.sort(function (a, b) { return a[2] - b[2]; });
  var built = 0;
  for (var k = 0; k < want.length; k++) {
    if (built >= TER.TILE_BUDGET) { break; }
    var key = want[k][0] + ',' + want[k][1];
    if (_terTiles[key]) { continue; }
    _terTiles[key] = buildTerrainTile(want[k][0], want[k][1]);
    _terTileN++;
    built++;
  }
  // 卸掉跑远的
  for (var k2 in _terTiles) {
    var sp = k2.split(',');
    if (Math.abs(parseInt(sp[0], 10) - cti) > R + 1 ||
        Math.abs(parseInt(sp[1], 10) - ctj) > R + 1) {
      scene.remove(_terTiles[k2]);
      if (_terTiles[k2].geometry) { _terTiles[k2].geometry.dispose(); }
      delete _terTiles[k2];
      _terTileN--;
    }
  }
}


/* ============ 物件合并网格 ============ */
function boxGeoAt(w, h2, d, cx, cy, cz, rotY) {
  var g = new THREE.BoxGeometry(w, h2, d);
  var mtx = new THREE.Matrix4();
  if (rotY) { mtx.makeRotationY(rotY); }
  mtx.setPosition(cx, cy, cz);
  g.applyMatrix4(mtx);
  return g;
}
function mergeGeos(list) {
  var total = 0, i;
  for (i = 0; i < list.length; i++) { total += list[i].getAttribute('position').count; }
  var pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  var po = 0, no = 0, uo = 0;
  for (i = 0; i < list.length; i++) {
    var g = list[i];
    var p = g.getAttribute('position'), n = g.getAttribute('normal'), u = g.getAttribute('uv');
    for (var k = 0; k < p.count; k++) {
      pos[po++] = p.getX(k); pos[po++] = p.getY(k); pos[po++] = p.getZ(k);
      if (n) { nor[no++] = n.getX(k); nor[no++] = n.getY(k); nor[no++] = n.getZ(k); } else { no += 3; }
      if (u) { uv[uo++] = u.getX(k); uv[uo++] = u.getY(k); } else { uo += 2; }
    }
  }
  var out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}
/* ============ 建筑：按【世界格子】分块生成 ============ */
/* ★★ 为什么必须分块（第 28 轮修的真 bug）★★
   原来是：围绕【玩家自己】扫一圈 ±PROP_R 格，生成完就再也不管了。两个后果：
     ① 两个人站的位置不同 → 各自生成的那一片不同 → 【看到的世界不一样】✗
        （玩家反馈："建筑例如石头和树，两边刷新的是不一样的"）
     ② 走远了不会生成新的 → 出生点之外整片世界是空的 ✗
   现在：把世界切成固定大小的块（每块 PROP_CHUNK 格），
         一块里长什么【只看这块自己的坐标】+ 往外扩一圈光环
         （房子占 ±7 格、树占 ±3 格 → 光环取 8 格就能把邻居全盖住）
         → 和"谁在看、从哪儿看"完全无关 ✓ 谁看都一样 ✓
         走到哪加载哪、走远自动卸 → 世界是无限的 ✓
   （终局是"服务端按世界种子算"，见方案 §15.1；那时也是同一套分块逻辑，所以这一步不白做 ✓）*/
var PROP_CHUNK = 32;      // 每块 32 格（≈20 米）
var PROP_HALO = 8;        // 生成时往外扩 8 格（必须 ≥ 房子的 ±7 ✓）
var propAt = {};          // "gx,gz" -> kind（能砍的物件 ✓）
var propDead = {};        // "gx,gz" -> 1（已经被砍掉 ✓ 服务端说了算）
var _chunkMesh = {};      // "i,j" -> [THREE.Mesh, ...] 一块一组，整块好卸 ✓
var _chunkSolid = {};     // "i,j" -> [{x,z,hw,hd}, ...]
var _propTotal = 0;       // 当前一共多少个物件（统计用）
var _propCI = 1e9, _propCJ = 1e9;   // 上次生成时玩家在第几块
var _propPending = false; // 还有块没建完（一帧的建块预算用完了）→ 下一帧接着建 ✓
var PROP_BUILD_MAX = 2;   // ★ 一次最多新建几块（别一帧建 9 块把帧顶爆 ✗）

function buildChunk(ci, cj) {
  var key = ci + ',' + cj;
  if (_chunkSolid[key]) { return; }
  var x0 = ci * PROP_CHUNK, z0 = cj * PROP_CHUNK;
  var H = PROP_HALO, i, j;
  occupied = {};                       // ★ 占位表按块独立 → 块与块之间互不影响 ✓
  var acc = {}, placed = 0, sol = [];
  for (i = x0 - H; i < x0 + PROP_CHUNK + H; i++) {
    for (j = z0 - H; j < z0 + PROP_CHUNK + H; j++) {
      var gx = i, gz = j;
      var wx = worldX(gx), wz = worldZ(gz);
      if (Math.abs(wx) <= SAFE_HALF && Math.abs(wz) <= SAFE_HALF) { continue; }
      var hh = ((gx * 2654435761) ^ (gz * 40503)) & 0xffffffff, q = Math.abs(hh % 1000);
      if (q % G.PROP_DENSITY !== 0) { continue; }
      if ((q % 250) >= 80 && (q % 250) < 96) { markHouseCells(gx, gz); }
    }
  }
  for (i = x0 - H; i < x0 + PROP_CHUNK + H; i++) {
    for (j = z0 - H; j < z0 + PROP_CHUNK + H; j++) {
      var gx2 = i, gz2 = j;
      var wx2 = worldX(gx2), wz2 = worldZ(gz2);
      if (Math.abs(wx2) <= SAFE_HALF && Math.abs(wz2) <= SAFE_HALF) { continue; }
      var hh2 = ((gx2 * 2654435761) ^ (gz2 * 40503)) & 0xffffffff, q2 = Math.abs(hh2 % 1000);
      if (q2 % G.PROP_DENSITY !== 0) { continue; }
      var qq = q2 % 250, vi = (q2 >> 5) % 3;
      /* ★ 种类分配（末日版）：
           qq<70      树 → 一半换成【枯树】（没叶子的光杆 ✓）
           [80,96)    房子（不变）
           [120,180)  石头 → 一半换成【废墟堆】
           [180,200)  围栏（不变）
           [200,214)  ★ 新增：报废车 / 油桶（末日残骸 ✓）
         ★ 注意：这里的 qq 是【格子自己的哈希】→ 世界固定、谁看都一样 ✓
           （改这一行会改变全世界长什么，但不影响"两边一致"✓）*/
      var kind = (qq >= 80 && qq < 96) ? ((vi === 0) ? 'house' : 'house2')
               : ((qq < 70) ? ((vi === 0) ? 'dead' : ((vi === 1) ? 'tree2' : 'tree3'))
               : ((qq < 120) ? null
               : ((qq < 180) ? ((vi === 0) ? 'rock' : ((vi === 1) ? 'rubble' : 'rock3'))
               : ((qq < 200) ? ((vi === 0) ? 'fence' : 'fence2')
               : ((qq < 214) ? ((vi === 0) ? 'wreck' : 'barrel')
               : ((qq < 236) ? 'ruin' : null))))));
      if (!kind) { continue; }
      if (kind !== 'house' && kind !== 'house2' && isHouseCell(gx2, gz2)) { continue; }
      if (kind.indexOf('tree') === 0 || kind === 'dead') { markTreeCells(gx2, gz2); }
      else if (isHouseCell(gx2, gz2)) { continue; }
      // ★ 只有【真正属于本块】的格子才落地；光环里的格子只负责"占位" ✓
      if (gx2 < x0 || gx2 >= x0 + PROP_CHUNK || gz2 < z0 || gz2 >= z0 + PROP_CHUNK) { continue; }

      if (propDead[gx2 + ',' + gz2]) { continue; }   // ★ 已经被砍掉了 ✓
      var parts = (PROP_PARTS && PROP_PARTS[kind]) || PROP_PARTS.tree;
      if (!parts || !parts.length) { continue; }
      var s = G.PROP_SCALE;
      var rot = ((q2 >> 3) % 4) * Math.PI / 2, cs = Math.cos(rot), sn = Math.sin(rot);
      for (var pi = 0; pi < parts.length; pi++) {
        var p = parts[pi];
        var ox = (p[4] * cs - p[6] * sn) * s, oz = (p[4] * sn + p[6] * cs) * s, oy = p[5] * s;
        if (!acc[p[3]]) { acc[p[3]] = []; }
        acc[p[3]].push(boxGeoAt(p[0] * s, p[1] * s, p[2] * s, wx2 + ox, oy, wz2 + oz, rot).toNonIndexed());
      }
      var hw = 0.45, hd = 0.45;
      if (kind.indexOf('tree') === 0 || kind === 'dead') { hw = 0.30; hd = 0.30; }
      else if (kind.indexOf('rock') === 0 || kind === 'rubble') { hw = 0.75; hd = 0.75; }
      else if (kind.indexOf('fence') === 0) { hw = 1.4; hd = 0.14; }
      else if (kind === 'wreck') { hw = 1.30; hd = 0.65; }     // 报废车：长条
      else if (kind === 'barrel') { hw = 0.40; hd = 0.40; }    // 油桶：小
      else if (kind === 'ruin') { hw = 1.90; hd = 1.50; }      // 废墟墙：断墙挺占地方，碰撞箱给足一点
      else { hw = 1.95; hd = 1.60; }
      sol.push({ x: wx2, z: wz2, hw: hw * s, hd: hd * s });
      /* ★ round329（P1 树木破坏）：记下"这一格长着什么"✗ 攻击时要查 ✓
         ★ 只记【能砍的】（树 / 石头 / 栅栏 ✗ 房子以后再说 ✓）*/
      /* ★ round339（用户："房子掉砖头"）：房子也要能被选中 ✗ 不然砍不到 ✓ */
      if (kind.indexOf('tree') === 0 || kind === 'dead' || kind === 'rock' ||
          kind === 'rubble' || kind === 'rock3' || kind.indexOf('fence') === 0 ||
          kind.indexOf('house') === 0 || kind === 'ruin') {   // ★ 断墙 ✓
        propAt[gx2 + ',' + gz2] = kind;
      }
      placed++;
    }
  }
  var meshes = [];
  for (var mk in acc) {
    var list = acc[mk];
    if (!list || !list.length) { continue; }
    var geo = mergeGeos(list);
    var mesh = new THREE.Mesh(geo, M[mk] || M.dirt);
    mesh.castShadow = true; mesh.receiveShadow = false;
    scene.add(mesh); meshes.push(mesh);
    for (var di = 0; di < list.length; di++) { list[di].dispose(); }
  }
  _chunkMesh[key] = meshes;
  _chunkSolid[key] = sol;
  _propTotal += placed;
}

function dropChunk(key) {
  var meshes = _chunkMesh[key] || [], mi;
  for (mi = 0; mi < meshes.length; mi++) {
    scene.remove(meshes[mi]);
    if (meshes[mi].geometry) { meshes[mi].geometry.dispose(); }
  }
  _propTotal -= (_chunkSolid[key] || []).length;
  delete _chunkMesh[key];
  delete _chunkSolid[key];
}

/* 玩家在那几块 → 世界就该有那几块：缺的建、远的卸 ✓
   frame() 每帧只做一次"块号变了没"的判断，真变了才走这里 ✓ */
function updateProps() {
  var cx = cellOf(P.x), cz = cellOf(P.z), R = G.PROP_R, k, i, j;
  var i0 = Math.floor((cx - R) / PROP_CHUNK), i1 = Math.floor((cx + R) / PROP_CHUNK);
  var j0 = Math.floor((cz - R) / PROP_CHUNK), j1 = Math.floor((cz + R) / PROP_CHUNK);
  /* ★ 建块要有【每帧预算】（第 29 轮加的）：
     一次瞬移/重登可能同时缺 9 块，一帧全建完实测要 15~16ms —— 正好顶到一帧预算，
     慢点的手机就会卡一下 ✗
     所以一次最多建 PROP_BUILD_MAX 块，剩下的下一帧接着建（世界会分几帧长出来，
     顶多几十毫秒，看不出来；但绝不卡那一下 ✓）
     正常走路跨块只缺 1~2 块 → 一次就建完，没有延迟 ✓ */
  var want = {}, wanted = [];
  for (i = i0; i <= i1; i++) {
    for (j = j0; j <= j1; j++) {
      k = i + ',' + j; want[k] = 1;
      if (!_chunkSolid[k]) { wanted.push(i); wanted.push(j); }   // 平铺存，省得再拆字符串
    }
  }
  var built = 0;
  for (i = 0; i < wanted.length && built < PROP_BUILD_MAX; i += 2) {
    buildChunk(wanted[i], wanted[i + 1]);
    built++;
  }
  _propPending = (built < wanted.length / 2);   // 还有没建完的 → frame() 下一帧接着调 ✓
  var gone = [];
  for (k in _chunkMesh) { if (!want[k]) { gone.push(k); } }
  for (i = 0; i < gone.length; i++) { dropChunk(gone[i]); }   // ★ 先收集再删，别边遍历边删 ✓
  propSolids = [];
  PROP_MESHES = [];
  for (k in _chunkSolid) { propSolids = propSolids.concat(_chunkSolid[k]); }
  for (k in _chunkMesh) { PROP_MESHES = PROP_MESHES.concat(_chunkMesh[k]); }
  _propCI = Math.floor(cx / PROP_CHUNK);
  _propCJ = Math.floor(cz / PROP_CHUNK);
  /* ★ 第 32 轮：原来这里会往「物件/Mesh/地顶点/UV/贴图」那块面板写一串统计，
     用户反馈没用 → 整块去掉了（连 di/hasUV/hasMap 的计算也一起省掉 ✓）*/
}

/* ★ 老调用点（初始化 / 改画质设置）保持同名：重算"该有哪几块"就行 ✓ */
function refreshProps() { updateProps(); }

/* ============ 空间网格（把妖兽按格子分桶 ✓ 只查相邻 9 格 ✓ O(N) ✓）============ */
var SGrid = { cell: 3.0, map: {} };
function gridKey(cx, cz) { return cx + ',' + cz; }
function rebuildGrid() {
  SGrid.map = {};
  var c = SGrid.cell;
  for (var i = 0; i < mobs.length; i++) {
    var m = mobs[i];
    if (!m.alive) { continue; }
    var k = gridKey(Math.floor(m.g.position.x / c), Math.floor(m.g.position.z / c));
    if (!SGrid.map[k]) { SGrid.map[k] = []; }
    SGrid.map[k].push(m);
  }
}
function nearMobs(x, z) {
  var c = SGrid.cell, out = [];
  var cx = Math.floor(x / c), cz = Math.floor(z / c);
  for (var i = -1; i <= 1; i++) {
    for (var j = -1; j <= 1; j++) {
      var arr = SGrid.map[gridKey(cx + i, cz + j)];
      if (arr) { for (var q = 0; q < arr.length; q++) { out.push(arr[q]); } }
    }
  }
  return out;
}

/* ============ 碰撞 ============ */
/* ★ 矩形碰撞检测（AABB ✓ 比圆形更贴合方块身体 ✓）
   x,z = 目标位置中心 ✓ hw,hd = 碰撞箱半宽/半深 ✓
   byMob = true 时也检测妖兽（人物被妖兽拦住 ✓）*/
/* ★ 矩形碰撞检测（AABB ✓）
   x,z = 目标位置中心 ✓ hw,hd = 碰撞箱半宽/半深 ✓
   byMob = true 时检测【动态实体：妖兽 + 其他玩家】✓ skipMob = 要跳过的妖兽（自己 ✓）
   fromX,fromZ = 移动前的位置（★ 关键：本来就已经重叠的，不算阻挡 ✓
                 否则两个箱子一旦压在一起 → 两边都被挡住 → 永远卡死 ✗）*/
/* ★ 第 56 轮：复活无敌的显示效果 —— 脚下一圈会呼吸的浅蓝光环 ✓
   ★ 懒创建（第一次用到才建）→ 不用动 init，也不用操心加载顺序 ✓
   ★ core 层不许碰浏览器 API ✗ 所以不用 performance.now()，
     用 INVULN_T 自己算脉动（它本来就是 1.5 → 0 的倒计时 ✓）*/
var _invRing = null;
/* ★ 第 63 轮：做成工厂 —— 本地玩家和【队友】都要用（队友复活也得看得见 ✓）*/
function makeInvRing() {
  var m = new THREE.Mesh(
    new THREE.RingGeometry(0.60, 0.88, 28),
    new THREE.MeshBasicMaterial({ color: 0x8ee0ff, transparent: true, opacity: 0.7,
                                  side: THREE.DoubleSide, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  scene.add(m);
  return m;
}
function invRingUpdate() {
  if (INVULN_T <= 0) {
    if (_invRing) { _invRing.visible = false; }
    return;
  }
  if (!_invRing) { _invRing = makeInvRing(); }
  _invRing.visible = true;
  _invRing.position.set(P.x, 0.07, P.z);
  var k = Math.max(0, Math.min(1, INVULN_T / 1.5));
  _invRing.material.opacity = 0.20 + 0.55 * k;                 // 快没了就变淡 ✓
  var pulse = 1 + 0.10 * Math.sin(INVULN_T * 14.0);            // 呼吸脉动
  _invRing.scale.set(pulse, pulse, pulse);
}


/* ★★ 第 63 轮：登场特效（复活 / 上线）★★
   用户："要让别人能看出他是复活了，而不是凭空出现了"
   ★ 纯表现，不参与任何判定 ✓（就一束光柱 + 一圈扩散的环，1.1 秒收掉 ✓）
   ★ 用最简单的几何体：开口圆柱（光柱）+ 环（冲击波）✓ 都是 1 次 draw call ✓ */
var FX_LIST = [];
function spawnFx(x, z, kind, name) {
  var col = (kind === 'revive') ? 0x8ee0ff : 0xffe0a0;
  var beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.62, 4.2, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55,
                                  side: THREE.DoubleSide, depthWrite: false }));
  beam.position.set(x, 2.1, z);
  scene.add(beam);
  var ring = new THREE.Mesh(
    new THREE.RingGeometry(0.4, 0.62, 26),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8,
                                  side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.08, z);
  scene.add(ring);
  FX_LIST.push({ t: 0, life: 1.1, beam: beam, ring: ring, kind: kind, name: name });
}
function fxTick(dt) {
  for (var i = FX_LIST.length - 1; i >= 0; i--) {
    var f = FX_LIST[i];
    f.t += dt;
    var k = Math.min(1, f.t / f.life);
    // 光柱：淡出 + 稍微收细
    f.beam.material.opacity = 0.55 * (1 - k);
    f.beam.scale.set(1 - 0.35 * k, 1, 1 - 0.35 * k);
    // 环：往外扩 + 淡出
    var sc = 1 + 3.2 * k;
    f.ring.scale.set(sc, sc, sc);
    f.ring.material.opacity = 0.8 * (1 - k);
    if (k >= 1) {
      scene.remove(f.beam); scene.remove(f.ring);
      f.beam.geometry.dispose(); f.beam.material.dispose();
      f.ring.geometry.dispose(); f.ring.material.dispose();
      FX_LIST.splice(i, 1);
    }
  }
}


function blocked(x, z, hw, hd, byMob, skipMob, fromX, fromZ) {
  var hasFrom = (fromX !== undefined && fromZ !== undefined);
  // ① 静态物件
  var all = solids.concat(propSolids);
  if (typeof TOWN_SOLIDS !== 'undefined') { all = all.concat(TOWN_SOLIDS); }
  for (var i = 0; i < all.length; i++) {
    var s = all[i];
    if (x + hw > s.x - s.hw && x - hw < s.x + s.hw && z + hd > s.z - s.hd && z - hd < s.z + s.hd) {
      if (hasFrom && fromX + hw > s.x - s.hw && fromX - hw < s.x + s.hw &&
          fromZ + hd > s.z - s.hd && fromZ - hd < s.z + s.hd) { continue; }   // 本来就在里面 → 放行让他出去 ✓
      return true;
    }
  }
  // ② 妖兽（★ 只查相邻 9 格 ✓ O(1) 均摊 ✓ 不再遍历全部 ✗）
  if (byMob) {
    var mhw = G.MOB_W / 2, mhd = G.MOB_D / 2;
    var near = nearMobs(x, z);
    for (var j = 0; j < near.length; j++) {
      var m = near[j];
      if (!m.alive || m === skipMob) { continue; }
      if (x + hw > m.g.position.x - mhw && x - hw < m.g.position.x + mhw &&
          z + hd > m.g.position.z - mhd && z - hd < m.g.position.z + mhd) {
        if (hasFrom && fromX + hw > m.g.position.x - mhw && fromX - hw < m.g.position.x + mhw &&
            fromZ + hd > m.g.position.z - mhd && fromZ - hd < m.g.position.z + mhd) { continue; }
        return true;
      }
    }
    // ③ 其他玩家 + 公共妖兽（★ 都是矩形碰撞箱 ✓ 不能穿过去 ✓
    //    本来就已经重叠就放行 → 永远不会卡在一起 ✓ 用户要求：碰撞箱不能重叠 ✓）
    if (NET.on) {
      var phw = G.BODY_W / 2, phd = G.BODY_D / 2;
      for (var uid in NET.others) {
        var o = NET.others[uid];
        if (!o || !o.cur) { continue; }
        var ox = o.cur.x, oz = o.cur.z;
        if (x + hw > ox - phw && x - hw < ox + phw && z + hd > oz - phd && z - hd < oz + phd) {
          if (hasFrom && fromX + hw > ox - phw && fromX - hw < ox + phw &&
              fromZ + hd > oz - phd && fromZ - hd < oz + phd) { continue; }
          return true;
        }
      }
      var wmhw = G.MOB_W / 2, wmhd = G.MOB_D / 2;
      for (var wmid in NET.rmobs) {
        var wm = NET.rmobs[wmid];
        if (!wm || !wm.alive || !wm.cur) { continue; }
        var wx2 = wm.cur.x, wz2 = wm.cur.z;
        if (x + hw > wx2 - wmhw && x - hw < wx2 + wmhw && z + hd > wz2 - wmhd && z - hd < wz2 + wmhd) {
          if (hasFrom && fromX + hw > wx2 - wmhw && fromX - hw < wx2 + wmhw &&
              fromZ + hd > wz2 - wmhd && fromZ - hd < wz2 + wmhd) { continue; }
          return true;
        }
      }
    }
  }
  return false;
}
/* ★ 带碰撞的移动（两轴分离 → 可沿边滑动 ✓ 人物会被妖兽和其他玩家拦住 ✓）*/
/* ★ 第 306 轮：地形能不能走过去（只看"上去"✗ 下去随便走 ✓）
   ★ 在空中的时候【不拦】✗ 因为跳上去就是靠"空中飘过去再落地"✓
   ★ 只比对【脚步位置】的地面高度 ✗ 不比对碰撞箱 ✓ 简单且够用 ✓ */
function terrainStepOk(x, z) {
  if (P.air) { return true; }
  /* ★ 站在水里可以直接走上岸（不用跳）—— 水盆比岸低一层，
     不特判的话每次出水都要跳一下，在沼泽里会烦死 ✓ */
  if (P.inWater) { return true; }
  /* ★★★ round308（用户："方块有比较严格碰撞箱，现在贴近了也容易穿模"）★★★
     根因：这里原来只查【脚下中心点】一个位置 ✗
           而身体有 0.6×0.5 那么宽 ✓ → 能贴着高方块走进去半个身位 ✓
           视觉上就是"人压进方块里"✓
     修：查【身体四角 + 中心】五个点 ✗ 取其中最高的地面 ✓
        → 离高方块还有半个身位就走不过去了 ✓ 和视觉完全对得上 ✓
     ★ 五个点比"一个矩形查询"便宜得多 ✓ 而且地形是纯函数 ✓ 没有副作用 ✓ */
  /* ★★★ round319 修的真 bug（用户："高低不同的方块之间跳跃时会被卡住"）★★★
     根因：这里只问"目标位置的地面比我的脚高多少"✗
           身体有宽度 → 站在台子边上时【一个角已经伸进高方块里】✓
           于是【四个方向全被拦】☞ 连"往外走"也被拦 ✗ 人就卡死了 ✓
     修：除了看落差 ✗ 还看【是不是在往外走】✓
         ① 目标位置的最高地面【不比现在高】→ 一律放行（往外走 ✓ 沿墙平移 ✓）
         ② 否则才按落差判（往高处走要跳 ✓）
     ★ 这一条同时修掉"贴着墙走不动"的问题 ✓ */
  var hw = G.BODY_W * 0.5, hd = G.BODY_D * 0.5;
  function _maxY(px, pz) {
    var m = terYAt(px, pz), t;
    t = terYAt(px + hw, pz + hd); if (t > m) { m = t; }
    t = terYAt(px + hw, pz - hd); if (t > m) { m = t; }
    t = terYAt(px - hw, pz + hd); if (t > m) { m = t; }
    t = terYAt(px - hw, pz - hd); if (t > m) { m = t; }
    return m;
  }
  var _cur = _maxY(P.x, P.z);
  var _nxt = _maxY(x, z);
  if (_nxt <= _cur + 0.03) { return true; }        // ★ 没变高 → 放行（往外走 / 沿墙滑）
  return (_nxt - P.y) <= TER.STEP_WALK * TER.LEVEL_H + 0.03;
}
function moveWithCollision(dx, dz, hw, hd, byMob, skipMob) {
  var ox = P.x, oz = P.z;                 // ★ 移动前的位置（传给 blocked 做"已经重叠就放行"判断 ✓）
  var nx = ox + dx, nz = oz + dz;
  if (!blocked(nx, oz, hw, hd, byMob, skipMob, ox, oz) && terrainStepOk(nx, oz)) { P.x = nx; }
  if (!blocked(P.x, nz, hw, hd, byMob, skipMob, P.x, oz) && terrainStepOk(P.x, nz)) { P.z = nz; }
}
function findOpenSpot(x, z, hw, hd) {
  if (!blocked(x, z, hw, hd, false)) { return [x, z]; }
  for (var ring = 1; ring <= 24; ring++) {
    for (var a = 0; a < 16; a++) {
      var ang = a / 16 * Math.PI * 2;
      var nx = x + Math.cos(ang) * ring * G.TS, nz = z + Math.sin(ang) * ring * G.TS;
      if (!blocked(nx, nz, hw, hd, false)) { return [nx, nz]; }
    }
  }
  return [x, z];
}

/* ============================================================================
   ★★★ 地形：竖直方向（跳 / 掉 / 掉血）★★★
   每帧调一次 ✓ 放在移动之后（先用新的 x/z 算脚下高度 ✓）
   ★ 掉落伤害先由客户端算（P3 挪到服务端 ✓ 见方案 §4.1）
   ============================================================================ */
function terrainV(dt) {
  var gy = supportYAt(P.x, P.z);
  if (jumpCD > 0) { jumpCD = Math.max(0, jumpCD - dt); }

  /* ① 起跳（只在地面 + 冷却好了 ✓） */
  if (jumpHeld && !P.air && jumpCD <= 0 && !dead) {
    P.vy = TER.JUMP_V;
    P.air = true;
    P.airY = gy;
    jumpCD = 0.15;
    jumpHeld = 0;
    /* ★★★ round309（用户："跳一下，人物模型变大了，我要的是动画看起来跳得更高"）★★★
       自测踩到：我上一版用的是【拉伸模型】（0.90/1.16）✗
         → 玩家看到的是"人变大了"✗ 不是"跳得更高"✓
       改：不动模型尺寸 ✗ 改成【把模型画得比实际位置更高】✓
         ★ 玩法高度还是 1.15 格（跳不上 2 格墙 ✓）
           只是视觉上多给一段 ✓ 手感好看 ✗ 但不影响判定 ✓ */
    P.jumping = true;
  }

  if (!P.air) {
    /* ② 站在地上：跟着地形走 ✓ */
    if (gy < P.y - TER.STEP_WALK * TER.LEVEL_H - 0.05) {
      /* 脚下突然没地了 → 掉下去（不是走下来的 ✗ 是走出边缘 ✓） */
      P.air = true;
      P.vy = 0;
      P.airY = P.y;
    } else {
      P.y = gy;                       // 上小坡 / 站平地：直接贴地 ✓
    }
  }

  if (P.air) {
    /* ③ 空中：重力积分 */
    P.vy -= TER.GRAV * dt;
    P.y += P.vy * dt;
    if (P.y <= gy && P.vy <= 0) {
      /* ④ 落地 ✗ 算落差 ✓ */
      var drop = (P.airY - gy) / TER.LEVEL_H;      // 层
      P.y = gy;
      P.air = false;
      P.vy = 0;
      P.jumping = false;
      /* ★ 落地声（落差越大越响 ✗ 小跳也能听见 ✓）*/
      if (typeof sfx === 'function') {
        /* ★ round315（用户：落地声有点小，要拉满才听得见）：两个原因一起修 ——
           ① 音频文件本身峰值只有 -4.5dB ✓ 已归一到 -0.4dB（和现有音效一致）
           ② 这里音量给太低（0.45 起）✓ 抬到 0.85 起 ✓ */
        /* ★ round327（用户："点得越好越明显"→ 开销按点击次数累加）
           ★ 每跳一次就播一次落地音 ✗ 点得越快音频节点建得越密 ✓
           ★ 加 150ms 节流：连点时不每次都建新节点 ✓
             （150ms 内的第二次落地本来也听不出来 ✓）*/
        var _nowMs = performance.now();
        if (_nowMs - (lastLandSfx || 0) > 150) {
          lastLandSfx = _nowMs;
          sfx('land', Math.min(1.0, 0.85 + drop * 0.05));
        }
      }
      if (drop >= FALL_MIN && !dead) {
        var n = Math.floor(drop) - 2;              // 落差 3 → 1 格 ✓
        var dv = n * FALL_DMG;
        if (dv > 0) {
          /* ★ round325（用户："我摔伤也有两个飘字，改成保留红色的就可以了"）
             根因和岩浆那次一模一样：本地弹一个白字 + 服务端 hurts 回来弹一个红字 ✓
             修：本地不弹 ✗ 让服务端的红字显示 ✓ */
          shake = 0.25;
          wsSend('falldmg', { d: dv });
        }
      }
    }
  }
  P.gy = gy;
  /* ★ 住宅真实二楼：楼梯/LOFT 抬高脚底 */
  var _vh = (typeof townVillaAt === 'function') ? townVillaAt(P.x, P.z) : null;
  if (_vh) {
    var _fy = townVillaFloor(P.x, P.z, _vh);
    if (_fy > 0.04) {
      P.gy = _fy;
      P.y = _fy;
      P.air = false; P.vy = 0; P.jumping = false;
      VIL_FLOOR = _fy;
    } else if (VIL_FLOOR > 0.04) {
      P.gy = 0; if (!P.air) { P.y = 0; }
      VIL_FLOOR = 0;
    }
  } else if (VIL_FLOOR > 0.04) {
    P.gy = 0; if (!P.air) { P.y = 0; }
    VIL_FLOOR = 0;
  }

  /* ★ F0 地火烫伤（方案 §6）：站在地火上每 0.5 秒掉一次 ✓
     ★ 复用 falldmg 那条路 ✗ 不新增协议 ✓ 服务端照样会夹住 ✓ */
  var _fkind = terFluid(Math.floor(P.x / TER.LEVEL_H), Math.floor(P.z / TER.LEVEL_H));
  P.onLava = (_fkind === 3);
  /* ★ 在水里：人物下沉一点点（像站在浅水里 ✓）✗ 走动时溅涟漪 ✓ */
  P.inWater = (_fkind === 1 || _fkind === 2);
  if (P.inWater && !P.air) {
    _waterT = (_waterT || 0) - dt;
    if (_waterT <= 0 && Math.hypot(MOV.vx, MOV.vz) > 0.8) {
      _waterT = 0.34;
      var _wy = terFluidY(Math.floor(P.x / TER.LEVEL_H), Math.floor(P.z / TER.LEVEL_H));
      terRipple(P.x, P.z, (_wy === null ? P.y : _wy));
      if (typeof sfx === 'function') { sfx('step', 0.5); }
    }
  }
  if (P.onLava && !P.air && !dead) {
    P.lavaT = (P.lavaT || 0) - dt;
    if (P.lavaT <= 0) {
      P.lavaT = 0.5;
      /* ★ round322（用户："我进岩浆掉血会显示两个伤害飘字，保留红色的就行"）
         ★ 根因：这里本地又弹了一个（白字），服务端 hurts 回来还会再弹一个（红字）✓
         ★ 修：本地不弹数字 ✗ 只发请求 ✓ 让服务端的红字来显示 ✓ */
      shake = 0.18;
      wsSend('falldmg', { d: 5 });
    }
  } else {
    P.lavaT = 0;
  }
}

/* ============================================================
   ★ 音效系统（播放 Minecraft 原版音效 ✓ 31 个 ogg · 287KB ✓）
   ============================================================ */


/* loadSfx 已搬到 platform/web.js */


/* 尝试加载音频：mp3 → ogg → wav 三级回退 ✓ 全过程记录 ✓ */
var SFX_ERR = [];

/* tryOne 已搬到 platform/web.js */

function nextTry(key, attempt) {
  /* ★★ round445：顺序改成 ogg(1) → mp3(0) → wav(2) ✗
     为什么：ogg 每个 5~14KB，wav 是 50~140KB（同一段音效）✗
     解码都是一次性的，播放时都是内存里的 AudioBuffer ✗ 所以听感一样 ✓ */
  /* ★ 一定要写成"没就跳过"✗ 不然新加的键（比如 thunder，只有 wav）
     mp3 表里查不到 → 直接判"全部失败" ✗ 雷声就没了 ✗✗ */
  if (attempt === 1 && SFX_FILES[key] && SFX_FILES[key][0]) { tryOne(key, '/assets/sfx/' + SFX_FILES[key][0], 0); }
  else if (attempt !== 2 && SFX_FILES_WAV[key] && SFX_FILES_WAV[key][0]) { tryOne(key, '/assets/sfx/' + SFX_FILES_WAV[key][0], 2); }
  else { SFX_ERR.push(key + ':全部失败'); }
}

/* 首次触摸解锁（浏览器要求 ✓）· 播一个极短静音 ✓ */
var _audioUnlocked = false;
function unlockAudio() {
  if (_audioUnlocked) { return; }
  if (SFX_LOADED === 0) { E('音效加载中…请稍等 2 秒再点攻击'); setTimeout(function () { E(''); }, 2500); }
  _audioUnlocked = true;
  // 依次尝试播放每个类别的第 1 个（极短播放 → 立即暂停 ✓ 用于解锁 ✓）
  var keys = Object.keys(SFX_BANK);
  for (var i = 0; i < keys.length; i++) {
    var arr = SFX_BANK[keys[i]];
    if (!arr || !arr.length) { continue; }
    var a = arr[0];
    try {
      a.volume = 0.0001;
      var p = a.play();
      if (p && p.then) {
        p.then(function () { try { a.pause(); a.currentTime = 0; a.volume = SFX_VOL; } catch (e) { } })
         .catch(function () { try { a.volume = SFX_VOL; } catch (e) { } });
      }
    } catch (e) { }
  }
}

/* ★ 远处的动静按距离衰减 ✓ 太远就不放 ✓
   —— "声音同步"的关键：道友在隔壁砍怪你能听见 ✓ 但隔半张图就不该吵到你 ✓ */
function sfxAt(name, x, z, base) {
  if (!SFX_ON) { return; }
  var d = Math.hypot((x - P.x), (z - P.z));
  /* ★ round584（用户）：30 米外听不到；每 2 米一档，越远越小 */
  if (d >= 30) { return; }
  var seg = Math.floor(d / 2);          // 0..14
  var k = 1 - seg / 15;                 // 0~2m 正常，28~30m 最小
  if (k < 0.03) { return; }
  sfx(name, (base || 1) * k);
}

/* 播放（随机变体 ✓ 40ms 去重 ✓）*/
var SFX_QUEUE = [];        // ★ 未加载完时的排队（加载完补播 ✓）

/* sfx 已搬到 platform/web.js */

/* 加载完成后补播排队的音效 ✓ */
function flushQueue() {
  if (!SFX_QUEUE.length) { return; }
  var q = SFX_QUEUE.slice();
  SFX_QUEUE = [];
  var now = performance.now();
  for (var i = 0; i < q.length; i++) {
    if (now - q[i].t < 1500) { sfx(q[i].n, q[i].v); }   // 1.5 秒内的才补播（太久的不补 ✓ 避免奇怪 ✓）
  }
}

/* ==================== SKINS BEGIN（由 tools/patch_skins.js 生成，别手改） ==================== */
/* 40 个皮肤的数据（由 tools/gen_skin_defs.js 从预览页生成 -- 不要手改）
   纯数据：没有 DOM、没有事件。字段：
   k=key n=名字 sx=体型说明 g=性别 sk=骨架参数 c=配色
   hair=发型 eyes=眼睛尺寸 outfit=服装 acc=配件 skirt=裙/袍 pin=发饰 */
var SKIN_DEFS = {
  "f01": {"k":"f01","n":"双马尾剑士","sx":"女 · 1.00","g":"f","sk":{"legW":0.22,"armW":0.18,"torsoW":0.82,"torsoD":0.52,"headW":1.03,"headH":0.99},"c":{"skin":16769228,"hair":14703194,"shirt":16054010,"shirtD":14212326,"pants":2764346,"boot":2764346,"belt":2238000,"gold":16765286,"collar":3824296,"iris":13647968,"sock":15790840,"apron":null,"skirt":2765896,"hair2":16743034,"hairS":10568001,"skinS":15125176,"shirtS":13488082,"skirtS":2239034,"iris2":8464444},"hair":"twintail","eyes":{"w":0.3,"h":0.34,"blush":1},"outfit":"sailor","skirt":{"top":0.92,"bot":1.34,"len":0.62,"seg":8},"pin":16765286},
  "f02": {"k":"f02","n":"巫女","sx":"女 · 1.02","g":"f","sk":{"legW":0.23,"armW":0.18,"torsoW":0.84,"torsoD":0.52,"headW":1.01,"headH":0.97},"c":{"skin":16769228,"hair":1710626,"shirt":16514047,"shirtD":15132398,"pants":14169132,"boot":2764346,"belt":2238000,"gold":16777215,"collar":16514047,"iris":9054778,"sock":16777215,"apron":null,"skirt":14169132,"hair2":2302766,"hairS":1250072,"skinS":15125176,"shirtS":13882326,"skirtS":11348515,"iris2":5642788},"hair":"hime","eyes":{"w":0.28,"h":0.32,"blush":1},"outfit":"miko","skirt":{"top":0.86,"bot":1.3,"len":0.86},"pin":14169132},
  "f03": {"k":"f03","n":"女仆","sx":"女 · 0.98","g":"f","sk":{"legW":0.22,"armW":0.17,"torsoW":0.8,"torsoD":0.5,"headW":1.01,"headH":0.97},"c":{"skin":16769228,"hair":9067066,"shirt":2763830,"shirtD":1842726,"pants":1316122,"boot":2764346,"belt":2238000,"gold":16777215,"collar":16777215,"iris":4885200,"sock":16054010,"apron":16316924,"skirt":1974054,"hair2":12221006,"hairS":6504746,"skinS":15125176,"shirtS":2303277,"skirtS":1579294,"iris2":3036801},"hair":"twintail","eyes":{"w":0.3,"h":0.34,"blush":1},"outfit":"maid","skirt":{"top":0.9,"bot":1.32,"len":0.6},"pin":16777215},
  "f04": {"k":"f04","n":"精灵射手","sx":"女 · 1.06","g":"f","sk":{"hipY":1,"legW":0.21,"armW":0.17,"armLen":1.02,"torsoW":0.78,"torsoD":0.48,"headW":0.95,"headH":0.92},"c":{"skin":16769228,"hair":15784072,"shirt":3832394,"shirtD":2776120,"pants":2767406,"boot":2764346,"belt":2238000,"gold":14205024,"collar":9097376,"iris":3842160,"sock":6982234,"apron":null,"skirt":2776120,"hair2":16777144,"hairS":11377762,"skinS":15125176,"shirtS":3237438,"skirtS":2247213,"iris2":2384709},"hair":"long","eyes":{"w":0.26,"h":0.3},"outfit":"plain","acc":"elfEar","skirt":{"top":0.8,"bot":1.06,"len":0.56}},
  "f05": {"k":"f05","n":"猫耳少女","sx":"女 · 0.94","g":"f","sk":{"hipY":0.84,"legW":0.22,"armW":0.17,"armLen":0.88,"torsoH":0.92,"torsoW":0.84,"torsoD":0.54,"headW":1.04,"headH":0.99},"c":{"skin":16769228,"hair":13134394,"shirt":15788252,"shirtD":14208184,"pants":3814472,"boot":2764346,"belt":2238000,"gold":16765286,"collar":16777215,"iris":14196784,"sock":2763312,"apron":null,"skirt":3814472,"hair2":16748366,"hairS":9456682,"skinS":15125176,"shirtS":13288377,"skirtS":3025466,"iris2":8807198},"hair":"bob","eyes":{"w":0.3,"h":0.34,"blush":1},"outfit":"hoodie","acc":"catEar","skirt":{"top":0.88,"bot":1.14,"len":0.46}},
  "f06": {"k":"f06","n":"水手服少女","sx":"女 · 1.00","g":"f","sk":{"legW":0.22,"armW":0.17,"torsoW":0.82,"torsoD":0.5,"headW":1.01,"headH":0.97},"c":{"skin":16769228,"hair":2763322,"shirt":16448767,"shirtD":15001840,"pants":2765904,"boot":2764346,"belt":2238000,"gold":16738954,"collar":2765904,"iris":5929680,"sock":16777215,"apron":null,"skirt":2765904,"hair2":3750222,"hairS":1973802,"skinS":15125176,"shirtS":13817046,"skirtS":2239040,"iris2":3689601},"hair":"bob","eyes":{"w":0.28,"h":0.32},"outfit":"sailor","skirt":{"top":0.92,"bot":1.32,"len":0.58}},
  "f07": {"k":"f07","n":"魔法少女","sx":"女 · 0.96","g":"f","sk":{"hipY":0.88,"legW":0.21,"armW":0.16,"armLen":0.9,"torsoH":0.94,"torsoW":0.82,"torsoD":0.52,"headW":1.04,"headH":1.01},"c":{"skin":16769228,"hair":15760040,"shirt":16773880,"shirtD":15782112,"pants":15760040,"boot":2764346,"belt":2238000,"gold":16769126,"collar":16747192,"iris":16734874,"sock":16777215,"apron":null,"skirt":16747192,"hair2":16754147,"hairS":11360377,"skinS":15125176,"shirtS":14076880,"skirtS":13397651,"iris2":10369119},"hair":"twintail","eyes":{"w":0.32,"h":0.36,"blush":1},"outfit":"frill","skirt":{"top":0.96,"bot":1.4,"len":0.54},"pin":16769126},
  "f08": {"k":"f08","n":"吸血鬼萝莉","sx":"女 · 0.90","g":"f","sk":{"hipY":0.8,"legW":0.21,"armW":0.16,"armLen":0.84,"torsoH":0.88,"torsoW":0.8,"torsoD":0.5,"headW":1.06,"headH":1.03},"c":{"skin":16510706,"hair":4860996,"shirt":3810360,"shirtD":2364968,"pants":1708064,"boot":2764346,"belt":2238000,"gold":13647952,"collar":13647952,"iris":13639728,"sock":1708064,"apron":null,"skirt":1708064,"hair2":6568796,"hairS":3481649,"skinS":14866138,"shirtS":3218991,"skirtS":1379610,"iris2":8459294},"hair":"long","eyes":{"w":0.32,"h":0.36},"outfit":"dress","acc":"batWing","skirt":{"top":0.94,"bot":1.28,"len":0.52}},
  "f09": {"k":"f09","n":"女骑士","sx":"女 · 1.05","g":"f","sk":{"hipY":0.98,"legW":0.26,"armW":0.21,"torsoW":0.88,"torsoD":0.58,"headW":0.95,"headH":0.94},"c":{"skin":16769228,"hair":14203000,"shirt":12108496,"shirtD":9740464,"pants":6976644,"boot":2764346,"belt":2238000,"gold":15782000,"collar":14674164,"iris":4881088,"sock":5923440,"apron":null,"skirt":6976644,"hair2":16775330,"hairS":10257494,"skinS":15125176,"shirtS":10199983,"skirtS":5594474,"iris2":3034231},"hair":"ponytail","eyes":{"w":0.26,"h":0.3},"outfit":"armorkirt","acc":"cape","skirt":{"top":0.88,"bot":1.16,"len":0.62}},
  "f10": {"k":"f10","n":"剑道少女","sx":"女 · 1.00","g":"f","sk":{"legW":0.24,"armW":0.19,"torsoW":0.86,"torsoD":0.54,"headW":0.99,"headH":0.95},"c":{"skin":16769228,"hair":2236970,"shirt":16316668,"shirtD":14737640,"pants":2763316,"boot":2764346,"belt":2238000,"gold":16777215,"collar":2763316,"iris":4868698,"sock":16316668,"apron":null,"skirt":2763316,"hair2":3026489,"hairS":1579038,"skinS":15125176,"shirtS":13684948,"skirtS":2236970,"iris2":3026488},"hair":"ponytail","eyes":{"w":0.26,"h":0.3},"outfit":"kendo","acc":"headband","skirt":{"top":0.88,"bot":1.28,"len":0.92}},
  "f11": {"k":"f11","n":"修女","sx":"女 · 1.02","g":"f","sk":{"hipY":0.94,"legW":0.23,"armW":0.18,"torsoW":0.84,"torsoD":0.52,"headW":0.99,"headH":0.95},"c":{"skin":16508632,"hair":2236970,"shirt":3026488,"shirtD":1973798,"pants":1973796,"boot":2764346,"belt":2238000,"gold":14674164,"collar":16054010,"iris":6982336,"sock":1973796,"apron":null,"skirt":1579039,"hair2":3026489,"hairS":1579038,"skinS":14864322,"shirtS":2565935,"skirtS":1250073,"iris2":4347511},"hair":"veil","eyes":{"w":0.26,"h":0.3},"outfit":"nun","skirt":{"top":0.9,"bot":1.3,"len":0.94}},
  "f12": {"k":"f12","n":"机械少女","sx":"女 · 1.00","g":"f","sk":{"legW":0.23,"armW":0.19,"torsoW":0.84,"torsoD":0.54,"headW":0.99,"headH":0.95},"c":{"skin":15918816,"hair":5949664,"shirt":2764856,"shirtD":1975340,"pants":2370098,"boot":2764346,"belt":2238000,"gold":16723872,"collar":712928,"iris":712928,"sock":2764856,"apron":null,"skirt":2370098,"hair2":8060927,"hairS":4296865,"skinS":14340042,"shirtS":2304047,"skirtS":1909288,"iris2":428939},"hair":"short","eyes":{"w":0.28,"h":0.32},"outfit":"mech","acc":"visor","skirt":{"top":0.92,"bot":1.2,"len":0.44}},
  "f13": {"k":"f13","n":"狐仙","sx":"女 · 1.04","g":"f","sk":{"hipY":0.96,"legW":0.22,"armW":0.17,"torsoW":0.82,"torsoD":0.52,"headW":1.01,"headH":0.97},"c":{"skin":16769228,"hair":12167394,"shirt":16643323,"shirtD":15389928,"pants":14206184,"boot":2764346,"belt":2238000,"gold":13658784,"collar":13658784,"iris":13658784,"sock":16777215,"apron":null,"skirt":15389934,"hair2":16442367,"hairS":8747427,"skinS":15125176,"shirtS":14011859,"skirtS":12298942,"iris2":8471139},"hair":"long","eyes":{"w":0.28,"h":0.32,"blush":1},"outfit":"hanfu","acc":"foxEar","skirt":{"top":0.84,"bot":1.18,"len":0.7}},
  "f14": {"k":"f14","n":"学生会长","sx":"女 · 1.02","g":"f","sk":{"legW":0.22,"armW":0.17,"torsoW":0.82,"torsoD":0.5,"headW":0.99,"headH":0.95},"c":{"skin":16769228,"hair":2761792,"shirt":16448767,"shirtD":14870254,"pants":2764346,"boot":2764346,"belt":2238000,"gold":16765286,"collar":2764346,"iris":10119888,"sock":1973796,"apron":null,"skirt":2764346,"hair2":3748182,"hairS":1972782,"skinS":15125176,"shirtS":13817046,"skirtS":2237742,"iris2":6242945},"hair":"hime","eyes":{"w":0.28,"h":0.32},"outfit":"sailor","acc":"glasses","skirt":{"top":0.92,"bot":1.3,"len":0.58}},
  "f15": {"k":"f15","n":"拳击少女","sx":"女 · 1.00","g":"f","sk":{"legW":0.25,"armW":0.21,"torsoW":0.84,"torsoD":0.54,"headW":0.99,"headH":0.95},"c":{"skin":16769228,"hair":14178346,"shirt":15790840,"shirtD":14211812,"pants":14178346,"boot":2764346,"belt":2238000,"gold":16765286,"collar":14178346,"iris":14196768,"sock":15790840,"apron":null,"skirt":14178346,"hair2":16742201,"hairS":10239774,"skinS":15125176,"shirtS":13290448,"skirtS":11355682,"iris2":8807188},"hair":"ponytail","eyes":{"w":0.28,"h":0.32},"outfit":"sport","acc":"gloves","skirt":{"top":0.94,"bot":1.18,"len":0.4}},
  "f16": {"k":"f16","n":"弓道少女","sx":"女 · 1.02","g":"f","sk":{"hipY":0.96,"legW":0.23,"armW":0.18,"torsoW":0.82,"torsoD":0.52,"headW":0.99,"headH":0.95},"c":{"skin":16769228,"hair":3811882,"shirt":16514047,"shirtD":15263984,"pants":3026490,"boot":2764346,"belt":2238000,"gold":15263984,"collar":3026490,"iris":6965818,"sock":16514047,"apron":null,"skirt":3026490,"hair2":5126457,"hairS":2760222,"skinS":15125176,"shirtS":13882326,"skirtS":2434350,"iris2":4337188},"hair":"hime","eyes":{"w":0.26,"h":0.3},"outfit":"kendo","acc":"ribbon","skirt":{"top":0.88,"bot":1.3,"len":0.96}},
  "f17": {"k":"f17","n":"丧尸少女","sx":"女 · 0.98","g":"f","sk":{"legW":0.23,"armW":0.17,"torsoW":0.82,"torsoD":0.52,"headW":1.01,"headH":0.97},"c":{"skin":14212296,"hair":3820090,"shirt":14212320,"shirtD":12106948,"pants":3818576,"boot":2764346,"belt":2238000,"gold":9054762,"collar":3818576,"iris":9093226,"sock":2764342,"apron":null,"skirt":3818576,"hair2":5137486,"hairS":2766122,"skinS":12764852,"shirtS":11909564,"skirtS":3028544,"iris2":5666626},"hair":"long","eyes":{"w":0.3,"h":0.34},"outfit":"sailor","acc":"blood","skirt":{"top":0.92,"bot":1.28,"len":0.56}},
  "f18": {"k":"f18","n":"天使","sx":"女 · 1.04","g":"f","sk":{"hipY":0.98,"legW":0.22,"armW":0.17,"torsoW":0.84,"torsoD":0.52,"headW":0.99,"headH":0.95},"c":{"skin":16769228,"hair":15912798,"shirt":16645631,"shirtD":14673138,"pants":16645631,"boot":2764346,"belt":2238000,"gold":16769126,"collar":15912798,"iris":5941472,"sock":16777215,"apron":null,"skirt":15659772,"hair2":16777087,"hairS":11441476,"skinS":15125176,"shirtS":14013910,"skirtS":12501706,"iris2":3696779},"hair":"long","eyes":{"w":0.28,"h":0.32},"outfit":"dress","acc":"halo","skirt":{"top":0.86,"bot":1.36,"len":0.98}},
  "f19": {"k":"f19","n":"恶魔","sx":"女 · 1.02","g":"f","sk":{"hipY":0.94,"legW":0.23,"armW":0.18,"torsoW":0.84,"torsoD":0.52,"headW":0.99,"headH":0.95},"c":{"skin":16769228,"hair":3810354,"shirt":4989492,"shirtD":3282986,"pants":1970200,"boot":2764346,"belt":2238000,"gold":16734826,"collar":13643856,"iris":16730714,"sock":1970200,"apron":null,"skirt":1970200,"hair2":5124420,"hairS":2759204,"skinS":15125176,"shirtS":4201772,"skirtS":1576211,"iris2":10366520},"hair":"twintail","eyes":{"w":0.3,"h":0.34},"outfit":"dress","acc":"demonHorn","skirt":{"top":0.92,"bot":1.3,"len":0.58},"pin":16734826},
  "f20": {"k":"f20","n":"雪女","sx":"女 · 1.03","g":"f","sk":{"hipY":0.98,"legW":0.21,"armW":0.16,"torsoW":0.8,"torsoD":0.5,"headW":0.97,"headH":0.94},"c":{"skin":16769228,"hair":9356008,"shirt":15398655,"shirtD":12376304,"pants":11061480,"boot":2764346,"belt":2238000,"gold":12574968,"collar":6990040,"iris":4889296,"sock":16777215,"apron":null,"skirt":14478586,"hair2":12648447,"hairS":6720679,"skinS":15125176,"shirtS":12963798,"skirtS":11582920,"iris2":3039105},"hair":"long","eyes":{"w":0.26,"h":0.3},"outfit":"hanfu","acc":"snow","skirt":{"top":0.84,"bot":1.36,"len":1}},
  "m01": {"k":"m01","n":"熔岩魔修","sx":"男 · 壮硕 · 1.10","g":"m","sk":{"hipY":0.86,"legW":0.4,"torsoH":1.04,"torsoW":1.22,"torsoD":0.78,"armLen":0.98,"armW":0.38,"headW":1.08,"headH":1},"c":{"skin":9061426,"hair":2757136,"shirt":3810332,"shirtD":2364945,"pants":2101774,"boot":2764346,"belt":16738848,"gold":16752704,"collar":3809304,"iris":4858648,"sock":null,"apron":null,"skirt":2101774,"hair2":3741718,"hairS":1969420,"skinS":8142125,"shirtS":3218968,"skirtS":1707531,"iris2":3020303},"hair":"bald","eyes":{"w":0.24,"h":0.24},"outfit":"plain","acc":"lava"},
  "m02": {"k":"m02","n":"侏儒炼金师","sx":"男 · 矮小 · 0.74","g":"m","sk":{"hipY":0.58,"legW":0.3,"torsoH":0.7,"torsoW":0.94,"torsoD":0.64,"armLen":0.66,"armW":0.26,"headW":1.28,"headH":1.18},"c":{"skin":15254682,"hair":12632264,"shirt":6969994,"shirtD":5128808,"pants":3814472,"boot":2764346,"belt":9075274,"gold":14205040,"collar":10128064,"iris":2763312,"sock":null,"apron":null,"skirt":3814472,"hair2":16777215,"hairS":9079440,"skinS":13742219,"shirtS":5852276,"skirtS":3025466,"iris2":1710622},"hair":"messy","eyes":{"w":0.26,"h":0.26},"outfit":"plain","acc":"goggles"},
  "m03": {"k":"m03","n":"僵尸王","sx":"男 · 驼背长臂 · 1.05","g":"m","sk":{"hipY":0.8,"legW":0.34,"torsoH":0.96,"torsoW":1.06,"torsoD":0.66,"armLen":1.16,"armW":0.32,"headW":1.08,"headH":1.02},"c":{"skin":10465418,"hair":3814440,"shirt":7039578,"shirtD":4868668,"pants":4868668,"boot":2764346,"belt":3815470,"gold":9054762,"collar":8026728,"iris":3358762,"sock":null,"apron":null,"skirt":4868668,"hair2":5129782,"hairS":2762013,"skinS":9412220,"shirtS":5921100,"skirtS":3881776,"iris2":2107418},"hair":"messy","eyes":{"w":0.26,"h":0.26},"outfit":"plain","acc":"blood"},
  "m04": {"k":"m04","n":"赤膊狂战","sx":"男 · 粗壮 · 1.09","g":"m","sk":{"hipY":0.82,"legW":0.42,"torsoH":1.02,"torsoW":1.28,"torsoD":0.82,"armLen":1,"armW":0.42,"headW":1.1,"headH":1.02},"c":{"skin":14263928,"hair":9054746,"shirt":14263928,"shirtD":12617816,"pants":6965802,"boot":2764346,"belt":4860442,"gold":9054746,"collar":14263928,"iris":3811866,"sock":null,"apron":null,"skirt":6965802,"hair2":12204323,"hairS":6495763,"skinS":12817772,"shirtS":11963237,"skirtS":5585698,"iris2":2365968},"hair":"bald","eyes":{"w":0.24,"h":0.24},"outfit":"sport","acc":"gloves"},
  "m05": {"k":"m05","n":"龙裔","sx":"男 · 高壮 · 1.12","g":"m","sk":{"hipY":0.98,"legW":0.38,"torsoH":1.06,"torsoW":1.2,"torsoD":0.74,"armLen":1.02,"armW":0.36,"headW":1.06,"headH":1},"c":{"skin":9089136,"hair":1714714,"shirt":3828298,"shirtD":2773048,"pants":2771508,"boot":2764346,"belt":14205024,"gold":14205024,"collar":14205024,"iris":3814424,"sock":null,"apron":null,"skirt":2771508,"hair2":2308387,"hairS":1252883,"skinS":8167013,"shirtS":3234110,"skirtS":2243370,"iris2":2367503},"hair":"messy","eyes":{"w":0.26,"h":0.26},"outfit":"robe","acc":"demonHorn"},
  "m06": {"k":"m06","n":"少年剑士","sx":"男 · 少年 · 0.88","g":"m","sk":{"hipY":0.74,"legW":0.3,"torsoH":0.86,"torsoW":0.96,"torsoD":0.6,"armLen":0.82,"armW":0.26,"headW":1.14,"headH":1.1},"c":{"skin":16769228,"hair":3811866,"shirt":14200928,"shirtD":11569722,"pants":6969914,"boot":2764346,"belt":6965802,"gold":16765286,"collar":15784080,"iris":3025446,"sock":null,"apron":null,"skirt":6969914,"hair2":5126435,"hairS":2760211,"skinS":15125176,"shirtS":11899985,"skirtS":5589038,"iris2":1907224},"hair":"topknot","eyes":{"w":0.28,"h":0.28},"outfit":"kendo"},
  "m07": {"k":"m07","n":"学园不良","sx":"男 · 少年 · 0.94","g":"m","sk":{"hipY":0.86,"legW":0.3,"torsoH":0.96,"torsoW":1,"torsoD":0.62,"armLen":0.9,"armW":0.26,"headW":1.08,"headH":1.04},"c":{"skin":16769228,"hair":2763312,"shirt":2764346,"shirtD":1974828,"pants":2237998,"boot":2764346,"belt":1382172,"gold":12595248,"collar":3817552,"iris":2762288,"sock":null,"apron":null,"skirt":2237998,"hair2":3750209,"hairS":1973795,"skinS":15125176,"shirtS":2303793,"skirtS":1777189,"iris2":1710110},"hair":"spiky","eyes":{"w":0.26,"h":0.26},"outfit":"sailor"},
  "m08": {"k":"m08","n":"和风武士","sx":"男 · 精瘦 · 1.04","g":"m","sk":{"hipY":0.94,"legW":0.28,"torsoH":1,"torsoW":0.92,"torsoD":0.58,"armLen":0.98,"armW":0.24,"headW":1.04,"headH":1},"c":{"skin":16769228,"hair":1710624,"shirt":2767450,"shirtD":1976900,"pants":3816004,"boot":2764346,"belt":9050650,"gold":14674164,"collar":14674164,"iris":2500142,"sock":null,"apron":null,"skirt":3816004,"hair2":2302763,"hairS":1250071,"skinS":15125176,"shirtS":2306380,"skirtS":3026486,"iris2":1579037},"hair":"topknot","eyes":{"w":0.24,"h":0.24},"outfit":"robe"},
  "m09": {"k":"m09","n":"忍者","sx":"男 · 精瘦 · 1.00","g":"m","sk":{"hipY":0.9,"legW":0.26,"torsoH":0.98,"torsoW":0.88,"torsoD":0.56,"armLen":0.96,"armW":0.23,"headW":1.04,"headH":1.02},"c":{"skin":16769228,"hair":1710626,"shirt":2304568,"shirtD":1514534,"pants":1580584,"boot":2764346,"belt":6957610,"gold":6957610,"collar":3029582,"iris":2304562,"sock":null,"apron":null,"skirt":1580584,"hair2":2302766,"hairS":1250072,"skinS":15125176,"shirtS":1909551,"skirtS":1251360,"iris2":1448479},"hair":"hood","eyes":{"w":0.24,"h":0.24},"outfit":"ninja","acc":"visor"},
  "m10": {"k":"m10","n":"道士少年","sx":"男 · 瘦高 · 1.02","g":"m","sk":{"hipY":0.94,"legW":0.26,"torsoH":1,"torsoW":0.9,"torsoD":0.56,"armLen":0.98,"armW":0.23,"headW":1.04,"headH":1},"c":{"skin":16769228,"hair":2763314,"shirt":14210244,"shirtD":12104868,"pants":9079418,"boot":2764346,"belt":6982250,"gold":12626016,"collar":15789280,"iris":2764324,"sock":null,"apron":null,"skirt":9079418,"hair2":3750212,"hairS":1973796,"skinS":15125176,"shirtS":11907749,"skirtS":7237218,"iris2":1711382},"hair":"topknot","eyes":{"w":0.24,"h":0.24},"outfit":"robe"},
  "m11": {"k":"m11","n":"武僧","sx":"男 · 壮实 · 1.04","g":"m","sk":{"hipY":0.88,"legW":0.36,"torsoH":1,"torsoW":1.14,"torsoD":0.72,"armLen":0.98,"armW":0.34,"headW":1.06,"headH":1},"c":{"skin":14198904,"hair":2759188,"shirt":13148240,"shirtD":11042872,"pants":11042872,"boot":2764346,"belt":6965792,"gold":14729328,"collar":14729328,"iris":3024416,"sock":null,"apron":null,"skirt":11042872,"hair2":3744539,"hairS":1970958,"skinS":12752748,"shirtS":11044419,"skirtS":8807981,"iris2":1906708},"hair":"bald","eyes":{"w":0.24,"h":0.24},"outfit":"monk"},
  "m12": {"k":"m12","n":"魔法师","sx":"男 · 瘦高 · 1.02","g":"m","sk":{"hipY":0.94,"legW":0.26,"torsoH":1.02,"torsoW":0.88,"torsoD":0.56,"armLen":1,"armW":0.23,"headW":1.04,"headH":1},"c":{"skin":16769228,"hair":9075376,"shirt":3811930,"shirtD":2628672,"pants":2760768,"boot":2764346,"belt":9071296,"gold":14729312,"collar":12624096,"iris":2761780,"sock":null,"apron":null,"skirt":2760768,"hair2":12232174,"hairS":6510719,"skinS":15125176,"shirtS":3220300,"skirtS":2234931,"iris2":1709600},"hair":"long","eyes":{"w":0.24,"h":0.24},"outfit":"robe"},
  "m13": {"k":"m13","n":"骑士","sx":"男 · 魁梧 · 1.08","g":"m","sk":{"hipY":0.9,"legW":0.38,"torsoH":1.04,"torsoW":1.1,"torsoD":0.72,"armLen":1,"armW":0.34,"headW":1.06,"headH":1},"c":{"skin":16769228,"hair":6969914,"shirt":12108496,"shirtD":9082020,"pants":5923956,"boot":2764346,"belt":3817544,"gold":15782000,"collar":14674164,"iris":2764856,"sock":null,"apron":null,"skirt":5923956,"hair2":9402958,"hairS":4997418,"skinS":15125176,"shirtS":10199983,"skirtS":4739165,"iris2":1711651},"hair":"short","eyes":{"w":0.24,"h":0.24},"outfit":"armorkirt","acc":"cape"},
  "m14": {"k":"m14","n":"弓箭手","sx":"男 · 精瘦 · 1.00","g":"m","sk":{"hipY":0.9,"legW":0.28,"torsoH":0.98,"torsoW":0.92,"torsoD":0.58,"armLen":0.98,"armW":0.24,"headW":1.04,"headH":1},"c":{"skin":16769228,"hair":4864554,"shirt":4876858,"shirtD":3493930,"pants":3818546,"boot":2764346,"belt":6965802,"gold":12623968,"collar":9089136,"iris":2764326,"sock":null,"apron":null,"skirt":3818546,"hair2":6573625,"hairS":3484190,"skinS":15125176,"shirtS":4086065,"skirtS":3028520,"iris2":1711384},"hair":"messy","eyes":{"w":0.24,"h":0.24},"outfit":"plain"},
  "m15": {"k":"m15","n":"机甲少年","sx":"男 · 偏高 · 1.04","g":"m","sk":{"hipY":0.94,"legW":0.34,"torsoH":1.02,"torsoW":1.04,"torsoD":0.66,"armLen":0.98,"armW":0.3,"headW":1.04,"headH":1},"c":{"skin":16769228,"hair":3820122,"shirt":2765372,"shirtD":1975854,"pants":2239026,"boot":2764346,"belt":1712168,"gold":3858656,"collar":3842272,"iris":2241338,"sock":null,"apron":null,"skirt":2239026,"hair2":5137530,"hairS":2766145,"skinS":15125176,"shirtS":2304562,"skirtS":1778216,"iris2":1384484},"hair":"short","eyes":{"w":0.24,"h":0.24},"outfit":"mech","acc":"visor"},
  "m16": {"k":"m16","n":"吸血鬼少年","sx":"男 · 瘦高 · 1.02","g":"m","sk":{"hipY":0.94,"legW":0.26,"torsoH":1,"torsoW":0.88,"torsoD":0.56,"armLen":0.98,"armW":0.23,"headW":1.04,"headH":1},"c":{"skin":15786212,"hair":3482166,"shirt":3810358,"shirtD":2364968,"pants":1708064,"boot":2764346,"belt":6953514,"gold":12595264,"collar":12595264,"iris":3350570,"sock":null,"apron":null,"skirt":1708064,"hair2":4730441,"hairS":2496551,"skinS":14207693,"shirtS":3218989,"skirtS":1379610,"iris2":2102298},"hair":"long","eyes":{"w":0.26,"h":0.26},"outfit":"robe","acc":"batWing"},
  "m17": {"k":"m17","n":"天使少年","sx":"男 · 清瘦 · 1.02","g":"m","sk":{"hipY":0.94,"legW":0.26,"torsoH":1,"torsoW":0.9,"torsoD":0.56,"armLen":0.98,"armW":0.23,"headW":1.04,"headH":1},"c":{"skin":16769228,"hair":15781984,"shirt":16645631,"shirtD":14673138,"pants":16054012,"boot":2764346,"belt":14205024,"gold":16769126,"collar":15781984,"iris":3025440,"sock":null,"apron":null,"skirt":15659772,"hair2":16777090,"hairS":11376197,"skinS":15125176,"shirtS":14013910,"skirtS":12501706,"iris2":1907220},"hair":"short","eyes":{"w":0.26,"h":0.26},"outfit":"robe","acc":"halo"},
  "m18": {"k":"m18","n":"恶魔少年","sx":"男 · 瘦高 · 1.02","g":"m","sk":{"hipY":0.92,"legW":0.28,"torsoH":1,"torsoW":0.92,"torsoD":0.58,"armLen":0.98,"armW":0.24,"headW":1.04,"headH":1},"c":{"skin":16769228,"hair":3809840,"shirt":5121076,"shirtD":3348522,"pants":1970200,"boot":2764346,"belt":6953514,"gold":16734826,"collar":13643856,"iris":3481640,"sock":null,"apron":null,"skirt":1970200,"hair2":5123649,"hairS":2758691,"skinS":15125176,"shirtS":4333100,"skirtS":1576211,"iris2":2167833},"hair":"spiky","eyes":{"w":0.26,"h":0.26},"outfit":"robe","acc":"demonHorn"},
  "m19": {"k":"m19","n":"狼人","sx":"男 · 魁梧 · 1.06","g":"m","sk":{"hipY":0.84,"legW":0.4,"torsoH":1.02,"torsoW":1.18,"torsoD":0.76,"armLen":1.08,"armW":0.36,"headW":1.1,"headH":1.02},"c":{"skin":9075304,"hair":5918792,"shirt":5918792,"shirtD":4537396,"pants":3814444,"boot":2764346,"belt":2761758,"gold":12623968,"collar":6971480,"iris":3354654,"sock":null,"apron":null,"skirt":3814444,"hair2":8023137,"hairS":4274740,"skinS":8154718,"shirtS":4997948,"skirtS":3025443,"iris2":2104851},"hair":"messy","eyes":{"w":0.26,"h":0.26},"outfit":"plain","acc":"gloves"},
  "m20": {"k":"m20","n":"亡灵法师","sx":"男 · 极瘦 · 0.98","g":"m","sk":{"hipY":0.92,"legW":0.22,"torsoH":1,"torsoW":0.82,"torsoD":0.52,"armLen":1,"armW":0.2,"headW":1.04,"headH":1.02},"c":{"skin":14736592,"hair":6978154,"shirt":2763830,"shirtD":1842726,"pants":1711138,"boot":2764346,"belt":5933674,"gold":7004320,"collar":3816004,"iris":2764840,"sock":null,"apron":null,"skirt":1711138,"hair2":9414031,"hairS":5003340,"skinS":13289147,"shirtS":2303277,"skirtS":1381915,"iris2":1711641},"hair":"short","eyes":{"w":0.26,"h":0.26},"outfit":"robe","acc":"blood"}
};
var SKIN_ORDER = ["f01", "f02", "f03", "f04", "f05", "f06", "f07", "f08", "f09", "f10", "f11", "f12", "f13", "f14", "f15", "f16", "f17", "f18", "f19", "f20", "m01", "m02", "m03", "m04", "m05", "m06", "m07", "m08", "m09", "m10", "m11", "m12", "m13", "m14", "m15", "m16", "m17", "m18", "m19", "m20"];
var SKIN_NAME = {"f01": "双马尾剑士", "f02": "巫女", "f03": "女仆", "f04": "精灵射手", "f05": "猫耳少女", "f06": "水手服少女", "f07": "魔法少女", "f08": "吸血鬼萝莉", "f09": "女骑士", "f10": "剑道少女", "f11": "修女", "f12": "机械少女", "f13": "狐仙", "f14": "学生会长", "f15": "拳击少女", "f16": "弓道少女", "f17": "丧尸少女", "f18": "天使", "f19": "恶魔", "f20": "雪女", "m01": "熔岩魔修", "m02": "侏儒炼金师", "m03": "僵尸王", "m04": "赤膊狂战", "m05": "龙裔", "m06": "少年剑士", "m07": "学园不良", "m08": "和风武士", "m09": "忍者", "m10": "道士少年", "m11": "武僧", "m12": "魔法师", "m13": "骑士", "m14": "弓箭手", "m15": "机甲少年", "m16": "吸血鬼少年", "m17": "天使少年", "m18": "恶魔少年", "m19": "狼人", "m20": "亡灵法师"};

/* ★★★ round485：皮肤系统（40 套）★★★
   数据在 core/skin_defs.js（纯数据 ✓）这里只负责"按数据搭模型" ✓
   ★ 关键约定（动画 / 武器 / 血条全都不改）：
       · 返回 { g, armL, armR, legL, legR, sw, swL, h }
       · armL/armR/legL/legR = 四个枢轴 Group，语义和老模型完全一致 ✓
         （手臂枢轴在肩、腿枢轴在髋、脚底在 y=0）
       · sw 挂在右手（handPivot 在手臂末端）✓ 攻击动画只转 sw ✓
       · h = 头顶高度（世界单位，未乘 HERO_SCALE）→ 名字/血条按它抬 ✓ */
/* ★ round510：比例调整开关（1 = 新比例 ✗ 0 = 老比例 ✓ 只给对比图用）*/
var SK_PROP_ADJUST = 1;
var SK_DEF = { hipY: 0.92, legW: 0.24, torsoH: 1.00, torsoW: 0.86, torsoD: 0.54,
               armLen: 0.96, armW: 0.19, armX: 0.56, headW: 1.10, headH: 1.06, headD: 1.02,
               neck: 0.02 };

function skShade(hex, k) {
  var r = (hex >> 16) & 255, g2 = (hex >> 8) & 255, b = hex & 255;
  r = Math.max(0, Math.min(255, Math.round(r * k)));
  g2 = Math.max(0, Math.min(255, Math.round(g2 * k)));
  b = Math.max(0, Math.min(255, Math.round(b * k)));
  return (r << 16) | (g2 << 8) | b;
}

/* 配色派生：高光/阴影各一份（做体积感用） */
function skPal(o) {
  var p = { skin: o.skin || 0xffe0cc, hair: o.hair || 0x2b2b33,
            shirt: o.shirt || 0xffffff, shirtD: o.shirtD || 0xd0d8e0,
            pants: o.pants || 0x2a2e3a, boot: o.boot || 0x2a2e3a,
            belt: o.belt || 0x222630, gold: o.gold || 0xffd166,
            collar: o.collar || 0xffffff, iris: o.iris || 0x3a6ac0,
            sock: o.sock || null, apron: o.apron || null, skirt: o.skirt || null };
  p.hair2 = o.hair2 || skShade(p.hair, 1.35);
  p.hairS = skShade(p.hair, 0.72);
  p.skinS = skShade(p.skin, 0.90);
  p.shirtS = skShade(p.shirt, 0.84);
  p.skirtS = p.skirt ? skShade(p.skirt, 0.80) : null;
  p.iris2 = skShade(p.iris, 0.62);
  return p;
}

function skBox(parent, w, h, d, c, x, y, z, rz) {
  var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matOf(c));
  m.position.set(x || 0, y || 0, z || 0);
  if (rz) { m.rotation.z = rz; }
  m.castShadow = true;
  parent.add(m);
  return m;
}
function skTaper(parent, wTop, wBot, h, c, x, y, z, seg) {
  /* ★ round493（用户："裙子下面那一圈应该改成多边形类似圆，四四方方不好看"）
     · seg = 4 → 四棱台（原来的样子 ✓ 大部分皮肤还用这个）
     · seg = 12~16 → 接近圆的多边形（先只给 f01 双马尾剑士 ✓）
     ★ 半径换算：要保证【对边宽度】= w（不然换成多边形会突然变粗/变细 ✗）
         正 n 边形：对边宽 = 2r·cos(π/n) → r = (w/2)/cos(π/n) ✓
         旋转 π/n 让"平面"正对前方 ✓（和原来 4 段的 π/4 同一个道理 ✓）*/
  var n = Math.max(3, Math.min(24, (seg | 0) || 4));
  var rT = (wTop / 2) / Math.cos(Math.PI / n);
  var rB = (wBot / 2) / Math.cos(Math.PI / n);
  var m = new THREE.Mesh(new THREE.CylinderGeometry(rT, rB, h, n, 1), matOf(c));
  m.rotation.y = Math.PI / n;
  m.position.set(x || 0, y || 0, z || 0);
  m.castShadow = true;
  parent.add(m);
  return m;
}

/* ---------------- 脸：眼睛（男/女各 10 款）+ 嘴巴（10 款） ----------------
   ★ round509（用户："嘴巴和眼睛都做 10 个给我看看，眼睛要分性别"）
   ★ 所有款式都只是【方块】拼的 ✓ 和整个游戏的方块风一致 ✗ 不引入贴图
   ★ 数据驱动：每一款就是一行参数 ✗ 加新款式只加一行 ✓
     字段：w/h 眼白大小 · cut 四角削 · tilt 倾斜 · irW/irH 虹膜 · puW/puH 瞳孔
           hi 高光个数 · hiS 高光大小 · lid 上眼睑粗 · low 下眼睑 · lash 睫毛
           brow 眉毛（0=没有） · browT 眉毛角度 · scar 疤痕（0/1）· y 上下偏移
*/
var EYE_F = [
  /* 1 标准大眼（= round508 之前的样子，一像素不变） */
  { w: 1.00, h: 1.00, cut: 0.32, tilt: 0.00, irW: 0.80, irH: 0.80, puW: 0.30, puH: 0.34,
    hi: 2, hiS: 0.17, lid: 0.13, low: 0.06, lash: 1, brow: 0, browT: 0, scar: 0, y: 0 },
  /* 2 圆眼 */
  { w: 1.06, h: 1.04, cut: 0.42, tilt: 0.00, irW: 0.86, irH: 0.88, puW: 0.26, puH: 0.30,
    hi: 2, hiS: 0.22, lid: 0.11, low: 0.05, lash: 1, brow: 0, browT: 0, scar: 0, y: 0 },
  /* 3 细长（温柔） */
  { w: 1.14, h: 0.72, cut: 0.28, tilt: 0.00, irW: 0.70, irH: 0.74, puW: 0.28, puH: 0.40,
    hi: 1, hiS: 0.18, lid: 0.16, low: 0.05, lash: 1, brow: 0, browT: 0, scar: 0, y: 0 },
  /* 4 猫眼（上挑） */
  { w: 1.10, h: 0.86, cut: 0.26, tilt: 0.13, irW: 0.78, irH: 0.78, puW: 0.28, puH: 0.36,
    hi: 2, hiS: 0.19, lid: 0.15, low: 0.05, lash: 1, brow: 0, browT: 0, scar: 0, y: 0 },
  /* 5 下垂眼（可怜） */
  { w: 1.06, h: 0.90, cut: 0.30, tilt: -0.12, irW: 0.78, irH: 0.80, puW: 0.30, puH: 0.34,
    hi: 2, hiS: 0.20, lid: 0.13, low: 0.07, lash: 1, brow: 0, browT: 0, scar: 0, y: 0 },
  /* 6 半眯（慵懒） */
  { w: 1.10, h: 0.50, cut: 0.24, tilt: 0.02, irW: 0.74, irH: 0.86, puW: 0.30, puH: 0.52,
    hi: 1, hiS: 0.16, lid: 0.20, low: 0.04, lash: 1, brow: 0, browT: 0, scar: 0, y: 0 },
  /* 7 星眼（两点高光 + 大眼） */
  { w: 1.14, h: 1.10, cut: 0.36, tilt: 0.04, irW: 0.90, irH: 0.94, puW: 0.24, puH: 0.26,
    hi: 2, hiS: 0.20, lid: 0.10, low: 0.05, lash: 1, brow: 0, browT: 0, scar: 0, y: 0 },
  /* 8 竖瞳（妖/猫） */
  { w: 1.04, h: 0.96, cut: 0.34, tilt: 0.06, irW: 0.86, irH: 0.92, puW: 0.12, puH: 0.74,
    hi: 1, hiS: 0.18, lid: 0.13, low: 0.05, lash: 1, brow: 0, browT: 0, scar: 0, y: 0 },
  /* 9 细眉细眼（清冷） */
  { w: 1.08, h: 0.64, cut: 0.26, tilt: 0.05, irW: 0.66, irH: 0.66, puW: 0.26, puH: 0.42,
    hi: 1, hiS: 0.14, lid: 0.18, low: 0.05, lash: 1, brow: 0, browT: 0, scar: 0, y: 0.01 },
  /* 10 小豆眼（呆萌） */
  { w: 0.78, h: 0.74, cut: 0.44, tilt: 0.00, irW: 0.92, irH: 0.94, puW: 0.34, puH: 0.36,
    hi: 2, hiS: 0.24, lid: 0.09, low: 0.04, lash: 0, brow: 0, browT: 0, scar: 0, y: 0.02 }
];

var EYE_M = [
  /* 1 窄长眼（round508 默认） */
  { w: 1.08, h: 0.52, cut: 0.20, tilt: 0.00, irW: 0.74, irH: 0.92, puW: 0.30, puH: 0.66,
    hi: 0, hiS: 0.16, lid: 0.11, low: 0.05, lash: 0, brow: 0.052, browT: 0.10, scar: 0, y: 0.06 },
  /* 2 方眼 */
  { w: 0.90, h: 0.76, cut: 0.14, tilt: 0.00, irW: 0.74, irH: 0.88, puW: 0.34, puH: 0.54,
    hi: 0, hiS: 0.16, lid: 0.12, low: 0.05, lash: 0, brow: 0.058, browT: 0.04, scar: 0, y: 0.04 },
  /* 3 上挑凶眼 */
  { w: 1.04, h: 0.48, cut: 0.16, tilt: 0.115, irW: 0.74, irH: 0.96, puW: 0.30, puH: 0.70,
    hi: 0, hiS: 0.16, lid: 0.13, low: 0.05, lash: 0, brow: 0.064, browT: 0.26, scar: 0, y: 0.07 },
  /* 4 小圆眼（少年） */
  { w: 0.80, h: 0.70, cut: 0.34, tilt: 0.00, irW: 0.82, irH: 0.84, puW: 0.34, puH: 0.44,
    hi: 1, hiS: 0.16, lid: 0.10, low: 0.04, lash: 0, brow: 0.048, browT: 0.02, scar: 0, y: 0.05 },
  /* 5 眯眼 */
  { w: 1.00, h: 0.30, cut: 0.22, tilt: 0.02, irW: 0.72, irH: 0.94, puW: 0.30, puH: 0.80,
    hi: 0, hiS: 0.14, lid: 0.14, low: 0.04, lash: 0, brow: 0.068, browT: 0.12, scar: 0, y: 0.07 },
  /* 6 竖瞳（狼/蛇） */
  { w: 1.02, h: 0.62, cut: 0.20, tilt: 0.09, irW: 0.80, irH: 0.92, puW: 0.12, puH: 0.78,
    hi: 0, hiS: 0.14, lid: 0.12, low: 0.05, lash: 0, brow: 0.060, browT: 0.18, scar: 0, y: 0.05 },
  /* 7 三角眼（上平下斜，最凶） */
  { w: 1.02, h: 0.44, cut: 0.10, tilt: 0.16, irW: 0.70, irH: 0.90, puW: 0.32, puH: 0.64,
    hi: 0, hiS: 0.14, lid: 0.17, low: 0.04, lash: 0, brow: 0.070, browT: 0.34, scar: 0, y: 0.08 },
  /* 8 肿眼泡（憨） */
  { w: 0.96, h: 0.64, cut: 0.26, tilt: -0.02, irW: 0.70, irH: 0.80, puW: 0.32, puH: 0.50,
    hi: 0, hiS: 0.14, lid: 0.20, low: 0.08, lash: 0, brow: 0.062, browT: 0.00, scar: 0, y: 0.04 },
  /* 9 单眼皮长眼（东方脸） */
  { w: 1.12, h: 0.46, cut: 0.22, tilt: 0.03, irW: 0.66, irH: 0.88, puW: 0.28, puH: 0.70,
    hi: 0, hiS: 0.14, lid: 0.09, low: 0.06, lash: 0, brow: 0.046, browT: 0.06, scar: 0, y: 0.06 },
  /* 10 疤眼（一道斜疤压在眼上） */
  { w: 1.06, h: 0.56, cut: 0.18, tilt: 0.05, irW: 0.72, irH: 0.92, puW: 0.30, puH: 0.68,
    hi: 0, hiS: 0.14, lid: 0.13, low: 0.05, lash: 0, brow: 0.058, browT: 0.14, scar: 1, y: 0.06 }
];

/* 嘴巴 10 款：w/h 大小 · y 上下 · curve 嘴角上扬(+)下垂(-) · open 张嘴 · teeth 露牙
   lip 唇色 · dark 嘴里暗色 · cross 缝合线（僵尸）· fang 小虎牙 */
var MOUTH = [
  { w: 0.09, h: 0.026, y: -0.30, curve: 0.000, open: 0, teeth: 0, dark: 0, cross: 0, fang: 0 }, // 1 平静
  { w: 0.11, h: 0.026, y: -0.30, curve: 0.022, open: 0, teeth: 0, dark: 0, cross: 0, fang: 0 }, // 2 微笑
  { w: 0.07, h: 0.040, y: -0.30, curve: 0.000, open: 0, teeth: 0, dark: 0, cross: 0, fang: 0 }, // 3 抿嘴
  { w: 0.08, h: 0.055, y: -0.30, curve: 0.000, open: 1, teeth: 0, dark: 1, cross: 0, fang: 0 }, // 4 张嘴
  { w: 0.15, h: 0.030, y: -0.30, curve: 0.034, open: 0, teeth: 0, dark: 0, cross: 0, fang: 0 }, // 5 咧嘴笑
  { w: 0.10, h: 0.026, y: -0.30, curve: 0.030, open: 0, teeth: 0, dark: 0, cross: 0, fang: 0, skew: 1 }, // 6 撇嘴
  { w: 0.10, h: 0.026, y: -0.30, curve: -0.026, open: 0, teeth: 0, dark: 0, cross: 0, fang: 0 }, // 7 八字（苦）
  { w: 0.05, h: 0.046, y: -0.30, curve: 0.000, open: 0, teeth: 0, dark: 0, cross: 0, fang: 0 }, // 8 嘟嘴
  { w: 0.16, h: 0.062, y: -0.31, curve: 0.030, open: 1, teeth: 1, dark: 1, cross: 0, fang: 0 }, // 9 大笑露牙
  { w: 0.12, h: 0.030, y: -0.30, curve: 0.000, open: 0, teeth: 0, dark: 0, cross: 1, fang: 0 }  // 10 缝合嘴
];

function skMouth(headG, S, P, st) {
  st = Math.max(1, Math.min(10, st || 1));
  var m = MOUTH[st - 1];
  var fs = S.faceS || 1;            /* ★ round513：嘴巴尺寸也要跟脸走 ✓ */
  /* ★ 我自己写出来的 bug：批量把 m.w 换成 mw 的时候，把这一行也换成了
     `var mw = mw * fs`（自己乘自己 ✗ undefined → NaN）✗ 嘴巴 4 个盒子全 NaN ✓
     → 表现就是控制台刷 "Computed radius is NaN" ✓ 而且 rAF 链被异常打断 ✗ 自转停了 ✓ */
  var mw = m.w * fs, mh = m.h * fs;
  var hh = S.headH, hd = S.headD;
  var ez = hd * 0.50 + 0.012;
  var y = hh * m.y;
  var lip = 0xcf6b74;
  var dark = 0x5a2a30;
  /* 主体 */
  if (m.open) {
    skBox(headG, mw, mh, 0.026, dark, 0, y, ez);
    skBox(headG, mw * 1.02, 0.014, 0.028, lip, 0, y + mh * 0.52, ez + 0.004);
    skBox(headG, mw * 1.02, 0.014, 0.028, lip, 0, y - mh * 0.52, ez + 0.004);
    if (m.teeth) {
      skBox(headG, mw * 0.84, 0.016, 0.020, 0xf6f2ea, 0, y + mh * 0.30, ez + 0.012);
      skBox(headG, mw * 0.72, 0.012, 0.020, 0xf6f2ea, 0, y - mh * 0.28, ez + 0.012);
    }
  } else {
    skBox(headG, mw, mh, 0.026, lip, 0, y, ez);
    /* 嘴角上扬/下垂：两端各一个小方块，往上或往下挪 */
    var cw = mw * 0.30, ch = mh * 0.86;
    var dy = m.curve;
    var sk = m.skew ? 1 : 0;
    skBox(headG, cw, ch, 0.026, lip, -mw * 0.46, y + (sk ? -dy : dy), ez);
    skBox(headG, cw, ch, 0.026, lip, mw * 0.46, y + dy, ez);
  }
  if (m.fang) {
    skBox(headG, 0.018, 0.024, 0.020, 0xf6f2ea, mw * 0.34, y + mh * 0.35, ez + 0.012);
  }
  if (m.cross) {
    for (var i = -2; i <= 2; i++) {
      skBox(headG, 0.008, 0.030, 0.014, 0x2a2026, i * mw * 0.19, y, ez + 0.016);
    }
  }
  /* 下唇一点点阴影（让嘴有厚度 ✓）*/
  if (!m.open) {
    skBox(headG, mw * 0.9, 0.008, 0.016, 0xa85860, 0, y - mh * 0.9, ez + 0.006);
  }
}

function skEyeDraw(headG, S, P, o, male, E) {
  var hw = S.headW, hh = S.headH, hd = S.headD;
  var ez = hd * 0.50 + 0.012;
  var eyeX = hw * 0.215;
  var _fs = S.faceS || 1;
  var ew = E.w * o.w * _fs, eh = E.h * o.h * _fs;
  var eyeY = hh * 0.02 + hh * (o.y || 0);
  var white = male ? 0xe6e1d8 : 0xffffff;
  var lashC = 0x241f2a;
  var browC = skShade(P.hairS, 0.72);
  var si;

  for (si = -1; si <= 1; si += 2) {
    var bx2 = eyeX * si;
    var rz = -o.tilt * si;

    /* 眼白 */
    skBox(headG, ew, eh, 0.025, white, bx2, eyeY, ez, rz);
    /* 虹膜 */
    skBox(headG, ew * o.irW, eh * o.irH, 0.030, P.iris, bx2, eyeY - eh * 0.04, ez + 0.014, rz);
    skBox(headG, ew * o.irW * 0.78, eh * o.irH * 0.76, 0.032, P.iris2,
          bx2, eyeY - eh * 0.02, ez + 0.019, rz);
    /* 瞳孔 */
    skBox(headG, ew * o.puW, eh * o.puH, 0.034, 0x171219,
          bx2, eyeY - eh * 0.02, ez + 0.026, rz);
    /* 高光（0/1/2/3 个）*/
    if (o.hi >= 1) {
      skBox(headG, ew * o.hiS * (male ? 0.6 : 1), eh * o.hiS, 0.020, 0xffffff,
            bx2 - ew * 0.17, eyeY + eh * 0.18, ez + 0.040, rz);
    }
    if (o.hi >= 2) {
      skBox(headG, ew * o.hiS * 0.5, eh * o.hiS * 0.55, 0.020, 0xffffff,
            bx2 + ew * 0.18, eyeY - eh * 0.22, ez + 0.040, rz);
    }
    /* 上眼睑（睫毛/眼皮）*/
    skBox(headG, ew * 1.04, Math.max(0.014, eh * o.lid), 0.030,
          o.lash ? lashC : skShade(0x1c1620, 1.3),
          bx2, eyeY + eh * 0.52, ez + 0.020, rz);
    /* 下眼睑 */
    skBox(headG, ew * 0.92, Math.max(0.010, eh * o.low), 0.026,
          male ? skShade(P.skinS, 0.92) : skShade(lashC, 1.5),
          bx2, eyeY - eh * 0.54, ez + 0.016, rz);
    /* 女生那两撇上睫毛（形状记忆点 ✓ 男生没有）*/
    if (o.lash) {
      skBox(headG, ew * 0.60, eh * 0.13, 0.045, lashC, bx2 - ew * 0.20, eyeY + eh * 0.50, ez + 0.026);
      skBox(headG, ew * 0.55, eh * 0.13, 0.045, lashC, bx2 + ew * 0.22, eyeY + eh * 0.46, ez + 0.026);
    }
    /* 眉毛（男生才有）*/
    if (o.brow) {
      skBox(headG, E.w * 0.98 * _fs, E.h * o.brow * _fs, 0.030, browC,
            bx2, eyeY + eyecfgBrowY(o, E), ez - 0.002, -o.browT * si);
    }
    /* 疤（斜着压在眼上）*/
    if (o.scar && si < 0) {
      skBox(headG, 0.030 * _fs, E.h * 1.30 * _fs, 0.020, 0xc98a7a, bx2 + ew * 0.10, eyeY + eh * 0.30,
            ez + 0.046, 0.42);
    }
  }
  /* 鼻子 */
  skBox(headG, 0.05 * _fs, 0.05 * _fs, 0.03, P.skinS, 0, eyeY - eh * 1.35, ez + 0.002);
}
function eyecfgBrowY(o, E) {
  return E.h * (0.80 + (o.browT > 0.2 ? -0.10 : 0));
}

/* 女生：10 款 */
function skFace(headG, S, P, E, st) {
  st = Math.max(1, Math.min(10, st || 1));
  skEyeDraw(headG, S, P, EYE_F[st - 1], false, E);
  skBox(headG, 0.09, 0.032, 0.026, 0xcf6b74, 0, 0, 0);   /* 占位（旧腮红的坐标算在下面）*/
  skMouth(headG, S, P, (E && E.mo) || 1);
  if (E && E.blush) {
    var hw = S.headW, hh = S.headH;
    skBox(headG, 0.17, 0.06, 0.02, 0xf2a8ac, -hw * 0.33, -hh * 0.15, S.headD * 0.5 + 0.006);
    skBox(headG, 0.17, 0.06, 0.02, 0xf2a8ac, hw * 0.33, -hh * 0.15, S.headD * 0.5 + 0.006);
  }
}

/* 男生：10 款 */
function skFaceM(headG, S, P, E, st) {
  st = Math.max(1, Math.min(10, st || 1));
  skEyeDraw(headG, S, P, EYE_M[st - 1], true, E);
  skMouth(headG, S, P, (E && E.mo) || 1);
}

/* ---------------- 头发 ---------------- */
function skHair(headG, S, P, style, pinColor) {
  var hc = P.hair, hi = P.hair2, hs = P.hairS;
  var hw = S.headW, hh = S.headH, hd = S.headD;
  var q, sx2, tl;

  function cap() {
    skBox(headG, hw * 1.06, 0.30, hd * 1.06, hc, 0, hh * 0.50, 0);
    skBox(headG, hw * 0.92, 0.10, hd * 0.92, hi, 0, hh * 0.60, 0);
    skBox(headG, hw * 1.02, 0.12, 0.10, hc, 0, hh * 0.36, hd * 0.47);
    skBox(headG, hw * 1.06, hh * 0.64, hd * 0.34, hc, 0, hh * 0.16, -hd * 0.48);
    skBox(headG, hw * 1.06, hh * 0.40, hd * 0.30, hs, 0, hh * 0.02, -hd * 0.50);
    skBox(headG, hw * 0.11, hh * 0.72, hd * 1.02, hc, -hw * 0.505, hh * 0.18, 0);
    skBox(headG, hw * 0.11, hh * 0.72, hd * 1.02, hc, hw * 0.505, hh * 0.18, 0);
  }
  function bangs() {
    skBox(headG, hw * 0.98, 0.30, 0.08, hc, 0, hh * 0.32, hd * 0.50);
    skBox(headG, hw * 0.20, 0.14, 0.08, hi, 0, hh * 0.44, hd * 0.50);
    skBox(headG, hw * 0.19, 0.34, 0.08, hc, -hw * 0.39, hh * 0.27, hd * 0.50);
    skBox(headG, hw * 0.19, 0.34, 0.08, hc, hw * 0.39, hh * 0.27, hd * 0.50);
    skBox(headG, hw * 0.13, 0.12, 0.078, hs, -hw * 0.20, hh * 0.17, hd * 0.505);
    skBox(headG, hw * 0.11, 0.10, 0.078, hs, hw * 0.13, hh * 0.18, hd * 0.505);
  }
  function sidelocks(len) {
    skBox(headG, 0.085, len, hd * 0.40, hc, -hw * 0.50, -len / 2 + hh * 0.20, hd * 0.24);
    skBox(headG, 0.085, len, hd * 0.40, hc, hw * 0.50, -len / 2 + hh * 0.20, hd * 0.24);
    skBox(headG, 0.085, 0.10, hd * 0.40, hs, -hw * 0.50, -len + hh * 0.20, hd * 0.24);
    skBox(headG, 0.085, 0.10, hd * 0.40, hs, hw * 0.50, -len + hh * 0.20, hd * 0.24);
  }
  function back(len, c) {
    skBox(headG, hw * 1.00, len, hd * 0.40, c || hc, 0, -len / 2 + hh * 0.30, -hd * 0.44);
    skBox(headG, hw * 0.96, len * 0.16, hd * 0.42, hs, 0, -len + hh * 0.30 + len * 0.06, -hd * 0.44);
  }

  if (style === 'spiky') {
    cap();
    for (q = -2; q <= 2; q++) {
      skBox(headG, 0.14, 0.26, 0.14, hc, q * hw * 0.20, hh * 0.62, hd * 0.10, q * 0.22);
      skBox(headG, 0.12, 0.20, 0.12, hc, q * hw * 0.22, hh * 0.58, -hd * 0.22, q * -0.18);
    }
    bangs();
  } else if (style === 'messy') {
    cap(); bangs();
    skBox(headG, hw * 0.22, 0.18, hw * 0.22, hc, -hw * 0.34, hh * 0.62, hd * 0.02, 0.20);
    skBox(headG, hw * 0.18, 0.22, hw * 0.18, hc, hw * 0.30, hh * 0.66, -hd * 0.06, -0.24);
    skBox(headG, hw * 0.14, 0.16, hw * 0.14, hs, hw * 0.06, hh * 0.70, hd * 0.12, 0.5);
    sidelocks(0.34);
  } else if (style === 'topknot') {
    cap(); bangs(); sidelocks(0.30);
    skBox(headG, 0.16, 0.14, 0.16, hc, 0, hh * 0.66, -hd * 0.04);
    skBox(headG, 0.20, 0.16, 0.20, hc, 0, hh * 0.76, -hd * 0.06);
    skBox(headG, 0.18, 0.05, 0.18, hs, 0, hh * 0.70, -hd * 0.06);
  } else if (style === 'short') {
    cap(); bangs(); sidelocks(0.30);
  } else if (style === 'bob') {
    cap(); bangs(); sidelocks(0.54); back(0.58);
  } else if (style === 'long') {
    cap(); bangs(); sidelocks(0.78); back(1.55);
  } else if (style === 'hime') {
    cap(); bangs(); sidelocks(0.64); back(1.45);
    skBox(headG, hw * 1.02, 0.16, hd * 0.94, hc, 0, hh * 0.30, -hd * 0.16);
    skBox(headG, hw * 1.02, 0.05, hd * 0.94, hs, 0, hh * 0.22, -hd * 0.16);
  } else if (style === 'twintail') {
    cap(); bangs(); sidelocks(0.36);
    tl = 0.92;
    for (sx2 = -1; sx2 <= 1; sx2 += 2) {
      skBox(headG, 0.20, 0.18, 0.20, hc, hw * 0.56 * sx2, hh * 0.42, -hd * 0.04);
      skBox(headG, 0.23, 0.07, 0.23, pinColor || hi, hw * 0.58 * sx2, hh * 0.36, -hd * 0.04);
      skBox(headG, 0.18, tl * 0.62, 0.18, hc, hw * 0.62 * sx2, hh * 0.32 - tl * 0.30, -hd * 0.08);
      skBox(headG, 0.16, tl * 0.44, 0.16, hc, hw * 0.63 * sx2, hh * 0.32 - tl * 0.74, -hd * 0.10);
      skBox(headG, 0.15, 0.10, 0.15, hs, hw * 0.63 * sx2, hh * 0.32 - tl * 0.95, -hd * 0.10);
    }
  } else if (style === 'ponytail') {
    cap(); bangs(); sidelocks(0.42);
    skBox(headG, 0.22, 0.18, 0.22, hc, 0, hh * 0.48, -hd * 0.54);
    skBox(headG, 0.26, 0.07, 0.26, pinColor || hi, 0, hh * 0.42, -hd * 0.54);
    skBox(headG, 0.20, 0.70, 0.20, hc, 0, hh * 0.36 - 0.36, -hd * 0.62);
    skBox(headG, 0.17, 0.52, 0.17, hc, 0, hh * 0.36 - 0.92, -hd * 0.66);
    skBox(headG, 0.15, 0.10, 0.15, hs, 0, hh * 0.36 - 1.20, -hd * 0.66);
  } else if (style === 'veil') {
    skBox(headG, hw * 1.14, 0.30, hd * 1.14, 0xffffff, 0, hh * 0.52, 0);
    skBox(headG, hw * 1.14, hh * 0.92, 0.14, 0xffffff, 0, -hh * 0.10, -hd * 0.56);
    skBox(headG, 0.13, hh * 0.92, hd * 0.94, 0xffffff, -hw * 0.58, -hh * 0.10, 0);
    skBox(headG, 0.13, hh * 0.92, hd * 0.94, 0xffffff, hw * 0.58, -hh * 0.10, 0);
    skBox(headG, hw * 1.10, 0.05, 0.15, 0xd8dce6, 0, hh * 0.36, -hd * 0.56);
  } else if (style === 'hood') {
    skBox(headG, hw * 1.16, hh * 0.46, hd * 1.16, hc, 0, hh * 0.46, 0);
    skBox(headG, 0.20, hh * 0.62, hd * 0.96, hc, -hw * 0.56, hh * 0.10, 0);
    skBox(headG, 0.20, hh * 0.62, hd * 0.96, hc, hw * 0.56, hh * 0.10, 0);
    bangs();
  }

  if (pinColor) {
    var px2 = hw * 0.36, py2 = hh * 0.46, pz2 = hd * 0.30;
    skBox(headG, 0.20, 0.10, 0.10, pinColor, px2, py2, pz2);
    skBox(headG, 0.10, 0.14, 0.10, pinColor, px2 - 0.13, py2 + 0.02, pz2);
    skBox(headG, 0.10, 0.14, 0.10, pinColor, px2 + 0.13, py2 + 0.02, pz2);
  }
  if (style === 'twintail' || style === 'bob' || style === 'hime' || style === 'veil' || style === 'short') {
    skBox(headG, 0.07, 0.18, 0.07, hc, hw * 0.06, hh * 0.60, hd * 0.10, 0.42);
    skBox(headG, 0.05, 0.10, 0.05, hc, hw * 0.13, hh * 0.70, hd * 0.10, 0.75);
  }
}

/* ---------------- 服装 ---------------- */
function skOutfit(g, S, P, ch, hipY, torsoTop) {
  var kind = ch.outfit || 'plain';
  var skirt = ch.skirt;
  var i2, vl;

  if (kind === 'sailor') {
    skBox(g, S.torsoW * 0.96, 0.14, S.torsoD * 1.06, P.collar, 0, torsoTop - 0.01, 0);
    skBox(g, S.torsoW * 0.90, 0.26, S.torsoD * 0.26, P.collar, 0, torsoTop - 0.20, -S.torsoD * 0.44);
    skBox(g, S.torsoW * 0.84, 0.04, S.torsoD * 0.26, 0xffffff, 0, torsoTop - 0.27, -S.torsoD * 0.46);
    vl = S.torsoH * 0.30;
    skBox(g, S.torsoW * 0.17, vl, 0.06, P.collar, -S.torsoW * 0.19, torsoTop - 0.16 - vl / 2, S.torsoD * 0.50, 0.42);
    skBox(g, S.torsoW * 0.17, vl, 0.06, P.collar, S.torsoW * 0.19, torsoTop - 0.16 - vl / 2, S.torsoD * 0.50, -0.42);
    skBox(g, 0.15, 0.10, 0.09, P.gold, 0, torsoTop - 0.30, S.torsoD * 0.52);
  } else if (kind === 'maid') {
    skBox(g, S.torsoW * 0.94, 0.14, S.torsoD * 1.05, P.apron, 0, torsoTop - 0.02, 0);
    skBox(g, S.torsoW * 0.56, S.torsoH * 0.48, 0.05, P.apron, 0, hipY + S.torsoH * 0.42, S.torsoD * 0.55);
    skBox(g, S.torsoW * 0.62, 0.10, S.torsoD * 0.64, P.apron, 0, hipY + 0.24, 0);
    skBox(g, 0.10, 0.10, 0.10, P.gold, 0, hipY + 0.36, S.torsoD * 0.56);
    for (i2 = -2; i2 <= 2; i2++) {
      skBox(g, 0.22, 0.10, 0.22, P.apron, i2 * 0.26,
            hipY - (skirt ? skirt.len : 0.6) + 0.34, S.torsoD * 0.40);
    }
  } else if (kind === 'miko') {
    skBox(g, S.torsoW * 0.92, 0.18, S.torsoD * 1.05, P.collar, 0, torsoTop - 0.04, 0);
    skBox(g, 0.86, 0.10, 0.10, P.gold, 0, torsoTop - 0.22, S.torsoD * 0.50);
    skBox(g, 0.30, 0.24, 0.05, P.gold, 0, torsoTop - 0.40, S.torsoD * 0.53);
  } else if (kind === 'nun') {
    skBox(g, 0.13, 0.34, 0.05, P.gold, 0, torsoTop - 0.34, S.torsoD * 0.55);
    skBox(g, 0.34, 0.13, 0.05, P.gold, 0, torsoTop - 0.26, S.torsoD * 0.55);
  } else if (kind === 'mech') {
    skBox(g, S.torsoW * 1.06, 0.22, S.torsoD * 1.08, P.shirtD, 0, torsoTop - 0.10, 0);
    skBox(g, 0.16, 0.16, 0.08, P.collar, -S.torsoW * 0.26, torsoTop - 0.32, S.torsoD * 0.54);
    skBox(g, 0.09, 0.55, 0.09, P.gold, S.torsoW * 0.50, hipY + 0.26, -S.torsoD * 0.36);
    skBox(g, S.torsoW * 0.30, 0.10, 0.10, P.collar, 0, hipY + 0.06, S.torsoD * 0.54);
  } else if (kind === 'armorkirt') {
    skBox(g, S.torsoW * 1.10, 0.32, S.torsoD * 1.08, P.shirtD, 0, torsoTop - 0.16, 0);
    skBox(g, S.torsoW * 1.10, 0.05, S.torsoD * 1.10, P.gold, 0, torsoTop - 0.33, 0);
    skBox(g, 0.46, 0.18, 0.52, P.shirtD, -S.armX, torsoTop - 0.06, 0);
    skBox(g, 0.46, 0.18, 0.52, P.shirtD, S.armX, torsoTop - 0.06, 0);
    skBox(g, 0.14, 0.14, 0.14, P.gold, 0, torsoTop - 0.05, S.torsoD * 0.52);
  } else if (kind === 'sport' || kind === 'hoodie') {
    skBox(g, S.torsoW * 0.94, 0.18, S.torsoD * 1.06, P.collar, 0, torsoTop - 0.04, 0);
    skBox(g, 0.30, 0.10, S.torsoD * 0.98, P.collar, 0, torsoTop - 0.14, 0);
  } else if (kind === 'frill' || kind === 'dress') {
    skBox(g, S.torsoW * 0.96, 0.16, S.torsoD * 1.06, P.collar, 0, torsoTop - 0.02, 0);
    skBox(g, S.torsoW * 0.34, 0.14, 0.06, P.gold, 0, torsoTop - 0.18, S.torsoD * 0.52);
    skBox(g, S.torsoW * 0.20, 0.10, 0.06, P.gold, 0, torsoTop - 0.10, S.torsoD * 0.52);
  } else if (kind === 'hanfu') {
    skBox(g, S.torsoW * 0.96, 0.18, S.torsoD * 1.05, P.collar, 0, torsoTop - 0.03, 0);
    skBox(g, 0.10, S.torsoH * 0.5, 0.06, P.collar, -S.torsoW * 0.20, hipY + S.torsoH * 0.45, S.torsoD * 0.52);
    skBox(g, 0.10, S.torsoH * 0.5, 0.06, P.collar, S.torsoW * 0.20, hipY + S.torsoH * 0.45, S.torsoD * 0.52);
    skBox(g, S.torsoW * 0.30, 0.14, 0.06, P.gold, 0, hipY + 0.16, S.torsoD * 0.54);
  } else if (kind === 'kendo') {
    skBox(g, S.torsoW * 0.94, 0.16, S.torsoD * 1.05, P.collar, 0, torsoTop - 0.02, 0);
    skBox(g, S.torsoW * 0.16, 0.46, 0.08, P.collar, -S.torsoW * 0.24, torsoTop - 0.30, S.torsoD * 0.50);
    skBox(g, S.torsoW * 0.16, 0.46, 0.08, P.collar, S.torsoW * 0.24, torsoTop - 0.30, S.torsoD * 0.50);
  } else if (kind === 'ninja') {
    skBox(g, S.torsoW * 1.02, 0.34, S.torsoD * 1.06, P.collar, 0, torsoTop - 0.16, 0);
    skBox(g, 0.10, S.torsoH * 0.5, 0.06, P.collar, 0, hipY + S.torsoH * 0.45, S.torsoD * 0.52);
    skBox(g, S.torsoW * 1.04, 0.10, S.torsoD * 1.08, P.belt, 0, hipY + 0.22, 0);
  } else if (kind === 'robe') {
    skBox(g, S.torsoW * 0.98, 0.16, S.torsoD * 1.05, P.collar, 0, torsoTop - 0.02, 0);
    skBox(g, 0.09, S.torsoH * 0.62, 0.06, skShade(P.shirt, 0.78), 0, hipY + S.torsoH * 0.5, S.torsoD * 0.52);
    skBox(g, S.torsoW * 1.06, 0.10, S.torsoD * 1.06, P.belt, 0, hipY + 0.20, 0);
    skBox(g, 0.24, 0.16, 0.10, P.gold, 0, hipY + 0.20, S.torsoD * 0.54);
  } else if (kind === 'monk') {
    skBox(g, S.torsoW * 0.96, 0.16, S.torsoD * 1.06, P.collar, 0, torsoTop - 0.03, 0);
    skBox(g, 0.90, 0.10, 0.10, P.gold, 0, torsoTop - 0.26, S.torsoD * 0.50);
    skBox(g, 0.14, 0.14, 0.14, P.gold, 0, torsoTop - 0.40, S.torsoD * 0.52);
  }

  if (skirt) {
    var hl = skirt.len;
    var sTop = Math.min(skirt.top, S.torsoW * 0.80);
    var sBot = Math.max(skirt.bot, sTop + 0.18);
    /* ★ round495（用户："可以把裙子都按照这样改一下"）
       · 有写 seg 就按写的 ✓（f01 = 8，用户确认过 ✓）
       · 没写就按【裙长】自动挑：
           短裙 < 0.55      → 8 边形
           及膝 0.55~0.85   → 10 边形
           长袍 ≥ 0.85      → 12 边形（更长更柔和，不然八角太硬 ✓）*/
    var sSeg = (skirt.seg | 0) ||
               (skirt.len >= 0.85 ? 12 : (skirt.len >= 0.55 ? 10 : 8));
    skTaper(g, sTop, sBot, hl, P.skirt || P.shirt, 0, hipY - hl / 2 + 0.26, 0, sSeg);
    var sc2 = P.skirt || P.shirt;
    /* ★ round493：多边形裙（seg>4）靠自己的斜面就有明暗 ✓
       再贴平板会【露在裙外面】或者被吃进里面 ✗ 所以只给 4 段的贴 ✓ */
    if (sSeg <= 4) {
      skBox(g, sBot * 0.28, hl * 0.78, 0.04, skShade(sc2, 0.78), -sBot * 0.30, hipY - hl / 2 + 0.28, sBot * 0.30);
      skBox(g, sBot * 0.28, hl * 0.78, 0.04, skShade(sc2, 0.78), sBot * 0.30, hipY - hl / 2 + 0.28, sBot * 0.30);
      skBox(g, sBot * 0.15, hl * 0.72, 0.04, skShade(sc2, 1.18), 0, hipY - hl / 2 + 0.30, sBot * 0.34);
    }
    skTaper(g, sBot * 0.99, sBot * 1.03, 0.07, skShade(sc2, 1.25), 0, hipY - hl + 0.30, 0, sSeg);
    skBox(g, sBot * 0.7, 0.04, sBot * 0.7, P.skirtS || P.shirtS, 0, hipY - hl + 0.30, 0);
  }
}

/* ---------------- 配件 ---------------- */
function skAcc(g, headG, armL, armR, S, P, kind, backG, hipY, torsoTop) {
  if (!kind) { return; }
  var hw = S.headW, hh = S.headH, hd = S.headD, s2, gc, lc, lc2, ring;
  if (kind === 'catEar') {
    for (s2 = -1; s2 <= 1; s2 += 2) {
      skBox(headG, 0.24, 0.28, 0.18, P.hair, hw * 0.34 * s2, hh * 0.72, 0.02);
      skBox(headG, 0.12, 0.14, 0.08, 0xf0a0b0, hw * 0.34 * s2, hh * 0.70, 0.10);
    }
  } else if (kind === 'foxEar') {
    for (s2 = -1; s2 <= 1; s2 += 2) {
      skBox(headG, 0.20, 0.38, 0.15, P.hair, hw * 0.33 * s2, hh * 0.80, 0.0);
      skBox(headG, 0.10, 0.20, 0.09, 0xf6d8e6, hw * 0.33 * s2, hh * 0.78, 0.05);
    }
  } else if (kind === 'elfEar') {
    skBox(headG, 0.09, 0.28, 0.09, P.skin, -hw * 0.56, hh * 0.10, -0.02, 0.38);
    skBox(headG, 0.09, 0.28, 0.09, P.skin, hw * 0.56, hh * 0.10, -0.02, -0.38);
  } else if (kind === 'demonHorn') {
    for (s2 = -1; s2 <= 1; s2 += 2) {
      skBox(headG, 0.13, 0.30, 0.13, 0xd03050, hw * 0.33 * s2, hh * 0.76, 0.02, 0.28 * s2);
      skBox(headG, 0.09, 0.24, 0.09, 0xb02040, hw * 0.40 * s2, hh * 0.94, 0.02, 0.5 * s2);
    }
  } else if (kind === 'halo') {
    ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.04, 8, 22), matOf(0xffe066));
    ring.position.set(0, hh * 0.96, -0.06);
    ring.rotation.x = Math.PI / 2;
    headG.add(ring);
  } else if (kind === 'visor') {
    skBox(headG, hw * 0.96, 0.13, 0.06, 0x0ae0e0, 0, hh * 0.05, hw * 0.52);
    skBox(headG, 0.16, 0.07, 0.06, 0xff2fa0, -hw * 0.52, hh * 0.05, 0.02);
  } else if (kind === 'glasses') {
    skBox(headG, 0.22, 0.15, 0.03, 0x2a3038, -hw * 0.215, hh * 0.02, hd * 0.54);
    skBox(headG, 0.22, 0.15, 0.03, 0x2a3038, hw * 0.215, hh * 0.02, hd * 0.54);
    skBox(headG, 0.10, 0.03, 0.03, 0x2a3038, 0, hh * 0.03, hd * 0.54);
  } else if (kind === 'goggles') {
    skBox(headG, hw * 1.06, 0.10, hd * 1.04, 0x2a2a30, 0, hh * 0.30, hd * 0.06);
    skBox(headG, 0.22, 0.18, 0.06, 0x1e2a34, -hw * 0.22, hh * 0.30, hd * 0.52);
    skBox(headG, 0.22, 0.18, 0.06, 0x1e2a34, hw * 0.22, hh * 0.30, hd * 0.52);
    skBox(headG, 0.17, 0.13, 0.07, 0x8ae0ff, -hw * 0.22, hh * 0.30, hd * 0.545);
    skBox(headG, 0.17, 0.13, 0.07, 0x8ae0ff, hw * 0.22, hh * 0.30, hd * 0.545);
  } else if (kind === 'headband') {
    skBox(headG, hw * 1.06, 0.11, hd * 1.06, 0xffffff, 0, hh * 0.40, 0);
    skBox(headG, 0.14, 0.16, 0.10, 0xffffff, hw * 0.30, hh * 0.34, -hd * 0.30);
  } else if (kind === 'ribbon') {
    skBox(headG, 0.46, 0.14, 0.10, 0xd8342c, 0, hh * 0.54, -hd * 0.28);
    skBox(headG, 0.14, 0.12, 0.10, 0xd8342c, -0.22, hh * 0.58, -hd * 0.28);
    skBox(headG, 0.14, 0.12, 0.10, 0xd8342c, 0.22, hh * 0.58, -hd * 0.28);
  } else if (kind === 'gloves') {
    gc = P.belt || 0xd8342c;
    skBox(armL, S.armW * 1.45, 0.24, S.armW * 1.45, gc, 0, -S.armLen + 0.14, 0);
    skBox(armR, S.armW * 1.45, 0.24, S.armW * 1.45, gc, 0, -S.armLen + 0.14, 0);
  } else if (kind === 'cape') {
    skBox(backG, S.torsoW * 1.18, 1.10, 0.09, 0x8a2a3a, 0, -0.34, -0.05);
    skBox(backG, S.torsoW * 1.18, 0.09, 0.10, 0xf0d070, 0, 0.18, -0.05);
  } else if (kind === 'batWing') {
    for (s2 = -1; s2 <= 1; s2 += 2) {
      skBox(backG, 0.26, 0.44, 0.07, 0x2a1a2a, 0.34 * s2, 0.16, -0.05, 0.3 * s2);
      skBox(backG, 0.22, 0.34, 0.07, 0x2a1a2a, 0.56 * s2, -0.02, -0.05, 0.2 * s2);
    }
  } else if (kind === 'blood') {
    skBox(headG, 0.09, 0.30, 0.03, 0x8a1a1a, -hw * 0.30, -hh * 0.26, hd * 0.52);
    skBox(g, 0.12, 0.46, 0.03, 0x8a1a1a, S.torsoW * 0.18, hipY + S.torsoH * 0.30, S.torsoD * 0.55);
  } else if (kind === 'snow') {
    skBox(headG, 0.09, 0.09, 0.09, 0xffffff, hw * 0.42, hh * 0.36, 0.10);
    skBox(headG, 0.05, 0.05, 0.05, 0xffffff, hw * 0.54, hh * 0.22, 0.06);
  } else if (kind === 'lava') {
    lc = 0xff7a20; lc2 = 0xffc050;
    for (s2 = -1; s2 <= 1; s2 += 2) {
      skBox(headG, 0.13, 0.30, 0.13, 0xd03050, hw * 0.33 * s2, hh * 0.76, 0.02, 0.28 * s2);
      skBox(headG, 0.09, 0.24, 0.09, 0xb02040, hw * 0.40 * s2, hh * 0.94, 0.02, 0.5 * s2);
    }
    skBox(g, 0.05, S.torsoH * 0.55, 0.04, lc, -S.torsoW * 0.18, hipY + S.torsoH * 0.45, S.torsoD * 0.52);
    skBox(g, 0.04, S.torsoH * 0.30, 0.04, lc2, S.torsoW * 0.10, hipY + S.torsoH * 0.62, S.torsoD * 0.52);
    skBox(g, 0.16, 0.05, 0.04, lc, S.torsoW * 0.02, hipY + S.torsoH * 0.30, S.torsoD * 0.52);
  }
}

/* ---------------- 按皮肤 key 搭一个人 ---------------- */
function skBuildHero(key, custom) {
  var def = (typeof SKIN_DEFS !== 'undefined') ? SKIN_DEFS[key] : null;
  if (!def) { return null; }
  var g = new THREE.Group();
  var S = {}, k;
  for (k in SK_DEF) { S[k] = SK_DEF[k]; }
  for (k in (def.sk || {})) { S[k] = def.sk[k]; }
  /* ★★★ round510（用户："女生的头再改小一点点，男的腿也跟着一样加长"）★★★
     ★ 全部在这里做比例调整 ✗ 不去改 40 份皮肤数据 ✓
       （以后想再调，就改这一块的 4 个数字 ✓ 一处生效 ✓）
     ★ 铁律：**总高不能变**（头顶称号/血条/相机都按 h 算 ✓）
         h = hipY + torsoH + neck + 0.05 + headH
         所以每加长腿 0.12 就必须缩短上身 0.12 ✓ 一加一减抵消 ✓
     ★ 女生额外：头 ×0.94 ✗ 头小了总高会矮 0.06 ✗ 用腿 +0.12 / 上身 -0.06 补回来 ✓
       （顺手也多了一点腿长 ✓ 正好是想要的效果）*/
  /* ★ 对比图/调试时要能关掉（tools/preview_before_after.html 用 ✓）*/
  if (typeof SK_PROP_ADJUST === 'undefined' || SK_PROP_ADJUST) {
    /* ★ round511（用户："女生的头改到 0.8，男生的头改到 0.9"）
       ★ 头变小 → 总高会矮 ✗ 所以【把变矮的那部分补给腿】✓
         h = hipY + torsoH + neck + 0.05 + headH
         头矮了 dh → 腿长 dh ✓ 一加一抵 ✓ 头顶高度不变 ✓
       ★ 另外【腿至少再加 0.12】（上一轮定的长腿 ✓）
         所以：腿加 max(0.12, dh) ✗ 上身相应减 (加的 - dh) ✓ 总高还是不变 ✓ */
    var _hs = (def.g === 'f') ? 0.80 : 0.90;
    var _h0 = S.headH;
    /* ★ round512（用户："你只是把头变窄了，厚度没有跟着调整"）
       → 宽/高/深【三个方向一起缩】✗ 不然脑袋就成了薄板 ✓ */
    S.headW *= _hs; S.headH *= _hs; S.headD *= _hs;
    var _dh = _h0 - S.headH;
    var _dLeg = Math.max(0.12, _dh);
    S.hipY += _dLeg;
    S.torsoH -= (_dLeg - _dh);
    /* ★ round514（用户："头的高可以加一点点，加 0.05"）
       ★ 只加【高】不加宽/深（脸型稍微拉长一点 ✓）
       ★ 加高会让总高 +0.05 ✗ 所以腿减 0.05 抵回来 ✓ 头顶还是同一个高度 ✓ */
    S.headH += 0.05;
    S.hipY -= 0.05;
  }
  /* ★★ round513（用户："眼睛和嘴巴是不是应该也要跟着缩小才对"）
     ★ 对 ✗ 眼睛/嘴巴的【尺寸】原来是写死的（def.eyes 里的 0.26/0.30）✗
       头缩小以后只有"位置"跟着走（eyeX/ez 是按 headW/headD 算的 ✓）
       → 五官在缩小后的脸上就显得【偏大】✓✓ 一眼看出不对 ✓
     ★ 现在给一个 faceS（脸的比例）✗ 眼睛/嘴巴/鼻子 全部乘它 ✓
       faceS = 当前头宽 / 默认头宽（默认 1.10 ✓ 已经把性别缩放算进去了）*/
  S.faceS = (typeof SK_PROP_ADJUST === 'undefined' || SK_PROP_ADJUST) ? (S.headW / 1.10) : 1;
  S.armX = S.torsoW * 0.5 + S.armW * 0.55;
  var P = skPal(def.c);
  /* ★★ round510：皮肤自定义（捏脸/染色）★★
     custom = { ey:0..9, mo:0..9, iris:0x.., hair:0x.., shirt:0x.. } ✗ 没传就是原样 ✓
     ★ 颜色改了要【把派生色一起重算】✗ 不然暗部/亮部还是原来的颜色 ✓（会脏） */
  var _cus = (custom && typeof custom === 'object') ? custom : null;
  if (_cus) {
    if (typeof _cus.iris === 'number') { P.iris = _cus.iris; P.iris2 = skShade(P.iris, 0.62); }
    if (typeof _cus.hair === 'number') {
      P.hair = _cus.hair;
      P.hair2 = skShade(P.hair, 1.35);
      P.hairS = skShade(P.hair, 0.72);
    }
    if (typeof _cus.shirt === 'number') {
      P.shirt = _cus.shirt;
      P.shirtD = skShade(P.shirt, 0.78);
      P.shirtS = skShade(P.shirt, 0.84);
    }
    /* ★ round519（用户："下半身的颜色没办法改，例如裙子"）
       → 裙子和裤子也能单独染色 ✓（没裙子的皮肤改了也不显示，不影响 ✓）*/
    if (typeof _cus.skirt === 'number') {
      P.skirt = _cus.skirt;
      P.skirtS = skShade(P.skirt, 0.80);
    }
    if (typeof _cus.pants === 'number') { P.pants = _cus.pants; }
  }

  var hipY = S.hipY;
  var torsoTop = hipY + S.torsoH;
  var shoulderY = torsoTop - 0.06;
  var headY = torsoTop + S.neck + S.headH / 2 + 0.05;
  var handY = -(S.armLen + 0.03);

  var legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(-S.legW * 0.72, hipY, 0);
  legR.position.set(S.legW * 0.72, hipY, 0);
  g.add(legL); g.add(legR);
  [legL, legR].forEach(function (lg) {
    skBox(lg, S.legW, hipY * 0.52, S.legW, P.pants, 0, -hipY * 0.26, 0);
    skBox(lg, S.legW * 0.92, hipY * 0.46, S.legW * 0.92, P.sock || P.pants, 0, -hipY * 0.73, 0);
    if (P.sock) {
      skBox(lg, S.legW * 1.02, 0.07, S.legW * 1.02, skShade(P.sock, 1.1), 0, -hipY * 0.50, 0);
    }
    skBox(lg, S.legW * 1.10, 0.16, S.legW * 1.34, P.boot, 0, -hipY + 0.09, 0.03);
    skBox(lg, S.legW * 1.16, 0.05, S.legW * 1.40, skShade(P.boot, 0.7), 0, -hipY + 0.01, 0.03);
  });

  skBox(g, S.torsoW, S.torsoH * 0.56, S.torsoD, P.shirt, 0, torsoTop - S.torsoH * 0.28, 0);
  skBox(g, S.torsoW * 0.84, S.torsoH * 0.30, S.torsoD * 0.92, P.shirt, 0, hipY + S.torsoH * 0.35, 0);
  skBox(g, S.torsoW * 0.95, S.torsoH * 0.22, S.torsoD * 0.98, P.shirt, 0, hipY + S.torsoH * 0.12, 0);
  skBox(g, 0.04, S.torsoH * 0.54, S.torsoD * 0.9, P.shirtS, -S.torsoW * 0.49, torsoTop - S.torsoH * 0.28, 0);
  skBox(g, 0.04, S.torsoH * 0.54, S.torsoD * 0.9, P.shirtS, S.torsoW * 0.49, torsoTop - S.torsoH * 0.28, 0);
  skBox(g, S.torsoW * 0.92, 0.12, S.torsoD * 0.96, P.belt, 0, hipY + 0.14, 0);
  skBox(g, 0.12, 0.12, 0.06, P.gold, 0, hipY + 0.14, S.torsoD * 0.50);

  function limb(x, y, w, h2, d, c) {
    var p = new THREE.Group();
    p.position.set(x, y, 0);
    skBox(p, w, h2, d, c, 0, -h2 / 2, 0);
    g.add(p);
    return p;
  }
  var armL = limb(-S.armX, shoulderY, S.armW, S.armLen, S.armW, P.shirtD);
  var armR = limb(S.armX, shoulderY, S.armW, S.armLen, S.armW, P.shirt);
  [armL, armR].forEach(function (ar, i3) {
    var sleeve = i3 === 0 ? P.shirtD : P.shirt;
    skBox(ar, S.armW * 1.04, S.armLen * 0.52, S.armW * 1.04, sleeve, 0, -S.armLen * 0.26, 0);
    skBox(ar, S.armW * 1.06, 0.06, S.armW * 1.06, skShade(sleeve, 1.2), 0, -S.armLen * 0.52, 0);
    skBox(ar, S.armW * 0.86, S.armLen * 0.40, S.armW * 0.86, P.skin, 0, -S.armLen * 0.74, 0);
    skBox(ar, S.armW * 0.94, 0.12, S.armW * 0.94, P.skin, 0, handY + 0.05, 0);
  });

  var headG = new THREE.Group(); headG.position.set(0, headY, 0); g.add(headG);
  skBox(headG, S.headW, S.headH, S.headD, P.skin, 0, 0, 0);
  skBox(headG, S.headW * 0.86, 0.06, S.headD * 0.9, P.skinS, 0, -S.headH * 0.48, S.headD * 0.04);
  skBox(g, S.armW * 0.86, 0.10, S.armW * 0.86, P.skinS, 0, torsoTop + 0.03, 0);

  /* ★ round508：男生走 skFaceM（5 个方案 ✗ def.eyes.st 选）✦ 女生照旧 ✓ */
  /* ★ round509：眼睛 10 款（男女各一套）+ 嘴巴 10 款，都由 def.eyes 指定 */
  var _eye = def.eyes || { w: 0.26, h: 0.30 };
  if (_cus) {
    _eye = { w: _eye.w, h: _eye.h };
    if (typeof _cus.ey === 'number') { _eye.st = Math.max(1, Math.min(10, _cus.ey + 1)); }
    if (typeof _cus.mo === 'number') { _eye.mo = Math.max(1, Math.min(10, _cus.mo + 1)); }
  }
  if (def.g === 'm') {
    skFaceM(headG, S, P, _eye, _eye.st || 1);
  } else {
    skFace(headG, S, P, _eye, _eye.st || 1);
  }
  skHair(headG, S, P, def.hair, def.pin);

  var backG = new THREE.Group();
  backG.position.set(0, torsoTop - 0.30, -S.torsoD * 0.5);
  g.add(backG);

  skOutfit(g, S, P, def, hipY, torsoTop);
  skAcc(g, headG, armL, armR, S, P, def.acc, backG, hipY, torsoTop);

  armL.rotation.x = 0.10; armR.rotation.x = -0.12;
  legL.rotation.x = 0.04; legR.rotation.x = -0.04;

  var handPivot = new THREE.Group();
  handPivot.position.set(0.0, handY, 0.02);
  armR.add(handPivot);
  var sw = new THREE.Group();
  sw.rotation.x = 0.55;
  handPivot.add(sw);
  fillHeldWeapon(sw, null, null);

  var handPivotL = new THREE.Group();
  handPivotL.position.set(0.0, handY, 0.02);
  armL.add(handPivotL);
  var swL = new THREE.Group();
  swL.rotation.x = 0.55;
  swL.visible = false;
  handPivotL.add(swL);

  /* ★ round509：把头的坐标也带回去 ✗ 皮肤页/预览页要对着脸取景 ✓
     （以前只能"猜"头的中心，女生的头发一高就取歪了 ✓） */
  return { g: g, armL: armL, armR: armR, legL: legL, legR: legR, sw: sw, swL: swL,
           h: headY + S.headH / 2,
           headY: headY, headH: S.headH, headW: S.headW, S: S };
}
/* ==================== SKINS END ==================== */

/* ============ 人物（小头 + 举剑 ✓）============
   ★ round485：带皮肤参数 —— hero('f03') 按皮肤搭；不传 / 未知 key → 老模型 ✓
     （老模型保留：老存档没 skin 字段时用 ✓ 也方便回退）*/
function hero(sk, custom) {
  if (sk && typeof skBuildHero === 'function') {
    var _skh = skBuildHero(sk, custom);
    if (_skh) { return _skh; }
  }
  var g = new THREE.Group();
  function mat(c) { return matOf(c); }   // ★ 第 44 轮：材质按颜色缓存复用（全场景几十个，不是几百个 ✓）
  function put(w, h2, d, c, x, y, z) {
    var b = new THREE.Mesh(new THREE.BoxGeometry(w, h2, d), mat(c));
    b.position.set(x, y, z); b.castShadow = true; g.add(b); return b;
  }
  var C = { skin: 0xf6cfa0, hair: 0x3e2c1e, shirt: 0x4ebec4, shirtD: 0x2c8e96,
            pants: 0x4e4eac, boot: 0x5e4a38, blade: 0xd8f0f4, guard: 0x7e7e92, belt: 0x8a6a42, gold: 0xe0bc60 };
  put(1.10, 1.02, 1.02, C.skin, 0, 2.46, 0);                       // 头（小 ✓）
  put(1.14, 0.34, 1.06, C.hair, 0, 2.86, 0);                       // 头发
  put(0.13, 0.40, 0.26, C.hair, -0.53, 2.66, 0.40);
  put(0.13, 0.40, 0.26, C.hair, 0.53, 2.66, 0.40);
  put(0.22, 0.22, 0.06, 0x2a2a2a, -0.23, 2.46, 0.53);
  put(0.22, 0.22, 0.06, 0x2a2a2a, 0.23, 2.46, 0.53);
  put(0.26, 0.06, 0.06, C.hair, -0.23, 2.64, 0.53);
  put(0.26, 0.06, 0.06, C.hair, 0.23, 2.64, 0.53);
  put(0.30, 0.08, 0.06, 0xb0685c, 0, 2.26, 0.53);                  // 嘴
  put(1.02, 0.98, 0.62, C.shirt, 0, 1.42, 0);                      // 身
  put(0.30, 0.16, 0.64, 0x88d4d8, 0, 1.86, 0);                     // 衣领
  put(1.06, 0.22, 0.66, C.belt, 0, 0.98, 0);                       // 腰带
  put(0.22, 0.22, 0.10, C.gold, 0, 0.98, 0.36);                    // 腰扣
  function limb(c, w, h2, d, x, y) {
    var p = new THREE.Group(); p.position.set(x, y, 0);
    var b = new THREE.Mesh(new THREE.BoxGeometry(w, h2, d), mat(c));
    b.position.y = -h2 / 2; b.castShadow = true; p.add(b); g.add(p); return p;
  }
  var armL = limb(C.shirtD, 0.30, 0.92, 0.30, -0.66, 1.82), armR = limb(C.shirt, 0.30, 0.92, 0.30, 0.66, 1.82);
  var legL = limb(C.pants, 0.34, 0.92, 0.34, -0.26, 0.86), legR = limb(0x3a3a84, 0.34, 0.92, 0.34, 0.26, 0.86);
  var b1 = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.30, 0.52), mat(C.boot)); b1.position.y = -1.0; legL.add(b1);
  var b2 = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.30, 0.52), mat(C.boot)); b2.position.y = -1.0; legR.add(b2);
  var hL = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.22, 0.32), mat(C.skin)); hL.position.y = -0.98; armL.add(hL);
  var hR = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.22, 0.32), mat(C.skin)); hR.position.y = -0.98; armR.add(hR);
  /* ★ 剑（握在手里 ✓ 绕手部枢轴 ✓）
     结构：swGroup（挂在手上 ✓ 位置 = 手 ✓）→ sw（可整体旋转 ✓ 前挥/下砍 ✓）
     剑身：从手部【向前上方】伸出（不是纯竖直 ✗ 是前倾 45° 待战姿态 ✓） */
  var handPivot = new THREE.Group();
  handPivot.position.set(0.0, -0.95, 0.02);          // 手的位置（右臂下端 ✓）
  armR.add(handPivot);
  var sw = new THREE.Group();
  sw.rotation.x = 0.55;                              // ★ 前倾（正号 = 向前下方 ✓ 之前负号=向后 ✗ 所以往背后砍 ✓）
  handPivot.add(sw);
  /* ★ 第 49 轮：手上这把不再是写死的剑 ✗ 而是按【当前武器】生成 ✓
     （数据就是那份已确认的示意图；换武器时 setWeapon → fillHeldWeapon 重建 ✓）
     ★ 攻击动画只认这个 Group 的 rotation，所以一行都不用改 ✓ */
  fillHeldWeapon(sw, null, null);   // 先按本地默认造一个 ✓ 远端玩家随后会被替换成他自己的 ✓
  /* ★★★ round387（用户："匕首只是模型做拿两个，不需要第二格武器槽"）★★★
     ★ 纯粹是【视觉】：左手也挂一个武器模型 ✗ 背包/属性完全不变 ✓
     ★ 只有匕首会用到 ✗ 其它武器左手空着（和以前一样 ✓）*/
  /* ★ round388（用户："位置不对在肩膀上了，应该也在手上握着"）
     ★ 根因：我直接把武器挂到了【手臂】上 ✗ 手臂的原点在肩膀 ✓
     ★ 修：和右手一样，先建一个"手部锚点"（在手臂下端）✗ 再挂武器 ✓ */
  var handPivotL = new THREE.Group();
  handPivotL.position.set(0.0, -0.95, 0.02);   // 和右手同一个偏移 ✓
  armL.add(handPivotL);
  var swL = new THREE.Group();
  swL.rotation.x = 0.55;
  swL.visible = false;
  handPivotL.add(swL);
  return { g: g, armL: armL, armR: armR, legL: legL, legR: legR, sw: sw, swL: swL,
           h: 2.97 };
}

/* ============================================================
   第一人称视图模型（手 + 当前武器）
   ★ 独立挂在相机上，不改变世界里的 H.g / 动画 / 碰撞
   ★ 只用程序方块 + 现有 buildWeaponMesh，不加素材
   ============================================================ */
function makeFPView() {
  var root = new THREE.Group();
  root.position.set(0.30, -0.10, -0.72);
  root.visible = false;

  var arm = new THREE.Group();
  arm.position.set(0, -0.02, 0);
  arm.rotation.x = -0.10;
  root.add(arm);

  var sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.36, 0.18), matOf(0x4ebec4));
  sleeve.position.y = -0.16;
  sleeve.castShadow = false;
  arm.add(sleeve);

  var hand = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.16, 0.19), matOf(0xf6cfa0));
  hand.position.set(0, -0.30, 0.01);
  hand.castShadow = false;
  arm.add(hand);

  var sw = new THREE.Group();
  sw.position.set(0.02, -0.33, -0.02);
  sw.rotation.set(-1.02, 0, 0.10);
  sw.scale.setScalar(0.28);
  arm.add(sw);

  /* 左手露一点，避免只有一只右手显得悬空 */
  var left = new THREE.Group();
  left.position.set(-0.28, -0.18, -0.06);
  left.visible = false;
  left.rotation.x = -0.18;
  root.add(left);
  var lhand = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.15, 0.18), matOf(0xf6cfa0));
  lhand.position.y = -0.06;
  lhand.castShadow = false;
  left.add(lhand);

  return { root: root, arm: arm, sw: sw, left: left };
}

function fpRefreshWeapon() {
  if (!FP || !FP.sw) { return; }
  try {
    fillHeldWeapon(FP.sw, null, null);
    FP.sw.scale.setScalar(0.28);
  } catch (e) { }
}

function fpViewTick(dt) {
  if (!FP) { return; }
  var show = (CAM_VIEW === 'first' && !dead);
  FP.root.visible = show;
  if (typeof FP.sw !== 'undefined' && FP.sw) { FP.sw.visible = !SAFE_MODE; }
  if (!show) { return; }

  var mv = (typeof MOV !== 'undefined' && MOV && Math.hypot(MOV.vx || 0, MOV.vz || 0) > 0.05);
  var wt = (typeof walkT === 'number') ? walkT : (performance.now() / 700);
  var bob = mv ? Math.sin(wt * 2) * 0.012 : Math.sin(performance.now() / 900) * 0.004;
  FP.root.position.set(0.30 + (mv ? Math.sin(wt) * 0.006 : 0),
                       -0.10 + bob, -0.72);

  var swing = 0;
  if (typeof atkT === 'number' && atkT >= 0) {
    var p = Math.max(0, Math.min(1, atkT / 0.86));
    swing = Math.sin(p * Math.PI);
  }
  FP.arm.rotation.x = -0.10 + swing * 0.62;
  FP.sw.rotation.x = -1.02 + swing * 0.72;
  FP.sw.rotation.z = 0.10 - swing * 0.55;
  FP.left.rotation.x = -0.18 + swing * 0.30;
}

/* ★ 妖兽头顶 UI（血条 + 名字 ✓ 用 CSS 元素 + 每帧投影到屏幕 ✓）*/

/* mkMobUI 已搬到 platform/web.js */

var _mv3 = null;

/* ★★★ round497：视角转动（用户："加一个按钮，点击后开启，再点击锁定"）★★★
   ★ CAM_YAW = 0 时相机公式【完全退化】成原来的样子 ✗ 零回归 ✓
   ★ CAM_PITCH 原来是常量 G.CAM_PITCH ✗ 现在可调（上下俯仰）✓
   ★ 状态由 platform 层持有（按钮/手势/存档都在那边 ✓ core 只负责算）*/
var CAM_YAW0 = -0.184;                 /* ★ round596：默认水平角 = 半个六道的朝向 */
var CAM_VIEW_START = (typeof CAM_VIEW_START !== 'undefined') ? CAM_VIEW_START : undefined;
var CAM_PITCH_START = (typeof CAM_PITCH_START !== 'undefined') ? CAM_PITCH_START : undefined;
var CAM_VIEW = (typeof CAM_VIEW_START !== 'undefined') ? CAM_VIEW_START : 'free';  /* 默认自由视角；platform 先读存档 */
var CAM_YAW = CAM_YAW0;                       /* 当前水平角（渲染用，平滑后的值 ✓）*/
var CAM_YAW_T = CAM_YAW0;                     /* 目标水平角（拖动直接改它 ✓）*/
var CAM_PITCH = (typeof CAM_PITCH_START !== 'undefined') ? CAM_PITCH_START
  : ((typeof G !== 'undefined' && G.CAM_PITCH) ? G.CAM_PITCH : 1.02);
var CAM_PITCH_T = CAM_PITCH;
var CAM_PITCH_MIN = 0.02, CAM_PITCH_MAX = Math.PI / 2 - 0.02;

/* ★★★ round498（用户："视角转动不流畅"）
   ★ 根因：拖动时【每一帧直接把角度设成手指位置】✗
     手指事件是一阵一阵来的（触摸采样不稳 / 丢事件）✗
     → 角度跟着一小步一小步跳 ✗ 看着就是"一顿一顿" ✓
   ★ 修：拖动只改【目标角】✗ 渲染时用指数平滑追上去 ✓
     （和相机高度那个 _camY 缓动同一套思路 ✓ 这个项目里最稳的平滑方式 ✓）
   ★ 平滑系数 18/秒：约 60ms 追平 → 跟手又不抖 ✓*/
function _camNorm(a) {
  var PI2 = Math.PI * 2;
  return ((a % PI2) + PI2 + PI2 / 2) % PI2 - PI2 / 2;
}
function camAdd(dx, dy) {
  /* 像素 → 弧度：100px ≈ 34°（比原来稍快一点 ✗ 转一圈不用拖太远 ✓）*/
  CAM_YAW_T = _camNorm(CAM_YAW_T + (+dx || 0) * 0.0060);
  CAM_PITCH_T = Math.max(CAM_PITCH_MIN,
                 Math.min(CAM_PITCH_MAX, CAM_PITCH_T + (+dy || 0) * 0.0035));
}
function camStep(dt) {
  var k = Math.min(1, (dt > 0 ? dt : 0.016) * 18);
  /* ★ 走短路：差得很近就干脆对齐（避免永远差一丁点）*/
  var dy2 = CAM_YAW_T - CAM_YAW;
  if (Math.abs(dy2) < 0.0008) { CAM_YAW = CAM_YAW_T; }
  else { CAM_YAW += dy2 * k; }
  var dp2 = CAM_PITCH_T - CAM_PITCH;
  if (Math.abs(dp2) < 0.0008) { CAM_PITCH = CAM_PITCH_T; }
  else { CAM_PITCH += dp2 * k; }
}
function camReset() {
  CAM_YAW_T = CAM_YAW0; CAM_PITCH_T = (G.CAM_PITCH || 1.02);
  CAM_YAW = CAM_YAW0; CAM_PITCH = CAM_PITCH_T;
}
function camState() { return { yaw: CAM_YAW_T, pitch: CAM_PITCH_T }; }
function camSet(yaw, pitch) {
  CAM_YAW_T = _camNorm(isFinite(+yaw) ? +yaw : CAM_YAW0);
  CAM_PITCH_T = Math.max(CAM_PITCH_MIN,
                 Math.min(CAM_PITCH_MAX, +pitch || (G.CAM_PITCH || 1.02)));
  CAM_YAW = CAM_YAW_T; CAM_PITCH = CAM_PITCH_T;   /* 读档时直接就位 ✗ 不从 0 转过去 ✓ */
}

/* ★ round490：名字/血条的高度【按皮肤算】✗ 不再写死 3.05 / 3.2 ✓
   ★ 为什么是 +1.75：老模型头顶 2.97 × 0.42 = 1.25，原来写死 3.05 → 差 1.80 ✓
     取 1.75 让默认皮肤和以前几乎一样（3.02 vs 3.05）✓
   ★ 高个皮肤（龙裔 3.30）→ 1.39+1.75 = 3.14 ✓ 矮个（侏儒 2.53）→ 1.06+1.75 = 2.81 ✓
     也就是"名字始终在头顶上方约 1.75 世界单位"✓ 不会插进头发里 ✓ */
function heroPlateY(h, size) {
  var hh = (h && typeof h.h === 'number' && h.h > 0) ? h.h : 2.97;
  /* ★ round576：坦克引擎体型变大后，名牌也要跟着抬高 ✓ */
  var _sz = (typeof size === 'number' && size > 0) ? size : 1;
  return hh * G.HERO_SCALE * _sz + 0.61;
}

/* ★ round576：坦克引擎体型（服务端 me.sz / 快照 sz 下发 ✓）
   ★ 只缩放模型 ✗ 不碰碰撞箱/攻击距离（和原来一样 ✓） */
var MY_SIZE = 1;
var SAFE_MODE = false;   /* 小镇安全区：收起战斗状态 */
/* ★ round576：嗜血临时增益（服务端 me.atkSpd / me.moveSpd ✓）*/
var MY_ATK_SPD = 1, MY_MOVE_SPD = 1;
/* ★ round581：冻结/减速（服务端 me.frz / me.slow ✓）*/
var MY_FROZEN = 0, MY_SLOW = 1;
var MY_DOWN = 0;   // ★ round593：天罚击倒剩余秒（和冰冻分开显示）
function heroScaleOf(sz) {
  var s = (typeof sz === 'number' && sz > 0) ? sz : 1;
  return G.HERO_SCALE * s;
}
/* 打工动画：柜台招呼 -> 端盘 -> 巡视 -> 回柜台（服务端广播给自己的和别人的一样） */
function jobTick(dt) {
  if (!MY_JOB || !H || !H.g) { return; }
  var T = (typeof JOB_T === 'number') ? JOB_T : 0;
  var ph = T % 12;
  var bob = Math.sin(T * 6) * 0.04;
  H.g.position.y = P.y + bob;
  if (ph < 3) {
    H.armR.rotation.x = -0.35 + Math.sin(T * 5) * 0.18;
    H.armL.rotation.x = 0;
  } else if (ph < 8) {
    H.armR.rotation.x = -1.15;
    H.armL.rotation.x = -1.05;
    H.g.rotation.y = P.yaw + Math.sin(T * 1.6) * 0.5;
  } else {
    H.armR.rotation.x = -0.2;
    H.armL.rotation.x = 0;
  }
}

var EAT_T = -1, EAT_OBJ = null;
function eatStart(kind) {
  if (!H || !H.armR) { return; }
  if (EAT_OBJ) { try { H.armR.remove(EAT_OBJ); } catch (e0) { } EAT_OBJ = null; }
  var g = new THREE.Group();
  g.position.set(0, -0.92, 0.14);
  var c = 0xffe0c0;
  if (kind === 'bowl') {
    var bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.14, 0.14, 12), matOf(0xd8c8b0));
    g.add(bowl);
    var food = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.04, 10), matOf(0xc88a4a));
    food.position.y = 0.08; g.add(food);
  } else if (kind === 'bread' || kind === 'cake') {
    var b = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.16), matOf(kind === 'cake' ? 0xe8a8b8 : 0xd8a45a));
    g.add(b);
  } else if (kind === 'bottle') {
    var bt = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.28, 10), matOf(0x9fe0c0));
    g.add(bt);
  } else if (kind === 'pill') {
    var pl = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), matOf(0xffd080));
    g.add(pl);
  } else if (kind === 'crystal') {
    var cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), townGlowMat(0x9fe8ff, 0.9));
    g.add(cr);
  } else if (kind === 'scroll') {
    var sc = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.26, 8), matOf(0xe8dcc8));
    sc.rotation.z = Math.PI / 2; g.add(sc);
  } else {
    var cup = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.10, 0.26, 10), matOf(0xe8dcc8));
    g.add(cup);
    var tea = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.03, 10), matOf(0xb4784a));
    tea.position.y = 0.12; g.add(tea);
    var straw = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.30, 6), matOf(0xe06a8a));
    straw.position.set(0.05, 0.15, 0.02); straw.rotation.z = -0.25; g.add(straw);
  }
  g.scale.setScalar(1.5);
  H.armR.add(g);
  EAT_OBJ = g;
  EAT_T = 0;
  if (H.sw) { H.sw.visible = false; }
}
function eatTick(dt) {
  if (EAT_T < 0 || !H) { return; }
  EAT_T += dt;
  var t = Math.min(1, EAT_T / 1.35);
  var raise = Math.min(1, t * 3.2);
  H.armR.rotation.x = -0.15 - 1.15 * raise + Math.sin(t * 20) * 0.04;
  H.armR.rotation.z = -0.25 * raise;
  if (t >= 1) {
    if (EAT_OBJ) { try { H.armR.remove(EAT_OBJ); } catch (e1) { } EAT_OBJ = null; }
    EAT_T = -1;
    H.armR.rotation.x = 0; H.armR.rotation.z = 0;
    if (!SAFE_MODE && !MY_SEAT && !MY_SLEEP && H.sw) { H.sw.visible = true; }
  }
}

function safeModeSet(on) {
  on = !!on;
  if (on === SAFE_MODE) { return; }
  SAFE_MODE = on;
  try { if (typeof UI !== 'undefined' && UI.setSafeMode) { UI.setSafeMode(on); } } catch (e0) { }
  try { if (typeof AUTO !== 'undefined' && AUTO) { AUTO.on = false; } } catch (e1) { }
  applyMySize();
  if (on) {
    try { if (H && H.sw) { H.sw.visible = false; } } catch (e2) { }
    try { if (typeof FP !== 'undefined' && FP && FP.sw) { FP.sw.visible = false; } } catch (e3) { }
  } else {
    try { if (H && H.sw) { H.sw.visible = true; } } catch (e4) { }
    try { if (typeof FP !== 'undefined' && FP && FP.sw) { FP.sw.visible = true; } } catch (e5) { }
  }
}

function workerVisible(on) {
  try {
    if (!H || !H.g) { return; }
    if (typeof MY_JOB !== 'undefined' && MY_JOB) { return; }
    /* 打工时：身体可见（第三人称），武器和第一人称手隐藏 */
    H.g.visible = true;
    if (H.sw) { H.sw.visible = !on && !SAFE_MODE && !MY_SEAT && !MY_SLEEP; }
    if (typeof FP !== 'undefined' && FP && FP.sw) { FP.sw.visible = !on && !SAFE_MODE; }
  } catch (e0) { }
}

function heroVisualSize() { return SAFE_MODE ? 1 : MY_SIZE; }
function applyMySize() {
  try {
    if (!H || !H.g) { return; }
    var s = heroScaleOf(heroVisualSize());
    H.g.scale.set(s, s, s);
    if (H.shadow) { H.shadow.scale.setScalar(heroVisualSize()); }
  } catch (e) { }
}

/* ★ round485：当前皮肤（登录后由服务端下发，空 = 老模型 ✓）*/
var MY_SKIN = '';
/* ★ round510：当前皮肤的自定义（瞳色/发色/衣服/眼型/嘴型）✗ 空 = 原样 ✓ */
var MY_SKIN_CUSTOM = null;
/* MY_SKIN 由服务端下发（登录后设），本地视觉测试走 tools/test_skin_rig.html ✓ */

/* ★ 换自己的皮肤：重建模型，但保留位置/朝向/当前武器 ✓
   ★ 为什么能重建：皮肤只影响外观 ✗ 动画只认 armL/armR/legL/legR/sw 这几个枢轴 ✓
   ★ 材质是全局缓存的 ✗ 只 dispose 几何体 ✓ 不动材质 ✓ */
function skinRebuildSelf() {
  try {
    if (!H || !H.g) { return; }
    var px = H.g.position.x, py = H.g.position.y, pz = H.g.position.z;
    var ry = H.g.rotation.y;
    var _oldShadow = H.shadow || null;      /* ★ round583：换皮肤不能把脚下影子弄丢 */
    scene.remove(H.g);
    H.g.traverse(function (o) { if (o.isMesh && o.geometry) { o.geometry.dispose(); } });
    H = hero(MY_SKIN, MY_SKIN_CUSTOM);      /* ★ round510：带上自定义 */
    H.g.scale.set(heroScaleOf(MY_SIZE), heroScaleOf(MY_SIZE), heroScaleOf(MY_SIZE));
    H.g.position.set(px, py, pz);
    H.g.rotation.y = ry;
    scene.add(H.g);
    if (_oldShadow) {
      H.shadow = _oldShadow;
      H.shadow.visible = true;
      H.shadow.scale.setScalar(MY_SIZE);
    } else {
      H.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.62, 16),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true,
                                      opacity: 0.26, depthWrite: false }));
      H.shadow.rotation.x = -Math.PI / 2;
      H.shadow.scale.setScalar(MY_SIZE);
      scene.add(H.shadow);
    }
    /* 手上的武器按当前武器重建（换皮肤不该把剑弄丢 ✓）*/
    var _mw = (typeof MY_WEAPON !== 'undefined') ? MY_WEAPON : null;
    if (_mw && _mw.look) {
      fillHeldWeapon(H.sw, _mw.look, +(_mw.tier || 0), H.swL);
    } else {
      fillHeldWeapon(H.sw, null, null);
    }
  } catch (e) { }
}
function skinApplySelf(key, custom) {
  var k = (typeof key === 'string' && typeof SKIN_DEFS !== 'undefined' && SKIN_DEFS[key]) ? key : '';
  /* ★ round511：自定义也一起（颜色/眼型/嘴型）✗ 变了就要重建 ✓ */
  var _cNew = (custom && typeof custom === 'object') ? JSON.stringify(custom) : '';
  var _cOld = MY_SKIN_CUSTOM ? JSON.stringify(MY_SKIN_CUSTOM) : '';
  if (k === MY_SKIN && _cNew === _cOld) { return; }
  MY_SKIN = k;
  MY_SKIN_CUSTOM = (custom && typeof custom === 'object') ? custom : null;
  skinRebuildSelf();
}

/* 皮肤页数据（服务端推的 40 个状态 ✓ 界面下一步做，先存着） */
var SKIN_PAGE = { items: [], start: 20000, step: 5000, gold: 0 };

/* ============ ★ 手上的武器（第 49 轮，方案 §7.4 / §7.10）============
   数据 = 已确认的示意图（tools/preview_weapons.html 第 47 轮定稿 ✓）
   ★★ 关键：同一份数据同时生成两样东西 ★★
        ① 3D 模型（主角手上那把 ✓）
        ② 平面图标（背包格子里的 ✓）—— 就是"武器的平面微缩版"：
           把每个零件按 (x,y,宽,高,旋转) 直接投影成 SVG 矩形 ✓
      所以图标和模型永远一致，改一处两处都对 ✓ 而且不加任何素材 ✓

   格式：[宽, 高, 厚, 颜色, x, y, z, 绕Z旋转(可选)]
   ★ 颜色参照（钢/木/铁/金…）和示意图里那套 MAT 一致 ✓ */
var W_MAT = {
  steel: 0xd8f0f4, steelD: 0x9aa8b0, dark: 0x4a5058, wood: 0x6a4a2a, woodD: 0x4a3218,
  gold: 0xe0bc60, iron: 0x7e7e92, wrap: 0x3a3a40, red: 0xc04030, tip: 0xf4ffff
};

/* 刀（单刀）：刃按【同一个圆】算每段的位置和切线角 —— 首尾微重叠、绝不留缝 ✓
   （手摆的话段间有缝，看着像一串断方块 ✗ 示意图第二版就是这么改的）*/
function saberPartsOf() {
  var R = 2.80, T = 0.60, N = 9, y0 = 0.30;
  var out = [
    [0.14, 0.10, 0.14, W_MAT.gold, 0, -0.26, 0],
    [0.07, 0.26, 0.05, W_MAT.red, 0.10, -0.38, 0],
    [0.06, 0.20, 0.05, W_MAT.red, 0.15, -0.60, 0],
    [0.05, 0.14, 0.04, W_MAT.red, 0.19, -0.78, 0],
    [0.14, 0.38, 0.13, W_MAT.wrap, 0, -0.02, 0],
    [0.48, 0.09, 0.48, W_MAT.gold, 0, 0.24, 0, 0, 0, 1]      // 圆盘护手（末位 1 = 圆柱 ✓）
  ];
  for (var i = 0; i < N; i++) {
    var t0 = T * i / N, t1 = T * (i + 1) / N, tm = (t0 + t1) / 2;
    var len = R * (t1 - t0) * 1.08;
    var px = R * (1 - Math.cos(tm)), py = y0 + R * Math.sin(tm);
    var w = 0.18 + 0.06 * (i / (N - 1));
    out.push([w, len, 0.055, W_MAT.steel, px, py, 0, -tm]);
    var off = w * 0.44;
    out.push([w * 0.26, len, 0.045, W_MAT.tip,
              px - off * Math.cos(tm), py + off * Math.sin(tm), 0, -tm]);
  }
  var te = T, pex = R * (1 - Math.cos(te)), pey = y0 + R * Math.sin(te);
  out.push([0.13, 0.22, 0.05, W_MAT.tip,
            pex + 0.10 * Math.sin(te), pey + 0.10 * Math.cos(te), 0, -te]);
  return out;
}

var WEAPON_PARTS = {
  dagger: [
    [0.11, 0.26, 0.11, W_MAT.wrap, 0, 0.00, 0],
    [0.15, 0.08, 0.15, W_MAT.gold, 0, -0.16, 0],
    [0.32, 0.07, 0.11, W_MAT.iron, 0, 0.17, 0],
    [0.15, 0.30, 0.06, W_MAT.steel, 0, 0.36, 0],
    [0.12, 0.26, 0.05, W_MAT.steel, 0, 0.62, 0],
    [0.07, 0.20, 0.05, W_MAT.tip, 0, 0.83, 0]
  ],
  sword: [
    [0.18, 0.10, 0.18, W_MAT.gold, 0, -0.20, 0],
    [0.12, 0.34, 0.12, W_MAT.woodD, 0, -0.02, 0],
    [0.48, 0.10, 0.16, W_MAT.iron, 0, 0.19, 0],
    [0.16, 0.62, 0.07, W_MAT.steel, 0, 0.52, 0],
    [0.13, 0.44, 0.06, W_MAT.steel, 0, 1.05, 0],
    [0.09, 0.26, 0.05, W_MAT.tip, 0, 1.40, 0]
  ],
  staff: [
    [0.10, 2.20, 0.10, W_MAT.wood, 0, 0.94, 0],
    [0.15, 0.12, 0.15, W_MAT.iron, 0, 2.02, 0],
    [0.15, 0.12, 0.15, W_MAT.iron, 0, -0.14, 0],
    [0.14, 0.36, 0.14, W_MAT.wrap, 0, 0.10, 0]
  ],
  spear: [
    [0.09, 2.20, 0.09, W_MAT.wood, 0, 0.96, 0],
    [0.14, 0.36, 0.14, W_MAT.wrap, 0, 0.10, 0],
    [0.16, 0.12, 0.16, W_MAT.red, 0, 2.14, 0],
    [0.15, 0.12, 0.15, W_MAT.iron, 0, 2.32, 0],
    [0.22, 0.30, 0.06, W_MAT.steel, 0, 2.52, 0],
    [0.14, 0.26, 0.05, W_MAT.steel, 0, 2.78, 0],
    [0.08, 0.22, 0.05, W_MAT.tip, 0, 3.00, 0]
  ],
  axe: [
    [0.22, 0.12, 0.22, W_MAT.iron, 0, -0.24, 0],
    [0.18, 0.40, 0.18, W_MAT.wrap, 0, 0.12, 0],
    [0.14, 1.90, 0.14, W_MAT.wood, 0, 0.92, 0],
    [0.30, 0.34, 0.30, W_MAT.dark, 0, 1.60, 0],
    [0.22, 0.86, 0.14, W_MAT.iron, 0.22, 1.60, 0],
    [0.24, 0.62, 0.13, W_MAT.iron, 0.40, 1.60, 0],
    [0.18, 0.42, 0.12, W_MAT.iron, 0.54, 1.60, 0],
    [0.09, 0.26, 0.11, W_MAT.tip, 0.66, 1.60, 0],
    [0.22, 0.86, 0.14, W_MAT.iron, -0.22, 1.60, 0],
    [0.24, 0.62, 0.13, W_MAT.iron, -0.40, 1.60, 0],
    [0.18, 0.42, 0.12, W_MAT.iron, -0.54, 1.60, 0],
    [0.09, 0.26, 0.11, W_MAT.tip, -0.66, 1.60, 0]
  ],
  hammer: [
    [0.20, 0.12, 0.20, W_MAT.iron, 0, -0.22, 0],
    [0.17, 0.36, 0.17, W_MAT.wrap, 0, 0.12, 0],
    [0.13, 1.60, 0.13, W_MAT.woodD, 0, 0.80, 0],
    [0.28, 0.26, 0.28, W_MAT.iron, 0, 1.50, 0],
    [0.72, 0.64, 0.64, W_MAT.dark, 0, 1.76, 0],
    [0.84, 0.12, 0.66, W_MAT.iron, 0, 1.76, 0],
    [0.10, 0.54, 0.54, W_MAT.steel, 0.42, 1.76, 0],
    [0.10, 0.54, 0.54, W_MAT.steel, -0.42, 1.76, 0]
  ],
  bow: [
    [0.15, 0.42, 0.13, W_MAT.wrap, 0, 1.00, 0],
    [0.10, 0.36, 0.09, W_MAT.wood, 0.06, 1.36, 0, -0.20],
    [0.10, 0.32, 0.09, W_MAT.wood, 0.20, 1.62, 0, -0.38],
    [0.09, 0.24, 0.08, W_MAT.wood, 0.40, 1.78, 0, -0.70],
    [0.10, 0.36, 0.09, W_MAT.wood, 0.06, 0.64, 0, 0.20],
    [0.10, 0.32, 0.09, W_MAT.wood, 0.20, 0.38, 0, 0.38],
    [0.09, 0.24, 0.08, W_MAT.wood, 0.40, 0.22, 0, 0.70],
    [0.04, 1.62, 0.03, 0xe8e8e0, 0.46, 1.00, 0]
  ]
};
var TYPE_CN = {
  dagger: '匕首', sword: '单手剑', saber: '刀', staff: '长棍',
  spear: '长枪', axe: '双手斧', hammer: '锤', bow: '弓'
};

/* 品阶 → 颜色倾向 + 发光强度（方案 §7.10：锈蚀→精铁→玄铁→灵器→神品 ✓）*/
var W_TIER = [
  /* 保留原来的品阶色系：0-9 原色，10 改成深金（避免和 4 阶亮黄几乎一样），11 最高阶红 */
  { mix: 0xbfa88a, k: 0.55, glow: 0 }, { mix: 0x8fd28a, k: 0.55, glow: 0 },
  { mix: 0x8fc4ff, k: 0.55, glow: 0 }, { mix: 0xc08fff, k: 0.55, glow: 0 },
  { mix: 0xffd83d, k: 0.55, glow: 0.25 }, { mix: 0xff9a5c, k: 0.55, glow: 0.25 },
  { mix: 0xff6a5c, k: 0.55, glow: 0.25 }, { mix: 0xff5cf0, k: 0.55, glow: 0.45 },
  { mix: 0x5cf0ff, k: 0.55, glow: 0.45 }, { mix: 0xffffff, k: 0.35, glow: 0.45 },
  { mix: 0xe0b830, k: 0.55, glow: 0.85 }, { mix: 0xff3b30, k: 0.55, glow: 0.85 }
];
function mixHex(a, b, k) {
  var ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  var br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  var r = Math.round(ar + (br - ar) * k), g = Math.round(ag + (bg - ag) * k);
  var bl = Math.round(ab + (bb - ab) * k);
  return (r << 16) | (g << 8) | bl;
}
function weaponGlowOf(tier) { return (W_TIER[Math.max(0, Math.min(11, tier | 0))] || W_TIER[0]).glow; }

/* 取某个类型 + 品阶的零件（含品阶改色 ✓ 和"越好的越精细"的一点加成 ✓）*/
function weaponPartsOf(look, tier) {
  var base = (look === 'saber') ? saberPartsOf() : (WEAPON_PARTS[look] || WEAPON_PARTS.sword);
  var k = Math.max(0, Math.min(11, tier | 0));
  var T = W_TIER[k] || W_TIER[0];
  var out = [];
  for (var i = 0; i < base.length; i++) {
    var p = base[i];
    var np = p.slice();
    np[3] = mixHex(p[3], T.mix, T.k);
    out.push(np);
  }
  // ★ "越好的越精细"：高阶多加一点装饰（通用的，不做 8 套 ✓）
  if (k >= 7) {
    out.push([0.16, 0.16, 0.16, mixHex(W_MAT.gold, T.mix, 0.2), 0, -0.34, 0]);   // 尾珠
  }
  if (k >= 4) {
    out.push([0.30, 0.10, 0.10, mixHex(W_MAT.steel, T.mix, 0.3), 0, 0.06, 0.10]); // 护手一点缀
  }
  return out;
}

/* 造一个武器网格（拿在手上用 ✓）
   ★ 发光材质要【每个网格克隆一份】—— 共享材质改 emissive 会让所有同色的东西一起发光 ✗
     克隆出来的打个 __mine 标记，换武器时只销毁自己的 ✓ */
function buildWeaponMesh(look, tier) {
  var g = new THREE.Group();
  var parts = weaponPartsOf(look, tier);
  var glow = weaponGlowOf(tier);
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    var geo = p[9] ? new THREE.CylinderGeometry(p[0] / 2, p[0] / 2, p[1], 14)
                   : new THREE.BoxGeometry(p[0], p[1], p[2]);
    var m;
    if (glow > 0) {
      m = new THREE.MeshLambertMaterial({ color: p[3] });
      m.emissive = new THREE.Color(p[3]);
      m.emissiveIntensity = glow * 0.75;
      m.__mine = 1;
    } else {
      m = matOf(p[3]);
    }
    var mesh = new THREE.Mesh(geo, m);
    mesh.position.set(p[4] || 0, p[5] || 0, p[6] || 0);
    if (p[7]) { mesh.rotation.z = p[7]; }
    mesh.castShadow = true;
    g.add(mesh);
  }
  return g;
}

/* 把"手上那把"换成新的（换武器时调 ✓ 攻击动画不用改 —— 它只认这个 Group 的旋转 ✓）*/
function fillHeldWeapon(sw, look, tier, swL) {
  /* ★★ 第 65 轮：加了 look / tier 两个参数 ★★
     以前它直接读全局 MY_WEAPON ✗ → 别人的小人也会拿【你的】武器 ✗
     （用户报的："我拿弓箭，别的玩家手里也显示弓箭"✓）
     ★ 不传就还是用 MY_WEAPON（本地玩家那条路照旧 ✓ 不用改调用点 ✗）*/
  if (!sw) { return; }
  for (var i = sw.children.length - 1; i >= 0; i--) {
    var c = sw.children[i];
    sw.remove(c);
    if (c.geometry) { c.geometry.dispose(); }
    if (c.material && c.material.__mine) { c.material.dispose(); }   // ★ 只销毁自己克隆的 ✓
  }
  var w = MY_WEAPON;
  var useLook = look || (w ? w.look : 'sword');
  var useTier = (tier === undefined || tier === null) ? (w ? (w.tier || 0) : 0) : tier;
  var g = buildWeaponMesh(useLook, useTier);
  /* ★★ 第 70 轮：弓单独一套握法（用户报“拿反了”）★★
     弓是竖着握的（弓臂在上下 ✓），不是像刀剑那样“刃朝前” ✗
     → 绕 Z 转 90° 立起来 + 绕 X 程微前倾 ✓
     ★ 踩过的坑：我一开始把这段插在上面 ✗
       那时 g 还没定义 → 一持弓就 ReferenceError → 整个渲染循环挂掉 ✗✗
       （表现是“进世界后报错”+所有快照字段 undefined ✗）*/
  /* ★★ 第 54 轮：刀刃朝向修正（用户报的"拿着斧头时刀刃不是朝下"）★★
     病根：零件数据是"宽在 X、薄在 Z"——
           也就是【正面看是刀的平面】（示意图就是这么画的 ✓ 所以图标也好看 ✓）
           但挥砍动画是绕 X 轴往下劈 ✗
           不转的话，砸下去的是刀【面】而不是刀【刃】✗（等于拿刀背拍人）
     修法：整把武器绕自身 Y 轴转 -90° → 原来朝 ±X 的刃口变成朝 ±Z（正前/正后）✓
           往下劈时刃先着 ✓
     ★ 八种武器一起修好（不是只修斧头）—— 因为它们共用同一套"宽在X"的数据 ✓
     ★ 图标不受影响：图标是"沿 -Z 看的平面投影"，正是示意图那个角度 ✓ */
  /* ★★ 第 71 轮：弓要【前后对调】= 在上面那 -90° 之外再多转 180° ★★
     为什么写在这儿：下面这行是【整体赋值】✗ 不是叠加 ✗
     我上一版在上面单独写了一句 g.rotation.set(0, Math.PI, 0) ✓
     → 紧接着就被这一行覆盖掉了 ✗（所以"改了没效果"✓ 用户一眼看出来还是反的 ✓）
     → 结论：弓的修正必须【折进这一行】✓ */
  /* ★ round396（用户："刀拿反了，刀尖朝自己"）
     ★ 和弓那次【同一种修法】：绕 Y 轴翻 180° ✓ 刀尖就朝前了 ✓ */
  g.rotation.y = -Math.PI / 2 + ((useLook === 'bow') ? Math.PI : 0)
               + ((useLook === 'saber') ? Math.PI : 0);
  /* ★ ★ 第 72 轮 用户报：“弓和手臂贴的太紧了” ★★
     弓本来就比刀剑宽（弓臂向两侧弯）→ 直接套在手上会和前臂穿模 ✗
     → 往【前、上、外】各推开一点 ✓（只对弓生效 ✓ 其他武器手感不变 ✗）*/
  if (useLook === 'bow') {
    g.position.set(0.30, -0.06, 0.22);   // ★ 第 74 轮：用户说靠上了→往下移 ✓
  }
  sw.add(g);
  /* ★ round387：匕首 → 左手也放一把（纯视觉 ✓ 背包里还是一把 ✓）
     ★ 其它武器：左手槽清空并隐藏 ✓ 不会多出来一把斧头 ✓ */
  if (swL) {
    for (var j = swL.children.length - 1; j >= 0; j--) {
      var c2 = swL.children[j];
      swL.remove(c2);
      if (c2.geometry) { c2.geometry.dispose(); }
    }
    if (useLook === 'dagger') {
      var g2 = buildWeaponMesh(useLook, useTier);
      g2.rotation.y = -Math.PI / 2;
      g2.scale.set(0.92, 0.92, 0.92);        // 左手那把略小一点 ✗ 免得两只一样大看着呆 ✓
      swL.add(g2);
      swL.visible = true;
    } else {
      swL.visible = false;
    }
  }
  return sw;
}

/* ★★ 平面微缩图标（用户要的）★★
   就是把同一份零件按 (x, y, 宽, 高, 旋转) 投影成 SVG 矩形 ✓
   —— 所以它天然长得就像那把武器 ✓ 也永远和 3D 模型一致 ✓ */
function weaponIconSvg(look, tier) {
  var parts = weaponPartsOf(look, tier);
  var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    var a = p[7] || 0, ca = Math.cos(a), sa = Math.sin(a);
    var hw = p[0] / 2, hh = p[1] / 2;
    for (var c = 0; c < 4; c++) {
      var lx = (c === 0 || c === 3) ? -hw : hw;
      var ly = (c < 2) ? -hh : hh;
      var wx = (p[4] || 0) + lx * ca - ly * sa;
      var wy = (p[5] || 0) + lx * sa + ly * ca;
      if (wx < minX) { minX = wx; }
      if (wx > maxX) { maxX = wx; }
      if (wy < minY) { minY = wy; }
      if (wy > maxY) { maxY = wy; }
    }
  }
  var pad = Math.max(0.12, (maxY - minY) * 0.06);
  var vb = (minX - pad) + ' ' + (-(maxY + pad)) + ' ' + ((maxX - minX) + pad * 2) + ' ' +
           ((maxY - minY) + pad * 2);
  var s = '<svg viewBox="' + vb + '" preserveAspectRatio="xMidYMid meet">' +
          '<g transform="scale(1,-1)">';
  for (var j = 0; j < parts.length; j++) {
    var q = parts[j];
    var col = '#' + ('000000' + (q[3] | 0).toString(16)).slice(-6);
    var tr = q[7] ? (' transform="rotate(' + (-q[7] * 180 / Math.PI) + ' ' + (q[4] || 0) + ' ' +
                     (q[5] || 0) + ')"') : '';
    if (q[9]) {   // 圆柱 → 一个圆 ✓
      s += '<circle cx="' + (q[4] || 0) + '" cy="' + (q[5] || 0) + '" r="' + (q[0] / 2) +
           '" fill="' + col + '"' + tr + '/>';
    } else {
      s += '<rect x="' + ((q[4] || 0) - q[0] / 2) + '" y="' + ((q[5] || 0) - q[1] / 2) +
           '" width="' + q[0] + '" height="' + q[1] + '" fill="' + col + '"' + tr + '/>';
    }
  }
  return s + '</g></svg>';
}

/* ============ 妖兽职业外观（第 39 轮，方案 §3.3.1）============
   ★ 一条数据一个职业：配色 + 挂件 + 比例，【不加任何贴图素材】✓
     职业名由服务器发下来（快照数组第 10 个字段 kind ✓），客户端在这张表里查外观 ✓
   ★ 没查到的职业（比如以后服务器加了新的、客户端还没更新）→ 用默认僵尸外观 ✓ 不会崩 ✗
   ★ 示意图：tools\preview_skins.html（改这张表之前先去那儿看一眼效果 ✓）*/
var MOB_CLASSES = {
  '白领': { body: 0x2a2f3a, limb: 0x2a2f3a, leg: 0x232833, belt: 0x14181f,
    add: [[0.46, 0.76, 0.10, 0xededed, 0, 1.26, 0.30], [0.16, 0.13, 0.11, 0x8a1f1f, 0, 1.58, 0.34],
          [0.11, 0.46, 0.09, 0x8a1f1f, 0, 1.28, 0.35], [0.22, 0.10, 0.12, 0xf2f2f2, -0.17, 1.63, 0.32],
          [0.22, 0.10, 0.12, 0xf2f2f2, 0.17, 1.63, 0.32], [0.34, 0.14, 0.46, 0x14161c, -0.25, 0.08, 0.06],
          [0.34, 0.14, 0.46, 0x14161c, 0.25, 0.08, 0.06], [0.46, 0.36, 0.16, 0x3a2c22, 0.72, 0.66, 0.10]] },
  '医生': { body: 0xececeb, limb: 0xe6e6e4, leg: 0x2f3a44, belt: 0xdcdcd8,
    add: [[1.06, 0.44, 0.66, 0xe6e6e4, 0, 0.58, 0], [0.80, 0.24, 0.14, 0xcfe6f0, 0, 1.98, 0.54],
          [1.06, 0.20, 0.92, 0xeef2f4, 0, 2.90, 0], [0.30, 0.34, 0.06, 0x9aa4ad, -0.18, 1.42, 0.31],
          [0.30, 0.34, 0.06, 0x9aa4ad, 0.18, 1.42, 0.31], [0.10, 0.40, 0.10, 0x2a2a2e, 0.16, 1.28, 0.34],
          [0.28, 0.10, 0.10, 0x2a2a2e, 0.16, 1.46, 0.34], [0.20, 0.22, 0.06, 0xf2f2f2, -0.26, 1.30, 0.33],
          [0.34, 0.14, 0.46, 0xe4e4e0, -0.25, 0.08, 0.06], [0.34, 0.14, 0.46, 0xe4e4e0, 0.25, 0.08, 0.06]] },
  '工人': { body: 0x4a5058, limb: 0x4a5058, leg: 0x3a4048, belt: 0x2a2f36,
    add: [[1.00, 0.30, 0.94, 0xf0c81c, 0, 2.92, 0], [1.04, 0.09, 0.34, 0xd8b010, 0, 2.78, 0.50],
          [1.10, 0.66, 0.66, 0xe8781c, 0, 1.24, 0], [1.12, 0.10, 0.67, 0xe8f0b0, 0, 1.10, 0],
          [1.12, 0.10, 0.67, 0xe8f0b0, 0, 1.40, 0], [0.38, 0.18, 0.48, 0x2a2622, -0.25, 0.09, 0.07],
          [0.38, 0.18, 0.48, 0x2a2622, 0.25, 0.09, 0.07]] },
  '学生': { body: 0x2f3f72, limb: 0x2f3f72, leg: 0x26325c, belt: 0x1c2444, scale: 0.9,
    add: [[0.30, 0.20, 0.12, 0xc02020, 0, 1.58, 0.33], [0.20, 0.10, 0.11, 0xf0f0f0, -0.15, 1.66, 0.31],
          [0.20, 0.10, 0.11, 0xf0f0f0, 0.15, 1.66, 0.31], [0.11, 0.62, 0.10, 0x6a4e2a, -0.27, 1.30, 0.32],
          [0.11, 0.62, 0.10, 0x6a4e2a, 0.27, 1.30, 0.32], [0.66, 0.58, 0.30, 0x7a5a30, 0, 1.30, -0.44],
          [0.30, 0.13, 0.42, 0x1a1a1a, -0.23, 0.07, 0.05], [0.30, 0.13, 0.42, 0x1a1a1a, 0.23, 0.07, 0.05]] },
  '外卖': { body: 0xffd100, limb: 0x1a1a1a, leg: 0x1f1f24, belt: 0x141414,
    add: [[0.98, 0.32, 0.92, 0xffd100, 0, 2.90, 0], [0.94, 0.10, 0.38, 0x1a1a1a, 0, 2.76, 0.50],
          [0.52, 0.54, 0.13, 0x1a1a1a, 0, 1.18, 0.31], [0.30, 0.12, 0.13, 0x1a1a1a, 0, 1.62, 0.31],
          [0.96, 0.12, 0.68, 0x1a1a1a, 0, 1.86, -0.50], [0.94, 0.78, 0.64, 0xffd100, 0, 1.40, -0.50],
          [0.96, 0.16, 0.66, 0x1a1a1a, 0, 1.06, -0.50], [0.34, 0.14, 0.46, 0x1a1a1a, -0.25, 0.08, 0.06],
          [0.34, 0.14, 0.46, 0x1a1a1a, 0.25, 0.08, 0.06]] },
  '保安': { body: 0x1e2a44, limb: 0x1a2338, leg: 0x161d2e, belt: 0x0e1420,
    add: [[1.10, 0.24, 0.90, 0x16203a, 0, 2.86, 0], [1.06, 0.09, 0.34, 0x0c1220, 0, 2.72, 0.50],
          [1.12, 0.08, 0.92, 0x0c1220, 0, 2.99, 0], [0.30, 0.36, 0.10, 0xe8e8e8, 0, 1.46, 0.30],
          [0.10, 0.34, 0.08, 0x101820, 0, 1.34, 0.34], [0.42, 0.11, 0.17, 0xd8b840, -0.42, 1.65, 0.10],
          [0.42, 0.11, 0.17, 0xd8b840, 0.42, 1.65, 0.10], [0.18, 0.12, 0.09, 0xd8b840, 0, 0.76, 0.33],
          [0.14, 0.30, 0.13, 0x1a1a1a, 0.34, 1.32, 0.33], [0.36, 0.15, 0.46, 0x0a0f18, -0.25, 0.08, 0.06],
          [0.36, 0.15, 0.46, 0x0a0f18, 0.25, 0.08, 0.06]] },
  '程序员': { body: 0x565666, limb: 0x4e4e5e, leg: 0x3a4256, belt: 0x33333c,
    add: [[0.94, 0.46, 0.42, 0x4e4e5e, 0, 2.18, -0.62], [0.32, 0.13, 0.09, 0x14161c, -0.25, 2.30, 0.58],
          [0.32, 0.13, 0.09, 0x14161c, 0.25, 2.30, 0.58], [0.14, 0.05, 0.07, 0x14161c, 0, 2.30, 0.58],
          [0.10, 0.34, 0.06, 0x2a2a30, -0.03, 1.34, 0.32], [0.20, 0.26, 0.06, 0xe8e8e8, -0.03, 1.06, 0.33],
          [0.56, 0.11, 0.44, 0x2e2e34, 0.72, 0.92, 0.28], [0.34, 0.14, 0.46, 0x2a2a30, -0.25, 0.08, 0.06],
          [0.34, 0.14, 0.46, 0x2a2a30, 0.25, 0.08, 0.06]] },
  /* ★ 健身教练：身体本身就是背心、手臂裸露 = 无袖 ✓
     （第一版是"绿身子上贴红方块"，用户反馈"不像" ✗ 已改）*/
  '健身教练': { body: 0xd8482c, limb: 0x6f9a5a, leg: 0x2a2a30, belt: 0xe8e8e0,
    scale: 1.14, thick: 1.6,
    add: [[1.05, 0.22, 0.66, 0x6f9a5a, 0, 1.72, 0], [0.98, 0.16, 0.66, 0xc03a20, 0, 0.66, 0],
          [1.16, 0.12, 1.16, 0x1a1a1a, 0, 2.66, 0], [0.09, 0.34, 0.07, 0x2a2a2e, -0.14, 1.44, 0.32],
          [0.09, 0.34, 0.07, 0x2a2a2e, 0.14, 1.44, 0.32], [0.16, 0.12, 0.10, 0xd8d8d0, 0, 1.24, 0.34],
          [0.62, 0.14, 0.50, 0xe8e8e0, 0, 0.80, 0.34], [0.22, 0.40, 0.22, 0x3aa0e0, 0.76, 0.98, 0.14],
          [0.42, 0.18, 0.54, 0xe8e8e4, -0.30, 0.09, 0.07], [0.42, 0.18, 0.54, 0xe8e8e4, 0.30, 0.09, 0.07]] }
};
function mobClassOf(kind) { return (kind && MOB_CLASSES[kind]) ? MOB_CLASSES[kind] : null; }

/* ============ ★ 手上的武器（第 47 轮，方案 §7.4~§7.6）============
   服务器是权威（射程/弧/冷却都在服务器 ✓ 客户端算不了假账 ✗）
   这里只做两件事：
     ① 把【本地预测】的常量改成这把武器的（不然会出现"看着打到了、服务器说没中"✗）
     ② 给 UI 一个地方查"我现在拿的是什么"
   ★ 换武器只改这三个 G 值 + 记录，不动别的 —— 表现层（手上模型）后面再做 ✓ */
var MY_WEAPON = null;
function setWeapon(w) {
  MY_WEAPON = (w && w.slot === 'weapon') ? w : null;
  var b = (MY_WEAPON && MY_WEAPON.base) || null;
  // ★ 没武器 → 用默认单手剑的数值（和服务器那边一致 ✓）
  var spd = b ? (+b.atkSpeed || 1.15) : 1.15;
  /* ★★★ round470：攻速词条也要算进来 ✗✗
     以前这里只看 base.atkSpeed ✗ 而服务器的冷却是
       weapons.interval_of(look, spd_pct)  ← 含了词条 ✓
     → 两边不一致：客户端以为要等更久，服务器早就让你砍了 ✗
       （表现：换上带攻速的剑，手感没变，但伤害统计对不上）
     ★ 上下限不变：[0.6, 2.2]（全局常量，不是按武器也不是按人物 ✓） */
  var _sap = 0;
  if (MY_WEAPON && MY_WEAPON.affixes) {
    for (var _i = 0; _i < MY_WEAPON.affixes.length; _i++) {
      var _a = MY_WEAPON.affixes[_i];
      if (_a && _a.key === 'spd_pct') { _sap += (+_a.val || 0); }
    }
  }
  spd = spd * (1 + _sap / 100);
  G.ATK_RANGE = b ? (+b.reach || 2.4) : 2.4;
  G.ATK_ARC = b ? (+b.arc || 1.05) : 1.05;
  G.ATK_CD = 0.62 / Math.max(0.6, Math.min(2.2, spd));
  // ★ 手上的模型也跟着换（第 49 轮 ✓ 换武器立刻能看出来 ✓）
  fillHeldWeapon(typeof H !== 'undefined' && H ? H.sw : null, null, null, H ? H.swL : null);
  if (typeof fpRefreshWeapon === 'function') { fpRefreshWeapon(); }
  return MY_WEAPON;
}
/* ★ 模型往下埋了多少（量出来的：脚在 y=-0.46）—— mob() 会把整体抬回来 ✓
   ★ 走路摆动的幅度也调大了：原来 0.6 弧度 × 只露 0.25 米的腿 = 看不出来在走 ✗ */
var MOB_FEET = 0.46;
var MOB_SWING = 0.85;
/* ★ round426：多远切"静态合并 LOD"（米）。16 = 摆臂在屏幕上 2px 左右 ✓
   ★ 调这个数就能看效果：设成 999 = 永远不切（对比用 ✓）*/
var MOB_LOD_D = 18;
/* 职业名列表（单机刷怪随机挑一个用 ✓ 联机时职业由服务器发下来 ✓）
   ★ 顺序和 server/mobs.py 的 KINDS 保持一致 —— 不一致也不崩（查不到就用默认外观 ✓）*/
var MOB_KINDS = ['白领', '医生', '工人', '学生', '外卖', '保安', '程序员', '健身教练'];
var MOB_RANK_NAMES = {
  rift:'裂口者', guard:'铁卫', ember:'火鬼', toad:'毒沼蟾', beetle:'刃甲虫', wolf:'影狼',
  butcher:'屠夫', mage:'深渊法师', mech:'钢铁巨兽', dragon:'骨龙', serpent:'熔岩巨蟒', eye:'虚空之眼'
};
function randomMobKind() {
  return MOB_KINDS[Math.floor(Math.random() * MOB_KINDS.length)] || null;
}

/* ============ ★ 几何体 / 材质缓存（第 44 轮性能优化）============
   为什么要做（实测：40 只僵尸 = 940 次 draw call，占全部 89% ✗）：
     ① 原来【每个方块都 new 一个材质】✗ → 一只僵尸 20 个材质、40 只 800 个 ✗
        （内存 + GC 压力：一刷新就卡一下）
     ② 每个方块一个材质 = 【一次 draw call】✗ → 一只僵尸 21 次、40 只 840 次 ✗
   现在：
     ① 材质按颜色查表复用 → 全场景几十个 ✓
     ② 僵尸【不动的部件】合并成一个几何体、颜色写进【顶点色】→ 1 次 draw call ✓
     ③ 四条肢体（要摆动）各自合并 → 一只僵尸 5 次而不是 21 次 ✓
   ★ 画质完全不变：同样的方块、同样的颜色、同样的光照与阴影 ✓ */

var _matCache = {};
function matOf(c) {
  var k = c | 0;
  var m = _matCache[k];
  if (!m) { m = new THREE.MeshLambertMaterial({ color: k }); _matCache[k] = m; }
  return m;
}

var _vcMat = null;
function vcMat() {                      // ★ 顶点色材质：全场共用这一个 ✓
  if (!_vcMat) { _vcMat = new THREE.MeshLambertMaterial({ vertexColors: true }); }
  return _vcMat;
}

/* ★★★ round456（用户："换成小方块，要绿色的方块，和游戏里的一样"）★★★
   登录界面专用的一片草方块地：30×30 个 1m 小方块 ✗
   ★ 只用一个 InstancedMesh → 900 块也只有 1 次绘制 ✓
   ★ 只在登录时显示，进游戏立刻隐藏 ✓ */
/* 把一堆方块合并成一个几何体（颜色 → 顶点色 ✓）
   parts: [[宽,高,深,颜色, x,y,z, 绕Z旋转(可选)] ...]
   ★ three.min.js 里没有 mergeGeometries（那在 examples 里 ✗）→ 自己拼 ✓ */
function mergeBoxes(parts) {
  var pos = [], nor = [], col = [];
  var c = new THREE.Color();
  var v = new THREE.Vector3(), q = new THREE.Quaternion(), mm = new THREE.Matrix4();
  var one = new THREE.Vector3(1, 1, 1), ZAX = new THREE.Vector3(0, 0, 1), XAX = new THREE.Vector3(1, 0, 0);
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    var bg = new THREE.BoxGeometry(p[0], p[1], p[2]).toNonIndexed();   // ★ 去索引才好直接拼 ✓
    /* ★ round426：支持绕 X 轴转（胳膊是"举起来"的 ✗ 只绕 Z 转做不到 ✓）
       p[7] = 绕 Z，p[8] = 绕 X（两个都给就依次应用 Z 再 X ✓）*/
    if (p[7]) { q.setFromAxisAngle(ZAX, p[7]); } else { q.set(0, 0, 0, 1); }
    if (p[8]) {
      var qx = new THREE.Quaternion().setFromAxisAngle(XAX, p[8]);
      q.multiply(qx);
    }
    v.set(p[4] || 0, p[5] || 0, p[6] || 0);
    mm.compose(v, q, one);
    bg.applyMatrix4(mm);
    var pa = bg.attributes.position.array, na = bg.attributes.normal.array;
    var n = pa.length;
    for (var k = 0; k < n; k++) { pos.push(pa[k]); nor.push(na[k]); }
    c.setHex(p[3] | 0);
    for (var t = 0; t < n / 3; t++) { col.push(c.r, c.g, c.b); }
    bg.dispose();
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

var MOB_GEO = {};          // 职业名 → 静态件合并后的几何体（建一次用一辈子 ✓）
var LIMB_GEO = {};         // 肢体几何体（按 手臂/腿 × 粗细 × 颜色 缓存 ✓）
var MOB_LOD_GEO = {};      // ★ round426：职业名 → "带四肢的静态合并"几何体（远处用 ✓）

/* ★ 静态件（头/眼/眉/嘴/身/腰带 + 职业挂件）✗ 抽出来给普通模型和 LOD 共用 ✓ */
function mobStaticParts(kind) {
  var cls = mobClassOf(kind) || {};
  var parts = [
    [1.10, 1.10, 1.10, cls.head || 0x5a8a48, 0, 2.25, 0],       // 头
    [0.22, 0.22, 0.06, 0x142014, -0.24, 2.30, 0.56],            // 眼
    [0.22, 0.22, 0.06, 0x142014, 0.24, 2.30, 0.56],
    [0.34, 0.07, 0.06, 0x233018, -0.24, 2.50, 0.56],            // 眉
    [0.34, 0.07, 0.06, 0x233018, 0.24, 2.50, 0.56],
    [0.42, 0.07, 0.06, 0x142014, 0, 2.02, 0.56],                // 嘴
    [1.00, 1.14, 0.60, cls.body || 0x0e8c8c, 0, 1.14, 0],       // 身
    [1.02, 0.16, 0.62, cls.belt || 0x0a6a6a, 0, 0.76, 0]        // 腰带
  ];
  var adds = cls.add || [];                                     // 职业挂件一起合并 ✓
  for (var ai = 0; ai < adds.length; ai++) {
    var a = adds[ai];
    parts.push([a[0], a[1], a[2], a[3], a[4], a[5], a[6]]);
  }
  return parts;
}

/* ★★ round426：远处角色的「静态合并 LOD」★★
   ★ 为什么要它：40 只怪时 200 次绘制（每只 5 个网格）✗ 阴影 pass 再来 200 次 ✗
   ★ 为什么不"直接不画腿"（用户问过）：22 米时腿宽 6px、高 20px，看得出来 ✗
   ★ 所以：腿【保留】，只是把身体 + 四肢合进【一个】几何体，摆一个固定姿势 ✓
     18 米外的摆臂幅度只有 1~2px，停不停看不出 ✓ 但腿的形状必须留着 ✓
   ★ 姿态：腿竖直、胳膊向前平举（和僵尸默认姿势一致 ✓ 一眼还是那只怪 ✓）*/
function mobLodGeoOf(kind) {
  var key = kind || 'default';
  var hit = MOB_LOD_GEO[key];
  if (hit) { return hit; }
  var cls = mobClassOf(kind) || {};
  var thick = cls.thick || 1;
  var parts = mobStaticParts(kind);
  var legC = cls.leg || 0x3e3ea0, armC = cls.limb || 0x5a8a48;
  var lw = 0.32 * thick, aw = 0.28 * thick;
  /* 腿：pivot 在 (x, 0.60+FEET)，块本身再往下 0.53 → 合起来就是 world 偏移 ✓ */
  parts.push([lw, 1.06, lw, legC, -0.25 * thick, 0.60 + MOB_FEET - 0.53, 0]);
  parts.push([lw, 1.06, lw, legC, 0.25 * thick, 0.60 + MOB_FEET - 0.53, 0]);
  /* 胳膊：pivot 在 (±0.64*thick, 1.60+FEET)，绕 X 转 -1.35 后块心在
       (0, -0.48cos, -0.48sin) = (0, -0.105, +0.469) ✓ */
  var ay = 1.60 + MOB_FEET - 0.48 * Math.cos(-1.35);
  var az = -0.48 * Math.sin(-1.35);
  parts.push([aw, 0.96, aw, armC, -0.64 * thick, ay, az, 0, -1.35]);
  parts.push([aw, 0.96, aw, armC, 0.64 * thick, ay, az, 0, -1.35]);
  var geo = mergeBoxes(parts);
  geo.translate(0, MOB_FEET, 0);
  MOB_LOD_GEO[key] = geo;
  return geo;
}

function mobGeoOf(kind) {
  var key = kind || 'default';
  var hit = MOB_GEO[key];
  if (hit) { return hit; }
  var geo = mergeBoxes(mobStaticParts(kind));
  geo.translate(0, MOB_FEET, 0);        // ★ 抬到脚踩地面（第 40 轮那个 0.46 ✓）
  MOB_GEO[key] = geo;
  return geo;
}

function limbGeoOf(isArm, thick, col) {
  var key = (isArm ? 'a' : 'l') + '_' + thick + '_' + (col | 0);
  var hit = LIMB_GEO[key];
  if (hit) { return hit; }
  var w = (isArm ? 0.28 : 0.32) * thick, h = isArm ? 0.96 : 1.06;
  var geo = mergeBoxes([[w, h, w, col, 0, isArm ? -0.48 : -0.53, 0]]);
  LIMB_GEO[key] = geo;
  return geo;
}

/* ★★★ round434（A1）：四肢实例化 —— 按【肢体类型】分桶 ✗✗
   40 只怪原来是 160 次绘制（每只 4 条 ✗）→ 现在是"桶的数量"次（约 6~10）✓
   ★ 动画代码一行都不改：枢轴 Group 照旧存 rotation，只是不再挂到模型上 ✓
   ★ 容量 256 个实例（够用；超了就不画，不会崩）*/
var LIMB_BUCKETS = {};
var LIMB_CAP = 256;
var _limbDummy = null;

function limbBucketOf(isArm, thick, col) {
  var key = (isArm ? 'a' : 'l') + '_' + thick + '_' + (col | 0);
  var b = LIMB_BUCKETS[key];
  if (b) { return b; }
  var geo = limbGeoOf(isArm, thick, col);
  var mesh = new THREE.InstancedMesh(geo, vcMat(), LIMB_CAP);
  /* ★★ 关键：count 默认 = 容量（256）✗ 那会把 256 个空槽全画一遍 ✗
     实测：不改 count → 14 个桶 × 256 × 12 三角形 = 43008 个白画 ✗✗
     所以从 0 开始，分配一个槽就 +1 ✓ */
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;          // 实例分布很广 ✗ 用包围盒剔除会误删 ✓
  /* ★ 每个实例一个颜色（受击闪白用 ✓）*/
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(LIMB_CAP * 3), 3);
  for (var i = 0; i < LIMB_CAP; i++) {
    mesh.instanceColor.setXYZ(i, 1, 1, 1);
  }
  scene.add(mesh);
  b = LIMB_BUCKETS[key] = { mesh: mesh, used: 0, free: [] };
  return b;
}

/* ============ 妖兽（默认外观 = 绿僵尸；带职业就套 MOB_CLASSES）============
   ★ 第 44 轮：改成 1 个合并的静态件 + 4 条肢体 = 5 次 draw call（原来 21 次 ✗）*/
/* ★ round600：非人型精英/Boss 的简版程序模型（贴图后续再换） */
var BEAST_SKINS = { toad:1, beetle:1, wolf:1, dragon:1, serpent:1, eye:1 };
var RANK_SKINS = {
  1: ['rift', 'guard', 'ember', 'toad', 'beetle', 'wolf'],
  2: ['butcher', 'mage', 'mech', 'dragon', 'serpent', 'eye']
};
var _mobTexCache = {};
function mobSkinTex(skin) {
  if (_mobTexCache[skin]) { return _mobTexCache[skin]; }
  try {
    var base = { toad: [109,138,67], beetle: [75,74,63], wolf: [48,52,58],
      dragon: [215,207,187], serpent: [77,58,45], eye: [67,36,82] }[skin] || [85,85,85];
    var w = 64, h = 64, data = new Uint8Array(w * h * 4);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        var n = ((x * 13 + y * 31 + x * y) % 17) - 8;
        data[i] = Math.max(0, Math.min(255, base[0] + n));
        data[i + 1] = Math.max(0, Math.min(255, base[1] + n));
        data[i + 2] = Math.max(0, Math.min(255, base[2] + n));
        data[i + 3] = 255;
      }
    }
    var tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 1);
    tex.needsUpdate = true;
    _mobTexCache[skin] = tex;
    return tex;
  } catch (e) {
    return null;
  }
}

function mobTaperedTube(points, radii, seg, radial, backCol, bellyCol) {
  /* 连续龙身：沿曲线生成变半径管体，避免“圆柱一节一节拼起来” */
  var curve = new THREE.CatmullRomCurve3(points);
  var frames = curve.computeFrenetFrames(seg, false);
  var pos = [], nor = [], col = [], uv = [], idx = [];
  var cBack = new THREE.Color(backCol || 0xbfb39b);
  var cBelly = new THREE.Color(bellyCol || 0xe8dfc9);
  for (var i = 0; i <= seg; i++) {
    var t = i / seg;
    var p = curve.getPoint(t);
    var ri = radii[Math.min(radii.length - 1, Math.floor(t * (radii.length - 1)))];
    var rj = radii[Math.min(radii.length - 1, Math.floor(t * (radii.length - 1)) + 1)] || ri;
    var r = ri + (rj - ri) * ((t * (radii.length - 1)) % 1);
    var N = frames.normals[i], B = frames.binormals[i];
    for (var j = 0; j <= radial; j++) {
      var a = j / radial * Math.PI * 2;
      var nx = Math.cos(a) * N.x + Math.sin(a) * B.x;
      var ny = Math.cos(a) * N.y + Math.sin(a) * B.y;
      var nz = Math.cos(a) * N.z + Math.sin(a) * B.z;
      pos.push(p.x + nx * r, p.y + ny * r, p.z + nz * r);
      nor.push(nx, ny, nz);
      var c = cBack.clone().lerp(cBelly, Math.max(0, Math.min(1, 0.5 - ny * 0.55)));
      col.push(c.r, c.g, c.b);
      uv.push(t, j / radial);
    }
  }
  for (var ii = 0; ii < seg; ii++) {
    for (var jj = 0; jj < radial; jj++) {
      var a0 = ii * (radial + 1) + jj, b0 = a0 + radial + 1;
      idx.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1);
    }
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.7, metalness: 0.04, flatShading: false,
    side: THREE.DoubleSide
  }));
}

/* round604：末影龙配色四足龙。深紫黑主体 + 紫色眼 + 灰紫膜翼。 */
function mobEnderDragon(rank) {
  var g = new THREE.Group();
  var C = { black:0x18121f, black2:0x241a2e, plate:0x33253f,
    wing:0x211b28, vein:0x6b3a8a, eye:0xe36bff, glow:0x9a3cff };
  function bm(c, o) {
    o = o || {};
    return new THREE.MeshStandardMaterial({ color:c, roughness:o.r===undefined?0.62:o.r,
      metalness:o.m===undefined?0.06:o.m, emissive:o.e||0x000000,
      emissiveIntensity:o.ei||0, flatShading:true,
      transparent:!!o.trans, opacity:o.op===undefined?1:o.op,
      side:o.side||THREE.FrontSide });
  }
  var black = bm(C.black, {r:0.55}), black2 = bm(C.black2, {r:0.62});
  var plate = bm(C.plate, {r:0.5, m:0.15}), wingMat = bm(C.wing,
    {r:0.72, trans:true, op:0.93, side:THREE.DoubleSide});
  var vein = bm(C.vein, {r:0.4, m:0.1, e:0x4a1f6a, ei:0.5});
  var eye = bm(C.eye, {r:0.16, m:0.02, e:C.eye, ei:2.4});
  function add(geo, mat, x, y, z, rx, ry, rz, sx, sy, sz) {
    var o = new THREE.Mesh(geo, mat); o.position.set(x||0,y||0,z||0);
    o.rotation.set(rx||0,ry||0,rz||0);
    o.scale.set(sx===undefined?1:sx,sy===undefined?1:sy,sz===undefined?1:sz);
    o.castShadow = true; g.add(o); return o;
  }
  // 末影龙式长躯干/长颈
  var spinePts = [
    new THREE.Vector3(0,1.02,-3.15), new THREE.Vector3(0,1.12,-2.3),
    new THREE.Vector3(0,1.22,-1.45), new THREE.Vector3(0,1.34,-0.55),
    new THREE.Vector3(0,1.48,0.30), new THREE.Vector3(0,1.70,0.95),
    new THREE.Vector3(0,2.02,1.35), new THREE.Vector3(0,2.28,1.48)
  ];
  var body = mobTaperedTube(spinePts, [0.21,0.31,0.41,0.47,0.42,0.33,0.27,0.23],
    36, 8, C.black, C.black2, 0.58);
  body.material.flatShading = true; body.material.needsUpdate = true;
  body.castShadow = true; g.add(body);
  add(new THREE.BoxGeometry(0.70, 0.32, 0.72), black2, 0, 1.38, 0.18, 0.06, 0, 0);
  add(new THREE.BoxGeometry(0.74, 0.30, 0.80), plate, 0, 1.30, -1.35, 0.04, 0, 0);
  add(new THREE.BoxGeometry(0.56, 0.22, 0.44), black2, 0, 2.28, 1.38, 0.05, 0, 0);
  // 背甲/侧甲：末影龙的紫黑色块面
  for (var sp = 0; sp < 9; sp++) {
    var st = sp / 8;
    add(new THREE.BoxGeometry(0.22 - st*0.05, 0.10, 0.30), plate,
      0, 1.48 + st*0.66 - 0.24*st*st, -1.75 + st*3.15, 0.18, 0, 0);
    if (sp < 7) {
      add(new THREE.ConeGeometry(0.075 - st*0.02, 0.24 - st*0.06, 5), vein,
        0, 1.64 + st*0.62, -1.7 + st*3.0, 0.45, 0, 0);
    }
  }
  // 头：拉长的末影龙头
  var head = new THREE.Group(); head.position.set(0, 2.38, 1.50); g.add(head);
  function ha(geo, mat, x, y, z, rx, ry, rz, sx, sy, sz) {
    var o = new THREE.Mesh(geo, mat); o.position.set(x||0,y||0,z||0);
    o.rotation.set(rx||0,ry||0,rz||0);
    o.scale.set(sx===undefined?1:sx,sy===undefined?1:sy,sz===undefined?1:sz);
    o.castShadow = true; head.add(o); return o;
  }
  ha(new THREE.BoxGeometry(0.44, 0.32, 0.46), black, 0, 0.02, 0.02, 0, 0, 0);
  ha(new THREE.BoxGeometry(0.34, 0.23, 0.58), black2, 0, -0.01, 0.43, 0.02, 0, 0);
  ha(new THREE.BoxGeometry(0.30, 0.10, 0.48), black2, 0, -0.17, 0.38, 0.04, 0, 0.04);
  ha(new THREE.BoxGeometry(0.28, 0.045, 0.34), bm(0x0d0910, {r:0.95}), 0, -0.10, 0.47);
  // 紫色眼睛（末影龙标志）
  ha(new THREE.BoxGeometry(0.13, 0.075, 0.04), eye, -0.16, 0.12, 0.29, 0, 0, -0.12);
  ha(new THREE.BoxGeometry(0.13, 0.075, 0.04), eye, 0.16, 0.12, 0.29, 0, 0, 0.12);
  // 角/额刺
  ha(new THREE.ConeGeometry(0.07, 0.46, 5), plate, -0.20, 0.28, -0.04, -0.35, 0, -0.24);
  ha(new THREE.ConeGeometry(0.07, 0.46, 5), plate, 0.20, 0.28, -0.04, -0.35, 0, 0.24);
  for (var hc = 0; hc < 3; hc++) {
    ha(new THREE.ConeGeometry(0.045, 0.20, 4), vein, (hc-1)*0.12, 0.23, 0.05, -0.35, 0, 0);
  }
  // 上下牙
  for (var t = 0; t < 4; t++) {
    ha(new THREE.ConeGeometry(0.022, 0.075, 4), plate, (t-1.5)*0.06, -0.12, 0.64, 0.1, 0, 0);
  }
  // 大块面翼：由三块膜板拼成末影龙轮廓，但共享同一翼根
  var wings = [];
  for (var wi = 0; wi < 2; wi++) {
    var side = wi ? 1 : -1, wg = new THREE.Group();
    wg.position.set(side*0.38, 1.62, 0.34);
    wg.rotation.y = side*0.42; wg.rotation.z = side*0.20; wg.scale.x = side;
    g.add(wg);
    add(new THREE.BoxGeometry(0.24, 0.20, 0.26), plate, side*0.34,1.70,0.32);
    var panels = [
      [[0,0],[1.05,0.55],[2.10,0.50],[2.55,0.12],[1.30,0.05]],
      [[0,0],[1.10,0.05],[2.35,-0.10],[2.10,-0.30],[0.95,-0.18]],
      [[0,0],[0.95,-0.18],[1.95,-0.45],[1.55,-0.62],[0.72,-0.26]]
    ];
    for (var pi = 0; pi < panels.length; pi++) {
      var shp = new THREE.Shape(), pp = panels[pi];
      shp.moveTo(pp[0][0], pp[0][1]);
      for (var pj = 1; pj < pp.length; pj++) {
        if (pj === 1) shp.quadraticCurveTo(pp[pj][0]*0.5, pp[pj][1]*0.7, pp[pj][0], pp[pj][1]);
        else shp.lineTo(pp[pj][0], pp[pj][1]);
      }
      shp.lineTo(pp[0][0], pp[0][1]);
      var me = new THREE.Mesh(new THREE.ExtrudeGeometry(shp,
        {depth:0.055, bevelEnabled:false, curveSegments:6}), wingMat);
      me.position.set(0,0.12,0.02); wg.add(me);
    }
    // 翼骨/紫色脉络
    var lead = new THREE.Mesh(new THREE.CylinderGeometry(0.055,0.025,2.2,5), plate);
    lead.position.set(1.05,0.26,0.04); lead.rotation.z = -1.05; wg.add(lead);
    for (var f = 0; f < 3; f++) {
      var fb = new THREE.Mesh(new THREE.CylinderGeometry(0.030,0.014,1.2,5), vein);
      fb.position.set(0.5+f*0.58, 0.06-f*0.08, 0.03); fb.rotation.z = -1.0+f*0.06; wg.add(fb);
    }
    wings.push({g:wg, base:side*0.20, baseY:side*0.42, baseX:0, side:side});
  }
  // 四肢：末影龙黑紫块面腿 + 紫色爪
  var legs = [];
  var ld = [[-0.42,0.55,0],[0.42,0.55,Math.PI],[-0.42,-1.20,Math.PI],[0.42,-1.20,0]];
  for (var li = 0; li < 4; li++) {
    var lx = ld[li][0], lz = ld[li][1], ph = ld[li][2];
    add(new THREE.BoxGeometry(0.36,0.26,0.34), plate, lx, 1.16, lz);
    var hip = new THREE.Group(); hip.position.set(lx,1.18,lz); g.add(hip);
    var thigh = new THREE.Mesh(new THREE.BoxGeometry(0.28,0.64,0.30), black);
    thigh.position.y = -0.30; thigh.castShadow = true; hip.add(thigh);
    var knee = new THREE.Group(); knee.position.y = -0.58; hip.add(knee);
    var kneeCap = new THREE.Mesh(new THREE.BoxGeometry(0.24,0.13,0.24), plate);
    kneeCap.position.y = 0.02; knee.add(kneeCap);
    var calf = new THREE.Mesh(new THREE.BoxGeometry(0.20,0.56,0.23), black2);
    calf.position.y = -0.28; calf.castShadow = true; knee.add(calf);
    var ankle = new THREE.Group(); ankle.position.y = -0.55; knee.add(ankle);
    var ankleCap = new THREE.Mesh(new THREE.BoxGeometry(0.17,0.10,0.20), plate);
    ankle.add(ankleCap);
    var foot = new THREE.Mesh(new THREE.BoxGeometry(0.20,0.09,0.26), plate);
    foot.position.set(0,-0.03,0.08); ankle.add(foot);
    for (var c = 0; c < 3; c++) {
      var claw = new THREE.Mesh(new THREE.ConeGeometry(0.03,0.17,5), vein);
      claw.position.set((c-1)*0.06,-0.04,0.23); claw.rotation.x = Math.PI/2; ankle.add(claw);
    }
    legs.push({hip:hip, knee:knee, ankle:ankle, phase:ph});
  }
  // 尾巴：末影龙式长尾 + 尾鳍
  var tailRoot = new THREE.Group(); tailRoot.position.set(0,1.02,-3.1); g.add(tailRoot);
  var tail = [], parent = tailRoot;
  for (var ts = 0; ts < 7; ts++) {
    var seg = new THREE.Group(); seg.position.z = ts ? -0.36 : 0; parent.add(seg);
    var tm = new THREE.Mesh(new THREE.BoxGeometry(0.22-ts*0.022,0.20-ts*0.02,0.38), black2);
    tm.position.z = -0.19; tm.castShadow = true; seg.add(tm);
    tail.push(seg); parent = seg;
  }
  var fin = new THREE.Mesh(new THREE.BoxGeometry(0.46,0.10,0.40), vein);
  fin.position.set(0,0.04,-0.24); parent.add(fin);
  var dummy = new THREE.Group(); g.add(dummy);
  var lod = new THREE.Mesh(body.geometry, body.material);
  lod.position.copy(body.position); lod.scale.copy(body.scale); lod.visible = false; g.add(lod);
  return {g:g, body:body, lod:lod, legL:dummy, legR:dummy, armL:dummy, armR:dummy,
    casters:[body], beast:1, limbs:[], slots:[], attached:true,
    dragon:{body:body, head:head, legs:legs, tail:tail, wings:wings, t:0, speed:0}};
}

/* round603：从零重建的骨龙。旧模型保留但不使用；这里只做骨骼 + 骨翼。 */
function mobDragonBone(rank) {
  var g = new THREE.Group();
  var C = { bone:0xd7c7a8, bone2:0x9c896d, dark:0x5b4b3a, jade:0x3f8f72,
    gold:0xd9b35c, eye:0x77f0ff, wing:0x5d3d79, wing2:0x24142f };
  function bm(c, o) {
    o = o || {};
    return new THREE.MeshStandardMaterial({ color:c, roughness:o.r===undefined?0.7:o.r,
      metalness:o.m===undefined?0.05:o.m, emissive:o.e||0x000000,
      emissiveIntensity:o.ei||0, flatShading:true });
  }
  var bone = bm(C.bone2, {r:0.76}), bone2 = bm(C.bone2, {r:0.78});
  var jade = bm(C.jade, {r:0.6}), gold = bm(C.gold, {r:0.3, m:0.55, e:0x3a2606, ei:0.18});
  var dark = bm(C.dark, {r:0.9}), glow = bm(C.eye, {r:0.15, e:C.eye, ei:2.1});
  function add(geo, mat, x, y, z, rx, ry, rz, sx, sy, sz) {
    var o = new THREE.Mesh(geo, mat); o.position.set(x||0,y||0,z||0);
    o.rotation.set(rx||0,ry||0,rz||0);
    o.scale.set(sx===undefined?1:sx,sy===undefined?1:sy,sz===undefined?1:sz);
    o.castShadow = true; g.add(o); return o;
  }
  function spineTube(points, radii) {
    var m = mobTaperedTube(points, radii, 40, 8, C.bone2, C.bone, 0.68);
    m.material.flatShading = true; m.material.needsUpdate = true;
    m.castShadow = true; g.add(m); return m;
  }
  function boneCurve(points, radius) {
    var curve = new THREE.CatmullRomCurve3(points);
    var m = new THREE.Mesh(new THREE.TubeGeometry(curve, 18, radius, 5, false), bone2);
    m.castShadow = true; g.add(m); return m;
  }
  // 脊柱：从头后一直连到尾，是整只龙的主骨架
  var spinePts = [
    new THREE.Vector3(0, 2.34, 1.40), new THREE.Vector3(0, 1.98, 1.02),
    new THREE.Vector3(0, 1.68, 0.42), new THREE.Vector3(0, 1.46, -0.45),
    new THREE.Vector3(0, 1.34, -1.3), new THREE.Vector3(0, 1.18, -2.2),
    new THREE.Vector3(0, 1.06, -3.05)
  ];
  var body = spineTube(spinePts, [0.24,0.26,0.32,0.36,0.31,0.19,0.11]);
  // 肋骨：每根都接回脊柱和胸骨，不是悬空片
  for (var rb = 0; rb < 6; rb++) {
    var z = -1.45 + rb * 0.36;
    for (var sd = -1; sd <= 1; sd += 2) {
      boneCurve([
        new THREE.Vector3(0, 1.55 - rb * 0.015, z),
        new THREE.Vector3(sd * 0.38, 1.36, z + 0.02),
        new THREE.Vector3(sd * 0.58, 1.10, z + 0.07),
        new THREE.Vector3(sd * 0.36, 0.90, z + 0.12)
      ], 0.034);
    }
  }
  add(new THREE.BoxGeometry(0.24, 0.62, 2.0), bone2, 0, 1.18, -0.45, 0.06, 0, 0);
  // 肩胛 / 骨盆 / 背脊
  add(new THREE.ConeGeometry(0.24, 0.64, 5), jade, -0.40, 1.60, 0.35, 0, 0, 0.9);
  add(new THREE.ConeGeometry(0.24, 0.64, 5), jade, 0.40, 1.60, 0.35, 0, 0, -0.9);
  add(new THREE.BoxGeometry(0.62, 0.18, 0.76), bone2, 0, 1.34, -1.45);
  for (var dsp = 0; dsp < 11; dsp++) {
    var t = dsp / 10;
    add(new THREE.ConeGeometry(0.055 + (1-t)*0.03, 0.22 + (1-t)*0.2, 5),
      (dsp%2?gold:jade), 0, 1.58 + t*0.58 - 0.3*t*t, -1.55 + t*3.3, 0.52, 0, 0);
  }
  // 头骨
  var head = new THREE.Group(); head.position.set(0, 2.42, 1.38); g.add(head);
  function ha(geo, mat, x, y, z, rx, ry, rz, sx, sy, sz) {
    var o = new THREE.Mesh(geo, mat); o.position.set(x||0,y||0,z||0);
    o.rotation.set(rx||0,ry||0,rz||0);
    o.scale.set(sx===undefined?1:sx,sy===undefined?1:sy,sz===undefined?1:sz);
    o.castShadow = true; head.add(o); return o;
  }
  ha(new THREE.IcosahedronGeometry(0.29, 1), bone, 0, 0.02, 0.04, 0, 0, 0, 1.1, 0.86, 1.1);
  ha(new THREE.CylinderGeometry(0.13, 0.21, 0.62, 6), bone, 0, 0.0, 0.43, Math.PI/2, 0, 0, 1, 1, 1);
  ha(new THREE.BoxGeometry(0.28, 0.10, 0.54), bone2, 0, -0.16, 0.37, 0.04, 0, 0.05);
  ha(new THREE.BoxGeometry(0.22, 0.03, 0.38), dark, 0, -0.11, 0.46);
  ha(new THREE.SphereGeometry(0.075, 8, 6), dark, -0.17, 0.14, 0.18, 1.2, 1.1, 0.55);
  ha(new THREE.SphereGeometry(0.075, 8, 6), dark, 0.17, 0.14, 0.18, 1.2, 1.1, 0.55);
  ha(new THREE.SphereGeometry(0.048, 7, 5), glow, -0.17, 0.14, 0.23);
  ha(new THREE.SphereGeometry(0.048, 7, 5), glow, 0.17, 0.14, 0.23);
  ha(new THREE.ConeGeometry(0.075, 0.52, 6), gold, -0.20, 0.31, -0.10, -0.4, 0, -0.28);
  ha(new THREE.ConeGeometry(0.075, 0.52, 6), gold, 0.20, 0.31, -0.10, -0.4, 0, 0.28);
  for (var tt = 0; tt < 5; tt++) {
    ha(new THREE.ConeGeometry(0.024, 0.09, 4), gold, (tt-2)*0.055, -0.10, 0.62, 0.15, 0, 0);
    ha(new THREE.ConeGeometry(0.021, 0.08, 4), gold, (tt-2)*0.052, -0.18, 0.59, Math.PI, 0, 0);
  }
  ha(new THREE.SphereGeometry(0.032, 6, 5), dark, -0.065, 0.075, 0.72);
  ha(new THREE.SphereGeometry(0.032, 6, 5), dark, 0.065, 0.075, 0.72);
  for (var cf = 0; cf < 3; cf++) {
    ha(new THREE.ConeGeometry(0.05, 0.22, 4), jade, (cf-1)*0.14, -0.01, -0.02,
      Math.PI/2, 0, (cf-1)*0.4);
  }
  // 尾巴：脊柱延续为分段骨节
  var tailRoot = new THREE.Group(); tailRoot.position.set(0, 1.06, -3.0); g.add(tailRoot);
  var tail = [], parent = tailRoot;
  for (var ts = 0; ts < 7; ts++) {
    var seg = new THREE.Group(); seg.position.z = ts ? -0.34 : 0; parent.add(seg);
    var r0 = 0.16 - ts * 0.018, r1 = r0 * 0.78;
    var tm = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, 0.38, 5), bone2);
    tm.rotation.x = Math.PI/2; tm.position.z = -0.19; tm.castShadow = true; seg.add(tm);
    var sp = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.15, 5), gold);
    sp.position.set(0, r0*0.9, -0.18); seg.add(sp);
    tail.push(seg); parent = seg;
  }
  var tip = new THREE.Mesh(new THREE.ConeGeometry(0.10, 0.44, 5), gold);
  tip.rotation.x = -Math.PI/2; tip.position.z = -0.26; parent.add(tip);
  // 四足：骨腿 + 关节套管 + 爪
  var legs = [];
  var ldef = [[-0.43,0.52,0],[0.43,0.52,Math.PI],[-0.43,-1.35,Math.PI],[0.43,-1.35,0]];
  for (var li = 0; li < 4; li++) {
    var lx = ldef[li][0], lz = ldef[li][1], ph = ldef[li][2];
    add(new THREE.CylinderGeometry(0.20, 0.14, 0.28, 5), jade, lx, 1.23, lz, 0, 0, 0.05);
    var hip = new THREE.Group(); hip.position.set(lx, 1.22, lz); g.add(hip);
    var femur = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.10, 0.70, 5), bone);
    femur.position.y = -0.23; femur.castShadow = true; hip.add(femur);
    var knee = new THREE.Group(); knee.position.y = -0.56; hip.add(knee);
    var kc = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.095, 0.16, 5), bone2);
    kc.position.y = 0.0; knee.add(kc);
    var tibia = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.065, 0.52, 5), bone);
    tibia.position.y = -0.25; tibia.castShadow = true; knee.add(tibia);
    var ankle = new THREE.Group(); ankle.position.y = -0.51; knee.add(ankle);
    var ac = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.06, 0.13, 5), bone2);
    ankle.add(ac);
    var palm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.055, 0.16), jade);
    palm.position.set(0, -0.03, 0.08); ankle.add(palm);
    for (var c = 0; c < 4; c++) {
      var x = (c - 1.5) * 0.055;
      var toe = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.22, 4), bone2);
      toe.rotation.x = Math.PI/2; toe.position.set(x, -0.03, 0.16); ankle.add(toe);
      var claw = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.19, 5), gold);
      claw.rotation.x = Math.PI/2; claw.position.set(x, -0.04, 0.32); ankle.add(claw);
    }
    legs.push({hip:hip, knee:knee, ankle:ankle, phase:ph});
  }
  // 骨翼：两层厚膜 + 骨梁
  var wings = [], wOut = new THREE.MeshStandardMaterial({color:C.wing, roughness:0.47,
    metalness:0.05, side:THREE.DoubleSide, transparent:true, opacity:0.94});
  var wIn = new THREE.MeshStandardMaterial({color:C.wing2, roughness:0.62,
    metalness:0.05, side:THREE.DoubleSide, transparent:true, opacity:0.88});
  for (var wi = 0; wi < 2; wi++) {
    var side = wi ? 1 : -1, wg = new THREE.Group();
    wg.position.set(side*0.38, 1.70, 0.22);
    wg.rotation.y = side*0.48; wg.rotation.z = side*0.18; wg.scale.x = side;
    g.add(wg);
    add(new THREE.CylinderGeometry(0.16,0.11,0.22,5), jade, side*0.36,1.76,0.22,0,0,0.08);
    var shp = new THREE.Shape();
    shp.moveTo(0,0);
    shp.bezierCurveTo(0.92,0.56,1.88,0.62,2.30,0.22);
    shp.bezierCurveTo(1.96,0.08,1.82,0.0,1.70,-0.10);
    shp.bezierCurveTo(1.56,0.04,1.42,-0.04,1.28,-0.18);
    shp.bezierCurveTo(1.15,-0.01,1.0,-0.06,0.82,-0.22);
    shp.bezierCurveTo(0.68,-0.05,0.38,-0.02,0,0);
    var mo = new THREE.Mesh(new THREE.ExtrudeGeometry(shp,{depth:0.075,bevelEnabled:true,
      bevelSize:0.018,bevelThickness:0.018,bevelSegments:1,curveSegments:9}),wOut);
    mo.position.set(0,0.12,0); mo.castShadow=true; wg.add(mo);
    var mi = new THREE.Mesh(new THREE.ExtrudeGeometry(shp,{depth:0.02,bevelEnabled:false,
      curveSegments:7}),wIn);
    mi.position.set(0,0.12,0.05); mi.scale.set(0.92,0.92,1); wg.add(mi);
    var lead = new THREE.Mesh(new THREE.CylinderGeometry(0.065,0.028,2.12,6),bone2);
    lead.position.set(1.02,0.27,0.04); lead.rotation.z=-1.05; wg.add(lead);
    for (var f = 0; f < 3; f++) {
      var fb = new THREE.Mesh(new THREE.CylinderGeometry(0.042,0.018,1.12,5),bone2);
      fb.position.set(0.46+f*0.53,0.05-f*0.07,0.03); fb.rotation.z=-1.0+f*0.06; wg.add(fb);
    }
    wings.push({g:wg, base: side*0.18, side:side});
  }
  var dummy = new THREE.Group(); g.add(dummy);
  var lod = new THREE.Mesh(body.geometry, body.material);
  lod.position.copy(body.position); lod.scale.copy(body.scale); lod.visible=false; g.add(lod);
  return {g:g, body:body, lod:lod, legL:dummy, legR:dummy, armL:dummy, armR:dummy,
    casters:[body], beast:1, limbs:[], slots:[], attached:true,
    dragon:{body:body, head:head, legs:legs, tail:tail, wings:wings}};
}

function mobBeast(skin, rank) {
  if (skin === 'dragon') { return mobEnderDragon(rank); }

  var g = new THREE.Group();
  var wings = [], beastLegs = [], serpentSegs = [];
  function bm(c, o) {
    return new THREE.MeshStandardMaterial({ color: c, roughness: (o && o.r) || 0.8,
      metalness: (o && o.m) || 0.05, emissive: (o && o.e) || 0x000000,
      emissiveIntensity: (o && o.ei) || 1 });
  }
  function add(geo, mat, x, y, z, rx, ry, rz, sx, sy, sz) {
    var m = new THREE.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.scale.set(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz);
    m.castShadow = true; g.add(m); return m;
  }
  var body = null;
  if (skin === 'toad') {
    var sk = bm(0x7fa34e), eye = bm(0xffdd55, { e: 0xb8861f, ei: 0.8 }), dark = bm(0x28331b);
    body = add(new THREE.SphereGeometry(0.78, 14, 10), sk, 0, 0.82, 0, 0, 0, 0, 1.2, 0.82, 1.05);
    add(new THREE.SphereGeometry(0.52, 14, 10), sk, 0, 1.02, 0.62, 0, 0, 0, 1.22, 0.76, 1.02);
    add(new THREE.SphereGeometry(0.19, 10, 8), eye, -0.28, 1.28, 0.92);
    add(new THREE.SphereGeometry(0.19, 10, 8), eye, 0.28, 1.28, 0.92);
    add(new THREE.SphereGeometry(0.07, 8, 6), dark, -0.28, 1.30, 1.07);
    add(new THREE.SphereGeometry(0.07, 8, 6), dark, 0.28, 1.30, 1.07);
    add(new THREE.BoxGeometry(0.62, 0.07, 0.06), dark, 0, 0.86, 1.08);
    for (var ti = 0; ti < 4; ti++) {
      var tx = ti < 2 ? -0.52 : 0.52, tz = ti % 2 ? 0.42 : -0.32;
      var thip = new THREE.Group(); thip.position.set(tx, 0.7, tz); g.add(thip);
      var tleg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.58, 6), sk);
      tleg.position.y = -0.3; tleg.rotation.z = tx < 0 ? 0.18 : -0.18;
      tleg.castShadow = true; thip.add(tleg);
      var tfoot = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.34), sk);
      tfoot.position.set(0, -0.6, 0.14); tfoot.castShadow = true; thip.add(tfoot);
      beastLegs.push(thip);
    }
  } else if (skin === 'beetle') {
    var sh = bm(0x5a5e50, { m: 0.35, r: 0.4 }), ed = bm(0x9a6b32, { m: 0.35 }), dk = bm(0x191b18);
    body = add(new THREE.SphereGeometry(0.72, 14, 10), sh, 0, 0.72, 0, 0, 0, 0, 1.05, 0.56, 1.3);
    add(new THREE.SphereGeometry(0.34, 12, 8), sh, 0, 0.63, 0.92, 0, 0, 0, 1.1, 0.8, 1.0);
    add(new THREE.ConeGeometry(0.09, 0.62, 7), ed, 0, 0.93, 0.92, -0.28, 0, 0);
    add(new THREE.ConeGeometry(0.11, 0.42, 6), dk, -0.22, 0.58, 1.22, 0.35, 0, 0.22);
    add(new THREE.ConeGeometry(0.11, 0.42, 6), dk, 0.22, 0.58, 1.22, 0.35, 0, -0.22);
    for (var bi = 0; bi < 6; bi++) {
      var bx = bi < 3 ? -0.5 : 0.5, bz = (bi % 3 - 1) * 0.38;
      var bhip = new THREE.Group(); bhip.position.set(bx, 0.57, bz); g.add(bhip);
      var bleg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.58, 6), dk);
      bleg.position.set(0, -0.28, 0); bleg.rotation.z = bx < 0 ? 0.45 : -0.45;
      bleg.castShadow = true; bhip.add(bleg);
      var bfoot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.28), dk);
      bfoot.position.set(bx < 0 ? -0.16 : 0.16, -0.55, 0.12);
      bfoot.castShadow = true; bhip.add(bfoot);
      beastLegs.push(bhip);
    }
  } else if (skin === 'wolf') {
    var fur = bm(0x4b5560, { r: 0.95 }), dk2 = bm(0x252a30), ey = bm(0x7fe8ff, { e: 0x3bbfd8, ei: 1.4 });
    body = add(new THREE.SphereGeometry(0.62, 14, 10), fur, 0, 1.02, 0, 0, 0, 0, 1.0, 0.75, 1.55);
    add(new THREE.SphereGeometry(0.34, 12, 8), fur, 0, 1.28, 0.90, 0, 0, 0, 1.0, 0.85, 1.0);
    add(new THREE.BoxGeometry(0.24, 0.18, 0.5), fur, 0, 1.17, 1.25);
    add(new THREE.SphereGeometry(0.055, 8, 6), ey, -0.14, 1.35, 1.05);
    add(new THREE.SphereGeometry(0.055, 8, 6), ey, 0.14, 1.35, 1.05);
    add(new THREE.ConeGeometry(0.1, 0.34, 7), dk2, -0.19, 1.52, 0.92, 0.1, 0, 0.18);
    add(new THREE.ConeGeometry(0.1, 0.34, 7), dk2, 0.19, 1.52, 0.92, 0.1, 0, -0.18);
    for (var wi = 0; wi < 4; wi++) {
      var wx = wi < 2 ? -0.4 : 0.4, wz = wi % 2 ? 0.42 : -0.46;
      var whip = new THREE.Group(); whip.position.set(wx, 0.92, wz); g.add(whip);
      var wleg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.07, 0.78, 7), fur);
      wleg.position.set(0, -0.38, 0); wleg.castShadow = true; whip.add(wleg);
      var wfoot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 0.34), dk2);
      wfoot.position.set(0, -0.8, 0.16); wfoot.castShadow = true; whip.add(wfoot);
      beastLegs.push(whip);
    }
  } else if (skin === 'dragon') {
    // round602：低多边形四足爬行龙（无翼）。连续躯干 + 分段尾巴 + 三关节腿。
    var green = bm(0x1f5b45, { r: 0.86 }), teal = bm(0x2f8a6b, { r: 0.8 });
    var blue = bm(0x1b3f5c, { r: 0.72, m: 0.12 }), gold = bm(0xd9a441, { r: 0.35, m: 0.55,
      e: 0x5a3a08, ei: 0.35 });
    var eye = bm(0xffd36a, { r: 0.2, m: 0.05, e: 0xff9a1f, ei: 1.6 });
    var bodyPts = [
      new THREE.Vector3(0, 0.92, -2.75),
      new THREE.Vector3(0, 1.02, -2.0),
      new THREE.Vector3(0, 1.12, -1.15),
      new THREE.Vector3(0, 1.22, -0.25),
      new THREE.Vector3(0, 1.34, 0.55),
      new THREE.Vector3(0, 1.62, 1.05),
      new THREE.Vector3(0, 1.98, 1.32)
    ];
    body = mobTaperedTube(bodyPts, [0.16, 0.24, 0.36, 0.44, 0.38, 0.26, 0.22],
      22, 6, 0xd7c7a8, 0xefe2c8, 0.72);
    body.material.flatShading = true;
    body.material.vertexColors = true;
    body.material.needsUpdate = true;
    body.castShadow = true; g.add(body);
    // 胸口/腹部低多边形护甲片
    for (var bs = 0; bs < 5; bs++) {
      add(new THREE.ConeGeometry(0.08, 0.3, 5), gold, 0,
        1.38 + bs * 0.06, -1.9 + bs * 0.66, 0.9, 0, 0, 1, 1, 1);
    }
    // 背脊：金色骨刺
    for (var sp = 0; sp < 7; sp++) {
      add(new THREE.ConeGeometry(0.06 + (1 - sp / 7) * 0.035, 0.26 + (1 - sp / 7) * 0.2, 5),
        gold, 0, 1.42 + sp * 0.09, -1.7 + sp * 0.52, 0.62, 0, 0);
    }
    // 颈鬃：低多边形三角片
    for (var mn = 0; mn < 4; mn++) {
      add(new THREE.ConeGeometry(0.07, 0.22, 4), teal,
        (mn - 1.5) * 0.10, 2.02 + mn * 0.08, 0.76 + mn * 0.12, -0.55, 0, 0);
    }
    // 头部枢轴：头可以独立左右转
    var headPivot = new THREE.Group();
    headPivot.position.set(0, 2.14, 1.22);
    g.add(headPivot);
    function hAdd(geo, material, x, y, z, rx, ry, rz, sx, sy, sz) {
      var o = new THREE.Mesh(geo, material);
      o.position.set(x || 0, y || 0, z || 0);
      o.rotation.set(rx || 0, ry || 0, rz || 0);
      o.scale.set(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz);
      o.castShadow = true; headPivot.add(o); return o;
    }
    hAdd(new THREE.IcosahedronGeometry(0.28, 0), green, 0, 0.06, 0.10, 0, 0, 0, 1.1, 0.9, 1.15);
    hAdd(new THREE.ConeGeometry(0.20, 0.42, 6), green, 0, -0.01, 0.48, Math.PI / 2, 0, 0);
    hAdd(new THREE.BoxGeometry(0.26, 0.075, 0.36), blue, 0, -0.15, 0.44);
    hAdd(new THREE.BoxGeometry(0.06, 0.16, 0.06), gold, 0, 0.08, 0.62);
    hAdd(new THREE.ConeGeometry(0.065, 0.48, 5), gold, -0.18, 0.30, 0.05, 0, 0, -0.28);
    hAdd(new THREE.ConeGeometry(0.065, 0.48, 5), gold, 0.18, 0.30, 0.05, 0, 0, 0.28);
    hAdd(new THREE.SphereGeometry(0.055, 7, 5), eye, -0.13, 0.13, 0.28);
    hAdd(new THREE.SphereGeometry(0.055, 7, 5), eye, 0.13, 0.13, 0.28);
    for (var th = 0; th < 3; th++) hAdd(new THREE.ConeGeometry(0.025, 0.1, 4), gold,
      (th - 1) * 0.075, -0.21, 0.53, -0.25, 0, 0);
    // 下颚、口腔、鼻孔、颊鳍：让头部更像龙头而不是一个锥形嘴
    hAdd(new THREE.BoxGeometry(0.30, 0.08, 0.34), blue, 0, -0.18, 0.38, 0.04, 0, 0.05);
    hAdd(new THREE.BoxGeometry(0.24, 0.035, 0.26), bm(0x2a1d18, { r: 0.95 }),
      0, -0.14, 0.47, 0.02, 0, 0);
    hAdd(new THREE.SphereGeometry(0.035, 6, 5), bm(0x1b110e, { r: 1 }),
      -0.07, 0.12, 0.62, 0.3, 0, 0);
    hAdd(new THREE.SphereGeometry(0.035, 6, 5), bm(0x1b110e, { r: 1 }),
      0.07, 0.12, 0.62, 0.3, 0, 0);
    for (var chf = 0; chf < 3; chf++) {
      hAdd(new THREE.ConeGeometry(0.045, 0.20, 4), teal,
        (chf - 1) * 0.15, -0.02, -0.04, Math.PI / 2, 0, (chf - 1) * 0.35);
    }
    hAdd(new THREE.ConeGeometry(0.06, 0.26, 5), blue, -0.27, 0.22, 0.12, -0.2, 0, 0.8);
    hAdd(new THREE.ConeGeometry(0.06, 0.26, 5), blue, 0.27, 0.22, 0.12, -0.2, 0, -0.8);
    // 四足：大腿根部埋进身体，外面用甲片过渡；爪足，不用圆球关节
    var dragonLegs = [];
    var legData = [
      [-0.42, 0.58, 0], [0.42, 0.58, Math.PI], [-0.42, -0.58, Math.PI], [0.42, -0.58, 0]
    ];
    for (var dl = 0; dl < 4; dl++) {
      var lx = legData[dl][0], lz = legData[dl][1], ph = legData[dl][2];
      // 静态髋甲：固定在身体上，盖住大腿和身体的接缝
      add(new THREE.CylinderGeometry(0.20, 0.15, 0.28, 5), teal, lx, 1.23, lz, 0, 0, 0.06);
      var hip = new THREE.Group(); hip.position.set(lx, 1.22, lz); g.add(hip);
      var thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.115, 0.78, 5), green);
      thigh.position.y = -0.25; thigh.castShadow = true; hip.add(thigh);
      var knee = new THREE.Group(); knee.position.y = -0.58; hip.add(knee);
      var kneeCuff = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.10, 0.14, 5), blue);
      kneeCuff.position.y = 0.02; kneeCuff.castShadow = true; knee.add(kneeCuff);
      var calf = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.075, 0.52, 5), teal);
      calf.position.y = -0.25; calf.castShadow = true; knee.add(calf);
      var ankle = new THREE.Group(); ankle.position.y = -0.52; knee.add(ankle);
      var ankleCuff = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.065, 0.12, 5), blue);
      ankleCuff.position.y = 0.01; ankleCuff.castShadow = true; ankle.add(ankleCuff);
      // 脚掌缩短成楔形，前面是四根脚趾和金色爪，不是圆脚
      var palm = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.06, 0.16), blue);
      palm.position.set(0, -0.03, 0.07); palm.castShadow = true; ankle.add(palm);
      var toes = [-0.09, -0.03, 0.03, 0.09];
      for (var cl = 0; cl < toes.length; cl++) {
        var toe = new THREE.Mesh(new THREE.CylinderGeometry(0.030, 0.023, 0.24, 4), blue);
        toe.rotation.x = Math.PI / 2;
        toe.position.set(toes[cl], -0.035, 0.16);
        toe.castShadow = true; ankle.add(toe);
        var claw = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.20, 5), gold);
        claw.rotation.x = Math.PI / 2;
        claw.position.set(toes[cl], -0.045, 0.34);
        claw.castShadow = true; ankle.add(claw);
      }
      dragonLegs.push({ hip: hip, knee: knee, ankle: ankle, phase: ph });
    }
    // 分段尾巴：从躯干末端逐节挂接，关节可以自然弯曲
    var tailRoot = new THREE.Group();
    tailRoot.position.set(0, 0.98, -2.62);
    g.add(tailRoot);
    var tailSegs = [];
    var tParent = tailRoot;
    for (var ts = 0; ts < 6; ts++) {
      var tseg = new THREE.Group();
      tseg.position.z = ts === 0 ? 0 : -0.36;
      tParent.add(tseg);
      var r0 = 0.18 - ts * 0.023, r1 = r0 * 0.78;
      var tm = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, 0.40, 5), green);
      tm.rotation.x = Math.PI / 2; tm.position.z = -0.20; tm.castShadow = true; tseg.add(tm);
      var spike = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.16, 5), gold);
      spike.position.set(0, r0 * 0.9, -0.18); tseg.add(spike);
      tailSegs.push(tseg);
      tParent = tseg;
    }
    var tailTip = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.48, 5), gold);
    tailTip.rotation.x = -Math.PI / 2; tailTip.position.z = -0.28;
    tParent.add(tailTip);
    // 古骨龙厚膜翼：两层挤出膜 + 前缘骨 + 指骨；翼根盖进身体
    var dragonWings = [];
    var wingOuter = new THREE.MeshStandardMaterial({ color: 0x5d3d79, roughness: 0.48,
      metalness: 0.04, side: THREE.DoubleSide, transparent: true, opacity: 0.94 });
    var wingInner = new THREE.MeshStandardMaterial({ color: 0x24142f, roughness: 0.62,
      metalness: 0.04, side: THREE.DoubleSide, transparent: true, opacity: 0.88 });
    for (var wd = 0; wd < 2; wd++) {
      var wside = wd ? 1 : -1;
      var wingG = new THREE.Group();
      wingG.position.set(wside * 0.38, 1.72, 0.34);
      wingG.rotation.y = wside * 0.48;
      wingG.rotation.z = wside * 0.18;
      wingG.scale.x = wside;
      g.add(wingG);
      // 肩部甲片，遮住翅膀根部和身体接缝
      add(new THREE.CylinderGeometry(0.17, 0.12, 0.22, 5), teal,
        wside * 0.36, 1.78, 0.32, 0, 0, 0.08);
      var wshp = new THREE.Shape();
      wshp.moveTo(0, 0);
      wshp.bezierCurveTo(0.9, 0.56, 1.85, 0.62, 2.28, 0.22);
      wshp.bezierCurveTo(1.95, 0.08, 1.82, 0.0, 1.70, -0.10);
      wshp.bezierCurveTo(1.56, 0.04, 1.42, -0.04, 1.28, -0.18);
      wshp.bezierCurveTo(1.15, -0.01, 1.00, -0.06, 0.82, -0.22);
      wshp.bezierCurveTo(0.68, -0.05, 0.38, -0.02, 0, 0);
      var wmem = new THREE.Mesh(new THREE.ExtrudeGeometry(wshp,
        { depth: 0.075, bevelEnabled: true, bevelSize: 0.018,
          bevelThickness: 0.018, bevelSegments: 1, curveSegments: 9 }), wingOuter);
      wmem.position.set(0, 0.12, 0.0); wmem.castShadow = true; wingG.add(wmem);
      var winn = new THREE.Mesh(new THREE.ExtrudeGeometry(wshp,
        { depth: 0.02, bevelEnabled: false, curveSegments: 7 }), wingInner);
      winn.position.set(0, 0.12, 0.05); winn.scale.set(0.92, 0.92, 1); wingG.add(winn);
      var leading = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.03, 2.15, 6), blue);
      leading.position.set(1.02, 0.28, 0.04); leading.rotation.z = -1.05; wingG.add(leading);
      for (var wb = 0; wb < 3; wb++) {
        var finger = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.018, 1.15, 5), blue);
        finger.position.set(0.46 + wb * 0.54, 0.05 - wb * 0.07, 0.03);
        finger.rotation.z = -1.0 + wb * 0.06; wingG.add(finger);
      }
      var wclaw = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.30, 5), gold);
      wclaw.position.set(2.28, 0.22, 0.02); wclaw.rotation.z = -Math.PI / 2; wingG.add(wclaw);
      dragonWings.push({ g: wingG, base: wside * 0.18, side: wside });
    }
    var dragonParts = { body: body, head: headPivot, legs: dragonLegs,
      tail: tailSegs, wings: dragonWings };
  } else if (skin === 'serpent') {
    var rk = bm(0x5a4436, { r: 0.92 }), rk2 = bm(0x80604a), lv = bm(0xff5a1f, { e: 0xff2a00, ei: 1.4 });
    for (var si = 0; si < 18; si++) {
      var st = si / 17, sa = st * Math.PI * 3.4, sr = 1.25 * (1 - st * 0.75);
      var seg = add(new THREE.SphereGeometry(0.28 - si * 0.009, 10, 8), si % 4 ? rk : rk2,
        Math.cos(sa) * sr, 0.18 + st * 1.35, Math.sin(sa) * sr * 0.8);
      seg.userData.serpX = seg.position.x;
      seg.userData.serpZ = seg.position.z;
      seg.userData.serpI = si;
      serpentSegs.push(seg);
    }
    body = add(new THREE.SphereGeometry(0.38, 12, 9), rk, 0, 1.95, 0.92, 0, 0, 0, 1.15, 0.9, 1.2);
    add(new THREE.SphereGeometry(0.62, 14, 8), rk2, 0, 1.82, 0.7, 0, 0, 0, 1.1, 0.9, 0.18);
    add(new THREE.SphereGeometry(0.06, 8, 6), bm(0xffd34a, { e: 0xff9d1f, ei: 1.4 }), -0.15, 2.02, 1.22);
    add(new THREE.SphereGeometry(0.06, 8, 6), bm(0xffd34a, { e: 0xff9d1f, ei: 1.4 }), 0.15, 2.02, 1.22);
    for (var li = 0; li < 4; li++) add(new THREE.BoxGeometry(0.05, 0.22, 0.05), lv, (li - 1.5) * 0.12, 1.35, 1.00);
    for (var sf = 0; sf < 5; sf++) {
      add(new THREE.ConeGeometry(0.06, 0.28, 5), rk2,
        (sf - 2) * 0.11, 2.28, 0.72, 0.45, 0, 0);
    }
    add(new THREE.BoxGeometry(0.34, 0.04, 0.55), rk2, 0, 1.93, 1.18);
    for (var shp = 0; shp < 9; shp++) {
      add(new THREE.ConeGeometry(0.05, 0.2, 5), lv,
        0, 0.35 + shp * 0.16, -0.2 - shp * 0.05, 0.2, 0, 0);
    }
  } else if (skin === 'eye') {
    var fl = bm(0x6a4a86, { r: 0.8 }), fl2 = bm(0x9b6cb8), sc = bm(0xd8c8ff), ir = bm(0x5bd8ff, { e: 0x2a9bc8, ei: 1.2 }), pu = bm(0x090711);
    body = add(new THREE.SphereGeometry(0.78, 16, 12), fl, 0, 2.05, 0, 0, 0, 0, 1.05, 1.0, 1.0);
    add(new THREE.SphereGeometry(0.64, 16, 12), sc, 0, 2.05, 0.48, 0, 0, 0, 1, 1, 0.42);
    add(new THREE.SphereGeometry(0.31, 14, 10), ir, 0, 2.05, 0.76, 0, 0, 0, 1, 1, 0.25);
    add(new THREE.SphereGeometry(0.13, 10, 8), pu, 0, 2.05, 0.86, 0, 0, 0, 1, 1, 0.25);
    add(new THREE.TorusGeometry(0.98, 0.035, 6, 28), fl2, 0, 2.05, -0.04, 1.1, 0, 0);
    add(new THREE.TorusGeometry(1.12, 0.02, 5, 28), ir, 0, 2.05, -0.04, 1.4, 0, 0);
    for (var ei = 0; ei < 6; ei++) {
      var ea = ei / 6 * 6.28, ex = Math.cos(ea) * 0.55, ez = Math.sin(ea) * 0.55;
      for (var ej = 0; ej < 3; ej++) {
        add(new THREE.SphereGeometry(0.08 - ej * 0.01, 8, 6), fl2,
          ex * (1 + ej * 0.4), 1.45 - ej * 0.55, ez * (1 + ej * 0.4));
      }
    }
  }
  if (!body) { body = add(new THREE.SphereGeometry(0.4, 8, 8), bm(0x888888), 0, 1, 0); }
  try {
    body.userData.baseY = body.position.y;
  } catch (eTex) { }
  var dummyL = new THREE.Group(); dummyL.position.set(-0.4, 0, 0); g.add(dummyL);
  var dummyR = new THREE.Group(); dummyR.position.set(0.4, 0, 0); g.add(dummyR);
  var lod = new THREE.Mesh(body.geometry, body.material);
  lod.position.copy(body.position); lod.rotation.copy(body.rotation); lod.scale.copy(body.scale);
  lod.visible = false; g.add(lod);
  var hh = { g: g, body: body, lod: lod, legL: dummyL, legR: dummyR,
    armL: dummyL, armR: dummyR, casters: [body], beast: 1,
    wings: wings, beastLegs: beastLegs, serpentSegs: serpentSegs,
    dragon: (typeof dragonParts !== 'undefined' ? dragonParts : null) };
  return hh;
}

function mobHumanSkin(g, skin, rank) {
  var col = { rift: 0x3d7a62, guard: 0x8b8272, ember: 0x3a2420,
    butcher: 0xb49a7e, mage: 0x5a4b70, mech: 0x7d8b88 }[skin];
  var accent = { rift: 0x9a3f2a, guard: 0xb33a2e, ember: 0xff6a2a,
    butcher: 0x8a2b24, mage: 0x7d4fc4, mech: 0xff5a3a }[skin] || 0xffb35a;
  function bm(c, m) { return new THREE.MeshStandardMaterial({ color: c, roughness: m ? 0.35 : 0.85, metalness: m ? 0.55 : 0.05 }); }
  function add(geo, mat, x, y, z, rx, ry, rz, sx, sy, sz) {
    var o = new THREE.Mesh(geo, mat); o.position.set(x, y, z);
    o.rotation.set(rx || 0, ry || 0, rz || 0);
    o.scale.set(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz);
    o.castShadow = true; g.add(o); return o;
  }
  if (skin === 'rift') {
    for (var i = 0; i < 5; i++) add(new THREE.ConeGeometry(0.08, 0.55, 5), bm(0x253c30),
      (i - 2) * 0.12, 1.55 + Math.abs(i - 2) * 0.05, -0.27, -0.45, 0, (i - 2) * 0.1);
    add(new THREE.BoxGeometry(0.05, 0.5, 0.05), bm(accent), 0, 1.2, 0.34, 0, 0, 0);
  } else if (skin === 'guard') {
    add(new THREE.CylinderGeometry(0.45, 0.5, 0.9, 12), bm(0x6f7672, 1), 0, 1.48, 0.03);
    add(new THREE.TorusGeometry(0.5, 0.035, 6, 16), bm(accent), 0, 1.78, 0.03, 0, 0, 0);
    add(new THREE.BoxGeometry(0.08, 0.5, 0.08), bm(0x2a2c2a), 0, 1.9, 0.25);
  } else if (skin === 'ember') {
    for (var e = 0; e < 6; e++) add(new THREE.ConeGeometry(0.09, 0.4 + (e % 2) * 0.15, 5),
      bm(e % 2 ? 0xffb23a : 0xff5a1f), (e - 2.5) * 0.09, 2.35, 0, 0, 0, (e - 2.5) * 0.15);
    add(new THREE.SphereGeometry(0.1, 6, 5), bm(0xff4a1a), 0, 1.35, 0.36);
  } else if (skin === 'butcher') {
    add(new THREE.BoxGeometry(0.65, 0.8, 0.05), bm(0x5d3b2c), 0, 1.15, 0.35);
    var cl = add(new THREE.BoxGeometry(0.12, 1.3, 0.1), bm(0x3b2a24), -0.7, 1.1, 0.25, 0, 0, -0.18);
    add(new THREE.BoxGeometry(0.42, 0.36, 0.08), bm(0x9c9c94, 1), -0.78, 0.48, 0.25, 0, 0, -0.18);
  } else if (skin === 'mage') {
    add(new THREE.ConeGeometry(0.72, 1.3, 16), bm(0x2b1e3e), 0, 0.75, 0);
    add(new THREE.ConeGeometry(0.42, 0.65, 14), bm(0x2b1e3e), 0, 2.35, 0);
    add(new THREE.SphereGeometry(0.18, 12, 8), bm(0x8fe8ff, 0), 0.75, 2.0, 0.15);
    add(new THREE.TorusGeometry(0.32, 0.025, 6, 16), bm(0xb58cff), 0.75, 2.0, 0.15, 1.1, 0.2, 0);
  } else if (skin === 'mech') {
    add(new THREE.BoxGeometry(0.55, 0.35, 0.6), bm(0x87908b, 1), -0.55, 1.9, 0);
    add(new THREE.BoxGeometry(0.55, 0.35, 0.6), bm(0x87908b, 1), 0.55, 1.9, 0);
    add(new THREE.SphereGeometry(0.18, 10, 8), bm(0xff4a20, 0), 0, 1.55, 0.4);
    add(new THREE.TorusGeometry(0.25, 0.04, 6, 16), bm(0x404846), 0, 1.55, 0.38);
  }
  /* 通用外观层：把精英/Boss 从"普通僵尸+圈"变成一眼能认出的个体 */
  add(new THREE.BoxGeometry(0.78, 0.88, 0.54), bm(col || 0x555555, 1),
      0, 1.28, 0.02);
  add(new THREE.BoxGeometry(0.62, 0.22, 0.44), bm(accent, 1),
      0, 1.78, 0.02);                         // 肩甲/颈甲
  var hood = add(new THREE.ConeGeometry(0.34, 0.42, 10), bm(col || 0x333333),
    0, 2.12, 0, 0, 0, 0);
  add(new THREE.SphereGeometry(0.055, 6, 5), bm(accent, 0), -0.12, 1.89, 0.28);
  add(new THREE.SphereGeometry(0.055, 6, 5), bm(accent, 0), 0.12, 1.89, 0.28);
  add(new THREE.BoxGeometry(0.06, 1.35, 0.06), bm(0x2b211d, 1),
      0.72, 1.15, 0.12, 0, 0, -0.12);          // 长武器
  add(new THREE.BoxGeometry(0.28, 0.16, 0.09), bm(0xa9b3a4, 1),
      0.79, 1.82, 0.12, 0, 0, -0.12);
  add(new THREE.BoxGeometry(0.24, 0.68, 0.03), bm(accent),
    0, 1.18, -0.31, 0, 0, 0);                  // 披风/背饰
  hood.rotation.x = -0.08;
}

function mobHumanRank(skin, rank) {
  var g = new THREE.Group();
  var casters = [], limbs = [];
  var profile = {
    rift: { body: 0x5d8a6f, armor: 0x5b2f28, eye: 0xff8a4a, scale: 1.05 },
    guard: { body: 0x9aa098, armor: 0x9a3a2e, eye: 0xffd36a, scale: 1.16 },
    ember: { body: 0x6b3a2e, armor: 0x9a3a1e, eye: 0xff5a1f, scale: 1.05 },
    butcher: { body: 0x8f7460, armor: 0x7d2a24, eye: 0xffb35a, scale: 1.18 },
    mage: { body: 0x5a4780, armor: 0x7d4fc4, eye: 0xb58cff, scale: 1.02 },
    mech: { body: 0x99a39e, armor: 0x8a3c2a, eye: 0xff5a3a, scale: 1.2 }
  }[skin] || { body: 0x555555, armor: 0x8a6a3a, eye: 0xffb35a, scale: 1 };
  function bm(c, m, e) {
    return new THREE.MeshStandardMaterial({ color: c, roughness: m ? 0.4 : 0.8,
      metalness: m ? 0.5 : 0.05, emissive: e || 0x000000, emissiveIntensity: e ? 1.2 : 0 });
  }
  function add(geo, mat, x, y, z, rx, ry, rz) {
    var o = new THREE.Mesh(geo, mat);
    o.position.set(x || 0, y || 0, z || 0);
    o.rotation.set(rx || 0, ry || 0, rz || 0);
    o.castShadow = true; g.add(o); casters.push(o); return o;
  }
  function limb(x, y, isArm, c) {
    var p = new THREE.Group(); p.position.set(x, y, 0);
    var mesh = new THREE.Mesh(new THREE.BoxGeometry(isArm ? 0.22 : 0.25,
      isArm ? 0.72 : 0.82, isArm ? 0.22 : 0.28), bm(c, false));
    mesh.position.y = isArm ? -0.35 : -0.4; mesh.castShadow = true;
    p.add(mesh); g.add(p); casters.push(mesh); limbs.push(p);
    return p;
  }
  var sc = profile.scale;
  var ring = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.03, 6, 24),
    new THREE.MeshBasicMaterial({ color: rank >= 2 ? 0xff4a3a : 0xffb347,
      transparent: true, opacity: 0.8, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; g.add(ring);
  var legL = limb(-0.19 * sc, 0.58, false, profile.body);
  var legR = limb(0.19 * sc, 0.58, false, profile.body);
  var armL = limb(-0.39 * sc, 1.52, true, profile.body);
  var armR = limb(0.39 * sc, 1.52, true, profile.body);
  var body = add(new THREE.CylinderGeometry(0.28 * sc, 0.34 * sc, 0.8, 8),
    bm(profile.body, true), 0, 1.22, 0);
  add(new THREE.BoxGeometry(0.56 * sc, 0.22, 0.36), bm(profile.armor, true), 0, 1.64, 0);
  add(new THREE.SphereGeometry(0.24 * sc, 12, 9), bm(profile.body, false), 0, 1.91, 0);
  add(new THREE.SphereGeometry(0.055, 7, 5), bm(profile.eye, false, profile.eye), -0.09, 1.95, 0.19);
  add(new THREE.SphereGeometry(0.055, 7, 5), bm(profile.eye, false, profile.eye), 0.09, 1.95, 0.19);
  // 各人型专属轮廓
  if (skin === 'rift') {
    add(new THREE.ConeGeometry(0.08, 0.62, 5), bm(0x1f3028), 0, 2.28, -0.04, 0.1, 0, 0);
    for (var ri = 0; ri < 4; ri++) {
      add(new THREE.ConeGeometry(0.06, 0.42, 5), bm(0x263a30),
        (ri - 1.5) * 0.13, 2.05, -0.18, -0.45, 0, (ri - 1.5) * 0.2);
    }
    add(new THREE.BoxGeometry(0.34, 0.62, 0.03), bm(0x3e2720), 0, 1.12, -0.27);
    add(new THREE.ConeGeometry(0.06, 0.7, 5), bm(0x8a3e2a), 0.43, 1.05, 0.12, 0, 0, -0.35);
  } else if (skin === 'guard') {
    add(new THREE.CylinderGeometry(0.34 * sc, 0.4 * sc, 0.55, 10), bm(0x5e6661, true), 0, 1.91, 0);
    add(new THREE.BoxGeometry(0.16, 0.1, 0.62), bm(profile.armor, true), -0.5, 1.5, 0.05);
    add(new THREE.BoxGeometry(0.8, 0.52, 0.08), bm(0x8d958c, true), -0.62, 1.08, 0.12);
    add(new THREE.BoxGeometry(0.06, 0.34, 0.06), bm(0xffd36a, false, 0xffd36a), 0, 2.24, 0);
  } else if (skin === 'ember') {
    for (var ei = 0; ei < 5; ei++) {
      add(new THREE.ConeGeometry(0.07, 0.35 + (ei % 2) * 0.2, 5),
        bm(ei % 2 ? 0xffb23a : 0xff5a1f, false, 0xff5a1f),
        (ei - 2) * 0.09, 2.28, 0, 0, 0, (ei - 2) * 0.15);
    }
    add(new THREE.BoxGeometry(0.07, 1.25, 0.07), bm(0x2a1b16), 0.42, 1.2, 0.1);
    add(new THREE.ConeGeometry(0.16, 0.5, 6), bm(0xff7a2a, false, 0xff4a1a), 0.42, 1.9, 0.1);
    add(new THREE.BoxGeometry(0.4, 0.55, 0.04), bm(0x2b1713), 0, 1.15, 0.27);
  } else if (skin === 'butcher') {
    add(new THREE.BoxGeometry(0.58 * sc, 0.78, 0.05), bm(0x5c392b), 0, 1.12, 0.28);
    add(new THREE.BoxGeometry(0.14, 1.15, 0.1), bm(0x3a2821, true), 0.42, 1.12, 0.1, 0, 0, -0.18);
    add(new THREE.BoxGeometry(0.34, 0.42, 0.08), bm(0x9c9c94, true), 0.48, 1.72, 0.12);
    add(new THREE.CylinderGeometry(0.4 * sc, 0.46 * sc, 0.38, 8), bm(0x4a2b22, true), 0, 1.58, 0);
  } else if (skin === 'mage') {
    add(new THREE.ConeGeometry(0.56 * sc, 1.0, 14), bm(0x271a3a), 0, 0.72, 0);
    add(new THREE.ConeGeometry(0.3 * sc, 0.55, 12), bm(0x271a3a), 0, 2.3, 0);
    add(new THREE.TorusGeometry(0.26, 0.025, 6, 18), bm(0xb58cff, false, 0xb58cff), 0.48, 1.7, 0.1, 1.2, 0.2, 0);
    add(new THREE.SphereGeometry(0.16, 10, 8), bm(0x8fe8ff, false, 0x5bd8ff), 0.48, 1.7, 0.1);
    add(new THREE.BoxGeometry(0.05, 1.3, 0.05), bm(0x3a2b22), 0.48, 1.0, 0.1);
  } else if (skin === 'mech') {
    add(new THREE.BoxGeometry(0.7 * sc, 0.34, 0.5), bm(0x525b57, true), 0, 1.62, 0);
    add(new THREE.BoxGeometry(0.56 * sc, 0.42, 0.44), bm(0x87918c, true), 0.5, 1.52, 0);
    add(new THREE.SphereGeometry(0.18, 10, 8), bm(0xff4a20, false, 0xff4a20), 0, 1.3, 0.3);
    add(new THREE.BoxGeometry(0.3, 0.08, 0.08), bm(0x2f3734, true), 0, 2.18, 0);
    add(new THREE.CylinderGeometry(0.1, 0.1, 0.55, 8), bm(0x555e5a, true), -0.46, 1.5, 0.05, 0, 0, 1.2);
  }
  var lod = new THREE.Mesh(body.geometry, body.material);
  lod.position.copy(body.position); lod.scale.copy(body.scale);
  lod.visible = false; g.add(lod);
  return { g: g, body: body, lod: lod, legL: legL, legR: legR,
    armL: armL, armR: armR, casters: casters, beast: 1,
    limbs: [], slots: [], attached: true };
}

function mob(kind, rank, skin) {
  rank = rank | 0;
  if (rank > 0 && BEAST_SKINS[skin]) { return mobBeast(skin, rank); }
  if (rank > 0) { return mobHumanRank(skin, rank); }
  var cls = mobClassOf(kind) || {};
  var thick = cls.thick || 1;
  var g = new THREE.Group();
  var bodyMesh = new THREE.Mesh(mobGeoOf(kind), vcMat());
  bodyMesh.castShadow = true; g.add(bodyMesh);
  /* ★ round600：精英/Boss 先给轮廓光环；具体物种模型后续替换 hh.body */
  if (rank > 0) {
    var _rg = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.035, 6, 24),
      new THREE.MeshBasicMaterial({ color: rank >= 2 ? 0xff4a3a : 0xffb347,
        transparent: true, opacity: 0.85, depthWrite: false }));
    _rg.rotation.x = -Math.PI / 2;
    _rg.position.y = MOB_FEET + 0.04;
    g.add(_rg);
    g.userData.rankRing = _rg;
  }
  var casters = [bodyMesh];      // ★ 第 44 轮：投影网格列表（按距离开关用 ✓）
  /* ★ round434：枢轴只存姿势（rotation）✗ 不再挂到模型上 ✓
     ★ 但得记住"它属于哪个桶"（isArm/thick/颜色）—— 每帧要算矩阵 ✓ */
  function limb(c, x, isArm) {
    var p = new THREE.Group();
    p.position.set(x, (isArm ? 1.60 : 0.60) + MOB_FEET, 0);
    if (isArm) { p.rotation.x = -1.35; }
    /* ★ 实例化时它不参与渲染；倒地/淡出时才挂回去 ✗ 所以 mesh 照建 ✓ */
    var b = new THREE.Mesh(limbGeoOf(isArm, thick, c), vcMat());
    b.castShadow = true;
    p.add(b);
    p.userData = { bucket: { isArm: isArm, thick: thick, col: c } };
    return p;
  }
  var armC = cls.limb || 0x5a8a48;
  var legC = cls.leg || 0x3e3ea0;
  var legL = limb(legC, -0.25 * thick, 0), legR = limb(legC, 0.25 * thick, 0);
  var armL = limb(armC, -0.64 * thick, 1), armR = limb(armC, 0.64 * thick, 1);
  /* ★★ round426：远处用的"静态合并 LOD"（身体+四肢合一个网格 ✓ 默认隐藏 ✓）
     ★ 只加一个隐藏网格 = 不画的时候 0 次绘制 ✓（three.js 跳过 visible=false ✓）*/
  var lodMesh = new THREE.Mesh(mobLodGeoOf(kind), vcMat());
  lodMesh.castShadow = true;
  lodMesh.visible = false;
  g.add(lodMesh);
  casters.push(lodMesh);
  var hh = { g: g, mid: NET.pid + ':' + (++NET.mobSeq),   // ★ 全局唯一 id（多人同步用 ✓）
             body: bodyMesh, lod: lodMesh,
             legL: legL, legR: legR, armL: armL, armR: armR, casters: casters };
  if (rank > 0) { mobHumanSkin(g, skin, rank); }
  /* ★ 四肢列表（实例化用）+ 实例槽位（懒分配 ✓）*/
  hh.limbs = [legL, legR, armL, armR];
  hh.slots = null;
  hh.attached = false;
  return hh;
}
/* ★★ round434：每帧把四肢姿势写进实例矩阵 ✗
   矩阵 = 模型世界矩阵 × 平移(枢轴) × 旋转(姿势) ✓ 和原来挂在模型上时完全一致 ✓ */
var _limbM4 = null;

function limbAttach(rm) {
  if (!rm.hh || !rm.hh.limbs) { return; }
  /* ★★ round435（用户："打死怪之后会出现僵尸的手和脚的尸体残留"）★★
     根因：远处怪已经在 LOD 状态（body 隐藏、lodMesh 显示，而 lodMesh 里【已经包含四肢】）
           死亡时我把真实四肢挂回去 → 两套四肢叠在一起 ✗
           如果 body 还是隐藏的 → 只剩手脚浮在空中 ✗✗
     修：挂回时强制「四肢可见 + body 可见 + lodMesh 不可见」✓ */
  if (!rm.hh.attached) {
    for (var i = 0; i < rm.hh.limbs.length; i++) { rm.hh.g.add(rm.hh.limbs[i]); }
    rm.hh.attached = true;
  }
  for (var j = 0; j < rm.hh.limbs.length; j++) { rm.hh.limbs[j].visible = true; }
  if (rm.hh.body) { rm.hh.body.visible = true; }
  if (rm.hh.lod) { rm.hh.lod.visible = false; }
}
function limbDetach(rm) {
  if (!rm.hh || !rm.hh.limbs || !rm.hh.attached) { return; }
  for (var i = 0; i < rm.hh.limbs.length; i++) { rm.hh.g.remove(rm.hh.limbs[i]); }
  rm.hh.attached = false;
}

function limbSlotsFor(rm) {
  if (rm.hh.slots) { return rm.hh.slots; }
  var out = [];
  for (var i = 0; i < rm.hh.limbs.length; i++) {
    var bk2 = rm.hh.limbs[i].userData.bucket;
    var bucket = limbBucketOf(bk2.isArm, bk2.thick, bk2.col);
    var idx;
    if (bucket.free && bucket.free.length) {
      idx = bucket.free.pop();          /* ★ 回收的槽优先用 ✗ 不然 used 只增不减 ✓ */
    } else {
      idx = bucket.used++;
    }
    if (idx < LIMB_CAP && bucket.mesh.count < idx + 1) {
      bucket.mesh.count = idx + 1;   /* ★★ 只画用到的实例 ✗
        不设 count 就会画全部 256 个槽（空槽是零尺寸 ✗ 但顶点照样过一遍 ✗）
        实测：不设 count 时三角形 32k → 80k ✗ 设了就正常 ✓ */
    }
    out.push({ bucket: bucket, idx: (idx < LIMB_CAP) ? idx : -1 });
  }
  rm.hh.slots = out;
  return out;
}

function limbZero(rm, dirty) {
  if (!rm.hh || !rm.hh.slots) { return; }
  if (!_limbDummy) { _limbDummy = new THREE.Object3D(); }
  if (!_limbM4) { _limbM4 = new THREE.Matrix4(); }
  _limbDummy.position.set(0, 0, 0);
  _limbDummy.rotation.set(0, 0, 0);
  _limbDummy.scale.set(0, 0, 0);
  _limbDummy.updateMatrix();
  for (var i = 0; i < rm.hh.slots.length; i++) {
    var sl = rm.hh.slots[i];
    if (!sl || sl.idx < 0) { continue; }
    sl.bucket.mesh.setMatrixAt(sl.idx, _limbDummy.matrix);
    dirty[sl.bucket.mesh.uuid] = sl.bucket;
  }
}

/* ★★ round436：删怪时释放实例槽（清零 + 回收 ✓）
   ★ 为什么要回收：只清零的话 used 只增不减 ✗ 长时间玩下去桶会被撑满 ✗
     撑满后新怪就没四肢了（只剩身体 ✗）*/
function limbFree(rm) {
  if (!rm || !rm.hh || !rm.hh.slots) { return; }
  if (!_limbDummy) { _limbDummy = new THREE.Object3D(); }
  if (!_limbM4) { _limbM4 = new THREE.Matrix4(); }
  _limbDummy.position.set(0, 0, 0);
  _limbDummy.rotation.set(0, 0, 0);
  _limbDummy.scale.set(0, 0, 0);
  _limbDummy.updateMatrix();
  var dirty = {};
  for (var i = 0; i < rm.hh.slots.length; i++) {
    var sl = rm.hh.slots[i];
    if (!sl || sl.idx < 0) { continue; }
    sl.bucket.mesh.setMatrixAt(sl.idx, _limbDummy.matrix);
    sl.bucket.free.push(sl.idx);        /* ★ 按下标回收 ✓ */
    dirty[sl.bucket.mesh.uuid] = sl.bucket;
  }
  for (var k in dirty) { dirty[k].mesh.instanceMatrix.needsUpdate = true; }
  rm.hh.slots = null;
}

/* ★ 每帧调一次（首次创建临时对象 ✓）*/
function limbInstTick() {
  if (!_limbDummy) { _limbDummy = new THREE.Object3D(); }
  if (!_limbM4) { _limbM4 = new THREE.Matrix4(); }
  var dirty = {}, mid, rm;
  for (mid in NET.rmobs) {
    rm = NET.rmobs[mid];
    if (!rm || !rm.hh || !rm.hh.limbs) { continue; }
    /* ★ 哪些情况要"挂回去"（实例就隐藏）：倒地 / 淡出 / LOD / 不在了
       ── 因为这些时候肢体要跟身体一起旋转/淡出 ✗ 实例管不到淡出 ✓ */
    var dying = (!rm.alive) || (rm.dying >= 0) || rm.faded;
    if (dying) {
      /* ★ 尸体：四肢挂回去（跟身体一起倒地/淡出）+ 强制普通模型显示 ✓ */
      limbAttach(rm);
      limbZero(rm, dirty);
      continue;
    }
    if (rm.lodOn) {
      /* ★ 只是"远" → 四肢根本不画（lodMesh 里已经有了）✗
         千万别挂回去 ✗ 挂回去就是两套四肢 ✗✗ */
      limbDetach(rm);
      limbZero(rm, dirty);
      continue;
    }
    if (rm.hh.attached) { limbDetach(rm); }
    var slots = limbSlotsFor(rm);
    rm.hh.g.updateWorldMatrix(true, false);
    /* 受击闪白（实例颜色乘亮 → 肢体也闪 ✓）*/
    var lit = (rm.flashT && rm.flashT > 0) ? 2.6 : 1.0;
    for (var i2 = 0; i2 < rm.hh.limbs.length; i2++) {
      var L = rm.hh.limbs[i2], sl = slots[i2];
      if (!sl || sl.idx < 0) { continue; }
      _limbDummy.position.copy(L.position);
      _limbDummy.rotation.copy(L.rotation);
      _limbDummy.scale.set(1, 1, 1);
      _limbDummy.updateMatrix();
      _limbM4.multiplyMatrices(rm.hh.g.matrixWorld, _limbDummy.matrix);
      sl.bucket.mesh.setMatrixAt(sl.idx, _limbM4);
      if (sl.bucket.mesh.instanceColor) {
        sl.bucket.mesh.instanceColor.setXYZ(sl.idx, lit, lit, lit);
        sl.bucket.mesh.instanceColor.needsUpdate = true;
      }
      dirty[sl.bucket.mesh.uuid] = sl.bucket;
    }
  }
  for (var k in dirty) { dirty[k].mesh.instanceMatrix.needsUpdate = true; }
}

/* ============ 伤害数字 ============ */
var REUSE_V3 = { v: null };

/* dmg 已搬到 platform/web.js */


/* ★★★ round437（用户："突破时升级做一个好看的特效，做一些闪电效果和音效"）★★★
   做三个东西（全部用几何 + 加法混合 ✗ 不依赖任何素材文件 ✓）：
     ① 三道闪电：从天上劈到自己脚下（带拖尾抖动 ✗ 每帧闪 ✓）
     ② 地面光环：向外扩散、越淡越大 ✓
     ③ 光柱：从脚下冲向天，短短一下 ✓
   ★ 叠加：震屏 + 金字"突破 Lv.N" + 两个音效（manifest + crit）
   ★ 成本：一次升级才出现一次，寿命 0.5~0.9 秒 → 平时 0 开销 ✓ */
var _lvFx = [];
var _lvBoltMat = null;

/* ★ round446：支持传坐标（看别人突破用 ✓）+ 远的声音小一点 */
function fxLevelUp(lv, atX, atZ, remote) {
  var cx = (typeof atX === 'number') ? atX : P.x;
  var cz = (typeof atZ === 'number') ? atZ : P.z;
  var cy = P.y;
  var i, f, st;

  /* ── 工具：造一道"带状闪电"（给顶点 + 索引，宽度沿中段最粗、两头收细）── */
  function boltMesh(x0, z0, top, color, width, opacity, seedJit) {
    var N = 18;                        // ★ 18 个点（比原来 11 更细腻）
    var pts = [];
    for (st = 0; st <= N; st++) {
      f = st / N;
      var jit = Math.sin(f * Math.PI) * seedJit;     // 两头收、中间抖
      pts.push(new THREE.Vector3(
        x0 + (cx - x0) * f + (Math.random() - 0.5) * jit,
        top + (cy - top) * f,
        z0 + (cz - z0) * f + (Math.random() - 0.5) * jit));
    }
    var verts = [], idxs = [];
    var cw = new THREE.Vector3(), toCam = new THREE.Vector3(), sideV = new THREE.Vector3();
    for (var bi = 0; bi < pts.length; bi++) {
      var pb = pts[bi];
      var qb = pts[Math.min(bi + 1, pts.length - 1)];
      cw.copy(qb).sub(pb);
      if (cw.lengthSq() < 1e-6) { cw.set(0, 1, 0); }
      cw.normalize();
      toCam.set(pb.x - cam.position.x, pb.y - cam.position.y, pb.z - cam.position.z).normalize();
      sideV.copy(cw).cross(toCam);
      if (sideV.lengthSq() < 1e-6) { sideV.set(1, 0, 0); }
      /* ★ 宽度：中间最粗、两头收成尖（闪电的形态 ✓ 不是等宽带子 ✗）*/
      var tw = Math.sin((bi / (pts.length - 1)) * Math.PI);
      var w = width * (0.25 + 0.95 * tw);
      sideV.normalize().multiplyScalar(w);
      verts.push(pb.x + sideV.x, pb.y + sideV.y, pb.z + sideV.z);
      verts.push(pb.x - sideV.x, pb.y - sideV.y, pb.z - sideV.z);
      if (bi < pts.length - 1) {
        var a2 = bi * 2;
        idxs.push(a2, a2 + 1, a2 + 2, a2 + 1, a2 + 3, a2 + 2);
      }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idxs);
    var m = new THREE.MeshBasicMaterial({
      color: color, transparent: true, opacity: opacity, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    var mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 7;
    scene.add(mesh);
    return mesh;
  }

  /* ① 三道闪电：每道都是【蓝晕（粗） + 白芯（细）】两层 ✓ */
  for (i = 0; i < 3; i++) {
    var x0 = cx + (Math.random() - 0.5) * 3.2;
    var z0 = cz + (Math.random() - 0.5) * 3.0;
    var top = cy + 16 + Math.random() * 5;
    var jitK = 0.9 + Math.random() * 0.6;
    var lifeB = 0.42 + i * 0.06;
    var glow = boltMesh(x0, z0, top, 0x5aa8ff, 0.20, 0.38, jitK);   // 蓝晕
    _lvFx.push({ o: glow, t: 0, life: lifeB + 0.08, kind: 'boltGlow' });
    var core = boltMesh(x0, z0, top, 0xf2fbff, 0.075, 0.95, jitK);  // 白芯
    _lvFx.push({ o: core, t: 0, life: lifeB, kind: 'bolt' });
  }

  /* ② 三道蓝色"弧形电光"✗ くらせて斜绕在身上 ✓
     （原来贴在地上 → 看着像地面上的亮带 ✗）
     现在：三个高度 + 斜 35°，边转边变淡 → 看着像电光绕着人 ✓ */
  for (i = 0; i < 3; i++) {
    var rr = 0.78 + i * 0.20;
    var ag = new THREE.RingGeometry(rr, rr + 0.16, 30, 1, 0, 2.3 + i * 0.35);
    var am = new THREE.MeshBasicMaterial({
      color: i === 1 ? 0x9fd8ff : 0x5aa8ff, transparent: true, opacity: 0.8, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    var arc = new THREE.Mesh(ag, am);
    arc.position.set(cx, cy + 0.65 + i * 0.55, cz);
    arc.rotation.set(-Math.PI / 2 + 0.62, Math.random() * Math.PI * 2, 0);   /* 斜 35° ✓ */
    arc.renderOrder = 7;
    scene.add(arc);
    _lvFx.push({ o: arc, t: 0, life: 0.6 + i * 0.18, kind: 'arc', spin: (i % 2 ? -1 : 1) * (4.5 + i * 1.8) });
  }

  /* ③ 两层蓝色冲击环（一快一慢，比单环更有层次 ✓）*/
  for (i = 0; i < 2; i++) {
    var rg = new THREE.RingGeometry(0.45 + i * 0.1, 0.95 + i * 0.1, 44);
    var rm2 = new THREE.MeshBasicMaterial({
      color: i ? 0x9fd0ff : 0xd8ecff, transparent: true, opacity: 0.85 - i * 0.15,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
    });
    var ring = new THREE.Mesh(rg, rm2);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(cx, cy + 0.07 + i * 0.03, cz);
    ring.renderOrder = 6;
    scene.add(ring);
    _lvFx.push({ o: ring, t: 0, life: 0.75 + i * 0.28, kind: 'ring', grow: 6.5 - i * 2.2 });
  }

  /* ④ 光柱（两层：内白外蓝，像一道冷光冲上去）*/
  var cg = new THREE.CylinderGeometry(0.17, 0.42, 10.5, 18, 1, true);
  var cm = new THREE.MeshBasicMaterial({
    color: 0x8fc8ff, transparent: true, opacity: 0.20, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  var col = new THREE.Mesh(cg, cm);
  col.position.set(cx, cy + 5.2, cz);
  col.renderOrder = 6;
  scene.add(col);
  _lvFx.push({ o: col, t: 0, life: 0.78, kind: 'pillar' });
  var cg2 = new THREE.CylinderGeometry(0.07, 0.17, 10.5, 14, 1, true);
  var cm2 = new THREE.MeshBasicMaterial({
    color: 0xf0faff, transparent: true, opacity: 0.30, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  var col2 = new THREE.Mesh(cg2, cm2);
  col2.position.set(cx, cy + 5.2, cz);
  col2.renderOrder = 7;
  scene.add(col2);
  _lvFx.push({ o: col2, t: 0, life: 0.7, kind: 'pillar2' });

  /* ⑤ 叠加：音效 / 震屏 / 飘字 / 冷色白闪 */
  var _vf = 1.0;
  if (remote) {
    var _d = Math.hypot(cx - P.x, cz - P.z);
    _vf = Math.max(0.32, Math.min(0.85, 1.0 - _d / 45));   /* ★ 越远越轻 ✓ */
  }
  try { sfx('thunder', _vf); } catch (e1) { }           /* ★ 雷声（主音）*/
  try { sfx('manifest', _vf * 0.75); } catch (e1b) { }  /* ★ 金属醉音（辅）*/
  try { sfx('crit2', _vf * 0.55); } catch (e2) { }
  if (!remote) {
    shake = Math.max(shake, 0.22);
    fxNum('突破 Lv.' + lv, '#9fd0ff', cx, 3.0, cz);
    try { if (UI.flashWhite) { UI.flashWhite(0.16, '#cfe4ff'); } } catch (e4) { }
  } else {
    /* ★ 别人突破：只漂字，不震我的屏、不白闪我的屏 ✓ */
    fxNum('突破 Lv.' + lv, '#9fd0ff', cx, 3.0, cz);
  }
}

function lvFxTick(dt) {
  for (var i = _lvFx.length - 1; i >= 0; i--) {
    var f = _lvFx[i];
    f.t += dt;
    var k = f.t / f.life;
    if (k >= 1) {
      scene.remove(f.o);
      if (f.o.geometry) { f.o.geometry.dispose(); }
      if (f.o.material) { f.o.material.dispose(); }
      _lvFx.splice(i, 1);
      continue;
    }
    if (f.kind === 'bolt' || f.kind === 'boltGlow') {
      /* 闪电感：不平滑变淡 ✗ 而是每帧随机抽动 ✓ */
      var base = (f.kind === 'boltGlow') ? 0.38 : 0.95;
      f.o.material.opacity = base * (1 - k) * (0.40 + 0.60 * Math.random());
    } else if (f.kind === 'arc') {
      /* 弧形电光：转着没 ✗ 边转边变淡 ✓ */
      f.o.rotation.z += (f.spin || 5) * (dt || 0.016);
      f.o.material.opacity = 0.75 * Math.pow(1 - k, 0.8);
      var asc = 1 + k * 0.55;
      f.o.scale.set(asc, asc, asc);
    } else if (f.kind === 'ring') {
      var sc = 1 + k * (f.grow || 7.5);
      f.o.scale.set(sc, sc, sc);
      f.o.material.opacity = Math.max(0, 0.85 * (1 - k) * (1 - k * 0.3));
    } else {
      /* 光柱：快速变淡 + 往上抽高（像一道光冲上去 ✓）*/
      var b0 = (f.kind === 'pillar2') ? 0.45 : 0.30;
      f.o.material.opacity = b0 * Math.pow(1 - k, 1.6);
      f.o.scale.set(1 - k * 0.55, 1 + k * 0.5, 1 - k * 0.55);
    }
  }
}

/* ============ 输入 ============ */

/* bindInput 已搬到 platform/web.js */


/* ============ 档案 ============
   独立版：角色数据全在服务端，WS 的 welcome 里下发（见 wsWelcome → showRole）
   这里不再单独发 HTTP 请求 ✓ 也不再有心跳（长连接自己保活 ✓） */

/* loadProfile 已搬到 platform/web.js */


/* 把服务端下发的角色数据刷到左上角（wsWelcome 里调） */

/* showRole 已搬到 platform/web.js */


/* updHP 已搬到 platform/web.js */


/* ============ 设置面板 ============ */

/* saveSet 已搬到 platform/web.js */


/* applySet 已搬到 platform/web.js */


/* mkOpts 已搬到 platform/web.js */


/* openSet 已搬到 platform/web.js */


/* bindSet 已搬到 platform/web.js */


/* ============ 调试与测试（设置面板按钮调用 ✓）============ */
/* ★ 调试与测试（设置面板按钮调用 ✓）
   _growTimer / _boxOn / _texMode 的声明已挪到文件前面的全局区了 ✓
   （原因见那里的注释：init() 期间就会读到，声明排在 init 之后会静默失效 ✗）*/

function infoText() {
  var wmN = Object.keys(NET.rmobs).length;
  /* ★ 第 32 轮：顺手把"网格桶""物件网格"这些也去掉了（同一个意思：没用还占地方）
     这里只留真正会看的：实体数 / 帧耗时 / 性能提示 ✓ */
  return '实体数 ' + (NET.on ? wmN : mobs.length) + ' / ' + G.MOB_MAX
    + (NET.on ? '（公共 · 服务器管）' : '（单机 · 本地管）')
    + '\n帧耗时 ' + (_lastMs ? _lastMs.toFixed(1) + ' ms（' + Math.round(1000 / _lastMs) + ' FPS）' : '计算中…')
    + '\n\n· 超过 16.7ms = 低于 60fps（开始卡）'
    + '\n· 实体上限 ' + G.MOB_MAX + ' 只（到上限不再生成 ✓）'
    + '\n· 碰撞箱线框可看碰撞范围';
}

/* ★ 妖兽头顶那行字：职业 + 等级 + 血（第 36 轮加了等级，用户要求"僵尸的等级要显示出来"）
   ★ 等级/职业是【服务器】给的（联机时）—— 单机那份自己摇一个，用同一套公式 ✓ */
function mobPlate(m) {
  /* ★ 第 90 轮（用户要求）：僵尸名字后面【不要血量文字】✓
     血量已经显示在血条里了 ✓ 两边都写就重复了 ✗ */
  /* round601：精英/Boss 的名字来自服务器，不能再用职业 kind 覆盖 */
  var nm = (m.rank > 0 && m.name) ? m.name : (m.kind ? m.kind : '僵尸');
  return nm + (m.lv ? ' Lv.' + m.lv : '');
}

/* ★ 单机用的妖兽数值（和服务器 server/mobs.py 同一套公式 —— 方案 §3.2）
   单机只是没网时的兜底，但数值也别和联机差太远，不然测试/手感对不上 ✗ */
function mobHpAt(z) { return Math.round(75 + 22 * z + 0.62 * z * z); }

/* ★ 僵尸体型随等级增长（第 37 轮，用户要求"根据等级适当增加体型"）
   每级 +1.2%，最多 +72%（Lv.61 封顶）——
   封顶是必要的：不封顶的话几百级的怪会变成一堵墙，既挡视线又看着假 ✗ */
function mobScaleAt(lv) {
  var z = Math.max(1, Math.round(lv || 1));
  return G.MOB_SCALE * (1 + Math.min(z - 1, 60) * 0.012);
}

function rollMobLevel() {
  var L = Math.max(1, Math.round((WSC && WSC.role && WSC.role.level) || 1));
  if (Math.random() < 0.5) { return Math.max(1, L + (Math.floor(Math.random() * 3) - 1)); }
  var d = 0;
  while (d < 40 && Math.random() > 0.72) { d++; }
  return Math.max(1, Math.random() < 0.5 ? L + d : L - d);
}

function spawnMobAt(x, z) {
  if (mobs.length >= G.MOB_MAX) { return null; }    // ★ 硬上限（所有生成路径的最后一道闸 ✓）
  var sm = mob(randomMobKind());
  sm.g.position.set(x, 0, z);
  sm.lv = rollMobLevel();
  sm.hpMax = mobHpAt(sm.lv);
  sm.g.scale.setScalar(mobScaleAt(sm.lv));          // ★ 体型随等级（第 37 轮）
  sm.hp = sm.hpMax; sm.cd = 1.5; sm.alive = true; sm.atkT = -1; sm.dying = -1; sm.dead = 0;
  sm.kbT = 0; sm.kbx = 0; sm.kbz = 0; sm.kbUp = 0; sm.ready = -1;
  sm.ui = mkMobUI('僵尸', sm.hpMax, 0.8);
  scene.add(sm.g); mobs.push(sm);
  return sm;
}
function spawnStress(n) {
  if (netServerSpawn(n, false)) { return; }        // ★ 联机 → 让服务器刷（不然只有你看得到 ✗）
  var before = mobs.length;
  for (var i = 0; i < n; i++) {
    if (mobs.length >= G.MOB_MAX) { break; }        // ★ 到上限就停 ✓
    var a = Math.random() * Math.PI * 2, r = 5 + Math.random() * 25;
    spawnMobAt(P.x + Math.cos(a) * r, P.z + Math.sin(a) * r);
  }
  var added = mobs.length - before;
  toast(added < n ? ('已生成 ' + added + ' 只（到上限 ' + G.MOB_MAX + ' ✓ 共 ' + mobs.length + '）')
                  : ('已生成 ' + added + ' 只（共 ' + mobs.length + '）'));
}
function toggleGrow() {
  if (_growTimer) {
    clearInterval(_growTimer); _growTimer = null; toast('已停止持续生成');
  } else {
    _growTimer = setInterval(function () {
      if (NET.on) { netServerSpawn(5, false); return; }   // ★ 联机 → 让服务器加 ✓
      for (var i = 0; i < 5; i++) {
        if (mobs.length >= G.MOB_MAX) { return; }   // ★ 到上限就不再生成 ✓
        var a = Math.random() * Math.PI * 2, r = 8 + Math.random() * 26;
        spawnMobAt(P.x + Math.cos(a) * r, P.z + Math.sin(a) * r);
      }
    }, 1000);
    toast('持续生成中（每秒 +5 ✓ 上限 ' + G.MOB_MAX + '）');
  }
}
function clearMobs() {
  if (NET.on) { netServerSpawn(0, true); return; }     // ★ 联机 → 让服务器清 ✓
  while (mobs.length > 3) {
    var m = mobs.pop();
    if (m.g) { scene.remove(m.g); }
    if (m.shadow) { scene.remove(m.shadow); }
    if (m.boxDbg) { scene.remove(m.boxDbg); }
    UI.plate.remove(m.ui);
  }
  for (var i = 0; i < mobs.length; i++) {
    var ang = i / mobs.length * Math.PI * 2;
    mobs[i].g.position.set(Math.cos(ang) * 10, 0, Math.sin(ang) * 10);
    mobs[i].g.rotation.set(0, 0, 0);
    mobs[i].hp = 30; mobs[i].alive = true; mobs[i].dying = -1; mobs[i].dead = 0;
  }
  toast('已清除（剩 3 只）');
}
function toggleBox() {
  _boxOn = !_boxOn;
  if (_boxOn) {
    if (!H.boxDbg) {
      var bg = new THREE.BoxGeometry(1, 0.1, 1);
      var bm = new THREE.MeshBasicMaterial({ color: 0x00ff88, wireframe: true, transparent: true, opacity: 0.85 });
      H.boxDbg = new THREE.Mesh(bg, bm);
      H.boxDbg.scale.set(G.BODY_W, 1, G.BODY_D);
      scene.add(H.boxDbg);
      for (var i = 0; i < mobs.length; i++) {
        var bb = new THREE.Mesh(bg, bm);
        bb.scale.set(G.MOB_W, 1, G.MOB_D);
        mobs[i].boxDbg = bb; scene.add(bb);
      }
      for (var wmi in NET.rmobs) {                    // ★ 公共妖兽也要有线框 ✓
        var wbb = new THREE.Mesh(bg, bm);
        wbb.scale.set(G.MOB_W, 1, G.MOB_D);
        NET.rmobs[wmi].boxDbg = wbb; scene.add(wbb);
      }
    }
    toast('碰撞箱：开');
  } else {
    if (H.boxDbg) { scene.remove(H.boxDbg); H.boxDbg = null; }
    for (var j = 0; j < mobs.length; j++) { if (mobs[j].boxDbg) { scene.remove(mobs[j].boxDbg); mobs[j].boxDbg = null; } }
    for (var wmj in NET.rmobs) { if (NET.rmobs[wmj].boxDbg) { scene.remove(NET.rmobs[wmj].boxDbg); NET.rmobs[wmj].boxDbg = null; } }
    toast('碰撞箱：关');
  }
}
function cycleTex() {
  _texMode = (_texMode + 1) % 4;
  var names = ['纯色（基准）', '贴图不带顶点色', '贴图+顶点色（正常）', '红白棋盘（验证）'];
  toast('地面模式：' + names[_texMode] + '（刷新后重置 ✓ 用 ?tex=N 可指定）');
}
var _toastEl = null, _toastTimer = null;

/* toast 已搬到 platform/web.js */


/* ============================================================
   ★ 多人联网（第 1 步：位置同步 ✓）
   · 每 0.2 秒上报自己的位置 ✓
   · 每 0.2 秒拉取附近玩家（半径 60 ✓）
   · 其他玩家渲染成方块小人 + 头顶昵称 ✓ 位置插值 ✓
   ============================================================ */

/* ============================================================
   ★★★ 传输层：WebSocket（独立版；替换原来的 HTTP 轮询）★★★

   原来：30Hz POST /api/world/players —— 一问一答，一次往返换一份快照
   现在：一条长连接，服务端主动 30Hz 推 world 快照
         好处：少一半往返、没有请求排队、小游戏平台上也能用（那里只认 WSS）

   连接策略：断了自动重连（指数退避，最长 10 秒）；
             重连期间世界是空的 → 明确告诉玩家，别让他以为游戏坏了
   ============================================================ */

var PROTO_VER = 1;

var WSC = {
  sock: null,
  on: false,            // 玩家已登录（想连）
  ready: false,         // 服务端已 welcome（连上了、进世界了）
  retrying: false,
  retry: 0,
  timer: null,
  token: '',
  myId: 0,
  role: null,
  cfg: { tickHz: 30, view: 60 },
  rtt: 0,
  lastPing: 0
};


/* wsUrl 已搬到 platform/web.js */



/* wsConnect 已搬到 platform/web.js */


function wsRetry(why) {
  if (WSC.retrying) { return; }
  WSC.retrying = true;
  WSC.retry++;
  var wait = Math.min(10000, 500 * Math.pow(1.7, Math.min(WSC.retry, 7)));
  if (WSC.retry <= 2) {
    toast(why + '，' + (wait / 1000).toFixed(1) + ' 秒后重连…');
  } else if (WSC.retry === 3) {
    toast('还是连不上，之后静默重试');
  }
  WSC.timer = setTimeout(function () {
    WSC.retrying = false;
    if (WSC.on) { wsConnect(); }
  }, wait);
}

function wsSend(t, d) {
  var s = WSC.sock;
  if (!s || s.readyState !== 1) { return false; }
  try {
    s.send(JSON.stringify({ t: t, d: d || {} }));
    if (t === 'skillcast' && d && d.key && UI.skCastStart) {
      try { UI.skCastStart(d.key); } catch (eSk2) { }
    }
    return true;
  }
  catch (e) { return false; }
}


/* wsOnMessage 已搬到 platform/web.js */


/* 服务端说"你进来了" */

/* wsWelcome 已搬到 platform/web.js */


/* 服务端推下来的一份世界快照 */
function wsApplyWorld(d) {
  var t = performance.now() / 1000;
  NET.srv = netClkUpdate(NET.srv, t, d.ts);      // ★ 对齐服务器时钟（妖兽排队要用）

  // ---- 其他玩家 ----
  var list = d.players || [], seen = {};
  for (var i = 0; i < list.length; i++) {
    var w = list[i];
    if (!w || !w.id || w.id === WSC.myId) { continue; }
    seen[w.id] = 1;
    // ★ 字段名换一下喂给原来那套（名称短是为了省带宽：n=名字 y=朝向 t=对方的钟）
    addOther({
      uid: w.id, name: w.n, realm: '', lv: w.lv,
      x: w.x, z: w.z, yaw: w.y, hp: w.hp,
      /* ★★★ round336 修的真 bug（跳跃动画始终不显示）★★★
         这一层是【显式字段清单】✗ 服务器发的 jy 不在这里列出来就会被丢掉 ✓
         → addOther 里 w.jy 永远 undefined → tgtJy 永远 0 → 人一动不动 ✓
         ★ 旁边 hpm / mq 那两段注释记的就是同一个坑 ✗ 我这次又踩了第三次 ✓
         ★ 教训：服务器加字段 → ①打包 dict ②这里映射 ③addOther ④渲染
                 四层都要改 ✗ 少一层就静默失效 ✓ */
      jy: Math.max(0, +w.jy || 0),
      seat: (w.seat != null ? String(w.seat) : '-1'),
      sleep: !!w.sleep,                                        // ★ 他躺下了没有
      snapYaw: (typeof w.syaw === 'number') ? w.syaw : 0,
      sz: (typeof w.sz === 'number' && w.sz > 0) ? w.sz : 1,   // ★ round576：体型
      /* ★★★ 第 221 轮修的真 bug（用户："我的血条在别的玩家那边没有按比例扣除，
             只有数字变化"）★★★
         这里原来写死 hpm: 0 ✗
         → 下层兜底成 100（hpMax: (w.hpm > 0) ? w.hpm : 100）
         → 别人看你：血量 200+ ÷ 100 → 血条永远是满的 ✓✓
           而数字是直接显示 hp ✗ 所以数字照常变 ✓ 一字不差
         ★ 为什么第 220 轮没修好：我只在【服务器】那边补了 hpm 字段 ✗
           忘了客户端这层【显式映射表】里 hpm 是写死的 0 ✗✓
           → 服务器的值进来就被覆盖成 0 了 ✓
         ★ 这个坑我记录过（"加服务器字段要改好几层"）✗ 还是又踩了一次 ✓
           层数：服务器打包 dict → 客户端 wsApplyWorld 映射 → addOther → 画血条 */
      hpm: (typeof w.hpm === 'number' && w.hpm > 0) ? w.hpm : 0,
      ct: w.t,
      atk: (typeof w.atk === 'number') ? w.atk : -1,   // ★ 挥砍序号（服务器第 66 轮改的 ✓）
      mate: !!w.mate,        // ★ 第 90 轮：服务器直接告诉我"他是不是我队友" ✓
      wlook: w.w,            // ★ 第 61 轮：他手上是什么武器（动作原型要一致 ✓）
      wtier: (typeof w.wt === 'number') ? w.wt : 0,   // ★ 第 65 轮：品阶（模型颜色/发光用 ✓）
      inv: +w.inv || 0,      // ★ 第 63 轮：他的无敌剩余（队友刚复活要看得见 ✓）
      dead: !!w.d,           // ★ 第 57 轮：他倒下了没有（服务器同步给我的 ✓）
      /* ★★★ 第 156 轮修的真 bug：魔气就是在这里被丢掉的 ★★★
         用户报："自己能看到 ✓ 但看别人的头上没有 ✗"
         根因：这一层是【字段映射】✗ 它用【显式清单】重新拼一个对象 ✗
               → 服务器发的 'mq' 在这里被丢掉 ✗
               → addOther 拿到的 w.mq 永远是 undefined ✗✓
         ★ 为什么难查：自己那边走的是另一条路（服务器推 'mq' 消息 ✗）
           所以自己能看到 ✓ 别人看不到 ✗ 两边现象不一样 ✗
         ★ 教训：服务器加一个字段 → 客户端要改【两处】：
                 ① 映射层的清单 ② 用它的地方 ✗（只改 ② 就会像今天这样 ✗）*/
      mq: +w.mq || 0,
      /* ★★ round424：头顶称号（用户："其它玩家和自己都可以看见"）
         ★ 又是这层【显式映射清单】✗ 少写一行就是静默失效 ✗
           （hpm / mq / jy 都在这里踩过坑 ✗ tools/check_field_map.py 会拦 ✓）
         tt = 文本（'' = 不显示）· tm = 1/2/3 奖牌名次（0 = 没牌）*/
      tt: (typeof w.tt === 'string') ? w.tt : '',
      tm: (typeof w.tm === 'number') ? w.tm : 0,
      /* ★ round485：他的皮肤 key（'' = 老外观 ✓ 又是这层显式清单 ✗ 漏了就静默失效 ✓）*/
      sk: (typeof w.sk === 'string') ? w.sk : '',
      /* ★ round510：他的皮肤自定义（瞳色/发色/衣服/眼型/嘴型）✗ 又是这层显式清单 ✓ */
      skc: (w.skc && typeof w.skc === 'object') ? w.skc : null
    }, t);
  }
  for (var uid in NET.others) { if (!seen[uid]) { removeOther(uid); } }

  /* ★★ 第 69 轮：箭（弓的投射物）★★
     ★ 服务器只发 [id,x,z,yaw] ✓ 位置以服务器为准 → 这里直接摆 ✓
     ★ 细长盒体 + 淡黄：看得清又不花哨 ✓ */
  var arsS = d.ar || [], seenAr = {};
  for (var aq = 0; aq < arsS.length; aq++) {
    var aa = arsS[aq], aid = String(aa[0]);
    seenAr[aid] = 1;
    var am = NET.arrows[aid];
    if (!am) {
      /* ★★ 第 70 轮 用户报：“一点也不像箭” ★★
         以前是一个光秃秃的黄方块 ✗
         现在拼一支真的：细杆 + 尖头（锥）+ 尾羽（两片）✓ */
      /* ★ round389（用户："风格还是要匕首，不要做成箭"）
         ★ 匕首投掷复用箭的系统 ✗ 但模型要换成匕首 ✓
         ★ 用 buildWeaponMesh('dagger') ✗ 和手上那把同一个模型 ✓ */
      if (aa[4] === 1) {
        am = new THREE.Group();
        var _dg = buildWeaponMesh('dagger', 2);
        _dg.rotation.x = Math.PI / 2;      // ★ 横过来 ✗ 像飞出去的刀 ✓
        _dg.scale.set(1.05, 1.05, 1.05);
        am.add(_dg);
        am.position.y = 1.15;
        scene.add(am);
        NET.arrows[aid] = am;
        continue;
      }
      am = new THREE.Group();
      /* ★ 第 71 轮 用户要求：银色箭头 + 灰色箭身 ✓ */
      var _shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.85, 6),
        new THREE.MeshBasicMaterial({ color: 0x9aa0a6 }));
      _shaft.rotation.x = Math.PI / 2;
      am.add(_shaft);
      var _tip = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.18, 6),
        new THREE.MeshBasicMaterial({ color: 0xa9b2ba }));   // ★ 第 71 轮：用户说太亮→调暗 ✓
      _tip.rotation.x = Math.PI / 2;
      _tip.position.z = 0.50;
      am.add(_tip);
      var _fl = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.13, 0.18),
        new THREE.MeshBasicMaterial({ color: 0xa9b2ba }));   // ★ 第 71 轮：尾羽也银色（不要红 ✗）
      _fl.position.z = -0.40;
      am.add(_fl);
      var _fl2 = _fl.clone();
      _fl2.rotation.z = Math.PI / 2;
      am.add(_fl2);
      am.position.y = 1.45;
      scene.add(am);
      NET.arrows[aid] = am;
    }
    /* ★★ 第 71 第三次改：箭不顺滑 ★★
       原因：之前箭的位置【只在收到快照时才改】✗
             快照 30Hz → 箭每 33毫秒跳一下 → 看着一顿一顿的 ✗
       改法：箭的方向和速度都是已知的（服务器发了 yaw ✓
             速度是常量 ✓）→ 客户端自己推 ✓
             快照到了只做【软校正】（偏差大才吸附 ✗）
       ★ 和玩家位置那套插值一个思路 ✓ */
    am.userData.tx = +aa[1] || 0;
    am.userData.tz = +aa[2] || 0;
    am.userData.yaw = +aa[3] || 0;
    am.rotation.y = am.userData.yaw;
    if (am.userData.sx === undefined) {
      am.position.x = am.userData.tx;
      am.position.z = am.userData.tz;
      am.userData.sx = am.position.x;
      am.userData.sz = am.position.z;
    } else {
      var _ex = Math.abs(am.position.x - am.userData.tx);
      var _ez = Math.abs(am.position.z - am.userData.tz);
      if (_ex > 0.9 || _ez > 0.9) {           // 偏太多（丢包/刚刷出）→ 吸附 ✓
        am.position.x = am.userData.tx;
        am.position.z = am.userData.tz;
      } else {                                 // 否则软修正（每包往正确位置拉一点 ✓）
        am.position.x += (am.userData.tx - am.position.x) * 0.25;
        am.position.z += (am.userData.tz - am.position.z) * 0.25;
      }
    }
  }
  for (var aq2 in NET.arrows) {
    if (!seenAr[aq2]) {
      scene.remove(NET.arrows[aq2]);
      // ★ 第 70 轮：箭现在是个 Group ✗ 没有 .geometry 了
      //   直接 dispose 会报错 ✗ 而且几何体是每支独立 new 的（共享的才能 dispose ✗）
      delete NET.arrows[aq2];
    }
  }

  // ---- 妖兽（P2 才有内容，通道先留着）----
  var ms = d.mobs || [], seenMobs = {};
  for (var k = 0; k < ms.length; k++) {
    var mid = addWorldMob(ms[k], t - (NET.srv.off || 0));
    if (mid) { seenMobs[mid] = 1; }
  }
  for (var mid2 in NET.rmobs) { if (!seenMobs[mid2]) { removeWorldMob(mid2); } }

  // ---- 地上掉的（第 38 轮，P2 第二刀）[id, x, z, name, tier] ----
  var ls = d.loot || [], seenLoot = {};
  for (var lk = 0; lk < ls.length; lk++) {
    var lid = addWorldLoot(ls[lk]);
    if (lid) { seenLoot[lid] = 1; }
  }
  for (var lid2 in NET.rloot) { if (!seenLoot[lid2]) { removeWorldLoot(lid2); } }

  /* ---- ★ 僵尸医生给谁回了多少血（第 46 轮）----
     服务器发的是 [医生x, 医生z, 目标x, 目标z, 回了多少] ✓
     客户端只负责表现：拉一条绿线 + 弹一个绿字 ✓（不然玩家完全看不出关联 ✗）*/
  var hl = d.heals || [];
  for (var hi2 = 0; hi2 < hl.length; hi2++) {
    var he2 = hl[hi2];
    addHealBeam(+he2[0], +he2[1], +he2[2], +he2[3]);
    healNum('+' + Math.round(+he2[4] || 0), +he2[2], 2.95, +he2[3]);
  }

  /* ★★★ round349 修的真 bug（用户："没有听到逃跑音效"）★★★
     根因：逃跑事件是走 _add_pend 发的 ✗ 它和 hurts/mhits 一样
           混在【世界快照】里 ✗ 不是独立消息 ✓
     而我写在了独立消息的分发器里 → 永远不会执行 ✓
     修：在这里读 d.flee（和 hurts/mhits 同一个地方 ✓）*/
  var fl = d.flee || [];
  for (var _fi = 0; _fi < fl.length; _fi++) {
    if (fl[_fi] && fl[_fi].mid) { fleePlay(fl[_fi].mid); }
  }

  /* ---- ★ round446：有人突破了（同屏的人）----
     格式 [x, z, 新等级, 是不是本人]
     ★ 本人那条不用放：me.lv 那边已经触发过了 ✗ 会重复放两次 ✓ */
  var lf = d.lvfx || [];
  for (var _li = 0; _li < lf.length; _li++) {
    var _le2 = lf[_li];
    if (!_le2 || _le2.length < 4) { continue; }
    if (+_le2[3]) { continue; }
    try { fxLevelUp(+_le2[2] || 1, +_le2[0], +_le2[1], true); } catch (e5) { }
  }

  // ---- 打在我身上的伤害 ----
  var hs = d.hurts || [];
  for (var h = 0; h < hs.length; h++) { netApplyHurt(hs[h]); }

  /* ---- ★ 我砍中僵尸的反馈（第 35 轮）----
     联机时伤害是【服务器算的】，所以数字也从服务器来 ✓
     本地只负责表现：弹数字 + 出一次音效/震动（砍到多只不叠音效 ✗） */
  var mh = d.mhits || [];
  for (var q2 = 0; q2 < mh.length; q2++) {
    var e2 = mh[q2];
    var edv = Math.round(+e2.dmg || 0);
    if (edv <= 0) { continue; }
    // ★ 保安格挡了会在数字后面标出来（第 40 轮）—— 玩家得知道为什么这一刀不疼 ✓
    // ★★ 第 62 轮：武器效果也标出来（不然玩家不知道那一下为什么特别疼 ✓）★★
    //   · 背击：还要单独飘一个【额外伤害】（用户要求"应该要显示额外伤害"✓）
    //   · 溅射：标出来，玩家才知道这一刀顺带打了旁边的 ✓
    var etxt = String(edv) + (e2.crit ? ' 暴击' : '') + (e2.block ? ' 格挡' : '') +
               (e2.back ? ' 背击' : '') + (e2.splash ? ' 溅射' : '');
    if (e2.sk) { dmgSkill(etxt, +e2.x, 2.4, +e2.z, !!e2.crit); }
    else { dmg(etxt, +e2.x, 2.4, +e2.z, !!e2.crit); }
    /* ★ round383（用户："暴击动画做成跳起来打"）
       ★ 只是动画 ✗ 不真的跳（不影响移动/命中 ✓）*/
    if (e2.crit) { _jumpAtkUntil = performance.now() + _jumpAtkDur; }
    /* ★ round340：僵尸被打中闪白（用户要求 ✓）环境伤害不闪 ✓ */
    if (!e2.env) {
      var _rm2 = NET.rmobs && NET.rmobs[e2.mid];
      if (_rm2 && _rm2.g) { flashCloneMesh(_rm2.g); }
    }
    /* ★ round324（用户："僵尸进岩浆受伤，为什么我的屏幕也会抖动"）
       env=1 = 环境伤害（岩浆烧僵尸）✗ 只是"别人在掉血"✓
       → 不震屏、不顿帧、不出打击音效 ✓ 只飘数字 ✓ */
    if (e2.env) { continue; }
    if (e2.back && +e2.mb > 1.0) {
      // 额外 = 总额 - 不背击时的那一份（服务器给了倍率 ✓ 客户端不用自己猜公式 ✓）
      var extra = Math.max(1, Math.round(edv - edv / (+e2.mb)));
      fxNum('额外 +' + extra, '#ffd83d', +e2.x, 2.9, +e2.z);
    }
    /* ★ round352（用户："武器吸血要飘绿字在自己头上"）
       ★ 服务器把吸血量放进 mhits 里（heal 字段 ✓）✗ 这里只负责显示 ✓ */
    if (e2.heal > 0) {
      fxNum('+' + Math.round(e2.heal), '#6ee06e', P.x, 2.9 + 0.3, P.z);
    }
    if (q2 === 0) {
      sfx(e2.crit ? 'crit' : 'hit', 1.0);
      sfx('zhurt', 0.7);
      shake = e2.crit ? 0.45 : 0.22;
      /* ★★ round430（用户："没感觉有什么区别呢"）★★
         根因：真正的暴击走的是【服务器下发的 hurts】这条路 ✗
               而我上一轮把顿帧/镜头推近加在了【hurtMob】（本地结算那条 ✗ 几乎不走）→ 白改 ✗
         修：在这里也触发 ✓ */
      /* ★ 只给暴击加顿帧 ✗ 普通命中不加（不然每砍一刀都卡一下 ✗ 手感会变✗）*/
      if (e2.crit) { hitStop = 0.11; }   /* ★ round431扁：镜头推近去掉了（用户：感觉没什么用）*/
    }
  }

  /* ---- ★ 我的经验 / 等级（变了服务器才带）→ 直接刷左上角 HUD ✓ ---- */
  /* ★ 第 102 轮：升级/经验推送里也带了【有效生命上限】✓
     （含防具加成 ✓ 不然升完级就对不上了 ✗）*/
  if (d.me && typeof d.me.hpm === 'number' && d.me.hpm > 0) {   // ★ 空值保护✗
    HPMAX = d.me.hpm;
    if (HP > HPMAX) { HP = HPMAX; }
    updHP();
  }
  /* ★ round576：坦克引擎体型（服务端每帧带 sz ✓ 变了才重设 scale）*/
  if (d.me && typeof d.me.sz === 'number' && d.me.sz > 0 &&
      Math.abs(d.me.sz - MY_SIZE) > 0.0005) {
    MY_SIZE = d.me.sz;
    applyMySize();
  }
  /* ★ round576：嗜血 buff 倍率（服务端每帧带 ✓）*/
  if (d.me && typeof d.me.atkSpd === 'number' && d.me.atkSpd > 0) { MY_ATK_SPD = d.me.atkSpd; }
  if (d.me && typeof d.me.moveSpd === 'number' && d.me.moveSpd > 0) { MY_MOVE_SPD = d.me.moveSpd; }
  if (d.me && typeof d.me.frz === 'number') { MY_FROZEN = d.me.frz ? 1 : 0; }
  if (d.me && typeof d.me.downT === 'number') { MY_DOWN = Math.max(0, d.me.downT); }
  if (d.me && typeof d.me.slow === 'number' && d.me.slow > 0) { MY_SLOW = d.me.slow; }
  /* ★★ 第 168 轮（用户 #1：升级后恢复满血）★★
     服务器升级时把血拉满 ✓ 并在 me 里告诉我新血量 ✓
     ★ 这里只认【升级这一条消息】里的值 ✗
       不是第 140 轮那种“每帧同步”✗（那个你说不对 ✓ 已经改回去了 ✓）
     ★ 只往上跟：只有比现在高才接受 ✗
       （免得和其他地方的血量计算打架 ✗）*/
  if (d.me && typeof d.me.hp === 'number') {
    /* ★★★ 第 219 轮修的真 bug（用户："打着打着进入假死状态，别人看你已经死了，
           自己看还活着"）★★★
       病根：这里原来只写"比现在高才采用" ✗
             → 服务器那边的【掉血】永远同步不到客户端 ✓
             → 服务器先把你打死了（它那边 hp=0）✗
             → 客户端还显示着自己那套血量（>0）→ 你看着还活着 ✓✓
             → 别人看你已经躺了 ✓ 一字不差
       修：服务器说"你没血了"（<=0）时【必须采用】✗
           ★ 为什么不做成全量双向同步：第 140 轮试过 ✗
             每帧同步会和本地预测打架 → 血条抖 ✓ 你当时说不对 ✓
           ★ 所以这里只补"死亡"这一种最要命的情况 ✓ 其余照旧 ✓ */
    var _shp = d.me.hp;
    /* ★★★ 第 239 轮：改成【无条件采用】★★★
       原来只写"比现在高才采用"（后来又加了个"<=0 才采用"✗ 都是打补丁 ✓）
       → 结果：服务器一点一点打掉的血【永远同步不过来】✗
       → 血条不跟着掉 ✓ 到服务器判死那一刻才突然变尸体 ✓
       → 用户报的"假死"就是这个 ✓（别人看你死了 ✗ 你看自己活着 ✓）
       ★ 现在服务器【每帧】都推血量（30Hz ✓）→ 直接赋值最准
         30 次/秒的更新足够平滑 ✗ 不会像第 140 轮那样抖 ✓
         （当时抖是因为只在"变化时"发 ✗ 间隔不均匀 ✓）
       ★ 第 219 轮那段"<=0 就补一次 playerDie"保留 ✓ 双保险 ✓ */
    HP = Math.max(0, Math.min(_shp, HPMAX > 0 ? HPMAX : _shp));
    updHP();
  }

  if (d.me && typeof d.me.seat === 'number') {
    if (d.me.seat >= 0) {
      if (!MY_SEAT || String(MY_SEAT.idx) !== String(d.me.seat)) {
        try { townSeatApply({ id: d.me.seat }); } catch (eMS) { }
      }
    } else if (MY_SEAT) {
      try { townSeatClear(null); } catch (eMT) { }
    }
  }
  if (d.me) {
    if (WSC.role) {
      /* ★★★ 第 249 轮修的真 bug（用户："杀怪看不到经验条动，并且显示0"）★★★
         病根：第 239 轮为了让血量实时同步 ✗ 让服务器【每帧】都推 me ✓
              但 me 里只带 hp/hpm ✗ 不带 lv/exp ✗
              而这里原来是【无条件赋值】：
                  WSC.role.level = d.me.lv || WSC.role.level || 1;
                  WSC.role.exp   = d.me.exp || 0;     ← 每帧把经验清成 0 ✗✗
              → 经验条永远是 0 ✗ 杀怪也不动 ✓ 用户报的一字不差 ✓
         ★ 修法：改成【部分更新】✗ 服务器给了哪个字段才更新哪个 ✓
         ★ 教训：把"变化时才推"改成"每帧都推"的时候 ✗
           必须同时检查【接收端有没有把缺失字段当成 0】✓
           （这次就是漏了这一步 ✗ 结果经验被每帧清零 ✓）*/
      if (typeof d.me.lv === 'number' && d.me.lv > 0) {
        /* ★ round437：等级变【高了】→ 放突破特效 ✗ 登录/刷新不放 ✓ */
        var _oldLv = WSC.role.level || 1;
        if (d.me.lv > _oldLv) {
          try { fxLevelUp(d.me.lv); } catch (e3) { }
        }
        WSC.role.level = d.me.lv;
      }
      if (typeof d.me.exp === 'number') { WSC.role.exp = d.me.exp; }
      /* round294d: gold must be adopted field-wise too. The `me` payload is a
         partial update (that is the whole point of the round-239 fix), so a new
         field is silently dropped unless it is listed here. */
      if (typeof d.me.gold === 'number') { WSC.role.gold = d.me.gold; }
      /* ★★ round424：自己的头顶称号（用户："自己也看得见"）
         ★ 这里也是【部分更新】→ 没给就不动 ✗ 不能当成清空 ✓（和经验条那个坑一样 ✗）*/
      if (typeof d.me.tt === 'string') { MY_TT = d.me.tt; }
      if (typeof d.me.tm === 'number') { MY_TM = d.me.tm; }
      /* ★★★ 第 230 轮修的真 bug（用户："升级所需经验客户端显示的是不是不会刷新，
             导致经验显示已经够升级了，结果还没有升级"）★★★
         病根：这里只更新了 level 和 exp ✗ 没更新 need ✓
         而 updExp 里写的是 need = r.need || expNeed(level) ✗
           → 优先用【登录时那份 need】✓ 升级后它不会变 ✓
           → 分母停在"升级前那个较小的值"✗ 经验条显示满了 ✓
           → 但服务器那边还差得远 ✓✓ 一字不差
         修：服务器给了新的就用新的 ✓ 没给就把旧的【删掉】✗
             （删掉之后 updExp 会自动用 expNeed(level) 现算 ✓
               那个公式第 223 轮刚修对 ✓ 和服务器完全一致 ✓）*/
      if (typeof d.me.need === 'number' && d.me.need > 0) {
        WSC.role.need = d.me.need;
      } else {
        delete WSC.role.need;
      }
    }
    UI.role(WSC.role);     // ★ 走 UI.*（core 不碰 DOM —— 分层闸门 check_core_dom 会拦 ✓）
  }
}

/* ============================================================
   原来那批传输函数 —— 名字和签名保持不变，
   这样 frame() / bindInput() / 设置面板那些调用点一行都不用改 ✓
   ============================================================ */


/* netInit 已搬到 platform/web.js */



/* autoLogin 已搬到 platform/web.js */


function netGoOnline() {
  /* ★★ NET.on 必须在这里打开（第 27 轮实测出来的真 bug）★★
     netUpdate() 第一行就是 `if (!NET.on) { return; }` —— 它决定"远端玩家和世界妖兽
     要不要做插值"。原件（web/3d-v4.html 1309 / 1333 行）是在 netInit() 和 autoLogin()
     成功时写 `NET.on = true` 的；重构 core/platform 时那两处搬成了 WSC.token / WSC.on，
     **NET.on 的赋值整个丢了** ✗
     → NET.on 永远是 false → netUpdate 每帧直接 return
     → 别人（和世界妖兽）全都【钉死在创建时那一个位置】，只能看到人、看不到人动 ✗
     现在挂在"真的进了世界"这个事件上：wsWelcome 收到 welcome → 调这里 ✓ 语义更准 ✓ */
  NET.on = true;
  // 世界妖兽归服务器 → 清掉本地那几只（不然会重影）
  if (mobs.length) {
    for (var i = 0; i < mobs.length; i++) {
      var m = mobs[i];
      if (m.g) { scene.remove(m.g); }
      if (m.shadow) { scene.remove(m.shadow); }
      UI.plate.remove(m.ui);
    }
    mobs.length = 0;
  }
  if (_growTimer) { clearInterval(_growTimer); _growTimer = null; }
  netStartLoop();
}

function netGoOffline() {
  NET.on = false;          // ★ 同上：这个也得关，不然断线后还在按联机逻辑插值
  WSC.ready = false;
  WSC.on = false;
  netStopLoop();
  for (var mid in NET.rmobs) { removeWorldMob(mid); }
  clearWorldLoot();
  clearHealFx();                        // ★ 治疗连线也跟着清（第 46 轮）
  for (var uid in NET.others) { removeOther(uid); }
  if (!mobs.length) {
    for (var i = 0; i < G.MOB_COUNT; i++) {
      var ang = i / G.MOB_COUNT * Math.PI * 2;
      spawnMobAt(P.x + Math.cos(ang) * 10, P.z + Math.sin(ang) * 10);
    }
  }
}

function netUploadProps() {
  // 静态碰撞以后由服务端按世界种子自己算（P1）；现在留空函数，调用点不用改
}

function netSendHit(mid, dv, crit) {
  if (!WSC.ready) { return; }
  wsSend('atk', { mid: String(mid) });
}

function netSendPvp(uid, dv, crit) {
  if (!WSC.ready) { return; }
  wsSend('atk', { uid: uid });
}

function netSetPvp(on) {
  if (!WSC.ready) { toast('要联机才能开 PvP'); return; }
  NET.pvp = !!on;
  wsSend('pvp', { on: !!on });
}

function netServerSpawn(n, clear) {
  if (!WSC.ready) { return false; }
  wsSend('spawn', { n: n, clear: !!clear });
  return true;
}


function netClkUpdate(st, localNow, remoteT) {
  if (!st) { st = { off: undefined, late: 0, delay: 0.06, n: 0 }; }
  if (!remoteT) { return st; }
  /* ★★ 重复 / 过期的包不参与时钟校准（P0-9 实测出来的真 bug ★★）
     服务端是按自己的 tick 重发"当前状态"的：对方站着没动时，
     同一份 (x, t) 会被发好多次 —— t 不变，而 localNow 一直在前进，
     于是 raw = localNow - remoteT 越来越大 → late 虚增（实测能到 1 秒）✗
     → 抖动缓冲被顶到 maxDelay 上限、而且来回变 → 画面一顿一冲。
     同一份时间戳只校准一次就够了 ✓ */
  if (st.lastT !== undefined && remoteT <= st.lastT) { return st; }
  st.lastT = remoteT;
  var raw = localNow - remoteT;
  st.n++;
  if (st.off === undefined) {
    st.off = raw; st.late = 0;
  } else if (st.n <= NET.clkWarm) {
    if (raw < st.off) { st.off = raw; }                  // ★ 热身期：取最小延迟当基准（最接近真值 ✓）
  } else {
    if (raw > st.off) { st.off += (raw - st.off) * NET.clkDrift; }   // 之后只跟时钟漂移（极慢 ✓）
    // raw < off → 不管（基准锁住 ✓ 不跳变 ✓ 只是缓冲多留一点 ✓ 安全方向 ✓）
  }
  var late = raw - st.off;                               // 这一包迟到多少
  if (late < 0) { late = 0; }
  /* ★ 迟到量要用【历史最大 + 缓慢回落】✗ 不能用 EMA：
     EMA 会"忘掉"突发的那一包，可缓冲只要被那一包耗干一次 → 就外推 → 就卡一下 ✗
     取最大则保证"最近见过的最坏情况"一定兜得住 ✓ 回落慢 → 不会一好一坏来回抖 ✓ */
  st.late = Math.max(st.late * NET.jitFall, late);
  var d = NET.rate * NET.minMul + st.late * NET.jitGain;
  var want = Math.max(NET.rate * NET.minMul, Math.min(NET.maxDelay, d));
  /* ★★ delay 的变化要【不对称】（P0-9 实测出来的）★★
     渲染时刻 = 本地钟 − off − delay。delay 一变，渲染时刻就跳一下 → 位置跳一下 → 速度尖峰。
     实测：固定 delay 的模式抖动 1.1%，自适应却到 14~30% —— 差的就是这里。

       要变大 → 立刻加（安全方向：多缓一点只是多等十几毫秒，画面不会跳）
       要变小 → 慢慢收（一次性收回去会让渲染时刻往回跳 → 那才是看得见的"一顿"）
     delayFall 取 0.02：约 50 帧（0.8 秒）收一半，够快又不刺眼 ✓ */
  if (!st.delay) {
    st.delay = want;
  } else if (want > st.delay) {
    st.delay = want;
  } else {
    st.delay += (want - st.delay) * (NET.delayFall || 0.02);
  }
  return st;
}

/* ★ 位置缓冲：把收到的包按【对方的钟】排队 ✓ 渲染"延迟一点点"的过去某一刻 ✓ → 匀速平滑 ✓
   丢包时短距离外推 ✓ 不僵住 ✓ */
function netPush(buf, x, z, yaw, t) {
  var last = buf.length ? buf[buf.length - 1] : null;
  if (last && t <= last.t) {
    /* ★ 乱序 / 重复包（同一个 ct）→ 直接替换最后一条 ✓
       TCP 上正常不会乱序（我们又是一发一等 ✓），但万一发生：
       往缓冲尾部塞一个"时间更早"的点会破坏"时间递增"的假设 →
       netSample 取到的区间就错了 → 画面一顿一跳 ✗ 所以这里必须挡住 ✓ */
    last.x = x; last.z = z; last.yaw = yaw;
    return;
  }
  var tt = t;
  if (last) {
    var gap = t - last.t;
    if (gap > 0.45) {
      /* 中间断了很久（他刚才站着没动 → 我们就不发包 ✓）
         直接拿"断开前那一包 → 现在这一包"去插值，位移会全挤在一帧里 → 看着一跳 ✗
         所以补一个"保持包"：让他先在原地多站一会儿，再平滑走到新位置 ✓ */
      buf.push({ t: t - 0.10, x: last.x, z: last.z, yaw: last.yaw });
      last = buf[buf.length - 1];
      gap = t - last.t;
    }
    /* ★ 兜底：间隔收进一个很宽的带 [0.4×rate, 6×rate]
       —— 别收窄！服务端是按自己的 30Hz tick 采样后转发的，
          客户端 30Hz 上报和它"打架"时，接收端看到的间隔会变成 40~70ms（正常现象）。
          以前这里夹到 [0.7×, 1.4×]rate（23~47ms）→ 把正常间隔也夹了 →
          时间轴被压缩 → 位移偏快、抖动大（P0-9 实测出来的 ✓ 已放宽） */
    var g2 = Math.min(NET.rate * 6.0, Math.max(NET.rate * 0.4, gap));
    tt = Math.min(t, last.t + g2);
  }
  buf.push({ t: tt, x: x, z: z, yaw: yaw });
  if (buf.length > NET.bufMax) { buf.shift(); }
}
function netSample(buf, t, out) {
  var n = buf.length;
  if (!n) { return false; }
  if (n === 1) { out.x = buf[0].x; out.z = buf[0].z; out.yaw = buf[0].yaw;
    out.jy = +buf[0].jy || 0; return true; }
  while (buf.length > 2 && buf[1].t <= t) { buf.shift(); }
  var a = buf[0], b = buf[1];
  if (t <= a.t) { out.x = a.x; out.z = a.z; out.yaw = a.yaw;
    out.jy = +a.jy || 0; return true; }
  var seg = b.t - a.t;
  if (seg <= 0.0001) { out.x = b.x; out.z = b.z; out.yaw = b.yaw;
    out.jy = +b.jy || 0; return true; }
  var u = (t - a.t) / seg;
  if (u > 1) {
    /* ★★ 越界外推（P0-9 实测出来的真问题）★★
       原来硬夹在 4 段：`if (u>1) u = Math.min(u,4)`。
       但服务端 30Hz 采样 + 客户端 30Hz 上报会"打架"，键间隔实测能到 67ms，
       渲染时刻很容易越过缓冲尾 → u 被夹死 → 【位置不再前进】→ 那一帧速度=0。
       实测 13% 的帧处于这种状态，正好对应速度均值偏低 11%、抖动 40% ✗

       匀速运动下正常外推本来就是精确的（末段速度就是真速度）——
       夹死反而制造出"一顿一冲"。
       所以改成：允许外推，但用【总外推距离】设安全上限（真丢包时不飞出去）。
       12 段 ≈ 12×33ms ≈ 0.4 秒 ≈ 1.2 米（3m/s），够兜住采样抖动，又不至于瞬移 ✓ */
    /* round284 structural guard: cap by TIME, not only by segment count.
       With a broken clock u could reach ~90000 -> clamped to 12 -> the drawn
       position sat 12 packets ahead and every jitter got multiplied by 12.
       With a time cap the worst case is a short freeze, never 12x speed. */
    var uMaxT = 0.15 / (seg > 0 ? seg : 0.033);
    var uMax = Math.min(NET.extrapMax || 12, uMaxT);
    if (u > uMax) { u = uMax; }
  }
  out.x = a.x + (b.x - a.x) * u;
  out.z = a.z + (b.z - a.z) * u;
  var dy = b.yaw - a.yaw;
  while (dy > Math.PI) { dy -= Math.PI * 2; }
  while (dy < -Math.PI) { dy += Math.PI * 2; }
  out.yaw = a.yaw + dy * u;
  /* ★ round331：离地高度也要【插值】带出来
     ★ 自测踩到：只改了渲染那行 ✗ 没改这里 → w.jy 永远是 undefined
       → 别人的跳跃怎么看都看不见 ✓（用户："开始看不到跳动"）*/
  var _ajy = +a.jy || 0, _bjy = +b.jy || 0;
  out.jy = _ajy + (_bjy - _ajy) * u;
  return true;
}

/* ★★ 发包独立于渲染帧（自校正定时器）★★
   原来在 frame() 里发 → 帧一慢/一掉，发包间隔就跟着乱 ✗（渲染和网络不该互相拖累）
   现在固定 33ms 发一次 ✓ 每次都按"本该发的时刻"校正 → 长跑不漂 ✓
   附带好处：切到后台时 rAF 停了，但定时器还在 → 别人看你不会卡住不动 ✓ */
function netStartLoop() {
  if (_netTimer) { return; }                      // ★ 用真值判断（undefined 也当"没起"✓ 不会误 return ✗）
  _netNext = performance.now() + NET.rate * 1000;
  var step = function () {
    netSync();
    _netNext += NET.rate * 1000;
    var nowP = performance.now();
    if (_netNext < nowP - 150) { _netNext = nowP + NET.rate * 1000; }   // ★ 落后太多就重置（别追命 ✓）
    _netTimer = setTimeout(step, Math.max(1, _netNext - nowP));
  };
  _netTimer = setTimeout(step, NET.rate * 1000);
}
function netStopLoop() {
  if (_netTimer) { clearTimeout(_netTimer); }     // ★ 同样用真值判断 ✓
  _netTimer = null;
}

/* ★★ 一次请求干两件事：上报我的状态 + 拿回附近的一切 ★★
   （原来 位置上报 / 拉取 是两次请求 → 30Hz 就是 60 次/秒 ✗
     合并成一次 → 请求数减半、往返少一半 → 延迟更低、抖动更小 ✓）*/
/* ★ 30Hz：只往上"发"自己的状态。
   快照是服务端推下来的（wsApplyWorld），不再需要一问一答 ✓ */
function netSync() {
  if (!WSC.ready) { return; }
  /* ★ 坐着 / 正在坐下：不要再发 move，否则服务端会以为我要走开 → 自动起身 */
  if (MY_SEAT || SIT_PENDING || MY_SLEEP) { return; }
  var now = performance.now() / 1000;
  wsSend('move', {
    x: +P.x.toFixed(2),
    z: +P.z.toFixed(2),
    yaw: +P.yaw.toFixed(3),
    /* ★ round330（用户："看不到其他玩家的跳跃动作"）
       jy = 离地高度（跳起来 / 掉下去的那一段）✗ 别人的客户端拿它来还原动作 ✓
       ★ 为什么发"离地高度"而不是绝对高度：
         绝对高度每帧都在变（走上下坡）✗ 还要处理地形不一致 ✓
         离地高度是 0 或一个周期内的弧 ✗ 语义干净 ✓ */
    /* ★★ round333（用户点出来的）：跳跃是纯客户端动画 ✗
       本地抬升 = 物理高度 + 视觉加高(_vb ≈ ×0.9) = 1.9 倍 ✓
       所以发出去的必须是【最终视觉偏移】✗ 不是纯物理高度 ✓
       不然别人看到的跳跃只有本地的一半高 ✓ */
    jy: +(((P.y - (P.gy || 0)) * ((P.jumping && P.air) ? 1.9 : 1))).toFixed(3),
    /* round286: 加上跨刷新不变的基准 ✗
       不再用纯的 performance.now()（刷新归零 ✗ 会毒化别人 ✓）*/
    t: +(NET_TIME_BASE + now).toFixed(3),
    hp: Math.max(0, Math.round(HP)),
    atk: NET.atkSeq
  });
  if (now - WSC.lastPing > 1.0) {   // 每秒 ping 一次，界面上能看到延迟
    WSC.lastPing = now;
    wsSend('ping', { t: now });
  }
}


/* 创建一个"其他玩家"的小人 ✓ */
function addOther(w, t) {
  var o = NET.others[w.uid];
  /* ★★★ 第 283 轮修的真 bug（用户："别的玩家像飞一样，刷新就对调"）★★★
     根因（只读审查查出来的 ✗ 带行号 ✓）：
       ① 客户端上报的 t = performance.now()/1000 = 【页面加载起的秒数】✗ 刷新归零 ✓
       ② 被观察者一刷新 ✗ 他的 t 从几千秒掉回 1 秒 ✓
       ③ 下面 netClkUpdate 里有守卫：if (remoteT <= st.lastT) return st;  ← 当成重复包 ✗
          → 该实体的时钟偏移【永久停在旧值】✗ 再也修不回来 ✓
       ④ → 渲染时刻比缓冲里的时间键差【几千秒】✗
       ⑤ → 插值取不到数据 ✗ 被顶到【外推上限 12 段】✓
          → 位置 = 次新样本 + 12 × 单包位移 ✗ 抖动放大 12 倍 ✓✓
          → 别人一跳一窜 ✗ 停下还往回弹 ✓ = "飞快、一下窜很远"✓
       ⑥ ★ 谁按 F5 ✗ 谁的 ct 归零 ✗ 毒化别人的客户端 ✓
          → 他变成"被别人看成飞快"的那一个 ✓✓ 和用户说的"刷新就对调"一字不差 ✓
     ★ 修法（审查报告的 §1.8a ✗ 最小改法）：
       发现这个玩家的时间戳【大幅倒退】（超过 5 秒 = 他换过一次会话 ✓）
       → 把实体【销毁重建】✗
         这样 clk / buf / rtS / rtLast 全部归零 ✓
         ★ 等于走"刷新页面恢复"的【同一条路】✗ 最不容易漏东西 ✓
       （为什么不用"只重置时钟"✗ 第 282 轮我就是那么做的 ✗
         结果 buf 里还钉着旧的大时间键 ✗ 从"飞快"变成"卡住一跳一跳"✗ 所以被回退了 ✓）
     ★ 为什么阈值是 5 秒：正常乱序/重复包最多差几十毫秒 ✗
       只有"页面重新加载"才会一次倒退几秒以上 ✓ */
  /* ★ round485：他换皮肤了 → 拆了重建（和"时间戳倒退"同一个套路 ✓ 最不容易漏东西）*/
  if (o && o.sk !== undefined && o.sk !== (w.sk || '') ) {
    removeOther(w.uid);
    o = null;
  }
  /* ★ round510：他换了自定义也一样要重建（染色/眼型变了 ✓）*/
  var _skc = (w.skc && typeof w.skc === 'object') ? JSON.stringify(w.skc) : '';
  if (o && _skc !== (o.skcKey || '')) {
    removeOther(w.uid);
    o = null;
  }
  var _ct = (typeof w.ct === 'number') ? w.ct : null;
  if (o && o.clk && typeof o.clk.lastT === 'number' && _ct !== null &&
            Math.abs(o.clk.lastT - _ct) > 5.0) {   /* round284: two-way (a future clock may jump forward too) */
    console.log('[sync] ' + (w.name || w.uid) + ' 的时间戳大幅倒退（'
                + o.clk.lastT.toFixed(1) + ' → ' + _ct.toFixed(1)
                + '）→ 判定他重连/刷新过 ✗ 重建这个玩家 ✓');
    removeOther(w.uid);
    o = null;
  }
  if (!o) {
    var hh = hero(w.sk || null, w.skc || null);   // ★ round510：带他的自定义 ✓
    // ★ 第 65 轮：拿【他】的武器，不是我的 ✗
    // ★ 踩过的坑：这里必须读【映射后】的 wlook/wtier ✗
    //   写成 w.w / w.wt（那是快照的原始字段名）→ 永远 undefined
    //   → 兜底成 'sword' → 所有队友都被画成一把普通单手剑 + 用"扫"的动作 ✗
    fillHeldWeapon(hh.sw, w.wlook || 'sword',
                   (typeof w.wtier === 'number') ? w.wtier : 0, hh.swL);
    var _osz = (typeof w.sz === 'number' && w.sz > 0) ? w.sz : 1;
    hh.g.scale.set(heroScaleOf(_osz), heroScaleOf(_osz), heroScaleOf(_osz));
    /* ★ round331：刚出现时就站在地形上（不然第一帧会陷进山里 ✓）*/
    var _oy0 = (typeof terYAt === 'function') ? terYAt(w.x, w.z) : 0;
    var _ojy0 = +w.jy || 0;
    if (_ojy0 < 0) { _ojy0 = 0; }
    hh.g.position.set(w.x, _oy0 + _ojy0, w.z);
    scene.add(hh.g);
    var ui = mkMobUI((w.name || '道友') + ' ' + (w.realm || ''), 100);
    o = NET.others[w.uid] = {
      hh: hh, ui: ui, name: w.name, realm: w.realm,
      buf: [], cur: { x: w.x, z: w.z, yaw: w.yaw || 0 },
      walkT: 0, last: { x: w.x, z: w.z },
      atkT: -1, atkSeq: -1, clk: undefined,
      hp: (typeof w.hp === 'number') ? w.hp : 100,
      hpMax: (typeof w.hpm === 'number' && w.hpm > 0) ? w.hpm : 100,
      sz: _osz,                               // ★ round576：坦克引擎体型
      galeT: +w.galeT || 0,                    // ★ round589：别人疾风步剩余
      downT: +w.downT || 0,                    // ★ round593：击倒剩余
      _galeAcc: 0, _galeLX: null, _galeLZ: null,
      seat: (w.seat != null ? String(w.seat) : '-1'),   // ★ 他坐哪张椅子
      sleep: !!w.sleep,                                   // ★ 他躺下了没有
      snapYaw: (typeof w.syaw === 'number') ? w.syaw : 0,
      dead: !!w.dead,                         // ★ 第 57 轮：他倒下了没有
      tt: String(w.tt || ''),                 // ★ round424：头顶称号文本
      tm: (+w.tm || 0),                       // ★ round424：1/2/3 = 金/银/铜牌
      sk: (typeof w.sk === 'string') ? w.sk : '',  // ★ round485：他的皮肤
      skc: (w.skc && typeof w.skc === 'object') ? w.skc : null,   // ★ round510：他的自定义
      skcKey: _skc
    };
    o.clk = netClkUpdate(o.clk, t, w.ct);          // ★ 对齐他的钟 + 量他的抖动
    /* round284: NEVER fall back to our own clock. A reconnecting player
       reports ct=0 for the first snapshots; using (t - off) pushed OUR clock
       into his buffer, which froze him in place for ~242s (reviewer measured it).
       When ct is missing: clear the buffer, snap to the snapshot position, and
       wait for his real ct before interpolating again. */
    if (!(w.ct > 0)) {
      o.buf.length = 0;
      o.rtS = null;
      o.rtLast = undefined;
      /* ★ round330：站在地形上 ✗ 不是 y=0（原来直接穿过山坡 ✓）*/
      if (o.g) {
        var _oy = (typeof terYAt === 'function') ? terYAt(w.x, w.z) : 0;
        var _ojy = +w.jy || 0;
        if (_ojy < 0) { _ojy = 0; }
        o.g.position.set(w.x, _oy + _ojy, w.z);
      }
      o.cur = { x: w.x, z: w.z, yaw: w.yaw || 0 };
      o.last = { x: w.x, z: w.z };
    } else {
      netPush(o.buf, w.x, w.z, w.yaw || 0, w.ct);
    o.tgtJy = Math.max(0, +w.jy || 0);   // ★ 跳跃偏移目标 ✓
      o.tgtJy = Math.max(0, +w.jy || 0);   // ★ 跳跃偏移目标 ✓
    }
    return o;
  }
  o.name = w.name; o.realm = w.realm;
  /* ★ round576：坦克引擎体型变了 → 重新缩放他的模型（不用重建 ✓）*/
  var _osz2 = (typeof w.sz === 'number' && w.sz > 0) ? w.sz : 1;
  if (Math.abs((o.sz || 1) - _osz2) > 0.0005) {
    o.sz = _osz2;
    if (o.hh && o.hh.g) {
      o.hh.g.scale.set(heroScaleOf(_osz2), heroScaleOf(_osz2), heroScaleOf(_osz2));
    }
  }
  o.clk = netClkUpdate(o.clk, t, w.ct);            // ★ 每包都校准一次（取最小延迟 ✓）
  // ★ 他的血量（他自己报上来 ✓ 用来画头顶绿血条 ✓）
  if (typeof w.hp === 'number') { o.hp = w.hp; }
  if (typeof w.hpm === 'number' && w.hpm > 0) { o.hpMax = w.hpm; }
  /* ★ 第 57 轮踩的坑：这个字段只在【创建时】带了 ✗
     已经存在的小人走的是下面这条更新分支 → dead 永远停在 false ✗
     所以两处都要写 ✓（不然"别人看你死亡还是站着"永远修不好 ✗）*/
  o.dead = !!w.dead;
  o.seat = (w.seat != null ? String(w.seat) : '-1');
  o.sleep = !!w.sleep;
  o.snapYaw = (typeof w.syaw === 'number') ? w.syaw : (o.snapYaw || 0);
  o.galeT = +w.galeT || 0;
  o.downT = +w.downT || 0;
  o.frz = !!w.frz;
  if (o.ui) {
    UI.plate.tag(o.ui, o.frz ? '❄ 冰冻' : (o.downT > 0 ? '击倒' : ''),
                 o.frz ? '#9fe8ff' : '#ffb35a');
    try {
      if (o.frz && !o._iceFx) {
        o._iceFx = UI.fxIce(o.hh.g);
      } else if (!o.frz && o._iceFx) {
        UI.fxIceStop(o._iceFx); o._iceFx = null;
      }
    } catch (eIce) { }
  }
  o.inv = +w.inv || 0;       // ★ 第 63 轮：无敌剩余（每包都更新 ✓）
  o.mate = !!w.mate;         // ★ 第 90 轮：队友标记（每包更新 ✓）
  /* ★★ 第 86 轮（用户要求）：队友名字前面加一个【蓝色五角星】★★
     ★ 走 UI.plate.name ✓ 不在 core 里碰 .style ✗（分层铁律 ✓）
     ★ 每包都刷 ✓ 所以组队/退队/踢人之后名字会立刻跟着变 ✓ */
  if (o.ui) {
    var _mate2 = isPartyMate(w.uid);
    /* ★★ 第 152 轮（用户要求）：有魔气就在名字前面显示【恶魔图标 + 数字】★★
       红色 ✓ 魔气越高颜色越深 ✓ 魔气 0 → 整个标记消失 ✓ */
    o.mq = +w.mq || 0;          // ★ 魔气单独一行显示 ✓ 不再拼进名字 ✗
    UI.plate.name(o.ui,
      (_mate2 ? '★ ' : '') + (w.name || '道友') + ' ' + (w.realm || ''),
      _mate2 ? '#5aa8ff' : '#fff');
    /* ★★ round424（用户："其它玩家和自己都可以看见"）★★
       称号在名牌最上面 ✗ 魔气在它下面 ✓（两个不互相覆盖 ✓）*/
    UI.plate.title(o.ui, o.tt || '', o.tm || 0);
  }
  /* ★ 第 65 轮：他换武器了 → 手里那把也要换 ✓（不然永远是刚看到他时的武器 ✗）*/
  var _wl = w.wlook || 'sword', _wt = (typeof w.wtier === 'number') ? w.wtier : 0;
  if (_wl !== o.wlook || _wt !== o.wtier) {
    o.wlook = _wl; o.wtier = _wt;
    fillHeldWeapon(o.hh.sw, _wl, _wt);
  }
  // ★ 他的挥剑序号变了 → 我这边从头播一遍挥剑动画 ✓（动作和你自己看到的一致 ✓）
  var wk = (typeof w.atk === 'number') ? w.atk : 0;
  if (wk !== o.atkSeq) {
    if (o.atkSeq >= 0 && wk > o.atkSeq) {
      o.atkT = 0;
      /* ★ round428：他挥了 → 给他也起一条拖影 ✓（品阶色用他自己的✓）*/
      try {
        var _oid = w.uid;
        o._tid = _oid;
        trailStart(_oid, weaponTipLen(_wl || 'sword'), _wt || 0);
      } catch (e1) { }
    }
    o.atkSeq = wk;
  }
  var lp = o.buf.length ? o.buf[o.buf.length - 1] : null;
  /* round284: NEVER fall back to our own clock. A reconnecting player
     reports ct=0 for the first snapshots; using (t - off) pushed OUR clock
     into his buffer, which froze him in place for ~242s (reviewer measured it).
     When ct is missing: clear the buffer, snap to the snapshot position, and
     wait for his real ct before interpolating again. */
  if (!(w.ct > 0)) {
    o.buf.length = 0;
    o.rtS = null;
    o.rtLast = undefined;
    if (o.g) {
      var _oy2 = (typeof terYAt === 'function') ? terYAt(w.x, w.z) : 0;
      var _ojy2 = +w.jy || 0;
      if (_ojy2 < 0) { _ojy2 = 0; }
      o.g.position.set(w.x, _oy2 + _ojy2, w.z);
    }
    o.cur = { x: w.x, z: w.z, yaw: w.yaw || 0 };
    o.last = { x: w.x, z: w.z };
  } else {
    netPush(o.buf, w.x, w.z, w.yaw || 0, w.ct);
    o.tgtJy = Math.max(0, +w.jy || 0);   // ★ 跳跃偏移目标 ✓
  }
  var moved = !lp || Math.abs(lp.x - w.x) > 0.002 || Math.abs(lp.z - w.z) > 0.002 ||
              Math.abs(lp.yaw - (w.yaw || 0)) > 0.002;
  /* ★★ 人没动也要把"我还在这儿"记进缓冲（P0-9 第 26 轮实测出来的真 bug ★★）
     原来这里是：位置没变就【完全跳过】netPush（还写着"静止时也不会乱外推"）。
     但那是反的 ✗ 缓冲尾停在他最后一步的位置、时间不再前进，
     而渲染时刻 = 本地钟 − 钟差 − 缓冲 一直在前进 → 必然越过缓冲尾
     → netSample 就按【末段速度】外推，一路推到 extrapMax=12 段的上限
     → 实测：队友站住后会被画在真实位置【前方 1100mm】处，而且一直停在那儿，
        等他再动一下才"啪"地弹回来 ✗（tools\diag_standstill.js 离线复现）
     修法：位置没变也照样塞一个【保持包】（位置不变、时间前进），
           缓冲尾跟着他的钟一起前进 → 渲染时刻永远在缓冲里 → 不做无谓外推 ✓
           （外推只留给真正的丢包 ✓）为了省内存，静止时按半速塞就够了 ✓ */
  /* round285: this used a bare `ct` which is NOT declared in this scope.
     The checker (tools/check_free_vars.js) flagged it; at runtime it throws a
     ReferenceError, so the whole "hold packet" branch below never ran - the
     buffer tail stops advancing while the player stands still, and netSample
     extrapolates up to 12 segments ahead (the old "drawn 1.1m in front" bug).
     Use w.ct, exactly like the rest of this file. */
  var _ct2 = (typeof w.ct === 'number' && w.ct > 0) ? w.ct : 0;
  if (_ct2 > 0 && (moved || !lp || _ct2 > lp.t + NET.rate * 0.5)) {
    netPush(o.buf, w.x, w.z, w.yaw || 0, _ct2);          // ★ 用他的钟排队 ✓
    o.tgtJy = Math.max(0, +w.jy || 0);   // ★ 跳跃偏移目标 ✓
  }
  return o;
}

function removeOther(uid) {
  var o = NET.others[uid];
  // ★ 第 63 轮：他走了，脚下的无敌环也要一起收 ✓（不然会留在原地 ✗）
  if (o && o.ring) {
    scene.remove(o.ring);
    o.ring.geometry.dispose(); o.ring.material.dispose();
  }
  if (!o) { return; }
  scene.remove(o.hh.g);
  UI.plate.remove(o.ui);
  delete NET.others[uid];
}

/* ★ 世界妖兽（公共的 ✓ 服务器权威 ✓ 本地不跑 AI、不判伤害 ✓ 只负责显示 + 发攻击请求）
   服务器给的格式：[mid, x, z, yaw, hp, hpMax, alive, atkT] */
function addWorldMob(arr, t) {
  if (!arr || arr.length < 6) { return null; }
  var mid = String(arr[0]);
  var x = +arr[1], z = +arr[2], yaw = +(arr[3] || 0);
  var hp = +(arr[4] || 0), hpm = +(arr[5] || 30) || 30;
  var alive = (arr.length > 6) ? (arr[6] ? true : false) : true;
  var atkT = (arr.length > 7) ? +arr[7] : -1;
  /* ★ 第 36 轮往后加的两个字段（用户要"僵尸等级显示出来"）——
     数组是按下标取的，所以只能往后追加，不能插中间 ✗ */
  var mlv = (arr.length > 8) ? (Math.round(+arr[8]) || 0) : 0;
  var mkind = (arr.length > 9) ? String(arr[9] || '') : '';
  var mfrz = (arr.length > 10) ? !!arr[10] : false;   // ★ round585：冻结状态
  var mrank = (arr.length > 11) ? (Math.round(+arr[11]) || 0) : 0;  // round600
  var mskin = (arr.length > 12) ? String(arr[12] || '') : '';        // round600
  var mnameWire = (arr.length > 13) ? String(arr[13] || '') : '';    // round601：服务端权威名字
  if (mrank && !mskin) { mskin = (RANK_SKINS[mrank] || RANK_SKINS[1])[0]; }
  if (!mid || !isFinite(x) || !isFinite(z)) { return null; }
  var rm = NET.rmobs[mid];
  if (!rm) {
    var mcls = mobClassOf(mkind);                    // ★ 职业外观（第 39 轮，方案 §3.3.1）
    var m = mob(mkind, mrank, mskin);                // ★ round600：精英/Boss 外观
    var _rankScal = mrank >= 2 ? 1.85 : (mrank === 1 ? 1.22 : 1.0);
    m.g.scale.setScalar(mobScaleAt(mlv) * ((mcls && mcls.scale) || 1) * _rankScal);
    /* ★ round306：新出现的僵尸也要站在地形上（原来永远 y=0 ✗ 会陷进山里 ✓）*/
    m.g.position.set(x, terYAt(x, z), z);
    m.g.rotation.y = yaw;
    scene.add(m.g);
    var sh = new THREE.Mesh(new THREE.CircleGeometry(0.54 * _rankScal, 14),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.24, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2;
    sh.position.set(x, terYAt(x, z) + 0.02, z);
    sh.scale.setScalar(mobScaleAt(mlv) * _rankScal / G.MOB_SCALE);   // ★ 影子跟着体型一起放大 ✓
    scene.add(sh);
    var _mname = mrank ? (mnameWire || MOB_RANK_NAMES[mskin] || (mrank >= 2 ? '首领' : '精英')) : '僵尸';
    rm = NET.rmobs[mid] = {
      mid: mid, g: m.g, hh: m, shadow: sh, ui: mkMobUI(_mname, hpm, 0.8),
      hp: hp, hpMax: hpm, alive: alive, atkT: atkT, dying: -1, dead: 0, walkT: 0,
      lv: mlv, kind: mkind, sk: mobScaleAt(mlv) * _rankScal / G.MOB_SCALE,
      rank: mrank, skin: mskin, name: _mname,
      hitR: mrank >= 2 ? 0.9 : (mrank === 1 ? 0.35 : 0),
      frz: mfrz,
      last: { x: x, z: z }, buf: [], cur: { x: x, z: z, yaw: yaw }
    };
    UI.plate.tag(rm.ui, mfrz ? '❄ 冰冻' : (mrank >= 2 ? '[BOSS]' : (mrank ? '[精英]' : '')),
                 mfrz ? '#9fe8ff' : (mrank >= 2 ? '#ff6a5c' : '#ffb35a'));
    try { if (mfrz && !rm._iceFx) { rm._iceFx = UI.fxIce(rm.g); } } catch (eI0) { }
    netPush(rm.buf, x, z, yaw, t);
    return mid;
  }
  rm.hp = hp; rm.hpMax = hpm;
  rm.rank = mrank || rm.rank || 0;
  rm.skin = mskin || rm.skin || '';
  rm.frz = mfrz;
  if (rm.ui) {
    UI.plate.tag(rm.ui, mfrz ? '❄ 冰冻' : (rm.rank >= 2 ? '[BOSS]' : (rm.rank ? '[精英]' : '')),
                 mfrz ? '#9fe8ff' : (rm.rank >= 2 ? '#ff6a5c' : '#ffb35a'));
  }
  try {
    if (mfrz && !rm._iceFx) { rm._iceFx = UI.fxIce(rm.g); }
    else if (!mfrz && rm._iceFx) { UI.fxIceStop(rm._iceFx); rm._iceFx = null; }
  } catch (eI1) { }
  rm.lv = mlv || rm.lv; rm.kind = mkind || rm.kind;   // ★ 等级/职业（服务器给的）
  // ★ 服务器说它死了 → 我这边开始播倒地动画 ✓（只播一次 ✓）
  if (rm.alive && !alive) { rm.alive = false; rm.dying = 0; rm.dead = 0; rm.atkT = -1; }
  else if (alive && !rm.alive) { rm.alive = true; rm.dying = -1; rm.dead = 0; }
  rm.atkT = alive ? atkT : -1;
  var lp = rm.buf.length ? rm.buf[rm.buf.length - 1] : null;
  if (!lp || Math.abs(lp.x - x) > 0.002 || Math.abs(lp.z - z) > 0.002 || Math.abs(lp.yaw - yaw) > 0.002) {
    netPush(rm.buf, x, z, yaw, t);
  }
  return mid;
}

function removeWorldMob(mid) {
  /* ★ round348：这只僵尸没了（被打死/走远）→ 掐掉它的逃跑音效 ✓ */
  if (typeof sfxStop === 'function') { sfxStop('flee_' + mid); }
  var rm = NET.rmobs[mid];
  if (!rm) { return; }
  /* ★★ round436：删怪必须释放实例槽 ✗
     不释放 → 它那 4 条肢体永远留在死的地方（残肢 ✗）
     实测：召唤 60 只 → 132 个残肢；反复增删 → 772 个 ✗✗ */
  try { limbFree(rm); } catch (e0) { }
  scene.remove(rm.g);
  if (rm.shadow) { scene.remove(rm.shadow); }
  UI.plate.remove(rm.ui);
  delete NET.rmobs[mid];
}

/* ============ 地上掉的（第 38 轮，P2 第二刀）============
   服务器给的格式：[id, x, z, name, tier]
   ★ 颜色按品阶分（方案 §6.3 那套 12 阶的配色思路）→ 玩家瞟一眼就知道值不值得绕路 ✓ */
var LOOT_COL = [0xbfa88a, 0x8fd28a, 0x8fc4ff, 0xc08fff, 0xffd83d, 0xff9a5c,
                0xff6a5c, 0xff5cf0, 0x5cf0ff, 0xffffff, 0xe0b830, 0xff3b30];
var LOOT_PICK_R = 2.0;      // ★ 必须和服务器 drops.PICK_RANGE 一致 ✓
var _lootT = 0;

/* ============ 治疗连线（第 46 轮）============
   用户反馈："僵尸医生的治疗效果看起来没有关联性，要让玩家明显看出来它给谁治疗了多少血"
   → 两件事一起做才看得懂：
       ① 从医生到被治僵尸拉一条【绿色连线】→ 一眼看出【谁治了谁】✓
       ② 被治僵尸头顶弹一个【绿色 +N】   → 一眼看出【回了多少血】✓
   ★ 连线就是一根细长方块（和游戏里别的东西一套做法 ✓ 不加素材）
   ★ 淡出【不能改材质透明度】✗ —— 材质是共享的，改了会全场一起淡 ✗（第 44 轮踩过）
     → 改成把【粗细缩到 0】✓ 纯几何变换，不碰材质 ✓ */
var HEAL_FX_T = 0.5;
var _beamGeo = null, _beamMat = null, _healBeams = [];
function beamGeo() {
  if (!_beamGeo) { _beamGeo = new THREE.BoxGeometry(0.07, 0.07, 1); }
  return _beamGeo;
}
function beamMat() {
  if (!_beamMat) {
    _beamMat = new THREE.MeshBasicMaterial({ color: 0x7ee08a, transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false });
  }
  return _beamMat;
}
function addHealBeam(x1, z1, x2, z2) {
  var dx = x2 - x1, dz = z2 - z1;
  var len = Math.sqrt(dx * dx + dz * dz);
  if (len < 0.02 || _healBeams.length > 24) { return; }   // 上限：别一次刷太多 ✓
  var g = new THREE.Mesh(beamGeo(), beamMat());
  g.position.set((x1 + x2) / 2, 1.55, (z1 + z2) / 2);
  g.rotation.y = Math.atan2(dx, dz);      // 和游戏的朝向约定一致（0 = +z ✓）
  g.scale.z = len;
  scene.add(g);
  _healBeams.push({ g: g, t: HEAL_FX_T });
}
function updateHealFx(dt) {
  for (var i = _healBeams.length - 1; i >= 0; i--) {
    var b = _healBeams[i];
    b.t -= dt;
    if (b.t <= 0) { scene.remove(b.g); _healBeams.splice(i, 1); continue; }
    var k = b.t / HEAL_FX_T;                       // 1 → 0
    b.g.scale.x = b.g.scale.y = 0.25 + k * 0.75;   // ★ 粗细缩到 0（不碰材质 ✓）
  }
}
function clearHealFx() {
  for (var i = 0; i < _healBeams.length; i++) { scene.remove(_healBeams[i].g); }
  _healBeams.length = 0;
}

/* ============ ★ 发光（第 45 轮，方案 §7.10「方案 A」）============
   一个半透明外壳会看着像玻璃块 ✗ —— 要"在发光"得三条一起：
     ① 材质自己 emissive（自发光）
     ② 沿【模型形状】溢出的轮廓壳：加法混合 + 只渲染背面 + 放大一圈 ✓
     ③ 一盏点光源 → 脚下地面真的被照亮 ✓
   ★ 成本（第 44 轮实测）：
       自发光    几乎免费（+2%）
       轮廓壳    每件 +1 次 draw call（要合并成一块 ✓ 别一个方块一个壳 ✗）
       点光源    40 盏 = 4 倍开销 ✗ / 2 盏 = 1.2 倍 ✓ → 【固定 2 盏，封顶】
   ★ 灯必须在【启动时】建好 —— 后加灯会让 three.js 重编译所有受光材质的着色器 → 卡一下 ✗
     所以下面这 2 盏灯一直存在，只改位置和强度（强度 0 = 不亮 ✓）*/
var GLOW_LIGHTS = [];
var GLOW_LIGHT_N = 2;
function initGlowLights() {
  for (var i = 0; i < GLOW_LIGHT_N; i++) {
    var pl = new THREE.PointLight(0xffffff, 0, 7.0);
    pl.position.set(0, -100, 0);        // 先藏到地下 ✓
    scene.add(pl);
    GLOW_LIGHTS.push(pl);
  }
}

/* 品阶 → 光色/强度（方案 §7.10：0-3 不发光、4-6 微光、7-9 微光+轮廓、10-11 强光 ✓）*/
var GLOW_TIER = [
  null, null, null,                                        // 0-2 阶：不发光
  { c: 0x9fd8ff, i: 0.30, o: 0.20, shell: true },          // 3-5：蓝
  { c: 0x9fd8ff, i: 0.30, o: 0.20, shell: true },
  { c: 0x9fd8ff, i: 0.30, o: 0.20, shell: true },
  { c: 0xbfe8ff, i: 0.50, o: 0.30, shell: true },          // 6-8：亮蓝
  { c: 0xbfe8ff, i: 0.50, o: 0.30, shell: true },
  { c: 0xbfe8ff, i: 0.50, o: 0.30, shell: true },
  { c: 0xffb020, i: 0.80, o: 0.42, shell: true },          // 9-10：深金
  { c: 0xffb020, i: 0.80, o: 0.42, shell: true },
  { c: 0xff3b30, i: 1.00, o: 0.45, shell: true }           // 11：最高阶红
];

var _glowShellMat = {};                 // 轮廓壳材质按品阶缓存（就 3 种 ✓）
function glowShellMat(tier) {
  var hit = _glowShellMat[tier];
  if (!hit) {
    var g = GLOW_TIER[tier];
    hit = new THREE.MeshBasicMaterial({
      color: g.c, transparent: true, opacity: g.o,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide
    });
    _glowShellMat[tier] = hit;
  }
  return hit;
}

var _lootMat = {};                      // 掉落物材质按品阶缓存（共享 ✓ 不再每件 new ✗）
function lootMat(tier) {
  var hit = _lootMat[tier];
  if (!hit) {
    var col = LOOT_COL[tier] || 0xffffff;
    var g = GLOW_TIER[tier];
    hit = new THREE.MeshLambertMaterial({ color: col, emissive: col,
      emissiveIntensity: g ? 0.85 : 0.5 });
    _lootMat[tier] = hit;
  }
  return hit;
}

var _lootGeo = null, _lootShellGeo = null, _lootArmorGeo = null;
function lootGeo() {
  if (!_lootGeo) { _lootGeo = new THREE.BoxGeometry(0.30, 0.30, 0.30); }
  return _lootGeo;
}
/* 第 171 轮（用户 #9）：地上的防具不再是一个方块。
   用户原话：「地上防具是个方块（武器是缩小版模型）」

   做法：用 mergeBoxes 拼一个迷你胸甲 —— 躯干 + 左右肩甲 + 一条腰带。
   为什么照旧用 mergeBoxes：它把多个盒子合并成一个网格，
   只多 1 次 draw call（掉落物一多，不能每件拆成几十个网格）。 */
function lootArmorGeo() {
  if (!_lootArmorGeo) {
    _lootArmorGeo = mergeBoxes([
      [0.26, 0.22, 0.12, 0xffffff, 0, 0.02, 0],       /* 躯干 */
      [0.10, 0.09, 0.11, 0xffffff, -0.16, 0.09, 0],   /* 左肩 */
      [0.10, 0.09, 0.11, 0xffffff, 0.16, 0.09, 0],    /* 右肩 */
      [0.22, 0.05, 0.11, 0xffffff, 0, -0.11, 0]       /* 腰带 */
    ]);
  }
  return _lootArmorGeo;
}
function lootShellGeo() {
  /* ★ 轮廓壳 = 同一个形状放大一圈 ✓ 合并成【一个】网格 → 只多 1 次 draw call ✓ */
  if (!_lootShellGeo) { _lootShellGeo = mergeBoxes([[0.37, 0.37, 0.37, 0xffffff, 0, 0, 0]]); }
  return _lootShellGeo;
}

/* 每帧把固定的 2 盏灯派给【最近的发光物】（现在只有掉落物；以后武器接进来就多一处 ✓）*/
var _glowCand = [];
function updateGlowLights() {
  _glowCand.length = 0;
  for (var lid in NET.rloot) {
    var e = NET.rloot[lid];
    if (!GLOW_TIER[e.tier]) { continue; }
    var dx = e.x - P.x, dz = e.z - P.z;
    _glowCand.push([dx * dx + dz * dz, e]);
  }
  if (_glowCand.length > 1) { _glowCand.sort(function (a, b) { return a[0] - b[0]; }); }
  for (var i = 0; i < GLOW_LIGHTS.length; i++) {
    var pl = GLOW_LIGHTS[i];
    var c = _glowCand[i];
    if (!c || c[0] > 24 * 24) {           // 24 米外就不点了（省着色器开销 ✓）
      pl.intensity = 0;
      pl.position.set(0, -100, 0);
      continue;
    }
    var g = GLOW_TIER[c[1].tier];
    pl.color.setHex(g.c);
    pl.intensity = g.i * 2.4;
    pl.position.set(c[1].x, 0.6, c[1].z);
  }
}

function addWorldLoot(arr) {
  if (!arr || arr.length < 3) { return null; }
  var lid = String(arr[0]);
  var x = +arr[1], z = +arr[2];
  var name = String(arr[3] || '？');
  var tier = Math.max(0, Math.min(11, Math.round(+arr[4] || 0)));
  var look = String(arr[5] || '');                      // ★ 第 70 轮：武器类型 ✓
  var e = NET.rloot[lid];
  if (!e) {
    /* ★★ 第 70 轮 用户要求：武器掉落物 = 【缩小版模型】★★
       （以前所有掉落物都是一个方块 ✗ 看不出是把剑还是破布 ✗）
       ★ 直接复用 buildWeaponMesh → 和手上那把、背包图标【同一份数据】✓
         所以地上那把永远和拿到手的一模一样 ✓ 而且品阶颜色自带 ✓ */
    var g;
    /* ★ round489：皮肤卡 = 一张【卡片】（用户："皮肤掉落画成一张卡"）
       ★ 卡面：深蓝底 + 金边 + 一颗星 ✓ 尺寸和掉落物方块差不多（0.6 左右）✓ */
    /* ★ round557：技能书 = 一本【立着的书】（书脊朝外 + 书页 + 书签带）*/
    if (String(arr[6] || '') === 'skillbook') {
      g = new THREE.Group();
      var bkCover = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.80, 0.11), matOf(0x8a4a2a));
      bkCover.castShadow = true; g.add(bkCover);
      var bkPages = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.72, 0.09), matOf(0xf0e6cf));
      bkPages.position.set(0.03, 0, 0.02); g.add(bkPages);
      var bkSpine = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.80, 0.12), matOf(0x6a3418));
      bkSpine.position.x = -0.29; g.add(bkSpine);
      var bkBand = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.10, 0.13), matOf(0xffd83d));
      bkBand.position.set(0, 0.16, 0); g.add(bkBand);
      var bkMark = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.26, 0.02), matOf(0xffe98a));
      bkMark.position.set(0.20, -0.42, 0.07); g.add(bkMark);
      g.rotation.x = -0.22; g.rotation.y = 0.5;
      g.position.set(x, terYAt(x, z) + 0.55, z);
    } else if (String(arr[7] || '') === 'skin') {
      g = new THREE.Group();
      var cardB = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.70, 0.05), matOf(0x2a3a5e));
      cardB.castShadow = true;
      g.add(cardB);
      var cardE = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.74, 0.035), matOf(0xe0bc60));
      cardE.position.z = -0.012;
      g.add(cardE);
      var st1 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.03), matOf(0xffd83d));
      st1.position.set(0, 0.08, 0.035);
      st1.rotation.z = Math.PI / 4;
      g.add(st1);
      var ln1 = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.045, 0.03), matOf(0x9fc4ff));
      ln1.position.set(0, -0.16, 0.035);
      g.add(ln1);
      var ln2 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.03), matOf(0x7ea8e8));
      ln2.position.set(-0.04, -0.25, 0.035);
      g.add(ln2);
      g.rotation.x = -0.34;
      g.rotation.y = 0.42;
      g.position.set(x, terYAt(x, z) + 0.55, z);
    } else if (look && (ATK_ARCH[look] || look === 'bow')) {
      g = buildWeaponMesh(look, tier);
      g.scale.set(0.42, 0.42, 0.42);
      g.position.set(x, terYAt(x, z) + 0.45, z);
      g.castShadow = true;
    } else {
      /* 第 171 轮（用户 #9）：防具用胸甲模型，其余仍是原来的方块。
         （arr[6] 是服务器给的物品大类：'armor' / 'mat' 等） */
      var _isArmor = String(arr[6] || '') === 'armor';
      g = new THREE.Mesh(_isArmor ? lootArmorGeo() : lootGeo(), lootMat(tier));   // ★ 几何体/材质共享（第 45 轮）
      g.position.set(x, terYAt(x, z) + 0.5, z);
      g.castShadow = true;
    }
    var gt = GLOW_TIER[tier];
    /* ★★ 第 73 轮修的 bug：武器掉落物会同时显示【两个】★★
       病根：这个 "轮廓光壳" 是一个【方块】✗
             以前所有掉落物都是方块 → 壳套在外面正合适 ✓
             但第 70 轮武器改成了【缩小版模型】✓
             而壳还是个方块 ✗ → 就看到"两个掉落物"✗✗
       修：只有【方块型】的才套壳 ✓
             武器模型本身就带品阶颜色/发光 ✓ 不需要壳 ✗ */
    var _isBoxLoot = !(look && (ATK_ARCH[look] || look === 'bow')) &&
                     String(arr[7] || '') !== 'skin' &&
                     String(arr[6] || '') !== 'skillbook';
    if (_isBoxLoot && gt && gt.shell) {                 // ★ 高阶才有轮廓光（只多 1 次 draw call ✓）
      g.add(new THREE.Mesh(lootShellGeo(), glowShellMat(tier)));
    }
    scene.add(g);
    e = NET.rloot[lid] = { g: g, x: x, z: z, name: name, tier: tier, asked: 0, look: look,
                           /* ★ 第 70 轮：地上显示名字 ✓（复用僵尸那套头顶 UI ✓
                              血条那条藏掉 —— 掉落物没有血 ✗）*/
                           ui: mkLootUI(name, tierHex(tier)) };
  }
  e.x = x; e.z = z; e.name = name; e.tier = tier;
  if (e.g) { e.g.position.x = x; e.g.position.z = z; }
  return lid;
}

function removeWorldLoot(lid) {
  var e = NET.rloot[lid];
  if (!e) { return; }
  if (e.g) {
    scene.remove(e.g);
    /* ★ 第 45 轮：几何体/材质现在都是【全品阶共享】的 ✗ 绝对不能 dispose
       （dispose 一次，后面所有同类掉落物就都画不出来了 ✗）*/
  }
  // ★ 第 70 轮：名字牌也要一起收掉 ✗（不然留一堆孤儿 div ✗）
  if (e.ui && e.ui.wrap && e.ui.wrap.remove) { e.ui.wrap.remove(); }
  delete NET.rloot[lid];
}

function clearWorldLoot() {
  for (var k in NET.rloot) { removeWorldLoot(k); }
}

/* 走过去自动捡：
   ★ 本地判距离只是为了"手感即时"——最终以【服务器】那次判定为准 ✓（防隔空捡 ✗）
   ★ 同一件别每帧都发（服务器会被重复请求刷屏 ✗）→ 每件 0.6 秒最多问一次 ✓ */
function updateLoot(dt) {
  _lootT += dt;
  var r2 = LOOT_PICK_R * LOOT_PICK_R;
  for (var lid in NET.rloot) {
    var e = NET.rloot[lid];
    if (e.g) {
      e.g.rotation.y += dt * 2.4;
      var _bz = (e.look && (ATK_ARCH[e.look] || e.look === 'bow')) ? 0.45 : 0.5;
      /* ★★★ round423（用户："掉落物如果在方块山上，没有显示在上面的方块，而是
                      在最下面被遮挡了"）★★★
         病根：这里把 y 写死成 0.45 / 0.5 ✗ 没加【脚下地形高度】✓
           → 平地上看着正常（平地 y=0 ✓）
           → 山上就被埋进山里 ✗ 只能从旁边露出一角或完全看不见 ✓
         ★ 修：用 terYAt（x,z）+ 原来那个高度 ✗ 每帧重算 ✓
           （地形被挖了也会跟着跌下来 ✓）*/
      e.g.position.y = terYAt(e.g.position.x, e.g.position.z) + _bz
                       + Math.sin(_lootT * 3 + e.x) * 0.07;   // 轻微上下浮 ✓
    }
    /* ★ 第 70 轮：名字牌跟着投影到屏幕（和僵尸血条同一套 ✓）*/
    if (e.ui) {
      if (!_mv3) { _mv3 = new THREE.Vector3(); }
      _mv3.set(e.x, 1.15, e.z).project(cam);
      var _on = (_mv3.z > -1 && _mv3.z < 1 && Math.abs(_mv3.x) < 1.2 && Math.abs(_mv3.y) < 1.4);
      UI.plate.show(e.ui, _on);
      if (_on) {
        UI.plate.move(e.ui, (_mv3.x * 0.5 + 0.5) * innerWidth,
                      (-_mv3.y * 0.5 + 0.5) * innerHeight);
      }
    }
    if (e.asked > 0) { e.asked -= dt; }
    var dx = e.x - P.x, dz = e.z - P.z;
    if (dx * dx + dz * dz > r2) { continue; }
    if (e.asked > 0) { continue; }
    e.asked = 0.6;
    if (WSC.ready) { wsSend('pick', { id: lid }); }
  }
}

/* ★ 妖兽是否对玩家造成伤害（设置里可关 ✓ 默认开 ✓ 关掉后不掉血、其余照旧 ✓）*/
function mobDmgOn() { return SETCFG.mobDmg !== false; }

/* ★ 玩家受伤的唯一入口
   kind = 'mob'（妖兽咬 ✓ 受"妖兽对玩家造成伤害"开关管）/ 'pvp'（玩家砍 ✓ 只受 PvP 开关管）
   ★ 两个开关各管各的，绝不互相影响 ✓ */
function hurtPlayer(dv, fx, fz, kind, byName, sub) {
  if (dead) { return; }                            // ★ 已经倒下了就不再掉血（免得反复触发死亡 ✓）
    /* ★★★ 第 240 轮修的真 bug（用户："只是挨打没有声音并且没有飘伤害，其它声音有"）★★★
       这里原来是：if (kind === 'mob' && !mobDmgOn()) { return; }
       → "妖兽伤害"开关一关 ✗ 挨打的声音和飘字【全被跳过】✓✓
         （它们都在这一行后面 ✓ 一 return 就都轮不到 ✓）
       ★ 注释里还写着"关了就不掉血（但攻击动作/音效照旧 ✓）"
         —— 注释和实现不一致 ✗ 实现把音效也一起掐了 ✓
       ★★ 而第 239 轮改成"血量以服务器为准"之后 ✗
          这个客户端开关【已经管不住掉血了】✓（服务器照打 ✓）
          → 结果就是"掉血了、但没声音没飘字"✓✓ 一字不差
       ★ 修法：这个开关不再拦表现 ✗
         只要服务器判你挨打 ✗ 你就该看到数字、听到声音 ✓
         （本地扣血那句留着 ✓ 它让血条立刻响应 ✓
           而服务器每帧会推真实值过来 ✗ 不会扣两次 ✓）*/
  if (dv <= 0) { return; }
  HP -= dv; shake = 0.4;
  /* ★ round360：用户听过后认为 groan 不对 ✗ 先改回 zhurt ✓
     （原始需求是"不要和僵尸一样"，但可选的替换音效听起来更差 ✓
       要真正区分需要一个新的受伤音效文件 ✓）
     ★★ round409（用户："玩家摔伤的音效要改一下"）★★
       ★ 摔落伤害服务端发来的 hurts 里带 kind='fall' ✓（world.py 的 falldmg 分支 ✓）
         → 用 strong（闷响的重击声）✗ 不再用 zhurt（那是僵尸咬人的音 ✓）
       ★ strong1~4 这组音频【一直在加载、但一次都没被用过】✓ 正好拿来当摔伤 ✓
         不用新加文件 ✗ 也不用改加载表 ✓ */
  if (sub === 'fall') { sfx('strong', 0.95); }
  else { sfx('zhurt', 0.9); }
  if (!isFinite(fx)) { fx = P.x; }
  if (!isFinite(fz)) { fz = P.z; }
  /* ★★ 第 146 轮（用户："把僵尸对自己造成的伤害改成红色方便分辨"）★★
     之前所有伤害数字都是一个色（默认米白 #fff6e8 ✗ 暴击才是金黄✓）
     → 打怪物的数字、自己挨打的数字、队友挨打的数字混在一起 ✗ 看不出谁挨了打 ✗
     现在：
       · ★ 僵尸打我 → 红色 #ff5a4a ✓（一眼就知道是自己在掉血 ✓）
       · PVP 打我 → 橙红 #ff9a3c ✓（和僵尸区开 ✓ 方便以后做 PVP 时分辨 ✓）
       · 我打怪物 → 保持原样 ✗（米白 / 暴击金黄 ✓）
     ★ 用 fxNum（已有的带颜色版本 ✓）不新加函数 ✗ */
  fxNum('-' + dv, kind === 'pvp' ? '#ff9a3c' : '#ff5a4a', fx, 2.4, fz);
  updHP();
  if (HP <= 0) { playerDie(byName); }              // ★ 不再自动满血复活 ✗ 要点复活 ✓
}

/* ★ 倒下（血空 ✓ 锁住移动和攻击 ✓ 弹复活按钮 ✓）*/

/* playerDie 已搬到 platform/web.js */


/* ★ 点"复活"才起来 ✓ 满血 ✓*/

/* playerRevive 已搬到 platform/web.js */



/* bindDead 已搬到 platform/web.js */


/* ★ 服务器发来的掉血事件（妖兽咬我 / 别的玩家砍我 ✓ 服务器算的 ✓ 我只负责表现 ✓）*/
function netApplyHurt(h) {
  if (!h) { return; }
  var dv = Math.round(+h.dmg || 0);
  if (dv <= 0) { return; }
  var hx = +h.x, hz = +h.z;
  if (!isFinite(hx)) { hx = P.x; }
  if (!isFinite(hz)) { hz = P.z; }
  if (h.sk) {
    dmgSkill(String(dv), P.x, 3.4, P.z, false);   // ★ round585：技能伤害大字淡红
  } else if (h.pvp) {
    dmg((h.by || '道友') + ' 砍你', P.x, 3.4, P.z, true);   // ★ 提示是谁砍的 ✓
  }
  /* ★ round409：把服务端的 kind 透传下去（'fall' = 摔伤 ✓ 换音效要靠它） */
  hurtPlayer(dv, hx, hz, h.pvp ? 'pvp' : 'mob', h.pvp ? h.by : '', h.kind);
}

/* 每帧：插值 + 朝向 + 走路动画 + 头顶昵称 ✓ */
var _ov3 = null;
/* ★★ 算出"该渲染他的哪一刻"（在【他的钟】里）★★ —— netUpdate 与 P0-9 测试共用同一份逻辑
   （抽出来是为了让测试量的是真代码，而不是测试里自己重写的一份 ✗）

   ★ 为什么要给 rt 限速（P0-9 第 26 轮实测出来的）：
     rt = 本地钟 − 钟差 − 抖动缓冲。钟差或缓冲一变，rt 就跟着变，
     渲染位置就【瞬间平移 v × Δdelay】—— 这是看得见的一跳，也是速度尖峰的来源。
     实测：同一批数据，自适应缓冲一帧里 delay 跳 17.6ms → 位置跳 53mm
           → 单帧速度虚高 3.2m/s → 走路抖动 8.8%；换成固定 80ms 缓冲只有 1.0% ✓
     做法：不做瞬时平移，而是让 rt 用"略快 / 略慢的播放速度"去追目标值 ——
           一帧最多比名义帧长多走 / 少走 rtCatch×帧长（默认半帧）。
           于是位置始终连续，代价只是 0.1~0.3 秒的轻微快慢，眼睛看不出来 ✓ */
function netRenderAt(o, localNow, dt) {
  var oc = o.clk || {};
  var want = localNow - (oc.off || 0) - (oc.delay || 0.06);
  /* ★★★ round285（审查报告 §1.9 第二优先）：给 rt 加一道锚 ★★★
     为什么：如果时钟基准出错（对方刷新/重连 ✓ 或者热身的棘轮被污染 ✓）
       → want 会比缓冲尾的时间键【大几千秒】✗
       → netSample 取不到区间 ✗ 被顶到外推上限 ✗ 位置按 12 倍速播放 ✓
     ★ 有了这道锚：want 最多只比缓冲尾大 0.25 秒 ✓
       时钟再错 ✗ 也只会"卡一下"✗ 绝不可能变成倍速 ✓
     ★ 副作用（可接受 ✓）：真丢包时表现为短暂停顿 ✗ 而不是飞出去 ✓
       体感更像"网络卡"✗ 比"瞬移"好得多 ✓ */
  if (o.buf && o.buf.length) {
    var _tail = o.buf[o.buf.length - 1].t;
    if (want > _tail + 0.25) { want = _tail; }
  }
  if (o.rtS === undefined || o.rtLast === undefined) {
    o.rtS = want; o.rtLast = localNow; return want;
  }
  /* ★ 名义前进量要用【真实经过的时间】，不能用调用方给的 dt：
     frame() 在命中顿帧（hitStop）时会把 dt 乘 0.2，那不是真实时间 ——
     用它推进 rt 会让远端渲染时刻悄悄落后，然后要花好几秒才补回来 ✗ */
  var step = localNow - o.rtLast;
  o.rtLast = localNow;
  if (!(step > 0) || step > 1.0) { step = dt > 0 ? dt : 1 / 60; }
  /* ★★ 偏差太大就直接对齐，别用限速慢慢追（第 28 轮补的兜底）★★
     限速是给"几十毫秒的网络抖动"用的；但钟差偶尔会【被大幅重估】：
       · 服务端新玩家的第一个 ct 是 0（world.py 里 Player.__init__：self.ct = 0.0）
         → 第一包算出来的钟差偏出几十秒，第二包才修正 → want 一下前跳几十秒
       · 或者长时间切后台、对方重登
     这时按 10%/帧去追就是【永远追不上】—— 差 60 秒要用 600 秒才补完，
     表现就是"能看到这个人，但他钉在原地不动" ✗（和 NET.on 那个 bug 症状一样）
     判据：偏差超过一个抖动缓冲的量级（NET.rtSnap，默认 0.35 秒）就当作"重新对齐"，
           直接贴上去 —— 会跳一下，但那一下总比一直不动强 ✓ */
  var err = want - o.rtS;
  var snap = NET.rtSnap || 0.35;
  if (err > snap || err < -snap) { o.rtS = want; return o.rtS; }
  var lim = step * (NET.rtCatch || 0.1);
  var d = want - (o.rtS + step);
  if (d > lim) { d = lim; } else if (d < -lim) { d = -lim; }
  o.rtS += step + d;
  return o.rtS;
}

/* ★ 附近队友的方位指示（第 28 轮加）：
   50 米以内的其他玩家，如果【人不在画面里】，就在屏幕边缘贴一个箭头指向他，并标出距离。
   人在画面里时不画（看得见就没必要挡视线 ✓）*/
var MARK_RANGE = 50;
var MARK_RANGE_TEAM = 100.0;   // ★ 第 85 轮：队友的箭头距离（用户要求 100 米 ✓）
var MARK_COL = '#7ee08a';        // 普通玩家（绿 ✓ 和头顶名牌一致 ✓）
var MARK_COL_TEAM = '#8fc4ff';   // ★ 队友（蓝）—— 见下面 markColor() 的说明 ✓
var MARK_COL_DEAD = '#e0776a';   // 倒下的人（红 ✓）
var _marks = {};                 // uid -> 平台层给的标记句柄
var _mark3 = null, _mark4 = null;

/* ★ 箭头颜色（第 28 轮预留队友色）：
   P4 组队系统上线后，服务器会在玩家快照里带上队伍号，
   那时把下面那句的 `o.team !== undefined &&` 去掉就生效了 —— 现在没有队伍数据，
   所以这个分支永远走不到 ✓（这样以后只用改一行，不用再翻这段逻辑 ✓） */
/* ★★ 第 85 轮：队友箭头（用户要求：加入队伍后 100 米内都显示【蓝色】箭头）★★
   ★ 这段原来就留好了口子（注释写着"以后只用改一行"✓）
     现在把那一行接上：队友数据来自平台层的 PARTY（跨文件全局 ✓ 和 setShadow 一样）*/
function isPartyMate(uid) {
  try {
    if (typeof PARTY === 'undefined' || !PARTY || !PARTY.roster) { return false; }
    for (var i = 0; i < PARTY.roster.length; i++) {
      if (String(PARTY.roster[i][0]) === String(uid)) { return true; }
    }
  } catch (e) { }
  return false;
}

function markColor(o, isMate) {
  if (typeof o.hp === 'number' && o.hp <= 0) { return MARK_COL_DEAD; }
  if (isMate) { return MARK_COL_TEAM; }      // ★ 队友 = 蓝色 ✓
  return MARK_COL;
}

/* ★★ 第 87 轮（用户要求）：自己头顶也显示一条血条 ★★
   · 复用僵尸那套头顶 UI（mkMobUI ✓ 自带血条 + 一行字 ✓）
   · 那行字就写"123 / 200" ✓ 位置正好压在血条上 → 就是你说的"血量文字内置"✓
   · 每帧刷：宽度 + 颜色（绿→黄→红）+ 数字 ✓
   · 血量没变就不写 DOM ✗（这是每帧都跑的代码 ✗ 能省就省 ✓）*/
var _selfUI = null, _selfHp = -1, _selfMx = -1;   // ★ 第 108 轮：上限也要记 ✗
function updateSelfBar() {
  if (dead) {
    if (_selfUI) { UI.plate.show(_selfUI, false); }
    return;
  }
  if (!_selfUI) { _selfUI = mkMobUI('', 1); }
  if (!_selfUI) { return; }
  UI.plate.tag(_selfUI, MY_FROZEN ? '❄ 冰冻' : (MY_DOWN > 0 ? '击倒' : ''),
               MY_FROZEN ? '#9fe8ff' : '#ffb35a');
  /* 持续技能 / 被动触发：头顶进度条 */
  var _bl = [];
  var _dm = (typeof MY_SKDUR_MUL !== 'undefined' && MY_SKDUR_MUL > 0) ? MY_SKDUR_MUL : 1;
  if (typeof MY_SHIELD_T !== 'undefined' && MY_SHIELD_T > 0) { _bl.push({ n: '护盾', t: MY_SHIELD_T, m: 30 * _dm, c: '#7fd4ff' }); }
  if (typeof MY_GALE_T !== 'undefined' && MY_GALE_T > 0) { _bl.push({ n: '疾风', t: MY_GALE_T, m: 20 * _dm, c: '#9fe8ff' }); }
  if (typeof MY_BLOODRAGE_T !== 'undefined' && MY_BLOODRAGE_T > 0) { _bl.push({ n: '血怒', t: MY_BLOODRAGE_T, m: 15 * _dm, c: '#ff7a5a' }); }
  if (typeof MY_BERSERK_T !== 'undefined' && MY_BERSERK_T > 0) { _bl.push({ n: '暴走', t: MY_BERSERK_T, m: 15 * _dm, c: '#ff5a3a' }); }
  if (typeof MY_BLOODTHIRST_T !== 'undefined' && MY_BLOODTHIRST_T > 0) { _bl.push({ n: '嗜血', t: MY_BLOODTHIRST_T, m: 8 * _dm, c: '#ff9a5c' }); }
  try {
    if (typeof SK_ACT !== 'undefined' && SK_ACT && SK_ACT.until > performance.now()) {
      _bl.push({ n: SK_ACT.n, t: (SK_ACT.until - performance.now()) / 1000, m: SK_ACT.m, c: '#ffb35a' });
    }
  } catch (eAct) { }
  UI.plate.buffs(_selfUI, _bl);
  var mx = Math.max(0, Math.round(HP));
  var mm = Math.max(1, Math.round(HPMAX));
  var pct = Math.max(0, Math.min(100, mx / mm * 100));
  /* ★★ 第 108 轮（用户："装备穿戴后头上的血量不会立即刷新，要挨打后才会"）★★
     病根：这个判断只看【当前血量】✗
           换装备时变的是【上限】✗ 当前血量没变 → 条件不成立 → 条子不重画 ✗
           → 只有挨打（血量变了）才顺带刷出来 ✓✓ 和用户描述一致 ✓
     修：上限也一起记 ✓ 上限变了同样重画 ✓ */
  if (mx !== _selfHp || mm !== _selfMx) {
    _selfHp = mx;
    _selfMx = mm;
    var _spi = Math.round(pct * 10);
    if (_selfPlate._hp !== _spi) { _selfPlate._hp = _spi; UI.plate.hpWidth(_selfUI, pct.toFixed(1) + '%'); }
    UI.plate.hpColor(_selfUI, pct > 60 ? 'linear-gradient(180deg,#7ee08a,#3aa04a)'
                    : (pct > 25 ? 'linear-gradient(180deg,#ffd83d,#c9a02a)'
                                : 'linear-gradient(180deg,#ff7a6a,#c04030)'));
    // ★ 第 88 轮（用户要求）：数字显示在【血条里面】✓ 不是条上面 ✓
    UI.plate.barText(_selfUI, String(mx), '#fff');   // ★ 第 111 轮：只显示剩余量 ✓
  }
  /* ★ 第 155 轮（用户要求）：自己也看得见自己的魔气 ✓ 就在头顶（血条上面一行）✓ */
  UI.plate.title(_selfUI, (typeof MY_TT === 'string') ? MY_TT : '', (typeof MY_TM === 'number') ? MY_TM : 0);
  UI.plate.mq(_selfUI, (typeof MY_MQ === 'number') ? MY_MQ : 0);
  if (!_mark3) { _mark3 = new THREE.Vector3(); }
  _mark3.set(P.x, P.y + heroPlateY(H, heroVisualSize()), P.z).project(cam);
  var on = (_mark3.z > -1 && _mark3.z < 1 && Math.abs(_mark3.x) < 1.3 && Math.abs(_mark3.y) < 1.6);
  UI.plate.show(_selfUI, on);
  if (on) {
    UI.plate.move(_selfUI, (_mark3.x * 0.5 + 0.5) * innerWidth,
                  (-_mark3.y * 0.5 + 0.5) * innerHeight);
  }
}

/* round292: teammates at ANY distance get an edge marker.
   The server puts every member's x/z at the end of the roster (round 264), so
   teammates beyond the 100m view can still be shown as a screen-edge arrow.
   Kept as its own function on purpose: the first attempt inlined this into
   updateMarks with a regex and landed inside the `if (!NET.on)` offline branch. */
function drawFarMates(marks, used) {
  if (typeof PARTY === 'undefined' || !PARTY.roster || !PARTY.roster.length) { return; }
  for (var i = 0; i < PARTY.roster.length; i++) {
    var r = PARTY.roster[i];
    if (!r || r.length < 13) { continue; }              /* no coords -> old roster */
    var rid = r[0], rname = r[1], rx = r[11], rz = r[12];
    if (String(rid) === String(WSC.myId)) { continue; } /* myself */
    /* ★★★ round293（用户："会一直闪烁，移动时方向还会乱跳"）★★★
       病根：这里原来写的是 if (marks[rid]) { continue; } ✗
         → 已存在时【跳过】= 没有设 used[rid] ✓
         → 紧接着 updateMarks 末尾的收尾循环 if (!used[k]) remove ✗ 就把它删了 ✓
         → 下一帧又重建 ✗ 每帧闪一下 ✓✓ 方向乱跳也是这么来的（每次新建 ✓）
       ★ 修：已存在就【更新位置】✗ 不跳过 ✓ 并且始终标记 used ✓
         （★ 这条对"视野内的队友"也适用：那时 marks[rid] 已由上面的循环建好 ✓
           我们也要把它标成 used ✗ 否则同样被删 ✓） */
    /* ★★★ round295（用户："已经走到身边了方向都没有消失"）★★★
       病根：第 293 轮我为了修闪烁 ✗ 把"跳过视野内队友"也一起删了 ✓
         → 走到身边时【主循环】和【我这个函数】都在处理他 ✓
         → 主循环会把他切回世界内标记（show(false) ✗ 不画箭头 ✓）
           但我这边没判 ✗ 继续画箭头 ✓✓ 所以箭头不消失 ✓
       ★ 修：视野内的队友【交给主循环】✗ 我这里跳过 ✓
         但★必须标 used[rid] ✗ 不然又会被收尾循环删掉 → 又闪 ✓
         （第 293 轮就是栽在"跳过时没标 used" ✓ 这次两个一起做 ✓）*/
    /* ★ round295b：上面我写成了 rd[rid] ✗ 但主循环用的是 for (uid in NET.others) ✓
       所以那个判断永远为假 ✗ 箭头走到身边也不消失 ✓ 改成 NET.others ✓ */
    if (NET.others && NET.others[rid]) { used[rid] = true; continue; }   /* 在视野里 → 主循环负责 ✓ */
    var dx = rx - P.x, dz = rz - P.z;
    var dist = Math.sqrt(dx * dx + dz * dz);
    /* ★★★ round294（用户："他会跟着我滑动的方向一起移动，方向还是会乱动"）★★★
       病根：我这里是【自己编】的角度公式 ✗
           ang = atan2(dz,dx) − P.yaw − π/2 ✓
         而原来那套（视野内玩家 ✓ 一直是对的 ✓）用的是【真正的相机投影】✓：
           · 把世界坐标丢给相机投影 ✓ 得到屏幕方向 ✓
           · ★ 还要处理"人在身后时投影是镜像的"✗ 要反过来 ✓
         → 我漏了这两步 ✗ 所以方向完全不对 ✓（跟着自己转会动 ✓ 因为 P.yaw 项 ✓）
       ★ 修：照抄原来那套的算法 ✗ 一个字都不改 ✓（这是今天血换来的规矩 ✓）*/
    /* ★ 保险：这两个临时向量平时是懒初始化的 ✗
       万一这个函数比那套循环先跑到 ✗ 这里就会 null 崩 ✓
       自己初始化一次 ✗ 零成本 ✓ */
    if (!_mark3) { _mark3 = new THREE.Vector3(); }
    if (!_mark4) { _mark4 = new THREE.Vector3(); }
    _mark3.set(rx, 1.2, rz);
    _mark4.copy(_mark3).applyMatrix4(cam.matrixWorldInverse);
    var behind = _mark4.z > 0;
    _mark3.project(cam);
    var nx = _mark3.x, ny = -_mark3.y;
    if (behind) { nx = -nx; ny = -ny; }     /* 身后时投影镜像 → 反过来才对 ✓ */
    var ang = Math.atan2(ny, nx);
    var hw = innerWidth * 0.5 - 30;
    var ny = Math.sin(ang);
    var hh = (ny < 0) ? Math.max(10, innerHeight * 0.5 - 78)
                      : Math.max(10, innerHeight * 0.5 - 44);
    var ax = Math.abs(Math.cos(ang)), ay = Math.abs(Math.sin(ang));
    var t = Math.min(hw / (ax || 1e-6), hh / (ay || 1e-6));
    if (!marks[rid]) { marks[rid] = UI.mark.make(); }
    used[rid] = true;                     /* ★ 每帧都要标 ✓ 不然会被收尾循环删掉 ✗ */
    UI.mark.at(marks[rid],
      innerWidth * 0.5 + Math.cos(ang) * t,
      innerHeight * 0.5 + Math.sin(ang) * t,
      ang * 180 / Math.PI,
      '\u2605' + rname + ' ' + Math.round(dist) + 'm',
      r[9] ? '#888888' : '#5aa8ff');                    /* grey when down */
    UI.mark.show(marks[rid], true);
  }
}


function updateMarks() {
  var uid, m, k;
  if (!NET.on) {   // 离线 / 断线 → 全部收掉 ✓
    /* round291（用户：组队时不管再远都要显示队友的方向和距离）
       第 264 轮服务器已经把队友坐标加进队伍名单了（roster 最后两项 x/z ✓）
       但客户端这半一直没做 ✗ 所以超出视野就看不到队友 ✓
       做法：遍历队伍名单 ✗ 对不在视野里的队友也画一个屏幕边缘标记 ✓ */
    if (typeof PARTY !== 'undefined' && PARTY.roster && PARTY.roster.length) {
      for (var _ri = 0; _ri < PARTY.roster.length; _ri++) {
        var _rm = PARTY.roster[_ri];
        if (!_rm || _rm.length < 13) { continue; }
        var _rid = _rm[0], _rname = _rm[1], _rx = _rm[11], _rz = _rm[12];
        if (String(_rid) === String(WSC.myId)) { continue; }
        if (_marks[_rid]) { continue; }
        var _rdx = _rx - P.x, _rdz = _rz - P.z;
        var _rdist = Math.sqrt(_rdx * _rdx + _rdz * _rdz);
        var _rang = Math.atan2(_rdz, _rdx) - (P.yaw || 0) - Math.PI / 2;
        var _rhw = innerWidth * 0.5 - 30;
        var _rny = Math.sin(_rang);
        var _rhh = (_rny < 0) ? Math.max(10, innerHeight * 0.5 - 78)
                              : Math.max(10, innerHeight * 0.5 - 44);
        var _rax = Math.abs(Math.cos(_rang)), _ray = Math.abs(Math.sin(_rang));
        var _rt = Math.min(_rhw / (_rax || 1e-6), _rhh / (_ray || 1e-6));
        if (!_marks[_rid]) { _marks[_rid] = UI.mark.make(); }
        used[_rid] = true;
        UI.mark.at(_marks[_rid],
          innerWidth * 0.5 + Math.cos(_rang) * _rt,
          innerHeight * 0.5 + Math.sin(_rang) * _rt,
          _rang * 180 / Math.PI,
          '★' + _rname + ' ' + Math.round(_rdist) + 'm',
          _rm[9] ? '#888888' : '#5aa8ff');
        UI.mark.show(_marks[_rid], true);
      }
    }

    for (k in _marks) { UI.mark.remove(_marks[k]); delete _marks[k]; }
    return;
  }
  var used = {};
  for (uid in NET.others) {
    var o = NET.others[uid];
    if (!o || !o.cur) { continue; }
    var dx = o.cur.x - P.x, dz = o.cur.z - P.z;
    var dist = Math.sqrt(dx * dx + dz * dz);
    /* ★ 第 85 轮：队友看得更远（100 米 ✓）路人还是原来的范围 ✓
       —— 队伍的意义之一就是"知道队友在哪"✓ 看不到就没意义了 ✗ */
    var _mate = isPartyMate(uid);
    if (dist > (_mate ? MARK_RANGE_TEAM : MARK_RANGE)) { continue; }
    used[uid] = 1;
    if (!_marks[uid]) { _marks[uid] = UI.mark.make(); }
    m = _marks[uid];
    if (!m) { continue; }
    if (!_mark3) { _mark3 = new THREE.Vector3(); }
    if (!_mark4) { _mark4 = new THREE.Vector3(); }
    _mark3.set(o.cur.x, 2.2, o.cur.z);
    /* ★★ "在不在相机身后"必须用【视图空间】的 z 判断（第 28 轮修的真 bug）★★
       相机永远朝自己的 -z 看 → 视图空间里 z>0 才是"在身后" ✓
       原来这里写的是 NDC 的 `_mark3.z > 0` —— 而 NDC 的 z 正常范围就是 [-1,1]，
       画面里看得见的东西几乎全是 z>0 → 这个"翻转"对【所有人】都生效
       → 箭头整体指反 180° ✗（玩家反馈："这个箭头的方向反了"）
       表现：乙在甲的 -z 方向（屏幕上方），箭头却跑到屏幕下方 ✗ */
    _mark4.copy(_mark3).applyMatrix4(cam.matrixWorldInverse);
    var behind = _mark4.z > 0;
    _mark3.project(cam);
    // 人就在画面里（留一点边距）→ 不画箭头 ✓
    if (_mark3.z > -1 && _mark3.z < 1 && Math.abs(_mark3.x) < 0.92 && Math.abs(_mark3.y) < 0.88) {
      UI.mark.show(m, false);
      continue;
    }
    // 屏幕方向：NDC 的 y 是朝上的，屏幕坐标朝下，所以取负 ✓
    var nx = _mark3.x, ny = -_mark3.y;
    if (behind) { nx = -nx; ny = -ny; }   // 人在身后时投影是镜像的 → 反过来才对 ✓
    var ang = Math.atan2(ny, nx);
    /* 从屏幕中心沿这个方向走到边缘。★ 上下留的边距不一样（第 32 轮）：
       往上指的箭头要多留一圈（padTop）—— 不然后顶到屏幕上沿，
       被左上角的血量/名牌、右上角的帧数诊断挡住 ✗（用户反馈过）
       往下指的小一点就行（下边只有一行操作提示）✓ */
    var padX = 30, padTop = 78, padBot = 44;
    var hw = innerWidth * 0.5 - padX;
    var hh = (ny < 0) ? Math.max(10, innerHeight * 0.5 - padTop)
                      : Math.max(10, innerHeight * 0.5 - padBot);
    var ax = Math.abs(Math.cos(ang)), ay = Math.abs(Math.sin(ang));
    var t = Math.min(hw / (ax || 1e-6), hh / (ay || 1e-6));
    UI.mark.at(m, innerWidth * 0.5 + Math.cos(ang) * t, innerHeight * 0.5 + Math.sin(ang) * t,
      ang * 180 / Math.PI,
      (_mate ? '队友 ' : '') + Math.round(dist) + 'm', markColor(o, _mate));
    UI.mark.show(m, true);
  }
  /* round292: teammates beyond the view - see drawFarMates above */
  drawFarMates(_marks, used);

  for (k in _marks) {   // 走了 / 跑远了 / 断线的收掉 ✓
    if (!used[k]) { UI.mark.remove(_marks[k]); delete _marks[k]; }
  }
}

/* 2026-10-22：远端玩家从坐/躺切回站立时，把旋转顺序恢复默认（否则走路看着是歪的） */
function _gs_reset_order(o) {
  if (!o || !o.hh || !o.hh.g) { return; }
  if (o.hh.g.rotation.order !== 'XYZ') { o.hh.g.rotation.order = 'XYZ'; }
}

function netUpdate(dt) {
  if (!NET.on) { return; }
  var now = performance.now() / 1000;
  var srvDelay = (NET.srv && NET.srv.delay) || 0.06;
  var srvRender = now - (NET.srv && NET.srv.off ? NET.srv.off : 0) - srvDelay;   // ★ 服务器钟里的"该渲染哪一刻"
  for (var uid in NET.others) {
    var o = NET.others[uid];
    // ★ 用【他的钟】换算该渲染哪一刻 → 网络抖动不再变成走路的忽快忽慢 ✓
    if (!netSample(o.buf, netRenderAt(o, now, dt), o.cur)) { continue; }
    var px = o.cur.x, pz = o.cur.z;
    /* ★★ 2026-10-22：他坐着 / 躺着时【不要再走插值】★★
       以前这里只管走路 → 坐下那一刻服务端把他瞬移到椅子上，
       插值一路追、姿态又是站姿 → 别人看着一直在抽动。
       现在坐/躺直接吸附到服务端坐标，并摆出对应姿势。 */
    var _seated = (o.seat != null && String(o.seat) !== '-1' && String(o.seat) !== '');
    if (_seated || o.sleep) {
      var _gs = o.hh.g;
      o.walkT = 0;
      o.hh.legL.rotation.x = 0; o.hh.legR.rotation.x = 0;
      o.hh.armL.rotation.x = 0.15; o.hh.armR.rotation.x = 0.15;
      _gs.rotation.z = 0;
      _gs.rotation.order = 'YXZ';
      if (o.sleep) {
        var _sy2 = +((o.snapYaw != null) ? o.snapYaw : (o.cur.yaw || 0));
        var _so2 = (typeof SLEEP_OFF !== 'undefined') ? SLEEP_OFF : 0.55;
        var _y2 = (typeof supportYAt === 'function') ? supportYAt(px, pz) : 0;
        _gs.position.set(px + Math.sin(_sy2) * _so2, _y2 + 0.62, pz + Math.cos(_sy2) * _so2);
        _gs.rotation.set(-1.45, _sy2, 0);
      } else {
        var _y3 = (typeof supportYAt === 'function') ? supportYAt(px, pz) : 0;
        _gs.position.set(px, _y3 + 0.30, pz);
        _gs.rotation.set(0, o.cur.yaw || 0, 0);
        /* 坐姿：大腿抬平、小腿垂下 */
        o.hh.legL.rotation.x = -1.35; o.hh.legR.rotation.x = -1.35;
      }
      o.last.x = px; o.last.z = pz;
      continue;
    }
    _gs_reset_order(o);
    o.hh.g.position.set(px, 0, pz);
    o.hh.g.rotation.y = o.cur.yaw;
    o.hh.g.rotation.z = 0;
    // ★ 走路动画按"这一帧真的走了多远"算 ✓（原来按到目标点的距离 ✗ 会一抽一抽）
    var spd = Math.hypot(px - o.last.x, pz - o.last.z) / Math.max(dt, 0.0001);
    o.last.x = px; o.last.z = pz;
    /* 疾风步残影由服务端广播 fx kind='ghost'（round590）*/
    if (spd > 0.35) {
      o.walkT += dt * (6.0 + Math.min(4.0, spd * 0.6));
      var sw = Math.sin(o.walkT) * 0.72;
      o.hh.legL.rotation.x = sw; o.hh.legR.rotation.x = -sw;
      o.hh.armL.rotation.x = -sw * 0.75; o.hh.armR.rotation.x = sw * 0.45;
    } else {
      o.hh.legL.rotation.x *= 0.9; o.hh.legR.rotation.x *= 0.9;
      o.hh.armL.rotation.x *= 0.9; o.hh.armR.rotation.x *= 0.9;
    }
    /* ★★ 第 57 轮：他倒下了 → 也给他摆成躺地 ✓（用户报的：别人看死亡的人还站着 ✗）
       ★ 放在所有动画【之后】—— 不然会被走路/挥剑覆盖回去 ✗
         （本地死亡姿势踩过同一个坑 ✓）*/
    if (o.dead) {
      o.hh.g.rotation.x = -1.45;
      o.hh.g.rotation.z = 0.12;
      o.hh.g.rotation.y = o.cur.yaw;
      o.hh.g.position.set(px, 0.28, pz);
      /* ★★★ 第 94 轮修的 bug（用户报："别人死后血条概率出现在我旁边跟着移动"）★★★
         病根：这里 continue 跳过了后面那段【每帧更新他名字/血条位置】的代码 ✗
              → 他倒下那一刻，他的血条就【冻在当时的屏幕位置上】✗
              → 而镜头一直在动 → 看着就像"那条血条跟着我走"✓✓
              （"概率"出现 = 只有他倒在你视野里时才会留下这么一条 ✓）
         修：倒下时把他的名字/血条【收掉】✓ 复活后下面那段会自己再显示出来 ✓ */
      if (o.ui) { UI.plate.show(o.ui, false); }
      continue;                       // 倒了就别再播挥剑了 ✓
    }
    /* ★ 第 57 轮踩的坑：站起来时要把【躺地的角度】复位 ✗
       我一开始只复位了 rotation.z，漏了 rotation.x
       → 复活之后人还是斜着的 ✗（走路动画只管四肢，不动身体角度 ✓）*/
    o.hh.g.rotation.x = 0;
    o.hh.g.rotation.z = 0;
    /* ★ round593：天罚击倒 → 短暂倒地姿势 */
    if (o.downT > 0) {
      o.hh.g.rotation.x = -1.15;
      o.hh.g.rotation.z = 0.10;
      o.hh.g.position.y = 0.22;
    }
    /* ★★ 第 63 轮：队友的无敌环（他刚复活时脚下一圈蓝光 ✓）★★
       ★ 不加的话，别人眼里的复活就是"凭空站起来"✗（用户原话）*/
    if (o.inv > 0) {
      if (!o.ring) { o.ring = makeInvRing(); }
      o.ring.visible = true;
      o.ring.position.set(px, 0.07, pz);
      var oi = Math.max(0.2, Math.min(1, o.inv / 1.5));
      o.ring.material.opacity = 0.20 + 0.55 * oi;
      var op2 = 1 + 0.10 * Math.sin(o.inv * 14.0);
      o.ring.scale.set(op2, op2, op2);
    } else if (o.ring) {
      o.ring.visible = false;
    }
    // ★ 他的挥剑动画（抬剑 → 下砍 ✓ 和本地共用 heroAtkPose → 动作一模一样 ✓）
    if (o.atkT >= 0) {
      o.atkT += dt * ATK_ANIM_SPD;   // ★ 第 169 轮：他们的动画也一起加速 ✓（看着才一致 ✓）
      /* ★ round398：别人放特效时，按他的状态覆盖动画（连砍/长棍/转圈）*/
      var _rNow = performance.now();
      var _rMulti = (o.multiN > 0 && o.multiT0 && _rNow - o.multiT0 < o.multiN * 180);
      if (_rMulti) {
        var _rRep = ((_rNow - o.multiT0) % 180) / 180;
        heroAtkPose(o.hh, _rRep * ATK_T.chop[ATK_T.chop.length - 1],
                    px, pz, o.cur.yaw, 'axe', terYAt(px, pz), 0);
        if (o.staffT0) { /* 多刀时不叠加长棍 ✓ */ }
      } else if (!heroAtkPose(o.hh, o.atkT, px, pz, o.cur.yaw, o.wlook, terYAt(px, pz),
                       (o.atkSeq >= 0 ? o.atkSeq : 0))) {
        o.atkT = -1;
        heroAtkReset(o.hh, px, pz, o.cur.yaw);
      }
      /* ★ round428：他的刀尖 → 他那条拖影（每帧 ✓）*/
      try {
        if (o._tid && o.hh && o.hh.sw) {
          var _otp = weaponTipOf(o.hh.sw, o.wlook, _tipV || new THREE.Vector3());
          if (_otp) { trailTick(o._tid, _otp); }
        }
      } catch (e2) { }
      /* ★ round398：别人的长棍变大 + 锤子转圈（和本地同一套包络/角度 ✓）*/
      if (o.hh && o.hh.sw) {
        var _sAge2 = o.staffT0 ? (_rNow - o.staffT0) / 1900 : 2;
        if (_sAge2 >= 0 && _sAge2 < 1) {
          var _env2 = (_sAge2 < 0.10) ? (_sAge2 / 0.10)
                    : ((_sAge2 < 0.35) ? 1 : (1 - (_sAge2 - 0.35) / 0.65));
          var _pk2 = 1 + Math.min(4.4, ((o.staffLen || 4) / 10) * 4.4);
          var _sk2 = 1 + (_pk2 - 1) * Math.max(0, _env2);
          o.hh.sw.scale.set(_sk2, _sk2, _sk2);
        } else if (o.hh.sw.scale.x !== 1) {
          o.hh.sw.scale.set(1, 1, 1);
        }
      }
      /* ★ round399：别人的暴击跳打（和本地同一套抛物线 ✓）*/
      if (o.critUntil && _rNow < o.critUntil) {
        var _cp = 1 - (o.critUntil - _rNow) / 400;
        if (_cp < 0) { _cp = 0; }
        if (_cp > 1) { _cp = 1; }
        o.hh.g.position.y += Math.sin(_cp * Math.PI) * 3.4;
      }
      if (o.spinUntil && _rNow < o.spinUntil) {
        var _sp2 = 1 - (o.spinUntil - _rNow) / 560;
        if (_sp2 < 0) { _sp2 = 0; }
        if (_sp2 > 1) { _sp2 = 1; }
        o.hh.g.rotation.y = o.cur.yaw + Math.PI * 10 * _sp2;   /* round403: 五圈 */
      }
    }
    // 头顶昵称
    if (o.ui) {
      if (!_ov3) { _ov3 = new THREE.Vector3(); }
      _ov3.set(px, (o.hh.g.position.y || 0) + heroPlateY(o.hh, o.sz), pz).project(cam);
      var vis = (_ov3.z > -1 && _ov3.z < 1 && Math.abs(_ov3.x) < 1.35 && Math.abs(_ov3.y) < 1.5);
      UI.plate.show(o.ui, vis);
      if (vis) {
        var sx = (_ov3.x * 0.5 + 0.5) * innerWidth;
        var sy = (-_ov3.y * 0.5 + 0.5) * innerHeight;
        var _ox = sx | 0, _oy = sy | 0;
        if (o._mvx !== _ox || o._mvy !== _oy) {
          o._mvx = _ox; o._mvy = _oy;
          UI.plate.move(o.ui, sx, sy);
        }
        // ★ 他的血条（绿色 ✓ 玩家用绿、妖兽用红 → 一眼分得清 ✓）
        var opct = Math.max(0, Math.min(100, (o.hp / (o.hpMax || 100)) * 100));
        var _opi = Math.round(opct);
        if (o._hpi !== _opi) { o._hpi = _opi; UI.plate.hpWidth(o.ui, _opi + '%'); }
        if (o._hpc !== 1) { o._hpc = 1; UI.plate.hpColor(o.ui, BAR_PLR); }
        /* ★★ 第 89 轮（用户要求）：其他玩家也把血量放进血条里 ✓
           ★ 顺手修一个静默 bug：这行原来每帧覆盖名字 ✗
             而"队友蓝色五角星"是在 addOther 里设的 ✓ → 被这行刷掉了 ✗
             （所以你大概一直没看到那颗星 ✓ 现在这里也带上星 ✓）*/
        var _mate3 = o.mate || isPartyMate(uid);   // ★ 第 90 轮：优先用服务器给的 ✓
        /* ★★★ 第 154 轮修的真 bug：魔气在这里【也要写】★★★
           用户报："游戏里有魔气了头上也没有显示"
           根因：头顶名字有【两个地方在写】✗
             · addOther 里那段（第 152 轮我把魔气加在那 ✓）
             · ★ 就是这一段 —— 每帧都跑 ✗ 用"★ 名字 境界"覆盖了一遍 ✗✓
             → 魔气刚加上就被这行抹掉了 ✓✓
           ★ 这个坑我踩过好几次了（弓的朝向 / 队友五角星 / 倒地血条 ✓）
             共同点：同一份显示被多处代码写 ✗ 后写的那处赢 ✓
           ★ 对策（这次做到）：改名的地方【只此一处】✗
             上面 addOther 那段也一并保留 ✓ 但两边用同一套拼法 ✓
           → 以后要改名，改这里就够了 ✓（我在 addOther 里也加了同样的注释 ✓）*/
        UI.plate.name(o.ui,
          (_mate3 ? '★ ' : '') + (o.name || '道友') + (o.realm ? ' ' + o.realm : ''),
          _mate3 ? '#5aa8ff' : '#fff');
        // ★ 第 155 轮：魔气【单独一行】放在名字上面 ✓（用户要求 ✓）
        UI.plate.mq(o.ui, o.mq);
        // ★ 第 127 轮：只显示剩余量 ✗（用户报：看别人血条里有个 "/100" ✗）
        //   ★ 第 111 轮我就想改这里 ✗ 但当时用的是字串替换且【没加断言】✗
        //     缩进对不上 → 静默失败 ✗ 所以一直没生效 ✗（这次加了断言 ✓）
        var _obt = String(Math.max(0, Math.round(o.hp)));
        if (o._bts !== _obt) { o._bts = _obt; UI.plate.barText(o.ui, _obt, '#fff', 10); }
      }
    }
  }
  // ★ 世界妖兽：插值显示 + 走路/攻击/倒地动画（动作由服务器的状态驱动 ✓）
  for (var mid in NET.rmobs) {
    var rm = NET.rmobs[mid];
    /* ★★★ round324（用户："跳动的时候僵尸会停顿下来"）
       现象：某一帧拿不到采样时，僵尸【原地冻住】✗ 下一帧又跳回去 ✓
       修：拿不到采样就按【最后一次的速度】继续外推（最多 0.2 秒）
           → 看起来是"继续走"✗ 而不是"卡住"✓
       ★ 这只是把"冻住"变成"顺滑"✗ 根因（为什么拿不到采样）还没定位 ✓
         但不管根因是什么，外推都能让画面不跳 ✓ */
    /* ★★★ round328（用户："一直跳的话僵尸走路像抽帧一样"）
       ★ 上一轮我加的"采样断流就按速度外推"是【错的方向】✗
         外推之后新采样一到，位置又跳回真值 ✗ 一帧一顿 ✓
       ★ 现在改成：采样位置只当【目标】✗ 视觉位置每帧朝它平滑追 ✓
         - 采样 30Hz、渲染 60Hz 也顺 ✓
         - 偶尔丢一帧采样 ✗ 平滑追让画面看不出来 ✓
         - 新采样和当前差得远 ✗ 也是平滑追过去 ✗ 不会跳 ✓ */
    if (!netSample(rm.buf, srvRender, rm.cur)) { continue; }
    var rx = rm.cur.x, rz = rm.cur.z;
    if (rm.px !== undefined && dt > 0.0001) {
      var _dvx = (rx - rm.px) / dt, _dvz = (rz - rm.pz) / dt;
      // ★ 只在速度合理时记录（防瞬移把速度记成天文数字 ✗）
      if (Math.abs(_dvx) < 12 && Math.abs(_dvz) < 12) { rm.vx = _dvx; rm.vz = _dvz; }
    }
    rm.px = rx; rm.pz = rz;
    /* ★★★ round306：僵尸也要站在地形上 ✗ 而且上台阶要"跳"一下 ✓
       自测踩到（用户："僵尸怎么无视方块可以直接穿模了"）：
         ① 服务端 _mob_step 完全没查地形高度 ✗ 僵尸直接走上峭壁 ✓（已修 ✓）
         ② 客户端把僵尸【永远画在 y=0】✗ 走进山里就整个人陷进去 ✓
       现在：Y 跟着地形走 ✗ 落差 1 格时补一个 0.3 秒的小跳跃弧线 ✓
       ★ 用 terYAt 自己算 ✗ 不需要服务器多发一个字段 ✓
         （地形是纯函数 ✗ 两边算出来一样 ✓ 这正是它的好处 ✓）*/
    var _mgy = terYAt(rx, rz);
    if (rm.lastGY === undefined) { rm.lastGY = _mgy; }
    var _rise = _mgy - rm.lastGY;
    /* ★ round323（用户："一直跳动的话僵尸看起来一卡一卡的"）
       ★ 一个可能的原因：这一段"上台阶就跳"的门槛只有 0.05 ✗
         而 _mgy 来自【插值后的坐标】✗ 站在两格高度的交界处会来回抖 ✓
         → 每帧都触发一次小跳跃弧 ✗ 看着就是一卡一卡 ✓
       修：① 门槛提到 0.4（只有真的上了一阶才跳 ✓）
          ② 加 0.5 秒冷却（同一只怪不会连着弹 ✓） */
    if (_rise > 0.4 && !rm.jumpT && (rm.jumpCd || 0) <= 0) {
      rm.jumpCd = 0.5;
      /* ★★★ round310（用户："把妖兽的跳跃动画也做明显一点高一点"）★★★
         上一版弧高只有 0.34 世界单位（≈ 半格）✗ 一跳就过去了 ✗ 根本看不出来 ✓
         现在：基础 0.72 + 台阶高度 × 0.8
              上一格台阶（0.62）→ 弧高 1.22 ≈ 2 格 ✓ 和玩家的观感一致 ✓
         滞空也从 0.3 秒拉到 0.42 秒（看得清 ✗ 而且像"跳"不像"弹" ✓）
         ★ 影子留在【地面】✗ 不跟着飞起来 ✓ 这样高度差一眼就看得出来 ✓ */
      rm.jumpT = 0.001;
      rm.jumpH = 0.72 + Math.min(_rise, TER.LEVEL_H) * 0.8;
    }
    var _jy = _mgy;
    if (rm.critJumpT > 0) {
      rm.critJumpT = Math.max(0, rm.critJumpT - dt);
      _jy += Math.sin((1 - rm.critJumpT / 0.35) * Math.PI) * 0.85;
    }
    if (rm.jumpT) {
      rm.jumpT += dt;
      var _jt = rm.jumpT / 0.42;
      if (_jt >= 1) { rm.jumpT = 0; }
      else { _jy += Math.sin(_jt * Math.PI) * (rm.jumpH || 1.2); }
    }
    if (rm.jumpCd > 0) { rm.jumpCd -= dt; }
    rm.lastGY = _mgy;
    /* ★ 平滑跟随：追得快（dt*22）✗ 几乎看不出延迟 ✓ 但能吃掉所有跳变 ✓ */
    if (rm.g.position.x === 0 && rm.g.position.z === 0) {
      rm.g.position.set(rx, _jy, rz);            // 刚出现：直接落位 ✓
    } else {
      var _k = Math.min(1, dt * 22);
      rm.g.position.x += (rx - rm.g.position.x) * _k;
      rm.g.position.z += (rz - rm.g.position.z) * _k;
      /* ★ round404：被挑飞的怪要升空（抛物线：1.5 秒一个来回 ✓）*/
    if (rm.flyUntil && performance.now() < rm.flyUntil) {
      var _fk2 = (rm.flyUntil - performance.now()) / 1500;   // 1 → 0
      _jy += Math.sin(_fk2 * Math.PI) * (rm.flyH || 3.7);
    }
    rm.g.position.y = _jy;
    }
    rm.g.rotation.y = rm.cur.yaw;
    if (rm.castT > 0) {
      rm.castT = Math.max(0, rm.castT - dt);
      var _ck = 1 - rm.castT / Math.max(0.1, (rm.castDur || 1.0));
      if (rm.hh && rm.hh.body) {
        var _ckey = String(rm.castKey || '');
        var _cst = String(rm.castStyle || 'cast');
        var _amp = /breath|gaze|hook|charge|cannon/.test(_ckey) ? 0.34 : 0.22;
        rm.hh.body.rotation.x = rm.castPhase === 'strike'
          ? 0.26 : (-_amp * Math.sin(_ck * Math.PI));
        rm.hh.body.rotation.z = rm.castPhase === 'strike'
          ? 0.06 : (_cst === 'wave'
            ? Math.sin(_ck * Math.PI * 4) * 0.10 : -0.04 * Math.sin(_ck * Math.PI));
        rm.hh.body.rotation.y = (_cst === 'wave' && rm.castPhase !== 'strike')
          ? Math.sin(_ck * Math.PI * 2) * 0.18 * (1 - _ck) : 0;
      }
      if (rm.hh && rm.hh.armL && rm.hh.armR && rm.castPhase === 'windup') {
        rm.hh.armL.rotation.x = -2.0 - 0.4 * Math.sin(_ck * Math.PI);
        rm.hh.armR.rotation.x = -2.0 - 0.4 * Math.sin(_ck * Math.PI);
      }
    } else if (rm.hh && rm.hh.body) {
      rm.hh.body.rotation.x *= 0.85;
      rm.hh.body.rotation.z *= 0.85;
      rm.hh.body.rotation.y *= 0.85;
    }
    if (rm.shadow) {
      rm.shadow.position.set(rm.g.position.x, _mgy + 0.09, rm.g.position.z);
    }
    /* ★ 第 44 轮：只给 30 米内的僵尸投影 —— 更远的影子在地平线上只有几个像素，看不出来 ✓
       只要状态没变就不重复写 castShadow（写它会让 three.js 重建阴影列表 ✗）*/
    if (rm.hh.casters) {
      var nsh = ((rx - P.x) * (rx - P.x) + (rz - P.z) * (rz - P.z)) < 900;
      if (rm.shN !== nsh) {
        rm.shN = nsh;
        for (var csi = 0; csi < rm.hh.casters.length; csi++) { rm.hh.casters[csi].castShadow = nsh; }
      }
    }
    /* ★★ round426：远处切「静态合并 LOD」（body+四肢 → 1 个网格 ✓）
       ★ 18 米：那儿的摆臂只有 1~2px，停不停看不出 ✓ 但腿必须留着（形状看得出来 ✓）
       ★ 只在【活着】时切：倒地动画要整只转，LOD 也照样转 ✓ 所以不用管 dying ✓
       ★ 用 hh.body / hh.lod 两个引用，不遍历 children（便宜 ✓）*/
    if (rm.hh && rm.hh.body && rm.hh.lod) {
      var _far3 = ((rx - P.x) * (rx - P.x) + (rz - P.z) * (rz - P.z)) > (MOB_LOD_D * MOB_LOD_D);
      if (rm.lodOn !== _far3) {
        rm.lodOn = _far3;
        rm.hh.body.visible = !_far3;
        rm.hh.legL.visible = !_far3; rm.hh.legR.visible = !_far3;
        rm.hh.armL.visible = !_far3; rm.hh.armR.visible = !_far3;
        rm.hh.lod.visible = _far3;
      }
    }
    if (rm.boxDbg) { rm.boxDbg.position.set(rx, 0.1, rz); }   // ★ 碰撞箱线框跟随 ✓

    /* ★★ round433（A3）：远处 / 屏幕外的怪不再每帧算肢体动画 ✗
       ① 18 米外已经切 LOD（四肢根本不画 ✗）→ 算了也没人看 ✓
       ② 屏幕外更不用算 ✓
       ③ 8~​18 米：隔一帧更新（摆臂相位差 33ms 看不出 ✓）
       ★ 位置插值、血条、名牌一律照常 ✗ 只省"肢体摆动”这一块 ✓ */
    var _dd2 = (rx - P.x) * (rx - P.x) + (rz - P.z) * (rz - P.z);
    var _poseSkip = (_dd2 > MOB_LOD_D * MOB_LOD_D) || (rm._offscreen === true)
      || (_dd2 > 64 && (frameNo & 1) && !rm.atkT);
    if (rm.alive && !_poseSkip) {
      // 走路动画（按这一帧真的走了多远 ✓）
      var rspd = Math.hypot(rx - rm.last.x, rz - rm.last.z) / Math.max(dt, 0.0001);
      rm.last.x = rx; rm.last.z = rz;
      if (rspd > 0.35) {
        rm.walkT += dt * (5.0 + Math.min(4.0, rspd * 0.6));
        rm.hh.legL.rotation.x = Math.sin(rm.walkT) * MOB_SWING;
        rm.hh.legR.rotation.x = -Math.sin(rm.walkT) * MOB_SWING;
        rm.hh.armL.rotation.x = -1.35 + Math.sin(rm.walkT) * 0.12;
        rm.hh.armR.rotation.x = -1.35 - Math.sin(rm.walkT) * 0.12;
      } else {
        rm.hh.legL.rotation.x *= 0.9; rm.hh.legR.rotation.x *= 0.9;
        rm.hh.armL.rotation.x = -1.35; rm.hh.armR.rotation.x = -1.35;
      }
      if (rm.hh.beast && rm.hh.body) {
        var _bby = rm.hh.body.userData.baseY;
        if (_bby === undefined) { _bby = rm.hh.body.position.y; rm.hh.body.userData.baseY = _bby; }
        rm.hh.body.position.y = _bby + (rspd > 0.35 ? Math.abs(Math.sin(rm.walkT)) * 0.09 : 0);
        if (!(rm.castT > 0) && rm.atkT < 0) {
          rm.hh.body.rotation.z = Math.sin(rm.walkT || performance.now() / 900) * 0.035;
        }
      }
      if (rm.hh.beastLegs && rm.hh.beastLegs.length) {
        for (var _blg = 0; _blg < rm.hh.beastLegs.length; _blg++) {
          var _ph = _blg % 2 ? Math.PI : 0;
          rm.hh.beastLegs[_blg].rotation.x = Math.sin(rm.walkT + _ph) * 0.34;
        }
      }
      if (rm.hh.wings && rm.hh.wings.length) {
        for (var _bwg = 0; _bwg < rm.hh.wings.length; _bwg++) {
          var _sd = _bwg ? 1 : -1;
          rm.hh.wings[_bwg].rotation.z = _sd * (-0.28 + Math.sin(rm.walkT * 0.55 + _bwg) * 0.10);
        }
      }
      if (rm.hh.serpentSegs && rm.hh.serpentSegs.length) {
        for (var _bsg = 0; _bsg < rm.hh.serpentSegs.length; _bsg++) {
          var _sg = rm.hh.serpentSegs[_bsg];
          var _sph = rm.walkT * 1.6 - _bsg * 0.42;
          _sg.position.x = (_sg.userData.serpX || 0) + Math.sin(_sph) * 0.06 * (_bsg / 17);
          _sg.position.z = (_sg.userData.serpZ || 0) + Math.cos(_sph) * 0.05 * (_bsg / 17);
        }
      }
      if (rm.hh.dragon) {
        var _dg = rm.hh.dragon;
        _dg.t = (_dg.t || 0) + dt;
        if (_dg.speed === undefined) { _dg.speed = 0; }
        var _tgtSpeed = Math.min(1, rspd / 2.2);
        _dg.speed += (_tgtSpeed - _dg.speed) * Math.min(1, dt * 6.5);
        var _dtm = _dg.t;
        // 走路时骨龙躯干固定：不让通用 bob / 施法倾斜 / 呼吸改写身体
        _dg.body.position.set(0, 0, 0);
        _dg.body.rotation.set(0, 0, 0);
        _dg.body.scale.set(1, 1, 1);
        _dg.head.rotation.y = Math.sin(_dtm * 0.42) * 0.18;
        _dg.head.rotation.x = Math.sin(_dtm * 0.8) * 0.035;
        for (var _dt = 0; _dt < _dg.tail.length; _dt++) {
          _dg.tail[_dt].rotation.y = Math.sin(_dtm * 1.45 - _dt * 0.46) * (0.08 + _dg.speed * 0.05);
        }
        if (_dg.wings) {
          var _wEase = Math.min(1, dt * 9);
          for (var _dw = 0; _dw < _dg.wings.length; _dw++) {
            var _W = _dg.wings[_dw];
            var _flap = Math.sin(_dtm * (0.95 + _dg.speed * 0.9));
            var _flap2 = Math.sin(_dtm * (0.95 + _dg.speed * 0.9) + 0.45);
            var _tz = _W.base + _W.side * (_flap * 0.20 + _flap2 * 0.035) * (1 + _dg.speed * 0.35);
            var _ty = _W.baseY + _W.side * _flap * 0.045;
            _W.g.rotation.z += (_tz - _W.g.rotation.z) * _wEase;
            _W.g.rotation.y += (_ty - _W.g.rotation.y) * _wEase;
            _W.g.rotation.x += ((_flap2 * 0.04) - _W.g.rotation.x) * _wEase;
          }
        }
        var _ease = Math.min(1, dt * 11);
        for (var _dgl = 0; _dgl < _dg.legs.length; _dgl++) {
          var _L = _dg.legs[_dgl];
          var _sw = Math.sin(_dtm * 5.8 + _L.phase) * 0.68 * _dg.speed;
          var _kn = Math.max(0, -_sw) * 0.78;
          var _an = -_sw * 0.38;
          _L.hip.rotation.x += (_sw - _L.hip.rotation.x) * _ease;
          _L.knee.rotation.x += (_kn - _L.knee.rotation.x) * _ease;
          _L.ankle.rotation.x += (_an - _L.ankle.rotation.x) * _ease;
        }
      }
      // ★ 攻击动画：直接照服务器给的 atkT 摆姿势 ✓（两边看到的动作一致 ✓）
      if (rm.atkT >= 0) {
        var MT2 = 0.75, MF2 = MT2 / 5;
        var mf2 = Math.min(5, Math.floor(rm.atkT / MF2));
        var mt2 = Math.min(1, (rm.atkT - mf2 * MF2) / MF2);
        var me2 = mt2 < 0.5 ? (2 * mt2 * mt2) : (1 - Math.pow(-2 * mt2 + 2, 2) / 2);
        var MKF2 = [
          [-1.35, 0.00, 0.00, 0.00],
          [-2.45, -0.18, -0.10, -0.10],
          [-2.75, -0.30, -0.20, -0.18],
          [-1.60, 0.25, 0.12, 0.10],
          [-0.45, 0.45, 0.28, 0.26],
          [-1.35, 0.00, 0.00, 0.00]
        ];
        var MA2 = MKF2[mf2], MB2 = MKF2[Math.min(5, mf2 + 1)];
        var ml2 = function (i) { return MA2[i] + (MB2[i] - MA2[i]) * me2; };
        rm.hh.armL.rotation.x = ml2(0); rm.hh.armR.rotation.x = ml2(0);
        rm.hh.armL.rotation.z = -ml2(1); rm.hh.armR.rotation.z = ml2(1);
        rm.g.rotation.x = ml2(2);
        rm.hh.legL.rotation.x = ml2(3) * 0.6; rm.hh.legR.rotation.x = -ml2(3) * 0.6;
        if (rm.hh.beast && rm.hh.body && !rm.hh.dragon) { rm.hh.body.rotation.x = ml2(2) * 0.7; }
      } else {
        rm.g.rotation.x = 0;
        rm.hh.armL.rotation.z = 0; rm.hh.armR.rotation.z = 0;
        if (rm.hh.beast && rm.hh.body && !rm.hh.dragon && !(rm.castT > 0)) { rm.hh.body.rotation.x *= 0.9; }
      }
    } else if (rm.dying >= 0) {
      // ★ 倒地 → 停留 → 淡出（和单人那套时长一致 ✓ 2.4 秒 ✓）
      rm.dying += dt;
      var dk2 = Math.min(1, rm.dying / 0.90);
      var de3 = 1 - Math.pow(1 - dk2, 3);
      rm.g.rotation.x = -de3 * (Math.PI / 2) * 0.95;
      rm.g.position.y = -de3 * 0.35;
      rm.hh.armL.rotation.x = -1.35 + de3 * 1.9;
      rm.hh.armR.rotation.x = -1.35 + de3 * 1.9;
      rm.hh.legL.rotation.x = de3 * 0.6; rm.hh.legR.rotation.x = -de3 * 0.6;
      if (rm.shadow) { rm.shadow.material.opacity = 0.24 * (1 - de3 * 0.6); }
      if (rm.dying > 0.90) {
        rm.dead += dt;
        if (rm.dead > 1.00) { rm.dying = -2; }
      }
    } else if (rm.dying === -2) {
      rm.dead += dt;
      /* ★ 第 44 轮：材质是全场共享的，要淡出必须先给这一只克隆一份 ✗（不然全场一起淡）*/
      if (!rm.faded) { rm.faded = 1; rm.g.traverse(function (o) { if (o.isMesh && o.material) { o.material = o.material.clone(); } }); }
      var fk2 = Math.min(1, (rm.dead - 1.00) / 0.5);
      rm.g.traverse(function (o) { if (o.isMesh && o.material) { o.material.transparent = true; o.material.opacity = 1 - fk2; } });
      if (rm.shadow) { rm.shadow.material.opacity = 0.10 * (1 - fk2); }
    }

    // 头顶名字 + 血条
    if (rm.ui) {
      var pct = Math.max(0, Math.min(100, (rm.hp / (rm.hpMax || 30)) * 100));
      /* ★★ round432：值没变就不写 DOM ✗（每帧 40×5 次 style 写入很贵 ✗）*/
      var _pi = Math.round(pct);
      if (rm._hpi !== _pi) { rm._hpi = _pi; UI.plate.hpWidth(rm.ui, _pi + '%'); }
      if (rm._hpc !== 1) { rm._hpc = 1; UI.plate.hpColor(rm.ui, BAR_MOB); }   // ★ 妖兽一律红 ✓
      var _mp = mobPlate(rm);
      if (rm._mps !== _mp) { rm._mps = _mp; UI.plate.name(rm.ui, _mp); }
      /* ★ 第 89 轮（用户要求）：僵尸的血量数字也放进血条里 ✓（小一号 ✓）*/
      // ★ 第 127 轮：僵尸也只显示剩余量 ✓
      var _bt = String(Math.max(0, Math.round(rm.hp)));
      if (rm._bts !== _bt) { rm._bts = _bt; UI.plate.barText(rm.ui, _bt, '#fff', 10); }
      if (!_ov3) { _ov3 = new THREE.Vector3(); }
      _ov3.set(rx, (rm.g.position.y || 0) + (1.65 + MOB_FEET) * (rm.sk || 1), rz).project(cam);
      var vis2 = rm.alive && (_ov3.z > -1 && _ov3.z < 1 && Math.abs(_ov3.x) < 1.35 && Math.abs(_ov3.y) < 1.5);
      rm._offscreen = !vis2;      /* ★ round433：屏幕外就不算肢体动画了 ✓ */
      UI.plate.show(rm.ui, vis2);
      if (vis2) {
        var sx2 = (_ov3.x * 0.5 + 0.5) * innerWidth;
        var sy2 = (-_ov3.y * 0.5 + 0.5) * innerHeight;
        /* ★★ round432：名牌位置不该每帧都写 ✗
           ① 整数像素没变（怪站着 / 慢走）→ 不写 ✓
           ② 12 米外 → 隔一帧更新一次（16ms 延迟看不出 ✓）*/
        var _mx = sx2 | 0, _my = sy2 | 0;
        var _farP = ((rx - P.x) * (rx - P.x) + (rz - P.z) * (rz - P.z)) > 9;   // ★ 3 米以外隔帧（16ms 看不出 ✓）
        if (_farP && (frameNo & 1)) { _mx = rm._mvx; _my = rm._mvy; }
        if (rm._mvx !== _mx || rm._mvy !== _my) {
          rm._mvx = _mx; rm._mvy = _my;
          UI.plate.move(rm.ui, sx2, sy2);
        }
      }
    }
  }
}

/* ★ 和别的玩家 / 公共妖兽重叠时慢慢推开 ✓（是"推开"不是"顶住" → 不会卡在一起 ✓）*/
function netSeparate(dt) {
  if (!NET.on) { return; }
  var hw = G.BODY_W, hd = G.BODY_D;            // 两个玩家半宽之和 = 刚好接触的临界 ✓
  for (var uid in NET.others) {
    var o = NET.others[uid];
    if (!o || !o.cur) { continue; }
    _netPushOut(o.cur.x, o.cur.z, hw, hd, dt);
  }
  var mhw = G.BODY_W / 2 + G.MOB_W / 2, mhd = G.BODY_D / 2 + G.MOB_D / 2;
  for (var wmid in NET.rmobs) {
    var wm = NET.rmobs[wmid];
    if (!wm || !wm.alive || !wm.cur) { continue; }
    _netPushOut(wm.cur.x, wm.cur.z, mhw, mhd, dt);
  }
}
function _netPushOut(ox, oz, hw, hd, dt) {
  var dx = P.x - ox, dz = P.z - oz;
  var ax = Math.abs(dx), az = Math.abs(dz);
  if (ax >= hw || az >= hd) { return; }        // 没重叠 ✓
  var px2 = hw - ax, pz2 = hd - az;
  var sp = Math.min(1, dt * 10);               // 平滑推开（不是瞬移 ✓）
  if (px2 <= pz2) {                             // 从"需要挪得少"的那一轴推开 → 位移最小最自然 ✓
    var mx = (dx >= 0 ? 1 : -1) * px2 * sp;
    /* ★ 第 56 轮：无敌期间【无视体积碰撞】—— byMob 传 false ✓
       （原来写死 true，僵尸会把玩家挡住 ✗ 复活后被围死跑不掉 ✗）
       ★ 只放行"僵尸碰撞"这一层 ✓ 建筑/树照旧挡着 ✓（不然会穿墙 ✗）*/
    if (!blocked(P.x + mx, P.z, G.BODY_W / 2, G.BODY_D / 2, !(INVULN_T > 0), null, P.x, P.z)) { P.x += mx; }
  } else {
    var mz = (dz >= 0 ? 1 : -1) * pz2 * sp;
    if (!blocked(P.x, P.z + mz, G.BODY_W / 2, G.BODY_D / 2, !(INVULN_T > 0), null, P.x, P.z)) { P.z += mz; }
  }
}

/* ★ 给妖兽结算一次伤害（自己砍 ✓ 别人打我的妖兽 ✓ 走同一套 → 不会两套逻辑打架 ✓）
   fromX,fromZ = 攻击者位置（用来算击退方向 ✓）*/
function hurtMob(m, dv, fromX, fromZ, crit, quiet) {
  var fxYaw = Math.atan2(m.g.position.x - fromX, m.g.position.z - fromZ);
  m.hp -= dv;
  if (!quiet) {                          // ★ quiet：一刀砍到多只时，音效由调用方只出一次 ✓
    sfx(crit ? 'crit' : 'hit', 1.0);     // ★ MC 命中/暴击声 ✓
    sfx('zhurt', 0.7);                   // ★ 僵尸受击声（被砍 ✓）
  }
  // ★ 渐进击退（不是瞬移 ✗）：设定初速度 ✓ 每帧衰减 ✓ 0.18 秒内平滑推开 ✓
  m.kbx = Math.sin(fxYaw) * (crit ? 6.5 : 4.2);     // 击退初速度（暴击更远 ✓）
  m.kbz = Math.cos(fxYaw) * (crit ? 6.5 : 4.2);
  m.kbT = 0.18;                                      // 持续时间
  m.kbUp = crit ? 0.30 : 0.18;                       // 上抬幅度（被打飞感 ✓）
  shake = crit ? 0.45 : 0.22;
  /* ★ round429：暴击顿帧 0.08 → 0.11（更明显的定格 ✓）、镜头推近 + FOV 收紧 ✓ */
  hitStop = crit ? 0.11 : 0.04;

  dmg(String(dv) + (crit ? ' 暴击' : ''), m.g.position.x, 2.4, m.g.position.z, crit);
  if (m.hp <= 0) {
    // ★ 死亡动画：先倒地（0.55 秒 ✓）→ 停留 0.35 秒 → 淡出 0.4 秒 → 移除 ✓
    m.alive = false; m.dying = 0; m.dead = 0;
    UI.plate.show(m.ui, false);   // ★ 隐藏头顶 UI ✓
    sfx('zdeath', 1.0);   // ★ MC 僵尸死亡声 ✓
    dmg('击败', m.g.position.x, 3.0, m.g.position.z, true);
  }
}

/* ★ 玩家挥剑动画（4 段 8 帧 · 总 0.86 秒 ✓）
   ★ 本地玩家和其他玩家共用这一套 → 别人看到的动作和你自己看到的一模一样 ✓
   heroObj = H 或 o.hh ✓ atkT = 已经播了多久 ✓ (bx,bz,byaw) = 身体基准位置/朝向 ✓
   返回 true = 还在播（调用方继续累加 atkT）✓ false = 该收尾了 ✓ */
/* ============================================================
   ★★ 第 61 轮：三套挥砍动作（劈 / 扫 / 刺）★★
   【符号约定】（沿用原注释里踩过坑的那套，别改 ✗）
     手臂/腿朝 -Y（往下长）→ 负的 rotation.x = 往前，正 = 往后
     剑刃朝 +Y（往上长） → 正的 rotation.x = 往前，负 = 往后
       · swordX = +1.57 ≈ 剑水平朝前 ✓   -1.57 ≈ 朝后 ✓
       · swordX ≈ -3.14 ≈ 剑朝下（劈到底 ✓）  0 = 朝上 ✓
     躯干 g.rotation.x：正 = 前倾，负 = 后仰；g.rotation.y 的第 5 通道 = 转体
   【通道】[armR.x, armR.y, armR.z, swordX, torsoX, bodyY, armL.x, legL.x, legR.x, step, rise]
   ============================================================ */

// 劈：抬手过顶 → 下砸 → 收招慢（斧、锤）
var KF_CHOP = [
  [ 0.00,  0.00,  0.15,  0.55,  0.00,  0.00, -0.15,  0.00,  0.00,  0.00,  0.00],
  [ 2.85,  0.10,  0.14, -3.19, -0.10,  0.12, -0.55, -0.18,  0.18, -0.04, -0.06],
  [-0.85, -0.10,  0.12, -3.23,  0.16, -0.18,  0.45, -0.22,  0.22,  0.10,  0.02],
  [-0.93, -0.12,  0.12, -3.00,  0.18, -0.20,  0.50, -0.24,  0.24,  0.11,  0.01],
  [ 0.00,  0.00,  0.15, -5.73,  0.00,  0.00, -0.15,  0.00,  0.00,  0.00,  0.00]
];
// 扫：身体带着转、剑横着划过去（单手剑、刀、长棍）
var KF_SWEEP = [
  [ 0.00,  0.00,  0.15,  0.55,  0.00,  0.00, -0.15,  0.00,  0.00,  0.00,  0.00],
  [ 1.30, -0.55, -0.30, -1.60, -0.05, -0.55, -0.45, -0.10,  0.10, -0.03,  0.00],
  [-0.75,  0.85,  0.35, -1.45,  0.10,  0.75,  0.55, -0.16,  0.16,  0.06,  0.01],
  [-0.80,  1.00,  0.38, -1.40,  0.12,  0.85,  0.60, -0.18,  0.18,  0.07,  0.00],
  [ 0.00,  0.00,  0.15, -3.14,  0.00,  0.00, -0.15,  0.00,  0.00,  0.00,  0.00]
];
// 刺：收手 → 直刺 → 秒收（匕首、长枪）★ 最快的一套
var KF_THRUST = [
  [ 0.00,  0.00,  0.15,  0.55,  0.00,  0.00, -0.15,  0.00,  0.00,  0.00,  0.00],
  [ 0.95, -0.30,  0.10,  1.30, -0.05, -0.20, -0.30, -0.08,  0.08, -0.05,  0.00],
  [-1.45,  0.05,  0.05,  1.62,  0.12,  0.08,  0.35, -0.16,  0.16,  0.24,  0.00],
  [-1.52,  0.06,  0.05,  1.58,  0.14,  0.10,  0.38, -0.18,  0.18,  0.25,  0.00],
  [ 0.00,  0.00,  0.15,  0.55,  0.00,  0.00, -0.15,  0.00,  0.00,  0.00,  0.00]
];

/* 武器类型 → 动作原型
   ★ 这是一张【数据表】✓ 以后加武器只加一行、不用改代码 ✓ */
// 拉弓：举弓 → 拉满 → 撒放（手弹出去）→ 收回（第 70 轮 用户要求 ✓）
var KF_DRAW = [
  [ 0.00,  0.00,  0.15,  0.55,  0.00,  0.00, -0.15,  0.00,  0.00,  0.00,  0.00],
  [ 1.35,  0.10,  0.30,  0.20, -0.06, -0.10, -1.25, -0.06,  0.06, -0.02,  0.00],
  [ 1.10,  0.04,  0.26,  0.10,  0.02, -0.06, -1.05, -0.04,  0.04,  0.00,  0.00],
  [-0.15, -0.10,  0.18,  0.30,  0.08,  0.02, -0.55, -0.10,  0.10,  0.04,  0.00],
  [ 0.00,  0.00,  0.15,  0.55,  0.00,  0.00, -0.15,  0.00,  0.00,  0.00,  0.00]
];
var ATK_ARCH = {
  axe: 'chop', hammer: 'chop',
  sword: 'stab2',                    // ★ round374：单手剑 = 快速前刺两下 ✓
  saber: 'chop',                    // ★ round396：弯刀从上往下砍 ✓
  staff: 'chop',                    // ★ round393：长棍从上往下敲 ✓
  dagger: 'thrust', spear: 'thrust',
  bow: 'draw'                // ★ 第 70 轮：弓有自己的“拉弓”了 ✓
};
/* ★★★ round374（用户："单手剑改成往前面快速刺两下"）★★★
   ★ 列的含义（和 KF_THRUST 一致 ✓）：
     0 armR.x · 1 armR.y · 2 armR.z · 3 剑的俯仰 · 4 身体前倾
     5 额外偏航 · 6 左臂 · 7 左腿 · 8 右腿 · 9 前冲距离 · 10 高度
   ★ 6 帧 = 起手 → 刺1出 → 收回 → 刺2出 → 收回 → 回位 ✓
     （第二下比第一下【更深一点】✗ 看着有节奏 ✓）*/
var KF_STAB2 = [
  [ 0.00,  0.00,  0.15,  0.55,  0.00,  0.00, -0.15,  0.00,  0.00,  0.00,  0.00],  // 起手
  [ 0.88, -0.28,  0.10,  1.22, -0.05, -0.16, -0.28, -0.07,  0.07, -0.04,  0.00],  // 蓄力（很浅 ✗ 要快）
  [-1.40,  0.04,  0.05,  1.58,  0.11,  0.06,  0.32, -0.15,  0.15,  0.20,  0.00],  // 刺1 —— 出
  [-0.10, -0.06,  0.12,  0.95,  0.02,  0.00, -0.05, -0.04,  0.04,  0.02,  0.00],  // 收回
  [-1.50,  0.06,  0.05,  1.66,  0.14,  0.09,  0.38, -0.18,  0.18,  0.26,  0.00],  // 刺2 —— 更深
  [ 0.00,  0.00,  0.15,  0.55,  0.00,  0.00, -0.15,  0.00,  0.00,  0.00,  0.00]   // 回位
];

/* ★★★ round376（用户："斧头改成左劈一下，下次攻击变成右劈一下"）★★★
   ★ 不手写第二套关键帧 ✗ 直接把第一套【镜像】过来 ✓
     镜像规则：累加在"左右"上的三个通道取反 + 左右腿互换
       1 = armR.y（手臂左右摆）· 2 = armR.z（手臂内外张）· 5 = 身体扭转
       7/8 = 左右腿（互换）
   ★ 为什么程序化：手抄 22 个数字必然打错一个 ✗ 而且改一处要改两处 ✓ */
var KF_CHOP_R = KF_CHOP.map(function (row) {
  var r = row.slice();
  r[1] = -r[1]; r[2] = -r[2]; r[5] = -r[5];
  var t = r[7]; r[7] = r[8]; r[8] = t;
  return r;
});

/* ★ round386（用户："匕首第一下左手丢出去，像弓箭一样射出去"）
   列：0 右臂x · 1 右臂y · 2 右臂z · 3 武器俯仰 · 4 身体前倾
      5 额外偏航 · 6 左臂x · 7 左腿 · 8 右腿 · 9 前冲 · 10 高度
   ★ 投掷的要点：右臂保持收回（不参与）✗ 左臂从后往前甩 ✓ */
var KF_THROW = [
  [ 0.30,  0.00,  0.15,  0.55,  0.00,  0.00, -0.15,  0.00,  0.00,  0.00,  0.00],  // 起手
  [ 0.55,  0.12,  0.14,  0.60, -0.06,  0.10,  0.75, -0.10,  0.10, -0.03,  0.00],  // 左臂后拉
  [-0.35, -0.08,  0.12,  0.40,  0.13, -0.09, -1.70, -0.16,  0.16,  0.12,  0.02],  // 甩出去
  [-0.32, -0.06,  0.12,  0.42,  0.11, -0.07, -1.50, -0.14,  0.14,  0.10,  0.02],  // 收势
  [ 0.30,  0.00,  0.15,  0.55,  0.00,  0.00, -0.15,  0.00,  0.00,  0.00,  0.00]   // 回位
];

/* ★ round390（用户："两次攻击作为一次，分成两段"）
   ★ 一次挥砍里做两件事：先左臂把刀甩出去 ✗ 再右臂近身刺 ✓
   ★ 6 帧 / 5 段：起手 → 左臂后拉 → 甩出 → 右臂抬起 → 刺出 → 回位 */
var KF_DAG = [
  [ 0.00,  0.00,  0.15,  0.55,  0.00,  0.00, -0.15,  0.00,  0.00,  0.00,  0.00],
  [ 0.25,  0.10,  0.14,  0.58, -0.04,  0.08,  0.72, -0.08,  0.08, -0.02,  0.00],
  [-0.15, -0.06,  0.12,  0.45,  0.10, -0.07, -1.68, -0.14,  0.14,  0.10,  0.02],
  [ 1.10,  0.06,  0.12,  1.20, -0.06,  0.05, -0.55, -0.10,  0.10, -0.02,  0.00],
  [-1.45,  0.04,  0.05,  1.60,  0.12,  0.06, -0.25, -0.16,  0.16,  0.24,  0.00],
  [ 0.00,  0.00,  0.15,  0.55,  0.00,  0.00, -0.15,  0.00,  0.00,  0.00,  0.00]
];

var ATK_KF = { chop: KF_CHOP, sweep: KF_SWEEP, thrust: KF_THRUST, draw: KF_DRAW,
               stab2: KF_STAB2, throw: KF_THROW, dag: KF_DAG };
// 各自的节奏：劈最慢（收招重 ✓）· 扫居中 · 刺最快（秒收 ✓）
var ATK_T = {
  chop:   [0.26, 0.43, 0.52, 0.86],
  sweep:  [0.20, 0.36, 0.46, 0.78],
  thrust: [0.14, 0.24, 0.30, 0.58],
  draw:   [0.22, 0.42, 0.52, 0.90],    // ★ 拉弓要慢一点（举弓 → 拉满 → 撒放 ✓）
  /* ★ 6 帧 / 5 段：0.09 蓄力 · 0.18 刺1 · 0.27 收 · 0.36 刺2 · 0.62 回位
     ★ 两下的"出手时刻"间隔 ≈ 0.18 秒 ✗ 手速感明确 ✓ 但又分得清是两下 ✓ */
  stab2:  [0.09, 0.18, 0.27, 0.36, 0.62],
  throw:  [0.16, 0.30, 0.40, 0.62],    /* 甩出去快 ✗ 收势稍慢 */
  dag:    [0.10, 0.22, 0.34, 0.48, 0.80]
};

function atkArchOf(look) { return ATK_ARCH[look] || 'sweep'; }

function heroAtkPose(heroObj, atkT, bx, bz, byaw, look, baseY, side) {
  /* ★★★ round307 修的真 bug（用户："玩家攻击的时候会穿模，会掉落到方块下面去"）★★★
     根因：下面那句 `position.y = lp(10)` 用的是【关键帧里的绝对 Y】✗
           而关键帧是按"站在 y=0 的平地上"调的 ✓
           → 一按攻击 ✗ 高度被冲回 ≈0 ✗ 站在山上的玩家瞬间掉到方块下面 ✓
     修：关键帧的 y 当成【相对地面的偏移】✗ 加上 baseY ✓
     ★ 别的玩家也一样 ✗ 他们站在山上攻击时也会陷进去 ✓ 一起修了 ✓ */
  if (baseY === undefined) { baseY = 0; }
  var arch = atkArchOf(look);
  /* ★ 斧头左右交替：side 为奇数时用镜像那套 ✓
     ★ 只对【斧】生效 ✗ 锤子还是同一个方向（它下一轮才改）✓ */
  var _sideN = ((Math.abs(side | 0)) % 2);
  /* ★ round386：匕首的双持交替 —— 奇数刀是"左手投掷"，偶数刀是"右手刺"
     ★ 用和服务端【同一个计数器】的奇偶 ✓ 两边不会错位 ✓ */
  var _ttKey = arch;
  var KF;
  if (look === 'axe' && _sideN === 1) {
    KF = KF_CHOP_R;
  } else if (look === 'dagger') {
    KF = ATK_KF.dag; _ttKey = 'dag';   /* ★ 每次都是"扔+刺"两段 ✓ */
  } else {
    KF = ATK_KF[arch];
  }
  var TT = ATK_T[_ttKey];
  var TOTAL = TT[TT.length - 1];
  /* ★★★ round374：帧数改成【通用】（原来写死 5 帧 / 4 段 ✗）
     ★ 为什么要改：用户要"单手剑刺两下"✗ 那是 6 帧 ✓
       而 axe/hammer 的左右交替、锤子转圈 也都需要更多帧 ✓
     ★ 兼容：现有 chop/sweep/thrust/draw 都是 5 帧 ✗ 走同一条路径 ✓
       段数 = 帧数 − 1 ✗ 缓动按"第一段 ease-in、最后一段 ease-in-out、
       中间交替"分配 ✓ 和原来的手感完全一致 ✓ */
  var _nSeg = KF.length - 1;
  var f, e, _t0 = 0;
  f = _nSeg - 1;                       // 默认落最后一段
  e = 1;
  for (var _si = 0; _si < _nSeg; _si++) {
    var _tb = TT[_si];
    if (atkT < _tb) {
      f = _si;
      e = (_tb > _t0) ? (atkT - _t0) / (_tb - _t0) : 1;
      break;
    }
    _t0 = _tb;
  }
  if (atkT >= TOTAL) { f = _nSeg - 1; e = 1; }
  var ee;
  if (f === 0) { ee = e * e; }
  else if (f === _nSeg - 1) { ee = e < 0.5 ? (2 * e * e) : (1 - Math.pow(-2 * e + 2, 2) / 2); }
  else if ((f % 2) === 1) { ee = 1 - Math.pow(1 - e, 3); }
  else { ee = e; }
  var A = KF[f], B = KF[f + 1];
  var lp = function (i) { return A[i] + (B[i] - A[i]) * ee; };
  /* ★ round377（用户："左右的幅度不够大，看不出来"）
     ★ 侧向的三个通道（手臂左右/手臂张角/身体扭转）普遍只有 ±0.1~0.2 弧度
       ≈ 6~11 度 ✗ 屏幕上根本看不出"左劈"还是"右劈"✓
     ★ 斧头单独放大 2.6 倍 ✗ 其它武器不动 ✓（免得影响已有手感 ✓）*/
  var _latK = (look === 'axe') ? 3.6 : 1.0;   /* round378: 2.6 -> 3.6 */
  heroObj.armR.rotation.x = lp(0);
  heroObj.armR.rotation.y = lp(1) * _latK;
  heroObj.armR.rotation.z = lp(2) * _latK;
  if (heroObj.sw) { heroObj.sw.rotation.x = lp(3); }
  heroObj.g.rotation.x = lp(4);
  heroObj.g.rotation.y = byaw + lp(5) * _latK;
  /* ★ round377（用户："名字叫双手斧，应该是两个手握着"）
     ★ 现在左手有自己的通道（lp(6)）✗ 和右手完全不同步 ✗ 看着像单手挥 ✓
     ★ 斧/锤：左手【跟着右手抬】+ 往中线收 ✓ 就是两手握同一把柄 ✓
       （只看 x/z 两个通道 ✗ 关键帧里没有左臂的 y，做不出更细的握法 ✓）*/
  if (look === 'axe' || look === 'hammer') {
    heroObj.armL.rotation.x = lp(0) * 0.82 + 0.10;
    heroObj.armL.rotation.z = 0.34;
  } else {
    heroObj.armL.rotation.x = lp(6);
    heroObj.armL.rotation.z = 0;
  }
  heroObj.legL.rotation.x = lp(7);
  heroObj.legR.rotation.x = lp(8);
  heroObj.g.position.x = bx + Math.sin(byaw) * lp(9);
  heroObj.g.position.z = bz + Math.cos(byaw) * lp(9);
  heroObj.g.position.y = baseY + lp(10);
  /* ★★ 第 72 轮 用户报："拉弓的动作一点也不像，另一个手都没有拉弓的动作" ★★
     病根：关键帧表只有 armL.rotation.x 一个左手通道 ✗
           只绕 X 转 = 手在【身前上下抡】✗ 做不出"把弦拉到脸侧"这个动作 ✗
     修：拉弓这套单独给左手补 y / z 通道 ✓
         抬手（x 往前上）→ 收到身体中线（z）→ 拉满 → 撒放往外弹 → 收回 ✓ */
  if (arch === 'draw') {
    var LK = [[0.00, 0.00], [-1.20, 0.95], [-1.45, 1.15], [-0.35, 0.35], [0.00, 0.00]];
    var lx = LK[f][0] + (LK[f + 1][0] - LK[f][0]) * ee;
    var lz = LK[f][1] + (LK[f + 1][1] - LK[f][1]) * ee;
    heroObj.armL.rotation.x = lx;
    heroObj.armL.rotation.z = lz;          // ★ 往身体中线收（这就是"拉弦"的样子 ✓）
    heroObj.armL.rotation.y = -lz * 0.35;  // ★ 略往前合一点 ✓
  }
  if (atkT >= TOTAL) { return false; }
  return true;
}

/* ★★★ round427：武器拖影（用户要的"打击感"里唯一还缺的一条）★★★
   ★ 现状：挥砍动作本身有（四阶段关键帧 ✓）、顿帧有（hitStop ✓）、震屏有（shake ✓）
     —— 但刀过的地方【什么都没有】✗ 看着"软" ✓
   ★ 做法：把刀尖最近 12 帧的世界坐标连成一条带子（三角带 + 加法混合）
     旧的一端颜色压暗 → 自然淡出 ✗ 不需要每帧改 opacity（那是每帧重建材质 ✓ 贵 ✓）
   ★ 成本：一次绘制 + 每帧 12 个点 ✗ 可以忽略 ✓
   ★ 会不会改变玩法：不会（纯视觉，不参与任何判定 ✓）*/
var TRAIL_N = 96;
/* ★★ round428：从"只有自己有"改成"每个玩家一条" ✗
   TRAILS[id] = 拖影对象（id 用户的 uid，自己用 'me' ✓）
   TRAIL 仍然指向自己那条 ✗ 旧代码/测试不用改 ✓ */
var TRAILS = {};
var TRAIL = null;   /* ★ 指向自己那条（trailOf 定义完就赋值 ✓）*/
var TRAIL_MAX_OTHERS = 4;      // 别人最多同时 4 条（超了收回最久没用的 ✓）

function trailOf(id) {
  var t = TRAILS[id];
  if (t) { return t; }
  t = TRAILS[id] = { id: id, mesh: null, pts: [], ts: [], len: 0, life: 0, on: false,
                     geom: null, colAttr: null, r: 1.0, g: 0.88, b: 0.38, tier: 0, at: 0 };
  return t;
}
TRAIL = trailOf('me');
/* ★ 尾巴多久（秒）✗ 这个数才是"拖影多长"的真正参数 ✓ */
var TRAIL_AGE = 0.32;
var _tv1 = null, _tv2 = null, _tv3 = null, _tv4 = null;
var _tipV = null;

function trailMake(TRAIL) {
  if (TRAIL.mesh) { return; }
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 2 * 3), 3));
  /* ★ RGBA 四通道 ✗ three 看到 itemSize=4 就会启用逐顶点 alpha ✓ */
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 2 * 4), 4));
  var idx = [];
  for (var i = 0; i < TRAIL_N - 1; i++) {
    var a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  g.setIndex(idx);
  /* ★★ ★ round427g：普通透明混合（不用加法）
     加法会把 R/G/B 三个通道一起拉满 → 红刀光也变白 ✗
     普通混合只把颜色按 alpha 盖上去 → 品阶色就是品阶色 ✓ */
  var m = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 1,
    depthWrite: false, side: THREE.DoubleSide, blending: THREE.NormalBlending
  });
  TRAIL.mesh = new THREE.Mesh(g, m);
  TRAIL.mesh.frustumCulled = false;
  TRAIL.mesh.visible = false;
  TRAIL.mesh.renderOrder = 5;
  scene.add(TRAIL.mesh);
  TRAIL.geom = g;
  TRAIL.colAttr = g.attributes.color;
}

/* 开一次拖影（挥砍开始 / 每次命中都重来 ✓）*/
function trailColorOf(tier) {
  var t = Math.max(0, Math.min(11, tier | 0));
  var hex = (typeof LOOT_COL !== 'undefined' && LOOT_COL[t]) || 0xffd83d;
  /* ★ 品阶越高→刀光越亮 ✗ 但颜色不变 ✓（否则 0 阶的灰在加法混合下看不见 ✗）*/
  var k = 0.92 + 0.008 * t;
  return [((hex >> 16) & 255) / 255 * k, ((hex >> 8) & 255) / 255 * k, (hex & 255) / 255 * k, t];
}

function trailStart(id, len, tier) {
  var TRAIL = trailOf(id);
  /* ★ 别人最多同时 4 条 ✗ 十几个人一起挥会多出十几次绘制 ✓ */
  if (id !== 'me') {
    var _live = [], _k2;
    for (_k2 in TRAILS) {
      if (_k2 === 'me' || !TRAILS[_k2].on) { continue; }
      _live.push(TRAILS[_k2]);
    }
    if (_live.length >= TRAIL_MAX_OTHERS) {
      _live.sort(function (a, b) { return a.at - b.at; });
      while (_live.length >= TRAIL_MAX_OTHERS) {
        var _old = _live.shift();
        _old.on = false;
        if (_old.mesh) { _old.mesh.visible = false; }
      }
    }
  }

  trailMake(TRAIL);
  TRAIL.at = performance.now();
  /* ★ 向量必须在这里就建好 ✗ 不然第一帧 weaponTipWorld(_tipV) 拿到 null → 报错 → 拖影一直是空的 ✗✗
     （这个错被 try/catch 吞掉就是「开了但什么都没有」✓ 靖量到了 ✓）*/
  if (!_tv1) {
    _tv1 = new THREE.Vector3(); _tv2 = new THREE.Vector3();
    _tv3 = new THREE.Vector3(); _tv4 = new THREE.Vector3(); _tipV = new THREE.Vector3();
  }
  TRAIL.on = true;
  TRAIL.life = 0.30;
  TRAIL.len = len || 1.15;
  var _c = trailColorOf(tier || 0);
  TRAIL.r = _c[0]; TRAIL.g = _c[1]; TRAIL.b = _c[2]; TRAIL.tier = _c[3];
  TRAIL.pts.length = 0;
  TRAIL.ts.length = 0;
}

/* 每帧喂一个刀尖世界坐标（不存在就一直用上一个点 ✓ 带子不会断 ✓）*/
function trailTick(id, tip) {
  var TRAIL = TRAILS[id];
  if (!TRAIL || !TRAIL.on || !tip) { return; }
  if (!_tv1) { _tv1 = new THREE.Vector3(); _tv2 = new THREE.Vector3();
    _tv3 = new THREE.Vector3(); _tv4 = new THREE.Vector3(); _tipV = new THREE.Vector3(); }
  /* ★★ round427b（用户："有一点点跟不上武器挥动的速度"）★★
     根因：每帧只记 1 个点 ✗ 而挥砍很快（0.15 秒扫 180°）
           60fps 下整个弧只有 7 个点 → 带子是折线 → 看着"切角"✗像跟不上 ✓
     修：两个采样点之间【按距离插补中间点】（每 6cm 一个 ✗ 上限 4 个）→ 带子贴着刀尖的真实轨迹 ✓ */
  var _maxStep = 0.03, _maxFill = 8;
  var _now = performance.now() / 1000;
  if (TRAIL.pts.length) {
    var _last = TRAIL.pts[0];
    var _d = Math.sqrt(_last.distanceToSquared(tip));
    if (_d < 0.006 && (TRAIL.ts[0] || 0) > _now - 0.02) { return; }   // 几乎没动 → 不记 ✓
    var _k = Math.min(_maxFill, Math.max(0, Math.ceil(_d / _maxStep) - 1));
    var _lastTs = TRAIL.ts[0] || _now;
    for (var _ii = _k; _ii >= 1; _ii--) {
      var _t2 = _ii / (_k + 1);
      TRAIL.pts.unshift(new THREE.Vector3(
        _last.x + (tip.x - _last.x) * _t2,
        _last.y + (tip.y - _last.y) * _t2,
        _last.z + (tip.z - _last.z) * _t2));
      /* ★★ round427f（用户："看起来像是一段一段的"）★★
         根因：同一帧里补出来的中间点【时间戳全相同】✗
               而颜色是按"多老"算的 → 颜色按帧跳变 → 一道一道的条纹 ✗
         修：中间点的时间戳按【插值】算（上一帧的时间 → 这一帧的时间）→ 颜色连续了 ✓ */
      TRAIL.ts.unshift(_lastTs + (_now - _lastTs) * _t2);
    }
  }
  TRAIL.pts.unshift(_tv1.copy(tip).clone());
  TRAIL.ts.unshift(_now);
  /* ★ 两道限制：最多 64 个点 + 只保留 TRAIL_AGE 秒内的 ✓ */
  while (TRAIL.pts.length > TRAIL_N) { TRAIL.pts.pop(); TRAIL.ts.pop(); }
  while (TRAIL.ts.length && (_now - TRAIL.ts[TRAIL.ts.length - 1]) > TRAIL_AGE) {
    TRAIL.pts.pop(); TRAIL.ts.pop();
  }
  var n = TRAIL.pts.length;
  if (n < 2) { TRAIL.mesh.visible = false; return; }
  /* 带子宽度：朝屏幕上"横向"的那一小段 ✗ 用 (段方向 × 指向相机) 叉出来 ✓
     ★ 不用屏幕空间投影（那条路要每帧算矩阵 ✗ 而且手机上有抖动 ✓）*/
  var pos = TRAIL.geom.attributes.position.array;
  var col = TRAIL.colAttr.array;
  var w = 0.018 * (TRAIL.len / 1.15);
  var camPos = cam.position;
  /* ★★ round427e：带子的侧向不能突然翻转（否则三角面叠在一起 → 尾巴上看到锯齿 ✗）
     修：① 方向用【中心差分】（后一点 - 前一点，比单段平滑 ✓）
          ② 侧向逐点传递：和上一个侧向反了就取反 ✓ */
  var _prevSide = null;
  for (var i = 0; i < TRAIL_N; i++) {
    var p = TRAIL.pts[Math.min(i, n - 1)];
    var q = TRAIL.pts[Math.min(i + 1, n - 1)];
    var rr = TRAIL.pts[Math.min(Math.max(0, i - 1), n - 1)];
    _tv2.copy(rr).sub(q);
    if (_tv2.lengthSq() < 1e-8) { _tv2.copy(q).sub(p); }
    if (_tv2.lengthSq() < 1e-8) { _tv2.set(0, 0.0001, 0); }
    _tv2.normalize();
    /* 指向相机的方向（用点减相机，不归一化也能叉 ✗ 但归一化更稳 ✓）*/
    _tv4.copy(p).sub(camPos).normalize();
    _tv3.copy(_tv2).cross(_tv4);
    if (_tv3.lengthSq() < 1e-8) { _tv3.set(0, 1, 0); }
    _tv3.normalize();
    if (_prevSide && _tv3.dot(_prevSide) < 0) { _tv3.negate(); }
    if (!_prevSide) { _prevSide = new THREE.Vector3(); }
    _prevSide.copy(_tv3);
    /* ★ 形状：中间最宽、两头略收 ✗ 像一道弧形刀光 ✓ */
    var _tt = i / Math.max(1, n - 1);
    var _wf = 0.55 + 0.45 * Math.sin(Math.PI * _tt);
    _tv3.multiplyScalar(w * _wf);
    var k = i * 6;
    pos[k] = p.x + _tv3.x; pos[k + 1] = p.y + _tv3.y; pos[k + 2] = p.z + _tv3.z;
    pos[k + 3] = p.x - _tv3.x; pos[k + 4] = p.y - _tv3.y; pos[k + 5] = p.z - _tv3.z;
    /* ★ ★ 颜色按【这个点多老】衰减（不再按序号 ✗）
       —— 这就是"挥得快，尾巴自然更长"的原因 ✓ */
    var _age = _now - (TRAIL.ts[i] || _now);
    var f = Math.max(0, 1 - _age / TRAIL_AGE);
    /* ★ 透明度由【多老】决定（老的淡 → 0），中间再乘一层轻微的宽度渐变 ✓ */
    var a = Math.pow(f, 1.35) * 0.85 * Math.min(1, TRAIL.life / 0.15);
    /* ★ 颜色 = 品阶本色 ✗ 不乘透明度（乘了就变成"发黑的颜色 + alpha"✗）✓ */
    var k4 = i * 8;
    col[k4] = TRAIL.r; col[k4 + 1] = TRAIL.g; col[k4 + 2] = TRAIL.b; col[k4 + 3] = a;
    col[k4 + 4] = TRAIL.r; col[k4 + 5] = TRAIL.g; col[k4 + 6] = TRAIL.b; col[k4 + 7] = a;
  }
  /* 只画真实存在的段：不然剩下的索引都指向最后一个点，退化四边形会在尾巴上留白斑 */
  TRAIL.geom.setDrawRange(0, Math.max(0, (n - 1) * 6));
  TRAIL.geom.attributes.position.needsUpdate = true;
  TRAIL.colAttr.needsUpdate = true;
  TRAIL.mesh.visible = true;
}

/* 拖影衰减（每帧调 ✓ 结束就藏起来）*/
function trailFade(id, dt, attacking) {
  var TRAIL = TRAILS[id];
  if (!TRAIL || !TRAIL.on) { return; }
  TRAIL.at = performance.now();
  /* ★ 正在挥砍 = 一直维持（✗ 不能用固定寿命：拖影会在半途消失 ✗）
     收招（atkT < 0）以后才开始 0.22 秒的淡出 ✓ */
  if (attacking) { TRAIL.life = 0.45; return; }
  TRAIL.life -= dt;
  if (TRAIL.life <= 0) {
    TRAIL.on = false;
    TRAIL.pts.length = 0;
    if (TRAIL.mesh) { TRAIL.mesh.visible = false; }
  }
}

/* ★★ round427 修（用户："为什么武器头没有而是在尾部"）★★
   根因：武器几何是【刀身朝 +Y】（剑刃 y=0.52 / 1.05，刀尖 ~1.27）✗
        手柄在 −Y（护手在 0.19 → 尾珠 -0.20/-0.34）✓
        我取了 (0, -L, 0) → 拖影画在手柄那头 ✗
   修：刀尖 = 所有部件里【最大的 y + 半高】（直接从部件表算 ✗ 不用手写长度 ✓）*/
var TIP_LEN = {};
function weaponTipLen(look) {
  var key = look || 'sword';
  if (TIP_LEN[key] > 0) { return TIP_LEN[key]; }
  var parts = weaponPartsOf(key, 0) || [];
  var m = 0.8;
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    var top = (p[5] || 0) + (p[1] || 0) * 0.5;
    if (top > m) { m = top; }
  }
  TIP_LEN[key] = m;
  return m;
}

/* ★ 任意一把武器 Group 的刀尖（给别人用 ✗ 不能只看 H.sw ✓） */
function weaponTipOf(sw, look, out) {
  if (!sw || !sw.children || !sw.children.length) { return null; }
  sw.updateWorldMatrix(true, false);
  out.set(0, weaponTipLen(look || 'sword'), 0).applyMatrix4(sw.matrixWorld);
  return out;
}

function weaponTipWorld(out) {
  if (!H || !H.sw) { return null; }
  /* ★★ 没拿武器就不要拖影 ✗✗
     上一版漏了这个判断：新号身上没有武器 → sw 里一个子节点都没有 ✗
     但算出来的"刀尖"仍在 1.5 米外 → 拖影漂在空中 ✗ 看着就是位置不对 ✓ */
  if (!H.sw.children || !H.sw.children.length) { return null; }
  var look = (MY_WEAPON && MY_WEAPON.look) || 'sword';
  var L = weaponTipLen(look);
  H.sw.updateWorldMatrix(true, false);
  /* ★ 刀尖在 +Y（和几何一致 ✓）*/
  out.set(0, L, 0).applyMatrix4(H.sw.matrixWorld);
  return out;
}


function heroAtkReset(heroObj, bx, bz, byaw) {
  heroObj.armR.rotation.set(0, 0, 0);
  if (heroObj.sw) { heroObj.sw.rotation.x = 0.55; heroObj.sw.rotation.z = 0.10; }
  heroObj.armL.rotation.x = 0;
  heroObj.legL.rotation.x = 0; heroObj.legR.rotation.x = 0;
  heroObj.g.rotation.x = 0; heroObj.g.rotation.y = byaw;
  heroObj.g.rotation.z = 0;
  heroObj.g.position.set(bx, 0, bz);
}

/* ============ 主循环 ============ */
/* ★ 目标在不在"我正前方的那片扇形"里（第 34 轮）
   用户反馈的原始问题：以前是"挑最近的那个打"，完全不看朝向
   → 背对着僵尸也能打，不合理 ✗
   现在两个条件都要满足：
     ① 距离 ≤ G.ATK_RANGE（够得着）
     ② 目标方向 和 我的朝向 P.yaw 的夹角 ≤ G.ATK_ARC（在正前方）
   ★ yaw 的约定和移动一致：atan2(dx, dz)（见 frame() 里 P.yaw 的赋值）✓
   ★ 这个函数是"本地立刻给反馈"用的预测；P2 之后【同一套规则要在服务器上再算一遍】，
     服务器那份才是权威 —— 到时候两边都用 G.ATK_RANGE / G.ATK_ARC，别各写各的 ✗ */
function inAtkArc(tx, tz) {
  var dx = tx - P.x, dz = tz - P.z;
  var d = Math.sqrt(dx * dx + dz * dz);
  if (d > G.ATK_RANGE) { return false; }
  if (d < 0.01) { return true; }        // 几乎贴在一起 → 不算角度了 ✓
  var a = Math.atan2(dx, dz) - P.yaw;
  while (a > Math.PI) { a -= Math.PI * 2; }
  while (a < -Math.PI) { a += Math.PI * 2; }
  return Math.abs(a) <= G.ATK_ARC;
}

/* ============================================================================
   ★★ 第 206 轮：自动战斗（方案 docs/自动战斗方案.md 第 13/14 节）★★

   · 永远"打带跑"：砍一刀 → 退 0.45 秒 → 它追进来 → 再砍
     （0.45 秒 ≈ 僵尸蓄力时间 ✓ 服务器"走开了就取消蓄力"✓ 真能躲 ✓）
   · 数量多少都一样打带跑 ✗ 唯一例外：被墙挡住退不动 → 原地打 ✓
   · 死了原地自动复活继续打 ✓（不回安全区 ✓ 用户指定）+ 三层防送死 ✓
   · 手动操作（推摇杆/按 WASD）→ 自动暂停 3 秒 ✓

   ★ 放客户端的理由：这个项目【位置归客户端】【伤害归服务器】✓
     所以只要"改自己的摇杆值 + 置 atkHeld"✓ 和真人走同一套代码 ✓
     服务器一行都不用改 ✓
   ============================================================================ */
var AUTO = {
  on: false, tgt: '', phase: 'find', t: 0,
  pauseUntil: 0, stuckT: 0, lastX: 0, lastZ: 0,
  deaths: [], reviveT: 0, info: '', kills: 0, setInput: false,
  lootOn: true,               /* 自动捡东西（菜单里可关 ✓）*/
  /* ★★ 第 211 轮：卡建筑检测 + 安全区不进 ★★ */
  lastHitT: 0,                /* 上一次"打中"（目标掉血 ✓）的时刻 */
  lastHp: -1,                 /* 目标上一帧的血量 ✓ 用来判有没有打中 */
  detourT: 0,                 /* 侧向绕行还剩多久 */
  detourDir: 1,               /* 往哪边绕（左/右 ✓ 随机）*/
  stuckTries: 0,              /* 这个目标已经绕了几次 */
  skipMid: '', skipUntil: 0,   /* 暂时放弃的目标（绕 3 次还打不到 ✓）*/
  lootId: '', lootT: 0, skipLid: '', skipLidUntil: 0,  /* 捡东西卡住 5 秒就放弃 */
  attacking: false            /* ★ 第 214 轮：这一刀是不是【我】按下的 ✓ */
};
var AUTO_RANGE = 30.0;
var AUTO_LOOT_R = 12.0;      /* 没怪时去捡东西的搜索半径 ✓ */
/* ★ round364（用户："攻击一下退后的距离不用那么远，再进一点"）
   ★ 这是【后撤持续时间】✗ 实际距离 ≈ 移速 × 时间
     0.45 秒 ≈ 1.35 米 ✗ 用户觉得太远 ✓
   ★ 0.30 秒 ≈ 0.9 米 ✗ 刚够离开僵尸的攻击距离 ✓ 又不会跑开太远 ✓
   ★ 不能压太狠：僵尸蓄力 0.45 秒 ✗ 没退出去会被打到 ✓
     → 0.28~0.32 是安全区间 ✓ */
var _multiN = 0;            // ★ round395：弯刀连砍的刀数
var _multiT0 = 0;           // 连砍动画起始时刻
var _multiRep = 180;        // 每刀间隔（ms ✓ 和服务端一致）
var _staffT0 = 0;           // ★ round393：长棍横扫的【触发时刻】
var _staffDur = 1900;       // 整个"变大 → 慢慢缩回"的时长（ms ✓）
var _staffLen = 4;          // 这次横扫的长度（米 ✓ 按品阶来）
var _staffPeak = 1;         // 峰值放大倍数
var _jumpAtkUntil = 0;      // ★ round383：暴击"跳起来打"的动画截止时刻
var _jumpAtkDur = 400;      // 跳一下的时长（ms ✓）
var _spinUntil = 0;         // ★ round381：锤子旋击的动画截止时刻
var _spinDur = 560;         // 转一圈的时长（ms ✓）
/* ★★★ round407（交接文档第四节 ④）：长枪【挑飞玩家】—— 我被挑到空中的状态 ★★★
   ★ 为什么高度归客户端：玩家位置/朝向是客户端权威 ✗ 服务端下一帧就被覆盖 ✓
     所以服务端只发一条 launch_me ✗ 1.5 秒的弧线由这里自己算 ✓
   ★ 高度 3.72 米 = 6 格 × 0.62（和服务端 FLY_H 必须同一个数 ✓
     不然本地看 3.7 米、别人看 2 米 ✓）
   ★ 参考的是怪的 flyUntil（web.js 里 launch 那条 ✓）——同一套观感 ✓ */
var _flyT0 = 0;             // 我被挑飞的时刻（0 = 没在飞）
var _flyDur = 1500;         // 滞空时长（ms ✓ 和服务端 1.5 秒一致）
var _flyH = 3.72;           // 峰值高度（米 ✓ 和服务端 FLY_H 一致）

/** 我现在离地多高（0 = 在地上 ✓）—— 抛物线：起落两端都是 0 ✓ */
function flyYNow() {
  if (!_flyT0) { return 0; }
  var t = (performance.now() - _flyT0) / (_flyDur || 1500);
  if (t < 0) { return 0; }
  if (t >= 1) { _flyT0 = 0; return 0; }   // ★ 到点自己收掉 ✗ 不会永远飞着 ✓
  return Math.sin(t * Math.PI) * (_flyH || 3.72);
}
var _yawLockUntil = 0;      // 挥刀锁朝向的截止时刻（ms ✓）
var AUTO_RETREAT = 0.30;
var AUTO_STUCK_MOVE = 0.12;

/* ★★★ round366（用户："有方块山要学会自己跳跃，掉水里也要自己起来"）★★★
   ★ 什么时候跳：
     ① 前方 0.5 米那一格比脚下高【超过一小步】→ 跳上去 ✓
        （地形是整数层 ✗ 台阶 1 层要跳 ✓ 0.35 以下的能直接走 ✓）
     ② 站在水里 → 跳一下更容易出来 ✓（水面比岸低一层 ✓）
     ③ 卡住超过 0.25 秒 → 跳一下试试（撞到矮墙/台阶 ✓）
   ★ 只在【没在空中】时设跳 ✗ 空中再按没用 ✓ */
function autoJumpIfNeeded(dirx, dirz) {
  if (typeof jumpHeld === 'undefined') { return; }
  if (P.air) { return; }
  var L = TER.LEVEL_H;
  var hx = Math.floor(P.x / L), hz = Math.floor(P.z / L);
  var fx = Math.floor((P.x + dirx * 0.55) / L);
  var fz = Math.floor((P.z + dirz * 0.55) / L);
  var hHere = terH(hx, hz), hFront = terH(fx, fz);
  // ① 前方更高 → 跳
  if (hFront - hHere > 0.2) { jumpHeld = 1; return; }
  // ② 在水里 → 跳（更容易爬上岸）
  if (P.inWater) { jumpHeld = 1; return; }
  // ③ 卡住了 → 跳一下
  if (AUTO.stuckT > 0.25) { jumpHeld = 1; }
}

function autoFacing(dx, dz) {
  return Math.atan2(dx, dz * G.FLIP_Z);   /* ★ 和主循环同一个公式 ✓ */
}
function autoSafeMargin() {
  /* 安全区外再留一圈缓冲（米）✗
     不然会贴着边界反复试探 ✓ 而且僵尸也可能站在边界外侧 ✓ */
  return (typeof SAFE_HALF === 'number') ? SAFE_HALF : 15.0;
}
function autoInSafe(x, z) {
  return (typeof SAFE_HALF === 'number') &&
    Math.abs(x) <= SAFE_HALF && Math.abs(z) <= SAFE_HALF;
}
function autoPickTarget() {
  var best = '', bestD = AUTO_RANGE * AUTO_RANGE;
  var threat = '', threatD = 16.0;
  var boss = '', bossD = AUTO_RANGE * AUTO_RANGE;
  var elite = '', eliteD = AUTO_RANGE * AUTO_RANGE;
  for (var mid in NET.rmobs) {
    var m = NET.rmobs[mid];
    if (!m || !m.alive || !(m.hp > 0) || m.dying >= 0) { continue; }
    var dx = m.cur.x - P.x, dz = m.cur.z - P.z;
    var d2 = dx * dx + dz * dz;
    if (autoInSafe(m.cur.x, m.cur.z)) { continue; }
    if (mid === AUTO.skipMid && performance.now() < AUTO.skipUntil) { continue; }
    if (m.atkT >= 0 && d2 < threatD) { threat = mid; threatD = d2; }
    if (+m.rank >= 2 && d2 < bossD) { boss = mid; bossD = d2; }
    if (+m.rank === 1 && d2 < eliteD) { elite = mid; eliteD = d2; }
    if (d2 < bestD) { best = mid; bestD = d2; }
  }
  return threat || boss || elite || best;
}
function autoRevive() {
  var now = performance.now();
  if (now - AUTO.reviveT < 1500) { return; }
  AUTO.reviveT = now;
  AUTO.deaths.push(now);
  while (AUTO.deaths.length > 5) { AUTO.deaths.shift(); }
  var recent = 0;
  for (var i = 0; i < AUTO.deaths.length; i++) {
    if (now - AUTO.deaths[i] < 30000) { recent++; }
  }
  if (recent >= 3) {
    /* ★★★ round362（用户："死亡了会停止自动战斗，不知道什么原因"）★★★
       ★ 根因：这就是原因 —— 30 秒内死 3 次 → 直接【永久关闭】✗
         （原本是为了防"挂机送死"✓ 但用户以为是 bug ✓）
       ★ 改成：暂停 20 秒 ✗ 20 秒后自己恢复 ✓
         20 秒足够回气 + 离开危险区 ✓ 又不会真的关掉 ✓ */
    AUTO.pauseUntil = now + 20000;
    AUTO.phase = 'find'; AUTO.tgt = ''; AUTO.t = 0;
    AUTO.deaths.length = 0;
    AUTO.info = '自动战斗：连死 3 次，暂停 20 秒';
    if (typeof toast === 'function') { toast('连死 3 次 → 暂停 20 秒（不会关闭自动战斗）'); }
    return;
  }
  wsSend('revive', {});
  AUTO.phase = 'retreat'; AUTO.t = 0; AUTO.stuckT = 0;
  AUTO.lastX = P.x; AUTO.lastZ = P.z;
  if (recent >= 2) { AUTO.pauseUntil = now + 8000; }   /* 30 秒内死第 2 次 → 停手 8 秒 ✓ */
}
function autoRelease() {
  /* ★★ 第 209 轮修的真 bug（用户："他现在会一直往前走不知道是什么情况"）★★
     病根：自动战斗是靠改 jx/jy（摇杆值）走路的 ✓
           但【关掉的那一刻没清零】✗
           → 摇杆值留着最后那个方向 → 人就一直朝那边走 ✓✓
           → 而且 autoTick 一看"没开"就 return ✗ 更没人清 ✓
     修：只要是我写的摇杆值，收手时一定还回去 ✓
     ★ 只清【我自己写的】✗ 玩家手指还按在摇杆上就不动它 ✓（AUTO.setInput 标记 ✓）*/
  /* ★ round371：关掉时必须清干净 ✗ 但只清"我写的"（AUTO.setInput ✓）
     ★ 另外把速度也掐掉：冰面上会滑很久 ✗ 看着就像"还在跑"✓ */
  /* ★★★ round372（用户："显示上已经关了，但人一直往一个方向跑"）★★★
     ★ 根因：这里只在 AUTO.setInput 为真时才清 ✗
       一旦标记和实际状态失步（某个分支清了标记但没清 jx/jy ✓）
       → 摇杆值永远停在最后那个方向 ✗ 人一直走 ✓
     ★ 修：不管标记 ✗ 只要【手指不在摇杆上】就一律清零 ✓
       （手指在摇杆上时不动它 ✓ 不然会把玩家自己的操作清掉 ✓）*/
  var _stickHeld = (typeof STICK_ACTIVE !== 'undefined') && STICK_ACTIVE;
  if (!_stickHeld) { jx = 0; jy = 0; AUTO.setInput = false; }
  else if (AUTO.setInput) { jx = 0; jy = 0; AUTO.setInput = false; }
  if (typeof MOV !== 'undefined') { MOV.tx = 0; MOV.tz = 0; }
  /* ★★ 第 214 轮修的真 bug（用户："点击攻击按钮没有反应了"）★★
     病根：这里原来无条件写 atkHeld = false ✗
           而这个函数在【没开自动战斗】时每帧都会被调 ✓
           → 玩家手点攻击键置 true ✗ 下一帧就被我清掉 ✓✓
           → 攻击键完全没反应 ✓ 一字不差 ✓
     修：只还【我自己按下】的那一次（attacking 标记 ✓）
         玩家自己按的，绝不碰 ✓ */
  if (AUTO.attacking) { atkHeld = false; AUTO.attacking = false; }
}

function autoTick(dt) {
  var now = performance.now();
  /* ★ round437：挂机中每 0.5 秒刷一次击杀数（临时 ✗ 不存库 ✓）*/
  if (AUTO.on) {
    AUTO.statT = (AUTO.statT || 0) + (dt || 0.016);
    if (AUTO.statT >= 0.5) {
      AUTO.statT = 0;
      try {
        var _secs = AUTO.t0 ? (now - AUTO.t0) / 1000 : 0;
        if (UI.autoStat) { UI.autoStat(true, AUTO.kills | 0, _secs); }
      } catch (e0) { }
    }
  }
  /* ★★★ round362（用户："进入安全区后自己走出去，而不是停下来"）★★★
     ★ 这段原来（第 211 轮）是"原地待命"✗ 理由是"不主动出去送死"✓
       但对用户来说就是"自动战斗在安全区里不动了"✓
     ★ 现在：主动朝【远离中心】的方向走出去 ✗ 出去之后自然继续 ✓
       ★ 站在正中心（0,0）没有"远离方向"✗ 固定往 +z 走 ✓
       ★ 走的时候【不打】✗ 免得一出门就扑上去 ✓ */
  if (AUTO.on && autoInSafe(P.x, P.z) && !dead) {
    var _sdx = P.x, _sdz = P.z;
    if (Math.abs(_sdx) < 0.01 && Math.abs(_sdz) < 0.01) { _sdx = 0; _sdz = 1; }
    var _sdl = Math.hypot(_sdx, _sdz) || 1;
    jx = _sdx / _sdl; jy = _sdz / _sdl;
    AUTO.setInput = true;
    P.yaw = autoFacing(jx, jy * G.FLIP_Z);
    atkHeld = false; AUTO.attacking = false;
    AUTO.info = '自动战斗：走出安全区';
    return;
  }
  if (!AUTO.on) {
    AUTO.faceLock = false;          // ★ 关掉时一定要解锁 ✓ 不然人就转不了身 ✓
    autoRelease();
    return;
  }
  /* ★★★ round363（用户："掉落物五阶以上，优先去捡，再继续打怪"）★★★
     ★ 为什么放在【选目标之前】：要压过"打架"✗ 而不只是"没怪时去捡"✓
     ★ 半径给大一点（AUTO_LOOT_R）✗ 高级掉落值得跑一趟 ✓
     ★ 只认 tier >= 5 ✗ 低阶的照旧"顺手捡"（没怪时才去 ✓）*/
  if (AUTO.lootOn) {
    var _hi = null, _hid = 1e9;
    for (var _lk in NET.rloot) {
      var _le = NET.rloot[_lk];
      if (!_le || (+_le.tier || 0) < 5) { continue; }
      if (_lk === AUTO.skipLid && now < AUTO.skipLidUntil) { continue; }
      var _hdx = _le.x - P.x, _hdz = _le.z - P.z;
      var _hd2 = _hdx * _hdx + _hdz * _hdz;
      if (_hd2 < _hid) { _hid = _hd2; _hi = _le; AUTO._hiId = _lk; }
    }
    if (_hi) {
      if (AUTO.lootId === AUTO._hiId) { AUTO.lootT += dt; }
      else { AUTO.lootId = AUTO._hiId; AUTO.lootT = 0; AUTO.detourDir = Math.random() < 0.5 ? -1 : 1; }
      if (AUTO.lootT > 5.0) {
        AUTO.skipLid = AUTO._hiId; AUTO.skipLidUntil = now + 8000;
        AUTO.lootId = ''; AUTO.lootT = 0; _hi = null;
      }
    }
    if (_hi) {
      var _hdl = Math.sqrt(_hid);
      if (_hdl > 1.2) {
        jx = (_hi.x - P.x) / _hdl;
        jy = (_hi.z - P.z) / _hdl;
        /* 卡住 1~2 秒：先横向绕一下，再继续 */
        if (AUTO.lootT > 1.0 && AUTO.lootT < 2.0) {
          var _sx2 = jx; jx = -jy * AUTO.detourDir; jy = _sx2 * AUTO.detourDir;
        }
        AUTO.setInput = true;
        P.yaw = autoFacing(_hi.x - P.x, _hi.z - P.z);
        atkHeld = false; AUTO.attacking = false;
        autoJumpIfNeeded(jx, jy);
        AUTO.info = '自动战斗：抢 ' + (+_hi.tier) + ' 阶「' + (_hi.name || '掉落') +
                    '」 ' + _hdl.toFixed(1) + 'm';
        return;
      }
      /* 已经很近了：站住让自动拾取生效 ✓ */
      jx = 0; jy = 0; AUTO.setInput = true;
      atkHeld = false; AUTO.attacking = false;
      AUTO.info = '自动战斗：捡 ' + (+_hi.tier) + ' 阶掉落';
      return;
    }
  }
  /* ---- 手动操作检测（自己判 ✗ 不用平台层加钩子 ✓）----
     上一帧我没写 jx/jy ✓ 而这一帧它们有值 → 说明是玩家在推摇杆 ✓
     键盘 WASD 也一起判 ✓ */
  var manual = (!AUTO.setInput && (Math.abs(jx) > 0.08 || Math.abs(jy) > 0.08)) ||
    keys['w'] || keys['a'] || keys['s'] || keys['d'];
  AUTO.setInput = false;
  if (manual) { AUTO.pauseUntil = now + 3000; }
  if (now < AUTO.pauseUntil) { AUTO.info = '自动战斗：你正在手动操作，稍后继续'; autoRelease(); return; }
  if (dead) { AUTO.info = '自动战斗：已倒下，正在复活…'; autoRelease(); autoRevive(); return; }

  if (!AUTO.tgt || !NET.rmobs[AUTO.tgt] || !NET.rmobs[AUTO.tgt].alive ||
      !(NET.rmobs[AUTO.tgt].hp > 0) || NET.rmobs[AUTO.tgt].dying >= 0) {
    if (AUTO.tgt) { AUTO.kills++; }
    AUTO.tgt = autoPickTarget();
    AUTO.phase = AUTO.tgt ? 'approach' : 'find';
    AUTO.t = 0;
  }
  if (!AUTO.tgt) {
    /* ★★ 第 210 轮：没怪的时候去捡东西 ★★
       ★ 好消息：游戏本来就有"走到 2 米内自动捡"（updateLoot ✓）
         → 所以这里只要【走过去】就行 ✗ 不用另写捡东西逻辑 ✓
       ★ 可关：AUTO.lootOn（菜单 → 操作 ✓ 默认开 ✓）*/
    if (AUTO.lootOn) {
      var bl = null, bd = AUTO_LOOT_R * AUTO_LOOT_R;
      for (var lid in NET.rloot) {
        var le = NET.rloot[lid];
        if (!le) { continue; }
        if (lid === AUTO.skipLid && now < AUTO.skipLidUntil) { continue; }
        var ldx = le.x - P.x, ldz = le.z - P.z;
        var ld2 = ldx * ldx + ldz * ldz;
        if (ld2 < bd) { bd = ld2; bl = le; AUTO._loId = lid; }
      }
      if (bl) {
        if (AUTO.lootId === AUTO._loId) { AUTO.lootT += dt; }
        else { AUTO.lootId = AUTO._loId; AUTO.lootT = 0; AUTO.detourDir = Math.random() < 0.5 ? -1 : 1; }
        if (AUTO.lootT > 5.0) {
          AUTO.skipLid = AUTO._loId; AUTO.skipLidUntil = now + 8000;
          AUTO.lootId = ''; AUTO.lootT = 0; bl = null;
        }
      }
      if (bl) {
        var ld = Math.sqrt(bd);
        if (ld > 1.2) {                       /* 够近了就交给原有的自动捡 ✓ */
          jx = (bl.x - P.x) / ld; jy = (bl.z - P.z) / ld; AUTO.setInput = true;
          if (AUTO.lootT > 1.0 && AUTO.lootT < 2.0) {
            var _sx3 = jx; jx = -jy * AUTO.detourDir; jy = _sx3 * AUTO.detourDir;
          }
          P.yaw = autoFacing(bl.x - P.x, bl.z - P.z);
          autoJumpIfNeeded(jx, jy);
          AUTO.info = '自动战斗：去捡东西 ' + ld.toFixed(1) + 'm';
          return;
        }
        AUTO.info = '自动战斗：捡东西';
        jx = 0; jy = 0; AUTO.setInput = true;
        return;
      }
    }
    /* ★★★ round362（用户："进入安全区后会自动走出去，而不是停下来"）★★★
       ★ 原来：没怪就停住 ✗ 而安全区里永远没怪（僵尸不进安全区 ✓）
         → 一进安全区自动战斗就"卡住"✓
       ★ 现在：在安全区（或边界缓冲带）里 → 朝【远离中心】的方向走出去 ✓
         走出去之后自然会重新找到怪 ✓
       ★ 站在正中心（x=z=0）时没有"远离方向"✗ 固定往 +z 走 ✓ */
    var _sd = Math.hypot(P.x, P.z);
    var _slim = autoSafeMargin() + 4.0;
    if (_sd < _slim) {
      /* 新手村：自动战斗在镇内暂停，不再自己往外跑 */
      jx = 0; jy = 0; AUTO.setInput = true;
      atkHeld = false; AUTO.attacking = false;
      AUTO.info = '小镇安全：自动战斗暂停';
      return;
    }
    jx = 0; jy = 0; AUTO.setInput = true;
    AUTO.info = '自动战斗：附近没有僵尸';
    return;
  }
  var m = NET.rmobs[AUTO.tgt];
  var dx = m.cur.x - P.x, dz = m.cur.z - P.z;
  var d = Math.hypot(dx, dz);
  if (d > AUTO_RANGE * 1.35) {
    AUTO.tgt = ''; AUTO.phase = 'find'; jx = 0; jy = 0; AUTO.setInput = true;
    AUTO.info = '自动战斗：目标太远，换一个';
    return;
  }
  /* ★ round365（用户："攻击时距离僵尸再近一点"）
     ★ 这是【靠近到多近才开始砍】✗ 不是攻击范围本身 ✓
       0.92 × 2.4 ≈ 2.21 米 ✗ 站得比较远就开始挥 ✓
       0.78 × 2.4 ≈ 1.87 米 ✗ 贴得更近再砍 ✓
     ★ 为什么不下到 0.6：再近会和僵尸的碰撞体重叠 ✗ 反而容易卡住 ✓ */
  var reach = (G.ATK_RANGE || 2.4) * 0.78 + (m.hitR || 0);
  AUTO.t += dt;
  /* ★ 自动战斗也会用已装配的主动技能（冷却/灵气/距离由平台层判断）*/
  try { if (UI.autoSkill) { UI.autoSkill({ x: m.cur.x, z: m.cur.z }, now); } } catch (eSk) { }

  /* ★★ 第 211 轮（用户）："长时间没攻击到僵尸，可能是被建筑卡住了" ★★
     怎么知道打没打中：盯着目标的血 ✓
       血掉了 = 打中了 → 记时刻 + 清掉"绕行次数"✓
       超过 3 秒血没掉 = 大概率被挡住 → 侧向绕一下 ✓
       绕 3 次还是打不到 → 放弃它，换一个（暂时拉黑 6 秒 ✓）*/
  var nowMs = now;
  if (m.hp < AUTO.lastHp - 0.5) {
    AUTO.lastHitT = nowMs; AUTO.stuckTries = 0; AUTO.detourT = 0;
  }
  AUTO.lastHp = m.hp;
  if (!AUTO.lastHitT) { AUTO.lastHitT = nowMs; }
  if (AUTO.detourT <= 0 && (nowMs - AUTO.lastHitT) > 3000) {
    AUTO.detourT = 0.8;
    AUTO.detourDir = Math.random() < 0.5 ? -1 : 1;   /* 左右随机 ✓ 免得每次都撞同一边 */
    AUTO.stuckTries++;
    AUTO.lastHitT = nowMs;                            /* 重新计时 ✓ */
    if (AUTO.stuckTries >= 3) {
      AUTO.skipMid = AUTO.tgt; AUTO.skipUntil = nowMs + 6000;
      AUTO.tgt = ''; AUTO.phase = 'find'; AUTO.stuckTries = 0;
      AUTO.info = '自动战斗：这个目标打不到，换一个';
      jx = 0; jy = 0; AUTO.setInput = true;
      return;
    }
    AUTO.info = '自动战斗：好像被挡住了，绕一下';
  }
  if (AUTO.detourT > 0) {
    /* 侧向绕行：把"朝目标"的方向转 70 度 ✓ 走一小段再转回来 ✓ */
    AUTO.detourT -= dt;
    var ang = Math.atan2(dx, dz) + AUTO.detourDir * 1.22;
    var sx = Math.sin(ang), sz = Math.cos(ang);
    jx = sx; jy = sz; AUTO.setInput = true;
    P.yaw = autoFacing(dx, dz);
    atkHeld = false; AUTO.attacking = false;
    return;
  }
  var lvTxt = m.lv ? ('Lv.' + m.lv + ' ') : '';

  /* ★★★ round420（用户："自动战斗如果玩家用的是弓箭也需要改一下攻击方式，
                  因为弓是远程武器"）★★★
     ★ 病根：自动战斗只有一套【贴脸砍】的流程 ✗
       → 拿弓也会一路冲到 1.87 米才开始射 ✗
         （弓射程 14 米 ✗ 白白挨打 ✓）
     ★ 现在拿弓时走【远程打法】：
       · 超过 12 米 → 走过去（跳台阶一样会跳 ✓）
       · 4.5 ~ 12 米 → 站住放箭（正常距离 ✓）
       · 小于 4.5 米 → 【边退边射】（风筝 ✗ 不让怪贴上来 ✓）
     ★ 为什么不用原来那套 approach/strike/retreat：
       那三段里的距离全按近战算的 ✗ 拉远反而会让它停下来 ✓ */
  if (MY_WEAPON && MY_WEAPON.look === 'bow') {
    var _shootR = 12.0;          /* 开射距离（弓本身 14 米 ✗ 留余量 ✓） */
    var _tooNear = 4.5;          /* 再近就得退 ✓ */
    AUTO.faceLock = true;        /* 放箭时朝向锁死 ✗ 不背对着怪 ✓ */
    P.yaw = autoFacing(dx, dz);
    if (d > _shootR) {
      jx = dx / d; jy = dz / d; AUTO.setInput = true;
      atkHeld = false; AUTO.attacking = false;
      autoJumpIfNeeded(dx / d, dz / d);
      AUTO.phase = 'approach';
      AUTO.info = '自动战斗（弓）：走进射程 ' + lvTxt + d.toFixed(1) + 'm';
      return;
    }
    if (d < _tooNear) {
      var _bx = -dx / (d || 1), _bz = -dz / (d || 1);
      jx = _bx; jy = _bz; AUTO.setInput = true;
      autoJumpIfNeeded(_bx, _bz);
      atkHeld = true; AUTO.attacking = true;
      AUTO.phase = 'retreat';
      AUTO.info = '自动战斗（弓）：开太近，边退边射 ' + d.toFixed(1) + 'm';
      return;
    }
    jx = 0; jy = 0; AUTO.setInput = true;
    atkHeld = true; AUTO.attacking = true;
    AUTO.phase = 'strike';
    AUTO.info = '自动战斗（弓）：放箭 ' + lvTxt + d.toFixed(1) + 'm';
    return;
  }

  if (AUTO.phase === 'find') { AUTO.phase = 'approach'; AUTO.t = 0; }

  if (AUTO.phase === 'approach') {
    AUTO.faceLock = false;              // ★ 追的时候朝向跟着走就行 ✓
    P.yaw = autoFacing(dx, dz);
    if (d <= reach) {
      AUTO.phase = 'strike'; AUTO.t = 0; jx = 0; jy = 0; AUTO.setInput = true;
      P.yaw = autoFacing(dx, dz);
      atkHeld = true; AUTO.attacking = true;
    } else {
      /* ★★ 第 211 轮：★ 根本不进安全区 ★
         不是"进去了怎么办"✗ 是"这一步就别踩进去"✓
         人在区里时服务器禁止攻击 ✓ 追进去只会站着发呆 ✓ */
      var stepX = P.x + (dx / d) * 0.6, stepZ = P.z + (dz / d) * 0.6;
      if (autoInSafe(stepX, stepZ)) {
        jx = 0; jy = 0; AUTO.setInput = true;
        atkHeld = false; AUTO.attacking = false;
        AUTO.info = '自动战斗：前面是安全区，不过去';
        return;
      }
      jx = dx / d; jy = dz / d; AUTO.setInput = true;
      atkHeld = false; AUTO.attacking = false;
      autoJumpIfNeeded(dx / d, dz / d);          // ★ 前面有台阶/水 → 自己跳 ✓
    }
    AUTO.info = '自动战斗：接近 ' + lvTxt + d.toFixed(1) + 'm';
    return;
  }
  if (AUTO.phase === 'strike') {
    AUTO.faceLock = true;
    jx = 0; jy = 0; AUTO.setInput = true;
    P.yaw = autoFacing(dx, dz);
    atkHeld = (atkT < 0); AUTO.attacking = atkHeld;
    AUTO.info = '自动战斗：挥砍 ' + lvTxt + d.toFixed(1) + 'm';
    if ((AUTO.t > 0.12 && atkT >= 0) || AUTO.t > 0.8) {
      AUTO.phase = 'retreat'; AUTO.t = 0; AUTO.stuckT = 0;
      AUTO.lastX = P.x; AUTO.lastZ = P.z;
    }
    return;
  }
  /* retreat：往远离目标的方向退 ✓ 这是"躲"的关键 ✓ */
  AUTO.faceLock = true;                 // ★ 后撤时保持面朝目标 ✓ 不转身 ✓
  atkHeld = false; AUTO.attacking = false;
  var rx = -dx / (d || 1), rz = -dz / (d || 1);
  jx = rx; jy = rz; AUTO.setInput = true;
  P.yaw = autoFacing(dx, dz);
  autoJumpIfNeeded(rx, rz);                      // ★ 退路上有障碍也跳 ✓
  if (Math.hypot(P.x - AUTO.lastX, P.z - AUTO.lastZ) < AUTO_STUCK_MOVE) {
    AUTO.stuckT += dt;
  } else {
    AUTO.stuckT = 0; AUTO.lastX = P.x; AUTO.lastZ = P.z;
  }
  AUTO.info = '自动战斗：后撤 ' + d.toFixed(1) + 'm';
  if (AUTO.t >= AUTO_RETREAT || AUTO.stuckT > 0.25) {
    AUTO.phase = 'approach'; AUTO.t = 0;
    if (AUTO.stuckT > 0.25) { AUTO.info = '自动战斗：退不动，原地打'; }
  }
}


/* ★ 第 246 轮：主循环"心跳"（给 platform 的看门狗用 ✓）
   core 不碰任何浏览器 API ✗ 所以这里只存一个时间戳 ✗
   由 platform 决定"多久算卡死、要不要刷新" ✓ */
var LAST_FRAME_MS = 0;

function frame(ts) {
  LAST_FRAME_MS = Date.now();   /* ★ 每帧都打一下卡 ✗ 看门狗靠它判断有没有卡死 ✓ */
  UI.raf(frame);
  if (!loadedOk) { return; }
  /* ★ 第 183 轮：还没登录就【不跑世界】✗
     不然登录框后面僵尸照样打你 ✓ 登录进去发现自己已经死了 ✓
     ★ 只停"世界更新" ✗ 渲染继续跑 ✓（登录框背后那层画面还是要画的 ✓）
     ★ 登录成功那一刻会自动恢复 ✓（WSC.role 有值了 ✓）*/
  if (typeof WSC !== 'undefined' && !WSC.role) {
    /* ★★ round452：登录界面也要"摆镜头" ✗✗
       之前这里直接 render → 相机停在 (0,0,0) → 背景是一片黑/地面 ✗
       现在：绕着出生点慢慢转，背景就是游戏真实的世界 ✓ */
    if (typeof LOGIN_CINE !== 'undefined' && LOGIN_CINE) {
      /* ★ round453：机位拉远、略低角（能看到远处的树和天际线 ✓）
         出生点是一块平地，太近全是地砖 ✗ */
      /* ★ round455（用户："下面的地板换成我们游戏里的材质"）★
         原来机位太高太远（9.4m）→ 地板压成一片灰色渐变 ✗
         现在贴近游戏里的视角（低一点、近一点）→
         地砖的格子、石材质感、树的影子都看得清 ✓ */
      /* ★★ round455b：机位再贴近地面（3.2m 高、半径 9.5m）✗
         ★ 为什么：高处看下去地板就是一片平灰 ✗
           贴地才能看清地砖格子、石材边框、树的坐标影子 ✓
         ★ 又不能太低：登录框会挡住整个世界 ✗ */
      /* ★ round455c：目标点从玩家身上往外挪 7 米 ✗
         原因：出生点正中心是一块【纯平地砖】，怎么拍都是一片灰 ✗
         挪 7 米之后：画面里同时有地砖、土地边界、树 → 一眼就是游戏的材质 ✓ */
      /* ★★★ round459（用户："我要我们游戏里的，你直接照搬不就好了"）★★★
         不再自建任何地形 ✗ 登录镜头就是【游戏里的机位】，只是慢慢绕圈 ✓
           · 距离 = G.CAM_DIST（和游戏里一样）
           · 高度 = 同样的俯角公式（和游戏里一样）
           · 看的点 = 人物胸口（和游戏里一样）
         → 登录看到的就是进游戏后看到的那一帧 ✓ */
      var _la = (performance.now() / 1000) * 0.05;
      var _gy = (typeof P.gy === 'number' && isFinite(P.gy)) ? P.gy : 0;
      var _dist = (typeof G !== 'undefined') ? G.CAM_DIST : 6.2;
      var _pitch = (typeof G !== 'undefined') ? G.CAM_PITCH : 0.95;
      var _hgt = _dist * Math.sin(_pitch);
      cam.position.set(P.x + Math.cos(_la) * _dist,
                       _gy + 1.4 + _hgt,
                       P.z + Math.sin(_la) * _dist);
      cam.lookAt(P.x, _gy + 1.4, P.z);
      /* ★ 阴影也跟着人走（不然登录背景里全是没阴影的浮空块 ✗）*/
      if (typeof sun !== 'undefined' && sun) {
        sun.position.set(P.x + 38, _gy + 70, P.z + 26);
        sun.target.position.set(P.x, _gy, P.z);
        sun.target.updateMatrixWorld();
      }
    }
    rd.render(scene, cam);
    return;
  }
    /* ★ 第 44 轮：阴影隔帧更新（见渲染器那里的注释）*/
    _shadowTick = (_shadowTick + 1) & 1;
    /* ★ 第 79 轮：更新间隔跟着【阴影质量】走 ✓
       高=2048² 每 2 帧（和以前完全一样 ✓）
       中=1024² 每 4 帧   关=不算
       ★ 为什么跟着走：阴影的开销 = 像素数 × 每秒重算次数 ✗
         只降分辨率只省 3/4 ✓ 两边一起降能省到 1/8 ✓ */
    var _shQ = (typeof setShadow === 'function') ? setShadow() : 'high';
    if (_shQ !== 'off') {
      var _shE = (_shQ === 'mid') ? 4 : 2;
      if (_shadowTick % _shE === 0) { rd.shadowMap.needsUpdate = true; }
    }
  if (lastTs && ts - lastTs < G.FRAME_MS) { return; }
  /* ★★ dt 必须用【真实帧间隔】，不能写死 1/60（第 28 轮修的真 bug）★★
     原来这里是 `var dt = 1 / 60;` —— 不管这一帧实际过了多久，位移都按 1/60 秒算 ✗
       · 144Hz 屏幕：144 帧 × (1/60 秒的位移) = 【2.4 倍速】✗
       · 30 FPS 的老手机：30 帧 × (1/60 秒的位移) = 【半速】✗
     （G.FRAME_MS 只挡"同一毫秒内的重复回调"，挡不住高刷屏 ✓ 所以两个方向都错）
     玩家反馈："帧数高的话会导致移动速度会快一些，应该不同设备一样才对" ✓ 就是这里。
     注意：这里取的是【上一帧到现在】的真实间隔，而上面那个 return 分支不更新 lastTs，
     所以被限流跳过的帧，时间会累积到下一帧的 dt 里 → 长跑不漂 ✓ */
  frameNo++;
  var dt = lastTs ? (ts - lastTs) / 1000 : 1 / 60;
  lastTs = ts;
  if (!(dt > 0)) { dt = 1 / 60; }
  if (dt > 0.1) { dt = 0.1; }   // ★ 切后台回来 / 卡了一大下 → 夹住，别让人瞬移 ✓
  if (hitStop > 0) { hitStop -= dt; dt *= 0.2; }

  /* ---- 移动 ---- */
  /* ★ 第 206 轮：自动战斗先在这一帧决定往哪走/要不要挥刀 ✗
     必须在读 jx/jy 之前 ✓ 它就是通过改 jx/jy 走路的 ✓ */
  if (typeof autoTick === 'function') { autoTick(dt); }
  var ix = jx, iz = jy;
  /* ★★ 第 65 轮修的真 bug：手机端（摇杆）死了走不动 ✓ 电脑端（WASD）还能走 ✗
     病根：清零写在【按键之前】→ 按键又把它加回来了 ✗
     → 所以必须放在【按键之后】覆盖一次 ✓（或者干脆不让按键生效 ✓）*/
  if (keys['w']) { iz -= 1; } if (keys['s']) { iz += 1; }
  if (keys['a']) { ix -= 1; } if (keys['d']) { ix += 1; }
  if (WH_OPEN) { ix = 0; iz = 0; atkHeld = false; }
  /* ★ round581/583：冰封 → 不能移动、不能攻击 */
  if (MY_FROZEN || MY_DOWN > 0) { ix = 0; iz = 0; atkHeld = false; }
  /* ★ round407（交接文档第四节 ④）：被挑飞到空中时【不能走、但能打】✓
     ★ 用户定的规则：锁移动 ✗ 不锁攻击 ✓
     ★ 复用下面 dead 那一行的位置：它已经在【按键之后】覆盖 ✓
       手机摇杆（jx/jy）和电脑 WASD 都会被拦住 ✓（第 65 轮踩过"清零写早了"的坑 ✓）*/
  if (dead || flyYNow() > 0) { ix = 0; iz = 0; }   // ★ 倒下了 / 被挑飞 = 不能走
  /* ★ 坐着：任何移动输入都先起身（点一下方向就站起来，不用先找按钮）*/
  if (MY_SEAT) {
    if (Math.abs(ix) + Math.abs(iz) > 0.15) {
      try { if (typeof tryStand === 'function') { tryStand(); } } catch (eSitM) { }
    }
    ix = 0; iz = 0; atkHeld = false; jumpHeld = 0;
  }
  if (MY_SLEEP) {
    if (Math.abs(ix) + Math.abs(iz) > 0.15) { try { if (typeof tryWake === 'function') { tryWake(); } } catch (eSleepM) { } }
    ix = 0; iz = 0; atkHeld = false; jumpHeld = 0;
  }
  /* ★ round497：镜头转了 → "往上推"必须是【屏幕上方】✗ 不是世界 -Z ✓
     yaw=0 时 cos=1 sin=0 → 原值 ✓ 零回归 ✓
     ★★★ round501 真 bug（用户："转动视角后自动战斗好像出问题了"）★★★
       ★ 根因：自动战斗（autoTick）写进 jx/jy 的是【世界方向】✗
         （它用 autoFacing(jx, jy) 直接算朝向，说明它自己就是世界坐标 ✓）
         而我这里又按镜头转了一次 ✗
         → 转完视角后 AI 的"朝怪走"被转歪 → 绕着怪转圈 / 越走越远 ✓✓ 一字不差
       ★ 修：只转【玩家自己推的】方向 ✗ AI 给的不转 ✓
         （AUTO.setInput = true 就是"这一帧的方向是 AI 写的"✓） */
  var _autoDrv = (typeof AUTO !== 'undefined' && AUTO && AUTO.setInput);
  if (CAM_YAW && !_autoDrv) {
    var _mcy = Math.cos(CAM_YAW), _msy = Math.sin(CAM_YAW);
    var _mix = ix * _mcy + iz * _msy;
    var _miz = -ix * _msy + iz * _mcy;
    ix = _mix; iz = _miz;
  }
  var len = Math.hypot(ix, iz), moving = false;
  /* ★★★ P2 地貌手感（方案 §6）★★★
     冰面   移速 ×1.45 ✗ 加减速都极慢（惯性）✗ 松手还会滑一段 ✓
     沼泽   移速 ×0.58 ✗ 加速度也慢（像陷在泥里）✓
     其它   一下就到速（和原来一模一样 ✗ 不影响手感 ✓）
     ★ 为什么用"速度+加速度"而不是"直接改位移"：
       直接改位移的话 ✗ 松手立刻就停 ✗ 那就不叫冰了 ✓
     ★ 加速度用【一阶跟随】✗ 不是真物理积分 ✓ 更好调 ✓ 也不会抖 ✓ */
  var _gbx = Math.floor(P.x / TER.LEVEL_H), _gbz = Math.floor(P.z / TER.LEVEL_H);
  /* 小镇安全区：不套用任何地貌（沼泽/冰面）速度，正常走路 */
  var _inTownMove = (typeof townIn === 'function') ? townIn(P.x, P.z)
    : ((typeof inSafeZone === 'function') ? inSafeZone(P.x, P.z) : false);
  var _bio = _inTownMove ? 'wild' : terBiome(_gbx, _gbz);
  var _spdM = _inTownMove ? 1 : (TER_BIO_SPEED[_bio] || 1);
  var _tspd = G.SPEED * _spdM;
  /* ★★★ round409（用户问："菜单里天赋那些加点会有效果吗"）★★★
     ★ 查出来：【移速】在服务端的天赋表里标着"生效"✗ 但客户端一次都没读它 ✓
       → 点了移速天赋，走路速度【一点都没变】✓（真 bug ✓ 现在接上 ✓）
     ★ 读的是 TAL.eff（服务端算好的有效值 ✓ 含对抗相减/封顶 ✓）
       ✗ 不要自己拿 TAL.raw 再算一遍 ✓ 两端各算一次迟早不一致 ✓
     ★ 服务端防作弊的上限是 PLAYER_SPEED × MOVE_TOL = 4.4 × 2.4 ≈ 10.6 米/秒 ✗
       天赋移速封顶 +60% → 4.4 × 1.6 = 7.0 ✓ 远在容差内 ✓ 不会被判外挂 ✓ */
  var _talSpd = 0;
  if (typeof TAL !== 'undefined' && TAL.eff && isFinite(TAL.eff.speed)) {
    _talSpd = Math.max(0, +TAL.eff.speed);
  }
  /* ★ round474：加上防具的【移速】词条，总上限 30%（用户：砍一半 ✓）*/
  if (typeof TAL !== 'undefined' && isFinite(TAL.speedGear)) {
    _talSpd = Math.min(30, _talSpd + Math.max(0, +TAL.speedGear));
  } else {
    _talSpd = Math.min(30, _talSpd);
  }
  if (_talSpd > 0) { _tspd *= (1 + _talSpd / 100); }
  /* ★ round576：嗜血 8 秒移速 +10%（服务端 me.moveSpd ✓）*/
  if (MY_MOVE_SPD > 0) { _tspd *= MY_MOVE_SPD; }
  /* ★ round581：时间凝滞减速（me.slow = 0.3 ✓）*/
  if (MY_SLOW > 0) { _tspd *= MY_SLOW; }
  if (len > 0.08) {
    var nx = ix / Math.max(1, len), nz = iz / Math.max(1, len);
    MOV.tx = nx * _tspd;
    MOV.tz = nz * G.FLIP_Z * _tspd;
    /* ★★★ round367（用户："退后太快看起来像在攻击后面"）★★★
       ★ 根因：这里用【输入方向】覆盖朝向 ✗
         而自动战斗【后撤】时输入是"往后退"✗ 人就转身朝后走了 ✓
         → 看着像背对着怪打 ✓
       ★ 修：自动战斗锁朝向时（faceLock）跳过这里 ✗ 保持它自己设的朝向 ✓
         → 后撤 = 【面朝怪、往后滑】✓ 和格斗游戏的后跳一样 ✓ */
    /* ★★★ round368（用户："手动打的时候也有这个问题"）★★★
       ★ 手动的情况和自动战斗不同：
         自动战斗是 AI 主动改朝向 ✗ 手动的朝向本来是对的 ✓
         但【挥刀动画还在播】时人已经转身了 ✓
         → 挥到一半朝向变了 180° ✗ 看着就像在打后面 ✓
       ★ 修：整个挥刀动画期间锁住朝向 ✓（round370 从 0.32 扩到 0.86 秒）
         动画播完就能自由转向 ✓ */
    /* ★★★ round369（用户："有时候人物动画无法转向"）★★★
       ★ 根因：上一版用 atkT 判"在挥刀"✗
         而 atkT 在某些路径下【不会推进】（被打断/死亡/自动战斗切阶段 ✓）
         → 一直停在 0~0.32 ✗ 朝向永远锁住 ✓ 人就转不了身 ✓
       ★ 修：换成【时间戳上限】✗ 锁最多 0.32 秒 ✗ 到点必解 ✓
         就算动画状态乱了也不会把人锁死 ✓ */
    var _swingLock = (performance.now() < (_yawLockUntil || 0));
    if (!_swingLock && !(typeof AUTO !== 'undefined' && AUTO.faceLock)) {
      P.yaw = Math.atan2(nx, nz * G.FLIP_Z);   // ★ 朝向跟着【输入】走（滑行时不会乱转）
    }
  } else {
    MOV.tx = 0; MOV.tz = 0;
  }
  var _acc = (_bio === 'ice') ? 2.2 : ((_bio === 'swamp') ? 6.5 : 26.0);
  MOV.vx += (MOV.tx - MOV.vx) * Math.min(1, dt * _acc);
  MOV.vz += (MOV.tz - MOV.vz) * Math.min(1, dt * _acc);
  if (Math.abs(MOV.vx) > 0.03 || Math.abs(MOV.vz) > 0.03) {
    var ox = P.x, oz = P.z;
    moveWithCollision(MOV.vx * dt, MOV.vz * dt, G.BODY_W / 2, G.BODY_D / 2, true, null);
    if (Math.hypot(P.x - ox, P.z - oz) < 0.0004) {
      // ★ 撞墙了：速度打个折 ✗ 不然会一直贴着墙"顶"✓
      MOV.vx *= 0.35; MOV.vz *= 0.35;
    }
  }
  if (Math.hypot(MOV.vx, MOV.vz) > 0.7) {
    moving = true; walkT += dt * 7.5;
    stepTimer -= dt;
    if (stepTimer <= 0) { stepTimer = 0.36; }
  }
  P.bio = _bio;
  /* ★ 第 306 轮：竖直方向（跳 / 掉 / 掉血）✗ 必须在移动之后算 ✓
     因为要用【移动后】的 x/z 去问脚下有多高 ✓ */
  terrainV(dt);
  try {
    var _safeNow = (typeof townIn === 'function') ? townIn(P.x, P.z) : inSafeZone(P.x, P.z);
    if (_safeNow !== SAFE_MODE) { safeModeSet(_safeNow); }
    if (SAFE_MODE) {
      if (H && H.sw) { H.sw.visible = false; }
      if (typeof FP !== 'undefined' && FP && FP.sw) { FP.sw.visible = false; }
    }
  } catch (eSafe) { }
  if (typeof terDebTick === 'function') { terDebTick(dt); }
  if (typeof rippleTick === 'function') { rippleTick(dt); }
  if (typeof propFallTick === 'function') { propFallTick(dt); }
  if (typeof hitFlashTick === 'function') { hitFlashTick(dt); }
  if (typeof flashCloneTick === 'function') { flashCloneTick(dt); }
  if (atkT < 0) {
    /* ★ 跳跃的"视觉加高"：只有【从地面跳起来】才加（摔下去不加 ✓）
       加的量 = 当前离地高度 × 0.9 → 顶点 0.713 格时多看 0.64 格
       合起来 ≈ 1.35 格高 ✗ 差不多是人物身高的一倍 ✓ 一眼就看出来在跳 ✓ */
    var _vb = 0;
    if (P.jumping && P.air) { _vb = Math.max(0, P.y - (P.gy || 0)) * 0.9; }
    var _sink = (P.inWater && !P.air) ? -0.12 : 0;   // 站在水里：下沉 12cm
    H.g.position.set(P.x, P.y + _vb + _sink + (moving ? Math.abs(Math.sin(walkT)) * 0.05 : 0), P.z);
  }   // ★ 攻击时坐标由动画控制 ✓
  /* ★★ 第 56 轮：死亡 = 【倒地】，不是站着 ✗（用户要求）★★
     ★ 必须放在上面那些姿势代码【之后】—— 不然会被它们覆盖回去 ✗ */
  if (dead) {
    H.g.rotation.x = -1.45;              // 躺平（绕 X 转过去 ✓）
    H.g.rotation.z = 0.12;               // 稍微侧一点，别像块板子
    H.g.rotation.y = P.yaw;              // 朝向保持不变 ✓
    H.g.position.set(P.x, P.y + 0.28, P.z);   // 贴地（含地形高度 ✓ 不然会陷进地里）
  } else if (MY_DOWN > 0) {
    /* ★ round593：天罚击倒 → 短暂倒地 */
    H.g.rotation.x = -1.15;
    H.g.rotation.z = 0.10;
    H.g.rotation.y = P.yaw;
    H.g.position.set(P.x, P.y + 0.22, P.z);
  }
  /* ★ 第 56 轮：无敌倒计时 + 脚下护盾环
     ★ 倒计时必须用【真实 dt】✗ 不能写死 0.033 —— 60fps 下会掉两倍快
       （这个坑第 28 轮在移动速度上踩过一次 ✓ 同一个道理 ✓）*/
  if (INVULN_T > 0) { INVULN_T = Math.max(0, INVULN_T - dt); }
  invRingUpdate();
  fxTick(dt);                       // ★ 第 63 轮：登场特效（复活/上线 ✓）
  /* ★ 第 71 轮：箭每帧自己往前飞（不再等快照 ✗ 快照 30Hz 会一顿一顿的 ✗）*/
  for (var _ak in NET.arrows) {
    var _am = NET.arrows[_ak];
    var _sp = (typeof ARROW_SPEED === 'number') ? ARROW_SPEED : 14.0;
    _am.position.x += Math.sin(_am.rotation.y) * _sp * dt;
    _am.position.z += Math.cos(_am.rotation.y) * _sp * dt;
  }
  H.g.rotation.y = P.yaw;
  /* ★★ 第 56 轮：倒地时【不要】播走路姿势 ★★
     踩过：我那段倒地写在上面 ✓ 但这里 (rotation.x = 0) 又把它清零了 ✗
     → 死亡姿势得是"没人再动它"才行 ✓ */
  if (atkT < 0 && !dead && MY_DOWN <= 0) {
    var sw2 = moving ? Math.sin(walkT) * 0.72 : Math.sin(performance.now() / 700) * 0.06;
    H.legL.rotation.x = sw2; H.legR.rotation.x = -sw2;
    H.armL.rotation.x = -sw2 * 0.75; H.armR.rotation.x = sw2 * 0.45;
    H.g.rotation.x = 0;
    H.g.rotation.z = 0;
  }
  /* ★ 坐姿：腿向前收、手放大腿、剑收起；轻微下沉到椅面 */
  if (MY_SEAT && !dead) {
    var st = MY_SEAT;
    SIT_K = Math.min(1, SIT_K + dt * 9);
    var sk2 = SIT_K;
    P.x = +st.x; P.z = +st.z; P.yaw = +st.yaw;
    var sitY = (+st.y || 0.30) - 0.36;
    H.g.position.set(st.x, P.y + sitY, st.z);
    H.g.rotation.set(0, st.yaw, 0);
    H.legL.rotation.x = -1.34 * sk2;
    H.legR.rotation.x = -1.34 * sk2;
    H.armL.rotation.x = -0.58 * sk2;
    H.armR.rotation.x = -0.58 * sk2;
    H.armL.rotation.z = 0.10 * sk2;
    H.armR.rotation.z = -0.10 * sk2;
    H.sw.visible = false;
    if (H.legL.children[0]) { H.legL.children[0].rotation.x = 0.82 * sk2; }
    if (H.legR.children[0]) { H.legR.children[0].rotation.x = 0.82 * sk2; }
  } else if (MY_SLEEP && !dead) {
    /* ★ 2026-10-22：躺姿按【床的朝向】算（以前用玩家自己的朝向，床一转方向就歪、头穿出去）。
       模型原点在脚底，绕 X 转 -1.45 后身体朝本地 -Z 伸展 →
       把脚放到床尾（本地 +Z），身体正好铺到床头。 */
    var _sy = (typeof P.sleepYaw === 'number') ? P.sleepYaw : (P.yaw || 0);
    var _so = (typeof SLEEP_OFF !== 'undefined') ? SLEEP_OFF : 0.85;
    H.g.position.set(P.x + Math.sin(_sy) * _so, P.y + 0.62, P.z + Math.cos(_sy) * _so);
    /* ★ 欧拉顺序必须是 YXZ：先绕 Y 转向，再绕本地 X 躺下。
       用默认 XYZ 的话，Y 转 90/180 度后"躺"的方向就跟着歪了 → 头穿出床外。 */
    H.g.rotation.order = 'YXZ';
    H.g.rotation.set(-1.45, _sy, 0);
    H.legL.rotation.x = 0; H.legR.rotation.x = 0;
    H.armL.rotation.x = 0.15; H.armR.rotation.x = 0.15;
    H.sw.visible = false;
    if (H.legL.children[0]) { H.legL.children[0].rotation.x = 0; }
    if (H.legR.children[0]) { H.legR.children[0].rotation.x = 0; }
  } else if (H) {
    if (H.legL.children[0]) { H.legL.children[0].rotation.x = 0; }
    if (H.legR.children[0]) { H.legR.children[0].rotation.x = 0; }
    if (H.sw.visible === false && !MY_SEAT && !SAFE_MODE && !MY_SLEEP) { H.sw.visible = true; }
  }

  try { eatTick(dt); } catch (eEat) { }
  try { jobTick(dt); } catch (eJob) { }

  /* ---- 新手小镇：交互候选（2026-10-22：多个一起出现时可选）---- */
  try {
    var _cands = [];
    var _seatN = (!MY_SEAT && typeof townSeatNear === 'function') ? townSeatNear(P.x, P.z) : null;
    if (_seatN) {
      SEAT_NEAR = _seatN;
      _cands.push({ kind: 'sit', prompt: 'sitPrompt', cls: 'seat',
                    title: '坐下', sub: (_seatN.label || '椅子'),
                    text: '按 E / 点击交互按钮 坐下 · ' + (_seatN.label || '椅子'),
                    dist: Math.hypot((+_seatN.x || 0) - P.x, (+_seatN.z || 0) - P.z),
                    ref: _seatN });
    } else if (SEAT_NEAR) {
      SEAT_NEAR = null;
    }

    var _tpN = (!MY_SEAT && typeof townTeleportNear === 'function') ? townTeleportNear(P.x, P.z) : null;
    TP_NEAR = _tpN || null;
    if (_tpN) {
      _cands.push({ kind: 'tp', prompt: 'tpPrompt', cls: 'teleport',
                    title: '传送阵', sub: (_tpN.name || ''),
                    text: '按 E / 点击交互按钮 打开传送阵 · ' + (_tpN.name || ''),
                    dist: Math.hypot((+_tpN.x || 0) - P.x, (+_tpN.z || 0) - P.z),
                    ref: _tpN });
    }

    var _bedN = (!MY_SEAT && !MY_SLEEP && typeof townHouseSleepNear === 'function') ? townHouseSleepNear(P.x, P.z) : null;
    SLEEP_NEAR = _bedN || null;
    if (_bedN) {
      _cands.push({ kind: 'sleep', prompt: 'sleepPrompt', cls: 'sleep',
                    title: '睡觉', sub: (_bedN.name || '床'),
                    text: '按 E / 点击交互按钮 睡觉',
                    dist: 0, ref: _bedN });
    }

    var _houseN = (!MY_SEAT && !MY_SLEEP && !_bedN && typeof townHouseNear === 'function') ? townHouseNear(P.x, P.z) : null;
    HOUSE_NEAR = _houseN || null;
    if (_houseN) {
      _cands.push({ kind: 'house', prompt: 'housePrompt', cls: 'house',
                    title: '房屋', sub: (_houseN.name || ''),
                    text: '按 E / 点击交互按钮 查看房屋',
                    dist: 0, ref: _houseN });
    }

    var _frN = (!MY_SEAT && !MY_SLEEP && !_bedN && typeof townHouseFridgeNear === 'function') ? townHouseFridgeNear(P.x, P.z) : null;
    FRIDGE_NEAR = _frN || null;
    if (_frN) {
      _cands.push({ kind: 'fridge', prompt: 'shopPrompt', cls: 'fridge',
                    title: '冰箱', sub: (_frN.name || ''),
                    text: '按 E / 点击交互按钮 打开冰箱',
                    dist: 0, ref: _frN });
    }

    /* 2026-10-22：不再被床/冰箱"吃掉"——多个一起列出来，让玩家自己选 */
    var _shopN = (!MY_SEAT && !MY_SLEEP && typeof townShopNear === 'function') ? townShopNear(P.x, P.z) : null;
    SHOP_NEAR = _shopN || null;
    if (_shopN) {
      _cands.push({ kind: 'shop', prompt: 'shopPrompt', cls: 'shop',
                    title: (_shopN.name || '商店'), sub: '买东西 / 点单',
                    text: '按 E / 点击交互按钮 购买 · ' + (_shopN.name || ''),
                    dist: Math.hypot((+_shopN.x || 0) - P.x, (+_shopN.z || 0) - P.z),
                    ref: _shopN });
    }

    var _whN = (typeof townNearWarehouse === 'function') ? townNearWarehouse(P.x, P.z) : false;
    if (MY_SEAT) { _whN = false; }
    WH_NEAR = !!_whN;
    if (_whN) {
      _cands.push({ kind: 'warehouse', prompt: 'whPrompt', cls: 'interact',
                    title: '仓库', sub: '存取物品',
                    text: '按 E / 点击交互按钮 打开仓库',
                    dist: 0, ref: true });
    }

    /* 近的排前面（椅子/商店有距离，其余排后） */
    _cands.sort(function (a, b) { return (a.dist || 0) - (b.dist || 0); });
    if (typeof UI !== 'undefined' && UI.interactNear) { UI.interactNear(_cands); }
    if (typeof townRoofTick === 'function') { townRoofTick(P.x, P.z, CAM_VIEW === 'first'); }
    if (typeof townLabelTick === 'function') { townLabelTick(P.x, P.z); }
    if (typeof UI !== 'undefined' && UI.warehouseFloat) {
      /* ★ 2026-10-22：飘字挂在【仓库建筑对象】上（以前钉在旧柜台坐标 → 建筑挪走了它不动，
         删掉了它还悬在那儿）。找不到仓库对象就不显示。 */
      var _wa = null;
      try {
        var _wl = (typeof TOWN_OBJECTS_CACHE !== 'undefined' && TOWN_OBJECTS_CACHE) || [];
        for (var _wi = 0; _wi < _wl.length; _wi++) {
          var _wo = _wl[_wi];
          if (_wo && !_wo.parent && _wo.catalog === 'shop_warehouse_v1') { _wa = _wo; break; }
        }
      } catch (eW0) { _wa = null; }
      if (!_wa) {
        UI.warehouseFloat(0, 0, 0, '');
      } else if (Math.hypot(P.x - _wa.x, P.z - _wa.z) < 45) {
        if (!_townProjectV) { _townProjectV = new THREE.Vector3(); }
        _townProjectV.set(_wa.x, 3.9, _wa.z).project(cam);
        if (_townProjectV.z < 1) {
          UI.warehouseFloat((_townProjectV.x * 0.5 + 0.5) * innerWidth,
            (-_townProjectV.y * 0.5 + 0.5) * innerHeight, 1,
            WH_NEAR ? '仓库 · 按 E / 交互' : '仓库');
        } else { UI.warehouseFloat(0, 0, 0, ''); }
      } else { UI.warehouseFloat(0, 0, 0, ''); }
    }
  } catch (eTown) { }

  /* ---- 攻击（6 帧 · 由下往上撩 ✓ 0.78 秒 ✓）---- */
  if (atkT >= 0) {
    /* ★ 攻击动画（业界规范 ✓ 四阶段 · 8 帧 · 总 0.86 秒）
       ① 预备 30%：下沉后仰 + 剑后拉（慢 ✓ 蓄力）
       ② 挥击 20%：极快下砍（快慢对比产生力量感 ✓）
       ③ 冲击 10%：定格绷紧（顿帧 ✓）
       ④ 收招 40%：继续划 + 前倾 + 慢回正 ✓
       关节：右臂 X/Y/Z 三轴 + 肩部 + 重心 + 左手 + 双腿 */
    atkT += dt * ATK_ANIM_SPD;   // ★ 第 169 轮：动画快 20%（攻速不变 ✓）
    // ★ 直接调共用的挥剑动画（本地 / 别的玩家 同一套 → 动作一致 ✓）
    var _spinOn = (performance.now() < _spinUntil);
    if (!heroAtkPose(H, atkT, P.x, P.z, P.yaw, MY_WEAPON && MY_WEAPON.look, P.y,
                     (NET && NET.atkSeq) || 0)) {
      atkT = -1;
      heroAtkReset(H, P.x, P.z, P.yaw);
    }
    /* ★ round427：刀尖拖影（姿势算完以后取刀尖✓）
       ★ 纯视觉 ✗ 不参与判定/伤害/冷却 ✓ */
    try {
      if (atkT >= 0) { var _tp = weaponTipWorld(_tipV); if (_tp) { trailTick('me', _tp); } }
    } catch (e1) { }
    /* ★ round381：旋击 —— 在挥刀姿势之上【再叠一个整圈旋转】✓
       ★ 为什么叠加而不是新做一套关键帧：
         转圈 = 身体绕 Y 轴转 360° ✗ 挥砍姿势本身不用变 ✓
         叠加就是"一边挥一边转"✓ 正好是想要的效果 ✓ */
    if (_spinOn) {
      var _sp = 1 - (_spinUntil - performance.now()) / _spinDur;
      if (_sp < 0) { _sp = 0; }
      if (_sp > 1) { _sp = 1; }
      H.g.rotation.y = P.yaw + Math.PI * 10 * _sp;   /* round403: 五圈 */
      if (H.shadow) { H.shadow.visible = true; }
    }
    /* ★ round383：暴击跳打 —— 叠一个竖直抛物线 ✓
       ★ 和旋击可以同时生效 ✗ 转圈也能跳起来转 ✓ */
    /* ★★★ round395（用户："向前挥砍 N 刀，每刀一步，双手握刀"）★★★
       ★ 不算新关键帧 ✗ 把【劈砍】这套循环播 N 次 ✓
       ★ 用 'axe' 那套：本来就是从上往下劈 ✗ 而且左手会握住 ✓（双手 ✓）*/
    if (_multiN > 0) {
      var _mNow = performance.now();
      var _mEl = _mNow - _multiT0;
      var _mTot = _multiN * _multiRep;
      if (_mEl >= 0 && _mEl < _mTot) {
        var _repT = (_mEl % _multiRep) / _multiRep;
        var _atkT2 = _repT * ATK_T.chop[ATK_T.chop.length - 1];
        heroAtkPose(H, _atkT2, P.x, P.z, P.yaw, 'axe', P.y, 0);
      } else if (_mEl >= _mTot) {
        _multiN = 0;
      }
    }
    /* ★★★ round393（用户："变大不够提前，攻击完要慢慢变小，而且不够大"）★★★
       ★ 包络曲线：
         0 ~ 0.10  【快速变大】✗ 攻击那一刻已经是大棍子了 ✓
         0.10~0.35 【保持】✓ 打出去的时候最长
         0.35~1.00 【慢慢缩回】✓ 不是"啪"一下变回去 ✓
       ★ 幅度：12 阶 = 10 米 → 峰值 5.4 倍（比原来 2.6 大一倍多 ✓）*/
    if (H.sw) {
      var _sNow = performance.now();
      var _sAge = (_sNow - _staffT0) / _staffDur;
      if (_sAge >= 0 && _sAge < 1) {
        var _env;
        if (_sAge < 0.10) { _env = _sAge / 0.10; }
        else if (_sAge < 0.35) { _env = 1; }
        else { _env = 1 - (_sAge - 0.35) / 0.65; }
        if (_env < 0) { _env = 0; }
        var _sk = 1 + (_staffPeak - 1) * _env;
        H.sw.scale.set(_sk, _sk, _sk);
      } else if (H.sw.scale.x !== 1) {
        H.sw.scale.set(1, 1, 1);
      }
    }
    if (performance.now() < _jumpAtkUntil) {
      var _jp = 1 - (_jumpAtkUntil - performance.now()) / _jumpAtkDur;
      if (_jp < 0) { _jp = 0; }
      if (_jp > 1) { _jp = 1; }
      /* ★ round384（用户："跳起来不明显，要跳得比按弹跳键还高"）
         ★ 弹跳键的视觉最高点 ≈ 1.98 格（物理 1.04 × 1.9 倍视觉加成 ✓）
         ★ 0.45 只有它的四分之一 ✗ 难怪看不出来 ✓
         ★ 2.4 格 = 明显高过普通跳跃 ✓ */
      H.g.position.y += Math.sin(_jp * Math.PI) * 3.4;   /* round385: 2.4 -> 3.4 */
    }
  }
  if (atkCd > 0) { atkCd -= dt; }
  /* ★ 攻击冷却 → 按钮（第 33 轮）：平时哑光、冷却时按比例压暗 + 转一圈
     只在变化超过 4% 时才写界面 —— 每帧都碰 DOM 是白烧性能 ✗ */
  if (UI.atkCool) {
    var _acd0 = (G.ATK_CD || 0.62) / ((MY_ATK_SPD > 0) ? MY_ATK_SPD : 1);
    var _cdp = (atkCd > 0) ? Math.min(1, atkCd / _acd0) : 0;
    if (Math.abs(_cdp - _atkCdP) > 0.04 || (_cdp === 0) !== (_atkCdP === 0)) {
      _atkCdP = _cdp;
      UI.atkCool(_cdp);
    }
  }
  if (dead) { atkHeld = false; }   // ★ 倒下了不能挥剑 ✓
  if (atkHeld && atkCd <= 0 && atkT < 0 && !dead) {
    atkT = 0;
    /* ★ round576：嗜血攻速 +20% → 本地出手间隔也 ÷1.2（和服务器一致 ✓）*/
    atkCd = (G.ATK_CD || 0.62) / ((MY_ATK_SPD > 0) ? MY_ATK_SPD : 1);
    /* ★ round427：挥砍开始 → 起一条拖影（纯视觉 ✓ 不参与任何判定 ✓）*/
    try {
      trailStart('me', weaponTipLen((MY_WEAPON && MY_WEAPON.look) || 'sword'),
                 (MY_WEAPON && MY_WEAPON.tier) || 0);
    } catch (e0) { }
    /* ★ round370（用户："是不是 0.32 秒太短了"）
       ★ 对：挥刀动画本身约 0.86 秒 ✗ 只锁 0.32 秒的话
         后面半秒是收刀动作 ✗ 那段时间人就转身了 ✓ 看着还是像打后面 ✓
       ★ 现在锁满整个挥刀动画（0.86 秒 ✓）
         ★ 仍有时间上限 ✗ 不会因为动画状态异常而永久卡死 ✓ */
    /* ★★★ round375（用户："按武器攻速决定锁转时间会不会更好"）★★★
       ★ 对：每把武器的动作长度本来就不同 ✓
           刺（dagger/spear）0.58 秒 · 单手剑 0.62 · 横扫 0.78 · 劈 0.86 · 弓 0.90
         固定 860ms 的话 ✗ 快武器会【多锁半秒】✗ 手感发滞 ✓
       ★ 现在直接读这把武器的动作总时长 ✗ 一秒不差 ✓ */
    var _archN = atkArchOf(MY_WEAPON && MY_WEAPON.look);
    var _ttN = ATK_T[_archN];
    var _durN = _ttN ? _ttN[_ttN.length - 1] : 0.86;
    _yawLockUntil = performance.now() + _durN * 1000;
    /* ★★★ round310（P1 破坏）：挥刀【先判地形】✗ 方案 §5.1 ✓
       规则：正前方一格（1 格远 + 扇形内）有比脚下高的地形 → 打它 ✓
       ★ 为什么先判地形：不然站在墙前面打僵尸 ✗ 墙永远拆不掉 ✓
       ★ 客户端只是【发请求】✗ 服务端验距离/硬度/扣耐久 ✓ */
    /* ★★★ round350（用户："旁边有树的时候，打怪会优先打到树"）★★★
       ★ 原因：挥刀的判定顺序是【物件 → 地形 → 僵尸】✗ 物件排最前 ✓
       ★ 修：先看"正前方有没有僵尸"✗ 有就整个跳过物件/地形 ✓
         （僵尸是战斗目标 ✗ 树只是障碍物 ✓ 打怪时不该被抢）*/
    var _mobNear = false;
    try {
      var _ax = P.x + Math.sin(P.yaw) * TER.LEVEL_H * 0.95;
      var _az = P.z + Math.cos(P.yaw) * TER.LEVEL_H * 0.95;
      if (NET.rmobs) {
        for (var _mk in NET.rmobs) {
          var _mr = NET.rmobs[_mk];
          if (!_mr || !_mr.cur || _mr.dead) { continue; }
          var _mdx = _mr.cur.x - _ax, _mdz = _mr.cur.z - _az;
          if (_mdx * _mdx + _mdz * _mdz < 1.21) { _mobNear = true; break; }
        }
      }
    } catch (e0) { }
    try {
      if (_mobNear) { throw 'skip'; }        // ★ 有僵尸 → 直接去下面打它 ✓
      var _agx = Math.floor(P.x / TER.LEVEL_H), _agz = Math.floor(P.z / TER.LEVEL_H);
      var _fx = Math.floor((P.x + Math.sin(P.yaw) * TER.LEVEL_H * 1.5) / TER.LEVEL_H);
      var _fz = Math.floor((P.z + Math.cos(P.yaw) * TER.LEVEL_H * 1.5) / TER.LEVEL_H);
      /* ★★★ round337 修的真 bug（用户："测试了破坏树和石头不行"）★★★
         根因：原来只查【前方 1.2 格那一个格子】✗
               而树的碰撞盒会把玩家挡在 1~1.5 格外 ✓
               → 1.2 格经常正好落在树的【前一格或后一格】✗ 没选中 ✓
         修：查一组候选格（前方 + 四周 + 自己脚下）✗ 取最近的且有东西的那格 ✓
         ★ 为什么不用更远的"射线"：这一步只是选目标 ✗ 距离校验在服务端 ✓
           客户端选准一点就行 ✓ 选宽一点也不会让玩家砍到够不着的树（服务端会拒 ✓）*/
      var _propHit = null, _propBest = 1e9;
      for (var _ox = -3; _ox <= 3; _ox++) {
        for (var _oz = -3; _oz <= 3; _oz++) {
          var _cx = _fx + _ox, _cz = _fz + _oz;
          var _ck = _cx + ',' + _cz;
          if (!propAt[_ck]) { continue; }
          // 还要够得着（玩家脚下那格也算 ✓ 因为碰撞盒可能把它挤开）
          var _dd = Math.max(Math.abs(_cx - _agx), Math.abs(_cz - _agz));
          if (_dd > 3) { continue; }
          if (_dd < _propBest) { _propBest = _dd; _propHit = [_cx, _cz]; }
          if (_dd === 0) { break; }
        }
      }
      if (_propHit && !propDead[_propHit[0] + ',' + _propHit[1]]) {
        // ★ 打击反馈：物件本身闪白（不是上方冒光 ✓）
        if (typeof sfx === 'function') { sfx('step', 0.95); }
        var _fb = buildPropSolid(propAt[_propHit[0] + ',' + _propHit[1]], _propHit[0], _propHit[1]);
        if (_fb) { flashCloneMesh(_fb); scene.remove(_fb); }
        wsSend('mineprop', { gx: _propHit[0], gz: _propHit[1] });
        propDmg[_propHit[0] + ',' + _propHit[1]] = (propDmg[_propHit[0] + ',' + _propHit[1]] || 0) + 1;
        return;                       // ★ 打了树就不打地形/怪 ✓
      }
      var _curH = terH(_agx, _agz), _tgtH = terH(_fx, _fz);
      if (_tgtH > _curH + 0.5) {
        // ★ 打方块：方块本体闪白 + 闷响
        if (typeof sfx === 'function') { sfx('step', 0.9); }
        flashBlock(_fx, _fz);
        wsSend('mine', { gx: _fx, gz: _fz });
        terDmg[_terKey(_fx, _fz)] = (terDmg[_terKey(_fx, _fz)] || 0) + 1;
      }
    } catch (e) { }
    NET.atkSeq++;        // ★ 告诉别人"我挥剑了"（下一包位置一起带过去 ✓）
    sfx('swing', 0.9);   // ★ MC 挥剑声（6 变体随机 ✓）   // 与动画(0.86s)配合 ✓ 连击流畅 ✓
    /* ★ 判定：只打【正前方扇形】里的目标（第 34 轮改的）
       以前：挑"最近的一个"，不看朝向 → 背对着也能打 ✗（用户反馈）
       现在：距离够 + 在正前方 → 【全打】（挥一刀扫一片 ✓ 才像砍到"那边"）
       ★ P2 之后这一段的权威判定归服务器；这里这层负责"立刻给反馈"（本地预测）✓ */
    if (NET.on) {
      /* ★★ 联机 = 服务器权威（第 35 轮）★★
         本地只报"我挥了一刀"。打中谁、掉多少血，全部由服务器按
         【它手里那份权威位置 + 朝向】重新算一遍（同一套扇形规则 ✓）。
         为什么不做本地预测：客户端一旦上报目标，改个包就能隔空打人 ✗（方案 §5）
         所以这里不判命中、也不弹伤害数字 —— 等服务器的 mhits + 快照回来 ✓
         （自己那份 inAtkArc 只给下面单机那条路用 ✓）*/
      wsSend('atk', { seq: NET.atkSeq });
    } else {
      /* 单机：本地就是权威 → 扇形里的全打，立刻给反馈 ✓ */
      var hitList = [], hi, anyCrit = false;
      for (var mi2 = 0; mi2 < mobs.length; mi2++) {
        var mm = mobs[mi2];
        if (!mm.alive) { continue; }
        if (!inAtkArc(mm.g.position.x, mm.g.position.z)) { continue; }
        hitList.push({ o: mm, x: mm.g.position.x, z: mm.g.position.z });
      }
      if (hitList.length) {
        // 先把伤害都摇好（才知道这刀有没有暴击 → 声音/震动只出一次 ✓）
        for (hi = 0; hi < hitList.length; hi++) {
          hitList[hi].crit = Math.random() < 0.2;
          hitList[hi].dv = Math.round(ATK * (hitList[hi].crit ? G.CRIT_MUL : 1));
          if (hitList[hi].crit) { anyCrit = true; }
        }
        sfx(anyCrit ? 'crit' : 'hit', 1.0);
        sfx('zhurt', 0.7);
        shake = anyCrit ? 0.45 : 0.22;
        for (hi = 0; hi < hitList.length; hi++) {
          // quiet=1：一刀砍到多只时，音效只在上面出一次（不然 N 只叠 N 个音效 ✗）
          hurtMob(hitList[hi].o, hitList[hi].dv, P.x, P.z, hitList[hi].crit, true);
        }
      }
    }
  }

  /* ---- 妖兽（6 帧攻击 ✓ 走近咬人 ✓）---- */
  mobT += dt;
  netUpdate(dt);   // ★ 缓冲插值（别人走动平滑 ✓ 不再一卡一卡 ✓）
  netSeparate(dt); // ★ 和别人重叠时慢慢推开（碰撞箱不叠在一起 ✓ 也不会互相卡住 ✓）
  updateMarks();   // ★ 附近队友的屏幕方位箭头 ✓
  updateSelfBar();   // ★ 第 87 轮：自己头顶的血条 ✓
  updateLoot(dt);  // ★ 地上掉的：转一下 + 走过去自动捡（第 38 轮）✓
  updateGlowLights();   // ★ 发光：把固定 2 盏灯派给最近的发光物（第 45 轮）✓
  updateHealFx(dt);     // ★ 治疗连线：缩粗细 + 到期回收（第 46 轮）✓
  /* ★ 建筑分块：只有走出当前块才重算（一块 32 格 ≈ 20 米，所以几秒才走一次 ✓）
     _propPending = 上一帧的建块预算用完、还有块欠着 → 接着建 ✓
     平时每帧就两次取整 + 比较，开销可以忽略 ✓ */
  {
    var _pci = Math.floor(cellOf(P.x) / PROP_CHUNK), _pcj = Math.floor(cellOf(P.z) / PROP_CHUNK);
    if (_propPending || _pci !== _propCI || _pcj !== _propCJ) { updateProps(); }
  }
  refreshGround();   // ★ 地面跟着玩家走（走出 160 单位才真重建，平时只是两次比较 ✓）
  refreshTerrain();  // ★ 第 306 轮：方块地形（分瓦片 ✗ 一帧最多建几片 ✓）
  rebuildGrid();   // ★ 每帧重建空间网格（O(N) ✓ 之后查询都是 O(1) ✓）
  for (var mj = 0; mj < mobs.length; mj++) {
    var m2 = mobs[mj];
    /* ★ 击退更新（平滑衰减 ✓ 0.18 秒 ✓ 替代瞬间位移 ✗）*/
    if (m2.kbT > 0) {
      m2.kbT -= dt;
      var kf = Math.max(0, m2.kbT / 0.18);
      var kstepX = m2.kbx * kf * dt;
      var kstepZ = m2.kbz * kf * dt;
      if (!blocked(m2.g.position.x + kstepX, m2.g.position.z, G.MOB_W / 2, G.MOB_D / 2, true, m2,
                   m2.g.position.x, m2.g.position.z)) { m2.g.position.x += kstepX; }
      if (!blocked(m2.g.position.x, m2.g.position.z + kstepZ, G.MOB_W / 2, G.MOB_D / 2, true, m2,
                   m2.g.position.x, m2.g.position.z)) { m2.g.position.z += kstepZ; }
      m2.g.position.y = Math.sin((1 - kf) * Math.PI) * m2.kbUp;      // 上抬再落下（被打飞感）
      m2.g.rotation.z = Math.sin(m2.kbT * 60) * 0.12 * kf;           // 受击抖动
      if (m2.kbT <= 0) { m2.g.position.y = 0; m2.g.rotation.z = 0; }
    } else if (m2.kbT === undefined) { m2.kbT = 0; m2.kbx = 0; m2.kbz = 0; m2.kbUp = 0; }
    if (m2.dying === undefined) { m2.dying = -1; m2.dead = 0; }
    /* 卡死兜底已删除 ✓（分离改为速度式 ✓ 结构上不会卡死 ✓）*/
    /* ★ 死亡动画：倒地 → 停留 → 淡出 → 移除 ✓ */
    if (!m2.alive) {
      if (m2.dying >= 0) {
        m2.dying += dt;
        var dk = Math.min(1, m2.dying / 0.90);   // ★ 倒地时长 0.55 → 0.90 秒（慢一点 ✓ 看得清 ✓）
        var de2 = 1 - Math.pow(1 - dk, 3);                    // 缓出（倒下越来越慢 ✓ 像失去力气 ✓）
        m2.g.rotation.x = -de2 * (Math.PI / 2) * 0.95;        // ★ 向前倒下 90°（倒地 ✓）
        m2.g.position.y = -de2 * 0.35;                        // 略微下沉 ✓
        m2.armL.rotation.x = -1.35 + de2 * 1.9;               // 手臂垂下 ✓
        m2.armR.rotation.x = -1.35 + de2 * 1.9;
        m2.legL.rotation.x = de2 * 0.6; m2.legR.rotation.x = -de2 * 0.6;
        if (m2.shadow) { m2.shadow.material.opacity = 0.24 * (1 - de2 * 0.6); }
        if (m2.dying > 0.90) {                                 // 倒地完成 ✓
          m2.dead += dt;
          if (m2.dead > 1.00) {                                // ★ 倒地后停留 1 秒（0.35 → 1.00 ✓）
            m2.dying = -2;
          }
        }
      } else if (m2.dying === -2) {
        m2.dead += dt;
        var fk = Math.min(1, (m2.dead - 1.00) / 0.5);   // ★ 淡出 0.5 秒（起点同步 1.00 ✓）
        /* ★ 第 44 轮：材质全场共享 → 淡出前必须先克隆这一只的 ✗（不然全场一起淡）*/
      if (!m2.faded) { m2.faded = 1; m2.g.traverse(function (o) { if (o.isMesh && o.material) { o.material = o.material.clone(); } }); }
      m2.g.traverse(function (o) { if (o.isMesh && o.material) { o.material.transparent = true; o.material.opacity = 1 - fk; } });
        if (m2.shadow) { m2.shadow.material.opacity = 0.10 * (1 - fk); }
        if (fk >= 1) {                                          // 完全消失 → 移除 + 重生
          m2.dying = -3;
          scene.remove(m2.g);
          if (m2.shadow) { scene.remove(m2.shadow); }
          UI.plate.remove(m2.ui);   // ★ 移除 UI ✓
          var idx2 = mobs.indexOf(m2);
          if (idx2 >= 0) { mobs.splice(idx2, 1); }
          (function () {
            setTimeout(function () {
              if (mobs.length >= G.MOB_MAX) { return; }   // ★ 到上限就不再补 ✓
              var nm = mob(randomMobKind());
              nm.g.position.set(P.x + (Math.random() * 10 - 5), 0, P.z + (Math.random() * 10 - 5));
              nm.lv = rollMobLevel();
              nm.hpMax = mobHpAt(nm.lv);
              nm.g.scale.setScalar(mobScaleAt(nm.lv));   // ★ 体型随等级（第 37 轮）
              nm.hp = nm.hpMax; nm.cd = 1.5; nm.alive = true; nm.atkT = -1; nm.dying = -1; nm.dead = 0;
              nm.kbT = 0; nm.kbx = 0; nm.kbz = 0; nm.kbUp = 0;
              nm.ready = -1;   // ★ 蓄势字段 ✓
              nm.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.54, 14),
                new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.24, depthWrite: false }));
              nm.shadow.rotation.x = -Math.PI / 2;
              nm.shadow.scale.setScalar(mobScaleAt(nm.lv) / G.MOB_SCALE);
              scene.add(nm.shadow);
              nm.ui = mkMobUI('僵尸', nm.hpMax);   // ★ 血条 + 名字 ✓
              scene.add(nm.g); mobs.push(nm);
            }, 1200);   // ★ 重生延迟 0.9 → 1.2 秒 ✓
          })();
        }
      }
      continue;
    }
    var dx2 = P.x - m2.g.position.x, dz2 = P.z - m2.g.position.z;
    var d2 = Math.hypot(dx2, dz2) || 1;
    m2.g.rotation.y = Math.atan2(dx2, dz2);
    if (m2.shadow) { m2.shadow.position.set(m2.g.position.x, 0.09, m2.g.position.z); }
    if (m2.boxDbg) { m2.boxDbg.position.set(m2.g.position.x, 0.1, m2.g.position.z); }   // ★ 妖兽线框跟随 ✓
    /* ★ 更新妖兽头顶 UI（投影到屏幕 ✓ 血条 + 名字 ✓）*/
    if (m2.ui) {
      if (!_mv3) { _mv3 = new THREE.Vector3(); }
      // ★ 高度 = 妖兽头顶（第 40 轮把模型抬高后，这里也要 +MOB_FEET，不然血条陷进头里 ✗）
      _mv3.set(m2.g.position.x, 1.35 + MOB_FEET, m2.g.position.z).project(cam);   // ★ round596：僵尸名牌再近 50%
      var onScreen = (_mv3.z > -1 && _mv3.z < 1 && Math.abs(_mv3.x) < 1.35 && Math.abs(_mv3.y) < 1.5);
      var vis = m2.alive && onScreen;
      if (m2.dying === -2) { vis = false; }           // 淡出时不显示 ✓
      UI.plate.show(m2.ui, vis);
      if (vis) {
        var sx2 = (_mv3.x * 0.5 + 0.5) * innerWidth;
        var sy2 = (-_mv3.y * 0.5 + 0.5) * innerHeight;
        UI.plate.move(m2.ui, sx2, sy2);
        var pct = Math.max(0, Math.min(100, (m2.hp / 30) * 100));
        UI.plate.hpWidth(m2.ui, pct.toFixed(0) + '%');
        UI.plate.hpColor(m2.ui, BAR_MOB);   // ★ 妖兽一律红 ✓
        UI.plate.name(m2.ui, mobPlate(m2));   // ★ 同上（单机的本地妖兽）
        // ★ 第 127 轮：同上（单机妖兽 ✓）
        UI.plate.barText(m2.ui, String(Math.max(0, Math.round(m2.hp))), '#fff', 10);
      }
    }
    if (m2.atkT >= 0) {
      m2.atkT += dt;
      var MT = 0.75, MF = MT / 5;
      var mf = Math.min(5, Math.floor(m2.atkT / MF));
      var mt = Math.min(1, (m2.atkT - mf * MF) / MF);
      var me = mt < 0.5 ? (2 * mt * mt) : (1 - Math.pow(-2 * mt + 2, 2) / 2);
      var MKF = [
        [-1.35, 0.00, 0.00, 0.00],
        [-2.45, -0.18, -0.10, -0.10],
        [-2.75, -0.30, -0.20, -0.18],
        [-1.60, 0.25, 0.12, 0.10],
        [-0.45, 0.45, 0.28, 0.26],
        [-1.35, 0.00, 0.00, 0.00]
      ];
      var MA = MKF[mf], MB = MKF[Math.min(5, mf + 1)];
      function mlp(i) { return MA[i] + (MB[i] - MA[i]) * me; }
      m2.armL.rotation.x = mlp(0); m2.armR.rotation.x = mlp(0);
      m2.armL.rotation.z = -mlp(1); m2.armR.rotation.z = mlp(1);
      m2.g.rotation.x = mlp(2);
      // ★ 攻击时身体前扑（视觉上"扑上去" ✓ 补足距离感 ✓ 前扑 0.35 单位）
      var lunge = Math.sin(Math.min(1, m2.atkT / MT) * Math.PI) * 0.22;   // ★ 前扑 0.35 → 0.22（适度 ✓ 不贴脸 ✓）
      var fdx = P.x - m2.g.position.x, fdz = P.z - m2.g.position.z;
      var fd = Math.hypot(fdx, fdz) || 1;
      m2.g.position.x += fdx / fd * lunge * 0.08;
      m2.g.position.z += fdz / fd * lunge * 0.08;
      m2.legL.rotation.x = mlp(3) * 0.6; m2.legR.rotation.x = -mlp(3) * 0.6;
      // ★ 命中判定（用标志法 ✓ 不用时间窗口 ✗ 避免掉帧跳过 → 打不到 ✓）
      if (!m2.hitDone && m2.atkT >= 0.30 && d2 <= 2.2) {
        m2.hitDone = true;
        hurtPlayer(8, P.x, P.z, 'mob');   // ★ 'mob' 必须传 ✓ 不然开关判断不到（我第一版就漏了 ✗）
      }
      if (m2.atkT > MT) {
        m2.atkT = -1; m2.hitDone = false;
        m2.armL.rotation.set(0, 0, 0); m2.armR.rotation.set(0, 0, 0);
        m2.g.rotation.x = 0; m2.legL.rotation.x = 0; m2.legR.rotation.x = 0;
        m2.armL.rotation.x = -1.35; m2.armR.rotation.x = -1.35;
      }
    } else if (d2 > 1.55) {   // ★ 靠近距离 1.15 → 1.55（中间值 ✓ 不隔空也不重叠 ✓）
      var mx2 = m2.g.position.x + dx2 / d2 * G.MOB_SPEED * dt;
      var mz2 = m2.g.position.z + dz2 / d2 * G.MOB_SPEED * dt;
      // ★ 妖兽用矩形 ✓ 检测【静态物件 + 其它妖兽 + 人物】✓ 跳过自己 ✓
      var mhw = G.MOB_W / 2, mhd = G.MOB_D / 2;
      var mox = m2.g.position.x, moz = m2.g.position.z;      // ★ 移动前位置（已经重叠就放行 ✓ 不卡死 ✓）
      if (!blocked(mx2, moz, mhw, mhd, true, m2, mox, moz)) { m2.g.position.x = mx2; }
      if (!blocked(m2.g.position.x, mz2, mhw, mhd, true, m2, m2.g.position.x, moz)) { m2.g.position.z = mz2; }
      /* ★ 妖兽分离（速度式 ✓ 用空间网格只查邻居 ✓ O(1) 均摊 ✓ 不直接改位置 ✗）
         排斥力累加到 sepX/sepZ ✓ 与移动向量合并 ✓ 物理自然 ✓ 不会卡死 ✓ */
      var sepX = 0, sepZ = 0;
      var nbrs = nearMobs(m2.g.position.x, m2.g.position.z);
      for (var oi = 0; oi < nbrs.length; oi++) {
        var om = nbrs[oi];
        if (om === m2 || !om.alive) { continue; }
        var odx = m2.g.position.x - om.g.position.x, odz = m2.g.position.z - om.g.position.z;
        var od = Math.hypot(odx, odz);
        var mind = (G.MOB_W + G.MOB_D) / 4 + 0.05;
        if (od < 0.0001) { odx = Math.random() - 0.5; odz = Math.random() - 0.5; od = Math.hypot(odx, odz) || 1; }
        if (od < mind) {
          var w = (mind - od) / mind;             // 越近推力越大 ✓
          sepX += (odx / od) * w * G.MOB_SPEED * 1.6;
          sepZ += (odz / od) * w * G.MOB_SPEED * 1.6;
        }
      }
      // 分离速度并入移动（两轴分别检测 ✓ 可沿边滑 ✓）
      if (sepX !== 0 || sepZ !== 0) {
        var sox = m2.g.position.x, soz = m2.g.position.z;
        var sepx = sox + sepX * dt, sepz = soz + sepZ * dt;
        if (!blocked(sepx, soz, mhw, mhd, true, m2, sox, soz)) { m2.g.position.x = sepx; }
        if (!blocked(m2.g.position.x, sepz, mhw, mhd, true, m2, m2.g.position.x, soz)) { m2.g.position.z = sepz; }
      }
      // ★ 与人物保持不重叠（真实阻挡 ✓ 不再硬推开 ✗）
      var pd = Math.hypot(P.x - m2.g.position.x, P.z - m2.g.position.z);
      var minD = (G.MOB_D + G.BODY_D) / 2 + 0.04;   // 两箱边缘接触的临界 ✓
      if (pd > 0.001 && pd < minD) {
        // 推开妖兽（人物不动 ✓ 保持玩家控制感 ✓）
        var pox = m2.g.position.x, poz = m2.g.position.z;
        var nx3 = pox + (pox - P.x) / pd * (minD - pd) * 0.6;
        var nz3 = poz + (poz - P.z) / pd * (minD - pd) * 0.6;
        if (!blocked(nx3, poz, mhw, mhd, false, null, pox, poz)) { m2.g.position.x = nx3; }
        if (!blocked(m2.g.position.x, nz3, mhw, mhd, false, null, m2.g.position.x, poz)) { m2.g.position.z = nz3; }
      }
      m2.walkT = (m2.walkT || 0) + dt * 5.4;                 // ★ 每只自己的相位（第 40 轮）
      m2.legL.rotation.x = Math.sin(m2.walkT) * MOB_SWING;
      m2.legR.rotation.x = -Math.sin(m2.walkT) * MOB_SWING;
      // ★ 逼近时手臂微微张开 + 上下小幅晃动（有生命感 ✓ 不僵硬 ✓）
      m2.armL.rotation.x = -1.35 + Math.sin(mobT * 5) * 0.12;
      m2.armR.rotation.x = -1.35 - Math.sin(mobT * 5) * 0.12;
      m2.g.rotation.z = Math.sin(mobT * 5) * 0.04;
      /* 已由上方"真实阻挡"处理 ✓ */
    } else {
      /* ★ 已进入攻击距离 → 【蓄势】→ 攻击 → 冷却（全程有动作 ✓ 不呆站 ✗）*/
      if (m2.ready === undefined) { m2.ready = -1; }
      m2.cd -= dt;
      if (m2.ready >= 0) {
        /* 蓄势中：双臂慢慢抬起 + 身体后仰 + 左右晃动 + 原地踏步（随时要扑 ✓）*/
        m2.ready += dt;
        var rk = Math.min(1, m2.ready / m2.readyDur);
        var rEase = rk * rk * (3 - 2 * rk);                      // 平滑 ✓
        m2.armL.rotation.x = -1.35 - rEase * 0.85;               // ★ 双臂抬起（-1.35 → -2.20 ✓）
        m2.armR.rotation.x = -1.35 - rEase * 0.85;
        m2.armL.rotation.z = -rEase * 0.30;                      // 略微张开 ✓
        m2.armR.rotation.z = rEase * 0.30;
        m2.g.rotation.x = rEase * 0.22;                          // ★ 身体后仰（蓄力 ✓）
        // 左右晃动（紧张感 ✓ 频率 8 ✓）
        m2.g.rotation.y = Math.atan2(P.x - m2.g.position.x, P.z - m2.g.position.z) + Math.sin(m2.ready * 8) * 0.10 * rEase;
        // 原地踏步（不是静止 ✓）
        m2.legL.rotation.x = Math.sin(m2.ready * 14) * 0.22 * rEase;
        m2.legR.rotation.x = -Math.sin(m2.ready * 14) * 0.22 * rEase;
        // 微微前倾又缩回（蓄势的呼吸感 ✓）
        m2.g.position.y = Math.abs(Math.sin(m2.ready * 8)) * 0.04;
        if (m2.ready >= m2.readyDur) {                            // 蓄势完成 → 扑击 ✓
          m2.atkT = 0; m2.ready = -1; m2.g.position.y = 0;
          sfx('bite', 1.0);   // ★ MC 僵尸咬击声 ✓
        }
      } else if (m2.cd <= 0) {
        /* 冷却结束 → 开始蓄势（随机 0.4~0.7 秒 ✓ 不规律 ✓）*/
        m2.ready = 0; m2.readyDur = 0.55 + Math.random() * 0.40;
        sfx('groan', 0.85);   // ★ MC 僵尸低吼（3 变体 ✓）
      }
      // 攻击命中判定（在攻击动画中段触发 ✓）
      if (m2.atkT >= 0 && m2.atkT > 0.30 && m2.atkT < 0.34 && !m2.hitDone) {
        m2.hitDone = true;
        hurtPlayer(8, P.x, P.z, 'mob');   // ★ 'mob' 必须传 ✓ 不然开关判断不到（我第一版就漏了 ✗）
      }
      if (m2.atkT < 0) { m2.hitDone = false; }
      if (m2.atkT > 0.80) { m2.cd = 1.25; }   // ★ 攻击冷却 0.55 → 1.25 秒（频率降低 ✓）   // 攻击结束 → 冷却 0.55 秒（回到蓄势 ✓ 不静止 ✗）
    }
  }

  /* ---- 相机 ---- */
  /* ★ round427：拖影衰减在这里统一调（不管攻没攻击 ✓ 收招后也能自然消失 ✓）*/
  try {
    trailFade('me', dt, atkT >= 0);
    /* ★ 已经不在的玩家→ 把他们的拖影也收了 ✓ */
    for (var _tid in TRAILS) {
      if (_tid === 'me') { continue; }
      var _tr = TRAILS[_tid];
      if (!_tr || !_tr.on) {
        if (_tr && _tr.mesh) { _tr.mesh.visible = false; }
        continue;
      }
      var _ot = (NET && NET.others) ? NET.others[_tid] : null;
      trailFade(_tid, dt, !!(_ot && _ot.atkT >= 0));
    }
  } catch (e0) { }
  var sx = 0, sz = 0;
  if (shake > 0.01) { sx = (Math.random() - 0.5) * shake; sz = (Math.random() - 0.5) * shake; shake *= 0.88; } else { shake = 0; }
  /* ★ 第 306 轮：相机跟着地形高度走 ✗
     不然爬上山之后人物会掉到画面外面 ✓
     ★ 用【缓动】而不是直接跟随 ✗ 上下坡时镜头才不会一跳一跳 ✓ */
  /* ★★★ round308（用户："跳跃动画的高度不够高，跳跃动画不明显"）★★★
     根因：相机跟的是 P.y ✗ 而 P.y【包含跳跃高度】✓
           → 一跳起来相机跟着升 ✗ 人和画面的相对位移几乎为 0 ✗ 看不出在跳 ✓
     修：相机跟【脚下的地面高度】P.gy ✗ 人跳起来就真的离开画面 ✓
     ★ 缓动也调慢（dt*8 → dt*5）✗ 上下坡时镜头更稳 ✓ */
  var _camTgt = (typeof P.gy === 'number' && isFinite(P.gy)) ? P.gy : P.y;
  _camY = _camY + (_camTgt - _camY) * Math.min(1, dt * 5);
  /* ★★★ round452：登录界面的"电影镜头" ✗
     用户："感觉跟我们的游戏画面不搭"✗
     → 登录背景就用游戏自己的画面 ✓ 相机绕着出生点慢慢转 ✓
     ★ 这样进游戏前后看到的是同一个世界，不会有割裂感 ✓ */
  if (typeof LOGIN_CINE !== 'undefined' && LOGIN_CINE) {
    var _la = (performance.now() / 1000) * 0.055;
    var _lr = 17.0 + 2.2 * Math.sin(_la * 0.43);
    var _lh = _camY + 7.6 + 0.8 * Math.sin(_la * 0.7);
    cam.position.set(P.x + Math.cos(_la) * _lr, _lh, P.z + Math.sin(_la) * _lr);
    cam.lookAt(P.x, _camY + 1.05, P.z);
  } else {
  /* ★ round456：进了游戏 → 登录那片草方块地收起来 ✓ */
  /* ★ round498：先平滑一次（拖手只改目标角 ✗ 这里追上去 ✓）*/
  fpViewTick(dt);
  camStep(dt);
  var _isFP = (typeof CAM_VIEW !== 'undefined' && CAM_VIEW === 'first');
  try {
    if (H && H.g) { H.g.visible = !_isFP && !dead; }
    if (H && H.shadow) { H.shadow.visible = !_isFP && !dead; }
    if (_selfUI) { UI.plate.show(_selfUI, !_isFP); }
  } catch (eFP0) { }
  if (_isFP) {
    /* 第一人称：相机在头部，视角朝 CAM_YAW，俯仰跟随相机解锁角度 */
    var _eyeY = P.y + 1.78 * heroScaleOf(heroVisualSize());
    var _lookP = Math.max(-1.15, Math.min(1.15, 0.9 - CAM_PITCH));
    var _lc = Math.cos(_lookP), _ls = Math.sin(_lookP);
    var _fx = -Math.sin(CAM_YAW) * _lc, _fz = -Math.cos(CAM_YAW) * _lc;
    cam.position.set(P.x, _eyeY, P.z);
    cam.lookAt(P.x + _fx * 10, _eyeY + _ls * 10, P.z + _fz * 10);
  } else {
  /* 第三人称：参考 MC —— 镜头贴近角色肩后，不用 21 米的俯视距离 */
  var _isThird = (typeof CAM_VIEW !== 'undefined' && CAM_VIEW === 'third');
  var _dist = _isThird ? 9.0 : G.CAM_DIST;
  var _tgtY = _isThird ? (_camY + 1.55) : (_camY + 1.4);
  var _camR = _dist * Math.cos(CAM_PITCH);
  var _cyw = Math.cos(CAM_YAW), _syw = Math.sin(CAM_YAW);
  var _shx = sx * _cyw - sz * _syw;
  var _shz = sx * _syw + sz * _cyw;
  cam.position.set(P.x + _camR * _syw + _shx,
                   _tgtY + _dist * Math.sin(CAM_PITCH),
                   P.z + _camR * _cyw + _shz);
  cam.lookAt(P.x, _tgtY, P.z);
  }
  }
  sun.position.set(P.x + 38, _camY + 70, P.z + 26);
  sun.target.position.set(P.x, _camY, P.z);
  sun.target.updateMatrixWorld();
  if (H.shadow) { H.shadow.position.set(P.x, P.y + 0.09, P.z); }
  if (H.boxDbg) { H.boxDbg.position.set(P.x, 0.1, P.z); }   // ★ 人物碰撞箱线框跟随 ✓

  /* ★★★ round332（用户："还是看不其它玩家跳，站着陷进"）★★★
     前两轮我在一个一个补"写位置"的地方 ✗ 补不全 ✓
     改成【渲染前统一纠正】：扫一遍其他玩家 ✗
     用他们最终渲染出的 x/z 算地形高度 ✗ 再叠跳跃偏移 ✓
     → 前面有多少处写错了 y 都会被这里盖掉 ✓ */
  if (NET.on && NET.others) {
    for (var _fu in NET.others) {
      var _fo = NET.others[_fu];
      if (!_fo) { continue; }
      /* ★★★ round335 修的真 bug（三轮都白改的根因）★★★
         真实玩家存的是 o.hh（模型对象）✗ 根本没有 o.g 这个字段 ✓
         而我一直改的是 o.g.position ✗ 那些代码对真实玩家【从不执行】✓
         → 我改了三轮死代码（用户："为什么僵尸不穿模，别的玩家不行"）
         ★ 现在正确取对象：有 hh 用 hh.g ✗ 没有才退回 g ✓ */
      var _mg = (_fo.hh && _fo.hh.g) ? _fo.hh.g : _fo.g;
      if (!_mg || !_mg.visible) { continue; }
      var _tj = _fo.tgtJy || 0;
      _fo.jyS = (_fo.jyS === undefined) ? _tj
                 : (_fo.jyS + (_tj - _fo.jyS) * Math.min(1, dt * 14));
      if (!isFinite(_fo.jyS)) { _fo.jyS = _tj; }
      var _gy = terYAt(_mg.position.x, _mg.position.z);
      /* ★★★ round401 修的真 bug（用户："暴击跳起来打没有"）★★★
         ★ 根因：暴击跳打是在【动画那段】把 y 加上去的 ✗
           而这个【渲染前统一覆盖】每帧重设 y ✗ 把加上去的部分抹掉了 ✓
           → 本地看得见（本地没有这个覆盖）✗ 别人看不见 ✓
         ★ 修：把暴击的抛物线也算进这个最终 y 里 ✓ */
      var _hop = 0;
      if (_fo.critUntil) {
        var _hp2 = 1 - (_fo.critUntil - performance.now()) / 400;
        if (_hp2 > 0 && _hp2 < 1) { _hop = Math.sin(_hp2 * Math.PI) * 3.4; }
      }
      /* ★ round407（交接文档第四节 ④）：别人被长枪挑飞 → 他也要真的升空
         ★ 服务端广播 launch_him ✗ 这里按他自己那条抛物线抬模型 ✓
         ★ 和上面 _hop 一样，必须算进【最终 y】里 ✗ 绝不能加在动画那段 ✓ */
      var _fly = 0;
      if (_fo.flyT0) {
        var _ft = (performance.now() - _fo.flyT0) / (_fo.flyDur || 1500);
        if (_ft >= 0 && _ft < 1) {
          _fly = Math.sin(_ft * Math.PI) * (_fo.flyH || 3.72);
        } else {
          _fo.flyT0 = 0;
        }
      }
      var _foTown = (typeof townIn === 'function') ? townIn(_mg.position.x, _mg.position.z) : false;
      if (_fo.hh && _fo.hh.g) {
        var _fsz = heroScaleOf(_foTown ? 1 : (_fo.sz || 1));
        if (Math.abs(_fo.hh.g.scale.x - _fsz) > 0.0005) { _fo.hh.g.scale.set(_fsz, _fsz, _fsz); }
        if (_foTown && _fo.hh.sw) { _fo.hh.sw.visible = false; }
        else if (!_foTown && _fo.hh.sw && !(_fo.seat != null && String(_fo.seat) !== '-1')) {
          _fo.hh.sw.visible = true;
        }
      }
      var _os = ((_fo.seat != null && String(_fo.seat) !== '-1')
                 && typeof townSeatById === 'function') ? townSeatById(_fo.seat) : null;
      if (_os) {
        _gy = terYAt(_os.x, _os.z);
        _mg.position.set(_os.x, _gy - 0.06, _os.z);
        _mg.rotation.set(0, _os.yaw, 0);
        if (_fo.hh) {
          _fo.hh.legL.rotation.x = -1.34;
          _fo.hh.legR.rotation.x = -1.34;
          _fo.hh.armL.rotation.x = -0.58;
          _fo.hh.armR.rotation.x = -0.58;
          _fo.hh.sw.visible = false;
          if (_fo.hh.legL.children[0]) { _fo.hh.legL.children[0].rotation.x = 0.82; }
          if (_fo.hh.legR.children[0]) { _fo.hh.legR.children[0].rotation.x = 0.82; }
        }
      } else {
        _mg.position.y = _gy + Math.max(0, _fo.jyS) + _hop + _fly;
        if (_fo.hh) {
          if (_fo.hh.sw && _fo.hh.sw.visible === false) { _fo.hh.sw.visible = true; }
          if (_fo.hh.legL.children[0]) { _fo.hh.legL.children[0].rotation.x = 0; }
          if (_fo.hh.legR.children[0]) { _fo.hh.legR.children[0].rotation.x = 0; }
        }
      }
    }
  }

  /* ★★★ round407（交接文档第四节 ④）：【我】被长枪挑飞 → 接管模型高度 ★★★
     ★ 放在渲染前的最后一刻 ✗ 这是交接文档第五节第 5 条那个坑：
       渲染前有"统一纠正 y"的循环 ✓ 任何加在它之前的高度变化都会被抹掉 ✓
       （暴击跳打就是这么丢过一次 ✓）
     ★ 用 += ✗ 保留走路起伏/其他偏移 ✓（升空期间反正走不了 ✓）
     ★ 相机跟的是 P.gy（地面）✗ 所以人真的会离开画面 ✓ 一眼看得出被挑飞 ✓ */
  var _flyMe = flyYNow();
  if (_flyMe > 0) { H.g.position.y += _flyMe; }

  /* ★ round434：四肢实例矩阵（在所有姿势算完、渲染之前 ✓）*/
  try { limbInstTick(); } catch (e0) { }
  try { lvFxTick(dt); } catch (e1) { }
  for (var _fm in NET.rmobs) {
    var _fr = NET.rmobs[_fm];
    if (_fr && _fr.flashT > 0) { _fr.flashT -= dt; }
  }

  rd.render(scene, cam);

  /* ---- 面板 ---- */
  fpsT += 1;
  if (fpsT >= 30) {
    var now = performance.now();
    if (fpsLastMs) {
      var ms = (now - fpsLastMs) / fpsT;
      _lastMs = ms;
      /* ★ 这里原来是 `if (el) { ... }` / `if (el2) { ... }` —— el / el2 是拆分时丢的自由变量 ✗
         原件（web/3d-v4.html 第 2399、2403 行）是：
             var el = document.getElementById('fps');
             var el2 = document.getElementById('setFps');
         和上面的 st 一样：那只是"元素不存在就别写"的 DOM 判断，
         现在归平台层了（UI.text 内部就是 getElementById + if (e) ✓），core 里不该再留 ✗ */
      /* ★ round334：临时诊断 —— 直接在 FPS 后面显示"其他玩家"的真实数据 ✓
         ★ 为什么加这个：我连续三轮靠读代码猜 ✗ 猜错了 ✗
           这三个数（人数 / 他的 y / 他的跳跃偏移）能一次定位问题在哪一层 ✓
         ★ 定位完就删掉 ✓ */
      UI.text('fps', Math.round(1000 / ms) + ' FPS · ' + ms.toFixed(1) + 'ms');
      if (UI.visible('infoBox')) { UI.text('infoBox', infoText()); }
      UI.text('setFps', Math.round(1000 / ms) + ' FPS');
      /* ★ round426：性能面板（只有用户开了才调 ✓ 不然一行都不执行 ✓）
         ★ 为什么放这里：这段本来就是"每 30 帧算一次平均帧时间" ✓ 现成的 ✓ */
      if (SETCFG && SETCFG.perf && typeof UI.perfBar === 'function') {
        UI.perfBar({ ms: ms });
      }
    }
    fpsLastMs = now; fpsT = 0;
  }
  diagTick++;
  if (diagTick % 20 === 0) {
    /* ★ 第 32 轮：用户要求诊断里【去掉"网格桶"和"音效"】——
       音效进度本来还有个平台层的回调也在往这块写，那边也一起删了 ✓
       现在只留：坐标 · 实体数 · 道友数（正好一行，窄屏会自动换第二行 ✓）*/
    /* ★ 第 126 轮（用户）：
       · "玩家"两个字不要了 ✗（反正就是你自己的坐标 ✓ 省字 ✓）
       · 坐标不要小数 ✗（toFixed(1) → Math.round ✓ 粒度到米就够了 ✓）*/
    UI.text('diag', Math.round(P.x) + ', ' + Math.round(P.z)
      + '   实体 ' + (NET.on ? Object.keys(NET.rmobs).length : mobs.length)
      + '   道友 ' + Object.keys(NET.others).length)
      /* ★ 第 161 轮（用户要求）：版本号不显示了 ✗
         原因：用户觉得占地方 ✗ 而且也没帮上忙 ✗
         ★ window.BUILD / BUILD_TAG 保留着 ✓（不占画面 ✗ 以后想用随时能用 ✓）*/
  }
}

/* ============================================================================
   ★ 启动（必须是整个文件的最后一条语句）
   ----------------------------------------------------------------------------
   为什么放最后：init() 会读一大票顶层 var（WSC / PROTO_VER / SGrid / _toastEl /
   SFX_QUEUE / _ov3 …），而 `var` 只提升声明、不提升赋值。
   只要启动调用排在任何一个它要读的顶层 var 之前，那个变量就是 undefined ✗
   （第 26 轮就是这么炸的：WSC undefined → "Cannot set properties of undefined"）
   ============================================================================ */
if (typeof THREE === 'undefined') {
  E('three.js 未加载 ✗');
} else {
  try { init(); } catch (e) { E('启动失败：' + (e && e.message ? e.message : e)); }
}