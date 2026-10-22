import io,sys,re
sys.stdout.reconfigure(encoding="utf-8")
s=io.open("server/world.py",encoding="utf-8").read()
# 找 _step 里处理 intent 的地方
i=s.find("def _step")
j=s.find("def ", i+10)
seg=s[i:s.find("\n    def _step", i+10)+50000]
# 找 ('intent'
m=re.search(r"== 'intent'", seg)
if m:
    i2=seg.index("== 'intent'")
    print(seg[max(0,i2-500):i2+800])
