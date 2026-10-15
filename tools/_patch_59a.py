# -*- coding: utf-8 -*-
"""第 59 轮：武器机制（按品阶加成）+ 耐久上限

【用户三条】
  ① 触发概率和效果随品阶增强一点点 ✓
  ② 效果要写进文案（不然玩家不知道）✓
  ③ 加耐久度：高强度用 5 天损坏消失 · 耐久可见 ✓

【耐久怎么定的"5 天"】
   平均挥砍间隔 0.62 秒 → 一小时能挥 5806 次
   高强度 = 每天 4 小时 × 5 天 = 20 小时
   但战斗不会一直挥（跑位/捡东西/打空）→ 按 25% 的战斗占比算
   → 20h × 5806 × 25% ≈ 29,000 次
   → 顶阶（12 阶）定 28,000 次 ≈ 5 天高强度 ✓
   低阶按比例递减（低阶武器本来就是过渡的 ✓ 坏了就换 ✓）
"""
import io

P = 'server/weapons.py'
t = io.open(P, encoding='utf-8').read()

anchor = "def make_weapon(look, tier, coeff, item_lv=1, rng=None):"
assert t.count(anchor) == 1

block = '''# ================================================================ 武器机制（第 59 轮）
#   ★ 用户要求：触发概率和效果【随品阶增强一点点】✓
#   ★ 每一项都要能写进文案（不然玩家不知道 ✓）
#
#   格式：look -> (效果名, 触发率基准, 触发率每阶, 效果值基准, 效果值每阶, 文案模板)
#     ——  概率上限 75%（别变成必定 ✗）；效果值的上限由各自的效果决定 ✓
#
#   ★ 三条设计原则（第 58 轮定的）：
#     ① 能被【连续施加】的效果必须"概率 + 免疫窗口"（眩晕/击退/流血 ✓）
#     ② 场合本身就是门槛的可以必定触发（背击/溅射 ✓）
#     ③ 期望收益算进 DPS 预算，不偷偷超模 ✓
WEAPON_FX = {
    'dagger': ('背击',   1.00, 0.00, 0.25, 0.015, '背后攻击 +{v}% 伤害'),
    'sword':  ('招架',   0.10, 0.010, 0.50, 0.000, '{p}% 概率招架 · 受到伤害减半'),
    'saber':  ('流血',   0.35, 0.020, 0.25, 0.015, '{p}% 概率流血 · 3 秒共 {v}% 武器伤害'),
    'staff':  ('击退',   0.30, 0.020, 1.00, 0.050, '{p}% 概率推开 {v} 米'),
    'spear':  ('贯穿',   0.45, 0.020, 2,    0.000, '{p}% 概率贯穿 · 最多打中 {v} 个'),
    'axe':    ('溅射',   1.00, 0.000, 0.35, 0.020, '命中时溅射 1.5 米内最多 2 个 · 各 {v}% 伤害'),
    'hammer': ('眩晕',   0.20, 0.015, 0.40, 0.020, '{p}% 概率眩晕 {v} 秒（同一只 3 秒免疫）'),
}

FX_MAX_CHANCE = 0.75          # 触发率上限（再高就变必定了 ✗）
STUN_IMMUNE = 3.0             # 眩晕免疫窗口（秒）—— 防"无限锁死" ✓
KNOCK_IMMUNE = 1.5            # 击退免疫窗口（秒）—— 防"永久风筝" ✓
BLEED_TIME = 3.0              # 流血持续（秒）
SPLASH_R = 1.5                # 溅射半径（米）
SPLASH_MAX = 2                # 溅射最多几个


def fx_of(look, tier):
    """取某把武器的机制数值（按品阶加成 ✓）

    返回 dict：name / chance(0~1) / value / text(写进文案的字符串 ✓)
    没有机制的武器（弓）返回 None ✓
    """
    fx = WEAPON_FX.get(look)
    if not fx:
        return None
    t = max(0, min(11, int(tier)))
    name, cb, ci, vb, vi, tpl = fx
    chance = min(FX_MAX_CHANCE, cb + ci * t)
    value = vb + vi * t
    # 百分比类的取整（0.25 → 25），整数类（2 个、秒）保留原样 ✓
    vshow = value
    if vb < 1.0 and vi < 1.0:
        vshow = round(value * 100)
    else:
        vshow = round(value, 1) if (value % 1) else int(value)
    pshow = round(chance * 100)
    return {'name': name, 'chance': chance, 'value': value, 'tier': t,
            'text': tpl.format(p=pshow, v=vshow),
            'pct': pshow, 'vshow': vshow}


# ================================================================ 耐久（第 59 轮）
#   ★ 用户要求：高强度用 5 天损坏消失、耐久可见 ✓
#   ★ 每次【挥砍】扣 1 点（打空也算 ✓ 更真实）→ 归零武器消失 ✓
DUR_MAX = (800, 1200, 1800, 2600, 3600, 5000, 6800, 9000, 12000, 16000, 21000, 28000)


def dur_max_of(tier):
    """按品阶的耐久上限（第 59 轮 ✓）"""
    return DUR_MAX[max(0, min(11, int(tier)))]


def make_weapon(look, tier, coeff, item_lv=1, rng=None):'''

t = t.replace(anchor, block, 1)

# make_weapon 里带上 dur / durMax
a2 = "        'reqLevel': req_level_of(t),              # ★ 第 56 轮：改成平缓曲线（见 req_level_of）"
b2 = """        'reqLevel': req_level_of(t),              # ★ 第 56 轮：改成平缓曲线（见 req_level_of）
        # ★ 第 59 轮：耐久（写进物品 JSON ✓ 每次挥砍扣 1 ✓ 归零消失）
        'dur': dur_max_of(t), 'durMax': dur_max_of(t),"""
assert t.count(a2) == 1, ('make_weapon', t.count(a2))
t = t.replace(a2, b2)

# 空手没有机制、也没有耐久
a3 = "    'flat0': True,          # ★ 标记：这件东西【没有】平伤那一份（只有空手有 ✓）"
b3 = """    'flat0': True,          # ★ 标记：这件东西【没有】平伤那一份（只有空手有 ✓）
    'dur': 0, 'durMax': 0,  # ★ 空手没有耐久（不会坏 ✓）"""
assert t.count(a3) == 1, ('fist', t.count(a3))
t = t.replace(a3, b3)

io.open(P, 'w', encoding='utf-8', newline='\n').write(t)
print('  OK weapons.py：WEAPON_FX + DUR_MAX + make_weapon 带耐久')
