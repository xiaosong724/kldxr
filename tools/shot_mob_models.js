// 精英 / BOSS 模型概念图截图（不依赖游戏逻辑，直接打开 web/model_show.html）
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = process.env.PAGE || 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'];
const B = process.env.CHROME || CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mobmodel-'));
  const port = 9970 + Math.floor(Math.random() * 12);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 120 && !target; i++) {
    await sleep(250);
    try {
      const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      target = l.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) { }
  }
  if (!target) { console.error('Chrome 没起来'); process.exit(1); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const wait = {};
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; } };
  const send = (m, p) => new Promise(res => { const i = ++id; wait[i] = res; ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  await send('Page.enable', {});
  await send('Runtime.enable', {});
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  const shots = [['elite', 'mob-elite-model.png'], ['boss', 'mob-boss-model.png']];
  for (const [g, fn] of shots) {
    await send('Page.navigate', { url: ORIGIN + '/model_show.html?g=' + g + '&t=' + Date.now() });
    await sleep(2600);
    const r = await send('Runtime.evaluate', { expression: 'window.__ready === true', returnByValue: true });
    if (!r.result || !r.result.result || !r.result.result.value) {
      console.error('页面未 ready：' + g);
      continue;
    }
    const s = await send('Page.captureScreenshot', { format: 'png' });
    const out = path.join(ROOT, 'docs', 'shots', fn);
    fs.writeFileSync(out, Buffer.from(s.result.data, 'base64'));
    console.log('存: docs/shots/' + fn);
  }
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
})();
