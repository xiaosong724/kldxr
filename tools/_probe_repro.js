const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NAME = '新人乙';
(async () => {
  const lg = await (await fetch('http://127.0.0.1:8899/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' }) })).json();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx2d-repro-'));
  const port = 10240 + Math.floor(Math.random() * 9);
  const proc = spawn(CHROME, ['--headless', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--hide-scrollbars', '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1000,700', 'http://127.0.0.1:8899/'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
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
  const ev = expr => new Promise(res => {
    const i = ++id; wait[i] = res;
    ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate',
      params: { expression: '(async()=>{' + expr + '})()', awaitPromise: true, returnByValue: true } }));
  });
  await sleep(2500);
  await ev("var b=document.getElementById('btnLogin'); if(b){b.click();} return 1;");
  await sleep(1200);
  // 全新账号（Lv.1）
  await ev("var n=document.getElementById('loginName'); if(n){n.value='" + NAME + "';}" +
           "var p=document.getElementById('loginPass'); if(p){p.value='abc123456';}" +
           "var b=document.getElementById('btnReg'); if(b){b.click();} return 1;");
  await sleep(2800);
  if ((await ev("return (WSC&&WSC.ready)?'y':'n';")).result.result.value !== 'y') {
    await ev("var b=document.getElementById('btnLogin'); if(b){b.click();} return 1;");
    await sleep(2800);
  }
  console.log('  玩家等级 = ' + (await ev("return (WSC.role&&WSC.role.level)||1;")).result.result.value);
  // 发两件：一件 0 阶（能穿）一件 4 阶（要 25 级）
  for (const [k, t] of [['dagger', 0], ['axe', 4]]) {
    const r = await (await fetch('http://127.0.0.1:8899/api/admin/act', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': lg.token },
      body: JSON.stringify({ act: 'give', name: NAME, kind: k, tier: t }) })).json();
    console.log('  发 ' + k + ' ' + t + ' 阶 → ' + JSON.stringify(r.item || r.error));
  }
  await ev("openSet('bag'); return 1;");
  await sleep(1500);
  const items = await ev(
    "var out=[]; for (var i=0;i<BAG.items.length;i++){ var it=BAG.items[i].item;" +
    " if(it.slot!=='weapon') continue;" +
    " out.push({id:BAG.items[i].id, name:it.name, tier:it.tier, itemLv:it.itemLv," +
    " req:it.reqLevel, coeff:it.base.coeff, dmg:Math.round(wDamage(it))}); }" +
    "return JSON.stringify(out);");
  console.log('  背包里的武器: ' + items.result.result.value);
  console.log('  已装备: ' + (await ev("return JSON.stringify(BAG.weapon?{n:BAG.weapon.name,t:BAG.weapon.tier,il:BAG.weapon.itemLv,d:Math.round(wDamage(BAG.weapon))}:null);")).result.result.value);
  // 挨个点一遍（记录服务器回执）
  const seq = await ev(
    "var log=[]; var orig=window.toast; window.toast=function(t){ log.push(String(t)); };" +
    "var sl=document.querySelectorAll('#bagGrid .slot');" +
    "for (var i=0;i<sl.length;i++){" +
    "  var idx=+sl[i].getAttribute('data-i'); var it=(BAG.items[idx]||{}).item;" +
    "  if(!it||it.slot!=='weapon') continue;" +
    "  sl[i].click(); log.push('clicked '+it.name+' (需'+it.reqLevel+'级)'); }" +
    "return JSON.stringify(log);");
  console.log('  点击过程: ' + seq.result.result.value);
  await sleep(2500);
  const after = await ev(
    "var out={ equipped: BAG.weapon?BAG.weapon.name:'(无)'," +
    " eqDmg: BAG.weapon?Math.round(wDamage(BAG.weapon)):0," +
    " panel: (document.getElementById('bagStat').textContent||'').slice(0,80)," +
    " msg: (document.getElementById('bagMsg').textContent||'').slice(0,60)," +
    " toasts: (window.__t||[]).slice(-4) };" +
    "return JSON.stringify(out);");
  console.log('  结果: ' + after.result.result.value);
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
})();
