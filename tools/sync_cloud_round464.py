# -*- coding: utf-8 -*-
"""round464：断线后"重连进不去"修复 → 同步云端（只改前端）"""
import io, os, time, urllib.request
import paramiko

HOST='43.138.171.250'; USER='ubuntu'
PW=io.open(os.path.expanduser('~/.xiuxian_deploy'),encoding='utf-8').read().strip()
ROOT='C:/mc/xiuxian-2d'; REMOTE='/home/ubuntu/xiuxian2d'
TS=time.strftime('%Y%m%d-%H%M%S')
FILES=['web/platform/web.js']

c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PW, timeout=25)
def run(cmd,t=180):
    si,so,se=c.exec_command(cmd,timeout=t)
    return (so.read().decode('utf-8','ignore')+se.read().decode('utf-8','ignore')).strip()

print('== 备份 ==')
bk='/home/ubuntu/backup-'+TS
print('  '+run('mkdir -p %s && sudo cp -a /opt/xiuxian2d/web/. %s/ && sudo chown -R ubuntu:ubuntu %s && du -sh %s'%(bk,bk,bk,bk)))
print('== 传 ==')
sftp=c.open_sftp()
for rel in FILES:
    sftp.put(os.path.join(ROOT,rel.replace('/',os.sep)), REMOTE+'/'+rel)
    print('  %-24s %8d 字节'%(rel,os.path.getsize(os.path.join(ROOT,rel.replace('/',os.sep)))))
sftp.close()
print('== 覆盖 ==')
print('  '+run(' && '.join('sudo cp -f %s/%s /opt/xiuxian2d/%s'%(REMOTE,r,r) for r in FILES)+' && echo COPY_OK'))
print('  '+run('sudo chown -R xiuxian:xiuxian /opt/xiuxian2d'))
print('== 重启（前端改动其实不用重启，但保险）==')
print('  '+run('sudo systemctl restart xiuxian; sleep 9; systemctl is-active xiuxian'))
print('  '+run('curl -s -m 6 http://127.0.0.1:8899/api/health')[:160])
print('== 外网核对 ==')
try:
    with urllib.request.urlopen('http://%s:8899/platform/web.js'%HOST, timeout=12) as f:
        body=f.read().decode('utf-8','ignore')
    for k in ['netHardReload','原地重连（不刷新页面）','20 秒超时','_code === \'auth\'']:
        print('  %s %s'%('✓' if k in body else '✗', k))
    print('  reload 调用点（应该只剩兜底/boot 按钮）: %d'%body.count('location.reload()'))
except Exception as e:
    print('  ✗ 抓取失败 %r'%e)
c.close()
print('完成')
