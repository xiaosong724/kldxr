import io,sys
sys.stdout.reconfigure(encoding="utf-8")
s=io.open("server/world.py",encoding="utf-8").read()
lines=s.split("\n")
for n in range(725,790):
    print(n+1, lines[n][:110])
