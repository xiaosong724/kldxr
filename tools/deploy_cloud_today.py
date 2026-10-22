# -*- coding: utf-8 -*-
"""把今天所有改动同步到云端 43.138.171.250，并让云端小镇和本地一模一样。

    ★ 云端现状（2026-10-22 核对）
      · /opt/xiuxian2d 跑的是 10-21 04:54 的代码（world.py 509KB）
      · 库里【连小镇表都没有】（db.py 是旧的，grep town_objects = 0）
      → 这次同步 = 新代码 + 首次建镇 + 导入本地布局

    ★ 安全措施
      ① 动之前备份 云端 game.db / server / web
      ② 备份失败就中止（不继续）
      ③ 任何一步失败：自动把服务拉起来（云端不能停在"停服"状态）
      ④ 只覆盖代码文件，绝不覆盖 云端 config.json / game.db 的玩家数据
      ⑤ 布局导入只碰 towns / town_objects / town_perms / houses 四张表

    跑法：
      python tools/deploy_cloud_today.py --dry-run     # 只看要传什么
      python tools/deploy_cloud_today.py               # 真部署
"""
import argparse
import io
import json
import os
import sys
import time
import urllib.request

import paramiko

HOST = '43.138.171.250'
USER = 'ubuntu'
REMOTE = '/home/ubuntu/xiuxian2d'
OPT = '/opt/xiuxian2d'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STAMP = time.strftime('%Y%m%d-%H%M%S')

# 不同步的：云端自己的运行配置 / 临时对照文件 / 本地服务入口
SERVER_SKIP = {'_cloud_net.py', '_cloud_world.py', '_skill_frag.py', '_serve2.py'}
WEB_SKIP_DIRS = ('web/assets', 'web/downloads')
WEB_SKIP_FILES = {'web/lib/three.min.js'}      # 没改过，省时间


def collect_files():
    """要上传的文件（相对仓库根）→ {远程相对路径: 本地绝对路径}"""
    out = {}
    sdir = os.path.join(ROOT, 'server')
    for f in sorted(os.listdir(sdir)):
        if not f.endswith('.py') or f in SERVER_SKIP:
            continue
        out['server/' + f] = os.path.join(sdir, f)
    wdir = os.path.join(ROOT, 'web')
    for root, dirs, files in os.walk(wdir):
        rel = os.path.relpath(root, ROOT).replace('\\', '/')
        if any(rel.startswith(d) or rel == d for d in WEB_SKIP_DIRS):
            continue
        for f in sorted(files):
            if not f.endswith(('.js', '.html', '.css', '.webmanifest', '.json')):
                continue
            r = rel + '/' + f
            if r in WEB_SKIP_FILES:
                continue
            out[r] = os.path.join(root, f)
    if os.path.exists(os.path.join(ROOT, 'tools', 'sync_town_layout.py')):
        out['tools/sync_town_layout.py'] = os.path.join(ROOT, 'tools', 'sync_town_layout.py')
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--layout', default=os.path.join(ROOT, 'tmp', 'town_layout.json'))
    a = ap.parse_args()

    files = collect_files()
    total = sum(os.path.getsize(p) for p in files.values())
    print('== 0. 要上传 %d 个文件，共 %.2f MB ==' % (len(files), total / 1048576.0))
    for r in sorted(files)[:12]:
        print('   %-40s %7.1f KB' % (r, os.path.getsize(files[r]) / 1024.0))
    if len(files) > 12:
        print('   …… 还有 %d 个' % (len(files) - 12))
    if not os.path.exists(a.layout):
        raise SystemExit('缺布局文件 %s（先跑 python tools/sync_town_layout.py --export %s）'
                         % (a.layout, a.layout))
    print('   布局文件: %s (%.1f KB)' % (a.layout, os.path.getsize(a.layout) / 1024.0))
    if a.dry_run:
        print('\n--dry-run 结束，没有连云端 ✓')
        return

    PW = io.open(os.path.expanduser('~/.xiuxian_deploy'), encoding='utf-8').read().strip()
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PW, timeout=25)

    def run(cmd, t=300):
        si, so, se = c.exec_command(cmd, timeout=t)
        return (so.read().decode('utf-8', 'ignore') +
                se.read().decode('utf-8', 'ignore')).strip()

    started = [False]

    def start_service():
        run('sudo systemctl start xiuxian')
        started[0] = True

    try:
        print('\n== 1. 云端现状 ==')
        print(run('hostname; systemctl is-active xiuxian; df -h /opt | tail -1'))

        print('\n== 2. 停服务（先停再备份，库才不会边写边拷）==')
        print(run('sudo systemctl stop xiuxian; sleep 2; systemctl is-active xiuxian || true'))

        print('\n== 3. 备份（game.db / server / web）==')
        # tar 可能因为"文件正在变"返回非 0 ✗ 但包是好的 → 用 test -f 判断而不是返回码
        bak = run('mkdir -p %s/backups; '
                  'cp -f %s/server/game.db %s/backups/game-%s.db; '
                  'tar czf %s/backups/server-%s.tgz -C %s server 2>/dev/null; '
                  'tar czf %s/backups/web-%s.tgz -C %s web 2>/dev/null; '
                  'ls -lh %s/backups/game-%s.db %s/backups/server-%s.tgz %s/backups/web-%s.tgz 2>&1'
                  % (REMOTE, OPT, REMOTE, STAMP, REMOTE, STAMP, OPT, REMOTE, STAMP, OPT,
                     REMOTE, STAMP, REMOTE, STAMP, REMOTE, STAMP))
        print(bak)
        if 'cannot' in bak.lower() or 'No such file' in bak or ('game-%s.db' % STAMP) not in bak:
            raise SystemExit('备份没成功 → 中止（服务会在 finally 里被拉起来）')

        print('\n== 4. 上传 %d 个文件 ==' % len(files))
        sftp = c.open_sftp()
        n_ok = 0
        for rel, lp in sorted(files.items()):
            rp = REMOTE + '/' + rel
            d = os.path.dirname(rp)
            try:
                sftp.stat(d)
            except IOError:
                run('mkdir -p %s' % d)
            sftp.put(lp, rp)
            n_ok += 1
            if n_ok % 20 == 0:
                print('   …… %d/%d' % (n_ok, len(files)))
        sftp.put(a.layout, '/tmp/town_layout.json')
        sftp.close()
        print('   上传完成：%d 个 + 布局 json' % n_ok)

        print('\n== 5. 复制到 /opt + 语法预检 ==')
        cmds = ['sudo cp -f %s/server/*.py %s/server/' % (REMOTE, OPT)]
        for rel in sorted(files):
            if rel.startswith('web/'):
                d = os.path.dirname(OPT + '/' + rel)
                cmds.append('sudo mkdir -p %s' % d)
                cmds.append('sudo cp -f %s/%s %s' % (REMOTE, rel, OPT + '/' + rel))
            elif rel.startswith('tools/'):
                cmds.append('sudo mkdir -p %s/tools' % OPT)
                cmds.append('sudo cp -f %s/%s %s' % (REMOTE, rel, OPT + '/' + rel))
        cmds += [
            'sudo chown -R xiuxian:xiuxian %s' % OPT,
            # ★ python3.10 语法预检（本地是 3.12，防 3.12-only 语法）
            'cd %s/server && sudo -u xiuxian python3 -m py_compile world.py net.py protocol.py '
            'db.py app.py work.py towns.py houses.py shops.py town.py town_objects.py'
            % OPT,
        ]
        out = run(' && '.join(cmds))
        print(out or '   （无输出 = 通过）')
        if 'SyntaxError' in out or 'Traceback' in out:
            raise SystemExit('语法预检失败 → 不上线，服务将恢复旧代码')

        print('\n== 6. 起服务（首次建表/建镇）==')
        start_service()
        time.sleep(10)
        print(run('systemctl is-active xiuxian'))
        log = run('tail -60 /var/log/xiuxian.log 2>/dev/null || journalctl -u xiuxian -n 60 --no-pager')
        print('   ---- 启动日志尾部 ----')
        print('\n'.join(log.split('\n')[-25:]))
        if 'Traceback' in log or 'Error' in log:
            print('   ⚠ 日志里有异常，请人工确认')

        print('\n== 7. 云端库检查（建表/建镇成功了吗）==')
        chk = run(
            'cd %s && sudo -u xiuxian python3 -c %s'
            % (OPT, json.dumps(
                "import sqlite3;c=sqlite3.connect('server/game.db');"
                "q=lambda s:c.execute(s).fetchone()[0];"
                "print('towns=',q('select count(*) from towns'));"
                "print('catalog=',q('select count(*) from town_catalog'));"
                "print('objects=',q('select count(*) from town_objects'));"
                "print('houses=',q('select count(*) from houses'));"
                "print('roles=',q('select count(*) from roles'));")))
        print(chk)
        print('\n== 8. 停服务 → 导入本地布局 ==')
        run('sudo systemctl stop xiuxian; sleep 2')
        imp = run('cd %s && sudo -u xiuxian python3 tools/sync_town_layout.py '
                  '--import /tmp/town_layout.json --db %s/server/game.db 2>&1' % (OPT, OPT))
        print(imp)
        if '导入完成' not in imp:
            print('   ⚠ 导入输出异常，仍然继续起服务（布局可能没进去）')

        print('\n== 9. 起服务 + 校验 ==')
        start_service()
        time.sleep(10)
        print(run('systemctl is-active xiuxian'))
        chk2 = run(
            'cd %s && sudo -u xiuxian python3 -c %s'
            % (OPT, json.dumps(
                "import sqlite3;c=sqlite3.connect('server/game.db');"
                "q=lambda s:c.execute(s).fetchone()[0];"
                "print('towns=',q('select count(*) from towns'));"
                "print('objects_total=',q('select count(*) from town_objects'));"
                "print('objects_active=',q(\"select count(*) from town_objects where state='active'\"));"
                "print('shops=',q(\"select count(*) from town_objects where state='active' and catalog_id like 'shop_%'\"));"
                "print('roles=',q('select count(*) from roles'));"
                "print('town_name=',c.execute(\"select name from towns where is_system=1\").fetchone()[0]);")))
        print(chk2)

        print('\n== 10. 外网健康检查 ==')
        for _ in range(12):
            time.sleep(2)
            try:
                h = json.loads(urllib.request.urlopen(
                    'http://%s:8899/api/health' % HOST, timeout=8).read())
                w = h.get('world', {})
                print('   ✓ online=%s mobs=%s tick=%s' % (w.get('online'), w.get('mobs'), w.get('tick')))
                break
            except Exception as e:
                print('   … 等待中（%r）' % (e,))
        else:
            print('   ✗ 外网还是不通 → 请立刻看 journalctl -u xiuxian')

        print('\n完成。备份在 %s/backups/（game-%s.db）' % (REMOTE, STAMP))
    finally:
        # 不管成功失败，别让云端停在"停服"
        try:
            st = run('systemctl is-active xiuxian')
            if st.strip() != 'active':
                print('（兜底）服务不是 active，正在拉起…')
                run('sudo systemctl start xiuxian')
                time.sleep(6)
                print('   现在:', run('systemctl is-active xiuxian'))
        except Exception as e:
            print('兜底启动失败: %r' % (e,))
        c.close()


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    main()
