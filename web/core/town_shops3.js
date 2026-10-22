/* 第二批建筑模型：仓库 / 铁匠铺 / 药铺 / 邮局 / 书店 / 居酒屋
 * 尺寸来自 town.py：
 *   warehouse 13x11   smith   7x7    clinic  8x7
 *   post       7x7    bookstore 10x7 izakaya  8x7
 * 全部门朝南、雨棚在正面。
 */
var SHOP_SPECS2 = {
  shop_warehouse_v1: {
    name: '仓库 v1', w: 13.0, d: 11.0, h: 4.2, door: 'south', doorW: 3.0,
    wall: 0xe2d3b6, trim: 0x6f6353, roofColor: 0x3f5850,
    signText: '仓 库', sign: 0x2a241c, awning: 0x8a7a62, style: 'warehouse'
  },
  shop_smith_v1: {
    name: '铁匠铺 v1', w: 7.0, d: 7.0, h: 3.6, door: 'south', doorW: 1.8,
    wall: 0xb59c80, trim: 0x4a352c, roofColor: 0x4a352c,
    signText: '铁 匠 铺', sign: 0x2a1a10, awning: 0xb4542f, style: 'smith'
  },
  shop_clinic_v1: {
    name: '药铺 v1', w: 8.0, d: 7.0, h: 3.4, door: 'south', doorW: 1.6,
    wall: 0xe6d8be, trim: 0x5c6b46, roofColor: 0x3f5148,
    signText: '药 铺', sign: 0x22301f, awning: 0x6a8a52, style: 'clinic'
  },
  shop_post_v1: {
    name: '邮局 v1', w: 7.0, d: 7.0, h: 3.5, door: 'south', doorW: 1.6,
    wall: 0xd6b696, trim: 0x8d3f36, roofColor: 0x4a4438,
    signText: '邮 局', sign: 0x3a1f1c, awning: 0x8d3f36, style: 'post'
  },
  shop_bookstore_v1: {
    name: '书店 v1', w: 10.0, d: 7.0, h: 3.4, door: 'south', doorW: 1.8,
    wall: 0xddcfb4, trim: 0x3e5968, roofColor: 0x3f5450,
    signText: '书 店', sign: 0x22282e, awning: 0x4a6a7a, style: 'bookstore'
  },
  shop_izakaya_v1: {
    name: '居酒屋 v1', w: 8.0, d: 7.0, h: 3.5, door: 'south', doorW: 1.6,
    wall: 0xb98a60, trim: 0x4a2f1d, roofColor: 0x3a2a20,
    signText: '居 酒 屋', sign: 0x2a1810, awning: 0xb03a2a, style: 'izakaya'
  }
};

/* ---------------- 仓库 ---------------- */
function warehouseInterior(g, ctx) {
  var W = ctx.W, D = ctx.D, add = ctx.add;
  /* 货架区：三排高货架 */
  for (var r = 0; r < 3; r++) {
    var P = tmPiece(g, 'aisle_shelf', '仓库货架');
    var rx = -W / 2 + 2.4 + r * 3.6;
    P.add(tmBox(g, 1.0, 2.6, D - 2.6, 0x6f5a42, rx, 1.30, 0));
    for (var t = 0; t < 4; t++) {
      P.add(tmBox(g, 1.1, 0.08, D - 2.7, 0x8a7050, rx, 0.5 + t * 0.6, 0));
    }
    tmPieceEnd(g, P);
  }
  /* 木箱堆 */
  for (var c = 0; c < 4; c++) {
    var Pk = tmPiece(g, 'basket_stack', '木箱');
    Pk.add(tmBox(g, 0.7, 0.55, 0.7, 0x9a7a4a, -W / 2 + 1.2, 0.30 + (c % 2) * 0.58, D / 2 - 1.6 - c * 0.8));
    tmPieceEnd(g, Pk);
  }
  /* 地台 + 叉车托盘 */
  var Pp = tmPiece(g, 'dining_table', '装卸台');
  Pp.add(tmBox(g, 2.4, 0.15, 1.6, 0x8a7050, W / 2 - 2.4, 0.26, D / 2 - 1.8));
  tmPieceEnd(g, Pp);
  /* 吊灯 */
  for (var l = 0; l < 3; l++) {
    var Pl = tmPiece(g, 'ceiling_lamp', '工矿灯');
    Pl.add(tmSphere(g, 0.22, 0xfff0c0, -3.6 + l * 3.6, ctx.H - 0.2, 0));
    tmPieceEnd(g, Pl);
  }
}

/* ---------------- 铁匠铺 ---------------- */
function smithInterior(g, ctx) {
  var W = ctx.W, D = ctx.D, add = ctx.add;
  /* 铁砧 */
  var Pa = tmPiece(g, 'dining_table', '铁砧台');
  Pa.add(tmBox(g, 1.2, 0.7, 0.6, 0x4a4a4a, -1.2, 0.83, 0.4));
  Pa.add(tmBox(g, 0.9, 0.35, 0.45, 0x8a8f8e, -1.2, 1.35, 0.4));
  tmPieceEnd(g, Pa);
  /* 熔炉 */
  var Pf = tmPiece(g, 'kitchen_stove', '熔炉');
  Pf.add(tmBox(g, 1.4, 1.8, 1.2, 0x6a5a4a, W / 2 - 1.2, 1.36, -D / 2 + 1.4));
  Pf.add(tmBox(g, 0.9, 0.5, 0.15, 0xc0452c, W / 2 - 1.2, 1.10, -D / 2 + 2.0));
  tmPieceEnd(g, Pf);
  /* 水桶（淬火） */
  var Pw = tmPiece(g, 'basket_stack', '淬火桶');
  Pw.add(tmCyl(g, 0.32, 0.28, 0.55, 0x6a5a4a, -1.9, 0.74, 1.9));
  Pw.add(tmCyl(g, 0.28, 0.28, 0.04, 0x4a8aa0, -1.9, 1.02, 1.9));
  tmPieceEnd(g, Pw);
  /* 工具架 */
  var Pt = tmPiece(g, 'shop_shelf', '工具架');
  Pt.add(tmBox(g, 2.2, 0.10, 0.4, 0x5a4632, -W / 2 + 0.6, 1.9, 0, Math.PI / 2));
  tmPieceEnd(g, Pt);
  /* 吊灯 */
  var Pl = tmPiece(g, 'ceiling_lamp', '吊灯');
  Pl.add(tmSphere(g, 0.2, 0xffb060, 0, ctx.H - 0.25, 0));
  tmPieceEnd(g, Pl);
}

/* ---------------- 药铺 ---------------- */
function clinicInterior(g, ctx) {
  var W = ctx.W, D = ctx.D, add = ctx.add;
  /* 药柜：整面墙的小抽屉 */
  var P1 = tmPiece(g, 'shop_shelf', '药柜');
  P1.add(tmBox(g, W - 1.4, 2.2, 0.5, 0x7a5a3a, 0, 1.56, -D / 2 + 0.45));
  for (var r = 0; r < 4; r++) {
    for (var c = 0; c < 6; c++) {
      P1.add(tmBox(g, 0.7, 0.4, 0.06, 0x9a7a52,
        -W / 2 + 1.4 + c * 0.9, 0.85 + r * 0.5, -D / 2 + 0.72));
    }
  }
  tmPieceEnd(g, P1);
  /* 柜台 */
  var P2 = tmPiece(g, 'shop_counter', '抓药柜台');
  P2.add(tmBox(g, 3.0, 0.95, 0.7, 0x6b4a32, 0, 0.94, D / 2 - 2.0));
  P2.add(tmBox(g, 3.15, 0.10, 0.85, 0xd8cbb0, 0, 1.46, D / 2 - 2.0));
  tmPieceEnd(g, P2);
  /* 药罐 */
  for (var j = 0; j < 3; j++) {
    var Pj = tmPiece(g, 'plant_pot', '药罐');
    Pj.add(tmCyl(g, 0.16, 0.13, 0.26, 0x8a6a4a, -0.9 + j * 0.9, 1.66, D / 2 - 2.0));
    tmPieceEnd(g, Pj);
  }
  /* 候诊椅 */
  buildChairAt(g, add, -2.2, D / 2 - 3.4, Math.PI, 'dining_chair_1', 0x8a5a3a);
  buildChairAt(g, add, -2.2, D / 2 - 2.4, Math.PI, 'dining_chair_2', 0x8a5a3a);
  /* 吊灯 */
  var Pl = tmPiece(g, 'ceiling_lamp', '吊灯');
  Pl.add(tmSphere(g, 0.18, 0xffe0a0, 0, ctx.H - 0.25, 0));
  tmPieceEnd(g, Pl);
}

/* ---------------- 邮局 ---------------- */
function postInterior(g, ctx) {
  var W = ctx.W, D = ctx.D, add = ctx.add;
  /* 柜台 + 隔断 */
  var P1 = tmPiece(g, 'checkout_counter', '邮局柜台');
  P1.add(tmBox(g, W - 1.6, 1.05, 0.7, 0x8a5a3a, 0, 0.99, D / 2 - 2.2));
  P1.add(tmBox(g, W - 1.45, 0.10, 0.85, 0xd8cbb0, 0, 1.55, D / 2 - 2.2));
  tmPieceEnd(g, P1);
  /* 信箱格 */
  var P2 = tmPiece(g, 'shop_shelf', '信箱格');
  P2.add(tmBox(g, W - 1.4, 1.8, 0.45, 0x8d3f36, 0, 1.36, -D / 2 + 0.42));
  for (var r = 0; r < 3; r++) {
    for (var c = 0; c < 5; c++) {
      P2.add(tmBox(g, 0.6, 0.35, 0.06, 0xb05a4a,
        -W / 2 + 1.3 + c * 0.9, 0.75 + r * 0.45, -D / 2 + 0.66));
    }
  }
  tmPieceEnd(g, P2);
  /* 邮包堆 */
  for (var b = 0; b < 3; b++) {
    var Pb = tmPiece(g, 'basket_stack', '邮包');
    Pb.add(tmBox(g, 0.5, 0.35, 0.4, 0xb8a070, -W / 2 + 1.2 + b * 0.6, 0.66, D / 2 - 1.4));
    tmPieceEnd(g, Pb);
  }
  /* 吊灯 */
  var Pl = tmPiece(g, 'ceiling_lamp', '吊灯');
  Pl.add(tmSphere(g, 0.18, 0xffe0a0, 0, ctx.H - 0.25, 0));
  tmPieceEnd(g, Pl);
}

/* ---------------- 书店 ---------------- */
function bookstoreInterior(g, ctx) {
  var W = ctx.W, D = ctx.D, add = ctx.add;
  /* 两侧书架 */
  for (var s = 0; s < 2; s++) {
    var sx = s ? 1 : -1;
    var P = tmPiece(g, 'shop_shelf', '书架');
    P.add(tmBox(g, 0.6, 2.3, D - 2.0, 0x6b4a32, sx * (W / 2 - 0.7), 1.60, 0));
    for (var t = 0; t < 4; t++) {
      P.add(tmBox(g, 0.7, 0.07, D - 2.1, 0x8a6a48, sx * (W / 2 - 0.7), 0.75 + t * 0.5, 0));
      /* 书脊 */
      for (var bk = 0; bk < 5; bk++) {
        P.add(tmBox(g, 0.42, 0.32, 0.10,
          [0xc84a3a, 0x3e6a8a, 0x5c8a52, 0xe8c060, 0x8a5a9a][bk],
          sx * (W / 2 - 0.7), 0.94 + t * 0.5, -2.4 + bk * 1.2));
      }
    }
    tmPieceEnd(g, P);
  }
  /* 阅读桌 */
  var Pt = tmPiece(g, 'dining_table', '阅读桌');
  Pt.add(tmBox(g, 2.4, 0.08, 1.2, 0x7a5a3a, 0, 0.94, D / 2 - 2.2));
  tmPieceEnd(g, Pt);
  buildChairAt(g, add, 0, D / 2 - 3.2, 0, 'dining_chair_1', 0x8a5a3a);
  buildChairAt(g, add, 0, D / 2 - 1.2, Math.PI, 'dining_chair_2', 0x8a5a3a);
  /* 吊灯 */
  for (var l = 0; l < 2; l++) {
    var Pl = tmPiece(g, 'ceiling_lamp', '吊灯');
    Pl.add(tmSphere(g, 0.18, 0xffe8b8, -1.8 + l * 3.6, ctx.H - 0.25, 0));
    tmPieceEnd(g, Pl);
  }
}

/* ---------------- 居酒屋 ---------------- */
function izakayaInterior(g, ctx) {
  var W = ctx.W, D = ctx.D, add = ctx.add;
  /* L 形吧台 */
  var P1 = tmPiece(g, 'shop_counter', '吧台');
  P1.add(tmBox(g, 3.4, 0.95, 0.7, 0x5a3a24, W / 2 - 2.2, 0.94, -D / 2 + 1.2));
  P1.add(tmBox(g, 0.7, 0.95, 3.0, 0x5a3a24, W / 2 - 1.0, 0.94, -D / 2 + 3.0));
  P1.add(tmBox(g, 3.55, 0.10, 0.85, 0x8a6a48, W / 2 - 2.2, 1.46, -D / 2 + 1.2));
  tmPieceEnd(g, P1);
  /* 吧台凳 */
  for (var i = 0; i < 3; i++) {
    var P = tmPiece(g, 'chair_wood', '吧台凳');
    P.add(tmBox(g, 0.36, 0.06, 0.36, 0x6b4a32, W / 2 - 3.0, 0.98, -D / 2 + 1.2 + i * 1.2));
    P.add(tmBox(g, 0.08, 0.9, 0.08, 0x3a2a20, W / 2 - 3.0, 0.50, -D / 2 + 1.2 + i * 1.2));
    tmPieceEnd(g, P);
  }
  /* 酒架 */
  var P2 = tmPiece(g, 'shop_shelf', '酒架');
  P2.add(tmBox(g, 2.6, 1.2, 0.4, 0x4a2f1d, -W / 2 + 1.6, 2.0, -D / 2 + 0.4));
  for (var b = 0; b < 6; b++) {
    P2.add(tmCyl(g, 0.07, 0.07, 0.30, [0xd8cbb0, 0x8a9a5a, 0xb05a4a][b % 3],
      -W / 2 + 0.7 + b * 0.36, 2.0, -D / 2 + 0.62));
  }
  tmPieceEnd(g, P2);
  /* 小桌 */
  var P3 = tmPiece(g, 'dining_table', '小桌');
  P3.add(tmBox(g, 1.0, 0.06, 0.8, 0x5a3a24, -W / 2 + 2.0, 0.72, D / 2 - 2.0));
  tmPieceEnd(g, P3);
  buildChairAt(g, add, -W / 2 + 2.0, D / 2 - 2.9, 0, 'dining_chair_1', 0x6b4a32);
  /* 红灯笼 */
  for (var L = 0; L < 3; L++) {
    var Pl = tmPiece(g, 'ceiling_lamp', '红灯笼');
    Pl.add(tmSphere(g, 0.20, 0xc0452c, -2.0 + L * 2.0, ctx.H - 0.35, D / 2 - 1.2));
    tmPieceEnd(g, Pl);
  }
}

var BUILDERS2 = {
  shop_warehouse_v1: warehouseInterior,
  shop_smith_v1: smithInterior,
  shop_clinic_v1: clinicInterior,
  shop_post_v1: postInterior,
  shop_bookstore_v1: bookstoreInterior,
  shop_izakaya_v1: izakayaInterior
};

function buildNewShop2(spec) {
  var fn = BUILDERS2[spec.shopStyle];
  if (!fn) { return null; }
  return buildShopWith(SHOP_SPECS2[spec.shopStyle], fn);
}
