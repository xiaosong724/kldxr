const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const B = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const NM = 'P' + Math.random().toString(36).slice(2, 6), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:NM,password:PW})}).then(r=>r.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-')), port = 10400 + Math.floor(Math.random()*20);
  const proc = spawn(B, ['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--user-data-dir='+dir,'--remote-debugging-port='+port,'--window-size=1600,1000',ORIGIN+'/'],{stdio:'ignore'});
  let t=null; for(let i=0;i<120&&!t;i++){await sleep(250);try{const l=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();t=l.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)}catch(e){}}
  const ws=new WebSocket(t.webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r); let id=0; const w={};
  const errs=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.method==='Runtime.exceptionThrown'){errs.push(m.params.exceptionDetails.text+' '+(m.params.exceptionDetails.exception&&m.params.exceptionDetails.exception.description||''));} if(m.id&&w[m.id]){w[m.id](m);delete w[m.id]}};
  const send=(m,p)=>new Promise(res=>{const i=++id;w[i]=res;ws.send(JSON.stringify({id:i,method:m,params:p||{}}))});
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:'(function(){'+x+'})()',returnByValue:true,awaitPromise:true});if(r.result&&r.result.exceptionDetails)errs.push(r.result.exceptionDetails.text);return r.result&&r.result.result?r.result.result.value:undefined};
  await send('Runtime.enable',{}); await send('Log.enable',{}); await sleep(900);
  await ev('localStorage.setItem("token",'+JSON.stringify(reg.token)+'); location.reload(); return 1;'); await sleep(11000);
  await ev('var bs=document.querySelectorAll("button"); for(var i=0;i<bs.length;i++){if((bs[i].textContent||"").indexOf("知道了")>=0){bs[i].click();}} return 1;');
  await sleep(700);
  const stats = await ev("return {town:!!TOWN_GROUP,children:TOWN_GROUP?TOWN_GROUP.children.length:0,solids:TOWN_SOLIDS.length,seats:TOWN_SEATS.length,roofs:TOWN_ROOFS.length,stats:TOWN_STATS,safe:SAFE_HALF,wh:[TOWN_COUNTER.x,TOWN_COUNTER.z],P:[P.x,P.z]};");
  console.log('STATS', JSON.stringify(stats));

  async function shot(name, x, z, zoom, pitch, yaw) {
    await ev("try{P.x="+x+";P.z="+z+";CAM_VIEW='free';CAM_PITCH="+pitch+";CAM_PITCH_T="+pitch+";CAM_YAW="+yaw+";CAM_YAW_T="+yaw+";SETCFG.zoom="+zoom+";if(typeof applyWorldZoom==='function')applyWorldZoom();}catch(e){return String(e);} return 1;");
    await sleep(1600);
    const s=await send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(path.join(ROOT,'docs','shots',name),Buffer.from(s.result.data,'base64'));
    console.log('shot', name);
  }
  const perf = await ev("var r=rd.info.render;var by={};TOWN_GROUP.traverse(function(o){if(o.isMesh){var m=o.material;var k=(m.map?'map':(m.transparent?'trans':((m.emissive&&m.emissive.getHex())?'glow':'opaque')))+'|'+m.type;by[k]=(by[k]||0)+1;}});return {calls:r.calls,tris:r.triangles,geos:rd.info.memory.geometries,tex:rd.info.memory.textures,children:TOWN_GROUP.children.length,by:by};");
  console.log('POS', JSON.stringify(await ev("return {P:[P.x,P.z],rx:WSC.role&&WSC.role.x,rz:WSC.role&&WSC.role.z,tc:TOWN_CX};")));
  console.log('BOOT', JSON.stringify(await ev("return (window.__bootStack||document.body.innerText||'').slice(-1200);")));
  console.log('PERF', JSON.stringify(perf));
  await shot('town-v2-overview.png', -130, 130, 62, 0.95, 0.35);
  await shot('town-default.png', -130, 143, 100, 1.02, 0.18);
  await shot('town-hall.png', -130, 112, 120, 0.78, 0.0);
  await shot('town-v2-west.png', -145, 140, 118, 0.82, 0.9);
  await shot('town-v2-plaza.png', -130, 143, 120, 0.66, 0.1);
  await shot('town-v2-low.png', -138, 138, 105, 0.58, 0.7);
  await shot('town-v2-east.png', -120, 135, 118, 0.78, -0.9);
  console.log('ERRORS', JSON.stringify(errs.slice(0,8)));
  try{spawn('taskkill',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore'})}catch(e){}
  try{fs.rmSync(dir,{recursive:true,force:true})}catch(e){}
})();
