// 验收：只有"关掉自动战斗"才清零；刷新页面/重启服务器都继续
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
  const NM = '测试清零' + Math.random().toString(36).slice(2, 5), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: PW }),
  }).then(x => x.json());
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' }),
  }).then(x => x.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-'));
  const port = 8800 + Math.floor(Math.random() * 14);
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
  const boot = async () => {
    await send('Runtime.enable', {});
    await sleep(1500);
    await ev('localStorage.setItem("token",' + JSON.stringify(reg.token) + '); location.reload(); return 1;');
    await sleep(10000);
  };
  await boot();

  // 开挂机 → 造数据（击杀 77、已挂 130 秒）
  await ev('if (!AUTO.on) { autoToggle(); } return 1;');
  await sleep(800);
  await ev('AUTO.kills = 77; AUTO.t0 = performance.now() - 130000; AUTO.statT = 0; return 1;');
  await sleep(900);
  const st1 = await ev('return JSON.stringify({ on: AUTO.on, kills: AUTO.kills, el: Math.round((performance.now() - AUTO.t0) / 1000) });');
  console.log('  造好数据: ' + st1);
  const S1 = JSON.parse(st1);
  ck(S1.kills === 77, '★ 击杀数设成 77', S1.kills);

  // ① 刷新页面（服务器没重启）→ 应该继续 77 / 130+
  await ev('location.reload(); return 1;');
  await sleep(11000);
  const st2 = await ev('return JSON.stringify({ on: AUTO.on, kills: AUTO.kills, el: Math.round((performance.now() - AUTO.t0) / 1000), saved: localStorage.getItem("xx3d_autostat") });');
  console.log('  刷新后: ' + st2);
  const S2 = JSON.parse(st2);
  ck(S2.on === true, '★ 刷新后挂机还是开着的（设置存了）', S2.on);
  ck(S2.kills === 77, '★★ 刷新后击杀数还是 77（没清零）', S2.kills);
  ck(S2.el >= 130, '★★ 刷新后时长接着算（' + S2.el + ' 秒 ≥ 130）', S2.el);

  // ② 关掉自动战斗 → 清零
  await ev('if (AUTO.on) { autoToggle(); } return 1;');
  await sleep(600);
  const st3 = await ev('return JSON.stringify({ on: AUTO.on, kills: AUTO.kills, saved: localStorage.getItem("xx3d_autostat") });');
  console.log('  关掉后: ' + st3);
  const S3 = JSON.parse(st3);
  ck(S3.on === false && S3.kills === 0, '★★ 关掉自动战斗 → 击杀数清零', S3);
  ck(S3.saved === null, '★★ 存档也清掉了（下次开是新的）', S3.saved);

  // ③ 再打开 → 从 0 开始（继续也算，但数据已清空）
  await ev('if (!AUTO.on) { autoToggle(); } return 1;');
  await sleep(900);
  const st4 = await ev('return JSON.stringify({ on: AUTO.on, kills: AUTO.kills, el: Math.round((performance.now() - AUTO.t0) / 1000) });');
  console.log('  再打开: ' + st4);
  const S4 = JSON.parse(st4);
  ck(S4.kills === 0 && S4.el <= 3, '★★ 再打开是从 0 开始（' + S4.el + ' 秒）', S4);

  console.log('  页面异常: ' + (errs.length ? errs.slice(0, 2).join(' | ') : '（无 ✓）'));
  ck(errs.length === 0, '★ 页面 0 异常', errs.slice(0, 2));

  await ev('if (AUTO.on) { autoToggle(); } return 1;');
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
