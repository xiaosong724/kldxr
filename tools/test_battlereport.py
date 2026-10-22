# -*- coding: utf-8 -*-
"""战报验收（本地、不需要 QQ）

① 计数：经验/金币/击杀/装备（按 look+tier 合并）→ 排序（经验降序）
② 取走即清空（下一段从 0 开始）
③ 渲染 PNG：文件存在、宽 1180、有内容
④ 发图：起一个假的 OneBot WS 服务，核对客户端发出的 JSON（send_group_msg + image 段）
"""
import base64
import hashlib
import json
import os
import socket
import struct
import sys
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'server'))

import battlereport_run as R  # noqa: E402

FAILS = 0


def ck(c, m, got=None):
    global FAILS
    if c:
        print('  PASS  ' + m)
    else:
        FAILS += 1
        print('  FAIL  ' + m + ('' if got is None else '  got=%r' % (got,)))


class P(object):
    def __init__(self, rid, name):
        self.role_id = rid
        self.name = name


R.reset()
a = P(1, '半个六道')
b = P(2, '林小满')
c = P(3, '阿飞')

R.add_exp(a, 48000); R.add_gold(a, 8400); R.add_kill(a, 3)
R.add_gear(a, {'slot': 'weapon', 'look': 'sword', 'tier': 7})
R.add_gear(a, {'slot': 'weapon', 'look': 'sword', 'tier': 7})
R.add_gear(a, {'slot': 'armor', 'tier': 6})
R.add_gear(a, {'slot': 'material', 'name': '破布', 'tier': 1})   # ★ 材料不算 ✓

R.add_exp(b, 39000); R.add_gold(b, 12000); R.add_kill(b, 2)
R.add_gear(b, {'slot': 'weapon', 'look': 'axe', 'tier': 6})
R.add_exp(c, 31000)

rows = R.take()
ck(len(rows) == 3, '三个玩家都在', len(rows))
ck([x['name'] for x in rows] == ['半个六道', '林小满', '阿飞'], '按经验降序',
   [x['name'] for x in rows])
top = rows[0]
ck(top['exp'] == 48000 and top['gold'] == 8400 and top['kills'] == 3, '数值对', top)
ck(top['gearTotal'] == 3, '装备只算武器/防具（材料不算）', top['gearTotal'])
gs = {(g['look'], g['tier']): g['n'] for g in top['gear']}
ck(gs.get(('sword', 7)) == 2, '同款装备合并计数（剑 7 阶 ×2）', gs)
ck(gs.get(('armor', 6)) == 1, '防具单列', gs)
ck(rows[0]['gear'][0]['tier'] >= rows[0]['gear'][-1]['tier'], '装备按品阶降序',
   [(g['look'], g['tier']) for g in rows[0]['gear']])

# ② 取走即清空
ck(R.take() == [], '取走后计数清空')

# ③ 渲染
path, w, h = R.build_png(rows, time.time() - 900, time.time(),
                         os.path.join(ROOT, 'docs', 'shots', 'report-live.png'))
ck(os.path.isfile(path) and os.path.getsize(path) > 20000,
   '渲染出 PNG（>20KB）', os.path.getsize(path) if os.path.isfile(path) else 0)
ck(w == 1180, '宽度 1180', w)


# ④ 假 OneBot WS 服务，验证 send_image 发出的内容
class MockOneBot(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True)
        self.got = None
        self.port = 0
        self.srv = socket.socket()
        self.srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.srv.bind(('127.0.0.1', 0))
        self.port = self.srv.getsockname()[1]
        self.srv.listen(1)

    def run(self):
        try:
            conn, _ = self.srv.accept()
        except Exception:
            return
        try:
            req = b''
            while b'\r\n\r\n' not in req:
                ch = conn.recv(1)
                if not ch:
                    return
                req += ch
            key = b''
            for line in req.split(b'\r\n'):
                if line.lower().startswith(b'sec-websocket-key:'):
                    key = line.split(b':', 1)[1].strip()
            acc = base64.b64encode(hashlib.sha1(
                key + b'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest()).decode()
            conn.sendall(('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n'
                          'Connection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n'
                          % acc).encode())
            # 读一帧（客户端掩码 ✓）
            b1 = conn.recv(1); b2 = conn.recv(1)
            ln = b2[0] & 0x7f
            if ln == 126:
                ln = struct.unpack('>H', conn.recv(2))[0]
            mask = conn.recv(4)
            data = b''
            while len(data) < ln:
                data += conn.recv(ln - len(data))
            txt = bytes(ch ^ mask[i % 4] for i, ch in enumerate(data)).decode('utf-8', 'ignore')
            self.got = txt
            # 回一条 ok
            out = json.dumps({'status': 'ok', 'retcode': 0, 'echo': 'rpt'}).encode()
            hdr = bytearray([0x81, len(out)])
            conn.sendall(bytes(hdr) + out)
            time.sleep(0.3)
        except Exception as e:
            self.got = {'err': repr(e)}
        finally:
            try:
                conn.close()
            except Exception:
                pass


mock = MockOneBot()
mock.start()
time.sleep(0.2)
cfg = {'battleReport': {'group': '123456', 'onebotHost': '127.0.0.1',
                        'onebotPort': mock.port, 'onebotToken': 'tk'}}
ok, err = R.send_image(cfg, path)
ck(ok, 'send_image 认为发送成功', err)
time.sleep(0.3)
got = mock.got
try:
    j = json.loads(got) if isinstance(got, str) else {}
except Exception:
    j = {}
ck(isinstance(got, str) and j.get('action') == 'send_group_msg', '动作是 send_group_msg',
   (got or '')[:120])
msg = (j.get('params') or {}).get('message') or []
ck(bool(msg) and msg[0].get('type') == 'image' and
   msg[0].get('data', {}).get('file') == path, '消息里是 image 段 + 本地文件路径', msg)
ck(str((j.get('params') or {}).get('group_id')) == '123456', '群号对',
   (j.get('params') or {}).get('group_id'))

print()
if FAILS:
    print('FAILED: %d' % FAILS)
    sys.exit(1)
print('全部通过')
