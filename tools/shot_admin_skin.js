// shot_admin_skin.js -- 打开管理页 → 发装备弹窗 → 选"皮肤" → 截图
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'shots', 'admin-skin.png');
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const B = CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: process.env.ADMIN_PW || 'xiuxian-admin' })
  }).then(x => x.json()).then(x => x.token);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-'));
  const port = 4900 + Math.floor(Math.random() * 60);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
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
  await send('Page.navigate', { url: ORIGIN + '/admin?t=' + Date.now() });
  await sleep(1200);
  await send('Runtime.evaluate', { expression: 'localStorage.setItem("adminToken",' + JSON.stringify(at) + ')' });
  await send('Page.reload', {});
  await sleep(4000);
  /* 点第一行的"发装备"按钮 */
  let ev = await send('Runtime.evaluate', {
    expression: `(function(){
      var b = document.querySelector('#rows button[data-a="give"]');
      if (!b) { return 'no-row'; }
      b.click(); return 'clicked:' + b.getAttribute('data-n');
    })()`, returnByValue: true
  });
  console.log('行:', ev.result.result.value);
  await sleep(800);
  /* 在 giveType 里点"皮肤" */
  ev = await send('Runtime.evaluate', {
    expression: `(function(){
      var bs = document.querySelectorAll('#giveType button');
      for (var i=0;i<bs.length;i++){ if (bs[i].textContent === '皮肤'){ bs[i].click(); return 'ok'; } }
      return 'no-skin-btn';
    })()`, returnByValue: true
  });
  console.log('切到皮肤:', ev.result.result.value);
  await sleep(2500);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
  console.log('存:', OUT);
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
})();
