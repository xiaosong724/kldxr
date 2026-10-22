// A1 验收：绘制调用降了、三角形没涨、近处肢体还在动、远处/LOD 走"挂回"分支
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
  const NM = '测试实例' + Math.random().toString(36).slice(2, 5), PW = 'abc123456';
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a1t-'));
  const port = 9540 + Math.floor(Math.random() * 12);
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
  await ev('P.x = 60; P.z = 60; wsSend("move", {x:60,z:60,yaw:0,t:performance.now()/1000}); return 1;');
  await sleep(900);
  await act({ act: 'spawn', name: NM, n: 40 });
  await sleep(2600);

  const st = await ev([
    'rd.render(scene, cam);',
    'var nb = 0, tot = 0;',
    'for (var k in LIMB_BUCKETS) { nb++; tot += LIMB_BUCKETS[k].mesh.count; }',
    'return JSON.stringify({ calls: rd.info.render.calls, tris: rd.info.render.triangles,',
    '  buckets: nb, instancedSlots: tot, liveLimbs: (Object.keys(NET.rmobs).length * 4) });',
  ].join(''));
  console.log('  状态: ' + st);
  const S = JSON.parse(st);
  ck(S.calls < 200, '★★ 绘制调用降到 200 以下（实测 ' + S.calls + '，优化前 314）', S.calls);
  ck(S.tris < 36000, '★★ 三角形没有变多（实测 ' + S.tris + '，优化前 32450）', S.tris);
  ck(S.buckets >= 2 && S.buckets <= 20, '★ 肢体被合并成 ' + S.buckets + ' 个批（原来 160 个网格）', S.buckets);

  // 近处那只：实例矩阵在动
  const m1 = await ev([
    'var best = null, bestD = 1e9;',
    'for (var k in NET.rmobs) { var m = NET.rmobs[k]; if (!m || !m.hh || m.lodOn) { continue; }',
    '  var d2 = (m.hh.g.position.x - P.x) ** 2 + (m.hh.g.position.z - P.z) ** 2;',
    '  if (d2 < bestD) { bestD = d2; best = m; } }',
    'if (!best || !best.hh.slots) { return "none"; }',
    'window.__m = best;',
    'var sl = best.hh.slots[0]; if (!sl || sl.idx < 0) { return "no slot"; }',
    'var arr = sl.bucket.mesh.instanceMatrix.array; var o = sl.idx * 16;',
    'return JSON.stringify({ idx: sl.idx, m0: +arr[o].toFixed(4), m12: +arr[o+12].toFixed(3), m13: +arr[o+13].toFixed(3) });',
  ].join(''));
  console.log('  近处肢体矩阵: ' + m1);
  await sleep(200);
  const m2 = await ev([
    'if (!window.__m || !window.__m.hh.slots) { return "lost"; }',
    'var sl = window.__m.hh.slots[0]; var arr = sl.bucket.mesh.instanceMatrix.array; var o = sl.idx * 16;',
    'return JSON.stringify({ m0: +arr[o].toFixed(4), m12: +arr[o+12].toFixed(3), m13: +arr[o+13].toFixed(3) });',
  ].join(''));
  console.log('  200ms 后: ' + m2);
  ck(m1 !== 'none' && m2 !== 'lost' && JSON.stringify(m1) !== JSON.stringify(m2),
    '★★ 近处怪的肢体在动（实例矩阵每帧在变）', [m1, m2]);

  // 远处/LOD：应当走"挂回模型"分支（attached=true），实例清零
  /* ★ lodOn 是每帧算出来的 ✗ 强制改会被覆盖 ✓
     改成模拟"倒地"（dying >= 0）—— 和 LOD 走的是同一个分支（attach）✓ */
  const far = await ev([
    'window.__m.dying = 0.01;',
    'return "ok";',
  ].join(''));
  await sleep(250);
  const farSt = await ev([
    'return JSON.stringify({ attached: !!window.__m.hh.attached,',
    '  children: window.__m.hh.g.children.length,',
    '  slots: (window.__m.hh.slots || []).length });',
  ].join(''));
  console.log('  LOD 分支: ' + farSt);
  const F = JSON.parse(farSt);
  ck(F.attached === true && F.children >= 4, '★★ 倒地/淡出走"挂回模型"分支（肢体挂回去了）', F);

  // 恢复
  await ev('window.__m.dying = -1; window.__m.alive = true; return 1;');
  await sleep(250);

  const shot = await ev('rd.render(scene, cam); return document.getElementById("cv").toDataURL("image/png");');
  if (typeof shot === 'string' && shot.indexOf('data:image/png') === 0) {
    fs.writeFileSync(path.join(ROOT, 'docs', 'shots', 'r434-limbinst.png'),
      Buffer.from(shot.split(',')[1], 'base64'));
    console.log('  截图: docs/shots/r434-limbinst.png');
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
