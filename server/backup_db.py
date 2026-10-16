# -*- coding: utf-8 -*-
"""在线备份游戏存档（第 229 轮）

★★ 为什么不能直接 cp game.db ★★
    db.py 第 207 行设了 PRAGMA journal_mode=WAL
    → WAL 模式下【已提交的数据可能还在 game.db-wal 里】
    → 直接 cp 出来的可能是不一致的副本
      （看着像个好文件 ✓ 恢复的时候才发现坏 ✗ 那时候已经晚了）
    → 正确做法是用 SQLite 的【在线备份 API】：Connection.backup()
      它会在复制的同时把 WAL 里的内容一起算进去 ✓
      而且【服务器正在写的时候也能安全备份】✓

用法：
    python backup_db.py              # 备份一次，保留最近 7 份
    python backup_db.py --keep 14    # 保留 14 份
    python backup_db.py --list       # 只看现有备份

云上定时（crontab）：每天 4:00 跑一次
    0 4 * * * cd /opt/xiuxian2d/server && /usr/bin/python3 backup_db.py >> /opt/xiuxian2d/backup.log 2>&1
"""
import argparse
import os
import sqlite3
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
BACKUP_DIR = os.path.join(HERE, 'backups')


def db_path():
    """从 config.json 里取数据库路径（${HERE} 替换成本目录 ✓ 和 app.py 一个口径）"""
    import json
    cfg_file = os.path.join(HERE, 'config.json')
    with open(cfg_file, encoding='utf-8') as f:
        cfg = json.load(f)
    p = str(cfg.get('db') or '${HERE}/game.db')
    return os.path.normpath(p.replace('${HERE}', HERE))


def do_backup(keep=7):
    src = db_path()
    if not os.path.exists(src):
        print('[备份] 找不到存档：%s' % src)
        return 1
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = time.strftime('%Y%m%d-%H%M%S')
    dst = os.path.join(BACKUP_DIR, 'game-%s.db' % stamp)

    t0 = time.time()
    # ★★ 在线备份：源连接只读打开，目标写新文件 ✓
    #    服务器同时在写也没关系（SQLite 自己保证一致 ✓）
    src_conn = sqlite3.connect('file:%s?mode=ro' % src.replace('\\', '/'), uri=True, timeout=15)
    dst_conn = sqlite3.connect(dst)
    try:
        with dst_conn:
            src_conn.backup(dst_conn)          # ★ 关键就这一句 ✓
    finally:
        dst_conn.close()
        src_conn.close()

    # 校验：打开备份文件，数一下账号/角色（★ 不校验的备份等于没有备份 ✓）
    try:
        c = sqlite3.connect('file:%s?mode=ro' % dst.replace('\\', '/'), uri=True)
        acc = c.execute('SELECT COUNT(*) FROM accounts').fetchone()[0]
        rol = c.execute('SELECT COUNT(*) FROM roles').fetchone()[0]
        c.close()
    except Exception as e:
        print('[备份] ✗ 备份文件打不开（这次不算成功）：%r' % (e,))
        return 1

    # ★ 备份文件自己会带出 -wal / -shm 边车文件 ✗ 数据已经全在主文件里了 ✓
    #   留着它们会让"备份目录"看起来乱 ✗ 而且误删主文件时还会误导人 ✓
    for side in (dst + '-wal', dst + '-shm'):
        try:
            if os.path.exists(side):
                os.remove(side)
        except Exception:
            pass

    size_kb = os.path.getsize(dst) / 1024.0
    print('[备份] ✓ %s（%.0f KB · %d 账号 · %d 角色 · 用时 %.2f 秒）'
          % (os.path.basename(dst), size_kb, acc, rol, time.time() - t0))

    # 清理旧的（只留 keep 份 ✓）
    files = sorted(f for f in os.listdir(BACKUP_DIR)
                   if f.startswith('game-') and f.endswith('.db')
                   and not f.endswith('-wal') and not f.endswith('-shm'))
    for f in files[:-keep] if keep > 0 else []:
        try:
            os.remove(os.path.join(BACKUP_DIR, f))
            print('[备份] 清理旧备份 %s' % f)
        except Exception:
            pass
    print('[备份] 现在有 %d 份备份' % min(len(files), keep))
    return 0


def do_list():
    if not os.path.isdir(BACKUP_DIR):
        print('（还没有备份）')
        return 0
    files = sorted(f for f in os.listdir(BACKUP_DIR)
                   if f.startswith('game-') and f.endswith('.db')
                   and not f.endswith('-wal') and not f.endswith('-shm'))
    for f in files:
        p = os.path.join(BACKUP_DIR, f)
        print('  %s  %.0f KB  %s' % (f, os.path.getsize(p) / 1024.0,
                                     time.strftime('%Y-%m-%d %H:%M:%S',
                                                   time.localtime(os.path.getmtime(p)))))
    print('  共 %d 份' % len(files))
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--keep', type=int, default=7)
    ap.add_argument('--list', action='store_true')
    a = ap.parse_args()
    if a.list:
        return do_list()
    return do_backup(a.keep)


if __name__ == '__main__':
    sys.exit(main())
