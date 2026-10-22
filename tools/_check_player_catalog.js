const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const B = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-')), port = 15400;
  const proc = spawn(B, ['--headless=new','--disable-gpu','--no-sandbox','--user-data-dir='+dir,
    '--remote-debugging-port='+port,'--window-size=1400,900','http://127.0.0.1:8899/'],{stdio:'ignore'});
  let t=null; for(let i=0;i<140&&!t;i++){await sleep(250);try{const l=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();t=l.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)}catch(e){}}
  const ws=new WebSocket(t.webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r);
  let id=0; const w={};
  ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&w[m.id]){w[m.id](m);delete w[m.id];}};
  const send=(m,p)=>new Promise(res=>{const i=++id;w[i]=res;ws.send(JSON.stringify({id:i,method:m,params:p||{}}));});
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:'(function(){'+x+'})()',returnByValue:true,awaitPromise:true});return r.result&&r.result.result?r.result.result.value:undefined;};
  await send('Runtime.enable',{}); await sleep(2600);
  const NAME='c'+Math.floor(Math.random()*100000000).toString(36).slice(0,8);
  await ev(`document.getElementById('loginName').value=${JSON.stringify(NAME)};
            document.getElementById('loginPass').value='test123456';
            document.getElementById('btnReg').click();`);
  await sleep(3200);
  await ev(`window.PlaceMode.open(); window.wsSend('town_catalog',{});`);
  await sleep(1600);
  console.log(JSON.stringify(await ev(`
    var c=window.MY_TOWN_CATALOG||[];
    var byCat={};
    c.forEach(function(x){byCat[x.category]=(byCat[x.category]||0)+1;});
    var legacy=c.filter(function(x){return String(x.id).indexOf('legacy_')===0;});
    var nomodel=c.filter(function(x){return !x.model_id;});
    return {total:c.length, byCat:byCat,
            legacyCount:legacy.length, legacyIds:legacy.slice(0,6).map(function(x){return x.id;}),
            noModel:nomodel.length};`)));
  try{spawn('taskkill',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore'})}catch(e){}
})();
