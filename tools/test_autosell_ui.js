// 验收：设置里有"自动出售"下拉，改它会发 autosell 意图
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
  const NM = '测试自动卖' + Math.random().toString(36).slice(2, 5), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: PW }),
  }).then(x => x.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-'));
  const port = 5200 + Math.floor(Math.random() * 14);
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
    if (m.method === 'Runtime.exceptionThrown') { errs.push(((m.params.exceptionDetails || {}).exception || {}).description || 'err'); }
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
  await sleep(11000);
  ck((await ev('return WSC.ready;')) === true, '★ 进世界');

  // 打开设置，并切到"操作"页（自动出售就在那一页）
  await ev('try { openSet(); } catch (e) {} return 1;');
  await sleep(500);
  for (const tab of ['bag', 'view', 'stat']) {   /* ★ round467：自动出售挪到【背包】页了 */
    await ev('try { setTab(' + JSON.stringify(tab) + '); } catch (e) {} return 1;');
    await sleep(350);
    const vis = await ev('var s=document.getElementById("setAutoSell"); return !!(s && (s.offsetWidth||s.offsetHeight));');
    if (vis) { break; }
  }
  await sleep(300);
  const ui = JSON.parse(await ev([
    'var s = document.getElementById("setAutoSell");',
    'return JSON.stringify({ has: !!s, opts: s ? s.options.length : 0,',
    '  val: s ? s.value : null, visible: s ? !!(s.offsetWidth || s.offsetHeight) : false,',
    '  hint: (document.getElementById("setAutoSellHint")||{}).textContent || "" });',
  ].join('')));
  console.log('  下拉: ' + JSON.stringify(ui));
  ck(ui.has === true, '★★ 设置里有【自动出售】下拉', ui.has);
  ck(ui.opts >= 10, '★ 选项够多（' + ui.opts + ' 个）', ui.opts);
  ck(ui.visible === true, '★★ 下拉是可见的（没被藏起来）', ui.visible);

  // 改值 → 应该发 autosell 意图
  const sent = await ev([
    'window.__sent = [];',
    'var _w = window.wsSend; window.wsSend = function (t, d) { window.__sent.push([t, d]); return _w(t, d); };',
    'var s = document.getElementById("setAutoSell");',
    's.value = "5";',
    's.dispatchEvent(new Event("change"));',
    'return JSON.stringify(window.__sent.filter(function (x) { return x[0] === "autosell"; }));',
  ].join(''));
  console.log('  发出的意图: ' + sent);
  ck(String(sent).indexOf('autosell') >= 0 && String(sent).indexOf('"tier":5') >= 0,
    '★★ 改下拉会发 autosell 意图（tier=5）', sent);
  await sleep(1200);
  const hint = await ev('return (document.getElementById("setAutoSellHint")||{}).textContent || "";');
  console.log('  提示文字: ' + hint);
  ck(/低于 5 阶/.test(String(hint)), '★ 提示文字跟着更新', hint);

  // 服务器有没有真的存下来：重连一次看 role.autosell
  await sleep(600);
  const sval = await ev('return (WSC.role||{}).autosell;');
  console.log('  本地 role.autosell = ' + sval);
  ck(+sval === 5, '★★ 本地状态同步成 5', sval);

  const s1 = await send('Page.captureScreenshot', { format: 'png' });
  if (s1 && s1.result && s1.result.data) {
    fs.writeFileSync(path.join(ROOT, 'docs', 'shots', 'autosell.png'), Buffer.from(s1.result.data, 'base64'));
    console.log('  存 docs/shots/autosell.png');
  }
  ck(errs.length === 0, '★ 页面 0 异常', errs.slice(0, 2));
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
