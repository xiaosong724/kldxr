// 把【客户端真代码】算出来的建筑碰撞盒导成 JSON —— 给 tools\test_worldgen.py 对比用
//
// 为什么要有这个：服务端也有一份世界生成（server/worldgen.py），
// 两份必须一模一样，差一点僵尸就会撞在"客户端看不见的墙"上 ✗
// 而"两边一致"是靠【同一套确定性哈希】保证的 → 那就必须有一条测试盯着它 ✓
//
// 跑法：node tools\dump_props.js   （默认写到 %TEMP%\xx2d_props_client.json）
//      CHUNKS=0,0;1,0;3,-2  可以指定块；OUT=路径 可以指定输出

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = process.env.OUT || path.join(os.tmpdir(), 'xx2d_props_client.json');
const CHUNKS = (process.env.CHUNKS || '0,0;1,0;0,1;-1,-1;3,-2').split(';')
  .map(s => s.split(',').map(Number));
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx2d-dump-'));
  const port = 9390 + Math.floor(Math.random() * 60);
  const proc = spawn(CHROME, ['--headless', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port, 'http://127.0.0.1:8899/'],
    { stdio: 'ignore' });

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
      params: { expression: '(async()=>{' + expr + '})()', awaitPromise: true, returnByValue: true }
    }));
  });

  await sleep(3000);
  const okInit = await ev('return (typeof buildChunk === "function" && typeof G !== "undefined") ? "ok" : "no";');
  if (okInit.result.result.value !== 'ok') {
    console.error('游戏没初始化好，拿不到 buildChunk');
    try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
    process.exit(1);
  }

  const expr =
    'var out = {};' +
    'var list = ' + JSON.stringify(CHUNKS) + ';' +
    'for (var i = 0; i < list.length; i++) {' +
    '  var ci = list[i][0], cj = list[i][1];' +
    '  buildChunk(ci, cj);' +
    '  var sol = _chunkSolid[ci + "," + cj] || [];' +
    '  var rows = [];' +
    '  for (var k = 0; k < sol.length; k++) {' +
    '    rows.push([Math.round(sol[k].x * 1000) / 1000, Math.round(sol[k].z * 1000) / 1000,' +
    '               Math.round(sol[k].hw * 1000) / 1000, Math.round(sol[k].hd * 1000) / 1000]); }' +
    '  out[ci + "," + cj] = rows; }' +
    'return JSON.stringify(out);';
  const r = await ev(expr);
  const data = r.result.result.value;
  if (!data) {
    console.error('导出失败：', JSON.stringify(r.result).slice(0, 300));
    try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
    process.exit(1);
  }
  fs.writeFileSync(OUT, data, 'utf8');
  const obj = JSON.parse(data);
  const total = Object.keys(obj).reduce((n, k) => n + obj[k].length, 0);
  console.log('OK  客户端 ' + Object.keys(obj).length + ' 块 / ' + total + ' 个碰撞盒 → ' + OUT);
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
})();
