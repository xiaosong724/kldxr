# -*- coding: utf-8 -*-
"""离线验收：突破时服务器会不会把 lvfx 发给同屏的人（patch 成 fake 玩家，真实跑 _give_exp）"""
import os
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
sys.path.insert(0, os.path.join(_ROOT, 'server'))

import world as W          # noqa: E402

FAILS = 0


def ck(c, m, got=None):
    global FAILS
    if c:
        print('  PASS  ' + m)
    else:
        FAILS += 1
        print('  FAIL  ' + m + ('' if got is None else '  got=%r' % (got,)))


def mk_player(cid, rid, name, x, z, lv=1):
    q = W.Player(cid, {'id': rid, 'name': name, 'level': lv, 'hp': 200, 'qi': 0,
                       'exp': 0})
    q.x, q.z = x, z
    q.name = name
    q.role_id = rid
    q.weapon = {'look': 'sword', 'tier': 1}
    return q


def main():
    w = W.World(None)
    w._send_cid = lambda c, r: None
    w._broadcast = lambda text: None
    w._to_net = lambda fn, *a: None

    a = mk_player('cA', 201, '甲', 60.0, 60.0, lv=1)
    b = mk_player('cB', 202, '乙', 66.0, 60.0, lv=5)      # 同屏（6 米）
    c = mk_player('cC', 203, '丙', 200.0, 60.0, lv=5)     # 远处（140 米，不同屏）
    for q in (a, b, c):
        w.players[q.cid] = q
        q.hp = 200

    # 直接把 A 的经验给到"该升级"的量（走真实 _give_exp）
    need = 0
    try:
        import mobs as M
        need = int(M.level_up_need(1))
    except Exception:
        need = 20
    print('  1 级升 2 级需要经验: %d' % need)
    w._pend.clear()
    w._gain_exp(a, need + 5)

    pA = w._pend.get('cA') or {}
    pB = w._pend.get('cB') or {}
    pC = w._pend.get('cC') or {}

    print('  A 的 pend 键: %r' % sorted(pA.keys()))
    print('  B 的 pend 键: %r' % sorted(pB.keys()))
    print('  C 的 pend 键: %r' % sorted(pC.keys()))

    ck(pA.get('me', {}).get('lv') == 2, '★ A 升级到 2 级（me.lv）', pA.get('me'))
    lvA = pA.get('lvfx') or []
    ck(len(lvA) == 1, '★★ A 自己收到了 lvfx', lvA)
    if lvA:
        ck(lvA[0][2] == 2 and lvA[0][3] == 1, '★★ A 那条标了"本人"（刷新时不重复放）', lvA[0])
        ck(abs(lvA[0][0] - 60.0) < 0.01 and abs(lvA[0][1] - 60.0) < 0.01,
           '★ lvfx 带的是 A 的坐标', lvA[0])
    lvB = pB.get('lvfx') or []
    ck(len(lvB) == 1, '★★ 同屏的 B 也收到了 lvfx（这就是"同步给别人"）', lvB)
    if lvB:
        ck(lvB[0][3] == 0, '★★ B 那条标的是"别人"', lvB[0])
        ck(lvB[0][2] == 2, '★ B 收到的是 A 的新等级', lvB[0])
    lvC = pC.get('lvfx') or []
    ck(len(lvC) == 0, '★★ 远处不同屏的 C 收不到（不浪费带宽）', lvC)

    print('')
    print('FAILED: %d' % FAILS if FAILS else 'ALL PASS ✓')
    return 1 if FAILS else 0


if __name__ == '__main__':
    sys.exit(main())
