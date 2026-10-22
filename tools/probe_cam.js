// probe_cam.js -- 用真实触摸事件量"拖不动 / 抖"到底怎么回事
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe'];
const B = CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const nm = '探针' + Math.random().toString(36).slice(2, 5);
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nm, password: 'abc123456' })
  }).then(x => x.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-'));
  const port = 5800 + Math.floor(Math.random() * 60);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=960,720', 'about:blank'], { stdio: 'ignore' });
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
  let id = 0; const wait = {};
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; } };
  const send = (mm, pp) => new Promise(res => { const i = ++id; wait[i] = res; ws.send(JSON.stringify({ id: i, method: mm, params: pp || {} })); });
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true })).result.result.value;

  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.navigate', { url: ORIGIN + '/?t=' + Date.now() });
  await sleep(1200);
  await ev('localStorage.setItem("token",' + JSON.stringify(reg.token) + ')');
  await send('Page.reload', {});
  await sleep(9000);
  await ev('try{annClose()}catch(e){}');

  await ev('camToggle(); camSet(0,1.02);');
  await sleep(300);

  console.log('开始前:', await ev('JSON.stringify({on:CAMROT.on, dragId:CAMROT.dragId, yaw:CAM_YAW_T})'));

  // 真实触摸：右半屏 (700,360) 往右拖到 (900,360)
  const x0 = 700, y0 = 360;
  await send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1 }]
  });
  await sleep(60);
  const out = [];
  for (let i = 1; i <= 10; i++) {
    await send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: x0 + i * 20, y: y0, id: 1 }]
    });
    await sleep(50);
    out.push(await ev('JSON.stringify({t:+CAM_YAW_T.toFixed(3), c:+CAM_YAW.toFixed(3), lx:CAMROT.lx})'));
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  console.log('每步 yaw（目标/当前/记录点）:');
  out.forEach((s, i) => console.log('  ' + (i + 1) + ': ' + s));
  await sleep(500);
  console.log('结束:', await ev('JSON.stringify({yawT:+CAM_YAW_T.toFixed(3), yaw:+CAM_YAW.toFixed(3)})'));
  console.log('按钮状态:', await ev('JSON.stringify({on:CAMROT.on})'));

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
})();
