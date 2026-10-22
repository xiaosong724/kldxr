// shot_face10.js -- 三张图：男眼 10 / 女眼 10 / 嘴 10
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe'];
const B = CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'face10-'));
  const port = 5910 + Math.floor(Math.random() * 25);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1400,700', 'about:blank'], { stdio: 'ignore' });
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
    if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; }
  };
  const send = (mm, pp) => new Promise(res => { const i = ++id; wait[i] = res; ws.send(JSON.stringify({ id: i, method: mm, params: pp || {} })); });
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.result.value;

  await send('Page.enable', {}); await send('Runtime.enable', {});
  const jobs = [['eyesM', 'eyes-male-10.png'], ['eyesF', 'eyes-female-10.png'], ['mouth', 'mouth-10.png']];
  for (const [k, out] of jobs) {
    await send('Page.navigate', { url: 'file:///C:/mc/xiuxian-2d/tools/preview_face10.html?k=' + k });
    await sleep(3500);
    const n = await ev('document.querySelectorAll(".cell").length');
    console.log(k, '格子数', n);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const p = path.join(ROOT, 'docs', 'shots', out);
    fs.writeFileSync(p, Buffer.from(r.result.data, 'base64'));
    console.log('存:', p);
  }
  if (errs.length) { console.log('报错:', errs.slice(0, 3).map(x => String(x).slice(0, 200))); }
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
})();
