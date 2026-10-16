// shot_mkt_panel.js -- 给交易所面板截一张图（一次性号 ✗ 截完清干净 ✓）
//
// 为什么要它：面板是纯客户端的东西 ✗ 用户光看描述不如看一张图 ✓
// 跑法：node tools/shot_mkt_panel.js      产物：docs/shots/mkt-panel.png

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ORIGIN = process.env.PAGE || 'http://127.0.0.1:8899';
const ADMIN_PW = process.env.ADMIN_PW || 'xiuxian-admin';
const PW = 'abc123456';
const CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const BROWSER = CANDIDATES.find(function (p) { try { return fs.existsSync(p); } catch (e) { return false; } });
if (!BROWSER) { console.error('no Chrome/Edge; set CHROME='); process.exit(1); }

const OUT = path.join(__dirname, '..', 'docs', 'shots');
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

function disposableName(prefix) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  let s = prefix;
  for (let i = 0; i < 5; i++) { s += A[Math.floor(Math.random() * A.length)]; }
  return s;
}
function rpc(py, args) {
  const tmp = path.join(os.tmpdir(), 'xx2d_s_' + Date.now() + '.py');
  fs.writeFileSync(tmp, py);
  const r = spawnSync('python', [tmp].concat(args || []), { cwd: path.join(__dirname, '..', 'server'), encoding: 'utf8' });
  try { fs.rmSync(tmp, { force: true }); } catch (e) { }
  return ((r.stdout || '') + (r.stderr || '')).trim();
}
function purge(name) {
  return rpc([
    'import sqlite3, sys',
    "c = sqlite3.connect('game.db', timeout=6)",
    'row = c.execute("SELECT id, account_id FROM roles WHERE name=?", (sys.argv[1],)).fetchone()',
    'if row:',
    '    rid, acc = row',
    "    c.execute(\"UPDATE listings SET state='cancelled' WHERE seller=? AND state='on'\", (rid,))",
    '    c.execute("DELETE FROM trade_log WHERE seller=? OR buyer=?", (rid, rid))',
    '    c.execute("DELETE FROM items WHERE role_id=?", (rid,))',
    '    c.execute("DELETE FROM equipment WHERE role_id=?", (rid,))',
    '    c.execute("DELETE FROM pending_gold WHERE role=?", (rid,))',
    '    c.execute("DELETE FROM roles WHERE id=?", (rid,))',
    '    if acc:',
    '        c.execute("DELETE FROM tokens WHERE account_id=?", (acc,))',
    '        c.execute("DELETE FROM accounts WHERE id=?", (acc,))',
    '    c.commit()',
    'c.execute("DELETE FROM pending_gold WHERE role NOT IN (SELECT id FROM roles)")',
    'c.commit()',
    "print('purged %s' % sys.argv[1])",
  ].join('\n'), [name]);
}

/* 两个"布景"号：一个挂几件商品（面板要看得出分类/阶数/图标不同 ✓）*/
const SHOP = disposableName('ShotS');
const VIEW = disposableName('ShotV');

(async function () {
  fs.mkdirSync(OUT, { recursive: true });
  const h = await fetch(ORIGIN + '/api/health').then(x => x.json()).catch(() => null);
  if (!h || !h.ok) { console.error('server not up'); process.exit(1); }
  purge(SHOP); purge(VIEW);
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PW }),
  }).then(x => x.json()).then(x => x.token);
  const reg = async function (n) {
    let r = await fetch(ORIGIN + '/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: n, password: PW }),
    }).then(x => x.json());
    if (!r.token) {
      r = await fetch(ORIGIN + '/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: n, password: PW }),
      }).then(x => x.json());
    }
    return r.token;
  };
  /* ★ extra 可以带 worn= ✗ 截图里就要有一件"没耐久的"给人看 ✓ */
  const give = function (n, kind, tier, extra) {
    const body = Object.assign({ act: 'give', name: n, kind: kind, tier: tier }, extra || {});
    return fetch(ORIGIN + '/api/admin/act', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at },
      body: JSON.stringify(body),
    }).then(x => x.json()).catch(() => null);
  };

  const tokShop = await reg(SHOP);
  const tokView = await reg(VIEW);
  for (const t of [7, 5, 3]) { await give(SHOP, 'sword', t); }
  for (const t of [4, 2]) { await give(SHOP, 'armor', t); }
  for (const t of [6, 1]) { await give(SHOP, 'sword', t); }
  /* ★ 再来一件【磨损到 30%】✗ 让人一眼看到"条短了、变黄了" ✓ */
  await give(SHOP, 'sword', 4, { worn: 0.28 });
  await give(VIEW, 'sword', 4);
  /* 看客要有钱（"只看买得起"才看得出效果 ✓）→ 先卖一件给系统 ✓ */
  const bagV = await fetch(ORIGIN + '/api/bag', { headers: { 'X-Token': tokView } }).then(x => x.json());
  /* ★ 卖掉换钱 ✗ 但【留一件】在背包里（截图要展示"选中之后按钮的样子"✓）*/
  const vIds = (bagV.items || []).map(x => x.id).slice(0, -1);
  if (vIds.length) {
    await fetch(ORIGIN + '/api/sell', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Token': tokView },
      body: JSON.stringify({ iids: vIds }),
    }).then(x => x.json());
  }

  /* ★ 布景：让店主【真的挂几件】✗ 不然面板是空的 ✓ */
  const shopWs = await (async function () {
    /* 只借用 HTTP：上架要 WS ✗ 所以这里用一个极简 WS 客户端 ✓ */
    const WebSocket = require('ws');
    return null;
  })().catch(() => null);
  console.log('   (listing the shop items via the server protocol)');
  const listOne = async function (tok, iid, price) {
    /* ★ 不让脚本自己实现一套 WS 握手 ✗ 直接用服务器认的 HTTP 路（/api/sell 不走这条）
       这里用 node 的原生 WebSocket（Node 22+ 自带 ✓）✓ */
    return new Promise(function (res) {
      const ws = new globalThis.WebSocket('ws://127.0.0.1:8900/ws');
      const t0 = Date.now();
      ws.onopen = function () {
        ws.send(JSON.stringify({ t: 'hello', d: { token: tok, ver: 1 } }));
      };
      ws.onmessage = function (m) {
        let o; try { o = JSON.parse(m.data); } catch (e) { return; }
        if (o.t === 'welcome') {
          setTimeout(function () {
            ws.send(JSON.stringify({ t: 'mklist', d: { iid: iid, price: price } }));
          }, 400);
        }
        if (o.t === 'listres' && (o.d || {}).refresh) {
          ws.close(); res((o.d || {}).msg || 'ok');
        }
        if (Date.now() - t0 > 12000) { try { ws.close(); } catch (e) { } res('timeout'); }
      };
      ws.onerror = function () { res('ws error'); };
    });
  };
  const bagS = await fetch(ORIGIN + '/api/bag', { headers: { 'X-Token': tokShop } }).then(x => x.json());
  let pi = 0;
  /* ★ 留一件【不挂】✗ 背包那张图要看"选中之后按钮什么样"✓
     （别再多发一件 ✗ 快照是在那之前拍的 ✓ 直接少挂一件最省事 ✓）*/
  /* ★ 留哪一件有讲究 ✗ 背包那张图要一件"能挂的"✗ 货架那张图要那件【磨损的】✓
     → 留第二新的 ✗ 把最新的（= 刚发的磨损那件）挂出去 ✓ */
  const keepOne = (bagS.items || [])[1] ? (bagS.items || [])[1].id
    : ((bagS.items || [])[0] || {}).id;
  for (const it of (bagS.items || [])) {
    if (it.id === keepOne) { continue; }        /* 留一件 ✓ */
    const price = [8000, 3000, 1200, 600, 300, 120, 40][pi++] || 100;
    const r = await listOne(tokShop, it.id, price);
    console.log('   listed ' + ((it.item || {}).name) + ' @ ' + price + ' -> ' + r);
    await sleep(300);
  }

  /* 用一次性 Chrome 打开"看客"的号 ✗ 面板截屏 ✓ */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx2d-shot-'));
  const port = 9381;
  const proc = spawn(BROWSER, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions',
    '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=520,880', ORIGIN + '/',
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    await sleep(250);
    try {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      target = list.find(function (t) { return t.type === 'page' && t.webSocketDebuggerUrl; });
    } catch (e) { }
  }
  if (!target) { console.error('no debug target'); process.exit(1); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(function (res, rej) { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const waiting = {};
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.id && waiting[m.id]) { waiting[m.id](m); delete waiting[m.id]; }
  };
  const send = function (method, params) {
    const id = ++seq;
    return new Promise(function (res) {
      waiting[id] = res;
      ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
      setTimeout(function () { if (waiting[id]) { delete waiting[id]; res(null); } }, 20000);
    });
  };
  const ev = async function (expr) {
    const r = await send('Runtime.evaluate', { expression: '(function(){' + expr + '})()', returnByValue: true });
    return r && r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable', {});
  await send('Page.enable', {});
  await sleep(1000);
  await ev('localStorage.setItem("token",' + JSON.stringify(tokView) + '); location.reload(); return 1;');
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    const st = await ev('return (typeof WSC !== "undefined") && WSC.ready;');
    if (st === true) { break; }
  }
  /* round304d：交易所现在是独立页签 ✗ 截图就从那一页截 ✓ */
  await ev('openSet("bag"); bagFetch(bagRender); return 1;');
  await sleep(1200);
  await ev('openSet("mkt"); return 1;');
  await sleep(2800);
  const grab = async function (name) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (shot && shot.result && shot.result.data) {
      const f = path.join(OUT, name + '.png');
      fs.writeFileSync(f, Buffer.from(shot.result.data, 'base64'));
      console.log('saved ' + f + ' (' + fs.statSync(f).size + ' bytes)');
      return true;
    }
    console.error('no screenshot data for ' + name);
    return false;
  };
  await grab('mkt-panel');
  /* ★ round304j：再来一张【把行放大】的 ✗ 用户要看的是"耐久条在图标下面"那一眼 ✓
     （整页截图里 44px 的条子太小 ✗ 看不清楚 ✓）*/
  /* ★ 排序切【最新】✗ 刚挂上去的那件（磨损的）就排第一 ✓ 不用跟滚动较劲 ✓ */
  await ev('MKT.sort = "new"; MKT.page = 1; mktAsk(false); return 1;');
  await sleep(1600);
  /* ★ 滚到那件【磨损的】✗ 这样图里就能直接看出短条 ✓ */
  console.log('   worn row: ' + await ev(
    'var rows = document.querySelectorAll("#mktList .mktRow");' +
    'for (var i = 0; i < rows.length; i++) {' +
    '  var it = rows[i]._it || {};' +
    '  if (!(it.durMax > 0) || !(it.dur < it.durMax)) { continue; }' +
    '  var pane = document.querySelector(".tabpane[data-pane=mkt]");' +
    '  if (pane) { pane.scrollTop = rows[i].offsetTop - pane.clientHeight / 2; }' +
    '  var b = rows[i].querySelector(".durbar i");' +
    '  return JSON.stringify({ name: it.name, dur: it.dur, durMax: it.durMax,' +
    '    barWidth: b ? b.style.width : null, barColor: b ? b.style.background : null });' +
    '}' +
    'return "NO-WORN-ROW";'));
  /* ★ 为了让图里【一眼看出差别】✗ 在列表最前面插两行同样的样式：
       一件满耐久 + 一件只剩 12%（红条）✓
     ★ 用【真的那个渲染函数】画的 ✗ 不是手写假 HTML ✓
     ★ 插完就还原（不写回文件 ✗ 也不影响测试 ✓）*/
  await ev(
    'var rows = document.querySelectorAll("#mktList .mktRow");' +
    'if (!rows.length) { return 1; }' +
    'var itA = { name: "样例·满耐久", tier: 4, slot: "weapon", look: "sword",' +
    '            dur: 3600, durMax: 3600, affixes: [], base: { coeff: 1 } };' +
    'var itB = { name: "样例·快没耐久了", tier: 4, slot: "weapon", look: "sword",' +
    '            dur: 432, durMax: 3600, affixes: [], base: { coeff: 1 } };' +
    'var box = document.getElementById("mktList");' +
    'var mk = function (it, price, tier) {' +
    '  var d = document.createElement("div");' +
    '  d.className = "mktRow";' +
    '  d.style.borderLeftColor = tierHex(tier);' +
    '  d.innerHTML = "<span class=\\"mktIco\\" style=\\"background:" +' +
    '    tierRgba(tier, 0.18) + "\\"><span class=\\"mktTier\\">" + (tier + 1) +' +
    '    "</span>" + iconOfItem(it) + durBarHTML(it) + "</span>" +' +
    '    "<span class=\\"mktMain\\"><span class=\\"mktName\\">" + it.name +' +
    '    "</span><span class=\\"mktSub\\">★" + (tier + 1) + " 阶 · 样例</span></span>" +' +
    '    "<span class=\\"mktPrice\\">" + price + "<small>剩 7 天</small></span>" +' +
    '    "<button class=\\"bagB\\">购 买</button>";' +
    '  return d;' +
    '};' +
    'var r0 = rows[0];' +
    'box.insertBefore(mk(itA, 1200, 3), r0);' +
    'box.insertBefore(mk(itB, 200, 3), r0);' +
    'return 1;');
  await ev('document.getElementById("mktList").style.zoom = "1.7"; return 1;');
  await sleep(500);
  await grab('mkt-durability');
  await ev('document.getElementById("mktList").style.zoom = ""; return 1;');
  /* ★ round304g：再截一张【交易所里点开一件的详情浮窗】✓
     （用户要的就是这个：看属性/词条/耐久 ✗ 还有购买按钮 ✓）*/
  console.log('   detail shot: ' + await ev(
    'var rows = document.querySelectorAll("#mktList .mktRow");' +
    'if (!rows.length) { return "NO-ROWS"; }' +
    'var pick = rows[0];' +
    'for (var i = 0; i < rows.length; i++) {' +
    '  var b = rows[i].querySelector("button:not([disabled])");' +
    '  if (b && b.getAttribute("data-mktbuy")) { pick = rows[i]; break; }' +
    '}' +
    'var bb = pick.getBoundingClientRect();' +
    'mktTipShow(pick, Math.round(bb.left + bb.width / 2),' +
    '           Math.round(bb.top + bb.height - 6));' +
    'var t = document.getElementById("bagTipBox");' +
    'return JSON.stringify({ acts: [].map.call(t.querySelectorAll("[data-tipact]"), function (x) {' +
    '  return x.getAttribute("data-tipact"); }),' +
    ' hasDur: String(t.textContent).indexOf("耐久") >= 0,' +
    ' hasAff: String(t.textContent).indexOf("词条") >= 0 });'));
  await sleep(700);
  await grab('mkt-detail');
  /* ★ 再截一张【背包】的（用户提的"按钮有点多"就是这一页 ✓）★
     顺手选中一件 ✗ 这样那张图里"选中之后按钮变成什么样"也看得见 ✓ */
  await ev('openSet("bag"); bagFetch(bagRender); return 1;');
  await sleep(1200);
  /* ★ 重新读一次背包：留着那一件是挂完才发的 ✗ 快照里可能没有 ✓ */
  await ev('bagFetch(bagRender); return 1;');
  await sleep(1500);
  const selInfo = await ev(
    'var s = document.querySelector("#bagGrid .slot[data-id]");' +
    'if (!s) { return "NO-SLOT"; }' +
    'BAG.sel = s.getAttribute("data-id"); bagRender();' +
    'return JSON.stringify({ sel: BAG.sel, items: (BAG.items || []).length,' +
    ' useDisabled: document.getElementById("bagUse").disabled,' +
    ' sellDisabled: document.getElementById("bagSell").disabled,' +
    ' mktDisabled: document.getElementById("bagMkt").disabled });');
  console.log('   bag selection: ' + selInfo);
  await sleep(900);
  await grab('bag-panel');
  /* ★ 再截一张【浮窗里有按钮】的（用户这一轮点名要看的就是这个 ✓）
     直接调 bagTipAt ✗ 给它一个格子中心坐标 ✓ 不依赖无头浏览器的 hover ✓ */
  await ev(
    'var s2 = document.querySelector("#bagGrid .slot[data-id]");' +
    'var r2 = s2.getBoundingClientRect();' +
    'bagTipAt({ clientX: Math.round(r2.left + r2.width / 2),' +
    '           clientY: Math.round(r2.top + r2.height / 2) }, s2);' +
    'return 1;');
  await sleep(1400);
  console.log('   tooltip shot: ' + await ev(
    'var b = document.getElementById("bagTipBox");' +
    'return JSON.stringify({ disp: getComputedStyle(b).display,' +
    ' acts: [].map.call(b.querySelectorAll("[data-tipact]"), function (x) { return x.getAttribute("data-tipact"); }),' +
    ' price: (b.querySelector("input[data-tipprice]")||{}).value });'));
  await grab('bag-tip');
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  await sleep(400);
  purge(SHOP); purge(VIEW);
  console.log('cleaned up');
  process.exit(0);
})();
