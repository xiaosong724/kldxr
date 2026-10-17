# -*- coding: utf-8 -*-
"""按浏览器脚本的真实顺序验："先卖给系统（离线）→ 再登录 → 钱到账了吗"

★ 用户脚本就是这么干的（先造钱 ✗ 再登浏览器 ✓）
★ 如果这条路有 bug ✗ 那玩家也会遇到：离线卖东西 → 上线看不到钱 ✓
"""
import json
import os
import random
import socket
import sqlite3
import struct
import sys
import threading
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = 'http://127.0.0.1:8899'
DB = os.path.join(ROOT, 'server', 'game.db')
NAME = 'Off' + ''.join(random.choice('abcdefghijkmnpqrstuvwxyz') for _ in range(3))
PW = 'abc123456'


def req(path, body=None, token=None, admin=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data)
    r.add_header('Content-Type', 'application/json')
    if token:
        r.add_header('X-Token', token)
    if admin:
        r.add_header('X-Admin', admin)
    try:
        with urllib.request.urlopen(r, timeout=20) as f:
            return json.loads(f.read().decode())
    except urllib.error.HTTPError as e:
        return json.loads(e.read().decode())


class WS(object):
    def __init__(self, token):
        import base64
        self.msgs = []
        self.sock = socket.create_connection(('127.0.0.1', 8900), timeout=10)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((
            'GET /ws HTTP/1.1\r\nHost: 127.0.0.1:8900\r\nUpgrade: websocket\r\n'
            'Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n'
            % key).encode())
        buf = b''
        while b'\r\n\r\n' not in buf:
            buf += self.sock.recv(4096)
        self.send(json.dumps({'t': 'hello', 'd': {'token': token, 'ver': 1}}))
        threading.Thread(target=self._reader, daemon=True).start()

    def send(self, text):
        p = text.encode()
        mask = os.urandom(4)
        m = bytes(p[i] ^ mask[i % 4] for i in range(len(p)))
        head = bytes([0x81, 0x80 | len(p)]) if len(p) < 126 else \
            bytes([0x81, 0x80 | 126]) + struct.pack('!H', len(p))
        self.sock.sendall(head + mask + m)

    def _reader(self):
        buf = b''
        while True:
            try:
                while len(buf) < 2:
                    buf += self.sock.recv(65536)
                ln = buf[1] & 0x7F
                off = 2
                if ln == 126:
                    while len(buf) < 4:
                        buf += self.sock.recv(65536)
                    ln = struct.unpack('!H', buf[2:4])[0]
                    off = 4
                while len(buf) < off + ln:
                    buf += self.sock.recv(65536)
                fr = buf[off:off + ln]
                buf = buf[off + ln:]
                try:
                    self.msgs.append(json.loads(fr.decode('utf-8', 'replace')))
                except Exception:
                    pass
            except Exception:
                return

    def gold(self):
        for m in self.msgs:
            if m.get('t') == 'welcome':
                return ((m.get('d') or {}).get('role') or {}).get('gold')
        return None

    def last_me(self):
        g = None
        for m in self.msgs:
            if m.get('t') == 'me':
                g = (m.get('d') or {}).get('gold', g)
        return g


def wipe():
    c = sqlite3.connect(DB, timeout=8)
    row = c.execute('SELECT id, account_id FROM roles WHERE name=?', (NAME,)).fetchone()
    if row:
        c.execute('DELETE FROM items WHERE role_id=?', (row[0],))
        c.execute('DELETE FROM roles WHERE id=?', (row[0],))
        c.execute('DELETE FROM pending_gold WHERE role=?', (row[0],))
        if row[1]:
            c.execute('DELETE FROM tokens WHERE account_id=?', (row[1],))
            c.execute('DELETE FROM accounts WHERE id=?', (row[1],))
        c.commit()
    c.close()


wipe()
reg = req('/api/register', {'name': NAME, 'password': PW})
tok = reg['token']
at = req('/api/admin/login', {'password': 'xiuxian-admin'})['token']
for t in (4, 4, 4):
    req('/api/admin/act', {'act': 'give', 'name': NAME, 'kind': 'sword', 'tier': t}, admin=at)
bag = req('/api/bag', token=tok)
earned = 0
for it in bag['items']:
    r = req('/api/sell', {'iids': [it['id']]}, token=tok)
    earned += (r or {}).get('total') or 0
print('sold while offline for %s gold' % earned)
time.sleep(2.0)          # 等 saver 把 pending_gold 写下去
c = sqlite3.connect('file:%s?mode=ro' % DB, uri=True)
rid = c.execute('SELECT id FROM roles WHERE name=?', (NAME,)).fetchone()[0]
pend = c.execute('SELECT amount, why, done FROM pending_gold WHERE role=?', (rid,)).fetchall()
print('pending_gold after the saver ran: %s' % (pend,))
c.close()

ws = WS(tok)
# ★ 关键：welcome 帧是【tick 入账之前】发出去的快照 ✗ 所以它天生是旧值 ✓
#   真正该看的是【之后服务器会不会把新值推过来】✗ 玩家实际体验取决于这个 ✓
for i in range(10):
    time.sleep(1.0)
    g = ws.last_me()
    if g:
        print('gold arrived after %.0f s: %s' % (i + 1, g))
        break
else:
    types = {}
    for m in ws.msgs:
        types[m.get('t')] = types.get(m.get('t'), 0) + 1
    print('no me push. downlink types seen by this stub: %s' % (types,))
    for m in ws.msgs:
        if m.get('t') == 'world':
            print('   a world frame looks like: %s' % (sorted((m.get('d') or {}).keys()),))
            break
    print('   (真客户端会先发 world{me:1} 之类的订阅 ✗ 我的 stub 没发 ✓ 所以收不到 me ✓)')
print('gold on the welcome frame (a pre-drain snapshot): %s   (expected %s)'
      % (ws.gold(), earned))
print('gold from the latest me push: %s' % (ws.last_me(),))
c = sqlite3.connect('file:%s?mode=ro' % DB, uri=True)
print('gold in db now: %s' % (c.execute('SELECT gold FROM roles WHERE id=?', (rid,)).fetchone(),))
print('pending left: %s' % (c.execute('SELECT COUNT(*) FROM pending_gold WHERE role=? AND done=0',
                                      (rid,)).fetchone(),))
c.close()
wipe()
print('cleaned')
