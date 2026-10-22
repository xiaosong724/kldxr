// test_clone_fade.js -- AI 分身消失时必须是【淡出】，不是瞬间消失
// 做法：召一个分身 → 管理员把主人打倒（服务器会解散分身）→ 逐帧采透明度
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'docs/shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let FAILS = 0;
const ck = (c, m, got) => {
  if (c) { console.log('  PASS  ' + m); }
  else { FAILS++; console.log('  FAIL  ' + m + '  got=' + JSON.stringify(got)); }
};

async function api(url, body, headers) {
  const r = await fetch(ORIGIN + url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: JSON.stringify(body)
  });
  return r.json();
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const nm = '淡出' + Math.random().toString(36).slice(2, 5);
  const reg = await api('/api/register', { name: nm, password: 'abc123456' });
  const admin = await api('/api/admin/login', { password: 'xiuxian-admin' });
  const AH = { 'X-Admin': admin.token };

  // 学会 + 装配 AI 分身
  const py = [
    'import sqlite3,sys,time',
    'c=sqlite3.connect("game.db",timeout=8);rid=int(sys.argv[1]);now=int(time.time()*1000)',
    'c.execute("INSERT OR IGNORE INTO skill_learn(role_id,key,kind,tier,at) VALUES(?,?,?,?,?)",(rid,"clone","B",1,now))',
    'c.execute("INSERT OR REPLACE INTO skill_load(role_id,kind,slot,key) VALUES(?,?,?,?)",(rid,"B",0,"clone"))',
    'c.execute("UPDATE roles SET qi=200 WHERE id=?",(rid,));c.commit();print("ok")'
  ].join('\n');
  const tmpPy = path.join(os.tmpdir(), 'fade_' + Date.now() + '.py');
  fs.writeFileSync(tmpPy, py);
  require('child_process').spawnSync('python', [tmpPy, String(reg.role.id)],
    { cwd: path.join(ROOT, 'server'), encoding: 'utf8' });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fade-'));
  const port = 6800 + Math.floor(Math.random() * 40);
  const proc = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1280,800',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion',
    'about:blank'
  ], { stdio: 'ignore' });
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
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; }
  };
  const send = (mm, pp) => new Promise(res => {
    const i = ++id; wait[i] = res;
    ws.send(JSON.stringify({ id: i, method: mm, params: pp || {} }));
  });
  const ev = async (x) => {
    const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) { console.log('EXC', JSON.stringify(r.result.exceptionDetails)); }
    return r.result.result.value;
  };

  await send('Page.enable', {});
  await send('Runtime.enable', {});
  await send('Page.navigate', { url: ORIGIN + '/?t=' + Date.now() });
  await sleep(1500);
  await ev('localStorage.setItem("token",' + JSON.stringify(reg.token) + ')');
  await send('Page.reload', {});
  await sleep(10000);
  await ev('try{annClose()}catch(e){}');
  await ev(`window.__msgs=[];(function(){var old=window.skCloneHandle;
    window.skCloneHandle=function(d){window.__msgs.push(JSON.parse(JSON.stringify(d)));
      try{old(d);}catch(e){window.__cerr=String((e&&e.stack)||e);}};})()`);

  // 清怪，免得主人先被野怪咬死
  await api('/api/admin/act', { act: 'spawn', name: nm, n: 0, clear: true }, AH);

  // 召 1 个分身
  let n = 0;
  for (let i = 0; i < 70 && n < 1; i++) {
    await api('/api/admin/act', { act: 'trigB', name: nm, n: 1 }, AH);
    await sleep(170);
    n = await ev('Object.keys(window.CLONES||{}).length');
  }
  ck(n > 0, '召出了分身', n);
  await sleep(700);
  const cid = await ev(`(function(){var a=(window.__msgs||[]).filter(function(x){return x.spawn&&x.cid;});
    return a.length?a[a.length-1].cid:null;})()`);
  await ev('window.__cid=' + JSON.stringify(cid));
  console.log('  cid =', cid);
  const op0 = await ev(`(function(){var g=CLONES[window.__cid];if(!g){return null;}
    var o=null;g.traverse(function(m){if(o===null&&m.isMesh&&m.material){o=m.material.opacity;}});return o;})()`);
  console.log('  初始材质透明度 =', op0);
  ck(op0 > 0.3, '分身初始是不透明的', op0);

  /* 逐帧采样：_dying / 材质透明度 / 名牌计算透明度 / 是否还在场景里 */
  async function sampleFade(wantShot, tag) {
    const samples = [];
    let fadeShot = false;
    for (let i = 0; i < 26; i++) {
      const s = await ev(`(function(){var g=CLONES[window.__cid];
        if(!g){return {gone:true,count:Object.keys(CLONES||{}).length};}
        var o=null;g.traverse(function(m){if(o===null&&m.isMesh&&m.material){o=m.material.opacity;}});
        var po=null;
        try{po=g._ui&&g._ui.wrap?+(getComputedStyle(g._ui.wrap).opacity):null;}catch(e){po='err';}
        return {gone:false,dying:(g._dying==null?null:+g._dying.toFixed(2)),op:(o==null?null:+o.toFixed(3)),
                plateOp:po,dragged:!!g._ui};})()`);
      s.t = i * 80;
      samples.push(s);
      if (wantShot && !fadeShot && !s.gone && s.op != null && s.op < 0.55 && s.op > 0.05) {
        const r = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(SHOTS, 'clone-fade.png'), Buffer.from(r.result.data, 'base64'));
        fadeShot = true;
      }
      await sleep(80);
    }
    console.log('  ' + tag + ' 采样:', JSON.stringify(samples));
    const dying = samples.filter(s => !s.gone && s.dying != null);
    const opVals = samples.filter(s => !s.gone && s.op != null).map(s => s.op);
    const removed = samples.some(s => s.gone);
    return { samples, dying, opVals, removed, fadeShot };
  }

  // 场景 1：主人还活着 → 直接让客户端走一次"消失"（不会被死亡遮罩挡住 ✓ 能截到淡出）
  await ev('skCloneDrop(window.__cid)');
  const f1 = await sampleFade(true, '客户端直删');
  ck(f1.dying.length >= 2, '检测到淡出过程（_dying 在推进）', f1.dying.length);
  ck(f1.opVals.length >= 2 && f1.opVals[f1.opVals.length - 1] < f1.opVals[0] - 0.1,
     '材质透明度确实在下降', f1.opVals);
  ck(f1.dying.length > 0 && f1.dying.every(s => s.plateOp == null || s.plateOp <= 1),
     '名牌也在参与淡出（opacity 有值）', f1.dying.slice(0, 3));
  ck(f1.removed, '淡出结束后被移除', f1.removed);
  ck(f1.fadeShot, '抓到了淡出中的截图', f1.fadeShot);

  // 场景 2：再召一个 → 管理员把主人打倒（服务器解散）→ 应该走同一条淡出
  let n2 = 0;
  for (let i = 0; i < 70 && n2 < 1; i++) {
    await api('/api/admin/act', { act: 'trigB', name: nm, n: 1 }, AH);
    await sleep(170);
    n2 = await ev('Object.keys(window.CLONES||{}).length');
  }
  ck(n2 > 0, '第二次召出了分身', n2);
  await sleep(600);
  const cid2 = await ev(`(function(){var a=(window.__msgs||[]).filter(function(x){return x.spawn&&x.cid;});
    return a.length?a[a.length-1].cid:null;})()`);
  await ev('window.__cid=' + JSON.stringify(cid2));
  console.log('  第二个 cid =', cid2);
  await api('/api/admin/act', { act: 'kill', name: nm }, AH);
  const f2 = await sampleFade(false, '主人死亡解散');
  ck(f2.dying.length >= 1, '服务器解散也走淡出（同一条路）', f2.dying.length);
  ck(f2.removed, '服务器解散后也正确移除', f2.removed);

  try { ws.close(); } catch (e) { }
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  try { fs.rmSync(tmpPy, { force: true }); } catch (e) { }
  console.log('');
  if (FAILS) { console.log('FAILED: ' + FAILS); process.exit(1); }
  console.log('全部通过');
})();
