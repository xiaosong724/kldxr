/* 户外物件模型库 v1
 * 每种物件一个独立模型，可在预览页单独查看/调整。
 * 使用 town_models.js 的 tmBox / tmCyl / tmSphere / tmCone / tmGlassBox。
 */
var PROP_SPECS = {};

function propSpec(id, name, w, d, h, desc) {
  PROP_SPECS[id] = { name: name, type: 'prop', w: w, d: d, h: h, floors: 0,
    roof: 'none', wall: 0x8a6a48, trim: 0x4a3423, roofColor: 0x4a3423,
    door: 'none', windows: 0, propId: id, desc: desc };
}

/* ---------- 树 ---------- */
function propTree(g, add, variant, size) {
  var s = size || 1.0;
  var P = tmPiece(g, 'prop_tree', '树');

  /* 三种树按可破坏的树的思路：方块叠层 */
  var trunkH, layers;
  if (variant === 'pine') {
    /* 松树：细高杆 + 3 层窄锥形树冠（用递减方块模拟） */
    trunkH = 3.0 * s;
    layers = [[2.0, 1.0], [1.5, 0.9], [0.9, 0.8]];
  } else if (variant === 'sakura') {
    /* 樱花：中等树干 + 4 层蓬松树冠 */
    trunkH = 2.4 * s;
    layers = [[2.9, 1.5], [2.4, 1.3], [1.8, 1.1], [1.1, 0.8]];
  } else {
    /* 绿树：标准 */
    trunkH = 2.6 * s;
    layers = [[2.9, 1.5], [2.3, 1.2], [1.5, 0.9]];
  }

  var leafC = variant === 'sakura' ? 0xe8a8c0 : (variant === 'pine' ? 0x3f6a45 : 0x5c8a52);
  var leafC2 = variant === 'sakura' ? 0xf0bcd0 : (variant === 'pine' ? 0x4a7a50 : 0x6a9a60);

  /* 树干 */
  P.add(add(tmBox(g, 0.55 * s, trunkH, 0.55 * s, 0x6b4a32, 0, trunkH / 2, 0), 'trunk'));

  /* 树冠：逐层变小，交替两种绿，每层再压一个略小的盖出层次 */
  var y = trunkH * 0.72;
  for (var i = 0; i < layers.length; i++) {
    var w = layers[i][0] * s;
    var h = layers[i][1] * s;
    P.add(add(tmBox(g, w, h, w, i % 2 ? leafC2 : leafC, 0, y + h / 2, 0), 'crown_' + (i + 1)));
    /* 顶部一层略小、错开颜色，出"叶簇"的感觉 */
    if (i === layers.length - 1) {
      P.add(add(tmBox(g, w * 0.62, h * 0.7, w * 0.62, leafC2, 0, y + h + 0.02, 0), 'crown_top'));
    }
    y += h * 0.72;
  }

  tmPieceEnd(g, P);
}

/* ---------- 路灯 ---------- */
function propLamp(g, add) {
  var P = tmPiece(g, 'prop_lamp', '路灯');
  /* 底座 */
  P.add(add(tmCyl(g, 0.16, 0.20, 0.18, 0x2f3438, 0, 0.09, 0), 'base'));
  P.add(add(tmCyl(g, 0.11, 0.14, 0.22, 0x3a3f42, 0, 0.28, 0), 'base_upper'));
  /* 灯杆 */
  P.add(add(tmCyl(g, 0.045, 0.055, 2.75, 0x3a3f42, 0, 1.72, 0), 'pole'));
  /* 灯臂（向外伸出一点） */
  P.add(add(tmBox(g, 0.36, 0.06, 0.06, 0x3a3f42, 0.16, 3.05, 0), 'arm'));
  /* 方灯罩：四片玻璃 + 金属框 */
  var lx = 0.34, ly = 3.02;
  P.add(add(tmBox(g, 0.30, 0.05, 0.30, 0x2f3438, lx, ly + 0.20, 0), 'lamp_top'));
  P.add(add(tmBox(g, 0.30, 0.05, 0.30, 0x2f3438, lx, ly - 0.20, 0), 'lamp_bottom'));
  P.add(add(tmBox(g, 0.05, 0.34, 0.05, 0x2f3438, lx - 0.13, ly, -0.13), 'post_a'));
  P.add(add(tmBox(g, 0.05, 0.34, 0.05, 0x2f3438, lx + 0.13, ly, -0.13), 'post_b'));
  P.add(add(tmBox(g, 0.05, 0.34, 0.05, 0x2f3438, lx - 0.13, ly, 0.13), 'post_c'));
  P.add(add(tmBox(g, 0.05, 0.34, 0.05, 0x2f3438, lx + 0.13, ly, 0.13), 'post_d'));
  P.add(add(tmGlassBox(g, 0.24, 0.32, 0.02, lx, ly, -0.13, 'lamp_glass_f'), 'lamp_glass_f'));
  P.add(add(tmGlassBox(g, 0.24, 0.32, 0.02, lx, ly, 0.13, 'lamp_glass_b'), 'lamp_glass_b'));
  P.add(add(tmGlassBox(g, 0.02, 0.32, 0.24, lx - 0.13, ly, 0, 'lamp_glass_l'), 'lamp_glass_l'));
  P.add(add(tmGlassBox(g, 0.02, 0.32, 0.24, lx + 0.13, ly, 0, 'lamp_glass_r'), 'lamp_glass_r'));
  /* 灯芯 */
  P.add(add(tmBox(g, 0.12, 0.26, 0.12, 0xfff0c0, lx, ly, 0), 'lamp_core'));
  /* 顶帽 */
  P.add(add(tmBox(g, 0.34, 0.06, 0.34, 0x2f3438, lx, ly + 0.25, 0), 'lamp_cap'));
  tmPieceEnd(g, P);
}

/* ---------- 长椅 ---------- */
function propBench(g, add) {
  var P = tmPiece(g, 'prop_bench', '长椅');
  /* ★ 2026-10-22（用户："长椅还要调矮一点，坐着在木板下面了"）：
     人坐着的高度 = 地板 − 0.06，所以座面顶面应该也在 **0.42**
     （之前统一成 0.48，人会陷进木板 0.06）。座面中心 0.42−0.045 = 0.375。 */
  var _bs = 0.155;
  P.add(add(tmBox(g, 1.7, 0.09, 0.5, 0x8a6a48, 0, 0.28, 0), 'seat'));
  P.add(add(tmBox(g, 1.7, 0.45, 0.08, 0x8a6a48, 0, 0.72 - _bs, -0.22), 'back'));
  [-0.7, 0.7].forEach(function (x) {
    P.add(add(tmBox(g, 0.09, 0.45, 0.09, 0x4a3423, x, 0.22 - _bs, -0.2), 'leg_a'));
    P.add(add(tmBox(g, 0.09, 0.45, 0.09, 0x4a3423, x, 0.22 - _bs, 0.2), 'leg_b'));
  });
  tmPieceEnd(g, P);
}

/* ---------- 自动售货机 ---------- */
function propVending(g, add, variant) {
  var body = variant === 'red' ? 0xb03a2a : (variant === 'blue' ? 0x3a6aa0 : 0x2f7a4a);
  var P = tmPiece(g, 'prop_vending', '售货机');
  P.add(add(tmBox(g, 0.90, 1.85, 0.70, body, 0, 0.93, 0), 'body'));
  P.add(add(tmBox(g, 0.74, 0.90, 0.06, 0xd8e8f0, 0, 1.28, 0.36), 'window'));
  P.add(add(tmBox(g, 0.76, 0.28, 0.10, 0x2f3438, 0, 0.55, 0.36), 'slot'));
  P.add(add(tmBox(g, 0.90, 0.10, 0.72, 0x2f3438, 0, 1.90, 0), 'top'));
  tmPieceEnd(g, P);
}

/* ---------- 自行车 ---------- */
function propBike(g, add, variant) {
  var c = variant === 'red' ? 0xb03a2a : (variant === 'green' ? 0x3a7a4a :
          variant === 'blue' ? 0x2f5aa0 : 0x9aa0a4);
  var P = tmPiece(g, 'prop_bike', '自行车');
  var R = 0.34;                 /* 轮半径 */
  var ax = 0.56;                /* 前后轴间距的一半 */

  /* 车轮：外胎 + 轮圈 + 辐条 */
  [-ax, ax].forEach(function (x, wi) {
    var tire = new THREE.Mesh(new THREE.TorusGeometry(R, 0.035, 8, 20), tmMat(0x23262a));
    tire.position.set(x, R, 0);
    g.add(tire); P.add(tire);
    var rim = new THREE.Mesh(new THREE.TorusGeometry(R - 0.05, 0.012, 6, 20), tmMat(0xb0b6ba));
    rim.position.set(x, R, 0);
    g.add(rim); P.add(rim);
    /* 辐条：4 根交叉 */
    for (var sp = 0; sp < 4; sp++) {
      var a = sp / 4 * Math.PI;
      P.add(add(tmBox(g, 0.012, R * 2 - 0.10, 0.012, 0xc8ccd0, x, R, 0, a), 'spoke_' + (wi + 1) + '_' + (sp + 1)));
    }
    /* 轮毂 */
    P.add(add(tmCyl(g, 0.04, 0.04, 0.06, 0x9aa0a4, x, R, 0), 'hub_' + (wi + 1)));
  });

  /* 车架：下管 + 立管 + 上管 + 后下叉（三角结构） */
  P.add(add(tmBox(g, 0.05, 0.05, 0.86, c, -0.06, 0.62, 0, 1.5708), 'tube_down'));
  P.add(add(tmBox(g, 0.05, 0.52, 0.05, c, 0.30, 0.62, 0), 'tube_seat'));
  P.add(add(tmBox(g, 0.05, 0.05, 0.52, c, 0.12, 0.88, 0, 1.5708), 'tube_top'));
  P.add(add(tmBox(g, 0.045, 0.045, 0.56, c, -0.34, 0.50, 0, 0.35), 'stay_lower'));

  /* 前叉 + 车头管 */
  P.add(add(tmBox(g, 0.045, 0.62, 0.045, c, 0.50, 0.66, 0, 0.18), 'fork'));
  P.add(add(tmBox(g, 0.05, 0.24, 0.05, c, 0.44, 0.98, 0), 'head_tube'));

  /* 车把：横杆 + 两个把套 */
  P.add(add(tmBox(g, 0.44, 0.035, 0.035, 0x2b2b2f, 0.46, 1.10, 0), 'handlebar'));
  P.add(add(tmCyl(g, 0.028, 0.028, 0.10, 0x1a1a1c, 0.24, 1.10, 0), 'grip_l'));
  P.add(add(tmCyl(g, 0.028, 0.028, 0.10, 0x1a1a1c, 0.68, 1.10, 0), 'grip_r'));

  /* 车座：座杆 + 鞍座 */
  P.add(add(tmCyl(g, 0.025, 0.025, 0.22, 0x9aa0a4, 0.30, 1.02, 0), 'seatpost'));
  P.add(add(tmBox(g, 0.26, 0.06, 0.14, 0x2b2b2f, 0.28, 1.14, 0), 'saddle'));

  /* 脚踏 + 曲柄 */
  P.add(add(tmCyl(g, 0.10, 0.10, 0.03, 0x8a8f8e, 0.02, 0.44, 0), 'chainring'));
  P.add(add(tmBox(g, 0.035, 0.20, 0.035, 0x9aa0a4, 0.02, 0.44, 0.06, 0.5), 'crank_l'));
  P.add(add(tmBox(g, 0.14, 0.03, 0.08, 0x2b2b2f, 0.02, 0.34, 0.12), 'pedal_l'));

  /* 链条 */
  P.add(add(tmBox(g, 0.55, 0.02, 0.02, 0x6a6e72, -0.28, 0.42, 0.05), 'chain'));

  /* 前车筐 */
  P.add(add(tmBox(g, 0.30, 0.22, 0.26, 0xb08a5a, 0.56, 1.02, 0), 'basket'));
  P.add(add(tmBox(g, 0.26, 0.02, 0.22, 0x8a6a48, 0.56, 1.12, 0), 'basket_rim'));

  /* 后货架 */
  P.add(add(tmBox(g, 0.34, 0.03, 0.16, 0x9aa0a4, -0.46, 0.86, 0), 'rack'));

  tmPieceEnd(g, P);
}

/* ---------- 垃圾桶 ---------- */
function propBin(g, add, variant) {
  var c = variant === 'green' ? 0x3a7a4a : 0x7a8084;
  var P = tmPiece(g, 'prop_bin', '垃圾桶');
  P.add(add(tmCyl(g, 0.22, 0.19, 0.62, c, 0, 0.31, 0), 'body'));
  P.add(add(tmCyl(g, 0.24, 0.24, 0.07, 0x2f3438, 0, 0.66, 0), 'lid'));
  tmPieceEnd(g, P);
}

/* ---------- 木箱 ---------- */
function propCrate(g, add, variant) {
  var c = variant === 'ware' ? 0x8a7050 : 0x9a7650;
  var P = tmPiece(g, 'prop_crate', '木箱');
  P.add(add(tmBox(g, 0.6, 0.48, 0.6, c, 0, 0.24, 0), 'body'));
  P.add(add(tmBox(g, 0.62, 0.05, 0.10, 0x6b4a32, 0, 0.44, 0), 'band'));
  tmPieceEnd(g, P);
}

/* ---------- 木桶 ---------- */
function propBarrel(g, add) {
  var P = tmPiece(g, 'prop_barrel', '木桶');
  P.add(add(tmCyl(g, 0.28, 0.24, 0.62, 0x7a5a3a, 0, 0.31, 0), 'body'));
  P.add(add(tmCyl(g, 0.29, 0.29, 0.06, 0x4a3423, 0, 0.52, 0), 'hoop_top'));
  P.add(add(tmCyl(g, 0.29, 0.29, 0.06, 0x4a3423, 0, 0.16, 0), 'hoop_bottom'));
  tmPieceEnd(g, P);
}

/* ---------- 摊位 ---------- */
function propStall(g, add, variant) {
  var P = tmPiece(g, 'prop_stall', '摊位');
  P.add(add(tmBox(g, 1.8, 0.08, 0.8, 0x8a6a48, 0, 0.75, 0), 'counter'));
  P.add(add(tmBox(g, 0.08, 0.75, 0.08, 0x6b4a32, -0.8, 0.38, -0.3), 'leg_a'));
  P.add(add(tmBox(g, 0.08, 0.75, 0.08, 0x6b4a32, 0.8, 0.38, -0.3), 'leg_b'));
  P.add(add(tmBox(g, 0.08, 0.75, 0.08, 0x6b4a32, -0.8, 0.38, 0.3), 'leg_c'));
  P.add(add(tmBox(g, 0.08, 0.75, 0.08, 0x6b4a32, 0.8, 0.38, 0.3), 'leg_d'));
  /* 遮阳棚 */
  P.add(add(tmBox(g, 2.1, 0.06, 1.1, variant === 'fish' ? 0x3a6a9a : 0xc06a3a, 0, 1.95, 0), 'canopy'));
  P.add(add(tmBox(g, 0.06, 1.2, 0.06, 0x6b4a32, -0.95, 1.35, -0.45), 'post_a'));
  P.add(add(tmBox(g, 0.06, 1.2, 0.06, 0x6b4a32, 0.95, 1.35, -0.45), 'post_b'));
  /* 货物 */
  for (var i = 0; i < 3; i++) {
    P.add(add(tmBox(g, 0.3, 0.14, 0.24, variant === 'fish' ? 0x9ab0c0 : 0xd8a24a,
      -0.5 + i * 0.5, 0.86, 0.05), 'goods_' + (i + 1)));
  }
  tmPieceEnd(g, P);
}

/* ---------- 邮筒 ---------- */
function propPostbox(g, add, variant) {
  var c = 0x2f6a45;            /* 深绿 */
  var c2 = 0x3f7a52;           /* 浅一档 */
  var P = tmPiece(g, 'prop_postbox', '邮箱');
  /* 底座 */
  P.add(add(tmBox(g, 0.44, 0.12, 0.40, 0x5a6060, 0, 0.06, 0), 'base'));
  /* 方形箱体 */
  P.add(add(tmBox(g, 0.52, 0.86, 0.44, c, 0, 0.55, 0), 'box'));
  /* 前面板（略深） */
  P.add(add(tmBox(g, 0.46, 0.78, 0.02, c2, 0, 0.55, 0.23), 'face'));
  /* 投信口 */
  P.add(add(tmBox(g, 0.34, 0.07, 0.05, 0x1a2a20, 0, 0.86, 0.25), 'slot'));
  /* 投信口上沿 */
  P.add(add(tmBox(g, 0.38, 0.04, 0.07, 0x5a6060, 0, 0.91, 0.25), 'slot_hood'));
  /* 顶盖：斜顶 */
  P.add(add(tmBox(g, 0.58, 0.08, 0.50, c2, 0, 1.04, 0), 'roof'));
  P.add(add(tmBox(g, 0.54, 0.06, 0.46, 0x24523a, 0, 1.10, 0), 'roof_top'));
  /* 正面上方的白色标识条 */
  P.add(add(tmBox(g, 0.30, 0.12, 0.02, 0xe8f0e8, 0, 0.70, 0.245), 'plate'));
  /* 侧面小号 */
  P.add(add(tmBox(g, 0.02, 0.16, 0.20, 0xd8e0d8, 0.265, 0.50, 0), 'side_plate'));
  /* 取信小门 */
  P.add(add(tmBox(g, 0.30, 0.20, 0.02, 0x24523a, 0, 0.28, 0.235), 'door'));
  P.add(add(tmBox(g, 0.06, 0.03, 0.04, 0x9aa0a4, 0.10, 0.30, 0.25), 'door_handle'));
  tmPieceEnd(g, P);
}

/* ---------- 消防栓 ---------- */
function propHydrant(g, add) {
  var P = tmPiece(g, 'prop_hydrant', '消防栓');
  P.add(add(tmCyl(g, 0.13, 0.15, 0.55, 0xb03028, 0, 0.28, 0), 'body'));
  P.add(add(tmSphere(g, 0.13, 0xb03028, 0, 0.58, 0), 'cap'));
  P.add(add(tmBox(g, 0.34, 0.08, 0.10, 0xb03028, 0, 0.40, 0), 'arm'));
  tmPieceEnd(g, P);
}

/* ---------- 公告栏 ---------- */
function propNotice(g, add) {
  var P = tmPiece(g, 'prop_notice', '公告栏');
  P.add(add(tmBox(g, 1.5, 0.95, 0.08, 0x6b4a32, 0, 1.55, 0), 'board'));
  P.add(add(tmBox(g, 1.34, 0.80, 0.02, 0xe8dcc8, 0, 1.55, 0.05), 'paper'));
  P.add(add(tmBox(g, 0.08, 1.1, 0.08, 0x4a3423, -0.65, 0.55, 0), 'post_a'));
  P.add(add(tmBox(g, 0.08, 1.1, 0.08, 0x4a3423, 0.65, 0.55, 0), 'post_b'));
  tmPieceEnd(g, P);
}

/* ---------- 公交站 ---------- */
function propBusstop(g, add) {
  var P = tmPiece(g, 'prop_busstop', '公交站');
  P.add(add(tmCyl(g, 0.06, 0.07, 2.4, 0x3a3f42, 0, 1.2, 0), 'pole'));
  P.add(add(tmBox(g, 0.7, 0.5, 0.06, 0x2f6a9a, 0, 2.2, 0), 'sign'));
  P.add(add(tmBox(g, 0.6, 0.30, 0.02, 0xe8f0f4, 0, 2.2, 0.04), 'sign_face'));
  tmPieceEnd(g, P);
}

/* ---------- 桌子 ---------- */
function propTable(g, add) {
  var P = tmPiece(g, 'prop_table', '户外桌');
  P.add(add(tmBox(g, 0.9, 0.07, 0.9, 0x8a6a48, 0, 0.72, 0), 'top'));
  P.add(add(tmBox(g, 0.09, 0.68, 0.09, 0x4a3423, -0.32, 0.36, -0.32), 'leg_a'));
  P.add(add(tmBox(g, 0.09, 0.68, 0.09, 0x4a3423, 0.32, 0.36, -0.32), 'leg_b'));
  P.add(add(tmBox(g, 0.09, 0.68, 0.09, 0x4a3423, -0.32, 0.36, 0.32), 'leg_c'));
  P.add(add(tmBox(g, 0.09, 0.68, 0.09, 0x4a3423, 0.32, 0.36, 0.32), 'leg_d'));
  tmPieceEnd(g, P);
}

/* ---------- 遮阳伞 ---------- */
function propParasol(g, add, variant) {
  var c = variant === 'cream' ? 0xe8dcc0 : 0xc0452c;
  var P = tmPiece(g, 'prop_parasol', '遮阳伞');
  P.add(add(tmCyl(g, 0.05, 0.06, 2.3, 0x6b4a32, 0, 1.15, 0), 'pole'));
  P.add(add(tmCone(g, 1.3, 0.5, c, 0, 2.45, 0), 'canopy'));
  P.add(add(tmCyl(g, 0.24, 0.26, 0.10, 0x4a3423, 0, 0.05, 0), 'base'));
  tmPieceEnd(g, P);
}

/* ---------- 菜单牌 ---------- */
function propMenu(g, add) {
  var P = tmPiece(g, 'prop_menu', '菜单牌');
  P.add(add(tmBox(g, 0.55, 0.75, 0.05, 0x4a3423, 0, 0.70, 0), 'board'));
  P.add(add(tmBox(g, 0.45, 0.62, 0.02, 0xe8dcc8, 0, 0.70, 0.04), 'paper'));
  P.add(add(tmBox(g, 0.06, 0.70, 0.06, 0x4a3423, -0.22, 0.35, 0.10, 0.25), 'leg_a'));
  P.add(add(tmBox(g, 0.06, 0.70, 0.06, 0x4a3423, 0.22, 0.35, 0.10, -0.25), 'leg_b'));
  tmPieceEnd(g, P);
}

/* ---------- 花盆 ---------- */
function propPot(g, add) {
  var P = tmPiece(g, 'prop_pot', '花盆');
  /* 陶盆 */
  P.add(add(tmCyl(g, 0.26, 0.20, 0.34, 0x9a5f42, 0, 0.17, 0), 'pot'));
  P.add(add(tmCyl(g, 0.27, 0.27, 0.05, 0xa86a4a, 0, 0.33, 0), 'pot_rim'));
  P.add(add(tmCyl(g, 0.22, 0.22, 0.04, 0x5f4a35, 0, 0.34, 0), 'soil'));
  /* 主花 + 侧花 */
  vegStemFlower(P, add, g, 0, 0.36, 0, 0.46, 0.15, 0xd8506a, 0xf0d060, 'flower', 5);
  vegStemFlower(P, add, g, -0.12, 0.36, 0.08, 0.30, 0.10, 0xe8b040, 0xf0d060, 'flower_side_a', 6);
  vegStemFlower(P, add, g, 0.12, 0.36, -0.06, 0.26, 0.09, 0xa070d0, 0xf0d060, 'flower_side_b', 7);
  tmPieceEnd(g, P);
}

/* ---------- 信箱 ---------- */
function propMailbox(g, add, variant) {
  var c = variant === 'red' ? 0xb03028 : 0x3a6aa0;
  var P = tmPiece(g, 'prop_mailbox', '信箱');
  P.add(add(tmBox(g, 0.32, 0.34, 0.44, c, 0, 1.05, 0), 'box'));
  P.add(add(tmBox(g, 0.36, 0.06, 0.48, 0x2f3438, 0, 1.24, 0), 'lid'));
  P.add(add(tmBox(g, 0.08, 0.90, 0.08, 0x4a3423, 0, 0.45, 0), 'post'));
  tmPieceEnd(g, P);
}

/* ---------- 围栏 ---------- */
function propFence(g, add) {
  var P = tmPiece(g, 'prop_fence', '围栏');
  P.add(add(tmBox(g, 1.8, 0.08, 0.06, 0x8a6a48, 0, 0.75, 0), 'rail_top'));
  P.add(add(tmBox(g, 1.8, 0.08, 0.06, 0x8a6a48, 0, 0.42, 0), 'rail_bottom'));
  [-0.8, 0, 0.8].forEach(function (x) {
    P.add(add(tmBox(g, 0.09, 0.9, 0.09, 0x6b4a32, x, 0.45, 0), 'post'));
  });
  tmPieceEnd(g, P);
}

/* ---------- 绿篱 ---------- */
function propHedge(g, add) {
  var P = tmPiece(g, 'prop_hedge', '绿篱');
  P.add(add(tmBox(g, 1.80, 0.12, 0.76, 0x8a8272, 0, 0.06, 0), 'curb'));
  P.add(add(tmBox(g, 1.70, 0.10, 0.66, 0x9a9282, 0, 0.12, 0), 'curb_top'));
  /* 内部核心（深色，被叶子遮住只做体积） */
  P.add(add(tmBox(g, 1.62, 0.62, 0.58, 0x2f5228, 0, 0.46, 0), 'core'));
  /* 表面撒叶：顶面 + 前后两面 */
  var sd = 7;
  function rnd() { sd = (sd * 9301 + 49297) % 233280; return sd / 233280; }
  var COL = [0x4f7a45, 0x5c8a52, 0x6f9a62, 0x486e3f];
  for (var i = 0; i < 46; i++) {
    var fx = -0.78 + rnd() * 1.56;
    var fz = -0.27 + rnd() * 0.54;
    var fy = 0.30 + rnd() * 0.48;
    vegLeaf(P, g, fx, fy, fz, 0.18 + rnd() * 0.12, COL[i % 4],
      (rnd() - 0.5) * 0.8, rnd() * Math.PI * 2, 'leaf_' + (i + 1));
  }
  /* 顶部起伏：几片立起来的叶子 */
  for (var t = 0; t < 12; t++) {
    var tx = -0.76 + t * 0.138;
    vegLeaf(P, g, tx, 0.82 + (t % 3) * 0.05, (t % 2 ? 0.08 : -0.08),
      0.20, COL[(t + 1) % 4], -0.35, t * 0.7, 'top_leaf_' + (t + 1));
  }
  tmPieceEnd(g, P);
}

/* ---------- 晾衣架 ---------- */
function propLaundry(g, add) {
  var P = tmPiece(g, 'prop_laundry', '晾衣架');
  P.add(add(tmBox(g, 0.08, 1.8, 0.08, 0x6b4a32, -0.9, 0.9, 0), 'post_a'));
  P.add(add(tmBox(g, 0.08, 1.8, 0.08, 0x6b4a32, 0.9, 0.9, 0), 'post_b'));
  P.add(add(tmBox(g, 1.9, 0.03, 0.03, 0x9a9a9a, 0, 1.72, 0), 'line'));
  for (var i = 0; i < 3; i++) {
    P.add(add(tmBox(g, 0.36, 0.5, 0.02, [0xe8dcc8, 0x8ab0d8, 0xe8b8c8][i],
      -0.55 + i * 0.55, 1.42, 0), 'cloth_' + (i + 1)));
  }
  tmPieceEnd(g, P);
}

/* ---------- 雕塑 ---------- */
function propStatue(g, add) {
  var P = tmPiece(g, 'prop_statue', '雕塑');
  P.add(add(tmBox(g, 0.9, 0.35, 0.9, 0x8a8272, 0, 0.18, 0), 'base'));
  P.add(add(tmBox(g, 0.7, 0.25, 0.7, 0x9a9282, 0, 0.45, 0), 'base2'));
  P.add(add(tmCyl(g, 0.20, 0.24, 1.1, 0x9aa0a4, 0, 1.15, 0), 'body'));
  P.add(add(tmSphere(g, 0.20, 0x9aa0a4, 0, 1.82, 0), 'head'));
  tmPieceEnd(g, P);
}

/* ---------- 花架 ---------- */
function propFlowerStand(g, add) {
  var P = tmPiece(g, 'prop_flowerstand', '花架');
  P.add(add(tmBox(g, 0.75, 0.50, 0.55, 0x8a6a48, 0, 0.25, 0), 'stand'));
  P.add(add(tmBox(g, 0.82, 0.06, 0.62, 0x9a7a52, 0, 0.52, 0), 'stand_top'));
  for (var i = 0; i < 2; i++) {
    var x = -0.18 + i * 0.36;
    P.add(add(tmCyl(g, 0.14, 0.11, 0.22, 0x9aa0a4, x, 0.66, 0), 'pot_' + (i + 1)));
    vegStemFlower(P, add, g, x, 0.74, 0, 0.30,
      0.11, [0xe06a8a, 0xf0d060][i], 0xf0d060, 'flower_' + (i + 1), 11 + i);
  }
  tmPieceEnd(g, P);
}

/* ---------- 手推车 ---------- */
function propHandcart(g, add) {
  var P = tmPiece(g, 'prop_handcart', '手推车');
  P.add(add(tmBox(g, 0.95, 0.12, 1.5, 0x8a6a48, 0, 0.55, 0), 'bed'));
  P.add(add(tmBox(g, 0.9, 0.35, 0.45, 0x9a7650, 0, 0.70, -0.35), 'crate_a'));
  P.add(add(tmBox(g, 0.9, 0.35, 0.45, 0x9a7650, 0, 0.70, 0.35), 'crate_b'));
  [[-0.45, -0.55], [0.45, -0.55], [-0.45, 0.55], [0.45, 0.55]].forEach(function (q, i) {
    var w = new THREE.Mesh(new THREE.TorusGeometry(0.20, 0.05, 6, 12), tmMat(0x2b2b2f));
    w.position.set(q[0], 0.24, q[1]); w.rotation.y = Math.PI / 2;
    g.add(w); P.add(w);
  });
  P.add(add(tmBox(g, 0.07, 0.07, 0.9, 0x6f4c31, -0.35, 0.72, 0.95), 'handle_a'));
  P.add(add(tmBox(g, 0.07, 0.07, 0.9, 0x6f4c31, 0.35, 0.72, 0.95), 'handle_b'));
  tmPieceEnd(g, P);
}

/* ---------- 铁砧 ---------- */
function propAnvil(g, add) {
  var P = tmPiece(g, 'prop_anvil', '铁砧');
  P.add(add(tmBox(g, 0.6, 0.5, 0.5, 0x3b3b3f, 0, 0.25, 0), 'base'));
  P.add(add(tmBox(g, 0.78, 0.18, 0.42, 0x4a4a50, 0, 0.58, 0), 'top'));
  P.add(add(tmBox(g, 0.30, 0.16, 0.28, 0x3b3b3f, -0.48, 0.56, 0), 'horn'));
  tmPieceEnd(g, P);
}

/* ---------- 煤堆 ---------- */
function propCoal(g, add) {
  var P = tmPiece(g, 'prop_coal', '煤堆');
  for (var i = 0; i < 7; i++) {
    var a = i * 2.3, r = 0.22 + (i % 3) * 0.14;
    P.add(add(tmSphere(g, 0.16, i % 2 ? 0x2b2d2e : 0x3a3b3c,
      Math.cos(a) * r, 0.20 + (i % 2) * 0.10, Math.sin(a) * r), 'lump_' + (i + 1)));
  }
  tmPieceEnd(g, P);
}

/* ---------- 花坛 ---------- */
function propPlanter(g, add) {
  var P = tmPiece(g, 'prop_planter', '花坛');
  P.add(add(tmBox(g, 1.10, 0.40, 0.62, 0x8a8272, 0, 0.20, 0), 'rim'));
  P.add(add(tmBox(g, 1.16, 0.10, 0.68, 0x9a9282, 0, 0.42, 0), 'rim_top'));
  P.add(add(tmBox(g, 0.98, 0.10, 0.50, 0x5f4a35, 0, 0.46, 0), 'soil'));

  /* 5 朵真实花：3 朵大的 + 2 朵小的 */
  var big = [[-0.34, 0xd8506a], [0.00, 0xe8b040], [0.34, 0xa070d0]];
  for (var i = 0; i < 3; i++) {
    vegStemFlower(P, add, g, big[i][0], 0.48, 0, 0.38, 0.13, big[i][1], 0xf0d060, 'flower_' + (i + 1), i + 3);
  }
  var small = [[-0.17, 0xe86a8a], [0.17, 0xf0c050]];
  for (var j = 0; j < 2; j++) {
    vegStemFlower(P, add, g, small[j][0], 0.48, 0.14, 0.24, 0.09, small[j][1], 0xf0d060, 'flower_s' + (j + 1), j + 9);
  }
  tmPieceEnd(g, P);
}

/* ---------- 红灯笼 ---------- */
function propLantern(g, add) {
  var P = tmPiece(g, 'prop_lantern', '红灯笼');
  P.add(add(tmBox(g, 0.08, 1.4, 0.08, 0x2f241a, 0, 2.55, 0), 'pole'));
  P.add(add(tmCyl(g, 0.13, 0.15, 0.42, 0xc0392b, 0, 1.65, 0), 'lantern'));
  P.add(add(tmSphere(g, 0.13, 0xff7a3a, 0, 1.65, 0), 'glow'));
  tmPieceEnd(g, P);
}

/* ---------- 自行车架 ---------- */
function propBikeRack(g, add) {
  var P = tmPiece(g, 'prop_bikerack', '自行车架');
  for (var i = 0; i < 3; i++) {
    var x = -0.6 + i * 0.6;
    var ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.035, 6, 14), tmMat(0x6a7074));
    ring.position.set(x, 0.32, 0); ring.rotation.y = Math.PI / 2;
    g.add(ring); P.add(ring);
  }
  P.add(add(tmBox(g, 1.6, 0.06, 0.3, 0x5a6064, 0, 0.06, 0), 'base'));
  tmPieceEnd(g, P);
}

/* ---------- 注册 ---------- */
(function registerProps() {
  var defs = [
    ['prop_tree', '树', 2.1, 2.1, 3.2, '树干 + 多层树冠'],
    ['prop_lamp', '路灯', 0.62, 0.62, 3.2, '灯杆 + 灯球'],
    ['prop_bench', '长椅', 1.8, 0.6, 0.95, '木条长椅'],
    ['prop_vending', '自动售货机', 0.95, 0.75, 1.95, '售货机'],
    ['prop_bike', '自行车', 1.5, 0.2, 1.0, '两轮自行车'],
    ['prop_bin', '垃圾桶', 0.5, 0.5, 0.7, '圆柱垃圾桶'],
    ['prop_crate', '木箱', 0.65, 0.65, 0.5, '木箱'],
    ['prop_barrel', '木桶', 0.6, 0.6, 0.65, '木桶'],
    ['prop_stall', '摊位', 2.1, 1.1, 2.0, '带遮阳棚的摊位'],
    ['prop_postbox', '邮筒', 0.55, 0.55, 1.2, '圆柱邮筒'],
    ['prop_hydrant', '消防栓', 0.4, 0.4, 0.65, '消防栓'],
    ['prop_notice', '公告栏', 1.5, 0.2, 2.1, '公告栏'],
    ['prop_busstop', '公交站', 0.75, 0.3, 2.45, '站牌'],
    ['prop_table', '户外桌', 0.95, 0.95, 0.78, '方桌'],
    ['prop_parasol', '遮阳伞', 2.6, 2.6, 2.7, '伞面 + 伞杆'],
    ['prop_menu', '菜单牌', 0.6, 0.3, 1.1, '立式菜单牌'],
    ['prop_pot', '花盆', 0.5, 0.5, 0.95, '陶盆 + 花'],
    ['prop_mailbox', '信箱', 0.4, 0.5, 1.3, '家用信箱'],
    ['prop_fence', '围栏', 1.9, 0.15, 0.95, '横杆围栏'],
    ['prop_hedge', '绿篱', 1.75, 0.75, 0.75, '修剪绿篱'],
    ['prop_laundry', '晾衣架', 1.9, 0.2, 1.85, '晾衣绳 + 衣物'],
    ['prop_statue', '雕塑', 1.0, 1.0, 2.05, '基座 + 人像'],
    ['prop_flowerstand', '花架', 0.8, 0.6, 1.35, '架子 + 两盆花'],
    ['prop_handcart', '手推车', 1.1, 1.8, 1.2, '平板车 + 货箱'],
    ['prop_anvil', '铁砧', 1.0, 0.6, 0.7, '铁砧'],
    ['prop_coal', '煤堆', 1.0, 1.0, 0.45, '散煤块'],
    ['prop_planter', '花坛', 1.1, 0.65, 0.95, '石框 + 花'],
    ['prop_lantern', '红灯笼', 0.4, 0.4, 3.3, '灯笼杆'],
    ['prop_bikerack', '自行车架', 1.7, 0.35, 0.6, '环形车架']
  ];
  defs.forEach(function (d) { propSpec(d[0], d[1], d[2], d[3], d[4], d[5]); });
})();

/* 构建入口 */
function buildPropModel(spec) {
  var g = new THREE.Group();
  g.userData.parts = [];
  function add(m, name) {
    if (m) { tmTag(m, name); g.userData.parts.push({ id: name, cn: townPartCn(name) }); }
    return m;
  }
  var id = spec.propId;
  var variant = spec.variant || '';
  if (id === 'prop_tree') { propTree(g, add, variant || 'green', 1.0); }
  else if (id === 'prop_lamp') { propLamp(g, add); }
  else if (id === 'prop_bench') { propBench(g, add); }
  else if (id === 'prop_vending') { propVending(g, add, variant); }
  else if (id === 'prop_bike') { propBike(g, add, variant); }
  else if (id === 'prop_bin') { propBin(g, add, variant); }
  else if (id === 'prop_crate') { propCrate(g, add, variant); }
  else if (id === 'prop_barrel') { propBarrel(g, add); }
  else if (id === 'prop_stall') { propStall(g, add, variant); }
  else if (id === 'prop_postbox') { propPostbox(g, add, variant); }
  else if (id === 'prop_hydrant') { propHydrant(g, add); }
  else if (id === 'prop_notice') { propNotice(g, add); }
  else if (id === 'prop_busstop') { propBusstop(g, add); }
  else if (id === 'prop_table') { propTable(g, add); }
  else if (id === 'prop_parasol') { propParasol(g, add, variant); }
  else if (id === 'prop_menu') { propMenu(g, add); }
  else if (id === 'prop_pot') { propPot(g, add); }
  else if (id === 'prop_mailbox') { propMailbox(g, add, variant); }
  else if (id === 'prop_fence') { propFence(g, add); }
  else if (id === 'prop_hedge') { propHedge(g, add); }
  else if (id === 'prop_laundry') { propLaundry(g, add); }
  else if (id === 'prop_statue') { propStatue(g, add); }
  else if (id === 'prop_flowerstand') { propFlowerStand(g, add); }
  else if (id === 'prop_handcart') { propHandcart(g, add); }
  else if (id === 'prop_anvil') { propAnvil(g, add); }
  else if (id === 'prop_coal') { propCoal(g, add); }
  else if (id === 'prop_planter') { propPlanter(g, add); }
  else if (id === 'prop_lantern') { propLantern(g, add); }
  else if (id === 'prop_bikerack') { propBikeRack(g, add); }
  tmCollectFurniture(g);
  return g;
}
