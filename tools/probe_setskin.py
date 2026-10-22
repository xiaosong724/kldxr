# -*- coding: utf-8 -*-
"""setskin 到底有没有落库？（直接走 WS，不经过浏览器）"""
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


def api(path, body=None, admin=None):
    req = urllib.request.Request(ORIGIN + path,
                                 data=None if body is None else json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'})
    if admin:
        req.add_header('X-Admin', admin)
    return json.loads(urllib.request.urlopen(req, timeout=10).read())


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


nm = '用皮' + ''.join(random.choices(string.ascii_lowercase, k=4))
r = api('/api/register', {'name': nm, 'password': 'abc123456'})
tok, rid = r['token'], r['role']['id']
at = api('/api/admin/login', {'password': 'xiuxian-admin'})['token']
g = api('/api/admin/act', {'act': 'give', 'name': nm, 'kind': 'skin',
                           'skinKey': 'f05', 'equip': False}, admin=at)
print('发皮肤:', g.get('ok'), g.get('skins'))

s = ws_connect()
send_text(s, json.dumps({'t': 'hello', 'd': {'token': tok, 'ver': 1}}))
t0 = time.time()
wel = None
while time.time() - t0 < 10:
    m = recv_msg(s, 3)
    if m and m.get('t') == 'welcome':
        wel = m
        break
print('welcome.skin =', (wel or {}).get('d', {}).get('role', {}).get('skin'))

send_text(s, json.dumps({'t': 'setskin', 'd': {'key': 'f05'}}))
got = []
t0 = time.time()
while time.time() - t0 < 5:
    m = recv_msg(s, 2)
    if not m:
        continue
    t = m.get('t')
    if t in ('skin', 'skinerr', 'notice', 'toast', 'sys'):
        got.append((t, m.get('d')))
    if t in ('skin', 'skinerr'):
        break
print('setskin 回包:', got)

time.sleep(0.8)
con = sqlite3.connect(DB, timeout=8)
row = con.execute('SELECT skin FROM roles WHERE id=?', (rid,)).fetchone()
unl = con.execute('SELECT key FROM skin_unlocks WHERE role_id=?', (rid,)).fetchall()
con.close()
print('DB roles.skin =', row[0] if row else None, '· 已解锁 =', [u[0] for u in unl])

# 再试一次"用另一个已解锁的"，看是不是只有第一个能换
g2 = api('/api/admin/act', {'act': 'give', 'name': nm, 'kind': 'skin',
                            'skinKey': 'm07', 'equip': False}, admin=at)
print('发第二套:', g2.get('ok'), g2.get('skins'))
send_text(s, json.dumps({'t': 'setskin', 'd': {'key': 'm07'}}))
got2 = []
t0 = time.time()
while time.time() - t0 < 5:
    m = recv_msg(s, 2)
    if not m:
        continue
    if m.get('t') in ('skin', 'skinerr'):
        got2.append((m.get('t'), m.get('d')))
        break
print('换第二套回包:', got2)
time.sleep(0.8)
con = sqlite3.connect(DB, timeout=8)
row = con.execute('SELECT skin FROM roles WHERE id=?', (rid,)).fetchone()
con.close()
print('DB roles.skin =', row[0] if row else None)
try:
    s.close()
except Exception:
    pass
