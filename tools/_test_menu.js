const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN='http://127.0.0.1:8899';
const B=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const NM='M'+Math.random().toString(36).slice(2,5),PW='abc123456';
 const reg=await fetch(ORIGIN+'/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:NM,password:PW})}).then(r=>r.json());
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'menu-')),port=10500+Math.floor(Math.random()*10);
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
 console.log('before',await ev('return [!!document.getElementById("setPanel"),getComputedStyle(document.getElementById("camTools")||document.body).display];'));
 await ev('CAMROT.on=true;camApplyVisual();openSet("view");return 1;');
 await sleep(800);
 console.log('after',await ev('var h=document.getElementById("setHead").getBoundingClientRect(),x=document.getElementById("setX").getBoundingClientRect(),b=document.getElementById("setBody").getBoundingClientRect(),c=document.getElementById("camTools");return {headTop:h.top,closeTop:x.top,bodyTop:b.top,bodyH:b.height,scroll:document.getElementById("setBody").scrollHeight,cam:getComputedStyle(c).display,box:document.getElementById("setBox").getBoundingClientRect().toJSON()};'));
 const s=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync(path.join(__dirname,'..','docs','shots','menu-new.png'),Buffer.from(s.result.data,'base64'));
 try{spawn('taskkill',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore'})}catch(e){}
 try{fs.rmSync(dir,{recursive:true,force:true})}catch(e){}
})();
