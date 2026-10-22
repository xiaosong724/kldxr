const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const B = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seat2-')), port = 16000;
  const proc = spawn(B, ['--headless=new','--disable-gpu','--no-sandbox','--user-data-dir='+dir,
    '--remote-debugging-port='+port,'--window-size=1400,900','http://127.0.0.1:8899/'],{stdio:'ignore'});
  let t=null; for(let i=0;i<140&&!t;i++){await sleep(250);try{const l=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();t=l.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)}catch(e){}}
  const ws=new WebSocket(t.webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r);
  let id=0; const w={}; const errs=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data);
    if(m.method==='Runtime.exceptionThrown')errs.push(m.params.exceptionDetails.text);
    if(m.id&&w[m.id]){w[m.id](m);delete w[m.id];}};
  const send=(m,p)=>new Promise(res=>{const i=++id;w[i]=res;ws.send(JSON.stringify({id:i,method:m,params:p||{}}));});
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:'(function(){'+x+'})()',returnByValue:true,awaitPromise:true});if(r.result&&r.result.exceptionDetails)return{__err:(r.result.exceptionDetails.exception||{}).description};return r.result&&r.result.result?r.result.result.value:undefined;};
  await send('Runtime.enable',{}); await sleep(2600);
  const NAME='u'+Math.floor(Math.random()*100000000).toString(36).slice(0,8);
  await ev(`document.getElementById('loginName').value=${JSON.stringify(NAME)};
            document.getElementById('loginPass').value='test123456';
            document.getElementById('btnReg').click();`);
  await sleep(3200);
  await ev(`window.wsSend('town_objects',{});`);
  await sleep(1800);

  // 劫持 ws 的 onmessage 以记录 seated/seaterr
  console.log('HOOK', JSON.stringify(await ev(`
    window.__msgs=[];
    if (typeof ws!=='undefined' && ws) {
      var old = ws.onmessage;
      ws.onmessage = function(e){
        try { var m=JSON.parse(e.data); if(m.t==='seated'||m.t==='seaterr'||m.t==='stood') window.__msgs.push({t:m.t,d:m.d}); } catch(x){}
        if(old) return old.call(this,e);
      };
      return {hooked:true};
    }
    return {hooked:false};`)));

  await ev(`var l=window.MY_OBJECTS||[];var ch=l.filter(function(o){return o.catalog==='chair_wood';})[0];
            if(ch){ P.x=ch.x; P.z=ch.z+0.5; window.__chair=ch; }`);
  await sleep(1200);
  console.log('SIT', JSON.stringify(await ev(`
    var s=townSeatNear(P.x,P.z);
    if(!s) return {err:'no near'};
    window.wsSend('sit',{id:s.id});
    return {sent:s.id, chair:window.__chair?window.__chair.id:null};`)));
  await sleep(1800);
  console.log('MSGS', JSON.stringify(await ev(`return window.__msgs;`)));
  console.log('SEAT', JSON.stringify(await ev(`return {my: typeof MY_SEAT!=='undefined'? (MY_SEAT?MY_SEAT.id:null):'undef', pseat: P.seat};`)));
  console.log('ERRORS', JSON.stringify(errs.slice(0,3)));
  try{spawn('taskkill',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore'})}catch(e){}
})();
