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
  CAM_PITCH: 1.02,
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
  PROP_DENSITY: 34,
  SPAWN_SAFE: 17,
  MOB_COUNT: 3,
  MOB_MAX: 60,          // ★ 实体上限（超过 60 手机掉到 60 帧以下 ✓ 所有生成路径都受它限制 ✓）
  FRAME_MS: 4
};

/* ============ 设置（必须在所有函数之前 ✓）============ */
/* ★ v5（第 31 轮）：新增 atkSize（攻击键大小）；顺便记住设置面板停在哪个分类（setTab）✓ */
var SET_DEF = { dpr: 2.0, aa: 'off', detail: 'mid', showFps: true, mobDmg: true,
                atkSize: 84, setTab: 'view' };
var SETCFG = { v: 5 };
var _savedVol = null;
try { var _sv = JSON.parse(UI.store.get('xx3d_set') || '{}'); if (_sv && _sv.v === 5) { SETCFG = _sv; } } catch (e) { }
var SETCFG_VER = 5;
var DETAIL_RANGE = { low: 16, mid: 28, high: 40 };
function setDpr() { return (SETCFG && SETCFG.dpr) ? SETCFG.dpr : SET_DEF.dpr; }
function setAA() { return (SETCFG && SETCFG.aa) ? SETCFG.aa : SET_DEF.aa; }
/* 攻击键直径（px）。夹一个范围，免得存档被改坏之后按钮大到点不到 ✓ */
function setAtkSize() {
  var v = (SETCFG && SETCFG.atkSize) || SET_DEF.atkSize;
  return (v >= 48 && v <= 180) ? v : SET_DEF.atkSize;
}

/* setDetail 已搬到 platform/web.js */

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
var T = {}, M = {}, H = null;
var P = { x: 0, z: 0, yaw: 0 };
var jx = 0, jy = 0, joyId = null, jox = 0, joy0 = 0;
var keys = {}, atkHeld = false;
var solids = [], propSolids = [], mobs = [], PROP_MESHES = [], GROUNDMESH = null;
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
  zhurt: ['zhurt1.mp3', 'zhurt2.mp3'],
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
  zhurt: ['zhurt1.wav', 'zhurt2.wav'],
};

/* ===== ★ 多人联网配置（必须在 init 调用之前 ✓ 否则 NET undefined ✗）===== */
var NET = {  on: false, token: '', lastPost: 0, lastGet: 0,
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
  sndRange: 45,              // ★ 多远以内的动静才听得见（和视野范围配套 ✓）
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
  cam = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 400);
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
  sun.shadow.camera.left = -45; sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 220;
  sun.shadow.bias = -0.0007;
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
  H = hero(); H.g.scale.set(G.HERO_SCALE, G.HERO_SCALE, G.HERO_SCALE); scene.add(H.g);
  H.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.62, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.26, depthWrite: false }));
  H.shadow.rotation.x = -Math.PI / 2; scene.add(H.shadow);

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
    m.ui = mkMobUI('僵尸', 30);   // ★ 血条 + 名字 ✓
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
  var sp = findOpenSpot(0, 0, G.BODY_W / 2, G.BODY_D / 2);
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
  scene.add(GROUNDMESH);
  _groundBX = bx; _groundBZ = bz;
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
      if (Math.sqrt(wx * wx + wz * wz) < G.SPAWN_SAFE) { continue; }
      var hh = ((gx * 2654435761) ^ (gz * 40503)) & 0xffffffff, q = Math.abs(hh % 1000);
      if (q % G.PROP_DENSITY !== 0) { continue; }
      if ((q % 250) >= 80 && (q % 250) < 96) { markHouseCells(gx, gz); }
    }
  }
  for (i = x0 - H; i < x0 + PROP_CHUNK + H; i++) {
    for (j = z0 - H; j < z0 + PROP_CHUNK + H; j++) {
      var gx2 = i, gz2 = j;
      var wx2 = worldX(gx2), wz2 = worldZ(gz2);
      if (Math.sqrt(wx2 * wx2 + wz2 * wz2) < G.SPAWN_SAFE) { continue; }
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
function moveWithCollision(dx, dz, hw, hd, byMob, skipMob) {
  var ox = P.x, oz = P.z;                 // ★ 移动前的位置（传给 blocked 做"已经重叠就放行"判断 ✓）
  var nx = ox + dx, nz = oz + dz;
  if (!blocked(nx, oz, hw, hd, byMob, skipMob, ox, oz)) { P.x = nx; }
  if (!blocked(P.x, nz, hw, hd, byMob, skipMob, P.x, oz)) { P.z = nz; }
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

/* ============================================================
   ★ 音效系统（播放 Minecraft 原版音效 ✓ 31 个 ogg · 287KB ✓）
   ============================================================ */


/* loadSfx 已搬到 platform/web.js */


/* 尝试加载音频：mp3 → ogg → wav 三级回退 ✓ 全过程记录 ✓ */
var SFX_ERR = [];

/* tryOne 已搬到 platform/web.js */

function nextTry(key, attempt) {
  // 顺序：wav(2) → mp3(0) → ogg(1) ✓
  if (attempt === 2 && SFX_FILES[key] && SFX_FILES[key][0]) { tryOne(key, '/assets/sfx/' + SFX_FILES[key][0], 0); }
  else if (attempt === 0 && SFX_FILES_OGG[key] && SFX_FILES_OGG[key][0]) { tryOne(key, '/assets/sfx/' + SFX_FILES_OGG[key][0], 1); }
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
  if (d > NET.sndRange) { return; }
  var k = 1 - d / NET.sndRange;
  k = k * k;                                  // ★ 平方衰减（近处清楚 ✓ 远处迅速变小 ✓）
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

/* ============ 人物（小头 + 举剑 ✓）============ */
function hero() {
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
  return { g: g, armL: armL, armR: armR, legL: legL, legR: legR, sw: sw };
}

/* ★ 妖兽头顶 UI（血条 + 名字 ✓ 用 CSS 元素 + 每帧投影到屏幕 ✓）*/

/* mkMobUI 已搬到 platform/web.js */

var _mv3 = null;

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
  { mix: 0x8a7a66, k: 0.60, glow: 0 }, { mix: 0x8a7a66, k: 0.55, glow: 0 },
  { mix: 0xb8c4cc, k: 0.25, glow: 0 }, { mix: 0xb8c4cc, k: 0.22, glow: 0 },
  { mix: 0x7a8a9a, k: 0.35, glow: 0.25 }, { mix: 0x7a8a9a, k: 0.35, glow: 0.25 },
  { mix: 0x7a8a9a, k: 0.35, glow: 0.25 },
  { mix: 0xc0d4e4, k: 0.35, glow: 0.45 }, { mix: 0xc0d4e4, k: 0.35, glow: 0.45 },
  { mix: 0xc0d4e4, k: 0.35, glow: 0.45 },
  { mix: 0xf0e0a8, k: 0.45, glow: 0.85 }, { mix: 0xf0e0a8, k: 0.45, glow: 0.85 }
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
function fillHeldWeapon(sw, look, tier) {
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
  /* ★★ 第 54 轮：刀刃朝向修正（用户报的"拿着斧头时刀刃不是朝下"）★★
     病根：零件数据是"宽在 X、薄在 Z"——
           也就是【正面看是刀的平面】（示意图就是这么画的 ✓ 所以图标也好看 ✓）
           但挥砍动画是绕 X 轴往下劈 ✗
           不转的话，砸下去的是刀【面】而不是刀【刃】✗（等于拿刀背拍人）
     修法：整把武器绕自身 Y 轴转 -90° → 原来朝 ±X 的刃口变成朝 ±Z（正前/正后）✓
           往下劈时刃先着 ✓
     ★ 八种武器一起修好（不是只修斧头）—— 因为它们共用同一套"宽在X"的数据 ✓
     ★ 图标不受影响：图标是"沿 -Z 看的平面投影"，正是示意图那个角度 ✓ */
  g.rotation.y = -Math.PI / 2;
  sw.add(g);
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
  G.ATK_RANGE = b ? (+b.reach || 2.4) : 2.4;
  G.ATK_ARC = b ? (+b.arc || 1.05) : 1.05;
  G.ATK_CD = 0.62 / Math.max(0.6, Math.min(2.2, spd));
  // ★ 手上的模型也跟着换（第 49 轮 ✓ 换武器立刻能看出来 ✓）
  fillHeldWeapon(typeof H !== 'undefined' && H ? H.sw : null);
  return MY_WEAPON;
}
/* ★ 模型往下埋了多少（量出来的：脚在 y=-0.46）—— mob() 会把整体抬回来 ✓
   ★ 走路摆动的幅度也调大了：原来 0.6 弧度 × 只露 0.25 米的腿 = 看不出来在走 ✗ */
var MOB_FEET = 0.46;
var MOB_SWING = 0.85;
/* 职业名列表（单机刷怪随机挑一个用 ✓ 联机时职业由服务器发下来 ✓）
   ★ 顺序和 server/mobs.py 的 KINDS 保持一致 —— 不一致也不崩（查不到就用默认外观 ✓）*/
var MOB_KINDS = ['白领', '医生', '工人', '学生', '外卖', '保安', '程序员', '健身教练'];
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

/* 把一堆方块合并成一个几何体（颜色 → 顶点色 ✓）
   parts: [[宽,高,深,颜色, x,y,z, 绕Z旋转(可选)] ...]
   ★ three.min.js 里没有 mergeGeometries（那在 examples 里 ✗）→ 自己拼 ✓ */
function mergeBoxes(parts) {
  var pos = [], nor = [], col = [];
  var c = new THREE.Color();
  var v = new THREE.Vector3(), q = new THREE.Quaternion(), mm = new THREE.Matrix4();
  var one = new THREE.Vector3(1, 1, 1), ZAX = new THREE.Vector3(0, 0, 1);
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    var bg = new THREE.BoxGeometry(p[0], p[1], p[2]).toNonIndexed();   // ★ 去索引才好直接拼 ✓
    if (p[7]) { q.setFromAxisAngle(ZAX, p[7]); } else { q.set(0, 0, 0, 1); }
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

function mobGeoOf(kind) {
  var key = kind || 'default';
  var hit = MOB_GEO[key];
  if (hit) { return hit; }
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
  var geo = mergeBoxes(parts);
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

/* ============ 妖兽（默认外观 = 绿僵尸；带职业就套 MOB_CLASSES）============
   ★ 第 44 轮：改成 1 个合并的静态件 + 4 条肢体 = 5 次 draw call（原来 21 次 ✗）*/
function mob(kind) {
  var cls = mobClassOf(kind) || {};
  var thick = cls.thick || 1;
  var g = new THREE.Group();
  var bodyMesh = new THREE.Mesh(mobGeoOf(kind), vcMat());
  bodyMesh.castShadow = true; g.add(bodyMesh);
  var casters = [bodyMesh];      // ★ 第 44 轮：投影网格列表（按距离开关用 ✓）
  function limb(c, x, isArm) {
    var p = new THREE.Group(); p.position.set(x, (isArm ? 1.60 : 0.60) + MOB_FEET, 0);
    if (isArm) { p.rotation.x = -1.35; }
    var b = new THREE.Mesh(limbGeoOf(isArm, thick, c), vcMat());
    b.castShadow = true; p.add(b); g.add(p); casters.push(b); return p;
  }
  var armC = cls.limb || 0x5a8a48;
  var legC = cls.leg || 0x3e3ea0;
  var legL = limb(legC, -0.25 * thick, 0), legR = limb(legC, 0.25 * thick, 0);
  var armL = limb(armC, -0.64 * thick, 1), armR = limb(armC, 0.64 * thick, 1);
  return { g: g, mid: NET.pid + ':' + (++NET.mobSeq),   // ★ 全局唯一 id（多人同步用 ✓）
           legL: legL, legR: legR, armL: armL, armR: armR, casters: casters };
}
/* ============ 伤害数字 ============ */
var REUSE_V3 = { v: null };

/* dmg 已搬到 platform/web.js */


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
  var nm = (m.kind ? m.kind : '僵尸');
  return nm + (m.lv ? ' Lv.' + m.lv : '') + ' '
    + Math.max(0, Math.round(m.hp)) + '/' + Math.round(m.hpMax || 30);
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
  sm.ui = mkMobUI('僵尸', sm.hpMax);
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
  try { s.send(JSON.stringify({ t: t, d: d || {} })); return true; }
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
      x: w.x, z: w.z, yaw: w.y, hp: w.hp, hpm: 0,
      ct: w.t, atk: w.atk,
      wlook: w.w,            // ★ 第 61 轮：他手上是什么武器（动作原型要一致 ✓）
      wtier: (typeof w.wt === 'number') ? w.wt : 0,   // ★ 第 65 轮：品阶（模型颜色/发光用 ✓）
      inv: +w.inv || 0,      // ★ 第 63 轮：他的无敌剩余（队友刚复活要看得见 ✓）
      dead: !!w.d            // ★ 第 57 轮：他倒下了没有（服务器同步给我的 ✓）
    }, t);
  }
  for (var uid in NET.others) { if (!seen[uid]) { removeOther(uid); } }

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
    dmg(etxt, +e2.x, 2.4, +e2.z, !!e2.crit);
    if (e2.back && +e2.mb > 1.0) {
      // 额外 = 总额 - 不背击时的那一份（服务器给了倍率 ✓ 客户端不用自己猜公式 ✓）
      var extra = Math.max(1, Math.round(edv - edv / (+e2.mb)));
      fxNum('额外 +' + extra, '#ffd83d', +e2.x, 2.9, +e2.z);
    }
    if (q2 === 0) {
      sfx(e2.crit ? 'crit' : 'hit', 1.0);
      sfx('zhurt', 0.7);
      shake = e2.crit ? 0.45 : 0.22;
    }
  }

  /* ---- ★ 我的经验 / 等级（变了服务器才带）→ 直接刷左上角 HUD ✓ ---- */
  if (d.me) {
    if (WSC.role) {
      WSC.role.level = d.me.lv || WSC.role.level || 1;
      WSC.role.exp = d.me.exp || 0;
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
  if (n === 1) { out.x = buf[0].x; out.z = buf[0].z; out.yaw = buf[0].yaw; return true; }
  while (buf.length > 2 && buf[1].t <= t) { buf.shift(); }
  var a = buf[0], b = buf[1];
  if (t <= a.t) { out.x = a.x; out.z = a.z; out.yaw = a.yaw; return true; }
  var seg = b.t - a.t;
  if (seg <= 0.0001) { out.x = b.x; out.z = b.z; out.yaw = b.yaw; return true; }
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
    var uMax = NET.extrapMax || 12;
    if (u > uMax) { u = uMax; }
  }
  out.x = a.x + (b.x - a.x) * u;
  out.z = a.z + (b.z - a.z) * u;
  var dy = b.yaw - a.yaw;
  while (dy > Math.PI) { dy -= Math.PI * 2; }
  while (dy < -Math.PI) { dy += Math.PI * 2; }
  out.yaw = a.yaw + dy * u;
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
  var now = performance.now() / 1000;
  wsSend('move', {
    x: +P.x.toFixed(2),
    z: +P.z.toFixed(2),
    yaw: +P.yaw.toFixed(3),
    t: +now.toFixed(3),          // ★ 我的钟（别人据此排队 → 不受网络抖动影响 ✓）
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
  if (!o) {
    var hh = hero();                       // 复用玩家模型 ✓
    // ★ 第 65 轮：拿【他】的武器，不是我的 ✗
    // ★ 踩过的坑：这里必须读【映射后】的 wlook/wtier ✗
    //   写成 w.w / w.wt（那是快照的原始字段名）→ 永远 undefined
    //   → 兜底成 'sword' → 所有队友都被画成一把普通单手剑 + 用"扫"的动作 ✗
    fillHeldWeapon(hh.sw, w.wlook || 'sword',
                   (typeof w.wtier === 'number') ? w.wtier : 0);
    hh.g.scale.set(G.HERO_SCALE, G.HERO_SCALE, G.HERO_SCALE);
    hh.g.position.set(w.x, 0, w.z);
    scene.add(hh.g);
    var ui = mkMobUI((w.name || '道友') + ' ' + (w.realm || ''), 100);
    o = NET.others[w.uid] = {
      hh: hh, ui: ui, name: w.name, realm: w.realm,
      buf: [], cur: { x: w.x, z: w.z, yaw: w.yaw || 0 },
      walkT: 0, last: { x: w.x, z: w.z },
      atkT: -1, atkSeq: -1, clk: undefined,
      hp: (typeof w.hp === 'number') ? w.hp : 100,
      hpMax: (typeof w.hpm === 'number' && w.hpm > 0) ? w.hpm : 100,
      dead: !!w.dead                          // ★ 第 57 轮：他倒下了没有
    };
    o.clk = netClkUpdate(o.clk, t, w.ct);          // ★ 对齐他的钟 + 量他的抖动
    netPush(o.buf, w.x, w.z, w.yaw || 0, w.ct || (t - (o.clk.off || 0)));
    return o;
  }
  o.name = w.name; o.realm = w.realm;
  o.clk = netClkUpdate(o.clk, t, w.ct);            // ★ 每包都校准一次（取最小延迟 ✓）
  // ★ 他的血量（他自己报上来 ✓ 用来画头顶绿血条 ✓）
  if (typeof w.hp === 'number') { o.hp = w.hp; }
  if (typeof w.hpm === 'number' && w.hpm > 0) { o.hpMax = w.hpm; }
  /* ★ 第 57 轮踩的坑：这个字段只在【创建时】带了 ✗
     已经存在的小人走的是下面这条更新分支 → dead 永远停在 false ✗
     所以两处都要写 ✓（不然"别人看你死亡还是站着"永远修不好 ✗）*/
  o.dead = !!w.dead;
  o.inv = +w.inv || 0;       // ★ 第 63 轮：无敌剩余（每包都更新 ✓）
  /* ★ 第 65 轮：他换武器了 → 手里那把也要换 ✓（不然永远是刚看到他时的武器 ✗）*/
  var _wl = w.wlook || 'sword', _wt = (typeof w.wtier === 'number') ? w.wtier : 0;
  if (_wl !== o.wlook || _wt !== o.wtier) {
    o.wlook = _wl; o.wtier = _wt;
    fillHeldWeapon(o.hh.sw, _wl, _wt);
  }
  // ★ 他的挥剑序号变了 → 我这边从头播一遍挥剑动画 ✓（动作和你自己看到的一致 ✓）
  var wk = (typeof w.atk === 'number') ? w.atk : 0;
  if (wk !== o.atkSeq) {
    if (o.atkSeq >= 0 && wk > o.atkSeq) { o.atkT = 0; }
    o.atkSeq = wk;
  }
  var lp = o.buf.length ? o.buf[o.buf.length - 1] : null;
  var ct = w.ct || (t - (o.clk.off || 0));                 // ★ 他的钟（排队用 ✓）
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
  if (moved || !lp || ct > lp.t + NET.rate * 0.5) {
    netPush(o.buf, w.x, w.z, w.yaw || 0, ct);              // ★ 用他的钟排队 ✓
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
  if (!mid || !isFinite(x) || !isFinite(z)) { return null; }
  var rm = NET.rmobs[mid];
  if (!rm) {
    var mcls = mobClassOf(mkind);                    // ★ 职业外观（第 39 轮，方案 §3.3.1）
    var m = mob(mkind);                              // ★ 传职业名（几何体按名缓存 ✓ 第 44 轮）
    // ★ 体型 = 等级带来的（第 37 轮）× 职业自己的比例（学生矮、健身教练壮）
    m.g.scale.setScalar(mobScaleAt(mlv) * ((mcls && mcls.scale) || 1));
    m.g.position.set(x, 0, z);
    m.g.rotation.y = yaw;
    scene.add(m.g);
    var sh = new THREE.Mesh(new THREE.CircleGeometry(0.54, 14),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.24, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2;
    sh.position.set(x, 0.02, z);
    sh.scale.setScalar(mobScaleAt(mlv) / G.MOB_SCALE);   // ★ 影子跟着体型一起放大 ✓
    scene.add(sh);
    rm = NET.rmobs[mid] = {
      mid: mid, g: m.g, hh: m, shadow: sh, ui: mkMobUI('僵尸', hpm),
      hp: hp, hpMax: hpm, alive: alive, atkT: atkT, dying: -1, dead: 0, walkT: 0,
      lv: mlv, kind: mkind, sk: mobScaleAt(mlv) / G.MOB_SCALE,
      last: { x: x, z: z }, buf: [], cur: { x: x, z: z, yaw: yaw }
    };
    netPush(rm.buf, x, z, yaw, t);
    return mid;
  }
  rm.hp = hp; rm.hpMax = hpm;
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
  var rm = NET.rmobs[mid];
  if (!rm) { return; }
  scene.remove(rm.g);
  if (rm.shadow) { scene.remove(rm.shadow); }
  UI.plate.remove(rm.ui);
  delete NET.rmobs[mid];
}

/* ============ 地上掉的（第 38 轮，P2 第二刀）============
   服务器给的格式：[id, x, z, name, tier]
   ★ 颜色按品阶分（方案 §6.3 那套 12 阶的配色思路）→ 玩家瞟一眼就知道值不值得绕路 ✓ */
var LOOT_COL = [0xbfa88a, 0x8fd28a, 0x8fc4ff, 0xc08fff, 0xffd83d, 0xff9a5c,
                0xff6a5c, 0xff5cf0, 0x5cf0ff, 0xffffff, 0xffe08a, 0xff4a4a];
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
  null, null, null, null,                                  // 0-3：不发光
  { c: 0x9fd8ff, i: 0.30, o: 0.20, shell: true },          // 4-6 玄铁
  { c: 0x9fd8ff, i: 0.30, o: 0.20, shell: true },
  { c: 0x9fd8ff, i: 0.30, o: 0.20, shell: true },
  { c: 0xbfe8ff, i: 0.50, o: 0.30, shell: true },          // 7-9 灵器
  { c: 0xbfe8ff, i: 0.50, o: 0.30, shell: true },
  { c: 0xbfe8ff, i: 0.50, o: 0.30, shell: true },
  { c: 0xffe9a8, i: 1.00, o: 0.45, shell: true },          // 10-11 神品
  { c: 0xffe9a8, i: 1.00, o: 0.45, shell: true }
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

var _lootGeo = null, _lootShellGeo = null;
function lootGeo() {
  if (!_lootGeo) { _lootGeo = new THREE.BoxGeometry(0.30, 0.30, 0.30); }
  return _lootGeo;
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
  var e = NET.rloot[lid];
  if (!e) {
    var g = new THREE.Mesh(lootGeo(), lootMat(tier));   // ★ 几何体/材质共享（第 45 轮）
    g.position.set(x, 0.5, z);
    g.castShadow = true;
    var gt = GLOW_TIER[tier];
    if (gt && gt.shell) {                               // ★ 高阶才有轮廓光（只多 1 次 draw call ✓）
      g.add(new THREE.Mesh(lootShellGeo(), glowShellMat(tier)));
    }
    scene.add(g);
    e = NET.rloot[lid] = { g: g, x: x, z: z, name: name, tier: tier, asked: 0 };
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
      e.g.position.y = 0.5 + Math.sin(_lootT * 3 + e.x) * 0.07;   // 轻微上下浮 ✓
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
function hurtPlayer(dv, fx, fz, kind, byName) {
  if (dead) { return; }                            // ★ 已经倒下了就不再掉血（免得反复触发死亡 ✓）
  if (kind === 'mob' && !mobDmgOn()) { return; }   // ★ 关了就不掉血（但攻击动作/音效照旧 ✓）
  if (dv <= 0) { return; }
  HP -= dv; shake = 0.4;
  sfx('zhurt', 0.9);
  if (!isFinite(fx)) { fx = P.x; }
  if (!isFinite(fz)) { fz = P.z; }
  dmg('-' + dv, fx, 2.4, fz, false);
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
  if (h.pvp) {
    dmg((h.by || '道友') + ' 砍你', P.x, 3.4, P.z, true);   // ★ 提示是谁砍的 ✓
  }
  hurtPlayer(dv, hx, hz, h.pvp ? 'pvp' : 'mob', h.pvp ? h.by : '');
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
var MARK_COL = '#7ee08a';        // 普通玩家（绿 ✓ 和头顶名牌一致 ✓）
var MARK_COL_TEAM = '#8fc4ff';   // ★ 队友（蓝）—— 见下面 markColor() 的说明 ✓
var MARK_COL_DEAD = '#e0776a';   // 倒下的人（红 ✓）
var _marks = {};                 // uid -> 平台层给的标记句柄
var _mark3 = null, _mark4 = null;

/* ★ 箭头颜色（第 28 轮预留队友色）：
   P4 组队系统上线后，服务器会在玩家快照里带上队伍号，
   那时把下面那句的 `o.team !== undefined &&` 去掉就生效了 —— 现在没有队伍数据，
   所以这个分支永远走不到 ✓（这样以后只用改一行，不用再翻这段逻辑 ✓） */
function markColor(o) {
  if (typeof o.hp === 'number' && o.hp <= 0) { return MARK_COL_DEAD; }
  if (o.team !== undefined && o.team === NET.myTeam) { return MARK_COL_TEAM; }
  return MARK_COL;
}

function updateMarks() {
  var uid, m, k;
  if (!NET.on) {   // 离线 / 断线 → 全部收掉 ✓
    for (k in _marks) { UI.mark.remove(_marks[k]); delete _marks[k]; }
    return;
  }
  var used = {};
  for (uid in NET.others) {
    var o = NET.others[uid];
    if (!o || !o.cur) { continue; }
    var dx = o.cur.x - P.x, dz = o.cur.z - P.z;
    var dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > MARK_RANGE) { continue; }          // 太远不管 ✓
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
      ang * 180 / Math.PI, Math.round(dist) + 'm', markColor(o));
    UI.mark.show(m, true);
  }
  for (k in _marks) {   // 走了 / 跑远了 / 断线的收掉 ✓
    if (!used[k]) { UI.mark.remove(_marks[k]); delete _marks[k]; }
  }
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
    o.hh.g.position.set(px, 0, pz);
    o.hh.g.rotation.y = o.cur.yaw;
    o.hh.g.rotation.z = 0;
    // ★ 走路动画按"这一帧真的走了多远"算 ✓（原来按到目标点的距离 ✗ 会一抽一抽）
    var spd = Math.hypot(px - o.last.x, pz - o.last.z) / Math.max(dt, 0.0001);
    o.last.x = px; o.last.z = pz;
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
      continue;                       // 倒了就别再播挥剑了 ✓
    }
    /* ★ 第 57 轮踩的坑：站起来时要把【躺地的角度】复位 ✗
       我一开始只复位了 rotation.z，漏了 rotation.x
       → 复活之后人还是斜着的 ✗（走路动画只管四肢，不动身体角度 ✓）*/
    o.hh.g.rotation.x = 0;
    o.hh.g.rotation.z = 0;
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
      o.atkT += dt;
      if (!heroAtkPose(o.hh, o.atkT, px, pz, o.cur.yaw, o.wlook)) {
        o.atkT = -1;
        heroAtkReset(o.hh, px, pz, o.cur.yaw);
      }
    }
    // 头顶昵称
    if (o.ui) {
      if (!_ov3) { _ov3 = new THREE.Vector3(); }
      _ov3.set(px, 3.2, pz).project(cam);
      var vis = (_ov3.z > -1 && _ov3.z < 1 && Math.abs(_ov3.x) < 1.35 && Math.abs(_ov3.y) < 1.5);
      UI.plate.show(o.ui, vis);
      if (vis) {
        var sx = (_ov3.x * 0.5 + 0.5) * innerWidth;
        var sy = (-_ov3.y * 0.5 + 0.5) * innerHeight;
        UI.plate.move(o.ui, sx, sy);
        // ★ 他的血条（绿色 ✓ 玩家用绿、妖兽用红 → 一眼分得清 ✓）
        var opct = Math.max(0, Math.min(100, (o.hp / (o.hpMax || 100)) * 100));
        UI.plate.hpWidth(o.ui, opct.toFixed(0) + '%');
        UI.plate.hpColor(o.ui, BAR_PLR);
        UI.plate.name(o.ui, (o.name || '道友') + (o.realm ? ' ' + o.realm : '')
          + ' ' + Math.max(0, Math.round(o.hp)) + '/' + Math.round(o.hpMax || 100));
      }
    }
  }
  // ★ 世界妖兽：插值显示 + 走路/攻击/倒地动画（动作由服务器的状态驱动 ✓）
  for (var mid in NET.rmobs) {
    var rm = NET.rmobs[mid];
    if (!netSample(rm.buf, srvRender, rm.cur)) { continue; }   // ★ 妖兽用服务器钟 ✓
    var rx = rm.cur.x, rz = rm.cur.z;
    rm.g.position.set(rx, 0, rz);
    rm.g.rotation.y = rm.cur.yaw;
    if (rm.shadow) { rm.shadow.position.set(rx, 0.02, rz); }
    /* ★ 第 44 轮：只给 30 米内的僵尸投影 —— 更远的影子在地平线上只有几个像素，看不出来 ✓
       只要状态没变就不重复写 castShadow（写它会让 three.js 重建阴影列表 ✗）*/
    if (rm.hh.casters) {
      var nsh = ((rx - P.x) * (rx - P.x) + (rz - P.z) * (rz - P.z)) < 900;
      if (rm.shN !== nsh) {
        rm.shN = nsh;
        for (var csi = 0; csi < rm.hh.casters.length; csi++) { rm.hh.casters[csi].castShadow = nsh; }
      }
    }
    if (rm.boxDbg) { rm.boxDbg.position.set(rx, 0.1, rz); }   // ★ 碰撞箱线框跟随 ✓

    if (rm.alive) {
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
      } else {
        rm.g.rotation.x = 0;
        rm.hh.armL.rotation.z = 0; rm.hh.armR.rotation.z = 0;
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
      UI.plate.hpWidth(rm.ui, pct.toFixed(0) + '%');
      UI.plate.hpColor(rm.ui, BAR_MOB);   // ★ 妖兽一律红 ✓
      UI.plate.name(rm.ui, mobPlate(rm));   // ★ 职业 + 等级 + 血（第 36 轮）
      if (!_ov3) { _ov3 = new THREE.Vector3(); }
      _ov3.set(rx, (3.2 + MOB_FEET) * (rm.sk || 1), rz).project(cam);   // ★ 体型大了名牌也要抬高 ✓（+MOB_FEET 才不会陷进头顶 ✗）
      var vis2 = rm.alive && (_ov3.z > -1 && _ov3.z < 1 && Math.abs(_ov3.x) < 1.35 && Math.abs(_ov3.y) < 1.5);
      UI.plate.show(rm.ui, vis2);
      if (vis2) {
        var sx2 = (_ov3.x * 0.5 + 0.5) * innerWidth;
        var sy2 = (-_ov3.y * 0.5 + 0.5) * innerHeight;
        UI.plate.move(rm.ui, sx2, sy2);
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
  shake = crit ? 0.45 : 0.22; hitStop = crit ? 0.08 : 0.04;
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
var ATK_ARCH = {
  axe: 'chop', hammer: 'chop',
  sword: 'sweep', saber: 'sweep', staff: 'sweep',
  dagger: 'thrust', spear: 'thrust',
  bow: 'thrust'              // 弓先借"刺"（P3 做拉弓 ✓ 总比用劈像样 ✓）
};
var ATK_KF = { chop: KF_CHOP, sweep: KF_SWEEP, thrust: KF_THRUST };
// 各自的节奏：劈最慢（收招重 ✓）· 扫居中 · 刺最快（秒收 ✓）
var ATK_T = {
  chop:   [0.26, 0.43, 0.52, 0.86],
  sweep:  [0.20, 0.36, 0.46, 0.78],
  thrust: [0.14, 0.24, 0.30, 0.58]
};

function atkArchOf(look) { return ATK_ARCH[look] || 'sweep'; }

function heroAtkPose(heroObj, atkT, bx, bz, byaw, look) {
  var arch = atkArchOf(look);
  var KF = ATK_KF[arch];
  var TT = ATK_T[arch];
  var TOTAL = TT[3];
  var T1 = TT[0], T2 = TT[1], T3 = TT[2];
  var f, e;
  if (atkT < T1) { f = 0; e = atkT / T1; }
  else if (atkT < T2) { f = 1; e = (atkT - T1) / (T2 - T1); }
  else if (atkT < T3) { f = 2; e = (atkT - T2) / (T3 - T2); }
  else { f = 3; e = Math.min(1, (atkT - T3) / (TOTAL - T3)); }
  // 缓动：预备用 ease-in(慢起 ✓) 挥击用 ease-out(极快 ✓) 收招用 ease-in-out
  var ee;
  if (f === 0) { ee = e * e; }
  else if (f === 1) { ee = 1 - Math.pow(1 - e, 3); }
  else if (f === 2) { ee = e; }
  else { ee = e < 0.5 ? (2 * e * e) : (1 - Math.pow(-2 * e + 2, 2) / 2); }
  var A = KF[f], B = KF[f + 1];
  var lp = function (i) { return A[i] + (B[i] - A[i]) * ee; };
  heroObj.armR.rotation.x = lp(0);
  heroObj.armR.rotation.y = lp(1);
  heroObj.armR.rotation.z = lp(2);
  if (heroObj.sw) { heroObj.sw.rotation.x = lp(3); }
  heroObj.g.rotation.x = lp(4);
  heroObj.g.rotation.y = byaw + lp(5);
  heroObj.armL.rotation.x = lp(6);
  heroObj.legL.rotation.x = lp(7);
  heroObj.legR.rotation.x = lp(8);
  heroObj.g.position.x = bx + Math.sin(byaw) * lp(9);
  heroObj.g.position.z = bz + Math.cos(byaw) * lp(9);
  heroObj.g.position.y = lp(10);
  if (atkT >= TOTAL) { return false; }
  return true;
}

function heroAtkReset(heroObj, bx, bz, byaw) {
  heroObj.armR.rotation.set(0, 0, 0);
  // ★ 收招后剑要回到"待战前下 32°"= 0.55（关键帧最后也是这个值 ✓ 这里显式钉一遍更保险 ✓）
  if (heroObj.sw) { heroObj.sw.rotation.x = 0.55; heroObj.sw.rotation.z = 0.10; }
  heroObj.armL.rotation.x = 0;
  heroObj.legL.rotation.x = 0; heroObj.legR.rotation.x = 0;
  heroObj.g.rotation.x = 0; heroObj.g.rotation.y = byaw;
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

function frame(ts) {
  UI.raf(frame);
  if (!loadedOk) { return; }
    /* ★ 第 44 轮：阴影隔帧更新（见渲染器那里的注释）*/
    _shadowTick = (_shadowTick + 1) & 1;
    if (_shadowTick === 0) { rd.shadowMap.needsUpdate = true; }
  if (lastTs && ts - lastTs < G.FRAME_MS) { return; }
  /* ★★ dt 必须用【真实帧间隔】，不能写死 1/60（第 28 轮修的真 bug）★★
     原来这里是 `var dt = 1 / 60;` —— 不管这一帧实际过了多久，位移都按 1/60 秒算 ✗
       · 144Hz 屏幕：144 帧 × (1/60 秒的位移) = 【2.4 倍速】✗
       · 30 FPS 的老手机：30 帧 × (1/60 秒的位移) = 【半速】✗
     （G.FRAME_MS 只挡"同一毫秒内的重复回调"，挡不住高刷屏 ✓ 所以两个方向都错）
     玩家反馈："帧数高的话会导致移动速度会快一些，应该不同设备一样才对" ✓ 就是这里。
     注意：这里取的是【上一帧到现在】的真实间隔，而上面那个 return 分支不更新 lastTs，
     所以被限流跳过的帧，时间会累积到下一帧的 dt 里 → 长跑不漂 ✓ */
  var dt = lastTs ? (ts - lastTs) / 1000 : 1 / 60;
  lastTs = ts;
  if (!(dt > 0)) { dt = 1 / 60; }
  if (dt > 0.1) { dt = 0.1; }   // ★ 切后台回来 / 卡了一大下 → 夹住，别让人瞬移 ✓
  if (hitStop > 0) { hitStop -= dt; dt *= 0.2; }

  /* ---- 移动 ---- */
  var ix = jx, iz = jy;
  /* ★★ 第 65 轮修的真 bug：手机端（摇杆）死了走不动 ✓ 电脑端（WASD）还能走 ✗
     病根：清零写在【按键之前】→ 按键又把它加回来了 ✗
     → 所以必须放在【按键之后】覆盖一次 ✓（或者干脆不让按键生效 ✓）*/
  if (keys['w']) { iz -= 1; } if (keys['s']) { iz += 1; }
  if (keys['a']) { ix -= 1; } if (keys['d']) { ix += 1; }
  if (dead) { ix = 0; iz = 0; }   // ★ 倒下了就不能走（点复活才起来 ✓ 手机/电脑都拦 ✓）
  var len = Math.hypot(ix, iz), moving = false;
  if (len > 0.08) {
    var nx = ix / Math.max(1, len), nz = iz / Math.max(1, len);
    var wx = nx, wz = nz * G.FLIP_Z;
    var ox = P.x, oz = P.z;
    moveWithCollision(wx * G.SPEED * dt, wz * G.SPEED * dt, G.BODY_W / 2, G.BODY_D / 2, true, null);   // ★ 矩形 + 被所有妖兽拦住 ✓
    if (Math.hypot(P.x - ox, P.z - oz) > 0.001) {
      P.yaw = Math.atan2(wx, wz); moving = true; walkT += dt * 7.5;
      // ★ 脚步声（每 0.36 秒一次 ✓ MC 僵尸脚步 ✓）
      stepTimer -= dt;
      if (stepTimer <= 0) { stepTimer = 0.36; /* sfx('step', 0.5);   // ★ 脚步音效已关闭（用户要求 ✓ 想恢复去掉注释即可 ✓）*/ }
    }
  }
  if (atkT < 0) { H.g.position.set(P.x, moving ? Math.abs(Math.sin(walkT)) * 0.05 : 0, P.z); }   // ★ 攻击时坐标由动画控制 ✓
  /* ★★ 第 56 轮：死亡 = 【倒地】，不是站着 ✗（用户要求）★★
     ★ 必须放在上面那些姿势代码【之后】—— 不然会被它们覆盖回去 ✗ */
  if (dead) {
    H.g.rotation.x = -1.45;              // 躺平（绕 X 转过去 ✓）
    H.g.rotation.z = 0.12;               // 稍微侧一点，别像块板子
    H.g.rotation.y = P.yaw;              // 朝向保持不变 ✓
    H.g.position.set(P.x, 0.28, P.z);    // 贴地（不然会陷进地面 / 半截悬空）
  }
  /* ★ 第 56 轮：无敌倒计时 + 脚下护盾环
     ★ 倒计时必须用【真实 dt】✗ 不能写死 0.033 —— 60fps 下会掉两倍快
       （这个坑第 28 轮在移动速度上踩过一次 ✓ 同一个道理 ✓）*/
  if (INVULN_T > 0) { INVULN_T = Math.max(0, INVULN_T - dt); }
  invRingUpdate();
  fxTick(dt);                       // ★ 第 63 轮：登场特效（复活/上线 ✓）
  H.g.rotation.y = P.yaw;
  /* ★★ 第 56 轮：倒地时【不要】播走路姿势 ★★
     踩过：我那段倒地写在上面 ✓ 但这里 (rotation.x = 0) 又把它清零了 ✗
     → 死亡姿势得是"没人再动它"才行 ✓ */
  if (atkT < 0 && !dead) {
    var sw2 = moving ? Math.sin(walkT) * 0.72 : Math.sin(performance.now() / 700) * 0.06;
    H.legL.rotation.x = sw2; H.legR.rotation.x = -sw2;
    H.armL.rotation.x = -sw2 * 0.75; H.armR.rotation.x = sw2 * 0.45;
    H.g.rotation.x = 0;
  }

  /* ---- 攻击（6 帧 · 由下往上撩 ✓ 0.78 秒 ✓）---- */
  if (atkT >= 0) {
    /* ★ 攻击动画（业界规范 ✓ 四阶段 · 8 帧 · 总 0.86 秒）
       ① 预备 30%：下沉后仰 + 剑后拉（慢 ✓ 蓄力）
       ② 挥击 20%：极快下砍（快慢对比产生力量感 ✓）
       ③ 冲击 10%：定格绷紧（顿帧 ✓）
       ④ 收招 40%：继续划 + 前倾 + 慢回正 ✓
       关节：右臂 X/Y/Z 三轴 + 肩部 + 重心 + 左手 + 双腿 */
    atkT += dt;
    // ★ 直接调共用的挥剑动画（本地 / 别的玩家 同一套 → 动作一致 ✓）
    if (!heroAtkPose(H, atkT, P.x, P.z, P.yaw, MY_WEAPON && MY_WEAPON.look)) {
      atkT = -1;
      heroAtkReset(H, P.x, P.z, P.yaw);
    }
  }
  if (atkCd > 0) { atkCd -= dt; }
  /* ★ 攻击冷却 → 按钮（第 33 轮）：平时哑光、冷却时按比例压暗 + 转一圈
     只在变化超过 4% 时才写界面 —— 每帧都碰 DOM 是白烧性能 ✗ */
  if (UI.atkCool) {
    var _cdp = (atkCd > 0) ? Math.min(1, atkCd / (G.ATK_CD || 0.62)) : 0;
    if (Math.abs(_cdp - _atkCdP) > 0.04 || (_cdp === 0) !== (_atkCdP === 0)) {
      _atkCdP = _cdp;
      UI.atkCool(_cdp);
    }
  }
  if (dead) { atkHeld = false; }   // ★ 倒下了不能挥剑 ✓
  if (atkHeld && atkCd <= 0 && atkT < 0 && !dead) {
    atkT = 0; atkCd = (G.ATK_CD || 0.62);
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
    if (m2.shadow) { m2.shadow.position.set(m2.g.position.x, 0.02, m2.g.position.z); }
    if (m2.boxDbg) { m2.boxDbg.position.set(m2.g.position.x, 0.1, m2.g.position.z); }   // ★ 妖兽线框跟随 ✓
    /* ★ 更新妖兽头顶 UI（投影到屏幕 ✓ 血条 + 名字 ✓）*/
    if (m2.ui) {
      if (!_mv3) { _mv3 = new THREE.Vector3(); }
      // ★ 高度 = 妖兽头顶（第 40 轮把模型抬高后，这里也要 +MOB_FEET，不然血条陷进头里 ✗）
      _mv3.set(m2.g.position.x, 2.85 + MOB_FEET, m2.g.position.z).project(cam);
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
  var sx = 0, sz = 0;
  if (shake > 0.01) { sx = (Math.random() - 0.5) * shake; sz = (Math.random() - 0.5) * shake; shake *= 0.88; } else { shake = 0; }
  cam.position.set(P.x + sx, 1.4 + G.CAM_DIST * Math.sin(G.CAM_PITCH), P.z + G.CAM_DIST * Math.cos(G.CAM_PITCH) + sz);
  cam.lookAt(P.x, 1.4, P.z);
  sun.position.set(P.x + 38, 70, P.z + 26);
  sun.target.position.set(P.x, 0, P.z);
  sun.target.updateMatrixWorld();
  if (H.shadow) { H.shadow.position.set(P.x, 0.02, P.z); }
  if (H.boxDbg) { H.boxDbg.position.set(P.x, 0.1, P.z); }   // ★ 人物碰撞箱线框跟随 ✓

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
      UI.text('fps', Math.round(1000 / ms) + ' FPS · ' + ms.toFixed(1) + 'ms');
      if (UI.visible('infoBox')) { UI.text('infoBox', infoText()); }
      UI.text('setFps', Math.round(1000 / ms) + ' FPS');
    }
    fpsLastMs = now; fpsT = 0;
  }
  diagTick++;
  if (diagTick % 20 === 0) {
    /* ★ 第 32 轮：用户要求诊断里【去掉"网格桶"和"音效"】——
       音效进度本来还有个平台层的回调也在往这块写，那边也一起删了 ✓
       现在只留：坐标 · 实体数 · 道友数（正好一行，窄屏会自动换第二行 ✓）*/
    UI.text('diag', '玩家 ' + P.x.toFixed(1) + ', ' + P.z.toFixed(1)
      + '   实体 ' + (NET.on ? Object.keys(NET.rmobs).length : mobs.length)
      + '   道友 ' + Object.keys(NET.others).length);
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