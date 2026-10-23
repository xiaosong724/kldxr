# -*- coding: utf-8 -*-
"""编译并发布 APK（本地服 / 云端服 分开）。

用法：
    python tools/release_apk.py local          # 本地服 → 修仙-本地服.apk + web/apk/app.apk
    python tools/release_apk.py cloud          # 云端服 → 修仙-云端服.apk（并上传到云端）
    python tools/release_apk.py both           # 两个都编（都不上传）

    # 想改版本号（会同时改 build.gradle ✗ 保证 APK 和服务端 version.txt 一致）：
    python tools/release_apk.py local 3 "0.1.2"

★ 两个 flavor 的区别（在 android/app/build.gradle 里定义）：
    local → 包名 com.xiuxian.game         名字「修仙·本地服」  连 192.168.31.180
    cloud → 包名 com.xiuxian.game.cloud   名字「修仙·云端服」  连 43.138.171.250
  ★ 包名不同 ✗ 两个版本可以【同时装在一台手机上】✓ 不会互相覆盖 ✓

★ 自动更新怎么用：
    服务器上的 web/apk/app.apk + web/apk/version.txt = 玩家会自动下载的那个
    → 本地服发布时覆盖 web/apk/  ✓
    → 云端服用 tools/deploy_cloud_today.py 一起传上去 ✓
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
WEB_APK_DIR = os.path.join(ROOT, 'web', 'apk')

FLAVORS = {
    'local': {
        'task': 'assembleLocalDebug',
        'out': os.path.join(ANDROID, 'app', 'build', 'outputs', 'apk', 'local', 'debug', 'app-local-debug.apk'),
        'name': '修仙-本地服.apk',
        'label': '修仙·本地服',
        'url': 'http://192.168.31.180:8899/',
    },
    'cloud': {
        'task': 'assembleCloudDebug',
        'out': os.path.join(ANDROID, 'app', 'build', 'outputs', 'apk', 'cloud', 'debug', 'app-cloud-debug.apk'),
        'name': '修仙-云端服.apk',
        'label': '修仙·云端服',
        'url': 'http://43.138.171.250:8899/',
    },
}

JDK_CANDIDATES = [
    r'C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot',
    r'C:\Program Files\Eclipse Adoptium\jdk-17.0.13.11-hotspot',
]


def read_version():
    src = io.open(GRADLE, encoding='utf-8').read()
    m1 = re.search(r'versionCode\s+(\d+)', src)
    m2 = re.search(r'versionName\s+"([^"]*)"', src)
    return (int(m1.group(1)) if m1 else 0, m2.group(1) if m2 else '')


def bump_version(code, name):
    src = io.open(GRADLE, encoding='utf-8').read()
    src = re.sub(r'versionCode\s+\d+', 'versionCode %d' % code, src, count=1)
    src = re.sub(r'versionName\s+"[^"]*"', 'versionName "%s"' % name, src, count=1)
    io.open(GRADLE, 'w', encoding='utf-8', newline='\n').write(src)


def pick_jdk():
    for p in JDK_CANDIDATES:
        if os.path.isdir(p):
            return p
    return os.environ.get('JAVA_HOME', '')


def build(flavor):
    f = FLAVORS[flavor]
    jdk = pick_jdk()
    if jdk:
        os.environ['JAVA_HOME'] = jdk
    print('  编译 %s（%s）…' % (flavor, f['label']))
    r = subprocess.run([os.path.join(ANDROID, 'gradlew.bat'), f['task'], '--console=plain', '-q'],
                       cwd=ANDROID, capture_output=True, text=True, encoding='utf-8', errors='ignore')
    if r.returncode != 0:
        print('  ✗ 编译失败：')
        print((r.stdout or '')[-1200:])
        print((r.stderr or '')[-1200:])
        return None
    if not os.path.isfile(f['out']):
        print('  ✗ 没有产物：%s' % f['out'])
        return None
    dst = os.path.join(ROOT, f['name'])
    shutil.copy2(f['out'], dst)
    size = os.path.getsize(dst)
    print('  ✓ %s  %.2f MB' % (f['name'], size / 1048576.0))
    print('     包名 / 名字 : %s' % f['label'])
    print('     连接地址    : %s' % f['url'])
    return dst


def publish_to_web(apk_path, code, name):
    """把 APK 放到服务器的下载源（web/apk/）"""
    os.makedirs(WEB_APK_DIR, exist_ok=True)
    shutil.copy2(apk_path, os.path.join(WEB_APK_DIR, 'app.apk'))
    io.open(os.path.join(WEB_APK_DIR, 'version.txt'), 'w', encoding='utf-8', newline='\n').write(
        'versionCode=%d\nversionName=%s\n' % (code, name))
    print('  ✓ 已放到 web/apk/（自动更新的下载源）')


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ('local', 'cloud', 'both'):
        print(__doc__)
        return 1
    target = sys.argv[1]

    # 版本号
    if len(sys.argv) >= 4:
        code = int(sys.argv[2])
        name = sys.argv[3]
        bump_version(code, name)
        print('版本号改为 %d（%s）' % (code, name))
    else:
        code, name = read_version()
        print('版本号：%d（%s）' % (code, name))
    if not code:
        print('✗ 读不到 versionCode')
        return 1

    print()
    todo = ['local', 'cloud'] if target == 'both' else [target]
    built = {}
    for fv in todo:
        p = build(fv)
        if p:
            built[fv] = p

    if 'local' in built:
        print()
        print('本地服 → 覆盖自动更新源')
        publish_to_web(built['local'], code, name)

    print()
    print('=== 完成 ===')
    for fv, p in built.items():
        print('  %-10s %s' % (FLAVORS[fv]['label'], os.path.basename(p)))
    if 'cloud' in built:
        print()
        print('  ★ 云端服要上传才会生效：')
        print('     python tools/deploy_cloud_today.py')
        print('     （它会把 web/apk/ 一起传上去 ✗ 然后云端的自动更新就能用了 ✓）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
