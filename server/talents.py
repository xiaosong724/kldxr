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
    ('dr',       '减伤',   'vs',   0.5,   50.0, 'pen',      True),
    ('speed',    '移速',   'buff', 1.0,   60.0, None,       True),
    ('qi',       '灵气',   'pool', 2.0,   None, None,       False),
    ('mana',     '法力',   'pool', 4.0,   None, None,       False),
    ('crit',     '暴击',   'vs',   0.5,   30.0, 'anticrit', False),
    ('anticrit', '免爆',   'vs',   0.5,   None, None,       False),
    ('dodge',    '闪避',   'vs',   0.5,   30.0, 'hit',      False),
    ('hit',      '命中',   'vs',   0.5,   None, None,       False),
    ('critdmg',  '爆伤',   'buff', 1.0,   100.0, None,      False),
    ('pen',      '穿透',   'vs',   0.5,   None, None,       False),
]

KEYS = [d[0] for d in DEFS]
BY_KEY = {d[0]: d for d in DEFS}
LIVE = [d[0] for d in DEFS if d[6]]          # v1 立刻生效的 6 个 ✓


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
    """原始值 → 有效值（对抗相减 + 封顶 ✓ 方案 §4 第②③步）

    ★ 顺序不能反 ✗ 先相减再封顶 ✓
      （先封顶的话"我 40% 对方命中 10%"会算成 30%−10%=20% ✗ 应该是 30% ✓）
    """
    e = dict(raw or {})
    for k, d in BY_KEY.items():
        if d[2] != 'vs' or k not in e:
            continue
        foe = d[5]
        if foe and foe in (raw or {}):
            e[k] = round(max(0.0, e[k] - float(raw[foe])), 2)
        if d[4] is not None:
            e[k] = min(e[k], float(d[4]))
    # 增益类只封顶 ✓ 不相减
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
