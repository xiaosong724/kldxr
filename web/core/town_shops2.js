/* 四个店铺模型 v1：拉面店 / 面包店 / 杂货铺 / 花店
 * 尺寸来自 town.py 旧建筑：
 *   ramen    8 x 6   门朝西
 *   bakery  10 x 6   门朝南
 *   general  7 x 6   门朝西
 *   flower   8 x 6   门朝东
 * 统一用 buildShopShell 生成外壳，再各自加门面/内景。
 */
var SHOP_SPECS = {
  shop_ramen_v1: {
    name: '面馆 v1', w: 8.0, d: 6.0, h: 3.4, door: 'south', doorW: 1.4,
    wall: 0xb0855a, trim: 0x4a2f1d, roofColor: 0x4a352c,
    signText: '拉 面', sign: 0x2a1a10, awning: 0xc0452c,
    style: 'ramen'
  },
  shop_bakery_v1: {
    name: '面包店 v1', w: 10.0, d: 6.0, h: 3.3, door: 'south', doorW: 1.5,
    wall: 0xecdfc7, trim: 0x8a5a32, roofColor: 0x4f4a42,
    signText: '面 包', sign: 0x2f2418, awning: 0xd8a24a,
    style: 'bakery'
  },
  shop_general_v1: {
    name: '杂货铺 v1', w: 7.0, d: 6.0, h: 3.2, door: 'south', doorW: 1.4,
    wall: 0xddcfb4, trim: 0x5a4632, roofColor: 0x46443e,
    signText: '杂 货', sign: 0x2f2418, awning: 0x7a8a5a,
    style: 'general'
  },
  shop_flower_v1: {
    name: '花店 v1', w: 8.0, d: 6.0, h: 3.2, door: 'south', doorW: 1.4,
    wall: 0xe2d7be, trim: 0x5a7a4a, roofColor: 0x3d5240,
    signText: '花 店', sign: 0x22301f, awning: 0x9ac06a,
    style: 'flower'
  }
};

function box(g, w, h, d, c, x, y, z, ry) {
  return tmBox(g, w, h, d, c, x, y, z, ry);
}

/* 通用外壳：勒脚/四墙/壁柱/橱窗/门头/屋顶/屋脊 */
function shell(g, spec) {
  var W = spec.w, D = spec.d, H = spec.h;
  var wall = spec.wall, trim = spec.trim, roof = spec.roofColor;
  var parts = [];
  function add(m, name) { if (m) { tmTag(m, name); parts.push({ m: m, id: name }); } return m; }

  add(box(g, W + 0.5, 0.24, D + 0.5, 0x6f6353, 0, 0.12, 0), 'foundation');
  add(box(g, W + 0.16, 0.24, D + 0.16, 0x8a7a62, 0, 0.34, 0), 'plinth');
  add(box(g, W - 0.2, 0.04, D - 0.2, 0x9a7a52, 0, 0.48, 0), 'interior_floor');

  var wallY = 0.46, wallH = H;
  add(box(g, W, wallH, 0.18, wall, 0, wallY + wallH / 2, -D / 2 + 0.09), 'back_wall');
  add(box(g, 0.18, wallH, D, wall, -W / 2 + 0.09, wallY + wallH / 2, 0), 'side_wall_left');
  add(box(g, 0.18, wallH, D, wall, W / 2 - 0.09, wallY + wallH / 2, 0), 'side_wall_right');

  var cw = 0.26;
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (c, idx) {
    add(box(g, cw, wallH, cw, trim,
      c[0] * (W / 2 - 0.09), wallY + wallH / 2, c[1] * (D / 2 - 0.09)), 'corner_pillar_' + (idx + 1));
  });

  var dW = spec.doorW;
  var front = spec.door;

  function frontFace(sign) {
    var z = sign * (D / 2 - 0.09);
    var sideW = (W - dW) / 2;
    add(box(g, sideW, wallH, 0.18, wall, -(dW / 2 + sideW / 2), wallY + wallH / 2, z), 'front_wall_left');
    add(box(g, sideW, wallH, 0.18, wall, (dW / 2 + sideW / 2), wallY + wallH / 2, z), 'front_wall_right');
    add(box(g, dW + 0.36, 0.30, 0.26, trim, 0, wallY + 2.42, z + sign * 0.04), 'door_header');
    add(box(g, 0.12, 2.30, 0.24, trim, -dW / 2 - 0.06, wallY + 1.15, z + sign * 0.04), 'door_jamb_l');
    add(box(g, 0.12, 2.30, 0.24, trim, dW / 2 + 0.06, wallY + 1.15, z + sign * 0.04), 'door_jamb_r');
    add(box(g, dW + 0.2, 0.08, 0.5, 0x7a6a58, 0, 0.50, z + sign * 0.18), 'door_step');
    [-1, 1].forEach(function (sd, i) {
      var wx = sd * (dW / 2 + sideW / 2);
      var ww = Math.min(sideW - 0.6, 2.0);
      if (ww < 0.6) { return; }
      add(tmGlassBox(g, ww, 1.25, 0.05, wx, wallY + 1.20, z + sign * 0.10,
        'front_window_glass_' + (i + 1)), 'front_window_glass_' + (i + 1));
      add(box(g, ww + 0.16, 0.10, 0.14, trim, wx, wallY + 1.86, z + sign * 0.10), 'front_window_top_' + (i + 1));
      add(box(g, ww + 0.16, 0.10, 0.14, trim, wx, wallY + 0.54, z + sign * 0.10), 'front_window_sill_' + (i + 1));
    });
  }

  if (front === 'south') { frontFace(1); }
  else if (front === 'north') { frontFace(-1); }
  else {
    var sx = front === 'west' ? -1 : 1;
    add(box(g, 0.18, wallH, D, wall, sx * (W / 2 - 0.09), wallY + wallH / 2, 0), 'front_wall');
  }

  add(box(g, W + 0.06, 0.14, D + 0.06, trim, 0, wallY + 0.02, 0), 'belt_band');

  var roofY = wallY + H;
  add(box(g, W + 0.7, 0.22, D + 0.7, roof, 0, roofY + 0.11, 0), 'roof_slab');
  add(box(g, W + 0.95, 0.14, D + 0.95, trim, 0, roofY + 0.28, 0), 'roof_eave');
  add(box(g, W + 0.5, 0.16, 0.20, trim, 0, roofY + 0.40, -D / 2 + 0.1), 'roof_ridge_back');
  add(box(g, W + 0.5, 0.16, 0.20, trim, 0, roofY + 0.40, D / 2 - 0.1), 'roof_ridge_front');
  add(box(g, 0.5, 0.45, 0.5, 0x9aa0a4, W * 0.28, roofY + 0.48, -D * 0.15), 'roof_vent');
  add(tmCyl(g, 0.22, 0.22, 0.7, 0xb8c0c4, -W * 0.30, roofY + 0.60, -D * 0.20), 'roof_tank');

  return { W: W, D: D, H: H, wallY: wallY, parts: parts, add: add, wall: wall, trim: trim, roof: roof };
}

/* 招牌（门面上方） */
function signboard(g, spec, ctx, text) {
  var W = ctx.W, D = ctx.D, H = ctx.H;
  var y = 0.22 + H - 0.45;
  if (spec.door === 'south') {
    ctx.add(box(g, Math.min(W * 0.55, 4.2), 0.7, 0.12, spec.sign, 0, y, D / 2 + 0.10), 'sign_board');
  } else if (spec.door === 'west') {
    ctx.add(box(g, 0.12, 0.7, Math.min(D * 0.55, 3.0), spec.sign, -W / 2 - 0.10, y, 0), 'sign_board');
  } else {
    ctx.add(box(g, 0.12, 0.7, Math.min(D * 0.55, 3.0), spec.sign, W / 2 + 0.10, y, 0), 'sign_board');
  }
}

/* 雨棚 */
function awning(g, spec, ctx) {
  var W = ctx.W, D = ctx.D, H = ctx.H;
  if (!spec.awning) { return; }
  if (spec.door === 'south') {
    ctx.add(box(g, 3.6, 0.12, 1.3, spec.awning, 0, 0.22 + 2.5, D / 2 + 0.55), 'awning');
    ctx.add(box(g, 0.1, 2.4, 0.1, ctx.trim, -1.6, 1.2, D / 2 + 1.15), 'awning_post_l');
    ctx.add(box(g, 0.1, 2.4, 0.1, ctx.trim, 1.6, 1.2, D / 2 + 1.15), 'awning_post_r');
  } else {
    var sx = spec.door === 'west' ? -1 : 1;
    ctx.add(box(g, 1.3, 0.12, 3.4, spec.awning, sx * (W / 2 + 0.55), 0.22 + 2.5, 0), 'awning');
    ctx.add(box(g, 0.1, 2.4, 0.1, ctx.trim, sx * (W / 2 + 1.15), 1.2, -1.5), 'awning_post_l');
    ctx.add(box(g, 0.1, 2.4, 0.1, ctx.trim, sx * (W / 2 + 1.15), 1.2, 1.5), 'awning_post_r');
  }
}

/* ---------------- 拉面店 ---------------- */
function ramenInterior(g, ctx) {
  var W = ctx.W, D = ctx.D;
  /* 吧台沿东侧墙 */
  var P1 = tmPiece(g, 'shop_counter', '吧台');
  P1.add(box(g, 0.8, 0.95, D - 2.0, 0x6b4a32, W / 2 - 1.7, 0.70, 0));
  P1.add(box(g, 0.95, 0.10, D - 1.9, 0x8a6a48, W / 2 - 1.7, 1.22, 0));
  tmPieceEnd(g, P1);
  /* 吧台凳 */
  for (var i = 0; i < 3; i++) {
    var P = tmPiece(g, 'chair_wood', '吧台凳');
    P.add(tmBox(g, 0.36, 0.06, 0.36, 0x8a5a3a, W / 2 - 2.45, 0.72, -1.2 + i * 1.2));
    P.add(tmBox(g, 0.08, 0.66, 0.08, 0x4a3423, W / 2 - 2.45, 0.36, -1.2 + i * 1.2));
    tmPieceEnd(g, P);
  }
  /* 灶台/锅 */
  var Pk = tmPiece(g, 'kitchen_stove', '煮面灶');
  Pk.add(box(g, 0.6, 0.7, 1.6, 0x3a3a3a, W / 2 - 1.15, 0.55, -1.2));
  tmPieceEnd(g, Pk);
  /* 菜单板 */
  var Pm = tmPiece(g, 'wall_menu', '菜单板');
  Pm.add(box(g, 0.06, 1.0, 1.5, 0x2a1a10, -W / 2 + 0.14, 1.9, 0));
  tmPieceEnd(g, Pm);
  /* 拉面碗 */
  var Pb = tmPiece(g, 'kitchen_sink', '汤锅');
  Pb.add(tmCyl(g, 0.28, 0.24, 0.26, 0x8a8f8e, W / 2 - 1.25, 1.03, 0.8));
  tmPieceEnd(g, Pb);
  /* 室外灯笼 */
  for (var L = 0; L < 2; L++) {
    var Pl = tmPiece(g, 'ceiling_lamp', '红灯笼');
    Pl.add(tmSphere(g, 0.22, 0xc0452c, -W / 2 - 0.5, 2.55, L ? 1.35 : -1.35));
    tmPieceEnd(g, Pl);
  }
}

/* ---------------- 面包店 ---------------- */
function bakeryInterior(g, ctx) {
  var W = ctx.W, D = ctx.D, add = ctx.add;
  /* 面包展示柜 */
  var P1 = tmPiece(g, 'shop_counter', '展示柜');
  P1.add(box(g, W - 2.0, 0.9, 0.7, 0xb08050, 0, 0.68, -D / 2 + 1.0));
  P1.add(box(g, W - 1.9, 0.08, 0.8, 0xe8dcc8, 0, 1.16, -D / 2 + 1.0));
  tmPieceEnd(g, P1);
  /* 面包托盘 */
  var P2 = tmPiece(g, 'shop_counter', '面包托盘');
  for (var i = 0; i < 4; i++) {
    P2.add(box(g, 0.5, 0.12, 0.34, 0xd8a24a, -2.4 + i * 1.6, 1.26, -D / 2 + 1.0));
  }
  tmPieceEnd(g, P2);
  /* 收银台 */
  var P3 = tmPiece(g, 'checkout_counter', '收银台');
  P3.add(box(g, 1.2, 0.95, 0.6, 0x8a5a32, W / 2 - 1.2, 0.70, D / 2 - 1.2));
  tmPieceEnd(g, P3);
  /* 餐桌椅 */
  var Pt = tmPiece(g, 'dining_table', '餐桌');
  Pt.add(box(g, 1.2, 0.08, 0.8, 0x8a5a32, -1.6, 0.74, 1.3));
  tmPieceEnd(g, Pt);
  buildChairAt(g, add, -1.6, 2.1, Math.PI, 'dining_chair_1', 0x8a5a3a);
  buildChairAt(g, add, -1.6, 0.6, 0, 'dining_chair_2', 0x8a5a3a);
  /* 吊灯 */
  var Pl = tmPiece(g, 'ceiling_lamp', '吊灯');
  Pl.add(tmSphere(g, 0.2, 0xffd9a0, 0, 2.9, 0));
  tmPieceEnd(g, Pl);
}

/* ---------------- 杂货铺 ---------------- */
function generalInterior(g, ctx) {
  var W = ctx.W, D = ctx.D;
  /* 两侧货架 */
  for (var s = 0; s < 2; s++) {
    var sx = s ? 1 : -1;
    var P = tmPiece(g, 'shop_shelf', '杂货货架');
    P.add(box(g, 0.5, 1.8, D - 1.6, 0x6b4a32, sx * (W / 2 - 0.6), 1.12, 0));
    for (var t = 0; t < 3; t++) {
      P.add(box(g, 0.6, 0.06, D - 1.7, 0x9a7650, sx * (W / 2 - 0.6), 0.5 + t * 0.5, 0));
    }
    tmPieceEnd(g, P);
  }
  /* 柜台 */
  var Pc = tmPiece(g, 'checkout_counter', '柜台');
  Pc.add(box(g, 1.4, 0.95, 0.6, 0x6b4a32, 0, 0.70, D / 2 - 1.3));
  Pc.add(box(g, 1.5, 0.09, 0.7, 0xd8cbb0, 0, 1.22, D / 2 - 1.3));
  tmPieceEnd(g, Pc);
  /* 纸箱 */
  for (var c = 0; c < 3; c++) {
    var Pk = tmPiece(g, 'basket_stack', '货箱');
    Pk.add(box(g, 0.5, 0.4, 0.5, 0xb08a5a, -0.8 + c * 0.7, 0.42, D / 2 - 0.9));
    tmPieceEnd(g, Pk);
  }
  /* 吊灯 */
  var Pl = tmPiece(g, 'ceiling_lamp', '吊灯');
  Pl.add(tmSphere(g, 0.18, 0xffd9a0, 0, 2.85, 0));
  tmPieceEnd(g, Pl);
}

/* ---------------- 花店 ---------------- */
function flowerInterior(g, ctx) {
  var W = ctx.W, D = ctx.D, add = ctx.add;

  /* ---- 左侧多层花架（两层，每层 5 个花盆）---- */
  var shelfX = -W / 2 + 0.85;
  var P1 = tmPiece(g, 'shop_shelf', '花架');
  P1.add(box(g, 0.55, 1.55, D - 1.2, 0x7a5a3a, shelfX, 0.98, 0));
  tmPieceEnd(g, P1);

  var COLORS = [0xd8708a, 0xe8c060, 0xc84a3a, 0xb08ad8, 0xf2e8d0, 0x9fc4e8];
  for (var layer = 0; layer < 2; layer++) {
    var py = 0.62 + layer * 0.55;
    for (var i = 0; i < 5; i++) {
      var pz = -2.0 + i * 1.0;
      var Pp = tmPiece(g, 'plant_pot', '花盆');
      /* 陶盆 */
      Pp.add(tmCyl(g, 0.15, 0.11, 0.22, 0x9a5f42, shelfX, py + 0.11, pz));
      /* 花茎 */
      Pp.add(tmCyl(g, 0.02, 0.02, 0.26, 0x4a7a3a, shelfX, py + 0.34, pz));
      /* 花头：三瓣 */
      for (var petal = 0; petal < 3; petal++) {
        var ang = petal / 3 * Math.PI * 2;
        Pp.add(tmSphere(g, 0.09, COLORS[(i + layer) % COLORS.length],
          shelfX + Math.cos(ang) * 0.09, py + 0.48, pz + Math.sin(ang) * 0.09));
      }
      Pp.add(tmSphere(g, 0.05, 0xffd966, shelfX, py + 0.50, pz));
      tmPieceEnd(g, Pp);
    }
  }

  /* ---- 中间花台：矮台 + 6 盆花 ---- */
  var P2 = tmPiece(g, 'dining_table', '花台');
  P2.add(box(g, 2.2, 0.72, 1.1, 0x8a7a5a, 0.4, 0.58, 0));
  tmPieceEnd(g, P2);
  for (var t = 0; t < 3; t++) {
    for (var u = 0; u < 2; u++) {
      var Pc = tmPiece(g, 'plant_pot', '台面花盆');
      var cx = -0.4 + t * 0.8, cz = -0.3 + u * 0.6;
      Pc.add(tmCyl(g, 0.13, 0.10, 0.20, 0xc8a882, cx, 1.04, cz));
      Pc.add(tmCyl(g, 0.02, 0.02, 0.22, 0x4a7a3a, cx, 1.24, cz));
      Pc.add(tmSphere(g, 0.11, COLORS[(t + u) % COLORS.length], cx, 1.40, cz));
      Pc.add(tmSphere(g, 0.04, 0xffd966, cx, 1.41, cz + 0.06));
      tmPieceEnd(g, Pc);
    }
  }

  /* ---- 右侧花桶（立在地上的高桶 + 大束花）---- */
  for (var b = 0; b < 3; b++) {
    var Pbu = tmPiece(g, 'plant_pot', '花桶');
    var bx = W / 2 - 1.0, bz = -1.6 + b * 1.6;
    Pbu.add(tmCyl(g, 0.24, 0.20, 0.55, 0x8a8f8e, bx, 0.50, bz));
    for (var st = 0; st < 5; st++) {
      var sa = st / 5 * Math.PI * 2;
      Pbu.add(tmCyl(g, 0.015, 0.015, 0.55, 0x4a7a3a,
        bx + Math.cos(sa) * 0.08, 1.02, bz + Math.sin(sa) * 0.08));
      Pbu.add(tmSphere(g, 0.075, COLORS[(b + st) % COLORS.length],
        bx + Math.cos(sa) * 0.14, 1.30, bz + Math.sin(sa) * 0.14));
    }
    tmPieceEnd(g, Pbu);
  }

  /* ---- 吊挂花篮（挂天花板）---- */
  for (var h = 0; h < 2; h++) {
    var Ph = tmPiece(g, 'ceiling_lamp', '吊花篮');
    var hx = -1.2 + h * 2.4;
    Ph.add(tmCyl(g, 0.02, 0.02, 0.55, 0x6b4a32, hx, 2.62, 0));
    Ph.add(tmSphere(g, 0.22, 0xb08a5a, hx, 2.28, 0));
    for (var f2 = 0; f2 < 6; f2++) {
      var fa = f2 / 6 * Math.PI * 2;
      Ph.add(tmSphere(g, 0.075, COLORS[(h + f2) % COLORS.length],
        hx + Math.cos(fa) * 0.20, 2.30, Math.sin(fa) * 0.20));
    }
    tmPieceEnd(g, Ph);
  }

  /* ---- 门前小盆栽 ---- */
  for (var d2 = 0; d2 < 2; d2++) {
    var Pd = tmPiece(g, 'plant_pot', '门边盆栽');
    var dx = -1.4 + d2 * 2.8;
    Pd.add(tmCyl(g, 0.20, 0.16, 0.30, 0x9a5f42, dx, 0.37, D / 2 - 0.7));
    Pd.add(tmSphere(g, 0.24, 0x5c8a52, dx, 0.72, D / 2 - 0.7));
    Pd.add(tmSphere(g, 0.09, 0xd8708a, dx, 0.88, D / 2 - 0.7));
    tmPieceEnd(g, Pd);
  }

  /* ---- 主灯 ---- */
  var Pl = tmPiece(g, 'ceiling_lamp', '吊灯');
  Pl.add(tmSphere(g, 0.18, 0xffd9a0, 0, 2.85, 0));
  tmPieceEnd(g, Pl);
}

function buildShopWith(spec, interiorFn) {
  var g = new THREE.Group();
  g.userData.parts = [];
  var ctx = shell(g, spec);
  /* 内景先建在临时组里，再整体抬到勒脚高度 */
  var inner = new THREE.Group();
  inner.userData.parts = [];
  inner.position.y = ctx.wallY || 0;
  /* 必须先挂到 g 上：tmRoot 要沿父链找到模型根，才能把家具登记进去 */
  g.add(inner);
  var ictx = {};
  for (var k in ctx) { ictx[k] = ctx[k]; }
  ictx.add = function (m, name) {
    if (m) { tmTag(m, name); inner.userData.parts.push({ id: name, cn: townPartCn(name) }); }
    return m;
  };
  interiorFn(inner, ictx);
  signboard(g, spec, ctx, spec.signText);
  awning(g, spec, ctx);
  tmCollectFurniture(g);
  return g;
}

/* 注册到 TOWN_MODELS */
function buildShop(spec, interiorFn) { return buildShopWith(spec, interiorFn); }

var BUILDERS = {
  shop_ramen_v1: function (spec) { return buildShop(SHOP_SPECS.shop_ramen_v1, ramenInterior); },
  shop_bakery_v1: function (spec) { return buildShop(SHOP_SPECS.shop_bakery_v1, bakeryInterior); },
  shop_general_v1: function (spec) { return buildShop(SHOP_SPECS.shop_general_v1, generalInterior); },
  shop_flower_v1: function (spec) { return buildShop(SHOP_SPECS.shop_flower_v1, flowerInterior); }
};

function buildNewShop(spec) {
  var fn = BUILDERS[spec.shopStyle];
  if (!fn) { return null; }
  return fn(spec);
}


