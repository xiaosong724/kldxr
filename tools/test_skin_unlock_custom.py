# -*- coding: utf-8 -*-
"""round528 四条修复验收

① 背包「使用」皮肤卡 = 只解锁 ✗ 不换装（roles.skin 不变）
② 自定义只能改【使用中】的皮肤（服务端：未穿上的拒绝）
③ 保存后：服务端推 skin(带 c) + notice（客户端据此 toast + 重建）
④ 别人能看见：快照里带 skc
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


def ws(cid_token):
    s = socket.create_connection(('127.0.0.1', 8900), timeout=6)
    key = base64.b64encode(os.urandom(16)).decode()
    s.sendall(("GET /ws HTTP/1.1\r\nHost: 127.0.0.1:8900\r\nUpgrade: websocket\r\n"
               "Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n"
               % key).encode())
    s.recv(400)
    send(s, json.dumps({'t': 'hello', 'd': {'token': cid_token, 'ver': 1}}))
    return s


def send(sock, txt):
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
        m = recv(sock, 2)
        if m and m.get('t') == want:
            return m
    return None


def mkrole(tag):
    nm = tag + ''.join(random.choices(string.ascii_lowercase, k=4))
    r = api('/api/register', {'name': nm, 'password': 'abc123456'})
    return r['token'], r['role']['id'], nm


at = api('/api/admin/login', {'password': 'xiuxian-admin'})['token']

# ---------- ① 用卡只解锁 ----------
tok, rid, nm = mkrole('解锁')
api('/api/admin/act', {'act': 'give', 'name': nm, 'kind': 'skin', 'skinKey': 'f05',
                       'count': 1}, admin=at)
s1 = ws(tok)
ck(wait(s1, 'welcome', 10) is not None, '登录成功')
# 拿卡片 id
con = sqlite3.connect(DB, timeout=8)
iid = None
for (x, js) in con.execute('SELECT id, item_json FROM items WHERE role_id=? AND in_storage=0', (rid,)):
    it = json.loads(js)
    if it.get('kind') == 'skin' and it.get('key') == 'f05':
        iid = x
con.close()
send(s1, json.dumps({'t': 'useskin', 'd': {'iid': iid, 'key': 'f05'}}))
nt = wait(s1, 'notice', 8)
print('   回执:', (nt or {}).get('d', {}).get('text'))
ck(nt is not None and '解锁' in str((nt.get('d') or {}).get('text')), '回执是"已解锁"')
time.sleep(1.0)
con = sqlite3.connect(DB, timeout=8)
skin_now = (con.execute('SELECT skin FROM roles WHERE id=?', (rid,)).fetchone() or [''])[0]
unl = [r[0] for r in con.execute('SELECT key FROM skin_unlocks WHERE role_id=?', (rid,))]
con.close()
ck('f05' in unl, '皮肤已解锁', unl)
# ★ 2026-10-22（用户："皮肤卡...使用多少消耗多少"）：
#   现在的契约是【用一张卡 = 解锁 + 直接换上】（和 test_skin_item 一致，round506）。
#   这条以前断言"没有自动换上"，已经过时。
ck(skin_now == 'f05', '用完卡自动换上了 f05', skin_now)

# ---------- ② 使用中的皮肤可以直接自定义 ----------
send(s1, json.dumps({'t': 'skincustom', 'd': {'skin': 'f05', 'field': 'ey', 'value': 'cat'}}))
r2 = None
t0 = time.time()
while time.time() - t0 < 8:
    m = recv(s1, 2)
    if m and m.get('t') in ('notice', 'skincustomok'):
        r2 = m
        break
ck(r2 is not None, '使用中的皮肤可以自定义', (r2 or {}).get('t'))
# 已经不存在的"重新穿上"那一步：卡用完就自动穿上了，跳过（setskin 仍可用，不再断言）
# 给两张 f05 卡（1 张解锁用的已消耗 → 再补 2 张 = 有重复）
api('/api/admin/act', {'act': 'give', 'name': nm, 'kind': 'skin', 'skinKey': 'f05',
                       'count': 2}, admin=at)
send(s1, json.dumps({'t': 'skincustom', 'd': {'skin': 'f05', 'field': 'hair', 'value': 0xff3366}}))
ok2 = wait(s1, 'skincustomok', 8)
ck(ok2 is not None, '穿上之后可以自定义', (ok2 or {}).get('t'))
# ③ 保存后有 skin 推送（带 c）+ notice
skm = wait(s1, 'skin', 5)
ck(skm is not None, '服务器推了 skin 消息（客户端据此重建）', (skm or {}).get('t'))
ck(bool((skm or {}).get('d', {}).get('c')), 'skin 消息里带自定义 c', (skm or {}).get('d', {}).get('c'))
notice = wait(s1, 'notice', 5)
print('   保存提示:', (notice or {}).get('d', {}).get('text'))
ck(notice is not None and '保存' in str((notice.get('d') or {}).get('text')), '保存后有提示')

# ---------- ④ 别人能看见 ----------
tok2, rid2, nm2 = mkrole('看客')
s2 = ws(tok2)
w2 = wait(s2, 'welcome', 10)
ck(w2 is not None, '第二个号登录')
seen = None
t0 = time.time()
while time.time() - t0 < 10:
    m = recv(s2, 2)
    if m and m.get('t') == 'world':
        for o in (m.get('d', {}) or {}).get('players', []) or []:
            if isinstance(o, dict) and (o.get('n') or '') == nm:
                seen = o
                break
        if seen:
            break
ck(seen is not None, '在世界快照里看到对方')
ck(bool(seen and seen.get('skc')), '★ 对方快照里带 skc（别人能看见自定义）', seen and seen.get('skc'))
ck(bool(seen and seen.get('skc', {}).get('hair') == 0xff3366),
   '颜色也对（0xff3366）', seen and seen.get('skc'))

print()
if FAILS:
    print('FAILED: %d' % FAILS)
    sys.exit(1)
print('全部通过')
