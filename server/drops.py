# -*- coding: utf-8 -*-
"""掉落 —— P2 第二刀（方案 §8）

★ 这一刀只做【材料 / 灵气结晶】那一类（§8 表里"基础概率 60%~90%"的那行）：
  装备 / 技能书 / 稀有外观 都要先有 P3 的装备与技能内容，否则掉出来也没东西可给 ✗

公式照抄 §8.1，不自己编：
  ① 类别概率 = 基础概率 × (1 + min(僵尸等级, 击杀者等级 + 20) / 200)   → 高等级怪掉率略高，但有天花板
  ③ 品阶上限 = clamp(floor(僵尸等级 / 12), 0, 11)                      → 低级怪掉不出高阶货

**全部概率到身上**（§8 开头那句）：每次击杀独立 roll，roll 中才有 ✓
"""

import random

BASE_CHANCE = 0.75        # 材料基础掉率（§8 表给的 60%~90%，取中间）
CHANCE_CAP = 0.95         # 封顶 —— 总得留点"这次没掉"的悬念 ✓
DROP_TTL = 300.0          # 地上东西留 5 分钟（不清理的话服务器越积越多 ✗）
PICK_RANGE = 2.0          # 走这么近就自动捡（客户端先判一次为了手感，服务器再判一次为了防作弊 ✓）
LOOT_VIEW = 40.0          # 只把这么大范围内的地上物发给客户端（省带宽 ✓）
LOOT_SEND_CAP = 24        # 一条快照最多带几件

# 材料表：§8 那行的"材料 / 灵气结晶"，按品阶分档（名字贴末日 + 修仙的味道）
MATERIALS = (
    ('破布', 0), ('锈铁', 0), ('螺丝钉', 0), ('碎玻璃', 0), ('绷带', 0),
    ('灵气结晶', 1), ('兽骨', 1), ('电池', 1), ('生锈齿轮', 1),
    ('疫苗', 2), ('铜线卷', 2),
)


def max_tier(mob_lv):
    """§8.1 ③：这只怪最高能掉到几阶"""
    return max(0, min(11, int(mob_lv) // 12))


def drop_chance(mob_lv, killer_lv):
    """§8.1 ①：基础概率 × (1 + min(僵尸等级, 击杀者等级+20) / 200)"""
    z = min(int(mob_lv), int(killer_lv) + 20)
    return min(CHANCE_CAP, BASE_CHANCE * (1.0 + z / 200.0))


def roll_drop(mob_lv, killer_lv, rng=None):
    """给一次击杀 roll 掉落：返回 {'name','tier','kind'} 或 None（什么都没掉）"""
    r = rng or random
    if r.random() > drop_chance(mob_lv, killer_lv):
        return None
    cap = max_tier(mob_lv)
    pool = [m for m in MATERIALS if m[1] <= cap]
    if not pool:
        pool = [MATERIALS[0]]
    name, tier = r.choice(pool)
    return {'name': name, 'tier': tier, 'kind': 'material'}
