# -*- coding: utf-8 -*-
"""皮肤卡流程验收（round487：掉背包 → 使用解锁 → 可卖）

覆盖：
  ① 注册后 skin = ''（用默认外观，不再送皮肤）
  ② 背包里的皮肤卡：kind='skin' + key
  ③ WS 发 useskin{iid,key} → 物品消失 + skin_unlocks 多一条 + 收到 notice
  ④ 卖系统：value.value_of(皮肤卡) = 5000 金币（不是 0 ✓）
  ⑤ 用一张"不是自己的"卡 → 不会被解锁（防猜 id）
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
sys.path.insert(0, os.path.join(ROOT, 'server'))
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


def recv_msg(sock, timeout=4):
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


CON = sqlite3.connect(DB, timeout=8)
CON.row_factory = sqlite3.Row


def mkrole(tag):
    nm = tag + ''.join(random.choices(string.ascii_lowercase, k=5))
    req = urllib.request.Request(ORIGIN + '/api/register',
                                 data=json.dumps({'name': nm, 'password': 'abc123456'}).encode(),
                                 headers={'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(req, timeout=10).read())


# ---------- ① 注册不再送皮肤 ----------
r = mkrole('皮肤卡')
tok, rid = r['token'], r['role']['id']
ck((r['role'].get('skin') or '') == '', '注册后 skin = 空（用默认外观）', r['role'].get('skin'))
n = CON.execute('SELECT COUNT(*) FROM skin_unlocks WHERE role_id=?', (rid,)).fetchone()[0]
ck(n == 0, '注册后没有任何解锁记录', n)

# ---------- ② 塞一张皮肤卡进背包 ----------
card = {'name': '皮肤·狐仙', 'tier': 0, 'kind': 'skin', 'key': 'f13'}
cur = CON.execute('INSERT INTO items(role_id, in_storage, slot_index, stack, item_json, created_at)'
                  ' VALUES(?,0,0,1,?,?)',
                  (rid, json.dumps(card, ensure_ascii=False), int(time.time() * 1000)))
CON.commit()
iid = cur.lastrowid
print('  塞了一张皮肤卡 iid =', iid)

# ---------- ④ 卖系统的价格 ----------
import value  # noqa: E402
ck(value.value_of(card) == 5000, '皮肤卡卖系统 = 5000 金币', value.value_of(card))

# ---------- ③ WS 使用 ----------
s = ws_connect()
send_text(s, json.dumps({'t': 'hello', 'd': {'token': tok, 'ver': 1}}))
w = wait_for(s, 'welcome', 8)
ck(w is not None, 'WS 登录成功')

send_text(s, json.dumps({'t': 'useskin', 'd': {'iid': iid, 'key': 'f13'}}))
nt = wait_for(s, 'notice', 10)
print('   （使用回执）:', (nt or {}).get('d', {}).get('text'))
# ★ round506：「使用」现在是【解锁 + 直接换上】✗ 文案变成"已解锁并换上：X" ✓
_txt = (nt or {}).get('d', {}).get('text', '')
ck(nt is not None and ('解锁' in _txt), '回执说解锁成功（并换上）', _txt)
ck(('换上' in _txt) or ('解锁皮肤' in _txt), '回执里有"换上"字样（round506 起）', _txt)

row = CON.execute('SELECT COUNT(*) FROM items WHERE id=?', (iid,)).fetchone()[0]
ck(row == 0, '皮肤卡从背包里消失了', row)
un = CON.execute('SELECT key FROM skin_unlocks WHERE role_id=?', (rid,)).fetchall()
ck(len(un) == 1 and un[0]['key'] == 'f13', '解锁表里有 f13', [x['key'] for x in un])

# ---------- ⑤ 不能拿别人的卡 ----------
r2 = mkrole('别人卡')
cur = CON.execute('INSERT INTO items(role_id, in_storage, slot_index, stack, item_json, created_at)'
                  ' VALUES(?,0,0,1,?,?)',
                  (r2['role']['id'], json.dumps({'name': '皮肤·雪女', 'tier': 0, 'kind': 'skin',
                                                 'key': 'f20'}, ensure_ascii=False),
                   int(time.time() * 1000)))
CON.commit()
other_iid = cur.lastrowid
send_text(s, json.dumps({'t': 'useskin', 'd': {'iid': other_iid, 'key': 'f20'}}))
nt2 = wait_for(s, 'notice', 8)
print('   （用别人 id 的回执）:', (nt2 or {}).get('d', {}).get('text'))
un2 = CON.execute('SELECT key FROM skin_unlocks WHERE role_id=? AND key=?', (r2['role']['id'], 'f20')).fetchall()
ck(len(un2) == 0, '拿别人的 id 用 → 别人的卡不会被解锁 ✓')
row2 = CON.execute('SELECT COUNT(*) FROM items WHERE id=?', (other_iid,)).fetchone()[0]
ck(row2 == 1, '别人的卡还在他背包里（没被删）', row2)
mine = CON.execute('SELECT COUNT(*) FROM skin_unlocks WHERE role_id=? AND key=?', (rid, 'f20')).fetchone()[0]
ck(mine == 0, '我也没因此解锁雪女 ✓', mine)

CON.close()
try:
    s.close()
except Exception:
    pass

print()
if FAILS:
    print('FAILED: %d' % FAILS)
    sys.exit(1)
print('全部通过')
