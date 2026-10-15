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
        return max(0, min(MQ_MAX, mq)), (now_ts or last_ts)
    hours = int((now_ts - last_ts) // 3600000)          # 毫秒 → 整小时
    if hours > 0:
        mq = max(0, mq - hours * DECAY_PER_HOUR)
        last_ts = last_ts + hours * 3600000             # ★ 把已结算的时间消费掉 ✓
    return max(0, min(MQ_MAX, mq)), last_ts


def dmg_bonus_pct(mq):
    """魔气 → 伤害加成百分比（1 点 = +1%，上限 +50% ✓）"""
    try:
        mq = int(mq or 0)
    except Exception:
        mq = 0
    return min(DMG_CAP, max(0.0, mq * DMG_PER_POINT))


def steal_chance(mq):
    """魔气 → 夺取概率百分比（基础 5%，每 2 点 +0.2%，上限 15% ✓）"""
    try:
        mq = int(mq or 0)
    except Exception:
        mq = 0
    return min(STEAL_CAP, STEAL_BASE + (mq / 2.0) * STEAL_PER_2)


def steal_exp_pct(mq):
    """魔气 → 夺取经验的比例（看夺取方自己的魔气 ✓）"""
    try:
        mq = int(mq or 0)
    except Exception:
        mq = 0
    for th, pct in EXP_TIERS:
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
