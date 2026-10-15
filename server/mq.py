# -*- coding: utf-8 -*-
"""魔气值 · 规则中心（第 149 轮，方案 docs/魔气与PVP夺取方案.md）

★ 为什么单独一个模块：
   魔气的数值散在好几处（击杀 +2 / 被杀 -1 / 每小时 -1 / 伤害加成 / 夺取概率 /
   经验比例 / 物品 1% / 反夺取对比 ✓）
   → 全部收在这里 ✗ 别处只调函数 ✓
   ★ 第 148 轮用户逐条确认过这些数 ✓ 要改先改这里 ✓ 顺便改百科 ✓

★ 线程纪律：这个模块【只算，不碰库、不碰世界】✓
   谁调用谁负责落库（tick 线程走 post_save ✓ 网络线程走 db ✓）
"""

# ---------------- 增减 ----------------
KILL_GAIN = 2          # 击杀一名玩家 +2（用户确认 ✓）
KILLED_LOSS = 1        # 被玩家击杀 -1（用户确认 ✓）
DECAY_PER_HOUR = 1     # 自然衰减 每小时 -1（用户确认 ✓ 离线也算 ✓）
MQ_MAX = 9999          # 数值上限（防溢出 ✓ 用户说"不设击杀上限"✓ 这里只是数值上限 ✓）

# ---------------- 收益 ----------------
DMG_PER_POINT = 1.0     # 每 1 点 → +1% 伤害
DMG_CAP = 50.0          # 伤害加成上限 +50%
STEAL_BASE = 5.0        # 夺取基础概率 5%
STEAL_PER_2 = 0.2       # 每 2 点 +0.2%
STEAL_CAP = 15.0        # 夺取概率上限 15%
WORN_STEAL_PCT = 1.0    # ★ 穿戴中的装备被夺走的概率（用户确认：1% ✓ 耐久保留 ✓）
GOLD_LOSS = 100         # ★ 对方没经验时改扣的金币（用户确认 ✓ 金币系统还没做 ✗ 先留着）

# 夺取经验的比例（★ 看【夺取方自己】的魔气 ✓ 用户确认 ✓）
#   [0,100) 5% · [100,200) 8% · [200,500] 10% · (500,∞) 15%
#   ★ 边界按用户原话"大于 500"→ 500 整算 10% 档 ✓
#   ★ 边界注意：用户原话是"大于 500"→ 所以【501 起】才是 15% 档 ✓
#     500 整算 10% ✓（我第一版写成 500 ✗ 和方案不一致 ✓ 已改 ✓）
EXP_TIERS = ((501, 0.15), (200, 0.10), (100, 0.08), (0, 0.05))

# ---------------- 防刷（用户确认：不设击杀上限 ✗ 靠这几条 ✓）----------------
PAIR_COOLDOWN = 600.0   # ★ 同一对玩家 10 分钟只算一次（最关键的一条 ✓）
LEVEL_GAP_MAX = 20      # 等级差 > 20 不算
SAFE_R = 20.0           # 出生点安全区半径内不夺取（和 SPAWN_SAFE 一致 ✓）


# ================================================================
#  ★★ 第 153 轮：可调配置（管理页里能改，改完立刻生效）★★
#    ★ 为什么用字典而不是直接改模块常量：
#      常量被下面这些函数直接读 ✓ 想改就得重启 ✗
#      字典可以在运行时替换 ✓ 而且【默认值就是上面那些常量】✓
#         → 没改过的时候行为和以前完全一样 ✓
#    ★ 重启会回到默认 ✗ 这是有意的：调平衡是临时的 ✗
#      真定下来就改上面的默认值（那样重启也在 ✓）
# ================================================================
TUNE = {
    'kill_gain': KILL_GAIN, 'killed_loss': KILLED_LOSS, 'decay_per_hour': DECAY_PER_HOUR,
    'mq_max': MQ_MAX,
    'dmg_per_point': DMG_PER_POINT, 'dmg_cap': DMG_CAP,
    'steal_base': STEAL_BASE, 'steal_per_2': STEAL_PER_2, 'steal_cap': STEAL_CAP,
    'worn_steal_pct': WORN_STEAL_PCT, 'gold_loss': GOLD_LOSS,
    'pair_cooldown': PAIR_COOLDOWN, 'level_gap_max': LEVEL_GAP_MAX, 'safe_r': SAFE_R,
    # ★ 经验四档：门槛 → 比例（从高到低 ✓ 第一个满足的生效 ✓）
    'exp_tiers': [[501, 0.15], [200, 0.10], [100, 0.08], [0, 0.05]],
}

# 管理页要显示的中文说明（改配置时照着看 ✓ 不用翻代码 ✓）
TUNE_DOC = [
    ('kill_gain', '击杀一名玩家 +几点魔气', 'int', 0, 100),
    ('killed_loss', '被击杀（玩家或僵尸）−几点魔气', 'int', 0, 100),
    ('decay_per_hour', '自然衰减：每小时 −几点', 'int', 0, 100),
    ('mq_max', '魔气数值上限', 'int', 1, 999999),
    ('dmg_per_point', '每 1 点魔气 +%伤害', 'float', 0, 100),
    ('dmg_cap', '伤害加成上限 %', 'float', 0, 1000),
    ('steal_base', '夺取基础概率 %', 'float', 0, 100),
    ('steal_per_2', '每 2 点魔气 +%概率', 'float', 0, 100),
    ('steal_cap', '夺取概率上限 %', 'float', 0, 100),
    ('worn_steal_pct', '穿戴中的装备被夺概率 %', 'float', 0, 100),
    ('gold_loss', '对方没经验时扣多少金币（金币系统还没做）', 'int', 0, 999999),
    ('pair_cooldown', '同一对玩家冷却（秒）', 'float', 0, 86400),
    ('level_gap_max', '等级差超过多少不算', 'int', 0, 999),
    ('safe_r', '安全区半径（米）', 'float', 0, 1000),
]


def cfg(k, dflt=None):
    """取一个可调值（管理页改过就用改的 ✓）"""
    try:
        return TUNE.get(k, dflt)
    except Exception:
        return dflt


def _doc_of(k):
    for kk, doc, kind, lo, hi in TUNE_DOC:
        if kk == k:
            return doc, kind, lo, hi
    return None, None, None, None


def apply_tune(src):
    """把一份配置套进去（校验 + 夹范围 ✓ 未知键忽略 ✓）

    ★ 返回 (套用了几项, 报错说明) ✗ 不抛异常 ✓
      （管理页传错东西不该把服务器带崩 ✓）
    """
    n = 0
    bad = []
    if not isinstance(src, dict):
        return 0, 'not a dict'
    for k, v in src.items():
        if k == 'exp_tiers':
            try:
                tiers = [[int(a), float(b)] for a, b in v]
                TUNE['exp_tiers'] = tiers
                n += 1
            except Exception:
                bad.append(k)
            continue
        doc, kind, lo, hi = _doc_of(k)
        if doc is None:
            continue                       # 未知键：忽略 ✓（以后删过配置也不会炸 ✓）
        try:
            val = float(v) if kind == 'float' else int(float(v))
        except Exception:
            bad.append(k)
            continue
        val = max(lo, min(hi, val))
        TUNE[k] = val
        n += 1
    return n, (','.join(bad) if bad else '')


def changed_tune():
    """只挑【和默认不一样】的项（存库用 ✓ 默认值不存 ✓）

    ★ 为什么：以后改默认值，老库里的配置不会把新默认"顶回去"✗
      （存全量的话，我改了默认值、老库还存着旧默认 ✓ 就永远生效不了 ✓）
    """
    dflt = {
        'kill_gain': KILL_GAIN, 'killed_loss': KILLED_LOSS, 'decay_per_hour': DECAY_PER_HOUR,
        'mq_max': MQ_MAX, 'dmg_per_point': DMG_PER_POINT, 'dmg_cap': DMG_CAP,
        'steal_base': STEAL_BASE, 'steal_per_2': STEAL_PER_2, 'steal_cap': STEAL_CAP,
        'worn_steal_pct': WORN_STEAL_PCT, 'gold_loss': GOLD_LOSS,
        'pair_cooldown': PAIR_COOLDOWN, 'level_gap_max': LEVEL_GAP_MAX, 'safe_r': SAFE_R,
        'exp_tiers': [[501, 0.15], [200, 0.10], [100, 0.08], [0, 0.05]],
    }
    out = {}
    for k, dv in dflt.items():
        cv = TUNE.get(k)
        if cv is None:
            continue
        if isinstance(dv, float):
            if abs(float(cv) - dv) > 1e-9:
                out[k] = cv
        else:
            if cv != dv:
                out[k] = cv
    return out


def reset_tune():
    """恢复默认（管理页的"恢复默认"按钮 ✓）"""
    TUNE.update({
        'kill_gain': KILL_GAIN, 'killed_loss': KILLED_LOSS, 'decay_per_hour': DECAY_PER_HOUR,
        'mq_max': MQ_MAX,
        'dmg_per_point': DMG_PER_POINT, 'dmg_cap': DMG_CAP,
        'steal_base': STEAL_BASE, 'steal_per_2': STEAL_PER_2, 'steal_cap': STEAL_CAP,
        'worn_steal_pct': WORN_STEAL_PCT, 'gold_loss': GOLD_LOSS,
        'pair_cooldown': PAIR_COOLDOWN, 'level_gap_max': LEVEL_GAP_MAX, 'safe_r': SAFE_R,
        'exp_tiers': [[501, 0.15], [200, 0.10], [100, 0.08], [0, 0.05]],
    })
    return dict(TUNE)


def settle(mq, last_ts, now_ts):
    """按"上次结算时刻"现算自然衰减（第 1 步核心 ✓）

    ★ 为什么不用定时器（方案 §2.1）：
      玩家离线时也要衰减 ✓ 而离线的不在内存里 ✗ 服务器重启定时器还会丢 ✗
      → 记时间戳、用的时候现算 ✓ 离线 10 小时回来自动掉 10 点 ✓

    返回 (新的魔气值, 新的上次结算时刻)
    """
    try:
        mq = int(mq or 0)
    except Exception:
        mq = 0
    try:
        last_ts = int(last_ts or 0)
    except Exception:
        last_ts = 0
    now_ts = int(now_ts or 0)
    if last_ts <= 0 or now_ts <= last_ts:
        return max(0, min(int(cfg('mq_max', MQ_MAX)), mq)), (now_ts or last_ts)
    hours = int((now_ts - last_ts) // 3600000)          # 毫秒 → 整小时
    if hours > 0:
        mq = max(0, mq - hours * int(cfg('decay_per_hour', DECAY_PER_HOUR)))
        last_ts = last_ts + hours * 3600000             # ★ 把已结算的时间消费掉 ✓
    return max(0, min(int(cfg('mq_max', MQ_MAX)), mq)), last_ts


def dmg_bonus_pct(mq):
    """魔气 → 伤害加成百分比（1 点 = +1%，上限 +50% ✓）"""
    try:
        mq = int(mq or 0)
    except Exception:
        mq = 0
    return min(float(cfg('dmg_cap', DMG_CAP)),
               max(0.0, mq * float(cfg('dmg_per_point', DMG_PER_POINT))))


def steal_chance(mq):
    """魔气 → 夺取概率百分比（基础 5%，每 2 点 +0.2%，上限 15% ✓）"""
    try:
        mq = int(mq or 0)
    except Exception:
        mq = 0
    return min(float(cfg('steal_cap', STEAL_CAP)),
               float(cfg('steal_base', STEAL_BASE)) +
               (mq / 2.0) * float(cfg('steal_per_2', STEAL_PER_2)))


def steal_exp_pct(mq):
    """魔气 → 夺取经验的比例（看夺取方自己的魔气 ✓）"""
    try:
        mq = int(mq or 0)
    except Exception:
        mq = 0
    for th, pct in (cfg('exp_tiers') or EXP_TIERS):
        if mq >= th:
            return pct
    return 0.05


def pick_stealer(mq_killer, mq_victim):
    """★ 反夺取：谁魔气高用谁的概率（方案 §6 · 用户确认 ✓）

    返回 (谁夺, 用哪个概率)
      'killer' = 击杀方夺被击杀方 ✓
      'victim' = ★ 被击杀方反过来夺击杀方 ✓
    ★ 平手（含两边都是 0）→ 按击杀方 ✓（进攻方优先 ✓ 用户确认 ✓）
    ★ 只掷一次骰子 ✗ 不是两边各掷 ✓
    """
    pk = steal_chance(mq_killer)
    pv = steal_chance(mq_victim)
    if pv > pk:
        return 'victim', pv
    return 'killer', pk


def label(mq):
    """头顶显示用的档位（颜色由前端定 ✓ 这里只给档位名 ✓ 方便日志/排障 ✓）"""
    mq = int(mq or 0)
    if mq <= 0:
        return ''
    if mq < 50:
        return 'light'
    if mq < 100:
        return 'normal'
    if mq < 200:
        return 'deep'
    if mq < 500:
        return 'dark'
    return 'blood'
