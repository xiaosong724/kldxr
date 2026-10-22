# -*- coding: utf-8 -*-
"""Copy game.db, migrate to v21, seed, and verify catalog contents."""
import os, shutil, sys, json, tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))
import db as dbmod
import towns

src = os.path.join(os.path.dirname(__file__), '..', 'server', 'game.db')
tmp = os.path.join(tempfile.mkdtemp(), 'game.db')
shutil.copy2(src, tmp)

cfg = {'db': tmp}
dbmod.init(cfg) if hasattr(dbmod, 'init') else None
# ensure migrations run
for fn in ('migrate', 'ensure_tables', 'init_db'):
    if hasattr(dbmod, fn):
        try:
            getattr(dbmod, fn)(cfg)
            break
        except TypeError:
            pass

with dbmod.db(cfg) as c:
    ver = c.execute('PRAGMA user_version').fetchone()[0]
    cols = [r[1] for r in c.execute('PRAGMA table_info(town_catalog)')]
    print('user_version', ver)
    print('has model_id', 'model_id' in cols, '| has layout_json', 'layout_json' in cols)

towns.ensure_system_town(cfg)
towns.seed_catalog(cfg)

with dbmod.db(cfg) as c:
    n_furn = c.execute("SELECT COUNT(*) FROM town_catalog WHERE id IN (%s)" %
                       ','.join('?' * len(towns.FURNITURE_SEED)),
                       [r[0] for r in towns.FURNITURE_SEED]).fetchone()[0]
    rows = c.execute("SELECT id,model_id,place_mode,movable,length(layout_json) FROM town_catalog "
                     "WHERE category='building' ORDER BY id").fetchall()
    print('furniture rows', n_furn, '/', len(towns.FURNITURE_SEED))
    for r in rows:
        print('  building', r[0], '| model:', r[1], '| mode:', r[2], '| movable:', r[3], '| layout:', r[4], 'chars')
    spot = c.execute("SELECT * FROM town_catalog WHERE id='bed_single'").fetchone()
    print('bed_single ->', spot[1], spot[3], 'x', spot[4], 'price', spot[6], 'fn', spot[7], 'collision', spot[9][:30])
print('DB OK')

