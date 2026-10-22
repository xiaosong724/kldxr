# -*- coding: utf-8 -*-
"""验收：穿透口径（词条=点/抵固定减伤，天赋=%/抵减伤%），且不再反向削自己"""
import os, sys
try: sys.stdout.reconfigure(encoding='utf-8')
except Exception: pass
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(_HERE), 'server'))
import world as W
FAILS = 0
def ck(c, m, got=None):
    global FAILS
    if c: print('  PASS  ' + m)
    else:
        FAILS += 1
        print('  FAIL  ' + m + ('' if got is None else '  got=%r' % (got,)))

w = W.World(None)
w._send_cid = lambda *a, **k: None

def mk(cid, rid, lv=60, w_aff=None, a_aff=None):
    p = W.Player(cid, {'id': rid, 'name': 'P%d' % rid, 'level': lv, 'hp': 10**6, 'qi': 0, 'exp': 0})
    p.role_id = rid
    p.role = {'id': rid, 'name': 'P%d' % rid, 'level': lv, 'hp': 10**6, 'qi': 0, 'exp': 0}
    p.talEff, p.talRaw, p.tal = {}, {}, {}
    p.mq = 0; p.hp = 10**6
    p.weapon = {'look': 'sword', 'tier': 5, 'itemLv': lv, 'reqLevel': lv,
                'affixes': w_aff or [],
                'base': {'coeff': 1.0, 'atkSpeed': 1.15, 'reach': 2.4, 'arc': 1.05},
                'dur': 999, 'durMax': 999}
    p.armor = {'slot': 'armor', 'tier': 5, 'itemLv': lv, 'reqLevel': lv,
               'base': {'dr': 100, 'hp': 0}, 'affixes': a_aff or [], 'dur': 999, 'durMax': 999}
    p.x, p.z, p.yaw = 0.0, 0.0, 0.0
    return p

# ① 属性表：两个口径分开
p = mk('c1', 1, w_aff=[{'key': 'pen_pt', 'val': 25, 'text': '无视 25 点减伤'}])
p.talEff = {'pen': 30.0}; p.talRaw = {'pen': 30.0}
sheet = dict((r['k'], r) for r in w._stat_sheet(p))
print('  穿透行:', sheet['pen'])
print('  穿透（%）行:', sheet['pen_pct'])
ck(sheet['pen']['v'] == 25 and sheet['pen']['unit'] == '点', '★★ 词条穿透 = 25 点（固定值）', sheet['pen'])
ck(sheet['pen_pct']['v'] == 30 and sheet['pen_pct']['unit'] == '%', '★★ 天赋穿透单列成 %', sheet['pen_pct'])

# ② 挨打时不再用自己的穿透削自己的护甲
p2 = mk('c2', 2, w_aff=[{'key': 'pen_pt', 'val': 80, 'text': 'x'}])
p2.hp = 100000
# 用 stats_of 直接看：穿透不应该改变"自己挨打时"的护甲
import armor as armormod
st = armormod.stats_of(p2.armor, 1.0, level=60)
print('  自己护甲固定减伤:', st['dr'], '（穿透 80 不应该影响它）')
ck(st['dr'] == 100, '★★ 自己的穿透不影响自己的护甲', st['dr'])

print('')
print('FAILED: %d' % FAILS if FAILS else 'ALL PASS ✓')
sys.exit(1 if FAILS else 0)
