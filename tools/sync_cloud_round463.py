# -*- coding: utf-8 -*-
"""round463 批次同步到云端：防具品阶 + 断线重连

改动：
  · server/world.py  防具品阶改用 weapons.roll_tier（原来被材料表卡在 2 阶）
  · server/ws.py     连接保活（last_seen + 90 秒清理）+ __slots__ 修复
  · server/net.py    move 限流 60 → 80（客户端本来发 61~62/秒）
  · web/platform/web.js  断线横幅 + 重连按钮 + 快照看门狗 + 回前台探活
"""
import io
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
    'server/world.py',
    'server/ws.py',
    'server/net.py',
    'web/platform/web.js',
    'web/core/game.js',        # 顺手同步（这一批登录/像素风也在里面）
    'web/index.html',
]

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PW, timeout=25)


def run(cmd, t=180):
    si, so, se = c.exec_command(cmd, timeout=t)
    return (so.read().decode('utf-8', 'ignore') + se.read().decode('utf-8', 'ignore')).strip()


def fetch(path, timeout=12):
    try:
        with urllib.request.urlopen('http://%s:8899%s' % (HOST, path), timeout=timeout) as f:
            return f.read().decode('utf-8', 'ignore')
    except Exception as e:
        print('   抓 %s 失败：%r' % (path, e))
        return ''


print('== 0/6 部署前体检 ==')
print('   服务: ' + run('systemctl is-active xiuxian'))
print('   health: ' + run('curl -s -m 6 http://127.0.0.1:8899/api/health')[:180])

print('')
print('== 1/6 备份 ==')
bk = '/home/ubuntu/backup-' + TS
print('   ' + run('mkdir -p %s && sudo cp -a /opt/xiuxian2d/server/. %s/ && '
                  'sudo cp -a /opt/xiuxian2d/server/game.db %s/game.db.bak && '
                  'sudo chown -R ubuntu:ubuntu %s && du -sh %s' % (bk, bk, bk, bk, bk)))

print('')
print('== 2/6 停服 ==')
print('   ' + run('sudo systemctl stop xiuxian; sleep 2; systemctl is-active xiuxian'))

print('')
print('== 3/6 传文件 ==')
sftp = c.open_sftp()
for rel in FILES:
    lp = os.path.join(ROOT, rel.replace('/', os.sep))
    rp = REMOTE + '/' + rel
    run('mkdir -p %s' % os.path.dirname(rp))
    sftp.put(lp, rp)
    print('   %-24s %8d 字节' % (rel, os.path.getsize(lp)))
sftp.close()

print('')
print('== 4/6 覆盖 + 语法自检 ==')
cmds = ['sudo cp -f %s/%s /opt/xiuxian2d/%s' % (REMOTE, r, r) for r in FILES]
print('   ' + run(' && '.join(cmds) + ' && echo COPY_OK'))
print('   ' + run('sudo chown -R xiuxian:xiuxian /opt/xiuxian2d'))
print('   ' + run('cd /opt/xiuxian2d/server && sudo -u xiuxian python3 -c '
                  '"import ast,glob;[ast.parse(open(f,encoding=\'utf-8\').read()) '
                  'for f in glob.glob(\'*.py\')];print(\'AST OK\')"'))

print('')
print('== 5/6 起服务 ==')
print('   ' + run('sudo systemctl start xiuxian; sleep 10; systemctl is-active xiuxian'))
print('   报错: ' + (run('sudo journalctl -u xiuxian --since "-2 min" | grep -E "异常|Traceback|tick] 出错" | tail -5') or '（无 ✓）'))
print('   health: ' + run('curl -s -m 6 http://127.0.0.1:8899/api/health')[:200])

print('')
print('== 6/6 外网核对 ==')
pw = fetch('/platform/web.js')
gm = fetch('/core/game.js')
checks = [
    ('platform 有断线横幅', 'netBarShow' in pw),
    ('platform 有硬重连', 'netHardReconnect' in pw),
    ('platform 有快照看门狗', 'worldWatchdog' in pw),
    ('platform 有回前台探活', 'visibilitychange' in pw),
    ('core 有防具/掉落相关', 'roll_tier' in gm or 'LOGIN_CINE' in gm),
]
for nm, ok in checks:
    print('   %s %s' % ('✓' if ok else '✗', nm))

# 服务端保活是否生效：日志里不应该再出现 last_seen 报错
print('   ' + run('sudo journalctl -u xiuxian --since "-2 min" | grep -F "last_seen" | tail -3') or '   ✓ 没有 last_seen 报错')

c.close()
print('')
print('部署完成')
