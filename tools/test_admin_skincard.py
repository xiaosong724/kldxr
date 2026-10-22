# -*- coding: utf-8 -*-
"""管理页发皮肤 = 发【皮肤卡】（round527）

① 不能直接解锁：skin_unlocks 里不该多一行
② 背包里多出 N 张 kind=skin 的卡
③ 玩家自己点「使用」才解锁（走 useskin）
"""
import json
import os
import random
import sqlite3
import string
import sys
import time
import urllib.request

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

ORIGIN = 'http://127.0.0.1:8899'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, 'server', 'game.db')
FAILS = 0


def ck(c, m, got=None):
    global FAILS
    if c:
        print('  PASS  ' + m)
    else:
        FAILS += 1
        print('  FAIL  ' + m + ('' if got is None else '  got=%r' % (got,)))


def api(path, body=None, admin=None):
    req = urllib.request.Request(ORIGIN + path,
                                 data=None if body is None else json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'})
    if admin:
        req.add_header('X-Admin', admin)
    return json.loads(urllib.request.urlopen(req, timeout=10).read())


def cards(rid, key='f05'):
    """★ 2026-10-22：皮肤卡现在会【堆叠】→ 张数按 stack 累加，不是按行数"""
    con = sqlite3.connect(DB, timeout=8)
    n = 0
    for (js, st) in con.execute('SELECT item_json, stack FROM items'
                                ' WHERE role_id=? AND in_storage=0', (rid,)):
        try:
            it = json.loads(js)
        except Exception:
            continue
        if it.get('kind') == 'skin' and it.get('key') == key:
            n += max(1, int(st or 1))
    con.close()
    return n


def unlocks(rid):
    con = sqlite3.connect(DB, timeout=8)
    r = [x[0] for x in con.execute('SELECT key FROM skin_unlocks WHERE role_id=?', (rid,))]
    con.close()
    return r


nm = '发卡' + ''.join(random.choices(string.ascii_lowercase, k=4))
reg = api('/api/register', {'name': nm, 'password': 'abc123456'})
rid = reg['role']['id']
at = api('/api/admin/login', {'password': 'xiuxian-admin'})['token']

print('发 3 张 f05：')
r = api('/api/admin/act', {'act': 'give', 'name': nm, 'kind': 'skin',
                           'skinKey': 'f05', 'count': 3}, admin=at)
print('   返回:', {k: r.get(k) for k in ('ok', 'cards', 'item')})
ck(r.get('ok') is True, '接口成功')
ck(r.get('cards') == 3, '返回发了 3 张卡', r.get('cards'))
ck(cards(rid, 'f05') == 3, '背包里真有 3 张 f05 卡', cards(rid, 'f05'))
ck(unlocks(rid) == [], '没有被直接解锁（skin_unlocks 为空）', unlocks(rid))

print()
print('发全部（每个 1 张）：')
r2 = api('/api/admin/act', {'act': 'give', 'name': nm, 'kind': 'skin',
                            'skinKey': '*', 'count': 1}, admin=at)
ck(r2.get('ok') is True and r2.get('cards') == 40, '全部 40 个各 1 张 = 40 张', r2.get('cards'))
ck(len(unlocks(rid)) == 0, '仍然一个都没解锁', len(unlocks(rid)))

print()
print('数量上限：传 99 应该被夹到 20')
r3 = api('/api/admin/act', {'act': 'give', 'name': nm, 'kind': 'skin',
                            'skinKey': 'f06', 'count': 99}, admin=at)
ck(r3.get('cards') == 20, '每个最多 20 张（夹住）', r3.get('cards'))

print()
if FAILS:
    print('FAILED: %d' % FAILS)
    sys.exit(1)
print('全部通过')
