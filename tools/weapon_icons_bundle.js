// 自动生成（tools/build_weapon_icons.js）-- 别手改
// 内容原样来自 web/core/game.js：所以图标和游戏背包里【完全一致】
var W_MAT = {
  steel: 0xd8f0f4, steelD: 0x9aa8b0, dark: 0x4a5058, wood: 0x6a4a2a, woodD: 0x4a3218,
  gold: 0xe0bc60, iron: 0x7e7e92, wrap: 0x3a3a40, red: 0xc04030, tip: 0xf4ffff
};
var W_TIER = [
  { mix: 0x8a7a66, k: 0.60, glow: 0 }, { mix: 0x8a7a66, k: 0.55, glow: 0 },
  { mix: 0xb8c4cc, k: 0.25, glow: 0 }, { mix: 0xb8c4cc, k: 0.22, glow: 0 },
  { mix: 0x7a8a9a, k: 0.35, glow: 0.25 }, { mix: 0x7a8a9a, k: 0.35, glow: 0.25 },
  { mix: 0x7a8a9a, k: 0.35, glow: 0.25 },
  { mix: 0xc0d4e4, k: 0.35, glow: 0.45 }, { mix: 0xc0d4e4, k: 0.35, glow: 0.45 },
  { mix: 0xc0d4e4, k: 0.35, glow: 0.45 },
  { mix: 0xf0e0a8, k: 0.45, glow: 0.85 }, { mix: 0xf0e0a8, k: 0.45, glow: 0.85 }
];
var LOOT_COL = [0xbfa88a, 0x8fd28a, 0x8fc4ff, 0xc08fff, 0xffd83d, 0xff9a5c,
                0xff6a5c, 0xff5cf0, 0x5cf0ff, 0xffffff, 0xffe08a, 0xff4a4a];
function mixHex(a, b, k) {
  var ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  var br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  var r = Math.round(ar + (br - ar) * k), g = Math.round(ag + (bg - ag) * k);
  var bl = Math.round(ab + (bb - ab) * k);
  return (r << 16) | (g << 8) | bl;
}
function saberPartsOf() {
  var R = 2.80, T = 0.60, N = 9, y0 = 0.30;
  var out = [
    [0.14, 0.10, 0.14, W_MAT.gold, 0, -0.26, 0],
    [0.07, 0.26, 0.05, W_MAT.red, 0.10, -0.38, 0],
    [0.06, 0.20, 0.05, W_MAT.red, 0.15, -0.60, 0],
    [0.05, 0.14, 0.04, W_MAT.red, 0.19, -0.78, 0],
    [0.14, 0.38, 0.13, W_MAT.wrap, 0, -0.02, 0],
    [0.48, 0.09, 0.48, W_MAT.gold, 0, 0.24, 0, 0, 0, 1]      // 圆盘护手（末位 1 = 圆柱 ✓）
  ];
  for (var i = 0; i < N; i++) {
    var t0 = T * i / N, t1 = T * (i + 1) / N, tm = (t0 + t1) / 2;
    var len = R * (t1 - t0) * 1.08;
    var px = R * (1 - Math.cos(tm)), py = y0 + R * Math.sin(tm);
    var w = 0.18 + 0.06 * (i / (N - 1));
    out.push([w, len, 0.055, W_MAT.steel, px, py, 0, -tm]);
    var off = w * 0.44;
    out.push([w * 0.26, len, 0.045, W_MAT.tip,
              px - off * Math.cos(tm), py + off * Math.sin(tm), 0, -tm]);
  }
  var te = T, pex = R * (1 - Math.cos(te)), pey = y0 + R * Math.sin(te);
  out.push([0.13, 0.22, 0.05, W_MAT.tip,
            pex + 0.10 * Math.sin(te), pey + 0.10 * Math.cos(te), 0, -te]);
  return out;
}

var WEAPON_PARTS = {
  dagger: [
    [0.11, 0.26, 0.11, W_MAT.wrap, 0, 0.00, 0],
    [0.15, 0.08, 0.15, W_MAT.gold, 0, -0.16, 0],
    [0.32, 0.07, 0.11, W_MAT.iron, 0, 0.17, 0],
    [0.15, 0.30, 0.06, W_MAT.steel, 0, 0.36, 0],
    [0.12, 0.26, 0.05, W_MAT.steel, 0, 0.62, 0],
    [0.07, 0.20, 0.05, W_MAT.tip, 0, 0.83, 0]
  ],
  sword: [
    [0.18, 0.10, 0.18, W_MAT.gold, 0, -0.20, 0],
    [0.12, 0.34, 0.12, W_MAT.woodD, 0, -0.02, 0],
    [0.48, 0.10, 0.16, W_MAT.iron, 0, 0.19, 0],
    [0.16, 0.62, 0.07, W_MAT.steel, 0, 0.52, 0],
    [0.13, 0.44, 0.06, W_MAT.steel, 0, 1.05, 0],
    [0.09, 0.26, 0.05, W_MAT.tip, 0, 1.40, 0]
  ],
  staff: [
    [0.10, 2.20, 0.10, W_MAT.wood, 0, 0.94, 0],
    [0.15, 0.12, 0.15, W_MAT.iron, 0, 2.02, 0],
    [0.15, 0.12, 0.15, W_MAT.iron, 0, -0.14, 0],
    [0.14, 0.36, 0.14, W_MAT.wrap, 0, 0.10, 0]
  ],
  spear: [
    [0.09, 2.20, 0.09, W_MAT.wood, 0, 0.96, 0],
    [0.14, 0.36, 0.14, W_MAT.wrap, 0, 0.10, 0],
    [0.16, 0.12, 0.16, W_MAT.red, 0, 2.14, 0],
    [0.15, 0.12, 0.15, W_MAT.iron, 0, 2.32, 0],
    [0.22, 0.30, 0.06, W_MAT.steel, 0, 2.52, 0],
    [0.14, 0.26, 0.05, W_MAT.steel, 0, 2.78, 0],
    [0.08, 0.22, 0.05, W_MAT.tip, 0, 3.00, 0]
  ],
  axe: [
    [0.22, 0.12, 0.22, W_MAT.iron, 0, -0.24, 0],
    [0.18, 0.40, 0.18, W_MAT.wrap, 0, 0.12, 0],
    [0.14, 1.90, 0.14, W_MAT.wood, 0, 0.92, 0],
    [0.30, 0.34, 0.30, W_MAT.dark, 0, 1.60, 0],
    [0.22, 0.86, 0.14, W_MAT.iron, 0.22, 1.60, 0],
    [0.24, 0.62, 0.13, W_MAT.iron, 0.40, 1.60, 0],
    [0.18, 0.42, 0.12, W_MAT.iron, 0.54, 1.60, 0],
    [0.09, 0.26, 0.11, W_MAT.tip, 0.66, 1.60, 0],
    [0.22, 0.86, 0.14, W_MAT.iron, -0.22, 1.60, 0],
    [0.24, 0.62, 0.13, W_MAT.iron, -0.40, 1.60, 0],
    [0.18, 0.42, 0.12, W_MAT.iron, -0.54, 1.60, 0],
    [0.09, 0.26, 0.11, W_MAT.tip, -0.66, 1.60, 0]
  ],
  hammer: [
    [0.20, 0.12, 0.20, W_MAT.iron, 0, -0.22, 0],
    [0.17, 0.36, 0.17, W_MAT.wrap, 0, 0.12, 0],
    [0.13, 1.60, 0.13, W_MAT.woodD, 0, 0.80, 0],
    [0.28, 0.26, 0.28, W_MAT.iron, 0, 1.50, 0],
    [0.72, 0.64, 0.64, W_MAT.dark, 0, 1.76, 0],
    [0.84, 0.12, 0.66, W_MAT.iron, 0, 1.76, 0],
    [0.10, 0.54, 0.54, W_MAT.steel, 0.42, 1.76, 0],
    [0.10, 0.54, 0.54, W_MAT.steel, -0.42, 1.76, 0]
  ],
  bow: [
    [0.15, 0.42, 0.13, W_MAT.wrap, 0, 1.00, 0],
    [0.10, 0.36, 0.09, W_MAT.wood, 0.06, 1.36, 0, -0.20],
    [0.10, 0.32, 0.09, W_MAT.wood, 0.20, 1.62, 0, -0.38],
    [0.09, 0.24, 0.08, W_MAT.wood, 0.40, 1.78, 0, -0.70],
    [0.10, 0.36, 0.09, W_MAT.wood, 0.06, 0.64, 0, 0.20],
    [0.10, 0.32, 0.09, W_MAT.wood, 0.20, 0.38, 0, 0.38],
    [0.09, 0.24, 0.08, W_MAT.wood, 0.40, 0.22, 0, 0.70],
    [0.04, 1.62, 0.03, 0xe8e8e0, 0.46, 1.00, 0]
  ]
};
function weaponPartsOf(look, tier) {
  var base = (look === 'saber') ? saberPartsOf() : (WEAPON_PARTS[look] || WEAPON_PARTS.sword);
  var k = Math.max(0, Math.min(11, tier | 0));
  var T = W_TIER[k] || W_TIER[0];
  var out = [];
  for (var i = 0; i < base.length; i++) {
    var p = base[i];
    var np = p.slice();
    np[3] = mixHex(p[3], T.mix, T.k);
    out.push(np);
  }
  // ★ "越好的越精细"：高阶多加一点装饰（通用的，不做 8 套 ✓）
  if (k >= 7) {
    out.push([0.16, 0.16, 0.16, mixHex(W_MAT.gold, T.mix, 0.2), 0, -0.34, 0]);   // 尾珠
  }
  if (k >= 4) {
    out.push([0.30, 0.10, 0.10, mixHex(W_MAT.steel, T.mix, 0.3), 0, 0.06, 0.10]); // 护手一点缀
  }
  return out;
}
function weaponIconSvg(look, tier) {
  var parts = weaponPartsOf(look, tier);
  var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    var a = p[7] || 0, ca = Math.cos(a), sa = Math.sin(a);
    var hw = p[0] / 2, hh = p[1] / 2;
    for (var c = 0; c < 4; c++) {
      var lx = (c === 0 || c === 3) ? -hw : hw;
      var ly = (c < 2) ? -hh : hh;
      var wx = (p[4] || 0) + lx * ca - ly * sa;
      var wy = (p[5] || 0) + lx * sa + ly * ca;
      if (wx < minX) { minX = wx; }
      if (wx > maxX) { maxX = wx; }
      if (wy < minY) { minY = wy; }
      if (wy > maxY) { maxY = wy; }
    }
  }
  var pad = Math.max(0.12, (maxY - minY) * 0.06);
  var vb = (minX - pad) + ' ' + (-(maxY + pad)) + ' ' + ((maxX - minX) + pad * 2) + ' ' +
           ((maxY - minY) + pad * 2);
  var s = '<svg viewBox="' + vb + '" preserveAspectRatio="xMidYMid meet">' +
          '<g transform="scale(1,-1)">';
  for (var j = 0; j < parts.length; j++) {
    var q = parts[j];
    var col = '#' + ('000000' + (q[3] | 0).toString(16)).slice(-6);
    var tr = q[7] ? (' transform="rotate(' + (-q[7] * 180 / Math.PI) + ' ' + (q[4] || 0) + ' ' +
                     (q[5] || 0) + ')"') : '';
    if (q[9]) {   // 圆柱 → 一个圆 ✓
      s += '<circle cx="' + (q[4] || 0) + '" cy="' + (q[5] || 0) + '" r="' + (q[0] / 2) +
           '" fill="' + col + '"' + tr + '/>';
    } else {
      s += '<rect x="' + ((q[4] || 0) - q[0] / 2) + '" y="' + ((q[5] || 0) - q[1] / 2) +
           '" width="' + q[0] + '" height="' + q[1] + '" fill="' + col + '"' + tr + '/>';
    }
  }
  return s + '</g></svg>';
}
var ARMOR_ICON = '<svg viewBox="0 0 24 24" width="100%" height="100%">' +
'<path d="M8.4 3 h7.2 l4.2 2 -0.5 4 -2.2 -0.6 V16.8 H6.9 V8.4 l-2.2 0.6 -0.5 -4 z"' +
    ' fill="currentColor" opacity=".85"/>' +
    '<path d="M8.8 7.2 l3.2 1.7 3.2 -1.7 M8.8 10.3 l3.2 1.7 3.2 -1.7 M8.8 13.4 l3.2 1.7 3.2 -1.7"' +
    ' stroke="#000" stroke-opacity=".4" stroke-width="1.05" fill="none"/>' +
    '<path d="M10 3.2 c0.6 1.2 3.4 1.2 4 0" stroke="#000" stroke-opacity=".3" stroke-width="1" fill="none"/>';

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
