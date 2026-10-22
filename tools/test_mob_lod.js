// A2 验收：18 米外切 LOD 后 —— 绘制调用降多少 + 远处还看得出是"有腿的怪"吗
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
let FAILS = 0;
function ck(c, m, got) {
  if (c) { console.log('  PASS  ' + m); }
  else { FAILS++; console.log('  FAIL  ' + m + (got !== undefined ? '  got=' + JSON.stringify(got) : '')); }
}
(async () => {
  const NM = '测试G' + Math.random().toString(36).slice(2, 5), PW = 'abc123456';
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lodv-'));
  const port = 9945 + Math.floor(Math.random() * 15);
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
  const errs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') {
      errs.push(((m.params.exceptionDetails || {}).exception || {}).description || 'err');
    }
    if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; }
  };
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
  await ev('P.x = 200; P.z = 200; return 1;');
  await sleep(800);
  await act({ act: 'spawn', name: NM, n: 40 });
  await sleep(2500);
  // 玩家后撤 25 米 → 大部分怪在 18 米外
  await ev('P.x = 176; P.z = 200; return 1;');
  await sleep(1400);

  const measure = [
    'return (function () {',
    '  var far = 0, near = 0, lodOn = 0, cx = 0, cz = 0, n = 0;',
    '  for (var k in NET.rmobs) {',
    '    var m = NET.rmobs[k];',
    '    if (!m || !m.hh || !m.hh.g) { continue; }',
    '    var d = Math.hypot(m.hh.g.position.x - P.x, m.hh.g.position.z - P.z);',
    '    if (d > MOB_LOD_D) { far++; } else { near++; }',
    '    if (m.lodOn) { lodOn++; }',
    '    cx += m.hh.g.position.x; cz += m.hh.g.position.z; n++;',
    '  }',
    /* 相机放到"玩家身后 8 米、朝向怪群中心"——必须手动摆，不然怪在背后被剔除 ✗ */
    '  var oldP = cam.position.clone(), oldQ = cam.quaternion.clone(), oldF = cam.fov;',
    '  cx /= (n || 1); cz /= (n || 1);',
    '  cam.position.set(P.x - (cx - P.x) / (Math.hypot(cx - P.x, cz - P.z) || 1) * 8, 6.5,',
    '    P.z - (cz - P.z) / (Math.hypot(cx - P.x, cz - P.z) || 1) * 8);',
    '  cam.lookAt(cx, 1.0, cz); cam.updateMatrixWorld(true); cam.updateProjectionMatrix();',
    '  var t0 = performance.now();',
    '  for (var i = 0; i < 20; i++) { rd.render(scene, cam); }',
    '  var ms = (performance.now() - t0) / 20;',
    '  cam.position.copy(oldP); cam.quaternion.copy(oldQ); cam.updateMatrixWorld(true);',
    '  return JSON.stringify({ near: near, far: far, lodOn: lodOn,',
    '    calls: rd.info.render.calls, tris: rd.info.render.triangles,',
    '    renderMs: +ms.toFixed(2) });',
    '})();',
  ].join('');

  // ① 开 LOD
  await ev('MOB_LOD_D = 18; return 1;');
  await sleep(900);
  const a = await ev(measure);
  console.log('  【LOD 开（18 米）】' + a);

  // ② 关 LOD（阈值调到天上）
  await ev('MOB_LOD_D = 9999; return 1;');
  await sleep(900);
  const b = await ev(measure);
  console.log('  【LOD 关】' + b);

  const A = JSON.parse(a), Bv = JSON.parse(b);
  ck(A.lodOn === A.far, '★★ 18 米外的怪都切到了 LOD（' + A.lodOn + '/' + A.far + '）', A);
  ck(A.calls < Bv.calls, '★★ 切 LOD 后绘制调用下降：' + Bv.calls + ' → ' + A.calls, [Bv.calls, A.calls]);

  // ③ 远处形态：截一张"远处怪"的放大图（看腿还在不在）
  await ev('MOB_LOD_D = 18; return 1;');
  await sleep(600);
  // ① 找准朝向（★ 每个候选都要等一帧，相机位置是主循环每帧才更新的）
  const baseYaw = await ev([
    'var cx = 0, cz = 0, n = 0;',
    'for (var k in NET.rmobs) { var m = NET.rmobs[k]; if (!m || !m.hh) { continue; }',
    '  cx += m.hh.g.position.x; cz += m.hh.g.position.z; n++; }',
    'cx /= (n || 1); cz /= (n || 1);',
    'return autoFacing(cx - P.x, cz - P.z);',
  ].join(''));
  const cands = [baseYaw, baseYaw + Math.PI, baseYaw + Math.PI / 2, baseYaw - Math.PI / 2];
  let bestYaw = baseYaw, bestOn = -1;
  for (let i = 0; i < cands.length; i++) {
    await ev('P.yaw = ' + cands[i] + '; return 1;');
    await sleep(420);
    const on = await ev([
      'return (function () {',
      '  var v = new THREE.Vector3(), on = 0;',
      '  cam.updateMatrixWorld(true); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();',
      '  for (var k in NET.rmobs) { var m = NET.rmobs[k]; if (!m || !m.hh) { continue; }',
      '    v.copy(m.hh.g.position); v.y += 1.0; v.project(cam);',
      '    if (v.z > -1 && v.z < 1 && Math.abs(v.x) < 0.65 && Math.abs(v.y) < 0.65) { on++; } }',
      '  return on;',
      '})();',
    ].join(''));
    console.log('    候选 yaw=' + cands[i].toFixed(2) + ' → 屏幕内 ' + on + ' 只');
    if (on > bestOn) { bestOn = on; bestYaw = cands[i]; }
  }
  await ev('P.yaw = ' + bestYaw + '; return 1;');
  await sleep(700);
  console.log('  朝向: yaw=' + bestYaw.toFixed(3) + '（屏幕内 ' + bestOn + ' 只）');

  // ② 用游戏相机算一只 20~30 米怪的屏幕位置
  const spot = await ev([
    'return (function () {',
    '  var best = null, box = new THREE.Box3();',
    '  cam.updateMatrixWorld(true); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();',
    '  for (var k in NET.rmobs) {',
    '    var m = NET.rmobs[k];',
    '    if (!m || !m.hh || !m.hh.lod || !m.lodOn) { continue; }',
    '    var g = m.hh.g;',
    '    var d = Math.hypot(g.position.x - P.x, g.position.z - P.z);',
    '    if (d < 20 || d > 32) { continue; }',
    '    box.setFromObject(g);',
    '    var lo = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2).project(cam);',
    '    if (Math.abs(lo.x) > 0.42 || Math.abs(lo.y) > 0.42) { continue; }',
    '    var hi = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2).project(cam);',
    '    best = { d: +d.toFixed(1), h: +(Math.abs(hi.y - lo.y) * 0.5 * innerHeight).toFixed(1),',
    '      sx: Math.round((lo.x * 0.5 + 0.5) * innerWidth),',
    '      sy: Math.round((-lo.y * 0.5 + 0.5) * innerHeight) };',
    '    break;',
    '  }',
    '  return JSON.stringify(best);',
    '})();',
  ].join(''));
  console.log('  远处取样: ' + spot);
  let sp = null;
  try { sp = JSON.parse(spot); } catch (e) { }
  if (sp && sp.h) {
    const clip = { x: Math.max(0, sp.sx - 36), y: Math.max(0, sp.sy - sp.h - 14),
                   width: 72, height: sp.h + 28, scale: 6 };
    const s1 = await send('Page.captureScreenshot', { format: 'png', clip: clip });
    if (s1 && s1.result && s1.result.data) {
      fs.writeFileSync(path.join(ROOT, 'docs', 'shots', 'lod_far_on.png'),
        Buffer.from(s1.result.data, 'base64'));
    }
    await ev('MOB_LOD_D = 9999; return 1;');
    await sleep(500);
    const s2 = await send('Page.captureScreenshot', { format: 'png', clip: clip });
    if (s2 && s2.result && s2.result.data) {
      fs.writeFileSync(path.join(ROOT, 'docs', 'shots', 'lod_far_off.png'),
        Buffer.from(s2.result.data, 'base64'));
    }
    console.log('  对比图: docs/shots/lod_far_on.png（LOD）· lod_far_off.png（原模型）');
  }

  const s = await send('Page.captureScreenshot', { format: 'png' });
  if (s && s.result && s.result.data) {
    fs.writeFileSync(path.join(ROOT, 'docs', 'shots', 'r426-lod.png'),
      Buffer.from(s.result.data, 'base64'));
  }
  console.log('  页面异常: ' + (errs.length ? errs.slice(0, 2).join(' | ') : '（无 ✓）'));
  ck(errs.length === 0, '★ 页面 0 异常', errs.slice(0, 2));

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  await sleep(600);
  await act({ act: 'spawn', name: NM, n: 0, clear: 1 });
  await sleep(300);
  await act({ act: 'delplayer', name: NM });
  console.log('');
  console.log(FAILS ? ('FAILED: ' + FAILS) : 'ALL PASS ✓');
  process.exit(FAILS ? 1 : 0);
})();
