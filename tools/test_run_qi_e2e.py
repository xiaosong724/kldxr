# -*- coding: utf-8 -*-
"""跑步耗灵气测试（2026-10-22）

用户：「增加跑步按钮…按一下持续跑，再按一下取消，每秒消耗 1 点灵气。跑是走路的双倍速」。

  ① 开跑 → 每秒 -1 点灵气（镇内本来每秒 +1% 回气，跑步时【停止回气】）
  ② 灵气耗尽 → 自动停 + 通知
  ③ 关跑 → 不再扣

跑法：python tools/test_run_qi_e2e.py
"""
import asyncio
import json
import os
import random
import sqlite3
import sys
import time
import urllib.request

import websockets

sys.stdout.reconfigure(encoding='utf-8')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, 'server', 'game.db')
ORIGIN = 'http://127.0.0.1:8899'
WS = 'ws://127.0.0.1:8900/ws'


def http_json(path, data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(ORIGIN + path, data=body)
    req.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)


async def wait(ws, pred, n=900):
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


async def flow(tok):
    async with websockets.connect(WS, max_size=16 * 1024 * 1024) as ws:
        await ws.send(json.dumps({'t': 'hello', 'd': {'token': tok}}))
        await wait(ws, lambda m: m['t'] == 'world')
        await asyncio.sleep(0.4)
        await ws.send(json.dumps({'t': 'run', 'd': {'on': 1}}))
        r = await wait(ws, lambda m: m['t'] == 'run')
        print('  run on ->', r['d'])
        assert r['d'].get('on') == 1, 'run did not start'

        qi, stopped = [], None
        t0 = time.time()
        while time.time() - t0 < 6.0:
            m = await wait(ws, lambda m: m['t'] in ('qi', 'run'), n=200)
            if m is None:
                break
            if m['t'] == 'qi':
                qi.append(m['d']['q'])
            elif m['t'] == 'run' and not m['d'].get('on'):
                stopped = m['d']
                break
        print('  qi samples:', qi, ' auto stop:', stopped)
        assert qi, 'qi never changed while running'
        assert qi[0] == 2, 'qi should drop 1 per second (from 3), got %r' % (qi,)
        assert all(b <= a for a, b in zip(qi, qi[1:])), 'qi went up while running: %r' % (qi,)
        assert stopped and stopped.get('reason') == 'no_qi', 'did not stop at 0 qi: %r' % (stopped,)
        return True


def main():
    name = 'RUN%05d' % random.randint(0, 99999)
    tok = http_json('/api/register', {'name': name, 'password': 'e2e-pass-123'})['token']
    with sqlite3.connect(DB, timeout=10) as c:
        c.execute('UPDATE roles SET qi=3 WHERE name=?', (name,))
        c.commit()
    ok = False
    try:
        ok = asyncio.run(flow(tok))
    finally:
        cleanup(name)
        print('cleanup done')
    print('run qi: OK' if ok else 'run qi: FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
