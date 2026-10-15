# -*- coding: utf-8 -*-
"""防具（第 67 轮）

【为什么最小可用】：先把"能穿、能掉、属性真生效、词条能出"这条链路打通 ✓
  炫技的东西（多部位/套装）以后再加 ✓
"""

import random

import affixes

# 12 档的品阶名（和武器共用一套说法 ✓ 玩家好理解）
TIER_NAME = ('锈蚀', '破旧', '精铁', '镔铁', '玄铁', '灵纹',
             '秘银', '灵器', '宝器', '灵宝', '仙器', '神品')

# 按品阶的基础属性：减伤（固定值）+ 生命上限
DR_BASE = (1, 2, 3, 5, 7, 10, 14, 19, 25, 33, 42, 54)
HP_BASE = (10, 18, 30, 48, 72, 105, 150, 210, 290, 395, 530, 700)

# 名字（按品阶滚动换词 ✓ 看着像回事）
# ★★ 第 96 轮：名字改清楚（用户把"秘银布衣"当成材料了 ✗）
#   原来第一档叫"布衣"✗ —— "布"字让人以为是布料/材料 ✓
#   现在全部用【甲 / 铠 / 袍】结尾 ✓ 一眼就是防具 ✓
#   （已发出的老防具名字不变 ✓ 它们功能完全正常 ✓ 只是名字看着像材料 ✓）
KINDS = ('软甲', '皮甲', '锁子甲', '重铠', '灵袍')


def dr_of(tier):
    return DR_BASE[max(0, min(11, int(tier)))]


def hp_of(tier):
    return HP_BASE[max(0, min(11, int(tier)))]


def req_level_of(tier):
    """建议等级（和武器一个曲线 ✓ 玩家不用记两套）"""
    return max(1, int(tier) * 3 + 1)


def dur_max_of(tier):
    """耐久上限：防具比武器经用（被打的次数比挥刀少 ✓）→ 给 1.4 倍"""
    import weapons
    return int(weapons.dur_max_of(tier) * 1.4)


def make_armor(tier, item_lv=1, rng=None):
    """造一件防具（词条按 armor 部位抽 ✓ 品阶只抬上限 ✓）"""
    r = rng or random
    t = max(0, min(11, int(tier)))
    kind = r.choice(KINDS)
    return {
        'slot': 'armor',
        'look': 'armor',
        'tier': t,
        'itemLv': int(item_lv),
        'name': TIER_NAME[t] + kind,
        'base': {'dr': dr_of(t) * (1 + 0.06 * (item_lv - 1)),
                 'hp': int(hp_of(t) * (1 + 0.06 * (item_lv - 1)))},
        'affixes': affixes.roll_affixes(t, ('armor',), r),
        'effect': None,
        'reqLevel': req_level_of(t),
        # ★ 防具这一版【不做耐久】（第 67 轮）——
        #   武器耐久是用户点名要的 ✓ 防具先不做，就不显示一条永远不掉的条子 ✗
        'dur': 0, 'durMax': 0,
        'fx': None,
    }


def stats_of(w):
    """一件防具最终提供的属性（基础 + 词条 ✓）

    返回 {dr, hp, hp_pct, dodge, qi_hurt, qi_kill}
    """
    w = w or {}
    b = w.get('base') or {}
    T = affixes.totals(w.get('affixes'))
    return {
        'dr': float(b.get('dr') or 0) + T.get('dr_flat', 0.0),
        'hp': float(b.get('hp') or 0) + T.get('hp_flat', 0.0),
        'hp_pct': T.get('hp_pct', 0.0),
        'dodge': T.get('dodge_pt', 0.0),
        'qi_hurt': T.get('qi_on_hurt', 0.0),
        'qi_kill': T.get('qi_on_kill', 0.0),
    }
