# -*- coding: utf-8 -*-
"""2026-10-21 最终同步：全部 server/*.py + 全部 web/（含 downloads 更新包）

流程：备份 → 停服 → 上传 → 覆盖 /opt → 起服 → 外网核对 → 失败回滚
★ 不传 server/config.json、server/game.db、server/_admin_sessions.json
"""
import io
import json
import os
import time
import urllib.request

import paramiko

HOST = '43.138.171.250'
USER = 'ubuntu'
ROOT = r'C:\mc\xiuxian-2d'
REMOTE = '/home/ubuntu/xiuxian2d'
OPT = '/opt/xiuxian2d'
STAMP = time.strftime('%Y%m%d-%H%M%S')

PW = ''
cand = os.path.expanduser('~/.xiuxian_deploy')
if os.path.isfile(cand):
    PW = io.open(cand, encoding='utf-8').read().strip()


def connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    if PW:
        c.connect(HOST, username=USER, password=PW, timeout=25)
    else:
        c.connect(HOST, username=USER, key_filename='C:/mc/tools/cloud_key', timeout=25)
    return c


def run(c, cmd, t=300):
    si, so, se = c.exec_command(cmd, timeout=t)
    return (so.read().decode('utf-8', 'ignore') +
            se.read().decode('utf-8', 'ignore')).strip()


def health():
    try:
        return json.loads(urllib.request.urlopen(
            'http://%s:8899/api/health' % HOST, timeout=8).read().decode('utf-8'))
    except Exception as e:
        return {'ok': False, 'err': repr(e)}


def fetch(path, n=120000):
    try:
        return urllib.request.urlopen('http://%s:8899%s' % (HOST, path),
                                      timeout=12).read().decode('utf-8', 'ignore')[:n]
    except Exception as e:
        return 'ERR:%r' % (e,)


c = connect()
sftp = c.open_sftp()


def ensure_dir(path):
    try:
        sftp.stat(path)
    except IOError:
        ensure_dir(path.rsplit('/', 1)[0])
        sftp.mkdir(path)


print('== 0 预检 ==')
print(run(c, 'hostname; systemctl is-active xiuxian; ls -d %s %s' % (REMOTE, OPT)))

print('\n== 1 备份 ==')
print(run(c, 'mkdir -p %s/backups && cp -f %s/server/game.db %s/backups/game-%s.db && '
            'tar czf %s/backups/code-%s.tgz -C %s server web && echo BACKUP_OK && '
            'ls -lh %s/backups | tail -4'
            % (REMOTE, OPT, REMOTE, STAMP, REMOTE, STAMP, OPT, REMOTE)))

print('\n== 2 停服 ==')
print(run(c, 'sudo systemctl stop xiuxian; sleep 2; systemctl is-active xiuxian || true'))

print('\n== 3 上传 server/*.py ==')
server_files = sorted(f for f in os.listdir(os.path.join(ROOT, 'server'))
                      if f.endswith('.py'))
skip = {'config.json', 'game.db', '_admin_sessions.json'}
for fn in server_files:
    lp = os.path.join(ROOT, 'server', fn)
    sftp.put(lp, REMOTE + '/server/' + fn)
    print('   server/' + fn)

print('\n== 4 上传 web/ ==')
web_root = os.path.join(ROOT, 'web')
count = 0
for dp, dns, fns in os.walk(web_root):
    rel = os.path.relpath(dp, web_root).replace('\\', '/')
    rdir = REMOTE + '/web' + ('' if rel == '.' else '/' + rel)
    ensure_dir(rdir)
    for fn in fns:
        lp = os.path.join(dp, fn)
        sftp.put(lp, rdir + '/' + fn)
        count += 1
print('   web files:', count)
sftp.close()

print('\n== 5 覆盖 /opt 并起服 ==')
cmds = [
    'sudo cp -f %s/server/*.py %s/server/' % (REMOTE, OPT),
    'sudo rm -rf %s/web.new' % OPT,
    'sudo cp -a %s/web %s/web.new' % (REMOTE, OPT),
    'sudo rm -rf %s/web.old' % OPT,
    'sudo mv %s/web %s/web.old' % (OPT, OPT),
    'sudo mv %s/web.new %s/web' % (OPT, OPT),
    'sudo chown -R xiuxian:xiuxian %s' % OPT,
    'sudo systemctl start xiuxian',
    'sleep 7',
    'systemctl is-active xiuxian',
]
out = run(c, ' && '.join(cmds), 180)
print(out)

print('\n== 6 健康检查 ==')
ok = False
for _ in range(10):
    time.sleep(2)
    h = health()
    print('   ', json.dumps(h, ensure_ascii=False)[:240])
    if h.get('ok') is True:
        ok = True
        break

if not ok:
    print('\n!! 启动失败，开始回滚 !!')
    rb = ('sudo systemctl stop xiuxian; sleep 1; '
          'sudo rm -rf %s/web && sudo cp -a %s/web.old %s/web; '
          'sudo tar xzf %s/backups/code-%s.tgz -C %s; '
          'sudo cp -f %s/backups/game-%s.db %s/server/game.db; '
          'sudo chown -R xiuxian:xiuxian %s; '
          'sudo systemctl start xiuxian; sleep 6; systemctl is-active xiuxian'
          % (OPT, OPT, OPT, REMOTE, STAMP, OPT, REMOTE, STAMP, OPT, OPT))
    print(run(c, rb, 120))
    c.close()
    raise SystemExit(1)

print('\n== 7 外网标记核对 ==')
checks = [
    ('/core/game.js', 'CAM_VIEW_START', True),
    ('/core/game.js', '0xb9e6a6', True),
    ('/core/game.js', '0x4d9e3f', True),
    ('/platform/web.js', 'CAM_VIEW_START', True),
    ('/downloads/test.json', 'xiuxian-test.apk', True),
    ('/downloads/local.json', 'xiuxian-local.apk', True),
]
for path, mark, want in checks:
    body = fetch(path)
    got = (mark in body)
    print(('   OK  ' if got == want else '   FAIL') + ' ' + mark + ' @ ' + path)

print('\n== 8 云端文件/日志 ==')
print(run(c, "grep -n \"TIER_COL =\" %s/server/battlereport.py | head -1" % OPT))
print(run(c, "systemctl is-active xiuxian; journalctl -u xiuxian -n 40 --no-pager | "
            "grep -E 'Traceback|Error|Exception' | tail -8 || true", 60))

print('\n== 9 更新包大小 ==')
print(run(c, "ls -lh %s/web/downloads/*.apk %s/web/downloads/*.json" % (OPT, OPT)))

c.close()
print('SYNC_DONE', STAMP)
