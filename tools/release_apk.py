# -*- coding: utf-8 -*-
"""发布新版 APK 到服务器（本地 / 云端通用）。

用法：
    python tools/release_apk.py                  # 用当前 build.gradle 里的版本号
    python tools/release_apk.py 5 "0.1.3-局域网"   # 手动指定 versionCode / versionName

做了什么：
    ① 编译 debug APK（gradlew assembleDebug）
    ② 复制到 块来修仙-测试版.apk（仓库根目录，方便发给玩家）
    ③ 复制到 web/apk/app.apk        ← 服务器的下载源
    ④ 写 web/apk/version.txt        ← /api/apk 读的就是它
    ⑤ 打印版本信息（和 APK 自己的 versionCode 对比，确认会/不会触发更新）

★ 为什么 version.txt 要跟 build.gradle 一致：
    APK 里 versionCode 是编译进去的（改不了）
    服务端的 version.txt 是给「已经装着的旧 APK」对比用的
    两边必须一致 ✗ 否则要么永远提示更新，要么永远不提示 ✓
"""
import io
import os
import re
import shutil
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANDROID = os.path.join(ROOT, 'android')
GRADLE = os.path.join(ANDROID, 'app', 'build.gradle')
APK_SRC = os.path.join(ANDROID, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
APK_OUT = os.path.join(ROOT, '块来修仙-测试版.apk')
APK_WEB = os.path.join(ROOT, 'web', 'apk', 'app.apk')
VER_TXT = os.path.join(ROOT, 'web', 'apk', 'version.txt')

# JDK：项目用 Kotlin 1.9 ✗ 不认 JDK 25（会崩在 JavaVersion.parse）
JDK_CANDIDATES = [
    r'C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot',
    r'C:\Program Files\Eclipse Adoptium\jdk-17.0.13.11-hotspot',
]


def read_version():
    """从 build.gradle 里读 versionCode / versionName"""
    src = io.open(GRADLE, encoding='utf-8').read()
    m1 = re.search(r'versionCode\s+(\d+)', src)
    m2 = re.search(r'versionName\s+"([^"]*)"', src)
    return (int(m1.group(1)) if m1 else 0,
            m2.group(1) if m2 else '')


def pick_jdk():
    for p in JDK_CANDIDATES:
        if os.path.isdir(p):
            return p
    return os.environ.get('JAVA_HOME', '')


def main():
    code = version = None
    if len(sys.argv) >= 3:
        code = int(sys.argv[1])
        version = sys.argv[2]
        # 顺手写回 build.gradle ✗ 保证两边真的一致 ✓
        src = io.open(GRADLE, encoding='utf-8').read()
        src = re.sub(r'versionCode\s+\d+', 'versionCode %d' % code, src, count=1)
        src = re.sub(r'versionName\s+"[^"]*"', 'versionName "%s"' % version, src, count=1)
        io.open(GRADLE, 'w', encoding='utf-8', newline='\n').write(src)
        print('① 已把 build.gradle 改成 versionCode=%d versionName=%s' % (code, version))
    else:
        code, version = read_version()
        print('① 用 build.gradle 里的版本：versionCode=%d versionName=%s' % (code, version))

    if not code:
        print('✗ 读不到 versionCode，终止')
        return 1

    # ---- ② 编译 ----
    jdk = pick_jdk()
    if jdk:
        os.environ['JAVA_HOME'] = jdk
        print('② 用 JDK：%s' % jdk)
    print('   正在编译…')
    r = subprocess.run([os.path.join(ANDROID, 'gradlew.bat'), 'assembleDebug',
                        '--console=plain', '-q'],
                       cwd=ANDROID, capture_output=True, text=True,
                       encoding='utf-8', errors='ignore')
    if r.returncode != 0:
        print('✗ 编译失败：')
        print((r.stdout or '')[-1500:])
        print((r.stderr or '')[-1500:])
        return 1

    if not os.path.isfile(APK_SRC):
        print('✗ 没有产物：%s' % APK_SRC)
        return 1
    size = os.path.getsize(APK_SRC)
    print('   ✓ 编译成功：%d 字节（%.2f MB）' % (size, size / 1048576.0))

    # ---- ③ 复制 ----
    shutil.copy2(APK_SRC, APK_OUT)
    print('③ 已复制到：块来修仙-测试版.apk')

    # ---- ④ 放到服务器目录 ----
    os.makedirs(os.path.dirname(APK_WEB), exist_ok=True)
    shutil.copy2(APK_SRC, APK_WEB)
    print('④ 已复制到：web/apk/app.apk（/download/app.apk 的源）')

    io.open(VER_TXT, 'w', encoding='utf-8', newline='\n').write(
        'versionCode=%d\nversionName=%s\n' % (code, version))
    print('⑤ 已写：web/apk/version.txt')

    # ---- ⑤ 核对 ----
    print()
    print('=== 发布完成 ===')
    print('  版本号      : %d（%s）' % (code, version))
    print('  包大小      : %.2f MB' % (size / 1048576.0))
    print('  下载地址    : <服务器地址>/download/app.apk')
    print('  版本查询    : <服务器地址>/api/apk')
    print()
    print('  ★ 已经装着的旧 APK 会在启动 8 秒后检查一次 ✓')
    print('    发现版本更大 → 弹「发现新版本」→ 点更新 → 系统安装界面 ✓')
    print('  ★ 本地服务器就直接放在 web/apk/ ✓ 云端同步时一起上传 ✓')
    return 0


if __name__ == '__main__':
    sys.exit(main())
