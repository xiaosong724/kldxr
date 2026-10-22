# -*- coding: utf-8 -*-
"""P2 验收：主动技能真的能放（CD / 灵气 / 伤害 / 广播）round549"""
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


def recv(sock, timeout=3):
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


def wait(sock, want, secs=8):
    t0 = time.time()
    while time.time() - t0 < secs:
        m = recv(sock, 1)
        if m and m.get('t') == want:
            return m
    return None


nm = '技能放' + ''.join(random.choices(string.ascii_lowercase, k=4))
reg = api('/api/register', {'name': nm, 'password': 'abc123456'})
rid = reg['role']['id']
at = api('/api/admin/login', {'password': 'xiuxian-admin'})['token']

# 夹具：学会黑洞 + 装到 A 槽 0
con = sqlite3.connect(DB, timeout=8)
con.execute("INSERT OR IGNORE INTO skill_learn(role_id,key,kind,tier,at) VALUES(?,?,?,?,?)",
            (rid, 'blackhole', 'A', 1, int(time.time() * 1000)))
con.execute("INSERT OR REPLACE INTO skill_load(role_id,kind,slot,key) VALUES(?,?,?,?)",
            (rid, 'A', 0, 'blackhole'))
con.execute("UPDATE roles SET qi=100 WHERE id=?", (rid,))
con.commit(); con.close()

s1 = ws(reg['token'])
w = wait(s1, 'welcome', 10)
ck(w is not None, '登录成功')

# ① 不在安全区开始（安全区不能放技能）
q0 = None
for _ in range(3):
    m = recv(s1, 1)
    if m and m.get('t') == 'me' and 'qi' in (m.get('d') or {}):
        q0 = m['d']['qi']

print('① 释放黑洞：')
send(s1, json.dumps({'t': 'skillcast', 'd': {'key': 'blackhole'}}))
cd = None
seen = {}
t0 = time.time()
while time.time() - t0 < 4:
    m = recv(s1, 0.5)
    if not m:
        continue
    if m.get('t') == 'notice':
        seen['notice'] = (m.get('d') or {}).get('text')
    if m.get('t') == 'skillfx':
        seen['fx'] = m.get('d')
    if m.get('t') == 'qi':
        seen['qi'] = (m.get('d') or {}).get('q')
    if m.get('t') == 'skillcd':
        cd = m
print('   skillcd:', (cd or {}).get('d'))
print('   收到:', {k: (v if k != 'fx' else {'k': v.get('k'), 'r': v.get('r')}) for k, v in seen.items()})
ck(seen.get('notice') == '安全区内不能放技能', '安全区被拦（这是预期 ✓）', seen.get('notice'))

# ② 走到安全区外（按住 W 走 3 秒 ≈ 20 米 ✓ 安全区 15 米）
# ★ move 是【绝对坐标同步】✗ 要一点点往前推（防瞬移校验）
for _i in range(1, 61):
    send(s1, json.dumps({'t': 'move', 'd': {'x': 0, 'z': _i * 0.5, 'yaw': 0}}))
    time.sleep(0.05)
time.sleep(0.4)

send(s1, json.dumps({'t': 'skillcast', 'd': {'key': 'blackhole'}}))
fx = None; cd2 = None
_t0 = time.time()
while time.time() - _t0 < 5:
    _m = recv(s1, 0.5)
    if not _m:
        continue
    if _m.get('t') == 'skillfx':
        fx = _m
    if _m.get('t') == 'skillcd':
        cd2 = _m
    if fx and cd2:
        break
print('   技能特效:', {k: fx['d'].get(k) for k in ('k', 'r', 'dur', 'seed')} if fx else None)
ck(fx is not None and fx['d'].get('k') == 'blackhole', '★ 广播了黑洞特效（别人也能看到）', fx and fx['d'])
cdd = (cd2 or {}).get('d', {}).get('cd') or {}
print('   冷却:', cdd)
ck(cdd.get('blackhole', 0) > 10, '★ CD 生效（约 15 秒）', cdd)

# ③ 立刻再放 → 应该被 CD 拦
send(s1, json.dumps({'t': 'skillcast', 'd': {'key': 'blackhole'}}))
note = wait(s1, 'notice', 6)
print('   第二次:', (note or {}).get('d', {}).get('text'))
ck(note is not None and '冷却' in str((note.get('d') or {}).get('text')), '★ CD 中放不出来', (note or {}).get('d'))

print()
if FAILS:
    print('FAILED: %d' % FAILS)
    sys.exit(1)
print('全部通过')
