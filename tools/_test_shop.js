const { spawn, execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const B = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const NM = 'S' + Math.random().toString(36).slice(2, 6), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:NM,password:PW})}).then(r=>r.json());
  try {
    const py = "import sqlite3;c=sqlite3.connect(r'server/game.db');r=c.execute('select id from roles where name=?',(r'''" + NM + "''',)).fetchone();c.execute('insert into pending_gold(role,amount,why,ts,done) values(?,?,?,?,0)',(r[0],1000,'test shop',0));c.commit()";
    execFileSync('python', ['-c', py], { cwd: ROOT, stdio: 'ignore' });
  } catch (e) { console.log('gold seed failed', e.message); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-')), port = 11000 + Math.floor(Math.random()*20);
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
  console.log('DATA', JSON.stringify(await ev("return {shops:TOWN_SHOPS.length,npcs:TOWN_NPCS.length,gold:WSC.role.gold};")));
  // 超市门口内侧
  await ev("var _s=TOWN_SHOPS.find(function(q){return q.id==='mart';});P.x=_s.x;P.z=_s.z;try{wsSend('move',{x:P.x,z:P.z,yaw:P.yaw,jy:0});}catch(e){};return 1;");
  await sleep(1300);
  console.log('NEAR', JSON.stringify(await ev("return {shop:SHOP_NEAR?SHOP_NEAR.id:null,atk:document.getElementById('atk').className,prompt:document.getElementById('shopPrompt').style.display};")));
  await shot('town-npc-shop.png');
  await ev("shopOpen();return 1;"); await sleep(700);
  console.log('PANEL', JSON.stringify(await ev("return {open:SHOP_OPEN,items:SHOP_ITEMS.length,title:document.getElementById('shopTitle').textContent,body:(document.getElementById('shopBody').innerText||'').slice(0,240)};")));
  const s=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(ROOT,'docs','shots','town-shop-panel.png'),Buffer.from(s.result.data,'base64'));
  await ev("shopBuy('water');return 1;"); await sleep(1300);
  console.log('BOUGHT', JSON.stringify(await ev("return {gold:WSC.role.gold,msg:SHOP_MSG,bag:BAG.items.map(function(e){return e.item&&e.item.name;}).filter(Boolean)};")));
  await ev("bagFetch();return 1;"); await sleep(900);
  console.log('USE', JSON.stringify(await ev("var rec=null;for(var i=0;i<BAG.items.length;i++){if(BAG.items[i].item&&BAG.items[i].item.kind==='food'){rec=BAG.items[i];break;}}if(!rec)return {err:'no food'};BAG.sel=rec.id;bagRender();var hp0=HP;document.getElementById('bagUse').click();return {iid:rec.id,hp0:hp0,model:rec.item.model,act:document.getElementById('bagUse').getAttribute('data-act')};")));
  await sleep(350);
  console.log('EAT', JSON.stringify(await ev("return {eatT:+EAT_T.toFixed(2),arm:+H.armR.rotation.x.toFixed(2),hp:HP,bag:BAG.items.length};")));
  await shot('town-shop-eat.png');
  await sleep(1400);
  console.log('AFTER', JSON.stringify(await ev("return {eatT:EAT_T,hp:HP,bag:BAG.items.map(function(e){return e.item&&e.item.name;}).filter(Boolean)};")));
  console.log('ERRORS', JSON.stringify(errs.slice(0,8)));
  try{spawn('taskkill',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore'})}catch(e){}
  try{fs.rmSync(dir,{recursive:true,force:true})}catch(e){}
})();
