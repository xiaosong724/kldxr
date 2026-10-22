// 验证修好了：远处的怪（LOD 中）死亡时，不会出现"两套四肢"或"只剩手脚"
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
  const NM = '测试尸体' + Math.random().toString(36).slice(2, 5), PW = 'abc123456';
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpse-'));
  const port = 9220 + Math.floor(Math.random() * 12);
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
  await act({ act: 'spawn', name: NM, n: 4 });
  await sleep(1500);
  // 走远 → 让怪进入 LOD（18 米外）
  await ev('P.x = 100; P.z = 100; wsSend("move", {x:100,z:100,yaw:0,t:performance.now()/1000}); return 1;');
  await sleep(2500);
  const lod = await ev([
    'var far = 0, n = 0;',
    'for (var k in NET.rmobs) { var m = NET.rmobs[k]; if (!m || !m.hh) { continue; } n++; if (m.lodOn) { far++; } }',
    'return JSON.stringify({ mobs: n, lodOn: far });',
  ].join(''));
  console.log('  远处: ' + lod);
  const L = JSON.parse(lod);

  if (L.lodOn > 0) {
    // 让其中一只"死"（走和服务器 alive=0 同一条分支）
    const st = await ev([
      'var pick = null;',
      'for (var k in NET.rmobs) { var m = NET.rmobs[k]; if (m && m.lodOn) { pick = m; break; } }',
      'if (!pick) { return "none"; }',
      'window.__c = pick;',
      'pick.dying = 0.01;',
      'return "ok";',
    ].join(''));
    await sleep(400);
    const after = await ev([
      'var m = window.__c;',
      'if (!m || !m.hh) { return "gone"; }',
      'return JSON.stringify({',
      '  attached: !!m.hh.attached,',
      '  bodyVisible: !!(m.hh.body && m.hh.body.visible),',
      '  lodVisible: !!(m.hh.lod && m.hh.lod.visible),',
      '  limbsVisible: (m.hh.limbs || []).filter(function (l) { return l.visible; }).length,',
      '  limbCount: (m.hh.limbs || []).length',
      '});',
    ].join(''));
    console.log('  死后: ' + after);
    const A = JSON.parse(after);
    ck(A.bodyVisible === true, '★★ 尸体用普通模型显示（body 可见）', A);
    ck(A.lodVisible === false, '★★ LOD 模型关掉了（不会多出一套手脚）', A);
    ck(A.attached === true && A.limbsVisible === 4, '★★ 四肢挂回去了而且可见（4 条）', A);
  } else {
    console.log('  SKIP  这次没有进入 LOD 的怪（环境问题）');
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
