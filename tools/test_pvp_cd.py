import sys, time, random
sys.path.insert(0, 'server')
import world as W
import mq as MQ

def mk(w, mid, name, x, mq, exp=100000):
    p = W.Player('c%d' % mid, {'id': mid, 'name': name, 'level': 30, 'hp': 0, 'qi': 0,
                               'x': x, 'z': 0, 'yaw': 0, 'hpMax': 200, 'mq': mq,
                               'exp': exp, 'account_id': mid})
    p.hp = 200
    w.players[p.cid] = p
    return p

print('  配置：魔气 CD = %.0f 秒 · 夺取 CD = %.0f 秒' % (
    MQ.cfg('pair_cooldown'), MQ.cfg('steal_cooldown')))

# 第 1 次击杀：魔气 +2 ✓ 夺取判定 ✓
w = W.World(None); w._send_cid = lambda c, r: None; w.pvp_all = True
A = mk(w, 1, 'A', 100, 0); B = mk(w, 2, 'B', 102, 0)
random.seed(31)
w._pvp_killed(A, B)
print('  第 1 次击杀：A 魔气=%d（+2 ✓）  B 经验=%d（夺取 %s）' % (A.mq, B.role['exp'], 100000 - B.role['exp']))

# 第 2 次击杀（立刻）：魔气不该涨 ✓ 夺取【应该还能做】✓
exp_before = B.role['exp']
A.hp = 200
random.seed(31)   # 同一个种子 → 夺取判定会"中"✓ 用来证明它没被魔气锁挡住 ✓
w._pvp_killed(A, B)
print('  立刻再杀一次：A 魔气=%d（应该还是 2 ✓ 被 10 分钟锁挡住）' % A.mq)
print('                 B 经验变化 = %d  %s' % (exp_before - B.role['exp'],
      '★ 夺取仍然发生了 ✓（1 分钟锁还没到）' if B.role['exp'] < exp_before else '没夺取 ✗'))

# 把两把锁的时间都往回拨 → 模拟"过了 1 分钟但没到 10 分钟"
now = time.time()
w.pvp_pair_steal[(1, 2)] = now - 61      # 夺取锁：已过 61 秒 ✓
w.pvp_pair[(1, 2)] = now - 61            # 魔气锁：也过 61 秒（不到 600 ✓）
exp_before2 = B.role['exp']
random.seed(31)
w._pvp_killed(A, B)
print('  过了 61 秒再杀：A 魔气=%d（还是 2 ✓ 没到 10 分钟）' % A.mq)
print('                   B 经验变化 = %d  %s' % (exp_before2 - B.role['exp'],
      '★ 又能夺取了 ✓' if B.role['exp'] < exp_before2 else '没夺取 ✗'))

# 拨到 11 分钟 → 魔气也该涨了 ✓
w.pvp_pair[(1, 2)] = now - 601
w.pvp_pair_steal[(1, 2)] = now - 61
w._pvp_killed(A, B)
print('  过了 601 秒再杀：A 魔气=%d  %s' % (A.mq, '★ 魔气也涨了 ✓' if A.mq > 2 else '魔气没涨 ✗'))
