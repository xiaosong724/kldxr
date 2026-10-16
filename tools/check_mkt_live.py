# -*- coding: utf-8 -*-
"""round304b check #2: the exchange over the REAL server (HTTP + WebSocket + live db).

This is the "does it actually work when wired up" gate that check_mkt_logic.py cannot
give you: it goes through the real login path (welcome -> mktload -> memory shelf),
the real C2S protocol (mklist / lists / buyitem / unlist), the real saver thread and
the real db, then cleans up after itself (both roles and all their rows).

Run:  python tools/check_mkt_live.py        (the server must be up on 8899/8900)
"""
import base64
import json
import os
import socket
import sqlite3
import struct
import sys
import threading
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, 'server', 'game.db')
API = 'http://127.0.0.1:8899'
WS_HOST, WS_PORT = '127.0.0.1', 8900
PW = 'abc123456'
SELLER = 'MktLive卖'
BUYER = 'MktLive买'

fails = []


def ok(cond, msg, got=None):
    print(('  PASS  ' if cond else '  FAIL  ') + msg + ('' if cond else '   got=' + repr(got)))
    if not cond:
        fails.append(msg)


def http(method, path, body=None, token=None, admin=None):
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header('Content-Type', 'application/json; charset=utf-8')
    if token:
        req.add_header('X-Token', token)
    if admin:
        req.add_header('X-Admin', admin)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode('utf-8'))
        except Exception:
            return e.code, {}
    except Exception as e:
        return -1, {'error': repr(e)}


# ---------------------------------------------------------------- WS 客户端
class WS(object):
    """极简 WS 客户端（★ 从 tools/test_ws.py 抄的 ✗ 它已经被验证过 ✓）"""

    def __init__(self):
        self.sock = socket.create_connection((WS_HOST, WS_PORT), timeout=8)
        self.sock.settimeout(8)
        self.buf = b''
        self.q = []
        self.lock = threading.Lock()
        self.alive = True
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(('GET /ws HTTP/1.1\r\nHost: %s:%d\r\nUpgrade: websocket\r\n'
                           'Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\n'
                           'Sec-WebSocket-Version: 13\r\n\r\n'
                           % (WS_HOST, WS_PORT, key)).encode())
        hdr = b''
        while b'\r\n\r\n' not in hdr:
            c = self.sock.recv(1)
            if not c:
                raise RuntimeError('握手没回包')
            hdr += c
        self.handshake = hdr.decode('latin-1')
        self._t = threading.Thread(target=self._loop, daemon=True)
        self._t.start()

    @staticmethod
    def _frame(op, payload):
        n = len(payload)
        h = bytearray([0x80 | op])
        mk = os.urandom(4)
        if n < 126:
            h.append(0x80 | n)
        elif n < 65536:
            h.append(0x80 | 126)
            h += struct.pack('>H', n)
        else:
            h.append(0x80 | 127)
            h += struct.pack('>Q', n)
        h += mk
        m = mk * ((n >> 2) + 1)
        x = int.from_bytes(payload, 'big') ^ int.from_bytes(m[:n], 'big')
        return bytes(h) + x.to_bytes(n, 'big')

    def send(self, t, **d):
        self.sock.sendall(self._frame(0x1, json.dumps({'t': t, 'd': d},
                                                      ensure_ascii=False).encode()))

    def _exact(self, n):
        while len(self.buf) < n:
            c = self.sock.recv(65536)
            if not c:
                return None
            self.buf += c
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _loop(self):
        try:
            while self.alive:
                h = self._exact(2)
                if not h:
                    break
                op = h[0] & 0x0F
                ln = h[1] & 0x7F
                if ln == 126:
                    ln = struct.unpack('>H', self._exact(2))[0]
                elif ln == 127:
                    ln = struct.unpack('>Q', self._exact(8))[0]
                data = self._exact(ln) if ln else b''
                if data is None:
                    break
                if op == 0x9:
                    self.sock.sendall(self._frame(0xA, data))
                    continue
                if op == 0x1:
                    try:
                        o = json.loads(data.decode('utf-8'))
                    except Exception:
                        continue
                    with self.lock:
                        self.q.append(o)
        except Exception:
            pass
        finally:
            self.alive = False

    def take(self, timeout=1.0):
        end = time.time() + timeout
        while time.time() < end:
            with self.lock:
                if self.q:
                    return self.q.pop(0)
            time.sleep(0.01)
        return None

    def wait(self, t, timeout=10, **match):
        end = time.time() + timeout
        while time.time() < end:
            o = self.take(max(0.05, end - time.time()))
            if o is None or o.get('t') != t:
                continue
            d = o.get('d') or {}
            if all(d.get(k) == v for k, v in match.items()):
                return d
        return None

    def collect(self, t, seconds=2.0):
        """收一段时间里所有某类消息（★ 就这么简单 ✗ 别猜时间点 ✓）

        ★ 为什么不"先 drain 再 wait 最终那条"：两条回执可能只差几十毫秒 ✗
          drain 的窗口会把最终那条一起丢掉 ✓（自测当场踩到 ✓）
        """
        out = []
        end = time.time() + seconds
        while time.time() < end:
            o = self.take(max(0.05, end - time.time()))
            if o is not None and o.get('t') == t:
                out.append(o.get('d') or {})
        return out

    def last_me(self):
        """最近一拍的 me.gold（★ 服务器每拍都推 ✓ 权威值 ✓）"""
        for o in reversed(list(self.q)):
            if o.get('t') == 'world':
                me = (o.get('d') or {}).get('me') or {}
                if 'gold' in me:
                    return int(me['gold'])
        return None

    def close(self):
        self.alive = False
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except Exception:
            pass
        try:
            self.sock.close()
        except Exception:
            pass


# ---------------------------------------------------------------- 清理
def purge():
    c = sqlite3.connect(DB, timeout=8)
    try:
        for nm in (SELLER, BUYER):
            row = c.execute('SELECT id, account_id FROM roles WHERE name=?', (nm,)).fetchone()
            if not row:
                continue
            rid, aid = row
            c.execute("UPDATE listings SET state='cancelled' WHERE seller=? AND state='on'",
                      (rid,))
            c.execute('DELETE FROM trade_log WHERE seller=? OR buyer=?', (rid, rid))
            c.execute('DELETE FROM items WHERE role_id=?', (rid,))
            c.execute('DELETE FROM pending_gold WHERE role=?', (rid,))
            c.execute('DELETE FROM roles WHERE id=?', (rid,))
            if aid:
                c.execute('DELETE FROM tokens WHERE account_id=?', (aid,))
                c.execute('DELETE FROM accounts WHERE id=?', (aid,))
        c.commit()
    finally:
        c.close()


def role_of(name):
    c = sqlite3.connect('file:%s?mode=ro' % DB, uri=True)
    try:
        r = c.execute('SELECT id, gold FROM roles WHERE name=?', (name,)).fetchone()
        return (int(r[0]), int(r[1])) if r else (None, None)
    finally:
        c.close()


def db_one(sql, args=()):
    c = sqlite3.connect('file:%s?mode=ro' % DB, uri=True)
    try:
        return c.execute(sql, args).fetchone()
    finally:
        c.close()


def gold_of(name):
    """从【服务器推给我的快照】里读余额（★ 权威是内存 ✗ 落库是异步的 ✓）

    ★ 为什么不读库：金币内存权威 ✗ 落库要等 15 秒定时存盘 ✓
      拿库里的值当余额 → 测试会误报"没钱"✗（自测当场踩到 ✓）
    ★ 这条同时也是在验"me.gold 每拍都推给客户端"（第 294 轮那条路 ✓）
    """
    ws = _WS_BY_NAME.get(name)
    if ws is None:
        return role_of(name)[1]
    d = ws.last_me()
    return d if d is not None else role_of(name)[1]


def wait_gold(name, want, timeout=8.0):
    """等余额到位（★ 可能涨也可能跌 ✗ 所以比的是绝对值差 ✓）"""
    end = time.time() + timeout
    base = gold_of(name)
    while time.time() < end:
        cur = gold_of(name)
        if cur is not None and abs(cur - want) <= 1:
            return True
        time.sleep(0.15)
    _ = base
    return False


_WS_BY_NAME = {}


def _wait_buyer_gold(tok, want, timeout):
    """等买家的钱【真的进内存】（★ 详见调用处那段注释 ✓）

    ★ 判据用两个（哪个先成立都行 ✗ 两个都查才稳 ✓）：
        ① 他自己那一拍的 me.gold 够数了（权威值 ✓）
        ② pending_gold 里没有 done=0 的行（说明没掉进那条慢路 ✓）
    ★ 为什么不能只看 ①：钱要是掉进 pending ✗ me.gold 永远不会动 ✓
      那时候必须【报错】而不是死等 ✓（注释里写清了这个 gap ✓）
    """
    end = time.time() + timeout
    last = None
    while time.time() < end:
        last = gold_of(BUYER)
        if last is not None and last >= want:
            return True
        row = db_one('SELECT COUNT(*) FROM pending_gold WHERE role='
                     ' (SELECT id FROM roles WHERE name=?) AND done=0', (BUYER,))
        if row and row[0] and (last or 0) == 0:
            print('    [note] the money is sitting in pending_gold (the offline path)'
                  ' - it would arrive on the NEXT login')
        time.sleep(0.4)
    print('    [note] buyer gold after waiting: %r' % (last,))
    return False


purge()
try:
    print('== 0. 准备（真注册 + 真登录）==')
    st, j = http('POST', '/api/register', {'name': SELLER, 'password': PW})
    ok(st == 200 and j.get('token'), 'registered the seller (%s)' % st, j)
    tok_s = j['token']
    st, j = http('POST', '/api/register', {'name': BUYER, 'password': PW})
    ok(st == 200 and j.get('token'), 'registered the buyer (%s)' % st, j)
    tok_b = j['token']
    st, j = http('POST', '/api/admin/login', {'password': 'xiuxian-admin'})
    at = j.get('token')
    ok(bool(at), 'admin login ok', j)
    # ★ 管理端【没有给金币】这个动作 ✗（只有给物品 ✓）
    #   → 想让买家真有钱 ✗ 只能让他【卖东西给系统】挣（顺便把那条路也验一遍 ✓）
    #   ★★ 顺序很重要：这笔钱要等他【进了世界之后】再挣 ✓
    #     为什么（自测被它坑了四次 ✗ 而且是间歇性的 ✓）：
    #       卖系统 → 钱走 'gain' 意图 → tick 记账 ✓
    #       如果那几百毫秒里他还没进世界 ✗ 这笔钱会落进 pending_gold ✓
    #       而 pending_gold【只在登录那一刻读一次】✗ 本会话就永远看不到它 ✓
    #       → 表现：买家 me.gold 一直是 0 ✗ 测试报"金币不够"✓（真机上是重登就到账 ✓）
    #     → 现在改成"先上线 ✗ 再挣钱"✗ 这才是真实玩法路径 ✓ 没有窗口 ✓
    st, j = http('GET', '/api/profile', token=tok_s)
    ok(st == 200, 'profile ok', j)

    # 给卖家一件装备（管理端给武器 ✓ 会真写进 items ✓）
    for _ in range(2):
        http('POST', '/api/admin/act',
             {'act': 'give', 'name': SELLER, 'kind': 'sword', 'tier': 3}, admin=at)
    st, bag = http('GET', '/api/bag', token=tok_s)
    ids = [x['id'] for x in (bag.get('items') or [])]
    ok(len(ids) >= 2, 'the seller has 2 items in the bag (%d)' % len(ids), bag)

    print('== 1. 上线（登录装载货架）==')
    ws_s = WS()
    _WS_BY_NAME[SELLER] = ws_s
    ws_s.send('hello', token=tok_s, ver=1)
    w = ws_s.wait('welcome', timeout=10)
    ok(w is not None, 'the seller got welcome')
    ws_b = WS()
    _WS_BY_NAME[BUYER] = ws_b
    ws_b.send('hello', token=tok_b, ver=1)
    wb = ws_b.wait('welcome', timeout=10)
    ok(wb is not None, 'the buyer got welcome')
    time.sleep(0.6)

    # ★ 买家现在已经在世界里了 ✗ 这时候挣钱才会【真进内存】✓
    for _ in range(3):
        http('POST', '/api/admin/act',
             {'act': 'give', 'name': BUYER, 'kind': 'sword', 'tier': 4}, admin=at)
    st, bag_b = http('GET', '/api/bag', token=tok_b)
    b_ids = [x['id'] for x in (bag_b.get('items') or [])]
    ok(len(b_ids) >= 3, 'the buyer has 3 items to sell (%d)' % len(b_ids), bag_b)
    st, sold = http('POST', '/api/sell', {'iids': b_ids}, token=tok_b)
    ok(sold.get('ok') and sold.get('total', 0) >= 1000,
       'the buyer earned %s by selling to the system' % sold.get('total'), sold)
    ok(_wait_buyer_gold(tok_b, 1000, 25.0),
       'the buyer balance really arrived in memory (%s)' % gold_of(BUYER))

    print('== 2. 上架（真协议 + 真落库）==')
    ws_s.send('mklist', iid=ids[0], price=1000, sid='live-1')
    d = ws_s.wait('listres', timeout=10)
    ok(d is not None and d.get('ok') is True, 'mklist accepted: %s' % (d or {}).get('msg'), d)
    #   ★ 最终回执一定带 refresh=1（乐观那条不带 ✓ 见 _mkt_list / _mkt_drain）
    oks = [x for x in ws_s.collect('listres', 3.0) if x.get('refresh') == 1]
    ok(len(oks) == 1 and oks[0].get('lid'),
       'the final "listed" reply arrived after the commit: %s'
       % (oks[0].get('msg') if oks else None), oks)
    time.sleep(0.4)
    row = db_one("SELECT lid, price, state FROM listings WHERE seller=?"
                 " ORDER BY lid DESC", (role_of(SELLER)[0],))
    ok(row is not None and row[2] == 'on' and int(row[1]) == 1000,
       'the listing row is in the live db: %s' % (tuple(row) if row else None,))
    lid = int(row[0]) if row else 0
    gone = db_one('SELECT COUNT(*) FROM items WHERE id=?', (ids[0],))
    ok(gone[0] == 0, 'the listed item left the items table (%s)' % (gone[0],))
    fee = max(1, min(100, (1000 + 99) // 100))
    got = gold_of(SELLER)
    ok(wait_gold(SELLER, 0), 'the seller gold is readable')
    ok(got is not None, 'gold after listing = %s' % got)

    print('== 3. 买家看货架（纯内存 ✓）==')
    # ★★ round304c：先走 mktopen（= 面板上点开交易所 ✓ 会重读库 ✓）★★
    #   为什么必须验这条：内存货架以前【只有卖家=自己】那一份 ✗
    #   → 买家打开面板会是空的 ✓（自测当场就是这个现象 ✓）
    ws_b.send('mktopen', cat='all', sort='price')
    ws_b.collect('listpage', 2.0)          # 先收掉可能还在路上的旧页 ✓
    ws_b.send('mktopen', cat='all', sort='price')
    lp = None
    end = time.time() + 10
    while time.time() < end and lp is None:
        cand = ws_b.wait('listpage', timeout=2)
        if cand and cand.get('rows') is not None and cand.get('mine') == 1:
            continue                        # ★ mktopen 会先发浏览页 ✗ 再发"我的上架"✓
        lp = cand
    ok(lp is not None and lp.get('rows') is not None, 'the buyer got a listpage', lp)
    mine = [r for r in (lp or {}).get('rows', []) if r[0] == lid]
    ok(len(mine) == 1,
       "the SELLER's listing is visible to the BUYER (the whole shelf was loaded): %d of %d"
       % (len(mine), len((lp or {}).get('rows') or [])))
    ok(lp.get('gold') == gold_of(BUYER), 'the page carries the buyer balance (%s vs %s)'
       % (lp.get('gold'), gold_of(BUYER)))
    #   ★ 顺手验"背包快照会刷新"：买家刚把东西全卖了 ✗ 此刻的背包应该是空的 ✓
    #     （★ 别拿 bag_b 当"现在"✗ 那是卖东西【之前】读的 ✓ 自测踩过这个 ✓）
    st, bag_now = http('GET', '/api/bag', token=tok_b)
    now_ids = [x['id'] for x in (bag_now.get('items') or [])]
    ok(not now_ids, 'the buyer bag really is empty now (%d left)' % len(now_ids))

    print('== 4. 购买（真成交 + 5% 税）==')
    b_gold0 = gold_of(BUYER)
    s_gold0 = gold_of(SELLER)
    ws_b.send('buyitem', lid=lid, sid='live-buy-1')
    d = ws_b.wait('listres', timeout=10)
    ok(d is not None and d.get('ok') is True, 'buyitem accepted: %s' % (d or {}).get('msg'), d)
    fin = [x for x in ws_b.collect('listres', 3.0)
           if x.get('refresh') == 1 and x.get('kind') == 'buy']
    d_fin = fin[0] if fin else None
    ok(d_fin is not None, 'the final "bought" reply arrived: %s' % (d_fin or {}).get('msg'))
    ok(d_fin and '【' in d_fin.get('msg', '') and 'None' not in d_fin.get('msg', ''),
       'the message names the item: %s' % (d_fin or {}).get('msg'))
    tax = 1000 * 5 // 100
    net = 1000 - tax
    ok(wait_gold(BUYER, b_gold0 - 1000), 'the buyer paid 1000 (%s -> %s)'
       % (b_gold0, gold_of(BUYER)))
    ok(wait_gold(SELLER, s_gold0 + net), 'the seller received %d net (%s -> %s)'
       % (net, s_gold0, gold_of(SELLER)))
    time.sleep(0.5)
    st_row = db_one('SELECT state FROM listings WHERE lid=?', (lid,))
    ok(st_row is not None and st_row[0] == 'sold', "the listing is 'sold' in the db")
    tl = db_one('SELECT buyer, price, tax FROM trade_log WHERE lid=?', (lid,))
    ok(tl is not None and int(tl[1]) == 1000 and int(tl[2]) == tax,
       'trade_log has the trade (price=1000 tax=%d): %s' % (tax, tuple(tl) if tl else None))
    got_item = db_one("SELECT COUNT(*) FROM items WHERE role_id=?"
                      " AND json_extract(item_json,'$.name')=?",
                      (role_of(BUYER)[0], (bag['items'][0]['item'].get('name') or '')))
    ok(got_item[0] == 1, 'the item is in the buyer bag (%s)' % (got_item[0],))
    ok(gone[0] == 0, 'the item is not in the seller bag')

    print('== 5. 重复买同一件（幂等 / 已售）==')
    ws_b.send('buyitem', lid=lid, sid='live-buy-2')
    d = ws_b.wait('listres', timeout=10)
    ok(d is not None and d.get('ok') is False, 'buying it twice is refused: %s'
       % (d or {}).get('msg'), d)
    ok(abs((gold_of(BUYER) or 0) - (b_gold0 - 1000)) <= 1,
       'the buyer was not charged twice (%s -> %s)' % (b_gold0, gold_of(BUYER)))

    print('== 6. 下架（退回背包）==')
    ws_s.send('mklist', iid=ids[1], price=500, sid='live-2')
    d = ws_s.wait('listres', timeout=10, ok=True)
    time.sleep(0.5)
    row2 = db_one("SELECT lid FROM listings WHERE seller=? AND state='on'"
                  " ORDER BY lid DESC", (role_of(SELLER)[0],))
    ok(row2 is not None, 'the second listing is on the shelf: %s' % (row2,))
    lid2 = int(row2[0]) if row2 else 0
    ws_s.send('unlist', lid=lid2)
    d = ws_s.wait('listres', timeout=10)
    ok(d is not None and d.get('ok') is True, 'unlist accepted')
    #   ★ 下架这条【没有乐观回执】（内存里当场就下架了 ✗ 落库是异步的 ✓）
    #     所以最终那条就是 refresh=1 那条 ✓ 收 3 秒等它 ✓
    u = [x for x in ws_s.collect('listres', 3.0) if x.get('refresh') == 1]
    ok(len(u) == 1, 'the final "unlisted" reply arrived: %s'
       % (u[0].get('msg') if u else None), u)
    time.sleep(0.5)
    st2 = db_one('SELECT state FROM listings WHERE lid=?', (lid2,))
    ok(st2 is not None and st2[0] == 'cancelled', 'the listing is cancelled: %s' % (st2,))
    back = db_one("SELECT COUNT(*) FROM items WHERE role_id=?"
                  " AND json_extract(item_json,'$.name')=?",
                  (role_of(SELLER)[0], bag['items'][1]['item'].get('name') or ''))
    ok(back[0] == 1, 'the item came back to the seller bag (%s)' % (back[0],))

    print('== 7. 我的上架（含税/净额）==')
    ws_s.send('mylists')
    mp = ws_s.wait('listpage', timeout=10)
    ok(mp is not None and mp.get('mine') == 1, 'mylists answered with mine=1', mp)
    ok(mp.get('on') == 0, 'nothing is on sale now (sold + unlisted): on=%s' % mp.get('on'))
    ok(all('tax' in r and 'net' in r for r in (mp.get('rows') or [])),
       'my-listings carries tax and net for every row')

    print('== 8. 协议拒绝没注册的类型 ==')
    ws_s.send('mklist', iid=ids[1], price=500)          # ★ 缺字段不行 ✓
    d = ws_s.wait('listres', timeout=6)
    ok(d is None or d.get('ok') is not None, 'no crash on a malformed mklist')

    print('== 9. 服务器还活着，tick 没被拖慢 ==')
    st, h = http('GET', '/api/health')
    ok(st == 200 and h.get('ok'), 'health ok', h)
    ok(h['world']['tickMs'] < 20, 'tick is fine (%s ms)' % h['world']['tickMs'])
finally:
    try:
        ws_s.close()
    except Exception:
        pass
    try:
        ws_b.close()
    except Exception:
        pass
    time.sleep(0.5)
    purge()
    if sys.exc_info()[0] is not None:
        # ★ 自测被这个坑了一次：try/finally 没有 except ✗
        #   异常被 finally 吞掉 ✗ 只看到"FAILED: 0"✗ 完全不知道发生了什么 ✓
        print('!! the test body raised: %r' % (sys.exc_info()[1],))
        fails.append('the test body raised an exception')
    left = db_one("SELECT COUNT(*) FROM roles WHERE name IN (?,?)", (SELLER, BUYER))
    print('')
    print('leftover roles: %s' % (left[0] if left else '?'))
    print('FAILED: %d' % len(fails))
    for f in fails:
        print('  - %s' % f)
    sys.exit(1 if fails else 0)
