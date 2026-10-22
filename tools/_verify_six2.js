const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const B = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const M = ['shop_apartment_v1','shop_inn_v1','shop_bathhouse_v1','shop_tea_v1','shop_dessert_v1','shop_koban_v1'];
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's6b-')), port = 15500;
  const proc = spawn(B, ['--headless=new','--disable-gpu','--no-sandbox','--user-data-dir='+dir,
    '--remote-debugging-port='+port,'--window-size=1400,900',
    'http://127.0.0.1:8899/preview_models.html'],{stdio:'ignore'});
  let t=null; for(let i=0;i<140&&!t;i++){await sleep(250);try{const l=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();t=l.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)}catch(e){}}
  const ws=new WebSocket(t.webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r);
  let id=0; const w={}; const errs=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.method==='Runtime.exceptionThrown')errs.push(m.params.exceptionDetails.text+' '+((m.params.exceptionDetails.exception||{}).description||'').slice(0,180));if(m.id&&w[m.id]){w[m.id](m);delete w[m.id];}};
  const send=(m,p)=>new Promise(res=>{const i=++id;w[i]=res;ws.send(JSON.stringify({id:i,method:m,params:p||{}}));});
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:'(function(){'+x+'})()',returnByValue:true});if(r.result&&r.result.exceptionDetails)return{__err:(r.result.exceptionDetails.exception||{}).description};return r.result&&r.result.result?r.result.result.value:undefined;};
  await send('Runtime.enable',{}); await sleep(1800);
  for (const mid of M) {
    console.log(mid, JSON.stringify(await ev(`
      var spec=TOWN_MODELS[${JSON.stringify(mid)}];
      if(!spec)return{err:'no spec'};
      var g=buildTownModel(spec,{});
      var n=0,bad=[],tris=0;
      g.traverse(function(o){var p=o.userData&&o.userData.partName;if(p){n++;if(!/[\\u4e00-\\u9fa5]/.test(o.userData.partLabel||''))bad.push(p);}
        if(o.geometry&&o.geometry.index)tris+=o.geometry.index.count/3;});
      var f=g.userData.furniture||[];
      return {parts:n,tris:Math.round(tris),furniture:f.length,bad:bad.slice(0,4),
              cats:f.reduce(function(a,x){a[x.catalog]=(a[x.catalog]||0)+1;return a;},{})};`)));
  }
  console.log('ERRORS', JSON.stringify(errs.slice(0,4)));
  try{spawn('taskkill',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore'})}catch(e){}
})();
