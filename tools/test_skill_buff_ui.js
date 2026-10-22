// test_skill_buff_ui.js -- 被动加成端到端（浏览器驱动）：装冷却 5 品，CD 应从 15 → 7.5
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

async function runOne(buffKey, buffTier, label) {
  const nm = label + Math.random().toString(36).slice(2, 4);
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nm, password: 'abc123456' })
  }).then(x => x.json());
  const rid = reg.role.id;
  const py = [
    'import sqlite3, sys, time',
    'c = sqlite3.connect("game.db", timeout=8)',
    'rid = int(sys.argv[1]); now = int(time.time()*1000)',
    'c.execute("INSERT OR IGNORE INTO skill_learn(role_id,key,kind,tier,at) VALUES(?,?,?,?,?)", (rid,"blackhole","A",1,now))',
    'c.execute("INSERT OR REPLACE INTO skill_load(role_id,kind,slot,key) VALUES(?,?,?,?)", (rid,"A",0,"blackhole"))',
    'bk = sys.argv[2]',
    'if bk:',
    '    c.execute("INSERT OR IGNORE INTO skill_learn(role_id,key,kind,tier,at) VALUES(?,?,?,?,?)", (rid,bk,"C",int(sys.argv[3]),now))',
    '    c.execute("INSERT OR REPLACE INTO skill_load(role_id,kind,slot,key) VALUES(?,?,?,?)", (rid,"C",0,bk))',
    'c.execute("UPDATE roles SET qi=100 WHERE id=?", (rid,))',
    'c.commit(); print("ok")'
  ].join('\n');
  const tmp = path.join(os.tmpdir(), 'bf_' + Date.now() + Math.random().toString(36).slice(2, 5) + '.py');
  fs.writeFileSync(tmp, py);
  spawnSync('python', [tmp, String(rid), buffKey || '', String(buffTier || 1)], { cwd: path.join(ROOT, 'server'), encoding: 'utf8' });
  try { fs.rmSync(tmp, { force: true }); } catch (e) { }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-'));
  const port = 6150 + Math.floor(Math.random() * 40);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1000,760', 'about:blank'], { stdio: 'ignore' });
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
  await sleep(9000);
  await ev('try{annClose()}catch(e){}');
  await sleep(500);

  // 放黑洞（点技能格）
  await ev(`(function(){
      var el = document.querySelector('#skBar [data-skcast="blackhole"]');
      if (!el) { return 0; }
      var r = el.getBoundingClientRect();
      el.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, clientX:r.x+8, clientY:r.y+8, pointerId:11}));
      el.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, clientX:r.x+8, clientY:r.y+8, pointerId:11}));
      return 1;})()`);
  await sleep(1200);
  const cd = await ev('SKCD.blackhole || 0');
  const qi = await ev('MY_QI');
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  return { cd: +cd, qi: +qi };
}

(async () => {
  console.log('① 无加成（基准）：');
  const a = await runOne('', 1, '基准');
  console.log('   CD:', a.cd.toFixed(2), '| 灵气:', a.qi);
  ck(a.cd > 13 && a.cd <= 15.2, '基准 CD ≈ 15 秒', a.cd);
  ck(a.qi === 95, '基准扣 5 灵气', a.qi);

  console.log();
  console.log('② 装【技能冷却 5 品】（-50%）：');
  const b = await runOne('cdcut', 5, '冷却');
  console.log('   CD:', b.cd.toFixed(2), '| 灵气:', b.qi);
  /* 客户端读数时已经走了 ~1.2 秒 ✗ 所以 7.5 - 1.2 ≈ 6.3 ✓ */
  ck(b.cd > 5.8 && b.cd < 7.6, '★ CD 变成约 7.5 秒（读数已倒计时 1.2 秒）', b.cd);

  console.log();
  console.log('③ 装【节能 5 品】（-35%）：');
  const c = await runOne('thrifty', 5, '节能');
  console.log('   CD:', c.cd.toFixed(2), '| 灵气:', c.qi);
  ck(c.qi > 95, '★ 灵气少扣了（5×0.65≈3）', c.qi);

  console.log();
  if (FAILS) { console.log('FAILED: ' + FAILS); process.exit(1); }
  console.log('全部通过');
})();
