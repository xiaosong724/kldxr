# -*- coding: utf-8 -*-
"""End-to-end placement test on a DB copy."""
import os, shutil, sys, tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))
import db as dbmod
import towns
import town_objects as obj

src = os.path.join(os.path.dirname(__file__), '..', 'server', 'game.db')
tmp = os.path.join(tempfile.mkdtemp(), 'game.db')
shutil.copy2(src, tmp)
cfg = {'db': tmp}
dbmod.ensure_tables(cfg)
towns.ensure_system_town(cfg)
towns.seed_catalog(cfg)

with dbmod.db(cfg) as c:
    print('schema', c.execute('PRAGMA user_version').fetchone()[0])
    cols = [r[1] for r in c.execute('PRAGMA table_info(town_objects)')]
    print('town_objects has model_id:', 'model_id' in cols, '| parent_id:', 'parent_id' in cols)

sysrow = [r for r in towns.list_towns(cfg) if int(r['is_system']) == 1][0]
print('system town:', sysrow['name'], 'size', sysrow['size_m'])

# 1) place a building + furniture
ok, err, res = obj.place_building(cfg, sysrow, 'house_flat_v1', 100.0, 100.0, 0.0, owner_id=1)
print('place_building:', ok, err, '| furniture:', res and res['furniture_count'])
if ok:
    bid = res['building']['id']
    print('  building id', bid, 'catalog', res['building']['catalog_id'], 'model', res['building']['model_id'])

# 2) layout items should exist as children
rows = obj.list_objects(cfg, sysrow['id'])
kids = [r for r in rows if int(r['parent_id']) == (bid if ok else -1)]
print('children:', len(kids))
cats = {}
for k in kids:
    cats[k['catalog_id']] = cats.get(k['catalog_id'], 0) + 1
print('  ', cats)

# 3) overlap must be rejected
ok2, err2, _ = obj.place_building(cfg, sysrow, 'house_flat_v1', 100.0, 100.0, 0.0, owner_id=1)
print('overlap rejected:', (not ok2), '->', err2)

# 4) outside town rejected
ok3, err3, _ = obj.place_object(cfg, sysrow, 'chair_wood', 9000.0, 9000.0, 0.0)
print('outside rejected:', (not ok3), '->', err3)

# 5) move furniture
if kids:
    k = kids[0]
    ok4, err4, r4 = obj.move_object(cfg, sysrow, k['id'], k['x'] + 0.5, k['z'])
    print('move furniture:', ok4, err4, r4)

# 6) remove building cascades
ok5, err5 = obj.remove_object(cfg, bid, cascade=True)
left = [r for r in obj.list_objects(cfg, sysrow['id']) if int(r['parent_id']) == bid]
print('remove building:', ok5, err5, '| children left:', len(left))

# 7) single furniture placement
ok6, err6, row6 = obj.place_object(cfg, sysrow, 'chair_wood', 140.0, 140.0, 0.0, owner_id=1)
print('place chair:', ok6, err6, row6 and row6['collision_json'][:60])
print('DONE')
