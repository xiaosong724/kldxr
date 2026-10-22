# -*- coding: utf-8 -*-
"""Verify move works when the target is free; also verify parent-child retention."""
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
row = [r for r in towns.list_towns(cfg) if int(r['is_system']) == 1][0]

# lone chair, move to empty space
ok, err, chair = obj.place_object(cfg, row, 'chair_wood', 60.0, 60.0, 0.0)
print('place chair:', ok, err)
ok2, err2, res2 = obj.move_object(cfg, row, chair['id'], 63.0, 60.0)
print('move to empty:', ok2, err2, res2)
ok3, err3, _ = obj.move_object(cfg, row, chair['id'], 9000.0, 9000.0)
print('move outside rejected:', (not ok3), err3)

# remove only one furniture child leaves building alive
ok4, err4, b = obj.place_building(cfg, row, 'hall_v1', -80.0, -80.0, 0.0, owner_id=2)
print('place hall:', ok4, err4, 'furniture', b and b['furniture_count'])
kids = [r for r in obj.list_objects(cfg, row['id']) if int(r['parent_id']) == b['building']['id']]
print('hall children:', len(kids))
if kids:
    ok5, err5 = obj.remove_object(cfg, kids[0]['id'], cascade=False)
    still = [r for r in obj.list_objects(cfg, row['id']) if int(r['id']) == b['building']['id']]
    print('remove one child:', ok5, err5, '| building still active:', len(still) == 1)

# rotation changes collision extents
ok6, err6, desk = obj.place_object(cfg, row, 'desk', 20.0, 20.0, 0.0)
print('desk coll 0deg:', desk['collision_json'])
ok7, err7, desk2 = obj.place_object(cfg, row, 'desk', 24.0, 20.0, 1.5708)
print('desk coll 90deg:', desk2['collision_json'])
print('DONE')
