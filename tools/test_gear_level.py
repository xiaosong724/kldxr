# -*- coding: utf-8 -*-
"""验收 round472：装备等级 = 建议等级（无上限）+ 发挥度按等级差惩罚

① 掉落装备的 itemLv = 击杀者等级（不再 ÷4），reqLevel = itemLv
② 基础属性随 itemLv 涨（6%/级，线性）
③ 发挥度：等级差越大越低（下限 2%）
④ 1 级拿 1000 级装备 → 攻击/血量基本用不了（不能变无敌）
"""
import os
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(_HERE), 'server'))

import world as W          # noqa: E402
import weapons             # noqa: E402
import armor as armormod   # noqa: E402
import mobs                # noqa: E402

FAILS = 0


def ck(c, m, got=None):
    global FAILS
    if c:
        print('  PASS  ' + m)
    else:
        FAILS += 1
        print('  FAIL  ' + m + ('' if got is None else '  got=%r' % (got,)))


# ---------- ① 掉的装备等级 = 你的等级 ----------
for lv in (5, 30, 100, 500):
    w = weapons.roll_weapon(lv, lv)
    ok = (w['itemLv'] == lv and w['reqLevel'] == lv)
    print('  %d 级玩家打 %d 级怪 → %s（tier %d · itemLv %d · 建议 %d）' % (
        lv, lv, w['name'], w['tier'], w['itemLv'], w['reqLevel']))
    ck(ok, '★★ %d 级掉的装备：等级 = 建议等级 = %d（无上限）' % (lv, lv), (w['itemLv'], w['reqLevel']))

a = armormod.make_armor(5, 200)
ck(a['itemLv'] == 200 and a['reqLevel'] == 200, '★★ 防具同理（200 级装备）', (a['itemLv'], a['reqLevel']))

# ---------- ② 基础属性随等级涨 ----------
f1 = weapons.flat_of(5, 1)
f100 = weapons.flat_of(5, 100)
f1000 = weapons.flat_of(5, 1000)
print('  5 阶平伤：lv1 %.0f · lv100 %.0f · lv1000 %.0f' % (f1, f100, f1000))
ck(f100 > f1 * 5 and f1000 > f100 * 5, '★★ 基础伤害随装备等级线性涨（6%/级）', (f1, f100, f1000))

d1 = armormod.stats_of(armormod.make_armor(5, 1), 1.0)['dr']
d100 = armormod.stats_of(armormod.make_armor(5, 100), 1.0)['dr']
ck(d100 > d1 * 5, '★★ 防具减伤也随等级涨', (d1, d100))

# ---------- ③ 发挥度按等级差衰减 ----------
print('  发挥度（建议 100 级）：', {g: round(weapons.mastery_for_gap(100, 100 - g), 3)
                                    for g in (0, 1, 5, 10, 50, 100, 500, 999)})
ck(weapons.mastery_for_gap(100, 100) == 1.0, '★ 等级够 = 100%')
ck(abs(weapons.mastery_for_gap(100, 90) - 0.5) < 0.01, '★★ 差 10 级 = 50%', weapons.mastery_for_gap(100, 90))
ck(weapons.mastery_for_gap(1000, 1) <= 0.02, '★★ 差 999 级只剩 2%（地板）', weapons.mastery_for_gap(1000, 1))

# ---------- ④ 1 级玩家拿 1000 级装备：不能变无敌 ----------
w = W.World(None)
w._send_cid = lambda c, r: None
w._tal_send = lambda p: None

q = W.Player('cA', {'id': 904, 'name': 'A', 'level': 1, 'hp': 100, 'qi': 0, 'exp': 0})
q.role_id = 904
q.role = {'id': 904, 'name': 'A', 'level': 1, 'exp': 0, 'hp': 100, 'qi': 0}
q.talEff = {}
q.talRaw = {}
q.tal = {}
q.mq = 0
q.weapon = dict(weapons.FIST)
q.armor = None

atk_naked = w._atk_of(q)
hp_naked = w._hp_max(q)
print('  1 级空手：攻击 %.1f · 血 %d' % (atk_naked, hp_naked))

q.weapon = weapons.make_weapon('sword', 11, 1.1, 1000)
atk_big = w._atk_of(q)
print('  1 级拿 1000 级 12 阶剑：攻击 %.1f（%.1f 倍）' % (atk_big, atk_big / atk_naked))
ck(atk_big <= atk_naked * 3.2, '★★ 攻击被封顶（≤ 固有×3.16），不会秒天秒地', atk_big)

q.armor = armormod.make_armor(11, 1000)
hp_big = w._hp_max(q)
print('  再穿 1000 级 12 阶防具：血 %d（%.1f 倍）' % (hp_big, hp_big / hp_naked))
ck(hp_big <= hp_naked * 1.2, '★★ 血量只多一点点（发挥度 2%）', hp_big)

st = armormod.stats_of(q.armor, weapons.mastery_of(q.armor, 1), level=1)
print('  实际拿到的减伤 = %.2f 点（满发挥 %.0f）' % (st['dr'], armormod.stats_of(q.armor, 1.0, level=1000)['dr']))
ck(st['dr'] < 5, '★★ 减伤几乎无效（不然就无敌了）', st['dr'])

# ---------- ⑤ 同等级拿同等级装备：满发挥 ----------
q.role['level'] = 1000
atk_ok = w._atk_of(q)
hp_ok = w._hp_max(q)
print('  1000 级拿 1000 级装备：攻击 %.0f · 血 %d' % (atk_ok, hp_ok))
ck(atk_ok > atk_big * 5, '★★ 等级够了才有真本事（攻击暴涨）', (atk_big, atk_ok))

print('')
print('FAILED: %d' % FAILS if FAILS else 'ALL PASS ✓')
sys.exit(1 if FAILS else 0)
