// 云端正观 60 秒：会不会自己刷新 / 断线重连（用户报"一直掉线刷新"）
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://43.138.171.250:8899';
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'];
const B = process.env.CHROME || CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const SFX = Math.random().toString(36).slice(2, 5), NM = '测试T' + SFX, PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: PW }),
  }).then(x => x.json());
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' }),
  }).then(x => x.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-'));
  const port = 9971;
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=520,900', ORIGIN + '/'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 120 && !target; i++) {
    await sleep(250);
    try {
      const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      target = l.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) { }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const wait = {};
  let navs = 0, wsClose = 0, errs = 0, logs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Page.frameNavigated') { navs += 1; }
    if (m.method === 'Runtime.exceptionThrown') { errs += 1; }
    if (m.method === 'Runtime.consoleAPICalled') {
      const t = (m.params.args || []).map(a => a.value).join(' ');
      if (/ws|websocket|重连|断线|reconnect|卡死|刷新/i.test(t)) { logs.push(t.slice(0, 120)); }
    }
    if (m.method === 'Network.webSocketFrameError' || m.method === 'Network.webSocketClosed') { wsClose += 1; }
    if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; }
  };
  const send = (m, p) => new Promise(res => { const i = ++id; wait[i] = res; ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  const ev = async x => {
    const r = await send('Runtime.evaluate', { expression: '(function(){' + x + '})()', returnByValue: true });
    if (r && r.result && r.result.exceptionDetails) { return '__THROW__ ' + ((r.result.exceptionDetails.exception || {}).description || ''); }
    return r && r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Page.enable', {});
  await send('Runtime.enable', {});
  await send('Network.enable', {});
  await sleep(1200);
  await ev('localStorage.setItem("token",' + JSON.stringify(reg.token) + '); location.reload(); return 1;');
  await sleep(10000);
  navs = 0; wsClose = 0; errs = 0;
  const p0 = await ev('return JSON.stringify({x: Math.round(P.x*10)/10, z: Math.round(P.z*10)/10, t: Math.round(performance.now()/1000)})');
  console.log('  开始观察 60 秒… 起点 ' + p0);
  for (let i = 0; i < 5; i++) {
    await sleep(6000);
    const s = await ev('return JSON.stringify({t: Math.round(performance.now()/1000), mobs: Object.keys(NET.rmobs||{}).length, online: (NET.others?Object.keys(NET.others).length:-1), ws: (typeof WSC!=="undefined" ? !!WSC.ready : null), tick: (typeof NET!=="undefined" && NET.lastSnapAt ? Math.round((Date.now()-NET.lastSnapAt)/1000) : null)})');
    console.log('  +' + ((i + 1) * 6) + 's ' + s);
  }
  console.log('  页面重新加载次数: ' + navs + '（应该 0）');
  console.log('  WS 关闭/错误: ' + wsClose);
  console.log('  JS 异常: ' + errs);
  if (logs.length) { console.log('  相关日志: ' + logs.slice(0, 5).join(' | ')); }
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  await sleep(1200);
  await fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at.token },
    body: JSON.stringify({ act: 'delplayer', name: NM }),
  }).catch(() => null);
})();
