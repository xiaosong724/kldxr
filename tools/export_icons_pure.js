// 用 pureimage（纯 JS canvas）跑游戏里的 icons.js，导出真实的技能图标 PNG
// 为什么这么做：技能图标是 canvas 现画的，重写一遍 = 两套代码
//              直接执行原文件 = 100% 一致
const fs = require('fs');
const path = require('path');
const PImage = require('pureimage');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'shots', 'skill_icons');
fs.mkdirSync(OUT, { recursive: true });

// ── 伪装一个浏览器环境，让 icons.js 能跑 ──
global.window = global;

// 技能列表（key, kind）
const SKILLS = [
  ['blackhole', 'A'], ['swordrain', 'A'], ['earthsplit', 'A'], ['icefield', 'A'],
  ['thunder', 'A'], ['bloodrage', 'A'], ['gale', 'A'], ['shield', 'A'],
  ['timestop', 'A'], ['plague', 'A'], ['firestorm', 'A'], ['judgement', 'A'],
  ['clone', 'B'], ['tank', 'B'], ['shadowstep', 'B'], ['thunderbolt', 'B'],
  ['thorns', 'B'], ['splitarrow', 'B'], ['berserk', 'B'], ['undying', 'B'],
  ['bloodthirst', 'B'], ['bloodslash', 'B'], ['arrowrain', 'B'], ['blink', 'B'],
  ['cdcut', 'C'], ['skillcrit', 'C'], ['omnivamp', 'C'], ['skilldmg', 'C'],
  ['qiflow', 'C'], ['skillten', 'C'], ['chain', 'C'], ['masterA', 'C'],
];

// ── 用 pureimage 造一个 canvas ──
function makeCanvas(w, h) {
  const c = PImage.make(w, h);
  const ctx = c.getContext('2d');
  return { canvas: c, ctx };
}

// 把 icons.js 的源码读出来，改掉它里面的 document.createElement('canvas')
let src = fs.readFileSync(path.join(ROOT, 'web', 'icons.js'), 'utf8');

// icons.js 里 icon() 用 document.createElement + toDataURL
// 我们只关心 drawTo(ctx, key, kind, size) → 直接调它，不用管 icon()
// 所以把 document 桩掉即可（icon() 不会被调用）
global.document = {
  createElement: () => makeCanvas(96, 96).canvas,
};
global.window.SKI = undefined;

// roundRect 补丁（pureimage 老版本可能没有）
try {
  eval(src);
} catch (e) {
  console.log('加载 icons.js 失败:', e.message);
  process.exit(1);
}

if (!global.SKI || !global.SKI.drawTo) {
  console.log('SKI.drawTo 没有暴露出来');
  process.exit(1);
}

// ── 给 ctx 补 roundRect ──
function patchCtx(ctx) {
  if (!ctx.roundRect) {
    ctx.roundRect = function (x, y, w, h, r) {
      const rr = Math.min(r, w / 2, h / 2);
      this.moveTo(x + rr, y);
      this.lineTo(x + w - rr, y);
      this.quadraticCurveTo(x + w, y, x + w, y + rr);
      this.lineTo(x + w, y + h - rr);
      this.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
      this.lineTo(x + rr, y + h);
      this.quadraticCurveTo(x, y + h, x, y + h - rr);
      this.lineTo(x, y + rr);
      this.quadraticCurveTo(x, y, x + rr, y);
      this.closePath();
    };
  }
  return ctx;
}

const SIZE = 128;
let ok = 0;
for (const [key, kind] of SKILLS) {
  try {
    const { canvas, ctx } = makeCanvas(SIZE, SIZE);
    patchCtx(ctx);
    // 白底（pureimage 默认透明，群里发透明 PNG 有些客户端会显示黑底）
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, SIZE, SIZE);
    global.SKI.drawTo(ctx, key, kind, SIZE);
    const fn = path.join(OUT, `${key}_${kind}.png`);
    const stream = fs.createWriteStream(fn);
    PImage.encodePNGToStream(canvas, stream).then(() => {
      stream.close();
    }).catch((e) => {
      console.log(`  ✗ ${key}/${kind}: ${e.message}`);
    });
    ok++;
  } catch (e) {
    console.log(`  ✗ ${key}/${kind}: ${e.message}`);
  }
}

// 等写完
setTimeout(() => {
  const n = fs.readdirSync(OUT).filter(f => f.endsWith('.png')).length;
  console.log(`完成：${n} / ${SKILLS.length} 个图标 → ${OUT}`);
}, 3000);
