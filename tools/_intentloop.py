import io,sys,re
sys.stdout.reconfigure(encoding="utf-8")
s=io.open("server/world.py",encoding="utf-8").read()
# 找 inbox 处理循环
i=s.find("def post_intent")
print(s[i:i+400])
# tick 里取消息的地方
m=re.search(r"while .*inbox|get_nowait|inbox\.get", s)
if m:
    i2=m.start()
    print("--- tick 取消息 ---")
    print(s[max(0,i2-400):i2+400])
