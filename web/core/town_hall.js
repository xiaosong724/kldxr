/* 大厅与传送阵专用模型：大厅门廊/山花/塔楼、20 把座椅；圆形传送阵 */
function makeAdd(g) {
  return function (m, name) {
    if (!m) { return m; }
    tmTag(m, name);
    g.userData.parts.push({ id: name, cn: townPartCn(name) });
    return m;
  };
}

function buildHallModel(spec, opts) {
  var W = 20.0, D = 14.0, H = 4.8, BY = 0.18;
  var wall = opts.wall || 0xd8cdb8;
  var trim = opts.trim || 0x3d4549;
  var roof = opts.roof || 0x4a5458;
  var g = new THREE.Group(); g.userData.parts = [];
  var add = makeAdd(g);
  function box(w, h, d, c, x, y, z, name, ry) { return add(tmBox(g, w, h, d, c, x, y, z, ry), name); }
  function glass(w, h, d, x, y, z, name) { return add(tmGlassBox(g, w, h, d, x, y, z, name), name); }

  /* base + broad front steps */
  box(W + 2.4, 0.20, D + 2.4, 0xcfc7b6, 0, 0.10, 0, 'hall_base');
  for (var s = 0; s < 3; s++) {
    box(10.8 - s * 1.4, 0.16, 0.55, 0xd8d0bf, 0, 0.10 + s * 0.16, D / 2 + 1.6 - s * 0.55, 'hall_step_' + (s + 1));
  }

  /* main hall shell */
  box(W, H, 0.22, wall, 0, BY + H / 2, -D / 2, 'hall_back_wall');
  box(0.22, H, D, wall, -W / 2, BY + H / 2, 0, 'hall_side_wall_left');
  box(0.22, H, D, wall, W / 2, BY + H / 2, 0, 'hall_side_wall_right');
  var dW = 2.8, sgw = (W - dW) / 2 - 0.5;
  glass(sgw, H - 0.9, 0.05, -(dW / 2 + sgw / 2 + 0.2), BY + H / 2, D / 2, 'hall_front_glass_left');
  glass(sgw, H - 0.9, 0.05, (dW / 2 + sgw / 2 + 0.2), BY + H / 2, D / 2, 'hall_front_glass_right');
  box(0.18, H - 0.8, 0.18, trim, -dW / 2 - 0.12, BY + H / 2, D / 2 + 0.05, 'hall_entry_frame_left');
  box(0.18, H - 0.8, 0.18, trim, dW / 2 + 0.12, BY + H / 2, D / 2 + 0.05, 'hall_entry_frame_right');
  box(dW + 0.45, 0.22, 0.26, trim, 0, BY + H - 0.38, D / 2 + 0.05, 'hall_entry_frame_top');
  box(dW, 0.06, 0.9, 0x9a968a, 0, BY + 0.03, D / 2 + 0.35, 'hall_entry_threshold');
  for (var m = 0; m < 5; m++) {
    var mx = -W / 2 + 0.8 + m * (W - 1.6) / 4;
    if (Math.abs(mx) < dW / 2 + 0.3) { continue; }
    box(0.12, H, 0.12, trim, mx, BY + H / 2, D / 2 + 0.03, 'hall_front_mullion_' + (m + 1));
  }
  box(W + 1.0, 0.24, 0.45, trim, 0, BY + H + 0.12, D / 2 + 0.1, 'hall_front_fascia');
  box(W + 1.2, 0.35, D + 1.2, roof, 0, BY + H + 0.32, 0, 'hall_roof');
  box(W + 1.0, 0.50, 0.18, trim, 0, BY + H + 0.60, D / 2 + 0.60, 'hall_parapet_front');
  box(W + 1.0, 0.50, 0.18, trim, 0, BY + H + 0.60, -D / 2 - 0.60, 'hall_parapet_back');

  /* grand portico: six columns, entablature and pediment */
  var pz = D / 2 + 1.55, cw = 11.4;
  box(cw, 0.30, 1.9, 0xcfc7b6, 0, BY + 0.15, pz, 'hall_portico_floor');
  for (var c = 0; c < 6; c++) {
    var cx = -cw / 2 + 0.7 + c * (cw - 1.4) / 5;
    box(0.55, 3.65, 0.55, 0xe6ddca, cx, BY + 1.98, pz, 'hall_portico_column_' + (c + 1));
    box(0.72, 0.18, 0.72, trim, cx, BY + 0.30, pz, 'hall_portico_base_' + (c + 1));
    box(0.70, 0.16, 0.70, trim, cx, BY + 3.68, pz, 'hall_portico_cap_' + (c + 1));
  }
  box(cw + 0.5, 0.50, 1.5, 0xe6ddca, 0, BY + 3.98, pz, 'hall_portico_entablature');
  box(cw + 0.9, 0.22, 1.8, trim, 0, BY + 4.25, pz, 'hall_portico_cornice');
  /* triangular pediment */
  var ped = new THREE.BufferGeometry();
  var pw = cw / 2 + 0.25, ph = 1.35, py = BY + 4.35;
  ped.setAttribute('position', new THREE.Float32BufferAttribute([
    -pw, py, pz + 0.70, pw, py, pz + 0.70, 0, py + ph, pz + 0.70,
    -pw, py, pz - 0.70, 0, py + ph, pz - 0.70, pw, py, pz - 0.70
  ], 3));
  ped.setIndex([0, 1, 2, 3, 4, 5, 0, 3, 5, 0, 5, 1, 1, 5, 4, 1, 4, 2, 0, 2, 4, 0, 4, 3]);
  ped.computeVertexNormals();
  var pm = new THREE.Mesh(ped, new THREE.MeshLambertMaterial({ color: 0xe6ddca, side: THREE.DoubleSide }));
  g.add(pm); add(pm, 'hall_pediment');
  box(cw + 0.4, 0.18, 0.20, trim, 0, py + 0.05, pz + 0.72, 'hall_pediment_beam');

  /* side wings */
  for (var sd = -1; sd <= 1; sd += 2) {
    var wx = sd * (W / 2 + 1.5);
    box(3.6, 3.7, 6.0, wall, wx, BY + 1.85, 0, sd < 0 ? 'hall_wing_left' : 'hall_wing_right');
    box(3.8, 0.20, 6.2, roof, wx, BY + 3.80, 0, sd < 0 ? 'hall_wing_left_roof' : 'hall_wing_right_roof');
    glass(0.05, 2.1, 3.4, wx + sd * 1.82, BY + 2.0, 0, sd < 0 ? 'hall_wing_left_glass' : 'hall_wing_right_glass');
  }

  /* roof lantern / clock tower */
  box(4.2, 2.2, 4.2, wall, 0, BY + H + 1.4, 0, 'hall_tower');
  glass(3.0, 1.2, 0.05, 0, BY + H + 1.5, 2.13, 'hall_tower_glass');
  /* square tower roof: stacked square slabs instead of a round cone */
  box(4.4, 0.18, 4.4, trim, 0, BY + H + 2.82, 0, 'hall_tower_roof_1');
  box(3.9, 0.18, 3.9, 0x4a5458, 0, BY + H + 3.02, 0, 'hall_tower_roof_2');
  box(3.2, 0.18, 3.2, trim, 0, BY + H + 3.22, 0, 'hall_tower_roof_3');
  box(2.3, 0.18, 2.3, 0x4a5458, 0, BY + H + 3.42, 0, 'hall_tower_roof_4');
  box(1.2, 0.30, 1.2, trim, 0, BY + H + 3.62, 0, 'hall_tower_finial');
  box(0.16, 0.55, 0.16, 0x9a968a, 0, BY + H + 3.98, 0, 'hall_tower_spire');

  /* interior: marble floor, stage and rows of player chairs */
  box(W - 0.8, 0.04, D - 0.8, 0xc9cbcc, 0, BY + 0.02, 0, 'hall_floor');
  var Pst = tmPiece(g, 'shop_counter', '舞台');
  Pst.add(box(7.0, 0.28, 2.4, 0x8a6a48, 0, BY + 0.14, -D / 2 + 1.6, 'hall_stage'));
  tmPieceEnd(g, Pst);
  var Prug = tmPiece(g, 'rug_rect', '舞台地毯');
  Prug.add(box(6.0, 0.06, 1.8, 0x8a5a4a, 0, BY + 0.32, -D / 2 + 1.6, 'hall_stage_rug'));
  tmPieceEnd(g, Prug);
  var Psp = tmPiece(g, 'dining_table', '演讲台');
  Psp.add(box(1.5, 0.10, 0.6, 0x6b4a32, 0, BY + 0.40, -D / 2 + 1.5, 'hall_speaker_desk'));
  tmPieceEnd(g, Psp);
  var Plect = tmPiece(g, 'shop_counter', '讲台');
  Plect.add(add(tmCyl(g, 0.8, 0.0, 0.45, 0x6b4a32, 2.8, BY + 0.55, -D / 2 + 1.5, 'hall_lectern'), 'hall_lectern'));
  tmPieceEnd(g, Plect);
  var chairNo = 1;
  for (var r = 0; r < 4; r++) {
    for (var q = 0; q < 5; q++) {
      var chx = -4.4 + q * 2.2, chz = -1.6 + r * 2.0;
      buildChairAt(g, add, chx, chz, Math.PI, 'hall_chair_' + chairNo, 0x6b4a32, BY);
      chairNo++;
    }
  }
  var Prec = tmPiece(g, 'shop_counter', '接待台');
  Prec.add(box(5.0, 0.95, 0.8, 0x6b4a32, -W / 2 + 3.0, BY + 0.50, D / 2 - 2.0, 'hall_reception'));
  Prec.add(box(5.2, 0.10, 0.9, 0xd8cbb0, -W / 2 + 3.0, BY + 1.02, D / 2 - 2.0, 'hall_reception_top'));
  tmPieceEnd(g, Prec);
  var Pif = tmPiece(g, 'dining_table', '咨询桌');
  Pif.add(box(2.4, 0.85, 0.8, 0x6b4a32, W / 2 - 3.0, BY + 0.45, D / 2 - 2.0, 'hall_info_table'));
  tmPieceEnd(g, Pif);
  var Ppl = tmPiece(g, 'plant_pot', '盆栽');
  Ppl.add(add(tmCyl(g, 0.18, 0.23, 0.35, 0x9a5f42, W / 2 - 3.0, BY + 1.10, D / 2 - 2.0, 'plant_1'), 'plant_1'));
  Ppl.add(add(tmSphere(g, 0.28, 0x5c8a52, W / 2 - 3.0, BY + 1.48, D / 2 - 2.0, 'plant_1_leaf'), 'plant_1_leaf'));
  tmPieceEnd(g, Ppl);
  var Pnt = tmPiece(g, 'promo_board', '公告栏');
  Pnt.add(box(2.2, 1.0, 0.10, 0x2f3438, -W / 2 + 0.40, BY + 2.1, 0, 'hall_notice'));
  tmPieceEnd(g, Pnt);
  var Pch = tmPiece(g, 'ceiling_lamp', '吊灯');
  Pch.add(box(0.7, 0.30, 0.7, 0xffd9a0, 0, BY + 3.8, 0, 'hall_chandelier'));
  tmPieceEnd(g, Pch);
  tmCollectFurniture(g);
  return g;
}

function buildTeleportModel(spec, opts) {
  var g = new THREE.Group(); g.userData.parts = [];
  var add = makeAdd(g);
  var cyan = 0x8fe6ff, blue = 0x3f9fbe;
  function box(w, h, d, c, x, y, z, name) { return add(tmBox(g, w, h, d, c, x, y, z), name); }
  function cyl(rt, rb, h, c, x, y, z, name, seg) {
    var m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 32),
      new THREE.MeshLambertMaterial({ color: c }));
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    g.add(m); add(m, name); return m;
  }
  cyl(1.75, 1.85, 0.14, 0x726b5e, 0, 0.07, 0, 'tp_base_lower', 36);
  cyl(1.55, 1.68, 0.12, 0x8a8272, 0, 0.18, 0, 'tp_base_mid', 36);
  cyl(1.35, 1.48, 0.12, 0xa39a87, 0, 0.29, 0, 'tp_base_upper', 36);
  cyl(1.22, 1.22, 0.04, cyan, 0, 0.37, 0, 'tp_energy_disc', 36);
  var ring = new THREE.Mesh(new THREE.TorusGeometry(1.30, 0.075, 10, 48),
    new THREE.MeshLambertMaterial({ color: cyan, emissive: 0x2a6b80 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.40; g.add(ring); add(ring, 'tp_ring_outer');
  var ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.055, 10, 40),
    new THREE.MeshLambertMaterial({ color: blue, emissive: 0x1f4f60 }));
  ring2.rotation.x = Math.PI / 2; ring2.position.y = 0.42; g.add(ring2); add(ring2, 'tp_ring_inner');
  for (var rn = 0; rn < 8; rn++) {
    var a = rn / 8 * Math.PI * 2;
    box(0.16, 0.05, 0.34, cyan, Math.cos(a) * 1.08, 0.40, Math.sin(a) * 1.08, 'tp_rune_' + (rn + 1));
  }
  for (var c = 0; c < 4; c++) {
    var ca = c / 4 * Math.PI * 2 + Math.PI / 4;
    var cm = new THREE.Mesh(new THREE.OctahedronGeometry(0.20),
      new THREE.MeshLambertMaterial({ color: cyan, emissive: 0x2a6b80 }));
    cm.position.set(Math.cos(ca) * 1.55, 0.75, Math.sin(ca) * 1.55);
    g.add(cm); add(cm, 'tp_crystal_' + (c + 1));
  }
  /* rising teleport particles instead of a solid beam */
  var COUNT = 220;
  var pos = new Float32Array(COUNT * 3);
  var seed = new Float32Array(COUNT * 3);
  for (var pi = 0; pi < COUNT; pi++) {
    var ang = Math.random() * Math.PI * 2;
    var rad = Math.sqrt(Math.random()) * 1.18;
    seed[pi * 3] = Math.cos(ang) * rad;
    seed[pi * 3 + 1] = Math.random();
    seed[pi * 3 + 2] = Math.sin(ang) * rad;
    pos[pi * 3] = seed[pi * 3];
    pos[pi * 3 + 1] = 0.4 + seed[pi * 3 + 1] * 2.8;
    pos[pi * 3 + 2] = seed[pi * 3 + 2];
  }
  var pgeo = new THREE.BufferGeometry();
  pgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  var pmat = new THREE.PointsMaterial({
    color: cyan, size: 0.09, transparent: true, opacity: 0.85,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
  });
  var particles = new THREE.Points(pgeo, pmat);
  particles.userData.tpSeed = seed;
  particles.userData.tpSpeed = new Float32Array(COUNT);
  for (var sp = 0; sp < COUNT; sp++) { particles.userData.tpSpeed[sp] = 0.35 + Math.random() * 0.75; }
  g.add(particles);
  add(particles, 'tp_particles');
  var core = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.42, 0.9, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: cyan, transparent: true, opacity: 0.20, side: THREE.DoubleSide, depthWrite: false }));
  core.position.y = 0.90; g.add(core); add(core, 'tp_core_glow');
  /* animated particles: rise, fade by re-seeding at the base */
  g.userData.animate = function (t) {
    var arr = pgeo.attributes.position.array;
    var spd = particles.userData.tpSpeed;
    for (var i = 0; i < COUNT; i++) {
      arr[i * 3 + 1] += spd[i] * 0.016 * (t > 0 ? 1 : 0);
      if (arr[i * 3 + 1] > 3.25) {
        arr[i * 3 + 1] = 0.40;
        arr[i * 3] = seed[i * 3] * (0.55 + Math.random() * 0.45);
        arr[i * 3 + 2] = seed[i * 3 + 2] * (0.55 + Math.random() * 0.45);
      }
    }
    pgeo.attributes.position.needsUpdate = true;
    pmat.opacity = 0.65 + Math.sin(t * 2.2) * 0.15;
  };
  return g;
}
