# -*- coding: utf-8 -*-
"""精英/Boss 词条（round600）

词条名和玩家装备/天赋同一套语义；数值按怪物等级缩放。
"""
import random

# key, 中文, 基础值, 上限倍率, 是否百分比
SPECS = [
    ('hp_pct', '生命', 8.0, 2.5),
    ('atk_pct', '攻击', 6.0, 2.5),
    ('crit_pt', '暴击', 3.0, 2.0),
    ('crit_dmg', '暴伤', 8.0, 2.5),
    ('lifesteal', '吸血', 2.0, 2.0),
    ('thorns', '荆棘', 4.0, 2.5),
    ('dodge_pt', '闪避', 2.5, 2.0),
    ('hit_pt', '命中', 3.0, 2.0),
    ('pen_pt', '穿透', 2.0, 2.0),
    ('dr_flat', '固定减伤', 3.0, 2.0),
    ('dr_pct', '减伤', 3.0, 2.0),
    ('anticrit', '免爆', 3.0, 2.0),
    ('anticritdmg', '抗爆', 6.0, 2.0),
    ('speed_pct', '迅捷', 2.0, 2.0),
    ('aspd_pct', '攻速', 2.0, 2.0),
    ('regen', '回复', 1.0, 2.5),
    ('control_res', '抗控', 4.0, 2.0),
]

BY_KEY = {k: (n, b, cap) for k, n, b, cap in SPECS}


def roll(rank, lv):
    """返回 {key: value}，不重复；精英 2~3，Boss 4 条。"""
    rank = int(rank or 0)
    if rank <= 0:
        return {}
    n = 2 if rank == 1 else 4
    keys = [s[0] for s in SPECS]
    random.shuffle(keys)
    picked = keys[:n]
    out = {}
    lv = max(1, int(lv or 1))
    scale = 1.0 + lv / 100.0
    for k in picked:
        _n, base, cap = BY_KEY[k]
        v = base * scale
        # 上限：相对基础值的倍数
        v = min(v, base * cap)
        if k in ('hp_pct', 'atk_pct', 'crit_pt', 'crit_dmg', 'lifesteal',
                 'thorns', 'dodge_pt', 'hit_pt', 'pen_pt', 'dr_pct',
                 'anticrit', 'anticritdmg', 'speed_pct', 'aspd_pct',
                 'control_res'):
            v = round(v, 1)
        else:
            v = round(v, 1)
        out[k] = v
    # 硬上限（只约束已经抽到的词条，不凭空添加）
    if 'crit_pt' in out:
        out['crit_pt'] = min(out['crit_pt'], 40.0)
    if 'dodge_pt' in out:
        out['dodge_pt'] = min(out['dodge_pt'], 30.0)
    if 'dr_pct' in out:
        out['dr_pct'] = min(out['dr_pct'], 60.0)
    return out


def tags(aff):
    return [BY_KEY[k][0] for k in aff if k in BY_KEY]


def apply(m, aff):
    """把词条套到 Mob 上；必须在 mhp/atk 初值之后、hp 赋值之前调用。"""
    if not aff:
        return
    m.hp_pct = float(aff.get('hp_pct', 0.0))
    m.atk_pct = float(aff.get('atk_pct', 0.0))
    m.crit_pt = float(aff.get('crit_pt', 0.0))
    m.crit_dmg = float(aff.get('crit_dmg', 0.0))
    m.lifesteal = float(aff.get('lifesteal', 0.0))
    m.thorns = float(aff.get('thorns', 0.0))
    m.dodge_pt = float(aff.get('dodge_pt', 0.0))
    m.hit_pt = float(aff.get('hit_pt', 0.0))
    m.pen_pt = float(aff.get('pen_pt', 0.0))
    m.dr_flat = float(aff.get('dr_flat', 0.0))
    m.dr_pct = float(aff.get('dr_pct', 0.0))
    m.anticrit = float(aff.get('anticrit', 0.0))
    m.anticritdmg = float(aff.get('anticritdmg', 0.0))
    m.speed_pct = float(aff.get('speed_pct', 0.0))
    m.aspd_pct = float(aff.get('aspd_pct', 0.0))
    m.regen = float(aff.get('regen', 0.0))
    m.control_res = float(aff.get('control_res', 0.0))
    m.mhp = max(1, int(round(m.mhp * (1.0 + m.hp_pct / 100.0))))
    m.atk = float(m.atk) * (1.0 + m.atk_pct / 100.0)
    m.spd = float(m.spd) * (1.0 + m.speed_pct / 100.0)
