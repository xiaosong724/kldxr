// 量：场景里有多少"静态但每帧仍在重算矩阵"的对象；updateMatrixWorld 一次多贵
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
  const NM = '测试矩' + Math.random().toString(36).slice(2, 5), PW = 'abc123456';
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtx-'));
  const port = 9700 + Math.floor(Math.random() * 12);
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
  await sleep(1000);
  await act({ act: 'spawn', name: NM, n: 40 });
  await sleep(3000);

  const rep = await ev([
    'var st = { total: 0, autoTrue: 0, autoFalse: 0, meshes: 0 };',
    'scene.traverse(function (o) {',
    '  st.total++;',
    '  if (o.isMesh) { st.meshes++; }',
    '  if (o.matrixAutoUpdate) { st.autoTrue++; } else { st.autoFalse++; }',
    '});',
    'var t0 = performance.now();',
    'for (var i = 0; i < 20; i++) { scene.updateMatrixWorld(true); }',
    'var mw = (performance.now() - t0) / 20;',
    'return JSON.stringify({ total: st.total, meshes: st.meshes, autoTrue: st.autoTrue,',
    '  autoFalse: st.autoFalse, updateMatrixWorldMs: +mw.toFixed(3),',
    '  calls: rd.info.render.calls, mobs: Object.keys(NET.rmobs).length });',
  ].join(''));
  console.log('  基线: ' + rep);

  // 试探：把所有"静态"网格（非 mob / 非玩家）设成 autoUpdate=false 之后，updateMatrixWorld 便宜多少
  const after = await ev([
    'var changed = 0;',
    'scene.traverse(function (o) {',
    '  if (!o.isMesh && !o.isGroup) { return; }',
    '  if (o.__dyn) { return; }',
    '  if (o.matrixAutoUpdate) { o.updateMatrix(); o.matrixAutoUpdate = false; changed++; }',
    '});',
    'var t0 = performance.now();',
    'for (var i = 0; i < 20; i++) { scene.updateMatrixWorld(true); }',
    'var mw = (performance.now() - t0) / 20;',
    'return JSON.stringify({ changed: changed, updateMatrixWorldMs: +mw.toFixed(3) });',
  ].join(''));
  console.log('  全静止化后: ' + after);

  await act({ act: 'spawn', name: NM, n: 0, clear: 1 });
  try { spawn('taskkill', ['/PID', String(proc.proc ? proc.proc.pid : proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  await sleep(600);
  await act({ act: 'delplayer', name: NM });
})();
