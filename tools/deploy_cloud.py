# -*- coding: utf-8 -*-
"""把本地这一批修复同步到云端 43.138.171.250

流程（第 196 轮教训 + 第 215 轮教训）：
  ① 先停服务 ✗ 不能边跑边传（玩家会看到半个页面 → "SETCFG is not defined"）
  ② 传改动的文件
  ③ 复制到 /opt + 起服务
  ④ ★ 从外网核对【服务器实际吐出来的文件】里有没有新代码
     （只看"服务在跑"不够 ✗ 可能跑的是旧进程 ✓）
"""
import io
import os
import time
import urllib.request

import paramiko

HOST = '43.138.171.250'
USER = 'ubuntu'
PW = io.open(os.path.expanduser('~/.xiuxian_deploy'), encoding='utf-8').read().strip()
ROOT = 'C:/mc/xiuxian-2d'
REMOTE = '/home/ubuntu/xiuxian2d'

FILES = [
    'server/world.py',      # 重复结算修复 + 别人的 hpm + 假死相关的服务端
    'server/mobs.py',       # Mob.__slots__ 加 awarded
    'server/app.py',        # allow_reuse_address（第 207 轮）
    'web/core/game.js',     # 自动战斗 + 血量采用 + hpm 映射
    'web/platform/web.js',  # 长按开关 + 加载动画 + 不同步看门狗 + 假死兜底
    'web/index.html',       # 加载动画 + 状态小字 + 提示行
]

# 传完之后，从外网抓这些文件，检查里面有没有"这一批新代码"的标志
MARKS = {
    '/core/game.js': [('autoTick', '自动战斗核心'),
                      ('hpm: (typeof w.hpm', '别人血条上限映射'),
                      ('_shp <= 0', '假死时采用服务器血量')],
    '/platform/web.js': [('AUTO_LONG_PRESS', '长按攻击键开关'),
                         ('bootDone', '加载动画'),
                         ('_desyncCount', '不同步看门狗'),
                         ('playerDie', '假死兜底')],
    '/index.html': [('id="boot"', '加载启动页'),
                    ('id="autoInfo"', '自动战斗状态条'),
                    ('自动战斗', '提示行/百科')],
    '/world.js': [],
}


def fetch(path):
    try:
        with urllib.request.urlopen('http://%s:8899%s' % (HOST, path), timeout=8) as f:
            return f.read().decode('utf-8', 'ignore')
    except Exception as e:
        return ''


c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PW, timeout=20)


def run(cmd, t=180):
    si, so, se = c.exec_command(cmd, timeout=t)
    return (so.read().decode('utf-8', 'ignore') + se.read().decode('utf-8', 'ignore')).strip()


print('== 1/5 停服务（玩家会看到"服务器维护中"页 ✓ 15 秒后自动重连 ✓）')
print('   ' + (run('sudo systemctl stop xiuxian; sleep 2; systemctl is-active xiuxian') or '(已停)'))

print('== 2/5 传文件 ==')
sftp = c.open_sftp()
for rel in FILES:
    sftp.put(os.path.join(ROOT, rel.replace('/', os.sep)), REMOTE + '/' + rel)
    print('   ' + rel)
sftp.close()

print('== 3/5 复制到 /opt 并起服务 ==')
print('   ' + run('sudo cp -r %s/server %s/web /opt/xiuxian2d/ && '
                  'sudo chown -R xiuxian:xiuxian /opt/xiuxian2d && '
                  'sudo systemctl start xiuxian; sleep 5; systemctl is-active xiuxian'
                  % (REMOTE, REMOTE)))

print('== 4/5 服务端自测 ==')
print('   ' + run('curl -s -m 6 http://127.0.0.1:8899/api/health | head -c 100'))
print('   端口: ' + run("sudo ss -ltn | grep -E '8899|8900' | awk '{print $4}' | tr '\\n' ' '"))

print('== 5/5 ★ 从外网核对服务器实际吐出来的文件 ==')
allok = True
for path, marks in MARKS.items():
    if not marks:
        continue
    body = fetch(path)
    if not body:
        print('   ✗ %s 抓不到' % path)
        allok = False
        continue
    for mk, desc in marks:
        hit = mk in body
        if not hit:
            allok = False
        print('   %s %-22s %s' % ('✓' if hit else '✗', desc, path))
print()
print('   ★ 结论：' + ('这一批新代码全都在云端生效了 ✓✓' if allok
                     else '有缺的 ✗ 见上面 ✗ 号那几行'))
c.close()
