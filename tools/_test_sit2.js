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
  const shot=async(name)=>{const s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(ROOT,'docs','shots',name),Buffer.from(s.result.data,'base64'));};
  await send('Runtime.enable',{}); await sleep(900);
  await ev('localStorage.setItem("token",'+JSON.stringify(reg.token)+'); location.reload(); return 1;'); await sleep(10500);
  await ev('var bs=document.querySelectorAll("button"); for(var i=0;i<bs.length;i++){if((bs[i].textContent||"").indexOf("知道了")>=0){bs[i].click();}} return 1;');
  await sleep(600);
  await ev("CAM_VIEW='free';CAM_PITCH=0.76;CAM_PITCH_T=0.76;CAM_YAW=0.2;CAM_YAW_T=0.2;SETCFG.zoom=165;if(typeof applyWorldZoom==='function')applyWorldZoom();return 1;");

  console.log('COLLIDE', JSON.stringify(await ev("var s=townSeatById('plaza_sw');var hit=blocked(s.x,s.z,0.3,0.25,false);P.x=s.x;P.z=s.z+1.3;var before=[P.x,P.z];for(var i=0;i<10;i++){moveWithCollision(0,-0.12,0.3,0.25,false,null);}return {seatBlocked:hit,from:before,to:[+P.x.toFixed(2),+P.z.toFixed(2)],dist:+Math.hypot(P.x-s.x,P.z-s.z).toFixed(2)};")));

  async function sitAt(x,z,label) {
    await ev("tryStand(); return 1;"); await sleep(500);
    await ev("P.x="+x+";P.z="+z+";return 1;");
    await sleep(1200);
    const near = await ev("return {seat:SEAT_NEAR?SEAT_NEAR.id:null,me:MY_SEAT?MY_SEAT.id:null};");
    console.log('NEAR['+label+']', JSON.stringify(near));
    await ev("if(SEAT_NEAR) trySit(); else return 'no seat'; return 1;");
    await sleep(1200);
    const st = await ev("return {seat:MY_SEAT?MY_SEAT.id:null,idx:MY_SEAT?MY_SEAT.idx:null,P:[+P.x.toFixed(2),+P.z.toFixed(2)],y:+H.g.position.y.toFixed(2),leg:+H.legL.rotation.x.toFixed(2),sw:H.sw.visible,atk:document.getElementById('atk').className,prompt:document.getElementById('sitPrompt').style.display};");
    console.log('SIT['+label+']', JSON.stringify(st));
    await sleep(350);
    await shot('sit-' + label + '.png');
    if (label === 'bench') {
      await ev("keys['w']=true; return 1;"); await sleep(350);
      await ev("keys['w']=false; return 1;");
    } else {
      await ev("tryStand(); return 1;");
    }
    await sleep(1000);
    console.log('UP['+label+']', JSON.stringify(await ev("return {me:MY_SEAT?MY_SEAT.id:null,P:[+P.x.toFixed(2),+P.z.toFixed(2)]};")));
  }

  await sitAt(-6.2, 7.35, 'bench');
  await sitAt(-10.0, 8.1, 'cafe');
  await sitAt(14.6, -6.0, 'ramen');

  // 隔着墙不能坐（站在便利店外墙外，指店内椅子）
  console.log('WALL', JSON.stringify(await ev("P.x=-9.4;P.z=-7.0;return {near:null};")));
  console.log('WALL2', JSON.stringify(await ev("return {near:SEAT_NEAR?SEAT_NEAR.id:null};")));

  console.log('ERRORS', JSON.stringify(errs.slice(0,8)));
  try{spawn('taskkill',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore'})}catch(e){}
  try{fs.rmSync(dir,{recursive:true,force:true})}catch(e){}
})();
