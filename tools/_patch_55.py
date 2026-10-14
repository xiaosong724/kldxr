# -*- coding: utf-8 -*-
"""第 55 轮：① 历史重复材料一次性合并 ② 等级/发挥度写进文案 ③ 数量改灰字"""
import io

# ============ ① db.py：版本 2 的数据迁移（合并历史重复材料）============
P = 'server/db.py'
t = io.open(P, encoding='utf-8').read()

a = "SCHEMA_VERSION = 1"
b = "SCHEMA_VERSION = 2"
assert t.count(a) == 1, ('ver', t.count(a))
t = t.replace(a, b)

# 在 MIGRATIONS 字典的最后追加版本 2
anchor = "\n\n# ============================================================ 连接"
assert t.count(anchor) == 1, ('anchor', t.count(anchor))
mig2 = '''
# ★ 版本 2（第 55 轮）：把历史上【重复的材料行】合并成一行
#
#   为什么需要：材料堆叠是第 54 轮才做的 ✓
#   在那之前捡的每一份材料都单独占一行（实测有个角色背包里 13 行"破布"✗）
#   新捡的会自动堆 ✓ 但老行不会自己合并 ✗ → 这里做一次性整理 ✓
#
#   ★ 只动【材料】（item_json 里没有 slot 字段的 ✓）
#     武器/防具一律不碰 ✓（装备永远一件一行 ✓）
#   ★ 合并键 = role_id + in_storage + 名字 + 品阶（和别人、别的阶都不混 ✓）
#   ★ 保留 id 最小的那行（最老的那份），把总数写进去，其余删掉 ✓
#
#   踩过的坑：DELETE 的子查询必须【按同一套键】GROUP BY ✗
#   不然会把"名字相同但品阶不同"的行也删掉 ✗
MIGRATIONS[2] = [
    """UPDATE items SET stack = (
        SELECT SUM(b.stack) FROM items b
         WHERE b.role_id = items.role_id
           AND b.in_storage = items.in_storage
           AND json_extract(b.item_json,'$.name') = json_extract(items.item_json,'$.name')
           AND json_extract(b.item_json,'$.tier') = json_extract(items.item_json,'$.tier')
           AND json_extract(b.item_json,'$.slot') IS NULL)
      WHERE json_extract(items.item_json,'$.slot') IS NULL
        AND items.id = (
            SELECT MIN(c.id) FROM items c
             WHERE c.role_id = items.role_id
               AND c.in_storage = items.in_storage
               AND json_extract(c.item_json,'$.name') = json_extract(items.item_json,'$.name')
               AND json_extract(c.item_json,'$.tier') = json_extract(items.item_json,'$.tier')
               AND json_extract(c.item_json,'$.slot') IS NULL)""",
    """DELETE FROM items
      WHERE json_extract(item_json,'$.slot') IS NULL
        AND id NOT IN (
            SELECT MIN(id) FROM items
             WHERE json_extract(item_json,'$.slot') IS NULL
             GROUP BY role_id, in_storage,
                      json_extract(item_json,'$.name'),
                      json_extract(item_json,'$.tier'))""",
]'''
t = t.replace(anchor, mig2 + anchor, 1)
io.open(P, 'w', encoding='utf-8', newline='\n').write(t)
print('  OK db.py：版本 2 迁移（合并历史重复材料）')

# ============ ② web.js：等级/发挥度进文案 + 数量灰字 ============
P2 = 'web/platform/web.js'
t2 = io.open(P2, encoding='utf-8').read()


def rep(a, b, name):
    global t2
    c = t2.count(a)
    assert c == 1, '%s: %d 次' % (name, c)
    t2 = t2.replace(a, b)
    io.open(P2, 'w', encoding='utf-8', newline='\n').write(t2)
    print('  OK', name)


# 悬停提示：名字那一行直接把"建议N级 / 发挥X%"写进去（= 用户说的"改到文案里"✓）
rep("""  box.innerHTML = '<b style="color:' + tierHex(it.tier || 0) + '">' + (it.name || '?') + '</b>' +
    '<i> · ' + (it.tier || 0) + ' 阶' + (it.itemLv ? (' · 物品 ' + it.itemLv + ' 级') : '') +
    '</i><br>' + extra +
    '<i>' + (it.slot === 'weapon' ? '点一下穿上' : '材料（以后做合成用）') + '</i>';""",
"""  /* ★★ 第 55 轮：等级需求 + 发挥度【写进文案】★★
     用户要求："武器等级需求还是没有显示，把它改到文案里吧，以及发挥度"
     —— 所以不再只靠角标/黄标（那个太小、还得对上位置 ✗）
        直接在名字那一行写成字 ✓ 看了就知道 ✓ */
  var m5 = (it.slot === 'weapon') ? wMastery(it) : 1;
  var req5 = +((it && it.reqLevel) || 1);
  var lv5 = (WSC.role && WSC.role.level) || 1;
  var lvlTxt = '';
  if (it.slot === 'weapon') {
    lvlTxt = (m5 < 1)
      ? '<i> · 建议 ' + req5 + ' 级（你现在 ' + lv5 + ' 级）· 发挥 ' + Math.round(m5 * 100) + '%</i>'
      : '<i> · 建议 ' + req5 + ' 级（已达标 ✓ 发挥 100%）</i>';
  }
  box.innerHTML = '<b style="color:' + tierHex(it.tier || 0) + '">' + (it.name || '?') + '</b>' +
    '<i> · ' + (it.tier || 0) + ' 阶' + (it.itemLv ? (' · 物品 ' + it.itemLv + ' 级') : '') +
    '</i>' + lvlTxt + '<br>' + extra +
    '<i>' + (it.slot === 'weapon' ? '选中后点「使用」穿上' : '材料（以后做合成用）') + '</i>';""",
'悬停文案加等级/发挥度')

# 装备槽悬停也一样
rep("""      box.innerHTML = '<b style="color:' + tierHex(w.tier || 0) + '">' + (w.name || '?') + '</b>' +
        '<i> · ' + (w.tier || 0) + ' 阶 · 已装备</i><br>实际每击 <b>' +
        wRealHit(w).toFixed(0) + '</b> · 每秒 <b>' + wRealDps(w).toFixed(0) + '</b><br>' +
        '<i>武器强度 ' + wStrength(w).toFixed(0) + ' · 点一下脱下</i>';""",
"""      var m6 = wMastery(w);
      var lv6 = (WSC.role && WSC.role.level) || 1;
      box.innerHTML = '<b style="color:' + tierHex(w.tier || 0) + '">' + (w.name || '?') + '</b>' +
        '<i> · ' + (w.tier || 0) + ' 阶 · 已装备</i>' +
        (m6 < 1 ? ('<i> · 建议 ' + (w.reqLevel || 1) + ' 级（你 ' + lv6 + ' 级）· 发挥 ' +
                   Math.round(m6 * 100) + '%</i>') : '') + '<br>实际每击 <b>' +
        wRealHit(w).toFixed(0) + '</b> · 每秒 <b>' + wRealDps(w).toFixed(0) + '</b><br>' +
        '<i>武器强度 ' + wStrength(w).toFixed(0) + ' · 点一下脱下</i>';""",
'装备槽悬停文案')

# 面板里的"当前选中"那一行也加名字文案
rep("""  var selTip = document.getElementById('bagSelTip');
  if (selTip) {
    selTip.textContent = (selItem && selItem.slot === 'weapon')
      ? (selIsEquipped ? '这件正拿在手上' : '点「使用」穿上它')
      : '点上面的格子选中一件武器';
  }""",
"""  var selTip = document.getElementById('bagSelTip');
  if (selTip) {
    if (selItem && selItem.slot === 'weapon') {
      var m7 = wMastery(selItem);
      var rq7 = +((selItem.reqLevel) || 1);
      var lv7 = (WSC.role && WSC.role.level) || 1;
      selTip.textContent = (selItem.name || '武器') + ' · ' + (selItem.tier || 0) + ' 阶 · 建议 ' +
        rq7 + ' 级（你 ' + lv7 + ' 级）· 发挥 ' + Math.round(m7 * 100) + '%' +
        (selIsEquipped ? ' · 正拿在手上' : '');
    } else {
      selTip.textContent = '点上面的格子选中一件武器';
    }
  }""",
'选中提示文案')

io.open(P2, 'w', encoding='utf-8', newline='\n').write(t2)

# ============ ③ index.html：数量改灰字 ============
P3 = 'web/index.html'
t3 = io.open(P3, encoding='utf-8').read()
a3 = """.slot .cnt{position:absolute;right:2px;bottom:-1px;font-size:11px;color:#fff;font-weight:700;
  text-shadow:0 1px 2px #000,0 0 3px #000}"""
b3 = """/* ★ 第 55 轮：数量用【灰色】细字（用户要求）—— 白字太抢眼，会把品阶底色压住 ✗ */
.slot .cnt{position:absolute;right:2px;bottom:-1px;font-size:11px;color:#cfc9bf;font-weight:600;
  text-shadow:0 1px 2px #000,0 0 3px #000}"""
assert t3.count(a3) == 1, ('cnt', t3.count(a3))
t3 = t3.replace(a3, b3)
io.open(P3, 'w', encoding='utf-8', newline='\n').write(t3)
print('  OK index.html：数量灰字')
