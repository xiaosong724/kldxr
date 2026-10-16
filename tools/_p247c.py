# -*- coding: utf-8 -*-
# 第 247 轮（第三次 ✗ 这次每处都用唯一锚点 + assert）
#   ① _ticker 帮手  ② 升级弹幕  ③ 击杀弹幕  ④ 计时字典
import io

p = 'server/world.py'
t = io.open(p, encoding='utf-8').read()
done = []

# ---------- ① _ticker 帮手（锚在 _broadcast 的 docstring 上 ✓ 唯一 ✓）----------
A = '    def _broadcast(self, text):\n        """★ 在 asyncio 循环里执行"""'
assert t.count(A) == 1, ('_broadcast 锚点: %d' % t.count(A))
HELPER = '''    def _ticker(self, text, kind='sys', tag=''):
        """第 247 轮（用户要求）：滚动通知（弹幕）

        · notice = 只发给一个人 ✗ 屏幕中间弹一下（"你已经在安全区了"这类）
        · ticker = 广播给所有人 ✗ 屏幕上方【向左滚动】（谁升级了 / 谁杀了谁）
        文案限长 22 字：滚动时长 = (文字宽 + 屏宽) ÷ 速度 ✗
          太长会滚十几秒 ✗ 后面全堵住
        同类 1 秒内合并：打团战 3 秒杀 5 个 ✗ 不然弹幕滚一分钟
        """
        try:
            import time as _t
            now = _t.time()
            if tag:
                last = self._ticker_last.get(tag)
                if last is not None and now - last < 1.0:
                    self._ticker_dup[tag] = self._ticker_dup.get(tag, 0) + 1
                    return
                n = self._ticker_dup.pop(tag, 0)
                if n:
                    text = text + '（等 %d 条）' % n
                self._ticker_last[tag] = now
            if len(text) > 22:
                text = text[:21] + '…'
            self._broadcast(P.pack('ticker', text=text, kind=kind))
        except Exception as e:
            print('[ticker] 发不出去：%r' % (e,))

''' + A
t = t.replace(A, HELPER, 1)
done.append('_ticker 帮手')

# ---------- ② 升级弹幕（插在已有的那条 notice 后面 ✓ 唯一 ✓）----------
B = """            if ups:
                self._send_cid(q.cid, P.pack('notice', text='升到 %d 级！' % level, level=level))"""
assert t.count(B) == 1, ('升级 notice 锚点: %d' % t.count(B))
NEW_B = B + """
                # ★ 第 247 轮：升级还要播报给全服（用户要求：谁升到了多少级）
                self._ticker('%s 升到了 %d 级' % (q.name, level), 'up', tag='up:%d' % q.role_id)"""
t = t.replace(B, NEW_B, 1)
done.append('升级弹幕')

# ---------- ③ 击杀弹幕（锚在已有的那条播报上 ✓）----------
C = "{'text': '%s 击杀了 %s' % (killer.name, victim.name)}"
assert t.count(C) == 1, ('击杀播报锚点: %d' % t.count(C))
t = t.replace(C, C + ",\n                       P.pack('ticker', text='%s 击杀了 %s' % (killer.name, victim.name), kind='kill')", 1)
done.append('击杀弹幕')

# ---------- ④ 计时字典（锚在带注释的 _pend 上 ✓ 唯一 ✓）----------
D = '        self._pend = {}                 # cid ->'
assert t.count(D) == 1, ('_pend 锚点: %d' % t.count(D))
t = t.replace(D, D + "\n        self._ticker_last = {}          # 第 247 轮：同类弹幕最后发送时间（1 秒合并）"
                    + "\n        self._ticker_dup = {}           # 被合并掉了几条", 1)
done.append('计时字典')

io.open(p, 'w', encoding='utf-8', newline='\n').write(t)
print('  完成：' + ' | '.join(done))
