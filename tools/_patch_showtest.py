# -*- coding: utf-8 -*-
"""test_browser：把断言改成新的显示，并加一条"和服务器对账"的检查"""
import io

p = 'tools/test_browser.js'
t = io.open(p, encoding='utf-8').read()

# ① 属性栏断言：旧标签没了，改成新标签
a = """    ok(/攻击力|射程|攻速/.test(bagQ.stat0), '★★ 属性栏把武器的真实数值算给玩家看了 ✓');"""
b = """    ok(/武器伤害/.test(bagQ.stat0) && /每秒伤害/.test(bagQ.stat0) && /范围/.test(bagQ.stat0),
      '★★ 属性栏显示的是【武器自己的伤害】（武器伤害/每秒伤害/范围 ✓ 用户要求不掺玩家等级）');
    ok(!/攻击力/.test(bagQ.stat0),
      '★★ 面板上不再显示"攻击力"（那个数掺了玩家等级、没法横向比武器 ✗ 用户要求去掉）');
    ok(/贴身|短|中|长|超远/.test(bagQ.stat0), '★ 范围有文字描述（贴身/短/中/长/超远 ✓）');
    ok(/打击面/.test(bagQ.stat0) && /(窄|中|宽|横扫)/.test(bagQ.stat0),
      '★★ 弧改成了文字描述（"打击面 宽 · 一片"这种 ✓ 用户要求）');
    ok(!/弧/.test(bagQ.stat0.replace(/打击面/g, '')), '★ 面板上不再出现"弧 1.05"这种生硬数字 ✓');
    /* ★★ 和服务器对账：同一件武器，两边算出来的"武器伤害"必须一模一样 ★★
       （一旦不一致，就是"显示的和打出去的"不符 —— 这种 bug 最难发现 ✗）
       已知值：5 阶双手斧、物品 8 级 → server 算出来是 196（见 tools/test_weapons.py ✓）*/
    const crossQ = JSON.parse(await A.eval(
      'var out = {};' +
      'var it = { slot: "weapon", look: "axe", tier: 5, itemLv: 8,' +
      '  base: { coeff: 1.45, atkSpeed: 0.75, reach: 3.0, arc: 1.55 } };' +
      'out.dmg = Math.round(wDamage(it));' +
      'out.crit = Math.round(wCrit(it));' +
      'out.dps = Math.round(wDps(it));' +
      'out.interval = Math.round(wInterval(it) * 1000) / 1000;' +
      'return JSON.stringify(out);'
    ) || '{}');
    console.log('        [对账] 5阶双手斧/物品8级 → 武器伤害 ' + crossQ.dmg + ' 暴击 ' +
      crossQ.crit + ' 每秒 ' + crossQ.dps + ' 间隔 ' + crossQ.interval + ' 秒');
    ok(crossQ.dmg === 196 && crossQ.crit === 294 && crossQ.interval === 0.827,
      '★★★ 客户端算的和服务器完全一致（武器伤害 196 / 暴击 294 / 间隔 0.827 ✓ —— ' +
      '两边算法是同一个，不一致就说明显示和实际不符 ✗）');
    /* ★ 关键：换个玩家等级，显示的数【不能变】（这才是"方便比较武器" ✓）*/
    const lvQ = JSON.parse(await A.eval(
      'var it = { slot: "weapon", tier: 5, itemLv: 8,' +
      '  base: { coeff: 1.45, atkSpeed: 0.75, reach: 3.0, arc: 1.55 } };' +
      'var a1 = wDamage(it);' +
      'var real = WSC.role.level; WSC.role.level = 1; var a2 = wDamage(it);' +
      'WSC.role.level = 99; var a3 = wDamage(it); WSC.role.level = real;' +
      'return JSON.stringify({ a1: a1, a2: a2, a3: a3 });'
    ) || '{}');
    ok(lvQ.a1 === lvQ.a2 && lvQ.a2 === lvQ.a3,
      '★★★ 玩家 1 级 / 99 级看同一把武器，显示的武器伤害完全一样（' + lvQ.a2 +
      ' ✓ —— 不受等级影响，才能横向比哪把好 ✓ 用户要的就是这个）');"""
assert t.count(a) == 1, ('stat', t.count(a))
t = t.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='\n').write(t)
print('  OK 测试断言更新 + 对账检查')
