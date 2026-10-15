# -*- coding: utf-8 -*-
"""第 174 轮验收：安全区三条硬规矩（僵尸不进 / 丢目标 / 区内禁攻）

★ Mob 的真实签名是 Mob(mid, lv, x, z, kind=None) —— 我第一版写错了顺序。
"""
import sys

sys.path.insert(0, 'server')
import world as W
import mq as MQ
import mobs as M

SAFE = MQ.SAFE_HALF
print('  安全区半边长 = %.0f（%.0f x %.0f）' % (SAFE, SAFE * 2, SAFE * 2))


def mkworld(px, pz, mx, mz):
    w = W.World(None)
    w._send_cid = lambda c, r: None
    p = W.Player('c1', {'id': 1, 'name': 'A', 'level': 30, 'hp': 100, 'qi': 0,
                        'x': px, 'z': pz, 'yaw': 0, 'hpMax': 200})
    p.hp = 100
    w.players['c1'] = p
    m = M.Mob(1, 30, mx, mz)          # mid, lv, x, z
    m.hp = 100
    w.mobs[1] = m
    return w, p, m


# ① 玩家在区外 → 僵尸应该追过来
w, p, m = mkworld(40, 0, 45, 0)
x0 = m.x
for _ in range(20):
    w._mob_tick(0.05)
print('  ① 玩家在区外(40,0) · 僵尸(45,0) 跑 1 秒：')
print('     僵尸 x: %.2f → %.2f（往玩家那边动了 %s）' % (x0, m.x, '✓' if m.x < x0 else '✗'))

# ② 玩家在安全区内 → 僵尸应该丢目标 + 进不来
w2, p2, m2 = mkworld(3, 0, 18, 0)
tgt0 = m2.tgt
for _ in range(120):
    w2._mob_tick(0.05)
inside = (abs(m2.x) <= SAFE) and (abs(m2.z) <= SAFE)
print('  ② 玩家在安全区内(3,0) · 僵尸从(18,0) 跑 6 秒：')
print('     僵尸现在 (%.2f, %.2f) → 进安全区了吗：%s' % (m2.x, m2.z, '进了 ✗' if inside else '没进 ✓'))
print('     僵尸目标：%s → %s' % (tgt0, m2.tgt))
print('     僵尸有目标吗：%s' % ('有 ✗' if m2.tgt else '没有 ✓（丢失目标）'))

# ③ 玩家在安全区内攻击 → 被拦
w3, p3, m3 = mkworld(3, 0, 4, 0)
sent = []
w3._send_cid = lambda c, r: sent.append(r)
p3.yaw = 1.5708
w3._intent_atk(p3, {})
print('  ③ 玩家在安全区内挥刀：')
print('     收到提示：%s' % ([s[:56] for s in sent if 'notice' in s][:1] or '无 ✗'))
print('     有没有砍出去（atkSeq）：%d → %s' % (p3.atkSeq, '没砍 ✓' if p3.atkSeq == 0 else '砍了 ✗'))

# ④ 玩家在区外攻击 → 正常
w4, p4, m4 = mkworld(40, 0, 41, 0)
sent4 = []
w4._send_cid = lambda c, r: sent4.append(r)
p4.yaw = 1.5708
w4._intent_atk(p4, {})
print('  ④ 玩家在区外挥刀：atkSeq=%d → %s' % (p4.atkSeq, '正常砍出去了 ✓' if p4.atkSeq > 0 else '被拦了 ✗'))
