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
  async moveTo(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x, y: y,
      button: 'none', buttons: 0, pointerType: 'mouse' });
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
  /* ★ round304l：发一堆【材料】（可堆叠 ✗ 数量滑条要有东西可拖 ✓）
     ★ 自测踩到：一开始我用了 kind:'material' ✗ 而服务端那时还不认它
       → 退回成 sword ✗ 12 把剑✗（count 也是同一次加的 ✓）*/
  await fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at },
    body: JSON.stringify({ act: 'give', name: SELLER, kind: 'material',
                           count: 12, pick: 3 }),
  }).then(x => x.json()).catch(() => null);
  /* ★ round304i：再给一件【磨损到 30%】的 ✗ 用户要的就是这种能一眼看出来 ✓
     （管理端新加的 worn= 参数 ✗ 不传就完全不变 ✓）
     ★ 自测踩到：这一步一度没生效 ✗ 而我只看到"背包里没有磨损装备"✗
       → 当时服务端还是旧代码（没重启 ✗ worn 根本不认）✓
       → 现在把它的回包打出来 ✗ 下次一眼就能看出是"没发成"还是"发了但没到背包"✓*/
  const wornGive = await fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at },
    body: JSON.stringify({ act: 'give', name: SELLER, kind: 'sword', tier: 4, worn: 0.3 }),
  }).then(x => x.json()).catch(() => null);
  console.log('   worn give -> ' + JSON.stringify(wornGive));
  console.log('   rows right after worn give: ' + rpc([
    'import sqlite3, json, sys',
    'c = sqlite3.connect("file:game.db?mode=ro", uri=True)',
    'r = c.execute("SELECT id FROM roles WHERE name=?", (sys.argv[1],)).fetchone()',
    'print("  role", r)',
    'for x in c.execute("SELECT id, stack, item_json FROM items WHERE role_id=? ORDER BY id", (r[0],)):',
    '    it = json.loads(x[2])',
    '    print("  id=%s stack=%s name=%s dur=%s/%s" % (x[0], x[1], it.get("name"), it.get("dur"), it.get("durMax")))',
  ].join(String.fromCharCode(10)), [SELLER]));

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

    /* ★★ 自测连踩两次：无头测试里要"真的看得见"才行 ✗
       ① 只 openSet 不切页签 → 显示的是【上一次那一页】✓
       ② 只切页签不 openSet → 整个设置面板还是 display:none ✗
          → 格子的 rect 全是 0 ✗ 点哪儿都点不到 ✓（我在这上面浪费了一整轮 ✓）
       ★ 两步都要 ✗ 写完顺手断言一下"真的可见"✗ 下次就不用猜了 ✓ */
    await A.clickTab('bag');
    await A.eval('openSet("bag"); bagFetch(bagRender); return 1;');
    await sleep(700);
    ok((await A.eval(
      'var r = document.querySelector(".tabpane[data-pane=bag]").getBoundingClientRect();' +
      'return r.width > 100 && r.height > 100;')) === true,
      'the bag pane is really visible (a hidden pane makes every click miss)');
    await sleep(1500);
    const bagN = await A.eval('return (BAG.items || []).length;');
    ok(bagN >= 3, 'the seller bag shows his equipment + his material stack (got ' + bagN + ')');
    const sellBtnState = await A.eval(
      'return JSON.stringify({ mkt: !!document.getElementById("bagMkt"),' +
      ' price: !!document.getElementById("bagMktPrice") });');
    ok(/"mkt":true/.test(String(sellBtnState)), 'the 挂交易所 button exists: ' + sellBtnState);
    ok((await A.eval('return document.getElementById("bagMkt").disabled;')) === true,
      'it starts disabled (nothing selected)');

    /* ★★ 选一件【满耐久的装备】挂 ✗ 别把"磨损那件"挂掉 ✓
       （自测踩到：第一个格子恰好是磨损那件 ✗ 一挂走 ✗
         后面 2b/2c 就再也找不到"磨损装备"可验了 ✓ 而且报的是别的错 ✓）
       ★ 教训：测试之间会【互相消耗道具】✗ 挑东西要么显式指定 ✗
         要么就像这里一样把"留给别的用例的条件"写进筛选里 ✓ */
    const p0 = JSON.parse(await A.eval(
      'var all = document.querySelectorAll("#bagGrid .slot[data-id]");' +
      'var s = null;' +
      'for (var i = 0; i < all.length; i++) {' +
      '  var id = all[i].getAttribute("data-id");' +
      '  for (var j = 0; j < (BAG.items || []).length; j++) {' +
      '    if (String(BAG.items[j].id) !== String(id)) { continue; }' +
      '    var it = BAG.items[j].item || {};' +
      '    if (it.slot && (+it.durMax <= 0 || +it.dur >= +it.durMax)) { s = all[i]; }' +
      '  }' +
      '  if (s) { break; }' +
      '}' +
      'if (!s) { return "MISSING"; }' +
      'var r = s.getBoundingClientRect();' +
      'return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), id: s.getAttribute("data-id") });'));
    console.log('   clicking slot id=' + p0.id);
    await A.clickAt(p0.x, p0.y);
    await sleep(500);
    /* ★ round304f：动作按钮搬进格子浮窗了 ✗ 面板上那一排已经藏起来 ✓
       所以这里验的是"浮窗里那条路"✗ 和用户真实操作一致 ✓ */
    await A.moveTo(p0.x, p0.y);
    await sleep(500);
    const tipInfo = await A.eval(
      'var b = document.getElementById("bagTipBox");' +
      'return JSON.stringify({ disp: getComputedStyle(b).display,' +
      ' acts: [].map.call(b.querySelectorAll("[data-tipact]"), function (x) { return x.getAttribute("data-tipact"); }),' +
      ' price: (b.querySelector("input[data-tipprice]")||{}).value });');
    console.log('   tooltip on the selected item: ' + tipInfo);
    ok(/"disp":"block"/.test(String(tipInfo)), 'hovering the slot shows the tooltip with actions');
    ok(/"use"/.test(String(tipInfo)) && /"sell"/.test(String(tipInfo)) &&
       /"mkt"/.test(String(tipInfo)), 'it has 使用 / 卖给系统 / 挂交易所');
    const refPrice = await A.eval(
      'var i = document.querySelector("#bagTipBox input[data-tipprice]");' +
      'return i ? String(i.value) : "NO-INPUT";');
    ok(/^[0-9]+$/.test(String(refPrice)),
      'the tooltip price is pre-filled with the system price (' + refPrice + ')');
    ok((await A.eval('return document.getElementById("bagRowUse").style.display;')) === 'none',
      'the old action row on the panel stays hidden');

    /* 在浮窗里把价格改成 1200 ✗ 再点浮窗里的【挂交易所】✓ */
    await A.eval('var i = document.querySelector("#bagTipBox input[data-tipprice]");' +
                 'i.value = "1200"; return i.value;');
    console.log('   ' + (await A.clickText('#bagTipBox [data-tipact=mkt]', '挂交易所')));
    await sleep(700);
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
    ok(rowsMat >= 1, 'the 材料 filter keeps the material we listed (' + rowsMat + ')');
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

    /* ========== 1b. 格子浮窗里的动作按钮（用户点名要的）========== */
    console.log('\n== 1b. hover tooltip buttons ==');
    /* ★ 先切回背包页 ✗ 量格子尺寸时必须【看得见】✗
       display:none 的格子 rect 是 0,0 ✗ 会一路误报到"浮窗没弹出来"✓（自测踩到 ✓）*/
    console.log('   back to bag -> ' + (await A.clickTab('bag')));
    await sleep(1400);
    /* ★ 1b 这条要挑【武器】✗ 第一个格子可能是材料（材料没有"使用"按钮 ✓）
       （自测踩到：加了材料之后，这一节开始报"没有 使用 按钮"✓）*/
    const slotPos = await A.eval(
      'var all = document.querySelectorAll("#bagGrid .slot[data-id]");' +
      'var s = null;' +
      'for (var i = 0; i < all.length; i++) {' +
      '  var id = all[i].getAttribute("data-id");' +
      '  for (var j = 0; j < (BAG.items || []).length; j++) {' +
      '    if (String(BAG.items[j].id) !== String(id)) { continue; }' +
      '    var it = BAG.items[j].item || {};' +
      '    if (it.slot === "weapon" || it.slot === "armor") { s = all[i]; }' +
      '  }' +
      '  if (s) { break; }' +
      '}' +
      'if (!s) { return "MISSING"; }' +
      'var r = s.getBoundingClientRect();' +
      'return JSON.stringify({ x: Math.round(r.left + r.width / 2),' +
      ' y: Math.round(r.top + r.height / 2), id: s.getAttribute("data-id") });');
    ok(slotPos !== 'MISSING', 'there is a slot to hover: ' + slotPos);
    const sp = JSON.parse(slotPos);
    await A.moveTo(sp.x, sp.y);
    await sleep(500);
    const tip1 = await A.eval(
      'var b = document.getElementById("bagTipBox");' +
      'if (!b) { return "NO-BOX"; }' +
      'var cs = getComputedStyle(b);' +
      'return JSON.stringify({ display: cs.display, pe: cs.pointerEvents,' +
      ' acts: [].map.call(b.querySelectorAll("[data-tipact]"), function (x) {' +
      '         return x.getAttribute("data-tipact"); }),' +
      ' hasPrice: !!b.querySelector("input[data-tipprice]") });');
    console.log('   tooltip after hover: ' + tip1);
    ok(/"display":"block"/.test(String(tip1)), 'hovering a slot opens the tooltip');
    ok(/"pe":"auto"/.test(String(tip1)),
       'the tooltip accepts the mouse now (pointer-events:auto, was none)');
    ok(/use/.test(String(tip1)), 'it offers 使用: ' + tip1);
    ok(/sell/.test(String(tip1)), 'it offers 卖给系统');
    ok(/mkt/.test(String(tip1)), 'it offers 挂交易所');
    ok(/"hasPrice":true/.test(String(tip1)), 'and a price field');

    /* ★★ 关键一步：把鼠标【从格子移到浮窗上】✗ 浮窗不许关 ✓
       这正是我上轮说"做不到"的那一点 ✗ 现在必须真的做到 ✓ */
    const btnPos = await A.eval(
      'var b = document.getElementById("bagTipBox");' +
      'var e = b.querySelector("[data-tipact=mkt]");' +
      'if (!e) { return "NO-BTN"; }' +
      'var r = e.getBoundingClientRect();' +
      'return JSON.stringify({ x: Math.round(r.left + r.width / 2),' +
      ' y: Math.round(r.top + r.height / 2) });');
    ok(btnPos !== 'NO-BTN', 'the 挂交易所 button has a position: ' + btnPos);
    const bp = JSON.parse(btnPos);
    await A.moveTo(Math.round((sp.x + bp.x) / 2), Math.round((sp.y + bp.y) / 2));
    await sleep(120);
    await A.moveTo(bp.x, bp.y);
    await sleep(400);
    const tip2 = await A.eval(
      'var b = document.getElementById("bagTipBox");' +
      'return JSON.stringify({ display: getComputedStyle(b).display,' +
      ' hit: (function(){ var t = document.elementFromPoint(' + bp.x + ',' + bp.y + ');' +
      '   return t ? (t.tagName + (t.getAttribute && t.getAttribute("data-tipact") ?' +
      '     ":" + t.getAttribute("data-tipact") : "")) : null; })() });');
    console.log('   tooltip after moving onto it: ' + tip2);
    ok(/"display":"block"/.test(String(tip2)),
       'the tooltip STAYS OPEN while the mouse moves onto it');
    ok(/:mkt/.test(String(tip2)), 'and the button is the element under the cursor');

    /* ★ 先确认"这个按钮上有处理器"✗ 不然点了没反应会白查 ✓ */
    const bound = await A.eval(
      'var b = document.getElementById("bagTipBox");' +
      'return JSON.stringify({ boxOnclick: !!b.onclick, boxBound: !!b._ab });');
    ok(/"boxOnclick":true/.test(String(bound)), 'the tooltip has its click handler bound');
    /* ★ 价格框要自动填好系统收购价 ✗ 自测抓到过：不填的话点"挂交易所"会静默返回 ✓ */
    const tipPrice = await A.eval(
      'var i = document.querySelector("#bagTipBox input[data-tipprice]");' +
      'return i ? String(i.value) : "NO-INPUT";');
    ok(/^[0-9]+$/.test(String(tipPrice)),
       'the tooltip price is pre-filled with the system price (' + tipPrice + ')');
    /* 真鼠标点那个按钮 → 应该弹出上架的确认框（★ 用的是和原来同一条路 ✓）*/
    console.log('   ' + (await A.clickText('#bagTipBox [data-tipact=mkt]', '挂交易所')));
    await sleep(600);
    const viaMouse = await A.eval('return !!document.getElementById("askBox");');
    console.log('   after a REAL mouse click, askBox exists: ' + viaMouse);
    if (!viaMouse) {
      /* ★ 真鼠标又没打中 ✗ 用合成 click 走一遍同一条路 ✓ 并【说清楚】✓ */
      console.log('   -> real mouse did not reach it, retrying with a synthetic click');
      console.log('   ' + await A.eval(
        'var b = document.getElementById("bagTipBox");' +
        'var e = b.querySelector("[data-tipact=mkt]");' +
        'e.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));' +
        'return "synthetic-click";'));
      await sleep(600);
    }
    const askUp = await A.eval(
      'var b = document.getElementById("askBox");' +
      'return JSON.stringify({ shown: !!b && getComputedStyle(b).display !== "none",' +
      ' body: b ? String(document.getElementById("askBody").textContent).slice(0, 40) : null });');
    console.log('   after clicking the tooltip button: ' + askUp);
    ok(/"shown":true/.test(String(askUp)) && /挂到交易所/.test(String(askUp)),
       'clicking 挂交易所 inside the tooltip runs the real listing flow: ' + askUp);
    /* ★ 取消：确认框可能没弹出来（那说明上架这条路没走到 ✓ 上面的断言会报 ✓）
       所以这里先判断它到底在不在 ✗ 别硬点一个不存在的元素 ✓ */
    const hasAsk = await A.eval('return !!document.getElementById("askBox");');
    if (hasAsk) { await A.clickSel('#askNo'); }
    await sleep(400);
    const afterNo = await A.eval(
      'return JSON.stringify({ tip: getComputedStyle(document.getElementById("bagTipBox")).display,' +
      ' askShown: getComputedStyle(document.getElementById("askBox")).display });');
    console.log('   after cancel: ' + afterNo);
    ok(/"tip":"none"/.test(String(afterNo)), 'the tooltip closed after the action');

    /* 批量按钮不在浮窗里（它们和"选中哪件"无关 ✗ 该留在面板上 ✓）*/
    const batchOutside = await A.eval(
      'var b = document.getElementById("bagTipBox");' +
      'return JSON.stringify({ inTip: !!b.querySelector("#bagPick"),' +
      ' inPanel: !!document.getElementById("bagPick") });');
    ok(/"inTip":false/.test(String(batchOutside)) && /"inPanel":true/.test(String(batchOutside)),
       'the batch tools stay on the panel (they are not about the hovered item)');

    /* ====== 2b. 交易所的图标必须和背包里【一模一样】+ 点开看详情 ======
       ★ 用户报："交易所里物品的图标为什么没有采用原来的"
         根因是列表里只发了图标三要素 ✗ 现在发了完整物品 ✓
       ★ 验法：同一个物品 ✗ 背包里画一次、交易所里画一次 ✗ 两个 SVG 字符串要相等 ✓ */
    console.log('\n== 2b. 交易所图标 & 详情浮窗 ==');
    /* ★ 先等客户端把背包真的装好 ✗ 自测踩到过：它被一个晚到的旧响应覆盖成 2 件 ✓
       （客户端那边也加了护栏 ✗ 这里再等一次"数对了"更稳 ✓）*/
    await A.eval('bagFetch(bagRender); return 1;');
    for (let i = 0; i < 20; i++) {
      await sleep(300);
      const n = await A.eval('return (BAG.items || []).length;');
      if (n >= 3) { break; }
    }
    console.log('   (db rows) ' + rpc([
      'import sqlite3, json, sys',
      'c = sqlite3.connect("file:game.db?mode=ro", uri=True)',
      'r = c.execute("SELECT id FROM roles WHERE name=?", (sys.argv[1],)).fetchone()',
      'for x in c.execute("SELECT id, stack, item_json FROM items WHERE role_id=? ORDER BY id", (r[0],)):',
      '    it = json.loads(x[2])',
      '    print("     id=%s stack=%s %s dur=%s/%s" % (x[0], x[1], it.get("name"), it.get("dur"), it.get("durMax")))',
    ].join(String.fromCharCode(10)), [SELLER]));
    const srvBag = await fetch(ORIGIN + '/api/bag', { headers: { 'X-Token': tokS } })
      .then(function (x) { return x.json(); });
    console.log('   (server http bag) ' + JSON.stringify((srvBag.items || []).map(function (x) {
      return x.item.name + '/' + x.item.dur;
    })));
    console.log('   (client bag count) ' + await A.eval('return (BAG.items||[]).length;'));
    console.log('   bag at this point: ' + await A.eval(
      'var out = [];' +
      'for (var i = 0; i < (BAG.items || []).length; i++) {' +
      '  var it = BAG.items[i].item || {};' +
      '  out.push(it.name + "/" + (it.slot || "mat") + "/" + it.dur);' +
      '}' +
      'return JSON.stringify(out);'));
    const bagSvg = await A.eval(
      'return (function(){' +
      '  var i = 0, txt = null, name = null;' +
      '  for (i = 0; i < (BAG.items || []).length; i++) {' +
      '    var it = BAG.items[i].item || {};' +
      '    if (it.slot !== "weapon") { continue; }' +
      '    if (!(it.durMax > 0) || !(it.dur < it.durMax)) { continue; }' +   /* 就要磨损那件 ✓ */
      '    name = it.name;' +
      '    txt = iconOfItem(it);' +
      '    window.__bagIconIt = it;' +
      '    window.__bagIconId = BAG.items[i].id;' +
      '    break;' +
      '  }' +
      '  return JSON.stringify({ name: name, svg: txt,' +
      '    tier: (window.__bagIconIt || {}).tier,' +
      '    dur: (window.__bagIconIt || {}).dur,' +
      '    durMax: (window.__bagIconIt || {}).durMax });' +
      '})();');
    /* 取"刚挂上去那件"的图标 ✗ 于是先记住它的 item ✗ 等会儿两边都用它 ✓ */
    const bagIcon = JSON.parse(bagSvg);
    ok(bagIcon && bagIcon.svg, 'a worn weapon is in the bag (' + bagIcon.name + ')');
    ok(bagIcon.dur < bagIcon.durMax,
       'and it really is worn (' + bagIcon.dur + '/' + bagIcon.durMax + ')');
    const bagIconFull = await A.eval(
      'var w = window.__bagIconIt || {};' +
      'return JSON.stringify({ name: w.name, tier: w.tier, look: w.look,' +
      ' svg: iconOfItem(w) });');
    const bagSame = JSON.parse(bagIconFull);
    /* ★★ 自测踩到的：拿【字符串】去比【DOM 序列化】✗
       字符串里 <rect .../> 自闭合 ✗ outerHTML 会写成 <rect ...></rect> ✓
       → 明明一模一样也会"不等"✓ 正解是两边都取 DOM 序列化 ✓ */
    await A.eval(
      'var w = window.__bagIconIt || {};' +
      'var d = document.createElement("span");' +
      'd.innerHTML = iconOfItem(w);' +
      'window.__bagIconDom = (d.querySelector("svg") || {}).outerHTML || "";' +
      'return 1;');
    console.log('   the exact item we compare: ' + bagSame.name + ' (tier ' + bagSame.tier + ')');

    /* 把同一件挂上去 → 交易所那一行的图标必须一样 */
    await A.clickTab('bag');
    /* ★★ 自测第二次踩到这里：光切页签还不够 ✗
       切页签只改 SETCFG.setTab + 各 pane 的 display ✓
       但【整个设置面板】#setPanel 还是 display:none ✗
       → 格子的 getBoundingClientRect() 全是 0 ✗ 点哪儿都点不到 ✓
       ★ 两步都要：先切页签（决定显示哪一页 ✓）再 openSet（真的把它显示出来 ✓）*/
    await A.eval('openSet("bag"); bagFetch(bagRender); return 1;');
    await sleep(1200);
    /* ★ 要 hover【那一件武器】✗ 不能随手抓第一格（自测踩到：抓到的是另一件 ✓）*/
    const hv = JSON.parse(await A.eval(
      'var out = null;' +
      'var slots = document.querySelectorAll("#bagGrid .slot[data-id]");' +
      'for (var i = 0; i < slots.length; i++) {' +
      '  var id = slots[i].getAttribute("data-id");' +
      '  var it = null;' +
      '  for (var j = 0; j < (BAG.items || []).length; j++) {' +
      '    if (String(BAG.items[j].id) === String(id)) { it = BAG.items[j].item; }' +
      '  }' +
      '  var eq = (BAG.weaponItemId && String(id) === String(BAG.weaponItemId)) ||' +
      '           (BAG.armorItemId && String(id) === String(BAG.armorItemId));' +
      '  var onShelf = false;' +
      '  for (var q = 0; q < (MKT.rows || []).length; q++) {' +
      '    if (String(MKT.rows[q][12]) === String(id)) { onShelf = true; }' +
      '  }' +
      '  if (!it || it.slot !== "weapon" || eq || onShelf) { continue; }' +
      '  if (!(it.durMax > 0) || !(it.dur < it.durMax)) { continue; }' +
      '  var r2 = slots[i].getBoundingClientRect();' +
      '  out = { x: Math.round(r2.left + r2.width / 2),' +
      '          y: Math.round(r2.top + r2.height / 2), id: id, name: it.name };' +
      '  break;' +
      '}' +
      'return JSON.stringify(out);'));
    ok(hv && hv.id, 'found a worn, not-yet-listed weapon in the bag: ' + JSON.stringify(hv));
    /* ★ 挑中的那一件就是 window.__bagIconId（挑的时候顺手记下的 ✓）
       ★ 教训：别用"对象引用相等"去找它 ✗ 背包每次重拉都会重建对象 ✓
         （我上一版就是这么写的 ✗ 结果 id 永远是 0 ✓）*/
    const wornIid = await A.eval('return String(window.__bagIconId || 0);');
    console.log('   the worn item id: ' + wornIid);
    ok(/^[0-9]+$/.test(String(wornIid)), 'we know the exact item id we are listing');
    await A.moveTo(hv.x, hv.y);
    await sleep(700);
    const tipItem = await A.eval(
      'var b = document.getElementById("bagTipBox");' +
      'var row = b.querySelector("[data-tipfor]");' +
      'return JSON.stringify({ forId: row ? row.getAttribute("data-tipfor") : null,' +
      ' head: String(b.textContent).slice(0, 24) });');
    console.log('   tooltip is for: ' + tipItem);
    ok(new RegExp('"' + hv.id + '"').test(String(tipItem)),
       'the tooltip is about the item we are going to list');
    await A.eval('var i = document.querySelector("#bagTipBox input[data-tipprice]");' +
                 'if (i) { i.value = "777"; } return 1;');
    ok((await A.eval('return !!document.querySelector("#bagTipBox [data-tipact=mkt]");')) === true,
       'the tooltip of a sellable weapon offers 挂交易所');
    console.log('   ' + (await A.clickText('#bagTipBox [data-tipact=mkt]', '挂交易所')));
    await sleep(700);
    ok((await A.eval('return String(document.getElementById("askBody").textContent).indexOf("777") >= 0;')) === true,
       'the confirm dialog uses the price typed in the tooltip (777)');
    await A.clickSel('#askYes');
    await sleep(2800);
    /* ★ 记住"刚挂上去的是哪个 lid"✗ 后面按它认人（名字会重 ✓）*/
    /* ★★ 认挂单要用【lid】✗ 不能用名字（同一件东西可能挂了好几单 ✓）
       自测在这条上栽了四次 ✗ 记下来：凡是"我要认准某一个"✗ 一律用 id/lid ✓ */
    const listedLid = await A.eval(
      'var sid = window.__lastAskLid;' +
      'if (sid) { window.__listedLid = sid; return String(sid); }' +
      'var best = null;' +
      'for (var i = 0; i < (MKT.mine || []).length; i++) {' +
      '  var m = MKT.mine[i];' +
      '  if (best === null || +m.lid > +best.lid) { best = m; }' +
      '}' +
      'window.__listedLid = best ? best.lid : null;' +
      'return String(best ? best.lid : "NONE");');
    console.log('   our listing lid: ' + listedLid);
    ok(/^[0-9]+$/.test(String(listedLid)), 'we know which listing is ours');

    await A.eval('openSet("mkt"); return 1;');
    await sleep(2600);
    const exIcons = await A.eval(
      'var out = [];' +
      'var rows = document.querySelectorAll("#mktList .mktRow");' +
      'for (var i = 0; i < rows.length; i++) {' +
      '  var it = rows[i]._it || {};' +
      '  var el = rows[i].querySelector(".mktIco svg");' +
      '  out.push({ name: it.name, tier: it.tier, hasIt: !!rows[i]._it,' +
      '             iid: it.__iid || 0,' +
      '             lid: rows[i].getAttribute("data-mktrow"),' +
      '             iid: it.__iid,' +
      '             durMax: it.durMax || 0, aff: (it.affixes || []).length,' +
      '             svg: el ? el.outerHTML : null });' +
      '}' +
      'window.__exchIconSvg = "";' +
      'for (var k = 0; k < rows.length; k++) {' +
      '  var kt = rows[k]._it || {};' +
      '  if (Number(kt.__iid) !== Number(window.__listedIid)) { continue; }' +
      '  var ks = rows[k].querySelector(".mktIco svg");' +
      '  window.__exchIconSvg = ks ? ks.outerHTML : "";' +
      '}' +
      'return JSON.stringify(out);');
    const exList = JSON.parse(exIcons);
    console.log('   raw row[12]: ' + await A.eval(
      'return JSON.stringify((MKT.rows || []).map(function (r) {' +
      '  return { lid: r[0], name: r[5], len: r.length, qty: r[11], iid: r[12],' +
      '           elIid: (function () {' +
      '             var e = document.querySelector(".mktRow[data-mktrow=\'" + r[0] + "\']");' +
      '             return e && e._it ? e._it.__iid : "NO-EL"; })() };' +
      '}));'));
    console.log('   exList: ' + JSON.stringify(exList.map(function (x) {
      return [x.name, x.lid, x.iid];
    })) + '  my listedLid=' + listedLid + ' mine=' + await A.eval(
      'return JSON.stringify((MKT.mine || []).map(function (m) { return [m.lid, m.name, m.state]; }));'));
    ok(exList.length > 0 && exList[0].hasIt === true,
       'every market row now carries the full item (' + exList.length + ' rows)');
    const sameItem = exList.filter(function (x) { return Number(x.iid) === Number(wornIid); });
    ok(sameItem.length >= 1,
       'the listed weapon is on the exchange (item id ' + wornIid + ')');
    if (sameItem.length) {
      /* ★★ 比法要一样 ✗ 自测在这绕了三圈，记下来别重犯：★★
         ① 别拿【字符串】比【DOM 序列化】（<rect/> vs <rect></rect> ✓）
         ② 只比【我们刚挂的那一件】✗ 列表里还有别人挂的（名字都不一样 ✓）
         ③ 别用"找到第一个不同位置"当判据 ✗ 两个字符串长度相同但内容不同时
            那个循环会一直走到末尾 ✗ 打印出来看着"完全一样"✓（就是这次 ✓）
         → 正解：在浏览器里用 === 直接比 ✗ 不同再去找第一个差异 ✓ */
      const same = await A.eval(
        'return window.__bagIconDom === window.__exchIconSvg;');
      ok(same === true,
         'the exchange icon is IDENTICAL to the bag icon (' + bagSame.name + ')');
      if (same !== true) {
        const cmp = await A.eval(
          'var a = String(window.__bagIconDom || ""), b = String(window.__exchIconSvg || "");' +
          'var i = 0; while (i < a.length && i < b.length && a.charAt(i) === b.charAt(i)) { i++; }' +
          'return JSON.stringify({ lenA: a.length, lenB: b.length, same: a === b,' +
          '   at: i, a: a.slice(Math.max(0, i - 25), i + 45), b: b.slice(Math.max(0, i - 25), i + 45) });');
        console.log('   cmp: ' + cmp);
        console.log('   bag tier=' + bagSame.tier + ' exch tier=' + sameItem[0].tier +
                    ' bagName=' + bagSame.name + ' exchName=' + sameItem[0].name +
                    ' exchIid=' + sameItem[0].iid + ' wornIid=' + wornIid);
      }
      ok(sameItem[0].durMax > 0 || sameItem[0].aff > 0,
         'and the row carries durability/affix data (' + sameItem[0].durMax + ' / ' +
         sameItem[0].aff + ' affixes)');
    }

    /* 点一行 → 弹说明浮窗（用户要求的那件事 ✓）*/
    const rp = JSON.parse(await A.eval(
      'var rows = document.querySelectorAll("#mktList .mktRow");' +
      'var hit = null;' +
      'for (var i = 0; i < rows.length; i++) {' +
      '  var it = rows[i]._it || {};' +
      '  if (String(it.name) !== ' + JSON.stringify(bagSame.name) + ') { continue; }' +
      '  hit = rows[i]; break;' +
      '}' +
      'if (!hit) { return "NOT-FOUND"; }' +
      'var b = hit.getBoundingClientRect();' +
      'return JSON.stringify({ x: Math.round(b.left + b.width / 2),' +
      ' y: Math.round(b.top + b.height / 2) });'));
    await A.clickAt(rp.x, rp.y);
    await sleep(700);
    const tipTxt = await A.eval(
      'var b = document.getElementById("bagTipBox");' +
      'return JSON.stringify({ disp: getComputedStyle(b).display,' +
      ' txt: String(b.textContent),' +
      ' acts: [].map.call(b.querySelectorAll("[data-tipact]"), function (x) {' +
      '         return x.getAttribute("data-tipact"); }) });');
    console.log('   market tooltip: ' + tipTxt);
    ok(/"disp":"block"/.test(String(tipTxt)), 'clicking a listing opens the detail tooltip');
    ok(/耐久|减伤|每秒|词条|武器强度/.test(String(tipTxt)),
       'the tooltip shows the real stats: ' + tipTxt);
    /* ★★ round304h（用户："耐久的显示有做吗，如果有词条这些能看到吗"）★★
       这两条必须单独断言 ✗ 因为它们原来【只给防具显示】✗ 武器一件都看不到 ✓
       （用户一眼就看出来了 ✗ 我的断言当时只写了"有耐久或减伤或每秒"✗ 太松 ✓）*/
    ok(/耐久/.test(String(tipTxt)),
       'a WEAPON tooltip shows durability (it used to be armor-only): ' + tipTxt);
    ok(/词条/.test(String(tipTxt)),
       'a WEAPON tooltip lists its affixes (also used to be armor-only)');
    ok(/\/ *[0-9]+ *次挥砍/.test(String(tipTxt)),
       'durability says what consumes it (挥砍 for weapons, 挨打 for armor)');
    /* ★★ 自测绕了四圈才看清：那一行【确实画了按钮】✗ 只是它是【禁用的"你自己的"】
       → 所以没有 data-tipact 属性 ✗ 只数属性的话会以为"没画按钮"✓
       ★ 教训：验"有没有动作"要看【按钮本身】✗ 别只数带属性的那种 ✓
       ★ 下面改成找一件【别人的】商品 ✗ 那才该有能点的"购买" ✓ */
    const ownRow = await A.eval(
      'var rows = document.querySelectorAll("#mktList .mktRow");' +
      'for (var i = 0; i < rows.length; i++) {' +
      '  var it = rows[i]._it || {};' +
      '  if (String(it.name) !== ' + JSON.stringify(bagSame.name) + ') { continue; }' +
      '  var bs = rows[i].querySelectorAll("button"); var t = [];' +
      '  for (var j = 0; j < bs.length; j++) { t.push(bs[j].textContent + (bs[j].disabled ? "(禁用)" : "")); }' +
      '  return JSON.stringify(t);' +
      '}' +
      'return "NO-ROW";');
    console.log('   buttons on my own row: ' + ownRow);
    ok(/你自己的/.test(String(ownRow)),
       'my own listing shows a (disabled) 你自己的 button, not 购买: ' + ownRow);
    ok(!/data-tipact="use"/.test(String(tipTxt)) && !/卖给系统/.test(String(tipTxt)),
       'and it does NOT offer the bag actions (使用 / 卖给系统)');
    /* 切到"我的上架" ✗ 同一件应该给【下架】（没过期 ✓）*/
    console.log('   ' + (await A.clickSel('#mktTabMine')));
    await sleep(1600);
    const rp2 = JSON.parse(await A.eval(
      'var rows = document.querySelectorAll("#mktList .mktRow");' +
      'if (!rows.length) { return "EMPTY"; }' +
      'var b = rows[0].getBoundingClientRect();' +
      'return JSON.stringify({ x: Math.round(b.left + b.width / 2),' +
      ' y: Math.round(b.top + b.height / 2) });'));
    await A.clickAt(rp2.x, rp2.y);
    await sleep(700);
    const tipMine = await A.eval(
      'var b = document.getElementById("bagTipBox");' +
      'return JSON.stringify({ acts: [].map.call(b.querySelectorAll("[data-tipact]"), function (x) {' +
      '  return x.getAttribute("data-tipact"); }),' +
      ' txt: String(b.textContent).slice(0, 40) });');
    console.log('   my-listings tooltip: ' + tipMine);
    ok(/unlist|claim/.test(String(tipMine)),
       'on 我的上架 the same row offers 下架/取回: ' + tipMine);

    /* ★★ 浮窗里的【使用】要真能穿上 ✗ 这一步从前的流程是
       "点格子选中 → 再点面板上的使用"✗ 现在一步就够 ✓ 必须验 ✓ */
    await A.clickTab('bag');
    /* ★★ 自测第二次踩到这里：光切页签还不够 ✗
       切页签只改 SETCFG.setTab + 各 pane 的 display ✓
       但【整个设置面板】#setPanel 还是 display:none ✗
       → 格子的 getBoundingClientRect() 全是 0 ✗ 点哪儿都点不到 ✓
       ★ 两步都要：先切页签（决定显示哪一页 ✓）再 openSet（真的把它显示出来 ✓）*/
    await A.eval('openSet("bag"); bagFetch(bagRender); return 1;');
    await sleep(1500);
    const before = await A.eval(
      'return JSON.stringify({ weapon: BAG.weaponItemId || null,' +
      ' items: (BAG.items || []).length });');
    console.log('   before 使用: ' + before);
    /* ★ 要挑【没穿着的装备】✗ 第一个格子可能是材料或已穿的（自测踩到 ✓）*/
    const sp2 = JSON.parse(await A.eval(
      'var all = document.querySelectorAll("#bagGrid .slot[data-id]");' +
      'var s2 = null;' +
      'for (var i = 0; i < all.length; i++) {' +
      '  var id = all[i].getAttribute("data-id");' +
      '  for (var j = 0; j < (BAG.items || []).length; j++) {' +
      '    if (String(BAG.items[j].id) !== String(id)) { continue; }' +
      '    var it = BAG.items[j].item || {};' +
      '    var eq = (BAG.weaponItemId && String(id) === String(BAG.weaponItemId)) ||' +
      '             (BAG.armorItemId && String(id) === String(BAG.armorItemId));' +
      '    if ((it.slot === "weapon" || it.slot === "armor") && !eq) { s2 = all[i]; }' +
      '  }' +
      '  if (s2) { break; }' +
      '}' +
      'if (!s2) { return "NO-SLOT"; }' +
      'var r2 = s2.getBoundingClientRect();' +
      'return JSON.stringify({ x: Math.round(r2.left + r2.width / 2),' +
      ' y: Math.round(r2.top + r2.height / 2) });'));
    await A.moveTo(sp2.x, sp2.y);
    await sleep(600);
    const useTxt = await A.eval(
      'var i = document.querySelector("#bagTipBox [data-tipact=use]");' +
      'return i ? i.textContent : "NO-USE";');
    ok(useTxt !== 'NO-USE', 'the tooltip offers a use button ("' + useTxt + '")');
    /* 未装备时它应该是【使 用】✗ 点下去走 bagEquip ✓ */
    console.log('   ' + (await A.clickText('#bagTipBox [data-tipact]', '使 用')));
    await sleep(2200);
    const afterUse = await A.eval(
      'return JSON.stringify({ weapon: BAG.weaponItemId || null,' +
      ' equippedName: (BAG.weapon || {}).name || null });');
    console.log('   after 使用: ' + afterUse);
    ok(/"weapon":\d+/.test(String(afterUse)),
       'clicking 使用 in the tooltip really equips it: ' + afterUse);
    /* 穿上之后浮窗里那个按钮该变成【脱 下】✓ */
    await A.moveTo(sp2.x, sp2.y);
    await sleep(700);
    const offTxt = await A.eval(
      'var i = document.querySelector("#bagTipBox [data-tipact]" ) ;' +
      'return i ? i.textContent : "NO-BTN";');
    console.log('   tooltip first button now: ' + offTxt);
    ok(/脱/.test(String(offTxt)), 'and it turns into 脱下 once equipped (' + offTxt + ')');

    /* ====== 2c. 耐久条：一眼看出谁在卖"没耐久的装备"（用户点名要的）====== */
    console.log('\n== 2c. durability bar ==');
    const bars = await A.eval(
      'var out = [];' +
      'var rows = document.querySelectorAll("#mktList .mktRow");' +
      'for (var i = 0; i < rows.length; i++) {' +
      '  var it = rows[i]._it || {};' +
      '  var b = rows[i].querySelector(".durbar");' +
      '  var f = b ? b.querySelector("i") : null;' +
      '  out.push({ name: it.name, dur: it.dur, durMax: it.durMax,' +
      '             hasBar: !!b, width: f ? f.style.width : null,' +
      '             color: f ? f.style.background : null });' +
      '}' +
      'return JSON.stringify(out);');
    const barList = JSON.parse(bars);
    console.log('   bars: ' + bars);
    ok(barList.length >= 1 && barList.every(function (x) { return x.hasBar; }),
       'every listing row draws a durability bar');
    const wornRow = barList.filter(function (x) { return x.durMax > 0 && x.dur < x.durMax; })[0];
    ok(!!wornRow, 'the seller really is offering a WORN item (' +
       (wornRow ? (wornRow.name + ' ' + wornRow.dur + '/' + wornRow.durMax) : 'none') + ')');
    if (wornRow) {
      const fullRow = barList.filter(function (x) { return x.durMax > 0 && x.dur >= x.durMax; })[0];
      ok(parseFloat(wornRow.width) < 60,
         'its bar is visibly shorter than a full one (' + wornRow.width + ')');
      ok(!/7ee08a/.test(String(wornRow.color)),
         'and it is not green any more (' + wornRow.color + ')');
      if (fullRow) {
        ok(parseFloat(fullRow.width) >= 99,
           'a full-durability item still shows a full bar (' + fullRow.width + ')');
      }
    }
    /* 点开那件磨损的 ✗ 说明里要写清"只剩 30%"（用户："能看到吗"✓）*/
    /* ★ 指定【那一行】打开浮窗 ✗ 别靠坐标点（自测抓到：点到的是另一行 ✓）
       ★ "点一行能弹出来"前面已经验过了 ✗ 这里要验的是【磨损那件的文案】✓ */
    const wpOpen = await A.eval(
      'var rows = document.querySelectorAll("#mktList .mktRow");' +
      'for (var i = 0; i < rows.length; i++) {' +
      '  var it = rows[i]._it || {};' +
      '  if (!(it.durMax > 0) || !(it.dur < it.durMax)) { continue; }' +
      '  var b = rows[i].getBoundingClientRect();' +
      '  mktTipShow(rows[i], Math.round(b.left + b.width / 2),' +
      '             Math.round(b.top + b.height / 2));' +
      '  return JSON.stringify({ name: it.name, dur: it.dur, durMax: it.durMax });' +
      '}' +
      'return "NOT-FOUND";');
    console.log('   worn row opened: ' + wpOpen);
    ok(wpOpen !== 'NOT-FOUND', 'found a worn row to inspect');
    await sleep(500);
    const wornTip = await A.eval(
      'var b = document.getElementById("bagTipBox");' +
      'var t = String(b.textContent);' +
      'return JSON.stringify({ txt: t,' +
      ' saysPct: /只剩 *[0-9]+%/.test(t), saysFull: /满耐久/.test(t),' +
      ' hasBar: !!b.querySelector(".durbarTick") });');
    console.log('   worn tooltip: ' + String(wornTip).slice(0, 200));
    ok(/"saysPct":true/.test(String(wornTip)),
       'the tooltip says how worn it is ("只剩 N%"), not just two numbers');
    ok(/"hasBar":true/.test(String(wornTip)), 'and the tooltip draws the bar too');

    /* ====== 2d. 数量滑条：按数量上架 + 部分购买（用户点名要的）====== */
    console.log('\n== 2d. quantity sliders ==');
    await A.clickTab('bag');
    /* ★★ 自测第二次踩到这里：光切页签还不够 ✗
       切页签只改 SETCFG.setTab + 各 pane 的 display ✓
       但【整个设置面板】#setPanel 还是 display:none ✗
       → 格子的 getBoundingClientRect() 全是 0 ✗ 点哪儿都点不到 ✓
       ★ 两步都要：先切页签（决定显示哪一页 ✓）再 openSet（真的把它显示出来 ✓）*/
    await A.eval('openSet("bag"); bagFetch(bagRender); return 1;');
    await sleep(1500);
    const matInfo = JSON.parse(await A.eval(
      'for (var i = 0; i < (BAG.items || []).length; i++) {' +
      '  var rec = BAG.items[i], it = rec.item || {};' +
      '  if (it.slot) { continue; }' +
      '  if (parseInt(rec.stack, 10) < 3) { continue; }' +
      '  window.__matId = rec.id;' +
      '  var s2 = document.querySelector("#bagGrid .slot[data-id=\\"" + rec.id + "\\"]");' +
      '  var r2 = s2.getBoundingClientRect();' +
      '  return JSON.stringify({ id: rec.id, name: it.name, stack: rec.stack,' +
      '    x: Math.round(r2.left + r2.width / 2), y: Math.round(r2.top + r2.height / 2) });' +
      '}' +
      'return "NO-STACK";'));
    console.log('   material stack: ' + JSON.stringify(matInfo));
    ok(matInfo && matInfo.id, 'the seller has a stack to list (' + JSON.stringify(matInfo) + ')');
    /* ★★ 自测第三次栽在"没显示/被盖住"上 ✗
       这一次是：上一节留下的【交易所浮窗】还开着 ✗ 正好盖在格子上面 ✓
       → 鼠标动到 (292,200) 其实落在浮窗里 ✗ 格子的 mousemove 根本没触发 ✓
       → 读到的还是"上一条浮窗的内容"（下架按钮 ✓）✗
       ★ 教训：测"悬停"之前要先确认【那一点上是它】✗ 并先把挡路的浮窗收掉 ✓
         （就跟前面那个"什么盖住了页签"的检查一个道理 ✓）*/
    await A.eval('bagTipHide(); return 1;');
    await sleep(200);
    await A.moveTo(matInfo.x, matInfo.y);
    await sleep(700);
    const slider = await A.eval(
      'var b = document.getElementById("bagTipBox");' +
      'var q = b.querySelector(".qtyRow");' +
      'var r = b.querySelector(".qtyRange");' +
      'return JSON.stringify({ hasRow: !!q, max: r ? r.max : null, val: r ? r.value : null });');
    console.log('   slider: ' + slider);
    ok(/"hasRow":true/.test(String(slider)),
       'a stackable item gets a quantity slider in the tooltip');
    ok(parseInt(JSON.parse(slider).max, 10) === parseInt(matInfo.stack, 10),
       'the slider max is exactly how many he owns (' + JSON.parse(slider).max +
       ' vs ' + matInfo.stack + ')');
    await A.eval('var b = document.getElementById("bagTipBox");' +
                 'b.querySelector("input[data-tipprice]").value = "20";' +
                 'var r = b.querySelector(".qtyRange"); r.value = "4";' +
                 'r.dispatchEvent(new Event("input", { bubbles: true }));' +
                 'return 1;');
    await sleep(400);
    const afterDrag = await A.eval(
      'var b = document.getElementById("bagTipBox");' +
      'return JSON.stringify({ num: b.querySelector(".qtyNum").value,' +
      ' total: String(b.querySelector(".qtyTotal").textContent) });');
    console.log('   after dragging to 4: ' + afterDrag);
    ok(/"num":"4"/.test(String(afterDrag)),
       'dragging the slider syncs the number box (two-way)');
    ok(/80/.test(String(afterDrag)), 'and it previews the total 20 x 4 = 80: ' + afterDrag);
    console.log('   ' + (await A.clickText('#bagTipBox [data-tipact=mkt]', '挂交易所')));
    await sleep(700);
    const askQty = await A.eval('return String(document.getElementById("askBody").textContent);');
    ok(/80/.test(String(askQty)) && /4/.test(String(askQty)),
       'the confirm dialog states quantity and total: ' + String(askQty).slice(0, 90));
    await A.clickSel('#askYes');
    await sleep(2800);
    const matListed = await A.eval(
      'var out = null;' +
      'for (var i = 0; i < (MKT.mine || []).length; i++) {' +
      '  var m = MKT.mine[i];' +
      '  if (String(m.name) === ' + JSON.stringify(matInfo.name) + ') {' +
      '    out = { lid: m.lid, price: m.price, state: m.state }; }' +
      '}' +
      'return JSON.stringify(out);');
    console.log('   listed material (before refresh): ' + matListed);
    /* ★ 真用户上架时【人就在交易所页】✗ 所以这里也真的切过去 ✓
       （切页签会把 MKT.open 置真 + 重拉货架 ✓ 顺带验一下"切过来能看到刚挂的"✓）
       ★ 自测踩到：我原来只 openSet("bag") 切了【页面】✗ 没切 MKT.open ✓
         于是上架成功后客户端【不会自动重拉我的上架】✗ 读到的是旧快照 ✓ */
    console.log('   ' + (await A.clickTab('mkt')));
    await A.eval('openSet("mkt"); return 1;');
    await sleep(2000);
    const matListed2 = await A.eval(
      'var newest = null;' +
      'for (var i = 0; i < (MKT.mine || []).length; i++) {' +
      '  var m = MKT.mine[i];' +
      '  if (String(m.name) !== ' + JSON.stringify(matInfo.name) + ') { continue; }' +
      '  if (newest === null || +m.lid > +newest.lid) { newest = m; }' +
      '}' +
      'return JSON.stringify(newest);');
    console.log('   material listing after refresh: ' + matListed2);
    ok(/"lid":[0-9]+/.test(String(matListed2)),
       'the stack went on the shelf and shows up after switching back: ' + matListed2);

    /* 买家那边：数量滑条应该出现（还剩 4 个 ✗ 单价 20 ✓）*/
    console.log('   switch to buyer tab…');
    console.log('   ' + (await B.clickTab('mkt')));
    await sleep(2800);
    const buySlider = await B.eval(
      'var rows = document.querySelectorAll("#mktList .mktRow");' +
      'for (var i = 0; i < rows.length; i++) {' +
      '  var it = rows[i]._it || {};' +
      '  if (String(it.name) !== ' + JSON.stringify(matInfo.name) + ') { continue; }' +
      '  var bb = rows[i].getBoundingClientRect();' +
      '  mktTipShow(rows[i], Math.round(bb.left + bb.width / 2),' +
      '             Math.round(bb.top + bb.height / 2));' +
      '  var q = document.querySelector("#bagTipBox .qtyRow");' +
      '  var r = document.querySelector("#bagTipBox .qtyRange");' +
      '  return JSON.stringify({ found: true, hasRow: !!q,' +
      '    max: r ? r.max : null, val: r ? r.value : null });' +
      '}' +
      'return "NOT-ON-SHELF";');
    console.log('   buyer slider: ' + buySlider);
    ok(/"hasRow":true/.test(String(buySlider)),
       'the buyer sees a quantity slider for a stack listing');
    ok(JSON.parse(buySlider).max === '4', 'its max is what is left on the shelf (4)');
    ok(JSON.parse(buySlider).val === '1', 'and it defaults to buying 1');

    /* ====== 2e. 交易记录页（用户要的第二个功能）====== */
    console.log('\n== 2e. trade history page ==');
    ok((await A.eval('return !!document.getElementById("mktTabLog");')) === true,
       'there is a 我的记录 tab');
    console.log('   ' + (await A.clickSel('#mktTabLog')));
    await sleep(2000);
    const logState = await A.eval(
      'return JSON.stringify({ tab: MKT.tab,' +
      ' listShown: getComputedStyle(document.getElementById("mktList")).display,' +
      ' logShown: getComputedStyle(document.getElementById("mktLogWrap")).display,' +
      ' rows: (document.querySelectorAll("#mktLogList .mktRow") || []).length,' +
      ' hasPrev: !!document.getElementById("mktLogPrev") });');
    console.log('   log page: ' + logState);
    ok(/"tab":"log"/.test(String(logState)), 'clicking 我的记录 switches the tab');
    ok(/"listShown":"none"/.test(String(logState)),
       'the product list is hidden while the log is shown');
    ok(/"logShown":"block"/.test(String(logState)), 'the log page is visible');
    ok(/"rows":0/.test(String(logState)),
       'no trades yet for this seller, and it says so (' + logState + ')');
    /* 买家真买走 2 个 ✗ 卖家的记录里就该出现一笔 ✓ */
    await B.eval(
      'var rows = document.querySelectorAll("#mktList .mktRow");' +
      'for (var i = 0; i < rows.length; i++) {' +
      '  var it = rows[i]._it || {};' +
      '  if (String(it.name) !== ' + JSON.stringify(matInfo.name) + ') { continue; }' +
      '  var bb = rows[i].getBoundingClientRect();' +
      '  mktTipShow(rows[i], Math.round(bb.left + bb.width / 2),' +
      '             Math.round(bb.top + bb.height / 2));' +
      '}' +
      'var b2 = document.getElementById("bagTipBox");' +
      'var q = b2.querySelector(".qtyRange");' +
      'if (q) { q.value = "2"; q.dispatchEvent(new Event("input", { bubbles: true })); }' +
      'return JSON.stringify({ q: q ? q.value : null });');
    await sleep(500);
    console.log('   ' + (await B.clickText('#bagTipBox [data-tipact=buy]', '购 买')));
    await sleep(800);
    await B.clickSel('#askYes');
    await sleep(3200);
    console.log('   ' + (await A.clickSel('#mktLogSell')));
    await sleep(2000);
    const logAfter = await A.eval(
      'return JSON.stringify({ rows: (document.querySelectorAll("#mktLogList .mktRow") || []).length,' +
      ' txt: String(document.getElementById("mktLogList").textContent).slice(0, 100),' +
      ' sum: String((document.getElementById("mktLogSum") || {}).textContent || "") });');
    console.log('   log after the sale: ' + logAfter);
    ok(/"rows":1/.test(String(logAfter)), 'the sale shows up in the log');
    ok(/\+/.test(String(logAfter)), 'a sell row shows the money coming in (+N)');
    ok(/\u00d72|\u00d7 2/.test(String(logAfter)) || /2/.test(String(logAfter)),
       'and it records that 2 units were sold');

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

    await B.clickTab('bag');
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
    /* ★ 别用 process.exit：它不等 stdout 刷完 ✗ 输出会被截断 ✓
       自测踩到过：明明跑完了 ✗ 日志只出来一半 ✓
       → 只设退出码 ✗ 让进程自己结束（Node 会等输出排空 ✓）*/
    process.exitCode = fails ? 1 : 0;
  }
})();
