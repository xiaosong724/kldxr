// test_skc_palette.js -- 调色盘：拖滑条能不能改预览 + 能不能确认消耗
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

(async () => {
  const nm = '调色' + Math.random().toString(36).slice(2, 4);
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nm, password: 'abc123456' })
  }).then(x => x.json());
  const rid = reg.role.id;
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' })
  }).then(x => x.json()).then(j => j.token);
  await fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at },
    body: JSON.stringify({ act: 'give', name: nm, kind: 'skin', skinKey: 'f01', equip: true })
  }).then(x => x.json());
  const py = [
    'import sqlite3, json, sys, time',
    'c = sqlite3.connect("game.db", timeout=8)',
    'rid = int(sys.argv[1])',
    'for _ in range(2):',
    '    it = {"name":"皮肤·双马尾剑士","tier":0,"kind":"skin","key":"f01"}',
    '    c.execute("INSERT INTO items(role_id,in_storage,slot_index,stack,item_json,created_at)"',
    '              " VALUES(?,0,-1,1,?,?)", (rid, json.dumps(it,ensure_ascii=False), int(time.time()*1000)))',
    'c.execute("INSERT OR IGNORE INTO skin_unlocks(role_id,key,at) VALUES(?,?,?)", (rid,"f01",int(time.time()*1000)))',
    'c.execute("UPDATE roles SET skin=? WHERE id=?", ("f01", rid))',
    'c.commit(); print("ok")'
  ].join('\n');
  const tmp = path.join(os.tmpdir(), 'ps2_' + Date.now() + '.py');
  fs.writeFileSync(tmp, py);
  spawnSync('python', [tmp, String(rid)], { cwd: path.join(ROOT, 'server'), encoding: 'utf8' });
  try { fs.rmSync(tmp, { force: true }); } catch (e) { }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pal-'));
  const port = 5960 + Math.floor(Math.random() * 10);
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
  let id = 0; const wait = {}; const errs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      errs.push(String((d.exception && d.exception.description) || d.text).slice(0, 160));
    }
    if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; }
  };
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
  await ev('document.getElementById("skCustom").click()');
  await sleep(1200);

  // 切到"衣服"分类
  await ev('(function(){ var d=document.querySelector(\'#skCTabs [data-skc-tab="shirt"]\'); if(d) d.click(); return 1; })()');
  await sleep(600);
  const has = await ev('document.querySelectorAll("#skCOpts [data-skc-sl]").length');
  ck(has === 3, '颜色页有 3 条滑条（色相/饱和/明度）', has);

  const shot1 = await send('Page.captureScreenshot', { format: 'png' });
  // 拖色相到 300（紫）
  const r1 = await ev(`(function(){
      var el = document.querySelector('#skCOpts [data-skc-sl="h"]');
      if (!el) return 'no-slider';
      el.value = '300';
      el.dispatchEvent(new Event('input', {bubbles:true}));
      return JSON.stringify(SKC.pending);
    })()`);
  console.log('   拖完 pending:', r1);
  await sleep(600);
  const shot2 = await send('Page.captureScreenshot', { format: 'png' });
  ck(String(r1).indexOf('shirt') >= 0, '拖滑条 → pending 里出现 shirt', r1);
  ck(shot1.result.data !== shot2.result.data, '预览画面变了（整页截图不同）');

  const hex = await ev('(function(){ var p=SKC.pending.shirt; return "#"+("000000"+(p||0).toString(16)).slice(-6); })()');
  console.log('   选到颜色:', hex);
  ck(/^#[0-9a-f]{6}$/.test(String(hex)), '算出的是一个合法颜色', hex);

  // 确认 → 扣卡落库
  await ev('document.getElementById("skCOk").click()');
  await sleep(2500);
  const con = spawnSync('python', ['-c',
    'import sqlite3;c=sqlite3.connect("game.db");' +
    'print(c.execute("select data from skin_custom where role_id=?",(' + String(rid) + ',)).fetchone())'],
    { cwd: path.join(ROOT, 'server'), encoding: 'utf8' });
  console.log('   库:', String(con.stdout || '').trim().slice(0, 100));
  ck(String(con.stdout).indexOf('shirt') >= 0, '衣服颜色落库了', con.stdout);
  ck(errs.length === 0, '没有页面异常', errs.slice(0, 2));

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  if (FAILS) { console.log('FAILED: ' + FAILS); process.exit(1); }
  console.log('全部通过');
})();
