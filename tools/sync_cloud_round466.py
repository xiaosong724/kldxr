# -*- coding: utf-8 -*-
"""round466：装备自动出售 → 同步云端（含 schema 10 → 11 迁移）"""
import io, os, time, urllib.request
import paramiko

HOST='43.138.171.250'; USER='ubuntu'
PW=io.open(os.path.expanduser('~/.xiuxian_deploy'),encoding='utf-8').read().strip()
ROOT='C:/mc/xiuxian-2d'; REMOTE='/home/ubuntu/xiuxian2d'
TS=time.strftime('%Y%m%d-%H%M%S')
FILES=['server/db.py','server/auth.py','server/protocol.py','server/world.py',
       'web/index.html','web/platform/web.js']

c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PW, timeout=25)
def run(cmd,t=200):
    si,so,se=c.exec_command(cmd,timeout=t)
    return (so.read().decode('utf-8','ignore')+se.read().decode('utf-8','ignore')).strip()

print('== 0 部署前 ==')
print('  schema: ' + run('''sudo python3 -c "import sqlite3;print(sqlite3.connect('/opt/xiuxian2d/server/game.db').execute(\\"select v from meta where k='schema_version'\\").fetchone()[0])"'''))
print('  服务: ' + run('systemctl is-active xiuxian'))
print('== 1 备份 ==')
bk='/home/ubuntu/backup-'+TS
print('  '+run('mkdir -p %s && sudo cp -a /opt/xiuxian2d/server/. %s/ && sudo cp -a /opt/xiuxian2d/server/game.db %s/game.db.bak && sudo cp -a /opt/xiuxian2d/web/. %s/web/ && sudo chown -R ubuntu:ubuntu %s && du -sh %s'%(bk,bk,bk,bk,bk,bk)))
print('== 2 停服 ==')
print('  '+run('sudo systemctl stop xiuxian; sleep 2; systemctl is-active xiuxian'))
print('== 3 传 ==')
sftp=c.open_sftp()
for rel in FILES:
    lp=os.path.join(ROOT,rel.replace('/',os.sep)); rp=REMOTE+'/'+rel
    run('mkdir -p '+os.path.dirname(rp))
    sftp.put(lp, rp); print('  %-24s %8d'%(rel, os.path.getsize(lp)))
sftp.close()
print('== 4 覆盖 + 自检 ==')
print('  '+run(' && '.join('sudo cp -f %s/%s /opt/xiuxian2d/%s'%(REMOTE,r,r) for r in FILES)+' && echo COPY_OK'))
print('  '+run('sudo chown -R xiuxian:xiuxian /opt/xiuxian2d'))
print('  '+run('cd /opt/xiuxian2d/server && sudo -u xiuxian python3 -c "import ast,glob;[ast.parse(open(f,encoding=\'utf-8\').read()) for f in glob.glob(\'*.py\')];print(\'AST OK\')"'))
print('== 5 起服（会跑 v10→v11 迁移）==')
print('  '+run('sudo systemctl start xiuxian; sleep 11; systemctl is-active xiuxian'))
print('  schema: ' + run('''sudo python3 -c "import sqlite3;print(sqlite3.connect('/opt/xiuxian2d/server/game.db').execute(\\"select v from meta where k='schema_version'\\").fetchone()[0])"'''))
print('  autosell 列: ' + run('''sudo python3 -c "import sqlite3;print('autosell' in [r[1] for r in sqlite3.connect('/opt/xiuxian2d/server/game.db').execute('PRAGMA table_info(roles)')])"'''))
print('  报错: ' + (run('sudo journalctl -u xiuxian --since "-2 min" | grep -E "Traceback|tick] 出错|迁移" | tail -5') or '（无 ✓）'))
print('  health: ' + run('curl -s -m 6 http://127.0.0.1:8899/api/health')[:150])
print('== 6 外网核对 ==')
for path, mark in [('/platform/web.js', 'setAutoSell'), ('/index.html', 'setAutoSell'), ('/index.html','自动出售装备')]:
    try:
        body = urllib.request.urlopen('http://%s:8899%s'%(HOST,path), timeout=12).read().decode('utf-8','ignore')
        print('  %s %-14s %s' % ('✓' if mark in body else '✗', mark, path))
    except Exception as e:
        print('  ✗ %s %r' % (path, e))
c.close()
print('完成')
