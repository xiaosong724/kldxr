# -*- coding: utf-8 -*-
"""把云服务器上的存档拉回本地（或推上去）

★ 为什么要这个：
  云端跑起来之后，两边存档各走各的 ✗
  朋友在云上玩 → 数据在云上 ✓ 你本地想看看/备份/继续开发 → 就得拉回来 ✓

用法：
    python tools/sync_db.py pull      # 云端 → 本地（拉回来，会先备份本地那份）
    python tools/sync_db.py push      # 本地 → 云端（推上去，会先备份云端那份）
    python tools/sync_db.py info      # 只看两边各有多少账号/角色，不改任何东西

★ 安全：
  · 每次覆盖前，会先把被覆盖的那份存成 game.db.bak-时间戳 ✓ 不会真丢 ✓
  · 服务器上的操作会先停服务、再改文件、再起服务 ✗ 避免写坏 ✓
  · 密码不写进这个文件 ✗ 从 环境变量 或 ~/.xiuxian_deploy 里读 ✓
"""
import io
import os
import posixpath
import shutil
import sqlite3
import sys
import time

try:
    import paramiko
except ImportError:
    print('缺 paramiko：pip install paramiko')
    sys.exit(1)

HOST = '43.138.171.250'
USER = 'ubuntu'
REMOTE_DB = '/opt/xiuxian2d/server/game.db'
LOCAL_DB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        'server', 'game.db')
PW_FILE = os.path.expanduser('~/.xiuxian_deploy')


def get_pw():
    pw = os.environ.get('XIUXIAN_PW')
    if pw:
        return pw.strip()
    if os.path.exists(PW_FILE):
        return io.open(PW_FILE, encoding='utf-8').read().strip()
    print('没找到密码 ✗ 两种给法：')
    print('  ① 设环境变量：  set XIUXIAN_PW=你的服务器密码')
    print('  ② 写进文件：    %s（一行，就是登录密码）' % PW_FILE)
    sys.exit(1)


def ssh():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=get_pw(), timeout=20)
    return c


def run(c, cmd, t=90):
    si, so, se = c.exec_command(cmd, timeout=t)
    return (so.read().decode('utf-8', 'ignore') + se.read().decode('utf-8', 'ignore')).strip()


def counts(path):
    try:
        c = sqlite3.connect('file:%s?mode=ro' % path, uri=True)
        a = c.execute('SELECT COUNT(*) FROM accounts').fetchone()[0]
        r = c.execute('SELECT COUNT(*) FROM roles').fetchone()[0]
        top = c.execute('SELECT name, level FROM roles ORDER BY level DESC LIMIT 1').fetchone()
        c.close()
        return '%d 账号 · %d 角色 · 最高 %s(%s 级)' % (a, r, top[0], top[1])
    except Exception as e:
        return '读不了（%s）' % e


def stamp():
    return time.strftime('%Y%m%d-%H%M%S')


def main():
    what = (sys.argv[1] if len(sys.argv) > 1 else 'info').lower()
    c = ssh()
    try:
        sftp = c.open_sftp()
        if what == 'info':
            print('  云端：%s' % run(c, 'sudo ls -la %s | awk \'{print $5" 字节"}\'' % REMOTE_DB))
            # 把远端库拉到临时文件再统计（只读 ✓ 不影响服务 ✓）
            tmp = os.path.join(os.environ.get('TEMP', '/tmp'), 'cloud_peek.db')
            sftp.get(REMOTE_DB, tmp)
            print('     %s' % counts(tmp))
            os.remove(tmp)
            print('  本地：%s' % counts(LOCAL_DB))
            print('  （info 只读 ✗ 什么都没改 ✓）')
            return

        if what == 'pull':
            print('  拉：云端 → 本地')
            # ★★★ 第 229 轮修的真问题 ★★★
            #   数据库是 WAL 模式 ✗ 直接拉 game.db 拿到的可能是【不一致的副本】✓
            #   （已提交的数据可能还在 game.db-wal 里 ✓
            #     看着像个好文件 ✗ 恢复的时候才发现坏 ✓ 那时候已经晚了 ✓）
            #   → 先在云端跑一次【在线备份】✗ 再把那个备份文件拉回来 ✓
            #     （用服务器上现成的 server/backup_db.py ✓ 它用的是标准库 ✓）
            print('    先在云端做在线备份（WAL 下只有这样才能拿到一致副本 ✓）')
            out = run('cd /opt/xiuxian2d/server && sudo -u xiuxian /usr/bin/python3 '
                      'backup_db.py --keep 30 2>&1 | tail -3')
            print('    ' + (out.replace(chr(10), chr(10) + '    ') if out else '(没有输出)'))
            newbk = run("ls -t /opt/xiuxian2d/server/backups/game-*.db 2>/dev/null | head -1")
            if not newbk:
                print('    ✗ 云端没生成备份 ✗ 中止（宁可不动本地存档 ✓）')
                return
            print('    拉取：%s' % newbk)
            tmp = LOCAL_DB + '.new'
            sftp.get(newbk, tmp)
            print('    下载完成 → %s' % counts(tmp))
            if os.path.exists(LOCAL_DB):
                bak = LOCAL_DB + '.bak-' + stamp()
                shutil.copy2(LOCAL_DB, bak)
                print('    本地旧存档已备份：%s' % os.path.basename(bak))
            shutil.move(tmp, LOCAL_DB)
            print('  OK 本地存档已更新 ✓ %s' % counts(LOCAL_DB))
            print('  ★ 如果本地服务器正开着，记得重启它才会读到新存档 ✓')
            return

        if what == 'push':
            print('  推：本地 → 云端')
            print('    本地：%s' % counts(LOCAL_DB))
            print('    ★ 先停云端服务（避免边写边存写坏）')
            run(c, 'sudo systemctl stop xiuxian')
            run(c, 'sudo cp %s %s.bak-%s' % (REMOTE_DB, REMOTE_DB, stamp()))
            sftp.put(LOCAL_DB, '/tmp/upload.db')
            run(c, 'sudo mv /tmp/upload.db %s && sudo chown xiuxian:xiuxian %s' % (REMOTE_DB, REMOTE_DB))
            run(c, 'sudo systemctl start xiuxian')
            time.sleep(2)
            print('    云端服务：%s' % run(c, 'systemctl is-active xiuxian'))
            print('  OK 云端存档已更新 ✓ 旧的备份在 %s.bak-* ✓' % REMOTE_DB)
            return

        print('用法：python tools/sync_db.py [info|pull|push]')
    finally:
        c.close()


if __name__ == '__main__':
    main()
