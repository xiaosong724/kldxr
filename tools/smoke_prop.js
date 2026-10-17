// 查"树砍不动"：客户端有没有记下树的位置、服务端认不认这些格子
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
  const NM = 'TP' + Math.random().toString(36).slice(2, 5);
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: 'abc123456' }),
  }).then(x => x.json());
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' }),
  }).then(x => x.json());

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx2d-tp-'));
  const port = 9820 + Math.floor(Math.random() * 60);
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

  console.log('  propAt 条数: ' + await ev('return Object.keys(propAt).length;'));
  const sample = await ev([
    'var ks = Object.keys(propAt).slice(0, 6);',
    'var rows = [];',
    'for (var i = 0; i < ks.length; i++) { rows.push([ks[i], propAt[ks[i]]]); }',
    'return JSON.stringify(rows);',
  ].join(''));
  console.log('  前几个: ' + sample);

  // 把玩家挪到第一棵树旁边，朝它，然后砍两刀
  const fight = await ev([
    'var ks = Object.keys(propAt);',
    'if (!ks.length) { return "propAt 是空的"; }',
    'var parts = ks[0].split(",");',
    'var gx = parseInt(parts[0], 10), gz = parseInt(parts[1], 10);',
    'P.x = (gx - 1.3) * TER.LEVEL_H; P.z = (gz + 0.5) * TER.LEVEL_H;',
    'P.yaw = Math.PI / 2;',                       // 朝 +x
    'P.y = terYAt(P.x, P.z); P.air = false; P.gy = P.y;',
    'terHClear(); refreshTerrain();',
    'return JSON.stringify({ tree: [gx, gz], kind: propAt[ks[0]],',
    '  p: [+P.x.toFixed(2), +P.z.toFixed(2)], yaw: +P.yaw.toFixed(2),',
    '  fx: Math.floor((P.x + Math.sin(P.yaw) * TER.LEVEL_H * 1.2) / TER.LEVEL_H),',
    '  fz: Math.floor((P.z + Math.cos(P.yaw) * TER.LEVEL_H * 1.2) / TER.LEVEL_H),',
    '  propAtFront: !!propAt[(Math.floor((P.x + Math.sin(P.yaw) * TER.LEVEL_H * 1.2) / TER.LEVEL_H)) + "," + (Math.floor((P.z + Math.cos(P.yaw) * TER.LEVEL_H * 1.2) / TER.LEVEL_H))] });',
  ].join('\n'));
  console.log('  站位: ' + fight);

  // ★ 直接调 netSync() 把位置发给服务端 ✗ 不走动（走动会把站位带偏 ✓）
  await ev('netSync(); return 1;');
  await sleep(900);
  await ev('netSync(); return 1;');
  await sleep(900);

  for (let k = 0; k < 3; k++) {
    // ★ 走【真实攻击】路径 ✗ 不是直接发 mineprop ✓ 这样才测到客户端的选格子 ✓
    const r = await ev('atkHeld = true; return "atk";');
    await sleep(700);
  }
  // ★ 砍倒的瞬间应该有一个独立模型在倒 ✓
  const fall = await ev([
    'var ln = (typeof NET.loot === "object" && NET.loot) ? Object.keys(NET.loot).length : -1;',
    'return JSON.stringify({ played: (window._fallN||0), loot: ln });',
  ].join(''));
  console.log('  倒地动画: ' + fall);
  await sleep(1200);
  const after = await ev([
    'var gx = ' + JSON.parse(fight).tree[0] + ', gz = ' + JSON.parse(fight).tree[1] + ';',
    'var k = gx + "," + gz;',
    'return JSON.stringify({ propDead: !!propDead[k], propDmg: propDmg[k] || 0 });',
  ].join(''));
  await ev('atkHeld = 0; return 1;');
  console.log('  走真实攻击 3 次后: ' + after);
  console.log('  页面错误: ' + (errs.length ? errs.slice(0, 2).join(' | ') : '(无)'));

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  await sleep(2000);
  await fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at.token },
    body: JSON.stringify({ act: 'delplayer', name: NM }),
  }).catch(() => null);
})();
