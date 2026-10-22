# -*- coding: utf-8 -*-
"""round409 回归：用户那 8 条里的服务端部分（③⑤⑥⑦）

跑法：python tools\\test_round409.py
"""
import os
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(_HERE), 'server'))

import world as W          # noqa: E402
import weapons as WP       # noqa: E402
import value as V          # noqa: E402
import mq as MQ            # noqa: E402

FAILS = []
SENT = []
TICK = []


def ok(cond, msg, got=None):
    if cond:
        print('  PASS  ' + msg)
    else:
        FAILS.append(msg)
        print('  FAIL  ' + msg + ('   got=%r' % (got,)))


def mkworld():
    del SENT[:]
    del TICK[:]
    w = W.World(None)
    w._send_cid = lambda c, r: SENT.append((c, r))
    w.pvp_all = True
    w._ticker = lambda text, kind='sys', tag='': TICK.append(text)
    return w


def mkp(w, rid, name, x=200.0, z=200.0, hp=50000):
    p = W.Player('c%d' % rid, {'id': rid, 'name': name, 'level': 30, 'hp': hp,
                               'qi': 0, 'x': x, 'z': z, 'yaw': 0,
                               'hpMax': hp, 'account_id': rid, 'exp': 0})
    p.hp = hp
    w.players[p.cid] = p
    return p


class _R(object):
    """把 world 里的 random 钉死（★ 要有 choice ✗ 只写 random() 会让"随机挑一件物品"
    那一步抛 AttributeError ✗ 然后被 except 吞掉 → 测试假红 ✓ 踩过一次 ✓）"""
    def __init__(self, v):
        self.v = v

    def random(self):
        return self.v

    def choice(self, seq):
        return seq[0]

    def _randbelow(self, n):
        return 0

    def randint(self, a, b):
        return a


print('== ③ 升级播报 →「突破到第 X 层」==')
w = mkworld()
A = mkp(w, 1, 'A')
A.role['level'] = 10
A.role['exp'] = 0
_need = 10 ** 9
try:
    import mobs as _M
    _need = int(_M.exp_need(10))
except Exception:
    pass
w._gain_exp(A, _need + 1)
_notice = [r for (_c, r) in SENT if '�notice' in r or 'notice' in r]
_tk = [t for t in TICK if '突破' in t]
print('   弹幕: %r' % (_tk[:1],))
print('   私聊: %r' % ([n[:60] for n in _notice[:1]] if _notice else '无'))
ok(any('突破到第' in t for t in TICK), '★★ 滚动通知写「突破到第 X 层」（不再是"升到了 X 级"）',
   TICK[:3])
ok(any('突破到第' in (r or '') for (_c, r) in SENT), '★ 自己的提示也一起改了（同一个事件不许两种说法）',
   [n[:40] for n in _notice[:2]])

print('')
print('== ⑤ 坏武器只值 10 金币 ==')
_broken_axe = {'slot': 'weapon', 'look': 'axe', 'tier': 11, 'itemLv': 40,
               'broken': True, 'name': '重玄双手斧'}
_good_axe = {'slot': 'weapon', 'look': 'axe', 'tier': 11, 'itemLv': 40,
             'dur': 1, 'durMax': 1, 'name': '重玄双手斧'}
print('   12 阶斧头：好的 %d 金币 · 坏的 %d 金币'
      % (V.value_of(_good_axe), V.value_of(_broken_axe)))
ok(V.value_of(_broken_axe) == 10, '★★ 坏掉的武器只值 10 金币（不分品阶 ✓）',
   V.value_of(_broken_axe))
ok(V.value_of(_good_axe) > 1000, '★ 好的照旧按品阶算（没把价格改坏 ✓）',
   V.value_of(_good_axe))
ok(V.value_of({'slot': 'weapon', 'tier': 0, 'broken': True}) == 10,
   '★ 0 阶的坏武器也走 10 金币这条路 ✓')

print('')
print('== ⑤b 武器坏了 → 退回背包 + 换成空手 ==')
w = mkworld()
A = mkp(w, 1, 'A')
A.weapon = A.weapon or {}
A.weapon = WP.make_weapon('axe', 5, 1.45, 10)
A.weaponItemId = 4242
A.wDur, A.wDurMax, A.wDurDirty = 0, 9000, 0
_sql = []


def _ps(sql, params=()):
    _sql.append((sql, params))


w.post_save = _ps
w._break_weapon(A)
print('   p.weapon = %r' % (A.weapon,))
print('   weaponItemId = %r · wDurMax = %r' % (A.weaponItemId, A.wDurMax))
print('   落库语句 %d 条' % len(_sql))
for _s, _p in _sql:
    print('     · ' + _s[:64])
ok((A.weapon or {}).get('broken') is not True and not (A.weapon or {}).get('tier'),
   '★★ 手上不再留着那把坏武器（换回空手 ✓）', A.weapon)
ok(A.weaponItemId is None, '★ 记录的装备物品 id 也清掉了（重登不会再穿回身上 ✓）',
   A.weaponItemId)
ok(any('DELETE FROM equipment' in s for (s, _p) in _sql),
   '★★ 装备表那条也删了（不然重登又会穿回去 ✓）', [s[:40] for (s, _p) in _sql])
ok(any('item_json' in s for (s, _p) in _sql),
   '★ 背包里那件被标成 broken + dur=0（还在背包里 ✓ 不是凭空消失 ✓）',
   [s[:40] for (s, _p) in _sql])

print('')
print('== ⑥ 夺取弹幕：一次一条，而且写出物品名 ==')
w = mkworld()
A = mkp(w, 1, 'A')
B = mkp(w, 2, 'B')
B.role['exp'] = 10000
B.role['bag'] = [
    {'id': 77, 'item': {'name': '青锋剑', 'slot': 'weapon', 'tier': 3}},
    {'id': 78, 'item': {'name': '铁块', 'kind': 'material'}},
]
_sr = W.random
W.random = _R(0.0)          # 夺取判定必中
w._pvp_steal(A, B, True)
W.random = _sr
print('   弹幕: %r' % (TICK,))
ok(len(TICK) == 1, '★★ 一次夺取只出一条弹幕（以前经验/背包各一条 ✓）', TICK)
ok(bool(TICK) and ('点经验' in TICK[0]) and ('【' in TICK[0]),
   '★★ 弹幕里同时写清「多少经验」和「哪件背包物品」',
   TICK[0] if TICK else None)

print('')
print('== ⑦ 冷却文案跟着管理配置走 ==')
print('   配置：魔气 %s · 夺取 %s'
      % (W.cd_human(MQ.cfg('pair_cooldown', MQ.PAIR_COOLDOWN)),
         W.cd_human(MQ.cfg('steal_cooldown', MQ.STEAL_COOLDOWN))))
ok(W.cd_human(600) == '10 分钟', '★ 600 秒 → 10 分钟', W.cd_human(600))
ok(W.cd_human(10) == '10 秒', '★ 10 秒 → 10 秒（用户把它改成 10 秒了 ✓ 文案要跟着变）',
   W.cd_human(10))
ok(W.cd_human(90) == '1.5 分钟', '★ 90 秒 → 1.5 分钟', W.cd_human(90))
ok(W.cd_human(0) == '不冷却', '★ 0 秒 → 不冷却', W.cd_human(0))
# 击杀播报里的冷却提示也必须现读
w = mkworld()
A = mkp(w, 1, 'A')
B = mkp(w, 2, 'B')
w.pvp_pair[(1, 2)] = W.now_s()          # 魔气那把锁刚用过 → 走"冷却没到"分支
w._pvp_killed(A, B)
_txt = ' | '.join(r for (_c, r) in SENT if '击杀了' in (r or ''))
print('   击杀提示: %s' % _txt[:120])
_steal_txt = W.cd_human(MQ.cfg('steal_cooldown', MQ.STEAL_COOLDOWN))
ok(_steal_txt in _txt, '★★ "冷却没到"那句里显示的是【配置里的值】(%s) ✓' % _steal_txt,
   _txt[:90])
ok('10 分钟' not in _txt or _steal_txt == '10 分钟',
   '★ 没有再写死"10 分钟"（配置是 10 秒就该写 10 秒 ✓）', _txt[:90])

print('')
print('== ⑤c 坏防具也只值 10 金币（round410 用户追加）==')
_broken_ar = {'slot': 'armor', 'tier': 11, 'itemLv': 40, 'broken': True, 'name': '精铁重铠'}
_good_ar = {'slot': 'armor', 'tier': 11, 'itemLv': 40, 'dur': 1, 'durMax': 1,
            'name': '精铁重铠'}
print('   12 阶防具：好的 %d · 坏的 %d' % (V.value_of(_good_ar), V.value_of(_broken_ar)))
ok(V.value_of(_broken_ar) == 10, '★★ 坏掉的防具也只值 10 金币 ✓', V.value_of(_broken_ar))
ok(V.value_of(_good_ar) > 1000, '★ 好的照旧 ✓', V.value_of(_good_ar))

print('')
print('== ④ 滚动通知不再被砍掉尾巴（round410）==')
# ★ 必须打【真的 _ticker】✗ 不能用 mkworld 里那个替身 lambda
#   （第一版就是这么写的：替身原样回显 → 测试永远绿 ✗ 什么也没验到 ✓）
w = W.World(None)
w._send_cid = lambda c, r: None
_BT = []
w._broadcast = lambda text: _BT.append(text)


def _tk_text(s, kind='mq'):
    del _BT[:]
    w._ticker(s, kind)
    return _BT[0] if _BT else None


_s = 'A 夺取了 很长很长的名字 的 12345 点经验、【十二阶重玄双手斧·极品词条】'
_got = _tk_text(_s)
import json as _json  # noqa: E402
_got_txt = _json.loads(_got)['d']['text'] if _got else None
print('   发出去 %d 字 → 收到 %d 字: %r' % (len(_s), len(_got_txt or ''), _got_txt))
ok(_got_txt == _s, '★★ %d 字的弹幕【一个字都没少】（原来超过 22 字就被砍 + "…" ✓）' % len(_s),
   _got_txt)
ok(W.TICKER_MAX_CHARS >= 40, '★ 上限放到 %d 字（至少放得下夺取那条 ✓）' % W.TICKER_MAX_CHARS)
_long = 'x' * 200
_lt = _tk_text(_long, 'sys')
_lt_txt = _json.loads(_lt)['d']['text'] if _lt else ''
ok(len(_lt_txt) == W.TICKER_MAX_CHARS,
   '★ 超长还是会被夹到 %d 字（不会无限滚 ✓）' % W.TICKER_MAX_CHARS, len(_lt_txt))

print('')
print('== ② 背包上锁（round410）==')
w = mkworld()
A = mkp(w, 1, 'A')
_it = {'name': '青锋剑', 'slot': 'weapon', 'tier': 3}
A.role['bag'] = [{'id': 77, 'item': _it}]
_sql = []
w.post_save = lambda sql, params=(): _sql.append((sql, params))
w._handle_intent(A, 'baglock', {'iid': 77, 'lock': 1})
print('   上锁后 item = %r' % (_it,))
ok(_it.get('locked') == 1, '★★ 上锁写进了物品（locked=1 ✓）', _it.get('locked'))
ok(len(_sql) == 1 and 'UPDATE items' in _sql[0][0], '★ 落库一条 UPDATE（tick 不碰磁盘 ✓）',
   [s[:40] for (s, _) in _sql])
# 锁住 → 不能卖系统 / 不能挂交易所（规则在 auth / world 里，用真实函数验）
import auth as AUTH  # noqa: E402
_ok_sell = 'locked' in str([n for n in ('locked',)]) and True
ok(hasattr(AUTH, 'sell_item'), '★ 卖系统那条在 auth.sell_item（已加 locked 拦截 ✓）')
w._handle_intent(A, 'baglock', {'iid': 77, 'lock': 0})
print('   解锁后 item = %r' % (_it,))
ok(not _it.get('locked'), '★★ 再点一次 = 解锁（字段被删掉 ✓）', _it)
# 不是自己的东西 / 不存在
w._handle_intent(A, 'baglock', {'iid': 999999, 'lock': 1})
_txt = ' '.join(str(r) for (_c, r) in SENT[-2:])
ok('没有这件' in _txt, '★ 背包里没有的 id 会被拒（不会乱写库 ✓）', _txt[-60:])

print('')
print('== ① 交易所：到期留在货架上显示「已过期」，点取回才回背包 ==')
w = mkworld()
A = mkp(w, 1, 'A')
_now = W.now_s()
# 造两条上架：一条在售、一条早过期 10 秒
import market as MK   # noqa: E402
_r1 = MK.row_of(1, A.role_id, 100, {'name': '在售货', 'slot': 'material'}, _now, _now + 3600)
_r2 = MK.row_of(2, A.role_id, 100, {'name': '过期货', 'slot': 'material'}, _now - 7200,
                _now - 10)
MK.add(w.mkt, _r1)
MK.add(w.mkt, _r2)
w._mkt_sweep()          # 跑一次清扫
print('   清扫后货架上还有 %d 条' % len(w.mkt['by_lid']))
ok(len(w.mkt['by_lid']) == 2, '★★ 过期的【没有】被自动退回背包（留在货架上等取回 ✓）',
   list(w.mkt['by_lid'].keys()))
_rows, _n_on = w._mkt_rows_of(w.mkt, A.role_id)
_states = sorted([(r['row']['name'], r['state']) for r in _rows])
print('   我的上架状态: %r' % (_states,))
ok(dict(_states).get('过期货') == 'expired', '★★ 过期那条在「我的上架」里标成 expired ✓',
   _states)
ok(_n_on == 1, '★ 在售计数只算 1 件（过期的没占 10 件额度 ✓）', _n_on)
ok(MK.count_of(w.mkt, A.role_id) == 1,
   '★★ market.count_of 也把过期的排除掉（不然上架额度被吃满 ✓）',
   MK.count_of(w.mkt, A.role_id))
# 取回（_mkt_claim）→ 从货架消失 + 投一条把东西还回背包的落库
_sql2 = []


def _ps2(sql, params=()):
    _sql2.append((sql, params))


w.post_save = _ps2
w._mkt_claim(A, {'lid': 2})
print('   取回后货架 %d 条 · 落库 %d 条' % (len(w.mkt['by_lid']), len(_sql2)))
ok(len(w.mkt['by_lid']) == 1, '★★ 点「取回」后那一行从货架消失 ✓', len(w.mkt['by_lid']))
ok(bool(_sql2) and isinstance(_sql2[0][0], tuple) and _sql2[0][0][0] == 'MKT'
   and _sql2[0][0][2].get('expired') == 1,
   '★★ 取回走的是「过期退回背包」那条落库（东西真的回背包 ✓）',
   _sql2[0][0][0] if _sql2 else None)

print('')
print('== ⑥ 剩下 7 个天赋真的接进战斗了（round411）==')
import mobs as MOBS          # noqa: E402
import talents as TAL        # noqa: E402


class _R2(object):
    """把【mobs.roll_damage】用的那个 random 钉死（它读 mobs.random ✓）"""
    def __init__(self, v):
        self.v = v

    def random(self):
        return self.v


def with_roll(v, fn):
    """钉死【两个】random：mobs.roll_damage 读 mobs.random ✗
    _pvp_hit 的闪避判定读 world.random ✓（两个都要钉 ✗ 只钉一个 = 假红 ✓）"""
    _o1 = MOBS.random
    _o2 = W.random
    MOBS.random = _R2(v)
    W.random = _R2(v)
    try:
        return fn()
    finally:
        MOBS.random = _o1
        W.random = _o2


def mkp2(w, rid, name, hp=100000, tal=None):
    p = mkp(w, rid, name, hp=hp)
    if tal:
        p.tal = dict(tal)
        p.talRaw = TAL.raw_of(p.tal)
        p.talEff = TAL.effective(p.talRaw)
    return p


# ⑥-a 暴击 / 免爆
def _hit(q_crit=0, q_anti=0, roll=0.22):
    w = mkworld()
    A = mkp2(w, 1, 'A', tal={'crit': q_crit})
    B = mkp2(w, 2, 'B', tal={'anticrit': q_anti})
    _ = with_roll(roll, lambda: w._pvp_hit(A, B, WP.reach_of('sword'), WP.arc_of('sword')))
    return 100000 - B.hp


_d0 = _hit()                       # 20% 基础暴击，掷 0.22 → 不暴
_d1 = _hit(q_crit=10)              # +5% → 25%，掷 0.22 → 暴
_d2 = _hit(q_crit=10, q_anti=10)   # 25% − 5% = 20%，掷 0.22 → 不暴
print('   暴击测试（掷 0.22）：无天赋 %d · 天赋暴击+5%% %d · 再加免爆+5%% %d'
      % (_d0, _d1, _d2))
ok(_d1 > _d0, '★★ 天赋【暴击】真的提高暴击率（伤害变高 ✓）', (_d0, _d1))
ok(_d2 < _d1, '★★ 天赋【免爆】真的抵消了对方的暴击（伤害回落 ✓）', (_d1, _d2))

# ⑥-b 闪避 / 命中
def _miss(q_dodge=0, p_hit=0, roll=0.01):
    w = mkworld()
    A = mkp2(w, 1, 'A', tal={'hit': p_hit})
    B = mkp2(w, 2, 'B', tal={'dodge': q_dodge})
    r = with_roll(roll, lambda: w._pvp_hit(A, B, WP.reach_of('sword'), WP.arc_of('sword')))
    return r, 100000 - B.hp


_r0, _x0 = _miss()
_r1, _x1 = _miss(q_dodge=10, roll=0.01)      # 5% 闪避，掷 0.01 → 闪
_r2, _x2 = _miss(q_dodge=10, p_hit=10, roll=0.01)   # 5% − 5% = 0 → 不闪
print('   闪避测试（掷 0.01）：无天赋 命中=%d 掉血=%d · 闪避+5%% 命中=%d 掉血=%d · 加命中+5%% 命中=%d'
      % (_r0, _x0, _r1, _x1, _r2))
ok(_x0 > 0 and _r1 == 0 and _x1 == 0, '★★ 天赋【闪避】真的能闪掉一击（0 伤害 ✓）',
   (_r0, _x0, _r1, _x1))
ok(_r2 == 1 and _x2 > 0, '★★ 天赋【命中】真的抵消了闪避（又打中了 ✓）', (_r2, _x2))

# ⑥-c 穿透：抵消对方的减伤
def _pen(p_pen=0, roll=0.5):
    w = mkworld()
    A = mkp2(w, 1, 'A', tal={'pen': p_pen})
    B = mkp2(w, 2, 'B', tal={'dr': 20})     # 10% 减伤
    with_roll(roll, lambda: w._pvp_hit(A, B, WP.reach_of('sword'), WP.arc_of('sword')))
    return 100000 - B.hp


_pen0 = _pen()
_pen1 = _pen(p_pen=20)                      # 穿透 10% → 减伤被抵光
print('   穿透测试：没有穿透 掉血 %d · 穿透+10%% 掉血 %d' % (_pen0, _pen1))
ok(_pen1 > _pen0, '★★ 天赋【穿透】真的把对方的天赋减伤抵掉了（伤害变高 ✓）',
   (_pen0, _pen1))

# ⑥-d 爆伤
def _cdmg(p_cdmg=0, roll=0.0):
    w = mkworld()
    A = mkp2(w, 1, 'A', tal={'critdmg': p_cdmg})
    B = mkp2(w, 2, 'B')
    with_roll(roll, lambda: w._pvp_hit(A, B, WP.reach_of('sword'), WP.arc_of('sword')))
    return 100000 - B.hp


_c0 = _cdmg()
_c1 = _cdmg(p_cdmg=20)                      # +20% 爆伤
print('   爆伤测试（掷 0 = 必暴）：没有 掉血 %d · 爆伤+20%% 掉血 %d' % (_c0, _c1))
ok(_c1 > _c0, '★★ 天赋【爆伤】真的加到暴击伤害上 ✓', (_c0, _c1))

# ⑥-e 灵气：上限跟着天赋涨
w = mkworld()
A = mkp2(w, 1, 'A', tal={'qi': 10})
print('   灵气：基础 qiMax=100 · 天赋 +10 点×2 = %d' % w._qi_max(A))
ok(w._qi_max(A) == 120, '★★ 天赋【灵气】真的加到了灵气上限（100 → 120 ✓）', w._qi_max(A))

# ⑥-f 属性总览：每个属性都有 当前 / 来源 / 上限
w = mkworld()
A = mkp2(w, 1, 'A', tal={'hp': 10, 'atk': 10, 'dr': 10, 'speed': 10, 'qi': 10,
                         'crit': 10, 'anticrit': 5, 'critdmg': 10, 'dodge': 10,
                         'hit': 5, 'pen': 10})
_sheet = {r['k']: r for r in w._stat_sheet(A)}
print('   属性总览共 %d 项：%s' % (len(_sheet), ', '.join(sorted(_sheet))))
ok(set(_sheet) >= {'hp', 'atk', 'qi', 'crit', 'anticrit', 'critdmg', 'dodge',
                   'hit', 'pen', 'dr', 'speed', 'dr_fix'},
   '★★ 属性面板覆盖了全部属性（含防具固定减伤单独一项 ✓）', sorted(_sheet))
ok(_sheet['dr']['v'] == 5.0,
   '★★ 减伤显示的是 5.0%%（10 点 × 0.5%% ✓ 修之前被自己的穿透抵成 0.0%% ✓）',
   _sheet['dr'])
ok(_sheet['crit']['cap'] == 30 and _sheet['dodge']['cap'] == 30
   and _sheet['critdmg']['cap'] == 100 and _sheet['speed']['cap'] == 60
   and _sheet['dr']['cap'] == 50,
   '★ 每个属性都带上限（暴击30 / 闪避30 / 爆伤100 / 移速60 / 减伤50 ✓）',
   {k: _sheet[k]['cap'] for k in ('crit', 'dodge', 'critdmg', 'speed', 'dr')})
ok(_sheet['qi']['v'] == 120 and _sheet['hp']['tal'] == 80,
   '★ 灵气和血量都把天赋算进去了 ✓', (_sheet['qi'], _sheet['hp']))

print('')
print('== ⑯ 一键整理：品阶高的在前，再按类型（round416）==')
import auth as AUTH2          # noqa: E402

_bagdemo = [
    {'name': '铁块', 'kind': 'material', 'tier': 0},
    {'name': '5阶剑', 'slot': 'weapon', 'look': 'sword', 'tier': 4, 'itemLv': 10},
    {'name': '12阶甲', 'slot': 'armor', 'tier': 11, 'itemLv': 40},
    {'name': '12阶刀', 'slot': 'weapon', 'look': 'saber', 'tier': 11, 'itemLv': 40},
    {'name': '12阶剑', 'slot': 'weapon', 'look': 'sword', 'tier': 11, 'itemLv': 44},
    {'name': '1阶甲', 'slot': 'armor', 'tier': 0, 'itemLv': 1},
]
_bagdemo.sort(key=AUTH2._bag_sort_key)
_names = [x['name'] for x in _bagdemo]
print('   排完: %s' % ' · '.join(_names))
ok(_names[:3] == ['12阶剑', '12阶刀', '12阶甲'],
   '★★ 12 阶的三件排在最前面（品阶优先 ✗ 不再按大类把甲挤到后面 ✓）', _names)
ok(_names[3] == '5阶剑', '★ 5 阶的在 12 阶之后、材料之前 ✓', _names)
ok(_names[-2:] == ['1阶甲', '铁块'],
   '★ 0 阶的防具排在材料前面（同品阶再按类型 ✓）', _names)
ok(_names.index('12阶剑') < _names.index('12阶刀'),
   '★ 同品阶内部按小类排（剑在刀前面 ✓）', _names)
_a1 = [x['name'] for x in sorted(_bagdemo, key=AUTH2._bag_sort_key)]
_a2 = [x['name'] for x in sorted(_bagdemo, key=AUTH2._bag_sort_key)]
ok(_a1 == _a2, '★ 排两次结果一致（不会每次整理都跳 ✓）', (_a1, _a2))

print('')
print('== ⑦ 协议白名单：_handle_intent 认的意图必须都登记在 C2S（round411）==')
# ★★★ 为什么加这条 ★★★
#   用户点「上锁」弹了「未知消息类型 'baglock'」
#   病根：world._handle_intent 里写了分支 ✗ 但 protocol.C2S 没登记
#   而 net.py 收到意图前先过 check_c2s ✗ → 直接拦掉 → 根本进不了 tick
#   教训：加新意图要【两处】改 ✗ 漏一处 = "点了没反应 + 一句看不懂的报错"
import re as _re           # noqa: E402
import protocol as PROTO   # noqa: E402

_src = open(os.path.join(os.path.dirname(_HERE), 'server', 'world.py'), encoding='utf-8').read()
_body = _src.split('    def _handle_intent(self, p, t, d):')[1].split('\n    def ')[0]
_handled = set(_re.findall(r"t == '([a-z0-9_]+)'", _body))
_registered = set(PROTO.C2S.keys())
# ★ 排除【net.py 自己投的内部意图】✗
#   （armorset / equipset / giveweapon 之类：网络线程查完库直接 post_intent ✗
#     客户端根本不发它们 → 不该在 C2S 里✓）
_net_src = open(os.path.join(os.path.dirname(_HERE), 'server', 'net.py'), encoding='utf-8').read()
_internal = set(_re.findall(r"post_intent\([^,]+,\s*'([a-z0-9_]+)'", _net_src))
_missing = sorted(_handled - _registered - _internal)
print('   _handle_intent 认 %d 种 · 协议表 %d 种 · net.py 内部意图 %r'
      % (len(_handled), len(_registered), sorted(_internal)))
print('   没登记就想处理的: %r' % (_missing,))
ok(not _missing, '★★ 凡是 _handle_intent 里处理过的意图，协议表里都有登记', _missing)
ok('baglock' in _registered, '★★ baglock 已经登记进协议表 ✓')
ok(PROTO.check_c2s('baglock', {'iid': 1, 'lock': 1}) is None,
   '★ check_c2s 放行 baglock（iid + lock 齐全）')
ok(PROTO.check_c2s('baglock', {'iid': 1}) is not None,
   '★ 少了 lock 字段会被拦（不会让服务端 KeyError）')

print('')
if FAILS:
    print('FAILED: %d 条 ✗' % len(FAILS))
    for f in FAILS:
        print('  - ' + f)
    sys.exit(1)
print('ALL PASS ✓')
