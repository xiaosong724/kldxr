// shot_ann_popup.js -- 新号登录 → 公告弹窗（游戏内）
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = process.env.PAGE || 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'shots', process.env.OUT || 'ann-popup.png');
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const B = CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const nm = '告' + Math.random().toString(36).slice(2, 6);
  const r = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nm, password: 'abc123456' })
  }).then(x => x.json());
  if (!r || !r.token) { console.error('register failed', r); process.exit(1); }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anp-'));
  const port = 5200 + Math.floor(Math.random() * 60);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=980,820', 'about:blank'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 120 && !t; i++) {
    await sleep(250);
    try {
      const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      t = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
    } catch (e) { }
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r2 => ws.onopen = r2);
  let id = 0; const wait = {};
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; } };
  const send = (mm, pp) => new Promise(res => { const i = ++id; wait[i] = res; ws.send(JSON.stringify({ id: i, method: mm, params: pp || {} })); });
  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Emulation.setDeviceMetricsOverride',
    { width: 980, height: 820, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: ORIGIN + '/?t=' + Date.now() });
  await sleep(1500);
  await send('Runtime.evaluate', { expression: 'localStorage.setItem("token",' + JSON.stringify(r.token) + ')' });
  await send('Page.reload', {});
  await sleep(8000);
  const ev = await send('Runtime.evaluate', {
    expression: 'JSON.stringify({has: !!document.getElementById("annBox"), cd: (document.querySelector("#annBox div")&&1)||0})',
    returnByValue: true
  });
  console.log('弹窗状态:', ev.result.result.value);
  await sleep(1200);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
  console.log('存:', OUT);
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
})();
