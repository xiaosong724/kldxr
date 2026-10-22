import io,sys
sys.stdout.reconfigure(encoding="utf-8")
s=io.open("server/world.py",encoding="utf-8").read()
lines=s.split("\n")
for n in range(1643,1680):
    print(n+1, lines[n][:110])
