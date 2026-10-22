import io,sys
sys.stdout.reconfigure(encoding="utf-8")
s=io.open("server/auth.py",encoding="utf-8").read()
i=s.find("def _check_name")
print(s[i:i+400])
