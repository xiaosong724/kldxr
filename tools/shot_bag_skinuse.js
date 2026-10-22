// shot_bag_skinuse.js -- 背包里点开一张皮肤卡 → 浮窗（带「使 用」）截图
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe'];
const B = CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const nm = '卡窗' + Math.random().toString(36).slice(2, 5);
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nm, password: 'abc123456' })
  }).then(x => x.json());
  const tok = reg.token, rid = reg.role.id;

  const py = [
    'import sqlite3, json, sys, time',
    'c = sqlite3.connect("game.db", timeout=6)',
    'rid = int(sys.argv[1])',
    'item = {"name": "皮肤·女仆", "tier": 0, "kind": "skin", "key": "f05"}',
    'c.execute("INSERT INTO items(role_id, in_storage, slot_index, stack, item_json, created_at)"',
    '          " VALUES(?,0,0,1,?,?)", (rid, json.dumps(item, ensure_ascii=False), int(time.time()*1000)))',
    'c.commit(); print("ok")'
  ].join('\n');
  const tmp = path.join(os.tmpdir(), 'bags_' + Date.now() + '.py');
  fs.writeFileSync(tmp, py);
  const r = spawnSync('python', [tmp, String(rid)], { cwd: path.join(ROOT, 'server'), encoding: 'utf8' });
  console.log('塞卡:', (r.stdout || '').trim(), (r.stderr || '').trim().slice(0, 80));
  try { fs.rmSync(tmp, { force: true }); } catch (e) { }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bagshot-'));
  const port = 5995 + Math.floor(Math.random() * 25);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1100,860', 'about:blank'], { stdio: 'ignore' });
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
    const rr = await send('Page.captureScreenshot', { format: 'png' });
    const out = path.join(ROOT, 'docs', 'shots', name);
    fs.writeFileSync(out, Buffer.from(rr.result.data, 'base64'));
    console.log('存:', out);
  };

  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Page.navigate', { url: ORIGIN + '/?t=' + Date.now() });
  await sleep(1200);
  await ev('localStorage.setItem("token",' + JSON.stringify(tok) + ')');
  await send('Page.reload', {});
  await sleep(9000);
  await ev('try{annClose()}catch(e){}');
  await ev('try{ openSet(); setTab("bag"); }catch(e){}');
  await sleep(1800);

  // 直接把那张卡的浮窗摆出来（用页面自己的 bagTipHTML ✓ 视觉一致）
  const info = await ev(`(function(){
      var rec = null;
      for (var j=0;j<(BAG.items||[]).length;j++){
        if ((BAG.items[j].item||{}).kind === 'skin') { rec = BAG.items[j]; break; }
      }
      if (!rec) return 'no-card';
      var html = bagTipHTML(rec.item, rec.id, 'bag', {});
      var box = document.getElementById('bagTipBox');
      if (!box) return 'no-box';
      box.innerHTML = html;
      box.style.display = 'block';
      box.style.left = '320px'; box.style.top = '300px';
      return 'shown:' + rec.id + ':' + (rec.item||{}).key;
    })()`);
  console.log('浮窗:', info);
  await sleep(600);
  await shot('bag-skin-use.png');

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
})();
