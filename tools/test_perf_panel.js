// 验证 P0：性能面板能开、数字对；阴影范围收小后更清晰（截图对比）
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
  const NM = '测试V' + Math.random().toString(36).slice(2, 5), PW = 'abc123456';
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-'));
  const port = 9935 + Math.floor(Math.random() * 15);
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

  // ① 默认关
  ck((await ev('var e=document.getElementById("perfBar"); return e?e.style.display:"none";')) !== 'block',
    '★ 性能面板默认关');

  // ② 打开（走设置里的开关）
  await ev('SETCFG.perf = true; saveSet(); applySet(); return 1;');
  await sleep(2200);
  const txt = await ev('var e=document.getElementById("perfBar"); return e? e.textContent : "__NONE__";');
  console.log('  面板内容:\n    ' + String(txt).replace(/\n/g, '\n    '));
  ck(/帧 .*ms/.test(String(txt)) && /绘制 \d+/.test(String(txt)), '★★ 面板有帧时间 / 绘制调用', txt);
  ck(String(txt).indexOf('__NONE__') < 0, '★ 面板元素已创建');

  // ③ 阴影范围：低/中/高三档不同
  const ext = await ev([
    'var out = {};',
    'var d0 = SETCFG.detail;',
    "['low','mid','high'].forEach(function (d) { SETCFG.detail = d; applySet();",
    '  out[d] = Math.round(sun.shadow.camera.right); });',
    'SETCFG.detail = d0; applySet();',
    'return JSON.stringify(out);',
  ].join(''));
  console.log('  阴影范围（±米）: ' + ext);
  const e = JSON.parse(ext);
  ck(e.low === 20 && e.mid === 34 && e.high === 45, '★★ 阴影范围按细节档收（低20/中34/高45）', e);

  // ④ 战斗中数字（40 怪）
  await ev('P.x = 200; P.z = 200; return 1;');
  await sleep(800);
  await act({ act: 'spawn', name: NM, n: 40 });
  await sleep(3500);
  const fight = await ev('var e=document.getElementById("perfBar"); return e?e.textContent:"-";');
  console.log('  40 怪时面板:\n    ' + String(fight).replace(/\n/g, '\n    '));
  const m = /绘制 (\d+)/.exec(String(fight));
  ck(m && parseInt(m[1], 10) > 150, '★★ 面板在战斗中反映真实绘制调用（>150）', m && m[1]);

  // ⑤ 截图（带面板）
  const s = await send('Page.captureScreenshot', { format: 'png' });
  if (s && s.result && s.result.data) {
    fs.writeFileSync(path.join(ROOT, 'docs', 'shots', 'r426-perfbar.png'),
      Buffer.from(s.result.data, 'base64'));
    console.log('  截图: docs/shots/r426-perfbar.png');
  }
  console.log('  页面异常: ' + (errs.length ? errs.slice(0, 2).join(' | ') : '（无 ✓）'));
  ck(errs.length === 0, '★ 页面 0 异常', errs.slice(0, 2));

  await ev('SETCFG.perf = false; saveSet(); applySet(); return 1;');
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
