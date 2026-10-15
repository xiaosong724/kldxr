# -*- coding: utf-8 -*-
"""第 171 轮（重做）：空位按每页 35 补 + 地上防具改成迷你胸甲

★ 上一版我写了个 "\u7b2c 171 \u轮" —— 一个残缺的 \u 转义 ✗
  → Python 直接语法错 → 整段一条都没执行 ✓
  ★ 结论：中文注释里【不要】混 \uXXXX 转义 ✗ 直接写中文最安全 ✓
"""
import io

# ==================== ① 空位按每页 35 补 ====================
P = 'web/platform/web.js'
t = io.open(P, encoding='utf-8').read()
OLD = "  for (var p = BAG.items.length; p < total; p++) { html += '<div class=\"slot empty\"></div>'; }"
assert t.count(OLD) == 1, ('空位锚点: %d' % t.count(OLD))
t = t.replace(OLD, """  /* ★ 第 171 轮（用户 #4）：空位要按【每页 35 格】补
     不能按背包总容量补 —— 不然第二页开头"一个空位都没有"，页面长短不一 */
  var _filled = (_to - _from);
  for (var p = _filled; p < BAG_PAGE_SIZE; p++) { html += '<div class="slot empty"></div>'; }""")
io.open(P, 'w', encoding='utf-8', newline='\n').write(t)
print('  OK 空位按每页 35 补')

# ==================== ② 地上防具：方块 → 迷你胸甲 ====================
P2 = 'web/core/game.js'
t2 = io.open(P2, encoding='utf-8').read()
OLD2 = """var _lootGeo = null, _lootShellGeo = null;
function lootGeo() {
  if (!_lootGeo) { _lootGeo = new THREE.BoxGeometry(0.30, 0.30, 0.30); }
  return _lootGeo;
}"""
assert t2.count(OLD2) == 1, ('lootGeo 锚点: %d' % t2.count(OLD2))
t2 = t2.replace(OLD2, """var _lootGeo = null, _lootShellGeo = null, _lootArmorGeo = null;
function lootGeo() {
  if (!_lootGeo) { _lootGeo = new THREE.BoxGeometry(0.30, 0.30, 0.30); }
  return _lootGeo;
}
/* ★ 第 171 轮（用户 #9）：地上的防具不再是一个方块
   用户原话：「地上防具是个方块（武器是缩小版模型）」

   做法：用 mergeBoxes 拼一个【迷你胸甲】
     躯干 + 左右肩甲 + 一条腰带（和玩家身上那件一个意思）
   为什么照旧用 mergeBoxes：它把多个盒子合并成【一个】网格
     只多 1 次 draw call（掉落物一多，不能每件拆成几十个网格） */
function lootArmorGeo() {
  if (!_lootArmorGeo) {
    _lootArmorGeo = mergeBoxes([
      [0.26, 0.22, 0.12, 0xffffff, 0, 0.02, 0],       /* 躯干 */
      [0.10, 0.09, 0.11, 0xffffff, -0.16, 0.09, 0],   /* 左肩 */
      [0.10, 0.09, 0.11, 0xffffff, 0.16, 0.09, 0],    /* 右肩 */
      [0.22, 0.05, 0.11, 0xffffff, 0, -0.11, 0]       /* 腰带 */
    ]);
  }
  return _lootArmorGeo;
}""")
io.open(P2, 'w', encoding='utf-8', newline='\n').write(t2)
print('  OK core：加了胸甲几何体 lootArmorGeo()')
print('  （下一步要用上它 —— 得先看清掉落物那段怎么判断类型）')
