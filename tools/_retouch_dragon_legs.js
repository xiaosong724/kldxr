const fs = require('fs');
const p = 'web/core/game.js';
let s = fs.readFileSync(p, 'utf8');
const start = s.indexOf('    // 四足：髋 -> 膝 -> 踝 -> 脚掌');
const end = s.indexOf('    // 分段尾巴', start);
if (start < 0 || end < 0) throw new Error('leg block not found');
const code = `    // 四足：大腿根部埋进身体，外面用甲片过渡；爪足，不用圆球关节
    var dragonLegs = [];
    var legData = [
      [-0.42, 0.58, 0], [0.42, 0.58, Math.PI], [-0.42, -0.58, Math.PI], [0.42, -0.58, 0]
    ];
    for (var dl = 0; dl < 4; dl++) {
      var lx = legData[dl][0], lz = legData[dl][1], ph = legData[dl][2];
      // 静态髋甲：固定在身体上，盖住大腿和身体的接缝
      add(new THREE.CylinderGeometry(0.20, 0.15, 0.28, 5), teal, lx, 1.23, lz, 0, 0, 0.06);
      var hip = new THREE.Group(); hip.position.set(lx, 1.22, lz); g.add(hip);
      var thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.115, 0.78, 5), green);
      thigh.position.y = -0.25; thigh.castShadow = true; hip.add(thigh);
      var knee = new THREE.Group(); knee.position.y = -0.58; hip.add(knee);
      var kneeCuff = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.10, 0.14, 5), blue);
      kneeCuff.position.y = 0.02; kneeCuff.castShadow = true; knee.add(kneeCuff);
      var calf = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.075, 0.52, 5), teal);
      calf.position.y = -0.25; calf.castShadow = true; knee.add(calf);
      var ankle = new THREE.Group(); ankle.position.y = -0.52; knee.add(ankle);
      var ankleCuff = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.065, 0.12, 5), blue);
      ankleCuff.position.y = 0.01; ankleCuff.castShadow = true; ankle.add(ankleCuff);
      // 脚掌缩短成楔形，前面是四根脚趾和金色爪，不是圆脚
      var palm = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.06, 0.16), blue);
      palm.position.set(0, -0.03, 0.07); palm.castShadow = true; ankle.add(palm);
      var toes = [-0.09, -0.03, 0.03, 0.09];
      for (var cl = 0; cl < toes.length; cl++) {
        var toe = new THREE.Mesh(new THREE.CylinderGeometry(0.030, 0.023, 0.24, 4), blue);
        toe.rotation.x = Math.PI / 2;
        toe.position.set(toes[cl], -0.035, 0.16);
        toe.castShadow = true; ankle.add(toe);
        var claw = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.20, 5), gold);
        claw.rotation.x = Math.PI / 2;
        claw.position.set(toes[cl], -0.045, 0.34);
        claw.castShadow = true; ankle.add(claw);
      }
      dragonLegs.push({ hip: hip, knee: knee, ankle: ankle, phase: ph });
    }
`;
s = s.slice(0, start) + code + s.slice(end);
fs.writeFileSync(p, s);
