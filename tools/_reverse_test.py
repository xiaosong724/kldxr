import io,sys
sys.stdout.reconfigure(encoding="utf-8")
s=io.open("web/preview_models.html",encoding="utf-8").read().splitlines()[107]
for enc in ("gbk","gb18030","latin1"):
    try:
        print("ENC",enc, s.encode(enc,"ignore").decode("utf8","ignore")[:200])
    except Exception as e: print("ERR",enc,e)
