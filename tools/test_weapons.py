# -*- coding: utf-8 -*-
"""离线单测：武器系统（server/weapons.py）

为什么要有：武器系统把三个【以前写死的常量】换成了"看手上那把"——
  攻击力（§7.5）、攻击间隔（§5.1）、射程/攻击弧（§7.4）
写死的常量错了没人知道 ✗ 所以这几条必须有测试盯着 ✓

跑法：python tools\\test_weapons.py
"""
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'server'))
import weapons as W          # noqa: E402

fails = []


def ok(cond, msg, got=None):
    if cond:
        print('  PASS  ' + msg)
    else:
        fails.append(msg)
        print('  FAIL  ' + msg + ('   got=%r' % (got,)))


print('== ① 类型表：和方案 §7.4 一个字不差 ==')
# 方案 §7.4 那张表（S, 系数下限, 系数上限, 射程, 攻击弧）
SPEC = {
    'dagger': (1.45, 0.66, 0.78, 1.8, 1.20),
    'sword':  (1.15, 0.92, 1.08, 2.4, 1.05),
    'saber':  (1.20, 0.87, 1.03, 2.3, 1.15),
    'staff':  (1.05, 0.94, 1.10, 2.9, 1.00),
    'spear':  (1.00, 0.97, 1.13, 3.6, 0.70),
    'axe':    (0.75, 1.33, 1.57, 3.0, 1.55),
    'hammer': (0.72, 1.47, 1.73, 2.8, 1.30),
    'bow':    (0.85, 0.54, 0.66, 14.0, 0.0),
}
ok(set(W.TYPES) == set(SPEC), '八个类型都在（实测 %d 个）' % len(W.TYPES), sorted(W.TYPES))
for k, sp in SPEC.items():
    got = W.TYPES.get(k)
    same = got and (abs(got[0] - sp[0]) < 1e-9 and abs(got[1] - sp[1]) < 1e-9
                    and abs(got[2] - sp[2]) < 1e-9 and abs(got[3] - sp[3]) < 1e-9
                    and abs(got[4] - sp[4]) < 1e-9)
    ok(same, '%-7s S=%.2f 系数 %.2f~%.2f 射程 %.1f 弧 %.2f（和方案一致 ✓）'
       % (k, sp[0], sp[1], sp[2], sp[3], sp[4]), got)

print('')
print('== ② 默认武器 = 单手剑（手感不能变）==')
ok(W.DEFAULT_TYPE == 'sword', '默认类型是单手剑 ✓')
# ★ 这两条是【回归护栏】：以前射程/攻击弧是写死的 2.4 / 1.05
#   默认武器必须给出一模一样的值，不然"没武器的人"手感会变 ✗
ok(abs(W.reach_of(W.DEFAULT_TYPE) - 2.4) < 1e-9, '默认射程还是 2.4 米（和以前写死的一样 ✓）')
ok(abs(W.arc_of(W.DEFAULT_TYPE) - 1.05) < 1e-9, '默认攻击弧还是 1.05 弧度（正前方 120° ✓）')
print('       [说明] 间隔从 0.62 变成 %.3f 秒 —— 因为单手剑的 S=1.15（表里就是这么定的 ✓）'
      % W.interval_of('sword'))
print('              也就是默认攻速快了 15%%，射程/弧完全没动 ✓')

print('')
print('== ③ 攻速换算（方案 §5.1）==')
ok(abs(W.interval_of('dagger') - 0.62 / 1.45) < 1e-9,
   '匕首最快：间隔 %.3f 秒（S=1.45）' % W.interval_of('dagger'))
ok(abs(W.interval_of('hammer') - 0.62 / 0.72) < 1e-9,
   '锤最慢：间隔 %.3f 秒（S=0.72）' % W.interval_of('hammer'))
ok(W.interval_of('dagger') < W.interval_of(W.DEFAULT_TYPE) < W.interval_of('hammer'),
   '快慢顺序对：匕首 < 剑 < 锤 ✓')
ok(abs(W.windup_of('sword') - 0.45 / 1.15) < 1e-9,
   '起手 = 0.45/S（单手剑 %.3f 秒 ✓）' % W.windup_of('sword'))
ok(W.S_MIN <= W.speed_of('hammer') and W.speed_of('dagger') <= W.S_MAX,
   '攻速都被夹在 [%.1f, %.1f] 里（防"一秒十刀" ✓）' % (W.S_MIN, W.S_MAX))

print('')
print('== ④ ★★ 滚完再夹（方案 §7.4 那条硬约束）★★ ==')
rng = random.Random(20261015)
melee = [k for k in W.TYPES if k not in W.RANGED]
oob = 0
lo, hi = 9.0, 0.0
for _ in range(6000):
    k = rng.choice(melee)
    c = W.roll_coeff(k, rng)
    p = W.speed_of(k) * c
    lo = min(lo, p)
    hi = max(hi, p)
    if not (W.CLAMP_LO - 1e-9 <= p <= W.CLAMP_HI + 1e-9):
        oob += 1
ok(oob == 0, '★ 6000 次掷骰，S×系数 一次都没越界（实测范围 %.3f~%.3f，夹子 %.2f~%.2f）'
   % (lo, hi, W.CLAMP_LO, W.CLAMP_HI), oob)
ok(lo >= W.CLAMP_LO - 1e-9 and hi <= W.CLAMP_HI + 1e-9, '★ 而且真的贴到了上下界（说明夹子在工作 ✓）')
# 反例：把夹子关掉，越界必然出现 —— 证明上面那条不是"区间本来就窄"
raw_oob = 0
for _ in range(3000):
    k = rng.choice(melee)
    _s, a, b = W.TYPES[k][0], W.TYPES[k][1], W.TYPES[k][2]
    c = a + rng.random() * (b - a)
    p = W.speed_of(k) * c
    if not (W.CLAMP_LO <= p <= W.CLAMP_HI):
        raw_oob += 1
ok(raw_oob > 0, '（对照）不夹的话 3000 次里有 %d 次越界 —— 所以夹子是必要的 ✓' % raw_oob)
# 远程豁免
bow_c = [W.roll_coeff('bow', rng) for _ in range(50)]
ok(max(bow_c) <= 0.66 + 1e-9 and min(bow_c) >= 0.54 - 1e-9,
   '★ 弓不受夹子影响（还在 0.54~0.66 区间里 ✓ 它走自己那条平衡线 §7.4）')

print('')
print('== ⑤ ★ 装备贡献封顶 60%（方案 §7.5）==')
inh = 13.08
worst = 0.0
for _ in range(2000):
    k = rng.choice(melee)
    c = W.roll_coeff(k, rng)
    t = rng.randint(0, 11)
    tot = W.player_atk_with(inh, k, c, t, 1)
    share = (tot - inh) / tot
    worst = max(worst, share)
ok(worst <= 0.60 + 1e-6,
   '★★ 2000 次随机搭配，装备最多只占总伤害的 %.1f%%（上限 60%% ✓）' % (worst * 100), worst)
ok(worst > 0.55, '★ 而且真的用到了接近上限（说明封顶线是"紧"的，不是虚设 ✓）')
# ★ 公式是【固有 × 系数 + 平伤】，不是 固有 + (固有×系数 + 平伤) ✗（这里踩过）
_dflt = W.player_atk_with(inh, 'sword', 1.0, 0, 1)
ok(abs(_dflt - (inh * 1.0 + W.flat_of(0, 1))) < 1e-6,
   '★ 默认单手剑 = 固有×1.0 + 平伤 = %.2f（不是 固有×2 ✓ 踩过这个坑）' % _dflt, _dflt)
ok(_dflt > inh, '装上武器总是比不装强（%.2f → %.2f ✓）' % (inh, _dflt))
a0 = W.player_atk_with(inh, 'sword', 1.0, 0, 1)
a9 = W.player_atk_with(inh, 'sword', 1.0, 9, 1)
a11 = W.player_atk_with(inh, 'sword', 1.0, 11, 1)
ok(a9 >= a0, '品阶越高伤害越高（0 阶 %.1f → 9 阶 %.1f ✓）' % (a0, a9))
ok(abs(a11 - inh * 2.5) < 1e-6, '★ 11 阶直接顶到封顶线（%.1f = 固有 × 2.5 ✓）' % a11)

print('')
print('== ⑥ 造出来的东西长什么样（方案 §7.1 的接口）==')
w = W.make_weapon('axe', 6, 1.45, 10)
ok(w['slot'] == 'weapon' and w['look'] == 'axe' and w['tier'] == 6, 'slot/look/tier 对 ✓', w)
ok('coeff' in w['base'] and 'atkSpeed' in w['base'] and 'reach' in w['base'] and 'arc' in w['base'],
   'base 里带着系数/攻速/射程/弧（客户端和服务器都要用 ✓）', w['base'])
ok(isinstance(w['affixes'], list) and not w['affixes'],
   '词条这一期是【空数组】（§7.11 定义了 22 条，但"掉出来带词条"是下一刀 ✓）')
ok(w['reqLevel'] == 37, '等级门槛 reqLevel = (阶+1)×6-5（6 阶 → 37 级 ✓）', w['reqLevel'])
ok(w['name'] == W.TIER_NAME[6] + '双手斧', '名字 = 品阶名 + 类型名（%s ✓）' % w['name'])

# roll_weapon 的品阶不能超过怪等级给的台阶（§8.1 ③ 同一套）
import drops as D            # noqa: E402
bad = 0
for _ in range(400):
    w2 = W.roll_weapon(5, 1, rng)          # Lv.5 的怪 → 最高 0 阶
    if w2['tier'] > D.max_tier(5):
        bad += 1
ok(bad == 0, '★ 低级怪掉不出高阶武器（400 次里 0 次越界 ✓ 和材料共用 §8.1 ③ 那条 ✓）', bad)
ok(all(W.roll_weapon(999, 1, rng)['look'] in W.TYPES for _ in range(50)), '掉出来的 look 都是合法类型 ✓')

print('')
print('== ⑦ ★ 武器伤害（第 51 轮：显示用的，不掺玩家等级）==')
# ★ 这条和 tools/test_browser.js 里那条【必须一致】——
#   两边各写一遍是有意的：客户端和服务器算的不一样时，两边测试总有一个会红 ✓
_w = W.make_weapon('axe', 5, 1.45, 8)
ok(abs(W.weapon_damage(_w) - 196) < 0.5,
   '★ 5 阶双手斧/物品 8 级 → 武器伤害 %.0f（客户端那边钉的是同一个数 ✓）' % W.weapon_damage(_w),
   W.weapon_damage(_w))
ok(abs(W.crit_damage(_w) - 294) < 1.0, '★ 暴击 = 武器伤害 × 1.5（%.0f ✓）' % W.crit_damage(_w))
ok(abs(W.BASE_INTERVAL / W.speed_of('axe') - 0.827) < 0.001, '★ 间隔 0.827 秒 ✓')
ok(_w.get('itemLv') == 8, '★★ 物品等级【落在物品上】（itemLv=%s ✓ 不是玩家等级）' % _w.get('itemLv'))
# 同一把武器在不同玩家等级下算出来必须一样（这就是"方便比武器" ✓）
_d1 = W.player_atk_with(13.08, 'axe', 1.45, 5, _w['itemLv'])
_d2 = W.player_atk_with(360.0, 'axe', 1.45, 5, _w['itemLv'])
ok(abs(W.weapon_damage(_w) - W.weapon_damage(_w)) < 1e-9 and _d1 != _d2,
   '★ 武器伤害不受玩家等级影响（%.0f），而真正结算的总攻击会（Lv.1 %.1f / Lv.50 %.1f ✓）'
   % (W.weapon_damage(_w), _d1, _d2))
print('')
if fails:
    print('FAILED: %d 条 ✗' % len(fails))
    for f in fails:
        print('  - ' + f)
    sys.exit(1)
print('ALL PASS ✓')
