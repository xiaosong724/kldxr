// 云端冒烟：能不能真进去玩（地形/画面/新 UI）+ 截一张图
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = process.env.CLOUD || 'http://43.138.171.250:8899';
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'];
const B = process.env.CHROME || CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const SFX = Math.random().toString(36).slice(2, 5), NM = '测试C' + SFX, PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: PW }),
  }).then(x => x.json());
  if (!reg.token) { console.log('  注册失败: ' + JSON.stringify(reg)); process.exit(1); }
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' }),
  }).then(x => x.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-'));
  const port = 9970;
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
  const errs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') {
      errs.push(((m.params.exceptionDetails || {}).exception || {}).description || 'err');
    }
    if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; }
  };
  const send = (m, p) => new Promise(res => { const i = ++id; wait[i] = res; ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  const ev = async x => {
    const r = await send('Runtime.evaluate', { expression: '(function(){' + x + '})()', returnByValue: true });
    if (r && r.result && r.result.exceptionDetails) {
      const ed = r.result.exceptionDetails;
      return '__THROW__ ' + String((ed.exception && ed.exception.description) || ed.text).split(String.fromCharCode(10))[0];
    }
    return r && r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable', {});
  await send('Log.enable', {});
  await sleep(1500);
  await ev('localStorage.setItem("token",' + JSON.stringify(reg.token) + '); location.reload(); return 1;');
  await sleep(11000);
  const st = await ev([
    'return JSON.stringify({',
    '  role: (typeof WSC !== "undefined" && WSC.role) ? WSC.role.name : null,',
    '  lv: (typeof WSC !== "undefined" && WSC.role) ? WSC.role.level : null,',
    '  x: Math.round(P.x), z: Math.round(P.z), y: Math.round((P.y || 0) * 100) / 100,',
    '  terrainY: Math.round(terYAt(P.x, P.z) * 100) / 100,',
    '  mobs: Object.keys(NET.rmobs || {}).length,',
    '  hasZoom: typeof setWorldZoom === "function" ? setWorldZoom() : null,',
    '  fov: cam ? Math.round(cam.fov * 10) / 10 : null,',
    '  online: (typeof NET !== "undefined" && NET.others) ? Object.keys(NET.others).length : -1 });',
  ].join(''));
  console.log('  云端游戏状态: ' + st);
  const shotDir = path.resolve(__dirname, '..', 'docs', 'shots');
  const s = await send('Page.captureScreenshot', { format: 'png' });
  if (s && s.result && s.result.data) {
    fs.writeFileSync(path.join(shotDir, 'r423-cloud.png'), Buffer.from(s.result.data, 'base64'));
    console.log('  截图: docs/shots/r423-cloud.png');
  }
  console.log('  页面异常: ' + (errs.length ? errs.slice(0, 3).join(' | ') : '（无 ✓）'));
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  await sleep(1200);
  await fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at.token },
    body: JSON.stringify({ act: 'delplayer', name: NM }),
  }).catch(() => null);
})();
