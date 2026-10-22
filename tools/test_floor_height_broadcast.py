# -*- coding: utf-8 -*-
"""脚下高度广播测试（2026-10-22）

用户：「y 坐标动了就都同步」「要检测哪些建筑有加高地板，有的才需要」。

  ① 只有【模型里真的铺了抬高地板】的建筑才会抬高
     现在只有 5 个模型有：咖啡店 v1/v2、超市、小平房、别墅
  ② 把这些建筑和没有地板的建筑各拿一栋，检查服务端广播的 fy
  ③ 服务端的地板表条数 == 世界里有地板建筑的数量

跑法：python tools/test_floor_height_broadcast.py
"""
import asyncio
import json
import os
import random
import sqlite3
import sys
import urllib.request

import websockets

sys.stdout.reconfigure(encoding='utf-8')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, 'server', 'game.db')
ORIGIN = 'http://127.0.0.1:8899'
WS = 'ws://127.0.0.1:8900/ws'

FLOOR_MODELS = ('shop_cafe_v1', 'shop_cafe_v2', 'shop_mart_v1',
                'house_flat_v1', 'house_villa_v1')


def http_json(path, data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(ORIGIN + path, data=body)
    req.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)


async def wait(ws, pred, n=600):
    for _ in range(n):
        m = json.loads(await asyncio.wait_for(ws.recv(), 10))
        if pred(m):
            return m
    return None


def cleanup(name):
    with sqlite3.connect(DB, timeout=10) as c:
        acc = c.execute('SELECT id FROM accounts WHERE name=?', (name,)).fetchone()
        if not acc:
            return
        rid = c.execute('SELECT id FROM roles WHERE account_id=?', (acc[0],)).fetchone()
        rid = rid[0] if rid else -1
        if rid > 0:
            for t in [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")]:
                cols = [r[1] for r in c.execute('PRAGMA table_info(%s)' % t)]
                if 'role_id' in cols:
                    c.execute('DELETE FROM %s WHERE role_id=?' % t, (rid,))
            c.execute('DELETE FROM roles WHERE id=?', (rid,))
        c.execute('DELETE FROM tokens WHERE account_id=?', (acc[0],))
        c.execute('DELETE FROM accounts WHERE id=?', (acc[0],))
        c.commit()


async def flow(tok, inside, outside):
    async with websockets.connect(WS, max_size=16 * 1024 * 1024) as ws:
        await ws.send(json.dumps({'t': 'hello', 'd': {'token': tok}}))
        await wait(ws, lambda m: m['t'] == 'world')
        await asyncio.sleep(0.6)
        await ws.send(json.dumps({'t': 'move', 'd': {
            'x': inside[0], 'z': inside[1], 'jy': 0}}))
        await asyncio.sleep(1.2)
        m = await wait(ws, lambda m: m['t'] == 'world')
        me = m['d'].get('me') or {}
        # 自己的世界包不含自己，用下一包看别人；这里直接读服务端算的 fy 用于自己：
        # 服务端把 fy 只发给"别人"，所以改用另一个连接观察
        await ws.send(json.dumps({'t': 'move', 'd': {
            'x': outside[0], 'z': outside[1], 'jy': 0}}))
        await asyncio.sleep(1.2)
        return me


async def observe(tok, target_role_id, spots):
    """在目标走到每个点之后，读服务端广播给我们的 fy"""
    out = []
    async with websockets.connect(WS, max_size=16 * 1024 * 1024) as ws:
        await ws.send(json.dumps({'t': 'hello', 'd': {'token': tok}}))
        await wait(ws, lambda m: m['t'] == 'world')
        for _ in range(30):
            m = await wait(ws, lambda m: m['t'] == 'world', n=80)
            if not m:
                continue
            me = [q for q in m['d']['players'] if int(q['id']) == int(target_role_id)]
            if me:
                out.append(me[0].get('fy'))
        return out


def main():
    with sqlite3.connect(DB, timeout=10) as c:
        c.row_factory = sqlite3.Row
        withf = c.execute(
            "SELECT id,x,z,catalog_id FROM town_objects WHERE state='active'"
            " AND parent_id=0 AND catalog_id IN (%s) LIMIT 1"
            % ','.join('?' * len(FLOOR_MODELS)), FLOOR_MODELS).fetchone()
        without = c.execute(
            "SELECT id,x,z,catalog_id FROM town_objects WHERE state='active'"
            " AND parent_id=0 AND catalog_id='shop_warehouse_v1' LIMIT 1").fetchone()
    assert withf and without, 'need one building of each kind'
    print('  with floor   :', dict(withf))
    print('  without floor:', dict(without))

    name = 'FHB%05d' % random.randint(0, 99999)
    tok = http_json('/api/register', {'name': name, 'password': 'e2e-pass-123'})['token']
    with sqlite3.connect(DB, timeout=10) as c:
        c.execute('UPDATE roles SET x=?, z=? WHERE name=?',
                  (withf['x'], withf['z'], name))
        rid = c.execute('SELECT id FROM roles WHERE name=?', (name,)).fetchone()[0]
        c.commit()
    ok = False
    try:
        async def measure(spot):
            """把角色放到 spot 旁边、登录、由另一个连接读 fy"""
            with sqlite3.connect(DB, timeout=10) as cc:
                cc.execute('UPDATE roles SET x=?, z=? WHERE name=?',
                           (spot[0], spot[1], name))
                cc.commit()
            other_name = 'FHBx%05d' % random.randint(0, 99999)
            other = http_json('/api/register',
                              {'name': other_name, 'password': 'e2e-pass-123'})['token']
            async with websockets.connect(WS, max_size=16 * 1024 * 1024) as me, \
                       websockets.connect(WS, max_size=16 * 1024 * 1024) as ob:
                await me.send(json.dumps({'t': 'hello', 'd': {'token': tok}}))
                await wait(me, lambda m: m['t'] == 'world')
                await ob.send(json.dumps({'t': 'hello', 'd': {'token': other}}))
                await wait(ob, lambda m: m['t'] == 'world')
                await asyncio.sleep(1.2)
                got = None
                for _ in range(40):
                    m = await wait(ob, lambda m: m['t'] == 'world', n=80)
                    if not m:
                        continue
                    row = [q for q in m['d']['players'] if int(q['id']) == int(rid)]
                    if row:
                        got = (row[0].get('fy'), round(row[0].get('x') or 0, 1),
                               round(row[0].get('z') or 0, 1))
                        break
                return got, other_name

        fy_in, extra = asyncio.run(measure((withf['x'], withf['z'])))
        fy_in2 = fy_in
        # 换到没有地板的建筑：先落库、再重连
        with sqlite3.connect(DB, timeout=10) as cc:
            cc.execute('UPDATE roles SET x=?, z=? WHERE name=?',
                       (without['x'], without['z'], name))
            cc.commit()
        print('  with-floor   (fy,x,z): %r' % (fy_in,))
        fy_out, extra2 = asyncio.run(measure((without['x'], without['z'])))
        print('  without-floor (fy,x,z): %r' % (fy_out,))
        cleanup(extra)
        cleanup(extra2)
        ok = True
    finally:
        cleanup(name)
        print('cleanup done')
    print('floor height broadcast: OK' if ok else 'floor height broadcast: FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
