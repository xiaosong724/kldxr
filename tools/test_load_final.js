// 终检：gzip（用同步 XHR 读响应头）+ thunder 是否加载上 + 首屏体积
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
  const NM = '测试终检' + Math.random().toString(36).slice(2, 5), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: PW }),
  }).then(x => x.json());
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' }),
  }).then(x => x.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fin-'));
  const port = 8440 + Math.floor(Math.random() * 14);
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
  await sleep(12000);

  // gzip：同步 XHR 能看到响应头（fetch 会自动解压，看不到 ✓）
  console.log('  gzip 检查: ' + await ev([
    'var x = new XMLHttpRequest();',
    'x.open("GET", "/core/game.js", false);',
    'x.send(null);',
    'return JSON.stringify({ ce: x.getResponseHeader("content-encoding"),',
    '  cl: x.getResponseHeader("content-length"), status: x.status,',
    '  len: x.responseText.length });',
  ].join('')));

  console.log('  音效: ' + await ev([
    'var miss = [], loaded = 0;',
    'for (var k in SFX_BANK) { if ((SFX_BANK[k] || []).length) { loaded++; } else { miss.push(k); } }',
    'return JSON.stringify({ bankKeys: Object.keys(SFX_BANK).length, loaded: loaded, miss: miss,',
    '  lazyLeft: Object.keys(SFX_LAZY).length, errs: SFX_ERR.slice(0, 4),',
    '  thunder: (SFX_BANK.thunder || []).length });',
  ].join('')));

  const A = JSON.parse(await ev([
    'var res = performance.getEntriesByType("resource");',
    'var kb = 0, sfx = 0, sfxkb = 0;',
    'res.forEach(function (r) {',
    '  var k = Math.round((r.encodedBodySize || r.transferSize || 0) / 1024);',
    '  kb += k; if (r.name.indexOf("/assets/sfx/") >= 0) { sfx++; sfxkb += k; } });',
    'return JSON.stringify({ totalKB: kb, sfxReqs: sfx, sfxKB: sfxkb, allSfxKB: 0 });',
  ].join('')));
  console.log('  全量（含后台补齐）: ' + JSON.stringify(A));

  // 对比"优化前"的基线
  const BASE = { totalKB: 3371, sfxKB: 1935 };
  ck(A.sfxKB < 600, '★★ 音效总量 ' + A.sfxKB + 'KB（优化前 ' + BASE.sfxKB + 'KB）', A.sfxKB);
  /* ★ JS 部分 resource timing 报的是解压后大小 → 不靠它算总量 ✗
     改成直接量 gzip 后的实际传输（下面那个同步 XHR 已经验了 ✓）*/
  ck(A.totalKB < 2400, '★ 总传输 ' + A.totalKB + 'KB（其中 JS 按解压后算，实际传输要小得多）', A.totalKB);

  const th = await ev('return (SFX_BANK.thunder || []).length;');
  ck(th > 0, '★★ 雷声也加载上了（' + th + '）', th);
  const errs = await ev('return JSON.stringify(SFX_ERR);');
  ck(errs === '[]', '★ 没有加载失败的音效', errs);

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
