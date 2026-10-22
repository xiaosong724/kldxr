# -*- coding: utf-8 -*-
"""服务器侧性能体检（离线跑 World，不连网络）

量什么：
  ① 每 tick 的耗时（0 / 40 / 100 只怪，1 / 3 个玩家）
  ② cProfile 热点：时间到底花在哪个函数上
  ③ 快照构造 + JSON 序列化各占多少

跑法：python tools\\perf_server.py
★ 只读：World(None) 离线世界，不写库、不连网络 ✓
"""
import cProfile
import io
import os
import pstats
import sys
import time

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
sys.path.insert(0, os.path.join(_ROOT, 'server'))

import world as W          # noqa: E402
import protocol as P       # noqa: E402
import mobs as M           # noqa: E402


def mk_world(n_players=1):
    w = W.World(None)
    w._send_cid = lambda c, r: None
    w._broadcast = lambda text: None
    w._to_net = lambda fn, *a: None          # 不真的往网络线程投任务
    for i in range(n_players):
        p = W.Player('c%d' % (i + 1), {'id': 100 + i, 'name': 'P%d' % i,
                                       'level': 30, 'hp': 500, 'qi': 0,
                                       'x': 200.0 + i * 2, 'z': 200.0,
                                       'yaw': 0, 'hpMax': 500, 'account_id': 100 + i})
        p.hp = 500
        w.players[p.cid] = p
    return w


def spawn(w, n):
    p = list(w.players.values())[0]
    w._debug_spawn(p, n, False)


def bench(n_mobs, n_players, ticks=300):
    w = mk_world(n_players)
    spawn(w, n_mobs)
    # 预热
    for _ in range(10):
        w._step()
    t0 = time.perf_counter()
    for _ in range(ticks):
        w._step()
    dt = (time.perf_counter() - t0) / ticks * 1000.0
    return w, dt


print('== ① 每 tick 耗时（单位 ms，30Hz 的预算是 33ms）==')
for np_ in (1, 3):
    for nm in (0, 20, 40, 100):
        w, ms = bench(nm, np_)
        print('   玩家 %d · 怪 %3d → %6.3f ms/tick  （余量 %.1f%%）'
              % (np_, len(w.mobs), ms, max(0.0, 100.0 * (1 - ms / 33.0))))

print('')
print('== ② 快照 + 序列化（每个玩家一份，看看拆开是多少）==')
w = mk_world(1)
spawn(w, 40)
p = list(w.players.values())[0]
N = 200
t0 = time.perf_counter()
for _ in range(N):
    ms_ = w._mobs_for(p)
    if ms_:
        d = {'mobs': ms_}
        P.pack_str('world', d)
print('   40 只怪 · 单玩家：构造 + 序列化 %.3f ms'
      % ((time.perf_counter() - t0) / N * 1000.0))

w3 = mk_world(3)
spawn(w3, 40)
pl = list(w3.players.values())
t0 = time.perf_counter()
for _ in range(N):
    for q in pl:
        ms_ = w3._mobs_for(q)
        if ms_:
            P.pack_str('world', {'mobs': ms_})
print('   40 只怪 · 3 玩家：每人各做一遍 %.3f ms（这就是重复的那部分）'
      % ((time.perf_counter() - t0) / N * 1000.0))

print('')
print('== ③ cProfile 热点（40 只怪 · 3 玩家 · 300 tick）==')
w = mk_world(3)
spawn(w, 40)
pr = cProfile.Profile()
pr.enable()
for _ in range(300):
    w._step()
pr.disable()
sio = io.StringIO()
pstats.Stats(pr, stream=sio).sort_stats('cumulative').print_stats(18)
txt = sio.getvalue().split('\n')
for ln in txt:
    if ('ncalls' in ln or '_step' in ln or 'wire' in ln or 'pack_str' in ln
            or 'dumps' in ln or '_mobs_for' in ln or '_snapshot' in ln
            or '_mob_tick' in ln or '_mob_bite' in ln or 'json' in ln
            or 'list' in ln.lower() and 'append' in ln):
        print('   ' + ln.rstrip()[:150])
