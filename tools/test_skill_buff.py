# -*- coding: utf-8 -*-
"""被动加成（C 类）验收：装了要真的生效（冷却 / 灵气 / 伤害 / 暴击）round552"""
import base64
import json
import os
import random
import socket
import sqlite3
import string
import struct
import sys
import time
import urllib.request

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

ORIGIN = 'http://127.0.0.1:8899'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, 'server', 'game.db')
FAILS = 0


def ck(c, m, got=None):
    global FAILS
    if c:
        print('  PASS  ' + m)
    else:
        FAILS += 1
        print('  FAIL  ' + m + ('' if got is None else '  got=%r' % (got,)))


def api(path, body=None, admin=None):
    req = urllib.request.Request(ORIGIN + path,
                                 data=None if body is None else json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'})
    if admin:
        req.add_header('X-Admin', admin)
    return json.loads(urllib.request.urlopen(req, timeout=10).read())


def ws(token):
    s = socket.create_connection(('127.0.0.1', 8900), timeout=8)
    key = base64.b64encode(os.urandom(16)).decode()
    s.sendall(("GET /ws HTTP/1.1\r\nHost: 127.0.0.1:8900\r\nUpgrade: websocket\r\n"
               "Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n"
               % key).encode())
    s.recv(400)
    send(s, json.dumps({'t': 'hello', 'd': {'token': token, 'ver': 1}}))
    return s


def send(sock, txt):
    data = txt.encode()
    hdr = bytearray([0x81]); n = len(data)
    if n < 126:
        hdr.append(0x80 | n)
    elif n < 65536:
        hdr.append(0x80 | 126); hdr += struct.pack('>H', n)
    else:
        hdr.append(0x80 | 127); hdr += struct.pack('>Q', n)
    mask = os.urandom(4); hdr += mask
    sock.sendall(bytes(hdr) + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))


def recv(sock, timeout=1):
    sock.settimeout(timeout)
    try:
        b1 = sock.recv(1)
    except Exception:
        return None
    if not b1:
        return None
    ln = sock.recv(1)[0] & 0x7f
    if ln == 126:
        ln = struct.unpack('>H', sock.recv(2))[0]
    elif ln == 127:
        ln = struct.unpack('>Q', sock.recv(8))[0]
    p = b''
    while len(p) < ln:
        ch = sock.recv(ln - len(p))
        if not ch:
            break
        p += ch
    try:
        return json.loads(p.decode('utf-8', 'ignore'))
    except Exception:
        return {}


def make(tag, buffs):
    nm = tag + ''.join(random.choices(string.ascii_lowercase, k=4))
    reg = api('/api/register', {'name': nm, 'password': 'abc123456'})
    rid = reg['role']['id']
    con = sqlite3.connect(DB, timeout=8)
    now = int(time.time() * 1000)
    con.execute("INSERT OR IGNORE INTO skill_learn(role_id,key,kind,tier,at) VALUES(?,?,?,?,?)",
                (rid, 'blackhole', 'A', 1, now))
    con.execute("INSERT OR REPLACE INTO skill_load(role_id,kind,slot,key) VALUES(?,?,?,?)",
                (rid, 'A', 0, 'blackhole'))
    for i, (k, tier) in enumerate(buffs):
        con.execute("INSERT OR IGNORE INTO skill_learn(role_id,key,kind,tier,at) VALUES(?,?,?,?,?)",
                    (rid, k, 'C', tier, now))
        con.execute("INSERT OR REPLACE INTO skill_load(role_id,kind,slot,key) VALUES(?,?,?,?)",
                    (rid, 'C', i, k))
    con.execute("UPDATE roles SET qi=100 WHERE id=?", (rid,))
    con.commit(); con.close()
    return nm, reg['token']


def cast_and_wait(token, key='blackhole'):
    s = ws(token)
    _wel = None
    _t0 = time.time()
    while time.time() - _t0 < 10:
        _m = recv(s, 0.5)
        if _m and _m.get('t') == 'welcome':
            _wel = _m
            break
    # ★ welcome 之后还要等 join 进世界（约 1 秒）✗ 不然意图没人收 ✓
    time.sleep(2.0)
    while recv(s, 0.15):
        pass
    print('   -> 发送 skillcast', key)
    send(s, json.dumps({'t': 'skillcast', 'd': {'key': key}}))
    cd = None; qi = None; _printed = [0]
    t0 = time.time()
    while time.time() - t0 < 4:
        m = recv(s, 0.4)
        if not m:
            continue
        if m.get('t') == 'skillcd':
            cd = (m.get('d') or {}).get('cd') or {}
        if m.get('t') == 'qi':
            qi = (m.get('d') or {}).get('q')
        if m.get('t') in ('notice', 'skillerr') and not _printed[0]:
            _printed[0] = 1
            print('   服务器说:', (m.get('d') or {}))
        if cd is not None and qi is not None:
            break
    try:
        s.close()
    except Exception:
        pass
    return cd, qi


print('① 没有加成（基准）：')
_, t0 = make('基准', [])
cd0, qi0 = cast_and_wait(t0)
print('   CD:', cd0, '| 灵气:', qi0)
ck(cd0 and abs(cd0.get('blackhole', 0) - 15) < 1.0, '基准 CD ≈ 15 秒', cd0)
ck(qi0 == 95, '基准扣 5 点灵气', qi0)

print()
print('② 装【技能冷却 5 品】→ CD 应该变 50%：')
_, t1 = make('冷却', [('cdcut', 5)])
cd1, qi1 = cast_and_wait(t1)
print('   CD:', cd1)
ck(cd1 and abs(cd1.get('blackhole', 0) - 7.5) < 1.0, '★ CD 缩短到约 7.5 秒（-50%）', cd1)

print()
print('③ 装【节能 5 品】→ 灵气消耗 -35%：')
_, t2 = make('节能', [('thrifty', 5)])
cd2, qi2 = cast_and_wait(t2)
print('   灵气:', qi2)
ck(qi2 is not None and qi2 > 95, '★ 灵气少扣了（5 × 0.65 ≈ 3）', qi2)

print()
if FAILS:
    print('FAILED: %d' % FAILS)
    sys.exit(1)
print('全部通过')
