# -*- coding: utf-8 -*-
"""给老装备补齐耐久字段（第 237 轮）

★ 为什么需要：
  装备耐久是第 103 轮才加的 ✓
  在那之前生成的武器/防具，item_json 里 durMax 是 0 或干脆没有这个键 ✗
  → 客户端判断"有没有耐久条"的条件是 durMax > 0 ✗
  → 这些老装备永远显示不出耐久条 ✓
  → 用户："防具的穿戴格子怎么还是没有显示耐久的进度条"✓✓ 就是这个 ✓

★ 做法：
  遍历 items 里所有武器/防具 ✓
  durMax 不是正数的 → 按品阶算出来填上 ✓（dur = durMax 满耐久 ✓）
  ★ 只补【缺失/为 0】的 ✗ 不动已经有正常耐久的 ✓（不然会把用过的装备偷偷回满 ✓）

用法：
    python tools\\fix_old_durability.py --dry     # 只看会改哪些（不改）
    python tools\\fix_old_durability.py           # 真改（会先自动备份）
"""
import argparse
import json
import os
import sqlite3
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, 'server'))

import armor as armormod          # noqa: E402
import weapons as weaponmod       # noqa: E402


def db_path():
    with open(os.path.join(ROOT, 'server', 'config.json'), encoding='utf-8') as f:
        import json as _j
        cfg = _j.load(f)
    return os.path.normpath(str(cfg.get('db') or '${HERE}/game.db').replace('${HERE}', os.path.join(ROOT, 'server')))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry', action='store_true')
    a = ap.parse_args()
    p = db_path()
    print('  存档：%s' % p)

    # ★ 先备份（用现成的在线备份脚本 ✓ 出事了能退回去 ✓）
    if not a.dry:
        import subprocess
        r = subprocess.run([sys.executable, os.path.join(ROOT, 'server', 'backup_db.py')],
                           cwd=os.path.join(ROOT, 'server'), capture_output=True, text=True,
                           encoding='utf-8', errors='ignore')
        print('  备份：' + (r.stdout or '').strip().split('\n')[0][:90])
        if r.returncode != 0:
            print('  ✗ 备份失败 ✗ 中止（宁可不动存档 ✓）')
            return 1

    c = sqlite3.connect(p)
    rows = c.execute("SELECT id, role_id, item_json FROM items").fetchall()
    fixed = 0
    skipped = 0
    for iid, rid, js in rows:
        try:
            it = json.loads(js)
        except Exception:
            continue
        if not isinstance(it, dict):
            continue
        slot = it.get('slot')
        if slot not in ('weapon', 'armor'):
            continue
        dm = it.get('durMax')
        if isinstance(dm, (int, float)) and dm > 0:
            skipped += 1
            continue
        t = int(it.get('tier') or 0)
        try:
            newmax = int(armormod.dur_max_of(t) if slot == 'armor' else weaponmod.dur_max_of(t))
        except Exception as e:
            print('     id=%s 算不出耐久（tier=%s）：%r' % (iid, t, e))
            continue
        if newmax <= 0:
            continue
        it['durMax'] = newmax
        it['dur'] = newmax          # ★ 补的时候给满耐久（它本来就没用过 ✓）
        if a.dry:
            print('     [只看] id=%s %s tier=%s → durMax %s' % (iid, it.get('name'), t, newmax))
        else:
            c.execute('UPDATE items SET item_json=? WHERE id=?',
                      (json.dumps(it, ensure_ascii=False), iid))
        fixed += 1
    if not a.dry:
        c.commit()
    c.close()
    print()
    print('  %s：补齐 %d 件 · 跳过（本来就有耐久）%d 件'
          % ('【只看，没改】' if a.dry else '★ 已改', fixed, skipped))
    return 0


if __name__ == '__main__':
    sys.exit(main())
