// 性能体检：采集 renderer.info / 场景规模 / 帧时间 / 内存，并对比几档画质
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
  const NM = '测试P' + Math.random().toString(36).slice(2, 5), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: PW }),
  }).then(x => x.json());
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' }),
  }).then(x => x.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-'));
  const port = 9930 + Math.floor(Math.random() * 30);
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
  // 走到有怪的地方（离出生点 40 米）
  await ev('P.x = 40; P.z = 40; return 1;');
  await sleep(1500);

  const probe = [
    'function frameTimes(ms) {',
    '  return new Promise(function (res) {',
    '    var arr = [], t0 = performance.now(), last = t0;',
    '    (function tick(t) {',
    '      if (t - last > 0) { arr.push(t - last); }',
    '      last = t;',
    '      if (t - t0 < ms) { requestAnimationFrame(tick); }',
    '      else { arr.sort(function (a, b) { return a - b; });',
    '        var q = function (p) { return arr[Math.min(arr.length - 1, Math.floor(arr.length * p))]; };',
    '        res({ n: arr.length, p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2),',
    '              max: +arr[arr.length - 1].toFixed(2) }); }',
    '    })(t0);',
    '  });',
    '}',
    'function sceneStats() {',
    '  var meshes = 0, inst = 0, mats = {}, geos = {}, lines = 0;',
    '  scene.traverse(function (o) {',
    '    if (o.isMesh) { meshes++; }',
    '    if (o.isInstancedMesh) { inst++; }',
    '    if (o.isLine) { lines++; }',
    '    if (o.material) {',
    '      var mm = Array.isArray(o.material) ? o.material : [o.material];',
    '      for (var i = 0; i < mm.length; i++) { mats[mm[i].uuid] = 1; }',
    '    }',
    '    if (o.geometry && o.geometry.uuid) { geos[o.geometry.uuid] = 1; }',
    '  });',
    '  return { meshes: meshes, instanced: inst, lines: lines,',
    '    uniqMaterials: Object.keys(mats).length,',
    '    uniqGeometries: Object.keys(geos).length,',
    '    sceneChildren: scene.children.length,',
    '    plates: document.querySelectorAll("#uiplate *").length };',
    '}',
    'return (async function () {',
    '  var out = {};',
    '  out.settings = { dpr: (typeof DPR === "number") ? DPR : null,',
    '    devDpr: devicePixelRatio, aa: (typeof AA_MODE !== "undefined") ? AA_MODE : null,',
    '    detail: (typeof setDetail === "function") ? setDetail() : null,',
    '    shadow: (typeof setShadow === "function") ? setShadow() : null,',
    '    zoom: (typeof setWorldZoom === "function") ? setWorldZoom() : null,',
    '    canvas: [innerWidth, innerHeight] };',
    '  out.scene = sceneStats();',
    '  out.render = JSON.parse(JSON.stringify(rd.info.render));',
    '  out.memory = JSON.parse(JSON.stringify(rd.info.memory));',
    '  out.programs = (rd.info.programs || []).length;',
    '  out.frame = await frameTimes(3000);',
    '  if (performance.memory) {',
    '    out.jsHeapMB = +(performance.memory.usedJSHeapSize / 1048576).toFixed(1);',
    '  }',
    '  out.mobs = Object.keys(NET.rmobs || {}).length;',
    '  out.others = Object.keys(NET.others || {}).length;',
    '  out.loot = Object.keys(NET.rloot || {}).length;',
    '  return JSON.stringify(out);',
    '})();',
  ].join('');
  const r1 = await ev(probe);
  console.log('  【默认画质】' + r1);

  // 低画质
  await ev('SETCFG.dpr = 1.0; SETCFG.shadow = "off"; SETCFG.detail = "low"; SETCFG.zoom = 100; applySet(); return 1;');
  await sleep(2000);
  const r2 = await ev(probe);
  console.log('  【低画质 dpr1/无阴影/近视野】' + r2);

  // 高画质
  await ev('SETCFG.dpr = 2.5; SETCFG.shadow = "high"; SETCFG.detail = "high"; applySet(); return 1;');
  await sleep(2000);
  const r3 = await ev(probe);
  console.log('  【高画质 dpr2.5/高阴影/远视野】' + r3);

  // 视角拉远（80%）
  await ev('SETCFG.zoom = 80; applySet(); return 1;');
  await sleep(1500);
  const r4 = await ev(probe);
  console.log('  【80% 视野】' + r4);

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  await sleep(1000);
  await fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at.token },
    body: JSON.stringify({ act: 'delplayer', name: NM }),
  }).catch(() => null);
})();
