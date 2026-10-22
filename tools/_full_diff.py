# -*- coding: utf-8 -*-
"""全面对比：世界里存在的东西 vs 放置目录里能买到的东西。"""
import os, sys
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))
import db as dbmod
import town

cfg = {'db': os.path.join(os.path.dirname(__file__), '..', 'server', 'game.db')}

# 1) 世界里的 props
prop_kinds = Counter(p['k'] for p in town.PROPS)
# 2) 世界里的 seats
seat_kinds = Counter(s.get('k', '') for s in town.SEATS)
# 3) 世界里的 teleports
tp_n = len(town.TELEPORTS)
# 4) 世界里的建筑种类
b_kinds = Counter(b['k'] for b in town.BUILDINGS)

with dbmod.db(cfg) as c:
    cat = {r[0]: {'cat': r[1], 'model': r[2]} for r in c.execute(
        "SELECT id,category,model_id FROM town_catalog WHERE enabled=1").fetchall()}
    obj_b = Counter(r[0] for r in c.execute(
        "SELECT catalog_id FROM town_objects WHERE state='active' AND parent_id=0").fetchall())

print('=== 世界里 props（%d 个实例 / %d 种）===' % (sum(prop_kinds.values()), len(prop_kinds)))
map_ok, map_missing = [], []
for k, n in prop_kinds.most_common():
    cid = 'prop_' + k
    # 部分 id 名不同
    alias = {'bikerack': 'prop_bikerack', 'bike_rack': 'prop_bikerack',
             'flowerstand': 'prop_flowerstand', 'planter': 'prop_planter',
             'lantern': 'prop_lantern', 'postbox': 'prop_postbox'}
    cid = alias.get(k, cid)
    if cid in cat:
        map_ok.append(k)
    else:
        map_missing.append((k, n))
print('  可放置（已进目录）:', len(map_ok), map_ok)
print('  ❌ 不能放置:', map_missing if map_missing else '无')

print()
print('=== 世界里 seats（%d 个 / %d 种）===' % (sum(seat_kinds.values()), len(seat_kinds)))
for k, n in seat_kinds.most_common():
    print('   %-8s %d' % (k, n))

print()
print('=== 世界里 teleports: %d 个 ===' % tp_n)
print(' 目录里 function:', [i for i, v in cat.items() if v['cat'] == 'function'])

print()
print('=== 建筑：世界 %d 种，目录 %d 个，对象 %d 个 ===' % (len(b_kinds), len([1 for v in cat.values() if v['cat'] == 'building']), len(obj_b)))
for k, n in sorted(obj_b.items()):
    print('   %-24s %d' % (k, n))
