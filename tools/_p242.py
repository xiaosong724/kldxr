# -*- coding: utf-8 -*-
# 第 242 轮：队友分经验时【等级和经验没有落库】→ 重新登录会掉级
# 用户报："有玩家反馈重新进掉了等级，我也不知道是不是真的"
# ★ 结论：是真的 ✓ 而且原因很明确 ✓
#   _save_role()   → UPDATE roles SET level=?, exp=? ...   ← 存等级经验 ✓
#   _save_player() → UPDATE roles SET x,z,yaw,hp,qi ...    ← 不存等级经验 ✗
#   第 86 轮修"分经验不落库"时加的是 _save_player ✗ 加错了函数 ✓

import io
import re

p = 'server/world.py'
t = io.open(p, encoding='utf-8').read()

# ---------- ① 先看清 _save_role 的签名 ----------
m = re.search(r"\n    def _save_role\(self[^\n]*\n(?:.*\n){0,14}", t)
assert m, '找不到 _save_role'
print('  _save_role 的样子：')
for ln in m.group(0).strip().split('\n')[:8]:
    print('     ' + ln[:100])

# ---------- ② 队友分经验：补上 _save_role ----------
A = "                  self._save_player(q)"
assert t.count(A) == 1, ('分经验的存档锚点: %d' % t.count(A))
NEW = """                  self._save_player(q)
                  # ★★★ 第 242 轮修的真 bug（用户："有玩家反馈重新进掉了等级"）★★★
                  #   病根：上面那句 _save_player 存的是【坐标/朝向/血/气】✗
                  #         它【不存 level 和 exp】✗✗
                  #         → 队友蹭经验升了级 ✓ 但等级和经验一直没写库 ✓
                  #         → 一重新登录读回旧值 → ★ 掉级 ✓✓ 用户说的一模一样 ✓
                  #   ★ 第 86 轮修这个 bug 的时候加的就是 _save_player ✗
                  #     意思是"分经验也要替他存一次"✓
                  #     但存错了函数 ✗（存了位置，没存经验 ✓）
                  #   ★ 真正该调的是 _save_role（它的 SQL 里是 level=?, exp=? ✓）
                  self._save_role(q)"""
t = t.replace(A, NEW, 1)
print('  OK 1 队友分经验：补上了 _save_role（存 level + exp）')

# ---------- ③ 顺手查：抢夺魔气那条路（也调了 _gain_exp）有没有落库 ----------
m2 = re.search(r"(\n(\s+)self\._gain_exp\(stealer, take\))", t)
if m2:
    ind = m2.group(2)
    t = t[:m2.end(1)] + "\n" + ind + "self._save_role(stealer)   # ★ 第 242 轮：抢来的经验也要落库，不然一重登就没了" + t[m2.end(1):]
    print('  OK 2 魔气夺取那条路也补上了 _save_role')
else:
    print('  ★ 2 没找到 stealer 那句（可能写法不同）✗ 手工看一眼')
io.open(p, 'w', encoding='utf-8', newline='\n').write(t)
print('  DONE')
