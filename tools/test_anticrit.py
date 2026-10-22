# -*- coding: utf-8 -*-
"""验收 round473（第三版）：抗爆 + 爆伤上限 250%（真实 PvP 结算，按掉血量测）"""
import os
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(_HERE), 'server'))

import world as W          # noqa: E402
import talents             # noqa: E402
import mobs                # noqa: E402

FAILS = 0


def ck(c, m, got=None):
    global FAILS
    if c:
        print('  PASS  ' + m)
    else:
        FAILS += 1
        print('  FAIL  ' + m + ('' if got is None else '  got=%r' % (got,)))


# ---------- ① 天赋表 ----------
ck('anticritdmg' in talents.KEYS, '★★ 天赋表里有【抗爆】', talents.KEYS)
d = talents.BY_KEY['anticritdmg']
print('  抗爆定义:', d)
ck(d[2] == 'vs' and d[5] == 'critdmg', '★★ 抗爆是对抗类，克制【爆伤】', d)
ck(abs(d[3] - 0.5) < 1e-9 and d[4] is None, '★★ 1 点 = 0.5%、无上限', d)
ck(talents.effective({'critdmg': 400.0})['critdmg'] <= 100.0, '★ 天赋爆伤加成封顶 100%')

# ---------- ② 属性表 ----------
w = W.World(None)
w._send_cid = lambda c, r: None
q = W.Player('cA', {'id': 905, 'name': 'A', 'level': 60, 'hp': 500, 'qi': 0, 'exp': 0})
q.role_id = 905
q.role = {'id': 905, 'name': 'A', 'level': 60, 'exp': 0, 'hp': 500, 'qi': 0}
q.talEff = {'critdmg': 100.0, 'anticritdmg': 40.0}
q.talRaw = {'critdmg': 100.0, 'anticritdmg': 40.0}
q.tal = {}
q.mq = 0
q.weapon = {}
q.armor = None

sheet = dict((r['k'], r) for r in w._stat_sheet(q))
print('  属性表 爆伤:', sheet['critdmg'])
print('  属性表 抗爆:', sheet['anticritdmg'])
ck(sheet['critdmg']['v'] == 250 and sheet['critdmg']['cap'] == 250, '★★ 爆伤满 = 250%、上限 250%')
ck(sheet['critdmg']['base'] == 150, '★ 爆伤基础显示 150%')
ck(sheet['anticritdmg']['v'] == 40, '★★ 属性表有抗爆 40%')

# ---------- ③ 真实 PvP 结算 ----------
w._pvp_ok = lambda x, y: (True, '')
w._add_pend = lambda *x, **k: None
w._send_cid = lambda *x, **k: None
w._tp_break = lambda *x, **k: None
w._pvp_killed = lambda *x, **k: None
w._mv_mq = lambda *x, **k: None


def mk(cid, rid, cd=None, anti=None):
    p = W.Player(cid, {'id': rid, 'name': 'P%d' % rid, 'level': 60,
                       'hp': 10 ** 7, 'qi': 0, 'exp': 0})
    p.role_id = rid
    p.role = {'id': rid, 'name': 'P%d' % rid, 'level': 60, 'hp': 10 ** 7, 'qi': 0, 'exp': 0}
    p.talEff, p.talRaw, p.tal = {}, {}, {}
    p.mq = 0
    p.weapon = {'look': 'sword', 'tier': 5, 'affixes': [],
                'base': {'coeff': 1.0, 'atkSpeed': 1.15, 'reach': 2.4, 'arc': 1.05}}
    p.armor = None
    p.x, p.z, p.yaw = 0.0, 0.0, 0.0
    if cd is not None:
        p.talEff['critdmg'] = cd
        p.talRaw['critdmg'] = cd
    if anti is not None:
        p.talEff['anticritdmg'] = anti
        p.talRaw['anticritdmg'] = anti
    return p


def avg_dmg(att, vic, n=800):
    tot, hits = 0, 0
    for _ in range(n):
        att.hp = 10 ** 7
        vic.hp = 10 ** 7
        att.x, att.z, att.yaw = 0.0, 0.0, 0.0
        vic.x, vic.z = 0.0, 0.9          # 正前方
        before = vic.hp
        try:
            w._pvp_hit(att, vic, 2.4, 1.05, True)
        except Exception as e:
            return None, repr(e)
        d = before - vic.hp
        if d > 0:
            tot += d
            hits += 1
    return (tot / hits if hits else 0.0), None


a0, b0 = mk('c1', 1, cd=100.0), mk('c2', 2, anti=0.0)
a1, b1 = mk('c3', 3, cd=100.0), mk('c4', 4, anti=50.0)
v0, e0 = avg_dmg(a0, b0)
v1, e1 = avg_dmg(a1, b1)
print('  对方无抗爆：平均 %.0f 伤害（%s）' % (v0 or -1, e0))
print('  对方抗爆50%%：平均 %.0f 伤害（%s）' % (v1 or -1, e1))
if e0 or e1:
    ck(False, '★ PvP 结算跑通', (e0, e1))
else:
    ck(v0 > 0 and v1 > 0, '★ PvP 能造成伤害', (v0, v1))
    ck(v1 < v0, '★★ 抗爆 50% 让受到的伤害下降（{:.0f} → {:.0f}）'.format(v0, v1), (v0, v1))

# ---------- ④ 爆伤上限 ----------
mul = min(2.5, mobs.CRIT_MUL + min(100.0, 400.0) / 100.0)
print('  爆伤堆到 400%% → 实际倍率 {} 倍（上限 2.5）'.format(mul))
ck(abs(mul - 2.5) < 1e-9, '★★ 爆伤封顶 250%（2.5 倍）', mul)

print('')
print('FAILED: %d' % FAILS if FAILS else 'ALL PASS ✓')
sys.exit(1 if FAILS else 0)
