const fs = require('fs');
const p = 'web/core/game.js';
let s = fs.readFileSync(p, 'utf8');
const start = s.indexOf("  } else if (skin === 'dragon') {");
const end = s.indexOf("  } else if (skin === 'serpent') {", start);
if (start < 0 || end < 0) throw new Error('dragon branch not found');
const code = `  } else if (skin === 'dragon') {
    // round602：低多边形四足爬行龙（无翼）。连续躯干 + 分段尾巴 + 三关节腿。
    var green = bm(0x1f5b45, { r: 0.86 }), teal = bm(0x2f8a6b, { r: 0.8 });
    var blue = bm(0x1b3f5c, { r: 0.72, m: 0.12 }), gold = bm(0xd9a441, { r: 0.35, m: 0.55,
      e: 0x5a3a08, ei: 0.35 });
    var eye = bm(0xffd36a, { r: 0.2, m: 0.05, e: 0xff9a1f, ei: 1.6 });
    var bodyPts = [
      new THREE.Vector3(0, 0.92, -2.75),
      new THREE.Vector3(0, 1.02, -2.0),
      new THREE.Vector3(0, 1.12, -1.15),
      new THREE.Vector3(0, 1.22, -0.25),
      new THREE.Vector3(0, 1.34, 0.55),
      new THREE.Vector3(0, 1.62, 1.05),
      new THREE.Vector3(0, 1.98, 1.32)
    ];
    body = mobTaperedTube(bodyPts, [0.16, 0.24, 0.36, 0.44, 0.38, 0.26, 0.22],
      22, 6, 0x1f5b45, 0x2f8a6b, 0.82);
    body.material.flatShading = true;
    body.material.vertexColors = true;
    body.material.needsUpdate = true;
    body.castShadow = true; g.add(body);
    // 胸口/腹部低多边形护甲片
    for (var bs = 0; bs < 5; bs++) {
      add(new THREE.ConeGeometry(0.08, 0.3, 5), gold, 0,
        1.38 + bs * 0.06, -1.9 + bs * 0.66, 0.9, 0, 0, 1, 1, 1);
    }
    // 背脊：金色骨刺
    for (var sp = 0; sp < 7; sp++) {
      add(new THREE.ConeGeometry(0.06 + (1 - sp / 7) * 0.035, 0.26 + (1 - sp / 7) * 0.2, 5),
        gold, 0, 1.42 + sp * 0.09, -1.7 + sp * 0.52, 0.62, 0, 0);
    }
    // 颈鬃：低多边形三角片
    for (var mn = 0; mn < 4; mn++) {
      add(new THREE.ConeGeometry(0.07, 0.22, 4), teal,
        (mn - 1.5) * 0.10, 2.02 + mn * 0.08, 0.76 + mn * 0.12, -0.55, 0, 0);
    }
    // 头部枢轴：头可以独立左右转
    var headPivot = new THREE.Group();
    headPivot.position.set(0, 2.14, 1.22);
    g.add(headPivot);
    function hAdd(geo, material, x, y, z, rx, ry, rz, sx, sy, sz) {
      var o = new THREE.Mesh(geo, material);
      o.position.set(x || 0, y || 0, z || 0);
      o.rotation.set(rx || 0, ry || 0, rz || 0);
      o.scale.set(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz);
      o.castShadow = true; headPivot.add(o); return o;
    }
    hAdd(new THREE.IcosahedronGeometry(0.28, 0), green, 0, 0.06, 0.10, 0, 0, 0, 1.1, 0.9, 1.15);
    hAdd(new THREE.ConeGeometry(0.20, 0.42, 6), green, 0, -0.01, 0.48, Math.PI / 2, 0, 0);
    hAdd(new THREE.BoxGeometry(0.26, 0.075, 0.36), blue, 0, -0.15, 0.44);
    hAdd(new THREE.BoxGeometry(0.06, 0.16, 0.06), gold, 0, 0.08, 0.62);
    hAdd(new THREE.ConeGeometry(0.065, 0.48, 5), gold, -0.18, 0.30, 0.05, 0, 0, -0.28);
    hAdd(new THREE.ConeGeometry(0.065, 0.48, 5), gold, 0.18, 0.30, 0.05, 0, 0, 0.28);
    hAdd(new THREE.SphereGeometry(0.055, 7, 5), eye, -0.13, 0.13, 0.28);
    hAdd(new THREE.SphereGeometry(0.055, 7, 5), eye, 0.13, 0.13, 0.28);
    for (var th = 0; th < 3; th++) hAdd(new THREE.ConeGeometry(0.025, 0.1, 4), gold,
      (th - 1) * 0.075, -0.21, 0.53, -0.25, 0, 0);
    // 四足：髋 -> 膝 -> 踝 -> 脚掌；每个关节独立
    var dragonLegs = [];
    var legData = [
      [-0.44, 0.55, 0], [0.44, 0.55, Math.PI], [-0.44, -0.55, Math.PI], [0.44, -0.55, 0]
    ];
    for (var dl = 0; dl < 4; dl++) {
      var lx = legData[dl][0], lz = legData[dl][1], ph = legData[dl][2];
      var hip = new THREE.Group(); hip.position.set(lx, 1.18, lz); g.add(hip);
      var thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.10, 0.52, 5), green);
      thigh.position.y = -0.24; thigh.castShadow = true; hip.add(thigh);
      var knee = new THREE.Group(); knee.position.y = -0.50; hip.add(knee);
      var calf = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.07, 0.48, 5), teal);
      calf.position.y = -0.22; calf.castShadow = true; knee.add(calf);
      var ankle = new THREE.Group(); ankle.position.y = -0.44; knee.add(ankle);
      var foot = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.10, 0.36), blue);
      foot.position.set(0, -0.04, 0.10); foot.castShadow = true; ankle.add(foot);
      for (var cl = 0; cl < 3; cl++) {
        var claw = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.16, 5), gold);
        claw.position.set((cl - 1) * 0.075, -0.05, 0.28);
        claw.rotation.x = 1.2; ankle.add(claw);
      }
      dragonLegs.push({ hip: hip, knee: knee, ankle: ankle, phase: ph });
      // 髋关节覆盖，避免腿和身体出现缝隙
      add(new THREE.SphereGeometry(0.16, 6, 5), blue, lx, 1.16, lz, 0, 0, 0, 1.15, 1, 1.15);
    }
    // 分段尾巴：从躯干末端逐节挂接，关节可以自然弯曲
    var tailRoot = new THREE.Group();
    tailRoot.position.set(0, 0.98, -2.62);
    g.add(tailRoot);
    var tailSegs = [];
    var tParent = tailRoot;
    for (var ts = 0; ts < 6; ts++) {
      var tseg = new THREE.Group();
      tseg.position.z = ts === 0 ? 0 : -0.36;
      tParent.add(tseg);
      var r0 = 0.18 - ts * 0.023, r1 = r0 * 0.78;
      var tm = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, 0.40, 5), green);
      tm.rotation.x = Math.PI / 2; tm.position.z = -0.20; tm.castShadow = true; tseg.add(tm);
      var spike = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.16, 5), gold);
      spike.position.set(0, r0 * 0.9, -0.18); tseg.add(spike);
      tailSegs.push(tseg);
      tParent = tseg;
    }
    var tailTip = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.48, 5), gold);
    tailTip.rotation.x = -Math.PI / 2; tailTip.position.z = -0.28;
    tParent.add(tailTip);
    var dragonParts = { body: body, head: headPivot, legs: dragonLegs, tail: tailSegs };
`;
s = s.slice(0, start) + code + s.slice(end);
fs.writeFileSync(p, s);

