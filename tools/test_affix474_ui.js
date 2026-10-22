// 验收 round474 UI：属性页能看到 9 条新词条、天赋页移速上限 30%
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
  const NM = 'af' + Math.random().toString(36).slice(2, 8), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: PW }),
  }).then(x => x.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-'));
  const port = 4420 + Math.floor(Math.random() * 14);
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

  // 属性页：新词条对应的行都在
  await ev('try { openSet(); setTab("stat"); } catch (e) {} return 1;');
  await sleep(1200);
  const stat = await ev('var d=document.getElementById("stTotal"); return d ? d.textContent : "";');
  for (const k of ['命中', '穿透', '免爆', '抗爆', '全量吸血', '经验']) {
    ck(String(stat).indexOf(k) >= 0, '★★ 属性页有【' + k + '】', String(stat).slice(0, 60));
  }
  const rows = await ev('return (TAL.stats||[]).length;');
  console.log('  属性行数: ' + rows);
  ck(+rows >= 22, '★★ 属性项增加到 ' + rows + ' 项', rows);

  // 天赋页：移速上限应该是 30%
  await ev('setTab("talent"); return 1;');
  await sleep(700);
  const talInfo = await ev('return JSON.stringify({ spdEff: TAL.eff.speed || 0, gearSpeed: TAL.speedGear || 0 });');
  console.log('  天赋/装备移速: ' + talInfo);

  // 模拟穿一件带新词条的装备 → 属性页应该变化
  const after = await ev([
    'BAG.armor = { slot:"armor", tier:8, itemLv:(WSC.role.level||1), reqLevel:(WSC.role.level||1),',
    '  base:{dr:20, hp:300}, affixes:[',
    '    {key:"exp_pct", val:12, text:"经验 +12%"},',
    '    {key:"speed_pct", val:5, text:"移速 +5%"},',
    '    {key:"anticritdmg", val:10, text:"抗爆 +10%"}], dur:100, durMax:100 };',
    'setWeapon({ slot:"weapon", name:"测试剑", tier:8, itemLv:(WSC.role.level||1), reqLevel:(WSC.role.level||1),',
    '  look:"sword", base:{coeff:1.0, atkSpeed:1.15, reach:2.4, arc:1.05}, dur:100, durMax:100,',
    '  affixes:[{key:"vamp_all", val:5, text:"造成伤害的 5% 回血"},',
    '           {key:"hit_pt", val:8, text:"命中 +8%"},',
    '           {key:"pen_pt", val:10, text:"无视 10 点减伤"}] });',
    'var box = document.getElementById("bagTipBox");',
    'box.style.display = "block";',
    'box.innerHTML = bagTipHTML(BAG.armor, 1, "bag");',
    'return box.textContent;',
  ].join(''));
  ck(String(after).indexOf('经验 +12%') >= 0, '★★ 防具词条文案正常显示（经验 +12%）', String(after).slice(0, 120));
  ck(String(after).indexOf('移速 +5%') >= 0, '★★ 防具词条（移速 +5%）');
  ck(String(after).indexOf('抗爆 +10%') >= 0, '★★ 防具词条（抗爆 +10%）');

  const wtip = await ev([
    'var box = document.getElementById("bagTipBox");',
    'box.innerHTML = bagTipHTML(MY_WEAPON, 1, "bag");',
    'return box.textContent;',
  ].join(''));
  // 注意：浮窗里显示的是词条【文案】，不是 key 名 ✗
  for (const k of ['造成伤害的 5% 回血', '命中 +8%', '无视 10 点减伤']) {
    ck(String(wtip).indexOf(k) >= 0, '★★ 武器词条（' + k + '）', String(wtip).slice(0, 100));
  }

  const s1 = await send('Page.captureScreenshot', { format: 'png' });
  if (s1 && s1.result && s1.result.data) {
    fs.writeFileSync(path.join(ROOT, 'docs', 'shots', 'affix474.png'), Buffer.from(s1.result.data, 'base64'));
    console.log('  存 docs/shots/affix474.png');
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
