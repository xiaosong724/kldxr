// shot_vfx.js -- 打开调参台，播黑洞，截图（顺便查报错）
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe'];
const B = CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vfx-'));
  const port = 5955 + Math.floor(Math.random() * 10);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1180,820', 'about:blank'], { stdio: 'ignore' });
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
      errs.push(String((d.exception && d.exception.description) || d.text).slice(0, 200));
    }
    if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; }
  };
  const send = (mm, pp) => new Promise(res => { const i = ++id; wait[i] = res; ws.send(JSON.stringify({ id: i, method: mm, params: pp || {} })); });
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.result.value;

  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Page.navigate', { url: ORIGIN + '/vfx.html?t=' + Date.now() });
  await sleep(2500);

  console.log('技能列表:', await ev('Object.keys(VFX).filter(k=>VFX[k]&&VFX[k].mk).join(",")'));
  console.log('滑条数:', await ev('document.querySelectorAll("#sliders input[type=range]").length'));

  // 拖到最大半径 + 播放，抓爆开前后两帧
  await ev(`(function(){
      var ins = document.querySelectorAll('#sliders input[type=range]');
      ins[0].value = ins[0].max; ins[0].dispatchEvent(new Event('input',{bubbles:true}));
      document.getElementById('play').click();
      return 1; })()`);
  await sleep(600);
  let s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ROOT, 'docs/shots/vfx-blackhole.png'), Buffer.from(s.result.data, 'base64'));
  await sleep(700);   /* 等它爆开 */
  s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ROOT, 'docs/shots/vfx-blackhole-boom.png'), Buffer.from(s.result.data, 'base64'));

  console.log('参数:', await ev("document.getElementById('json').value"));
  /* ★ 全部动画过一遍：看有没有报错 */
  const keys = await ev('JSON.stringify(VFX.list())');
  const list = JSON.parse(keys || '[]');
  let bad = [];
  for (const k of list) {
    await ev(`(function(){
        var sel=document.getElementById('pick');
        sel.value='${k}'; sel.dispatchEvent(new Event('change',{bubbles:true}));
        return 1; })()`);
    await sleep(120);
    if (errs.length > bad.length) { bad.push(k); }
  }
  console.log('动画总数:', list.length, '| 出错:', bad.length ? bad : '无');
  /* 存三张代表性的 */
  /* ★ 用一个动画半径和技能半径差别大的技能，方便看两个圈 */
  await ev(`(function(){ var sel=document.getElementById('pick'); sel.value='blackhole';
      sel.dispatchEvent(new Event('change',{bubbles:true}));
      var ins=document.querySelectorAll('#sliders input[type=range]');
      ins[0].value='7'; ins[0].dispatchEvent(new Event('input',{bubbles:true}));
      return 1; })()`);
  await sleep(300);
  console.log('数值行:', await ev("document.getElementById('skNums').textContent"));
  for (const [k, name] of [['swordrain','vfx-swordrain'], ['firestorm','vfx-firestorm'], ['icefield','vfx-icefield']]) {
    await ev(`(function(){ var sel=document.getElementById('pick'); sel.value='${k}';
      sel.dispatchEvent(new Event('change',{bubbles:true})); document.getElementById('play').click(); return 1; })()`);
    await sleep(420);
    const sh = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ROOT, 'docs/shots/' + name + '.png'), Buffer.from(sh.result.data, 'base64'));
  }
  console.log('报错:', errs.length ? errs.slice(0, 2) : '(无)');
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
})();
