/* v4 modular building models. Pure Three.js data + builder; no game DOM/UI.
   Every catalog version is an independent spec, so old versions stay placeable.
   Every mesh carries userData.partName for click-to-inspect in the preview. */
var TOWN_MODELS = {
  shop_apartment_v1: {
    name: '公寓 v1', type: 'shop', w: 9.0, d: 9.0, h: 8.6, floors: 2,
    roof: 'flat', wall: 0xe2d4bc, trim: 0x5a4a3a, roofColor: 0x4a4a46,
    door: 'south', doorW: 1.8, sign: 0x2a241c, awning: 0x6a7a8a, signText: '公 寓',
    shopStyle: 'shop_apartment_v1', windows: 0, band: 0x8a6a48,
    desc: '公寓：两层、一层 3 户、二层楼板走廊、室内楼梯'
  },
  shop_inn_v1: {
    name: '旅店 v1', type: 'shop', w: 11.0, d: 9.0, h: 7.4, floors: 1,
    roof: 'flat', wall: 0xe0d1b3, trim: 0x7c3e3b, roofColor: 0x3a3f3c,
    door: 'south', doorW: 2.0, sign: 0x2a1a14, awning: 0x7c3e3b, signText: '旅 店',
    shopStyle: 'shop_inn_v1', windows: 0, band: 0x8a6a48,
    desc: '旅店：前台、钥匙架、大堂沙发、客房走廊'
  },
  shop_bathhouse_v1: {
    name: '澡堂 v1', type: 'shop', w: 8.0, d: 6.0, h: 4.2, floors: 1,
    roof: 'flat', wall: 0xe0cfb4, trim: 0x3e6f7a, roofColor: 0x35504f,
    door: 'south', doorW: 2.2, sign: 0x1f2a2e, awning: 0x3e6f7a, signText: '汤',
    shopStyle: 'shop_bathhouse_v1', windows: 0, band: 0x8a6a48,
    desc: '澡堂：大浴池、3 个淋浴间、更衣柜、洗手台'
  },
  shop_tea_v1: {
    name: '茶馆 v1', type: 'shop', w: 8.0, d: 7.0, h: 3.4, floors: 1,
    roof: 'flat', wall: 0xe6d8bc, trim: 0x5c6b46, roofColor: 0x3d4f43,
    door: 'south', doorW: 1.6, sign: 0x1f2a20, awning: 0x6a8a52, signText: '茶',
    shopStyle: 'shop_tea_v1', windows: 0, band: 0x8a6a48,
    desc: '茶馆：茶柜台、茶具架、3 张茶桌、坐垫'
  },
  shop_dessert_v1: {
    name: '甜品店 v1', type: 'shop', w: 7.0, d: 6.0, h: 3.3, floors: 1,
    roof: 'flat', wall: 0xf0dac0, trim: 0xc06a8a, roofColor: 0x4a4048,
    door: 'south', doorW: 1.5, sign: 0x3a2030, awning: 0xd8708a, signText: '甜 品',
    shopStyle: 'shop_dessert_v1', windows: 0, band: 0x8a6a48,
    desc: '甜品店：玻璃展示柜、收银台、2 张小圆桌'
  },
  shop_koban_v1: {
    name: '警亭 v1', type: 'shop', w: 6.0, d: 5.0, h: 3.2, floors: 1,
    roof: 'flat', wall: 0xddd6c6, trim: 0x3a4a6a, roofColor: 0x3a4048,
    door: 'south', doorW: 1.4, sign: 0x1f2430, awning: 0x3a4a6a, signText: '交 番',
    shopStyle: 'shop_koban_v1', windows: 0, band: 0x8a6a48,
    desc: '警亭：值勤台、档案柜、等待长椅'
  },
  shop_warehouse_v1: {
    name: '仓库 v1', type: 'shop', w: 13.0, d: 11.0, h: 4.2, floors: 1,
    roof: 'flat', wall: 0xe2d3b6, trim: 0x6f6353, roofColor: 0x3f5850,
    door: 'south', doorW: 3.0, sign: 0x2a241c, awning: 0x8a7a62, signText: '仓 库',
    shopStyle: 'shop_warehouse_v1', windows: 0, band: 0x8a6a48,
    desc: '仓库：三排高货架、木箱堆、装卸台、工矿灯'
  },
  shop_smith_v1: {
    name: '铁匠铺 v1', type: 'shop', w: 7.0, d: 7.0, h: 3.6, floors: 1,
    roof: 'flat', wall: 0xb59c80, trim: 0x4a352c, roofColor: 0x4a352c,
    door: 'south', doorW: 1.8, sign: 0x2a1a10, awning: 0xb4542f, signText: '铁 匠 铺',
    shopStyle: 'shop_smith_v1', windows: 0, band: 0x8a6a48,
    desc: '铁匠铺：铁砧台、熔炉、淬火桶、工具架'
  },
  shop_clinic_v1: {
    name: '药铺 v1', type: 'shop', w: 8.0, d: 7.0, h: 3.4, floors: 1,
    roof: 'flat', wall: 0xe6d8be, trim: 0x5c6b46, roofColor: 0x3f5148,
    door: 'south', doorW: 1.6, sign: 0x22301f, awning: 0x6a8a52, signText: '药 铺',
    shopStyle: 'shop_clinic_v1', windows: 0, band: 0x8a6a48,
    desc: '药铺：整面药柜、抓药柜台、药罐、候诊椅'
  },
  shop_post_v1: {
    name: '邮局 v1', type: 'shop', w: 7.0, d: 7.0, h: 3.5, floors: 1,
    roof: 'flat', wall: 0xd6b696, trim: 0x8d3f36, roofColor: 0x4a4438,
    door: 'south', doorW: 1.6, sign: 0x3a1f1c, awning: 0x8d3f36, signText: '邮 局',
    shopStyle: 'shop_post_v1', windows: 0, band: 0x8a6a48,
    desc: '邮局：邮局柜台、信箱格、邮包堆'
  },
  shop_bookstore_v1: {
    name: '书店 v1', type: 'shop', w: 10.0, d: 7.0, h: 3.4, floors: 1,
    roof: 'flat', wall: 0xddcfb4, trim: 0x3e5968, roofColor: 0x3f5450,
    door: 'south', doorW: 1.8, sign: 0x22282e, awning: 0x4a6a7a, signText: '书 店',
    shopStyle: 'shop_bookstore_v1', windows: 0, band: 0x8a6a48,
    desc: '书店：两侧书架、书脊、阅读桌、座椅'
  },
  shop_izakaya_v1: {
    name: '居酒屋 v1', type: 'shop', w: 8.0, d: 7.0, h: 3.5, floors: 1,
    roof: 'flat', wall: 0xb98a60, trim: 0x4a2f1d, roofColor: 0x3a2a20,
    door: 'south', doorW: 1.6, sign: 0x2a1810, awning: 0xb03a2a, signText: '居 酒 屋',
    shopStyle: 'shop_izakaya_v1', windows: 0, band: 0x8a6a48,
    desc: '居酒屋：L 形吧台、吧台凳、酒架、小桌、红灯笼'
  },
  shop_ramen_v1: {
    name: '面馆 v1', type: 'shop', w: 8.0, d: 6.0, h: 3.4, floors: 1,
    roof: 'flat', wall: 0xb0855a, trim: 0x4a2f1d, roofColor: 0x4a352c,
    door: 'south', doorW: 1.4, sign: 0x2a1a10, awning: 0xc0452c, signText: '拉 面',
    shopStyle: 'shop_ramen_v1', windows: 0, band: 0x8a6a48,
    desc: '木质拉面店：吧台、吧台凳、煮面灶、红灯笼、菜单板'
  },
  shop_bakery_v1: {
    name: '面包店 v1', type: 'shop', w: 10.0, d: 6.0, h: 3.3, floors: 1,
    roof: 'flat', wall: 0xecdfc7, trim: 0x8a5a32, roofColor: 0x4f4a42,
    door: 'south', doorW: 1.5, sign: 0x2f2418, awning: 0xd8a24a, signText: '面 包',
    shopStyle: 'shop_bakery_v1', windows: 0, band: 0x8a6a48,
    desc: '暖色面包店：展示柜、面包托盘、收银台、餐桌椅'
  },
  shop_general_v1: {
    name: '杂货铺 v1', type: 'shop', w: 7.0, d: 6.0, h: 3.2, floors: 1,
    roof: 'flat', wall: 0xddcfb4, trim: 0x5a4632, roofColor: 0x46443e,
    door: 'south', doorW: 1.4, sign: 0x2f2418, awning: 0x7a8a5a, signText: '杂 货',
    shopStyle: 'shop_general_v1', windows: 0, band: 0x8a6a48,
    desc: '杂货铺：两侧货架、柜台、纸箱'
  },
  shop_flower_v1: {
    name: '花店 v1', type: 'shop', w: 8.0, d: 6.0, h: 3.2, floors: 1,
    roof: 'flat', wall: 0xe2d7be, trim: 0x5a7a4a, roofColor: 0x3d5240,
    door: 'south', doorW: 1.4, sign: 0x22301f, awning: 0x9ac06a, signText: '花 店',
    shopStyle: 'shop_flower_v1', windows: 0, band: 0x8a6a48,
    desc: '花店：花架、花盆、花台、花束'
  },
  shop_cafe_v1: {
    name: '咖啡店 v1', type: 'shop', w: 9.3, d: 9.3, h: 3.0, floors: 1,
    roof: 'flat', wall: 0xd9cdb8, trim: 0x6b4a32, roofColor: 0x4a5254,
    door: 'south', doorW: 1.5, sign: 0x2a2118, awning: 0xb45a44, signText: '暖阳咖啡', interior: 'cafe',
    windows: 4, band: 0x8a6a48, desc: '米色墙面、深色平屋顶、南向门、遮阳棚'
  },
  shop_cafe_v2: {
    name: '咖啡店 v2', type: 'shop', w: 9.3, d: 9.3, h: 3.2, floors: 1,
    roof: 'gable', wall: 0x6f5140, trim: 0x2f3438, roofColor: 0x3a4741,
    door: 'south', doorW: 1.4, sign: 0x2a2118, awning: 0x2f4a6a, signText: '木屋咖啡', interior: 'cafe',
    windows: 5, band: 0x3f2d1e, desc: '深木墙面、坡屋顶、蓝色雨棚、暖色窗'
  },
  shop_mart_v1: {
    name: '超市 v1', type: 'shop', w: 18.6, d: 15.5, h: 4.4, floors: 1,
    roof: 'flat', wall: 0xd7dcda, trim: 0x3e5a66, roofColor: 0x4a5458,
    door: 'south', doorW: 2.6, sign: 0x1f3b4a, awning: null, signText: '小镇超市', interior: 'mart', facade: 'mart',
    windows: 0, band: 0x3e6a7a, desc: '大跨度仓储式卖场：高门厅、金属雨棚、屋顶采光棚、侧卸货口、独立店牌'
  },
  house_flat_v1: {
    name: '小平房 v1', type: 'house', w: 7.4, d: 8.6, h: 2.9, floors: 1,
    roof: 'gable', wall: 0xd8cdb8, trim: 0x6b4a32, roofColor: 0x5a3e32,
    door: 'south', doorW: 1.2, sign: 0x000000, windows: 4, band: 0x8a6a48,
    facade: 'cottage', interior: 'home',
    desc: '缩小版乡村小平房：坡屋顶、侧厨房翼、门廊、烟囱，室内有客餐厅/卧室/厨房/卫生间'
  },
  house_villa_v1: {
    name: '别墅 v1', type: 'house', w: 14.0, d: 11.0, h: 6.3, floors: 2,
    roof: 'flat', wall: 0xd6d7d2, trim: 0x2b3a42, roofColor: 0x56656b,
    door: 'south', doorW: 1.8, sign: 0x000000, windows: 8, band: 0x8a6a48,
    balcony: 1, villaStyle: 'v1', interior: 'villa',
    desc: '白色悬浮式豪宅：两层、二层缩进、大阳台、泳池院子、玻璃幕墙'
  },
  hall_v1: {
    name: '大厅 v1', type: 'public', w: 20.0, d: 14.0, h: 4.8, floors: 1,
    roof: 'flat', wall: 0xd8cdb8, trim: 0x3d4549, roofColor: 0x4a5458,
    door: 'south', doorW: 2.8, sign: 0x2a2118, windows: 0, band: 0x8a6a48,
    hallStyle: 'v1', desc: '公共大厅：六柱门廊、山花、屋顶塔楼、20 把玩家座椅'
  },
  teleport_v1: {
    name: '传送阵 v1', type: 'function', w: 3.7, d: 3.7, h: 3.0, floors: 0,
    roof: 'none', wall: 0x8a8272, trim: 0x9fe8ff, roofColor: 0x4b8aa0,
    door: 'none', windows: 0, teleportStyle: 'v1', desc: '圆形石台、双环、符文、悬浮晶体与光柱'
  }
};

/* 户外物件规格在 town_props.js 里定义，加载后并入 TOWN_MODELS */
var TOWN_PROP_SPECS_MERGED = true;
function tmMergeProps() {
  if (typeof PROP_SPECS === 'undefined') { return 0; }
  var n = 0;
  for (var k in PROP_SPECS) {
    if (!TOWN_MODELS[k]) { TOWN_MODELS[k] = PROP_SPECS[k]; n++; }
  }
  return n;
}

var TOWN_PART_CN = {
  trunk: '树干', crown_1: '树冠 1', crown_2: '树冠 2', crown_3: '树冠 3',
  pole: '立杆', lamp_top: '灯头', lamp_globe: '灯球', base2: '基座上层',
  seat: '坐面', back: '靠背', leg_c: '左后腿', leg_d: '右后腿',
  window: '展示窗', slot: '投币口', lid: '盖',
  frame_top: '上管', frame_down: '下管', fork: '前叉', handle: '车把', saddle: '车座',
  band: '箍带', hoop_top: '上箍', hoop_bottom: '下箍', canopy: '顶棚',
  goods_1: '货物 1', goods_2: '货物 2', goods_3: '货物 3',
  cap: '顶盖', arm: '出水口', board: '板面', paper: '纸张', sign: '站牌', sign_face: '牌面',
  bed: '车板', crate_a: '货箱 A', crate_b: '货箱 B', horn: '砧角', rim: '石框', soil: '泥土',
  lantern: '灯笼', glow: '灯光', line: '晾衣绳', pot: '花盆', stem: '花茎', leaf: '叶子',
  stand: '架子', rail_top: '上横杆', rail_bottom: '下横杆',
  cloth_1: '衣物 1', cloth_2: '衣物 2', cloth_3: '衣物 3',
  flower_1: '花 1', flower_2: '花 2', flower_3: '花 3', flower_4: '花 4',
  lump_1: '煤块 1', lump_2: '煤块 2', lump_3: '煤块 3', lump_4: '煤块 4',
  lump_5: '煤块 5', lump_6: '煤块 6', lump_7: '煤块 7',
  pot_1: '花盆 1', pot_2: '花盆 2', stem_1: '花茎 1', stem_2: '花茎 2',
  foundation: '地基', floor: '地面',
  front_wall_left: '左前墙', front_wall_right: '右前墙', front_wall: '前墙',
  door_header: '门头', door_opening: '门洞', door_frame_top: '门框上沿',
  door_threshold: '门槛', door_frame_left: '左门框', door_frame_right: '右门框',
  entrance_canopy: '入口雨棚', canopy_post_left: '雨棚左柱', canopy_post_right: '雨棚右柱',
  side_wall_left: '左侧墙', side_wall_right: '右侧墙', back_wall: '后墙',
  belt_band: '腰线/饰带', balcony_floor: '阳台地板', balcony_rail: '阳台栏杆',
  roof_slab: '屋顶板', roof_solar: '屋顶太阳能板', roof_ac: '屋顶空调',
  parapet_front: '前女儿墙', parapet_back: '后女儿墙',
  parapet_left: '左女儿墙', parapet_right: '右女儿墙',
  gable_roof_left: '左坡屋顶', gable_roof_right: '右坡屋顶', ridge: '屋脊',
  sign_board: '招牌底板', sign_face: '招牌面',
  column_left: '左立柱', column_right: '右立柱',
  interior_floor: '室内地面', counter: '柜台', counter_top: '柜台台面',
  shelf_1: '货架 1', shelf_2: '货架 2', menu_board: '菜单板',
  table_1: '餐桌 1', chair_1_seat: '椅子 1 坐垫', chair_1_back: '椅子 1 靠背',
  chair_2_seat: '椅子 2 坐垫', chair_2_back: '椅子 2 靠背',
  fridge: '冰箱', lamp_1: '吊灯', plant_1: '盆栽', plant_1_leaf: '盆栽 1 叶子',
  lamp_ceiling: '吊灯', table_1_leg: '餐桌 1 桌腿',
  fridge_body: '冰箱箱体', fridge_glass: '冰箱玻璃门', fridge_handle: '冰箱把手',
  fridge_shelf_1: '冰箱层架 1', fridge_shelf_2: '冰箱层架 2', fridge_can_1: '冰箱饮料 1',
  coffee_machine: '咖啡机', coffee_machine_top: '咖啡机顶盖', portafilter: '冲煮头',
  coffee_cup: '咖啡杯', steam_wand: '蒸汽棒', coffee_beans: '咖啡豆仓',
  outdoor_table_1: '户外桌 1', umbrella_pole: '遮阳伞杆', umbrella_canopy: '遮阳伞面',
  umbrella_base: '遮阳伞座', wall_art_1_frame: '挂画框 1', wall_art_1_picture: '挂画 1',
  wall_art_2_frame: '挂画框 2', wall_art_2_picture: '挂画 2', wall_clock: '挂钟', wall_clock_face: '挂钟表盘', wall_clock_hand_hour: '时针', wall_clock_hand_minute: '分针',
  wall_menu: '墙菜单', door_threshold: '门槛',
  canopy_front_beam: '雨棚前横梁', canopy_beam_left: '雨棚左横梁', canopy_beam_right: '雨棚右横梁',
  fridge_top: '冰箱顶盖', fridge_base: '冰箱底座', fridge_inner: '冰箱内胆',
  fridge_handle_left: '冰箱左把手', fridge_handle_right: '冰箱右把手',
  fridge_can_2: '冰箱饮料 2', fridge_can_3: '冰箱饮料 3', fridge_can_4: '冰箱饮料 4',
  fridge_center_frame: '冰箱中框',
  checkout_counter: '收银台', checkout_counter_top: '收银台面', checkout_register: '收银机',
  checkout_bag_stand: '装袋台', basket_stack: '购物篮堆', basket_stack_2: '购物篮堆 2',
  shopping_cart: '购物车', shopping_cart_handle: '购物车把手', cart_1: '购物车围栏车 1', cart_2: '购物车围栏车 2', promo_board: '促销牌',
  npc_cafe_stand: '咖啡店员站位', npc_waiter_pass: '传菜员出餐位', npc_checkout_stand: '收银员站位',
  eave_front: '前檐板', eave_back: '后檐板', gable_roof_front: '前坡屋顶', gable_roof_back: '后坡屋顶',
  gable_end_left: '左山墙', gable_end_right: '右山墙',
  outdoor_table_1_leg: '户外桌 1 桌腿', outdoor_table_2: '户外桌 2', outdoor_table_2_leg: '户外桌 2 桌腿',
  checkout_side: '收银台侧板', cash_register_body: '收银机机身', cash_register_screen: '收银机屏幕',
  cash_register_keys: '收银机键盘', cash_register_receipt: '小票打印机', cash_register_card: '刷卡器',
  cash_register_scanner: '扫码器', mart_fascia: '超市檐口招牌', canopy_mart: '超市雨棚',
  column_mart_left: '超市左立柱', column_mart_right: '超市右立柱', mart_loading_door: '卸货口',
  mart_bollard_1: '防撞柱 1', mart_bollard_2: '防撞柱 2', mart_bollard_3: '防撞柱 3',
  mart_cart_corral: '购物车围栏', checkout_bag_stand: '装袋台',
  mart_entry_left: '入口门厅左墙', mart_entry_right: '入口门厅右墙', mart_entry_header: '入口门厅上墙',
  mart_entry_roof: '入口门厅顶板', mart_entry_fascia: '入口门厅檐口', mart_entry_glass: '入口玻璃',
  mart_entry_mullion_l: '入口左竖框', mart_entry_mullion_r: '入口右竖框', mart_entry_lintel: '入口横梁',
  mart_pylon: '超市立牌柱', mart_pylon_sign: '超市立招牌', mart_pylon_face: '超市立牌面',
  mart_entry_sign: '入口门厅招牌', mart_entry_sign_face: '入口门厅招牌面',
  cottage_wing: '厨房侧翼', cottage_wing_roof: '侧翼屋顶', cottage_wing_window: '侧翼窗',
  cottage_wing_door: '侧翼门', porch_roof: '门廊顶', porch_post_left: '门廊左柱',
  porch_post_right: '门廊右柱', porch_beam: '门廊横梁', porch_step: '门廊台阶',
  chimney: '烟囱', bay_window: '凸窗', bay_window_sill: '凸窗窗台',
  canopy_mart_left: '超市左雨棚', canopy_mart_right: '超市右雨棚',
  mart_roof_monitor: '超市屋顶采光棚', mart_dock: '卸货间', mart_dock_ramp: '卸货坡道',
  mart_skylight_1: '屋顶采光带 1', mart_skylight_2: '屋顶采光带 2', mart_skylight_3: '屋顶采光带 3', mart_skylight_4: '屋顶采光带 4',
  bed_frame: '床架', bed_mattress: '床垫', bed_blanket: '被子', bed_pillow_l: '左枕头',
  bed_pillow_r: '右枕头', bed_headboard: '床头板', bed_leg_fl: '床腿左前', bed_leg_fr: '床腿右前', bed_leg_bl: '床腿左后', bed_leg_br: '床腿右后',
  bed_nightstand: '床头柜', bed_lamp: '床头灯',
  sofa_base: '沙发底座', sofa_back: '沙发靠背', sofa_arm_left: '沙发左扶手', sofa_arm_right: '沙发右扶手',
  sofa_cushion_l: '沙发左坐垫', sofa_cushion_r: '沙发右坐垫', sofa_leg_l: '沙发左腿', sofa_leg_r: '沙发右腿',
  living_rug: '客厅地毯', living_tv: '电视', living_tv_stand: '电视柜',
  dining_table: '餐桌', dining_table_leg: '餐桌桌腿',
  wardrobe: '衣柜', wardrobe_handle: '衣柜把手', wardrobe_top_trim: '衣柜顶线条',
  kitchen_counter: '厨房操作台', kitchen_top: '厨房台面', kitchen_sink: '水槽', kitchen_faucet: '水龙头',
  kitchen_stove: '灶台', kitchen_oven: '烤箱', kitchen_oven_handle: '烤箱把手',
  kitchen_cabinet: '厨房吊柜', kitchen_range_hood: '抽油烟机',
  toilet_base: '马桶底座', toilet_bowl: '马桶圈', toilet_tank: '马桶水箱', toilet_flush: '冲水按钮',
  bath_vanity: '洗手台', bath_basin: '洗手盆', bath_faucet: '洗手盆龙头', bath_mirror: '浴室镜',
  shower_tray: '淋浴底盘', shower_glass: '淋浴玻璃',
  partition_kitchen_bath: '厨房卫生间隔墙', partition_living_bed: '客厅卧室隔墙',
  partition_bath_front: '卫生间前墙', partition_bath_side: '卫生间侧墙',
  villa_yard: '别墅院子', villa_path: '别墅步道', yard_hedge_back: '后院绿篱',
  yard_hedge_left: '左院绿篱', yard_hedge_right: '右院绿篱', villa_pool_water: '泳池水面',
  villa_pool_edge: '泳池池边', pool_lounger_1: '泳池躺椅 1', pool_lounger_2: '泳池躺椅 2',
  pool_side_table: '泳池边桌', villa_stone_patio: '石材庭院', villa_tree_trunk: '庭院树干',
  villa_tree_crown: '庭院树冠', villa_tree_crown_2: '庭院树冠 2', villa_fire_pit: '火盆',
  villa_fire: '火盆火焰', villa_base: '别墅基座', f1_back_wall: '一层后墙',
  f1_side_wall_left: '一层左墙', f1_side_wall_right: '一层右墙', f1_front_glass: '一层前玻璃',
  f1_fascia: '一层檐口', f1_overhang: '一层挑檐', f2_floor_back: '二层后地板',
  f2_floor_front: '二层前地板', f2_floor_left: '二层左地板', f2_floor_right: '二层右地板',
  f2_back_wall: '二层后墙', f2_side_wall_left: '二层左墙', f2_side_wall_right: '二层右墙',
  f2_front_glass: '二层前玻璃', roof_villa: '别墅屋顶', roof_overhang: '屋顶挑檐',
  balcony_deck: '大阳台地板', balcony_rail_front: '阳台前栏杆', balcony_rail_left: '阳台左栏杆',
  balcony_rail_right: '阳台右栏杆', balcony_table: '阳台桌', stair_rail_left: '楼梯左扶手',
  stair_rail_right: '楼梯右扶手', stair_opening_trim_back: '楼梯洞口后收边', stair_opening_trim_front: '楼梯洞口前收边', coffee_table: '茶几',
  f1_front_glass_left: '一层前玻璃左', f1_front_glass_right: '一层前玻璃右',
  f1_floor_light: '一层浅灰地面', f2_floor_light_back: '二层浅灰地面后',
  f2_floor_light_front: '二层浅灰地面前', f2_floor_light_left: '二层浅灰地面左',
  f2_floor_light_right: '二层浅灰地面右', f1_entry_frame_left: '入口左门框',
  f1_entry_frame_right: '入口右门框', f1_entry_frame_top: '入口门头', f1_entry_threshold: '入口门槛',
  f1_entry_door_left: '入口左玻璃门', f1_entry_door_right: '入口右玻璃门',
  f1_entry_handle_left: '入口左门把手', f1_entry_handle_right: '入口右门把手',
  bath_wall_side_back: '卫生间后侧墙', bath_wall_side_front: '卫生间前侧墙',
  bath_wall_front: '卫生间前墙', bath_wall_front_left: '卫生间前墙左', bath_wall_front_right: '卫生间前墙右',
  bath_wall_post_1: '卫生间门框 1', bath_wall_post_2: '卫生间门框 2',
  f2_front_glass_left: '二层前玻璃左', f2_front_glass_right: '二层前玻璃右',
  f2_balcony_door_frame_left: '阳台门左框', f2_balcony_door_frame_right: '阳台门右框',
  f2_balcony_door_frame_top: '阳台门头', f2_balcony_door_threshold: '阳台门槛',
  roof_terrace_left: '左侧露台屋面', roof_terrace_right: '右侧露台屋面',
  roof_terrace_back: '后侧露台屋面', roof_terrace_front: '前侧露台屋面',
  roof_parapet_front: '露台前女儿墙', roof_parapet_back: '露台后女儿墙',
  roof_parapet_left: '露台左女儿墙', roof_parapet_right: '露台右女儿墙',
  roof_parapet_upper_front: '二层屋顶前女儿墙', roof_parapet_upper_back: '二层屋顶后女儿墙',
  roof_parapet_upper_left: '二层屋顶左女儿墙', roof_parapet_upper_right: '二层屋顶右女儿墙',
  door_frame: '门框', roof_eave: '屋檐', awning: '雨棚', awning_post_l: '雨棚左柱',
  awning_post_r: '雨棚右柱',
  plinth: '勒脚', corner_pillar_1: '角壁柱 1', corner_pillar_2: '角壁柱 2',
  corner_pillar_3: '角壁柱 3', corner_pillar_4: '角壁柱 4',
  front_wall_left: '正面墙左', front_wall_right: '正面墙右',
  door_header: '门头', door_jamb_l: '左门框', door_jamb_r: '右门框', door_step: '门槛台阶',
  front_window_glass_1: '左橱窗玻璃', front_window_glass_2: '右橱窗玻璃',
  front_window_top_1: '左橱窗上框', front_window_top_2: '右橱窗上框',
  front_window_sill_1: '左橱窗窗台', front_window_sill_2: '右橱窗窗台',
  roof_ridge_back: '后屋脊', roof_ridge_front: '前屋脊',
  roof_vent: '屋顶通风口', roof_tank: '屋顶水箱', belt_band: '腰线', interior_floor: '室内地面', back_wall: '后墙',
  side_wall_left: '左墙', side_wall_right: '右墙', front_wall: '前墙', sign_board: '招牌底板',
  hall_base: '大厅基座', hall_step_1: '大厅台阶 1', hall_step_2: '大厅台阶 2', hall_step_3: '大厅台阶 3',
  hall_back_wall: '大厅后墙', hall_side_wall_left: '大厅左墙', hall_side_wall_right: '大厅右墙',
  hall_front_glass_left: '大厅前玻璃左', hall_front_glass_right: '大厅前玻璃右',
  hall_entry_frame_left: '大厅入口左框', hall_entry_frame_right: '大厅入口右框',
  hall_entry_frame_top: '大厅门头', hall_entry_threshold: '大厅门槛',
  hall_front_fascia: '大厅前檐口', hall_roof: '大厅屋顶', hall_parapet_front: '大厅前女儿墙',
  hall_parapet_back: '大厅后女儿墙', hall_portico_floor: '门廊地面',
  hall_portico_entablature: '门廊檐部', hall_portico_cornice: '门廊檐口',
  hall_pediment: '大厅山花', hall_pediment_beam: '山花底梁',
  hall_wing_left: '大厅左翼', hall_wing_right: '大厅右翼',
  hall_wing_left_roof: '左翼屋顶', hall_wing_right_roof: '右翼屋顶',
  hall_wing_left_glass: '左翼玻璃', hall_wing_right_glass: '右翼玻璃',
  hall_tower: '大厅塔楼', hall_tower_glass: '塔楼玻璃', hall_tower_roof: '塔楼顶板',
  hall_tower_dome: '塔楼圆顶', hall_floor: '大厅地面', hall_stage: '大厅舞台',
  hall_stage_rug: '舞台地毯', hall_speaker_desk: '演讲台', hall_lectern: '讲台',
  hall_reception: '大厅接待台', hall_reception_top: '接待台面', hall_info_table: '咨询桌',
  hall_notice: '公告栏', hall_chandelier: '大厅吊灯',
  tp_base_lower: '传送阵底座下层', tp_base_mid: '传送阵底座中层', tp_base_upper: '传送阵底座上层',
  tp_energy_disc: '传送阵能量盘', tp_ring_outer: '传送阵外环', tp_ring_inner: '传送阵内环',
  tp_particles: '传送粒子', tp_core_glow: '传送核心光晕',
  hall_tower_roof_1: '塔楼方形屋顶 1', hall_tower_roof_2: '塔楼方形屋顶 2',
  hall_tower_roof_3: '塔楼方形屋顶 3', hall_tower_roof_4: '塔楼方形屋顶 4',
  hall_tower_finial: '塔楼顶饰', hall_tower_spire: '塔楼尖顶',
  plant_1: '盆栽', plant_1_leaf: '盆栽叶子',
  upper_bath_wall_left: '二层卫生间左墙', upper_bath_wall_right: '二层卫生间右墙',
  upper_bath_wall_back: '二层卫生间后墙', upper_bath_wall_front_left: '二层卫生间前墙左', upper_bath_wall_front_right: '二层卫生间前墙右',
  kitchen_island: '厨房中岛', bathtub: '浴缸', bookshelf: '书架', desk: '书桌',
  desk_leg_l: '书桌左腿', desk_leg_r: '书桌右腿', villa_cantilever_beam: '悬挑梁',
  villa_stone_clad: '石材基座', villa_fin_1: '白色竖向格栅 1', villa_fin_2: '白色竖向格栅 2',
  villa_fin_3: '白色竖向格栅 3', villa_fin_4: '白色竖向格栅 4', villa_fin_5: '白色竖向格栅 5',
  villa_fin_6: '白色竖向格栅 6', villa_fin_7: '白色竖向格栅 7', villa_timber_screen_1: '木格栅 1',
  villa_timber_screen_2: '木格栅 2', villa_timber_screen_3: '木格栅 3', villa_timber_screen_4: '木格栅 4',
  villa_timber_screen_5: '木格栅 5', villa_timber_screen_6: '木格栅 6', villa_timber_screen_7: '木格栅 7',
  villa_timber_screen_8: '木格栅 8', villa_timber_screen_9: '木格栅 9',
  balcony_chair_1_seat: '阳台椅 1 坐垫', balcony_chair_1_cushion: '阳台椅 1 软垫',
  balcony_chair_1_back: '阳台椅 1 靠背', balcony_chair_1_leg_fl: '阳台椅 1 左前腿',
  balcony_chair_1_leg_fr: '阳台椅 1 右前腿', balcony_chair_1_leg_bl: '阳台椅 1 左后腿',
  balcony_chair_1_leg_br: '阳台椅 1 右后腿', balcony_chair_1_arm_left: '阳台椅 1 左扶手',
  balcony_chair_1_arm_right: '阳台椅 1 右扶手', desk_chair_1_seat: '书桌椅坐垫',
  desk_chair_1_cushion: '书桌椅软垫', desk_chair_1_back: '书桌椅靠背',
  desk_chair_1_leg_fl: '书桌椅左前腿', desk_chair_1_leg_fr: '书桌椅右前腿',
  desk_chair_1_leg_bl: '书桌椅左后腿', desk_chair_1_leg_br: '书桌椅右后腿',
  desk_chair_1_arm_left: '书桌椅左扶手', desk_chair_1_arm_right: '书桌椅右扶手',
  base: '底座',
  body: '主体',
  top: '顶盖',
  leg_a: '左前腿 A',
  leg_b: '右前腿 B',
  head: '头像',
  post_a: '立柱 A',
  post_b: '立柱 B',
  handle_a: '左把手',
  handle_b: '右把手',

  flower: '花朵',
  box: '箱体',
  post: '支柱',

  base_upper: '底座上层',
  lamp_bottom: '灯罩底',
  lamp_glass_f: '灯罩前玻璃',
  lamp_glass_b: '灯罩后玻璃',
  lamp_glass_l: '灯罩左玻璃',
  lamp_glass_r: '灯罩右玻璃',
  lamp_core: '灯芯',
  lamp_cap: '灯帽',
  post_c: '立柱 C',
  post_d: '立柱 D',
  root_flare: '根部',
  branch_1: '主枝 1',
  branch_2: '主枝 2',
  branch_3: '主枝 3',
  crown_inner_1: '内层叶 1',
  crown_inner_2: '内层叶 2',
  crown_inner_3: '内层叶 3',
  crown_top: '顶层树冠',
  crown_top2: '顶层树冠 2',
  crown_4: '树冠 4',
  curb: '石边',
  body_low: '绿篱下层',
  body_mid: '绿篱中层',
  top_1: '顶部起伏 1',
  top_2: '顶部起伏 2',
  top_3: '顶部起伏 3',
  top_4: '顶部起伏 4',
  top_5: '顶部起伏 5',
  leaf_front_1: '前排叶 1',
  leaf_front_2: '前排叶 2',
  leaf_front_3: '前排叶 3',
  leaf_front_4: '前排叶 4',
  spoke_1_1: '前轮辐条 1',
  spoke_1_2: '前轮辐条 2',
  spoke_1_3: '前轮辐条 3',
  spoke_1_4: '前轮辐条 4',
  spoke_2_1: '后轮辐条 1',
  spoke_2_2: '后轮辐条 2',
  spoke_2_3: '后轮辐条 3',
  spoke_2_4: '后轮辐条 4',
  hub_1: '前轮毂',
  hub_2: '后轮毂',
  tube_down: '下管',
  tube_seat: '立管',
  tube_top: '上管',
  stay_lower: '后下叉',
  head_tube: '车头管',
  handlebar: '车把',
  grip_l: '左把套',
  grip_r: '右把套',
  seatpost: '座杆',
  chainring: '牙盘',
  crank_l: '左曲柄',
  pedal_l: '左脚踏',
  chain: '链条',
  basket: '车筐',
  basket_rim: '车筐边',
  rack: '后货架',
  face: '前面板',
  slot_hood: '投信口沿',
  roof: '顶盖',
  roof_top: '顶盖上层',
  plate: '标识牌',
  side_plate: '侧面标牌',
  door: '取信门',
  door_handle: '门把手',
  rim_top: '石框上沿',
  stem_3: '花茎 3',
  leaf_1_a: '叶 1 左',
  leaf_1_b: '叶 1 右',
  leaf_2_a: '叶 2 左',
  leaf_2_b: '叶 2 右',
  leaf_3_a: '叶 3 左',
  leaf_3_b: '叶 3 右',
  petal_1_1: '花 1 瓣 1',
  petal_1_2: '花 1 瓣 2',
  petal_1_3: '花 1 瓣 3',
  petal_1_4: '花 1 瓣 4',
  petal_1_5: '花 1 瓣 5',
  petal_2_1: '花 2 瓣 1',
  petal_2_2: '花 2 瓣 2',
  petal_2_3: '花 2 瓣 3',
  petal_2_4: '花 2 瓣 4',
  petal_2_5: '花 2 瓣 5',
  petal_3_1: '花 3 瓣 1',
  petal_3_2: '花 3 瓣 2',
  petal_3_3: '花 3 瓣 3',
  petal_3_4: '花 3 瓣 4',
  petal_3_5: '花 3 瓣 5',
  core_1: '花 1 花心',
  core_2: '花 2 花心',
  core_3: '花 3 花心',
  stem_s1: '小花茎 1',
  stem_s2: '小花茎 2',

  petal_s1_1: '小花 1 花瓣 1',
  petal_s1_2: '小花 1 花瓣 2',
  petal_s1_3: '小花 1 花瓣 3',
  petal_s1_4: '小花 1 花瓣 4',
  petal_s2_1: '小花 2 花瓣 1',
  petal_s2_2: '小花 2 花瓣 2',
  petal_s2_3: '小花 2 花瓣 3',
  petal_s2_4: '小花 2 花瓣 4',

  curb_top: '石边上沿',
  core: '内部体积',
  pine_tip: '松树顶',
  leaf_1: '叶片 1',
  leaf_2: '叶片 2',
  leaf_3: '叶片 3',
  leaf_4: '叶片 4',
  leaf_5: '叶片 5',
  leaf_6: '叶片 6',
  leaf_7: '叶片 7',
  leaf_8: '叶片 8',
  leaf_9: '叶片 9',
  leaf_10: '叶片 10',
  leaf_11: '叶片 11',
  leaf_12: '叶片 12',
  leaf_13: '叶片 13',
  leaf_14: '叶片 14',
  leaf_15: '叶片 15',
  leaf_16: '叶片 16',
  leaf_17: '叶片 17',
  leaf_18: '叶片 18',
  leaf_19: '叶片 19',
  leaf_20: '叶片 20',
  leaf_21: '叶片 21',
  leaf_22: '叶片 22',
  leaf_23: '叶片 23',
  leaf_24: '叶片 24',
  leaf_25: '叶片 25',
  leaf_26: '叶片 26',
  leaf_27: '叶片 27',
  leaf_28: '叶片 28',
  leaf_29: '叶片 29',
  leaf_30: '叶片 30',
  leaf_31: '叶片 31',
  leaf_32: '叶片 32',
  leaf_33: '叶片 33',
  leaf_34: '叶片 34',
  leaf_35: '叶片 35',
  leaf_36: '叶片 36',
  leaf_37: '叶片 37',
  leaf_38: '叶片 38',
  leaf_39: '叶片 39',
  leaf_40: '叶片 40',
  leaf_41: '叶片 41',
  leaf_42: '叶片 42',
  leaf_43: '叶片 43',
  leaf_44: '叶片 44',
  leaf_45: '叶片 45',
  leaf_46: '叶片 46',
  leaf_47: '叶片 47',
  leaf_48: '叶片 48',
  leaf_49: '叶片 49',
  leaf_50: '叶片 50',
  leaf_51: '叶片 51',
  leaf_52: '叶片 52',
  leaf_53: '叶片 53',
  leaf_54: '叶片 54',
  leaf_55: '叶片 55',
  leaf_56: '叶片 56',
  leaf_57: '叶片 57',
  leaf_58: '叶片 58',
  leaf_59: '叶片 59',
  leaf_60: '叶片 60',
  leaf_61: '叶片 61',
  leaf_62: '叶片 62',
  leaf_63: '叶片 63',
  leaf_64: '叶片 64',
  leaf_65: '叶片 65',
  leaf_66: '叶片 66',
  leaf_67: '叶片 67',
  leaf_68: '叶片 68',
  leaf_69: '叶片 69',
  leaf_70: '叶片 70',
  leaf_71: '叶片 71',
  leaf_72: '叶片 72',
  leaf_73: '叶片 73',
  leaf_74: '叶片 74',
  leaf_75: '叶片 75',
  leaf_76: '叶片 76',
  leaf_77: '叶片 77',
  leaf_78: '叶片 78',
  leaf_79: '叶片 79',
  leaf_80: '叶片 80',
  leaf_81: '叶片 81',
  leaf_82: '叶片 82',
  leaf_83: '叶片 83',
  leaf_84: '叶片 84',
  leaf_85: '叶片 85',
  leaf_86: '叶片 86',
  leaf_87: '叶片 87',
  leaf_88: '叶片 88',
  leaf_89: '叶片 89',
  leaf_90: '叶片 90',
  leaf_91: '叶片 91',
  leaf_92: '叶片 92',
  leaf_93: '叶片 93',
  leaf_94: '叶片 94',
  leaf_95: '叶片 95',
  leaf_96: '叶片 96',
  leaf_97: '叶片 97',
  leaf_98: '叶片 98',
  leaf_99: '叶片 99',
  leaf_100: '叶片 100',
  leaf_101: '叶片 101',
  leaf_102: '叶片 102',
  leaf_103: '叶片 103',
  leaf_104: '叶片 104',
  leaf_105: '叶片 105',
  leaf_106: '叶片 106',
  leaf_107: '叶片 107',
  leaf_108: '叶片 108',
  leaf_109: '叶片 109',
  leaf_110: '叶片 110',
  leaf_111: '叶片 111',
  leaf_112: '叶片 112',
  leaf_113: '叶片 113',
  leaf_114: '叶片 114',
  leaf_115: '叶片 115',
  leaf_116: '叶片 116',
  leaf_117: '叶片 117',
  leaf_118: '叶片 118',
  leaf_119: '叶片 119',
  leaf_120: '叶片 120',
  leaf_121: '叶片 121',
  leaf_122: '叶片 122',
  leaf_123: '叶片 123',
  leaf_124: '叶片 124',
  leaf_125: '叶片 125',
  leaf_126: '叶片 126',
  leaf_127: '叶片 127',
  leaf_128: '叶片 128',
  leaf_129: '叶片 129',
  leaf_130: '叶片 130',
  leaf_131: '叶片 131',
  leaf_132: '叶片 132',
  leaf_133: '叶片 133',
  leaf_134: '叶片 134',
  leaf_135: '叶片 135',
  leaf_136: '叶片 136',
  leaf_137: '叶片 137',
  leaf_138: '叶片 138',
  leaf_139: '叶片 139',
  leaf_140: '叶片 140',
  leaf_141: '叶片 141',
  leaf_142: '叶片 142',
  leaf_143: '叶片 143',
  leaf_144: '叶片 144',
  leaf_145: '叶片 145',
  leaf_146: '叶片 146',
  leaf_147: '叶片 147',
  leaf_148: '叶片 148',
  leaf_149: '叶片 149',
  leaf_150: '叶片 150',
  leaf_151: '叶片 151',
  leaf_152: '叶片 152',
  leaf_153: '叶片 153',
  leaf_154: '叶片 154',
  leaf_155: '叶片 155',
  leaf_156: '叶片 156',
  leaf_157: '叶片 157',
  leaf_158: '叶片 158',
  leaf_159: '叶片 159',
  pine_leaf_1_1: '松叶 1-1',
  pine_leaf_1_2: '松叶 1-2',
  pine_leaf_1_3: '松叶 1-3',
  pine_leaf_1_4: '松叶 1-4',
  pine_leaf_1_5: '松叶 1-5',
  pine_leaf_1_6: '松叶 1-6',
  pine_leaf_1_7: '松叶 1-7',
  pine_leaf_1_8: '松叶 1-8',
  pine_leaf_1_9: '松叶 1-9',
  pine_leaf_1_10: '松叶 1-10',
  pine_leaf_1_11: '松叶 1-11',
  pine_leaf_1_12: '松叶 1-12',
  pine_leaf_1_13: '松叶 1-13',
  pine_leaf_1_14: '松叶 1-14',
  pine_leaf_1_15: '松叶 1-15',
  pine_leaf_2_1: '松叶 2-1',
  pine_leaf_2_2: '松叶 2-2',
  pine_leaf_2_3: '松叶 2-3',
  pine_leaf_2_4: '松叶 2-4',
  pine_leaf_2_5: '松叶 2-5',
  pine_leaf_2_6: '松叶 2-6',
  pine_leaf_2_7: '松叶 2-7',
  pine_leaf_2_8: '松叶 2-8',
  pine_leaf_2_9: '松叶 2-9',
  pine_leaf_2_10: '松叶 2-10',
  pine_leaf_2_11: '松叶 2-11',
  pine_leaf_2_12: '松叶 2-12',
  pine_leaf_2_13: '松叶 2-13',
  pine_leaf_2_14: '松叶 2-14',
  pine_leaf_2_15: '松叶 2-15',
  pine_leaf_3_1: '松叶 3-1',
  pine_leaf_3_2: '松叶 3-2',
  pine_leaf_3_3: '松叶 3-3',
  pine_leaf_3_4: '松叶 3-4',
  pine_leaf_3_5: '松叶 3-5',
  pine_leaf_3_6: '松叶 3-6',
  pine_leaf_3_7: '松叶 3-7',
  pine_leaf_3_8: '松叶 3-8',
  pine_leaf_3_9: '松叶 3-9',
  pine_leaf_3_10: '松叶 3-10',
  pine_leaf_3_11: '松叶 3-11',
  pine_leaf_3_12: '松叶 3-12',
  pine_leaf_3_13: '松叶 3-13',
  pine_leaf_3_14: '松叶 3-14',
  pine_leaf_3_15: '松叶 3-15',
  pine_leaf_4_1: '松叶 4-1',
  pine_leaf_4_2: '松叶 4-2',
  pine_leaf_4_3: '松叶 4-3',
  pine_leaf_4_4: '松叶 4-4',
  pine_leaf_4_5: '松叶 4-5',
  pine_leaf_4_6: '松叶 4-6',
  pine_leaf_4_7: '松叶 4-7',
  pine_leaf_4_8: '松叶 4-8',
  pine_leaf_4_9: '松叶 4-9',
  pine_leaf_4_10: '松叶 4-10',
  pine_leaf_4_11: '松叶 4-11',
  pine_leaf_4_12: '松叶 4-12',
  pine_leaf_4_13: '松叶 4-13',
  pine_leaf_4_14: '松叶 4-14',
  pine_leaf_4_15: '松叶 4-15',
  pine_leaf_5_1: '松叶 5-1',
  pine_leaf_5_2: '松叶 5-2',
  pine_leaf_5_3: '松叶 5-3',
  pine_leaf_5_4: '松叶 5-4',
  pine_leaf_5_5: '松叶 5-5',
  pine_leaf_5_6: '松叶 5-6',
  pine_leaf_5_7: '松叶 5-7',
  pine_leaf_5_8: '松叶 5-8',
  pine_leaf_5_9: '松叶 5-9',
  pine_leaf_5_10: '松叶 5-10',
  pine_leaf_5_11: '松叶 5-11',
  pine_leaf_5_12: '松叶 5-12',
  pine_leaf_5_13: '松叶 5-13',
  pine_leaf_5_14: '松叶 5-14',
  pine_leaf_5_15: '松叶 5-15',
  top_leaf_1: '顶部叶 1',
  top_leaf_2: '顶部叶 2',
  top_leaf_3: '顶部叶 3',
  top_leaf_4: '顶部叶 4',
  top_leaf_5: '顶部叶 5',
  top_leaf_6: '顶部叶 6',
  top_leaf_7: '顶部叶 7',
  top_leaf_8: '顶部叶 8',
  top_leaf_9: '顶部叶 9',
  top_leaf_10: '顶部叶 10',
  top_leaf_11: '顶部叶 11',
  top_leaf_12: '顶部叶 12',
  flower_1_petal_1: '花 1 花瓣 1',
  flower_1_petal_2: '花 1 花瓣 2',
  flower_1_petal_3: '花 1 花瓣 3',
  flower_1_petal_4: '花 1 花瓣 4',
  flower_1_petal_5: '花 1 花瓣 5',
  flower_1_petal_6: '花 1 花瓣 6',
  flower_1_core: '花 1 花心',
  flower_1_stem: '花 1 花茎',
  flower_1_leaf_a: '花 1 叶 A',
  flower_1_leaf_b: '花 1 叶 B',
  flower_2_petal_1: '花 2 花瓣 1',
  flower_2_petal_2: '花 2 花瓣 2',
  flower_2_petal_3: '花 2 花瓣 3',
  flower_2_petal_4: '花 2 花瓣 4',
  flower_2_petal_5: '花 2 花瓣 5',
  flower_2_petal_6: '花 2 花瓣 6',
  flower_2_core: '花 2 花心',
  flower_2_stem: '花 2 花茎',
  flower_2_leaf_a: '花 2 叶 A',
  flower_2_leaf_b: '花 2 叶 B',
  flower_3_petal_1: '花 3 花瓣 1',
  flower_3_petal_2: '花 3 花瓣 2',
  flower_3_petal_3: '花 3 花瓣 3',
  flower_3_petal_4: '花 3 花瓣 4',
  flower_3_petal_5: '花 3 花瓣 5',
  flower_3_petal_6: '花 3 花瓣 6',
  flower_3_core: '花 3 花心',
  flower_3_stem: '花 3 花茎',
  flower_3_leaf_a: '花 3 叶 A',
  flower_3_leaf_b: '花 3 叶 B',
  flower_s1_petal_1: '小花 1 花瓣 1',
  flower_s1_petal_2: '小花 1 花瓣 2',
  flower_s1_petal_3: '小花 1 花瓣 3',
  flower_s1_petal_4: '小花 1 花瓣 4',
  flower_s1_petal_5: '小花 1 花瓣 5',
  flower_s1_petal_6: '小花 1 花瓣 6',
  flower_s1_core: '小花 1 花心',
  flower_s1_stem: '小花 1 花茎',
  flower_s1_leaf_a: '小花 1 叶 A',
  flower_s1_leaf_b: '小花 1 叶 B',
  flower_s2_petal_1: '小花 2 花瓣 1',
  flower_s2_petal_2: '小花 2 花瓣 2',
  flower_s2_petal_3: '小花 2 花瓣 3',
  flower_s2_petal_4: '小花 2 花瓣 4',
  flower_s2_petal_5: '小花 2 花瓣 5',
  flower_s2_petal_6: '小花 2 花瓣 6',
  flower_s2_core: '小花 2 花心',
  flower_s2_stem: '小花 2 花茎',
  flower_s2_leaf_a: '小花 2 叶 A',
  flower_s2_leaf_b: '小花 2 叶 B',
  flower_petal_1: '主花 花瓣 1',
  flower_petal_2: '主花 花瓣 2',
  flower_petal_3: '主花 花瓣 3',
  flower_petal_4: '主花 花瓣 4',
  flower_petal_5: '主花 花瓣 5',
  flower_petal_6: '主花 花瓣 6',
  flower_core: '主花 花心',
  flower_stem: '主花 花茎',
  flower_leaf_a: '主花 叶 A',
  flower_leaf_b: '主花 叶 B',
  flower_side_a_petal_1: '侧花 A 花瓣 1',
  flower_side_a_petal_2: '侧花 A 花瓣 2',
  flower_side_a_petal_3: '侧花 A 花瓣 3',
  flower_side_a_petal_4: '侧花 A 花瓣 4',
  flower_side_a_petal_5: '侧花 A 花瓣 5',
  flower_side_a_petal_6: '侧花 A 花瓣 6',
  flower_side_a_core: '侧花 A 花心',
  flower_side_a_stem: '侧花 A 花茎',
  flower_side_a_leaf_a: '侧花 A 叶 A',
  flower_side_a_leaf_b: '侧花 A 叶 B',
  flower_side_b_petal_1: '侧花 B 花瓣 1',
  flower_side_b_petal_2: '侧花 B 花瓣 2',
  flower_side_b_petal_3: '侧花 B 花瓣 3',
  flower_side_b_petal_4: '侧花 B 花瓣 4',
  flower_side_b_petal_5: '侧花 B 花瓣 5',
  flower_side_b_petal_6: '侧花 B 花瓣 6',
  flower_side_b_core: '侧花 B 花心',
  flower_side_b_stem: '侧花 B 花茎',
  flower_side_b_leaf_a: '侧花 B 叶 A',
  flower_side_b_leaf_b: '侧花 B 叶 B',

  pot_rim: '花盆边沿',
  stand_top: '花架台面',

  crown_main_a: '树冠主面 A',
  crown_main_b: '树冠主面 B',
  crown_diag: '树冠斜面',
};
function townPartCn(name) {
  if (!name) { return ''; }
  var m = /^f(\d+)_(.*)$/.exec(name);
  var floor = '';
  var key = name;
  if (m) {
    key = m[2];
    floor = ['', '一层', '二层', '三层', '四层'][+m[1]] || ('第' + m[1] + '层');
  }
  var lab = TOWN_PART_CN[key];
  if (!lab) {
    var hc = /^hall_chair_(\d+)_(seat|cushion|back|leg_fl|leg_fr|leg_bl|leg_br|arm_left|arm_right)$/.exec(key);
    if (hc) {
      var hcn = {seat:'坐垫',cushion:'软垫',back:'靠背',leg_fl:'左前腿',leg_fr:'右前腿',leg_bl:'左后腿',leg_br:'右后腿',arm_left:'左扶手',arm_right:'右扶手'}[hc[2]] || hc[2];
      lab = '大厅座椅 ' + hc[1] + ' ' + hcn;
    }
  }
  if (!lab) {
    var hcol = /^hall_portico_(column|base|cap)_(\d+)$/.exec(key);
    if (hcol) { lab = '门廊' + ({column:'立柱',base:'柱础',cap:'柱头'}[hcol[1]] || hcol[1]) + ' ' + hcol[2]; }
  }
  if (!lab) {
    var hstep = /^hall_step_(\d+)$/.exec(key);
    if (hstep) { lab = '大厅台阶 ' + hstep[1]; }
  }
  if (!lab) {
    var hm = /^hall_front_mullion_(\d+)$/.exec(key);
    if (hm) { lab = '大厅前竖框 ' + hm[1]; }
  }
  if (!lab) {
    var tr = /^tp_rune_(\d+)$/.exec(key);
    if (tr) { lab = '传送符文 ' + tr[1]; }
  }
  if (!lab) {
    var tc = /^tp_crystal_(\d+)$/.exec(key);
    if (tc) { lab = '传送晶体 ' + tc[1]; }
  }
  if (!lab) {
    var stp = /^stair_step_(\d+)$/.exec(key);
    if (stp) { lab = '楼梯踏步 ' + stp[1]; }
  }
  if (!lab) {
    var bk2 = /^book_(\d+)$/.exec(key);
    if (bk2) { lab = '书 ' + bk2[1]; }
  }
  if (!lab) {
    var vf = /^villa_fin_(\d+)$/.exec(key);
    if (vf) { lab = '白色竖向格栅 ' + vf[1]; }
  }
  if (!lab) {
    var vt = /^villa_timber_screen_(\d+)$/.exec(key);
    if (vt) { lab = '木格栅 ' + vt[1]; }
  }
  if (!lab) {
    var bpost = /^balcony_post_(\d+)$/.exec(key);
    if (bpost) { lab = '阳台立柱 ' + bpost[1]; }
  }
  if (!lab) {
    var rgd = /^roof_garden_(\d+)$/.exec(key);
    if (rgd) { lab = '屋顶花园 ' + rgd[1]; }
  }
  if (!lab) {
    var mull = /^f1_front_mullion_(\d+)$/.exec(key);
    if (mull) { lab = '一层前竖框 ' + mull[1]; }
  }
  if (!lab) {
    var kb = /^kitchen_burner_(\d+)$/.exec(key);
    if (kb) { lab = '灶眼 ' + kb[1]; }
  }
  if (!lab) {
    var ais = /^aisle_shelf_(\d+)_(base|top|tier_(\d+)|product_(\d+)_(\d+)|leg_(fl|fr|bl|br))$/.exec(key);
    if (ais) {
      var an = {base:'底座',top:'顶板',leg_fl:'左前腿',leg_fr:'右前腿',leg_bl:'左后腿',leg_br:'右后腿'};
      if (ais[3]) { lab = '货架通道 ' + ais[1] + ' 第 ' + ais[3] + ' 层'; }
      else if (ais[4]) { lab = '货架通道 ' + ais[1] + ' 商品 ' + ais[4] + '-' + ais[5]; }
      else { lab = '货架通道 ' + ais[1] + ' ' + (an[ais[2]] || ais[2]); }
    }
  }
  if (!lab) {
    var ch = /^(outdoor_|dining_)?chair_(\d+)_(seat|cushion|back|leg_fl|leg_fr|leg_bl|leg_br|arm_left|arm_right)$/.exec(key);
    if (ch) {
      var chn = {seat:'坐垫',cushion:'软垫',back:'靠背',leg_fl:'左前腿',leg_fr:'右前腿',leg_bl:'左后腿',leg_br:'右后腿',arm_left:'左扶手',arm_right:'右扶手'}[ch[3]] || ch[3];
      lab = (ch[1] === 'outdoor_' ? '户外' : (ch[1] === 'dining_' ? '餐' : '')) + '椅子 ' + ch[2] + ' ' + chn;
    }
  }
  if (!lab) {
    var tb = /^(outdoor_)?table_(\d+)(_leg)?$/.exec(key);
    if (tb) { lab = (tb[1] ? '户外' : '') + '桌 ' + tb[2] + (tb[3] ? ' 桌腿' : ''); }
  }
  if (!lab) {
    var st2 = /^shelf_(\d+)_tier_(\d+)$/.exec(key);
    if (st2) { lab = '货架 ' + st2[1] + ' 第 ' + st2[2] + ' 层'; }
  }
  if (!lab) {
    var w = /^window_(\d+)_(glass|frame|light)$/.exec(key);
    if (w) {
      lab = '窗' + w[1] + ({ glass: '玻璃', frame: '窗框', light: '灯带' }[w[2]] || '');
    }
  }
  if (!lab) {
    var b = /^balcony_post_(\d+)$/.exec(key);
    if (b) { lab = '阳台立柱' + b[1]; }
  }
  if (!lab) { lab = key; }
  return floor ? (floor + ' · ' + lab) : lab;
}

var _TM_MATS = {};
function tmMat(c) {
  if (!_TM_MATS[c]) {
    _TM_MATS[c] = new THREE.MeshLambertMaterial({ color: c });
  }
  return _TM_MATS[c];
}
function tmTag(m, name) {
  if (!name) { return m; }
  m.name = name;
  m.userData.partName = name;
  m.userData.partLabel = townPartCn(name);
  return m;
}
function tmBox(g, w, h, d, c, x, y, z, ry, part) {
  var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), tmMat(c));
  m.position.set(x, y, z);
  if (ry) { m.rotation.y = ry; }
  m.castShadow = true;
  m.receiveShadow = true;
  tmTag(m, part);
  g.add(m);
  return m;
}
function tmPlane(g, w, d, c, x, y, z, part) {
  var m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), tmMat(c));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  tmTag(m, part);
  g.add(m);
  return m;
}

function tmCyl(g, rt, rb, h, c, x, y, z, part) {
  var m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 12), tmMat(c));
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  tmTag(m, part); g.add(m); return m;
}
function tmSphere(g, r, c, x, y, z, part) {
  var m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), tmMat(c));
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  tmTag(m, part); g.add(m); return m;
}


function tmGlassMat() {
  if (!_TM_GLASS) {
    _TM_GLASS = new THREE.MeshBasicMaterial({
      color: 0x9fd8e8, transparent: true, opacity: 0.18,
      depthWrite: false, side: THREE.DoubleSide
    });
  }
  return _TM_GLASS;
}
var _TM_GLASS = null;
function tmGlassBox(g, w, h, d, x, y, z, part) {
  var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), tmGlassMat());
  m.position.set(x, y, z);
  m.castShadow = false; m.receiveShadow = false;
  tmTag(m, part); g.add(m); return m;
}
function tmCone(g, rt, h, c, x, y, z, part) {
  var m = new THREE.Mesh(new THREE.ConeGeometry(rt, h, 12), tmMat(c));
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  tmTag(m, part); g.add(m); return m;
}

function tmFrontWall(g, add, W, wh, y0, t, front, floor, doorW, nWindows, wallColor) {
  var shape = new THREE.Shape();
  shape.moveTo(-W / 2, 0);
  shape.lineTo(W / 2, 0);
  shape.lineTo(W / 2, wh);
  shape.lineTo(-W / 2, wh);
  shape.closePath();
  if (floor === 0) {
    var dh = new THREE.Path();
    dh.moveTo(-doorW / 2, 0);
    dh.lineTo(doorW / 2, 0);
    dh.lineTo(doorW / 2, 2.08);
    dh.lineTo(-doorW / 2, 2.08);
    dh.closePath();
    shape.holes.push(dh);
  }
  var n = Math.max(0, nWindows || 0);
  for (var i = 0; i < n; i++) {
    var wx = -W * 0.5 + (i + 1) * W / (n + 1);
    if (floor === 0 && Math.abs(wx) < doorW * 0.85) { continue; }
    var wh2 = 1.05, wy = 0.93;
    var hp = new THREE.Path();
    hp.moveTo(wx - 0.62, wy);
    hp.lineTo(wx + 0.62, wy);
    hp.lineTo(wx + 0.62, wy + wh2);
    hp.lineTo(wx - 0.62, wy + wh2);
    hp.closePath();
    shape.holes.push(hp);
  }
  var geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
  var mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({color: wallColor || 0xd9cdb8, side: THREE.DoubleSide}));
  mesh.position.set(0, y0, front - t / 2);
  mesh.castShadow = true; mesh.receiveShadow = true;
  tmTag(mesh, 'f' + (floor + 1) + '_front_wall');
  g.add(mesh);
  g.userData.parts.push({ id: mesh.userData.partName, cn: townPartCn(mesh.userData.partName) });
  return mesh;
}

function buildChairAt(g, add, x, z, ry, prefix, color, y0) {
  var c = color || 0x8a5a3a;
  var yb = y0 || 0;
  var piece = tmBeginPiece(g, 'chair_wood', { label: '木椅', floor: yb > 1 ? 1 : 0 });
  function rp(lx, lz) {
    return [x + lx * Math.cos(ry) + lz * Math.sin(ry),
            z - lx * Math.sin(ry) + lz * Math.cos(ry)];
  }
  function put(w, h, d, col, px, py, pz, name, rot) {
    var m = tmBox(g, w, h, d, col, px, py, pz, rot);
    tmTag(m, name);
    tmBind(piece, m);
    return m;
  }
  /* ★ 2026-10-22（用户："椅子样式可以不一样，但坐垫高度要一样"）：
     坐垫顶面统一到 0.48（= 坐下时人被抬到的绝对高度）。
     原来坐垫中心 0.535、厚 0.06 → 顶面 0.565，比目标高 0.085，整体下移这么多。 */
  var SEAT_TOP = 0.48;              /* 所有座椅统一的坐垫顶面高度 */
  var CUSH = 0.06;                  /* 坐垫厚度 */
  var yShift = 0.085;               /* 原模型整体下移量（0.565 - 0.48） */
  var a = rp(0, 0), b;
  put(0.50, 0.09, 0.48, c, a[0], yb + 0.48 - yShift, a[1], prefix + '_seat');
  put(0.44, CUSH, 0.40, 0xd8cbb0, a[0], yb + (SEAT_TOP - CUSH / 2), a[1], prefix + '_cushion');
  b = rp(0, -0.22);
  put(0.50, 0.55, 0.07, c, b[0], yb + 0.80 - yShift, b[1], prefix + '_back', ry);
  var legs = [['fl', -0.20, 0.18], ['fr', 0.20, 0.18], ['bl', -0.20, -0.18], ['br', 0.20, -0.18]];
  for (var i = 0; i < legs.length; i++) {
    b = rp(legs[i][1], legs[i][2]);
    put(0.055, 0.42, 0.055, 0x4a3423, b[0], yb + 0.24 - yShift, b[1], prefix + '_leg_' + legs[i][0]);
  }
  b = rp(-0.25, 0.0);
  put(0.045, 0.06, 0.38, 0x4a3423, b[0], yb + 0.66 - yShift, b[1], prefix + '_arm_left', ry);
  b = rp(0.25, 0.0);
  put(0.045, 0.06, 0.38, 0x4a3423, b[0], yb + 0.66 - yShift, b[1], prefix + '_arm_right', ry);
  tmEndPiece(g, piece);
}

function buildFridgeAt(g, add, x, z, ry) {
  var fg = new THREE.Group();
  fg.position.set(x, 0, z);
  fg.rotation.y = ry || 0;
  g.add(fg);
  var piece = tmBeginPiece(g, 'fridge_display', { label: '展示冰箱', floor: 0 });
  var body = 0x7d858a, trim = 0x2f3438;
  function fp(m, name) { tmTag(m, name); tmBind(piece, m); return m; }
  fp(tmBox(fg, 0.78, 1.94, 0.72, body, 0, 1.24, 0), 'fridge_body');
  fp(tmBox(fg, 0.82, 0.07, 0.76, trim, 0, 2.24, 0), 'fridge_top');
  fp(tmBox(fg, 0.80, 0.10, 0.74, trim, 0, 0.30, 0), 'fridge_base');
  fp(tmBox(fg, 0.70, 1.60, 0.035, 0x10171b, 0, 1.30, 0.372), 'fridge_inner');
  var gl = tmGlassBox(fg, 0.65, 1.50, 0.025, 0, 1.30, 0.392, 'fridge_glass');
  tmBind(piece, gl);
  fp(tmBox(fg, 0.03, 1.52, 0.05, trim, 0, 1.30, 0.405), 'fridge_center_frame');
  fp(tmBox(fg, 0.025, 1.52, 0.04, 0xd8d2c4, -0.25, 1.30, 0.415), 'fridge_handle_left');
  fp(tmBox(fg, 0.025, 1.52, 0.04, 0xd8d2c4, 0.25, 1.30, 0.415), 'fridge_handle_right');
  fp(tmBox(fg, 0.68, 0.045, 0.05, 0xd8d2c4, 0, 1.70, 0.405), 'fridge_shelf_1');
  fp(tmBox(fg, 0.68, 0.045, 0.05, 0xd8d2c4, 0, 1.20, 0.405), 'fridge_shelf_2');
  fp(tmBox(fg, 0.13, 0.24, 0.11, 0xb84a3a, -0.20, 1.34, 0.34), 'fridge_can_1');
  fp(tmBox(fg, 0.11, 0.20, 0.11, 0x5c8a52, 0.01, 1.44, 0.34), 'fridge_can_2');
  fp(tmBox(fg, 0.10, 0.18, 0.10, 0xe8c060, 0.22, 1.31, 0.34), 'fridge_can_3');
  fp(tmBox(fg, 0.10, 0.18, 0.10, 0x5c7a8a, -0.05, 1.02, 0.34), 'fridge_can_4');
  tmEndPiece(g, piece);
  return fg;
}

function buildCoffeeMachine(g, add, x, y, z) {
  var piece = tmBeginPiece(g, 'coffee_machine', { label: '咖啡机', floor: y > 1 ? 1 : 0 });
  function b(w, h, d, c, ox, oy, oz, name) {
    var m = tmBox(g, w, h, d, c, ox, oy, oz);
    tmTag(m, name); tmBind(piece, m); return m;
  }
  b(0.72, 0.42, 0.44, 0x3d4549, x, y + 0.28, z, 'coffee_machine');
  b(0.70, 0.07, 0.42, 0xbfc4c2, x, y + 0.51, z, 'coffee_machine_top');
  b(0.16, 0.14, 0.10, 0xd8d2c4, x, y + 0.20, z + 0.25, 'portafilter');
  b(0.14, 0.10, 0.12, 0x8a5a3a, x + 0.22, y + 0.10, z + 0.23, 'coffee_cup');
  b(0.04, 0.22, 0.04, 0xd8d2c4, x - 0.28, y + 0.18, z + 0.24, 'steam_wand');
  b(0.16, 0.12, 0.12, 0x6b4a32, x - 0.18, y + 0.58, z - 0.02, 'coffee_beans');
  tmEndPiece(g, piece);
}

function addNpcStand(g, add, x, z, name, color) {
  var m = new THREE.Mesh(new THREE.CircleGeometry(0.30, 18),
    new THREE.MeshBasicMaterial({ color: color || 0x6fe0ff, transparent: true, opacity: 0.42,
      depthWrite: false, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.285, z);
  g.add(m);
  add(m, name);
}

function buildCashRegister(g, add, x, y, z, ry) {
  var rg = new THREE.Group();
  rg.position.set(x, y, z);
  rg.rotation.y = ry || 0;
  g.add(rg);
  function rb(w, h, d, c, ox, oy, oz, name) {
    var m = tmBox(rg, w, h, d, c, ox, oy, oz);
    tmTag(m, name); return m;
  }
  rb(0.52, 0.17, 0.38, 0x2f3438, 0, 0.09, 0, 'cash_register_body');
  rb(0.46, 0.20, 0.06, 0x10191d, 0, 0.34, -0.17, 'cash_register_screen');
  rb(0.40, 0.03, 0.20, 0x6f7a80, 0, 0.21, 0.05, 'cash_register_keys');
  rb(0.22, 0.05, 0.10, 0xe8e0c8, -0.16, 0.25, 0.16, 'cash_register_receipt');
  rb(0.10, 0.07, 0.16, 0x232a2e, 0.20, 0.08, 0.20, 'cash_register_card');
  rb(0.05, 0.18, 0.05, 0x232a2e, 0.19, 0.34, -0.15, 'cash_register_scanner');
}

function buildMartShelfRow(g, add, x, z, ry, prefix) {
  var fg = new THREE.Group();
  fg.position.set(x, 0, z);
  fg.rotation.y = ry || 0;
  g.add(fg);
  var P = tmPiece(g, 'aisle_shelf', '超市货架通道');
  function addm(m, name) { tmTag(m, name); P.add(m); return m; }
  addm(tmBox(fg, 0.72, 0.12, 3.20, 0x5f4630, 0, 0.35, 0), prefix + '_base');
  addm(tmBox(fg, 0.74, 0.08, 3.30, 0x8a6a48, 0, 1.55, 0), prefix + '_top');
  for (var sh = 0; sh < 4; sh++) {
    addm(tmBox(fg, 0.72, 0.05, 3.10, 0x9a7650, 0, 0.50 + sh * 0.36, 0), prefix + '_tier_' + (sh + 1));
    for (var it = 0; it < 5; it++) {
      addm(tmBox(fg, 0.16, 0.18, 0.22,
        [0xd8708a, 0xe8c060, 0x9fe0a8, 0x9fc4e8, 0xd8a45a][(sh + it) % 5],
        -0.22 + (it % 2) * 0.30, 0.62 + sh * 0.36, -1.25 + it * 0.62),
        prefix + '_product_' + (sh + 1) + '_' + (it + 1));
    }
  }
  addm(tmBox(fg, 0.10, 1.55, 0.10, 0x4a3423, -0.32, 0.78, -1.58), prefix + '_leg_fl');
  addm(tmBox(fg, 0.10, 1.55, 0.10, 0x4a3423, 0.32, 0.78, -1.58), prefix + '_leg_fr');
  addm(tmBox(fg, 0.10, 1.55, 0.10, 0x4a3423, -0.32, 0.78, 1.58), prefix + '_leg_bl');
  addm(tmBox(fg, 0.10, 1.55, 0.10, 0x4a3423, 0.32, 0.78, 1.58), prefix + '_leg_br');
  tmPieceEnd(g, P);
}

function buildMartInterior(g, add, W, D, H) {
  /* ★ 2026-10-22：同上，家具交给布局，这里只画室内地板。 */
  var iw = W - 0.65, id = D - 0.65;
  add(tmBox(g, iw, 0.05, id, 0x9a968a, 0, 0.255, 0), 'interior_floor');
}

function buildBedAt(g, add, x, z, ry, y0) {
  var bg = new THREE.Group();
  bg.position.set(x, y0 || 0, z);
  bg.rotation.y = ry || 0;
  g.add(bg);
  var piece = tmBeginPiece(g, 'bed_single', { label: '单人床', floor: y0 > 1 ? 1 : 0 });
  function b(w, h, d, c, ox, oy, oz, name, rot) {
    var m = tmBox(bg, w, h, d, c, ox, oy, oz, rot);
    tmTag(m, name);
    tmBind(piece, m);
    return m;
  }
  /* ★ 2026-10-22（用户："床垫也统一到 0.48"）：
     原来床垫顶面 0.43+0.10=0.53，整体下移 0.05 → 顶面 0.48。 */
  var _bedShift = 0.05;
  b(1.60, 0.22, 2.05, 0x6b4a32, 0, 0.22 - _bedShift, 0, 'bed_frame');
  b(1.48, 0.20, 1.92, 0xe8e0d0, 0, 0.43 - _bedShift, 0, 'bed_mattress');
  b(1.42, 0.08, 0.95, 0x7a9aa8, 0, 0.56 - _bedShift, 0.42, 'bed_blanket');
  b(0.55, 0.16, 0.34, 0xf2eee4, -0.34, 0.60 - _bedShift, -0.72, 'bed_pillow_l');
  b(0.55, 0.16, 0.34, 0xf2eee4, 0.34, 0.60 - _bedShift, -0.72, 'bed_pillow_r');
  b(1.60, 0.85, 0.10, 0x5a3e32, 0, 0.55 - _bedShift, -1.02, 'bed_headboard');
  b(0.12, 0.35, 0.12, 0x4a3423, -0.70, 0.17, 0.92, 'bed_leg_fl');
  b(0.12, 0.35, 0.12, 0x4a3423, 0.70, 0.17, 0.92, 'bed_leg_fr');
  b(0.12, 0.35, 0.12, 0x4a3423, -0.70, 0.17, -0.92, 'bed_leg_bl');
  b(0.12, 0.35, 0.12, 0x4a3423, 0.70, 0.17, -0.92, 'bed_leg_br');
  tmEndPiece(g, piece);
  /* nightstand and lamp are separate placeable items */
  var Pn = tmBeginPiece(g, 'bed_nightstand', { label: '床头柜', floor: y0 > 1 ? 1 : 0 });
  var mn = tmBox(bg, 0.45, 0.48, 0.42, 0x6b4a32, 1.05, 0.30, -0.72);
  tmTag(mn, 'bed_nightstand'); tmBind(Pn, mn); tmEndPiece(g, Pn);

  var Pl = tmBeginPiece(g, 'bed_lamp', { label: '床头灯', floor: y0 > 1 ? 1 : 0 });
  var ml = tmBox(bg, 0.16, 0.28, 0.16, 0xffd9a0, 1.05, 0.67, -0.72);
  tmTag(ml, 'bed_lamp'); tmBind(Pl, ml); tmEndPiece(g, Pl);
}

function buildSofaAt(g, add, x, z, ry, y0) {
  var sg = new THREE.Group();
  sg.position.set(x, y0 || 0, z);
  sg.rotation.y = ry || 0;
  g.add(sg);
  var piece = tmBeginPiece(g, 'sofa_modern_2', { label: '双人沙发', floor: y0 > 1 ? 1 : 0 });
  function b(w, h, d, c, ox, oy, oz, name) {
    var m = tmBox(sg, w, h, d, c, ox, oy, oz);
    tmTag(m, name);
    tmBind(piece, m);
    return m;
  }
  /* ★ 2026-10-22：沙发坐垫顶面也统一到 0.48（原来 0.54+0.06=0.60，高 0.12）。
     其它部件整体下移 0.12，保持造型比例。 */
  var _sy2 = 0.12;
  b(1.95, 0.35, 0.82, 0x5a6e7a, 0, 0.32 - _sy2, 0, 'sofa_base');
  b(1.95, 0.62, 0.18, 0x4e606b, 0, 0.76 - _sy2, -0.32, 'sofa_back');
  b(0.18, 0.52, 0.82, 0x4e606b, -0.88, 0.52 - _sy2, 0, 'sofa_arm_left');
  b(0.18, 0.52, 0.82, 0x4e606b, 0.88, 0.52 - _sy2, 0, 'sofa_arm_right');
  /* 坐垫：顶面固定 0.48（厚 0.12 → 中心 0.42） */
  b(0.84, 0.12, 0.62, 0x7d94a0, -0.44, 0.42, 0.02, 'sofa_cushion_l');
  b(0.84, 0.12, 0.62, 0x7d94a0, 0.44, 0.42, 0.02, 'sofa_cushion_r');
  b(0.10, 0.18, 0.10, 0x3a2a20, -0.82, 0.09 - _sy2, 0.30, 'sofa_leg_l');
  b(0.10, 0.18, 0.10, 0x3a2a20, 0.82, 0.09 - _sy2, 0.30, 'sofa_leg_r');
  tmEndPiece(g, piece);
}

function buildKitchenAt(g, add, W, D) {
  var kx = W / 2 - 0.58, kz = 1.20;
  /* counter + top + sink + stove + oven + cabinet = separate manageable pieces */
  var Pc = tmPiece(g, 'kitchen_counter', '厨房操作台');
  Pc.add(add(tmBox(g, 0.62, 0.90, 2.80, 0xc8b998, kx, 0.72, kz), 'kitchen_counter'));
  Pc.add(add(tmBox(g, 0.78, 0.10, 2.95, 0x8a959b, kx, 1.22, kz), 'kitchen_top'));
  tmPieceEnd(g, Pc);

  var Ps = tmPiece(g, 'kitchen_sink', '水槽');
  Ps.add(add(tmBox(g, 0.44, 0.06, 0.72, 0x5a6e7a, kx, 1.28, kz + 0.82), 'kitchen_sink'));
  Ps.add(add(tmBox(g, 0.06, 0.30, 0.06, 0x9aa3a8, kx - 0.22, 1.44, kz + 0.82), 'kitchen_faucet'));
  tmPieceEnd(g, Ps);

  var Pst = tmPiece(g, 'kitchen_stove', '灶台');
  Pst.add(add(tmBox(g, 0.52, 0.08, 0.82, 0x2f3438, kx, 1.28, kz - 0.62), 'kitchen_stove'));
  for (var bn = 0; bn < 4; bn++) {
    Pst.add(add(tmCyl(g, 0.10, 0.10, 0.025, 0x59666a, kx - 0.12 + (bn % 2) * 0.24,
      1.33, kz - 0.86 + Math.floor(bn / 2) * 0.30), 'kitchen_burner_' + (bn + 1)));
  }
  tmPieceEnd(g, Pst);

  var Po = tmPiece(g, 'kitchen_oven', '烤箱');
  Po.add(add(tmBox(g, 0.04, 0.55, 0.82, 0x2f3438, kx - 0.32, 0.62, kz - 0.62), 'kitchen_oven'));
  Po.add(add(tmBox(g, 0.04, 0.04, 0.36, 0xbfc4c2, kx - 0.35, 0.72, kz - 0.62), 'kitchen_oven_handle'));
  tmPieceEnd(g, Po);

  var Pk = tmPiece(g, 'kitchen_cabinet', '厨房吊柜');
  Pk.add(add(tmBox(g, 0.34, 0.75, 2.45, 0x9a8a70, W / 2 - 0.18, 2.24, kz - 0.15), 'kitchen_cabinet'));
  Pk.add(add(tmBox(g, 0.35, 0.30, 0.78, 0xd8d2c4, W / 2 - 0.50, 2.20, kz - 0.62), 'kitchen_range_hood'));
  tmPieceEnd(g, Pk);
}
function buildBathroomAt(g, add) {
  var Pt = tmPiece(g, 'toilet', '马桶');
  Pt.add(add(tmBox(g, 0.50, 0.35, 0.62, 0xe8e4d8, 1.65, 0.43, -3.45), 'toilet_base'));
  Pt.add(add(tmCyl(g, 0.25, 0.28, 0.16, 0xf2eee4, 1.65, 0.68, -3.40), 'toilet_bowl'));
  Pt.add(add(tmBox(g, 0.50, 0.62, 0.22, 0xe8e4d8, 1.65, 0.88, -3.78), 'toilet_tank'));
  Pt.add(add(tmBox(g, 0.30, 0.04, 0.04, 0xbfc4c2, 1.65, 1.22, -3.66), 'toilet_flush'));
  tmPieceEnd(g, Pt);

  var Pv = tmPiece(g, 'bath_vanity', '洗手台');
  Pv.add(add(tmBox(g, 0.80, 0.78, 0.44, 0xb8a88a, 2.95, 0.39, -3.55), 'bath_vanity'));
  Pv.add(add(tmBox(g, 0.66, 0.07, 0.34, 0xe8e4d8, 2.95, 0.82, -3.52), 'bath_basin'));
  Pv.add(add(tmBox(g, 0.05, 0.26, 0.05, 0x9aa3a8, 2.95, 0.98, -3.70), 'bath_faucet'));
  tmPieceEnd(g, Pv);

  var Pm = tmPiece(g, 'bath_mirror', '浴室镜');
  Pm.add(add(tmBox(g, 0.75, 0.75, 0.04, 0x9fd8e8, 2.95, 1.65, -3.78), 'bath_mirror'));
  tmPieceEnd(g, Pm);

  var Psh = tmPiece(g, 'shower_tray', '淋浴间');
  Psh.add(add(tmBox(g, 1.05, 0.10, 1.05, 0x59666a, 2.75, 0.30, -2.45), 'shower_tray'));
  Psh.add(add(tmGlassBox(g, 0.04, 1.80, 1.05, 2.28, 1.15, -2.45, 'shower_glass'), 'shower_glass'));
  tmPieceEnd(g, Psh);
}
function buildHouseInterior(g, add, W, D, H) {
  /* ★ 2026-10-22（用户：家具重叠）：这里以前自己画了一整套家具
     （地毯/沙发/电视/电视柜/餐桌/椅子/衣柜/盆栽/吊灯），
     而布局文件又生成一份 → 两套重叠。现在只画建筑固有部分。 */
  var iw = W - 0.45, id = D - 0.45;
  add(tmBox(g, iw, 0.05, id, 0xa8865c, 0, 0.255, 0), 'interior_floor');
  /* 隔断墙（建筑固有，保留）*/
  add(tmBox(g, 1.00, 2.65, 0.12, 0xe4dccb, 1.78, 1.32, -2.05), 'partition_bath_front');
  add(tmBox(g, 0.12, 2.65, 2.0, 0xe4dccb, 1.25, 1.32, -3.05), 'partition_bath_side');
}


/* ---------- wall art / umbrella / outdoor seating ---------- */
function buildWallArt(g, add, x, y, z, ry, prefix, artColor) {
  var P = tmPiece(g, 'wall_art', '挂画');
  P.add(add(tmBox(g, 0.92, 0.72, 0.06, 0x4a3423, x, y, z, ry), prefix + '_frame'));
  P.add(add(tmBox(g, 0.78, 0.58, 0.02, artColor || 0x9fb7b0, x, y, z + 0.045, ry), prefix + '_picture'));
  tmPieceEnd(g, P);
}

function buildUmbrella(g, add, x, z) {
  var P = tmPiece(g, 'umbrella', '遮阳伞');
  P.add(add(tmCyl(g, 0.035, 0.045, 2.25, 0x6b4a32, x, 1.30, z), 'umbrella_pole'));
  P.add(add(tmCone(g, 1.35, 0.48, 0xd8cbb0, x, 2.55, z), 'umbrella_canopy'));
  P.add(add(tmBox(g, 0.34, 0.10, 0.34, 0x4a3423, x, 0.24, z), 'umbrella_base'));
  tmPieceEnd(g, P);
}

function buildCafeOutdoor(g, add, W, D) {
  var z = D / 2 + 1.55;
  var x = W * 0.29;
  var t1 = tmPiece(g, 'outdoor_table', '户外桌');
  t1.add(add(tmBox(g, 1.20, 0.10, 0.82, 0x6b4a32, x, 0.615, z), 'outdoor_table_1'));
  t1.add(add(tmBox(g, 0.10, 0.58, 0.10, 0x4a3423, x, 0.325, z), 'outdoor_table_1_leg'));
  tmPieceEnd(g, t1);
  buildChairAt(g, add, x - 0.92, z, Math.PI / 2, 'outdoor_chair_1', 0x8a5a3a);
  buildChairAt(g, add, x + 0.92, z, -Math.PI / 2, 'outdoor_chair_2', 0x8a5a3a);
  buildUmbrella(g, add, x + 1.25, z + 0.35);

  var x2 = -W * 0.27;
  var t2 = tmPiece(g, 'outdoor_table', '户外桌');
  t2.add(add(tmBox(g, 0.90, 0.10, 0.65, 0x6b4a32, x2, 0.595, z), 'outdoor_table_2'));
  t2.add(add(tmBox(g, 0.10, 0.56, 0.10, 0x4a3423, x2, 0.305, z), 'outdoor_table_2_leg'));
  tmPieceEnd(g, t2);
  buildChairAt(g, add, x2 - 0.70, z, Math.PI / 2, 'outdoor_chair_3', 0x8a5a3a);
  buildChairAt(g, add, x2 + 0.70, z, -Math.PI / 2, 'outdoor_chair_4', 0x8a5a3a);
}

function buildTownInterior(g, spec, add, W, D, H) {
  if (!spec) { return; }
  if (spec.type === 'house' && spec.interior === 'home') { buildHouseInterior(g, add, W, D, H); return; }
  if (spec.type !== 'shop' && spec.type !== 'public') { return; }
  if (spec.interior === 'mart') { buildMartInterior(g, add, W, D, H); return; }

  /* ★★★ 2026-10-22（用户：桌椅重叠）★★★
     这个函数以前自己画了一整套家具（柜台/菜单板/吊灯/咖啡机/挂画/挂钟/
     墙菜单/两个货架/餐桌/两把椅子/冰箱/盆栽/户外区），
     而建筑放置时【又按 layout_json 生成了一份同样的家具】→ 两套完全重叠。
     现在这里只画建筑固有的东西（室内地板），家具全部交给布局。 */
  var iw = W - 0.65, id = D - 0.65;
  add(tmBox(g, iw, 0.05, id, 0x8a6a48, 0, 0.255, 0), 'interior_floor');
}



/* ---------- furniture instances (v4.1) ----------
 * Buildings carry default furniture.  Instead of reparenting meshes (which would
 * disturb the preview), we collect one record per furniture piece while building:
 *   { catalog, x, y, z, rot, w, d, h }
 * The placement system turns these into town_objects when the building is placed.
 */



/* ---------- furniture pieces (v4.2) ----------
 * tmBeginPiece(g, catalogId) starts a piece; every mesh created through the
 * returned add() is bound to it.  tmEndPiece computes the AABB and stores the
 * record on the model group.  Nothing is inferred from names, so a piece is
 * always complete.
 */
function tmPieceCtx(g) {
  if (!g.userData.pieces) { g.userData.pieces = []; }
  return g.userData.pieces;
}


/* the model root is the first ancestor that already carries a piece list,
   falling back to the given group */
function tmRoot(g) {
  var n = g;
  while (n) {
    if (n.userData && n.userData.pieces) { return n; }
    n = n.parent;
  }
  return g;
}

function tmBeginPiece(g, catalogId, meta) {
  g = tmRoot(g);
  var ctx = tmPieceCtx(g);
  var piece = {
    catalog: catalogId,
    meta: meta || {},
    meshes: [],
    box: new THREE.Box3()
  };
  ctx.push(piece);
  return piece;
}

function tmBind(piece, mesh) {
  if (!piece || !mesh) { return mesh; }
  piece.meshes.push(mesh);
  return mesh;
}

function tmEndPiece(g, piece) {
  if (!piece) { return null; }
  g = tmRoot(g);
  g.updateMatrixWorld(true);
  for (var i = 0; i < piece.meshes.length; i++) {
    if (piece.meshes[i].visible !== false) { piece.box.expandByObject(piece.meshes[i]); }
  }
  if (piece.box.isEmpty() && piece.meshes.length) {
    for (var j = 0; j < piece.meshes.length; j++) { piece.box.expandByObject(piece.meshes[j]); }
  }
  var c = piece.box.getCenter(new THREE.Vector3());
  var sz = piece.box.getSize(new THREE.Vector3());
  piece.x = +c.x.toFixed(3); piece.y = +c.y.toFixed(3); piece.z = +c.z.toFixed(3);
  piece.w = +sz.x.toFixed(3); piece.d = +sz.z.toFixed(3); piece.h = +sz.y.toFixed(3);
  piece.parts = piece.meshes.length;
  return piece;
}

/* collect all registered pieces into the serialisable furniture list */
function tmCollectFurniture(g) {
  var pieces = [];
  g.traverse(function (n) {
    if (n.userData && n.userData.pieces && n.userData.pieces.length) {
      for (var k = 0; k < n.userData.pieces.length; k++) {
        var p2 = n.userData.pieces[k];
        if (pieces.indexOf(p2) < 0) { pieces.push(p2); }
      }
    }
  });
  var out = [];
  for (var i = 0; i < pieces.length; i++) {
    var pc = tmEndPiece(g, pieces[i]);
    if (!pc || !pc.parts) { continue; }
    out.push({
      catalog: pc.catalog,
      x: pc.x, y: pc.y, z: pc.z,
      w: pc.w, d: pc.d, h: pc.h,
      parts: pc.parts,
      label: (pc.meta && pc.meta.label) || townPartCn('piece_' + pc.catalog) || pc.catalog,
      floor: (pc.meta && pc.meta.floor) || 0
    });
  }
  g.userData.furniture = out;
  g.userData.furnitureCount = out.length;
  return out;
}


/* multi-mesh piece scoping: all meshes added to P count as ONE furniture item */
function tmPiece(g, catalog, label, floor) {
  var piece = tmBeginPiece(g, catalog, { label: label, floor: floor || 0 });
  piece.add = function (m) { tmBind(piece, m); return m; };
  return piece;
}
function tmPieceEnd(g, piece) { return tmEndPiece(g, piece); }


/* ---------- 独立家具模型（v4.3）----------
 * 目录里的每件家具在放置时需要自己的几何体。复用内景里已经写好的
 * buildXxxAt 函数，包成 TOWN_MODELS 可以直接构建的规格。
 */
var TOWN_FURNITURE_SPECS = {
  bed_single:      { w: 1.60, d: 2.05, h: 1.00, label: '单人床' },
  bed_nightstand:  { w: 0.45, d: 0.42, h: 0.55, label: '床头柜' },
  sofa_modern_2:   { w: 1.95, d: 0.82, h: 1.07, label: '双人沙发' },
  chair_wood:      { w: 0.50, d: 0.48, h: 0.90, label: '木椅' },
  hall_chair:      { w: 0.50, d: 0.48, h: 0.90, label: '大厅座椅' },
  desk_chair:      { w: 0.50, d: 0.48, h: 0.90, label: '书桌椅' },
  dining_table:    { w: 1.45, d: 0.86, h: 0.75, label: '餐桌' },
  outdoor_table:   { w: 1.20, d: 0.82, h: 0.70, label: '户外桌' },
  wardrobe:        { w: 1.10, d: 0.55, h: 1.85, label: '衣柜' },
  desk:            { w: 1.30, d: 0.70, h: 0.78, label: '书桌' },
  bookshelf:       { w: 1.20, d: 0.30, h: 0.80, label: '书架' },
  rug_rect:        { w: 2.60, d: 1.80, h: 0.05, label: '地毯' },
  tv_wall:         { w: 1.05, d: 0.10, h: 0.55, label: '壁挂电视' },
  tv_stand:        { w: 1.20, d: 0.30, h: 0.45, label: '电视柜' },
  coffee_table:    { w: 1.10, d: 0.70, h: 0.50, label: '茶几' },
  fridge_display:  { w: 0.78, d: 0.72, h: 2.24, label: '展示冰箱' },
  toilet:          { w: 0.50, d: 0.62, h: 1.22, label: '马桶' },
  bath_vanity:     { w: 0.80, d: 0.44, h: 0.78, label: '洗手台' },
  bath_mirror:     { w: 0.75, d: 0.05, h: 0.75, label: '浴室镜' },
  shower_tray:     { w: 1.05, d: 1.05, h: 1.80, label: '淋浴间' },
  bathtub:         { w: 1.25, d: 0.70, h: 0.55, label: '浴缸' },
  kitchen_counter: { w: 2.80, d: 0.62, h: 0.90, label: '厨房操作台' },
  kitchen_sink:    { w: 0.44, d: 0.72, h: 0.15, label: '水槽' },
  kitchen_stove:   { w: 0.52, d: 0.82, h: 0.10, label: '灶台' },
  kitchen_oven:    { w: 0.82, d: 0.04, h: 0.55, label: '烤箱' },
  kitchen_cabinet: { w: 2.45, d: 0.34, h: 0.75, label: '厨房吊柜' },
  kitchen_island:  { w: 2.40, d: 1.00, h: 1.10, label: '厨房中岛' },
  shop_counter:    { w: 3.20, d: 0.62, h: 0.95, label: '柜台' },
  checkout_counter:{ w: 3.20, d: 0.62, h: 0.95, label: '收银台' },
  cash_register:   { w: 0.52, d: 0.38, h: 0.42, label: '收银机' },
  coffee_machine:  { w: 0.72, d: 0.44, h: 0.60, label: '咖啡机' },
  menu_board:      { w: 0.70, d: 0.35, h: 0.38, label: '菜单板' },
  wall_menu:       { w: 0.85, d: 0.03, h: 1.05, label: '墙菜单' },
  wall_art:        { w: 0.92, d: 0.06, h: 0.72, label: '挂画' },
  wall_clock:      { w: 0.44, d: 0.06, h: 0.44, label: '挂钟' },
  shop_shelf:      { w: 0.72, d: 2.20, h: 1.90, label: '货架' },
  aisle_shelf:     { w: 0.72, d: 3.20, h: 1.55, label: '超市货架' },
  shopping_cart:   { w: 0.45, d: 0.55, h: 0.55, label: '购物车' },
  basket_stack:    { w: 0.45, d: 0.32, h: 0.60, label: '购物篮堆' },
  promo_board:     { w: 1.10, d: 0.05, h: 0.55, label: '促销牌' },
  umbrella:        { w: 2.70, d: 2.70, h: 2.80, label: '遮阳伞' },
  plant_pot:       { w: 0.44, d: 0.44, h: 0.80, label: '盆栽' },
  ceiling_lamp:    { w: 0.22, d: 0.22, h: 0.30, label: '吊灯' }
};

/* 把每件家具包成一个可独立构建的规格（带 build 钩子） */
function tmFurnitureModelFor(id) {
  var f = TOWN_FURNITURE_SPECS[id];
  if (!f) { return null; }
  return {
    name: f.label, type: 'furniture', w: f.w, d: f.d, h: f.h, floors: 0,
    roof: 'none', wall: 0x8a5a3a, trim: 0x4a3423, roofColor: 0x4a3423,
    door: 'none', windows: 0, furnitureId: id, desc: f.label
  };
}

/* 独立家具的构建：把整套家具直接建在原点 */
function buildFurnitureModel(spec, opts) {
  var g = new THREE.Group();
  g.userData.parts = [];
  function add(m, name) {
    if (m) { tmTag(m, name); g.userData.parts.push({ id: name, cn: townPartCn(name) }); }
    return m;
  }
  var id = spec.furnitureId;
  if (id === 'bed_single') { buildBedAt(g, add, 0, 0, 0, 0); }
  else if (id === 'sofa_modern_2') { buildSofaAt(g, add, 0, 0, 0, 0); }
  else if (id === 'chair_wood' || id === 'hall_chair' || id === 'desk_chair') {
    buildChairAt(g, add, 0, 0, 0, id, 0x8a5a3a, 0);
  }
  else if (id === 'shop_counter' || id === 'checkout_counter') {
    /* 柜台：柜体 + 台面（以前只在建筑内部函数里画，删掉后变成了方块） */
    var f0 = TOWN_FURNITURE_SPECS[id] || { w: 3.2, d: 0.62, h: 1.22 };
    add(tmBox(g, f0.w, 0.95, f0.d, 0x6b4a32, 0, 0.72, 0), id + '_body');
    add(tmBox(g, f0.w + 0.15, 0.10, f0.d + 0.16, 0xd8cbb0, 0, 1.22, 0), id + '_top');
  }
  else if (id === 'dining_table' || id === 'outdoor_table' || id === 'coffee_table') {
    /* 桌子：桌面 + 四条腿 */
    var ft = TOWN_FURNITURE_SPECS[id] || { w: 1.3, d: 0.8, h: 0.75 };
    add(tmBox(g, ft.w, 0.10, ft.d, 0x6b4a32, 0, ft.h - 0.05, 0), id + '_top');
    var _lx = ft.w / 2 - 0.12, _lz = ft.d / 2 - 0.12;
    [[-_lx, -_lz], [_lx, -_lz], [-_lx, _lz], [_lx, _lz]].forEach(function (q, qi) {
      add(tmBox(g, 0.08, ft.h - 0.10, 0.08, 0x4a3423, q[0], (ft.h - 0.10) / 2, q[1]),
          id + '_leg_' + qi);
    });
  }
  else if (id === 'shop_shelf' || id === 'aisle_shelf') {
    /* 货架：两侧立柱 + 四层隔板 */
    var fs = TOWN_FURNITURE_SPECS[id] || { w: 0.72, d: 2.2, h: 1.9 };
    add(tmBox(g, fs.w * 0.7, fs.h, fs.d, 0x5f4630, 0, fs.h / 2, 0), id + '_body');
    for (var _sh = 0; _sh < 4; _sh++) {
      add(tmBox(g, fs.w * 0.86, 0.06, fs.d * 0.92, 0x9a7650, 0,
                fs.h * (0.22 + _sh * 0.26), 0), id + '_tier_' + (_sh + 1));
    }
  }
  else if (id === 'plant_pot') {
    var fp = TOWN_FURNITURE_SPECS[id] || { w: 0.5, d: 0.5, h: 0.9 };
    add(tmCyl(g, fp.w * 0.45, fp.w * 0.52, 0.38, 0x9a5f42, 0, 0.19, 0), id + '_pot');
    add(tmSphere(g, fp.w * 0.58, 0x5c8a52, 0, 0.78, 0), id + '_leaf');
  }
  else if (id === 'ceiling_lamp') {
    var fl = TOWN_FURNITURE_SPECS[id] || { w: 0.32, d: 0.26, h: 0.1 };
    add(tmBox(g, fl.w, 0.06, fl.d, 0xffd9a0, 0, 2.60, 0), id + '_lamp');
  }
  else if (id === 'umbrella') {
    /* ★ 2026-10-22：遮阳伞原来走到下面的"简单盒体"兜底 → 被画成一个 2.7m 的大方块。
       这里接上真正的伞模型（杆 + 圆锥伞面 + 底座）。 */
    buildUmbrella(g, add, 0, 0);
  }
  else if (id === 'fridge_display') { buildFridgeAt(g, add, 0, 0, 0); }
  else if (id === 'coffee_machine') { buildCoffeeMachine(g, add, 0, 0, 0); }
  else {
    /* 其余用简单盒体 + 细节，保证有实体 */
    var c = 0x9a7a5a;
    var f = TOWN_FURNITURE_SPECS[id] || { w: 0.6, d: 0.6, h: 0.6 };
    var m = tmBox(g, f.w, Math.max(0.06, f.h * (id === 'rug_rect' ? 1 : 0.9)),
                  f.d, c, 0, Math.max(0.03, f.h * (id === 'rug_rect' ? 1 : 0.45)), 0);
    add(m, 'furniture_' + id + '_body');
    if (id === 'wall_clock' || id === 'wall_art' || id === 'bath_mirror') {
      var face = tmBox(g, f.w * 0.85, f.h * 0.85, 0.02, 0xe8e4d8, 0, f.h * 0.5, f.d * 0.6);
      add(face, 'furniture_' + id + '_face');
    }
  }
  tmCollectFurniture(g);
  return g;
}

function buildTownModel(spec, opts) {
  opts = opts || {};
  if (spec.teleportStyle && typeof buildTeleportModel === 'function') { return buildTeleportModel(spec, opts); }
  if (spec.hallStyle && typeof buildHallModel === 'function') { return buildHallModel(spec, opts); }
  if (spec.shopStyle && typeof buildNewShop3 === 'function') {
    var _s3 = buildNewShop3(spec); if (_s3) { return _s3; }
  }
  if (spec.shopStyle && typeof buildNewShop2 === 'function') {
    var _s2 = buildNewShop2(spec); if (_s2) { return _s2; }
  }
  if (spec.shopStyle && typeof buildNewShop === 'function') { return buildNewShop(spec); }
  if (spec.propId && typeof buildPropModel === 'function') { return buildPropModel(spec); }
  if (spec.furnitureId) { return buildFurnitureModel(spec, opts); }
  if (spec.villaStyle && typeof buildVillaModel === 'function') { return buildVillaModel(spec, opts); }
  var wall = opts.wall || spec.wall, roof = opts.roof || spec.roofColor;
  var trim = opts.trim || spec.trim;
  var g = new THREE.Group();
  g.userData.parts = [];
  function add(m, name) {
    tmTag(m, name);
    if (name) { g.userData.parts.push({ id: name, cn: townPartCn(name) }); }
    return m;
  }
  var W = +spec.w || 9.3, D = +spec.d || 9.3, H = +spec.h || 3.0;
  var floors = Math.max(1, +spec.floors || 1);
  var doorW = +spec.doorW || 1.4;
  var t = 0.18;
  var fh = H / floors;
  H = fh * floors;
  add(tmBox(g, W + 0.55, 0.18, D + 0.55, 0x8d8a7c, 0, 0.09, 0), 'foundation');
  add(tmBox(g, W - 0.15, 0.08, D - 0.15, 0x6b4a32, 0, 0.22, 0), 'floor');
  var front = D / 2;
  for (var f = 0; f < floors; f++) {
    var y0 = 0.26 + f * fh, wh = fh - 0.10;
    var yc = y0 + wh / 2;
    var fp = 'f' + (f + 1) + '_';
    var nW = Math.max(0, +spec.windows || 0);
    add(tmFrontWall(g, add, W, wh, y0, t, front, f, doorW, nW, wall), fp + 'front_wall');
    if (f === 0) {
      add(tmBox(g, doorW + 0.22, 0.12, t + 0.18, trim, 0, y0 + 2.16, front + 0.06), 'door_frame_top');
      add(tmBox(g, doorW + 0.22, 0.04, 0.34, 0x6b4a32, 0, y0 + 0.04, front + 0.16), 'door_threshold');
      add(tmBox(g, 0.10, 2.08, t + 0.18, trim, -(doorW / 2 + 0.08), y0 + 1.04, front + 0.06), 'door_frame_left');
      add(tmBox(g, 0.10, 2.08, t + 0.18, trim, doorW / 2 + 0.08, y0 + 1.04, front + 0.06), 'door_frame_right');
      if (spec.awning) {
        add(tmBox(g, doorW + 0.9, 0.10, 1.05, spec.awning, 0, y0 + 2.36, front + 0.48), 'entrance_canopy');
      }
    } else {
      if (spec.balcony) {
        add(tmBox(g, W * 0.55, 0.10, 1.1, 0x6b4a32, 0, y0 + 0.12, front + 0.55), fp + 'balcony_floor');
        add(tmBox(g, W * 0.55, 0.06, 0.06, trim, 0, y0 + 0.62, front + 1.05), fp + 'balcony_rail');
        for (var b = 0; b < 6; b++) {
          add(tmBox(g, 0.05, 0.5, 0.05, trim, -W * 0.25 + b * (W * 0.1), y0 + 0.37, front + 1.05),
            fp + 'balcony_post_' + (b + 1));
        }
      }
    }
    add(tmBox(g, t, wh, D, wall, -W / 2, yc, 0), fp + 'side_wall_left');
    add(tmBox(g, t, wh, D, wall, W / 2, yc, 0), fp + 'side_wall_right');
    add(tmBox(g, W, wh, t, wall, 0, yc, -D / 2), fp + 'back_wall');
    if (spec.band) {
      add(tmBox(g, W + 0.06, 0.10, D + 0.06, spec.band, 0, y0 + wh - 0.02, 0), fp + 'belt_band');
    }
    for (var wi = 0; wi < nW; wi++) {
      var wx = -W * 0.5 + (wi + 1) * W / (nW + 1);
      if (!(f === 0 && Math.abs(wx) < doorW * 0.75)) {
        var wn = fp + 'window_' + (wi + 1);
        add(tmGlassBox(g, 1.15, 1.05, 0.04, wx, y0 + 1.45, front + 0.10, wn + '_glass'));
        add(tmBox(g, 0.10, 1.15, 0.10, trim, wx, y0 + 1.45, front + 0.16), wn + '_frame');
        add(tmBox(g, 1.05, 0.06, 0.06, 0xffd9a0, wx, y0 + 1.95, front + 0.14), wn + '_light');
      }
    }
  }
  if (spec.roof === 'flat') {
    add(tmBox(g, W + 0.25, 0.16, D + 0.25, roof, 0, H + 0.34, 0), 'roof_slab');
    var pw = W + 0.25, pd = D + 0.25;
    add(tmBox(g, pw, 0.28, 0.10, trim, 0, H + 0.52, pd / 2 - 0.05), 'parapet_front');
    add(tmBox(g, pw, 0.28, 0.10, trim, 0, H + 0.52, -pd / 2 + 0.05), 'parapet_back');
    add(tmBox(g, 0.10, 0.28, pd, trim, pw / 2 - 0.05, H + 0.52, 0), 'parapet_right');
    add(tmBox(g, 0.10, 0.28, pd, trim, -pw / 2 + 0.05, H + 0.52, 0), 'parapet_left');
    add(tmBox(g, 1.35, 0.12, 0.85, 0x2f3a3c, W * 0.18, H + 0.48, -D * 0.12), 'roof_solar');
    add(tmBox(g, 0.55, 0.35, 0.45, 0x9aa0a4, -W * 0.2, H + 0.55, D * 0.15), 'roof_ac');
  } else if (spec.roof === 'gable') {
    var E = H + 0.34, R = E + Math.max(1.0, D * 0.22);
    function roofPlane(zsign) {
      var hw = (W + 0.35) / 2, ez = zsign * (D / 2 + 0.18);
      var pos = [-hw, E, ez, hw, E, ez, hw, R, 0, -hw, R, 0];
      var idx = zsign > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      var mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: roof, side: THREE.DoubleSide }));
      mesh.castShadow = true; mesh.receiveShadow = true;
      g.add(mesh);
      add(mesh, zsign > 0 ? 'gable_roof_front' : 'gable_roof_back');
    }
    roofPlane(1); roofPlane(-1);
    add(tmBox(g, W + 0.55, 0.16, 0.30, trim, 0, R + 0.02, 0), 'ridge');
    add(tmBox(g, W + 0.45, 0.14, 0.16, trim, 0, E - 0.02, D / 2 + 0.18), 'eave_front');
    add(tmBox(g, W + 0.45, 0.14, 0.16, trim, 0, E - 0.02, -D / 2 - 0.18), 'eave_back');
    function gableEnd(sx) {
      var geo = new THREE.BufferGeometry();
      var hw = W / 2;
      var pos = [sx * hw, E, -D / 2, sx * hw, E, D / 2, sx * hw, R, 0];
      var idx = sx > 0 ? [0, 1, 2] : [0, 2, 1];
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      var mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: wall, side: THREE.DoubleSide }));
      mesh.castShadow = false; mesh.receiveShadow = false;
      g.add(mesh);
      add(mesh, sx > 0 ? 'gable_end_right' : 'gable_end_left');
    }
    gableEnd(1); gableEnd(-1);
  }
  if (spec.awning) {
    add(tmBox(g, 0.10, 2.36, 0.10, trim, -doorW / 2 - 0.35, 1.18, front + 0.9), 'canopy_post_left');
    add(tmBox(g, 0.10, 2.36, 0.10, trim, doorW / 2 + 0.35, 1.18, front + 0.9), 'canopy_post_right');
    add(tmBox(g, doorW + 1.0, 0.08, 0.10, trim, 0, 2.31, front + 0.9), 'canopy_front_beam');
    add(tmBox(g, 0.10, 0.08, 0.95, trim, -doorW / 2 - 0.35, 2.31, front + 0.45), 'canopy_beam_left');
    add(tmBox(g, 0.10, 0.08, 0.95, trim, doorW / 2 + 0.35, 2.31, front + 0.45), 'canopy_beam_right');
  }
  if (spec.facade === 'mart') {
    /* central entrance pavilion, taller than the warehouse box */
    var tw = 6.8, td = 2.8, th = 5.35, tz = front + td / 2;
    add(tmBox(g, 0.38, th, td, spec.wall, -tw / 2 + 0.19, th / 2, tz), 'mart_entry_left');
    add(tmBox(g, 0.38, th, td, spec.wall, tw / 2 - 0.19, th / 2, tz), 'mart_entry_right');
    add(tmBox(g, tw, th - 2.55, td, spec.wall, 0, 2.55 + (th - 2.55) / 2, tz), 'mart_entry_header');
    add(tmBox(g, tw + 0.35, 0.22, td + 0.35, spec.trim, 0, th + 0.05, tz), 'mart_entry_roof');
    add(tmBox(g, tw + 0.25, 0.42, 0.20, spec.band || 0x3e6a7a, 0, th - 0.42, tz + td / 2 + 0.02), 'mart_entry_fascia');
    add(tmGlassBox(g, tw - 0.9, 2.30, 0.05, 0, 1.28, tz + td / 2 + 0.03, 'mart_entry_glass'));
    add(tmBox(g, 0.14, 2.40, 0.10, 0x8a959b, -1.55, 1.30, tz + td / 2 + 0.08), 'mart_entry_mullion_l');
    add(tmBox(g, 0.14, 2.40, 0.10, 0x8a959b, 1.55, 1.30, tz + td / 2 + 0.08), 'mart_entry_mullion_r');
    add(tmBox(g, tw, 0.18, 0.22, 0x8a959b, 0, 2.55, tz + td / 2 + 0.08), 'mart_entry_lintel');
    add(tmBox(g, 5.9, 0.92, 0.18, 0x1f3b4a, 0, 4.55, tz + td / 2 + 0.05), 'mart_entry_sign');
    var es = new THREE.Mesh(new THREE.PlaneGeometry(5.65, 0.70), tmMat(0xe8e4d8));
    es.position.set(0, 4.55, tz + td / 2 + 0.15);
    g.add(es); add(es, 'mart_entry_sign_face');
    /* pylon sign away from the wall */
    var px = W * 0.40, pz = front + 3.30;
    add(tmBox(g, 0.55, 6.10, 0.55, 0x59666a, px, 3.05, pz), 'mart_pylon');
    add(tmBox(g, 2.20, 1.55, 0.24, 0x1f3b4a, px, 4.85, pz + 0.28), 'mart_pylon_sign');
    var pf = new THREE.Mesh(new THREE.PlaneGeometry(1.95, 1.25), tmMat(0xe8e4d8));
    pf.position.set(px, 4.85, pz + 0.43);
    g.add(pf); add(pf, 'mart_pylon_face');
    /* steel canopy split around the pavilion */
    var cw = W * 0.34;
    add(tmBox(g, cw, 0.14, 2.35, 0x9aa3a8, -(tw / 2 + cw / 2 + 0.25), 3.05, front + 1.05), 'canopy_mart_left');
    add(tmBox(g, cw, 0.14, 2.35, 0x9aa3a8, (tw / 2 + cw / 2 + 0.25), 3.05, front + 1.05), 'canopy_mart_right');
    add(tmBox(g, 0.16, 3.0, 0.16, 0x8a959b, -(tw / 2 + cw + 0.25), 1.50, front + 1.9), 'column_mart_left');
    add(tmBox(g, 0.16, 3.0, 0.16, 0x8a959b, tw / 2 + cw + 0.25, 1.50, front + 1.9), 'column_mart_right');
    /* roof monitor + skylights */
    add(tmBox(g, W * 0.68, 0.85, 3.10, spec.roofColor, 0, H + 0.42, -D * 0.06), 'mart_roof_monitor');
    for (var sk = 0; sk < 4; sk++) {
      add(tmBox(g, 1.9, 0.55, 0.08, 0x9fd8e8, -W * 0.24 + sk * W * 0.16, H + 0.52, -D * 0.06 + 1.52), 'mart_skylight_' + (sk + 1));
    }
    /* side loading dock, left */
    add(tmBox(g, 3.3, 3.0, 5.2, spec.wall, -W / 2 - 1.6, 1.5, -D * 0.12), 'mart_dock');
    add(tmBox(g, 0.10, 2.25, 2.9, 0x59666a, -W / 2 - 3.25, 1.28, -D * 0.12, Math.PI / 2), 'mart_loading_door');
    add(tmBox(g, 3.0, 0.22, 4.0, 0x8a959b, -W / 2 - 2.0, 0.11, -D * 0.12), 'mart_dock_ramp');
    /* cart corral + bollards */
    add(tmBox(g, 3.0, 0.08, 0.08, 0x8a959b, -W * 0.34, 0.92, D / 2 + 2.5), 'mart_cart_corral');
    add(tmBox(g, 3.0, 0.08, 0.08, 0x8a959b, -W * 0.34, 0.48, D / 2 + 2.5), 'mart_cart_corral');
    add(tmBox(g, 0.08, 0.92, 0.08, 0x8a959b, -W * 0.34 - 1.5, 0.46, D / 2 + 2.5), 'mart_cart_corral');
    add(tmBox(g, 0.08, 0.92, 0.08, 0x8a959b, -W * 0.34 + 1.5, 0.46, D / 2 + 2.5), 'mart_cart_corral');
    add(tmBox(g, 0.42, 0.58, 0.30, 0x8a8f8e, -W * 0.34 - 0.55, 0.36, D / 2 + 2.5), 'cart_1');
    add(tmBox(g, 0.42, 0.58, 0.30, 0x8a8f8e, -W * 0.34 + 0.15, 0.36, D / 2 + 2.5), 'cart_2');
    for (var mb = 0; mb < 3; mb++) {
      add(tmBox(g, 0.14, 0.7, 0.14, 0x8a959b, -W * 0.18 + mb * 0.8, 0.35, front + 2.4), 'mart_bollard_' + (mb + 1));
    }
  }
  if (spec.facade === 'cottage') {
    /* side kitchen wing makes the plan L-shaped */
    var wx = W / 2 + 1.15, wz = -D * 0.12, ww = 2.3, wd = 3.5, wh2 = 2.45;
    add(tmBox(g, ww, wh2, wd, wall, wx, wh2 / 2, wz), 'cottage_wing');
    add(tmBox(g, ww + 0.25, 0.16, wd + 0.25, trim, wx, wh2 + 0.06, wz), 'cottage_wing_roof');
    add(tmBox(g, 0.90, 0.85, 0.05, 0x9fd8e8, wx, 1.55, wz + wd / 2 + 0.03), 'cottage_wing_window');
    add(tmBox(g, 0.82, 0.62, 0.04, 0x3a2a20, wx, 0.55, wz + wd / 2 + 0.04), 'cottage_wing_door');
    var px2 = -W * 0.24, pz2 = front + 0.95, pw = 3.0, pd = 1.9;
    add(tmBox(g, pw, 0.10, pd, trim, px2, 2.56, pz2), 'porch_roof');
    add(tmBox(g, 0.14, 2.45, 0.14, trim, px2 - pw / 2 + 0.18, 1.30, pz2 + pd / 2 - 0.16), 'porch_post_left');
    add(tmBox(g, 0.14, 2.45, 0.14, trim, px2 + pw / 2 - 0.18, 1.30, pz2 + pd / 2 - 0.16), 'porch_post_right');
    add(tmBox(g, pw + 0.2, 0.16, 0.20, trim, px2, 2.45, pz2 + pd / 2 - 0.16), 'porch_beam');
    add(tmBox(g, 0.60, 3.6, 0.60, 0x8a5a4a, W * 0.28, H + 1.45, -D * 0.18), 'chimney');
  }
  if (spec.sign) {
    add(tmBox(g, Math.min(W * 0.62, 4.2), 0.55, 0.10, spec.sign, 0, H + 0.78, front + 0.16), 'sign_board');
    var sw = Math.min(W * 0.62, 4.2) - 0.16;
    var sp = new THREE.Mesh(new THREE.PlaneGeometry(sw, 0.40), tmMat(0xe8dcc8));
    sp.position.set(0, H + 0.78, front + 0.30);
    g.add(sp);
    add(sp, 'sign_face');
  }
  if (spec.columns) {
    add(tmBox(g, 0.32, 2.6, 0.32, 0xd8d2c4, -W / 2 + 0.6, 1.55, front + 0.35), 'column_left');
    add(tmBox(g, 0.32, 2.6, 0.32, 0xd8d2c4, W / 2 - 0.6, 1.55, front + 0.35), 'column_right');
  }
  buildTownInterior(g, spec, add, W, D, H);
  tmCollectFurniture(g);
  return g;
}
