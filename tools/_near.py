import io,sys
sys.stdout.reconfigure(encoding="utf-8")
s=io.open("web/core/town.js",encoding="utf-8").read()
lines=s.split("\n")
for n in range(55,75):
    print(n+1, lines[n][:120])
print("...")
for n in range(178,205):
    print(n+1, lines[n][:120])
