// 验收：断线 → 自动重连，全程【不刷新页面】（APK 里刷新会卡死）
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
  const NM = '测试不刷新' + Math.random().toString(36).slice(2, 5), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: PW }),
  }).then(x => x.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-'));
  const port = 5620 + Math.floor(Math.random() * 14);
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
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; } };
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
  await sleep(11000);
  ck((await ev('return WSC.ready;')) === true, '★ 先连上');

  // ★ 用 performance.now() 判断有没有刷新（刷新会归零 ✗ 这个办法不依赖打桩 ✓）
  const t0 = await ev('return Math.round(performance.now());');
  console.log('  测试开始时页面已运行: ' + t0 + 'ms');

  // 打桩（能打上更好，打不上也没关系 —— 下面还有 performance 判断 ✓）
  const patch = await ev([
    'window.__rl = { reload: 0, replace: 0 };',
    'try {',
    '  var orl = location.reload.bind(location);',
    '  var orp = location.replace.bind(location);',
    '  delete location.reload; delete location.replace;',
    '  Object.defineProperty(location, "reload", { configurable: true, value: function () { window.__rl.reload++; } });',
    '  Object.defineProperty(location, "replace", { configurable: true, value: function (u) { window.__rl.replace++; } });',
    '  window.__rlPatched = true;',
    '} catch (e) { window.__rlPatched = false; }',
    'return window.__rlPatched;',
  ].join(''));
  console.log('  打桩成功: ' + patch);

  // ① 断线（socket 关闭）
  await ev('try { WSC.sock.close(); } catch (e) {} return 1;');
  let back = null;
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    back = JSON.parse(await ev('return JSON.stringify({ ready: WSC.ready });'));
    if (back.ready) { break; }
  }
  ck(back && back.ready === true, '★★ 断线后自己连回来了', back);

  // ② "半死连接"：摘掉 onmessage → 不同步看门狗应该"原地重连"而不是刷新
  await ev('WSC.sock.onmessage = null; window._lastWorldT = Date.now(); return 1;');
  await sleep(11500);
  let back2 = null;
  for (let i = 0; i < 12; i++) {
    back2 = JSON.parse(await ev('return JSON.stringify({ ready: WSC.ready });'));
    if (back2 && back2.ready) { break; }
    await sleep(1000);
  }
  ck(back2 && back2.ready === true, '★★ 半死连接也自己救回来了', back2);

  const rl = JSON.parse(await ev('return JSON.stringify(window.__rl);'));
  const t1 = await ev('return Math.round(performance.now());');
  console.log('  结束时页面已运行: ' + t1 + 'ms　刷新计数: ' + JSON.stringify(rl));
  ck(rl.reload === 0 && rl.replace === 0, '★★ 没有调用 reload/replace', rl);
  ck(t1 > t0 + 8000, '★★ 页面没重新加载（运行时长连续增长 ' + t0 + ' → ' + t1 + 'ms）', [t0, t1]);

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  await sleep(500);
  await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' }),
  }).then(x => x.json()).then(at => fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at.token },
    body: JSON.stringify({ act: 'delplayer', name: NM }),
  })).catch(() => null);
  console.log('');
  console.log(FAILS ? ('FAILED: ' + FAILS) : 'ALL PASS ✓');
  process.exit(FAILS ? 1 : 0);
})();
