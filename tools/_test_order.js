const { spawn, execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const B = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const NM = 'O' + Math.random().toString(36).slice(2, 6), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:NM,password:PW})}).then(r=>r.json());
  try {
    const py = "import sqlite3;c=sqlite3.connect(r'server/game.db');r=c.execute('select id from roles where name=?',(r'''" + NM + "''',)).fetchone();c.execute('insert into pending_gold(role,amount,why,ts,done) values(?,?,?,?,0)',(r[0],200000,'test order',0));c.commit()";
    execFileSync('python', ['-c', py], { cwd: ROOT, stdio: 'ignore' });
  } catch (e) { console.log('gold seed failed', e.message); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-')), port = 11300 + Math.floor(Math.random()*20);
  const proc = spawn(B, ['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--user-data-dir='+dir,'--remote-debugging-port='+port,'--window-size=1600,1000',ORIGIN+'/'],{stdio:'ignore'});
  let t=null; for(let i=0;i<120&&!t;i++){await sleep(250);try{const l=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();t=l.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)}catch(e){}}
  const ws=new WebSocket(t.webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r); let id=0; const w={}; const errs=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errs.push(m.params.exceptionDetails.text+' '+((m.params.exceptionDetails.exception||{}).description||''));if(m.id&&w[m.id]){w[m.id](m);delete w[m.id]}};
  const send=(m,p)=>new Promise(res=>{const i=++id;w[i]=res;ws.send(JSON.stringify({id:i,method:m,params:p||{}}))});
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:'(function(){'+x+'})()',returnByValue:true,awaitPromise:true});if(r.result&&r.result.exceptionDetails)errs.push(r.result.exceptionDetails.text);return r.result&&r.result.result?r.result.result.value:undefined};
  await send('Runtime.enable',{}); await sleep(900);
  await ev('localStorage.setItem("token",'+JSON.stringify(reg.token)+'); location.reload(); return 1;'); await sleep(13000);
  await ev('var bs=document.querySelectorAll("button");for(var i=0;i<bs.length;i++){if((bs[i].textContent||"").indexOf("知道了")>=0)bs[i].click();}return 1;');
  await sleep(600);
  console.log('SHOPS', JSON.stringify(await ev("return TOWN_SHOPS.filter(function(s){return s.served;}).map(function(s){return s.id;});")));
  // 咖啡店：走到店里坐下
  await ev("var s=TOWN_SHOPS.find(function(q){return q.id==='cafe';});P.x=s.x;P.z=s.z;try{wsSend('move',{x:P.x,z:P.z,yaw:P.yaw,jy:0});}catch(e){};return 1;");
  await sleep(1300);
  console.log('NEAR', JSON.stringify(await ev("return {shop:SHOP_NEAR?SHOP_NEAR.id:null,seat:SEAT_NEAR?SEAT_NEAR.id:null};")));
  // 坐到店内椅子
  await ev("var st=null;for(var i=0;i<TOWN_SEATS.length;i++){var s=TOWN_SEATS[i];if(String(s.id).indexOf('cafe_in')===0){st=s;break;}}if(!st)return 'no seat';P.x=st.x;P.z=st.z+0.5;try{wsSend('move',{x:P.x,z:P.z,yaw:P.yaw,jy:0});}catch(e){};return 1;");
  await sleep(1200);
  await ev("trySit();return 1;"); await sleep(900);
  console.log('SIT', JSON.stringify(await ev("return {seat:MY_SEAT?MY_SEAT.id:null,atk:document.getElementById('atk').className,prompt:document.getElementById('orderPrompt').style.display};")));
  await ev("orderOpen();return 1;"); await sleep(700);
  console.log('ORDER', JSON.stringify(await ev("return {open:ORDER_OPEN,title:ORDER_TITLE,items:ORDER_ITEMS.length,body:(document.getElementById('orderBody').innerText||'').slice(0,160)};")));
  const s1=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(ROOT,'docs','shots','town-order.png'),Buffer.from(s1.result.data,'base64'));
  await ev("orderBuy('latte');return 1;"); await sleep(1300);
  console.log('BOUGHT', JSON.stringify(await ev("return {gold:WSC.role.gold,msg:ORDER_MSG,bag:BAG.items.filter(function(e){return e.item&&e.item.kind==='food';}).map(function(e){return e.item.name;})};")));
  // 打工
  await ev("orderClose();tryStand();return 1;"); await sleep(800);
  await ev("var s=TOWN_SHOPS.find(function(q){return q.id==='cafe';});P.x=s.x;P.z=s.z;try{wsSend('move',{x:P.x,z:P.z,yaw:P.yaw,jy:0});}catch(e){};return 1;");
  await sleep(1400);
  await ev("jobStart();return 1;"); await sleep(1400);
  console.log('JOB', JSON.stringify(await ev("return {job:MY_JOB,shop:SHOP_NEAR?SHOP_NEAR.id:null};")));
  await sleep(2200);
  console.log('JOB_T', JSON.stringify(await ev("return {t:+JOB_T.toFixed(2),arm:+H.armR.rotation.x.toFixed(2)};")));
  await ev("jobStop();return 1;"); await sleep(600);
  console.log('JOB_END', JSON.stringify(await ev("return {job:MY_JOB};")));
  console.log('ERRORS', JSON.stringify(errs.slice(0,8)));
  try{spawn('taskkill',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore'})}catch(e){}
  try{fs.rmSync(dir,{recursive:true,force:true})}catch(e){}
})();
