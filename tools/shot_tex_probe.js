// 拍贴图对比样张
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'];
const B = process.env.CHROME || CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ROOT = path.resolve(__dirname, '..');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'texprobe-'));
  const port = 9840 + Math.floor(Math.random() * 15);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=460,900', ORIGIN + '/tex_probe.html'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 160 && !target; i++) {
    await sleep(250);
    try {
      const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      target = l.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) { }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const wait = {};
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; } };
  const send = (m, p) => new Promise(res => { const i = ++id; wait[i] = res; ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  const ev = async (x) => {
    const r = await send('Runtime.evaluate', { expression: '(function(){' + x + '})()', returnByValue: true, awaitPromise: true });
    return r && r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable', {});
  await sleep(2500);
  console.log('  就绪: ' + await ev('return String(window.__ready) + " / canvases " + document.querySelectorAll("canvas").length;'));
  const full = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  if (full && full.result && full.result.data) {
    fs.writeFileSync(path.join(ROOT, 'docs', 'shots', 'tex_probe.png'),
      Buffer.from(full.result.data, 'base64'));
    console.log('  截图: docs/shots/tex_probe.png');
  }
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
})();
