const { spawn, execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const B = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function newTab(port, name) {
  const t = await fetch('http://127.0.0.1:' + port + '/json/new?' + encodeURIComponent(ORIGIN + '/'), { method: 'PUT' }).then(r => r.json());
  return t;
}
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise(r => ws.onopen = r);
  let id = 0; const w = {}; const errs = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') errs.push(((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text || '').slice(0, 300)); if (m.id && w[m.id]) { w[m.id](m); delete w[m.id]; } };
  const send = (mm, p) => new Promise(res => { const i = ++id; w[i] = res; ws.send(JSON.stringify({ id: i, method: mm, params: p || {} })); });
  const ev = async x => { const r = await send('Runtime.evaluate', { expression: '(function(){' + x + '})()', returnByValue: true, awaitPromise: true }); if (r.result && r.result.exceptionDetails) errs.push((r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text); return r.result && r.result.result ? r.result.result.value : undefined; };
  await send('Runtime.enable', {});
  return { send, ev, errs, ws };
}
(async () => {
  const A = 'J' + Math.random().toString(36).slice(2, 6), PWA = 'abc123456';
  const rA = await fetch(ORIGIN + '/api/register', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:A,password:PWA})}).then(r=>r.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-')), port = 11400 + Math.floor(Math.random()*20);
  const proc = spawn(B, ['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--user-data-dir='+dir,'--remote-debugging-port='+port,'--window-size=1600,1000','about:blank'],{stdio:'ignore'});
  let ok=false; for(let i=0;i<120&&!ok;i++){await sleep(250);try{await fetch('http://127.0.0.1:'+port+'/json/version');ok=true;}catch(e){}}
  const t1 = await newTab(port, 'A');
  const c1 = await connect(t1.webSocketDebuggerUrl);
  await c1.ev('localStorage.setItem("token",' + JSON.stringify(rA.token) + ');location.reload();return 1;');
  await sleep(14000);
  await c1.ev('var bs=document.querySelectorAll("button");for(var i=0;i<bs.length;i++){if((bs[i].textContent||"").indexOf("知道了")>=0)bs[i].click();}return 1;');
  await sleep(600);
  // 走到咖啡店并开始打工
  await c1.ev("var s=TOWN_SHOPS.find(function(q){return q.id==='cafe';});P.x=s.x;P.z=s.z;try{wsSend('move',{x:P.x,z:P.z,yaw:P.yaw,jy:0});}catch(e){};return 1;");
  await sleep(1400);
  await c1.ev("jobStart();return 1;"); await sleep(1500);
  console.log('A_JOB', JSON.stringify(await c1.ev("return {job:MY_JOB,shop:SHOP_NEAR?SHOP_NEAR.id:null};")));
  // 第二个 tab（同账号另一会话）：观察 A 的打工状态
  const t2 = await newTab(port, 'B');
  const c2 = await connect(t2.webSocketDebuggerUrl);
  await c2.ev('localStorage.setItem("token",' + JSON.stringify(rA.token) + ');location.reload();return 1;');
  await sleep(14000);
  await c2.ev('var bs=document.querySelectorAll("button");for(var i=0;i<bs.length;i++){if((bs[i].textContent||"").indexOf("知道了")>=0)bs[i].click();}return 1;');
  await sleep(2500);
  console.log('B_VIEW', JSON.stringify(await c2.ev("var o=NET.others||{};var k=Object.keys(o)[0];return {n:Object.keys(o).length,k:k,job:k?o[k].job:null,T:k?+(o[k].jobT||0).toFixed(2):0};")));
  console.log('B_ERR', JSON.stringify(c2.errs.slice(0,3)));
  console.log('A_ERR', JSON.stringify(c1.errs.slice(0,3)));
  try{spawn('taskkill',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore'})}catch(e){}
  try{fs.rmSync(dir,{recursive:true,force:true})}catch(e){}
})();
