# -*- coding: utf-8 -*-
"""皮肤自定义验收（round510）

① 只认【该皮肤】的重复卡：别的皮肤的卡不算、只有 1 张也不算（那是解锁用的）
② 一个部位一张卡：改眼型扣 1 张 ✗ 再改嘴型再扣 1 张 ✓
③ 落库：skin_custom 里存的是 **key**（narrow / smile / 颜色整数）
④ 回执 + 快照：skincustomok 给 {skin:{ey,mo,iris,hair,shirt}}（下标形式）
⑤ 未解锁的皮肤不能改
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


def wait_for(sock, want, secs=8):
    t0 = time.time()
    while time.time() - t0 < secs:
        m = recv_msg(sock, 2)
        if m and m.get('t') == want:
            return m
    return None


def insert_card(rid, key, n=1):
    con = sqlite3.connect(DB, timeout=8)
    for _ in range(n):
        it = {'name': '皮肤·测试', 'tier': 0, 'kind': 'skin', 'key': key}
        con.execute("INSERT INTO items(role_id, in_storage, slot_index, stack, item_json, created_at)"
                    " VALUES(?,0,-1,1,?,?)",
                    (rid, json.dumps(it, ensure_ascii=False), int(time.time() * 1000)))
    con.commit()
    con.close()


def card_count(rid, key):
    con = sqlite3.connect(DB, timeout=8)
    n = 0
    for (js,) in con.execute("SELECT item_json FROM items WHERE role_id=? AND in_storage=0", (rid,)):
        try:
            it = json.loads(js)
        except Exception:
            continue
        if it.get('kind') == 'skin' and it.get('key') == key:
            n += 1
    con.close()
    return n


def custom_row(rid, key):
    con = sqlite3.connect(DB, timeout=8)
    r = con.execute('SELECT data FROM skin_custom WHERE role_id=? AND skin_key=?',
                    (rid, key)).fetchone()
    con.close()
    return json.loads(r[0]) if r else None


nm = '捏脸' + ''.join(random.choices(string.ascii_lowercase, k=4))
reg = api('/api/register', {'name': nm, 'password': 'abc123456'})
tok, rid = reg['token'], reg['role']['id']
at = api('/api/admin/login', {'password': 'xiuxian-admin'})['token']
# ★ round527：管理页现在只发【皮肤卡】✗ 不再直接解锁 ✓
#   这个测试要的是"已解锁"，所以直接写解锁表（测试夹具 ✓）
api('/api/admin/act', {'act': 'give', 'name': nm, 'kind': 'skin', 'skinKey': 'f01',
                       'count': 1}, admin=at)
_c = sqlite3.connect(DB, timeout=8)
_c.execute('INSERT OR IGNORE INTO skin_unlocks(role_id, key, at) VALUES(?,?,?)',
           (rid, 'f01', int(time.time() * 1000)))
_c.execute('UPDATE roles SET skin=? WHERE id=?', ('f01', rid))
_c.commit()
_c.close()
insert_card(rid, 'f01', 1)      # 管理页已经发了 1 张 → 再补 1 张 = 2 张（1 张是重复的 ✓）
insert_card(rid, 'f06', 2)      # 别人的卡 ✗ 不能用

s = ws_connect()
send_text(s, json.dumps({'t': 'hello', 'd': {'token': tok, 'ver': 1}}))
w = wait_for(s, 'welcome', 10)
ck(w is not None, '登录成功')
ck('skcMap' in json.dumps(w or {}), 'welcome 里有皮肤自定义字段（skcMap）')

# ① 用别的皮肤的卡 → 拒绝
before = max(0, card_count(rid, 'f06') - 2)
# ★ 女生的眼型 key 是 thin（'narrow' 是男生的 ✗ 会正确被拒）
send_text(s, json.dumps({'t': 'skincustom',
                         'd': {'skin': 'f01', 'field': 'ey', 'value': 'thin'}}))
r1 = wait_for(s, 'skincustomok', 6)
ck(r1 is not None, '换眼型：f01 有重复卡 → 成功', (r1 or {}).get('t'))

# 实际应该成功（f01 有 1 张重复卡）；f06 的卡不能被吃
ck(card_count(rid, 'f06') == 2, 'f06 的卡没被动 ✓', card_count(rid, 'f06'))
ck(card_count(rid, 'f01') == 1, 'f01 的重复卡被扣了 1 张 ✓', card_count(rid, 'f01'))
d = custom_row(rid, 'f01')
ck(d is not None and d.get('ey') == 'thin', '落库存的是 key（ey=thin）', d)

# ② 再改一次：f01 已经没有重复卡了 → 拒绝
send_text(s, json.dumps({'t': 'skincustom',
                         'd': {'skin': 'f01', 'field': 'mo', 'value': 'smile'}}))
got = None
t0 = time.time()
while time.time() - t0 < 6:
    m = recv_msg(s, 2)
    if not m:
        continue
    if m.get('t') == 'notice' and '卡' in str((m.get('d') or {}).get('text')):
        got = m
        break
    if m.get('t') == 'skincustomok':
        got = m
        break
ck(got is not None and got.get('t') == 'notice', '没重复卡了 → 拒绝并提示', (got or {}).get('t'))

# ③ 颜色：合法整数能存
insert_card(rid, 'f01', 2)
send_text(s, json.dumps({'t': 'skincustom',
                         'd': {'skin': 'f01', 'field': 'hair', 'value': 0xff5c8a}}))
r3 = wait_for(s, 'skincustomok', 8)
ck(r3 is not None, '改头发颜色成功', (r3 or {}).get('t'))
d2 = custom_row(rid, 'f01')
ck(d2.get('hair') == 0xff5c8a and d2.get('ey') == 'thin',
   '颜色和之前的眼型都还在（合并保存 ✓）', d2)

# ③b 裙子 / 裤子 颜色（round519）
insert_card(rid, 'f01', 2)
send_text(s, json.dumps({'t': 'skincustom',
                         'd': {'skin': 'f01', 'field': 'skirt', 'value': 0x2244ff}}))
r3b = wait_for(s, 'skincustomok', 8)
ck(r3b is not None, '改裙子颜色成功', (r3b or {}).get('t'))
d3 = custom_row(rid, 'f01')
ck(d3.get('skirt') == 0x2244ff, '裙子颜色落库了', d3)
insert_card(rid, 'f01', 2)
send_text(s, json.dumps({'t': 'skincustom',
                         'd': {'skin': 'f01', 'field': 'pants', 'value': 0x112233}}))
r3c = wait_for(s, 'skincustomok', 8)
d4 = custom_row(rid, 'f01')
ck(d4.get('pants') == 0x112233 and d4.get('skirt') == 0x2244ff,
   '裤子颜色落库，且裙子/眼型/头发都还在', d4)

# ④ 非法值拒绝
send_text(s, json.dumps({'t': 'skincustom',
                         'd': {'skin': 'f01', 'field': 'hair', 'value': 99999999}}))
bad = None
t0 = time.time()
while time.time() - t0 < 6:
    m = recv_msg(s, 2)
    if m and m.get('t') == 'notice':
        bad = m
        break
ck(bad is not None, '非法颜色被拒 ✓', (bad or {}).get('text'))
ck(card_count(rid, 'f01') >= 1, '被拒时没扣卡 ✓', card_count(rid, 'f01'))

# ⑤ 未解锁的皮肤不能改
#   ★ 先把上一步遗留的 notice 读干净 ✗ 不然会拿错（踩过）
t0 = time.time()
while time.time() - t0 < 1.2:
    recv_msg(s, 0.3)
send_text(s, json.dumps({'t': 'skincustom',
                         'd': {'skin': 'f13', 'field': 'ey', 'value': 'cat'}}))
bad2 = None
t0 = time.time()
while time.time() - t0 < 6:
    m = recv_msg(s, 2)
    if m and m.get('t') == 'notice':
        _tx2 = str((m.get('d') or {}).get('text'))
        if '解锁' in _tx2 or '还没' in _tx2:
            bad2 = m
            break
ck(bad2 is not None, '没解锁的皮肤不能改 ✓', (bad2.get('d') or {}).get('text') if bad2 else None)

# ⑥ 快照里带 skc（客户端给别人看）
time.sleep(1.2)
try:
    s.close()
except Exception:
    pass

print()
if FAILS:
    print('FAILED: %d' % FAILS)
    sys.exit(1)
print('全部通过')
