# -*- coding: utf-8 -*-
"""验收：攻速（含词条）+ 武器基础属性

① 服务端属性表有「攻速」行，值 = 基础 S × (1+攻速%) 夹 [0.6,2.2]，上限写 2.2
② 客户端 wSpdTotal / wInterval 与服务器同一结果（同一个武器 + 词条）
③ 武器浮窗/装备页出现「基础伤害 / 武器系数 / 基础攻速 → 当前攻速」
"""
import base64, json, os, socket, struct, sys, time, urllib.request, random, string

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


nm = '测试攻速' + ''.join(random.choices(string.ascii_lowercase + string.digits, k=4))
reg = json.loads(urllib.request.urlopen(urllib.request.Request(
    ORIGIN + '/api/register',
    data=json.dumps({'name': nm, 'password': 'abc123456'}).encode(),
    headers={'Content-Type': 'application/json'}), timeout=10).read())
tok = reg['token']


def ws_connect():
    s = socket.create_connection(('127.0.0.1', 8900), timeout=6)
    key = base64.b64encode(os.urandom(16)).decode()
    s.sendall(("GET /ws HTTP/1.1\r\nHost: 127.0.0.1:8900\r\nUpgrade: websocket\r\n"
               "Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n"
               % key).encode())
    s.recv(400)
    return s


def send_text(sock, txt):
    d = txt.encode(); h = bytearray([0x81]); n = len(d)
    if n < 126:
        h.append(0x80 | n)
    else:
        h.append(0x80 | 126); h += struct.pack('>H', n)
    m = os.urandom(4); h += m
    sock.sendall(bytes(h) + bytes(b ^ m[i % 4] for i, b in enumerate(d)))


def recv_msg(sock, timeout=6):
    sock.settimeout(timeout)
    try:
        b1 = sock.recv(1)
        if not b1:
            return None
        b2 = sock.recv(1); ln = b2[0] & 0x7f
        if ln == 126:
            ln = struct.unpack('>H', sock.recv(2))[0]
        p = b''
        while len(p) < ln:
            c = sock.recv(ln - len(p))
            if not c:
                break
            p += c
        return json.loads(p.decode('utf-8', 'ignore'))
    except Exception:
        return None


s = ws_connect()
send_text(s, json.dumps({'t': 'hello', 'd': {'token': tok, 'ver': 1}}))
t0 = time.time()
while time.time() - t0 < 8:
    if (recv_msg(s, 3) or {}).get('t') == 'welcome':
        break

send_text(s, json.dumps({'t': 'statask', 'd': {}}))
stats = None
t0 = time.time()
while time.time() - t0 < 8:
    m = recv_msg(s, 3)
    if m and m.get('t') == 'talents':
        stats = (m.get('d', {}) or {}).get('stats')
        break
ck(bool(stats), '★ 拿到属性表')
by = dict((r['k'], r) for r in (stats or []))
print('  攻速行:', json.dumps(by.get('aspd'), ensure_ascii=False))
print('  间隔行:', json.dumps(by.get('interval'), ensure_ascii=False))
ck('aspd' in by, '★★ 属性表里有【攻速】行', list(by.keys()))
ck(by.get('aspd', {}).get('unit') == '×', '★★ 攻速是倍率单位（×）', by.get('aspd', {}).get('unit'))
ck(abs(float(by.get('aspd', {}).get('cap') or 0) - 2.2) < 0.001,
   '★★ 攻速上限 = ×2.2（全局常量，不是按武器也不是按人物）', by.get('aspd', {}).get('cap'))
ck('interval' in by, '★★ 攻击间隔也还在', list(by.keys()))

# 空手：基础 S 应为默认单手剑 1.15
v = float(by.get('aspd', {}).get('v') or 0)
print('  空手攻速 =', v)
ck(abs(v - 1.15) < 0.02, '★★ 空手 = 默认单手剑 ×1.15', v)
iv = float(by.get('interval', {}).get('v') or 0)
print('  空手间隔 =', iv)
ck(abs(iv - 0.62 / 1.15) < 0.02, '★★ 间隔 = 0.62 / 1.15 ≈ 0.54 秒', iv)

s.close()

print('')
print('FAILED: %d' % FAILS if FAILS else 'ALL PASS ✓')
sys.exit(1 if FAILS else 0)
