# -*- coding: utf-8 -*-
"""小镇面板导航 + 编辑模式 UI 测试（2026-10-22）

  ① 小镇面板有 概览/放置/编辑/权限 四个导航
  ② 「放置」页列出目录，点一项进入放置模式
  ③ 「编辑」页点按钮进入编辑模式（底部工具条出现）
  ④ 「权限」页有 7 个权限复选框

跑法：python tools/test_town_panel_ui.py
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
WS = 'ws://127.0.0.1:8900/ws'
SHOT = os.path.join(ROOT, 'docs', 'shots', 'town-panel-nav.png')
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
    port = random.randint(10900, 10999)
    prof = tempfile.mkdtemp(prefix='townpanel-')
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
            # 等页面真的落在本站 origin 上，再写 localStorage（否则会 SecurityError）
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
                    if await c.ev('return typeof townOpen === "function" && typeof PlaceMode !== "undefined";'):
                        break
                except Exception:
                    pass
            await asyncio.sleep(2.5)
            await c.ev("var bs=document.querySelectorAll('button');"
                       "for(var i=0;i<bs.length;i++){if((bs[i].textContent||'').indexOf('知道了')>=0){bs[i].click();}}"
                       "return 1;")
            await asyncio.sleep(0.8)
            await c.ev('townOpen(); return 1;')
            await asyncio.sleep(0.6)
            nav = await c.ev("return [].map.call(document.querySelectorAll('#townBody .townNav button'),"
                             "function(b){return b.textContent;});")
            print('  nav:', nav)
            assert nav[:4] == ['概览', '放置', '编辑', '权限'], 'nav wrong: %r' % (nav,)

            await c.ev("townNav('place'); return 1;")
            await asyncio.sleep(0.4)
            nplace = await c.ev("return document.querySelectorAll('#townBody .townGrid button').length;")
            print('  place items:', nplace)
            assert nplace > 20, 'catalog not listed'

            await c.ev("var b=document.querySelector('#townBody .townGrid button');"
                       "if(b){b.click();} return 1;")
            await asyncio.sleep(0.6)
            placing = await c.ev('return PlaceMode.isPlacing();')
            print('  placing after click:', placing)
            assert placing, 'clicking catalog did not start placement'
            await c.ev('PlaceMode.close(); return 1;')

            await c.ev('townOpen(); townNav("edit"); return 1;')
            await asyncio.sleep(0.3)
            btns = await c.ev("return [].map.call(document.querySelectorAll('#townBody button'),"
                              "function(b){return b.textContent;});")
            print('  edit page buttons:', btns)
            clicked = await c.ev("var bs=[].slice.call(document.querySelectorAll('#townBody button'));"
                                 "var b=bs.filter(function(x){return x.textContent.indexOf('进入编辑')>=0;})[0];"
                                 "if(!b){return 'nobtn';} b.click(); return 'ok';")
            print('  click edit:', clicked)
            await asyncio.sleep(0.5)
            ed = await c.ev('return PlaceMode.editState();')
            bar = await c.ev("var b=document.getElementById('editBar');"
                             "return b?getComputedStyle(b).display:'none';")
            print('  edit mode:', ed, 'bar:', bar)
            assert ed and ed['on'] and bar != 'none', 'edit mode not entered'

            shot = await c.send('Page.captureScreenshot', {'format': 'png'})
            with open(SHOT, 'wb') as f:
                f.write(base64.b64decode(shot['result']['data']))
            print('  screenshot:', SHOT)
            await c.ev('PlaceMode.stopEdit(); return 1;')

            await c.ev('townOpen(); townNav("perm"); return 1;')
            await asyncio.sleep(0.3)
            nperm = await c.ev("return document.querySelectorAll('#townBody .permGrid input').length;")
            print('  perm checkboxes:', nperm)
            assert nperm == 7, 'perm page wrong'

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


def cleanup(name, tid=0):
    with sqlite3.connect(DB, timeout=10) as c:
        if tid:
            for t in ('town_objects', 'town_perms', 'town_payments', 'town_ledger'):
                c.execute('DELETE FROM %s WHERE town_id=?' % t, (tid,))
            c.execute('DELETE FROM towns WHERE id=?', (tid,))
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
    name = 'TPN%05d' % random.randint(0, 99999)
    reg = http_json('/api/register', {'name': name, 'password': 'e2e-pass-123'})
    print('test role:', name)
    tid = 0
    tx = 2600.0 + random.randint(0, 300)
    tz = 2600.0 + random.randint(0, 300)
    with sqlite3.connect(DB, timeout=10) as c:
        c.execute('UPDATE roles SET gold=20000000, x=?, z=? WHERE name=?', (tx, tz, name))
        c.commit()

    async def mk(self_ws):
        await self_ws.send(json.dumps({'t': 'town_create', 'd': {
            'name': '面板测试' + name[-3:], 'tier': 30, 'x': tx, 'z': tz}}))
        r = await ws_wait(self_ws, lambda m: m['t'] == 'townresult')
        return int(r['d']['town']['id']) if r and r['d'].get('ok') == 1 else 0
    async def ws_wait(ws, pred, n=400):
        for _ in range(n):
            m = json.loads(await asyncio.wait_for(ws.recv(), 10))
            if pred(m):
                return m
        return None
    async def mk_sess():
        async with websockets.connect(WS, max_size=16 * 1024 * 1024) as w:
            await w.send(json.dumps({'t': 'hello', 'd': {'token': reg['token']}}))
            await ws_wait(w, lambda m: m['t'] == 'world')
            await asyncio.sleep(0.3)
            return await mk(w)
    tid = asyncio.run(mk_sess())
    print('  created town', tid)
    ok = False
    try:
        ok = asyncio.run(main_async(reg['token']))
    finally:
        for _ in range(40):
            if not http_json('/api/health')['world'].get('online'):
                break
            time.sleep(0.25)
        cleanup(name, tid)
        print('cleanup done')
    print('town panel ui: OK' if ok else 'town panel ui: FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
