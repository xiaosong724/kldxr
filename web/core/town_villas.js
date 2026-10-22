/* 别墅 v1/v2 专用模型：真实两层、楼梯、二层缩小、大阳台、院子、豪华现代家具 */
var VS = {
  v1: {
    W1: 14.0, D1: 11.0, H1: 3.30,
    W2: 8.8, D2: 7.0, H2: 3.00,
    ox: -1.8, oz: -0.3,
    wall: 0xd6d7d2, trim: 0x2b3a42, roof: 0x56656b,
    glass: 0xb8e6f0, yard: 0x7fae6a, deck: 0xb08a62,
    style: 'white'
  },
  v2: {
    W1: 12.6, D1: 12.2, H1: 3.50,
    W2: 8.0, D2: 7.4, H2: 2.90,
    ox: 2.2, oz: -1.0,
    wall: 0x4a4a46, trim: 0x9a7a52, roof: 0x2f3438,
    glass: 0x9fc8d4, yard: 0x8a8a72, deck: 0x8f8172,
    style: 'dark'
  }
};

function buildVillaModel(spec, opts) {
  var V = VS[spec.villaStyle] || VS.v1;
  var g = new THREE.Group();
  g.userData.parts = [];
  var wall = opts.wall || V.wall;
  var trim = opts.trim || V.trim;
  var roof = opts.roof || V.roof;
  var BY = 0.20;
  var UY = BY + V.H1;
  var TY = UY + V.H2;
  var F1 = V.D1 / 2, F2 = V.oz + V.D2 / 2;

  function add(m, name) {
    if (!m) { return m; }
    tmTag(m, name);
    g.userData.parts.push({ id: name, cn: townPartCn(name) });
    return m;
  }
  function box(w, h, d, c, x, y, z, name, ry) {
    return add(tmBox(g, w, h, d, c, x, y, z, ry), name);
  }
  function glass(w, h, d, x, y, z, name, ry) {
    return add(tmGlassBox(g, w, h, d, x, y, z, name), name);
  }
  function cyl(rt, rb, h, c, x, y, z, name) {
    return add(tmCyl(g, rt, rb, h, c, x, y, z), name);
  }
  function ball(r, c, x, y, z, name) {
    return add(tmSphere(g, r, c, x, y, z), name);
  }

  /* ---------------- ground floor ---------------- */
  box(V.W1 + 0.5, 0.18, V.D1 + 0.5, wall, 0, BY / 2, 0, 'villa_base');
  box(V.W1, V.H1, 0.20, wall, 0, BY + V.H1 / 2, -F1, 'f1_back_wall');
  box(0.20, V.H1, V.D1, wall, -V.W1 / 2, BY + V.H1 / 2, 0, 'f1_side_wall_left');
  box(0.20, V.H1, V.D1, wall, V.W1 / 2, BY + V.H1 / 2, 0, 'f1_side_wall_right');
  var dW = 1.9, sgw = (V.W1 - dW) / 2 - 0.35;
  glass(sgw, V.H1 - 0.6, 0.05, -(dW / 2 + sgw / 2 + 0.1), BY + V.H1 / 2, F1, 'f1_front_glass_left');
  glass(sgw, V.H1 - 0.6, 0.05, (dW / 2 + sgw / 2 + 0.1), BY + V.H1 / 2, F1, 'f1_front_glass_right');
  box(0.14, V.H1 - 0.5, 0.14, trim, -dW / 2 - 0.10, BY + V.H1 / 2, F1 + 0.06, 'f1_entry_frame_left');
  box(0.14, V.H1 - 0.5, 0.14, trim, dW / 2 + 0.10, BY + V.H1 / 2, F1 + 0.06, 'f1_entry_frame_right');
  box(dW + 0.34, 0.16, 0.22, trim, 0, BY + V.H1 - 0.32, F1 + 0.06, 'f1_entry_frame_top');
  box(dW, 0.05, 0.70, 0x9a968a, 0, BY + 0.03, F1 + 0.38, 'f1_entry_threshold');
  for (var c1 = 0; c1 < 5; c1++) {
    var cx1 = -V.W1 / 2 + 0.4 + c1 * (V.W1 - 0.8) / 4;
    if (Math.abs(cx1) < dW / 2 + 0.25) { continue; }
    box(0.10, V.H1, 0.10, trim, cx1, BY + V.H1 / 2, F1 + 0.02, 'f1_front_mullion_' + (c1 + 1));
  }
  box(V.W1 + 0.7, 0.22, 0.28, trim, 0, BY + V.H1, F1 + 0.10, 'f1_fascia');
  box(V.W1 + 0.9, 0.14, 1.6, trim, 0, BY + V.H1 + 0.30, F1 + 0.45, 'f1_overhang');
  /* ground furniture */
  buildSofaAt(g, add, 2.55, 2.10, 0);
  buildSofaAt(g, add, 4.75, 2.10, 0);
  var Prg = tmPiece(g, 'rug_rect', '地毯'); Prg.add(box(3.5, 0.05, 1.8, 0x9a7a5a, 3.65, 0.32, 1.95, 'living_rug')); tmPieceEnd(g, Prg);
  var Ptv = tmPiece(g, 'tv_wall', '壁挂电视'); Ptv.add(box(1.05, 0.55, 0.08, 0x2f3438, 3.65, 1.15, F1 - 0.22, 'living_tv')); tmPieceEnd(g, Ptv);
  var Pst = tmPiece(g, 'tv_stand', '电视柜'); Pst.add(box(1.20, 0.40, 0.28, 0x6b4a32, 3.65, 0.45, F1 - 0.34, 'living_tv_stand')); tmPieceEnd(g, Pst);
  var Pdt = tmPiece(g, 'dining_table', '餐桌');
  Pdt.add(box(1.45, 0.10, 0.86, 0x6b4a32, -1.3, 0.72, 2.1, 'dining_table'));
  Pdt.add(box(0.10, 0.62, 0.10, 0x4a3423, -1.3, 0.42, 2.1, 'dining_table_leg'));
  tmPieceEnd(g, Pdt);
  buildChairAt(g, add, -2.3, 2.1, -Math.PI / 2, 'dining_chair_1', 0x8a5a3a);
  buildChairAt(g, add, -0.3, 2.1, Math.PI / 2, 'dining_chair_2', 0x8a5a3a);
  buildChairAt(g, add, -1.3, 3.05, Math.PI, 'dining_chair_3', 0x8a5a3a);
  buildChairAt(g, add, -1.3, 1.15, 0, 'dining_chair_4', 0x8a5a3a);
  /* kitchen along back-left */
  var Pkc = tmPiece(g, 'kitchen_counter', '厨房操作台');
  Pkc.add(box(3.4, 0.90, 0.62, 0xc8b998, -3.4, 0.72, -F1 + 1.05, 'kitchen_counter'));
  Pkc.add(box(3.5, 0.10, 0.76, 0x8a959b, -3.4, 1.22, -F1 + 1.05, 'kitchen_top'));
  tmPieceEnd(g, Pkc);
  var Pks = tmPiece(g, 'kitchen_sink', '水槽');
  Pks.add(box(0.75, 0.06, 0.42, 0x5a6e7a, -3.4, 1.28, -F1 + 1.05, 'kitchen_sink'));
  Pks.add(box(0.06, 0.30, 0.06, 0x9aa3a8, -3.4, 1.44, -F1 + 0.83, 'kitchen_faucet'));
  tmPieceEnd(g, Pks);
  var Pkst = tmPiece(g, 'kitchen_stove', '灶台'); Pkst.add(box(0.85, 0.08, 0.52, 0x2f3438, -2.0, 1.28, -F1 + 1.05, 'kitchen_stove')); tmPieceEnd(g, Pkst);
  var Pki = tmPiece(g, 'kitchen_island', '厨房中岛'); Pki.add(box(2.4, 0.16, 1.0, 0x8a959b, -3.0, 1.02, -F1 + 2.4, 'kitchen_island')); tmPieceEnd(g, Pki);
  var Pko = tmPiece(g, 'kitchen_oven', '烤箱'); Pko.add(box(0.9, 0.65, 0.04, 0x2f3438, -2.0, 0.62, -F1 + 1.35, 'kitchen_oven')); tmPieceEnd(g, Pko);
  var Pkk = tmPiece(g, 'kitchen_cabinet', '厨房吊柜'); Pkk.add(box(3.0, 0.75, 0.35, 0x9a8a70, -3.3, 2.35, -F1 + 0.95, 'kitchen_cabinet')); tmPieceEnd(g, Pkk);
  buildFridgeAt(g, add, -V.W1 / 2 + 1.0, -F1 + 2.2, Math.PI / 2);
  /* bathroom: whole zone in the back-right corner */
  var Pto = tmPiece(g, 'toilet', '马桶');
  Pto.add(box(0.50, 0.35, 0.62, 0xe8e4d8, V.W1 / 2 - 0.55, 0.43, -F1 + 0.55, 'toilet_base'));
  Pto.add(cyl(0.25, 0.28, 0.16, 0xf2eee4, V.W1 / 2 - 0.55, 0.68, -F1 + 0.60, 'toilet_bowl'));
  Pto.add(box(0.50, 0.62, 0.22, 0xe8e4d8, V.W1 / 2 - 0.55, 0.88, -F1 + 0.23, 'toilet_tank'));
  Pto.add(box(0.30, 0.04, 0.04, 0xbfc4c2, V.W1 / 2 - 0.55, 1.22, -F1 + 0.23, 'toilet_flush'));
  tmPieceEnd(g, Pto);
  var Pva = tmPiece(g, 'bath_vanity', '洗手台');
  Pva.add(box(0.80, 0.78, 0.44, 0xb8a88a, V.W1 / 2 - 0.60, 0.39, -F1 + 2.05, 'bath_vanity'));
  Pva.add(box(0.66, 0.07, 0.34, 0xe8e4d8, V.W1 / 2 - 0.60, 0.82, -F1 + 2.05, 'bath_basin'));
  tmPieceEnd(g, Pva);
  var Pmi = tmPiece(g, 'bath_mirror', '浴室镜'); Pmi.add(box(0.05, 0.75, 0.75, 0x9fd8e8, V.W1 / 2 - 0.08, 1.65, -F1 + 2.05, 'bath_mirror', Math.PI / 2)); tmPieceEnd(g, Pmi);
  var Psh = tmPiece(g, 'shower_tray', '淋浴间');
  Psh.add(box(1.05, 0.10, 1.05, 0x59666a, V.W1 / 2 - 1.55, 0.30, -F1 + 2.55, 'shower_tray'));
  Psh.add(glass(1.05, 1.80, 0.04, V.W1 / 2 - 1.55, 1.15, -F1 + 3.05, 'shower_glass'));
  tmPieceEnd(g, Psh);
  /* side wall at x=4.05, front wall across the corner */
  box(0.12, 2.35, 1.00, wall, 4.05, BY + 1.18, -F1 + 0.50, 'bath_wall_side_back');
  box(0.12, 2.35, 0.60, wall, 4.05, BY + 1.18, -F1 + 2.80, 'bath_wall_side_front');
  box(3.00, 2.35, 0.12, wall, 5.55, BY + 1.18, -F1 + 3.10, 'bath_wall_front');
  box(0.10, 2.30, 0.10, trim, 4.05, BY + 1.15, -F1 + 1.00, 'bath_wall_post_1');
  box(0.10, 2.30, 0.10, trim, 4.05, BY + 1.15, -F1 + 2.50, 'bath_wall_post_2');
  /* stairs: real steps from ground to upper floor */
  var sx = V.style === 'white' ? (V.ox - V.W2 * 0.32) : (V.ox + V.W2 * 0.32), sz = V.oz - 1.1, steps = 12;
  for (var st = 0; st < steps; st++) {
    var r = (st + 1) / steps * V.H1;
    box(1.15, r, 0.34, 0x9a968a, sx, BY + r / 2, sz + st * 0.34, 'stair_step_' + (st + 1));
  }
  box(0.10, V.H1 + 0.9, 0.10, trim, sx - 0.58, BY + (V.H1 + 0.9) / 2, sz + steps * 0.34 / 2, 'stair_rail_left');
  box(0.10, V.H1 + 0.9, 0.10, trim, sx + 0.58, BY + (V.H1 + 0.9) / 2, sz + steps * 0.34 / 2, 'stair_rail_right');
  box(1.35, 0.05, 0.10, trim, sx, UY + 0.03, sz, 'stair_opening_trim_back');
  box(1.35, 0.05, 0.10, trim, sx, UY + 0.03, sz + steps * 0.34, 'stair_opening_trim_front');

  /* ---------------- upper floor (smaller) ---------------- */
  /* slab pieces leave a stair opening */
  var holeX = sx, holeZ0 = sz, holeZ1 = sz + steps * 0.34;
  box(V.W2, 0.18, holeZ0 - (V.oz - V.D2 / 2), wall,
    V.ox, UY, (V.oz - V.D2 / 2 + holeZ0) / 2, 'f2_floor_back');
  box(V.W2, 0.18, (V.oz + V.D2 / 2) - holeZ1, wall,
    V.ox, UY, (holeZ1 + V.oz + V.D2 / 2) / 2, 'f2_floor_front');
  box((holeX - 0.7) - (V.ox - V.W2 / 2), 0.18, holeZ1 - holeZ0, wall,
    ((V.ox - V.W2 / 2) + holeX - 0.7) / 2, UY, (holeZ0 + holeZ1) / 2, 'f2_floor_left');
  box((V.ox + V.W2 / 2) - (holeX + 0.7), 0.18, holeZ1 - holeZ0, wall,
    ((holeX + 0.7) + V.ox + V.W2 / 2) / 2, UY, (holeZ0 + holeZ1) / 2, 'f2_floor_right');
  /* the exposed ground-floor roof beside the smaller upper floor is capped */
  var lw = (V.ox - V.W2 / 2) - (-V.W1 / 2);
  var rw = (V.W1 / 2) - (V.ox + V.W2 / 2);
  var bw = (V.oz - V.D2 / 2) - (-V.D1 / 2);
  var fw = (V.D1 / 2) - (V.oz + V.D2 / 2);
  box(lw, 0.18, V.D1, roof, -V.W1 / 2 + lw / 2, UY - 0.09, 0, 'roof_terrace_left');
  box(rw, 0.18, V.D1, roof, V.W1 / 2 - rw / 2, UY - 0.09, 0, 'roof_terrace_right');
  box(V.W2, 0.18, bw, roof, V.ox, UY - 0.09, -V.D1 / 2 + bw / 2, 'roof_terrace_back');
  box(V.W2, 0.18, fw, roof, V.ox, UY - 0.09, V.D1 / 2 - fw / 2, 'roof_terrace_front');
  box(V.W1 + 0.3, 0.40, 0.16, trim, 0, UY + 0.20, -V.D1 / 2 - 0.10, 'roof_parapet_back');
  box(0.16, 0.40, V.D1, trim, -V.W1 / 2 - 0.10, UY + 0.20, 0, 'roof_parapet_left');
  box(0.16, 0.40, V.D1, trim, V.W1 / 2 + 0.10, UY + 0.20, 0, 'roof_parapet_right');
  box(V.W2 - 0.35, 0.035, (holeZ0 - (V.oz - V.D2 / 2)) - 0.25, 0xc9cbcc,
    V.ox, UY + 0.105, ((V.oz - V.D2 / 2) + holeZ0) / 2, 'f2_floor_light_back');
  box(V.W2 - 0.35, 0.035, ((V.oz + V.D2 / 2) - holeZ1) - 0.25, 0xc9cbcc,
    V.ox, UY + 0.105, (holeZ1 + V.oz + V.D2 / 2) / 2, 'f2_floor_light_front');
  box((holeX - 0.7) - (V.ox - V.W2 / 2) - 0.25, 0.035, holeZ1 - holeZ0, 0xc9cbcc,
    ((V.ox - V.W2 / 2) + holeX - 0.7) / 2, UY + 0.105, (holeZ0 + holeZ1) / 2, 'f2_floor_light_left');
  box((V.ox + V.W2 / 2) - (holeX + 0.7) - 0.25, 0.035, holeZ1 - holeZ0, 0xc9cbcc,
    ((holeX + 0.7) + V.ox + V.W2 / 2) / 2, UY + 0.105, (holeZ0 + holeZ1) / 2, 'f2_floor_light_right');
  box(V.W2, V.H2, 0.18, wall, V.ox, UY + V.H2 / 2, V.oz - V.D2 / 2, 'f2_back_wall');
  box(0.18, V.H2, V.D2, wall, V.ox - V.W2 / 2, UY + V.H2 / 2, V.oz, 'f2_side_wall_left');
  box(0.18, V.H2, V.D2, wall, V.ox + V.W2 / 2, UY + V.H2 / 2, V.oz, 'f2_side_wall_right');
  var bdW = 1.6, bgw = (V.W2 - bdW) / 2 - 0.30;
  glass(bgw, V.H2 - 0.5, 0.05, V.ox - (bdW / 2 + bgw / 2 + 0.1), UY + V.H2 / 2, F2, 'f2_front_glass_left');
  glass(bgw, V.H2 - 0.5, 0.05, V.ox + (bdW / 2 + bgw / 2 + 0.1), UY + V.H2 / 2, F2, 'f2_front_glass_right');
  box(0.12, V.H2 - 0.4, 0.12, trim, V.ox - bdW / 2 - 0.08, UY + V.H2 / 2, F2 + 0.05, 'f2_balcony_door_frame_left');
  box(0.12, V.H2 - 0.4, 0.12, trim, V.ox + bdW / 2 + 0.08, UY + V.H2 / 2, F2 + 0.05, 'f2_balcony_door_frame_right');
  box(bdW + 0.28, 0.14, 0.18, trim, V.ox, UY + V.H2 - 0.30, F2 + 0.05, 'f2_balcony_door_frame_top');
  box(bdW, 0.05, 0.55, V.deck, V.ox, UY + 0.03, F2 + 0.28, 'f2_balcony_door_threshold');
  box(V.W2 + 0.6, 0.22, V.D2 + 0.6, roof, V.ox, TY + 0.11, V.oz, 'roof_villa');
  box(V.W2 + 0.9, 0.38, 0.14, trim, V.ox, TY + 0.42, V.oz + V.D2 / 2 + 0.30, 'roof_parapet_upper_front');
  box(V.W2 + 0.9, 0.38, 0.14, trim, V.ox, TY + 0.42, V.oz - V.D2 / 2 - 0.30, 'roof_parapet_upper_back');
  box(0.14, 0.38, V.D2, trim, V.ox - V.W2 / 2 - 0.30, TY + 0.42, V.oz, 'roof_parapet_upper_left');
  box(0.14, 0.38, V.D2, trim, V.ox + V.W2 / 2 + 0.30, TY + 0.42, V.oz, 'roof_parapet_upper_right');    box(V.W2 + 1.0, 0.14, V.D2 + 1.0, trim, V.ox, TY + 0.28, V.oz, 'roof_overhang');
  /* big balcony */
  var bd = V.style === 'white' ? 2.8 : 3.2;
  box(V.W2 * 0.92, 0.18, bd, V.deck, V.ox, UY + 0.02, F2 + bd / 2, 'balcony_deck');
  box(V.W2 * 0.92, 0.10, 0.10, 0xbfc4c2, V.ox, UY + 1.25, F2 + bd - 0.05, 'balcony_rail_front');
  box(0.10, 1.25, bd, 0xbfc4c2, V.ox - V.W2 * 0.46, UY + 0.65, F2 + bd / 2, 'balcony_rail_left');
  box(0.10, 1.25, bd, 0xbfc4c2, V.ox + V.W2 * 0.46, UY + 0.65, F2 + bd / 2, 'balcony_rail_right');
  for (var bp = 0; bp < 5; bp++) {
    box(0.07, 1.20, 0.07, trim, V.ox - V.W2 * 0.4 + bp * V.W2 * 0.2, UY + 0.65, F2 + bd - 0.07, 'balcony_post_' + (bp + 1));
  }
  /* balcony furniture */
  var Pbt = tmPiece(g, 'outdoor_table', '阳台桌', 1);
  Pbt.add(box(0.8, 0.45, 0.8, 0x6b4a32, V.ox + 1.2, UY + 0.28, F2 + 1.1, 'balcony_table'));
  tmPieceEnd(g, Pbt);
  var Ppl = tmPiece(g, 'plant_pot', '盆栽', 1);
  Ppl.add(cyl(0.22, 0.26, 0.35, 0x9a5f42, V.ox + 2.8, UY + 0.45, F2 + 1.2, 'plant_1'));
  Ppl.add(ball(0.28, 0x5c8a52, V.ox + 2.8, UY + 0.75, F2 + 1.2, 'plant_1_leaf'));
  tmPieceEnd(g, Ppl);

  /* ---------------- upper furniture ---------------- */
  buildBedAt(g, add, V.ox - 1.0, V.oz - 1.4, 0, UY);
  var Pw = tmPiece(g, 'wardrobe', '衣柜', 1);
  Pw.add(box(1.10, 1.85, 0.55, 0x6b4a32, V.ox + V.W2 / 2 - 0.7, UY + 1.18, V.oz - 1.4, 'wardrobe'));
  tmPieceEnd(g, Pw);
  var Pdk = tmPiece(g, 'desk', '书桌', 1);
  Pdk.add(box(1.30, 0.08, 0.70, 0x6b4a32, V.ox + 2.2, UY + 0.78, V.oz + 1.7, 'desk'));
  Pdk.add(box(0.10, 0.70, 0.10, 0x4a3423, V.ox + 1.7, UY + 0.40, V.oz + 1.7, 'desk_leg_l'));
  Pdk.add(box(0.10, 0.70, 0.10, 0x4a3423, V.ox + 2.7, UY + 0.40, V.oz + 1.7, 'desk_leg_r'));
  tmPieceEnd(g, Pdk);
  buildChairAt(g, add, V.ox + 2.2, V.oz + 1.0, Math.PI, 'desk_chair_1', 0x4a6a7a, UY);
  /* upper bathroom: whole zone tucked into the back-right corner */
  var ubx = V.ox + V.W2 / 2 - 2.55, ubz = V.oz - V.D2 / 2 + 1.95;
  box(0.12, 2.10, 2.05, wall, ubx, UY + 1.10, ubz, 'upper_bath_wall_left');
  box(2.55, 2.10, 0.12, wall, V.ox + V.W2 / 2 - 1.27, UY + 1.10, V.oz - V.D2 / 2 + 0.06, 'upper_bath_wall_back');
  box(0.80, 2.10, 0.12, wall, ubx + 0.42, UY + 1.10, ubz + 1.02, 'upper_bath_wall_front_left');
  box(0.55, 2.10, 0.12, wall, ubx + 2.28, UY + 1.10, ubz + 1.02, 'upper_bath_wall_front_right');
  var Pu1 = tmPiece(g, 'toilet', '马桶', 1);
  Pu1.add(box(0.50, 0.35, 0.62, 0xe8e4d8, V.ox + V.W2 / 2 - 0.55, UY + 0.43, V.oz - V.D2 / 2 + 0.55, 'toilet_base'));
  Pu1.add(cyl(0.25, 0.28, 0.16, 0xf2eee4, V.ox + V.W2 / 2 - 0.55, UY + 0.68, V.oz - V.D2 / 2 + 0.60, 'toilet_bowl'));
  Pu1.add(box(0.50, 0.62, 0.22, 0xe8e4d8, V.ox + V.W2 / 2 - 0.55, UY + 0.88, V.oz - V.D2 / 2 + 0.23, 'toilet_tank'));
  tmPieceEnd(g, Pu1);
  var Pu2 = tmPiece(g, 'bath_vanity', '洗手台', 1);
  Pu2.add(box(0.80, 0.78, 0.44, 0xb8a88a, V.ox + V.W2 / 2 - 0.60, UY + 0.39, ubz + 0.65, 'bath_vanity'));
  Pu2.add(box(0.66, 0.07, 0.34, 0xe8e4d8, V.ox + V.W2 / 2 - 0.60, UY + 0.82, ubz + 0.65, 'bath_basin'));
  tmPieceEnd(g, Pu2);
  var Pu3 = tmPiece(g, 'bathtub', '浴缸', 1);
  Pu3.add(box(1.25, 0.55, 0.70, 0xe8e4d8, V.ox + V.W2 / 2 - 2.05, UY + 0.30, ubz - 0.15, 'bathtub'));
  tmPieceEnd(g, Pu3);
  /* upper lounge */
  var Pbs = tmPiece(g, 'bookshelf', '书架', 1);
  Pbs.add(box(1.20, 0.80, 0.30, 0x6b4a32, V.ox - V.W2 / 2 + 0.4, UY + 0.40, V.oz + 2.5, 'bookshelf'));
  for (var bk = 0; bk < 4; bk++) {
    Pbs.add(box(0.18, 0.22, 0.20, [0xc84a3a, 0xe8c060, 0x5c8a52, 0x5c7a8a][bk],
      V.ox - V.W2 / 2 + 0.5 + bk * 0.26, UY + 1.0, V.oz + 2.5, 'book_' + (bk + 1)));
  }
  tmPieceEnd(g, Pbs);
  var Ppl2 = tmPiece(g, 'plant_pot', '盆栽', 1);
  Ppl2.add(cyl(0.18, 0.22, 0.30, 0x9a5f42, V.ox + 2.4, UY + 0.42, V.oz + 2.8, 'plant_1'));
  Ppl2.add(ball(0.24, 0x5c8a52, V.ox + 2.4, UY + 0.72, V.oz + 2.8, 'plant_1_leaf'));
  tmPieceEnd(g, Ppl2);

  if (V.style === 'white') {
    /* white villa: vertical fins + cantilever + pool */
    for (var fn = 0; fn < 7; fn++) {
      if (fn === 3) { continue; }
      box(0.08, V.H1 + 0.5, 0.22, 0xffffff,
        -V.W1 / 2 + 0.6 + fn * (V.W1 - 1.2) / 6, BY + V.H1 / 2, F1 + 0.16,
        'villa_fin_' + (fn + 1));
    }
    box(V.W2 + 1.4, 0.30, 0.60, 0x2b3a42, V.ox, UY - 0.20, F2 + 0.2, 'villa_cantilever_beam');
  } else {
    /* dark villa: stone base, timber screens, green roof */
    box(V.W1, 1.25, 0.18, 0x6b6a63, 0, BY + 0.62, F1 + 0.03, 'villa_stone_clad');
    for (var sl = 0; sl < 9; sl++) {
      box(0.10, V.H1 - 1.0, 0.10, 0x9a7a52,
        -V.W1 / 2 + 0.8 + sl * (V.W1 - 1.6) / 8, BY + 1.10 + (V.H1 - 1.0) / 2, F1 + 0.14,
        'villa_timber_screen_' + (sl + 1));
    }
    for (var rg = 0; rg < 4; rg++) {
      box(1.5, 0.22, 1.1, 0x4f7a45, V.ox - 2.0 + rg * 1.5, TY + 0.34, V.oz - 1.2, 'roof_garden_' + (rg + 1));
    }
  }
  g.userData.npcStands = {};
  g.userData.villaStyle = V.style;
  g.userData.floors = 2;
  tmCollectFurniture(g);
  return g;
}
