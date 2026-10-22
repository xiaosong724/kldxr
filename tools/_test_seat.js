const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const B = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seat-')), port = 15900;
  const proc = spawn(B, ['--headless=new','--disable-gpu','--no-sandbox','--user-data-dir='+dir,
    '--remote-debugging-port='+port,'--window-size=1400,900','http://127.0.0.1:8899/'],{stdio:'ignore'});
  let t=null; for(let i=0;i<140&&!t;i++){await sleep(250);try{const l=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();t=l.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)}catch(e){}}
  const ws=new WebSocket(t.webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r);
  let id=0; const w={}; const errs=[]; const evts=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data);
    if(m.method==='Runtime.exceptionThrown')errs.push(m.params.exceptionDetails.text);
    if(m.method==='Runtime.consoleAPICalled'){}
    if(m.id&&w[m.id]){w[m.id](m);delete w[m.id];}};
  const send=(m,p)=>new Promise(res=>{const i=++id;w[i]=res;ws.send(JSON.stringify({id:i,method:m,params:p||{}}));});
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:'(function(){'+x+'})()',returnByValue:true,awaitPromise:true});if(r.result&&r.result.exceptionDetails)return{__err:(r.result.exceptionDetails.exception||{}).description};return r.result&&r.result.result?r.result.result.value:undefined;};
  await send('Runtime.enable',{}); await sleep(2600);
  const NAME='t'+Math.floor(Math.random()*100000000).toString(36).slice(0,8);
  await ev(`document.getElementById('loginName').value=${JSON.stringify(NAME)};
            document.getElementById('loginPass').value='test123456';
            document.getElementById('btnReg').click();`);
  await sleep(3200);
  await ev(`window.wsSend('town_objects',{});`);
  await sleep(1800);

  // 找一把咖啡店/茶馆里的椅子
  console.log('FIND', JSON.stringify(await ev(`
    var l=window.MY_OBJECTS||[];
    var chair=l.filter(function(o){return o.catalog==='chair_wood';})[0];
    if(!chair) return {err:'no chair'};
    P.x=chair.x; P.z=chair.z+0.6;
    var near=townSeatNear(P.x,P.z);
    return {chair:{id:chair.id,x:chair.x,z:chair.z},
            nearFound: !!near, nearId: near?near.id:null};`)));
  await sleep(1200);

  await ev(`window.__seatEvt=[]; var _o=window.wsSend; window.wsSend=function(t,d){ if(t==='sit'||t==='stand') window.__seatEvt.push(t); return _o.apply(this,arguments); };`);
  console.log('SIT', JSON.stringify(await ev(`
    var near=townShopNear?null:null;
    var s=townSeatNear(P.x,P.z);
    if(!s) return {err:'no seat near'};
    window.wsSend('sit',{id:s.id});
    return {sent:s.id};`)));
  await sleep(1600);
  console.log('SEATED', JSON.stringify(await ev(`
    return {seat: (typeof MY_SEAT!=='undefined')?MY_SEAT:null,
            seatRaw: (typeof P!=='undefined')?P.seat:null,
            px:+P.x.toFixed(1), pz:+P.z.toFixed(1),
            events: window.__seatEvt};`)));
  console.log('ERRORS', JSON.stringify(errs.slice(0,3)));
  try{spawn('taskkill',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore'})}catch(e){}
})();
