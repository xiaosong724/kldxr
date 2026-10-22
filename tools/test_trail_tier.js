// 品阶色验收：0/4/7/10 阶的拖影颜色必须不一样，且和 LOOT_COL 对得上
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
  const NM = '测试C' + Math.random().toString(36).slice(2, 5), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: PW }),
  }).then(x => x.json());
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' }),
  }).then(x => x.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcol-'));
  const port = 9995 + Math.floor(Math.random() * 5);
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
  await sleep(500);

  const cols = await ev([
    'var out = {};',
    '[0, 4, 7, 10, 11].forEach(function (t) {',
    '  var c = trailColorOf(t);',
    '  out[t] = [ +c[0].toFixed(2), +c[1].toFixed(2), +c[2].toFixed(2), c[3] ];',
    '});',
    'return JSON.stringify(out);',
  ].join(''));
  console.log('  品阶色: ' + cols);
  const C = JSON.parse(cols);
  ck(JSON.stringify(C[0]) !== JSON.stringify(C[10]), '★★ 0 阶和 10 阶颜色不一样', [C[0], C[10]]);
  ck(C[10][0] > C[0][0], '★★ 10 阶比 0 阶亮（颜色不分高低，亮度分）', [C[0][0], C[10][0]]);
  ck(C[7][2] > 0.6 && C[7][1] < 0.5, '★ 7 阶是粉紫（蓝高、绿低 ✓）', C[7]);
  ck(C[4][0] > C[4][2], '★ 4 阶偏暖（LOOT_COL 是金色）', C[4]);

  // 真的挥一刀，看顶点色是不是用了品阶色
  const live = await ev([
    'MY_WEAPON = { look: "sword", tier: 10 }; fillHeldWeapon(H.sw, "sword", 10);',
    'atkCd = 0; atkT = -1; atkHeld = true;',
    'return 1;',
  ].join(''));
  await sleep(320);
  const vc = await ev([
    'var a = TRAIL.colAttr.array;',
    'var i = 0, best = -1, bi = 0;',
    'for (; i < a.length; i += 3) { var s = a[i] + a[i+1] + a[i+2]; if (s > best) { best = s; bi = i; } }',
    'return JSON.stringify({r:+a[bi].toFixed(2), g:+a[bi+1].toFixed(2), b:+a[bi+2].toFixed(2),',
    '  tier: TRAIL.tier, on: TRAIL.on, pts: TRAIL.pts.length});',
  ].join(''));
  console.log('  挥砍中顶点色: ' + vc);
  const V = JSON.parse(vc);
  ck(V.tier === 10 && V.pts > 3, '★★ 拖影用的是当前武器品阶（10 阶）', V);
  ck(Math.abs(V.r - C[10][0]) < 0.35, '★★ 顶点色 = 品阶色（10 阶偏白/亮）', [V, C[10]]);

  // 截图（10 阶刀光的颜色）
  await ev(['window.__cam2 = function () {',
    '  var y = P.yaw + 1.55;',
    '  cam.position.set(P.x + Math.sin(y) * 2.6, 1.55, P.z + Math.cos(y) * 2.6);',
    '  cam.lookAt(P.x + Math.sin(P.yaw) * 0.5, 1.0, P.z + Math.cos(P.yaw) * 0.5);',
    '  cam.updateMatrixWorld(true); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();',
    '  return 1; };', 'return 1;'].join(''));
  const shot = await ev('window.__cam2(); rd.render(scene, cam); return document.getElementById("cv").toDataURL("image/png");');
  if (typeof shot === 'string' && shot.indexOf('data:image/png') === 0) {
    fs.writeFileSync(path.join(ROOT, 'docs', 'shots', 'trail_tier10.png'),
      Buffer.from(shot.split(',')[1], 'base64'));
    console.log('  截图: docs/shots/trail_tier10.png');
  }
  await ev('atkHeld = false; return 1;');
  console.log('  页面异常: ' + (errs.length ? errs.slice(0, 2).join(' | ') : '（无 ✓）'));
  ck(errs.length === 0, '★ 页面 0 异常', errs.slice(0, 2));

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  await sleep(600);
  await fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at.token },
    body: JSON.stringify({ act: 'delplayer', name: NM }),
  }).catch(() => null);
  console.log('');
  console.log(FAILS ? ('FAILED: ' + FAILS) : 'ALL PASS ✓');
  process.exit(FAILS ? 1 : 0);
})();
