# -*- coding: utf-8 -*-
"""round500 同步到云端：皮肤系统 + 公告系统 + 视角转动 + 前几轮词条/攻速

流程（照沿用前几次的教训）：
  ① 先备份云端的库 + web
  ② 停服务（玩家会看到维护中，15 秒后自动重连）
  ③ 传文件 → 复制到 /opt → 起服务
  ④ 从外网核对"服务器真的吐出新代码"
  ⑤ 在云端【发布】这次的新公告
  ⑥ 核对公告接口 + 预览页

★ 不传 server/config.json（云端那份里有改过的管理密码 ✗ 传了就回退）
★ 不传 game.db（云端库不能覆盖）
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

PW = ''
for cand in (os.path.expanduser('~/.xiuxian_deploy'),):
    if os.path.isfile(cand):
        PW = io.open(cand, encoding='utf-8').read().strip()
        break

SERVER_FILES = [
    'affixes.py', 'app.py', 'armor.py', 'auth.py', 'db.py', 'market.py',
    'net.py', 'protocol.py', 'talents.py', 'value.py', 'weapons.py',
    'world.py', 'ws.py', 'rankboard.py', 'qqbridge.py',
    'announce.py', 'skins.py',          # ★ 新增
]
WEB_FILES = [
    'index.html', 'sw.js', 'admin.html',
    'core/game.js', 'platform/web.js',
    'lib/annrender.js',                  # ★ 新增
    'ann.html', 'admin-ann.html',        # ★ 新增
]

MARKS = [
    ('/core/game.js', 'CAM_YAW', '视角转动（core）'),
    ('/core/game.js', 'skBuildHero', '40 套皮肤构建器'),
    ('/platform/web.js', 'CAMROT', '视角按钮状态机'),
    ('/platform/web.js', 'annShow', '游戏内公告弹窗'),
    ('/index.html', 'id="cam"', '视角按钮 DOM'),
    ('/lib/annrender.js', 'AnnRender', '公告渲染器'),
]

FAILS = []


def ck(ok, msg, extra=''):
    print(('   ✓ ' if ok else '   ✗ ') + msg + (('  ' + str(extra)) if extra else ''))
    if not ok:
        FAILS.append(msg)


print('== 0/7 连接 %s ==' % HOST)
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
if PW:
    c.connect(HOST, username=USER, password=PW, timeout=25)
else:
    c.connect(HOST, username=USER, key_filename='C:/mc/tools/cloud_key', timeout=25)


def run(cmd, t=180):
    si, so, se = c.exec_command(cmd, timeout=t)
    return (so.read().decode('utf-8', 'ignore') + se.read().decode('utf-8', 'ignore')).strip()


print(run('hostname; ls -d %s %s; systemctl is-active xiuxian' % (REMOTE, OPT)))

print('\n== 1/7 备份（库 + web）==')
print(run('mkdir -p %s/backups && cp -f %s/server/game.db %s/backups/game-%s.db && '
          'tar czf %s/backups/web-%s.tgz -C %s web 2>/dev/null; ls -lh %s/backups | tail -3'
          % (REMOTE, OPT, REMOTE, STAMP, REMOTE, STAMP, OPT, REMOTE)))

print('\n== 2/7 停服务 ==')
print(run('sudo systemctl stop xiuxian; sleep 2; systemctl is-active xiuxian'))
time.sleep(1)

print('\n== 3/7 上传 %d 个文件 ==' % (len(SERVER_FILES) + len(WEB_FILES)))
sftp = c.open_sftp()
for fn in SERVER_FILES:
    lp = os.path.join(ROOT, 'server', fn)
    if not os.path.isfile(lp):
        print('   ! 本地没有 server/%s（跳过）' % fn)
        continue
    sftp.put(lp, REMOTE + '/server/' + fn)
    print('   server/' + fn)
for fn in WEB_FILES:
    lp = os.path.join(ROOT, 'web', fn)
    if not os.path.isfile(lp):
        print('   ! 本地没有 web/%s（跳过）' % fn)
        continue
    sftp.put(lp, REMOTE + '/web/' + fn)
    print('   web/' + fn)
sftp.close()

print('\n== 4/7 复制到 /opt 并起服务 ==')
cmds = [
    'sudo cp -f %s/server/*.py %s/server/' % (REMOTE, OPT),
    'sudo cp -f %s/web/index.html %s/web/' % (REMOTE, OPT),
    'sudo cp -f %s/web/sw.js %s/web/' % (REMOTE, OPT),
    'sudo cp -f %s/web/admin.html %s/web/' % (REMOTE, OPT),
    'sudo cp -f %s/web/ann.html %s/web/' % (REMOTE, OPT),
    'sudo cp -f %s/web/admin-ann.html %s/web/' % (REMOTE, OPT),
    'sudo cp -f %s/web/core/game.js %s/web/core/' % (REMOTE, OPT),
    'sudo cp -f %s/web/platform/web.js %s/web/platform/' % (REMOTE, OPT),
    'sudo mkdir -p %s/web/lib' % OPT,
    'sudo cp -f %s/web/lib/annrender.js %s/web/lib/' % (REMOTE, OPT),
    'sudo chown -R xiuxian:xiuxian %s' % OPT,
    'sudo systemctl start xiuxian',
    'sleep 6',
    'systemctl is-active xiuxian',
]
out = run(' && '.join(cmds))
print(out)

print('\n== 5/7 健康检查 ==')
for _ in range(10):
    time.sleep(2)
    try:
        h = json.loads(urllib.request.urlopen('http://%s:8899/api/health' % HOST,
                                              timeout=8).read())
        print('   ' + json.dumps(h, ensure_ascii=False)[:220])
        break
    except Exception as e:
        print('   等待服务… %r' % (e,))
else:
    ck(False, '服务没起来')

print('\n== 6/7 从外网核对新代码真的生效 ==')
for path, mark, desc in MARKS:
    try:
        body = urllib.request.urlopen('http://%s:8899%s' % (HOST, path),
                                      timeout=10).read().decode('utf-8', 'ignore')
    except Exception as e:
        ck(False, desc + ' 抓不到', repr(e))
        continue
    ck(mark in body, desc + '（' + path + '）')

try:
    adm = urllib.request.urlopen('http://%s:8899/admin/announce' % HOST, timeout=10)
    ck('公告管理' in adm.read().decode('utf-8', 'ignore'), '公告管理页能打开（/admin/announce）')
except Exception as e:
    ck(False, '公告管理页', repr(e))

print('\n== 7/7 在云端发布这次的公告 ==')
lp = os.path.join(ROOT, 'tools', 'announce', '2026-10-19-v1.4-皮肤系统.json')
sftp = c.open_sftp()
sftp.put(lp, '/tmp/ann-v14.json')
sftp.close()
py = (
    'import json, sys, announce, app;'
    'cfg = app.load_cfg();'
    "d = json.load(open('/tmp/ann-v14.json', encoding='utf-8'));"
    'aid = announce.create(cfg, d, publish=True);'
    "a = announce.get(cfg, aid);"
    "print('PUBLISHED', aid, a['title'], len(a['items']))"
)
out = run('cd %s/server && sudo -u xiuxian python3 -c %s' % (OPT, json.dumps(py)))
print('   ' + out)
ck('PUBLISHED' in out, '公告已发布到云端')

time.sleep(1)
try:
    latest = json.loads(urllib.request.urlopen(
        'http://%s:8899/api/announce/latest' % HOST, timeout=10).read())
    a = latest.get('ann') or {}
    ck(bool(a), '云端公告接口有数据', a.get('id'))
    ck(a.get('headline') == '皮肤系统 · 视角转动 · 游戏内公告',
       '云端公告标题对', a.get('headline'))
    page = urllib.request.urlopen('http://%s:8899/ann?shot=1' % HOST,
                                  timeout=10).read().decode('utf-8', 'ignore')
    # ★ 预览页是【JS 渲染】的 ✗ 原始 HTML 里没有公告正文 ✓
    #   所以只能查"它有没有把渲染器挂上"，正文由 /api/announce/latest 保证 ✓
    ck('annrender.js' in page, '云端预览页挂上了渲染器（正文由接口保证）')
except Exception as e:
    ck(False, '公告核对', repr(e))

print('\n===== 结果 =====')
if FAILS:
    print('有 %d 项没过：' % len(FAILS))
    for f in FAILS:
        print('  - ' + f)
else:
    print('全部通过 ✓ 云端已是最新（皮肤系统 / 公告系统 / 视角转动）')
c.close()
