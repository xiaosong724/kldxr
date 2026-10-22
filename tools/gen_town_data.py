# -*- coding: utf-8 -*-
"""把 server/town.py 的唯一数据源导出成客户端脚本 web/core/town_data.js

用法：python tools/gen_town_data.py
每次改完服务端布局都要跑一次（否则客户端画面/碰撞还是旧数据）。
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'server'))

import town  # noqa: E402
import shops  # noqa: E402

OUT = os.path.join(ROOT, 'web', 'core', 'town_data.js')


def main():
    data = town.export_data()
    data['shops'] = shops.shop_list()
    data['npcs'] = shops.npc_list()
    body = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    src = (
        '/* 自动生成，请勿手改！\n'
        '   数据源：server/town.py\n'
        '   重新生成：python tools/gen_town_data.py\n'
        '   客户端/服务端共用这一份 → 碰撞箱和椅子不会对不上。 */\n'
        'var TOWN_DATA = ' + body + ';\n'
    )
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(src)
    print('wrote %s (%d bytes)  buildings=%d props=%d seats=%d solids=%d' % (
        OUT, len(src.encode('utf-8')), len(data['buildings']),
        len(data['props']), len(data['seats']), len(data['solids'])))


if __name__ == '__main__':
    main()
