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

import affixes

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
S_MIN, S_MAX = 0.6, 4.4   # 2026-10-23: 攻速上限 2.2 -> 4.4
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


def interval_of(look, spd_pct=0.0):
    """两次攻击的最短间隔（秒）—— S 越大间隔越小 ✓（§5.1）

    ★ 第 60 轮：吃【攻速词条】—— S = 基础 S × (1+攻速%)，再夹回上下限 ✓（§7.11③③）
      —— 攻速词条不能突破 §5.1 那条"防一秒十刀"的线 ✓
    """
    S = speed_of(look) * (1.0 + float(spd_pct or 0.0) / 100.0)
    S = max(S_MIN, min(S_MAX, S))
    return BASE_INTERVAL / S


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


# ---------------------------------------------------------------- 等级发挥度（第 53 轮）
# ★★ 第 60 轮：下限 0.40 → 0.90 ★★
#   为什么：0.40 会让【高阶反而不如低阶】✗
#     实测 Lv.1 匕首：0 阶 12.4 → 1 阶 8.5 ✗（越高级越弱 ✗）
#     因为 0 阶要 1 级（100% 发挥），1 阶要 4 级（只有 55% 发挥）✗
#   用户要求："高阶一定比低阶好，只是不用好太多" ✓
#   → 下限提到 0.90：只是"没练熟"，不再反过来惩罚高阶 ✓
#   （"等级不够发挥不出来"改由【封顶】来表达 ✓ 见 player_atk_with）
# ★★★ round472（用户："等级不适配要按差距降低发挥度，
#   不然玩家 1 级拿 1000 级装备就太强了"）★★★
#   旧：FLOOR=0.90 ✗ 差 999 级也只打 9 折 ✗✗（等于没惩罚）
#   新：发挥度 = 1 / (1 + 等级差 / 10) ，下限 0.02 ✓
#     差 1 级 0.91 · 差 10 级 0.50 · 差 50 级 0.17 · 差 1000 级 0.01→地板 0.02 ✓
MASTERY_FLOOR = 0.02
MASTERY_K = 10.0


def req_level_of(tier):
    """建议等级（第 56 轮：改成平缓曲线）

    ★ 原来是 (阶+1)×6-5 → 4 阶要 25 级、11 阶要 65 级 ✗
      用户反馈"25 级才能发挥全部也不太合理" ✓ —— 那确实太陡
      现在 阶×3+1 → 4 阶只要 13 级、11 阶 34 级 ✓
    ★ 曲线是设计值 —— 以后要调，只改这一行 ✓ 调用点一处都不用动 ✓
    """
    return max(1, int(tier) * 3 + 1)


def mastery_for_gap(req, lv):
    """按【等级差】算发挥度（0.02 ~ 1.0）—— 武器和防具共用 ✓

    ★ 用差值而不用比值 ✗：比值在低等级时太狠（差 3 级就耍不动）✗
      差值剖面：差 1→0.91 · 3→0.77 · 5→0.67 · 10→0.50 · 30→0.25 · 100→0.09 ✓
    """
    req = int(req or 1)
    lv = int(lv or 1)
    if req <= 1 or lv >= req:
        return 1.0
    gap = float(req - lv)
    return max(MASTERY_FLOOR, min(1.0, 1.0 / (1.0 + gap / MASTERY_K)))


def mastery_of(w, level):
    """这件装备在这个等级手里能发挥多少 ✓（武器/防具通用）"""
    return mastery_for_gap((w or {}).get('reqLevel') or 1, level)


def player_atk_with(inherent, look, coeff, tier, item_lv=1, mastery=1.0, flat=None,
                    aff_w=None):
    """玩家攻击力 = 固有攻击 × 武器系数 + 武器平伤（§7.5 —— 一个字不差）

    ★★ 踩过的坑（第 47 轮）：这里一开始写成了 `固有 + (固有×系数 + 平伤)` ✗
       多加了一次固有 → 一把默认单手剑就把伤害从 13 顶到 29（+123%）✗
       方案 §7.5 写的是【固有 × 系数 + 平伤】，没有那个额外的固有 ✓

    ★ 封顶：总攻击 ≤ 固有 × 2.5 → 也就是装备最多贡献 60% ✓
      （装备贡献 = 总 - 固有 → (2.5-1)/2.5 = 60% ✓）
      不封的话，一把高系数高阶武器能把"固有那部分"压成零头，
      练级和换装备两条成长线就塌掉一条 ✗（所有刷装备游戏最常见的崩盘点）
    """
    # ★ 第 58 轮：flat 可以显式传（空手要传 0 ✓）
    #   以前这里写死 flat_of(tier, item_lv) → 空手的 flat0 标记会被绕过 ✗
    _flat = flat_of(tier, item_lv) if flat is None else float(flat)
    # ★★ 第 65 轮：平伤也按攻速缩放（除 S）★★
    #   为什么：§7.4 那条夹子（S × 系数 ∈ [0.95,1.20]）只管住了【系数】✓
    #   而"平伤"不随攻速变 ✗ → 高阶时平伤占 59%，把系数淹了 ✗
    #     实测 12 阶：匕首每秒伤害 1416 vs 锤 803（差 75% ✗✗ 锤完全没人用）
    #   除以 S 之后（和系数一个待遇 ✓）→ 离散度 75% → 3% ✓
    #   基准是 S=1.0（长枪那种中速）→ 快的武器少拿平伤、慢的多拿 ✓
    if look not in RANGED:          # 弓不走这条路（远程另有平衡 ✓）
        _su = max(S_MIN, min(S_MAX, speed_of(look)))
        _flat = _flat / _su
    base = float(inherent) * float(coeff) + _flat
    # ★★ 第 60 轮：词条在【发挥度和封顶之前】生效 ✓（§7.11③ 的顺序 ✓）
    if aff_w is not None:
        base = affixes.apply_affixes(aff_w, inherent, base)
    # ★ 第 53 轮：等级不够 → 武器那一份打折（§7.5 的封顶照样在后面生效 ✓）
    atk = base * max(0.0, min(1.0, float(mastery)))
    # ★★ 第 60 轮：封顶从固定 ×2.5 改成【跟着品阶抬】★★
    #   原来所有品阶都撞同一个天花板 → 高阶被压平成一样高 ✗
    #   实测：Lv.1 时 7~11 阶全是 32.7 ✗（高阶不比低阶好 ✗）
    #   现在 ×(2.5 + 0.06×阶) → 12 阶封顶 ×3.16 ✓
    #   ★ 代价：§7.5 那句"装备最多贡献 60%"变成 60%~68%（随品阶浮动）
    #     严格 60% 就必然压平高阶 ✗ 两个要求不可兼得，按用户要求选"高阶一定更好" ✓
    cap = float(inherent) * (2.5 + 0.06 * max(0, min(11, int(tier))))
    if atk > cap:
        atk = cap
    return atk


def full_atk(inherent, w):
    """这件武器在这个固有攻击下【满发挥】能到多少（不打折、不封顶 ✓）
       给 UI 用："你现在只能发挥出它的 X%" ✓"""
    b = (w or {}).get('base') or {}
    return float(inherent) * float(b.get('coeff') or 1.0) + flat_full(w)


WEAPON_REF = 100.0     # 系数折算基准：纯比较用，和玩家等级无关 ✓


"""★ 第 58 轮：【空手】—— 脱下武器之后的兜底

   以前兜底用的是【0 阶单手剑】（系数 1.00 + 平伤 3）✗
   而系数 1.00 正好是全部武器系数的中值（0.66~1.73）
   → 结果"一半以上的武器，装上不如不装"✗
     实测 Lv.1000 时，默认剑比神品匕首强 22% ✗

   现在改成真正的手无寸铁：系数 0.75、平伤 0
   → 拿上【任何】武器都是提升 ✓（捡到东西才有意义 ✓）
   ★ 射程/攻击弧/攻速【保持不变】✓ —— 免得老玩家觉得"手感变了"✗
"""
FIST = {
    'id': 'fist', 'name': '空手', 'slot': 'weapon', 'tier': 0, 'itemLv': 1,
    'base': {'coeff': 0.75, 'atkSpeed': 1.15, 'reach': 2.4, 'arc': 1.05, 'critPt': 0},
    'affixes': [], 'effect': None, 'look': 'sword', 'reqLevel': 1,   # 空手无词条 ✓
    'flat0': True,          # ★ 标记：这件东西【没有】平伤那一份（只有空手有 ✓）
    'dur': 0, 'durMax': 0,  # ★ 空手没有耐久（不会坏 ✓）
    'fx': None,             # ★ 空手没有机制 ✓
    'ext': {},
}


def eff_level(w, level):
    """★ round472：【有效装备等级】= min(装备等级, 玩家等级)

    超过你等级的部分【不算数】✗ 不然 1 级拿 1000 级防具
    就算发挥度只剩 2%，也能加几百血 ✗（实测过 ✓）
    """
    il = int((w or {}).get('itemLv') or 1) if isinstance(w, dict) else 1
    lvv = int(level or 1)
    return max(1, min(il, lvv))


def flat_full(w, level=None):
    """这件武器【自己】的平伤 ✓

    ★ level 传了就按【有效等级】算（等级不够时平伤不会爆表 ✓）
    """
    w = w or {}
    if w.get('flat0'):
        return 0.0                       # ★ 空手没有平伤（第 58 轮 ✓）
    il = eff_level(w, level) if level is not None else int(w.get('itemLv') or 1)
    return flat_of(w.get('tier') or 0, il)


def weapon_damage(w):
    """★★ 武器伤害（第 51 轮，用户要求）★★
       = 平伤 + 系数 × 100

    ★ 为什么不掺玩家等级：用户说"加上等级不直观"✗
      掺进去之后，同一把武器在 1 级和 50 级显示完全不同 → 没法横向比哪把好 ✗
    ★ 所以这是个【纯武器分数】—— 两把武器谁高谁低，一眼就能看出 ✓
      （真正代入伤害时还是"固有 × 系数 + 平伤"，服务器算 ✓ 见 player_atk_with ✓）
    """
    b = (w or {}).get('base') or {}
    return flat_full(w) + float(b.get('coeff') or 1.0) * WEAPON_REF


def crit_damage(w):
    """暴击时的武器伤害（暴击 ×1.5，见 mobs.CRIT_MUL ✓）"""
    return weapon_damage(w) * 1.5


def dps_of(w):
    """每秒伤害（比较用）—— 把"暴击期望"和"攻速"都算进去 ✓
       ★ 只看单次伤害会误判：匕首单次低但快得多 ✓ 所以比较要看这个 ✓
       暴击期望 = 1 + 暴击率 20% × (1.5 - 1) = 1.1 ✓
    """
    w = w or {}
    b = w.get('base') or {}
    spd = max(S_MIN, min(S_MAX, float(b.get('atkSpeed') or speed_of(w.get('look')))))
    interval = BASE_INTERVAL / spd
    return weapon_damage(w) * 1.1 / max(0.05, interval)


# ================================================================ 武器机制（第 59 轮）
#   ★ 用户要求：触发概率和效果【随品阶增强一点点】✓
#   ★ 每一项都要能写进文案（不然玩家不知道 ✓）
#
#   格式：look -> (效果名, 触发率基准, 触发率每阶, 效果值基准, 效果值每阶, 文案模板)
#     概率上限 75%（再高就变必定了 ✗）
#
#   ★ 三条设计原则（第 58 轮定的）：
#     ① 能被【连续施加】的效果必须"概率 + 免疫窗口"（眩晕/击退/流血 ✓）
#     ② 场合本身就是门槛的可以必定触发（背击/溅射 ✓）
#     ③ 期望收益算进 DPS 预算，不偷偷超模 ✓
#   格式：look -> (效果名, 触发率基准, 触发率每阶, 效果值基准, 效果值每阶, 单位, 文案模板)
#     单位：pct=百分比 · flat=小数（米/秒）· int=整数（个数）
#     ★ 单位必须显式写 ✗ 靠"值小于 1 就当百分比"猜的话 ——
#       锤的 0.4 秒会被当成 40% ✗（实测踩过：文案写成"眩晕 62 秒"✗）
#     ★ 触发率 1.00 表示【必定触发】（靠场合门槛限制，不套 75% 上限 ✓）
WEAPON_FX = {
    # round388: 匕首改为双持交替（用户要求）
    #   奇数刀投掷 20%→80% · 偶数刀近身 100%
    'dagger': ('投掷',   1.00, 0.000, 0.20, 0.0545, 'pct',  '双持·奇数刀左手投掷（{v}% 伤害，射程同箭）· 偶数刀右手近身刺（100%）'),
    # round379: 单手剑招架改为连刺（用户要求）
    #   概率：基础 10% · 每阶 +3.64% · 12 阶（t 封顶 11）到 50%
    'sword':  ('连刺',   0.10, 0.0364, 1.00, 0.000, 'pct',  '{p}% 概率连刺 · 本次伤害结算两次'),
    # round395: 弯刀改为连砍（用户要求）
    #   刀数 2 -> 13（t=0 二刀 · 每阶 +1）· 每刀 60% 伤害
    'saber':  ('连砍',   0.20, 0.000, 2, 1.000, 'int',  '{p}% 概率连砍 {v} 刀 · 每刀 60% 伤害，每砍一刀向前一步'),
    # round392: 长棍改为直线横扫（用户要求）
    #   概率 10% -> 55%（每阶 +4.09%）· 直线 4 -> 10 米（每阶 +0.545）
    'staff':  ('横扫',   0.10, 0.0409, 4.0, 0.545, 'flat',  '{p}% 概率横扫 · 前方 {v} 米直线伤害并击退'),
    # round404: 长枪改为挑飞（用户要求）
    #   概率 5% -> 17%（每阶 +1.09%）· 挑到 6 格高，1.5 秒后落地
    # ★ round409（用户："最低 8%，最高 12 阶 20%"）
    #   只改【起点】✗ 每阶增量不动（0.0109）✓
    #   8% + 0.0109 × 11 = 19.99% → 文案显示 20%（12 阶封顶 ✓ 0 阶 8% ✓）
    #   ★ 文案 p 是 fx_of 用同一个 chance 算的 ✗ 不会出现"代码 20%、文案 17%"✓
    'spear':  ('挑飞',   0.08, 0.0109, 6,   0.000, 'int',  '{p}% 概率挑飞 · 挑到 {v} 格高，落地时砸出范围伤害'),
    'axe':    ('溅射',   1.00, 0.000, 0.35, 0.020, 'pct',  '命中时溅射 1.5 米内最多 2~13 个（品阶越高越多，1 阶 2 个 · 每阶 +1 · 12 阶 13 个）· 各 {v}% 伤害'),
    # round381: 锤子改为旋击（用户要求）
    #   概率：基础 10% · 每阶 +2.73% · 12 阶（t 封顶 11）到 40%
    #   不触发 = 正常劈 ✗ 触发 = 转一圈打周围所有 ✓
    'hammer': ('旋击',   0.10, 0.02727, 1.00, 0.000, 'pct',  '{p}% 概率旋击 · 转一圈攻击周围全部敌人'),
}

FX_MAX_CHANCE = 0.75          # 触发率上限（再高就变必定了 ✗）
STUN_IMMUNE = 3.0             # 眩晕免疫窗口（秒）—— 防"无限锁死" ✓
KNOCK_IMMUNE = 1.5            # 击退免疫窗口（秒）—— 防"永久风筝" ✓
BLEED_TIME = 3.0              # 流血持续（秒）
SPLASH_R = 1.5                # 溅射半径（米）
SPLASH_MAX = 2                # 溅射最多几个（★ 斧头按品阶覆盖：2~13 ✓ 见 world.py）


# ★ round399：弯刀连砍刀数（用户给的阶梯表 ✗ 不是线性 ✓）
#   1-2阶1刀 · 2-3阶2刀 · 4-5阶3刀 · 6-7阶4刀 · 7-8阶5刀 · 9-10阶6刀 · 11阶7刀 · 12阶8刀
#   ★ 区间有重叠（1-2 和 2-3 都含 2 阶）✗ 按【后写的为准】取 ✓
SABER_CHOPS = (1, 2, 2, 3, 3, 4, 5, 5, 6, 6, 7, 8)   # 索引 = 品阶-1


def saber_chops(tier):
    t = max(0, min(11, int(tier) - 1)) if int(tier) >= 1 else 0
    return SABER_CHOPS[t]


def fx_of(look, tier):
    """取某把武器的机制数值（按品阶加成 ✓）

    返回 dict：name / chance(0~1) / value / text（写进文案 ✓）
    没有机制的武器（弓）返回 None
    """
    fx = WEAPON_FX.get(look)
    if not fx:
        return None
    t = max(0, min(11, int(tier)))
    name, cb, ci, vb, vi, unit, tpl = fx
    # ★ 只有"概率触发"的才套 75% 上限 ✓ 必定触发的保持 1.0（那种靠场合门槛限制 ✓）
    chance = (cb if cb >= 1.0 else min(FX_MAX_CHANCE, cb + ci * t))
    value = vb + vi * t
    # ★ round399：弯刀刀数走阶梯表 ✗ 不用线性公式 ✓
    if look == 'saber':
        value = saber_chops(tier)
    if unit == 'pct':
        vshow = round(value * 100)
    elif unit == 'int':
        vshow = int(round(value))
    else:
        vshow = round(value, 2) if value < 1 else round(value, 1)
    pshow = round(chance * 100)
    return {'name': name, 'chance': chance, 'value': value, 'tier': t,
            'text': tpl.format(p=pshow, v=vshow), 'pct': pshow, 'vshow': vshow}


# ================================================================ 耐久（第 59 轮）
#   ★ 用户要求：高强度用 5 天损坏消失、耐久可见 ✓
#   ★ 每次【挥砍】扣 1 点（打空也算 ✓ 更真实）→ 归零武器消失 ✓
#
#   5 天是怎么算出来的：
#     平均挥砍间隔 0.62 秒 → 每小时 5806 次
#     高强度 = 每天 4 小时 × 5 天 = 20 小时
#     战斗不会一直挥（跑位/捡东西/打空）→ 按 25% 占比算
#     → 20h × 5806 × 25% ≈ 29,000 次 → 顶阶定 28,000 ✓
DUR_MAX = (800, 1200, 1800, 2600, 3600, 5000, 6800, 9000, 12000, 16000, 21000, 28000)


def dur_max_of(tier):
    """按品阶的耐久上限"""
    return DUR_MAX[max(0, min(11, int(tier)))]


def ensure_dur(w):
    """给【第 59 轮之前掉的】老武器补上耐久字段 ✓

    ★ 用户报："耐久度在点击装备时就可以看到，而不是穿戴后才能看见"
      病根：那些武器的 item_json 里【没有 dur/durMax】✗
            → 客户端那条判断 (+it.durMax > 0) 不成立 → 耐久行直接不显示 ✗
      → 读到就补上（意思就是"以后按新规矩算" ✓ 不用迁移整库 ✗）
    """
    # ★ 第 104 轮：假防具自愈 —— slot=armor 但没有 base 的，
    #   其实是当年掉落拼错留下的【材料】✗ → 把 slot 去掉，让它回归材料 ✓
    #   ★ 为什么必须放在这个早返回之前：材料没有 base ✗
    #     放在后面的话根本走不到 ✗（我第一版就放错了 ✗）
    if isinstance(w, dict) and w.get('slot') == 'armor' and not w.get('base'):
        w.pop('slot', None)
        w.pop('look', None)
        return w
    if not isinstance(w, dict) or not w.get('base'):
        return w
    # ★★ 第 104 轮修的真 bug：这里原来【跳过防具】✗
    #   第 103 轮我给防具做了耐久 ✓ 但【老防具】的 JSON 里 durMax 是 0 ✗
    #   → 客户端那条 (+it.durMax > 0) 不成立 → 耐久条根本不显示 ✗
    #   → 用户："耐久也没有"✓ 就是这个 ✓
    if w.get('slot') == 'armor':
        import armor as _armor
        if not w.get('durMax'):
            w['durMax'] = _armor.dur_max_of(w.get('tier') or 0)
            if not w.get('dur'):
                w['dur'] = w['durMax']
        return w
    if not w.get('durMax'):
        w['durMax'] = dur_max_of(w.get('tier') or 0)
        if not w.get('dur'):
            w['dur'] = w['durMax']
    return w


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
        # ★★ 第 51 轮：物品等级要【落在物品上】★★
        #   原来 §7.5 的平伤加成用的是【玩家等级//4】✗ —— 那是错的：
        #   同一把武器在 1 级和 50 级手里数值不一样 → 玩家根本没法比较两把武器 ✗
        #   现在存成物品自己的等级（掉落时由出它的怪决定 ✓）→ 显示和结算都只看这把武器 ✓
        'itemLv': max(1, int(item_lv)),
        'base': {
            'coeff': round(float(coeff), 3),
            'atkSpeed': round(speed_of(look), 2),
            'reach': reach_of(look),
            'arc': arc_of(look),
            'critPt': 0,
        },
        # ★★ 第 60 轮：词条 ★★
        #   条数【看概率】（品阶只抬上限 ✓）· 同名不重复 ✓ · 只从已实装的池里抽 ✓
        #   不传 rng 就用全局 random（掉落时传同一个 rng 保证可复现 ✓）
        'affixes': affixes.roll_affixes(t, ('weapon',), rng),
        'effect': None,
        'look': look,
        # ★★ round472（用户："装备等级就等于建议等级"）★★
        #   旧：tier*3+1（和装备等级无关 ✗ 且有上限 34 ✗）
        #   新：就是装备级本身 ✗ 无上限 ✓
        'reqLevel': max(1, int(item_lv)),
        # ★ 第 59 轮：耐久（写进物品 JSON ✓ 每次挥砍扣 1 ✓ 归零消失）
        'dur': dur_max_of(t), 'durMax': dur_max_of(t),
        # ★ 第 59 轮：把机制也写进物品（客户端直接显示 ✓ 不用在 JS 里再抄一份表 ✗）
        #   踩过的坑：表在两边各写一份 → 改一边忘一边 → 文案和实际不符 ✗
        'fx': fx_of(look, t),
        'ext': {},
    }


# ★★★ 第 130 轮：品阶概率改成【幂律 + 等级调软】（方案 docs/掉落方案.md）★★★
#   为什么改：原来是"品阶上限跟着怪等级硬卡"✗
#     1 级怪掉 12 阶的概率是【严格 0】✗ 低级怪对高级玩家完全没价值 ✗
#   现在：一条连续曲线 ✓
#     1 级怪也能出 12 阶（1/25 万 ✓ 极低但非零 ✓）
#     等级越高越容易 ✓ 120 级渐近饱和在 2.0000% ✓（用户定的上限 ✓）
#   ★ 四个常量都放这里 ✗ 调平衡不用翻代码 ✓
TIER_A0 = 5.0          # 低级时的衰减指数（越大 → 高阶越罕见）
TIER_A1 = 1.1904       # 满级时的衰减指数
                       #   ★ 这个值是【解出来的】✗ 不是拍的 ✓
                       #     解的目标：满级时 12 阶正好 = 2.0000%（用户定的上限 ✓）
                       #     想改上限就重解一次（二分 80 次就行 ✗ 别手拍 ✓）
TIER_XP = 1.2          # 等级进度的幂次（控制"什么时候开始变多"）
TIER_LV_CAP = 120      # 等级进度封顶（超过就饱和 ✓ 200 级和 120 级完全一样 ✓）


def tier_weights(mob_lv, killer_lv):
    """返回 12 个品阶的权重（品阶 0..11 → 1..12 阶 ✓）

    方案 §2.1 三行公式：
      x = min(怪等级, 击杀者等级+20) / 120      ← 保留"击杀者+20"防大号带小号 ✓
      a = 5.0 − 3.8096 × x^1.2
      w(t) = (1/t)^a
    ★ 用幂律而不是高斯：高斯尾巴掉太快（10 的负几十次方 ≈ 0 ✗）
      等于又变回硬上限 ✗ 幂律尾巴长 → 正好给出"极低但非零"✓
    """
    z = min(int(mob_lv or 1), int(killer_lv or 1) + 20)
    x = min(float(z), float(TIER_LV_CAP)) / float(TIER_LV_CAP)
    aa = TIER_A0 - (TIER_A0 - TIER_A1) * (x ** TIER_XP)
    w = []
    for t in range(1, 13):
        w.append(1.0 / (t ** aa))
    s = sum(w) or 1.0
    return [v / s for v in w]


def roll_tier(mob_lv, killer_lv, rng=None):
    """按权重抽一个品阶，返回 0..11（= 1..12 阶 ✓）"""
    r = rng or random
    w = tier_weights(mob_lv, killer_lv)
    pick = r.random()
    acc = 0.0
    for i, v in enumerate(w):
        acc += v
        if pick <= acc:
            return i
    return 0


def roll_weapon(mob_lv, killer_lv, rng=None):
    """击杀掉一件武器（§7.8：类型按怪的等级/倾向，品阶按 §8.1 ③）"""
    r = rng or random
    # ★★ 第 130 轮：品阶改用【幂律曲线】抽 ✗（方案§2.1）
    #   旧写法：max_tier(mob_lv) 硬卡上限 + 0.62 连过关 ✗
    #     → 1 级怪永远出不了 12 阶 ✗（用户要求改掉 ✓）
    #   ★ 一句话就换完了 ✓ 别的什么都不用动 ✓
    tier = roll_tier(mob_lv, killer_lv, r)
    # ★★★ round420（用户："我发现打怪不会掉弓，是不是有问题"）★★★
    #   病根：这里把【弓】从掉落表里排除了 ✗
    #     注释写的是"还没有投射物" ✗ 但那是第 69 轮之前的事 ✓
    #     现在弓的箭、飞行、命中、伤害、客户端模型全都做完了 ✓
    #     → 弓一直拿不到（只能管理员发）✗ 玩家当然会觉得"有问题" ✓
    #   ★ 现在：弓也跟其它七种一样随机掉 ✗ 概率和它们平分 ✓
    keys = list(TYPES.keys())
    look = r.choice(keys)
    # ★★ round472（用户："获取到的装备等级和人物等级差不多、没有上限"）★★
    #   旧：item_lv = 怪等级 ÷ 4 ✗（10 级怪只掉 2 级装备 ✗）
    #   新：item_lv = 击杀者等级 ✗ 无上限 ✓（你多少级就掉多少级装备 ✓）
    item_lv = max(1, int(killer_lv))
    return make_weapon(look, tier, roll_coeff(look, r), item_lv, r)


def atk_range_arc(look):
    return reach_of(look), arc_of(look)
