# -*- coding: utf-8 -*-
"""B5：小镇「地图选点」浏览器冒烟测试

  1. 注册临时号，放到 (600,600)（远离主城，选点一定是有效区）
  2. 打开小镇面板 → 点「地图选点」
  3. 确认：占地框出现、面板收起
  4. 用 CDP 真实鼠标事件在屏幕中心点一下
  5. 确认：占地框消失、面板回来、X/Z 填成了选中的坐标
  6. 截图 docs/shots/town-pick.png
"""
import asyncio
import base64
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
SHOT = os.path.join(ROOT, 'docs', 'shots', 'town-pick.png')
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
            raise RuntimeError('JS: %r' % (res['exceptionDetails'],))
        return (res.get('result') or {}).get('value')


async def main_async(token):
    port = random.randint(10400, 10499)
    prof = tempfile.mkdtemp(prefix='townpick-')
    proc = subprocess.Popen(
        [CHROME, '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
         '--mute-audio', '--user-data-dir=' + prof, '--remote-debugging-port=%d' % port,
         '--window-size=1500,950', ORIGIN + '/'],
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
            await c.send('Page.enable')
            await c.ev('localStorage.setItem("token", %s); location.reload(); return 1;'
                       % json.dumps(token))
            ready = False
            for _ in range(80):
                await asyncio.sleep(0.25)
                try:
                    ok = await c.ev('return typeof townOpen === "function" && typeof scene !== "undefined";')
                except Exception:
                    ok = None
                if ok:
                    ready = True
                    break
            assert ready, 'game page did not come up'
            await asyncio.sleep(2.0)
            await c.ev("var bs=document.querySelectorAll('button');"
                       "for(var i=0;i<bs.length;i++){if((bs[i].textContent||'').indexOf('知道了')>=0){bs[i].click();}}"
                       "return 1;")
            await asyncio.sleep(0.4)
            await c.ev('townOpen(); return 1;')
            await asyncio.sleep(0.4)
            await c.ev("townPick('create'); return 1;")
            await asyncio.sleep(0.4)
            st = await c.ev('return townPickState();')
            panel = await c.ev("var p=document.getElementById('townPanel');"
                               "return p? p.classList.contains('on') : null;")
            print('  pick start:', st, 'panel on:', panel)
            assert st and st['on'] and st['ghost'], 'pick mode not started'
            assert panel is False, 'panel should hide while picking'

            # 真实鼠标：移到中心 → 按下 → 抬起（拖动 <6px 才算选点）
            w = await c.ev('return innerWidth;')
            h = await c.ev('return innerHeight;')
            cx, cy = int(w / 2), int(h / 2)
            await c.send('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': cx, 'y': cy})
            await asyncio.sleep(0.2)
            await c.send('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': cx, 'y': cy,
                                                      'button': 'left', 'clickCount': 1})
            await c.send('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': cx, 'y': cy,
                                                      'button': 'left', 'clickCount': 1})
            await asyncio.sleep(0.5)
            st2 = await c.ev('return townPickState();')
            panel2 = await c.ev("var p=document.getElementById('townPanel');"
                                "return p? p.classList.contains('on') : null;")
            x = await c.ev("return document.getElementById('townX')? +document.getElementById('townX').value : null;")
            z = await c.ev("return document.getElementById('townZ')? +document.getElementById('townZ').value : null;")
            print('  after click:', st2, 'panel on:', panel2, 'xy:', x, z)
            assert st2 and not st2['on'] and not st2['ghost'], 'pick did not end'
            assert panel2 is True, 'panel did not come back'
            assert x is not None and z is not None and abs(x - 600) < 25 and abs(z - 600) < 25, \
                'picked far from player: %r,%r' % (x, z)

            # 再进一次，截一张"占地框"的图
            await c.ev("townPick('create'); return 1;")
            await asyncio.sleep(0.3)
            await c.send('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': cx, 'y': cy})
            await asyncio.sleep(0.3)
            shot = await c.send('Page.captureScreenshot', {'format': 'png'})
            with open(SHOT, 'wb') as f:
                f.write(base64.b64decode(shot['result']['data']))
            print('  screenshot:', SHOT)
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
        print('no chrome/edge found'); return 2
    name = 'PKU%05d' % random.randint(0, 99999)
    reg = http_json('/api/register', {'name': name, 'password': 'e2e-pass-123'})
    tok = reg['token']
    with sqlite3.connect(DB, timeout=10) as c:
        c.execute('UPDATE roles SET gold=500, x=600, z=600 WHERE name=?', (name,))
        c.commit()
    print('test role:', name)
    ok = False
    try:
        ok = asyncio.run(main_async(tok))
    finally:
        for _ in range(40):
            if not http_json('/api/health')['world'].get('online'):
                break
            time.sleep(0.25)
        cleanup(name)
        print('cleanup: removed', name)
    print('town pick ui: OK' if ok else 'town pick ui: FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
