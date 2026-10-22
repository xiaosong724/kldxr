# -*- coding: utf-8 -*-
"""round425：把「排行榜」这批同步到云端 43.138.171.250

和 round423 那次的区别（教训都在注释里）：
  ① 清单里必须有 `server/rankboard.py`（新文件 ✗ 漏传 = /api/rank 直接 500）
  ② 云端 config.json 的 qq 段【已经配好了】→ 这次一个字节都不动配置 ✓
  ③ 部署后多验一条：schema 到 10、role_stats 表在、/api/rank 能出数据

流程：备份 → 停服 → 传 → 逐个 cp → 起服（自动跑 v9→v10 迁移）→ 内外网各验一遍
跑法：python tools\\sync_cloud_round425.py
"""
import io
import json
import os
import time
import urllib.request

import paramiko

HOST = '43.138.171.250'
USER = 'ubuntu'
PW = io.open(os.path.expanduser('~/.xiuxian_deploy'), encoding='utf-8').read().strip()
ROOT = 'C:/mc/xiuxian-2d'
REMOTE = '/home/ubuntu/xiuxian2d'
TS = time.strftime('%Y%m%d-%H%M%S')

FILES = [
    'server/db.py',           # v10 迁移（role_stats + roles.title_board + 索引）
    'server/rankboard.py',    # ★ 新文件：榜单定义 / 算榜 / 称号文本
    'server/world.py',        # 三个计数器 + 称号 + 快照 tt/tm + ranktitle 意图
    'server/app.py',          # /api/rank + 榜单刷新线程
    'server/auth.py',         # stats_of / title_board_of / set_title_board
    'server/net.py',          # 登录装载统计/称号 + ranktitle 写库
    'server/protocol.py',     # C2S ranktitle / S2C ranktitleok
    'web/core/game.js',       # 映射层 tt/tm + 称号渲染
    'web/platform/web.js',    # 排行页 + SVG 奖牌 + 称号按钮排
    'web/index.html',         # 设置里的「排行」页签
]

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PW, timeout=25)


def run(cmd, t=180):
    si, so, se = c.exec_command(cmd, timeout=t)
    return (so.read().decode('utf-8', 'ignore') + se.read().decode('utf-8', 'ignore')).strip()


def fetch(path, timeout=10):
    try:
        with urllib.request.urlopen('http://%s:8899%s' % (HOST, path), timeout=timeout) as f:
            return f.read().decode('utf-8', 'ignore')
    except Exception as e:
        print('   抓 %s 失败：%r' % (path, e))
        return ''


print('== 0/8 部署前体检 ==')
print('   服务: ' + run('systemctl is-active xiuxian'))
print('   schema: ' + run('''sudo python3 -c "import sqlite3;print(sqlite3.connect('/opt/xiuxian2d/server/game.db')
.execute('select v from meta where k=\\"schema_version\\"').fetchone()[0])"'''))
print('   在线人数: ' + run('curl -s -m 5 http://127.0.0.1:8899/api/health'))

print('')
print('== 1/8 备份（server 目录 + game.db）==')
bk = '/home/ubuntu/backup-' + TS
print('   ' + run('mkdir -p %s && sudo cp -a /opt/xiuxian2d/server/. %s/ && '
                  'sudo cp -a /opt/xiuxian2d/server/game.db %s/game.db.bak && '
                  'sudo chown -R ubuntu:ubuntu %s && du -sh %s' % (bk, bk, bk, bk, bk)))
print('   备份目录: ' + bk)

print('')
print('== 2/8 停服 ==')
print('   ' + run('sudo systemctl stop xiuxian; sleep 2; systemctl is-active xiuxian'))

print('')
print('== 3/8 传文件（%d 个）==' % len(FILES))
sftp = c.open_sftp()
for rel in FILES:
    lp = os.path.join(ROOT, rel.replace('/', os.sep))
    rp = REMOTE + '/' + rel
    run('mkdir -p %s' % os.path.dirname(rp))
    sftp.put(lp, rp)
    print('   %-24s %8d 字节' % (rel, os.path.getsize(lp)))
sftp.close()

print('')
print('== 4/8 逐个覆盖到 /opt（不用 cp -r ✗ 免得盖掉没传的）==')
cmds = ['sudo cp -f %s/%s /opt/xiuxian2d/%s' % (REMOTE, r, r) for r in FILES]
print('   ' + run(' && '.join(cmds) + ' && echo COPY_OK'))
print('   ' + run('sudo chown -R xiuxian:xiuxian /opt/xiuxian2d && '
                  'ls -la /opt/xiuxian2d/server/rankboard.py'))

print('')
print('== 5/8 语法自检（别让服务起不来）==')
print('   ' + run('cd /opt/xiuxian2d/server && sudo -u xiuxian python3 -c '
                  '"import ast,glob;[ast.parse(open(f,encoding=\'utf-8\').read()) '
                  'for f in glob.glob(\'*.py\')];print(\'AST OK\')"'))

print('')
print('== 6/8 起服务（会自动跑 schema v9 → v10，只加表/列/索引）==')
print('   ' + run('sudo systemctl start xiuxian; sleep 9; systemctl is-active xiuxian'))
print('   迁移日志: ' + (run('sudo journalctl -u xiuxian --since "-2 min" | grep -Ei "建表|迁移|schema|migrat" | tail -4') or '（无）'))
print('   tick 报错: ' + (run('sudo journalctl -u xiuxian --since "-2 min" | grep -F "tick] 出错" | tail -3') or '（没有 ✓）'))

print('')
print('== 7/8 服务端自测 ==')
print('   health: ' + run('curl -s -m 6 http://127.0.0.1:8899/api/health'))
print('   schema: ' + run('''sudo python3 -c "import sqlite3;print(sqlite3.connect('/opt/xiuxian2d/server/game.db')
.execute('select v from meta where k=\\"schema_version\\"').fetchone()[0])"'''))
print('   表: ' + run('''sudo python3 -c "import sqlite3;print([r[0] for r in sqlite3.connect('/opt/xiuxian2d/server/game.db')
.execute(\\\"select name from sqlite_master where type='table' and name in ('role_stats',)\\\")])"'''))
print('   /api/rank: ' + run('curl -s -m 6 "http://127.0.0.1:8899/api/rank?board=level&page=1&size=10" | head -c 260'))

print('')
print('== 8/8 从外网核对 ==')
allok = True
marks = {
    '/api/rank?board=level&page=1&size=10': ['"ok": true', '"topN": 100', '"pages"'],
    '/index.html': ['data-tab="rank"', 'rankTitleChips'],
    '/platform/web.js': ['function medalSvg', 'rankTitleChipsRender', 'ranktitleok'],
    '/core/game.js': ['tt: (typeof w.tt', 'MY_TT'],
}
for path, mks in marks.items():
    body = fetch(path, 12)
    if not body:
        print('   ✗ %s 抓不到' % path)
        allok = False
        continue
    for mk in mks:
        hit = (mk in body) if not path.startswith('/api/') else (mk in body)
        if not hit:
            allok = False
        print('   %s %-24s %s' % ('✓' if hit else '✗', mk, path))

try:
    d = json.loads(fetch('/api/rank?board=level&page=1&size=10', 12))
    print('')
    print('   境界榜首行: %s' % ((d.get('rows') or [{}])[0],))
    print('   总数/页数: %s / %s' % (d.get('total'), d.get('pages')))
except Exception as e:
    allok = False
    print('   ✗ /api/rank 解析失败：%r' % (e,))

c.close()
print('')
print('   ★ 结论：' + ('排行榜这批已经在云端生效了 ✓✓' if allok else '有缺的 ✗ 见上面 ✗ 那几行'))
print('   ★ 回滚：sudo systemctl stop xiuxian && sudo cp -a %s/. /opt/xiuxian2d/server/ '
      '&& sudo systemctl start xiuxian' % bk)
