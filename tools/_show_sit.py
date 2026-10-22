import io,sys
sys.stdout.reconfigure(encoding="utf-8")
s=io.open("server/world.py",encoding="utf-8").read()
i=s.find("    def _seat_sit(self, p, d):")
j=s.find("    def _seat_stand", i)
print(s[i:j])
