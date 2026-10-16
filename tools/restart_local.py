# -*- coding: utf-8 -*-
"""★ 可靠地重启本地服务器（第 216 轮做出来的工具）

为什么需要它（第 215 轮的血泪）：
    我用 pkill -f "python app.py" 杀进程
    → 在 Windows / Git-Bash 上【杀不掉】✗
    → 旧服务器一直活着占着 8899 / 8900
    → 我起的新服务器其实没起来（日志里明明写着端口占用 ✗ 我没看）
    → 于是后面所有测试打到的都是【旧代码】✓✓
    → "改了没生效""数据库里没有""接口 ok 但值没变" 全是这个原因 ✓
    → 白折腾一整轮 ✓

所以这个工具做四步，每步都【验证】，不看"应该没问题"：
    ① 按【端口】找出占用进程并杀掉（不靠进程名 ✗）
    ② 确认真的死了（连不上才算死 ✓）
    ③ 起服务器，等它就绪
    ④ 确认起来的是【新代码】（看日志 + 看健康接口），不是旧进程

用法：
    python tools/restart_local.py            # 重启并验证
    python tools/restart_local.py --mark 216 # 顺便检查第 216 轮的代码标志
"""
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, 'server')
LOG = os.path.join(os.environ.get('TEMP', '/tmp'), 'local_server.log')
PORTS = (8899, 8900)
BASE = 'http://127.0.0.1:8899'


def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True,
                          errors='ignore').stdout or ''


def kill_by_port():
    """★ 按端口杀 ✗ 不按进程名（名字匹配在 Windows 上不可靠）"""
    ps = ('Get-NetTCPConnection -LocalPort %s -State Listen -ErrorAction SilentlyContinue | '
          'Select-Object -ExpandProperty OwningProcess -Unique | '
          'ForEach-Object { taskkill /PID $_ /T /F }') % ','.join(str(p) for p in PORTS)
    out = sh('powershell -Command "%s"' % ps)
    return out


def port_alive(port, timeout=2):
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect(('127.0.0.1', port))
        return True
    except Exception:
        return False
    finally:
        s.close()


def health(timeout=4):
    try:
        with urllib.request.urlopen(BASE + '/api/health', timeout=timeout) as f:
            return f.read().decode('utf-8', 'ignore')
    except Exception:
        return ''


def main():
    print('== ① 按端口杀进程 ==')
    out = kill_by_port().strip()
    for ln in out.split('\n')[:4]:
        if ln.strip():
            print('   ' + ln.strip()[:90])
    if not out.strip():
        print('   （本来就没有在听的进程）')

    print('== ② 确认真的死了 ==')
    ok = False
    for i in range(10):
        time.sleep(0.6)
        a8899, a8900 = port_alive(8899), port_alive(8900)
        if not a8899 and not a8900:
            print('   8899 连不上 ✓  8900 连不上 ✓（死了）')
            ok = True
            break
        print('   还在：8899=%s 8900=%s' % (a8899, a8900))
    if not ok:
        print('   ✗ 杀不干净，先别往下走')
        return 1

    print('== ③ 起服务器 ==')
    if os.path.exists(LOG):
        os.remove(LOG)
    subprocess.Popen('python app.py > "%s" 2>&1' % LOG, cwd=SERVER, shell=True)
    ready = False
    for i in range(30):
        time.sleep(1)
        h = health()
        if '"online"' in h:
            print('   起来了 ✓ health: %s' % h[:80])
            ready = True
            break
    if not ready:
        print('   ✗ 起不来，看日志：')
        if os.path.exists(LOG):
            with open(LOG, encoding='utf-8', errors='ignore') as f:
                for ln in f.read().split('\n')[-12:]:
                    print('     ' + ln[:110])
        return 1

    print('== ④ 确认是新代码（不是旧进程残留）==')
    problems = []
    if not port_alive(8900):
        problems.append('8900 没在听（游戏通道没起来 ✗）')
    log = ''
    if os.path.exists(LOG):
        with open(LOG, encoding='utf-8', errors='ignore') as f:
            log = f.read()
    for bad in ('Address already in use', '起不来', 'Traceback'):
        if bad in log:
            problems.append('日志里有异常：%s' % bad)
    # 让调用方传一个"这一轮新加的标志字符串"来确认
    marks = [a for a in sys.argv[2:]]
    for mk in marks:
        if mk not in log:
            problems.append('日志里没看到新代码标志 %r（可能还是旧进程 ✗）' % mk)

    if problems:
        print('   ✗ 有问题：')
        for p in problems:
            print('     - ' + p)
        return 1
    print('   ✓ 一切正常（端口都在听 · 日志没异常%s）'
          % (' · 新代码标志都在' if marks else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
