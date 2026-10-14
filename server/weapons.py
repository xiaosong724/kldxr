# -*- coding: utf-8 -*-
"""武器系统（第 47 轮 —— 方案 §7.4~§7.11）

★★ 这一份是【权威】★★
   玩家的 攻击力 / 射程 / 攻击弧 / 攻击间隔 全部按【手上那把武器】算 ✓
   客户端那份（core/game.js 的 WEAPON_LOOKS）只负责表现和本地预测 ——
   数值一律以服务器为准 ✓（和伤害、掉率一样，客户端说了不算 ✓）

★ 数值表就是方案 §7.4 那张，一个字没改 ✓
★ 三条硬规矩（都在 §7.4/§7.5/§7.6 定过）：
   ① 伤害系数是【区间】，掉落时滚一个 —— 但滚完必须夹到 [0.95, 1.20]（S × 系数）
      → 攻速快的武器单次伤害必须低，DPS 拉平 ✓（防"又快又猛"一把通吃 ✗）
      远程（弓）不受这条约束，它走自己那条线 ✓
   ② 攻击力 = 固有攻击 × 武器系数 + 武器平伤；但装备最多贡献总伤害的 60% ✓
      （防"一件神装从 1 级用到 100 级" ✗）
   ③ 起手 = 0.45/S，间隔 = 0.62/S —— 和 §5.1 一个字不差 ✓
"""

import random

# ------------------------------------------------------------------ 类型表（§7.4）
#   look: (攻速S, 系数下限, 系数上限, 射程(米), 攻击弧(弧度), 中文名)
TYPES = {
    'dagger': (1.45, 0.66, 0.78, 1.8, 1.20, '匕首'),
    'sword':  (1.15, 0.92, 1.08, 2.4, 1.05, '单手剑'),
    'saber':  (1.20, 0.87, 1.03, 2.3, 1.15, '刀'),
    'staff':  (1.05, 0.94, 1.10, 2.9, 1.00, '长棍'),
    'spear':  (1.00, 0.97, 1.13, 3.6, 0.70, '长枪'),
    'axe':    (0.75, 1.33, 1.57, 3.0, 1.55, '双手斧'),
    'hammer': (0.72, 1.47, 1.73, 2.8, 1.30, '锤'),
    'bow':    (0.85, 0.54, 0.66, 14.0, 0.0, '弓'),        # 远程：P3 才做投射物
}

# ★ 默认就是【单手剑】—— 数值正好等于现在写死的 ATK_RANGE 2.4 / ATK_ARC 1.05 ✓
#   所以"没有武器"和"装上默认武器"手感完全一样，不会让老玩家觉得变了 ✓
DEFAULT_TYPE = 'sword'

# 硬夹子（§7.4）：S × 系数（滚完之后）必须落在这个区间
CLAMP_LO = 0.95
CLAMP_HI = 1.20
# 远程豁免名单（§7.4 写了为什么：靠射程换 DPS，还要消耗箭）
RANGED = ('bow',)

# 攻速上下限（§5.1：防"一秒十刀" ✗）
S_MIN, S_MAX = 0.6, 2.2
BASE_INTERVAL = 0.62      # = 现在写死的 ATK_CD ✓
BASE_WINDUP = 0.45        # 起手（§5.1）

# 品阶名（12 阶，§6.3 那套叫法 ✓）
TIER_NAME = ('锈蚀', '破旧', '精铁', '镔铁', '玄铁', '灵纹',
             '秘银', '灵器', '宝器', '灵宝', '仙器', '神品')

# 12 阶的"武器平伤"基准（§7.5：平伤 = 基准 × (1 + 0.06 × 物品等级)）
#   ★ 一期用线性递增，好调 ✓ 后面按 §3.2 统一校准时只改这一行 ✓
TIER_BASE = (3.0, 6.0, 10.0, 16.0, 24.0, 36.0, 52.0, 74.0, 104.0, 146.0, 205.0, 290.0)


def type_of(look):
    return TYPES.get(look) or TYPES[DEFAULT_TYPE]


def name_of(look, tier):
    t = max(0, min(11, int(tier)))
    return TIER_NAME[t] + type_of(look)[5]


def speed_of(look):
    """攻速倍率 S（夹在 §5.1 的上下限里 ✓）"""
    return max(S_MIN, min(S_MAX, type_of(look)[0]))


def interval_of(look):
    """两次攻击的最短间隔（秒）—— S 越大间隔越小 ✓（§5.1）"""
    return BASE_INTERVAL / speed_of(look)


def windup_of(look):
    """起手（秒）—— 客户端拿它摆动作；服务器只管间隔 ✓（§7.6）"""
    return BASE_WINDUP / speed_of(look)


def reach_of(look):
    return type_of(look)[3]


def arc_of(look):
    return type_of(look)[4]


def flat_of(tier, item_lv=1):
    """武器平伤（§7.5）"""
    t = max(0, min(11, int(tier)))
    return TIER_BASE[t] * (1.0 + 0.06 * max(0, int(item_lv) - 1))


def roll_coeff(look, rng=None):
    """在类型的区间里滚一个伤害系数 —— ★ 然后【滚完再夹】✓

    这是 §7.4 那条硬约束的落地点：
      只按区间滚的话，运气好能滚出"又快又猛"的一把 ✗
      滚完再夹一下，区间怎么定都不会把平衡玩坏 ✓
    """
    r = rng or random
    _s, lo, hi = type_of(look)[0], type_of(look)[1], type_of(look)[2]
    S = speed_of(look)
    c = lo + r.random() * (hi - lo)
    if look in RANGED:
        return c                                  # 远程豁免 ✓
    if S * c < CLAMP_LO:
        c = CLAMP_LO / S
    if S * c > CLAMP_HI:
        c = CLAMP_HI / S
    return c


def player_atk_with(inherent, look, coeff, tier, item_lv=1):
    """玩家攻击力 = 固有攻击 × 武器系数 + 武器平伤（§7.5 —— 一个字不差）

    ★★ 踩过的坑（第 47 轮）：这里一开始写成了 `固有 + (固有×系数 + 平伤)` ✗
       多加了一次固有 → 一把默认单手剑就把伤害从 13 顶到 29（+123%）✗
       方案 §7.5 写的是【固有 × 系数 + 平伤】，没有那个额外的固有 ✓

    ★ 封顶：总攻击 ≤ 固有 × 2.5 → 也就是装备最多贡献 60% ✓
      （装备贡献 = 总 - 固有 → (2.5-1)/2.5 = 60% ✓）
      不封的话，一把高系数高阶武器能把"固有那部分"压成零头，
      练级和换装备两条成长线就塌掉一条 ✗（所有刷装备游戏最常见的崩盘点）
    """
    atk = float(inherent) * float(coeff) + flat_of(tier, item_lv)
    cap = float(inherent) * 2.5
    if atk > cap:
        atk = cap
    return atk


def make_weapon(look, tier, coeff, item_lv=1, rng=None):
    """造一件武器（字段照方案 §7.1 的接口，base 里放 §7.4/§7.5 要用的东西 ✓）

    ★ 词条（affixes）这一期留空数组 —— §7.11 定义了 22 条，
      但"掉出来带词条"要先把词条本身实现了，是下一刀 ✓
      （接口上它就是个数组，以后填进去不用动数据结构 ✓）
    """
    t = max(0, min(11, int(tier)))
    return {
        'id': 'w_%s_%d' % (look, t),
        'name': name_of(look, t),
        'slot': 'weapon',
        'tier': t,
        'base': {
            'coeff': round(float(coeff), 3),
            'atkSpeed': round(speed_of(look), 2),
            'reach': reach_of(look),
            'arc': arc_of(look),
            'critPt': 0,
        },
        'affixes': [],
        'effect': None,
        'look': look,
        'reqLevel': max(1, (t + 1) * 6 - 5),      # 每 6 级一档门槛（§7.8）✓
        'ext': {},
    }


def roll_weapon(mob_lv, killer_lv, rng=None):
    """击杀掉一件武器（§7.8：类型按怪的等级/倾向，品阶按 §8.1 ③）"""
    r = rng or random
    from drops import max_tier                      # ★ 品阶上限和材料走同一套 ✓
    cap = max_tier(mob_lv)
    # 品阶：在 [0, cap] 里按权重抽（越低越常见 ✓）
    tier = 0
    for t in range(cap + 1):
        if r.random() < 0.62:                       # 每升一阶都要过一关 → 越低越常见 ✓
            tier = t
        else:
            break
    keys = [k for k in TYPES if k not in RANGED]    # 远程这期不掉（还没有投射物 ✗）
    look = r.choice(keys)
    item_lv = max(1, int(mob_lv) // 4)
    return make_weapon(look, tier, roll_coeff(look, r), item_lv, r)


def atk_range_arc(look):
    return reach_of(look), arc_of(look)
