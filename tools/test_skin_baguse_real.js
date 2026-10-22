// test_skin_baguse_real.js -- 真点浮窗里的「使 用」→ 皮肤真的解锁（查库）
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe'];
const B = CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let FAILS = 0;
const ck = (c, m, got) => {
  if (c) { console.log('  PASS  ' + m); }
  else { FAILS++; console.log('  FAIL  ' + m + (got === undefined ? '' : '  got=' + JSON.stringify(got))); }
};

function sql(code, args) {
  const tmp = path.join(os.tmpdir(), 'skb_' + Date.now() + '.py');
  fs.writeFileSync(tmp, code);
  const r = spawnSync('python', [tmp].concat(args || []),
    { cwd: path.join(ROOT, 'server'), encoding: 'utf8' });
  try { fs.rmSync(tmp, { force: true }); } catch (e) { }
  return ((r.stdout || '') + (r.stderr || '')).trim();
}

(async () => {
  const nm = '卡用真' + Math.random().toString(36).slice(2, 4);
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nm, password: 'abc123456' })
  }).then(x => x.json());
  const tok = reg.token, rid = reg.role.id;

  console.log('塞卡:', sql([
    'import sqlite3, json, sys, time',
    'c = sqlite3.connect("game.db", timeout=6)',
    'rid = int(sys.argv[1])',
    'it = {"name": "皮肤·女仆", "tier": 0, "kind": "skin", "key": "f05"}',
    'c.execute("INSERT INTO items(role_id, in_storage, slot_index, stack, item_json, created_at)"',
    '          " VALUES(?,0,0,1,?,?)", (rid, json.dumps(it, ensure_ascii=False), int(time.time()*1000)))',
    'c.commit(); print("ok")'
  ].join('\n'), [String(rid)]));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bagreal-'));
  const port = 5925 + Math.floor(Math.random() * 25);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1100,860', 'about:blank'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 120 && !t; i++) {
    await sleep(250);
    try {
      const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      t = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
    } catch (e) { }
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const wait = {};
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; } };
  const send = (mm, pp) => new Promise(res => { const i = ++id; wait[i] = res; ws.send(JSON.stringify({ id: i, method: mm, params: pp || {} })); });
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.result.value;

  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Page.navigate', { url: ORIGIN + '/?t=' + Date.now() });
  await sleep(1200);
  await ev('localStorage.setItem("token",' + JSON.stringify(tok) + ')');
  await send('Page.reload', {});
  await sleep(9000);
  await ev('try{annClose()}catch(e){}');
  await ev('try{ openSet(); setTab("bag"); }catch(e){}');
  await sleep(1600);

  // 把皮肤卡的浮窗按真路子弹出来，然后【真点】那个「使 用」
  const clicked = await ev(`(function(){
      var rec = null;
      for (var j=0;j<(BAG.items||[]).length;j++){
        if ((BAG.items[j].item||{}).kind === 'skin') { rec = BAG.items[j]; break; }
      }
      if (!rec) return 'no-card';
      bagTipShowAt(320, 300, bagTipHTML(rec.item, rec.id, 'bag', {}));
      var box = document.getElementById('bagTipBox');
      var btn = box.querySelector('[data-tipact="useskin"]');
      if (!btn) return 'no-btn';
      btn.click();
      return 'clicked:' + rec.id;
    })()`);
  console.log('点击:', clicked);
  ck(String(clicked).indexOf('clicked') === 0, '浮窗里的「使 用」点得到', clicked);
  await sleep(2500);

  const db = sql([
    'import sqlite3, sys',
    'c = sqlite3.connect("game.db", timeout=6)',
    'rid = int(sys.argv[1])',
    'print("UNLOCK", [r[0] for r in c.execute("SELECT key FROM skin_unlocks WHERE role_id=?", (rid,))])',
    'print("SKIN", (c.execute("SELECT skin FROM roles WHERE id=?", (rid,)).fetchone() or [""])[0])',
    'print("LEFT", c.execute("SELECT COUNT(*) FROM items WHERE role_id=?", (rid,)).fetchone()[0])'
  ].join('\n'), [String(rid)]);
  console.log('库:', db.replace(/\n/g, ' | '));
  ck(db.indexOf('f05') >= 0, '皮肤 f05 已解锁（写进 skin_unlocks）', db);
  ck(/SKIN f05/.test(db), '并且已经穿上（roles.skin = f05）', db);
  ck(/LEFT 0/.test(db), '那张卡消耗掉了（不在背包里了）', db);

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  if (FAILS) { console.log('FAILED: ' + FAILS); process.exit(1); }
  console.log('全部通过');
})();
