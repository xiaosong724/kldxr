// diag_sell_btn.js -- OBSERVE-ONLY diagnostic for the "sell button does nothing" bug.
//
// round301. Why this file exists: the previous session guessed at the cause 5+ times
// and burned the user's patience. This runs a REAL Chromium (same engine as the user's
// browser), logs in as a throwaway test account, opens the bag, selects an item and
// then looks at the button with the SAME two console probes the handover document
// suggests -- plus a real CDP mouse click and a Network.requestWillBeSent watch.
//
// It changes no game source. It only reads.
//
// Usage:  node tools/diag_sell_btn.js [roleName]
//   needs the local server up (python app.py) -- http://127.0.0.1:8899

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ORIGIN = process.env.PAGE || 'http://127.0.0.1:8899';
const PAGE = ORIGIN + '/';
const ADMIN_PW = process.env.ADMIN_PW || 'xiuxian-admin';
let ROLE = process.argv[2] || 'DBtmp';
const PW = 'abc123456';

const CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const BROWSER = CANDIDATES.find(function (p) { try { return fs.existsSync(p); } catch (e) { return false; } });
if (!BROWSER) { console.error('no Chrome/Edge found; set CHROME='); process.exit(1); }

const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

class Browser {
  constructor(port) { this.port = port; this.seq = 0; this.waiting = {}; this.reqs = []; this.errs = []; }
  async start() {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx2d-diag-'));
    this.proc = spawn(BROWSER, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
      '--no-default-browser-check', '--disable-extensions',
      '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
      '--user-data-dir=' + this.dir,
      '--remote-debugging-port=' + this.port,
      '--window-size=1000,700',
      PAGE,
    ], { stdio: 'ignore' });
    let target = null;
    for (let i = 0; i < 80 && !target; i++) {
      await sleep(250);
      try {
        const r = await fetch('http://127.0.0.1:' + this.port + '/json/list');
        const list = await r.json();
        target = list.find(function (t) { return t.type === 'page' && t.webSocketDebuggerUrl; });
      } catch (e) { }
    }
    if (!target) { throw new Error('debug port never came up'); }
    this.ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise(function (res, rej) {
      this.ws.onopen = res;
      this.ws.onerror = function () { rej(new Error('devtools connect failed')); };
    }.bind(this));
    this.ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id && this.waiting[m.id]) { this.waiting[m.id](m); delete this.waiting[m.id]; return; }
      if (m.method === 'Network.requestWillBeSent') {
        const u = m.params && m.params.request && m.params.request.url || '';
        if (u.indexOf('/api/') >= 0) { this.reqs.push((m.params.request.method || '?') + ' ' + u); }
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params && m.params.exceptionDetails;
        this.errs.push(String((d && d.exception && d.exception.description) || (d && d.text) || '?').split('\n')[0]);
      }
      if (m.method === 'Log.entryAdded') {
        const e = m.params && m.params.entry;
        if (e && e.level === 'error') { this.errs.push('[log] ' + e.text); }
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
      expression: '(function(){' + expr + '})()', returnByValue: true, awaitPromise: false,
    });
    if (!r) { return undefined; }
    if (r.result && r.result.exceptionDetails) {
      const d = r.result.exceptionDetails;
      return '__THROW__ ' + String((d.exception && d.exception.description) || d.text);
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  }
  async evalAwait(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: '(async function(){' + expr + '})()', returnByValue: true, awaitPromise: true,
    });
    if (!r) { return undefined; }
    if (r.result && r.result.exceptionDetails) {
      const d = r.result.exceptionDetails;
      return '__THROW__ ' + String((d.exception && d.exception.description) || d.text);
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  }
  async mouse(type, x, y) {
    return this.send('Input.dispatchMouseEvent', {
      type: type, x: x, y: y, button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: type === 'mousePressed' ? 1 : 1, pointerType: 'mouse',
    });
  }
  kill() {
    try {
      if (process.platform === 'win32') { spawn('taskkill', ['/PID', String(this.proc.pid), '/T', '/F'], { stdio: 'ignore' }); }
      else { this.proc.kill('SIGKILL'); }
    } catch (e) { }
    try { fs.rmSync(this.dir, { recursive: true, force: true }); } catch (e) { }
  }
}

async function adminToken() {
  const r = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PW }),
  }).then(x => x.json()).catch(() => null);
  if (!r || !r.ok) { throw new Error('admin login failed: ' + JSON.stringify(r)); }
  return r.token;
}
async function roleToken(name) {
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, password: PW }),
  }).then(x => x.json()).catch(() => ({}));
  if (reg && reg.token) { return reg.token; }
  const lo = await fetch(ORIGIN + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, password: PW }),
  }).then(x => x.json()).catch(() => ({}));
  return lo && lo.token;
}

/* This tool is a THROWAWAY account tool: it registers a disposable role, drives the UI
   with it, then erases every trace (items / equipment / role / account / token).
   Leaving test accounts in the real db is exactly the kind of mess the previous session
   was told off for. Names must match NAME_RE = ^[0-9A-Za-z_\u4e00-\u9fa5-]{2,10}$ */
const DISPOSABLE = !process.argv[2];
function disposableName() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  let s = 'DB';
  for (let i = 0; i < 6; i++) { s += A[Math.floor(Math.random() * A.length)]; }
  return s;                       // 8 chars, inside the 2..10 limit
}
/* read one role row straight from sqlite (read-only) so we can prove what was PERSISTED */
function dbRoleGold(name) {
  const py = [
    'import sqlite3, sys',
    'c = sqlite3.connect("file:game.db?mode=ro", uri=True)',
    'r = c.execute("SELECT gold FROM roles WHERE name=?", (sys.argv[1],)).fetchone()',
    'p = c.execute("SELECT COUNT(*) FROM pending_gold WHERE role=(SELECT id FROM roles WHERE name=?) AND done=0", (sys.argv[1],)).fetchone()',
    'q = c.execute("SELECT COUNT(*) FROM pending_gold WHERE role=(SELECT id FROM roles WHERE name=?) AND done=1", (sys.argv[1],)).fetchone()',
    'print("gold=%s pending0=%s pending1=%s" % (r[0] if r else "NOROLE", p[0] if p else "?", q[0] if q else "?"))',
    'c.close()',
  ].join('\n');
  const tmp = path.join(os.tmpdir(), 'xx2d_gold_' + Date.now() + '.py');
  fs.writeFileSync(tmp, py);
  const { spawnSync } = require('child_process');
  const r = spawnSync('python', [tmp, name], { cwd: path.join(__dirname, '..', 'server'), encoding: 'utf8' });
  try { fs.rmSync(tmp, { force: true }); } catch (e) { }
  return ((r.stdout || '').trim()) || ((r.stderr || '').trim());
}

async function purgeRole(name) {
  const py = [
    'import sqlite3, sys',
    'name = sys.argv[1]',
    "c = sqlite3.connect('game.db', timeout=6)",
    'row = c.execute("SELECT id, account_id FROM roles WHERE name=?", (name,)).fetchone()',
    'if not row:',
    "    print('purge: no such role ' + name); sys.exit(0)",
    'rid, acc = row',
    'n1 = c.execute("DELETE FROM items WHERE role_id=?", (rid,)).rowcount',
    'n2 = c.execute("DELETE FROM equipment WHERE role_id=?", (rid,)).rowcount',
    'n3 = c.execute("DELETE FROM roles WHERE id=?", (rid,)).rowcount',
    'n4 = 0',
    'if acc:',
    '    n4 = c.execute("DELETE FROM accounts WHERE id=?", (acc,)).rowcount',
    '    c.execute("DELETE FROM tokens WHERE account_id=?", (acc,))',
    'c.commit(); c.close()',
    "print('purge %s: items=%d equipment=%d roles=%d accounts=%d' % (name, n1, n2, n3, n4))",
  ].join('\n');
  const tmp = path.join(os.tmpdir(), 'xx2d_purge_' + Date.now() + '.py');
  fs.writeFileSync(tmp, py);
  const { spawnSync } = require('child_process');
  const r = spawnSync('python', [tmp, name], { cwd: path.join(__dirname, '..', 'server'), encoding: 'utf8' });
  try { fs.rmSync(tmp, { force: true }); } catch (e) { }
  return ((r.stdout || '') + (r.stderr || '')).trim();
}

// The exact probe from the handover document, plus the click-path facts.
const PROBE = [
  'var b = document.getElementById("bagSell");',
  'if (!b) { return JSON.stringify({ button: "MISSING" }); }',
  'var chain = [];',
  'var e = b;',
  'while (e && e !== document.body) {',
  '  var s = getComputedStyle(e);',
  '  chain.push(e.tagName + (e.id ? "#" + e.id : "") + (e.className ? "." + String(e.className).split(" ").join(".") : "") +' +
  '    " pe=" + s.pointerEvents + " z=" + s.zIndex + " disp=" + s.display + " vis=" + s.visibility + " ovf=" + s.overflow);',
  '  e = e.parentElement;',
  '}',
  'var r = b.getBoundingClientRect();',
  'var cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);',
  'var top = document.elementFromPoint(cx, cy);',
  'var bag = (typeof BAG !== "undefined") ? BAG : null;',
  'var sel = bag ? bag.sel : null;',
  'var found = null, selItem = null;',
  'if (bag && bag.items) {',
  '  for (var i = 0; i < bag.items.length; i++) {',
  '    if (sel !== null && String(bag.items[i].id) === String(sel)) { found = bag.items[i]; selItem = bag.items[i].item; break; }',
  '  }',
  '}',
  'return JSON.stringify({',
  '  exists: true,',
  '  disabled: b.disabled,',
  '  cls: b.className,',
  '  text: (b.textContent || "").trim(),',
  '  hasPDbind: !!b._b,',
  '  hasOnclick: typeof b.onclick === "function",',
  '  rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },',
  '  center: { x: cx, y: cy },',
  '  elementFromPoint: top ? (top.tagName + (top.id ? "#" + top.id : "") + (top.className ? "." + String(top.className).split(" ").join(".") : "")) : null,',
  '  isSelfOnTop: top === b,',
  '  containsPoint: top ? b.contains(top) : false,',
  '  panelOpen: (function () { var p = document.getElementById("setPanel"); return p ? (getComputedStyle(p).display + "/" + getComputedStyle(p).visibility) : "no-panel"; })(),',
  '  setTab: (typeof SETCFG !== "undefined") ? SETCFG.setTab : null,',
  '  bagSel: sel,',
  '  bagCount: bag && bag.items ? bag.items.length : -1,',
  '  bagMsg: bag ? bag.msg : null,',
  '  matchFound: !!found,',
  '  matchId: found ? found.id : null,',
  '  matchStack: found ? found.stack : null,',
  '  matchName: selItem ? selItem.name : null,',
  '  matchKind: selItem ? selItem.kind : null,',
  '  matchSlot: selItem ? selItem.slot : null,',
  '  matchLockedBy: selItem ? selItem.locked_by : null,',
  '  matchBroken: selItem ? selItem.broken : null,',
  '  netOn: (typeof NET !== "undefined") ? NET.on : null,',
  '  wscReady: (typeof WSC !== "undefined") ? WSC.ready : null,',
  '  chain: chain,',
  '});',
].join('\n');

(async function () {
  console.log('== diag_sell_btn == browser=' + BROWSER);
  const h = await fetch(ORIGIN + '/api/health').then(x => x.json()).catch(() => null);
  if (!h || !h.ok) { console.error('server not up at ' + ORIGIN); process.exit(1); }
  console.log('   server ok, tick=' + h.world.tick + ' online=' + h.world.online);

  const at = await adminToken();
  if (DISPOSABLE) { ROLE = disposableName(); }
  console.log('   test role: ' + ROLE + (DISPOSABLE ? ' (disposable, will be erased)' : ' (kept)'));
  // the role has to exist before the admin can hand it anything
  const tok = await roleToken(ROLE);
  if (!tok) { console.error('could not register/log in as ' + ROLE); process.exit(1); }
  console.log('   got token for ' + ROLE);

  // make sure the test role has a sellable weapon (unequipped, in bag)
  const g = await fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at },
    body: JSON.stringify({ act: 'give', name: ROLE, kind: 'sword', tier: 1 }),
  }).then(x => x.json()).catch(() => null);
  console.log('   admin give -> ' + JSON.stringify(g));

  const B = new Browser(9341);
  try {
    await B.start();
    await sleep(1200);
    await B.eval('localStorage.setItem("token",' + JSON.stringify(tok) + '); location.reload(); return 1;');
    let st = null;
    for (let i = 0; i < 40; i++) {
      await sleep(400);
      st = await B.eval('return JSON.stringify({ ready: (typeof WSC !== "undefined") && WSC.ready, name: (typeof WSC !== "undefined" && WSC.role) ? WSC.role.name : null });');
      try { const o = JSON.parse(st); if (o && o.ready) { st = o; break; } } catch (e) { }
    }
    console.log('   in world: ' + JSON.stringify(st));

    /* ------------------------------------------------------------------
       Q13: is gold DURABLE? Reported by the spec review: role_public() has no
       `gold` key, Player.__init__ never sets self.gold and _save_player never
       writes it. That would mean gold lives only in one session's memory.
       Prove it: sell via HTTP, then reload and see whether the balance survives.
       ------------------------------------------------------------------ */
    console.log('\n-- Q13: does gold survive a page reload? --');
    const g13 = await fetch(ORIGIN + '/api/admin/act', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at },
      body: JSON.stringify({ act: 'give', name: ROLE, kind: 'sword', tier: 3 }),
    }).then(x => x.json()).catch(() => null);
    console.log('        give -> ' + JSON.stringify(g13));
    const bag13 = await fetch(ORIGIN + '/api/bag', { headers: { 'X-Token': tok } }).then(x => x.json()).catch(() => null);
    const iid13 = bag13 && bag13.items && bag13.items[0] && bag13.items[0].id;
    const sold13 = await fetch(ORIGIN + '/api/sell', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Token': tok },
      body: JSON.stringify({ iid: iid13 }),
    }).then(x => x.json()).catch(() => null);
    console.log('        sold iid=' + iid13 + ' -> ' + JSON.stringify(sold13));
    /* give the tick thread a moment to credit memory */
    await sleep(1200);
    const goldMem = await B.eval('return (typeof WSC !== "undefined" && WSC.role) ? WSC.role.gold : "no-role";');
    console.log('        in-browser gold BEFORE reload : ' + goldMem);
    console.log('        db roles.gold / pending done=0 : ' + dbRoleGold(ROLE));
    await B.eval('location.reload(); return 1;');
    let st13 = null;
    for (let i = 0; i < 30; i++) {
      await sleep(400);
      st13 = await B.eval('return JSON.stringify({ ready: (typeof WSC !== "undefined") && WSC.ready, gold: (typeof WSC !== "undefined" && WSC.role) ? WSC.role.gold : null });');
      if (/"ready":true/.test(String(st13))) { break; }
    }
    console.log('        in-browser gold AFTER  reload : ' + st13);
    try {
      const o = JSON.parse(st13);
      console.log('        >>> GOLD SURVIVES RELOAD: ' + (o.gold === goldMem) +
        '  (' + goldMem + ' -> ' + o.gold + ')');
    } catch (e) { }

    /* Q13b: OFFLINE income. Sell over plain HTTP while the browser is NOT in the world,
       which makes the tick thread write a pending_gold row. Then log back in and it
       must be credited (before round302 nothing ever read that table back). */
    console.log('\n-- Q13b: offline sale -> pending_gold -> credited on login --');
    await B.eval('if (typeof WS !== "undefined" && WS && WS.close) { WS.close(); } return 1;');
    await sleep(800);
    const g13b = await fetch(ORIGIN + '/api/admin/act', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at },
      body: JSON.stringify({ act: 'give', name: ROLE, kind: 'sword', tier: 4 }),
    }).then(x => x.json()).catch(() => null);
    const bag13b = await fetch(ORIGIN + '/api/bag', { headers: { 'X-Token': tok } }).then(x => x.json()).catch(() => null);
    const iid13b = bag13b && bag13b.items && bag13b.items[0] && bag13b.items[0].id;
    const sold13b = await fetch(ORIGIN + '/api/sell', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Token': tok },
      body: JSON.stringify({ iid: iid13b }),
    }).then(x => x.json()).catch(() => null);
    await sleep(900);
    console.log('        offlined, sold iid=' + iid13b + ' -> ' + JSON.stringify(sold13b));
    console.log('        db gold / pending done=0 : ' + dbRoleGold(ROLE) + '   <-- a pending row is expected');
    const goldBeforeLogin = Number(await B.eval('return (typeof WSC !== "undefined" && WSC.role) ? WSC.role.gold : -1;'));
    await B.eval('location.reload(); return 1;');
    let st13b = null;
    for (let i = 0; i < 30; i++) {
      await sleep(400);
      st13b = await B.eval('return JSON.stringify({ ready: (typeof WSC !== "undefined") && WSC.ready, gold: (typeof WSC !== "undefined" && WSC.role) ? WSC.role.gold : null });');
      if (/"ready":true/.test(String(st13b))) { break; }
    }
    console.log('        after re-login           : ' + st13b + '  (was ' + goldBeforeLogin + ')');
    await sleep(2500);
    console.log('        db gold / pending done=0 : ' + dbRoleGold(ROLE) + '   <-- done=1 expected, gold grown');
    const credited = /"gold":(\d+)/.exec(String(st13b));
    console.log('        >>> OFFLINE INCOME CREDITED: ' + (credited && Number(credited[1]) > goldBeforeLogin) +
      '  (' + goldBeforeLogin + ' -> ' + (credited ? credited[1] : '?') + ')');

    // open the bag tab
    await B.eval('openSet("bag"); return 1;');
    await sleep(1400);

    // what did the bag actually fetch?
    const bagRaw = await B.eval(
      'var b = (typeof BAG !== "undefined") ? BAG : null;' +
      'return JSON.stringify({ n: b ? (b.items || []).length : -1, msg: b ? b.msg : null,' +
      ' haveWeapon: !!(b && b.weapon), ids: b && b.items ? b.items.slice(0, 8).map(function (x) { return x.id + ":" + ((x.item || {}).name || "?"); }) : null });');
    console.log('   bag after open: ' + bagRaw);

    // select the first bag item the way the UI does (grid click sets BAG.sel then bagRender)
    const selRaw = await B.eval(
      'var b = (typeof BAG !== "undefined") ? BAG : null;' +
      'if (!b || !b.items || !b.items.length) { return "NO-ITEMS"; }' +
      'var pick = null;' +
      'for (var i = 0; i < b.items.length; i++) {' +
      '  var it = b.items[i].item || {};' +
      '  var isW = (it.slot === "weapon" || it.slot === "armor");' +
      '  if (!isW) { pick = b.items[i]; break; }' +
      '}' +
      'if (!pick) { pick = b.items[0]; }' +
      'b.sel = pick.id; b.msg = ""; bagRender();' +
      'return JSON.stringify({ picked: pick.id, name: (pick.item || {}).name || "?", stack: pick.stack });');
    console.log('   selected: ' + selRaw);
    await sleep(500);

    console.log('\n-- Q1: button state + who is on top (the handover probe) --');
    const q1 = await B.eval(PROBE);
    if (typeof q1 === 'string') {
      try {
        const o = JSON.parse(q1);
        Object.keys(o).forEach(function (k) {
          if (k === 'chain') { o[k].forEach(function (c) { console.log('        ' + c); }); }
          else { console.log('        ' + k + ' = ' + JSON.stringify(o[k])); }
        });
      } catch (e) { console.log('        raw: ' + q1); }
    } else { console.log('        ' + q1); }

    console.log('\n-- Q2: does a REAL mouse click reach the button? (CDP Input) --');
    const pos = await B.eval('var b = document.getElementById("bagSell"); var r = b.getBoundingClientRect();' +
      'return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });');
    let pt = { x: 0, y: 0 };
    try { pt = JSON.parse(pos); } catch (e) { }
    await B.eval(
      'window.__diagEv = [];' +
      'var b = document.getElementById("bagSell");' +
      '["pointerdown","mousedown","pointerup","mouseup","click"].forEach(function (t) {' +
      '  b.addEventListener(t, function (e) { window.__diagEv.push(t + "@" + (e.target.id || e.target.tagName) + (e.defaultPrevented ? "(pd)" : "")); }, true);' +
      '});' +
      'window.__diagFetch = [];' +
      'var _of = window.fetch;' +
      'window.fetch = function (u, o) { try { window.__diagFetch.push(String(u)); } catch (e) { } return _of.apply(this, arguments); };' +
      'return 1;');
    B.reqs.length = 0;
    await B.mouse('mousePressed', pt.x, pt.y);
    await sleep(60);
    await B.mouse('mouseReleased', pt.x, pt.y);
    await sleep(1200);
    const evs = await B.eval('return JSON.stringify({ dom: window.__diagEv, fetch: window.__diagFetch });');
    console.log('        real mouse at ' + pt.x + ',' + pt.y + ' -> DOM events: ' + evs);
    console.log('        network (/api/*): ' + JSON.stringify(B.reqs));

    console.log('\n-- Q3: does a synthetic .click() work? --');
    B.reqs.length = 0;
    await B.eval('window.__diagEv = []; window.__diagFetch = []; var b = document.getElementById("bagSell"); b.click(); return 1;');
    await sleep(1200);
    const evs2 = await B.eval('return JSON.stringify({ dom: window.__diagEv, fetch: window.__diagFetch });');
    console.log('        .click() -> DOM events: ' + evs2);
    console.log('        network (/api/*): ' + JSON.stringify(B.reqs));

    /* Q5 -- walk the real guard step by step.
       No game source is touched: we read the state the closure would read, then call the
       button own handler once with a fetch spy. If the spy stays empty the closure bailed
       before fetch(); the enable/cursor deltas tell us WHICH guard did it. */
    console.log('\n-- Q5: which guard inside the handler fires? --');
    const q5 = await B.eval([
      'var b = document.getElementById("bagSell");',
      'var spy = [];',
      'var _of = window.fetch;',
      'window.fetch = function (u) { spy.push(String(u)); return _of.apply(this, arguments); };',
      'var before = { disabled: b.disabled, cls: b.className, cur: getComputedStyle(b).cursor };',
      'b.disabled = false;                      /* take the disabled-guard out of the picture */',
      'var enabledSellId = b.disabled;',
      'var handler = b.onclick;',
      'var threw = null;',
      'try { if (typeof handler === "function") { handler.call(b, { preventDefault: function () { } }); } else { threw = "onclick is " + typeof handler; } }',
      'catch (e) { threw = String(e && e.message || e); }',
      'var after = { disabled: b.disabled, cls: b.className, cur: getComputedStyle(b).cursor };',
      'window.fetch = _of;',
      'return JSON.stringify({ before: before, after: after, spy: spy, threw: threw,',
      '  handlerSrc: typeof handler === "function" ? String(handler).slice(0, 160) : null });',
    ].join('\n'));
    console.log('        ' + q5);
    await sleep(400);

    console.log('\n-- Q6: is the HUD gold updater the thing that throws? --');
    /* NOTE: this stub MUST be removed again - leaving window.fetch patched poisons every
       later request in this run and produces very confusing evidence (it did, once). */
    await B.eval('window.__diagFetch = []; window.__diagRealFetch = window.fetch;' +
      'window.fetch = function (u, o) {' +
      '  window.__diagFetch.push(String(u));' +
      '  return window.__diagRealFetch.apply(this, arguments).then(function (r) { return { __stub: true, json: function () { return Promise.resolve({ ok: true, gold: 7, name: "X" }); } }; });' +
      '}; return 1;');
    const q6 = await B.eval(
      'var b = document.getElementById("bagSell"); b.disabled = false;' +
      'var out = { threw: null };' +
      'try { b.onclick.call(b, { preventDefault: function () { } }); } catch (e) { out.threw = String(e && e.message || e); }' +
      'out.fetch = window.__diagFetch.slice();' +
      'out.disabledNow = b.disabled;' +
      'return JSON.stringify(out);');
    console.log('        ' + q6);
    await sleep(1500);
    const q6b = await B.eval('return JSON.stringify({ errs: (window.__errs || []).slice(0, 6), toast: (function () { var t = document.getElementById("toast"); return t ? t.textContent : "no-toast-el"; })() });');
    console.log('        after stub-resolve: ' + q6b);
    await B.eval('if (window.__diagRealFetch) { window.fetch = window.__diagRealFetch; } return String(window.fetch).indexOf("__diagFetch") >= 0 ? "STILL-PATCHED" : "restored";')
      .then(function (r) { console.log('        fetch ' + r); });

    console.log('\n-- Q7: what IS b.onclick (the real bound function)? --');
    const q7 = await B.eval([
      'var b = document.getElementById("bagSell");',
      'var src = typeof b.onclick === "function" ? String(b.onclick) : "(" + typeof b.onclick + ")";',
      'var listeners = "n/a";',
      'try { listeners = (typeof getEventListeners === "function") ? JSON.stringify(Object.keys(getEventListeners(b))) : "no-CDP-helper"; } catch (e) { listeners = "err"; }',
      'return JSON.stringify({ src: src.slice(0, 300),',
      '  attrOnclick: b.getAttribute("onclick"),',
      '  sameAsBagRenderHint: src.indexOf("sellBtn") >= 0 });',
    ].join('\n'));
    console.log('        ' + q7);

    /* Q8 -- replicate the exact guard the closure uses, reading live state.
       This does not run game code; it recomputes what line 2651/2669 would see. */
    console.log('\n-- Q8: replicate the guard expression against live state --');
    const q8 = await B.eval([
      'var b = document.getElementById("bagSell");',
      'var b2 = document.getElementById("bagSell");',
      'var bag = (typeof BAG !== "undefined") ? BAG : null;',
      'var items = (bag && bag.items) || [];',
      'var sel = bag ? bag.sel : null;',
      'var selItem = null, selIsEquipped = false;',
      'for (var q = 0; q < items.length; q++) {',
      '  if (sel && String(items[q].id) === String(sel)) {',
      '    selItem = items[q].item;',
      '    selIsEquipped = !!((bag.weaponItemId && String(bag.weaponItemId) === String(items[q].id)) ||',
      '                       (bag.armorItemId && String(bag.armorItemId) === String(items[q].id)));',
      '    break; } }',
      'var DEFAULT_W_like = null;',
      'var sellId = null;',
      'if (selItem) { for (var i = 0; i < items.length; i++) { if (items[i].item === selItem) { sellId = items[i].id; break; } } }',
      'return JSON.stringify({',
      '  sameElement: b === b2,',
      '  sel: sel, itemsN: items.length,',
      '  selItemFound: !!selItem,',
      '  identityScan_sellId: sellId,',
      '  identityScan_found: sellId !== null,',
      '  idScan_sellId: (function () { for (var j = 0; j < items.length; j++) { if (sel && String(items[j].id) === String(sel)) { return items[j].id; } } return null; })(),',
      '  selIsEquipped: selIsEquipped,',
      '  weaponItemId: bag ? bag.weaponItemId : null,',
      '  armorItemId: bag ? bag.armorItemId : null,',
      '  itemKeys: selItem ? Object.keys(selItem) : null,',
      '  stackOfSel: (function () { for (var k = 0; k < items.length; k++) { if (sel && String(items[k].id) === String(sel)) { return items[k].stack; } } return null; })()',
      '});',
    ].join('\n'));
    console.log('        ' + q8);

    /* Q9 -- the decisive one. Build a matching record and see whether the guard flips. */
    console.log('\n-- Q9: force the guard open (identity-identical record) and click again --');
    const q9 = await B.eval([
      'var b = document.getElementById("bagSell");',
      'var bag = (typeof BAG !== "undefined") ? BAG : null;',
      'var out = { steps: [] };',
      'if (!bag || !bag.sel) { return JSON.stringify({ err: "no bag/sel" }); }',
      'out.beforeDisabled = b.disabled;',
      /* put a record in the bag whose .item is the SAME OBJECT the render picked,
         so the identity scan inside the closure finds it. */
      'bag.items = bag.items || [];',
      'bag.items.push({ id: "DIAGFAKE", stack: 1, item: { name: "DIAGFAKE", kind: "material", tier: 0 } });',
      'bag.sel = "DIAGFAKE";',
      'bagRender();',
      'out.afterRenderDisabled = b.disabled;',
      'out.afterRenderCls = b.className;',
      'window.__diagFetch = [];',
      'try { b.disabled = false; b.onclick.call(b, { preventDefault: function () { } }); } catch (e) { out.threw = String(e); }',
      'out.sent = window.__diagFetch.slice();',
      'out.cur = getComputedStyle(b).cursor;',
      'return JSON.stringify(out);',
    ].join('\n'));
    console.log('        ' + q9);
    await sleep(1500);
    console.log('        network after Q9: ' + JSON.stringify(B.reqs));

    /* Q10 -- read the closure itself. Line breakpoints inside the sell block, then read
       sellBtn / sellId straight out of the paused frame. This is the only honest way to
       see a var that lives in a closure (probing from outside already contradicted itself). */
    console.log('\n-- Q10: debugger -- read sellBtn / sellId from the paused frame --');
    // queue every pause so a fast click cannot race the waiter
    B.paused = [];
    B.pauseWaiters = [];
    B.scripts = [];
    B.interesting = {};           // 1-based line numbers we actually want to stop at
    const baseOnMsg = B.ws.onmessage;
    B.ws.onmessage = function (ev) {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return baseOnMsg.call(B.ws, ev); }
      if (m.method === 'Debugger.scriptParsed') {
        const u = m.params && m.params.url || '';
        if (u.indexOf('web') >= 0 || u.indexOf('.js') >= 0) { B.scripts.push(m.params.scriptId + ' ' + u); }
        return;
      }
      if (m.method === 'Debugger.paused') {
        const ln = (m.params.callFrames[0].location.lineNumber || 0) + 1;
        /* Anything that is not one of our lines gets released immediately: `Debugger.pause`
           and any leftover breakpoint would otherwise leave the target frozen and every
           later pause would silently never arrive (that bug cost me one whole run). */
        if (!B.interesting[ln]) {
          try { B.ws.send(JSON.stringify({ id: ++B.seq, method: 'Debugger.resume', params: {} })); } catch (e) { }
          return;
        }
        if (B.pauseWaiters.length) { B.pauseWaiters.shift()(m.params); }
        else { B.paused.push(m.params); }
        return;
      }
      baseOnMsg.call(B.ws, ev);
    };
    const waitPause = function () {
      if (B.paused.length) { return Promise.resolve(B.paused.shift()); }
      return new Promise(function (res) {
        const timer = setTimeout(function () { res(null); }, 6000);
        B.pauseWaiters.push(function (p) { clearTimeout(timer); res(p); });
      });
    };
    /* accept ANY pause (used by the function-call breakpoint, where the location is unknown) */
    const AnyPause = function () { return waitPause(); };
    await B.send('Debugger.enable', {});
    await sleep(600);
    console.log('        loaded scripts:');
    B.scripts.forEach(function (s) { console.log('          ' + s); });

    // what source is the BROWSER actually running? (not what is on disk)
    const sid = (B.scripts.filter(function (s) { return s.indexOf('platform/web.js') >= 0; })[0] || '').split(' ')[0];
    const srcR = await B.send('Debugger.getScriptSource', { scriptId: sid });
    const src = (srcR && srcR.result && srcR.result.scriptSource) || '';
    const srcLines = src.split('\n');
    console.log('        browser source of script ' + sid + ': ' + srcLines.length + ' lines');
    console.log('        contains _sellGo: ' + (src.indexOf('_sellGo') >= 0) +
      ' | hasPDbind marker: ' + (src.indexOf('round300') >= 0));
    const tail = await B.eval([
      'var b = document.getElementById("bagSell");',
      'var s = String(b.onclick);',
      'return JSON.stringify({ onclick: s, bagSellIndex: 1 });',
    ].join('\n'));
    console.log('        onclick string: ' + tail);
    for (const ln of [2648, 2668, 2669, 2670]) {
      console.log('        browser line ' + (ln + 1) + ': ' + JSON.stringify((srcLines[ln] || '').slice(0, 110)));
    }

    // sanity: can the debugger pause at all? (and release it right away)
    await B.send('Debugger.pause', {});
    const sanityPause = await waitPause();
    console.log('        sanity pause -> ' + (sanityPause ? ('OK frames=' + sanityPause.callFrames.length) : 'NO PAUSE'));
    if (sanityPause) { await B.send('Debugger.resume', {}); }
    await sleep(200);

    // What listeners are REALLY attached? (positions, not guesses)
    await B.send('DOM.enable', {});
    await B.send('Runtime.enable', {});
    const doc = await B.send('DOM.getDocument', { depth: 1 });
    const rootId = doc && doc.result && doc.result.root && doc.result.root.nodeId;
    console.log('        rootNodeId=' + rootId);
    // sanity: the document itself has pointerdown/touchstart listeners (known from source)
    const docL = await B.send('DOMDebugger.getEventListeners', { nodeId: rootId, depth: 1, pierce: false });
    const docList = (docL && docL.result && docL.result.listeners) || [];
    console.log('        sanity: document listeners = ' + docList.length + ' types=' +
      JSON.stringify(docList.slice(0, 10).map(function (L) { return L.type; })));
    const q = await B.send('DOM.querySelector', { nodeId: rootId, selector: '#bagSell' });
    const nodeId = q && q.result && q.result.nodeId;
    console.log('        #bagSell nodeId=' + nodeId + ' err=' + JSON.stringify((q && q.error) || null));
    const el = await B.send('DOMDebugger.getEventListeners', { nodeId: nodeId, depth: 2, pierce: true });
    const list = (el && el.result && el.result.listeners) || [];
    console.log('        listeners on #bagSell (' + list.length + '): err=' + JSON.stringify((el && el.error) || null));
    const realLocs = [];
    list.forEach(function (L, i) {
      const loc = (L.location) || {};
      const line1 = (loc.lineNumber || 0) + 1;
      console.log('          [' + i + '] ' + L.type + ' cap=' + L.useCapture + ' at ' + (loc.scriptId || '?') + ':' + line1);
      if (L.type === 'click' || L.type === 'pointerdown') { realLocs.push({ type: L.type, line: loc.lineNumber, sid: loc.scriptId, line1: line1 }); }
    });
    if (!realLocs.length) {
      // fall back: we know from source where click/pointerdown are bound (2693/2694 -> 0-based 2692/2693)
      console.log('        (no listener info -- falling back to source positions 2693/2694)');
      const sid5 = (B.scripts.filter(function (s) { return s.indexOf('platform/web.js') >= 0; })[0] || '').split(' ')[0];
      realLocs.push({ type: 'click', line: 2693, sid: sid5, line1: 2694 });
      realLocs.push({ type: 'pointerdown', line: 2692, sid: sid5, line1: 2693 });
    }
    const bpIds = [];
    for (const rl of realLocs) {
      for (const off of [0, 1, 2]) {
        const ln = rl.line + off;
        const r = await B.send('Debugger.setBreakpoint', { location: { scriptId: rl.sid, lineNumber: ln, columnNumber: 0 } });
        const id = r && r.result && r.result.breakpointId;
        const al = r && r.result && r.result.actualLocation;
        if (id) {
          bpIds.push(id);
          const aln = (al ? al.lineNumber : ln) + 1;
          B.interesting[aln] = 1;
          console.log('        bp ' + rl.type + ' L' + (ln + 1) + ' -> actual L' + aln + ' : ' +
            JSON.stringify((srcLines[aln - 1] || '').slice(0, 70)));
        } else {
          console.log('        bp ' + rl.type + ' L' + (ln + 1) + ' FAILED ' + JSON.stringify(r && r.error));
        }
      }
    }
    console.log('        watching lines: ' + JSON.stringify(Object.keys(B.interesting)));

    const READ = 'JSON.stringify({ sellBtn: (typeof sellBtn !== "undefined" && sellBtn) ? 1 : 0,' +
      ' sellBtnDisabled: (typeof sellBtn !== "undefined" && sellBtn) ? sellBtn.disabled : "n/a",' +
      ' sellBtnConnected: (typeof sellBtn !== "undefined" && sellBtn) ? sellBtn.isConnected : null,' +
      ' sellId: (typeof sellId !== "undefined") ? sellId : "UNDEF",' +
      ' selItem: (typeof selItem !== "undefined" && selItem) ? (selItem.name || "?") : String(selItem),' +
      ' bagSel: (typeof BAG !== "undefined" && BAG) ? BAG.sel : null,' +
      ' itemsN: (typeof BAG !== "undefined" && BAG && BAG.items) ? BAG.items.length : -1 })';

    await B.eval('var b = document.getElementById("bagSell"); b.disabled = false; b.click(); return 1;');
    B.pauseCount = 0;
    let pa = await waitPause();
    let guardSeen = null;
    for (let round = 0; round < 6 && pa; round++) {
      B.pauseCount++;
      const cf = pa.callFrames[0];
      const rr = await B.send('Debugger.evaluateOnCallFrame', {
        callFrameId: cf.callFrameId, expression: READ, returnByValue: true,
      });
      const val = rr && rr.result && rr.result.result && rr.result.result.value;
      console.log('        [pause ' + (round + 1) + '] line ' + (cf.location.lineNumber + 1) +
        ' fn=' + (cf.functionName || '(anon)') + ' :: ' + val);
      if (cf.location.lineNumber + 1 === 2669 && typeof val === 'string') { guardSeen = val; }
      await B.send('Debugger.resume', {});
      pa = await waitPause();
    }
    /* Q11 -- break on the FUNCTION OBJECT itself.
       setBreakpointOnFunctionCall pauses on entry, before the first statement, so the
       closure is still alive and sellBtn / sellId are readable. */
    console.log('\n-- Q11b: read the temporary in-code probe window.__sellDBG --');
    const dbg1 = await B.eval('return JSON.stringify({ probe: window.__sellDBG || null, ver: (document.querySelector("script[src*=platform]") || {}).src });');
    console.log('        ' + dbg1);
    await B.eval('window.__sellDBG = []; var b = document.getElementById("bagSell"); b.disabled = false; b.click(); return 1;');
    await sleep(400);
    const dbg2 = await B.eval('return JSON.stringify(window.__sellDBG || "no-probe");');
    console.log('        after click: ' + dbg2);

    console.log('\n-- Q11: break on the onclick function object and read the closure --');
    await B.send('Debugger.enable', {});
    const fo = await B.send('Runtime.evaluate', { expression: 'document.getElementById("bagSell").onclick' });
    const funcObj = fo && fo.result && fo.result.result && fo.result.result.objectId;
    console.log('        function objectId=' + funcObj + ' err=' + JSON.stringify((fo && fo.result && fo.result.exceptionDetails) || null));
    const fbp = await B.send('Debugger.setBreakpointOnFunctionCall', { objectId: funcObj });
    const fbpId = fbp && fbp.result && fbp.result.breakpointId;
    console.log('        bp on function call -> ' + (fbpId || JSON.stringify(fbp && fbp.error)));
    if (fbpId) {
      // every pause here is ours
      B.interesting = { 'ENTRY': 1 };
      await B.eval('var b = document.getElementById("bagSell"); b.disabled = false; b.click(); return 1;');
      const fp = await AnyPause();
      if (fp && fp.callFrames && fp.callFrames.length) {
        const cf = fp.callFrames[0];
        console.log('        paused in ' + (cf.functionName || '(anon)') + ' @L' + (cf.location.lineNumber + 1));
        for (let i = 0; i < Math.min(3, fp.callFrames.length); i++) {
          const f2 = fp.callFrames[i];
          const rr = await B.send('Debugger.evaluateOnCallFrame', {
            callFrameId: f2.callFrameId, expression: READ, returnByValue: true,
          });
          console.log('          frame[' + i + '] ' + (f2.functionName || '(anon)') + ' :: ' +
            JSON.stringify(rr && rr.result && rr.result.result && rr.result.result.value) +
            ' err=' + JSON.stringify((rr && rr.result && rr.result.exceptionDetails) || null));
        }
        // now step INTO _sellGo and read again
        await B.send('Debugger.stepInto', {});
        const sp = await AnyPause();
        if (sp && sp.callFrames && sp.callFrames.length) {
          const sf = sp.callFrames[0];
          console.log('        after stepInto: in ' + (sf.functionName || '(anon)') + ' @L' + (sf.location.lineNumber + 1));
          for (let i = 0; i < Math.min(3, sp.callFrames.length); i++) {
            const f3 = sp.callFrames[i];
            const rr2 = await B.send('Debugger.evaluateOnCallFrame', {
              callFrameId: f3.callFrameId, expression: READ, returnByValue: true,
            });
            console.log('          frame[' + i + '] ' + (f3.functionName || '(anon)') + ' :: ' +
              JSON.stringify(rr2 && rr2.result && rr2.result.result && rr2.result.result.value) +
              ' err=' + JSON.stringify((rr2 && rr2.result && rr2.result.exceptionDetails) || null));
          }
        } else { console.log('        stepInto: no pause'); }
      } else { console.log('        no pause on function call'); }
      await B.send('Debugger.removeBreakpoint', { breakpointId: fbpId });
      await B.send('Debugger.resume', {});
      await sleep(300);
    }

    console.log('        pauses observed: ' + B.pauseCount);
    for (const id of bpIds) { await B.send('Debugger.removeBreakpoint', { breakpointId: id }); }
    await B.send('Debugger.resume', {});
    B.ws.onmessage = baseOnMsg;
    console.log('        >> guard line 2669 saw: ' + guardSeen);
    await sleep(300);

    console.log('\n-- Q4: page errors so far --');
    console.log('        ' + JSON.stringify(B.errs.slice(0, 8)));

    /* Q12 -- after the round301 fix: a REAL mouse click must now send the request.
       Assert on the network layer AND on the server's answer, not on "it felt ok". */
    console.log('\n-- Q12: REAL mouse click end to end --');
    const conn = await B.eval('return JSON.stringify({ netOn: (typeof NET !== "undefined") ? NET.on : null, ready: (typeof WSC !== "undefined") ? WSC.ready : null });');
    console.log('        connection: ' + conn);
    if (/"ready":false/.test(String(conn)) || /"netOn":false/.test(String(conn))) {
      console.log('        websocket dropped -- reconnecting before the final check');
      await B.eval('localStorage.setItem("token",' + JSON.stringify(tok) + '); location.reload(); return 1;');
      let rdy = null;
      for (let i = 0; i < 30; i++) {
        await sleep(400);
        rdy = await B.eval('return JSON.stringify({ ready: (typeof WSC !== "undefined") && WSC.ready });');
        if (/"ready":true/.test(String(rdy))) { break; }
      }
      console.log('        reconnected: ' + rdy);
    }
    // Q2 already sold one, so make sure there is something left to sell
    const g2 = await fetch(ORIGIN + '/api/admin/act', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at },
      body: JSON.stringify({ act: 'give', name: ROLE, kind: 'sword', tier: 2 }),
    }).then(x => x.json()).catch(() => null);
    console.log('        top-up give -> ' + JSON.stringify(g2));
    /* openSet is a no-op when the bag tab is already active, so ask for the fetch itself */
    await B.eval('openSet("bag"); bagFetch(bagRender); return 1;');
    await sleep(1600);
    let bagNow = await B.eval('return JSON.stringify({ n: (typeof BAG !== "undefined" && BAG.items) ? BAG.items.length : -1, msg: (typeof BAG !== "undefined") ? BAG.msg : null });');
    console.log('        bag now: ' + bagNow);
    if (/"n":0/.test(String(bagNow))) {
      const probe = await B.evalAwait([
        'var t = "";',
        'try { t = localStorage.getItem("token") || ""; } catch (e) { }',
        'var j = null;',
        'try { j = await (await fetch("/api/bag", { headers: { "X-Token": t } })).json(); }',
        'catch (e) { return "FETCH-FAIL " + e; }',
        'return JSON.stringify({ tokHead: t.slice(0, 8), tokLen: t.length, ok: j && j.ok, err: j && j.error, n: (j && j.items) ? j.items.length : -1, keys: j ? Object.keys(j) : null, raw: JSON.stringify(j).slice(0, 160) });',
      ].join('\n'));
      console.log('        in-page /api/bag probe: ' + probe);
      console.log('        token we injected : ' + String(tok).slice(0, 8) + ' len=' + String(tok).length);
    }
    if (/"n":0/.test(String(bagNow))) {
      await B.eval('bagFetch(bagRender); return 1;');
      await sleep(1600);
      bagNow = await B.eval('return JSON.stringify({ n: (typeof BAG !== "undefined" && BAG.items) ? BAG.items.length : -1 });');
      console.log('        bag now (retry): ' + bagNow);
    }
    const pick2 = await B.eval([
      'var b = (typeof BAG !== "undefined") ? BAG : null;',
      'if (!b || !b.items || !b.items.length) { return "NO-ITEMS"; }',
      'b.sel = b.items[0].id; b.msg = ""; bagRender();',
      'var btn = document.getElementById("bagSell");',
      'var r = btn.getBoundingClientRect();',
      'return JSON.stringify({ picked: b.sel, name: (b.items[0].item || {}).name || "?",',
      '  stack: b.items[0].stack, disabled: btn.disabled, cls: btn.className,',
      '  x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });',
    ].join('\n'));
    console.log('        ' + pick2);
    let p2 = null;
    try { p2 = JSON.parse(pick2); } catch (e) { }
    if (p2 && !p2.disabled) {
      const goldBefore = await B.eval('return (typeof GOLD !== "undefined") ? GOLD : ((typeof WSC !== "undefined" && WSC.role) ? WSC.role.gold : "n/a");');
      console.log('        gold before = ' + goldBefore);
      B.reqs.length = 0;
      await B.mouse('mousePressed', p2.x, p2.y);
      await sleep(60);
      await B.mouse('mouseReleased', p2.x, p2.y);
      await sleep(1500);
      console.log('        network: ' + JSON.stringify(B.reqs));
      /* The user reported: the sale works but the ROW STAYS in the bag until he leaves
         and re-enters the panel. Watch the bag/DOM for a few seconds instead of checking
         once, so a slow or missing refresh cannot hide. */
      for (const wait of [300, 900, 2000, 3500]) {
        await sleep(wait === 300 ? 300 : wait - 300);
        const snap = await B.eval([
          'var b = (typeof BAG !== "undefined") ? BAG : null;',
          'var kids = document.querySelectorAll("#bagGrid .slot[data-id]");',
          'var ids = [];',
          'for (var i = 0; i < kids.length; i++) { var d = kids[i].getAttribute("data-id"); if (d) { ids.push(d); } }',
          'return JSON.stringify({ t: ' + wait + ',',
          '  bagN: b ? (b.items || []).length : -1,',
          '  hasSold: ids.indexOf(String(' + JSON.stringify(p2 ? p2.picked : null) + ')) >= 0,',
          '  domIds: ids.length, sel: b ? b.sel : null, msg: b ? b.msg : null });',
        ].join('\n'));
        console.log('        [+' + wait + 'ms] ' + snap);
      }
      const after = await B.eval([
        'var b = (typeof BAG !== "undefined") ? BAG : null;',
        'return JSON.stringify({ bagN: b ? (b.items || []).length : -1,',
        '  stillThere: b && b.items ? b.items.some(function (x) { return String(x.id) === String(' + JSON.stringify(p2.picked) + '); }) : null,',
        '  btnDisabled: document.getElementById("bagSell").disabled,',
        '  gold: (typeof WSC !== "undefined" && WSC.role) ? WSC.role.gold : "n/a" });',
      ].join('\n'));
      console.log('        after click: ' + after);
      const sold = B.reqs.some(function (u) { return u.indexOf('/api/sell') >= 0; });
      console.log('        >>> REQUEST SENT: ' + sold + (sold ? '  ✓ 出售按钮修好了' : '  ✗ 仍然没发请求'));
      // and the bag must not still contain the sold row
      try {
        const o = JSON.parse(after);
        console.log('        >>> ROW REMOVED: ' + (o.stillThere === false) + ' (bagN=' + o.bagN + ')');
      } catch (e) { }
    } else if (p2) {
      console.log('        button disabled after selecting -- cannot click (name=' + p2.name + ')');
    }
  } finally {
    B.kill();
    if (DISPOSABLE) {
      const out = await purgeRole(ROLE);
      console.log('   cleanup -> ' + out);
    } else {
      console.log('   (kept ' + ROLE + ': an explicit role name was passed)');
    }
  }
  console.log('== done ==');
})().catch(function (e) { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });
