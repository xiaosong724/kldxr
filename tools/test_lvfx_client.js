// 验收（客户端）：快照里带 lvfx 时，会放远程特效 + 播雷声；本人那条不重复放
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'];
const B = process.env.CHROME || CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let FAILS = 0;
function ck(c, m, got) {
  if (c) { console.log('  PASS  ' + m); }
  else { FAILS++; console.log('  FAIL  ' + m + (got !== undefined ? '  got=' + JSON.stringify(got) : '')); }
}
(async () => {
  const NM = '测试远程' + Math.random().toString(36).slice(2, 5), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: PW }),
  }).then(x => x.json());
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' }),
  }).then(x => x.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lvfx-'));
  const port = 8320 + Math.floor(Math.random() * 14);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--autoplay-policy=no-user-gesture-required',
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
  await sleep(1200);
  await ev('localStorage.setItem("token",' + JSON.stringify(reg.token) + '); location.reload(); return 1;');
  await sleep(10000);
  await ev('P.x = 60; P.z = 60; wsSend("move", {x:60,z:60,yaw:0,t:performance.now()/1000}); return 1;');
  await sleep(900);

  ck((await ev('return (SFX_BANK.thunder || []).length;')) > 0, '★★ 雷声已加载（核心集）');

  // ① 别人的突破（同屏 5 米）→ 应当放远程特效 + 雷声
  await ev([
    'window.__sfx = []; var _o = sfx; sfx = function (n, v, c) { window.__sfx.push([n, v]); return _o(n, v, c); };',
    'window.__n0 = _lvFx.length;',
    'wsApplyWorld({ ts: performance.now() / 1000, lvfx: [[P.x + 5, P.z, 9, 0]] });',
    'return 1;',
  ].join(''));
  await sleep(200);
  const r1 = JSON.parse(await ev([
    'return JSON.stringify({ added: _lvFx.length - window.__n0,',
    '  kinds: _lvFx.map(function (f) { return f.kind; }),',
    '  thunder: window.__sfx.filter(function (x) { return x[0] === "thunder"; }) });',
  ].join('')));
  console.log('  别人的突破: ' + JSON.stringify(r1));
  ck(r1.added >= 10, '★★ 远程突破特效放出来了（' + r1.added + ' 个对象）', r1.added);
  ck(r1.kinds.indexOf('bolt') >= 0 && r1.kinds.indexOf('arc') >= 0, '★★ 闪电/弧光都在', r1.kinds);
  ck(r1.thunder.length >= 1, '★★ 播放了雷声', r1.thunder);
  ck(r1.thunder.length && r1.thunder[0][1] <= 0.9, '★★ 远处雷声有衰减（音量 ' + (r1.thunder[0] || [])[1] + '）', r1.thunder);

  // 等特效放完
  await sleep(1400);
  ck((await ev('return _lvFx.length;')) === 0, '★ 特效自己清理干净');

  // ② 自己那条（flag=1）→ 不该重复放
  await ev([
    'window.__sfx = [];',
    'window.__n1 = _lvFx.length;',
    'wsApplyWorld({ ts: performance.now() / 1000, lvfx: [[P.x, P.z, 10, 1]] });',
    'return 1;',
  ].join(''));
  await sleep(200);
  const r2 = JSON.parse(await ev([
    'return JSON.stringify({ added: _lvFx.length - window.__n1,',
    '  thunder: window.__sfx.filter(function (x) { return x[0] === "thunder"; }).length });',
  ].join('')));
  console.log('  自己那条: ' + JSON.stringify(r2));
  ck(r2.added === 0 && r2.thunder === 0, '★★ 本人那条不会重复放（避免放两遍）', r2);

  console.log('  页面异常: ' + (errs.length ? errs.slice(0, 2).join(' | ') : '（无 ✓）'));
  ck(errs.length === 0, '★ 页面 0 异常', errs.slice(0, 2));

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  await sleep(500);
  await fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at.token },
    body: JSON.stringify({ act: 'delplayer', name: NM }),
  }).catch(() => null);
  console.log('');
  console.log(FAILS ? ('FAILED: ' + FAILS) : 'ALL PASS ✓');
  process.exit(FAILS ? 1 : 0);
})();
