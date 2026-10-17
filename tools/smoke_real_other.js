// 用【真实的另一个玩家】验证：他有没有站在地形上、跳跃偏移有没有收到
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
  const NM = 'RV' + Math.random().toString(36).slice(2, 5);
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: 'abc123456' }),
  }).then(x => x.json());
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' }),
  }).then(x => x.json());

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx2d-rv-'));
  const port = 9760 + Math.floor(Math.random() * 60);
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
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const wait = {}; const errs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errs.push(String((d.exception && d.exception.description) || d.text || '?'));
    }
  };
  const send = (m, p) => new Promise(res => {
    const i = ++id; wait[i] = res;
    ws.send(JSON.stringify({ id: i, method: m, params: p || {} }));
    setTimeout(() => { if (wait[i]) { delete wait[i]; res(null); } }, 20000);
  });
  const ev = async x => {
    const r = await send('Runtime.evaluate', { expression: '(function(){' + x + '})()', returnByValue: true });
    if (r && r.result && r.result.exceptionDetails) {
      return '__THROW__ ' + (r.result.exceptionDetails.exception || {}).description;
    }
    return r && r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable', {});
  await sleep(1200);
  await ev('localStorage.setItem("token",' + JSON.stringify(reg.token) + '); location.reload(); return 1;');
  await sleep(9000);

  // ★ 让本机玩家跳一下 → 服务端应该收到 jy（日志里会打）
  for (let j = 0; j < 4; j++) {
    const jr = await ev('P.vy = 8.15; P.air = true; P.jumping = true; return ' +
      'JSON.stringify({y: +P.y.toFixed(2), gy: +P.gy.toFixed(2), ' +
      'd: +(P.y - P.gy).toFixed(2)});');
    console.log('  起跳' + (j + 1) + ': ' + jr);
    await sleep(450);
  }

  // ★ 单元验证：服务器发来的 jy 能不能穿过【字段映射】到 tgtJy
  const mapTest = await ev([
    'wsApplyWorld({ ts: 0, players: [{ id: 99999, n: "T", x: 3, z: 3, y: 0,',
    '  hp: 100, jy: 1.5, t: 1 }] });',
    'var o = NET.others[99999];',
    'return JSON.stringify({ tgtJy: o ? o.tgtJy : "无对象",',
    '  y: (o && o.hh && o.hh.g) ? +o.hh.g.position.y.toFixed(2) : "?" });',
  ].join(''));
  console.log('  字段映射测试(jy=1.5): ' + mapTest);
  await sleep(600);
  const mapTest2 = await ev([
    'var o = NET.others[99999];',
    'return JSON.stringify({ y: o && o.hh ? +o.hh.g.position.y.toFixed(2) : "?",',
    '  terrain: o && o.hh ? +terYAt(o.hh.g.position.x, o.hh.g.position.z).toFixed(2) : "?" });',
  ].join(''));
  console.log('  映射后位置: ' + mapTest2);
  // ★ 位置验完就把它清掉（免得后面的读数被这个假玩家干扰）
  await ev('removeOther(99999); return 1;');

  for (let round = 0; round < 3; round++) {
    const out = await ev([
      'var ks = Object.keys(NET.others || {});',
      'if (!ks.length) { return "没有其他玩家在线"; }',
      'var rows = [];',
      'for (var i = 0; i < ks.length; i++) {',
      '  var o = NET.others[ks[i]];',
      '  if (!o || !o.hh || !o.hh.g) { rows.push("no-hh"); continue; }',
      '  var g = o.hh.g;',
      '  rows.push({ name: o.name,',
      '    y: +g.position.y.toFixed(2),',
      '    terrain: +terYAt(g.position.x, g.position.z).toFixed(2),',
      '    diff: +(g.position.y - terYAt(g.position.x, g.position.z)).toFixed(2),',
      '    jy: +(o.tgtJy || 0).toFixed(2) });',
      '}',
      'return JSON.stringify(rows);',
    ].join('\n'));
    console.log('  第' + (round + 1) + '次读数: ' + out);
    await sleep(1500);
  }
  console.log('  页面错误: ' + (errs.length ? errs.slice(0, 2).join(' | ') : '(无)'));

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  await sleep(2000);
  await fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at.token },
    body: JSON.stringify({ act: 'delplayer', name: NM }),
  }).catch(() => null);
})();
