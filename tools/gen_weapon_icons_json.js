// gen_weapon_icons_json.js -- 把游戏里的武器图标（每个 look × 每个品阶）预先算成 JSON
//   ★ 目的：服务端用 Python(Pillow) 画战报时，图标和游戏里【一模一样】
//   产出：server/weapon_icons.json
//     { "sword": { "0": {vb:[x,y,w,h], parts:[[x,y,w,h,"#rrggbb",rot,circle], ...]}, ... }, ... }
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const code = fs.readFileSync(path.join(ROOT, 'tools', 'weapon_icons_bundle.js'), 'utf8');
const window = {};
const W = new Function('window', code + '; return window.WeaponIcons;')(window);

// bundle 里没暴露 parts，只有 svg ✗ 这里重新取一次：直接把 bundle 里的内部函数抠出来用
const inner = code + '\nreturn { partsOf: weaponPartsOf };';
const partsOf = new Function('window', inner)(window).partsOf;

const LOOKS = ['sword', 'dagger', 'saber', 'staff', 'spear', 'axe', 'hammer', 'bow'];

function packParts(parts) {
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const p of parts) {
    const a = p[7] || 0, ca = Math.cos(a), sa = Math.sin(a);
    const hw = p[0] / 2, hh = p[1] / 2;
    for (let c = 0; c < 4; c++) {
      const lx = (c === 0 || c === 3) ? -hw : hw;
      const ly = (c < 2) ? -hh : hh;
      const wx = (p[4] || 0) + lx * ca - ly * sa;
      const wy = (p[5] || 0) + lx * sa + ly * ca;
      if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
    }
  }
  const pad = Math.max(0.12, (maxY - minY) * 0.06);
  const vb = [minX - pad, minY - pad, (maxX - minX) + pad * 2, (maxY - minY) + pad * 2];
  const ps = parts.map(function (q) {
    const col = '#' + ('000000' + (q[3] | 0).toString(16)).slice(-6);
    return { x: q[4] || 0, y: q[5] || 0, w: q[0], h: q[1], c: col,
             r: q[7] || 0, cir: q[9] ? 1 : 0 };
  });
  return { vb: vb, parts: ps };
}

const out = {};
for (const look of LOOKS) {
  out[look] = {};
  for (let tier = 0; tier < 12; tier++) {
    out[look][String(tier)] = packParts(partsOf(look, tier));
  }
}
fs.writeFileSync(path.join(ROOT, 'server', 'weapon_icons.json'),
                 JSON.stringify(out), 'utf8');
console.log('生成 server/weapon_icons.json', (JSON.stringify(out).length / 1024).toFixed(0) + 'KB',
            '· look', Object.keys(out).length, '× tier 12');
