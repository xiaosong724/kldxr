// 验这轮新加的两件：滑动多选 + 一键整理（真浏览器 ✓ 几十秒）
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'];
const B = CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const NL = String.fromCharCode(10);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PW = 'abc123456';
let fails = 0;
const ok = (c, m) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) { fails++; } };

async function api(p, body, token, admin) {
  const h = { 'Content-Type': 'application/json' };
  if (token) { h['X-Token'] = token; }
  if (admin) { h['X-Admin'] = admin; }
  const r = await fetch(ORIGIN + p, { method: body ? 'POST' : 'GET', headers: h, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}

(async function () {
  const NAME = 'UIsort' + Math.random().toString(36).slice(2, 5);
  const at = (await api('/api/admin/login', { password: 'xiuxian-admin' })).token;
  const reg = await api('/api/register', { name: NAME, password: PW });
  const tok = reg.token;
  for (const t of [1, 5, 3]) { await api('/api/admin/act', { act: 'give', name: NAME, kind: 'sword', tier: t }, null, at); }
  await api('/api/admin/act', { act: 'give', name: NAME, kind: 'material', count: 4, pick: 3 }, null, at);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx2d-ui-'));
  const port = 9441;
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=520,880', ORIGIN + '/'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 60 && !t; i++) {
    await sleep(300);
    try {
      const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      t = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
    } catch (e) { }
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const w = {}; const errs = [];
  ws.onmessage = e => {
    let m; try { m = JSON.parse(e.data); } catch (x) { return; }
    if (m.id && w[m.id]) { w[m.id](m); delete w[m.id]; return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params && m.params.exceptionDetails;
      errs.push(String((d && d.exception && d.exception.description) || (d && d.text) || '?'));
    }
  };
  const send = (m, p) => new Promise(res => {
    const id = ++seq; w[id] = res;
    ws.send(JSON.stringify({ id, method: m, params: p || {} }));
    setTimeout(() => { if (w[id]) { delete w[id]; res(null); } }, 15000);
  });
  const ev = async x => {
    const r = await send('Runtime.evaluate', { expression: '(function(){' + x + '})()', returnByValue: true });
    if (r && r.result && r.result.exceptionDetails) { return '__THROW__ ' + r.result.exceptionDetails.text; }
    return r && r.result && r.result.result ? r.result.result.value : undefined;
  };
  const clickTab = async (name) => {
    const sel = '#setTabs .tab[data-tab=' + name + ']';
    await ev('var e=document.querySelector(' + JSON.stringify(sel) + '); if(e){e.click();} return 1;');
    await sleep(800);
    return ev('return (typeof SETCFG!=="undefined")?SETCFG.setTab:null;');
  };
  const move = async (x, y, type) => {
    await send('Input.dispatchMouseEvent', { type: type || 'mouseMoved', x, y, button: 'left',
      buttons: type === 'mouseMoved' ? 1 : (type === 'mousePressed' ? 1 : 0), clickCount: 1 });
  };

  await send('Runtime.enable', {});
  await sleep(1000);
  await ev('localStorage.setItem("token",' + JSON.stringify(tok) + '); location.reload(); return 1;');
  await sleep(6000);
  ok((await ev('return (typeof WSC!=="undefined") && WSC.ready;')) === true, 'logged in and connected');
  /* ★ 引导页不是 display:none 隐藏的 ✗ 是靠 b._gone 标记（bootDone 里设的 ✓）
     ★ 自测踩到：我按 display 断言 ✗ 那是写错了 ✓
       正确判据 = "进游戏了没有" ✗ 用登录框消失 + WSC 就绪 ✓ */
  /* ★ 引导页是【整个从 DOM 移除】的（bootDone 里 removeChild ✓）
     ✗ 所以"元素不存在"才是正确表现 ✓
     ★ 我连着写错两次判据（先按 display ✗ 再按 _gone ✓）
       —— 都是"没先看它到底怎么消失的"✓ 记一下 ✓ */
  const bootState = JSON.parse(await ev(
    'var b = document.getElementById("boot");' +
    'var lg = document.getElementById("login");' +
    'return JSON.stringify({ stillThere: !!b,' +
    '  loginShown: lg ? lg.className.indexOf("show") >= 0 : null });'));
  console.log('   boot state: ' + JSON.stringify(bootState));
  ok(bootState.stillThere === false, 'the loading screen was removed (bootDone ran)');
  ok(bootState.loginShown === false, 'and the login box is hidden');

  // ---- 背包：5 件（3 剑 + 1 材料堆）
  console.log(NL + '== 滑动多选 ==');
  console.log('   tab -> ' + (await clickTab('bag')));
  await ev('openSet("bag"); bagFetch(bagRender); return 1;');
  await sleep(1800);
  ok((await ev('return (BAG.items||[]).length;')) >= 4, 'bag has items');
  // 进批量模式
  await ev('document.getElementById("bagPick").click(); return 1;');
  await sleep(600);
  ok((await ev('return BAG.multi === true;')) === true, 'batch mode is on');
  // 按住第一格，划过后三格
  const pos = JSON.parse(await ev([
    'var ss = document.querySelectorAll("#bagGrid .slot[data-id]");',
    'var out = [];',
    'for (var i = 0; i < Math.min(4, ss.length); i++) {',
    '  var r = ss[i].getBoundingClientRect();',
    '  out.push([Math.round(r.left + r.width/2), Math.round(r.top + r.height/2)]);',
    '}',
    'return JSON.stringify(out);'
  ].join(NL)));
  ok(pos.length >= 4, 'found 4 slots to drag across (' + pos.length + ')');
  await move(pos[0][0], pos[0][1], 'mousePressed');
  await sleep(120);
  for (let i = 1; i < 4; i++) { await move(pos[i][0], pos[i][1], 'mouseMoved'); await sleep(120); }
  await move(pos[3][0], pos[3][1], 'mouseReleased');
  await sleep(800);
  const picked = await ev('return (BAG.pick||[]).length;');
  console.log('   picked by dragging: ' + picked);
  ok(picked === 4, 'dragging across four slots selected all four (got ' + picked + ')');
  await ev('document.getElementById("bagPick").click(); return 1;');   // 退出批量
  await sleep(500);

  // ---- 一键整理
  console.log(NL + '== 一键整理 ==');
  const before = await ev('return JSON.stringify((BAG.items||[]).map(function(x){return x.item.name;}));');
  console.log('   before: ' + before);
  await ev('document.getElementById("bagSort").click(); return 1;');
  await sleep(4000);
  const after = await ev('return JSON.stringify((BAG.items||[]).map(function(x){return x.item.name + "|" + (x.item.tier||0) + "|" + (x.item.slot||"mat");}));');
  console.log('   after : ' + after);
  const list = JSON.parse(after || '[]');
  const cat = s => (s === 'weapon' ? 0 : (s === 'armor' ? 1 : 2));
  const parts = list.map(x => x.split('|'));
  const keys = parts.map(p => [cat(p[2]), -parseInt(p[1], 10)]);
  let sorted = true;
  for (let i = 1; i < keys.length; i++) {
    if (keys[i][0] < keys[i - 1][0]) { sorted = false; }
    if (keys[i][0] === keys[i - 1][0] && keys[i][1] < keys[i - 1][1]) { sorted = false; }
  }
  ok(list.length >= 4, 'bag still has its items after sorting (' + list.length + ')');
  ok(sorted, 'weapons first, and higher tiers before lower ones');
  ok(errs.length === 0, 'no page errors' + (errs.length ? (': ' + errs.slice(0, 3).join(' | ')) : ''));

  /* ★ 自测踩到：清理必须在【关掉浏览器之后】✗
     服务端只删【离线的】角色（在线的一律拒绝 ✓ 他还在玩 ✓）
     → 我原来先清理再关浏览器 ✗ 每次都被 skipped ✓ 留下垃圾角色 ✓ */
  console.log(NL + 'FAILED: ' + fails);
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  await sleep(2500);                       /* 等服务端把断线处理完 ✓ */
  /* ★ 再踩一次：等 2.5 秒还不够 ✗ 服务端那张"谁在线"的快照更新得慢 ✓
     → 改用【批量删测试号】（按名字前缀匹配 ✗ 服务端自己的 test_name_keys ✓）
       并且重试几次 ✗ 直到那个名字真的没了 ✓
     ★ 判据必须是"库里查不到"✗ 不是"接口说 ok"✓（接口会 skipped 还回 ok:true ✓） */
  let still = 1;
  for (let i = 0; i < 6 && still; i++) {
    await api('/api/admin/act', { act: 'delplayer', name: NAME }, null, at);
    await api('/api/admin/act', { act: 'delTest' }, null, at);
    await sleep(1500);
    const left = await api('/api/admin/players', null, null, at);
    still = (left.players || []).filter(x => x.name === NAME).length;
  }
  console.log('cleanup -> leftover: ' + still);
  process.exitCode = fails ? 1 : 0;
})();
