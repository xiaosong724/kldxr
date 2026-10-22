# -*- coding: utf-8 -*-
"""round467：装备栏独立成导航 + 自动出售挪到背包页 → 同步云端（只改前端）"""
import io, os, time, urllib.request
import paramiko
HOST='43.138.171.250'; USER='ubuntu'
PW=io.open(os.path.expanduser('~/.xiuxian_deploy'),encoding='utf-8').read().strip()
ROOT='C:/mc/xiuxian-2d'; REMOTE='/home/ubuntu/xiuxian2d'
TS=time.strftime('%Y%m%d-%H%M%S')
FILES=['web/index.html','web/platform/web.js']
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PW, timeout=25)
def run(cmd,t=180):
    si,so,se=c.exec_command(cmd,timeout=t)
    return (so.read().decode('utf-8','ignore')+se.read().decode('utf-8','ignore')).strip()
bk='/home/ubuntu/backup-'+TS
print('备份: '+run('mkdir -p %s && sudo cp -a /opt/xiuxian2d/web/. %s/ && sudo chown -R ubuntu:ubuntu %s && du -sh %s'%(bk,bk,bk,bk)))
sftp=c.open_sftp()
for rel in FILES:
    lp=os.path.join(ROOT,rel.replace('/',os.sep)); sftp.put(lp, REMOTE+'/'+rel)
    print('  %-22s %8d'%(rel, os.path.getsize(lp)))
sftp.close()
print(run(' && '.join('sudo cp -f %s/%s /opt/xiuxian2d/%s'%(REMOTE,r,r) for r in FILES)+' && echo COPY_OK'))
print('  属主: '+run('sudo chown -R xiuxian:xiuxian /opt/xiuxian2d && echo OK'))
# 前端改动不需要重启，但重启一次保证静态文件句柄干净 ✓
print('  重启: '+run('sudo systemctl restart xiuxian; sleep 9; systemctl is-active xiuxian'))
print('  health: '+run('curl -s -m 6 http://127.0.0.1:8899/api/health')[:140])
print('== 外网核对 ==')
for path, marks in [('/index.html', ['data-tab="equip"', 'data-pane="equip"', 'setAutoSell']),
                    ('/platform/web.js', ['equipRender', 'setTab("equip")' ])]:
    body = urllib.request.urlopen('http://%s:8899%s'%(HOST,path), timeout=12).read().decode('utf-8','ignore')
    for m in marks:
        print('  %s %-18s %s' % ('✓' if m in body else '✗', m, path))
c.close()
print('完成')
