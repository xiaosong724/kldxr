// 验收：装备独立成导航页 + 自动出售在背包页
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
  const NM = '测试装栏' + Math.random().toString(36).slice(2, 5), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: PW }),
  }).then(x => x.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eq-'));
  const port = 5080 + Math.floor(Math.random() * 14);
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

  // ① 导航里有「装备」
  const tabs = await ev([
    'var out = [];',
    'document.querySelectorAll("#setTabs .tab").forEach(function (t) { out.push(t.getAttribute("data-tab")); });',
    'return JSON.stringify(out);',
  ].join(''));
  console.log('  导航页签: ' + tabs);
  ck(String(tabs).indexOf('equip') >= 0, '★★ 导航栏里有【装备】', tabs);

  // ② 切到装备页：槽 + 详情都在
  await ev('try { openSet(); setTab("equip"); } catch (e) { return "__ERR__ " + e; } return 1;');
  await sleep(900);
  const eq = JSON.parse(await ev([
    'var pane = document.querySelector(\'#setPanel .tabpane[data-pane="equip"]\');',
    'var slot = document.getElementById("bagEqSlot");',
    'var arm = document.getElementById("bagEqArmor");',
    'var det = document.getElementById("eqDetail");',
    'return JSON.stringify({ paneOn: pane ? pane.className.indexOf("on") >= 0 : false,',
    '  slotInPane: !!(pane && pane.contains(slot)), armInPane: !!(pane && pane.contains(arm)),',
    '  slotVisible: slot ? !!(slot.offsetWidth || slot.offsetHeight) : false,',
    '  detailLen: det ? det.innerHTML.length : -1,',
    '  hasGrid: !!document.getElementById("bagGrid") });',
  ].join('')));
  console.log('  装备页: ' + JSON.stringify(eq));
  ck(eq.paneOn === true, '★★ 装备页能打开', eq.paneOn);
  ck(eq.slotInPane === true && eq.armInPane === true, '★★ 两个装备槽在装备页里', eq);
  ck(eq.detailLen > 50, '★★ 装备详情渲染出来了（' + eq.detailLen + ' 字节）', eq.detailLen);

  // ③ 背包页不再有装备槽，但有自动出售
  await ev('setTab("bag"); return 1;');
  await sleep(700);
  const bag = JSON.parse(await ev([
    'var pane = document.querySelector(\'#setPanel .tabpane[data-pane="bag"]\');',
    'var sel = document.getElementById("setAutoSell");',
    'var slot = document.getElementById("bagEqSlot");',
    'return JSON.stringify({ gridInBag: !!(pane && pane.contains(document.getElementById("bagGrid"))),',
    '  slotInBag: !!(pane && pane.contains(slot)),',
    '  autoSellInBag: !!(pane && pane.contains(sel)),',
    '  autoSellVisible: sel ? !!(sel.offsetWidth || sel.offsetHeight) : false });',
  ].join('')));
  console.log('  背包页: ' + JSON.stringify(bag));
  ck(bag.gridInBag === true, '★ 背包格子还在背包页', bag);
  ck(bag.slotInBag === false, '★★ 装备槽已经不在背包页了', bag);
  ck(bag.autoSellInBag === true && bag.autoSellVisible === true, '★★ 自动出售在背包页且可见', bag);

  const s1 = await send('Page.captureScreenshot', { format: 'png' });
  if (s1 && s1.result && s1.result.data) {
    fs.writeFileSync(path.join(ROOT, 'docs', 'shots', 'bag-page.png'), Buffer.from(s1.result.data, 'base64'));
    console.log('  存 docs/shots/bag-page.png');
  }
  await ev('setTab("equip"); return 1;');
  await sleep(700);
  const s2 = await send('Page.captureScreenshot', { format: 'png' });
  if (s2 && s2.result && s2.result.data) {
    fs.writeFileSync(path.join(ROOT, 'docs', 'shots', 'equip-page.png'), Buffer.from(s2.result.data, 'base64'));
    console.log('  存 docs/shots/equip-page.png');
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
