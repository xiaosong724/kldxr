# -*- coding: utf-8 -*-
"""掉落品阶曲线 · 验收测试（第 130 轮，方案 docs/掉落方案.md §5）

★ 为什么单独写这个：品阶概率是【概率】✗ 肉眼看代码看不出对不对 ✓
  必须抽样统计 ✓ 而且必须【固定随机种子】✗ 否则断言会飘 ✓
  （这个项目里已经有过几次"测试偶发飘红"✗ 就是没固定种子 / 没留余量 ✓）
★ 跑法：python tools\test_drops.py
"""
import os
import sys
import random
import collections

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'server'))
import weapons as W                                    # noqa: E402

OK = [0]
BAD = [0]


def ok(cond, msg):
    if cond:
        OK[0] += 1
        print('  PASS  ' + msg)
    else:
        BAD[0] += 1
        print('  FAIL  ' + msg)


def sample(mob_lv, n, seed=20250101, killer_lv=None):
    """固定种子抽样 n 次，返回 {品阶(1..12): 件数}"""
    r = random.Random(seed)
    c = collections.Counter()
    for _ in range(n):
        c[W.roll_tier(mob_lv, killer_lv if killer_lv is not None else mob_lv, r) + 1] += 1
    return c


print('掉落品阶曲线验收（方案 §5）')
print('=' * 60)

# ① 1 级怪：1 阶必须占绝大多数（早期手感和以前几乎一样 ✓）
c = sample(1, 20000)
p1 = c.get(1, 0) / 20000 * 100
print('  1 级怪 20000 次：1 阶 %.2f%%  2 阶 %.2f%%  3 阶 %.2f%%' % (
    p1, c.get(2, 0) / 200, c.get(3, 0) / 200))
ok(p1 >= 95.0, '1 级怪的 1 阶占比 ≥95%%（实测 %.2f%% —— 早期手感和以前一样 ✓）' % p1)

# ② 1 级怪出 12 阶：概率极低，20 万次里应该是 0~3 件
c = sample(1, 200000)
ok(c.get(12, 0) <= 5,
   '★ 1 级怪 20 万次，12 阶出现 %d 件（预期 0~3 ✓ 上限 5 —— 保证"极低极低"✓）'
   % c.get(12, 0))

# ③ 120 级：12 阶应该落在 1.8%~2.2%
c = sample(120, 20000)
p12 = c.get(12, 0) / 20000 * 100
ok(1.8 <= p12 <= 2.2,
   '★ 120 级怪 12 阶 = %.2f%%（预期 2.00%% ✓ 用户定的上限 ✓）' % p12)

# ④ 饱和：200 级必须和 120 级【完全一样】
c120 = sample(120, 20000, seed=555)
c200 = sample(200, 20000, seed=555)
same = all(c120.get(t, 0) == c200.get(t, 0) for t in range(1, 13))
ok(same, '★ 200 级和 120 级分布【完全一致】（饱和 ✓ 再往上练也不会变多 ✓）')

# ⑤ 等级越低越陡：12 阶概率必须单调不降
prev = -1.0
mono = True
for lv in (1, 20, 40, 60, 80, 100, 120):
    p = sample(lv, 8000).get(12, 0) / 8000 * 100
    if p < prev - 0.02:
        mono = False
    prev = p
ok(mono, '★ 等级越高，12 阶概率单调不降（1→120 级 ✓）')

# ⑥ 防大号带小号：击杀者 10 级打 120 级怪，用的还是 30 级进度
a = W.tier_weights(120, 10)
b = W.tier_weights(30, 30)
ok(abs(a[11] - b[11]) < 1e-9,
   '★ 击杀者 10 级打 120 级怪 = 30 级进度（防大号带小号刷神装 ✓）')

# ⑦ 权重一定是 12 个、加起来是 1
w = W.tier_weights(60, 60)
ok(len(w) == 12 and abs(sum(w) - 1.0) < 1e-9,
   '权重 12 项且归一化（%d 项，和 = %.6f ✓）' % (len(w), sum(w)))

# ⑧ 12 阶永远 > 0（这是用户要求的核心：任何等级都有可能 ✓）
zero = [lv for lv in (1, 5, 10, 50, 100) if W.tier_weights(lv, lv)[11] <= 0]
ok(not zero, '★ 任何等级 12 阶概率都【严格大于 0】（用户要的"1 级也能出"✓）')

# ⑨ 装备总掉率没被碰坏（方案 §5 最后两条）
import drops                                            # noqa: E402
r = random.Random(1)
n_eq = sum(1 for _ in range(20000) if drops.roll_equip(45, 45, r))
p_eq = n_eq / 20000 * 100
ok(18.0 <= p_eq <= 28.0, '装备总掉率没变（45 级怪 %.1f%% ✓ 设计 24.7%% ✓）' % p_eq)

print('=' * 60)
print('%d 项通过 · %d 项失败' % (OK[0], BAD[0]))
sys.exit(1 if BAD[0] else 0)
