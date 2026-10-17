"""round304b check #1: the exchange, end to end, against a COPY of the real db.

What it proves (no server needed, no network, no live db touched):
  * market.py's money rules: listing fee floor/ceiling/free-under-1000, 5% tax
  * the full happy path: list -> fee charged -> row on the shelf -> buy -> the buyer
    pays, the seller is paid the net, the goods land in the buyer's bag, the listing
    is gone from the shelf and marked sold in the db, trade_log has the row
  * the sad paths: your own listing, too little gold, too-low price, price above cap,
    the 10-per-player cap, buying something that is gone, buying twice
  * the rollback path: the db says the item is not in the bag any more -> the fee
    comes back (the money never silently disappears)
  * expiry: an expired row is refused, and the sweep returns it to the bag
  * the tick thread never touches the db directly (everything goes through saves)

Run:  python tools/check_mkt_logic.py
"""
import hashlib
import json
import os
import shutil
import sqlite3
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRV = os.path.join(ROOT, 'server')
sys.path.insert(0, SRV)
os.chdir(SRV)

"""round304b ★ 控制台编码：这个脚本的断言文字里有 ✓ ✗ 这些字符 ✗
   而 Windows 的默认控制台是 GBK ✗ 打不出来就【抛异常】✓
   → 表现：跑到一半直接崩 ✗ 后面的断言一条都不跑 ✓（自测真踩到过 ✓）
   ★ 所以在导入任何东西之前把输出改成 UTF-8 ✗ 并且容错 ✓
     （errors='replace' ✗ 实在打不出来也不会把测试打断 ✓）"""
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

import db as dbmod          # noqa: E402
import market as mkmod      # noqa: E402
import value as valuemod    # noqa: E402
import world as worldmod    # noqa: E402

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

tmpdir = tempfile.gettempdir()
# ★ 为什么不用 mkdtemp：它建出来的子目录在沙箱里【不可写】✗
#   （mkdir 成功 ✗ 但里面建文件报 PermissionError ✓ 自测抓到的 ✓）
#   → 直接用系统的临时目录 + 带 pid 的文件名 ✓ 一样不会撞 ✓
copy = os.path.join(tmpdir, 'xx2d-mkt1-%d.db' % os.getpid())
src = sqlite3.connect('file:%s?mode=ro' % LIVE, uri=True)
dst = sqlite3.connect(copy)
src.backup(dst)
dst.close()
src.close()
cfg = {'db': copy, 'data': tmpdir}
dbmod.ensure_tables(cfg)
ok(os.path.getsize(copy) > 0, 'made a working copy of the live db (backup(), not cp)')


# ---------------------------------------------------------------- 假世界 / 假玩家
class FakePlayer(object):
    """只有交易所用得着的字段（★ 不碰真 Player 的构造 ✗ 免得依赖血/武器那些 ✓）"""

    def __init__(self, cid, rid, name, gold=0, bag=None):
        self.cid = cid
        self.role_id = rid
        self.name = name
        self.gold = int(gold)
        self.goldDirty = False
        self.goldLog = []
        self.ghostAt = None
        self.role = {'id': rid, 'name': name, 'level': 10, 'bag': list(bag or [])}


W = worldmod.World(cfg)
sent = []


def _capture(cid, text):
    sent.append((cid, text))
    return True


W._send_cid = _capture          # ★ 只拦"发出去"这一步 ✗ 别的逻辑全真跑 ✓


def packs(kind=None):
    out = []
    for cid, t in sent:
        try:
            o = json.loads(t)
        except Exception:
            continue
        if kind is None or o.get('t') == kind:
            out.append(o)
    return out


def last(kind):
    xs = packs(kind)
    return xs[-1] if xs else None


def d_of(kind):
    """最后一条某类消息的【包体】（协议是 {"t":..,"d":{...}} ✗ 别读顶层 ✓）"""
    o = last(kind)
    return (o or {}).get('d') or {}


def item(name, tier=3, iid=None, lv=20, slot='weapon'):
    it = {'name': name, 'tier': tier, 'itemLv': lv}
    if slot:
        it['slot'] = slot
        it['base'] = {'atk': 10}
        it['dur'] = 100
        it['durMax'] = 100
    return it


def give_db_item(rid, it, stack=1):
    """真往库里塞一件（模拟"他背包里真有这件" ✗ 交易所只认库里的 id ✓）"""
    with dbmod.db(cfg) as c:
        cur = c.execute(
            'INSERT INTO items(role_id, in_storage, slot_index, stack, item_json, created_at)'
            ' VALUES(?,0,-1,?,?,?)',
            (rid, int(stack), json.dumps(it, ensure_ascii=False), dbmod.now_ms()))
        return int(cur.lastrowid)


def make_role(name, gold):
    with dbmod.db(cfg) as c:
        now = dbmod.now_ms()
        c.execute('INSERT INTO accounts(name, pass_hash, salt, created_at) VALUES(?,?,?,?)',
                  (name, 'x', 'y', now))
        aid = int(c.execute('SELECT id FROM accounts WHERE name=?', (name,)).fetchone()[0])
        c.execute('INSERT INTO roles(account_id, name, level, gold, created_at, updated_at)'
                  ' VALUES(?,?,?,?,?,?)', (aid, name, 10, int(gold), now, now))
        rid = int(c.execute('SELECT id FROM roles WHERE account_id=?', (aid,)).fetchone()[0])
    q = FakePlayer(900 + rid, rid, name, gold=gold)
    W.players[q.cid] = q
    return q


def bag_ids(q):
    return [int(x['id']) for x in (q.role.get('bag') or [])]


def load_bag(q):
    """把库里的背包读进 role['bag']（和 net.py 登录时一个口径 ✓）"""
    q.role['bag'] = []
    with dbmod.db(cfg) as c:
        for rid_, js, stack in c.execute(
                'SELECT id, item_json, stack FROM items WHERE role_id=? AND in_storage=0'
                ' ORDER BY id DESC', (q.role_id,)):
            q.role['bag'].append({'id': int(rid_), 'item': json.loads(js),
                                  'stack': int(stack or 1), 'lock': 0})
    return q.role['bag']


def run_saves():
    """把 saves 队列里的一条条真写进库（★ 就是 _run_saver 干的事 ✗ 这里手工跑一遍 ✓）"""
    n = 0
    okrows = []
    wrote = False
    with dbmod.db(cfg) as db:
        while True:
            try:
                sql, params = W.saves.get_nowait()
            except Exception:
                break
            n += 1
            # ★ round305：余额是"值 + 代号"的写法 ✗ 这里也要认 ✓
            #   （存档线程和测试【共用】world.gold_sql_split ✓ 免得两边不一致 ✓）
            _gs = worldmod.gold_sql_split(sql)
            if _gs is not None:
                if W.gold_write_ok(_gs, params[0]):
                    db.execute('UPDATE roles SET gold=? WHERE id=?',
                               (int(params[1]), int(params[0])))
                continue
            if isinstance(sql, tuple):
                # ★ 交易所的事务在队列里【整条就是那个元组】✗
                #   语句是 ('MKT', 'list'|..., {...}) ✗ params 什么都不是 ✓
                #   （自测当场抓到：照着字符串那种形状写 params[1] 会 IndexError ✓）
                wrote = True
                W._save_mkt(db, sql)
                if sql[2].pop('_mkt_ok', 0):
                    # ★ kind 用真实动作名 ✗ 不要 row.get('kind') ✓
                    #   （那个 key 不存在 → None → str 成 'None' ✗ 我已经被坑过一次 ✓）
                    okrows.append((sql[1], sql[2]))
                continue
            if sql == 'MKT':
                wrote = True
                W._save_mkt(db, params)
                if params[1].pop('_mkt_ok', 0):
                    okrows.append((params[0], params[1]))
                continue
            db.execute(sql, params)
    for kind, row in okrows:
        W._mkt_mem(True, kind, row)
    return n, wrote


def tick():
    """跑一拍：先 drain 回执 ✗ 再投递（和 _step 里的顺序一致 ✓）"""
    W._mkt_drain()


def db_gold(rid):
    with dbmod.db(cfg) as c:
        return int(c.execute('SELECT gold FROM roles WHERE id=?', (rid,)).fetchone()[0])


# ================================================================ 1. 规则
print('--- 1. money rules (offline, pure) ---')
ok(valuemod.MKT_PRICE_MIN == 10, 'minimum listing price is 10')
ok(mkmod.fee_of(0, 100000) == 0, 'under 1000 gold -> the listing fee is free (0)')
ok(mkmod.fee_of(999, 100000) == 0, '999 gold is still free')
ok(mkmod.fee_of(1000, 10) == 1, '1% of 10 rounds UP to the 1-gold floor')
ok(mkmod.fee_of(1000, 100) == 1, '1% of 100 is 1')
ok(mkmod.fee_of(1000, 9999) == 100, '1% of 9999 is 100 (99.99 -> floor 1 -> 99? no: ceil)')
ok(mkmod.fee_of(1000, 50000) == 100, 'the fee is capped at 100')
ok(mkmod.tax_of(1000) == 50 and mkmod.net_of(1000) == 950, '5% tax, seller keeps 950')
ok(mkmod.tax_of(19) == 0 and mkmod.net_of(19) == 19, 'a cheap sale is not taxed below 1')
ok(mkmod.price_ok(9)[0] is False, 'price 9 is refused')
ok(mkmod.price_ok(10)[0] is True and mkmod.price_ok(10)[1] == 10, 'price 10 is accepted')
ok(mkmod.price_ok(valuemod.GOLD_CAP + 1)[0] is False, 'price above the gold cap is refused')
ok(mkmod.price_ok('abc')[0] is False, 'a non-numeric price is refused')

print('--- 2. classification ---')
ok(valuemod.cat_of(item('x', slot='weapon')) == 'weapon', 'weapon -> weapon')
ok(valuemod.cat_of(item('x', slot='armor')) == 'armor', 'armor -> armor')
ok(valuemod.cat_of({'name': '碎玻璃', 'tier': 0, 'kind': 'material'}) == 'material',
   'material -> material')
ok(valuemod.cat_of({'name': '黄金', 'tier': 0, 'kind': 'material'}) == 'material',
   'bullion is a material (it has kind=material)')

# ================================================================ 3. 上架
print('--- 3. listing an item ---')
seller = make_role('MktSeller', 5000)
buyer = make_role('MktBuyer', 100000)
poor = make_role('MktPoor', 20)
iid1 = give_db_item(seller.role_id, item('测试斧', tier=5, lv=40))
load_bag(seller)
ok(iid1 in bag_ids(seller), 'the seller has the item in his bag')

sent[:] = []
W._mkt_do(seller, 'mklist', {'iid': iid1, 'price': 10000})
ok(last('listres') and d_of('listres')['ok'] is True,
   'listing was accepted: %s' % d_of('listres').get('msg'))
fee = mkmod.fee_of(5000, 10000)
ok(seller.gold == 5000 - fee, 'the listing fee was charged at once (%d -> %d, fee %d)'
   % (5000, seller.gold, fee))
ok(len(W.mkt['by_lid']) == 1, 'the row is on the shelf (optimistic)')
tmp_lid = list(W.mkt['by_lid'].keys())[0]
ok(tmp_lid < 0, 'while it is not persisted the lid is a negative placeholder (%d)' % tmp_lid)
n, wrote = run_saves()
ok(wrote and n >= 1, 'the saver really ran (%d statements)' % n)
tick()
ok(len(W.mkt['by_lid']) == 1, 'still exactly one row after the saver')
real_lid = list(W.mkt['by_lid'].keys())[0]
ok(real_lid > 0, 'the placeholder lid was replaced by the real one (%d)' % real_lid)
with dbmod.db(cfg) as c:
    row = c.execute('SELECT seller, price, state FROM listings WHERE lid=?', (real_lid,)).fetchone()
ok(row is not None and row[2] == 'on' and int(row[1]) == 10000,
   'the listing row is in the db as state=on price=10000')
with dbmod.db(cfg) as c:
    left = c.execute('SELECT COUNT(*) FROM items WHERE id=?', (iid1,)).fetchone()[0]
ok(left == 0, 'the item is NO LONGER in the items table (it is on the shelf, not in the bag)')
ok(d_of('listres')['ok'] and '已上架' in (last('notice') or {}).get('d', {}).get('text', ''),
   'the seller got the final "listed" reply after the commit')

print('--- 4. listing refusals ---')
sent[:] = []
W._mkt_do(seller, 'mklist', {'iid': iid1, 'price': 10000})
ok(d_of('listres')['ok'] is False and '货架上' in d_of('listres')['msg'],
   'listing the same item twice is refused by the shelf check: %s' % d_of('listres')['msg'])
W._mkt_do(seller, 'mklist', {'iid': 999999, 'price': 10000})
ok(d_of('listres')['ok'] is False and '背包' in d_of('listres')['msg'],
   'an id that is not in the bag is refused: %s' % d_of('listres')['msg'])
W._mkt_do(seller, 'mklist', {'iid': iid1, 'price': 9})
ok(d_of('listres')['ok'] is False and '10' in d_of('listres')['msg'],
   'a price below the minimum is refused')
W._mkt_do(seller, 'mklist', {'iid': iid1, 'price': 'abc'})
ok(d_of('listres')['ok'] is False, 'a non-numeric price is refused')
W._mkt_do(seller, 'mklist', {'iid': iid1})
ok(d_of('listres')['ok'] is False, 'a missing price is refused (no crash)')

# 穷玩家：余额 < 1000 → 免上架费（方案 §7c 的穷玩家保护 ✓）
iid_p = give_db_item(poor.role_id, item('穷人剑', tier=1))
load_bag(poor)
sent[:] = []
W._mkt_do(poor, 'mklist', {'iid': iid_p, 'price': 50})
ok(d_of('listres')['ok'] is True and poor.gold == 20,
   'a poor player (20 gold) lists for free (balance < 1000)')
run_saves()
tick()

print('--- 5. the 10-per-player cap ---')
#   ★ 上架一次真扣一次上架费 ✗ 钱不够的话后面几条会被"余额不够"拦掉 ✓
#     那就变成在测别的东西了（自测抓到过 ✓）
seller.gold = 200000
W.mkt['by_lid'].clear()
for _c in W.mkt['cats'].values():
    _c.clear()
W.mkt_locking.clear()
with dbmod.db(cfg) as c:
    c.execute("UPDATE listings SET state='cancelled' WHERE state='on'")
    c.commit()
cap_ids = [give_db_item(seller.role_id, item('堆货%d' % k, tier=1)) for k in range(12)]
load_bag(seller)
acc = 0
for one in cap_ids:
    sent[:] = []
    W._mkt_do(seller, 'mklist', {'iid': one, 'price': 100})
    if d_of('listres')['ok']:
        acc += 1
    run_saves()
    tick()
ok(acc == valuemod.MKT_MAX_PER_PLAYER,
   'exactly %d listings fit' % valuemod.MKT_MAX_PER_PLAYER)
sent[:] = []
W._mkt_do(seller, 'mklist', {'iid': cap_ids[-1], 'price': 100})
ok(d_of('listres')['ok'] is False and '最多' in d_of('listres')['msg'],
   'the 11th listing is refused: %s' % d_of('listres')['msg'])
run_saves()
tick()
ok(len([1 for r in W.mkt['by_lid'].values() if int(r['seller']) == seller.role_id])
   == valuemod.MKT_MAX_PER_PLAYER, 'the shelf really holds 10 for this seller')
ok(all(int(l) > 0 for l in W.mkt['by_lid']),
   'every persisted listing has a real (positive) lid')
ok({int(r['price']) for r in W.mkt['by_lid'].values()} == {100},
   'all ten are the 100-gold ones')

print('--- 6. buying ---')
cheap_lid = None
for lid, r in W.mkt['by_lid'].items():
    if int(r['price']) == 100:
        cheap_lid = lid
        break
ok(cheap_lid is not None, 'found a 100-gold listing to buy (%s)' % cheap_lid)
load_bag(buyer)
g0 = buyer.gold
#   ★ 卖家这一件的 item_json（后面用来确认"换了个主人"✓ 而不是"凭空多一件"✓）
sold_it = dict(W.mkt['by_lid'][cheap_lid]['it'])
sent[:] = []
W._mkt_do(buyer, 'buyitem', {'lid': cheap_lid, 'sid': 'test-sid-1'})
ok(d_of('listres')['ok'] is True and '正在购买' in d_of('listres')['msg'],
   'the buy is accepted as "processing": %s' % d_of('listres')['msg'])
ok(buyer.gold == g0 - 100, 'the buyer paid at once (%d -> %d)' % (g0, buyer.gold))
ok(cheap_lid not in W.mkt['by_lid'], 'the row left the shelf in memory (no double sell)')
run_saves()
tick()
ok(buyer.gold == g0 - 100, 'the buyer is not charged twice')
ok(any('买到' in (json.loads(t).get('d', {}).get('text') or '')
       for _, t in sent if '"notice"' in t), 'the buyer got the "bought" notice')
with dbmod.db(cfg) as c:
    st = c.execute('SELECT state FROM listings WHERE lid=?', (cheap_lid,)).fetchone()[0]
    tl = c.execute('SELECT buyer, price, tax FROM trade_log WHERE lid=?',
                   (cheap_lid,)).fetchone()
    mine = c.execute('SELECT COUNT(*) FROM items WHERE role_id=? AND'
                     " json_extract(item_json,'$.name')=?", (buyer.role_id,
                                                             sold_it['name'])).fetchone()[0]
    theirs = c.execute('SELECT COUNT(*) FROM items WHERE role_id=? AND'
                       " json_extract(item_json,'$.name')=?",
                       (seller.role_id, sold_it['name'])).fetchone()[0]
ok(st == 'sold', "the listing is state='sold' in the db")
ok(tl is not None and int(tl[0]) == buyer.role_id and int(tl[1]) == 100 and int(tl[2]) == 5,
   'trade_log has the trade (buyer=%s price=100 tax=5)' % (tl and tl[0],))
ok(mine == 1, 'the item landed in the buyer bag (%d row)' % mine)
ok(theirs == 0, 'the sold item is gone from the seller bag (%d)' % theirs)
ok(len([1 for r in W.mkt['by_lid'].values() if int(r['seller']) == seller.role_id])
   == valuemod.MKT_MAX_PER_PLAYER - 1,
   'the other 9 are still on the shelf')
ok(seller.gold == 200000 - acc * mkmod.fee_of(200000, 100) + mkmod.net_of(100),
   #   ★ fee_of(余额, 价) —— 第一个参数是余额 ✗ 传错了就变成"免上架费"✓
   #     上架费 = 1% × 100 = 1 ✓（余额 ≥1000 时不免 ✓）
   'the seller paid %d listing fees and was paid the net (5%% tax): %d'
   % (acc, seller.gold))

print('--- 7. buy refusals ---')
sent[:] = []
W._mkt_do(buyer, 'buyitem', {'lid': cheap_lid})
ok(d_of('listres')['ok'] is False, 'buying the same (sold) listing again is refused')
own_lid = None
for lid, r in W.mkt['by_lid'].items():
    if int(r['seller']) == seller.role_id:
        own_lid = lid
        break
W._mkt_do(seller, 'buyitem', {'lid': own_lid})
ok(d_of('listres')['ok'] is False and '自己' in d_of('listres')['msg'],
   'buying your own listing is refused')
#   ★ 买不起：货架价 100 ✗ 穷人只有 19（上架费 1 已经花掉 ✗ 免上架费的不扣 ✓）
poor.gold = 5
sent[:] = []
W._mkt_do(poor, 'buyitem', {'lid': own_lid})
ok(d_of('listres')['ok'] is False and '不够' in d_of('listres')['msg'],
   'too little gold is refused: %s' % d_of('listres')['msg'])
ok(poor.gold == 5, 'the poor player was not charged anything')
sent[:] = []
W._mkt_do(buyer, 'buyitem', {'lid': 99999999})
ok(d_of('listres')['ok'] is False and '不在' in d_of('listres')['msg'],
   'buying something that does not exist is refused')

print('--- 8. the rollback path (the item vanished from the bag) ---')
gone = give_db_item(seller.role_id, item('会消失', tier=2))
load_bag(seller)
g_before = seller.gold
n_on_before = len(W.mkt['by_lid'])
sent[:] = []
W._mkt_do(seller, 'mklist', {'iid': gone, 'price': 500})
fee2 = mkmod.fee_of(g_before, 500)
ok(seller.gold == g_before - fee2, 'the fee was charged upfront (%d)' % fee2)
with dbmod.db(cfg) as c:               # ★ 模拟"这件被别的操作弄走了"
    c.execute('DELETE FROM items WHERE id=?', (gone,))
    c.commit()
run_saves()
tick()
ok(seller.gold == g_before, 'the fee came back after the failed listing (%d)' % seller.gold)
ok(d_of('listres')['ok'] is False and '退还' in d_of('listres')['msg'],
   'the seller was told it failed and the fee came back: %s' % d_of('listres')['msg'])
ok('上架失败' in d_of('listres')['msg'], 'the message says what happened (上架失败)')
with dbmod.db(cfg) as c:
    n = c.execute('SELECT COUNT(*) FROM listings WHERE seller=? AND state=?',
                  (seller.role_id, 'on')).fetchone()[0]
ok(n == valuemod.MKT_MAX_PER_PLAYER, 'the failed listing left no row behind (%d on)' % n)
ok(len(W.mkt['by_lid']) == n_on_before,
   'the optimistic row was removed again when the db said no (%d)'
   % len(W.mkt['by_lid']))
ok(all(int(l) > 0 for l in W.mkt['by_lid']),
   'no negative placeholder was left behind by the failed listing')

print('--- 9. unlist / claim ---')
target = None
for lid, r in W.mkt['by_lid'].items():
    if int(r['seller']) == seller.role_id:
        target = lid
        break
ok(target is not None, 'picked a listing to take down (%s)' % target)
t_name = dict(W.mkt['by_lid'][target]['it'])['name']
g_before = seller.gold
sent[:] = []
W._mkt_do(seller, 'unlist', {'lid': target})
#   ★ 下架【不回乐观回执】✗ 内存里当场就下架了 ✓ 回执等落库那条 ✓
ok(target not in W.mkt['by_lid'], 'it left the shelf at once (memory)')
ok(len(packs('listres')) == 0, 'no premature reply (the db has not answered yet)')
run_saves()
tick()
ok(len(packs('listres')) == 1 and d_of('listres')['ok'] is True,
   'exactly ONE reply after the commit: %r' % (packs('listres'),))
with dbmod.db(cfg) as c:
    st = c.execute('SELECT state FROM listings WHERE lid=?', (target,)).fetchone()[0]
    back = c.execute('SELECT COUNT(*) FROM items WHERE role_id=? AND'
                     " json_extract(item_json,'$.name')=?", (seller.role_id,
                                                             t_name)).fetchone()[0]
ok(st == 'cancelled', "the listing is state='cancelled'")
ok(back == 1, 'the item is back in the seller bag (%d)' % back)
ok(seller.gold == g_before, 'unlisting does not refund the fee (and does not charge again)')
sent[:] = []
W._mkt_do(seller, 'unlist', {'lid': target})
ok(len(packs('listres')) == 1 and d_of('listres')['ok'] is False,
   'unlisting the same one twice is refused politely')
#   别人的东西不能动
sent[:] = []
W._mkt_do(buyer, 'unlist', {'lid': list(W.mkt['by_lid'].keys())[0]})
ok(d_of('listres')['ok'] is False and '不是你' in d_of('listres')['msg'],
   'unlisting somebody else listing is refused')

print('--- 10. expiry ---')
exp_lid = None
for lid, r in W.mkt['by_lid'].items():
    if int(r['seller']) == seller.role_id:
        exp_lid = lid
        break
exp_name = dict(W.mkt['by_lid'][exp_lid]['it'])['name']
W.mkt['by_lid'][exp_lid]['exp'] = worldmod.now_s() - 1     # ★ 直接把它改成过期 ✓
sent[:] = []
W._mkt_do(buyer, 'buyitem', {'lid': exp_lid})
ok(d_of('listres')['ok'] is False and '过期' in d_of('listres')['msg'],
   'buying an expired listing is refused: %s' % d_of('listres')['msg'])
W._mkt_sweep()
ok(exp_lid not in W.mkt['by_lid'], 'the sweep took the expired row off the shelf')
run_saves()
tick()
with dbmod.db(cfg) as c:
    st = c.execute('SELECT state FROM listings WHERE lid=?', (exp_lid,)).fetchone()[0]
    back = c.execute('SELECT COUNT(*) FROM items WHERE role_id=? AND'
                     " json_extract(item_json,'$.name')=?", (seller.role_id,
                                                             exp_name)).fetchone()[0]
ok(st == 'expired', "the listing is state='expired'")
ok(back == 1, 'the expired item came back to the bag (%d)' % back)
sent[:] = []
W._mkt_do(seller, 'mylists', {})
ok(not [x for x in d_of('listpage')['rows'] if x['lid'] == exp_lid],
   'the expired row is not offered for buying any more')

print('--- 11. browsing (memory only) ---')
sent[:] = []
W._mkt_do(buyer, 'lists', {})
lp = d_of('listpage')
ok(bool(lp.get('rows')), 'the browse reply arrived')
ok(len(lp['rows']) == len(W.mkt['by_lid']), 'it shows every live row (%d)'
   % len(lp['rows']))
r0 = lp['rows'][0]
#   ★ round304g：从 10 格变成 11 格 —— 第 11 格是【完整 item_json】✓
#     为什么必须带上：交易所要拿它画和背包【一模一样】的图标 ✗
#     还要让玩家点开看到词条/耐久/数值 ✓（用户："不然玩家怎么看装备的属性"✓）
#     ★ 一页只有 20 件 ✗ 一件多几百字节真不算什么 ✓
#   ★ round304l：12 格了 —— 第 12 格是【还能买几个】（qty ✓ 做数量滑条要用 ✓）
#   ★ round304q：13 格了 —— 第 13 格是【原物品 id】（iid ✓ 用来精确认人 ✓）
ok(isinstance(r0, list) and len(r0) == 13,
   'rows carry 13 fields (item + qty left + original item id)')
ok(isinstance(r0[10], dict) and r0[10].get('name') == r0[5],
   'the 11th field really is that item (name matches): %r' % (r0[10].get('name'),))
ok(len(r0[9]) >= 4, 'the old icon hint (field 10) is still there as a fallback')
ok(lp.get('gold') == buyer.gold, 'the reply carries the balance')
ok(lp.get('total') == len(W.mkt['by_lid']), 'total matches the shelf')
ok(lp.get('page') == 1 and lp.get('pages') == 1, 'paging says page 1 of 1')
sent[:] = []
W._mkt_do(buyer, 'lists', {'cat': 'material'})
ok(len(d_of('listpage')['rows']) == 0, 'the material category is empty right now')
sent[:] = []
W._mkt_do(buyer, 'lists', {'cat': 'weapon'})
ok(len(d_of('listpage')['rows']) == len(W.mkt['by_lid']),
   'every live row is a weapon (they all are)')
sent[:] = []
W._mkt_do(buyer, 'lists', {'sort': 'price_desc', 'q': '堆货'})
ok(len(d_of('listpage')['rows']) >= 1, 'search by name works')
sent[:] = []
W._mkt_do(buyer, 'lists', {'sort': 'price_desc'})
prices = [x[1] for x in d_of('listpage')['rows']]
ok(prices == sorted(prices, reverse=True), 'price_desc really sorts by price')
sent[:] = []
W._mkt_do(buyer, 'lists', {'tier': 1})
ok(len(d_of('listpage')['rows']) == len(W.mkt['by_lid']), 'the 1-3 tier filter keeps them')
sent[:] = []
W._mkt_do(buyer, 'lists', {'tier': 3})
ok(len(d_of('listpage')['rows']) == 0, 'the 7-9 tier filter drops them')
#   只看买得起
buyer.gold = 50
sent[:] = []
W._mkt_do(buyer, 'lists', {'afford': 1})
ok(len(d_of('listpage')['rows']) == 0, 'the "only what I can afford" filter works')
buyer.gold = 100000
sent[:] = []
W._mkt_do(seller, 'mylists', {})
mpd = d_of('listpage')
ok(last('listpage') is not None and mpd.get('mine') == 1, 'my-listings has mine=1')
ok(mpd.get('on') == mkmod.count_of(W.mkt, seller.role_id), 'on-count matches the shelf')
ok(all('net' in x and 'tax' in x for x in mpd['rows']),
   'every "mine" row shows tax and net (the seller knows what he will get)')
ok(all(x['net'] == x['price'] - x['tax'] for x in mpd['rows']),
   'net == price - tax on every row')
ok(mpd.get('max') == valuemod.MKT_MAX_PER_PLAYER, 'the reply says what the cap is')

print('--- 12. the tick thread never wrote to the db ---')
with dbmod.db(cfg) as c:
    n_before = c.execute('SELECT COUNT(*) FROM items').fetchone()[0]
    l_before = c.execute('SELECT COUNT(*) FROM listings').fetchone()[0]
W._mkt_do(buyer, 'lists', {})
W._mkt_do(seller, 'mylists', {})
W._mkt_do(buyer, 'lists', {'cat': 'weapon', 'q': '堆'})
with dbmod.db(cfg) as c:
    n_after = c.execute('SELECT COUNT(*) FROM items').fetchone()[0]
    l_after = c.execute('SELECT COUNT(*) FROM listings').fetchone()[0]
ok(n_before == n_after and l_before == l_after, 'browsing changed nothing in the db')
ok(W.saves.empty(), 'browsing queued no saves either')

print('--- 13. selling a STACK by quantity (round304l) ---')
#   ★★ 用户："材料有堆叠数量，这个有注意吗" + "拉动数量条选择数量上架" ★★
#     这一段就是那两条要求的判据 ✓ 一个都不能少 ✓
sent[:] = []
#   给卖家一堆材料（碎玻璃 ×20 ✗ 可堆叠 ✓）
_mat = {'name': '碎玻璃', 'tier': 0, 'kind': 'material', 'rarity': 'common'}
stack_iid = give_db_item(seller.role_id, _mat, stack=20)
load_bag(seller)
seller.gold = 50000
W._mkt_do(seller, 'mklist', {'iid': stack_iid, 'price': 20, 'qty': 6})
ok(d_of('listres')['ok'] is True,
   'listing 6 out of a stack of 20 is accepted: %s' % d_of('listres').get('msg'))
run_saves()
tick()
with dbmod.db(cfg) as c:
    left = c.execute('SELECT stack FROM items WHERE id=?', (stack_iid,)).fetchone()
    lrow = c.execute('SELECT lid, price, qty, state FROM listings WHERE seller=?'
                     " AND state='on' ORDER BY lid DESC", (seller.role_id,)).fetchone()
ok(left is not None and int(left[0]) == 14,
   'the bag stack went 20 -> 14 (only the 6 we listed were taken: %s)'
   % (left[0] if left else None,))
ok(lrow is not None and int(lrow[2]) == 6,
   'the listing row says qty=6 (unit price 3): %s' % (tuple(lrow) if lrow else None,))
sq_lid = int(lrow[0]) if lrow else 0
ok(int(lrow[1]) == 20, 'the listing stores the UNIT price (20), not the total 120')
#   ★ 第 12 格（还能买几个）必须等于货架上剩的个数 ✗ 它是买家数量滑条的最大值 ✓
#     为什么单独盯它：这种"看着像取字段、其实写成常量"的错最难看出来 ✓
_pubq = mkmod.pub_row([r for r in W.mkt['by_lid'].values() if int(r['lid']) == sq_lid][0])
ok(int(_pubq[11]) == 6,
   'the published row says 6 left (that is the buyer slider max), got %r' % (_pubq[11],))

#   买家只买 2 个
buyer.gold = 5000
g0b = buyer.gold
sent[:] = []
W._mkt_do(buyer, 'buyitem', {'lid': sq_lid, 'qty': 2})
ok(d_of('listres')['ok'] is True, 'buying just 2 of the 6 is accepted: %s'
   % d_of('listres').get('msg'))
ok(buyer.gold == g0b - 40, 'the buyer paid unit x qty = 2 x 20 = 40 gold (%d -> %d)'
   % (g0b, buyer.gold))
rowsq = [r for r in W.mkt['by_lid'].values() if int(r['lid']) == sq_lid]
ok(len(rowsq) == 1 and int(rowsq[0]['qty']) == 4,
   'the shelf row still exists with qty 4 (partial purchase), got %r'
   % ([r['qty'] for r in rowsq],))
run_saves()
tick()
with dbmod.db(cfg) as c:
    lq = c.execute('SELECT qty, state FROM listings WHERE lid=?', (sq_lid,)).fetchone()
    got = c.execute("SELECT stack FROM items WHERE role_id=?"
                    " AND json_extract(item_json,'$.name')='碎玻璃'", (buyer.role_id,)).fetchone()
    tl = c.execute('SELECT qty, price FROM trade_log WHERE lid=? ORDER BY ts DESC',
                   (sq_lid,)).fetchone()
ok(int(lq[0]) == 4 and lq[1] == 'on',
   "the db listing is still 'on' with qty=4: %s" % (tuple(lq),))
ok(got is not None and int(got[0]) == 2, 'the buyer bag got exactly 2 (%s)'
   % (got[0] if got else None,))
ok(tl is not None and int(tl[0]) == 2 and int(tl[1]) == 40,
   'the trade row records qty=2 and the TOTAL price 40: %s' % (tuple(tl),))

#   买家把剩下的 4 个也买走 → 这一单应该下架
g0b = buyer.gold
sent[:] = []
W._mkt_do(buyer, 'buyitem', {'lid': sq_lid, 'qty': 9})
ok(d_of('listres')['ok'] is False and '只剩' in d_of('listres')['msg'],
   'asking for more than is left is refused: %s'
   % (d_of('listres').get('msg'),))
ok(sq_lid in W.mkt['by_lid'], 'and the listing stays on the shelf')
ok(buyer.gold == g0b, 'and nothing was charged')
sent[:] = []
W._mkt_do(buyer, 'buyitem', {'lid': sq_lid, 'qty': 4})
run_saves()
tick()
with dbmod.db(cfg) as c:
    lq2 = c.execute('SELECT qty, state FROM listings WHERE lid=?', (sq_lid,)).fetchone()
    bs = c.execute("SELECT stack FROM items WHERE role_id=?"
                   " AND json_extract(item_json,'$.name')='碎玻璃'", (buyer.role_id,)).fetchone()
ok(int(lq2[0]) == 0 and lq2[1] == 'sold',
   "buying the rest closes the listing (qty=0, state=sold): %s" % (tuple(lq2),))
ok(sq_lid not in W.mkt['by_lid'], 'and it is off the shelf in memory too')
ok(bs is not None and int(bs[0]) == 6,
   'the buyer bag stacks to 6 (2 + 4, one row): %s' % (bs[0] if bs else None,))

#   装备不许按数量卖（它本来就不堆叠 ✓）
weap_iid = give_db_item(seller.role_id, item('散件剑', tier=3))
load_bag(seller)
sent[:] = []
W._mkt_do(seller, 'mklist', {'iid': weap_iid, 'price': 100, 'qty': 5})
run_saves()
tick()
wq = None
for r in W.mkt['by_lid'].values():
    if int(r['seller']) == seller.role_id and r['name'] == '散件剑':
        wq = int(r['qty'])
ok(wq == 1, 'a weapon is forced to qty=1 even if the client asks for 5 (got %r)' % (wq,))

#   数量超过自己拥有的 → 拒（不静默截断 ✓）
load_bag(seller)
sent[:] = []
W._mkt_do(seller, 'mklist', {'iid': stack_iid, 'price': 20, 'qty': 99})
ok(d_of('listres')['ok'] is False and '只有' in d_of('listres')['msg'],
   'asking to list more than you own is refused: %s' % d_of('listres')['msg'])

print('--- 13b. the db → shelf round trip (round304r) ---')
#   ★★ 用户先看出来的 bug：买家的数量滑条不出来 ★★
#   根因是 auth.market_rows_of 的 SELECT 列顺序和 market.load_rows 解包顺序不一致 ✗
#     → qty 被当成 expire ✗ 于是【买家看到的所有上架单 qty 永远是 1】✓
#   ★ 这种"位置对不上"的错不报错 ✗ 只会安静地给错数据 ✓
#     所以必须有一条【从库读回来 → 装进货架 → 发给客户端】的端到端断言 ✓
with dbmod.db(cfg) as c:
    # ★ 挑一条【还在货架上、且数量大于 1】的（前面那条已经卖完了 ✗ 读不到 ✓）
    _rows = c.execute(
        "SELECT lid, seller, price, item_json, ts, expire, qty FROM listings"
        " WHERE state='on' ORDER BY lid").fetchall()
    print('      db has %d on-sale row(s)' % len(_rows))
_pub = None
for _r in mkmod.load_rows(_rows):
    if int(_r['qty']) > 1:
        _pub = mkmod.pub_row(_r)
        _rowq = int(_r['qty'])
        break
if _pub is None and _rows:
    # 没有 qty>1 的就退而求其次（照样能验列顺序 ✓）
    _one = mkmod.load_rows(_rows)[0]
    _pub = mkmod.pub_row(_one)
    _rowq = int(_one['qty'])
    _r = _one
ok(_pub is not None, 'a listing is readable back from the db (%d rows)' % len(_rows))
if _pub is not None:
    ok(int(_pub[11]) == _rowq,
       'the published "left" matches the row read from the db (%r vs %r)'
       % (_pub[11], _rowq))
    # ★ stack 不该是毫秒时间戳（那是列错位的典型症状 ✓）
    ok(int(_r.get('stack') or 1) < 1000,
       'stack is a small count, not a millisecond timestamp (%r)' % (_r.get('stack'),))
    # ★ 内存行的 exp 可能是毫秒（库里就是这么存的 ✓）
    #   全项目的规矩是：比大小之前【一律先过 market.exp_s()】✗ 只有那一个换算口 ✓
    #   所以这里验的是【归一化之后】是"还有几天"，而不是"原始值是秒"✓
    _left_days = (mkmod.exp_s(_r) - valuemod.now_s()) / 86400.0
    ok(0 < _left_days <= int(valuemod.MKT_DAYS) + 1,
       'after exp_s() the listing still has %.2f day(s) left (raw exp=%r)'
       % (_left_days, _r['exp']))

print('--- 14. the trade history payload (round304m) ---')
with dbmod.db(cfg) as c:
    n_log = c.execute('SELECT COUNT(*) FROM trade_log').fetchone()[0]
ok(n_log >= 3, 'the trade log has a row per transaction (%d incl. partials)' % n_log)

# ================================================================ 收尾
W.running = False
"""round304b: 这里原来断言"真库 md5 没变"✗ 那条是【站不住的】✓
   为什么：真服务器可能正开着 ✗ 它自己在写 game.db（自动存盘每 15 秒 ✓）
   → 文件 md5 必然变 ✗ 而这个变化跟本测试一点关系都没有 ✓
   → 一条"随时可能因为别人而变红"的断言 ✗ 比没有更糟 ✓（会把真问题淹掉 ✓）
   ★ 换成有意义且稳定的检查：
     ① 本测试用到的临时库一直在 ✗ 说明我们确实只在副本上写 ✓
     ② 真库的【业务数据】没被这次测试改动（角色数 / 物品数 / 上架数 ✓）
        ★ 但真服务器自己也在变这些数 ✗ 所以只对比"本测试开始时的值"
          ✗ 并且允许它变（那可能是服务器自己在正常干活 ✓）
        → 只断言：真库【还在】✗ 而且本测试没有往真库插上架单 ✓
     ③ 真库的 listings 里不能出现本测试造的那些卖家 id ✓（这条才是真检查 ✓）"""
ok(os.path.getsize(copy) > 0, 'the copy still exists (we only ever wrote to it)')

_live = sqlite3.connect('file:%s?mode=ro' % LIVE, uri=True)
try:
    _hit = _live.execute(
        "SELECT COUNT(*) FROM roles WHERE name LIKE 'Mkt%'").fetchone()[0]
    ok(_hit == 0, 'the LIVE db has none of this test fake roles (Mkt*)')
    _sane = _live.execute('SELECT COUNT(*) FROM roles').fetchone()[0]
    ok(_sane > 0, 'the LIVE db is still readable and intact (%d roles)' % _sane)
finally:
    _live.close()

shutil.rmtree(tmpdir, ignore_errors=True)
for _p in (copy, copy + '-wal', copy + '-shm'):
    try:
        os.remove(_p)
    except Exception:
        pass
print('')
print('FAILED: %d' % len(fails))
for f in fails:
    print('  - %s' % f)
sys.exit(1 if fails else 0)
