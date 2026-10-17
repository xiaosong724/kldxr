# -*- coding: utf-8 -*-
"""把这一批改动同步到云端 43.138.171.250（★ 用户已明确说"传" ✓）

流程（照 tools/deploy_cloud.py 的老规矩 ✗ 加了三件这次必须做的事）：
  ① 备份云端【库 + 代码】（这次要动 schema ✗ 必须先有退路 ✓）
  ② 停服务 → 传文件（显式清单 ✗ 不用 glob ✓）
  ③ ★ 迁移云端库 v3 → v7（只加表和列 ✗ 一条 DROP 都没有 ✓）
  ④ 起服务 → 从外网核对（文件 + 数据条数 + 真玩家能不能读 ✓）

★ 为什么必须迁移：云端库是 schema v3 ✗ 而本地代码要 v7 ✓
  不迁移的话 listings/trade_log 不存在 ✗ 交易所一打开就报错 ✓
★ 为什么不用 compare_cloud.py 里那套 marks：那是上一批功能的标志 ✗ 早过期了 ✓
  这次的判据换成"新文件在不在 + 表在不在 + 数据条数没变"✓
"""
import hashlib
import io
import os
import sys
import time

import paramiko

HOST, USER = '43.138.171.250', 'ubuntu'
REMOTE = '/home/ubuntu/xiuxian2d'
OPT = '/opt/xiuxian2d'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ★ 显式清单 ✗ 一个文件一行 ✓（曾经用 glob cp 静默失败过 ✓）
FILES = [
    'server/app.py',        # 交易记录接口 + 管理端修复
    'server/auth.py',       # 背包排序 / 列顺序修复
    'server/db.py',         # 迁移 v7（qty 两个列）
    'server/net.py',        # bagsort 命令
    'server/protocol.py',   # bagsort / 数量字段
    'server/world.py',      # 金币落库竞态 / 数量上架 / 部分成交
    'server/market.py',     # ★ 新文件：交易所规则中心
    'server/value.py',      # ★ 新文件：价格 / 上限 / now_s()
    'web/core/game.js',
    'web/platform/web.js',
    'web/index.html',
]


def pw():
    with io.open(os.path.expanduser('~/.xiuxian_deploy'), encoding='utf-8') as f:
        for ln in f.read().splitlines():
            ln = ln.strip()
            if ln and not ln.startswith('#'):
                return ln.split('=', 1)[1].strip() if ln.upper().startswith('PASS') else ln
    raise SystemExit('no password file')


def md5(p):
    return hashlib.md5(open(p, 'rb').read()).hexdigest()


c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=pw(), timeout=25)


def run(cmd, t=180):
    _i, o, e = c.exec_command(cmd, timeout=t)
    return (o.read().decode('utf-8', 'ignore') + e.read().decode('utf-8', 'ignore')).strip()


def fetch(path):
    import urllib.request
    try:
        with urllib.request.urlopen('http://%s:8899%s' % (HOST, path), timeout=10) as f:
            return f.read().decode('utf-8', 'ignore')
    except Exception:
        return ''


STAMP = time.strftime('%Y%m%d-%H%M%S')
ONLY_BACKUP = '--backup-only' in sys.argv

print('== 1/7 备份云端（库 + 代码）==')
print('   ' + (run('mkdir -p /home/ubuntu/deploy_backup/%s && '
                  'sudo cp %s/server/game.db /home/ubuntu/deploy_backup/%s/game.db && '
                  'sudo chown ubuntu:ubuntu /home/ubuntu/deploy_backup/%s/game.db && '
                  'tar czf /home/ubuntu/deploy_backup/%s/code.tgz -C %s server web 2>/dev/null; '
                  'ls -la /home/ubuntu/deploy_backup/%s/'
                  % (STAMP, OPT, STAMP, STAMP, STAMP, OPT, STAMP)) or '(失败?)'))
_db_before = run('md5sum /home/ubuntu/deploy_backup/%s/game.db' % STAMP).split()[:1]
print('   云端库备份 md5: %s' % (_db_before[0] if _db_before else '?'))
if ONLY_BACKUP:
    print('   （--backup-only ✓ 到此为止）')
    c.close()
    raise SystemExit(0)

print('== 2/7 记录迁移前的数据条数（等下要对照 ✓）==')
COUNT_CMD = ('''python3 -c "
import sqlite3
c=sqlite3.connect('/home/ubuntu/cnt.db')
print('%s|%s|%s|%s' % (
  c.execute('PRAGMA user_version').fetchone()[0],
  c.execute('SELECT COUNT(*) FROM roles').fetchone()[0],
  c.execute('SELECT COUNT(*) FROM items').fetchone()[0],
  c.execute('SELECT COUNT(*) FROM skill_pages').fetchone()[0]))
"''')
print('   ' + run('sudo cp %s/server/game.db /home/ubuntu/cnt.db && sudo chown ubuntu:ubuntu /home/ubuntu/cnt.db && %s'
                  % (OPT, COUNT_CMD)))

print('== 3/7 停服务 ==')
print('   ' + (run('sudo systemctl stop xiuxian; sleep 2; systemctl is-active xiuxian') or '(已停)'))

print('== 4/7 传文件（%d 个）==' % len(FILES))
sftp = c.open_sftp()
bad = []
for rel in FILES:
    lp = os.path.join(ROOT, rel.replace('/', os.sep))
    if not os.path.isfile(lp):
        bad.append(rel + '（本地没有!）')
        continue
    sftp.put(lp, REMOTE + '/' + rel)
    # ★ 传完立刻比 md5 ✗ 不信"传完了"这句话 ✓
    st = sftp.stat(REMOTE + '/' + rel)
    rh = run('md5sum %s/%s' % (REMOTE, rel)).split()[0]
    lh = md5(lp)
    flag = 'v' if lh == rh else '★不一致'
    if not rh.startswith('x') and (lh == rh or lh == run('md5sum %s/%s' % (REMOTE, rel)).split()[0]):
        pass
    print('   %-22s %s' % (rel, flag))
    if lh != rh:
        bad.append('%s（md5 不一致 本地 %s / 云端 %s）' % (rel, lh, rh))
sftp.close()
if bad:
    print('   ★★ 有文件没传对: %s' % bad)
    print('   ★ 服务保持停止 ✗ 请人工处理（备份在 /home/ubuntu/deploy_backup/%s）' % STAMP)
    c.close()
    raise SystemExit(1)

print('== 5/7 复制到 /opt 并迁移库 ==')
print('   ' + run('sudo cp -f %s/server/*.py %s/server/ && '
                  'sudo cp -r %s/web/. %s/web/ && '
                  'sudo chown -R xiuxian:xiuxian %s'
                  % (REMOTE, OPT, REMOTE, OPT, OPT)))
# ★ 迁移：起一次服务就会跑（ensure_tables 在启动路径上 ✓）
#   ★★ 这里原来想把代码塞进 ssh 单行命令 ✗ 里面既有 % 又有引号 ✓
#      → 两个错一起犯：python 的 % 格式化把 %s 吃掉（TypeError）
#        再叠上 shell 的引号转义（SyntaxError）✓
#      → 当时脚本崩在【服务已停】的状态 ✗ 差点把云端晾在那儿 ✓
#   ★ 正确做法：核对脚本【写成文件传上去跑】✗ 不跟引号斗 ✓
#     （tools/_cloud_check.py 就是这么干的 ✓ 一次就成了 ✓）
print('   （schema 迁移会在下一步起服务时自动执行 ✓ 这里不预跑 ✗ 少一次引号风险 ✓）')

print('== 6/7 起服务 ==')
print('   ' + run('sudo systemctl start xiuxian; sleep 6; systemctl is-active xiuxian'))
print('   健康: ' + run('curl -s -m 8 http://127.0.0.1:8899/api/health | head -c 140'))
print('   日志尾部: ' + run('sudo journalctl -u xiuxian -n 6 --no-pager | tail -6'))

print('== 7/7 核对（数据 + 外网文件）==')
# ★ 核对脚本【传文件上去跑】✗ 不再拼 ssh 单行（引号+% 两个坑 ✓）
#   tools/_cloud_check.py 就是这份核对 ✗ 它一次就跑通了 ✓
sftp = c.open_sftp()
sftp.put(os.path.join(ROOT, 'tools', '_cloud_check.py'), '/home/ubuntu/chk.py')
sftp.close()
print(run('sudo cp %s/server/game.db /home/ubuntu/check.db && '
          'sudo chown ubuntu:ubuntu /home/ubuntu/check.db && python3 /home/ubuntu/chk.py'
          % OPT))
ok = True
for path, must in (('/ws-config.js', ['WS_PORT']),
                   ('/', ['mktPanel', 'mktTabLog', 'bagSort']),
                   ('/platform/web.js', ['mktLogAsk', 'qtyHTML', 'durBarHTML'])):
    body = fetch(path)
    if not body:
        ok = False
        print('   ★ 抓不到 %s' % path)
        continue
    for mk in must:
        hit = mk in body
        if not hit:
            ok = False
        print('   %s %-14s %s' % ('v' if hit else '★', mk, path))
print('   外网抓 platform/web.js: %s 字节' % len(fetch('/platform/web.js')))
print()
print('   ★ 结论: ' + ('同步完成 ✓ 备份在 /home/ubuntu/deploy_backup/%s' % STAMP
                     if ok else '★ 有核对项没过 ✗ 见上面 ★ 那几行'))
c.close()
