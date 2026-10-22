// 量优化后：首屏体积/请求数、gzip 是否生效、二次加载是否走 304
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
  // ① 先看 HTTP 头（gzip / ETag / 缓存策略）
  /* ★ fetch 会自动解压 → arrayBuffer 长度一样 ✗ 要看 Content-Length ✓ */
  const h1 = await fetch(ORIGIN + '/core/game.js', { headers: { 'Accept-Encoding': 'gzip' } });
  const sizeGz = +(h1.headers.get('content-length') || 0);
  await h1.arrayBuffer();
  const h2 = await fetch(ORIGIN + '/core/game.js', { headers: { 'Accept-Encoding': 'identity' } });
  const sizeRaw = +(h2.headers.get('content-length') || 0);
  await h2.arrayBuffer();
  const et = h1.headers.get('etag');
  console.log('  game.js: gzip ' + Math.round(sizeGz / 1024) + 'KB / 原始 ' + Math.round(sizeRaw / 1024) + 'KB, etag=' + et);
  ck(h1.headers.get('content-encoding') === 'gzip', '★★ JS 走 gzip 了', h1.headers.get('content-encoding'));
  ck(sizeGz < sizeRaw * 0.5, '★★ 压缩比 > 50%（' + Math.round(sizeGz / sizeRaw * 100) + '%）', [sizeGz, sizeRaw]);
  ck(!!et, '★★ 带 ETag', et);
  const h3 = await fetch(ORIGIN + '/core/game.js', { headers: { 'If-None-Match': et } });
  ck(h3.status === 304, '★★ 第二次请求返回 304（不重下）', h3.status);

  // ② 真开页面：量首屏传输量 + 音效是否变少
  const NM = '测试加载2' + Math.random().toString(36).slice(2, 5), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: PW }),
  }).then(x => x.json());
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' }),
  }).then(x => x.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'load2-'));
  const port = 8680 + Math.floor(Math.random() * 14);
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
  await sleep(1200);
  await ev('localStorage.setItem("token",' + JSON.stringify(reg.token) + '); location.reload(); return 1;');
  // 刚进世界那一刻（首屏）量一次 —— 别等后台补齐 ✗
  await sleep(1600);
  const first = await ev([
    'var res = performance.getEntriesByType("resource");',
    'var by = {}, total = 0, n = 0;',
    'res.forEach(function (r) {',
    '  var kb = Math.round((r.transferSize || r.encodedBodySize || 0) / 1024);',
    '  var u = r.name.split("?")[0]; var cat = "other";',
    '  if (u.indexOf("/assets/sfx/") >= 0) { cat = "sfx"; }',
    '  else if (u.indexOf("/assets/3d/") >= 0) { cat = "tex"; }',
    '  else if (u.indexOf(".js") >= 0) { cat = "js"; }',
    '  else if (u.indexOf("/api/") >= 0) { cat = "api"; }',
    '  by[cat] = by[cat] || { n: 0, kb: 0 }; by[cat].n++; by[cat].kb += kb; total += kb; n++;',
    '});',
    'var nav = performance.getEntriesByType("navigation")[0] || {};',
    'return JSON.stringify({ totalKB: total, reqs: n, by: by,',
    '  dcl: Math.round(nav.domContentLoadedEventEnd || 0),',
    '  roleReady: !!(WSC && WSC.role) });',
  ].join(''));
  console.log('  进世界后 3.5 秒: ' + first);
  const F = JSON.parse(first);
  ck(F.roleReady === true, '★ 已经进世界了', F.roleReady);
  ck((F.by.sfx ? F.by.sfx.n : 0) <= 12, '★★ 首屏只拉了少量音效（' + (F.by.sfx ? F.by.sfx.n : 0) + ' 个，优化前 35 个）', F.by.sfx);
  ck((F.by.sfx ? F.by.sfx.kb : 0) < 700, '★★ 首屏音效体积 ' + (F.by.sfx ? F.by.sfx.kb : 0) + 'KB（优化前 1935KB）', F.by.sfx);

  // 等后台补完（warm）
  await sleep(12000);
  const later = await ev([
    'var res = performance.getEntriesByType("resource");',
    'var sfx = 0, kb = 0;',
    'res.forEach(function (r) { var u = r.name;',
    '  if (u.indexOf("/assets/sfx/") >= 0) { sfx++; kb += Math.round((r.transferSize || r.encodedBodySize || 0) / 1024); } });',
    'var keys = 0, banked = 0;',
    'for (var k in SFX_BANK) { keys++; if ((SFX_BANK[k] || []).length) { banked++; } }',
    'return JSON.stringify({ sfxReqs: sfx, sfxKB: kb, bankKeys: keys, bankLoaded: banked, lazyLeft: Object.keys(SFX_LAZY).length });',
  ].join(''));
  console.log('  再等 9 秒（后台补齐）: ' + later);
  const L = JSON.parse(later);
  ck(L.bankLoaded >= 20, '★★ 后台把大部分音效补齐了（已加载 ' + L.bankLoaded + ' 组）', L);

  // ③ 刷新一次，看是否走 304（第二次几乎不下载）
  const before = await ev('return performance.getEntriesByType("resource").length;');
  await send('Page.reload', {});
  await sleep(6000);
  const again = await ev([
    'var res = performance.getEntriesByType("resource");',
    'var kb = 0, n304 = 0, n = 0;',
    'res.forEach(function (r) { n++; kb += Math.round((r.transferSize || 0) / 1024);',
    '  if ((r.transferSize || 0) === 0 && r.decodedBodySize > 0) { n304++; } });',
    'return JSON.stringify({ reqs: n, totalKB: kb, cached: n304 });',
  ].join(''));
  console.log('  刷新后: ' + again);
  const A = JSON.parse(again);
  ck(A.totalKB < 1200, '★★ 刷新后传输量 ' + A.totalKB + 'KB（优化前 3371KB）', A);

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  await sleep(500);
  await fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at.token },
    body: JSON.stringify({ act: 'delplayer', name: NM }),
  }).catch(() => null);
  console.log('');
  console.log(FAILS ? ('FAILED: ' + FAILS) : 'ALL PASS ✓');
  process.exit(FAILS ? 1 : 0);
})();
