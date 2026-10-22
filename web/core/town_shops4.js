/* 第三批建筑：公寓 / 旅店 / 澡堂 / 茶馆 / 甜品店 / 警亭
 * 尺寸来自 town.py；全部门朝南、雨棚在正面。
 * 家具全部复用目录里已有的 catalog id。
 */
var SHOP_SPECS3 = {
  shop_apartment_v1: {
    name: '公寓 v1', w: 9.0, d: 9.0, h: 8.6, door: 'south', doorW: 1.8,
    wall: 0xe2d4bc, trim: 0x5a4a3a, roofColor: 0x4a4a46,
    signText: '公 寓', sign: 0x2a241c, awning: 0x6a7a8a, style: 'apartment'
  },
  shop_inn_v1: {
    name: '旅店 v1', w: 11.0, d: 9.0, h: 7.4, door: 'south', doorW: 2.0,
    wall: 0xe0d1b3, trim: 0x7c3e3b, roofColor: 0x3a3f3c,
    signText: '旅 店', sign: 0x2a1a14, awning: 0x7c3e3b, style: 'inn'
  },
  shop_bathhouse_v1: {
    name: '澡堂 v1', w: 8.0, d: 6.0, h: 4.2, door: 'south', doorW: 2.2,
    wall: 0xe0cfb4, trim: 0x3e6f7a, roofColor: 0x35504f,
    signText: '汤', sign: 0x1f2a2e, awning: 0x3e6f7a, style: 'bathhouse'
  },
  shop_tea_v1: {
    name: '茶馆 v1', w: 8.0, d: 7.0, h: 3.4, door: 'south', doorW: 1.6,
    wall: 0xe6d8bc, trim: 0x5c6b46, roofColor: 0x3d4f43,
    signText: '茶', sign: 0x1f2a20, awning: 0x6a8a52, style: 'tea'
  },
  shop_dessert_v1: {
    name: '甜品店 v1', w: 7.0, d: 6.0, h: 3.3, door: 'south', doorW: 1.5,
    wall: 0xf0dac0, trim: 0xc06a8a, roofColor: 0x4a4048,
    signText: '甜 品', sign: 0x3a2030, awning: 0xd8708a, style: 'dessert'
  },
  shop_koban_v1: {
    name: '警亭 v1', w: 6.0, d: 5.0, h: 3.2, door: 'south', doorW: 1.4,
    wall: 0xddd6c6, trim: 0x3a4a6a, roofColor: 0x3a4048,
    signText: '交 番', sign: 0x1f2430, awning: 0x3a4a6a, style: 'koban'
  }
};

/* ---------------- 公寓：2 层，每层 3 户 ----------------
   用简单隔断分出房型，每户一张床 + 衣柜 + 小桌 */
function apartmentInterior(g, ctx) {
  var W = ctx.W, D = ctx.D, add = ctx.add, H = ctx.H;

  /* 一层：3 户 */
  var units1 = [-3.0, 0.0, 3.0];
  units1.forEach(function (ux, ui) {
    /* 隔墙 */
    if (ui > 0) {
      var Pw = tmPiece(g, 'shop_shelf', '户间隔墙');
      Pw.add(tmBox(g, 0.12, 2.6, D - 1.2, 0xc8bca8, ux - 1.5, 1.78, 0));
      tmPieceEnd(g, Pw);
    }
    /* 床 */
    var Pb = tmPiece(g, 'bed_single', '单人床');
    Pb.add(tmBox(g, 1.3, 0.22, 1.9, 0x6b4a32, ux - 0.7, 0.59, -1.6));
    Pb.add(tmBox(g, 1.2, 0.16, 1.8, 0xe8e0d0, ux - 0.7, 0.78, -1.6));
    Pb.add(tmBox(g, 1.2, 0.6, 0.08, 0x5a3e32, ux - 0.7, 0.80, -2.52));
    tmPieceEnd(g, Pb);
    /* 衣柜 */
    var Pc = tmPiece(g, 'wardrobe', '衣柜');
    Pc.add(tmBox(g, 0.9, 1.7, 0.5, 0x7a5a3a, ux + 0.9, 1.32, -2.2));
    tmPieceEnd(g, Pc);
    /* 小桌 */
    var Pt = tmPiece(g, 'dining_table', '小桌');
    Pt.add(tmBox(g, 0.8, 0.06, 0.6, 0x8a6a48, ux - 0.7, 1.05, 0.6));
    tmPieceEnd(g, Pt);
  });

  /* 二层：结构楼板 + 走廊 + 3 户（简化为栏杆和门） */
  var fy = 3.0;
  var Pf = tmPiece(g, 'shop_shelf', '二层楼板');
  Pf.add(tmBox(g, W - 1.0, 0.18, D - 1.0, 0xd8ccb8, 0, fy + 0.09, 0));
  Pf.add(tmBox(g, 0.15, 0.9, D - 1.4, 0x8a6a48, 0, fy + 0.62, D / 2 - 0.8));
  tmPieceEnd(g, Pf);
  units1.forEach(function (ux) {
    var Pd = tmPiece(g, 'wardrobe', '二层衣柜');
    Pd.add(tmBox(g, 0.9, 1.6, 0.5, 0x7a5a3a, ux, fy + 1.28, -2.0));
    tmPieceEnd(g, Pd);
  });

  /* 楼梯（用盒子堆出台阶） */
  var Pst = tmPiece(g, 'shop_shelf', '楼梯');
  for (var st = 0; st < 10; st++) {
    Pst.add(tmBox(g, 1.0, 0.3 * (st + 1), 0.34, 0x9a8f7a,
      W / 2 - 1.2, 0.48 + 0.15 * (st + 1), -1.6 + st * 0.34));
  }
  tmPieceEnd(g, Pst);

  /* 吊灯 */
  for (var l = 0; l < 3; l++) {
    var Pl = tmPiece(g, 'ceiling_lamp', '走廊灯');
    Pl.add(tmSphere(g, 0.16, 0xffe8c0, -3 + l * 3, 2.85, 0));
    tmPieceEnd(g, Pl);
  }
}

/* ---------------- 旅店：前台 + 客房 + 长桌椅 ---------------- */
function innInterior(g, ctx) {
  var W = ctx.W, D = ctx.D, add = ctx.add, H = ctx.H;

  /* 前台 */
  var P1 = tmPiece(g, 'checkout_counter', '旅店前台');
  P1.add(tmBox(g, 4.0, 1.0, 0.8, 0x6b4a32, -2.4, 0.96, 1.6));
  P1.add(tmBox(g, 4.2, 0.10, 0.95, 0xd8cbb0, 0, 0, 0));  /* 占位，下面重设 */
  tmPieceEnd(g, P1);

  /* 钥匙架 */
  var P2 = tmPiece(g, 'shop_shelf', '钥匙架');
  P2.add(tmBox(g, 2.6, 1.2, 0.3, 0x5a3e2a, -2.4, 1.9, 0.4));
  for (var k = 0; k < 5; k++) {
    P2.add(tmBox(g, 0.10, 0.22, 0.04, 0xd8c060, -3.4 + k * 0.5, 1.9, 0.58));
  }
  tmPieceEnd(g, P2);

  /* 大堂座椅：两个沙发 + 一张桌 */
  var Pt = tmPiece(g, 'dining_table', '大堂茶几');
  Pt.add(tmBox(g, 1.2, 0.06, 0.7, 0x7a5a3a, 2.0, 0.90, 1.4));
  tmPieceEnd(g, Pt);
  /* 沙发（用 chair_wood 代替的沙发条目） */
  var Ps1 = tmPiece(g, 'sofa_modern_2', '沙发');
  Ps1.add(tmBox(g, 1.6, 0.35, 0.7, 0x5a6e7a, 2.0, 0.66, 2.4));
  Ps1.add(tmBox(g, 1.6, 0.55, 0.15, 0x4e606b, 2.0, 1.0, 2.7));
  tmPieceEnd(g, Ps1);

  /* 走廊 + 4 间客房（门） */
  for (var r = 0; r < 4; r++) {
    var Pd = tmPiece(g, 'wardrobe', '客房门');
    Pd.add(tmBox(g, 0.9, 2.0, 0.10, 0x8a5a3a, -3.6 + r * 2.4, 1.5, -3.2));
    tmPieceEnd(g, Pd);
  }

  /* 吊灯 */
  for (var l = 0; l < 3; l++) {
    var Pl = tmPiece(g, 'ceiling_lamp', '大堂吊灯');
    Pl.add(tmSphere(g, 0.20, 0xffe0a8, -3 + l * 3, 3.1, 0));
    tmPieceEnd(g, Pl);
  }
}

/* ---------------- 澡堂：浴池 + 淋浴 + 更衣 ----------------
   没有现成浴池，用 box 拼 */
function bathhouseInterior(g, ctx) {
  var W = ctx.W, D = ctx.D, add = ctx.add;

  /* 大浴池：内嵌水池 */
  var Pp = tmPiece(g, 'bath_vanity', '浴池');
  Pp.add(tmBox(g, 4.6, 0.55, 2.6, 0x8a9aa0, -1.2, 0.72, -0.6));
  Pp.add(tmBox(g, 4.3, 0.10, 2.3, 0x4a9ab0, -1.2, 1.02, -0.6));
  tmPieceEnd(g, Pp);

  /* 淋浴隔间：3 个 */
  for (var i = 0; i < 3; i++) {
    var Ps = tmPiece(g, 'shower_tray', '淋浴');
    var sx = 2.6;
    var sz = -2.0 + i * 1.6;
    Ps.add(tmBox(g, 1.0, 0.08, 1.0, 0x9aa0a4, sx, 0.50, sz));
    Ps.add(tmBox(g, 0.03, 1.9, 1.0, 0x9fd8e8, sx - 0.5, 1.45, sz));
    Ps.add(tmCyl(g, 0.05, 0.05, 0.3, 0xbfc4c2, sx, 2.3, sz));
    tmPieceEnd(g, Ps);
  }

  /* 更衣柜 */
  var Pw = tmPiece(g, 'wardrobe', '更衣柜');
  Pw.add(tmBox(g, 3.4, 1.7, 0.5, 0x8a7a5a, -1.4, 1.32, 2.2));
  tmPieceEnd(g, Pw);

  /* 洗手台 */
  var Pv = tmPiece(g, 'bath_vanity', '洗手台');
  Pv.add(tmBox(g, 2.0, 0.8, 0.5, 0xb8a88a, 0, 0.98, 1.4));
  tmPieceEnd(g, Pv);

  /* 吊灯（暖） */
  var Pl = tmPiece(g, 'ceiling_lamp', '浴场吊灯');
  Pl.add(tmSphere(g, 0.22, 0xffd090, 0, ctx.H - 0.3, 0));
  tmPieceEnd(g, Pl);
}

/* ---------------- 茶馆：茶桌 + 坐垫 + 柜台 ---------------- */
function teaInterior(g, ctx) {
  var W = ctx.W, D = ctx.D, add = ctx.add;

  /* 柜台 */
  var P1 = tmPiece(g, 'shop_counter', '茶柜台');
  P1.add(tmBox(g, W - 2.2, 0.95, 0.7, 0x6b4a32, 0, 0.94, -D / 2 + 1.2));
  P1.add(tmBox(g, W - 2.0, 0.10, 0.85, 0xd8cbb0, 0, 1.46, -D / 2 + 1.2));
  tmPieceEnd(g, P1);

  /* 茶具架 */
  var P2 = tmPiece(g, 'shop_shelf', '茶具架');
  P2.add(tmBox(g, 0.4, 1.8, 2.4, 0x5a3e2a, -W / 2 + 1.0, 1.48, 0));
  for (var t = 0; t < 3; t++) {
    P2.add(tmBox(g, 0.5, 0.06, 2.3, 0x8a6a48, -W / 2 + 1.0, 0.85 + t * 0.5, 0));
  }
  tmPieceEnd(g, P2);

  /* 3 张茶桌 + 坐垫 */
  var spots = [[-1.6, 0.9], [1.0, 0.9], [-0.3, 2.3]];
  spots.forEach(function (s, i) {
    var Pt = tmPiece(g, 'dining_table', '茶桌');
    Pt.add(tmBox(g, 1.0, 0.06, 0.8, 0x7a5a3a, s[0], 0.80, s[1]));
    Pt.add(tmBox(g, 0.08, 0.66, 0.08, 0x4a3423, s[0], 0.45, s[1]));
    tmPieceEnd(g, Pt);
    /* 两个坐垫 */
    [-0.75, 0.75].forEach(function (dx) {
      var Pc = tmPiece(g, 'chair_wood', '坐垫');
      Pc.add(tmBox(g, 0.5, 0.10, 0.5, 0x8a5a7a, s[0] + dx, 0.60, s[1]));
      tmPieceEnd(g, Pc);
    });
  });

  /* 吊灯 */
  var Pl = tmPiece(g, 'ceiling_lamp', '纸灯');
  Pl.add(tmSphere(g, 0.18, 0xffe8c0, 0, ctx.H - 0.25, 0));
  tmPieceEnd(g, Pl);
}

/* ---------------- 甜品店：展示柜 + 桌椅 ---------------- */
function dessertInterior(g, ctx) {
  var W = ctx.W, D = ctx.D, add = ctx.add;

  /* 甜品展示柜（玻璃） */
  var P1 = tmPiece(g, 'shop_counter', '甜品展示柜');
  P1.add(tmBox(g, 3.6, 0.75, 0.7, 0xd8a0b8, 0, 0.84, -D / 2 + 1.1));
  P1.add(tmBox(g, 3.7, 0.08, 0.85, 0xe8d8e0, 0, 1.25, -D / 2 + 1.1));
  tmPieceEnd(g, P1);

  /* 收银台 */
  var P2 = tmPiece(g, 'checkout_counter', '收银台');
  P2.add(tmBox(g, 1.2, 0.95, 0.6, 0xc06a8a, W / 2 - 1.2, 0.94, D / 2 - 1.4));
  tmPieceEnd(g, P2);

  /* 2 张小圆桌 + 椅子 */
  var spots = [[-1.5, 0.8], [1.0, 0.8]];
  spots.forEach(function (s) {
    var Pt = tmPiece(g, 'dining_table', '甜品桌');
    Pt.add(tmBox(g, 0.8, 0.06, 0.8, 0xe8d0d8, s[0], 0.80, s[1]));
    Pt.add(tmCyl(g, 0.06, 0.10, 0.66, 0xb06a8a, s[0], 0.45, s[1]));
    tmPieceEnd(g, Pt);
    buildChairAt(g, add, s[0] - 0.7, s[1], Math.PI / 2, 'dining_chair_' + (s[0] > 0 ? 2 : 1), 0xc06a8a);
  });

  /* 吊灯 */
  var Pl = tmPiece(g, 'ceiling_lamp', '吊灯');
  Pl.add(tmSphere(g, 0.18, 0xffd8e0, 0, ctx.H - 0.25, 0));
  tmPieceEnd(g, Pl);
}

/* ---------------- 警亭：值勤台 + 档案柜 ---------------- */
function kobanInterior(g, ctx) {
  var W = ctx.W, D = ctx.D, add = ctx.add;

  /* 值勤台 */
  var P1 = tmPiece(g, 'checkout_counter', '值勤台');
  P1.add(tmBox(g, 3.0, 1.0, 0.7, 0x5a6a7a, 0, 0.96, -D / 2 + 1.2));
  P1.add(tmBox(g, 3.15, 0.08, 0.85, 0xd8dde0, 0, 1.48, -D / 2 + 1.2));
  tmPieceEnd(g, P1);

  /* 档案柜 */
  var P2 = tmPiece(g, 'shop_shelf', '档案柜');
  P2.add(tmBox(g, 0.5, 1.9, 1.6, 0x6a7a8a, -W / 2 + 0.8, 1.45, 0.6));
  for (var d = 0; d < 4; d++) {
    P2.add(tmBox(g, 0.06, 0.40, 1.5, 0x8a9aaa, -W / 2 + 1.08, 0.75 + d * 0.45, 0.6));
  }
  tmPieceEnd(g, P2);

  /* 等待长椅 */
  var Pb = tmPiece(g, 'prop_bench', '等待长椅');
  Pb.add(tmBox(g, 2.0, 0.10, 0.5, 0x8a6a48, 0.6, 0.62, 1.6));
  Pb.add(tmBox(g, 2.0, 0.45, 0.08, 0x8a6a48, 0.6, 0.88, 1.85));
  tmPieceEnd(g, Pb);

  /* 吊灯 */
  var Pl = tmPiece(g, 'ceiling_lamp', '吊灯');
  Pl.add(tmSphere(g, 0.16, 0xfff0d0, 0, ctx.H - 0.25, 0));
  tmPieceEnd(g, Pl);
}

var BUILDERS3 = {
  shop_apartment_v1: apartmentInterior,
  shop_inn_v1: innInterior,
  shop_bathhouse_v1: bathhouseInterior,
  shop_tea_v1: teaInterior,
  shop_dessert_v1: dessertInterior,
  shop_koban_v1: kobanInterior
};

function buildNewShop3(spec) {
  var fn = BUILDERS3[spec.shopStyle];
  if (!fn) { return null; }
  return buildShopWith(SHOP_SPECS3[spec.shopStyle], fn);
}
