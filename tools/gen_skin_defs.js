// 从预览页抽出 40 个皮肤的数据 -> web/core/skin_defs.js
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const CR = String.fromCharCode(13);
const html = fs.readFileSync(path.join(ROOT, 'tools', 'preview_skins_v5.html'), 'utf8')
  .split(CR).join('');

function grab(name, endMark) {
  const i = html.indexOf('var ' + name + ' = [');
  if (i < 0) { throw new Error('no ' + name); }
  const j = html.indexOf(endMark, i);
  if (j < 0) { throw new Error('no end mark for ' + name); }
  return html.slice(i, j);
}

const iC = html.indexOf('function shade(');
const helperSrc = html.slice(iC, html.indexOf('var CHARS_F = [', iC));

const fSrc = grab('CHARS_F', '/* ============================================================\n   20 ');
const mSrc = grab('CHARS_M', '/* ');

const code = helperSrc + '\n' + fSrc + '\n' + mSrc + '\n' +
  'return { F: CHARS_F, M: CHARS_M };';
const run = new Function(code);
const got = run();

function pack(list, prefix) {
  return list.map(function (ch, i) {
    const o = {
      k: prefix + String(i + 1).padStart(2, '0'),
      n: ch.n,
      sx: ch.sx,
      g: prefix === 'f' ? 'f' : 'm',
      sk: ch.sk || {},
      c: ch.c,
      hair: ch.hair || 'short',
      eyes: ch.eyes || { w: 0.26, h: 0.30 },
      outfit: ch.outfit || 'plain'
    };
    if (ch.acc) { o.acc = ch.acc; }
    if (ch.skirt) { o.skirt = ch.skirt; }
    if (ch.hairpin) { o.pin = ch.hairpin; }
    return o;
  });
}

const all = pack(got.F, 'f').concat(pack(got.M, 'm'));
const out = [
  '/* 40 个皮肤的数据（由 tools/gen_skin_defs.js 从预览页生成 -- 不要手改）',
  '   纯数据：没有 DOM、没有事件。字段：',
  '   k=key n=名字 sx=体型说明 g=性别 sk=骨架参数 c=配色',
  '   hair=发型 eyes=眼睛尺寸 outfit=服装 acc=配件 skirt=裙/袍 pin=发饰 */',
  'var SKIN_DEFS = {',
  all.map(function (o) {
    return '  ' + JSON.stringify(o.k) + ': ' + JSON.stringify(o);
  }).join(',\n'),
  '};',
  'var SKIN_ORDER = [' + all.map(function (o) { return JSON.stringify(o.k); }).join(', ') + '];',
  'var SKIN_NAME = {' + all.map(function (o) {
    return JSON.stringify(o.k) + ': ' + JSON.stringify(o.n);
  }).join(', ') + '};',
  ''
].join('\n');

fs.writeFileSync(path.join(ROOT, 'web', 'core', 'skin_defs.js'), out, 'utf8');
console.log('生成了', all.length, '个皮肤 ->', (out.length / 1024).toFixed(1) + 'KB');
console.log('前 3 个:', all.slice(0, 3).map(function (o) { return o.k + '=' + o.n; }).join(' '));
console.log('后 2 个:', all.slice(-2).map(function (o) { return o.k + '=' + o.n; }).join(' '));
