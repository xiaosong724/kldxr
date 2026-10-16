// diag_sell_batch.js -- drive the BATCH SELL UI in a real Chromium.
//
// round303. Why a separate tool: the feature is mostly client-side (checkboxes,
// batch mode, the confirm dialog), and the previous session's lesson was that
// "it looks right in the source" is not evidence. This clicks the real buttons.
//
// Self-contained: registers a disposable role, gives it items, drives the UI,
// then erases the role. Read-only with respect to game source.
//
// Run:  node tools/diag_sell_batch.js      (server must be up)

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ORIGIN = process.env.PAGE || 'http://127.0.0.1:8899';
const ADMIN_PW = process.env.ADMIN_PW || 'xiuxian-admin';
const PW = 'abc123456';
let ROLE = 'BatchUI';

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
  constructor(port) { this.port = port; this.seq = 0; this.waiting = {}; this.reqs = []; this.errs = []; }
  async start() {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx2d-batch-'));
    this.proc = spawn(BROWSER, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
      '--no-default-browser-check', '--disable-extensions',
      '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
      '--user-data-dir=' + this.dir, '--remote-debugging-port=' + this.port,
      '--window-size=1000,760', ORIGIN + '/',
    ], { stdio: 'ignore' });
    let target = null;
    for (let i = 0; i < 80 && !target; i++) {
      await sleep(250);
      try {
        const list = await (await fetch('http://127.0.0.1:' + this.port + '/json/list')).json();
        target = list.find(function (t) { return t.type === 'page' && t.webSocketDebuggerUrl; });
      } catch (e) { }
    }
    if (!target) { throw new Error('no debug target'); }
    this.ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise(function (res, rej) {
      this.ws.onopen = res;
      this.ws.onerror = function () { rej(new Error('devtools connect failed')); };
    }.bind(this));
    this.ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id && this.waiting[m.id]) { this.waiting[m.id](m); delete this.waiting[m.id]; return; }
      if (m.method === 'Network.requestWillBeSent') {
        const u = (m.params && m.params.request && m.params.request.url) || '';
        if (u.indexOf('/api/') >= 0) {
          let post = '';
          try { post = (m.params.request.postData || '').slice(0, 90); } catch (e) { }
          this.reqs.push(m.params.request.method + ' ' + u.replace(ORIGIN, '') + (post ? ' ' + post : ''));
        }
      }
      if (m.method === 'Log.entryAdded') {
        const e = m.params && m.params.entry;
        if (e && e.level === 'error') { this.errs.push(e.text); }
      }
    };
    this.send('Runtime.enable', {});
    this.send('Page.enable', {});
    this.send('Log.enable', {});
    this.send('Network.enable', {});
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
      expression: '(function(){' + expr + '})()', returnByValue: true,
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
    await sleep(50);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x, y: y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' });
  }
  /* real mouse click on an element found by selector */
  async clickSel(sel) {
    const pos = await this.eval(
      'var e = document.querySelector(' + JSON.stringify(sel) + ');' +
      'if (!e) { return "MISSING"; }' +
      'var r = e.getBoundingClientRect();' +
      'if (r.width < 1 || r.height < 1) { return "ZERO-SIZE"; }' +
      'if (getComputedStyle(e).display === "none") { return "HIDDEN"; }' +
      'return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });');
    if (typeof pos !== 'string' || pos.charAt(0) !== '{') { return pos; }
    const p = JSON.parse(pos);
    await this.clickAt(p.x, p.y);
    return 'clicked ' + sel + ' at ' + p.x + ',' + p.y;
  }
  kill() {
    try {
      if (process.platform === 'win32') { spawn('taskkill', ['/PID', String(this.proc.pid), '/T', '/F'], { stdio: 'ignore' }); }
      else { this.proc.kill('SIGKILL'); }
    } catch (e) { }
    try { fs.rmSync(this.dir, { recursive: true, force: true }); } catch (e) { }
  }
}

function disposableName() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  let s = 'BU';
  for (let i = 0; i < 6; i++) { s += A[Math.floor(Math.random() * A.length)]; }
  return s;
}
function rpc(py, args) {
  const tmp = path.join(os.tmpdir(), 'xx2d_b_' + Date.now() + '_' + Math.floor(Math.random() * 1e6) + '.py');
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
    '    c.execute("DELETE FROM items WHERE role_id=?", (rid,))',
    '    c.execute("DELETE FROM equipment WHERE role_id=?", (rid,))',
    '    c.execute("DELETE FROM pending_gold WHERE role=?", (rid,))',
    '    c.execute("DELETE FROM roles WHERE id=?", (rid,))',
    '    if acc:',
    '        c.execute("DELETE FROM tokens WHERE account_id=?", (acc,))',
    '        c.execute("DELETE FROM accounts WHERE id=?", (acc,))',
    '    c.commit()',
    "print('purged %s' % sys.argv[1])",
  ].join('\n'), [name]);
}
function dbGold(name) {
  return rpc([
    'import sqlite3, sys',
    'c = sqlite3.connect("file:game.db?mode=ro", uri=True)',
    'r = c.execute("SELECT gold FROM roles WHERE name=?", (sys.argv[1],)).fetchone()',
    'n = c.execute("SELECT COUNT(*) FROM items WHERE role_id=(SELECT id FROM roles WHERE name=?)", (sys.argv[1],)).fetchone()',
    'print("gold=%s items=%s" % (r[0] if r else "?", n[0] if n else "?"))',
  ].join('\n'), [name]);
}

(async function () {
  console.log('== diag_sell_batch == browser=' + BROWSER);
  const h = await fetch(ORIGIN + '/api/health').then(x => x.json()).catch(() => null);
  if (!h || !h.ok) { console.error('server not up at ' + ORIGIN); process.exit(1); }
  ROLE = disposableName();
  console.log('   disposable role: ' + ROLE);

  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PW }),
  }).then(x => x.json()).then(x => x.token).catch(() => null);
  if (!at) { console.error('admin login failed'); process.exit(1); }

  let reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: ROLE, password: PW }),
  }).then(x => x.json());
  if (!reg.token) {
    reg = await fetch(ORIGIN + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: ROLE, password: PW }),
    }).then(x => x.json());
  }
  const tok = reg.token;
  if (!tok) { console.error('no token'); process.exit(1); }

  // 3 low-tier + 2 HIGH-tier (>= 5) so the warning branch is exercised
  const give = async function (tier) {
    return fetch(ORIGIN + '/api/admin/act', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at },
      body: JSON.stringify({ act: 'give', name: ROLE, kind: 'sword', tier: tier }),
    }).then(x => x.json()).catch(() => null);
  };
  for (const t of [1, 1, 2, 5, 6]) { await give(t); }
  console.log('   gave 5 items (tiers 1,1,2,5,6)');

  const B = new Browser(9351);
  try {
    await B.start();
    await sleep(1200);
    await B.eval('localStorage.setItem("token",' + JSON.stringify(tok) + '); location.reload(); return 1;');
    let st = null;
    for (let i = 0; i < 40; i++) {
      await sleep(400);
      st = await B.eval('return JSON.stringify({ ready: (typeof WSC !== "undefined") && WSC.ready });');
      if (/"ready":true/.test(String(st))) { break; }
    }
    console.log('   in world: ' + st);
    await B.eval('openSet("bag"); bagFetch(bagRender); return 1;');
    await sleep(1600);

    const bagN = await B.eval('return (typeof BAG !== "undefined" && BAG.items) ? BAG.items.length : -1;');
    ok(bagN === 5, 'bag shows 5 items (got ' + bagN + ')');

    /* ---- single-selection highlight (the user reported it disappeared) ---- */
    console.log('\n-- click a slot in NORMAL mode: what marks it as selected? --');
    const r0 = await B.eval(
      'var s = document.querySelectorAll("#bagGrid .slot[data-id]")[0];' +
      'var r = s.getBoundingClientRect();' +
      'return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });');
    const p0 = JSON.parse(r0);
    await B.clickAt(p0.x, p0.y);
    await sleep(400);
    const selInfo = await B.eval([
      'var s = document.querySelectorAll("#bagGrid .slot[data-id]")[0];',
      'if (!s) { return "NO-SLOT"; }',
      'var cs = getComputedStyle(s);',
      'return JSON.stringify({',
      '  bagSel: (typeof BAG !== "undefined") ? BAG.sel : null,',
      '  className: s.className,',
      '  hasSelClass: s.classList.contains("sel"),',
      '  backgroundImage: cs.backgroundImage.slice(0, 80),',
      '  outline: cs.outline, boxShadow: cs.boxShadow.slice(0, 60),',
      '  borderColor: cs.borderTopColor,',
      '  inlineStyle: s.getAttribute("style") });',
    ].join('\n'));
    console.log('   ' + selInfo);
    const SI = JSON.parse(selInfo);
    ok(SI.bagSel !== null && SI.bagSel !== undefined, 'clicking a slot sets BAG.sel (' + SI.bagSel + ')');
    ok(SI.hasSelClass === true, 'the clicked slot gets the .sel class');
    /* round303b: the user reported the selection was invisible. Prove there is a mark
       that the inline tier gradient cannot override (border/outline/box-shadow). */
    const marked = (SI.outline && SI.outline.indexOf('none') < 0) ||
      (SI.boxShadow && SI.boxShadow.indexOf('inset') >= 0 && /rgb/.test(SI.boxShadow) &&
       SI.boxShadow !== 'none');
    ok(SI.outline && SI.outline.indexOf('none') < 0,
      'the selected slot has a real outline now (' + SI.outline + ')');
    ok(/255,\s*216,\s*61/.test(String(SI.borderColor)),
      'the selected slot has a gold border (' + SI.borderColor + ')');
    ok((await B.eval('return String(document.getElementById("bagPick") ? "y" : "n");')) === 'y',
      'the 批量选择 button exists in the DOM');

    // ---- enter batch mode with a REAL click ----
    console.log('\n-- enter batch mode --');
    console.log('   ' + (await B.clickSel('#bagPick')));
    await sleep(300);
    ok((await B.eval('return !!BAG.multi;')) === true, 'BAG.multi is on');
    const boxes = await B.eval('return document.querySelectorAll("#bagGrid .slot .pickbox").length;');
    ok(boxes === 5, 'a checkbox is drawn on all 5 slots (got ' + boxes + ')');

    // ---- tick exactly 3 slots that are all BELOW 5 tier, so this dialog must NOT warn ----
    console.log('\n-- tick 3 low-tier slots --');
    const lowIdx = JSON.parse(await B.eval(
      'var out = [];' +
      'for (var i = 0; i < BAG.items.length; i++) {' +
      '  var t = (((BAG.items[i].item || {}).tier) || 0) + 1;' +
      '  if (t < 5) { out.push(i); }' +
      '}' +
      'return JSON.stringify(out.slice(0, 3));'));
    console.log('   low-tier slot indexes: ' + JSON.stringify(lowIdx));
    ok(lowIdx.length === 3, 'three items below 5 tier are available');
    for (const idx of lowIdx) {
      const r = await B.eval(
        'var s = document.querySelector("#bagGrid .slot[data-i=\'' + idx + '\']");' +
        'if (!s) { return "MISSING"; }' +
        'var r = s.getBoundingClientRect();' +
        'return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });');
      const p = JSON.parse(r);
      await B.clickAt(p.x, p.y);
      await sleep(250);
    }
    const picked = await B.eval('return JSON.stringify(BAG.pick);');
    ok((await B.eval('return BAG.pick.length;')) === 3, 'exactly 3 items are ticked ' + picked);
    const btnTxt = await B.eval('return document.getElementById("bagSellMulti").textContent;');
    ok(/3/.test(String(btnTxt)), 'the button shows the count ("' + btnTxt + '")');
    ok((await B.eval('return document.getElementById("bagSellMulti").disabled;')) === false,
      'the batch button is enabled');
    const tickMarks = await B.eval('return document.querySelectorAll("#bagGrid .slot.pick").length;');
    ok(tickMarks === 3, '3 slots are visually marked (got ' + tickMarks + ')');

    // ---- batch button -> confirm dialog must appear, nothing sold yet ----
    console.log('\n-- click 批量出售 (must ask first) --');
    B.reqs.length = 0;          // fresh window: only THIS dialog's traffic counts
    console.log('   ' + (await B.clickSel('#bagSellMulti')));
    await sleep(400);
    const dlg = await B.eval(
      'var d = document.getElementById("askBox");' +
      'return JSON.stringify({ shown: d ? getComputedStyle(d).display : "none",' +
      '  title: (document.getElementById("askTitle") || {}).textContent,' +
      '  body: (document.getElementById("askBody") || {}).textContent });');
    const D = JSON.parse(dlg);
    ok(D.shown === 'flex', 'the confirm dialog is visible');
    /* NOTE: /api/sellquote is expected here (asking the price is read-only).
       Only a real POST /api/sell counts as "it sold something". */
    const soldAlready = function () {
      return B.reqs.filter(function (r) {
        return r.indexOf('/api/sell ') >= 0 && r.indexOf('/api/sellquote') < 0;
      }).length;
    };
    ok(soldAlready() === 0, 'NOTHING was sold before confirming (only the quote was asked)');
    ok(B.reqs.filter(function (r) { return r.indexOf('/api/sellquote') >= 0; }).length >= 1,
      'it asked the server for a price (read-only)');
    ok(/批量出售确认/.test(String(D.title)), 'dialog title is right ("' + D.title + '")');
    ok(/3/.test(String(D.body)), 'dialog says 3 items ("' + D.body + '")');
    ok(!/阶/.test(String(D.body)), 'no high-tier warning for 3 low-tier items ("' + D.body + '")');
    /* round303b: the user asked the confirm box to state how much this sale pays */
    ok(/本次可得/.test(String(D.body)), 'the dialog states the amount ("' + D.body + '")');
    const quoted = Number((String(D.body).match(/本次可得\s*([0-9.]+)/) || [])[1]);
    ok(quoted > 0, 'the stated amount is a real number (' + quoted + ')');
    console.log('   quoted total in dialog: ' + quoted);

    // ---- cancel keeps the items ----
    console.log('\n-- cancel must not sell --');
    console.log('   ' + (await B.clickSel('#askNo')));
    await sleep(400);
    const afterCancel = await B.eval('return JSON.stringify({ n: BAG.items.length, pick: BAG.pick.length });');
    ok(soldAlready() === 0, 'cancel sent no /api/sell');
    ok(/"n":5/.test(String(afterCancel)), 'all 5 items are still in the bag ' + afterCancel);

    // ---- confirm actually sells, and the bag refreshes by itself ----
    console.log('\n-- confirm -> sell 3 --');
    console.log('   ' + (await B.clickSel('#bagSellMulti')));
    await sleep(400);
    B.reqs.length = 0;
    console.log('   ' + (await B.clickSel('#askYes')));
    await sleep(2000);
    const sells = B.reqs.filter(function (r) {
      return r.indexOf('/api/sell ') >= 0 && r.indexOf('/api/sellquote') < 0;
    });
    ok(sells.length >= 1, 'exactly one /api/sell request: ' + JSON.stringify(sells));
    ok(sells.length === 1 && /iids/.test(sells[0]), 'it used the batch form (iids): ' + JSON.stringify(sells));
    const after = await B.eval('return JSON.stringify({ n: BAG.items.length, msg: BAG.msg });');
    ok(/"n":2/.test(String(after)), 'the bag refreshed ITSELF down to 2 items ' + after);
    const gone = await B.eval('return document.querySelectorAll("#bagGrid .slot[data-id]").length;');
    ok(gone === 2, 'the grid redrew with 2 filled slots (got ' + gone + ')');
    console.log('   db says: ' + dbGold(ROLE));

    // ---- the 5+ tier warning ----
    console.log('\n-- select the high-tier ones and check the warning --');
    await B.eval('BAG.multi = false; BAG.pick = []; BAG.sel = null; bagRender(); return 1;');
    await sleep(200);
    await B.clickSel('#bagPick');
    await sleep(250);
    // tick everything that is left (tiers 5 and 6 survive: they were not the first 3)
    // tick ONLY the high-tier ones (tier+1 >= 5), located by their data-i index
    const hiIdx = JSON.parse(await B.eval(
      'var out = [];' +
      'for (var i = 0; i < BAG.items.length; i++) {' +
      '  var t = (((BAG.items[i].item || {}).tier) || 0) + 1;' +
      '  if (t >= 5) { out.push(i); }' +
      '}' +
      'return JSON.stringify(out);'));
    console.log('   high-tier slot indexes: ' + JSON.stringify(hiIdx));
    ok(hiIdx.length >= 1, 'the bag still holds at least one 5+ tier item for this check');
    for (const idx of hiIdx) {
      const r = await B.eval(
        'var s = document.querySelector("#bagGrid .slot[data-i=\'' + idx + '\']");' +
        'if (!s) { return "MISSING"; }' +
        'var r = s.getBoundingClientRect();' +
        'return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });');
      if (String(r).indexOf('{') !== 0) { console.log('   slot ' + idx + ' -> ' + r); continue; }
      const p = JSON.parse(r);
      await B.clickAt(p.x, p.y);
      await sleep(250);
    }
    const tickedTiers = await B.eval(
      'return JSON.stringify(BAG.pick.map(function (id) {' +
      '  for (var i = 0; i < BAG.items.length; i++) {' +
      '    if (String(BAG.items[i].id) === String(id)) { return (((BAG.items[i].item || {}).tier) || 0) + 1; }' +
      '  }' +
      '  return "?";' +
      '}));');
    console.log('   ticked tiers (1-based): ' + tickedTiers);
    await B.clickSel('#bagSellMulti');
    await sleep(400);
    const dlg2 = await B.eval(
      'var d = document.getElementById("askBox");' +
      'return JSON.stringify({ shown: d ? getComputedStyle(d).display : "none",' +
      '  body: (document.getElementById("askBody") || {}).textContent });');
    const D2 = JSON.parse(dlg2);
    ok(D2.shown === 'flex', 'the dialog opened again');
    const hasWarn = await B.eval('return (document.getElementById("askBody") || {}).innerHTML || "";');
    ok(/阶/.test(String(hasWarn)), 'the dialog warns about high-tier items: ' + JSON.stringify(String(hasWarn).slice(0, 160)));
    console.log('   ' + (await B.clickSel('#askNo')));
    await sleep(300);

    console.log('\n-- page errors --');
    console.log('   ' + JSON.stringify(B.errs.slice(0, 6)));
  } finally {
    B.kill();
    console.log('   cleanup -> ' + purge(ROLE));
  }
  console.log('');
  console.log('FAILED: ' + fails);
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });
