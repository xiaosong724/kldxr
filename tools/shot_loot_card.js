// shot_loot_card.js -- 在玩家脚边放一张"皮肤卡"掉落物 → 截图
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ORIGIN = process.env.PAGE || 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'shots', 'loot-card.png');
const PW = 'abc123456';
const CAND = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
const B = CAND.find(function (p) { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

(async function () {
  if (!B) { console.error('no chrome'); process.exit(1); }
  const nm = '卡' + Math.random().toString(36).slice(2, 6);
  let r = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nm, password: PW })
  }).then(function (x) { return x.json(); });
  if (!r || !r.token) { console.error('register failed', r); process.exit(1); }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-'));
  const port = 4600 + Math.floor(Math.random() * 60);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1280,860', 'about:blank'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 120 && !t; i++) {
    await sleep(250);
    try {
      const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      t = l.find(function (x) { return x.type === 'page' && x.webSocketDebuggerUrl; });
    } catch (e) { }
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(function (r2) { ws.onopen = r2; });
  let id = 0; const wait = {};
  ws.onmessage = function (e) {
    const m = JSON.parse(e.data);
    if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; }
  };
  const send = function (mm, pp) {
    return new Promise(function (res) {
      const i = ++id; wait[i] = res;
      ws.send(JSON.stringify({ id: i, method: mm, params: pp || {} }));
    });
  };
  await send('Page.enable', {});
  await send('Runtime.enable', {});
  await send('Page.navigate', { url: ORIGIN + '/?t=' + Date.now() });
  await sleep(1500);
  await send('Runtime.evaluate', {
    expression: 'localStorage.setItem("token",' + JSON.stringify(r.token) + ')'
  });
  await send('Page.reload', {});
  await sleep(9000);
  /* 在玩家脚边放三件掉落：皮肤卡 / 普通材料 / 武器（对比着看 ✓）*/
  const ev = await send('Runtime.evaluate', {
    expression: '(' + function () {
      try {
        /* ★ 服务器每帧都会把"不在快照里"的掉落移除 ✗
           这里临时把移除函数换成空函数 → 注入的掉落留得住 ✓（只截图用 ✓）*/
        window.removeWorldLoot = function () { };
        var px = P.x + 1.6, pz = P.z + 1.6;
        addWorldLoot(['t1', px, pz, '皮肤·狐仙', 0, '', 'mat', 'skin']);
        addWorldLoot(['t2', px + 1.2, pz, '破布', 0, '', 'mat', 'material']);
        addWorldLoot(['t3', px + 2.2, pz, '铁剑', 3, 'sword', 'weapon', 'weapon']);
        return 'ok';
      } catch (e) { return String(e); }
    }.toString() + ')()',
    returnByValue: true
  });
  console.log('注入:', ev.result && ev.result.result && ev.result.result.value);
  await sleep(2500);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
  console.log('存:', OUT);
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
})();
