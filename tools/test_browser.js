// P0-9 端到端【浏览器】测试：两台"设备"（两个独立的无头 Chrome）各登一个账号，
// 验证：页面无报错 → 能注册登录 → WebSocket 连上并进世界 → 互相看得见。
//
// ★ 为什么非要有这个：P0-1~P0-9 原来全靠 Node / Python 测试，
//   core/platform 拆分（P0-8）之后**从来没人用浏览器打开过**，
//   结果藏着两个只有真浏览器才暴露的 bug（启动顺序 / 登录浮层 DOM 顺序）✗
//   Node 侧测试永远看不到这两类问题。
//
// 跑法：先起服务端，然后   node tools\test_browser.js
// 可选：环境变量 CHROME 指定浏览器路径；参数 1 指定页面地址（默认 http://127.0.0.1:8899/）

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/* ============================================================
   ★ 第 48 轮：管理接口辅助
   为什么测试要用它：玩家端的 spawn/giveweapon 已经【被服务器关掉】✗
   （那是"任何玩家都能自己刷怪"的漏洞 ✓ 现在搬到 /admin 了）
   所以测试改从管理接口刷 —— 顺便把管理链路也端到端测了一遍 ✓
   ============================================================ */
const ADMIN_PW = process.env.ADMIN_PW || 'xiuxian-admin';
const ADMIN_URL = process.env.ADMIN_URL || 'http://127.0.0.1:8899';
const ADMIN_NAME = process.env.ADMIN_NAME || '浏览器甲';
let ADMIN_TOKEN = null;
async function ADMIN_LOGIN() {
  if (ADMIN_TOKEN) { return ADMIN_TOKEN; }
  const r = await fetch(ADMIN_URL + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PW })
  }).then(x => x.json()).catch(() => null);
  if (!r || !r.ok) { throw new Error('管理登录失败：' + JSON.stringify(r)); }
  ADMIN_TOKEN = r.token;
  return ADMIN_TOKEN;
}
async function ADMIN_ACT(act, body) {
  const tk = await ADMIN_LOGIN();
  const r = await fetch(ADMIN_URL + '/api/admin/act', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin': tk },
    body: JSON.stringify(Object.assign({ act: act, name: ADMIN_NAME }, body || {}))
  }).then(x => x.json()).catch(() => null);
  return r;
}

const PAGE = process.argv[2] || 'http://127.0.0.1:8899/';
const ORIGIN = new URL(PAGE).origin;

const CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const BROWSER = CANDIDATES.find(function (p) { try { return fs.existsSync(p); } catch (e) { return false; } });
if (!BROWSER) { console.error('找不到 Chrome / Edge，可用环境变量 CHROME 指定'); process.exit(1); }

const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
let fails = 0;
function ok(c, m) { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) { fails++; } }

class Browser {
  constructor(port, name) { this.port = port; this.name = name; this.seq = 0; this.waiting = {}; this.errors = []; }

  async start() {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx2d-br-'));
    this.proc = spawn(BROWSER, [
      '--headless', '--disable-gpu', '--no-sandbox', '--no-first-run',
      '--no-default-browser-check', '--disable-extensions',
      '--user-data-dir=' + this.dir,
      '--remote-debugging-port=' + this.port,
      '--window-size=900,620',
      PAGE,
    ], { stdio: 'ignore' });

    let target = null;
    for (let i = 0; i < 80 && !target; i++) {
      await sleep(250);
      try {
        const r = await fetch('http://127.0.0.1:' + this.port + '/json/list');
        const list = await r.json();
        target = list.find(function (t) { return t.type === 'page' && t.webSocketDebuggerUrl; });
      } catch (e) { /* 还没起来 */ }
    }
    if (!target) { throw new Error(this.name + ' 调试端口没起来'); }

    this.ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise(function (res, rej) {
      this.ws.onopen = res;
      this.ws.onerror = function () { rej(new Error(this.name + ' devtools 连不上')); }.bind(this);
    }.bind(this));
    this.ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id && this.waiting[m.id]) { this.waiting[m.id](m); delete this.waiting[m.id]; return; }
      // ★ 收集页面里的未捕获异常 —— 光看 #err 不够（它会被后一条错误覆盖，
      //   而且只有 window.onerror 抓得到的才会进去）。第 27 轮那个
      //   "e.key.toLowerCase() 炸了" 就是靠这个才没漏掉。
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params && m.params.exceptionDetails;
        const txt = (d && d.exception && d.exception.description) || (d && d.text) || '(未知异常)';
        this.errors.push(String(txt).split('\n')[0]);
      }
      if (m.method === 'Log.entryAdded') {
        const e = m.params && m.params.entry;
        if (e && e.level === 'error') { this.errors.push('[log] ' + e.text); }
      }
    };
    this.send('Runtime.enable', {});
    this.send('Page.enable', {});
    this.send('Log.enable', {});
    /* ★ 在页面里装一个错误记录器（每次导航都会先于页面脚本注入）。
       为什么不用 CDP 的 Runtime.exceptionThrown：页面自己把 window.onerror 换掉了
       并且 return true，Chrome 就不再把这类异常当"未捕获"报给我们了 ✗
       （实测：故意 setTimeout 抛一个，exceptionThrown 一条都收不到）
       所以直接在页面侧记 —— 监听 window 的 error / unhandledrejection 事件，
       这两个不受 onerror 返回值影响 ✓ */
    this.send('Page.addScriptToEvaluateOnNewDocument', {
      source: 'window.__errs = [];' +
        'window.addEventListener("error", function (ev) {' +
        '  try { if (ev && typeof ev.message === "string" && ev.message) { window.__errs.push(ev.message); } } catch (e) {}' +
        '}, true);' +
        'window.addEventListener("unhandledrejection", function (ev) {' +
        '  try { window.__errs.push("unhandledrejection: " + ((ev && ev.reason && ev.reason.message) || (ev && ev.reason))); } catch (e) {}' +
        '});',
    });
    await sleep(200);
  }

  send(method, params) {
    const id = ++this.seq;
    return new Promise((res) => {
      this.waiting[id] = res;
      this.ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
      setTimeout(function () { if (this.waiting[id]) { delete this.waiting[id]; res(null); } }.bind(this), 20000);
    });
  }

  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: '(async()=>{' + expr + '})()',
      awaitPromise: true, returnByValue: true,
    });
    if (!r) { if (!this._warned) { this._warned = 1; console.log('    [调试] ' + this.name + ' devtools 没回应'); } return undefined; }
    if (process.env.DBG) { console.log('    [调试] ' + this.name + ' 原始响应: ' + JSON.stringify(r).slice(0, 400)); }
    if (r.error) { if (!this._warned) { this._warned = 1; console.log('    [调试] ' + this.name + ' CDP 报错: ' + JSON.stringify(r.error)); } return undefined; }
    if (r.result && r.result.exceptionDetails) {
      const d = r.result.exceptionDetails;
      if (!this._warned) { this._warned = 1; console.log('    [调试] ' + this.name + ' 页面里抛异常: ' + (d.exception ? d.exception.description : d.text)); }
      return undefined;
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  }

  // 页面侧记录到的未捕获异常（window error / unhandledrejection）
  async pageErrors() {
    const s = await this.eval('return JSON.stringify(window.__errs || []);');
    if (typeof s !== 'string') { return []; }
    try { return JSON.parse(s); } catch (e) { return []; }
  }

  // 页面侧的 + CDP 侧的，合并（去重后取前几条够看了）
  async allErrors() {
    const list = this.errors.concat(await this.pageErrors());
    return list.filter(function (x, i) { return list.indexOf(x) === i; });
  }

  async state() {    // ★ 注意：eval 返回的是一串 JSON 文本，得 parse 成对象再用
    //   （第一版忘了 parse，于是 s.err / s.ready 全是 undefined，测试自己误报了一片 FAIL ✗）
    const s = await this.eval(
      'return JSON.stringify({' +
      ' err: (document.getElementById("err")||{}).textContent||"",' +
      ' loginShown: String(((document.getElementById("login")||{}).className)||""),' +
      ' ready: (typeof WSC!=="undefined") && WSC.ready,' +
      ' uid: (typeof NET!=="undefined") && NET.myUid,' +
      ' name: (typeof WSC!=="undefined" && WSC.role) ? WSC.role.name : null,' +
      ' others: (typeof NET!=="undefined") ? Object.keys(NET.others).map(function(k){return NET.others[k].name;}) : null,' +
      ' x: (typeof P!=="undefined") ? Math.round(P.x) : null,' +
      // ★ diagTick 每帧 +1 —— 用它判断"渲染循环真的在跑"（fpsCnt 现在没人用了，别拿它当指标）
      ' diagTick: (typeof diagTick!=="undefined") ? diagTick : null' +
      '});'
    );
    if (typeof s !== 'string') { return null; }
    try { return JSON.parse(s); } catch (e) { return null; }
  }

  kill() {
    // ★ 必须杀【整个进程树】：Chrome 会 fork 一堆子进程，只 kill 根进程会留下孤儿
    //   （孤儿会继续占着 WebSocket 连接，服务端的 online 人数就一直对不上）
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(this.proc.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        this.proc.kill('SIGKILL');
      }
    } catch (e) { }
    try { fs.rmSync(this.dir, { recursive: true, force: true }); } catch (e) { }
  }
}

async function register(name, pw) {
  const r = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, password: pw }),
  });
  const j = await r.json().catch(function () { return {}; });
  if (!j.token) {
    const r2 = await fetch(ORIGIN + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, password: pw }),
    });
    const j2 = await r2.json().catch(function () { return {}; });
    return j2.token;
  }
  return j.token;
}

(async function () {
  console.log('浏览器: ' + BROWSER);
  console.log('页面  : ' + PAGE);
  console.log('');

  // 服务端得先起来
  let base = 0;
  try {
    const h = await (await fetch(ORIGIN + '/api/health')).json();
    base = h.world.online;
    ok(h.ok === true, '服务端在线（当前 world.online=' + base + '）');
  } catch (e) {
    console.error('服务端没起来，先双击 启动服务器.bat'); process.exit(1);
  }

  const PW = 'abc123456';
  const USER_A = '浏览器甲', USER_B = '浏览器乙';
  const tokA = await register(USER_A, PW);
  const tokB = await register(USER_B, PW);
  ok(!!tokA && !!tokB, '两个账号都拿到 token');

  const A = new Browser(9331, 'A');
  const B = new Browser(9332, 'B');
  try {
    await A.start();
    await B.start();
    await sleep(1500);

    // ① 页面自身没有报错（game.js 末尾的启动调用会在 #err 里写"启动失败：..."）
    const s0 = await A.state();
    ok(s0 && s0.err === '', '页面启动无报错（#err 为空）' + (s0 && s0.err ? ' —— ' + s0.err : ''));
    ok(s0 && String(s0.loginShown).indexOf('show') >= 0, '★ 登录浮层出现了（DOM 顺序修好 ✓）');
    let e0 = await A.allErrors();
    ok(e0.length === 0, '启动阶段无未捕获异常' + (e0.length ? ' —— ' + e0.join(' | ') : ''));

    // ② 写入 token（等于"上次登录过"）→ 刷新 → 应该自动进世界
    await A.eval('localStorage.setItem("token",' + JSON.stringify(tokA) + '); location.reload(); return 1;');
    await B.eval('localStorage.setItem("token",' + JSON.stringify(tokB) + '); location.reload(); return 1;');

    let sa = null, sb = null;
    for (let i = 0; i < 40; i++) {
      await sleep(400);
      sa = await A.state(); sb = await B.state();
      if (sa && sb && sa.ready && sb.ready) { break; }
    }
    ok(sa && sa.ready, '★ 甲进了世界（WSC.ready，角色=' + (sa && sa.name) + '）');
    ok(sb && sb.ready, '★ 乙进了世界（WSC.ready，角色=' + (sb && sb.name) + '）');
    ok(sa && sa.err === '' && sb && sb.err === '', '进世界后仍然无报错');
    ok(sa && sa.loginShown === '' , '进世界后登录浮层已收起');

    /* ★★ 第 37 轮：血条【开局】就该有数字（用户问"为什么挨打才显示"）★★
       必须在这儿验：再往后甲可能已经被僵尸咬过 → 那时有数字是理所当然的 ✗
       修之前这里是 "— / —"（updHP 只在受伤/死亡/复活里被调 ✗）*/
    const hp0 = JSON.parse(await A.eval(
      'var t = document.getElementById("hpTxt");' +
      'return JSON.stringify({ txt: t ? t.textContent : "（没有这个元素）", hp: Math.round(HP), hpm: Math.round(HPMAX) });'
    ) || '{}');
    console.log('        [刚进世界·血条] 显示 "' + hp0.txt + '"（实际 ' + hp0.hp + ' / ' + hp0.hpm + '）');
    ok(/\d+\s*\/\s*\d+/.test(String(hp0.txt)) && String(hp0.txt).indexOf('—') < 0,
      '★★ 刚进世界血条上就有数字（"' + hp0.txt + '"）');

    // ③ 互相看得见（P0-9 的验收标准）
    let seen = false;
    for (let i = 0; i < 25; i++) {
    /* ★ 第 110 轮：现在会【恢复上次的位置】了 ✓
       所以两个测试号会各自回到上次存档的地方 ✗ 互相看不见 ✗
       → 测试前先把他们摆到一起 ✓（对真人玩家恢复位置是对的 ✓）*/
    await A.eval('P.x = 0; P.z = 0; return 1;');
    await B.eval('P.x = 2.5; P.z = 0; return 1;');

      await sleep(400);
      sa = await A.state(); sb = await B.state();
      if (sa && sb && sa.others && sb.others && sa.others.length && sb.others.length) { seen = true; break; }
    }
    ok(seen, '★ 两人互相看得见（甲看到 ' + JSON.stringify(sa && sa.others) +
      '，乙看到 ' + JSON.stringify(sb && sb.others) + '）');

    /* ★ 用【管理页打倒乙】走真链路 ✓（造个假 NET.others 没用 ✗
         每个快照都会把不在列表里的清掉 ✓ 所以必须让服务器真的把他标成死亡 ✓）*/
    await ADMIN_ACT('kill', { name: '浏览器乙' });
    await sleep(900);
    const poseQ = JSON.parse(await A.eval(
      // ★ 必须按【名字】找乙 ✗ 不能拿 NET.others 的第一个
      //   （视野里可能还有别的测试号 ✓ 拿错了就会误判 ✗）
      'var o = null;' +
      'for (var uid in NET.others) {' +
      '  if (NET.others[uid].name === "浏览器乙") { o = NET.others[uid]; break; } }' +
      'if (!o) { return JSON.stringify({ found: false }); }' +
      'if (!o) { return JSON.stringify({ found: false }); }' +
      'return JSON.stringify({ found: true, dead: !!o.dead, hp: o.hp, lv: o.lv,' +
      '  rx: Math.round(o.hh.g.rotation.x * 100) / 100,' +
      '  y: Math.round(o.hh.g.position.y * 100) / 100 });'
    ) || '{}');
    console.log('        [倒地] 甲看乙：found=' + poseQ.found + ' dead=' + poseQ.dead +
      ' hp=' + poseQ.hp + ' rx=' + poseQ.rx + ' y=' + poseQ.y);
    ok(poseQ.found === true && poseQ.dead === true,
      '★★ 服务器把乙标成【死亡】了（甲收到的快照里 dead=true ✓ hp=' + poseQ.hp + '）');
    ok(poseQ.rx < -1.0 && Math.abs(poseQ.y - 0.28) < 0.06,
      '★★★ 甲看乙是【躺在地上】的（rx=' + poseQ.rx + ' y=' + poseQ.y +
      ' ✓ 不再是站着的 ✗ 用户报的那条）');
    // 复活之后要恢复站立
    const healResp = await ADMIN_ACT('heal', { name: '浏览器乙' });
    console.log('        [倒地] heal 返回：' + JSON.stringify(healResp));
    await sleep(900);
    const upQ = JSON.parse(await A.eval(
      'var o = null;' +
      'for (var uid in NET.others) {' +
      '  if (NET.others[uid].name === "浏览器乙") { o = NET.others[uid]; break; } }' +
      'return JSON.stringify({ found: !!o,' +
      '  rx: o ? Math.round(o.hh.g.rotation.x * 100) / 100 : null,' +
      '  dead: o ? !!o.dead : null, hp: o ? o.hp : null });'
    ) || '{}');
    ok(upQ.dead === false && Math.abs(upQ.rx) < 0.5,
      '★★ 复活之后甲看乙又站直了（dead=' + upQ.dead + ' rx=' + upQ.rx + ' ✓）');

    /* ★★ 第 63 轮：别人要能看出"他复活了"，而不是凭空出现 ★★
       用户原话："复活的效果没有做服务器同步，别人看不到复活后的无敌特效，
                 要让别人能看出他是复活了，而不是凭空出现了"
       ★ 走真链路：让【乙】发一次复活意图（服务器会给附近的人发 evt + 无敌 ✓）
         → 甲那边应该：① 收到飘字/光柱 ② 乙脚下出现蓝色护盾环 ✓ */
    // ★ 先在甲那边挂个钩子数 spawnFx 的调用 —— 比去 DOM 里捞飘字可靠得多
    //   （飘字只活 0.67 秒 ✗ 等 800ms 再去查就已经收掉了，上一版就是这么假红的 ✗）
    await A.eval('window.__fxHits = []; window.__sf0 = window.__sf0 || spawnFx; var _sf = spawnFx;' +
                 'window.spawnFx = function (x, z, kind, name) {' +
                 '  window.__fxHits.push((kind || "") + ":" + (name || ""));' +
                 '  return _sf(x, z, kind, name); }; return 1;');
    await B.eval('if (NET.on && WSC.ready) { wsSend("revive", {}); } return 1;');
    await sleep(800);
    const revQ = JSON.parse(await A.eval(
      'var o = null;' +
      'for (var uid in NET.others) {' +
      '  if (NET.others[uid].name === "浏览器乙") { o = NET.others[uid]; break; } }' +
      'if (!o) { return JSON.stringify({ found: false }); }' +
      'var labels = 0;' +
      'var all = document.querySelectorAll("body > div");' +
      'for (var i = 0; i < all.length; i++) {' +
      '  var tx3 = all[i].textContent || "";' +
      '  if (tx3.indexOf("复活了") >= 0) { labels++; } }' +
      'return JSON.stringify({ found: true, inv: o.inv, hasRing: !!o.ring,' +
      '  ringVis: o.ring ? o.ring.visible : null,' +
      '  ringOp: o.ring ? Math.round(o.ring.material.opacity * 100) / 100 : null,' +
      '  fxCount: (typeof FX_LIST !== "undefined") ? FX_LIST.length : -1,' +
      '  hits: (window.__fxHits || []).slice(),' +
      '  labels: labels });'
    ) || '{}');
    console.log('        [复活同步] 甲看乙：inv=' + revQ.inv + ' 有环=' + revQ.hasRing +
      ' 环可见=' + revQ.ringVis + ' 透明度=' + revQ.ringOp + ' 特效数=' + revQ.fxCount +
      ' 飘字=' + revQ.labels);
    ok(revQ.found === true && revQ.hasRing === true && revQ.ringVis === true,
      '★★★ 甲看乙脚下有【蓝色护盾环】（复活的无敌特效 ✓ 别人看得出他刚复活 ✓）');
    ok(revQ.inv > 0, '★★ 服务器把乙的无敌剩余同步给了甲（inv=' + revQ.inv + ' 秒 ✓）');
    ok(revQ.hits && revQ.hits.some(function (s) { return s.indexOf('revive') === 0; }),
      '★★★ 甲收到了【复活事件】并放了登场特效（' + JSON.stringify(revQ.hits) +
      ' ✓ —— 不是一个凭空站起来的人 ✓ 用户原话）');
    // ★★ 踩过的坑：这里原来写 window.spawnFx = undefined ✗
    //   那不是"卸掉 hook"，而是把客户端的 spawnFx 【永久打掉】✗
    //   → 后面 11 条 UI/背包断言全崩，报 Uncaught TypeError: spawnFx is not a function ✗
    //   → 必须【恢复原函数】✓
    await A.eval('if (window.__sf0) { window.spawnFx = window.__sf0; } return 1;');
    await sleep(1600);   // 等特效自己收掉
    const cleanQ = JSON.parse(await A.eval(
      'return JSON.stringify({ fxLeft: (typeof FX_LIST !== "undefined") ? FX_LIST.length : -1 });'
    ) || '{}');
    ok(cleanQ.fxLeft === 0, '★ 特效 1.1 秒后自己收干净了（不会越积越多 ✗ 现在剩 ' +
      cleanQ.fxLeft + ' 个 ✓）');

    /* ★★★ 第 65 轮回归：别人手里必须是【他自己的】武器 ★★★
       用户报："我拿弓箭，别的玩家手里也显示弓箭" → 已修 ✓
       然后我修的时候又踩了一脚：addOther 里读 w.w（快照原始字段名）✗
       而映射后的名字是 wlook ✗ → 永远 undefined → 兜底成 'sword'
       → 所有队友都被画成普通单手剑 + 用"扫"的动作 ✗（用户又发现了 ✓）
       ★ 所以这条要【端到端】钉住：给乙一把长枪 → 甲眼里必须是长枪 ✓ */
    await ADMIN_ACT('give', { name: '浏览器乙', kind: 'spear', tier: 8 });
    await sleep(700);
    await B.eval('bagFetch(function () { if (BAG.items.length) { bagEquip(BAG.items[0].id); } }); return 1;');
    await sleep(1400);
    const ownQ = JSON.parse(await B.eval(
      'return JSON.stringify({ name: (MY_WEAPON || {}).name || "",' +
      ' kids: (H && H.sw && H.sw.children[0]) ? H.sw.children[0].children.length : -1 });'
    ) || '{}');
    const seeQ = JSON.parse(await A.eval(
      'var o = null;' +
      'for (var uid in NET.others) { if (NET.others[uid].name === "浏览器乙") { o = NET.others[uid]; break; } }' +
      'if (!o) { return JSON.stringify({ found: false }); }' +
      'return JSON.stringify({ found: true, wlook: o.wlook, wtier: o.wtier, arch: atkArchOf(o.wlook),' +
      ' kids: (o.hh && o.hh.sw && o.hh.sw.children[0]) ? o.hh.sw.children[0].children.length : -1 });'
    ) || '{}');
    console.log('        [武器同步] 乙自己=' + ownQ.name + '（' + ownQ.kids + ' 个部件）· 甲看乙=' +
      seeQ.wlook + '/' + seeQ.wtier + ' 阶（' + seeQ.kids + ' 个部件 · ' + seeQ.arch + '）');
    ok(seeQ.found === true && seeQ.wlook === 'spear' && seeQ.wtier === 8,
      '★★★ 甲看乙拿的是【长枪 8 阶】（不是"我的武器"✗ 也不是兜底的单手剑 ✗）');
    ok(seeQ.kids === ownQ.kids && seeQ.kids > 0,
      '★★ 甲眼里乙的武器模型和乙自己的一模一样（都是 ' + ownQ.kids + ' 个部件 ✓）');
    ok(seeQ.arch === 'thrust',
      '★★ 而且动作也对（长枪=刺 ✓ 不是兜底成"扫"✗）');

    /* ★★★ 第 66 轮：别人要能【看到挥砍动作】★★★
       用户报："武器同步了，攻击动画没有"
       病根：客户端拿快照的 'atk' 当"他挥了几刀"的计数器 ✓
             但服务器发的一直是 o.atk（攻击力，从没赋过值 → 永远 0 ✗）
             → wk > o.atkSeq 永远不成立 → 远端动作永远不播 ✗
       修：服务器加 atkSeq，每次挥出去 +1 ✓ 快照发它 ✓ */
    const seqA = JSON.parse(await A.eval(
      'var o = null;' +
      'for (var uid in NET.others) { if (NET.others[uid].name === "浏览器乙") { o = NET.others[uid]; break; } }' +
      'return JSON.stringify({ seq: o ? o.atkSeq : null, atkT: o ? o.atkT : null });') || '{}');
    await B.eval('if (NET.on && WSC.ready) {' +
                 ' wsSend("atk", { x: P.x + Math.sin(P.yaw), z: P.z + Math.cos(P.yaw) }); } return 1;');
    await sleep(350);
    const seqB = JSON.parse(await A.eval(
      'var o = null;' +
      'for (var uid in NET.others) { if (NET.others[uid].name === "浏览器乙") { o = NET.others[uid]; break; } }' +
      'return JSON.stringify({ seq: o ? o.atkSeq : null, atkT: o ? o.atkT : null,' +
      ' armR: o ? Math.round(o.hh.armR.rotation.x * 100) / 100 : null });') || '{}');
    console.log('        [动作同步] 甲看乙：挥之前 seq=' + seqA.seq + ' · 挥之后 seq=' +
      seqB.seq + ' atkT=' + seqB.atkT + ' 手臂=' + seqB.armR);
    ok(seqB.seq > seqA.seq,
      '★★★ 服务器把【挥砍序号】同步过来了（' + seqA.seq + ' → ' + seqB.seq + ' ✓）');
    ok(seqB.atkT >= 0,
      '★★★ 甲那边【真的在播挥砍动作】（atkT=' + seqB.atkT + ' 秒 ✓ 不是永远 -1 ✗）');


    /* ③b ★ 玩家【移动】同步：甲按住 w 走一会儿，乙那边看到的位置必须跟着变
       （用户反馈过的真 bug：能看到人，但人钉在原地不动 ✗
         根因是 core 里的 `NET.on` 从来没被赋成 true —— netUpdate() 第一行就是
         `if (!NET.on) return;`，于是远端玩家/世界妖兽一律不做插值，全钉在创建时的位置。
         那个赋值是重构 core/platform 时从 netInit()/autoLogin() 里搬丢的。）*/
    const moveSamples = [];
    /* ★ 先把甲挪到离乙 15 米的地方再走。
       原因：两个号的出生点很可能重合，而"玩家之间不能穿过去"是【设计】
       （core 的 blocked() 里注释写着"碰撞箱不能重叠 ✓ 用户要求"）。
       贴着乙往乙那边按 w 会被挡住 → 测出来的是碰撞，不是同步 ✗（第一版就是这么翻车的）*/
    const bPosRaw = await B.eval('return JSON.stringify([P.x, P.z]);');
    let bPos = [0, 0];
    try { bPos = JSON.parse(bPosRaw); } catch (e) { }
    await A.eval('P.x = ' + (bPos[0] + 15) + '; P.z = ' + bPos[1] + '; return 1;');
    await sleep(800);   // 等服务端和乙那边的缓冲跟上
    await A.eval('window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" })); return 1;');
    for (let i = 0; i < 9; i++) {
      await sleep(250);
      // ★ 同时采【发送端】和【接收端】：只采接收端的话，分不清"没同步"和"甲根本没动" ✗
      const aRaw = await A.eval('return JSON.stringify({' +
        ' x: P.x, z: P.z, kw: (typeof keys !== "undefined") ? keys.w : null,' +
        ' dead: (typeof dead !== "undefined") ? dead : null,' +
        ' hp: (typeof HP !== "undefined") ? HP : null,' +
        ' tick: (typeof diagTick !== "undefined") ? diagTick : null,' +
        ' neton: (typeof NET !== "undefined") ? NET.on : null,' +
        ' joy: (typeof jx !== "undefined") ? [jx, jy] : null });');
      const bRaw = await B.eval(
        // ★ 必须【按名字】精确取"浏览器甲"，不能 for-in 拿第一个：
        //   场上可能还有别人（比如你自己开着页面在玩），拿到一个站住不动的
        //   实体就会得出"同步坏了"的假结论 ✗（第一版就是这么被骗的）
        'var o = null;' +
        'for (var k in NET.others) { if (NET.others[k].name === ' + JSON.stringify(USER_A) + ') { o = NET.others[k]; break; } }' +
        'if (!o) { return "null"; }' +
        'var t = performance.now() / 1000;' +
        'return JSON.stringify({' +
        '  x: o.cur.x, z: o.cur.z, buf: o.buf.length, who: o.name,' +
        '  rtS: (typeof o.rtS === "number") ? o.rtS : null, now: t,' +
        '  head: o.buf.length ? o.buf[0].t : null,' +
        '  tail: o.buf.length ? o.buf[o.buf.length-1].t : null,' +
        '  n: o.clk ? o.clk.n : null,' +
        '  hx: o.buf.length ? o.buf[0].x : null,' +
        '  tx: o.buf.length ? o.buf[o.buf.length-1].x : null,' +
        '  off: o.clk ? o.clk.off : null, delay: o.clk ? o.clk.delay : null' +
        '});'
      );
      moveSamples.push({ a: aRaw, b: bRaw });
    }
    await A.eval('window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" })); return 1;');
    await sleep(300);

    const pts = [];
    for (const s of moveSamples) {
      let a = null, b = null;
      try { a = JSON.parse(s.a); } catch (e) { }
      try { b = JSON.parse(s.b); } catch (e) { }
      if (b) { b.a = a; pts.push(b); }
    }
    let maxMove = 0, aMove = 0;
    if (pts.length >= 2) {
      maxMove = Math.max(Math.abs(pts[pts.length - 1].x - pts[0].x),
        Math.abs(pts[pts.length - 1].z - pts[0].z));
      if (pts[0].a && pts[pts.length - 1].a) {
        aMove = Math.max(Math.abs(pts[pts.length - 1].a.x - pts[0].a.x),
          Math.abs(pts[pts.length - 1].a.z - pts[0].a.z));
      }
    }
    console.log('        [甲自己动没动] 位移 ' + aMove.toFixed(2) + 'm');
    console.log('        [甲状态] ' + moveSamples.map(function (s) {
      try { const a = JSON.parse(s.a); return 'kw' + a.kw + ' z' + a.z.toFixed(2) + ' tick' + a.tick; }
      catch (e) { return '?'; }
    }).join(' | '));
    console.log('        [乙看到的] ' + pts.map(function (p) {
      return p.x.toFixed(2) + ',' + p.z.toFixed(2);
    }).join(' → '));
    // 顺带记一下同步的关键状态（失败时不用再临时加诊断：一眼看得出是没数据还是渲染冻结）
    if (pts.length) {
      console.log('        [同步状态] rtS-head=' +
        ((typeof pts[0].rtS === 'number' ? (pts[0].rtS - pts[0].head) * 1000 : NaN)).toFixed(0) +
        'ms  数据包n=' + pts[0].n + '→' + pts[pts.length - 1].n +
        '  缓冲=' + pts[0].buf);
    }

    console.log('        [渲染时刻] rtS-head=' + ((pts[0].rtS - pts[0].head) * 1000).toFixed(0) +
      'ms  off=' + (pts[0].off * 1000).toFixed(0) + 'ms  delay=' + (pts[0].delay * 1000).toFixed(0) +
      'ms  buf=' + pts[0].buf + '  (tail-head)=' + ((pts[0].tail - pts[0].head) * 1000).toFixed(0) + 'ms');
    ok(pts.length >= 2, '乙那边能读到甲的位置（采样 ' + pts.length + ' 次）');
    ok(aMove > 0.5, '甲自己真的动了（位移 ' + aMove.toFixed(2) + 'm）');
    ok(maxMove > 0.5, '★★ 甲的移动同步到了乙那边（位移 ' + maxMove.toFixed(2) + 'm）');

    /* ③b2 PWA：Service Worker 必须真的【装好并激活】
       （第 28 轮之前根本没注册；而且 sw.js 清单里有个不存在的 ./app.js →
         caches.addAll 整批失败 → 注册了也装不上 ✗
         所以只断言"注册数=1"不够，必须看到 active worker ✓） */
    let swState = '?';
    for (let i = 0; i < 12; i++) {
      swState = await B.eval(
        'if (!navigator.serviceWorker) { return "none"; }' +
        'return navigator.serviceWorker.getRegistrations().then(function (rs) {' +
        '  if (!rs.length) { return "no-registration"; }' +
        '  var r = rs[0];' +
        '  if (r.active) { return "active"; }' +
        '  if (r.installing) { return "installing"; }' +
        '  if (r.waiting) { return "waiting"; }' +
        '  return "no-worker"; });'
      );
      if (swState === 'active') { break; }
      await sleep(300);
    }
    console.log('        [Service Worker] 状态 = ' + swState);
    ok(swState === 'active', '★ Service Worker 装好并激活了（离线缓存 / 添加到主屏幕要用）');

    /* ③c ★ 建筑（石头/树/房子）两边必须【一模一样】
       用户反馈："两边刷新的是不一样的，应该统一"。根因是核心生成器原来是
       "两趟扫描 + 边放边占位"，而占位只覆盖【当前玩家周围那一圈】、遍历起点又跟着玩家走
       → 同一格在甲那边被占位跳过、在乙那边没跳过 → 同一处长出来的东西不同 ✗
       判据：取【两人中间】的一个点，比较双方在那里 8 米内的建筑集合（位置+碰撞箱）。
       两边位置故意不同（甲刚才走了十几米），正是要覆盖"中心不一样"这种情况 ✓ */
    const posA = JSON.parse(await A.eval('return JSON.stringify([P.x, P.z]);') || '[0,0]');
    const posB2 = JSON.parse(await B.eval('return JSON.stringify([P.x, P.z]);') || '[0,0]');
    const TS = await A.eval('return G.TS;');
    const PR = await A.eval('return G.PROP_R;');
    const CH = await A.eval('return PROP_CHUNK;');
    /* 比"两人【都生成过】的那片世界" —— 生成是按块（PROP_CHUNK 格）对齐的，
       所以要按【块的范围】求交集，而不是按 ±PROP_R 的方块（那样会取小、可能一个物件都取不到 ✗）
       注意：G.SPAWN_SAFE = 17 米内刻意不放建筑（出生点留空地），所以原点附近本来就是空的 ✓ */
    const ax = Math.round(posA[0] / TS), az = Math.round(posA[1] / TS);
    const bx2 = Math.round(posB2[0] / TS), bz2 = Math.round(posB2[1] / TS);
    const c0 = Math.max(Math.floor((ax - PR) / CH), Math.floor((bx2 - PR) / CH)) * CH;
    const c1 = (Math.min(Math.floor((ax + PR) / CH), Math.floor((bx2 + PR) / CH)) + 1) * CH - 1;
    const d0 = Math.max(Math.floor((az - PR) / CH), Math.floor((bz2 - PR) / CH)) * CH;
    const d1 = (Math.min(Math.floor((az + PR) / CH), Math.floor((bz2 + PR) / CH)) + 1) * CH - 1;
    console.log('        [对比范围] 两边都生成过的网格 x[' + c0 + ',' + c1 + '] z[' + d0 + ',' + d1 + ']' +
      '（甲格 ' + ax + ',' + az + ' / 乙格 ' + bx2 + ',' + bz2 + ' / 块 ' + CH + ' 格 / 视距 ' + PR + ' 格）');
    const propQ =
      'var out = [];' +
      'for (var i = 0; i < propSolids.length; i++) {' +
      '  var s = propSolids[i];' +
      '  var gx = Math.round(s.x / ' + TS + '), gz = Math.round(s.z / ' + TS + ');' +
      '  if (gx >= ' + c0 + ' && gx <= ' + c1 + ' && gz >= ' + d0 + ' && gz <= ' + d1 + ') {' +
      '    out.push(s.x.toFixed(3) + "," + s.z.toFixed(3) + "," + s.hw.toFixed(3) + "," + s.hd.toFixed(3)); } }' +
      'out.sort();' +
      'return JSON.stringify(out);';
    const propsA = JSON.parse(await A.eval(propQ) || '[]');
    const propsB = JSON.parse(await B.eval(propQ) || '[]');
    const totA = await A.eval('return propSolids.length;');
    const totB = await B.eval('return propSolids.length;');
    const onlyA = propsA.filter(function (s) { return propsB.indexOf(s) < 0; });
    const onlyB = propsB.filter(function (s) { return propsA.indexOf(s) < 0; });
    console.log('        [建筑对比] 全场 甲 ' + totA + ' / 乙 ' + totB + '；交集区内 甲 ' +
      propsA.length + ' / 乙 ' + propsB.length + '，甲独有 ' + onlyA.length + '、乙独有 ' + onlyB.length);
    if (onlyA.length || onlyB.length) {
      console.log('          甲独有: ' + onlyA.slice(0, 3).join(' | '));
      console.log('          乙独有: ' + onlyB.slice(0, 3).join(' | '));
    }
    ok(propsA.length >= 3, '交集区里有建筑可比（甲那边 ' + propsA.length + ' 个）');
    ok(onlyA.length === 0 && onlyB.length === 0,
      '★★ 同一处建筑两边完全一致（甲独有 ' + onlyA.length + ' / 乙独有 ' + onlyB.length + '）');

    /* ③d ★ 建筑必须是【世界固定】的：把乙挪走几百米再挪回来，同一片地方必须一模一样。
       这条直接钉死根因 —— 原来的生成是"围绕玩家自己扫一圈"，
       玩家一动（或换个位置）那片世界就变了；现在是按世界格子分块，走哪儿都一样 ✓ */
    const beforeBack = propsB.slice();
    await B.eval('P.x += 400; P.z += 400; return 1;');   // 走远（触发卸块 + 建新块）
    await sleep(1800);
    await B.eval('P.x -= 400; P.z -= 400; return 1;');   // 走回来（原来的块会被重新生成）
    // ★ 第 65 轮：这块是【异步】重建的 ✗ 1.8 秒在满载时偶尔不够（实测差异 34 ✗）
    //   多等一会儿 + 轮询到齐为止 ✓ 比"睡死一个数"稳 ✓
    for (let _w = 0; _w < 8; _w++) {
      await sleep(500);
      const _n = Number(await B.eval('return (typeof PROPS_READY === "number") ? PROPS_READY : 1;')) || 1;
      if (_n < 1) { break; }
    }
    await sleep(700);
    const afterBack = JSON.parse(await B.eval(propQ) || '[]');
    const diffBack = afterBack.filter(function (s) { return beforeBack.indexOf(s) < 0; }).length +
      beforeBack.filter(function (s) { return afterBack.indexOf(s) < 0; }).length;
    console.log('        [走远再回来] 之前 ' + beforeBack.length + ' 个 / 之后 ' +
      afterBack.length + ' 个，差异 ' + diffBack);
    ok(beforeBack.length >= 3 && diffBack === 0,
      '★★ 走远再回来，同一片建筑完全不变（差异 ' + diffBack + '）');

    /* ③e ★ 附近队友方位箭头：50 米内、人不在画面里 → 屏幕边缘贴一个箭头 + 距离
       （用户要的："玩家坐标靠近在 50 以内，显示玩家的方向"）
       ★ 先把两人一起挪到很远的空地：场上可能还有别人的客户端（比如你自己开着的页面），
         不挪开的话"可见箭头"会混进他们，断言就没法唯一对应到乙了 ✗ */
    await B.eval('P.x = 300; P.z = 300; return 1;');
    await sleep(900);

    const markQ =
      'var root = document.getElementById("markui");' +
      'var kids = root ? root.children : [];' +
      'var vis = [];' +
      'for (var i = 0; i < kids.length; i++) {' +
      '  if (kids[i].style.display !== "none") {' +
      '    vis.push({ txt: kids[i].lastChild ? kids[i].lastChild.textContent : "",' +
      '               tf: kids[i].style.transform,' +
      '               rot: (kids[i].firstChild && kids[i].firstChild.style.transform) || "" }); } }' +
      'return JSON.stringify({ n: kids.length, vis: vis, w: innerWidth, h: innerHeight });';

    // (a) 贴到乙旁边（3 米）→ 人就在画面里 → 不该画箭头
    await A.eval('P.x = 300; P.z = 303; return 1;');
    await sleep(1000);
    const mkNear = JSON.parse(await A.eval(markQ) || '{}');
    ok(!mkNear.vis || mkNear.vis.length === 0,
      '人在画面里时不画箭头（可见箭头 ' + ((mkNear.vis || []).length) + ' 个）');

    // (b) 两个方向都要验：★ 只验"有箭头"抓不到"方向反了"，必须验【绝对方向】✗
    //     本作的相机固定在玩家 +z 侧、朝 -z 看 → 世界 -z = 屏幕上方，+z = 屏幕下方 ✓
    const parseMark = function (mk) {
      if (!mk) { return null; }
      const n = String(mk.tf).match(/-?\d+(?:\.\d+)?/g) || [];
      const r = String(mk.rot).match(/-?\d+(?:\.\d+)?/);
      return { sx: parseFloat(n[2]), sy: parseFloat(n[3]), deg: r ? parseFloat(r[0]) : NaN };
    };
    const checkDir = async function (label, azPz, wantUp) {
      await A.eval('P.x = 300; P.z = ' + azPz + '; return 1;');
      await sleep(1300);
      const st = JSON.parse(await A.eval(markQ) || '{}');
      const mk = (st.vis || [])[0] || null;
      const p = parseMark(mk);
      console.log('        [方位箭头] ' + label + '：可见 ' + ((st.vis || []).length) + ' 个' +
        (p ? '，屏幕=(' + p.sx.toFixed(0) + ',' + p.sy.toFixed(0) + ') 屏幕中心 y=' +
          (st.h / 2).toFixed(0) + '，角度=' + p.deg.toFixed(0) + '°，文字="' + mk.txt + '"' : ''));
      ok(!!p, label + '：会画箭头');
      if (!p) { return; }
      const up = p.sy < st.h / 2;
      ok(up === wantUp, label + '：箭头在屏幕' + (wantUp ? '上' : '下') + '方（实际 y=' +
        p.sy.toFixed(0) + '，中心 ' + (st.h / 2).toFixed(0) + '）');
      if (wantUp) {
        // ★ 第 32 轮：往上指的箭头不能贴顶 —— 会被血量/名牌/右上角信息挡住 ✗
        ok(p.sy >= 56, label + '：箭头没贴到屏幕上沿（y=' + p.sy.toFixed(0) +
          '，要 ≥56 才不会被顶部信息挡住）');
      }
      ok(wantUp ? (p.deg < -50 && p.deg > -130) : (p.deg > 50 && p.deg < 130),
        label + '：箭头角度朝' + (wantUp ? '上' : '下') + '（实际 ' + p.deg.toFixed(0) + '°）');
      const d = parseInt(String(mk.txt).replace(/[^0-9]/g, ''), 10);
      ok(d >= 40 && d <= 50, label + '：距离读数对（' + d + 'm，实际 45m）');
    };
    // 乙 固定在 (300,300)：甲在 z=345 → 乙在甲的 -z（屏幕上方）
    await checkDir('-z 方向（乙在屏幕上方）', 345, true);
    // 甲在 z=255 → 乙在甲的 +z（屏幕下方，而且落在相机身后，走的是镜像翻转那条分支 ✓）
    await checkDir('+z 方向（乙在屏幕下方）', 255, false);
    // 收尾：摆回"队友在前方"（-z）→ 截图里箭头应该在上缘朝上，一眼能看出方向对不对 ✓
    await A.eval('P.x = 300; P.z = 345; return 1;');
    await sleep(1200);

    /* ③f ★ 地面（P1「无限区块地形」第一步）：必须"跟随玩家 + 花纹世界固定"
       原来地面只在【世界原点】周围建一次（±26 块 ≈ ±520 单位）→ 走远了脚下就空了 ✗
       判据：① 在定点 (100,100) 的顶点色，换个位置重建后必须一模一样（世界固定 ✓）
             ② 走很远之后，地面的包围盒仍然罩着玩家（无限 ✓）*/
    const groundInfo = async function (who) {
      return JSON.parse(await who.eval(
        'GROUNDMESH.geometry.computeBoundingBox();' +
        'var b = GROUNDMESH.geometry.boundingBox;' +
        'var pos = GROUNDMESH.geometry.attributes.position, col = GROUNDMESH.geometry.attributes.color;' +
        'var probe = null;' +
        'for (var i = 0; i < pos.count; i++) {' +
        '  if (Math.abs(pos.getX(i) - 100) < 0.01 && Math.abs(pos.getZ(i) - 100) < 0.01) {' +
        '    probe = [col.getX(i), col.getY(i), col.getZ(i)]; break; } }' +
        'return JSON.stringify({ minx: b.min.x, maxx: b.max.x, minz: b.min.z, maxz: b.max.z,' +
        '  verts: pos.count, probe: probe });'
      ) || '{}');
    };
    await A.eval('P.x = 0; P.z = 0; return 1;');
    await sleep(900);
    const g1 = await groundInfo(A);
    await A.eval('P.x = 300; P.z = 0; return 1;');     // 走出 160 单位 → 会重建
    await sleep(1000);
    const g2 = await groundInfo(A);
    await A.eval('P.x = 3000; P.z = 3000; return 1;'); // 走很远（原来这里脚下早空了）
    await sleep(1400);
    const g3 = await groundInfo(A);
    const p1 = g1.probe ? g1.probe.map(function (v) { return v.toFixed(4); }).join(',') : 'none';
    const p2 = g2.probe ? g2.probe.map(function (v) { return v.toFixed(4); }).join(',') : 'none';
    console.log('        [地面] 定点(100,100)色 原位=' + p1 + ' 换位重建=' + p2);
    console.log('        [地面] 顶点数 ' + g1.verts + '/' + g2.verts + '/' + g3.verts +
      '；走远后包围盒 x[' + g3.minx + ',' + g3.maxx + '] z[' + g3.minz + ',' + g3.maxz + ']');
    ok(!!g1.probe && !!g2.probe && p1 === p2,
      '★★ 地面花纹是世界固定的（同一定点换位置重建后颜色一致）');
    ok(g3.maxx >= 3000 && g3.minx <= 3000 && g3.maxz >= 3000 && g3.minz <= 3000,
      '★★ 走远（3000,3000）后地面仍然罩着玩家 —— 不会看到"世界的边"');
    ok(g1.verts === g2.verts && g2.verts === g3.verts,
      '地面顶点数不涨不缩（没有反复重建漏显存）');

    /* ③g ★ "能连续跑图，不卡不跳"（P1 的验收标准）——
       跑图时真正可能卡一下的就是这两件事：地面重建、建筑换块。
       直接量它们的耗时，必须在一帧预算（16.7ms）之内 ✓ */
    const gCost = await A.eval(
      'P.x += 400; P.z += 400;' +
      'var t0 = performance.now(); refreshGround();' +
      'return Math.round((performance.now() - t0) * 100) / 100;'
    );
    const pCost = await A.eval(
      'P.x += 400; P.z += 400;' +
      'var t0 = performance.now(); updateProps();' +
      'return Math.round((performance.now() - t0) * 100) / 100;'
    );
    // ★ 正常走路只会跨 1 块 —— 再量一次"走 21 米"的真实开销
    const pCostWalk = await A.eval(
      'P.x += 21;' +
      'var t0 = performance.now(); updateProps();' +
      'return Math.round((performance.now() - t0) * 100) / 100;'
    );
    console.log('        [跑图开销] 地面重建 ' + gCost + 'ms · 建筑换块 ' + pCost +
      'ms（瞬移 400 米后的一次调用，受每帧预算限制）· 正常走 21 米 ' + pCostWalk + 'ms');
    ok(typeof gCost === 'number' && gCost < 24, '★ 地面重建 ' + gCost + 'ms < 24ms（不会卡一下）');
    /* ★ 这条本意是抓【"一帧建 9 块"那种 10 倍退化】，不是抠毫秒 ✗
       所以预算给得比正常值宽（机器满载时同一段代码能差 1 倍）——
       真退化到"一帧建一屏"会是几百毫秒，照样抓得住 ✓ */
    ok(typeof pCost === 'number' && pCost < 24,
      '★ 建筑换块单次 ' + pCost + 'ms < 24ms（有每帧预算，瞬移也不会一帧建 9 块把帧顶爆）');
    ok(typeof pCostWalk === 'number' && pCostWalk < 12,
      '★ 正常走路换块只有 ' + pCostWalk + 'ms（真正跑图时的开销）');

    /* ★ 预算归预算，世界不能永久缺块 —— 等几帧后必须都补齐 ✓
       （这一条很重要：光"每次只建 2 块"却没人在后面接着建，就会留下空洞 ✗）*/
    await sleep(600);
    const hole = JSON.parse(await A.eval(
      'var cx = Math.round(P.x / G.TS), cz = Math.round(P.z / G.TS), R = G.PROP_R;' +
      'var i0 = Math.floor((cx - R) / PROP_CHUNK), i1 = Math.floor((cx + R) / PROP_CHUNK);' +
      'var j0 = Math.floor((cz - R) / PROP_CHUNK), j1 = Math.floor((cz + R) / PROP_CHUNK);' +
      'var miss = 0, tot = 0;' +
      'for (var i = i0; i <= i1; i++) { for (var j = j0; j <= j1; j++) {' +
      '  tot++; if (!_chunkSolid[i + "," + j]) { miss++; } } }' +
      'return JSON.stringify({ miss: miss, tot: tot, pending: !!_propPending });'
    ) || '{}');
    console.log('        [补齐] 该有 ' + hole.tot + ' 块，还缺 ' + hole.miss + ' 块，待建标记=' + hole.pending);
    ok(hole.miss === 0, '★ 走远后该有的块最终都补齐了（不会留下空洞）');

    /* ★ 第 36 轮：让【服务器】刷几只僵尸，验两件事 ——
       ① 僵尸名牌上带等级（用户要求）② 顺手留一张图（设 SHOT_MOB 时）
       ★ 第 41 轮：改成【最多试 3 次】—— 服务器刷怪有间隔（4 秒），
         机器被别的测试占满时一次等不到，整条就假红 ✗ */
    let nMob = 0;
    for (let att = 0; att < 3; att++) {
      /* ★ 第 48 轮：刷怪改走【管理接口】——
         玩家端的 spawn 意图已经被服务器关掉了 ✗（那是"谁都能自己刷怪"的漏洞）
         ★ 注意这是【Node 侧】的调用，不能塞进 A.eval 的字符串里 ✗（浏览器里没有 ADMIN_ACT）*/
      await ADMIN_ACT('spawn', { n: 0, clear: 1 });
      await ADMIN_ACT('spawn', { n: 6 });
      await sleep(3600);
      nMob = Number(await A.eval('return Object.keys(NET.rmobs).length;')) || 0;
      if (nMob > 0) { break; }
      console.log('        [僵尸] 第 ' + (att + 1) + ' 次还没刷出来，再等一次…');
    }
    console.log('        [僵尸] 客户端此刻渲染的服务器僵尸 = ' + nMob + ' 只');
    ok(nMob > 0, '★ 服务器刷的僵尸真的渲染出来了（' + nMob + ' 只）');
    const plates = JSON.parse(await A.eval(
      'var h = document.getElementById("mobui"); var out = [];' +
      'if (h) { for (var i = 0; i < h.children.length; i++) {' +
      '  var t = (h.children[i].textContent || "").replace(/\\s+/g, " ").trim();' +
      '  if (t) { out.push(t); } } }' +
      'return JSON.stringify(out.slice(0, 4));'
    ) || '[]');
    console.log('        [僵尸名牌] ' + JSON.stringify(plates));
    ok(plates.length > 0 && /Lv\.\d+/.test(plates.join('|')),
      '★★ 僵尸名牌上带等级（' + plates.slice(0, 1) + '）');

    /* ★★ 第 39 轮：职业外观（方案 §3.3.1）★★
       ① 8 个职业每个都要真的挂上配件（不做的话和默认绿僵尸一样 ✗）
       ② 服务器的职业名，客户端这张表里必须都有（对不上就白做了 ✗）—— 拿真实僵尸验 */
    /* ★★ 第 44 轮：僵尸模型改成【合并】了 ——
       静态件（头/五官/身/腰带 + 全部职业挂件）合成 1 个几何体、颜色走顶点色，
       四条要摆动的肢体各自 1 个 → 一只僵尸 5 个网格 / 5 次 draw call（原来 21 次 ✗）
       所以"挂件多不多"不能再数子节点 ✗ 要数【顶点数】（每个方块 36 个顶点 ✓）
       ★ 同时钉住"合并没退化"：子节点必须正好是 5 ✓ */
    const clsQ = JSON.parse(await A.eval(
      'var names = Object.keys(MOB_CLASSES);' +
      'var baseG = mob(null).g;' +
      'var base = baseG.children.length;' +
      'var baseV = baseG.children[0].geometry.attributes.position.count;' +
      'var bad = [], extra = {};' +
      'for (var i = 0; i < names.length; i++) {' +
      '  var gg = mob(names[i]).g;' +
      '  var v = gg.children[0].geometry.attributes.position.count;' +
      '  extra[names[i]] = v - baseV;' +
      '  if (v <= baseV) { bad.push(names[i]); } }' +
      'var merged = [];' +
      'for (var j = 0; j < names.length; j++) {' +
      '  var g2 = mob(names[j]).g;' +
      '  if (g2.children.length !== 5) { merged.push(names[j] + ":" + g2.children.length); } }' +
      'var miss = [];' +
      'for (var j = 0; j < MOB_KINDS.length; j++) {' +
      '  if (!MOB_CLASSES[MOB_KINDS[j]]) { miss.push(MOB_KINDS[j]); } }' +
      // 真的僵尸身上带的 kind，客户端认识吗
      'var live = [], unknown = [];' +
      'for (var mid in NET.rmobs) {' +
      '  var kk = NET.rmobs[mid].kind || "";' +
      '  if (kk && live.indexOf(kk) < 0) { live.push(kk); }' +
      '  if (kk && !MOB_CLASSES[kk]) { unknown.push(kk); } }' +
      'return JSON.stringify({ n: names.length, base: base, bad: bad, extra: extra,' +
      ' miss: miss, live: live, unknown: unknown, base: base, baseV: baseV, merged: merged });'
    ) || '{}');
    console.log('        [职业外观] ' + clsQ.n + ' 个职业，挂件带来的顶点数=' + JSON.stringify(clsQ.extra) +
      ' · 每只僵尸网格数=' + clsQ.base + '（合并前 21）');
    console.log('        [职业外观] 场上僵尸的职业=' + JSON.stringify(clsQ.live) +
      '，客户端不认识的=' + JSON.stringify(clsQ.unknown));
    ok(clsQ.n === 8, '★ 8 个职业的外观表都在（' + clsQ.n + ' 个）');
    ok(clsQ.bad.length === 0, '★★ 每个职业的挂件都还在（顶点数更多；没挂上的：' + JSON.stringify(clsQ.bad) + '）');
    ok(clsQ.base === 5, '★★★ 一只僵尸只有 5 个网格（合并生效：1 个合并的身体 + 4 条肢体 ✓ 原来 21 个 ✗）');
    ok(clsQ.merged.length === 0, '★★ 所有职业的网格数都是 5（异常的：' + JSON.stringify(clsQ.merged) + '）');
    ok(clsQ.miss.length === 0, '★★ 客户端职业名列表在表里都能查到（缺：' + JSON.stringify(clsQ.miss) + '）');
    ok(clsQ.unknown.length === 0,
      '★★ 服务器发下来的职业客户端都认识（不认识的：' + JSON.stringify(clsQ.unknown) + '）');

    /* ★★ 第 40 轮：走路动作 ★★
       ① 模型的脚必须踩在 y=0（原来是 -0.46，腿有 46% 埋在地里 → 摆动看不出来 ✗）
       ② 真的在走路时，腿的摆动角要明显不为 0 ✓ */
    const feetY = await A.eval(
      'var g = mob(null).g; var b = new THREE.Box3().setFromObject(g);' +
      'return Math.round(b.min.y * 1000) / 1000;'
    );
    console.log('        [走路] 模型底部 y=' + feetY + '（0 = 脚踩地；-0.46 = 埋进土里 ✗）');
    ok(Math.abs(Number(feetY)) < 0.02,
      '★★ 僵尸的脚踩在地面上（底部 y=' + feetY + '）');
    let legMax = 0, legMoving = 0;
    for (let i = 0; i < 12; i++) {
      const v = await A.eval(
        'var m = 0, n = 0;' +
        'for (var k in NET.rmobs) { var r = NET.rmobs[k];' +
        // ★★ 只挑【没在攻击】的僵尸（rm.atkT < 0）★★
        //    攻击姿势里有一行会把腿写死，混进来的话这条断言就会被蒙过去 ✗（第 41 轮踩过）
        '  if (!(r.atkT < 0)) { continue; }' +
        '  var a = Math.abs(r.hh.legL.rotation.x);' +
        '  if (a > m) { m = a; } if (a > 0.15) { n++; } }' +
        'return JSON.stringify([Math.round(m * 1000) / 1000, n]);'
      );
      const arr = JSON.parse(v || '[0,0]');
      if (arr[0] > legMax) { legMax = arr[0]; }
      if (arr[1] > legMoving) { legMoving = arr[1]; }
      await sleep(110);
    }
    console.log('        [走路] 没在攻击的僵尸：腿最大摆幅 = ' + legMax +
      ' 弧度，同时在摆的有 ' + legMoving + ' 只');
    ok(legMax > 0.4,
      '★★ 没在攻击的僵尸走路时腿摆得起来（最大 ' + legMax + ' 弧度）—— ' +
      '修之前这里恒为 0：客户端把服务器的"攻击冷却"当成"正在攻击"，每帧用攻击姿势把腿写死 ✗');
    if (process.env.SHOT_MOB) {
      const sm = await A.send('Page.captureScreenshot', { format: 'png' });
      if (sm && sm.result && sm.result.data) {
        fs.writeFileSync(process.env.SHOT_MOB, Buffer.from(sm.result.data, 'base64'));
        console.log('  INFO  僵尸截图已存到 ' + process.env.SHOT_MOB);
      }
    }

    /* ③h ★ 设置面板：分类导航 + 攻击键大小（第 31 轮）
       —— 全都用【真点击】驱动（模拟玩家的操作），不直接调内部函数 ✓ */
    const uiQ =
      'var atk = document.getElementById("atk");' +
      'var r = atk.getBoundingClientRect();' +
      'var tabs = document.querySelectorAll("#setTabs .tab");' +
      'var panes = document.querySelectorAll("#setPanel .tabpane");' +
      'var onTab = [], onPane = [], names = [];' +
      'for (var i = 0; i < tabs.length; i++) { names.push(tabs[i].getAttribute("data-tab"));' +
      '  if (tabs[i].className.indexOf("on") >= 0) { onTab.push(tabs[i].getAttribute("data-tab")); } }' +
      'for (var j = 0; j < panes.length; j++) {' +
      '  if (panes[j].className.indexOf("on") >= 0) { onPane.push(panes[j].getAttribute("data-pane")); } }' +
      'return JSON.stringify({ w: Math.round(r.width), h: Math.round(r.height),' +
      '  icon: !!atk.querySelector("svg.ic"),' +
      '  text: atk.textContent.replace(/\\s/g, ""),' +
      '  cd: !!atk.querySelector(".cd"), cls: atk.className,' +
      '  bg: getComputedStyle(atk).backgroundImage.slice(0, 60),' +
      '  tabs: names, onTab: onTab, onPane: onPane,' +
      '  rowAtk: document.querySelectorAll("#rowAtk .opt").length,' +
      '  rowDpr: document.querySelectorAll("#rowDpr .opt").length,' +
      '  rowSfx: document.querySelectorAll("#rowSfx .opt").length,' +
      '  rowDbg: document.querySelectorAll("#rowDbg .opt").length,' +
      '  cfg: SETCFG.atkSize });';

    await A.eval('if (typeof openSet === "function") { openSet(); } return 1;');
    await sleep(250);
    /* ★ 第 37 轮：血条开局就该有数字（用户问"为什么挨打才显示"）——
       ★★ 这条必须【早】验：等到后面僵尸咬过一口再验就没意义了（那时当然有数字 ✗）
          所以放在这里（进世界没几秒、僵尸还在 20 米外走过来），此时还没挨过打 ✓ */
    const hpEarly = JSON.parse(await A.eval(
      'var t = document.getElementById("hpTxt");' +
      'return JSON.stringify({ txt: t ? t.textContent : "", hp: Math.round(HP), hpm: Math.round(HPMAX) });'
    ) || '{}');
    console.log('        [开局血条] 显示 "' + hpEarly.txt + '"（实际 ' + hpEarly.hp + ' / ' + hpEarly.hpm + '）');
    ok(/\d+\s*\/\s*\d+/.test(String(hpEarly.txt)) && String(hpEarly.txt).indexOf('—') < 0,
      '★★ 没挨打时血条也已经显示数字了（"' + hpEarly.txt + '"）');

    /* ★ 第 37 轮：僵尸体型随等级（纯函数 + 真实僵尸两条都验）*/
    const sc = JSON.parse(await A.eval(
      'return JSON.stringify({ lv1: mobScaleAt(1), lv20: mobScaleAt(20), lv100: mobScaleAt(100),' +
      ' lv9999: mobScaleAt(9999), base: G.MOB_SCALE });'
    ) || '{}');
    console.log('        [体型号] Lv.1=' + sc.lv1 + ' Lv.20=' + sc.lv20 + ' Lv.100=' + sc.lv100 +
      ' Lv.9999=' + sc.lv9999 + '（基准 ' + sc.base + '）');
    ok(sc.lv1 === sc.base, 'Lv.1 就是基准体型（' + sc.lv1 + '）');
    ok(sc.lv20 > sc.lv1 && sc.lv100 > sc.lv20, '★ 等级越高体型越大（单调递增）');
    ok(sc.lv9999 === sc.lv100, '★ 体型有上限（Lv.100 和 Lv.9999 一样大，免得变成一堵墙 ✗）');
    const s1 = JSON.parse(await A.eval(uiQ) || '{}');
    console.log('        [设置] 分类=' + JSON.stringify(s1.tabs) + ' 当前页=' + JSON.stringify(s1.onTab) +
      ' 攻击键 ' + s1.w + '×' + s1.h + '（文字="' + s1.text + '" 图标=' + s1.icon + ' 底色=' +
      String(s1.bg).slice(0, 34) + '）');
    ok(s1.w === 84 && s1.h === 84, '攻击键默认 84×84（实测 ' + s1.w + '×' + s1.h + '）');
    ok(s1.icon === true && s1.text === '', '★ 攻击键是【纯图标】、没有任何文字（用户要求的）');
    ok(s1.cd === true, '攻击键带冷却层（.cd）');
    ok(/rgba\(/.test(String(s1.bg)), '★ 攻击键底色是半透明的（背景里是 rgba，不是实心色）');
    ok(s1.tabs && s1.tabs.length >= 4, '设置面板有分类导航（' + (s1.tabs || []).length + ' 类：' + (s1.tabs || []).join('/') + '）');
    ok(s1.onTab.length === 1 && s1.onPane.length === 1 && s1.onTab[0] === s1.onPane[0],
      '默认只显示一页（当前 ' + JSON.stringify(s1.onTab) + '）');
    ok(s1.rowDpr > 0 && s1.rowAtk > 0 && s1.rowSfx > 0 && s1.rowDbg > 0,
      '各类的设置项都建出来了（画面 ' + s1.rowDpr + ' · 操作 ' + s1.rowAtk +
      ' · 音效 ' + s1.rowSfx + ' · 调试 ' + s1.rowDbg + '）');

    // ① 点「操作」分类 → 应该只显示操作页
    await A.eval('document.querySelector(\'#setTabs .tab[data-tab="ctrl"]\').click(); return 1;');
    await sleep(250);
    const s2 = JSON.parse(await A.eval(uiQ) || '{}');
    ok(s2.onTab[0] === 'ctrl' && s2.onPane[0] === 'ctrl' && s2.onPane.length === 1,
      '★ 点分类能切页（点「操作」→ 当前页 = ' + JSON.stringify(s2.onPane) + '）');

    // ② 点「大」那一档 → 按钮真变大
    await A.eval('document.querySelectorAll("#rowAtk .opt")[2].click(); return 1;');
    await sleep(300);
    const s3 = JSON.parse(await A.eval(uiQ) || '{}');
    console.log('        [攻击键大小] 点「大」→ ' + s3.w + '×' + s3.h + '（SETCFG.atkSize=' + s3.cfg + '）');
    ok(s3.w === 108 && s3.h === 108 && s3.cfg === 108,
      '★ 设置里调攻击键大小真的生效（' + s3.w + '×' + s3.h + '）');
    // ③ 切页面不该把大小弄回去（openSet 会重建所有行 ✓ 顺带验一下没串）
    ok(s3.onPane[0] === 'ctrl', '调完大小仍停在「操作」页（不会跳回第一页）');

    // ④ 恢复默认 → 回到 84
    await A.eval('document.getElementById("setReset").click(); return 1;');
    await sleep(300);
    const s4 = JSON.parse(await A.eval(uiQ) || '{}');
    ok(s4.w === 84 && s4.cfg === 84, '★ 恢复默认把攻击键大小也带回 84（实测 ' + s4.w + '）');

    /* ★ 重做了样式之后，攻击键【功能】必须还在 —— 只验好看不够 ✓
       （以前的核心是"按下 → atkHeld = true"，平台层绑的是 mousedown/touchstart ✓）
       ★ 第 41 轮加一句"先确保活着"：死的时候 frame() 会强制 atkHeld = false ✗
         （僵尸正好把甲咬死了 → 这条就假红，和攻击键一点关系都没有 ✗）*/
    await A.eval('if (typeof dead !== "undefined" && dead && typeof playerRevive === "function") { playerRevive(); } return 1;');
    await sleep(150);
    await A.eval('document.getElementById("atk").dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); return 1;');
    await sleep(120);
    const held = await A.eval('return (typeof atkHeld !== "undefined") ? atkHeld : "n/a";');
    ok(held === true, '★★ 重做样式后攻击键仍然有效（按下 → atkHeld = ' + held + '）');
    await A.eval('window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); return 1;');
    await sleep(120);
    const released = await A.eval('return (typeof atkHeld !== "undefined") ? atkHeld : "n/a";');
    ok(released === false, '松手后停手（atkHeld = ' + released + '）');

    /* ★ 冷却表现（第 33 轮）：砍完一下，按钮要真的"变暗 + 转一圈"，冷却完了再亮回来 ✓ */
    const cdQ = 'var a = document.getElementById("atk");' +
      'return JSON.stringify({ cls: a.className,' +
      ' cd: (getComputedStyle(a).getPropertyValue("--cd") || "").trim(),' +
      ' op: getComputedStyle(a.querySelector(".ic")).opacity,' +
      ' sweep: getComputedStyle(a.querySelector(".cd")).backgroundImage });';
    await A.eval('document.getElementById("atk").dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); return 1;');
    await sleep(90);   // ★ 刚砍完那一下（白圈最满）—— 截图要在这儿拍，晚一点就转没了
    if (process.env.SHOT_CD) {
      const sc = await A.send('Page.captureScreenshot', { format: 'png' });
      if (sc && sc.result && sc.result.data) {
        fs.writeFileSync(process.env.SHOT_CD, Buffer.from(sc.result.data, 'base64'));
        console.log('  INFO  冷却中截图已存到 ' + process.env.SHOT_CD);
      }
    }
    await sleep(150);
    const cd1 = JSON.parse(await A.eval(cdQ) || '{}');
    await A.eval('window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); return 1;');
    console.log('        [攻击冷却] 刚砍完：class=' + cd1.cls + ' --cd=' + cd1.cd +
      ' 图标透明度=' + cd1.op);
    console.log('        [攻击冷却] 扫过去那圈的颜色 = ' + String(cd1.sweep).slice(0, 46));
    ok(/cool/.test(String(cd1.cls)) && parseFloat(cd1.cd) > 0,
      '★ 砍完那一下按钮进入冷却（.cool，--cd=' + cd1.cd + '）');
    ok(parseFloat(cd1.op) < 0.9, '★ 冷却时图标压暗（透明度 ' + cd1.op + '）');
    // ★ 用户要求：那圈要用"透明白"，不能用黑色（黑的太闷 ✗）
    ok(/255,\s*255,\s*255/.test(String(cd1.sweep)) && !/0,\s*0,\s*0/.test(String(cd1.sweep)),
      '★ 冷却那一圈是半透明白，不是黑色');
    await sleep(1000);
    const cd2 = JSON.parse(await A.eval(cdQ) || '{}');
    console.log('        [攻击冷却] 冷却结束后：class=' + cd2.cls + ' --cd=' + cd2.cd +
      ' 图标透明度=' + cd2.op);
    ok(/ready/.test(String(cd2.cls)) && parseFloat(cd2.cd) === 0,
      '★ 冷却结束后按钮变回"能打"（.ready，--cd=' + cd2.cd + '）');

    /* ③i ★ 第 32 轮：界面精简 + 账号入口
       #1 去掉「物件/Mesh/地顶点」那块；#2 诊断去掉网格桶/音效并与帧数合成两行；
       #3 删掉「回 2D 版」，登录/登出放到设置 → 信息 ✓ */
    const tidyQ = JSON.parse(await A.eval(
      'var tr = document.getElementById("topright");' +
      'var dg = document.getElementById("diag");' +
      'var acct = document.getElementById("rowAcct");' +
      'var acctBtns = acct ? acct.querySelectorAll(".opt") : [];' +
      'return JSON.stringify({' +
      '  hasStat: !!document.getElementById("stat"),' +
      '  hasBack: !!document.getElementById("back"),' +
      '  hasTopRight: !!tr,' +
      '  lines: tr ? tr.children.length : 0,' +
      '  fpsIn: !!(tr && tr.querySelector("#fps")),' +
      '  diagIn: !!(tr && tr.querySelector("#diag")),' +
      '  diagTxt: dg ? dg.textContent : "",' +
      '  acctBtns: acctBtns.length,' +
      '  acctTxt: acct ? acct.textContent : "",' +
      '  raw: (tr ? tr.getBoundingClientRect().top : -1) });'
    ) || '{}');
    console.log('        [界面精简] 右上角两行=' + tidyQ.fpsIn + '/' + tidyQ.diagIn +
      ' 诊断="' + tidyQ.diagTxt + '"');
    console.log('        [账号] ' + tidyQ.acctTxt);
    ok(tidyQ.hasStat === false, '#1 去掉了「物件/Mesh/地顶点」那块（#stat）');
    ok(tidyQ.hasBack === false, '#3 删掉了「回 2D 版」按钮（#back）');
    ok(tidyQ.hasTopRight && tidyQ.fpsIn && tidyQ.diagIn && tidyQ.lines === 2,
      '#2 帧数和诊断合成一块两行（行数 ' + tidyQ.lines + '）');
    ok(tidyQ.diagTxt.indexOf('网格桶') < 0 && tidyQ.diagTxt.indexOf('音效') < 0,
      '#2 诊断里没有「网格桶」「音效」了');
    ok(tidyQ.diagTxt.indexOf('玩家') >= 0 && tidyQ.diagTxt.indexOf('实体') >= 0 &&
       tidyQ.diagTxt.indexOf('道友') >= 0, '#2 诊断还留着坐标/实体/道友（" ' + tidyQ.diagTxt + '"）');
    ok(tidyQ.acctBtns >= 1 && /登录|登出/.test(tidyQ.acctTxt),
      '#3 设置 → 信息 里有账号入口（"' + tidyQ.acctTxt + '"）');

    /* ★ 第 36 轮：自己血条上要有数字（用户要求）*/
    const hpTxt = await A.eval(
      'var t = document.getElementById("hpTxt");' +
      'return JSON.stringify({ txt: t ? t.textContent : "", hp: Math.round(HP), hpm: Math.round(HPMAX) });'
    );
    const hpObj = JSON.parse(hpTxt || '{}');
    console.log('        [自己的血条] 显示 "' + hpObj.txt + '"，实际 ' + hpObj.hp + ' / ' + hpObj.hpm);
    ok(/\d+\s*\/\s*\d+/.test(String(hpObj.txt)), '★ 玩家自己的血条上显示了数字（"' + hpObj.txt + '"）');
    ok(String(hpObj.txt).indexOf(String(hpObj.hp)) >= 0,
      '数字就是当前血量（' + hpObj.hp + '）');

    /* ★ 第 38 轮：经验条（用户要求"升级所需经验用蓝色进度条显示"）
       ① 要有数（服务器 welcome 带 need ✓）② 必须是【蓝】的（别是血条那个绿 ✗）*/
    const expQ = JSON.parse(await A.eval(
      'var b = document.getElementById("exp"), t = document.getElementById("expTxt");' +
      'var cs = b ? getComputedStyle(b) : null;' +
      'return JSON.stringify({' +
      '  has: !!b, w: b ? b.style.width : "", txt: t ? t.textContent : "",' +
      '  bg: cs ? (cs.backgroundImage || cs.backgroundColor || "") : "",' +
      '  role: { lv: (WSC.role && WSC.role.level) || 0, exp: (WSC.role && WSC.role.exp) || 0,' +
      '          need: (WSC.role && WSC.role.need) || 0 } });'
    ) || '{}');
    console.log('        [经验条] 文本="' + expQ.txt + '" 宽度=' + expQ.w +
      ' 角色=' + JSON.stringify(expQ.role));
    ok(expQ.has === true && /\d+\s*\/\s*\d+/.test(String(expQ.txt)),
      '★ 经验条显示"当前 / 升级所需"（"' + expQ.txt + '"）');
    ok(expQ.role && expQ.role.need > 0,
      '★ 服务器 welcome 就带了 need（不用等打死第一只怪）=' + (expQ.role && expQ.role.need));
    ok(/rgb\(142,\s*210,\s*255\)|rgb\(47,\s*127,\s*224\)/.test(String(expQ.bg)),
      '★★ 经验条是【蓝色】的（' + String(expQ.bg).slice(0, 46) + '）');

    /* ★ 第 38 轮：地上掉的（P2 第二刀）—— 拿真函数走一遍增删改 ✓
       （真掉落要打死怪才出，是概率的；这里单测渲染 + 自动捡那段逻辑 ✓）*/
    const lootQ = JSON.parse(await A.eval(
      'addWorldLoot(["t1", P.x + 0.6, P.z, "灵气结晶", 3]);' +
      'var e = NET.rloot["t1"];' +
      'var inScene = !!(e && e.g && scene.children.indexOf(e.g) >= 0);' +
      'var col = e && e.g ? "#" + e.g.material.color.getHexString() : "";' +
      'var before = Object.keys(NET.rloot).length;' +
      'updateLoot(0.016);' +
      'var asked = e ? e.asked : -1;' +
      'removeWorldLoot("t1");' +
      'return JSON.stringify({ inScene: inScene, col: col, before: before,' +
      '  asked: asked, after: Object.keys(NET.rloot).length });'
    ) || '{}');
    console.log('        [地上掉的] 加进场景=' + lootQ.inScene + ' 颜色=' + lootQ.col +
      ' 数量 ' + lootQ.before + '→' + lootQ.after + ' 自动捡计时=' + lootQ.asked);
    ok(lootQ.inScene === true, '★ 掉的东西真的加进场景了（有网格）');
    ok(lootQ.col === '#c08fff', '★ 颜色按品阶分（3 阶 → ' + lootQ.col + '）');
    ok(lootQ.asked > 0, '★★ 走到跟前会自动发拾取请求（本地先判距离）✓');
    ok(lootQ.after === lootQ.before - 1, '捡走后从场景里清掉 ✓');
    /* ★★ 第 45 轮：发光（方案 A）★★
       一个半透明外壳会像玻璃块 ✗ —— 必须是"自发光 + 沿形状的轮廓壳 + 点光源"三条 ✓
       ★ 而且点光源【必须固定盏数】（实测 40 盏 = 4 倍开销 ✗），
         并且必须在【启动时】就建好（后加灯会让 three.js 重编译所有受光材质 ✗）*/
    const glowQ = JSON.parse(await A.eval(
      'var out = {};' +
      'out.poolN = GLOW_LIGHTS.length;' +
      'out.shellTiers = [], out.lowShell = null;' +
      // 高档掉落物：应该有轮廓壳
      'addWorldLoot(["g1", P.x + 0.8, P.z, "灵气结晶", 9]);' +
      'var e1 = NET.rloot["g1"];' +
      'out.hiShell = e1 && e1.g ? e1.g.children.length : -1;' +
      // 低档：不该有壳
      'addWorldLoot(["g2", P.x - 0.8, P.z, "破布", 1]);' +
      'var e2 = NET.rloot["g2"];' +
      'out.lowShell = e2 && e2.g ? e2.g.children.length : -1;' +
      // 灯要跟着最近的发光物
      'updateGlowLights();' +
      'var lit = 0, maxI = 0;' +
      'for (var i = 0; i < GLOW_LIGHTS.length; i++) {' +
      '  if (GLOW_LIGHTS[i].intensity > 0) { lit++; }' +
      '  if (GLOW_LIGHTS[i].intensity > maxI) { maxI = GLOW_LIGHTS[i].intensity; } }' +
      'out.lit = lit; out.maxI = Math.round(maxI * 100) / 100;' +
      'out.sceneLights = 0;' +
      'scene.traverse(function (o) { if (o.isPointLight) { out.sceneLights++; } });' +
      'removeWorldLoot("g1"); removeWorldLoot("g2");' +
      'return JSON.stringify(out);'
    ) || '{}');
    console.log('        [发光] 灯池=' + glowQ.poolN + ' 盏 · 高/低阶掉落物的子网格=' +
      glowQ.hiShell + '/' + glowQ.lowShell + ' · 点亮=' + glowQ.lit +
      ' · 强度=' + glowQ.maxI + ' · 场景里点光源=' + glowQ.sceneLights);
    ok(glowQ.poolN === 2, '★★ 点光源【固定 2 盏】（实测 40 盏 = 4 倍开销 ✗，所以必须封顶）');
    ok(glowQ.sceneLights === 2, '★★ 启动时就把 2 盏灯建好了（后加灯会触发着色器重编译 ✗）');
    ok(glowQ.hiShell === 1, '★ 高阶掉落物有【轮廓壳】（本体是 mesh 本身，所以子节点 1 = 那个壳 ✓）');
    ok(glowQ.lowShell === 0, '★ 低阶（0-3 品）不发光，没有壳（子节点 0 ✓）');
    ok(glowQ.lit >= 1 && glowQ.maxI > 0, '★ 2 盏灯会派给最近的发光物（点亮 ' + glowQ.lit + ' 盏）');

    /* ★★ 第 46 轮：治疗要看得出来（用户反馈"看不出关联"）★★
       ① 医生 → 僵尸 要有【连线】
       ② 僵尸头顶要弹【绿色 +N】
       ③ ★ 淡出只能缩粗细，【绝不能改共享材质的 opacity】✗（第 44 轮踩过：改了全场一起淡）*/
    const healQ = JSON.parse(await A.eval(
      'var out = {};' +
      'beamMat();' +                                        // ★ 先建出来：材质是懒加载的，null 时取不到值 ✗（踩过）' +
      'var o0 = _beamMat.opacity;' +
      'addHealBeam(P.x + 3, P.z, P.x, P.z, 0);' +           // 参数多的那个是 4 参版，这里故意多传看会不会崩
      'addHealBeam(P.x + 3, P.z, P.x + 1, P.z + 1);' +
      'out.beams = _healBeams.length;' +
      'out.inScene = 0;' +
      'for (var i = 0; i < _healBeams.length; i++) {' +
      '  if (scene.children.indexOf(_healBeams[i].g) >= 0) { out.inScene++; } }' +
      'healNum("+25", P.x, 2.9, P.z);' +
      'var green = 0, before = document.getElementsByTagName("div").length;' +
      'var all = document.getElementsByTagName("div");' +
      'for (var k = 0; k < all.length; k++) {' +
      '  var st = all[k].style;' +
      '  if (st && st.color && st.color.indexOf("126, 224, 138") >= 0) { green++; } }' +
      'out.greenNum = green; out.domBefore = before;' +
      'var thick0 = _healBeams[0].g.scale.x;' +
      'updateHealFx(HEAL_FX_T * 0.5);' +                    // 过半寿命
      'out.thickShrunk = _healBeams.length ? (_healBeams[0].g.scale.x < thick0) : false;' +
      'out.matOpacityUnchanged = (_beamMat.opacity === o0);' +
      'updateHealFx(HEAL_FX_T);' +                          // 寿终
      'out.beamsAfter = _healBeams.length;' +
      'return JSON.stringify(out);'
    ) || '{}');
    console.log('        [治疗] 连线=' + healQ.beams + ' 条（在场景里 ' + healQ.inScene +
      '）· 绿字=' + healQ.greenNum + ' 个 · 变细=' + healQ.thickShrunk +
      ' · 共享材质没被动=' + healQ.matOpacityUnchanged + ' · 到期后剩=' + healQ.beamsAfter);
    ok(healQ.beams >= 1 && healQ.inScene === healQ.beams, '★★ 医生到僵尸的连线真的画出来了');
    ok(healQ.greenNum >= 1, '★★ 被治的僵尸头顶弹了绿色 +N（玩家看得出回了多少）');
    ok(healQ.thickShrunk === true, '★ 淡出靠缩粗细 ✓');
    ok(healQ.matOpacityUnchanged === true,
      '★★★ 淡出【没有改共享材质的 opacity】✓（改了会全场一起淡 ✗ —— 第 44 轮的教训）');
    ok(healQ.beamsAfter === 0, '★ 到期后连线回收干净 ✓');

    /* ★★ 第 48 轮：菜单 + 图标格子背包 ★★
       用户要求：① 设置按钮改成菜单、背包集成进去（少一个按钮 ✓）
                ② 背包要像 MC 那样是【图标格子】，不要纯文字列表 ✓
       ③ 穿上一把武器 → 本地预测的 冷却/射程/攻击弧 要跟着换
          （不换会出现"看着打到了、服务器说没中"✗）*/
    // ★ 先【脱光】再测 —— 账号是持久的，上一轮测试可能已经穿着双手斧了 ✗
    //   （踩过：基线本来就是 0.827，于是"换武器会变慢"这条永远不成立 ✗）
    await A.eval('if (WSC && WSC.ready) { wsSend("unequip", {}); } return 1;');
    await sleep(900);
    // 再让管理员给一件好认的武器（双手斧：慢、长、弧大 ✓）
    await ADMIN_ACT('give', { kind: 'axe', tier: 5 });
    await sleep(700);
    const menuQ = JSON.parse(await A.eval(
      'var out = {};' +
      'out.btnTxt = (document.getElementById("setBtn") || {}).textContent || "";' +
      'out.hasBagBtn = !!document.getElementById("bagBtn");' +
      'var tb = document.querySelectorAll("#setTabs .tab"); out.hasBagTab = false;' +
      'for (var i = 0; i < tb.length; i++) {' +
      '  if (tb[i].getAttribute("data-tab") === "bag") { out.hasBagTab = true; } }' +
      'var pn = document.querySelectorAll("#setPanel .tabpane"); out.hasBagPane = false;' +
      'for (var j = 0; j < pn.length; j++) {' +
      '  if (pn[j].getAttribute("data-pane") === "bag") { out.hasBagPane = true; } }' +
      'out.hasGrid = !!document.getElementById("bagGrid");' +
      'out.hasEqSlot = !!document.getElementById("bagEqSlot");' +
      'return JSON.stringify(out);'
    ) || '{}');
    console.log('        [菜单] 按钮="' + menuQ.btnTxt + '" 独立背包按钮=' + menuQ.hasBagBtn +
      ' 背包标签=' + menuQ.hasBagTab + ' 背包页=' + menuQ.hasBagPane +
      ' 格子=' + menuQ.hasGrid + ' 装备槽=' + menuQ.hasEqSlot);
    ok(String(menuQ.btnTxt).indexOf('菜单') >= 0, '★★ 设置按钮改成「菜单」了（' + menuQ.btnTxt + '）');
    ok(menuQ.hasBagBtn === false, '★★ 界面上少了一个按钮（独立背包按钮已去掉 ✓）');
    ok(menuQ.hasBagTab === true && menuQ.hasBagPane === true, '★ 背包是菜单里的一个标签页 ✓');
    ok(menuQ.hasGrid === true && menuQ.hasEqSlot === true,
      '★★ 背包是【格子 + 装备槽】（不是纯文字列表 ✓ 用户要求像 MC）');

    // 打开菜单 → 背包页 → 等拉取
    await A.eval('openSet("bag"); return 1;');
    await sleep(1500);
    const bagQ = JSON.parse(await A.eval(
      'var out = {};' +
      'out.tab = SETCFG.setTab;' +
      'var sl = document.querySelectorAll("#bagGrid .slot"); out.slots = sl.length;' +
      'out.empty = 0; out.withIcon = 0; out.weapons = 0;' +
      'out.eqSlot = (document.getElementById("bagEqSlot") || {}).className || "";' +
      'for (var k = 0; k < sl.length; k++) {' +
      '  if (sl[k].className.indexOf("empty") >= 0) { out.empty++; continue; }' +
      '  if (sl[k].querySelector("svg")) { out.withIcon++; }' +
      '  if (sl[k].getAttribute("data-w") === "1") { out.weapons++; } }' +
      'out.items = BAG.items.length;' +
      // ★ 第 49 轮：图标要是"武器的平面微缩版"（矩形拼出来的），不是抽象线条
      'var s0 = document.querySelector("#bagGrid .slot:not(.empty) svg");' +
      'out.iconRects = s0 ? s0.querySelectorAll("rect,circle").length : 0;' +
      'out.iconIsStroke = s0 ? s0.classList.contains("micon") : true;' +
      'out.cd0 = G.ATK_CD; out.reach0 = G.ATK_RANGE; out.arc0 = G.ATK_ARC;' +
      'out.stat0 = (document.getElementById("bagStat").textContent || "").slice(0, 300);' +
      // 悬停第一件武器 → 提示框要出来（MC 那种 ✓）
      'var w0 = null;' +
      'for (var m = 0; m < sl.length; m++) {' +
      '  if (sl[m].getAttribute && sl[m].getAttribute("data-w") === "1") { w0 = sl[m]; break; } }' +
      'out.hasW = !!w0;' +
      'if (w0) { var r = w0.getBoundingClientRect();' +
      '  w0.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: r.left + 8, clientY: r.top + 8 })); }' +
      'var bx = document.getElementById("bagTipBox");' +
      'out.tipShow = bx ? bx.style.display : "none";' +
      'out.tipTxt = bx ? (bx.textContent || "").slice(0, 40) : "";' +
      'if (w0) { w0.click(); }' +          // 第 54 轮：点格子只是【选中】✓
      'if (w0) { var ub = document.getElementById("bagUse");' +
      '  if (ub && !ub.disabled) { ub.click(); } }' +   // 再按【使用】才真的穿上 ✓
      'return JSON.stringify(out);'
    ) || '{}');
    console.log('        [背包] 格子 ' + bagQ.slots + ' 个（空 ' + bagQ.empty + ' · 有图标 ' +
      bagQ.withIcon + ' · 其中武器 ' + bagQ.weapons + '）共 ' + bagQ.items + ' 件');
    console.log('        [背包] 悬停提示=' + bagQ.tipShow + ' "' + bagQ.tipTxt + '"');
    console.log('        [背包] 属性栏：' + bagQ.stat0);
    ok(bagQ.tab === 'bag', '★ 菜单停在背包页（SETCFG.setTab="bag" ✓）');
    ok(bagQ.slots >= 16 && bagQ.slots % 8 === 0,
      '★★ 背包是格子（' + bagQ.slots + ' 个槽，8 的倍数 —— 空槽也画出来才像格子 ✓）');
    ok(bagQ.withIcon >= 1 && bagQ.withIcon === bagQ.weapons,
      '★★★ 每件武器都有【图标】（' + bagQ.withIcon + '/' + bagQ.weapons + ' 个槽画出了 SVG ✓）');
    ok(bagQ.tipShow === 'block' && bagQ.tipTxt.length > 2,
      '★★ 悬停显示详情（" + bagQ.tipTxt + " ✓ 像 MC 的提示框）');
    ok(/实际每击/.test(bagQ.stat0) && /武器强度/.test(bagQ.stat0),
      '★★ 显示分两行：实际每击（含你的等级 ✓）+ 武器强度（纯比较 ✓）—— ' +
      '用户报的"显示 164、实际没那么高"就是这两件事混在一起了 ✗');
    ok(/每秒伤害/.test(bagQ.stat0) && /范围/.test(bagQ.stat0),
      '★ 每秒伤害 / 范围 都在 ✓');
    /* ★★ 等级门槛必须看得见（用户报的"都是 68"就是穿不上但看不出来 ✗）★★ */
    const lockQ = JSON.parse(await A.eval(
      'var lv = (WSC.role && WSC.role.level) || 1;' +
      'var out = {};' +
      'out.need25 = wNeedLevel({ reqLevel: 25 });' +
      'out.need1 = wNeedLevel({ reqLevel: 1 });' +
      'out.needMine = wNeedLevel({ reqLevel: lv });' +
      'out.lv = lv;' +
      // 真每击必须等于"固有 × 系数 + 平伤"再封顶（和服务器一个口径 ✓）
      'var inh = 10 + 3 * lv + 0.08 * lv * lv;' +
      'var it = { slot: "weapon", tier: 4, itemLv: 3, reqLevel: 25,' +
      '  base: { coeff: 1.40, atkSpeed: 0.75, reach: 3.0, arc: 1.55 } };' +
      // ★ 第 54 轮：还要算【等级发挥度】——假武器给 reqLevel:1 就是满发挥 ✓
      // ★ 第 60 轮：封顶是 固有×(2.5+0.06×阶) ✓ 不是固定 2.5 ✗
      'var cap = inh * (2.5 + 0.06 * (it.tier || 0));' +
      'var want = Math.min((inh * 1.40 + wFlat(it)) * wMastery(it), cap);' +
      'out.real = Math.round(wRealHit(it) * 100) / 100;' +
      'out.want = Math.round(want * 100) / 100;' +
      'out.strength = Math.round(wStrength(it));' +
      'return JSON.stringify(out);'
    ) || '{}');
    console.log('        [锁] 玩家 Lv.' + lockQ.lv + ' → 需要25级的=' + lockQ.need25 +
      ' 需要1级的=' + lockQ.need1 + ' 需要本级=' + lockQ.needMine +
      ' · 真每击 ' + lockQ.real + '（应 ' + lockQ.want + '）· 强度 ' + lockQ.strength);
    ok(lockQ.need25 === 25 && lockQ.need1 === 0 && lockQ.needMine === 0,
      '★★★ 等级门槛能判出来（需要 25 级 → 返回 25 ✓ 够的就返回 0 ✓）—— ' +
      '穿不上时格子上锁、面板留红字，不再只靠一闪而过的 toast ✗');
    ok(Math.abs(lockQ.real - lockQ.want) < 0.02,
      '★★★ "实际每击"就是服务器那条公式（固有 × 系数 + 平伤，再封顶 ✓ ' +
      lockQ.real + '）—— 不再是那个编出来的 100 基准 ✗');
    ok(lockQ.strength > lockQ.real * 2,
      '★ 武器强度（' + lockQ.strength + '）明显高于实际每击（' + lockQ.real +
      '）—— 正因如此必须分开显示、并标清"强度只比武器"✓');
    ok(!/攻击力/.test(bagQ.stat0), '★ 面板上不再显示"攻击力"这种混了口径的数 ✓');
    ok(/贴身|短|中|长|超远/.test(bagQ.stat0), '★ 范围有文字描述（贴身/短/中/长/超远 ✓）');
    ok(/打击面/.test(bagQ.stat0) && /(窄|中|宽|横扫)/.test(bagQ.stat0),
      '★★ 弧改成了文字描述（"打击面 宽 · 一片"这种 ✓ 用户要求）');
    /* ★★ 和服务器对账：同一件武器两边算的必须一模一样 ★★
       已知值（server 侧 tools/test_weapons.py ⑦ 钉的是同一个数）：
         5 阶双手斧 / 物品 8 级 → 武器伤害 196 · 暴击 294 · 间隔 0.827 秒 */
    const crossQ = JSON.parse(await A.eval(
      'var it = { slot: "weapon", look: "axe", tier: 5, itemLv: 8, reqLevel: 1,' +
      '  base: { coeff: 1.45, atkSpeed: 0.75, reach: 3.0, arc: 1.55 } };' +
      'return JSON.stringify({ dmg: Math.round(wDamage(it)), crit: Math.round(wCrit(it)),' +
      ' dps: Math.round(wDps(it)), interval: Math.round(wInterval(it) * 1000) / 1000 });'
    ) || '{}');
    console.log('        [对账] 5阶双手斧/物品8级 → 武器伤害 ' + crossQ.dmg + ' 暴击 ' +
      crossQ.crit + ' 每秒 ' + crossQ.dps + ' 间隔 ' + crossQ.interval + ' 秒');
    ok(crossQ.dmg === 196 && crossQ.crit === 294 && crossQ.interval === 0.827,
      '★★★ 客户端算的和服务器完全一致（196 / 294 / 0.827 ✓ 不一致就是"显示的和打出去的"不符 ✗）');
    const lvQ = JSON.parse(await A.eval(
      'var it = { slot: "weapon", tier: 5, itemLv: 8, reqLevel: 1,' +
      '  base: { coeff: 1.45, atkSpeed: 0.75, reach: 3.0, arc: 1.55 } };' +
      'var real = WSC.role.level;' +
      'WSC.role.level = 1; var a2 = wDamage(it);' +
      'WSC.role.level = 99; var a3 = wDamage(it); WSC.role.level = real;' +
      'return JSON.stringify({ a2: a2, a3: a3 });'
    ) || '{}');
    ok(lvQ.a2 === lvQ.a3,
      '★★★ 玩家 1 级 / 99 级看同一把武器，显示的武器伤害完全一样（' + lvQ.a2 +
      ' ✓ 不受等级影响，才能横向比哪把好 ✓）');
    /* ★ 空手时不能显示 0（服务器是按默认单手剑兜底的 ✓）*/
    const emptyQ = JSON.parse(await A.eval(
      'return JSON.stringify({ d: Math.round(wDamage(DEFAULT_W)),' +
      ' reach: DEFAULT_W.base.reach, spd: DEFAULT_W.base.atkSpeed });'
    ) || '{}');
    ok(emptyQ.d > 0 && emptyQ.reach === 2.4 && emptyQ.spd === 1.15,
      '★★ 空手时按默认单手剑显示（武器伤害 ' + emptyQ.d + ' · 范围 2.4 米 ✓ 不显示 0 ✗）');
    await sleep(1700);
    const eqQ = JSON.parse(await A.eval(
      'return JSON.stringify({ wp: (MY_WEAPON || {}).name || "(默认剑)",' +
      ' cd: Math.round(G.ATK_CD * 1000) / 1000, reach: G.ATK_RANGE, arc: G.ATK_ARC,' +
      ' eqTxt: (document.getElementById("bagEqSlot").textContent || "").slice(0, 20),' +
      ' eqW: document.getElementById("bagEqSlot").getAttribute("data-w"),' +
      // ★ 第 49 轮：手上那把要按【当前武器】重建（零件数/发光数跟着类型和品阶变 ✓）
      /* ★ 第 54 轮：手上那把外面包了一层 Group（用来转 90° 让刀刃朝前 ✓）
         → 零件要数它【里面】的，不再是 sw 的直接子节点 ✗ */
      ' heldParts: (function () {' +
      '   if (!H || !H.sw) { return -1; }' +
      '   var g0 = H.sw.children[0];' +
      '   return g0 ? g0.children.length : H.sw.children.length; })(),' +
      ' heldGlow: (function () { var n = 0;' +
      '   if (!H || !H.sw) { return -1; }' +
      '   var g0 = H.sw.children[0];' +
      '   var arr = g0 ? g0.children : H.sw.children;' +
      '   for (var i = 0; i < arr.length; i++) {' +
      '     var m = arr[i].material;' +
      '     if (m && m.emissiveIntensity > 0) { n++; } }' +
      '   return n; })(),' +
      ' heldRotY: (function () {' +                    // 顺便把朝向也钉住 ✓
      '   if (!H || !H.sw || !H.sw.children[0]) { return null; }' +
      '   return Math.round(H.sw.children[0].rotation.y * 180 / Math.PI); })() });'
    ) || '{}');
    console.log('        [背包] 穿后：' + eqQ.wp + '  cd=' + eqQ.cd + ' reach=' + eqQ.reach + ' arc=' + eqQ.arc);
    ok(eqQ.wp !== '(默认剑)', '★★ 点一下格子就穿上了（现在是 ' + eqQ.wp + ' ✓）');
    ok(eqQ.eqW === '1', '★ 装备槽里显示出了手上这把（图标 + 品阶角标 ✓）');
    /* ★★ 第 49 轮：手上武器外观 + 平面微缩图标 ★★ */
    console.log('        [武器] 手上零件=' + eqQ.heldParts + ' 其中发光=' + eqQ.heldGlow +
      ' · 图标矩形=' + bagQ.iconRects);
    ok(bagQ.iconRects >= 4 && bagQ.iconIsStroke === false,
      '★★★ 背包图标是武器的【平面微缩版】（' + bagQ.iconRects +
      ' 个零件投影成矩形 ✓ 不是抽象线条 ✓ 用户要的就是这个）');
    ok(eqQ.heldParts >= 12,
      '★★★ 手上那把是按【当前武器】生成的（双手斧 ' + eqQ.heldParts + ' 个零件 ✓ 不再是写死的一把剑）');
    ok(eqQ.heldGlow >= 12,
      '★★ 高阶武器会发光（' + eqQ.heldGlow + ' 个零件带自发光 —— 5 阶玄铁就有 ✓ 方案 §7.10）');
    // 换一把别的类型 → 零件数要跟着变（证明真的重建了 ✓）
    // ★ 先确认背包里【真有】长枪（测试账号是持久的，但不一定有枪 ✗）
    await ADMIN_ACT('give', { kind: 'spear', tier: 5 });
    await A.eval('bagFetch(bagRender); return 1;');
    await sleep(900);
    const nBefore = eqQ.heldParts;
    await A.eval(
      'var sl = document.querySelectorAll("#bagGrid .slot");' +
      'for (var i = 0; i < sl.length; i++) {' +
      '  var idx = +sl[i].getAttribute("data-i");' +
      '  var it = (BAG.items[idx] || {}).item;' +
      '  if (it && it.slot === "weapon" && it.look === "spear") { sl[i].click(); break; } }' +
      // ★ 第 54 轮：点格子只是选中 → 还要按【使用】才真的换 ✓
      'var ub2 = document.getElementById("bagUse");' +
      'if (ub2 && !ub2.disabled) { ub2.click(); }' +
      'return 1;');
    await sleep(1700);
    const spQ = JSON.parse(await A.eval(
      'var g0 = (H && H.sw && H.sw.children[0]);' +
      'var n = g0 ? g0.children.length : ((H && H.sw) ? H.sw.children.length : -1);' +
      'var ic = weaponIconSvg("spear", 5);' +
      'return JSON.stringify({ n: n, wp: (MY_WEAPON || {}).name || "?",' +
      ' shapes: (ic.match(/<rect|<circle/g) || []).length, reach: G.ATK_RANGE });'
    ) || '{}');
    console.log('        [武器] 换成 ' + spQ.wp + ' → 零件 ' + nBefore + ' → ' + spQ.n +
      ' · 长枪图标 ' + spQ.shapes + ' 个形状 · 射程 ' + spQ.reach);
    ok(spQ.n !== nBefore && spQ.n > 0,
      '★★★ 换武器会重建手上的模型（零件 ' + nBefore + ' → ' + spQ.n + ' ✓ 不是一直那一把）');
    ok(spQ.shapes >= 5, '★★ 不同武器的图标也不同（长枪 ' + spQ.shapes + ' 个形状 + 射程 ' +
      spQ.reach + ' 米 ✓ 图标和数值都对得上）');
    /* ★★ 第 54 轮：刀刃朝向（用户报的"拿着斧头时刀刃不是朝下"）★★
       挥砍是绕 X 轴往下劈 → 刀刃必须朝 ±Z（正前/正后）
       零件数据是"宽在X"（正面看刀的平面 ✓ 示意图就是这样）
       → 所以手上那把要绕 Y 转 -90°，把刃口从 ±X 转到 ±Z ✓ */
    ok(eqQ.heldRotY === -90,
      '★★★ 手上武器绕 Y 转了 -90°（' + eqQ.heldRotY + '° ✓ —— 这样劈下去才是【刃】先着，' +
      '不是拿刀面拍人 ✗ 八种武器一起修好 ✓）');
    ok(eqQ.cd > bagQ.cd0 + 0.05,
      '★★★ 换武器之后本地冷却跟着变（' + bagQ.cd0 + ' → ' + eqQ.cd + ' 秒，双手斧更慢 ✓）');
    ok(eqQ.reach > bagQ.reach0 - 0.01 && eqQ.arc > bagQ.arc0 + 0.05,
      '★★★ 射程/攻击弧也跟着换了（' + bagQ.reach0 + '→' + eqQ.reach + ' 米 · ' +
      bagQ.arc0 + '→' + eqQ.arc + ' 弧度 ✓）');
    await A.eval('closeSet(); return 1;');

    /* ★★★ 第 105 轮：钉住“收到防具消息要更新血量上限” ★★★
       用户报：“穿戴防具后血量还是没有变化”
       根因：这段代码第 102 轮加过，被后面的补丁【冲掉了】✗（静默消失 ✗）
       → 光修不够 ✗ 得有条断言钉着 ✓（不然下次还会被冲掉 ✗）*/
    const hpQ = JSON.parse(await A.eval(
      'var before = HPMAX;' +
      'var shown0 = (document.getElementById("hpTxt") || {}).textContent;' +
      'wsOnMessage(JSON.stringify({ t: "armor", d: { a: null, hpm: 9999 } }));' +
      'var after = HPMAX;' +
      'var shown = (document.getElementById("hpTxt") || {}).textContent;' +
      'wsOnMessage(JSON.stringify({ t: "armor", d: { a: null, hpm: before } }));' +
      'return JSON.stringify({ before: before, after: after, shown: shown,' +
      ' shown0: shown0, restored: HPMAX });'
    ) || '{}');
    console.log('        [防具血量] hpm=9999 前 ' + hpQ.before + ' → 后 ' +
      hpQ.after + ' · 血条 "' + hpQ.shown0 + '" → "' + hpQ.shown +
      '" · 还原 ' + hpQ.restored);
    ok(hpQ.after === 9999,
      '★★★ 收到防具消息里的 hpm → 客户端血量上限立刻跟着变（' +
      hpQ.before + ' → ' + hpQ.after + ' ✓）');
    ok(String(hpQ.shown || '').indexOf('9999') >= 0,
      '★★ 血条文字也刷了（"' + hpQ.shown + '" ✓）');
    ok(hpQ.restored === hpQ.before, '★ 测完还原了（' + hpQ.restored + ' ✓）');
    await A.eval('closeSet(); return 1;');

    /* ★★ 第 61 轮：三套挥砍动作（劈 / 扫 / 刺）★★
       用户："现在 8 种武器挥起来还是一模一样" → 按类型分三套 ✓ */
    const archQ = JSON.parse(await A.eval(
      'var out = { map: {}, poses: {} };' +
      'var looks = ["axe","hammer","sword","saber","staff","dagger","spear"];' +
      'for (var i = 0; i < looks.length; i++) {' +
      '  var lk = looks[i];' +
      '  out.map[lk] = atkArchOf(lk);' +
      '  var row = [];' +
      '  for (var k = 0; k < 5; k++) {' +
      '    heroAtkPose(H, 0.06 + k * 0.16, P.x, P.z, P.yaw, lk);' +
      '    row.push(Math.round(H.armR.rotation.x * 100) / 100); }' +
      '  out.poses[lk] = row.join();' +
      '}' +
      'return JSON.stringify(out);'
    ) || '{}');
    console.log('        [动作] 斧=' + archQ.map.axe + ' 剑=' + archQ.map.sword +
      ' 匕首=' + archQ.map.dagger + ' 枪=' + archQ.map.spear);
    ok(archQ.map.axe === 'chop' && archQ.map.hammer === 'chop',
      '★★ 斧头/锤 = 劈（抬手过顶再砸 ✓）');
    ok(archQ.map.sword === 'sweep' && archQ.map.saber === 'sweep' &&
       archQ.map.staff === 'sweep', '★★ 单手剑/刀/长棍 = 扫（身体带着转 ✓）');
    ok(archQ.map.dagger === 'thrust' && archQ.map.spear === 'thrust',
      '★★ 匕首/长枪 = 刺（直捅、秒收 ✓）');
    ok(archQ.poses.axe !== archQ.poses.saber &&
       archQ.poses.saber !== archQ.poses.dagger &&
       archQ.poses.axe !== archQ.poses.dagger,
      '★★★ 三套动作的姿势【真的不同】（同一时刻的手臂角度不一样 ✓ ' +
      '不再是八种武器一套动作 ✗）');
    /* 时间轴也不同：刺最快、劈最慢 ✓ */
    const tmQ = JSON.parse(await A.eval(
      'return JSON.stringify({ chop: ATK_T.chop[3], sweep: ATK_T.sweep[3],' +
      ' thrust: ATK_T.thrust[3] });'
    ) || '{}');
    ok(tmQ.thrust < tmQ.sweep && tmQ.sweep < tmQ.chop,
      '★★ 三套的节奏也不同（刺 ' + tmQ.thrust + 's < 扫 ' + tmQ.sweep +
      's < 劈 ' + tmQ.chop + 's ✓ 匕首秒收、斧头收招慢 ✓）');
    await A.eval('heroAtkReset(H, P.x, P.z, P.yaw); return 1;');

    /* ★★ 第 62 轮：武器效果的视觉反馈 ★★
       用户："武器的效果也有加效果显示吗，例如背后攻击，应该要显示额外伤害"
       ★ 以前服务器一直在发 fx，但客户端【根本没处理】✗ → 效果发生了却看不到 */
    const fxQ = JSON.parse(await A.eval(
      'var before = document.querySelectorAll("body > div").length;' +
      'fxNum("背击", "#ffd83d", P.x, 2.4, P.z);' +
      'fxNum("额外 +37", "#ffd83d", P.x, 2.9, P.z);' +
      'fxNum("流血", "#ff7a6a", P.x, 2.6, P.z);' +
      'var after = document.querySelectorAll("body > div").length;' +
      'var found = 0;' +
      'var all = document.querySelectorAll("body > div");' +
      'for (var i = 0; i < all.length; i++) {' +
      '  var tx2 = all[i].textContent || "";' +
      '  if (tx2 === "背击" || tx2 === "额外 +37" || tx2 === "流血") { found++; } }' +
      'return JSON.stringify({ fn: typeof fxNum, added: after - before, found: found });'
    ) || '{}');
    console.log('        [效果] fxNum=' + fxQ.fn + ' 飘字新增 ' + fxQ.added +
      ' 个 · 找到 ' + fxQ.found + ' 个关键字');
    ok(fxQ.fn === 'function', '★★ 有【带颜色的飘字】函数（fxNum ✓ 效果文字要能区分颜色）');
    ok(fxQ.found >= 3, '★★★ 效果文字真的飘出来了（背击 / 额外 +N / 流血 ✓ ' +
      '用户要的"显示额外伤害"✓）');

    /* ★★ 第 57 轮：其它玩家的倒地姿态 ★★
       用户报："死亡的动画没有做服务器同步，别的玩家看不到，别人看你死亡依旧是站立的"
       → 服务器快照加了 'd'（hp<=0 就是 1）✓ 客户端按 o.dead 摆成躺地 ✓
       ★ 这里造一个"假队友"直接验渲染那条路径（不用真等别人死一遍 ✓）*/

    // 顺手截一张设置面板（SHOT2）—— 第三参数可指定截哪一页（默认 about ✓）
    if (process.env.SHOT2) {
      await A.eval('openSet(); setTab(' + JSON.stringify(process.env.SHOT_TAB || 'about') + '); return 1;');
      await sleep(400);
      const shot2 = await A.send('Page.captureScreenshot', { format: 'png' });
      if (shot2 && shot2.result && shot2.result.data) {
        fs.writeFileSync(process.env.SHOT2, Buffer.from(shot2.result.data, 'base64'));
        console.log('  INFO  设置面板截图已存到 ' + process.env.SHOT2);
      }
    }
    await A.eval('var p = document.getElementById("setPanel"); if (p) { p.style.display = "none"; } return 1;');
    await sleep(200);

    /* ④ UI 冒烟：把"人在玩"的动作都过一遍 —— 专抓"事件字段想当然"这一类
       （第 27 轮的真 bug：中文输入法/软键盘发来的 keydown 里 e.key 是 undefined，
         旧代码 e.key.toLowerCase() 直接抛 TypeError → 页面只显示一句"出错：..."）

       ★ 这个冒烟必须【自证有效】，不然会假绿：
         第一版只写了"dispatch 一堆事件然后断言 errors 为空" —— 结果把旧代码换回去照样 PASS ✗
         原因是它无法区分"没抛异常"和"事件根本没送到处理函数"。
         所以下面加两道自检：
           ① 故意抛一个未捕获异常，确认 CDP 真的收得到（捕获机制有效）
           ② 按一下 w，确认 keys.w 真的变成 true（事件真的送到了）*/
    const n0 = (await A.allErrors()).length;
    await A.eval('setTimeout(function () { throw new Error("PROBE-捕获自检"); }, 0); return 1;');
    await sleep(500);
    const e1 = await A.allErrors();
    ok(e1.length > n0, '★ 异常捕获机制有效（故意抛一个，收得到）' +
      (e1.length > n0 ? ' —— ' + e1[e1.length - 1] : ' —— 一条都没收到 ✗'));
    // 把自检留下的那行红字擦掉（不然它会一直挂在 #err 上，影响后面看截图/看报错）
    await A.eval('var e = document.getElementById("err"); if (e) { e.textContent = ""; } return 1;');

    await A.eval('window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" })); return 1;');
    await sleep(50);
    const kvRaw = await A.eval('return JSON.stringify({ w: (typeof keys !== "undefined") && keys.w === true });');
    const kv = (typeof kvRaw === 'string') ? JSON.parse(kvRaw) : {};
    ok(kv.w === true, '★ 键盘事件真的送到了处理函数（keys.w = ' + kv.w + '）');
    await A.eval('window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" })); return 1;');

    await A.eval(
      'var c = UI.mainCanvas();' +
      // ① 输入法那种 key 为 undefined 的按键（复现旧 bug）
      'var e1 = new Event("keydown"); e1.key = undefined; window.dispatchEvent(e1);' +
      'var e2 = new Event("keyup");   e2.key = undefined; window.dispatchEvent(e2);' +
      // ② 没有 changedTouches 的 touchstart（复现旧 bug）
      'c.dispatchEvent(new Event("touchstart", { bubbles: true, cancelable: true }));' +
      'c.dispatchEvent(new Event("touchend",   { bubbles: true, cancelable: true }));' +
      // ③ 鼠标：点画布 + 按攻击键
      'c.dispatchEvent(new MouseEvent("mousedown", { clientX: 120, clientY: 120, bubbles: true }));' +
      'window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));' +
      'var ab = document.getElementById("atk");' +
      'if (ab) { ab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); ab.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); }' +
      // ④ 窗口缩放（手机横竖屏切换就是这条路径）
      'window.dispatchEvent(new Event("resize"));' +
      'if (typeof UI.onResize === "function") { UI.onResize(); }' +
      // ⑤ 死亡 → 复活 遮罩（只在"血空了"才会走到，平时测不到）
      'if (typeof playerDie === "function") { playerDie("自检"); }' +
      'if (typeof playerRevive === "function") { playerRevive(); }' +
      // ⑥ 设置面板（会重建那一堆选项行）
      'if (typeof openSet === "function") { openSet(); }' +
      'return 1;'
    );
    await sleep(600);
    const errA = (await A.allErrors()).filter(function (x) { return x.indexOf('PROBE-捕获自检') < 0; });
    ok(errA.length === 0, '★ UI 冒烟无未捕获异常（按键/输入法/触摸/鼠标/攻击键/缩放/死亡复活/设置面板）' +
      (errA.length ? ' —— ' + errA.join(' | ') : ''));
    // 收尾：关掉设置面板，别挡着后面的截图
    await A.eval('if (typeof bindSet === "function") { var s=document.getElementById("setClose"); if (s && s.onclick) { s.onclick(); } } ' +
      'var p=document.getElementById("setPanel"); if (p) { p.style.display="none"; } return 1;');
    await sleep(300);
    // ③ 渲染循环真的在跑：diagTick 每帧 +1，隔一秒看它有没有前进
    const t1 = await A.state();
    await sleep(1000);
    const t2 = await A.state();
    ok(t1 && t2 && t2.diagTick > t1.diagTick,
      '★ 渲染循环真的在跑（diagTick ' + (t1 && t1.diagTick) + ' → ' + (t2 && t2.diagTick) + '）');

    // ④ 走一段路，看服务端有没有收到（位置是客户端算的，但要能上报）
    await A.eval('P.x += 3; return 1;');   // 稍微挪一下，触发上报
    await sleep(1500);
    const h = await (await fetch(ORIGIN + '/api/health')).json();
    // ★ 别写成 "online == 基线+2"：你自己开着的客户端随时可能连/断，
    //   一抵消这条就随机红 ✗（实测 3 次红 1 次）。
    //   "我们俩真的进世界了"由前面 WSC.ready + 互相看得见两条断言保证，
    //   这里只要确认服务端确实有人在世界里就行 ✓
    ok(h.world.online >= 2, '服务端世界里有人在线（' + h.world.online + ' 人，开跑前 ' + base + ' 人）');
    // ★ 别拿 tickMaxMs 当断言（test_ws 里踩过同一个坑）：
    //   那是【服务端重启前一直累计的历史峰值】，被别的进程（比如并行起的无头 Chrome）
    //   抢一下 CPU 就蹦上去、然后永远红 ✗ → 历史峰值只当 INFO，"现在快不快"当场采样 ✓
    console.log('  INFO  历史 tick 峰值 ' + h.world.tickMaxMs + 'ms（累计值，仅供排查参考）');
    let tickNow = 0;
    for (let i = 0; i < 6; i++) {
      const hh = await (await fetch(ORIGIN + '/api/health')).json();
      tickNow = Math.max(tickNow, (hh.world && hh.world.tickMs) || 0);
      await sleep(50);
    }
    ok(tickNow < 33, '当场采样的 tick 耗时正常（' + tickNow.toFixed(2) + 'ms < 33ms）');

    /* ⑤ ★ 真点一次「登出」（第 32 轮）—— 放在最后，用乙来做（甲还要留着截图 ✓）
       要验：登录浮层弹出来 + 断开 + token 清掉 + 账号块变成"登录/注册" ✓ */
    await B.eval('if (typeof openSet === "function") { openSet(); setTab("about"); } return 1;');
    await sleep(300);
    const beforeOut = JSON.parse(await B.eval(
      'return JSON.stringify({ tok: (function(){ try { return !!localStorage.getItem("token"); }' +
      ' catch(e){ return false; } })(),' +
      ' btns: document.querySelectorAll("#rowAcct .opt").length,' +
      ' txt: document.getElementById("rowAcct").textContent });'
    ) || '{}');
    await B.eval('var bs = document.querySelectorAll("#rowAcct .opt"); bs[bs.length - 1].click(); return 1;');
    await sleep(700);
    const afterOut = JSON.parse(await B.eval(
      'var lg = document.getElementById("login");' +
      'return JSON.stringify({ tok: (function(){ try { return !!localStorage.getItem("token"); }' +
      ' catch(e){ return false; } })(),' +
      ' on: WSC.on, panel: (document.getElementById("setPanel").style.display !== "none"),' +
      ' loginShown: !!(lg && lg.className.indexOf("show") >= 0),' +
      ' txt: document.getElementById("rowAcct").textContent });'
    ) || '{}');
    console.log('        [登出] 点之前 token=' + beforeOut.tok + ' "' +
      String(beforeOut.txt).slice(0, 24) + '" → 点之后 token=' + afterOut.tok +
      ' 联机=' + afterOut.on + ' 登录浮层=' + afterOut.loginShown + ' "' +
      String(afterOut.txt).slice(0, 24) + '"');
    ok(afterOut.tok === false, '★ 登出后本地 token 被清掉了（点之前是 ' + beforeOut.tok + '）');
    ok(afterOut.on === false, '★ 登出后和服务器断开了（WSC.on = ' + afterOut.on + '）');
    ok(afterOut.loginShown === true, '★ 登出后登录浮层弹出来了');
    ok(afterOut.panel === false, '登出时顺手把设置面板关了（不然会压在登录浮层底下）');

    /* ★ 再打开一次设置 → 账号块必须已经变成"未登录 / 登录 / 注册"
       （★ 这里别用 /登录|注册/ 去匹配 —— "已登录"里也有"登录"，会假过 ✗）*/
    await B.eval('openSet(); setTab("about"); return 1;');
    await sleep(350);
    const acctAfter = await B.eval('return document.getElementById("rowAcct").textContent;');
    console.log('        [登出后重开设置] 账号块 = "' + acctAfter + '"');
    ok(acctAfter.indexOf('未登录') >= 0, '★ 重开设置后账号块显示「未登录」');
    ok(acctAfter.indexOf('登录 / 注册') >= 0, '★ 账号块变回「登录 / 注册」按钮');
    ok(acctAfter.indexOf('已登录') < 0, '账号块不再显示「已登录」');

    // ⑤ 可选：存一张截图（设环境变量 SHOT=文件路径）—— 留个"画面真的出来了"的证据
    if (process.env.SHOT) {
      const shot = await A.send('Page.captureScreenshot', { format: 'png' });
      if (shot && shot.result && shot.result.data) {
        fs.writeFileSync(process.env.SHOT, Buffer.from(shot.result.data, 'base64'));
        console.log('  INFO  截图已存到 ' + process.env.SHOT);
      } else {
        console.log('  INFO  截图失败（拿不到画面）');
      }
    }

    /* ⑥ ★ 攻击必须"只打正前方"（第 34 轮，用户反馈）
       —— 在真浏览器里真砍一刀验证，不只是测那个几何函数 ✓
       做法：让甲切成单机（本地怪字段才齐全），刷两只怪摆到正前/正后 → 砍一刀 → 看血
       ★ 放在最后：切断联机不影响前面任何断言 ✓（也放在截图之后，免得截图里"未联机"）*/
    await A.eval('if (typeof netGoOffline === "function") { netGoOffline(); } return 1;');
    await sleep(450);
    const SWING_SETUP =
      // ★ 第 41 轮补：先确保【活着】—— 死了的话 frame() 会强制 atkHeld = false ✗
      //   于是挥不出刀，这条断言就假红（僵尸正好在测试期间把甲咬死了 ✗）
      'if (typeof dead !== "undefined" && dead && typeof playerRevive === "function") { playerRevive(); }' +
      'if (mobs.length < 2) { return "no-mob"; }' +
      // 用【刚刷出来的最后两只】（别去动老怪的下标 ✓ 也别清空数组，会留下孤儿 UI ✗）
      'var f = mobs[mobs.length - 2], b = mobs[mobs.length - 1];' +
      'P.x = 2000; P.z = 2000; P.yaw = 0;' +            // 朝向 +z
      'f.g.position.x = P.x; f.g.position.z = P.z + 1.6; f.hp = 9999;' +
      'b.g.position.x = P.x; b.g.position.z = P.z - 1.6; b.hp = 9999;' +
      'atkCd = 0; atkT = -1; atkHeld = true;' +          // 下一帧就挥
      'return "ok";';
    /* ★ 为什么要重试：僵尸 AI 每帧都在动，偶尔会在挥刀那一帧把它挪出扇形（1.6 米很近，
       横向挪半米就出界了）→ 这条断言就成了"看运气"✗
       所以最多试 3 次，每次都把位置和血量重新摆好 ✓ */
    let swingOk = 'no-mob';
    let hpA = { f: 9999, b: 9999 };
    for (let att = 0; att < 3; att++) {
      if (att === 0) {
        swingOk = await A.eval('spawnStress(2);' + SWING_SETUP);
      } else {
        swingOk = await A.eval('atkCd = 0; atkT = -1; return "ok";');   // 不重刷，只重挥
      }
      await sleep(170);
      await A.eval('atkHeld = false; return 1;');
      hpA = JSON.parse(await A.eval(
        'var n = mobs.length;' +
        'return JSON.stringify({ f: n >= 2 ? mobs[n - 2].hp : -1, b: n >= 2 ? mobs[n - 1].hp : -1 });'
      ) || '{}');
      if (swingOk !== 'ok' || hpA.f < 9999) { break; }
      await A.eval(SWING_SETUP);            // 重摆位置 + 回满血，再来一次
      await sleep(60);
    }
    const dbg = JSON.parse(await A.eval(
      'var n = mobs.length;' +
      'var f = n >= 2 ? mobs[n - 2] : null;' +
      'return JSON.stringify({ n: n, netOn: NET.on, dead: dead, atkT: atkT,' +
      ' atkCd: atkCd, px: P.x, pz: P.z, yaw: P.yaw,' +
      ' fx: f ? Math.round(f.g.position.x * 100) / 100 : -1,' +
      ' fz: f ? Math.round(f.g.position.z * 100) / 100 : -1,' +
      ' inArc: f ? inAtkArc(f.g.position.x, f.g.position.z) : "n/a",' +
      ' rm: Object.keys(NET.rmobs).length });'
    ) || '{}');
    console.log('        [攻击朝向·诊断] ' + JSON.stringify(dbg));
    console.log('        [攻击朝向] 正前方僵尸 hp=' + hpA.f + ' · 正背后僵尸 hp=' + hpA.b +
      '（都给到 9999，只该掉前面那只）');
    ok(swingOk === 'ok', '单机下能刷怪做朝向验证');
    ok(hpA.f < 9999, '★★ 正前方的僵尸被打到了（hp 9999 → ' + hpA.f + '）');
    ok(hpA.b === 9999, '★★ 正背后的僵尸【没】被打到（用户要的就是这个：不能背对着打）');

  } finally {
    A.kill(); B.kill();
  }

  console.log('');
  console.log(fails ? ('FAILED: ' + fails) : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.error('测试崩了:', e); process.exit(1); });
