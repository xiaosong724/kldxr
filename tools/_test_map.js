const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const B = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const NM = 'M' + Math.random().toString(36).slice(2, 6), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:NM,password:PW})}).then(r=>r.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-')), port = 11100 + Math.floor(Math.random()*20);
  const proc = spawn(B, ['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--user-data-dir='+dir,'--remote-debugging-port='+port,'--window-size=1600,1000',ORIGIN+'/'],{stdio:'ignore'});
  let t=null; for(let i=0;i<120&&!t;i++){await sleep(250);try{const l=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();t=l.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)}catch(e){}}
  const ws=new WebSocket(t.webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r); let id=0; const w={}; const errs=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errs.push(m.params.exceptionDetails.text+' '+((m.params.exceptionDetails.exception||{}).description||''));if(m.id&&w[m.id]){w[m.id](m);delete w[m.id]}};
  const send=(m,p)=>new Promise(res=>{const i=++id;w[i]=res;ws.send(JSON.stringify({id:i,method:m,params:p||{}}))});
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:'(function(){'+x+'})()',returnByValue:true,awaitPromise:true});if(r.result&&r.result.exceptionDetails)errs.push(r.result.exceptionDetails.text);return r.result&&r.result.result?r.result.result.value:undefined};
  await send('Runtime.enable',{}); await sleep(900);
  await ev('localStorage.setItem("token",'+JSON.stringify(reg.token)+'); location.reload(); return 1;'); await sleep(15000);
  await ev('var bs=document.querySelectorAll("button");for(var i=0;i<bs.length;i++){if((bs[i].textContent||"").indexOf("知道了")>=0)bs[i].click();}return 1;');
  await sleep(600);
  console.log('ROADS', JSON.stringify(await ev("return {roads:TOWN_DATA.roads.length,buildings:TOWN_BUILDINGS.length,houses:TOWN_HOUSES.length};")));
  await ev("mapOpen();return 1;"); await sleep(600);
  console.log('MAP', JSON.stringify(await ev("return {open:MAP_OPEN,hits:MAP_HITS.length,display:getComputedStyle(document.getElementById('mapPanel')).display,size:[document.getElementById('townMapCanvas').clientWidth,document.getElementById('townMapCanvas').clientHeight]};")));
  const s=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(ROOT,'docs','shots','town-map.png'),Buffer.from(s.result.data,'base64'));
  console.log('PICK', JSON.stringify(await ev("var h=null;for(var i=0;i<MAP_HITS.length;i++){if(MAP_HITS[i].num[0]==='B'){h=MAP_HITS[i];break;}}if(!h)return {err:'no B'};var r=document.getElementById('townMapCanvas').getBoundingClientRect();mapPick({clientX:r.left+(h.x0+h.x1)/2,clientY:r.top+(h.y0+h.y1)/2});return {num:MAP_SEL&&MAP_SEL.num,name:MAP_SEL&&MAP_SEL.name,info:document.getElementById('mapInfo').innerText};")));
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
  await ev("mapClose();mapOpen();return 1;"); await sleep(700);
  console.log('MOBILE', JSON.stringify(await ev("var cv=document.getElementById('townMapCanvas');return {w:innerWidth,mobile:MAP_MOBILE,filter:MAP_FILTER,zoom:MAP_ZOOM,hits:MAP_HITS.length,canvas:[cv.clientWidth,cv.clientHeight],list:getComputedStyle(document.getElementById('mapList')).display,side:document.getElementById('mapSide').getBoundingClientRect().height};")));
  const sm=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(ROOT,'docs','shots','town-map-mobile.png'),Buffer.from(sm.result.data,'base64'));
  await send('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:2,mobile:true});
  await ev("window.dispatchEvent(new Event('resize'));mapClose();mapOpen();return 1;"); await sleep(700);
  console.log('LANDSCAPE', JSON.stringify(await ev("var cv=document.getElementById('townMapCanvas');var sd=document.getElementById('mapSide');return {w:innerWidth,h:innerHeight,mobile:MAP_MOBILE,filter:MAP_FILTER,canvas:[cv.clientWidth,cv.clientHeight],side:[sd.clientWidth,sd.clientHeight],list:getComputedStyle(document.getElementById('mapList')).display};")));
  const sl=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(ROOT,'docs','shots','town-map-landscape.png'),Buffer.from(sl.result.data,'base64'));
  console.log('ERRORS', JSON.stringify(errs.slice(0,8)));
  try{spawn('taskkill',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore'})}catch(e){}
  try{fs.rmSync(dir,{recursive:true,force:true})}catch(e){}
})();
