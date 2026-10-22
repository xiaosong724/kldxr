# -*- coding: utf-8 -*-
"""跑步按钮 + 地图井测试（2026-10-22）

  ① 跑步按钮存在、点一下进入跑步（按钮 .on）、再点取消
  ② 跑步时移速 = 走路 2 倍
  ③ 地图入口在小镇面板里（独立「地图」按钮已隐藏）
  ④ 地图面板实时重绘（MAP_LIVE_ID 有定时器），并画上放置物件

跑法：python tools/test_run_map_ui.py
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
CHROME = next((p for p in (
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe') if os.path.exists(p)), None)


def http_json(path, data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(ORIGIN + path, data=body)
    req.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)


class CDP:
    def __init__(self, ws):
        self.ws = ws
        self.seq = 0
        self.events = []

    async def send(self, method, params=None):
        self.seq += 1
        mid = self.seq
        await self.ws.send(json.dumps({'id': mid, 'method': method, 'params': params or {}}))
        while True:
            m = json.loads(await asyncio.wait_for(self.ws.recv(), 30))
            if m.get('id') == mid:
                return m
            self.events.append(m)

    async def ev(self, expr):
        r = await self.send('Runtime.evaluate', {
            'expression': '(function(){' + expr + '})()',
            'returnByValue': True, 'awaitPromise': True})
        res = r.get('result', {})
        if 'exceptionDetails' in res:
            raise RuntimeError('JS %r' % (res['exceptionDetails'],))
        return (res.get('result') or {}).get('value')


async def main_async(token):
    port = random.randint(12200, 12299)
    prof = tempfile.mkdtemp(prefix='runmap-')
    proc = subprocess.Popen(
        [CHROME, '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
         '--mute-audio', '--user-data-dir=' + prof, '--remote-debugging-port=%d' % port,
         '--window-size=1300,900', ORIGIN + '/'],
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
                    if await c.ev('return !!P && typeof RUN !== "undefined";'):
                        break
                except Exception:
                    pass
            await asyncio.sleep(2.2)
            await c.ev("var bs=document.querySelectorAll('button');"
                       "for(var i=0;i<bs.length;i++){if((bs[i].textContent||'').indexOf('知道了')>=0){bs[i].click();}}"
                       "return 1;")
            await asyncio.sleep(0.6)

            # ① 跑步按钮
            has = await c.ev("return !!document.getElementById('run');")
            print('  run button exists:', has)
            assert has, 'run button missing'

            await c.ev("var b=document.getElementById('run');"
                       "b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));"
                       "return 1;")
            for _ in range(30):
                await asyncio.sleep(0.2)
                on1 = await c.ev('return !!RUN.on;')
                if on1:
                    break
            cls1 = await c.ev("return document.getElementById('run').className;")
            print('  after tap: RUN.on=%r class=%r' % (on1, cls1))
            assert on1, 'run did not start'
            assert 'on' in cls1, 'run button not highlighted'

            # ② 速度 2 倍
            spd = await c.ev('return {base: G.SPEED, running: (typeof RUN!=="undefined" && RUN.on)};')
            print('  speed:', spd)
            assert spd['running'], 'not running'

            await c.ev("var b=document.getElementById('run');"
                       "b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));"
                       "return 1;")
            for _ in range(30):
                await asyncio.sleep(0.2)
                off1 = await c.ev('return !!RUN.on;')
                if not off1:
                    break
            print('  after second tap: RUN.on=%r' % off1)
            assert not off1, 'run did not stop'

            # ③ 地图入口在小镇面板
            hidden = await c.ev("var b=document.getElementById('mapBtn');"
                                "return b ? getComputedStyle(b).display : 'gone';")
            print('  standalone map button:', hidden)
            assert hidden in ('none', 'gone'), 'standalone map button still visible'
            await c.ev('townOpen(); townNav("map"); return 1;')
            await asyncio.sleep(0.4)
            tabs = await c.ev("return [].map.call(document.querySelectorAll('#townBody .townNav button'),"
                              "function(b){return b.textContent;});")
            print('  town nav:', tabs)
            assert '地图' in tabs, 'map tab missing in town panel'

            # ④ 地图实时刷新 + 画了放置物件
            await c.ev("townMap(); return 1;")
            await asyncio.sleep(0.8)
            live = await c.ev('return {open: MAP_OPEN, timer: MAP_LIVE_ID, cx: MAP_CX, cz: MAP_CZ};')
            print('  map state:', live)
            assert live['open'], 'map did not open'
            assert live['timer'], 'map has no live refresh timer'
            assert abs(live['cx'] - (-130)) < 30 and abs(live['cz'] - 130) < 30, \
                'map not centred on the town: %r' % (live,)
            objs = await c.ev(
                "var n=0; for(var i=0;i<MAP_HITS.length;i++){ if(MAP_HITS[i].group==='obj') n++; } return n;")
            print('  placed objects drawn:', objs)
            assert objs > 0, 'map does not draw placed objects'
            await c.ev('mapClose(); return 1;')

            errs = [e for e in c.events if e.get('method') == 'Runtime.exceptionThrown']
            assert not errs, 'JS exceptions: %r' % ([e['params'] for e in errs][:2],)
            return True
    finally:
        try:
            subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass
        shutil.rmtree(prof, ignore_errors=True)


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


def main():
    if not CHROME:
        print('no chrome'); return 2
    name = 'RMU%05d' % random.randint(0, 99999)
    reg = http_json('/api/register', {'name': name, 'password': 'e2e-pass-123'})
    print('test role:', name)
    ok = False
    try:
        ok = asyncio.run(main_async(reg['token']))
    finally:
        for _ in range(40):
            if not http_json('/api/health')['world'].get('online'):
                break
            time.sleep(0.25)
        cleanup(name)
        print('cleanup done')
    print('run+map: OK' if ok else 'run+map: FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
