# -*- coding: utf-8 -*-
"""皮肤独占竞价：规则单元测试（不起服务器）

规则（用户定）：
  · 没人出价 → 所有解锁者都能用（allowed = None）
  · 有人出价 → 前三名能用（并列同额一起进）
  · 第一 > 第二 × 1.3 → 只有第一能用（独占）
  · 恰好 1.3 倍 → 不算独占（必须【严格大于】）
"""
import os
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'server'))

import world  # noqa: E402
import skins  # noqa: E402

FAILS = 0


def ck(c, m, got=None):
    global FAILS
    if c:
        print('  PASS  ' + m)
    else:
        FAILS += 1
        print('  FAIL  ' + m + ('' if got is None else '  got=%r' % (got,)))


def make(bids):
    w = world.World.__new__(world.World)
    w.cfg = {}
    w._skin_bids = {'f01': dict(bids)}
    return w


# ① 没人出价
w = make({})
a = w._skin_access('f01')
ck(a['mode'] == 'free' and a['allowed'] is None, '没人出价 → 所有人都能用')
ck(w._skin_can_use(999, 'f01') is True, '没人出价 → 随便谁（解锁了的话）都能用')

# ② 两三个人出价 → 前三
w = make({1: 20000, 2: 16000})
a = w._skin_access('f01')
ck(a['mode'] == 'top3' and a['allowed'] == {1, 2}, '两人出价 → 两人都能用', a)
ck(w._skin_can_use(3, 'f01') is False, '没出价的第三人不能用')

# ③ 恰好 1.3 倍 → 不算独占
w = make({1: 26000, 2: 20000})
a = w._skin_access('f01')
ck(a['mode'] == 'top3', '第一恰好 = 第二 × 1.3 → 不算独占（要严格大于）', a['mode'])

# ④ 超过 1.3 倍 → 独占
w = make({1: 26001, 2: 20000})
a = w._skin_access('f01')
ck(a['mode'] == 'solo' and a['allowed'] == {1}, '第一 > 第二 × 1.3 → 独占', a)
ck(w._skin_can_use(2, 'f01') is False, '独占时第二名也不能用')

# ⑤ 并列第一
w = make({1: 20000, 2: 20000, 3: 5000})
a = w._skin_access('f01')
ck(a['mode'] == 'top3' and a['allowed'] == {1, 2, 3},
   '并列第一 → 不触发独占（没有严格第一），三人都能用', a)

# ⑥ 前三名 + 第三名并列
w = make({1: 50000, 2: 42000, 3: 25000, 4: 25000, 5: 1000})
a = w._skin_access('f01')
ck(a['mode'] == 'top3' and a['allowed'] == {1, 2, 3, 4},
   '第三名并列 → 并列的一起进（四人可用）', a)
ck(w._skin_can_use(5, 'f01') is False, '第五名不能用')

# ⑦ 只有一个人出价
w = make({7: 20000})
a = w._skin_access('f01')
ck(a['mode'] == 'top3' and a['allowed'] == {7}, '只有一人出价 → 他能用，别人不能')

# ⑧ 数值常量
ck(skins.BID_START == 20000, '起拍价 20000')
ck(skins.BID_STEP == 5000, '最小加价 5000')
ck(abs(skins.EXCLUSIVE_X - 1.3) < 1e-9, '独占阈值 1.3')
ck(skins.TOP_N == 3, '前三名')
ck(abs(skins.DROP_RATE - 0.01) < 1e-9, '皮肤掉率 1%')

print()
if FAILS:
    print('FAILED: %d' % FAILS)
    sys.exit(1)
print('全部通过')
