import io,sys,re
sys.stdout.reconfigure(encoding="utf-8")
s=io.open("server/ws.py",encoding="utf-8").read()
# 找 world.inbox / put / 推送消息的地方
for m in re.finditer(r"inbox|world\.|intent", s):
    ln=s[:m.start()].count("\n")+1
    ln_txt=s.split("\n")[ln-1].strip()
    print(ln, ln_txt[:100])
