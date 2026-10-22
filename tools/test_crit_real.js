// 真打：引一只怪，连砍，看暴击时 hitStop 有没有真的被触发（镜头推近已删）
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
  const NM = '测试真打' + Math.random().toString(36).slice(2, 5), PW = 'abc123456';
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'critreal-'));
  const port = 9860 + Math.floor(Math.random() * 10);
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
  // 出安全区
  await ev('P.x = 60; P.z = 60; wsSend("move", {x:60, z:60, yaw:0, t: performance.now()/1000}); return 1;');
  await sleep(900);
  await act({ act: 'spawn', name: NM, n: 6 });
  await sleep(1200);
  // 监控：连砍，记录 hitStop 的最大值
  await ev([
    'window.__mon = { maxPunch: 0, maxHitStop: 0, crits: 0, lastHs: 0 };',
    'window.__monT = setInterval(function () {',
    '  if (hitStop > window.__mon.maxHitStop) { window.__mon.maxHitStop = hitStop; }',
    '  if (hitStop >= 0.05 && window.__mon.lastHs < 0.05) { window.__mon.crits++; }',
    '  window.__mon.lastHs = hitStop;',
    '}, 30);',
    'atkCd = 0; atkT = -1; atkHeld = true;',
    'return 1;',
  ].join(''));
  /* ★ 暴击率不高（测试账号没装备）→ 最多置 30 秒，出现一次就停 ✓ */
  for (let i = 0; i < 45; i++) {
    await sleep(1000);
    await ev('atkCd = 0; if (atkT < 0) { atkHeld = true; } return 1;');
    const m = await ev('return JSON.stringify({punch:+window.__mon.maxPunch.toFixed(2), hs:+window.__mon.maxHitStop.toFixed(3), crits:window.__mon.crits, mobs:Object.keys(NET.rmobs).length});');
    if (i % 5 === 0) { console.log('    ' + m); }
    const M0 = JSON.parse(m);
    if (M0.crits > 0) { console.log('    第 ' + (i + 1) + ' 秒出现暴击 → 停'); break; }
  }
  const fin = await ev('atkHeld = false; clearInterval(window.__monT); return JSON.stringify(window.__mon);');
  console.log('  统计: ' + fin);
  const M = JSON.parse(fin);
  ck(M.crits > 0, '★ 打出了暴击（' + M.crits + ' 次）', M);
  /* ★ round431：镜头推近已经按用户要求删掉了 ✗ 这里只验顿帧 ✓ */
  ck(M.maxHitStop >= 0.05, '★★ 暴击顿帧被触发（实测峰值 ' + M.maxHitStop + '，起始值是 0.11）', M);
  console.log('  页面异常: ' + (errs.length ? errs.slice(0, 2).join(' | ') : '（无 ✓）'));

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
