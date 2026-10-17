# -*- coding: utf-8 -*-
"""真协议追一笔：上架 → 买走一部分 → 记录里有没有（纯 WS ✗ 无浏览器 ✓ 20 秒）

★ 为什么要它：浏览器那边"购买点了、确认框也弹了、记录里却是空的" ✗
  要分清是【成交没成】还是【记录没写】✗ 纯协议最快 ✓
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
sys.path.insert(0, os.path.join(ROOT, 'server'))
BASE = 'http://127.0.0.1:8899'
DB = os.path.join(ROOT, 'server', 'game.db')
SFX = ''.join(random.choice('abcdefghijkmnpqrstuvwxyz') for _ in range(3))
SELLER, BUYER, PW = 'T卖' + SFX, 'T买' + SFX, 'abc123456'


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
        self._send(json.dumps({'t': 'hello', 'd': {'token': token, 'ver': 1}}))
        threading.Thread(target=self._reader, daemon=True).start()

    def _send(self, text):
        import base64
        p = text.encode()
        mask = os.urandom(4)
        m = bytes(p[i] ^ mask[i % 4] for i in range(len(p)))
        head = bytes([0x81, 0x80 | len(p)]) if len(p) < 126 else \
            bytes([0x81, 0x80 | 126]) + struct.pack('!H', len(p))
        self.sock.sendall(head + mask + m)
    send = _send

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

    def cmd(self, t, **kw):
        self._send(json.dumps({'t': t, 'd': kw}))


def wipe():
    c = sqlite3.connect(DB, timeout=8)
    for nm in (SELLER, BUYER):
        row = c.execute('SELECT id, account_id FROM roles WHERE name=?', (nm,)).fetchone()
        if not row:
            continue
        c.execute('DELETE FROM items WHERE role_id=?', (row[0],))
        c.execute('DELETE FROM listings WHERE seller=?', (row[0],))
        c.execute('DELETE FROM trade_log WHERE seller=? OR buyer=?', (row[0], row[0]))
        c.execute('DELETE FROM pending_gold WHERE role=?', (row[0],))
        c.execute('DELETE FROM roles WHERE id=?', (row[0],))
        if row[1]:
            c.execute('DELETE FROM tokens WHERE account_id=?', (row[1],))
            c.execute('DELETE FROM accounts WHERE id=?', (row[1],))
    c.commit()
    c.close()


wipe()
reg_s = req('/api/register', {'name': SELLER, 'password': PW})
reg_b = req('/api/register', {'name': BUYER, 'password': PW})
at = req('/api/admin/login', {'password': 'xiuxian-admin'})['token']
req('/api/admin/act', {'act': 'give', 'name': SELLER, 'kind': 'material',
                       'count': 5, 'pick': 3}, admin=at)
for t in (4, 4, 4):
    req('/api/admin/act', {'act': 'give', 'name': BUYER, 'kind': 'sword', 'tier': t}, admin=at)
bagB = req('/api/bag', token=reg_b['token'])
sold = req('/api/sell', {'iids': [x['id'] for x in bagB['items']]}, token=reg_b['token'])
print('buyer sold to the system for %s gold' % sold.get('total'))

bag = req('/api/bag', token=reg_s['token'])
iid = bag['items'][0]['id']
ws_s = WS(reg_s['token'])
time.sleep(2.0)
ws_s.cmd('mklist', iid=iid, price=100, qty=3, sid='rt-list-1')
time.sleep(2.5)
c = sqlite3.connect('file:%s?mode=ro' % DB, uri=True)
row = c.execute("SELECT lid, qty, state, price FROM listings WHERE seller="
                "(SELECT id FROM roles WHERE name=?) ORDER BY lid DESC", (SELLER,)).fetchone()
c.close()
print('listing row: %s' % (tuple(row) if row else None,))
lid = int(row[0])

ws_b = WS(reg_b['token'])
time.sleep(1.5)
n0 = len(ws_b.msgs)
ws_b.cmd('buyitem', lid=lid, qty=2, sid='rt-buy-1')
time.sleep(3.0)
new = ws_b.msgs[n0:]
print('buy replies: %s' % json.dumps([m for m in new if m.get('t') == 'listres'],
                                     ensure_ascii=False)[:400])
c = sqlite3.connect('file:%s?mode=ro' % DB, uri=True)
tl = c.execute('SELECT COUNT(*), SUM(qty), SUM(price) FROM trade_log WHERE lid=?', (lid,)).fetchone()
lq = c.execute('SELECT qty, state FROM listings WHERE lid=?', (lid,)).fetchone()
c.close()
print('trade_log for this lid: count=%s qty_sum=%s price_sum=%s' % tuple(tl))
print('listing now: %s' % (tuple(lq) if lq else None,))
for who, tok in (('buyer', reg_b['token']), ('seller', reg_s['token'])):
    tr = req('/api/trades?page=0', token=tok)
    rows = (tr or {}).get('rows') or []
    print('%s sees %d record(s): %s' % (who, len(rows),
          json.dumps([(x.get('side'), x.get('qty'), x.get('price'), x.get('name')) for x in rows],
                     ensure_ascii=False)))
wipe()
print('cleaned')
