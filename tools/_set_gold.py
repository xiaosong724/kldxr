import sys
import sqlite3

name = sys.argv[1]
amount = int(sys.argv[2])
c = sqlite3.connect('server/game.db')
c.execute('UPDATE roles SET gold=? WHERE name=?', (amount, name))
c.commit()
c.close()
print('set', name, amount)
