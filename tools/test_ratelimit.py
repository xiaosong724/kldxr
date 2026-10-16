# -*- coding: utf-8 -*-
"""验证第 228 轮的按连接限流

为什么用单元测试而不是真发洪水：
  · 快（毫秒级 ✓）· 准（直接看放行/丢弃 ✓）· 不依赖服务器跑着 ✓
  ★ 而且能精确验证【不误伤】✗ 这才是限流最关键的一条 ✓
"""
import sys
import time

sys.path.insert(0, 'server')

import net as N          # noqa: E402


def burst(cid, t, n):
    """连续发 n 个同类包，返回放行数 / 丢弃数"""
    ok = 0
    for _ in range(n):
        if N._rate_ok(cid, t):
            ok += 1
    return ok, n - ok


print('  阈值：', N.RATE_LIMIT, '· 其它类型默认', N.RATE_LIMIT_DEFAULT)
print()

# ① ★ 最重要的一条：正常频率不能被误伤
ok, bad = burst('c1', 'move', 30)
print('  ① 客户端真实频率 30/秒 move  → 放行 %d / 丢弃 %d   %s'
      % (ok, bad, '不误伤 ✓★' if bad == 0 else '✗ 误伤了！'))

# ② 阈值边界：正好到上限要放行，超一个才丢
N._rate_state.clear()
ok, bad = burst('c2', 'move', 60)
print('  ② 正好 60/秒（阈值）        → 放行 %d / 丢弃 %d   %s'
      % (ok, bad, '边界正确 ✓' if (ok, bad) == (60, 0) else '✗'))

N._rate_state.clear()
ok, bad = burst('c3', 'move', 61)
print('  ③ 61/秒（超一个）           → 放行 %d / 丢弃 %d   %s'
      % (ok, bad, '拦住 ✓' if (ok, bad) == (60, 1) else '✗'))

# ③ 洪水：1000/秒
N._rate_state.clear()
ok, bad = burst('c4', 'move', 1000)
print('  ④ 洪水 1000/秒 move         → 放行 %d / 丢弃 %d   %s'
      % (ok, bad, '★ 拦住 94%% ✓✓' if bad >= 900 else '✗ 没拦住'))

# ④ 攻击 / 聊天
N._rate_state.clear()
ok, bad = burst('c5', 'atk', 11)
print('  ⑤ atk 11/秒（上限 10）      → 放行 %d / 丢弃 %d   %s'
      % (ok, bad, '拦住 ✓' if (ok, bad) == (10, 1) else '✗'))

N._rate_state.clear()
ok, bad = burst('c6', 'chat', 20)
print('  ⑥ chat 20/秒（上限 5）      → 放行 %d / 丢弃 %d   %s'
      % (ok, bad, '拦住 ✓' if (ok, bad) == (5, 15) else '✗'))

# ⑤ 连接之间互不影响（★ 关键：不能一个人刷得所有人都被限）
N._rate_state.clear()
burst('flood', 'move', 500)          # 一个人狂刷
ok, _ = burst('normal', 'move', 30)   # 另一个人正常玩
print('  ⑦ 有人洪水时，另一个正常玩家 → 放行 %d/30   %s'
      % (ok, '不受影响 ✓★' if ok == 30 else '✗ 被连累了'))

# ⑥ 过了这一秒要恢复
N._rate_state.clear()
burst('c7', 'move', 100)
st = N._rate_state.get('c7')
st['sec'] = int(time.time()) - 1      # 假装过了一秒
ok, bad = burst('c7', 'move', 30)
print('  ⑧ 下一秒恢复                → 放行 %d/30   %s'
      % (ok, '计数器会重置 ✓' if ok == 30 else '✗ 没重置'))

print()
print('  超限累计计数（给日志/管理页用）：',
      {k: v['bad'] for k, v in N._rate_state.items() if v['bad']})
