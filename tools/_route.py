import io,sys
sys.stdout.reconfigure(encoding="utf-8")
s=io.open("server/world.py",encoding="utf-8").read()
# 找 _intent 分发处
i=s.find("elif t == 'sit'")
# 往外层找 try
seg=s[max(0,i-3000):i]
# 找最近的 try:
tries=[m.start() for m in __import__('re').finditer(r"\btry\b", seg)]
print("sit 路由前 3000 字符里有 %d 个 try" % len(tries))
# 找外层 dispatch 函数名
import re
fn=re.findall(r"def (\w+)\(", seg)
print("外层函数:", fn[-2:] if fn else None)
# 找 except
i2=s.find("elif t == 'sit'")
j=s.find("\n        elif", i2+10)
print("--- sit 分支上下文 ---")
print(s[i2-200:i2+300])
