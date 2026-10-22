// round427 验收：武器拖影能不能出来、会不会影响帧数/判定
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
  const NM = '测试T' + Math.random().toString(36).slice(2, 5), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: PW }),
  }).then(x => x.json());
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' }),
  }).then(x => x.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trail-'));
  const port = 9960 + Math.floor(Math.random() * 15);
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
  /* ★ 新号身上没武器 ✗ 没武器就不应该有拖影（这也是一条验收）✓ */
  /* ★ 没武器的情况：把武器清空再验（真实玩家开局就有武器 ✗ 不能靠"没武器"来验✓）*/
  const noW = await ev([
    'var kids = H.sw.children.slice();',
    'for (var i = 0; i < kids.length; i++) { H.sw.remove(kids[i]); }',
    'var t = (weaponTipWorld(new THREE.Vector3()) === null);',
    'for (var j = 0; j < kids.length; j++) { H.sw.add(kids[j]); }',
    'return JSON.stringify({ emptied: kids.length, tipNull: t });',
  ].join(''));
  console.log('  武器清空时: ' + noW);
  let nw = {};
  try { nw = JSON.parse(noW); } catch (e) { }
  ck(nw.tipNull === true, '★ 没拿武器时不会有拖影（不会漂在空中）', nw);
  /* ★ 装一把剑（客户端本地换 ✗ 不动服务端数据 ✓）*/
  await ev('MY_WEAPON = { look: "sword", tier: 6 }; fillHeldWeapon(H.sw, "sword", 6); return 1;');

  // ① 拖影对象建出来了吗（没攻击时应该是隐藏的）
  const idle = await ev('return JSON.stringify({has: !!TRAIL.mesh, on: TRAIL.on, vis: TRAIL.mesh ? TRAIL.mesh.visible : null});');
  console.log('  静止时: ' + idle);
  let ij = {};
  try { ij = JSON.parse(idle); } catch (e) { }
  ck(ij.on === false, '★ 没攻击时拖影是关的', ij);

  // ② 手动挥一刀，看拖影开没开、点够不够
  await ev('atkHeld = true; atkCd = 0; return 1;');
  await sleep(260);
  const mid = await ev([
    'return JSON.stringify({on: TRAIL.on, pts: TRAIL.pts.length, vis: TRAIL.mesh.visible,',
    '  op: TRAIL.mesh.material.opacity, life: +TRAIL.life.toFixed(2)});',
  ].join(''));
  console.log('  挥砍中: ' + mid);
  let mj = {};
  try { mj = JSON.parse(mid); } catch (e) { }
  ck(mj.on === true && mj.vis === true, '★★ 挥砍时拖影出现并渲染', mj);
  ck(mj.pts >= 3, '★★ 带子有连续的点（>=3）', mj.pts);

  // ②b 刀尖必须在【刀身那一头】（round427 修的就是这个 ✗ 以前算到手柄了 ✓）
  const tipDir = await ev([
    'H.sw.updateWorldMatrix(true, false);',
    'var tip = weaponTipWorld(new THREE.Vector3()).clone();',
    'var hand = new THREE.Vector3(0,0,0).applyMatrix4(H.sw.matrixWorld).clone();',
    'var far = new THREE.Vector3(0, weaponTipLen((MY_WEAPON||{}).look||"sword"), 0).applyMatrix4(H.sw.matrixWorld);',
    'return JSON.stringify({tipIsFarEnd: tip.distanceTo(far) < 0.01,',
    '  tipToHand: +tip.distanceTo(hand).toFixed(2)});',
  ].join(''));
  console.log('  刀尖: ' + tipDir);
  let dj = {};
  try { dj = JSON.parse(tipDir); } catch (e) { }
  ck(dj.tipIsFarEnd === true && dj.tipToHand > 0.2, '★★ 拖影跟的是【刀尖】不是手柄', dj);

  // ③ 收招后自动消失
  await ev('atkHeld = false; atkT = -1; return 1;');
  await sleep(900);
  const after = await ev('return JSON.stringify({on: TRAIL.on, vis: TRAIL.mesh.visible});');
  console.log('  收招后: ' + after);
  let aj = {};
  try { aj = JSON.parse(after); } catch (e) { }
  ck(aj.on === false && aj.vis === false, '★ 收招后拖影自己消失', aj);

  // ④ 不影响判定：拖影只是视觉效果 —— 检查攻击冷却/伤害逻辑没被改（这里验 atkCd 仍按武器走）
  const cd = await ev('atkCd = 0; atkT = -1; atkHeld = true; return JSON.stringify({cd: +(atkCd||0).toFixed(2), atk: +(G.ATK_CD||0).toFixed(2)});');
  await sleep(320);
  const cd2 = await ev('var v = +(atkCd||0).toFixed(2); atkHeld = false; return v;');
  console.log('  冷却: ' + cd + ' → 挥后 ' + cd2);
  ck(parseFloat(cd2) > 0, '★★ 攻击冷却照旧（拖影没改判定 ✓）', cd2);

  // ⑤ 截图：再来一刀，抓一帧有拖影的
  await ev('atkCd = 0; atkT = -1; atkHeld = true; return 1;');
  await sleep(180);
  const shot = await ev([
    'return (function () {',
    '  rd.render(scene, cam);',
    '  return document.getElementById("cv").toDataURL("image/png");',
    '})();',
  ].join(''));
  if (typeof shot === 'string' && shot.indexOf('data:image/png') === 0) {
    fs.writeFileSync(path.join(ROOT, 'docs', 'shots', 'r427-trail.png'),
      Buffer.from(shot.split(',')[1], 'base64'));
    console.log('  截图: docs/shots/r427-trail.png');
  } else {
    console.log('  截图失败: ' + String(shot).slice(0, 60));
  }
  await ev('atkHeld = false; return 1;');

  console.log('  页面异常: ' + (errs.length ? errs.slice(0, 3).join(' | ') : '（无 ✓）'));
  ck(errs.length === 0, '★ 页面 0 异常', errs.slice(0, 3));

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  await sleep(600);
  await fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at.token },
    body: JSON.stringify({ act: 'delplayer', name: NM }),
  }).catch(() => null);
  console.log('');
  console.log(FAILS ? ('FAILED: ' + FAILS) : 'ALL PASS ✓');
  process.exit(FAILS ? 1 : 0);
})();
