// shot_skc_panel.js -- 皮肤自定义面板截图（含 10 个小头像）
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe'];
const B = CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const nm = '面板' + Math.random().toString(36).slice(2, 4);
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
    body: JSON.stringify({ act: 'give', name: nm, kind: 'skin', skinKey: 'f01', equip: true })
  }).then(x => x.json());
  const py = [
    'import sqlite3, json, sys, time',
    'c = sqlite3.connect("game.db", timeout=8)',
    'rid = int(sys.argv[1])',
    'for _ in range(2):',
    '    it = {"name":"皮肤·双马尾剑士","tier":0,"kind":"skin","key":"f01"}',
    '    c.execute("INSERT INTO items(role_id,in_storage,slot_index,stack,item_json,created_at)"',
    '              " VALUES(?,0,-1,1,?,?)", (rid, json.dumps(it,ensure_ascii=False), int(time.time()*1000)))',
    'c.commit(); print("ok")'
  ].join('\n');
  const tmp = path.join(os.tmpdir(), 'ps_' + Date.now() + '.py');
  fs.writeFileSync(tmp, py);
  spawnSync('python', [tmp, String(rid)], { cwd: path.join(ROOT, 'server'), encoding: 'utf8' });
  try { fs.rmSync(tmp, { force: true }); } catch (e) { }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pshot-'));
  const port = 5920 + Math.floor(Math.random() * 12);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1100,980', 'about:blank'], { stdio: 'ignore' });
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
  let id = 0; const wait = {}; const errs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      errs.push((d.exception && d.exception.description) || d.text);
    }
    if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; }
  };
  const send = (mm, pp) => new Promise(res => { const i = ++id; wait[i] = res; ws.send(JSON.stringify({ id: i, method: mm, params: pp || {} })); });
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.result.value;

  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Page.navigate', { url: ORIGIN + '/?t=' + Date.now() });
  await sleep(1200);
  await ev('localStorage.setItem("token",' + JSON.stringify(tok) + ')');
  await send('Page.reload', {});
  await sleep(9000);
  await ev('try{annClose()}catch(e){}');
  await ev('try{ openSet(); setTab("skin"); }catch(e){}');
  await sleep(1200);
  await ev('try{ skinPick("f01"); }catch(e){}');
  await sleep(300);
  await ev("document.querySelector('#skNav [data-sknav=\"custom\"]').click()");
  await sleep(2500);
  /* 顺便验证拖拽/缩放：拖一段 + 滚一下 */
  await ev('(function(){ var c=document.getElementById("skCv"); c.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,clientX:200,clientY:120,pointerId:1})); c.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,clientX:260,clientY:100,pointerId:1})); c.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,pointerId:1})); return SKIN.rot; })()').then(v => console.log('  拖动后 rot =', v));
  await ev('(function(){ var c=document.getElementById("skCv"); c.dispatchEvent(new WheelEvent("wheel",{bubbles:true,deltaY:-120})); return SKIN.zoom; })()').then(v => console.log('  滚轮后 zoom =', v));
  /* 截完图用：把视角复位回正常（不然模型是歪的 ✓）*/
  await ev('(function(){ SKIN.rot = 0; if (SKIN.hero) SKIN.hero.g.rotation.y = 0; return 1; })()');
  await sleep(700);
  await ev('(function(){ document.querySelector(".tabpane[data-pane=\"skin\"]").scrollTop = 0; return 1; })()');
  await sleep(700);
  const n = await ev('document.querySelectorAll("#skCOpts img").length');
  /* 选 10 号（疤眼）→ 大模型应该看出来 */
  await ev('(function(){ var t=document.querySelectorAll("#skCOpts [data-skc-val]")[9]; if(t) t.click(); return 1; })()');
  await sleep(800);
  const r2 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ROOT, 'docs', 'shots', 'skin-custom-panel2.png'),
                   Buffer.from(r2.result.data, 'base64'));
  console.log('存: skin-custom-panel2.png');
  console.log('小头像数量:', n);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ROOT, 'docs', 'shots', 'skin-custom-panel.png'),
                   Buffer.from(r.result.data, 'base64'));
  console.log('存: skin-custom-panel.png');
  if (errs.length) { console.log('报错:', errs.slice(0, 3).map(x => String(x).slice(0, 160))); }
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
})();
