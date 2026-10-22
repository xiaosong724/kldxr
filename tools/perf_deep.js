// 深挖：阴影投影体 / 每帧包大小 / 服务端 tick 成本（40 只怪压测）
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
  const NM = '测试D' + Math.random().toString(36).slice(2, 5), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: PW }),
  }).then(x => x.json());
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' }),
  }).then(x => x.json());
  const adminAct = (body) => fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at.token },
    body: JSON.stringify(body),
  }).then(x => x.json());
  const health = () => fetch(ORIGIN + '/api/health').then(x => x.json());

  // ---------- ① 裸 WS：量每帧包大小 ----------
  const bw = new WebSocket('ws://127.0.0.1:8900/ws');
  await new Promise(r => bw.onopen = r);
  let sizes = [];
  bw.onmessage = e => {
    try {
      const t = (typeof e.data === 'string') ? e.data : '';
      if (t && t.indexOf('"t":"world"') >= 0) { sizes.push(t.length); }
    } catch (x) { }
  };
  bw.send(JSON.stringify({ t: 'hello', d: { token: reg.token, ver: 1 } }));
  await sleep(2500);
  const base = { n: sizes.length, avg: sizes.length ? Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length) : 0 };
  console.log('  【包大小·基线】world 包 ' + JSON.stringify(base));

  await adminAct({ act: 'spawn', name: NM, n: 40 });
  await sleep(3000);
  sizes = [];
  await sleep(3000);
  const stressPkt = { n: sizes.length, avg: sizes.length ? Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length) : 0 };
  const h = await health();
  console.log('  【包大小·40 怪】world 包 ' + JSON.stringify(stressPkt) +
    ' （≈ ' + Math.round(stressPkt.avg * 30 / 1024) + ' KB/s）');
  console.log('  【服务端】mobs=' + h.world.mobs + ' tickMs=' + h.world.tickMs);

  // ---------- ② 浏览器：数投影体 + 各类开销 ----------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-'));
  const port = 9900 + Math.floor(Math.random() * 30);
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
      return '__THROW__ ' + String((ed.exception && ed.exception.description) || ed.text).split('\n')[0];
    }
    return r && r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable', {});
  await sleep(1500);
  await ev('localStorage.setItem("token",' + JSON.stringify(reg.token) + '); location.reload(); return 1;');
  await sleep(10000);
  await ev('P.x = 200; P.z = 200; return 1;');
  await sleep(1500);
  await adminAct({ act: 'spawn', name: NM, n: 40 });
  await sleep(3000);

  const deep = await ev([
    'return (function () {',
    '  var casters = 0, shadowMeshes = 0, transparent = 0, meshes = 0;',
    '  var matCount = {};',
    '  scene.traverse(function (o) {',
    '    if (o.isMesh) {',
    '      meshes++;',
    '      if (o.castShadow) { casters++; }',
    '      if (o.receiveShadow) { shadowMeshes++; }',
    '      var mm = Array.isArray(o.material) ? o.material : [o.material];',
    '      for (var i = 0; i < mm.length; i++) {',
    '        if (!mm[i]) { continue; }',
    '        if (mm[i].transparent) { transparent++; }',
    '        matCount[mm[i].uuid] = 1;',
    '      }',
    '    }',
    '  });',
    /* ★ 注意：拼成一行的表达式里不能用 // 注释 ✗ 会把后面全吞掉 ✓ */
    '  var t0 = performance.now();',
    '  for (var k = 0; k < 30; k++) { rd.render(scene, cam); }',
    '  var renderMs = (performance.now() - t0) / 30;',
    '  var snapText = JSON.stringify({ m: NET.rmobs, p: NET.others });',
    '  t0 = performance.now();',
    '  for (var k2 = 0; k2 < 30; k2++) { JSON.parse(snapText); }',
    '  var parseMs = (performance.now() - t0) / 30;',
    '  return JSON.stringify({',
    '    meshes: meshes, castShadow: casters, receiveShadow: shadowMeshes,',
    '    transparentMeshes: transparent, uniqMat: Object.keys(matCount).length,',
    '    mobs: Object.keys(NET.rmobs || {}).length,',
    '    calls: rd.info.render.calls, tris: rd.info.render.triangles,',
    '    renderMs: +renderMs.toFixed(2), parseMs: +parseMs.toFixed(3),',
    '    snapKB: +(snapText.length / 1024).toFixed(1),',
    '    shadowEnabled: rd.shadowMap.enabled, shadowSize: sun.shadow.mapSize.x',
    '  });',
    '})();',
  ].join(''));
  console.log('  【深挖·40 怪】' + deep);

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  try { bw.close(); } catch (e) { }
  await sleep(800);
  await adminAct({ act: 'spawn', name: NM, n: 0, clear: 1 });
  await sleep(500);
  await adminAct({ act: 'delplayer', name: NM });
})();
