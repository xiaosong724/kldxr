// 压测：管理页大量召唤（60 只）+ 反复增删，检查四肢有没有残留/缺失/槽位耗尽
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
  const NM = '测试压测' + Math.random().toString(36).slice(2, 5), PW = 'abc123456';
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stress-'));
  const port = 9160 + Math.floor(Math.random() * 14);
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

  const stat = async () => ev([
    'var used = {}, live = 0, noSlot = 0;',
    'for (var k in NET.rmobs) {',
    '  var m = NET.rmobs[k]; if (!m || !m.hh) { continue; } live++;',
    '  if (!m.hh.slots) { noSlot++; continue; }',
    '  for (var i = 0; i < m.hh.slots.length; i++) { var s = m.hh.slots[i]; if (s && s.idx >= 0) { used[s.bucket.mesh.uuid + ":" + s.idx] = 1; } }',
    '}',
    'var ghosts = 0, total = 0, capFull = 0;',
    'for (var bk in LIMB_BUCKETS) {',
    '  var b = LIMB_BUCKETS[bk], mesh = b.mesh, arr = mesh.instanceMatrix.array;',
    '  if (b.used >= 256) { capFull++; }',
    '  for (var j = 0; j < mesh.count; j++) {',
    '    var o = j * 16;',
    '    var sc = Math.abs(arr[o]) + Math.abs(arr[o+5]) + Math.abs(arr[o+10]);',
    '    if (sc > 0.001) { total++; if (!used[mesh.uuid + ":" + j]) { ghosts++; } }',
    '  }',
    '}',
    'return JSON.stringify({ mobs: live, noSlot: noSlot, drewInstances: total, ghosts: ghosts,',
    '  bucketsFull: capFull, buckets: Object.keys(LIMB_BUCKETS).length,',
    '  usedSum: (function () { var n = 0; for (var b2 in LIMB_BUCKETS) { n += LIMB_BUCKETS[b2].used; } return n; })() });',
  ].join(''));

  console.log('  初始: ' + await stat());
  // ① 大量召唤：60 只（服务器上限）
  for (let i = 0; i < 3; i++) {
    await act({ act: 'spawn', name: NM, n: 40 });
    await sleep(1200);
  }
  await sleep(2000);
  console.log('  大量召唤后: ' + await stat());
  const S1 = JSON.parse(await stat());
  ck(S1.ghosts === 0, '★★ 大量召唤后没有幽灵四肢（ghosts=' + S1.ghosts + '）', S1);
  ck(S1.bucketsFull === 0, '★★ 没有桶被撑满（' + S1.bucketsFull + ' 个满）', S1);

  // ② 清空 + 再召唤（模拟反复增删 → 看槽位会不会耗尽）
  for (let i = 0; i < 4; i++) {
    await act({ act: 'spawn', name: NM, n: 0, clear: 1 });
    await sleep(700);
    await act({ act: 'spawn', name: NM, n: 40 });
    await sleep(1100);
  }
  await sleep(1500);
  const S2 = JSON.parse(await stat());
  console.log('  反复增删后: ' + JSON.stringify(S2));
  ck(S2.ghosts === 0, '★★ 反复增删后仍然没有幽灵四肢（ghosts=' + S2.ghosts + '）', S2);
  ck(S2.noSlot <= 2, '★★ 绝大部分怪都有四肢槽（没有的：' + S2.noSlot + '）', S2);
  ck(S2.usedSum < 256 * 14, '★ 槽位分配总数 ' + S2.usedSum + '（没爆）', S2);

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
