// 调试：打开一个 URL，打印标题/正文长度/控制台错误
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const URLPATH = process.argv[2] || '/admin/announce';
const ORIGIN = 'http://127.0.0.1:8899';
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const B = CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbg2-'));
  const port = 5300 + Math.floor(Math.random() * 60);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1200,900', 'about:blank'], { stdio: 'ignore' });
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
  let id = 0; const wait = {}; const logs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      logs.push('EXC ' + ((d.exception && d.exception.description) || d.text));
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push('LOG ' + (m.params.args || []).map(a => a.value).join(' '));
    }
    if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; }
  };
  const send = (mm, pp) => new Promise(res => { const i = ++id; wait[i] = res; ws.send(JSON.stringify({ id: i, method: mm, params: pp || {} })); });
  await send('Runtime.enable', {});
  await send('Page.enable', {});
  await send('Page.navigate', { url: ORIGIN + URLPATH });
  await sleep(3000);
  const ev = await send('Runtime.evaluate', {
    expression: 'JSON.stringify({url:location.href, title:document.title, len:(document.body?document.body.innerText.length:-1), head:(document.body?document.body.innerText.slice(0,120):"")})',
    returnByValue: true
  });
  console.log(ev.result.result.value);
  console.log(logs.slice(0, 6).join('\n') || '(无错误)');
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
})();
