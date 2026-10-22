# -*- coding: utf-8 -*-
"""round419：管理页的设置必须扛得住重启

用户："配置页面以下功能，每次重启服务器后就恢复默认了，我需要他是可以保存的"

病根：`_admin_tune_save` 只存了 mob_cap ✗
      「每人上限 mob_per_player」「补怪间隔 spawn_interval」根本没进 blob ✓
      → 全服上限 23 留下了，每人 8 / 间隔 2 每次重启都回默认 ✓✓

跑法：python tools\\test_admin_persist.py
★ 会临时改 meta.admin_tune，跑完【原样还原】✓
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

import world as W          # noqa: E402
import app as APPMOD       # noqa: E402
import db as dbmod         # noqa: E402

FAILS = []


def ok(cond, msg, got=None):
    if cond:
        print('  PASS  ' + msg)
    else:
        FAILS.append(msg)
        print('  FAIL  ' + msg + ('   got=%r' % (got,)))


def cfg():
    with open(os.path.join(_ROOT, 'server', 'config.json'), encoding='utf-8') as f:
        c = json.load(f)
    c['db'] = c['db'].replace('${HERE}', os.path.join(_ROOT, 'server'))
    return c


C = cfg()
KEY = 'admin_tune'

print('== 备份 meta.admin_tune ==')
with dbmod.db(C) as c:
    row = c.execute('SELECT v FROM meta WHERE k=?', (KEY,)).fetchone()
    old = row[0] if row else None
print('   旧值: %s' % (str(old)[:120]))

try:
    print('')
    print('== ① 存：三个刷怪参数都要进 admin_tune ==')
    w = W.World(None)
    w._send_cid = lambda c, r: None
    w._broadcast = lambda text: None
    w.mob_per_player = 13
    w.spawn_interval = 3.5
    w.mob_cap = 77
    w.pvp_all = True
    w.mob_atk_all = False
    w.qq_on = False
    cap = []
    w.post_save = lambda sql, params=(): cap.append((sql, params))
    w._admin_tune_save()
    print('   排队落库 %d 条' % len(cap))
    blob = None
    for sql, params in cap:
        if 'meta' in sql and params and params[0] == KEY:
            blob = params[1]
    print('   blob: %s' % (str(blob)[:200],))
    d = json.loads(blob or '{}')
    ok(d.get('mob_per') == 13, '★★ 每人上限被存下来了（以前根本没存 ✓）', d.get('mob_per'))
    ok(abs(float(d.get('spawn_interval') or 0) - 3.5) < 1e-6,
       '★★ 补怪间隔被存下来了（以前根本没存 ✓）', d.get('spawn_interval'))
    ok(d.get('mob_cap') == 77, '★ 全服上限照旧存 ✓', d.get('mob_cap'))
    ok(d.get('qq_on') is False, '★ QQ 转发开关照旧存 ✓', d.get('qq_on'))

    # ★ 真的写进库（模拟存档线程）
    with dbmod.db(C) as c:
        c.execute('INSERT OR REPLACE INTO meta(k, v) VALUES(?, ?)', (KEY, blob))
        c.commit()

    print('')
    print('== ② 重启 → _load_admin_tune 把三样都读回来 ==')
    w2 = W.World(None)
    APPMOD._load_admin_tune(w2, C)
    print('   读回：每人 %s 只 · 全服 %s 只 · 每 %s 秒 · PVP %s · 妖兽 %s · QQ %s'
          % (w2.mob_per_player, w2.mob_cap, w2.spawn_interval,
             w2.pvp_all, w2.mob_atk_all, w2.qq_on))
    ok(w2.mob_per_player == 13, '★★ 每人上限重启后还在（不再变回 8 ✓）', w2.mob_per_player)
    ok(abs(w2.spawn_interval - 3.5) < 1e-6, '★★ 补怪间隔重启后还在（不再变回 2 ✓）',
       w2.spawn_interval)
    ok(w2.mob_cap == 77, '★ 全服上限重启后还在 ✓', w2.mob_cap)
    ok(w2.pvp_all is True and w2.mob_atk_all is False, '★ PVP / 妖兽伤害开关照旧 ✓',
       (w2.pvp_all, w2.mob_atk_all))
    ok(w2.qq_on is False, '★ QQ 转发开关照旧 ✓', w2.qq_on)

    print('')
    print('== ③ 指纹要能发现这三样变了（发现了才会触发保存）==')
    w3 = W.World(None)
    w3._send_cid = lambda c, r: None
    w3._broadcast = lambda text: None
    w3.post_save = lambda sql, params=(): cap.append((sql, params))
    w3._admin_tune_check()          # 第一次：只记指纹 ✓
    _sig0 = w3._tune_sig
    w3.mob_per_player = 15          # 改一个
    w3._admin_tune_check()
    print('   改 per 之后指纹变了吗: %s' % (w3._tune_sig != _sig0))
    ok(w3._tune_sig != _sig0, '★★ 改「每人上限」会被指纹发现 → 自动排队保存 ✓',
       (_sig0[0], w3._tune_sig[0]))
    w3.spawn_interval = 4.0
    _sig1 = w3._tune_sig
    w3._admin_tune_check()
    ok(w3._tune_sig != _sig1, '★★ 改「补怪间隔」也会被发现 ✓', _sig1[1])
finally:
    print('')
    print('== 还原 meta.admin_tune ==')
    with dbmod.db(C) as c:
        if old is None:
            c.execute('DELETE FROM meta WHERE k=?', (KEY,))
        else:
            c.execute('INSERT OR REPLACE INTO meta(k, v) VALUES(?, ?)', (KEY, old))
        c.commit()
    print('   已还原：%s' % (str(old)[:80],))

print('')
if FAILS:
    print('FAILED: %d 条 ✗' % len(FAILS))
    for f in FAILS:
        print('  - ' + f)
    sys.exit(1)
print('ALL PASS ✓')
