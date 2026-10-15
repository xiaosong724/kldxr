# -*- coding: utf-8 -*-
"""第 153 轮验收：魔气配置接口（管理页要用）"""
import json
import time
import urllib.request

B = 'http://127.0.0.1:8899'


def api(p, m='GET', b=None, H=None):
    d = json.dumps(b).encode() if b is not None else None
    h = {'Content-Type': 'application/json'}
    h.update(H or {})
    with urllib.request.urlopen(urllib.request.Request(B + p, data=d, headers=h, method=m),
                                timeout=8) as f:
        return json.loads(f.read().decode())


tk = api('/api/admin/login', 'POST', {'password': 'xiuxian-admin'})['token']
H = {'X-Admin': tk}
r = api('/api/admin/players?page=1&size=5', H=H)
mc = r['mobCaps'].get('mq') or {}
doc = r['mobCaps'].get('mqDoc') or []
print('  接口上报配置项：%d 项' % len(mc))
print('  说明文档：%d 条 · 第一条 = %s' % (len(doc), doc[0][1] if doc else '(无)'))
print('  默认值抽查：击杀 +%s · 被杀 -%s · 伤害 +%s%%/点（顶 %s%%）· 夺取 %s%%起（顶 %s%%）'
      % (mc.get('kill_gain'), mc.get('killed_loss'), mc.get('dmg_per_point'),
         mc.get('dmg_cap'), mc.get('steal_base'), mc.get('steal_cap')))
print('  每个玩家的魔气字段：%s' % [(p['name'], p.get('mq')) for p in r['players'][:3]])

# ★ 管理动作走 tick 线程 → 是【异步】的 ✗
#   我第一版改完立刻读 → 读到的还是旧值 ✗ 以为接口坏了 ✗
#   （浏览器那边等了 1.2 秒就对 ✓ 所以代码是好的 ✓）
api('/api/admin/act', 'POST', {'act': 'mqcfg', 'dmg_per_point': 3}, H)
time.sleep(0.6)
r2 = api('/api/admin/players?page=1&size=1', H=H)
print('  改成 3%%/点 → 回读 %s  %s' % (r2['mobCaps']['mq']['dmg_per_point'],
                                      'OK' if r2['mobCaps']['mq']['dmg_per_point'] == 3 else 'FAIL'))

api('/api/admin/act', 'POST', {'act': 'mqcfg', 'reset': 1}, H)
time.sleep(0.6)
r3 = api('/api/admin/players?page=1&size=1', H=H)
print('  恢复默认 → 回读 %s  %s' % (r3['mobCaps']['mq']['dmg_per_point'],
                                    'OK' if r3['mobCaps']['mq']['dmg_per_point'] == 1 else 'FAIL'))
