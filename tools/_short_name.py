import io
p="tools/_test_place_flow.js"
s=io.open(p,encoding="utf-8").read()
s=s.replace("const NAME = 'placement' + Math.floor(Math.random() * 100000);",
            "const NAME = 'p' + Math.floor(Math.random() * 100000000).toString(36).slice(0,8);")
io.open(p,"w",encoding="utf-8",newline="\n").write(s)
print("short name")
