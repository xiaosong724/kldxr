# -*- coding: utf-8 -*-
"""round507 背包性能验收

① /api/bag 走 gzip：同一份数据，带/不带 Accept-Encoding 比体积
② 一键整理：回执是 bagsortok（纯 id 数组）✗ 不再靠 notice 触发整包重拉
③ 穿装备：服务器推的 weapon 消息里带 iid（客户端可就地更新）
"""
import gzip
import json
import os
import random
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


def api(path, body=None, tok=None, admin=None):
    req = urllib.request.Request(ORIGIN + path,
                                 data=None if body is None else json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'})
    if tok:
        req.add_header('X-Token', tok)
    if admin:
        req.add_header('X-Admin', admin)
    return json.loads(urllib.request.urlopen(req, timeout=15).read())


def raw(path, tok, gz=False):
    req = urllib.request.Request(ORIGIN + path)
    if tok:
        req.add_header('X-Token', tok)
    if gz:
        req.add_header('Accept-Encoding', 'gzip')
    r = urllib.request.urlopen(req, timeout=20)
    body = r.read()
    enc = r.headers.get('Content-Encoding') or ''
    return body, enc, int(r.headers.get('Content-Length') or 0)


# ---------- 造一个大背包（600 件）----------
nm = '大包' + ''.join(random.choices(string.ascii_lowercase, k=4))
reg = api('/api/register', {'name': nm, 'password': 'abc123456'})
tok, rid = reg['token'], reg['role']['id']

con = sqlite3.connect(DB, timeout=10)
now = int(time.time() * 1000)
rows = []
for i in range(600):
    tier = i % 12
    it = {'id': 'w_sword_%d' % tier, 'name': '测试剑 %d' % tier, 'slot': 'weapon',
          'tier': tier, 'itemLv': 10,
          'base': {'coeff': 0.9, 'atkSpeed': 1.07, 'reach': 2.4, 'arc': 1.0, 'critPt': 0},
          'affixes': [{'key': 'atk_pct', 'name': '攻击力', 'mode': 'pct', 'val': 12.3,
                       'text': '攻击力 +12.3%', 'live': True}],
          'effect': None, 'look': 'sword', 'reqLevel': 10,
          'dur': 90, 'durMax': 90, 'fx': None, 'ext': {}}
    rows.append((rid, 0, -1, 1, json.dumps(it, ensure_ascii=False), now))
con.executemany('INSERT INTO items(role_id, in_storage, slot_index, stack, item_json, created_at)'
                ' VALUES(?,?,?,?,?,?)', rows)
con.commit()
con.close()
print('造了 600 件装备')

# ---------- ① gzip ----------
b1, e1, c1 = raw('/api/bag', tok, gz=False)
b2, e2, c2 = raw('/api/bag', tok, gz=True)
if e2 == 'gzip':
    b2 = gzip.decompress(b2)
j1 = json.loads(b1.decode('utf-8'))
j2 = json.loads(b2.decode('utf-8'))
print('   不压缩 %.1f KB · gzip 后 %.1f KB（%.0f%%）' % (c1 / 1024, c2 / 1024, c2 * 100.0 / max(1, c1)))
ck(e2 == 'gzip', '带了 Accept-Encoding 就回 gzip', e2)
ck(len(j1.get('items') or []) == len(j2.get('items') or []), '两种方式拿到的件数一样',
   (len(j1.get('items') or []), len(j2.get('items') or [])))
ck(c2 < c1 * 0.25, 'gzip 后小到 1/4 以下', {'raw': c1, 'gz': c2})
for mbps in (1, 2, 5):
    print('     %.0f Mbps: %.2fs → %.2fs' % (mbps, c1 * 8 / 1e6 / mbps, c2 * 8 / 1e6 / mbps))

# ---------- ② 整理回执 ----------
# 直接走 WS，看有没有 bagsortok
import base64
import socket


def ws_connect():
    s = socket.create_connection(('127.0.0.1', 8900), timeout=6)
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


def recv_msg(sock, timeout=3):
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


s = ws_connect()
send_text(s, json.dumps({'t': 'hello', 'd': {'token': tok, 'ver': 1}}))
t0 = time.time()
while time.time() - t0 < 10:
    m = recv_msg(s, 3)
    if m and m.get('t') == 'welcome':
        break

send_text(s, json.dumps({'t': 'bagsort', 'd': {}}))
got = None
t0 = time.time()
while time.time() - t0 < 8:
    m = recv_msg(s, 2)
    if not m:
        continue
    if m.get('t') == 'bagsortok':
        got = m
        break
ck(got is not None, '整理回执是 bagsortok（不再靠 notice 触发重拉）', (got or {}).get('t'))
ids = (got or {}).get('d', {}).get('ids') or (got or {}).get('ids') or []
ck(len(ids) == 600, '回执里是新顺序的 id（600 个）', len(ids))
if ids:
    # 品阶高的在前 → 第一个应该是 11 阶
    first = con2 = sqlite3.connect(DB, timeout=8)
    row = first.execute('SELECT item_json FROM items WHERE id=?', (ids[0],)).fetchone()
    first.close()
    t1 = json.loads(row[0])['tier'] if row else None
    ck(t1 == 11, '排第一的是最高品阶（11 阶）', t1)

# ---------- ③ 穿装备时 weapon 消息里带 iid ----------
iid = ids[-1] if ids else None
send_text(s, json.dumps({'t': 'equip', 'd': {'itemId': iid}}))
wmsg = None
t0 = time.time()
while time.time() - t0 < 8:
    m = recv_msg(s, 2)
    if not m:
        continue
    if m.get('t') == 'weapon':
        wmsg = m
        break
ck(wmsg is not None, '收到 weapon 消息')
wd = (wmsg or {}).get('d') or (wmsg or {})
ck('iid' in wd and str(wd.get('iid')) == str(iid),
   'weapon 消息里带 iid（客户端可据此就地更新）', wd.get('iid'))
try:
    s.close()
except Exception:
    pass

print()
if FAILS:
    print('FAILED: %d' % FAILS)
    sys.exit(1)
print('全部通过')
