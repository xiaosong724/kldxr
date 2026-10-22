// 验收：自动战斗遇到"5 阶及以上掉落"会不会先去捡（打断打怪）
// 关键：注入的掉落会被下一帧快照删掉 → 必须在【同一次求值】里注入 + 直接调 autoTick
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
  const NM = '测试自动' + Math.random().toString(36).slice(2, 5), PW = 'abc123456';
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aloot-'));
  const port = 9340 + Math.floor(Math.random() * 14);
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
  await act({ act: 'spawn', name: NM, n: 6 });
  await sleep(1600);
  console.log('  开自动: ' + await ev('if (!AUTO.on) { autoToggle(); } return JSON.stringify({on: AUTO.on, lootOn: AUTO.lootOn});'));
  await sleep(600);

  const hi = await ev([
    'NET.rloot["__hi"] = { x: P.x + 8, z: P.z, name: "测试剑", tier: 7 };',
    'autoTick(0.016);',
    'var r = JSON.stringify({ info: AUTO.info, mobs: Object.keys(NET.rmobs).length });',
    'delete NET.rloot["__hi"];',
    'return r;',
  ].join(''));
  console.log('  ① 7 阶: ' + hi);
  const H = JSON.parse(hi);
  ck(H.mobs > 0, '场景里确实有怪（' + H.mobs + ' 只）');
  ck(/抢 7 阶|捡 7 阶/.test(String(H.info)), '★★ 有 7 阶掉落 → 先去捡（' + H.info + '）', H);

  const lo = await ev([
    'NET.rloot["__lo"] = { x: P.x + 8, z: P.z, name: "测试破刀", tier: 4 };',
    'autoTick(0.016);',
    'var r = JSON.stringify({ info: AUTO.info });',
    'delete NET.rloot["__lo"];',
    'return r;',
  ].join(''));
  console.log('  ② 4 阶: ' + lo);
  const L = JSON.parse(lo);
  ck(!/抢 4 阶|捡 4 阶/.test(String(L.info)), '★★ 4 阶掉落不会打断打怪（' + L.info + '）', L);

  await ev('P.x = 320; P.z = 320; wsSend("move", {x:320,z:320,yaw:0,t:performance.now()/1000}); return 1;');
  await sleep(2200);
  const lo2 = await ev([
    'NET.rloot["__lo2"] = { x: P.x + 8, z: P.z, name: "测试破刀", tier: 4 };',
    'autoTick(0.016);',
    'var r = JSON.stringify({ info: AUTO.info, mobs: Object.keys(NET.rmobs).length });',
    'delete NET.rloot["__lo2"];',
    'return r;',
  ].join(''));
  console.log('  ③ 没怪 + 4 阶: ' + lo2);
  const L2 = JSON.parse(lo2);
  ck(/去捡东西|捡东西/.test(String(L2.info)), '★ 没怪了才去捡低阶（' + L2.info + '）', L2);

  console.log('  页面异常: ' + (errs.length ? errs.slice(0, 2).join(' | ') : '（无 ✓）'));
  ck(errs.length === 0, '★ 页面 0 异常', errs.slice(0, 2));

  await ev('if (AUTO.on) { autoToggle(); } return 1;');
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
