// shot_skin_self.js -- 登录一个号（皮肤=f13 狐仙），截一张游戏内截图
// 跑法：node tools/shot_skin_self.js  → docs/shots/skin-in-game.png
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ORIGIN = process.env.PAGE || 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'shots', 'skin-in-game.png');
const PW = 'abc123456';
const CAND = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
const B = CAND.find(function (p) { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

function rpc(py, args) {
  const tmp = path.join(os.tmpdir(), 'sk_' + Date.now() + '.py');
  fs.writeFileSync(tmp, py);
  const r = spawnSync('python', [tmp].concat(args || []),
    { cwd: path.join(ROOT, 'server'), encoding: 'utf8' });
  try { fs.rmSync(tmp, { force: true }); } catch (e) { }
  return ((r.stdout || '') + (r.stderr || '')).trim();
}

(async function () {
  if (!B) { console.error('no chrome'); process.exit(1); }
  const nm = '皮' + Math.random().toString(36).slice(2, 7);
  let r = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nm, password: PW })
  }).then(function (x) { return x.json(); });
  if (!r || !r.token) { console.error('register failed:', JSON.stringify(r)); process.exit(1); }
  const tok = r.token;
  const rid = r.role.id;
  /* 直接给这个号解锁狐仙并换上（省得走掉落）*/
  console.log(rpc([
    'import sqlite3, sys, time',
    "c = sqlite3.connect('game.db', timeout=6)",
    'rid = int(sys.argv[1]); key = sys.argv[2]',
    'c.execute("INSERT OR IGNORE INTO skin_unlocks(role_id,key,at) VALUES(?,?,?)", (rid, key, int(time.time()*1000)))',
    'c.execute("UPDATE roles SET skin=? WHERE id=?", (key, rid))',
    'c.commit()', "print('set skin', key)",
  ].join('\n'), [String(rid), 'f13']));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-'));
  const port = 4400 + Math.floor(Math.random() * 60);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 120 && !t; i++) {
    await sleep(250);
    try {
      const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      t = l.find(function (x) { return x.type === 'page' && x.webSocketDebuggerUrl; });
    } catch (e) { }
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(function (r2) { ws.onopen = r2; });
  let id = 0; const wait = {};
  ws.onmessage = function (e) {
    const m = JSON.parse(e.data);
    if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; }
  };
  const send = function (mm, pp) {
    return new Promise(function (res) {
      const i = ++id; wait[i] = res;
      ws.send(JSON.stringify({ id: i, method: mm, params: pp || {} }));
    });
  };
  await send('Page.enable', {});
  await send('Runtime.enable', {});
  await send('Page.navigate', { url: ORIGIN + '/?t=' + Date.now() });
  await sleep(1500);
  await send('Runtime.evaluate', {
    expression: 'localStorage.setItem("token",' + JSON.stringify(tok) + ')'
  });
  await send('Page.reload', {});
  await sleep(9000);
  /* 让角色站定，再把镜头拉近一点 */
  await send('Runtime.evaluate', {
    expression: 'try{ P.x=2; P.z=2; }catch(e){}'
  });
  await sleep(2500);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
  console.log('存:', OUT);
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
})();
