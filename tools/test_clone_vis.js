// test_clone_vis.js -- 分身能看见吗？（强制触发后数场景里的分身）
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe'];
const B = CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let FAILS = 0;
const ck = (c, m, got) => { if (c) console.log('  PASS  ' + m); else { FAILS++; console.log('  FAIL  ' + m + '  got=' + JSON.stringify(got)); } };

(async () => {
  const nm = '看分身' + Math.random().toString(36).slice(2, 4);
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nm, password: 'abc123456' })
  }).then(x => x.json());
  const rid = reg.role.id;
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' })
  }).then(x => x.json()).then(j => j.token);
  const py = [
    'import sqlite3,sys,time',
    'c=sqlite3.connect("game.db",timeout=8);rid=int(sys.argv[1]);now=int(time.time()*1000)',
    'for k,kind in [("clone","B"),("burn","B")]:',
    '    c.execute("INSERT OR IGNORE INTO skill_learn(role_id,key,kind,tier,at) VALUES(?,?,?,?,?)",(rid,k,kind,1,now))',
    'c.execute("INSERT OR REPLACE INTO skill_load(role_id,kind,slot,key) VALUES(?,?,?,?)",(rid,"B",0,"clone"))',
    'c.execute("INSERT OR REPLACE INTO skill_load(role_id,kind,slot,key) VALUES(?,?,?,?)",(rid,"B",1,"burn"))',
    'c.execute("UPDATE roles SET qi=100 WHERE id=?",(rid,));c.commit();print("ok")'
  ].join('\n');
  const tmp = path.join(os.tmpdir(), 'cv_' + Date.now() + '.py');
  fs.writeFileSync(tmp, py);
  require('child_process').spawnSync('python', [tmp, String(rid)], { cwd: path.join(ROOT, 'server'), encoding: 'utf8' });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-'));
  const port = 6600 + Math.floor(Math.random() * 40);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1100,800', 'about:blank'], { stdio: 'ignore' });
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
  await sleep(1000);
  await ev('localStorage.setItem("token",' + JSON.stringify(reg.token) + ')');
  await send('Page.reload', {});
  await sleep(9500);
  await ev('try{annClose()}catch(e){}');
  await sleep(500);

  // ★ round581：安全区不再触发被动 → 先走出出生点（±15 米）再测
  await ev("keys['w']=true");
  for (let i = 0; i < 75; i++) {
    await send('Page.captureScreenshot', {
      format: 'jpeg', quality: 1,
      clip: { x: 0, y: 0, width: 4, height: 4, scale: 1 }
    });
    await sleep(100);
  }
  await ev("keys['w']=false");
  await sleep(500);
  console.log('  走出安全区:', JSON.stringify(await ev('({x:+P.x.toFixed(1),z:+P.z.toFixed(1)})')));

  await fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at },
    body: JSON.stringify({ act: 'trigB', name: nm, n: 60 })
  }).then(x => x.json());
  await sleep(2000);

  const n = await ev("Object.keys(window.CLONES||{}).length");
  const inScene = await ev("(function(){var n=0;if(typeof scene==='undefined'){return -1;}scene.traverse(function(o){if(o.type==='Group'&&o.children&&o.children.length===2&&o.children[0].geometry&&o.children[0].geometry.type==='BoxGeometry'){n++;}});return n;})()");
  console.log('  CLONES 数量:', n, '| 场景里可疑分身:', inScene);
  ck(n > 0, '★ 客户端创建了分身模型', n);

  // 技能页看灼烧分类
  await ev("openSet(); setTab('skill')");
  await sleep(1000);
  await ev("document.querySelector('#skKindTabs [data-sk=\"B\"]').click()");
  await sleep(500);
  const hasBurn = await ev("!!document.querySelector('#skList [data-skk=\"burn\"]')");
  ck(hasBurn, '★ 灼烧出现在「被动释放」分类', hasBurn);

  let shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ROOT, 'docs/shots/clone-vis.png'), Buffer.from(shot.result.data, 'base64'));

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  if (FAILS) { console.log('FAILED: ' + FAILS); process.exit(1); }
  console.log('全部通过');
})();
