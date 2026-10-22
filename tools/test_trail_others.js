// 验收：A 挥砍 → B（另一个浏览器）屏幕上也要出现 A 的拖影
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

async function boot(token, port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtrail-'));
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
  await sleep(1200);
  await ev('localStorage.setItem("token",' + JSON.stringify(token) + '); location.reload(); return 1;');
  await sleep(10000);
  return { ev, errs, dir, proc, send };
}

(async () => {
  const sfx = Math.random().toString(36).slice(2, 5);
  const NA = '测试攻击A' + sfx, NB = '测试攻击B' + sfx, PW = 'abc123456';
  const regA = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NA, password: PW }),
  }).then(x => x.json());
  const regB = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NB, password: PW }),
  }).then(x => x.json());
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' }),
  }).then(x => x.json());

  const A = await boot(regA.token, 9870 + Math.floor(Math.random() * 10));
  const Bc = await boot(regB.token, 9885 + Math.floor(Math.random() * 10));
  console.log('  两个客户端都进游戏了');

  // 让 B 走到 A 旁边（直接改坐标，服务端会纠正 → 所以改用 A 传送到 B）
  const posA = await A.ev('return JSON.stringify({x:+P.x.toFixed(1), z:+P.z.toFixed(1)});');
  const posB = await Bc.ev('return JSON.stringify({x:+P.x.toFixed(1), z:+P.z.toFixed(1)});');
  console.log('  A 在 ' + posA + '，B 在 ' + posB);
  /* ★★ 关键：安全区里服务器不认攻击 ✗ atkSeq 不涨 → 别人永远看不到刀光 ✗
     所以先把两个人都弄出去（直接发 move 包 → 服务器采用客户端位置 ✓）*/
  async function tp(C, x, z) {
    await C.ev('P.x = ' + x + '; P.z = ' + z + '; wsSend("move", {x: ' + x + ', z: ' + z
      + ', yaw: 0, t: performance.now() / 1000}); return 1;');
  }
  await tp(A, 60, 60);
  await tp(Bc, 62, 62);
  await sleep(1200);

  // A 装把剑 + 挥砍
  await A.ev('MY_WEAPON = { look: "sword", tier: 7 }; fillHeldWeapon(H.sw, "sword", 7);'
    + 'atkCd = 0; atkT = -1; atkHeld = true; return 1;');
  // 改成轮询：A 可能因为冷却/上一个动作没播完而没挥起来，一次判定会误报
  let idA = null, best = null;
  for (let i = 0; i < 14; i++) {
    await A.ev('atkCd = 0; if (atkT < 0) { atkHeld = true; } return 1;');
    await sleep(230);
    if (!idA) { idA = await A.ev('return String(WSC.myId);'); }
    const aSt = await A.ev('return JSON.stringify({atkT:+atkT.toFixed(2), seq:NET.atkSeq});');
    const bSt = await Bc.ev('var o = NET.others["' + idA + '"]; return JSON.stringify(o ? {seq: o.atkSeq, atkT: +(+o.atkT).toFixed(2), tid: o._tid || null, wl: o.wlook} : "no entry");');
    console.log('    A 状态: ' + aSt + '   B 看到的 A: ' + bSt);
    const raw = await Bc.ev([
      'return (function () {',
      '  var out = [];',
      '  for (var uid in NET.others) {',
      '    var o = NET.others[uid];',
      '    if (!o || !o.hh || !o.hh.sw) { continue; }',
      '    out.push({ uid: uid, atkT: +(o.atkT || -1).toFixed(2), wlook: o.wlook,',
      '      tid: o._tid || null,',
      '      meshVis: (o._tid && TRAILS[o._tid] ? TRAILS[o._tid].mesh.visible : null),',
      '      pts: (o._tid && TRAILS[o._tid] ? TRAILS[o._tid].pts.length : null) });',
      '  }',
      '  return JSON.stringify({ others: Object.keys(NET.others).length, list: out });',
      '})();',
    ].join(''));
    if (i === 0) { console.log('    raw = ' + String(raw).slice(0, 300)); }
    let v2 = {};
    try { v2 = JSON.parse(raw); } catch (e) { }
    const a2 = (v2.list || []).filter(function (x) { return String(x.uid) === String(idA); })[0];
    if (a2) { best = { v: v2, a: a2 }; }
    if (a2 && a2.meshVis === true && (a2.pts || 0) >= 3) { break; }
  }
  console.log('  A 的 id = ' + idA);
  console.log('  B 看到的: ' + JSON.stringify(best && best.a));
  const vv = (best && best.v) || {};
  const a = (best && best.a) || {};
  ck((vv.others || 0) >= 1, '★ B 能看到 A（在视野里）', vv.others);
  ck(!!a.tid, '★★ B 给 A 建了拖影对象（_tid）', a.tid);
  ck(a.meshVis === true && (a.pts || 0) >= 3, '★★ A 挥砍时，B 屏幕上 A 的拖影在画（点数 >=3）', [a.meshVis, a.pts]);

  // A 停手 → B 那边应淡出
  await A.ev('atkHeld = false; atkT = -1; return 1;');
  await sleep(1400);
  const after = await Bc.ev('var a = TRAILS[Object.keys(TRAILS).find(function(k){return k!=="me";})];'
    + 'return JSON.stringify(a ? {on: a.on, vis: a.mesh.visible} : null);');
  console.log('  A 停手后: ' + after);
  let af = {};
  try { af = JSON.parse(after) || {}; } catch (e) { }
  ck(af.on === false, '★ A 停手后 B 那边拖影淡出', af);

  console.log('  页面异常 A: ' + (A.errs.length ? A.errs.slice(0, 2).join(' | ') : '无')
    + ' · B: ' + (Bc.errs.length ? Bc.errs.slice(0, 2).join(' | ') : '无'));
  ck(A.errs.length === 0 && Bc.errs.length === 0, '★ 两个页面都 0 异常');

  // 截图（B 的视角）
  await A.ev('atkCd = 0; atkT = -1; atkHeld = true; return 1;');
  await sleep(380);
  const shot = await Bc.ev('rd.render(scene, cam); return document.getElementById("cv").toDataURL("image/png");');
  if (typeof shot === 'string' && shot.indexOf('data:image/png') === 0) {
    fs.writeFileSync(path.join(ROOT, 'docs', 'shots', 'r428-other-trail.png'),
      Buffer.from(shot.split(',')[1], 'base64'));
    console.log('  截图: docs/shots/r428-other-trail.png（B 的视角，看 A 的刀光）');
  }

  for (const C of [A, Bc]) {
    try { spawn('taskkill', ['/PID', String(C.proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
    try { fs.rmSync(C.dir, { recursive: true, force: true }); } catch (e) { }
  }
  await sleep(800);
  for (const nm of [NA, NB]) {
    await fetch(ORIGIN + '/api/admin/act', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at.token },
      body: JSON.stringify({ act: 'delplayer', name: nm }),
    }).catch(() => null);
  }
  console.log('');
  console.log(FAILS ? ('FAILED: ' + FAILS) : 'ALL PASS ✓');
  process.exit(FAILS ? 1 : 0);
})();
