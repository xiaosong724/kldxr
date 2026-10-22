# -*- coding: utf-8 -*-
"""皮肤流程验收（跑在【正在运行】的服务器上）

覆盖：
  ① 注册 → 自动送一个初始皮肤 + skin_unlocks 有记录
  ② WS 登录 → skinask → 收到 40 个皮肤的 skinpage（起拍 20000 / 加价 5000）
  ③ setskin 一个【没解锁】的 → 被拒（notice 里说没解锁）
  ④ setskin 自己有的 → 收到 skin 消息 + 落库
  ⑤ 数据库里有 skin 列 / skin_unlocks / skin_bids 三张表（schema 12）
"""
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
WS = ('127.0.0.1', 8900)
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


def ws_connect():
    s = socket.create_connection(WS, timeout=6)
    key = base64.b64encode(os.urandom(16)).decode()
    s.sendall(("GET /ws HTTP/1.1\r\nHost: 127.0.0.1:8900\r\nUpgrade: websocket\r\n"
               "Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n"
               % key).encode())
    s.recv(400)
    return s


def send_text(sock, txt):
    data = txt.encode()
    hdr = bytearray([0x81])
    n = len(data)
    if n < 126:
        hdr.append(0x80 | n)
    elif n < 65536:
        hdr.append(0x80 | 126)
        hdr += struct.pack('>H', n)
    else:
        hdr.append(0x80 | 127)
        hdr += struct.pack('>Q', n)
    mask = os.urandom(4)
    hdr += mask
    sock.sendall(bytes(hdr) + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))


def recv_msg(sock, timeout=6):
    sock.settimeout(timeout)
    b1 = sock.recv(1)
    if not b1:
        return None
    b2 = sock.recv(1)
    ln = b2[0] & 0x7f
    if ln == 126:
        ln = struct.unpack('>H', sock.recv(2))[0]
    elif ln == 127:
        ln = struct.unpack('>Q', sock.recv(8))[0]
    payload = b''
    while len(payload) < ln:
        ch = sock.recv(ln - len(payload))
        if not ch:
            break
        payload += ch
    try:
        return json.loads(payload.decode('utf-8', 'ignore'))
    except Exception:
        return {}


def wait_for(sock, want, secs=8):
    """收到指定 t 的消息就返回它（其它消息跳过）"""
    t0 = time.time()
    while time.time() - t0 < secs:
        try:
            m = recv_msg(sock, 3)
        except Exception:
            break
        if m and m.get('t') == want:
            m['d'] = m.get('d') or {}
            return m
    return None


# ---------- ① 注册 ----------
nm = '皮肤测试' + ''.join(random.choices(string.ascii_lowercase + string.digits, k=5))
req = urllib.request.Request(ORIGIN + '/api/register',
                             data=json.dumps({'name': nm, 'password': 'abc123456'}).encode(),
                             headers={'Content-Type': 'application/json'})
reg = json.loads(urllib.request.urlopen(req, timeout=10).read())
tok = reg['token']
rid = reg['role']['id']
sk0 = reg['role'].get('skin') or ''
print('  测试号:', nm, 'role_id:', rid, '初始皮肤:', sk0)

ck(sk0 == '', '注册后 skin = 空（用默认外观，round487 改的）', sk0)

con = sqlite3.connect(DB)
row = con.execute('SELECT key FROM skin_unlocks WHERE role_id=?', (rid,)).fetchall()
ck(len(row) == 0, '注册后没有任何解锁（皮肤靠掉落/交易获得）', row)

# ---------- ⑤ 表结构 ----------
cols = [r[1] for r in con.execute('PRAGMA table_info(roles)').fetchall()]
ck('skin' in cols, 'roles 有 skin 列')
tabs = [r[0] for r in con.execute(
    "SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
ck('skin_unlocks' in tabs, '有 skin_unlocks 表')
ck('skin_bids' in tabs, '有 skin_bids 表')
ver = con.execute('PRAGMA user_version').fetchone()[0]
ck(ver >= 12, 'schema 版本 ≥ 12', ver)

# ---------- ② WS 登录 + skinask ----------
s = ws_connect()
send_text(s, json.dumps({'t': 'hello', 'd': {'token': tok, 'ver': 1}}))
w = wait_for(s, 'welcome', 8)
ck(w is not None, 'WS 登录成功')
ck((w or {}).get('d', {}).get('role', {}).get('skin') == sk0, 'welcome 里的 role.skin 和库里一致',
   (w or {}).get('d', {}).get('role', {}).get('skin'))

send_text(s, json.dumps({'t': 'skinask', 'd': {}}))
pg = wait_for(s, 'skinpage', 8)
ck(pg is not None, '收到 skinpage')
items = (pg or {}).get('d', {}).get('items', [])
ck(len(items) == 40, '皮肤页 40 个', len(items))
ck((pg or {}).get('d', {}).get('start') == 20000, '起拍价 20000', (pg or {}).get('d', {}).get('start'))
ck((pg or {}).get('d', {}).get('step') == 5000, '最小加价 5000', (pg or {}).get('d', {}).get('step'))
mine = [it for it in items if it.get('own')]
ck(len(mine) == 0, '一开始一个都没拥有（未获得的也能预览 ✓ 40 个都在）', len(mine))
ck(len(items) == 40, '未获得也照样返回 40 个（能预览）', len(items))

# ---------- ③ 换一个没解锁的 ----------
other = 'm20'
send_text(s, json.dumps({'t': 'setskin', 'd': {'key': other}}))
n = wait_for(s, 'notice', 6)
print('   （没解锁的 setskin 回执）:', (n or {}).get('d', {}).get('text'))
ck(n is not None and '还没解锁' in (n or {}).get('d', {}).get('text', ''), '没解锁 → 拒绝')
row = con.execute('SELECT skin FROM roles WHERE id=?', (rid,)).fetchone()
ck((row[0] or '') == '', '被拒后库里还是空（默认外观）', row[0])

# ---------- ④ 手动解锁一个再换 ----------
con.execute('INSERT OR IGNORE INTO skin_unlocks(role_id, key, at) VALUES(?,?,?)',
            (rid, other, int(time.time() * 1000)))
con.commit()
send_text(s, json.dumps({'t': 'setskin', 'd': {'key': other}}))
sk = wait_for(s, 'skin', 6)
print('   （换皮肤回执）:', sk)
ck(sk is not None and (sk.get('d', {}).get('key') == other), '解锁后能换上（收到 skin 消息）')
time.sleep(1.2)
row = con.execute('SELECT skin FROM roles WHERE id=?', (rid,)).fetchone()
ck(row[0] == other, '换的皮肤落库了', row[0])

con.close()
try:
    s.close()
except Exception:
    pass

print()
if FAILS:
    print('FAILED: %d' % FAILS)
    sys.exit(1)
print('全部通过')
