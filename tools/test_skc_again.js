// test_skc_again.js -- 改过的皮肤再进来：要显示已改的样子，且只对"这次动过的"扣卡
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe'];
const B = CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let FAILS = 0;
const ck = (c, m, got) => {
  if (c) { console.log('  PASS  ' + m); } else { FAILS++; console.log('  FAIL  ' + m + (got === undefined ? '' : '  got=' + JSON.stringify(got))); }
};
const sql = (code, args) => {
  const tmp = path.join(os.tmpdir(), 'sk2_' + Date.now() + '.py');
  fs.writeFileSync(tmp, code);
  const r = spawnSync('python', [tmp].concat(args || []), { cwd: path.join(ROOT, 'server'), encoding: 'utf8' });
  try { fs.rmSync(tmp, { force: true }); } catch (e) { }
  return ((r.stdout || '') + (r.stderr || '')).trim();
};

(async () => {
  const nm = '再改' + Math.random().toString(36).slice(2, 4);
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nm, password: 'abc123456' })
  }).then(x => x.json());
  const rid = reg.role.id;
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' })
  }).then(x => x.json()).then(j => j.token);

  // 发 6 张 f01 卡 + 直接解锁并穿上（夹具）
  await fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at },
    body: JSON.stringify({ act: 'give', name: nm, kind: 'skin', skinKey: 'f01', count: 6 })
  }).then(x => x.json());
  sql([
    'import sqlite3, sys, time',
    'c = sqlite3.connect("game.db", timeout=8)',
    'rid = int(sys.argv[1])',
    'c.execute("INSERT OR IGNORE INTO skin_unlocks(role_id,key,at) VALUES(?,?,?)", (rid,"f01",int(time.time()*1000)))',
    'c.execute("UPDATE roles SET skin=? WHERE id=?", ("f01", rid))',
    'c.commit(); print("ok")'
  ].join('\n'), [String(rid)]);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk2ui-'));
  const port = 5945 + Math.floor(Math.random() * 10);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1100,980', 'about:blank'], { stdio: 'ignore' });
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
  await ev('localStorage.setItem("token",' + JSON.stringify(reg.token) + ')');
  await send('Page.reload', {});
  await sleep(9000);
  await ev('try{annClose()}catch(e){}');
  await ev('try{ openSet(); setTab("skin"); }catch(e){}');
  await sleep(1200);
  await ev('try{ skinPick("f01"); }catch(e){}');
  await sleep(400);

  // 第一次：改 2 个部位（眼型 + 头发色）
  await ev("document.querySelector('#skNav [data-sknav=\"custom\"]').click()");
  await sleep(900);
  await ev('document.querySelectorAll("#skCOpts [data-skc-val]")[2].click()');   // 眼型 3
  await sleep(200);
  await ev("document.querySelector('#skCTabs [data-skc-tab=\"hair\"]').click()");
  await sleep(300);
  await ev('document.querySelectorAll("#skCOpts [data-skc-val]")[5].click()');   // 发色第 6 个
  await sleep(300);
  const p1 = await ev('JSON.stringify(SKC.pending)');
  console.log('   第一次 pending:', p1);
  await ev('document.getElementById("skCOk").click()');
  await sleep(2600);
  let db = sql(['import sqlite3, sys',
    'c = sqlite3.connect("game.db")',
    'print(c.execute("select data from skin_custom where role_id=?", (int(sys.argv[1]),)).fetchone()[0])'
  ].join('\n'), [String(rid)]);
  console.log('   库:', db.slice(0, 90));
  ck(db.indexOf('thin') >= 0 && db.indexOf('hair') >= 0, '两个部位都落库了', db);

  // 关掉再开（模拟"再进来"）：应该加载已改的样子
  await ev("document.querySelector('#skNav [data-sknav=\"main\"]').click()");
  await sleep(400);
  await ev("document.querySelector('#skNav [data-sknav=\"custom\"]').click()");
  await sleep(900);
  const loaded = await ev('JSON.stringify({ base: SKC.base, pending: SKC.pending })');
  console.log('   再进来:', loaded);
  const lj = JSON.parse(loaded || '{}');
  ck(lj.base && lj.base.ey === 2, '开面板时加载了上次的眼型（ey=2）', lj.base);
  ck(lj.pending && Object.keys(lj.pending).length === 0, '刚进来 pending 是空的（没动过 = 不收钱）', lj.pending);
  const hl = await ev('document.querySelectorAll("#skCOpts [data-skc-val]")[2].style.borderColor');
  ck(hl === 'rgb(255, 216, 61)', '上次选的眼型仍高亮（金框）', hl);

  // 选回原样 → pending 里不该有它
  await ev('document.querySelectorAll("#skCOpts [data-skc-val]")[2].click()');
  await sleep(300);
  ck(await ev('Object.keys(SKC.pending).length') === 0, '选回原样 → 不算改动', await ev('JSON.stringify(SKC.pending)'));

  // 这次只改嘴巴 → 只应该是 1 张
  await ev("document.querySelector('#skCTabs [data-skc-tab=\"mo\"]').click()");
  await sleep(400);
  await ev('document.querySelectorAll("#skCOpts [data-skc-val]")[4].click()');
  await sleep(300);
  const cost = await ev('(document.getElementById("skCCost")||{}).textContent');
  console.log('   消耗提示:', cost);
  /* ★ round530：提示改成"剩余卡 N 张 · 本次消耗 M 张" */
  ck(String(cost).indexOf('本次消耗：1') >= 0, '这次只改 1 个部位 → 本次消耗 1 张', cost);
  ck(String(cost).indexOf('剩余卡') >= 0, '同时显示剩余卡', cost);
  ck(await ev('Object.keys(SKC.pending).length') === 1, 'pending 只有 1 项');

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  if (FAILS) { console.log('FAILED: ' + FAILS); process.exit(1); }
  console.log('全部通过');
})();
