// 找准朝向：让 20~25 米的怪出现在屏幕中央，然后拍"有腿 / 没腿"两张裁剪图
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
  const NM = '测试R' + Math.random().toString(36).slice(2, 5), PW = 'abc123456';
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

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lod3-'));
  const port = 9930 + Math.floor(Math.random() * 15);
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
  await sleep(9000);
  await ev('P.x = 200; P.z = 200; return 1;');
  await sleep(800);
  await act({ act: 'spawn', name: NM, n: 40 });
  await sleep(2200);
  await ev('P.x = 178; P.z = 200; return 1;');   // 怪落在 ~20m 外
  await sleep(700);

  // 试 4 个朝向，选“屏幕内怪最多”的那个
  const best = await ev([
    'return (function () {',
    '  var cx = 0, cz = 0, n = 0;',
    '  for (var k in NET.rmobs) { var m = NET.rmobs[k]; if (!m || !m.hh) { continue; }',
    '    cx += m.hh.g.position.x; cz += m.hh.g.position.z; n++; }',
    '  cx /= n; cz /= n;',
    '  var base = Math.atan2(cx - P.x, cz - P.z);',
    '  var best = null, bestN = -1;',
    '  var cand = [base, base + Math.PI, base + Math.PI / 2, base - Math.PI / 2];',
    '  for (var i = 0; i < cand.length; i++) {',
    '    P.yaw = cand[i];',
    '    cam.position.set(P.x - Math.sin(P.yaw) * 9, 9, P.z - Math.cos(P.yaw) * 9);',
    '    cam.lookAt(P.x, 1.2, P.z);',
    '    cam.updateMatrixWorld();',
    '    var v = new THREE.Vector3(), on = 0;',
    '    for (var k in NET.rmobs) { var m = NET.rmobs[k]; if (!m || !m.hh) { continue; }',
    '      v.copy(m.hh.g.position); v.y += 0.9; v.project(cam);',
    '      if (v.z > -1 && v.z < 1 && Math.abs(v.x) < 0.6 && Math.abs(v.y) < 0.6) { on++; } }',
    '    if (on > bestN) { bestN = on; best = cand[i]; }',
    '  }',
    '  P.yaw = best;',
    '  return JSON.stringify({ yaw: +best.toFixed(2), onscreen: bestN, mobs: n });',
    '})();',
  ].join(''));
  console.log('  朝向: ' + best);
  await sleep(1200);   // 让相机自己走回去

  const info = await ev([
    'return (function () {',
    '  var out = [], box = new THREE.Box3();',
    '  for (var k in NET.rmobs) {',
    '    var m = NET.rmobs[k];',
    '    if (!m || !m.hh || !m.hh.g) { continue; }',
    '    var g = m.hh.g;',
    '    var d = Math.hypot(g.position.x - P.x, g.position.z - P.z);',
    '    if (d < 15 || d > 32) { continue; }',
    '    box.setFromObject(g);',
    '    var lo = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2).project(cam);',
    '    var hi = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2).project(cam);',
    '    if (Math.abs(lo.x) > 0.55 || Math.abs(lo.y) > 0.55) { continue; }',
    '    out.push({ mid: k, d: +d.toFixed(1),',
    '      h: +(Math.abs(hi.y - lo.y) * 0.5 * innerHeight).toFixed(1),',
    '      sx: Math.round((lo.x * 0.5 + 0.5) * innerWidth),',
    '      sy: Math.round((-lo.y * 0.5 + 0.5) * innerHeight) });',
    '  }',
    '  out.sort(function (a, b) { return a.d - b.d; });',
    '  return JSON.stringify(out);',
    '})();',
  ].join(''));
  const list = JSON.parse(info);
  console.log('  屏幕内的中距离怪: ' + list.slice(0, 8).map(o => o.d + 'm/' + o.h + 'px@' + o.sx + ',' + o.sy).join('  '));
  const tgt = list.find(o => o.d >= 19 && o.d <= 26) || list[0];
  if (!tgt) { console.log('  没有合适的取样'); }
  else {
    const clip = { x: Math.max(0, tgt.sx - 40), y: Math.max(0, tgt.sy - tgt.h - 18),
                   width: 80, height: tgt.h + 34, scale: 5 };
    const a = await send('Page.captureScreenshot', { format: 'png', clip: clip });
    if (a && a.result && a.result.data) {
      fs.writeFileSync(path.join(ROOT, 'docs', 'shots', 'lod_crop_with_legs.png'),
        Buffer.from(a.result.data, 'base64'));
    }
    await ev([
      'for (var k in NET.rmobs) { var m = NET.rmobs[k]; if (!m || !m.hh) { continue; }',
      '  var d = Math.hypot(m.hh.g.position.x - P.x, m.hh.g.position.z - P.z);',
      '  if (d > 22) { m.hh.legL.visible = false; m.hh.legR.visible = false;',
      '    m.hh.armL.visible = false; m.hh.armR.visible = false; } }',
      'return 1;',
    ].join(''));
    await sleep(350);
    const b2 = await send('Page.captureScreenshot', { format: 'png', clip: clip });
    if (b2 && b2.result && b2.result.data) {
      fs.writeFileSync(path.join(ROOT, 'docs', 'shots', 'lod_crop_no_legs.png'),
        Buffer.from(b2.result.data, 'base64'));
    }
    console.log('  取样距离 ' + tgt.d + 'm · 屏幕高 ' + tgt.h + 'px · 腿宽约 '
      + (tgt.h * 0.32 / 1.9).toFixed(1) + 'px');
    console.log('  裁剪: docs/shots/lod_crop_with_legs.png / lod_crop_no_legs.png');
  }

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  await sleep(600);
  await act({ act: 'spawn', name: NM, n: 0, clear: 1 });
  await sleep(300);
  await act({ act: 'delplayer', name: NM });
})();
