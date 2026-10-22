# -*- coding: utf-8 -*-
"""round465：属性面板重做 → 同步云端"""
import io, os, time, urllib.request
import paramiko

HOST='43.138.171.250'; USER='ubuntu'
PW=io.open(os.path.expanduser('~/.xiuxian_deploy'),encoding='utf-8').read().strip()
ROOT='C:/mc/xiuxian-2d'; REMOTE='/home/ubuntu/xiuxian2d'
TS=time.strftime('%Y%m%d-%H%M%S')
FILES=['server/world.py','server/protocol.py','web/platform/web.js','web/index.html']

c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PW, timeout=25)
def run(cmd,t=180):
    si,so,se=c.exec_command(cmd,timeout=t)
    return (so.read().decode('utf-8','ignore')+se.read().decode('utf-8','ignore')).strip()

print('== 备份 ==')
bk='/home/ubuntu/backup-'+TS
print('  '+run('mkdir -p %s && sudo cp -a /opt/xiuxian2d/server/. %s/ && sudo cp -a /opt/xiuxian2d/web/. %s/web/ && sudo chown -R ubuntu:ubuntu %s && du -sh %s'%(bk,bk,bk,bk,bk)))
print('== 停服 ==')
print('  '+run('sudo systemctl stop xiuxian; sleep 2; systemctl is-active xiuxian'))
print('== 传 ==')
sftp=c.open_sftp()
for rel in FILES:
    sftp.put(os.path.join(ROOT,rel.replace('/',os.sep)), REMOTE+'/'+rel)
    print('  %-24s %8d'%(rel, os.path.getsize(os.path.join(ROOT,rel.replace('/',os.sep)))))
sftp.close()
print('== 覆盖 + 语法自检 ==')
print('  '+run(' && '.join('sudo cp -f %s/%s /opt/xiuxian2d/%s'%(REMOTE,r,r) for r in FILES)+' && echo COPY_OK'))
print('  '+run('sudo chown -R xiuxian:xiuxian /opt/xiuxian2d'))
print('  '+run('cd /opt/xiuxian2d/server && sudo -u xiuxian python3 -c "import ast,glob;[ast.parse(open(f,encoding=\'utf-8\').read()) for f in glob.glob(\'*.py\')];print(\'AST OK\')"'))
print('== 起服 ==')
print('  '+run('sudo systemctl start xiuxian; sleep 10; systemctl is-active xiuxian'))
print('  报错: ' + (run('sudo journalctl -u xiuxian --since "-2 min" | grep -E "Traceback|tick] 出错" | tail -4') or '（无 ✓）'))
print('  '+run('curl -s -m 6 http://127.0.0.1:8899/api/health')[:160])
c.close()
print('完成')
