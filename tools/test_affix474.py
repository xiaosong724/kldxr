# -*- coding: utf-8 -*-
"""验收 round474：9 条新词条（经验在防具 / 全量吸血 PvP 全额 / 减伤% 与天赋相加封 50 / 移速上限 30）"""
import os
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(_HERE), 'server'))

import world as W          # noqa: E402
import affixes            # noqa: E402
import talents            # noqa: E402

FAILS = 0


def ck(c, m, got=None):
    global FAILS
    if c:
        print('  PASS  ' + m)
    else:
        FAILS += 1
        print('  FAIL  ' + m + ('' if got is None else '  got=%r' % (got,)))


# ---------- ① 词条池 ----------
wpool = [a[0] for a in affixes.AFFIXES if a[6] and 'weapon' in a[5]]
apool = [a[0] for a in affixes.AFFIXES if a[6] and 'armor' in a[5]]
print('  武器池 (%d):' % len(wpool), wpool)
print('  防具池 (%d):' % len(apool), apool)
for k in ('hit_pt', 'pen_pt', 'vamp_all'):
    ck(k in wpool, '★★ 武器池有 ' + k, wpool)
for k in ('anticrit', 'anticritdmg', 'dr_pct', 'qi_flat', 'speed_pct', 'exp_pct'):
    ck(k in apool, '★★ 防具池有 ' + k, apool)
ck('exp_pct' not in wpool, '★★ 经验词条只在防具（用户定的）', wpool)

# ---------- ② 移速上限 30 ----------
ck(abs(float(talents.BY_KEY['speed'][4]) - 30.0) < 1e-9,
   '★★ 移速天赋上限 = 30%（砍一半）', talents.BY_KEY['speed'])

# ---------- ③ 属性表 ----------
w = W.World(None)
w._send_cid = lambda c, r: None
w._tal_send = lambda p: None

q = W.Player('cA', {'id': 906, 'name': 'A', 'level': 60, 'hp': 500, 'qi': 0, 'exp': 0})
q.role_id = 906
q.role = {'id': 906, 'name': 'A', 'level': 60, 'exp': 0, 'hp': 500, 'qi': 0}
q.talEff = {}
q.talRaw = {}
q.tal = {}
q.mq = 0
q.weapon = {'slot': 'weapon', 'look': 'sword', 'tier': 8, 'itemLv': 60, 'reqLevel': 60,
            'base': {'coeff': 1.0, 'atkSpeed': 1.15, 'reach': 2.4, 'arc': 1.05},
            'dur': 100, 'durMax': 100,
            'affixes': [{'key': 'hit_pt', 'val': 10, 'text': '命中 +10%'},
                        {'key': 'pen_pt', 'val': 12, 'text': '无视 12 点减伤'},
                        {'key': 'vamp_all', 'val': 5, 'text': '造成伤害的 5% 回血'}]}
q.armor = {'slot': 'armor', 'tier': 8, 'itemLv': 60, 'reqLevel': 60,
           'base': {'dr': 20, 'hp': 400}, 'dur': 100, 'durMax': 100,
           'affixes': [{'key': 'anticrit', 'val': 8, 'text': '免爆 +8%'},
                       {'key': 'anticritdmg', 'val': 10, 'text': '抗爆 +10%'},
                       {'key': 'dr_pct', 'val': 6, 'text': '减伤 +6%'},
                       {'key': 'qi_flat', 'val': 20, 'text': '灵气上限 +20 点'},
                       {'key': 'speed_pct', 'val': 5, 'text': '移速 +5%'},
                       {'key': 'exp_pct', 'val': 12, 'text': '经验 +12%'}]}

sheet = dict((r['k'], r) for r in w._stat_sheet(q))
for k in ('hit', 'pen', 'vamp_all', 'anticrit', 'anticritdmg', 'dr', 'qi', 'speed', 'exp_pct'):
    print('  %-12s %s' % (k, sheet.get(k)))
ck(sheet['hit']['v'] == 10, '★★ 命中词条进属性表', sheet['hit'])
ck(sheet['vamp_all']['v'] == 5, '★★ 全量吸血进属性表', sheet['vamp_all'])
ck(sheet['exp_pct']['v'] == 12, '★★ 经验词条进属性表', sheet['exp_pct'])
ck(sheet['anticritdmg']['v'] == 10 and sheet['anticrit']['v'] == 8, '★★ 抗爆/免爆进属性表')
ck(abs(float(sheet['dr']['v']) - 6.0) < 0.01, '★★ 减伤% 进属性表（天赋 0 + 词条 6）', sheet['dr'])
qi_base = int(q.role.get('qiMax') or 100)
ck(sheet['qi']['v'] == qi_base + 20, '★★ 灵气上限吃到 +20 词条', sheet['qi'])

# 移速：5% → 4.4 × 1.05
print('  移速行:', sheet['speed'])
ck(abs(float(sheet['speed']['v']) - 4.62) < 0.02, '★★ 移速词条生效（4.4×1.05=4.62）', sheet['speed'])

# ---------- ④ 减伤% + 天赋合计封 50 ----------
q.talEff = {'dr': 45.0}
q.talRaw = {'dr': 45.0}
sheet2 = dict((r['k'], r) for r in w._stat_sheet(q))
print('  减伤（天赋45 + 词条6）:', sheet2['dr'])
ck(sheet2['dr']['v'] == 50, '★★ 天赋 45 + 词条 6 → 封顶 50', sheet2['dr'])

# ---------- ⑤ 偷/吸血、经验倍率 ----------
ck(abs(w._aff(q, 'exp_pct') - 12) < 0.01, '★★ _aff 能读到防具经验词条', w._aff(q, 'exp_pct'))
ck(abs(w._aff(q, 'vamp_all') - 5) < 0.01, '★★ _aff 能读到武器全量吸血', w._aff(q, 'vamp_all'))
# 破装备不算
q.armor = dict(q.armor)
q.armor['broken'] = True
ck(abs(w._aff(q, 'exp_pct')) < 0.01, '★ 坏掉的防具不提供词条', w._aff(q, 'exp_pct'))

print('')
print('FAILED: %d' % FAILS if FAILS else 'ALL PASS ✓')
sys.exit(1 if FAILS else 0)
