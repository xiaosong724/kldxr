// round409 冒烟：用户那 8 条里的客户端部分（①②④⑤⑦⑧）
//   每条都量真实运行时数值（DOM / 状态 / 位移），不看代码猜
//   跑法：先起服务，再 node tools/smoke_409.js
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'];
const B = process.env.CHROME || CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PW = 'abc123456';
const OUT = [];
function ck(cond, msg, got) {
  OUT.push(!!cond);
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg +
    (cond ? '' : '   got=' + JSON.stringify(got)));
}

(async () => {
  const h = await fetch(ORIGIN + '/api/health').then(x => x.json()).catch(() => null);
  if (!h || !h.ok) { console.error('服务没起'); process.exit(1); }
  const SFX = Math.random().toString(36).slice(2, 5);
  const NM = '测试R4' + SFX;
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: PW }),
  }).then(x => x.json());
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' }),
  }).then(x => x.json());

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx2d-409-'));
  const port = 9800 + Math.floor(Math.random() * 60);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=520,900', ORIGIN + '/'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 100 && !target; i++) {
    await sleep(250);
    try {
      const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      target = l.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) { }
  }
  if (!target) { console.error('连不上浏览器'); process.exit(1); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const wait = {}; const errs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params && m.params.exceptionDetails;
      errs.push(String((d && d.exception && d.exception.description) || (d && d.text) || '?'));
    }
  };
  const send = (m, p) => new Promise(res => {
    const i = ++id; wait[i] = res;
    ws.send(JSON.stringify({ id: i, method: m, params: p || {} }));
    setTimeout(() => { if (wait[i]) { delete wait[i]; res(null); } }, 25000);
  });
  const evRaw = async (x, awaitP) => {
    const r = await send('Runtime.evaluate', {
      expression: '(function(){' + x + '})()',
      returnByValue: true, awaitPromise: !!awaitP,
    });
    if (r && r.result && r.result.exceptionDetails) {
      /* ★ 把真正的错误也带出来 ✗ 只报 "Uncaught" 根本查不到 ✓ */
      const ed = r.result.exceptionDetails;
      const desc = (ed.exception && (ed.exception.description || ed.exception.value)) || ed.text || '?';
      return '__THROW__ ' + String(desc).split(String.fromCharCode(10))[0];
    }
    return r && r.result && r.result.result ? r.result.result.value : undefined;
  };
  const ev = x => evRaw(x, false);
  await send('Runtime.enable', {});
  await sleep(1500);
  await ev('localStorage.setItem("token",' + JSON.stringify(reg.token) + '); location.reload(); return 1;');
  await sleep(8000);

  console.log('  状态: ' + await ev('return JSON.stringify({ ready: WSC.ready,'
    + ' cfg: WSC.cfg || null });'));

  /* ---------- ① 跳跃按钮图标 ---------- */
  const icon = await ev([
    'var s = document.querySelector("#jmp svg");',
    'if (!s) { return "no svg"; }',
    'var poly = s.querySelectorAll("polyline").length;',
    'var paths = s.querySelectorAll("path").length;',
    'return JSON.stringify({ poly: poly, paths: paths,',
    '  d: Array.prototype.map.call(s.querySelectorAll("polyline"), function (p) {',
    '    return p.getAttribute("points"); }) });',
  ].join(''));
  console.log('  ① 跳跃图标: ' + icon);
  let ic = {};
  try { ic = JSON.parse(icon); } catch (e) { ic = {}; }
  ck(ic.poly >= 2, '★★ 跳跃图标换成双层箭头（polyline ≥ 2 条 ✓ 原来只有 1 条单箭头）', icon);

  /* ---------- ② 摔伤音效 ---------- */
  const snd = await ev([
    'var log = [];',
    'var _old = sfx;',
    'sfx = function (n, v) { log.push(n); };',
    'HP = 9999; HPMAX = 9999;',
    'hurtPlayer(5, P.x, P.z, "mob", "", "fall");',
    'var fall = log.slice();',
    'log.length = 0;',
    'hurtPlayer(5, P.x, P.z, "mob", "", "");',
    'var normal = log.slice();',
    'sfx = _old;',
    'return JSON.stringify({ fall: fall, normal: normal });',
  ].join(''));
  console.log('  ② 音效: ' + snd);
  let sd = {};
  try { sd = JSON.parse(snd); } catch (e) { sd = {}; }
  ck((sd.fall || []).indexOf('strong') >= 0,
    '★★ 摔伤用的是 strong（重物闷响）✗ 不再是僵尸的 zhurt', sd.fall);
  ck((sd.normal || []).indexOf('zhurt') >= 0,
    '★ 普通挨打还是 zhurt（被僵尸咬没变 ✓）', sd.normal);

  /* ---------- ④ 整页勾选 + ⑤ 坏武器能卖系统 ---------- */
  const bag = await ev([
    'if ((SETCFG.setTab || "") !== "bag") { if (typeof openSet === "function") { openSet("bag"); } }',
    'BAG.items = []; BAG.pick = []; BAG.multi = false; BAG.sel = null;',
    'BAG.weaponItemId = null; BAG.armorItemId = null;',
    'for (var i = 1; i <= 40; i++) {',
    '  BAG.items.push({ id: 1000 + i, stack: 1,',
    '    item: { name: "测试物品" + i, slot: "material", kind: "material", tier: 0 } });',
    '}',
    'BAG.items[0].item = { name: "坏掉的重玄斧", slot: "weapon", look: "axe",',
    '  tier: 11, itemLv: 40, broken: true, dur: 0, durMax: 28000 };',
    'BAG_PAGE = 0;',
    'bagRender();',
    'var btn = document.getElementById("bagPickPage");',
    'var has = !!btn;',
    'if (btn) { btn.onclick(); }',
    'var n1 = (BAG.pick || []).length;',
    'if (btn) { btn.onclick(); }',
    'var n2 = (BAG.pick || []).length;',
    // 坏武器：选中它 → 卖系统亮 / 挂交易所灰
    'BAG.multi = false; BAG.pick = []; BAG.sel = 1001; bagRender();',
    'var sellBtn = document.getElementById("bagSell");',
    'var mktBtn = document.getElementById("bagMkt");',
    'return JSON.stringify({ hasBtn: has, picked: n1, cleared: n2,',
    '  pageSize: BAG_PAGE_SIZE, total: BAG.items.length,',
    '  sellDisabled: sellBtn ? !!sellBtn.disabled : null,',
    '  mktDisabled: mktBtn ? !!mktBtn.disabled : null });',
  ].join(''));
  console.log('  ④⑤ 背包: ' + bag);
  let bg = {};
  try { bg = JSON.parse(bag); } catch (e) { bg = {}; }
  ck(bg.hasBtn, '★ 背包里有「整页勾选」按钮', bg);
  ck(bg.picked === 35, '★★ 点一下 = 勾中当前这一页 35 格（实测 ' + bg.picked + ' 件）', bg.picked);
  ck(bg.cleared === 0, '★★ 再点一下 = 取消本页的勾（实测剩 ' + bg.cleared + ' 件）', bg.cleared);
  ck(bg.sellDisabled === false,
    '★★ 坏掉的武器【能】卖给系统（修之前这个按钮是灰的 ✓）', bg.sellDisabled);
  ck(bg.mktDisabled === true,
    '★★ 坏掉的武器【不能】挂交易所（只能卖系统 ✓）', bg.mktDisabled);

  /* ★ round411：上锁按钮、滚动通知完整（★ 上锁那部分已经搬到
     下面的「浮窗上锁」那一段了 ✗ 这里只留滚动通知 ✓） */
  const tick = await ev([
    'var S = "A 夺取了 很长很长的名字 的 12345 点经验、【十二阶重玄双手斧】和【三词条全满的精铁重铠】";',
    'wsOnMessage(JSON.stringify({ t: "ticker", d: { text: S, kind: "mq" } }));',
    'var row = document.querySelector("#ticker .tkrow");',
    'var tk = row ? row.querySelector(".tk") : null;',
    'return JSON.stringify({ same: tk ? (tk.textContent === S) : false,',
    '  textLen: tk ? tk.textContent.length : 0, wantLen: S.length,',
    '  tkW: tk ? Math.round(tk.offsetWidth) : null, win: window.innerWidth });',
  ].join(''));
  console.log('  ⑩ 弹幕: ' + tick);
  let tkj = {};
  try { tkj = JSON.parse(tick); } catch (e) { tkj = {}; }
  ck(tkj.same && tkj.textLen === tkj.wantLen,
    '★★ 滚动条里的文字是【完整的】' + tkj.textLen + '/' + tkj.wantLen + ' 字 ✓',
    tkj);
  ck(tkj.tkW > tkj.win, '★ 而且它比屏幕宽（说明真的会滚进来，不是被截断 ✓）',
    [tkj.tkW, tkj.win]);

  /* ---------- round411：上锁按钮看得见 + 法力没了 + 属性总览 ---------- */
  const fix = await ev([
    'BAG.items = [{ id: 3001, stack: 1, item: { name: "锁住的剑", slot: "weapon",',
    '    look: "sword", tier: 3, locked: 1 } },',
    '  { id: 3002, stack: 1, item: { name: "普通的剑", slot: "weapon", look: "sword", tier: 3 } }];',
    'BAG.pick = []; BAG.multi = false; BAG_PAGE = 0; BAG.sel = 3002;',
    'bagRender();',
    'bagTipShowAt(60, 120, bagTipHTML(BAG.items[1].item, 3002, "bag"));',
    'var box = document.getElementById("bagTipBox");',
    'var lb = box ? box.querySelector("[data-tipact=lock]") : null;',
    'var r = lb ? lb.getBoundingClientRect() : null;',
    'var vis = !!(lb && r && r.width > 8 && r.height > 8 &&',
    '  getComputedStyle(box).display !== "none" &&',
    '  r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight);',
    'var txt = lb ? lb.textContent : null;',
    'bagTipShowAt(60, 120, bagTipHTML(BAG.items[0].item, 3001, "bag"));',
    'var box2 = document.getElementById("bagTipBox");',
    'var lb2 = box2 ? box2.querySelector("[data-tipact=lock]") : null;',
    'var txt2 = lb2 ? lb2.textContent : null;',
    'var lockedNote = box2 ? (box2.textContent.indexOf("\u5df2\u9501\u4f4f") >= 0) : false;',
    'var sent = []; var _ow = wsSend; wsSend = function (t, d) { sent.push([t, d]); return true; };',
    'bagTipShowAt(60, 120, bagTipHTML(BAG.items[1].item, 3002, "bag"));',
    'var lb3 = document.querySelector("#bagTipBox [data-tipact=lock]");',
    'if (lb3) { lb3.click(); }',
    'wsSend = _ow;',
    'return JSON.stringify({ hasBtn: !!lb, visible: vis, txt: txt, txtLocked: txt2,',
    '  lockedNote: lockedNote, sent: sent,',
    '  rect: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null });',
  ].join(''));
  console.log('  ⑪ 浮窗上锁: ' + fix);
  let fx = {};
  try { fx = JSON.parse(fix); } catch (e) { fx = {}; }
  ck(fx.hasBtn === true, '★★ 格子浮窗里有「上 锁」按钮（修之前它在藏起来的那一排 ✓）', fx);
  ck(fx.visible === true, '★★ 而且它真的【看得见】（在屏幕内、有实体尺寸 ✓）', fx);
  ck(fx.txt === '上 锁', '★ 未上锁时写「上 锁」✓', fx.txt);
  ck(fx.txtLocked === '解 锁', '★★ 锁住时写「解 锁」（不然锁上就解不开了 ✓）', fx.txtLocked);
  ck(fx.lockedNote === true, '★ 浮窗里写明"已锁住……"✓', fx.lockedNote);
  ck((fx.sent || []).length === 1 && fx.sent[0][0] === 'baglock',
    '★★ 点它真的发 baglock 意图 ✓', fx.sent);

  const tal = await ev([
    'if (typeof openSet === "function") { openSet("talent"); }',
    'talRender();',
    'var el = document.getElementById("talList");',
    'var body = el ? el.textContent : "";',
    'var hasMana = body.indexOf("\u6cd5\u529b") >= 0;',
    'var rows = el ? el.querySelectorAll(".ptLine").length : -1;',
    'if (typeof openSet === "function") { openSet("stat"); }',
    'statRender();',
    'var all = document.body.textContent || "";',
    /* round465: stat page rebuilt (only the stat sheet, one row per attribute)
       -> check the real attribute rows instead of the old section title */
    'var hasSheet = (all.indexOf("\u751f\u547d\u4e0a\u9650") >= 0) && (all.indexOf("\u5438\u8840") >= 0);',
    'var hasCrit = all.indexOf("\u66b4\u51fb\u7387") >= 0;',
    'var hasCap = all.indexOf("\u4e0a\u9650") >= 0;',
    'var stats = (TAL.stats || []).length;',
    'var sample = (TAL.stats || []).map(function (r) { return r.n + "=" + r.v; }).join(" ");',
    'return JSON.stringify({ hasMana: hasMana, rows: rows, hasSheet: hasSheet,',
    '  hasCrit: hasCrit, hasCap: hasCap, stats: stats, sample: sample });',
  ].join(''));
  console.log('  ⑪ 天赋面板: ' + tal);
  let tj = {};
  try { tj = JSON.parse(tal); } catch (e) { tj = {}; }
  ck(tj.hasMana === false, '★★ 天赋面板里【没有】法力了（用户："不要法力值了"）', tj.hasMana);
  ck(tj.rows === 12, '★ 天赋行数 = 12（round473 加了抗爆 ✓）', tj.rows);
  ck(tj.stats >= 11, '★★ 服务器把属性总览发过来了（' + tj.stats + ' 项）', tj.stats);
  ck(tj.hasSheet && tj.hasCrit && tj.hasCap,
    '★★ 属性界面里画出了【属性总览 / 暴击率 / 上限】', tj);
  console.log('       样例: ' + tj.sample);

  /* ---------- round412：上锁后图标【立刻】出现（不许等刷新） ---------- */
  const imm = await ev([
    'BAG.items = [{ id: 4001, stack: 1, item: { name: "立刻上锁的剑", slot: "weapon",',
    '    look: "sword", tier: 3 } }];',
    'BAG.multi = false; BAG_PAGE = 0; bagRender();',
    'var hadBefore = !!document.querySelector("#bagGrid [data-id=\'4001\'] .lk");',
    'var fetchN = 0; var _obf = bagFetch;',
    'bagFetch = function (cb) { fetchN++; if (cb) { cb(); } };',
    'var t0 = performance.now();',
    'wsOnMessage(JSON.stringify({ t: "baglockok", d: { iid: 4001, lock: 1, name: "立刻上锁的剑" } }));',
    'var el = document.querySelector("#bagGrid [data-id=\'4001\'] .lk");',
    'bagFetch = _obf;',
    'return JSON.stringify({ hadBefore: hadBefore, hasNow: !!el,',
    '  fetchCalls: fetchN, ms: Math.round(performance.now() - t0),',
    '  clientLocked: !!(BAG.items[0].item || {}).locked,',
    '  msg: BAG.msg });',
  ].join(''));
  console.log('  ⑫ 立刻上锁: ' + imm);
  let im = {};
  try { im = JSON.parse(imm); } catch (e) { im = {}; }
  ck(im.hadBefore === false && im.hasNow === true,
    '★★ 收到上锁回执【当场】就出现 🔒（不用刷新 ✓）', im);
  ck(im.fetchCalls === 0,
    '★★ 而且【没有】去重拉背包（拉回来的会是落库前的旧数据 ✗ 那正是"要刷新才看到"的病根 ✓）',
    im.fetchCalls);
  ck(im.clientLocked === true, '★ 本地 BAG.items 也标成 locked 了 ✓', im.clientLocked);

  /* ---------- round412：批量出售要跳过锁住的（不再 400） ---------- */
  const batch = await evRaw([   // ★ 这段返回 Promise ✗ 必须用 evRaw(...,true) ✓
    'BAG.items = [{ id: 6001, stack: 1, item: { name: "锁住的", slot: "material" } },',
    '  { id: 6002, stack: 1, item: { name: "能卖的", slot: "material" } }];',
    'BAG.items[0].item.locked = 1;',
    'BAG.multi = true; BAG.pick = ["6001", "6002"];',
    'var calls = []; var _of = window.fetch;',
    'window.fetch = function (u, o) { if (String(u).indexOf("/api/sell") >= 0) { calls.push(o && o.body); return Promise.resolve({ json: function () { return Promise.resolve({ ok: true, sold: ["6002"], total: 5 }); } }); } return _of.apply(window, arguments); };',
    'var toasts = []; var _ot = window.toast; toast = function (m) { toasts.push(m); };',
    'sellItems(BAG.pick.slice(), true);',
    'return new Promise(function (res) { setTimeout(function () {',
    '  window.fetch = _of; toast = _ot;',
    '  res(JSON.stringify({ calls: calls, toasts: toasts }));',
    '}, 300); });',
  ].join(''), true);
  console.log('  ⑬ 批量跳过锁住: ' + batch);
  let bt = {};
  try { bt = JSON.parse(batch); } catch (e) { bt = {}; }
  ck((bt.calls || []).length === 1 && bt.calls[0].indexOf('6002') >= 0 &&
     bt.calls[0].indexOf('6001') < 0,
     '★★ 批量出售只把【没锁的】发出去（锁住的那件被摘掉了 ✓）', bt.calls);
  ck((bt.toasts || []).some(function (m) { return m.indexOf('锁') >= 0; }),
     '★ 并且提示"跳过 N 件锁住的"（不再只显示一句看不懂的报错 ✓）', bt.toasts);

  const allLocked = await ev([
    'BAG.items = [{ id: 6101, stack: 1, item: { name: "全锁", slot: "material", locked: 1 } }];',
    'BAG.multi = true; BAG.pick = ["6101"];',
    'var n = 0; var _of2 = window.fetch;',
    'window.fetch = function () { n++; return _of2.apply(window, arguments); };',
    'var ts = []; var _ot2 = window.toast; toast = function (m) { ts.push(m); };',
    'sellItems(BAG.pick.slice(), true);',
    'window.fetch = _of2; toast = _ot2;',
    'return JSON.stringify({ fetchN: n, toasts: ts });',
  ].join(''));
  console.log('  ⑬ 全锁住: ' + allLocked);
  let al = {};
  try { al = JSON.parse(allLocked); } catch (e) { al = {}; }
  ck(al.fetchN === 0, '★★ 勾的全是锁住的时候【一条请求都不发】（所以不会再有 400 ✓）',
     al.fetchN);
  ck((al.toasts || []).some(function (m) { return m.indexOf('锁') >= 0; }),
     '★ 并且明确提示锁住 ✓', al.toasts);

  /* ---------- round413：自动战斗新图标 + 提示文案换成"键位" ---------- */
  const ic2 = await ev([
    'var txt = document.querySelector("#auto .aitxt");',
    'var atxt = txt ? txt.textContent : "";',
    'var svgN = document.querySelectorAll("#auto svg").length;',
    'var fs = txt ? getComputedStyle(txt).fontSize : "";',
    'var hud = (document.getElementById("hud") || {}).textContent || "";',
    'var b = document.getElementById("uiEdit");',
    'var t0 = b ? b.textContent : "";',
    'uiEditToggle(); var t1 = b ? b.textContent : "";',
    'uiEditToggle(); var t2 = b ? b.textContent : "";',
    'return JSON.stringify({',
    '  atxt: atxt, svgN: svgN, fontSize: fs,',
    '  hudNoLongPress: hud.indexOf("长按") < 0,',
    '  hudHasKey: hud.indexOf("键位") >= 0, hud: hud, btn: [t0, t1, t2] });',
  ].join(''));
  console.log('  ⑭ 自动图标/提示: ' + ic2);
  let icj2 = {};
  try { icj2 = JSON.parse(ic2); } catch (e) { icj2 = {}; }
  ck(icj2.atxt === '挂机' && icj2.svgN === 0,
    '★★ 自动战斗按钮是【文字「挂机」】（一个图标都没了 ✓）', icj2);
  ck(/px$/.test(icj2.fontSize || '') && parseFloat(icj2.fontSize) >= 12,
    '★ 字号跟着按钮走（实测 ' + icj2.fontSize + ' ✓）', icj2.fontSize);
  ck(icj2.hudNoLongPress === true, '★★ HUD 上不再提"长按攻击键 3 秒"✓', icj2.hud);
  ck(icj2.hudHasKey === true, '★★ 换成「点【键位】可以移动按钮」✓', icj2.hud);
  ck(icj2.btn && icj2.btn[0] === '键位' && icj2.btn[1] === '保存' && icj2.btn[2] === '键位',
    '★ 键位按钮还是「键位 → 保存 → 键位」两段式（拖动功能没坏 ✓）', icj2.btn);

  /* ---------- round420：自动战斗拿弓要打远程 ---------- */
  const bow = await ev([
    'P.x = 60; P.z = 60; P.y = terYAt(60, 60); P.gy = P.y; P.air = false; dead = false;',
    'AUTO.on = true; AUTO.pauseUntil = 0; AUTO.lootOn = false; AUTO.faceLock = false;',
    'AUTO.setInput = false; keys["w"] = false; keys["a"] = false; keys["s"] = false; keys["d"] = false;',
    'MY_WEAPON = { look: "bow", tier: 0, base: { reach: 14, arc: 0 } };',
    'NET.rmobs["T1"] = { cur: { x: 60, z: 60 }, hp: 500, alive: true, dying: -1, lv: 5, atkT: 0 };',
    'AUTO.tgt = "T1"; AUTO.phase = "find"; AUTO.t = 0;',
    'function runAt(dz) {',
    '  NET.rmobs["T1"].cur.x = 60; NET.rmobs["T1"].cur.z = 60 + dz;',
    '  NET.rmobs["T1"].hp = 500;',
    '  AUTO.tgt = "T1"; AUTO.t = 0; jx = 0; jy = 0; atkHeld = false;',
    '  autoTick(0.016);',
    '  return { info: AUTO.info, phase: AUTO.phase, jx: jx, jy: jy, atk: atkHeld };',
    '}',
    'var far = runAt(20);',
    'var mid = runAt(8);',
    'var near = runAt(2);',
    // 换回近战，确认老逻辑没被带坏
    'MY_WEAPON = { look: "sword", tier: 0, base: { reach: 2.4, arc: 1.05 } };',
    'AUTO.phase = "find";',
    'var meleeFar = runAt(8);',
    'var meleeNear = (function () {',
    '  NET.rmobs["T1"].cur.x = 60; NET.rmobs["T1"].cur.z = 61.5;',
    '  AUTO.tgt = "T1"; AUTO.t = 0; jx = 0; jy = 0; atkHeld = false;',
    '  autoTick(0.016);',
    '  return { info: AUTO.info, atk: atkHeld, jy: jy };',
    '})();',
    'delete NET.rmobs["T1"];',
    'AUTO.on = false; AUTO.tgt = ""; jx = 0; jy = 0; atkHeld = false;',
    'return JSON.stringify({ far: far, mid: mid, near: near,',
    '  meleeFar: meleeFar, meleeNear: meleeNear });',
  ].join(''));

  console.log('  ⑮ 弓的自动战斗: ' + bow);
  let bw = {};
  try { bw = JSON.parse(bow); } catch (e) { bw = {}; }
  ck(bw.far && bw.far.jy > 0.5 && bw.far.atk === false,
    '★★ 20 米外：先走过去（不放箭）—— 修之前会一路冲到 1.87 米 ✓', bw.far);
  ck(bw.mid && Math.abs(bw.mid.jy) < 0.2 && bw.mid.atk === true,
    '★★ 8 米：站住放箭（弓的射程内 ✓）', bw.mid);
  ck(bw.near && bw.near.jy < -0.5 && bw.near.atk === true,
    '★★ 2 米：边后退边放箭（不站着挨咬 ✓）', bw.near);
  ck(bw.meleeFar && bw.meleeFar.jy > 0.5,
    '★ 换成近战武器：8 米外还是照旧冲过去（老逻辑没坏 ✓）', bw.meleeFar);
  ck(bw.meleeNear && bw.meleeNear.atk === true,
    '★ 近战贴脸：照旧开打 ✓', bw.meleeNear);

  /* ---------- round422：画面放大（只放大 3D 画面，UI 不动） ---------- */
  const zom = await ev([
    'var before = (function () {',
    '  var a = document.getElementById("atk").getBoundingClientRect();',
    '  return { fov: Math.round(cam.fov * 10) / 10, atkW: Math.round(a.width),',
    '           atkX: Math.round(a.left), zoom: setWorldZoom() };',
    '})();',
    'openSet("view");',
    /* ★ round531：档位按钮改成滑条（60~300）✗ 这里改成拖滑条 ✓ */
    'var zr = document.getElementById("zoomRange");',
    'var labels = zr ? [zr.min + "~" + zr.max] : [];',
    'if (zr) { zr.value = "150"; zr.dispatchEvent(new Event("input", { bubbles: true })); }',
    'closeSet();',
    'var after = (function () {',
    '  var a = document.getElementById("atk").getBoundingClientRect();',
    '  var sv = null; try { sv = JSON.parse(localStorage.getItem("xx3d_set") || "{}").zoom; } catch (e) { }',
    '  return { fov: Math.round(cam.fov * 10) / 10, atkW: Math.round(a.width),',
    '           atkX: Math.round(a.left), zoom: setWorldZoom(), saved: sv };',
    '})();',
    '/* 恢复 100%，免得影响后面的测试 */',
    'SETCFG.zoom = 100; applySet(); saveSet();',
    'return JSON.stringify({ before: before, after: after, labels: labels,',
    '  restored: Math.round(cam.fov * 10) / 10 });',
  ].join(''));

  console.log('  ⑯ 画面放大: ' + zom);
  let zm = {};
  try { zm = JSON.parse(zom); } catch (e) { zm = {}; }
  ck((zm.labels || []).join('|').indexOf('60~300') >= 0,
     '★★ 设置里是滑条（' + (zm.labels || []).join(' / ') + '）', zm.labels);
  ck(zm.after && zm.after.fov < zm.before.fov - 5,
     '★★ 选 150% 后相机视野变窄 = 画面放大（fov ' + (zm.before || {}).fov +
     ' → ' + (zm.after || {}).fov + '）', zm);
  ck(zm.after && zm.after.atkW === zm.before.atkW && zm.after.atkX === zm.before.atkX,
     '★★ 而按钮【一个像素都没变】（' + (zm.before || {}).atkW + 'px → ' +
     (zm.after || {}).atkW + 'px）', zm);
  ck(zm.after && zm.after.saved === 150,
     '★★ 选择会存住（localStorage 里 zoom=150 ✓）', zm.after && zm.after.saved);
  ck(zm.restored === (zm.before || {}).fov,
     '★ 选回 100% 就回到原来的视野（' + zm.restored + ' ✓）', zm.restored);

  /* ★ round423（用户："加一个档位还可以缩小到 80%"）*/
  const zom80 = await ev([
    'openSet("view");',
    'var zr2 = document.getElementById("zoomRange");',
    'if (zr2) { zr2.value = "60"; zr2.dispatchEvent(new Event("input", { bubbles: true })); }',
    'closeSet();',
    'var a = document.getElementById("atk").getBoundingClientRect();',
    'var r = { zoom: setWorldZoom(), fov: Math.round(cam.fov * 10) / 10, atkW: Math.round(a.width) };',
    'SETCFG.zoom = 100; applySet(); saveSet();',
    'return JSON.stringify(r);',
  ].join(''));
  console.log('  ⑯ 80% 档: ' + zom80);
  let z8 = {};
  try { z8 = JSON.parse(zom80); } catch (e) { z8 = {}; }
  ck(z8.zoom === 60 && z8.fov > 52,
     '★★ 滑条拉到 60% 能用（视野变宽 52 → ' + z8.fov + '，看得更远 ✓）', z8);
  ck(z8.atkW === 84, '★ 60% 时按钮也没变（' + z8.atkW + 'px ✓）', z8.atkW);

  /* ★★ round423（用户："掉落物在方块山上被遮挡了"）
     → 在【真正高的地方】放一个掉落物 ✗ 看它的 y 是不是跟着地形走 ✓ */
  const lootY = await ev([
    'var best = null, bestY = -1;',
    'for (var gx = -40; gx <= 40; gx += 2) {',
    '  for (var gz = -40; gz <= 40; gz += 2) {',
    '    var yy = terYAt(gx, gz);',
    '    if (yy > bestY) { bestY = yy; best = [gx, gz]; }',
    '  }',
    '}',
    'addWorldLoot(["zz_probe", best[0], best[1], "测试掉落", 5, "sword", "weapon"]);',
    'updateLoot(0.016);',
    'var e = NET.rloot["zz_probe"];',
    'var out = { terrainY: Math.round(bestY * 100) / 100,',
    '  lootY: e ? Math.round(e.g.position.y * 100) / 100 : null,',
    '  at: best };',
    'removeWorldLoot("zz_probe");',
    'return JSON.stringify(out);',
  ].join(''));
  console.log('  ⑯ 山上掉落物高度: ' + lootY);
  let ly = {};
  try { ly = JSON.parse(lootY); } catch (e) { ly = {}; }
  ck(ly.lootY !== null && ly.lootY > ly.terrainY + 0.2,
     '★★ 山上的掉落物在【山顶上方】（地形 ' + ly.terrainY +
     ' → 掉落物 ' + ly.lootY + '），修之前写死 0.5 → 埋在山里 ✗', ly);
  ck(ly.lootY !== null && Math.abs(ly.lootY - (ly.terrainY + 0.45)) < 0.15,
     '★ 掉落物高度 = 地形高度 + 0.45（差 ' +
     (ly.lootY !== null ? (Math.round((ly.lootY - ly.terrainY) * 100) / 100) : '?') + ' ✓）', ly);

  /* ---------- ⑦ 百科里的冷却文案 ---------- */
  const wiki = await ev([
    'var line = mqCdLine();',
    'var cfg = WSC.cfg || {};',
    'return JSON.stringify({ line: line, stealCd: cfg.stealCd, pairCd: cfg.pairCd,',
    '  stealTxt: cdHuman(cfg.stealCd), pairTxt: cdHuman(cfg.pairCd) });',
  ].join(''));
  console.log('  ⑦ 百科冷却: ' + wiki);
  let wk = {};
  try { wk = JSON.parse(wiki); } catch (e) { wk = {}; }
  ck(!!wk.stealCd && wk.line.indexOf(wk.stealTxt) >= 0 && wk.line.indexOf(wk.pairTxt) >= 0,
    '★★ 百科里的冷却显示的是服务器配置值（' + wk.stealTxt + ' / ' + wk.pairTxt + '）',
    wk.line);

  /* ---------- ⑧ 天赋移速真的生效 ---------- */
  const spd = await evRaw([
    'P.x = 60; P.z = 60; P.y = terYAt(60, 60); P.air = false; P.gy = P.y;',
    'var _old = TAL.eff;',
    /* ★ round492：单次测量太不稳（地形/僵尸挡路会让 base 从 1.78 掉到 0.12 ✗）
       → 一次跑 3 遍取【最大值】✓ 这样"被挡住的那些次"不会把比例拉坏 ✓ */
    'function one(sp) {',
    '  TAL.eff = { speed: sp };',
    /* ★ round492：站在【安全区】量 ✗ 外面会被僵尸追着打 / 挡住 →
       测出来 base 从 1.78 掉到 0.1，比例就乱了 ✓ */
    '  P.x = 0; P.z = 0; P.y = terYAt(0, 0); P.air = false; P.gy = P.y;',
    '  try { P.hp = 99999; dead = false; INVULN_T = 60; } catch (e0) { }',
    '  MOV.vx = 0; MOV.vz = 0;',
    '  var z0 = P.z;',
    '  return new Promise(function (resolve) {',
    '    keys["w"] = true;',
    '    setTimeout(function () {',
    '      keys["w"] = false;',
    '      MOV.vx = 0; MOV.vz = 0;',
    '      resolve(Math.abs(P.z - z0));',
    '    }, 1200);',
    '  });',
    '}',
    'function run(sp) {',
    '  var best = 0;',
    '  function step(n) {',
    '    if (n <= 0) { return Promise.resolve(best); }',
    '    return one(sp).then(function (d) {',
    '      if (d > best) { best = d; }',
    '      return new Promise(function (r) { setTimeout(r, 120); }).then(function () {',
    '        return step(n - 1);',
    '      });',
    '    });',
    '  }',
    '  return step(3);',
    '}',
    'return run(0).then(function (d0) {',
    '  return run(50).then(function (d1) {',
    '    TAL.eff = _old;',
    '    MOV.vx = 0; MOV.vz = 0; keys["w"] = false;',
    '    return JSON.stringify({ base: Math.round(d0 * 100) / 100,',
    '      fast: Math.round(d1 * 100) / 100,',
    '      ratio: Math.round((d1 / Math.max(0.001, d0)) * 100) / 100 });',
    '  });',
    '});',
  ].join(''), true);
  console.log('  ⑧ 移速天赋: ' + spd);
  let sp = {};
  try { sp = JSON.parse(spd); } catch (e) { sp = {}; }
  ck(sp.ratio > 1.25, '★★ +50% 移速天赋后，同样时间内走的距离变成 ' + sp.ratio +
    ' 倍（修之前是 1.0 倍 = 完全没生效）', sp);

  console.log('  页面错误: ' + (errs.length ? errs.slice(0, 3).join(' | ') : '(无)'));
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  await sleep(1500);
  await fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at.token },
    body: JSON.stringify({ act: 'delplayer', name: NM }),
  }).catch(() => null);
  const bad = OUT.filter(x => !x).length;
  console.log(bad ? ('FAILED: ' + bad) : 'ALL PASS ✓');
  process.exit(bad ? 1 : 0);
})();
