// 海报模板 · 共用库（★ 这就是"我们的图"的格式：暗金底 + 金标题 + 圆角卡片）
//
// 用法（别的脚本里）：
//   const P = require('./poster_lib');
//   const html = P.page({ title: '…', sub: '…', body: '…' });
//   await P.make(html, 'docs/shots/xxx');     // → xxx.png（2x）+ xxx-手机.jpg（1x）
//
// ★ 设计规格（改之前先看 docs/格式-公告海报.md ✓）
//   底色 #14120d · 卡面 #252a22→#1a1d18 · 金 #ffd83d · 正文 #dfe8d4 · 次要 #8f9a84
//   宽 1180（出图 2x = 2360）· 标题 56px/字距 12 · 卡标题 20.5px · 正文 13.5px
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'];

const CHROME = process.env.CHROME ||
  CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });

const C = {
  bg: '#14120d',
  gold: '#ffd83d',
  text: '#dfe8d4',
  dim: '#8f9a84',
  green: '#8ee0a8',
  // 分类标签配色（公告用）：左 = 颜色名 ✗ 右 = 值 ✓
  tag: {
    战斗: '#ff9a5c', 掉落: '#8ee0a8', 挂机: '#8fd28a', 成长: '#8fc4ff',
    背包: '#c08fff', 装备: '#ffd83d', 交易行: '#ffe08a', 画面: '#5cf0ff',
    修复: '#ff6a5c', 提示: '#9fb08f', 群: '#5cd0ff', 其它: '#b9c2a8',
    玩法: '#ff9a5c', 系统: '#8fc4ff', 优化: '#8ee0a8', 修复bug: '#ff6a5c',
  },
};

// 页面骨架 + 全套样式（★ 所有海报都走这一份 ✗ 别各写一份 ✓）
function page(opt) {
  const W = opt.width || 1180;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{width:${W}px;background:${C.bg};font-family:system-ui,"Microsoft YaHei","PingFang SC",sans-serif;
    color:${C.text};-webkit-font-smoothing:antialiased}
  .wrap{position:relative;padding:46px 44px 38px;
    background:
      radial-gradient(1200px 620px at 50% -8%, #3d3424 0%, #241f16 46%, #14120d 100%),
      repeating-linear-gradient(0deg,#0000 0 38px,#ffffff06 38px 39px),
      repeating-linear-gradient(90deg,#0000 0 38px,#ffffff06 38px 39px)}
  .wrap:after{content:"";position:absolute;inset:0;pointer-events:none;
    background:radial-gradient(760px 420px at 50% 22%,#ffd83d10 0%,#0000 72%)}
  .hd{text-align:center;margin-bottom:24px;position:relative;z-index:1}
  .hd h1{font-size:56px;letter-spacing:12px;color:${C.gold};
    text-shadow:0 3px 0 #00000077,0 0 30px #ffd83d44}
  .hd .sub{margin-top:11px;font-size:19px;color:#b9c2a8;letter-spacing:2px}
  .hd .line{width:200px;height:3px;margin:16px auto 0;border-radius:2px;
    background:linear-gradient(90deg,#ffd83d00,#ffd83dbb,#ffd83d00)}
  .ft{margin-top:22px;position:relative;z-index:1;text-align:center}
  .ft .box{border-top:1px solid #ffffff14;padding-top:15px;font-size:13px;line-height:1.9;color:${C.dim}}
  .ft .box b{color:#c9d3ba}
  .ft .badge{display:inline-block;margin-bottom:9px;padding:3px 12px;border-radius:20px;
    font-size:12.5px;letter-spacing:2px;color:#11170f;background:${C.green};font-weight:700}
  ${opt.css || ''}
  </style></head><body><div class="wrap">
    <div class="hd">
      <h1>${opt.title}</h1>
      <div class="sub">${opt.sub || ''}</div>
      <div class="line"></div>
    </div>
    ${opt.body || ''}
    ${opt.foot ? `<div class="ft"><div class="box">${opt.foot}</div></div>` : ''}
  </div></body></html>`;
}

// 公告用：编号 + 标签 + 标题 + 若干条要点（两列瀑布流 ✓ 自然高度 ✗ 不会空一大块）
function cards(items, opt) {
  const tagCol = (t) => (C.tag[t] || '#dfe8d4');
  const one = (it, i) => {
    const col = tagCol(it.tag);
    return `
    <div class="card">
      <div class="ch">
        <div class="no">${String(i + 1).padStart(2, '0')}</div>
        <div class="tt">
          ${it.tag ? `<div class="tag" style="color:${col};border-color:${col}66;background:${col}1a">${it.tag}</div>` : ''}
          <div class="h">${it.t}</div>
        </div>
      </div>
      <ul>${(it.b || []).map(x => '<li>' + x + '</li>').join('')}</ul>
    </div>`;
  };
  return `<style>
  .grid{column-count:${(opt && opt.cols) || 2};column-gap:15px;position:relative;z-index:1}
  .card{background:linear-gradient(180deg,#252a2299,#1a1d1899);border:2px solid #ffffff16;
    border-radius:14px;padding:14px 16px 13px;box-shadow:0 7px 20px #00000066,inset 0 1px 0 #ffffff10;
    break-inside:avoid;-webkit-column-break-inside:avoid;margin-bottom:15px}
  .ch{display:flex;align-items:center;gap:12px;margin-bottom:9px}
  .no{font-size:26px;font-weight:800;color:#ffd83d;letter-spacing:1px;
    font-variant-numeric:tabular-nums;text-shadow:0 2px 0 #00000066;min-width:42px}
  .tag{display:inline-block;padding:1px 8px;border:1px solid;border-radius:20px;
    font-size:11.5px;letter-spacing:2px;margin-bottom:5px}
  .h{font-size:20.5px;font-weight:800;color:#eef4e4;letter-spacing:1px;line-height:1.3}
  ul{list-style:none}
  li{position:relative;padding-left:15px;font-size:13.5px;line-height:1.72;color:#c2ccb4;margin-top:3px}
  li:before{content:"";position:absolute;left:2px;top:9px;width:6px;height:6px;border-radius:2px;
    background:#8ee0a877}
  li b{color:#ffd83d;font-weight:700}
  </style><div class="grid">${items.map(one).join('')}</div>`;
}

// 无头 Chrome 出图：PNG（2x，发群里/存档）+ JPG（1x，手机看）
async function make(html, outBase, opt) {
  const o = opt || {};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poster-'));
  const port = 9900 + Math.floor(Math.random() * 90);
  const hp = path.join(dir, 'p.html');
  fs.writeFileSync(hp, html, 'utf8');
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=1300,1200', 'file:///' + hp.replace(/\\/g, '/')], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 120 && !target; i++) {
    await new Promise(r => setTimeout(r, 250));
    try {
      const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      target = l.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) { }
  }
  if (!target) { throw new Error('Chrome 起不来（找不到 CDP 页面）'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const wait = {};
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; }
  };
  const send = (method, params) => new Promise(res => {
    const i = ++id; wait[i] = res;
    ws.send(JSON.stringify({ id: i, method: method, params: params || {} }));
  });
  const ev = async (x) => {
    const r = await send('Runtime.evaluate', { expression: '(function(){' + x + '})()', returnByValue: true });
    if (r && r.result && r.result.exceptionDetails) {
      const ed = r.result.exceptionDetails;
      return '__THROW__ ' + String((ed.exception && ed.exception.description) || ed.text);
    }
    return r && r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable', {});
  await send('Page.enable', {});
  await new Promise(r => setTimeout(r, 1200));
  const b = JSON.parse(await ev(
    'return JSON.stringify({w:document.body.scrollWidth,h:document.body.scrollHeight})'));
  const clip = { x: 0, y: 0, width: b.w, height: b.h, scale: o.scale || 2 };
  const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: clip });
  const pngPath = outBase + '.png';
  if (png && png.result && png.result.data) {
    fs.mkdirSync(path.dirname(pngPath), { recursive: true });
    fs.writeFileSync(pngPath, Buffer.from(png.result.data, 'base64'));
  }
  const jpg = await send('Page.captureScreenshot', {
    format: 'jpeg', quality: 92, captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: b.w, height: b.h, scale: 1 },
  });
  const jpgPath = outBase + '-手机.jpg';
  if (jpg && jpg.result && jpg.result.data) {
    fs.writeFileSync(jpgPath, Buffer.from(jpg.result.data, 'base64'));
  }
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  const kb = (p) => { try { return Math.round(fs.statSync(p).size / 1024) + ' KB'; } catch (e) { return '?'; } };
  console.log('  画布: ' + b.w + '×' + b.h);
  console.log('  ' + path.basename(pngPath) + '（' + kb(pngPath) + '）· ' +
              path.basename(jpgPath) + '（' + kb(jpgPath) + '）');
  return { png: pngPath, jpg: jpgPath, w: b.w, h: b.h };
}

module.exports = { C, CHROME, page, cards, make };
