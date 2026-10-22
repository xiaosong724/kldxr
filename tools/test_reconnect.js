// 验收断线重连：强制断线 → 看横幅/自动重连/世界恢复
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'];
const B = process.env.CHROME || CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let FAILS = 0;
function ck(c, m, got) {
  if (c) { console.log('  PASS  ' + m); }
  else { FAILS++; console.log('  FAIL  ' + m + (got !== undefined ? '  got=' + JSON.stringify(got) : '')); }
}
(async () => {
  const NM = '测试断线' + Math.random().toString(36).slice(2, 5), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: PW }),
  }).then(x => x.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-'));
  const port = 5860 + Math.floor(Math.random() * 14);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=520,900', ORIGIN + '/'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 160 && !target; i++) {
    await sleep(250);
    try {
      const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      target = l.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) { }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const wait = {};
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; } };
  const send = (m, p) => new Promise(res => { const i = ++id; wait[i] = res; ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  const ev = async (x) => {
    const r = await send('Runtime.evaluate', { expression: '(function(){' + x + '})()', returnByValue: true, awaitPromise: true });
    if (r && r.result && r.result.exceptionDetails) {
      const ed = r.result.exceptionDetails;
      return '__THROW__ ' + String((ed.exception && ed.exception.description) || ed.text).split(String.fromCharCode(10))[0];
    }
    return r && r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable', {});
  await sleep(1500);
  await ev('localStorage.setItem("token",' + JSON.stringify(reg.token) + '); location.reload(); return 1;');
  await sleep(11000);
  const st0 = await ev('return JSON.stringify({ ready: WSC.ready, online: NET.on, bar: document.getElementById("netBar") ? document.getElementById("netBar").style.display : null });');
  console.log('  进游戏: ' + st0);
  const S0 = JSON.parse(st0);
  ck(S0.ready === true, '★ 已连上并进入世界', S0);

  // ① 断线横幅元素存在
  ck(await ev('return typeof netBarShow === "function" && typeof netHardReconnect === "function";'),
    '★★ 有断线横幅 + 硬重连函数');

  // ② 断线横幅本身能不能显示/收起（直接验函数，不靠竞态）
  const barShow = await ev('netBarShow("测试断线"); var b=document.getElementById("netBar"); return b ? b.style.display : "none";');
  console.log('  横幅显示: ' + barShow);
  ck(barShow === 'flex', '★★ 断线横幅能显示（玩家看得见 ✓）', barShow);
  const barHide = await ev('netBarHide(); var b=document.getElementById("netBar"); return b ? b.style.display : "none";');
  ck(barHide === 'none', '★★ 连上后横幅能收起', barHide);

  // ③ 强制断线（模拟手机锁屏后连接死掉）→ 应自己恢复
  await ev('try { WSC.sock.close(); } catch(e){} return 1;');

  // ③ 自动恢复
  let back = null;
  for (let i = 0; i < 14; i++) {
    await sleep(1000);
    back = JSON.parse(await ev('return JSON.stringify({ ready: WSC.ready, online: NET.on, bar: document.getElementById("netBar") ? document.getElementById("netBar").style.display : null });'));
    if (back.ready) { break; }
  }
  console.log('  恢复情况: ' + JSON.stringify(back));
  ck(back && back.ready === true, '★★ 自动重连回来了（不用重启 APK）', back);
  ck(back && (back.bar === 'none' || back.bar === null), '★★ 连上后横幅自动收起', back);

  // ④ 世界真的在动（快照还在来）
  const t1 = Date.now();
  await sleep(1500);
  const gap = await ev('return Math.round((Date.now() - window._lastWorldT));');
  console.log('  距上一份世界快照: ' + gap + 'ms');
  ck(gap < 1500, '★★ 世界快照还在持续到达（' + gap + 'ms）', gap);

  // ⑤ 手动点"重连"也能работать
  await ev('netHardReconnect("测试手动"); return 1;');
  let manual = null;
  for (let i = 0; i < 10; i++) {
    await sleep(1000);
    manual = JSON.parse(await ev('return JSON.stringify({ ready: WSC.ready });'));
    if (manual.ready) { break; }
  }
  ck(manual && manual.ready === true, '★★ 点"重连"也能连回来', manual);

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  await sleep(500);
  await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' }),
  }).then(x => x.json()).then(at => fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at.token },
    body: JSON.stringify({ act: 'delplayer', name: NM }),
  })).catch(() => null);
  console.log('');
  console.log(FAILS ? ('FAILED: ' + FAILS) : 'ALL PASS ✓');
  process.exit(FAILS ? 1 : 0);
})();
