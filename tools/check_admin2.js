/* ★★★ 管理页自检 · 第二组："自动刷新会不会打断我改东西"（第 138 轮）★★★
 *
 * 用户报："玩家列表是不是在一直刷新，这样我没办法改"
 *   → 真问题 ✗ 刷新定时器每 1.5 秒重建一次列表 ✗
 *     你正在选的下拉框下一秒就被重建掉 ✗
 *
 * 这个脚本验的就是这件事（★ 关键手法：给元素打一个记号 ✗
 *   元素被重画 → 记号就没了 ✓ 所以记号在 = 没被重画 ✓）
 *
 * 跑法：node tools\check_admin2.js（需要服务器已经起来）
 */
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx2d-adm3-'));
  const port = 10710 + Math.floor(Math.random() * 9);
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
    if (m.method === 'Runtime.exceptionThrown') {
      errs.push('EXC: ' + ((m.params.exceptionDetails.exception || {}).description || '').split('\n')[0]);
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
  await ev(`(async()=>{document.getElementById('pw').value='xiuxian-admin';doLogin();
     await new Promise(r=>setTimeout(r,1500));refresh();
     await new Promise(r=>setTimeout(r,1200));return 1;})()`);
  console.log('  基线：' + await ev(`document.querySelectorAll('#rows select[data-ov]').length + ' 个控件'`));

  // ★ 关键测试：选中一个下拉框（聚焦）→ 给它打个记号 → 等 5 秒（自动刷新本该跑 1~2 次）
  console.log('  ① 聚焦列表里的下拉框，等 5 秒（自动刷新本该跑 1~2 轮）：');
  console.log('     ' + await ev(`(async()=>{
     var s = document.querySelector('#rows select[data-ov="pvp"]');
     s._myMark = 'ALIVE';                 // ★ 打个记号 ✓ 被重画就会消失
     s.focus();
     var before = document.querySelectorAll('#rows tr').length;
     await new Promise(r=>setTimeout(r,5000));
     var s2 = document.querySelector('#rows select[data-ov="pvp"]');
     return 'busyInList=' + busyInList() +
       ' · 记号还在吗=' + (s2 && s2._myMark === 'ALIVE' ? '还在 ✓（没被重画）' : '没了 ✗（被重画了）') +
       ' · 行数 ' + before + ' → ' + document.querySelectorAll('#rows tr').length;
  })()`));

  // ② 取消聚焦 → 应该恢复自动刷新（记号的元素被换掉 = 刷新恢复了 ✓）
  console.log('  ② 取消聚焦（按 Esc/点空白），再等 5 秒：');
  console.log('     ' + await ev(`(async()=>{
     document.activeElement && document.activeElement.blur();
     window._rowsHover = false;
     await new Promise(r=>setTimeout(r,5000));
     var s2 = document.querySelector('#rows select[data-ov="pvp"]');
     return 'busyInList=' + busyInList() +
       ' · 记号=' + (s2 && s2._myMark === 'ALIVE' ? '还在（没刷新 ✗）' : '没了 ✓（刷新恢复了 ✓）');
  })()`));

  // ③ 刷新恢复后，控件还在吗（别刷着刷着把新控件刷没了 ✗）
  console.log('  ③ 刷新恢复后控件是否完好：' + await ev(`(function(){
     return 'selects=' + document.querySelectorAll('#rows select[data-ov]').length +
       ' caps=' + document.querySelectorAll('#rows input[data-cap]').length +
       ' setBtns=' + document.querySelectorAll('#rows [data-capset]').length +
       ' 状态标签=' + (document.getElementById('pvpState')||{}).textContent;
  })()`));

  // ④ 能不能真的改（模拟用户完整操作：聚焦 → 选值 → 触发 change）
  console.log('  ④ 模拟一次完整修改（聚焦 → 选"开" → change）：');
  console.log('     ' + await ev(`(async()=>{
     var s = document.querySelector('#rows select[data-ov="pvp"]');
     var nm = s.getAttribute('data-n');
     s.focus(); s.value = '1';
     s.dispatchEvent(new Event('change', {bubbles:true}));
     await new Promise(r=>setTimeout(r,1500));
     var r = await fetch('/api/admin/players?page=1&size=20',
       {headers:{'X-Admin':localStorage.getItem('adminToken')}});
     var j = await r.json();
     var row = (j.players||[]).filter(function(p){return p.name===nm;})[0]||{};
     // 收尾：改回默认
     var s2 = document.querySelector('#rows select[data-ov="pvp"]');
     if (s2) { s2.value=''; s2.dispatchEvent(new Event('change',{bubbles:true})); }
     await new Promise(r=>setTimeout(r,1200));
     return nm + ' -> ' + JSON.stringify(row.ov||{}) + '  (期望 pvp:true，且**没有被自动刷新打断** ✓)';
  })()`));
  console.log('  ⑤ 页面异常：' + (errs.length ? errs.slice(0,3).join(' | ') : '无 ✓'));
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
})();
