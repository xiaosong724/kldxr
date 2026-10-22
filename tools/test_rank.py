# -*- coding: utf-8 -*-
"""round424：排行榜的永久回归测试

覆盖方案 §9 的 1~6、10、11、13、14（服务端那一半）：
  · 五个榜的排序与同分规则（魔气榜：击杀玩家优先，同数看魔气）
  · 只排前 100 名 · 每页 10 个 · 第 11 页翻不到
  · 我的名次永远可见（哪怕 121 名）
  · 测试号不上榜 / 缓存 / 参数校验
  · 统计落库（role_stats）与重启后不丢

跑法：python tools\\test_rank.py
★ 会临时插 120 个假角色 + 少量测试数据，跑完【全部删除】✓
"""
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
sys.path.insert(0, os.path.join(_ROOT, 'server'))

import db as dbmod          # noqa: E402
import rankboard as rb      # noqa: E402
import auth as authmod      # noqa: E402

ORIGIN = 'http://127.0.0.1:8899'
FAILS = []


def ok(cond, msg, got=None):
    if cond:
        print('  PASS  ' + msg)
    else:
        FAILS.append(msg)
        print('  FAIL  ' + msg + ('   got=%r' % (got,)))


def cfg():
    with open(os.path.join(_ROOT, 'server', 'config.json'), encoding='utf-8') as f:
        c = json.load(f)
    c['db'] = c['db'].replace('${HERE}', os.path.join(_ROOT, 'server'))
    return c


C = cfg()
SKIP = C.get('test_name_keys') or []
MARK = 'RkZ'          # 假角色名前缀（方便一把删干净）


def post(path, body):
    r = urllib.request.Request(ORIGIN + path, data=json.dumps(body).encode(),
                               headers={'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(r).read().decode())


def get(path, token=None, admin=None):
    h = {}
    if token:
        h['X-Token'] = token
    if admin:
        h['X-Admin'] = admin
    r = urllib.request.Request(ORIGIN + path, headers=h)
    try:
        with urllib.request.urlopen(r) as f:
            return json.loads(f.read().decode())
    except urllib.error.HTTPError as e:
        return {'HTTP': e.code, 'body': e.read().decode()[:200]}


_ADM = [None]


def admin_tok():
    """管理员 token（强刷榜单用）"""
    if _ADM[0] is None:
        d = post('/api/admin/login', {'password': C.get('admin_password') or 'xiuxian-admin'})
        _ADM[0] = d.get('token') or ''
    return _ADM[0]


def rank_refresh():
    """让服务器立刻重算榜单（?force=1 只给管理员 ✓）"""
    get('/api/rank?board=level&force=1', admin=admin_tok())


def cleanup():
    with dbmod.db(C) as c:
        # ★ 清所有 Rk 开头的测试号（截图脚本/冒烟都用这个前缀 ✗ 漏一个就会影响排序 ✓）
        for r in c.execute("SELECT id FROM roles WHERE name LIKE 'Rk%'").fetchall():
            c.execute('DELETE FROM role_stats WHERE role_id=?', (r[0],))
        c.execute("DELETE FROM roles WHERE name LIKE 'Rk%'")
        c.execute("DELETE FROM accounts WHERE name LIKE 'Rk%'")
        c.commit()


print('== 0 准备：清掉上次残留 + 插 120 个假角色 ==')
cleanup()
now = dbmod.now_ms()
with dbmod.db(C) as c:
    made = []
    for i in range(1, 121):
        cur = c.execute(
            'INSERT INTO accounts(name, pass_hash, salt, created_at, last_login)'
            ' VALUES(?,?,?,?,NULL)', ('%s%03d' % (MARK, i), 'x', 'x', now))
        aid = cur.lastrowid
        cur = c.execute(
            'INSERT INTO roles(account_id, name, level, exp, hp, qi, x, z, yaw,'
            ' talent_free, created_at, updated_at, mq, mq_at, gold, title_board)'
            ' VALUES(?,?,?,?,100,0,0,0,0,0,?,?,0,0,0,\'\')',
            (aid, '%s%03d' % (MARK, i), i, i * 10, now, now))
        rid = cur.lastrowid
        made.append(rid)
        # 一半给点金币 / 击杀，方便看排序
        c.execute('INSERT INTO role_stats(role_id, kills, deaths, pvp_kills, play_sec, updated_at)'
                  ' VALUES(?,?,0,0,?,?)',
                  (rid, i if i <= 50 else 0, i * 60 if i <= 30 else 0, now))
        if i <= 40:
            c.execute('UPDATE roles SET gold=? WHERE id=?', (i * 1000, rid))
        if i == 40:
            c.execute('UPDATE roles SET gold=5000000 WHERE id=?', (rid,))
    c.commit()
print('   插了 %d 个' % len(made))

# 同层不同经验（境界榜：层数一样时比经验 ✓）
with dbmod.db(C) as c:
    for nm, exp_v in (('RkZ同层低', 10), ('RkZ同层高', 999)):
        cur = c.execute(
            'INSERT INTO accounts(name, pass_hash, salt, created_at, last_login)'
            ' VALUES(?,?,?,?,NULL)', (nm, 'x', 'x', now))
        c.execute(
            'INSERT INTO roles(account_id, name, level, exp, hp, qi, x, z, yaw,'
            ' talent_free, created_at, updated_at, mq, mq_at, gold, title_board)'
            ' VALUES(?,?,77,?,100,0,0,0,0,0,?,?,0,0,0,\'\')',
            (cur.lastrowid, nm, exp_v, now, now))
    c.commit()

# 三个同分测试号（魔气榜同分看魔气）
with dbmod.db(C) as c:
    trio = []
    for nm, pvp, mqv in (('RkZ甲', 2, 10), ('RkZ乙', 2, 99), ('RkZ丙', 3, 0)):
        cur = c.execute(
            'INSERT INTO accounts(name, pass_hash, salt, created_at, last_login)'
            ' VALUES(?,?,?,?,NULL)', (nm, 'x', 'x', now))
        cur2 = c.execute(
            'INSERT INTO roles(account_id, name, level, exp, hp, qi, x, z, yaw,'
            ' talent_free, created_at, updated_at, mq, mq_at, gold, title_board)'
            ' VALUES(?,?,1,0,100,0,0,0,0,0,?,?,?,0,0,\'\')',
            (cur.lastrowid, nm, now, now, mqv))
        rid = cur2.lastrowid
        c.execute('INSERT INTO role_stats(role_id, kills, deaths, pvp_kills, play_sec, updated_at)'
                  ' VALUES(?,0,0,?,0,?)', (rid, pvp, now))
        trio.append((nm, rid))
    c.commit()
print('   同分三兄弟: %s' % (trio,))

try:
    print('')
    print('== 1 rankboard.refresh：五个榜都在，排序对 ==')
    rows = rb.refresh(C, SKIP)
    ok(set(rows.keys()) == set(rb.KEYS), '★ 刚好 5 个榜（境界/财富/屠戮/魔气/在线）', list(rows.keys()))

    lv = rows['level']
    _names = [x['name'] for x in lv]
    _i120 = _names.index('%s120' % MARK)
    _i119 = _names.index('%s119' % MARK)
    ok(_i120 < _i119, '★ 境界榜：120 级排在 119 级前面', (_i120, _i119))
    ok(lv[0]['v'] == max(x['v'] for x in lv), '★ 境界榜第一 = 全表最高级', lv[0])
    ok(len(lv) >= 121, '★ 全量返回（要算"我的名次"）', len(lv))
    ok(all(str(x['sub']).startswith('炼气 ') and str(x['sub']).endswith(' 层') for x in lv[:50]),
       '★★ 境界榜显示的是「炼气 N 层」（不是经验 ✓）', lv[0]['sub'])
    _n = [x['name'] for x in lv]
    _il = _n.index('RkZ同层低')
    _ih = _n.index('RkZ同层高')
    ok(_ih < _il, '★★ 同一层时按经验排（高经验在前 ✓）', (_ih, _il))

    mq = rows['mq']
    names = [x['name'] for x in mq[:3]]
    print('   魔气榜前三: %s' % names)
    ok(names == ['RkZ丙', 'RkZ乙', 'RkZ甲'],
       '★★ 魔气榜：击杀数优先，同数看魔气（丙3 > 乙2/mq99 > 甲2/mq10）', names)

    gd = rows['gold']
    ok(gd[0]['v'] == 5000000, '★ 财富榜第一 = 500 万金币（压过真实玩家的 36 万）', gd[0]['v'])

    kl = rows['kills']
    _kn = [x['name'] for x in kl]
    ok(kl[0]['v'] == max(x['v'] for x in kl),
       '★ 屠戮榜第一 = 全表最高击杀数', kl[0])
    ok(_kn.index('%s050' % MARK) < _kn.index('%s049' % MARK),
       '★ 屠戮榜：50 杀的排在 49 杀前面', (_kn.index('%s050' % MARK), _kn.index('%s049' % MARK)))

    tm = rows['time']
    _tn = [x['name'] for x in tm]
    ok(tm[0]['v'] == max(x['v'] for x in tm), '★ 在线榜第一 = 全表最高在线时长', tm[0])
    ok(_tn.index('%s030' % MARK) < _tn.index('%s029' % MARK),
       '★ 在线榜：1800 秒的排在 1740 秒前面', (_tn.index('%s030' % MARK), _tn.index('%s029' % MARK)))

    print('')
    print('== 2 测试号不上榜 ==')
    with dbmod.db(C) as c:
        c.execute('INSERT INTO accounts(name, pass_hash, salt, created_at) VALUES(?,?,?,?)',
                  ('测试榜', 'x', 'x', now))
        c.execute('INSERT INTO roles(account_id, name, level, created_at, updated_at)'
                  ' SELECT id, ?, 999, ?, ? FROM accounts WHERE name=?',
                  ('测试榜', now, now, '测试榜'))
        c.commit()
    rows2 = rb.refresh(C, SKIP)
    ok(all('测试榜' not in [x['name'] for x in rows2[k]] for k in rb.KEYS),
       '★★ 名字里带"测试"的整个不上榜（5 个榜都验了）')

    print('')
    print('== 3 /api/rank：前 100 · 每页 10 · 页数 ==')
    d = get('/api/rank?board=level&page=1&size=10')
    ok(d.get('ok') and d.get('board') == 'level', '★ 接口通', d.get('error'))
    ok(d.get('topN') == 100, '★ topN = 100', d.get('topN'))
    ok(d.get('pages') == 10, '★★ 前 100 名 → 10 页（每页 10 个）', d.get('pages'))
    ok(len(d.get('rows') or []) == 10, '★ 第一页 10 条', len(d.get('rows') or []))
    ok([r['r'] for r in d['rows']][:3] == [1, 2, 3], '★ 名次从 1 开始连号', d['rows'][:2])
    ok(d['rows'][0].get('medal') == 1 and d['rows'][1].get('medal') == 2,
       '★ 前三名带奖牌号（1/2/3）', [r.get('medal') for r in d['rows'][:4]])

    d10 = get('/api/rank?board=level&page=10&size=10')
    ok([r['r'] for r in d10['rows']] == list(range(91, 101)),
       '★★ 第 10 页 = 91~100 名', [r['r'] for r in d10['rows']][:3])
    d11 = get('/api/rank?board=level&page=11&size=10')
    ok(len(d11.get('rows') or []) == 0, '★★ 第 11 页是空的（只排前 100）', d11.get('rows'))

    print('')
    print('== 4 我的名次（含没进前 100 的情况）==')
    nm = MARK + 'ME'
    reg = post('/api/register', {'name': nm, 'password': 'abc123456'})
    tok = reg.get('token') or ''
    ok(bool(tok), '★ 注册测试号', reg)
    # ★ 把他改成「当前最高级 + 10」✗ 不写死 999（真实玩家也许比 999 还高 ✗）✓
    with dbmod.db(C) as c:
        _mx = int(c.execute('SELECT MAX(level) FROM roles').fetchone()[0] or 1)
        c.execute('UPDATE roles SET level=? WHERE name=?', (_mx + 10, nm))
        c.commit()
    rank_refresh()
    d = get('/api/rank?board=level&page=1&size=10', tok)
    ok((d.get('me') or {}).get('r') == 1, '★★ 最高级+10 → 我的名次 = 1', d.get('me'))
    ok((d.get('me') or {}).get('in100') is True, '★ in100 = True（能挂称号）', d.get('me'))
    with dbmod.db(C) as c:
        c.execute('UPDATE roles SET level=1 WHERE name=?', (nm,))
        c.commit()
    rank_refresh()
    d = get('/api/rank?board=level&page=1&size=10', tok)
    me = d.get('me') or {}
    ok(me.get('r', 0) > 100, '★★ 掉到 121 名以后 → 名次照样给你（%s）' % me.get('r'), me)
    ok(me.get('in100') is False, '★★ 没进前 100 → in100 = False（头顶不挂称号）', me)

    print('')
    print('== 5 参数校验 / 缓存 ==')
    ok(get('/api/rank?board=nope').get('HTTP') == 400, '★ 乱传 board → 400')
    d2 = get('/api/rank?board=level&page=1&size=999')
    ok(len(d2.get('rows') or []) <= 20, '★ size 有上限（不会一次吐 100 条）',
       len(d2.get('rows') or []))
    c1 = get('/api/rank?board=gold').get('cacheAge')
    c2 = get('/api/rank?board=gold').get('cacheAge')
    ok(c1 is not None and c2 is not None and c2 >= c1, '★ 有缓存（cacheAge 在涨）', (c1, c2))

    print('')
    print('== 6 role_stats 落库（重启不丢 → 这里验"库里有"）==')
    with dbmod.db(C) as c:
        r = c.execute('SELECT kills, play_sec FROM role_stats s JOIN roles r2'
                      ' ON r2.id = s.role_id WHERE r2.name = ?',
                      ('%s050' % MARK,)).fetchone()
    ok(r is not None and int(r['kills']) == 50,
       '★ 击杀数写进库了（重启后读回来就靠它）', r)
finally:
    print('')
    print('== 清理 ==')
    cleanup()
    with dbmod.db(C) as c:
        c.execute("DELETE FROM accounts WHERE name='测试榜'")
        for r in c.execute("SELECT id FROM roles WHERE name='测试榜'").fetchall():
            c.execute('DELETE FROM role_stats WHERE role_id=?', (r[0],))
        c.execute("DELETE FROM roles WHERE name='测试榜'")
        c.commit()
    print('   假角色已删')

if FAILS:
    print('')
    print('FAILED: %d 条 ✗' % len(FAILS))
    for f in FAILS:
        print('  - ' + f)
    sys.exit(1)
print('')
print('ALL PASS ✓')
