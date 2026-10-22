import sqlite3
c = sqlite3.connect('/opt/xiuxian2d/server/game.db')
pat = ('测试云%', '测试查%', '测试截%')
n = 0
for p in pat:
    for r in c.execute('select id from roles where name like ?', (p,)).fetchall():
        c.execute('delete from role_stats where role_id=?', (r[0],))
    for a in c.execute('select id from accounts where name like ?', (p,)).fetchall():
        n += 1
        c.execute('delete from roles where account_id=?', (a[0],))
        c.execute('delete from accounts where id=?', (a[0],))
c.commit()
print('deleted accounts:', n)
print('roles now:', c.execute('select count(*) from roles').fetchone()[0])
print('role_stats rows:', c.execute('select count(*) from role_stats').fetchone()[0])
print('schema:', c.execute("select v from meta where k='schema_version'").fetchone())
print('title_board col:', 'title_board' in [x[1] for x in c.execute('PRAGMA table_info(roles)')])
print('top3:', c.execute('select name,level from roles order by level desc limit 3').fetchall())
