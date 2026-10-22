// test_book_ui.js -- 技能书：背包图标 + 地上书的模型 + 浮窗"学习"按钮
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe'];
const B = CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let FAILS = 0;
const ck = (c, m, got) => {
  if (c) { console.log('  PASS  ' + m); } else { FAILS++; console.log('  FAIL  ' + m + (got === undefined ? '' : '  got=' + JSON.stringify(got))); }
};

(async () => {
  const nm = '书' + Math.random().toString(36).slice(2, 4);
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nm, password: 'abc123456' })
  }).then(x => x.json());
  const rid = reg.role.id;
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' })
  }).then(x => x.json()).then(j => j.token);

  // ① 接口：管理页发技能书（刚修过 JSON 那个 bug）
  const r1 = await fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at },
    body: JSON.stringify({ act: 'give', name: nm, kind: 'skillbook',
                           skillKey: 'blackhole', count: 1, tier: 1 })
  }).then(x => x.json());
  console.log('  发书返回:', { ok: r1.ok, cards: r1.cards, item: r1.item });
  ck(r1.ok === true && r1.cards === 1, '管理页能发技能书（JSON 已修）', r1);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
  const port = 6350 + Math.floor(Math.random() * 30);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1100,800', 'about:blank'], { stdio: 'ignore' });
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
  await sleep(1000);
  await ev('localStorage.setItem("token",' + JSON.stringify(reg.token) + ')');
  await send('Page.reload', {});
  await sleep(9500);
  await ev('try{annClose()}catch(e){}');
  await ev('try{ openSet(); setTab("bag"); }catch(e){}');
  await sleep(1500);

  // ② 背包图标：应该是书的 SVG（不是方块）
  const icon = await ev(`(function(){
      var b = document.querySelector('#bagGrid [data-id]');
      if (!b) { return 'no-cell'; }
      var svg = b.querySelector('svg');
      return svg ? svg.outerHTML.slice(0, 80) : 'no-svg';
    })()`);
  console.log('  图标:', String(icon).slice(0, 60));
  ck(String(icon).indexOf('<svg') === 0, '背包里技能书有图标', icon);

  // ③ 浮窗里有「学习」按钮
  const hasLearn = await ev(`(function(){
      var c = document.querySelector('#bagGrid [data-id]');
      if (!c) { return 'no-cell'; }
      var r = c.getBoundingClientRect();
      c.dispatchEvent(new TouchEvent('touchstart', {bubbles:true,
        touches:[new Touch({identifier:1, target:c, clientX:r.x+10, clientY:r.y+10})]}));
      return 1;})()`);
  await sleep(500);
  const btn = await ev("(function(){var b=document.querySelector('#bagTipBox [data-tipact=\"useskillbook\"]');return b?b.textContent.trim():'none';})()");
  console.log('  浮窗按钮:', btn);
  ck(btn !== 'none', '★ 浮窗里有「学习」按钮', btn);

  let shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ROOT, 'docs/shots/book-bag.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('  存: book-bag.png');

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  if (FAILS) { console.log('FAILED: ' + FAILS); process.exit(1); }
  console.log('全部通过');
})();
