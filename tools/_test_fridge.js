const { spawn, execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const B = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const NM = 'F' + Math.random().toString(36).slice(2, 6), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:NM,password:PW})}).then(r=>r.json());
  try {
    const py = "import sqlite3;c=sqlite3.connect(r'server/game.db');r=c.execute('select id from roles where name=?',(r'''" + NM + "''',)).fetchone();c.execute('insert into pending_gold(role,amount,why,ts,done) values(?,?,?,?,0)',(r[0],2000000,'test fridge',0));c.commit()";
    execFileSync('python', ['-c', py], { cwd: ROOT, stdio: 'ignore' });
  } catch (e) { console.log('gold seed failed', e.message); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-')), port = 11200 + Math.floor(Math.random()*20);
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
  // 走到别墅1门口买下
  await ev("var _h=TOWN_HOUSES.find(function(q){return q.id==='villa_1';});P.x=_h.x1-0.8;P.z=_h.door_at;try{wsSend('move',{x:P.x,z:P.z,yaw:P.yaw,jy:0});}catch(e){};return 1;");
  await sleep(1300);
  await ev("houseOpen();return 1;"); await sleep(600);
  await ev("HOUSE_DAYS=1;houseDoBuy();return 1;"); await sleep(1300);
  console.log('BOUGHT', JSON.stringify(await ev("return {gold:WSC.role.gold,owner:(HOUSE_DATA['villa_1']||{}).owner_name};")));
  // 去超市买两瓶水
  await ev("houseClose();var s=TOWN_SHOPS.find(function(q){return q.id==='mart';});P.x=s.x;P.z=s.z;try{wsSend('move',{x:P.x,z:P.z,yaw:P.yaw,jy:0});}catch(e){};return 1;");
  await sleep(1200);
  await ev("shopOpen();return 1;"); await sleep(500);
  await ev("shopBuy('water');return 1;"); await sleep(900);
  await ev("shopBuy('pearl_tea');return 1;"); await sleep(900);
  await ev("shopBuy('water');return 1;"); await sleep(1000);
  await ev("bagFetch();return 1;"); await sleep(900);
  console.log('BAG', JSON.stringify(await ev("return BAG.items.filter(function(e){return e.item&&e.item.kind==='food';}).map(function(e){return e.item.name+'x'+e.stack;});")));
  // 回到冰箱
  await ev("shopClose();var f=townHouseFridge(TOWN_HOUSES.find(function(q){return q.id==='villa_1';}));P.x=f[0];P.z=f[1]+0.9;try{wsSend('move',{x:P.x,z:P.z,yaw:P.yaw,jy:0});}catch(e){};return 1;");
  await sleep(1400);
  console.log('NEAR', JSON.stringify(await ev("return {fn:FRIDGE_NEAR?FRIDGE_NEAR.id:null,atk:document.getElementById('atk').className};")));
  await ev("fridgeOpen('villa_1');return 1;"); await sleep(800);
  const ids = await ev("var o=[];for(var i=0;i<BAG.items.length;i++){if(BAG.items[i].item&&BAG.items[i].item.kind==='food'){o.push(BAG.items[i].id);}}return o;");
  console.log('PUT_IDS', JSON.stringify(ids));
  for (const iid of (ids||[]).slice(0,3)) { await ev("fridgePut('"+iid+"');return 1;"); await sleep(1000); }
  console.log('FRIDGE', JSON.stringify(await ev("return {items:FRIDGE_ITEMS.map(function(e){return e.slot+':'+e.item.name;}),msg:FRIDGE_MSG,bag:BAG.items.length};")));
  await ev("bagFetch();return 1;"); await sleep(900);
  console.log('BAG2', JSON.stringify(await ev("return BAG.items.filter(function(e){return e.item&&e.item.kind==='food';}).map(function(e){return e.item.name+'x'+e.stack;});")));
  await ev("fridgeTake(0);return 1;"); await sleep(1000);
  console.log('TAKEN', JSON.stringify(await ev("return {items:FRIDGE_ITEMS.length,msg:FRIDGE_MSG};")));
  await ev("bagFetch();return 1;"); await sleep(900);
  console.log('BAG3', JSON.stringify(await ev("return BAG.items.filter(function(e){return e.item&&e.item.kind==='food';}).map(function(e){return e.item.name+'x'+e.stack;});")));
  const s2=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(ROOT,'docs','shots','town-fridge.png'),Buffer.from(s2.result.data,'base64'));
  console.log('ERRORS', JSON.stringify(errs.slice(0,8)));
  try{spawn('taskkill',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore'})}catch(e){}
  try{fs.rmSync(dir,{recursive:true,force:true})}catch(e){}
})();
