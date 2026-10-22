// shot_skin_page.js -- 登录 → 打开"皮肤"页 → 截图（docs/shots/skin-page.png）
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ORIGIN = process.env.PAGE || 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'shots', process.env.OUT || 'skin-page.png');
const PW = 'abc123456';
const CAND = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
const B = CAND.find(function (p) { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

function rpc(py, args) {
  const tmp = path.join(os.tmpdir(), 'skp_' + Date.now() + '.py');
  fs.writeFileSync(tmp, py);
  const r = spawnSync('python', [tmp].concat(args || []),
    { cwd: path.join(ROOT, 'server'), encoding: 'utf8' });
  try { fs.rmSync(tmp, { force: true }); } catch (e) { }
  return ((r.stdout || '') + (r.stderr || '')).trim();
}

(async function () {
  if (!B) { console.error('no chrome'); process.exit(1); }
  const nm = '皮页' + Math.random().toString(36).slice(2, 6);
  let r = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nm, password: PW })
  }).then(function (x) { return x.json(); });
  if (!r || !r.token) { console.error('register failed', r); process.exit(1); }
  const tok = r.token, rid = r.role.id;
  /* 解锁 3 个（1 个正在用），再给某个皮肤塞两条竞价记录，看榜单 */
  console.log(rpc([
    'import sqlite3, sys, time',
    "c = sqlite3.connect('game.db', timeout=6)",
    'rid = int(sys.argv[1]); now = int(time.time()*1000)',
    'for k in ("f01","f13","m01"):',
    '    c.execute("INSERT OR IGNORE INTO skin_unlocks(role_id,key,at) VALUES(?,?,?)", (rid,k,now))',
    'c.execute("UPDATE roles SET skin=? WHERE id=?", ("f13", rid))',
    'c.commit()', "print('ok')",
  ].join('\n'), [String(rid)]));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skp-'));
  const port = 4500 + Math.floor(Math.random() * 60);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
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
  await send('Runtime.evaluate', {
    expression: 'try{ annClose(); openSet(); setTab("skin"); }catch(e){ String(e) }',
    returnByValue: true
  });
  await sleep(4000);
  if (process.env.CONFIRM) {
    await send('Runtime.evaluate', {
      expression: 'try{ document.getElementById("skBid").click(); }catch(e){}'
    });
    await sleep(900);
  }
  if (process.env.SCROLL) {
    await send('Runtime.evaluate', {
      expression: 'try{ document.querySelector(".tabpane[data-pane=skin]").scrollTop = 420; }catch(e){}'
    });
    await sleep(800);
  }
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
  console.log('存:', OUT);
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
})();
