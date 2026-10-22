// 把 20 款皮肤预览页截成图片（用无头 Chrome）
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'];
const B = process.env.CHROME || CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const fileUrl = 'file:///' + path.join(ROOT, 'tools', process.env.PREVIEW || 'preview_skins20.html').replace(/\\/g, '/');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-'));
  const port = 4320 + Math.floor(Math.random() * 14);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1520,' + (process.env.WINH || 1700), '--hide-scrollbars', fileUrl], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 150 && !target; i++) {
    await sleep(250);
    try {
      const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      target = l.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) { }
  }
  if (!target) { console.log('没连上 Chrome'); process.exit(1); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const wait = {};
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; } };
  const send = (m, p) => new Promise(res => { const i = ++id; wait[i] = res; ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  const ev = async (x) => {
    const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    if (r && r.result && r.result.exceptionDetails) {
      return '__THROW__ ' + String(r.result.exceptionDetails.text);
    }
    return r && r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable', {});
  // 等页面把模型建好
  for (let i = 0; i < 40; i++) {
    const ok = await ev('!!window.__ready');
    if (ok === true) { break; }
    await sleep(250);
  }
  const n = await ev('document.querySelectorAll("#legend div, #labels .lb").length');
  console.log('皮肤数量:', n);
  await sleep(900);
  const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  if (s && s.result && s.result.data) {
    const out = path.join(ROOT, 'docs', 'shots', process.env.OUT || 'skins-20.png');
    fs.writeFileSync(out, Buffer.from(s.result.data, 'base64'));
    console.log('存:', out);
  } else {
    console.log('截图失败');
  }
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
})();
