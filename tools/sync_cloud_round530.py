# -*- coding: utf-8 -*-
"""round530 同步：皮肤自定义（捏脸染色）+ 比例调整 + 管理页发卡 + 背包 gzip

流程：备份库 → 停服 → 传文件 → 复制到 /opt → 起服 → 外网核对 → 查 schema
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
STAMP = time.strftime('%Y%m%d-%H%M%S')

PW = io.open(os.path.expanduser('~/.xiuxian_deploy'), encoding='utf-8').read().strip()
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PW, timeout=25)


def run(cmd, t=240):
    si, so, se = c.exec_command(cmd, timeout=t)
    return (so.read().decode('utf-8', 'ignore') + se.read().decode('utf-8', 'ignore')).strip()


SERVER_FILES = ['app.py', 'net.py', 'world.py', 'db.py', 'protocol.py',
                'skin_custom.py', 'battlereport.py', 'battlereport_run.py']
WEB_FILES = ['index.html', 'core/game.js', 'platform/web.js']

print('== 1/6 备份 ==')
print(run('mkdir -p %s/backups && cp -f %s/server/game.db %s/backups/game-%s.db && ls -lh %s/backups | tail -2'
          % (REMOTE, OPT, REMOTE, STAMP, REMOTE)))

print('== 2/6 停服务 ==')
print(run('sudo systemctl stop xiuxian; sleep 1; systemctl is-active xiuxian'))

print('== 3/6 传文件 ==')
sftp = c.open_sftp()
for fn in SERVER_FILES:
    lp = os.path.join(ROOT, 'server', fn)
    if os.path.isfile(lp):
        sftp.put(lp, REMOTE + '/server/' + fn)
        print('   server/' + fn)
for fn in WEB_FILES:
    sftp.put(os.path.join(ROOT, 'web', fn), REMOTE + '/web/' + fn)
    print('   web/' + fn)
sftp.close()

print('== 4/6 复制 + 起服 ==')
cmds = ['sudo cp -f %s/server/*.py %s/server/' % (REMOTE, OPT),
        'sudo cp -f %s/web/index.html %s/web/' % (REMOTE, OPT),
        'sudo cp -f %s/web/core/game.js %s/web/core/' % (REMOTE, OPT),
        'sudo cp -f %s/web/platform/web.js %s/web/platform/' % (REMOTE, OPT),
        'sudo chown -R xiuxian:xiuxian %s' % OPT,
        'sudo systemctl start xiuxian', 'sleep 7', 'systemctl is-active xiuxian']
print('   ' + run(' && '.join(cmds)))

print('== 5/6 健康 + schema ==')
time.sleep(2)
try:
    h = json.loads(urllib.request.urlopen('http://%s:8899/api/health' % HOST, timeout=8).read())
    print('   health:', json.dumps(h, ensure_ascii=False)[:150])
except Exception as e:
    print('   health 失败：%r' % (e,))
print('   库版本: ' + run('cd %s/server && sudo -u xiuxian python3 -c '
                        '"import sqlite3;c=sqlite3.connect(\'game.db\');'
                        'print(c.execute(\'PRAGMA user_version\').fetchone()[0],'
                        ' [r[1] for r in c.execute(\'PRAGMA table_info(skin_custom)\')])"' % OPT))

print('== 6/6 外网核对新代码 ==')
MARKS = [
    ('/core/game.js', 'SK_PROP_ADJUST', '比例调整开关'),
    ('/core/game.js', 'faceS', '五官跟着头缩'),
    ('/platform/web.js', 'skincustomok', '自定义回执处理'),
    ('/platform/web.js', 'skcPreview', '自定义实时预览'),
    ('/platform/web.js', 'skcThumb', '自定义缩略图'),
    ('/index.html', 'skCPanel', '自定义子页'),
    ('/index.html', 'skNav', '二级导航'),
]
bad = 0
for path, mk, desc in MARKS:
    try:
        body = urllib.request.urlopen('http://%s:8899%s' % (HOST, path), timeout=10).read().decode('utf-8', 'ignore')
    except Exception as e:
        print('   ✗ 抓不到 %s' % path)
        bad += 1
        continue
    ok = mk in body
    if not ok:
        bad += 1
    print('   %s %s' % ('✓' if ok else '✗', desc))

# gzip 还在不在（round507 的优化）
try:
    req = urllib.request.Request('http://%s:8899/api/rank?board=level' % HOST)
    req.add_header('Accept-Encoding', 'gzip')
    r = urllib.request.urlopen(req, timeout=10)
    print('   %s gzip 通道（%s）' % ('✓' if (r.headers.get('Content-Encoding') == 'gzip') else '✗',
                                    r.headers.get('Content-Encoding') or '-'))
except Exception as e:
    print('   ✗ gzip 检查失败 %r' % (e,))

c.close()
print()
print('结果：' + ('全部生效 ✓' if bad == 0 else '有 %d 项没过 ✗' % bad))
