// round407 冒烟（双端）：别人被长枪挑飞时，【我】这边能不能看到他真的升空
//   为什么不用一个浏览器造假的 NET.others：
//     快照（30Hz）会把"服务器没报的人"从 NET.others 里删掉 ✗
//     假条目活不过一帧 → 测试要么随机红、要么只测到我自己的公式 ✗
//   → 开两个真客户端，用【真的 role_id】打一条 launch_him ✓
//     （服务端 _fx_broadcast 发的就是 role_id，和快照里的 id 同一个 ✓）
//   跑法：先起服务，再 node tools/smoke_fly2.js
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
const OUT = [];                     // 每条检查一句话（最后统一打 + 判红绿）

function ck(cond, msg, got) {
  OUT.push({ ok: !!cond, msg, got });
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg + (cond ? '' : '   got=' + JSON.stringify(got)));
}

async function openPage(port) {
  let target = null;
  for (let i = 0; i < 100 && !target; i++) {
    await sleep(250);
    try {
      const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      target = l.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) { }
  }
  if (!target) { throw new Error('连不上浏览器 ' + port); }
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
  await send('Runtime.enable', {});
  return { ev: x => evRaw(x, false), evRaw, errs, send };
}

(async () => {
  const hh = await fetch(ORIGIN + '/api/health').then(x => x.json()).catch(() => null);
  if (!hh || !hh.ok) { console.error('服务没起'); process.exit(1); }
  const SFX = Math.random().toString(36).slice(2, 5);
  const N1 = '测试FLA' + SFX, N2 = '测试FLB' + SFX;
  const r1 = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: N1, password: PW }),
  }).then(x => x.json());
  const r2 = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: N2, password: PW }),
  }).then(x => x.json());
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' }),
  }).then(x => x.json());

  const dirs = [], procs = [], pages = [];
  for (let i = 0; i < 2; i++) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx2d-2p-' + i + '-'));
    const port = 9700 + i * 40 + Math.floor(Math.random() * 30);
    dirs.push(dir);
    procs.push(spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
      '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
      '--window-size=520,900', ORIGIN + '/'], { stdio: 'ignore' }));
    pages.push(await openPage(port));
  }
  const [A, C] = pages;      // A = 看的人（第一人称）· C = 被看的人
  for (let i = 0; i < 2; i++) {
    const tok = i === 0 ? r1.token : r2.token;
    await pages[i].ev('localStorage.setItem("token",' + JSON.stringify(tok) + '); location.reload(); return 1;');
  }
  await sleep(9000);
  for (let i = 0; i < 2; i++) {
    const st = await pages[i].ev('return JSON.stringify({ ready: (typeof WSC !== "undefined") && WSC.ready });');
    console.log('  客户端' + i + ': ' + st);
  }

  // ★ 把两个人搬到同一块空地（100 米视野内 ✓ 但要离安全区远一点）
  await A.ev('P.x = 60; P.z = 60; P.y = terYAt(60, 60); P.air = false; P.gy = P.y; return 1;');
  await C.ev('P.x = 62; P.z = 60; P.y = terYAt(62, 60); P.air = false; P.gy = P.y; return 1;');
  await sleep(2500);

  const seen = await A.ev('return JSON.stringify({ others: Object.keys(NET.others),'
    + ' ready: WSC.ready });');
  console.log('  A 眼里的道友: ' + seen);
  const uid = (JSON.parse(seen).others || [])[0];
  ck(!!uid, 'A 看得到 C（NET.others 里有他 ✓ 这才是真实那条路）', seen);
  if (!uid) { process.exit(1); }

  // ★ 采样：C 的模型（在 A 的 NET.others 里）到底抬没抬
  const res = await A.evRaw([
    'var o = NET.others["' + uid + '"];',
    'if (!o) { return JSON.stringify({ err: "no such other" }); }',
    'var t0 = performance.now();',
    'wsOnMessage(JSON.stringify({ t: "fx", d: { kind: "launch_him", who: "' + uid + '",',
    '  h: 3.72, t: 1.5, by: 99999 } }));',
    'var peak = 0, peakAt = 0, samples = [];',
    'return new Promise(function (resolve) {',
    '  function tick() {',
    '    var t = performance.now() - t0;',
    '    var g = o.hh ? o.hh.g : o.g;',
    '    var base = terYAt(g.position.x, g.position.z);',
    '    var vis = g.position.y - base;',
    '    if (vis > peak) { peak = vis; peakAt = t; }',
    '    if (samples.length < 26 && t > samples.length * 65) {',
    '      samples.push([Math.round(t), Math.round(vis * 100) / 100]);',
    '    }',
    '    if (t < 1700) { requestAnimationFrame(tick); return; }',
    '    resolve(JSON.stringify({ peak: Math.round(peak * 100) / 100,',
    '      peakAtMs: Math.round(peakAt), endVis: Math.round(vis * 100) / 100,',
    '      flyT0After: o.flyT0, samples: samples }));',
    '  }',
    '  requestAnimationFrame(tick);',
    '});',
  ].join(''), true);
  console.log('  A 看到 C 的高度: ' + res);
  let rr = {};
  try { rr = JSON.parse(res); } catch (e) { rr = { err: res }; }

  ck(!rr.err, '采样没报错', rr);
  ck(rr.peak > 3.4 && rr.peak < 4.1,
     '★ C 在 A 的画面里真的升空了（峰值 ' + rr.peak + ' 米 ≈ 3.72 ✓）', rr.peak);
  ck(Math.abs(rr.endVis) < 0.25, '★ 1.7 秒后落回地面（' + rr.endVis + ' 米 ✓）', rr.endVis);
  ck(!rr.flyT0After, '★ 飞完状态自己清掉了（不会永久停在空中的 ✓）', rr.flyT0After);

  const errsA = A.errs.length ? A.errs.slice(0, 3).join(' | ') : '(无)';
  const errsC = C.errs.length ? C.errs.slice(0, 3).join(' | ') : '(无)';
  console.log('  A 页面错误: ' + errsA);
  console.log('  C 页面错误: ' + errsC);

  for (const p of procs) { try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { } }
  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { } }
  await sleep(1500);
  for (const nm of [N1, N2]) {
    await fetch(ORIGIN + '/api/admin/act', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at.token },
      body: JSON.stringify({ act: 'delplayer', name: nm }),
    }).catch(() => null);
  }
  const bad = OUT.filter(x => !x.ok).length;
  console.log(bad ? ('FAILED: ' + bad) : 'ALL PASS ✓');
  process.exit(bad ? 1 : 0);
})();
