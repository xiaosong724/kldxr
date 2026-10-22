// test_camera.js -- 视角转动验收（真浏览器）
// 覆盖：按钮存在/切换状态 · 旋转生效 · 移动方向跟着镜头 · 长按回正 · 刷新后保持
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = process.env.PAGE || 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const B = CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let FAILS = 0;
function ck(c, m, got) {
  if (c) { console.log('  PASS  ' + m); }
  else { FAILS++; console.log('  FAIL  ' + m + (got === undefined ? '' : '  got=' + JSON.stringify(got))); }
}

(async () => {
  const nm = '视角' + Math.random().toString(36).slice(2, 6);
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nm, password: 'abc123456' })
  }).then(x => x.json());
  const tok = reg.token;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cam-'));
  const port = 5500 + Math.floor(Math.random() * 60);
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
  let id = 0; const wait = {}; const errs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      errs.push((d.exception && d.exception.description) || d.text);
    }
    if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; }
  };
  const send = (mm, pp) => new Promise(res => { const i = ++id; wait[i] = res; ws.send(JSON.stringify({ id: i, method: mm, params: pp || {} })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return (r.result && r.result.result) ? r.result.result.value : undefined;
  };

  await send('Page.enable', {});
  await send('Runtime.enable', {});
  await send('Page.navigate', { url: ORIGIN + '/?t=' + Date.now() });
  await sleep(1200);
  await ev('localStorage.setItem("token",' + JSON.stringify(tok) + ')');
  await send('Page.reload', {});
  await sleep(9000);

  // 先关掉可能弹出的公告（不影响下面测量）
  await ev('try{ annClose(); }catch(e){}');
  await sleep(400);

  ck(await ev('!!document.getElementById("cam")'), '视角按钮存在');
  ck(await ev('typeof camAdd === "function" && typeof camState === "function"'), 'core 有 camAdd / camState');

  // ① 点一下 → 解锁（.on）
  await ev('document.getElementById("cam").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));' +
           'document.getElementById("cam").dispatchEvent(new PointerEvent("pointerup",{bubbles:true}));');
  await sleep(200);
  ck(await ev('CAMROT.on === true'), '点一下：解锁（可转）');
  ck(await ev('document.getElementById("cam").classList.contains("on")'), '图标带状态（.on）');

  // ② 旋转生效 + 平滑（拖手只改目标，当前角追上去）
  const before = await ev('camState().yaw');
  await ev('camAdd(180, 0)');
  const after = await ev('camState().yaw');
  ck(Math.abs(after - before) > 0.5, '拖动后 yaw 变了', { before, after });

  /* ★ round498：平滑 —— 刚拖完"当前角"还没到目标，200ms 后应该追上 */
  const lag = await ev('JSON.stringify({ cur: CAM_YAW, tgt: CAM_YAW_T })');
  const lagj = JSON.parse(lag || '{}');
  ck(Math.abs(lagj.tgt - lagj.cur) > 0.05, '拖动后当前角【滞后】于目标角（说明是缓动不是直接跳）', lagj);
  await sleep(400);
  const settled = JSON.parse(await ev('JSON.stringify({ cur: CAM_YAW, tgt: CAM_YAW_T })') || '{}');
  ck(Math.abs(settled.tgt - settled.cur) < 0.02, '约 400ms 内平滑追上目标', settled);

  // ③ 移动方向跟着镜头：yaw ≈ 90° 时按 W，应该主要沿 X 走（而不是 Z）
  await ev('camSet(Math.PI/2, 1.02); P.x=0; P.z=0; P.y=terYAt(0,0); P.air=false; P.gy=P.y;' +
           'keys={}; MOV.vx=0; MOV.vz=0;');
  await sleep(120);
  const mv = await ev(`new Promise(function(res){
      var x0 = P.x, z0 = P.z;
      keys['w'] = true;
      setTimeout(function(){
        keys['w'] = false;
        res(JSON.stringify({dx: +(P.x-x0).toFixed(2), dz: +(P.z-z0).toFixed(2)}));
      }, 700);
    })`);
  const mvj = JSON.parse(mv || '{}');
  ck(Math.abs(mvj.dx) > Math.abs(mvj.dz) * 1.8,
     '镜头转 90° 后，按 W 走的方向也跟着转（主要沿 X 走）', mvj);

  // ③b ★ round501：自动战斗写的是【世界方向】✗ 不能被镜头再转一次 ✓
  const autoMv = await ev(`new Promise(function(res){
      var _bak = autoTick;
      autoTick = function(){};
      camSet(Math.PI/2, 1.02);
      P.x = 0; P.z = 0; P.y = terYAt(0,0); P.air = false; P.gy = P.y;
      MOV.vx = 0; MOV.vz = 0; keys = {};
      AUTO.setInput = true; jx = 1; jy = 0;      /* 世界 +X （AI 会这么写）*/
      var x0 = P.x, z0 = P.z;
      setTimeout(function(){
        autoTick = _bak;
        AUTO.setInput = false; jx = 0; jy = 0;
        res(JSON.stringify({dx: +(P.x-x0).toFixed(2), dz: +(P.z-z0).toFixed(2)}));
      }, 700);
    })`);
  const amv = JSON.parse(autoMv || '{}');
  ck(amv.dx > 0.4 && Math.abs(amv.dz) < Math.abs(amv.dx) * 0.6,
     '镜头转 90° 后，自动战斗的世界方向不被转歪（仍朝 +X 走）', amv);

  // ④ 再点一次 → 锁定
  await ev('document.getElementById("cam").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));' +
           'document.getElementById("cam").dispatchEvent(new PointerEvent("pointerup",{bubbles:true}));');
  await sleep(200);
  ck(await ev('CAMROT.on === false'), '再点一下：锁定');
  ck(await ev('!document.getElementById("cam").classList.contains("on")'), '图标状态同步（去掉 .on）');

  // ⑤ 刷新后保持角度（localStorage）
  /* ★ round500：拖完【马上】刷新（不等节流）也要存住 ✗ 这是当年的洞 ✓ */
  /* 模拟"拖完立刻松手 → 马上刷新"：松手就该已经存好了 ✓ */
  await ev('camSet(1.1, 0.9); camSaveSoon(); camSaveNow();');
  const _savedNow = await ev('localStorage.getItem("camView_v1") || ""');
  ck(String(_savedNow).length > 0, '角度已经写进 localStorage', _savedNow);
  await sleep(200);
  await send('Page.reload', {});
  await sleep(9000);
  await ev('try{ annClose(); }catch(e){}');
  await sleep(300);
  const restored = await ev('JSON.stringify(camState())');
  const rj = JSON.parse(restored || '{}');
  ck(Math.abs(rj.yaw - 1.1) < 0.25, '刷新后视角保持（存档生效）', rj);

  // ⑥ 长按 1 秒 → 回正
  await ev(`(function(){
      var el = document.getElementById('cam');
      el.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}));
      return 1;
    })()`);
  await sleep(1300);
  await ev(`document.getElementById('cam').dispatchEvent(new PointerEvent('pointerup',{bubbles:true}))`);
  await sleep(300);
  const reset = JSON.parse(await ev('JSON.stringify(camState())') || '{}');
  ck(Math.abs(reset.yaw) < 0.02, '长按 1 秒：视角回正', reset);
  ck(await ev('CAMROT.on === false'), '长按后是锁定状态');

  console.log('  页面错误: ' + (errs.length ? errs.slice(0, 2).join(' | ') : '(无)'));
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  if (FAILS) { console.log('FAILED: ' + FAILS); process.exit(1); }
  console.log('全部通过');
})();
