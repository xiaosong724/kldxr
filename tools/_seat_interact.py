# -*- coding: utf-8 -*-
"""椅子交互接上新家具：townSeatNear 同时查已放置的座椅类家具。"""
import io

p = 'web/core/town.js'
s = io.open(p, encoding='utf-8').read()

old = """function townSeatNear(x, z) {
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
  return best;
}"""

new = """/* 可坐的家具 catalog（已放置的家具也能坐） */
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
}"""

if old in s:
    s = s.replace(old, new, 1)
    io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
    print('seat interact patched')
else:
    print('anchor miss')
