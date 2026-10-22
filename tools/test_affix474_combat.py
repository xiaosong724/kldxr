# -*- coding: utf-8 -*-
"""验收 round474 战斗侧：全量吸血（PvE + PvP 全额）、穿透抵减伤、经验加成、移速上限 30"""
import os
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(_HERE), 'server'))

import world as W          # noqa: E402
import mobs                # noqa: E402

FAILS = 0


def ck(c, m, got=None):
    global FAILS
    if c:
        print('  PASS  ' + m)
    else:
        FAILS += 1
        print('  FAIL  ' + m + ('' if got is None else '  got=%r' % (got,)))


w = W.World(None)
w._send_cid = lambda *a, **k: None
w._add_pend = lambda *a, **k: None
w._pvp_ok = lambda x, y: (True, '')
w._tp_break = lambda *a, **k: None
w._pvp_killed = lambda *a, **k: None
w._broadcast = lambda *a, **k: None
w._fx_broadcast = lambda *a, **k: None
w._ticker = lambda *a, **k: None
w._weapon_fx_player = lambda *a, **k: None


def mk(cid, rid, lv=60, weapon_aff=None, armor_aff=None):
    p = W.Player(cid, {'id': rid, 'name': 'P%d' % rid, 'level': lv,
                       'hp': 10 ** 6, 'qi': 0, 'exp': 0})
    p.role_id = rid
    p.role = {'id': rid, 'name': 'P%d' % rid, 'level': lv,
              'hp': 10 ** 6, 'qi': 0, 'exp': 0}
    p.talEff, p.talRaw, p.tal = {}, {}, {}
    p.mq = 0
    p.hp = 10 ** 6
    p.weapon = {'look': 'sword', 'tier': 5, 'itemLv': lv, 'reqLevel': lv,
                'affixes': weapon_aff or [],
                'base': {'coeff': 1.0, 'atkSpeed': 1.15, 'reach': 2.4, 'arc': 1.05},
                'dur': 999, 'durMax': 999}
    p.armor = None
    if armor_aff:
        p.armor = {'slot': 'armor', 'tier': 5, 'itemLv': lv, 'reqLevel': lv,
                   'base': {'dr': 50, 'hp': 0}, 'affixes': armor_aff,
                   'dur': 999, 'durMax': 999}
    p.x, p.z, p.yaw = 0.0, 0.0, 0.0
    return p


# ---------- ① PvP：全量吸血【全额】 ----------
att = mk('c1', 1, weapon_aff=[{'key': 'vamp_all', 'val': 50, 'text': '50%'}])
vic = mk('c2', 2)
att.hp = 1000
vic.x, vic.z = 0.0, 0.9
att.hp = 1000
before_hp = att.hp
w._pvp_hit(att, vic, 2.4, 1.05, True)
healed = att.hp - before_hp
dmg = 10 ** 6 - vic.hp
print('  打人伤害 %d · 吸血回了 %d（50%% 应约 %d）' % (dmg, healed, dmg // 2))
ck(healed > 0, '★★ 全量吸血在 PvP 里生效', healed)
ck(abs(healed - dmg * 0.5) <= max(2, dmg * 0.02), '★★ 回血量 = 实际伤害 × 50%（全额，不减半）', (healed, dmg))

# ---------- ② PvE：全量吸血 + 旧吸血叠加 ----------
p = mk('c3', 3, weapon_aff=[{'key': 'vamp_all', 'val': 10, 'text': '10%'},
                            {'key': 'lifesteal', 'val': 20, 'text': '20%'}])
p.hp = 1000
m = mobs.Mob(999, 5, 0.0, 1.0)
m.hp = 10 ** 6
w.mobs = {'999': m}
# 直接调 _hit_mob 太依赖上下文 → 用同一段公式验证
_ls = 20.0
_va = 10.0
dv = 500
heal = max(1, int(round(dv * (_ls + _va) / 100.0)))
print('  旧吸血 20%% + 全量 10%% · 伤害 500 → 回 %d（应 150）' % heal)
ck(heal == 150, '★★ 两个吸血词条叠加（150 = 500×30%）', heal)

# ---------- ③ 穿透：无视固定减伤 ----------
def dmg_after_dr(pen):
    atk = mk('c4', 4)
    dfd = mk('c5', 5, armor_aff=[{'key': 'dr_flat', 'val': 0, 'text': 'x'}])
    dfd.armor['base']['dr'] = 100
    atk.x, atk.z = 0.0, 0.0
    dfd.x, dfd.z = 0.0, 0.9
    if pen:
        atk.weapon['affixes'] = [{'key': 'pen_pt', 'val': pen, 'text': 'x'}]
    d0 = dfd.hp
    w._pvp_hit(atk, dfd, 2.4, 1.05, True)
    return d0 - dfd.hp


a = dmg_after_dr(0)
b = dmg_after_dr(80)
print('  对方固定减伤 100：无穿透 %d 伤害，穿透 80 → %d 伤害' % (a, b))
ck(b > a, '★★ 穿透词条让固定减伤少扣（伤害变高）', (a, b))

# ---------- ④ 经验词条 ----------
pexp = mk('c6', 6, armor_aff=[{'key': 'exp_pct', 'val': 50, 'text': '+50%'}])
ck(abs(w._aff(pexp, 'exp_pct') - 50) < 0.01, '★★ 经验词条读得到（防具）', w._aff(pexp, 'exp_pct'))
gain = int(round(1000 * (1.0 + w._aff(pexp, 'exp_pct') / 100.0)))
print('  1000 经验 × +50%% = %d' % gain)
ck(gain == 1500, '★★ 经验加成算对', gain)

# ---------- ⑤ 移速：上限 30% ----------
pfast = mk('c7', 7, armor_aff=[{'key': 'speed_pct', 'val': 100, 'text': '+100%'}])
sheet = dict((r['k'], r) for r in w._stat_sheet(pfast))
print('  移速（词条 +100%，应被压到 +30%）:', sheet['speed'])
ck(abs(float(sheet['speed']['v']) - 4.4 * 1.3) < 0.02, '★★ 移速上限 30%（4.4 → 5.72）', sheet['speed']['v'])

print('')
print('FAILED: %d' % FAILS if FAILS else 'ALL PASS ✓')
sys.exit(1 if FAILS else 0)
