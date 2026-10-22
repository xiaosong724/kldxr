import io,sys
sys.stdout.reconfigure(encoding="utf-8")
s=io.open("server/net.py",encoding="utf-8").read()
i=s.find("async def on_message")
j=s.find("async def ", i+10)
seg=s[i:j if j>0 else i+12000]
# 打印所有 post_intent 调用及其上下文 60 字符
import re
for m in re.finditer(r"post_intent\(([^\n]{0,90})", seg):
    print(m.group(1))
