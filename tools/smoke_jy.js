// 验证"其他玩家站在地形上 + 跳跃偏移"这条链路到底通不通
// 做法：在页面里手工造一个 NET.others 条目（带真的模型），看循环有没有把它摆对
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
  const NM = 'JY' + Math.random().toString(36).slice(2, 5);
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: 'abc123456' }),
  }).then(x => x.json());
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' }),
  }).then(x => x.json());

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx2d-jy-'));
  const port = 9700 + Math.floor(Math.random() * 60);
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
    if (r && r.result && r.result.exceptionDetails) { return '__THROW__ ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300); }
    return r && r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable', {});
  await sleep(1200);
  await ev('localStorage.setItem("token",' + JSON.stringify(reg.token) + '); location.reload(); return 1;');
  await sleep(8000);

  const ready = await ev('return JSON.stringify({ready: !!(NET&&NET.on), n: Object.keys((NET&&NET.others)||{}).length});');
  console.log('  进世界: ' + ready);

  // 造一个假的"其他玩家"，放在一个山脚下（用真的地形高度做对比）
  const setup = await ev([
    'var gx = 0, gz = 0, best = -1;',
    'for (var q = -80; q <= 80; q += 2) {',
    '  for (var w = -80; w <= 80; w += 2) {',
    '    var h = terH(q, w);',
    '    if (h > best) { best = h; gx = q; gz = w; }',
    '  } }',
    'var hh = hero();',
    'hh.g.scale.set(G.HERO_SCALE, G.HERO_SCALE, G.HERO_SCALE);',
    'hh.g.position.set(gx * TER.LEVEL_H, 0, gz * TER.LEVEL_H);',
    'scene.add(hh.g);',
    'NET.others["FAKE1"] = { hh: hh, buf: [], tgtJy: 0,',
    '  cur: {x: gx*TER.LEVEL_H, z: gz*TER.LEVEL_H, yaw: 0},',
    '  last: {x: gx*TER.LEVEL_H, z: gz*TER.LEVEL_H}, atkT: -1, atkSeq: -1,',
    '  hp: 100, hpMax: 100, dead: false, walkT: 0 };',
    'return JSON.stringify({ cell: [gx, gz], h: best });',
  ].join(''));
  console.log('  造了一个假玩家: ' + setup);
  await sleep(1200);

  const r1 = await ev([
    'var o = NET.others["FAKE1"];',
    'return JSON.stringify({',
    '  y: +o.hh.g.position.y.toFixed(3),',
    '  terrain: +terYAt(o.hh.g.position.x, o.hh.g.position.z).toFixed(3),',
    '  jy: o.tgtJy, jyS: o.jyS });',
  ].join(''));
  console.log('  静止时: ' + r1);

  // 假装他跳了（tgtJy = 1.9 格）
  await ev('NET.others["FAKE1"].tgtJy = 1.9; return 1;');
  await sleep(700);
  const r2 = await ev([
    'var o = NET.others["FAKE1"];',
    'return JSON.stringify({',
    '  y: +o.hh.g.position.y.toFixed(3),',
    '  terrain: +terYAt(o.hh.g.position.x, o.hh.g.position.z).toFixed(3),',
    '  jy: o.tgtJy, jyS: o.jyS === undefined ? "undef" : +o.jyS.toFixed(3) });',
  ].join(''));
  console.log('  跳起时: ' + r2);

  const A = JSON.parse(r1), Bb = JSON.parse(r2);
  const okStand = Math.abs(A.y - A.terrain) < 0.05;
  const okJump = (Bb.y - Bb.terrain) > 0.5;
  console.log('  结论: 站着' + (okStand ? '✓ 站在地形上' : '✗ 没站对（差 ' + (A.y - A.terrain).toFixed(2) + '）') +
    ' · 跳起' + (okJump ? '✓ 抬高 ' + (Bb.y - Bb.terrain).toFixed(2) : '✗ 没抬高'));
  console.log('  页面错误: ' + (errs.length ? errs.slice(0, 2).join(' | ') : '(无)'));

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  await sleep(2000);
  await fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at.token },
    body: JSON.stringify({ act: 'delplayer', name: NM }),
  }).catch(() => null);
})();
