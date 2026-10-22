# -*- coding: utf-8 -*-
"""同步这一批改动到云端 43.138.171.250

这一批（round424 之后的全部）：
  · 性能：A1 四肢实例化 / A2 静态 LOD / A3 远处不算肢体 / 名牌 DOM 优化
  · 加载：gzip + ETag/304 + 音效 ogg 优先 + 按需加载
  · 修正：突破事件广播（lvfx）/ 雷声进核心集 / 尸体残肢
  · 新功能：升级特效、挂机击杀数、排行榜已在上一批
  · 登录界面：照搬游戏画面 + 方块像素风 + 改名「块来修仙」
  · 缓存：HTML ETag 带构建号（修"改了没变化"）

流程：体检 → 备份 → 停服 → 传 → 覆盖 → 语法自检 → 起服 → 内外网核对
★ 不传 server/config.json（云端管理密码不一样 ✗）
★ 不传 game.db（云端有真实玩家数据 ✗）
"""
import io
import json
import os
import time
import urllib.request

import paramiko

HOST = '43.138.171.250'
USER = 'ubuntu'
PW = io.open(os.path.expanduser('~/.xiuxian_deploy'), encoding='utf-8').read().strip()
ROOT = 'C:/mc/xiuxian-2d'
REMOTE = '/home/ubuntu/xiuxian2d'
TS = time.strftime('%Y%m%d-%H%M%S')

SERVER_FILES = ['app.py', 'world.py', 'net.py', 'mobs.py', 'drops.py',
                'protocol.py', 'auth.py', 'db.py', 'rankboard.py']
WEB_FILES = ['index.html', 'sw.js', 'core/game.js', 'platform/web.js']
ASSETS = ['assets/sfx/thunder1.wav', 'assets/sfx/thunder1.mp3']

FILES = (['server/' + f for f in SERVER_FILES]
         + ['web/' + f for f in WEB_FILES]
         + ['web/' + a for a in ASSETS])

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PW, timeout=25)


def run(cmd, t=180):
    si, so, se = c.exec_command(cmd, timeout=t)
    return (so.read().decode('utf-8', 'ignore') + se.read().decode('utf-8', 'ignore')).strip()


def fetch(path, timeout=12):
    try:
        with urllib.request.urlopen('http://%s:8899%s' % (HOST, path), timeout=timeout) as f:
            return f.read().decode('utf-8', 'ignore')
    except Exception as e:
        print('   抓 %s 失败：%r' % (path, e))
        return ''


print('== 0/8 部署前体检 ==')
print('   服务: ' + run('systemctl is-active xiuxian'))
print('   health: ' + run('curl -s -m 6 http://127.0.0.1:8899/api/health')[:200])

print('')
print('== 1/8 备份（server 目录 + game.db）==')
bk = '/home/ubuntu/backup-' + TS
print('   ' + run('mkdir -p %s && sudo cp -a /opt/xiuxian2d/server/. %s/ && '
                  'sudo cp -a /opt/xiuxian2d/server/game.db %s/game.db.bak && '
                  'sudo chown -R ubuntu:ubuntu %s && du -sh %s' % (bk, bk, bk, bk, bk)))

print('')
print('== 2/8 停服 ==')
print('   ' + run('sudo systemctl stop xiuxian; sleep 2; systemctl is-active xiuxian'))

print('')
print('== 3/8 传文件（%d 个）==' % len(FILES))
sftp = c.open_sftp()
for rel in FILES:
    lp = os.path.join(ROOT, rel.replace('/', os.sep))
    rp = REMOTE + '/' + rel
    run('mkdir -p %s' % os.path.dirname(rp))
    sftp.put(lp, rp)
    print('   %-34s %8d 字节' % (rel, os.path.getsize(lp)))
sftp.close()

print('')
print('== 4/8 覆盖到 /opt（逐个 cp ✗ 不 cp -r，免得盖掉 config.json）==')
cmds = ['sudo cp -f %s/%s /opt/xiuxian2d/%s' % (REMOTE, r, r) for r in FILES]
print('   ' + run(' && '.join(cmds) + ' && echo COPY_OK'))
print('   ' + run('sudo chown -R xiuxian:xiuxian /opt/xiuxian2d && '
                  'ls -la /opt/xiuxian2d/web/assets/sfx/thunder1.* && '
                  'sha1sum /opt/xiuxian2d/server/config.json'))

print('')
print('== 5/8 语法自检 ==')
print('   ' + run('cd /opt/xiuxian2d/server && sudo -u xiuxian python3 -c '
                  '"import ast,glob;[ast.parse(open(f,encoding=\'utf-8\').read()) '
                  'for f in glob.glob(\'*.py\')];print(\'AST OK\')"'))
print('   js: ' + run('cd /opt/xiuxian2d/web && (node --check core/game.js && node --check platform/web.js && echo JS_OK) || echo JS_FAIL'))

print('')
print('== 6/8 起服务 ==')
print('   ' + run('sudo systemctl start xiuxian; sleep 10; systemctl is-active xiuxian'))
print('   tick 报错: ' + (run('sudo journalctl -u xiuxian --since "-3 min" | grep -F "tick] 出错" | tail -3') or '（没有 ✓）'))
print('   最近日志: ' + run('sudo journalctl -u xiuxian --since "-2 min" | tail -4 | tr "\\n" " | "')[:400])

print('')
print('== 7/8 服务端自测 ==')
print('   health: ' + run('curl -s -m 6 http://127.0.0.1:8899/api/health')[:240])
print('   rank: ' + run('curl -s -m 8 "http://127.0.0.1:8899/api/rank?board=level&page=1&size=3" | head -c 200'))

print('')
print('== 8/8 外网核对（抓真实吐出来的文件）==')
marks = {
    '/index.html': ['块来修仙', 'name="build"', 'id="loginFx"', 'atLogin'],
    '/core/game.js': ['LOGIN_CINE', 'fxLevelUp', 'limbInstTick', 'SFX_CORE'],
    '/platform/web.js': ['LOGIN_CINE', 'autoStatShow', 'perfBar', 'blocky'],
    '/sw.js': ['xx2d-v121'],
}
allok = True
for path, mks in marks.items():
    body = fetch(path)
    if not body:
        allok = False
        print('   ✗ %s 抓不到' % path)
        continue
    for mk in mks:
        hit = mk in body
        if not hit:
            allok = False
        print('   %s %-16s %s' % ('✓' if hit else '✗', mk, path))

# 不应再出现的旧东西
bad = {'/core/game.js': ['loginStageBuild'], '/platform/web.js': ['loginFxStart']}
for path, mks in bad.items():
    body = fetch(path)
    for mk in mks:
        hit = mk in body
        if hit:
            allok = False
        print('   %s 旧代码已清 %-14s %s' % ('✓' if not hit else '✗', mk, path))

# 素材能不能取到
for a in ['/assets/sfx/thunder1.mp3', '/assets/sfx/thunder1.wav', '/assets/3d/grass_top.png']:
    try:
        with urllib.request.urlopen('http://%s:8899%s' % (HOST, a), timeout=10) as f:
            n = len(f.read())
        print('   ✓ 素材 %-30s %d 字节' % (a, n))
    except Exception as e:
        allok = False
        print('   ✗ 素材 %-30s %r' % (a, e))

# gzip + ETag 是否生效
try:
    req = urllib.request.Request('http://%s:8899/core/game.js' % HOST,
                                 headers={'Accept-Encoding': 'gzip'})
    with urllib.request.urlopen(req, timeout=15) as f:
        enc = f.headers.get('Content-Encoding')
        cl = f.headers.get('Content-Length')
        et = f.headers.get('ETag')
    print('   gzip=%s  Content-Length=%s  ETag=%s' % (enc, cl, et))
    print('   %s gzip 生效' % ('✓' if enc == 'gzip' else '✗'))
    print('   %s ETag 有' % ('✓' if et else '✗'))
except Exception as e:
    print('   ✗ 头信息检查失败 %r' % e)

print('')
print('结果: ' + ('全部通过 ✓' if allok else '有未通过项 ✗'))
c.close()
