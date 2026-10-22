# -*- coding: utf-8 -*-
"""验收：自动出售设置【真的落库】（重启服务器也不丢）

流程：注册 → WS 登录 → 发 autosell=7 → 等存档线程 → 直接查 sqlite → 再登录看 role.autosell
"""
import base64, json, os, random, socket, sqlite3, string, struct, sys, time, urllib.request

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

ORIGIN = 'http://127.0.0.1:8899'
DB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'server', 'game.db')
FAILS = 0


def ck(c, m, got=None):
    global FAILS
    if c:
        print('  PASS  ' + m)
    else:
        FAILS += 1
        print('  FAIL  ' + m + ('' if got is None else '  got=%r' % (got,)))


nm = '测试存档' + ''.join(random.choices(string.ascii_lowercase + string.digits, k=4))
req = urllib.request.Request(ORIGIN + '/api/register',
                             data=json.dumps({'name': nm, 'password': 'abc123456'}).encode(),
                             headers={'Content-Type': 'application/json'})
reg = json.loads(urllib.request.urlopen(req, timeout=10).read())
tok = reg['token']
rid = reg['role']['id']
print('  测试号:', nm, 'role_id:', rid)


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
        hdr.append(0x80 | 126); hdr += struct.pack('>H', n)
    else:
        hdr.append(0x80 | 127); hdr += struct.pack('>Q', n)
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


s = ws_connect()
send_text(s, json.dumps({'t': 'hello', 'd': {'token': tok, 'ver': 1}}))
welcome = None
t0 = time.time()
while time.time() - t0 < 8:
    m = recv_msg(s, 3)
    if m and m.get('t') == 'welcome':
        welcome = m
        break
ck(welcome is not None, '★ 登录成功')
ck((welcome or {}).get('d', {}).get('role', {}).get('autosell') == 0,
   '★ 新角色默认 autosell=0', (welcome or {}).get('d', {}).get('role', {}).get('autosell'))

# 发 7
send_text(s, json.dumps({'t': 'autosell', 'd': {'tier': 7}}))
time.sleep(2.5)     # 存档线程攒批（半秒一批）

con = sqlite3.connect(DB)
v = con.execute('select autosell from roles where id=?', (rid,)).fetchone()
con.close()
print('  库里 autosell =', v)
ck(v is not None and int(v[0]) == 7, '★★ 数据库里已经是 7（重启也不会丢）', v)

# 再登录一次（新的连接）看服务器有没有读回来
try:
    s.close()
except Exception:
    pass
s2 = ws_connect()
send_text(s2, json.dumps({'t': 'hello', 'd': {'token': tok, 'ver': 1}}))
w2 = None
t0 = time.time()
while time.time() - t0 < 8:
    m = recv_msg(s2, 3)
    if m and m.get('t') == 'welcome':
        w2 = m
        break
got = ((w2 or {}).get('d', {}).get('role', {}) or {}).get('autosell')
print('  重新登录拿到的 autosell =', got)
ck(got == 7, '★★ 重新登录还是 7（读回了库里的值）', got)

# 关掉（0）也要能存
send_text(s2, json.dumps({'t': 'autosell', 'd': {'tier': 0}}))
time.sleep(2.0)
con = sqlite3.connect(DB)
v2 = con.execute('select autosell from roles where id=?', (rid,)).fetchone()
con.close()
ck(v2 is not None and int(v2[0]) == 0, '★★ 改回"不自动卖"也能存下', v2)
try:
    s2.close()
except Exception:
    pass

print('  测试角色: %s (id=%d) —— 记得清理' % (nm, rid))
print('')
print('FAILED: %d' % FAILS if FAILS else 'ALL PASS ✓')
sys.exit(1 if FAILS else 0)
