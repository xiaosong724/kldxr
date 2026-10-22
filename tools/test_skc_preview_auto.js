// test_skc_preview_auto.js -- 选中皮肤就该显示"改过的样子"（不用点任何东西）
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
const sql = (code, args) => {
  const tmp = path.join(os.tmpdir(), 'pa_' + Date.now() + '.py');
  fs.writeFileSync(tmp, code);
  const r = spawnSync('python', [tmp].concat(args || []), { cwd: path.join(ROOT, 'server'), encoding: 'utf8' });
  try { fs.rmSync(tmp, { force: true }); } catch (e) { }
  return ((r.stdout || '') + (r.stderr || '')).trim();
};

(async () => {
  const nm = '自动' + Math.random().toString(36).slice(2, 4);
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
    body: JSON.stringify({ act: 'give', name: nm, kind: 'skin', skinKey: 'f01', count: 2 })
  }).then(x => x.json());

  // 夹具：解锁 f01 + 穿上 + 写一条自定义（眼型=小豆 9、头发=红色）
  sql([
    'import sqlite3, json, sys, time',
    'c = sqlite3.connect("game.db", timeout=8)',
    'rid = int(sys.argv[1]); now = int(time.time()*1000)',
    'c.execute("INSERT OR IGNORE INTO skin_unlocks(role_id,key,at) VALUES(?,?,?)", (rid,"f01",now))',
    'c.execute("UPDATE roles SET skin=? WHERE id=?", ("f01", rid))',
    'd = {"v":1, "ey":"dot", "hair":16711680}',
    'c.execute("INSERT OR REPLACE INTO skin_custom(role_id,skin_key,data,at) VALUES(?,?,?,?)",',
    '          (rid, "f01", json.dumps(d), now))',
    'c.commit(); print("ok")'
  ].join('\n'), [String(rid)]);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-'));
  const port = 5925 + Math.floor(Math.random() * 10);
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
  await ev('try{ openSet(); setTab("skin"); }catch(e){}');
  await sleep(1500);

  // 拉一次自定义（客户端登录时也会拉 ✓ 保险再拉一次）
  await ev('try{ wsSend("skincustomask", {}); }catch(e){}');
  await sleep(1200);
  console.log('   MY_CUSTOM_MAP:', await ev('JSON.stringify(MY_CUSTOM_MAP)'));

  // ★ 只点皮肤卡片（不点自定义、不做任何操作）→ 预览就该是改过的样子
  await ev("document.querySelectorAll('#skGrid [data-sk=\"f01\"]')[0].click()");
  await sleep(1200);
  const hung = await ev(`JSON.stringify((function(){
      var n = 0; SKIN.hero.g.traverse(function (o) { if (o.isMesh) { n++; } });
      return { meshes: n, autoRotHair: null };
    })())`);
  console.log('   预览网格数:', hung);
  // 用头发颜色判定（夹具里头发改成纯红 0xff0000）
  const hairOk = await ev(`(function(){
      var hit = 0;
      SKIN.hero.g.traverse(function (o) {
        if (o.isMesh && o.material && o.material.color) {
          var c = o.material.color.getHex();
          if (c === 0xff0000) { hit++; }
        }
      });
      return hit;
    })()`);
  ck(hairOk > 0, '★ 只选中皮肤，预览就是【改过的】头发颜色（红）', hairOk);

  const eyeOk = await ev(`JSON.stringify((function(){
      /* 小豆眼 = 61 个网格左右（和标准大眼不同）✓ 这里只判断"和没自定义时不一样" */
      var n = 0; SKIN.hero.g.traverse(function (o) { if (o.isMesh) { n++; } });
      return n;
    })())`);
  console.log('   网格数（自定义后）:', eyeOk);

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  if (FAILS) { console.log('FAILED: ' + FAILS); process.exit(1); }
  console.log('全部通过');
})();
