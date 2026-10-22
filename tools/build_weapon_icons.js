// build_weapon_icons.js -- 从 core/game.js 抽出"武器图标"那一整套，供海报/预览页复用
//   ★ 目的：Q 群战报里的图标必须和游戏背包里【一模一样】✗ 不能另画一套 ✓
//   产出：tools/weapon_icons_bundle.js  → window.WeaponIcons.svg(look, tier) / .armor()
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'web', 'core', 'game.js'), 'utf8');
/* ★ 防具图标在 platform 里（不在 core）✗ 两个文件都读 ✓ */
const plat = fs.readFileSync(path.join(ROOT, 'web', 'platform', 'web.js'), 'utf8');

function slice(startMark, endMark, from) {
  const i = src.indexOf(startMark, from || 0);
  if (i < 0) { throw new Error('找不到：' + startMark); }
  const j = src.indexOf(endMark, i);
  if (j < 0) { throw new Error('找不到结束：' + endMark); }
  /* ★ 必须把结束标记也包进来 ✗ 不然函数/对象的收尾括号会被切掉 ✓ */
  return { text: src.slice(i, j + endMark.length), at: i };
}

// ① W_MAT + W_TIER + mixHex
const wmat = slice('var W_MAT = {', '\n};');
const wtier = slice('var W_TIER = [', '\n];');
const mix = slice('function mixHex(', '\n}');

// ② WEAPON_PARTS（含 saberPartsOf 之类的前置函数）：从 saberPartsOf 到 WEAPON_PARTS 结束
const partsStart = src.indexOf('function saberPartsOf(');
const partsEnd = src.indexOf('\n};', src.indexOf('var WEAPON_PARTS = {')) + 3;
const partsText = src.slice(partsStart, partsEnd);

// ③ weaponPartsOf + weaponIconSvg
const wp = slice('function weaponPartsOf(', '\n}');
const wi = slice('function weaponIconSvg(', '\n}');

// ④ 防具图标（在 platform/web.js 里，不在 core）
const ai0 = plat.indexOf('var ARMOR_ICON =');
if (ai0 < 0) { throw new Error('platform 里找不到 ARMOR_ICON'); }
const ai1 = plat.indexOf("stroke-opacity=\".3\"", ai0);
let armorText = plat.slice(ai0, plat.indexOf(';', ai1) + 1).trim();
if (!armorText.endsWith(';')) { armorText += ';'; }

const out = `// 自动生成（tools/build_weapon_icons.js）-- 别手改
// 内容原样来自 web/core/game.js：所以图标和游戏背包里【完全一致】
${wmat.text}
${wtier.text}
var LOOT_COL = [0xbfa88a, 0x8fd28a, 0x8fc4ff, 0xc08fff, 0xffd83d, 0xff9a5c,
                0xff6a5c, 0xff5cf0, 0x5cf0ff, 0xffffff, 0xffe08a, 0xff4a4a];
${mix.text}
${partsText}
${wp.text}
${wi.text}
${armorText}

window.WeaponIcons = {
  svg: function (look, tier) { return weaponIconSvg(look, tier); },
  armor: function () { return ARMOR_ICON; },
  tierColor: function (t) {
    var v = LOOT_COL[Math.max(0, Math.min(11, t | 0))] || 0xffffff;
    var s = v.toString(16);
    while (s.length < 6) { s = '0' + s; }
    return '#' + s;
  }
};
`;

fs.writeFileSync(path.join(ROOT, 'tools', 'weapon_icons_bundle.js'), out, 'utf8');
console.log('bundle 生成：', (out.length / 1024).toFixed(1) + 'KB',
            '（W_MAT/W_TIER/WEAPON_PARTS/weaponPartsOf/weaponIconSvg/ARMOR_ICON）');
