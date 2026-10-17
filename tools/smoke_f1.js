// F1 流水验证：岸边挖一格 → 水应该灌进去（服务端模拟 → 广播 → 客户端收到）
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'];
const B = process.env.CHROME || CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const h = await fetch(ORIGIN + '/api/health').then(x => x.json()).catch(() => null);
  if (!h || !h.ok) { console.error('服务没起'); process.exit(1); }
  const NM = 'F1' + Math.random().toString(36).slice(2, 5);
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: 'abc123456' }),
  }).then(x => x.json());
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' }),
  }).then(x => x.json());

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx2d-f1-'));
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
  };
  const send = (m, p) => new Promise(res => {
    const i = ++id; wait[i] = res;
    ws.send(JSON.stringify({ id: i, method: m, params: p || {} }));
    setTimeout(() => { if (wait[i]) { delete wait[i]; res(null); } }, 20000);
  });
  const ev = async x => {
    const r = await send('Runtime.evaluate', { expression: '(function(){' + x + '})()', returnByValue: true });
    if (r && r.result && r.result.exceptionDetails) { return '__THROW__ ' + r.result.exceptionDetails.text; }
    return r && r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable', {});
  await sleep(1200);
  await ev('localStorage.setItem("token",' + JSON.stringify(reg.token) + '); location.reload(); return 1;');
  await sleep(8000);

  // 找一格"水盆"，然后找它旁边一个【不是水盆】的格子当岸
  const setup = await ev([
    'var wet = null, bank = null;',
    'for (var gx = -120; gx <= 120 && !wet; gx++) {',
    '  for (var gz = -120; gz <= 120; gz++) {',
    '    if (terFluid(gx, gz) === 2 && terH(gx, gz) === -1) {',
    '      if (terFluid(gx + 1, gz) === 0 && terH(gx + 1, gz) === 0) { wet = [gx, gz]; bank = [gx + 1, gz]; break; }',
    '    }',
    '  } }',
    'if (!wet) { return "NO-SPOT"; }',
    'P.x = (bank[0] - 0.6) * TER.LEVEL_H; P.z = (bank[1] + 0.5) * TER.LEVEL_H;',
    'P.yaw = Math.PI / 2; P.y = terYAt(P.x, P.z); P.air = false; P.gy = P.y;',
    'terHClear(); refreshTerrain();',
    'return JSON.stringify({ water: wet, bank: bank,',
    '  waterH: terH(wet[0], wet[1]), bankH: terH(bank[0], bank[1]) });',
  ].join(''));
  console.log('  测试场景: ' + setup);
  if (setup === 'NO-SPOT') { console.error('找不到水盆+岸'); process.exit(1); }
  const S = JSON.parse(setup);
  const bankKey = S.bank[0] + ',' + S.bank[1];

  // ★ 关键：客户端【不移动就不发位置包】✗ 服务端不知道我在哪 → mine 被拒 ✓
  //   所以先原地蹭两步（很小 ✗ 不会离开攻击范围 ✓）把位置同步上去 ✓
  await ev('jx = 0; jy = -1; return 1;');
  await sleep(260);
  await ev('jx = 0; jy = 1; return 1;');
  await sleep(260);
  await ev('jx = 0; jy = 0; return 1;');
  await sleep(1500);
  console.log('  同步后位置: ' + await ev('return JSON.stringify({x:Math.round(P.x*100)/100,z:Math.round(P.z*100)/100});'));
  const before = await ev('return JSON.stringify({ fluid: terFluid(' + S.bank[0] + ',' + S.bank[1] + '),'
    + ' h: terH(' + S.bank[0] + ',' + S.bank[1] + ') });');
  console.log('  挖之前 岸: ' + before);

  // 只挖【岸边这一格】（不发攻击 ✗ 直接发 mine ✗ 保证只影响它）
  for (let i = 0; i < 3; i++) {
    await ev('wsSend("mine", { gx: ' + S.bank[0] + ', gz: ' + S.bank[1] + ' }); return 1;');
    await sleep(800);
  }
  await sleep(2500);

  const after = await ev('return JSON.stringify({ fluid: terFluid(' + S.bank[0] + ',' + S.bank[1] + '),'
    + ' h: terH(' + S.bank[0] + ',' + S.bank[1] + '),'
    + ' ovCount: Object.keys(fluidOv).length });');
  console.log('  挖之后 岸: ' + after);
  const A = JSON.parse(after);
  console.log('  结论: ' + (A.h < 0 && A.fluid === 2 ? '✓ 水灌进去了（流水生效）'
    : (A.h < 0 ? '△ 坑挖出来了，但水没流进去 ✗' : '✗ 连坑都没挖出来')));

  // 再等两秒，看会不会继续扩散
  await sleep(2500);
  const later = await ev('return JSON.stringify({ ovCount: Object.keys(fluidOv).length });');
  console.log('  两秒后流体覆盖数: ' + later);
  console.log('  页面错误: ' + (errs.length ? errs.slice(0, 3).join(' | ') : '(无)'));

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  await sleep(2000);
  await fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at.token },
    body: JSON.stringify({ act: 'delplayer', name: NM }),
  }).catch(() => null);
  console.log('  清理完成');
})();
