// 验收 round472 客户端：发挥度对齐、装备等级=建议等级、防具打折显示
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
  const NM = 'gl' + Math.random().toString(36).slice(2, 8), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: PW }),
  }).then(x => x.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gl-'));
  const port = 4600 + Math.floor(Math.random() * 14);
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
  const lv = await ev('return (WSC.role||{}).level || 1;');
  console.log('  玩家等级: ' + lv);

  // ① 发挥度：和服务器同一公式
  const m = JSON.parse(await ev([
    'return JSON.stringify({',
    '  same: masteryGap(30, 30), gap1: masteryGap(31, 30), gap10: masteryGap(40, 30),',
    '  far: masteryGap(1000, 1) });',
  ].join('')));
  console.log('  发挥度: ' + JSON.stringify(m));
  ck(m.same === 1, '★ 等级够 = 100%', m.same);
  ck(Math.abs(m.gap10 - 0.5) < 0.01, '★★ 差 10 级 = 50%', m.gap10);
  ck(m.far <= 0.02, '★★ 差 999 级 = 2%（地板）', m.far);

  // ② 有效等级：装备等级超过你 → 按你的等级算
  const eff = JSON.parse(await ev([
    'var big = { slot:"weapon", name:"巨剑", tier:11, itemLv:1000, reqLevel:1000, look:"sword",',
    '  base:{coeff:1.1, atkSpeed:1.15, reach:2.4, arc:1.05}, dur:100, durMax:100, affixes:[] };',
    'window.__big = big;',
    'var mine = { slot:"weapon", name:"同级剑", tier:11, itemLv:(WSC.role.level||1), reqLevel:(WSC.role.level||1), look:"sword",',
    '  base:{coeff:1.1, atkSpeed:1.15, reach:2.4, arc:1.05}, dur:100, durMax:100, affixes:[] };',
    'window.__mine = mine;',
    'return JSON.stringify({ effBig: effGearLv(big), effMine: effGearLv(mine),',
    '  flatBig: wFlat(big), flatMine: wFlat(mine),',
    '  mBig: wMastery(big), mMine: wMastery(mine) });',
  ].join('')));
  console.log('  有效等级: ' + JSON.stringify(eff));
  ck(eff.effBig === lv, '★★ 1000 级装备在 1 级身上只按 ' + lv + ' 级算', eff.effBig);
  ck(Math.abs(eff.flatBig - eff.flatMine) < 0.01, '★★ 两者的基础伤害按有效等级相等（不吃高等级低价）', [eff.flatBig, eff.flatMine]);

  // ③ 浮窗：防具显示发挥度警告 + 打折数值
  const tip = await ev([
    'var ar = { slot:"armor", name:"巨甲", tier:11, itemLv:1000, reqLevel:1000, look:"armor",',
    '  base:{dr:3291, hp:42658}, affixes:[], dur:100, durMax:100 };',
    'window.__ar = ar;',
    'var box = document.getElementById("bagTipBox");',
    'box.style.display = "block";',
    'box.innerHTML = bagTipHTML(ar, 1, "bag");',
    'return box.textContent;',
  ].join(''));
  console.log('  防具浮窗: ' + String(tip).replace(/\s+/g, ' ').slice(0, 160));
  ck(String(tip).indexOf('只发挥') >= 0, '★★ 浮窗标出"只发挥 N%"', String(tip).slice(0, 80));
  ck(/减伤\s*[0-9.]+\s*点（满发挥 3291）/.test(String(tip)), '★★ 减伤显示的是打折后的值（不是 3291）', String(tip).match(/减伤[^·]{0,16}/));

  // ④ 装备页也能看到发挥度
  await ev('setWeapon(window.__big); BAG.armor = window.__ar; BAG.weapon = window.__big; try { openSet(); setTab("equip"); } catch (e) {} return 1;');
  await sleep(800);
  const eq = await ev('var d=document.getElementById("eqDetail"); return d ? d.textContent : "";');
  ck(String(eq).indexOf('发挥度') >= 0, '★★ 装备页有发挥度', String(eq).replace(/\s+/g, ' ').slice(0, 80));

  const s1 = await send('Page.captureScreenshot', { format: 'png' });
  if (s1 && s1.result && s1.result.data) {
    fs.writeFileSync(path.join(ROOT, 'docs', 'shots', 'gear-mastery.png'), Buffer.from(s1.result.data, 'base64'));
    console.log('  存 docs/shots/gear-mastery.png');
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
