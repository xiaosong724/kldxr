// test_bag_perf_ui.js -- 浏览器里验证：使用 / 整理 都不再重拉 /api/bag
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

(async () => {
  const nm = '包测' + Math.random().toString(36).slice(2, 5);
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nm, password: 'abc123456' })
  }).then(x => x.json());
  const tok = reg.token, rid = reg.role.id;

  // 塞 300 件
  const py = [
    'import sqlite3, json, sys, time',
    'c = sqlite3.connect("game.db", timeout=8)',
    'rid = int(sys.argv[1]); now = int(time.time()*1000)',
    'rows = []',
    'for i in range(300):',
    '    t = i % 12',
    '    it = {"name":"测试剑 %d"%t,"slot":"weapon","tier":t,"itemLv":10,',
    '          "base":{"coeff":0.9,"atkSpeed":1.07,"reach":2.4,"arc":1.0,"critPt":0},',
    '          "affixes":[{"key":"atk_pct","name":"攻击力","mode":"pct","val":12.3,',
    '                      "text":"攻击力 +12.3%","live":True}],',
    '          "look":"sword","reqLevel":10,"dur":90,"durMax":90,"fx":None,"ext":{}}',
    '    rows.append((rid,0,-1,1,json.dumps(it,ensure_ascii=False),now))',
    'c.executemany("INSERT INTO items(role_id,in_storage,slot_index,stack,item_json,created_at) VALUES(?,?,?,?,?,?)", rows)',
    'c.commit(); print("ok")'
  ].join('\n');
  const tmp = path.join(os.tmpdir(), 'bp_' + Date.now() + '.py');
  fs.writeFileSync(tmp, py);
  spawnSync('python', [tmp, String(rid)], { cwd: path.join(ROOT, 'server'), encoding: 'utf8' });
  try { fs.rmSync(tmp, { force: true }); } catch (e) { }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bpui-'));
  const port = 5940 + Math.floor(Math.random() * 25);
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
  const bagReqs = [];
  let netOn = false;
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Network.requestWillBeSent') {
      const u = m.params.request.url;
      if (u.indexOf('/api/bag') >= 0) {
        const len = (m.params.request.headers['Content-Length'] || 0);
        if (netOn) { bagReqs.push(m.params.request.timestamp); }
      }
    }
    if (m.method === 'Network.responseReceived') {
      const u = m.params.response.url;
      if (netOn && u.indexOf('/api/bag') >= 0) {
        bagReqs.push(-Math.round((m.params.response.encodedDataLength || 0)));
      }
    }
    if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; }
  };
  const send = (mm, pp) => new Promise(res => { const i = ++id; wait[i] = res; ws.send(JSON.stringify({ id: i, method: mm, params: pp || {} })); });
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.result.value;

  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Network.enable', {});
  await send('Page.navigate', { url: ORIGIN + '/?t=' + Date.now() });
  await sleep(1200);
  await ev('localStorage.setItem("token",' + JSON.stringify(tok) + ')');
  await send('Page.reload', {});
  await sleep(9000);
  await ev('try{annClose()}catch(e){}');
  await ev('try{ openSet(); setTab("bag"); }catch(e){}');
  await sleep(1500);

  const n0 = await ev('(BAG.items||[]).length');
  console.log('   背包件数:', n0);
  ck(n0 === 300, '300 件都拿到了', n0);

  // ---- ① 使用一件 ----
  netOn = true; bagReqs.length = 0;
  const used = await ev(`(function(){
      var rec = null;
      for (var j=0;j<(BAG.items||[]).length;j++){
        var it = BAG.items[j].item || {};
        if (it.slot === 'weapon' && BAG.items[j].id !== BAG.weaponItemId) { rec = BAG.items[j]; break; }
      }
      if (!rec) return 'none';
      bagEquip(rec.id);
      return 'eq:' + rec.id;
    })()`);
  console.log('   使用:', used);
  await sleep(2000);
  const afterUse = await ev('JSON.stringify({ wid: BAG.weaponItemId, busy: BAG.busy })');
  ck(bagReqs.length === 0, '使用装备后【没有】重拉 /api/bag', bagReqs.length);
  ck(JSON.parse(afterUse || '{}').wid > 0, '武器 id 已经就地更新', afterUse);

  // ---- ② 一键整理 ----
  bagReqs.length = 0;
  const before = await ev('JSON.stringify((BAG.items||[]).slice(0,3).map(function(r){return r.item.tier;}))');
  await ev('document.getElementById("bagSort").click()');
  await sleep(2000);
  const afterSort = await ev('JSON.stringify((BAG.items||[]).slice(0,3).map(function(r){return r.item.tier;}))');
  ck(bagReqs.length === 0, '一键整理后【没有】重拉 /api/bag', bagReqs.length);
  ck(JSON.parse(afterSort)[0] === 11, '整理后是最高品阶在前',
     { before: JSON.parse(before), after: JSON.parse(afterSort) });

  // ---- ③ gzip 真的生效（浏览器自动带的）----
  const gz = await ev(`fetch('/api/bag',{headers:{'X-Token':BAG.token||localStorage.getItem('token')}})
      .then(function(r){ return r.headers.get('content-encoding')||''; })`);
  ck(String(gz).indexOf('gzip') >= 0, '浏览器拿 /api/bag 是 gzip 的', gz);

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  if (FAILS) { console.log('FAILED: ' + FAILS); process.exit(1); }
  console.log('全部通过');
})();
