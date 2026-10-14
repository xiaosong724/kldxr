# -*- coding: utf-8 -*-
"""P0-3 账号系统自测：注册 / 登录 / token / 退避 / 密码存储"""
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request

API = 'http://127.0.0.1:8899'
DB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'server', 'game.db')
N1, N2, N3 = '测试账号甲', '测试账号乙', '测试账号丙'
PW = 'abc123456'
fails = []


def call(method, path, body=None, token=None):
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header('Content-Type', 'application/json; charset=utf-8')
    if token:
        req.add_header('X-Token', token)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode('utf-8'))
        except Exception:
            return e.code, {}
    except Exception as e:
        return -1, {'error': repr(e)}


def ok(cond, msg, got=None):
    print(('  PASS  ' if cond else '  FAIL  ') + msg + ('' if cond else '   got=' + repr(got)))
    if not cond:
        fails.append(msg)


def cleanup():
    c = sqlite3.connect(DB)
    for n in (N1, N2, N3):
        row = c.execute('SELECT id FROM accounts WHERE name=?', (n,)).fetchone()
        if row:
            c.execute('DELETE FROM tokens WHERE account_id=?', (row[0],))
            c.execute('DELETE FROM skill_pages WHERE role_id IN'
                      ' (SELECT id FROM roles WHERE account_id=?)', (row[0],))
            c.execute('DELETE FROM roles WHERE account_id=?', (row[0],))
            c.execute('DELETE FROM accounts WHERE id=?', (row[0],))
    c.commit()
    left = [r[0] for r in c.execute('SELECT name FROM accounts')]
    c.close()
    print('  清理后剩余账号:', left)


cleanup()
try:
    print('== ① 注册 ==')
    st, j = call('POST', '/api/register', {'name': N1, 'password': PW})
    ok(st == 200 and j.get('ok') and j.get('token'), '注册成功并直接返回 token', (st, j))
    tok1 = j.get('token')
    role = j.get('role') or {}
    ok(role.get('level') == 1 and role.get('exp') == 0, '角色初始 炼气1级/0经验', role)
    ok(role.get('talentFree') == 3, '新手送 3 点天赋', role.get('talentFree'))

    print('== ② 注册的各种拒绝 ==')
    st, j = call('POST', '/api/register', {'name': N1, 'password': PW})
    ok(st == 400 and '已经被用' in str(j.get('error')), '重名被拒', (st, j))
    st, j = call('POST', '/api/register', {'name': '测', 'password': PW})
    ok(st == 400, '名字太短被拒', (st, j))
    st, j = call('POST', '/api/register', {'name': 'bad name!', 'password': PW})
    ok(st == 400, '名字含非法字符被拒', (st, j))
    st, j = call('POST', '/api/register', {'name': N2, 'password': '123'})
    ok(st == 400 and '至少' in str(j.get('error')), '密码太短被拒', (st, j))

    print('== ③ 大小写不敏感 ==')
    st, j = call('POST', '/api/register', {'name': 'TestCaseUser', 'password': PW})
    if st == 200:
        st2, j2 = call('POST', '/api/register', {'name': 'testcaseuser', 'password': PW})
        ok(st2 == 400, '大小写不同也算重名', (st2, j2))
        call('POST', '/api/logout', token=j.get('token'))
        c = sqlite3.connect(DB)
        c.execute("DELETE FROM accounts WHERE name='TestCaseUser'")
        c.commit()
        c.close()

    print('== ④ 登录 ==')
    st, j = call('POST', '/api/login', {'name': N1, 'password': '错误密码'})
    ok(st == 401 and '不对' in str(j.get('error')), '密码错 → 401', (st, j))
    st, j = call('POST', '/api/login', {'name': '不存在的名字', 'password': PW})
    ok(st == 401 and '不对' in str(j.get('error')), '账号不存在 → 同样的话（不泄露名字是否存在）', (st, j))
    st, j = call('POST', '/api/login', {'name': N1, 'password': PW})
    ok(st == 200 and j.get('token'), '正确密码登录成功', (st, j))
    tok2 = j.get('token')

    print('== ⑤ 单点在线（新登录踢旧 token）==')
    st, j = call('GET', '/api/profile', token=tok1)
    ok(st == 401, '旧 token 已失效', (st, j))
    st, j = call('GET', '/api/profile', token=tok2)
    ok(st == 200 and (j.get('role') or {}).get('name') == N1, '新 token 有效', (st, j))

    print('== ⑥ token 校验 ==')
    st, j = call('GET', '/api/profile')
    ok(st == 401, '不带 token → 401', (st, j))
    st, j = call('GET', '/api/profile', token='fake-token-12345')
    ok(st == 401, '假 token → 401', (st, j))
    st, j = call('GET', '/api/profile', token="' OR '1'='1")
    ok(st == 401, 'SQL 注入样式的 token → 401（参数化查询挡住了）', (st, j))
    st, j = call('GET', '/api/profile', token='x' * 500)
    ok(st == 401, '超长 token → 401（不崩）', (st, j))
    st, j = call('GET', '/api/profile?token=' + tok2)
    ok(st == 200, '支持 ?token= 形式（浏览器自测方便）', (st, j))

    print('== ⑥b 坏请求体 ==')
    req = urllib.request.Request(API + '/api/login',
                                 data='{不是json'.encode('utf-8'), method='POST')
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            st, j = r.status, json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        st, j = e.code, json.loads(e.read().decode('utf-8'))
    ok(st == 400 and 'JSON' in str(j.get('error')), '请求体不是 JSON → 400', (st, j))

    print('== ⑦ 退出 ==')
    st, j = call('POST', '/api/logout', token=tok2)
    ok(st == 200, '退出返回 200', (st, j))
    st, j = call('GET', '/api/profile', token=tok2)
    ok(st == 401, '退出后 token 失效', (st, j))

    print('== ⑧ 密码存储安全 ==')
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    a = c.execute('SELECT * FROM accounts WHERE name=?', (N1,)).fetchone()
    ok(a is not None, '账号在库里')
    ok(a['pass_hash'] != PW and PW not in a['pass_hash'], '库里没有明文密码', a['pass_hash'][:20])
    ok(len(a['pass_hash']) == 64, 'PBKDF2-SHA256 哈希 64 位十六进制', len(a['pass_hash']))
    ok(len(a['salt']) == 32, '每账号独立 16 字节盐', len(a['salt']))
    sp = c.execute('SELECT COUNT(*) FROM skill_pages WHERE role_id='
                   '(SELECT id FROM roles WHERE account_id=?)', (a['id'],)).fetchone()[0]
    ok(sp == 4, '建角色时开了 4 个技能页', sp)
    c.close()

    print('== ⑨ 登录失败退避（挡暴力破解）==')
    call('POST', '/api/register', {'name': N3, 'password': PW})
    for i in range(5):
        call('POST', '/api/login', {'name': N3, 'password': '错的%d' % i})
    st, j = call('POST', '/api/login', {'name': N3, 'password': PW})
    ok(st == 401 and '秒后再试' in str(j.get('error')),
       '连续失败 5 次后进入退避（连正确密码也先挡住）', (st, j.get('error')))
finally:
    cleanup()

print()
print('ALL PASS' if not fails else 'FAILED: %d' % len(fails))
sys.exit(1 if fails else 0)
