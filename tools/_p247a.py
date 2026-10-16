# -*- coding: utf-8 -*-
# 第 247 轮：弹幕通知（服务器侧）
#   ① 新消息类型 t='ticker' {text, kind}
#   ② 三类新通知：升级 / 击杀玩家 / 拾取 >=5 阶
#   ③ 同类 1 秒内合并 + 文案限长（不然一条滚十几秒 ✗ 后面全堵着）
import io
import re

p = 'server/world.py'
t = io.open(p, encoding='utf-8').read()
done = []

# ---------- ① 加 _ticker 帮手（放在 _broadcast 旁边）----------
A = """    def _broadcast(self, text):
        \"\"\"★ 在 asyncio 循环里执行\"\"\""""
assert t.count(A) == 1, ('_broadcast 锚点: %d' % t.count(A))
HELPER = '''    def _ticker(self, text, kind='sys', tag=''):
        """★★★ 第 247 轮（用户要求）：滚动通知（弹幕）★★★

        和 notice 的区别：
          · notice = 只发给一个人 ✗ 屏幕中间弹一下 ✓（"你已经在安全区了"这类 ✓）
          · ticker = 广播给所有人 ✗ 在屏幕上方【向左滚动】✓（谁升级了 / 谁杀了谁 ✓）
        ★ 用户明确要求：系统通知改成【向左移动滚动】✗ 像弹幕一样 + 要边框 ✓
        ★ 文案限长：超过 22 个字就砍 ✗
          因为滚动时长 = (文字宽 + 屏宽) ÷ 速度 ✓
          一条太长会滚十几秒 ✗ 后面的通知全堵住 ✓
        ★ 同类 1 秒内合并：用 tag 记"上一条同类是什么时候"✗
          打团战时 3 秒杀 5 个人 ✗ 不然弹幕能滚一分钟 ✓
        """
        try:
            import time as _t
            now = _t.time()
            if tag:
                last = self._ticker_last.get(tag)
                if last is not None and now - last < 1.0:
                    self._ticker_dup[tag] = self._ticker_dup.get(tag, 0) + 1
                    return                      # ★ 1 秒内同类只发第一条 ✓
                n = self._ticker_dup.pop(tag, 0)
                if n:
                    text = text + '（等 %d 条）' % n
                self._ticker_last[tag] = now
            if len(text) > 22:
                text = text[:21] + '…'
            self._broadcast(P.pack('ticker', text=text, kind=kind))
        except Exception as e:
            print('[ticker] 发不出去：%r' % (e,))

    def _broadcast(self, text):
        """★ 在 asyncio 循环里执行"""'''
t = t.replace(A, HELPER, 1)
done.append('新增 _ticker 帮手')

# ---------- ② 升级通知 ----------
B = re.search(r"(\n(\s+)if ups > 0:\n)", t)
assert B, '找不到 ups > 0 那块'
ind = B.group(2)
INS = (B.group(1) + ind + "    # ★ 第 247 轮：升级要播报给全服（用户要求：谁升到了多少级）\n"
       + ind + "    try:\n"
       + ind + "        self._ticker('%s 升到了 %d 级' % (q.name, int(q.role.get('level') or 1)),\n"
       + ind + "                     'up', tag='up:' + str(q.role_id))\n"
       + ind + "    except Exception as _e:\n"
       + ind + "        print('[ticker] 升级播报失败：%r' % (_e,))\n")
t = t[:B.end(1)] + INS + t[B.end(1):]
done.append('升级播报')

# ---------- ③ 击杀玩家播报（那里已经有 notice 了 ✓ 并排加一条弹幕）----------
C = re.search(r"(\{'text': '%s 击杀了 %s' % \(killer\.name, victim\.name\)\})", t)
if C:
    t = t[:C.end(1)] + ", P.pack('ticker', text='%s 击杀了 %s' % (killer.name, victim.name), kind='kill')" + t[C.end(1):]
    done.append('击杀玩家播报')
else:
    print('  ★ 没找到击杀那条 notice ✗ 看一下原文：')
    for ln in t.split('\n'):
        if '击杀了' in ln:
            print('     %r' % ln.strip()[:110])

# ---------- ④ 两个计时用的字典（__init__ 里加）----------
D = "        self._pend = {}"
assert t.count(D) == 1, ('_pend 锚点: %d' % t.count(D))
t = t.replace(D, D + "\n        self._ticker_last = {}           # 第 247 轮：同类弹幕最后发送时间（做 1 秒合并 ✓）\n"
                    "        self._ticker_dup = {}            # 被合并掉了几条", 1)
done.append('计时字典')

io.open(p, 'w', encoding='utf-8', newline='\n').write(t)
print('  完成：' + ' | '.join(done))
