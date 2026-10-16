import io
p = 'web/platform/web.js'
t = io.open(p, encoding='utf-8').read()
done = []

# ---------- 工具函数：取"这件物品当前的真实耐久" ----------
A = "function expNeed(lv) {"
assert t.count(A) == 1, ('expNeed 锚点: %d' % t.count(A))
HELPER = '''/* ★ 第 233 轮（用户："耐久掉了一半"）★
   物品格子上显示耐久时，如果是【身上正穿着的那件】✗
   就用身上那份（服务器实时推过来的 ✓）而不是 item_json 里的旧值 ✓
   ★ 为什么：穿在身上期间，服务端把耐久记在 p.wDur / p.aDur ✓
     item_json 里那份只在穿和脱的那一刻才同步 ✓ 所以是旧的 ✓ */
function itDur(it, id) {
  var w = (typeof MY_WEAPON !== 'undefined') ? MY_WEAPON : null;
  var a = (typeof MY_ARMOR !== 'undefined') ? MY_ARMOR : null;
  if (w && String(BAG.weaponItemId || '') === String(id || '') && typeof w.dur === 'number') {
    return w.dur;
  }
  if (a && String(BAG.armorItemId || '') === String(id || '') && typeof a.dur === 'number') {
    return a.dur;
  }
  return (typeof it.dur === 'number') ? it.dur : (it.durMax || 0);
}

'''
t = t.replace(A, HELPER + A, 1)
done.append('工具函数 itDur ✓')

# ---------- E：背包格子的耐久显示改用 itDur ----------
n = t.count("((typeof it.dur === 'number') ? it.dur : it.durMax)")
t = t.replace("((typeof it.dur === 'number') ? it.dur : it.durMax)", "itDur(it, e && e.id)")
done.append('E 背包耐久用实时值（替换 %d 处 ✓）' % n)

# ---------- D④：背包格子的"已损坏"样式 ----------
B = """    var sel = (BAG.sel && String(BAG.sel) === String(e.id)) ? ' sel' : '';"""
assert t.count(B) == 1, ('sel 锚点: %d' % t.count(B))
NEW_B = """    var sel = (BAG.sel && String(BAG.sel) === String(e.id)) ? ' sel' : '';
    /* ★★ 第 233 轮（用户要求）：损坏的装备要有明显样式 ★★
       为什么：挂机回来只看到"少了一件"✗ 分不清是坏了还是丢了 ✓
       → 现在坏了的【还在背包里】✓ 而且格子上一眼能看出来 ✓ */
    var brk = !!it.broken;
    if (brk) { cur = ''; }        /* 坏了的就不显示"已装备"绿点了 ✗ 显示损坏 ✓ */"""
t = t.replace(B, NEW_B, 1)
C = "      html += '<div class=\"slot' + cur + sel + (lowm ? ' lowmastery' : '') + '\" style=\"' + bg + '\"' +"
assert t.count(C) == 1, ('slot 锚点: %d' % t.count(C))
t = t.replace(C, "      html += '<div class=\"slot' + cur + sel + (lowm ? ' lowmastery' : '') +\n"
                 "        (brk ? ' broken' : '') + '\" style=\"' + bg + '\"' +")
done.append('D4 背包格子损坏样式 ✓')

# ---------- D④（穿戴格子）：B1/B2 的耐久后面再标一下"已损坏" ----------
D = "        ((+a2.durMax > 0) ? ('<i style=\"color:#ffd83d\"> · 耐久 ' +"
assert t.count(D) == 1, ('防具耐久锚点: %d' % t.count(D))
t = t.replace(D, "        (a2.broken ? '<i style=\"color:#ff5a4a\"> · 已损坏</i>' : '') +\n"
                 "        ((+a2.durMax > 0) ? ('<i style=\"color:#ffd83d\"> · 耐久 ' +", 1)
E = "        ((+w.durMax > 0) ? (' · 耐久 ' +"
assert t.count(E) == 1, ('武器耐久锚点: %d' % t.count(E))
t = t.replace(E, "        (w.broken ? ' · 已损坏' : '') +\n"
                 "        ((+w.durMax > 0) ? (' · 耐久 ' +", 1)
done.append('D4 穿戴面板显示"已损坏" ✓')
io.open(p, 'w', encoding='utf-8', newline='\n').write(t)
print('  platform: ' + ' | '.join(done))

# ---------- D③：坏了的不能穿 ----------
p2 = 'server/auth.py'
t2 = io.open(p2, encoding='utf-8').read()
F = "            if not isinstance(w, dict) or w.get('slot') != 'weapon':\n                return False, '这不是武器'"
assert t2.count(F) == 1, ('equip_weapon 锚点: %d' % t2.count(F))
t2 = t2.replace(F, F + """
            # ★ 第 233 轮：坏了的装备不能再穿（用户要求：损坏要有明确表现 ✓）
            if w.get('broken'):
                return False, '这件武器已损坏，不能使用（占卜一下：攒钱换一把吧）'""", 1)
print('  auth: equip_weapon 加了损坏校验 ✓')
io.open(p2, 'w', encoding='utf-8', newline='\n').write(t2)
