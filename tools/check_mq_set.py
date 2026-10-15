# -*- coding: utf-8 -*-
"""第 155 轮验收：设魔气 → 内存 → 库 → 列表（端到端）"""
import json, time, urllib.request, urllib.parse, sqlite3
B = 'http://127.0.0.1:8899'
def api(p, m='GET', b=None, H=None):
    d = json.dumps(b).encode() if b is not None else None
    h = {'Content-Type': 'application/json'}; h.update(H or {})
    with urllib.request.urlopen(urllib.request.Request(B+p, data=d, headers=h, method=m), timeout=8) as f:
        return json.loads(f.read().decode())
ok = [0]; bad = [0]
tk = api('/api/admin/login', 'POST', {'password': 'xiuxian-admin'})['token']
H = {'X-Admin': tk}
pl = api('/api/admin/players?page=1&size=20', H=H)
online = [p['name'] for p in pl['players'] if p['online']]
print('  在线：%s' % online)
for nm, v in ((online[0] if online else 'x', 350), (online[1] if len(online) > 1 else 'y', 60)):
    api('/api/admin/act', 'POST', {'act': 'mqset', 'name': nm, 'v': v}, H)
    time.sleep(0.9)
    w = api('/api/admin/who?name=' + urllib.parse.quote(nm), H=H).get('who') or {}
    good = (w.get('mq') == v)
    (ok if good else bad)[0] += 1
    print('  %s 设 %s → 内存 mq=%s  %s' % (nm, v, w.get('mq'), 'OK' if good else 'FAIL'))
c = sqlite3.connect('server/game.db')
for r in c.execute('SELECT name, mq FROM roles WHERE mq > 0'):
    print('  库里 %s = %s  %s' % (r[0], r[1], 'OK' if r[1] > 0 else 'FAIL'))
r = api('/api/admin/players?page=1&size=3', H=H)
print('  列表回读：%s' % [(p['name'], p['mq']) for p in r['players'][:3]])
print('%d 项通过 · %d 项失败' % (ok[0], bad[0]))
