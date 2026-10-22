// 拆解 40 只怪同屏时的绘制调用构成
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
  const NM = '测试拆' + Math.random().toString(36).slice(2, 5), PW = 'abc123456';
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brk-'));
  const port = 9620 + Math.floor(Math.random() * 12);
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

  const measure = `return (function () {
    rd.render(scene, cam);
    return JSON.stringify({ calls: rd.info.render.calls, tris: rd.info.render.triangles });
  })();`;

  console.log('  ① 全开: ' + await ev(measure));
  console.log('  ② 关阴影: ' + await ev('rd.shadowMap.enabled = false; rd.shadowMap.needsUpdate = true; ' + measure));
  const noLimb = await ev([
    'for (var k in NET.rmobs) { var m = NET.rmobs[k]; if (!m || !m.hh) { continue; }',
    '  if (m.hh.legL) { m.hh.legL.visible = false; } if (m.hh.legR) { m.hh.legR.visible = false; }',
    '  if (m.hh.armL) { m.hh.armL.visible = false; } if (m.hh.armR) { m.hh.armR.visible = false; } }',
    measure,
  ].join(''));
  console.log('  ③ 关阴影+隐藏四肢(模拟实例化后的上限): ' + noLimb);
  console.log('  ④ 恢复: ' + await ev([
    'rd.shadowMap.enabled = true; rd.shadowMap.needsUpdate = true;',
    'for (var k in NET.rmobs) { var m = NET.rmobs[k]; if (!m || !m.hh) { continue; }',
    '  if (m.hh.legL) { m.hh.legL.visible = !m.lodOn; } if (m.hh.legR) { m.hh.legR.visible = !m.lodOn; }',
    '  if (m.hh.armL) { m.hh.armL.visible = !m.lodOn; } if (m.hh.armR) { m.hh.armR.visible = !m.lodOn; } }',
    measure,
  ].join('')));

  // 也数一下场景里"谁在画"：按类型分组统计可见 mesh
  console.log('  分组: ' + await ev([
    'var g = { mobBody: 0, mobLimb: 0, prop: 0, other: 0 };',
    'for (var k in NET.rmobs) { var m = NET.rmobs[k]; if (!m || !m.hh) { continue; }',
    '  if (m.hh.body && m.hh.body.visible) { g.mobBody++; }',
    '  ["legL","legR","armL","armR"].forEach(function (n) { if (m.hh[n] && m.hh[n].visible) { g.mobLimb++; } });',
    '}',
    'scene.traverse(function (o) { if (o.isMesh && o.visible && !o.__mobPart) { g.other++; } });',
    'return JSON.stringify(g);',
  ].join('')));

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  await sleep(600);
  await act({ act: 'spawn', name: NM, n: 0, clear: 1 });
  await sleep(300);
  await act({ act: 'delplayer', name: NM });
})();
