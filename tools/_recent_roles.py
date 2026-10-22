import sys,os
sys.path.insert(0,'server')
import db
cfg={'db':os.path.join('server','game.db')}
with db.db(cfg) as c:
    rows=c.execute("SELECT id,name,gold FROM roles ORDER BY id DESC LIMIT 5").fetchall()
    for r in rows: print(tuple(r))
