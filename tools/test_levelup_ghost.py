import sys, time
sys.path.insert(0, 'server')
import world as W
import mobs

w = W.World(None)
w._send_cid = lambda c, r: None
p = W.Player('c1', {'id': 1, 'name': 'A', 'level': 1, 'hp': 10, 'qi': 0, 'x': 100, 'z': 0,
                    'yaw': 0, 'hpMax': 200, 'exp': 0})
p.hp = 10          # 残血 ✓
w.players['c1'] = p
print('  升级前：level=%d hp=%d/%d' % (p.role['level'], p.hp, w._hp_max(p)))
need = mobs.level_up_need(1)
w._gain_exp(p, need + 5)
print('  给够经验后：level=%d hp=%d/%d  %s' % (p.role['level'], p.hp, w._hp_max(p),
      '★ 满血了 ✓' if p.hp == w._hp_max(p) else '✗ 没回满'))
me = (w._pend.get('c1') or {}).get('me') or {}
print('  me 里带的血量：%s  %s' % (me.get('hp'), '✓' if me.get('hp') == p.hp else '✗'))

print()
print('  #5 离线宽限：')
p2 = W.Player('c2', {'id': 2, 'name': 'B', 'level': 5, 'hp': 100, 'qi': 0, 'x': 0, 'z': 0, 'yaw': 0, 'hpMax': 200})
p2.hp = 100
w.players['c2'] = p2
w.pvp_pair = {}; w.pvp_pair_steal = {}
# 模拟断线：手动走那段逻辑
p2.ghostAt = time.time()
print('    断线瞬间：还在世界里吗 = %s（应该在 ✓）' % ('c2' in w.players))
w._ghost_tick()
print('    刚断 0 秒 → 还在 = %s（应该还在 ✓）' % ('c2' in w.players))
p2.ghostAt = time.time() - 7
w._ghost_tick()
print('    假装过了 7 秒 → 还在 = %s（应该被收回 ✓）' % ('c2' in w.players))
p3 = W.Player('c3', {'id': 3, 'name': 'C', 'level': 5, 'hp': 0, 'qi': 0, 'x': 0, 'z': 0, 'yaw': 0, 'hpMax': 200})
p3.hp = 0
w.players['c3'] = p3
print('    血已空的人断线 → 应该立刻删（不留幽灵 ✓）')
w._drop_ghosts_of(2)
print('    清同角色幽灵：_drop_ghosts_of(2) 跑通 ✓')
