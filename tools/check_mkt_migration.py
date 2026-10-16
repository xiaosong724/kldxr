"""round304 check: the exchange migration (v5 -> v6) on a COPY of the real db.

Never touches the live file (WAL + sqlite3 backup, not cp). Proves:
  * it upgrades 5 -> 6 and creates exactly the expected tables/indexes
  * it is idempotent (a second run executes 0 SQL)
  * ADD COLUMN + CHECK on a populated table is accepted
  * the live db is byte-identical afterwards
Run:  python tools/check_mkt_migration.py
"""
import hashlib
import os
import shutil
import sqlite3
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRV = os.path.join(ROOT, 'server')
sys.path.insert(0, SRV)
os.chdir(SRV)

import db as dbmod          # noqa: E402

fails = []


def ok(cond, msg):
    print(('  PASS  ' if cond else '  FAIL  ') + msg)
    if not cond:
        fails.append(msg)


def md5(p):
    h = hashlib.md5()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()


LIVE = 'game.db'
before_live = md5(LIVE)

tmpdir = tempfile.mkdtemp(prefix='xx2d-mig-')
copy = os.path.join(tmpdir, 'game.db')
src = sqlite3.connect('file:%s?mode=ro' % LIVE, uri=True)
dst = sqlite3.connect(copy)
src.backup(dst)
dst.close()
src.close()
ok(os.path.getsize(copy) > 0, 'made a working copy of the live db (backup(), not cp)')

cfg = {'db': copy, 'data': tmpdir}

c = sqlite3.connect(copy)
v_before = c.execute('PRAGMA user_version').fetchone()[0]
roles_before = c.execute('SELECT COUNT(*) FROM roles').fetchone()[0]
items_before = c.execute('SELECT COUNT(*) FROM items').fetchone()[0]
gold_nonzero = c.execute('SELECT COUNT(*) FROM roles WHERE gold <> 0').fetchone()[0]
c.close()
print('  copy starts at version %d (roles=%d items=%d gold<>0=%d)'
      % (v_before, roles_before, items_before, gold_nonzero))
ok(v_before in (5, 6), 'the live db is at a version this migration knows (%d)' % v_before)

v0, v1, ran = dbmod.ensure_tables(cfg)
print('  ensure_tables -> %d => %d, %d statements' % (v0, v1, ran))
ok(v1 == 6, 'the db ends up at version 6')
if v_before == 5:
    ok(ran > 0, 'a v5 db is actually migrated (%d statements)' % ran)
else:
    ok(ran == 0, 'an already-migrated db runs nothing (idempotent, %d statements)' % ran)

# the tables must exist regardless of which path we took
c0 = sqlite3.connect(copy)
_have = [r[0] for r in c0.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('listings','trade_log')")]
c0.close()
ok(sorted(_have) == ['listings', 'trade_log'],
   'both exchange tables exist after ensure_tables (%s)' % _have)

# prove the 5 -> 6 path separately, so this check never becomes a no-op
down = os.path.join(tmpdir, 'v5.db')
src2 = sqlite3.connect('file:%s?mode=ro' % LIVE, uri=True)
dst2 = sqlite3.connect(down)
src2.backup(dst2)
dst2.close()
src2.close()
c2 = sqlite3.connect(down)
for t in ('listings', 'trade_log'):
    c2.execute('DROP TABLE IF EXISTS %s' % t)
c2.execute('PRAGMA user_version=5')
c2.commit()
c2.close()
v0c, v1c, ranc = dbmod.ensure_tables({'db': down, 'data': tmpdir})
ok(v0c == 5 and v1c == 6 and ranc > 0,
   'a forced v5 copy really does 5 -> 6 (%d => %d, %d sql)' % (v0c, v1c, ranc))

c = sqlite3.connect(copy)
tabs = [r[0] for r in c.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
ok('listings' in tabs, 'listings table exists')
ok('trade_log' in tabs, 'trade_log table exists')

idx = [r[0] for r in c.execute(
    "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
for want in ('ix_listings_state', 'ix_listings_sel', 'ix_listings_on', 'ix_trade_ts'):
    ok(want in idx, 'index %s exists' % want)

cols = {r[1]: r for r in c.execute('PRAGMA table_info(listings)')}
ok(set(cols.keys()) == {'lid', 'seller', 'item_json', 'price', 'ts', 'expire', 'state'},
   'listings columns are exactly the spec (%s)' % sorted(cols.keys()))
ok(int(cols['lid'][5] or 0) == 1, 'lid is the primary key (pk=%r)' % (cols['lid'][5],))

tcols = {r[1] for r in c.execute('PRAGMA table_info(trade_log)')}
ok(tcols == {'sid', 'lid', 'seller', 'buyer', 'price', 'tax', 'item_json', 'ts'},
   'trade_log columns are exactly the spec (%s)' % sorted(tcols))

# the price CHECK must actually bite
try:
    c.execute("INSERT INTO listings(seller,item_json,price,ts,expire) VALUES(1,'{}',0,0,0)")
    c.commit()
    ok(False, 'price > 0 CHECK rejected a zero price')
except sqlite3.IntegrityError:
    ok(True, 'price > 0 CHECK rejected a zero price')
except Exception as e:
    ok(False, 'unexpected error on the CHECK test: %r' % (e,))

# the sid primary key is the idempotency gate
c.execute("INSERT INTO trade_log(sid,lid,seller,buyer,price,tax,item_json,ts)"
          " VALUES('t1.1',1,1,2,100,5,'{}',0)")
c.commit()
try:
    c.execute("INSERT INTO trade_log(sid,lid,seller,buyer,price,tax,item_json,ts)"
              " VALUES('t1.1',2,1,2,100,5,'{}',0)")
    c.commit()
    ok(False, 'duplicate sid was rejected by the PRIMARY KEY')
except sqlite3.IntegrityError:
    ok(True, 'duplicate sid is rejected (that is the last idempotency layer)')

roles_after = c.execute('SELECT COUNT(*) FROM roles').fetchone()[0]
items_after = c.execute('SELECT COUNT(*) FROM items').fetchone()[0]
gold_after = c.execute('SELECT COUNT(*) FROM roles WHERE gold <> 0').fetchone()[0]
ok(roles_after == roles_before and items_after == items_before,
   'existing data untouched (roles %d, items %d)' % (roles_after, items_after))
ok(gold_after == gold_nonzero, 'gold column untouched (%d rows <> 0)' % gold_after)
c.close()

# idempotent
v0b, v1b, ranb = dbmod.ensure_tables(cfg)
ok(v0b == 6 and ranb == 0, 're-running executes nothing (%d => %d, %d sql)' % (v0b, v1b, ranb))

# the live db must not have moved
after_live = md5(LIVE)
ok(after_live == before_live, 'the LIVE db is byte-identical (md5 unchanged)')

shutil.rmtree(tmpdir, ignore_errors=True)
print('')
print('FAILED: %d' % len(fails))
sys.exit(1 if fails else 0)
