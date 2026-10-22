// round407 冒烟：长枪挑飞玩家（交接文档第四节 ④）—— 客户端那一半
//   验三件事（都要真实运行时的数值 ✓ 不看代码猜 ✗）：
//     ① 收到 launch_me → 自己的模型真的升空（峰值 ≈ 3.72 米，1.5 秒落回 0）
//     ② 空中【走不动】（按住前进键，x/z 不动）
//     ③ 空中【还能打】（atkHeld 一按，atkT 就起）—— 用户定的规则
//   跑法：先起服务（server/_serve2.py），再 node tools/smoke_fly.js
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'];
const B = process.env.CHROME || CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PW = 'abc123456';

(async () => {
  const h = await fetch(ORIGIN + '/api/health').then(x => x.json()).catch(() => null);
  if (!h || !h.ok) { console.error('服务没起'); process.exit(1); }
  const SFX = Math.random().toString(36).slice(2, 5);
  const NM = '测试FLY' + SFX;
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: PW }),
  }).then(x => x.json());
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' }),
  }).then(x => x.json());

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx2d-fly-'));
  const port = 9620 + Math.floor(Math.random() * 60);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=520,900', ORIGIN + '/'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 100 && !target; i++) {
    await sleep(250);
    try {
      const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      target = l.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) { }
  }
  if (!target) { console.error('连不上浏览器'); process.exit(1); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const wait = {}; const errs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params && m.params.exceptionDetails;
      errs.push(String((d && d.exception && d.exception.description) || (d && d.text) || '?'));
    }
    if (m.method === 'Log.entryAdded') {
      const en = m.params && m.params.entry;
      if (en && en.level === 'error') { errs.push('[log] ' + en.text); }
    }
  };
  const send = (m, p) => new Promise(res => {
    const i = ++id; wait[i] = res;
    ws.send(JSON.stringify({ id: i, method: m, params: p || {} }));
    setTimeout(() => { if (wait[i]) { delete wait[i]; res(null); } }, 25000);
  });
  const evRaw = async (x, awaitP) => {
    const r = await send('Runtime.evaluate', {
      expression: '(function(){' + x + '})()',
      returnByValue: true, awaitPromise: !!awaitP,
    });
    if (r && r.result && r.result.exceptionDetails) { return '__THROW__ ' + r.result.exceptionDetails.text; }
    return r && r.result && r.result.result ? r.result.result.value : undefined;
  };
  const ev = x => evRaw(x, false);
  await send('Runtime.enable', {});
  await send('Log.enable', {});
  await sleep(1500);
  await ev('localStorage.setItem("token",' + JSON.stringify(reg.token) + '); location.reload(); return 1;');
  await sleep(8000);

  const ready = await ev('return JSON.stringify({ ready: (typeof WSC !== "undefined") && WSC.ready,'
    + ' flyFn: typeof flyYNow, hasH: !!H });');
  console.log('  状态: ' + ready);

  // 挪到安全区外的平地（安全区里打不了人，但这条只验"模型升空"，位置无所谓 ✓）
  await ev('P.x = 60; P.z = 60; P.y = terYAt(60, 60); P.air = false; P.gy = P.y;'
    + ' P.jumping = false; P.vy = 0; return 1;');
  await sleep(600);

  const res = await evRaw([
    'keys["w"] = false; keys["a"] = false; keys["s"] = false; keys["d"] = false;',
    'atkHeld = false; atkT = -1; atkCd = 0;',
    'P.x = 60; P.z = 60; P.y = terYAt(P.x, P.z); P.air = false; P.gy = P.y;',
    'var x0 = P.x, z0 = P.z;',
    'var t0 = performance.now();',
    'wsOnMessage(JSON.stringify({ t: "fx", d: { kind: "launch_me", h: 3.72, t: 1.5 } }));',
    'keys["w"] = true;',                       // ★ 按住前进：升空期间应该走不动
    'var peak = 0, peakAt = 0, movedDuring = 0, atkSeen = -1, samples = [];',
    'return new Promise(function (resolve) {',
    '  function tick() {',
    '    var t = performance.now() - t0;',
    '    var base = terYAt(P.x, P.z);',
    '    var vis = H.g.position.y - base;',    // ★ 真实渲染位置（不是 P.y ✓）
    '    if (vis > peak) { peak = vis; peakAt = t; }',
    '    if (t > 120 && t < 1400) {',
    '      var d = Math.sqrt((P.x - x0) * (P.x - x0) + (P.z - z0) * (P.z - z0));',
    '      if (d > movedDuring) { movedDuring = d; }',
    '    }',
    '    if (t > 250 && t < 300) { atkHeld = true; atkCd = 0; atkT = -1; }',
    '    if (t > 400 && atkSeen < 0 && atkT >= 0) { atkSeen = atkT; }',
    '    if (t > 500) { atkHeld = false; }',
    '    if (samples.length < 40 && t > samples.length * 40) {',
    '      samples.push([Math.round(t), Math.round(vis * 100) / 100]);',
    '    }',
    '    if (t < 1750) { requestAnimationFrame(tick); return; }',
    '    keys["w"] = false; atkHeld = false;',
    '    resolve(JSON.stringify({ peak: Math.round(peak * 100) / 100,',
    '      peakAtMs: Math.round(peakAt), endVis: Math.round(vis * 100) / 100,',
    '      movedDuringFlight: Math.round(movedDuring * 100) / 100,',
    '      atkTDuringFlight: atkSeen, flyT0After: _flyT0, samples: samples }));',
    '  }',
    '  requestAnimationFrame(tick);',
    '});',
  ].join(''), true);
  console.log('  挑飞自测: ' + res);

  // 落地后还能走（证明锁只在空中）
  await sleep(300);
  await ev([
    'P.x = 60; P.z = 60; P.y = terYAt(P.x, P.z); P.air = false; P.gy = P.y;',
    'window.__z0 = P.z; keys["w"] = true; return 1;',
  ].join(''));
  await sleep(700);
  const walk = await ev([
    'keys["w"] = false;',
    'return JSON.stringify({ dz: Math.round((P.z - window.__z0) * 100) / 100,',
    '  flyT0: _flyT0 });',
  ].join(''));
  console.log('  落地后走动: ' + walk);

  /* ★★ 别人被挑飞：造一个假"道友"（NET.others 里的一条）+ 真的模型对象，
     让【渲染循环】自己算他的 y ✗ 然后采样 —— 这一步验的是 game.js 里
     那段"渲染前统一纠正 y"加上 fly 项有没有生效 ✓（交接文档第五节第 5 条的坑）*/
  const him = await evRaw([
    'var g = hero(); scene.add(g.g);',
    'var o = { id: "TESTFLY1", hh: { g: g.g }, tgtJy: 0, x: P.x + 2, z: P.z,',
    '  flyH: 3.72, flyDur: 1500 };',
    'g.g.position.set(P.x + 2, terYAt(P.x + 2, P.z), P.z);',
    'NET.others["TESTFLY1"] = o;',
    'var t0 = performance.now();',
    'wsOnMessage(JSON.stringify({ t: "fx", d: { kind: "launch_him", who: "TESTFLY1",',
    '  h: 3.72, t: 1.5, by: 99999 } }));',
    'var peak = 0, atPeak = 0;',
    'return new Promise(function (resolve) {',
    '  function tick() {',
    '    var t = performance.now() - t0;',
    '    var base = terYAt(o.hh.g.position.x, o.hh.g.position.z);',
    '    var vis = o.hh.g.position.y - base;',
    '    if (vis > peak) { peak = vis; atPeak = t; }',
    '    if (t < 1650) { requestAnimationFrame(tick); return; }',
    '    var endVis = o.hh.g.position.y - base;',
    '    delete NET.others["TESTFLY1"];',
    '    scene.remove(g.g);',
    '    resolve(JSON.stringify({ peak: Math.round(peak * 100) / 100,',
    '      peakAtMs: Math.round(atPeak), endVis: Math.round(endVis * 100) / 100,',
    '      flyT0After: o.flyT0 }));',
    '  }',
    '  requestAnimationFrame(tick);',
    '});',
  ].join(''), true);
  console.log('  别人挑飞(渲染): ' + him);

  console.log('  页面错误: ' + (errs.length ? errs.slice(0, 4).join(' | ') : '(无)'));

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  await sleep(1500);
  await fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at.token },
    body: JSON.stringify({ act: 'delplayer', name: NM }),
  }).catch(() => null);
  console.log('  清理完成');
})();
