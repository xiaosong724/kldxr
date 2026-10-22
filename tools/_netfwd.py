import io,sys
sys.stdout.reconfigure(encoding="utf-8")
s=io.open("server/net.py",encoding="utf-8").read()
i=s.find("async def on_message")
j=s.find("world.post_intent", i)
# 找默认分支（消息转给 world 的通用路径）
seg=s[i:i+3000]
import re
# 找 "else:" 后的 post_intent
for m in re.finditer(r"post_intent\(conn\.cid, t", seg):
    print("generic forward at offset", m.start())
    print(seg[max(0,m.start()-500):m.start()+100])
    break
