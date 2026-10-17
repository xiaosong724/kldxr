// P1 破坏冒烟：站到台地边 → 反复挥刀 → 那一格应该矮下去 → 服务端广播回来
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
  const SFX = Math.random().toString(36).slice(2, 5);
  const NM = 'P1' + SFX;
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: 'abc123456' }),
  }).then(x => x.json());
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' }),
  }).then(x => x.json());

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx2d-p1-'));
  const port = 9580 + Math.floor(Math.random() * 60);
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

  // 找一格 2 层高的、旁边有 1 层的（好站上去打）
  const setup = await ev([
    'var best = null;',
    'for (var gx = -80; gx <= 80; gx++) {',
    '  for (var gz = -80; gz <= 80; gz++) {',
    '    var h = terH(gx, gz);',
    '    if (h >= 2 && terH(gx - 1, gz) <= h - 1 && !best) { best = [gx, gz, h]; }',
    '  } }',
    'if (!best) { return "NONE"; }',
    'var gx = best[0], gz = best[1];',
    'P.x = (gx - 0.6) * TER.LEVEL_H; P.z = (gz + 0.5) * TER.LEVEL_H;',
    'P.yaw = Math.PI / 2;',                       // 朝 +X（就是那格）
    'P.y = terYAt(P.x, P.z); P.air = false; P.gy = P.y;',
    'terHClear(); refreshTerrain();',
    'return JSON.stringify({ gx: gx, gz: gz, h: best[2],',
    '  mat: terMat(gx, gz), py: Math.round(P.y * 100) / 100 });',
  ].join(''));
  console.log('  目标格: ' + setup);
  if (setup === 'NONE') { console.error('附近没有 2 层以上的台地'); process.exit(1); }
  const T = JSON.parse(setup);

  const before = await ev('return terH(' + T.gx + ',' + T.gz + ');');
  console.log('  破坏前高度: ' + before);

  // 模拟反复挥刀（直接走攻击那段逻辑：发 mine）
  const swings = 10;
  for (let i = 0; i < swings; i++) {
    await ev('atkT = -1; atkCd = 0; atkHeld = true; return 1;');
    await sleep(220);
    const now = await ev('return terH(' + T.gx + ',' + T.gz + ');');
    if (now !== before) {
      console.log('  第 ' + (i + 1) + ' 刀后高度变成: ' + now + '  ← 碎了 ✓');
      break;
    }
  }
  await ev('atkHeld = false;');
  await sleep(1500);
  const after = await ev('return terH(' + T.gx + ',' + T.gz + ');');
  const over = await ev('return (typeof terOver !== "undefined") ? Object.keys(terOver).length : -1;');
  console.log('  破坏后高度: ' + after + '  覆盖表条数: ' + over);
  console.log('  结论: ' + (after < before ? '✓ 破坏生效' : '✗ 没打碎'));
  // ★ 音效有没有真加载进来
  const sfxInfo = await ev([
    'var n = -1; try { n = (SFX_BANK["break"] || []).length; } catch (e) {}',
    'return JSON.stringify({ breakLoaded: n, total: (typeof SFX_LOADED !== "undefined") ? SFX_LOADED : -1,',
    '  want: (typeof SFX_TOTAL !== "undefined") ? SFX_TOTAL : -1 });',
  ].join(''));
  console.log('  破坏音效: ' + sfxInfo);
  console.log('  页面错误: ' + (errs.length ? errs.slice(0, 3).join(' | ') : '(无)'));

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot && shot.result && shot.result.data) {
    fs.writeFileSync(path.join(path.resolve(__dirname, '..'), 'docs', 'shots', 'p1-break.png'),
      Buffer.from(shot.result.data, 'base64'));
  }

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  await sleep(2000);
  await fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at.token },
    body: JSON.stringify({ act: 'delplayer', name: NM }),
  }).catch(() => null);
  console.log('  清理完成');
})();
