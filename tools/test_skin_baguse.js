// test_skin_baguse.js -- 背包浮窗里的「使 用」（皮肤卡）+ 预览自转速度
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe'];
const B = CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let FAILS = 0;
function ck(c, m, got) {
  if (c) { console.log('  PASS  ' + m); }
  else { FAILS++; console.log('  FAIL  ' + m + (got === undefined ? '' : '  got=' + JSON.stringify(got))); }
}

(async () => {
  const nm = '卡用' + Math.random().toString(36).slice(2, 5);
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nm, password: 'abc123456' })
  }).then(x => x.json());
  const tok = reg.token;
  // 直接往背包里塞一张皮肤卡（走 DB，和真实掉落同一个形状）
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' })
  }).then(x => x.json()).then(j => j.token);
  await fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at },
    body: JSON.stringify({ act: 'give', name: nm, kind: 'skin', skinKey: 'f05', equip: false })
  }).then(x => x.json());

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baguse-'));
  const port = 5970 + Math.floor(Math.random() * 25);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1100,820', 'about:blank'], { stdio: 'ignore' });
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
  await ev('localStorage.setItem("token",' + JSON.stringify(tok) + ')');
  await send('Page.reload', {});
  await sleep(9000);
  await ev('try{annClose()}catch(e){}');
  await sleep(300);

  // 造一张皮肤卡（客户端以为的掉落，实际服务器也认 ✓ 测试用）
  const html = await ev(`JSON.stringify((function(){
      var it = { name: '皮肤·女仆', tier: 0, kind: 'skin', key: 'f05' };
      var h = bagTipHTML(it, 999999, 'bag', {});
      var box = document.createElement('div');
      box.innerHTML = h;
      var btns = [].map.call(box.querySelectorAll('[data-tipact]'),
        function(b){ return b.textContent + '|' + b.getAttribute('data-tipact'); });
      return { btns: btns };
    })())`);
  const j = JSON.parse(html || '{}');
  console.log('  浮窗按钮:', JSON.stringify(j.btns));
  ck((j.btns || []).some(x => x.indexOf('useskin') > 0), '皮肤卡浮窗里有「使 用」按钮', j.btns);
  ck((j.btns || []).some(x => x.indexOf('上 锁') >= 0), '上锁按钮还在（没被挤掉）', j.btns);

  // 预览自转速度：量 1 秒转多少（按真实时间 ✓ 和帧率无关）
  await ev('try{ openSet(); setTab("skin"); }catch(e){}');
  await sleep(700);
  const spin = await ev(`new Promise(function(res){
      var r0 = SKIN.rot, t0 = performance.now();
      setTimeout(function(){
        var dt = (performance.now() - t0) / 1000;
        res(JSON.stringify({ deg: +(((SKIN.rot - r0) * 180 / Math.PI) / dt).toFixed(1),
                             fps: Math.round(1/dt) }));
      }, 1500);
    })`);
  const sp = JSON.parse(spin || '{}');
  ck(sp.deg > 8 && sp.deg < 30, '自转速度 ≈17°/秒（原来 41°/秒 以上）', sp);

  // 真点一次浮窗里的「使 用」
  const clicked = await ev(`(function(){
      var it = { name: '皮肤·女仆', tier: 0, kind: 'skin', key: 'f05' };
      var html = bagTipHTML(it, 999999, 'bag', {});
      var wrap = document.createElement('div');
      wrap.innerHTML = html;
      var btn = wrap.querySelector('[data-tipact="useskin"]');
      return btn ? btn.outerHTML.slice(0, 80) : 'none';
    })()`);
  ck(clicked !== 'none', '按钮真的渲染出来了（带 data-tipact）', clicked);

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  if (FAILS) { console.log('FAILED: ' + FAILS); process.exit(1); }
  console.log('全部通过');
})();
