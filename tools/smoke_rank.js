// round424 客户端冒烟：排行页 + 头顶称号（自己看得见 + 别人看得见）
const { spawn, execFileSync } = require('child_process');
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
function ck(cond, msg, got) {
  if (cond) { console.log('  PASS  ' + msg); }
  else { FAILS++; console.log('  FAIL  ' + msg + (got !== undefined ? ('   got=' + JSON.stringify(got)) : '')); }
}
function py(code) {
  return execFileSync('python', ['-c', code], { cwd: ROOT }).toString().trim();
}

(async () => {
  // ★ 开跑前先清干净（上次残留的 Rk 号会把排名顶掉 ✗）
  py('import sqlite3\nc=sqlite3.connect("server/game.db")\n'
    + 'for r in c.execute("select id from roles where name like \'Rk%\'").fetchall():\n'
    + '    c.execute("delete from role_stats where role_id=?", (r[0],))\n'
    + 'c.execute("delete from roles where name like \'Rk%\'")\n'
    + 'c.execute("delete from accounts where name like \'Rk%\'")\n'
    + 'c.commit()');
  const SFX = Math.random().toString(36).slice(2, 5);
  const NM_A = 'RkA' + SFX, NM_B = 'RkB' + SFX, PW = 'abc123456';
  const regA = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM_A, password: PW }),
  }).then(x => x.json());
  const regB = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM_B, password: PW }),
  }).then(x => x.json());
  ck(!!regA.token && !!regB.token, '注册两个测试号', [regA.error, regB.error]);
  const idA = (regA.role || {}).id, idB = (regB.role || {}).id;
  const adm = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' }),
  }).then(x => x.json());

  // 把 A 顶到 999 级（测试用：直接改库；正式玩法当然不能这样 ✓）
  const mx = parseInt(py('import sqlite3;print(sqlite3.connect("server/game.db")'
    + '.execute("select max(level) from roles").fetchone()[0] or 1)'), 10) || 1;
  py('import sqlite3;c=sqlite3.connect("server/game.db");'
    + 'c.execute("UPDATE roles SET level=? WHERE id=?", (' + (mx + 10) + ', ' + idA + '));c.commit()');
  const forced = await fetch(ORIGIN + '/api/rank?board=level&force=1',
    { headers: { 'X-Admin': adm.token } }).then(x => x.json());
  ck(forced.ok && (forced.rows[0] || {}).name === NM_A,
    '强刷后境界榜第一 = A（最高级+10）', (forced.rows[0] || {}).name);

  // ---------- 浏览器 A ----------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-'));
  const port = 9940 + Math.floor(Math.random() * 40);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=520,900', ORIGIN + '/'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 120 && !target; i++) {
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
  const ev = async x => {
    const r = await send('Runtime.evaluate', { expression: '(function(){' + x + '})()', returnByValue: true, awaitPromise: true });
    if (r && r.result && r.result.exceptionDetails) {
      const ed = r.result.exceptionDetails;
      return '__THROW__ ' + String((ed.exception && ed.exception.description) || ed.text).split(String.fromCharCode(10))[0];
    }
    return r && r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable', {});
  await sleep(1200);
  await ev('localStorage.setItem("token",' + JSON.stringify(regA.token) + '); location.reload(); return 1;');
  await sleep(9000);
  ck((await ev('return !!(WSC.role && WSC.role.name);')) === true, 'A 已进游戏');

  // 打开 设置 → 排行
  await ev('openSet("rank"); return 1;');
  await sleep(1600);
  const view = await ev([
    'var chips = document.querySelectorAll("#rankChips .rchip");',
    'var rows = document.querySelectorAll("#rankList .rrow");',
    'var first = rows[0] ? rows[0].textContent : "";',
    'var firstHtml = rows[0] ? rows[0].innerHTML : "";',
    'var medals = document.querySelectorAll("#rankList .rrow .rk svg");',
    'var meTxt = (document.getElementById("rankMe") || {}).textContent || "";',
    'var pageTxt = (document.getElementById("rankPageTxt") || {}).textContent || "";',
    'return JSON.stringify({ chips: chips.length, rows: rows.length, first: first,',
    '  me: meTxt, page: pageTxt, label: (chips[0] || {}).textContent,',
    '  hasMedalSvg: firstHtml.indexOf("<svg") >= 0, medalCount: medals.length });',
  ].join(''));
  let v = {};
  try { v = JSON.parse(view); } catch (e) { v = {}; }
  console.log('  排行页: ' + view);
  ck(v.chips === 5, '★★ 五个榜的 chip 都在（境界/财富/屠戮/魔气/在线）', v.chips);
  ck(v.rows === 10, '★★ 每页 10 条', v.rows);
  ck(v.hasMedalSvg === true && v.medalCount >= 3,
    '★★ 前三名是【SVG 奖牌】（不是文字牌 ✓）', [v.hasMedalSvg, v.medalCount]);
  ck(String(v.first).indexOf(NM_A) >= 0, '★★ 第一行有 A 的名字', v.first);
  ck(/第 1\/10 页/.test(String(v.page)), '★★ 页码显示「第 1/10 页」', v.page);
  ck(String(v.me).indexOf('#1') >= 0, '★★ 底部「我的名次」= #1', v.me);

  // 翻到第 10 页 + 第 11 页翻不动
  await ev('var b=document.getElementById("rankNext"); b.click(); return 1;');
  await sleep(400);
  for (let i = 0; i < 8; i++) {
    await ev('var b=document.getElementById("rankNext"); if(!b.disabled){b.click();} return 1;');
    await sleep(260);
  }
  const p10 = await ev('return JSON.stringify({page:(document.getElementById("rankPageTxt")||{}).textContent,'
    + 'next:(document.getElementById("rankNext")||{}).disabled,'
    + 'rows:document.querySelectorAll("#rankList .rrow").length});');
  console.log('  翻页后: ' + p10);
  let pj = {};
  try { pj = JSON.parse(p10); } catch (e) { pj = {}; }
  ck(/第 10\/10 页/.test(String(pj.page)), '★★ 能翻到第 10 页', pj.page);
  ck(pj.next === true, '★★ 第 10 页之后「下一页」禁用（只排前 100）', pj.next);

  // 切到魔气榜：两个数值都要在
  await ev('var c=document.querySelectorAll("#rankChips .rchip")[3]; c.click(); return 1;');
  await sleep(1200);
  const mqTxt = await ev('return (document.querySelector("#rankList .rrow")||{}).textContent || "";');
  console.log('  魔气榜首行: ' + mqTxt);
  ck(/击杀/.test(String(mqTxt)) && /魔气/.test(String(mqTxt)),
    '★★ 魔气榜同时显示「击杀 N 人」和「魔气 N」', mqTxt);

  // 回境界榜 + 勾上「头顶显示称号」
  await ev('document.querySelectorAll("#rankChips .rchip")[0].click(); return 1;');
  await sleep(900);
  // ★ 称号选择器：应该是【不显示 + 5 个榜】= 6 个按钮
  const chips = await ev([
    'var box = document.getElementById("rankTitleChips");',
    'if (!box) { return "no box"; }',
    'var els = box.querySelectorAll(".tchip");',
    'return JSON.stringify({ n: els.length,',
    '  labels: Array.prototype.map.call(els, function (e) { return e.textContent; }) });',
  ].join(''));
  console.log('  称号按钮: ' + chips);
  let cj = {};
  try { cj = JSON.parse(chips); } catch (e) { cj = {}; }
  ck(cj.n === 6, '★★ 称号有 6 个选项（不显示 + 五个榜）', cj);
  ck((cj.labels || []).join('|') === '不显示|境界|财富|屠戮|魔气|在线',
    '★★ 五个榜都能选（不再是"只能挂正在看的那一页"）', cj.labels);

  // 先切到「财富」榜再点「财富」→ 称号应该是 国服财富top1
  await ev('document.querySelectorAll("#rankChips .rchip")[1].click(); return 1;');
  await sleep(1200);
  const pickGold = await ev([
    'var els = document.querySelectorAll("#rankTitleChips .tchip");',
    'for (var i = 0; i < els.length; i++) {',
    '  if (els[i].textContent === "财富") { els[i].click(); return "clicked"; }',
    '}',
    'return "not found";',
  ].join(''));
  console.log('  点财富: ' + pickGold);
  await sleep(1400);
  const goldTitle = await ev('return JSON.stringify({ tt: MY_TT, tm: MY_TM, board: (WSC.role||{}).titleBoard });');
  console.log('  财富称号: ' + goldTitle);
  let gj = {};
  try { gj = JSON.parse(goldTitle); } catch (e) { gj = {}; }
  ck(String(gj.tt || '').indexOf('国服财富top') === 0 && gj.board === 'gold',
    '★★★ 换成财富榜 → 称号变「国服财富topN」（证明不是只能选境界）', gj);

  // 切回境界，给后面"别人也看得见"用
  await ev('document.querySelectorAll("#rankChips .rchip")[0].click(); return 1;');
  await sleep(900);
  await ev([
    'var els = document.querySelectorAll("#rankTitleChips .tchip");',
    'for (var i = 0; i < els.length; i++) {',
    '  if (els[i].textContent === "境界") { els[i].click(); break; }',
    '}',
    'return 1;',
  ].join(''));
  await sleep(1400);
  const own = await ev([
    'var el = _selfUI && _selfUI.ttlEl;',
    'return JSON.stringify({ tt: (typeof MY_TT === "string") ? MY_TT : null,',
    '  tm: (typeof MY_TM === "number") ? MY_TM : null,',
    '  shown: !!(el && el.style.display !== "none"),',
    '  text: el ? el.textContent : "",',
    '  svg: !!(el && el.innerHTML.indexOf("<svg") >= 0) });',
  ].join(''));
  console.log('  自己的称号: ' + own);
  let oj = {};
  try { oj = JSON.parse(own); } catch (e) { oj = {}; }
  ck(oj.tt === '国服境界top1' && oj.tm === 1,
    '★★ 自己的称号 = 国服境界top1（奖牌号 1）', oj);
  ck(oj.svg === true && String(oj.text || '').indexOf('国服境界top1') >= 0,
    '★★ 头顶称号前面是【SVG 奖牌】✓', [oj.svg, oj.text]);

  // ---------- 另一个客户端 B（裸 WS）看 A ----------
  const bw = new WebSocket('ws://127.0.0.1:8900/ws');
  await new Promise(r => bw.onopen = r);
  let last = null;
  bw.onmessage = e => { try { last = JSON.parse(e.data); } catch (x) { } };
  bw.send(JSON.stringify({ t: 'hello', d: { token: regB.token, ver: 1 } }));
  await sleep(900);
  let seen = null, seenTm = null;
  for (let i = 0; i < 30 && !seen; i++) {
    await sleep(200);
    if (!last || !last.d || !last.d.players) { continue; }
    const her = last.d.players.find(p => p.id === idA);
    if (her) { seen = her.tt; seenTm = her.tm; }
  }
  console.log('  B 看到 A 的称号: tt=' + JSON.stringify(seen) + ' tm=' + seenTm);
  ck(seen === '国服境界top1' && seenTm === 1, '★★★ 别的玩家屏幕上也能看到（tt/tm 随快照下发）', [seen, seenTm]);

  // 关掉 → B 那边应变成空（点「不显示」）
  await ev([
    'var els = document.querySelectorAll("#rankTitleChips .tchip");',
    'if (els[0]) { els[0].click(); }',
    'return 1;',
  ].join(''));
  await sleep(1300);
  let after = undefined;
  for (let i = 0; i < 25; i++) {
    await sleep(200);
    if (!last || !last.d || !last.d.players) { continue; }
    const her = last.d.players.find(p => p.id === idA);
    after = her ? her.tt : undefined;
    if (after === '') { break; }
  }
  console.log('  关掉后 B 看到: ' + JSON.stringify(after));
  ck(after === '', '★★ 关掉后别人屏幕上也没了（1 秒内）', after);
  try { bw.close(); } catch (e) { }

  // 截图（排行页）
  await ev('openSet("rank"); return 1;');
  await sleep(900);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  if (s && s.result && s.result.data) {
    fs.writeFileSync(path.join(ROOT, 'docs', 'shots', 'r424-rank.png'),
      Buffer.from(s.result.data, 'base64'));
    console.log('  截图: docs/shots/r424-rank.png');
  }
  console.log('  页面异常: ' + (errs.length ? errs.slice(0, 2).join(' | ') : '（无 ✓）'));
  ck(errs.length === 0, '★ 页面 0 异常', errs.slice(0, 2));

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  // 清理账号（★ 走 SQL ✗ 不走管理接口（在线/幽灵删不掉 ✗）✓）
  await sleep(400);
  py('import sqlite3\nc=sqlite3.connect("server/game.db")\n'
    + 'for nm in ("' + NM_A + '","' + NM_B + '"):\n'
    + '    for r in c.execute("select id from roles where name=?", (nm,)).fetchall():\n'
    + '        c.execute("delete from role_stats where role_id=?", (r[0],))\n'
    + '    c.execute("delete from roles where name=?", (nm,))\n'
    + '    c.execute("delete from accounts where name=?", (nm,))\n'
    + 'c.commit()');
  console.log('');
  console.log(FAILS ? ('FAILED: ' + FAILS + ' 条 ✗') : 'ALL PASS ✓');
  process.exit(FAILS ? 1 : 0);
})();
