# -*- coding: utf-8 -*-
"""round407 回归：武器机制对【玩家】也要生效（交接文档第四节 ①②③）

为什么要有这个脚本：
  ①②③ 的共同病是"服务端算了、但没算到玩家头上"，而 tick 外面包着 try/except
  → 出错也是静默失效 ✗ 只跑语法检查根本看不出来 ✓
  所以这里直接把 World 造出来，走真实函数、打印真实血量/真实下行报文。

跑法：python tools\\test_weapon_pvp.py
"""
import os
import sys

# ★ Windows 控制台默认 GBK ✗ 这个脚本要打 ✓ / ✗ / 中文数字 → 强制 UTF-8 ✓
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(_HERE), 'server'))

import world as W          # noqa: E402
import mobs as M           # noqa: E402
import weapons as WP       # noqa: E402

FAILS = []
SENT = []


def ok(cond, msg, got=None):
    if cond:
        print('  PASS  ' + msg)
    else:
        FAILS.append(msg)
        print('  FAIL  ' + msg + ('   got=%r' % (got,)))


def mkworld():
    """干净世界 + 抓下行报文（不连数据库：World(None) 就是这条老路 ✓）"""
    SENT.clear()
    w = W.World(None)
    w._send_cid = lambda c, r: SENT.append((c, r))
    w.pvp_all = True            # ★ 双方都在"能打"的白名单里（_pvp_ok 的门槛）
    return w


def mkp(w, rid, name, x, z, lv=30, hp=500):
    p = W.Player('c%d' % rid, {'id': rid, 'name': name, 'level': lv, 'hp': hp,
                               'qi': 0, 'x': x, 'z': z, 'yaw': 0,
                               'hpMax': hp, 'account_id': rid})
    p.hp = hp
    w.players[p.cid] = p
    return p


def pends(w, cid, key):
    return (w._pend.get(cid) or {}).get(key) or []


# 所有坐标都放到 (200, 200) 附近：安全区是 ±15 米，站在里面 _pvp_ok 会拒 ✓
FAR = 200.0

print('== ① 斧：溅射要打到玩家（交接文档第四节 ①）==')
w = mkworld()
A = mkp(w, 1, 'A', FAR, FAR)
A.weapon = {'look': 'axe', 'tier': 11}
B = mkp(w, 2, 'B', FAR + 0.6, FAR + 1.4)      # 离怪 0.68 米（半径 1.5 内 ✓）
C = mkp(w, 3, 'C', FAR + 3.2, FAR + 1.0)      # 离怪 3.2 米（半径外 ✓）
m = M.Mob(1, 30, FAR, FAR + 1.0)
m.hp = 1000
w.mobs[1] = m
m2 = M.Mob(2, 30, FAR + 1.0, FAR + 1.0)       # 同伴怪（验证"打怪那条没被改坏"）
m2.hp = 1000
w.mobs[2] = m2
hpB0, hpC0, hpM0, hpM20 = B.hp, C.hp, m.hp, m2.hp
# ★ 直接喂 fx：value=0.4 → 40% 伤害；dv=100 → 每人 40（和打怪同一个公式 ✓）
w._weapon_fx(A, m, {'name': '溅射', 'value': 0.4, 'chance': 1.0}, 100)
print('   dv=100 · 溅射 40%% · 半径 %.1f 米' % WP.SPLASH_R)
print('   玩家 B（离怪 0.68m）：%d → %d' % (hpB0, B.hp))
print('   玩家 C（离怪 3.20m）：%d → %d' % (hpC0, C.hp))
print('   怪 m2（离怪 1.00m）：%d → %d' % (hpM20, m2.hp))
ok(hpB0 - B.hp == 40, '★ B 掉了 40 血（dv 100 × 0.4 ✓）', hpB0 - B.hp)
ok(C.hp == hpC0, '★ C 在 1.5 米外 → 一点没掉 ✓', hpC0 - C.hp)
ok(hpM20 - m2.hp == 40, '★ 同伴怪照旧掉 40（没有把打怪那条改坏 ✓）', hpM20 - m2.hp)
ok(len(pends(w, B.cid, 'hurts')) == 1, '★ B 收到了 hurts 下行（客户端才看得到红字 ✓）',
   pends(w, B.cid, 'hurts'))
ok(not pends(w, C.cid, 'hurts'), '★ C 没收到 hurts ✓')

print('')
print('== ①b 溅射也遵守 PvP 开关（关了就一下都不掉）==')
w.pvp_of[B.role_id] = False
hpB1 = B.hp
w._weapon_fx(A, m, {'name': '溅射', 'value': 0.4, 'chance': 1.0}, 100)
print('   B 关了 PvP：%d → %d' % (hpB1, B.hp))
ok(B.hp == hpB1, '★ 关了 PvP 的玩家不吃溅射 ✓', hpB1 - B.hp)
w.pvp_of[B.role_id] = True

print('')
print('== ② 长棍：横扫打玩家的半径/夹角/伤害（交接文档第四节 ②）==')
w = mkworld()
A = mkp(w, 1, 'A', FAR, FAR)
A.weapon = {'look': 'staff', 'tier': 11}       # 12 阶 → 横扫长度 10 米
A.yaw = 0.0                                    # 朝向 +z
Bf = mkp(w, 2, 'B正前8m', FAR, FAR + 8.0)
Bb = mkp(w, 3, 'B正后8m', FAR, FAR - 8.0)
Bs = mkp(w, 4, 'B斜45°8m', FAR + 5.657, FAR + 5.657)
Bx = mkp(w, 5, 'B正前12m', FAR, FAR + 12.0)
m = M.Mob(1, 30, FAR, FAR + 1.0)
m.hp = 1000
w.mobs[1] = m
mF = M.Mob(2, 30, FAR, FAR + 6.0)
mF.hp = 1000
w.mobs[2] = mF
h0 = {p.name: p.hp for p in (Bf, Bb, Bs, Bx)}
hm0 = mF.hp
w._weapon_fx(A, m, {'name': '横扫', 'value': 10.0, 'chance': 1.0}, 100)
for p in (Bf, Bb, Bs, Bx):
    print('   %-9s : %d → %d（掉 %d）' % (p.name, h0[p.name], p.hp,
                                          h0[p.name] - p.hp))
print('   怪 mF（正前 6m）：%d → %d（掉 %d）' % (hm0, mF.hp, hm0 - mF.hp))
ok(h0['B正前8m'] - Bf.hp == 80, '★ 正前 8 米的玩家掉 80（dv 100 × 0.8 ✓ 不是 ×10 ✓）',
   h0['B正前8m'] - Bf.hp)
ok(Bb.hp == h0['B正后8m'], '★ 背后的玩家不掉血（37° 以外 ✓）', h0['B正后8m'] - Bb.hp)
ok(Bs.hp == h0['B斜45°8m'], '★ 斜 45° 的玩家不掉血（37° 以外 ✓）', h0['B斜45°8m'] - Bs.hp)
ok(Bx.hp == h0['B正前12m'], '★ 12 米外的玩家不掉血（直线只有 10 米 ✓）',
   h0['B正前12m'] - Bx.hp)
ok(hm0 - mF.hp == 80, '★ 怪照旧掉 80（打怪那条没改坏 ✓）', hm0 - mF.hp)
kb = [r for (_c, r) in SENT if 'kb' in r]
print('   收到击退报文 %d 条' % len(kb))
ok(len(kb) == 1, '★ 只有被打中的那个人收到 kb（击退 ✓ 别的人不该被推）', len(kb))

print('')
print('== ③ 匕首：投掷物要打到玩家（交接文档第四节 ③）==')
w = mkworld()
A = mkp(w, 1, 'A', FAR, FAR)
A.weapon = {'look': 'dagger', 'tier': 11}
B = mkp(w, 2, 'B', FAR, FAR + 5.0)             # 正前方 5 米
w.arrows['1'] = {'id': 1, 'x': FAR, 'z': FAR, 'yaw': 0.0,
                 'dx': 0.0, 'dz': 1.0, 'dmg': 57, 'crit': False,
                 'kind': 'dagger', 'life': 1.0, 'by': A.cid}
hp0 = B.hp
for _ in range(30):                            # 1 秒 = 14 米，足够穿过 5 米
    w._arrow_tick(1.0 / 30)
print('   匕首从 z=200 飞向 z=205 的玩家：%d → %d' % (hp0, B.hp))
print('   箭还在飞吗：%s（应该已经命中移除了）' % ('在 ✗' if w.arrows else '没了 ✓'))
ok(hp0 - B.hp == 57, '★ B 掉了 57 血（= 这支飞刀的伤害 ✓）', hp0 - B.hp)
ok(not w.arrows, '★ 命中后飞刀被移除 ✓', w.arrows)
ok(len(pends(w, B.cid, 'hurts')) == 1, '★ B 收到 hurts 下行 ✓', pends(w, B.cid, 'hurts'))
ok(len(pends(w, A.cid, 'mhits')) == 1, '★ A 收到 mhits（打人的反馈 ✓）', pends(w, A.cid, 'mhits'))

print('')
print('== ③b 怪在前、人在后：还是先打怪（优先级没变）==')
w = mkworld()
A = mkp(w, 1, 'A', FAR, FAR)
B = mkp(w, 2, 'B', FAR, FAR + 8.0)
m = M.Mob(1, 30, FAR, FAR + 3.0)
m.hp = 500
w.mobs[1] = m
w.arrows['1'] = {'id': 1, 'x': FAR, 'z': FAR, 'yaw': 0.0,
                 'dx': 0.0, 'dz': 1.0, 'dmg': 57, 'crit': False,
                 'kind': 'dagger', 'life': 1.0, 'by': A.cid}
for _ in range(30):
    w._arrow_tick(1.0 / 30)
print('   怪 %d → %d · 玩家 %d → %d' % (500, m.hp, B.hp, B.hp))
ok(m.hp < 500 and B.hp == 500, '★ 箭打在挡路的怪身上，后面的玩家没掉血 ✓',
   (m.hp, B.hp))

print('')
print('== ③c 关了 PvP 的人不吃飞刀（穿过他继续飞）==')
w = mkworld()
A = mkp(w, 1, 'A', FAR, FAR)
B = mkp(w, 2, 'B', FAR, FAR + 5.0)
w.pvp_of[B.role_id] = False
w.arrows['1'] = {'id': 1, 'x': FAR, 'z': FAR, 'yaw': 0.0,
                 'dx': 0.0, 'dz': 1.0, 'dmg': 57, 'crit': False,
                 'kind': 'dagger', 'life': 1.0, 'by': A.cid}
for _ in range(5):
    w._arrow_tick(1.0 / 30)
print('   B 关了 PvP：血 %d（没掉就是对的 ✓）· 箭还在：%s'
      % (B.hp, '在 ✓' if w.arrows else '没了 ✗'))
ok(B.hp == 500 and w.arrows, '★ 关了 PvP 的玩家不吃飞刀，箭继续飞 ✓', (B.hp, bool(w.arrows)))

print('')
print('== ④ 长枪：挑飞玩家（升空事件 + 落地范围伤害）==')
w = mkworld()
# ★ 血量给到 5000：长枪 12 阶暴击能打 600+ ✗ 500 血的 B 会被【一击打死】✓
#   而"倒下的人不挑飞"是故意的 ✓ → 血量不够时这条测试会随机红 ✗（第一次就是这么红的）
A = mkp(w, 1, 'A', FAR, FAR)
A.weapon = {'look': 'spear', 'tier': 11}       # 12 阶：挑飞概率 17%
B = mkp(w, 2, 'B', FAR, FAR + 2.0, hp=5000)    # 正前方 2 米（长枪射程 3.6 ✓）
D = mkp(w, 3, 'D', FAR + 1.0, FAR + 2.5, hp=5000)   # 围观的人（离 B 1.12 米 ✓）


class _R(object):
    """把 world 里的 random.random() 钉死 → 概率分支【必定触发】✓

    ★ 不然这条测试是"17% 概率过"✗ 跑十次红九次 ✗ 比没有测试还糟 ✓
    """
    def __init__(self, v):
        self.v = v

    def random(self):
        return self.v


_real_random = W.random
W.random = _R(0.0)
hB0, hD0 = B.hp, D.hp
w._pvp_hit(A, B, WP.reach_of('spear'), WP.arc_of('spear'))
W.random = _real_random
_mine = [r for (c, r) in SENT if c == B.cid and 'launch_me' in r]
_him = [r for (c, r) in SENT if c != B.cid and 'launch_him' in r]
print('   B 掉血 %d · 收到 launch_me %d 条 · 别人收到 launch_him %d 条'
      % (hB0 - B.hp, len(_mine), len(_him)))
print('   落地队列：%r' % (w._flyq,))
ok(len(_mine) == 1, '★ 被挑飞的人收到 launch_me（客户端才接管高度 ✓）', _mine)
ok(len(_him) >= 1, '★ 周围的人也收到 launch_him（别人看得到他飞起来 ✓）', _him)
ok(len(w._flyq) == 1, '★ 压进落地队列（1.5 秒后才砸 ✓）', w._flyq)
_land0 = [r for (_c, r) in SENT if 'land' in r]
ok(not _land0, '★ 刚挑飞时【还没有】落地结算 ✓', _land0)

# 把到期时刻拨到过去 → 等价于"1.5 秒到了"
w._flyq[0] = (0.0,) + tuple(w._flyq[0][1:])
hB1, hD1 = B.hp, D.hp
w._fly_tick()
print('   落地后：B %d → %d · 围观者 D %d → %d' % (hB1, B.hp, hD1, D.hp))
print('   落地队列清空：%s' % ('是 ✓' if not w._flyq else '否 ✗'))
_land = [r for (_c, r) in SENT if 'land' in r]
print('   落地特效报文 %d 条' % len(_land))
ok(B.hp < hB1, '★ 落地砸到自己（和怪的落地一样 ✓）', hB1 - B.hp)
ok(D.hp < hD1, '★ 落地砸到 2 米内围观的人 ✓', hD1 - D.hp)
ok(not w._flyq, '★ 结算完就从队列里摘掉（不会每帧重复砸 ✓）', w._flyq)
ok(len(_land) >= 1, '★ 广播了 land（客户端有落地音效 ✓）', len(_land))

print('')
print('== ④b 落地伤害也守 PvP 开关（围观者关了就不吃）==')
w = mkworld()
A = mkp(w, 1, 'A', FAR, FAR)
A.weapon = {'look': 'spear', 'tier': 11}
B = mkp(w, 2, 'B', FAR, FAR + 2.0, hp=5000)
D = mkp(w, 3, 'D', FAR + 1.0, FAR + 2.5, hp=5000)
w.pvp_of[D.role_id] = False
W.random = _R(0.0)
w._pvp_hit(A, B, WP.reach_of('spear'), WP.arc_of('spear'))
W.random = _real_random
w._flyq[0] = (0.0,) + tuple(w._flyq[0][1:])
hD = D.hp
w._fly_tick()
print('   D 关了 PvP：%d → %d' % (hD, D.hp))
ok(D.hp == hD, '★ 关了 PvP 的人不吃别人的落地伤害 ✓', hD - D.hp)

print('')
print('== ④c 不是长枪就不该挑飞 ==')
w = mkworld()
A = mkp(w, 1, 'A', FAR, FAR)
A.weapon = {'look': 'sword', 'tier': 11}
B = mkp(w, 2, 'B', FAR, FAR + 2.0)
W.random = _R(0.0)
w._pvp_hit(A, B, WP.reach_of('sword'), WP.arc_of('sword'))
W.random = _real_random
_mine = [r for (c, r) in SENT if 'launch_me' in r]
print('   单手剑打人：launch_me %d 条 · 落地队列 %r' % (len(_mine), w._flyq))
ok(not _mine and not w._flyq, '★ 单手剑不挑飞 ✓', (_mine, w._flyq))

print('')
print('== ⑤ 武器机制对玩家要真的【触发】（用户实测报的 bug）==')
print('   病根：打人走 _pvp_hit ✗ 一个机制都不掷 ✓ 只有打怪才走 _weapon_fx')
print('   → 连刺/连砍/横扫/旋击/溅射 对玩家永远不触发 ✓')


def atk_once(look, tier, pts, mobs_at=(), roll=0.0):
    """A 拿指定武器朝 +z 挥一刀 → (w, A, [玩家...], [怪...])"""
    w = mkworld()
    A = mkp(w, 1, 'A', FAR, FAR)
    A.weapon = {'look': look, 'tier': tier}
    ps = [mkp(w, 10 + i, nm, FAR, FAR + d, hp=20000) for i, (nm, d) in enumerate(pts)]
    ms = []
    for j, (mx, mz) in enumerate(mobs_at):
        m = M.Mob(j + 1, 30, FAR + mx, FAR + mz)
        m.hp = 999999
        w.mobs[j + 1] = m
        ms.append(m)
    _sr = W.random
    W.random = _R(roll)          # 钉死概率 → 必定触发
    A.atkT = 0
    w._intent_atk(A, {})
    W.random = _sr
    return w, A, ps, ms


def flush_later(w):
    """把两个延迟队列都拨到"已到期"再跑一次 _later_tick"""
    w._later_pl = [(0.0,) + tuple(x[1:]) for x in w._later_pl]
    w._later = [(0.0,) + tuple(x[1:]) for x in w._later]
    w._later_tick()


# ⑤-a 连刺：一次挥砍 → 两段伤害（第二段延后 0.18 秒 ✓）
w, A, ps, _ = atk_once('sword', 11, [('B', 2.0)])
B = ps[0]
d1 = 20000 - B.hp
queued = len(w._later_pl)
print('   连刺：第一段 %d 伤害 · 延迟队列 %d 条' % (d1, queued))
ok(d1 > 0, '★ 第一段照常结算 ✓', d1)
ok(queued == 1, '★★ 连刺真的进队列了（修之前这里恒为 0 ✓）', queued)
flush_later(w)
total = 20000 - B.hp
print('   连刺：两段合计 %d（第二段 %d）' % (total, total - d1))
ok(total == d1 * 2, '★★ 两段伤害相等 = 真的连刺了两下 ✓', (d1, total))

# ⑤-b 早退条件：只有 _later_pl 有活时，_later_tick 也必须跑
#     （交接文档第五节第 4 条：早退条件挡住后面的逻辑 ✓ 踩过 ✓）
w = mkworld()
A2 = mkp(w, 1, 'A', FAR, FAR)
B2 = mkp(w, 2, 'B', FAR, FAR + 1.0, hp=100)
w._later = []
w._later_arrow = []
w._later_pl = [(0.0, A2.cid, B2.cid, 7)]
w._later_tick()
print('   （早退条件）B 100 → %d' % B2.hp)
ok(B2.hp == 93, '★★ 队列里只有玩家延迟伤害时也照常结算（早退条件没挡住 ✓）', B2.hp)

# ⑤-c 连砍：N 刀（第一刀 + N-1 刀排队），每刀 60%
_n_expect = max(2, min(13, int(round(WP.fx_of('saber', 11)['value']))))
w, A, ps, _ = atk_once('saber', 11, [('B', 2.0)])
B = ps[0]
first = 20000 - B.hp
nq = len(w._later_pl)
print('   连砍：第一刀 %d 伤害 · 队列 %d 条（武器表 %d 刀 → 应排 %d 条）'
      % (first, nq, _n_expect, _n_expect - 1))
ok(nq == _n_expect - 1, '★★ 弯刀对玩家也排了后续刀（和打怪同一个刀数 ✓）', nq)
flush_later(w)
print('   连砍：打完合计 %d 伤害' % (20000 - B.hp))
ok(20000 - B.hp >= first * 2, '★ 多刀都结算了 ✓', 20000 - B.hp)

# ⑤-d 横扫：主目标只吃直击、前方 6 米吃 0.8 倍、背后不吃
w, A, ps, _ = atk_once('staff', 11, [('近', 2.0), ('远', 6.0), ('背后', -6.0)])
Bnear, Bfar, Bback = ps
dn = 20000 - Bnear.hp
df = 20000 - Bfar.hp
print('   横扫：近 2m 掉 %d · 远 6m 掉 %d · 背后 掉 %d'
      % (dn, df, 20000 - Bback.hp))
ok(dn > 0, '★ 直击目标掉血 ✓', dn)
ok(df == max(1, int(round(dn * 0.8))),
   '★★ 前方 6 米的玩家也被横扫到（= 直击 × 0.8 ✓ 修之前恒为 0 ✓）', df)
ok(20000 - Bback.hp == 0, '★ 背后的玩家不吃横扫（37° 以外 ✓）', 20000 - Bback.hp)

# ⑤-e 同一次挥砍打到怪 + 人：区域机制只放一次（不然玩家吃两遍 AOE）
w = mkworld()
A = mkp(w, 1, 'A', FAR, FAR)
A.weapon = {'look': 'staff', 'tier': 11}
mkp(w, 2, 'B', FAR, FAR + 2.0, hp=20000)
mkp(w, 3, 'D', FAR, FAR + 6.0, hp=20000)
m = M.Mob(1, 30, FAR, FAR + 1.0)
m.hp = 999999
w.mobs[1] = m
_calls = []
_orig = w._aoe_players


def _spy(pp, x, z, radius, dmg, push=None, cone=None, src=None, skip=None):
    _calls.append(radius)
    return _orig(pp, x, z, radius, dmg, push, cone, src, skip)


w._aoe_players = _spy
_sr = W.random
W.random = _R(0.0)
A.atkT = 0
w._intent_atk(A, {})
W.random = _sr
print('   怪在 1m、玩家在 2m/6m → _aoe_players 被调用 %d 次' % len(_calls))
ok(len(_calls) == 1, '★★ 同一次挥砍只放一次横扫（不会"又打怪又打人"放两遍 ✓）', _calls)

# ⑤-f 旋击：4.4 米一圈；主目标只有直击（否则它会等于别人的两倍）
w, A, ps, _ = atk_once('hammer', 11, [('近', 2.0), ('中', 4.0), ('远', 6.0)])
Bnear, Bmid, Bfar = ps
print('   旋击：近 2m 掉 %d · 中 4m 掉 %d · 远 6m 掉 %d'
      % (20000 - Bnear.hp, 20000 - Bmid.hp, 20000 - Bfar.hp))
ok(20000 - Bmid.hp > 0, '★★ 4 米外的玩家也被旋击打到（半径 4.4 ✓ 修之前恒为 0 ✓）',
   20000 - Bmid.hp)
ok(20000 - Bfar.hp == 0, '★ 6 米外打不到 ✓', 20000 - Bfar.hp)
ok(20000 - Bnear.hp == 20000 - Bmid.hp,
   '★ 主目标没有多吃一次旋击（吃两次就会是别人的两倍 ✓）',
   (20000 - Bnear.hp, 20000 - Bmid.hp))

# ⑤-g 溅射：以被打中的人为中心；主目标不重复吃
#   ★ 为什么直接调 _weapon_fx_player 而不是挥一刀：
#     斧的射程 3.0（前置筛 4.0）+ 扇形 1.55 弧度 → 1.5 米内的人基本都会【被直击】✓
#     → 挥一刀看不出"这是溅射打的还是直击打的" ✗ 分开测才分得清 ✓
_wx = WP.fx_of('axe', 11)['value']
w = mkworld()
A = mkp(w, 1, 'A', FAR, FAR)
A.weapon = {'look': 'axe', 'tier': 11}
Bm = mkp(w, 2, '主目标', FAR, FAR + 2.0, hp=20000)
Bs = mkp(w, 3, '旁边', FAR + 1.0, FAR + 2.0, hp=20000)      # 离主目标 1.0 米（<1.5 ✓）
Bx = mkp(w, 4, '远处', FAR + 3.0, FAR + 2.0, hp=20000)      # 离主目标 3.0 米（>1.5 ✗）
w._weapon_fx_player(A, Bm, {'name': '溅射', 'value': _wx, 'chance': 1.0}, 100)
print('   溅射（dv=100 · 比例 %.2f · 半径 1.5m）：主 %d · 旁 %d · 远 %d'
      % (_wx, 20000 - Bm.hp, 20000 - Bs.hp, 20000 - Bx.hp))
ok(20000 - Bs.hp == max(1, int(round(100 * _wx))),
   '★★ 旁边 1 米的玩家吃到溅射（= 100 × %.2f ✓ 修之前恒为 0 ✓）' % _wx,
   20000 - Bs.hp)
ok(20000 - Bm.hp == 0, '★ 主目标不在溅射里重复吃（打怪也是跳过主目标 ✓）',
   20000 - Bm.hp)
ok(20000 - Bx.hp == 0, '★ 3 米外的玩家吃不到 ✓', 20000 - Bx.hp)

# ⑤-h 这些改动不能把【打怪】那条弄坏
w, A, ps, ms = atk_once('sword', 11, [('B', 2.0)], mobs_at=[(0.0, 1.0)])
print('   同一刀：怪 999999 → %d · 怪的延迟队列 %d 条 · 人的 %d 条'
      % (ms[0].hp, len(w._later), len(w._later_pl)))
ok(999999 - ms[0].hp > 0, '★ 同一刀打怪照旧 ✓', 999999 - ms[0].hp)
ok(len(w._later) == 1 and len(w._later_pl) == 1,
   '★ 怪和人的连刺各进各的队列（没有互相顶掉 ✓）',
   (len(w._later), len(w._later_pl)))

print('')
print('== ⑥ 长棍：正在打的那个目标也要被击退（用户实测报的）==')
print('   病根：横扫打怪循环第一句是 `if o is m: continue` ✗ 主目标连推都没推')
# ⑥-a 怪：主目标 + 旁边的怪都要被推 1.2 米
w = mkworld()
A = mkp(w, 1, 'A', FAR, FAR)
A.weapon = {'look': 'staff', 'tier': 11}
A.yaw = 0.0                                  # 朝向 +z
m = M.Mob(1, 30, FAR, FAR + 1.0)             # 正在打的那只
m.hp = 99999
w.mobs[1] = m
m2 = M.Mob(2, 30, FAR, FAR + 5.0)            # 横扫范围内的另一只
m2.hp = 99999
w.mobs[2] = m2
z0, z2 = m.z, m2.z
w._weapon_fx(A, m, {'name': '横扫', 'value': 10.0, 'chance': 1.0}, 100)
print('   主目标 z: %.2f → %.2f（推了 %.2f 米）' % (z0, m.z, m.z - z0))
print('   旁边怪 z: %.2f → %.2f（推了 %.2f 米）' % (z2, m2.z, m2.z - z2))
ok(abs((m.z - z0) - 1.2) < 1e-6,
   '★★ 正在打的那只也被推开 1.2 米（修之前是 0 ✓）', round(m.z - z0, 3))
ok(abs((m2.z - z2) - 1.2) < 1e-6,
   '★ 旁边的怪还是推 1.2 米（老行为没变 ✓）', round(m2.z - z2, 3))

# ⑥-b 玩家：主目标收到 kb 事件，但【不再多吃一份横扫伤害】
w = mkworld()
A = mkp(w, 1, 'A', FAR, FAR)
A.weapon = {'look': 'staff', 'tier': 11}
A.yaw = 0.0
B = mkp(w, 2, 'B', FAR, FAR + 2.0, hp=20000)
hp0 = B.hp
w._weapon_fx_player(A, B, {'name': '横扫', 'value': 10.0, 'chance': 1.0}, 100)
_kb = [r for (c, r) in SENT if c == B.cid and '"kb"' in r]
print('   B 收到 kb 报文 %d 条 · 血 %d → %d' % (len(_kb), hp0, B.hp))
if _kb:
    print('   报文内容: ' + _kb[0])
ok(len(_kb) == 1, '★★ 正在打的玩家也收到击退事件（客户端才会被推走 ✓）', _kb)
ok(hp0 - B.hp == 0,
   '★ 只补击退、不补伤害（主目标已经吃过直击 dv 了 ✓和旋击同一个道理 ✓）',
   hp0 - B.hp)

print('')
if FAILS:
    print('FAILED: %d 条 ✗' % len(FAILS))
    for f in FAILS:
        print('  - ' + f)
    sys.exit(1)
print('ALL PASS ✓')
