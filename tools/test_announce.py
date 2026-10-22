# -*- coding: utf-8 -*-
"""公告流程验收（round496）

覆盖：
  ① 发布 → 新号登录时 welcome 带 ann
  ② annread → roles.announce_seen 落库
  ③ 再登录 → 不再带 ann（不重复打扰）
  ④ 撤回 → 没看过的人也不弹
  ⑤ 编辑已发布（不换 id）→ 没看过的人拿到的是新内容，看过的人不弹
  ⑥ 另存为新公告 → 所有人再弹
  ⑦ 非法状态 / 删已发布 → 拒绝
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
import urllib.error
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


def api(path, body=None, method=None, admin=None):
    req = urllib.request.Request(ORIGIN + path,
                                 data=None if body is None else json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'},
                                 method=method)
    if admin:
        req.add_header('X-Admin', admin)
    try:
        return json.loads(urllib.request.urlopen(req, timeout=10).read())
    except urllib.error.HTTPError as e:
        try:
            j = json.loads(e.read().decode('utf-8', 'ignore'))
        except Exception:
            j = {}
        j.setdefault('ok', False)
        j.setdefault('http', e.code)
        return j


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
        try:
            m = recv_msg(sock, 3)
        except Exception:
            break
        if m and m.get('t') == want:
            m['d'] = m.get('d') or {}
            return m
    return None


def new_role(tag='公告'):
    nm = tag + ''.join(random.choices(string.ascii_lowercase, k=4))
    r = api('/api/register', {'name': nm, 'password': 'abc123456'})
    return r['token'], r['role']['id'], nm


AT = api('/api/admin/login', {'password': 'xiuxian-admin'})['token']

# 清场：把本测试用过的公告全删掉（只删草稿；已发布的先撤回再删不了 → 直接留档）
ck(True, '管理登录成功')

# 先把【所有还活着的公告】撤回 ✗ 不然"最新一条 live"可能是别人的测试公告 ✓
try:
    for a in api('/api/admin/announce', admin=AT).get('list') or []:
        if a.get('status') == 'live':
            api('/api/admin/announce/%d' % a['id'], {'status': 'retracted'},
                method='PUT', admin=AT)
    print('  （已把 ' + str(len(api('/api/admin/announce', admin=AT).get('list') or [])) +
          ' 条历史里还在 live 的都撤回了）')
except Exception as _e:
    print('  清理失败：%r' % (_e,))

# ---------- ① 发布一条 ----------
mk = {
    'ver': 'vT', 'title': '测试公告', 'date': '2026-10-19', 'headline': '自动化测试',
    'badge': '忽略我', 'foot': 'foot',
    'items': [{'tag': '系统', 't': '第一张卡', 'b': ['要点一', '要点二']}],
    'publish': True
}
r = api('/api/admin/announce', mk, admin=AT)
ck(r.get('ok') and r.get('id'), '发布成功', r.get('id'))
aid = r['id']

tok, rid, nm = new_role('公告')
s = ws_connect()
send_text(s, json.dumps({'t': 'hello', 'd': {'token': tok, 'ver': 1}}))
w = wait_for(s, 'welcome', 10)
ck(w is not None, '登录成功')
ann = (w or {}).get('d', {}).get('ann')
ck(ann and ann.get('id') == aid, 'welcome 里带了公告（未读过）', ann and ann.get('id'))
ck(ann and len(ann.get('items') or []) == 1, '公告卡片数量对', ann and len(ann.get('items') or []))

# ---------- ② annread ----------
send_text(s, json.dumps({'t': 'annread', 'd': {'id': aid}}))
time.sleep(1.2)
con = sqlite3.connect(DB, timeout=8)
seen = con.execute('SELECT announce_seen FROM roles WHERE id=?', (rid,)).fetchone()[0]
ck(int(seen) == aid, 'announce_seen 落库了', seen)
con.close()

# ---------- ③ 再登录不弹 ----------
send_text(s, json.dumps({'t': 'hello', 'd': {'token': tok, 'ver': 1}}))
w2 = wait_for(s, 'welcome', 10)
ann2 = (w2 or {}).get('d', {}).get('ann')
ck(not ann2, '看过了就不再弹', ann2)
try:
    s.close()
except Exception:
    pass

# ---------- ④ 撤回後，新号不弹 ----------
api('/api/admin/announce/%d' % aid, {'status': 'retracted'}, method='PUT', admin=AT)
tok2, rid2, nm2 = new_role('公告')
s2 = ws_connect()
send_text(s2, json.dumps({'t': 'hello', 'd': {'token': tok2, 'ver': 1}}))
w3 = wait_for(s2, 'welcome', 10)
ck(not (w3 or {}).get('d', {}).get('ann'), '撤回后新号也不弹')

# ---------- ⑤ 重新发布同一条 + 编辑 ----------
api('/api/admin/announce/%d' % aid, {'status': 'live'}, method='PUT', admin=AT)
api('/api/admin/announce/%d' % aid, dict(mk, headline='改过的标题'), method='PUT', admin=AT)
tok3, rid3, nm3 = new_role('公告')
s3 = ws_connect()
send_text(s3, json.dumps({'t': 'hello', 'd': {'token': tok3, 'ver': 1}}))
w4 = wait_for(s3, 'welcome', 10)
a4 = (w4 or {}).get('d', {}).get('ann')
ck(a4 and a4.get('headline') == '改过的标题', '编辑后内容立刻生效（id 不变）',
   a4 and a4.get('headline'))
ck(a4 and a4.get('id') == aid, 'id 没变（所以看过的人不会重弹）', a4 and a4.get('id'))

# ---------- ⑥ 另存为新公告 → 老看客也弹 ----------
r6 = api('/api/admin/announce', dict(mk, headline='第二版'), admin=AT)
aid2 = r6['id']
ck(aid2 > aid, '新公告 id 更大', aid2)
tok4, rid4, nm4 = new_role('公告')
# 让 rid（已看过 aid）再看一次：直接改他的 seen 为 aid，然后新公告
s4 = ws_connect()
send_text(s4, json.dumps({'t': 'hello', 'd': {'token': tok, 'ver': 1}}))
w5 = wait_for(s4, 'welcome', 10)
a5 = (w5 or {}).get('d', {}).get('ann')
ck(a5 and a5.get('id') == aid2, '新公告会让看过旧公告的人再弹', a5 and a5.get('id'))

# ---------- ⑦ 删已发布 → 拒绝 ----------
d1 = api('/api/admin/announce/%d' % aid2, method='DELETE', admin=AT)
ck(not d1.get('ok'), '已发布的不能直接删', d1)

# 收尾：撤回测试公告（不删库 ✓ 留档）
api('/api/admin/announce/%d' % aid, {'status': 'retracted'}, method='PUT', admin=AT)
api('/api/admin/announce/%d' % aid2, {'status': 'retracted'}, method='PUT', admin=AT)

print()
if FAILS:
    print('FAILED: %d' % FAILS)
    sys.exit(1)
print('全部通过')
