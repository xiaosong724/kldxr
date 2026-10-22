# -*- coding: utf-8 -*-
"""2026-10-20 技能系统同步：本地 -> 云端 43.138.171.250

流程：预检 → 停服 → 备份 DB/代码 → 上传 → 复制 → 起服 → 健康/外网核对 → 发布公告
任何一步失败都尽量回滚代码和 DB。
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
PW = io.open(os.path.expanduser('~/.xiuxian_deploy'), encoding='utf-8').read().strip()

SERVER_FILES = sorted([f for f in os.listdir(os.path.join(ROOT, 'server'))
                       if f.endswith('.py')])
WEB_FILES = [
    'index.html', 'sw.js', 'vfx.js', 'icons.js',
    'core/game.js', 'platform/web.js',
    'ann.html', 'admin-ann.html', 'admin.html', 'lib/annrender.js',
]
ANN_FILE = os.path.join(ROOT, 'tools', 'announce', '2026-10-20-技能系统.json')


def http_json(url, body=None, token=None, timeout=12):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['X-Admin'] = token
    req = urllib.request.Request(url, data=(json.dumps(body, ensure_ascii=False).encode('utf-8')
                                            if body is not None else None),
                                 headers=headers, method=('POST' if body is not None else 'GET'))
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8'))


c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PW, timeout=25)


def run(cmd, t=240):
    si, so, se = c.exec_command(cmd, timeout=t)
    return (so.read().decode('utf-8', 'ignore') + se.read().decode('utf-8', 'ignore')).strip()


def health():
    try:
        return http_json('http://%s:8899/api/health' % HOST, timeout=8)
    except Exception as e:
        return {'ok': False, 'err': repr(e)}


def schema():
    return run("cd %s/server && sudo -u xiuxian python3 -c \"import sqlite3;c=sqlite3.connect('game.db');"
               "print(c.execute('PRAGMA user_version').fetchone()[0])\"" % OPT, 30)


print('== 0/8 预检 ==')
print('   服务:', run('systemctl is-active xiuxian'))
print('   DB schema:', schema())
h0 = health()
print('   health ok:', bool(h0.get('ok')), 'online:', (h0.get('world') or {}).get('online'))
if not h0.get('ok'):
    c.close()
    raise SystemExit('预检失败：云端 health 不通，先不动')

print('== 1/8 停服务 ==')
print('   ' + run('sudo systemctl stop xiuxian; sleep 2; systemctl is-active xiuxian'))
print('   确认停服: ' + run('curl -s -m 2 http://127.0.0.1:8899/api/health >/dev/null && echo STILL_UP || echo DOWN', 10))

print('== 2/8 备份 DB + 代码 ==')
print('   ' + run('mkdir -p %s/backups && cp -f %s/server/game.db %s/backups/game-%s.db && '
                  'tar czf %s/backups/code-%s.tgz -C %s server web && ls -lh %s/backups/game-%s.db %s/backups/code-%s.tgz | tail -2'
                  % (REMOTE, OPT, REMOTE, STAMP, REMOTE, STAMP, OPT,
                     REMOTE, STAMP, REMOTE, STAMP)))

print('== 3/8 上传 ==')
sftp = c.open_sftp()
for rel in SERVER_FILES:
    sftp.put(os.path.join(ROOT, 'server', rel), REMOTE + '/server/' + rel)
for rel in WEB_FILES:
    lp = os.path.join(ROOT, 'web', rel.replace('/', os.sep))
    if not os.path.isfile(lp):
        raise SystemExit('缺文件：' + lp)
    sftp.put(lp, REMOTE + '/web/' + rel)
sftp.close()
print('   server py:', len(SERVER_FILES), ' web:', len(WEB_FILES))

print('== 4/8 复制到 /opt ==')
cmds = ['sudo mkdir -p %s/server %s/web/core %s/web/platform %s/web/lib' % (OPT, OPT, OPT, OPT),
        'sudo cp -f %s/server/*.py %s/server/' % (REMOTE, OPT),
        'sudo cp -f %s/web/index.html %s/web/' % (REMOTE, OPT),
        'sudo cp -f %s/web/sw.js %s/web/' % (REMOTE, OPT),
        'sudo cp -f %s/web/vfx.js %s/web/' % (REMOTE, OPT),
        'sudo cp -f %s/web/icons.js %s/web/' % (REMOTE, OPT),
        'sudo cp -f %s/web/ann.html %s/web/' % (REMOTE, OPT),
        'sudo cp -f %s/web/admin-ann.html %s/web/' % (REMOTE, OPT),
        'sudo cp -f %s/web/admin.html %s/web/' % (REMOTE, OPT),
        'sudo cp -f %s/web/core/game.js %s/web/core/' % (REMOTE, OPT),
        'sudo cp -f %s/web/platform/web.js %s/web/platform/' % (REMOTE, OPT),
        'sudo cp -f %s/web/lib/annrender.js %s/web/lib/' % (REMOTE, OPT),
        'sudo chown -R xiuxian:xiuxian %s' % OPT]
print('   ' + run(' && '.join(cmds)))

print('== 5/8 起服务 ==')
print('   ' + run('sudo systemctl start xiuxian; sleep 8; systemctl is-active xiuxian', 30))
ok = False
for _ in range(6):
    time.sleep(2)
    h = health()
    if h.get('ok'):
        ok = True
        print('   health:', json.dumps(h, ensure_ascii=False)[:220])
        break
if not ok:
    h = health()
    print('   health 失败:', h)
    print('   开始回滚代码/DB ...')
    run('sudo systemctl stop xiuxian; sleep 1; '
        'sudo tar xzf %s/backups/code-%s.tgz -C %s && '
        'sudo cp -f %s/backups/game-%s.db %s/server/game.db && '
        'sudo chown -R xiuxian:xiuxian %s && '
        'sudo systemctl start xiuxian; sleep 6; systemctl is-active xiuxian'
        % (REMOTE, STAMP, OPT, REMOTE, STAMP, OPT, OPT), 60)
    print('   回滚后 health:', health())
    c.close()
    raise SystemExit('部署失败，已尝试回滚')

print('== 6/8 schema / 外网核对 ==')
print('   DB schema:', schema())
MARKS = [
    ('/vfx.js', 'V.impact', '落点冲击 VFX'),
    ('/vfx.js', 'POOL_GHOST', '残影对象池'),
    ('/core/game.js', 'CAM_YAW0', '相机默认 yaw'),
    ('/platform/web.js', 'MY_PLAGUE', '病毒绿色光环'),
    ('/index.html', 'qiw', '灵气条'),
    ('/icons.js', 'pillar', '烈焰风暴图标'),
]
bad = 0
for path, mk, desc in MARKS:
    try:
        body = urllib.request.urlopen('http://%s:8899%s' % (HOST, path), timeout=10).read().decode('utf-8', 'ignore')
        hit = mk in body
    except Exception:
        hit = False
        body = ''
    print('   %s %s %s' % ('✓' if hit else '✗', desc, path))
    if not hit:
        bad += 1
if bad:
    c.close()
    raise SystemExit('外部核对有 %d 项不通过，先不发布公告' % bad)

print('== 7/8 读取云端管理密码并发布公告 ==')
cloud_pw = run("sudo -u xiuxian python3 -c \"import json;print(json.load(open('%s/server/config.json'))['admin_password'])\"" % OPT, 20).strip()
if not cloud_pw:
    c.close()
    raise SystemExit('读不到云端管理密码，代码已上线，公告未发布')
data = json.load(open(ANN_FILE, encoding='utf-8'))
data['badge'] = ''
login = http_json('http://%s:8899/api/admin/login' % HOST, {'password': cloud_pw})
tok = login.get('token') or ''
if not tok:
    c.close()
    raise SystemExit('云端管理登录失败，公告未发布')
res = http_json('http://%s:8899/api/admin/announce' % HOST,
                dict(data, publish=True), token=tok)
print('   publish:', json.dumps(res, ensure_ascii=False)[:300])
if not res.get('ok'):
    c.close()
    raise SystemExit('公告发布失败：%r' % (res,))

print('== 8/8 最终核对 ==')
latest = http_json('http://%s:8899/api/announce/latest' % HOST)
ann = latest.get('ann') or latest
print('   latest:', {'id': ann.get('id'), 'headline': ann.get('headline'),
                     'badge': ann.get('badge'), 'items': len(ann.get('items') or [])})
print('   health ok:', bool(health().get('ok')))
c.close()
print('完成 ✓')
