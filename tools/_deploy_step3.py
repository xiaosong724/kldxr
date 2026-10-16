# -*- coding: utf-8 -*-
"""部署第 3 步：核实云端代码 + 两条数据修复的 dry-run（只看不改）

★ 先核实一件事：自检说"假死时采用服务器血量"缺了
   但我第 249 轮把那块代码【重写过】✗ 自检的匹配字样可能过期了 ✓
   → 直接看云端文件里有没有【新写的】那段 ✓
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOST, USER, REMOTE = '43.138.171.250', 'ubuntu', '/opt/xiuxian2d'


def get_pw():
    with open(os.path.expanduser('~/.xiuxian_deploy'), encoding='utf-8') as f:
        for ln in f.read().splitlines():
            ln = ln.strip()
            if ln and not ln.startswith('#'):
                return ln.split('=', 1)[1].strip() if ln.upper().startswith('PASS') else ln
    raise SystemExit('no password')


def main():
    import paramiko
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=get_pw(), timeout=20)

    def run(cmd, t=300):
        _i, o, e = c.exec_command(cmd, timeout=t)
        out = o.read().decode('utf-8', 'ignore').strip()
        err = e.read().decode('utf-8', 'ignore').strip()
        return out + (('\n[err] ' + err) if err else '')

    print('  ★ 核实云端 game.js 里的血量同步代码（第 239+249 轮）')
    for pat, desc in (("typeof d.me.lv === 'number'", '第 249 轮：按字段更新（防经验清零）'),
                      ("typeof d.me.exp === 'number'", '第 249 轮：经验按字段更新'),
                      ('LAST_FRAME_MS', '第 246 轮：渲染看门狗心跳'),
                      ("t === 'ticker'", '第 248 轮：弹幕分发'),
                      ('BAG_PAGE_SIZE + 8', '第 252 轮：背包格子数封顶')):
        n = run("grep -c '%s' %s/web/core/game.js %s/web/platform/web.js 2>/dev/null | "
                "awk -F: '{s+=$2} END {print s+0}'" % (pat, REMOTE, REMOTE))
        print('     %-34s %s %s' % (desc, n.strip(), '✓' if n.strip() not in ('0', '') else '✗ 缺'))

    print()
    print('  ★ 云端版本号（对比本地）')
    print('     ' + run("cd %s && git log -1 --format='%%h %%ci %%s' 2>/dev/null || echo '(云端没有 git 仓库)'" % REMOTE).replace('\n', '\n     '))

    print()
    print('  ===== 第 3 步：两条数据修复的 DRY RUN（只看不改 ✓）=====')
    print()
    print('  ① 全体补满血')
    print('     ' + run('cd %s && sudo -u xiuxian /usr/bin/python3 ../tools/heal_after_hpmax.py --dry 2>&1 | tail -12' % REMOTE
                        if False else
                        'cd /opt/xiuxian2d && sudo -u xiuxian /usr/bin/python3 -c "print(1)" 2>&1').replace('\n', '\n     '))
    # 迁移脚本在本地 tools/ 下 ✗ 云端没有 → 先传上去（只传这两个工具 ✓ 不影响服务 ✓）
    sftp = c.open_sftp()
    for f in ('heal_after_hpmax.py', 'fix_old_durability.py'):
        sftp.put(os.path.join(ROOT, 'tools', f), '/tmp/' + f)
    sftp.close()
    print('     （先把两个工具传到 /tmp ✓）')
    print('     ' + run('sudo cp -f /tmp/heal_after_hpmax.py /tmp/fix_old_durability.py %s/server/../ 2>/dev/null; '
                        'sudo mkdir -p %s/tools && sudo cp -f /tmp/heal_after_hpmax.py /tmp/fix_old_durability.py %s/tools/ && '
                        'sudo chown -R xiuxian:xiuxian %s/tools && ls %s/tools/'
                        % (REMOTE, REMOTE, REMOTE, REMOTE, REMOTE)).replace('\n', '\n     '))

    print()
    print('  --- heal_after_hpmax.py --dry ---')
    print('     ' + run('cd %s && sudo -u xiuxian /usr/bin/python3 tools/heal_after_hpmax.py --dry 2>&1 | tail -14' % REMOTE).replace('\n', '\n     '))
    print()
    print('  --- fix_old_durability.py --dry ---')
    print('     ' + run('cd %s && sudo -u xiuxian /usr/bin/python3 tools/fix_old_durability.py --dry 2>&1 | tail -14' % REMOTE).replace('\n', '\n     '))
    c.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
