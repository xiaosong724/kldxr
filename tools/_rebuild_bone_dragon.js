const fs = require('fs');
const p = 'web/core/game.js';
let s = fs.readFileSync(p, 'utf8');
const marker = 'function mobBeast(skin, rank) {';
if (!s.includes(marker)) throw new Error('mobBeast marker missing');
const code = `/* round603：从零重建的骨龙。旧模型保留但不使用；这里只做骨骼 + 骨翼。 */
function mobDragonBone(rank) {
  var g = new THREE.Group();
  var C = { bone:0xd7c7a8, bone2:0x9c896d, dark:0x5b4b3a, jade:0x3f8f72,
    gold:0xd9b35c, eye:0x77f0ff, wing:0x5d3d79, wing2:0x24142f };
  function bm(c, o) {
    o = o || {};
    return new THREE.MeshStandardMaterial({ color:c, roughness:o.r===undefined?0.7:o.r,
      metalness:o.m===undefined?0.05:o.m, emissive:o.e||0x000000,
      emissiveIntensity:o.ei||0, flatShading:true });
  }
  var bone = bm(C.bone, {r:0.62}), bone2 = bm(C.bone2, {r:0.78});
  var jade = bm(C.jade, {r:0.6}), gold = bm(C.gold, {r:0.3, m:0.55, e:0x3a2606, ei:0.18});
  var dark = bm(C.dark, {r:0.9}), glow = bm(C.eye, {r:0.15, e:C.eye, ei:2.1});
  function add(geo, mat, x, y, z, rx, ry, rz, sx, sy, sz) {
    var o = new THREE.Mesh(geo, mat); o.position.set(x||0,y||0,z||0);
    o.rotation.set(rx||0,ry||0,rz||0);
    o.scale.set(sx===undefined?1:sx,sy===undefined?1:sy,sz===undefined?1:sz);
    o.castShadow = true; g.add(o); return o;
  }
  function spineTube(points, radii) {
    var m = mobTaperedTube(points, radii, 36, 8, C.bone, C.bone2, 0.62);
    m.material.flatShading = true; m.material.needsUpdate = true;
    m.castShadow = true; g.add(m); return m;
  }
  function boneCurve(points, radius) {
    var curve = new THREE.CatmullRomCurve3(points);
    var m = new THREE.Mesh(new THREE.TubeGeometry(curve, 18, radius, 5, false), bone2);
    m.castShadow = true; g.add(m); return m;
  }
  // 脊柱：从头后一直连到尾，是整只龙的主骨架
  var spinePts = [
    new THREE.Vector3(0, 2.34, 1.40), new THREE.Vector3(0, 1.98, 1.02),
    new THREE.Vector3(0, 1.68, 0.42), new THREE.Vector3(0, 1.46, -0.45),
    new THREE.Vector3(0, 1.34, -1.3), new THREE.Vector3(0, 1.18, -2.2),
    new THREE.Vector3(0, 1.06, -3.05)
  ];
  var body = spineTube(spinePts, [0.17,0.18,0.23,0.26,0.22,0.14,0.08]);
  // 肋骨：每根都接回脊柱和胸骨，不是悬空片
  for (var rb = 0; rb < 6; rb++) {
    var z = -1.45 + rb * 0.36;
    for (var sd = -1; sd <= 1; sd += 2) {
      boneCurve([
        new THREE.Vector3(0, 1.55 - rb * 0.015, z),
        new THREE.Vector3(sd * 0.32, 1.34, z + 0.02),
        new THREE.Vector3(sd * 0.47, 1.10, z + 0.07),
        new THREE.Vector3(sd * 0.30, 0.94, z + 0.12)
      ], 0.034);
    }
  }
  add(new THREE.BoxGeometry(0.16, 0.52, 1.85), bone2, 0, 1.20, -0.45, 0.06, 0, 0);
  // 肩胛 / 骨盆 / 背脊
  add(new THREE.ConeGeometry(0.19, 0.55, 5), jade, -0.34, 1.60, 0.35, 0, 0, 0.9);
  add(new THREE.ConeGeometry(0.19, 0.55, 5), jade, 0.34, 1.60, 0.35, 0, 0, -0.9);
  add(new THREE.BoxGeometry(0.46, 0.14, 0.62), bone2, 0, 1.36, -1.45);
  for (var dsp = 0; dsp < 11; dsp++) {
    var t = dsp / 10;
    add(new THREE.ConeGeometry(0.055 + (1-t)*0.03, 0.22 + (1-t)*0.2, 5),
      (dsp%2?gold:jade), 0, 1.58 + t*0.58 - 0.3*t*t, -1.55 + t*3.3, 0.52, 0, 0);
  }
  // 头骨
  var head = new THREE.Group(); head.position.set(0, 2.42, 1.38); g.add(head);
  function ha(geo, mat, x, y, z, rx, ry, rz, sx, sy, sz) {
    var o = new THREE.Mesh(geo, mat); o.position.set(x||0,y||0,z||0);
    o.rotation.set(rx||0,ry||0,rz||0);
    o.scale.set(sx===undefined?1:sx,sy===undefined?1:sy,sz===undefined?1:sz);
    o.castShadow = true; head.add(o); return o;
  }
  ha(new THREE.IcosahedronGeometry(0.29, 1), bone, 0, 0.02, 0.04, 0, 0, 0, 1.1, 0.86, 1.1);
  ha(new THREE.CylinderGeometry(0.13, 0.21, 0.62, 6), bone, 0, 0.0, 0.43, Math.PI/2, 0, 0, 1, 1, 1);
  ha(new THREE.BoxGeometry(0.28, 0.10, 0.54), bone2, 0, -0.16, 0.37, 0.04, 0, 0.05);
  ha(new THREE.BoxGeometry(0.22, 0.03, 0.38), dark, 0, -0.11, 0.46);
  ha(new THREE.SphereGeometry(0.075, 8, 6), dark, -0.17, 0.14, 0.18, 1.2, 1.1, 0.55);
  ha(new THREE.SphereGeometry(0.075, 8, 6), dark, 0.17, 0.14, 0.18, 1.2, 1.1, 0.55);
  ha(new THREE.SphereGeometry(0.048, 7, 5), glow, -0.17, 0.14, 0.23);
  ha(new THREE.SphereGeometry(0.048, 7, 5), glow, 0.17, 0.14, 0.23);
  ha(new THREE.ConeGeometry(0.075, 0.52, 6), gold, -0.20, 0.31, -0.10, -0.4, 0, -0.28);
  ha(new THREE.ConeGeometry(0.075, 0.52, 6), gold, 0.20, 0.31, -0.10, -0.4, 0, 0.28);
  for (var tt = 0; tt < 5; tt++) {
    ha(new THREE.ConeGeometry(0.024, 0.09, 4), gold, (tt-2)*0.055, -0.10, 0.62, 0.15, 0, 0);
    ha(new THREE.ConeGeometry(0.021, 0.08, 4), gold, (tt-2)*0.052, -0.18, 0.59, Math.PI, 0, 0);
  }
  ha(new THREE.SphereGeometry(0.032, 6, 5), dark, -0.065, 0.075, 0.72);
  ha(new THREE.SphereGeometry(0.032, 6, 5), dark, 0.065, 0.075, 0.72);
  for (var cf = 0; cf < 3; cf++) {
    ha(new THREE.ConeGeometry(0.05, 0.22, 4), jade, (cf-1)*0.14, -0.01, -0.02,
      Math.PI/2, 0, (cf-1)*0.4);
  }
  // 尾巴：脊柱延续为分段骨节
  var tailRoot = new THREE.Group(); tailRoot.position.set(0, 1.06, -3.0); g.add(tailRoot);
  var tail = [], parent = tailRoot;
  for (var ts = 0; ts < 7; ts++) {
    var seg = new THREE.Group(); seg.position.z = ts ? -0.34 : 0; parent.add(seg);
    var r0 = 0.16 - ts * 0.018, r1 = r0 * 0.78;
    var tm = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, 0.38, 5), bone2);
    tm.rotation.x = Math.PI/2; tm.position.z = -0.19; tm.castShadow = true; seg.add(tm);
    var sp = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.15, 5), gold);
    sp.position.set(0, r0*0.9, -0.18); seg.add(sp);
    tail.push(seg); parent = seg;
  }
  var tip = new THREE.Mesh(new THREE.ConeGeometry(0.10, 0.44, 5), gold);
  tip.rotation.x = -Math.PI/2; tip.position.z = -0.26; parent.add(tip);
  // 四足：骨腿 + 关节套管 + 爪
  var legs = [];
  var ldef = [[-0.43,0.52,0],[0.43,0.52,Math.PI],[-0.43,-1.35,Math.PI],[0.43,-1.35,0]];
  for (var li = 0; li < 4; li++) {
    var lx = ldef[li][0], lz = ldef[li][1], ph = ldef[li][2];
    add(new THREE.CylinderGeometry(0.20, 0.14, 0.28, 5), jade, lx, 1.23, lz, 0, 0, 0.05);
    var hip = new THREE.Group(); hip.position.set(lx, 1.22, lz); g.add(hip);
    var femur = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.10, 0.70, 5), bone);
    femur.position.y = -0.23; femur.castShadow = true; hip.add(femur);
    var knee = new THREE.Group(); knee.position.y = -0.56; hip.add(knee);
    var kc = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.095, 0.16, 5), bone2);
    kc.position.y = 0.0; knee.add(kc);
    var tibia = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.065, 0.52, 5), bone);
    tibia.position.y = -0.25; tibia.castShadow = true; knee.add(tibia);
    var ankle = new THREE.Group(); ankle.position.y = -0.51; knee.add(ankle);
    var ac = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.06, 0.13, 5), bone2);
    ankle.add(ac);
    var palm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.055, 0.16), jade);
    palm.position.set(0, -0.03, 0.08); ankle.add(palm);
    for (var c = 0; c < 4; c++) {
      var x = (c - 1.5) * 0.055;
      var toe = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.22, 4), bone2);
      toe.rotation.x = Math.PI/2; toe.position.set(x, -0.03, 0.16); ankle.add(toe);
      var claw = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.19, 5), gold);
      claw.rotation.x = Math.PI/2; claw.position.set(x, -0.04, 0.32); ankle.add(claw);
    }
    legs.push({hip:hip, knee:knee, ankle:ankle, phase:ph});
  }
  // 骨翼：两层厚膜 + 骨梁
  var wings = [], wOut = new THREE.MeshStandardMaterial({color:C.wing, roughness:0.47,
    metalness:0.05, side:THREE.DoubleSide, transparent:true, opacity:0.94});
  var wIn = new THREE.MeshStandardMaterial({color:C.wing2, roughness:0.62,
    metalness:0.05, side:THREE.DoubleSide, transparent:true, opacity:0.88});
  for (var wi = 0; wi < 2; wi++) {
    var side = wi ? 1 : -1, wg = new THREE.Group();
    wg.position.set(side*0.38, 1.70, 0.22);
    wg.rotation.y = side*0.48; wg.rotation.z = side*0.18; wg.scale.x = side;
    g.add(wg);
    add(new THREE.CylinderGeometry(0.16,0.11,0.22,5), jade, side*0.36,1.76,0.22,0,0,0.08);
    var shp = new THREE.Shape();
    shp.moveTo(0,0);
    shp.bezierCurveTo(0.92,0.56,1.88,0.62,2.30,0.22);
    shp.bezierCurveTo(1.96,0.08,1.82,0.0,1.70,-0.10);
    shp.bezierCurveTo(1.56,0.04,1.42,-0.04,1.28,-0.18);
    shp.bezierCurveTo(1.15,-0.01,1.0,-0.06,0.82,-0.22);
    shp.bezierCurveTo(0.68,-0.05,0.38,-0.02,0,0);
    var mo = new THREE.Mesh(new THREE.ExtrudeGeometry(shp,{depth:0.075,bevelEnabled:true,
      bevelSize:0.018,bevelThickness:0.018,bevelSegments:1,curveSegments:9}),wOut);
    mo.position.set(0,0.12,0); mo.castShadow=true; wg.add(mo);
    var mi = new THREE.Mesh(new THREE.ExtrudeGeometry(shp,{depth:0.02,bevelEnabled:false,
      curveSegments:7}),wIn);
    mi.position.set(0,0.12,0.05); mi.scale.set(0.92,0.92,1); wg.add(mi);
    var lead = new THREE.Mesh(new THREE.CylinderGeometry(0.065,0.028,2.12,6),bone2);
    lead.position.set(1.02,0.27,0.04); lead.rotation.z=-1.05; wg.add(lead);
    for (var f = 0; f < 3; f++) {
      var fb = new THREE.Mesh(new THREE.CylinderGeometry(0.042,0.018,1.12,5),bone2);
      fb.position.set(0.46+f*0.53,0.05-f*0.07,0.03); fb.rotation.z=-1.0+f*0.06; wg.add(fb);
    }
    wings.push({g:wg, base: side*0.18, side:side});
  }
  var dummy = new THREE.Group(); g.add(dummy);
  var lod = new THREE.Mesh(body.geometry, body.material);
  lod.position.copy(body.position); lod.scale.copy(body.scale); lod.visible=false; g.add(lod);
  return {g:g, body:body, lod:lod, legL:dummy, legR:dummy, armL:dummy, armR:dummy,
    casters:[body], beast:1, limbs:[], slots:[], attached:true,
    dragon:{body:body, head:head, legs:legs, tail:tail, wings:wings}};
}

function mobBeast(skin, rank) {
  if (skin === 'dragon') { return mobDragonBone(rank); }
`;
s = s.replace(marker, code);
fs.writeFileSync(p, s);
