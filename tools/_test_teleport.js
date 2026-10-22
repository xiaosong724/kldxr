const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const B = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const NM = 'T' + Math.random().toString(36).slice(2, 6), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:NM,password:PW})}).then(r=>r.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-')), port = 10800 + Math.floor(Math.random()*20);
  const proc = spawn(B, ['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--user-data-dir='+dir,'--remote-debugging-port='+port,'--window-size=1600,1000',ORIGIN+'/'],{stdio:'ignore'});
  let t=null; for(let i=0;i<120&&!t;i++){await sleep(250);try{const l=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();t=l.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)}catch(e){}}
  const ws=new WebSocket(t.webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r); let id=0; const w={}; const errs=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errs.push('EXC '+JSON.stringify(m.params.exceptionDetails).slice(0,1200));
if(m.method==='Runtime.consoleAPICalled')errs.push('LOG '+m.params.type+' '+m.params.args.map(function(a){return a.value||a.description||'';}).join(' ').slice(0,800));if(m.id&&w[m.id]){w[m.id](m);delete w[m.id]}};
  const send=(m,p)=>new Promise(res=>{const i=++id;w[i]=res;ws.send(JSON.stringify({id:i,method:m,params:p||{}}))});
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:'(function(){'+x+'})()',returnByValue:true,awaitPromise:true});if(r.result&&r.result.exceptionDetails)errs.push('EVAL '+JSON.stringify(r.result.exceptionDetails).slice(0,1200));return r.result&&r.result.result?r.result.result.value:undefined};
  const shot=async(n)=>{const s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(ROOT,'docs','shots',n),Buffer.from(s.result.data,'base64'));};
  await send('Runtime.enable',{}); await sleep(900);
  await ev('localStorage.setItem("token",'+JSON.stringify(reg.token)+'); location.reload(); return 1;'); await sleep(11000);
  await ev('var bs=document.querySelectorAll("button");for(var i=0;i<bs.length;i++){if((bs[i].textContent||"").indexOf("知道了")>=0)bs[i].click();}return 1;');
  await sleep(600);
  console.log('BODY', JSON.stringify(await ev("return {h:typeof H,sw:H&&H.sw,stack:(window.__bootStack||'').slice(0,1200),body:(document.body.innerText||'').slice(0,220)};")));
  console.log('TOWN', JSON.stringify(await ev("return {safe:SAFE_HALF,tp:TOWN_TELEPORTS.length,houses:TOWN_HOUSES.length,solids:TOWN_SOLIDS.length,pad:[TOWN_TELEPORTS[0].x,TOWN_TELEPORTS[0].z]};")));
  await ev("P.x=TOWN_TELEPORTS[0].x;P.z=TOWN_TELEPORTS[0].z;CAM_VIEW='free';CAM_PITCH=0.78;CAM_PITCH_T=0.78;CAM_YAW=0.2;CAM_YAW_T=0.2;SETCFG.zoom=150;if(typeof applyWorldZoom==='function')applyWorldZoom();return 1;");
  await sleep(1600);
  console.log('NEAR', JSON.stringify(await ev("return {tp:TP_NEAR?TP_NEAR.id:null,atk:document.getElementById('atk').className,safe:SAFE_MODE,body:document.body.className,sk:getComputedStyle(document.getElementById('skBar')).display,auto:getComputedStyle(document.getElementById('auto')).display,sw:H.sw.visible,sz:+H.g.scale.x.toFixed(3)};")));
  await ev("try{wsSend('move',{x:P.x,z:P.z,yaw:0,jy:0});}catch(e){};return 1;"); await sleep(500);
  await ev("tpOpen(); return 1;"); await sleep(500);
  console.log('PANEL', JSON.stringify(await ev("return {open:TP.open,disp:getComputedStyle(document.getElementById('tpPanel')).display,items:document.querySelectorAll('#tpList .tpBtn').length};")));
  await shot('town-teleport-panel.png');
  await ev("var b=document.querySelector('#tpList .tpBtn[data-tpid=\"villa\"]'); if(b)b.click(); return 1;");
  await sleep(1400);
  console.log('AFTER', JSON.stringify(await ev("return {P:[+P.x.toFixed(1),+P.z.toFixed(1)],open:TP.open,tpPrompt:document.getElementById('tpPrompt').style.display,near:TP_NEAR?TP_NEAR.id:null};")));
  await shot('town-teleport-villa.png');
  // 出镇：安全区收起应恢复
  await ev("P.x=250.5;P.z=0;return 1;"); await sleep(900);
  console.log('OUT', JSON.stringify(await ev("return {safe:SAFE_MODE,body:document.body.className,sk:getComputedStyle(document.getElementById('skBar')).display,auto:getComputedStyle(document.getElementById('auto')).display,sw:H.sw.visible,sz:+H.g.scale.x.toFixed(3)};")));
  await ev("P.x=TOWN_TELEPORTS[0].x;P.z=TOWN_TELEPORTS[0].z;return 1;"); await sleep(900);
  console.log('IN', JSON.stringify(await ev("return {safe:SAFE_MODE,body:document.body.className,sk:getComputedStyle(document.getElementById('skBar')).display,auto:getComputedStyle(document.getElementById('auto')).display,sw:H.sw.visible};")));
  console.log('ERRORS', JSON.stringify(errs.slice(0,8)));
  try{spawn('taskkill',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore'})}catch(e){}
  try{fs.rmSync(dir,{recursive:true,force:true})}catch(e){}
})();
