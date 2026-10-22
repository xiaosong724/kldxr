// test_bag_tip.js -- 批量模式不弹浮窗 + 切出背包自动关浮窗
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe'];
const B = CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let FAILS = 0;
const ck = (c, m, got) => {
  if (c) { console.log('  PASS  ' + m); } else { FAILS++; console.log('  FAIL  ' + m + (got === undefined ? '' : '  got=' + JSON.stringify(got))); }
};

(async () => {
  const nm = '浮窗' + Math.random().toString(36).slice(2, 4);
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nm, password: 'abc123456' })
  }).then(x => x.json());
  const rid = reg.role.id;
  // 塞 5 件材料（能批量卖）
  const py = [
    'import sqlite3, json, sys, time',
    'c = sqlite3.connect("game.db", timeout=8)',
    'rid = int(sys.argv[1])',
    'for i in range(5):',
    '    it = {"name":"碎玻璃","tier":1,"kind":"material"}',
    '    c.execute("INSERT INTO items(role_id,in_storage,slot_index,stack,item_json,created_at)"',
    '              " VALUES(?,0,-1,1,?,?)", (rid, json.dumps(it,ensure_ascii=False), int(time.time()*1000)))',
    'c.commit(); print("ok")'
  ].join('\n');
  const tmp = path.join(os.tmpdir(), 'bt_' + Date.now() + '.py');
  fs.writeFileSync(tmp, py);
  spawnSync('python', [tmp, String(rid)], { cwd: path.join(ROOT, 'server'), encoding: 'utf8' });
  try { fs.rmSync(tmp, { force: true }); } catch (e) { }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-'));
  const port = 5940 + Math.floor(Math.random() * 9);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1100,900', 'about:blank'], { stdio: 'ignore' });
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

  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Page.navigate', { url: ORIGIN + '/?t=' + Date.now() });
  await sleep(1200);
  await ev('localStorage.setItem("token",' + JSON.stringify(reg.token) + ')');
  await send('Page.reload', {});
  await sleep(9000);
  await ev('try{annClose()}catch(e){}');
  await ev('try{ openSet(); setTab("bag"); }catch(e){}');
  await sleep(1500);

  const n = await ev('(BAG.items||[]).length');
  ck(n >= 5, '背包里有 5 件', n);

  // 普通模式：hover 应弹浮窗
  await ev(`(function(){
      var c = document.querySelector('#bagGrid [data-id]');
      var r = c.getBoundingClientRect();
      /* 手机那条路：touchstart ✓（无头浏览器里 mouseover 不一定触发）*/
      c.dispatchEvent(new TouchEvent('touchstart', {bubbles:true,
        touches:[new Touch({identifier:1, target:c, clientX:r.x+10, clientY:r.y+10})]}));
      return 1;
    })()`);
  await sleep(300);
  const vis1 = await ev("(document.getElementById('bagTipBox')||{}).style.display");
  ck(vis1 === 'block', '普通模式：点格子弹浮窗', vis1);

  // 切到批量模式 → 再 hover 不该弹
  await ev('(function(){ var b=document.getElementById("bagPick"); if(b) b.click(); return 1; })()');
  await sleep(400);
  ck(await ev('BAG.multi === true'), '进入批量模式');
  await ev(`(function(){
      var c = document.querySelector('#bagGrid [data-id]');
      var r = c.getBoundingClientRect();
      c.dispatchEvent(new MouseEvent('mouseover', {bubbles:true, clientX:r.x+10, clientY:r.y+10}));
      return 1;
    })()`);
  await sleep(300);
  const vis2 = await ev("(document.getElementById('bagTipBox')||{}).style.display");
  ck(vis2 !== 'block', '★ 批量模式：hover 不弹浮窗', vis2);

  // 点两格应该勾上（浮窗没挡住）
  /* ★ 每次点完 bagRender 会重建格子 ✗ 必须重新查（不然第二次点到的是旧节点）*/
  for (var _i = 0; _i < 2; _i++) {
    await ev(`(function(){
        var cs = document.querySelectorAll('#bagGrid [data-id]');
        if (cs[${_i}]) { cs[${_i}].dispatchEvent(new MouseEvent('click', {bubbles:true})); }
        return 1;
      })()`);
    await sleep(250);
  }
  await sleep(400);
  ck(await ev('(BAG.pick||[]).length') === 2, '★ 批量点两格 → 勾中 2 件', await ev('(BAG.pick||[]).length'));

  // 退出批量 + 普通模式弹浮窗 → 切到别的 tab，浮窗应该自动关
  await ev('(function(){ var b=document.getElementById("bagPick"); if(b) b.click(); return 1; })()');
  await sleep(300);
  await ev(`(function(){
      var c = document.querySelector('#bagGrid [data-id]');
      var r = c.getBoundingClientRect();
      c.dispatchEvent(new TouchEvent('touchstart', {bubbles:true,
        touches:[new Touch({identifier:1, target:c, clientX:r.x+10, clientY:r.y+10})]}));
      return 1;
    })()`);
  await sleep(300);
  ck(await ev("(document.getElementById('bagTipBox')||{}).style.display") === 'block', '浮窗开着');
  await ev('setTab("view")');
  await sleep(300);
  const vis3 = await ev("(document.getElementById('bagTipBox')||{}).style.display");
  ck(vis3 !== 'block', '★ 切出背包 → 浮窗自动关掉', vis3);

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  if (FAILS) { console.log('FAILED: ' + FAILS); process.exit(1); }
  console.log('全部通过');
})();
