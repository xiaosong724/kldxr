// 验证名牌里"魔气 / 称号"的上下顺序（真浏览器里跑）
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const B = CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const nm = '牌' + Math.random().toString(36).slice(2, 6);
  const r = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nm, password: 'abc123456' })
  }).then(x => x.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-'));
  const port = 4800 + Math.floor(Math.random() * 60);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1200,800', 'about:blank'], { stdio: 'ignore' });
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
  await send('Runtime.enable', {});
  await send('Page.navigate', { url: ORIGIN + '/?t=' + Date.now() });
  await sleep(1500);
  await send('Runtime.evaluate', { expression: 'localStorage.setItem("token",' + JSON.stringify(r.token) + ')' });
  await send('Page.reload', {});
  await sleep(9000);
  const ev = await send('Runtime.evaluate', {
    expression: `(function(){
      try {
        var wrap = document.createElement('div');
        document.body.appendChild(wrap);
        var ui = { wrap: wrap };
        UI.plate.title(ui, '国服在线top1', 1);
        UI.plate.mq(ui, 500);
        var box = ui.topEl;
        var order = [];
        for (var i = 0; i < box.children.length; i++) {
          var el = box.children[i];
          order.push((el === ui.mqEl ? 'mq' : (el === ui.ttlEl ? 'title' : '?')));
        }
        return JSON.stringify({ order: order, mqFirst: order[0] === 'mq' });
      } catch(e) { return String(e); }
    })()`, returnByValue: true
  });
  console.log(ev.result.result.value);
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
})();
