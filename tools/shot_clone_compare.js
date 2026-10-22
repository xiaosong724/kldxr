// shot_clone_compare.js -- 双客户端截图：别人眼里的「本体」vs「AI 分身」
// 用法：node tools/shot_clone_compare.js
// 需要：8899 服务已启动；本机有 Chrome
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'docs/shots');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('  ' + a.join(' '));
let FAILS = 0;
const ck = (c, m, got) => {
  if (c) { console.log('  PASS  ' + m); }
  else { FAILS++; console.log('  FAIL  ' + m + '  got=' + JSON.stringify(got)); }
};

async function api(url, body, headers) {
  const r = await fetch(ORIGIN + url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: JSON.stringify(body)
  });
  return r.json();
}

async function launch(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-'));
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--no-first-run', '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1280,800',
    /* ★ 无头 Chrome 默认会把"被遮挡"的页面 rAF 降到 1Hz ✗
       两个客户端里总有一个被判成后台 → 按住 W 几乎走不动 ✓
       下面四个开关就是关掉这层节流（标准做法 ✓）*/
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion',
    'about:blank'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 120 && !t; i++) {
    await sleep(250);
    try {
      const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      t = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
    } catch (e) { }
  }
  if (!t) { throw new Error('Chrome 没起来 port=' + port); }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const wait = {};
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; }
  };
  const send = (method, params) => new Promise(res => {
    const i = ++id; wait[i] = res;
    ws.send(JSON.stringify({ id: i, method: method, params: params || {} }));
  });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) {
      throw new Error('JS 异常: ' + JSON.stringify(r.result.exceptionDetails.text || ''));
    }
    return r.result.result.value;
  };
  return { proc, dir, ws, send, ev };
}

async function login(c, token) {
  await c.send('Page.enable', {});
  await c.send('Runtime.enable', {});
  await c.send('Page.navigate', { url: ORIGIN + '/?t=' + Date.now() });
  await sleep(1200);
  await c.ev('localStorage.setItem("token",' + JSON.stringify(token) + ')');
  await c.send('Page.reload', {});
  await sleep(10000);
  await c.ev('try{annClose()}catch(e){}');
  await sleep(500);
  const err = await c.ev("(document.getElementById('err')||{}).textContent||''");
  if (err) { throw new Error('页面报错: ' + err); }
}

async function key(c, k, code, vk, down) {
  await c.send('Input.dispatchKeyEvent', {
    type: down ? 'keyDown' : 'keyUp',
    key: k, code: code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk
  });
}

/* 无头 Chrome 里非前台页的 rAF 会被节流 → 用 1×1 截图强制出帧。
   （不这么做的话按住 W 一秒只走 0.1 米，测不出走路/跟随 ✓）*/
async function pump1(c) {
  await c.send('Page.captureScreenshot', {
    format: 'jpeg', quality: 1,
    clip: { x: 0, y: 0, width: 4, height: 4, scale: 1 }
  });
}

async function walkB(c, ms) { return walkDist(c, 5); }

/* 按【实际位移】走，不用时间 —— 无头浏览器每帧耗时飘，
   用时间会一会儿走 0.1 米、一会儿走 9 米（踩过 ✓）*/
async function walkDist(c, want, maxIter) {
  maxIter = maxIter || 140;
  const p0 = await c.ev('({x:+P.x.toFixed(2),z:+P.z.toFixed(2)})');
  await c.ev("keys['w']=true");
  let p1 = p0, d = 0;
  for (let i = 0; i < maxIter; i++) {
    await pump1(c);
    await sleep(25);
    p1 = await c.ev('({x:+P.x.toFixed(2),z:+P.z.toFixed(2)})');
    d = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    if (d >= want) { break; }
  }
  await c.ev("keys['w']=false");
  await sleep(150);
  p1 = await c.ev('({x:+P.x.toFixed(2),z:+P.z.toFixed(2)})');
  return { p0: p0, p1: p1, d: Math.hypot(p1.x - p0.x, p1.z - p0.z) };
}

async function shot(c, file, clip) {
  const p = { format: 'png' };
  if (clip) {
    p.clip = { x: Math.max(0, clip.x), y: Math.max(0, clip.y),
               width: Math.max(8, clip.width), height: Math.max(8, clip.height), scale: 3 };
    p.captureBeyondViewport = true;
  }
  const r = await c.send('Page.captureScreenshot', p);
  fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
}

/* 分身特写：按它头顶名牌的位置往下裁一块（人物就在名牌下面 ✓）*/
async function zoomClone(c, file) {
  const r = await c.ev(`(function(){var g=CLONES[window.__cloneCid];
    if(!g||!g._ui||!g._ui.wrap){return null;}
    var b=g._ui.wrap.getBoundingClientRect();
    return {cx:b.x+b.width/2, top:b.y+b.height};})()`);
  if (!r) { return; }
  await shot(c, file, { x: r.cx - 95, y: r.top - 14, width: 190, height: 220 });
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const tag = Math.random().toString(36).slice(2, 5);
  const nmA = '看本体' + tag, nmB = '看分身' + tag;

  // ---- 账号 ----
  const regA = await api('/api/register', { name: nmA, password: 'abc123456' });
  const regB = await api('/api/register', { name: nmB, password: 'abc123456' });
  if (!regA.token || !regB.token) { throw new Error('注册失败: ' + JSON.stringify([regA, regB])); }
  const ridB = regB.role.id;
  const admin = await api('/api/admin/login', { password: 'xiuxian-admin' });
  const AH = { 'X-Admin': admin.token };

  // ---- 让 B 学会 / 装配 AI 分身 ----
  const py = [
    'import sqlite3,sys,time',
    'c=sqlite3.connect("game.db",timeout=8);rid=int(sys.argv[1]);now=int(time.time()*1000)',
    'c.execute("INSERT OR IGNORE INTO skill_learn(role_id,key,kind,tier,at) VALUES(?,?,?,?,?)",(rid,"clone","B",1,now))',
    'c.execute("INSERT OR REPLACE INTO skill_load(role_id,kind,slot,key) VALUES(?,?,?,?)",(rid,"B",0,"clone"))',
    'c.execute("UPDATE roles SET qi=200 WHERE id=?",(rid,));c.commit();print("ok")'
  ].join('\n');
  const tmpPy = path.join(os.tmpdir(), 'cc_' + Date.now() + '.py');
  fs.writeFileSync(tmpPy, py);
  require('child_process').spawnSync('python', [tmpPy, String(ridB)],
    { cwd: path.join(ROOT, 'server'), encoding: 'utf8' });

  // ---- 两个浏览器：A = 观察者（截图），B = 本体（召分身）----
  const portA = 6700 + Math.floor(Math.random() * 50);
  let portB = portA + 60;
  const A = await launch(portA);
  const B = await launch(portB);
  try {
    log('登录 A（观察者）…');
    await login(A, regA.token);
    log('登录 B（本体）…');
    await login(B, regB.token);
    log('A 世界:', JSON.stringify(await A.ev('({on:NET.on,id:WSC.myId,x:+P.x.toFixed(1),z:+P.z.toFixed(1),others:Object.keys(NET.others)})')));
    log('B 世界:', JSON.stringify(await B.ev('({on:NET.on,id:WSC.myId,x:+P.x.toFixed(1),z:+P.z.toFixed(1),load:SK.load.B,learn:Object.keys(SK.learn||{})})')));
    await A.ev(`window.__msgs=[];window.__cerr=null;(function(){
      var old=window.skCloneHandle;
      window.skCloneHandle=function(d){window.__msgs.push(JSON.parse(JSON.stringify(d)));
        try{old(d);}catch(e){window.__cerr=String((e&&e.stack)||e);}};
    })()`);

    // 清场：把已有妖兽收掉，免得名牌/血条挡住对比（只影响本次测试）
    await api('/api/admin/act', { act: 'spawn', name: nmB, n: 0, clear: true }, AH);

    // B 先走 5 米，A 再走 3 米 → 本体停在观察者前方约 2 米
    const mvB = await walkDist(B, 5);
    const mvA = await walkDist(A, 3);
    log('B 移动:', JSON.stringify(mvB.p0), '→', JSON.stringify(mvB.p1),
        '距离=', mvB.d.toFixed(2));
    log('A 移动:', JSON.stringify(mvA.p0), '→', JSON.stringify(mvA.p1),
        '距离=', mvA.d.toFixed(2));
    log('本体前置位移:', mvB.d.toFixed(2), '米（不够也不影响后面的名牌/动画测试）');

    // 强制触发被动：一次只召 1 个（n=1 反复试 ✓ 不然多个分身的名牌会叠在一起 ✗）
    let nB = 0, tries = 0;
    for (let i = 0; i < 70 && nB < 1; i++) {
      await api('/api/admin/act', { act: 'trigB', name: nmB, n: 1 }, AH);
      await sleep(160);
      tries++;
      nB = await B.ev('Object.keys(window.CLONES||{}).length');
    }
    log('召分身用了', tries, '次；B clones=', nB,
        'A clones=', await A.ev('Object.keys(window.CLONES||{}).length'),
        'A cerr=', await A.ev('window.__cerr'));
    ck(nB > 0, 'B 召出了分身', nB);
    await sleep(1200);        // 等 A 收到 spawn
    /* ★ 精确锁定"我们召的那个分身"：按 spawn 包里的 owner 过滤 ✗ 不能用 CLONES 的第一个
       （A 的画面里可能还有别的玩家的分身 / 旧分身 ✓ 踩过）*/
    await A.ev(`(function(){
      var a=(window.__msgs||[]).filter(function(x){return x.spawn&&String(x.owner)===${JSON.stringify(String(ridB))};});
      window.__cloneCid=a.length?a[a.length-1].cid:null;
      return window.__cloneCid;})()`);
    log('分身 cid:', await A.ev('window.__cloneCid'));

    const nA = await A.ev('Object.keys(window.CLONES||{}).length');
    ck(nA > 0, 'A 也看到了分身', nA);
    if (!nA) {
      log('A 收到的 clone 包:', JSON.stringify(await A.ev('(window.__msgs||[]).slice(0,6)')));
      log('A others:', JSON.stringify(await A.ev('Object.keys(NET.others)')));
    }

    // 清怪 + 给本体回满血（分身会跟着主人死 ✗ 别让测试里的怪把他咬死 ✓）
    await api('/api/admin/act', { act: 'heal', name: nmB }, AH);
    await api('/api/admin/act', { act: 'spawn', name: nmB, n: 0, clear: true }, AH);
    await sleep(800);

    // 把别的玩家/妖兽/掉落名牌藏起来（只留本体和分身 ✓ 用 visibility ✗ 不用 display
    //   —— display 会被 UI.plate.show 每帧覆盖，visibility 不会 ✓）
    const iso = await A.ev(`(function(){
      var host=document.getElementById('mobui'); if(!host){return false;}
      var g=CLONES[window.__cloneCid];
      var o=(NET.others||{})[${JSON.stringify(String(ridB))}];
      var a=o&&o.ui&&o.ui.wrap, b=g&&g._ui&&g._ui.wrap;
      if(!a||!b){return false;}
      window.__plateA=a; window.__plateB=b; window.__plateOld=[];
      for(var i=0;i<host.children.length;i++){
        var w=host.children[i]; if(w===a||w===b){continue;}
        window.__plateOld.push([w,w.style.visibility]);
        w.style.visibility='hidden';
      }
      return true;
    })()`);
    ck(iso, '找到本体/分身两块名牌（已隐藏其它名牌）', iso);

    // ---- ① 名牌对比：A 眼里的本体牌 vs 分身牌 ----
    const plate = await A.ev(`(function(){
      var owner=${JSON.stringify(String(ridB))};
      var o=(NET.others||{})[owner];
      var ck=window.__cloneCid||Object.keys(CLONES||{})[0],g=ck&&CLONES[ck];
      if(!o||!o.ui||!g||!g._ui){return null;}
      function desc(w){
        if(!w){return null;}
        var nm=w.children[0], bw=w.children[1], bar=bw&&bw.children[0];
        var cs=getComputedStyle(nm), bs=getComputedStyle(bw), r=w.getBoundingClientRect();
        return {text:nm.textContent, font:cs.fontSize, weight:cs.fontWeight,
          color:cs.color, shadow:cs.textShadow,
          barW:Math.round(bw.getBoundingClientRect().width),
          barH:Math.round(bw.getBoundingClientRect().height),
          barBg:getComputedStyle(bar).backgroundImage,
          w:Math.round(r.width), h:Math.round(r.height),
          rect:{x:r.x,y:r.y,width:r.width,height:r.height},
          shown:w.style.display!=='none'};
      }
      return {owner:desc(o.ui.wrap), clone:desc(g._ui.wrap),
              ownerRect:o.ui.wrap.getBoundingClientRect().toJSON(),
              cloneRect:g._ui.wrap.getBoundingClientRect().toJSON()};
    })()`);
    if (!plate) { throw new Error('拿不到名牌 DOM'); }
    log('本体牌:', JSON.stringify(plate.owner));
    log('分身牌:', JSON.stringify(plate.clone));
    ck(plate.owner.shown && plate.clone.shown, '两块名牌都可见', plate);
    ck(plate.owner.text.trim() === plate.clone.text.trim(), '名字文字一致（忽略运行时的尾空格）',
       [JSON.stringify(plate.owner.text), JSON.stringify(plate.clone.text)]);
    ck(plate.owner.font === plate.clone.font &&
       plate.owner.weight === plate.clone.weight &&
       plate.owner.color === plate.clone.color &&
       plate.owner.shadow === plate.clone.shadow,
       '字体/字重/颜色/阴影一致', [plate.owner, plate.clone]);
    ck(plate.owner.barH === plate.clone.barH &&
       plate.owner.barW === plate.clone.barW &&
       plate.owner.barBg === plate.clone.barBg,
       '血条高度/宽度/渐变一致', [plate.owner, plate.clone]);
    ck(Math.abs(plate.owner.h - plate.clone.h) <= 1,
       '名牌整体高度一致', [plate.owner.h, plate.clone.h]);
    const ov = plate.ownerRect, cl = plate.cloneRect;
    const overlap = !(ov.x + ov.width <= cl.x || cl.x + cl.width <= ov.x ||
                      ov.y + ov.height <= cl.y || cl.y + cl.height <= ov.y);
    log('两块名牌是否重叠:', overlap, '（裁图时会分别隐藏对方 ✓ 不影响对比）');
    const inView = r => r.x >= 0 && r.y >= 0 && r.x + r.width <= 1280 && r.y + r.height <= 800;
    ck(inView(ov) && inView(cl), '两块名牌都在画面内', [ov, cl]);

    await shot(A, path.join(SHOTS, 'clone-plate-full.png'));
    /* ★ 分别隐藏对方再裁图：两块名牌离得近也不会互相叠进画面 ✓ */
    await A.ev("window.__plateB.style.visibility='hidden'");
    await shot(A, path.join(SHOTS, '_plate_owner.png'),
      { x: plate.ownerRect.x - 6, y: plate.ownerRect.y - 6,
        width: plate.ownerRect.width + 12, height: plate.ownerRect.height + 12 });
    await A.ev("window.__plateB.style.visibility=''");
    await A.ev("window.__plateA.style.visibility='hidden'");
    await shot(A, path.join(SHOTS, '_plate_clone.png'),
      { x: plate.cloneRect.x - 6, y: plate.cloneRect.y - 6,
        width: plate.cloneRect.width + 12, height: plate.cloneRect.height + 12 });
    await A.ev("window.__plateA.style.visibility=''");
    fs.writeFileSync(path.join(SHOTS, '_plate.json'),
      JSON.stringify({ owner: plate.ownerRect, clone: plate.cloneRect }, null, 2));

    await shot(A, path.join(SHOTS, 'clone-pair.png'));

    // ---- ② 走路 + ③ 挥刀 ----
    /* ★ 不靠"玩家按键走路"触发 ✗（无头浏览器两个页面里总有一个 rAF 被节流 ✓）
       → 清场后放几只僵尸：分身会自己走过去、到 1.6 米内挥刀 ✓
         这两段都是游戏里真实会发生的动作，不依赖测试脚本 ✓ */
    let nc = await A.ev('!!(window.__cloneCid&&CLONES[window.__cloneCid])');
    for (let i = 0; i < 70 && !nc; i++) {
      await api('/api/admin/act', { act: 'trigB', name: nmB, n: 1 }, AH);
      await sleep(160);
      nc = await A.ev(`(function(){
        var a=(window.__msgs||[]).filter(function(x){return x.spawn&&String(x.owner)===${JSON.stringify(String(ridB))};});
        if(a.length){window.__cloneCid=a[a.length-1].cid;}
        return !!(window.__cloneCid&&CLONES[window.__cloneCid]);})()`);
    }
    log('动画测试前分身 cid:', await A.ev('window.__cloneCid'), '存活=', nc);
    await api('/api/admin/act', { act: 'spawn', name: nmB, n: 0, clear: true }, AH);
    await api('/api/admin/act', { act: 'spawn', name: nmB, n: 3 }, AH);
    await sleep(400);
    const spawn0 = await A.ev(`(function(){var a=(window.__msgs||[]).filter(function(x){return x.spawn&&x.cid===window.__cloneCid;});
      var m=a.length?a[a.length-1]:null; return m?{x:m.x,z:m.z,cid:m.cid}:null;})()`);
    let walk = null, atk = null, bestMove = 0, bestPos = null;
    let walkShot = false, atkShot = false;
    for (let i = 0; i < 130; i++) {
      const s = await A.ev(`(function(){var ck=window.__cloneCid||Object.keys(CLONES||{})[0],g=ck&&CLONES[ck];
        if(!g||!g._hh){return null;}var h=g._hh;
        return {legL:+h.legL.rotation.x.toFixed(3),legR:+h.legR.rotation.x.toFixed(3),
                armL:+h.armL.rotation.x.toFixed(3),armR:+h.armR.rotation.x.toFixed(3),
                swR:+(h.sw?h.sw.rotation.x:0).toFixed(3),
                walkT:+(g._walkT||0).toFixed(2),y:+g.position.y.toFixed(3),
                x:g.position.x,z:g.position.z,_atkT:+((g._atkT==null?-1:g._atkT)).toFixed(2)};})()`);
      if (!s) { break; }
      if (spawn0 && s._atkT < 0) {
        const d0 = Math.hypot(s.x - spawn0.x, s.z - spawn0.z);
        if (d0 > bestMove) { bestMove = d0; bestPos = { x: s.x, z: s.z }; }
      }
      if (!walk && Math.abs(s.legL - s.legR) > 0.5) {
        walk = s;
        await shot(A, path.join(SHOTS, 'clone-walk.png'));
        await zoomClone(A, path.join(SHOTS, 'clone-walk-zoom.png'));
        walkShot = true;
      }
      if (!atk && s._atkT > 0.12 && s._atkT < 0.72) {
        atk = s;
        await shot(A, path.join(SHOTS, 'clone-attack.png'));
        await zoomClone(A, path.join(SHOTS, 'clone-attack-zoom.png'));
        atkShot = true;
      }
      if (walkShot && atkShot) { break; }
      await sleep(55);
    }
    if (!walkShot) { await shot(A, path.join(SHOTS, 'clone-walk.png')); }
    if (!atkShot) { await shot(A, path.join(SHOTS, 'clone-attack.png')); }
    log('走路采样:', JSON.stringify(walk), '离出生点=', bestMove.toFixed(2), bestPos);
    log('挥刀采样:', JSON.stringify(atk));
    ck(walk && Math.abs(walk.legL - walk.legR) > 0.5, '双腿反向摆动（走路）',
       walk && [walk.legL, walk.legR]);
    ck(walk && walk.walkT > 0.2, '走路相位在推进', walk && walk.walkT);
    ck(bestMove > 0.2, '分身确实有位移（朝僵尸走）', bestMove);
    ck(atk && atk._atkT > 0, '分身正在挥刀（atkT 在推进）', atk && atk._atkT);
    ck(atk && Math.abs(atk.armR) > 0.2, '右臂抬起来了', atk && atk.armR);

    // 再抓一张"完整画面"
    await sleep(300);
    await shot(A, path.join(SHOTS, 'clone-final.png'));
  } finally {
    try { A.ws.close(); } catch (e) { }
    try { B.ws.close(); } catch (e) { }
    try { spawn('taskkill', ['/PID', String(A.proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
    try { spawn('taskkill', ['/PID', String(B.proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
    try { fs.rmSync(A.dir, { recursive: true, force: true }); } catch (e) { }
    try { fs.rmSync(B.dir, { recursive: true, force: true }); } catch (e) { }
    try { fs.rmSync(tmpPy, { force: true }); } catch (e) { }
  }
  console.log('');
  if (FAILS) { console.log('FAILED: ' + FAILS); process.exit(1); }
  console.log('全部通过');
})();
