# -*- coding: utf-8 -*-
"""验证：一只僵尸只给一次经验（第 217 轮的修复）

为什么用离线测试而不是开浏览器：
    · 快（1 秒 vs 30 秒）· 准（直接看经验数字，不看界面）
    · 用户报的现象本质是"服务器算多了"→ 那就直接测服务器 ✓
"""
import sys

sys.path.insert(0, 'server')

import world as W          # noqa: E402
import mobs                # noqa: E402

w = W.World(None)
sent = []
w._send_cid = lambda cid, raw: sent.append(raw)

# 造一个玩家（离线测试用的最小字段）
role = {'id': 9, 'name': 'T', 'level': 5, 'hp': 200, 'qi': 0,
        'x': 100, 'z': 0, 'yaw': 0, 'exp': 0}
p = W.Player('cT', role)
p.role = role
w.players['cT'] = p

# 造一只 5 级僵尸
m = mobs.Mob(1, 5, 100, 0)
m.owner = 9
w.mobs['1'] = m

print('  僵尸等级 %d · 它身上带的经验值 m.exp = %d' % (m.lv, m.exp))
print('  5 级升 6 级需要 %d' % mobs.level_up_need(5))
print()

before = int(role.get('exp') or 0)
print('  ① 正常结算一次 _mob_died')
w._mob_died(p, m)
e1 = int(role.get('exp') or 0)
print('     经验：%d → %d（+%d ✓）' % (before, e1, e1 - before))

print('  ② ★ 再调两次（模拟"流血还在跳""自动战斗砍尸体"）')
w._mob_died(p, m)
w._mob_died(p, m)
e2 = int(role.get('exp') or 0)
print('     经验：%d → %d（又加了 %d）' % (e1, e2, e2 - e1))

print()
if e2 == e1:
    print('  ★★ 通过 ✓✓ 后面两次没再给经验（修好了）')
else:
    print('  ✗ 还是重复给了（没修好）')
print()
print('  结算期间推给客户端的消息数：%d 条' % len(sent))
print('  （修复前这里会随着重复调用一直涨 ✗ 现在第二次以后就不该再推了 ✓）')
