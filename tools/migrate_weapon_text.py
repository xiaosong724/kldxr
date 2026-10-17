# -*- coding: utf-8 -*-
"""把仓库/背包里所有武器的【特性文字】按最新武器表重算一遍

★★★ 为什么需要（round380）★★★
  武器的特性 fx 是【生成物品时】写进 item_json 的 ✓
    {'fx': {'name': '招架', 'chance': ..., 'value': ..., 'text': '...'}}
  后来改了武器表（单手剑 招架 → 连刺、斧头溅射按品阶 ✓）
  → 新掉落的物品是新的 ✗ 旧物品还存着旧文字 ✓
  → 玩家看到"招架" ✗ 实际打出来是"连刺" ✓

  ★ 战斗本身早就用的是【实时表】（world.py 里 fx_of 现算 ✓）
    所以这个脚本只修【显示的文字】✗ 不改战斗 ✓

用法：
  python tools/migrate_weapon_text.py            # 只看会改多少（不动库）
  python tools/migrate_weapon_text.py --apply    # 真改
"""
import io
import json
import os
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, 'server', 'game.db')
sys.path.insert(0, os.path.join(ROOT, 'server'))

import weapons  # noqa: E402


def main():
    apply = '--apply' in sys.argv
    con = sqlite3.connect(DB, timeout=10)
    rows = con.execute('SELECT id, item_json FROM items').fetchall()
    changed = 0
    examples = []
    for iid, raw in rows:
        try:
            it = json.loads(raw)
        except Exception:
            continue
        if not isinstance(it, dict):
            continue
        look = it.get('look')
        if not look or look not in weapons.WEAPON_FX:
            continue
        try:
            tier = int(it.get('tier') or 0)
        except Exception:
            tier = 0
        try:
            fx = weapons.fx_of(look, tier)
        except Exception:
            continue
        if not fx:
            continue
        old = it.get('fx') or {}
        if old.get('name') == fx['name'] and old.get('text') == fx['text'] \
                and abs(float(old.get('chance') or 0) - float(fx['chance'])) < 1e-9:
            continue
        if len(examples) < 5:
            examples.append((iid, look, tier, old.get('name'), fx['name']))
        changed += 1
        if apply:
            it['fx'] = fx
            con.execute('UPDATE items SET item_json=? WHERE id=?',
                        (json.dumps(it, ensure_ascii=False), iid))

    print('武器物品总数: %d' % len(rows))
    print('需要更新文案: %d 件' % changed)
    for e in examples:
        print('  例：id=%s look=%s tier=%s  %s → %s' % e)
    if apply:
        con.commit()
        print('已写入 ✓')
    else:
        print('（只预览，没动库。加 --apply 才会真改）')
    con.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
