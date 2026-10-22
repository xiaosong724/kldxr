# -*- coding: utf-8 -*-
"""Multi-town foundation: registry, permissions, fees, lifespan.

Phase 1 keeps gold / object collision callbacks outside this module.  The
network/tick layer passes the already-authorized owner and charges gold.
"""

import sqlite3
import json
import time

import db as dbmod
try:
    from town_layouts import LAYOUTS
except Exception:
    LAYOUTS = {}

GRID = 0.62
TIERS = (30, 50, 80, 100)
GAP_GRID = 50
GAP_M = GAP_GRID * GRID
SAFE_PAD = 2 * GRID
BASE_FEE = 5_000_000
BASE_TIER = 30
RETENTION_DAYS = 7
DAY_MS = 24 * 60 * 60 * 1000

# permission bits
P_MOVE = 1
P_INTERACT = 2
P_TRADE = 4
P_PERM = 8
P_REMOVE = 16
P_PRICE = 32
P_TELEPORT = 64
P_ALL = 127
P_VISITOR = P_INTERACT | P_TRADE | P_TELEPORT

PERM_NAMES = (
    (P_MOVE, 'move', '可移动'),
    (P_INTERACT, 'interact', '可交互'),
    (P_TRADE, 'trade', '可交易'),
    (P_PERM, 'perm', '可权限'),
    (P_REMOVE, 'remove', '可移除'),
    (P_PRICE, 'price', '可调价格'),
    (P_TELEPORT, 'teleport', '可传送'),
)

OBJ_LIMITS = {30: 100, 50: 250, 80: 600, 100: 1000}
SYSTEM_NAME = '新手镇'


def now_ms():
    return int(time.time() * 1000)


def day_ms():
    return DAY_MS


def fee_for(tier):
    """Daily fee, rounded to 10k, area-squared scaling."""
    tier = int(tier)
    raw = BASE_FEE * (tier / float(BASE_TIER)) ** 2
    return int(round(raw / 10000.0)) * 10000


def size_m(tier):
    return float(tier) * GRID


def valid_tier(tier):
    try:
        return int(tier) in TIERS
    except Exception:
        return False


def bounds(x, z, size):
    return (float(x) - size / 2.0, float(z) - size / 2.0,
            float(x) + size / 2.0, float(z) + size / 2.0)


def bounds_of(row):
    return bounds(row['x'], row['z'], row['size_m'])


def safe_bounds_of(row):
    x0, z0, x1, z1 = bounds_of(row)
    return (x0 - SAFE_PAD, z0 - SAFE_PAD, x1 + SAFE_PAD, z1 + SAFE_PAD)


def _rect_gap_ok(a, b, gap):
    """True when two rectangles are at least gap apart on one axis."""
    ax0, az0, ax1, az1 = a
    bx0, bz0, bx1, bz1 = b
    return (ax1 + gap <= bx0 or bx1 + gap <= ax0 or
            az1 + gap <= bz0 or bz1 + gap <= az0)


def next_due_ms(now=None):
    """Next local 00:00 as epoch ms."""
    if now is None:
        now = time.time()
    lt = time.localtime(now)
    y, m, d = lt.tm_year, lt.tm_mon, lt.tm_mday
    t = time.mktime((y, m, d + 1, 0, 0, 0, 0, 0, -1))
    return int(t * 1000)


def perm_mask_of(role_id, town_row, cfg=None):
    """Owner gets ALL; other players use town_perms/default visitor."""
    try:
        if int(role_id) == int(town_row['owner_id'] or 0):
            return P_ALL
    except Exception:
        pass
    if cfg is None:
        return 0
    try:
        with dbmod.db(cfg) as c:
            r = c.execute('SELECT mask FROM town_perms WHERE town_id=? AND player_id=?',
                          (int(town_row['id']), int(role_id))).fetchone()
            if r is not None:
                return int(r[0] or 0)
    except Exception:
        return 0
    return P_VISITOR


def has_perm(cfg, role_id, town_row, bit):
    if int(town_row['is_system'] or 0) == 1:
        # system main town: visitors get the normal visitor template
        pass
    return (perm_mask_of(role_id, town_row, cfg) & int(bit)) != 0


def set_perm(cfg, town_id, player_id, mask, granted_by=0):
    mask = int(mask) & P_ALL
    with dbmod.db(cfg) as c:
        c.execute('INSERT INTO town_perms(town_id,player_id,mask,granted_by,granted_at)'
                  ' VALUES(?,?,?,?,?)'
                  ' ON CONFLICT(town_id,player_id) DO UPDATE SET'
                  ' mask=excluded.mask, granted_by=excluded.granted_by,'
                  ' granted_at=excluded.granted_at',
                  (int(town_id), int(player_id), mask, int(granted_by), now_ms()))
        c.commit()
    return mask


def _row(row):
    return dict(row) if row is not None else None


def get_town(cfg, town_id):
    with dbmod.db(cfg) as c:
        return _row(c.execute('SELECT * FROM towns WHERE id=?', (int(town_id),)).fetchone())


def get_by_owner(cfg, owner_id):
    with dbmod.db(cfg) as c:
        return _row(c.execute(
            'SELECT * FROM towns WHERE owner_id=? AND is_system=0'
            " AND status IN ('active','frozen','restoring') LIMIT 1",
            (int(owner_id),)).fetchone())


def list_towns(cfg, status=None, owner_id=None):
    q = 'SELECT * FROM towns WHERE 1=1'
    args = []
    if status:
        q += ' AND status=?'
        args.append(status)
    if owner_id is not None:
        q += ' AND owner_id=?'
        args.append(int(owner_id))
    q += ' ORDER BY id'
    with dbmod.db(cfg) as c:
        return [_row(r) for r in c.execute(q, args).fetchall()]


FURNITURE_SEED = (
    # id, name, category, w, d, h, price, function_type, function_json, collision_json,
    # model_id, place_mode, movable
    # ---- bedroom ----
    ('bed_single', '单人床', 'furniture', 1.60, 2.05, 1.00, 180000, 'bed', '{}',
     '[[-0.80,0,-1.03,0.80,0.60,1.03]]', 'bed_single', 'grid', 1),
    ('bed_nightstand', '床头柜', 'furniture', 0.45, 0.42, 0.55, 30000, 'storage', '{}',
     '[[-0.23,0,-0.21,0.23,0.55,0.21]]', 'bed_nightstand', 'grid', 1),
    ('bed_lamp', '床头灯', 'decor', 0.16, 0.16, 0.30, 15000, 'light', '{}',
     '[[-0.08,0,-0.08,0.08,0.30,0.08]]', 'bed_lamp', 'grid', 1),
    ('wardrobe', '衣柜', 'furniture', 1.10, 0.55, 1.85, 220000, 'storage', '{}',
     '[[-0.55,0,-0.28,0.55,1.85,0.28]]', 'wardrobe', 'grid', 1),
    # ---- living ----
    ('sofa_modern_2', '双人沙发', 'furniture', 1.95, 0.82, 0.95, 280000, 'seat', '{"seats":2}',
     '[[-0.98,0,-0.41,0.98,0.95,0.41]]', 'sofa_modern_2', 'grid', 1),
    ('coffee_table', '茶几', 'furniture', 1.10, 0.70, 0.50, 60000, 'none', '{}',
     '[[-0.55,0,-0.35,0.55,0.50,0.35]]', 'coffee_table', 'grid', 1),
    ('tv_wall', '壁挂电视', 'furniture', 1.05, 0.10, 0.55, 150000, 'media', '{}',
     '[[-0.53,0,-0.05,0.53,0.55,0.05]]', 'tv_wall', 'wall', 1),
    ('tv_stand', '电视柜', 'furniture', 1.20, 0.30, 0.45, 90000, 'storage', '{}',
     '[[-0.60,0,-0.15,0.60,0.45,0.15]]', 'tv_stand', 'grid', 1),
    ('rug_rect', '地毯', 'decor', 2.60, 1.80, 0.02, 25000, 'none', '{}',
     '[]', 'rug_rect', 'free', 1),
    ('bookshelf', '书架', 'furniture', 1.20, 0.30, 0.80, 120000, 'storage', '{}',
     '[[-0.60,0,-0.15,0.60,0.80,0.15]]', 'bookshelf', 'grid', 1),
    # ---- dining ----
    ('dining_table', '餐桌', 'furniture', 1.45, 0.86, 0.75, 160000, 'table', '{"seats":4}',
     '[[-0.73,0,-0.43,0.73,0.75,0.43]]', 'dining_table', 'grid', 1),
    ('chair_wood', '木椅', 'furniture', 0.50, 0.48, 0.90, 45000, 'seat', '{"seats":1}',
     '[[-0.25,0,-0.24,0.25,0.90,0.24]]', 'chair_wood', 'grid', 1),
    # ---- kitchen ----
    ('kitchen_counter', '厨房操作台', 'furniture', 2.80, 0.62, 0.90, 240000, 'kitchen', '{}',
     '[[-1.40,0,-0.31,1.40,0.90,0.31]]', 'kitchen_counter', 'grid', 1),
    ('kitchen_sink', '水槽', 'furniture', 0.44, 0.72, 0.15, 80000, 'sink', '{}',
     '[[-0.22,0,-0.36,0.22,0.15,0.36]]', 'kitchen_sink', 'grid', 1),
    ('kitchen_stove', '灶台', 'furniture', 0.52, 0.82, 0.10, 120000, 'cooking', '{}',
     '[[-0.26,0,-0.41,0.26,0.10,0.41]]', 'kitchen_stove', 'grid', 1),
    ('kitchen_oven', '烤箱', 'furniture', 0.82, 0.04, 0.55, 100000, 'cooking', '{}',
     '[[-0.41,0,-0.02,0.41,0.55,0.02]]', 'kitchen_oven', 'grid', 1),
    ('kitchen_cabinet', '厨房吊柜', 'furniture', 2.45, 0.34, 0.75, 180000, 'storage', '{}',
     '[[-1.23,0,-0.17,1.23,0.75,0.17]]', 'kitchen_cabinet', 'wall', 1),
    ('kitchen_island', '厨房中岛', 'furniture', 2.40, 1.00, 1.10, 350000, 'kitchen', '{}',
     '[[-1.20,0,-0.50,1.20,1.10,0.50]]', 'kitchen_island', 'grid', 1),
    ('fridge_display', '展示冰箱', 'furniture', 0.78, 0.72, 2.24, 320000, 'fridge', '{}',
     '[[-0.39,0,-0.36,0.39,2.24,0.36]]', 'fridge_display', 'grid', 1),
    # ---- bathroom ----
    ('toilet', '马桶', 'furniture', 0.50, 0.62, 1.22, 150000, 'toilet', '{}',
     '[[-0.25,0,-0.31,0.25,1.22,0.31]]', 'toilet', 'grid', 1),
    ('bath_vanity', '洗手台', 'furniture', 0.80, 0.44, 0.78, 180000, 'sink', '{}',
     '[[-0.40,0,-0.22,0.40,0.78,0.22]]', 'bath_vanity', 'grid', 1),
    ('bath_mirror', '浴室镜', 'decor', 0.75, 0.05, 0.75, 60000, 'none', '{}',
     '[]', 'bath_mirror', 'wall', 1),
    ('shower_tray', '淋浴间', 'furniture', 1.05, 1.05, 1.80, 150000, 'shower', '{}',
     '[[-0.53,0,-0.53,0.53,1.80,0.53]]', 'shower_tray', 'grid', 1),
    ('bathtub', '浴缸', 'furniture', 1.25, 0.70, 0.55, 260000, 'bath', '{}',
     '[[-0.63,0,-0.35,0.63,0.55,0.35]]', 'bathtub', 'grid', 1),
    # ---- study ----
    ('desk', '书桌', 'furniture', 1.30, 0.70, 0.78, 140000, 'desk', '{}',
     '[[-0.65,0,-0.35,0.65,0.78,0.35]]', 'desk', 'grid', 1),
    ('desk_chair', '书桌椅', 'furniture', 0.50, 0.48, 0.90, 55000, 'seat', '{"seats":1}',
     '[[-0.25,0,-0.24,0.25,0.90,0.24]]', 'desk_chair', 'grid', 1),
    # ---- shop ----
    ('shop_counter', '咖啡馆柜台', 'furniture', 3.20, 0.62, 0.95, 300000, 'shop_counter', '{}',
     '[[-1.60,0,-0.31,1.60,0.95,0.31]]', 'shop_counter', 'grid', 1),
    ('coffee_machine', '咖啡机', 'furniture', 0.72, 0.44, 0.60, 200000, 'coffee', '{}',
     '[[-0.36,0,-0.22,0.36,0.60,0.22]]', 'coffee_machine', 'grid', 1),
    ('menu_board', '菜单板', 'decor', 0.70, 0.35, 0.38, 40000, 'none', '{}',
     '[[-0.35,0,-0.18,0.35,0.38,0.18]]', 'menu_board', 'grid', 1),
    ('wall_menu', '墙菜单', 'decor', 0.85, 0.03, 1.05, 35000, 'none', '{}',
     '[]', 'wall_menu', 'wall', 1),
    ('wall_art', '挂画', 'decor', 0.92, 0.06, 0.72, 50000, 'none', '{}',
     '[]', 'wall_art', 'wall', 1),
    ('wall_clock', '挂钟', 'decor', 0.44, 0.06, 0.44, 40000, 'none', '{}',
     '[]', 'wall_clock', 'wall', 1),
    ('shop_shelf', '咖啡店货架', 'furniture', 0.72, 2.20, 1.90, 260000, 'shelf', '{}',
     '[[-0.36,0,-1.10,0.36,1.90,1.10]]', 'shop_shelf', 'grid', 1),
    ('checkout_counter', '收银台', 'furniture', 3.20, 0.62, 0.95, 300000, 'shop_counter', '{}',
     '[[-1.60,0,-0.31,1.60,0.95,0.31]]', 'checkout_counter', 'grid', 1),
    ('cash_register', '收银机', 'furniture', 0.52, 0.38, 0.42, 90000, 'register', '{}',
     '[[-0.26,0,-0.19,0.26,0.42,0.19]]', 'cash_register', 'grid', 1),
    ('aisle_shelf', '超市货架通道', 'furniture', 0.72, 3.20, 1.55, 380000, 'shelf', '{}',
     '[[-0.36,0,-1.60,0.36,1.55,1.60]]', 'aisle_shelf', 'grid', 1),
    ('shopping_cart', '购物车', 'decor', 0.45, 0.55, 0.55, 25000, 'none', '{}',
     '[[-0.23,0,-0.28,0.23,0.55,0.28]]', 'shopping_cart', 'free', 1),
    ('basket_stack', '购物篮堆', 'decor', 0.45, 0.32, 0.60, 15000, 'none', '{}',
     '[[-0.23,0,-0.16,0.23,0.60,0.16]]', 'basket_stack', 'free', 1),
    ('promo_board', '促销牌', 'decor', 1.10, 0.05, 0.55, 20000, 'none', '{}',
     '[]', 'promo_board', 'wall', 1),
    # ---- outdoor / public ----
    ('outdoor_table', '户外桌', 'furniture', 1.20, 0.82, 0.70, 70000, 'table', '{}',
     '[[-0.60,0,-0.41,0.60,0.70,0.41]]', 'outdoor_table', 'grid', 1),
    ('umbrella', '遮阳伞', 'decor', 2.70, 2.70, 2.80, 110000, 'none', '{}',
     '[[-0.10,0,-0.10,0.10,2.80,0.10]]', 'umbrella', 'free', 1),
    ('hall_chair', '大厅座椅', 'furniture', 0.50, 0.48, 0.90, 35000, 'seat', '{"seats":1}',
     '[[-0.25,0,-0.24,0.25,0.90,0.24]]', 'hall_chair', 'grid', 1),
    ('plant_pot', '盆栽', 'decor', 0.44, 0.44, 0.80, 30000, 'none', '{}',
     '[[-0.22,0,-0.22,0.22,0.80,0.22]]', 'plant_pot', 'grid', 1),
    ('ceiling_lamp', '吊灯', 'decor', 0.22, 0.22, 0.30, 45000, 'light', '{}',
     '[]', 'ceiling_lamp', 'free', 1),
)

BUILDING_SEED = (
    # id, name, category, w, d, h, price, function_type, function_json, collision_json,
    # model_id, layout_key
    ('house_flat_v1', '小平房 v1', 'building', 7.4, 8.6, 2.9, 5000000, 'house',
     '{"tier":"flat"}', '[[-3.7,0,-4.3,3.7,2.9,4.3]]', 'house_flat_v1', 'house_flat_v1'),
    ('house_villa_v1', '别墅 v1', 'building', 14.0, 11.0, 6.3, 12000000, 'house',
     '{"tier":"villa"}', '[[-7.0,0,-5.5,7.0,6.3,5.5]]', 'house_villa_v1', 'house_villa_v1'),
    ('shop_cafe_v1', '咖啡店 v1', 'building', 9.3, 9.3, 3.2, 20000000, 'shop',
     '{"shop":"cafe"}', '[[-4.65,0,-4.65,4.65,3.2,4.65]]', 'shop_cafe_v1', 'shop_cafe_v1'),
    ('shop_cafe_v2', '咖啡店 v2', 'building', 9.3, 9.3, 3.2, 20000000, 'shop',
     '{"shop":"cafe"}', '[[-4.65,0,-4.65,4.65,3.2,4.65]]', 'shop_cafe_v2', 'shop_cafe_v2'),
    ('shop_mart_v1', '超市 v1', 'building', 18.6, 15.5, 4.4, 35000000, 'shop',
     '{"shop":"mart"}', '[[-9.3,0,-7.75,9.3,4.4,7.75]]', 'shop_mart_v1', 'shop_mart_v1'),
    ('hall_v1', '大厅 v1', 'building', 20.0, 14.0, 4.8, 50000000, 'building',
     '{}', '[[-10.0,0,-7.0,10.0,4.8,7.0]]', 'hall_v1', 'hall_v1'),
    ('shop_ramen_v1', '面馆 v1', 'building', 8.0, 6.0, 3.4, 15000000, 'shop',
     '{"shop":"ramen"}', '[[-4.0,0,-3.0,4.0,3.4,3.0]]', 'shop_ramen_v1', 'shop_ramen_v1'),
    ('shop_bakery_v1', '面包店 v1', 'building', 10.0, 6.0, 3.3, 15000000, 'shop',
     '{"shop":"bakery"}', '[[-5.0,0,-3.0,5.0,3.3,3.0]]', 'shop_bakery_v1', 'shop_bakery_v1'),
    ('shop_general_v1', '杂货铺 v1', 'building', 7.0, 6.0, 3.2, 12000000, 'shop',
     '{"shop":"general"}', '[[-3.5,0,-3.0,3.5,3.2,3.0]]', 'shop_general_v1', 'shop_general_v1'),
    ('shop_flower_v1', '花店 v1', 'building', 8.0, 6.0, 3.2, 12000000, 'shop',
     '{"shop":"flower"}', '[[-4.0,0,-3.0,4.0,3.2,3.0]]', 'shop_flower_v1', 'shop_flower_v1'),
    ('shop_warehouse_v1', '仓库 v1', 'building', 13.0, 11.0, 4.2, 18000000, 'shop',
     '{"shop":"warehouse"}', '[[-6.5,0,-5.5,6.5,4.2,5.5]]', 'shop_warehouse_v1', 'shop_warehouse_v1'),
    ('shop_smith_v1', '铁匠铺 v1', 'building', 7.0, 7.0, 3.6, 15000000, 'shop',
     '{"shop":"smith"}', '[[-3.5,0,-3.5,3.5,3.6,3.5]]', 'shop_smith_v1', 'shop_smith_v1'),
    ('shop_clinic_v1', '药铺 v1', 'building', 8.0, 7.0, 3.4, 15000000, 'shop',
     '{"shop":"clinic"}', '[[-4.0,0,-3.5,4.0,3.4,3.5]]', 'shop_clinic_v1', 'shop_clinic_v1'),
    ('shop_post_v1', '邮局 v1', 'building', 7.0, 7.0, 3.5, 14000000, 'shop',
     '{"shop":"post"}', '[[-3.5,0,-3.5,3.5,3.5,3.5]]', 'shop_post_v1', 'shop_post_v1'),
    ('shop_bookstore_v1', '书店 v1', 'building', 10.0, 7.0, 3.4, 16000000, 'shop',
     '{"shop":"bookstore"}', '[[-5.0,0,-3.5,5.0,3.4,3.5]]', 'shop_bookstore_v1', 'shop_bookstore_v1'),
    ('shop_izakaya_v1', '居酒屋 v1', 'building', 8.0, 7.0, 3.5, 16000000, 'shop',
     '{"shop":"izakaya"}', '[[-4.0,0,-3.5,4.0,3.5,3.5]]', 'shop_izakaya_v1', 'shop_izakaya_v1'),
    ('shop_apartment_v1', '公寓 v1', 'building', 9.0, 9.0, 8.6, 22000000, 'house',
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
    ('teleport_v1', '传送阵 v1', 'function', 3.7, 3.7, 3.0, 2000000, 'teleport',
     '{}', '[[-1.85,0,-1.85,1.85,0.5,1.85]]', 'teleport_v1', ''),
)

# ★ C3（2026-10-22）：旧的 22 条通用目录（椅子/桌子/路灯/树/旧房子/旧店铺/hall/teleport）
#   已经被 FURNITURE_SEED + BUILDING_SEED 完全取代，没有任何布局或物件再引用它们。
#   这里不再播种；启动时顺手把老库里的 legacy_* / 旧 id 清掉（见 seed_catalog）。
CATALOG_SEED = ()

DEAD_CATALOG_IDS = (
    'chair', 'table', 'lamp', 'tree', 'flowerbed', 'bench', 'teleport',
    'house_flat', 'house_yard', 'house_villa',
    'shop_mart', 'shop_cafe', 'shop_ramen', 'shop_izakaya', 'shop_bakery',
    'shop_clinic', 'shop_tea', 'shop_flower', 'shop_general', 'shop_dessert',
    'hall',
)


def seed_catalog(cfg):
    now = now_ms()
    with dbmod.db(cfg) as c:
        # legacy generic entries
        for (cid, name, cat, w, d, h, price, fn, fj, cj) in CATALOG_SEED:
            c.execute('INSERT OR IGNORE INTO town_catalog'
                      '(id,name,category,size_w,size_d,height,price,function_type,'
                      'function_json,collision_json,enabled,sort,updated_at)'
                      ' VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?)',
                      (cid, name, cat, w, d, h, int(price), fn, fj, cj,
                       int(price // 1000000), now))
        # real furniture pieces (v4.1)
        for (cid, name, cat, w, d, h, price, fn, fj, cj,
             mid, pmode, movable) in FURNITURE_SEED:
            c.execute('INSERT OR IGNORE INTO town_catalog'
                      '(id,name,category,size_w,size_d,height,price,function_type,'
                      'function_json,collision_json,enabled,sort,updated_at,'
                      'model_id,model_version,layout_json,place_mode,movable)'
                      ' VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?)',
                      (cid, name, cat, w, d, h, int(price), fn, fj, cj,
                       int(price // 1000000), now, mid, 'v1', '{}', pmode, movable))
        # buildings: bind model + default furniture layout
        for (cid, name, cat, w, d, h, price, fn, fj, cj, mid, lk) in BUILDING_SEED:
            layout = LAYOUTS.get(lk, {})
            c.execute('INSERT OR IGNORE INTO town_catalog'
                      '(id,name,category,size_w,size_d,height,price,function_type,'
                      'function_json,collision_json,enabled,sort,updated_at,'
                      'model_id,model_version,layout_json,place_mode,movable)'
                      ' VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?)',
                      (cid, name, cat, w, d, h, int(price), fn, fj, cj,
                       int(price // 1000000), now, mid, 'v1',
                       json.dumps(layout, ensure_ascii=False), 'grid', 0))
        # ★ C3：清掉旧的通用目录 / legacy_*（没有物件引用它们）
        c.execute("DELETE FROM town_catalog WHERE id LIKE 'legacy\\_%' ESCAPE '\\'")
        qmarks = ','.join('?' * len(DEAD_CATALOG_IDS))
        c.execute('DELETE FROM town_catalog WHERE id IN (%s)' % qmarks, DEAD_CATALOG_IDS)
        # ★ C2：布局是代码里的默认值，改了要覆盖旧行（价格是后台改的 ✗ 不能碰）
        for (cid, name, cat, w, d, h, price, fn, fj, cj, mid, lk) in BUILDING_SEED:
            layout = json.dumps(LAYOUTS.get(lk, {}), ensure_ascii=False)
            c.execute('UPDATE town_catalog SET layout_json=? WHERE id=? AND layout_json<>?',
                      (layout, cid, layout))
        c.commit()


def ensure_system_town(cfg):
    """The starter town row.  It owns the original 500x500 safe area."""
    with dbmod.db(cfg) as c:
        r = c.execute('SELECT * FROM towns WHERE is_system=1 LIMIT 1').fetchone()
        if r:
            return _row(r)
        cur = c.execute(
            'INSERT INTO towns(owner_id,name,tier,size_m,x,z,status,is_system,'
            'auto_pay,created_at,expires_at,last_fee_at,original_x,original_z,'
            'deleted_at,updated_at)'
            ' VALUES(0,?,30,500,0,0,?,1,0,?,0,0,0,0,0,?)',
            (SYSTEM_NAME, 'active', now_ms(), now_ms()))
        c.commit()
        rid = int(cur.lastrowid)
        c.execute('INSERT OR REPLACE INTO town_perms(town_id,player_id,mask,granted_by,granted_at)'
                  ' VALUES(?,0,?,0,?)', (rid, P_ALL, now_ms()))
        c.commit()
        return _row(c.execute('SELECT * FROM towns WHERE id=?', (rid,)).fetchone())


def _overlap_with_any(cfg, tier, x, z, exclude_id=0):
    size = size_m(tier)
    me = bounds(x, z, size)
    with dbmod.db(cfg) as c:
        rows = c.execute(
            "SELECT * FROM towns WHERE status IN ('active','restoring')"
            ' AND id<>?', (int(exclude_id or 0),)).fetchall()
    for r in rows:
        if not _rect_gap_ok(me, bounds_of(r), GAP_M):
            return _row(r)
    return None


def validate_name(name):
    s = (name or '').strip()
    if len(s) < 2 or len(s) > 12:
        return None, '名字需要 2~12 个字'
    if any(ch.isspace() for ch in s):
        return None, '名字不能有空格'
    return s, ''


def create_town(cfg, owner_id, name, tier, x, z, now=None):
    """Create a player town. Gold is charged by the caller.

    Returns (ok, error, town_row).
    """
    if not valid_tier(tier):
        return False, '不支持的尺寸', None
    tier = int(tier)
    size = size_m(tier)
    nm, err = validate_name(name)
    if not nm:
        return False, err, None
    if get_by_owner(cfg, owner_id):
        return False, '每人只能拥有一座小镇', None
    clash = _overlap_with_any(cfg, tier, float(x), float(z), 0)
    if clash:
        return False, '距离其它小镇不足 50 格', None
    now = now_ms() if now is None else int(now)
    # 首日费用按"当天 00:00 到期"算（用户确认：建镇/恢复都这样）
    expires = next_due_ms(now / 1000.0)
    try:
        with dbmod.db(cfg) as c:
            cur = c.execute(
                'INSERT INTO towns(owner_id,name,tier,size_m,x,z,status,is_system,'
                'auto_pay,created_at,expires_at,last_fee_at,original_x,original_z,'
                'deleted_at,updated_at)'
                ' VALUES(?,?,?,?,?,?,?,0,1,?,?,?,?,?,0,?)',
                (int(owner_id), nm, tier, size, float(x), float(z), 'active',
                 now, expires, now, float(x), float(z), now))
            rid = int(cur.lastrowid)
            c.execute('INSERT OR REPLACE INTO town_perms(town_id,player_id,mask,granted_by,granted_at)'
                      ' VALUES(?,?,?,?,?)',
                      (rid, int(owner_id), P_ALL, int(owner_id), now))
            c.commit()
    except sqlite3.IntegrityError:
        return False, '小镇名字已存在', None
    except Exception as e:
        return False, '创建失败：%s' % e, None
    return True, '', get_town(cfg, rid)


def freeze_town(cfg, town_id, reason='expired'):
    now = now_ms()
    with dbmod.db(cfg) as c:
        r = c.execute('SELECT * FROM towns WHERE id=?', (int(town_id),)).fetchone()
        if not r:
            return False
        c.execute('UPDATE towns SET status=?, original_x=x, original_z=z,'
                  ' deleted_at=?, updated_at=? WHERE id=?',
                  ('frozen', now + RETENTION_DAYS * DAY_MS, now, int(town_id)))
        c.commit()
    return True


def restore_town(cfg, town_id, x, z, paid_until=None):
    """Restore a frozen town, preferring original coords when free."""
    t = get_town(cfg, town_id)
    if not t:
        return False, '没有这个小镇', None
    if t['status'] not in ('frozen', 'restoring'):
        return False, '小镇不在冻结状态', None
    tier = int(t['tier'])
    nx, nz = float(x), float(z)
    if _overlap_with_any(cfg, tier, nx, nz, town_id):
        ox, oz = float(t['original_x']), float(t['original_z'])
        if _overlap_with_any(cfg, tier, ox, oz, town_id):
            return False, '原坐标已被占用，请选择新坐标', None
        nx, nz = ox, oz
    now = now_ms()
    paid = int(paid_until or (now + DAY_MS))
    with dbmod.db(cfg) as c:
        c.execute('UPDATE towns SET x=?, z=?, status=?, deleted_at=0,'
                  ' expires_at=?, last_fee_at=?, updated_at=? WHERE id=?',
                  (nx, nz, 'active', paid, now, now, int(town_id)))
        c.commit()
    return True, '', get_town(cfg, town_id)


def dissolve_town(cfg, town_id):
    """Owner voluntarily dissolves: same 7-day frozen retention."""
    return freeze_town(cfg, town_id, 'dissolved')


def charge_offline(cfg, owner_id, amount):
    """离线扣费：只在余额够的时候扣（原子），返回是否成功。

    ★ 在线玩家不走这里：金币以内存为准 ✓ 走 World 的 p.gold ✓
    """
    amount = max(0, int(amount))
    if amount <= 0:
        return True
    with dbmod.db(cfg) as c:
        cur = c.execute('UPDATE roles SET gold=gold-? WHERE id=? AND gold>=?',
                        (amount, int(owner_id), amount))
        c.commit()
        return cur.rowcount > 0


def purge_expired(cfg):
    """Delete frozen towns whose 7-day window ended."""
    now = now_ms()
    deleted = []
    with dbmod.db(cfg) as c:
        rows = c.execute('SELECT id FROM towns WHERE status=? AND deleted_at>0'
                         ' AND deleted_at<=?', ('frozen', now)).fetchall()
        for r in rows:
            tid = int(r[0])
            c.execute('DELETE FROM town_perms WHERE town_id=?', (tid,))
            c.execute('DELETE FROM town_objects WHERE town_id=?', (tid,))
            c.execute('DELETE FROM town_ground WHERE town_id=?', (tid,))
            c.execute('DELETE FROM towns WHERE id=?', (tid,))
            deleted.append(tid)
        c.commit()
    return deleted


def add_ledger(cfg, town_id, owner_id, kind, gross, ref=''):
    gross = max(0, int(gross))
    owner_gain = int(gross * 0.8)
    tax = gross - owner_gain
    with dbmod.db(cfg) as c:
        c.execute('INSERT INTO town_ledger(town_id,owner_id,kind,gross,owner_gain,tax,ref,ts)'
                  ' VALUES(?,?,?,?,?,?,?,?)',
                  (int(town_id), int(owner_id), str(kind), gross, owner_gain, tax,
                   str(ref), now_ms()))
        c.commit()
    return owner_gain, tax


def list_catalog(cfg, enabled_only=True):
    q = 'SELECT * FROM town_catalog'
    if enabled_only:
        q += ' WHERE enabled=1'
    q += ' ORDER BY sort, id'
    with dbmod.db(cfg) as c:
        return [_row(r) for r in c.execute(q).fetchall()]


def object_count(cfg, town_id):
    with dbmod.db(cfg) as c:
        r = c.execute("SELECT COUNT(*) FROM town_objects WHERE town_id=? AND state='active'",
                      (int(town_id),)).fetchone()
    return int(r[0] or 0) if r else 0


def object_limit(tier):
    return OBJ_LIMITS.get(int(tier), OBJ_LIMITS[30])


def add_audit(cfg, admin_id, action, target='', detail='{}'):
    with dbmod.db(cfg) as c:
        c.execute('INSERT INTO town_audit(admin_id,action,target,detail,ts) VALUES(?,?,?,?,?)',
                  (int(admin_id or 0), str(action), str(target), str(detail), now_ms()))
        c.commit()


def load_perms(cfg):
    out = {}
    try:
        with dbmod.db(cfg) as c:
            for r in c.execute('SELECT town_id,player_id,mask FROM town_perms').fetchall():
                out[(int(r['town_id']), int(r['player_id']))] = int(r['mask'] or 0)
    except Exception:
        pass
    return out


def gap_ok_rows(rows, tier, x, z, exclude_id=0):
    size = size_m(tier)
    me = bounds(x, z, size)
    for r in rows:
        if int(r.get('id') or 0) == int(exclude_id or 0):
            continue
        if str(r.get('status') or '') not in ('active', 'restoring'):
            continue
        if not _rect_gap_ok(me, bounds_of(r), GAP_M):
            return False
    return True


def public_row(r):
    if not r:
        return None
    return {
        'id': int(r['id']), 'owner': int(r['owner_id'] or 0),
        'name': r['name'], 'tier': int(r['tier']),
        'size': float(r['size_m']), 'x': float(r['x']), 'z': float(r['z']),
        'status': r['status'], 'system': int(r['is_system'] or 0),
        'fee': 0 if int(r['is_system'] or 0) else fee_for(int(r['tier'])),
        'expires': int(r['expires_at'] or 0),
        'auto': int(r['auto_pay'] or 0),
        'objects': 0,
    }
