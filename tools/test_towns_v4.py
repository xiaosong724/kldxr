# -*- coding: utf-8 -*-
"""v4 multi-town foundation tests (temporary DB, does not touch game.db)."""
import os
import shutil
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'server'))

import db
import towns

fd, path = tempfile.mkstemp(suffix='.db')
os.close(fd)
try:
    shutil.copyfile(os.path.join(ROOT, 'server', 'game.db'), path)
    cfg = {'db': path}
    db.ensure_tables(cfg)
    with db.db(cfg) as c:
        c.execute('DELETE FROM town_perms WHERE town_id IN (SELECT id FROM towns WHERE is_system=0)')
        c.execute('DELETE FROM town_objects WHERE town_id IN (SELECT id FROM towns WHERE is_system=0)')
        c.execute('DELETE FROM towns WHERE is_system=0')
        c.commit()
    sysrow = towns.ensure_system_town(cfg)
    towns.seed_catalog(cfg)
    assert sysrow['is_system'] == 1
    assert len(towns.list_catalog(cfg)) >= 20

    assert towns.fee_for(30) == 5_000_000
    assert towns.fee_for(50) == 13_890_000
    assert towns.fee_for(80) == 35_560_000
    assert towns.fee_for(100) == 55_560_000

    ok, err, a = towns.create_town(cfg, 9001, '测试镇A', 30, 400, 0)
    assert ok, err
    assert a['size_m'] == 18.6
    assert towns.perm_mask_of(9001, a, cfg) == towns.P_ALL
    assert towns.perm_mask_of(777, a, cfg) == towns.P_VISITOR

    ok2, err2, _ = towns.create_town(cfg, 9002, '测试镇B', 30, 410, 0)
    assert not ok2, 'close town should be rejected'

    ok3, err3, b = towns.create_town(cfg, 9002, '测试镇B', 30, 500, 0)
    assert ok3, err3
    ok4, err4, _ = towns.create_town(cfg, 9001, '第二座', 30, 800, 0)
    assert not ok4, 'one town per owner'

    towns.set_perm(cfg, a['id'], 9002, towns.P_MOVE | towns.P_INTERACT, 9001)
    assert towns.perm_mask_of(9002, a, cfg) == (towns.P_MOVE | towns.P_INTERACT)

    assert towns.freeze_town(cfg, a['id'])
    assert towns.get_town(cfg, a['id'])['status'] == 'frozen'
    okr, errr, ar = towns.restore_town(cfg, a['id'], 400, 0)
    assert okr, errr
    assert ar['status'] == 'active'

    owner_gain, tax = towns.add_ledger(cfg, a['id'], 9001, 'shop', 1000)
    assert owner_gain == 800 and tax == 200

    print('towns v4 foundation: OK')
finally:
    try:
        os.remove(path)
    except Exception:
        pass
