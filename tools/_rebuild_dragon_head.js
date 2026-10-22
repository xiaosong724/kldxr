const fs = require('fs');
const p = 'web/dragon_options.html';
let s = fs.readFileSync(p, 'utf8');
const start = s.indexOf('  var pts = [');
const end = s.indexOf('  // 胸腹肋骨', start);
if (start < 0 || end < 0) throw new Error('body/head block not found');
const code = `  var trim = mat(S.trim, {rough:0.62, metal:0.12});
  var accent = mat(S.accent, {rough:0.32, metal:0.55, em:S.accent, ei:0.18});
  var eye = mat(S.glow, {rough:0.18, em:S.glow, ei:2.4});
  var pts = [
    new THREE.Vector3(0,1.05,-3.6), new THREE.Vector3(0,1.14,-2.7),
    new THREE.Vector3(0,1.22,-1.8), new THREE.Vector3(0,1.38,-0.9),
    new THREE.Vector3(0,1.52,0.0), new THREE.Vector3(0,1.72,0.9),
    new THREE.Vector3(0,2.05,1.5), new THREE.Vector3(0,2.42,1.95),
    new THREE.Vector3(0,2.62,2.25)
  ];
  var body = tapered(pts, [0.035,0.08,0.18,0.35,0.5,0.46,0.32,0.22,0.19],
    72, 12, S.bone, S.belly, 0.55);
  g.add(body);
  // 头部独立枢轴：龙头骨 + 上下颚 + 口腔 + 牙 + 角
  var headPivot = new THREE.Group();
  headPivot.position.set(0, 2.64, 2.26);
  g.add(headPivot);
  function ha(geo, material, x, y, z, rx, ry, rz, sx, sy, sz) {
    var o = new THREE.Mesh(geo, material);
    o.position.set(x || 0, y || 0, z || 0);
    o.rotation.set(rx || 0, ry || 0, rz || 0);
    o.scale.set(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz);
    o.castShadow = true; headPivot.add(o); return o;
  }
  ha(new THREE.IcosahedronGeometry(0.31, 1), b1, 0, 0.04, 0.02, 0, 0, 0, 1.12, 0.82, 1.05);
  // 上颚：长而窄的龙头吻部
  ha(new THREE.CylinderGeometry(0.14, 0.23, 0.66, 6), b1, 0, -0.01, 0.44,
    Math.PI / 2, 0, 0, 1.08, 1, 1);
  // 下颚：比上颚略短，留出嘴线
  ha(new THREE.BoxGeometry(0.31, 0.10, 0.60), b2, 0, -0.16, 0.39, 0.05, 0, 0.08, 1, 1, 1);
  ha(new THREE.BoxGeometry(0.27, 0.035, 0.42), mat(0x170d0b, {rough:0.95}),
    0, -0.09, 0.49);
  // 上排牙 + 下排牙
  for (var t = 0; t < 6; t++) {
    var tx = (t - 2.5) * 0.045;
    ha(new THREE.ConeGeometry(0.022, 0.10, 4), accent, tx, -0.10, 0.66, 0.12, 0, 0);
    ha(new THREE.ConeGeometry(0.018, 0.08, 4), accent, tx, -0.18, 0.62, Math.PI, 0, 0);
  }
  // 鼻骨/鼻孔
  ha(new THREE.BoxGeometry(0.16, 0.07, 0.20), b2, 0, 0.10, 0.68, -0.1, 0, 0);
  ha(new THREE.SphereGeometry(0.035, 6, 5), mat(0x120c0b, {rough:1}),
    -0.065, 0.085, 0.78, 0.3, 0, 0);
  ha(new THREE.SphereGeometry(0.035, 6, 5), mat(0x120c0b, {rough:1}),
    0.065, 0.085, 0.78, 0.3, 0, 0);
  // 眼窝 + 发光瞳 + 眉骨
  ha(new THREE.SphereGeometry(0.082, 8, 6), mat(0x0a0908, {rough:0.95}),
    -0.18, 0.16, 0.16, 0, 0, 0, 1.2, 1.1, 0.5);
  ha(new THREE.SphereGeometry(0.082, 8, 6), mat(0x0a0908, {rough:0.95}),
    0.18, 0.16, 0.16, 0, 0, 0, 1.2, 1.1, 0.5);
  ha(new THREE.SphereGeometry(0.052, 8, 6), eye, -0.18, 0.16, 0.20);
  ha(new THREE.SphereGeometry(0.052, 8, 6), eye, 0.18, 0.16, 0.20);
  ha(new THREE.ConeGeometry(0.07, 0.30, 5), b2, -0.28, 0.26, 0.10, -0.25, 0, 0.8);
  ha(new THREE.ConeGeometry(0.07, 0.30, 5), b2, 0.28, 0.26, 0.10, -0.25, 0, -0.8);
  // 金色后掠角
  ha(new THREE.ConeGeometry(0.085, 0.58, 6), accent, -0.20, 0.32, -0.12, -0.45, 0, -0.30);
  ha(new THREE.ConeGeometry(0.085, 0.58, 6), accent, 0.20, 0.32, -0.12, -0.45, 0, 0.30);
  // 颊部鳞片/鳍：每个方向不同的副色
  for (var ch = 0; ch < 3; ch++) {
    ha(new THREE.ConeGeometry(0.055, 0.22, 4), trim,
      (ch - 1) * 0.16, -0.02, -0.02, Math.PI / 2, 0, (ch - 1) * 0.35);
  }
  if (V === 1) {
    for (var fr = 0; fr < 4; fr++) ha(new THREE.ConeGeometry(0.06, 0.28, 4), trim,
      -0.25 + fr * 0.05, 0.38 + fr * 0.04, -0.18, -0.6, 0, -0.2);
  } else if (V === 2) {
    for (var br = 0; br < 4; br++) ha(new THREE.ConeGeometry(0.045, 0.20, 4), accent,
      -0.22 + br * 0.15, -0.25, 0.08, 0.4, 0, 0);
  } else if (V === 3) {
    for (var ic = 0; ic < 4; ic++) ha(new THREE.ConeGeometry(0.06, 0.30, 5),
      mat(0xc8f6ff, {rough:0.25, trans:true, op:0.75}),
      -0.24 + ic * 0.16, 0.42, -0.06, -0.7, 0, 0);
  } else {
    for (var lc = 0; lc < 4; lc++) ha(new THREE.BoxGeometry(0.035, 0.12, 0.28),
      mat(S.glow, {rough:0.25, em:S.glow, ei:1.8}),
      -0.18 + lc * 0.12, 0.05, 0.24, 0, 0, 0.25);
  }
`;
s = s.slice(0, start) + code + s.slice(end);
fs.writeFileSync(p, s);
