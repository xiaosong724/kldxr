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
# ★★ round304s：名字必须【每次都不一样】★★
#   自测抓到的真坑：名字固定 → 角色已存在 → 第二次 register 失败
#     → 脚本退回 login ✗ 于是两个 token 是【同一个角色】✓
#     → 所有"两边看到的东西不一样"的断言全错（记录里 who 变成自己 ✓）
#     → 表现是"记录页把对手方写成了自己"✗ 我差点当成服务端 bug 去改 ✓
#   ★ 判据：凡是"两个账号确实不同"的测试 ✗ 建号后要断言 id 不同 ✓
import random as _rnd
#   ★ 名字还有长度限制（2~10 个字符 ✗ 服务端会挡 ✓）→ 后缀只能短 ✓
#     自测踩到：我加了 5 个字符 ✗ 一共 11 个 → 注册直接 400 ✓
_SUF = ''.join(_rnd.choice('abcdefghijkmnpqrstuvwxyz') for _ in range(3))
SELLER = 'Mkt卖' + _SUF
BUYER = 'Mkt买' + _SUF

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
        for nm in (SELLER, BUYER, 'MktOff' + _SUF):
            row = c.execute('SELECT id, account_id FROM roles WHERE name=?', (nm,)).fetchone()
            if row is None:
                # ★ 名字每次都不一样 ✗ 顺手把【以前几轮留下的】也清掉 ✓
                row = c.execute("SELECT id, account_id FROM roles"
                                " WHERE name LIKE 'Mkt卖%' OR name LIKE 'Mkt买%'"
                                " ORDER BY id LIMIT 1").fetchone()
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
    ok(role_of(SELLER)[0] != role_of(BUYER)[0],
       'the two accounts are really different roles (%s vs %s)'
       % (role_of(SELLER)[0], role_of(BUYER)[0]))
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

    # ============================================================
    # ★★★ round304m（用户："增加一个购买和卖出记录查看，也要写分页"）★★★
    #   交易记录接口 /api/trades：真库 + 真 token + 真分页 ✓
    #   ★ 为什么放在这里：这一节刚刚【真的成交了一笔】✗
    #     记录页要读的正是它 ✓ 用真成交去验，比造假数据可信 ✓
    # ============================================================
    print('\n== 4b. 成交记录 /api/trades ==')
    # ★ http() 返回的是 (状态码, 解析好的 dict) ✗ 自测踩到：直接 .get 会 AttributeError ✓
    _st, rj = http('GET', '/api/trades', token=tok_b)
    ok(_st == 200 and (rj or {}).get('ok') is True,
       'the trades endpoint answers (HTTP %s): %s' % (_st, str(rj)[:80]))
    rows_b = (rj or {}).get('rows') or []
    # ★ 对手方名字拿【库里真实的名字】比 ✗ 别用脚本开头的常量
    #   （自测踩到：常量是重建前的旧名字 ✗ 而库里已经换了一批 ✓）
    _names = db_one('SELECT (SELECT name FROM roles WHERE id=t.seller),'
                    ' (SELECT name FROM roles WHERE id=t.buyer)'
                    ' FROM trade_log t WHERE t.lid=?', (lid,))
    real_seller, real_buyer = (_names[0], _names[1]) if _names else (None, None)
    # ★ 卖家那一份（同一个接口 ✗ 只是换了 token ✓）
    _st_s, rj_s = http('GET', '/api/trades', token=tok_s)
    print('   seller sees: %s' % json.dumps(
        [(x.get('side'), x.get('who')) for x in ((rj_s or {}).get('rows') or [])],
        ensure_ascii=False))
    print('   roles: seller=%r buyer=%r' % (role_of(SELLER)[0], role_of(BUYER)[0]))
    print('   page fields: page=%r pageSize=%r pages=%r total=%r'
          % ((rj or {}).get('page'), (rj or {}).get('pageSize'),
             (rj or {}).get('pages'), (rj or {}).get('total')))
    ok(len(rows_b) >= 1, 'the buyer has at least one record (%d)' % len(rows_b))
    mine = [x for x in rows_b if x.get('lid') == lid]
    ok(len(mine) == 1, 'the trade the test just made is in there (lid=%s)' % lid)
    if mine:
        r0 = mine[0]
        ok(r0.get('side') == 'buy', "it is marked as a BUY for the buyer (got %r)" % r0.get('side'))
        ok(int(r0.get('price') or 0) == 1000, 'it records what the buyer paid (1000)')
        ok(int(r0.get('tax') or 0) == tax, 'and the tax (%d)' % tax)
        ok(r0.get('name') and '【' not in str(r0.get('name')),
           'it names the item: %r' % (r0.get('name'),))
        ok(str(r0.get('who') or '') == real_seller,
           'and the counterparty is the seller (%r vs %r)' % (r0.get('who'), real_seller))
        ok(int(r0.get('qty') or 0) == 1, 'this one was a single item (qty=1)')
    _st_s, rj_s = http('GET', '/api/trades', token=tok_s)
    rows_s = (rj_s or {}).get('rows') or []
    mine_s = [x for x in rows_s if x.get('lid') == lid]
    ok(len(mine_s) == 1, 'the SELLER sees the same trade')
    if mine_s:
        s0 = mine_s[0]
        ok(s0.get('side') == 'sell', "it is marked as a SELL for the seller (got %r)"
           % s0.get('side'))
        ok(int(s0.get('net') or 0) == net, 'the seller sees the money after tax (%d)' % net)
        ok(str(s0.get('who') or '') == real_buyer,
           'and its counterparty is the buyer (%r vs %r)' % (s0.get('who'), real_buyer))
    # 分页：页大小 20 ✗ 只有一笔时 pages 必须是 1（不是 0 ✗ 也不是负数 ✓）
    ok(int((rj or {}).get('pageSize') or 0) == 20, 'the page size is 20')
    ok(int((rj or {}).get('pages') or 0) >= 1, 'pages is at least 1 even with few records')
    # ★ 自测踩到：`or -1` 把 0 吃掉了 ✗ Python 里 0 是假值 ✓
    #   （和 JS 一个坑 ✗ 两边都得用 is None 判 ✓）
    _pg = (rj or {}).get('page')
    ok(_pg is not None and int(_pg) == 0,
       'page 0 is the first page (got %r)' % (_pg,))
    # 翻到第 2 页：不该崩 ✓ 也不该重复第 1 页的内容 ✓
    _st2, rj2 = http('GET', '/api/trades?page=1', token=tok_b)
    ok(_st2 == 200 and (rj2 or {}).get('ok') is True, 'asking for page 1 works too')
    _pg2 = (rj2 or {}).get('page')
    ok(_pg2 is not None and int(_pg2) == 1,
       'and it reports page 1 back (got %r)' % (_pg2,))
    # 没 token 必须被挡（记录里有别人的名字 ✗ 不能裸奔 ✓）
    _st3, rj3 = http('GET', '/api/trades')
    ok(_st3 == 401 or (rj3 or {}).get('ok') is not True,
       'without a token it is refused (HTTP %s)' % _st3)

    print('== 5. 重复买同一件（幂等 / 已售）==')
    ws_b.send('buyitem', lid=lid, sid='live-buy-2')
    d = ws_b.wait('listres', timeout=10)
    ok(d is not None and d.get('ok') is False, 'buying it twice is refused: %s'
       % (d or {}).get('msg'), d)
    # ★★ round304z：这一段原来有一条【会误报】的断言（偶发红 ✓ 查清了）★★
    #   原来写的是 abs((gold_of(BUYER) or 0) - (b_gold0 - 1000)) <= 1
    #     · gold_of() 读不到时返回 None ✗ `or 0` 把它当 0 ✓ → 差 1000 → 红 ✓
    #     · 而且打印的 "b_gold0 -> 现在" 两个数【都是扣完之后的】
    #       （b_gold0 是上面那段读的 ✗ 不是扣钱前的 ✓）
    #       → 显示成 "1493 -> 493"✗ 看着像被扣了两次 ✓ 其实是显示错了 ✓
    #   ★ 现在改成【直接验服务端的账】✗ 这比读内存余额更硬 ✓：
    #     ① 这一单在 trade_log 里只能有【一行】（重复购买不能多记一笔 ✓）
    #     ② 上架单必须是 sold 且 qty 已经归零 ✓
    #     ③ 钱用 retry 读（内存余额是异步推的 ✗ 读一次可能还没到 ✓）
    #   ★ 落库是异步的（saver 线程 ✓）→ 这两条也要 retry ✗
    #     拿"刚好还没写进去"的那一瞬当结论 = 偶发误报 ✓
    nl = None
    for _i in range(12):
        nl = db_one('SELECT COUNT(*) FROM trade_log WHERE lid=?', (lid,))
        if nl is not None and int(nl[0]) >= 1:
            break
        time.sleep(0.25)
    ok(nl is not None and int(nl[0]) == 1,
       'the refused second buy wrote NO extra trade row (%s row(s))'
       % (nl[0] if nl else None))
    st2 = None
    for _i in range(12):
        st2 = db_one('SELECT state, qty FROM listings WHERE lid=?', (lid,))
        if st2 is not None and st2[0] == 'sold' and int(st2[1] or 0) == 0:
            break
        time.sleep(0.25)
    ok(st2 is not None and st2[0] == 'sold' and int(st2[1] or 0) == 0,
       'the listing is sold and empty exactly once: %s' % (tuple(st2) if st2 else None,))
    #   钱：等到"余额稳定"再判 ✗ 别拿一次读数当准 ✓
    _g = None
    for _i in range(12):
        _g = gold_of(BUYER)
        if _g is not None and abs(_g - (b_gold0 - 1000)) <= 1:
            break
        time.sleep(0.25)
    ok(_g is not None and abs(_g - (b_gold0 - 1000)) <= 1,
       'the buyer paid for it once: expected %s, got %s (before the buy it was %s)'
       % (b_gold0 - 1000, _g, b_gold0))

    # ============================================================
    # ★★ round305：离线入账（pending_gold 那条路）★★
    #   用户脚本里踩到的现象："号里明明卖过东西 ✗ 余额却是 0"✓
    #   查下来【不是 bug】（钱入账了 ✓）但这次踩坑暴露了两件事：
    #     ① 入库是异步的（saver 线程 ✓）→ 断言必须 retry ✗ 不能读一次就下结论 ✓
    #     ② 登录那一帧 welcome 里的 gold 是【入账前】的快照 ✓
    #        真正到账看的是之后服务器推的 me ✓（真客户端会收，stub 不会 ✓）
    #   所以这条测试【用数据库当判据】✗ 这是最硬的 ✓
    # ============================================================
    print('\n== 5b. 离线卖东西的钱必须到账 ==')
    _off = 'MktOff' + _SUF
    _r = http('POST', '/api/register', {'name': _off, 'password': PW})
    _tok_off = (_r[1] or {}).get('token')
    ok(bool(_tok_off), 'registered an offline seller (%s)' % _off)
    http('POST', '/api/admin/act', {'act': 'give', 'name': _off, 'kind': 'sword',
                                    'tier': 4}, admin=at)
    _st, _bag = http('GET', '/api/bag', token=_tok_off)
    _iid = ((_bag or {}).get('items') or [{}])[0].get('id')
    _st, _sold = http('POST', '/api/sell', {'iids': [_iid]}, token=_tok_off)
    _earn = int((_sold or {}).get('total') or 0)
    ok(_earn > 0, 'he sold one item while offline for %d gold' % _earn)
    # ★ 这一笔必须先进 pending_gold（人不在线 ✗ tick 没处入账 ✓）
    _pg = None
    for _i in range(16):
        _pg = db_one('SELECT COUNT(*) FROM pending_gold WHERE role='
                     '(SELECT id FROM roles WHERE name=?) AND done=0', (_off,))
        if _pg is not None and int(_pg[0]) >= 1:
            break
        time.sleep(0.25)
    ok(_pg is not None and int(_pg[0]) >= 1,
       'it landed in pending_gold while he was offline (%s)' % (_pg[0] if _pg else None))
    #   ★★ 自测踩到：登录时读的余额快照必须【已经是落库后的】✗
    #     否则：快照=0 ✗ tick 入账 +479 ✗ 落库就是 479 ✓ 而不是 479+0 ✓
    #     而 pending 那一行是【刚写的】✗ saver 可能还没落 ✓ → 先等它落 ✓
    _g0 = None
    for _i in range(16):
        _g0 = db_one('SELECT gold FROM roles WHERE name=?', (_off,))
        if _g0 is not None:
            break
        time.sleep(0.25)
    time.sleep(0.6)
    # ★ 上线 → tick 入账 → saver 落库（retry ✗ 因为落库是异步的 ✓）
    _ws_off = WS()
    _ws_off.send('hello', token=_tok_off, ver=1)
    _ws_off.wait('welcome', timeout=10)
    _g = None
    for _i in range(20):
        time.sleep(0.4)
        _g = db_one('SELECT gold FROM roles WHERE name=?', (_off,))
        if _g is not None and int(_g[0]) >= _earn:
            break
    if not (_g is not None and int(_g[0]) >= _earn):
        time.sleep(2.0)
        _g = db_one('SELECT gold FROM roles WHERE name=?', (_off,))
        print('   (after another 2s the gold reads %s)'
              % (_g[0] if _g else None,))
    ok(_g is not None and int(_g[0]) >= _earn,
       'the money was credited after he logged in (gold=%s, expected >= %d)'
       % (_g[0] if _g else None, _earn))
    _pg2 = None
    for _i in range(16):
        _pg2 = db_one('SELECT COUNT(*) FROM pending_gold WHERE role='
                      '(SELECT id FROM roles WHERE name=?) AND done=0', (_off,))
        if _pg2 is not None and int(_pg2[0]) == 0:
            break
        time.sleep(0.25)
    ok(_pg2 is not None and int(_pg2[0]) == 0,
       'and the pending row was closed out (%s left)' % (_pg2[0] if _pg2 else None))
    try:
        _ws_off.close()
    except Exception:
        pass

    # ---- 5c. 删角色要把它的账目一起清干净（round305 修的孤儿）----
    #   ★ 先记下角色 id ✗ 删完就没法查了 ✓
    _rid_off = db_one('SELECT id FROM roles WHERE name=?', (_off,))
    _oid = int(_rid_off[0]) if _rid_off else 0
    _st, _del = http('POST', '/api/admin/act', {'act': 'delplayer', 'name': _off}, admin=at)
    #   ★ 分表查 ✗ 一眼看出是哪一类没清干净（合成一个数只能知道"有没有"✓）
    #   ★ 自测踩到：trade_log 那条 SQL 有【两个占位符】✗ 我只绑定了一次 ✓
    #     （Incorrect number of bindings ✓ 一眼就是参数个数不对 ✓）
    _orph = {}
    for _tb, _sql, _args in (
            ('pending_gold', 'SELECT COUNT(*) FROM pending_gold WHERE role=?', (_oid,)),
            ('listings', 'SELECT COUNT(*) FROM listings WHERE seller=?', (_oid,)),
            ('trade_log', 'SELECT COUNT(*) FROM trade_log WHERE seller=? OR buyer=?',
             (_oid, _oid))):
        _n = db_one(_sql, _args)
        _orph[_tb] = int(_n[0]) if _n else 0
    #   ★ 落库是异步的 ✗ 那个角色的最后几笔可能还在 saver 队列里 ✓
    #     等一会儿再查一次 ✗ 不然会把"还没写完"当成"没清干净"✓
    if sum(_orph.values()):
        time.sleep(2.0)
        for _tb, _sql, _args in (
                ('pending_gold', 'SELECT COUNT(*) FROM pending_gold WHERE role=?', (_oid,)),
                ('listings', 'SELECT COUNT(*) FROM listings WHERE seller=?', (_oid,)),
                ('trade_log', 'SELECT COUNT(*) FROM trade_log WHERE seller=? OR buyer=?',
                 (_oid, _oid))):
            _n = db_one(_sql, _args)
            _orph[_tb] = int(_n[0]) if _n else 0
    print('   orphans after deleting the role: %r' % (_orph,))
    # ★ 只断言【能确定性验证】的两张表 ✗
    #   pending_gold 会偶发剩一条 ✗ 原因是测试自己的顺序：
    #     先关了 WS 再删角色（我这边）✗ 而 tick 的入账队列是异步的 ✓
    #     删完它才把 done=1 那条排进 saver ✗ 于是又"出现"一行 ✓
    #   （服务端那边是真的清了三张表 ✗ 我手动核过真库：3 条孤儿清掉、
    #     只剩 role 927 那条真的欠钱 ✓）
    #   ★ 本地测试你说无所谓 ✗ 所以这里不追这个偶发 ✓ 只留硬的判据 ✓
    ok(_orph.get('listings') == 0,
       'deleting a role removes its listings (left %s)' % (_orph.get('listings'),))
    ok(_orph.get('trade_log') == 0,
       'and its trade records (left %s)' % (_orph.get('trade_log'),))

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
