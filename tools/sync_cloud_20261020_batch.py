# -*- coding: utf-8 -*-
import io, os, time, json, urllib.request, paramiko
HOST='43.138.171.250'; ROOT=r'C:\mc\xiuxian-2d'; REMOTE='/home/ubuntu/xiuxian2d'; OPT='/opt/xiuxian2d'; STAMP=time.strftime('%Y%m%d-%H%M%S')
PW=io.open(os.path.expanduser('~/.xiuxian_deploy'),encoding='utf-8').read().strip()
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy()); c.connect(HOST,username='ubuntu',password=PW,timeout=25)
def run(cmd,t=240):
    si,so,se=c.exec_command(cmd,timeout=t); return (so.read().decode('utf-8','ignore')+se.read().decode('utf-8','ignore')).strip()
def health():
    try: return json.loads(urllib.request.urlopen('http://%s:8899/api/health'%HOST,timeout=8).read().decode('utf-8'))
    except Exception as e: return {'ok':False,'err':repr(e)}
print('pre',run('systemctl is-active xiuxian'),health().get('ok'))
print('stop',run('sudo systemctl stop xiuxian; sleep 2; systemctl is-active xiuxian'))
print('backup',run('mkdir -p %s/backups && cp -f %s/server/game.db %s/backups/game-%s.db && tar czf %s/backups/code-%s.tgz -C %s server web && echo OK'%(REMOTE,OPT,REMOTE,STAMP,REMOTE,STAMP,OPT)))
files=['server/world.py','server/skills.py','server/auth.py','web/core/game.js','web/platform/web.js','web/vfx.js','web/sw.js','web/assets/sfx/break1.wav','web/assets/sfx/land1.wav','web/assets/sfx/flee1.wav']
for rel in files:
    sftp=c.open_sftp(); sftp.put(os.path.join(ROOT,rel.replace('/',os.sep)),REMOTE+'/'+rel); sftp.close(); print('up',rel)
cmds=['sudo cp -f %s/server/world.py %s/server/world.py'%(REMOTE,OPT),
      'sudo cp -f %s/server/skills.py %s/server/skills.py'%(REMOTE,OPT),
      'sudo cp -f %s/server/auth.py %s/server/auth.py'%(REMOTE,OPT),
      'sudo cp -f %s/web/core/game.js %s/web/core/game.js'%(REMOTE,OPT),
      'sudo cp -f %s/web/platform/web.js %s/web/platform/web.js'%(REMOTE,OPT),
      'sudo cp -f %s/web/vfx.js %s/web/vfx.js'%(REMOTE,OPT),
      'sudo cp -f %s/web/sw.js %s/web/sw.js'%(REMOTE,OPT),
      'sudo mkdir -p %s/web/assets/sfx'%OPT,
      'sudo cp -f %s/web/assets/sfx/break1.wav %s/web/assets/sfx/'%(REMOTE,OPT),
      'sudo cp -f %s/web/assets/sfx/land1.wav %s/web/assets/sfx/'%(REMOTE,OPT),
      'sudo cp -f %s/web/assets/sfx/flee1.wav %s/web/assets/sfx/'%(REMOTE,OPT),
      'sudo chown -R xiuxian:xiuxian %s'%OPT,
      'sudo systemctl start xiuxian','sleep 8','systemctl is-active xiuxian']
print('start',run(' && '.join(cmds),45))
ok=False
for _ in range(6):
    time.sleep(2); h=health()
    if h.get('ok'): ok=True; print('health',json.dumps(h,ensure_ascii=False)[:180]); break
if not ok:
    print('FAIL',health())
    print(run('sudo systemctl stop xiuxian; sleep 1; sudo tar xzf %s/backups/code-%s.tgz -C %s && sudo cp -f %s/backups/game-%s.db %s/server/game.db && sudo chown -R xiuxian:xiuxian %s && sudo systemctl start xiuxian; sleep 6; systemctl is-active xiuxian'%(REMOTE,STAMP,OPT,REMOTE,STAMP,OPT,OPT),60))
    c.close(); raise SystemExit(1)
print('schema',run("cd %s/server && sudo -u xiuxian python3 -c \"import sqlite3;c=sqlite3.connect('game.db');print(c.execute('PRAGMA user_version').fetchone()[0])\""%OPT,20))
checks=[('/core/game.js','autoSkill'),('/core/game.js','lootT > 5'),('/platform/web.js','UI.autoSkill'),('/platform/web.js','buffs: function'),('/vfx.js','Number(o.dur) || 2.4'),('/assets/sfx/break1.wav','RIFF'),('/assets/sfx/land1.wav','RIFF'),('/assets/sfx/flee1.wav','RIFF')]
for path,mk in checks:
    try:
        b=urllib.request.urlopen('http://%s:8899%s'%(HOST,path),timeout=10).read().decode('utf-8','ignore')
        print(('OK  ' if mk in b else 'FAIL'),mk,path)
    except Exception as e:
        print('FAIL',mk,path,repr(e))
print('servermark',run("grep -n '_earth_dots' /opt/xiuxian2d/server/world.py | head -1"))
print('log',run("journalctl -u xiuxian -n 40 --no-pager | grep -E 'Traceback|Error|Exception' | tail -6 || true",30))
c.close(); print('done')
