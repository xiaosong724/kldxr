/* ★★★ 管理页自检脚本（第 137 轮）★★★
 *
 * 为什么单独有这么一个：test_browser.js 覆盖的是【游戏客户端】✗
 *   管理页（admin.html）的 JS 【一直没有自动化覆盖】✗
 *   → 结果第 136 轮我把按钮删了、引用没删干净 ✗
 *     整个 refresh() 一抛异常 → 玩家列表全空 ✗
 *     而我的所有测试都是绿的 ✗✓（因为没人打开管理页 ✓）
 *
 * 这个脚本做什么（★ 真的跑，不是看代码 ✗）：
 *   ① 无头浏览器打开 /admin.html
 *   ② 自动登录
 *   ③ 调 refresh()，数玩家列表行数 / 新控件数量
 *   ④ 检查两个状态标签的文字和颜色类
 *   ⑤ ★ 真的去改一个下拉框，再回读接口确认生效
 *   ⑥ 改回默认，确认能干净取消
 *   ⑦ 点全服按钮，确认状态真的翻转
 *   ⑧ 抓页面上的 JS 异常（这条最关键 ✗ 页面崩了别的都白搭 ✓）
 *
 * 跑法：node tools\check_admin.js
 *   ★ 需要服务器已经起来（8899）✓
 *   ★ 跑完会把测试痕迹清掉（改回默认 ✓）
 */
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx2d-adm2-'));
  const port = 10700 + Math.floor(Math.random() * 9);
  const proc = spawn(CHROME, ['--headless', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1400,900', 'http://127.0.0.1:8899/admin.html'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    await sleep(250);
    try { const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      target = l.find(t => t.type === 'page' && t.webSocketDebuggerUrl); } catch (e) { }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const wait = {}; const errs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errs.push((m.params.args || []).map(a => a.value || a.description).join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      errs.push('EXC: ' + (m.params.exceptionDetails.exception || {}).description);
    }
    if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; }
  };
  ws.send(JSON.stringify({ id: ++id, method: 'Runtime.enable' }));
  const ev = async (expr) => {
    const i = ++id;
    const r = await new Promise(res => { wait[i] = res;
      ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate',
        params: { expression: expr, awaitPromise: true, returnByValue: true } })); });
    if (r.result && r.result.exceptionDetails) return 'ERR ' + r.result.exceptionDetails.text;
    return r.result && r.result.result ? r.result.result.value : null;
  };
  await sleep(1200);
  console.log('  ① doLogin 后：msg = ' + await ev(`(async()=>{
     document.getElementById('pw').value='xiuxian-admin';
     doLogin();
     await new Promise(r=>setTimeout(r,1500));
     var m=document.getElementById('msg');
     return (m? m.textContent : '?') + ' | TOKEN=' + (localStorage.getItem('adminToken')||'(none)').slice(0,8);
  })()`));
  console.log('  ② 手动 refresh 后：rows = ' + await ev(`(async()=>{
     try { refresh(); } catch(e){ return 'refresh ERR '+e.message; }
     await new Promise(r=>setTimeout(r,1200));
     var tr=document.querySelectorAll('#rows tr');
     var s=document.querySelectorAll('#rows select[data-ov]');
     return 'tr='+tr.length+' selects='+s.length;
  })()`));
  console.log('  ③ 状态标签：' + await ev(`(function(){
     var a=document.getElementById('pvpState'), b=document.getElementById('atkState');
     return 'pvp='+(a?a.textContent+'/'+a.className:'无')+' · atk='+(b?b.textContent+'/'+b.className:'无');
  })()`));
  console.log('  ④ 第一个玩家的控件：' + await ev(`(function(){
     var s=document.querySelector('#rows select[data-ov="pvp"]');
     var c=document.querySelector('#rows input[data-cap]');
     if(!s) return '没有 select';
     return 'pvp select: name='+s.getAttribute('data-n')+' 当前值="'+s.value+'" · 上限输入框='+(c?'有':'无');
  })()`));
  console.log('  ⑤ 点一下 PVP=开：' + await ev(`(async()=>{
     var s=document.querySelector('#rows select[data-ov="pvp"]');
     if(!s) return '没有 select';
     var nm=s.getAttribute('data-n'); s.value='1';
     s.dispatchEvent(new Event('change',{bubbles:true}));
     await new Promise(r=>setTimeout(r,1200));
     var r=await fetch('/api/admin/players?page=1&size=20',{headers:{'X-Admin':localStorage.getItem('adminToken')}});
     var j=await r.json();
     var row=(j.players||[]).filter(function(p){return p.name===nm;})[0]||{};
     return nm+' -> ov='+JSON.stringify(row.ov||{})+'  (期望 pvp:true)';
  })()`));
  console.log('  ⑥ 改回默认：' + await ev(`(async()=>{
     var s=document.querySelector('#rows select[data-ov="pvp"]');
     var nm=s.getAttribute('data-n'); s.value='';
     s.dispatchEvent(new Event('change',{bubbles:true}));
     await new Promise(r=>setTimeout(r,1200));
     var r=await fetch('/api/admin/players?page=1&size=20',{headers:{'X-Admin':localStorage.getItem('adminToken')}});
     var j=await r.json();
     var row=(j.players||[]).filter(function(p){return p.name===nm;})[0]||{};
     return nm+' -> ov='+JSON.stringify(row.ov||{})+'  (期望没有 pvp 键)';
  })()`));
  console.log('  ⑦ 全服 PVP 按钮：' + await ev(`(async()=>{
     document.getElementById('btnPvpAll').click();
     await new Promise(r=>setTimeout(r,1000));
     var r=await fetch('/api/admin/players?page=1&size=5',{headers:{'X-Admin':localStorage.getItem('adminToken')}});
     var j=await r.json(); var on=j.mobCaps.pvpAll;
     document.getElementById('btnPvpAllOff').click();
     await new Promise(r=>setTimeout(r,1000));
     var r2=await fetch('/api/admin/players?page=1&size=5',{headers:{'X-Admin':localStorage.getItem('adminToken')}});
     var j2=await r2.json();
     return '开='+on+' → 关='+j2.mobCaps.pvpAll+'  (期望 true → false)';
  })()`));
  if (errs.length) console.log('  ⑧ 页面报错：\n     ' + errs.slice(0, 5).join('\n     '));
  else console.log('  ⑧ 页面无 JS 报错 ✓');
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
})();
