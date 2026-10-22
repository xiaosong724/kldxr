// probe_skc_preview.js -- 点眼型/嘴巴时，大预览到底变没变？
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe'];
const B = CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const nm = '预览' + Math.random().toString(36).slice(2, 4);
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
    body: JSON.stringify({ act: 'give', name: nm, kind: 'skin', skinKey: 'f01', equip: true })
  }).then(x => x.json());

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-'));
  const port = 5905 + Math.floor(Math.random() * 12);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1100,900', 'about:blank'], { stdio: 'ignore' });
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
  await send('Page.navigate', { url: ORIGIN + '/?t=' + Date.now() });
  await sleep(1200);
  await ev('localStorage.setItem("token",' + JSON.stringify(reg.token) + ')');
  await send('Page.reload', {});
  await sleep(9000);
  await ev('try{annClose()}catch(e){}');
  await ev('try{ openSet(); setTab("skin"); }catch(e){}');
  await sleep(1200);
  await ev('try{ skinPick("f01"); }catch(e){}');
  await sleep(400);
  await ev('document.getElementById("skCustom").click()');
  await sleep(1500);

  const heroBefore = await ev('JSON.stringify({uuid: SKIN.hero.g.uuid, kids: SKIN.hero.g.children.length, rot: SKIN.rot})');
  const rect = await ev('JSON.stringify((function(){var r=document.getElementById("skCv").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})())');
  const rb = JSON.parse(rect || '{}');
  const shot1 = await send('Page.captureScreenshot', { format: 'png', clip: { x: rb.x, y: rb.y, width: rb.width, height: rb.height, scale: 1 } });
  const before = String((shot1.result.data || '').length);
  const thumbN = await ev('document.querySelectorAll("#skCOpts img").length');
  const thumbInfo = await ev(`JSON.stringify((function(){
      var imgs = [].slice.call(document.querySelectorAll('#skCOpts img'));
      if (!imgs.length) { return { n: 0 }; }
      var a = imgs[0].src, b = imgs[1] ? imgs[1].src : '';
      /* 量一下第一张图是不是"全空"：画到 2D 画布上算平均亮度 */
      var cv = document.createElement('canvas'); cv.width = 40; cv.height = 32;
      var cx = cv.getContext('2d');
      return { n: imgs.length, len: a.length, differ: a !== b };
    })())`);
  console.log('缩略图:', thumbInfo);
  const ti = JSON.parse(thumbInfo || '{}');
  console.log(ti.n === 10 ? '  PASS  10 张缩略图' : '  FAIL  缩略图数量 ' + ti.n);
  console.log(ti.len > 5000 ? '  PASS  缩略图有内容（dataURL ' + ti.len + ' 字节）' : '  FAIL  缩略图疑似空白');
  console.log(ti.differ ? '  PASS  不同选项的缩略图不一样' : '  FAIL  所有缩略图都一样');

  // ★ 先冻住自转/角度，排除"截图差异只是转了一下"
  await ev('(function(){ SKIN.autoRot=false; SKIN.rot=0.35; if(SKIN.hero){SKIN.hero.g.rotation.y=0.35;} SKIN.r.render(SKIN.scene,SKIN.cam); return 1; })()');
  await sleep(300);
  const shot1b = await send('Page.captureScreenshot', { format: 'png', clip: { x: rb.x, y: rb.y, width: rb.width, height: rb.height, scale: 1 } });
  // 点第 10 个眼型（带疤 ✓ 差异最明显）
  await ev('document.querySelectorAll("#skCOpts [data-skc-val]")[9].click()');
  await sleep(900);
  const heroAfter = await ev('JSON.stringify({uuid: SKIN.hero.g.uuid, kids: SKIN.hero.g.children.length, rot: SKIN.rot})');
  await ev('(function(){ SKIN.autoRot=false; SKIN.rot=0.35; if(SKIN.hero){SKIN.hero.g.rotation.y=0.35;} SKIN.r.render(SKIN.scene,SKIN.cam); return 1; })()');
  await sleep(200);
  const shot2 = await send('Page.captureScreenshot', { format: 'png', clip: { x: rb.x, y: rb.y, width: rb.width, height: rb.height, scale: 1 } });
  console.log('冻结后画布是否变化:', shot1b.result.data !== shot2.result.data);
  console.log('大模型网格数:', await ev(`JSON.stringify((function(){
      var n = 0; SKIN.hero.g.traverse(function (o) { if (o.isMesh) { n++; } });
      return { n: n, pending: SKC.pending };
    })())`));
  console.log('hero 前:', heroBefore);
  console.log('hero 后:', heroAfter);
  const after = String((shot2.result.data || '').length);
  const sameImg = (shot1.result.data === shot2.result.data);
  const inView = await ev('(function(){var r=document.getElementById("skCv").getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})()');
  console.log('整页截图有变化:', !sameImg, '| 画布在视口内:', inView);
  console.log('预览前后长度:', before, '→', after);
  console.log('SKIN.hero 存在:', await ev('!!(SKIN && SKIN.hero)'));
  console.log('pending:', await ev('JSON.stringify(SKC.pending)'));
  if (errs.length) { console.log('报错:', errs.slice(0, 3)); }
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
})();
