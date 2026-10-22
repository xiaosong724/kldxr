// test_learn_ui.js -- 用书学会：有提示 / 自动装上 / 技能栏立刻出现 / 点卡片看说明
const { spawn } = require('child_process');
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
  const nm = '学书' + Math.random().toString(36).slice(2, 4);
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nm, password: 'abc123456' })
  }).then(x => x.json());
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' })
  }).then(x => x.json()).then(j => j.token);
  await fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at },
    body: JSON.stringify({ act: 'give', name: nm, kind: 'skillbook',
                           skillKey: 'blackhole', count: 1, tier: 1 })
  }).then(x => x.json());

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ln-'));
  const port = 6400 + Math.floor(Math.random() * 40);
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
  await ev('try{ openSet(); setTab("bag"); }catch(e){}');
  await sleep(1200);

  ck(await ev("document.querySelectorAll('#skBar [data-skcast]').length") === 0,
     '学之前技能栏是空的', await ev("document.querySelectorAll('#skBar [data-skcast]').length"));

  // 点背包里的书 → 浮窗「学习」
  await ev(`(function(){
      var c=document.querySelector('#bagGrid [data-id]');
      var r=c.getBoundingClientRect();
      c.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,
        touches:[new Touch({identifier:1,target:c,clientX:r.x+10,clientY:r.y+10})]}));
      return 1;})()`);
  await sleep(400);
  const clicked = await ev(`(function(){
      var b=document.querySelector('#bagTipBox [data-tipact="useskillbook"]');
      if(!b){return 0;} b.click(); return 1;})()`);
  ck(clicked === 1, '浮窗里有学习按钮');
  await sleep(1500);

  // ① 有提示
  const msg = await ev("(function(){var t=document.querySelector('.tkToast, #tkToast, #toast');return t?t.textContent:'';})()");
  const toastAny = await ev("(document.body.innerText.indexOf('学会了')>=0)");
  console.log('  提示文本命中:', toastAny, '| SK.msg:', await ev('SK.msg'));
  ck(toastAny || String(await ev('SK.msg')).indexOf('学会') >= 0, '★ 学会有提示', msg);

  // ② 自动装配 + ③ 技能栏立刻出现
  const load = await ev('JSON.stringify(SK.load.A)');
  console.log('  装配:', load);
  ck(String(load).indexOf('blackhole') >= 0, '★ 学习后自动装到技能栏', load);
  const cells = await ev("document.querySelectorAll('#skBar [data-skcast]').length");
  ck(cells >= 1, '★ 技能栏立刻出现格子', cells);

  // ④ 菜单技能页点卡片看说明
  await ev("setTab('skill')");
  await sleep(1200);
  await ev(`(function(){
      var c=document.querySelector('#skList [data-skk="blackhole"]');
      if(!c){return 0;} c.click(); return 1;})()`);
  await sleep(400);
  const desc = await ev("document.getElementById('skMsg').textContent");
  console.log('  说明:', String(desc).slice(0, 60));
  ck(String(desc).indexOf('黑洞') >= 0 && String(desc).length > 12, '★ 点技能显示说明', desc);

  let shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ROOT, 'docs/shots/skill-desc.png'), Buffer.from(shot.result.data, 'base64'));

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  if (FAILS) { console.log('FAILED: ' + FAILS); process.exit(1); }
  console.log('全部通过');
})();
