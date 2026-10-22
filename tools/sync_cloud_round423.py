# -*- coding: utf-8 -*-
"""把这一大批（round409 ~ round423）同步到云端 43.138.171.250

流程（沿用第 196 / 215 / 226 轮的教训）：
  ① 先【备份】云端 server/ 目录 + game.db（出问题能立刻回滚）
  ② 停服务 ✗ 不能边跑边传（玩家会看到半个页面）
  ③ 只传【显式清单】里的文件 ✗ 绝不 cp -r 整个目录
  ④ 逐个 cp 到 /opt/xiuxian2d（不用 `cp -r web/.` ✗ 那会把没传的旧文件也盖上去）
  ⑤ ★ 改云端 config.json 的 qq 段（群号 346049634 / url 用 127.0.0.1）
     ★ 只动 qq 这一个键 ✗ 管理密码/端口一律不碰（云端密码是改过的 ✓）
  ⑥ 起服务（首次启动会跑 schema v7 → v9 迁移：只 CREATE TABLE IF NOT EXISTS ✓ 安全）
  ⑦ 从【外网】核对服务器真吐出来的东西里有没有新代码（只看"服务在跑"不够）

跑法：python tools\\sync_cloud_round423.py
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

# ★ 显式清单 ✗ 一个文件一行 ✓
FILES = [
    'server/app.py',
    'server/auth.py',
    'server/db.py',
    'server/market.py',
    'server/net.py',
    'server/protocol.py',
    'server/talents.py',
    'server/value.py',
    'server/weapons.py',
    'server/world.py',
    'server/qqbridge.py',        # ★ 新文件（漏传 = 不转发 ✓ 但至少不会崩）
    # ★★★ round423 次部署就是漏了它 → 云端直接起不来 ✗✗
    #   ModuleNotFoundError: No module named 'terrain'
    #   云端从来没有过这个文件（它是 round306 加的）✗
    #   ★ 教训：新加的 import 对应的模块也要进清单 → 见下面的「缺模块对比」
    'server/terrain.py',
    'web/core/game.js',
    'web/platform/web.js',
    'web/index.html',
    'web/admin.html',
]

# ★★ 绝对不传：server/config.json（云端管理密码是改过的）、server/game.db（玩家数据）
#    ★ 云端 config 的 qq 段由下面的 patch 单独加 ✓

QQ_BLOCK = {
    '_说明': '滚动通知 / 玩家上线 → QQ 群（走 qq-forwarder 的 /api/bridge/send）',
    '_怎么用': 'enabled=false 一句话都不发 ✓ 管理页也能开关 ✓ 排查看 /api/health 的 qq 段 ✓',
    'enabled': True,
    'url': 'http://127.0.0.1:8099/api/bridge/send',   # ★ 同机 → 走本地回环，别绕公网
    'token': 'N7hyNbxaEVK2f2PxL_75gYlk',
    'group': '346049634',                            # ★ 云端 = 主群（本地是测试群）
    'minIntervalMs': 1500,
    'kinds': ['up', 'kill', 'mq', 'tier', 'join', 'sys'],
}

# 外网核对：服务器吐出来的文件里必须有这些新东西
MARKS = {
    '/index.html': [('rowZoom', '设置里的画面放大'),
                    ('id="auto"><span class="aitxt">挂机', '挂机按钮文字'),
                    ('点【键位】可以移动按钮', '新提示文案')],
    '/platform/web.js': [("mkOpts('rowZoom'", '画面放大档位'),
                         ('qq', 'QQ 转发相关（宽匹配）'),
                         ('statSheetHTML', '天赋属性面板')],
    '/core/game.js': [('terYAt(e.g.position.x', '掉落物按地形高度'),
                       ('applyWorldZoom', '画面放大（相机）'),
                       ('（弓）：放箭', '自动战斗远程打法')],
}


def fetch(path, timeout=8):
    try:
        with urllib.request.urlopen('http://%s:8899%s' % (HOST, path), timeout=timeout) as f:
            return f.read().decode('utf-8', 'ignore')
    except Exception as e:
        print('   抓 %s 失败：%r' % (path, e))
        return ''


c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PW, timeout=25)


def run(cmd, t=180):
    si, so, se = c.exec_command(cmd, timeout=t)
    return (so.read().decode('utf-8', 'ignore') + se.read().decode('utf-8', 'ignore')).strip()


print('== 0/8 体检（改之前的状态）==')
print('   服务: ' + run('systemctl is-active xiuxian'))
print('   schema: ' + run('''sudo python3 -c "import sqlite3;print(sqlite3.connect('/opt/xiuxian2d/server/game.db')
.execute('select v from meta where k=\\"schema_version\\"').fetchone()[0])"'''))
print('   qq-forwarder(同机): ' + run('curl -s -m 5 http://127.0.0.1:8099/api/health | head -c 60'))
# ★★ 缺模块对比：本地有、云端没有的 *.py → 必须一起传 ✗
#   （round423 就是这么翻车的：terrain.py 云端从来没有 → 服务起不来 ✗）
_local_mods = sorted(os.path.basename(x) for x in
                     __import__('glob').glob(os.path.join(ROOT, 'server', '*.py')))
_remote_mods = run('ls /opt/xiuxian2d/server/*.py 2>/dev/null | xargs -n1 basename').split()
_missing = [m for m in _local_mods if m not in _remote_mods]
print('   云端缺的模块: ' + (', '.join(_missing) if _missing else '（一个不缺 ✓）'))
# ★★★ round423 第二次翻车的教训：
#   清单里没有 mobs.py / drops.py / mq.py / worldgen.py ✗
#   但它们也落后很多轮 ✗ 而新 world.py 要用 Mob.lavaT ✗
#   → 每个 tick 抛 AttributeError → 整个 tick 中止 → 玩家看起来就是"一直掉线"✗✗
#   ★ 现在：【自动把所有 md5 不一样的 server/*.py 加进清单】✗
#     以后不可能再漏模块（只要不是故意不想传的）✓
_remote_md5 = {}
for _ln in run('cd /opt/xiuxian2d/server && md5sum *.py 2>/dev/null').splitlines():
    _pp = _ln.split()
    if len(_pp) == 2:
        _remote_md5[_pp[1]] = _pp[0]
import hashlib as _hl
_auto = []
for _m in _local_mods:
    if _m in ('_serve2.py', 'config.json', 'game.db'):
        continue
    _lp = os.path.join(ROOT, 'server', _m)
    _lh = _hl.md5(open(_lp, 'rb').read()).hexdigest()
    if _remote_md5.get(_m) != _lh:
        _rel = 'server/' + _m
        if _rel not in FILES:
            _auto.append(_rel)
            FILES.append(_rel)
if _auto:
    print('   ★ 自动补上（清单里漏了、但云端版本不一样）：' + ', '.join(_auto))
else:
    print('   ★ 清单里的 server/*.py 已经是全部不一样的了 ✓')

_q = [m for m in _missing if m not in FILES and m not in ('_serve2.py', 'backup_db.py')]
if _q:
    print('   ⚠ 这些不在传输清单里但云端没有 → 可能起不来：' + ', '.join(_q))

print('')
print('== 1/8 备份（server 目录 + game.db）==')
bk = '/home/ubuntu/backup-' + TS
print('   ' + run('mkdir -p %s && sudo cp -a /opt/xiuxian2d/server/. %s/ && '
                  'sudo cp -a /opt/xiuxian2d/server/game.db %s/game.db.bak && '
                  'sudo chown -R ubuntu:ubuntu %s && du -sh %s'
                  % (bk, bk, bk, bk, bk)))
print('   备份目录: ' + bk)

print('')
print('== 2/8 停服务 ==')
print('   ' + run('sudo systemctl stop xiuxian; sleep 2; systemctl is-active xiuxian'))

print('')
print('== 3/8 传文件（%d 个）==' % len(FILES))
sftp = c.open_sftp()
for rel in FILES:
    lp = os.path.join(ROOT, rel.replace('/', os.sep))
    rp = REMOTE + '/' + rel
    # 远端目标目录可能不存在（web/ 下新建的东西），先建一下
    run('mkdir -p %s' % os.path.dirname(rp))
    sftp.put(lp, rp)
    print('   %-24s %8d 字节' % (rel, os.path.getsize(lp)))
sftp.close()

print('')
print('== 4/8 逐个覆盖到 /opt（不用 cp -r ✓）==')
cmds = []
for rel in FILES:
    cmds.append('sudo cp -f %s/%s /opt/xiuxian2d/%s' % (REMOTE, rel, rel))
print('   ' + run(' && '.join(cmds) + ' && echo COPY_OK'))
print('   ' + run('sudo chown -R xiuxian:xiuxian /opt/xiuxian2d && ls -la /opt/xiuxian2d/server/qqbridge.py'))

print('')
print('== 5/8 给云端 config.json 加 qq 段（只动 qq 这个键）==')
patch = '''# -*- coding: utf-8 -*-
import json, shutil, time
P = "/opt/xiuxian2d/server/config.json"
shutil.copyfile(P, P + ".bak-''' + TS + '''")
cfg = json.load(open(P, encoding="utf-8"))
old = cfg.get("qq")
cfg["qq"] = ''' + repr(QQ_BLOCK) + '''
json.dump(cfg, open(P, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("old qq:", json.dumps(old, ensure_ascii=False)[:120])
print("new qq group:", cfg["qq"]["group"], "url:", cfg["qq"]["url"])
print("admin_password 长度（不能变）:", len(cfg.get("admin_password") or ""))
print("ports:", cfg.get("http_port"), cfg.get("ws_port"))
'''
with io.open(os.path.join(ROOT, 'tools', '_patch_qq.py'), 'w', encoding='utf-8') as f:
    f.write(patch)
sftp = c.open_sftp()
sftp.put(os.path.join(ROOT, 'tools', '_patch_qq.py'), '/home/ubuntu/_patch_qq.py')
sftp.close()
print('   ' + run('sudo python3 /home/ubuntu/_patch_qq.py'))
os.remove(os.path.join(ROOT, 'tools', '_patch_qq.py'))

print('')
print('== 6/8 起服务（会跑 schema v7 → v9 迁移）==')
print('   ' + run('sudo systemctl start xiuxian; sleep 8; systemctl is-active xiuxian'))
print('   迁移日志: ' + run('sudo journalctl -u xiuxian --since "-2 min" | grep -Ei "建表|迁移|schema|migrat" | tail -5'))
print('   schema: ' + run('''sudo python3 -c "import sqlite3;print(sqlite3.connect('/opt/xiuxian2d/server/game.db')
.execute('select v from meta where k=\\"schema_version\\"').fetchone()[0])"'''))

print('')
print('== 7/8 服务端自测 ==')
print('   health: ' + run('curl -s -m 6 http://127.0.0.1:8899/api/health'))
print('   端口: ' + run("sudo ss -ltn | grep -E '8899|8900' | awk '{print $4}' | tr '\\n' ' '"))
tickerr = run('sudo journalctl -u xiuxian --since "%s" | grep -F "tick] 出错" | tail -3'
                % run('systemctl show -p ActiveEnterTimestamp --value xiuxian'))
print('   ★★ tick 报错（这个一有，玩家就会"一直掉线"）：'
      + (tickerr if tickerr else '（没有 ✓）'))
err = run('sudo journalctl -u xiuxian --since "-2 min" | grep -Ei "traceback|error|exception" | tail -8')
print('   日志里的报错: ' + (err if err else '（没有 ✓）'))

print('')
print('== 8/8 ★ 从外网核对（文件真的换了没）==')
allok = True
for path, marks in MARKS.items():
    body = fetch(path)
    if not body:
        print('   ✗ %s 抓不到' % path)
        allok = False
        continue
    for mk, desc in marks:
        hit = mk in body
        if not hit:
            allok = False
        print('   %s %-26s %s' % ('✓' if hit else '✗', desc, path))

body = fetch('/api/health')
print('')
print('   外网 health: ' + body[:400])
try:
    d = json.loads(body)
    qq = d.get('qq') or {}
    print('   QQ 转发: on=%s group=%s sent=%s fails=%s'
          % (qq.get('on'), qq.get('group'), qq.get('sent'), qq.get('fails')))
    if qq.get('group') != '346049634':
        allok = False
        print('   ✗ 群号不对（应该是 346049634）')
except Exception as e:
    allok = False
    print('   ✗ health 解析失败：%r' % (e,))

c.close()
print('')
print('   ★ 结论：' + ('这一批全都在云端生效了 ✓✓' if allok else '有缺的 ✗ 见上面 ✗ 那几行'))
print('   ★ 回滚：sudo systemctl stop xiuxian && sudo cp -a %s/. /opt/xiuxian2d/server/ '
      '&& sudo systemctl start xiuxian' % bk)
