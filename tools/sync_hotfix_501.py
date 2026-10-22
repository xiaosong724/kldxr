# -*- coding: utf-8 -*-
"""round501 热修：只更新 web/core/game.js（自动战斗被镜头转歪）

★ 只停 5 秒左右（玩家会掉线重连一次）
"""
import io
import json
import os
import time
import urllib.request

import paramiko

HOST = '43.138.171.250'
USER = 'ubuntu'
REMOTE = '/home/ubuntu/xiuxian2d'
OPT = '/opt/xiuxian2d'
ROOT = 'C:/mc/xiuxian-2d'

PW = io.open(os.path.expanduser('~/.xiuxian_deploy'), encoding='utf-8').read().strip()
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PW, timeout=25)


def run(cmd, t=120):
    si, so, se = c.exec_command(cmd, timeout=t)
    return (so.read().decode('utf-8', 'ignore') + se.read().decode('utf-8', 'ignore')).strip()


print('== 1/4 停服务 ==')
print(run('sudo systemctl stop xiuxian; sleep 1; systemctl is-active xiuxian'))

print('== 2/4 传 game.js ==')
sftp = c.open_sftp()
sftp.put(os.path.join(ROOT, 'web', 'core', 'game.js'), REMOTE + '/web/core/game.js')
sftp.close()

print('== 3/4 复制 + 起服务 ==')
print(run('sudo cp -f %s/web/core/game.js %s/web/core/ && sudo chown xiuxian:xiuxian '
          '%s/web/core/game.js && sudo systemctl start xiuxian; sleep 5; systemctl is-active xiuxian'
          % (REMOTE, OPT, OPT)))

print('== 4/4 外网核对 ==')
body = urllib.request.urlopen('http://%s:8899/core/game.js' % HOST, timeout=10).read().decode('utf-8', 'ignore')
ok1 = '_autoDrv' in body
print('   %s 自动战斗方向修正（_autoDrv）' % ('✓' if ok1 else '✗'))
h = json.loads(urllib.request.urlopen('http://%s:8899/api/health' % HOST, timeout=10).read())
print('   health:', json.dumps(h, ensure_ascii=False)[:150])
print('   在线:', (h.get('world') or {}).get('online'))
c.close()
print('\n结果：' + ('热修已生效 ✓' if ok1 else '没生效 ✗'))
