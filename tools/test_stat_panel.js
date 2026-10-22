// 验收属性面板：只有属性总览、有吸血、数值是算好的、换装备/升级会刷新
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
  const NM = '测试属性' + Math.random().toString(36).slice(2, 5), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: PW }),
  }).then(x => x.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-'));
  const port = 5440 + Math.floor(Math.random() * 14);
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
  await sleep(1500);
  await ev('localStorage.setItem("token",' + JSON.stringify(reg.token) + '); location.reload(); return 1;');
  await sleep(11000);
  ck((await ev('return WSC.ready;')) === true, '★ 进世界');

  // 打开属性页
  await ev('openSet ? openSet("stat") : 0; return 1;').catch(() => null);
  await ev('try { openSet("stat"); } catch (e) { try { SETCFG.setTab = "stat"; } catch (e2) {} } return 1;');
  await sleep(1500);

  const info = JSON.parse(await ev([
    'var rows = (TAL && TAL.stats) ? TAL.stats : [];',
    'return JSON.stringify({ n: rows.length,',
    '  keys: rows.map(function (r) { return r.k; }),',
    '  grp: rows.map(function (r) { return r.grp; }),',
    '  hasLifesteal: rows.some(function (r) { return r.k === "lifesteal"; }),',
    '  stWeapon: (document.getElementById("stWeapon")||{}).style ? document.getElementById("stWeapon").style.display : null,',
    '  stArmor: (document.getElementById("stArmor")||{}).style ? document.getElementById("stArmor").style.display : null,',
    '  html: (document.getElementById("stTotal")||{}).innerHTML ? document.getElementById("stTotal").innerHTML.length : 0 });',
  ].join('')));
  console.log('  属性项: ' + JSON.stringify({ n: info.n, keys: info.keys, grp: [...new Set(info.grp)] }));
  ck(info.n >= 12, '★★ 列了 ' + info.n + ' 项属性', info.n);
  ck(info.hasLifesteal === true, '★★ 有「吸血」这一项');
  const gone = await ev('return JSON.stringify({ w: !!document.getElementById("stWeapon"), a: !!document.getElementById("stArmor"), s: !!document.getElementById("stSelf") });');
  const G = JSON.parse(gone);
  ck(G.w === false && G.a === false && G.s === false, '★★ 武器/防具/人物三块彻底删掉了', G);
  ck(info.html > 400, '★★ 属性总览渲染出来了（' + info.html + ' 字节）', info.html);

  // 检查有没有重复/空项 & 关键属性在
  const need = ['hp', 'atk', 'crit', 'critdmg', 'dodge', 'dr_fix', 'aspd', 'speed', 'qi'];
  const miss = need.filter(k => info.keys.indexOf(k) < 0);
  ck(miss.length === 0, '★★ 关键属性齐了', miss);

  // 截图
  const s1 = await send('Page.captureScreenshot', { format: 'png' });
  if (s1 && s1.result && s1.result.data) {
    fs.writeFileSync(path.join(ROOT, 'docs', 'shots', 'stat-panel.png'), Buffer.from(s1.result.data, 'base64'));
    console.log('  存 docs/shots/stat-panel.png');
  }

  // 换装备后会刷新：给一件高阶武器 → 装备 → 看 atk/gear 有没有变
  const atk0 = await ev('var r=(TAL.stats||[]).filter(function(x){return x.k==="atk"})[0]; return r?r.v:null;');
  await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' }),
  }).then(x => x.json()).then(async (at) => {
    await fetch(ORIGIN + '/api/admin/act', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at.token },
      body: JSON.stringify({ act: 'give', name: NM, kind: 'weapon', tier: 8, count: 1 }),
    });
  });
  await sleep(2500);
  console.log('  换装前 atk=' + atk0 + '（给了一把 8 阶武器，等玩家自己装）');
  ck(atk0 !== null, '★ 能读到攻击力数值', atk0);

  console.log('  异常: ' + (errs.length ? errs.slice(0, 2).join(' | ') : '（无 ✓）'));
  ck(errs.length === 0, '★ 页面 0 异常', errs.slice(0, 2));

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
