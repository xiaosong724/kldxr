# -*- coding: utf-8 -*-
"""Give a test role enough gold, matching memory authority on next join."""
import os, sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))
import db as dbmod

name = sys.argv[1] if len(sys.argv) > 1 else ''
gold = int(sys.argv[2]) if len(sys.argv) > 2 else 60000000
if not name:
    print('usage: give_gold.py <role_name> [amount]')
    raise SystemExit(1)

cfg = {'db': os.path.join(os.path.dirname(__file__), '..', 'server', 'game.db')}
with dbmod.db(cfg) as c:
    r = c.execute('SELECT id,name,gold FROM roles WHERE name=?', (name,)).fetchone()
    if not r:
        print('no role named', name)
        raise SystemExit(2)
    c.execute('UPDATE roles SET gold=? WHERE id=?', (gold, r[0]))
    c.commit()
    print('gold set', name, '->', gold)
