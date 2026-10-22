// test_skin_spin_zoom.js -- 放大之后自转还在不在
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
  const nm = '转' + Math.random().toString(36).slice(2, 5);
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nm, password: 'abc123456' })
  }).then(x => x.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spin-'));
  const port = 5990 + Math.floor(Math.random() * 9);
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
      errs.push(String((d.exception && d.exception.description) || d.text).slice(0, 120));
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
  await ev('try{ openSet(); setTab("skin"); }catch(e){}');
  await sleep(1000);

  const measure = `new Promise(function(res){
    var r0 = SKIN.rot, t0 = performance.now();
    setTimeout(function(){
      var dt = (performance.now() - t0) / 1000;
      res(+(((SKIN.rot - r0) * 180 / Math.PI) / dt).toFixed(1));
    }, 1200);
  })`;

  const a = await ev(measure);
  ck(Math.abs(a) > 5, '放大前在自转（°/秒）', a);

  // 滚轮放大 5 次
  await ev(`(function(){
      var c = document.getElementById('skCv');
      for (var i = 0; i < 5; i++) {
        c.dispatchEvent(new WheelEvent('wheel', {bubbles:true, deltaY:-120, cancelable:true}));
      }
      return SKIN.zoom;
    })()`).then(v => console.log('   zoom =', v));
  await sleep(400);

  const b = await ev(measure);
  /* ★ round516：手动缩放/拖动之后【就应该停转】✗ 不是继续转 ✓ */
  ck(Math.abs(b) <= 1.5, '放大后自动自转已停（°/秒 接近 0）', b);
  ck(await ev('SKIN.autoRot === false'), 'autoRot 被手动操作关掉了');

  // 换皮肤 → 恢复自转
  await ev('try{ skinPreviewShow("f02"); SKIN.rot = 0; }catch(e){}');
  await sleep(300);
  const c = await ev(measure);
  ck(Math.abs(c) > 5, '换皮肤后自转恢复（°/秒）', c);

  // 拖一下 → 又停
  await ev(`(function(){
      var cv = document.getElementById('skCv');
      cv.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, clientX:200, clientY:120, pointerId:2}));
      cv.dispatchEvent(new PointerEvent('pointermove', {bubbles:true, clientX:240, clientY:120, pointerId:2}));
      cv.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, pointerId:2}));
      return SKIN.autoRot;
    })()`).then(v => ck(v === false, '拖动后 autoRot 也关掉'));
  await sleep(200);
  const d2 = await ev(measure);
  ck(Math.abs(d2) <= 1.5, '拖动后也不自转（°/秒 接近 0）', d2);

  /* ★ round517：上下拖动要能改视角高度；左右拖动要"跟手"（每 10px ≈ 0.12 弧度）*/
  const dy = await ev(`(function(){
      var cv = document.getElementById('skCv');
      var y0 = SKIN.camY, r0 = SKIN.rot;
      cv.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, clientX:200, clientY:150, pointerId:3}));
      for (var i = 1; i <= 10; i++) {
        cv.dispatchEvent(new PointerEvent('pointermove', {bubbles:true, clientX:200 + i*10, clientY:150 - i*10, pointerId:3}));
      }
      cv.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, pointerId:3}));
      return JSON.stringify({ dY: +(SKIN.camY - y0).toFixed(3), dRot: +(SKIN.rot - r0).toFixed(3),
                              ta: getComputedStyle(cv).touchAction });
    })()`);
  const dj = JSON.parse(dy || '{}');
  console.log('   拖动结果:', dj);
  ck(Math.abs(dj.dY) > 0.2, '上下拖动有效（相机高度变了）', dj.dY);
  ck(Math.abs(Math.abs(dj.dRot) - 1.2) < 0.25, '左右拖动跟手（100px ≈ 1.2 弧度）', dj.dRot);
  ck(dj.ta === 'none', '画布设了 touch-action:none（浏览器不再抢手势）', dj.ta);

  ck(errs.length === 0, '页面没有异常（NaN 修好之后 rAF 不会断）', errs.slice(0, 2));

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  if (FAILS) { console.log('FAILED: ' + FAILS); process.exit(1); }
  console.log('全部通过');
})();
