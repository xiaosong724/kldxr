// 验收：悬停浮窗（背包 + 交易所）词条一条一行 —— 用真实像素坐标证明"不在同一行"
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
  const NM = '测试悬停' + Math.random().toString(36).slice(2, 5), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: PW }),
  }).then(x => x.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tip-'));
  const port = 4900 + Math.floor(Math.random() * 14);
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

  // 造一件 3 条词条的假装备，直接调悬停用的渲染函数
  const res = await ev([
    'var it = { slot: "weapon", name: "测试剑", tier: 7, look: "sword",',
    '  base: { coeff: 1.1, atkSpeed: 1.15, reach: 2.6, arc: 1.2 }, reqLevel: 1, dur: 90, durMax: 100,',
    '  affixes: [',
    '    { k: "lifesteal", text: "造成伤害的 3.2% 回血" },',
    '    { k: "crit_pt", text: "暴击率 +6%" },',
    '    { k: "treasure", text: "掉落概率 +12%" }',
    '  ] };',
    'window.__it = it;',
    'var box = document.getElementById("bagTipBox");',
    'box.style.display = "block";',
    'box.innerHTML = bagTipHTML(it, 1, "bag");',
    'box.style.left = "20px"; box.style.top = "80px";',
    'var spans = box.querySelectorAll("span[style*=\'display:block\']");',
    'var tops = [];',
    'for (var i = 0; i < spans.length; i++) { tops.push(Math.round(spans[i].getBoundingClientRect().top)); }',
    'return JSON.stringify({ n: spans.length, tops: tops, html: box.innerHTML.length });',
  ].join(''));
  console.log('  悬停浮窗: ' + res);
  const R = JSON.parse(res);
  ck(R.n === 3, '★★ 浮窗里有 3 条独立词条块', R.n);
  const uniq = [...new Set(R.tops)];
  console.log('  三条的纵坐标: ' + JSON.stringify(R.tops));
  ck(uniq.length === 3, '★★ 三条的纵坐标各不相同（真的换行了，不是挤一行）', R.tops);

  // 交易所浮窗走的是同一个函数（mktTipShow → bagTipHTML），直接验它输出
  const mk = await ev([
    'var html = bagTipHTML(window.__it, 2, "market", { seller: 123, unit: 500, qty: 1 });',
    'var d = document.createElement("div"); d.innerHTML = html;',
    'var spans = d.querySelectorAll("span[style*=\'display:block\']");',
    'return spans.length;',
  ].join(''));
  console.log('  交易所浮窗词条块: ' + mk);
  ck(+mk === 3, '★★ 交易所浮窗也是 3 行（同一个渲染函数）', mk);

  // 截图：把浮窗拉出来拍一张
  const s1 = await send('Page.captureScreenshot', { format: 'png' });
  if (s1 && s1.result && s1.result.data) {
    fs.writeFileSync(path.join(ROOT, 'docs', 'shots', 'tip-affixes.png'), Buffer.from(s1.result.data, 'base64'));
    console.log('  存 docs/shots/tip-affixes.png');
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
