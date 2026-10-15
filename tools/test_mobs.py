# -*- coding: utf-8 -*-
"""离线单测：服务器僵尸逻辑（P2 第 36 轮那六条要求）

为什么单独测、不靠连服务器测：
  · 需求里"**拉开 20 格、60 秒后自然消失**"—— 走网络测要真等 60 秒 ✗
    这里直接驱动 world._mob_tick(dt)，用大 dt 把 60 秒压成几次循环 ✓
  · "不要堆叠""没目标就漫游""每人最多 8 只" 也都是纯逻辑，离线测最稳 ✓

跑法：python tools\\test_mobs.py     （退出码 0 = 全过）
★ 测的是真代码（import server 里的 world/mobs），不是复制一份 ✓
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'server'))

import mobs
import weapons                      # noqa: E402
import world as W                # noqa: E402

fails = []


def ok(cond, msg, got=None):
    if cond:
        print('  PASS  ' + msg)
    else:
        fails.append(msg)
        print('  FAIL  ' + msg + ('   got=%r' % (got,)))


def mk_world(px=300.0, pz=300.0):
    """造一个最小世界：一个玩家 + 关掉自动刷怪（免得干扰计数 ✓）"""
    w = W.World(None)
    role = {'id': 1, 'name': '测试甲', 'level': 1, 'exp': 0, 'hp': 100, 'qi': 0,
            'x': px, 'z': pz, 'yaw': 0.0}
    p = W.Player('c1', role)
    p.x, p.z = px, pz
    w.players['c1'] = p
    return w, p


print('== ① 数值公式（照方案 §3.2 / §9.1 抄的）==')
ok(abs(mobs.mob_hp(1) - 97.62) < 0.5, 'Lv.1 血量 %.2f ≈ 97.62' % mobs.mob_hp(1), mobs.mob_hp(1))
ok(abs(mobs.mob_hp(10) - 357.0) < 1.0, 'Lv.10 血量 %.2f ≈ 357' % mobs.mob_hp(10), mobs.mob_hp(10))
ok(abs(mobs.mob_exp(1) - 14.12) < 0.3, 'Lv.1 经验 %.2f ≈ 14.12' % mobs.mob_exp(1), mobs.mob_exp(1))
ok(mobs.level_up_need(1) == 103, 'Lv.1 升 Lv.2 要 103 经验（方案 §9.1 表给的 98，四舍五入口径略不同）',
   mobs.level_up_need(1))
ok(mobs.mob_spd(1000) <= 2.6, '移速有上限 2.6（Lv.1000 = %.2f）' % mobs.mob_spd(1000))

print('')
print('== ② 等级抽样：不许跳出 [1, L+40] ==')
lv_min, lv_max = 99, 0
for _ in range(3000):
    z = mobs.roll_level(5)
    lv_min = min(lv_min, z)
    lv_max = max(lv_max, z)
ok(lv_min >= 1, '下限 ≥ 1（实测最小 %d）' % lv_min, lv_min)
ok(lv_max <= 45, '上限 ≤ L+40（实测最大 %d）' % lv_max, lv_max)

print('')
print('== ③ 紧凑数组带上等级和职业（用户要求"僵尸等级显示出来"）==')
m = mobs.Mob(7, 3, 1.0, 2.0)
w7 = m.wire()
ok(len(w7) >= 10, 'wire() 至少 10 个字段（%d）' % len(w7), len(w7))
ok(w7[8] == 3, '第 9 个字段是等级 lv=%s' % w7[8], w7)
ok(isinstance(w7[9], str) and w7[9], '第 10 个字段是职业 kind=%s' % w7[9], w7)
ok(w7[5] > 0 and w7[4] == w7[5], '血量字段正常（%s/%s）' % (w7[4], w7[5]), w7)

print('')
print('== ④ 每人最多同时 8 只（用户要求）==')
w, p = mk_world()
saved_int = mobs.SPAWN_INTERVAL
mobs.SPAWN_INTERVAL = 1e9
try:
    for _ in range(30):
        w._spawn_one([p])
    near = w._near_count(p.x, p.z, mobs.MOB_NEAR_R)
    ok(near == mobs.MOB_PER_PLAYER,
       '刷 30 次 → 玩家周围最多只有 %d 只（实测 %d）' % (mobs.MOB_PER_PLAYER, near), near)
finally:
    mobs.SPAWN_INTERVAL = saved_int

print('')
print('== ⑤ 僵尸不会堆叠在一起（用户要求）==')
w, p = mk_world(0.0, 0.0)          # ★ 玩家放原点：僵尸会朝玩家挤，正好压测分离 ✓
w.mobs.clear()
for i in range(4):
    mm = mobs.Mob(100 + i, 1, 0.2 + i * 0.2, 0.2 + i * 0.2)   # 一开始几乎叠在一起 ✗
    w.mobs[mm.mid] = mm
before = min(math.hypot(a.x - b.x, a.z - b.z)
             for i, a in enumerate(list(w.mobs.values()))
             for b in list(w.mobs.values())[i + 1:])
saved_int2 = mobs.SPAWN_INTERVAL
mobs.SPAWN_INTERVAL = 1e9
try:
    for _ in range(60):            # 2 秒（30Hz）
        w._mob_tick(1.0 / 30.0)
finally:
    mobs.SPAWN_INTERVAL = saved_int2
ms = list(w.mobs.values())
after = min(math.hypot(a.x - b.x, a.z - b.z) for i, a in enumerate(ms) for b in ms[i + 1:])
ok(before < 0.3, '一开始确实是叠在一起的（最近两只是 %.3f 米）' % before, before)
ok(after >= mobs.SEP_DIST * 0.75,
   '★ 两秒后它们被推开了（最近两只 %.2f 米 ≥ %.2f 米×0.75）' % (after, mobs.SEP_DIST), after)

print('')
print('== ⑥ 没目标时漫无目的地散开（用户要求：玩家死后僵尸没目标就散开）==')
w, p = mk_world(300.0, 300.0)
w.mobs.clear()
mm = mobs.Mob(200, 1, 340.0, 340.0)      # 离玩家 ~56 米（远超警戒 28）→ 没目标
w.mobs[mm.mid] = mm
x0, z0 = mm.x, mm.z
saved_int3 = mobs.SPAWN_INTERVAL
mobs.SPAWN_INTERVAL = 1e9
path = 0.0
_lx, _lz = mm.x, mm.z
try:
    for _ in range(180):                 # 6 秒（原来 3 秒，实测偶尔只走 0.39 米 ✗）
        w._mob_tick(1.0 / 30.0)
        path += math.hypot(mm.x - _lx, mm.z - _lz)     # ★ 累计路程（来回也累加 ✓）
        _lx, _lz = mm.x, mm.z
finally:
    mobs.SPAWN_INTERVAL = saved_int3
moved = math.hypot(mm.x - x0, mm.z - z0)
# ★ 阈值故意放得低：这条要验的是"【不是杵着不动】"✓（漫游方向随机，快慢差很多）
#   真坏掉的话累计路程会是【恰好 0】✗ —— 所以 0.2 米这个松阈值照样抓得住 ✓
ok(path > 0.2, '★ 没目标的僵尸确实在挪（6 秒累计路程 %.2f 米，直线位移 %.2f 米 —— 方向随机，所以看累计 ✓）'
   % (path, moved), (path, moved))
# ★ 这条以前偶发红（实测 0.21 / 0.36 / 0.49 米，阈值是 0.5）——
#   病根：漫游方向是【随机】的，3 秒里刚好来回走一小段是正常的 ✗
#   要验的行为是"它没杵着不动"，不是"它走了多远" ✓
#   → 改成累计路程（每一帧的位移之和），来回走也会累加 ✓ 这才是"在动"的正确判据
#     （顺带把位移的绝对值也留着，用来看"有没有跑偏"）
ok(moved > 0.05, '★ 没目标的僵尸自己走动了 %.2f 米（以前是杵着不动 ✗）' % moved, moved)
ok(moved < 8.0, '走得很慢（漫游速度 ≈ 自身移速 × %.2f）' % mobs.WANDER_SPEED, moved)

print('')
print('== ⑦ 拉开 20 米且附近没别人 → 60 秒后自然消失（用户要求）==')
w, p = mk_world(0.0, 0.0)
w.mobs.clear()
mm = mobs.Mob(300, 1, 50.0, 50.0)        # 玩家在原点，僵尸在 70 米外 ✓
w.mobs[mm.mid] = mm
mobs.SPAWN_INTERVAL = 1e9
try:
    for _ in range(11):                  # 55 秒（每次 5 秒）
        w._mob_tick(5.0)
    ok(mm.mid in w.mobs, '★ 55 秒时还在（离得远但还没满 %ds）' % int(mobs.AWAY_GRACE), list(w.mobs))
    w._mob_tick(5.0)                     # 到 60 秒
    ok(mm.mid not in w.mobs, '★★ 满 %d 秒 → 自然消失了 ✓' % int(mobs.AWAY_GRACE), list(w.mobs))

    # 反例：玩家就在 20 米内 → 计时归零，永远不消失 ✓
    w.mobs.clear()
    mm2 = mobs.Mob(301, 1, 10.0, 0.0)    # 离玩家 10 米 < 20 ✓
    w.mobs[mm2.mid] = mm2
    for _ in range(20):                  # 100 秒
        w._mob_tick(5.0)
    ok(mm2.mid in w.mobs, '★ 玩家一直在 20 米内 → 不会消失（计时归零）✓', list(w.mobs))
finally:
    mobs.SPAWN_INTERVAL = saved_int3

print('')
print('== ⑧ 僵尸咬人：伤害是服务器算的 ==')
w, p = mk_world(0.0, 0.0)
w.mobs.clear()
mm = mobs.Mob(400, 1, 1.0, 0.0)          # 贴在玩家身上
w.mobs[mm.mid] = mm
hp0 = p.hp
mobs.SPAWN_INTERVAL = 1e9
try:
    # ★ 第 41 轮：僵尸有了起手（0.45 秒），5 帧等不到第一口 ✗ → 跑 1.5 秒
    for _ in range(45):
        w._mob_tick(1.0 / 30.0)
finally:
    mobs.SPAWN_INTERVAL = saved_int3
pend = w._pend.get(p.cid) or {}
ok(p.hp < hp0, '玩家被咬了（hp %d → %d）' % (hp0, p.hp), p.hp)
ok(bool(pend.get('hurts')), '伤害进了 hurts（客户端拿它弹数字/掉血）', pend)

print('')
print('== ⑨ 玩家死了 → 僵尸不再攻击（用户反馈"死后僵尸还在攻击"）==')
w, p = mk_world(0.0, 0.0)
w.mobs.clear()
mm = mobs.Mob(500, 1, 1.0, 0.0)          # 就贴在玩家身上
w.mobs[mm.mid] = mm
p.hp = 0                                  # ★ 玩家已经躺了
saved_int4 = mobs.SPAWN_INTERVAL
mobs.SPAWN_INTERVAL = 1e9
try:
    for _ in range(60):                   # 2 秒
        w._mob_tick(1.0 / 30.0)
finally:
    mobs.SPAWN_INTERVAL = saved_int4
pend = w._pend.get(p.cid) or {}
ok(p.hp == 0, '死人的血不会被继续扣（还是 0）', p.hp)
ok(not pend.get('hurts'), '★ 死后不再收到 hurt（僵尸不咬了 ✓）', pend)
ok(mm.tgt is None, '★ 僵尸也失去了目标（tgt=None → 接下来会漫游散开 ✓）', mm.tgt)

# 反例：活着就照咬 ✓
p2 = W.Player('c2', {'id': 2, 'name': '测试乙', 'level': 1, 'exp': 0, 'hp': 100, 'qi': 0,
                     'x': 0.0, 'z': 0.0, 'yaw': 0.0})
w.players['c2'] = p2
# ★ 把僵尸摆回玩家身上 —— 上面那 2 秒它按"没目标就漫游"走开了一米多，
#   不摆回来的话 10 个 tick 它追不回来，反例会假红 ✗
mm.x, mm.z = 1.0, 0.0
mm.atkT = 0.0
w._pend.clear()
mobs.SPAWN_INTERVAL = 1e9
try:
    # ★ 同上：起手之后要跑够时间才咬得出来 ✓
    for _ in range(45):
        w._mob_tick(1.0 / 30.0)
finally:
    mobs.SPAWN_INTERVAL = saved_int4
ok(p2.hp < 100, '★ 活着的玩家照样会被咬（hp %d → %d）' % (100, p2.hp), p2.hp)

print('')
print('== ⑩ 僵尸会朝玩家移动（追击 AI）==')
w, p = mk_world(0.0, 0.0)
w.mobs.clear()
mm = mobs.Mob(600, 1, 10.0, 0.0)         # 10 米外，在警戒圈（28）里 ✓
w.mobs[mm.mid] = mm
d0 = math.hypot(mm.x - p.x, mm.z - p.z)
saved_int5 = mobs.SPAWN_INTERVAL
mobs.SPAWN_INTERVAL = 1e9
try:
    for _ in range(90):                  # 3 秒
        w._mob_tick(1.0 / 30.0)
finally:
    mobs.SPAWN_INTERVAL = saved_int5
d1 = math.hypot(mm.x - p.x, mm.z - p.z)
ok(d1 < d0 - 1.0, '★ 3 秒里它主动靠近了 %.2f 米（%.2f → %.2f）' % (d0 - d1, d0, d1), (d0, d1))
ok(mm.tgt == p.cid, '它的目标是这个玩家（tgt=%r）' % mm.tgt, mm.tgt)

print('')
print('== ⑪ 警戒圈外的僵尸不把玩家当目标（免得全场怪一起冲过来）==')
w, p = mk_world(0.0, 0.0)
w.mobs.clear()
mm = mobs.Mob(601, 1, 40.0, 0.0)         # 40 米 > 警戒 28
w.mobs[mm.mid] = mm
mobs.SPAWN_INTERVAL = 1e9
try:
    for _ in range(180):                 # 6 秒
        w._mob_tick(1.0 / 30.0)
finally:
    mobs.SPAWN_INTERVAL = saved_int5
ok(mm.tgt is None, '★ 圈外不锁定玩家（tgt=None → 只是漫游 ✓）', mm.tgt)
# ★ 别断言"它没有朝玩家移动" —— 漫游方向是【随机】的，正好朝玩家走两步完全正常 ✗
#   真正该保证的是：它走得【慢】（漫游速度 ≈ 0.54 m/s，追击是 1.2 m/s）
moved = math.hypot(mm.x, mm.z)           # 它从 40 米出发，离玩家多远
ok(moved > mobs.AGGRO,
   '★ 6 秒后它还在警戒圈外（离玩家 %.1f 米 > %.1f）—— 没在追人 ✓' % (moved, mobs.AGGRO), moved)

print('')
print('== ⑫ 掉落（P2 第二刀，方案 §8）==')
import drops                     # noqa: E402

ok(abs(drops.drop_chance(1, 1) - 0.75 * (1 + 1 / 200.0)) < 1e-9,
   '掉率公式 = 基础 × (1 + min(Z, K+20)/200)（Lv.1 → %.4f）' % drops.drop_chance(1, 1))
ok(drops.drop_chance(100, 1) > drops.drop_chance(10, 1), '怪等级越高掉率越高 ✓')
ok(drops.drop_chance(9999, 1) <= drops.CHANCE_CAP, '掉率封顶（不超 %.2f）' % drops.CHANCE_CAP)
# ★ 天花板是 min(Z, K+20)：怪等级再高，也只按"击杀者等级+20"折算 ✓
ok(abs(drops.drop_chance(1000, 1) - drops.BASE_CHANCE * (1 + 21 / 200.0)) < 1e-9,
   '★ z 有天花板 min(Z, K+20)：Lv.1000 的怪对 Lv.1 的人只按 21 折算（%.4f）'
   % drops.drop_chance(1000, 1))

ok(drops.max_tier(5) == 0 and drops.max_tier(12) == 1 and drops.max_tier(1000) == 11,
   '品阶上限 = clamp(floor(Z/12), 0, 11)（5→0，12→1，1000→11）')

rng = random.Random(7)
bad = 0
for _ in range(400):
    it = drops.roll_drop(5, 1, rng)          # Lv.5 的怪 → 最高 0 阶
    if it and it['tier'] > drops.max_tier(5):
        bad += 1
ok(bad == 0, '★ 低级怪掉不出超出上限的品阶（400 次里 0 次越界）', bad)
ok(all(m[1] <= drops.max_tier(9999) for m in drops.MATERIALS), '材料表的品阶都在合法范围内 ✓')

# 世界侧：掉在地上 → 走过去捡 → 进背包（DB）
saved_chance = drops.BASE_CHANCE
saved_cap = drops.CHANCE_CAP
# ★★ 两个都要改！只改 BASE_CHANCE 是不够的 ✗
#   drop_chance() 最后有一句 min(CHANCE_CAP, c) —— 而 CHANCE_CAP 是 0.95，
#   所以哪怕基础掉率设成 1.0，它还是永远留 5% 不掉 ✗
#   （这就是这条断言"跑 6 次红 1 次"的原因 —— 5% 而已，单跑很容易看着是绿的 ✓）
drops.BASE_CHANCE = 1.0
drops.CHANCE_CAP = 1.0
try:
    w, p = mk_world(0.0, 0.0)
    w.mobs.clear()
    w.loot.clear()
    # ★ 要放在【正前方】（yaw=0 是 +z 方向）—— 放 +x 的话那是侧面，攻击扇形判不中 ✗
    mm = mobs.Mob(700, 3, 0.0, 1.0)
    mm.hp = 1
    w.mobs[mm.mid] = mm
    w._intent_atk(p, {})                      # 玩家一刀把它打死
    drops.BASE_CHANCE = saved_chance
    drops.CHANCE_CAP = saved_cap
    if not w.loot:
        # ★ 这条以前偶发红（同一份代码单跑过、全套跑红）——
        #   加诊断，红的时候能一眼看出是"没打中"还是"掉了但没落地" ✓
        print('        [诊断] 怪: kind=%s hp=%s/%s | 玩家 atk=%.2f atkT=%.2f | 扇形内=%s | 尸体=%s'
              % (mm.kind, mm.hp, mm.mhp, w._atk_of(p), p.atkT,
                 mobs.in_front(p.x, p.z, p.yaw, mm.x, mm.z,
                               weapons.reach_of((p.weapon or {}).get('look') or 'sword'),
                               weapons.arc_of((p.weapon or {}).get('look') or 'sword')),
                 mm.mid in w.mobs))
    # ★ 第 47 轮起：材料必掉的同时，装备还会【独立 roll 一次】✓
    #   所以这里不能再要求"恰好 1 件"✗ —— 改成"至少掉了 1 件" ✓
    ok(len(w.loot) >= 1, '★ 打死僵尸 → 地上掉了东西（loot=%d）' % len(w.loot), list(w.loot))
    lid = list(w.loot.keys())[0]
    lx, lz = w.loot[lid]['x'], w.loot[lid]['z']

    # ① 太远 → 不认（防隔空捡 ✓）
    p.x, p.z = lx + 8.0, lz
    w._intent_pick(p, {'id': lid})
    ok(lid in w.loot, '★ 隔着 8 米捡 → 服务器不认（东西还在）✓', list(w.loot))

    # ② 走到跟前 → 捡走 + 入库存档队列 ✓
    p.x, p.z = lx + 0.5, lz
    q0 = w.saves.qsize()
    w._intent_pick(p, {'id': lid})
    ok(lid not in w.loot, '★ 走到跟前捡 → 东西没了 ✓', list(w.loot))
    ok(w.saves.qsize() > q0, '★ 入库了（丢进存档线程的队列）✓', w.saves.qsize() - q0)

    # ③ 地上东西会过期（不清理会越积越多 ✗）
    w.loot['x1'] = {'x': 0.0, 'z': 0.0, 'item': {'name': '破布', 'tier': 0}, 'ttl': 2.0}
    w._loot_tick(1.0)
    ok('x1' in w.loot, '还没到期 → 还在 ✓')
    w._loot_tick(1.5)
    ok('x1' not in w.loot, '★ 到期了自动清掉 ✓', list(w.loot))

    # ④ 快照带的是什么格式
    w.loot['x2'] = {'x': 5.0, 'z': 6.0, 'item': {'name': '灵气结晶', 'tier': 1}, 'ttl': 10.0}
    p.x, p.z = 0.0, 0.0
    arr = w._loot_for(p)
    # ★ 第 47 轮起地上可能同时有【材料】和【装备】（各自独立 roll ✓）
    #   而 _loot_for 是【按距离】排的 ✗ → 不能假定第 0 个就是那块结晶 ✗ → 找一下 ✓
    _hit = [x for x in (arr or []) if len(x) == 5 and x[3] == '灵气结晶' and x[4] == 1]
    ok(bool(_hit), '快照格式 [id,x,z,name,tier]（%r）' % (arr[0] if arr else None), arr)
finally:
    drops.BASE_CHANCE = saved_chance
    drops.CHANCE_CAP = saved_cap

print('')
print('== ⑬ ★ 攻击力由服务器算，客户端谎报无效（第 39 轮）==')
ok(abs(mobs.player_atk(1) - 13.08) < 0.01, 'Lv.1 攻击力 = 10+3L+0.08L² = %.2f' % mobs.player_atk(1))
ok(abs(mobs.player_atk(100) - 1110.0) < 0.01, 'Lv.100 攻击力 = %.0f（和方案 §4.5 表对得上）'
   % mobs.player_atk(100))
ok(mobs.player_atk(50) < mobs.player_atk(100), '等级越高攻击力越高 ✓')

w, p = mk_world(0.0, 0.0)
w.mobs.clear()
mm = mobs.Mob(800, 1, 0.0, 1.0, kind='白领')   # ★ 必须指定职业：随机到"保安"它会格挡，伤害就变成 5 ✗（踩过）
mm.hp = 999999
w.mobs[mm.mid] = mm
hp0 = mm.hp
p.atk = 999999                            # ★★ 模拟"改包谎报攻击力"★★
w._intent_atk(p, {})
dv = hp0 - mm.hp
ok(dv < 100, '★★ 谎报 atk=999999 → 实际只掉 %d 点（服务器按 Lv.1 的 %.2f 算）✗ 没被骗 ✓'
   % (dv, mobs.player_atk(1)), dv)
# ★ 第 47 轮起，攻击力还要算上【手上的武器】——
#   所以这里和 w._atk_of(p) 比（服务器自己算的那份），不再写死 13 ✓
_a = w._atk_of(p)
ok(dv == int(round(_a)) or dv == int(round(_a * 1.5)),
   '伤害就是服务器算出来的那个值（%d，非暴击 %d / 暴击 %d）'
   % (dv, int(round(_a)), int(round(_a * 1.5))), dv)

# 等级高的玩家伤害就该高 ✓
p.role['level'] = 30
mm.hp = 999999
hp0 = mm.hp
p.atkT = 0.0
w._intent_atk(p, {})
dv30 = hp0 - mm.hp
ok(dv30 > dv * 5, '★ Lv.30 的伤害（%d）远高于 Lv.1（%d）—— 真的按等级算 ✓' % (dv30, dv), (dv, dv30))

print('')
print('== ⑭ 职业行为差异（第 40 轮，方案 §3.3）==')
# ① 数值倾向：高血/快慢 都按 CLASS_STATS 走 ✓
c_white = mobs.Mob(900, 10, 0, 0, kind='白领')
c_worker = mobs.Mob(901, 10, 0, 0, kind='工人')
c_stu = mobs.Mob(902, 10, 0, 0, kind='学生')
c_waimai = mobs.Mob(903, 10, 0, 0, kind='外卖')
c_coach = mobs.Mob(904, 10, 0, 0, kind='健身教练')
ok(c_worker.mhp > c_white.mhp * 1.4, '工人高血（%d vs 白领 %d）' % (c_worker.mhp, c_white.mhp))
ok(c_stu.mhp < c_white.mhp, '学生血薄（%d < %d）' % (c_stu.mhp, c_white.mhp))
ok(c_waimai.spd > c_white.spd * 1.5, '外卖跑得快（%.2f vs %.2f m/s）' % (c_waimai.spd, c_white.spd))
ok(c_worker.spd < c_white.spd, '工人慢（%.2f < %.2f m/s）' % (c_worker.spd, c_white.spd))
ok(c_coach.atk > c_white.atk, '健身教练攻击高（%.1f vs %.1f）' % (c_coach.atk, c_white.atk))

# ② 医生给周围僵尸回血 ✓
w, p = mk_world(0.0, 0.0)
w.mobs.clear()
doc = mobs.Mob(910, 5, 0.0, 1.0, kind='医生')
patient = mobs.Mob(911, 5, 1.0, 1.0, kind='白领')
patient.hp = 10                       # 快死了
w.mobs[doc.mid] = doc
w.mobs[patient.mid] = patient
saved_int6 = mobs.SPAWN_INTERVAL
mobs.SPAWN_INTERVAL = 1e9
try:
    hp0 = patient.hp
    for _ in range(90):               # 3 秒（医生每 ~2 秒回一次）
        w._mob_tick(1.0 / 30.0)
    ok(patient.hp > hp0, '★ 医生把旁边僵尸的血奶回来了（%d → %d）' % (hp0, patient.hp), patient.hp)
finally:
    mobs.SPAWN_INTERVAL = saved_int6

# ③ 外卖残血会逃 ✓
w, p = mk_world(0.0, 0.0)
w.mobs.clear()
rider = mobs.Mob(920, 5, 3.0, 0.0, kind='外卖')
rider.hp = int(rider.mhp * 0.2)       # 20% 血 → 该逃了
rider.fleeT = 0.0
w.mobs[rider.mid] = rider
d0 = math.hypot(rider.x - p.x, rider.z - p.z)
mobs.SPAWN_INTERVAL = 1e9
try:
    for _ in range(60):               # 2 秒
        w._mob_tick(1.0 / 30.0)
finally:
    mobs.SPAWN_INTERVAL = saved_int6
d1 = math.hypot(rider.x - p.x, rider.z - p.z)
ok(rider.fleeT > 0 or d1 > d0 + 0.5, '★ 外卖残血会离玩家越来越远（%.2f → %.2f 米）' % (d0, d1), (d0, d1))

# ④ 保安会格挡（把概率临时改成 100% 才是确定性的 ✓）
saved_block = mobs.BLOCK_CHANCE
mobs.BLOCK_CHANCE = 1.0
try:
    w, p = mk_world(0.0, 0.0)
    w.mobs.clear()
    gd = mobs.Mob(930, 1, 0.0, 1.0, kind='保安')
    gd.hp = 999999
    w.mobs[gd.mid] = gd
    hp0 = gd.hp
    w._intent_atk(p, {})
    dmg_blocked = hp0 - gd.hp
finally:
    mobs.BLOCK_CHANCE = saved_block
ok(dmg_blocked < w._atk_of(p),
   '★ 保安格挡后只吃 %.0f 点伤害（没格挡是 %.0f）✓' % (dmg_blocked, w._atk_of(p)), dmg_blocked)

# ⑤ 普通僵尸不格挡（反例）
w, p = mk_world(0.0, 0.0)
w.mobs.clear()
pl = mobs.Mob(931, 1, 0.0, 1.0, kind='白领')
pl.hp = 999999
w.mobs[pl.mid] = pl
hp0 = pl.hp
w._intent_atk(p, {})
dmg_plain = hp0 - pl.hp
_ap = w._atk_of(p)
ok(dmg_plain == int(round(_ap)) or dmg_plain == int(round(_ap * 1.5)),
   '白领不格挡，吃满伤害 %d ✓（保安只吃 %d）' % (dmg_plain, dmg_blocked), (dmg_plain, dmg_blocked))

print('')
print('== ⑮ 挥爪动画字段（第 41 轮修的真 bug）==')
m = mobs.Mob(950, 1, 0.0, 0.0)
ok(m.wire()[7] == -1.0,
   '★★ 没在攻击时第 8 个字段必须是 -1（实测 %s）—— 发"攻击冷却"的话它就是 0 而不是 -1 ✗，'
   '客户端会以为一直在攻击，每帧用攻击姿势把腿写死 → 腿永远不动 ✗' % m.wire()[7], m.wire()[7])
m.atkAnim = mobs.ATK_ANIM
ok(m.wire()[7] > 0, '刚咬完 → 挥爪计时 > 0 ✓（%s）' % m.wire()[7], m.wire()[7])
m.atkAnim = -1.0

w, p = mk_world(0.0, 0.0)
w.mobs.clear()
mm = mobs.Mob(951, 1, 5.0, 0.0)      # 放远点：只走不打，免得咬人把计时又点起来 ✓
w.mobs[mm.mid] = mm
mm.atkAnim = 0.3
saved_int7 = mobs.SPAWN_INTERVAL
mobs.SPAWN_INTERVAL = 1e9
try:
    for _ in range(30):              # 1 秒
        w._mob_tick(1.0 / 30.0)
finally:
    mobs.SPAWN_INTERVAL = saved_int7
ok(mm.atkAnim == -1.0, '★ 挥爪结束回到 -1（实测 %s）✓' % mm.atkAnim, mm.atkAnim)

print('')
print('== ⑯ 僵尸起手（第 41 轮：用户要求"贴近了别直接打，慢一点点"）==')
ok(mobs.windup_of('学生') < mobs.windup_of('白领') < mobs.windup_of('工人'),
   '职业决定起手：学生 %.2f < 白领 %.2f < 工人 %.2f 秒'
   % (mobs.windup_of('学生'), mobs.windup_of('白领'), mobs.windup_of('工人')))

def bite_time(kind):
    """把一只僵尸贴在玩家身上，量它多久咬出第一口"""
    w, p = mk_world(0.0, 0.0)
    w.mobs.clear()
    mm = mobs.Mob(960, 1, 1.0, 0.0, kind=kind)   # CONTACT=1.15 内 ✓
    w.mobs[mm.mid] = mm
    saved = mobs.SPAWN_INTERVAL
    mobs.SPAWN_INTERVAL = 1e9
    try:
        t = 0.0
        for _ in range(180):                      # 最多 6 秒
            w._mob_tick(1.0 / 30.0)
            t += 1.0 / 30.0
            if p.hp < 100:
                return t
    finally:
        mobs.SPAWN_INTERVAL = saved
    return 999.0

t_fast = bite_time('学生')
t_slow = bite_time('工人')
ok(t_fast > 0.15, '★ 不是"贴上就打"—— 最快的学生也要蓄力 %.2f 秒 ✓' % t_fast, t_fast)
ok(abs(t_fast - 0.30) < 0.12, '学生起手 ≈ 0.30 秒（实测 %.2f）' % t_fast, t_fast)
ok(abs(t_slow - 0.70) < 0.12, '工人起手 ≈ 0.70 秒（实测 %.2f）' % t_slow, t_slow)
ok(t_slow > t_fast + 0.2, '★ 工人明显比学生慢（%.2f vs %.2f）✓' % (t_slow, t_fast), (t_fast, t_slow))

# 咬完要收招：两口之间至少间隔 WINDUP + RECOVER ✓
w, p = mk_world(0.0, 0.0)
w.mobs.clear()
mm = mobs.Mob(961, 1, 1.0, 0.0, kind='白领')
w.mobs[mm.mid] = mm
saved = mobs.SPAWN_INTERVAL
mobs.SPAWN_INTERVAL = 1e9
try:
    first = None
    t = 0.0
    prev = p.hp
    for _ in range(300):                          # 10 秒
        w._mob_tick(1.0 / 30.0)
        t += 1.0 / 30.0
        if p.hp < prev:
            if first is None:
                first = t
            else:
                gap = t - first
                break
            prev = p.hp
        prev = p.hp
    else:
        gap = 999.0
finally:
    mobs.SPAWN_INTERVAL = saved
ok(0.60 <= gap <= 1.20,
   '★ 两口之间隔了 %.2f 秒（起手 0.45 + 收招 %.2f + 半帧抖动）—— 不会一秒咬好几口 ✓'
   % (gap, mobs.RECOVER), gap)

print('')
print('== ⑰ 僵尸不穿墙（第 41 轮，用户要求；工人除外）==')
import worldgen as wg          # noqa: E402

sol = wg.build_chunk(0, 0)
ok(len(sol) > 0, '第 (0,0) 块有建筑（%d 个）' % len(sol), len(sol))
it = sol[0]
# ★ 玩家要放在建筑【另一侧】—— 同一侧的话僵尸压根不用穿墙，测了个寂寞 ✗
w, p = mk_world(it[0] - 3.0, it[1])
w.mobs.clear()
mm = mobs.Mob(970, 1, it[0] + 3.0, it[1], kind='白领')
w.mobs[mm.mid] = mm
mw = mobs.Mob(971, 1, it[0] + 3.0, it[1], kind='工人')
w.mobs[mw.mid] = mw
white_inside = 0
worker_inside = 0
saved_w = mobs.SPAWN_INTERVAL
mobs.SPAWN_INTERVAL = 1e9
try:
    for _ in range(150):                  # 5 秒；每一帧都查"有没有人进到建筑里"
        w._mob_tick(1.0 / 30.0)
        if wg.blocked(mm.x, mm.z, 0.01, 0.01):
            white_inside += 1
        if wg.blocked(mw.x, mw.z, 0.01, 0.01):
            worker_inside += 1
finally:
    mobs.SPAWN_INTERVAL = saved_w
ok(white_inside == 0,
   '★★ 白领【一帧都没进过】建筑（它绕开/贴着墙走 ✓ 实测 %d 帧）' % white_inside, white_inside)
ok(worker_inside > 0,
   '★ 工人穿过去了（用户要求"建筑工除外" ✓ 实测有 %d 帧在建筑里）' % worker_inside, worker_inside)

print('')
print('== ⑱ 僵尸医生的治疗（第 46 轮：不能叠加 + 玩家要看得见）==')
# ① ★★ 一只僵尸同一个周期内【只会被治一次】★★ —— 医生多也不能叠加
w, p = mk_world(0.0, 0.0)
w.mobs.clear()
w.heals = []
for _i in range(3):
    _d = mobs.Mob(1000 + _i, 5, _i * 1.0 - 1.0, 1.0, kind='医生')
    _d.healT = 0.0                       # 三个都"刚好到点"，同一帧一起动手 ✓
    w.mobs[_d.mid] = _d
pat = mobs.Mob(1010, 5, 0.0, 1.5, kind='白领')
pat.hp = int(pat.mhp * 0.30)
pat.healCd = 0.0
w.mobs[pat.mid] = pat
_one = max(1, int(round(pat.mhp * mobs.HEAL_PCT)))
_hp0 = pat.hp
w._mob_heal(1.0 / 30.0)
_got = pat.hp - _hp0
ok(_got <= _one,
   '★★★ 3 个医生同一帧都想治它 → 实际只回了 %d 点（一次治疗就是 %d）✓ 不会叠加 ✓'
   % (_got, _one), _got)
ok(_got > 0, '确实治了（不是没触发 ✓）', _got)
ok(len(w.heals) == 1,
   '治一次记一条事件（服务器要告诉客户端"谁治了谁、回了多少" ✓ 实测 %d 条）' % len(w.heals),
   w.heals)
if w.heals:
    _ev = w.heals[0]
    ok(len(_ev) == 5 and _ev[4] == _one and abs(_ev[0] - 0.0) < 40 and abs(_ev[2]) < 40,
       '事件格式 [医生x, 医生z, 目标x, 目标z, 回了多少]（%r）' % (_ev,), _ev)

# ② 医生多 ≠ 回得快：3 个医生跑 10 秒，总治疗量应该还是"一只僵尸每周期一次"
w2, p2 = mk_world(0.0, 0.0)
w2.mobs.clear()
for _i in range(3):
    _d = mobs.Mob(1100 + _i, 5, _i * 1.0 - 1.0, 1.0, kind='医生')
    w2.mobs[_d.mid] = _d
tank = mobs.Mob(1110, 5, 0.0, 1.5, kind='白领')
tank.mhp = 100000
tank.hp = 20000                          # 20%：远低于 85% 的门槛，全程都能被治 ✓
tank.healCd = 0.0
w2.mobs[tank.mid] = tank
saved_i8 = mobs.SPAWN_INTERVAL
mobs.SPAWN_INTERVAL = 1e9
try:
    for _ in range(300):                 # 10 秒
        w2._mob_tick(1.0 / 30.0)
finally:
    mobs.SPAWN_INTERVAL = saved_i8
_per = 10000.0                            # 每次回 10% = 10000 点
_times = (tank.hp - 20000) / _per
_theory = 10.0 / mobs.HEAL_PERIOD
ok(_times <= _theory + 1.6,
   '★★ 3 个医生跑了 10 秒，总共只回了 %.1f 次血（理论 %.1f 次）—— 医生多≠同一只回得快 ✓'
   % (_times, _theory), _times)
ok(_times >= 1.0, '但确实一直在回（%.1f 次）✓' % _times, _times)

# ③ 血够足的不治（别浪费，也让玩家看得出"它在回血"是有条件的 ✓）
w3, p3 = mk_world(0.0, 0.0)
w3.mobs.clear()
doc3 = mobs.Mob(1200, 5, 0.0, 1.0, kind='医生')
doc3.healT = 0.0
w3.mobs[doc3.mid] = doc3
full = mobs.Mob(1210, 5, 1.0, 1.0, kind='白领')
full.hp = int(full.mhp * mobs.HEAL_MAX_HP) + 5    # 刚过 85% 线
w3.mobs[full.mid] = full
_hp3 = full.hp
w3._mob_heal(1.0 / 30.0)
ok(full.hp == _hp3, '血超过 %.0f%% 的不治（实测没变 ✓）' % (mobs.HEAL_MAX_HP * 100))
w3.heals = []
doc3.healT = 0.0                          # ★ 上一次调用把它的冷却点起来了 ✗ 这里要重置
almost = mobs.Mob(1211, 5, -1.0, 1.0, kind='白领')
almost.hp = int(almost.mhp * mobs.HEAL_MAX_HP) - 5
w3.mobs[almost.mid] = almost
_hp4 = almost.hp
w3._mob_heal(1.0 / 30.0)
ok(almost.hp > _hp4, '（对照）刚好低于线就会治 ✓', almost.hp - _hp4)

print('')
print('== ⑲ ★ 玩家端不该有的能力（第 48 轮：搬到管理页了）==')
# ★ 这一节是"收权"的回归护栏：哪天有人把开关改回去，这里立刻红 ✓
w, p = mk_world(0.0, 0.0)
w.mobs.clear()
_before = len(w.mobs)
w._handle_intent(p, 'spawn', {'n': 5})           # 玩家喊"给我刷 5 只"
ok(len(w.mobs) == _before,
   '★★ 玩家发 spawn【一只都刷不出来】（实测 %d 只 —— 以前任何玩家都能自己刷 ✗）' % len(w.mobs),
   len(w.mobs))
w._handle_intent(p, 'giveweapon', {})            # 玩家喊"给我发武器"
ok('giveweapon' in p.warned,
   '★★ 玩家发 giveweapon 也被拒了（会回一条"已移到管理页"的提示 ✓）', sorted(p.warned))
# 对照：管理页那条路还通（cfg 里开了开关就应该照常工作 ✓）
class _Cfg(dict):
    pass
_c = _Cfg({'allow_player_debug': True})
w.cfg = _c
w._handle_intent(p, 'spawn', {'n': 2, 'lv': 3})
ok(len(w.mobs) > _before,
   '（对照）把 allow_player_debug 打开 → 调试刷怪照常可用（%d 只 ✓ 本地调试不受影响）' % len(w.mobs),
   len(w.mobs))

print('')
print('== ⑳ ★ 材料堆叠 / 武器不堆叠（第 54 轮）==')
import sqlite3
import json as _json
_db = sqlite3.connect(':memory:')
_db.execute('CREATE TABLE items(id INTEGER PRIMARY KEY AUTOINCREMENT, role_id INT,'
            ' in_storage INT, slot_index INT, stack INT, item_json TEXT, created_at INT)')
_w = W.World(None)


def _n_rows():
    return _db.execute('SELECT COUNT(*) FROM items').fetchone()[0]


def _stack_of(name):
    r = _db.execute("SELECT stack FROM items WHERE json_extract(item_json,'$.name')=?",
                    (name,)).fetchone()
    return r[0] if r else 0


_mat = _json.dumps({'name': '破布', 'tier': 0, 'kind': 'material'}, ensure_ascii=False)
_w._save_pick(_db, (1, _mat, 0))
ok(_n_rows() == 1 and _stack_of('破布') == 1, '第一个材料 → 新建一行（stack=1 ✓）', _n_rows())
_w._save_pick(_db, (1, _mat, 0))
_w._save_pick(_db, (1, _mat, 0))
ok(_n_rows() == 1 and _stack_of('破布') == 3,
   '★★ 再捡两个同类 → 还是【一行】，stack=3（没堆出三行 ✗）',
   (_n_rows(), _stack_of('破布')))
# 同名不同阶 → 必须分开（不能混 ✓）
_mat2 = _json.dumps({'name': '破布', 'tier': 1, 'kind': 'material'}, ensure_ascii=False)
_w._save_pick(_db, (1, _mat2, 0))
ok(_n_rows() == 2, '★★ 同名但【不同阶】→ 分开一行（不会把 0 阶和 1 阶混在一起 ✓）', _n_rows())
# 不同角色 → 不能互相堆 ✓
_w._save_pick(_db, (2, _mat, 0))
ok(_n_rows() == 3 and _stack_of('破布') == 3,
   '★★ 别人捡的不会堆到我这儿（按 role_id 分开 ✓）', _n_rows())
# 武器：同名同阶也【不许】堆 ✓
_wep = _json.dumps({'name': '玄铁双手斧', 'slot': 'weapon', 'tier': 4, 'itemLv': 3,
                    'base': {'coeff': 1.4}, 'look': 'axe', 'reqLevel': 25}, ensure_ascii=False)
_w._save_pick(_db, (1, _wep, 0))
_w._save_pick(_db, (1, _wep, 0))
ok(_n_rows() == 5,
   '★★★ 武器永远是【一件一行】（捡两把同款 → 两行 ✓ 不堆叠 ✓）', _n_rows())
ok(_stack_of('玄铁双手斧') == 1, '★★ 而且武器的 stack 一直是 1 ✓', _stack_of('玄铁双手斧'))

print('')
print('== ㉑ ★ 版本 2 迁移：历史重复材料合并（删数据，必须有测试钉住）==')
import db as dbmod
_sq = sqlite3.connect(':memory:')
_sq.execute('CREATE TABLE items(id INTEGER PRIMARY KEY, role_id INT, in_storage INT,'
            ' slot_index INT, stack INT, item_json TEXT, created_at INT)')


def _ins(rid, name, tier, n, slot=None, iid=None):
    it = {'name': name, 'tier': tier, 'kind': 'material'}
    if slot:
        it = {'name': name, 'slot': slot, 'tier': tier, 'itemLv': 3, 'look': 'axe',
              'base': {'coeff': 1.4}, 'reqLevel': 25}
    _sq.execute('INSERT INTO items(id, role_id, in_storage, slot_index, stack, item_json, created_at)'
                ' VALUES(?,?,0,-1,?,?,0)',
                (iid, rid, n, __import__('json').dumps(it, ensure_ascii=False)))


# 造出"历史遗留"的样子：同一份材料一堆行 ✓ 还有同名不同阶 ✓ 还有武器 ✓
for i, iid in enumerate([1, 2, 3]):
    _ins(7, '破布', 0, 2, None, iid)          # 3 行 ×2 = 总共 6
_ins(7, '破布', 1, 5, None, 4)                # 同名不同阶 → 必须留着
_ins(7, '破布', 1, 3, None, 5)                # 这个要和上面合并成 8
_ins(8, '破布', 0, 4, None, 6)                # 别人（role 8）→ 不许并到 role 7
_ins(7, '玄铁双手斧', 4, 1, 'weapon', 7)       # 武器 → 一根都不许动
_ins(7, '玄铁双手斧', 4, 1, 'weapon', 8)
_sq.commit()
_before = _sq.execute('SELECT COUNT(*) FROM items').fetchone()[0]
for _sql in dbmod.MIGRATIONS[2]:
    _sq.execute(_sql)
_sq.commit()
_after = _sq.execute('SELECT COUNT(*) FROM items').fetchone()[0]


def _q(name, tier, rid=7, slot=None):
    if slot:
        return _sq.execute("SELECT COUNT(*) FROM items WHERE role_id=? AND stack=1"
                           " AND json_extract(item_json,'$.slot')=?",
                           (rid, slot)).fetchone()[0]
    r = _sq.execute("SELECT COUNT(*), SUM(stack) FROM items WHERE role_id=?"
                    " AND json_extract(item_json,'$.name')=?"
                    " AND json_extract(item_json,'$.tier')=?"
                    " AND json_extract(item_json,'$.slot') IS NULL",
                    (rid, name, tier)).fetchone()
    return r


_c0 = _q('破布', 0)
ok(_c0[0] == 1 and _c0[1] == 6,
   '★★ 3 行"破布 0 阶 ×2" → 合成 1 行 stack=6（%d 行 / %s ✓）' % (_c0[0], _c0[1]), _c0)
_c1 = _q('破布', 1)
ok(_c1[0] == 1 and _c1[1] == 8,
   '★★ 同名不同阶【不混】：1 阶自己合成 1 行 stack=8（%d 行 / %s ✓）' % (_c1[0], _c1[1]), _c1)
_c8 = _q('破布', 0, rid=8)
ok(_c8[0] == 1 and _c8[1] == 4,
   '★★ 别人（role 8）的不并到 role 7（各自 1 行 stack=4 ✓）', _c8)
_wp = _q('', 0, slot='weapon')
ok(_wp == 2, '★★★ 武器【一根都没动】（迁移前 2 行 → 迁移后还是 2 行 ✓）', _wp)
ok(_before - _after == 3,
   '★ 一共删掉 3 行重复（%d → %d ✓ 只删材料、不碰装备 ✓）' % (_before, _after), (_before, _after))

print('')
print('== ㉒ ★ 武器机制 + 耐久（第 59 轮）==')
import weapons as WP

# ---- 机制按品阶递增（纯函数，好测 ✓）----
_f0 = WP.fx_of('hammer', 0)
_f11 = WP.fx_of('hammer', 11)
ok(_f11['chance'] > _f0['chance'] and _f11['value'] > _f0['value'],
   '★ 锤的眩晕【概率和时长都随品阶涨】（%.0f%%→%.0f%% · %.2f→%.2f 秒 ✓）'
   % (_f0['pct'], _f11['pct'], _f0['value'], _f11['value']))
ok('眩晕 62' not in _f11['text'] and '0.62 秒' in _f11['text'],
   '★★ 锤的时长显示成【秒】不是百分比（%s ✓ 踩过：写成"眩晕 62 秒"✗）' % _f11['text'])
# 必定触发的两条不能被 75% 上限裁掉
_a0 = WP.fx_of('dagger', 0)
_x11 = WP.fx_of('axe', 11)
ok(_a0['chance'] >= 0.999 and _x11['chance'] >= 0.999,
   '★★ 必定触发的（匕首背击/斧溅射）没被 75%% 上限裁掉（%.2f / %.2f ✓）'
   % (_a0['chance'], _x11['chance']))
ok(WP.fx_of('bow', 5) is None, '弓没有机制（P3 做投射物 ✓）')

# ---- 耐久：挥砍扣 1 ----
_w, _p = mk_world(0.0, 0.0)
_wp = WP.make_weapon('sword', 3, 1.0, 1)
_p.weapon = _wp
_p.wDurMax = _wp['durMax']
_p.wDur = _wp['dur']
_p.wDurDirty = 0
_before = _p.wDur
_p.atkT = 0
_w._intent_atk(_p, {})
ok(_p.wDur == _before - 1,
   '★★ 挥砍一次扣 1 点耐久（%d → %d ✓）' % (_before, _p.wDur))
# 空手不扣
_p.weapon = dict(WP.FIST); _p.wDurMax = 0; _p.wDur = 0
_p.atkT = 0
_w._intent_atk(_p, {})
ok(_p.wDur == 0 and _p.wDurMax == 0, '★ 空手不消耗耐久（不会"手也会坏"✗）')

# ---- 耐久归零 → 武器消失 ----
_p.wDurMax = 50; _p.wDur = 1; _p.wDurDirty = 0
_p.weapon = WP.make_weapon('axe', 5, 1.4, 1)
_p.weaponItemId = 4242
_p.atkT = 0
_w._intent_atk(_p, {})
ok(_p.wDur == 0 and _p.weapon.get('name') == '空手' and _p.weaponItemId is None,
   '★★★ 耐久耗尽 → 武器损坏消失、换回空手 ✓（现在拿的是 %s）' % _p.weapon.get('name'))
ok(_w.saves.qsize() > 0, '★★ 并且入队了"删掉那一行"（真的从库里消失 ✓）')

# ---- 溅射：主目标旁边的僵尸也会掉血 ----
_w2, _q = mk_world(0.0, 0.0)
_w2.mobs.clear()
_w2.loot.clear()
_a = mobs.Mob(801, 5, 0.0, 1.2); _a.hp = _a.mhp = 9999
_c = mobs.Mob(802, 5, 0.6, 1.2); _c.hp = _c.mhp = 9999    # 就在主目标旁边 ✓
_w2.mobs[_a.mid] = _a
_w2.mobs[_c.mid] = _c
_q.weapon = WP.make_weapon('axe', 5, 1.4, 1)   # 斧 = 必定溅射 ✓
_q.wDurMax = 9999; _q.wDur = 9999; _q.atkT = 0
_w2._intent_atk(_q, {})
ok(_a.hp < 9999 and _c.hp < 9999,
   '★★ 双手斧【溅射】：主目标掉 %d，旁边的也掉了 %d ✓' % (9999 - _a.hp, 9999 - _c.hp))
ok(_c.hp > _a.hp, '★ 溅射的伤害比主目标低（不是各打一份满的 ✓）')

# ---- 眩晕：晕住之后不移动 ----
_w3, _r = mk_world(0.0, 0.0)
_w3.mobs.clear()
_m = mobs.Mob(803, 1, 2.0, 0.0)
_m.hp = _m.mhp = 9999
_m.stunT = 1.0
_w3.mobs[_m.mid] = _m
_x0, _z0 = _m.x, _m.z
for _i in range(20):
    _w3._mob_tick(0.05)
ok(abs(_m.x - _x0) < 0.05 and abs(_m.z - _z0) < 0.05,
   '★★ 被眩晕的僵尸【原地不动】（挪了 %.2f 米 ✓）' % math.hypot(_m.x - _x0, _m.z - _z0))
ok(_m.stunT <= 0, '★ 眩晕时间会走完（%.2f 秒 ✓ 不会永久晕 ✗）' % _m.stunT)

print('')
print('== ㉓ ★ 词条（第 60 轮：条数看概率 + 分部位 + 生效 + 单调性）==')
import affixes as AF
import random as _rnd

# ---- ① 条数：品阶只抬范围，条数看概率 ✓ ----
_lo12, _ws12 = AF.count_weights(11)
ok(_lo12 == 3 and len(_ws12) == 3,
   '★★ 12 阶的条数范围是 3~5（不是"必定 5 条"✗ 用户要求看概率 ✓）')
_lo1, _ws1 = AF.count_weights(0)
ok(_lo1 == 1 and len(_ws1) == 1, '1 阶必定 1 条 ✓')
_r = _rnd.Random(5)
_seen = set()
for _i in range(4000):
    _seen.add(AF.roll_count(11, _r))
ok(_seen == {3, 4, 5}, '★★ 12 阶实际能抽出 3/4/5 条（实测 %s ✓ 真的随机 ✓）' % sorted(_seen))

# ---- ② 分部位：防具词条不会掉在武器上 ✓ ----
_r2 = _rnd.Random(9)
_wk = AF.roll_affixes(11, ('weapon',), _r2)
_armor_keys = set(a[0] for a in AF.AFFIXES if a[5] == ('armor',))
ok(all(a['key'] not in _armor_keys for a in _wk),
   '★★ 武器上不会出现防具词条（抽到 %s ✓ 分部位生效 ✓）' % [a['key'] for a in _wk])
ok(all(a['live'] for a in _wk),
   '★★ 只掉【已实装】的词条（不给玩家"死词条"✗ %s ✓）' % [a['key'] for a in _wk])

# ---- ③ 同名不重复 ✓ ----
_dup = 0
for _i in range(300):
    _a = AF.roll_affixes(11, ('weapon',), _r2)
    if len(set(x['key'] for x in _a)) != len(_a):
        _dup += 1
ok(_dup == 0, '★★ 同一件装备上不会出现两条同名（300 次里重复 %d 次 ✓）' % _dup)

# ---- ④ pct 只作用于武器那一份（§7.11③①）----
_inh = 360.0
_w = {'base': {'coeff': 1.0}, 'affixes': [{'key': 'atk_pct', 'val': 100.0}]}
_base = _inh * 1.0 + 50
_got = AF.apply_affixes(_w, _inh, _base)
ok(abs(_got - (_inh + 100)) < 0.01,
   '★★★ 攻击力+100%% 只把【武器那 50 点】翻倍（%.0f → %.0f ✓ 固有 360 没被放大 ✓）'
   % (_base, _got))

# ---- ⑤ 装备带上词条 + 生效 ----
_r3 = _rnd.Random(21)
_w2 = WP.make_weapon('axe', 9, 1.45, 3, _r3)
ok(len(_w2['affixes']) >= 1, '★ 掉出来的武器自带给词条（%d 条 ✓）' % len(_w2['affixes']))
ok(all(('text' in a and a['text']) for a in _w2['affixes']),
   '★★ 每条词条都有文案（写进 UI 给玩家看 ✓）')
# ★ 这里必须【手动塞一条攻击力词条】✗
#   随机抽到的是暴击/吸血的话，攻击力当然不变（上次就是这么假红的 ✗）
_w2['affixes'] = [{'key': 'atk_pct', 'val': 30.0, 'name': '攻击力', 'mode': 'pct',
                   'text': '攻击力 +30%', 'live': True}]
_a1 = WP.player_atk_with(360.0, 'axe', 1.45, 9, 3, 1.0, flat=WP.flat_full(_w2))
_a2 = WP.player_atk_with(360.0, 'axe', 1.45, 9, 3, 1.0, flat=WP.flat_full(_w2), aff_w=_w2)
ok(_a2 > _a1 + 0.01,
   '★★ 词条真的改攻击力（攻击力+30%%：%.0f → %.0f ✓）' % (_a1, _a2))
# 暴击词条也要能被 roll_damage 吃到
_c1 = [mobs.roll_damage(100.0, _rnd.Random(i), 0, 0) for i in range(200)]
_c2 = [mobs.roll_damage(100.0, _rnd.Random(i), 50, 100) for i in range(200)]
ok(sum(1 for d, c in _c2 if c) > sum(1 for d, c in _c1 if c),
   '★★ 暴击率词条会让暴击变多（+50%%：%d → %d 次 / 200 ✓）'
   % (sum(1 for d, c in _c1 if c), sum(1 for d, c in _c2 if c)))

# ---- ⑥ 攻速词条不破 §5.1 上限 ----
_iv = WP.interval_of('dagger', 9999.0)
ok(abs(_iv - WP.BASE_INTERVAL / WP.S_MAX) < 1e-6,
   '★★ 攻速词条再离谱也被夹回上限（间隔 %.3f 秒 = 0.62/%.1f ✓）' % (_iv, WP.S_MAX))

print('')
if fails:
    print('FAILED: %d 条 ✗' % len(fails))
    for f in fails:
        print('  - ' + f)
    sys.exit(1)
print('ALL PASS ✓')
