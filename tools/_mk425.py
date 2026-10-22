# -*- coding: utf-8 -*-
"""round425 部署：在 round423 的同步脚本上改三处

  ① 清单里加 server/rankboard.py（新文件 ✗ 漏传 = /api/rank 直接 500 ✓）
  ② 云端 config 的 qq 段【已经有了】→ 不再重复写（少一次动配置的风险 ✓）
  ③ 部署后多验一条：/api/rank 能不能出数据 + schema 是不是 10

跑法：python tools\\sync_cloud_round425.py
"""
import io

src = 'tools/sync_cloud_round423.py'
dst = 'tools/sync_cloud_round425.py'
s = io.open(src, encoding='utf-8').read()


def rep(old, new, tag):
    global s
    assert s.count(old) == 1, (tag, s.count(old))
    s = s.replace(old, new, 1)
    print('  ok:', tag)


# ① 清单加 rankboard.py
rep("""    'server/terrain.py',""",
    """    'server/terrain.py',
    # \u2605\u2605\u2605 round425\uff1a\u6392\u884c\u699c\uff08\u65b0\u6587\u4ef6\uff09\u2717 \u6f0f\u4f20 = /api/rank \u76f4\u63a5 500 \u2713
    'server/rankboard.py',""",
    'files')

# ② 配置补丁：已经有 qq 段就跳过
rep("""print('== 5/8 \u7ed9\u4e91\u7aef config.json \u52a0 qq \u6bb5\uff08\u53ea\u52a8 qq \u8fd9\u4e2a\u952e\uff09==')""",
    """print('== 5/8 \u4e91\u7aef config\uff1a\u5df2\u6709 qq \u6bb5\u5c31\u8df3\u8fc7\uff08\u4e0d\u52a8\u914d\u7f6e\u6700\u5b89\u5168 \u2713\uff09==')\n"
    "_has_qq = run('''sudo python3 -c \"import json;print('1' if json.load(open('/opt/xiuxian2d/server/config.json',encoding='utf-8')).get('qq') else '0')\"''').strip()\n"
    "if _has_qq == '1':\n"
    "    print('   \u4e91\u7aef\u5df2\u6709 qq \u6bb5 \u2192 \u8df3\u8fc7\uff08\u7fa4\u53f7\u4e0d\u4f1a\u88ab\u6539 \u2713\uff09')\n"
    "else:",
    'config skip')

# ③ 在最终结论前，多验一条「排行榜在云端能用」
rep("""c.close()
print('')
print('   \u2605 \u7ed3\u8bba\uff1a'""",
    """# \u2605\u2605 round425\uff1a\u6392\u884c\u699c\u4e13\u9879\u9a8c\u6536\uff08\u699c\u5355\u80fd\u51fa\u6570\u636e + schema \u5230 10\uff09
print('')
print('== 9/9 \u6392\u884c\u699c\u4e13\u9879 ==')
_sv = run('''sudo python3 -c "import sqlite3;print(sqlite3.connect('/opt/xiuxian2d/server/game.db')
.execute('select v from meta where k=\\\\"schema_version\\\\"').fetchone()[0])"''')
print('   \u4e91\u7aef schema: ' + _sv)
_tbl = run('''sudo python3 -c "import sqlite3;print([r[0] for r in sqlite3.connect('/opt/xiuxian2d/server/game.db')
.execute(\\\"select name from sqlite_master where type='table' and name='role_stats'\\\")])"''')
print('   role_stats \u8868: ' + _tbl)
try:
    _ap = json.loads(run('curl -s -m 6 "http://127.0.0.1:8899/api/rank?board=level&page=1&size=10"'))
    print('   /api/rank: ok=%s total=%s pages=%s rows=%d'
          % (_ap.get('ok'), _ap.get('total'), _ap.get('pages'), len(_ap.get('rows') or [])))
    if not _ap.get('ok'):
        allok = False
except Exception as _e:
    print('   /api/rank \u5931\u8d25: %r' % (_e,))
    allok = False

c.close()
print('')
print('   \u2605 \u7ed3\u8bba\uff1a'""",
    'rank verify')

io.open(dst, 'w', encoding='utf-8').write(s)
print('\u5199\u597d:', dst)
