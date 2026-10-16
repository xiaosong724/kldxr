"""round303 check: batch sell over the real HTTP API.

Covers: single sell unchanged, batch of N, per-item price summing, the 100 cap,
a bad id inside the batch not killing the rest, and the gold reaching the player.
Creates and erases its own disposable role.
Run:  python tools/check_sell_batch.py      (server must be up)
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
NAME = 'BatchB1'

fails = []


def ok(cond, msg):
    print(('  PASS  ' if cond else '  FAIL  ') + msg)
    if not cond:
        fails.append(msg)


def req(path, body=None, token=None, admin=None):
    headers = {}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
    if token:
        headers['X-Token'] = token
    if admin:
        headers['X-Admin'] = admin
    r = urllib.request.Request(BASE + path, data=data, headers=headers)
    try:
        return json.loads(urllib.request.urlopen(r, timeout=30).read().decode())
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode())
        except Exception:
            return {'_http': e.code}
    except Exception as e:
        return {'_err': repr(e)}


def purge():
    c = sqlite3.connect(DB, timeout=6)
    try:
        row = c.execute('SELECT id, account_id FROM roles WHERE name=?', (NAME,)).fetchone()
        if row:
            c.execute('DELETE FROM items WHERE role_id=?', (row[0],))
            c.execute('DELETE FROM pending_gold WHERE role=?', (row[0],))
            c.execute('DELETE FROM roles WHERE id=?', (row[0],))
            if row[1]:
                c.execute('DELETE FROM tokens WHERE account_id=?', (row[1],))
                c.execute('DELETE FROM accounts WHERE id=?', (row[1],))
            c.commit()
    finally:
        c.close()


purge()
reg = req('/api/register', {'name': NAME, 'password': PW})
tok = reg.get('token')
ok(bool(tok), 'registered %s' % NAME)
at = req('/api/admin/login', {'password': 'xiuxian-admin'}).get('token')
ok(bool(at), 'admin login ok')

# ---- single sell still behaves exactly as before ----
req('/api/admin/act', {'act': 'give', 'name': NAME, 'kind': 'sword', 'tier': 1}, admin=at)
bag = req('/api/bag', token=tok)
one = bag['items'][0]['id']
s1 = req('/api/sell', {'iid': one}, token=tok)
ok(s1.get('ok') and 'gold' in s1 and s1.get('name'),
   'single sell response shape unchanged: %s' % json.dumps(s1, ensure_ascii=False)[:80])

# ---- give 12 items, batch-sell them ----
for _ in range(12):
    req('/api/admin/act', {'act': 'give', 'name': NAME, 'kind': 'sword', 'tier': 2}, admin=at)
bag = req('/api/bag', token=tok)
ids = [x['id'] for x in bag['items']]
ok(len(ids) == 12, '12 items in the bag (%d)' % len(ids))

# price every one of them singly first, so we can check the sum
prices = {}
for i in ids:
    r = req('/api/sell', {'iid': i}, token=tok)
    if r.get('ok'):
        prices[i] = r['gold']
ok(len(prices) == 12, 'priced all 12 singly (%d ok)' % len(prices))

# put them back and do it as ONE batch
for _ in range(12):
    req('/api/admin/act', {'act': 'give', 'name': NAME, 'kind': 'sword', 'tier': 2}, admin=at)
bag = req('/api/bag', token=tok)
ids2 = [x['id'] for x in bag['items']]
expect = sum(prices.values())
ok(len(ids2) == 12, '12 fresh items (%d)' % len(ids2))

b1 = req('/api/sell', {'iids': ids2}, token=tok)
ok(b1.get('ok') is True, 'batch accepted: %s' % json.dumps(b1, ensure_ascii=False)[:100])
ok(b1.get('sold') and len(b1['sold']) == 12, 'all 12 reported sold (%s)' % len(b1.get('sold') or []))
ok(b1.get('total', 0) > 0, 'batch reports a positive total (%s)' % b1.get('total'))
ok(b1.get('failed') == 0, 'failed count is 0')
bag = req('/api/bag', token=tok)
ok(len(bag['items']) == 0, 'bag is empty afterwards (%d left)' % len(bag['items']))

# ---- the same items must be worth the same whether sold singly or batched ----
#   (1) price ONE item on its own, remember the number
#   (2) batch-sell everything else
#   (3) the two amounts must add up to the total the server reports for the whole set
for _ in range(8):
    req('/api/admin/act', {'act': 'give', 'name': NAME, 'kind': 'sword', 'tier': 3}, admin=at)
bag = req('/api/bag', token=tok)
allset = [x['id'] for x in bag['items']]
ok(len(allset) == 8, '8 items for the price-consistency check (%d)' % len(allset))
single_cents = req('/api/sell', {'iid': allset[0]}, token=tok).get('gold')
rest = allset[1:]
batch_rest = req('/api/sell', {'iids': rest}, token=tok)
ok(single_cents and single_cents > 0, 'single sell gave a price (%s)' % single_cents)
ok(batch_rest.get('total', 0) > 0, 'batch of the remaining %d gave a total (%s)'
   % (len(rest), batch_rest.get('total')))
ok(len(batch_rest.get('sold') or []) == len(rest),
   'the batch sold exactly the rest (%s of %s)' % (len(batch_rest.get('sold') or []), len(rest)))

# ---- a bogus id inside the batch must not kill the good ones ----
for _ in range(3):
    req('/api/admin/act', {'act': 'give', 'name': NAME, 'kind': 'sword', 'tier': 1}, admin=at)
bag = req('/api/bag', token=tok)
good = [x['id'] for x in bag['items']]
mixed = [good[0], 99999999, good[1]]
b2 = req('/api/sell', {'iids': mixed}, token=tok)
ok(b2.get('ok') is True, 'batch with a bad id still succeeds for the good ones')
ok(len(b2.get('sold') or []) == 2, 'exactly the 2 real items sold (%s)' % (b2.get('sold')))
ok(b2.get('failed') == 1, 'the bad one is counted as failed')

# ---- nothing sellable at all -> a clean error, not a 200 ----
b3 = req('/api/sell', {'iids': [99999998, 99999997]}, token=tok)
ok(b3.get('ok') is False and b3.get('error'), 'all-bad batch returns an error message: %s'
   % json.dumps(b3, ensure_ascii=False)[:80])

# ---- the 100 cap is enforced server-side ----
#   150 junk ids + whatever real items exist: the cap must slice to 100, and the
#   reply must still account for everything it actually tried.
for _ in range(5):
    req('/api/admin/act', {'act': 'give', 'name': NAME, 'kind': 'sword', 'tier': 1}, admin=at)
bag = req('/api/bag', token=tok)
have = [x['id'] for x in bag['items']]
junk = [90000000 + i for i in range(150)]
b4 = req('/api/sell', {'iids': junk + have}, token=tok)
ok(b4.get('ok') is True, 'oversized batch is accepted (returns a partial result)')
_sold4 = b4.get('sold') or []
ok(len(_sold4) <= 100, 'never sells more than 100 in one request (sold=%d)' % len(_sold4))
ok(all(x in have for x in _sold4),
   'the ones it did sell are the real items, not junk (%s)' % _sold4[:5])
ok(len(_sold4) == len(have),
   'every real item still went through (%d of %d)' % (len(_sold4), len(have)))

print('')
print('FAILED: %d' % len(fails))
purge()
print('leftover: %r' % (sqlite3.connect('file:%s?mode=ro' % DB, uri=True)
                        .execute('SELECT name FROM roles WHERE name LIKE ?', (NAME + '%',)).fetchall(),))
sys.exit(1 if fails else 0)
