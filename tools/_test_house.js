const { spawn, execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const B = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const NM = 'H' + Math.random().toString(36).slice(2, 6), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:NM,password:PW})}).then(r=>r.json());
  // 测试用：给这个新账号塞 100 万金币（走 pending_gold，登录自动入账）
  try {
    const py = "import sqlite3;c=sqlite3.connect(r'server/game.db');r=c.execute('select id from roles where name=?',(r'''" + NM + "''',)).fetchone();c.execute('insert into pending_gold(role,amount,why,ts,done) values(?,?,?,?,0)',(r[0],1000000,'test house',0));c.commit();print(r[0])";
    execFileSync('python', ['-c', py], { cwd: ROOT, stdio: 'ignore' });
  } catch (e) { console.log('gold seed failed', e.message); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-')), port = 10900 + Math.floor(Math.random()*20);
  const proc = spawn(B, ['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--user-data-dir='+dir,'--remote-debugging-port='+port,'--window-size=1600,1000',ORIGIN+'/'],{stdio:'ignore'});
  let t=null; for(let i=0;i<120&&!t;i++){await sleep(250);try{const l=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();t=l.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)}catch(e){}}
  const ws=new WebSocket(t.webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r); let id=0; const w={}; const errs=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errs.push(m.params.exceptionDetails.text+' '+((m.params.exceptionDetails.exception||{}).description||''));if(m.id&&w[m.id]){w[m.id](m);delete w[m.id]}};
  const send=(m,p)=>new Promise(res=>{const i=++id;w[i]=res;ws.send(JSON.stringify({id:i,method:m,params:p||{}}))});
  const shot=async(n)=>{const s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(ROOT,'docs','shots',n),Buffer.from(s.result.data,'base64'));};
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:'(function(){'+x+'})()',returnByValue:true,awaitPromise:true});if(r.result&&r.result.exceptionDetails)errs.push(r.result.exceptionDetails.text);return r.result&&r.result.result?r.result.result.value:undefined};
  await send('Runtime.enable',{}); await sleep(900);
  await ev('localStorage.setItem("token",'+JSON.stringify(reg.token)+'); location.reload(); return 1;'); await sleep(11000);
  await ev('var bs=document.querySelectorAll("button");for(var i=0;i<bs.length;i++){if((bs[i].textContent||"").indexOf("知道了")>=0)bs[i].click();}return 1;');
  await sleep(700);
  console.log('DATA', JSON.stringify(await ev("return {houses:TOWN_HOUSES.length,data:Object.keys(HOUSE_DATA).length,signs:Object.keys(TOWN_HOUSE_SIGNS).length};")));
  // 站到别墅1东门口
  await ev("var _h=TOWN_HOUSES.find(function(q){return q.id==='villa_1';});P.x=_h.x1-0.8;P.z=_h.door_at;CAM_VIEW='free';CAM_PITCH=0.82;CAM_PITCH_T=0.82;CAM_YAW=1.4;CAM_YAW_T=1.4;SETCFG.zoom=135;if(typeof applyWorldZoom==='function')applyWorldZoom();return 1;");
  await sleep(1600);
  console.log('NEAR', JSON.stringify(await ev("return {near:HOUSE_NEAR?HOUSE_NEAR.id:null,atk:document.getElementById('atk').className,prompt:document.getElementById('housePrompt').textContent,disp:document.getElementById('housePrompt').style.display};")));
  await ev("CAM_YAW=1.5708;CAM_YAW_T=1.5708;CAM_PITCH=0.55;CAM_PITCH_T=0.55;SETCFG.zoom=74;if(typeof applyWorldZoom==='function')applyWorldZoom();return 1;"); await sleep(1200);
  await shot('town-villa-modern.png');
  await ev("houseOpen(); return 1;"); await sleep(700);
  console.log('PANEL', JSON.stringify(await ev("return {open:HOUSE_OPEN,disp:getComputedStyle(document.getElementById('housePanel')).display,gold:WSC.role.gold,body:(document.getElementById('houseBody').innerText||'').slice(0,260)};")));
  await ev("HOUSE_DAYS=1;houseDoBuy();return 1;"); await sleep(1400);
  console.log('BOUGHT', JSON.stringify(await ev("return {gold:WSC.role.gold,owner:(HOUSE_DATA['villa_1']||{}).owner_name,rem:(HOUSE_DATA['villa_1']||{}).remaining_days,msg:(document.getElementById('houseBody').innerText||'').slice(-120)};")));
  const s2=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(ROOT,'docs','shots','town-house-bought.png'),Buffer.from(s2.result.data,'base64'));
  // 冰箱：买两瓶水、放进冰箱、再取出
  await ev("shopOpen&&0;return 1;");
  console.log('FRIDGE_INIT', JSON.stringify(await ev("fridgeOpen('villa_1');return {open:FRIDGE_OPEN};")));
  await sleep(700);
  console.log('FRIDGE_OPEN', JSON.stringify(await ev("return {items:FRIDGE_ITEMS.length,cap:FRIDGE_CAP,msg:FRIDGE_MSG};")));
  // 真实二楼：楼梯顶/LOFT 脚底高度
  await ev("P.x=-202.8;P.z=70.3;P.air=false;VIL_FLOOR=0;return 1;"); await sleep(700);
  console.log('FLOOR', JSON.stringify(await ev("return {y:+P.y.toFixed(2),gy:+P.gy.toFixed(2),vf:+VIL_FLOOR.toFixed(2),at:!!townVillaAt(P.x,P.z)};")));
  // 走到床边睡觉
  await ev("houseClose();var _b=townHouseBed(TOWN_HOUSES.find(function(q){return q.id==='villa_1';}));P.x=_b[0];P.z=_b[1];try{wsSend('move',{x:P.x,z:P.z,yaw:P.yaw,jy:0});}catch(e){};return 1;"); await sleep(1400);
  console.log('BED', JSON.stringify(await ev("return {near:SLEEP_NEAR?SLEEP_NEAR.id:null,atk:document.getElementById('atk').className,prompt:document.getElementById('sleepPrompt').style.display};")));
  await ev("trySleep();return 1;"); await sleep(1000);
  console.log('SLEEP', JSON.stringify(await ev("return {me:MY_SLEEP,P:[+P.x.toFixed(1),+P.z.toFixed(1)],rot:+H.g.rotation.x.toFixed(2),y:+H.g.position.y.toFixed(2),atk:document.getElementById('atk').className};")));
  await shot('town-house-sleep.png');
  await ev("tryWake();return 1;"); await sleep(1000);
  console.log('WAKE', JSON.stringify(await ev("return {me:MY_SLEEP,P:[+P.x.toFixed(1),+P.z.toFixed(1)],rot:+H.g.rotation.x.toFixed(2)};")));
  await ev("houseDoLeave();return 1;"); await sleep(1200);
  console.log('LEFT', JSON.stringify(await ev("return {gold:WSC.role.gold,owner:(HOUSE_DATA['villa_1']||{}).owner_name,rem:(HOUSE_DATA['villa_1']||{}).remaining_days};")));
  const s=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(ROOT,'docs','shots','town-house-panel.png'),Buffer.from(s.result.data,'base64'));
  console.log('ERRORS', JSON.stringify(errs.slice(0,8)));
  try{spawn('taskkill',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore'})}catch(e){}
  try{fs.rmSync(dir,{recursive:true,force:true})}catch(e){}
})();
