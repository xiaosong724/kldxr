# -*- coding: utf-8 -*-
"""词条系统（第 60 轮，方案 §7.2 / §7.11）

★★ 三条硬规矩（§7.11③，不定死后期必出问题 ✗）★★
   ① pct 词条只作用于【武器自身贡献那一份】，不作用于固有攻击 ✓
      （不然"等级越高、词条越强"滚雪球，封顶就守不住了 ✗）
   ② flat 词条直接加到总攻击上 ✓
   ③ 攻速词条：S = 武器基础 S × (1+攻速%)，再夹回 §5.1 的上下限 ✓

★ 条数不是"按阶固定"✗ —— 品阶只抬【上限】，具体几条看概率 ✓（第 60 轮用户要求）
★ 分部位（§7.2 的 slots ✓）：武器能出武器的、防具能出防具的 ✓
   防具系统还没做 → 防具词条先定义好、但不会掉不出来（不会给玩家"死词条"✗）
"""

import random

# ---------------------------------------------------------------- 词条表
#  key / 名字 / 模式 / 十二阶区间 / 权重 / 部位 / 是否已实装 / 文案模板
_D = ((1, 3), (2, 5), (3, 8), (5, 12), (8, 18), (12, 25),
      (18, 34), (25, 46), (34, 62), (46, 84), (62, 112), (84, 150))


def _s(mul, base=1.0):
    """按 _D 的骨架生成自己的十二阶区间（省得手抄 12 个数 ✗）"""
    return tuple((max(base, round(lo * mul, 2)), max(base, round(hi * mul, 2))) for lo, hi in _D)


#   ★ live=False 的【不会掉出来】✓（不然玩家抽到一条写着"破法 +40"却什么都没发生的词条 ✗）
AFFIXES = [
    # ---- 武器词条（这一期能掉的）----
    ('atk_pct',  '攻击力',    'pct',  _s(1.0),         100, ('weapon',), True,   '攻击力 +{v}%'),
    ('atk_flat', '攻击力',    'flat', _s(0.75, 2),     100, ('weapon',), True,   '攻击力 +{v} 点'),
    ('crit_pt',  '暴击率',    'flat', _s(0.26, 1),      90, ('weapon',), True,   '暴击率 +{v}%'),
    ('crit_dmg', '暴击伤害',  'pct',  _s(1.05, 5),      80, ('weapon',), True,   '暴击伤害 +{v}%'),
    ('spd_pct',  '攻击速度',  'pct',  _s(0.15, 1),      80, ('weapon',), True,   '攻速 +{v}%（受上限约束）'),
    ('lifesteal', '全能吸血', 'pct',  _s(0.09, 1),      70, ('weapon',), True,   '造成伤害的 {v}% 回血（对所有伤害生效）'),
    # ★★★ round474：把现有属性补成词条 ✓
    ('hit_pt',   '命中',      'flat', _s(0.14, 1),      60, ('weapon',), True,   '命中 +{v}%'),
    # ★ 全能吸血：任何伤害都回血（含 PvP，用户定全额 ✓）
    ('vamp_all', '全能吸血',  'pct',  _s(0.05, 1),      55, ('weapon',), True,   '造成伤害的 {v}% 回血（对所有伤害生效）'),
    ('treasure', '寻宝',      'pct',  _s(0.30, 3),      60, ('weapon',), True,   '掉落概率 +{v}%'),
    # ---- 武器词条（定义了、但效果待做 → 先不掉 ✓）----
    ('splash',   '溅射',      'pct',  _s(0.65, 5),      70, ('weapon',), False,  '溅射 +{v}%'),
    ('execute',  '斩杀',      'pct',  _s(0.48, 5),      60, ('weapon',), False,  '残血目标额外 +{v}%'),
    ('combo',    '连击',      'pct',  _s(0.13, 2),      60, ('weapon',), False,  '连击每层 +{v}%（最多 5 层）'),
    ('pen_pt',   '穿透',      'flat', _s(0.22, 1),      60, ('weapon',), True ,  '无视 {v} 点减伤'),
    ('spellbreak', '破法',    'flat', _s(0.48, 5),      50, ('weapon',), False,  '对护盾额外穿透 {v}'),
    # ---- 防具词条（定义好了 ✓ 等防具系统做出来再掉 ✓）----
    ('hp_flat',  '生命',      'flat', _s(3.5, 6),       90, ('armor',), True,    '生命上限 +{v} 点'),
    ('hp_pct',   '生命',      'pct',  _s(0.48, 1),      70, ('armor',), True,    '生命上限 +{v}%'),
    ('dr_flat',  '减伤',      'flat', _s(0.16, 1),      80, ('armor',), True,    '受到伤害 -{v} 点'),
    ('dodge_pt', '闪避',      'flat', _s(0.14, 1),      60, ('armor',), True,    '闪避 +{v}%'),
    # ★★ round474：把现有属性补成词条 ✓
    ('anticrit', '免爆',     'flat', _s(0.16, 1),      60, ('armor',), True,    '免爆 +{v}%'),
    ('anticritdmg', '抗爆',  'flat', _s(0.20, 2),      60, ('armor',), True,    '抗爆 +{v}%'),
    ('dr_pct',   '减伤',     'pct',  _s(0.10, 1),      55, ('armor',), True,    '减伤 +{v}%'),
    ('qi_flat',  '灵气上限', 'flat', _s(0.30, 2),      50, ('armor',), True,    '灵气上限 +{v} 点'),
    ('speed_pct', '移速',    'pct',  _s(0.08, 1),      50, ('armor',), True,    '移速 +{v}%'),
    # ★ 经验：用户定【防具】✓
    ('exp_pct',  '经验',     'pct',  _s(0.10, 2),      50, ('armor',), True,    '经验 +{v}%'),
    ('qi_on_hurt', '受击回灵气', 'flat', _s(0.12, 1),   50, ('armor',), True,    '受击回 {v} 灵气'),
    ('qi_on_kill', '击杀回灵气', 'flat', _s(0.34, 2),   60, ('armor',), True,    '击杀回 {v} 灵气'),
    ('silent',   '静音',      'pct',  _s(0.34, 5),      50, ('armor',), False,   '少惊动僵尸 {v}%'),
]
BY_KEY = dict((a[0], a) for a in AFFIXES)

# ---------------------------------------------------------------- 条数（看概率 ✓）
#   ★ 品阶只抬【范围】✓ 实际几条按权重抽 ✓（越少越常见 ✓）
#   ★ 下限也跟着抬一点 —— 不然"神品只有 1 条"太打击人 ✗
COUNT_RANGE = {
    0: (1, 1), 1: (1, 1), 2: (1, 2), 3: (1, 2), 4: (2, 3), 5: (2, 3),
    6: (2, 4), 7: (2, 4), 8: (2, 4), 9: (3, 5), 10: (3, 5), 11: (3, 5),
}
COUNT_DECAY = 0.72          # 每多一条，权重 ×0.72（越少越常见 ✓）


def count_weights(tier):
    """这个品阶下：1/2/3/4/5 条的权重（从下限到上限 ✓）"""
    lo, hi = COUNT_RANGE[max(0, min(11, int(tier)))]
    ws = [1.0 * (COUNT_DECAY ** i) for i in range(hi - lo + 1)]
    return lo, ws


def roll_count(tier, rng=None):
    r = rng or random
    lo, ws = count_weights(tier)
    x = r.random() * sum(ws)
    for i, w in enumerate(ws):
        x -= w
        if x <= 0:
            return lo + i
    return lo


# ---------------------------------------------------------------- 掷骰

def _value(a, tier, rng):
    t = max(0, min(11, int(tier)))
    lo, hi = a[3][t]          # 表：0key 1名字 2模式 3区间 4权重 5部位 6实装 7文案
    v = lo + rng.random() * (hi - lo)
    if a[2] == 'flat' and v >= 10:
        return int(round(v))
    return round(v, 1)


def make_affix(a, tier, rng):
    v = _value(a, tier, rng)
    unit = '%' if a[2] == 'pct' else ' 点'
    if a[0] in ('crit_pt', 'dodge_pt', 'lifesteal', 'spd_pct', 'treasure',
                'hit_pt', 'anticrit', 'anticritdmg', 'vamp_all',
                'dr_pct', 'speed_pct', 'exp_pct'):
        unit = '%'
    txt = a[7].format(v=v)                       # 文案模板在第 7 列 ✓
    if '%' not in txt and a[0] not in ('atk_flat', 'hp_flat', 'dr_flat', 'pen_pt',
                                       'spellbreak', 'qi_on_hurt', 'qi_on_kill', 'qi_flat'):
        txt += '%'                               # 概率类的补个百分号 ✓
    return {'key': a[0], 'name': a[1], 'mode': a[2], 'val': v,
            'text': txt, 'live': bool(a[6])}


def roll_affixes(tier, slots=('weapon',), rng=None):
    """给一件装备滚词条

    ★ 条数看概率（品阶只抬上限 ✓）
    ★ 同名词条【不重复】（抽到重了就重抽 ✓ §7.11①）
    ★ 只从【这一部位能出的 + 已实装的】里抽 ✓（不给玩家死词条 ✗）
    """
    r = rng or random
    pool = [a for a in AFFIXES[0:0]]                      # 占位（下面重建）
    pool = [a for a in AFFIXES if a[5] and (a[5][0] in slots)]
    pool = [a for a in pool if a[6]]                      # 只抽已实装的 ✓
    if not pool:
        return []
    n = min(roll_count(tier, r), len(pool))               # 池子不够就少给几条 ✓
    used, out = set(), []
    guard = 0
    while len(out) < n and guard < 300:
        guard += 1
        tot = sum(a[4] for a in pool)
        x = r.random() * tot
        pick = pool[-1]
        for a in pool:
            x -= a[4]
            if x <= 0:
                pick = a
                break
        if pick[0] in used:
            continue
        used.add(pick[0])
        out.append(make_affix(pick, tier, r))
    return out


# ---------------------------------------------------------------- 生效

def totals(affixes):
    out = {}
    for af in (affixes or []):
        k = af.get('key')
        if k:
            out[k] = out.get(k, 0.0) + float(af.get('val') or 0)
    return out


def apply_affixes(w, inherent, base_atk):
    """把词条作用到攻击力上（§7.11③ 的 ①②✓）

    base_atk = 已经算好的"固有 × 系数 + 平伤"（不含词条 ✓）
    ★ pct 只作用于【武器自身那一份】✗ 不碰固有攻击 ✓
      —— 所以这里把 base_atk 拆成"固有那一份 + 武器那一份"再加词条 ✓
    """
    T = totals((w or {}).get('affixes'))
    if not T:
        return base_atk
    b = (w or {}).get('base') or {}
    co = float(b.get('coeff') or 1.0)
    weapon_part = base_atk - inherent * co          # 武器自己那一份（系数+平伤 ✓）
    inherent_part = inherent * co
    weapon_part *= (1.0 + T.get('atk_pct', 0.0) / 100.0)     # ① pct 只动这一份 ✓
    out = inherent_part + weapon_part + T.get('atk_flat', 0.0)   # ② flat 加总额 ✓
    return out
