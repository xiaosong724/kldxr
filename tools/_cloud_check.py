# -*- coding: utf-8 -*-
"""云端核对：schema 版本 / 数据条数 / 新表 / 真玩家能不能读（放到云端跑 ✓）

★ 为什么写成文件传上去跑：
  用 ssh 传一段带引号的 python 单行命令 ✗ 引号转义一层套一层必然出错 ✓
  （这一轮我已经在引号上栽了两次 ✗ 直接把脚本传上去最省事 ✓）
"""
import sqlite3
import json
import os

DB = '/opt/xiuxian2d/server/game.db'
COPY = '/home/ubuntu/check.db'


def q(sql, args=()):
    c = sqlite3.connect(COPY)
    try:
        return c.execute(sql, args).fetchall()
    finally:
        c.close()


c = sqlite3.connect(COPY)
v = c.execute('PRAGMA user_version').fetchone()[0]
roles = c.execute('SELECT COUNT(*) FROM roles').fetchone()[0]
lv = c.execute('SELECT COUNT(*) FROM roles WHERE level>1').fetchone()[0]
items = c.execute('SELECT COUNT(*) FROM items').fetchone()[0]
tabs = sorted(r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'"))
c.close()

print('schema   v%s' % v)
print('roles    %s  (lv>1: %s)' % (roles, lv))
print('items    %s' % items)
for t in ('skill_pages', 'role_skills', 'teams', 'talents', 'equipment', 'accounts'):
    if t in tabs:
        print('%-10s %s' % (t, q('SELECT COUNT(*) FROM "%s"' % t)[0][0]))
print('new tables: %s' % [x for x in ('listings', 'trade_log', 'pending_gold') if x in tabs])

# 真玩家：等级 / 物品数 / 装备
print()
print('真玩家（等级最高的 6 个）:')
for rid, nm, lvl in q('SELECT id, name, level FROM roles ORDER BY level DESC LIMIT 6'):
    n = q('SELECT COUNT(*) FROM items WHERE role_id=?', (rid,))[0][0]
    eq = q('SELECT COUNT(*) FROM equipment WHERE role_id=?', (rid,))[0][0]
    print('   %-14s lv%-4s items=%-5s equip=%s' % (nm, lvl, n, eq))

# 每个角色的物品 JSON 能不能解析（迁移后最容易出问题的地方）
bad = 0
sample = 0
import json as _json
c = sqlite3.connect(COPY)
for (js,) in c.execute('SELECT item_json FROM items LIMIT 400'):
    sample += 1
    try:
        _json.loads(js)
    except Exception:
        bad += 1
c.close()
print()
print('物品 JSON 抽查 %s 条 ✗ 解析失败 %s 条 %s' % (sample, bad, 'OK' if bad == 0 else '★ 有问题'))
print('VERDICT: %s' % ('OK' if (v == 7 and bad == 0 and roles >= 122) else 'PROBLEM'))
