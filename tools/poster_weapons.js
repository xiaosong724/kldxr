// 生成「武器图鉴」海报（图标 = 游戏自己的 3D 武器模型，离屏渲染 ✗ 不是截图拼的）
//
// ★★ 这就是「我们的图」的【图鉴版】✗ 和 tools/poster_news.js（公告版）同一套配色与版式 ✓
//   ★ 数据来自 tools/poster_weapons_data.py（直接读 server/weapons.py ✗ 不手抄）
//   ★ 规格见 docs/格式-公告海报.md
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'];
const B = process.env.CHROME || CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ROOT = path.resolve(__dirname, '..');
const TIER = 9;          // 图标用 9 阶（灵宝）—— 冷白偏蓝，块面清楚

function posterHtml(data, icons) {
  const W = 1180;
  const card = (w) => {
    const stats = [
      ['每刀间隔', w.interval.toFixed(2) + ' 秒'],
      ['射程', w.reach.toFixed(1) + ' 米'],
      ['扇形', w.ranged ? '单体（箭矢）' : (w.arcDeg + '°')],
      ['伤害系数', w.coeff[0].toFixed(2) + ' ~ ' + w.coeff[1].toFixed(2)],
    ].map(s => `<div class="st"><b>${s[0]}</b><span>${s[1]}</span></div>`).join('');
    return `
    <div class="card">
      <div class="chead">
        <div class="ico"><img src="${icons[w.look] || ''}" alt=""></div>
        <div>
          <div class="nm">${w.name}</div>
          <div class="sub">${w.ranged ? '远程武器' : '近战武器'} · 机制「${w.fxName}」</div>
        </div>
      </div>
      <div class="stats">${stats}</div>
      <div class="fx"><i>机制</i>${w.fxText}</div>
      <div class="tip">${w.tip}</div>
    </div>`;
  };
  const tiers = data.tiers.map(t =>
    `<span class="tier" style="color:${t.col};border-color:${t.col}66;background:${t.col}18">${t.i} ${t.name}</span>`
  ).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{width:${W}px;background:#14120d;font-family:system-ui,"Microsoft YaHei","PingFang SC",sans-serif;
    color:#dfe8d4;-webkit-font-smoothing:antialiased}
  .wrap{position:relative;padding:46px 44px 40px;
    background:
      radial-gradient(1200px 620px at 50% -8%, #3d3424 0%, #241f16 46%, #14120d 100%),
      repeating-linear-gradient(0deg,#0000 0 38px,#ffffff06 38px 39px),
      repeating-linear-gradient(90deg,#0000 0 38px,#ffffff06 38px 39px)}
  .wrap:after{content:"";position:absolute;inset:0;pointer-events:none;
    background:radial-gradient(760px 420px at 50% 26%,#ffd83d10 0%,#0000 72%)}
  .hd{text-align:center;margin-bottom:26px;position:relative;z-index:1}
  .hd h1{font-size:56px;letter-spacing:12px;color:#ffd83d;text-shadow:0 3px 0 #00000077,0 0 30px #ffd83d44}
  .hd .sub{margin-top:11px;font-size:19px;color:#b9c2a8;letter-spacing:2px}
  .hd .line{width:200px;height:3px;margin:17px auto 0;border-radius:2px;
    background:linear-gradient(90deg,#ffd83d00,#ffd83dbb,#ffd83d00)}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;position:relative;z-index:1}
  .card{background:linear-gradient(180deg,#252a2299,#1a1d1899);border:2px solid #ffffff16;
    border-radius:14px;padding:15px 17px 14px;box-shadow:0 7px 20px #00000066,inset 0 1px 0 #ffffff10}
  .chead{display:flex;align-items:center;gap:15px}
  .ico{width:108px;height:108px;flex:0 0 108px;border-radius:13px;position:relative;
    background:radial-gradient(circle at 42% 30%,#465140 0%,#2a3025 55%,#171a14 100%);
    border:2px solid #ffffff1c;box-shadow:inset 0 2px 10px #00000077}
  .ico img{position:absolute;inset:6%;width:88%;height:88%;object-fit:contain;
    filter:drop-shadow(0 3px 4px #0009)}
  .nm{font-size:32px;font-weight:800;color:#ffd83d;letter-spacing:3px;text-shadow:0 2px 0 #00000066}
  .sub{margin-top:6px;font-size:14px;color:#9fb08f;letter-spacing:1px}
  .stats{display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;margin:12px 0 10px}
  .st{display:flex;align-items:baseline;gap:7px;font-size:14px}
  .st b{font-weight:600;color:#8fa07c;font-size:12.5px;letter-spacing:1px}
  .st span{color:#e8f0dc;font-variant-numeric:tabular-nums}
  .fx{font-size:13.5px;line-height:1.65;color:#c9d3ba;background:#ffffff09;border-radius:9px;
    padding:8px 11px;border-left:3px solid #8ee0a888}
  .fx i{font-style:normal;display:inline-block;margin-right:8px;padding:1px 7px;border-radius:6px;
    font-size:12px;color:#11170f;background:#8ee0a8;font-weight:700;letter-spacing:1px}
  .tip{margin-top:9px;font-size:13px;color:#9aa38f;line-height:1.55}
  .ft{margin-top:26px;position:relative;z-index:1}
  .ft .ttl{font-size:15px;color:#8fa07c;letter-spacing:3px;margin-bottom:10px}
  .tiers{display:flex;flex-wrap:wrap;gap:7px}
  .tier{font-size:13px;padding:3px 10px;border:1px solid;border-radius:20px;letter-spacing:1px}
  .notes{margin-top:19px;font-size:12.5px;line-height:1.9;color:#8f9a84;
    border-top:1px solid #ffffff14;padding-top:15px}
  .notes b{color:#c9d3ba;font-weight:600}
  </style></head><body><div class="wrap">
    <div class="hd">
      <h1>武 器 图 鉴</h1>
      <div class="sub">八种武器 · 手感 / 距离 / 机制（数值为 12 阶封顶）</div>
      <div class="line"></div>
    </div>
    <div class="grid">${data.weapons.map(card).join('')}</div>
    <div class="ft">
      <div class="ttl">品 阶 <span style="font-size:12px;letter-spacing:1px;color:#6f7a66">（颜色 = 掉落物 / 背包里的颜色）</span></div>
      <div class="tiers">${tiers}</div>
      <div class="notes">
        <b>攻速与伤害：</b>攻速快的武器单次伤害低、慢的高 —— 总输出（DPS）是拉平的，挑顺手的就行。<br>
        <b>伤害封顶：</b>装备最多贡献总伤害的 60%~68%（品阶越高上限越高）：高品阶永远更强，但低级神装撑不到满级。<br>
        <b>伤害系数：</b>掉落时随机滚出来的倍率 —— 同一把武器，数值也可能不一样。<br>
        <b>机制触发率</b>写的是 12 阶（满品阶）的值；1 阶从技能说明里的最低值起步，随品阶提升。
      </div>
    </div>
  </div></body></html>`;
}

(async () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '_poster_data.json'), 'utf8'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poster-'));
  const port = 9983;
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1300,1200', ORIGIN + '/'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 120 && !target; i++) {
    await sleep(250);
    try {
      const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      target = l.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) { }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const wait = {};
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; } };
  const send = (m, p) => new Promise(res => { const i = ++id; wait[i] = res; ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  const ev = async x => {
    const r = await send('Runtime.evaluate', { expression: '(function(){' + x + '})()', returnByValue: true, awaitPromise: true });
    if (r && r.result && r.result.exceptionDetails) {
      const ed = r.result.exceptionDetails;
      return '__THROW__ ' + String((ed.exception && ed.exception.description) || ed.text).slice(0, 300);
    }
    return r && r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable', {});
  await send('Page.enable', {});
  for (let i = 0; i < 80; i++) {
    if (await ev('return (typeof buildWeaponMesh === "function") && (typeof THREE !== "undefined");')) { break; }
    await sleep(300);
  }

  await ev([
    'if (window.__wr) { return "ok"; }',
    'var r = new THREE.WebGLRenderer({ alpha: true, antialias: true });',
    'r.setSize(340, 340, false);',
    'r.setClearColor(0x000000, 0);',
    'var sc = new THREE.Scene();',
    'var cam2 = new THREE.PerspectiveCamera(26, 1, 0.01, 200);',
    'sc.add(new THREE.HemisphereLight(0xeaf2e0, 0x424836, 0.95));',
    'var d1 = new THREE.DirectionalLight(0xfff6e2, 1.15); d1.position.set(2.6, 3.8, 2.6); sc.add(d1);',
    'var d2 = new THREE.DirectionalLight(0x9fd8ff, 0.6); d2.position.set(-2.6, 1.4, -2.0); sc.add(d2);',
    'var d3 = new THREE.DirectionalLight(0xffffff, 0.28); d3.position.set(0, -2.2, 1.4); sc.add(d3);',
    'window.__wr = { r: r, sc: sc, cam: cam2 };',
    'return "ok";',
  ].join(''));

  const icons = {};
  for (const w of data.weapons) {
    const url = await ev([
      'var W = window.__wr, lk = ' + JSON.stringify(w.look) + ', tier = ' + TIER + ';',
      'while (W.sc.children.length > 2) { W.sc.remove(W.sc.children[2]); }',
      'var g = buildWeaponMesh(lk, tier);',
      'var box = new THREE.Box3().setFromObject(g);',
      'var c = box.getCenter(new THREE.Vector3());',
      'g.position.sub(c);',
      'W.sc.add(g);',
      'var sz = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());',
      'var half = Math.max(sz.x, sz.y, sz.z) / 2;',
      'var fov = W.cam.fov * Math.PI / 180;',
      'var dist = (half / Math.tan(fov / 2)) * 1.06;',   // 1.16 = 留白
      'var dir = new THREE.Vector3(0.42, 0.30, 1.0).normalize();',
      'W.cam.position.copy(dir.multiplyScalar(dist));',
      'W.cam.lookAt(0, 0, 0);',
      'W.cam.updateProjectionMatrix();',
      'W.r.render(W.sc, W.cam);',
      'return W.r.domElement.toDataURL("image/png");',
    ].join(''));
    if (typeof url !== 'string' || url.indexOf('data:image/png') !== 0) {
      console.log('  ✗ ' + w.look + ': ' + String(url).slice(0, 150));
      icons[w.look] = '';
    } else {
      icons[w.look] = url;
    }
  }
  console.log('  3D 图标: ' + Object.keys(icons).map(k => k + (icons[k] ? '✓' : '✗')).join(' '));

  const html = posterHtml(data, icons);
  const hp = path.join(ROOT, 'tools', '_poster.html');
  fs.writeFileSync(hp, html, 'utf8');
  await send('Page.navigate', { url: 'file:///' + hp.replace(/\\/g, '/') });
  await sleep(1600);
  const box = await ev('return JSON.stringify({w: document.body.scrollWidth, h: document.body.scrollHeight});');
  const b = JSON.parse(box);
  console.log('  画布: ' + b.w + '×' + b.h);
  const s = await send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: b.w, height: b.h, scale: 2 },
  });
  if (s && s.result && s.result.data) {
    const out = path.join(ROOT, 'docs', 'shots', '武器图鉴.png');
    fs.writeFileSync(out, Buffer.from(s.result.data, 'base64'));
    console.log('  出图: docs/shots/武器图鉴.png（' + Math.round(fs.statSync(out).size / 1024) + ' KB）');
  }
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
})();
