# 建筑默认家具布局（局部坐标，米；rot 弧度）
# 建筑放置时按此表生成 town_objects，家具归属建筑主人，可单独移动/移除。
# y = 楼层高度：0 一层，3.3 二层（别墅）

LAYOUTS = {
    # ---------------- 小平房 7.4 x 8.6 ----------------
    'house_flat_v1': {
        'floors': [
            {'y': 0.0, 'items': [
                # 客厅（前左）
                {'catalog': 'sofa_modern_2', 'x': -1.55, 'z': 1.35, 'rot': 0.0},
                {'catalog': 'tv_wall', 'x': -1.55, 'z': 3.20, 'rot': 3.1416},
                {'catalog': 'tv_stand', 'x': -1.55, 'z': 3.30, 'rot': 0.0},
                {'catalog': 'rug_rect', 'x': -1.55, 'z': 1.55, 'rot': 0.0},
                # 餐桌在厨房区域，顺时针 90°
                {'catalog': 'dining_table', 'x': 1.35, 'z': 3.10, 'rot': -1.5708},
                {'catalog': 'chair_wood', 'x': 0.40, 'z': 3.10, 'rot': 1.5708},
                {'catalog': 'chair_wood', 'x': 2.30, 'z': 3.10, 'rot': -1.5708},
                # 厨房（前右）
                {'catalog': 'kitchen_counter', 'x': 3.12, 'z': 1.20, 'rot': 1.5708},
                {'catalog': 'kitchen_sink', 'x': 3.12, 'z': 1.00, 'rot': 1.5708},
                {'catalog': 'kitchen_stove', 'x': 3.12, 'z': 1.80, 'rot': 1.5708},
                {'catalog': 'kitchen_oven', 'x': 3.12, 'z': 2.30, 'rot': 1.5708},
                {'catalog': 'kitchen_cabinet', 'x': 3.45, 'z': 1.05, 'rot': 1.5708},
                {'catalog': 'fridge_display', 'x': 3.08, 'z': -0.55, 'rot': -1.5708},
                # 卧室（后左）
                {'catalog': 'bed_single', 'x': -2.15, 'z': -2.65, 'rot': 0.0},
                {'catalog': 'bed_nightstand', 'x': -1.10, 'z': -3.37, 'rot': 0.0},
                {'catalog': 'bed_lamp', 'x': -1.10, 'z': -3.37, 'rot': 0.0},
                {'catalog': 'wardrobe', 'x': -3.42, 'z': -0.75, 'rot': -1.5708},
                # 卫生间（后右）
                {'catalog': 'toilet', 'x': 1.65, 'z': -3.45, 'rot': 3.1416},
                {'catalog': 'bath_vanity', 'x': 2.95, 'z': -3.55, 'rot': 0.0},
                {'catalog': 'bath_mirror', 'x': 2.95, 'z': -3.78, 'rot': 3.1416},
                {'catalog': 'shower_tray', 'x': 2.75, 'z': -2.45, 'rot': 0.0},
                # 装饰
                {'catalog': 'plant_pot', 'x': -3.05, 'z': 3.10, 'rot': 0.0},
                {'catalog': 'ceiling_lamp', 'x': 0.0, 'z': 0.0, 'rot': 0.0},
            ]},
        ]
    },

    # ---------------- 别墅 14 x 11，两层 ----------------
    'house_villa_v1': {
        'floors': [
            {'y': 0.0, 'items': [
                # 客厅（一楼右前）：两个沙发 + 电视
                {'catalog': 'sofa_modern_2', 'x': 2.55, 'z': 2.10, 'rot': 0.0},
                {'catalog': 'sofa_modern_2', 'x': 4.75, 'z': 2.10, 'rot': 0.0},
                {'catalog': 'tv_wall', 'x': 3.65, 'z': 5.28, 'rot': 3.1416},
                {'catalog': 'tv_stand', 'x': 3.65, 'z': 5.16, 'rot': 0.0},
                {'catalog': 'rug_rect', 'x': 3.65, 'z': 1.95, 'rot': 0.0},
                # 餐厅（一楼左侧）
                {'catalog': 'dining_table', 'x': -1.30, 'z': 2.10, 'rot': 0.0},
                {'catalog': 'chair_wood', 'x': -2.30, 'z': 2.10, 'rot': 1.5708},
                {'catalog': 'chair_wood', 'x': -0.30, 'z': 2.10, 'rot': -1.5708},
                {'catalog': 'chair_wood', 'x': -1.30, 'z': 3.05, 'rot': 3.1416},
                {'catalog': 'chair_wood', 'x': -1.30, 'z': 1.15, 'rot': 0.0},
                # 厨房（后左）
                {'catalog': 'kitchen_counter', 'x': -3.40, 'z': -4.45, 'rot': 0.0},
                {'catalog': 'kitchen_sink', 'x': -3.40, 'z': -4.45, 'rot': 0.0},
                {'catalog': 'kitchen_stove', 'x': -2.00, 'z': -4.45, 'rot': 0.0},
                {'catalog': 'kitchen_oven', 'x': -2.00, 'z': -4.80, 'rot': 0.0},
                {'catalog': 'kitchen_cabinet', 'x': -3.30, 'z': -4.55, 'rot': 0.0},
                {'catalog': 'kitchen_island', 'x': -3.00, 'z': -3.10, 'rot': 0.0},
                {'catalog': 'fridge_display', 'x': -6.00, 'z': -3.30, 'rot': 1.5708},
                # 一楼卫生间（后右整体）
                {'catalog': 'toilet', 'x': 6.45, 'z': -4.95, 'rot': 3.1416},
                {'catalog': 'bath_vanity', 'x': 6.40, 'z': -3.45, 'rot': 0.0},
                {'catalog': 'bath_mirror', 'x': 6.92, 'z': -3.45, 'rot': -1.5708},
                {'catalog': 'shower_tray', 'x': 5.45, 'z': -2.95, 'rot': 0.0},
                {'catalog': 'plant_pot', 'x': 6.00, 'z': 4.20, 'rot': 0.0},
                {'catalog': 'ceiling_lamp', 'x': 0.0, 'z': 0.0, 'rot': 0.0},
            ]},
            {'y': 3.30, 'items': [
                # 二楼只有一张床
                {'catalog': 'bed_single', 'x': -2.80, 'z': -1.40, 'rot': 0.0},
                {'catalog': 'bed_nightstand', 'x': -1.75, 'z': -2.12, 'rot': 0.0},
                {'catalog': 'bed_lamp', 'x': -1.75, 'z': -2.12, 'rot': 0.0},
                {'catalog': 'wardrobe', 'x': 1.70, 'z': -2.30, 'rot': 0.0},
                {'catalog': 'desk', 'x': 0.40, 'z': 1.70, 'rot': 0.0},
                {'catalog': 'desk_chair', 'x': 0.40, 'z': 1.00, 'rot': 3.1416},
                {'catalog': 'bookshelf', 'x': -5.60, 'z': 2.20, 'rot': 0.0},
                # 二楼卫生间（后右整体）
                {'catalog': 'toilet', 'x': 2.05, 'z': -3.25, 'rot': 3.1416},
                {'catalog': 'bath_vanity', 'x': 1.60, 'z': -1.20, 'rot': 0.0},
                {'catalog': 'bathtub', 'x': -1.05, 'z': -2.00, 'rot': 0.0},
            ]},
        ]
    },

    # ---------------- 咖啡店 9.3 x 9.3 ----------------
    'shop_cafe_v1': {
        'floors': [
            {'y': 0.0, 'items': [
                {'catalog': 'shop_counter', 'x': 0.0, 'z': -2.95, 'rot': 0.0},
                {'catalog': 'coffee_machine', 'x': 1.35, 'z': -2.95, 'rot': 0.0},
                {'catalog': 'menu_board', 'x': 2.30, 'z': -3.60, 'rot': 0.0},
                {'catalog': 'wall_menu', 'x': -3.80, 'z': 0.40, 'rot': 1.5708},
                {'catalog': 'wall_art', 'x': -1.25, 'z': -4.55, 'rot': 0.0},
                {'catalog': 'wall_art', 'x': 1.75, 'z': -4.55, 'rot': 0.0},
                {'catalog': 'wall_clock', 'x': 0.30, 'z': -4.45, 'rot': 0.0},
                {'catalog': 'shop_shelf', 'x': -3.80, 'z': -2.10, 'rot': 0.0},
                {'catalog': 'shop_shelf', 'x': 3.80, 'z': -2.10, 'rot': 0.0},
                {'catalog': 'fridge_display', 'x': -3.83, 'z': 1.75, 'rot': 1.5708},
                {'catalog': 'dining_table', 'x': 1.58, 'z': 1.40, 'rot': 0.0},
                {'catalog': 'chair_wood', 'x': 0.55, 'z': 1.40, 'rot': 1.5708},
                {'catalog': 'chair_wood', 'x': 2.60, 'z': 1.40, 'rot': -1.5708},
                {'catalog': 'plant_pot', 'x': 2.80, 'z': 2.20, 'rot': 0.0},
                # 外摆
                {'catalog': 'outdoor_table', 'x': 2.70, 'z': 6.20, 'rot': 0.0},
                {'catalog': 'chair_wood', 'x': 1.75, 'z': 6.20, 'rot': 1.5708},
                {'catalog': 'chair_wood', 'x': 3.65, 'z': 6.20, 'rot': -1.5708},
                {'catalog': 'umbrella', 'x': 3.95, 'z': 6.55, 'rot': 0.0},
                {'catalog': 'outdoor_table', 'x': -2.50, 'z': 6.20, 'rot': 0.0},
                {'catalog': 'chair_wood', 'x': -3.45, 'z': 6.20, 'rot': 1.5708},
                {'catalog': 'chair_wood', 'x': -1.55, 'z': 6.20, 'rot': -1.5708},
                {'catalog': 'ceiling_lamp', 'x': 0.0, 'z': 0.0, 'rot': 0.0},
            ]},
        ]
    },
    'shop_cafe_v2': {'floors': [
        {'y': 0.0, 'items': [
            {'catalog': 'shop_counter', 'x': 0.0, 'z': -2.95, 'rot': 0.0},
            {'catalog': 'coffee_machine', 'x': 1.35, 'z': -2.95, 'rot': 0.0},
            {'catalog': 'menu_board', 'x': 2.30, 'z': -3.60, 'rot': 0.0},
            {'catalog': 'wall_art', 'x': -1.25, 'z': -4.55, 'rot': 0.0},
            {'catalog': 'wall_art', 'x': 1.75, 'z': -4.55, 'rot': 0.0},
            {'catalog': 'wall_clock', 'x': 0.30, 'z': -4.45, 'rot': 0.0},
            {'catalog': 'shop_shelf', 'x': -3.80, 'z': -2.10, 'rot': 0.0},
            {'catalog': 'shop_shelf', 'x': 3.80, 'z': -2.10, 'rot': 0.0},
            {'catalog': 'fridge_display', 'x': -3.83, 'z': 1.75, 'rot': 1.5708},
            {'catalog': 'dining_table', 'x': 1.58, 'z': 1.40, 'rot': 0.0},
            {'catalog': 'chair_wood', 'x': 0.55, 'z': 1.40, 'rot': 1.5708},
            {'catalog': 'chair_wood', 'x': 2.60, 'z': 1.40, 'rot': -1.5708},
            {'catalog': 'plant_pot', 'x': 2.80, 'z': 2.20, 'rot': 0.0},
            {'catalog': 'ceiling_lamp', 'x': 0.0, 'z': 0.0, 'rot': 0.0},
        ]},
    ]},

    # ---------------- 超市 18.6 x 15.5 ----------------
    'shop_mart_v1': {
        'floors': [
            {'y': 0.0, 'items': [
                {'catalog': 'checkout_counter', 'x': 8.09, 'z': 3.41, 'rot': 1.5708},
                {'catalog': 'cash_register', 'x': 8.09, 'z': 4.43, 'rot': 1.5708},
                {'catalog': 'aisle_shelf', 'x': -4.65, 'z': -0.78, 'rot': 0.0},
                {'catalog': 'aisle_shelf', 'x': 0.00, 'z': -0.78, 'rot': 0.0},
                {'catalog': 'aisle_shelf', 'x': 4.65, 'z': -0.78, 'rot': 0.0},
                {'catalog': 'fridge_display', 'x': -5.77, 'z': -6.72, 'rot': 0.0},
                {'catalog': 'shopping_cart', 'x': 6.14, 'z': 0.31, 'rot': 0.0},
                {'catalog': 'basket_stack', 'x': -5.39, 'z': 4.81, 'rot': 0.0},
                {'catalog': 'promo_board', 'x': 0.0, 'z': -6.87, 'rot': 0.0},
                {'catalog': 'ceiling_lamp', 'x': 0.0, 'z': 0.0, 'rot': 0.0},
            ]},
        ]
    },

    # ---------------- 大厅 20 x 14 ----------------
    'hall_v1': {
        'floors': [
            {'y': 0.0, 'items': [
                {'catalog': 'shop_counter', 'x': -7.0, 'z': 5.0, 'rot': 0.0},
                {'catalog': 'dining_table', 'x': 7.0, 'z': 5.0, 'rot': 0.0},
                # 四排五列座椅
                {'catalog': 'hall_chair', 'x': -4.4, 'z': -1.6, 'rot': 3.1416},
                {'catalog': 'hall_chair', 'x': -2.2, 'z': -1.6, 'rot': 3.1416},
                {'catalog': 'hall_chair', 'x': 0.0, 'z': -1.6, 'rot': 3.1416},
                {'catalog': 'hall_chair', 'x': 2.2, 'z': -1.6, 'rot': 3.1416},
                {'catalog': 'hall_chair', 'x': 4.4, 'z': -1.6, 'rot': 3.1416},
                {'catalog': 'hall_chair', 'x': -4.4, 'z': 0.4, 'rot': 3.1416},
                {'catalog': 'hall_chair', 'x': -2.2, 'z': 0.4, 'rot': 3.1416},
                {'catalog': 'hall_chair', 'x': 0.0, 'z': 0.4, 'rot': 3.1416},
                {'catalog': 'hall_chair', 'x': 2.2, 'z': 0.4, 'rot': 3.1416},
                {'catalog': 'hall_chair', 'x': 4.4, 'z': 0.4, 'rot': 3.1416},
                {'catalog': 'hall_chair', 'x': -4.4, 'z': 2.4, 'rot': 3.1416},
                {'catalog': 'hall_chair', 'x': -2.2, 'z': 2.4, 'rot': 3.1416},
                {'catalog': 'hall_chair', 'x': 0.0, 'z': 2.4, 'rot': 3.1416},
                {'catalog': 'hall_chair', 'x': 2.2, 'z': 2.4, 'rot': 3.1416},
                {'catalog': 'hall_chair', 'x': 4.4, 'z': 2.4, 'rot': 3.1416},
                {'catalog': 'hall_chair', 'x': -4.4, 'z': 4.4, 'rot': 3.1416},
                {'catalog': 'hall_chair', 'x': -2.2, 'z': 4.4, 'rot': 3.1416},
                {'catalog': 'hall_chair', 'x': 0.0, 'z': 4.4, 'rot': 3.1416},
                {'catalog': 'hall_chair', 'x': 2.2, 'z': 4.4, 'rot': 3.1416},
                {'catalog': 'hall_chair', 'x': 4.4, 'z': 4.4, 'rot': 3.1416},
                {'catalog': 'plant_pot', 'x': 7.0, 'z': 5.6, 'rot': 0.0},
                {'catalog': 'ceiling_lamp', 'x': 0.0, 'z': 0.0, 'rot': 0.0},
            ]},
        ]
    },
}

LAYOUTS['shop_ramen_v1'] = {'floors': [{'y': 0.0, 'items': [
    {'catalog': 'shop_counter', 'x': 3.0, 'z': 0.0, 'rot': 0.0},
    {'catalog': 'chair_wood', 'x': 2.2, 'z': -1.6, 'rot': 1.5708},
    {'catalog': 'chair_wood', 'x': 2.2, 'z': 0.0, 'rot': 1.5708},
    {'catalog': 'chair_wood', 'x': 2.2, 'z': 1.6, 'rot': 1.5708},
    {'catalog': 'kitchen_stove', 'x': 3.5, 'z': -1.2, 'rot': 0.0},
    {'catalog': 'kitchen_sink', 'x': 3.45, 'z': 0.8, 'rot': 0.0},
    {'catalog': 'wall_menu', 'x': -3.8, 'z': 0.0, 'rot': 1.5708},
    {'catalog': 'ceiling_lamp', 'x': 0.0, 'z': 0.0, 'rot': 0.0},
    {'catalog': 'ceiling_lamp', 'x': -3.5, 'z': 0.0, 'rot': 0.0},
]}]}

LAYOUTS['shop_bakery_v1'] = {'floors': [{'y': 0.0, 'items': [
    {'catalog': 'shop_counter', 'x': 0.0, 'z': -2.0, 'rot': 0.0},
    {'catalog': 'shop_counter', 'x': 0.0, 'z': -2.3, 'rot': 0.0},
    {'catalog': 'checkout_counter', 'x': 3.8, 'z': 1.8, 'rot': 0.0},
    {'catalog': 'dining_table', 'x': -1.6, 'z': 1.3, 'rot': 0.0},
    {'catalog': 'chair_wood', 'x': -1.6, 'z': 2.1, 'rot': 3.1416},
    {'catalog': 'chair_wood', 'x': -1.6, 'z': 0.6, 'rot': 0.0},
    {'catalog': 'ceiling_lamp', 'x': 0.0, 'z': 0.0, 'rot': 0.0},
]}]}

LAYOUTS['shop_general_v1'] = {'floors': [{'y': 0.0, 'items': [
    {'catalog': 'shop_shelf', 'x': -2.9, 'z': 0.0, 'rot': 0.0},
    {'catalog': 'shop_shelf', 'x': 2.9, 'z': 0.0, 'rot': 0.0},
    {'catalog': 'checkout_counter', 'x': 0.0, 'z': 1.7, 'rot': 0.0},
    {'catalog': 'basket_stack', 'x': -0.8, 'z': 2.1, 'rot': 0.0},
    {'catalog': 'basket_stack', 'x': 0.0, 'z': 2.1, 'rot': 0.0},
    {'catalog': 'basket_stack', 'x': 0.7, 'z': 2.1, 'rot': 0.0},
    {'catalog': 'ceiling_lamp', 'x': 0.0, 'z': 0.0, 'rot': 0.0},
]}]}

LAYOUTS['shop_flower_v1'] = {'floors': [{'y': 0.0, 'items': [
    {'catalog': 'shop_shelf', 'x': -3.1, 'z': 0.0, 'rot': 0.0},
    {'catalog': 'dining_table', 'x': 0.6, 'z': 0.0, 'rot': 0.0},
    {'catalog': 'plant_pot', 'x': -3.1, 'z': -1.6, 'rot': 0.0},
    {'catalog': 'plant_pot', 'x': -3.1, 'z': -0.8, 'rot': 0.0},
    {'catalog': 'plant_pot', 'x': -3.1, 'z': 0.0, 'rot': 0.0},
    {'catalog': 'plant_pot', 'x': -3.1, 'z': 0.8, 'rot': 0.0},
    {'catalog': 'plant_pot', 'x': -3.1, 'z': 1.6, 'rot': 0.0},
    {'catalog': 'plant_pot', 'x': 0.1, 'z': 0.0, 'rot': 0.0},
    {'catalog': 'plant_pot', 'x': 0.6, 'z': 0.0, 'rot': 0.0},
    {'catalog': 'plant_pot', 'x': 1.1, 'z': 0.0, 'rot': 0.0},
    {'catalog': 'ceiling_lamp', 'x': 0.0, 'z': 0.0, 'rot': 0.0},
]}]}

LAYOUTS['shop_warehouse_v1'] = {'floors': [{'y': 0.0, 'items': [
    {'catalog': 'aisle_shelf', 'x': -4.1, 'z': 0.0, 'rot': 0.0},
    {'catalog': 'aisle_shelf', 'x': -0.5, 'z': 0.0, 'rot': 0.0},
    {'catalog': 'aisle_shelf', 'x': 3.1, 'z': 0.0, 'rot': 0.0},
    {'catalog': 'basket_stack', 'x': -5.3, 'z': 3.9, 'rot': 0.0},
    {'catalog': 'basket_stack', 'x': -4.6, 'z': 4.7, 'rot': 0.0},
    {'catalog': 'basket_stack', 'x': -5.3, 'z': 3.1, 'rot': 0.0},
    {'catalog': 'basket_stack', 'x': -4.6, 'z': 3.9, 'rot': 0.0},
    {'catalog': 'dining_table', 'x': 4.1, 'z': 3.7, 'rot': 0.0},
    {'catalog': 'ceiling_lamp', 'x': -3.6, 'z': 0.0, 'rot': 0.0},
    {'catalog': 'ceiling_lamp', 'x': 0.0, 'z': 0.0, 'rot': 0.0},
    {'catalog': 'ceiling_lamp', 'x': 3.6, 'z': 0.0, 'rot': 0.0},
]}]}

LAYOUTS['shop_smith_v1'] = {'floors': [{'y': 0.0, 'items': [
    {'catalog': 'dining_table', 'x': -1.2, 'z': 0.4, 'rot': 0.0},
    {'catalog': 'kitchen_stove', 'x': 2.3, 'z': -2.1, 'rot': 0.0},
    {'catalog': 'basket_stack', 'x': -1.9, 'z': 1.9, 'rot': 0.0},
    {'catalog': 'shop_shelf', 'x': -2.9, 'z': 0.0, 'rot': 1.5708},
    {'catalog': 'ceiling_lamp', 'x': 0.0, 'z': 0.0, 'rot': 0.0},
]}]}

LAYOUTS['shop_clinic_v1'] = {'floors': [{'y': 0.0, 'items': [
    {'catalog': 'shop_shelf', 'x': 0.0, 'z': -2.55, 'rot': 0.0},
    {'catalog': 'shop_counter', 'x': 0.0, 'z': 1.5, 'rot': 0.0},
    {'catalog': 'plant_pot', 'x': -0.9, 'z': 1.5, 'rot': 0.0},
    {'catalog': 'plant_pot', 'x': 0.0, 'z': 1.5, 'rot': 0.0},
    {'catalog': 'plant_pot', 'x': 0.9, 'z': 1.5, 'rot': 0.0},
    {'catalog': 'chair_wood', 'x': -2.2, 'z': 0.1, 'rot': 3.1416},
    {'catalog': 'chair_wood', 'x': -2.2, 'z': 1.1, 'rot': 3.1416},
    {'catalog': 'ceiling_lamp', 'x': 0.0, 'z': 0.0, 'rot': 0.0},
]}]}

LAYOUTS['shop_post_v1'] = {'floors': [{'y': 0.0, 'items': [
    {'catalog': 'checkout_counter', 'x': 0.0, 'z': 1.3, 'rot': 0.0},
    {'catalog': 'shop_shelf', 'x': 0.0, 'z': -2.58, 'rot': 0.0},
    {'catalog': 'basket_stack', 'x': -2.3, 'z': 2.1, 'rot': 0.0},
    {'catalog': 'basket_stack', 'x': -1.7, 'z': 2.1, 'rot': 0.0},
    {'catalog': 'basket_stack', 'x': -2.3, 'z': 2.6, 'rot': 0.0},
    {'catalog': 'ceiling_lamp', 'x': 0.0, 'z': 0.0, 'rot': 0.0},
]}]}

LAYOUTS['shop_bookstore_v1'] = {'floors': [{'y': 0.0, 'items': [
    {'catalog': 'shop_shelf', 'x': -4.3, 'z': 0.0, 'rot': 0.0},
    {'catalog': 'shop_shelf', 'x': 4.3, 'z': 0.0, 'rot': 0.0},
    {'catalog': 'dining_table', 'x': 0.0, 'z': 1.3, 'rot': 0.0},
    {'catalog': 'chair_wood', 'x': 0.0, 'z': 0.3, 'rot': 0.0},
    {'catalog': 'chair_wood', 'x': 0.0, 'z': 2.3, 'rot': 3.1416},
    {'catalog': 'ceiling_lamp', 'x': -1.8, 'z': 0.0, 'rot': 0.0},
    {'catalog': 'ceiling_lamp', 'x': 1.8, 'z': 0.0, 'rot': 0.0},
]}]}

LAYOUTS['shop_izakaya_v1'] = {'floors': [{'y': 0.0, 'items': [
    {'catalog': 'shop_counter', 'x': 1.8, 'z': -2.3, 'rot': 0.0},
    {'catalog': 'chair_wood', 'x': 1.0, 'z': -2.3, 'rot': 1.5708},
    {'catalog': 'chair_wood', 'x': 1.0, 'z': -1.1, 'rot': 1.5708},
    {'catalog': 'chair_wood', 'x': 1.0, 'z': 0.1, 'rot': 1.5708},
    {'catalog': 'chair_wood', 'x': -2.0, 'z': 1.5, 'rot': 0.0},
    {'catalog': 'shop_shelf', 'x': -2.4, 'z': -2.6, 'rot': 0.0},
    {'catalog': 'dining_table', 'x': -2.0, 'z': 1.5, 'rot': 0.0},
    {'catalog': 'ceiling_lamp', 'x': -2.0, 'z': 2.3, 'rot': 0.0},
    {'catalog': 'ceiling_lamp', 'x': 0.0, 'z': 2.3, 'rot': 0.0},
    {'catalog': 'ceiling_lamp', 'x': 2.0, 'z': 2.3, 'rot': 0.0},
]}]}

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
