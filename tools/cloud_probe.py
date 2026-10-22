# -*- coding: utf-8 -*-
"""只读体检：云端现在是什么状态（不改任何东西）

跑法：python tools/_cloud_probe.py
"""
import io
import os

import paramiko

HOST = '43.138.171.250'
USER = 'ubuntu'
PW = io.open(os.path.expanduser('~/.xiuxian_deploy'), encoding='utf-8').read().strip()

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PW, timeout=25)


def run(cmd, t=90):
    si, so, se = c.exec_command(cmd, timeout=t)
    return (so.read().decode('utf-8', 'ignore') + se.read().decode('utf-8', 'ignore')).strip()


print('== 服务 ==')
print('   ' + run('systemctl is-active xiuxian; systemctl show -p ActiveEnterTimestamp --value xiuxian'))
print('== 版本 / 数据库 ==')
print('   ' + run('ls -la /opt/xiuxian2d/server/*.py | wc -l; '
                  'sqlite3 /opt/xiuxian2d/server/game.db "select v from meta where k=\'schema_version\'" 2>/dev/null '
                  '|| sudo sqlite3 /opt/xiuxian2d/server/game.db "select v from meta where k=\'schema_version\'"'))
print('== 有没有 qqbridge.py ==')
print('   ' + run('ls -la /opt/xiuxian2d/server/qqbridge.py 2>&1 | head -2'))
print('== 云端 config 的 test_name_keys / admin 密码长度 ==')
print('   ' + run('''sudo python3 -c "import json;c=json.load(open('/opt/xiuxian2d/server/config.json'));
print('keys:', c.get('test_name_keys'));
print('adminLen:', len(c.get('admin_password') or ''));
print('qq:', c.get('qq'));
print('ports:', c.get('http_port'), c.get('ws_port'))"'''))
print('== 同机 8099 通不通（qq-forwarder）==')
print('   ' + run('curl -s -m 5 http://127.0.0.1:8099/api/health | head -c 220'))
print('== 游戏自身 health ==')
print('   ' + run('curl -s -m 5 http://127.0.0.1:8899/api/health | head -c 260'))
print('== 磁盘 ==')
print('   ' + run('df -h /opt | tail -1; du -sh /opt/xiuxian2d/server/game.db'))
c.close()
