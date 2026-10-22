const { spawn, execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const B = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const NM = 'T' + Math.random().toString(36).slice(2, 6), PW = 'abc123456';
  const reg = await fetch(ORIGIN + '/api/register', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:NM,password:PW})}).then(r=>r.json());
  try { execFileSync('python', [path.join(__dirname,'_set_gold.py'), NM, '20000000'], {stdio:'ignore'}); } catch(e) { console.log('GOLD_SET_FAIL', String(e).slice(0,120)); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-')), port = 10600 + Math.floor(Math.random()*20);
  const proc = spawn(B, ['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--user-data-dir='+dir,'--remote-debugging-port='+port,'--window-size=1400,900',ORIGIN+'/'],{stdio:'ignore'});
  let t=null; for(let i=0;i<120&&!t;i++){await sleep(250);try{const l=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();t=l.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)}catch(e){}}
  const ws=new WebSocket(t.webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r); let id=0; const w={}; const errs=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.method==='Runtime.exceptionThrown'){errs.push(m.params.exceptionDetails.text);} if(m.id&&w[m.id]){w[m.id](m);delete w[m.id]}};
  const send=(m,p)=>new Promise(res=>{const i=++id;w[i]=res;ws.send(JSON.stringify({id:i,method:m,params:p||{}}))});
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:'(function(){'+x+'})()',returnByValue:true,awaitPromise:true});return r.result&&r.result.result?r.result.result.value:undefined};
  await send('Runtime.enable',{}); await sleep(900);
  await ev('localStorage.setItem("token",'+JSON.stringify(reg.token)+'); location.reload(); return 1;'); await sleep(11000);
  await ev('var bs=document.querySelectorAll("button"); for(var i=0;i<bs.length;i++){if((bs[i].textContent||"").indexOf("知道了")>=0){bs[i].click();}} return 1;'); await sleep(700);
  console.log('BTN', JSON.stringify(await ev("return {btn:!!document.getElementById('townBtn'),panel:!!document.getElementById('townPanel'),fn:typeof townOpen};")));
  await ev('townOpen(); return 1;'); await sleep(1200);
  console.log('OPEN', JSON.stringify(await ev("return {open:document.getElementById('townPanel').className,body:(document.getElementById('townBody').innerText||'').slice(0,300),towns:(window.MY_TOWNS||[]).length};")));
  await ev("document.getElementById('townName').value='测试小镇';document.getElementById('townX').value='400';document.getElementById('townZ').value='0';townCreate();return 1;");
  await sleep(1200);
  console.log('RESULT', JSON.stringify(await ev("return {towns:(window.MY_TOWNS||[]).length,body:(document.getElementById('townBody').innerText||'').slice(0,240)};")));
  const s=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(ROOT,'docs','shots','town-panel.png'),Buffer.from(s.result.data,'base64'));
  console.log('ERRORS', JSON.stringify(errs.slice(0,5)));
  try{spawn('taskkill',['/PID',String(proc.pid),'/T','/F'],{stdio:'ignore'})}catch(e){}
  try{fs.rmSync(dir,{recursive:true,force:true})}catch(e){}
})();
