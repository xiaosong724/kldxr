import io, re
# ---------- ① 组队距离不限制 ----------
p = 'server/world.py'
t = io.open(p, encoding='utf-8').read()
m = re.search(r"(\n *if \(q\.x - m\.x\) \*\* 2 \+ \(q\.z - m\.z\) \*\* 2 > d2:\n *continue[^\n]*)", t)
assert m, '找不到距离判断 ✗'
print('  找到距离判断：%s' % m.group(1).strip()[:70])
NEW = ("\n              # ★★★ 第 241 轮（用户："组队距离调整为不限制"）★★★\n"
       "              #   这里原来有一句：30 米外不分享经验 ✗\n"
       "              #   → 队友离得远就拿不到 ✓✓\n"
       "              #     用户报的\"组队分享的经验检查一下是否有真的加上\"\n"
       "              #     很可能就是这个（代码本身是好的 ✓ 是距离把它挡了 ✓）\n"
       "              #   ★ 现在取消距离限制 ✗ 只要在同一队里就分 ✓\n"
       "              #     （用户明确要求不限距离 ✓ 防蹭怪的考虑先放一边 ✓）")
t = t[:m.start(1)] + NEW + t[m.end(1):]
io.open(p, 'w', encoding='utf-8', newline='\n').write(t)
print('  OK ① 组队距离限制已取消 ✓')

# ---------- ④ 提示文字加上"再长按 5 秒取消" ----------
p2 = 'web/index.html'
t2 = io.open(p2, encoding='utf-8').read()
A = '<span style="color:#8ee0a8">长按攻击键 5 秒 = 自动战斗</span>'
assert t2.count(A) == 1, ('提示锚点: %d' % t2.count(A))
t2 = t2.replace(A, '<span style="color:#8ee0a8">长按攻击键 5 秒 = 自动战斗'
                   '（再长按 5 秒 = 取消）</span>')
io.open(p2, 'w', encoding='utf-8', newline='\n').write(t2)
print('  OK ④ 游戏内提示行加上了"再长按 5 秒 = 取消" ✓')

# 登录页那行也加
A2 = '长按右下角攻击键 5 秒 = 自动战斗（再长按 5 秒关闭）'
n = t2.count(A2)
print('  （登录页那行已经有"再长按 5 秒关闭"了 ✓ %d 处 ✓）' % n)
