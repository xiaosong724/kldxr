// probe_skin_use.js -- 查"使用"按钮到底能不能用（拥有 / 前三 / 独占 三种情况）
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe'];
const B = CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const nm = '皮肤用' + Math.random().toString(36).slice(2, 5);
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nm, password: 'abc123456' })
  }).then(x => x.json());
  const tok = reg.token;
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' })
  }).then(x => x.json()).then(j => j.token);

  // 发一个没人竞价的皮肤给他
  const give = await fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at },
    body: JSON.stringify({ act: 'give', name: nm, kind: 'skin', skinKey: 'f03', equip: false })
  }).then(x => x.json());
  console.log('发皮肤:', JSON.stringify(give).slice(0, 120));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skinuse-'));
  const port = 5900 + Math.floor(Math.random() * 60);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1100,820', 'about:blank'], { stdio: 'ignore' });
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
  await sleep(800);
  await ev('try{ skinPick("f03"); }catch(e){}');
  await sleep(400);

  const info = await ev(`JSON.stringify((function(){
    var it = (typeof skinItemOf === 'function') ? skinItemOf('f03') : null;
    var b = document.getElementById('skUse');
    return { own: it && it.own, can: it && it.can, use: it && it.use,
             mode: it && it.mode, mine: it && it.mine,
             disabled: b ? b.disabled : null, label: b ? b.textContent : null,
             state: (document.getElementById('skState')||{}).textContent };
  })())`);
  console.log('按钮状态:', info);
  const ij = JSON.parse(info || '{}');
  console.log((ij.own ? '  PASS  ' : '  FAIL  ') + '拥有皮肤 → own=1');
  console.log((ij.disabled === false ? '  PASS  ' : '  FAIL  ') + '「使用」按钮可点（disabled=false）');
  console.log((ij.label && ij.label.indexOf('使') >= 0 ? '  PASS  ' : '  FAIL  ') + '按钮文字是"使用"');

  // 点一下看看有没有真的切过去
  await ev(`(function(){ var b=document.getElementById('skUse'); if(b && !b.disabled) b.click(); return 1; })()`);
  await sleep(1200);
  const after = await ev(`JSON.stringify({ mySkin: (typeof MY_SKIN!=='undefined')?MY_SKIN:null,
      btn: (document.getElementById('skUse')||{}).textContent,
      disabled: (document.getElementById('skUse')||{}).disabled })`);
  console.log('点击后:', after);
  const aj = JSON.parse(after || '{}');
  console.log((aj.mySkin ? '  PASS  ' : '  FAIL  ') + '点完真的换上了皮肤（MY_SKIN=' + aj.mySkin + '）');
  console.log((String(aj.btn||'').indexOf('使用中') >= 0 ? '  PASS  ' : '  FAIL  ') + '按钮变成"使用中"');

  // 服务端到底记的是哪个皮肤
  const roleSkin = await ev('JSON.stringify({ role: (WSC.role||{}).skin, my: (typeof MY_SKIN!=="undefined")?MY_SKIN:null })');
  console.log('客户端里的皮肤:', roleSkin);

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
})();
