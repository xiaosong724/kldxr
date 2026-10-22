// 用"我自己摆的相机"直接渲到画布再抓图（不依赖游戏主循环的相机）→ LOD 开/关对比
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
  const NM = '测试H' + Math.random().toString(36).slice(2, 5), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: PW }),
  }).then(x => x.json());
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' }),
  }).then(x => x.json());
  const act = (b) => fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at.token },
    body: JSON.stringify(b),
  }).then(x => x.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lodshot-'));
  const port = 9950 + Math.floor(Math.random() * 15);
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
  await sleep(800);
  await act({ act: 'spawn', name: NM, n: 40 });
  await sleep(2600);
  // ★ 往后传 25 米就拍（怪会追上来 ✗ 晚了就都进 18 米了 ✓）
  await ev('P.x = 175; P.z = 200; return 1;');
  await sleep(350);

  // 自己摆相机：站在怪群前 9 米、高 6 米、看怪群中心
  const setup = await ev([
    'window.__shotCam = function () {',
    '  var cx = 0, cz = 0, n = 0;',
    '  for (var k in NET.rmobs) { var m = NET.rmobs[k]; if (!m || !m.hh) { continue; }',
    '    cx += m.hh.g.position.x; cz += m.hh.g.position.z; n++; }',
    '  cx /= (n || 1); cz /= (n || 1);',
    '  var dx = cx - P.x, dz = cz - P.z, len = Math.hypot(dx, dz) || 1;',
    '  cam.position.set(P.x - dx / len * 9, 6.0, P.z - dz / len * 9);',
    '  cam.lookAt(cx, 1.2, cz);',
    '  cam.updateMatrixWorld(true);',
    '  cam.matrixWorldInverse.copy(cam.matrixWorld).invert();',
    '  cam.updateProjectionMatrix();',
    '  rd.render(scene, cam);',
    '  var out = [], box = new THREE.Box3();',
    '  for (var k2 in NET.rmobs) {',
    '    var m2 = NET.rmobs[k2];',
    '    if (!m2 || !m2.hh || !m2.lodOn) { continue; }',
    '    var g = m2.hh.g;',
    '    box.setFromObject(g);',
    '    var lo = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2).project(cam);',
    '    var hi = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2).project(cam);',
    '    var d = Math.hypot(g.position.x - P.x, g.position.z - P.z);',
    '    out.push({ d: +d.toFixed(1), h: +(Math.abs(hi.y - lo.y) * 0.5 * innerHeight).toFixed(1),',
    '      sx: Math.round((lo.x * 0.5 + 0.5) * innerWidth),',
    '      sy: Math.round((-lo.y * 0.5 + 0.5) * innerHeight) });',
    '  }',
    '  out.sort(function (a, b) { return a.d - b.d; });',
    '  window.__camMeta = JSON.stringify(out.slice(0, 6));',
    '  return window.__camMeta;',
    '};',
    /* ★ 同一次 evaluate 里「渲染 + toDataURL」✗ 分两步拿到的是全黑的画布 ✓ */
    'window.__shotData = function () {',
    '  window.__shotCam();',
    '  return document.getElementById("cv").toDataURL("image/png");',
    '};',
    'return window.__shotCam();',
  ].join(''));
  console.log('  相机摆好后（最近的 LOD 怪）: ' + setup);
  const arr = JSON.parse(setup);
  const tgt = arr[0];
  if (!tgt) { console.log('  没有 LOD 怪，退出'); }
  else {
    // 抓画布（我自己刚渲染的那一帧）
    const snap = async (tag) => {
      const data = await ev('return window.__shotData();');
      if (typeof data === 'string' && data.indexOf('data:image/png') === 0) {
        fs.writeFileSync(path.join(ROOT, 'docs', 'shots', tag),
          Buffer.from(data.split(',')[1], 'base64'));
        console.log('  存: docs/shots/' + tag);
      } else {
        console.log('  抓图失败: ' + String(data).slice(0, 60));
      }
    };
    await ev('MOB_LOD_D = 18; return 1;');
    await sleep(300);
    await snap('lod_cmp_on.png');
    await ev('MOB_LOD_D = 9999; return 1;');
    await sleep(300);
    await snap('lod_cmp_off.png');
    console.log('  取样距离 ' + tgt.d + 'm · 屏幕高 ' + tgt.h + 'px · 裁图坐标 ' + tgt.sx + ',' + tgt.sy);
  }

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  await sleep(600);
  await act({ act: 'spawn', name: NM, n: 0, clear: 1 });
  await sleep(300);
  await act({ act: 'delplayer', name: NM });
})();
