# -*- coding: utf-8 -*-
"""第 158 轮验收：魔气配置存库（重启后还在吗）

流程：起服务器 → 改配置 → 读回 → 重启服务器 → 再读回 → 恢复默认 → 重启 → 再读回
★ 这是"持久化"唯一靠谱的验法 ✓ 光看代码不算 ✓
"""
import json
import subprocess
import sqlite3
import sys
import time
import urllib.request

B = 'http://127.0.0.1:8899'
SRV = 'C:/mc/xiuxian-2d/server'


def api(p, m='GET', b=None, H=None):
    d = json.dumps(b).encode() if b is not None else None
    h = {'Content-Type': 'application/json'}
    h.update(H or {})
    with urllib.request.urlopen(urllib.request.Request(B + p, data=d, headers=h, method=m),
                                timeout=10) as f:
        return json.loads(f.read().decode())


def token():
    return api('/api/admin/login', 'POST', {'password': 'xiuxian-admin'})['token']


def cfg_now():
    r = api('/api/admin/players?page=1&size=1', H={'X-Admin': token()})
    return r['mobCaps']['mq']


def restart():
    subprocess.run(['powershell', '-Command',
                    "$c = Get-NetTCPConnection -LocalPort 8899 -State Listen "
                    "-ErrorAction SilentlyContinue; if ($c) { $c.OwningProcess | "
                    "Select-Object -Unique | ForEach-Object { taskkill /PID $_ /T /F "
                    "2>&1 | Out-Null } }"], capture_output=True)
    time.sleep(1.2)
    subprocess.Popen(['python', 'app.py'], cwd=SRV,
                     stdout=open('C:/Users/49553/AppData/Local/Temp/srv2.log', 'w'),
                     stderr=subprocess.STDOUT)
    for _ in range(30):
        time.sleep(0.5)
        try:
            api('/api/health')
            return True
        except Exception:
            pass
    return False


ok = [0]
bad = [0]


def check(cond, msg):
    print(('  PASS  ' if cond else '  FAIL  ') + msg)
    (ok if cond else bad)[0] += 1


print('魔气配置持久化验收')
print('=' * 58)
# ★ 先重启一次：保证跑的是【刚改完的代码】✗
#   （我上一版就是没重启 → 头两步测的是旧进程 → 白忙一场 ✓）
print('  --- 先重启，确保跑的是新代码 ---')
check0 = restart()
print('     重启：%s' % ('OK' if check0 else 'FAIL'))
# ② 顺手把上次探测留下的配置清掉（保证从默认值开始 ✓）
api('/api/admin/act', 'POST', {'act': 'mqcfg', 'reset': 1}, H={'X-Admin': token()})
time.sleep(0.5)
c0 = cfg_now()
check(abs(float(c0['dmg_per_point']) - 1.0) < 1e-9, '起始是默认值（每点 +1%% 伤害）')

# ① 改两项
api('/api/admin/act', 'POST', {'act': 'mqcfg', 'dmg_per_point': 2.5, 'steal_cap': 22}, H={'X-Admin': token()})
time.sleep(0.5)
c1 = cfg_now()
check(abs(float(c1['dmg_per_point']) - 2.5) < 1e-9, '改成 2.5 → 立刻读到 2.5（%s）' % c1['dmg_per_point'])
check(abs(float(c1['steal_cap']) - 22) < 1e-9, '改成 22 → 立刻读到 22（%s）' % c1['steal_cap'])

# ② 库里存了什么（应该只有这两项 ✓ 默认值不存 ✓）
# ★ 重新开连接再读 ✗ 之前那个连接是在写入前开的 → 读到旧快照 ✗
#   （这是我上一版第二个坑：值明明写进去了，测试却读到空的 ✓）
c = sqlite3.connect('C:/mc/xiuxian-2d/server/game.db')
row = c.execute("SELECT v FROM meta WHERE k='mq_tune'").fetchone()
saved = json.loads(row[0]) if row else {}
print('     库里存的：%s' % json.dumps(saved, ensure_ascii=False))
check(len(saved) == 2 and 'dmg_per_point' in saved and 'steal_cap' in saved,
      '★ 只存了改过的 2 项（默认值不占地方，以后改默认值不会被顶回去）')

# ③ 重启 → 还在吗
print('  --- 重启服务器 ---')
check(restart(), '服务器重启成功')
c2 = cfg_now()
check(abs(float(c2['dmg_per_point']) - 2.5) < 1e-9, '★ 重启后依然是 2.5（%s）' % c2['dmg_per_point'])
check(abs(float(c2['steal_cap']) - 22) < 1e-9, '★ 重启后依然是 22（%s）' % c2['steal_cap'])

# ④ 恢复默认 → 重启 → 应该是默认值
api('/api/admin/act', 'POST', {'act': 'mqcfg', 'reset': 1}, H={'X-Admin': token()})
time.sleep(0.5)
c3 = cfg_now()
check(abs(float(c3['dmg_per_point']) - 1.0) < 1e-9, '恢复默认 → 1.0（%s）' % c3['dmg_per_point'])
c2 = sqlite3.connect('C:/mc/xiuxian-2d/server/game.db')
row2 = c2.execute("SELECT v FROM meta WHERE k='mq_tune'").fetchone()
check(row2 is None, '★ 恢复默认后库里那行被删掉了（重启也不会回来）')

print('  --- 再重启一次 ---')
check(restart(), '服务器重启成功')
c4 = cfg_now()
check(abs(float(c4['dmg_per_point']) - 1.0) < 1e-9, '★ 重启后还是默认 1.0（%s）' % c4['dmg_per_point'])
check(abs(float(c4['steal_cap']) - 15.0) < 1e-9, '★ 夺取上限也回到默认 15（%s）' % c4['steal_cap'])

print('=' * 58)
print('%d 项通过 · %d 项失败' % (ok[0], bad[0]))
sys.exit(1 if bad[0] else 0)
