# -*- coding: utf-8 -*-
"""本地 vs 云端 全量文件比对（md5）

★ 为什么必须做：这次部署发现 deploy_cloud.py 的文件清单【只有 3 个 .py】
  → 说明"以为同步了"和"真的同步了"是两回事 ✓
  → 所以现在【全量核对】：server/*.py + web/** 所有文件
"""
import hashlib
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


def md5(p):
    return hashlib.md5(open(p, 'rb').read()).hexdigest()


def main():
    import paramiko
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=get_pw(), timeout=20)

    def run(cmd, t=120):
        _i, o, e = c.exec_command(cmd, timeout=t)
        return o.read().decode('utf-8', 'ignore').strip()

    # 云端所有相关文件的 md5
    remote = {}
    out = run("cd %s && find server web -type f \\( -name '*.py' -o -name '*.js' -o -name '*.html' -o -name '*.css' \\) "
              "-not -path '*/backups/*' -not -name 'config.json' -exec md5sum {} \\; 2>/dev/null" % REMOTE)
    for ln in out.splitlines():
        parts = ln.split()
        if len(parts) >= 2:
            remote[parts[1].lstrip('*')] = parts[0]

    # 本地对应文件
    local = {}
    for sub in ('server', 'web'):
        base = os.path.join(ROOT, sub)
        for dirpath, _d, files in os.walk(base):
            for fn in files:
                if fn == 'config.json':
                    continue
                if not fn.endswith(('.py', '.js', '.html', '.css')):
                    continue
                full = os.path.join(dirpath, fn)
                rel = os.path.relpath(full, ROOT).replace('\\', '/')
                local[rel] = md5(full)

    print('  本地 %d 个文件 · 云端 %d 个文件' % (len(local), len(remote)))
    print()
    same, diff, missing, extra = [], [], [], []
    for rel, h in sorted(local.items()):
        if rel not in remote:
            missing.append(rel)
        elif remote[rel] == h:
            same.append(rel)
        else:
            diff.append(rel)
    for rel in sorted(remote):
        if rel not in local:
            extra.append(rel)

    print('  ✅ 一致（已同步）: %d 个' % len(same))
    if diff:
        print()
        print('  ❌★ 内容不同（本地改了但没传上去）: %d 个' % len(diff))
        for r in diff:
            print('       %s' % r)
    if missing:
        print()
        print('  ⚠️ 云端没有（本地新加的文件）: %d 个' % len(missing))
        for r in missing:
            print('       %s' % r)
    if extra:
        print()
        print('  ℹ️ 云端多出来的（本地没有，可能是云端独有）: %d 个' % len(extra))
        for r in extra[:10]:
            print('       %s' % r)
    if not diff and not missing:
        print()
        print('  ★★★ 完全同步 ✓✓ 没有任何遗漏')
    c.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
