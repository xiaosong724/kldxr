// 验收：攻速（含词条）+ 武器基础属性 + 属性页攻速行
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
  const NM = 'atk' + Math.random().toString(36).slice(2, 8), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: PW }),
  }).then(x => x.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-'));
  const port = 4840 + Math.floor(Math.random() * 14);
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
    if (m.method === 'Runtime.exceptionThrown') { errs.push(((m.params.exceptionDetails || {}).exception || {}).description || 'err'); }
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

  // ① 攻速计算：基础 1.15 + 攻速词条 +20% → 1.38，间隔 0.62/1.38=0.449
  const calc = JSON.parse(await ev([
    'var w = { slot: "weapon", name: "测试剑", tier: 5, look: "sword",',
    '  base: { coeff: 1.0, atkSpeed: 1.15, reach: 2.4, arc: 1.05 }, reqLevel: 1, durMax: 100, dur: 100,',
    '  affixes: [ { key: "spd_pct", val: 20, text: "攻速 +20%" } ] };',
    'window.__w = w;',
    'return JSON.stringify({ base: wSpdBase(w), pct: wSpdPct(w), total: wSpdTotal(w),',
    '  interval: wInterval(w) });',
  ].join('')));
  console.log('  含词条攻速: ' + JSON.stringify(calc));
  ck(Math.abs(calc.base - 1.15) < 1e-6, '★ 基础攻速 ×1.15', calc.base);
  ck(Math.abs(calc.total - 1.38) < 1e-6, '★★ 当前攻速 = 1.15 × 1.2 = ×1.38（词条算进去了）', calc.total);
  ck(Math.abs(calc.interval - 0.62 / 1.38) < 1e-6, '★★ 间隔跟着变（0.45 秒）', calc.interval);

  // ② 上限：+200% 也不能超过 ×2.2
  const capped = JSON.parse(await ev([
    'var w2 = JSON.parse(JSON.stringify(window.__w));',
    'w2.affixes[0].val = 200;',
    'return JSON.stringify({ total: wSpdTotal(w2), interval: wInterval(w2) });',
  ].join('')));
  console.log('  +200% 时: ' + JSON.stringify(capped));
  ck(Math.abs(capped.total - 2.2) < 1e-6, '★★ 攻速封顶 ×2.2（全局上限）', capped.total);

  // ③ 客户端冷却（G.ATK_CD）也用上词条了
  const cd = JSON.parse(await ev([
    'setWeapon(window.__w);',
    'return JSON.stringify({ cd: G.ATK_CD });',
  ].join('')));
  console.log('  G.ATK_CD = ' + cd.cd);
  ck(Math.abs(cd.cd - 0.62 / 1.38) < 1e-6, '★★ 客户端冷却也算词条了（和服务器一致）', cd.cd);

  // ④ 悬停浮窗有基础伤害 / 武器系数 / 基础攻速
  const tip = await ev([
    'var box = document.getElementById("bagTipBox");',
    'box.style.display = "block";',
    'box.innerHTML = bagTipHTML(window.__w, 1, "bag");',
    'return box.textContent;',
  ].join(''));
  for (const k of ['基础伤害', '武器系数', '基础攻速', '当前', '×2.2']) {
    ck(String(tip).indexOf(k) >= 0, '★★ 浮窗里有「' + k + '」', String(tip).slice(0, 80));
  }

  // ⑤ 装备页详情
  await ev('try { openSet(); setTab("equip"); } catch (e) {} return 1;');
  await sleep(700);
  const eq = await ev('var d=document.getElementById("eqDetail"); return d ? d.textContent : "";');
  for (const k of ['基础伤害', '武器系数', '攻速']) {
    ck(String(eq).indexOf(k) >= 0, '★★ 装备页有「' + k + '」', String(eq).slice(0, 80));
  }

  // ⑥ 属性页有「攻速」行 + 上限 ×2.2
  await ev('setTab("stat"); return 1;');
  await sleep(900);
  const stat = await ev('var d=document.getElementById("stTotal"); return d ? d.textContent : "";');
  const has = String(stat).indexOf('攻速') >= 0;
  ck(has, '★★ 属性页有【攻速】一行', String(stat).slice(0, 120));
  ck(/×\s*2\.2/.test(String(stat)) || String(stat).indexOf('上限 ×2.2') >= 0,
    '★★ 属性页写明了攻速上限 ×2.2', String(stat).match(/攻速[^。]{0,40}/));

  const s1 = await send('Page.captureScreenshot', { format: 'png' });
  if (s1 && s1.result && s1.result.data) {
    fs.writeFileSync(path.join(ROOT, 'docs', 'shots', 'stat-atkspd.png'), Buffer.from(s1.result.data, 'base64'));
    console.log('  存 docs/shots/stat-atkspd.png');
  }
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
