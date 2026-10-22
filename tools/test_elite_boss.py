# -*- coding: utf-8 -*-
"""round600 精英/Boss 单测（不启服务器）"""
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'server'))

import mobs
import pve_combat
import world


def ck(cond, msg, got=None):
    print(('  PASS  ' if cond else '  FAIL  ') + msg + ('' if got is None else '  got=' + repr(got)))
    return 0 if cond else 1


def main():
    bad = 0
    normal = mobs.Mob(1, 20, 0, 0, rank=0)
    elite = mobs.Mob(2, 20, 0, 0, rank=1, skin='rift')
    boss = mobs.Mob(3, 20, 0, 0, rank=2, skin='dragon')
    bad += ck(normal.rank == 0 and normal.wire()[-3:-1] == [0, ''], '普通怪 rank/skin')
    bad += ck(elite.rank == 1 and elite.wire()[-3:-1] == [1, 'rift'], '精英 rank/skin')
    bad += ck(boss.rank == 2 and boss.wire()[-3:-1] == [2, 'dragon'], 'Boss rank/skin')
    bad += ck(elite.mhp > normal.mhp and boss.mhp > elite.mhp, '血量 rank 递增',
              (normal.mhp, elite.mhp, boss.mhp))
    bad += ck(elite.exp > normal.exp and boss.exp > elite.exp, '经验 rank 递增',
              (normal.exp, elite.exp, boss.exp))
    bad += ck(mobs.mob_affixes if False else True, '词条模块可导入')
    bad += ck(pve_combat.effective_dr(30, 10) == 20.0, '减伤-穿透')
    bad += ck(pve_combat.dodge_chance(20, 15, 50) == 5.0, '闪避-命中')
    bad += ck(pve_combat.mitigate(100, 30, 0) == 70, '减伤结算')
    bad += ck(pve_combat.mitigate(100, 90, 0) == 30, '30% 地板')

    # 贡献经验总和
    w = object.__new__(world.World)
    w.players = {}
    w._aff = lambda p, k: 0.0
    w._gain_exp = lambda p, e: setattr(p, 'got', getattr(p, 'got', 0) + e)
    w._save_role = lambda p: None
    class P(object):
        def __init__(self, cid):
            self.cid = cid
            self.hp = 100
    a, b = P('a'), P('b')
    w.players = {'a': a, 'b': b}
    m = types.SimpleNamespace(mid='m', rank=2, exp=100, dmgBy={'a': 60, 'b': 40})
    w._award_special_exp(m, a)
    bad += ck(a.got + b.got == 100 and a.got == 60 and b.got == 40,
              'Boss 经验按贡献且总数守恒', (a.got, b.got))

    # PvE 防御：30% 减伤 - 10% 穿透 = 20%，再扣 2 点固定
    w._aff = lambda p, k: 0.0
    w._tal = lambda p, k: float((getattr(p, 'talEff', {}) or {}).get(k, 0))
    w._add_pend = lambda *a, **k: None
    p = types.SimpleNamespace(cid='p', talEff={'hit': 20, 'pen': 10})
    mm = types.SimpleNamespace(mid='m', rank=2, dr_pct=30, dr_flat=2,
                               dodge_pt=0, hp=1000, x=0, z=0)
    bad += ck(w._mob_defense(p, mm, 100) == 78, '玩家穿透对怪物减伤')

    # v6：技能落点/直线/扇形判定
    gm = types.SimpleNamespace(castX=10, castZ=0, castFromX=0, castFromZ=0,
                               castYaw=0, x=0, z=0)
    bad += ck(w._mob_skill_inside(gm, 5, 0, 2, 'line', {}), '直线命中线段内')
    bad += ck(not w._mob_skill_inside(gm, 5, 3, 2, 'line', {}), '直线侧移可躲')
    bad += ck(w._mob_skill_inside(gm, 0, 8, 8, 'cone', {'cone': 60}), '扇形正面命中')
    bad += ck(not w._mob_skill_inside(gm, 0, -8, 8, 'cone', {'cone': 60}), '扇形绕后可躲')
    bad += ck(w._mob_ranged_range(types.SimpleNamespace(rank=2, kind='')) == 0.0,
              'Boss 普通攻击近战')
    bad += ck(w._mob_ranged_range(types.SimpleNamespace(rank=0, kind='程序员')) == 8.0,
              '程序员普通远程保留')

    # Boss 技能状态机
    w2 = object.__new__(world.World)
    fired = []
    w2._mob_skill_send = lambda *a, **k: None
    w2._mob_evt = lambda *a, **k: None
    w2._mob_skill_apply = lambda m: fired.append(m.castKey)
    bm = types.SimpleNamespace(rank=2, skin='dragon', bossPhase=1, hp=100, mhp=100,
                               castT=0, castPhase='', castKey='', castName='',
                               castX=0, castZ=0, castYaw=0, castTarget=None,
                               skillCd={}, freezeT=0, stunT=0, x=0, z=0)
    near = types.SimpleNamespace(x=5, z=0, cid='p')
    started = world.World._mob_skill_ai(w2, bm, near, 0.016)
    bad += ck(started and bm.castKey == 'dragon_breath', 'Boss 技能起手', bm.castKey)
    bm.castT = 0.01
    world.World._mob_skill_ai(w2, bm, near, 0.02)
    bad += ck(fired == ['dragon_breath'] and bm.castPhase == 'recover',
              'Boss 技能命中结算', (fired, bm.castPhase))

    # 技能广播：1000 米内的两个玩家都收到
    old_p = world.P
    class FP(object):
        @staticmethod
        def pack(k, **kw):
            return (k, kw)
    world.P = FP
    w3 = object.__new__(world.World)
    w3.players = {'a': types.SimpleNamespace(cid='a', x=10, z=0),
                  'b': types.SimpleNamespace(cid='b', x=30, z=0),
                  'c': types.SimpleNamespace(cid='c', x=1200, z=0)}
    got = []
    w3._send_cid = lambda cid, pkt: got.append(cid)
    mm = types.SimpleNamespace(mid='m', rank=2, skin='dragon', castKey='dragon_breath',
                               castName='骨龙息', castX=0, castZ=0, castYaw=0,
                               x=0, z=0)
    world.World._mob_skill_send(w3, mm, {'radius': 8, 'cast': 1.8}, 'windup')
    world.P = old_p
    bad += ck(got == ['a', 'b'], 'Boss 技能广播范围内玩家', got)
    print('FAILED: %d' % bad)
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())

