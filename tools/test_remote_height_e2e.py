# -*- coding: utf-8 -*-
"""别人的高度也要跟着室内地板（2026-10-22）

用户：「我们不是调整了建筑的地板高度吗，这个进建筑后其他玩家的高度也没有同步」。

  ① A 站到某栋建筑的室内
  ② B（浏览器）看到 A 的模型 y ≈ 0.28（室内地板），不是 0
  ③ A 走到室外，B 看到的 y 回到 0

跑法：python tools/test_remote_height_e2e.py
"""
import asyncio
import json
import os
import random
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request

import websockets

sys.stdout.reconfigure(encoding='utf-8')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, 'server', 'game.db')
ORIGIN = 'http://127.0.0.1:8899'
WS = 'ws://127.0.0.1:8900/ws'
CHROME = next((p for p in (
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe') if os.path.exists(p)), None)


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


class CDP:
    def __init__(self, ws):
        self.ws = ws
        self.seq = 0

    async def send(self, method, params=None):
        self.seq += 1
        mid = self.seq
        await self.ws.send(json.dumps({'id': mid, 'method': method, 'params': params or {}}))
        while True:
            m = json.loads(await asyncio.wait_for(self.ws.recv(), 30))
            if m.get('id') == mid:
                return m

    async def ev(self, expr):
        r = await self.send('Runtime.evaluate', {
            'expression': '(function(){' + expr + '})()',
            'returnByValue': True, 'awaitPromise': True})
        res = r.get('result', {})
        if 'exceptionDetails' in res:
            raise RuntimeError('JS %r' % (res['exceptionDetails'],))
        return (res.get('result') or {}).get('value')


def cleanup(names):
    with sqlite3.connect(DB, timeout=10) as c:
        for name in names:
            acc = c.execute('SELECT id FROM accounts WHERE name=?', (name,)).fetchone()
            if not acc:
                continue
            rid = c.execute('SELECT id FROM roles WHERE account_id=?', (acc[0],)).fetchone()
            rid = rid[0] if rid else -1
            if rid > 0:
                for t in [r[0] for r in c.execute(
                        "SELECT name FROM sqlite_master WHERE type='table'")]:
                    cols = [r[1] for r in c.execute('PRAGMA table_info(%s)' % t)]
                    if 'role_id' in cols:
                        c.execute('DELETE FROM %s WHERE role_id=?' % t, (rid,))
                c.execute('DELETE FROM roles WHERE id=?', (rid,))
            c.execute('DELETE FROM tokens WHERE account_id=?', (acc[0],))
            c.execute('DELETE FROM accounts WHERE id=?', (acc[0],))
        c.commit()


async def actor(tok, spot_inside, spot_outside, snap):
    async with websockets.connect(WS, max_size=16 * 1024 * 1024) as ws:
        await ws.send(json.dumps({'t': 'hello', 'd': {'token': tok}}))
        await wait(ws, lambda m: m['t'] == 'world')
        await asyncio.sleep(0.5)
        # 先在室外站一会，再走进室内（这样观察者能看出高度变化）
        await ws.send(json.dumps({'t': 'move', 'd': {
            'x': spot_outside[0], 'z': spot_outside[1], 'jy': 0}}))
        snap['ready'] = True
        await asyncio.sleep(3.0)
        snap['inside'] = True
        await ws.send(json.dumps({'t': 'move', 'd': {
            'x': spot_inside[0], 'z': spot_inside[1], 'jy': 0}}))
        await asyncio.sleep(3.0)


def main():
    if not CHROME:
        print('no chrome'); return 2
    with sqlite3.connect(DB, timeout=10) as c:
        c.row_factory = sqlite3.Row
        bld = c.execute("SELECT id,x,z,catalog_id FROM town_objects"
                        " WHERE state='active' AND parent_id=0"
                        " AND catalog_id IN ('shop_cafe_v1','shop_cafe_v2') LIMIT 1").fetchone()
    assert bld, 'no building'
    inside = (bld['x'], bld['z'])
    outside = (bld['x'] + 18.0, bld['z'])
    names = ['HGA%05d' % random.randint(0, 99999), 'HGB%05d' % random.randint(0, 99999)]
    toks = [http_json('/api/register', {'name': n, 'password': 'e2e-pass-123'})['token']
            for n in names]
    with sqlite3.connect(DB, timeout=10) as c:
        c.execute('UPDATE roles SET x=?, z=? WHERE name=?',
                  (outside[0], outside[1], names[0]))
        c.execute('UPDATE roles SET x=?, z=? WHERE name=?',
                  (outside[0] + 4, outside[1], names[1]))
        c.commit()
    snap = {}
    ok = False
    try:
        async def run():
            t1 = asyncio.create_task(actor(toks[0], inside, outside, snap))
            t2 = asyncio.create_task(observer(toks[1], names[0], snap))
            res = await t2
            await t1
            return res
        res = asyncio.run(run())
        print('  observed inside/outside:', res)
        assert res, 'observer saw nothing'
        v_in, v_out = res
        assert v_in is not None and v_out is not None, 'observer missing samples'
        # 有抬高地板的建筑（咖啡店）：服务端广播 fy=0.28，客户端模型 y 也应是 0.28
        assert (v_in.get('fy') or 0) > 0.2, 'indoor height not broadcast: %r' % (v_in,)
        assert (v_in.get('y') or 0) > 0.2, 'indoor model not raised for others: %r' % (v_in,)
        # 室外：两者都应回到 0
        assert (v_out.get('fy') or 0) < 0.1, 'outdoor height should be 0: %r' % (v_out,)
        print('  OK  indoor y=%.2f fy=%.2f | outdoor fy=%.2f'
              % (v_in.get('y') or 0, v_in.get('fy') or 0, v_out.get('fy') or 0))
        ok = True
    finally:
        time.sleep(1.0)
        cleanup(names)
        print('cleanup done')
    print('remote height: OK' if ok else 'remote height: FAIL')
    return 0 if ok else 1


async def observer(tok, target_name, snap):
    port = random.randint(12400, 12499)
    prof = tempfile.mkdtemp(prefix='height-')
    proc = subprocess.Popen(
        [CHROME, '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
         '--mute-audio', '--user-data-dir=' + prof, '--remote-debugging-port=%d' % port,
         '--window-size=1200,800', ORIGIN + '/'],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        target = None
        for _ in range(160):
            await asyncio.sleep(0.25)
            try:
                with urllib.request.urlopen('http://127.0.0.1:%d/json/list' % port, timeout=2) as r:
                    lst = json.load(r)
                cas = [x for x in lst if x.get('type') == 'page' and x.get('webSocketDebuggerUrl')]
                if cas:
                    target = cas[0]
                    break
            except Exception:
                pass
        assert target, 'chrome devtools not ready'
        async with websockets.connect(target['webSocketDebuggerUrl'], max_size=64 * 1024 * 1024) as ws:
            c = CDP(ws)
            await c.send('Runtime.enable')
            for _ in range(80):
                await asyncio.sleep(0.25)
                try:
                    if await c.ev('return location.origin;') == ORIGIN:
                        break
                except Exception:
                    pass
            await c.ev('localStorage.setItem("token", %s); location.reload(); return 1;'
                       % json.dumps(tok))
            for _ in range(80):
                await asyncio.sleep(0.3)
                try:
                    if await c.ev('return typeof NET !== "undefined" && !!P;'):
                        break
                except Exception:
                    pass
            await asyncio.sleep(2.0)

            allk = await c.ev(
                "var out=[]; for(var k in NET.others){var o=NET.others[k];"
                "out.push([k, o&&o.name, o&&o.hh&&o.hh.g?+o.hh.g.position.y.toFixed(2):null,"
                " o&&o.hh&&o.hh.g?+o.hh.g.position.x.toFixed(1):null]);}"
                "return out;")
            print('  NET.others:', allk)
            dbg = await c.ev(
                "var f=TOWN_FLOORS[0];"
                "var hit=null; var n=0;"
                "for(var i=0;i<TOWN_FLOORS.length;i++){var q=TOWN_FLOORS[i];"
                " if(%f>=q.x0&&%f<=q.x1&&%f>=q.z0&&%f<=q.z1){hit={y:q.y,id:q.id};n++;}}"
                "return {floors:TOWN_FLOORS.length, match:hit, n:n,"
                " support:(typeof supportYAt==='function')?supportYAt(%f,%f):'noapi',"
                " first:f};" % (inside[0], inside[1], inside[0], inside[1],
                                inside[0], inside[1])) if False else await c.ev(
                "var cx=-116.83, cz=182.34;"
                "var hit=null, n=0;"
                "for(var i=0;i<TOWN_FLOORS.length;i++){var q=TOWN_FLOORS[i];"
                " if(cx>=q.x0&&cx<=q.x1&&cz>=q.z0&&cz<=q.z1){hit={y:q.y,id:q.id};n++;}}"
                "return {floors:TOWN_FLOORS.length, match:hit, n:n,"
                " support:supportYAt(cx,cz), first:TOWN_FLOORS[0]};")
            print('  observer env:', dbg)

            async def y_of():
                return await c.ev(
                    "var name=%s; var o=null;"
                    "for(var k in NET.others){ if(NET.others[k] && NET.others[k].name===name){o=NET.others[k];break;} }"
                    "if(!o||!o.hh||!o.hh.g) return null;"
                    "return {y:+o.hh.g.position.y.toFixed(3),"
                    " fy:(typeof o.fy==='number'?o.fy:null),"
                    " pose:(o.pose||'')};"
                    % json.dumps(target_name))

            for _ in range(60):
                if snap.get('ready'):
                    break
                await asyncio.sleep(0.2)
            seq = []
            for _ in range(80):
                v = await y_of()
                if v:
                    seq.append((round(v.get('y') or 0, 3), v.get('fy')))
                await asyncio.sleep(0.1)
            while len(seq) < 10:
                await asyncio.sleep(0.2)
                v = await y_of()
                if v:
                    seq.append((round(v.get('y') or 0, 3), v.get('fy')))
            print('  y seq (model, fy):', seq[:20])
            await asyncio.sleep(2.4)
            y_out = await y_of()
            for _ in range(40):
                if snap.get('inside'):
                    break
                await asyncio.sleep(0.2)
            await asyncio.sleep(2.4)
            y_in = await y_of()
            return (y_in, y_out)
    finally:
        try:
            subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass
        shutil.rmtree(prof, ignore_errors=True)


if __name__ == '__main__':
    raise SystemExit(main())
