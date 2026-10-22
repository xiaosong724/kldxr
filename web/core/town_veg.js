/* 植被部件库：叶片、花簇、叶团
 * 目标：用大量小型扁片面片堆出"树叶感"，不再用大圆球。
 * 所有函数都往传入的 piece 里加网格，并带中文零件名。
 */

/* 一片叶子：扁平的菱形面片，带轻微倾斜和旋转 */
function vegLeaf(P, g, cx, cy, cz, size, color, tilt, yaw, name) {
  var m = tmBox(g, size * 0.34, size * 0.05, size, color, cx, cy, cz, yaw);
  if (m && m.rotation) { m.rotation.z = tilt || 0; }
  tmTag(m, name || 'leaf');
  P.add(m);
  return m;
}

/* 一团树叶：在球体范围内撒 N 片叶子，做出蓬松感 */
function vegLeafCluster(P, g, cx, cy, cz, radius, count, color, color2, seed) {
  var sd = seed || 1;
  function rnd() {
    /* 确定性伪随机，保证每次生成一致 */
    sd = (sd * 9301 + 49297) % 233280;
    return sd / 233280;
  }
  for (var i = 0; i < count; i++) {
    /* 球面均匀分布 */
    var u = rnd() * 2 - 1;
    var th = rnd() * Math.PI * 2;
    var r = radius * (0.55 + rnd() * 0.45);
    var sq = Math.sqrt(1 - u * u);
    var px = cx + Math.cos(th) * sq * r;
    var py = cy + u * r * 0.85;
    var pz = cz + Math.sin(th) * sq * r;
    var col = (i % 3 === 0) ? color2 : color;
    vegLeaf(P, g, px, py, pz, radius * (0.55 + rnd() * 0.5), col,
      (rnd() - 0.5) * 0.9, rnd() * Math.PI * 2, 'leaf_' + (i + 1));
  }
}

/* 一朵花：5-6 片花瓣 + 花心，扁平面片 */
function vegFlower(P, add, g, cx, cy, cz, petalR, petalColor, coreColor, petalCount, name) {
  var n = petalCount || 5;
  for (var i = 0; i < n; i++) {
    var a = i / n * Math.PI * 2;
    var px = cx + Math.cos(a) * petalR * 0.55;
    var pz = cz + Math.sin(a) * petalR * 0.55;
    var m = tmBox(g, petalR * 0.62, 0.015, petalR * 0.40, petalColor, px, cy, pz, a);
    add(m, (name || 'flower') + '_petal_' + (i + 1));
  }
  var c = tmCyl(g, petalR * 0.22, petalR * 0.22, 0.03, coreColor, cx, cy + 0.012, cz);
  add(c, (name || 'flower') + '_core');
}

/* 带茎的花：茎 + 两片叶 + 花头 */
function vegStemFlower(P, add, g, cx, baseY, cz, height, petalR, petalColor, coreColor, name, seed) {
  var h = height;
  P.add(add(tmCyl(g, 0.012, 0.016, h, 0x4a7a3a, cx, baseY + h / 2, cz), (name || 'flower') + '_stem'));
  /* 茎上两片叶 */
  P.add(add(tmBox(g, petalR * 0.7, 0.012, petalR * 0.3, 0x5c8a52,
    cx + petalR * 0.35, baseY + h * 0.45, cz, 0.5), (name || 'flower') + '_leaf_a'));
  P.add(add(tmBox(g, petalR * 0.7, 0.012, petalR * 0.3, 0x5c8a52,
    cx - petalR * 0.35, baseY + h * 0.32, cz, -0.5), (name || 'flower') + '_leaf_b'));
  vegFlower(P, add, g, cx, baseY + h, cz, petalR, petalColor, coreColor, 5, name);
}
