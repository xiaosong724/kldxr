# -*- coding: utf-8 -*-
"""词条系统（第 50 轮，方案 §7.2 / §7.11）

★★ 三条硬规矩（方案 §7.11③ 定死的，不定死后期必出问题 ✗）★★
   ① pct 词条【只作用于武器自身贡献那一份】，不作用于固有攻击 ✓
      理由：不然"等级越高、词条越强"会滚雪球，§7.5 那条"装备最多贡献 60%"就守不住了 ✗
   ② flat 词条直接加到总攻击上 ✓
   ③ 攻速词条：S = 武器基础 S × (1 + 攻速%)，然后【照样夹到 §5.1 的上下限里】✓
      —— 攻速词条不能突破"防一秒十刀"那条线 ✓
   （另有 ④ 有触发条件的效果全部由服务器算、⑤ 同名不同值可以出现在不同部位、
     ⑥ 洗练/重铸本期不做 —— 但 affixes 是个数组，以后加只是重新 roll，不用改结构 ✓）

★ 这一期【真正生效】的词条，和【只定义、效果待做】的，下面都标清楚了 ✓
  （宁可标明白，也不要让玩家看到一个"数值写着但不生效"的词条 ✗）
"""

import random

# ------------------------------------------------------------------ 词条表
#   key, 名字, 模式, byTier 十二个区间, 权重, 说明, 是否已实装
#   ★ 数值区间照 §7.2 的格式：加新词条 = 加一行 ✓ 不用改代码 ✓
_D = (  # 十二阶的区间骨架（低 → 高），每个词条按自己的尺度填
    (1, 3), (2, 5), (3, 8), (5, 12), (8, 18), (12, 25),
    (18, 34), (25, 46), (34, 62), (46, 84), (62, 112), (84, 150)
)


def _scale(mul, base=1.0):
    """按 _D 的骨架生成某条自己的十二阶区间（省得手抄 12 个数 ✗）"""
    return tuple((max(base, round(lo * mul, 1)), max(base, round(hi * mul, 1))) for lo, hi in _D)


AFFIXES = [
    # ---- 攻击类（8 条）----
    ('atk_pct',  '攻击力',     'pct',  _D, 100, '武器自身伤害 +X%', True),
    ('atk_flat', '攻击力',     'flat', _scale(0.75, 2), 100, '总攻击 +X 点', True),
    ('crit_pt',  '暴击率',     'flat', _scale(0.26, 1), 90, '暴击率 +X%（暴击点）', True),
    ('crit_dmg', '暴击伤害',   'pct',  _scale(1.05, 5), 80, '暴击伤害 +X%', True),
    ('spd_pct',  '攻击速度',   'pct',  _scale(0.15, 1), 80, '攻速 +X%（受 §5.1 上限约束 ✓）', True),
    ('lifesteal', '吸血',      'pct',  _scale(0.09, 1), 70, '造成伤害的 X% 回血', True),
    ('pen_pt',   '穿透',       'flat', _scale(0.22, 1), 60, '无视 X 点减伤（★ 等有防具再实装）', False),
    ('knockback', '击退',      'flat', _scale(0.013, 0.1), 60, '命中把目标推开 X 米', True),
    # ---- 生存类（5 条）----
    ('hp_flat',  '生命',       'flat', _scale(3.5, 6), 90, '生命上限 +X 点', True),
    ('hp_pct',   '生命',       'pct',  _scale(0.48, 1), 70, '生命上限 +X%', True),
    ('dr_flat',  '减伤',       'flat', _scale(0.16, 1), 80, '受到伤害 -X 点（至少吃 1 点）', True),
    ('dodge_pt', '闪避',       'flat', _scale(0.14, 1), 60, 'X% 概率躲开僵尸的攻击', True),
    ('qi_on_hurt', '受击回灵气', 'flat', _scale(0.12, 1), 50, '被打时回 X 点灵气', True),
    # ---- 特殊类（7 条）----
    ('splash',   '溅射',       'pct',  _scale(0.65, 5), 70, '对周围敌人造成 X% 伤害', True),
    ('qi_on_kill', '击杀回灵气', 'flat', _scale(0.34, 2), 60, '击杀回 X 点灵气', True),
    ('execute',  '斩杀',       'pct',  _scale(0.48, 5), 60, '目标残血（<30%）时额外 +X% 伤害', True),
    ('combo',    '连击',       'pct',  _scale(0.13, 2), 60, '连续命中每层 +X% 伤害（最多 5 层）', True),
    ('spellbreak', '破法',     'flat', _scale(0.48, 5), 50, '对护盾/减伤额外穿透 X 点（★ 待实装）', False),
    ('treasure', '寻宝',       'pct',  _scale(0.3, 3), 60, '掉落概率 +X%', True),
    ('silent',   '静音',       'pct',  _scale(0.34, 5), 50, '攻击少惊动周围僵尸 X%（★ 待实装）', False),
]
AFFIX_BY_KEY = dict((a[0], a) for a in AFFIXES)

# 哪些词条是真生效的（给 UI 和测试用 ✓ 免得玩家白高兴 ✗）
def is_live(key):
    a = AFFIX_BY_KEY.get(key)
    return bool(a and a[6])


# ------------------------------------------------------------------ 掷骰

def affix_count(tier):
    """条数按品阶（§7.11①）：0-1→1 条，2-3→2，4-6→3，7-9→4，10-11→5"""
    t = max(0, min(11, int(tier)))
    if t <= 1:
        return 1
    if t <= 3:
        return 2
    if t <= 6:
        return 3
    if t <= 9:
        return 4
    return 5


def _value(a, tier, rng):
    """在该阶的区间里滚一个值（整数词条出整数 ✓ 免得显示 12.7 点生命 ✗）"""
    t = max(0, min(11, int(tier)))
    lo, hi = a[3][t]
    v = lo + rng.random() * (hi - lo)
    if v >= 10 or float(v).is_integer():
        return int(round(v))
    return round(v, 1)


def roll_affixes(tier, rng=None):
    """给一件装备滚词条 —— ★ 同名词条不重复（roll 到重了就重抽 ✓ §7.11①）

    返回 [{'key','name','mode','val','text','live'}, ...]
    """
    r = rng or random
    n = affix_count(tier)
    pool = list(AFFIXES)
    out, used = [], set()
    guard = 0
    while len(out) < n and pool and guard < 200:
        guard += 1
        # 权重抽取
        tot = sum(a[5] for a in pool)
        x = r.random() * tot
        pick = pool[-1]
        for a in pool:
            x -= a[5]
            if x <= 0:
                pick = a
                break
        if pick[0] in used:
            continue
        used.add(pick[0])
        out.append(make_affix(pick, tier, r))
    return out


def make_affix(a, tier, rng=None):
    """把一条词条表项 + 品阶 变成一条具体词条 ✓"""
    r = rng or random
    v = _value(a, tier, r)
    if a[2] == 'pct':
        txt = '%s +%s%%' % (a[1], v)
    else:
        txt = '%s +%s%s' % (a[1], v, ' 米' if a[0] == 'knockback' else ' 点')
        if a[0] in ('crit_pt', 'dodge_pt'):
            txt = '%s +%s%%' % (a[1], v)
    return {'key': a[0], 'name': a[1], 'mode': a[2], 'val': v, 'text': txt,
            'live': bool(a[6]), 'doc': a[6 - 1] if False else a[5] if False else None} if False else \
           {'key': a[0], 'name': a[1], 'mode': a[2], 'val': v, 'text': txt,
            'live': bool(a[6]), 'desc': _docs(a)}


def _docs(a):
    return a[3 - 3 + 0] if False else ''


# ------------------------------------------------------------------ 生效

def totals(affixes):
    """把词条按 key 汇总（同 key 多条就相加 ✓ 以后有防具时也一样 ✓）"""
    out = {}
    for af in (affixes or []):
        k = af.get('key')
        if not k:
            continue
        out[k] = out.get(k, 0.0) + float(af.get('val') or 0)
    return out


def effective(w, inherent=0.0):
    """算出一件武器【生效后】的全部数值（§7.5 的公式 + §7.11 的三条规矩 ✓）

    返回一个 dict，客户端和服务器都用它（服务器算伤害用，客户端显示用 ✓）
    """
    base = (w or {}).get('base') or {}
    look = (w or {}).get('look') or DEFAULT_TYPE
    tier = int((w or {}).get('tier') or 0)
    af = (w or {}).get('affixes') or []
    T = totals(af)

    coeff = float(base.get('coeff') or 1.0)
    item_lv = max(1, int((w or {}).get('itemLv') or 1))
    flat = flat_of(tier, item_lv)

    # ① pct 词条只作用于武器自身那一份 ✓（不碰固有攻击 ✓）
    weapon_part = inherent * coeff + flat
    weapon_part *= (1.0 + T.get('atk_pct', 0.0) / 100.0)
    # ② flat 词条直接加到总攻击 ✓
    atk = inherent + weapon_part + T.get('atk_flat', 0.0)
    # §7.5 的封顶照旧（装备最多贡献 60% → 总攻击 ≤ 固有 × 2.5 ✓）
    cap = inherent * 2.5
    if inherent > 0 and atk > cap:
        atk = cap

    # ③ 攻速：基础 S × (1 + 攻速%) → 再夹回 §5.1 的上下限 ✓
    S = speed_of(look) * (1.0 + T.get('spd_pct', 0.0) / 100.0)
    S = max(S_MIN, min(S_MAX, S))

    return {
        'look': look, 'tier': tier,
        'atk': atk,                  # 总攻击（服务器算伤害就用这个 ✓）
        'weaponPart': weapon_part,   # 武器那一份（封顶前 ✓ 给 UI 看占比用）
        'coeff': coeff,
        'atkSpeed': round(S, 3),
        'interval': round(BASE_INTERVAL / S, 3),
        'reach': float(base.get('reach') or reach_of(look)),
        'arc': float(base.get('arc') or arc_of(look)),
        'critPt': float(base.get('critPt') or 0) + T.get('crit_pt', 0.0),
        'critDmg': 50.0 + T.get('crit_dmg', 0.0),      # 基础暴击伤害 50%（§5.2）
        'lifesteal': T.get('lifesteal', 0.0),
        'knockback': T.get('knockback', 0.0),
        'splash': T.get('splash', 0.0),
        'execute': T.get('execute', 0.0),
        'combo': T.get('combo', 0.0),
        'treasure': T.get('treasure', 0.0),
        'hpFlat': T.get('hp_flat', 0.0),
        'hpPct': T.get('hp_pct', 0.0),
        'dr': T.get('dr_flat', 0.0),
        'dodge': T.get('dodge_pt', 0.0),
        'qiOnHurt': T.get('qi_on_hurt', 0.0),
        'qiOnKill': T.get('qi_on_kill', 0.0),
        'pen': T.get('pen_pt', 0.0),          # 待实装（等防具）
        'spellbreak': T.get('spellbreak', 0.0),
        'silent': T.get('silent', 0.0),
        'affixes': af,
    }
