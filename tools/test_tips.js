// test_tips.js -- 把手当隐藏键 / 背包书浮窗有说明 / 技能页点击出浮窗
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
  const nm = '说明' + Math.random().toString(36).slice(2, 4);
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nm, password: 'abc123456' })
  }).then(x => x.json());
  const rid = reg.role.id;
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' })
  }).then(x => x.json()).then(j => j.token);
  await fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at },
    body: JSON.stringify({ act: 'give', name: nm, kind: 'skillbook',
                           skillKey: 'blackhole', count: 1, tier: 1 })
  }).then(x => x.json());
  const tmp = path.join(os.tmpdir(), 'tp_' + Date.now() + '.py');
  fs.writeFileSync(tmp, [
    'import sqlite3,sys,time',
    'c=sqlite3.connect("game.db",timeout=8);rid=int(sys.argv[1]);now=int(time.time()*1000)',
    'c.execute("INSERT OR IGNORE INTO skill_learn(role_id,key,kind,tier,at) VALUES(?,?,?,?,?)",(rid,"blackhole","A",1,now))',
    'c.execute("INSERT OR REPLACE INTO skill_load(role_id,kind,slot,key) VALUES(?,?,?,?)",(rid,"A",0,"blackhole"))',
    'c.commit();print("ok")'
  ].join('\n'));
  spawnSync('python', [tmp, String(rid)], { cwd: path.join(ROOT, 'server'), encoding: 'utf8' });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-'));
  const port = 6500 + Math.floor(Math.random() * 40);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1100,800', 'about:blank'], { stdio: 'ignore' });
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
  await sleep(1000);
  await ev('localStorage.setItem("token",' + JSON.stringify(reg.token) + ')');
  await send('Page.reload', {});
  await sleep(9500);
  await ev('try{annClose()}catch(e){}');
  await sleep(600);

  // ① 没有多余的"隐藏"按钮；点把手 = 收起
  ck(await ev("!document.getElementById('skToggleA')"), '没有多余的隐藏按钮');
  const before = await ev("document.querySelectorAll('#skBar [data-skcast]').length");
  await ev(`(function(){
      var g=document.getElementById('skGrip');
      var r=g.getBoundingClientRect();
      g.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.x+6,clientY:r.y+6,pointerId:41}));
      document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:r.x+6,clientY:r.y+6,pointerId:41}));
      return 1;})()`);
  await sleep(400);
  const after = await ev("document.querySelectorAll('#skBar [data-skcast]').length");
  console.log('  点把手前格子:', before, '→ 后:', after);
  ck(after < before, '★ 点把手就收起技能格', { before, after });
  const gripTxt = await ev("(document.getElementById('skGrip')||{}).textContent");
  ck(String(gripTxt).indexOf('展开') >= 0, '收起后把手变成「展开」', gripTxt);
  // 再点一次恢复
  await ev(`(function(){
      var g=document.getElementById('skGrip');
      var r=g.getBoundingClientRect();
      g.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.x+6,clientY:r.y+6,pointerId:42}));
      document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:r.x+6,clientY:r.y+6,pointerId:42}));
      return 1;})()`);
  await sleep(400);
  ck(await ev("document.querySelectorAll('#skBar [data-skcast]').length") === before, '再点一次就展开');

  // ② 背包技能书浮窗有说明
  await ev("openSet(); setTab('bag')");
  await sleep(1400);
  await ev(`(function(){
      var c=document.querySelector('#bagGrid [data-id]');
      var r=c.getBoundingClientRect();
      c.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,
        touches:[new Touch({identifier:1,target:c,clientX:r.x+10,clientY:r.y+10})]}));
      return 1;})()`);
  await sleep(600);
  const tip = await ev("(document.getElementById('bagTipBox')||{}).innerText||''");
  console.log('  背包浮窗片段:', String(tip).slice(0, 70).replace(/\n/g, ' '));
  ck(String(tip).indexOf('抛出黑洞') >= 0 || String(tip).indexOf('10 米内') >= 0,
     '★ 技能书浮窗里有技能效果说明', tip.slice(0, 60));

  // ③ 技能页点卡片弹浮窗
  await ev("setTab('skill')");
  await sleep(1200);
  await ev(`(function(){
      var c=document.querySelector('#skList [data-skk="blackhole"]');
      c.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:200,clientY:300}));
      return 1;})()`);
  await sleep(500);
  const tip2 = await ev("(document.getElementById('bagTipBox')||{}).innerText||''");
  console.log('  技能页浮窗片段:', String(tip2).slice(0, 70).replace(/\n/g, ' '));
  ck(String(tip2).indexOf('黑洞') >= 0 && String(tip2).indexOf('不暴击') >= 0,
     '★ 技能页点击弹出说明浮窗', tip2.slice(0, 60));

  let shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ROOT, 'docs/shots/skill-tip.png'), Buffer.from(shot.result.data, 'base64'));

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  if (FAILS) { console.log('FAILED: ' + FAILS); process.exit(1); }
  console.log('全部通过');
})();
