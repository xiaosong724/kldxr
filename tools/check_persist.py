# -*- coding: utf-8 -*-
"""验证系统提示框的位置/尺寸能否跨【服务器重启 + 页面刷新】保住。

分两个阶段跑（因为重启服务器要把当前 python 进程杀掉，脚本自己会被杀）：
    python tools/check_persist.py phase1     # 设置并保存
    （手动重启服务器）
    python tools/check_persist.py phase2     # 刷新后读回

★ 用固定的 --user-data-dir（tmp/_persist_prof），这样两阶段共用同一个 localStorage。
"""
import asyncio
import json
import os
import random
import shutil
import sqlite3
import subprocess
import sys
import urllib.request

sys.stdout.reconfigure(encoding='utf-8')

B = 'http://127.0.0.1:8899'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROF = os.path.join(ROOT, 'tmp', '_persist_prof')
STATE = os.path.join(ROOT, 'tmp', '_persist_state.json')
CH = None
for p in (r'C:\Program Files\Google\Chrome\Application\chrome.exe',
          r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'):
    if os.path.exists(p):
        CH = p
        break


def post(path, d):
    r = urllib.request.Request(B + path, data=json.dumps(d).encode(),
                               headers={'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(r))


def mkrole():
    c = sqlite3.connect(os.path.join(ROOT, 'server', 'game.db'))
    c.row_factory = sqlite3.Row
    name = 'PZ' + str(random.randint(1000, 9999))
    tok = post('/api/register', {'name': name, 'password': 'e2e-pass-123'})['token']
    rid = c.execute('select id from roles where name=?', (name,)).fetchone()['id']
    c.execute('update roles set level=40, x=-150, z=150 where id=?', (rid,))
    c.commit()
    return c, name, tok, rid


def drop(c, rid):
    acc = c.execute('select account_id from roles where id=?', (rid,)).fetchone()['account_id']
    for t in [x[0] for x in c.execute("select name from sqlite_master where type='table'")]:
        cols = [z[1] for z in c.execute('PRAGMA table_info(%s)' % t)]
        if 'role_id' in cols:
            c.execute('DELETE FROM %s WHERE role_id=?' % t, (rid,))
    c.execute('DELETE FROM roles WHERE id=?', (rid,))
    c.execute('DELETE FROM tokens WHERE account_id=?', (acc,))
    c.execute('DELETE FROM accounts WHERE id=?', (acc,))
    c.commit()


async def with_page(fn):
    import websockets
    port = random.randint(37000, 37200)
    proc = subprocess.Popen([CH, '--headless=new', '--disable-gpu', '--no-sandbox',
                             '--no-first-run', '--user-data-dir=' + PROF,
                             '--remote-debugging-port=%d' % port,
                             '--window-size=1280,800', B + '/'],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        t = None
        for _ in range(120):
            await asyncio.sleep(0.25)
            try:
                cc = [x for x in json.load(urllib.request.urlopen(
                    'http://127.0.0.1:%d/json/list' % port))
                    if x.get('type') == 'page' and x.get('webSocketDebuggerUrl')]
                if cc:
                    t = cc[0]
                    break
            except Exception:
                pass
        if not t:
            raise RuntimeError('浏览器没起来')
        async with websockets.connect(t['webSocketDebuggerUrl'],
                                      max_size=64 * 1024 * 1024) as ws:
            seq = [0]

            async def send(m, p=None):
                seq[0] += 1
                mid = seq[0]
                await ws.send(json.dumps({'id': mid, 'method': m, 'params': p or {}}))
                while True:
                    r = json.loads(await asyncio.wait_for(ws.recv(), 30))
                    if r.get('id') == mid:
                        return r.get('result', {})

            await send('Runtime.enable')

            async def ev(expr):
                r = await send('Runtime.evaluate', {
                    'expression': '(function(){try{%s}catch(x){return "EX:"+String(x)}})()' % expr,
                    'returnByValue': True})
                res = r.get('result', {})
                if 'exceptionDetails' in r:
                    return 'ERR'
                return res.get('value')

            return await fn(ev)
    finally:
        subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


async def phase1():
    os.makedirs(os.path.dirname(PROF), exist_ok=True)
    shutil.rmtree(PROF, ignore_errors=True)
    c, name, tok, rid = mkrole()

    async def body(ev):
        await ev('localStorage.setItem("token",%s); location.reload(); return 1;' % json.dumps(tok))
        await asyncio.sleep(13)
        await ev("var b=document.getElementById('annOk'); if(b)b.click(); return 1;")

        print('1) 打开设置的 UI 页')
        await ev("openSet('ui'); return 1;")
        await asyncio.sleep(0.8)
        print('   滑块当前值:', await ev(
            "return [document.getElementById('sysMsgW').value,"
            " document.getElementById('sysMsgH').value,"
            " document.getElementById('sysMsgF').value];"))
        print('   拖动到 320 / 200 / 14')
        await ev("""
          var w=document.getElementById('sysMsgW'), h=document.getElementById('sysMsgH'), f=document.getElementById('sysMsgF');
          w.value=320; w.dispatchEvent(new Event('input',{bubbles:true}));
          h.value=200; h.dispatchEvent(new Event('input',{bubbles:true}));
          f.value=14;  f.dispatchEvent(new Event('input',{bubbles:true}));
          return 1;
        """)
        await asyncio.sleep(0.5)
        print('   框现在:', await ev(
            "var b=sysMsgEl(); return b.style.width+'x'+b.style.height+' @'+b.style.left+','+b.style.top;"))

        print('2) 键位模式拖动位置')
        await ev("uiEditToggle(); return 1;")
        await asyncio.sleep(0.5)
        await ev("""
          var b=document.getElementById('sysMsgBox');
          var r=b.getBoundingClientRect();
          var x=r.left+30, y=r.top+10;
          b.dispatchEvent(new PointerEvent('pointerdown',{clientX:x,clientY:y,bubbles:true,pointerId:1}));
          b.dispatchEvent(new PointerEvent('pointermove',{clientX:x+180,clientY:y+240,bubbles:true,pointerId:1}));
          b.dispatchEvent(new PointerEvent('pointerup',{clientX:x+180,clientY:y+240,bubbles:true,pointerId:1}));
          return 1;
        """)
        await asyncio.sleep(0.5)
        await ev("uiEditToggle(); try{closeSet();}catch(e){} return 1;")
        await asyncio.sleep(0.3)

        got = await ev("var b=sysMsgEl(); return b.style.left+','+b.style.top+' '+b.style.width+'x'+b.style.height;")
        stored = await ev("""
          return {w:localStorage.getItem('sysMsgW'),
                  h:localStorage.getItem('sysMsgH'),
                  f:localStorage.getItem('sysMsgSize'),
                  pos:(localStorage.getItem('uiPos_sysmsg_L')||localStorage.getItem('uiPos_sysmsg_P'))};
        """)
        print('   设置后:', got)
        print('   已存:', stored)
        json.dump({'tok': tok, 'got': got, 'stored': stored},
                  open(STATE, 'w', encoding='utf-8'), ensure_ascii=False)
        return got

    out = await with_page(body)
    print()
    print('★ 阶段1 完成。现在重启服务器，再跑 phase2')
    print('   role_id=%s（阶段2 会清理）' % rid)
    json.dump({'tok': tok, 'rid': rid, 'got': out.get('got') if isinstance(out, dict) else out},
              open(STATE, 'w', encoding='utf-8'), ensure_ascii=False)


async def phase2():
    st = json.load(open(STATE, encoding='utf-8'))
    tok = st['tok']

    async def body(ev):
        await asyncio.sleep(13)
        await ev("var b=document.getElementById('annOk'); if(b)b.click(); return 1;")
        print('1) 页面刚加载时的 localStorage:')
        print('  ', await ev("""
          return {w:localStorage.getItem('sysMsgW'),
                  h:localStorage.getItem('sysMsgH'),
                  f:localStorage.getItem('sysMsgSize'),
                  pos:(localStorage.getItem('uiPos_sysmsg_L')||localStorage.getItem('uiPos_sysmsg_P'))};
        """))
        await ev("toast('重启服务器后测试'); return 1;")
        await asyncio.sleep(0.8)
        print('2) 提示框恢复后:')
        got = await ev("var b=sysMsgEl(); return b.style.left+','+b.style.top+' '+b.style.width+'x'+b.style.height;")
        print('  ', got)
        print('   SYSMSG:', await ev("return [SYSMSG.W, SYSMSG.H, SYSMSG.SIZE];"))
        ok = await ev("return SYSMSG.W===320 && SYSMSG.H===200 && SYSMSG.SIZE===14;")
        print()
        print('★ 尺寸恢复成功:', ok)
        print('★ 阶段1 设置的是:', st.get('got') or '(见 phase1 输出)')
        return got

    await with_page(body)
    shutil.rmtree(PROF, ignore_errors=True)


if __name__ == '__main__':
    phase = sys.argv[1] if len(sys.argv) > 1 else 'phase1'
    if phase == 'phase1':
        asyncio.run(phase1())
    else:
        asyncio.run(phase2())
        # 清理测试角色
        try:
            st = json.load(open(STATE, encoding='utf-8'))
            rid = st.get('rid')
            if rid:
                c = sqlite3.connect(os.path.join(ROOT, 'server', 'game.db'))
                drop(c, rid)
                print('cleanup 完成')
        except Exception as e:
            print('cleanup 跳过:', e)
