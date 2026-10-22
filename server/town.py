# -*- coding: utf-8 -*-
"""新手小镇 · 日式街角微缩镇（70×70）

★★ 这里是【唯一数据源】 ★★
  · 服务端：碰撞 solid_boxes() / 椅子 near_seat() / 仓库柜台
  · 客户端：tools/gen_town_data.py 把同一份数据导出到 web/core/town_data.js
    → 建筑、道具、椅子的碰撞箱【不可能】再对不上 ✓

坐标：中心 (0,0)，可行走区域 x/z = -35..35，围墙在 ±34，四门各宽 7。
"""

TOWN_HALF = 250.0
TOWN_EDGE = 249.0
# 小镇实际中心（左下角 / 西南）。以后往东北扩建。
TOWN_CX = -130.0
TOWN_CZ = 130.0
SPAWN = (-130.0, 143.0)
GATE_HALF = 4.0
WALL_T = 0.38
SEAT_R = 1.9              # 靠近椅子多近能坐下
SEAT_USE_R = 2.3          # 服务端校验坐下的最大距离
WAREHOUSE_COUNTER = (13.1, 17.0)
WAREHOUSE_R = 2.8

# 路面（只影响画面，不参与碰撞）
PLAZA = dict(x0=-9.0, z0=-9.0, x1=9.0, z1=9.0)
ROADS = [
    # 小镇内部主街
    dict(id='c1', name='中央大道', x0=-250.0, z0=126.0, x1=-18.0, z1=134.0, axis='x'),
    dict(id='c2', name='北街', x0=-232.0, z0=88.0, x1=-38.0, z1=94.0, axis='x'),
    dict(id='c3', name='南街', x0=-232.0, z0=166.0, x1=-38.0, z1=172.0, axis='x'),
    dict(id='c4', name='西街', x0=-224.0, z0=46.0, x1=-218.0, z1=212.0, axis='z'),
    dict(id='c5', name='东街', x0=-44.0, z0=46.0, x1=-38.0, z1=212.0, axis='z'),
    # 核心环街
    dict(id='r1', name='中心北街', x0=-170.0, z0=92.0, x1=-90.0, z1=98.0, axis='x'),
    dict(id='r2', name='中心南街', x0=-170.0, z0=162.0, x1=-90.0, z1=168.0, axis='x'),
    dict(id='r3', name='中心西街', x0=-170.0, z0=92.0, x1=-164.0, z1=168.0, axis='z'),
    dict(id='r4', name='中心东街', x0=-96.0, z0=92.0, x1=-90.0, z1=168.0, axis='z'),
    # 住宅联络街
    dict(id='v1', name='别墅北街', x0=-232.0, z0=48.0, x1=-168.0, z1=54.0, axis='x'),
    dict(id='v2', name='别墅西街', x0=-238.0, z0=48.0, x1=-232.0, z1=100.0, axis='z'),
    dict(id='v3', name='别墅东街', x0=-174.0, z0=48.0, x1=-168.0, z1=100.0, axis='z'),
    dict(id='y1', name='小院街', x0=-232.0, z0=212.0, x1=-168.0, z1=218.0, axis='x'),
    dict(id='y2', name='小院西街', x0=-238.0, z0=166.0, x1=-232.0, z1=218.0, axis='z'),
    dict(id='y3', name='小院东街', x0=-174.0, z0=166.0, x1=-168.0, z1=218.0, axis='z'),
    dict(id='f1', name='小楼街', x0=-96.0, z0=212.0, x1=-24.0, z1=218.0, axis='x'),
    dict(id='f2', name='小楼西街', x0=-102.0, z0=166.0, x1=-96.0, z1=218.0, axis='z'),
    dict(id='f3', name='小楼东街', x0=-30.0, z0=166.0, x1=-24.0, z1=218.0, axis='z'),
    dict(id='m1', name='市集街', x0=-170.0, z0=224.0, x1=-90.0, z1=230.0, axis='x'),
    dict(id='g1', name='环城连接路', x0=-130.0, z0=0.0, x1=-122.0, z1=48.0, axis='z'),
    dict(id='g2', name='东环连接路', x0=-130.0, z0=218.0, x1=-122.0, z1=250.0, axis='z'),
    dict(id='g3', name='南环连接路', x0=-250.0, z0=130.0, x1=-244.0, z1=138.0, axis='x'),
    dict(id='g4', name='东环连接路', x0=-14.0, z0=130.0, x1=-8.0, z1=138.0, axis='x'),
]

# 传送点（500×500）
TELEPORTS = [
    dict(id='plaza', name='中央广场', x=-130.0, z=137.0),
    dict(id='gate_n', name='北门', x=0.0, z=-246.0),
    dict(id='gate_s', name='南门', x=0.0, z=246.0),
    dict(id='gate_w', name='西门', x=-246.0, z=0.0),
    dict(id='gate_e', name='东门', x=246.0, z=0.0),
    dict(id='villa', name='别墅区', x=-196.0, z=100.0),
    dict(id='courtyard', name='小院区', x=-196.0, z=166.0),
    dict(id='lowrise', name='小平楼区', x=-64.0, z=166.0),
    dict(id='commercial', name='商业街', x=-110.0, z=148.0),
    dict(id='park', name='中央公园', x=-210.0, z=120.0),
    dict(id='market', name='市集', x=-130.0, z=224.0),
]

# 建筑：k 决定外观/室内，style 决定配色与细节
BUILDINGS = [
    dict(k='warehouse', name='仓库', x0=11, x1=24, z0=12, z1=23, door='west', door_at=17.0,
         floors=1, style='ware', wall=0xe2d3b6, accent=0xa8793f, roof=0x3f5850, sign='仓 库'),
    dict(k='smith', name='铁匠铺', x0=26, x1=33, z0=11, z1=18, door='west', door_at=14.5,
         floors=1, style='wood', wall=0xb59c80, accent=0xb4542f, roof=0x4a352c, sign='铁 匠 铺'),
    dict(k='bathhouse', name='澡堂', x0=20, x1=28, z0=4, z1=10, door='west', door_at=7.5,
         floors=1, style='wood', wall=0xe0cfb4, accent=0x3e6f7a, roof=0x35504f, sign='汤'),
    dict(k='hall', name='新手大厅', x0=-8, x1=8, z0=-33, z1=-24, door='south', door_at=0.0,
         floors=1, style='hall', wall=0xe6d8be, accent=0x3e5968, roof=0x33473f, sign='新手大厅'),
    dict(k='clinic', name='药铺', x0=-20, x1=-12, z0=-32, z1=-25, door='south', door_at=-16.0,
         floors=1, style='machiya', wall=0xe6d8be, accent=0x5c6b46, roof=0x3f5148, sign='药 铺'),
    dict(k='post', name='邮局', x0=12, x1=19, z0=-31, z1=-24, door='south', door_at=15.5,
         floors=1, style='brick', wall=0xd6b696, accent=0x8d3f36, roof=0x4a4438, sign='邮 局'),
    dict(k='inn', name='旅店', x0=21, x1=32, z0=-32, z1=-23, door='west', door_at=-27.5,
         floors=1, style='inn', wall=0xe0d1b3, accent=0x7c3e3b, roof=0x3a3f3c, sign='旅 店'),
    dict(k='bookstore', name='书店', x0=-33, x1=-23, z0=-20, z1=-13, door='east', door_at=-16.5,
         floors=1, style='machiya', wall=0xddcfb4, accent=0x3e5968, roof=0x3f5450, sign='书 店'),
    dict(k='tea', name='茶馆', x0=-20, x1=-12, z0=-20, z1=-13, door='east', door_at=-16.5,
         floors=1, style='machiya', wall=0xe6d8bc, accent=0x5c6b46, roof=0x3d4f43, sign='茶'),
    dict(k='izakaya', name='居酒屋', x0=25, x1=33, z0=-21, z1=-14, door='west', door_at=-17.5,
         floors=1, style='wood', wall=0xb98a60, accent=0xc0392b, roof=0x4b2f28, sign='居酒屋'),
    dict(k='koban', name='警亭', x0=12, x1=18, z0=-22, z1=-17, door='west', door_at=-19.5,
         floors=1, style='brick', wall=0xddd6c6, accent=0x3e5968, roof=0x3f4a42, sign='交 番'),
    dict(k='mart', name='便利店', x0=-21, x1=-10, z0=-10, z1=-4, door='east', door_at=-7.0,
         floors=1, style='mart', wall=0xf2eee4, accent=0x4fae6f, roof=0x3f5a4a, sign='便利店'),
    dict(k='bakery', name='面包店', x0=-33, x1=-23, z0=-10, z1=-4, door='south', door_at=-28.0,
         floors=1, style='machiya', wall=0xecdfc7, accent=0xb4542f, roof=0x4f3b2e, sign='面包'),
    dict(k='cafe', name='咖啡店', x0=-21, x1=-12, z0=4, z1=10, door='east', door_at=7.0,
         floors=1, style='western', wall=0xe6d3b6, accent=0x6b4d34, roof=0x3f3a34, sign='CAFE'),
    dict(k='flower', name='花店', x0=-33, x1=-25, z0=4, z1=10, door='east', door_at=7.0,
         floors=1, style='green', wall=0xe2d7be, accent=0x5c8a52, roof=0x3d5245, sign='花 店'),
    dict(k='ramen', name='面馆', x0=10, x1=18, z0=-9, z1=-3, door='west', door_at=-6.0,
         floors=1, style='wood', wall=0xb0855a, accent=0xc0392b, roof=0x4a2f28, sign='拉 面'),
    dict(k='dessert', name='甜品店', x0=20, x1=27, z0=-9, z1=-3, door='west', door_at=-6.0,
         floors=1, style='western', wall=0xf0dac0, accent=0xc06a8a, roof=0x4a3a30, sign='甜品'),
    dict(k='general', name='杂货铺', x0=10, x1=17, z0=4, z1=10, door='west', door_at=7.0,
         floors=1, style='machiya', wall=0xddcfb4, accent=0x8a6a42, roof=0x46503f, sign='杂货'),
    dict(k='home_a', name='民居A', x0=-33, x1=-25, z0=12, z1=19, door='east', door_at=15.5,
         floors=1, style='home', wall=0xddcfb4, accent=0x5c6b46, roof=0x4a3b30, sign=''),
    dict(k='home_b', name='民居B', x0=-21, x1=-13, z0=12, z1=19, door='east', door_at=15.5,
         floors=1, style='home', wall=0xd6c7aa, accent=0x3e5968, roof=0x3c4a4a, sign=''),
    dict(k='home_c', name='民居C', x0=-33, x1=-25, z0=22, z1=29, door='east', door_at=25.5,
         floors=1, style='home', wall=0xe0d1b4, accent=0x7c3e3b, roof=0x444f3f, sign=''),
    dict(k='apartment', name='公寓', x0=-21, x1=-12, z0=22, z1=31, door='east', door_at=26.5,
         floors=1, style='apartment', wall=0xe2d4bc, accent=0x3e5968, roof=0x3b474d, sign='公寓'),
    dict(k='home_d', name='民居D', x0=11, x1=19, z0=25, z1=31, door='west', door_at=28.0,
         floors=1, style='home', wall=0xddcfb4, accent=0x8a6a42, roof=0x4a3b30, sign=''),
]

# 12 套可交易住宅（三档）
HOUSES = [
    dict(id='villa_1', tier='villa', k='villa', name='云顶别墅', x0=-190, x1=-172, z0=-190, z1=-174,
         door='east', door_at=-182, floors=2, style='villa', wall=0xe2d4bc, accent=0x3e5968,
         roof=0x3b474d, price_day=200000),
    dict(id='villa_2', tier='villa', k='villa', name='松风别墅', x0=-160, x1=-142, z0=-190, z1=-174,
         door='east', door_at=-182, floors=2, style='villa', wall=0xdfd1b8, accent=0x7c3e3b,
         roof=0x414f48, price_day=200000),
    dict(id='villa_3', tier='villa', k='villa', name='月见别墅', x0=-190, x1=-172, z0=-160, z1=-144,
         door='east', door_at=-152, floors=2, style='villa', wall=0xe6d8c0, accent=0x5c6b46,
         roof=0x4a443c, price_day=200000),
    dict(id='villa_4', tier='villa', k='villa', name='星野别墅', x0=-160, x1=-142, z0=-160, z1=-144,
         door='east', door_at=-152, floors=2, style='villa', wall=0xdccdb2, accent=0x3e5968,
         roof=0x3f5850, price_day=200000),
    dict(id='yard_1', tier='yard', k='yard', name='青竹小院', x0=-190, x1=-176, z0=136, z1=150,
         door='east', door_at=143, floors=1, style='yard', wall=0xe0d1b4, accent=0x5c6b46,
         roof=0x46564a, price_day=100000),
    dict(id='yard_2', tier='yard', k='yard', name='听雨小院', x0=-160, x1=-146, z0=136, z1=150,
         door='east', door_at=143, floors=1, style='yard', wall=0xd8c9ad, accent=0x7c3e3b,
         roof=0x4a3b32, price_day=100000),
    dict(id='yard_3', tier='yard', k='yard', name='花间小院', x0=-190, x1=-176, z0=160, z1=174,
         door='east', door_at=167, floors=1, style='yard', wall=0xe4d6ba, accent=0x5c6b46,
         roof=0x46524a, price_day=100000),
    dict(id='yard_4', tier='yard', k='yard', name='晚风小院', x0=-160, x1=-146, z0=160, z1=174,
         door='east', door_at=167, floors=1, style='yard', wall=0xdccdb2, accent=0x3e5968,
         roof=0x4a554a, price_day=100000),
    dict(id='flat_1', tier='flat', k='flat', name='临街小楼', x0=136, x1=148, z0=136, z1=150,
         door='west', door_at=143, floors=1, style='flat', wall=0xded0b8, accent=0x3e5968,
         roof=0x3b474d, price_day=60000),
    dict(id='flat_2', tier='flat', k='flat', name='暖阳小楼', x0=160, x1=172, z0=136, z1=150,
         door='west', door_at=143, floors=1, style='flat', wall=0xe2d4bc, accent=0x8a6a42,
         roof=0x4a554a, price_day=60000),
    dict(id='flat_3', tier='flat', k='flat', name='转角小楼', x0=136, x1=148, z0=160, z1=174,
         door='west', door_at=167, floors=1, style='flat', wall=0xdccdb2, accent=0x5c6b46,
         roof=0x46524a, price_day=60000),
    dict(id='flat_4', tier='flat', k='flat', name='灯火小楼', x0=160, x1=172, z0=160, z1=174,
         door='west', door_at=167, floors=1, style='flat', wall=0xe0d1b4, accent=0x7c3e3b,
         roof=0x414f48, price_day=60000),
]

# 长椅/椅子：k = chair|stool|bench|sofa，y = 坐面高度
SEATS = [
    # 广场四角长椅（面朝喷泉）
    dict(id='plaza_sw', k='bench', x=-6.2, z=6.2, ry=0.785, y=0.30, label='长椅'),
    dict(id='plaza_se', k='bench', x=6.2, z=6.2, ry=-0.785, y=0.30, label='长椅'),
    dict(id='plaza_nw', k='bench', x=-6.2, z=-6.2, ry=2.356, y=0.30, label='长椅'),
    dict(id='plaza_ne', k='bench', x=6.2, z=-6.2, ry=-2.356, y=0.30, label='长椅'),
    # 咖啡店露台：两桌四椅
    dict(id='cafe_w1', k='chair', x=-11.05, z=5.2, ry=1.571, y=0.30, label='椅子'),
    dict(id='cafe_e1', k='chair', x=-9.45, z=5.2, ry=-1.571, y=0.30, label='椅子'),
    dict(id='cafe_w2', k='chair', x=-11.05, z=8.1, ry=1.571, y=0.30, label='椅子'),
    dict(id='cafe_e2', k='chair', x=-9.45, z=8.1, ry=-1.571, y=0.30, label='椅子'),
    # 面馆门口三张高脚凳
    dict(id='ramen_1', k='stool', x=9.35, z=-8.2, ry=-1.571, y=0.34, label='高脚凳'),
    dict(id='ramen_2', k='stool', x=9.35, z=-6.7, ry=-1.571, y=0.34, label='高脚凳'),
    dict(id='ramen_3', k='stool', x=9.35, z=-5.2, ry=-1.571, y=0.34, label='高脚凳'),
    # 甜品店门口
    dict(id='dessert_1', k='chair', x=19.35, z=-8.4, ry=-1.571, y=0.30, label='椅子'),
    dict(id='dessert_2', k='chair', x=19.35, z=-6.6, ry=-1.571, y=0.30, label='椅子'),
    # 茶馆檐下
    dict(id='tea_1', k='chair', x=-11.35, z=-19.2, ry=-1.571, y=0.30, label='椅子'),
    dict(id='tea_2', k='chair', x=-11.35, z=-14.4, ry=-1.571, y=0.30, label='椅子'),
    # 居酒屋门口长凳
    dict(id='izakaya_bench', k='bench', x=24.15, z=-19.6, ry=-1.571, y=0.30, label='长凳'),
    # 旅店门口
    dict(id='inn_bench', k='bench', x=20.15, z=-24.2, ry=-1.571, y=0.30, label='长凳'),
    # 大厅门口两侧
    dict(id='hall_bench_w', k='bench', x=-6.4, z=-22.6, ry=3.142, y=0.30, label='长椅'),
    dict(id='hall_bench_e', k='bench', x=6.4, z=-22.6, ry=3.142, y=0.30, label='长椅'),
    # 诊所候诊
    dict(id='clinic_wait_1', k='chair', x=-19.5, z=-24.0, ry=3.142, y=0.30, label='候诊椅'),
    dict(id='clinic_wait_2', k='chair', x=-18.1, z=-24.0, ry=3.142, y=0.30, label='候诊椅'),
    # 书店门口
    dict(id='book_bench', k='bench', x=-22.35, z=-14.3, ry=1.571, y=0.30, label='长椅'),
    # 公交站
    dict(id='bus_bench', k='bench', x=-7.6, z=12.2, ry=0.0, y=0.30, label='候车长椅'),
    # 澡堂门口
    dict(id='bath_bench', k='bench', x=19.35, z=4.8, ry=-1.571, y=0.30, label='长凳'),
    # 公寓门口
    dict(id='apt_bench', k='bench', x=-11.35, z=25.8, ry=-1.571, y=0.30, label='长椅'),
    # 室内：旅店大堂 / 面馆吧台 / 咖啡店内
    dict(id='inn_lobby_1', k='sofa', x=23.0, z=-24.6, ry=0.0, y=0.30, label='沙发'),
    dict(id='inn_lobby_2', k='chair', x=26.0, z=-24.7, ry=3.142, y=0.30, label='椅子'),
    dict(id='ramen_counter_1', k='stool', x=15.4, z=-6.2, ry=1.571, y=0.34, label='吧台凳'),
    dict(id='ramen_counter_2', k='stool', x=15.4, z=-5.2, ry=1.571, y=0.34, label='吧台凳'),
    dict(id='cafe_in_1', k='chair', x=-15.2, z=6.2, ry=-1.571, y=0.30, label='椅子'),
    dict(id='cafe_in_2', k='chair', x=-15.2, z=8.0, ry=-1.571, y=0.30, label='椅子'),
]

# 街景道具
# k = 造型；ry = 朝向；v = 变体（树/灯笼颜色）；s = 尺寸
PROPS = [
    # ---- 广场四角 ----
    dict(k='tree', x=-8.4, z=-8.4, v='sakura', s=1.35),
    dict(k='tree', x=8.4, z=-11.0, v='green', s=1.05),
    dict(k='tree', x=-4.9, z=9.8, v='green', s=1.05),
    dict(k='tree', x=8.4, z=11.0, v='sakura', s=0.95),
    dict(k='planter', x=-8.4, z=6.0, ry=0.0),
    dict(k='planter', x=8.4, z=6.0, ry=0.0),
    dict(k='planter', x=-8.4, z=-2.6, ry=0.0),
    dict(k='planter', x=8.4, z=-2.6, ry=0.0),
    dict(k='lamp', x=-10.6, z=-10.6, ry=0.785),
    dict(k='lamp', x=10.6, z=-10.6, ry=-0.785),
    dict(k='lamp', x=-10.6, z=10.6, ry=2.356),
    dict(k='lamp', x=10.6, z=10.6, ry=-2.356),
    # 广场北侧市集摊
    dict(k='stall', x=-8.2, z=-12.2, ry=0.0, v='fruit'),
    dict(k='stall', x=8.2, z=-12.2, ry=0.0, v='fish'),
    dict(k='crate', x=-10.4, z=-13.4, ry=0.2),
    dict(k='barrel', x=10.2, z=-13.2, ry=0.0),
    # 广场设施
    dict(k='notice', x=-9.0, z=-1.8, ry=1.571),
    dict(k='postbox', x=7.8, z=10.6, ry=0.0),
    dict(k='hydrant', x=-9.9, z=7.0, ry=0.0),
    dict(k='bike_rack', x=-9.55, z=-12.2, ry=1.571),
    dict(k='bike', x=-9.55, z=-12.5, ry=0.0, v='blue'),
    dict(k='bike', x=-9.55, z=-11.7, ry=0.0, v='red'),
    dict(k='busstop', x=-7.6, z=13.4, ry=0.0),
    # ---- 西街 ----
    dict(k='table', x=-10.25, z=5.2, ry=0.0),
    dict(k='table', x=-10.25, z=8.1, ry=0.0),
    dict(k='parasol', x=-10.25, z=5.2, ry=0.0, v='cream'),
    dict(k='parasol', x=-10.25, z=8.1, ry=0.0, v='cream'),
    dict(k='vending', x=-19.4, z=-10.8, ry=0.0, v='green'),
    dict(k='vending', x=-17.6, z=-10.8, ry=0.0, v='red'),
    dict(k='bin', x=-22.2, z=-9.0, ry=0.0, v='green'),
    dict(k='bin', x=-22.2, z=-8.1, ry=0.0, v='gray'),
    dict(k='bike', x=-22.55, z=-5.0, ry=0.0, v='silver'),
    dict(k='menu', x=-22.35, z=-7.6, ry=0.0),
    dict(k='pot', x=-31.8, z=-3.1, ry=0.0),
    dict(k='pot', x=-30.9, z=-3.1, ry=0.0),
    dict(k='pot', x=-24.0, z=4.4, ry=0.0),
    dict(k='pot', x=-24.5, z=4.3, ry=0.0),
    dict(k='flowerstand', x=-24.5, z=4.6, ry=1.571),
    dict(k='flowerstand', x=-24.5, z=8.7, ry=1.571),
    dict(k='flowerstand', x=-24.5, z=9.3, ry=1.571),
    dict(k='lamp', x=-13.0, z=-11.4, ry=0.0),
    dict(k='lamp', x=-13.0, z=11.4, ry=0.0),
    # ---- 东街 ----
    dict(k='lamp', x=13.0, z=-11.4, ry=0.0),
    dict(k='lamp', x=13.0, z=11.4, ry=0.0),
    dict(k='vending', x=19.3, z=11.1, ry=3.142, v='blue'),
    dict(k='bin', x=9.0, z=-2.0, ry=0.0, v='gray'),
    dict(k='crate', x=9.2, z=5.0, ry=0.2, v='general'),
    dict(k='crate', x=9.2, z=5.9, ry=-0.2, v='general'),
    dict(k='handcart', x=8.2, z=10.6, ry=1.2),
    dict(k='menu', x=19.0, z=-2.8, ry=0.0),
    dict(k='pot', x=19.4, z=10.4, ry=0.0),
    dict(k='pot', x=18.6, z=10.4, ry=0.0),
    # ---- 北街 / 大厅 ----
    dict(k='statue', x=-3.4, z=-22.8, ry=0.0),
    dict(k='statue', x=3.4, z=-22.8, ry=0.0),
    dict(k='notice', x=9.2, z=-22.6, ry=1.571),
    dict(k='bike', x=8.8, z=-20.2, ry=0.4, v='blue'),
    dict(k='pot', x=-10.8, z=-23.6, ry=0.0),
    dict(k='pot', x=10.6, z=-23.6, ry=0.0),
    # 神社,
    dict(k='tree', x=-31.6, z=-21.6, v='pine', s=1.05),
    dict(k='tree', x=-24.2, z=-21.4, v='sakura', s=0.95),
    # 邮局
    dict(k='postbox', x=19.8, z=-28.0, ry=0.0, v='red'),
    dict(k='bike', x=19.9, z=-22.6, ry=1.571, v='green'),
    # 旅店门口
    dict(k='lantern', x=20.2, z=-29.8, ry=0.0, v='red'),
    dict(k='lantern', x=20.2, z=-25.2, ry=0.0, v='red'),
    dict(k='menu', x=20.2, z=-26.8, ry=-1.571),
    # 居酒屋
    dict(k='barrel', x=24.2, z=-15.0, ry=0.0),
    dict(k='barrel', x=24.2, z=-14.3, ry=0.0),
    dict(k='lantern', x=24.3, z=-15.0, ry=0.0, v='red'),
    dict(k='menu', x=24.3, z=-13.8, ry=-1.571),
    # 警亭
    dict(k='notice', x=11.6, z=-16.0, ry=0.0),
    # ---- 南街 / 民居 ----
    dict(k='fence', x=-22.8, z=20.4, ry=0.0),
    dict(k='fence', x=-24.8, z=20.4, ry=0.0),
    dict(k='hedge', x=-27.4, z=10.7, ry=0.0),
    dict(k='hedge', x=-30.2, z=10.7, ry=0.0),
    dict(k='laundry', x=-28.8, z=10.9, ry=0.0),
    dict(k='tree', x=-22.6, z=10.4, v='green', s=0.85),
    dict(k='tree', x=-22.6, z=20.2, v='sakura', s=0.85),
    dict(k='pot', x=-24.2, z=14.0, ry=0.0),
    dict(k='pot', x=-24.2, z=17.0, ry=0.0),
    dict(k='pot', x=-12.2, z=14.0, ry=0.0),
    dict(k='pot', x=-12.2, z=17.5, ry=0.0),
    dict(k='bike', x=-11.2, z=20.4, ry=1.2, v='blue'),
    dict(k='mailbox', x=-24.3, z=12.4, ry=0.0),
    dict(k='mailbox', x=-12.2, z=12.4, ry=0.0),
    dict(k='mailbox', x=-24.3, z=22.6, ry=0.0),
    dict(k='tree', x=-33.0, z=20.6, v='green', s=0.8),
    dict(k='tree', x=-33.0, z=32.0, v='sakura', s=1.0),
    dict(k='tree', x=-11.4, z=32.2, v='green', s=0.95),
    dict(k='hedge', x=-11.6, z=31.6, ry=1.571),
    # 公寓
    dict(k='notice', x=-11.4, z=29.0, ry=-1.571),
    dict(k='pot', x=-11.4, z=23.6, ry=0.0),
    dict(k='pot', x=-21.8, z=23.4, ry=0.0),
    # ---- 东南：仓库 / 铁匠铺 ----
    dict(k='crate', x=10.0, z=13.6, ry=0.0, v='ware'),
    dict(k='crate', x=10.0, z=14.5, ry=0.4, v='ware'),
    dict(k='crate', x=10.0, z=21.4, ry=0.0, v='ware'),
    dict(k='crate', x=10.0, z=22.3, ry=-0.3, v='ware'),
    dict(k='barrel', x=10.0, z=19.0, ry=0.0),
    dict(k='barrel', x=10.0, z=19.9, ry=0.0),
    dict(k='handcart', x=7.2, z=17.0, ry=0.0),
    dict(k='lamp', x=9.4, z=11.4, ry=0.0),
    dict(k='lamp', x=25.0, z=19.6, ry=0.0),
    dict(k='anvil', x=24.4, z=12.6, ry=0.0),
    dict(k='coal', x=25.0, z=20.0, ry=0.0),
    dict(k='barrel', x=25.0, z=18.6, ry=0.0),
    dict(k='tree', x=-5.8, z=-14.6, v='green', s=1.0),
    dict(k='tree', x=5.8, z=-14.6, v='sakura', s=1.0),
    dict(k='tree', x=-5.8, z=14.6, v='sakura', s=1.0),
    dict(k='tree', x=5.8, z=14.6, v='green', s=1.0),
    dict(k='tree', x=-26.2, z=20.8, v='green', s=0.9),
    dict(k='tree', x=-22.8, z=30.8, v='sakura', s=0.9),
    dict(k='tree', x=25.2, z=20.4, v='green', s=0.95),
    dict(k='tree', x=33.0, z=22.4, v='sakura', s=0.9),
    # ---- 外围 / 树带 ----
    dict(k='tree', x=-18.0, z=33.2, v='green', s=1.0),
    dict(k='tree', x=22.0, z=33.0, v='sakura', s=1.0),
    dict(k='tree', x=33.2, z=-11.4, v='green', s=0.95),
    dict(k='tree', x=-33.2, z=-11.4, v='green', s=0.9),
    dict(k='tree', x=33.2, z=30.0, v='green', s=0.95),
    dict(k='hedge', x=6.5, z=33.4, ry=0.0),
    dict(k='hedge', x=9.2, z=33.4, ry=0.0),
    dict(k='fence', x=10.4, z=31.2, ry=0.0),
    dict(k='fence', x=12.2, z=31.2, ry=0.0),
    dict(k='hedge', x=-33.4, z=6.0, ry=1.571),
    dict(k='hedge', x=-33.4, z=-6.5, ry=1.571),
]

# 电线杆（自动连线）
POLES = [
    dict(x=-7.8, z=14.0), dict(x=7.8, z=14.0),
    dict(x=-7.8, z=-15.0), dict(x=7.8, z=-15.0),
    dict(x=-22.0, z=-3.0), dict(x=22.0, z=-3.0),
    dict(x=18.0, z=24.0), dict(x=-18.0, z=24.0),
]

# 道具碰撞footprint（宽 x、深 z），按朝向旋转后取 AABB
PROP_FOOT = {
    'lamp': (0.30, 0.30), 'vending': (1.15, 0.85), 'bike': (0.45, 1.45),
    'bin': (0.46, 0.46), 'planter': (1.1, 0.62), 'tree': (0.62, 0.62),
    'crate': (0.86, 0.86), 'barrel': (0.64, 0.64), 'stall': (2.6, 1.4),
    'postbox': (0.5, 0.42), 'hydrant': (0.4, 0.4), 'notice': (1.75, 0.3),
    'stone_lantern': (0.62, 0.62), 'torii': (0.65, 0.65), 'lantern': (0.5, 0.5),
    'bike_rack': (1.9, 0.7), 'busstop': (2.6, 1.1), 'table': (0.9, 0.9),
    'parasol': (0.34, 0.34), 'menu': (0.55, 0.35), 'pot': (0.45, 0.45),
    'mailbox': (0.42, 0.36), 'fence': (1.8, 0.18), 'hedge': (1.75, 0.62),
    'laundry': (2.0, 0.4), 'statue': (0.72, 0.72), 'handcart': (0.95, 1.65),
    'anvil': (0.8, 0.55), 'coal': (1.1, 0.9), 'ema': (1.3, 0.3),
    'flowerstand': (0.8, 0.6), 'shrine_box': (1.2, 0.8), 'well': (1.4, 1.4),
}
NO_SOLID = {'petals', 'steam', 'cat', 'rope', 'lights', 'sign_paint', 'puddle', 'torii'}

_counter = None
_seats = None
_all = None


def in_town(x, z):
    return abs(x) <= TOWN_HALF and abs(z) <= TOWN_HALF


def near_warehouse(x, z):
    if not in_town(x, z):
        return False
    dx = x - WAREHOUSE_COUNTER[0]
    dz = z - WAREHOUSE_COUNTER[1]
    return dx * dx + dz * dz <= WAREHOUSE_R * WAREHOUSE_R


def _box(x0, z0, x1, z1, kind='misc'):
    # ★ 2026-10-22：第 5 位是来源（wall/building/house/prop/seat/misc），
    #   客户端按它决定哪些静态碰撞要跟着"静态渲染开关"一起关掉
    return ((x0 + x1) / 2.0, (z0 + z1) / 2.0, abs(x1 - x0) / 2.0,
            abs(z1 - z0) / 2.0, kind)


def _wall_boxes(b, kind='building'):
    x0, x1, z0, z1 = b['x0'], b['x1'], b['z0'], b['z1']
    side, at = b['door'], b['door_at']
    gap = 1.15
    t = WALL_T
    out = []
    for z in (z0, z1):
        if side in ('north', 'south') and ((z == z0 and side == 'north') or (z == z1 and side == 'south')):
            if at - gap > x0:
                out.append(_box(x0, z - t, at - gap, z + t, kind))
            if at + gap < x1:
                out.append(_box(at + gap, z - t, x1, z + t, kind))
        else:
            out.append(_box(x0, z - t, x1, z + t, kind))
    for x in (x0, x1):
        if side in ('east', 'west') and ((x == x0 and side == 'west') or (x == x1 and side == 'east')):
            if at - gap > z0:
                out.append(_box(x - t, z0, x + t, at - gap, kind))
            if at + gap < z1:
                out.append(_box(x - t, at + gap, x + t, z1, kind))
        else:
            out.append(_box(x - t, z0, x + t, z1, kind))
    return out


def _prop_box(p, kind='prop'):
    import math
    k = p['k']
    w, d = PROP_FOOT.get(k, (0.6, 0.6))
    s = float(p.get('s') or 1.0)
    w *= s
    d *= s
    ry = float(p.get('ry') or 0.0)
    ca, sa = abs(math.cos(ry)), abs(math.sin(ry))
    hw = (ca * w + sa * d) / 2.0
    hd = (sa * w + ca * d) / 2.0
    return (float(p['x']), float(p['z']), hw, hd, kind)


SEAT_FOOT = {'chair': (0.52, 0.52), 'stool': (0.44, 0.44),
             'bench': (1.75, 0.60), 'sofa': (1.8, 0.85)}


def seat_list():
    """给客户端和服务端共用的椅子表（顺序 = 服务端下发的 seat id）"""
    global _seats
    if _seats is None:
        out = []
        for i, s in enumerate(SEATS):
            d = dict(s, idx=i)
            d['yaw'] = float(s.get('ry', 0.0))
            out.append(d)
        _seats = out
    return _seats


def house_door(h):
    side = h.get('door')
    at = float(h.get('door_at') or 0)
    if side == 'east':
        return (float(h['x1']), at)
    if side == 'west':
        return (float(h['x0']), at)
    if side == 'south':
        return (at, float(h['z1']))
    return (at, float(h['z0']))


def house_bed(h):
    # 与客户端内饰床位置一致：别墅主卧在西南，其余民居在西北
    if h.get('tier') == 'villa':
        return (float(h['x0']) + 3.0, float(h['z1']) - 2.8)
    return (float(h['x0']) + 1.8, float(h['z0']) + 1.35)


def near_house(x, z, r=4.2):
    best = None
    bd = r * r
    for h in HOUSES:
        dx0, dz0 = house_door(h)
        dx = dx0 - x
        dz = dz0 - z
        d2 = dx * dx + dz * dz
        if d2 <= bd:
            bd = d2
            best = h
    return best


def near_teleport(x, z, r=2.8):
    best = None
    bd = r * r
    for t in TELEPORTS:
        dx = t['x'] - x
        dz = t['z'] - z
        d2 = dx * dx + dz * dz
        if d2 <= bd:
            bd = d2
            best = t
    return best


def teleport_of_id(tid):
    for t in TELEPORTS:
        if t['id'] == tid:
            return t
    return None


def building_at(x, z):
    for b in BUILDINGS:
        if b['x0'] <= x <= b['x1'] and b['z0'] <= z <= b['z1']:
            return b
    return None


def seat_by_id(sid):
    """按 idx 或 id 找椅子（客户端坐下/起身都用它）"""
    for s in seat_list():
        if str(s.get('idx')) == str(sid) or str(s.get('id')) == str(sid):
            return s
    try:
        i = int(sid)
    except Exception:
        return None
    lst = seat_list()
    if 0 <= i < len(lst):
        return lst[i]
    return None


def near_seat(x, z, r=None):
    r = SEAT_R if r is None else r
    best = None
    bd = r * r
    for s in seat_list():
        dx = float(s['x']) - x
        dz = float(s['z']) - z
        d2 = dx * dx + dz * dz
        if d2 <= bd:
            bd = d2
            best = s
    return best


def seat_of_id(sid):
    try:
        i = int(sid)
    except Exception:
        return None
    for s in seat_list():
        if s['idx'] == i or s.get('id') == sid:
            return s
    return None


def solid_boxes():
    global _all, _counter
    if _all is not None:
        return _all
    out = []
    t = 0.7
    E = TOWN_EDGE
    G2 = GATE_HALF
    # 外围墙（四门留 7 米）
    for z in (-E, E):
        out.append(_box(-E, z - t / 2, -G2, z + t / 2, 'wall'))
        out.append(_box(G2, z - t / 2, E, z + t / 2, 'wall'))
    for x in (-E, E):
        out.append(_box(x - t / 2, -E, x + t / 2, -G2, 'wall'))
        out.append(_box(x - t / 2, G2, x + t / 2, E, 'wall'))
    # 建筑墙体（含门洞）
    for b in BUILDINGS:
        out.extend(_wall_boxes(b, 'building'))
    for h in HOUSES:
        out.extend(_wall_boxes(h, 'house'))
    # 道具
    for p in PROPS:
        if p['k'] in NO_SOLID:
            continue
        out.append(_prop_box(p))
    # 椅子
    for s in seat_list():
        w, d = SEAT_FOOT.get(s['k'], (0.52, 0.52))
        hw, hd = w / 2.0, d / 2.0
        out.append((float(s['x']), float(s['z']), hw, hd, 'seat'))
    # 喷泉 + 仓库柜台
    out.append((0.0, 0.0, 1.95, 1.95, 'misc'))
    _counter = _box(WAREHOUSE_COUNTER[0] - 0.95, WAREHOUSE_COUNTER[1] - 0.38,
                    WAREHOUSE_COUNTER[0] + 0.95, WAREHOUSE_COUNTER[1] + 0.38)
    out.append(_counter)
    _all = out
    return out


# ============================ 小镇搬移 ============================
# 建筑/道具/椅子/广场/仓库柜台都从旧中心 (0,0) 搬到左下角。
# 住宅单独重排，保留每套住宅的相对户型。
HOUSE_NEW = {
    'villa_1': (-215, -197, 58, 74, 'east', 66),
    'villa_2': (-195, -177, 58, 74, 'east', 66),
    'villa_3': (-215, -197, 78, 94, 'east', 86),
    'villa_4': (-195, -177, 78, 94, 'east', 86),
    'yard_1': (-215, -201, 170, 184, 'east', 177),
    'yard_2': (-195, -181, 170, 184, 'east', 177),
    'yard_3': (-215, -201, 190, 204, 'east', 197),
    'yard_4': (-195, -181, 190, 204, 'east', 197),
    'flat_1': (-80, -68, 170, 184, 'west', 177),
    'flat_2': (-60, -48, 170, 184, 'west', 177),
    'flat_3': (-80, -68, 190, 204, 'west', 197),
    'flat_4': (-60, -48, 190, 204, 'west', 197),
}


def _rebase_town():
    global WAREHOUSE_COUNTER
    for b in BUILDINGS:
        b['x0'] += TOWN_CX; b['x1'] += TOWN_CX
        b['z0'] += TOWN_CZ; b['z1'] += TOWN_CZ
        if b.get('door') in ('east', 'west'):
            b['door_at'] += TOWN_CZ
        else:
            b['door_at'] += TOWN_CX
    for p in PROPS:
        p['x'] += TOWN_CX; p['z'] += TOWN_CZ
    for s2 in SEATS:
        s2['x'] += TOWN_CX; s2['z'] += TOWN_CZ
    for p in POLES:
        p['x'] += TOWN_CX; p['z'] += TOWN_CZ
    PLAZA['x0'] += TOWN_CX; PLAZA['x1'] += TOWN_CX
    PLAZA['z0'] += TOWN_CZ; PLAZA['z1'] += TOWN_CZ
    WAREHOUSE_COUNTER = (WAREHOUSE_COUNTER[0] + TOWN_CX, WAREHOUSE_COUNTER[1] + TOWN_CZ)
    for h in HOUSES:
        n = HOUSE_NEW.get(h['id'])
        if not n:
            continue
        x0, x1, z0, z1, door, at = n
        h['x0'], h['x1'], h['z0'], h['z1'] = x0, x1, z0, z1
        h['door'], h['door_at'] = door, at


_rebase_town()

# 住宅可坐家具（沙发/餐椅）：服务端也注册，访客能坐
for _h in HOUSES:
    if _h.get('tier') != 'villa':
        continue
    _cx = (float(_h['x0']) + float(_h['x1'])) / 2
    SEATS.append(dict(id='sofa_' + _h['id'], k='sofa', x=float(_h['x1']) - 2.4, z=float(_h['z1']) - 2.2,
                      ry=3.142, y=0.38, label='沙发', hide=1))
    SEATS.append(dict(id='chair_' + _h['id'], k='chair', x=_cx - 1.4, z=float(_h['z1']) - 4.6,
                      ry=0.0, y=0.30, label='餐椅', hide=1))
    _cz = (float(_h['z0']) + float(_h['z1'])) / 2
    for _di in range(6):
        SEATS.append(dict(id='dine_%s_%d' % (_h['id'], _di), k='chair',
                          x=_cx - 1.4 + (_di % 3) * 0.9,
                          z=_cz + 0.35 + (_di // 3) * 1.3,
                          ry=0.0, y=0.30, label='餐椅', hide=1))

# 店里没有椅子的堂食店：补一张公用桌椅（点单/传菜用）
for _sid in ('dessert', 'izakaya', 'tea'):
    _bb = next((_x for _x in BUILDINGS if _x['k'] == _sid), None)
    if not _bb:
        continue
    SEATS.append(dict(id='shared_' + _sid, k='chair',
                      x=float(_bb['x0']) + 1.6, z=(float(_bb['z0']) + float(_bb['z1'])) / 2,
                      ry=1.571, y=0.30, label='公用桌', hide=1))

def export_data():
    """tools/gen_town_data.py 用：一份纯 JSON 可序列化的快照"""
    def b(bd):
        d = {k: v for k, v in bd.items()}
        return d
    return dict(
        half=TOWN_HALF, edge=TOWN_EDGE, gate=GATE_HALF,
        origin=[TOWN_CX, TOWN_CZ], spawn=list(SPAWN),
        plaza=PLAZA, roads=ROADS,
        warehouseCounter=list(WAREHOUSE_COUNTER), warehouseR=WAREHOUSE_R,
        buildings=[b(x) for x in BUILDINGS],
        houses=[dict(h) for h in HOUSES],
        seats=[{k: v for k, v in s.items()} for s in seat_list()],
        props=[{k: v for k, v in p.items()} for p in PROPS],
        poles=[dict(p) for p in POLES],
        teleports=[dict(t) for t in TELEPORTS],
        solids=[list(s) for s in solid_boxes()],
    )
