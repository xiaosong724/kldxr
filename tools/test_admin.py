# -*- coding: utf-8 -*-
"""离线/接口测试：后台管理（server/admin.py + app.py 的 /api/admin/*）

为什么要专门测：这一轮做的事本质是【把能力收起来】——
  玩家端不该有的（刷怪/发武器）+ 不该看到的信息（账号数/角色数）✗
  "收起来"这种东西最容易做一半：页面上藏了，接口还开着 ✗
  所以每条都要拿【没登录的身份】去试一遍，确认真的被拒 ✓

跑法：先起服务端，然后 python tools\\test_admin.py
  可选：ADMIN_PW 环境变量指定管理密码（默认读 config.json）
"""
import json
import os
import sys
import urllib.error
import urllib.request

HOST = os.environ.get('ADMIN_HOST', 'http://127.0.0.1:8899')
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, 'server'))

fails = []


def ok(cond, msg, got=None):
    if cond:
        print('  PASS  ' + msg)
    else:
        fails.append(msg)
        print('  FAIL  ' + msg + ('   got=%r' % (got,)))


def req(path, method='GET', body=None, headers=None):
    """返回 (状态码, 解析后的 JSON 或原始文本)"""
    data = None
    h = dict(headers or {})
    if body is not None:
        data = json.dumps(body).encode('utf-8')
        h['Content-Type'] = 'application/json'
    r = urllib.request.Request(HOST + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=8) as fp:
            raw = fp.read().decode('utf-8', 'replace')
            code = fp.status
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8', 'replace')
        code = e.code
    except Exception as e:
        return 0, str(e)
    try:
        return code, json.loads(raw)
    except Exception:
        return code, raw


# 读配置里的管理密码（和服务器一致 ✓）
cfgp = os.path.join(HERE, 'server', 'config.json')
with open(cfgp, 'r', encoding='utf-8') as f:
    CFG = json.load(f)
PW = os.environ.get('ADMIN_PW') or CFG.get('admin_password') or ''

print('== ① /api/health 不该再吐内部信息（用户要求搬走）==')
code, h = req('/api/health')
ok(code == 200, '/api/health 还是通的（它得留着做健康检查 ✓）', code)
if isinstance(h, dict):
    leak = [k for k in ('accounts', 'roles', 'db', 'schema') if k in h]
    ok(not leak, '★ 账号数/角色数/数据库路径这些【内部信息】已经不在这里了 ✓（还剩：%r）' % (leak,), sorted(h))
    ok('world' in h and 'online' in (h.get('world') or {}), '该有的还在（world.online ✓）', h.get('world'))

print('')
print('== ② 管理页本身可以公开，但数据接口不行 ==')
code, page = req('/admin')
ok(code == 200 and isinstance(page, str) and '后台管理' in page,
   '/admin 能打开（只是个空壳页 ✓）', code)
code, r = req('/api/admin/status')
ok(code == 401, '★★ 没登录拿不到状态（401 ✓）', code)
code, r = req('/api/admin/players')
ok(code == 401, '★★ 没登录拿不到玩家列表（401 ✓）', code)
code, r = req('/api/admin/status', headers={'X-Admin': 'garbage-token-xxx'})
ok(code == 401, '★★ 乱编一个 token 也不行（401 ✓）', code)
code, r = req('/api/admin/act', 'POST', {'act': 'spawn', 'name': 'x', 'n': 5})
ok(code == 401, '★★ 没登录【发动作】也必须被拒（这条最要紧 —— 不然刷怪能力等于没关 ✓）', code)

print('')
print('== ③ 登录：错的进不来，对的进得来 ==')
code, r = req('/api/admin/login', 'POST', {'password': 'definitely-wrong'})
ok(code == 401, '错密码 → 401 ✓', code)
code, r = req('/api/admin/login', 'POST', {'password': ''})
ok(code == 401, '空密码 → 401 ✓', code)
if not PW:
    print('  [跳过] 配置里没有 admin_password')
    TOKEN = None
else:
    code, r = req('/api/admin/login', 'POST', {'password': PW})
    ok(code == 200 and isinstance(r, dict) and r.get('token'),
       '★ 正确密码 → 发 token（%s…）' % (str((r or {}).get('token'))[:10]), code)
    TOKEN = (r or {}).get('token') if isinstance(r, dict) else None

if TOKEN:
    print('')
    print('== ④ 登录之后：该给的给，不该给的拒 ==')
    H = {'X-Admin': TOKEN}
    code, s = req('/api/admin/status', headers=H)
    ok(code == 200 and isinstance(s, dict) and 'stat' in s,
       '★ 能读到世界状态（在线 %s / 僵尸 %s / tick %s）'
       % ((s.get('stat') or {}).get('online'), (s.get('stat') or {}).get('mobs'),
          (s.get('stat') or {}).get('tick')), code)
    ok(isinstance(s.get('accounts'), int) and isinstance(s.get('roles'), int),
       '★ 账号数/角色数【搬到这里】了（账号 %s / 角色 %s ✓）'
       % (s.get('accounts'), s.get('roles')))
    ok('playerDebug' in s, '★ 状态里会告诉管理员"玩家端调试能力开没开"（%s ✓）' % s.get('playerDebug'))
    code, pl = req('/api/admin/players', headers=H)
    ok(code == 200 and isinstance(pl, dict) and isinstance(pl.get('players'), list),
       '★ 能读到玩家列表（%d 个 ✓）' % len((pl or {}).get('players') or []), code)
    code, r = req('/api/admin/act', 'POST', {'act': 'nonsense'}, headers=H)
    ok(code == 400, '不认识的动作 → 400 ✓（别让管理接口变成万能执行器 ✗）', code)
    code, r = req('/api/admin/act', 'POST', {'act': 'say', 'text': '管理员测试：这是一条公告 ✓'}, headers=H)
    ok(code == 200, '★ 喊话动作被接受（200 ✓）', code)
    # 退出之后立刻失效
    req('/api/admin/logout', 'POST', {}, headers=H)
    code, r = req('/api/admin/status', headers=H)
    ok(code == 401, '★★ 退出管理的 token 立刻失效（401 ✓）', code)

print('')
print('== ⑤ 登录限速（直接调模块，用一个假 IP，不污染真 IP 的记录）==')
try:
    import admin as adminmod
    fake = '10.9.9.9'
    locked_at = None
    for i in range(adminmod.FAIL_MAX + 3):
        good, why = adminmod.login(CFG, 'wrong-password', fake)
        if not good and '太多' in str(why):
            locked_at = i
            break
    ok(locked_at is not None,
       '★★ 连续输错会锁（第 %s 次开始拒绝 ✓ FAIL_MAX=%d）' % (locked_at, adminmod.FAIL_MAX), locked_at)
    # 正确密码也得等（限速是按 IP 的 ✓）
    good, why = adminmod.login(CFG, PW or 'x', fake)
    ok(not good, '★ 锁住期间连正确密码也不放行（防爆破 ✓）', why)
    _fails = getattr(adminmod, '_fails', {})
    _fails.pop(fake, None)                    # 清理，别影响别的
    print('       [清理] 假 IP 的失败记录已清掉 ✓')
except Exception as e:
    ok(False, '模块级限速测试出错：%r' % (e,))

print('')
if fails:
    print('FAILED: %d 条 ✗' % len(fails))
    for f in fails:
        print('  - ' + f)
    sys.exit(1)
print('ALL PASS ✓')
