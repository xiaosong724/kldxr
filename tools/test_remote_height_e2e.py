# -*- coding: utf-8 -*-
"""别人站在加高地板建筑里，模型是否被抬起（2026-10-22）

用户：「加高地板的建筑看别的玩家还是在地板下」。

  ① 把一个玩家放到【有抬高地板】的建筑里（超市/咖啡店/小平房/别墅）
  ② 观察者读他的 o.fy（服务端广播）和 o.hh.g.position.y（实际模型高度）
  ③ 两者都应该 ≈ 0.28

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


def main():
    if not CHROME:
        print('no chrome'); return 2
    with sqlite3.connect(DB, timeout=10) as c:
        c.row_factory = sqlite3.Row
        bld = c.execute(
            "SELECT o.x,o.z FROM town_objects o WHERE o.state='active' AND o.parent_id=0"
            " AND o.catalog_id IN ('shop_mart_v1','shop_cafe_v1','shop_cafe_v2')"
            " LIMIT 1").fetchone()
    assert bld, 'no raised-floor building'
    inside = (bld['x'], bld['z'])
    names = ['RHA%05d' % random.randint(0, 99999), 'RHB%05d' % random.randint(0, 99999)]
    toks = [http_json('/api/register', {'name': n, 'password': 'e2e-pass-123'})['token']
            for n in names]
    with sqlite3.connect(DB, timeout=10) as c:
        c.execute('UPDATE roles SET x=?, z=? WHERE name=?', (inside[0], inside[1], names[0]))
        c.execute('UPDATE roles SET x=?, z=? WHERE name=?',
                  (inside[0] + 6, inside[1], names[1]))
        c.commit()
    ok = False
    try:
        async def run():
            async with websockets.connect(WS, max_size=16 * 1024 * 1024) as wa:
                await wa.send(json.dumps({'t': 'hello', 'd': {'token': toks[0]}}))
                await wait(wa, lambda m: m['t'] == 'world')
                await asyncio.sleep(1.0)
                return await observer(toks[1], names[0])
        res = asyncio.run(run())
        print('  observer sees:', res)
        assert res, 'observer saw nothing'
        fy, y = res.get('fy'), res.get('y')
        assert fy is not None and fy > 0.2, 'height not broadcast: %r' % (res,)
        assert y is not None and y > 0.2, 'model not raised for others: %r' % (res,)
        ok = True
    finally:
        time.sleep(1.0)
        cleanup(names)
        print('cleanup done')
    print('remote height: OK' if ok else 'remote height: FAIL')
    return 0 if ok else 1


async def observer(tok, target_name):
    port = random.randint(12500, 12599)
    prof = tempfile.mkdtemp(prefix='rheight-')
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
            await asyncio.sleep(2.5)
            # ★ 给目标模型的 position.y 装 setter 钩子，记录谁把它改回 0
            _unused = await c.ev(
                "var name=%s; var o=null;"
                "for(var k in NET.others){ if(NET.others[k] && NET.others[k].name===name){o=NET.others[k];break;} }"
                "if(!o||!o.hh||!o.hh.g) return 'noobj';"
                "window.__yLog = [];"
                "var pos = o.hh.g.position;"
                "var _y = pos.y;"
                "try {"
                "  Object.defineProperty(pos, 'y', {"
                "    configurable: true,"
                "    get: function () { return _y; },"
                "    set: function (v) {"
                "      if (Math.abs(v - _y) > 0.0001) {"
                "        var st = (new Error()).stack || '';"
                "        window.__yLog.push(v + ' <= ' + st.split('\\n').slice(1,3).join(' | '));"
                "        if (window.__yLog.length > 12) { window.__yLog.shift(); }"
                "      }"
                "      _y = v;"
                "    }"
                "  });"
                "  return 'hooked';"
                "} catch (e) { return 'fail:' + e; }"
                % json.dumps(target_name))

            await asyncio.sleep(1.0)

            for _ in range(40):
                v = await c.ev(
                    "var name=%s; var o=null;"
                    "for(var k in NET.others){ if(NET.others[k] && NET.others[k].name===name){o=NET.others[k];break;} }"
                    "if(!o||!o.hh||!o.hh.g) return null;"
                    "return {preY:o.__preRenderY, lastSet:o.__lastSetY, fy:(typeof o.fy==='number'?o.fy:null),"
                    " y:+o.hh.g.position.y.toFixed(3),"
                    " x:+o.hh.g.position.x.toFixed(1)};" % json.dumps(target_name))
                if v:
                    return v
                await asyncio.sleep(0.3)
            return None
    finally:
        try:
            subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass
        shutil.rmtree(prof, ignore_errors=True)


if __name__ == '__main__':
    raise SystemExit(main())
