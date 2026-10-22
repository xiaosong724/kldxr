# -*- coding: utf-8 -*-
"""round414：上锁必须扛得住【重启】和【耐久落库】

用户："上锁了两个装备，重启服务器后上锁状态就没了"

两条路都要验：
  ① db.startup_unlock_items —— 启动时只能清 locked_by，不能清玩家的 locked
  ② 装备穿在身上时，耐久落库会把 p.weapon / p.armor 整份写回库
     → 那两份副本必须也带 locked（不然锁被旧副本盖掉）
跑法：python tools\\test_lock_persist.py
"""
import json
import os
import sqlite3
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
sys.path.insert(0, os.path.join(_ROOT, 'server'))

import db as dbmod          # noqa: E402
import world as W           # noqa: E402
import auth as authmod      # noqa: E402

FAILS = []


def _load_cfg():
    """读 server/config.json（和服务启动时同一份 ✗ 不自己猜路径 ✓）"""
    import json as _j
    here = os.path.join(_ROOT, 'server')
    with open(os.path.join(here, 'config.json'), encoding='utf-8') as f:
        cfg = _j.load(f)
    cfg['db'] = cfg['db'].replace('${HERE}', here)
    return cfg


CFG = _load_cfg()


def ok(cond, msg, got=None):
    if cond:
        print('  PASS  ' + msg)
    else:
        FAILS.append(msg)
        print('  FAIL  ' + msg + ('   got=%r' % (got,)))


def mkp(rid, name, x=200.0, z=200.0):
    p = W.Player('c%d' % rid, {'id': rid, 'name': name, 'level': 30, 'hp': 500,
                               'qi': 0, 'x': x, 'z': z, 'yaw': 0, 'hpMax': 500,
                               'account_id': rid})
    p.hp = 500
    return p


print('== ① 启动清理只能清 locked_by（不能清玩家的 locked）==')
# 找一个已经存在的角色 id 来建测试物品（不建新角色 ✗ 免得污染）
with dbmod.db(CFG) as c:
    row = c.execute('SELECT id FROM roles ORDER BY id LIMIT 1').fetchone()
    if not row:
        print('  （数据库里没有角色，跳过这条）')
        RID = None
    else:
        RID = int(row[0])
if RID:
    with dbmod.db(CFG) as c:
        it1 = {'name': '__LOCKTEST_keep', 'slot': 'weapon', 'tier': 1,
               'itemLv': 1, 'locked': 1}
        it2 = {'name': '__LOCKTEST_drop', 'slot': 'weapon', 'tier': 1,
               'itemLv': 1, 'locked_by': 999}
        cur = c.execute(
            'INSERT INTO items(role_id,in_storage,stack,item_json,created_at)'
            ' VALUES(?,?,?,?,?)', (RID, 0, 1, json.dumps(it1, ensure_ascii=False), 1))
        id1 = int(cur.lastrowid)
        cur = c.execute(
            'INSERT INTO items(role_id,in_storage,stack,item_json,created_at)'
            ' VALUES(?,?,?,?,?)', (RID, 0, 1, json.dumps(it2, ensure_ascii=False), 1))
        id2 = int(cur.lastrowid)
        c.commit()
    n = dbmod.startup_unlock_items(CFG)
    print('   启动清理清掉了 %d 行' % n)
    with dbmod.db(CFG) as c:
        j1 = c.execute('SELECT item_json FROM items WHERE id=?', (id1,)).fetchone()[0]
        j2 = c.execute('SELECT item_json FROM items WHERE id=?', (id2,)).fetchone()[0]
        c.execute('DELETE FROM items WHERE id IN (?,?)', (id1, id2))
        c.commit()
    d1, d2 = json.loads(j1), json.loads(j2)
    print('   玩家的锁: locked=%r · 上架残留: locked_by=%r'
          % (d1.get('locked'), d2.get('locked_by')))
    ok(d1.get('locked') == 1, '★★ 启动后【玩家的锁还在】（重启不丢 ✓）', d1)
    ok(d2.get('locked_by') is None, '★ 启动后【上架残留的 locked_by 被清掉】（老规矩 ✓）',
       d2)

print('')
print('== ② 穿在身上的装备：耐久落库不能把锁盖掉 ==')
w = W.World(None)
SENT = []
w._send_cid = lambda c, r: SENT.append((c, r))
p = mkp(1, 'A')
# 造一件"穿在身上的武器"（内存里两份副本：p.weapon 和 p.role['bag']）
wp = {'slot': 'weapon', 'look': 'sword', 'tier': 3, 'itemLv': 10, 'dur': 500,
      'durMax': 500, 'name': '测试剑', 'affixes': []}
p.weapon = dict(wp)
p.weaponItemId = 777001
p.wDur, p.wDurMax = 500, 500
p.role['bag'] = [{'id': 777001, 'stack': 1, 'item': dict(wp)}]
w.players[p.cid] = p
# 上锁（走真实意图）
w._handle_intent(p, 'baglock', {'iid': 777001, 'lock': 1})
print('   上锁后：p.weapon.locked=%r · 背包那份 locked=%r'
      % (p.weapon.get('locked'), p.role['bag'][0]['item'].get('locked')))
ok(p.weapon.get('locked') == 1,
   '★★ 穿在身上的那份也上了锁（两份副本同步 ✓）', p.weapon.get('locked'))
ok(p.role['bag'][0]['item'].get('locked') == 1, '★ 背包快照那份也锁了 ✓')
# 现在模拟"耐久落库"——它写的就是 p.weapon 这一份
_sql = []
w.post_save = lambda sql, params=(): _sql.append((sql, params))
p.wDur = 480
p.wDurDirty = 5          # ★ _flush_dur 只有「攒够了才写」✗ 不置这个它直接 return ✓
w._flush_dur(p)
_written = None
for s, prm in _sql:
    if 'item_json' in s:
        _written = json.loads(prm[0])
print('   耐久落库写进去的 locked=%r（dur=%r）'
      % ((_written or {}).get('locked'), (_written or {}).get('dur')))
ok((_written or {}).get('locked') == 1,
   '★★ 耐久落库整份写回时【锁还在】（不然打几刀锁就没了 ✓）', _written)
ok((_written or {}).get('dur') == 480, '★ 耐久照常写进去了（没把这块改坏 ✓）',
   (_written or {}).get('dur'))

print('')
print('== ③ 解锁后也要同步（不然落库时锁又被写回去）==')
_sql.clear()
w._handle_intent(p, 'baglock', {'iid': 777001, 'lock': 0})
w._flush_dur(p)
_w2 = None
for s, prm in _sql:
    if 'item_json' in s:
        _w2 = json.loads(prm[0])
print('   解锁后落库写的 locked=%r' % ((_w2 or {}).get('locked'),))
ok((_w2 or {}).get('locked') is None, '★★ 解锁后落库不再带锁 ✓', _w2)

print('')
if FAILS:
    print('FAILED: %d 条 ✗' % len(FAILS))
    for f in FAILS:
        print('  - ' + f)
    sys.exit(1)
print('ALL PASS ✓')
