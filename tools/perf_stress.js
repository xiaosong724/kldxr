// 性能体检 2：真渲染成本 + 僵尸压力测试（用管理接口刷怪）
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
  const NM = '测试Q' + Math.random().toString(36).slice(2, 5), PW = 'abc123456';
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

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf2-'));
  const port = 9940 + Math.floor(Math.random() * 30);
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
  await ev('P.x = 200; P.z = 200; return 1;');   // 离出生点远一点，避免安全区
  await sleep(2000);

  const measure = [
    'return (function () {',
    '  var t0 = performance.now();',
    '  for (var i = 0; i < 40; i++) { rd.render(scene, cam); }',
    '  var cost = (performance.now() - t0) / 40;',
    '  var meshes = 0, mats = {};',
    '  scene.traverse(function (o) { if (o.isMesh) { meshes++; }',
    '    if (o.material) { var mm = Array.isArray(o.material) ? o.material : [o.material];',
    '      for (var k = 0; k < mm.length; k++) { mats[mm[k].uuid] = 1; } } });',
    '  return JSON.stringify({ calls: rd.info.render.calls, tris: rd.info.render.triangles,',
    '    meshes: meshes, uniqMat: Object.keys(mats).length,',
    '    renderMs: +cost.toFixed(2), mobs: Object.keys(NET.rmobs || {}).length,',
    '    progs: (rd.info.programs || []).length });',
    '})();',
  ].join('');

  async function step(label, spawnN, settings) {
    if (settings) {
      await ev('SETCFG.dpr = ' + settings.dpr + '; SETCFG.shadow = "' + settings.shadow
        + '"; SETCFG.detail = "' + settings.detail + '"; applySet(); return 1;');
      await sleep(1200);
    }
    if (spawnN != null) {
      // ★ 不能带 clear：_debug_spawn 里 clear=true 就「只清不刷」立刻 return ✗✗
      const r = await adminAct({ act: 'spawn', name: NM, n: spawnN });
      console.log('   [刷怪 ' + spawnN + '] ' + JSON.stringify(r).slice(0, 80));
      await sleep(2600);
    }
    const out = await ev(measure);
    console.log('  ' + label + '\n    ' + out);
  }

  await step('【基线】默认画质 + 正常刷怪', 0, null);
  await step('【压力 1】清怪后刷 30 只', 30, null);
  await step('【压力 2】刷 60 只', 60, null);
  await step('【压力 2 + 低画质 dpr1/无阴影/low】', null, { dpr: 1.0, shadow: 'off', detail: 'low' });
  await step('【压力 2 + 高画质 dpr2.5/高阴影/high】', null, { dpr: 2.5, shadow: 'high', detail: 'high' });
  await step('【清怪收尾】', 0, { dpr: 2.0, shadow: 'high', detail: 'mid' });

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  await sleep(1000);
  await adminAct({ act: 'delplayer', name: NM });
})();
