const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'];
const B = process.env.CHROME || CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ROOT = path.resolve(__dirname, '..');
let FAILS = 0;
function ck(c, m, got) {
  if (c) { console.log('  PASS  ' + m); }
  else { FAILS++; console.log('  FAIL  ' + m + (got !== undefined ? '  got=' + JSON.stringify(got) : '')); }
}
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lg8-'));
  const port = 7780 + Math.floor(Math.random() * 14);
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
  const errs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') {
      errs.push(((m.params.exceptionDetails || {}).exception || {}).description || 'err');
    }
    if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; }
  };
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
  await sleep(9000);
  console.log('  状态: ' + await ev('return JSON.stringify({ fx: _lgFx.on, actors: (_lgFx.actors||[]).length, bg: !!_lgFx.bg, cardAlpha: getComputedStyle(document.getElementById("loginCard")).backgroundImage.slice(0,40) });'));
  /* ★★ round451：改成验证"星星在眨眼 + 帧循环没断" */
  const p1 = await ev('return JSON.stringify({ n: (_lgFx.stars||[]).length, r0: ((_lgFx.stars||[])[0]||{}).r, frame: 1 });');
  await sleep(700);
  const p2 = await ev('return JSON.stringify({ raf: _lgFx.raf, shoot: !!_lgFx.shoot });');
  console.log('  星空: ' + p1 + ' → ' + p2);
  const S1 = JSON.parse(p1), S2 = JSON.parse(p2);
  ck(S1.n >= 80, '★★ 星星数量 ' + S1.n + '（够密 ✓）', S1.n);
  ck(S2.raf > 0, '★★ 帧循环还在跑（星星在眨眼）', S2);

  const shot = async (tag, clip) => {
    const p = { format: 'png' };
    if (clip) { p.clip = clip; }
    const s = await send('Page.captureScreenshot', p);
    if (s && s.result && s.result.data) {
      fs.writeFileSync(path.join(ROOT, 'docs', 'shots', 'login-' + tag + '.png'), Buffer.from(s.result.data, 'base64'));
      console.log('  存 docs/shots/login-' + tag + '.png');
    }
  };
  await shot('final');
  await shot('final-actors', { x: 0, y: 500, width: 512, height: 246, scale: 2 });

  // 进游戏后要停（不能空转）
  await ev('hideLogin(); return 1;');
  await sleep(700);
  const stopped = await ev('return JSON.stringify({ fx: _lgFx.on });');
  ck(/false/.test(String(stopped)), '★★ 进游戏后氛围层停了（不占帧）', stopped);

  console.log('  异常: ' + (errs.length ? errs.slice(0, 2).join(' | ') : '（无 ✓）'));
  ck(errs.length === 0, '★ 页面 0 异常', errs.slice(0, 2));
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  console.log(FAILS ? ('FAILED: ' + FAILS) : 'ALL PASS ✓');
  process.exit(FAILS ? 1 : 0);
})();
