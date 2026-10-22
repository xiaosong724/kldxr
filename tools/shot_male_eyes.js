// shot_male_eyes.js -- 5 个男生眼睛方案截图（带 console 报错捕获）
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe'];
const B = CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyes-'));
  const port = 5960 + Math.floor(Math.random() * 25);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1400,470', 'about:blank'], { stdio: 'ignore' });
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
  let id = 0; const wait = {}; const errs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      errs.push((d.exception && d.exception.description) || d.text);
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      errs.push('[log] ' + (m.params.args || []).map(a => a.value).join(' '));
    }
    if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; }
  };
  const send = (mm, pp) => new Promise(res => { const i = ++id; wait[i] = res; ws.send(JSON.stringify({ id: i, method: mm, params: pp || {} })); });
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result;

  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Page.navigate', { url: 'file:///C:/mc/xiuxian-2d/tools/preview_male_eyes.html' });
  await sleep(5000);

  const info = await ev('JSON.stringify({ cells: document.querySelectorAll(".cell").length, ' +
    'order: (typeof SKIN_ORDER !== "undefined") ? SKIN_ORDER.length : -1, ' +
    'hasM06: (typeof SKIN_DEFS !== "undefined") && !!SKIN_DEFS.m06 })');
  console.log('页面:', info.result.value);
  if (errs.length) { console.log('报错:'); errs.slice(0, 4).forEach(x => console.log('  ' + String(x).slice(0, 300))); }

  const r = await send('Page.captureScreenshot', { format: 'png' });
  const out = path.join(ROOT, 'docs', 'shots', 'male-eyes-5.png');
  fs.writeFileSync(out, Buffer.from(r.result.data, 'base64'));
  console.log('存:', out);
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
})();
