# -*- coding: utf-8 -*-
"""第 167 轮（用户）：夺取的 CD 和"魔气 CD"拆开，夺取改成 1 分钟

原来：同一对玩家 10 分钟内只算一次 → 魔气不算 ✗ 夺取也不做 ✗（共用一把锁）
现在：★ 两把独立的锁
  · 魔气 CD：10 分钟（不变 ✓ 用户没让改 ✓）
  · 夺取 CD：1 分钟（新 ✓ 用户要求 ✓）
  → 1 分钟内第二次杀同一个人：魔气不涨 ✓ 但【可以夺取】✓
  ★ 两个值都做成管理页可调 ✓（夺取 CD 加进 TUNE ✓）
"""
import io
import re

# ==================== ① mq.py：加 STEAL_COOLDOWN ====================
P = 'server/mq.py'
t = io.open(P, encoding='utf-8').read()
A = "PAIR_COOLDOWN = 600.0   # \u2605 \u540c\u4e00\u5bf9\u73a9\u5bb6 10 \u5206\u949f\u53ea\u7b97\u4e00\u6b21\uff08\u6700\u5173\u952e\u7684\u4e00\u6761 \u2713\uff09"
assert t.count(A) == 1, ('PAIR_COOLDOWN 锚点: %d' % t.count(A))
t = t.replace(A, A + """
# \u2605 \u7b2c 167 \u8f6e\uff08\u7528\u6237\uff09\uff1a\u593a\u53d6\u7684 CD \u5355\u72ec\u4e00\u628a\u9501 \u2717 \u548c\u9b54\u6c14\u90a3\u628a\u5206\u5f00 \u2713
#   \u7528\u6237\u539f\u8bdd\uff1a"\u4e00\u76f4\u6740\u4e00\u4e2a\u4eba\u83b7\u5f97\u9b54\u6c14\u7684 CD \u662f 10 \u5206\u949f\uff0c
#             \u90a3\u593a\u53d6\u7684 CD \u4e5f\u662f 10 \u5206\u949f\u5417\uff0c\u662f\u7684\u8bdd\u593a\u53d6\u6539\u6210 1 \u5206\u949f"
#   \u2605 \u4e3a\u4ec0\u4e48\u8fd9\u6837\u66f4\u5408\u7406\uff1a\u9b54\u6c14\u662f\u3010\u957f\u671f\u58f0\u671b\u3011\u2192 \u6162\u4e00\u70b9 \u2713
#     \u593a\u53d6\u662f\u3010\u6bcf\u6b21\u6253\u67b6\u7684\u6536\u76ca\u3011\u2192 \u5feb\u4e00\u70b9\u624d\u6709\u610f\u601d \u2713
STEAL_COOLDOWN = 60.0   # \u2605 \u540c\u4e00\u5bf9\u73a9\u5bb6\u3010\u593a\u53d6\u3011\u7684\u51b7\u5374\uff08\u79d2\uff09""")
# TUNE + TUNE_DOC
B = "    'pair_cooldown': PAIR_COOLDOWN, 'level_gap_max': LEVEL_GAP_MAX, 'safe_r': SAFE_R,"
assert t.count(B) == 1, ('TUNE 锚点: %d' % t.count(B))
t = t.replace(B, "    'pair_cooldown': PAIR_COOLDOWN, 'level_gap_max': LEVEL_GAP_MAX, 'safe_r': SAFE_R,\n"
                 "    'steal_cooldown': STEAL_COOLDOWN,   # \u2605 \u7b2c 167 \u8f6e\uff1a\u593a\u53d6\u81ea\u5df1\u7684 CD \u2713")
C = "    ('pair_cooldown', '\u540c\u4e00\u5bf9\u73a9\u5bb6\u51b7\u5374\uff08\u79d2\uff09', 'float', 0, 86400),"
assert t.count(C) == 1, ('TUNE_DOC 锚点: %d' % t.count(C))
t = t.replace(C, "    ('pair_cooldown', '\u540c\u4e00\u5bf9\u73a9\u5bb6\u3010\u9b54\u6c14\u3011\u51b7\u5374\uff08\u79d2\uff09', 'float', 0, 86400),\n"
                 "    ('steal_cooldown', '\u540c\u4e00\u5bf9\u73a9\u5bb6\u3010\u593a\u53d6\u3011\u51b7\u5374\uff08\u79d2\uff09', 'float', 0, 86400),")
# reset_tune / changed_tune 也要带上它
t = t.replace("        'pair_cooldown': PAIR_COOLDOWN, 'level_gap_max': LEVEL_GAP_MAX, 'safe_r': SAFE_R,\n        'exp_tiers'",
              "        'pair_cooldown': PAIR_COOLDOWN, 'level_gap_max': LEVEL_GAP_MAX, 'safe_r': SAFE_R,\n        'steal_cooldown': STEAL_COOLDOWN,\n        'exp_tiers'")
t = t.replace("        'pair_cooldown': PAIR_COOLDOWN, 'level_gap_max': LEVEL_GAP_MAX, 'safe_r': SAFE_R,\n        'exp_tiers': [[501",
              "        'pair_cooldown': PAIR_COOLDOWN, 'level_gap_max': LEVEL_GAP_MAX, 'safe_r': SAFE_R,\n        'steal_cooldown': STEAL_COOLDOWN,\n        'exp_tiers': [[501")
io.open(P, 'w', encoding='utf-8', newline='\n').write(t)
print('  OK mq.py：STEAL_COOLDOWN=60 ✓ 进 TUNE / TUNE_DOC / reset / changed ✓')

# ==================== ② world.py：两把锁 ====================
P2 = 'server/world.py'
t2 = io.open(P2, encoding='utf-8').read()
D = """    def _pvp_pair_ok(self, a_, b_):
        \"\"\"\u9632\u5237\uff1a\u540c\u4e00\u5bf9\u73a9\u5bb6 10 \u5206\u949f\u53ea\u7b97\u4e00\u6b21\uff08\u7528\u6237\u786e\u8ba4\uff1a\u4e0d\u8bbe\u51fb\u6740\u4e0a\u9650 \u2713 \u9760\u8fd9\u6761 \u2713\uff09\"\"\"
        ka = getattr(a_, 'role_id', None)
        kb = getattr(b_, 'role_id', None)
        now = now_s()
        ts = self.pvp_pair.get((ka, kb))
        if ts is not None and now - ts < mqmod.PAIR_COOLDOWN:
            return False
        self.pvp_pair[(ka, kb)] = now
        return True"""
assert t2.count(D) == 1, ('pair_ok 锚点: %d' % t2.count(D))
t2 = t2.replace(D, """    def _pvp_pair_ok(self, a_, b_, kind='mq'):
        \"\"\"\u9632\u5237\uff1a\u540c\u4e00\u5bf9\u73a9\u5bb6\u7684\u51b7\u5374

        \u2605\u2605 \u7b2c 167 \u8f6e\uff08\u7528\u6237\uff09\uff1a\u62c6\u6210\u3010\u4e24\u628a\u72ec\u7acb\u7684\u9501\u3011\u2605\u2605
          kind='mq'    \u2192 \u9b54\u6c14\u90a3\u628a\uff08\u9ed8\u8ba4 10 \u5206\u949f \u2713 \u7528\u6237\u6ca1\u8ba9\u6539 \u2717\uff09
          kind='steal' \u2192 \u593a\u53d6\u90a3\u628a\uff08\u9ed8\u8ba4 1 \u5206\u949f \u2713 \u7528\u6237\u8981\u6c42 \u2713\uff09
        \u2605 \u4e3a\u4ec0\u4e48\u8981\u62c6\uff1a
          \u9b54\u6c14 = \u957f\u671f\u58f0\u671b\uff08\u6da8\u5f97\u6162\u624d\u503c\u94b1 \u2713\uff09
          \u593a\u53d6 = \u6bcf\u6b21\u6253\u67b6\u7684\u6536\u76ca\uff08\u592a\u6162\u5c31\u6ca1\u610f\u601d\u4e86 \u2717\uff09
          \u5408\u7528\u4e00\u628a\u9501 \u2192 \u4e3a\u4e86\u9632\u5237\u9b54\u6c14\uff0c\u628a\u593a\u53d6\u4e5f\u9501\u6b7b\u4e86 \u2717
        \"\"\"
        ka = getattr(a_, 'role_id', None)
        kb = getattr(b_, 'role_id', None)
        now = now_s()
        book = self.pvp_pair_steal if kind == 'steal' else self.pvp_pair
        cd = float(mqmod.cfg('steal_cooldown', mqmod.STEAL_COOLDOWN)) if kind == 'steal' \\
            else float(mqmod.cfg('pair_cooldown', mqmod.PAIR_COOLDOWN))
        ts = book.get((ka, kb))
        if ts is not None and now - ts < cd:
            return False
        book[(ka, kb)] = now
        return True""")
# 初始化那张表
E = "        self.pvp_pair = {}        # \u2605 \u7b2c 150 \u8f6e\uff1a{(killer,victim): \u4e0a\u6b21\u7b97\u6570\u65f6\u523b} \u2014\u2014 \u540c\u4e00\u5bf9 10 \u5206\u949f\u53ea\u7b97\u4e00\u6b21 \u2713"
assert t2.count(E) == 1, ('pvp_pair 初始化锚点: %d' % t2.count(E))
t2 = t2.replace(E, E + "\n        self.pvp_pair_steal = {}  # \u2605 \u7b2c 167 \u8f6e\uff1a\u593a\u53d6\u81ea\u5df1\u4e00\u5f20\u8868\uff08\u9ed8\u8ba4 1 \u5206\u949f \u2713\uff09")
# _pvp_killed：魔气用 mq 锁 ✓ 夺取用 steal 锁 ✓
F = """        counted = self._pvp_pair_ok(killer, victim)
        if counted:"""
assert t2.count(F) == 1, ('pvp_killed 锚点: %d' % t2.count(F))
t2 = t2.replace(F, """        counted = self._pvp_pair_ok(killer, victim, 'mq')       # \u2605 \u9b54\u6c14\u90a3\u628a\u9501\uff08 10 \u5206\u949f \u2713\uff09
        steal_ok = self._pvp_pair_ok(killer, victim, 'steal')   # \u2605 \u7b2c 167 \u8f6e\uff1a\u593a\u53d6\u53e6\u4e00\u628a\u9501\uff081 \u5206\u949f \u2713\uff09
        if counted:""")
G = "        self._pvp_steal(killer, victim, counted)"
assert t2.count(G) == 1, ('steal 调用锚点: %d' % t2.count(G))
t2 = t2.replace(G, "        self._pvp_steal(killer, victim, steal_ok)   # \u2605 \u7528\u593a\u53d6\u81ea\u5df1\u7684\u9501 \u2717 \u4e0d\u518d\u7528\u9b54\u6c14\u7684 \u2713")
# 提示语：把"同一对手 10 分钟"改成实话
H = """                ('\uff0c\u9b54\u6c14 +%d\uff08\u73b0\u5728 %d\uff09' % (mqmod.KILL_GAIN, killer.mq)) if counted
                else '\uff08\u540c\u4e00\u5bf9\u624b 10 \u5206\u949f\u5185\u53ea\u7b97\u4e00\u6b21\uff0c\u9b54\u6c14\u6ca1\u53d8\uff09')))"""
assert t2.count(H) == 1, ('提示语锚点: %d' % t2.count(H))
t2 = t2.replace(H, """                ('\uff0c\u9b54\u6c14 +%d\uff08\u73b0\u5728 %d\uff09' % (mqmod.KILL_GAIN, killer.mq)) if counted
                else '\uff08\u540c\u4e00\u5bf9\u624b\u7684\u9b54\u6c14\u51b7\u5374\u6ca1\u5230\uff0c\u9b54\u6c14\u6ca1\u53d8\uff1b\u593a\u53d6\u662f\u53e6\u5916\u4e00\u6761\u51b7\u5374\uff09')))""")
io.open(P2, 'w', encoding='utf-8', newline='\n').write(t2)
print('  OK world.py：两把锁（魔气 10 分钟 / 夺取 1 分钟）')
print('  DONE')
