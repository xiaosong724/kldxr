# -*- coding: utf-8 -*-
"""为 6 个建筑加布局 + 目录。"""
import io, os, sys

# ---- 布局 ----
p = 'server/town_layouts.py'
s = io.open(p, encoding='utf-8').read()
if 'shop_apartment_v1' not in s:
    add = """
LAYOUTS['shop_apartment_v1'] = {'floors': [
  {'y': 0.0, 'items': [
    {'catalog': 'bed_single', 'x': -3.7, 'z': -1.6, 'rot': 0.0},
    {'catalog': 'bed_single', 'x': -0.7, 'z': -1.6, 'rot': 0.0},
    {'catalog': 'bed_single', 'x': 2.3, 'z': -1.6, 'rot': 0.0},
    {'catalog': 'wardrobe', 'x': -2.1, 'z': -2.2, 'rot': 0.0},
    {'catalog': 'wardrobe', 'x': 0.9, 'z': -2.2, 'rot': 0.0},
    {'catalog': 'wardrobe', 'x': 3.9, 'z': -2.2, 'rot': 0.0},
    {'catalog': 'dining_table', 'x': -3.7, 'z': 0.6, 'rot': 0.0},
    {'catalog': 'dining_table', 'x': -0.7, 'z': 0.6, 'rot': 0.0},
    {'catalog': 'dining_table', 'x': 2.3, 'z': 0.6, 'rot': 0.0},
    {'catalog': 'shop_shelf', 'x': 3.0, 'z': 0.0, 'rot': 1.5708},
    {'catalog': 'ceiling_lamp', 'x': -3.0, 'z': 0.0, 'rot': 0.0},
    {'catalog': 'ceiling_lamp', 'x': 0.0, 'z': 0.0, 'rot': 0.0},
    {'catalog': 'ceiling_lamp', 'x': 3.0, 'z': 0.0, 'rot': 0.0},
  ]},
  {'y': 3.09, 'items': [
    {'catalog': 'wardrobe', 'x': -3.0, 'z': -2.0, 'rot': 0.0},
    {'catalog': 'wardrobe', 'x': 0.0, 'z': -2.0, 'rot': 0.0},
    {'catalog': 'wardrobe', 'x': 3.0, 'z': -2.0, 'rot': 0.0},
  ]},
]}

LAYOUTS['shop_inn_v1'] = {'floors': [{'y': 0.0, 'items': [
    {'catalog': 'checkout_counter', 'x': -2.4, 'z': 1.6, 'rot': 0.0},
    {'catalog': 'shop_shelf', 'x': -2.4, 'z': 0.4, 'rot': 0.0},
    {'catalog': 'dining_table', 'x': 2.0, 'z': 1.4, 'rot': 0.0},
    {'catalog': 'sofa_modern_2', 'x': 2.0, 'z': 2.5, 'rot': 3.1416},
    {'catalog': 'wardrobe', 'x': -3.6, 'z': -3.2, 'rot': 0.0},
    {'catalog': 'wardrobe', 'x': -1.2, 'z': -3.2, 'rot': 0.0},
    {'catalog': 'wardrobe', 'x': 1.2, 'z': -3.2, 'rot': 0.0},
    {'catalog': 'wardrobe', 'x': 3.6, 'z': -3.2, 'rot': 0.0},
    {'catalog': 'ceiling_lamp', 'x': -3.0, 'z': 0.0, 'rot': 0.0},
    {'catalog': 'ceiling_lamp', 'x': 0.0, 'z': 0.0, 'rot': 0.0},
    {'catalog': 'ceiling_lamp', 'x': 3.0, 'z': 0.0, 'rot': 0.0},
]}]}

LAYOUTS['shop_bathhouse_v1'] = {'floors': [{'y': 0.0, 'items': [
    {'catalog': 'bath_vanity', 'x': -1.2, 'z': -0.6, 'rot': 0.0},
    {'catalog': 'shower_tray', 'x': 2.6, 'z': -2.0, 'rot': 0.0},
    {'catalog': 'shower_tray', 'x': 2.6, 'z': -0.4, 'rot': 0.0},
    {'catalog': 'shower_tray', 'x': 2.6, 'z': 1.2, 'rot': 0.0},
    {'catalog': 'wardrobe', 'x': -1.4, 'z': 2.2, 'rot': 0.0},
    {'catalog': 'bath_vanity', 'x': 0.0, 'z': 1.4, 'rot': 0.0},
    {'catalog': 'ceiling_lamp', 'x': 0.0, 'z': 0.0, 'rot': 0.0},
]}]}

LAYOUTS['shop_tea_v1'] = {'floors': [{'y': 0.0, 'items': [
    {'catalog': 'shop_counter', 'x': 0.0, 'z': -2.3, 'rot': 0.0},
    {'catalog': 'shop_shelf', 'x': -3.0, 'z': 0.0, 'rot': 0.0},
    {'catalog': 'dining_table', 'x': -1.6, 'z': 0.9, 'rot': 0.0},
    {'catalog': 'dining_table', 'x': 1.0, 'z': 0.9, 'rot': 0.0},
    {'catalog': 'dining_table', 'x': -0.3, 'z': 2.3, 'rot': 0.0},
    {'catalog': 'chair_wood', 'x': -2.35, 'z': 0.9, 'rot': 1.5708},
    {'catalog': 'chair_wood', 'x': -0.85, 'z': 0.9, 'rot': -1.5708},
    {'catalog': 'chair_wood', 'x': 0.25, 'z': 0.9, 'rot': 1.5708},
    {'catalog': 'chair_wood', 'x': 1.75, 'z': 0.9, 'rot': -1.5708},
    {'catalog': 'chair_wood', 'x': -1.05, 'z': 2.3, 'rot': 1.5708},
    {'catalog': 'chair_wood', 'x': 0.45, 'z': 2.3, 'rot': -1.5708},
    {'catalog': 'ceiling_lamp', 'x': 0.0, 'z': 0.0, 'rot': 0.0},
]}]}

LAYOUTS['shop_dessert_v1'] = {'floors': [{'y': 0.0, 'items': [
    {'catalog': 'shop_counter', 'x': 0.0, 'z': -1.9, 'rot': 0.0},
    {'catalog': 'checkout_counter', 'x': 2.3, 'z': 1.6, 'rot': 0.0},
    {'catalog': 'dining_table', 'x': -1.5, 'z': 0.8, 'rot': 0.0},
    {'catalog': 'dining_table', 'x': 1.0, 'z': 0.8, 'rot': 0.0},
    {'catalog': 'chair_wood', 'x': -2.2, 'z': 0.8, 'rot': 1.5708},
    {'catalog': 'chair_wood', 'x': 0.3, 'z': 0.8, 'rot': 1.5708},
    {'catalog': 'ceiling_lamp', 'x': 0.0, 'z': 0.0, 'rot': 0.0},
]}]}

LAYOUTS['shop_koban_v1'] = {'floors': [{'y': 0.0, 'items': [
    {'catalog': 'checkout_counter', 'x': 0.0, 'z': -1.3, 'rot': 0.0},
    {'catalog': 'shop_shelf', 'x': -2.2, 'z': 0.6, 'rot': 0.0},
    {'catalog': 'prop_bench', 'x': 0.6, 'z': 1.6, 'rot': 3.1416},
    {'catalog': 'ceiling_lamp', 'x': 0.0, 'z': 0.0, 'rot': 0.0},
]}]}
"""
    s = s + add
    io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
    print('layouts added')

# ---- 目录 ----
p = 'server/towns.py'
s = io.open(p, encoding='utf-8').read()
if 'shop_apartment_v1' not in s:
    block = """    ('shop_apartment_v1', '公寓 v1', 'building', 9.0, 9.0, 8.6, 22000000, 'house',
     '{"tier":"apartment"}', '[[-4.5,0,-4.5,4.5,8.6,4.5]]', 'shop_apartment_v1', 'shop_apartment_v1'),
    ('shop_inn_v1', '旅店 v1', 'building', 11.0, 9.0, 7.4, 26000000, 'house',
     '{"tier":"inn"}', '[[-5.5,0,-4.5,5.5,7.4,4.5]]', 'shop_inn_v1', 'shop_inn_v1'),
    ('shop_bathhouse_v1', '澡堂 v1', 'building', 8.0, 6.0, 4.2, 16000000, 'shop',
     '{"shop":"bathhouse"}', '[[-4.0,0,-3.0,4.0,4.2,3.0]]', 'shop_bathhouse_v1', 'shop_bathhouse_v1'),
    ('shop_tea_v1', '茶馆 v1', 'building', 8.0, 7.0, 3.4, 15000000, 'shop',
     '{"shop":"tea"}', '[[-4.0,0,-3.5,4.0,3.4,3.5]]', 'shop_tea_v1', 'shop_tea_v1'),
    ('shop_dessert_v1', '甜品店 v1', 'building', 7.0, 6.0, 3.3, 15000000, 'shop',
     '{"shop":"dessert"}', '[[-3.5,0,-3.0,3.5,3.3,3.0]]', 'shop_dessert_v1', 'shop_dessert_v1'),
    ('shop_koban_v1', '警亭 v1', 'building', 6.0, 5.0, 3.2, 10000000, 'shop',
     '{"shop":"koban"}', '[[-3.0,0,-2.5,3.0,3.2,2.5]]', 'shop_koban_v1', 'shop_koban_v1'),
"""
    marker = "    ('teleport_v1', '传送阵 v1', 'function'"
    s = s.replace(marker, block + marker, 1)
    io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
    print('seed added')
print('DONE')
