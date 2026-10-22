import io,sys
sys.stdout.reconfigure(encoding="utf-8")
s=io.open("server/world.py",encoding="utf-8").read()
i=s.find("elif t == 'sit'")
print(s[i:i+200])
print()
# 找 SEAT_USE_R
import re
for m in re.finditer(r"SEAT_USE_R\s*=\s*[\d.]+", s):
    print(m.group(0))
# 确认 _seat_sit 里的距离条件
i2=s.find("town.SEAT_USE_R * town.SEAT_USE_R")
print("dist check:", s[i2-80:i2+40])
