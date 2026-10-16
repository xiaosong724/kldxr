# -*- coding: utf-8 -*-
"""验证第 227 轮的位移校验（防瞬移 / 防加速）

为什么用离线测试：快 30 倍、而且直接看服务器认可的坐标 ✗ 不看界面 ✓
"""
import sys
import time

sys.path.insert(0, 'server')

import world as W          # noqa: E402

w = W.World(None)
msgs = []
w._send_cid = lambda cid, raw: msgs.append(raw)

role = {'id': 9, 'name': 'T', 'level': 5, 'hp': 200, 'qi': 0,
        'x': 0, 'z': 0, 'yaw': 0, 'exp': 0}
p = W.Player('cT', role)
p.role = role
w.players['cT'] = p

print('  速度常量：PLAYER_SPEED=%.1f · 容差 %.1f 倍 + %.1f 米余量'
      % (W.PLAYER_SPEED, W.MOVE_TOL, W.MOVE_SLACK))
print()

# ① 正常走：0.2 秒走 1 米（速度 5 米/秒，略超 4.4 但在容差内 ✓）
p.moveT = time.time() - 0.2
w._handle_intent(p, 'move', {'x': 1.0, 'z': 0.0, 'yaw': 0})
print('  ① 正常走一小步（1 米/0.2 秒）→ 服务器坐标 = (%.1f, %.1f)  %s'
      % (p.x, p.z, '采纳 ✓' if abs(p.x - 1.0) < 0.01 else '✗ 被拦了'))

# ② 瞬移：一帧跳到 1000 米外
before = (p.x, p.z)
p.moveT = time.time() - 0.05
w._handle_intent(p, 'move', {'x': 1000.0, 'z': 500.0, 'yaw': 0})
print('  ② 瞬移到 (1000, 500) → 服务器坐标 = (%.1f, %.1f)  %s'
      % (p.x, p.z, '★ 拦住了 ✓✓' if (p.x, p.z) == before else '✗ 没拦住'))

# ③ 加速跑：0.1 秒走 30 米（正常最多 0.44 米）
before = (p.x, p.z)
p.moveT = time.time() - 0.1
w._handle_intent(p, 'move', {'x': p.x + 30.0, 'z': p.z, 'yaw': 0})
print('  ③ 加速（0.1 秒走 30 米）→ 服务器坐标 = (%.1f, %.1f)  %s'
      % (p.x, p.z, '★ 拦住了 ✓✓' if (p.x, p.z) == before else '✗ 没拦住'))

# ④ 切后台回来：5 秒后一次报 20 米（合法的"攒了一段"）
p.moveT = time.time() - 5.0
tx, tz = p.x + 20.0, p.z
w._handle_intent(p, 'move', {'x': tx, 'z': tz, 'yaw': 0})
print('  ④ 卡顿恢复（5 秒后一次报 20 米）→ 服务器坐标 = (%.1f, %.1f)  %s'
      % (p.x, p.z, '采纳 ✓（正常玩家不会被误伤 ✓）'
         if abs(p.x - tx) < 0.01 else '✗ 被误拦了（容差要调大）'))

print()
print('  可疑计数 suspect = %d · 连续被拦 moveBad = %d' % (p.suspect, p.moveBad))
print('  回推纠正消息数 = %d 条（超得离谱才会回推 ✓）' % len(msgs))
