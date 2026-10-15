/* 第 155 轮验收：别人的魔气到底显示不显示（真浏览器 + 两个客户端） */
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const B = 'http://127.0.0.1:8899';

async function login(name) {
  const r = await fetch(B + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, password: 'abc123456' }) });
  let j = await r.json().catch(() => ({}));
  if (!j.token) {
    const r2 = await fetch(B + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, password: 'abc123456' }) });
    j = await r2.json().catch(() => ({}));
  }
  return j.token;
}

function mkClient(tag, token) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx2d-mq' + tag + '-'));
  const port = 10800 + Math.floor(Math.random() * 60);
  const proc = spawn(CHROME, ['--headless', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=900,650', B + '/'], { stdio: 'ignore' });
  return { tag, token, port, proc, ws: null, id: 0, wait: {} };
}

async function attach(c) {
  let target = null;
  for (let i = 0; i < 100 && !target; i++) {
    await sleep(250);
    try {
      const l = await (await fetch('http://127.0.0.1:' + c.port + '/json/list')).json();
      target = l.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) { }
  }
  c.ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => c.ws.onopen = r);
  c.ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && c.wait[m.id]) { c.wait[m.id](m); delete c.wait[m.id]; }
  };
  c.ev = async (expr) => {
    const i = ++c.id;
    const r = await new Promise(res => { c.wait[i] = res;
      c.ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate',
        params: { expression: expr, awaitPromise: true, returnByValue: true } })); });
    if (r.result && r.result.exceptionDetails) return 'ERR ' + r.result.exceptionDetails.text;
    return r.result && r.result.result ? r.result.result.value : null;
  };
  await sleep(1500);
  await c.ev(`(async()=>{try{localStorage.setItem('token','${c.token}');}catch(e){} location.reload(); return 1;})()`);
  await sleep(4500);
}

(async () => {
  const ta = await login('魔气甲');
  const tb = await login('魔气乙');
  console.log('  两个测试号登录：' + (ta ? '甲 ok' : '甲 FAIL') + ' / ' + (tb ? '乙 ok' : '乙 FAIL'));
  const A = mkClient('a', ta), Bc = mkClient('b', tb);
  await attach(A);
  await attach(Bc);
  // 站到一起（安全区外）
  await A.ev('P.x = 200; P.z = 0; return 1;');
  await Bc.ev('P.x = 203; P.z = 0; return 1;');
  await sleep(1500);
  console.log('  甲看到几个别的玩家：' + await A.ev('Object.keys(NET.others).length'));
  console.log('  乙的名字 / 魔气（甲那边存的）：' +
    await A.ev(`(function(){ var o=null; for (var k in NET.others){ if (NET.others[k].name==='魔气乙') o=NET.others[k]; }` +
               ` if(!o) return '没找到乙 ✗ 看到的是: ' + Object.keys(NET.others).map(function(k){return NET.others[k].name;}).join(',');` +
               ` return 'name=' + o.name + ' mq=' + o.mq + ' ui=' + (!!o.ui); })()`));
  // 管理接口给乙设 500
  const tk = await (await fetch(B + '/api/admin/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' }) })).json();
  await fetch(B + '/api/admin/act', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin': tk.token },
    body: JSON.stringify({ act: 'mqset', name: '魔气乙', v: 500 }) });
  await sleep(2000);
  console.log('  === 甲那边（看乙）===');
  console.log('    存到的魔气值：' + await A.ev(
    `(function(){ for (var k in NET.others){ if (NET.others[k].name==='魔气乙') return NET.others[k].mq; } return '没找到乙'; })()`));
  console.log('    头顶那行元素：' + await A.ev(
    `(function(){ var o=null; for (var k in NET.others){ if (NET.others[k].name==='魔气乙') o=NET.others[k]; }` +
    ` if(!o||!o.ui) return 'no ui'; var e=o.ui.mqEl; if(!e) return '没有 mqEl ✗';` +
    ` return '文字="' + e.textContent + '" 颜色=' + e.style.color + ' 显示=' + e.style.display; })()`));
  console.log('    名字那行（应该只有名字 ✓）：' + await A.ev(
    `(function(){ for (var k in NET.others){ if (NET.others[k].name==='魔气乙'){ var o=NET.others[k];` +
    ` return (o.ui && o.ui.name) ? o.ui.name.textContent : '?'; } } return '没找到'; })()`));
  console.log('  === 乙自己那边 ===');
  console.log('    自己头顶魔气行：' + await Bc.ev(
    `(function(){ return (typeof _selfUI !== 'undefined' && _selfUI && _selfUI.mqEl)` +
    ` ? ('文字="' + _selfUI.mqEl.textContent + '"') : ('没有 mqEl ✗ (MY_MQ=' + (typeof MY_MQ!=='undefined'?MY_MQ:'?') + ')'); })()`));
  // 收尾：把乙的魔气清掉
  await fetch(B + '/api/admin/act', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin': tk.token },
    body: JSON.stringify({ act: 'mqset', name: '魔气乙', clear: 1 }) });
  try { spawn('taskkill', ['/PID', String(A.proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { spawn('taskkill', ['/PID', String(Bc.proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
})();
