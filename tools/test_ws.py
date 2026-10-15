# -*- coding: utf-8 -*-
"""P0-4 / P0-5 自测：WebSocket 握手 / 认证 / 心跳 / 广播 / 掩码校验 / 协议版本"""
import base64
import json
import math
import os
import socket
import sqlite3
import struct
import sys
import threading
import time
import urllib.error
import urllib.request

API = 'http://127.0.0.1:8899'
WS_HOST, WS_PORT = '127.0.0.1', 8900
DB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'server', 'game.db')
NAMES = ['测试链路甲', '测试链路乙', '测试链路丙', '测试链路丁']
PW = 'abc123456'
fails = []


def ok(cond, msg, got=None):
    print(('  PASS  ' if cond else '  FAIL  ') + msg + ('' if cond else '   got=' + repr(got)))
    if not cond:
        fails.append(msg)


def http(method, path, body=None, token=None, admin=False):
    """打真服务器的 HTTP 接口

    ★ admin=True 时 token 走【X-Admin】头 —— 管理接口认的是这个 ✓
      （第 48 轮踩过：管理 token 塞进 X-Token 头 → 401 → 刷怪静默失败 ✗）
    """
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header('Content-Type', 'application/json; charset=utf-8')
    if token:
        req.add_header('X-Admin' if admin else 'X-Token', token)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode('utf-8'))
    except Exception as e:
        return -1, {'error': repr(e)}


def tick_peak(n=15, gap=0.05):
    """当场采样 tickMs 的峰值。

    ★ 别拿 /api/health 的 tickMaxMs 当断言：那是【服务端重启前一直累计的历史峰值】，
      启服那一下、或者 CPU 被别的进程（比如并行跑浏览器测试）抢一下，它就会蹦到 30ms+，
      然后【永远】红下去 ✗（实测：涨到 31.6ms 后 test_ws 再也过不去）
      历史峰值只适合当 INFO 参考；"现在 tick 快不快"要当场采。
    """
    pk = 0.0
    for _ in range(n):
        _st, h = http('GET', '/api/health')
        w = (h or {}).get('world') or {}
        try:
            pk = max(pk, float(w.get('tickMs', 0)))
        except (TypeError, ValueError):
            pass
        time.sleep(gap)
    return pk


def cleanup():
    c = sqlite3.connect(DB)
    for n in NAMES:
        row = c.execute('SELECT id FROM accounts WHERE name=?', (n,)).fetchone()
        if row:
            c.execute('DELETE FROM tokens WHERE account_id=?', (row[0],))
            c.execute('DELETE FROM skill_pages WHERE role_id IN'
                      ' (SELECT id FROM roles WHERE account_id=?)', (row[0],))
            c.execute('DELETE FROM roles WHERE account_id=?', (row[0],))
            c.execute('DELETE FROM accounts WHERE id=?', (row[0],))
    c.commit()
    c.close()


def wait_mobs(c, timeout=6.0):
    """等到一条带 mobs 的世界快照 → 返回 mobs 数组（等不到就 None）"""
    end = time.time() + timeout
    while time.time() < end:
        o = c.take(max(0.05, end - time.time()))
        if o and o.get('t') == 'world':
            ms = o['d'].get('mobs')
            if ms:
                return ms
    return None


def find_mob(c, mid, timeout=3.5):
    """在后续快照里找指定 mid，返回最后见到的那条数组"""
    end = time.time() + timeout
    last = None
    while time.time() < end:
        o = c.take(max(0.05, end - time.time()))
        if o and o.get('t') == 'world':
            for m in (o['d'].get('mobs') or []):
                if str(m[0]) == str(mid):
                    last = m
    return last


def collect_mhits(c, seconds=1.6):
    """把这段时间里的 mhits（我打中僵尸）攒起来 —— 伤害数字是服务器算的 ✓

    ★ 顺便把 'me'（经验/等级）也捞出来：它和 mhits 常常在【同一条快照】里，
      要是这里不捞，后面再等就永远等不到（服务器只在"变了"的时候才带 ✗）"""
    out = []
    me = None
    end = time.time() + seconds
    while time.time() < end:
        o = c.take(max(0.05, end - time.time()))
        if o and o.get('t') == 'world':
            out.extend(o['d'].get('mhits') or [])
            if o['d'].get('me'):
                me = o['d']['me']
    return out, me


def wait_near_mob(c, px, pz, near=12.0, timeout=8.0):
    """等一只【近处】的僵尸回来（调试刷怪是 3~9 米 ✓）

    ★ 别只等"快照里有 mobs"：自动刷怪是 30~48 米，会先撞进已经在路上的旧快照里 ✗
      所以这里要求"离我 near 米以内"才算数 ✓
    """
    end = time.time() + timeout
    while time.time() < end:
        o = c.take(max(0.05, end - time.time()))
        if o and o.get('t') == 'world':
            best, bd = None, near * near
            for m in (o['d'].get('mobs') or []):
                dd = (m[1] - px) ** 2 + (m[2] - pz) ** 2
                if dd <= bd:
                    bd = dd
                    best = m
            if best is not None:
                return best
    return None


ADMIN_PW = os.environ.get('ADMIN_PW') or 'xiuxian-admin'
_ADMIN = {'token': None}


def admin_spawn(name, n=1, clear=False, kind=None, lv=None):
    """让【管理员】在某个玩家附近刷怪（第 48 轮）

    ★ 为什么测试也改走这条路：玩家端的 spawn 意图已经被服务器关掉了 ✗
      （那是"任何玩家都能自己刷怪"的漏洞 —— 用户要求搬到 /admin ✓）
    ★ 顺带把管理链路也端到端测了一遍 ✓
    """
    if _ADMIN['token'] is None:
        st, j = http('POST', '/api/admin/login', {'password': ADMIN_PW})
        if st != 200 or not j.get('ok'):
            print('        [调试] 管理登录失败：HTTP %s %r（密码对得上 config.json 吗？）' % (st, j))
            return False
        _ADMIN['token'] = j['token']
    body = {'act': 'spawn', 'name': name, 'n': n}
    if clear:
        body['clear'] = 1
    if kind:
        body['kind'] = kind
    if lv:
        body['lv'] = lv
    st, j = http('POST', '/api/admin/act', body, token=_ADMIN['token'], admin=True)
    return st == 200 and j.get('ok')


def wait_loot(c, timeout=3.5):
    """等到一条带 loot（地上掉的）的世界快照 → 返回那个数组"""
    end = time.time() + timeout
    while time.time() < end:
        o = c.take(max(0.05, end - time.time()))
        if o and o.get('t') == 'world':
            ls = o['d'].get('loot')
            if ls:
                return ls
    return None


def wait_heals(c, timeout=16.0):
    """等到一条带 heals（僵尸医生的治疗事件）的世界快照 → 返回那个数组

    ★ 为什么要这条：第 46 轮踩了个坑 —— 离线测试（自己进程里的 World）和
      浏览器测试（直接注入特效）【两层都过】，但线上服务器跑的还是两小时前的旧代码 ✗
      所以"按职业的行为"必须有一条【打真服务器】的验证 ✓
    """
    end = time.time() + timeout
    while time.time() < end:
        o = c.take(max(0.05, end - time.time()))
        if o and o.get('t') == 'world':
            hv = o['d'].get('heals')
            if hv:
                return hv
    return None


def wait_me(c, timeout=5.0):
    """等 '我的经验/等级变了' 那条（服务器只在变了才带 ✓）"""
    end = time.time() + timeout
    while time.time() < end:
        o = c.take(max(0.05, end - time.time()))
        if o and o.get('t') == 'world' and o['d'].get('me'):
            return o['d']['me']
    return None


# ---------------------------------------------------------------- WS 客户端

class WSClient(object):
    """测试客户端：**后台线程持续收包**，主线程从队列里取。

    必须这么做 —— 服务端 30Hz 广播，客户端要是不及时读，TCP 缓冲一满
    后面所有断言都会因为时序问题误报。
    """

    def __init__(self, path='/ws', sock=None):
        self.sock = sock or socket.create_connection((WS_HOST, WS_PORT), timeout=6)
        self.sock.settimeout(6)
        self.buf = b''
        self.q = []
        self.lock = threading.Lock()
        self.closed_code = None
        self.alive = True
        if sock is None:
            self._handshake(path)
        self._t = threading.Thread(target=self._read_loop, daemon=True)
        self._t.start()

    def _handshake(self, path):
        key = base64.b64encode(os.urandom(16)).decode()
        req = ('GET %s HTTP/1.1\r\nHost: %s:%d\r\nUpgrade: websocket\r\n'
               'Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\n'
               'Sec-WebSocket-Version: 13\r\n\r\n' % (path, WS_HOST, WS_PORT, key))
        self.sock.sendall(req.encode())
        hdr = b''
        while b'\r\n\r\n' not in hdr:
            c = self.sock.recv(1)
            if not c:
                raise RuntimeError('握手没回包')
            hdr += c
        self.handshake = hdr.decode('latin-1')
        self.sec_key = key

    @staticmethod
    def _frame(opcode, payload, mask=True):
        n = len(payload)
        h = bytearray([0x80 | opcode])
        mk = os.urandom(4) if mask else b''
        if n < 126:
            h.append((0x80 if mask else 0) | n)
        elif n < 65536:
            h.append((0x80 if mask else 0) | 126)
            h += struct.pack('>H', n)
        else:
            h.append((0x80 if mask else 0) | 127)
            h += struct.pack('>Q', n)
        if not mask:
            return bytes(h) + payload
        h += mk
        if n:
            m = mk * ((n >> 2) + 1)
            x = int.from_bytes(payload, 'big') ^ int.from_bytes(m[:n], 'big')
            return bytes(h) + x.to_bytes(n, 'big')
        return bytes(h)

    def send_raw(self, data):
        self.sock.sendall(data)

    def send_text(self, s, mask=True):
        self.sock.sendall(self._frame(0x1, s.encode('utf-8'), mask))

    def send_json(self, mtype, **d):
        self.send_text(json.dumps({'t': mtype, 'd': d}, ensure_ascii=False))

    # ---------- 后台读 ----------

    def _exact(self, n):
        while len(self.buf) < n:
            c = self.sock.recv(65536)
            if not c:
                return None
            self.buf += c
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _read_loop(self):
        try:
            while self.alive:
                h = self._exact(2)
                if not h:
                    break
                b1, b2 = h[0], h[1]
                op = b1 & 0x0F
                ln = b2 & 0x7F
                masked = bool(b2 & 0x80)
                if ln == 126:
                    ln = struct.unpack('>H', self._exact(2))[0]
                elif ln == 127:
                    ln = struct.unpack('>Q', self._exact(8))[0]
                mk = self._exact(4) if masked else None
                data = self._exact(ln) if ln else b''
                if data is None:
                    break
                if mk:
                    m = mk * ((ln >> 2) + 1)
                    x = int.from_bytes(data, 'big') ^ int.from_bytes(m[:ln], 'big')
                    data = x.to_bytes(ln, 'big')
                if op == 0x8:
                    self.closed_code = struct.unpack('>H', data[:2])[0] if len(data) >= 2 else 1005
                    break
                if op == 0x9:                      # 服务端 ping → 回 pong
                    self.sock.sendall(self._frame(0xA, data))
                    continue
                if op == 0xA:
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

    def wait_type(self, t, timeout=8):
        end = time.time() + timeout
        while time.time() < end:
            o = self.take(max(0.05, end - time.time()))
            if o is None:
                continue
            if o.get('t') == t:
                return o
        return None

    def drain(self, seconds=0.4):
        end = time.time() + seconds
        while time.time() < end:
            self.take(0.05)

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


# ---------------------------------------------------------------- 测试

cleanup()
toks = {}
try:
    print('== ① 握手 ==')
    for n in NAMES:
        st, j = http('POST', '/api/register', {'name': n, 'password': PW})
        assert st == 200, j
        toks[n] = j['token']
    c0 = WSClient()
    ok('101 Switching Protocols' in c0.handshake, '握手返回 101', c0.handshake.split('\r\n')[0])
    import hashlib
    exp = base64.b64encode(hashlib.sha1(
        (c0.sec_key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
    ok(('Sec-WebSocket-Accept: ' + exp) in c0.handshake or exp in c0.handshake,
       'Sec-WebSocket-Accept 计算正确（RFC 6455 算法）', c0.handshake)
    c0.close()

    print('== ② 认证 ==')
    # 错 token
    cb = WSClient()
    cb.send_json('hello', token='乱写的token')
    m = cb.wait_type('kick', timeout=5)
    ok(m is not None and m['d'].get('code') == 'auth', '假 token → kick(auth)', m)
    cb.close()

    # 版本不对
    cv = WSClient()
    cv.send_json('hello', token=toks[NAMES[0]], ver=999)
    m = cv.wait_type('kick', timeout=5)
    ok(m is not None and m['d'].get('code') == 'ver', '版本不匹配 → kick(ver)', m)
    cv.close()

    # 未认证就发别的
    cu = WSClient()
    cu.send_json('move', x=1, z=2)
    m = cu.wait_type('error', timeout=5)
    ok(m is not None and 'hello' in m['d'].get('msg', ''), '未认证先发 move → 提示先 hello', m)
    cu.close()

    # 正常认证
    ca = WSClient()
    ca.send_json('hello', token=toks[NAMES[0]], ver=1)
    w = ca.wait_type('welcome', timeout=5)
    ok(w is not None, 'hello → welcome', w)
    ok((w or {}).get('d', {}).get('role', {}).get('name') == NAMES[0], 'welcome 带角色数据', w)
    ok((w or {}).get('d', {}).get('ver') == 1, 'welcome 带协议版本', w)

    print('== ③ 心跳 ==')
    ca.send_json('ping', t=123.5)
    m = ca.wait_type('pong', timeout=5)
    ok(m is not None and m['d'].get('t') == 123.5, 'ping → pong 原样回 t', m)
    ok('st' in (m or {}).get('d', {}), 'pong 带服务端时间 st', m)

    print('== ④ 未知消息 / 缺字段 ==')
    ca.send_json('不存在的消息')
    m = ca.wait_type('error', timeout=5)
    ok(m is not None and '未知' in m['d'].get('msg', ''), '未知类型 → error', m)
    ca.send_json('move')          # 缺 x/z
    m = ca.wait_type('error', timeout=5)
    ok(m is not None and '缺少字段' in m['d'].get('msg', ''), '缺必填字段 → error', m)

    print('== ⑤ 位置广播（两个玩家互相看见）==')
    ca.send_json('move', x=100.0, z=200.0, yaw=1.5, t=1.0)
    time.sleep(0.3)
    cb2 = WSClient()
    cb2.send_json('hello', token=toks[NAMES[1]], ver=1)
    ok(cb2.wait_type('welcome', timeout=5) is not None, '第二个玩家也登录成功')
    cb2.send_json('move', x=103.0, z=200.0, yaw=0.0, t=1.0)
    # 乙应该在 world 里看到甲
    seen = None
    end = time.time() + 6
    while time.time() < end and seen is None:
        o = cb2.take(0.3)
        if o and o.get('t') == 'world':
            for p in (o['d'].get('players') or []):
                if p.get('n') == NAMES[0]:
                    seen = p
                    break
    ok(seen is not None, '乙在 world 里看见了甲', seen)
    if seen:
        ok(abs(seen['x'] - 100.0) < 0.01 and abs(seen['z'] - 200.0) < 0.01,
           '位置数据正确 (100,200)', seen)
        ok(seen.get('y') == 1.5, '朝向正确', seen.get('y'))
        ok(seen.get('t') is not None, '★ 带对方自己的钟 t（客户端插值要用）', seen.get('t'))
        ok(seen.get('lv') == 1, '带等级', seen.get('lv'))

    # 视野外不该收到：先排空旧包，再让甲跑到 10000 开外
    ca.send_json('move', x=10000.0, z=10000.0, yaw=0, t=2.0)
    time.sleep(0.5)
    cb2.drain(0.6)
    far_seen = False
    end = time.time() + 1.5
    while time.time() < end:
        o = cb2.take(0.2)
        if o and o.get('t') == 'world':
            for p in (o['d'].get('players') or []):
                if p.get('n') == NAMES[0]:
                    far_seen = True
    ok(not far_seen, '★ 视野外(60单位)的人不再下发 —— 兴趣管理生效', far_seen)

    print('== ⑥ 掩码校验（RFC 要求客户端必须掩码）==')
    cm = WSClient()
    cm.send_raw(struct.pack('>BB', 0x81, 0x05) + b'hello')     # 不掩码的文本帧
    end = time.time() + 3
    while time.time() < end and cm.closed_code is None:
        time.sleep(0.05)
    ok(cm.closed_code == 1002, '未掩码帧 → 服务端按协议错关闭(1002)', cm.closed_code)
    cm.close()

    print('== ⑦ 单点在线（同账号在别处登录，旧连接被踢）==')
    cd1 = WSClient()
    cd1.send_json('hello', token=toks[NAMES[1]], ver=1)
    ok(cd1.wait_type('welcome', timeout=5) is not None, '第一台设备连上')
    time.sleep(0.3)
    # 重新登录拿新 token（旧的会失效）
    st, j = http('POST', '/api/login', {'name': NAMES[1], 'password': PW})
    cd2 = WSClient()
    cd2.send_json('hello', token=j['token'], ver=1)
    ok(cd2.wait_type('welcome', timeout=5) is not None, '第二台设备连上')
    m = cd1.wait_type('kick', timeout=6)
    ok(m is not None and m['d'].get('code') == 'dup', '★ 第一台设备被踢（dup）', m)

    for c in (ca, cb2, cd1, cd2):
        c.close()

    print('== ⑧ 断开后位置写回数据库 ==')
    time.sleep(1.5)
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    r = c.execute('SELECT x,z FROM roles WHERE name=?', (NAMES[0],)).fetchone()
    ok(r is not None and abs(r['x'] - 10000.0) < 1, '断开时把最后位置存回库（走存档线程）',
       dict(r) if r else None)
    c.close()

    for c_ in (ca, cb2, cd1, cd2):
        c_.close()
    time.sleep(0.5)

    print('== ⑨ tick 线程健康度 ==')
    st, h = http('GET', '/api/health')
    w = (h or {}).get('world') or {}
    ok('tick' in w, '/api/health 报了世界状态', w)
    ok(w.get('tick', 0) > 10, 'tick 线程在跑（已推进 %s 帧）' % w.get('tick'), w.get('tick'))
    print('  INFO  历史 tick 峰值 %.2fms（服务端重启前累计，仅供排查参考）'
          % w.get('tickMaxMs', -1))
    pk9 = tick_peak()
    ok(pk9 < 30, '当场采样的 tick 峰值 %.2fms < 30ms（一帧预算 33ms）' % pk9, pk9)
    # ★ inbox 是"还没被 tick 取走"的意图。不能要求它在【某一瞬间】恰好为 0：
    #   只要还有别的客户端在线（比如你自己正开着页面玩），30Hz 的上报随时可能
    #   正好有 1~2 条在路上 → 断言 ==0 会偶发假红 ✗（实测 4 次里挂 2 次）
    #   真正的判据是"不会堆积"：连采几次，最大的那次也不该超过一个小常数。
    #   （tick 线程要是卡住了，这个数会一路涨上去，所以照样抓得住 ✓）
    mx_inbox = 0
    for _ in range(6):
        _st, _h = http('GET', '/api/health')
        _w = (_h or {}).get('world') or {}
        mx_inbox = max(mx_inbox, _w.get('inbox', 0))
        time.sleep(0.1)
    ok(mx_inbox < 50, 'inbox 没有堆积（连采 6 次，最大 %s 条；0 = 完全排空）' % mx_inbox, mx_inbox)

    print('== ⑩ ★ 卡死的客户端不能拖垮别人（P0-6 的核心保证）==')
    # 丙/丁 在 ① 那步就已经注册过了（① 是 for n in NAMES 全量注册），这里直接登录
    st, j = http('POST', '/api/login', {'name': NAMES[2], 'password': PW})
    if 'token' not in j:
        print('  [调试] 登录 %s 返回: %s %s' % (NAMES[2], st, j))
    t_dead = j['token']
    st, j = http('POST', '/api/login', {'name': NAMES[3], 'password': PW})
    if 'token' not in j:
        print('  [调试] 登录 %s 返回: %s %s' % (NAMES[3], st, j))
    t_live = j['token']

    dead = WSClient()
    dead.send_json('hello', token=t_dead, ver=1)
    ok(dead.wait_type('welcome', timeout=5) is not None, '「卡死」的客户端连上了')
    dead.alive = False                     # ★ 从此不再读 socket（模拟手机卡死/切后台）
    dead.send_json('move', x=50.0, z=50.0, t=1.0)

    live = WSClient()
    live.send_json('hello', token=t_live, ver=1)
    ok(live.wait_type('welcome', timeout=5) is not None, '正常客户端连上了')
    live.send_json('move', x=50.0, z=50.0, t=1.0)
    time.sleep(0.5)
    live.drain(0.5)

    t0 = time.time()
    cnt = 0
    while time.time() - t0 < 3.0:
        o = live.take(0.2)
        if o and o.get('t') == 'world':
            cnt += 1
    rate = cnt / 3.0
    ok(rate >= 24.0,
       '旁边有个卡死连接时，正常客户端仍收到 ~30Hz（实测 %.1f 条/秒）' % rate, rate)

    pk10 = tick_peak()
    ok(pk10 < 30, '★ 卡死连接在旁边时，当场采样的 tick 峰值仍是 %.2fms（没被拖慢）' % pk10, pk10)
    live.close()

    # ============================================================ ⑪ P2 僵尸
    print('== ⑪ ★ P2 僵尸（服务器权威：刷怪 / 扇形判定 / 经验）==')
    st, j = http('POST', '/api/login', {'name': NAMES[0], 'password': PW})
    t_ma = j['token']
    st, j = http('POST', '/api/login', {'name': NAMES[1], 'password': PW})
    t_mb = j['token']
    # ★★ 第 39 轮：攻击力改由服务器按【等级】算（不再信客户端报的 ✗）★★
    #   → 这里把测试角色的等级调高一点，一刀能秒怪（Lv.1 只有 13 点，砍 8 下测试会慢死 ✗）
    #   ★ 顺便这也让"谎报 atk"那条断言更硬：客户端报 999，服务器按 Lv.30 给 172 ✓
    try:
        con = sqlite3.connect(DB)
        con.execute('UPDATE roles SET level=? WHERE name=?', (30, NAMES[0]))
        con.execute('UPDATE roles SET level=? WHERE name=?', (30, NAMES[1]))
        con.commit()
        con.close()
    except Exception as e:
        print('  [调试] 改等级失败：%r' % (e,))
    ma = WSClient()
    ma.send_json('hello', token=t_ma, ver=1)
    ok(ma.wait_type('welcome', timeout=5) is not None, 'P2 甲连上了')
    mb = WSClient()
    mb.send_json('hello', token=t_mb, ver=1)
    ok(mb.wait_type('welcome', timeout=5) is not None, 'P2 乙连上了')

    PX, PZ = 300.0, 300.0          # 站远一点（安全区里不刷怪，见 world.SPAWN_SAFE）
    ma.send_json('move', x=PX, z=PZ, yaw=0.0, t=1.0, atk=999)
    mb.send_json('move', x=PX + 12.0, z=PZ, yaw=0.0, t=1.0, atk=10)
    time.sleep(0.4)
    ma.drain(0.8)
    mb.drain(0.8)

    admin_spawn(NAMES[0], n=1)               # ★ 第 48 轮：刷怪走管理接口 ✓
    one = wait_near_mob(ma, PX, PZ)          # ★ 只认"3~9 米"的那只（调试刷的）✓
    ms = [one] if one else None
    ok(bool(ms), '★ 服务器把僵尸推下来了（快照带 mobs，而且就在我旁边）', (ms or [])[:1])
    mob_ok = bool(ms)
    if mob_ok:
        ok(len(one) >= 8 and isinstance(one[0], (str, int)),
           '僵尸是紧凑数组 [mid,x,z,yaw,hp,hpMax,alive,atkT]（%r）' % (one,), one)
        mid = str(one[0])
        ok(one[4] > 0 and one[5] >= one[4],
           '僵尸血量合理（hp=%s / hpMax=%s）' % (one[4], one[5]), one)
        # 乙也该看得见同一只（兴趣范围内）→ 两边一致 ✓
        ms_b = wait_mobs(mb, timeout=4)
        same = any(str(m[0]) == mid for m in (ms_b or []))
        ok(same, '★ 同一只僵尸在两个客户端眼里是同一 mid（两边一致）', (ms_b or [])[:1])

        # ---- ★ 位置和挥刀【同一批包】发出去 ----
        #   为什么：僵尸一直在动（追人 + 同伴挤位 + 漫游）。
        #   要是"先把自己挪过去、sleep 半秒、再挥刀"，那半秒里它早走开了 ✗
        #   实测就是这么红的（每次都差 0.2~0.4 米，看着像判定坏了）
        #   ★ 服务器的意图队列是 FIFO，所以 move 一定在 atk 之前生效 ✓
        def atk_at(seq, face):
            m = find_mob(ma, mid, timeout=3.0)
            if not m:
                return None
            ang = 0.7                                   # 随便挑个方向站它旁边
            px = m[1] - math.sin(ang) * 1.2
            pz = m[2] - math.cos(ang) * 1.2
            yaw = ang if face else (ang + math.pi)      # face=False → 背对着它 ✓
            ma.send_json('move', x=px, z=pz, yaw=yaw, t=4.0, atk=999)
            ma.send_json('atk', seq=seq)
            return m

        m_near = find_mob(ma, mid, timeout=3.5)
        d_near = math.hypot(m_near[1] - PX, m_near[2] - PZ) if m_near else 999.0
        ok(m_near is not None and d_near <= 12.0,
           '★ 调试刷出来的僵尸就在我附近（%.2f 米）' % d_near, m_near)

        if m_near:
            hp0 = m_near[4]
            # ① 背对着它砍 —— ★ 这条就是用户提的那个问题（以前"离得近就打"✗）
            atk_at(1, False)
            hits_back, _me0 = collect_mhits(ma, 1.3)
            m1 = find_mob(ma, mid, timeout=1.0)
            hp1 = m1[4] if m1 else -1
            ok(not any(str(h.get('mid')) == mid for h in hits_back),
               '★★ 背对着砍：服务器判定【没打中】这只（mhits 里没有它）', hits_back[:2])
            ok(hp1 == hp0,
               '★★ 背对着砍：它的血一点没掉（%s → %s）' % (hp0, hp1), (hp0, hp1))

            # ② 面向它砍 —— 应该打中（atk=999 一下就能秒）
            time.sleep(0.5)                      # 等过服务器的挥刀冷却（0.62s）
            atk_at(2, True)
            hits_face, me_got = collect_mhits(ma, 1.5)
            mine = [h for h in hits_face if str(h.get('mid')) == mid]
            ok(bool(mine), '★★ 面向它砍：服务器判定打中 ✓（mhits=%r）' % (mine[:1],), mine[:1])
            if mine:
                ok(int(mine[0].get('dmg') or 0) > 0,
                   '伤害数字是服务器算的（%s）' % mine[0].get('dmg'), mine[0])
                # ★★ 第 39 轮：客户端一路在报 atk=999，服务器必须【不理它】★★
                ok(int(mine[0].get('dmg') or 0) != 999 and int(mine[0].get('dmg') or 0) < 400,
                   '★★ 客户端谎报 atk=999 → 服务器按自己的等级算（实际 %s，不是 999）✓'
                   % mine[0].get('dmg'), mine[0].get('dmg'))
            m2 = find_mob(ma, mid, timeout=1.2)
            if m2:
                ok(m2[4] < hp0 or m2[6] == 0,
                   '它掉血了 / 直接死了（hp %s → %s，alive=%s）' % (hp0, m2[4], m2[6]), m2)

            # ③ 击杀 → 经验（服务器算，还带等级）
            #   ★ 第 39 轮之后：伤害按【等级】算（Lv.30 → 172），而同级的怪有 1293 血
            #     → 一刀杀不死了，得砍到死为止（这本身就是"服务器权威"带来的真实变化 ✓）
            me = me_got
            kills = 0
            for _k in range(16):
                if me:
                    break
                time.sleep(0.55)
                atk_at(30 + _k, True)
                _hh, me2 = collect_mhits(ma, 1.0)
                kills += 1
                if me2:
                    me = me2
            ok(me is not None and int(me.get('exp') or 0) > 0,
               '★ 砍死它给了经验（砍了 %d 刀，me=%r）' % (kills, me), me)
            if me:
                ok(int(me.get('lv') or 0) >= 1 and int(me.get('need') or 0) > 0,
                   '顺带带回等级和"下一级要多少经验"（lv=%s need=%s）' % (me.get('lv'), me.get('need')), me)

            # ==================================================== 掉落 + 拾取
            print('  -- P2 第二刀：掉落 + 拾取 --')
            # ★ 掉率是 75%~95%（方案 §8）不是必掉 ✗ → 多杀几只，出一件就够 ✓
            loots, att = None, 0
            for att in range(6):
                admin_spawn(NAMES[0], n=1)
                time.sleep(0.4)
                atk_at(20 + att, True)        # 站它面前砍（位置+挥刀同一批包 ✓）
                ls = wait_loot(ma, timeout=3.0)
                if ls:
                    loots = ls
                    break
            ok(loots is not None,
               '★★ 打死僵尸会掉东西（机会掉落，杀了 %d 只才出）' % (att + 1), loots)
            if loots:
                one = loots[0]
                ok(len(one) == 5 and one[3] and isinstance(one[4], int),
                   '掉落是紧凑数组 [id,x,z,name,tier]（%r）' % (one,), one)
                lid, lx, lz = str(one[0]), one[1], one[2]
                # ① 隔着 12 米捡 —— ★ 服务器必须不认（防隔空捡 ✓）
                ma.send_json('move', x=lx + 12.0, z=lz, yaw=0.0, t=6.0, atk=999)
                ma.send_json('pick', id=lid)
                time.sleep(0.5)
                still = wait_loot(ma, timeout=2.5)
                ok(bool(still) and any(str(x[0]) == lid for x in still),
                   '★★ 隔着 12 米捡 → 服务器不认（东西还在）✓', (still or [])[:1])
                # ② 走到跟前捡（move + pick 同一批包 ✓）
                ma.send_json('move', x=lx, z=lz, yaw=0.0, t=7.0, atk=999)
                ma.send_json('pick', id=lid)
                notice = None
                end2 = time.time() + 2.5
                while time.time() < end2:
                    o = ma.take(0.2)
                    if o and o.get('t') == 'notice' and '拾取' in str(o['d'].get('text') or ''):
                        notice = o
                        break
                ok(notice is not None, '★★ 走到跟前就捡到了（收到「拾取…」提示）', notice)
                # ③ 真进背包了吗 —— ★ 直接查库，不是看提示（提示能骗人 ✗）
                time.sleep(1.3)               # 存档线程是攒批写盘的，等它落一下 ✓
                try:
                    con = sqlite3.connect(DB)
                    n = con.execute(
                        'SELECT COUNT(*) FROM items WHERE role_id ='
                        ' (SELECT id FROM roles WHERE name = ?)', (NAMES[0],)).fetchone()[0]
                    con.close()
                except Exception as e:
                    n = -1
                    print('  [调试] 查库失败：%r' % (e,))
                ok(n >= 1, '★★ 物品真的进了数据库的背包表（%d 件）' % n, n)

            # ==================================================== 僵尸医生的治疗
            print('  -- 僵尸医生的治疗（第 46 轮）--')
            # ★ 用【指定职业】刷怪：随机刷可能半天刷不出医生 ✗ 测试不该靠运气 ✓
            # ★ 等级要指定成 Lv.10（361 血）：测试号是 Lv.30，伤害 172 ——
            #   放在 Lv.30 的怪（1293 血）身上一刀只掉 13%，卡在 85% 门槛之上 → 医生判定"不用治" ✗
            #   放在 Lv.10（361 血）身上一刀掉到 48% ✓ 而且打得死不了 ✓ 正好是"残血待治" ✓
            admin_spawn(NAMES[0], clear=True)
            time.sleep(0.8)
            admin_spawn(NAMES[0], n=3, kind='医生', lv=10)      # 多刷几个：打起来容易误伤死 ✗
            time.sleep(0.4)
            admin_spawn(NAMES[0], n=3, kind='白领', lv=10)     # 治疗目标（Lv.10 ≈ 357 血 ✓）
            time.sleep(0.8)
            # ★ 两个坑（都踩过）：
            #   ① 一刀只把怪打到 86.7%（172/1293），【刚好在 85% 门槛之上】→ 医生判定"血还够"不治 ✗
            #      所以要多砍几刀，让它真的低于 85% ✓
            #   ② 攻击之间的 collect_mhits 会把带治疗事件的快照【吃掉丢掉】✗
            #      → 改成"打一下、就看一眼有没有治疗事件"（边打边收 ✓）
            def heal_atk(seq):
                """打一下"当前最近的活僵尸"，顺便把读到的治疗事件带回来

                ★ 为什么不能复用上面的 atk_at：它闭包捕获的是【P2 那一段的 mid】✗
                  那只早被打死了 → find_mob 返回 None → 一个包都没发出去 ✗
                  结果就是"医生测试里一次伤害都没造成"（踩过，红了好久 ✓）
                """
                snap = ma.take(0.4)
                found = []
                for _t in range(14):
                    if snap and snap.get('t') == 'world':
                        if snap['d'].get('heals'):
                            found.extend(snap['d']['heals'])
                        if snap['d'].get('mobs'):
                            break
                    snap = ma.take(0.3)
                ms = (snap or {}).get('d', {}).get('mobs') or []
                alive = [m for m in ms if len(m) > 6 and int(m[6]) == 1]
                # ★ 别打医生：Lv.10 医生只有 339 血，两刀就死 ✗ → 死了就没人治了（踩过）
                pref = [m for m in alive if (m[9] if len(m) > 9 else '') != '医生'] or alive
                if pref:
                    mm = pref[0]
                    ang = 0.7
                    ma.send_json('move', x=float(mm[1]) - math.sin(ang) * 1.2,
                                 z=float(mm[2]) - math.cos(ang) * 1.2, yaw=ang, t=4.0, atk=999)
                    ma.send_json('atk', seq=seq)
                return found

            hev = None
            for _k in range(20):
                hv = heal_atk(40 + _k)
                if hv:
                    hev = hv
                    break
                hv = wait_heals(ma, 0.5)
                if hv:
                    hev = hv
                    break
            if hev is None:
                hev = wait_heals(ma, timeout=5.0)
            if hev is None:
                # ★ 失败时把场上情况打出来 —— 不然只知道"没收到"，不知道是没医生还是没残血 ✓
                _snap = ma.take(0.4)
                while _snap is not None and _snap.get('t') != 'world':
                    _snap = ma.take(0.2)
                if _snap:
                    _ms = _snap['d'].get('mobs') or []
                    print('        [诊断] 场上 %d 只: %r'
                          % (len(_ms), [[m[0], m[9] if len(m) > 9 else '?', m[4], m[5]] for m in _ms[:8]]))
            ok(hev is not None,
               '★★ 收到治疗事件（服务器发给客户端，玩家才画得出连线 ✓）', hev)
            if hev:
                _he = hev[0]
                ok(len(_he) == 5 and float(_he[4]) > 0,
                   '治疗事件是 [医生x, 医生z, 目标x, 目标z, 回了多少]（%r）' % (_he,), _he)
                ok(abs(float(_he[0]) - float(_he[2])) <= 12.5,
                   '★ 医生和被治的僵尸确实在 12 米治疗范围内（相距 %.2f 米）'
                   % abs(float(_he[0]) - float(_he[2])), _he)

    ma.close()
    mb.close()
    try:
        dead.sock.close()
    except Exception:
        pass
finally:
    cleanup()

print()
print('ALL PASS' if not fails else 'FAILED: %d' % len(fails))
sys.exit(1 if fails else 0)
