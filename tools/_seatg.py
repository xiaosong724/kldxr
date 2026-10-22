import io,sys
sys.stdout.reconfigure(encoding="utf-8")
s=io.open("web/core/game.js",encoding="utf-8").read()
lines=s.split("\n")
for n in range(185,220):
    print(n+1, lines[n][:110])
