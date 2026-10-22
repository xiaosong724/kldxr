# -*- coding: utf-8 -*-
"""注册 6 个建筑：TOWN_MODELS、分支、页面、目录、布局。"""
import io

# 1) TOWN_MODELS
p = 'web/core/town_models.js'
s = io.open(p, encoding='utf-8').read()
if 'shop_apartment_v1' not in s:
    block = """  shop_apartment_v1: {
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
"""
    s = s.replace("  shop_warehouse_v1: {", block + "  shop_warehouse_v1: {", 1)

# 2) 分支
if 'buildNewShop3' not in s:
    s = s.replace("  if (spec.shopStyle && typeof buildNewShop2 === 'function') {",
                  "  if (spec.shopStyle && typeof buildNewShop3 === 'function') {\n"
                  "    var _s3 = buildNewShop3(spec); if (_s3) { return _s3; }\n"
                  "  }\n"
                  "  if (spec.shopStyle && typeof buildNewShop2 === 'function') {", 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('models registered')

# 3) 页面
for page in ('web/preview_models.html', 'web/index.html'):
    s = io.open(page, encoding='utf-8').read()
    if 'town_shops4.js' not in s:
        s = s.replace('<script src="/core/town_shops3.js"></script>',
                      '<script src="/core/town_shops3.js"></script>\n<script src="/core/town_shops4.js"></script>', 1)
        io.open(page, 'w', encoding='utf-8', newline='\n').write(s)
        print(page, 'loaded')
print('DONE')
