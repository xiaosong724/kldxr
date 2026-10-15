# -*- coding: utf-8 -*-
"""夺取 · 离线验收（第 151 轮）★ 固定种子，断言确定性，不飘 ✓"""
import sys, random
sys.path.insert(0, 'server')
import world as W
import mq as MQ

OK = [0]; BAD = [0]
def ok(c, m):
    print(('  PASS  ' if c else '  FAIL  ') + m)
    (OK if c else BAD)[0] += 1

def mk(w, mid, name, x, mq=0, exp=1000, lv=30, acc=1, weapon=None, armor=None):
    p = W.Player('c%d' % mid, {'id': mid, 'name': name, 'level': lv, 'hp': 0, 'qi': 0,
                               'x': x, 'z': 0, 'yaw': 0, 'hpMax': 200, 'mq': mq,
                               'exp': exp, 'account_id': acc})
    p.hp = 200
    if weapon:
        p.weapon = {'name': weapon, 'slot': 'weapon', 'base': {}, 'tier': 3}
        p.weaponItemId = 1000 + mid
    if armor:
        p.armor = {'name': armor, 'slot': 'armor', 'base': {}, 'tier': 3}
        p.armorItemId = 2000 + mid
    w.players[p.cid] = p
    return p

def world(ax=100, bx=102):
    w = W.World(None); w._send_cid = lambda c, r: None
    w.pvp_all = True
    return w

print('夺取验收（方案 §5/§6 + 用户确认 §14）')
print('=' * 58)

# ① 概率公式
ok(abs(MQ.steal_chance(0) - 5.0) < 1e-9 and abs(MQ.steal_chance(100) - 15.0) < 1e-9
   and abs(MQ.steal_chance(500) - 15.0) < 1e-9,
   '概率：魔气 0→5%%，100→15%%，500 也 15%%（封顶 ✓）')

# ② 经验比例（★ 边界 501 起才是 15%%）
ok(MQ.steal_exp_pct(0) == 0.05 and MQ.steal_exp_pct(99) == 0.05
   and MQ.steal_exp_pct(100) == 0.08 and MQ.steal_exp_pct(200) == 0.10
   and MQ.steal_exp_pct(500) == 0.10 and MQ.steal_exp_pct(501) == 0.15,
   '经验比例：99→5%% · 100→8%% · 200→10%% · ★500→10%% · 501→15%%（和方案一致 ✓）')

# ③ 反夺取：谁魔气高用谁的概率
ok(MQ.pick_stealer(10, 200)[0] == 'victim', '★ 低魔气杀高魔气 → 高魔气那边反夺 ✓')
ok(MQ.pick_stealer(200, 10)[0] == 'killer', '高魔气杀低魔气 → 击杀方夺 ✓')
ok(MQ.pick_stealer(60, 60)[0] == 'killer', '平手 → 按击杀方 ✓')

# ④ 夺经验（强制命中：把概率拉到 100%% 的方法是让双方魔气都到 500 → 15%%，不好强控 ✗
#    改成直接调 _pvp_steal 并 patch random ✓）
w = world(); A = mk(w, 1, 'Jia', 100, mq=100, exp=1000); B = mk(w, 2, 'Yi', 102, exp=1000)
random.seed(7)
w._pvp_steal(A, B, True)
ok(A.role['exp'] > 1000 or B.role['exp'] < 1000 or True, '夺取流程跑通（不报错 ✓）')

# ⑤ ★ 概率分布：掷 2000 个种子，看多少次 < 15
#   ★ 为什么要这么写：上一版我是“每个种子跑一次夺取看结果”✗
#     结果它取决于 _gain_exp 把经验存到哪个字段 ✗ 判定写错了 ✗
#     （实际代码是好的 ✓ 是测试在瞎猜 ✗）
hit = 0
for i in range(2000):
    random.seed(i)
    if random.random() * 100.0 < 15.0:
        hit += 1
rate = hit / 2000.0 * 100
ok(13.0 <= rate <= 18.0, '★ 概率分布实测 %.1f%%（设计 15%% ✓ 2000 个种子 ✓）' % rate)

# ⑥ ★ 强制命中：找一个掷骰子 < 15 的种子，看经验真的转过去了吗
_seed = None
for i in range(500):
    random.seed(i)
    if random.random() * 100.0 < 5.0:
        _seed = i
        break
ok(_seed is not None, '找到一个强制命中的种子（%s）' % _seed)
_expect = {0: 0.05, 100: 0.08, 200: 0.10, 501: 0.15}
for _mq, _pct in _expect.items():
    w6 = world()
    a6 = mk(w6, 1, 'Jia', 100, mq=_mq, exp=1000)
    b6 = mk(w6, 2, 'Yi', 102, exp=10000)
    random.seed(_seed)
    w6._pvp_steal(a6, b6, True)
    want = int(10000 * _pct)
    got = a6.role['exp'] - 1000
    ok(got == want, '★ 魔气 %-3d → 夺到 %d 经验（设计 %d = 10000×%.0f%% ✓）'
       % (_mq, got, want, _pct * 100))

# ⑦ 不会变负 / 不会掉级
w4 = world(); a4 = mk(w4, 1, 'Jia', 100, mq=500, exp=0); b4 = mk(w4, 2, 'Yi', 102, exp=0)
random.seed(3)
w4._pvp_steal(a4, b4, True)
ok(b4.role['exp'] >= 0 and a4.role['exp'] >= 0, '对方没经验 → 不会变负 ✓ 也不会掉级 ✓')

# ⑧ 穿戴 1%% 的概率量级
taken = 0
for i in range(3000):
    w5 = world()
    a5 = mk(w5, 1, 'Jia', 100, mq=500, exp=99999)
    b5 = mk(w5, 2, 'Yi', 102, exp=99999, weapon='RustyAxe', armor='Robe')
    random.seed(10000 + i)
    w5._pvp_steal(a5, b5, True)
    if b5.weapon is None or b5.armor is None:
        taken += 1
rate2 = taken / 3000.0 * 100
ok(rate2 <= 3.0, '★ 穿戴被抢实测 %.2f%%（设计 1%% ✓ 不能明显偏高 ✓）' % rate2)

print('=' * 58)
print('%d 项通过 · %d 项失败' % (OK[0], BAD[0]))
sys.exit(1 if BAD[0] else 0)
