// P0 冒烟测试：进游戏 → 看地形有没有画出来 / 人有没有站在地上 / 跳得起来吗
//   ★ 只看"有没有崩"和三个数值 ✗ 不收一堆断言 ✓ 先确认地基没塌 ✓
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
  const NM = 'P0' + SFX;
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: PW }),
  }).then(x => x.json());
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' }),
  }).then(x => x.json());
  // 传送到山边（出生点附近是平地 ✗ 要看地形得走远一点 ✓）
  await fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at.token },
    body: JSON.stringify({ act: 'tp', name: NM, x: 45, z: 30 }),
  }).catch(() => null);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx2d-p0-'));
  const port = 9520 + Math.floor(Math.random() * 60);
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
    setTimeout(() => { if (wait[i]) { delete wait[i]; res(null); } }, 20000);
  });
  const ev = async x => {
    const r = await send('Runtime.evaluate', { expression: '(function(){' + x + '})()', returnByValue: true });
    if (r && r.result && r.result.exceptionDetails) { return '__THROW__ ' + r.result.exceptionDetails.text; }
    return r && r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable', {});
  await send('Log.enable', {});
  await sleep(1500);
  await ev('localStorage.setItem("token",' + JSON.stringify(reg.token) + '); location.reload(); return 1;');
  await sleep(8000);

  // ★ 挪到山边看效果（管理端没有 tp ✗ 测试里直接改坐标 ✓ 只影响这一个测试号）
  const hill = await ev([
    'var best = null;',
    'for (var gx = -140; gx <= 140; gx += 3) {',
    '  for (var gz = -140; gz <= 140; gz += 3) {',
    '    var h = terH(gx, gz);',
    '    if (!best || h > best[2]) { best = [gx, gz, h]; }',
    '  } }',
    'P.x = best[0] * TER.LEVEL_H - 3.2; P.z = best[1] * TER.LEVEL_H - 3.2;',
    'terHClear(); refreshTerrain();',
    'return JSON.stringify(best);',
  ].join(''));
  console.log('  最高的一座山: ' + hill);
  await sleep(2500);

  const info = await ev([
    'return JSON.stringify({',
    '  ready: (typeof WSC !== "undefined") && WSC.ready,',
    '  px: Math.round(P.x * 100) / 100, pz: Math.round(P.z * 100) / 100,',
    '  py: Math.round(P.y * 100) / 100,',
    '  gy: Math.round(terYAt(P.x, P.z) * 100) / 100,',
    '  tiles: (typeof _terTileN !== "undefined") ? _terTileN : -1,',
    '  hAt0: Math.round(terH(0, 0) * 100) / 100,',
    '  hAt45: Math.round(terH(45, 30) * 100) / 100,',
    '  fps: (document.getElementById("fps") || {}).textContent,',
    '  tri: (typeof rd !== "undefined" && rd.info) ? rd.info.render.triangles : -1,',
    '  calls: (typeof rd !== "undefined" && rd.info) ? rd.info.render.calls : -1',
    '});',
  ].join(''));
  console.log('  状态: ' + info);

  // 往前走走，看 Y 有没有跟着地形变
  const y0 = await ev('return Math.round(P.y*1000)/1000;');
  await ev('jx = 0; jy = -1; return 1;');
  await sleep(1600);
  await ev('jx = 0; jy = 0; return 1;');
  await sleep(300);
  const walked = await ev([
    'return JSON.stringify({',
    '  y: Math.round(P.y*1000)/1000,',
    '  gy: Math.round(terYAt(P.x,P.z)*1000)/1000,',
    '  air: P.air,',
    '  px: Math.round(P.x*100)/100, pz: Math.round(P.z*100)/100 });',
  ].join(''));
  console.log('  走了一段: ' + walked);

  // 跳一下：量【视觉位置】比地面高多少（用户要的是"看起来跳得更高"）
  const jr = await ev([
    'P.air = false; P.vy = 0; P.jumping = false; P.y = terYAt(P.x, P.z); P.gy = P.y;',
    'var base = P.y, peakVis = 0, peakReal = 0;',
    'jumpHeld = 1; jumpCD = 0;',
    'for (var i = 0; i < 40; i++) {',
    '  terrainV(1 / 60);',
    '  var vb = (P.jumping && P.air) ? Math.max(0, P.y - (P.gy || 0)) * 0.9 : 0;',
    '  var vis = P.y + vb - base;',
    '  if (vis > peakVis) { peakVis = vis; }',
    '  if (P.y - base > peakReal) { peakReal = P.y - base; }',
    '}',
    'return JSON.stringify({',
    '  realApexCells: Math.round(peakReal / TER.LEVEL_H * 100) / 100,',
    '  visualApexCells: Math.round(peakVis / TER.LEVEL_H * 100) / 100,',
    '  scaleY: Math.round(H.g.scale.y * 100) / 100,',
    '  backOnGround: !P.air });',
  ].join(''));
  console.log('  跳跃: ' + jr);

  // ★ 站到山上，攻击一次，看人物会不会掉到方块下面（用户报的 bug）
  const atk = await ev([
    'var best = null;',
    'for (var gx = -60; gx <= 60; gx += 2) {',
    '  for (var gz = -60; gz <= 60; gz += 2) {',
    '    var h = terH(gx, gz);',
    '    if (h >= 2 && (!best || h > best[2])) { best = [gx, gz, h]; }',
    '  } }',
    'P.x = (best[0] + 0.5) * TER.LEVEL_H; P.z = (best[1] + 0.5) * TER.LEVEL_H;',
    'P.y = terYAt(P.x, P.z); P.air = false;',
    'var before = P.y;',
    'atkT = 0; atkCd = 0.1;',
    'var lowest = 99;',
    'for (var i = 0; i < 40; i++) {',
    '  terrainV(1 / 30);',
    '  if (typeof heroAtkPose === "function") {',
    '    heroAtkPose(H, atkT, P.x, P.z, P.yaw, "sword", P.y);',
    '  }',
    '  if (H.g.position.y < lowest) { lowest = H.g.position.y; }',
    '  atkT += 1 / 30;',
    '}',
    'return JSON.stringify({ groundY: Math.round(before * 1000) / 1000,',
    '  lowestModelY: Math.round(lowest * 1000) / 1000,',
    '  sank: lowest < before - 0.12 });',
  ].join(''));
  console.log('  山上攻击: ' + atk);

  // 截图
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot && shot.result && shot.result.data) {
    const p = path.join(path.resolve(__dirname, '..'), 'docs', 'shots', 'p0-terrain.png');
    fs.writeFileSync(p, Buffer.from(shot.result.data, 'base64'));
    console.log('  截图: ' + p);
  }
  console.log('  页面错误: ' + (errs.length ? errs.slice(0, 4).join(' | ') : '(无)'));

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  await sleep(2000);
  await fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at.token },
    body: JSON.stringify({ act: 'delplayer', name: NM }),
  }).catch(() => null);
  console.log('  清理完成');
})();
