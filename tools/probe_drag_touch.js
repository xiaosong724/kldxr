// probe_drag_touch.js -- 用【真实触摸事件】拖攻击键，看拖动过程中按钮有没有动
const { spawn } = require('child_process');
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
  const nm = '拖' + Math.random().toString(36).slice(2, 4);
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nm, password: 'abc123456' })
  }).then(x => x.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drag-'));
  const port = 5930 + Math.floor(Math.random() * 10);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=900,760', 'about:blank'], { stdio: 'ignore' });
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
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.navigate', { url: ORIGIN + '/?t=' + Date.now() });
  await sleep(1200);
  await ev('localStorage.setItem("token",' + JSON.stringify(reg.token) + ')');
  await send('Page.reload', {});
  await sleep(9000);
  await ev('try{annClose()}catch(e){}');
  await ev('try{ uiEditToggle(); }catch(e){}');
  await sleep(400);
  console.log('   编辑模式:', await ev('UI_EDIT'));

  const r = JSON.parse(await ev('JSON.stringify((function(){var b=document.getElementById("atk").getBoundingClientRect();return {x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)};})())'));
  console.log('   按钮中心:', r);

  // 真实触摸拖动：向左上拖 80px
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x, y: r.y, id: 1 }] });
  await sleep(120);
  const seen = [];
  for (let i = 1; i <= 8; i++) {
    await send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: r.x - i * 10, y: r.y - i * 10, id: 1 }]
    });
    await sleep(80);
    seen.push(await ev("(function(){var e=document.getElementById('atk');return (e.style.left||'')+'|'+(e.style.top||'')+'|'+(e.style.transform||'');})()"));
  }
  console.log('   拖动过程中每步的 transform:');
  seen.forEach((s, i) => console.log('     ' + (i + 1) + ': ' + s));
  ck(seen.filter(x => x.indexOf('px|') > 0).length >= 5, '★ 拖动过程中按钮一直在动（left/top 在变）', seen.length);

  const distinct = new Set(seen.filter(x => x));
  ck(distinct.size >= 4, '★ 位置是一步步变的（不是最后才跳）', distinct.size);

  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(300);
  const fin = await ev("JSON.stringify({t:document.getElementById('atk').style.transition,tr:document.getElementById('atk').style.transform,l:document.getElementById('atk').style.left,tp:document.getElementById('atk').style.top})");
  console.log('   松手后:', fin);
  const fj = JSON.parse(fin || '{}');
  ck(!fj.tr && fj.l, '松手后落到 left/top 并清掉 transform', fj);

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  if (FAILS) { console.log('FAILED: ' + FAILS); process.exit(1); }
  console.log('全部通过');
})();
