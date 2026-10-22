// dbg_skin_nan.js -- 找哪些皮肤会产出 NaN 几何 + 放大后自转是否停
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe'];
const B = CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nan-'));
  const port = 5915 + Math.floor(Math.random() * 12);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1200,900', 'about:blank'], { stdio: 'ignore' });
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
  let id = 0; const wait = {}; const logs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled') {
      const s = (m.params.args || []).map(a => a.value).join(' ');
      if (s.indexOf('NaN') >= 0) { logs.push('WARN ' + s.slice(0, 90)); }
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      logs.push('EXC ' + String((d.exception && d.exception.description) || d.text).slice(0, 160));
    }
    if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; }
  };
  const send = (mm, pp) => new Promise(res => { const i = ++id; wait[i] = res; ws.send(JSON.stringify({ id: i, method: mm, params: pp || {} })); });
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.result.value;

  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Page.navigate', { url: 'file:///C:/mc/xiuxian-2d/tools/preview_face10.html?k=eyesM' });
  await sleep(3000);

  console.log('   定制对比:', await ev(`JSON.stringify((function(){
      function sig(h) { return h.g.children.length + '/' + h.h.toFixed(3) + '/' + (h.headH||0).toFixed(2); }
      var a = skBuildHero('f01', { ey: 0 });
      var b = skBuildHero('f01', { ey: 9 });
      var c = skBuildHero('f01', { ey: 9, mo: 9 });
      function meshN(h) { var n = 0; h.g.traverse(function (o) { if (o.isMesh) { n++; } }); return n; }
      return { none: meshN(a), ey9: meshN(b), ey9mo9: meshN(c),
               hair: (function(){ var x = skBuildHero('f01', { hair: 0xff0000 }); return meshN(x); })() };
    })())`));

  const bad = await ev(`JSON.stringify((function(){
      var out = [];
      for (var i = 0; i < SKIN_ORDER.length; i++) {
        var k = SKIN_ORDER[i];
        var h = skBuildHero(k);
        if (!h) { out.push([k, 'null']); continue; }
        var bad2 = 0;
        h.g.traverse(function (o) {
          if (!o.isMesh || !o.geometry) { return; }
          var pos = o.geometry.attributes && o.geometry.attributes.position;
          if (!pos) { return; }
          var a = pos.array;
          for (var j = 0; j < a.length; j++) { if (!isFinite(a[j])) { bad2++; break; } }
        });
        if (bad2) { out.push([k, bad2]); }
      }
      return out;
    })())`);
  console.log('有 NaN 的皮肤:', bad);

  // 自转 + 放大 检查（在游戏页里）
  console.log(logs.slice(0, 4).join('\n') || '(没有 NaN 警告)');
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
})();
