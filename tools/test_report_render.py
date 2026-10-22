# -*- coding: utf-8 -*-
"""战报渲染 · 本地试画（假数据）→ docs/shots/report-pillow.png"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'server'))
import battlereport  # noqa: E402

DATA = {
    't0txt': '2026-10-19 05:30', 't1txt': '05:45',
    'players': [
        {'name': '半个六道', 'exp': 48250, 'gold': 8400, 'kills': 312,
         'gear': [{'look': 'sword', 'tier': 7, 'n': 1}, {'look': 'armor', 'tier': 6, 'n': 2},
                  {'look': 'bow', 'tier': 5, 'n': 1}, {'look': 'saber', 'tier': 4, 'n': 3},
                  {'look': 'spear', 'tier': 3, 'n': 2}], 'gearTotal': 11},
        {'name': '林小满', 'exp': 39120, 'gold': 12600, 'kills': 268,
         'gear': [{'look': 'axe', 'tier': 6, 'n': 1}, {'look': 'armor', 'tier': 5, 'n': 1},
                  {'look': 'dagger', 'tier': 5, 'n': 2}, {'look': 'staff', 'tier': 2, 'n': 4}],
         'gearTotal': 8},
        {'name': '阿飞', 'exp': 31500, 'gold': 5300, 'kills': 214,
         'gear': [{'look': 'saber', 'tier': 5, 'n': 2}, {'look': 'hammer', 'tier': 4, 'n': 1},
                  {'look': 'armor', 'tier': 3, 'n': 1}], 'gearTotal': 4},
        {'name': '夜行', 'exp': 27880, 'gold': 9200, 'kills': 196,
         'gear': [{'look': 'bow', 'tier': 4, 'n': 1}, {'look': 'armor', 'tier': 4, 'n': 1},
                  {'look': 'sword', 'tier': 2, 'n': 5}], 'gearTotal': 7},
        {'name': '钱五', 'exp': 21400, 'gold': 4100, 'kills': 151,
         'gear': [{'look': 'spear', 'tier': 3, 'n': 2}, {'look': 'armor', 'tier': 2, 'n': 3}],
         'gearTotal': 5},
        {'name': '徒手拆高达', 'exp': 18900, 'gold': 3200, 'kills': 120, 'gear': [], 'gearTotal': 4},
        {'name': '老张', 'exp': 15600, 'gold': 2100, 'kills': 98, 'gear': [], 'gearTotal': 3},
        {'name': '小狐', 'exp': 14300, 'gold': 6800, 'kills': 90, 'gear': [], 'gearTotal': 2},
        {'name': '南山客', 'exp': 12800, 'gold': 1500, 'kills': 77, 'gear': [], 'gearTotal': 5},
        {'name': '一刀两断', 'exp': 11200, 'gold': 900, 'kills': 66, 'gear': [], 'gearTotal': 1},
        {'name': '阿七', 'exp': 9800, 'gold': 2600, 'kills': 55, 'gear': [], 'gearTotal': 3},
        {'name': '铁蛋', 'exp': 7600, 'gold': 1200, 'kills': 44, 'gear': [], 'gearTotal': 2},
    ],
}

out = os.path.join(ROOT, 'docs', 'shots', 'report-pillow.png')
path, w, h = battlereport.render(DATA, out)
print('ok', path, w, 'x', h)
