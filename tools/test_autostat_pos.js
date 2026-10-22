// 验收：挂机击杀面板的位置（不压系统提示/弹幕）+ 仍然显示/隐藏正常
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
  const NM = '测试位置' + Math.random().toString(36).slice(2, 5), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: PW }),
  }).then(x => x.json());
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' }),
  }).then(x => x.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-'));
  const port = 8980 + Math.floor(Math.random() * 14);
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
  await ev('if (!AUTO.on) { autoToggle(); } return 1;');
  await sleep(1200);
  // 弹一条 toast，制造"系统提示"占位
  await ev('toast("测试提示：这是一条系统消息"); return 1;');
  await sleep(300);
  const geo = await ev([
    'var a = document.getElementById("autoStat");',
    'var tk = document.getElementById("ticker");',
    'var tt = window._toastElRef;',
    'var ar = a ? a.getBoundingClientRect() : null;',
    'var tr = tk ? tk.getBoundingClientRect() : null;',
    'var rr = tt ? tt.getBoundingClientRect() : null;',
    'return JSON.stringify({',
    '  autoTop: ar ? Math.round(ar.top) : null, autoBottom: ar ? Math.round(ar.bottom) : null,',
    '  tickerBottom: tr ? Math.round(tr.bottom) : null,',
    '  toastTop: rr ? Math.round(rr.top) : null, toastBottom: rr ? Math.round(rr.bottom) : null,',
    '  overlapsTicker: !!(ar && tr && ar.top < tr.bottom && ar.bottom > tr.top),',
    '  overlapsToast: !!(ar && rr && ar.top < rr.bottom && ar.bottom > rr.top),',
    '  txt: a ? a.textContent : null });',
  ].join(''));
  console.log('  位置: ' + geo);
  const G = JSON.parse(geo);
  ck(G.autoTop !== null, '★ 面板存在', G.autoTop);
  ck(G.overlapsTicker === false, '★★ 不和弹幕/公告条重叠', G);
  ck(G.overlapsToast === false, '★★ 不和系统提示重叠（autoTop=' + G.autoTop + ' > toastBottom=' + G.toastBottom + '）', G);
  ck(/挂机中/.test(String(G.txt)), '★ 内容还在（' + G.txt + '）', G.txt);

  const shot = await ev('rd.render(scene, cam); return document.getElementById("cv").toDataURL("image/png");');
  if (typeof shot === 'string' && shot.indexOf('data:image/png') === 0) {
    fs.writeFileSync(path.join(ROOT, 'docs', 'shots', 'r439-autostat.png'),
      Buffer.from(shot.split(',')[1], 'base64'));
    console.log('  截图: docs/shots/r439-autostat.png');
  }
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
