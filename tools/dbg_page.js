// 临时调试：打开预览页，抓 console / 异常
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const B = process.env.CHROME || CAND.find(function (p) { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const target = process.env.PAGE || 'preview_skins_v3.html';
  const p = path.join(ROOT, 'tools', target).split(path.sep).join('/');
  const fileUrl = 'file:///' + p;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbg-'));
  const port = 4260 + Math.floor(Math.random() * 14);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1520,1520', fileUrl], { stdio: 'ignore' });
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
  let id = 0; const wait = {}; const msgs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled') {
      msgs.push('LOG ' + (m.params.args || []).map(a => a.value).join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      msgs.push('EXC ' + ((d.exception && d.exception.description) || d.text));
    }
    if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; }
  };
  const send = (mm, pp) => new Promise(res => { const i = ++id; wait[i] = res; ws.send(JSON.stringify({ id: i, method: mm, params: pp || {} })); });
  await send('Runtime.enable', {});
  await sleep(3500);
  const r = await send('Runtime.evaluate', {
    expression: process.env.EXPR || 'JSON.stringify({ready:!!window.__ready, lb:document.querySelectorAll("#labels .lb").length})',
    returnByValue: true
  });
  console.log('状态:', r.result && r.result.result && r.result.result.value);
  console.log(msgs.slice(0, 8).join('\n'));
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
})();
