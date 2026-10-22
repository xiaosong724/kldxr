# -*- coding: utf-8 -*-
"""round489 验收：魅力榜 + 皮肤卡的地面数据 + 皮肤称号

1) /api/rank?board=charm 能返回（起服务器后才有效）
2) _loot_for 的第 8 位是物品 kind（皮肤卡 = 'skin'）
3) 皮肤称号只有【独占者】才给文本；被别人超过就自动失效
"""
import json
import os
import sqlite3
import sys
import time
import urllib.request

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'server'))
DB = os.path.join(ROOT, 'server', 'game.db')
ORIGIN = 'http://127.0.0.1:8899'
FAILS = 0


def ck(c, m, got=None):
    global FAILS
    if c:
        print('  PASS  ' + m)
    else:
        FAILS += 1
        print('  FAIL  ' + m + ('' if got is None else '  got=%r' % (got,)))


# ---------- ① 魅力榜 ----------
#   ★ 用【不带测试前缀】的名字 ✗ 否则会被 rankboard 过滤掉 ✓
import random  # noqa: E402
import string  # noqa: E402
import app as appmod  # noqa: E402
import rankboard  # noqa: E402

cfg = appmod.load_cfg()
nm = 'Charm' + ''.join(random.choices(string.ascii_lowercase, k=4))
req = urllib.request.Request(ORIGIN + '/api/register',
                             data=json.dumps({'name': nm, 'password': 'abc123456'}).encode(),
                             headers={'Content-Type': 'application/json'})
reg = json.loads(urllib.request.urlopen(req, timeout=10).read())
rid = reg['role']['id']

con = sqlite3.connect(DB, timeout=8)
# ★ 测试要可重复：先把这个皮肤的历史竞价清掉（不然前几次测试留下的 60000 会并列 ✓）
con.execute("DELETE FROM skin_bids WHERE key='f19'")
con.execute('INSERT OR REPLACE INTO skin_bids(role_id,key,total,times,at) VALUES(?,?,?,?,?)',
            (rid, 'f19', 60000, 3, int(time.time() * 1000)))
con.commit()
con.close()

rows_all = rankboard.refresh(cfg, cfg.get('test_name_keys') or [])
charm = rows_all.get('charm') or []
me = [x for x in charm if x['rid'] == rid]
ck(len(charm) >= 1, 'charm 榜算出来了', len(charm))
ck(bool(me) and me[0]['v'] == 60000, '我这条魅力 = 60000', me[:1])
ck(bool(me) and me[0]['sub'].startswith('魅力'), '榜上第二行写的是「魅力 X」', me[0]['sub'] if me else None)
ck('charm' in rankboard.KEYS, 'charm 已经是正式榜之一')

# 独占数：自己 60000，再加一个人 20000 → 60000 > 26000 → 独占 ✓
import random as _r2  # noqa: E402
nm2 = 'Charm' + ''.join(_r2.choices(string.ascii_lowercase, k=4))
req2 = urllib.request.Request(ORIGIN + '/api/register',
                              data=json.dumps({'name': nm2, 'password': 'abc123456'}).encode(),
                              headers={'Content-Type': 'application/json'})
reg2 = json.loads(urllib.request.urlopen(req2, timeout=10).read())
rid2 = reg2['role']['id']
con = sqlite3.connect(DB, timeout=8)
con.execute('INSERT OR REPLACE INTO skin_bids(role_id,key,total,times,at) VALUES(?,?,?,?,?)',
            (rid2, 'f19', 20000, 1, int(time.time() * 1000)))
con.commit()
con.close()
rows2 = rankboard.refresh(cfg, cfg.get('test_name_keys') or []).get('charm') or []
me2 = [x for x in rows2 if x['rid'] == rid]
ck(bool(me2) and me2[0].get('solo') == 1, '独占数 = 1（60000 > 20000×1.3）', me2[:1])
ck(bool(me2) and '独占 1 个' in me2[0]['sub'], '榜上第二行带「独占 1 个」', me2[0]['sub'] if me2 else None)

# ---------- ② 地面掉落第 8 位 = kind ----------
import world as W  # noqa: E402
import skins as skinsmod  # noqa: E402


class P:
    x = 0.0
    z = 0.0


w = W.World.__new__(W.World)
w.loot = {
    '1': {'x': 0.5, 'z': 0.2, 'ttl': 30,
          'item': {'name': '皮肤·狐仙', 'tier': 0, 'kind': 'skin', 'key': 'f13'}},
    '2': {'x': 1.0, 'z': 0.4, 'ttl': 30,
          'item': {'name': '破布', 'tier': 0, 'kind': 'material'}},
}
arr = w._loot_for(P())
ck(arr is not None and len(arr) == 2, '拿得到两件掉落')
skin_row = [x for x in arr if x[7] == 'skin']
ck(len(skin_row) == 1, '皮肤卡那件第 8 位是 skin', [x[7] for x in arr])
ck(skin_row and skin_row[0][3].startswith('皮肤·'), '名字是"皮肤·XXX"', skin_row[0][3] if skin_row else None)

# ---------- ③ 皮肤称号 ----------
w2 = W.World.__new__(W.World)
w2.cfg = {}
w2._skin_bids = {'f13': {101: 99999, 102: 20000}}
w2.players = {}


class R:
    role_id = 101
    titleBoard = 'skin:f13'
    name = '甲'


class R2:
    role_id = 102
    titleBoard = 'skin:f13'
    name = '乙'


r = R()
r2 = R2()
ck(w2._title_of(r) == ('独·狐仙', 0), '独占者拿到「独·狐仙」', w2._title_of(r))
ck(w2._title_of(r2) == ('', 0), '非独占者没有称号', w2._title_of(r2))

# 被反超 → 自动失效
w2._skin_bids['f13'][102] = 200000
ck(w2._title_of(r) == ('', 0), '被超过后称号立刻失效', w2._title_of(r))
ck(w2._title_of(r2) == ('独·狐仙', 0), '新的独占者拿到称号', w2._title_of(r2))

# 非皮肤称号不受影响
r.titleBoard = 'level'
ck(w2._title_of(r) == ('', 0), '没进前 100 的普通称号仍然是空（rank_map 空）')

print()
if FAILS:
    print('FAILED: %d' % FAILS)
    sys.exit(1)
print('全部通过')
