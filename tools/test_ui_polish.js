// test_ui_polish.js -- round531：设置二级菜单 / 相机滑条 60~300 / 拖动跟手
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
  const nm = '设置' + Math.random().toString(36).slice(2, 4);
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nm, password: 'abc123456' })
  }).then(x => x.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pol-'));
  const port = 5915 + Math.floor(Math.random() * 10);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1100,900', 'about:blank'], { stdio: 'ignore' });
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
  let id = 0; const wait = {}; const errs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      errs.push(String((d.exception && d.exception.description) || d.text).slice(0, 140));
    }
    if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; }
  };
  const send = (mm, pp) => new Promise(res => { const i = ++id; wait[i] = res; ws.send(JSON.stringify({ id: i, method: mm, params: pp || {} })); });
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.result.value;

  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Page.navigate', { url: ORIGIN + '/?t=' + Date.now() });
  await sleep(1200);
  await ev('localStorage.setItem("token",' + JSON.stringify(reg.token) + ')');
  await send('Page.reload', {});
  await sleep(9000);
  await ev('try{annClose()}catch(e){}');
  await ev('try{ openSet(); setTab("view"); }catch(e){}');
  await sleep(800);

  ck(await ev('document.querySelectorAll("#setPanel .setSub").length') === 3,
     '设置页有 3 套二级导航（画面/操作/音效各一份）', await ev('document.querySelectorAll("#setPanel .setSub").length'));
  ck(await ev('!!document.querySelector("#setPanel .setSub .sub.on")'), '当前高亮一项');

  // 相机滑条
  const zr = await ev('JSON.stringify((function(){var e=document.getElementById("zoomRange");return e?{min:e.min,max:e.max,val:e.value}:null;})())');
  console.log('   滑条:', zr);
  const zj = JSON.parse(zr || 'null') || {};
  ck(zj.min === '60' && zj.max === '300', '滑条范围 60~300', zj);
  await ev(`(function(){var e=document.getElementById('zoomRange');e.value='300';e.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
  await sleep(300);
  ck(await ev('setWorldZoom()') === 300, '拖到 300 → 生效', await ev('setWorldZoom()'));
  ck(await ev('Math.round(cam.fov)') !== 52, '相机 fov 真的变了', await ev('Math.round(cam.fov)'));
  await ev(`(function(){var e=document.getElementById('zoomRange');e.value='60';e.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
  await sleep(300);
  ck(await ev('setWorldZoom()') === 60, '拖到 60 → 生效', await ev('setWorldZoom()'));

  // 拖动跟手：编辑模式拖攻击键，中途检查 transform 是否已经在动
  await ev('try{ uiEditToggle(); }catch(e){}');
  await sleep(300);
  await ev(`(function(){
      var b = document.getElementById('atk');
      var r = b.getBoundingClientRect();
      window.__pr = r;
      b.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, clientX:r.x+20, clientY:r.y+20, pointerId:9}));
      for (var i=1;i<=6;i++) {
        document.dispatchEvent(new PointerEvent('pointermove', {bubbles:true, clientX:r.x+20-i*10, clientY:r.y+20-i*10, pointerId:9}));
      }
      return 1;
    })()`);
  await sleep(250);   /* ★ 等一帧 ✗ 我用 rAF 落位 ✓ */
  const midT = await ev("document.getElementById('atk').style.transform");
  console.log('   拖动中的 transform:', midT);
  ck(String(midT).indexOf('translate') === 0, '★ 拖动过程中就已经在动（不是松手才跳）', midT);
  const tr = await ev("document.getElementById('atk').style.transition");
  ck(tr === 'none', '拖动中过渡被关掉（不会一顿一顿）', tr);
  await ev(`document.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, pointerId:9}))`);
  await sleep(300);
  const after = await ev("JSON.stringify({t:document.getElementById('atk').style.transition, tr:document.getElementById('atk').style.transform, l:document.getElementById('atk').style.left})");
  console.log('   松手后:', after);

  ck(errs.length === 0, '页面没有异常', errs.slice(0, 2));

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  if (FAILS) { console.log('FAILED: ' + FAILS); process.exit(1); }
  console.log('全部通过');
})();
