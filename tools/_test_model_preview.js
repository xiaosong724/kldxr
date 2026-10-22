const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const B = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-')), port = 10700 + Math.floor(Math.random()*20);
  const proc = spawn(B, ['--headless=new','--disable-gpu','--no-sandbox','--user-data-dir='+dir,'--remote-debugging-port='+port,'--window-size=1400,900','http://127.0.0.1:8899/preview_models.html'],{stdio:'ignore'});
  let t=null; for(let i=0;i<120&&!t;i++){await sleep(250);try{const l=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();t=l.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)}catch(e){}}
  const ws=new WebSocket(t.webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r); let id=0; const w={}; const errs=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.method==='Runtime.exceptionThrown'){errs.push(m.params.exceptionDetails.text+' '+(m.params.exceptionDetails.exception&&m.params.exceptionDetails.exception.description||''));} if(m.id&&w[m.id]){w[m.id](m);delete w[m.id]}};
  const send=(m,p)=>new Promise(res=>{const i=++id;w[i]=res;ws.send(JSON.stringify({id:i,method:m,params:p||{}}))});
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:'(function(){'+x+'})()',returnByValue:true,awaitPromise:true});return r.result&&r.result.result?r.result.result.value:undefined};
  await send('Runtime.enable',{}); await sleep(1800);
  console.log('PARTS', JSON.stringify(await ev("return {count:document.querySelectorAll('#parts button').length,first:(document.querySelector('#parts button')||{}).textContent};")));
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:700,y:520,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:700,y:520,button:'left',clickCount:1});
  await sleep(300);
  console.log('MODEL_CLICK', JSON.stringify(await ev("return {name:document.getElementById('pickedName').textContent,tip:document.getElementById('partTip').textContent,tipShow:getComputedStyle(document.getElementById('partTip')).display};")));
  { const sshot=await send('Page.captureScreenshot',{format:'png'}); fs.writeFileSync(path.join(__dirname,'..','docs','shots','model-preview-click.png'),Buffer.from(sshot.result.data,'base64')); }
  console.log('CLICK', JSON.stringify(await ev("document.querySelector('#parts button').click();return {name:document.getElementById('pickedName').textContent,info:document.getElementById('pickedInfo').innerText.slice(0,120),display:getComputedStyle(document.getElementById('picked')).display};")));
  console.log('PV', JSON.stringify(await ev("return {pv:!!window.__pv,cur:!!(window.__pv&&window.__pv.cur)};")));
  console.log('SPEC', JSON.stringify(await ev("var s=TOWN_MODELS['shop_cafe_v1'];return {sign:s.sign,keys:Object.keys(s)};")));
  console.log('FRIDGE', JSON.stringify(await ev("var c=window.__pv&&window.__pv.cur;var a=[];if(c)c.traverse(function(o){if(o.userData&&/[Ff]ridge/.test(o.userData.partName||''))a.push(o.userData.partName+':'+o.visible+':'+o.getWorldPosition(new THREE.Vector3()).toArray().map(function(v){return +v.toFixed(1)}).join(','));});return a.slice(0,20);")));
  console.log('SIGN', JSON.stringify(await ev("var c=window.__pv&&window.__pv.cur;var out=[];if(c)c.traverse(function(o){if(o.userData&&o.userData.partName==='sign_face'){out.push({vis:o.visible,pos:[o.position.x,o.position.y,o.position.z],mat:o.material.type,map:!!o.material.map,side:o.material.side});}});return out;")));
  console.log('BAD', JSON.stringify(await ev("var c=window.__pv&&window.__pv.cur;var a=[];if(c)c.traverse(function(o){if(o.userData&&o.userData.partName&&!/[\u4e00-\u9fa5]/.test(o.userData.partLabel||''))a.push(o.userData.partName+'='+o.userData.partLabel);});return a.slice(0,80);")));
  console.log('ERRORS', JSON.stringify(errs.slice(0,5)));
  try{spawn('taskkill',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore'})}catch(e){}
  try{fs.rmSync(dir,{recursive:true,force:true})}catch(e){}
})();
