const fs = require('fs');
const p = 'web/core/game.js';
let s = fs.readFileSync(p, 'utf8');
const marker = '/* round603：从零重建的骨龙。旧模型保留但不使用；这里只做骨骼 + 骨翼。 */';
if (!s.includes(marker)) throw new Error('marker missing');
const code = `/* round604：末影龙配色四足龙。深紫黑主体 + 紫色眼 + 灰紫膜翼。 */
function mobEnderDragon(rank) {
  var g = new THREE.Group();
  var C = { black:0x18121f, black2:0x241a2e, plate:0x33253f,
    wing:0x211b28, vein:0x6b3a8a, eye:0xe36bff, glow:0x9a3cff };
  function bm(c, o) {
    o = o || {};
    return new THREE.MeshStandardMaterial({ color:c, roughness:o.r===undefined?0.62:o.r,
      metalness:o.m===undefined?0.06:o.m, emissive:o.e||0x000000,
      emissiveIntensity:o.ei||0, flatShading:true,
      transparent:!!o.trans, opacity:o.op===undefined?1:o.op,
      side:o.side||THREE.FrontSide });
  }
  var black = bm(C.black, {r:0.55}), black2 = bm(C.black2, {r:0.62});
  var plate = bm(C.plate, {r:0.5, m:0.15}), wingMat = bm(C.wing,
    {r:0.72, trans:true, op:0.93, side:THREE.DoubleSide});
  var vein = bm(C.vein, {r:0.4, m:0.1, e:0x4a1f6a, ei:0.5});
  var eye = bm(C.eye, {r:0.16, m:0.02, e:C.eye, ei:2.4});
  function add(geo, mat, x, y, z, rx, ry, rz, sx, sy, sz) {
    var o = new THREE.Mesh(geo, mat); o.position.set(x||0,y||0,z||0);
    o.rotation.set(rx||0,ry||0,rz||0);
    o.scale.set(sx===undefined?1:sx,sy===undefined?1:sy,sz===undefined?1:sz);
    o.castShadow = true; g.add(o); return o;
  }
  // 末影龙式长躯干/长颈
  var spinePts = [
    new THREE.Vector3(0,1.02,-3.15), new THREE.Vector3(0,1.12,-2.3),
    new THREE.Vector3(0,1.22,-1.45), new THREE.Vector3(0,1.34,-0.55),
    new THREE.Vector3(0,1.48,0.30), new THREE.Vector3(0,1.70,0.95),
    new THREE.Vector3(0,2.02,1.35), new THREE.Vector3(0,2.28,1.48)
  ];
  var body = mobTaperedTube(spinePts, [0.14,0.22,0.30,0.34,0.30,0.24,0.20,0.18],
    36, 8, C.black, C.black2, 0.58);
  body.material.flatShading = true; body.material.needsUpdate = true;
  body.castShadow = true; g.add(body);
  // 背甲/侧甲：末影龙的紫黑色块面
  for (var sp = 0; sp < 9; sp++) {
    var st = sp / 8;
    add(new THREE.BoxGeometry(0.22 - st*0.05, 0.10, 0.30), plate,
      0, 1.48 + st*0.66 - 0.24*st*st, -1.75 + st*3.15, 0.18, 0, 0);
    if (sp < 7) {
      add(new THREE.ConeGeometry(0.075 - st*0.02, 0.24 - st*0.06, 5), vein,
        0, 1.64 + st*0.62, -1.7 + st*3.0, 0.45, 0, 0);
    }
  }
  // 头：拉长的末影龙头
  var head = new THREE.Group(); head.position.set(0, 2.38, 1.50); g.add(head);
  function ha(geo, mat, x, y, z, rx, ry, rz, sx, sy, sz) {
    var o = new THREE.Mesh(geo, mat); o.position.set(x||0,y||0,z||0);
    o.rotation.set(rx||0,ry||0,rz||0);
    o.scale.set(sx===undefined?1:sx,sy===undefined?1:sy,sz===undefined?1:sz);
    o.castShadow = true; head.add(o); return o;
  }
  ha(new THREE.BoxGeometry(0.44, 0.32, 0.46), black, 0, 0.02, 0.02, 0, 0, 0);
  ha(new THREE.BoxGeometry(0.34, 0.23, 0.58), black2, 0, -0.01, 0.43, 0.02, 0, 0);
  ha(new THREE.BoxGeometry(0.30, 0.10, 0.48), black2, 0, -0.17, 0.38, 0.04, 0, 0.04);
  ha(new THREE.BoxGeometry(0.28, 0.045, 0.34), bm(0x0d0910, {r:0.95}), 0, -0.10, 0.47);
  // 紫色眼睛（末影龙标志）
  ha(new THREE.BoxGeometry(0.13, 0.075, 0.04), eye, -0.16, 0.12, 0.29, 0, 0, -0.12);
  ha(new THREE.BoxGeometry(0.13, 0.075, 0.04), eye, 0.16, 0.12, 0.29, 0, 0, 0.12);
  // 角/额刺
  ha(new THREE.ConeGeometry(0.07, 0.46, 5), plate, -0.20, 0.28, -0.04, -0.35, 0, -0.24);
  ha(new THREE.ConeGeometry(0.07, 0.46, 5), plate, 0.20, 0.28, -0.04, -0.35, 0, 0.24);
  for (var hc = 0; hc < 3; hc++) {
    ha(new THREE.ConeGeometry(0.045, 0.20, 4), vein, (hc-1)*0.12, 0.23, 0.05, -0.35, 0, 0);
  }
  // 上下牙
  for (var t = 0; t < 4; t++) {
    ha(new THREE.ConeGeometry(0.022, 0.075, 4), plate, (t-1.5)*0.06, -0.12, 0.64, 0.1, 0, 0);
  }
  // 大块面翼：由三块膜板拼成末影龙轮廓，但共享同一翼根
  var wings = [];
  for (var wi = 0; wi < 2; wi++) {
    var side = wi ? 1 : -1, wg = new THREE.Group();
    wg.position.set(side*0.38, 1.62, 0.34);
    wg.rotation.y = side*0.42; wg.rotation.z = side*0.20; wg.scale.x = side;
    g.add(wg);
    add(new THREE.BoxGeometry(0.24, 0.20, 0.26), plate, side*0.34,1.70,0.32);
    var panels = [
      [[0,0],[1.05,0.55],[2.10,0.50],[2.55,0.12],[1.30,0.05]],
      [[0,0],[1.10,0.05],[2.35,-0.10],[2.10,-0.30],[0.95,-0.18]],
      [[0,0],[0.95,-0.18],[1.95,-0.45],[1.55,-0.62],[0.72,-0.26]]
    ];
    for (var pi = 0; pi < panels.length; pi++) {
      var shp = new THREE.Shape(), pp = panels[pi];
      shp.moveTo(pp[0][0], pp[0][1]);
      for (var pj = 1; pj < pp.length; pj++) {
        if (pj === 1) shp.quadraticCurveTo(pp[pj][0]*0.5, pp[pj][1]*0.7, pp[pj][0], pp[pj][1]);
        else shp.lineTo(pp[pj][0], pp[pj][1]);
      }
      shp.lineTo(pp[0][0], pp[0][1]);
      var me = new THREE.Mesh(new THREE.ExtrudeGeometry(shp,
        {depth:0.055, bevelEnabled:false, curveSegments:6}), wingMat);
      me.position.set(0,0.12,0.02); wg.add(me);
    }
    // 翼骨/紫色脉络
    var lead = new THREE.Mesh(new THREE.CylinderGeometry(0.055,0.025,2.2,5), plate);
    lead.position.set(1.05,0.26,0.04); lead.rotation.z = -1.05; wg.add(lead);
    for (var f = 0; f < 3; f++) {
      var fb = new THREE.Mesh(new THREE.CylinderGeometry(0.030,0.014,1.2,5), vein);
      fb.position.set(0.5+f*0.58, 0.06-f*0.08, 0.03); fb.rotation.z = -1.0+f*0.06; wg.add(fb);
    }
    wings.push({g:wg, base:side*0.20, side:side});
  }
  // 四肢：末影龙黑紫块面腿 + 紫色爪
  var legs = [];
  var ld = [[-0.42,0.55,0],[0.42,0.55,Math.PI],[-0.42,-1.20,Math.PI],[0.42,-1.20,0]];
  for (var li = 0; li < 4; li++) {
    var lx = ld[li][0], lz = ld[li][1], ph = ld[li][2];
    add(new THREE.BoxGeometry(0.28,0.20,0.30), plate, lx, 1.18, lz);
    var hip = new THREE.Group(); hip.position.set(lx,1.18,lz); g.add(hip);
    var thigh = new THREE.Mesh(new THREE.BoxGeometry(0.22,0.54,0.24), black);
    thigh.position.y = -0.26; thigh.castShadow = true; hip.add(thigh);
    var knee = new THREE.Group(); knee.position.y = -0.53; hip.add(knee);
    var calf = new THREE.Mesh(new THREE.BoxGeometry(0.17,0.46,0.19), black2);
    calf.position.y = -0.23; calf.castShadow = true; knee.add(calf);
    var ankle = new THREE.Group(); ankle.position.y = -0.47; knee.add(ankle);
    var foot = new THREE.Mesh(new THREE.BoxGeometry(0.20,0.09,0.26), plate);
    foot.position.set(0,-0.03,0.08); ankle.add(foot);
    for (var c = 0; c < 3; c++) {
      var claw = new THREE.Mesh(new THREE.ConeGeometry(0.03,0.17,5), vein);
      claw.position.set((c-1)*0.06,-0.04,0.23); claw.rotation.x = Math.PI/2; ankle.add(claw);
    }
    legs.push({hip:hip, knee:knee, ankle:ankle, phase:ph});
  }
  // 尾巴：末影龙式长尾 + 尾鳍
  var tailRoot = new THREE.Group(); tailRoot.position.set(0,1.02,-3.1); g.add(tailRoot);
  var tail = [], parent = tailRoot;
  for (var ts = 0; ts < 7; ts++) {
    var seg = new THREE.Group(); seg.position.z = ts ? -0.36 : 0; parent.add(seg);
    var tm = new THREE.Mesh(new THREE.BoxGeometry(0.22-ts*0.022,0.20-ts*0.02,0.38), black2);
    tm.position.z = -0.19; tm.castShadow = true; seg.add(tm);
    tail.push(seg); parent = seg;
  }
  var fin = new THREE.Mesh(new THREE.BoxGeometry(0.46,0.10,0.40), vein);
  fin.position.set(0,0.04,-0.24); parent.add(fin);
  var dummy = new THREE.Group(); g.add(dummy);
  var lod = new THREE.Mesh(body.geometry, body.material);
  lod.position.copy(body.position); lod.scale.copy(body.scale); lod.visible = false; g.add(lod);
  return {g:g, body:body, lod:lod, legL:dummy, legR:dummy, armL:dummy, armR:dummy,
    casters:[body], beast:1, limbs:[], slots:[], attached:true,
    dragon:{body:body, head:head, legs:legs, tail:tail, wings:wings, t:0, speed:0}};
}

`;
s = s.replace(marker, code + marker);
// 路由到末影龙
s = s.replace("if (skin === 'dragon') { return mobDragonBone(rank); }",
              "if (skin === 'dragon') { return mobEnderDragon(rank); }");
fs.writeFileSync(p, s);
