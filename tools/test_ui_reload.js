// test_ui_reload.js -- 信息页：两个自动开关已删 · 界面刷新按钮 + 60s CD
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe'];
const B = CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let FAILS = 0;
const ck = (c, m, got) => {
  if (c) { console.log('  PASS  ' + m); }
  else { FAILS++; console.log('  FAIL  ' + m + (got === undefined ? '' : '  got=' + JSON.stringify(got))); }
};

(async () => {
  const nm = '刷新' + Math.random().toString(36).slice(2, 5);
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nm, password: 'abc123456' })
  }).then(x => x.json());

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uireload-'));
  const port = 5985 + Math.floor(Math.random() * 12);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1100,860', 'about:blank'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 120 && !t; i++) {
    await sleep(250);
    try {
      const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      t = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
    } catch (e) { }
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const wait = {};
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; } };
  const send = (mm, pp) => new Promise(res => { const i = ++id; wait[i] = res; ws.send(JSON.stringify({ id: i, method: mm, params: pp || {} })); });
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.result.value;

  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Page.navigate', { url: ORIGIN + '/?t=' + Date.now() });
  await sleep(1200);
  await ev('localStorage.setItem("token",' + JSON.stringify(reg.token) + ')');
  await send('Page.reload', {});
  await sleep(9000);
  await ev('try{annClose()}catch(e){}');
  await ev('try{ openSet(); setTab("about"); }catch(e){}');
  await sleep(700);

  ck(await ev('!document.getElementById("setAutoOn")'), '「自动战斗」开关已从界面删掉');
  ck(await ev('!document.getElementById("setAutoLoot")'), '「自动捡东西」开关已从界面删掉');
  ck(await ev('!!document.getElementById("uiReload")'), '「界面刷新」按钮在（信息页）');

  const label0 = await ev('(document.getElementById("uiReload")||{}).textContent');
  ck(String(label0).indexOf('界面刷新') >= 0, '按钮文字是「界面刷新」', label0);

  // 点一下 → 记了时间戳（页面会 reload，所以先看 localStorage）
  await ev('localStorage.removeItem("uiReloadAt")');
  await ev('window.__noReload = true; window.__origReload = location.reload; ' +
           'location.reload = function(){ window.__noReload = false; };');
  await ev('document.getElementById("uiReload").click()');
  await sleep(400);
  const ts = await ev('localStorage.getItem("uiReloadAt") || ""');
  ck(String(ts).length > 10, '点了会记下时间（CD 起点）', ts);

  // CD 内再点：不应该再刷新（时间戳不变）
  const before = String(ts);
  await ev('document.getElementById("uiReload").click()');
  await sleep(300);
  const after = await ev('localStorage.getItem("uiReloadAt") || ""');
  ck(after === before, 'CD 内再点无效（时间戳没被改）', { before, after });

  // 按钮进冷却态
  const painted = await ev(`(function(){
      if (typeof uiReloadPaint === 'function') { uiReloadPaint(); }
      var b = document.getElementById('uiReload');
      return JSON.stringify({ txt: b.textContent, pe: b.style.pointerEvents, op: b.style.opacity });
    })()`);
  const pj = JSON.parse(painted || '{}');
  ck(/刷新（\d+s）/.test(String(pj.txt)), '冷却时按钮显示剩余秒数', pj.txt);
  ck(pj.pe === 'none', '冷却时点不动（pointer-events:none）', pj.pe);

  // 冷却靠左：把时间戳改老 → 应该又能点
  await ev('localStorage.setItem("uiReloadAt", String(Date.now() - 65000))');
  await ev('if (typeof uiReloadPaint === "function") { uiReloadPaint(); }');
  const ready = await ev('(document.getElementById("uiReload")||{}).textContent');
  ck(String(ready).indexOf('界面刷新') >= 0, '60 秒后恢复可用', ready);

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  if (FAILS) { console.log('FAILED: ' + FAILS); process.exit(1); }
  console.log('全部通过');
})();
