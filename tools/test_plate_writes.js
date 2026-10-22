// 量：名牌 DOM 写入次数（优化前 vs 优化后）—— 40 只怪同屏 3 秒
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'];
const B = process.env.CHROME || CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const NM = '测试名' + Math.random().toString(36).slice(2, 5), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: PW }),
  }).then(x => x.json());
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' }),
  }).then(x => x.json());
  const act = (b) => fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at.token },
    body: JSON.stringify(b),
  }).then(x => x.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plate-'));
  const port = 9720 + Math.floor(Math.random() * 12);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=520,900', ORIGIN + '/'], { stdio: 'ignore' });
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
    if (r && r.result && r.result.exceptionDetails) {
      const ed = r.result.exceptionDetails;
      return '__THROW__ ' + String((ed.exception && ed.exception.description) || ed.text).split(String.fromCharCode(10))[0];
    }
    return r && r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable', {});
  await sleep(1500);
  await ev('localStorage.setItem("token",' + JSON.stringify(reg.token) + '); location.reload(); return 1;');
  await sleep(10000);
  await ev('P.x = 60; P.z = 60; wsSend("move", {x:60,z:60,yaw:0,t:performance.now()/1000}); return 1;');
  await sleep(900);
  await act({ act: 'spawn', name: NM, n: 40 });
  await sleep(2500);

  // 装计数器：包住 UI.plate 的四个写 DOM 的函数
  console.log('  计数器: ' + await ev([
    'window.__c = { move: 0, hp: 0, name: 0, text: 0, color: 0 };',
    'var o1 = UI.plate.move, o2 = UI.plate.hpWidth, o3 = UI.plate.name, o4 = UI.plate.barText, o5 = UI.plate.hpColor;',
    'UI.plate.move = function () { window.__c.move++; return o1.apply(UI.plate, arguments); };',
    'UI.plate.hpWidth = function () { window.__c.hp++; return o2.apply(UI.plate, arguments); };',
    'UI.plate.name = function () { window.__c.name++; return o3.apply(UI.plate, arguments); };',
    'UI.plate.barText = function () { window.__c.text++; return o4.apply(UI.plate, arguments); };',
    'UI.plate.hpColor = function () { window.__c.color++; return o5.apply(UI.plate, arguments); };',
    'return "ok";',
  ].join('')));
  await sleep(3000);
  const stat = await ev([
    'var c = window.__c;',
    'var total = c.move + c.hp + c.name + c.text + c.color;',
    'return JSON.stringify({ move: c.move, hp: c.hp, name: c.name, text: c.text, color: c.color,',
    '  total: total, perSec: Math.round(total / 3), domNodes: document.querySelectorAll("#uiplate *").length,',
    '  mobs: Object.keys(NET.rmobs).length, calls: rd.info.render.calls });',
  ].join(''));
  console.log('  3 秒内: ' + stat);
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  await sleep(600);
  await act({ act: 'spawn', name: NM, n: 0, clear: 1 });
  await sleep(300);
  await act({ act: 'delplayer', name: NM });
})();
