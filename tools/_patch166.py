# -*- coding: utf-8 -*-
"""第 166 轮（用户）：被僵尸杀死也掉 1 点魔气

原规则：被【玩家】击杀 −1 魔气
新规则：被僵尸咬死【也】−1

★ 关键：只能扣一次 ✗
  hp 从 >0 掉到 <=0 的那一瞬间才算"被咬死" ✓
  之后 hp 一直是 0（僵尸也不会再咬尸体 ✓）→ 但加个判断更保险 ✓
"""
import io

# ==================== ① world.py：僵尸咬死也扣魔气 ====================
P = 'server/world.py'
t = io.open(P, encoding='utf-8').read()
A = """        p.hp = max(0, int(p.hp) - dv)
        self._add_pend(p.cid, 'hurts', {'dmg': dv, 'x': round(m.x, 2), 'z': round(m.z, 2),
                                        'by': m.kind, 'kind': 'mob', 'crit': bool(crit)})"""
assert t.count(A) == 1, ('mob_bite 锚点: %d' % t.count(A))
t = t.replace(A, """        _was_alive = int(p.hp) > 0                      # \u2605 \u7b2c 166 \u8f6e\uff1a\u8bb0\u4e0b\u201c\u521a\u624d\u8fd8\u6d3b\u7740\u201d\u2713
        p.hp = max(0, int(p.hp) - dv)
        self._add_pend(p.cid, 'hurts', {'dmg': dv, 'x': round(m.x, 2), 'z': round(m.z, 2),
                                        'by': m.kind, 'kind': 'mob', 'crit': bool(crit)})
        # \u2605\u2605 \u7b2c 166 \u8f6e\uff08\u7528\u6237\uff1a\u88ab\u50f5\u5c38\u6740\u6b7b\u4e5f\u4f1a\u6389 1 \u70b9\u9b54\u6c14\uff09\u2605\u2605
        #   \u2605 \u53ea\u5728\u3010\u4ece\u6d3b\u7740\u53d8\u6210\u5012\u4e0b\u3011\u7684\u90a3\u4e00\u4e0b\u6263 \u2717
        #     \uff08\u4e0d\u7136\u8fde\u7eed\u54ac\u5c38\u4f53\u4f1a\u4e00\u76f4\u6263 \u2717 \u867d\u7136\u50f5\u5c38\u4e0d\u54ac\u6b7b\u4eba \u2713\uff09
        #   \u2605 \u548c PVP \u90a3\u8fb9\u4e00\u6837\uff1a\u53ea\u4f1a\u5230 0 \u4e3a\u6b62 \u2713 \u8d70 post_save \u843d\u5e93 \u2713
        if _was_alive and int(p.hp or 0) <= 0 and int(p.mq or 0) > 0:
            _lost = min(int(p.mq or 0), int(mqmod.cfg('killed_loss', mqmod.KILLED_LOSS)))
            p.mq = max(0, int(p.mq or 0) - _lost)
            self._mq_save(p)
            self._send_cid(p.cid, P.pack(
                'notice', text='\u4f60\u88ab%s\u6253\u6b7b\u4e86\uff0c\u9b54\u6c14 \u2212%d\uff08\u73b0\u5728 %d\uff09'
                              % (m.kind, _lost, int(p.mq or 0))))""")
io.open(P, 'w', encoding='utf-8', newline='\n').write(t)
print('  OK world.py：僵尸咬死也扣魔气（只在"活着→倒下"那一下 ✓）')

# ==================== ② 百科 ====================
P2 = 'web/platform/web.js'
t2 = io.open(P2, encoding='utf-8').read()
B = "'\u88ab\u73a9\u5bb6\u51fb\u6740\uff1a<b>\u22121</b>',"
assert t2.count(B) == 1, ('百科锚点: %d' % t2.count(B))
t2 = t2.replace(B, "'\u88ab\u6740\uff08\u73a9\u5bb6\u6216\u50f5\u5c38\uff09\uff1a<b>\u22121</b>',")
io.open(P2, 'w', encoding='utf-8', newline='\n').write(t2)
print('  OK 百科：改成"被击杀（玩家或僵尸）"')

# ==================== ③ 方案文档 ====================
P3 = 'docs/\u9b54\u6c14\u4e0ePVP\u593a\u53d6\u65b9\u6848.md'
t3 = io.open(P3, encoding='utf-8').read()
C = "| **\u88ab\u73a9\u5bb6\u51fb\u6740** | **\u22121** | \u88ab\u602a\u6253\u6b7b\u4e0d\u7b97 \u2717\uff08\u90a3\u662f PVE \u2717\uff09|"
assert t3.count(C) == 1, ('方案锚点: %d' % t3.count(C))
t3 = t3.replace(C, "| **\u88ab\u73a9\u5bb6\u51fb\u6740** | **\u22121** | \u2605 \u7b2c 166 \u8f6e\u7528\u6237\u6539\u4e86\u89c4\u5219 \u2717 |\n"
                    "| **\u88ab\u50f5\u5c38\u54ac\u6b7b** | **\u22121** | \u2605 \u7b2c 166 \u8f6e\u65b0\u589e\uff08\u7528\u6237\uff1a\u88ab\u50f5\u5c38\u6740\u6b7b\u4e5f\u4f1a\u6389 1 \u70b9 \u2713\uff09|")
io.open(P3, 'w', encoding='utf-8', newline='\n').write(t3)
print('  OK 方案文档：补一行')

# ==================== ④ 管理页说明 ====================
P4 = 'server/mq.py'
t4 = io.open(P4, encoding='utf-8').read()
D = "('killed_loss', '\u88ab\u73a9\u5bb6\u51fb\u6740 \u2212\u51e0\u70b9\u9b54\u6c14', 'int', 0, 100),"
assert t4.count(D) == 1, ('mq.py 说明锚点: %d' % t4.count(D))
t4 = t4.replace(D, "('killed_loss', '\u88ab\u6740\uff08\u73a9\u5bb6\u6216\u50f5\u5c38\uff09\u2212\u51e0\u70b9\u9b54\u6c14', 'int', 0, 100),")
io.open(P4, 'w', encoding='utf-8', newline='\n').write(t4)
print('  OK 管理页说明：改成"被击杀（玩家或僵尸）"')
print('  DONE')
