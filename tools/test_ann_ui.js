// test_ann_ui.js -- 公告弹窗的关闭规则（round498：只有按钮 / 15 秒能关）
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const B = CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let FAILS = 0;
function ck(c, m, got) {
  if (c) { console.log('  PASS  ' + m); }
  else { FAILS++; console.log('  FAIL  ' + m + (got === undefined ? '' : '  got=' + JSON.stringify(got))); }
}

(async () => {
  const nm = '告点' + Math.random().toString(36).slice(2, 5);
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nm, password: 'abc123456' })
  }).then(x => x.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'annui-'));
  const port = 5700 + Math.floor(Math.random() * 60);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=960,760', 'about:blank'], { stdio: 'ignore' });
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
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true })).result.result.value;

  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Page.navigate', { url: ORIGIN + '/?t=' + Date.now() });
  await sleep(1200);
  await ev('localStorage.setItem("token",' + JSON.stringify(reg.token) + ')');
  await send('Page.reload', {});
  await sleep(9000);

  ck(await ev('!!document.getElementById("annBox")'), '进游戏弹出了公告');

  // ① 点遮罩（盒子本身）→ 不关
  await ev(`(function(){
      var ov = document.getElementById('annBox');
      var r = ov.getBoundingClientRect();
      ov.dispatchEvent(new MouseEvent('click', {bubbles:true, clientX:3, clientY:3}));
      return 1;
    })()`);
  await sleep(250);
  ck(await ev('!!document.getElementById("annBox")'), '点遮罩：不关（用户要求）');

  // ② 在面板里滑动 → 不关
  await ev(`(function(){
      var ov = document.getElementById('annBox');
      var p = ov.firstChild;
      p.dispatchEvent(new TouchEvent('touchmove', {bubbles:true, cancelable:true}));
      p.dispatchEvent(new WheelEvent('wheel', {bubbles:true, deltaY:120}));
      return 1;
    })()`);
  await sleep(250);
  ck(await ev('!!document.getElementById("annBox")'), '面板里滑动：不关（能滚着看）');

  // ③ 键盘 → 不关
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', {key:'d'}))`);
  await sleep(200);
  ck(await ev('!!document.getElementById("annBox")'), '按键：不关');

  // ④ 点「知道了」→ 关 + 上报已读
  await ev('document.getElementById("annOk").click()');
  await sleep(400);
  ck(!(await ev('!!document.getElementById("annBox")')), '点「知道了」：关掉');

  // ⑤ 已读落库（刷新后不再弹）
  await send('Page.reload', {});
  await sleep(9000);
  ck(!(await ev('!!document.getElementById("annBox")')), '刷新后不再弹（已读已落库）');

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  if (FAILS) { console.log('FAILED: ' + FAILS); process.exit(1); }
  console.log('全部通过');
})();
