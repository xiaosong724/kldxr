const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const B = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const NM = 'W' + Math.random().toString(36).slice(2, 6), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:NM,password:PW})}).then(r=>r.json());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wk-')), port = 11500 + Math.floor(Math.random()*20);
  const proc = spawn(B, ['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--user-data-dir='+dir,'--remote-debugging-port='+port,'--window-size=1600,1000',ORIGIN+'/'],{stdio:'ignore'});
  let t=null; for(let i=0;i<120&&!t;i++){await sleep(250);try{const l=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();t=l.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)}catch(e){}}
  const ws=new WebSocket(t.webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r); let id=0; const w={}; const errs=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errs.push(m.params.exceptionDetails.text+' '+((m.params.exceptionDetails.exception||{}).description||''));if(m.id&&w[m.id]){w[m.id](m);delete w[m.id]}};
  const send=(m,p)=>new Promise(res=>{const i=++id;w[i]=res;ws.send(JSON.stringify({id:i,method:m,params:p||{}}))});
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:'(function(){'+x+'})()',returnByValue:true,awaitPromise:true});if(r.result&&r.result.exceptionDetails)errs.push(r.result.exceptionDetails.text);return r.result&&r.result.result?r.result.result.value:undefined};
  await send('Runtime.enable',{}); await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
  await sleep(900);
  await ev('localStorage.setItem("token",'+JSON.stringify(reg.token)+');location.reload();return 1;');
  await sleep(14000);
  await ev('var bs=document.querySelectorAll("button");for(var i=0;i<bs.length;i++){if((bs[i].textContent||"").indexOf("知道了")>=0)bs[i].click();}return 1;');
  await sleep(700);

  async function shot(name) { const s = await send('Page.captureScreenshot', {format:'png'}); fs.writeFileSync(path.join(ROOT,'docs','shots',name), Buffer.from(s.result.data,'base64')); }

  // 1) 地图竖屏
  await ev("mapOpen();return 1;"); await sleep(700); await shot('m-1-map.png'); await ev("mapClose();return 1;");
  // 2) 打开菜单
  await ev("var m=document.getElementById('menuBtn')||document.querySelector('[data-act=\"menu\"]');if(m)m.click();return 1;"); await sleep(700);
  console.log('MENU1', JSON.stringify(await ev("var p=document.querySelectorAll('.panel,.modal,#menuPanel,#bag');return {n:p.length, vis:Array.prototype.filter.call(p,function(e){return getComputedStyle(e).display!=='none';}).map(function(e){return e.id||e.className;}).slice(0,10)};")));
  await shot('m-2-menu.png');
  // 3) 背包
  await ev("try{UI.bag&&UI.bag();}catch(e){};var b=document.getElementById('bagGrid')?document.getElementById('bagGrid').closest('div[id],div[class]'):null;return 1;"); await sleep(600);
  await shot('m-3-bag.png');
  // 4) 房屋/商店/冰箱在竖屏下的宽度
  console.log('WIDTH', JSON.stringify(await ev("var ids=['housePanel','shopPanel','fridgePanel','orderPanel','tpPanel','mapPanel'];var o={};ids.forEach(function(k){var e=document.getElementById(k);if(e){var b=e.firstElementChild;o[k]=[getComputedStyle(e).display, b?Math.round(b.getBoundingClientRect().width):0, innerWidth];}});return o;")));
  console.log('ERRORS', JSON.stringify(errs.slice(0,6)));
  try{spawn('taskkill',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore'})}catch(e){}
  try{fs.rmSync(dir,{recursive:true,force:true})}catch(e){}
})();
