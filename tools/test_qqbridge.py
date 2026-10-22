# -*- coding: utf-8 -*-
"""round417：QQ 群转发桥的离线测试

★ 绝不往【真群】里发消息 ✗ 这里起一个假的 qq-forwarder（本机 http.server）✓
  它收到什么，这里就断言什么 ✓
跑法：python tools\\test_qqbridge.py
"""
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
sys.path.insert(0, os.path.join(_ROOT, 'server'))

import qqbridge as QB      # noqa: E402
import world as W          # noqa: E402

FAILS = []
GOT = []
PORT = 18099


class _H(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(n).decode('utf-8')
        try:
            GOT.append((self.path, json.loads(raw)))
        except Exception:
            GOT.append((self.path, raw))
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def log_message(self, *a):
        pass


def ok(cond, msg, got=None):
    if cond:
        print('  PASS  ' + msg)
    else:
        FAILS.append(msg)
        print('  FAIL  ' + msg + ('   got=%r' % (got,)))


print('== 起一个假的 qq-forwarder（本机 :%d）==' % PORT)
srv = ThreadingHTTPServer(('127.0.0.1', PORT), _H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
time.sleep(0.3)
print('   已监听')

print('')
print('== ① 发一条：body 必须是 qq-forwarder 认的那三个字段 ==')
br = QB.QqBridge({'enabled': True,
                  'url': 'http://127.0.0.1:%d/api/bridge/send' % PORT,
                  'token': 'TOKEN_X', 'group': '346049634',
                  'minIntervalMs': 120}, skip_names=['测试'])
ok(br.start() is True, '★ start() 起来了（on/url/group 都在 ✓）')
br.post('玩家甲 突破到第 12 层', 'up')
for _ in range(30):
    if GOT:
        break
    time.sleep(0.1)
print('   收到: %r' % (GOT[:1],))
ok(len(GOT) == 1, '★ 真的发出去了 1 条', len(GOT))
if GOT:
    path, body = GOT[0]
    ok(path == '/api/bridge/send', '★ 打的是 /api/bridge/send', path)
    ok(body.get('token') == 'TOKEN_X', '★ token 对（服务端会拿它校验 ✓）', body.get('token'))
    ok(str(body.get('group_id')) == '346049634', '★ 群号对（就是用户要的群 ✓）',
       body.get('group_id'))
    ok(body.get('message') == '玩家甲 突破到第 12 层', '★★ 正文原样（中文没坏 ✓）',
       body.get('message'))

print('')
print('== ② 测试账号的名字不往群里发 ==')
n0 = len(GOT)
br.post('测试账号 上线了（当前在线 3 人）', 'join')
time.sleep(0.5)
ok(len(GOT) == n0, '★★ 名字里带「测试」的被拦掉了（不然我跑测试会刷群 ✓）',
   GOT[n0:])

print('')
print('== ③ 节奏：两条之间至少隔 minIntervalMs ==')
n1 = len(GOT)
tb = time.time()
br.post('第一条', 'sys')
br.post('第二条', 'sys')
while len(GOT) < n1 + 2 and time.time() - tb < 3:
    time.sleep(0.05)
used = time.time() - tb
print('   两条用了 %.2f 秒（间隔设的是 120ms）' % used)
ok(len(GOT) == n1 + 2 and used >= 0.12,
   '★★ 按节奏发（没有一瞬间刷两条 ✓ 官方机器人会丢 ✓）', round(used, 2))

print('')
print('== ④ 游戏里的两个入口都接到了 ==')
w = W.World(None)
w._send_cid = lambda c, r: None
w._broadcast = lambda text: None
w.qq = br
n2 = len(GOT)
w._ticker('滚动通知一条', 'sys')
time.sleep(0.4)
ok(len(GOT) == n2 + 1 and GOT[-1][1].get('message') == '滚动通知一条',
   '★★ 滚动通知（_ticker）会自动转发 ✓', GOT[-1] if GOT else None)
# 上线
p1 = W.Player('c9', {'id': 9, 'name': '玩家乙', 'level': 3, 'hp': 100, 'x': 0, 'z': 0,
                     'yaw': 0, 'hpMax': 100, 'account_id': 9})
w.players['c9'] = p1
n3 = len(GOT)
w._qq_join(p1)
time.sleep(0.4)
_txt = GOT[-1][1].get('message') if len(GOT) > n3 else None
print('   上线那条: %r' % (_txt,))
ok(len(GOT) == n3 + 1 and _txt and ('上线了' in _txt) and ('玩家乙' in _txt)
   and ('在线' in _txt), '★★ 玩家上线会转发（带名字 + 在线人数 ✓）', _txt)
# ★ round419（用户："上线还要加炼气层数"）
ok(bool(_txt) and ('炼气 3 层' in _txt),
   '★★ 上线那条带上了炼气层数（角色 3 级 → 炼气 3 层 ✓）', _txt)

print('')
print('== ⑤ 别的类型（不在 kinds 里）不转发 ==')
n4 = len(GOT)
br.post('这条不该发', 'weird')
time.sleep(0.4)
ok(len(GOT) == n4, '★ kinds 白名单之外的不发 ✓', GOT[n4:])

print('')
print('== ⑥ 转发服务挂了也不会把游戏拖垮 ==')
br2 = QB.QqBridge({'enabled': True, 'url': 'http://127.0.0.1:1/api/bridge/send',
                   'token': 'T', 'group': '1', 'minIntervalMs': 50})
br2.start()
br2.post('断网测试', 'sys')
# ★ 多等一会儿 ✗ Windows 上 "连接被拒" 要几百毫秒才回来 ✓
for _ in range(40):
    if br2.fails:
        break
    time.sleep(0.1)
print('   fails=%d · lastErr=%r' % (br2.fails, br2.last_err))
ok(br2.fails >= 1, '★ 失败被记下来（不是静默 ✓）', br2.fails)
ok(br2.stats().get('on') is True, '★ 但桥本身还活着（下一条还会再试 ✓）', br2.stats())
br2.stop()

print('')
print('== ⑦ 关掉开关：一条都不发，但线程照样在（管理页才点得开）==')
br3 = QB.QqBridge({'enabled': False, 'url': 'http://127.0.0.1:%d/api/bridge/send' % PORT,
                   'token': 'T', 'group': '1', 'minIntervalMs': 100})
n5 = len(GOT)
# ★ round418：start() 现在只看"url/group/token 齐不齐" ✗ 不看 on ✓
#   （以前"没开就不起线程" ✗ 管理页后来点开也没用 ✓）
ok(br3.start() is True and br3.ready is True,
   '★★ url/群/token 齐 → 线程起来了（哪怕现在是关的 ✓）', br3.stats())
br3.post('不该发', 'sys')
time.sleep(0.4)
ok(len(GOT) == n5, '★★ enabled=false 时完全静默 ✓', GOT[n5:])

print('')
print('== ⑧ 管理页把它打开 → 立刻就开始发（不用重启）==')
br3.on = True
br3.post('打开了，这条应该发出去', 'sys')
for _ in range(30):
    if len(GOT) > n5:
        break
    time.sleep(0.1)
ok(len(GOT) == n5 + 1 and GOT[-1][1].get('message') == '打开了，这条应该发出去',
   '★★ 开关一开就能发（线程早就在等 ✓）', GOT[-1] if GOT else None)

print('')
print('== ⑨ 管理页的意图：world._handle_admin(qq) 真的改开关 ==')
w2 = W.World(None)
w2._send_cid = lambda c, r: None
w2._broadcast = lambda text: None
w2.qq = br3
w2._handle_admin('qq', {'on': 0})
print('   关了之后: world.qq_on=%r · bridge.on=%r' % (w2.qq_on, br3.on))
ok(w2.qq_on is False and br3.on is False,
   '★★ 管理页点"关闭"→ 桥立刻停发（world.qq_on + bridge.on 都改 ✓）',
   (w2.qq_on, br3.on))
n6 = len(GOT)
w2._ticker('关着的时候不该发', 'sys')
time.sleep(0.4)
ok(len(GOT) == n6, '★★ 关了之后滚动通知不再进群 ✓', GOT[n6:])
w2._handle_admin('qq', {'on': 1})
ok(w2.qq_on is True and br3.on is True, '★ 再点"开启"又打开 ✓', (w2.qq_on, br3.on))
n7 = len(GOT)
w2._ticker('开着了，这条要发', 'sys')
for _ in range(30):
    if len(GOT) > n7:
        break
    time.sleep(0.1)
ok(len(GOT) == n7 + 1, '★★ 打开之后滚动通知又发了 ✓', GOT[n7:])

print('')
print('== ⑩ 管理页的开关会存进 admin_tune（重启不丢）==')
_blob = []
w2.post_save = lambda sql, params=(): _blob.append((sql, params))
w2._admin_tune_save()
_js = None
for _s, _p in _blob:
    if 'admin_tune' in str(_p):
        try:
            _js = json.loads(_p[1])
        except Exception:
            pass
print('   admin_tune 里 qq_on = %r' % ((_js or {}).get('qq_on'),))
ok((_js or {}).get('qq_on') is True,
   '★★ 管理页的开关写进了 admin_tune（重启后由 _load_admin_tune 读回 ✓）',
   (_js or {}).get('qq_on'))

print('')
srv.shutdown()
if FAILS:
    print('FAILED: %d 条 ✗' % len(FAILS))
    for f in FAILS:
        print('  - ' + f)
    sys.exit(1)
print('ALL PASS ✓')
