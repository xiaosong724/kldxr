// 近距离看：把相机摆到玩家身后 3.2 米，拍挥砍三帧，确认拖影贴着【刀尖】
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'];
const B = process.env.CHROME || CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ROOT = path.resolve(__dirname, '..');
(async () => {
  const NM = '测试Y' + Math.random().toString(36).slice(2, 5), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: PW }),
  }).then(x => x.json());
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' }),
  }).then(x => x.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trail3-'));
  const port = 9990 + Math.floor(Math.random() * 9);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=520,900', ORIGIN + '/'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 160 && !target; i++) {
    await sleep(250);
    try {
      const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      target = l.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) { }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const wait = {};
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; } };
  const send = (m, p) => new Promise(res => { const i = ++id; wait[i] = res; ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  const ev = async (x) => {
    const r = await send('Runtime.evaluate', { expression: '(function(){' + x + '})()', returnByValue: true, awaitPromise: true });
    if (r && r.result && r.result.exceptionDetails) {
      const ed = r.result.exceptionDetails;
      return '__THROW__ ' + String((ed.exception && ed.exception.description) || ed.text).split(String.fromCharCode(10))[0];
    }
    return r && r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable', {});
  await sleep(1500);
  await ev('localStorage.setItem("token",' + JSON.stringify(reg.token) + '); location.reload(); return 1;');
  await sleep(10000);
  await ev('P.x = 200; P.z = 200; return 1;');
  await sleep(500);
  // 近距相机：玩家正前偏右 3.2 米，高 2.0 米，看向玩家胸口
  await ev([
    'window.__nearCam = function () {',
    '  var y = P.yaw;',
    '  cam.position.set(P.x + Math.sin(y + 1.9) * 3.0, 1.7, P.z + Math.cos(y + 1.9) * 3.0);',
    '  cam.lookAt(P.x, 1.05, P.z);',
    '  cam.updateMatrixWorld(true); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();',
    '  return 1;',
    '};',
    'return 1;',
  ].join(''));
  await ev('atkCd = 0; atkT = -1; atkHeld = true; return 1;');
  const waits = [['a', 300], ['b', 110], ['c', 110], ['d', 110]];
  for (const [tag, w] of waits) {
    await sleep(w);
    const info = await ev([
      'window.__nearCam();',
      'rd.render(scene, cam);',
      'var tip = weaponTipWorld(new THREE.Vector3());',
      'var tv = tip.clone().project(cam);',
      'var hv = new THREE.Vector3(0,0,0).applyMatrix4(H.sw.matrixWorld).project(cam);',
      'return JSON.stringify({atk:+atkT.toFixed(2), pts:TRAIL.pts.length, on:TRAIL.on,',
      '  tipPx:[Math.round((tv.x*0.5+0.5)*innerWidth), Math.round((-tv.y*0.5+0.5)*innerHeight)],',
      '  handPx:[Math.round((hv.x*0.5+0.5)*innerWidth), Math.round((-hv.y*0.5+0.5)*innerHeight)]});',
    ].join(''));
    console.log('  ' + tag + ': ' + info);
    const shot = await ev('window.__nearCam(); rd.render(scene, cam); return document.getElementById("cv").toDataURL("image/png");');
    if (typeof shot === 'string' && shot.indexOf('data:image/png') === 0) {
      fs.writeFileSync(path.join(ROOT, 'docs', 'shots', 'trail3_' + tag + '.png'),
        Buffer.from(shot.split(',')[1], 'base64'));
    }
  }
  await ev('atkHeld = false; return 1;');
  console.log('  存: docs/shots/trail3_a..d.png');
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  await sleep(600);
  await fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at.token },
    body: JSON.stringify({ act: 'delplayer', name: NM }),
  }).catch(() => null);
})();
