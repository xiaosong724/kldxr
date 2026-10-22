const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN='http://127.0.0.1:8899';
const B=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const NM='S'+Math.random().toString(36).slice(2,5),PW='abc123456';
 const reg=await fetch(ORIGIN+'/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:NM,password:PW})}).then(r=>r.json());
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'set-')),port=10600+Math.floor(Math.random()*10);
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
 await ev("openSet('bag'); return 1;");
 await sleep(600);
 console.log('bag', await ev('var g=document.getElementById("bagGrid");return {slots:g?g.querySelectorAll(".slot").length:-1,cols:g?getComputedStyle(g).gridTemplateColumns:""};'));
 console.log('settings', await ev('var on=[...document.querySelectorAll("#setPanel .tabpane.on")].map(function(p){return p.getAttribute("data-pane")});var subs=[...document.querySelectorAll("#setPanel .setSub")];var vis=subs.filter(function(s){return s.offsetParent!==null});var tabs=document.getElementById("setTabs").getBoundingClientRect();var head=document.getElementById("setHead").getBoundingClientRect();return {panes:on,subs:subs.length,visibleSubs:vis.length,subParents:vis.map(function(s){return s.closest(".tabpane").getAttribute("data-pane")}),tabsTop:tabs.top,headTop:head.top,theme:document.body.getAttribute("data-theme"),themeBtns:document.querySelectorAll("#themeBtns [data-theme]").length};'));
 await ev("document.querySelector('#setPanel .setSub .sub[data-sub=\"ctrl\"]').click(); return 1;");
 await sleep(300);
 console.log('after ctrl', await ev('return {panes:[...document.querySelectorAll("#setPanel .tabpane.on")].map(function(p){return p.getAttribute("data-pane")}),activeSubs:[...document.querySelectorAll("#setPanel .setSub .sub.on")].map(function(x){return x.getAttribute("data-sub")}),mainOn:[...document.querySelectorAll("#setTabs .tab.on")].map(function(x){return x.getAttribute("data-tab")})};'));
 await ev("uiThemeApply('light'); return 1;");
 await sleep(300);
 console.log('theme light', await ev('return {theme:document.body.getAttribute("data-theme"),bg:getComputedStyle(document.getElementById("setBox")).backgroundImage,loginBg:getComputedStyle(document.getElementById("loginCard")).backgroundImage};'));
 await ev("openSet('ui'); return 1;"); await sleep(400);
 console.log('ui pane', await ev('return {panes:[...document.querySelectorAll("#setPanel .tabpane.on")].map(function(p){return p.getAttribute("data-pane")}),themeBtns:document.querySelectorAll("#themeBtns [data-theme]").length,visibleTheme:!!document.querySelector("#themeBtns")&&document.querySelector("#themeBtns").offsetParent!==null};'));
 await ev("uiThemeApply('pink'); return 1;"); await sleep(200);
 console.log('pink', await ev('return {theme:document.body.getAttribute("data-theme"),boxBg:getComputedStyle(document.getElementById("setBox")).backgroundImage,loginCard:getComputedStyle(document.getElementById("loginCard")).backgroundImage,after:getComputedStyle(document.getElementById("loginCard"),"::after").backgroundColor};'));
 await ev("uiThemeApply('black'); return 1;"); await sleep(200);
 console.log('black', await ev('return {theme:document.body.getAttribute("data-theme"),boxBg:getComputedStyle(document.getElementById("setBox")).backgroundImage};'));
await ev("uiThemeApply('glass'); return 1;"); await sleep(250);
 console.log('glass', await ev('return {theme:document.body.getAttribute("data-theme"),btn:document.querySelectorAll("#themeBtns [data-theme]").length,bg:getComputedStyle(document.getElementById("setBox")).backgroundImage,blur:getComputedStyle(document.getElementById("setBox")).backdropFilter};'));
const s=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync(path.join(__dirname,'..','docs','shots','menu-theme-light.png'),Buffer.from(s.result.data,'base64'));
 try{spawn('taskkill',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore'})}catch(e){}
 try{fs.rmSync(dir,{recursive:true,force:true})}catch(e){}
})();
