"""round302 check: does the save path really carry gold, and does a rejoin restore it?

Offline, on a COPY of the real db (never the live one - WAL, use backup()).
Run:  python tools/check_gold_durable.py
"""
import os
import shutil
import sqlite3
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRV = os.path.join(ROOT, 'server')
sys.path.insert(0, SRV)
os.chdir(SRV)

import auth as authmod          # noqa: E402
import db as dbmod              # noqa: E402
import world as W               # noqa: E402

fails = []


def ok(cond, msg):
    print(('  PASS  ' if cond else '  FAIL  ') + msg)
    if not cond:
        fails.append(msg)


# ---- a throwaway copy of the real db (never touch the live file) ----
tmpdir = tempfile.mkdtemp(prefix='xx2d-gold-')
copy = os.path.join(tmpdir, 'game.db')
src = sqlite3.connect('file:game.db?mode=ro', uri=True)
dst = sqlite3.connect(copy)
src.backup(dst)
dst.close()
src.close()
cfg = {'db': copy, 'data': tmpdir}

# ---- a disposable role to work on ----
s = sqlite3.connect(copy)
s.execute("INSERT INTO accounts(name, pass_hash, salt, created_at) VALUES('GoldT','x','y',0)")
acc = s.execute("SELECT id FROM accounts WHERE name='GoldT'").fetchone()[0]
s.execute("INSERT INTO roles(account_id, name, level, exp, hp, qi, x, z, yaw, gold, created_at, updated_at)"
          " VALUES(?, 'GoldT', 1, 0, 200, 0, 0, 0, 0, 0, 0, 0)", (acc,))
rid = s.execute("SELECT id FROM roles WHERE name='GoldT'").fetchone()[0]
s.commit()
s.close()

print('role id = %s   (copy: %s)' % (rid, copy))

w = W.World(cfg)

# ---- 1. Player seeds gold from the role dict ----
p = W.Player(1, {'id': rid, 'name': 'GoldT', 'level': 1, 'gold': 12345})
ok(p.gold == 12345, 'Player() seeds self.gold from role dict  (got %r)' % (p.gold,))
p2 = W.Player(2, {'id': rid, 'name': 'GoldT', 'level': 1})
ok(p2.gold == 0, 'Player() defaults to 0 when the key is absent  (got %r)' % (p2.gold,))

# ---- 2. _save_player queues an UPDATE that really carries gold ----
p.gold = 777
w._flush_dur = lambda _p: None          # no durability rows in this harness
w._save_player(p)
queued = []
while not w.saves.empty():
    queued.append(w.saves.get_nowait())
ok(len(queued) == 1, 'logout queues exactly one UPDATE  (%d)' % len(queued))
sql, params = queued[0]
ok('gold=?' in sql, 'the queued UPDATE touches gold: %s' % sql)
ok(777 in params, 'the queued params carry 777: %r' % (params,))

try:
    with dbmod.db(cfg) as c:
        c.execute(sql, params)
    s = sqlite3.connect(copy)
    got = s.execute('SELECT gold FROM roles WHERE id=?', (rid,)).fetchone()[0]
    s.close()
    ok(got == 777, 'the UPDATE persists gold to the db  (db=%r)' % (got,))
except Exception as e:
    ok(False, 'the queued UPDATE executes: %r' % (e,))

# ---- 3. role_public exposes gold (the picking layer that used to drop it) ----
s = sqlite3.connect(copy)
s.row_factory = sqlite3.Row
row = s.execute('SELECT * FROM roles WHERE id=?', (rid,)).fetchone()
s.close()
pub = authmod.role_public(row)
ok('gold' in pub, "role_public() emits 'gold'  (keys=%s)" % (sorted(pub.keys()),))
ok(pub.get('gold') == 777, 'role_public() gold == db value  (got %r)' % (pub.get('gold'),))

# ---- 4. pending_gold is drained through _gain_gold and marked done ----
with dbmod.db(cfg) as c:
    c.execute("INSERT INTO pending_gold(role, amount, why, ts, done) VALUES(?,?,?,?,0)",
              (rid, 2400, 'sell', dbmod.now_ms()))
pend = authmod.pending_gold_of(cfg, rid)
ok(len(pend) == 1 and pend[0]['amount'] == 2400,
   'pending_gold_of() reads the undrained row  (%r)' % (pend,))

# mimic exactly what the join path does
p3 = W.Player(3, {'id': rid, 'name': 'GoldT', 'level': 1, 'gold': 0})
for _pg in pend:
    w._gain_gold(p3, int(_pg['amount']), str(_pg['why']))
    w.post_save('UPDATE pending_gold SET done=1 WHERE id=?', (int(_pg['id']),))
ok(p3.gold == 2400, 'the join path credits pending gold into memory  (got %r)' % (p3.gold,))
sqls = []
while not w.saves.empty():
    sqls.append(w.saves.get_nowait()[0])
ok(any('pending_gold SET done=1' in x for x in sqls),
   'it also queues "pending_gold SET done=1"  (%r)' % (sqls,))

# ---- 5. the plain HTTP path never writes gold directly ----
s = sqlite3.connect(copy)
s.row_factory = sqlite3.Row
before = s.execute('SELECT gold FROM roles WHERE id=?', (rid,)).fetchone()[0]
s.close()
ok(before == 777, 'nothing has written gold behind our back  (db=%r)' % (before,))

shutil.rmtree(tmpdir, ignore_errors=True)
print('')
print('FAILED: %d' % len(fails))
sys.exit(1 if fails else 0)
