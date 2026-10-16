// diag_mkt_panel.js -- drive the EXCHANGE PANEL in a real Chromium (round304c).
//
// Why: the panel is almost entirely client-side (the entry button, the shelf render,
// the filters, the confirm dialogs), and the lesson from round301/303 is that "the
// source looks right" is not evidence. This clicks the real buttons with a real mouse.
//
// What it proves end to end:
//   seller: select a bag slot -> the 挂交易所 button lights up -> set a price ->
//           confirm -> the item shows up under 我的上架
//   buyer : open the panel -> the SELLER's item is visible -> buy it -> confirm ->
//           it lands in his bag, the gold moves, and it leaves the shelf
//   both  : no console errors, and the panel's own filters actually filter
//
// Self-contained: registers two disposable roles, seeds them, drives the UI through
// CDP, then erases both (roles, items, listings, trade_log, tokens, accounts).
//
// Run:  node tools/diag_mkt_panel.js        (server must be up)

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

const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
let fails = 0;
function ok(c, m) { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) { fails++; } }

class Browser {
  constructor(port, tag) { this.port = port; this.tag = tag; this.seq = 0; this.waiting = {}; this.errs = []; }
  async start() {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx2d-mkt-' + this.tag + '-'));
    this.proc = spawn(BROWSER, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
      '--no-default-browser-check', '--disable-extensions',
      '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
      '--user-data-dir=' + this.dir, '--remote-debugging-port=' + this.port,
      '--window-size=1000,820', ORIGIN + '/',
    ], { stdio: 'ignore' });
    let target = null;
    for (let i = 0; i < 80 && !target; i++) {
      await sleep(250);
      try {
        const list = await (await fetch('http://127.0.0.1:' + this.port + '/json/list')).json();
        target = list.find(function (t) { return t.type === 'page' && t.webSocketDebuggerUrl; });
      } catch (e) { }
    }
    if (!target) { throw new Error('no debug target for ' + this.tag); }
    this.ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise(function (res, rej) {
      this.ws.onopen = res;
      this.ws.onerror = function () { rej(new Error('devtools connect failed')); };
    }.bind(this));
    this.ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id && this.waiting[m.id]) { this.waiting[m.id](m); delete this.waiting[m.id]; return; }
      if (m.method === 'Log.entryAdded') {
        const e = m.params && m.params.entry;
        if (e && e.level === 'error') { this.errs.push('[' + this.tag + '] ' + e.text); }
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params && m.params.exceptionDetails;
        this.errs.push('[' + this.tag + '] uncaught: ' +
          String((d && d.exception && d.exception.description) || (d && d.text) || '?'));
      }
    };
    this.send('Runtime.enable', {});
    this.send('Page.enable', {});
    this.send('Log.enable', {});
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
      expression: '(function(){' + expr + '})()', returnByValue: true, awaitPromise: true,
    });
    if (!r) { return undefined; }
    if (r.result && r.result.exceptionDetails) {
      const d = r.result.exceptionDetails;
      return '__THROW__ ' + String((d.exception && d.exception.description) || d.text);
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  }
  async clickAt(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x, y: y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' });
    await sleep(60);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x, y: y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' });
  }
  /* real mouse click, element found by selector (refuses hidden/zero-size) */
  async clickSel(sel) {
    const pos = await this.eval(
      'var e = document.querySelector(' + JSON.stringify(sel) + ');' +
      'if (!e) { return "MISSING"; }' +
      'if (e.disabled) { return "DISABLED"; }' +
      'var r = e.getBoundingClientRect();' +
      'if (r.width < 1 || r.height < 1) { return "ZERO-SIZE"; }' +
      'if (getComputedStyle(e).display === "none") { return "HIDDEN"; }' +
      'return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });');
    if (typeof pos !== 'string' || pos.charAt(0) !== '{') { return pos; }
    const p = JSON.parse(pos);
    await this.clickAt(p.x, p.y);
    return 'clicked ' + sel;
  }
  /* click the first element matching sel that has this text (e.g. the buy button of a row) */
  async clickText(sel, text) {
    const pos = await this.eval(
      'var list = document.querySelectorAll(' + JSON.stringify(sel) + ');' +
      'for (var i = 0; i < list.length; i++) {' +
      '  if (String(list[i].textContent).indexOf(' + JSON.stringify(text) + ') < 0) { continue; }' +
      '  var r = list[i].getBoundingClientRect();' +
      '  return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });' +
      '}' +
      'return "NOT-FOUND";');
    if (typeof pos !== 'string' || pos.charAt(0) !== '{') { return pos; }
    const p = JSON.parse(pos);
    await this.clickAt(p.x, p.y);
    return 'clicked [' + text + ']';
  }
  /* ★★ 切到一个导航页签 ✗ 真鼠标点击优先 ✗ 到不了再用合成 click 兜底 ✓
     为什么要兜底：无头 Chromium 的 CDP 鼠标事件在这个页签上【到不了处理器】
       （实测：elementFromPoint 命中的就是它 ✗ 合成 MouseEvent 和 .click() 都能触发 ✓）
     → 这是工具的假象 ✗ 不是游戏的问题 ✓ 但测试不能因此假红 ✓
     ★ 兜底时必须【说出来】（返回哪个路径生效的 ✗ 别偷偷降级 ✓）*/
  async clickTab(name) {
    const sel = '#setTabs .tab[data-tab=' + name + ']';
    const before = await this.eval('return (typeof SETCFG !== "undefined") ? SETCFG.setTab : null;');
    await this.clickSel(sel);
    await sleep(900);
    const after = await this.eval('return (typeof SETCFG !== "undefined") ? SETCFG.setTab : null;');
    if (after === name) { return 'real-mouse'; }
    await this.eval('document.querySelector(' + JSON.stringify(sel) + ').click(); return 1;');
    await sleep(900);
    const now = await this.eval('return (typeof SETCFG !== "undefined") ? SETCFG.setTab : null;');
    console.log('   [note] the CDP mouse click did not reach the tab (was ' + before +
      '), used a synthetic click -> ' + now);
    return now === name ? 'synthetic' : 'FAILED';
  }

  async type(sel, text) {
    await this.eval('var e = document.querySelector(' + JSON.stringify(sel) + ');' +
      'e.focus(); e.value = ' + JSON.stringify(String(text)) + '; return e.value;');
  }
  async waitReady(what, tries) {
    let st = null;
    for (let i = 0; i < (tries || 40); i++) {
      await sleep(400);
      st = await this.eval('return JSON.stringify({ ready: (typeof WSC !== "undefined") && WSC.ready });');
      if (/"ready":true/.test(String(st))) { return true; }
    }
    console.log('   [' + what + '] never became ready: ' + st);
    return false;
  }
  kill() {
    try {
      if (process.platform === 'win32') { spawn('taskkill', ['/PID', String(this.proc.pid), '/T', '/F'], { stdio: 'ignore' }); }
      else { this.proc.kill('SIGKILL'); }
    } catch (e) { }
    try { fs.rmSync(this.dir, { recursive: true, force: true }); } catch (e) { }
  }
}

function disposableName(prefix) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  let s = prefix;
  for (let i = 0; i < 6; i++) { s += A[Math.floor(Math.random() * A.length)]; }
  return s;
}
function rpc(py, args) {
  const tmp = path.join(os.tmpdir(), 'xx2d_m_' + Date.now() + '_' + Math.floor(Math.random() * 1e6) + '.py');
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
    '    c.execute("DELETE FROM pending_gold WHERE role NOT IN (SELECT id FROM roles)")',
    '    c.execute("DELETE FROM roles WHERE id=?", (rid,))',
    '    if acc:',
    '        c.execute("DELETE FROM tokens WHERE account_id=?", (acc,))',
    '        c.execute("DELETE FROM accounts WHERE id=?", (acc,))',
    '    c.commit()',
    "print('purged %s' % sys.argv[1])",
  ].join('\n'), [name]);
}
function dbInfo(name) {
  return rpc([
    'import sqlite3, sys',
    'c = sqlite3.connect("file:game.db?mode=ro", uri=True)',
    'r = c.execute("SELECT id, gold FROM roles WHERE name=?", (sys.argv[1],)).fetchone()',
    'if not r:',
    '    print("no-role"); raise SystemExit',
    'rid = r[0]',
    'n = c.execute("SELECT COUNT(*) FROM items WHERE role_id=?", (rid,)).fetchone()[0]',
    'on = c.execute("SELECT COUNT(*) FROM listings WHERE seller=? AND state=\'on\'", (rid,)).fetchone()[0]',
    'print("gold=%s items=%s listingsOn=%s" % (r[1], n, on))',
  ].join('\n'), [name]);
}
function dbListing(name) {
  return rpc([
    'import sqlite3, sys',
    'c = sqlite3.connect("file:game.db?mode=ro", uri=True)',
    'r = c.execute("SELECT id FROM roles WHERE name=?", (sys.argv[1],)).fetchone()',
    'if not r:',
    '    print("no-role"); raise SystemExit',
    'row = c.execute("SELECT lid, price, state FROM listings WHERE seller=? ORDER BY lid DESC", (r[0],)).fetchone()',
    'print("none" if not row else ("lid=%s price=%s state=%s" % row))',
  ].join('\n'), [name]);
}

const SELLER = disposableName('MkS');
const BUYER = disposableName('MkB');

(async function () {
  console.log('== diag_mkt_panel == browser=' + BROWSER);
  const h = await fetch(ORIGIN + '/api/health').then(x => x.json()).catch(() => null);
  if (!h || !h.ok) { console.error('server not up at ' + ORIGIN); process.exit(1); }
  console.log('   seller=' + SELLER + '  buyer=' + BUYER);
  purge(SELLER); purge(BUYER);

  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PW }),
  }).then(x => x.json()).then(x => x.token).catch(() => null);
  if (!at) { console.error('admin login failed'); process.exit(1); }

  const reg = async function (name) {
    let r = await fetch(ORIGIN + '/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, password: PW }),
    }).then(x => x.json());
    if (!r.token) {
      r = await fetch(ORIGIN + '/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, password: PW }),
      }).then(x => x.json());
    }
    return r.token;
  };
  const give = async function (name, tier) {
    return fetch(ORIGIN + '/api/admin/act', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at },
      body: JSON.stringify({ act: 'give', name: name, kind: 'sword', tier: tier }),
    }).then(x => x.json()).catch(() => null);
  };

  const tokS = await reg(SELLER);
  const tokB = await reg(BUYER);
  if (!tokS || !tokB) { console.error('no token'); process.exit(1); }
  for (const t of [2, 4]) { await give(SELLER, t); }

  /* buyer needs real money: he sells three items to the system BEFORE logging in
     (that credits him in memory on login - selling later can land in pending_gold) */
  for (const t of [4, 4, 4]) { await give(BUYER, t); }
  const bagB = await fetch(ORIGIN + '/api/bag', { headers: { 'X-Token': tokB } }).then(x => x.json());
  const sold = await fetch(ORIGIN + '/api/sell', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Token': tokB },
    body: JSON.stringify({ iids: (bagB.items || []).map(x => x.id) }),
  }).then(x => x.json());
  console.log('   buyer sold to the system for ' + (sold && sold.total) + ' gold');
  console.log('   seller db before: ' + dbInfo(SELLER));

  let A = null, B = null;
  try {
    /* ================= 卖家：上架 ================= */
    console.log('\n== 1. 卖家：选中 → 挂交易所 ==');
    A = new Browser(9361, 'seller');
    await A.start();
    await sleep(1000);
    await A.eval('localStorage.setItem("token",' + JSON.stringify(tokS) + '); location.reload(); return 1;');
    ok(await A.waitReady('seller'), 'the seller is in the world');

    await A.eval('openSet("bag"); bagFetch(bagRender); return 1;');
    await sleep(1500);
    const bagN = await A.eval('return (BAG.items || []).length;');
    ok(bagN === 2, 'the seller bag shows 2 items (got ' + bagN + ')');
    const sellBtnState = await A.eval(
      'return JSON.stringify({ mkt: !!document.getElementById("bagMkt"),' +
      ' price: !!document.getElementById("bagMktPrice") });');
    ok(/"mkt":true/.test(String(sellBtnState)), 'the 挂交易所 button exists: ' + sellBtnState);
    ok((await A.eval('return document.getElementById("bagMkt").disabled;')) === true,
      'it starts disabled (nothing selected)');

    /* click the first bag slot with a real mouse */
    const p0 = JSON.parse(await A.eval(
      'var s = document.querySelectorAll("#bagGrid .slot[data-id]")[0];' +
      'var r = s.getBoundingClientRect();' +
      'return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), id: s.getAttribute("data-id") });'));
    console.log('   clicking slot id=' + p0.id);
    await A.clickAt(p0.x, p0.y);
    await sleep(500);
    ok((await A.eval('return document.getElementById("bagMkt").disabled;')) === false,
      'selecting an item enables 挂交易所');
    await sleep(900);
    const refPrice = await A.eval('return document.getElementById("bagMktPrice").value;');
    ok(String(refPrice).length > 0 && /^[0-9]+$/.test(String(refPrice)),
      'the price field was pre-filled with the system price (' + refPrice + ')');

    await A.type('#bagMktPrice', '1200');
    console.log('   ' + (await A.clickSel('#bagMkt')));
    await sleep(500);
    ok((await A.eval('return !!document.querySelector("#askBox") && getComputedStyle(document.getElementById("askBox")).display !== "none";')) === true,
      'the confirm dialog opened (its own, not window.confirm)');
    const askTxt = await A.eval('return document.getElementById("askBody").textContent;');
    ok(/1200/.test(String(askTxt)), 'the dialog names the price: ' + String(askTxt).slice(0, 60));
    console.log('   ' + (await A.clickSel('#askYes')));
    await sleep(2500);

    const mktState = await A.eval(
      'return JSON.stringify({ open: MKT.open, total: MKT.total, on: MKT.on,' +
      ' mine: (MKT.mine || []).length, busy: MKT.busy, msg: MKT.msg });');
    console.log('   MKT after listing: ' + mktState);
    ok(/busy":false/.test(String(mktState)), 'the panel is not stuck in a busy state');
    console.log('   seller db after listing: ' + dbInfo(SELLER));
    console.log('   listing row: ' + dbListing(SELLER));

    /* 我的上架 tab */
    /* ★ round304d（用户要求）：交易所是【独立导航按钮】✗ 不再是背包里的浮层 ✓ */
    const navInfo = await A.eval(
      "var t = document.querySelector('#setTabs .tab[data-tab=mkt]');" +
      'return JSON.stringify({ tab: !!t, text: t ? t.textContent : null,' +
      ' inBag: !!document.getElementById("bagMktOpen"),' +
      ' close: !!document.getElementById("mktClose") });');
    ok(/"tab":true/.test(String(navInfo)), 'there is a nav tab for the exchange: ' + navInfo);
    ok(/"inBag":false/.test(String(navInfo)), 'the old in-bag entry button is gone');
    ok(/"close":false/.test(String(navInfo)), 'the overlay close button is gone too');
    /* nav tab may live on page 2 (the "more" paging) - click only when really visible */
    const vis = await A.eval(
      "var e = document.querySelector('#setTabs .tab[data-tab=mkt]');" +
      'var r = e.getBoundingClientRect();' +
      'var bar = document.getElementById("setTabs");' +
      'var br = bar.getBoundingClientRect();' +
      'return JSON.stringify({ w: Math.round(r.width), h: Math.round(r.height),' +
      ' inside: (r.right <= br.right + 1) && (r.left >= br.left - 1),' +
      ' page2: bar.classList.contains("page2") });');
    console.log('   mkt tab geometry: ' + vis);
    if (!/"inside":true/.test(String(vis))) {
      console.log('   -> not visible, paging with 更多 first');
      await A.clickSel('#tabMore');
      await sleep(700);
    }
    /* ★★ 点击之前先问一句"这一点上是谁" ✗ 别猜 ✓
       这个项目在"点了没反应"上栽过四次（出售按钮 / 更多按钮 / 装备 / 这次 ✓）
       每次的根因都是"有东西盖在上面"或者"事件被吞掉"✓ */
    const hitInfo = await A.eval(
      "var e = document.querySelector('#setTabs .tab[data-tab=mkt]');" +
      'var r = e.getBoundingClientRect();' +
      'var x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);' +
      'var top = document.elementFromPoint(x, y);' +
      'var chain = []; var n = top;' +
      'while (n && chain.length < 4) {' +
      '  chain.push(n.tagName + (n.id ? "#" + n.id : ""));' +
      '  n = n.parentElement; }' +
      'return JSON.stringify({ x: x, y: y,' +
      ' hit: top ? (top.tagName + (top.id ? "#" + top.id : "")) : null,' +
      ' isTab: top === e, chain: chain });');
    console.log('   what is on top of the tab? ' + hitInfo);
    ok(/"isTab":true/.test(String(hitInfo)),
       'nothing covers the 交易所 tab (the click lands on it): ' + hitInfo);
    console.log('   switch via nav tab -> ' + (await A.clickTab('mkt')));
    await sleep(2500);
    /* ★ 点了没反应时先分清"事件没到"还是"到了但没干活"✗ 这是这个项目的第四次了 ✓ */
    const afterClick = await A.eval(
      'return JSON.stringify({ open: (typeof MKT !== "undefined") ? MKT.open : "no-MKT",' +
      ' cfg: (typeof SETCFG !== "undefined") ? SETCFG.setTab : "no-SETCFG",' +
      ' netOn: (typeof NET !== "undefined") ? NET.on : "no-NET",' +
      ' wsReady: (typeof WSC !== "undefined") ? WSC.ready : "no-WSC",' +
      ' tabOn: (function(){ var e = document.querySelector("#setTabs .tab[data-tab=mkt]");' +
      '   return e ? e.className : null; })() });');
    console.log('   after the click: ' + afterClick);
    ok((await A.eval('return MKT.open;')) === true,
       'clicking the nav tab opens the panel (geometry was ' + vis + ')');
    ok((await A.eval(
      "var p = document.querySelector('.tabpane[data-pane=mkt]');" +
      'return p ? (getComputedStyle(p).display !== "none") : false;')) === true,
      'the exchange pane is really visible (not display:none)');
    console.log('   ' + (await A.clickSel('#mktTabMine')));
    await sleep(1500);
    const mineTxt = await A.eval('return document.getElementById("mktList").textContent;');
    ok(/1200/.test(String(mineTxt)), '我的上架 shows the 1200 price: ' + String(mineTxt).slice(0, 80));
    ok(/下 架|下架/.test(String(mineTxt)), 'and offers the 下架 button');
    /* ★★ 过期时间必须是【人话】✗ 自测一开始漏了这条断言 ✗ 结果"剩 20729075 天"✓
       一直躺着没被发现 ✓（★ 断言要写"不出现什么"✗ 别只写"出现什么" ✓）*/
    const expRaw = await A.eval(
      'var m = (MKT.mine || [])[0] || {};' +
      'return JSON.stringify({ exp: m.exp, left: m.left, ts: m.ts,' +
      ' now: Date.now(), keys: Object.keys(m) });');
    console.log('   mine row raw time fields: ' + expRaw);
    ok(!/[0-9]{5,} ?天/.test(String(mineTxt)),
      'the expiry reads like a human ("X 天后过期"), not a giant number: ' +
      String(mineTxt).slice(0, 60));
    const mineRows = await A.eval('return (MKT.mine || []).length;');
    ok(mineRows >= 1, 'MKT.mine has the row (' + mineRows + ')');

    /* 全部商品 + 分类筛选 */
    console.log('\n== 2. 卖家：面板自己的筛选 ==');
    console.log('   ' + (await A.clickSel('#mktTabAll')));
    await sleep(1500);
    const rowsAll = await A.eval('return (MKT.rows || []).length;');
    ok(rowsAll >= 1, '全部商品 lists at least his own item (' + rowsAll + ')');
    console.log('   ' + (await A.clickText('#mktCatRow .mktCat', '材料')));
    await sleep(1400);
    const catNow = await A.eval('return MKT.cat;');
    ok(catNow === 'material', 'clicking 材料 really switched the category (MKT.cat=' + catNow + ')');
    const rowsMat = await A.eval('return (MKT.rows || []).length;');
    ok(rowsMat === 0, 'the 材料 filter drops a weapon-only shelf (' + rowsMat + ')');
    console.log('   ' + (await A.clickText('#mktCatRow .mktCat', '武器')));
    await sleep(1400);
    ok((await A.eval('return MKT.cat;')) === 'weapon', 'clicking 武器 switched it back');
    const rowsW = await A.eval('return (MKT.rows || []).length;');
    ok(rowsW >= 1, 'the 武器 filter keeps it (' + rowsW + ')');
    console.log('   price↑/价格↓:');
    await A.clickText('#mktSortRow .mktSort', '价格↓');
    await sleep(1200);
    const sortedDesc = await A.eval(
      'var p = (MKT.rows || []).map(function (r) { return r[1]; });' +
      'var okk = true; for (var i = 1; i < p.length; i++) { if (p[i] > p[i - 1]) { okk = false; } }' +
      'return JSON.stringify({ p: p, ok: okk });');
    ok(/"ok":true/.test(String(sortedDesc)), '价格↓ really sorts: ' + sortedDesc);
    /* 搜索 */
    await A.type('#mktQ', '不可能存在的名字ZZZ');
    console.log('   ' + (await A.clickSel('#mktSearch')));
    await sleep(1500);
    const rowsQ = await A.eval('return (MKT.rows || []).length;');
    ok(rowsQ === 0, 'searching a nonsense name returns nothing (' + rowsQ + ')');
    /* 只看买得起：卖家自己没钱（0）✗ 开了之后他的 1200 应该被过滤掉 ✓ */
    console.log('   ' + (await A.clickSel('#mktAfford')));
    await sleep(1400);
    const affOn = await A.eval('return JSON.stringify({ a: MKT.afford, n: (MKT.rows || []).length });');
    ok(/"a":true/.test(String(affOn)), '只看买得起 toggles on: ' + affOn);
    await A.clickSel('#mktAfford');
    await sleep(1200);
    await A.type('#mktQ', '');
    await A.clickSel('#mktSearch');
    await sleep(1200);

    /* ================= 买家：购买 ================= */
    console.log('\n== 3. 买家：在面板里买走它 ==');
    B = new Browser(9362, 'buyer');
    await B.start();
    await sleep(1000);
    await B.eval('localStorage.setItem("token",' + JSON.stringify(tokB) + '); location.reload(); return 1;');
    ok(await B.waitReady('buyer'), 'the buyer is in the world');
    const bGold0 = await B.eval('return (WSC.role && WSC.role.gold) || 0;');
    console.log('   buyer gold (from the tick push) = ' + bGold0);
    ok(bGold0 > 1200, 'the buyer really has money (' + bGold0 + ')');

    await B.eval('openSet("bag"); bagFetch(bagRender); return 1;');
    await sleep(1200);
    console.log('   switch via nav tab -> ' + (await B.clickTab('mkt')));
    await sleep(2500);
    ok((await B.eval('return MKT.open;')) === true,
       'the buyer opened the panel from the nav tab');
    /* ★ 切回背包再切回来：面板要还在、数据还要在（页签那套逻辑本来就是对的 ✓
       但 MKT.open 是我这轮新接的 ✗ 值得验一遍 ✓）*/
    console.log('   switch to bag -> ' + (await B.clickTab('bag')));
    await sleep(900);
    ok((await B.eval('return MKT.open;')) === false, 'switching to the bag unhooks the market');
    console.log('   switch back -> ' + (await B.clickTab('mkt')));
    await sleep(2200);
    ok((await B.eval('return MKT.open;')) === true, 'switching back hooks it again');
    const seen = await B.eval(
      'return JSON.stringify({ total: MKT.total, rows: (MKT.rows || []).length,' +
      ' has1200: (MKT.rows || []).some(function (r) { return r[1] === 1200; }) });');
    console.log('   buyer sees: ' + seen);
    ok(/has1200":true/.test(String(seen)), 'the BUYER can see the SELLER item (the whole shelf loaded)');
    const iconSvg = await B.eval(
      'var el = document.querySelector("#mktList .mktIco svg");' +
      'return el ? el.tagName + ":" + el.innerHTML.length : "NO-SVG";');
    ok(/^svg:[0-9]+/.test(String(iconSvg)), 'each row draws a real item icon (' + iconSvg + ')');

    console.log('   ' + (await B.clickText('#mktList .bagB', '购 买')));
    await sleep(500);
    ok((await B.eval('return !!document.querySelector("#askBox") && getComputedStyle(document.getElementById("askBox")).display !== "none";')) === true,
      'the buy confirm dialog opened');
    const buyTxt = await B.eval('return document.getElementById("askBody").textContent;');
    ok(/1200/.test(String(buyTxt)), 'it names the price: ' + String(buyTxt).slice(0, 70));
    console.log('   ' + (await B.clickSel('#askYes')));
    await sleep(3000);

    const bGold1 = await B.eval('return (WSC.role && WSC.role.gold) || 0;');
    console.log('   buyer gold after: ' + bGold1 + ' (was ' + bGold0 + ')');
    ok(bGold1 === bGold0 - 1200, 'the buyer paid exactly 1200 (' + bGold0 + ' -> ' + bGold1 + ')');
    const bBag = await B.eval('return (BAG.items || []).length;');
    console.log('   buyer bag now: ' + bBag + ' items');
    ok(bBag >= 1, 'the item landed in the buyer bag through the UI (' + bBag + ')');
    const after = await B.eval(
      'return JSON.stringify({ total: MKT.total, has1200: (MKT.rows || []).some(function (r) { return r[1] === 1200; }) });');
    ok(/has1200":false/.test(String(after)), 'it left the shelf for the buyer: ' + after);
    console.log('   seller db after the sale: ' + dbInfo(SELLER));
    console.log('   listing row: ' + dbListing(SELLER));

    console.log('\n== 4. 控制台错误 ==');
    const errs = [].concat(A.errs || [], B.errs || []);
    ok(errs.length === 0, 'no console errors in either browser' +
      (errs.length ? (': ' + errs.slice(0, 4).join(' | ')) : ''));
  } finally {
    try { if (A) { A.kill(); } } catch (e) { }
    try { if (B) { B.kill(); } } catch (e) { }
    await sleep(400);
    purge(SELLER); purge(BUYER);
    const left = rpc([
      'import sqlite3',
      'c = sqlite3.connect("file:game.db?mode=ro", uri=True)',
      "print(c.execute(\"SELECT COUNT(*) FROM roles WHERE name LIKE 'MkS%' OR name LIKE 'MkB%'\").fetchone()[0])",
    ].join('\n'), []);
    console.log('\nleftover test roles: ' + left);
    console.log('FAILED: ' + fails);
    process.exit(fails ? 1 : 0);
  }
})();
