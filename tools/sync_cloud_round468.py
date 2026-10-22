# -*- coding: utf-8 -*-
"""round468：自动出售落库修复 + 词条一条一行 → 同步云端"""
import io, os, time, urllib.request
import paramiko
HOST='43.138.171.250'; USER='ubuntu'
PW=io.open(os.path.expanduser('~/.xiuxian_deploy'),encoding='utf-8').read().strip()
ROOT='C:/mc/xiuxian-2d'; REMOTE='/home/ubuntu/xiuxian2d'
TS=time.strftime('%Y%m%d-%H%M%S')
FILES=['server/world.py','web/platform/web.js']
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PW, timeout=25)
def run(cmd,t=180):
    si,so,se=c.exec_command(cmd,timeout=t)
    return (so.read().decode('utf-8','ignore')+se.read().decode('utf-8','ignore')).strip()
bk='/home/ubuntu/backup-'+TS
print('备份: '+run('mkdir -p %s && sudo cp -a /opt/xiuxian2d/server/world.py %s/ && sudo cp -a /opt/xiuxian2d/web/platform/web.js %s/ && sudo chown -R ubuntu:ubuntu %s && du -sh %s'%(bk,bk,bk,bk,bk)))
print('停服: '+run('sudo systemctl stop xiuxian; sleep 2; systemctl is-active xiuxian'))
sftp=c.open_sftp()
for rel in FILES:
    lp=os.path.join(ROOT,rel.replace('/',os.sep)); sftp.put(lp, REMOTE+'/'+rel)
    print('  %-22s %8d'%(rel, os.path.getsize(lp)))
sftp.close()
print(run(' && '.join('sudo cp -f %s/%s /opt/xiuxian2d/%s'%(REMOTE,r,r) for r in FILES)+' && echo COPY_OK'))
print('  '+run('sudo chown -R xiuxian:xiuxian /opt/xiuxian2d'))
print('  '+run('cd /opt/xiuxian2d/server && sudo -u xiuxian python3 -c "import ast;ast.parse(open(\'world.py\',encoding=\'utf-8\').read());print(\'AST OK\')"'))
print('起服: '+run('sudo systemctl start xiuxian; sleep 10; systemctl is-active xiuxian'))
print('  报错: ' + (run('sudo journalctl -u xiuxian --since "-2 min" | grep -E "Traceback|tick] 出错" | tail -4') or '（无 ✓）'))
print('  health: '+run('curl -s -m 6 http://127.0.0.1:8899/api/health')[:140])
print('== 外网核对 ==')
body = urllib.request.urlopen('http://%s:8899/platform/web.js'%HOST, timeout=12).read().decode('utf-8','ignore')
for m in ['affixBlock', 'flex:0 0 100%']:
    print('  %s %s' % ('✓' if m in body else '✗', m))
# 服务端：确认 now_s 那处修复在场
print('  ' + run("grep -n 'int(now_s() \* 1000)' /opt/xiuxian2d/server/world.py | head -2"))
c.close()
print('完成')
