import paramiko
c=paramiko.SSHClient();c.set_missing_host_key_policy(paramiko.AutoAddPolicy());c.connect('43.138.171.250',username='ubuntu',key_filename='C:/mc/tools/cloud_key',timeout=20)
for cmd in [
 "grep -n 'CAM_VIEW_START' /opt/xiuxian2d/web/core/game.js | head -3",
 "grep -n '0xe0b830' /opt/xiuxian2d/web/core/game.js | head -3",
 "grep -n '0xff3b30' /opt/xiuxian2d/web/core/game.js | head -3",
 "ls -l /opt/xiuxian2d/web/core/game.js /home/ubuntu/xiuxian2d/web/core/game.js",
 "readlink -f /opt/xiuxian2d/web",
 "md5sum /opt/xiuxian2d/web/core/game.js /home/ubuntu/xiuxian2d/web/core/game.js",
 "curl -s http://127.0.0.1:8899/core/game.js | md5sum",
]:
 i,o,e=c.exec_command(cmd,timeout=20)
 print('$',cmd)
 print((o.read().decode('utf-8','ignore')+e.read().decode('utf-8','ignore')).strip())
c.close()
