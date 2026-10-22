# -*- coding: utf-8 -*-
"""round502 部署：Q 群战报（统计 + 15 分钟调度 + Pillow 渲染 + NapCat 发图）

只动我们自己的东西：
  · /opt/xiuxian2d/server/{battlereport.py, battlereport_run.py, weapon_icons.json,
                            app.py, world.py}
  · 云端 config.json 里【新增】battleReport 段（先备份 config ✓ 不动别的字段）
  · ★ 不碰 xiuxian-card / napcat 那两个服务 ✓（只是连它的 4999 端口发消息）
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
GROUP = '346049634'          # ★ 云服主群（本地是测试群 1103784008）

PW = io.open(os.path.expanduser('~/.xiuxian_deploy'), encoding='utf-8').read().strip()
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PW, timeout=25)


def run(cmd, t=180):
    si, so, se = c.exec_command(cmd, timeout=t)
    return (so.read().decode('utf-8', 'ignore') + se.read().decode('utf-8', 'ignore')).strip()


FILES = ['battlereport.py', 'battlereport_run.py', 'weapon_icons.json', 'app.py', 'world.py']

print('== 1/6 停服务 ==')
print('   ' + (run('sudo systemctl stop xiuxian; sleep 1; systemctl is-active xiuxian') or '?'))

print('== 2/6 传文件 ==')
sftp = c.open_sftp()
for fn in FILES:
    sftp.put(os.path.join(ROOT, 'server', fn), REMOTE + '/server/' + fn)
    print('   server/' + fn)
sftp.close()

print('== 3/6 复制 + 建 reports 目录 ==')
print(run('sudo cp -f %s/server/*.py %s/server/ && '
          'sudo cp -f %s/server/weapon_icons.json %s/server/ && '
          'sudo mkdir -p %s/server/reports && '
          'sudo chown -R xiuxian:xiuxian %s && '
          'echo copied' % (REMOTE, OPT, REMOTE, OPT, OPT, OPT)))

print('== 4/6 云端 config.json 加 battleReport（先备份）==')
py = (
    'import io, json, os, time, shutil;'
    "p='/opt/xiuxian2d/server/config.json';"
    "shutil.copy(p, p + '.bak-rpt-' + time.strftime('%%Y%%m%%d-%%H%%M%%S'));"
    "d=json.load(io.open(p, encoding='utf-8'));"
    "d['battleReport']={'enabled': True, 'intervalSec': 900, 'group': '%s',"
    " 'onebotHost': '127.0.0.1', 'onebotPort': 4999,"
    " 'onebotToken': 'xiuxian-bridge-token'};"
    "io.open(p,'w',encoding='utf-8').write(json.dumps(d, ensure_ascii=False, indent=2));"
    "print('CONFIG_OK', d['battleReport']['group'])" % GROUP
)
print('   ' + run('cd /opt/xiuxian2d/server && sudo python3 -c %s' % json.dumps(py)))

print('== 5/6 起服务 ==')
out = run('sudo systemctl start xiuxian; sleep 6; systemctl is-active xiuxian')
print('   ' + out)
time.sleep(2)
log = run('sudo tail -40 /var/log/xiuxian.log 2>/dev/null || journalctl -u xiuxian -n 40 --no-pager')
for line in log.splitlines():
    if 'rpt' in line or 'Traceback' in line or 'Error' in line:
        print('   | ' + line)

print('== 6/6 健康 + 云端试渲染（不发送）==')
try:
    h = json.loads(urllib.request.urlopen('http://%s:8899/api/health' % HOST, timeout=8).read())
    print('   health:', json.dumps(h, ensure_ascii=False)[:150])
except Exception as e:
    print('   health 失败：%r' % (e,))

test_py = (
    'import battlereport_run as R, time;'
    "rows=[{'name':'测试甲','exp':52000,'gold':9000,'kills':300,"
    "'gear':[{'look':'sword','tier':7,'n':2},{'look':'armor','tier':6,'n':1}],'gearTotal':3},"
    "{'name':'测试乙','exp':30000,'gold':4000,'kills':120,'gear':[{'look':'axe','tier':5,'n':1}],'gearTotal':1}];"
    "p,w,h=R.build_png(rows, time.time()-900, time.time(), '/tmp/rpt_test.png');"
    "print('PNG', p, w, h)"
)
out2 = run('cd /opt/xiuxian2d/server && sudo -u xiuxian python3 -c %s' % json.dumps(test_py))
print('   ' + out2)

if 'PNG' in out2:
    sftp = c.open_sftp()
    try:
        sftp.get('/tmp/rpt_test.png', os.path.join(ROOT, 'docs', 'shots', 'report-cloud-test.png'))
        print('   已取回 docs/shots/report-cloud-test.png（本地看一眼 ✓）')
    finally:
        sftp.close()
c.close()
print('\n完成')
