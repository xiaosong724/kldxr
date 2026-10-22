# -*- coding: utf-8 -*-
"""2026-10-20 皮肤卡/技能书使用修复同步"""
import io, os, time, json, urllib.request, paramiko
HOST='43.138.171.250'; USER='ubuntu'; ROOT=r'C:\mc\xiuxian-2d'
REMOTE='/home/ubuntu/xiuxian2d'; OPT='/opt/xiuxian2d'; STAMP=time.strftime('%Y%m%d-%H%M%S')
PW=io.open(os.path.expanduser('~/.xiuxian_deploy'),encoding='utf-8').read().strip()
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy()); c.connect(HOST,username=USER,password=PW,timeout=25)
def run(cmd,t=240):
    si,so,se=c.exec_command(cmd,timeout=t); return (so.read().decode('utf-8','ignore')+se.read().decode('utf-8','ignore')).strip()
def health():
    try:
        return json.loads(urllib.request.urlopen('http://%s:8899/api/health'%HOST,timeout=8).read().decode('utf-8'))
    except Exception as e:
        return {'ok':False,'err':repr(e)}
print('preflight',run('systemctl is-active xiuxian'),health().get('ok'))
print('stop',run('sudo systemctl stop xiuxian; sleep 2; systemctl is-active xiuxian'))
print('backup',run('mkdir -p %s/backups && cp -f %s/server/game.db %s/backups/game-%s.db && tar czf %s/backups/code-%s.tgz -C %s server web && echo OK'%(REMOTE,OPT,REMOTE,STAMP,REMOTE,STAMP,OPT)))
files=[('server','world.py'),('server','market.py'),('server','net.py'),('web/platform','web.js'),('web','sw.js')]
sftp=c.open_sftp()
for d,fn in files:
    sftp.put(os.path.join(ROOT,d.replace('/',os.sep),fn), REMOTE+'/'+d+'/'+fn)
    print('upload',d+'/'+fn)
sftp.close()
cmds=['sudo cp -f %s/server/world.py %s/server/world.py'%(REMOTE,OPT),
      'sudo cp -f %s/server/market.py %s/server/market.py'%(REMOTE,OPT),
      'sudo cp -f %s/server/net.py %s/server/net.py'%(REMOTE,OPT),
      'sudo cp -f %s/web/platform/web.js %s/web/platform/web.js'%(REMOTE,OPT),
      'sudo cp -f %s/web/sw.js %s/web/sw.js'%(REMOTE,OPT),
      'sudo chown -R xiuxian:xiuxian %s'%OPT,
      'sudo systemctl start xiuxian','sleep 8','systemctl is-active xiuxian']
print('start',run(' && '.join(cmds),40))
ok=False
for _ in range(6):
    time.sleep(2); h=health()
    if h.get('ok'):
        ok=True; print('health',json.dumps(h,ensure_ascii=False)[:200]); break
if not ok:
    print('FAILED',health())
    print('rollback',run('sudo systemctl stop xiuxian; sleep 1; sudo tar xzf %s/backups/code-%s.tgz -C %s && sudo cp -f %s/backups/game-%s.db %s/server/game.db && sudo chown -R xiuxian:xiuxian %s && sudo systemctl start xiuxian; sleep 6; systemctl is-active xiuxian'%(REMOTE,STAMP,OPT,REMOTE,STAMP,OPT,OPT),60))
    c.close(); raise SystemExit(1)
print('schema',run("cd %s/server && sudo -u xiuxian python3 -c \"import sqlite3;c=sqlite3.connect('game.db');print(c.execute('PRAGMA user_version').fetchone()[0])\""%OPT,20))
for path,mk in [('/platform/web.js','round597'),('/platform/web.js','BAG.items[_si3].stack')]:
    b=urllib.request.urlopen('http://%s:8899%s'%(HOST,path),timeout=10).read().decode('utf-8','ignore')
    print('mark',mk, mk in b)
print('log',run("journalctl -u xiuxian -n 30 --no-pager | grep -E 'Traceback|Error|Exception' | tail -5 || true",30))
c.close(); print('done')
