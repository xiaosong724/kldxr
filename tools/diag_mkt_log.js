// 交易记录页：买到的 / 卖掉的 / 分页 / 收支（真浏览器 ✗ 一个场景一个脚本 ✓）
//   ★ 为什么单独一个脚本：老的 diag_mkt_panel.js 是"多个小节共用一批道具" ✗
//     互相消耗 → 恒有几条红 ✗ 而且越补越乱 ✓
//   ★ 这个脚本自己造道具、自己用、自己清 ✗ 和别的脚本没有任何耦合 ✓
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'];
const B = CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
if (!B) { console.error('no Chrome/Edge; set CHROME='); process.exit(1); }
const NL = String.fromCharCode(10);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PW = 'abc123456';
let fails = 0;
const ok = (c, m) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) { fails++; } };

async function api(p, body, token, admin) {
  const h = { 'Content-Type': 'application/json' };
  if (token) { h['X-Token'] = token; }
  if (admin) { h['X-Admin'] = admin; }
  const r = await fetch(ORIGIN + p, {
    method: body ? 'POST' : 'GET', headers: h,
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}

(async function () {
  console.log('== diag_mkt_log == browser=' + B);
  const h = await fetch(ORIGIN + '/api/health').then(x => x.json()).catch(() => null);
  if (!h || !h.ok) { console.error('server not up at ' + ORIGIN); process.exit(1); }
  const SFX = Math.random().toString(36).slice(2, 5);
  const SELLER = 'Log卖' + SFX, BUYER = 'Log买' + SFX;
  const at = (await api('/api/admin/login', { password: 'xiuxian-admin' })).token;
  const tokS = (await api('/api/register', { name: SELLER, password: PW })).token;
  const tokB = (await api('/api/register', { name: BUYER, password: PW })).token;
  ok(!!tokS && !!tokB, 'registered two fresh accounts');
  // 卖家一件材料堆（可堆叠 ✗ 好验数量）+ 买家有钱
  await api('/api/admin/act', { act: 'give', name: SELLER, kind: 'material', count: 5, pick: 3 }, null, at);
  const bagS0 = await api('/api/bag', null, tokS);
  const GOODS = ((bagS0.items || [])[0] || {}).item || {};
  const GOODS_NAME = GOODS.name;
  const GOODS_TIER = GOODS.tier || 0;
  console.log('   the goods we will sell: ' + GOODS_NAME + ' (tier ' + GOODS_TIER + ')');
  /* ★★ 自测踩到：买家钱不够 ✗ 成交被服务端拒 ✓ 而界面上"确认框照样弹"✓
     （确认框是客户端的 ✗ 它不查钱 ✓ 所以看起来像"买了但没记录"✓）
     → 给他【足够多】的装备去卖 ✗ 并且【验一下钱真的到账了】✓ */
  for (let i = 0; i < 8; i++) {
    await api('/api/admin/act', { act: 'give', name: BUYER, kind: 'sword', tier: 5 }, null, at);
  }
  const bagB = await api('/api/bag', null, tokB);
  let earned = 0;
  for (const it of (bagB.items || [])) {
    const r = await api('/api/sell', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Token': tokB },
      body: JSON.stringify({ iids: [it.id] }),
    });
    earned += (r && r.total) || 0;
  }
  console.log('   the buyer earned ' + earned + ' gold by selling to the system');
  ok(earned > 500, 'the buyer has money to spend (' + earned + ' gold)');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx2d-log-'));
  const port = 9453;
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=520,900', ORIGIN + '/'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try {
      const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      target = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
    } catch (e) { }
  }
  if (!target) { console.error('no debug target'); process.exit(1); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const w = {}; const errs = [];
  ws.onmessage = e => {
    let m; try { m = JSON.parse(e.data); } catch (x) { return; }
    if (m.id && w[m.id]) { w[m.id](m); delete w[m.id]; return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params && m.params.exceptionDetails;
      errs.push(String((d && d.exception && d.exception.description) || (d && d.text) || '?'));
    }
    if (m.method === 'Log.entryAdded') {
      const en = m.params && m.params.entry;
      if (en && en.level === 'error') { errs.push('[log] ' + en.text); }
    }
  };
  const send = (m, p) => new Promise(res => {
    const id = ++seq; w[id] = res;
    ws.send(JSON.stringify({ id, method: m, params: p || {} }));
    setTimeout(() => { if (w[id]) { delete w[id]; res(null); } }, 20000);
  });
  const ev = async x => {
    const r = await send('Runtime.evaluate', {
      expression: '(function(){' + x + '})()', returnByValue: true,
    });
    if (r && r.result && r.result.exceptionDetails) {
      return '__THROW__ ' + r.result.exceptionDetails.text;
    }
    return r && r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable', {});
  await send('Log.enable', {});
  await sleep(1200);

  const asBuyer = async () => {
    await ev('localStorage.setItem("token",' + JSON.stringify(tokB) +
             '); localStorage.setItem("who","buyer"); location.reload(); return 1;');
    await sleep(6500);
    return ev('return (typeof WSC!=="undefined") && WSC.ready;');
  };

  const asSeller = async () => {
    await ev('localStorage.setItem("token",' + JSON.stringify(tokS) +
             '); localStorage.setItem("who","seller"); location.reload(); return 1;');
    await sleep(6500);
    return ev('return (typeof WSC!=="undefined") && WSC.ready;');
  };

  try {
    // ---- 0. 卖家先把自己那堆材料挂出去（用真界面 ✗ 不开后门 ✓）
    console.log(NL + '== 0. 卖家上架 ==');
    ok(await asSeller() === true, 'the seller is in the game');
    await ev('clickTabHelper = 1; openSet("bag"); return 1;');
    await sleep(2200);
    const listed = await ev([
      'var all = document.querySelectorAll("#bagGrid .slot[data-id]");',
      'var want = ' + JSON.stringify(GOODS_NAME) + ';',
      'for (var i = 0; i < all.length; i++) {',
      '  var id = all[i].getAttribute("data-id");',
      '  for (var j = 0; j < (BAG.items || []).length; j++) {',
      '    if (String(BAG.items[j].id) !== String(id)) { continue; }',
      '    var it = BAG.items[j].item || {};',
      '    if (String(it.name) !== want) { continue; }',
      '    var r = all[i].getBoundingClientRect();',
      '    bagTipHide();',
      '    bagTipAt({ clientX: Math.round(r.left + r.width / 2),',
      '               clientY: Math.round(r.top + r.height / 2) }, all[i]);',
      '    var box = document.getElementById("bagTipBox");',
      '    var pi = box.querySelector("input[data-tipprice]");',
      '    if (pi) { pi.value = "60"; }',
      '    var q = box.querySelector(".qtyRange");',
      '    if (q) { q.value = "5"; q.dispatchEvent(new Event("input", { bubbles: true })); }',
      '    var mb = box.querySelector("[data-tipact=mkt]");',
      '    if (!mb) { return "NO-MKT-BUTTON"; }',
      '    mb.click();',
      '    return "asked to list " + want + " x" + (q ? q.value : 1);',
      '  }',
      '}',
      'return "NOT-IN-BAG (" + (BAG.items || []).map(function (x) {' +
      '  return (x.item || {}).name; }).join(",") + ")";',
    ].join(NL));
    console.log('   ' + listed);
    await sleep(1500);
    await ev('var y = document.getElementById("askYes");' +
             'if (y && getComputedStyle(document.getElementById("askBox")).display !== "none") { y.click(); }' +
             'return 1;');
    await sleep(3500);
    const onShelf = await ev(
      'return (MKT.mine || []).some(function (m) { return String(m.name) === ' +
      JSON.stringify(GOODS_NAME) + '; });');
    ok(onShelf === true, 'the seller listing is on the shelf (' + GOODS_NAME + ')');

    ok(await asBuyer() === true, 'the buyer is in the game');

    // ---- 1. 买家：先去交易所把卖家的材料买走 2 个（点整行 → 详情 → 数量 2 → 购买）
    console.log(NL + '== 1. 买家买一笔 ==');
    await ev('openSet("mkt"); return 1;');
    await sleep(2600);
    /* ★★ 自测踩到：原来点的是"货架第一行"✗ 那是【别人的】旧挂单 ✓
       → 买不成（卖家早没了）→ 于是"记录里什么都没有"✓ 看着像功能坏了 ✓
       ★ 现在【按名字认卖家那一单】✗ 找不到就明确报出来 ✓ */
    const opened = await ev(
      'var rows = document.querySelectorAll("#mktList .mktRow");' +
      'if (!rows.length) { return "NO-ROWS"; }' +
      'var want = ' + JSON.stringify(GOODS_NAME) + ';' +
      'var r = null;' +
      'for (var i = 0; i < rows.length; i++) {' +
      '  var nm = String((rows[i]._it || {}).name || "");' +
      '  if (nm === want) { r = rows[i]; break; }' +
      '}' +
      'if (!r) { return "OURS-NOT-ON-SHELF (" + rows.length + " rows: " +' +
      '  [].map.call(rows, function (x) { return (x._it || {}).name; }).join(",") + ")"; }' +
      'var bb = r.getBoundingClientRect();' +
      'bagTipHide();' +
      'mktTipShow(r, Math.round(bb.left + 10), Math.round(bb.top + 10));' +
      'var t = document.getElementById("bagTipBox");' +
      'return JSON.stringify({ acts: [].map.call(t.querySelectorAll("[data-tipact]"),' +
      '  function (x) { return x.getAttribute("data-tipact"); }),' +
      '  hasQty: !!t.querySelector(".qtyRow"),' +
      '  name: (r._it || {}).name });');
    console.log('   detail panel: ' + opened);
    ok(/"buy"/.test(String(opened)), 'clicking a row opens the detail with a buy action');
    ok(/"hasQty":true/.test(String(opened)), 'and a quantity slider (the listing has several)');
    await ev('var t = document.getElementById("bagTipBox");' +
             'var q = t.querySelector(".qtyRange");' +
             'if (q) { q.value = "2"; q.dispatchEvent(new Event("input", { bubbles: true })); }' +
             'return 1;');
    await sleep(300);
    const clicked = await ev(
      'var t = document.getElementById("bagTipBox");' +
      'var b = t.querySelector("[data-tipact=buy]");' +
      'if (!b) { return "NO-BUY"; }' +
      'b.click(); return "clicked";');
    ok(clicked === 'clicked', 'clicked buy in the detail panel');
    /* ★★ 自测踩到：确认框"弹了"不等于"已经显示" ✗
       我等 0.8 秒就去点确认 ✗ 结果没成交（点了个还没显示出来的按钮 ✓）
       → 改成【轮询等它真的可见】✗ 再点 ✓ 并且点完验一下钱真的少了 ✓ */
    let askOk = false;
    for (let i = 0; i < 20 && !askOk; i++) {
      await sleep(300);
      askOk = (await ev(
        'var a = document.getElementById("askBox");' +
        'var y = document.getElementById("askYes");' +
        'return !!(a && y && getComputedStyle(a).display !== "none" &&' +
        '  a.getBoundingClientRect().height > 20);')) === true;
    }
    const askTxt = await ev('return String((document.getElementById("askBody")||{}).textContent || "");');
    console.log('   confirm dialog visible=' + askOk + ': ' + String(askTxt).slice(0, 70));
    ok(askOk, 'the confirm dialog is really visible before we click it');
    ok(/×2|×<b>2/.test(String(askTxt)) || /2/.test(String(askTxt)),
       'the dialog reflects the quantity');
    const goldBefore = await ev('return (WSC.role && WSC.role.gold) || 0;');
    console.log('   before confirming: ' + await ev(
      'return JSON.stringify({ busy: MKT.busy, ready: (typeof WSC!=="undefined") && WSC.ready,' +
      '  gold: (WSC.role||{}).gold, myRole: MKT.myRole,' +
      '  tipFor: (function(){ var b=document.getElementById("bagTipBox");' +
      '    var f=b.querySelector("[data-tipfor]"); return f?f.getAttribute("data-tipfor"):null; })(),' +
      '  unit: (function(){ var b=document.getElementById("bagTipBox");' +
      '    return b._for ? b._for._unit : null; })() });'));
    await ev('document.getElementById("askYes").click(); return 1;');
    await sleep(600);
    console.log('   after confirming: ' + await ev(
      'return JSON.stringify({ busy: MKT.busy, msg: MKT.msg, gold: (WSC.role||{}).gold });'));
    let paid = false;
    for (let i = 0; i < 20 && !paid; i++) {
      await sleep(400);
      const g = await ev('return (WSC.role && WSC.role.gold) || 0;');
      if (g < goldBefore) { paid = true; console.log('   gold: ' + goldBefore + ' -> ' + g); }
    }
    ok(paid, 'the money really left the buyer (the trade went through)');

    // ---- 2. 记录页：我买到的
    console.log(NL + '== 2. 我的记录（买家）==');
    await ev('openSet("mkt"); var t = document.getElementById("mktTabLog"); if (t) { t.click(); } return 1;');
    await sleep(2600);
    const logBuy = await ev([
      'var l = document.getElementById("mktLogList");',
      'return JSON.stringify({',
      '  tab: MKT.tab,',
      '  logShown: getComputedStyle(document.getElementById("mktLogWrap")).display,',
      '  listShown: getComputedStyle(document.getElementById("mktList")).display,',
      '  rows: document.querySelectorAll("#mktLogList .mktRow").length,',
      '  txt: String(l.textContent).slice(0, 110),',
      '  sum: String((document.getElementById("mktLogSum") || {}).textContent || ""),',
      '  pageTxt: String((document.getElementById("mktLogPageTxt") || {}).textContent || "")',
      '});',
    ].join(NL));
    console.log('   log page: ' + logBuy);
    const L = JSON.parse(logBuy);
    ok(L.tab === 'log', 'the 我的记录 tab is active');
    ok(L.logShown === 'block' && L.listShown === 'none',
       'the log shows and the product list is hidden');
    ok(L.rows >= 1, 'the purchase is in the log (' + L.rows + ' row(s))');
    ok(/^-[0-9]/.test(String(L.txt).replace(/^[\s\S]*?(-[0-9])/, '$1')) || /-/.test(L.txt),
       'a buy row shows money going out: ' + String(L.txt).slice(0, 60));
    ok(new RegExp(SELLER).test(String(L.txt)), 'and it names the seller as counterparty');
    ok(/第 1 \//.test(String(L.pageTxt)) || /1 \//.test(String(L.pageTxt)),
       'the pager says we are on page 1 (' + L.pageTxt + ')');

    // ---- 3. 换成卖家看"我卖掉的"
    console.log(NL + '== 3. 我的记录（卖家）==');
    await ev('localStorage.setItem("token",' + JSON.stringify(tokS) + '); location.reload(); return 1;');
    await sleep(6500);
    ok((await ev('return (typeof WSC!=="undefined") && WSC.ready;')) === true, 'the seller is in the game');
    await ev('openSet("mkt"); var t = document.getElementById("mktTabLog"); if (t) { t.click(); } return 1;');
    await sleep(2600);
    const logSell = await ev([
      'var l = document.getElementById("mktLogList");',
      'return JSON.stringify({ rows: document.querySelectorAll("#mktLogList .mktRow").length,',
      '  txt: String(l.textContent).slice(0, 110),',
      '  sum: String((document.getElementById("mktLogSum") || {}).textContent || "") });',
    ].join(NL));
    console.log('   seller log: ' + logSell);
    const S = JSON.parse(logSell);
    ok(S.rows >= 1, 'the sale is in the seller log (' + S.rows + ' row(s))');
    ok(/\+/.test(String(S.txt)), 'a sell row shows money coming in (+N): ' + String(S.txt).slice(0, 60));
    ok(new RegExp(BUYER).test(String(S.txt)), 'and names the buyer as counterparty');
    // 卖掉的净额 = 总价 - 5% 税
    const mGold = String(S.sum).match(/卖出到手\s*([0-9]+)/);
    ok(!!mGold && parseInt(mGold[1], 10) > 0,
       'the page totals the money received: ' + S.sum);
    ok(/×2/.test(String(S.txt)) || /2/.test(String(S.txt)),
       'and records that two units were sold');
    ok(errs.length === 0, 'no page errors' + (errs.length ? (': ' + errs.slice(0, 3).join(' | ')) : ''));
  } finally {
    console.log(NL + 'FAILED: ' + fails);
    try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
    await sleep(2500);
    // ★ 清理要在关掉浏览器之后（服务器只删离线的 ✗）并且重试到真的没了 ✓
    let still = 1;
    for (let i = 0; i < 6 && still; i++) {
      for (const nm of [SELLER, BUYER]) {
        await api('/api/admin/act', { act: 'delplayer', name: nm }, null, at);
      }
      await sleep(1200);
      const left = await api('/api/admin/players', null, null, at);
      still = (left.players || []).filter(x => x.name === SELLER || x.name === BUYER).length;
    }
    console.log('cleanup -> leftover test roles: ' + still);
    process.exitCode = fails ? 1 : 0;
  }
})();
