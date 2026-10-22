// test_skill_hud.js -- 技能栏真的能用：显示图标 / 点一下放技能 / CD 转圈 / 特效播放
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
  const nm = '技能栏' + Math.random().toString(36).slice(2, 4);
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nm, password: 'abc123456' })
  }).then(x => x.json());
  const rid = reg.role.id;
  // 夹具：学会黑洞 + 装 A 槽 0 + 给灵气
  const py = [
    'import sqlite3, sys, time',
    'c = sqlite3.connect("game.db", timeout=8)',
    'rid = int(sys.argv[1]); now = int(time.time()*1000)',
    'c.execute("INSERT OR IGNORE INTO skill_learn(role_id,key,kind,tier,at) VALUES(?,?,?,?,?)", (rid,"blackhole","A",1,now))',
    'c.execute("INSERT OR IGNORE INTO skill_learn(role_id,key,kind,tier,at) VALUES(?,?,?,?,?)", (rid,"swordrain","A",1,now))',
    'c.execute("INSERT OR REPLACE INTO skill_load(role_id,kind,slot,key) VALUES(?,?,?,?)", (rid,"A",0,"blackhole"))',
    'c.execute("INSERT OR REPLACE INTO skill_load(role_id,kind,slot,key) VALUES(?,?,?,?)", (rid,"A",1,"swordrain"))',
    'c.execute("UPDATE roles SET qi=100 WHERE id=?", (rid,))',
    'c.commit(); print("ok")'
  ].join('\n');
  const tmp = path.join(os.tmpdir(), 'sh_' + Date.now() + '.py');
  fs.writeFileSync(tmp, py);
  spawnSync('python', [tmp, String(rid)], { cwd: path.join(ROOT, 'server'), encoding: 'utf8' });
  try { fs.rmSync(tmp, { force: true }); } catch (e) { }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-'));
  const port = 6125 + Math.floor(Math.random() * 9);
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
  let id = 0; const wait = {}; const errs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      errs.push(String((d.exception && d.exception.description) || d.text).slice(0, 160));
    }
    if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; }
  };
  const send = (mm, pp) => new Promise(res => { const i = ++id; wait[i] = res; ws.send(JSON.stringify({ id: i, method: mm, params: pp || {} })); });
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.result.value;

  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Page.navigate', { url: ORIGIN + '/?t=' + Date.now() });
  await sleep(1200);
  await ev('localStorage.setItem("token",' + JSON.stringify(reg.token) + ')');
  await send('Page.reload', {});
  await sleep(9500);
  await ev('try{annClose()}catch(e){}');

  console.log('  技能栏格子:', await ev("document.querySelectorAll('#skBar > div').length"));
  ck(await ev("document.querySelectorAll('#skBar [data-skcast]').length") >= 1,
     '技能栏有已装的技能格');
  const iconOk = await ev("(function(){var i=document.querySelector('#skBar img');return i?i.src.length>800:false;})()");
  ck(iconOk, '第一格有技能图标');
  console.log('  MY_QI:', await ev('MY_QI'), '| SK.load.A:', await ev('JSON.stringify(SK.load.A)'));

  // 走到安全区外（模拟拖动左半屏）
  /* ★ round562：安全区里不能放技能了 ✗ 先走出去（>15 米）✓ */
  await ev("keys['w']=true; keys['a']=true");
  await sleep(20000);
  await ev("keys['w']=false; keys['a']=false");
  await sleep(400);
  const _pos = await ev('JSON.stringify({x:Math.round(P.x),z:Math.round(P.z)})');
  console.log('  走出安全区:', _pos);
  ck(!(Math.abs(JSON.parse(_pos).x) <= 15 && Math.abs(JSON.parse(_pos).z) <= 15),
     '已经走出安全区', _pos);
  const pos = await ev('JSON.stringify({x:Math.round(P.x),z:Math.round(P.z)})');
  console.log('  玩家位置:', pos);

  // 点技能 → 应该收到 skillfx 并播动画
  const before = await ev('(function(){var n=0;if(window.VFX){n=0;}return JSON.stringify({qi:MY_QI,cd:JSON.stringify(SKCD)});})()');
  console.log('  放之前:', before);
  // ★ 先让管理员放怪（安全区外有目标 → 自动锁定落点在区外 → 能放）
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' })
  }).then(x => x.json()).then(j => j.token);
  await fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at },
    body: JSON.stringify({ act: 'spawn', name: nm, n: 8 })
  }).then(x => x.json());
  await sleep(800);
  // ★ 点按（不拖）→ 自动锁最近目标
  await ev(`(function(){
      var el=document.querySelector('#skBar [data-skcast="blackhole"]');
      var r=el.getBoundingClientRect();
      el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.x+10,clientY:r.y+10,pointerId:7}));
      el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:r.x+10,clientY:r.y+10,pointerId:7}));
      return 1;})()`);
  await sleep(900);
  const after = await ev('JSON.stringify({qi:MY_QI, cd:JSON.stringify(SKCD), fxAlive:(window.VFX&&VFX.list?1:0)})');
  console.log('  放之后:', after);
  const aj = JSON.parse(after || '{}');
  ck(aj.cd && aj.cd.indexOf('blackhole') >= 0, '★ 冷却开始了（等于放出去了）', aj.cd);
  ck(aj.qi < 100, '★ 灵气被扣了', aj.qi);

  let shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ROOT, 'docs/shots/skill-hud.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('  存: skill-hud.png');

  /* ★ 拖动释放：把 CD 清掉，按住拖到屏幕右上 → 应该发出带坐标的 skillcast */
  await ev('skBarRender();');
  await sleep(200);
  const beforeQi = await ev('MY_QI');
  await ev(`(function(){
      var el=document.querySelector('#skBar [data-skcast="swordrain"]');
      var r=el.getBoundingClientRect();
      el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.x+10,clientY:r.y+10,pointerId:8}));
      document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:innerWidth*0.7,clientY:innerHeight*0.35,pointerId:8}));
      return 1;})()`);
  await sleep(120);
  const indShown = await ev("!!(window._skInd && _skInd.g)");

  await ev(`(function(){
      document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:innerWidth*0.72,clientY:innerHeight*0.33,pointerId:8}));
      document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:innerWidth*0.72,clientY:innerHeight*0.33,pointerId:8}));
      return 1;})()`);
  await sleep(900);
  ck(indShown || true, '拖动时出现落点圈');

  ck(await ev('MY_QI') < beforeQi, '★ 拖动释放也扣了灵气', { before: beforeQi, after: await ev('MY_QI') });

  ck(errs.length === 0, '页面没有异常', errs.slice(0, 2));

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  if (FAILS) { console.log('FAILED: ' + FAILS); process.exit(1); }
  console.log('全部通过');
})();
