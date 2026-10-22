# -*- coding: utf-8 -*-
"""咖啡店点单的浏览器冒烟测试（A2 客户端）

做三件事：
  1. 注册临时号、写库定位到 514 号椅子
  2. 无头 Chrome 打开游戏，直接调页面的 wsSend 坐下/点单
  3. 断言：传菜员出现了、桌上杯子被建出来了、没有 JS 异常
     顺便截一张 docs/shots/cafe-order.png

跑法：python tools/test_cafe_ui.py
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
SHOT = os.path.join(ROOT, 'docs', 'shots', 'cafe-order.png')
CHROME = next((p for p in (
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe') if os.path.exists(p)), None)


def http_json(path, data=None, token=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(ORIGIN + path, data=body)
    req.add_header('Content-Type', 'application/json')
    if token:
        req.add_header('X-Token', token)
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
            raise RuntimeError('JS: %r' % (res['exceptionDetails'],))
        return (res.get('result') or {}).get('value')


async def main_async(name, token):
    port = random.randint(10300, 10399)
    prof = tempfile.mkdtemp(prefix='cafeui-')
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
                    ok = await c.ev('return typeof wsSend === "function" && typeof scene !== "undefined";')
                except Exception:
                    ok = None
                if ok:
                    ready = True
                    break
            assert ready, 'game page did not come up'
            await asyncio.sleep(1.5)
            # 关公告
            await c.ev("var bs=document.querySelectorAll('button');"
                       "for(var i=0;i<bs.length;i++){if((bs[i].textContent||'').indexOf('知道了')>=0){bs[i].click();}}"
                       "return 1;")
            await asyncio.sleep(0.4)
            await c.ev("try{SETCFG.zoom=16; if(typeof applyWorldZoom==='function') applyWorldZoom();}catch(e){} return 1;")

            await c.ev("wsSend('sit',{id:'obj514'}); return 1;")
            await asyncio.sleep(0.8)
            seat = await c.ev("return {seat: window.MY_SEAT || null};")
            print('  client seat:', seat)

            await c.ev("wsSend('order_open',{}); return 1;")
            await asyncio.sleep(0.6)
            await c.ev("wsSend('order_buy',{item:'americano'}); return 1;")
            await asyncio.sleep(0.8)
            waiters = await c.ev('return WAITERS.length;')
            print('  waiter spawned:', waiters)

            await asyncio.sleep(2.5)
            state = await c.ev(
                "return {open: !!window.ORDER_OPEN, table: window.MY_TABLE || '',"
                " cups: window.TABLE_CUPS[window.MY_TABLE] ? window.TABLE_CUPS[window.MY_TABLE].cups.length : -1,"
                " meshes: window.CUP_GROUP ? window.CUP_GROUP.children.length : -1,"
                " waiters: WAITERS.length, errors: (window.__jsErrors||[]).length};")
            print('  client state:', state)

            npc = await c.ev("var r=townNpcHero({name:'店员小满',x:0,z:0,ry:0});"
                             "return r? {kids:r.children.length, scale:r.scale.x} : null;")
            print('  npc hero:', npc)
            await c.ev("try{CAM_VIEW='third'; G.CAM_DIST=6.5; CAM_PITCH_T=0.85; CAM_PITCH=0.85;"
                       "CAM_YAW_T=1.9; CAM_YAW=1.9;}catch(e){} return 1;")
            await asyncio.sleep(0.8)
            shot = await c.send('Page.captureScreenshot', {'format': 'png'})
            import base64
            with open(SHOT, 'wb') as f:
                f.write(base64.b64decode(shot['result']['data']))
            print('  screenshot:', SHOT)

            errs = [e for e in c.events if e.get('method') == 'Runtime.exceptionThrown']
            assert not errs, 'JS exceptions: %r' % ([e['params'] for e in errs][:2],)
            assert waiters >= 1, 'no waiter model'
            assert state['cups'] >= 1, 'client never got cup state'
            assert state['meshes'] >= 1, 'no cup mesh in scene'
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
            for oid in [r[0] for r in c.execute('SELECT id FROM table_orders WHERE player_id=?', (rid,))]:
                c.execute('DELETE FROM table_cups WHERE order_id=?', (oid,))
                c.execute('DELETE FROM waiter_tasks WHERE order_id=?', (oid,))
            c.execute('DELETE FROM table_orders WHERE player_id=?', (rid,))
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
    name = 'CUI%05d' % random.randint(0, 99999)
    reg = http_json('/api/register', {'name': name, 'password': 'e2e-pass-123'})
    tok = reg['token']
    with sqlite3.connect(DB, timeout=10) as c:
        c.execute('UPDATE roles SET gold=500, x=-147.95, z=136.4 WHERE name=?', (name,))
        c.commit()
    print('test role:', name)
    ok = False
    try:
        ok = asyncio.run(main_async(name, tok))
    finally:
        for _ in range(40):
            if not http_json('/api/health')['world'].get('online'):
                break
            time.sleep(0.25)
        cleanup(name)
        print('cleanup: removed', name)
    print('cafe ui smoke: OK' if ok else 'cafe ui smoke: FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
