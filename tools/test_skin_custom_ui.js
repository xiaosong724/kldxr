// test_skin_custom_ui.js -- 皮肤自定义界面：能开、能预览、确认会发 ws、回执后生效
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe'];
const B = CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let FAILS = 0;
const ck = (c, m, got) => {
  if (c) { console.log('  PASS  ' + m); }
  else { FAILS++; console.log('  FAIL  ' + m + (got === undefined ? '' : '  got=' + JSON.stringify(got))); }
};

(async () => {
  const nm = '捏脸UI' + Math.random().toString(36).slice(2, 4);
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
  // 塞 2 张 f01 卡（1 张解锁用的 + 1 张重复）
  const py = [
    'import sqlite3, json, sys, time',
    'c = sqlite3.connect("game.db", timeout=8)',
    'rid = int(sys.argv[1])',
    'for _ in range(2):',
    '    it = {"name":"皮肤·双马尾剑士","tier":0,"kind":"skin","key":"f01"}',
    '    c.execute("INSERT INTO items(role_id,in_storage,slot_index,stack,item_json,created_at)"',
    '              " VALUES(?,0,-1,1,?,?)", (rid, json.dumps(it,ensure_ascii=False), int(time.time()*1000)))',
    'c.execute("INSERT OR IGNORE INTO skin_unlocks(role_id,key,at) VALUES(?,?,?)", (rid,"f01",int(time.time()*1000)))',
    'c.execute("UPDATE roles SET skin=? WHERE id=?", ("f01", rid))',
    'c.commit(); print("ok")'
  ].join('\n');
  const tmp = path.join(os.tmpdir(), 'scu_' + Date.now() + '.py');
  fs.writeFileSync(tmp, py);
  spawnSync('python', [tmp, String(rid)], { cwd: path.join(ROOT, 'server'), encoding: 'utf8' });
  try { fs.rmSync(tmp, { force: true }); } catch (e) { }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scui-'));
  const port = 5935 + Math.floor(Math.random() * 15);
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
  await ev('localStorage.setItem("token",' + JSON.stringify(tok) + ')');
  await send('Page.reload', {});
  await sleep(9000);
  await ev('try{annClose()}catch(e){}');
  await ev('try{ openSet(); setTab("skin"); }catch(e){}');
  await sleep(1200);

  ck(await ev('document.querySelectorAll("#skNav [data-sknav]").length') === 2,
     '皮肤页有二级导航（皮肤 / 自定义）');
  ck(await ev('getComputedStyle(document.getElementById("skMain")).display !== "none"'),
     '默认停在「皮肤」页');
  await ev("document.querySelector('#skNav [data-sknav=\"custom\"]').click()");
  await sleep(700);
  ck(await ev('getComputedStyle(document.getElementById("skCPanel")).display !== "none"'),
     '点「自定义」→ 切到自定义页');
  ck(await ev('getComputedStyle(document.getElementById("skMain")).display === "none"'),
     '「皮肤」那页收起来了');
  await ev("document.querySelector('#skNav [data-sknav=\"main\"]').click()");
  await sleep(600);
  ck(await ev('getComputedStyle(document.getElementById("skMain")).display !== "none"'),
     '能切回「皮肤」页');
  ck(await ev('!!document.getElementById("skCustom")'), '皮肤页有「自定义」按钮');
  await ev('try{ skinPick("f01"); }catch(e){}');
  await sleep(300);
  ck(await ev('!(document.getElementById("skCustom")||{}).disabled'), '自己拥有的皮肤 → 自定义可点');

  await ev('document.getElementById("skCustom").click()');
  await sleep(500);
  ck(await ev('(document.getElementById("skCPanel")||{}).style.display !== "none"'), '面板打开了');
  /* ★ round519：分类从 5 个变成 7 个（加了裙子 / 裤子）*/
ck(await ev('document.querySelectorAll("#skCTabs [data-skc-tab]").length') === 7, '7 个分类（含裙/裤）');
  const n1 = await ev('document.querySelectorAll("#skCOpts [data-skc-val]").length');
  ck(n1 === 10, '眼型 10 个选项', n1);

  // 选 3 号眼型 → 预览变 + 确认按钮亮
  await ev('document.querySelectorAll("#skCOpts [data-skc-val]")[2].click()');
  await sleep(300);
  ck(await ev('SKC.pending.ey === 2'), '选中记到 pending（ey=2）');
  ck(await ev('document.getElementById("skCOk").disabled === false'), '确认按钮亮了');
  /* ★ round530：消耗提示改成"剩余卡 N 张 · 本次消耗 M 张" */
  var _cost = String(await ev('document.getElementById("skCCost").textContent'));
  console.log('   消耗提示:', _cost);
  ck(_cost.indexOf('剩余卡') >= 0 && _cost.indexOf('本次消耗') >= 0,
     '消耗提示写了剩余卡 + 本次消耗', _cost);

  /* ★ round524：点到【图片】也要算点中 ✓ 而且能连续换（第二次点第二张图）*/
  await ev(`(function(){
      var t = document.querySelectorAll("#skCOpts [data-skc-val]");
      var img = t[0].querySelector('img');
      (img || t[0]).dispatchEvent(new MouseEvent('click', {bubbles:true}));
      return SKC.pending.ey;
    })()`).then(v => ck(v === 0, '点【图片】也能选中（第 1 个）', v));
  await sleep(300);
  await ev(`(function(){
      var t = document.querySelectorAll("#skCOpts [data-skc-val]");
      var img = t[4].querySelector('img');
      (img || t[4]).dispatchEvent(new MouseEvent('click', {bubbles:true}));
      return SKC.pending.ey;
    })()`).then(v => ck(v === 4, '能换成第 5 个（不是"点了就锁死"）', v));
  await sleep(300);
  ck(await ev(`document.querySelectorAll("#skCOpts [data-skc-val]")[4].style.borderColor` ) === 'rgb(255, 216, 61)',
     '第 5 个有金框（选中框生效）');

  // 确认 → 扣卡 + 生效
  await ev('document.getElementById("skCOk").click()');
  await sleep(2500);
  const st = await ev('JSON.stringify({ pending: SKC.pending, map: MY_CUSTOM_MAP, my: MY_SKIN_CUSTOM })');
  console.log('   ', st);
  const sj = JSON.parse(st || '{}');
  /* ★ 前面换成第 5 个了（index 4）✗ 期望值跟着改 ✓ */
  ck(sj.map && sj.map['f01'] && sj.map['f01'].ey === 4, '回执里 f01 的 ey = 4', sj.map);
  ck(sj.my && sj.my.ey === 4, '自己的模型已按自定义重建', sj.my);

  // 服务端：卡被扣 + 落库
  const con = spawnSync('python', ['-c',
    'import sqlite3,json,sys;c=sqlite3.connect("game.db");' +
    'print(c.execute("select data from skin_custom where role_id=?",(' + String(rid) + ',)).fetchone())'],
    { cwd: path.join(ROOT, 'server'), encoding: 'utf8' });
  console.log('   库:', (con.stdout || '').trim().slice(0, 120));
  ck(String(con.stdout).indexOf('droop') >= 0, '落库存的是 key（droop = 第 5 个下垂眼）', con.stdout);

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  if (FAILS) { console.log('FAILED: ' + FAILS); process.exit(1); }
  console.log('全部通过');
})();
