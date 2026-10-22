# -*- coding: utf-8 -*-
"""交互按钮测试（2026-10-22）

  ① 同时靠近「椅子 + 商店」时：
     - NEAR_CANDS >= 2
     - 交互按钮带 interact class + 右上角数字
     - 提示合并成一条（sitPrompt 里出现"附近可交互"）
  ② 点按钮 → 弹出 #nearPick，条目数 = 候选数
  ③ 点第一项 → 弹窗关闭并执行动作
  ④ showPrompt 显示 3 秒后自动隐藏

跑法：python tools/test_near_pick_ui.py
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
SHOT = os.path.join(ROOT, 'docs', 'shots', 'near-pick.png')
CHROME = next((p for p in (
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe') if os.path.exists(p)), None)
# 咖啡店门口：商店交互点 (-148.5, 140.65) + 外摆椅 obj518 (-146.75, 141.2)
SPOT = (-147.8, 140.9)


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
    port = random.randint(10800, 10899)
    prof = tempfile.mkdtemp(prefix='nearpick-')
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
                    if await c.ev('return typeof UI !== "undefined" && UI.interactNear && !!P;'):
                        break
                except Exception:
                    pass
            await asyncio.sleep(2.5)
            await c.ev("var bs=document.querySelectorAll('button');"
                       "for(var i=0;i<bs.length;i++){if((bs[i].textContent||'').indexOf('知道了')>=0){bs[i].click();}}"
                       "return 1;")
            await asyncio.sleep(1.2)

            state = await c.ev(
                "return {n:(NEAR_CANDS||[]).length,"
                " kinds:(NEAR_CANDS||[]).map(function(x){return x.kind+x.sub;}),"
                " atk:(document.getElementById('atk')||{}).className,"
                " badge:(function(){var b=document.getElementById('atkBadge');"
                "   return b?getComputedStyle(b).display:'none';})(),"
                " prompt:((document.getElementById('sitPrompt')||{}).textContent||'').slice(0,80)};")
            print('  candidates:', state)
            assert state['n'] >= 2, 'expected >=2 candidates: %r' % (state,)
            assert 'interact' in state['atk'], 'atk class: %r' % state['atk']
            assert state['badge'] == 'block', 'badge not shown'
            assert '附近可交互' in state['prompt'], 'merged prompt missing: %r' % state['prompt']

            # 点交互按钮 → 弹窗
            await c.ev("document.getElementById('atk').dispatchEvent("
                       "new MouseEvent('mousedown',{bubbles:true,cancelable:true})); return 1;")
            await asyncio.sleep(0.4)
            pick = await c.ev("var p=document.getElementById('nearPick');"
                              "return {vis:p?getComputedStyle(p).display:'none',"
                              " rows:document.querySelectorAll('#nearPickBody .nearRow').length};")
            print('  picker:', pick)
            assert pick['vis'] != 'none' and pick['rows'] == state['n'], 'picker wrong'
            shot = await c.send('Page.captureScreenshot', {'format': 'png'})
            with open(SHOT, 'wb') as f:
                f.write(base64.b64decode(shot['result']['data']))
            print('  screenshot:', SHOT)

            first = await c.ev("return (NEAR_CANDS[0]||{}).kind;")
            await c.ev("var r=document.querySelector('#nearPickBody .nearRow');"
                       "if(r){r.click();} return 1;")
            await asyncio.sleep(0.6)
            after = await c.ev("var p=document.getElementById('nearPick');"
                               "return {vis:p?getComputedStyle(p).display:'none',"
                               " seat: (MY_SEAT||null)};")
            print('  after choose (%s):' % first, after)
            assert after['vis'] == 'none', 'picker did not close'

            # 3 秒自动消失
            await c.ev("showPrompt('sitPrompt','自动消失测试'); return 1;")
            vis0 = await c.ev("return getComputedStyle(document.getElementById('sitPrompt')).display;")
            await asyncio.sleep(3.4)
            vis1 = await c.ev("return getComputedStyle(document.getElementById('sitPrompt')).display;")
            print('  prompt now/later:', vis0, vis1)
            assert vis0 != 'none' and vis1 == 'none', 'prompt did not auto hide'

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
    name = 'NPR%05d' % random.randint(0, 99999)
    reg = http_json('/api/register', {'name': name, 'password': 'e2e-pass-123'})
    with sqlite3.connect(DB, timeout=10) as c:
        c.execute('UPDATE roles SET x=?, z=? WHERE name=?', (SPOT[0], SPOT[1], name))
        c.commit()
    print('test role:', name, 'at', SPOT)
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
    print('near pick ui: OK' if ok else 'near pick ui: FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
