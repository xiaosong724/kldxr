# -*- coding: utf-8 -*-
"""技能系统 P1 验收（round538）

① 管理页能发技能书
② 背包用书 → 学会（书消失）
③ 学习上限 20
④ 装配 5 槽 / 同技能不能占两槽
⑤ 遗忘（不返还，装在槽里要先卸）
"""
import json
import os
import random
import sqlite3
import string
import sys
import time
import urllib.request
import base64
import socket
import struct

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
    s = socket.create_connection(('127.0.0.1', 8900), timeout=6)
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


def wait(sock, want, secs=6):
    t0 = time.time()
    while time.time() - t0 < secs:
        m = recv(sock, 1)
        if m and m.get('t') == want:
            return m
    return None


nm = '技能' + ''.join(random.choices(string.ascii_lowercase, k=4))
reg = api('/api/register', {'name': nm, 'password': 'abc123456'})
rid = reg['role']['id']
at = api('/api/admin/login', {'password': 'xiuxian-admin'})['token']

print('① 管理页发技能书：')
r = api('/api/admin/act', {'act': 'give', 'name': nm, 'kind': 'skillbook',
                           'skillKey': 'blackhole', 'count': 1}, admin=at)
print('   ', {k: r.get(k) for k in ('ok', 'cards', 'item')})
ck(r.get('ok') is True and r.get('cards') == 1, '发成功 1 本')
con = sqlite3.connect(DB, timeout=8)
row = con.execute('SELECT id, item_json FROM items WHERE role_id=? AND in_storage=0', (rid,)).fetchone()
con.close()
it = json.loads(row[1]) if row else {}
ck(it.get('kind') == 'skillbook' and it.get('key') == 'blackhole', '背包里是技能书·黑洞', it)

print()
print('② 用书学技能：')
s1 = ws(reg['token'])
wait(s1, 'welcome', 10)
send(s1, json.dumps({'t': 'useskillbook', 'd': {'iid': row[0]}}))
ok = wait(s1, 'skillok', 8)
ck(ok is not None, '收到 skillok')
learn = (ok or {}).get('d', {}).get('learn', {})
ck('blackhole' in learn, '学会了黑洞', list(learn.keys())[:3])
con = sqlite3.connect(DB, timeout=8)
n_book = con.execute("SELECT COUNT(*) FROM items WHERE role_id=? AND item_json LIKE '%skillbook%'",
                     (rid,)).fetchone()[0]
con.close()
ck(n_book == 0, '技能书被消耗掉了', n_book)

print()
print('③ 装配：')
send(s1, json.dumps({'t': 'skillload', 'd': {'kind': 'A', 'slot': 0, 'key': 'blackhole'}}))
ok = wait(s1, 'skillok', 8)
load = (ok or {}).get('d', {}).get('load', {})
ck((load.get('A') or [None])[0] == 'blackhole', '装到 A 槽 0', load.get('A'))
# 装到第二个槽（同一个技能不该占两槽）
send(s1, json.dumps({'t': 'skillload', 'd': {'kind': 'A', 'slot': 1, 'key': 'blackhole'}}))
ok = wait(s1, 'skillok', 8)
load = (ok or {}).get('d', {}).get('load', {})
ck(load.get('A')[0] is None and load.get('A')[1] == 'blackhole', '同一技能不会占两个槽', load.get('A'))

print()
print('④ 遗忘（装在槽里要先卸）：')
send(s1, json.dumps({'t': 'skillforget', 'd': {'key': 'blackhole'}}))
e1 = wait(s1, 'skillerr', 6)
ck(e1 is not None and '卸下' in str((e1.get('d') or {}).get('msg')), '装在槽里时拒绝遗忘',
   (e1 or {}).get('d'))
send(s1, json.dumps({'t': 'skillload', 'd': {'kind': 'A', 'slot': 1}}))
wait(s1, 'skillok', 6)
send(s1, json.dumps({'t': 'skillforget', 'd': {'key': 'blackhole'}}))
ok = wait(s1, 'skillok', 8)
ck(ok is not None and 'blackhole' not in ((ok.get('d') or {}).get('learn') or {}),
   '卸下后可以遗忘', (ok or {}).get('d', {}).get('learn'))

print()
print('⑤ 学习上限 20：')
con = sqlite3.connect(DB, timeout=8)
now = int(time.time() * 1000)
keys = [r[0] for r in con.execute('SELECT key FROM skill_learn WHERE role_id=?', (rid,))]
con.close()
import sys as _s
_s.path.insert(0, os.path.join(ROOT, 'server'))
import skills as skm
left = [k for k in skm.KEYS if skm.KIND[k] == 'A' and k not in keys and k != 'icefield']
con = sqlite3.connect(DB, timeout=8)
for k in left:
    con.execute('INSERT OR IGNORE INTO skill_learn(role_id,key,kind,tier,at) VALUES(?,?,?,?,?)',
                (rid, k, 'A', 1, now))
con.commit()
n_A = con.execute("SELECT COUNT(*) FROM skill_learn WHERE role_id=? AND kind='A'", (rid,)).fetchone()[0]
con.close()
ck(n_A <= 20, '造的数据不超过 20', n_A)
# ★ 每类技能总数目前是 15/9/14 < 20 → 上限暂时撞不到
#   为了验证"到 20 会拒绝"，直接往库里塞 5 条占位（kind=A）
import random as _r
for _i in range(20 - (len(keys) + len(left))):
    con = sqlite3.connect(DB, timeout=8)
    con.execute('INSERT OR IGNORE INTO skill_learn(role_id,key,kind,tier,at) VALUES(?,?,?,?,?)',
                (rid, 'zz_dummy_%d' % _i, 'A', 1, now))
    con.commit(); con.close()
con = sqlite3.connect(DB, timeout=8)
n_A = con.execute("SELECT COUNT(*) FROM skill_learn WHERE role_id=? AND kind='A'", (rid,)).fetchone()[0]
con.close()
ck(n_A == 20, '造满 20 条（含占位）', n_A)
send(s1, json.dumps({'t': 'skillload', 'd': {'kind': 'A', 'slot': 0, 'key': left[0]}}))
wait(s1, 'skillok', 6)
# 再学一个就应被拒（先找一个没学的 A 技能 —— 主动只有 15 个，改用 B 类验证）
send(s1, json.dumps({'t': 'skilllearn', 'd': {'key': 'icefield'}}))
e2 = wait(s1, 'skillerr', 6)
ck(e2 is not None and '学满' in str((e2.get('d') or {}).get('msg')), '学满 20 后被拒',
   (e2 or {}).get('d'))

print()
if FAILS:
    print('FAILED: %d' % FAILS)
    sys.exit(1)
print('全部通过')
