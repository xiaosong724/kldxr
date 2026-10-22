# -*- coding: utf-8 -*-
"""天赋系统 · 属性定义表（第 114 轮，方案 docs/天赋方案.md §2）

★ 这里是【唯一事实来源】✗
  服务器算数值、客户端画界面都从这里来 ✓
  不许在别处再写一份 12 个属性的表 ✗（写两份迟早不一致 ✗ —— 这个坑踩过 4 次了 ✓）

三类属性的"1 点"不是一回事（方案 §2）：
  · 对抗类 1 点 = 0.5%  成对相减，有效值有上限
  · 增益类 1 点 = 1%    没有对抗方
  · 池/强度类 点数直接换数值
"""

# (key, 中文名, 类别, 1点等于, 有效值上限, 对抗方key, v1是否生效)
#   类别：'vs' 对抗类 / 'buff' 增益类 / 'pool' 池或强度类
#   上限：None = 无上限（对抗类里"专门用来抵消别人"的那一半都无上限 ✓ 方案 §2.1）
DEFS = [
    ('hp',       '血量',   'pool', 8.0,   None, None,       True),
    ('atk',      '攻击力', 'pool', 1.0,   None, None,       True),
    # ★ 2026-10-22（用户要求）减伤上限 50% → 70%
    ('dr',       '减伤',   'vs',   0.5,   70.0, 'pen',      True),
    # ★ round474（用户："把移速的上限砍一半"）→ 60% → 30% ✓
    ('speed',    '移速',   'buff', 1.0,   30.0, None,       True),
    ('qi',       '灵气',   'pool', 2.0,   None, None,       True),
    ('crit',     '暴击',   'vs',   0.5,   30.0, 'anticrit', True),
    ('anticrit', '免爆',   'vs',   0.5,   None, None,       True),
    ('dodge',    '闪避',   'vs',   0.5,   30.0, 'hit',      True),
    ('hit',      '命中',   'vs',   0.5,   None, None,       True),
    ('critdmg',  '爆伤',   'buff', 1.0,   100.0, None,      True),
    # ★★★ round473（用户："增加抗爆属性，用来降低受到暴击的伤害，
    #   相当于闪避和命中这样的克制属性"）★★★
    #   对抗关系：他的【爆伤】− 我的【抗爆】 = 实际暴击伤害 ✓
    #   （和 命中↔闪避、免爆↔暴击率 完全同构 ✓）
    ('anticritdmg', '抗爆', 'vs', 0.5, None, 'critdmg', True),
    ('pen',      '穿透',   'vs',   0.5,   None, None,       True),
]

KEYS = [d[0] for d in DEFS]
BY_KEY = {d[0]: d for d in DEFS}
LIVE = [d[0] for d in DEFS if d[6]]          # ★ round411：11 个全部接进战斗了 ✓


def points_per_level():
    """每级发几点（方案 §3.1）"""
    return 3


def free_points(level, spent):
    """★ 免费点数 = 等级×3 − 已投入（方案 §3.2）

    ★ 为什么用推导而不是读 roles.talent_free：
      存一个能被推导出来的数，迟早会不一致 ✗
      （掉线重连 / 后台改级 / 手改数据库 → 立刻对不上 ✗）
    → 老号零迁移 ✓ 一进游戏就有 等级×3 点 ✓
    """
    try:
        lv = max(1, int(level or 1))
    except Exception:
        lv = 1
    try:
        used = sum(int(v or 0) for v in (spent or {}).values())
    except Exception:
        used = 0
    return max(0, lv * points_per_level() - used)


def raw_of(spent):
    """点 → 原始值（没经过对抗相减、没封顶 ✓ 方案 §4 第①步）"""
    out = {}
    for k, v in (spent or {}).items():
        d = BY_KEY.get(k)
        if not d:
            continue                       # ★ 未知 key 直接跳过 ✓ 不崩也不清库 ✓
        n = int(v or 0)
        if n > 0:
            out[k] = round(n * d[3], 2)
    return out


def effective(raw):
    """原始值 → 有效值（★ 只做【封顶】✗ 不做对抗相减 ✓）

    ★★★ round411（用户："属性界面要能看当前所有属性"）★★★
      病根：这里原来把【对抗方】的原始值从【自己】身上减掉了 ✗
        例：我自己点了 10 点减伤 + 10 点穿透
            → 减伤 = 5% − 穿透 5% = 0% ✓（自己把自己抵光 ✓✓）
        而"对抗"本来是【我和对面】之间的事 ✗ 不是自己跟自己 ✓
        表现：面板上投了 10 点减伤却显示 0.0%（一看就会说"没用"✓）
      ★ 修法：本函数只算"我的原始值 + 封顶" ✓
        对抗相减挪到【战斗时】✗ 那时两边都在手上 ✓
        · 我的暴击 − 他的免爆
        · 我的命中 − 他的闪避
        · 他的减伤 − 我的穿透
      ★ 打怪（PvE）没有对手天赋 ✗ 所以直接用封顶后的值 ✓（和以前一样 ✓）
    """
    e = dict(raw or {})
    # 对抗类：只封顶 ✓（相减交给战斗）
    for k, d in BY_KEY.items():
        if d[2] != 'vs' or k not in e:
            continue
        if d[4] is not None:
            e[k] = min(e[k], float(d[4]))
    # 增益类：只封顶 ✓
    for k, d in BY_KEY.items():
        if d[2] == 'buff' and k in e and d[4] is not None:
            e[k] = min(e[k], float(d[4]))
    return e


def pack_state(level, spent):
    """打包成给客户端的 talents 消息内容（方案 §7.2 字段级 ✓）"""
    spent = {k: int(v) for k, v in (spent or {}).items() if k in BY_KEY and int(v or 0) > 0}
    raw = raw_of(spent)
    return {
        'free': free_points(level, spent),
        'pts': spent,
        'raw': raw,
        'eff': effective(raw),
        'live': LIVE,
        'perLevel': points_per_level(),
    }
