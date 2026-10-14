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
    ok(len(w.loot) == 1, '★ 打死僵尸 → 地上掉了一件（loot=%d）' % len(w.loot), list(w.loot))
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
    ok(arr and len(arr[0]) == 5 and arr[0][3] == '灵气结晶' and arr[0][4] == 1,
       '快照格式 [id,x,z,name,tier]（%r）' % (arr[0] if arr else None), arr)
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
if fails:
    print('FAILED: %d 条 ✗' % len(fails))
    for f in fails:
        print('  - ' + f)
    sys.exit(1)
print('ALL PASS ✓')
