// test_skill_dmg.js -- 黑洞真的打得出伤害（含城里放）
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
  const nm = '伤害' + Math.random().toString(36).slice(2, 4);
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nm, password: 'abc123456' })
  }).then(x => x.json());
  const rid = reg.role.id;
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' })
  }).then(x => x.json()).then(j => j.token);
  const py = [
    'import sqlite3,sys,time',
    'c=sqlite3.connect("game.db",timeout=8);rid=int(sys.argv[1]);now=int(time.time()*1000)',
    'c.execute("INSERT OR IGNORE INTO skill_learn(role_id,key,kind,tier,at) VALUES(?,?,?,?,?)",(rid,"blackhole","A",1,now))',
    'c.execute("INSERT OR REPLACE INTO skill_load(role_id,kind,slot,key) VALUES(?,?,?,?)",(rid,"A",0,"blackhole"))',
    'c.execute("UPDATE roles SET qi=100 WHERE id=?",(rid,));c.commit();print("ok")'
  ].join('\n');
  const tmp = path.join(os.tmpdir(), 'dm_' + Date.now() + '.py');
  fs.writeFileSync(tmp, py);
  spawnSync('python', [tmp, String(rid)], { cwd: path.join(ROOT, 'server'), encoding: 'utf8' });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-'));
  const port = 6450 + Math.floor(Math.random() * 40);
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
  await sleep(500);

  // 管理员在玩家附近放 8 只僵尸
  await fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at },
    body: JSON.stringify({ act: 'spawn', name: nm, n: 8 })
  }).then(x => x.json());
  await sleep(1200);

  const mobsBefore = await ev('(function(){var n=0;for(var k in NET.mobs){n++;}return n;})()');
  const hpBefore = await ev('(function(){var s=0;for(var k in NET.mobs){s+=NET.mobs[k].hp||0;}return Math.round(s);})()');
  console.log('  放之前：怪', mobsBefore, '总血', hpBefore);

  // 放黑洞
  await ev(`(function(){
      var el=document.querySelector('#skBar [data-skcast="blackhole"]');
      var r=el.getBoundingClientRect();
      el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.x+8,clientY:r.y+8,pointerId:31}));
      el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:r.x+8,clientY:r.y+8,pointerId:31}));
      return 1;})()`);
  await sleep(1600);

  const hpAfter = await ev('(function(){var s=0;for(var k in NET.mobs){s+=NET.mobs[k].hp||0;}return Math.round(s);})()');
  const mobsAfter = await ev('(function(){var n=0;for(var k in NET.mobs){n++;}return n;})()');
  console.log('  放之后：怪', mobsAfter, '总血', hpAfter);
  ck(hpBefore > 0, '附近有僵尸可打', hpBefore);
  ck(hpAfter < hpBefore || mobsAfter < mobsBefore, '★ 黑洞造成了伤害（怪掉血/死）',
     { before: hpBefore, after: hpAfter, mb: mobsBefore, ma: mobsAfter });

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  if (FAILS) { console.log('FAILED: ' + FAILS); process.exit(1); }
  console.log('全部通过');
})();
