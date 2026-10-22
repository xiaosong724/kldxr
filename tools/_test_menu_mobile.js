const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const B = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const NM = 'U' + Math.random().toString(36).slice(2, 6), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:NM,password:PW})}).then(r=>r.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-')), port = 11600 + Math.floor(Math.random()*20);
  const proc = spawn(B, ['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--user-data-dir='+dir,'--remote-debugging-port='+port,'--window-size=1600,1000',ORIGIN+'/'],{stdio:'ignore'});
  let t=null; for(let i=0;i<120&&!t;i++){await sleep(250);try{const l=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();t=l.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)}catch(e){}}
  const ws=new WebSocket(t.webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r); let id=0; const w={}; const errs=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errs.push(((m.params.exceptionDetails.exception||{}).description||m.params.exceptionDetails.text||'').slice(0,200));if(m.id&&w[m.id]){w[m.id](m);delete w[m.id]}};
  const send=(m,p)=>new Promise(res=>{const i=++id;w[i]=res;ws.send(JSON.stringify({id:i,method:m,params:p||{}}))});
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:'(function(){'+x+'})()',returnByValue:true,awaitPromise:true});if(r.result&&r.result.exceptionDetails)errs.push((r.result.exceptionDetails.exception||{}).description||r.result.exceptionDetails.text);return r.result&&r.result.result?r.result.result.value:undefined};
  await send('Runtime.enable',{});
  await sleep(900);
  await ev('localStorage.setItem("token",'+JSON.stringify(reg.token)+');location.reload();return 1;');
  await sleep(14000);
  await ev('var bs=document.querySelectorAll("button");for(var i=0;i<bs.length;i++){if((bs[i].textContent||"").indexOf("知道了")>=0)bs[i].click();}return 1;');
  await sleep(600);
  async function shot(n){const s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(ROOT,'docs','shots',n),Buffer.from(s.result.data,'base64'));}
  async function size(w,h){await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:2,mobile:true});await ev("window.dispatchEvent(new Event('resize'));return 1;");await sleep(700);}
  await size(390,844);
  await ev("document.getElementById('setBtn').click();return 1;"); await sleep(900);
  console.log('SET_TABS', JSON.stringify(await ev("var box=document.getElementById('setBox').getBoundingClientRect();var tw=document.getElementById('setTabsWrap');return {box:[Math.round(box.width),Math.round(box.height)],tabs:tw?Math.round(tw.getBoundingClientRect().height):0,n:document.querySelectorAll('#setTabs .tab').length,scroll:tw?tw.scrollWidth:0,inner:innerWidth};")));
  await shot('m-menu-portrait.png');
  await size(844,390);
  await shot('m-menu-landscape.png');
  console.log('SET_LAND', JSON.stringify(await ev("var box=document.getElementById('setBox').getBoundingClientRect();return {box:[Math.round(box.width),Math.round(box.height)],vh:innerHeight,tabs:document.getElementById('setTabsWrap').scrollWidth};")));
  console.log('ERRORS', JSON.stringify(errs.slice(0,5)));
  try{spawn('taskkill',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore'})}catch(e){}
  try{fs.rmSync(dir,{recursive:true,force:true})}catch(e){}
})();
