const fs = require('fs');
const p = 'web/core/game.js';
let s = fs.readFileSync(p, 'utf8');
const marker = '    var dragonParts = { body: body, head: headPivot, legs: dragonLegs, tail: tailSegs };';
if (!s.includes(marker)) throw new Error('marker not found');
const code = `    // 古骨龙厚膜翼：两层挤出膜 + 前缘骨 + 指骨；翼根盖进身体
    var dragonWings = [];
    var wingOuter = new THREE.MeshStandardMaterial({ color: 0x5d3d79, roughness: 0.48,
      metalness: 0.04, side: THREE.DoubleSide, transparent: true, opacity: 0.94 });
    var wingInner = new THREE.MeshStandardMaterial({ color: 0x24142f, roughness: 0.62,
      metalness: 0.04, side: THREE.DoubleSide, transparent: true, opacity: 0.88 });
    for (var wd = 0; wd < 2; wd++) {
      var wside = wd ? 1 : -1;
      var wingG = new THREE.Group();
      wingG.position.set(wside * 0.38, 1.72, 0.34);
      wingG.rotation.y = wside * 0.48;
      wingG.rotation.z = wside * 0.18;
      wingG.scale.x = wside;
      g.add(wingG);
      // 肩部甲片，遮住翅膀根部和身体接缝
      add(new THREE.CylinderGeometry(0.17, 0.12, 0.22, 5), teal,
        wside * 0.36, 1.78, 0.32, 0, 0, 0.08);
      var wshp = new THREE.Shape();
      wshp.moveTo(0, 0);
      wshp.bezierCurveTo(0.9, 0.56, 1.85, 0.62, 2.28, 0.22);
      wshp.bezierCurveTo(1.95, 0.08, 1.82, 0.0, 1.70, -0.10);
      wshp.bezierCurveTo(1.56, 0.04, 1.42, -0.04, 1.28, -0.18);
      wshp.bezierCurveTo(1.15, -0.01, 1.00, -0.06, 0.82, -0.22);
      wshp.bezierCurveTo(0.68, -0.05, 0.38, -0.02, 0, 0);
      var wmem = new THREE.Mesh(new THREE.ExtrudeGeometry(wshp,
        { depth: 0.075, bevelEnabled: true, bevelSize: 0.018,
          bevelThickness: 0.018, bevelSegments: 1, curveSegments: 9 }), wingOuter);
      wmem.position.set(0, 0.12, 0.0); wmem.castShadow = true; wingG.add(wmem);
      var winn = new THREE.Mesh(new THREE.ExtrudeGeometry(wshp,
        { depth: 0.02, bevelEnabled: false, curveSegments: 7 }), wingInner);
      winn.position.set(0, 0.12, 0.05); winn.scale.set(0.92, 0.92, 1); wingG.add(winn);
      var leading = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.03, 2.15, 6), blue);
      leading.position.set(1.02, 0.28, 0.04); leading.rotation.z = -1.05; wingG.add(leading);
      for (var wb = 0; wb < 3; wb++) {
        var finger = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.018, 1.15, 5), blue);
        finger.position.set(0.46 + wb * 0.54, 0.05 - wb * 0.07, 0.03);
        finger.rotation.z = -1.0 + wb * 0.06; wingG.add(finger);
      }
      var wclaw = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.30, 5), gold);
      wclaw.position.set(2.28, 0.22, 0.02); wclaw.rotation.z = -Math.PI / 2; wingG.add(wclaw);
      dragonWings.push({ g: wingG, base: wside * 0.18, side: wside });
    }
    var dragonParts = { body: body, head: headPivot, legs: dragonLegs,
      tail: tailSegs, wings: dragonWings };`;
s = s.replace(marker, code);
fs.writeFileSync(p, s);
