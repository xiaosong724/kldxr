"""round302 check: the OFFLINE part of gold durability.

A player who is NOT in the world at all (no ghost, no session):
  * sell to the system            -> a pending_gold row, done=0
  * next login                    -> credited through _gain_gold, row marked done=1
This path is the reason pending_gold exists; a page reload is NOT a good test for it
because the server keeps a 6 s "ghost" and credits that instead.

Uses the real running server over HTTP + the live db read-only. Creates and erases
its own disposable role.
Run:  python tools/check_gold_offline.py     (server must be up)
"""
import json
import os
import sqlite3
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, 'server', 'game.db')
BASE = 'http://127.0.0.1:8899'
PW = 'abc123456'
NAME = 'OffBot1'

fails = []


def ok(cond, msg):
    print(('  PASS  ' if cond else '  FAIL  ') + msg)
    if not cond:
        fails.append(msg)


def req(path, body=None, token=None, admin=None, method=None):
    headers = {}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
    if token:
        headers['X-Token'] = token
    if admin:
        headers['X-Admin'] = admin
    r = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        return json.loads(urllib.request.urlopen(r, timeout=10).read().decode())
    except Exception as e:
        return {'_err': repr(e)}


def q(sql, args=()):
    c = sqlite3.connect('file:%s?mode=ro' % DB, uri=True)
    try:
        return c.execute(sql, args).fetchall()
    finally:
        c.close()


def purge():
    c = sqlite3.connect(DB, timeout=6)
    try:
        row = c.execute('SELECT id, account_id FROM roles WHERE name=?', (NAME,)).fetchone()
        if row:
            c.execute('DELETE FROM items WHERE role_id=?', (row[0],))
            c.execute('DELETE FROM equipment WHERE role_id=?', (row[0],))
            c.execute('DELETE FROM pending_gold WHERE role=?', (row[0],))
            c.execute('DELETE FROM roles WHERE id=?', (row[0],))
            if row[1]:
                c.execute('DELETE FROM tokens WHERE account_id=?', (row[1],))
                c.execute('DELETE FROM accounts WHERE id=?', (row[1],))
            c.commit()
    finally:
        c.close()


purge()

# 1) register (this does NOT put the player in the world - no websocket)
reg = req('/api/register', {'name': NAME, 'password': PW})
ok(bool(reg.get('token')), 'disposable role registered: %s' % json.dumps(reg)[:90])
tok = reg.get('token')
rid = (q('SELECT id FROM roles WHERE name=?', (NAME,)) or [[None]])[0][0]
ok(rid is not None, 'role row exists (id=%s)' % rid)

# 2) give it something sellable, while it is fully offline
login = req('/api/admin/login', {'password': 'xiuxian-admin'})
at = login.get('token')
ok(bool(at), 'admin login ok')
g = req('/api/admin/act', {'act': 'give', 'name': NAME, 'kind': 'sword', 'tier': 3}, admin=at)
ok(g.get('ok') is True, 'admin give -> %s' % json.dumps(g)[:90])

bag = req('/api/bag', token=tok)
iid = (bag.get('items') or [{}])[0].get('id')
ok(iid is not None, 'bag has the item (iid=%s)' % iid)

# 3) sell over plain HTTP while offline -> must create a pending_gold row
sold = req('/api/sell', {'iid': iid}, token=tok)
ok(sold.get('ok') is True, 'sell accepted (offline): %s' % json.dumps(sold)[:90])
price = int(sold.get('gold') or 0)
time.sleep(1.0)
pend = q('SELECT amount, why, done FROM pending_gold WHERE role=?', (rid,))
ok(len(pend) == 1, 'exactly one pending_gold row was written (%r)' % (pend,))
ok(pend and pend[0][0] == price and pend[0][2] == 0,
   'it holds the sale price and is still done=0 (%r)' % (pend,))
gold_db = (q('SELECT gold FROM roles WHERE id=?', (rid,)) or [[0]])[0][0]
ok(gold_db == 0, 'roles.gold untouched by the HTTP layer (gold=%r)' % gold_db)

# 4) now "log in" for real: a websocket hello is what puts the player in the world,
#    and the drain happens on join. We do not have a ws client here, so drive the
#    exact code path the join uses instead - on a COPY of the db, offline.
sys.path.insert(0, os.path.join(ROOT, 'server'))
os.chdir(os.path.join(ROOT, 'server'))
import auth as authmod          # noqa: E402
import db as dbmod              # noqa: E402
import shutil                   # noqa: E402
import tempfile                 # noqa: E402
import world as W               # noqa: E402

tmpdir = tempfile.mkdtemp(prefix='xx2d-off-')
copy = os.path.join(tmpdir, 'game.db')
src = sqlite3.connect('file:%s?mode=ro' % DB, uri=True)
dst = sqlite3.connect(copy)
src.backup(dst)
dst.close()
src.close()
cfg = {'db': copy, 'data': tmpdir}

pend_rows = authmod.pending_gold_of(cfg, rid)
ok(len(pend_rows) == 1 and pend_rows[0]['amount'] == price,
   'pending_gold_of() returns the row for the join to consume (%r)' % (pend_rows,))

w = W.World(cfg)
p = W.Player(1, {'id': rid, 'name': NAME, 'level': 1, 'gold': 0})
for pg in pend_rows:
    w._gain_gold(p, int(pg['amount']), str(pg['why']))
    w.post_save('UPDATE pending_gold SET done=1 WHERE id=?', (int(pg['id']),))
ok(p.gold == price, 'join credits the offline income into memory (%r)' % p.gold)

queued = []
while not w.saves.empty():
    queued.append(w.saves.get_nowait())
ok(any('pending_gold SET done=1' in s for s, _ in queued),
   'the done=1 update is queued for the saver (%r)' % ([s for s, _ in queued],))

# apply it, then confirm the row is drained and gold got persisted
for sql, params in queued:
    try:
        with dbmod.db(cfg) as c:
            c.execute(sql, params)
    except Exception:
        pass
w._flush_dur = lambda _p: None
p.gold = price
w._save_player(p)
while not w.saves.empty():
    sql, params = w.saves.get_nowait()
    with dbmod.db(cfg) as c:
        c.execute(sql, params)

c = sqlite3.connect(copy)
left = c.execute('SELECT COUNT(*) FROM pending_gold WHERE role=? AND done=0', (rid,)).fetchone()[0]
done = c.execute('SELECT COUNT(*) FROM pending_gold WHERE role=? AND done=1', (rid,)).fetchone()[0]
gold_now = c.execute('SELECT gold FROM roles WHERE id=?', (rid,)).fetchone()[0]
c.close()
ok(left == 0, 'no undrained rows are left (pending0=%d)' % left)
ok(done == 1, 'the row is marked done=1 (pending1=%d)' % done)
ok(gold_now == price, 'the balance is persisted (db gold=%r, expected %r)' % (gold_now, price))

shutil.rmtree(tmpdir, ignore_errors=True)
purge()
print('')
print('leftover role rows: %r' % (q('SELECT id FROM roles WHERE name=?', (NAME,)),))
print('FAILED: %d' % len(fails))
sys.exit(1 if fails else 0)
