# -*- coding: utf-8 -*-
"""重新应用本轮服务端改动 · 第 3 部分"""
import io

p = 'server/world.py'
s = io.open(p, encoding='utf-8').read()
ok = []


def rep(old, new, tag):
    global s
    if old not in s:
        print('!! MISSING', tag)
        return False
    s = s.replace(old, new, 1)
    ok.append(tag)
    return True


rep("""                 'jy')   # 第 173 轮：传送读条结束时刻（0 = 没在读条）      # ★ 第 168 轮（用户 #5）：离线宽限的时刻 ✓""",
    """                 'jy',
                 'seat', 'tpEnd',
                 'sleepHouse', 'sleepAcc',
                 'job', 'jobShop', 'jobT', 'jobAcc')""", 'slots')

rep("""        self.gold = int(role.get('gold') or 0)
        self.goldDirty = False""",
    """        self.gold = int(role.get('gold') or 0)
        self.goldDirty = False
        self.seat = -1
        self.tpEnd = 0.0
        self.sleepHouse = ''
        self.sleepAcc = 0.0
        self.job = ''
        self.jobShop = ''
        self.jobT = 0.0
        self.jobAcc = 0.0""", 'fields')

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('part3:', ok)
