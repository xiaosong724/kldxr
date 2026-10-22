# -*- coding: utf-8 -*-
"""验收：自动出售（离线跑 World，真实走 _intent_pick）

用户："增加装备自动出售，可以设置低于多少阶获取后自动出售"
"""
import json, os, sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(_HERE), 'server'))

import world as W
import weapons, armor, value

FAILS = 0


def ck(c, m, got=None):
    global FAILS
    if c:
        print('  PASS  ' + m)
    else:
        FAILS += 1
        print('  FAIL  ' + m + ('' if got is None else '  got=%r' % (got,)))


w = W.World(None)
w._send_cid = lambda c, r: None
w._broadcast = lambda text: None
w._to_net = lambda fn, *a: None
saves = []
w.post_save = lambda sql, params=None: saves.append((sql, params))

q = W.Player('cA', {'id': 901, 'name': '甲', 'level': 30, 'hp': 500, 'qi': 0, 'exp': 0})
q.x, q.z = 10.0, 10.0
q.name = '甲'
q.role_id = 901
q.weapon = dict(weapons.FIST)
q.role = {'id': 901, 'name': '甲', 'level': 30, 'exp': 0, 'hp': 500, 'qi': 0,
          'autosell': 0}
w.players[q.cid] = q
w._gain_gold_orig = w._gain_gold


def pick(item, tier_setting):
    """往地上放一件 → 捡 → 返回 (金币增量, 有没有进背包)"""
    q.role['autosell'] = tier_setting
    gold0 = int((q.role.get('gold') or 0))
    saves.clear()
    w.loot_seq += 1
    lid = str(w.loot_seq)
    w.loot[lid] = {'x': q.x, 'z': q.z, 'item': item, 'ttl': 60.0}
    w._intent_pick(q, {'id': lid})
    gold1 = int((q.role.get('gold') or 0))
    went_to_bag = any(isinstance(s, str) and s == 'PICK' for s, _ in saves)
    return gold1 - gold0, went_to_bag


# ① 关着的时候：装备正常进背包
it2 = armor.make_armor(1, 2)          # 2 阶防具（tier=1 → 显示 2 阶）
did, bag = pick(it2, 0)
print('  关闭时捡 2 阶防具: 金币 +%d · 进背包=%s' % (did, bag))
ck(did == 0 and bag is True, '★★ 不自动卖时：正常进背包', (did, bag))

# ② 设置"低于 4 阶自动卖"：2 阶防具应当当场卖掉
it2b = armor.make_armor(1, 2)
price = value.value_of(it2b, 1)
did, bag = pick(it2b, 4)
print('  开启后捡 2 阶防具: 金币 +%d（应收 %d）· 进背包=%s' % (did, price, bag))
ck(did == price and did > 0, '★★ 2 阶装备被自动卖掉了，金币到账', (did, price))
ck(bag is False, '★★ 而且【没有】进背包', bag)

# ③ 高于阈值的不卖
it5 = armor.make_armor(4, 4)          # 5 阶
did, bag = pick(it5, 4)
print('  捡 5 阶防具（阈值 4）: 金币 +%d · 进背包=%s' % (did, bag))
ck(bag is True and did == 0, '★★ 5 阶高于阈值 → 不卖，进背包', (did, bag))

# ④ 材料永远不卖
mat = {'name': '灵气结晶', 'tier': 1, 'kind': 'material', 'stack': 1}
did, bag = pick(mat, 12)
print('  捡 1 阶材料（阈值 12）: 金币 +%d · 进背包=%s' % (did, bag))
ck(bag is True and did == 0, '★★ 材料不受自动出售影响', (did, bag))

# ⑤ 武器也一样
wq = weapons.make_weapon('sword', 2, 1.0, 5)
did, bag = pick(wq, 5)
print('  捡 3 阶武器（阈值 5）: 金币 +%d · 进背包=%s' % (did, bag))
ck(bag is False and did > 0, '★★ 武器同样会被自动卖', (did, bag))


# ⑥ 落库：设置意图要把 autosell 写进库（重启服务器也不丢）
print('')
print('  -- 落库测试 --')
saves2 = []
w.post_save = lambda sql, params=None: saves2.append((sql, params))
w._send_cid = lambda c, r: None
w._handle_intent(q, 'autosell', {'tier': 7})
rows = [x for x in saves2 if isinstance(x[0], str) and 'autosell' in x[0]]
print('  发出的 SQL: %r' % (rows,))
ck(len(rows) == 1 and 'UPDATE roles SET autosell' in rows[0][0],
   '★★ 设置会被写进数据库', rows)
ck(rows[0][1][0] == 7, '★★ 写的值是 7', rows[0][1])
ck(q.role['autosell'] == 7, '★★ 内存里也是 7', q.role.get('autosell'))

print('')
print('FAILED: %d' % FAILS if FAILS else 'ALL PASS ✓')
sys.exit(1 if FAILS else 0)
