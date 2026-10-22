# -*- coding: utf-8 -*-
"""验收（服务端链路）：statask → 服务器回一份完整属性表（17 项，含吸血）"""
import base64, json, os, random, socket, string, struct, sys, time, urllib.request

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

ORIGIN = 'http://127.0.0.1:8899'
FAILS = 0


def ck(c, m, got=None):
    global FAILS
    if c:
        print('  PASS  ' + m)
    else:
        FAILS += 1
        print('  FAIL  ' + m + ('' if got is None else '  got=%r' % (got,)))


nm = '测试属性链' + ''.join(random.choices(string.ascii_lowercase + string.digits, k=4))
req = urllib.request.Request(ORIGIN + '/api/register',
                             data=json.dumps({'name': nm, 'password': 'abc123456'}).encode(),
                             headers={'Content-Type': 'application/json'})
reg = json.loads(urllib.request.urlopen(req, timeout=10).read())
tok = reg['token']
print('  测试号:', nm)


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
    op = b1[0] & 0x0f
    ln = b2[0] & 0x7f
    if ln == 126:
        ln = struct.unpack('>H', sock.recv(2))[0]
    elif ln == 127:
        ln = struct.unpack('>Q', sock.recv(8))[0]
    payload = b''
    while len(payload) < ln:
        chunk = sock.recv(ln - len(payload))
        if not chunk:
            break
        payload += chunk
    if op == 8:
        return {'t': '__close__'}
    return json.loads(payload.decode('utf-8', 'ignore'))


s = ws_connect()
send_text(s, json.dumps({'t': 'hello', 'd': {'token': tok, 'ver': 1}}))
msgs = []
deadline = time.time() + 6
welcome = None
while time.time() < deadline:
    try:
        m = recv_msg(s, 3)
    except Exception:
        break
    if not m:
        break
    msgs.append(m.get('t'))
    if m.get('t') == 'welcome':
        welcome = m
        break
ck(welcome is not None, '★ 登录成功（收到 welcome）', msgs)

# 进世界后服务器会推一份 talents（带 stats）
send_text(s, json.dumps({'t': 'statask', 'd': {}}))
got = None
deadline = time.time() + 8
while time.time() < deadline:
    try:
        m = recv_msg(s, 3)
    except Exception:
        break
    if not m:
        break
    if m.get('t') == 'talents':
        got = m
        break
ck(got is not None, '★★ statask 之后服务器回了 talents 包')

stats = (got or {}).get('d', {}).get('stats') or []
print('  属性项数: %d' % len(stats))
keys = [r['k'] for r in stats]
print('  属性键:', keys)
ck(len(stats) >= 15, '★★ 至少 15 项属性（实测 %d）' % len(stats))
ck('lifesteal' in keys, '★★ 有吸血 lifesteal')
ck('atk' in keys and 'hp' in keys and 'aspd' in keys, '★★ 攻击/生命/攻速都在')
ck('dodge' in keys and 'dr_fix' in keys, '★★ 闪避/固定减伤也列出来了')
grps = sorted(set(r.get('grp') for r in stats))
print('  分组:', grps)
ck(len(grps) >= 3, '★ 分了组（%s）' % grps)
# 每一项都要有 n / v / unit / grp
bad = [r for r in stats if not all(k in r for k in ('k', 'n', 'v', 'unit', 'grp'))]
ck(not bad, '★ 每项字段齐全', bad[:2])

try:
    s.close()
except Exception:
    pass

# 清理
try:
    at = json.loads(urllib.request.urlopen(urllib.request.Request(
        ORIGIN + '/api/admin/login',
        data=json.dumps({'password': 'xiuxian-admin'}).encode(),
        headers={'Content-Type': 'application/json'}), timeout=8).read())
    urllib.request.urlopen(urllib.request.Request(
        ORIGIN + '/api/admin/act',
        data=json.dumps({'act': 'delplayer', 'name': nm}).encode(),
        headers={'Content-Type': 'application/json', 'X-Admin': at['token']}), timeout=8)
except Exception:
    pass

print('')
print('FAILED: %d' % FAILS if FAILS else 'ALL PASS ✓')
sys.exit(1 if FAILS else 0)
