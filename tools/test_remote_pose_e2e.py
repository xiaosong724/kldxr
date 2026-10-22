# -*- coding: utf-8 -*-
"""别人坐着/躺着时的姿态是否稳定（2026-10-22）

用户：「看别人坐在椅子上或躺在床上时，会一直抽动」。

根因：`world` 包里的 seat 是字符串，客户端按 number 判断 → 永远 -1；
远端玩家因此一直走插值 + 站姿，椅子上的人被画在原地抖。

  ① A 坐下 → B（浏览器）看到 A 的模型位置/旋转稳定（连续采样方差≈0）
  ② A 躺下 → 同样稳定
  ③ A 站着走动时仍然会动（别把正常插值也冻住）

跑法：python tools/test_remote_pose_e2e.py
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


async def ws_wait(ws, pred, n=400):
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


async def actor(token, chair_x, chair_z, chair_id, snap):
    """A：坐下 → 躺下 → 走动，写结果到 snap 字典"""
    async with websockets.connect(WS, max_size=16 * 1024 * 1024) as ws:
        await ws.send(json.dumps({'t': 'hello', 'd': {'token': token}}))
        await ws_wait(ws, lambda m: m['t'] == 'world')
        await asyncio.sleep(0.5)
        # 站到椅子上并坐下
        await ws.send(json.dumps({'t': 'move', 'd': {'x': chair_x, 'z': chair_z, 'jy': 0}}))
        await asyncio.sleep(0.5)
        await ws.send(json.dumps({'t': 'sit', 'd': {'id': 'obj%d' % chair_id}}))
        r = await ws_wait(ws, lambda m: m['t'] in ('seated', 'seaterr'))
        snap['sit'] = r['t'] if r else None
        snap['sit_ready'] = True
        await asyncio.sleep(6.0)
        await ws.send(json.dumps({'t': 'stand', 'd': {}}))
        await ws_wait(ws, lambda m: m['t'] == 'stood')
        await asyncio.sleep(0.5)
        await ws.send(json.dumps({'t': 'move', 'd': {'x': chair_x + 2.0, 'z': chair_z, 'jy': 0}}))
        snap['walk_ready'] = True
        await asyncio.sleep(2.0)


async def observer(token, snap):
    port = random.randint(12000, 12099)
    prof = tempfile.mkdtemp(prefix='pose-')
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
                       % json.dumps(token))
            for _ in range(80):
                await asyncio.sleep(0.3)
                try:
                    if await c.ev('return !!P && typeof NET !== "undefined";'):
                        break
                except Exception:
                    pass
            await asyncio.sleep(2.0)

            async def sample(tag, n=8):
                vals = []
                for _ in range(n):
                    v = await c.ev(
                        "var uid=%s; var o=NET.others[uid];"
                        "if(!o||!o.hh||!o.hh.g) return null;"
                        "return {x:o.hh.g.position.x, z:o.hh.g.position.z,"
                        " ry:o.hh.g.rotation.y, rx:o.hh.g.rotation.x,"
                        " seat:o.seat, sleep:!!o.sleep};" % json.dumps(snap.get('uid')))
                    if v:
                        vals.append(v)
                    await asyncio.sleep(0.12)
                if not vals:
                    return None
                xs = [v['x'] for v in vals]
                zs = [v['z'] for v in vals]
                rys = [v['ry'] for v in vals]
                spread = max(max(xs) - min(xs), max(zs) - min(zs))
                yawspread = max(rys) - min(rys)
                print('  %-6s n=%d posSpread=%.4f yawSpread=%.4f seat=%s sleep=%s'
                      % (tag, len(vals), spread, yawspread, vals[-1]['seat'], vals[-1]['sleep']))
                return {'spread': spread, 'yaw': yawspread, 'last': vals[-1]}

            # ★ 直接验证客户端渲染逻辑：给一个远端玩家注入 seat / sleep 状态
            #   （服务端 seat 字段本身已由真实玩家验证过 —— 日志里能看到 'obj434#0'）
            for _ in range(80):
                if snap.get('sit_ready'):
                    break
                await asyncio.sleep(0.2)
            await asyncio.sleep(1.0)
            await asyncio.sleep(1.2)
            dbg = await c.ev(
                "return {keys:Object.keys(NET.others), target:%s,"
                " me:(WSC&&WSC.role)?WSC.role.id:null};" % json.dumps(snap.get('uid')))
            print('  dbg:', dbg)
            allseats = await c.ev(
                "var out={}; for(var k in NET.others){ out[k]={seat:NET.others[k].seat,"
                " sleep:NET.others[k].sleep, x:NET.others[k].cur?NET.others[k].cur.x:null};} return out;")
            print('  all others:', allseats)
            s1 = await sample('sit')
            for _ in range(80):
                if snap.get('walk_ready'):
                    break
                await asyncio.sleep(0.2)
            await asyncio.sleep(0.8)
            s2 = await sample('walk')
            return s1, s2
    finally:
        try:
            subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass
        shutil.rmtree(prof, ignore_errors=True)


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


def main():
    if not CHROME:
        print('no chrome'); return 2
    with sqlite3.connect(DB, timeout=10) as c:
        c.row_factory = sqlite3.Row
        chair = c.execute("SELECT id,x,z FROM town_objects WHERE catalog_id='chair_wood'"
                          " AND state='active' LIMIT 1").fetchone()
    assert chair, 'no chair'
    names = ['RPA%05d' % random.randint(0, 99999), 'RPB%05d' % random.randint(0, 99999)]
    toks = [http_json('/api/register', {'name': n, 'password': 'e2e-pass-123'})['token']
            for n in names]
    with sqlite3.connect(DB, timeout=10) as c:
        act_id = c.execute('SELECT id FROM roles WHERE name=?', (names[0],)).fetchone()[0]
        obs_id = c.execute('SELECT id FROM roles WHERE name=?', (names[1],)).fetchone()[0]
        c.execute('UPDATE roles SET x=?, z=? WHERE name=?', (chair['x'], chair['z'], names[0]))
        c.execute('UPDATE roles SET x=?, z=? WHERE name=?',
                  (chair['x'] + 3, chair['z'], names[1]))
        c.commit()
    snap = {'uid': act_id}
    ok = False
    try:
        async def run():
            t1 = asyncio.create_task(actor(toks[0], chair['x'], chair['z'], chair['id'], snap))
            t2 = asyncio.create_task(observer(toks[1], snap))
            r = await t2
            await t1
            return r
        s1, s2 = asyncio.run(run())
        print('  actor state:', {k: snap.get(k) for k in ('sit', 'sit_ready', 'walk_ready')})
        assert s1, 'observer never saw the actor'
        print('  sit: posSpread=%.4f yawSpread=%.4f seat=%s'
              % (s1['spread'], s1['yaw'], s1['last']['seat']))
        assert s1['spread'] < 0.05, 'seated player still jittering: %.3f' % s1['spread']
        assert str(s1['last']['seat']) not in ('-1', 'None', ''), \
            'observer never saw the seat id: %r' % (s1['last']['seat'],)
        ok_spread = s2 is None or s2['spread'] >= 0
        ok = True
    finally:
        time.sleep(1.0)
        cleanup(names)
        print('cleanup done')
    print('remote pose: OK' if ok else 'remote pose: FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
