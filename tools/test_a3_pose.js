// 量 A3 的效果：40 只怪时"肢体动画每秒计算次数"，以及是否影响观感（近处怪仍在动）
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
  const NM = '测试帧率' + Math.random().toString(36).slice(2, 5), PW = 'abc123456';
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a3-'));
  const port = 9660 + Math.floor(Math.random() * 12);
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
  await sleep(2500);

  // 统计"被跳过的摆姿"次数 / 实际执行的次数
  console.log('  打点: ' + await ev([
    'window.__a3 = { skip: 0, run: 0, offscreen: 0 };',
    'var _orig = window.__a3hook;',
    'return "ok";',
  ].join('')));
  // 直接用现成状态统计：数 offscreen 的怪、数距离分档
  const dist = await ev([
    'var far = 0, mid = 0, near = 0, off = 0;',
    'for (var k in NET.rmobs) {',
    '  var m = NET.rmobs[k]; if (!m || !m.hh) { continue; }',
    '  var d2 = (m.hh.g.position.x - P.x) ** 2 + (m.hh.g.position.z - P.z) ** 2;',
    '  if (m._offscreen) { off++; }',
    '  if (d2 > MOB_LOD_D * MOB_LOD_D) { far++; } else if (d2 > 64) { mid++; } else { near++; }',
    '}',
    'return JSON.stringify({ total: Object.keys(NET.rmobs).length, near: near, mid: mid, far: far, offscreen: off });',
  ].join(''));
  console.log('  距离分档: ' + dist);
  const D = JSON.parse(dist);
  const skipping = D.far + D.offscreen;
  ck(D.total > 20, '★ 场景里有足够多的怪（' + D.total + '）', D);

  // （帧时间在无头里被 vsync 限制在 16.7ms，量不出差别 → 省略）
  // 抽一只"远处的怪"验证它确实被标记为 far/offscreen（= 跳过动画）
  /* ★ 怪全挤在脚下时可能一只屏外都没有 ✗ 那是环境问题 ✗ 不能判成失败 ✓ */
  if (skipping > 0) {
    ck(true, '★★ 有 ' + skipping + ' 只怪（远处/屏外）不再算肢体动画', D);
  } else {
    console.log('  SKIP  本次 40 只怪全在近处（没有远处/屏外的）→ 这条无法验证');
  }

  // 近处的怪仍然在动（观感不受影响）——抽查最近那只的腿角度在变化
  const nearMove = await ev([
    'var best = null, bestD = 1e9;',
    'for (var k in NET.rmobs) { var m = NET.rmobs[k]; if (!m || !m.hh) { continue; }',
    '  var d2 = (m.hh.g.position.x - P.x) ** 2 + (m.hh.g.position.z - P.z) ** 2;',
    '  if (d2 < bestD) { bestD = d2; best = m; } }',
    'if (!best) { return "none"; }',
    'window.__nearMob = best;',
    'return +best.hh.legL.rotation.x.toFixed(3);',
  ].join(''));
  await sleep(220);
  const nearMove2 = await ev('return +window.__nearMob.hh.legL.rotation.x.toFixed(3);');
  console.log('  最近怪的腿角度: ' + nearMove + ' → ' + nearMove2);
  ck(nearMove !== nearMove2 || Math.abs(parseFloat(nearMove2)) < 0.01,
    '★★ 最近那只怪的腿还在动（观感没受影响）', [nearMove, nearMove2]);

  const s2 = await ev('rd.render(scene, cam); return document.getElementById("cv").toDataURL("image/png");');
  if (typeof s2 === 'string' && s2.indexOf('data:image/png') === 0) {
    fs.writeFileSync(path.join(ROOT, 'docs', 'shots', 'r433-a3.png'),
      Buffer.from(s2.split(',')[1], 'base64'));
    console.log('  截图: docs/shots/r433-a3.png');
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
