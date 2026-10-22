# -*- coding: utf-8 -*-
"""C3 对照实验截图：旧静态主城 vs「隐藏静态建筑 + 对象镇平移」

只改客户端渲染（?townobj=1&tox=-130&toz=130），不动数据库。

  docs/shots/town-switch-old.png   —— 现状（静态镇）
  docs/shots/town-switch-new.png   —— 对象镇平移到 -130 之后的样子

跑法：python tools/preview_town_switch.py
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

    async def ev(self, expr):
        r = await self.send('Runtime.evaluate', {
            'expression': '(function(){' + expr + '})()',
            'returnByValue': True, 'awaitPromise': True})
        res = r.get('result', {})
        if 'exceptionDetails' in res:
            raise RuntimeError('JS %r' % (res['exceptionDetails'],))
        return (res.get('result') or {}).get('value')


async def shoot(token, url, out_path, want_objects):
    port = random.randint(10700, 10799)
    prof = tempfile.mkdtemp(prefix='switch-')
    proc = subprocess.Popen(
        [CHROME, '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
         '--mute-audio', '--user-data-dir=' + prof, '--remote-debugging-port=%d' % port,
         '--window-size=1600,950', url],
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
            await c.ev('localStorage.setItem("token", %s); location.reload(); return 1;'
                       % json.dumps(token))
            for _ in range(80):
                await asyncio.sleep(0.3)
                try:
                    if await c.ev('return typeof scene !== "undefined" && typeof wsSend === "function";'):
                        break
                except Exception:
                    pass
            await asyncio.sleep(3.0)
            await c.ev("var bs=document.querySelectorAll('button');"
                       "for(var i=0;i<bs.length;i++){if((bs[i].textContent||'').indexOf('知道了')>=0){bs[i].click();}}"
                       "return 1;")
            await asyncio.sleep(1.0)
            await c.ev("try{CAM_VIEW='free'; CAM_PITCH=0.92; CAM_PITCH_T=0.92;"
                       "CAM_YAW=0.4; CAM_YAW_T=0.4; SETCFG.zoom=70;"
                       "if(typeof applyWorldZoom==='function')applyWorldZoom();}catch(e){} return 1;")
            # 对象模式：等放置物渲染完
            stats = None
            for _ in range(30):
                await asyncio.sleep(0.4)
                stats = await c.ev("return (window.PlaceMode && PlaceMode.stats) ? PlaceMode.stats() : null;")
            await asyncio.sleep(1.0)
            stats = await c.ev("return (window.PlaceMode && PlaceMode.stats) ? PlaceMode.stats() : null;")
            print('  %s stats=%r' % (os.path.basename(out_path), stats))
            if want_objects:
                assert stats and stats.get('rendered', 0) > 100, 'objects not rendered: %r' % (stats,)
            errs = [e for e in c.events if e.get('method') == 'Runtime.exceptionThrown']
            assert not errs, 'JS exceptions: %r' % ([e['params'] for e in errs][:2],)
            shot = await c.send('Page.captureScreenshot', {'format': 'png'})
            with open(out_path, 'wb') as f:
                f.write(base64.b64decode(shot['result']['data']))
            print('  saved', out_path)
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
    name = 'SWT%05d' % random.randint(0, 99999)
    reg = http_json('/api/register', {'name': name, 'password': 'e2e-pass-123'})
    with sqlite3.connect(DB, timeout=10) as c:
        c.execute('UPDATE roles SET x=-130, z=143 WHERE name=?', (name,))
        c.commit()
    print('test role:', name)
    try:
        asyncio.run(shoot(reg['token'], ORIGIN + '/',
                          os.path.join(ROOT, 'docs', 'shots', 'town-after-switch.png'), True))
    finally:
        for _ in range(40):
            if not http_json('/api/health')['world'].get('online'):
                break
            time.sleep(0.25)
        cleanup(name)
        print('cleanup done')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
