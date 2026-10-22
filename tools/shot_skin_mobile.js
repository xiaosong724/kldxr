// shot_skin_mobile.js -- 手机竖屏看皮肤页（按钮会不会被挤掉 / 看不到）
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe'];
const B = CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const W = parseInt(process.env.VW || '390', 10);
const H = parseInt(process.env.VH || '844', 10);

(async () => {
  const nm = '皮手机' + Math.random().toString(36).slice(2, 5);
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nm, password: 'abc123456' })
  }).then(x => x.json());
  const tok = reg.token, rid = reg.role.id;
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' })
  }).then(x => x.json()).then(j => j.token);
  await fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at },
    body: JSON.stringify({ act: 'give', name: nm, kind: 'skin', skinKey: 'f06', equip: false })
  }).then(x => x.json());

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skmob-'));
  const port = 5960 + Math.floor(Math.random() * 30);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=' + W + ',' + H, 'about:blank'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 120 && !t; i++) {
    await sleep(250);
    try {
      const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      t = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
    } catch (e) { }
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const wait = {};
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; } };
  const send = (mm, pp) => new Promise(res => { const i = ++id; wait[i] = res; ws.send(JSON.stringify({ id: i, method: mm, params: pp || {} })); });
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.result.value;
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const out = path.join(ROOT, 'docs', 'shots', name);
    fs.writeFileSync(out, Buffer.from(r.result.data, 'base64'));
    console.log('存:', out);
  };

  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Emulation.setDeviceMetricsOverride',
    { width: W, height: H, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: ORIGIN + '/?t=' + Date.now() });
  await sleep(1200);
  await ev('localStorage.setItem("token",' + JSON.stringify(tok) + ')');
  await send('Page.reload', {});
  await sleep(9000);
  await ev('try{annClose()}catch(e){}');
  await ev('try{ openSet(); setTab("skin"); }catch(e){}');
  await sleep(900);
  await ev('try{ skinPick("f06"); }catch(e){}');
  await sleep(500);
  await shot('skin-mobile-1.png');

  // 按钮在视口里吗？有没有被裁掉？
  const box = await ev(`JSON.stringify((function(){
    var b = document.getElementById('skUse');
    if (!b) return { none: true };
    var r = b.getBoundingClientRect();
    var st = getComputedStyle(b);
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
             vw: innerWidth, vh: innerHeight,
             visible: r.bottom > 0 && r.top < innerHeight && r.width > 2,
             disabled: b.disabled, label: b.textContent,
             overflow: st.overflow, font: st.fontSize };
  })())`);
  console.log('使用按钮:', box);

  // 滚到按钮那一段再拍一张
  await ev(`(function(){ var b=document.getElementById('skUse');
     if (b && b.scrollIntoView) b.scrollIntoView({block:'center'}); return 1; })()`);
  await sleep(500);
  await shot('skin-mobile-2.png');

  // 真点一下
  await ev(`(function(){ var b=document.getElementById('skUse');
     if (b && !b.disabled) { b.click(); return 'clicked'; } return 'disabled'; })()`)
    .then(v => console.log('点击结果:', v));
  await sleep(1200);
  console.log('点后皮肤:', await ev('JSON.stringify({my:MY_SKIN, btn:(document.getElementById("skUse")||{}).textContent})'));
  await shot('skin-mobile-3.png');

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
})();
