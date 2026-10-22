const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN='http://127.0.0.1:8899';
const B=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const NM='W'+Math.random().toString(36).slice(2,5),PW='abc123456';
 const admin=await fetch(ORIGIN+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'xiuxian-admin'})}).then(r=>r.json());
 const reg=await fetch(ORIGIN+'/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:NM,password:PW})}).then(r=>r.json());
 const giveR=await fetch(ORIGIN+'/api/admin/act',{method:'POST',headers:{'Content-Type':'application/json','X-Admin':admin.token},body:JSON.stringify({act:'give',name:NM,kind:'sword',tier:2})}); console.log('give',NM,await giveR.text());
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wh-')),port=10700+Math.floor(Math.random()*10);
 const proc=spawn(B,['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--user-data-dir='+dir,'--remote-debugging-port='+port,'--window-size=1600,1000',ORIGIN+'/'],{stdio:'ignore'});
 let t=null;for(let i=0;i<120&&!t;i++){await sleep(250);try{const l=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();t=l.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)}catch(e){}}
 const ws=new WebSocket(t.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let id=0;const w={};
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&w[m.id]){w[m.id](m);delete w[m.id]}};
 const send=(m,p)=>new Promise(res=>{const i=++id;w[i]=res;ws.send(JSON.stringify({id:i,method:m,params:p||{}}))});
 const ev=async x=>{const r=await send('Runtime.evaluate',{expression:'(function(){'+x+'})()',returnByValue:true,awaitPromise:true});return r.result&&r.result.result?r.result.result.value:undefined};
 await send('Runtime.enable',{});await sleep(800);
 await ev('localStorage.setItem("token",'+JSON.stringify(reg.token)+');location.reload();return 1;');await sleep(9000);
 await ev('var bs=document.querySelectorAll("button");for(var i=0;i<bs.length;i++){if((bs[i].textContent||"").indexOf("知道了")>=0)bs[i].click();}return 1;');
 await sleep(500);
 console.log('town',await ev('return {group:!!TOWN_GROUP,children:TOWN_GROUP?TOWN_GROUP.children.length:0,solids:TOWN_SOLIDS.length,roofs:TOWN_ROOFS.length,safe:SAFE_HALF};'));
 // 把本地位置放到仓库柜台旁，等移动包上报后打开
 await ev('for(var i=1;i<=30;i++){P.x=TOWN_COUNTER.x-1.9;P.z=TOWN_COUNTER.z;try{wsSend("move",{x:P.x,z:P.z,yaw:P.yaw,jy:0});}catch(e){}}return [P.x,P.z];');await sleep(900);
 console.log('near',await ev('return [P.x,P.z,WH_NEAR, townNearWarehouse(P.x,P.z)];'));
 const who=await fetch(ORIGIN+'/api/admin/who?name='+encodeURIComponent(NM),{headers:{'X-Admin':admin.token}}).then(r=>r.text());console.log('who',who.slice(0,500));
 console.log('doors',await ev('return TOWN_BUILDINGS.map(function(b){var d={east:[b.x1,b.door_at],west:[b.x0,b.door_at],north:[b.door_at,b.z0],south:[b.door_at,b.z1]}[b.door];return [b.k,!!blocked(d[0],d[1],0.3,0.25,false),!!blocked((b.x0+b.x1)/2,b.z0,0.3,0.25,false)];});'));
 console.log('roof',await ev('return [TOWN_ROOFS[0].g.visible, TOWN_ROOFS[0].x0,TOWN_ROOFS[0].x1,TOWN_ROOFS[0].z0,TOWN_ROOFS[0].z1];'));
 console.log('ws',await ev('return [WSC.ready, WSC.sock?WSC.sock.readyState:-1, wsSend("warehouse_open",{})];'));await sleep(900);await ev('whOpen();return 1;');await sleep(1200);
 console.log('bag',await ev('return {bag:WH.bag.length,store:WH.store.length,cells:document.querySelectorAll("#whBag .whSlot").length};'));
 await ev('whPickPage("bag");whMoveMany("store");return 1;');await sleep(1000);
 console.log('moved',await ev('return {bag:WH.bag.length,store:WH.store.length,used:WH.used};'));
 console.log('wh',await ev('return {open:WH.open,display:getComputedStyle(document.getElementById("whPanel")).display,bag:WH.bag.length,store:WH.store.length,used:WH.used,cap:WH.cap,atk:document.getElementById("atk").className};'));
 const s=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync(path.join(__dirname,'..','docs','shots','town-warehouse-test.png'),Buffer.from(s.result.data,'base64'));
 await ev('whClose();return 1;');await sleep(300);
 try{spawn('taskkill',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore'})}catch(e){}
 try{fs.rmSync(dir,{recursive:true,force:true})}catch(e){}
})();
