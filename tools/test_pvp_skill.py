# -*- coding: utf-8 -*-
"""round574 单测：技能 AOE 打玩家 + 分身打玩家 + 打空不掷被动
不启服务器，直接拿 World 的方法 + 假对象跑 ✓
"""
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'server'))

import world  # noqa: E402

FAILS = 0


def ck(cond, msg, got=None):
    global FAILS
    if cond:
        print('  PASS  ' + msg)
    else:
        FAILS += 1
        print('  FAIL  ' + msg + '  got=' + repr(got))


class P(object):
    def __init__(self, cid, name, rid, x, z, hp=100):
        self.cid = cid
        self.name = name
        self.role_id = rid
        self.role = {'id': rid, 'level': 1, 'account_id': rid}
        self.x = x
        self.z = z
        self.hp = hp
        self.mq = 0
        self.party = None


def fake_world():
    w = object.__new__(world.World)
    w.players = {}
    w.mobs = {}
    w.clones = {}
    w.party_of = {}
    w.pvp_all = True
    w.pvp_of = {}
    w._send_cid = lambda *a, **k: None
    w._add_pend = lambda *a, **k: None
    w.post_save = lambda *a, **k: None
    w._fx_broadcast = lambda *a, **k: None
    w._pvp_killed = lambda *a, **k: None
    w._report_hit = lambda *a, **k: None
    w._mob_died = lambda *a, **k: None
    w._clone_despawn = lambda *a, **k: None
    w._aoe_players = types.MethodType(world.World._aoe_players, w)
    w._clone_tick = types.MethodType(world.World._clone_tick, w)
    w._sk_b_attack_hit = types.MethodType(world.World._sk_b_attack_hit, w)
    w._sk_b_on_attack = lambda p: None
    w._skAtkHitSeq = {}
    return w


def main():
    global FAILS
    # 单测固定安全区半径（真实配置可能是管理页改过的值）
    world.mqmod.TUNE['safe_r'] = 15.0

    # ---- ① 技能 AOE：src='skill' 不能再崩，玩家要掉血 ----
    w = fake_world()
    a = P('a', '甲', 1, 0, 20)
    b = P('b', '乙', 2, 1, 20)
    w.players = {'a': a, 'b': b}
    before = b.hp
    world.World._aoe_players(w, a, b.x, b.z, 5.0, 17, src='skill')
    ck(b.hp == before - 17, '技能 AOE 打中非队友玩家（掉 17 血）', b.hp)

    # 队友免疫（直接换一个 pvp_ok 返回 teammate 的假 world）
    w2 = fake_world()
    a2 = P('a2', '甲', 1, 0, 20)
    b2 = P('b2', '乙', 2, 1, 20)
    w2.players = {'a2': a2, 'b2': b2}
    w2._pvp_ok = lambda x, y: (False, 'teammate')
    world.World._aoe_players(w2, a2, b2.x, b2.z, 5.0, 17, src='skill')
    ck(b2.hp == 100, '队友不吃技能 AOE', b2.hp)

    # ---- ② 分身：目标里有玩家 → 追过去 → 打掉血 ----
    w3 = fake_world()
    owner = P('o', '主人', 10, 0, 20)
    victim = P('v', '路人', 20, 0, 24)
    w3.players = {'o': owner, 'v': victim}
    w3.clones = {'c1': {'id': 'c1', 'owner': 'o', 'role_id': 10,
                        'x': 0, 'z': 20.5, 'hp': 1, 'ttl': 30, 'atkT': 0,
                        'syncT': 0, 'dmg': 12}}
    # _clone_tick 里用 P.pack / 广播，这里只关心 hp
    for _ in range(40):
        world.World._clone_tick(w3, 0.1)
    ck(victim.hp < 100, '分身会打非队友玩家', victim.hp)
    ck(owner.hp == 100, '分身不会打主人', owner.hp)

    # ---- ③ 打空不掷被动：同一 atkSeq 没命中，不调 _sk_b_on_attack ----
    w4 = fake_world()
    p4 = P('p4', '空挥', 40, 0, 0)
    p4.atkSeq = 7
    called = []
    w4._sk_b_on_attack = lambda x: called.append(x.cid)
    world.World._sk_b_attack_hit(w4, p4, 7)   # 模拟"命中了"才调
    ck(called == ['p4'], '命中时触发被动', called)
    world.World._sk_b_attack_hit(w4, p4, 7)   # 同一刀重复调 → 去重
    ck(called == ['p4'], '同一刀只触发一次', called)

    # ---- ④ 技能 AOE 也能打到【分身】（分身现在有血 ✓）----
    w5 = fake_world()
    owner5 = P('o5', '主人', 50, 0, 20)
    atk5 = P('a5', '打手', 51, 0, 20)
    w5.players = {'o5': owner5, 'a5': atk5}
    w5.clones = {'c9': {'id': 'c9', 'owner': 'o5', 'hp': 50, 'hpMax': 50,
                        'x': 1, 'z': 20, 'dmg': 1, 'ttl': 30, 'atkT': 0, 'syncT': 0}}
    world.World._aoe_players(w5, atk5, 1, 20, 5.0, 9, src='skill')
    ck(w5.clones['c9']['hp'] == 41, '技能 AOE 也能打到分身', w5.clones['c9']['hp'])

    # ---- ⑤ 分身被打到 0 血 → 走 _clone_despawn（客户端淡出）----
    gone = []
    w5._clone_despawn = lambda cid: gone.append(cid)
    world.World._clone_damage(w5, w5.clones['c9'], 99, atk5, False)
    ck(w5.clones['c9']['hp'] == 0, '分身血量归零', w5.clones['c9']['hp'])
    ck(gone == ['c9'], '分身死亡走 despawn', gone)

    # ---- ⑥ 黑洞吸力：玩家收 pull 事件、分身直接位移 ----
    w6 = fake_world()
    caster6 = P('c6', '施法者', 60, 0, 20)
    vic6 = P('v6', '受害者', 61, 2, 20)
    w6.players = {'c6': caster6, 'v6': vic6}
    w6.clones = {'c66': {'id': 'c66', 'owner': 'v6', 'hp': 30, 'hpMax': 30,
                         'x': 3, 'z': 20, 'dmg': 1, 'ttl': 30, 'atkT': 0, 'syncT': 0}}
    sent = []
    w6._send_cid = lambda cid, pkt: sent.append((cid, pkt))
    w6._pull_tick = types.MethodType(world.World._pull_tick, w6)
    _now = world.now_s()
    w6._pulls = [{'due': _now - 0.1, 'until': _now + 1.0,
                  'x': 0, 'z': 20, 'r': 10, 'str': 5.0, 'by': 'c6'}]
    world.World._pull_tick(w6, 0.033)
    ck(vic6.x == 2, '玩家坐标不由服务端强改（客户端权威）', vic6.x)
    ck(any('pull' in str(x[1]) for x in sent), '玩家收到 pull 事件', sent[:1])
    ck(w6.clones['c66']['x'] < 3, '黑洞把分身也往中心拉', w6.clones['c66']['x'])

    # ---- ⑦ 坦克引擎：击杀后生命上限 + 体型都要真的变 ----
    w7 = fake_world()
    p7 = P('t7', '坦克', 70, 0, 20)
    p7.skLoad = {'B': ['tank'], 'A': [], 'C': []}
    p7.skBT = {}
    p7.skBuff = {}
    p7.skTA = {}
    p7.skTankBase = 0
    p7.skTankHp = 0
    p7.skTankN = 0
    p7.skSize = 1.0
    p7.talRaw = {}
    p7.armor = None
    p7.hp = 100
    w7.players = {'t7': p7}
    _tankSent = []
    w7._send_cid = lambda cid, pkt: _tankSent.append(pkt)
    w7._sk_b_fx = lambda *a, **k: None
    w7._sk_b_list = types.MethodType(world.World._sk_b_list, w7)
    w7._sk_b_canfire = types.MethodType(world.World._sk_b_canfire, w7)
    before7 = world.World._hp_max(w7, p7)
    world.World._sk_b_on_kill(w7, p7, None)
    ck(p7.skTankHp > before7, '坦克引擎提升生命上限', [before7, p7.skTankHp])
    ck(world.World._hp_max(w7, p7) == p7.skTankHp,
       '生命上限函数真的读坦克值', world.World._hp_max(w7, p7))
    ck(p7.skSize > 1.0, '坦克引擎提升体型', p7.skSize)
    ck(p7.skTankN == 1, '坦克引擎层数 +1', p7.skTankN)
    ck(any('tank' in str(x) for x in _tankSent), '坦克叠层包已发给客户端', _tankSent)

    # ---- ⑧ 灼烧：扣灵气、烧怪/玩家/分身；空放不进 CD ----
    w8 = fake_world()
    p8 = P('b8', '火法', 80, 0, 20)
    p8.hp = 100
    p8.qi = 10
    p8.skLoad = {'B': ['burn'], 'A': [], 'C': []}
    p8.skBT = {}
    p8.skTA = {}
    p8.skBuff = {}
    p8.role = {'id': 80, 'level': 1, 'account_id': 80}
    v8 = P('v8', '路人', 81, 0, 21)
    v8.hp = 100
    w8.players = {'b8': p8, 'v8': v8}
    w8._sk_b_list = types.MethodType(world.World._sk_b_list, w8)
    w8._sk_b_canfire = types.MethodType(world.World._sk_b_canfire, w8)
    w8._sk_b_tick = types.MethodType(world.World._sk_b_tick, w8)
    w8._sk_b_fx = lambda *a, **k: None
    world.World._sk_b_tick(w8, p8, 0.05)
    ck(v8.hp == 90, '灼烧烧到附近玩家（10%）', v8.hp)
    ck(p8.qi == 9, '灼烧扣 1 灵气', p8.qi)
    ck(p8.skBT.get('burn', 0) > 0, '灼烧进入 CD', p8.skBT)
    # ★ round578：CD 要能递减 → 1 秒后能再次触发（之前 skBT 永不减 → 只触发一次）
    for _ in range(23):
        world.World._sk_b_tick(w8, p8, 0.05)
    ck(v8.hp == 80, '灼烧 CD 结束后能再次触发', [v8.hp, p8.skBT])

    # 空放：身边没人没怪 → 不扣灵气、不进 CD
    w9 = fake_world()
    p9 = P('b9', '火法', 90, 0, 20)
    p9.hp = 100; p9.qi = 10
    p9.skLoad = {'B': ['burn', 'thunderbolt'], 'A': [], 'C': []}
    p9.skBT = {}; p9.skTA = {}; p9.skBuff = {}
    p9.role = {'id': 90, 'level': 1, 'account_id': 90}
    w9.players = {'b9': p9}
    w9._sk_b_list = types.MethodType(world.World._sk_b_list, w9)
    w9._sk_b_canfire = types.MethodType(world.World._sk_b_canfire, w9)
    w9._sk_b_tick = types.MethodType(world.World._sk_b_tick, w9)
    w9._sk_b_fx = lambda *a, **k: None
    world.World._sk_b_tick(w9, p9, 0.05)
    ck(p9.qi == 10, '空放不扣灵气', p9.qi)
    ck(not p9.skBT.get('burn') and not p9.skBT.get('thunderbolt'),
       '空放不进 CD', p9.skBT)

    # ---- ⑨ 嗜血：击杀后真的要挂上 8 秒 buff ----
    w10 = fake_world()
    p10 = P('h10', '嗜血', 100, 0, 20)
    p10.skLoad = {'B': ['bloodthirst'], 'A': [], 'C': []}
    p10.skBT = {}; p10.skTA = {}; p10.skBuff = {}
    p10.role = {'id': 100, 'level': 1, 'account_id': 100}
    w10.players = {'h10': p10}
    w10._sk_b_list = types.MethodType(world.World._sk_b_list, w10)
    w10._sk_b_canfire = types.MethodType(world.World._sk_b_canfire, w10)
    w10._sk_b_fx = lambda *a, **k: None
    world.World._sk_b_on_kill(w10, p10, None)
    ck(abs(p10.skTA.get('bloodthirst', 0) - 8.0) < 0.01, '嗜血挂上 8 秒 buff', p10.skTA)
    # ★ round578：第二次击杀必须能刷新，且不能被残留 CD 卡住
    p10.skTA['bloodthirst'] = 1.0
    p10.skBT['bloodthirst'] = 5.0
    world.World._sk_b_on_kill(w10, p10, None)
    ck(abs(p10.skTA.get('bloodthirst', 0) - 8.0) < 0.01,
       '嗜血第二次击杀能刷新到 8 秒', p10.skTA)
    ck('bloodthirst' not in p10.skBT, '0 CD 不被残留 skBT 卡住', p10.skBT)

    # ---- ⑩ 安全区内不触发被动（雷引/灼烧）----
    w11 = fake_world()
    p11 = P('s11', '城里人', 110, 14, 14)     # 安全区（±15）
    v11 = P('v11', '城外', 111, 16, 16)       # 安全区外，距离 2.8m
    p11.hp = 100; p11.qi = 10
    p11.skLoad = {'B': ['thunderbolt', 'burn'], 'A': [], 'C': []}
    p11.skBT = {}; p11.skTA = {}; p11.skBuff = {}
    p11.role = {'id': 110, 'level': 1, 'account_id': 110}
    w11.players = {'s11': p11, 'v11': v11}
    w11._sk_b_list = types.MethodType(world.World._sk_b_list, w11)
    w11._sk_b_canfire = types.MethodType(world.World._sk_b_canfire, w11)
    w11._sk_b_tick = types.MethodType(world.World._sk_b_tick, w11)
    w11._sk_b_fx = lambda *a, **k: None
    world.World._sk_b_tick(w11, p11, 0.05)
    ck(v11.hp == 100, '安全区内不触发雷引/灼烧', v11.hp)
    ck(p11.qi == 10, '安全区内被动不扣灵气', p11.qi)

    # ---- ⑪ 灵能护盾 / 不灭意志 ----
    w12 = fake_world()
    q12 = P('q12', '护盾', 120, 0, 20)
    q12.hp = 100; q12.qi = 10
    q12.skLoad = {'B': ['undying'], 'A': [], 'C': []}
    q12.skBT = {}; q12.skTA = {}; q12.skBuff = {'qiflow': 5}
    q12.role = {'id': 120, 'level': 1, 'account_id': 120, 'qiMax': 100}
    q12.armor = None; q12.talRaw = {}; q12.weapon = {}
    q12.skShield = 50.0; q12.skShieldT = 10.0
    w12.players = {'q12': q12}
    w12._sk_b_list = types.MethodType(world.World._sk_b_list, w12)
    w12._sk_b_canfire = types.MethodType(world.World._sk_b_canfire, w12)
    w12._sk_b_fx = lambda *a, **k: None
    dv12 = world.World._on_player_hurt(w12, q12, 30, None)
    ck(dv12 == 0 and abs(q12.skShield - 20.0) < 0.01, '灵能护盾先吸收伤害',
       [dv12, q12.skShield])
    q12.skShield = 0.0; q12.skShieldT = 0.0
    q12.hp = 10
    dv13 = world.World._on_player_hurt(w12, q12, 999, None)
    ck(dv13 == 0 and q12.hp > 10, '不灭意志免死并回血', [dv13, q12.hp])
    ck('undying' in q12.skBT, '不灭意志进入 60 秒 CD', q12.skBT)
    ck(world.World._qi_max(w12, q12) >= 140, '灵气涌动提升上限', world.World._qi_max(w12, q12))

    # ---- ⑫ 多段队列 / 直线 / 扇形 ----
    w13 = fake_world()
    p13 = P('p13', '施法', 130, 0, 20)
    w13.players = {'p13': p13}
    calls = []
    w13._skill_damage = lambda p, d, x, z, r: calls.append((float(d.get('dmg') or 0), round(x, 1), round(z, 1)))
    w13._later_hits = [(world.now_s() - 1, 'p13', 1.0, 20.0, 0.60, 2.0, True)]
    world.World._later_hits_tick(w13)
    ck(len(calls) == 1 and abs(calls[0][0] - 0.60) < 0.001, '多段队列能结算单段', calls)

    class _M:
        def __init__(self, x, z):
            self.x, self.z, self.hp, self.mid = x, z, 100, 'm1'
    w13.mobs = {'m1': _M(0, 23)}
    calls.clear()
    world.World._line_skill(w13, p13, 0, 26, 8.0, 2.0, 1.5)
    ck(len(calls) == 1, '地裂直线能命中前方目标', calls)
    calls.clear()
    p13.yaw = 0
    world.World._cone_skill(w13, p13, 4.0, 90.0, 1.8)
    ck(len(calls) == 1, '燃血斩扇形能命中前方目标', calls)

    # ---- ⑬ 全能吸血 = 被动 + 词条；0 不显示 ----
    w14 = fake_world()
    q14 = P('q14', '吸血', 140, 0, 25)
    q14.hp = 100
    w14._sk_val = lambda p, k: 0.10 if k == 'omnivamp' else 0.0
    w14._aff = lambda p, k: {'vamp_all': 1.1, 'lifesteal': 0.0}.get(k, 0.0)
    w14._hp_max = lambda p: 200
    w14._send_cid = lambda *a, **k: None
    _pct = world.World._omni_pct(w14, q14)
    ck(abs(_pct - 0.111) < 0.0001, '全能吸血=被动+词条', _pct)
    _h = world.World._lifesteal(w14, q14, 50)
    ck(_h == 6 and q14.hp == 106, '造成伤害按 11.1% 回血', [_h, q14.hp])
    q14.hp = 100
    _h0 = world.World._lifesteal(w14, q14, 4)
    ck(_h0 == 0 and q14.hp == 100, '回血不足 1 点不显示 +0', [_h0, q14.hp])

    print('')
    if FAILS:
        print('FAILED: %d' % FAILS)
        sys.exit(1)
    print('全部通过')


if __name__ == '__main__':
    main()
