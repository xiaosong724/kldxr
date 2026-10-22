# -*- coding: utf-8 -*-
"""写入目录，并把主城 6 个旧建筑替换成新模型。"""
import os, sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))
import db as dbmod
import towns
import town_objects as obj

cfg = {'db': os.path.join(os.path.dirname(__file__), '..', 'server', 'game.db')}
towns.seed_catalog(cfg)
print('catalog seeded')

town = [r for r in towns.list_towns(cfg) if int(r['is_system']) == 1][0]
PAIRS = {
    'apartment': 'shop_apartment_v1',
    'inn': 'shop_inn_v1',
    'bathhouse': 'shop_bathhouse_v1',
    'tea': 'shop_tea_v1',
    'dessert': 'shop_dessert_v1',
    'koban': 'shop_koban_v1',
}

with dbmod.db(cfg) as c:
    objs = {r[1]: (r[0], r[2], r[3], r[4]) for r in c.execute(
        "SELECT id,catalog_id,x,z,rot FROM town_objects WHERE state='active' AND parent_id=0")}

for key, new in PAIRS.items():
    cid = 'legacy_' + key
    if cid not in objs:
        print(key, '无对象')
        continue
    oid, x, z, rot = objs[cid]
    ok, err = obj.replace_with_model(cfg, town, oid, new)
    if ok:
        print('%-10s -> %-22s OK  at (%.1f, %.1f)' % (key, new, x, z))
    else:
        print('%-10s 失败: %s' % (key, err))

with dbmod.db(cfg) as c:
    n = c.execute("SELECT COUNT(*) FROM town_objects WHERE state='active' AND catalog_id LIKE 'legacy_%'").fetchone()[0]
    t = c.execute("SELECT COUNT(*) FROM town_objects WHERE state='active'").fetchone()[0]
    f = c.execute("SELECT COUNT(*) FROM town_objects WHERE state='active' AND parent_id<>0").fetchone()[0]
    print('剩余 legacy:', n, '| 对象总数:', t, '| 家具:', f)
    rows = c.execute("SELECT catalog_id FROM town_objects WHERE state='active' AND catalog_id LIKE 'legacy_%'").fetchall()
    print('仍未替换:', [r[0] for r in rows])
