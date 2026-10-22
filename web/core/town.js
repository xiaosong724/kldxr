/* 新手小镇 · 日式街角微缩镇（70×70）
   ★ 数据源 = server/town.py → web/core/town_data.js（建筑/道具/椅子/碰撞全部共用）
   ★ 画面：三渲二低模 · 暖色夜景街角 · 可进入建筑 · 真实家具碰撞
   ★ 性能：静态方块最后合并成 InstancedMesh（几千个方块 ≈ 几十次绘制）
*/
var TOWN_DATA = (typeof TOWN_DATA !== 'undefined') ? TOWN_DATA : null;
var TOWN_HALF = TOWN_DATA ? TOWN_DATA.half : 35.0;
var TOWN_EDGE = TOWN_DATA ? TOWN_DATA.edge : 34.0;
var TOWN_COUNTER = TOWN_DATA ? { x: TOWN_DATA.warehouseCounter[0], z: TOWN_DATA.warehouseCounter[1] }
                             : { x: 13.1, z: 17.0 };
var TOWN_NEAR_R = TOWN_DATA ? TOWN_DATA.warehouseR : 2.8;
var TOWN_SOLIDS = [];
var TOWN_ROOFS = [];
var TOWN_GROUP = null;
var TOWN_SEATS = TOWN_DATA ? TOWN_DATA.seats : [];
(function () {
  for (var _i = 0; _i < TOWN_SEATS.length; _i++) {
    if (typeof TOWN_SEATS[_i].yaw !== 'number') { TOWN_SEATS[_i].yaw = TOWN_SEATS[_i].ry || 0; }
  }
})();
var TOWN_BUILDINGS = TOWN_DATA ? TOWN_DATA.buildings : [];
var TOWN_HOUSES = TOWN_DATA ? (TOWN_DATA.houses || []) : [];
var TOWN_HOUSE_SIGNS = {};
var TOWN_HOUSE_INFO = {};
var TOWN_NPCS = TOWN_DATA ? (TOWN_DATA.npcs || []) : [];
var TOWN_SHOPS = TOWN_DATA ? (TOWN_DATA.shops || []) : [];
var TOWN_LABELS = [];
var TOWN_CX = TOWN_DATA && TOWN_DATA.origin ? TOWN_DATA.origin[0] : 0;
var TOWN_CZ = TOWN_DATA && TOWN_DATA.origin ? TOWN_DATA.origin[1] : 0;
var TOWN_CORE_GROUP = null;
var TOWN_SOLID_OX = 0, TOWN_SOLID_OZ = 0;
var TOWN_TELEPORTS = TOWN_DATA ? (TOWN_DATA.teleports || []) : [];
var TOWN_STATS = { meshes: 0, instanced: 0, seats: 0, solids: 0 };
(function () {
  if (!TOWN_DATA) { return; }
  for (var i = 0; i < TOWN_DATA.solids.length; i++) {
    var s = TOWN_DATA.solids[i];
    TOWN_SOLIDS.push({ x: s[0], z: s[1], hw: s[2], hd: s[3] });
  }
})();

function townIn(x, z) {
  return Math.abs(x) <= TOWN_HALF && Math.abs(z) <= TOWN_HALF;
}
function townNearWarehouse(x, z) {
  if (!townIn(x, z)) { return false; }
  var dx = x - TOWN_COUNTER.x, dz = z - TOWN_COUNTER.z;
  return dx * dx + dz * dz <= TOWN_NEAR_R * TOWN_NEAR_R;
}
/* 离玩家最近的椅子（交互按钮会变成“坐下”）*/
function townBuildingAt(x, z) {
  for (var i = 0; i < TOWN_BUILDINGS.length; i++) {
    var b = TOWN_BUILDINGS[i];
    if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) { return b; }
  }
  return null;
}
/* 可坐的家具 catalog（已放置的家具也能坐） */
var TOWN_SEAT_CATALOG = {
  chair_wood: 1, hall_chair: 1, desk_chair: 1,
  prop_bench: 1, sofa_modern_2: 1, prop_stool: 1
};

/* 从已放置的家具里找最近的椅子 */
function townSeatFromObjects(x, z) {
  var best = null, bd = 1.9 * 1.9;
  var list = (typeof TOWN_OBJECTS_CACHE !== 'undefined' && TOWN_OBJECTS_CACHE) || [];
  for (var i = 0; i < list.length; i++) {
    var o = list[i];
    if (!o || !TOWN_SEAT_CATALOG[o.catalog]) { continue; }
    var dx = o.x - x, dz = o.z - z;
    var d2 = dx * dx + dz * dz;
    if (d2 > bd) { continue; }
    bd = d2;
    best = {
      id: 'obj' + o.id, x: +o.x, z: +o.z,
      y: 0.30, yaw: +(o.rot || 0) + Math.PI,
      label: o.catalog, placed: true
    };
  }
  return best;
}

function townSeatNear(x, z) {
  var best = null, bd = 1.9 * 1.9;
  for (var i = 0; i < TOWN_SEATS.length; i++) {
    var s = TOWN_SEATS[i];
    var dx = s.x - x, dz = s.z - z;
    var d2 = dx * dx + dz * dz;
    if (d2 > bd) { continue; }
    /* ★ 屋里的椅子：人必须也在同一间屋里，避免隔着墙坐进去 */
    var room = townBuildingAt(s.x, s.z);
    if (room && !(x >= room.x0 && x <= room.x1 && z >= room.z0 && z <= room.z1)) { continue; }
    bd = d2; best = s;
  }
  /* 已放置的家具椅子：取更近的那个 */
  var p = townSeatFromObjects(x, z);
  if (p) {
    var pdx = p.x - x, pdz = p.z - z;
    if (!best || (pdx * pdx + pdz * pdz) < bd) { best = p; }
  }
  return best;
}
function townTeleportNear(x, z) {
  var best = null, bd = 2.8 * 2.8;
  for (var i = 0; i < TOWN_TELEPORTS.length; i++) {
    var t = TOWN_TELEPORTS[i];
    var dx = t.x - x, dz = t.z - z;
    var d2 = dx * dx + dz * dz;
    if (d2 <= bd) { bd = d2; best = t; }
  }
  return best;
}
function townVillaAt(x, z) {
  for (var i = 0; i < TOWN_HOUSES.length; i++) {
    var h = TOWN_HOUSES[i];
    if (h.tier !== 'villa') { continue; }
    if (x >= h.x0 && x <= h.x1 && z >= h.z0 && z <= h.z1) { return h; }
  }
  return null;
}
function townVillaFloor(x, z, h) {
  if (!h || h.tier !== 'villa') { return 0; }
  var cx = (h.x0 + h.x1) / 2, z1 = h.z1;
  if (x >= cx + 2.2 && x <= cx + 4.2 && z >= z1 - 4.4 && z <= z1 - 0.4) {
    var prog = (z1 - 0.7 - z) / 3.1;
    prog = Math.max(0, Math.min(1, prog));
    return 2.8 * prog;
  }
  if (x >= h.x0 + 0.6 && x <= h.x0 + 4.7 && z >= h.z0 + 0.6 && z <= h.z0 + 5.0) { return 2.8; }
  if (x >= cx + 2.2 && x <= cx + 4.2 && z >= z1 - 4.4 && z <= z1 - 2.6) { return 2.8; }
  if (x >= h.x0 + 2.0 && x <= cx + 4.2 && z >= z1 - 4.4 && z <= z1 - 3.2) { return 2.8; }
  return 0;
}
/* 别墅冰箱位置（与 townVillaInterior 的冰箱一致） */
function townHouseFridge(h) {
  if (!h || h.tier !== 'villa') { return null; }
  return [h.x1 - 1.1, h.z0 + 0.85];
}
function townHouseFridgeNear(x, z) {
  var me = (+(typeof WSC !== 'undefined' && WSC.role ? WSC.role.id : 0) || 0);
  for (var i = 0; i < TOWN_HOUSES.length; i++) {
    var h = TOWN_HOUSES[i];
    var f = townHouseFridge(h);
    if (!f) { continue; }
    var info = (typeof TOWN_HOUSE_INFO !== 'undefined' && TOWN_HOUSE_INFO) ? TOWN_HOUSE_INFO[h.id] : null;
    if (!info || +info.owner_id !== me) { continue; }
    var dx = f[0] - x, dz = f[1] - z;
    if (dx * dx + dz * dz <= 2.2 * 2.2) { return h; }
  }
  /* 已放置的建筑：6m 内即可（owner 校验在服务端做） */
  var ph = (typeof townPlacedHouseNear === 'function') ? townPlacedHouseNear(x, z) : null;
  if (ph) { return ph; }
  return null;
}

function townPlacedShops() {
  var out = [];
  var list = (typeof TOWN_OBJECTS_CACHE !== 'undefined' && TOWN_OBJECTS_CACHE) || [];
  for (var i = 0; i < list.length; i++) {
    var o = list[i];
    if (!o || o.parent) { continue; }
    var info = TOWN_SHOP_CATALOG[o.catalog];
    if (!info) { continue; }
    out.push({
      id: 'obj' + o.id, name: info[1], kind: info[0],
      /* ★ 服务端给的门口点；老数据没有就退回建筑中心（A2） */
      x: +(o.shop_x != null ? o.shop_x : o.x),
      z: +(o.shop_z != null ? o.shop_z : o.z),
      items: [], placed: true
    });
  }
  return out;
}

function townShopNear(x, z) {
  var best = null, bd = 3.2 * 3.2;
  var all = TOWN_SHOPS.concat(townPlacedShops());
  for (var i = 0; i < all.length; i++) {
    var s = all[i];
    var dx = s.x - x, dz = s.z - z;
    var d2 = dx * dx + dz * dz;
    if (d2 <= bd) { bd = d2; best = s; }
  }
  return best;
}
function townShopById(id) {
  for (var i = 0; i < TOWN_SHOPS.length; i++) {
    if (TOWN_SHOPS[i].id === id) { return TOWN_SHOPS[i]; }
  }
  var placed = townPlacedShops();
  for (var j = 0; j < placed.length; j++) {
    if (placed[j].id === id) { return placed[j]; }
  }
  return null;
}
function townHouseDoor(h) {
  var at = +h.door_at || 0;
  if (h.door === 'east') { return [h.x1, at]; }
  if (h.door === 'west') { return [h.x0, at]; }
  if (h.door === 'south') { return [at, h.z1]; }
  return [at, h.z0];
}
function townHouseNear(x, z) {
  var best = null, bd = 4.2 * 4.2;
  for (var i = 0; i < TOWN_HOUSES.length; i++) {
    var h = TOWN_HOUSES[i];
    var d = townHouseDoor(h);
    var dx = d[0] - x, dz = d[1] - z;
    var d2 = dx * dx + dz * dz;
    if (d2 <= bd) { bd = d2; best = h; }
  }
  return best;
}
function townHouseBed(h) {
  if (h.tier === 'villa') { return [h.x0 + 3.0, h.z1 - 2.8]; }
  return [h.x0 + 1.8, h.z0 + 1.35];
}

/* 已放置的建筑里，哪些能睡/用冰箱（家具系统） */
var TOWN_HOUSE_CATALOG = {
  house_flat_v1: 1, shop_apartment_v1: 1, shop_inn_v1: 1, house_villa_v1: 1
};

/* 从已放置建筑里找最近的（6m 内），返回 {id:'obj<id>'} */
function townPlacedHouseNear(x, z) {
  var best = null, bd = 6.0 * 6.0;
  var list = (typeof TOWN_OBJECTS_CACHE !== 'undefined' && TOWN_OBJECTS_CACHE) || [];
  for (var i = 0; i < list.length; i++) {
    var o = list[i];
    if (!o || o.parent || !TOWN_HOUSE_CATALOG[o.catalog]) { continue; }
    var dx = o.x - x, dz = o.z - z;
    var d2 = dx * dx + dz * dz;
    if (d2 <= bd && d2 < bd) { bd = d2; best = { id: 'obj' + o.id, placed: true, x: +o.x, z: +o.z }; }
  }
  return best;
}

function townHouseSleepNear(x, z) {
  var best = null, bd = 2.6 * 2.6;
  for (var i = 0; i < TOWN_HOUSES.length; i++) {
    var h = TOWN_HOUSES[i];
    var d = townHouseBed(h);
    var dx = d[0] - x, dz = d[1] - z;
    var d2 = dx * dx + dz * dz;
    var info = (typeof TOWN_HOUSE_INFO !== 'undefined' && TOWN_HOUSE_INFO) ? TOWN_HOUSE_INFO[h.id] : null;
    var _me = (+(typeof WSC !== 'undefined' && WSC.role ? WSC.role.id : 0) || 0);
    if (!info || +info.owner_id !== _me) { continue; }
    if (d2 <= bd) { bd = d2; best = h; }
  }
  /* 已放置的建筑：任何 6m 内的都可睡（放置者校验在服务端做） */
  var ph = townPlacedHouseNear(x, z);
  if (ph && !best) { best = ph; }
  return best;
}
function townHouseById(id) {
  for (var i = 0; i < TOWN_HOUSES.length; i++) {
    if (String(TOWN_HOUSES[i].id) === String(id)) { return TOWN_HOUSES[i]; }
  }
  return null;
}
function townTeleportById(id) {
  for (var i = 0; i < TOWN_TELEPORTS.length; i++) {
    if (TOWN_TELEPORTS[i].id === id) { return TOWN_TELEPORTS[i]; }
  }
  return null;
}
function townSeatById(id) {
  for (var i = 0; i < TOWN_SEATS.length; i++) {
    if (String(TOWN_SEATS[i].idx) === String(id) || String(TOWN_SEATS[i].id) === String(id)) {
      return TOWN_SEATS[i];
    }
  }
  return null;
}

/* ============================ 基础件 ============================ */
function townBox(parent, w, h, d, color, x, y, z, ry, rz, rx) {
  var m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.001, w), Math.max(0.001, h), Math.max(0.001, d)), matOf(color));
  m.position.set(x, y, z);
  if (ry) { m.rotation.y = ry; }
  if (rz) { m.rotation.z = rz; }
  if (rx) { m.rotation.x = rx; }
  m.castShadow = false; m.receiveShadow = false;
  parent.add(m);
  return m;
}
var _townGlowMat = {};
function townGlowMat(color, intensity) {
  var k = (color | 0) + '_' + (intensity || 0.72);
  var m = _townGlowMat[k];
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: color, emissive: color,
      emissiveIntensity: intensity || 0.72 });
    _townGlowMat[k] = m;
  }
  return m;
}
function townGlow(parent, w, h, d, color, x, y, z, intensity) {
  var m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.001, w), Math.max(0.001, h), Math.max(0.001, d)),
    townGlowMat(color, intensity));
  m.position.set(x, y, z); m.castShadow = false; m.receiveShadow = false;
  parent.add(m); return m;
}
function townPlane(parent, w, d, color, x, y, z, opacity) {
  var mt = new THREE.MeshLambertMaterial({ color: color, transparent: !!opacity, opacity: opacity || 1 });
  var m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mt);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = false;
  parent.add(m);
  return m;
}
function townCyl(parent, rt, rb, h, color, x, y, z, seg, ry) {
  var m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 12), matOf(color));
  m.position.set(x, y, z);
  if (ry) { m.rotation.y = ry; }
  m.castShadow = false; parent.add(m); return m;
}
function townSphere(parent, r, color, x, y, z, seg) {
  var m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, seg || 1), matOf(color));
  m.position.set(x, y, z); m.castShadow = false; parent.add(m); return m;
}
function townCone(parent, r, h, color, x, y, z, seg) {
  var m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg || 7), matOf(color));
  m.position.set(x, y, z); m.castShadow = false; parent.add(m); return m;
}
function townSolid(x0, z0, x1, z1) {
  TOWN_SOLIDS.push({ x: (x0 + x1) / 2 + TOWN_SOLID_OX, z: (z0 + z1) / 2 + TOWN_SOLID_OZ,
    hw: Math.abs(x1 - x0) / 2, hd: Math.abs(z1 - z0) / 2 });
}
/* 仿阴影（镇里静态物件不投实时阴影，用一块柔和暗面代替）*/
function townSoftShadow(parent, x, z, w, d, ry, op) {
  var m = townPlane(parent, w, d, 0x1d211c, x, 0.035, z, op || 0.22);
  if (ry) { m.rotation.z = ry; }
  return m;
}

/* 文字招牌（canvas 纹理，只建一次）*/
var _townSignCache = {};
function townSignTex(text, bg, fg, vertical) {
  var k = text + '|' + bg + '|' + fg + '|' + (vertical ? 1 : 0);
  if (_townSignCache[k]) { return _townSignCache[k]; }
  var cv = UI.townCanvas(vertical ? 128 : 512, vertical ? 512 : 128);
  cv.width = vertical ? 128 : 512;
  cv.height = vertical ? 512 : 128;
  var c = cv.getContext('2d');
  c.fillStyle = bg || '#2a2118';
  c.fillRect(0, 0, cv.width, cv.height);
  c.strokeStyle = 'rgba(255,240,200,0.55)';
  c.lineWidth = 6;
  c.strokeRect(5, 5, cv.width - 10, cv.height - 10);
  c.fillStyle = fg || '#ffe9b0';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = '700 ' + (vertical ? 74 : 68) + 'px "Microsoft YaHei",system-ui,sans-serif';
  if (vertical) {
    var chars = String(text).split('');
    var step = (cv.height - 40) / Math.max(1, chars.length);
    for (var i = 0; i < chars.length; i++) {
      c.fillText(chars[i], cv.width / 2, 20 + step * (i + 0.5));
    }
  } else {
    c.fillText(String(text), cv.width / 2, cv.height / 2 + 4);
  }
  var tex = new THREE.CanvasTexture(cv);
  try { tex.colorSpace = THREE.SRGBColorSpace; } catch (e) {}
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  var mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
  var out = { tex: tex, mat: mat };
  _townSignCache[k] = out;
  return out;
}
function townSignPlane(parent, text, w, h, x, y, z, ry, bg, fg, vertical) {
  var t = townSignTex(text, bg, fg, vertical);
  var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), t.mat);
  m.position.set(x, y, z);
  m.rotation.y = ry || 0;
  m.renderOrder = 2;
  m.userData.sign = true;
  parent.add(m);
  return m;
}
function townSignBoard(parent, text, w, h, x, y, z, ry, bg, fg) {
  var nx = Math.sin(ry || 0), nz = Math.cos(ry || 0);
  townBox(parent, w + 0.16, h + 0.16, 0.10, 0x2f241a, x, y, z, ry);
  townSignPlane(parent, text, w, h, x + nx * 0.07, y, z + nz * 0.07, ry, bg, fg, false);
}

/* 光晕地面（灯光在湿地面上的倒影）*/
var _townPoolMat = null;
function townPoolTex() {
  if (_townPoolMat) { return _townPoolMat; }
  var cv = UI.townCanvas(128, 128);
  var c = cv.getContext('2d');
  var g = c.createRadialGradient(64, 64, 2, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.35, 'rgba(255,240,200,0.55)');
  g.addColorStop(1, 'rgba(255,220,160,0)');
  c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  var tex = new THREE.CanvasTexture(cv);
  _townPoolMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false });
  return _townPoolMat;
}
function townGlowPool(parent, x, z, r, color, op) {
  var m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), townPoolTex());
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.055, z);
  m.material = m.material.clone();
  m.material.color = new THREE.Color(color || 0xffd9a0);
  m.material.opacity = (op === undefined) ? 0.5 : op;
  m.renderOrder = 1;
  m.userData.pool = true;
  parent.add(m);
  return m;
}

function townMix(c1, c2, t) {
  var r1 = (c1 >> 16) & 255, g1 = (c1 >> 8) & 255, b1 = c1 & 255;
  var r2 = (c2 >> 16) & 255, g2 = (c2 >> 8) & 255, b2 = c2 & 255;
  var r = Math.round(r1 + (r2 - r1) * t);
  var g = Math.round(g1 + (g2 - g1) * t);
  var b = Math.round(b1 + (b2 - b1) * t);
  return (r << 16) | (g << 8) | b;
}

/* ============================ 屋顶 ============================ */
/* 现代平屋顶：女儿墙 / 防水卷材 / 太阳能 / 空调 / 屋顶花园 */
function townFlatRoof(parent, b, wallTop) {
  var grp = new THREE.Group();
  grp.userData.noBatch = true;
  parent.add(grp);
  parent = grp;
  TOWN_ROOFS.push({ g: grp, x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1 });
  var x0 = b.x0, x1 = b.x1, z0 = b.z0, z1 = b.z1;
  var cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  var w = (x1 - x0) + 0.55, d = (z1 - z0) + 0.55;
  var slabY = wallTop + 0.10;
  var roofC = townMix(b.roof || 0x77776e, 0x8a8a80, 0.52);
  var edgeC = townMix(b.accent || 0x3d4549, 0x9a9a90, 0.35);
  townBox(parent, w, 0.22, d, roofC, cx, slabY, cz);
  townBox(parent, w - 0.35, 0.04, d - 0.35, 0x5d5d55, cx, slabY + 0.13, cz);
  /* 防水卷材接缝 */
  for (var i = 1; i < 6; i++) {
    townBox(parent, w - 0.4, 0.015, 0.035, 0x4e4e47, cx, slabY + 0.155, z0 + 0.5 + (d - 1.0) * i / 6);
  }
  /* 女儿墙 + 金属压顶 */
  var pw = 0.18, ph = b.tier === 'villa' ? 0.68 : 0.52;
  var py = slabY + 0.11 + ph / 2;
  townBox(parent, w, ph, pw, edgeC, cx, py, z0 - 0.18);
  townBox(parent, w, ph, pw, edgeC, cx, py, z1 + 0.18);
  townBox(parent, pw, ph, d, edgeC, x0 - 0.18, py, cz);
  townBox(parent, pw, ph, d, edgeC, x1 + 0.18, py, cz);
  townBox(parent, w + 0.10, 0.07, pw + 0.06, 0x3e4244, cx, py + ph / 2, z0 - 0.18);
  townBox(parent, w + 0.10, 0.07, pw + 0.06, 0x3e4244, cx, py + ph / 2, z1 + 0.18);
  /* 太阳能板阵列 */
  var solarN = b.tier === 'villa' ? 2 : (b.tier ? 2 : 3);
  for (var si = 0; si < solarN; si++) {
    var sx = cx - (solarN - 1) * 0.85 / 2 + si * 0.85;
    townBox(parent, 0.78, 0.05, 1.25, 0x1f3d56, sx, slabY + 0.44, cz - d * 0.22, 0, 0, -0.22);
    townBox(parent, 0.82, 0.025, 0.04, 0x8a939b, sx, slabY + 0.47, cz - d * 0.22 + 0.55, 0, 0, -0.22);
  }
  /* 空调外机 / 新风机组 */
  for (var ai = 0; ai < 2; ai++) {
    var ax = x0 + 1.3 + ai * 1.1, az = z1 - 1.1;
    townBox(parent, 0.85, 0.55, 0.48, 0x9aa0a4, ax, slabY + 0.40, az);
    townCyl(parent, 0.20, 0.20, 0.04, 0x5f676f, ax, slabY + 0.40, az + 0.25, 12).rotation.x = Math.PI / 2;
  }
  /* 屋顶花园 / 露台 */
  if (b.tier === 'villa' || b.tier === 'flat') {
    var tx0 = cx + w * 0.12, tz0 = z0 + 1.0, tw = w * 0.30, td = d * 0.42;
    townBox(parent, tw, 0.06, td, 0x8a6a48, tx0, slabY + 0.20, tz0 + td / 2);
    for (var pi = 0; pi < 4; pi++) {
      townBox(parent, 0.45, 0.30, 0.35, 0x9a7650, tx0 - tw / 2 + 0.35 + pi * 0.55, slabY + 0.38, tz0 + 0.22);
      townSphere(parent, 0.18, [0x5c8a52, 0xd8708a, 0xe8c060][pi % 3], tx0 - tw / 2 + 0.35 + pi * 0.55, slabY + 0.62, tz0 + 0.22, 0);
    }
    townBox(parent, tw, 0.05, 0.05, 0x8a939b, tx0, slabY + 0.62, tz0 + td);
    townBox(parent, 0.05, 0.05, td, 0x8a939b, tx0 - tw / 2, slabY + 0.62, tz0 + td / 2);
    townBox(parent, 0.05, 0.05, td, 0x8a939b, tx0 + tw / 2, slabY + 0.62, tz0 + td / 2);
  }
  /* 别墅屋顶露台：木平台 / 藤架 / 户外沙发 */
  if (b.tier === 'villa') {
    var dx = cx + w * 0.13, dz = z0 + 1.1;
    townBox(parent, w * 0.34, 0.10, d * 0.52, 0x9a7a56, dx, slabY + 0.22, dz + d * 0.26);
    for (var bi2 = 0; bi2 < 4; bi2++) {
      townBox(parent, 0.09, 2.0, 0.09, 0x6f4c31, dx - w * 0.15 + (bi2 % 2) * w * 0.30, slabY + 1.2, dz + 0.5 + Math.floor(bi2 / 2) * d * 0.42);
      townBox(parent, 0.09, 2.0, 0.09, 0x6f4c31, dx - w * 0.15 + (bi2 % 2) * w * 0.30, slabY + 1.2, dz + 0.5 + Math.floor(bi2 / 2) * d * 0.42);
    }
    townBox(parent, w * 0.36, 0.09, 0.09, 0x6f4c31, dx, slabY + 2.2, dz + d * 0.24);
    townBox(parent, 0.09, 0.09, d * 0.46, 0x6f4c31, dx, slabY + 2.2, dz + d * 0.26);
    townBox(parent, 1.5, 0.28, 0.62, 0x8a8f8a, dx - 0.8, slabY + 0.50, dz + d * 0.22);
    townBox(parent, 0.55, 0.45, 0.70, 0x8a8f8a, dx - 1.65, slabY + 0.55, dz + d * 0.22);
    townBox(parent, 0.55, 0.45, 0.70, 0x8a8f8a, dx + 0.15, slabY + 0.55, dz + d * 0.22);
    townBox(parent, 0.9, 0.08, 0.55, 0x6f4c31, dx - 0.8, slabY + 0.55, dz + d * 0.14);
    for (var gp = 0; gp < 3; gp++) {
      townBox(parent, 0.55, 0.40, 0.40, 0x9a7650, dx + w * 0.13, slabY + 0.33, dz + 0.3 + gp * 0.7);
      townSphere(parent, 0.18, [0x5c8a52, 0xd8708a, 0xe8c060][gp], dx + w * 0.13, slabY + 0.58, dz + 0.3 + gp * 0.7, 0);
    }
  }
  /* 屋顶招牌（店铺） */
  if (b.sign && b.k !== 'hall') {
    var sgx = (b.door === 'east') ? x1 - 1.2 : (b.door === 'west' ? x0 + 1.2 : cx);
    var sgz = (b.door === 'south') ? z1 - 1.2 : (b.door === 'north' ? z0 + 1.2 : cz);
    townBox(parent, 2.1, 0.06, 0.06, 0x3e4244, sgx, slabY + 1.15, sgz);
    townBox(parent, 0.06, 1.15, 0.06, 0x3e4244, sgx - 0.9, slabY + 0.62, sgz);
    townBox(parent, 0.06, 1.15, 0.06, 0x3e4244, sgx + 0.9, slabY + 0.62, sgz);
    townGlow(parent, 1.8, 0.34, 0.06, 0xffe0a8, sgx, slabY + 0.92, sgz, 0.7);
  }
}

function townRoof(parent, b, wallTop) {
  if (b.k !== 'shrine') { townFlatRoof(parent, b, wallTop); return; }
  /* ★ 屋脊方向：垂直街面 → 山墙（三角形）朝向街道 ✓
     日式町屋的经典轮廓，比"顺街一条长坡"更耐看。 */
  var alongX = (b.door === 'east' || b.door === 'west');
  var overEave = 0.55, overGable = 0.22;
  var w = (b.x1 - b.x0) + (alongX ? overGable : overEave) * 2;
  var d = (b.z1 - b.z0) + (alongX ? overEave : overGable) * 2;
  var cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  var grp = new THREE.Group();
  grp.position.set(cx, wallTop, cz);
  grp.userData.noBatch = true;
  parent.add(grp);
  var run = (alongX ? d : w) / 2;
  var ang = (b.k === 'shrine') ? 0.84 : (b.floors === 2 ? 0.70 : 0.78);
  var rise = run * Math.tan(ang);
  var slope = Math.sqrt(run * run + rise * rise) + 0.06;
  var span = (alongX ? w : d);
  var cMain = townMix(b.roof, 0xffffff, 0.10);
  var cDark = townMix(cMain, 0x10140f, 0.30);
  var cLight = townMix(cMain, 0xffffff, 0.13);
  var cTrim = 0x3a2d20;
  function addSlope(sign) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(alongX ? span : slope, 0.09, alongX ? slope : span), matOf(cMain));
    if (alongX) {
      m.position.set(0, rise / 2, sign * run / 2);
      m.rotation.x = sign * ang;
    } else {
      m.position.set(sign * run / 2, rise / 2, 0);
      m.rotation.z = -sign * ang;
    }
    grp.add(m);
  }
  addSlope(1); addSlope(-1);
  /* 顺坡瓦棱 */
  var n = Math.max(4, Math.floor(span / 0.7));
  for (var sgn = -1; sgn <= 1; sgn += 2) {
    for (var i = 1; i < n; i++) {
      var t = -0.5 + i / n;
      var m2 = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 0.055 : slope, 0.032, alongX ? slope : 0.055),
        matOf(i % 2 ? cLight : cDark));
      if (alongX) {
        m2.position.set(t * span, rise / 2 + 0.05, sgn * run / 2);
        m2.rotation.x = sgn * ang;
      } else {
        m2.position.set(sgn * run / 2, rise / 2 + 0.05, t * span);
        m2.rotation.z = -sgn * ang;
      }
      grp.add(m2);
    }
  }
  /* 横向瓦垄（从屋檐到屋脊的层次）*/
  for (var sgn2 = -1; sgn2 <= 1; sgn2 += 2) {
    for (var row = 1; row <= 5; row++) {
      var tt = row / 6;
      var yy = rise * tt + 0.055;
      var zz = sgn2 * run * (1 - tt);
      var bx = new THREE.Mesh(new THREE.BoxGeometry(alongX ? span : 0.075, 0.035, alongX ? 0.075 : span),
        matOf(row % 2 ? cLight : cDark));
      if (alongX) { bx.position.set(0, yy, zz); }
      else { bx.position.set(zz, yy, 0); }
      grp.add(bx);
    }
  }
  /* 屋脊 + 脊端 */
  if (alongX) {
    townBox(grp, span + 0.16, 0.20, 0.28, cTrim, 0, rise + 0.06, 0);
    townBox(grp, span + 0.10, 0.07, 0.38, cLight, 0, rise + 0.19, 0);
    townBox(grp, 0.34, 0.30, 0.34, cTrim, -span / 2 + 0.05, rise + 0.10, 0);
    townBox(grp, 0.34, 0.30, 0.34, cTrim, span / 2 - 0.05, rise + 0.10, 0);
  } else {
    townBox(grp, 0.28, 0.20, span + 0.16, cTrim, 0, rise + 0.06, 0);
    townBox(grp, 0.38, 0.07, span + 0.10, cLight, 0, rise + 0.19, 0);
    townBox(grp, 0.34, 0.30, 0.34, cTrim, 0, rise + 0.10, -span / 2 + 0.05);
    townBox(grp, 0.34, 0.30, 0.34, cTrim, 0, rise + 0.10, span / 2 - 0.05);
  }
  /* 檐口 / 封檐板 / 檐下亮边 */
  if (alongX) {
    townBox(grp, span + 0.12, 0.12, 0.14, cTrim, 0, 0.015, run);
    townBox(grp, span + 0.12, 0.12, 0.14, cTrim, 0, 0.015, -run);
    townBox(grp, span + 0.10, 0.09, 0.10, cLight, 0, 0.12, run);
  } else {
    townBox(grp, 0.14, 0.12, span + 0.12, cTrim, run, 0.015, 0);
    townBox(grp, 0.14, 0.12, span + 0.12, cTrim, -run, 0.015, 0);
    townBox(grp, 0.10, 0.09, span + 0.10, cLight, run, 0.12, 0);
  }
  /* 檐下斜撑：让屋檐有"被托住"的结构感 */
  var bn = Math.max(3, Math.floor(span / 2.2));
  for (var bi = 0; bi < bn; bi++) {
    var bx = -span / 2 + span * (bi + 0.5) / bn;
    for (var bs = -1; bs <= 1; bs += 2) {
      if (alongX) {
        townBox(grp, 0.07, 0.40, 0.07, cTrim, bx, -0.24, bs * (run - 0.44));
        townBox(grp, 0.07, 0.07, 0.58, cTrim, bx, -0.24, bs * (run - 0.20), 0, 0, bs * 0.55);
      } else {
        townBox(grp, 0.07, 0.40, 0.07, cTrim, bs * (run - 0.44), -0.24, bx);
        townBox(grp, 0.58, 0.07, 0.07, cTrim, bs * (run - 0.20), -0.24, bx, 0, bs * 0.55);
      }
    }
  }
  /* 山墙 + 博风板 */
  function gable(sign) {
    var verts = alongX
      ? new Float32Array([sign * span / 2, 0, -run, sign * span / 2, 0, run, sign * span / 2, rise, 0])
      : new Float32Array([-run, 0, sign * span / 2, run, 0, sign * span / 2, 0, rise, sign * span / 2]);
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.computeVertexNormals();
    var m3 = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: townMix(b.wall, 0x2a241c, 0.15), side: THREE.DoubleSide }));
    grp.add(m3);
    /* 山墙通风窗（千鸟破风的感觉）*/
    if (rise > 0.7) {
      if (alongX) {
        townBox(grp, 0.08, 0.52, 0.78, 0x3a2d20, sign * (span / 2 + 0.02), rise * 0.40, 0);
        townBox(grp, 0.05, 0.36, 0.58, 0xffdca6, sign * (span / 2 + 0.07), rise * 0.40, 0);
      } else {
        townBox(grp, 0.78, 0.52, 0.08, 0x3a2d20, 0, rise * 0.40, sign * (span / 2 + 0.02));
        townBox(grp, 0.58, 0.36, 0.05, 0xffdca6, 0, rise * 0.40, sign * (span / 2 + 0.07));
      }
    }
    for (var s2 = -1; s2 <= 1; s2 += 2) {
      var bb = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 0.08 : slope, 0.10, alongX ? slope : 0.08), matOf(cTrim));
      if (alongX) {
        bb.position.set(sign * span / 2, rise / 2, s2 * run / 2);
        bb.rotation.x = s2 * ang;
      } else {
        bb.position.set(s2 * run / 2, rise / 2, sign * span / 2);
        bb.rotation.z = -s2 * ang;
      }
      grp.add(bb);
    }
  }
  gable(1); gable(-1);
  /* 屋顶小物：烟囱 / 通风管 / 天线 / 水箱 */
  var cxk = b.k;
  if (cxk === 'smith' || cxk === 'bathhouse' || cxk === 'cafe' || cxk.indexOf('home_') === 0) {
    var chx = span * 0.26, chz = -run * 0.34;
    var chh = rise * 0.85 + 0.9;
    townBox(grp, 0.46, chh, 0.46, 0x8a6a58, chx, rise * 0.55, chz);
    townBox(grp, 0.58, 0.10, 0.58, 0x4a3b32, chx, rise * 0.55 + chh / 2, chz);
    townBox(grp, 0.22, 0.10, 0.22, 0x2a2622, chx, rise * 0.55 + chh / 2 + 0.08, chz);
  }
  if (cxk === 'post' || cxk === 'koban' || cxk === 'apartment' || cxk === 'hall') {
    var axx = -span * 0.30, azz = run * 0.18;
    townBox(grp, 0.05, 1.7, 0.05, 0x3f454c, axx, rise + 0.85, azz);
    townBox(grp, 0.8, 0.04, 0.04, 0x3f454c, axx, rise + 1.35, azz);
    townBox(grp, 0.55, 0.04, 0.04, 0x3f454c, axx, rise + 1.55, azz);
    townGlow(grp, 0.07, 0.07, 0.07, 0xff5a4a, axx, rise + 1.72, azz, 0.8);
  }
  if (cxk === 'apartment' || cxk === 'warehouse') {
    townCyl(grp, 0.42, 0.46, 0.75, 0x9aa0a4, span * 0.24, rise + 0.55, -run * 0.2, 12);
    for (var lg = -1; lg <= 1; lg += 2) {
      townBox(grp, 0.07, 0.45, 0.07, 0x5f676f, span * 0.24 + lg * 0.28, rise + 0.22, -run * 0.2 + 0.22);
      townBox(grp, 0.07, 0.45, 0.07, 0x5f676f, span * 0.24 + lg * 0.28, rise + 0.22, -run * 0.2 - 0.22);
    }
  }
  if (cxk === 'mart' || cxk === 'ramen' || cxk === 'izakaya' || cxk === 'general') {
    townCyl(grp, 0.20, 0.24, 0.45, 0x8b939b, -span * 0.2, rise + 0.25, run * 0.10, 10);
    townBox(grp, 0.52, 0.08, 0.52, 0x5f676f, -span * 0.2, rise + 0.50, run * 0.10);
  }
  /* 屋檐下的小灯 */
  if (cxk !== 'home_a' && cxk !== 'home_b' && cxk !== 'home_c' && cxk !== 'home_d') {
    townGlow(grp, 0.18, 0.09, 0.18, 0xffd9a0, alongX ? 0 : run * 0.55, -0.12, alongX ? run * 0.55 : 0, 0.6);
  }
  if (b.k !== 'home_a' && b.k !== 'home_b' && b.k !== 'home_c' && b.k !== 'home_d') {
    var gx = 0, gz = 0;
    if (b.door === 'east') { gx = span / 2 + 0.20; }
    else if (b.door === 'west') { gx = -span / 2 - 0.20; }
    else if (b.door === 'south') { gz = span / 2 + 0.20; }
    else { gz = -span / 2 - 0.20; }
    townGlow(grp, 0.18, 0.26, 0.18, 0xff9a5a, gx, 0.10, gz, 0.9);
    townBox(grp, 0.04, 0.25, 0.04, 0x3a2d20, gx, 0.32, gz);
  }
  if (typeof townBatchGroup === 'function') { townBatchGroup(grp); }
  TOWN_ROOFS.push({ g: grp, x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1 });
  return grp;
}

/* 小坡檐（门头 / 窗檐）*/
function townMiniRoof(parent, w, d, color, x, y, z, ry) {
  var g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry || 0;
  g.userData.noBatch = true;
  parent.add(g);
  var rise = 0.22, run = d / 2;
  for (var s = -1; s <= 1; s += 2) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, Math.sqrt(run * run + rise * rise)), matOf(color));
    m.position.set(0, rise / 2, s * run / 2);
    m.rotation.x = s * Math.atan2(rise, run);
    g.add(m);
  }
  townBox(g, w + 0.16, 0.08, 0.12, 0x3b3127, 0, 0.02, run);
  townBox(g, w + 0.16, 0.08, 0.12, 0x3b3127, 0, 0.02, -run);
  if (typeof townBatchGroup === 'function') { townBatchGroup(g); }
  return g;
}

/* ============================ 墙体 / 门窗 ============================ */
function townWallStyle(parent, x0, z0, x1, z1, b, hTop) {
  var w = x1 - x0, d = z1 - z0;
  var cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  var st = b.style;
  townBox(parent, Math.max(0.40, w + 0.04), 0.46, Math.max(0.40, d + 0.04), 0x8b8474, cx, 0.23, cz);
  townBox(parent, Math.max(0.38, w), hTop - 0.46, Math.max(0.38, d), townMix(b.wall, 0xffd9a8, 0.10), cx, 0.46 + (hTop - 0.46) / 2, cz);
  var horiz = Math.abs(w) >= Math.abs(d);
  var len = horiz ? Math.abs(w) : Math.abs(d);
  /* 木构架 */
  var beam = (st === 'western' || st === 'brick' || st === 'ware') ? 0x5a4634 : 0x4a3423;
  var n = Math.max(1, Math.min(10, Math.floor(len / 1.5)));
  for (var i = 1; i < n; i++) {
    var t = i / n;
    townBox(parent, horiz ? 0.10 : 0.10, hTop - 0.5, horiz ? 0.10 : 0.10, beam,
      horiz ? x0 + w * t : cx, 0.48 + (hTop - 0.5) / 2, horiz ? cz : z0 + d * t);
  }
  townBox(parent, horiz ? Math.abs(w) : 0.10, 0.10, horiz ? 0.10 : Math.abs(d), beam,
    cx, hTop - 0.10, cz);
  townBox(parent, horiz ? Math.abs(w) : 0.08, 0.08, horiz ? 0.08 : Math.abs(d), beam,
    cx, 1.02, cz);
  if (st === 'wood' || st === 'izakaya') {
    /* 竖向木板 */
    for (var q = 0; q < Math.floor(len / 0.34); q++) {
      var u = (q + 0.5) / Math.max(1, Math.floor(len / 0.34));
      townBox(parent, horiz ? 0.30 : 0.06, hTop - 0.55, horiz ? 0.06 : 0.30, 0x6f4c31,
        horiz ? x0 + w * u : cx, 0.46 + (hTop - 0.55) / 2, horiz ? cz : z0 + d * u);
    }
  } else if (st === 'brick') {
    for (var r = 0; r < 6; r++) {
      townBox(parent, horiz ? Math.abs(w) : 0.11, 0.035, horiz ? 0.11 : Math.abs(d), 0x9a6f52,
        cx, 0.62 + r * 0.34, cz);
    }
  } else if (st === 'ware') {
    for (var v = 0; v < Math.floor(len / 0.42); v++) {
      var u2 = (v + 0.5) / Math.max(1, Math.floor(len / 0.42));
      townBox(parent, horiz ? 0.06 : 0.05, hTop - 0.55, horiz ? 0.05 : 0.06, 0x8f8f84,
        horiz ? x0 + w * u2 : cx, 0.46 + (hTop - 0.55) / 2, horiz ? cz : z0 + d * u2);
    }
  }
  /* 檐下阴影带 / 墙脚压暗：给平墙加层次 */
  townBox(parent, Math.abs(w) + 0.02, 0.30, Math.abs(d) + 0.02,
    townMix(b.wall, 0x000000, 0.30), cx, hTop - 0.30, cz);
  townBox(parent, Math.abs(w) + 0.02, 0.10, Math.abs(d) + 0.02,
    townMix(b.wall, 0x000000, 0.18), cx, 0.52, cz);
}

function townWallSeg(parent, x0, z0, x1, z1, b, hTop) {
  var w = x1 - x0, d = z1 - z0;
  if (Math.abs(w) < 0.01 && Math.abs(d) < 0.01) { return; }
  var cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  townWallStyle(parent, x0, z0, x1, z1, b, hTop);
  /* 压顶木梁 */
  townBox(parent, Math.max(0.40, Math.abs(w)), 0.10, Math.max(0.40, Math.abs(d)), 0x3f2d1e, cx, hTop + 0.03, cz);
}
function townWindow(parent, x, y, z, w, h, ry, lit) {
  var nx = Math.sin(ry || 0), nz = Math.cos(ry || 0);
  /* ★ 整扇窗沿法线往外挪 12cm：不挪会埋进 38cm 厚的墙里 */
  x += nx * 0.14; z += nz * 0.14;
  var alongX = Math.abs(nx) < 0.5;    /* true = 窗在南北墙，宽度沿 X */
  var frame = 0x4a3423;
  var fw = alongX ? w : 0.10;
  var fd = alongX ? 0.10 : w;
  /* 玻璃 / 暖光 */
  if (lit) {
    townGlow(parent, alongX ? w : 0.06, h, alongX ? 0.06 : w, 0xffdca6,
      x + nx * 0.03, y, z + nz * 0.03, 0.34);
  } else {
    townBox(parent, alongX ? w : 0.06, h, alongX ? 0.06 : w, 0x86aab4, x, y, z);
  }
  /* 四边窗框（不是一整块实心盒子）*/
  townBox(parent, alongX ? w + 0.18 : 0.14, 0.08, alongX ? 0.14 : w + 0.18, frame,
    x, y + h / 2 + 0.04, z);
  townBox(parent, alongX ? w + 0.18 : 0.14, 0.08, alongX ? 0.14 : w + 0.18, frame,
    x, y - h / 2 - 0.04, z);
  townBox(parent, alongX ? 0.08 : 0.14, h + 0.16, alongX ? 0.14 : 0.08, frame,
    x - (alongX ? w / 2 + 0.04 : 0), y, z - (alongX ? 0 : w / 2 + 0.04));
  townBox(parent, alongX ? 0.08 : 0.14, h + 0.16, alongX ? 0.14 : 0.08, frame,
    x + (alongX ? w / 2 + 0.04 : 0), y, z + (alongX ? 0 : w / 2 + 0.04));
  /* 中挺 */
  townBox(parent, alongX ? 0.045 : 0.10, h, alongX ? 0.10 : 0.045, frame,
    x + nx * 0.04, y, z + nz * 0.04);
  /* 窗台 */
  townBox(parent, alongX ? w + 0.24 : 0.26, 0.09, alongX ? 0.26 : w + 0.24, 0x6b5844,
    x + nx * 0.02, y - h / 2 - 0.12, z + nz * 0.02);
}

function townWindows(parent, b, hTop, doorSide, doorAt) {
  var sides = ['north', 'south', 'east', 'west'];
  var floors = b.floors === 2 ? 2 : 1;
  for (var f = 0; f < floors; f++) {
    var wy = floors === 2 ? (f === 0 ? 1.35 : 3.45) : 1.42;
    for (var si = 0; si < sides.length; si++) {
      var side = sides[si];
      if (side === doorSide && f === 0) { continue; }
      var n = 2;
      for (var i = 0; i < n; i++) {
        var t = (i === 0) ? 0.28 : 0.72;
        if (side === 'south' || side === 'north') {
          var x = b.x0 + (b.x1 - b.x0) * t;
          if (Math.abs(x - doorAt) < 1.9 && side === doorSide) { continue; }
          townWindow(parent, x, wy, side === 'south' ? b.z1 : b.z0, 0.95, 0.82, side === 'south' ? 0 : Math.PI, true);
        } else {
          var z = b.z0 + (b.z1 - b.z0) * t;
          if (Math.abs(z - doorAt) < 1.9 && side === doorSide) { continue; }
          townWindow(parent, side === 'east' ? b.x1 : b.x0, wy, z, 0.95, 0.82,
            side === 'east' ? Math.PI / 2 : -Math.PI / 2, true);
        }
      }
    }
  }
}

/* 橱窗：暖光玻璃 + 木框 + 窗台 + 陈列剪影 */
function townShopWindow(parent, x, z, ry, w, h, display) {
  var nx = Math.sin(ry || 0), nz = Math.cos(ry || 0);
  var alongX = Math.abs(nx) < 0.5;
  x += nx * 0.14; z += nz * 0.14;
  var frame = 0x3a2d20;
  /* 暖光玻璃 */
  townGlow(parent, alongX ? w : 0.06, h, alongX ? 0.06 : w, 0xffe2b0,
    x + nx * 0.02, 1.32, z + nz * 0.02, 0.55);
  /* 四边木框 */
  townBox(parent, alongX ? w + 0.18 : 0.14, 0.09, alongX ? 0.14 : w + 0.18, frame,
    x, 1.32 + h / 2 + 0.04, z);
  townBox(parent, alongX ? w + 0.18 : 0.14, 0.09, alongX ? 0.14 : w + 0.18, frame,
    x, 1.32 - h / 2 - 0.04, z);
  townBox(parent, alongX ? 0.09 : 0.14, h + 0.18, alongX ? 0.14 : 0.09, frame,
    x - (alongX ? w / 2 + 0.045 : 0), 1.32, z - (alongX ? 0 : w / 2 + 0.045));
  townBox(parent, alongX ? 0.09 : 0.14, h + 0.18, alongX ? 0.14 : 0.09, frame,
    x + (alongX ? w / 2 + 0.045 : 0), 1.32, z + (alongX ? 0 : w / 2 + 0.045));
  townBox(parent, alongX ? 0.05 : 0.11, h, alongX ? 0.11 : 0.05, frame,
    x + nx * 0.04, 1.32, z + nz * 0.04);
  /* 窗台 */
  townBox(parent, alongX ? w + 0.24 : 0.18, 0.12, alongX ? 0.18 : w + 0.24,
    0x6b4a32, x + nx * 0.03, 1.32 - h / 2 - 0.10, z + nz * 0.03);
  /* 陈列剪影（贴在玻璃前面一点，逆光看出货架）*/
  var dCols = display === 'book' ? [0x9a4a3a, 0x3e5968, 0x5c6b46, 0xb08a45]
    : display === 'bread' ? [0xd8a45a, 0xc98a44, 0xe0b878]
    : display === 'flower' ? [0xe06a8a, 0xf0d060, 0xd85a5a]
    : display === 'cake' ? [0xe08aa8, 0xf0d060, 0x8fd6ff]
    : [0xff8f7a, 0x8fd6ff, 0xffe08a, 0x9ff0b0];
  for (var r = 0; r < 2; r++) {
    townBox(parent, alongX ? w * 0.82 : 0.04, 0.025, alongX ? 0.04 : w * 0.82,
      0x5a4634, x + nx * 0.07, 1.02 + r * 0.36, z + nz * 0.07);
    for (var q = 0; q < 4; q++) {
      var off = -w * 0.34 + q * (w * 0.68 / 3);
      var bx = x + nx * 0.08 + (alongX ? off : 0);
      var bz = z + nz * 0.08 + (alongX ? 0 : off);
      townBox(parent, alongX ? 0.14 : 0.04, 0.15, alongX ? 0.04 : 0.14,
        dCols[(q + r) % dCols.length], bx, 1.12 + r * 0.36, bz);
    }
  }
}
/* 垂直侧招牌（垂直于墙面，街道上远远能看见）*/
function townBladeSign(parent, text, nx, nz, x, z, y, bg, fg) {
  var px = x + nx * 0.55, pz = z + nz * 0.55;
  townBox(parent, nx ? 0.90 : 0.10, 1.25, nz ? 0.90 : 0.10, 0x2a2118, px, y, pz);
  townBox(parent, nx ? 0.80 : 0.045, 0.08, nz ? 0.80 : 0.045, 0x3a2d20, px, y + 0.68, pz);
  townBox(parent, 0.06, 0.90, 0.06, 0x3a2d20, x + nx * 0.20, y + 0.20, z + nz * 0.20);
  if (nx) {
    townSignPlane(parent, text, 0.66, 1.10, px, y, pz + 0.058, 0, bg, fg, true);
    townSignPlane(parent, text, 0.66, 1.10, px, y, pz - 0.058, Math.PI, bg, fg, true);
  } else {
    townSignPlane(parent, text, 0.66, 1.10, px + 0.058, y, pz, Math.PI / 2, bg, fg, true);
    townSignPlane(parent, text, 0.66, 1.10, px - 0.058, y, pz, -Math.PI / 2, bg, fg, true);
  }
}
var TOWN_SHOP_STYLE = {
  mart: ['便利店', '#163a25', '#7dffa8'],
  ramen: ['拉面', '#3a1410', '#ffb070'],
  izakaya: ['酒', '#3a0f0c', '#ff8a6a'],
  cafe: ['CAFE', '#1f2a2a', '#8fe8ff'],
  bakery: ['面包', '#3a2414', '#ffd08a'],
  bookstore: ['书', '#1a2a3a', '#8fc8ff'],
  flower: ['花', '#173a2a', '#a8ffc8'],
  dessert: ['甘味', '#3a1a2a', '#ffb0d0'],
  general: ['杂货', '#2a2a1a', '#ffe08a'],
  bathhouse: ['ゆ', '#0f2a2a', '#8fe8e0'],
  post: ['邮', '#2a1a14', '#ffb08a'],
  koban: ['交番', '#1a2430', '#8fc8ff'],
  clinic: ['药', '#1a2a1a', '#a8e8a8'],
  smith: ['锻', '#2a1a10', '#ffb060'],
  tea: ['茶', '#1f2a1a', '#c8ffb0'],
  warehouse: ['仓', '#2a2418', '#ffe0a0']
};
function townShopKind(k) { return !!TOWN_SHOP_STYLE[k]; }
function townStorefront(parent, b, dp) {
  var nx = dp.nx, nz = dp.nz, ry = dp.ry;
  var alongX = Math.abs(nz) > 0.5;
  var lo = alongX ? b.x0 + 0.42 : b.z0 + 0.42;
  var hi = alongX ? b.x1 - 0.42 : b.z1 - 0.42;
  var wallC = alongX ? (nz > 0 ? b.z1 : b.z0) : (nx > 0 ? b.x1 : b.x0);
  var at = b.door_at;
  var style = TOWN_SHOP_STYLE[b.k] || ['', '#2a2118', '#ffe9b0'];
  /* 墙裙 */
  var len = hi - lo;
  townBox(parent, alongX ? len : 0.10, 0.34, alongX ? 0.10 : len, 0x6b4a32,
    alongX ? (lo + hi) / 2 : wallC + nx * 0.06, 0.56,
    alongX ? wallC + nz * 0.06 : (lo + hi) / 2, ry);
  /* 招牌下沿木线 */
  townBox(parent, alongX ? len : 0.12, 0.10, alongX ? 0.12 : len, 0x3a2d20,
    alongX ? (lo + hi) / 2 : wallC + nx * 0.07, 2.30,
    alongX ? wallC + nz * 0.07 : (lo + hi) / 2, ry);
  /* 两扇橱窗 */
  var offs = [-1.95, 1.95];
  var display = b.k === 'bookstore' ? 'book' : (b.k === 'bakery' ? 'bread'
    : (b.k === 'flower' ? 'flower' : (b.k === 'dessert' ? 'cake' : 'goods')));
  for (var i = 0; i < offs.length; i++) {
    var c = at + offs[i];
    if (c - 0.78 < lo || c + 0.78 > hi) { continue; }
    if (Math.abs(offs[i]) < 1.55) { continue; }
    var wx = alongX ? c : wallC + nx * 0.10;
    var wz = alongX ? wallC + nz * 0.10 : c;
    townShopWindow(parent, wx, wz, ry, 1.42, 1.05, display);
    /* 窗台花箱 */
    townBox(parent, alongX ? 1.30 : 0.24, 0.20, alongX ? 0.24 : 1.30, 0x8a5f42,
      alongX ? c : wallC + nx * 0.18, 0.70, alongX ? wallC + nz * 0.18 : c, ry);
    for (var f = 0; f < 4; f++) {
      townSphere(parent, 0.11, [0x5c8a52, 0xd8708a, 0xe8c060][f % 3],
        alongX ? c - 0.45 + f * 0.30 : wallC + nx * 0.18,
        0.83, alongX ? wallC + nz * 0.18 : c - 0.45 + f * 0.30, 0);
    }
  }
  /* 墙面海报 / 告示（把大面积空墙打散）*/
  var posters = [[-3.1, 0xe8dcc8, 0x9a4a3a], [2.9, 0xdfe8f2, 0x3e5968]];
  for (var pp = 0; pp < posters.length; pp++) {
    var pc = at + posters[pp][0];
    if (pc < lo + 0.3 || pc > hi - 0.3) { continue; }
    var ppx = alongX ? pc : wallC + nx * 0.075;
    var ppz = alongX ? wallC + nz * 0.075 : pc;
    townBox(parent, alongX ? 0.52 : 0.06, 0.72, alongX ? 0.06 : 0.52, 0x3a2d20, ppx, 1.66, ppz, ry);
    townBox(parent, alongX ? 0.44 : 0.045, 0.62, alongX ? 0.045 : 0.44, posters[pp][1], ppx, 1.66, ppz, ry);
    townBox(parent, alongX ? 0.20 : 0.05, 0.30, alongX ? 0.05 : 0.20, posters[pp][2],
      ppx + nx * 0.03, 1.72, ppz + nz * 0.03, ry);
    townBox(parent, alongX ? 0.28 : 0.05, 0.05, alongX ? 0.05 : 0.28, 0x5a4634,
      ppx + nx * 0.03, 1.42, ppz + nz * 0.03, ry);
  }
  /* 侧招牌 */
  if (style[0]) {
    var bc = at + 2.55;
    if (bc > lo && bc < hi) {
      townBladeSign(parent, style[0], nx, nz,
        alongX ? bc : wallC + nx * 0.10, alongX ? wallC + nz * 0.10 : bc,
        1.95, style[1], style[2]);
    }
  }
  /* 壁灯 / 灯串 */
  for (var l = 0; l < 2; l++) {
    var lc = at + (l ? 1.75 : -1.75);
    if (lc < lo || lc > hi) { continue; }
    var lx = alongX ? lc : wallC + nx * 0.16;
    var lz = alongX ? wallC + nz * 0.16 : lc;
    townBox(parent, 0.06, 0.26, 0.06, 0x3a2d20, lx, 1.98, lz);
    townGlow(parent, 0.20, 0.24, 0.20, 0xffd9a0, lx, 1.82, lz, 0.85);
    townBox(parent, 0.28, 0.06, 0.28, 0x3a2d20, lx, 1.98, lz);
  }
  /* 地面暖光 */
  var px = alongX ? at : wallC + nx * 0.95;
  var pz = alongX ? wallC + nz * 0.95 : at;
  townGlowPool(parent, px, pz, 1.9, 0xffcf8a, 0.34);
  /* 行业专属细节 */
  if (b.k === 'mart') {
    townBox(parent, alongX ? len : 0.14, 0.24, alongX ? 0.14 : len, 0x4fae6f,
      alongX ? (lo + hi) / 2 : wallC + nx * 0.10, 2.16,
      alongX ? wallC + nz * 0.10 : (lo + hi) / 2, ry);
  } else if (b.k === 'izakaya' || b.k === 'ramen') {
    for (var q = 0; q < 2; q++) {
      var qx = alongX ? at + (q ? 1.55 : -1.55) : wallC + nx * 0.35;
      var qz = alongX ? wallC + nz * 0.35 : at + (q ? 1.55 : -1.55);
      townGlow(parent, 0.22, 0.32, 0.22, 0xff5a3a, qx, 2.02, qz, 0.9);
      townBox(parent, 0.26, 0.06, 0.26, 0x2a2118, qx, 2.22, qz);
    }
  } else if (b.k === 'flower') {
    for (var p2 = 0; p2 < 3; p2++) {
      var hx = alongX ? at - 1.6 + p2 * 1.6 : wallC + nx * 0.30;
      var hz = alongX ? wallC + nz * 0.30 : at - 1.6 + p2 * 1.6;
      townCyl(parent, 0.18, 0.14, 0.26, 0x8a6a48, hx, 2.20, hz, 8);
      townSphere(parent, 0.20, [0xe06a8a, 0xf0d060, 0xd85a5a][p2], hx, 2.38, hz, 0);
    }
  } else if (b.k === 'bathhouse') {
    for (var v = 0; v < 5; v++) {
      var vx = alongX ? at - 1.4 + v * 0.7 : wallC + nx * 0.09;
      var vz = alongX ? wallC + nz * 0.09 : at - 1.4 + v * 0.7;
      townBox(parent, alongX ? 0.06 : 0.09, 1.9, alongX ? 0.09 : 0.06, 0x6b4a32,
        vx, 1.30, vz, ry);
    }
  }
}

/* 门：门框 + 半开的木门 + 台阶 + 灯笼 + 暖光 */
function townDoor(parent, b, hTop, side, at) {
  var isX = (side === 'east' || side === 'west');
  var dx = (side === 'east') ? b.x1 : (side === 'west' ? b.x0 : at);
  var dz = (side === 'south') ? b.z1 : (side === 'north' ? b.z0 : at);
  var nx = (side === 'east') ? 1 : (side === 'west' ? -1 : 0);
  var nz = (side === 'south') ? 1 : (side === 'north' ? -1 : 0);
  var ry = isX ? Math.PI / 2 : 0;
  /* 门框 */
  townBox(parent, isX ? 0.16 : 0.16, 2.15, isX ? 0.16 : 0.16, 0x3f2d1e,
    dx + (isX ? 0 : -1.28), 1.075, dz + (isX ? -1.28 : 0));
  townBox(parent, isX ? 0.16 : 0.16, 2.15, isX ? 0.16 : 0.16, 0x3f2d1e,
    dx + (isX ? 0 : 1.28), 1.075, dz + (isX ? 1.28 : 0));
  townBox(parent, isX ? 0.18 : 2.72, 0.18, isX ? 2.72 : 0.18, 0x3f2d1e, dx, 2.18, dz);
  /* door: glass leaf removed per user request (keep plain doorway) */
  /* 台阶 */
  townBox(parent, isX ? 0.72 : 2.5, 0.14, isX ? 2.5 : 0.72, 0x9a9688,
    dx + nx * 0.40, 0.08, dz + nz * 0.40);
  townBox(parent, isX ? 0.54 : 2.3, 0.07, isX ? 2.3 : 0.54, 0x7d786c,
    dx + nx * 0.82, 0.035, dz + nz * 0.82);
  /* 门口地面暖光（不再在门洞里放发光板） */
  townGlowPool(parent, dx + nx * 0.95, dz + nz * 0.95, 1.5, 0xffcf8a, 0.38);
  /* 门灯 */
  [-1.45, 1.45].forEach(function (o) {
    var lx = isX ? dx + nx * 0.24 : at + o;
    var lz = isX ? at + o : dz + nz * 0.24;
    townBox(parent, 0.08, 0.48, 0.08, 0x3f2d1e, lx, 1.92, lz);
    townGlow(parent, 0.26, 0.30, 0.26, 0xffe0a8, lx, 1.72, lz, 0.85);
    townBox(parent, 0.36, 0.07, 0.36, 0x3f2d1e, lx, 1.91, lz);
  });
  return { x: dx, z: dz, nx: nx, nz: nz, isX: isX, ry: ry };
}

/* 雨棚（条纹）*/
function townAwning(parent, x, y, z, w, d, ry, c1, c2) {
  var g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry || 0; parent.add(g);
  var n = 8;
  for (var i = 0; i < n; i++) {
    townBox(g, w / n, 0.07, d, (i % 2 ? c2 : c1), -w / 2 + w / n * (i + 0.5), 0, 0);
  }
  townBox(g, w + 0.10, 0.10, 0.08, 0x4a3423, 0, -0.03, d / 2);
  townBox(g, 0.07, 0.55, 0.07, 0x4a3423, -w / 2 + 0.10, -0.28, d / 2 - 0.10);
  townBox(g, 0.07, 0.55, 0.07, 0x4a3423, w / 2 - 0.10, -0.28, d / 2 - 0.10);
  /* 波浪边 */
  for (var q = 0; q < n; q++) {
    townBox(g, w / n, 0.14, 0.05, (q % 2 ? c2 : c1), -w / 2 + w / n * (q + 0.5), -0.06, d / 2 + 0.02);
  }
}

/* 暖帘 / 招牌布 */
function townNoren(parent, x, y, z, w, ry, color, text) {
  var g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry || 0; parent.add(g);
  var n = text ? 3 : 2;
  for (var i = 0; i < n; i++) {
    townBox(g, w / n - 0.04, 0.62, 0.035, color, -w / 2 + w / n * (i + 0.5), -0.31, 0);
  }
  townBox(g, w + 0.18, 0.05, 0.05, 0x3b2a1c, 0, 0.02, 0);
  if (text) { townSignPlane(g, text, w * 0.92, 0.42, 0, -0.32, 0.035, 0, '#8d2b23', '#ffe9c0'); }
  return g;
}

/* ============================ 室内 ============================ */
/* 现代别墅室内：客餐厅 / 开放厨房 / 主卧 / 卫浴 / 楼梯 / 二楼 */
function townVillaInterior(parent, b) {
  var x0 = b.x0, x1 = b.x1, z0 = b.z0, z1 = b.z1;
  var cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  var wood = 0x6f4c31, dark = 0x3d3430, stone = 0x9a968a, steel = 0x9aa3a8;
  var at = b.door_at;
  townPlane(parent, 4.4, 3.4, 0xc8b8a0, x1 - 3.2, 0.10, z1 - 3.6);
  townBox(parent, 3.0, 0.55, 0.85, 0x8a8f8a, x1 - 2.4, 0.38, z1 - 2.2);
  townBox(parent, 3.0, 0.38, 0.28, 0x8a8f8a, x1 - 2.4, 0.78, z1 - 2.55);
  townBox(parent, 0.85, 0.55, 2.0, 0x8a8f8a, x1 - 3.8, 0.38, z1 - 3.3);
  townBox(parent, 1.6, 0.42, 0.85, 0x6f4c31, x1 - 2.4, 0.28, z1 - 3.8);
  townBox(parent, 1.7, 0.06, 0.9, 0xd8cbb4, x1 - 2.4, 0.53, z1 - 3.8);
  townBox(parent, 1.8, 0.55, 0.30, dark, x1 - 0.55, 0.80, z1 - 3.7);
  townBox(parent, 1.55, 0.85, 0.06, 0x1f2b30, x1 - 0.55, 1.25, z1 - 3.72);
  townGlow(parent, 1.35, 0.70, 0.04, 0x8fd6ff, x1 - 0.55, 1.25, z1 - 3.78, 0.45);
  townBox(parent, 0.22, 1.65, 0.22, steel, x1 - 3.9, 0.82, z1 - 4.6);
  townCyl(parent, 0.30, 0.24, 0.32, 0xe8dcc8, x1 - 3.9, 1.72, z1 - 4.6, 12);
  townGlow(parent, 0.24, 0.24, 0.24, 0xffe0a8, x1 - 3.9, 1.72, z1 - 4.6, 0.6);
  townBox(parent, 1.7, 1.9, 0.34, wood, x1 - 0.45, 1.0, z1 - 1.0);
  for (var lb = 0; lb < 4; lb++) {
    townBox(parent, 1.5, 0.05, 0.26, 0x5a4634, x1 - 0.55, 0.38 + lb * 0.42, z1 - 1.0);
    for (var bk = 0; bk < 6; bk++) {
      townBox(parent, 0.14, 0.24, 0.20, [0x9a4a3a, 0x3e5968, 0x5c6b46, 0xb08a45][(bk + lb) % 4], x1 - 1.2 + bk * 0.24, 0.48 + lb * 0.42, z1 - 1.0);
    }
  }
  townSolid(x1 - 3.9, z1 - 2.6, x1 - 0.8, z1 - 1.9);
  townBox(parent, 2.6, 0.08, 1.0, 0x9a7650, cx - 0.6, 0.74, cz + 1.0);
  townBox(parent, 0.16, 0.72, 0.70, 0x4a3423, cx - 1.6, 0.37, cz + 1.0);
  townBox(parent, 0.16, 0.72, 0.70, 0x4a3423, cx + 0.4, 0.37, cz + 1.0);
  for (var ci = 0; ci < 6; ci++) {
    var cxx = cx - 1.4 + (ci % 3) * 0.9;
    var czz = cz + 0.35 + Math.floor(ci / 3) * 1.3;
    townBox(parent, 0.42, 0.06, 0.42, 0x6f4c31, cxx, 0.46, czz);
    townBox(parent, 0.06, 0.44, 0.06, 0x4a3423, cxx - 0.16, 0.23, czz - 0.16);
    townBox(parent, 0.06, 0.44, 0.06, 0x4a3423, cxx + 0.16, 0.23, czz - 0.16);
    townBox(parent, 0.06, 0.44, 0.06, 0x4a3423, cxx - 0.16, 0.23, czz + 0.16);
    townBox(parent, 0.06, 0.44, 0.06, 0x4a3423, cxx + 0.16, 0.23, czz + 0.16);
  }
  townCyl(parent, 0.36, 0.30, 0.14, 0x3d3430, cx - 0.6, 2.55, cz + 1.0, 12);
  townGlow(parent, 0.28, 0.10, 0.28, 0xffe0a8, cx - 0.6, 2.48, cz + 1.0, 0.8);
  townSolid(cx - 2.0, cz + 0.4, cx + 0.8, cz + 1.6);
  var kx = x0 + 2.4, kz = z0 + 2.4;
  for (var kc = 0; kc < 3; kc++) {
    townBox(parent, 0.75, 0.90, 3.6, 0xd8d2c4, x0 + 0.55, 0.45, z0 + 1.3 + kc * 1.25);
    townBox(parent, 0.70, 0.06, 3.4, 0x5a4634, x0 + 0.55, 0.92, z0 + 1.3 + kc * 1.25);
  }
  townBox(parent, 6.0, 0.10, 1.3, 0xe8e0d0, kx, 0.92, kz);
  townBox(parent, 5.8, 0.90, 1.2, 0xbfc4c6, kx, 0.46, kz);
  townBox(parent, 1.0, 0.06, 0.8, 0x2f3438, kx + 1.2, 0.98, kz);
  for (var bu = 0; bu < 4; bu++) { townCyl(parent, 0.13, 0.13, 0.03, 0x1f2326, kx + 0.8 + (bu % 2) * 0.5, 1.02, kz - 0.2 + Math.floor(bu / 2) * 0.4, 10); }
  townBox(parent, 0.95, 1.9, 0.75, 0xbfc4c6, x1 - 1.1, 0.95, z0 + 0.85);
  townBox(parent, 0.90, 0.10, 0.70, 0x3d4549, x1 - 1.1, 1.92, z0 + 0.85);
  townBox(parent, 1.4, 0.65, 0.45, 0x9aa3a8, kx + 0.2, 2.25, kz - 0.5);
  townGlow(parent, 0.55, 0.08, 0.30, 0xffd9a0, kx + 0.2, 2.00, kz - 0.5, 0.8);
  townBox(parent, 1.2, 0.05, 0.55, 0x7fa8b8, kx - 1.5, 0.99, kz);
  townSolid(x0 + 0.2, z0 + 1.0, x0 + 1.0, z0 + 5.2);
  townSolid(kx - 3.1, kz - 0.7, kx + 3.1, kz + 0.7);
  var bx = x0 + 3.0, bz = z1 - 2.8;
  townPlane(parent, 4.2, 3.6, 0x8a7a68, bx, 0.10, bz);
  townBox(parent, 2.2, 0.45, 1.75, 0x6f4c31, bx, 0.30, bz);
  townBox(parent, 2.1, 0.22, 1.65, 0xe8e0d0, bx, 0.61, bz);
  townBox(parent, 2.1, 0.10, 0.55, 0xd8cbb4, bx, 0.74, bz - 0.55);
  townBox(parent, 2.2, 0.85, 0.16, 0x5a4634, bx, 0.62, bz - 0.95);
  townBox(parent, 0.58, 0.45, 0.45, 0x8a6a48, bx - 1.55, 0.34, bz - 0.6);
  townBox(parent, 0.58, 0.45, 0.45, 0x8a6a48, bx + 1.55, 0.34, bz - 0.6);
  townCyl(parent, 0.15, 0.12, 0.28, 0xe8dcc8, bx - 1.55, 0.72, bz - 0.6, 10);
  townCyl(parent, 0.15, 0.12, 0.28, 0xe8dcc8, bx + 1.55, 0.72, bz - 0.6, 10);
  townBox(parent, 1.7, 2.1, 0.62, 0x9a8a74, x0 + 0.95, 1.05, bz + 1.7);
  for (var wd = 0; wd < 2; wd++) { townBox(parent, 0.06, 0.40, 0.06, 0x3d3430, x0 + 1.05 + wd * 1.3, 1.15, bz + 1.95); }
  townBox(parent, 1.2, 0.75, 0.45, 0x8a6a48, bx + 1.9, 0.42, bz + 1.6);
  townBox(parent, 1.0, 0.8, 0.05, 0xbfe4ea, bx + 1.9, 1.05, bz + 1.82);
  townSolid(bx - 1.2, bz - 1.0, bx + 1.2, bz + 1.0);
  var wx = x1 - 2.6, wz = z0 + 2.5;
  townPlane(parent, 3.8, 3.2, 0x9aa3a8, wx, 0.10, wz);
  townBox(parent, 1.7, 0.55, 0.85, 0xe8f0f0, wx - 0.4, 0.30, wz - 0.9);
  townBox(parent, 1.5, 0.15, 0.65, 0xbfe4ea, wx - 0.4, 0.50, wz - 0.9);
  townBox(parent, 0.55, 0.60, 0.75, 0xf0f0e8, wx + 1.4, 0.30, wz - 0.9);
  townBox(parent, 0.45, 0.18, 0.55, 0xd8e0e0, wx + 1.4, 0.48, wz - 1.05);
  townBox(parent, 1.5, 0.80, 0.55, 0x9a7650, wx + 0.9, 0.42, wz + 0.7);
  townBox(parent, 1.3, 0.08, 0.45, 0xdfe8ea, wx + 0.9, 0.85, wz + 0.7);
  townCyl(parent, 0.15, 0.15, 0.08, 0xbfe4ea, wx + 0.9, 0.94, wz + 0.7, 10);
  townBox(parent, 0.08, 2.0, 1.2, 0xbfe4ea, wx - 1.9, 1.05, wz + 0.45);
  townBox(parent, 0.08, 2.0, 0.08, 0x3d3430, wx - 1.9, 1.05, wz + 1.05);
  townBox(parent, 1.3, 1.9, 0.06, 0xbfe4ea, wx - 1.2, 1.05, wz + 1.45);
  townSolid(wx - 1.3, wz - 1.4, wx - 0.1, wz - 0.3);
  for (var st = 0; st < 10; st++) {
    townBox(parent, 1.5, 0.14, 0.34, 0x8a6a48, cx + 3.2, 0.18 + st * 0.26, z1 - 0.7 - st * 0.34);
  }
  townBox(parent, 0.08, 1.0, 3.6, 0x3d3430, cx + 4.0, 1.5, z1 - 2.1, 0, 0, 0.38);
  /* 主要家具碰撞：茶几/电视柜/书架/冰箱/衣柜/梳妆台/浴缸/马桶/台盆/淋浴 */
  townSolid(x1 - 3.3, z1 - 4.25, x1 - 1.5, z1 - 3.35);
  townSolid(x1 - 1.45, z1 - 3.9, x1 + 0.05, z1 - 3.5);
  townSolid(x1 - 1.35, z1 - 1.35, x1 + 0.05, z1 - 0.65);
  townSolid(x1 - 1.6, z0 + 0.45, x1 - 0.6, z0 + 1.25);
  townSolid(x0 + 0.1, bz + 1.35, x0 + 1.85, bz + 2.05);
  townSolid(bx + 1.3, bz + 1.35, bx + 2.5, bz + 1.85);
  townSolid(wx - 1.25, wz - 1.35, wx - 0.1, wz - 0.45);
  townSolid(wx + 1.1, wz - 1.3, wx + 1.75, wz - 0.45);
  townSolid(wx + 0.15, wz + 0.35, wx + 1.65, wz + 1.05);
  townSolid(wx - 1.98, wz - 0.2, wx - 1.72, wz + 1.1);
  townSolid(wx - 1.2, wz + 1.35, wx - 0.55, wz + 1.55);
  if ((b.floors || 1) >= 2) {
    var fy = 2.80;
    /* 二楼只做西侧 LOFT 平台，避免整块楼板挡住一层视角 */
    townBox(parent, 4.0, 0.16, 4.2, 0xe0d8c8, x0 + 2.6, fy, z0 + 2.8);
    townBox(parent, 2.0, 0.16, 2.0, 0xe0d8c8, cx + 3.2, fy, z1 - 3.7);
    townBox(parent, (cx + 4.2) - (x0 + 2.0), 0.14, 1.2, 0xe0d8c8,
      (x0 + 2.0 + cx + 4.2) / 2, fy, z1 - 3.8);
    for (var rr2 = 0; rr2 < 7; rr2++) {
      townBox(parent, 0.05, 0.60, 0.05, 0x9aa3a8, x0 + 2.2 + rr2 * 1.3, fy + 0.38, z1 - 4.35);
    }
    townBox(parent, 9.0, 0.06, 0.06, 0x9aa3a8, x0 + 6.0, fy + 0.70, z1 - 4.35);
    townBox(parent, 2.0, 0.90, 0.08, 0xdfe8ea, cx - 3.8, 1.20, cz - 0.2);
    townBox(parent, 2.2, 0.55, 0.85, 0x8a8f8a, x0 + 3.0, 3.05, z0 + 3.0);
    townBox(parent, 1.8, 0.08, 0.85, 0x6f4c31, x0 + 3.0, 2.88, z0 + 3.0);
    townBox(parent, 2.0, 1.8, 0.45, 0x9a8a74, x0 + 1.3, 3.80, z0 + 1.3);
    townBox(parent, 2.2, 0.40, 1.6, 0x6f4c31, x0 + 2.6, 3.02, z0 + 2.6);
    townBox(parent, 2.1, 0.20, 1.5, 0xe8e0d0, x0 + 2.6, 3.28, z0 + 2.6);
    townBox(parent, 1.4, 0.60, 0.55, 0x9a7650, x0 + 4.1, 3.75, z0 + 1.4);
    townBox(parent, 1.2, 0.05, 0.45, 0x3d3430, x0 + 4.1, 4.07, z0 + 1.4);
    townBox(parent, 2.0, 0.06, 1.0, 0xbfe4ea, x0 + 3.0, 3.60, z1 - 1.2);
    for (var rl = 0; rl < 8; rl++) {
      townBox(parent, 0.06, 0.65, 0.06, 0x9aa3a8, cx - 3.4 + rl * 0.95, fy + 0.40, z1 - 0.45);
    }
    townBox(parent, 7.2, 0.07, 0.07, 0x9aa3a8, cx - 0.2, fy + 0.74, z1 - 0.45);
  }
}

function townInterior(parent, b) {
  var x0 = b.x0, x1 = b.x1, z0 = b.z0, z1 = b.z1;
  var cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  var w = x1 - x0 - 0.7, d = z1 - z0 - 0.7;
  var wood = (b.k === 'warehouse' || b.k === 'smith' || b.k === 'bathhouse') ? 0x6f5a42 : 0x8a6a48;
  townPlane(parent, w, d, wood, cx, 0.075, cz);
  for (var i = 1; i < 5; i++) {
    townBox(parent, w, 0.02, 0.035, 0x5f4630, cx, 0.085, z0 + 0.35 + (d * i / 5));
  }
  var rug = (b.k === 'hall' || b.k === 'inn') ? 0x7c3e3b : 0x5c6b46;
  if (b.k !== 'warehouse' && b.k !== 'smith') {
    townPlane(parent, Math.min(3.0, w * 0.6), Math.min(2.2, d * 0.5), rug, cx, 0.09, cz + 0.3, 0.9);
  }
  /* 室内灯带（暖光长条 + 吊线）*/
  if (b.k !== 'warehouse') {
    var _lw = Math.min(3.4, Math.max(1.1, w * 0.42));
    townBox(parent, _lw + 0.10, 0.05, 0.14, 0x3f2d1e, cx, 2.42, cz);
    townGlow(parent, _lw, 0.06, 0.10, 0xffe6b8, cx, 2.37, cz, 0.9);
    townBox(parent, 0.04, 0.38, 0.04, 0x3f2d1e, cx - _lw * 0.34, 2.60, cz);
    townBox(parent, 0.04, 0.38, 0.04, 0x3f2d1e, cx + _lw * 0.34, 2.60, cz);
    townGlow(parent, 0.22, 0.16, 0.22, 0xffd9a0, cx, 2.30, cz, 0.8);
  }
  var woodC = 0x7a5535, darkC = 0x4a3423;

  if (b.k === 'warehouse') {
    /* 柜台（位置与服务端仓库点一致）*/
    townBox(parent, 1.9, 0.92, 0.70, woodC, TOWN_COUNTER.x, 0.50, TOWN_COUNTER.z);
    townBox(parent, 2.0, 0.10, 0.78, darkC, TOWN_COUNTER.x, 0.99, TOWN_COUNTER.z);
    townBox(parent, 0.45, 0.35, 0.04, 0xe8dcc8, TOWN_COUNTER.x - 0.3, 1.12, TOWN_COUNTER.z + 0.22);
    townSolid(TOWN_COUNTER.x - 0.95, TOWN_COUNTER.z - 0.38,
              TOWN_COUNTER.x + 0.95, TOWN_COUNTER.z + 0.38);
    /* 货架 + 木箱 */
    for (var s = 0; s < 3; s++) {
      townBox(parent, 4.0, 0.10, 0.52, woodC, x0 + 3.0, 0.55 + s * 0.55, z0 + 0.65);
      townBox(parent, 4.0, 0.06, 0.08, darkC, x0 + 3.0, 0.88 + s * 0.55, z0 + 0.42);
      for (var q = 0; q < 5; q++) {
        townBox(parent, 0.55, 0.34 + (q % 2) * 0.10, 0.42,
          [0x9a7650, 0x8a6a44, 0xa9855a][q % 3], x0 + 1.3 + q * 0.82, 0.72 + s * 0.55, z0 + 0.68);
      }
    }
    townSolid(x0 + 0.55, z0 + 0.38, x0 + 5.2, z0 + 0.95);
    for (var c = 0; c < 5; c++) {
      townBox(parent, 0.9, 0.7, 0.9, 0x9a7650, x1 - 1.2, 0.42, z0 + 2.0 + c * 1.05);
      townBox(parent, 0.95, 0.07, 0.95, darkC, x1 - 1.2, 0.80, z0 + 2.0 + c * 1.05);
    }
    townSolid(x1 - 1.7, z0 + 1.5, x1 - 0.7, z0 + 6.3);
    townBox(parent, 1.2, 0.9, 1.0, 0x8a6a44, x0 + 1.4, 0.48, z1 - 1.2);
    townBox(parent, 1.0, 0.7, 0.9, 0x9a7650, x0 + 3.0, 0.38, z1 - 1.4);
    townSolid(x0 + 0.8, z1 - 1.8, x0 + 3.6, z1 - 0.8);
    /* 秤 + 账本 */
    townBox(parent, 0.42, 0.10, 0.42, 0x8b939b, TOWN_COUNTER.x + 0.5, 1.10, TOWN_COUNTER.z);
    townCyl(parent, 0.14, 0.16, 0.10, 0xd8c8a0, TOWN_COUNTER.x + 0.5, 1.18, TOWN_COUNTER.z, 10);
  } else if (b.k === 'mart') {
    /* 三排货架 + 冷柜 + 收银台 */
    for (var r = 0; r < 3; r++) {
      var z = z0 + 1.35 + r * 2.05;
      townBox(parent, 5.6, 0.10, 0.52, 0x9aa0a4, x0 + 3.6, 0.55, z);
      townBox(parent, 5.6, 0.10, 0.52, 0x9aa0a4, x0 + 3.6, 1.05, z);
      townBox(parent, 5.6, 0.10, 0.52, 0x9aa0a4, x0 + 3.6, 1.52, z);
      for (var q2 = 0; q2 < 7; q2++) {
        townGlow(parent, 0.22, 0.16, 0.24, [0xff8f7a, 0x8fd6ff, 0xffe08a, 0x9ff0b0][q2 % 4],
          x0 + 1.2 + q2 * 0.74, 1.18, z, 0.32);
      }
    }
    townSolid(x0 + 0.7, z0 + 1.0, x0 + 6.4, z0 + 5.6);
    townBox(parent, 0.55, 1.85, 3.4, 0xbfe4ea, x1 - 0.55, 1.02, z0 + 2.6);
    townBox(parent, 0.62, 0.12, 3.5, 0x4a3423, x1 - 0.55, 1.98, z0 + 2.6);
    for (var f = 0; f < 4; f++) {
      townGlow(parent, 0.05, 0.32, 0.65, 0xcfeaff, x1 - 0.85, 0.42 + f * 0.42, z0 + 1.3, 0.35);
    }
    townBox(parent, 2.0, 0.92, 0.72, woodC, x0 + 1.6, 0.50, z1 - 1.1);
    townBox(parent, 2.1, 0.10, 0.80, darkC, x0 + 1.6, 1.01, z1 - 1.1);
    townSolid(x0 + 0.6, z1 - 1.5, x0 + 2.6, z1 - 0.7);
    townGlow(parent, 0.36, 0.20, 0.24, 0xff8f7a, x0 + 1.2, 1.16, z1 - 1.1, 0.6);
  } else if (b.k === 'cafe') {
    /* 吧台 + 咖啡机 + 两张桌 */
    townBox(parent, 3.8, 0.94, 0.68, woodC, cx, 0.51, z0 + 1.05);
    townBox(parent, 3.9, 0.10, 0.76, 0x4a3423, cx, 1.02, z0 + 1.05);
    townSolid(cx - 1.95, z0 + 0.7, cx + 1.95, z0 + 1.4);
    townBox(parent, 0.55, 0.46, 0.42, 0x8b939b, cx - 1.0, 1.30, z0 + 1.05);
    townGlow(parent, 0.10, 0.10, 0.10, 0xff5a3a, cx - 1.22, 1.35, z0 + 1.05, 0.8);
    townBox(parent, 0.46, 0.18, 0.34, 0x3f2d1e, cx + 1.2, 1.16, z0 + 1.05);
    /* 里面两张圆桌（椅子由 SEATS 单独摆）*/
    townCyl(parent, 0.46, 0.46, 0.05, 0x8a6a48, -16.2, 0.66, 6.2, 14);
    townCyl(parent, 0.07, 0.10, 0.62, 0x4a3423, -16.2, 0.34, 6.2, 8);
    townCyl(parent, 0.46, 0.46, 0.05, 0x8a6a48, -16.2, 0.66, 8.0, 14);
    townCyl(parent, 0.07, 0.10, 0.62, 0x4a3423, -16.2, 0.34, 8.0, 8);
    townSolid(-16.7, 5.7, -15.7, 6.7);
    townSolid(-16.7, 7.5, -15.7, 8.5);
    /* 蛋糕柜 */
    townBox(parent, 1.4, 0.75, 0.55, 0xbfe4ea, x0 + 1.2, 0.50, z1 - 1.0);
    townGlow(parent, 1.3, 0.06, 0.45, 0xffe9c0, x0 + 1.2, 0.90, z1 - 1.0, 0.5);
  } else if (b.k === 'ramen') {
    /* 吧台 + 厨房口 + 汤锅 */
    townBox(parent, 0.80, 1.02, 5.2, woodC, x1 - 1.0, 0.55, cz);
    townBox(parent, 0.92, 0.10, 5.3, darkC, x1 - 1.0, 1.08, cz);
    townSolid(x1 - 1.45, z0 + 0.9, x1 - 0.55, z1 - 0.9);
    townBox(parent, 2.6, 1.9, 0.20, 0x8a6a44, x1 - 1.0, 1.55, z0 + 0.55);
    townGlow(parent, 2.2, 0.55, 0.06, 0xffa24a, x1 - 1.0, 1.42, z0 + 0.66, 0.55);
    for (var p2 = 0; p2 < 3; p2++) {
      townCyl(parent, 0.22, 0.20, 0.30, 0x8b939b, x1 - 1.0, 1.22, z0 + 1.5 + p2 * 1.2, 10);
      townGlow(parent, 0.30, 0.03, 0.30, 0xffe0b0, x1 - 1.0, 1.38, z0 + 1.5 + p2 * 1.2, 0.4);
    }
    townBox(parent, 1.4, 0.75, 0.6, 0x9a7650, x0 + 1.2, 0.42, z1 - 1.1);
    townSolid(x0 + 0.7, z1 - 1.5, x0 + 1.9, z1 - 0.7);
    /* 菜单板 */
    townBox(parent, 1.6, 0.9, 0.06, 0x2f241a, x0 + 0.35, 1.55, z0 + 2.2, Math.PI / 2);
    townSignPlane(parent, '拉面 · 饺子', 1.45, 0.62, x0 + 0.40, 1.58, z0 + 2.2, Math.PI / 2, '#2f241a', '#ffe9b0');
    /* 南墙碗架 + 清酒 */
    townBox(parent, 3.0, 0.08, 0.35, 0x6b4a32, cx, 1.30, z1 - 0.55);
    for (var _bw = 0; _bw < 8; _bw++) {
      townCyl(parent, 0.10, 0.08, 0.10, 0xe8dcc8, cx - 1.2 + _bw * 0.34, 1.40, z1 - 0.55, 8);
    }
    for (var _sk = 0; _sk < 4; _sk++) {
      townCyl(parent, 0.09, 0.11, 0.38, 0x5c6b46, x0 + 1.0 + _sk * 0.35, 0.90, z1 - 0.40, 8);
    }
    townGlow(parent, 0.18, 0.26, 0.18, 0xff7a3a, cx - 1.8, 1.92, cz, 0.9);
    townGlow(parent, 0.18, 0.26, 0.18, 0xff7a3a, cx + 1.8, 1.92, cz, 0.9);
  } else if (b.k === 'inn') {
    /* 前台 + 钥匙柜 + 楼梯 + 沙发区 */
    townBox(parent, 3.2, 0.95, 0.68, woodC, x0 + 2.1, 0.52, z0 + 1.0);
    townBox(parent, 3.3, 0.10, 0.76, darkC, x0 + 2.1, 1.03, z0 + 1.0);
    townSolid(x0 + 0.5, z0 + 0.65, x0 + 3.7, z0 + 1.35);
    for (var k2 = 0; k2 < 8; k2++) {
      townBox(parent, 0.20, 0.20, 0.05, 0xb08a45, x0 + 1.1 + (k2 % 4) * 0.42, 1.75, z0 + 0.55);
    }
    townBox(parent, 2.6, 0.08, 0.7, 0x8a6a48, x0 + 2.0, 0.54, z1 - 1.2);
    townBox(parent, 0.2, 0.54, 0.2, darkC, x0 + 1.0, 0.27, z1 - 1.2);
    townBox(parent, 0.2, 0.54, 0.2, darkC, x0 + 3.0, 0.27, z1 - 1.2);
    townSolid(x0 + 0.6, z1 - 1.6, x0 + 3.4, z1 - 0.8);
    /* 楼梯（视觉）*/
    for (var st2 = 0; st2 < 8; st2++) {
      townBox(parent, 1.5, 0.12, 0.34, 0x6f4c31, x1 - 1.6, 0.18 + st2 * 0.24, z1 - 0.7 - st2 * 0.36);
    }
    townBox(parent, 0.10, 1.0, 2.6, 0x4a3423, x1 - 1.6, 1.55, z1 - 1.4, 0, 0, 0.5);
  } else if (b.k === 'hall') {
    /* 接待台 + 任务板 + 两侧长椅 + 大壁画 */
    townBox(parent, 5.2, 1.15, 0.9, 0x7a5535, cx, 0.62, z0 + 1.2);
    townBox(parent, 5.4, 0.12, 1.0, darkC, cx, 1.22, z0 + 1.2);
    townSolid(cx - 2.7, z0 + 0.7, cx + 2.7, z0 + 1.7);
    townSignBoard(parent, '新手大厅', 3.2, 0.72, cx, 2.05, z0 + 0.55, 0, '#2f241a', '#ffe9b0');
    townBox(parent, 2.4, 1.4, 0.10, 0x3e5968, x0 + 2.2, 1.55, z0 + 0.45);
    townBox(parent, 2.0, 0.10, 0.10, 0x8a6a48, x0 + 2.2, 1.9, z0 + 0.45);
    /* 任务板 */
    townBox(parent, 2.4, 1.45, 0.12, 0x6f4c31, x1 - 2.0, 1.35, z0 + 0.45);
    for (var pp = 0; pp < 6; pp++) {
      townBox(parent, 0.5, 0.34, 0.03, 0xe8dcc8, x1 - 2.8 + (pp % 3) * 0.8, 1.6 - Math.floor(pp / 3) * 0.52, z0 + 0.53);
    }
    /* 柱子 / 地毯 / 吊灯 */
    townCyl(parent, 0.24, 0.28, 4.2, 0xd8c9ad, x0 + 1.4, 2.1, z1 - 2.2, 10);
    townCyl(parent, 0.24, 0.28, 4.2, 0xd8c9ad, x1 - 1.4, 2.1, z1 - 2.2, 10);
    townSolid(x0 + 1.1, z1 - 2.5, x0 + 1.7, z1 - 1.9);
    townSolid(x1 - 1.7, z1 - 2.5, x1 - 1.1, z1 - 1.9);
    townPlane(parent, 4.8, 3.6, 0x7c3e3b, cx, 0.10, cz + 0.6, 0.95);
    townGlow(parent, 0.9, 0.12, 0.9, 0xffd9a0, cx, 4.2, cz, 0.75);
  } else if (b.k === 'clinic') {
    /* 药柜 + 柜台 + 诊床 */
    townBox(parent, 4.2, 0.95, 0.7, woodC, cx, 0.52, z0 + 0.9);
    townBox(parent, 4.3, 0.10, 0.78, darkC, cx, 1.03, z0 + 0.9);
    townSolid(cx - 2.2, z0 + 0.5, cx + 2.2, z0 + 1.3);
    for (var h2 = 0; h2 < 4; h2++) {
      townBox(parent, 4.0, 0.06, 0.34, 0x8a6a48, cx, 1.35 + h2 * 0.42, z0 + 0.5);
      for (var j2 = 0; j2 < 7; j2++) {
        townGlow(parent, 0.20, 0.28, 0.20, [0x8fe0b0, 0xd8e08a, 0x9fd6ff][j2 % 3],
          cx - 1.7 + j2 * 0.55, 1.55 + h2 * 0.42, z0 + 0.5, 0.22);
      }
    }
    townBox(parent, 2.2, 0.55, 1.1, 0xe8e0d0, x0 + 1.8, 0.30, z1 - 1.3);
    townBox(parent, 2.1, 0.18, 1.0, 0xd8cbb4, x0 + 1.8, 0.63, z1 - 1.3);
    townSolid(x0 + 0.7, z1 - 1.9, x0 + 2.9, z1 - 0.7);
    townBox(parent, 0.6, 0.35, 0.5, 0x9aa0a4, x1 - 1.2, 0.90, z1 - 1.2);
    townGlow(parent, 0.30, 0.10, 0.30, 0x9fe8ff, x1 - 1.2, 1.12, z1 - 1.2, 0.55);
  } else if (b.k === 'shrine') {
    /* 神龛 / 赛钱箱 / 绘马 / 蜡烛 */
    townBox(parent, 4.2, 0.85, 1.2, 0x6b4a2f, cx, 0.46, z0 + 1.15);
    townBox(parent, 4.4, 0.12, 1.3, 0x4a3423, cx, 0.92, z0 + 1.15);
    townBox(parent, 2.2, 1.5, 0.55, 0x8a6a48, cx, 1.75, z0 + 0.75);
    townBox(parent, 1.5, 1.0, 0.08, 0xd8c9ad, cx, 1.78, z0 + 1.02);
    townGlow(parent, 0.20, 0.20, 0.20, 0xffd9a0, cx - 0.4, 2.3, z0 + 1.0, 0.8);
    townSolid(cx - 2.2, z0 + 0.55, cx + 2.2, z0 + 1.8);
    townBox(parent, 1.6, 0.40, 0.65, 0x5a3f2a, cx, 0.22, cz + 0.7);
    townBox(parent, 1.7, 0.08, 0.72, 0x3f2d1e, cx, 0.45, cz + 0.7);
    townSolid(cx - 0.85, cz + 0.35, cx + 0.85, cz + 1.05);
    townBox(parent, 2.0, 1.2, 0.10, 0x6b4a2f, x1 - 0.6, 1.45, z0 + 2.4, Math.PI / 2);
    for (var e2 = 0; e2 < 5; e2++) {
      townBox(parent, 0.28, 0.34, 0.025, 0xd8c9ad, x1 - 0.55, 1.5 - Math.floor(e2 / 3) * 0.4, z0 + 2.0 + (e2 % 3) * 0.36, Math.PI / 2);
    }
    townGlow(parent, 0.10, 0.35, 0.10, 0xffe0a8, x0 + 0.8, 1.30, z1 - 1.4, 0.75);
    townGlow(parent, 0.10, 0.35, 0.10, 0xffe0a8, x1 - 0.8, 1.30, z1 - 1.4, 0.75);
  } else if (b.k === 'bookstore') {
    /* 书架三面 + 阅读桌 + 梯子 */
    for (var sh = 0; sh < 3; sh++) {
      townBox(parent, 0.55, 2.1, 4.6, 0x6f4c31, x0 + 0.75 + sh * 0.62, 1.10, cz);
      for (var rr = 0; rr < 5; rr++) {
        townBox(parent, 0.50, 0.05, 4.4, 0x8a6a48, x0 + 0.75 + sh * 0.62, 0.38 + rr * 0.40, cz);
        for (var bb = 0; bb < 9; bb++) {
          townBox(parent, 0.16, 0.26, 0.26, [0x9a4a3a, 0x3e5968, 0x5c6b46, 0xb08a45][(bb + rr) % 4],
            x0 + 0.66 + sh * 0.62, 0.55 + rr * 0.40, cz - 2.0 + bb * 0.48);
        }
      }
    }
    townSolid(x0 + 0.45, cz - 2.4, x0 + 2.2, cz + 2.4);
    townCyl(parent, 0.55, 0.55, 0.06, 0x8a6a48, x1 - 2.2, 0.68, cz + 1.0, 14);
    townCyl(parent, 0.08, 0.11, 0.62, 0x4a3423, x1 - 2.2, 0.35, cz + 1.0, 8);
    townBox(parent, 1.0, 0.07, 0.5, 0xe8dcc8, x1 - 2.2, 0.72, cz + 1.0);
    townSolid(x1 - 2.8, cz + 0.4, x1 - 1.6, cz + 1.6);
    townBox(parent, 0.10, 2.0, 0.10, 0x6f4c31, x0 + 2.2, 1.0, z1 - 0.7);
  } else if (b.k === 'tea') {
    townBox(parent, 2.6, 0.45, 1.1, 0x6b4a2f, cx, 0.24, z0 + 1.5);
    townBox(parent, 2.7, 0.08, 1.2, 0x4a3423, cx, 0.49, z0 + 1.5);
    townSolid(cx - 1.3, z0 + 0.9, cx + 1.3, z0 + 2.1);
    townBox(parent, 1.2, 0.4, 0.8, 0x8a6a48, cx, 0.20, z1 - 1.3);
    townBox(parent, 1.0, 0.04, 0.6, 0x4a3423, cx, 0.40, z1 - 1.3);
    townCyl(parent, 0.16, 0.14, 0.22, 0x5c6b46, cx - 0.2, 0.53, z1 - 1.3, 10);
    townSolid(cx - 0.65, z1 - 1.75, cx + 0.65, z1 - 0.85);
    townBox(parent, 1.5, 1.0, 0.05, 0xd8c9ad, x0 + 0.35, 1.55, cz, Math.PI / 2);
    townSignPlane(parent, '一期一会', 1.3, 0.7, x0 + 0.40, 1.55, cz, Math.PI / 2, '#efe4cc', '#3a2a1c', true);
    townGlow(parent, 0.18, 0.22, 0.18, 0xffd9a0, cx, 1.9, cz, 0.7);
    townGlowPool(parent, cx, cz, 1.6, 0xffd9a0, 0.25);
  } else if (b.k === 'izakaya') {
    townBox(parent, 5.2, 1.0, 0.75, 0x5f3d27, cx, 0.54, z0 + 1.15);
    townBox(parent, 5.3, 0.10, 0.85, 0x3f2d1e, cx, 1.06, z0 + 1.15);
    townSolid(cx - 2.65, z0 + 0.7, cx + 2.65, z0 + 1.55);
    for (var btl = 0; btl < 9; btl++) {
      townCyl(parent, 0.10, 0.12, 0.36 + (btl % 3) * 0.12, [0x5c6b46, 0x9a4a3a, 0xb08a45][btl % 3],
        cx - 2.0 + btl * 0.5, 1.34, z0 + 0.55, 8);
    }
    townBox(parent, 2.2, 0.55, 1.1, 0x6b4a2f, cx, 0.30, z1 - 1.2);
    townBox(parent, 2.3, 0.09, 1.2, 0x4a3423, cx, 0.60, z1 - 1.2);
    townSolid(cx - 1.2, z1 - 1.8, cx + 1.2, z1 - 0.6);
    for (var l2 = 0; l2 < 3; l2++) {
      townGlow(parent, 0.20, 0.30, 0.20, 0xff7a3a, x0 + 1.0 + l2 * 1.9, 2.05, cz, 0.8);
    }
  } else if (b.k === 'bakery') {
    /* 展示柜 + 烤炉 + 面包架 */
    townBox(parent, 3.6, 0.90, 0.70, 0x8a6a48, cx, 0.50, z0 + 1.0);
    townBox(parent, 3.7, 0.10, 0.78, 0x4a3423, cx, 0.97, z0 + 1.0);
    townSolid(cx - 1.9, z0 + 0.6, cx + 1.9, z0 + 1.4);
    for (var br = 0; br < 8; br++) {
      townSphere(parent, 0.15, [0xd8a45a, 0xc98a44, 0xe0b878][br % 3],
        cx - 1.5 + br * 0.42, 1.10, z0 + 0.9, 0);
    }
    townBox(parent, 1.3, 1.7, 1.3, 0x7d5a3a, x1 - 1.4, 0.88, z1 - 1.5);
    townBox(parent, 0.9, 0.6, 0.10, 0x2f241a, x1 - 1.4, 0.95, z1 - 0.88);
    townGlow(parent, 0.72, 0.40, 0.06, 0xff8a3a, x1 - 1.4, 0.95, z1 - 0.86, 0.75);
    townSolid(x1 - 2.1, z1 - 2.2, x1 - 0.7, z1 - 0.8);
    for (var bs = 0; bs < 3; bs++) {
      townBox(parent, 2.6, 0.08, 0.45, 0x8a6a48, cx, 0.85 + bs * 0.45, z0 + 2.2);
      for (var bq = 0; bq < 5; bq++) {
        townSphere(parent, 0.14, 0xd8a45a, cx - 1.0 + bq * 0.5, 1.02 + bs * 0.45, z0 + 2.2, 0);
      }
    }
    townSolid(cx - 1.4, z0 + 1.95, cx + 1.4, z0 + 2.45);
  } else if (b.k === 'flower') {
    /* 工作台 + 花桶 + 吊花 */
    townBox(parent, 3.4, 0.9, 0.85, 0x8a6a48, cx, 0.50, z0 + 1.2);
    townBox(parent, 3.5, 0.10, 0.92, 0x4a3423, cx, 0.97, z0 + 1.2);
    townSolid(cx - 1.8, z0 + 0.75, cx + 1.8, z0 + 1.65);
    for (var fl = 0; fl < 6; fl++) {
      townCyl(parent, 0.20, 0.16, 0.42, 0x9aa0a4, x0 + 1.0 + (fl % 3) * 0.9, 0.22, z1 - 1.2 - Math.floor(fl / 3) * 0.8, 8);
      townCyl(parent, 0.06, 0.05, 0.5, 0x5c8a52, x0 + 1.0 + (fl % 3) * 0.9, 0.62, z1 - 1.2 - Math.floor(fl / 3) * 0.8, 6);
      townSphere(parent, 0.16, [0xe06a8a, 0xf0d060, 0xd85a5a][fl % 3],
        x0 + 1.0 + (fl % 3) * 0.9, 0.92, z1 - 1.2 - Math.floor(fl / 3) * 0.8, 0);
    }
    townSolid(x0 + 0.6, z1 - 2.2, x0 + 3.2, z1 - 0.7);
    townBox(parent, 1.4, 0.35, 0.5, 0x6f4c31, x1 - 0.8, 1.65, z0 + 2.0);
    townGlow(parent, 1.2, 0.06, 0.35, 0xffe9c0, x1 - 0.8, 1.45, z0 + 2.0, 0.4);
  } else if (b.k === 'general') {
    for (var gs = 0; gs < 3; gs++) {
      townBox(parent, 4.6, 0.09, 0.55, 0x8a6a48, cx, 0.55 + gs * 0.55, z0 + 0.95);
      townBox(parent, 4.6, 0.05, 0.08, 0x4a3423, cx, 0.88 + gs * 0.55, z0 + 0.72);
      for (var gi = 0; gi < 6; gi++) {
        townBox(parent, 0.45, 0.30, 0.38, [0x9a7650, 0x5c6b46, 0x8b939b][gi % 3],
          cx - 1.9 + gi * 0.72, 0.75 + gs * 0.55, z0 + 0.95);
      }
    }
    townSolid(cx - 2.3, z0 + 0.65, cx + 2.3, z0 + 1.3);
    townBox(parent, 2.0, 0.92, 0.7, 0x8a6a48, x0 + 1.4, 0.50, z1 - 1.0);
    townBox(parent, 2.1, 0.10, 0.78, 0x4a3423, x0 + 1.4, 1.01, z1 - 1.0);
    townSolid(x0 + 0.4, z1 - 1.35, x0 + 2.4, z1 - 0.65);
    for (var cr = 0; cr < 4; cr++) {
      townBox(parent, 0.7, 0.55, 0.7, 0x9a7650, x1 - 1.1, 0.32, z1 - 1.8 + cr * 0.75);
    }
    townSolid(x1 - 1.5, z1 - 2.2, x1 - 0.7, z1 - 0.8);
  } else if (b.k === 'dessert') {
    townBox(parent, 2.2, 0.7, 0.8, 0xbfe4ea, cx, 0.46, z0 + 1.0);
    townBox(parent, 2.3, 0.10, 0.88, 0x8a6a48, cx, 0.86, z0 + 1.0);
    for (var ck = 0; ck < 5; ck++) {
      townBox(parent, 0.26, 0.18, 0.26, [0xe08aa8, 0xf0d060, 0xd8a45a][ck % 3],
        cx - 0.8 + ck * 0.4, 1.02, z0 + 1.0);
    }
    townSolid(cx - 1.2, z0 + 0.6, cx + 1.2, z0 + 1.4);
    for (var dt = 0; dt < 2; dt++) {
      townCyl(parent, 0.40, 0.40, 0.05, 0xe8dcc8, cx - 0.7 + dt * 1.6, 0.58, z1 - 1.5, 14);
      townCyl(parent, 0.07, 0.09, 0.55, 0x8a6a48, cx - 0.7 + dt * 1.6, 0.30, z1 - 1.5, 8);
      townSolid(cx - 1.2 + dt * 1.6, z1 - 2.0, cx - 0.2 + dt * 1.6, z1 - 1.0);
    }
  } else if (b.k === 'post') {
    townBox(parent, 3.4, 0.95, 0.7, 0x8a6a48, cx, 0.52, z0 + 1.0);
    townBox(parent, 3.5, 0.10, 0.78, 0x4a3423, cx, 1.03, z0 + 1.0);
    townSolid(cx - 1.8, z0 + 0.6, cx + 1.8, z0 + 1.4);
    for (var pk = 0; pk < 12; pk++) {
      townBox(parent, 0.34, 0.34, 0.16, [0x9a7650, 0x8a6a44][pk % 2],
        cx - 1.9 + (pk % 6) * 0.65, 1.35 - Math.floor(pk / 6) * 0.45, z0 + 0.50);
    }
    for (var pc = 0; pc < 4; pc++) {
      townBox(parent, 0.7, 0.55, 0.6, 0x9a7650, x1 - 1.0, 0.30, z0 + 1.8 + pc * 0.75);
    }
    townSolid(x1 - 1.5, z0 + 1.4, x1 - 0.5, z0 + 4.6);
  } else if (b.k === 'koban') {
    townBox(parent, 2.4, 0.9, 0.65, 0x8a6a48, cx, 0.50, z0 + 0.9);
    townBox(parent, 2.5, 0.10, 0.72, 0x4a3423, cx, 0.97, z0 + 0.9);
    townSolid(cx - 1.3, z0 + 0.55, cx + 1.3, z0 + 1.3);
    townBox(parent, 1.8, 1.1, 0.08, 0xd8d0c0, x1 - 0.45, 1.45, cz, Math.PI / 2);
    townSignPlane(parent, '小镇地图', 1.55, 0.9, x1 - 0.50, 1.45, cz, Math.PI / 2, '#efe4cc', '#3e5968');
    townBox(parent, 0.55, 0.55, 0.55, 0x8b939b, x0 + 0.8, 0.32, z1 - 0.9);
  } else if (b.k === 'bathhouse') {
    /* 鞋柜 + 前台 + 浴池 + 蒸汽 */
    townBox(parent, 3.4, 1.2, 0.45, 0x6f4c31, cx, 0.62, z0 + 0.6);
    for (var sl = 0; sl < 8; sl++) {
      townBox(parent, 0.34, 0.34, 0.06, 0x9a7650, cx - 1.2 + (sl % 4) * 0.36, 0.95 - Math.floor(sl / 4) * 0.4, z0 + 0.38);
    }
    townSolid(cx - 1.8, z0 + 0.3, cx + 1.8, z0 + 0.85);
    townBox(parent, 2.6, 0.95, 0.8, 0x8a6a48, x1 - 1.7, 0.52, z1 - 2.0);
    townBox(parent, 2.7, 0.10, 0.88, 0x4a3423, x1 - 1.7, 1.03, z1 - 2.0);
    townSolid(x1 - 3.1, z1 - 2.5, x1 - 0.5, z1 - 1.5);
    townCyl(parent, 1.5, 1.5, 0.55, 0x7fb6c8, x0 + 2.2, 0.28, z1 - 2.2, 18);
    townCyl(parent, 1.5, 1.5, 0.10, 0x8b939b, x0 + 2.2, 0.58, z1 - 2.2, 18);
    townGlow(parent, 2.6, 0.04, 2.6, 0x9fe8ff, x0 + 2.2, 0.62, z1 - 2.2, 0.35);
    townSolid(x0 + 0.65, z1 - 3.75, x0 + 3.75, z1 - 0.65);
    townBox(parent, 0.35, 2.2, 0.35, 0x6b4d34, x0 + 1.4, 1.1, z1 - 0.5);
    townBox(parent, 0.35, 2.2, 0.35, 0x6b4d34, x1 - 1.4, 1.1, z1 - 0.5);
  } else if (b.k === 'smith') {
    /* 炉子 + 铁砧 + 水桶 + 武器架 */
    townBox(parent, 1.6, 1.0, 1.0, 0x4b4038, cx + 1.2, 0.52, cz);
    townBox(parent, 0.9, 0.40, 0.8, 0x2d2b29, cx + 1.2, 1.16, cz);
    townGlow(parent, 0.52, 0.30, 0.62, 0xff7a30, cx + 1.2, 1.12, cz, 0.9);
    townSolid(cx + 0.35, cz - 0.55, cx + 2.05, cz + 0.55);
    townBox(parent, 0.75, 0.26, 0.42, 0x3b3b3f, cx - 1.2, 0.55, cz + 0.6);
    townBox(parent, 0.35, 0.50, 0.35, 0x3b3b3f, cx - 1.2, 0.25, cz + 0.6);
    townSolid(cx - 1.65, cz + 0.2, cx - 0.75, cz + 1.0);
    townCyl(parent, 0.45, 0.40, 0.60, 0x5a4634, cx - 1.4, 0.30, cz - 1.2, 12);
    townCyl(parent, 0.40, 0.40, 0.04, 0x4b8aa0, cx - 1.4, 0.58, cz - 1.2, 12);
    for (var wr = 0; wr < 4; wr++) {
      townBox(parent, 0.10, 1.45, 0.10, 0x6b6157, x1 - 0.7, 1.05, cz - 1.4 + wr * 0.55);
      townBox(parent, 0.42, 0.06, 0.10, 0x9aa0a4, x1 - 0.7, 1.55, cz - 1.4 + wr * 0.55);
    }
    townBox(parent, 1.8, 0.09, 0.3, 0x4a3423, x1 - 0.85, 0.45, cz - 0.55);
    townSolid(x1 - 1.25, cz - 1.8, x1 - 0.45, cz + 0.7);
  } else if (b.tier === 'villa') {
    townVillaInterior(parent, b);
  } else if (b.k === 'apartment' || b.k === 'home' || b.k === 'home_a' ||
             b.k === 'home_b' || b.k === 'home_c' || b.k === 'home_d' ||
             b.k === 'yard' || b.k === 'flat') {
    /* 民居：床 + 桌 + 厨房 + 衣柜 */
    townBox(parent, 2.0, 0.42, 1.25, 0x6b4d34, x0 + 1.8, 0.25, z0 + 1.35);
    townBox(parent, 1.9, 0.20, 1.1, 0xd8cbb4, x0 + 1.8, 0.56, z0 + 1.35);
    townBox(parent, 0.55, 0.22, 0.40, 0xe8e0d0, x0 + 1.0, 0.68, z0 + 1.15);
    townSolid(x0 + 0.9, z0 + 0.8, x0 + 2.7, z0 + 1.95);
    townBox(parent, 1.2, 0.06, 0.8, 0x8a6a48, x1 - 1.6, 0.62, z1 - 1.3);
    townBox(parent, 0.12, 0.58, 0.12, 0x4a3423, x1 - 1.6, 0.31, z1 - 1.3);
    townSolid(x1 - 2.2, z1 - 1.7, x1 - 1.0, z1 - 0.9);
    townBox(parent, 1.8, 0.85, 0.55, 0x8a6a48, x0 + 1.4, 0.45, z1 - 0.9);
    townBox(parent, 0.45, 0.06, 0.45, 0x9aa0a4, x0 + 1.0, 0.90, z1 - 0.9);
    townGlow(parent, 0.28, 0.04, 0.28, 0xff8a3a, x0 + 1.0, 0.92, z1 - 0.9, 0.5);
    townSolid(x0 + 0.5, z1 - 1.2, x0 + 2.3, z1 - 0.6);
    townBox(parent, 1.1, 2.0, 0.55, 0x6b4d34, x1 - 0.75, 1.02, z0 + 0.6);
    townSolid(x1 - 1.35, z0 + 0.3, x1 - 0.2, z0 + 0.9);
    if (b.floors === 2) {
      townBox(parent, 2.4, 0.9, 0.55, 0x8a6a48, x1 - 1.8, 0.45, z0 + 1.1);
    }
  } else {
    /* 兜底：柜台 + 货架 */
    townBox(parent, 2.0, 0.9, 0.7, 0x7a5535, cx, 0.50, z0 + 1.0);
    townBox(parent, 2.1, 0.10, 0.78, 0x4a3423, cx, 0.97, z0 + 1.0);
    townSolid(cx - 1.0, z0 + 0.65, cx + 1.0, z0 + 1.35);
  }
}

/* 店铺现代设备补充：收银/后厨/咖啡/药房 */
function townCommercialEquipment(parent, b) {
  var x0 = b.x0, x1 = b.x1, z0 = b.z0, z1 = b.z1;
  var cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  if (b.k === 'mart') {
    /* 收银传送带 + 扫码枪 + 购物篮 */
    townBox(parent, 1.8, 0.10, 0.75, 0x2f3438, x0 + 4.7, 0.94, z1 - 1.15);
    for (var mc = 0; mc < 8; mc++) { townBox(parent, 0.20, 0.03, 0.62, 0x4a4f52, x0 + 3.95 + mc * 0.22, 1.00, z1 - 1.15); }
    townBox(parent, 0.38, 0.30, 0.34, 0x1f2326, x0 + 5.3, 1.12, z1 - 1.15);
    townBox(parent, 0.28, 0.18, 0.04, 0x8fd6ff, x0 + 5.3, 1.22, z1 - 0.98);
    townBox(parent, 0.55, 0.55, 0.42, 0x9aa3a8, x0 + 5.8, 0.28, z1 - 1.8);
    for (var mb = 0; mb < 6; mb++) { townBox(parent, 0.34, 0.22, 0.28, [0x4fae6f, 0xd8a45a][mb % 2], x0 + 5.8, 0.10 + mb * 0.20, z1 - 1.8); }
    /* 促销堆头 */
    townBox(parent, 1.2, 0.65, 0.8, 0xd8cbb4, x0 + 2.0, 0.33, cz);
    for (var mp = 0; mp < 4; mp++) { townBox(parent, 0.28, 0.30, 0.30, [0xff8f7a, 0x8fd6ff, 0xffe08a, 0x9ff0b0][mp], x0 + 1.55 + (mp % 2) * 0.55, 0.80, cz - 0.2 + Math.floor(mp / 2) * 0.4); }
  } else if (b.k === 'ramen' || b.k === 'izakaya') {
    /* 不锈钢后厨：灶台/烟罩/备餐台/冰箱/洗碗机/出餐口 */
    townBox(parent, 2.2, 0.85, 0.85, 0x9aa3a8, x1 - 1.5, 0.44, z0 + 2.2);
    for (var rb = 0; rb < 4; rb++) { townCyl(parent, 0.16, 0.16, 0.04, 0x1f2326, x1 - 2.1 + (rb % 2) * 0.55, 0.90, z0 + 1.95 + Math.floor(rb / 2) * 0.45, 12); }
    townBox(parent, 2.0, 0.55, 0.45, 0xbfc4c6, x1 - 1.5, 2.35, z0 + 1.8);
    townBox(parent, 1.4, 0.10, 0.55, 0x9aa3a8, x0 + 3.8, 1.55, z1 - 1.0);
    townBox(parent, 1.2, 0.50, 0.55, 0xbfc4c6, x0 + 3.8, 1.15, z1 - 1.0);
    for (var rp = 0; rp < 6; rp++) { townCyl(parent, 0.13, 0.11, 0.06, 0xe8e0d0, x0 + 3.25 + rp * 0.20, 1.63, z1 - 1.0, 10); }
    townBox(parent, 0.95, 1.7, 0.75, 0xc8ccce, x0 + 0.9, 0.85, z1 - 1.0);
    townBox(parent, 1.0, 0.05, 0.05, 0xff8a3a, x0 + 3.8, 1.34, z1 - 1.28);
    townBox(parent, 0.85, 0.55, 0.55, 0xbfc4c6, x1 - 0.9, 0.28, z1 - 1.2);
  } else if (b.k === 'cafe' || b.k === 'dessert') {
    /* 咖啡机 + 磨豆机 + 冰箱 + 水槽 */
    townBox(parent, 0.75, 0.55, 0.55, 0xbfc4c6, cx - 1.1, 1.28, z0 + 1.0);
    townBox(parent, 0.45, 0.30, 0.30, 0x3d3430, cx - 0.55, 1.28, z0 + 1.0);
    townBox(parent, 0.45, 0.85, 0.40, 0xd8d2c4, cx + 1.4, 0.42, z0 + 0.7);
    townBox(parent, 0.35, 0.35, 0.35, 0x9aa3a8, cx + 1.4, 0.82, z0 + 0.7);
    townBox(parent, 0.65, 0.10, 0.35, 0x9aa3a8, cx + 1.4, 1.02, z0 + 0.7);
    townBox(parent, 0.90, 1.55, 0.55, 0xbfc4c6, x1 - 1.0, 0.78, z1 - 1.2);
  } else if (b.k === 'clinic') {
    townBox(parent, 0.45, 0.40, 0.40, 0xbfc4c6, x1 - 1.1, 0.25, z1 - 1.9);
    townBox(parent, 0.10, 0.80, 0.10, 0x3d4549, x1 - 1.1, 0.85, z1 - 1.9);
    townBox(parent, 0.55, 0.22, 0.45, 0xdfe8ea, x1 - 1.1, 1.28, z1 - 1.9);
    townGlow(parent, 0.40, 0.04, 0.35, 0xdfefff, x1 - 1.1, 1.18, z1 - 1.9, 0.6);
    townBox(parent, 0.80, 1.3, 0.50, 0x9aa3a8, x0 + 1.0, 0.65, z1 - 1.0);
    townBox(parent, 0.7, 1.1, 0.05, 0xbfe4ea, x0 + 1.0, 1.2, z1 - 0.75);
  } else if (b.k === 'bakery') {
    townBox(parent, 1.8, 0.08, 0.55, 0x9aa3a8, cx, 1.55, z1 - 1.6);
    for (var bp = 0; bp < 6; bp++) { townSphere(parent, 0.13, 0xd8a45a, cx - 0.7 + bp * 0.28, 1.64, z1 - 1.6, 0); }
    townBox(parent, 0.65, 1.15, 0.55, 0xbfc4c6, x1 - 1.1, 0.58, z1 - 1.0);
    townBox(parent, 0.55, 0.45, 0.45, 0x9aa3a8, x0 + 1.0, 0.25, z1 - 1.0);
    townBox(parent, 0.60, 0.40, 0.55, 0xbfc4c6, x0 + 1.0, 0.75, z1 - 1.0);
  }
}

/* 住宅门牌：Canvas 纹理，购买后显示房主/剩余天数 */
function townHouseSign(parent, b) {
  var cv = UI.townCanvas(512, 128);
  var tex = new THREE.CanvasTexture(cv);
  try { tex.colorSpace = THREE.SRGBColorSpace; } catch (e) { }
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  var mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
  var w = 2.4, h = 0.6;
  var nx = 0, nz = 0;
  if (b.door === 'east') { nx = 1; }
  else if (b.door === 'west') { nx = -1; }
  else if (b.door === 'south') { nz = 1; }
  else { nz = -1; }
  var dx = (b.door === 'east') ? b.x1 : (b.door === 'west' ? b.x0 : b.door_at);
  var dz = (b.door === 'south') ? b.z1 : (b.door === 'north' ? b.z0 : b.door_at);
  var mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.position.set(dx + nx * 0.16, 2.86, dz + nz * 0.16);
  mesh.rotation.y = (b.door === 'east') ? Math.PI / 2 : (b.door === 'west' ? -Math.PI / 2 : (b.door === 'south' ? 0 : Math.PI));
  parent.add(mesh);
  TOWN_HOUSE_SIGNS[b.id] = { mesh: mesh, tex: tex, cv: cv, b: b };
  townHouseSignSet(b.id, '', 0);
}
function townHouseSignSet(id, owner, rem) {
  var s = TOWN_HOUSE_SIGNS[id];
  if (!s) { return; }
  var c = s.cv.getContext('2d');
  var W = s.cv.width, H = s.cv.height;
  c.clearRect(0, 0, W, H);
  c.fillStyle = 'rgba(30,24,18,0.88)';
  c.fillRect(0, 0, W, H);
  c.strokeStyle = 'rgba(255,225,170,0.55)';
  c.lineWidth = 4; c.strokeRect(3, 3, W - 6, H - 6);
  c.textAlign = 'center';
  c.fillStyle = '#ffe9b0';
  c.font = '700 34px "Microsoft YaHei",system-ui,sans-serif';
  c.fillText(s.b.name || '', W / 2, 46);
  c.font = '600 22px "Microsoft YaHei",system-ui,sans-serif';
  c.fillStyle = owner ? '#9fe8ff' : '#c8c0a8';
  c.fillText(owner ? (owner + (rem > 0 ? ' · 剩余 ' + rem + ' 天' : '')) : '待售', W / 2, 92);
  s.tex.needsUpdate = true;
}

/* 现代玻璃幕墙：不透明镀膜玻璃 + 铝框，合并后不增加透明批次 */
function townModernGlass(parent, x, y, z, w, h, ry, tint) {
  var alongX = Math.abs(Math.cos(ry || 0)) > 0.5;
  var fw = 0.07, dep = 0.10;
  var col = tint || 0x5f8792;
  townBox(parent, alongX ? w : dep, h, alongX ? dep : w, col, x, y, z, ry);
  townBox(parent, alongX ? w + 0.10 : dep + 0.04, fw, alongX ? dep + 0.04 : w + 0.10, 0x3d4549, x, y + h / 2, z, ry);
  townBox(parent, alongX ? w + 0.10 : dep + 0.04, fw, alongX ? dep + 0.04 : w + 0.10, 0x3d4549, x, y - h / 2, z, ry);
  townBox(parent, alongX ? fw : dep + 0.04, h, alongX ? dep + 0.04 : fw, 0x3d4549, x - (alongX ? w / 2 : 0), y, z - (alongX ? 0 : w / 2), ry);
  townBox(parent, alongX ? fw : dep + 0.04, h, alongX ? dep + 0.04 : fw, 0x3d4549, x + (alongX ? w / 2 : 0), y, z + (alongX ? 0 : w / 2), ry);
  /* 竖向分格 */
  for (var i = 1; i < 3; i++) {
    var off = -w / 2 + w * i / 3;
    townBox(parent, alongX ? 0.035 : dep + 0.05, h, alongX ? dep + 0.05 : 0.035, 0x3d4549,
      x + (alongX ? off : 0), y, z + (alongX ? 0 : off), ry);
  }
}

/* 现代立面：楼层横带、玻璃、阳台、入口雨棚、门牌号 */
function townModernFacade(parent, b, hTop, dp) {
  var side = b.door, at = b.door_at;
  var x0 = b.x0, x1 = b.x1, z0 = b.z0, z1 = b.z1;
  var floorH = (b.k === 'warehouse') ? 3.05 : (b.k === 'hall' ? 2.45 : 2.35);
  var floors = b.floors || 1;
  var isVilla = b.tier === 'villa', isHouse = !!b.tier;
  var faceX = (side === 'east') ? x1 + 0.10 : (side === 'west' ? x0 - 0.10 : 0);
  var faceZ = (side === 'south') ? z1 + 0.10 : (side === 'north' ? z0 - 0.10 : 0);
  var alongX = (side === 'north' || side === 'south');
  var ry = alongX ? 0 : Math.PI / 2;
  var fx = alongX ? 0 : faceX;
  var fz = alongX ? faceZ : 0;
  /* 楼层横带：深灰铝板 */
  for (var fl = 1; fl <= floors; fl++) {
    var by = 0.46 + floorH * fl - 0.10;
    if (alongX) { townBox(parent, (x1 - x0) + 0.30, 0.16, 0.22, 0x3d4549, (x0 + x1) / 2, by, faceZ); }
    else { townBox(parent, 0.22, 0.16, (z1 - z0) + 0.30, 0x3d4549, faceX, by, (z0 + z1) / 2); }
  }
  /* 别墅二层木饰面带 + 竖向木格栅 */
  if (isVilla) {
    var wy = 0.46 + floorH + 0.90;
    if (alongX) { townBox(parent, (x1 - x0) + 0.30, 0.95, 0.18, 0x8a6a48, (x0 + x1) / 2, wy, faceZ); }
    else { townBox(parent, 0.18, 0.95, (z1 - z0) + 0.30, 0x8a6a48, faceX, wy, (z0 + z1) / 2); }
    for (var vf = 0; vf < 7; vf++) {
      var vc = at - 4.5 + vf * 1.5;
      if (vc < (alongX ? x0 + 0.5 : z0 + 0.5) || vc > (alongX ? x1 - 0.5 : z1 - 0.5)) { continue; }
      townBox(parent, alongX ? 0.10 : 0.16, floors * floorH, alongX ? 0.16 : 0.10, 0x6f4c31,
        alongX ? vc : faceX + 0.04, 0.46 + floors * floorH / 2, alongX ? faceZ + 0.04 : vc);
    }
  }
  /* 入口雨棚：现代平板 + 细钢柱 */
  var cy = 2.55;
  var cw = 3.6, cd = 1.05;
  if (alongX) {
    townBox(parent, cw, 0.10, cd, 0x3d4549, at, cy, faceZ + (side === 'south' ? cd / 2 : -cd / 2));
    townBox(parent, cw, 0.04, cd - 0.12, 0x8a939b, at, cy + 0.06, faceZ + (side === 'south' ? cd / 2 : -cd / 2));
  } else {
    townBox(parent, cd, 0.10, cw, 0x3d4549, faceX + (side === 'east' ? cd / 2 : -cd / 2), cy, at);
    townBox(parent, cd - 0.12, 0.04, cw, 0x8a939b, faceX + (side === 'east' ? cd / 2 : -cd / 2), cy + 0.06, at);
  }
  /* 二楼大玻璃 / 阳台 */
  if (floors >= 2) {
    var y2 = 0.46 + floorH + 0.85;
    var offs = [-3.6, 3.6];
    for (var g = 0; g < offs.length; g++) {
      var c = at + offs[g];
      if (c < (alongX ? x0 + 1.4 : z0 + 1.4) || c > (alongX ? x1 - 1.4 : z1 - 1.4)) { continue; }
      var gx = alongX ? c : faceX;
      var gz = alongX ? faceZ : c;
      townModernGlass(parent, gx, y2, gz, 2.5, 1.25, ry, isVilla ? 0x7a9aa0 : 0x5f8792);
      /* 窗下花箱 / 空调 */
      townBox(parent, alongX ? 2.3 : 0.28, 0.26, alongX ? 0.28 : 2.3, 0x6b4a32,
        gx + (alongX ? 0 : (side === 'east' ? 0.18 : -0.18)), y2 - 0.80,
        gz + (alongX ? (side === 'south' ? 0.18 : -0.18) : 0));
    }
    if (isVilla || b.k === 'inn' || b.k === 'flat') {
      var by2 = 0.46 + floorH + 0.12;
      var bw = 5.6, bd = 1.05;
      if (alongX) {
        townBox(parent, bw, 0.12, bd, 0x8a8a80, at, by2, faceZ + (side === 'south' ? bd / 2 + 0.1 : -bd / 2 - 0.1));
        townBox(parent, bw, 0.06, 0.06, 0x9fb8c0, at, by2 + 0.55, faceZ + (side === 'south' ? bd + 0.1 : -bd - 0.1));
        for (var br = 0; br < 6; br++) {
          townBox(parent, 0.05, 0.55, 0.05, 0x9fb8c0, at - bw / 2 + bw * br / 5, by2 + 0.30,
            faceZ + (side === 'south' ? bd + 0.1 : -bd - 0.1));
        }
      } else {
        townBox(parent, bd, 0.12, bw, 0x8a8a80, faceX + (side === 'east' ? bd / 2 + 0.1 : -bd / 2 - 0.1), by2, at);
        townBox(parent, 0.06, 0.06, bw, 0x9fb8c0, faceX + (side === 'east' ? bd + 0.1 : -bd - 0.1), by2 + 0.55, at);
        for (var br2 = 0; br2 < 6; br2++) {
          townBox(parent, 0.05, 0.55, 0.05, 0x9fb8c0, faceX + (side === 'east' ? bd + 0.1 : -bd - 0.1), by2 + 0.30,
            at - bw / 2 + bw * br2 / 5);
        }
      }
      /* 阳台座椅 / 绿植 */
      townBox(parent, alongX ? 0.9 : 0.55, 0.30, alongX ? 0.55 : 0.9, 0x8a6a48,
        alongX ? at - 1.5 : faceX + (side === 'east' ? 0.45 : -0.45), by2 + 0.25,
        alongX ? faceZ + (side === 'south' ? 0.55 : -0.55) : at - 1.5);
      townSphere(parent, 0.20, 0x5c8a52, alongX ? at + 1.7 : faceX + (side === 'east' ? 0.4 : -0.4), by2 + 0.42,
        alongX ? faceZ + (side === 'south' ? 0.55 : -0.55) : at + 1.7, 0);
    }
  }
  /* 一层门侧：住宅不放玻璃；店铺橱窗由 townStorefront 负责 */
  if (!isHouse) {
    var y1 = 1.45, goff = [-3.4, 3.4];
    for (var gg = 0; gg < goff.length; gg++) {
      var c2 = at + goff[gg];
      if (c2 < (alongX ? x0 + 1.0 : z0 + 1.0) || c2 > (alongX ? x1 - 1.0 : z1 - 1.0)) { continue; }
      townBox(parent, alongX ? 1.6 : 0.14, 1.5, alongX ? 0.14 : 1.6, 0x8a8272,
        alongX ? c2 : faceX, y1, alongX ? faceZ : c2);
      townBox(parent, alongX ? 1.5 : 0.16, 1.4, alongX ? 0.16 : 1.5, 0x5c6b55,
        alongX ? c2 : faceX + (side === 'east' ? 0.02 : -0.02), y1,
        alongX ? faceZ + (side === 'south' ? 0.02 : -0.02) : c2);
    }
  }
  /* 竖向木纹格栅（入口两侧） */
  for (var wsi = 0; wsi < 2; wsi++) {
    var wc = at + (wsi ? 1.9 : -1.9);
    if (wc < (alongX ? x0 + 0.8 : z0 + 0.8) || wc > (alongX ? x1 - 0.8 : z1 - 0.8)) { continue; }
    for (var sl = 0; sl < 5; sl++) {
      townBox(parent, alongX ? 0.05 : 0.12, 1.3, alongX ? 0.12 : 0.05, 0x8a6a48,
        alongX ? wc - 0.42 + sl * 0.21 : faceX, 1.35, alongX ? faceZ : wc - 0.42 + sl * 0.21);
    }
  }
  /* 门牌号：H/V/Y/F + 序号 */
  var num = '';
  if (b.id) {
    var parts = String(b.id).split('_');
    var pre = parts[0] === 'villa' ? 'V' : (parts[0] === 'yard' ? 'Y' : (parts[0] === 'flat' ? 'F' : 'B'));
    num = pre + (parts[1] ? ('0' + parts[1]).slice(-2) : '');
  }
  if (num) {
    var nx2 = dp.nx * 0.20, nz2 = dp.nz * 0.20;
    var px2 = dp.x + nx2 + (alongX ? 1.25 : 0);
    var pz2 = dp.z + nz2 + (alongX ? 0 : 1.25);
    townBox(parent, 0.62, 0.30, 0.05, 0x2f3438, px2, 2.20, pz2, ry);
    townSignPlane(parent, num, 0.52, 0.22, px2 + (alongX ? 0 : dp.nx * 0.04), 2.20, pz2 + (alongX ? dp.nz * 0.04 : 0), ry, '#2f3438', '#e8f4ff', true);
  }
}

/* 别墅/小院/小平楼的院子：车库、车道、花园、围栏、门牌 */
function townVillaGrounds(parent, b) {
  if (!b.tier) { return; }
  var x0 = b.x0, x1 = b.x1, z0 = b.z0, z1 = b.z1;
  var side = b.door, at = b.door_at;
  var dir = (side === 'east') ? 1 : (side === 'west' ? -1 : 0);
  if (!dir) { return; }
  var frontX = dir > 0 ? x1 : x0;
  var gx0 = dir > 0 ? x1 + 0.8 : x0 - 9.8;
  var gx1 = gx0 + 9.0;
  var gz0 = z0 + 0.8, gz1 = z1 - 0.8;
  var isVilla = b.tier === 'villa';
  /* 车道 + 人行小径 */
  townTiledPlane(parent, 5.0, 3.4, 'pav', dir > 0 ? x1 + 4.2 : x0 - 4.2, 0.028, z0 + 2.3);
  townTiledPlane(parent, 2.0, 1.6, 'pav', dir > 0 ? x1 + 0.9 : x0 - 0.9, 0.030, at + 2.0);
  /* 车库（别墅） */
  if (isVilla) {
    var gaX = dir > 0 ? gx0 + 1.6 : gx0 + 6.4;
    var gaZ = z0 + 2.3;
    townBox(parent, 4.2, 2.6, 4.0, 0xd8d2c4, gaX, 1.30, gaZ);
    townBox(parent, 4.4, 0.18, 4.2, 0x3d4549, gaX, 2.70, gaZ);
    /* 卷帘门 */
    townBox(parent, 0.10, 2.15, 3.4, 0xe8e4dc, dir > 0 ? gaX + 2.12 : gaX - 2.12, 1.08, gaZ);
    for (var gi = 0; gi < 9; gi++) {
      townBox(parent, 0.03, 0.06, 3.35, 0x9aa0a4, dir > 0 ? gaX + 2.18 : gaX - 2.18, 0.16 + gi * 0.23, gaZ);
    }
    townGlow(parent, 0.45, 0.16, 0.10, 0xffe0a8, dir > 0 ? gaX + 2.20 : gaX - 2.20, 2.55, gaZ, 0.6);
    townSolid(gaX - 2.1, gaZ - 2.0, gaX + 2.1, gaZ + 2.0);
    /* 车库顶空调/花箱 */
    townBox(parent, 0.8, 0.45, 0.45, 0x9aa0a4, gaX + 0.8, 2.92, gaZ - 0.8);
    townBox(parent, 1.2, 0.30, 0.35, 0x8a6a48, gaX - 0.8, 2.88, gaZ + 1.2);
    townSphere(parent, 0.18, 0x5c8a52, gaX - 1.1, 3.08, gaZ + 1.2, 0);
  }
  /* 花园：草坪、花坛、树、长椅 */
  var gx = gx0 + 4.6, gz = z1 - 2.0;
  townTiledPlane(parent, isVilla ? 7.0 : 5.5, 6.0, 'grass', gx, 0.026, gz - 1.0);
  for (var fi = 0; fi < 4; fi++) {
    townBox(parent, 1.1, 0.26, 0.7, 0x9a7650, gx - 2.1 + fi * 1.3, 0.14, gz - 3.2);
    townSphere(parent, 0.20, [0x5c8a52, 0xd8708a, 0xe8c060, 0x9fe0a8][fi % 4], gx - 2.1 + fi * 1.3, 0.38, gz - 3.2, 0);
  }
  townCyl(parent, 0.18, 0.22, 2.8, 0x6f4c31, gx + 2.2, 1.4, gz - 2.4, 8);
  townSphere(parent, 1.0, 0x5c8a52, gx + 2.2, 3.0, gz - 2.4, 0);
  townBox(parent, 1.4, 0.10, 0.42, 0x8a6a48, gx - 1.4, 0.55, gz - 0.4);
  townBox(parent, 0.10, 0.55, 0.42, 0x4a3423, gx - 2.0, 0.28, gz - 0.4);
  /* 围栏 + 小门 */
  for (var fz = 0; fz < 5; fz++) {
    townBox(parent, 0.10, 0.90, 0.10, 0x6f4c31, dir > 0 ? gx1 + 0.2 : gx0 - 0.2, 0.45, gz0 + 1.0 + fz * 1.1);
  }
  townBox(parent, 0.08, 0.08, 4.8, 0x6f4c31, dir > 0 ? gx1 + 0.2 : gx0 - 0.2, 0.82, gz0 + 3.2);
  /* 信箱 + 门牌 */
  var mx = dir > 0 ? x1 + 0.55 : x0 - 0.55;
  townCyl(parent, 0.06, 0.06, 1.1, 0x3d4549, mx, 0.55, at + 1.6, 6);
  townBox(parent, 0.34, 0.42, 0.22, 0x3d4549, mx, 1.18, at + 1.6);
  townBox(parent, 0.26, 0.04, 0.03, 0xe8f4ff, mx, 1.24, at + 1.72);
  /* 车道灯 */
  for (var li = 0; li < 2; li++) {
    townCyl(parent, 0.05, 0.05, 1.5, 0x3d4549, dir > 0 ? x1 + 0.7 : x0 - 0.7, 0.75, at - 2.2 + li * 4.4, 6);
    townGlow(parent, 0.16, 0.16, 0.16, 0xffe0a8, dir > 0 ? x1 + 0.7 : x0 - 0.7, 1.55, at - 2.2 + li * 4.4, 0.7);
  }
}

/* ============================ 建筑主体 ============================ */
function townBuilding(parent, b) {
  var x0 = b.x0, x1 = b.x1, z0 = b.z0, z1 = b.z1;
  var g = new THREE.Group(); parent.add(g);
  var floors = b.floors || 1;
  var floorH = (b.k === 'warehouse') ? 3.05 : (b.k === 'hall' ? 2.45 : 2.35);
  var hTop = 0.46 + floorH * floors;
  var t = 0.19, gap = 1.15, at = b.door_at, side = b.door;
  /* 地坪 + 接触阴影 */
  townSoftShadow(g, (x0 + x1) / 2 + 0.16, (z0 + z1) / 2 + 0.12,
    (x1 - x0) + 1.7, (z1 - z0) + 1.7, 0, 0.26);
  townTiledPlane(g, (x1 - x0) + 1.1, (z1 - z0) + 1.1, 'pav', (x0 + x1) / 2, 0.029, (z0 + z1) / 2);
  /* 墙段（门洞 2.3 米，和服务端完全一致）*/
  function seg(xa, za, xb, zb) { townWallSeg(g, xa, za, xb, zb, b, hTop); }
  for (var iz = 0; iz < 2; iz++) {
    var z = iz ? z1 : z0;
    if ((z === z0 && side === 'north') || (z === z1 && side === 'south')) {
      if (at - gap > x0) { seg(x0, z - t, at - gap, z + t); }
      if (at + gap < x1) { seg(at + gap, z - t, x1, z + t); }
    } else { seg(x0, z - t, x1, z + t); }
  }
  for (var ix = 0; ix < 2; ix++) {
    var x = ix ? x1 : x0;
    if ((x === x0 && side === 'west') || (x === x1 && side === 'east')) {
      if (at - gap > z0) { seg(x - t, z0, x + t, at - gap); }
      if (at + gap < z1) { seg(x - t, at + gap, x + t, z1); }
    } else { seg(x - t, z0, x + t, z1); }
  }
  /* 角柱 */
  [[x0, z0], [x1, z0], [x0, z1], [x1, z1]].forEach(function (c) {
    townBox(g, 0.34, hTop + 0.10, 0.34, 0x3f2d1e, c[0], (hTop + 0.10) / 2, c[1]);
  });
  /* 二层分隔带 */
  if (floors === 2) {
    townBox(g, (x1 - x0) + 0.1, 0.16, 0.44, 0x3f2d1e, (x0 + x1) / 2, 0.46 + floorH, z1);
    townBox(g, (x1 - x0) + 0.1, 0.16, 0.44, 0x3f2d1e, (x0 + x1) / 2, 0.46 + floorH, z0);
    townBox(g, 0.44, 0.16, (z1 - z0) + 0.1, 0x3f2d1e, x1, 0.46 + floorH, (z0 + z1) / 2);
    townBox(g, 0.44, 0.16, (z1 - z0) + 0.1, 0x3f2d1e, x0, 0.46 + floorH, (z0 + z1) / 2);
  }
  /* 门洞上方的墙（不然从门上方能看进屋里）*/
  var dx0 = (side === 'east') ? x1 : (side === 'west' ? x0 : at);
  var dz0 = (side === 'south') ? z1 : (side === 'north' ? z0 : at);
  if (side === 'east' || side === 'west') {
    townBox(g, 0.40, hTop - 2.18, 2.30, b.wall, dx0, 2.18 + (hTop - 2.18) / 2, at);
    townBox(g, 0.44, 0.12, 2.34, 0x3f2d1e, dx0, 2.18, at);
  } else {
    townBox(g, 2.30, hTop - 2.18, 0.40, b.wall, at, 2.18 + (hTop - 2.18) / 2, dz0);
    townBox(g, 2.34, 0.12, 0.44, 0x3f2d1e, at, 2.18, dz0);
  }
  /* 门 / 窗 / 招牌 / 雨棚 */
  var dp = townDoor(g, b, hTop, side, at);
  townWindows(g, b, hTop, side, at);
  townModernFacade(g, b, hTop, dp);
  if (typeof townShopKind === 'function' && townShopKind(b.k)) {
    townStorefront(g, b, dp);
  }
  if (b.sign) {
    var sx = dp.x + dp.nx * 0.25, sz = dp.z + dp.nz * 0.25;
    townSignBoard(g, b.sign, 2.35, 0.50, sx, 2.66, sz, dp.ry, '#2a2118', '#ffe9b0');
  } else if (b.tier) {
    townHouseSign(g, b);
  }
  if (false && (b.k === 'mart' || b.k === 'cafe' || b.k === 'bakery' || b.k === 'flower' ||
      b.k === 'ramen' || b.k === 'dessert' || b.k === 'general' || b.k === 'izakaya' ||
      b.k === 'bathhouse' || b.k === 'bookstore')) {
    var _ac = (b.k === 'mart') ? [0x4fae6f, 0xf0ece2]
      : (b.k === 'cafe') ? [0x6b4d34, 0xe6d3b6]
      : (b.k === 'bakery') ? [0xb4542f, 0xecdfc7]
      : (b.k === 'flower') ? [0x5c8a52, 0xe2d7be]
      : (b.k === 'ramen') ? [0xb03028, 0xf0e2c8]
      : (b.k === 'izakaya') ? [0x8b2f26, 0xe0c8a0]
      : (b.k === 'dessert') ? [0xc06a8a, 0xf0dac0]
      : (b.k === 'bathhouse') ? [0x3e6f7a, 0xe0cfb4]
      : (b.k === 'bookstore') ? [0x3e5968, 0xddcfb4]
      : [0x8a6a42, 0xdccdb0];
    townAwning(g, dp.x + dp.nx * 0.50, 2.24, dp.z + dp.nz * 0.50, 2.85, 0.82, dp.ry, _ac[0], _ac[1]);
  }
  if (b.k === 'ramen') {
    townNoren(g, dp.x + dp.nx * 0.10, 1.92, dp.z + dp.nz * 0.10, 2.5,
      dp.ry, 0x9a3a2e, '拉 面');
    townCyl(g, 0.18, 0.18, 0.55, 0xc0392b, dp.x + dp.nx * 0.55 + dp.nz * 1.45, 1.55,
      dp.z + dp.nz * 0.55 - dp.nx * 1.45, 10);
    townGlow(g, 0.28, 0.28, 0.28, 0xff8a4a, dp.x + dp.nx * 0.55 + dp.nz * 1.45, 1.55,
      dp.z + dp.nz * 0.55 - dp.nx * 1.45, 0.8);
  }
  if (b.k === 'izakaya') {
    townNoren(g, dp.x + dp.nx * 0.10, 1.95, dp.z + dp.nz * 0.10, 2.4, dp.ry, 0x2f3d39, '居酒屋');
    for (var il = 0; il < 2; il++) {
      var lx2 = dp.x + dp.nx * 0.45 + (il ? 1.5 : -1.5) * dp.nz;
      var lz2 = dp.z + dp.nz * 0.45 - (il ? 1.5 : -1.5) * dp.nx;
      townGlow(g, 0.30, 0.42, 0.30, 0xff5a3a, lx2, 2.0, lz2, 0.9);
      townBox(g, 0.34, 0.06, 0.34, 0x2f241a, lx2, 2.24, lz2);
      townCyl(g, 0.10, 0.12, 1.0, 0x3f2d1e, lx2, 3.2, lz2, 6);
    }
  }
  if (b.k === 'bathhouse') {
    townNoren(g, dp.x + dp.nx * 0.12, 1.98, dp.z + dp.nz * 0.12, 2.2, dp.ry, 0x2f4a4a, 'ゆ');
    townBox(g, 0.5, 2.6, 0.5, 0x6b6157, x1 - 2.0, 3.0, z0 + 1.2);
    townGlow(g, 0.3, 0.2, 0.3, 0xbfe4ea, x1 - 2.0, 4.35, z0 + 1.2, 0.4);
  }
  if (b.k === 'smith') {
    townBox(g, 0.55, 2.8, 0.55, 0x6b6157, x1 - 1.5, 3.25, z0 + 0.8);
    townGlow(g, 0.35, 0.18, 0.35, 0xbfb8ae, x1 - 1.5, 4.7, z0 + 0.8, 0.25);
    /* 门口武器架 */
    townBox(g, 1.4, 0.08, 0.4, 0x4a3423, x0 - 0.75, 1.45, at + 1.2);
    for (var sw2 = 0; sw2 < 3; sw2++) {
      townBox(g, 0.07, 1.2, 0.07, 0x9aa0a4, x0 - 0.75 - 0.4 + sw2 * 0.4, 0.85, at + 1.2);
    }
  }
  if (b.k === 'warehouse') {
    /* 装卸雨棚 + 卷帘门框 */
    townAwning(g, dp.x + dp.nx * 0.7, 2.8, dp.z + dp.nz * 0.7, 4.2, 1.4, dp.ry, 0x6f5a42, 0x5a4634);
    townBox(g, 0.22, 2.7, 3.0, 0x3f2d1e, x0 + 0.15, 1.35, at);
    for (var wb = 0; wb < 8; wb++) {
      townBox(g, 0.10, 0.06, 2.8, 0x8f8f84, x0 + 0.02, 0.35 + wb * 0.30, at);
    }
  }
  if (b.k === 'hall') {
    /* 钟楼（地标，从广场和南北街都看得见）*/
    var tz = z1 - 2.0, th = hTop + 2.7;
    townBox(g, 1.9, 2.8, 1.9, 0xe6d8be, (x0 + x1) / 2, hTop + 1.4, tz);
    townBox(g, 2.05, 0.18, 2.05, 0x3f2d1e, (x0 + x1) / 2, hTop + 2.72, tz);
    for (var tw = -1; tw <= 1; tw += 2) {
      townBox(g, 0.16, 2.8, 0.16, 0x4a3423, (x0 + x1) / 2 + tw * 0.92, hTop + 1.4, tz + 0.92);
      townBox(g, 0.16, 2.8, 0.16, 0x4a3423, (x0 + x1) / 2 + tw * 0.92, hTop + 1.4, tz - 0.92);
    }
    townCyl(g, 0.55, 0.55, 0.10, 0xf0e6d0, (x0 + x1) / 2, hTop + 1.55, tz + 0.97, 24).rotation.x = Math.PI / 2;
    townCyl(g, 0.62, 0.62, 0.06, 0x8a6a48, (x0 + x1) / 2, hTop + 1.55, tz + 0.92, 24).rotation.x = Math.PI / 2;
    townBox(g, 0.06, 0.34, 0.05, 0x2f241a, (x0 + x1) / 2, hTop + 1.64, tz + 1.03);
    townBox(g, 0.22, 0.05, 0.05, 0x2f241a, (x0 + x1) / 2 + 0.05, hTop + 1.55, tz + 1.03);
    townMiniRoof(g, 2.5, 2.2, 0x33473f, (x0 + x1) / 2, hTop + 2.82, tz, 0);
    townGlow(g, 0.08, 0.50, 0.08, 0xffe0a0, (x0 + x1) / 2, hTop + 2.96, tz, 0.75);
    /* 门廊：矮一点，别把二楼窗和钟楼挡住 */
    townCyl(g, 0.22, 0.26, 3.0, 0xd8c9ad, x0 + 1.6, 1.5, z1 + 0.9, 10);
    townCyl(g, 0.22, 0.26, 3.0, 0xd8c9ad, x1 - 1.6, 1.5, z1 + 0.9, 10);
    townBox(g, 0.55, 0.18, 0.55, 0x3e5968, x0 + 1.6, 3.05, z1 + 0.9);
    townBox(g, 0.55, 0.18, 0.55, 0x3e5968, x1 - 1.6, 3.05, z1 + 0.9);
    townBox(g, 5.4, 0.20, 1.3, 0x33473f, (x0 + x1) / 2, 3.06, z1 + 1.25);
    townMiniRoof(g, 6.0, 1.9, 0x33473f, (x0 + x1) / 2, 3.18, z1 + 1.35, 0);
    /* 二楼中央圆窗 + 门楣装饰 */
    townCyl(g, 0.62, 0.62, 0.10, 0x3e5968, (x0 + x1) / 2, 4.25, z1 + 0.06, 24).rotation.x = Math.PI / 2;
    townCyl(g, 0.50, 0.50, 0.06, 0xffdca6, (x0 + x1) / 2, 4.25, z1 + 0.10, 24).rotation.x = Math.PI / 2;
    townBox(g, 0.95, 0.08, 0.08, 0x3e5968, (x0 + x1) / 2, 4.25, z1 + 0.14);
    townBox(g, 0.08, 0.70, 0.08, 0x3e5968, (x0 + x1) / 2, 4.25, z1 + 0.14);
    /* 二楼大窗 + 木构架：把正面空墙打散 */
    for (var _hw = -1; _hw <= 1; _hw += 2) {
      townWindow(g, _hw * 3.7, 3.92, z1 + 0.05, 2.1, 1.10, 0, true);
      townBox(g, 0.12, 2.3, 0.10, 0x4a3423, _hw * 5.3, 3.0, z1 + 0.07);
    }
    townBox(g, 10.6, 0.12, 0.12, 0x4a3423, (x0 + x1) / 2, 3.25, z1 + 0.07);
    townBox(g, 10.6, 0.10, 0.10, 0x4a3423, (x0 + x1) / 2, 4.95, z1 + 0.07);
    /* 时钟 */
    townCyl(g, 0.42, 0.42, 0.12, 0xe8dcc8, (x0 + x1) / 2, 3.55, z1 + 0.21, 18);
    townBox(g, 0.05, 0.28, 0.06, 0x2f241a, (x0 + x1) / 2, 3.62, z1 + 0.29);
    townBox(g, 0.20, 0.05, 0.06, 0x2f241a, (x0 + x1) / 2 + 0.06, 3.55, z1 + 0.29);
    townCyl(g, 0.46, 0.46, 0.06, 0x8a6a48, (x0 + x1) / 2, 3.55, z1 + 0.15, 18);
    /* 两侧竖幅 */
    townBox(g, 0.5, 3.0, 0.06, 0x7c3e3b, x0 + 4.8, 2.5, z1 + 0.12);
    townSignPlane(g, '新手', 0.4, 1.3, x0 + 4.8, 2.5, z1 + 0.16, 0, '#7c3e3b', '#ffe9b0', true);
    townBox(g, 0.5, 3.0, 0.06, 0x3e5968, x1 - 4.8, 2.5, z1 + 0.12);
    townSignPlane(g, '大厅', 0.4, 1.3, x1 - 4.8, 2.5, z1 + 0.16, 0, '#3e5968', '#ffe9b0', true);
  }
  if (b.k === 'inn' && (b.floors || 1) >= 2) {
    /* 二层木阳台 */
    townBox(g, (x1 - x0) + 0.6, 0.12, 1.1, 0x6f4c31, (x0 + x1) / 2, 0.46 + 2.35 + 0.35, z1 + 0.45);
    for (var bl = 0; bl < 7; bl++) {
      townBox(g, 0.10, 0.55, 0.10, 0x4a3423, x0 + 0.4 + bl * ((x1 - x0 - 0.8) / 6), 0.46 + 2.35 + 0.65, z1 + 0.92);
    }
    townBox(g, (x1 - x0) + 0.6, 0.08, 0.10, 0x4a3423, (x0 + x1) / 2, 0.46 + 2.35 + 0.90, z1 + 0.92);
    for (var ln = 0; ln < 4; ln++) {
      townGlow(g, 0.22, 0.34, 0.22, 0xffb46a, x0 + 1.0 + ln * 2.1, 0.46 + 2.35 + 0.55, z1 + 0.7, 0.85);
    }
  }
  if (b.k === 'apartment' && (b.floors || 1) >= 2) {
    for (var fl2 = 0; fl2 < 2; fl2++) {
      townBox(g, (x1 - x0) + 0.5, 0.10, 1.0, 0x7d7568, (x0 + x1) / 2, 0.46 + 2.35 * (fl2 + 1) + 0.3, z1 + 0.4);
      townBox(g, (x1 - x0) + 0.5, 0.07, 0.07, 0x3e5968, (x0 + x1) / 2, 0.46 + 2.35 * (fl2 + 1) + 0.75, z1 + 0.85);
    }
    /* 信箱 */
    for (var mb = 0; mb < 6; mb++) {
      townBox(g, 0.28, 0.30, 0.14, 0x8b939b, x1 - 1.4 + (mb % 3) * 0.34, 0.75 - Math.floor(mb / 3) * 0.36, z0 + 0.25);
    }
  }
  if (b.k === 'shrine') {
    /* 注连绳 + 纸垂 */
    townCyl(g, 0.06, 0.06, 4.4, 0xd8c8a0, 0, 2.72, z1 + 0.30, 6).rotation.z = Math.PI / 2;
    for (var sd = 0; sd < 5; sd++) {
      townBox(g, 0.10, 0.34, 0.03, 0xf0ead8, -1.7 + sd * 0.85, 2.46, z1 + 0.32);
    }
    /* 台阶 */
    for (var st3 = 0; st3 < 3; st3++) {
      townBox(g, 3.2 - st3 * 0.3, 0.12, 0.45, 0x9a9688, 0, 0.06 + st3 * 0.12, z1 + 0.5 + st3 * 0.42);
    }
  }
  if (b.k === 'home_a' || b.k === 'home_b' || b.k === 'home_c' || b.k === 'home_d') {
    /* 小院：木栅栏 + 盆栽 + 洗衣杆 */
    var fx0 = (b.door === 'east') ? x1 + 0.5 : x0 - 2.2;
    townBox(g, 0.10, 0.9, 2.4, 0x6f4c31, fx0, 0.45, z0 + 0.6);
    townBox(g, 0.10, 0.9, 2.4, 0x6f4c31, fx0, 0.45, z1 - 0.6);
    townBox(g, 0.10, 0.9, 2.4, 0x6f4c31, fx0 + 0.6, 0.45, z0 + 0.6);
    townBox(g, 0.10, 0.9, 2.4, 0x6f4c31, fx0 + 0.6, 0.45, z1 - 0.6);
    townBox(g, 0.70, 0.07, 0.07, 0x6f4c31, fx0 + 0.3, 0.85, z0 + 0.6);
    townBox(g, 0.70, 0.07, 0.07, 0x6f4c31, fx0 + 0.3, 0.85, z1 - 0.6);
  }
  /* 空调外机 / 雨水管 */
  var acx = (side === 'east') ? x0 + 0.35 : (side === 'west' ? x1 - 0.35 : x1 - 0.4);
  var acz = (side === 'south' || side === 'north') ? (side === 'south' ? z0 + 0.4 : z1 - 0.4) : z0 + 0.8;
  if (b.k !== 'shrine' && b.k !== 'hall') {
    townBox(g, 0.85, 0.62, 0.42, 0x9aa0a4, acx, hTop - 0.75, acz);
    townCyl(g, 0.22, 0.22, 0.05, 0x5f676f, acx, hTop - 0.75, acz + 0.24, 12).rotation.x = Math.PI / 2;
    townBox(g, 0.30, 1.0, 0.10, 0x5f676f, acx + 0.15, hTop - 1.7, acz);
  }
  townCyl(g, 0.06, 0.06, hTop, 0x5f676f, x1 + 0.18, hTop / 2, z1 + 0.18, 6);
  /* 室内 + 屋顶 */
  townInterior(g, b);
  townRoof(g, b, hTop);
  townVillaGrounds(g, b);
  /* 门口脚垫 / 花盆 */
  townBox(g, dp.isX ? 0.8 : 2.0, 0.02, dp.isX ? 2.0 : 0.8, 0x6b3f36,
    dp.x + dp.nx * 0.75, 0.035, dp.z + dp.nz * 0.75);
  townCyl(g, 0.20, 0.24, 0.38, 0xa85f42, dp.x + dp.nx * 0.8 + (dp.isX ? 0 : 1.4), 0.19,
    dp.z + dp.nz * 0.8 + (dp.isX ? 1.4 : 0), 10);
  townSphere(g, 0.22, 0x5c8a52, dp.x + dp.nx * 0.8 + (dp.isX ? 0 : 1.4), 0.45,
    dp.z + dp.nz * 0.8 + (dp.isX ? 1.4 : 0), 0);
  return g;
}

/* ============================ 地面 ============================ */
function townGround(g) {
  /* ground is covered by repeating tiles below */
  /* 草地：住区 / 神社 / 外围 */
  var grass = [
    [-30, 26, 10, 14], [-24, 6, 16, 8], [-29, -17, 14, 12],
    [22, -17, 16, 12], [26, 27, 14, 10], [-8, 16, 9, 8],
    [18, 29, 12, 8], [-18, 30, 12, 6], [0, -19, 6, 5],
    [30, 30, 8, 8], [-36, 8, 8, 26], [36, -6, 8, 30],
    [-8, -36, 14, 4], [12, -36, 16, 4], [0, 36, 20, 4],
    /* 500×500 新片区草坪 */
    [-160, -160, 110, 110], [160, -160, 100, 100],
    [-160, 160, 110, 90], [160, 160, 100, 100],
    [0, -150, 90, 70], [0, 150, 90, 60],
    [-120, 0, 45, 120], [120, 0, 45, 120]
  ];
  /* 草地由 townBlockGround 的高清贴图负责，这里不再盖纯色平面 */
  /* grass.forEach(...) 已移除 */
  /* 旧广场边框/圆环已挪到新广场（townCenter），这里不再留旧位置 */
  /* 旧中心路口的贴纸/路缘/斑马线已移除：镇内道路全部由瓦片组成 */
  /* 旧井盖/排水口已挪到新广场，旧位置清空 */
  /* 水洼 / 花瓣等额外地面贴纸已移除，地面统一由瓦片组成 */
  townBlockGround(g);
}

/* 镇内方块地面：像镇外一样有网格块，只是材质不同 */
var _TOWN_TILE_MATS = {};
function townTileMat(kind) {
  if (_TOWN_TILE_MATS[kind]) { return _TOWN_TILE_MATS[kind]; }
  var S = 512, N = 4, C = S / N;
  var cv = UI.townCanvas(S, S);
  var c = cv.getContext('2d');
  function hash(a, b) { return (((a * 73856093) ^ (b * 19349663)) >>> 0); }
  var greens = ['#5f7d4b', '#63824f', '#5a7647', '#688750', '#5c7a49'];
  var pav = ['#b7a98f', '#c0b298', '#ad9f86', '#bcae94', '#b3a58b'];
  var brick = ['#8f4a42', '#9a5148', '#86433b', '#945048', '#8a463e'];
  var road = ['#4a4c47', '#4f514b', '#474944', '#52544e', '#50524d'];
  for (var i = 0; i < N; i++) {
    for (var j = 0; j < N; j++) {
      var q = hash(i + (kind === 'brick' ? 7 : 3), j + 11) % 5;
      var col = greens[q];
      if (kind === 'pav') { col = pav[q]; }
      else if (kind === 'brick') { col = brick[q]; }
      else if (kind === 'road' || kind === 'lane' || kind === 'laneV') { col = road[q]; }
      c.fillStyle = col;
      c.fillRect(i * C, j * C, C, C);
      /* 表面噪点 */
      for (var k = 0; k < 7; k++) {
        var hx = hash(i * 13 + k, j * 17 + k);
        var px = i * C + (hx % (C - 8)) + 2;
        var pz = j * C + ((hx >> 8) % (C - 8)) + 2;
        c.fillStyle = (kind === 'brick') ? 'rgba(40,20,16,.18)' :
          (kind === 'road' ? 'rgba(220,220,210,.10)' : 'rgba(40,60,32,.14)');
        c.fillRect(px, pz, 3, 2);
      }
    }
  }
  /* 砖缝 / 石缝 */
  c.strokeStyle = (kind === 'brick') ? 'rgba(50,28,24,.55)' :
    (kind === 'road' ? 'rgba(20,22,20,.28)' : 'rgba(60,52,38,.30)');
  c.lineWidth = 2;
  for (var gx = 0; gx <= N; gx++) {
    c.beginPath(); c.moveTo(gx * C + 1, 0); c.lineTo(gx * C + 1, S); c.stroke();
  }
  for (var gz = 0; gz <= N; gz++) {
    c.beginPath(); c.moveTo(0, gz * C + 1); c.lineTo(S, gz * C + 1); c.stroke();
  }
  if (kind === 'lane') {
    c.fillStyle = '#e8e2cf';
    c.fillRect(S * 0.38, 0, S * 0.24, S);
  } else if (kind === 'laneV') {
    c.fillStyle = '#e8e2cf';
    c.fillRect(0, S * 0.38, S, S * 0.24);
  }
  var tex = new THREE.CanvasTexture(cv);
  try { tex.colorSpace = THREE.SRGBColorSpace; } catch (e) { }
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  var mat = new THREE.MeshLambertMaterial({ map: tex });
  _TOWN_TILE_MATS[kind] = mat;
  return mat;
}

/* 地面由真正的瓦片方块组成（InstancedMesh），不再铺平面贴图 */
var _TOWN_TILE_CELL = 0.62;
function townTiledPlane(parent, w, d, kind, x, y, z) {
  /* 兼容旧调用：地面已改成方块，这里不再画平面 */
}
function townGroundFlush(parent) { }

var _TOWN_GROUND_MATS = {};
var _TOWN_GROUND_GEOS = {};
var _TOWN_GROUND_COLORS = {
  grass: { top: 0x6b8a4e, side: 0x6b5338, bot: 0x3f3124 },
  pav:   { top: 0xb6a88e, side: 0x8e8472, bot: 0x4a443a },
  brick: { top: 0x91473f, side: 0x6f3b35, bot: 0x40221f },
  road:  { top: 0x50524c, side: 0x3b3d39, bot: 0x232522 },
  lane:  { top: 0xd8d2bc, side: 0x9a9482, bot: 0x5a564a }
};
function townGroundMat() {
  if (_TOWN_GROUND_MATS.m) { return _TOWN_GROUND_MATS.m; }
  var mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  _TOWN_GROUND_MATS.m = mat;
  return mat;
}
function townGroundGeo(kind) {
  if (_TOWN_GROUND_GEOS[kind]) { return _TOWN_GROUND_GEOS[kind]; }
  var CELL = _TOWN_TILE_CELL;
  var geo = new THREE.BoxGeometry(CELL, 0.62, CELL);
  var c = _TOWN_GROUND_COLORS[kind] || _TOWN_GROUND_COLORS.grass;
  var top = new THREE.Color(c.top), side = new THREE.Color(c.side), bot = new THREE.Color(c.bot);
  var n = geo.attributes.normal;
  var col = [];
  for (var i = 0; i < n.count; i++) {
    var ny = n.getY(i);
    var cc = (ny > 0.5) ? top : (ny < -0.5 ? bot : side);
    col.push(cc.r, cc.g, cc.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  _TOWN_GROUND_GEOS[kind] = geo;
  return geo;
}
function townLaneMat() {
  if (_TOWN_GROUND_MATS.lane) { return _TOWN_GROUND_MATS.lane; }
  var m = new THREE.MeshLambertMaterial({ color: 0xe8e2cf });
  _TOWN_GROUND_MATS.lane = m;
  return m;
}

function townBlockGround(g) {
  var X0 = -250, Z0 = 0, X1 = -8, Z1 = 234;
  var CELL = _TOWN_TILE_CELL;
  var NX = Math.ceil((X1 - X0) / CELL), NZ = Math.ceil((Z1 - Z0) / CELL);
  var kinds = new Array(NX * NZ);
  for (var i = 0; i < kinds.length; i++) { kinds[i] = 'grass'; }
  function idx(ix, iz) { return iz * NX + ix; }
  function markRect(r, kind, onlyGrass) {
    var ax = Math.max(0, Math.floor((r.x0 - X0) / CELL));
    var bx = Math.min(NX - 1, Math.floor((r.x1 - X0 - 0.001) / CELL));
    var az = Math.max(0, Math.floor((r.z0 - Z0) / CELL));
    var bz = Math.min(NZ - 1, Math.floor((r.z1 - Z0 - 0.001) / CELL));
    for (var z = az; z <= bz; z++) {
      for (var x = ax; x <= bx; x++) {
        var k = idx(x, z);
        if (onlyGrass && kinds[k] !== 'grass') { continue; }
        kinds[k] = kind;
      }
    }
  }
  var roads = TOWN_DATA ? TOWN_DATA.roads : [];
  for (var r = 0; r < roads.length; r++) {
    var rd = roads[r];
    /* 道路两侧石板边 */
    markRect({ x0: rd.x0 - 2.5, x1: rd.x1 + 2.5, z0: rd.z0 - 2.5, z1: rd.z1 + 2.5 }, 'pav', true);
    markRect(rd, 'road', false);
  }
  var pz = TOWN_DATA ? TOWN_DATA.plaza : null;
  if (pz) { markRect(pz, 'brick', false); }

  var buckets = {};
  for (var zi = 0; zi < NZ; zi++) {
    for (var xi = 0; xi < NX; xi++) {
      var kd = kinds[idx(xi, zi)];
      if (!buckets[kd]) { buckets[kd] = []; }
      buckets[kd].push({ x: X0 + (xi + 0.5) * CELL, z: Z0 + (zi + 0.5) * CELL });
    }
  }
  var mtx = new THREE.Matrix4();
  var ic = new THREE.Color();
  var q = new THREE.Quaternion();
  var pos = new THREE.Vector3();
  var scl = new THREE.Vector3(1, 1, 1);
  for (var kind in buckets) {
    var list = buckets[kind];
    if (!list.length) { continue; }
    /* ★ C4（2026-10-22）：地面原来用 InstancedMesh 摆【整块 0.62m 立方体】，
       一块 12 个三角 → 242×234m 约 14.7 万块 ≈ 176 万三角，是全场最大的三角形来源。
       但地砖是平铺的：侧面永远被邻居/地形挡住，只有顶面看得见。
       → 改成"只保留顶面"的合并几何：每块 2 个三角，三角数直接降到 1/6，
         颜色/明暗和原来完全一致（逐块随机明暗照旧），draw call 还是每类 1 次。 */
    var V = [], C = [], NN = [], I = [];
    var CELL = _TOWN_TILE_CELL;
    var y = -0.309 + 0.31;                 /* 原来立方体的顶面高度 */
    var bc = new THREE.Color((_TOWN_GROUND_COLORS[kind] || _TOWN_GROUND_COLORS.grass).top);
    for (var n = 0; n < list.length; n++) {
      var x = list[n].x, z = list[n].z;
      var b = V.length / 3;
      V.push(x - CELL / 2, y, z - CELL / 2,
             x + CELL / 2, y, z - CELL / 2,
             x + CELL / 2, y, z + CELL / 2,
             x - CELL / 2, y, z + CELL / 2);
      for (var kk = 0; kk < 4; kk++) { NN.push(0, 1, 0); }
      var shade = 0.93 + ((n * 37) % 11) * 0.012;
      for (var kc = 0; kc < 4; kc++) {
        C.push(bc.r * shade, bc.g * shade, bc.b * shade);
      }
      I.push(b, b + 3, b + 2, b, b + 2, b + 1);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(V, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(NN, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    geo.setIndex(I);
    var mesh = new THREE.Mesh(geo, townGroundMat());
    mesh.frustumCulled = false;
    /* ★ 别让 townBatchStatic 把这块合走：合批只认材质颜色 ✗ 会把逐格明暗/材质色全洗成白 */
    mesh.userData.noBatch = true;
    g.add(mesh);
  }

  /* 车道线：直接替换成白色方块，不是覆盖层 */
  for (var rr = 0; rr < roads.length; rr++) {
    var ro = roads[rr];
    var horiz = (ro.x1 - ro.x0) >= (ro.z1 - ro.z0);
    if (horiz) {
      var iz = Math.max(0, Math.min(NZ - 1, Math.floor(((ro.z0 + ro.z1) / 2 - Z0) / CELL)));
      for (var lx = ro.x0 + 2.5; lx < ro.x1; lx += 2.5) {
        var ix = Math.max(0, Math.min(NX - 1, Math.floor((lx - X0) / CELL)));
        if (kinds[idx(ix, iz)] === 'road') { kinds[idx(ix, iz)] = 'lane'; }
      }
    } else {
      var ix2 = Math.max(0, Math.min(NX - 1, Math.floor(((ro.x0 + ro.x1) / 2 - X0) / CELL)));
      for (var lz = ro.z0 + 2.5; lz < ro.z1; lz += 2.5) {
        var iz2 = Math.max(0, Math.min(NZ - 1, Math.floor((lz - Z0) / CELL)));
        if (kinds[idx(ix2, iz2)] === 'road') { kinds[idx(ix2, iz2)] = 'lane'; }
      }
    }
  }
}

/* ============================ 外围墙 / 门 ============================ */
function townOuterWalls(g) {
  var t = 0.7, H = 1.75, E = TOWN_EDGE, G2 = TOWN_DATA ? TOWN_DATA.gate : 3.5;
  function wall(x0, z0, x1, z1) {
    var cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    townBox(g, x1 - x0, H, z1 - z0, 0x8a8272, cx, H / 2, cz);
    townBox(g, (x1 - x0) + 0.10, 0.10, (z1 - z0) + 0.10, 0x9a9688, cx, H * 0.55, cz);
    townBox(g, (x1 - x0) + 0.20, 0.16, (z1 - z0) + 0.20, 0x4a3423, cx, H + 0.05, cz);
    /* 墙顶小瓦 */
    var horiz = (x1 - x0) > (z1 - z0);
    for (var i = 0; i < Math.floor((horiz ? x1 - x0 : z1 - z0) / 0.9); i++) {
      townBox(g, horiz ? 0.82 : 0.72, 0.07, horiz ? 0.72 : 0.82, 0x3a4741,
        horiz ? x0 + 0.45 + i * 0.9 : cx, H + 0.16, horiz ? cz : z0 + 0.45 + i * 0.9);
    }
  }
  for (var s = 0; s < 2; s++) {
    var z = s ? E : -E;
    wall(-E, z - t / 2, -G2, z + t / 2);
    wall(G2, z - t / 2, E, z + t / 2);
  }
  for (var s2 = 0; s2 < 2; s2++) {
    var x = s2 ? E : -E;
    wall(x - t / 2, -E, x + t / 2, -G2);
    wall(x - t / 2, G2, x + t / 2, E);
  }
  /* 四门：门柱 + 横梁 + 灯笼 + 门匾 */
  [[0, -E, 0], [0, E, Math.PI], [-E, 0, Math.PI / 2], [E, 0, -Math.PI / 2]].forEach(function (p) {
    var gx = p[0], gz = p[1], ry = p[2];
    var alongX = Math.abs(gz) > Math.abs(gx);
    for (var k = -1; k <= 1; k += 2) {
      townBox(g, 0.55, 2.9, 0.55, 0x8a8272, gx + (alongX ? k * 4.2 : 0), 1.45, gz + (alongX ? 0 : k * 4.2));
      townBox(g, 0.72, 0.16, 0.72, 0x4a3423, gx + (alongX ? k * 4.2 : 0), 2.92, gz + (alongX ? 0 : k * 4.2));
      townGlow(g, 0.28, 0.38, 0.28, 0xffd9a0, gx + (alongX ? k * 4.2 : 0), 2.55, gz + (alongX ? 0 : k * 4.2), 0.75);
    }
    townBox(g, alongX ? 8.9 : 0.32, 0.30, alongX ? 0.32 : 8.9, 0x4a3423, gx, 3.18, gz);
    townBox(g, alongX ? 9.4 : 0.22, 0.12, alongX ? 0.22 : 9.4, 0x3a4741, gx, 3.38, gz);
    townSignBoard(g, '新 手 镇', 2.4, 0.5, gx, 3.6, gz, ry, '#2a2118', '#ffe9b0');
  });
}

/* ============================ 街景道具 ============================ */
function townTree(parent, x, z, v, s) {
  var sc = s || 1;
  var trunk = 0x5f4530;
  townSoftShadow(parent, x, z, 2.0 * sc, 2.0 * sc, 0, 0.18);
  townCyl(parent, 0.14 * sc, 0.22 * sc, 1.15 * sc, trunk, x, 0.58 * sc, z, 8);
  townCyl(parent, 0.05 * sc, 0.08 * sc, 0.55 * sc, trunk, x + 0.18 * sc, 1.15 * sc, z, 6).rotation.z = -0.45;
  if (v === 'pine') {
    for (var p = 0; p < 3; p++) {
      townCone(parent, (0.95 - p * 0.22) * sc, 0.95 * sc, 0x3e5f3e,
        x, (0.95 + p * 0.55) * sc, z, 7);
    }
    townSphere(parent, 0.55 * sc, 0x4a6b44, x - 0.35 * sc, 1.6 * sc, z + 0.2 * sc, 0);
    townSphere(parent, 0.48 * sc, 0x547a4a, x + 0.42 * sc, 1.9 * sc, z - 0.1 * sc, 0);
  } else if (v === 'sakura') {
    var cols = [0xe8a8b8, 0xf0bcc8, 0xd890a4, 0xf4c8d2];
    townSphere(parent, 1.05 * sc, cols[0], x, 1.95 * sc, z, 1);
    townSphere(parent, 0.78 * sc, cols[1], x - 0.60 * sc, 2.35 * sc, z + 0.15 * sc, 1);
    townSphere(parent, 0.72 * sc, cols[2], x + 0.58 * sc, 2.25 * sc, z - 0.22 * sc, 1);
    townSphere(parent, 0.55 * sc, cols[3], x + 0.10 * sc, 2.62 * sc, z + 0.45 * sc, 1);
  } else {
    var greens = [0x4f7045, 0x587c4c, 0x466841, 0x628a54];
    townSphere(parent, 1.0 * sc, greens[0], x, 1.95 * sc, z, 1);
    townSphere(parent, 0.74 * sc, greens[1], x - 0.55 * sc, 2.28 * sc, z + 0.20 * sc, 1);
    townSphere(parent, 0.68 * sc, greens[2], x + 0.55 * sc, 2.22 * sc, z - 0.18 * sc, 1);
    townSphere(parent, 0.55 * sc, greens[3], x + 0.05 * sc, 2.55 * sc, z + 0.38 * sc, 1);
  }
}
function townLamp(parent, x, z, ry) {
  townSoftShadow(parent, x, z, 0.9, 0.9, 0, 0.18);
  townCyl(parent, 0.09, 0.12, 2.95, 0x3f454c, x, 1.48, z, 8);
  townBox(parent, 0.18, 0.26, 0.18, 0x2f3438, x, 0.13, z);
  var arm = 0.55;
  townBox(parent, arm, 0.07, 0.07, 0x3f454c, x + Math.sin(ry || 0) * arm / 2, 2.96, z + Math.cos(ry || 0) * arm / 2, ry);
  var lx = x + Math.sin(ry || 0) * arm, lz = z + Math.cos(ry || 0) * arm;
  townGlow(parent, 0.34, 0.18, 0.26, 0xfff3cf, lx, 2.84, lz, 0.95);
  townBox(parent, 0.40, 0.06, 0.30, 0x2f3438, lx, 2.96, lz, ry);
  townGlowPool(parent, lx, lz, 1.9, 0xffd9a0, 0.40);
}
function townPole(parent, x, z) {
  townCyl(parent, 0.15, 0.19, 6.0, 0x5c6067, x, 3.0, z, 8);
  townBox(parent, 0.30, 0.90, 0.16, 0x8b939b, x, 1.10, z);
  for (var i = 0; i < 3; i++) {
    townBox(parent, 2.0, 0.07, 0.07, 0x3f454c, x, 5.1 - i * 0.42, z);
    townCyl(parent, 0.07, 0.09, 0.16, 0x9aa0a4, x - 0.85, 5.18 - i * 0.42, z, 6);
    townCyl(parent, 0.07, 0.09, 0.16, 0x9aa0a4, x + 0.85, 5.18 - i * 0.42, z, 6);
  }
  townBox(parent, 0.20, 0.55, 0.20, 0x3f454c, x, 4.55, z);
  townGlow(parent, 0.20, 0.10, 0.20, 0xffe0a8, x, 4.30, z, 0.55);
}
function townVending(parent, x, z, ry, v) {
  var col = v === 'red' ? 0xd8504a : (v === 'blue' ? 0x4a78c8 : 0x3f9a68);
  var g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry || 0; parent.add(g);
  townBox(g, 1.15, 1.95, 0.85, 0x9aa0a4, 0, 0.98, 0);
  townBox(g, 1.05, 1.35, 0.08, col, 0, 1.18, 0.44);
  townGlow(g, 0.94, 1.15, 0.04, 0xfff0d0, 0, 1.18, 0.50, 0.55);
  for (var r = 0; r < 3; r++) {
    for (var c = 0; c < 4; c++) {
      townGlow(g, 0.16, 0.20, 0.03, [0xff8f7a, 0x8fd6ff, 0xffe08a, 0x9ff0b0][(r + c) % 4],
        -0.36 + c * 0.24, 1.55 - r * 0.28, 0.53, 0.7);
    }
  }
  townBox(g, 0.85, 0.18, 0.12, 0x2f3237, 0, 0.38, 0.47);
  townGlowPool(g, 0, 0.9, 1.7, col, 0.30);
}
function townBike(parent, x, z, ry, v) {
  var col = v === 'red' ? 0xb4542f : (v === 'blue' ? 0x4a6a9a : (v === 'green' ? 0x4f7a52 : 0x8f97a2));
  var g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry || 0; parent.add(g);
  for (var wi = -1; wi <= 1; wi += 2) {
    var w = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.045, 5, 12), matOf(0x2b2b2f));
    w.position.set(0, 0.34, wi * 0.55);
    w.rotation.y = Math.PI / 2;
    g.add(w);
    townCyl(g, 0.05, 0.05, 0.10, 0x9aa0a4, 0, 0.34, wi * 0.55, 6).rotation.z = Math.PI / 2;
  }
  townBox(g, 0.06, 0.06, 1.0, col, 0, 0.62, 0);
  townBox(g, 0.07, 0.42, 0.07, col, 0, 0.42, -0.32);
  townBox(g, 0.06, 0.06, 0.36, col, 0, 0.72, -0.14);
  townBox(g, 0.06, 0.50, 0.06, col, 0, 0.48, 0.38);
  townBox(g, 0.06, 0.06, 0.30, col, 0, 0.75, 0.52);
  townBox(g, 0.18, 0.10, 0.26, 0x2b2b2f, 0, 0.82, -0.36);
  townBox(g, 0.26, 0.20, 0.32, 0x6f5a42, 0, 0.86, 0.50);
  townCyl(g, 0.05, 0.05, 0.34, 0xb08a45, 0, 0.66, 0.10, 6).rotation.x = Math.PI / 2;
}
function townBin(parent, x, z, ry, v) {
  var col = v === 'green' ? 0x507a5c : 0x7a7c80;
  townCyl(parent, 0.32, 0.26, 0.78, col, x, 0.39, z, 10);
  townCyl(parent, 0.35, 0.35, 0.08, 0x3a3d42, x, 0.80, z, 10);
  townCyl(parent, 0.10, 0.10, 0.05, 0x2f3237, x, 0.85, z, 8);
  townBox(parent, 0.20, 0.16, 0.03, 0xe8dcc8, x, 0.52, z + 0.27);
}
function townCrate(parent, x, z, ry, v) {
  var col = v === 'ware' ? 0x9a7650 : 0x8a6a44;
  var g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry || 0; parent.add(g);
  townBox(g, 0.82, 0.66, 0.82, col, 0, 0.34, 0);
  townBox(g, 0.86, 0.08, 0.86, 0x5f4630, 0, 0.70, 0);
  townBox(g, 0.90, 0.05, 0.12, 0x5f4630, 0, 0.50, 0.42);
  townBox(g, 0.90, 0.05, 0.12, 0x5f4630, 0, 0.20, 0.42);
  townBox(g, 0.12, 0.05, 0.90, 0x5f4630, 0.42, 0.50, 0);
  townBox(g, 0.12, 0.05, 0.90, 0x5f4630, 0.42, 0.20, 0);
  if (v === 'ware') { townSignPlane(g, '仓', 0.26, 0.26, 0, 0.42, 0.44, 0, '#8a6a44', '#3f2d1e'); }
}
function townBarrel(parent, x, z) {
  townCyl(parent, 0.30, 0.34, 0.78, 0x7a5535, x, 0.40, z, 12);
  townCyl(parent, 0.36, 0.36, 0.05, 0x5f4630, x, 0.20, z, 12);
  townCyl(parent, 0.36, 0.36, 0.05, 0x5f4630, x, 0.60, z, 12);
  townCyl(parent, 0.32, 0.32, 0.04, 0x8a6a48, x, 0.80, z, 12);
}
function townStall(parent, x, z, ry, v) {
  var g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry || 0; parent.add(g);
  townBox(g, 2.4, 0.85, 1.0, 0x7a5535, 0, 0.44, 0);
  townBox(g, 2.5, 0.10, 1.1, 0x5f4630, 0, 0.88, 0);
  for (var i = 0; i < 4; i++) {
    townBox(g, 0.10, 2.0, 0.10, 0x5f4630, -1.1 + i * 0.73, 1.0, -0.42);
  }
  townBox(g, 2.8, 0.10, 1.8, 0x9a4a3a, 0, 2.02, 0);
  for (var q = 0; q < 6; q++) {
    townBox(g, 0.44, 0.10, 1.8, (q % 2 ? 0xe0d2b8 : 0x9a4a3a), -1.15 + q * 0.46, 2.08, 0);
  }
  var cols = v === 'fish' ? [0x8fb8c4, 0x9fc8d4, 0x7fa8b4] : [0xe0a040, 0xc85a4a, 0x8fb060, 0xe8c060];
  for (var p = 0; p < 5; p++) {
    townSphere(g, 0.16, cols[p % cols.length], -0.8 + p * 0.4, 1.02, 0.1, 0);
  }
  townGlow(g, 0.24, 0.28, 0.24, 0xffd9a0, 0, 1.55, 0.35, 0.7);
  townSignBoard(g, v === 'fish' ? '鲜鱼' : '水果', 0.9, 0.32, 0, 1.55, -0.50, 0, '#2f241a', '#ffe9b0');
}
function townPostbox(parent, x, z, ry, v) {
  var col = (v === 'red') ? 0xc0392b : 0x3f7a52;
  townCyl(parent, 0.25, 0.27, 1.05, col, x, 0.55, z, 12);
  townCyl(parent, 0.30, 0.30, 0.10, 0x8b2f26, x, 1.10, z, 12);
  townBox(parent, 0.26, 0.05, 0.06, 0x2f241a, x, 0.82, z + 0.24);
  townBox(parent, 0.20, 0.12, 0.02, 0xe8dcc8, x, 0.62, z + 0.26);
}
function townHydrant(parent, x, z) {
  townCyl(parent, 0.14, 0.17, 0.42, 0xc0392b, x, 0.22, z, 10);
  townCyl(parent, 0.20, 0.20, 0.08, 0x8b2f26, x, 0.45, z, 10);
  townBox(parent, 0.55, 0.10, 0.10, 0xc0392b, x, 0.28, z);
}
function townNotice(parent, x, z, ry) {
  var g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry || 0; parent.add(g);
  townBox(g, 0.10, 1.6, 0.10, 0x5f4630, -0.7, 0.80, 0);
  townBox(g, 0.10, 1.6, 0.10, 0x5f4630, 0.7, 0.80, 0);
  townBox(g, 1.65, 1.05, 0.10, 0x6f4c31, 0, 1.25, 0);
  townBox(g, 1.55, 0.95, 0.03, 0x8a6a48, 0, 1.25, 0.06);
  for (var i = 0; i < 5; i++) {
    townBox(g, 0.34, 0.38, 0.02, 0xe8dcc8, -0.55 + (i % 3) * 0.55, 1.42 - Math.floor(i / 3) * 0.45, 0.08);
  }
  townBox(g, 1.85, 0.08, 0.55, 0x3a4741, 0, 1.82, 0);
}
function townBusstop(parent, x, z, ry) {
  var g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry || 0; parent.add(g);
  for (var i = -1; i <= 1; i += 2) {
    townBox(g, 0.09, 1.95, 0.09, 0x5f676f, i * 1.02, 0.98, -0.32);
    townBox(g, 0.09, 1.95, 0.09, 0x5f676f, i * 1.02, 0.98, 0.40);
  }
  townBox(g, 2.3, 0.10, 1.1, 0x3a4741, 0, 2.05, 0);
  townBox(g, 2.3, 0.32, 0.06, 0x9aa0a4, 0, 1.78, 0.40);
  townBox(g, 0.07, 1.75, 0.92, 0x9fd4de, 1.05, 0.95, 0);
  townBox(g, 0.06, 1.72, 0.08, 0x5f676f, 0, 0.96, 0.40);
  townBox(g, 0.46, 0.55, 0.04, 0xe8dcc8, -0.55, 1.45, 0.45);
  townSignPlane(g, '巴士', 0.40, 0.18, -0.55, 1.62, 0.48, 0, '#e8dcc8', '#3e5968');
  townGlow(g, 0.26, 0.16, 0.26, 0xffe0a8, 0, 1.85, 0, 0.5);
}
function townTable(parent, x, z, ry) {
  var g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry || 0; parent.add(g);
  townSoftShadow(g, 0, 0, 1.25, 1.25, 0, 0.16);
  townCyl(g, 0.40, 0.40, 0.05, 0x8a6a48, 0, 0.60, 0, 16);
  townCyl(g, 0.06, 0.09, 0.56, 0x3f2d1e, 0, 0.31, 0, 8);
  townCyl(g, 0.25, 0.25, 0.04, 0x3f2d1e, 0, 0.04, 0, 12);
  townCyl(g, 0.065, 0.055, 0.09, 0xe8dcc8, -0.15, 0.67, 0.09, 8);
  townCyl(g, 0.065, 0.055, 0.09, 0xe8dcc8, 0.15, 0.67, -0.07, 8);
  townSphere(g, 0.07, 0xe06a8a, 0.02, 0.77, 0.02, 0);
}
function townParasol(parent, x, z, ry, v) {
  townSoftShadow(parent, x, z, 2.0, 2.0, 0, 0.14);
  townCyl(parent, 0.04, 0.05, 1.75, 0x8a6a48, x, 0.88, z, 8);
  var col = v === 'red' ? 0xb4542f : 0xe0d2b8;
  townCone(parent, 1.05, 0.42, col, x, 1.92, z, 8);
  townCone(parent, 1.02, 0.12, 0x9a4a3a, x, 1.76, z, 8);
  townCyl(parent, 0.07, 0.07, 0.10, 0x4a3423, x, 2.16, z, 8);
}
function townMenu(parent, x, z, ry) {
  var g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry || 0; parent.add(g);
  townBox(g, 0.62, 0.90, 0.06, 0x3f2d1e, 0, 0.45, -0.10, 0, 0, -0.14);
  townBox(g, 0.62, 0.90, 0.06, 0x3f2d1e, 0, 0.45, 0.10, 0, 0, 0.14);
  townSignPlane(g, '本日推荐', 0.52, 0.70, 0, 0.52, -0.15, 0, '#2f241a', '#ffe9b0');
}
function townPot(parent, x, z) {
  townCyl(parent, 0.22, 0.17, 0.34, 0xa85f42, x, 0.17, z, 10);
  townSphere(parent, 0.27, 0x5c8a52, x, 0.46, z, 0);
  townSphere(parent, 0.16, 0xd8708a, x - 0.12, 0.58, z + 0.10, 0);
  townSphere(parent, 0.13, 0xe8c060, x + 0.15, 0.55, z - 0.08, 0);
}
function townMailbox(parent, x, z, ry) {
  townBox(parent, 0.10, 0.85, 0.10, 0x5f4630, x, 0.42, z);
  townBox(parent, 0.42, 0.30, 0.34, 0x8b939b, x, 0.95, z);
  townBox(parent, 0.06, 0.05, 0.30, 0x2f3237, x, 1.02, z);
}
function townFence(parent, x, z, ry) {
  var g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry || 0; parent.add(g);
  for (var i = -1; i <= 1; i++) {
    townBox(g, 0.10, 0.95, 0.10, 0x6f4c31, i * 0.8, 0.48, 0);
  }
  townBox(g, 1.8, 0.07, 0.07, 0x6f4c31, 0, 0.72, 0);
  townBox(g, 1.8, 0.07, 0.07, 0x6f4c31, 0, 0.38, 0);
}
function townHedge(parent, x, z, ry) {
  var g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry || 0; parent.add(g);
  townBox(g, 1.7, 0.62, 0.55, 0x4a6b44, 0, 0.34, 0);
  for (var i = 0; i < 5; i++) {
    townSphere(g, 0.24, (i % 2 ? 0x557a4c : 0x4a6b44), -0.66 + i * 0.33, 0.64, 0, 0);
  }
}
function townLaundry(parent, x, z, ry) {
  var g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry || 0; parent.add(g);
  townBox(g, 0.08, 2.0, 0.08, 0x6f4c31, -0.95, 1.0, 0);
  townBox(g, 0.08, 2.0, 0.08, 0x6f4c31, 0.95, 1.0, 0);
  townBox(g, 2.0, 0.03, 0.03, 0x9a9688, 0, 1.78, 0);
  townBox(g, 0.45, 0.55, 0.03, 0xd8e0e8, -0.45, 1.45, 0);
  townBox(g, 0.38, 0.45, 0.03, 0xe8c8c0, 0.10, 1.50, 0);
  townBox(g, 0.32, 0.60, 0.03, 0x9fc8d4, 0.58, 1.42, 0);
}
function townStatue(parent, x, z, ry) {
  var g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry || 0; parent.add(g);
  townBox(g, 0.75, 0.55, 0.75, 0x8a8272, 0, 0.27, 0);
  townBox(g, 0.62, 0.16, 0.62, 0x9a9688, 0, 0.60, 0);
  townBox(g, 0.42, 0.45, 0.55, 0x8a8272, 0, 0.88, 0);
  townSphere(g, 0.24, 0x8a8272, 0, 1.22, 0.05, 0);
  townBox(g, 0.10, 0.22, 0.10, 0x6f6a5c, -0.16, 0.68, 0.25);
  townBox(g, 0.10, 0.22, 0.10, 0x6f6a5c, 0.16, 0.68, 0.25);
  townGlow(g, 0.10, 0.08, 0.04, 0xffe9b0, -0.10, 1.24, 0.22, 0.6);
  townGlow(g, 0.10, 0.08, 0.04, 0xffe9b0, 0.10, 1.24, 0.22, 0.6);
}
function townStoneLantern(parent, x, z) {
  townBox(parent, 0.55, 0.18, 0.55, 0x8a8272, x, 0.09, z);
  townCyl(parent, 0.12, 0.16, 0.85, 0x8a8272, x, 0.55, z, 8);
  townBox(parent, 0.48, 0.38, 0.48, 0x8a8272, x, 1.10, z);
  townGlow(parent, 0.28, 0.24, 0.28, 0xffd9a0, x, 1.10, z, 0.7);
  townBox(parent, 0.60, 0.10, 0.60, 0x6f6a5c, x, 1.34, z);
  townCone(parent, 0.34, 0.22, 0x6f6a5c, x, 1.48, z, 4);
}
function townToriiBeams(parent, x, z, ry) {
  var g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry || 0; parent.add(g);
  townBox(g, 4.6, 0.26, 0.34, 0xc0392b, 0, 2.65, 0);
  townBox(g, 5.0, 0.16, 0.42, 0x8b2f26, 0, 2.84, 0);
  townBox(g, 3.6, 0.16, 0.24, 0xc0392b, 0, 2.28, 0);
  townBox(g, 0.9, 0.36, 0.10, 0x2f241a, 0, 2.10, 0);
  townSignPlane(g, '神 社', 0.76, 0.28, 0, 2.10, 0.06, 0, '#2f241a', '#e8dcc8');
}
function townToriiPillar(parent, x, z) {
  townBox(parent, 0.42, 2.7, 0.42, 0xc0392b, x, 1.35, z);
  townBox(parent, 0.52, 0.16, 0.52, 0x2f241a, x, 0.08, z);
}
function townEma(parent, x, z, ry) {
  var g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry || 0; parent.add(g);
  townBox(g, 1.25, 0.08, 0.08, 0x6f4c31, 0, 1.65, 0);
  townBox(g, 1.25, 0.08, 0.08, 0x6f4c31, 0, 1.25, 0);
  for (var i = 0; i < 6; i++) {
    townBox(g, 0.26, 0.30, 0.03, 0xd8c9ad, -0.48 + (i % 3) * 0.48, 1.45 - Math.floor(i / 3) * 0.4, 0.04);
    townBox(g, 0.05, 0.05, 0.03, 0xc0392b, -0.48 + (i % 3) * 0.48, 1.63 - Math.floor(i / 3) * 0.4, 0.05);
  }
  townBox(g, 1.35, 0.07, 0.45, 0x3a4741, 0, 1.82, 0);
}
function townFlowerStand(parent, x, z, ry) {
  var g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry || 0; parent.add(g);
  townBox(g, 0.75, 0.50, 0.55, 0x8a6a48, 0, 0.25, 0);
  for (var i = 0; i < 2; i++) {
    townCyl(g, 0.15, 0.12, 0.32, 0x9aa0a4, -0.18 + i * 0.36, 0.72, 0, 8);
    townCyl(g, 0.04, 0.04, 0.42, 0x5c8a52, -0.18 + i * 0.36, 0.98, 0, 6);
    townSphere(g, 0.16, [0xe06a8a, 0xf0d060][i], -0.18 + i * 0.36, 1.18, 0, 0);
  }
}
function townHandcart(parent, x, z, ry) {
  var g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry || 0; parent.add(g);
  townBox(g, 0.95, 0.12, 1.5, 0x8a6a48, 0, 0.55, 0);
  townBox(g, 0.90, 0.35, 0.45, 0x9a7650, 0, 0.70, -0.35);
  townBox(g, 0.90, 0.35, 0.45, 0x9a7650, 0, 0.70, 0.35);
  [[-0.45, -0.55], [0.45, -0.55], [-0.45, 0.55], [0.45, 0.55]].forEach(function (p) {
    var w = new THREE.Mesh(new THREE.TorusGeometry(0.20, 0.05, 5, 10), matOf(0x2b2b2f));
    w.position.set(p[0], 0.24, p[1]); w.rotation.y = Math.PI / 2; g.add(w);
  });
  townBox(g, 0.07, 0.07, 0.9, 0x6f4c31, -0.35, 0.72, 0.95);
  townBox(g, 0.07, 0.07, 0.9, 0x6f4c31, 0.35, 0.72, 0.95);
}
function townAnvil(parent, x, z) {
  townBox(parent, 0.6, 0.5, 0.5, 0x3b3b3f, x, 0.25, z);
  townBox(parent, 0.78, 0.18, 0.42, 0x4a4a50, x, 0.58, z);
  townBox(parent, 0.30, 0.16, 0.28, 0x3b3b3f, x - 0.48, 0.56, z);
}
function townCoal(parent, x, z) {
  for (var i = 0; i < 7; i++) {
    var a = i * 2.3, r = 0.22 + (i % 3) * 0.14;
    townSphere(parent, 0.16, i % 2 ? 0x2b2d2e : 0x3a3b3c, x + Math.cos(a) * r, 0.20 + (i % 2) * 0.10, z + Math.sin(a) * r, 0);
  }
}
function townProp(parent, p) {
  var k = p.k, x = p.x, z = p.z, ry = p.ry || 0, v = p.v, s = p.s || 1;
  switch (k) {
    case 'tree': townTree(parent, x, z, v || 'green', s); break;
    case 'lamp': townLamp(parent, x, z, ry); break;
    case 'vending': townVending(parent, x, z, ry, v); break;
    case 'bike': townBike(parent, x, z, ry, v); break;
    case 'bin': townBin(parent, x, z, ry, v); break;
    case 'crate': townCrate(parent, x, z, ry, v); break;
    case 'barrel': townBarrel(parent, x, z); break;
    case 'stall': townStall(parent, x, z, ry, v); break;
    case 'postbox': townPostbox(parent, x, z, ry, v); break;
    case 'hydrant': townHydrant(parent, x, z); break;
    case 'notice': townNotice(parent, x, z, ry); break;
    case 'busstop': townBusstop(parent, x, z, ry); break;
    case 'table': townTable(parent, x, z, ry); break;
    case 'parasol': townParasol(parent, x, z, ry, v); break;
    case 'menu': townMenu(parent, x, z, ry); break;
    case 'pot': townPot(parent, x, z); break;
    case 'mailbox': townMailbox(parent, x, z, ry); break;
    case 'fence': townFence(parent, x, z, ry); break;
    case 'hedge': townHedge(parent, x, z, ry); break;
    case 'laundry': townLaundry(parent, x, z, ry); break;
    case 'statue': townStatue(parent, x, z, ry); break;
    case 'stone_lantern': townStoneLantern(parent, x, z); break;
    case 'torii': townToriiBeams(parent, x, z, ry); break;
    case 'torii_pillar': townToriiPillar(parent, x, z); break;
    case 'ema': townEma(parent, x, z, ry); break;
    case 'flowerstand': townFlowerStand(parent, x, z, ry); break;
    case 'handcart': townHandcart(parent, x, z, ry); break;
    case 'anvil': townAnvil(parent, x, z); break;
    case 'coal': townCoal(parent, x, z); break;
    case 'planter':
      townBox(parent, 1.05, 0.42, 0.58, 0x8a8272, x, 0.21, z);
      townBox(parent, 0.95, 0.30, 0.48, 0x5f4a35, x, 0.46, z);
      for (var i = 0; i < 4; i++) {
        townSphere(parent, 0.16, [0x5c8a52, 0xd8708a, 0xe8c060][i % 3], x - 0.36 + i * 0.24, 0.62, z + (i % 2 ? 0.08 : -0.08), 0);
      }
      break;
    case 'lantern':
      townCyl(parent, 0.13, 0.15, 0.42, 0xc0392b, x, 1.65, z, 10);
      townGlow(parent, 0.26, 0.20, 0.26, 0xff7a3a, x, 1.65, z, 0.85);
      townBox(parent, 0.08, 1.4, 0.08, 0x2f241a, x, 2.55, z);
      break;
    default:
      townBox(parent, 0.6, 0.6, 0.6, 0x8a6a48, x, 0.3, z, ry);
  }
}

/* ============================ 椅子 ============================ */
function townSeat(parent, s) {
  if (s.hide) { return; }
  var x = s.x, z = s.z, ry = s.ry || 0, y = s.y || 0.30;
  var g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; parent.add(g);
  townSoftShadow(g, 0, 0, s.k === 'bench' ? 2.0 : (s.k === 'sofa' ? 1.9 : 0.8),
    s.k === 'bench' ? 0.8 : (s.k === 'sofa' ? 0.95 : 0.8), 0, 0.18);
  var wood = 0x8a6a48, dark = 0x4a3423;
  if (s.k === 'bench') {
    var w = 1.72, d = 0.52;
    for (var i = 0; i < 3; i++) {
      townBox(g, w, 0.07, d / 3 - 0.02, wood, 0, y, -d / 3 + i * d / 3);
    }
    townBox(g, w, 0.07, 0.10, dark, 0, y - 0.10, -d / 2 + 0.04);
    townBox(g, w, 0.07, 0.10, dark, 0, y - 0.10, d / 2 - 0.04);
    townBox(g, w, 0.55, 0.07, wood, 0, y + 0.32, -d / 2 + 0.02);
    townBox(g, w - 0.2, 0.05, 0.07, dark, 0, y + 0.62, -d / 2 + 0.02);
    [-w / 2 + 0.12, w / 2 - 0.12].forEach(function (px) {
      townBox(g, 0.09, y, 0.09, 0x3b3b3f, px, y / 2, -d / 2 + 0.08);
      townBox(g, 0.09, y, 0.09, 0x3b3b3f, px, y / 2, d / 2 - 0.08);
      townBox(g, 0.09, 0.06, d, 0x3b3b3f, px, 0.18, 0);
    });
  } else if (s.k === 'stool') {
    townCyl(g, 0.24, 0.24, 0.06, wood, 0, y, 0, 14);
    townCyl(g, 0.20, 0.20, 0.03, dark, 0, y - 0.05, 0, 14);
    for (var l = 0; l < 3; l++) {
      var a = l * Math.PI * 2 / 3;
      townBox(g, 0.05, y - 0.02, 0.05, 0x3b3b3f, Math.cos(a) * 0.16, (y - 0.02) / 2, Math.sin(a) * 0.16);
    }
    townBox(g, 0.42, 0.03, 0.03, dark, 0, 0.14, 0);
  } else if (s.k === 'sofa') {
    var sw = 1.75;
    townBox(g, sw, 0.20, 0.82, 0x6b4a3a, 0, y - 0.10, 0);
    townBox(g, sw - 0.1, 0.16, 0.72, 0x8a5a48, 0, y + 0.06, 0);
    townBox(g, sw, 0.55, 0.18, 0x6b4a3a, 0, y + 0.28, -0.32);
    townBox(g, 0.18, 0.45, 0.82, 0x6b4a3a, -sw / 2 + 0.09, y + 0.12, 0);
    townBox(g, 0.18, 0.45, 0.82, 0x6b4a3a, sw / 2 - 0.09, y + 0.12, 0);
    [-sw / 2 + 0.15, sw / 2 - 0.15].forEach(function (px) {
      townBox(g, 0.10, y - 0.10, 0.10, dark, px, (y - 0.10) / 2, -0.30);
      townBox(g, 0.10, y - 0.10, 0.10, dark, px, (y - 0.10) / 2, 0.30);
    });
  } else {
    /* chair */
    var cw = 0.50;
    townBox(g, cw, 0.07, cw, wood, 0, y, 0);
    townBox(g, cw - 0.06, 0.05, cw - 0.06, dark, 0, y - 0.05, 0);
    [-cw / 2 + 0.05, cw / 2 - 0.05].forEach(function (px) {
      [-cw / 2 + 0.05, cw / 2 - 0.05].forEach(function (pz) {
        townBox(g, 0.06, y - 0.03, 0.06, 0x3b3b3f, px, (y - 0.03) / 2, pz);
      });
    });
    townBox(g, cw, 0.55, 0.06, wood, 0, y + 0.30, -cw / 2 + 0.03);
    townBox(g, cw - 0.10, 0.055, 0.06, dark, 0, y + 0.10, -cw / 2 + 0.03);
    townBox(g, cw - 0.12, 0.05, 0.06, dark, 0, y + 0.55, -cw / 2 + 0.03);
  }
}

/* ============================ 静态几何合并 ============================
   ★ 为什么不是 InstancedMesh：
     小镇有 5000+ 个方块，但材质只有几十种；按材质合并成顶点色网格后，
     整个镇子只剩 1~2 次绘制，屋顶每栋 1 次（还要单独隐藏）。
   ★ 只合并静态、不透明/自发光/透明的 Lambert/Basic 网格；
     文字招牌保留独立（纹理不同），远景树林保留 InstancedMesh。
*/
var _townVC = null;
function townVCMat() {
  if (!_townVC) { _townVC = new THREE.MeshLambertMaterial({ vertexColors: true }); }
  return _townVC;
}
var _townGlowVC = null;
function townGlowVCMat() {
  if (!_townGlowVC) { _townGlowVC = new THREE.MeshBasicMaterial({ vertexColors: true }); }
  return _townGlowVC;
}
function townMergeList(list) {
  var total = 0;
  for (var i = 0; i < list.length; i++) { var _gg = list[i].geo; total += _gg.index ? _gg.index.count : _gg.attributes.position.count; }
  var pos = new Float32Array(total * 3);
  var nor = new Float32Array(total * 3);
  var col = new Float32Array(total * 3);
  var c = new THREE.Color();
  var o = 0;
  for (var k = 0; k < list.length; k++) {
    var it = list[k];
    var g = it.geo.index ? it.geo.toNonIndexed() : it.geo.clone();
    g.applyMatrix4(it.matrix);
    if (!g.attributes.normal) { g.computeVertexNormals(); }
    var p = g.attributes.position.array;
    var n = g.attributes.normal.array;
    c.setHex(it.color | 0);
    var cr = c.r, cg = c.g, cb = c.b;
    for (var v = 0; v < p.length; v += 3) {
      pos[o] = p[v]; pos[o + 1] = p[v + 1]; pos[o + 2] = p[v + 2];
      nor[o] = n[v]; nor[o + 1] = n[v + 1]; nor[o + 2] = n[v + 2];
      col[o] = cr; col[o + 1] = cg; col[o + 2] = cb;
      o += 3;
    }
    g.dispose();
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}
function townMeshColor(m) {
  if (m && m.color) { return m.color.getHex(); }
  return 0xffffff;
}
function townPickMaterial(first, kind) {
  if (kind === 'opaque') { return townVCMat(); }
  if (kind === 'glow') { return townGlowVCMat(); }
  var mat = first.material.clone();
  mat.vertexColors = true;
  if (mat.color) { mat.color.setHex(0xffffff); }
  mat.map = first.material.map || null;
  mat.transparent = true;
  return mat;
}
function townMergeBuckets(root, buckets, invRoot) {
  var n = 0;
  for (var key in buckets) {
    var b = buckets[key];
    if (!b.list.length) { continue; }
    var geo = townMergeList(b.list);
    var mesh = new THREE.Mesh(geo, townPickMaterial(b.first, b.kind));
    mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    if (b.first.renderOrder) { mesh.renderOrder = b.first.renderOrder; }
    root.add(mesh);
    n++;
  }
  return n;
}
/* 屋顶：整组合成 1 个不透明 + 1 个自发光，仍可整组隐藏 */
function townBatchGroup(root) {
  if (!root || root.userData.townBatched) { return; }
  root.userData.townBatched = true;
  root.updateMatrixWorld(true);
  var inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  var buckets = {}, found = [];
  var stack = root.children.slice();
  while (stack.length) {
    var o = stack.pop();
    if (o.isMesh && !o.isInstancedMesh && o.geometry && o.material && !Array.isArray(o.material)) {
      var mat = o.material;
      if (mat.map || mat.transparent) { continue; }
      var kind = (mat.emissive && mat.emissive.getHex() !== 0) ? 'glow' : 'opaque';
      if (!buckets[kind]) { buckets[kind] = { kind: kind, first: o, list: [] }; }
      var rel = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      buckets[kind].list.push({ geo: o.geometry, matrix: rel, color: townMeshColor(mat) });
      found.push(o);
    }
    for (var i = 0; i < o.children.length; i++) { stack.push(o.children[i]); }
  }
  for (var q = 0; q < found.length; q++) {
    var f = found[q];
    if (f.parent) { f.parent.remove(f); }
    f.geometry.dispose();
  }
  root.userData.townParts = townMergeBuckets(root, buckets, inv);
}


/* 全城静态合并：不透明 1 次、自发光 1 次、透明按参数分组、文字牌保留 */
function townBatchStatic(root) {
  root.updateMatrixWorld(true);
  var inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  var buckets = {}, keep = 0, found = [];
  var stack = [{ o: root, skip: false }];
  while (stack.length) {
    var it = stack.pop();
    var o = it.o;
    var skip = it.skip || !!(o.userData && o.userData.noBatch);
    if (!skip && o.isMesh && !o.isInstancedMesh && o.geometry && o.material && !Array.isArray(o.material)) {
      var mat = o.material;
      var isText = !!(o.userData && o.userData.sign);
      var isPool = !!(o.userData && o.userData.pool);
      if (isText) {
        keep++;
      } else if (mat.map && !isPool) {
        keep++;
      } else {
        var kind, key;
        if (mat.map) {
          kind = 'trans';
          key = 'pool|' + Math.round((mat.opacity || 1) * 100) + '|' + mat.blending +
            '|' + (mat.depthWrite ? 1 : 0) + '|' + mat.map.uuid;
        } else if (mat.transparent) {
          kind = 'trans';
          key = 'tr|' + Math.round((mat.opacity || 1) * 100) + '|' + mat.blending +
            '|' + (mat.depthWrite ? 1 : 0) + '|' + mat.side + '|' + mat.type;
        } else if (mat.isMeshBasicMaterial) {
          kind = 'glow';
          key = 'glow';
        } else if (mat.emissive && mat.emissive.getHex() !== 0) {
          kind = 'glow';
          key = 'glow';
        } else {
          kind = 'opaque';
          key = 'opaque';
        }
        if (!buckets[key]) { buckets[key] = { kind: kind, first: o, list: [] }; }
        var rel = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
        buckets[key].list.push({ geo: o.geometry, matrix: rel, color: townMeshColor(mat) });
        found.push(o);
      }
    }
    if (o.children && o.children.length) {
      for (var i = 0; i < o.children.length; i++) {
        stack.push({ o: o.children[i], skip: skip });
      }
    }
  }
  for (var q = 0; q < found.length; q++) {
    var f = found[q];
    if (f.parent) { f.parent.remove(f); }
    f.geometry.dispose();
  }
  var count = townMergeBuckets(root, buckets, inv);
  TOWN_STATS.instanced = 0;
  TOWN_STATS.meshes = found.length;
  TOWN_STATS.merged = count + keep;
  TOWN_STATS.kept = keep;
}

/* 传送阵：石台 + 发光环 + 符文 + 站牌 */
function townTeleportPads(g) {
  TOWN_TELEPORTS.forEach(function (t) {
    var x = t.x, z = t.z;
    townSoftShadow(g, x + 0.10, z + 0.08, 3.4, 3.4, 0, 0.22);
    townCyl(g, 1.55, 1.75, 0.18, 0x8a8272, x, 0.09, z, 20);
    townCyl(g, 1.35, 1.35, 0.06, 0x4b8aa0, x, 0.20, z, 20);
    var ring = new THREE.Mesh(new THREE.TorusGeometry(1.22, 0.055, 4, 40), matOf(0x9fe8ff));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, 0.245, z);
    g.add(ring);
    for (var i = 0; i < 6; i++) {
      var a = i / 6 * Math.PI * 2;
      townGlow(g, 0.12, 0.06, 0.12, 0x9fe8ff, x + Math.cos(a) * 1.05, 0.255, z + Math.sin(a) * 1.05, 0.9);
    }
    townGlowPool(g, x, z, 2.6, 0x7fd8ff, 0.28);
  });
}

/* ============================ 街区细节 ============================ */
function townDistrictDetails(g) {
  var px = 0, pz = -120;
  townTiledPlane(g, 46, 34, 'grass', px, 0.024, pz);
  for (var pp = 0; pp < 5; pp++) { townTiledPlane(g, 1.6, 11, 'pav', px - 18 + pp * 9, 0.031, pz); }
  townTiledPlane(g, 42, 1.5, 'pav', px, 0.032, pz + 4);
  townCyl(g, 5.4, 5.0, 0.10, 0x3f6f72, px - 7, 0.08, pz - 4, 28);
  townCyl(g, 4.8, 4.4, 0.06, 0x6fb8c8, px - 7, 0.15, pz - 4, 28);
  for (var lp = 0; lp < 7; lp++) {
    var a = lp / 7 * Math.PI * 2;
    townCyl(g, 0.28, 0.22, 0.32, 0x5c8a52, px - 7 + Math.cos(a) * 5.8, 0.20, pz - 4 + Math.sin(a) * 5.4, 8);
  }
  var gx = px + 8, gz = pz + 2;
  for (var gp = 0; gp < 4; gp++) { townCyl(g, 0.15, 0.18, 2.7, 0x6f4c31, gx + (gp % 2 ? 1.7 : -1.7), 1.35, gz + (gp < 2 ? -1.7 : 1.7), 8); }
  townBox(g, 4.4, 0.12, 4.4, 0x3f5148, gx, 2.75, gz);
  townMiniRoof(g, 5.0, 4.8, 0x3f5148, gx, 2.92, gz, 0);
  townBox(g, 2.8, 0.10, 0.7, 0x8a6a48, gx, 0.65, gz);
  townBox(g, 0.10, 0.55, 0.6, 0x4a3423, gx - 1.2, 0.30, gz);
  townBox(g, 0.10, 0.55, 0.6, 0x4a3423, gx + 1.2, 0.30, gz);
  for (var bn = 0; bn < 8; bn++) {
    var bx = px - 18 + (bn % 4) * 12, bz = pz + (bn < 4 ? -11 : 12);
    townBox(g, 1.8, 0.10, 0.5, 0x8a6a48, bx, 0.55, bz);
    townBox(g, 0.10, 0.55, 0.5, 0x4a3423, bx - 0.75, 0.30, bz);
    townBox(g, 0.10, 0.55, 0.5, 0x4a3423, bx + 0.75, 0.30, bz);
    townCyl(g, 0.06, 0.06, 2.2, 0x3d4549, bx + 2.6, 1.1, bz, 6);
    townGlow(g, 0.18, 0.16, 0.18, 0xffe0a8, bx + 2.6, 2.2, bz, 0.6);
  }
  for (var fl = 0; fl < 6; fl++) {
    townBox(g, 2.4, 0.30, 0.8, 0x9a7650, px - 15 + fl * 6, 0.16, pz + 10);
    for (var fb = 0; fb < 5; fb++) { townSphere(g, 0.13, [0xd8708a, 0xe8c060, 0x9fe0a8][fb % 3], px - 16 + fl * 6 + fb * 0.35, 0.38, pz + 10, 0); }
  }
  for (var pk = 0; pk < 5; pk++) {
    townBox(g, 0.10, 0.020, 4.6, 0xe8e0c8, 108 + pk * 4.0, 0.040, -100);
    townBox(g, 1.8, 0.55, 3.4, [0xb84a3a, 0x3e5968, 0xd8cbb4, 0x4a6a4a, 0x8a5a4a][pk], 108 + pk * 4.0, 0.28, -100);
    townBox(g, 1.45, 0.42, 1.9, 0x2f3438, 108 + pk * 4.0, 0.58, -100);
  }
  var bsx = 150, bsz = -100;
  townBox(g, 4.4, 0.12, 1.5, 0x3d4549, bsx, 2.55, bsz);
  townBox(g, 4.4, 0.08, 0.08, 0x9aa3a8, bsx, 2.35, bsz + 0.7);
  for (var bsp = 0; bsp < 3; bsp++) { townBox(g, 0.10, 2.5, 0.10, 0x3d4549, bsx - 1.9 + bsp * 1.9, 1.25, bsz - 0.6); }
  townBox(g, 2.0, 0.08, 0.5, 0x8a6a48, bsx, 0.55, bsz);
  townBox(g, 0.9, 0.55, 0.55, 0xc84a3a, bsx + 3.4, 0.62, bsz + 0.8);
  townGlow(g, 0.55, 0.35, 0.06, 0xff8a7a, bsx + 3.4, 0.95, bsz + 1.08, 0.6);
  for (var ms = 0; ms < 5; ms++) {
    var mx = -14 + ms * 7, mz = 120;
    townBox(g, 3.2, 0.08, 1.0, 0x8a6a48, mx, 0.80, mz);
    townBox(g, 0.10, 0.78, 0.10, 0x4a3423, mx - 1.35, 0.40, mz - 0.35);
    townBox(g, 0.10, 0.78, 0.10, 0x4a3423, mx + 1.35, 0.40, mz - 0.35);
    townBox(g, 3.4, 0.08, 1.5, [0xb84a3a, 0xe8dcc8][ms % 2], mx, 2.03, mz, 0, 0, -0.04);
    for (var mc = 0; mc < 5; mc++) { townBox(g, 0.38, 0.26, 0.34, [0xd8a45a, 0x9a4a3a, 0x5c8a52][mc % 3], mx - 1.2 + mc * 0.6, 0.95, mz + 0.05); }
  }
  for (var db = 0; db < 10; db++) {
    var dx = -200 + (db % 5) * 20, dz = 176 + Math.floor(db / 5) * 18;
    townBox(g, 2.8, 0.35, 1.2, 0x9a7650, dx, 0.18, dz);
    for (var df = 0; df < 4; df++) { townSphere(g, 0.15, [0xd8708a, 0xe8c060, 0x9fe0a8][df % 3], dx - 0.9 + df * 0.6, 0.42, dz, 0); }
  }
}

/* 西南新镇细节：公园 / 市集 / 停车 / 花坛 */
function townNewDistrictDetails(g) {
  var px = -210, pz = 120;
  townTiledPlane(g, 54, 34, 'grass', px, 0.024, pz);
  for (var p = 0; p < 4; p++) { townTiledPlane(g, 1.4, 30, 'pav', px - 18 + p * 12, 0.031, pz); }
  townTiledPlane(g, 50, 1.4, 'pav', px, 0.032, pz + 4);
  townCyl(g, 5.0, 4.6, 0.10, 0x3f6f72, px - 8, 0.08, pz - 4, 24);
  townCyl(g, 4.5, 4.1, 0.06, 0x6fb8c8, px - 8, 0.15, pz - 4, 24);
  for (var t = 0; t < 6; t++) {
    var a = t / 6 * Math.PI * 2;
    townCyl(g, 0.26, 0.20, 0.34, 0x5c8a52, px - 8 + Math.cos(a) * 5.5, 0.20, pz - 4 + Math.sin(a) * 5.1, 8);
  }
  /* 凉亭 */
  var gx = px + 8, gz = pz + 2;
  for (var q = 0; q < 4; q++) { townCyl(g, 0.14, 0.17, 2.6, 0x6f4c31, gx + (q % 2 ? 1.6 : -1.6), 1.3, gz + (q < 2 ? -1.6 : 1.6), 8); }
  townBox(g, 4.2, 0.12, 4.2, 0x3f5148, gx, 2.62, gz);
  townMiniRoof(g, 4.8, 4.6, 0x3f5148, gx, 2.80, gz, 0);
  townBox(g, 2.6, 0.10, 0.65, 0x8a6a48, gx, 0.62, gz);
  /* 长椅 */
  for (var b = 0; b < 6; b++) {
    var bx = px - 20 + (b % 3) * 15, bz = pz + (b < 3 ? -11 : 12);
    townBox(g, 1.7, 0.10, 0.48, 0x8a6a48, bx, 0.55, bz);
    townBox(g, 0.10, 0.52, 0.48, 0x4a3423, bx - 0.7, 0.28, bz);
    townBox(g, 0.10, 0.52, 0.48, 0x4a3423, bx + 0.7, 0.28, bz);
    townCyl(g, 0.05, 0.05, 2.1, 0x3d4549, bx + 2.4, 1.05, bz, 6);
    townGlow(g, 0.16, 0.15, 0.16, 0xffe0a8, bx + 2.4, 2.10, bz, 0.6);
  }
  /* 市集摊位 */
  for (var m = 0; m < 5; m++) {
    var mx = -154 + m * 12, mz = 224;
    townBox(g, 3.0, 0.08, 1.0, 0x8a6a48, mx, 0.80, mz);
    townBox(g, 0.10, 0.78, 0.10, 0x4a3423, mx - 1.3, 0.40, mz - 0.35);
    townBox(g, 0.10, 0.78, 0.10, 0x4a3423, mx + 1.3, 0.40, mz - 0.35);
    townBox(g, 3.2, 0.08, 1.4, [0xb84a3a, 0xe8dcc8][m % 2], mx, 1.98, mz, 0, 0, -0.04);
    for (var c = 0; c < 5; c++) { townBox(g, 0.36, 0.24, 0.32, [0xd8a45a, 0x9a4a3a, 0x5c8a52][c % 3], mx - 1.1 + c * 0.55, 0.94, mz + 0.05); }
  }
  /* 商业停车 + 公交站 */
  for (var pk = 0; pk < 4; pk++) {
    townBox(g, 0.10, 0.02, 4.2, 0xe8e0c8, -82 + pk * 4.0, 0.04, 148);
    townBox(g, 1.7, 0.52, 3.1, [0xb84a3a, 0x3e5968, 0xd8cbb4, 0x4a6a4a][pk], -82 + pk * 4.0, 0.27, 148);
    townBox(g, 1.35, 0.40, 1.7, 0x2f3438, -82 + pk * 4.0, 0.56, 148);
  }
  var bsx = -92, bsz = 148;
  townBox(g, 4.0, 0.12, 1.4, 0x3d4549, bsx, 2.50, bsz);
  for (var bs = 0; bs < 3; bs++) { townBox(g, 0.08, 2.45, 0.08, 0x3d4549, bsx - 1.7 + bs * 1.7, 1.22, bsz - 0.55); }
  townBox(g, 1.8, 0.08, 0.45, 0x8a6a48, bsx, 0.55, bsz);
  /* 小区花坛 */
  for (var f = 0; f < 8; f++) {
    var fx = -220 + (f % 4) * 16, fz = 164 + Math.floor(f / 4) * 18;
    townBox(g, 2.4, 0.28, 1.0, 0x9a7650, fx, 0.14, fz);
    for (var h = 0; h < 4; h++) { townSphere(g, 0.13, [0xd8708a, 0xe8c060, 0x9fe0a8][h % 3], fx - 0.8 + h * 0.5, 0.36, fz, 0); }
  }
}

/* 玩家风格 NPC：单网格顶点色，女性/正常男性皮肤与服装 */
var _NPC_MAT = null;
function _npcMat() {
  if (!_NPC_MAT) { _NPC_MAT = new THREE.MeshLambertMaterial({ vertexColors: true }); }
  return _NPC_MAT;
}
function _npcBox(arr, cols, w, h, d, x, y, z, c) {
  var hw = w / 2, hh = h / 2, hd = d / 2;
  var faces = [
    [[-hw,-hh,hd],[hw,-hh,hd],[hw,hh,hd],[-hw,hh,hd],[0,0,1]],
    [[hw,-hh,-hd],[-hw,-hh,-hd],[-hw,hh,-hd],[hw,hh,-hd],[0,0,-1]],
    [[hw,-hh,hd],[hw,-hh,-hd],[hw,hh,-hd],[hw,hh,hd],[1,0,0]],
    [[-hw,-hh,-hd],[-hw,-hh,hd],[-hw,hh,hd],[-hw,hh,-hd],[-1,0,0]],
    [[-hw,hh,hd],[hw,hh,hd],[hw,hh,-hd],[-hw,hh,-hd],[0,1,0]],
    [[-hw,-hh,-hd],[hw,-hh,-hd],[hw,-hh,hd],[-hw,-hh,hd],[0,-1,0]]
  ];
  for (var f = 0; f < 6; f++) {
    var q = faces[f];
    var idx = [0,1,2,0,2,3];
    for (var k = 0; k < 6; k++) {
      var v = q[idx[k]];
      arr.pos.push(x + v[0], y + v[1], z + v[2]);
      arr.nor.push(q[4][0], q[4][1], q[4][2]);
      cols.push((c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255);
    }
  }
}
function townNpcModel(n) {
  var fem = (n.kind === 'clerk') ? ((n.name || '').length % 3 !== 1) : ((n.name || '').length % 2 === 0);
  var skin = fem ? 0xf6cfa0 : 0xe8bf92;
  var hair = fem ? 0x3e2c1e : 0x2a2118;
  var shirt = n.kind === 'clerk' ? (fem ? 0xd85a7a : 0x3e6f8a) : (fem ? 0xc86a8a : 0x4a6a8a);
  var pants = fem ? 0x5a4a6a : 0x3a3a44;
  var apron = n.kind === 'clerk' ? 0xe8dcc8 : 0;
  var arr = { pos: [], nor: [] }, cols = [];
  _npcBox(arr, cols, 0.18, 0.62, 0.20, -0.16, 0.44, 0, pants);
  _npcBox(arr, cols, 0.18, 0.62, 0.20, 0.16, 0.44, 0, pants);
  _npcBox(arr, cols, 0.22, 0.10, 0.30, -0.16, 0.08, 0.03, 0x2a2420);
  _npcBox(arr, cols, 0.22, 0.10, 0.30, 0.16, 0.08, 0.03, 0x2a2420);
  _npcBox(arr, cols, 0.48, 0.62, 0.30, 0, 1.02, 0, shirt);
  if (fem) { _npcBox(arr, cols, 0.54, 0.34, 0.34, 0, 0.80, 0, pants); }
  if (apron) { _npcBox(arr, cols, 0.40, 0.55, 0.05, 0, 0.98, 0.18, apron); }
  _npcBox(arr, cols, 0.14, 0.56, 0.16, -0.34, 1.05, 0, shirt);
  _npcBox(arr, cols, 0.14, 0.56, 0.16, 0.34, 1.05, 0, shirt);
  _npcBox(arr, cols, 0.14, 0.12, 0.16, -0.34, 0.75, 0, skin);
  _npcBox(arr, cols, 0.14, 0.12, 0.16, 0.34, 0.75, 0, skin);
  _npcBox(arr, cols, 0.34, 0.34, 0.32, 0, 1.55, 0, skin);
  _npcBox(arr, cols, 0.38, 0.10, 0.36, 0, 1.73, -0.01, hair);
  _npcBox(arr, cols, 0.36, 0.26, 0.08, 0, 1.56, -0.17, hair);
  if (fem) {
    _npcBox(arr, cols, 0.10, 0.55, 0.12, -0.20, 1.38, -0.12, hair);
    _npcBox(arr, cols, 0.10, 0.55, 0.12, 0.20, 1.38, -0.12, hair);
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(arr.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(arr.nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  var mesh = new THREE.Mesh(geo, _npcMat());
  mesh.position.set(n.x, 0, n.z);
  mesh.rotation.y = n.ry || 0;
  mesh.userData.noBatch = true;
  return mesh;
}

/* ============================ 悬浮名字 ============================ */
function townFloatingLabel(parent, text, sub, x, y, z, accent) {
  var W = 512, H = 160;
  var cv = UI.townCanvas(W, H);
  var c = cv.getContext('2d');
  c.clearRect(0, 0, W, H);
  /* 圆角底 */
  var r = 22;
  c.beginPath();
  c.moveTo(r, 2); c.lineTo(W - r, 2); c.quadraticCurveTo(W - 2, 2, W - 2, r);
  c.lineTo(W - 2, H - r); c.quadraticCurveTo(W - 2, H - 2, W - r, H - 2);
  c.lineTo(r, H - 2); c.quadraticCurveTo(2, H - 2, 2, H - r);
  c.lineTo(2, r); c.quadraticCurveTo(2, 2, r, 2); c.closePath();
  c.fillStyle = 'rgba(18,14,10,0.78)';
  c.fill();
  c.strokeStyle = accent || 'rgba(255,220,150,0.85)';
  c.lineWidth = 4;
  c.stroke();
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = '#fff2d2';
  c.font = '800 46px "Microsoft YaHei",system-ui,sans-serif';
  c.fillText(text, W / 2, sub ? 58 : 76);
  if (sub) {
    c.fillStyle = accent || '#9fe8ff';
    c.font = '600 26px "Microsoft YaHei",system-ui,sans-serif';
    c.fillText(sub, W / 2, 98);
  }
  var tex = new THREE.CanvasTexture(cv);
  try { tex.colorSpace = THREE.SRGBColorSpace; } catch (e) { }
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  var sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, depthTest: false
  }));
  sp.position.set(x, y, z);
  sp.scale.set(2.6, 0.82, 1);
  sp.renderOrder = 20;
  TOWN_LABELS.push({ sp: sp, x: x, z: z });
  parent.add(sp);
  return sp;
}

function townShopLabels(g) {
  (TOWN_SHOPS || []).forEach(function (s) {
    if (!s || !s.name) { return; }
    townFloatingLabel(g, s.name, s.served ? '堂食 · 可交易' : '可交易',
      s.x, 3.75, s.z, s.served ? 'rgba(255,200,140,0.95)' : 'rgba(160,235,255,0.9)');
  });
}

function townTeleportLabels(g) {
  (TOWN_TELEPORTS || []).forEach(function (t, i) {
    if (!t || !t.name) { return; }
    townFloatingLabel(g, t.name, '传送点 T' + (i + 1),
      t.x, 3.05, t.z, 'rgba(140,230,255,0.95)');
  });
}

function townLabelTick(px, pz) {
  for (var i = 0; i < TOWN_LABELS.length; i++) {
    var L = TOWN_LABELS[i];
    var dx = L.x - px, dz = L.z - pz;
    L.sp.visible = (dx * dx + dz * dz <= 2500);   /* 50m 内显示 */
  }
}

/* ============================ NPC ============================ */
/* ★ 2026-10-22（用户："NPC 没有用玩家的模型，参考 AI 分身"）
   直接复用玩家的 hero() 构建器：和本体/分身同一套身材、同一套皮肤。
   名字决定用哪套皮肤（同一个 NPC 每次进游戏都一样 ✓）。
   不挂武器（店员/路人拿剑很奇怪 ✗）。*/
function townNpcHero(n) {
  try {
    if (typeof hero !== 'function') { return null; }
    var order = (typeof SKIN_ORDER !== 'undefined' && SKIN_ORDER.length) ? SKIN_ORDER : ['f01'];
    var nm = String(n.name || n.id || '');
    var hsh = 0;
    for (var i = 0; i < nm.length; i++) { hsh = (hsh * 31 + nm.charCodeAt(i)) | 0; }
    var r = hero(order[Math.abs(hsh) % order.length], {});
    if (!r || !r.g) { return null; }
    if (r.sw) { r.sw.visible = false; }
    if (r.swL) { r.swL.visible = false; }
    var g = r.g;
    g.position.set(+n.x, 0.1, +n.z);
    g.rotation.y = +n.ry || 0;
    if (typeof G !== 'undefined' && G.HERO_SCALE) {
      g.scale.set(G.HERO_SCALE, G.HERO_SCALE, G.HERO_SCALE);
    }
    return g;
  } catch (e) { return null; }
}

function townNpc(g, n) {
  var x = +n.x, z = +n.z, ry = +n.ry || 0;
  var kind = n.kind || 'walker';
  if (kind === 'clerk' || kind === 'walker') {
    var hp = townNpcHero(n);
    if (hp) { g.add(hp); return; }
    g.add(townNpcModel(n));
    return;
  }
  var col = [0x4a6a8a, 0x8a5a4a, 0x5c6b46, 0x7a5535, 0x3e5968][(n.name || '').length % 5];
  if (kind === 'cat' || kind === 'dog') {
    var s = kind === 'cat' ? 0.75 : 1.0;
    var bodyC = kind === 'cat' ? (n.name === '橘子' ? 0xd8a45a : (n.name === '小白' ? 0xe8e0d0 : 0x4a4038))
                               : (n.name === '阿柴' ? 0xc98a44 : 0x3b3b3f);
    townBox(g, 0.55 * s, 0.38 * s, 0.95 * s, bodyC, x, 0.34 * s, z, ry);
    townBox(g, 0.40 * s, 0.36 * s, 0.38 * s, bodyC, x + Math.sin(ry) * 0.52 * s,
      0.48 * s, z + Math.cos(ry) * 0.52 * s, ry);
    townBox(g, 0.12 * s, 0.20 * s, 0.12 * s, bodyC, x - Math.sin(ry) * 0.42 * s,
      0.18 * s, z - Math.cos(ry) * 0.42 * s, ry);
    if (kind === 'cat') {
      townBox(g, 0.10, 0.18, 0.10, bodyC, x + Math.sin(ry) * 0.50 * s - 0.12,
        0.72 * s, z + Math.cos(ry) * 0.50 * s, ry);
      townBox(g, 0.10, 0.18, 0.10, bodyC, x + Math.sin(ry) * 0.50 * s + 0.12,
        0.72 * s, z + Math.cos(ry) * 0.50 * s, ry);
    }
    return;
  }
  var apron = kind === 'clerk' ? 0xe8dcc8 : 0x000000;
  townBox(g, 0.52, 0.72, 0.34, col, x, 1.18, z, ry);
  if (kind === 'clerk') { townBox(g, 0.46, 0.55, 0.06, apron, x + Math.sin(ry) * 0.18, 1.10, z + Math.cos(ry) * 0.18, ry); }
  townBox(g, 0.34, 0.34, 0.30, 0xf6cfa0, x, 1.72, z, ry);
  townBox(g, 0.38, 0.12, 0.34, 0x3e2c1e, x, 1.90, z, ry);
  townBox(g, 0.16, 0.62, 0.16, col, x - 0.32, 1.18, z, ry);
  townBox(g, 0.16, 0.62, 0.16, col, x + 0.32, 1.18, z, ry);
  townBox(g, 0.20, 0.55, 0.20, 0x3a3a44, x - 0.15, 0.55, z, ry);
  townBox(g, 0.20, 0.55, 0.20, 0x3a3a44, x + 0.15, 0.55, z, ry);
}

/* ============================ 组装 ============================ */
function buildTown() {
  if (TOWN_GROUP) { return TOWN_GROUP; }
  var g = new THREE.Group();
  g.name = 'newbie_town';
  scene.add(g);
  TOWN_GROUP = g;
  townGround(g);
  TOWN_CORE_GROUP = new THREE.Group();
  TOWN_CORE_GROUP.position.set(TOWN_CX, 0, TOWN_CZ);
  g.add(TOWN_CORE_GROUP);
  TOWN_SOLID_OX = TOWN_CX; TOWN_SOLID_OZ = TOWN_CZ;
  townCenter(TOWN_CORE_GROUP);
  townPlazaDetail(TOWN_CORE_GROUP);
  townGroundFlush(TOWN_CORE_GROUP);
  TOWN_SOLID_OX = 0; TOWN_SOLID_OZ = 0;
  townOuterWalls(g);
  for (var i = 0; i < TOWN_BUILDINGS.length; i++) {
    townBuilding(g, TOWN_BUILDINGS[i]);
  }
  for (var hi = 0; hi < TOWN_HOUSES.length; hi++) {
    townBuilding(g, TOWN_HOUSES[hi]);
  }
  for (var p = 0; p < (TOWN_DATA ? TOWN_DATA.props.length : 0); p++) {
    townProp(g, TOWN_DATA.props[p]);
  }
  TOWN_SEATS.forEach(function (s) { townSeat(g, s); });
  townPolesAndLights(g);
  townMarketLife(TOWN_CORE_GROUP);
  townTeleportPads(g);
  townTeleportLabels(g);
  townShopLabels(g);
  townNewDistrictDetails(g);
  TOWN_STATS.npcs = TOWN_NPCS.length;
  var _npcBefore = g.children.length;
  for (var ni = 0; ni < TOWN_NPCS.length; ni++) { townNpc(g, TOWN_NPCS[ni]); }
  TOWN_STATS.npcMeshes = g.children.length - _npcBefore;
  TOWN_STATS.seats = TOWN_SEATS.length;
  TOWN_STATS.solids = TOWN_SOLIDS.length;
  townGroundFlush(g);
  townBatchStatic(g);
  return g;
}

/* 镇外树林：InstancedMesh 一次绘制，纯粹做远景层次 */
function townForestRing(g) {
  var trees = [];
  for (var i = 0; i < 34; i++) {
    var a = i / 34 * Math.PI * 2 + 0.11 * Math.sin(i * 2.3);
    var r = 38.5 + (i % 5) * 1.7;
    var x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(x) < 7 || Math.abs(z) < 7) { continue; }
    trees.push({ x: x, z: z, s: 1.15 + (i % 4) * 0.16, v: (i % 5 === 0) ? 'pink' : 'green' });
  }
  for (var j = 0; j < 20; j++) {
    var a2 = j / 20 * Math.PI * 2 + 0.4;
    var r2 = 50 + (j % 4) * 2.2;
    trees.push({ x: Math.cos(a2) * r2, z: Math.sin(a2) * r2, s: 1.75 + (j % 3) * 0.3, v: j % 7 === 0 ? 'pink' : 'dark' });
  }
  var trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 2.2, 6);
  var leafGeo = new THREE.IcosahedronGeometry(1, 0);
  var trunkIM = new THREE.InstancedMesh(trunkGeo, matOf(0x4f3a2a), trees.length);
  var green = [], dark = [], pink = [];
  var mtx = new THREE.Matrix4(), q0 = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  for (var k = 0; k < trees.length; k++) {
    var t = trees[k];
    pos.set(t.x, 1.1 * t.s, t.z); scl.set(1, t.s, 1);
    mtx.compose(pos, q0, scl);
    trunkIM.setMatrixAt(k, mtx);
    var arr = t.v === 'pink' ? pink : (t.v === 'dark' ? dark : green);
    for (var c = 0; c < 3; c++) {
      var ox = (c === 0 ? 0 : (c === 1 ? -0.55 : 0.55)) * t.s;
      var oz = (c === 0 ? 0 : (c === 1 ? 0.22 : -0.18)) * t.s;
      var oy = (1.95 + c * 0.28) * t.s;
      var sc = (c === 0 ? 1.05 : 0.78) * t.s;
      arr.push({ x: t.x + ox, y: oy, z: t.z + oz, s: sc });
    }
  }
  trunkIM.instanceMatrix.needsUpdate = true;
  trunkIM.frustumCulled = false;
  g.add(trunkIM);
  function leafIM(list, color) {
    if (!list.length) { return; }
    var im = new THREE.InstancedMesh(leafGeo, matOf(color), list.length);
    for (var i2 = 0; i2 < list.length; i2++) {
      pos.set(list[i2].x, list[i2].y, list[i2].z);
      scl.set(list[i2].s, list[i2].s * 0.82, list[i2].s);
      mtx.compose(pos, q0, scl);
      im.setMatrixAt(i2, mtx);
    }
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    g.add(im);
  }
  leafIM(green, 0x4f7045);
  leafIM(dark, 0x3c5a3c);
  leafIM(pink, 0xe8a8b8);
}

/* 电线：把相邻电线杆连起来（带一点下垂）*/
function townPolesAndLights(g) {
  var poles = TOWN_DATA ? TOWN_DATA.poles : [];
  poles.forEach(function (p) { townPole(g, p.x, p.z); });
  for (var i = 0; i < poles.length; i++) {
    var best = -1, bd = 1e9;
    for (var j = 0; j < poles.length; j++) {
      if (i === j) { continue; }
      var d2 = (poles[i].x - poles[j].x) * (poles[i].x - poles[j].x) +
               (poles[i].z - poles[j].z) * (poles[i].z - poles[j].z);
      if (d2 < bd) { bd = d2; best = j; }
    }
    if (best < 0 || best < i || bd > 26 * 26) { continue; }
    var a = poles[i], b = poles[best];
    for (var w = 0; w < 2; w++) {
      var n = 5, y0 = 4.95 - w * 0.42;
      var prevX = a.x, prevY = y0, prevZ = a.z;
      for (var k = 1; k <= n; k++) {
        var t = k / n;
        var nx = a.x + (b.x - a.x) * t;
        var nz = a.z + (b.z - a.z) * t;
        var ny = y0 - Math.sin(t * Math.PI) * 0.55;
        var mx = (prevX + nx) / 2, mz = (prevZ + nz) / 2, my = (prevY + ny) / 2;
        var dx = nx - prevX, dz = nz - prevZ, dy = ny - prevY;
        var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        var m = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.024, len), matOf(0x2a2c30));
        m.position.set(mx, my, mz);
        m.lookAt(nx, ny, nz);
        g.add(m);
        prevX = nx; prevY = ny; prevZ = nz;
      }
    }
  }
  /* 广场串灯 */
  var lampPts = [[-10.6, -10.6], [10.6, -10.6], [10.6, 10.6], [-10.6, 10.6]];
  for (var q = 0; q < 4; q++) {
    var a2 = lampPts[q], b2 = lampPts[(q + 1) % 4];
    var steps = 9;
    for (var s2 = 1; s2 < steps; s2++) {
      var t2 = s2 / steps;
      var px = a2[0] + (b2[0] - a2[0]) * t2;
      var pz = a2[1] + (b2[1] - a2[1]) * t2;
      var py = 3.35 - Math.sin(t2 * Math.PI) * 0.45;
      townGlow(g, 0.10, 0.10, 0.10, (s2 % 2 ? 0xffe0a0 : 0xffc080), px, py, pz, 0.9);
    }
  }
}

/* 街口灯笼串：暖色小灯 + 细线，夜景氛围 */
function townLanternString(parent, x0, z0, x1, z1, y, n, color) {
  var prevX = x0, prevY = y, prevZ = z0;
  for (var i = 1; i <= n; i++) {
    var t = i / n;
    var nx = x0 + (x1 - x0) * t;
    var nz = z0 + (z1 - z0) * t;
    var ny = y - Math.sin(t * Math.PI) * 0.38;
    var dx = nx - prevX, dy = ny - prevY, dz = nz - prevZ;
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len > 0.01) {
      var w = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, len), matOf(0x2a2118));
      w.position.set((prevX + nx) / 2, (prevY + ny) / 2, (prevZ + nz) / 2);
      w.lookAt(nx, ny, nz);
      parent.add(w);
    }
    townGlow(parent, 0.15, 0.20, 0.15, color || 0xffb060, nx, ny - 0.12, nz, 0.9);
    townBox(parent, 0.05, 0.08, 0.05, 0x3a2d20, nx, ny + 0.08, nz);
    prevX = nx; prevY = ny; prevZ = nz;
  }
}

/* 市集 / 生活气息：小推车、猫、花盆、晾衣、蒸汽 */
function townMarketLife(g) {
  /* 一只睡在长椅上的猫 */
  (function () {
    var x = -6.2, z = 6.2, y = 0.34;
    townSphere(g, 0.16, 0xd8a45a, x + 0.5, y + 0.16, z - 0.05, 0);
    townSphere(g, 0.12, 0xd8a45a, x + 0.28, y + 0.19, z - 0.02, 0);
    townBox(g, 0.05, 0.12, 0.05, 0xd8a45a, x + 0.20, y + 0.10, z + 0.10);
    townBox(g, 0.03, 0.16, 0.03, 0xd8a45a, x + 0.22, y + 0.28, z + 0.08);
    townBox(g, 0.03, 0.16, 0.03, 0xd8a45a, x + 0.22, y + 0.28, z + 0.14);
  })();
  /* 温泉蒸汽（半透明小方块，固定不动）*/
  for (var i = 0; i < 5; i++) {
    townPlane(g, 0.7 + i * 0.2, 0.7 + i * 0.2, 0xd8eef2, 27.6, 0.5 + i * 0.55, 12.0, 0.10);
  }
  /* 铁匠铺烟 */
  for (var s = 0; s < 4; s++) {
    townPlane(g, 0.5 + s * 0.3, 0.5 + s * 0.3, 0x9a9a94, 31.0, 2.4 + s * 0.6, 9.4, 0.10);
  }
  /* 街口灯笼串 */
  townLanternString(g, -5.4, -14.4, 5.4, -14.4, 3.05, 7, 0xffb060);
  townLanternString(g, -5.4, 14.4, 5.4, 14.4, 3.05, 7, 0xffa050);
  townLanternString(g, -14.4, -4.2, -14.4, 4.2, 3.05, 6, 0xffc070);
  townLanternString(g, 14.4, -4.2, 14.4, 4.2, 3.05, 6, 0xffb060);
  /* 街口旗帜 */
  townBanner(g, -4.7, -13.4, 0, 0x9a3a2e, '祭');
  townBanner(g, 4.7, -13.4, 0, 0x2f4a6a, '町');
  townBanner(g, -4.7, 13.4, 0, 0x3f6a4a, '市');
  townBanner(g, 4.7, 13.4, 0, 0x9a3a2e, '福');
  townBanner(g, -8.7, 3.2, Math.PI / 2, 0x2f4a6a, '茶');
  townBanner(g, 8.7, -3.2, Math.PI / 2, 0x9a3a2e, '食');
  /* 门口花盆 / 小招牌 */
  [[-8.9, -6.2], [19.9, -6.2], [-23.1, 14.2], [18.4, 12.3]].forEach(function (p) {
    townPot(g, p[0], p[1]);
  });
}

/* 中央喷泉 / 广场 */
function townCenter(g) {
  var fx = 0, fz = 0;
  /* 从旧广场搬过来的外圈石带 + 同心圆环 + 井盖 */
  townBox(g, 18.8, 0.045, 0.50, 0x7f7a6c, fx, 0.040, fz - 9.20);
  townBox(g, 18.8, 0.045, 0.50, 0x7f7a6c, fx, 0.040, fz + 9.20);
  townBox(g, 0.50, 0.045, 18.8, 0x7f7a6c, fx - 9.20, 0.040, fz);
  townBox(g, 0.50, 0.045, 18.8, 0x7f7a6c, fx + 9.20, 0.040, fz);
  for (var _ring = 0; _ring < 3; _ring++) {
    var _rg = new THREE.Mesh(new THREE.TorusGeometry(4.3 + _ring * 0.8, 0.035, 4, 56), matOf(0x827d6e));
    _rg.rotation.x = Math.PI / 2;
    _rg.position.set(fx, 0.045, fz);
    g.add(_rg);
  }
  [[-2.6, 2.0], [2.4, -2.0], [3.6, 4.0]].forEach(function (p) {
    townCyl(g, 0.36, 0.36, 0.025, 0x3f423d, fx + p[0], 0.047, fz + p[1], 14);
  });
  townCyl(g, 2.15, 2.25, 0.18, 0x9a9688, fx, 0.09, fz, 20);
  townCyl(g, 1.85, 2.00, 0.55, 0x8a8272, fx, 0.36, fz, 20);
  townCyl(g, 1.62, 1.62, 0.10, 0x4b8aa0, fx, 0.64, fz, 20);
  townGlow(g, 2.9, 0.03, 2.9, 0x9fe8ff, fx, 0.67, fz, 0.18);
  townCyl(g, 0.42, 0.52, 1.35, 0x8a8272, fx, 1.05, fz, 10);
  townCyl(g, 0.62, 0.42, 0.18, 0x9a9688, fx, 1.78, fz, 10);
  townGlow(g, 0.50, 0.10, 0.50, 0x9fe8ff, fx, 1.88, fz, 0.55);
  townCyl(g, 0.10, 0.12, 0.45, 0xb08a45, fx, 2.08, fz, 8);
  townSphere(g, 0.16, 0xd8f0ff, fx, 2.35, fz, 0);
  /* 水面细纹 */
  for (var i = 0; i < 6; i++) {
    var a = i * Math.PI / 3;
    townBox(g, 0.6, 0.01, 0.06, 0xbfeaff, fx + Math.cos(a) * 1.05, 0.68, fz + Math.sin(a) * 1.05, a);
  }
  /* 广场四灯 */
  [[-5.6, -5.6], [5.6, -5.6], [5.6, 5.6], [-5.6, 5.6]].forEach(function (p) {
    townBox(g, 0.16, 2.4, 0.16, 0x3f454c, p[0], 1.2, p[1]);
    townGlow(g, 0.40, 0.22, 0.40, 0xffd9a0, p[0], 2.45, p[1], 0.85);
    townBox(g, 0.50, 0.06, 0.50, 0x2f3438, p[0], 2.58, p[1]);
    townGlowPool(g, p[0], p[1], 2.4, 0xffd9a0, 0.40);
  });
  /* 中央地纹 */
  for (var r = 0; r < 8; r++) {
    var ang = r * Math.PI / 4;
    townBox(g, 5.4, 0.012, 0.10, 0x6f6a5c, 0, 0.043, 0, ang);
  }
}

/* 广场生活细节：花坛 / 信息亭 / 小吃车 / 盆栽 */
function townBanner(parent, x, z, ry, col, text) {
  var nx = Math.sin(ry || 0), nz = Math.cos(ry || 0);
  townBox(parent, 0.09, 3.0, 0.09, 0x3f2d1e, x, 1.5, z);
  townBox(parent, Math.abs(nx) > 0.5 ? 0.06 : 1.1, 0.08, Math.abs(nx) > 0.5 ? 1.1 : 0.06,
    0x3f2d1e, x, 2.72, z);
  var cx = x + (Math.abs(nx) > 0.5 ? 0 : 0.42);
  var cz = z + (Math.abs(nx) > 0.5 ? 0.42 : 0);
  townBox(parent, Math.abs(nx) > 0.5 ? 0.05 : 0.52, 1.55, Math.abs(nx) > 0.5 ? 0.52 : 0.05, col, cx, 1.88, cz);
  if (Math.abs(nx) > 0.5) {
    townSignPlane(parent, text, 0.44, 1.38, cx + nx * 0.035, 1.88, cz, Math.PI / 2, '#2f241a', '#ffe9b0', true);
  } else {
    townSignPlane(parent, text, 0.44, 1.38, cx, 1.88, cz + nz * 0.035, 0, '#2f241a', '#ffe9b0', true);
  }
}

function townPlazaDetail(g) {
  var beds = [[-3.7, -3.7], [3.7, -3.7], [-3.7, 3.7], [3.7, 3.7]];
  beds.forEach(function (p, i) {
    townSoftShadow(g, p[0] + 0.08, p[1] + 0.06, 2.0, 2.0, 0, 0.18);
    townBox(g, 1.65, 0.34, 1.65, 0x8a8272, p[0], 0.17, p[1]);
    townBox(g, 1.50, 0.12, 1.50, 0x4f4535, p[0], 0.38, p[1]);
    townBox(g, 1.46, 0.26, 1.46, 0x4a6b44, p[0], 0.56, p[1]);
    for (var f = 0; f < 9; f++) {
      var a = f * 2.1;
      townSphere(g, 0.17, [0x5c8a52, 0xd8708a, 0xe8c060, 0xe06a8a][f % 4],
        p[0] + Math.cos(a) * 0.48, 0.70 + (f % 2) * 0.08, p[1] + Math.sin(a) * 0.48, 0);
    }
    townCyl(g, 0.09, 0.11, 0.85, 0x5f4530, p[0], 0.95, p[1], 7);
    townSphere(g, 0.46, i % 2 ? 0x4f7045 : 0xe8a8b8, p[0], 1.45, p[1], 1);
    townSphere(g, 0.28, 0x557a4c, p[0] - 0.30, 1.25, p[1] + 0.10, 1);
    townSolid(p[0] - 0.85, p[1] - 0.85, p[0] + 0.85, p[1] + 0.85);
  });
  /* 信息亭 */
  (function () {
    var x = -6.4, z = -1.2;
    townBox(g, 1.55, 0.20, 0.95, 0x6b4a32, x, 0.10, z);
    townBox(g, 0.12, 1.9, 0.12, 0x3f2d1e, x - 0.62, 1.05, z);
    townBox(g, 0.12, 1.9, 0.12, 0x3f2d1e, x + 0.62, 1.05, z);
    townBox(g, 1.45, 1.15, 0.10, 0x5f4530, x, 1.40, z);
    townBox(g, 1.30, 1.00, 0.05, 0xd8cbb0, x, 1.40, z + 0.07);
    townSignPlane(g, '小镇地图', 1.15, 0.28, x, 1.68, z + 0.10, 0, '#efe4cc', '#3a2a1c');
    for (var m = 0; m < 4; m++) {
      townBox(g, 0.28, 0.14, 0.02, [0x7c8a5c, 0x8a6a48, 0x5c7a8a][m % 3],
        x - 0.38 + (m % 2) * 0.72, 1.30 - Math.floor(m / 2) * 0.32, z + 0.10);
    }
    townMiniRoof(g, 1.9, 1.2, 0x4a5a52, x, 2.10, z, 0);
    townSolid(x - 0.85, z - 0.55, x + 0.85, z + 0.55);
    townGlowPool(g, x + 0.4, z + 0.9, 1.3, 0xffd9a0, 0.25);
  })();
  /* 小吃车 */
  (function () {
    var x = 6.3, z = 1.0;
    townBox(g, 1.35, 0.75, 0.9, 0x8a6a48, x, 0.52, z);
    townBox(g, 1.45, 0.10, 1.0, 0x3f2d1e, x, 0.95, z);
    townBox(g, 1.35, 0.55, 0.06, 0x9a4a3a, x, 1.56, z - 0.30);
    townBox(g, 1.8, 0.08, 1.35, 0x9a4a3a, x, 1.98, z);
    for (var q = 0; q < 4; q++) {
      townBox(g, 0.42, 0.08, 1.35, (q % 2 ? 0xe0d2b8 : 0x9a4a3a), x - 0.7 + q * 0.46, 2.02, z);
    }
    townBox(g, 0.07, 1.0, 0.07, 0x3f2d1e, x - 0.70, 1.48, z + 0.38);
    townBox(g, 0.07, 1.0, 0.07, 0x3f2d1e, x + 0.70, 1.48, z + 0.38);
    townGlow(g, 0.85, 0.10, 0.55, 0xffd9a0, x, 1.42, z + 0.05, 0.55);
    for (var f2 = 0; f2 < 3; f2++) {
      townSphere(g, 0.12, [0xe0a040, 0xc85a4a, 0x8fb060][f2], x - 0.4 + f2 * 0.4, 1.05, z + 0.18, 0);
    }
    townBox(g, 0.28, 0.28, 0.28, 0x2b2b2f, x - 0.58, 0.20, z - 0.25);
    townBox(g, 0.28, 0.28, 0.28, 0x2b2b2f, x + 0.58, 0.20, z - 0.25);
    townSolid(x - 0.85, z - 0.60, x + 0.85, z + 0.60);
    townSignBoard(g, '小吃', 0.75, 0.34, x, 1.62, z + 0.55, 0, '#2a2118', '#ffe9b0');
  })();
  /* 广场四角盆栽 */
  [[-8.2, 0.4], [8.2, -0.4]].forEach(function (p) {
    townCyl(g, 0.24, 0.28, 0.50, 0x8a8272, p[0], 0.25, p[1], 10);
    townCyl(g, 0.07, 0.09, 1.20, 0x5f4530, p[0], 1.0, p[1], 7);
    townSphere(g, 0.55, 0x557a4c, p[0], 1.65, p[1], 1);
  });
  /* 地面暖光斑 */
  townGlowPool(g, 0, 0, 5.2, 0xffe0b0, 0.18);
}

function townRoofTick(px, pz, firstPerson) {
  for (var i = 0; i < TOWN_ROOFS.length; i++) {
    var r = TOWN_ROOFS[i];
    var inside = (px >= r.x0 && px <= r.x1 && pz >= r.z0 && pz <= r.z1);
    r.g.visible = !inside;
  }
}
