const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const B = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const NM = 'S' + Math.random().toString(36).slice(2, 6), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:NM,password:PW})}).then(r=>r.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-')), port = 10500 + Math.floor(Math.random()*20);
  const proc = spawn(B, ['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--user-data-dir='+dir,'--remote-debugging-port='+port,'--window-size=1600,1000',ORIGIN+'/'],{stdio:'ignore'});
  let t=null; for(let i=0;i<120&&!t;i++){await sleep(250);try{const l=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();t=l.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)}catch(e){}}
  const ws=new WebSocket(t.webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r); let id=0; const w={};
  const errs=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.method==='Runtime.exceptionThrown'){errs.push(m.params.exceptionDetails.text+' '+((m.params.exceptionDetails.exception||{}).description||''));} if(m.id&&w[m.id]){w[m.id](m);delete w[m.id]}};
  const send=(m,p)=>new Promise(res=>{const i=++id;w[i]=res;ws.send(JSON.stringify({id:i,method:m,params:p||{}}))});
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:'(function(){'+x+'})()',returnByValue:true,awaitPromise:true});if(r.result&&r.result.exceptionDetails)errs.push(r.result.exceptionDetails.text);return r.result&&r.result.result?r.result.result.value:undefined};
  await send('Runtime.enable',{}); await sleep(900);
  await ev('localStorage.setItem("token",'+JSON.stringify(reg.token)+'); location.reload(); return 1;'); await sleep(10500);
  await ev('var bs=document.querySelectorAll("button"); for(var i=0;i<bs.length;i++){if((bs[i].textContent||"").indexOf("知道了")>=0){bs[i].click();}} return 1;');
  await sleep(600);
  // 站到广场长椅旁边
  await ev("P.x=-6.2;P.z=7.4;P.yaw=3.14159;CAM_VIEW='free';CAM_PITCH=0.78;CAM_PITCH_T=0.78;CAM_YAW=0.15;CAM_YAW_T=0.15;SETCFG.zoom=150;if(typeof applyWorldZoom==='function')applyWorldZoom();return 1;");
  await sleep(1600);
  console.log('NEAR', JSON.stringify(await ev("return {seat:SEAT_NEAR?SEAT_NEAR.id:null,atk:document.getElementById('atk').className,prompt:document.getElementById('sitPrompt').textContent,promptDisp:document.getElementById('sitPrompt').style.display,P:[P.x,P.z],me:MY_SEAT?MY_SEAT.id:null};")));
  const s1=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(ROOT,'docs','shots','sit-before.png'),Buffer.from(s1.result.data,'base64'));
  // 点攻击按钮（交互→坐下）
  await ev("document.getElementById('atk').dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); return 1;");
  await sleep(1200);
  console.log('SEATED', JSON.stringify(await ev("return {me:MY_SEAT?MY_SEAT.id:null,idx:MY_SEAT?MY_SEAT.idx:null,P:[+P.x.toFixed(2),+P.z.toFixed(2)],leg:+H.legL.rotation.x.toFixed(2),arm:+H.armL.rotation.x.toFixed(2),sw:H.sw.visible,atk:document.getElementById('atk').className,prompt:document.getElementById('sitPrompt').textContent,posY:+H.g.position.y.toFixed(2),seatSp:WH_NEAR,seatNear:SEAT_NEAR};")));
  const s2=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(ROOT,'docs','shots','sit-seated.png'),Buffer.from(s2.result.data,'base64'));
  // 移动起身
  await ev("P.x=P.x+0.01; tryStand(); return 1;");
  await sleep(1200);
  console.log('STOOD', JSON.stringify(await ev("return {me:MY_SEAT?MY_SEAT.id:null,P:[+P.x.toFixed(2),+P.z.toFixed(2)],leg:+H.legL.rotation.x.toFixed(2),sw:H.sw.visible,atk:document.getElementById('atk').className};")));
  console.log('ERRORS', JSON.stringify(errs.slice(0,6)));
  try{spawn('taskkill',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore'})}catch(e){}
  try{fs.rmSync(dir,{recursive:true,force:true})}catch(e){}
})();
