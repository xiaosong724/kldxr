# -*- coding: utf-8 -*-
"""修 test_weapons 里那条"假红"：它查源码文字，把我的注释也算进去了"""
import io

p = 'tools/test_weapons.py'
t = io.open(p, encoding='utf-8').read()

old = """ok('等级不够' not in _src.split('def equip_weapon')[1].split('def ')[0],
   '★★★ 服务端 equip_weapon 里已经【没有】"等级不够"的拦截了 ✓（能装 ✓ 只是发挥度打折 ✓）')"""

new = """# ★ 别去查"等级不够"四个字 —— 我的注释里就写着这句 ✗（上次就是这么假红的）
#   要查的是【代码】：还有没有 return False, '等级不够…'
_body_src = _src.split('def equip_weapon')[1].split(chr(10) + 'def ')[0]
_bad = [ln.strip() for ln in _body_src.split(chr(10))
        if 'return False' in ln and '等级不够' in ln]
ok(not _bad,
   '★★★ 服务端 equip_weapon 里已经没有【代码级】的等级拦截了 ✓（能装 ✓ 只是发挥度打折 ✓）', _bad)"""

assert t.count(old) == 1, t.count(old)
t = t.replace(old, new)
io.open(p, 'w', encoding='utf-8', newline='\n').write(t)
print('  OK test_weapons 假红修掉')
