// shot_ann.js -- 截公告预览页（默认 /ann?shot=1，整页截图）
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = process.env.PAGE || 'http://127.0.0.1:8899';
const URLPATH = process.env.URL || '/ann?shot=1';
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'shots', process.env.OUT || 'ann-page.png');
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const B = CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  if (!B) { console.error('no chrome'); process.exit(1); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ann-'));
  const port = 5100 + Math.floor(Math.random() * 60);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1240,1000', 'about:blank'], { stdio: 'ignore' });
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
  await send('Page.enable', {});
  await send('Runtime.enable', {});
  await send('Emulation.setDeviceMetricsOverride',
    { width: 1240, height: 900, deviceScaleFactor: 1, mobile: false });
  var _u = ORIGIN + URLPATH + (URLPATH.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now();
  await send('Page.navigate', { url: _u });
  await sleep(1200);
  /* ★ 无头 Chrome 第一次 navigate 偶尔不生效（停在 about:blank）→ 再试一次 ✓ */
  var _chk = await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
  if (!_chk || !_chk.result || !_chk.result.result ||
      String(_chk.result.result.value).indexOf('about:blank') === 0) {
    await send('Page.navigate', { url: _u });
    await sleep(1500);
  }
  if (process.env.ADMIN_TOKEN) {
    await send('Runtime.evaluate', {
      expression: 'localStorage.setItem("adminToken",' + JSON.stringify(process.env.ADMIN_TOKEN) + ')'
    });
    /* ★ 用 navigate 而不是 reload（reload 在无头里偶尔白屏 ✗）*/
    await send('Page.navigate', { url: _u + '&r=1' });
    await sleep(1800);
  }
  await sleep(3500);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
  console.log('存:', OUT);
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
})();
