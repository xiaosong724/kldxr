# -*- coding: utf-8 -*-
"""PvE 属性对抗（round600）

只放纯函数；世界层负责读玩家天赋/词条。
"""

DMG_FLOOR = 0.30


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def dodge_chance(defender_dodge, attacker_hit, cap):
    """防守方闪避 − 攻击方命中，最低 0。"""
    return clamp(float(defender_dodge or 0.0) - float(attacker_hit or 0.0), 0.0, float(cap or 0.0))


def effective_dr(dr_pct, pen_pt):
    return max(0.0, float(dr_pct or 0.0) - float(pen_pt or 0.0))


def mitigate(raw, dr_pct, dr_flat=0.0):
    """先百分比，再固定值，最后 30% 地板。"""
    v = float(raw or 0.0)
    v *= (1.0 - clamp(float(dr_pct or 0.0), 0.0, 100.0) / 100.0)
    v -= max(0.0, float(dr_flat or 0.0))
    v = max(float(raw or 0.0) * DMG_FLOOR, v)
    return max(1, int(round(v)))


def crit_chance(crit_pt, anticrit):
    return clamp(float(crit_pt or 0.0) - float(anticrit or 0.0), 0.0, 100.0)


def crit_mul(crit_dmg, anticritdmg):
    # 暴击基础 1.5 倍，额外暴伤按百分比加，抗爆先减
    extra = max(0.0, float(crit_dmg or 0.0) - float(anticritdmg or 0.0))
    return min(2.5, 1.5 + extra / 100.0)


def hit_mob(raw, m, hit_pt, pen_pt, crit_pt, crit_dmg):
    """玩家打怪。返回 (dmg, crit, dodged)。"""
    import random
    if random.random() * 100.0 < dodge_chance(m.dodge_pt, hit_pt, 50.0):
        return 0, False, True
    dr = effective_dr(m.dr_pct, pen_pt)
    dmg = mitigate(raw, dr, m.dr_flat)
    cp = crit_chance(crit_pt, m.anticrit)
    crit = random.random() * 100.0 < cp
    if crit:
        dmg = max(1, int(round(dmg * crit_mul(crit_dmg, m.anticritdmg))))
    return dmg, crit, False


def hit_player(raw, m, p_dodge, p_dr_pct, p_dr_flat, p_anticrit, p_anticritdmg,
               can_dodge=True):
    """怪打玩家。返回 (dmg, crit, dodged)。"""
    import random
    if can_dodge and random.random() * 100.0 < dodge_chance(p_dodge, m.hit_pt, 80.0):
        return 0, False, True
    dr = effective_dr(p_dr_pct, m.pen_pt)
    dmg = mitigate(raw, dr, p_dr_flat)
    cp = crit_chance(m.crit_pt, p_anticrit)
    crit = random.random() * 100.0 < cp
    if crit:
        dmg = max(1, int(round(dmg * crit_mul(m.crit_dmg, p_anticritdmg))))
    return dmg, crit, False
