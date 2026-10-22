# -*- coding: utf-8 -*-
"""验收：防具掉落的品阶不再被材料表卡在 2 阶"""
import os, sys, random
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'server'))
import weapons, armor, drops

print('  武器 roll_tier 分布（怪 60 级 / 人 60 级）:')
c = {}
random.seed(1)
for _ in range(4000):
    t = weapons.roll_tier(60, 60)
    c[t] = c.get(t, 0) + 1
print('   ', dict(sorted(c.items())))

print('  防具（旧写法：材料品阶）最高能到: %d 阶' % max(t for _, t in drops.MATERIALS))

print('  防具（新写法：roll_tier）抽样:')
c2 = {}
random.seed(2)
for _ in range(2000):
    t = weapons.roll_tier(60, 60)
    a = armor.make_armor(t, 15)
    c2[a['tier']] = c2.get(a['tier'], 0) + 1
print('   ', dict(sorted(c2.items())))
mx = max(c2)
print('')
print('  最高品阶:', mx, '(1..12 阶 = 0..11)')
print('  PASS  能掉到 3 阶以上' if mx >= 3 else '  FAIL  还是卡在低阶')
print('  PASS  上限不超过 11' if mx <= 11 else '  FAIL  越界')
