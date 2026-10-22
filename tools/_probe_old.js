const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const B = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const NM = 'P' + Math.random().toString(36).slice(2, 6), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:NM,password:PW})}).then(r=>r.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-')), port = 10500 + Math.floor(Math.random()*20);
  const proc = spawn(B, ['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--user-data-dir='+dir,'--remote-debugging-port='+port,'--window-size=1400,900',ORIGIN+'/'],{stdio:'ignore'});
  let t=null; for(let i=0;i<120&&!t;i++){await sleep(250);try{const l=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();t=l.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)}catch(e){}}
  const ws=new WebSocket(t.webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r); let id=0; const w={};
  ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&w[m.id]){w[m.id](m);delete w[m.id]}};
  const send=(m,p)=>new Promise(res=>{const i=++id;w[i]=res;ws.send(JSON.stringify({id:i,method:m,params:p||{}}))});
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:'(function(){'+x+'})()',returnByValue:true,awaitPromise:true});return r.result&&r.result.result?r.result.result.value:undefined};
  await send('Runtime.enable',{}); await sleep(900);
  await ev('localStorage.setItem("token",'+JSON.stringify(reg.token)+'); location.reload(); return 1;'); await sleep(11000);
  await ev('var bs=document.querySelectorAll("button"); for(var i=0;i<bs.length;i++){if((bs[i].textContent||"").indexOf("知道了")>=0){bs[i].click();}} return 1;');
  await sleep(800);
  const objs = await ev(`
    var out=[]; TOWN_GROUP.traverse(function(o){
      if(!o.isMesh && !o.isSprite) return;
      var p=new THREE.Vector3(); o.getWorldPosition(p);
      if(Math.abs(p.x)<60 && Math.abs(p.z)<60){
        out.push({t:o.type,g:o.geometry?o.geometry.type:'',x:+p.x.toFixed(1),y:+p.y.toFixed(1),z:+p.z.toFixed(1),p:o.parent?o.parent.name:''});
      }
    });
    return out.slice(0,80);`);
  console.log('OLD_OBJECTS', JSON.stringify(objs));
  const groups = await ev(`return TOWN_GROUP.children.map(function(o){return {t:o.type,n:o.name,x:+o.position.x.toFixed(1),z:+o.position.z.toFixed(1),c:o.children.length};});`);
  console.log('GROUPS', JSON.stringify(groups));
  await ev("P.x=0;P.z=0;CAM_VIEW='free';CAM_PITCH=0.95;CAM_PITCH_T=0.95;CAM_YAW=0.2;CAM_YAW_T=0.2;SETCFG.zoom=70;if(typeof applyWorldZoom==='function')applyWorldZoom();return 1;");
  await sleep(1600);
  const s=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(ROOT,'docs','shots','old-center.png'),Buffer.from(s.result.data,'base64'));
  console.log('shot old-center.png');
  try{spawn('taskkill',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore'})}catch(e){}
  try{fs.rmSync(dir,{recursive:true,force:true})}catch(e){}
})();
