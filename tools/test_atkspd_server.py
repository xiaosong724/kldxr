# -*- coding: utf-8 -*-
"""离线验收：装上带攻速词条的武器后，属性表攻速 = 基础 × (1+词条%)，且标"武器"来源"""
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
w._tal_send = lambda p: None

q = W.Player('cA', {'id': 902, 'name': 'A', 'level': 30, 'hp': 500, 'qi': 0, 'exp': 0})
q.role_id = 902
q.role = {'id': 902, 'name': 'A', 'level': 30, 'exp': 0, 'hp': 500, 'qi': 0}
q.talEff = {}
q.weapon = dict(weapons.FIST)


def sheet():
    return dict((r['k'], r) for r in w._stat_sheet(q))


s0 = sheet()
print('  空手: 攻速 v=%s base=%s bn=%s · 间隔 v=%s' % (
    s0['aspd']['v'], s0['aspd']['base'], s0['aspd'].get('bn'), s0['interval']['v']))
ck(abs(float(s0['aspd']['v']) - 1.15) < 0.01, '★ 空手攻速 ×1.15', s0['aspd']['v'])
ck(abs(float(s0['interval']['v']) - 0.62 / 1.15) < 0.02, '★ 空手间隔 ≈0.54 秒', s0['interval']['v'])
ck(s0['aspd'].get('bn') == '武器', '★ 攻速的基础来源标成「武器」', s0['aspd'].get('bn'))

# 装一把匕首 + 攻速 +40%
q.weapon = {
    'name': '匕首', 'slot': 'weapon', 'look': 'dagger', 'tier': 5, 'itemLv': 1,
    'base': {'coeff': 0.7, 'atkSpeed': round(weapons.speed_of('dagger'), 2),
             'reach': 1.8, 'arc': 1.2},
    'affixes': [{'key': 'spd_pct', 'val': 40.0, 'text': '攻速 +40%'}],
    'dur': 100, 'durMax': 100, 'reqLevel': 1,
}
s1 = sheet()
exp = 1.45 * 1.40
print('  匕首+40%%: v=%s base=%s gear=%s · 间隔=%s' % (
    s1['aspd']['v'], s1['aspd']['base'], s1['aspd']['gear'], s1['interval']['v']))
ck(abs(float(s1['aspd']['v']) - exp) < 0.02, '★★ 攻速 = 1.45 × 1.4 ≈ 2.03（词条算进去了）', s1['aspd']['v'])
ck(float(s1['aspd']['gear']) > 0.3, '★★ 面板会显示词条贡献（装备 +）', s1['aspd']['gear'])
ck(abs(float(s1['interval']['v']) - 0.62 / exp) < 0.02, '★★ 间隔跟着变', s1['interval']['v'])

# 再堆到超过上限：必须停在 2.2
q.weapon['affixes'][0]['val'] = 200.0
s2 = sheet()
print('  +200%%: v=%s · 间隔=%s' % (s2['aspd']['v'], s2['interval']['v']))
ck(abs(float(s2['aspd']['v']) - 2.2) < 0.01, '★★ 封顶 ×2.2', s2['aspd']['v'])
ck(abs(float(s2['interval']['v']) - 0.62 / 2.2) < 0.02, '★★ 最快 0.28 秒一刀', s2['interval']['v'])

print('')
print('FAILED: %d' % FAILS if FAILS else 'ALL PASS ✓')
sys.exit(1 if FAILS else 0)
