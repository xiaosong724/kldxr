# -*- coding: utf-8 -*-
"""部署第 1 步：只把 backup_db.py 传上云端并跑一次在线备份

★ 为什么先做这一步：
   后面要跑两条【会写数据库】的修复（补满血 / 补老装备耐久）
   万一出问题，必须有一个【干净可回滚】的备份 ✓
   ★ 而且这个备份必须用【在线备份 API】✗ 不能直接 cp
     （WAL 模式下 cp 出来的可能是不一致的 ✓ 这是第 229 轮就查明的坑 ✓）

★ 本步骤【只碰一个新文件】✗ 不重启服务 ✗ 不影响在线玩家 ✓
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))

HOST = '43.138.171.250'
USER = 'ubuntu'
REMOTE = '/opt/xiuxian2d'


def get_pw():
    p = os.path.expanduser('~/.xiuxian_deploy')
    with open(p, encoding='utf-8') as f:
        raw = f.read()
    # 文件里可能只有一行密码 ✗ 也可能写成 PASS=xxx ✓ 两种都认 ✓
    for ln in raw.splitlines():
        ln = ln.strip()
        if not ln or ln.startswith('#'):
            continue
        if ln.upper().startswith('PASS'):
            return ln.split('=', 1)[1].strip()
        return ln
    raise SystemExit('  密码文件是空的：%s' % p)


def main():
    import paramiko
    pw = get_pw()
    cli = paramiko.SSHClient()
    cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    cli.connect(HOST, username=USER, password=pw, timeout=20)

    def run(cmd, t=120):
        _i, o, e = cli.exec_command(cmd, timeout=t)
        out = o.read().decode('utf-8', 'ignore').strip()
        err = e.read().decode('utf-8', 'ignore').strip()
        return out + (('\n[err] ' + err) if err else '')

    print('  ① 云端现在的情况')
    print('     ' + run('cd %s && ls -la server/*.py | wc -l && echo "---" && '
                        'ls -la server/backups 2>/dev/null | tail -3 || echo "(还没有 backups 目录)"' % REMOTE).replace('\n', '\n     '))
    print('     DB: ' + run('ls -la %s/server/game.db* 2>/dev/null | head -4' % REMOTE).replace('\n', '\n         '))

    print()
    print('  ② 上传 backup_db.py（只这一个文件 ✓ 不重启服务 ✓）')
    sftp = cli.open_sftp()
    local = os.path.join(ROOT, 'server', 'backup_db.py')
    sftp.put(local, '/tmp/backup_db.py')
    sftp.close()
    print('     ' + run('sudo cp -f /tmp/backup_db.py %s/server/backup_db.py && '
                        'sudo chown xiuxian:xiuxian %s/server/backup_db.py && ls -la %s/server/backup_db.py'
                        % (REMOTE, REMOTE, REMOTE)))

    print()
    print('  ③ 跑一次在线备份')
    print('     ' + run('cd %s/server && sudo -u xiuxian /usr/bin/python3 backup_db.py' % REMOTE).replace('\n', '\n     '))

    print()
    print('  ④ 核对备份文件（列表 + 用 Python 打开数一下账号/角色）')
    print('     ' + run('ls -la %s/server/backups/ 2>/dev/null | tail -4' % REMOTE).replace('\n', '\n     '))
    chk = run('''cd %s/server && sudo -u xiuxian /usr/bin/python3 -c "
import sqlite3, glob
f = sorted(glob.glob('backups/game-*.db'))[-1]
c = sqlite3.connect('file:' + f + '?mode=ro', uri=True)
print('file=' + f)
print('accounts=' + str(c.execute('SELECT COUNT(*) FROM accounts').fetchone()[0]))
print('roles=' + str(c.execute('SELECT COUNT(*) FROM roles').fetchone()[0]))
print('items=' + str(c.execute('SELECT COUNT(*) FROM items').fetchone()[0]))
c.close()"''' % REMOTE)
    print('     ' + chk.replace('\n', '\n     '))

    print()
    print('  ⑤ 也数一下【线上真库】做对比')
    live = run('''cd %s/server && sudo -u xiuxian /usr/bin/python3 -c "
import sqlite3
c = sqlite3.connect('file:game.db?mode=ro', uri=True)
print('live accounts=' + str(c.execute('SELECT COUNT(*) FROM accounts').fetchone()[0]))
print('live roles=' + str(c.execute('SELECT COUNT(*) FROM roles').fetchone()[0]))
print('live items=' + str(c.execute('SELECT COUNT(*) FROM items').fetchone()[0]))
c.close()"''' % REMOTE)
    print('     ' + live.replace('\n', '\n     '))

    print()
    ok_b = 'accounts=' in chk and 'roles=' in chk
    same = True
    try:
        import re
        b = dict(re.findall(r'(\w+)=(\d+)', chk))
        l = dict(re.findall(r'live (\w+)=(\d+)', live))
        same = (b.get('accounts') == l.get('accounts') and b.get('roles') == l.get('roles')
                and b.get('items') == l.get('items'))
    except Exception:
        same = False
    print('  ★ 结论：备份%s · 和真库%s' % ('已生成 ✓' if ok_b else '失败 ✗',
                                        '完全一致 ✓✓' if same else '数量不一致 ✗（要看清楚再继续）'))
    cli.close()
    return 0 if (ok_b and same) else 1


if __name__ == '__main__':
    sys.exit(main())
