const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const nm = '排错' + Math.random().toString(36).slice(2, 5);
  const reg = await fetch(ORIGIN + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nm, password: 'abc123456' }) }).then(r => r.json());
  const admin = await fetch(ORIGIN + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'xiuxian-admin' }) }).then(r => r.json());
  const py = ['import sqlite3,sys,time', 'c=sqlite3.connect("game.db",timeout=8);rid=int(sys.argv[1]);now=int(time.time()*1000)',
    'c.execute("INSERT OR IGNORE INTO skill_learn(role_id,key,kind,tier,at) VALUES(?,?,?,?,?)",(rid,"clone","B",1,now))',
    'c.execute("INSERT OR REPLACE INTO skill_load(role_id,kind,slot,key) VALUES(?,?,?,?)",(rid,"B",0,"clone"))',
    'c.execute("UPDATE roles SET qi=200 WHERE id=?",(rid,));c.commit();print("db ok")'].join('\n');
  const tmp = path.join(os.tmpdir(), 'dbg_' + Date.now() + '.py');
  fs.writeFileSync(tmp, py);
  const pyres = require('child_process').spawnSync('python', [tmp, String(reg.role.id)], { cwd: path.join(ROOT, 'server'), encoding: 'utf8' });
  console.log('py:', pyres.stdout, pyres.stderr);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbg-'));
  const port = 6760 + Math.floor(Math.random() * 30);
  const proc = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--user-data-dir=' + dir, '--remote-debugging-port=' + port, '--window-size=1200,800', 'about:blank'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 120 && !t; i++) { await sleep(250); try { const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(); t = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl); } catch (e) { } }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const wait = {};
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; } };
  const send = (mm, pp) => new Promise(res => { const i = ++id; wait[i] = res; ws.send(JSON.stringify({ id: i, method: mm, params: pp || {} })); });
  const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.result && r.result.exceptionDetails) console.log('EXC', JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Page.navigate', { url: ORIGIN + '/?t=' + Date.now() });
  await sleep(1500);
  await ev('localStorage.setItem("token",' + JSON.stringify(reg.token) + ')');
  await send('Page.reload', {});
  await sleep(10500);
  await ev('try{annClose()}catch(e){}');
  console.log('name:', nm, 'rid:', reg.role.id);
  console.log('err:', await ev("(document.getElementById('err')||{}).textContent||''"));
  console.log('SK:', JSON.stringify(await ev('({load:SK.load.B,learn:Object.keys(SK.learn||{})})')));
  await ev(`window.__msgs=[];window.__cerr=null;(function(){
    var old=window.skCloneHandle;
    window.skCloneHandle=function(d){window.__msgs.push(JSON.parse(JSON.stringify(d)));
      try{old(d);}catch(e){window.__cerr=String((e&&e.stack)||e);}};
  })()`);
  for (let i = 0; i < 6; i++) {
    await fetch(ORIGIN + '/api/admin/act', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': admin.token }, body: JSON.stringify({ act: 'trigB', name: nm, n: 20 }) });
    await sleep(700);
    const n = await ev("Object.keys(window.CLONES||{}).length");
    console.log('try', i, 'clones=', n, 'msgs=', await ev('window.__msgs.length'), 'cerr=', await ev('window.__cerr'));
    if (n) break;
  }
  console.log('msgs sample:', JSON.stringify(await ev('window.__msgs.slice(0,4)')));
  console.log('scene?', await ev('typeof scene'), 'THREE?', await ev('typeof THREE'), 'VFX?', await ev('typeof VFX'), 'mkMobUI?', await ev('typeof mkMobUI'));
  console.log('err2:', await ev("(document.getElementById('err')||{}).textContent||''"));
  try { ws.close(); } catch (e) { }
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  process.exit(0);
})();
