// 验收两件事：① 升级特效 ② 挂机击杀数显示/隐藏
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
  const NM = '测试特效' + Math.random().toString(36).slice(2, 5), PW = 'abc123456';
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fx-'));
  const port = 9100 + Math.floor(Math.random() * 14);
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

  // ① 升级特效
  const before = await ev('return _lvFx.length;');
  await ev('fxLevelUp(7); return 1;');
  await sleep(120);
  const mid = await ev('return JSON.stringify({ n: _lvFx.length, kinds: _lvFx.map(function (f) { return f.kind; }) });');
  console.log('  升级特效: ' + mid);
  const M = JSON.parse(mid);
  ck(M.n >= 4, '★★ 升级特效生成了' + M.n + '个对象（3 闪电 + 光环 + 光柱）', M);
  ck(M.kinds.indexOf('bolt') >= 0 && M.kinds.indexOf('ring') >= 0 && M.kinds.indexOf('pillar') >= 0,
    '★★ 三种都齐了（闪电/光环/光柱）', M.kinds);
  const shot1 = await ev('rd.render(scene, cam); return document.getElementById("cv").toDataURL("image/png");');
  if (typeof shot1 === 'string' && shot1.indexOf('data:image/png') === 0) {
    fs.writeFileSync(path.join(ROOT, 'docs', 'shots', 'r437-levelup.png'),
      Buffer.from(shot1.split(',')[1], 'base64'));
    console.log('  截图: docs/shots/r437-levelup.png');
  }
  await sleep(1200);
  ck((await ev('return _lvFx.length;')) === 0, '★★ 特效自己清理干净了（不残留、不漏内存）');

  // ② 挂机击杀数
  const off = await ev('var e = document.getElementById("autoStat"); return JSON.stringify({ has: !!e, vis: e ? e.style.display : null });');
  console.log('  挂机面板(未开): ' + off);
  await ev('if (!AUTO.on) { autoToggle(); } return 1;');
  await sleep(1200);
  const on = await ev('var e = document.getElementById("autoStat"); return JSON.stringify({ vis: e.style.display, txt: e.textContent });');
  console.log('  开挂机: ' + on);
  const O = JSON.parse(on);
  ck(O.vis === 'block' && /挂机中/.test(String(O.txt)), '★★ 开挂机后显示击杀面板（' + O.txt + '）', O);
  // 假造击杀数，看会不会跟着涨
  await ev('AUTO.kills = 42; AUTO.statT = 0; return 1;');
  await sleep(900);
  const k42 = await ev('return document.getElementById("autoStat").textContent;');
  console.log('  改击杀数后: ' + k42);
  ck(/42/.test(String(k42)), '★★ 击杀数实时更新（' + k42 + '）', k42);
  // 关掉自动战斗 → 面板应当隐藏
  await ev('if (AUTO.on) { autoToggle(); } return 1;');
  await sleep(600);
  const off2 = await ev('var e = document.getElementById("autoStat"); return JSON.stringify({ vis: e.style.display });');
  console.log('  关挂机后: ' + off2);
  ck(JSON.parse(off2).vis === 'none', '★★ 挂机结束后自动隐藏', off2);

  console.log('  页面异常: ' + (errs.length ? errs.slice(0, 2).join(' | ') : '（无 ✓）'));
  ck(errs.length === 0, '★ 页面 0 异常', errs.slice(0, 2));

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  await sleep(600);
  await act({ act: 'delplayer', name: NM });
  console.log('');
  console.log(FAILS ? ('FAILED: ' + FAILS) : 'ALL PASS ✓');
  process.exit(FAILS ? 1 : 0);
})();
