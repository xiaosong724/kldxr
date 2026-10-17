// 把【客户端真代码】算出来的地形导成 JSON —— 给 tools/check_terrain_sync.py 对比用
//
// 为什么必须有这条：
//   地形是两边各算一遍的（客户端渲染 / 服务端碰撞）✗ 差一点就全世界错位 ✓
//   "两边一致"靠的是同一套确定性哈希 → 必须有测试盯着它 ✓
//   （和第 41 轮 worldgen.py 那条是同一个道理 ✓ 那次踩过僵尸穿墙 ✓）
//
// 跑法：node tools/dump_terrain.js
//      OUT=路径 可以指定输出；CELLS=n 可以改采样密度

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = process.env.OUT || path.join(os.tmpdir(), 'xx2d_terrain_client.json');
const STEP = parseInt(process.env.CELLS || '7', 10);
const RANGE = parseInt(process.env.RANGE || '120', 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx2d-ter-'));
  const port = 9460 + Math.floor(Math.random() * 60);
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--no-first-run', '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    'http://127.0.0.1:8899/'], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 100 && !target; i++) {
    await sleep(250);
    try {
      const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      target = l.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) { }
  }
  if (!target) { console.error('连不上无头 Chrome'); process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const wait = {};
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; }
  };
  const ev = expr => new Promise(res => {
    const i = ++id; wait[i] = res;
    ws.send(JSON.stringify({
      id: i, method: 'Runtime.evaluate',
      params: { expression: '(function(){' + expr + '})()', returnByValue: true }
    }));
  });

  // 等游戏脚本加载好（不需要登录 ✗ 只要 TER_* 那几个函数在 ✓）
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    await sleep(400);
    const r = await ev('return (typeof terH === "function" && typeof terSlope === "function")'
                       + ' ? "ok" : "no";');
    ready = r && r.result && r.result.result && r.result.result.value === 'ok';
  }
  if (!ready) {
    console.error('客户端地形函数没加载（terH / terSlope 不存在）');
    try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
    process.exit(1);
  }

  const expr =
    'var out = {}; var s = ' + STEP + ', R = ' + RANGE + ';' +
    'for (var gx = -R; gx <= R; gx += s) {' +
    '  for (var gz = -R; gz <= R; gz += s) {' +
    '    out[gx + "," + gz] = [Math.round(terH(gx, gz) * 1e6) / 1e6,' +
    '      terMat(gx, gz), terSlope(gx, gz),' +
    '      Math.round(terGroundY(gx, gz, 0.5, 0.5) * 1e6) / 1e6, terBiome(gx, gz)];' +
    '  } }' +
    'return JSON.stringify(out);';
  const r = await ev(expr);
  const data = r && r.result && r.result.result && r.result.result.value;
  if (!data) {
    console.error('导出失败：', JSON.stringify(r).slice(0, 400));
    try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
    process.exit(1);
  }
  fs.writeFileSync(OUT, data, 'utf8');
  console.log('OK  客户端地形 ' + Object.keys(JSON.parse(data)).length + ' 格 → ' + OUT);
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
})();
