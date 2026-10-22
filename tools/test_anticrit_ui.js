// 验收：天赋页有抗爆、属性页有抗爆 + 爆伤上限 250%
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
  const NM = 'ac' + Math.random().toString(36).slice(2, 8), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: PW }),
  }).then(x => x.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-'));
  const port = 4480 + Math.floor(Math.random() * 14);
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

  // ① 天赋页：有「抗爆」行
  await ev('try { openSet(); setTab("talent"); } catch (e) {} return 1;');
  await sleep(800);
  const tal = await ev('var d=document.getElementById("talList"); return d ? d.textContent : "";');
  ck(String(tal).indexOf('抗爆') >= 0, '★★ 天赋页有【抗爆】', String(tal).match(/抗爆.{0,12}/));
  const rows = await ev('return document.querySelectorAll("#talList .ptLine").length;');
  console.log('  天赋行数: ' + rows);
  ck(+rows === 12, '★★ 天赋共 12 行（原来 11 + 抗爆）', rows);

  // ② 加 10 点抗爆 → 服务器回 eff
  // NOTE: every click re-renders the list, so the button node is replaced.
  // Re-query the button on each step instead of holding a stale reference.
  const add = await ev([
    'return new Promise(function (done) {',
    '  var n = 0;',
    '  function step() {',
    '    if (n >= 10) { return done(1); }',
    '    var b = document.querySelector(\'#talList .talB[data-k="anticritdmg"][data-n="1"]\');',
    '    if (!b) { return done("__NOBTN__"); }',
    '    b.click();',
    '    n++;',
    '    setTimeout(step, 300);',
    '  }',
    '  step();',
    '});',
  ].join(''));
  await sleep(1500);
  const eff = await ev('return JSON.stringify({ pts: TAL.pts.anticritdmg, eff: TAL.eff.anticritdmg, raw: TAL.raw.anticritdmg });');
  console.log('  加点后: ' + eff);
  const E = JSON.parse(eff);
  // ★ 1 级只有 3 点天赋（等级×3 ✓）→ 测试里只能加 3 点 ✗
  ck(+E.pts > 0 && Math.abs(+E.eff - (+E.pts) * 0.5) < 0.01,
     '★★ 抗爆加点生效（' + E.pts + ' 点 = ' + E.eff + '%，每点 0.5%）', E);

  // ③ 属性页：有抗爆行 + 爆伤上限 250%
  await ev('setTab("stat"); return 1;');
  await sleep(1200);
  const stat = await ev('var d=document.getElementById("stTotal"); return d ? d.textContent : "";');
  ck(String(stat).indexOf('抗爆') >= 0, '★★ 属性页有【抗爆】', String(stat).match(/抗爆.{0,14}/));
  ck(String(stat).indexOf('上限 250%') >= 0, '★★ 属性页爆伤上限 = 250%', String(stat).match(/爆伤.{0,30}/));

  // 截图（滚到输出组）
  await ev([
    'var rows = document.querySelectorAll("#stTotal div");',
    'for (var i=0;i<rows.length;i++){ if ((rows[i].textContent||"").indexOf("爆伤")>=0) { rows[i].scrollIntoView({block:"center"}); break; } }',
    'return 1;',
  ].join(''));
  await sleep(400);
  const s1 = await send('Page.captureScreenshot', { format: 'png' });
  if (s1 && s1.result && s1.result.data) {
    fs.writeFileSync(path.join(ROOT, 'docs', 'shots', 'anticrit.png'), Buffer.from(s1.result.data, 'base64'));
    console.log('  存 docs/shots/anticrit.png');
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
