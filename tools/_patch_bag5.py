# -*- coding: utf-8 -*-
"""第 54 轮（客户端）：① 刀刃朝向 ② 品阶底色/阶数/数量 ③ 使用-脱下按钮
★ 这次的教训：fillHeldWeapon 在 core/game.js 里（不在 platform ✗），
  而且脚本要【每一步都落盘】，不然中间一个锚点不匹配就全丢 ✗
"""
import io


def patch(path, pairs, label):
    t = io.open(path, encoding='utf-8').read()
    for a, b, name in pairs:
        c = t.count(a)
        assert c == 1, '%s / %s: %d 次' % (label, name, c)
        t = t.replace(a, b)
    io.open(path, 'w', encoding='utf-8', newline='\n').write(t)
    print('  OK', label)


# ==================== ① 手上武器转 90°（core）====================
patch('web/core/game.js', [(
"""  var w = MY_WEAPON;
  var g = buildWeaponMesh(w ? w.look : 'sword', w ? (w.tier || 0) : 0);
  for (var k = g.children.length - 1; k >= 0; k--) { sw.add(g.children[k]); }
  return sw;""",
"""  var w = MY_WEAPON;
  var g = buildWeaponMesh(w ? w.look : 'sword', w ? (w.tier || 0) : 0);
  /* ★★ 第 54 轮：刀刃朝向修正（用户报的"拿着斧头时刀刃不是朝下"）★★
     病根：零件数据是"宽在 X、薄在 Z"——
           也就是【正面看是刀的平面】（示意图就是这么画的 ✓ 所以图标也好看 ✓）
           但挥砍动画是绕 X 轴往下劈 ✗
           不转的话，砸下去的是刀【面】而不是刀【刃】✗（等于拿刀背拍人）
     修法：整把武器绕自身 Y 轴转 -90° → 原来朝 ±X 的刃口变成朝 ±Z（正前/正后）✓
           往下劈时刃先着 ✓
     ★ 八种武器一起修好（不是只修斧头）—— 因为它们共用同一套"宽在X"的数据 ✓
     ★ 图标不受影响：图标是"沿 -Z 看的平面投影"，正是示意图那个角度 ✓ */
  g.rotation.y = -Math.PI / 2;
  sw.add(g);
  return sw;""",
'held')], 'core：刀刃转向')

# ==================== ② platform：底色/数量/选中/按钮 ====================
t = io.open('web/platform/web.js', encoding='utf-8').read()


def rep(a, b, name):
    global t
    c = t.count(a)
    assert c == 1, '%s: %d 次' % (name, c)
    t = t.replace(a, b)
    io.open('web/platform/web.js', 'w', encoding='utf-8', newline='\n').write(t)
    print('  OK', name)


rep("""/* 品阶色 —— 和 core 里地上掉落物同一套 LOOT_COL ✓ */""",
"""/* 品阶色 → 带透明度的 rgba（做图标【底色】用 ✓ 第 54 轮用户要求）*/
function tierRgba(tier, a) {
  var h = tierHex(tier);
  var r = parseInt(h.substr(1, 2), 16), g = parseInt(h.substr(3, 2), 16),
      b = parseInt(h.substr(5, 2), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}

/* 品阶色 —— 和 core 里地上掉落物同一套 LOOT_COL ✓ */""", 'tierRgba')

rep("""    var cur = (BAG.weaponItemId && e.id === BAG.weaponItemId) ? ' cur' : '';
    var lowm = isW ? (wMastery(it) < 1) : false;
    html += '<div class="slot' + cur + (lowm ? ' lowmastery' : '') + '" data-id="' + e.id +
      '" data-w="' + (isW ? 1 : 0) + '" data-i="' + i + '"' +
      (lowm ? (' title="建议 ' + (it.reqLevel || 1) + ' 级（发挥 ' +
        Math.round(wMastery(it) * 100) + '%）"') : '') + '>' +
      '<span style="color:' + col + '">' + iconOfItem(it) + '</span>' +
      '<span class="tg">' + (it.tier || 0) + '</span>' +
      (lowm ? '<span class="lvl">' + Math.round(wMastery(it) * 100) + '%</span>' : '') + '</div>';""",
"""    var cur = (BAG.weaponItemId && e.id === BAG.weaponItemId) ? ' cur' : '';
    var sel = (BAG.sel && String(BAG.sel) === String(e.id)) ? ' sel' : '';
    var lowm = isW ? (wMastery(it) < 1) : false;
    var n = (e.stack || 1);
    /* ★★ 第 54 轮（用户要求）★★
       品阶 → 改成【图标底色】（不再只是角上一个数字 ✓）
       阶数 → 武器放【左上角】✓
       数量 → 材料放【右下角】（MC 惯例 ✓）
       武器永远不堆叠 → 所以武器不会显示数量 ✓ */
    var bg = 'background:linear-gradient(180deg,' + tierRgba(it.tier || 0, 0.40) + ','
             + tierRgba(it.tier || 0, 0.18) + ')';
    html += '<div class="slot' + cur + sel + (lowm ? ' lowmastery' : '') + '" style="' + bg + '"' +
      ' data-id="' + e.id + '" data-w="' + (isW ? 1 : 0) + '" data-i="' + i + '"' +
      (lowm ? (' title="建议 ' + (it.reqLevel || 1) + ' 级（发挥 ' +
        Math.round(wMastery(it) * 100) + '%）"') : '') + '>' +
      '<span style="color:' + col + '">' + iconOfItem(it) + '</span>' +
      '<span class="tg">' + (it.tier || 0) + '</span>' +
      (!isW && n > 1 ? '<span class="cnt">' + n + '</span>' : '') +
      (lowm ? '<span class="lvl">' + Math.round(wMastery(it) * 100) + '%</span>' : '') + '</div>';""",
'slot 底色/数量')

# 面板显示"选中的那件" + 按钮状态
i3 = t.index("  /* ---- 数值：只算【武器自己】的（用户要求，不掺玩家等级 ✓）---- */")
j3 = t.index("  if (mg) {\n    mg.textContent = BAG.msg")
new3 = '''  /* ---- 数值：显示【当前选中】的那件（默认=已装备 ✓）
     ★ 第 54 轮：以前固定显示"已装备"，悬停/点别的武器时对不上 ✗ 现在跟着选中走 ✓ */
  var selItem = null, selIsEquipped = false;
  for (var q = 0; q < BAG.items.length; q++) {
    if (BAG.sel && String(BAG.items[q].id) === String(BAG.sel)) {
      selItem = BAG.items[q].item;
      selIsEquipped = !!(BAG.weaponItemId &&
                         String(BAG.weaponItemId) === String(BAG.items[q].id));
      break;
    }
  }
  if (!selItem) { selItem = shownWeapon(); selIsEquipped = !!w; }
  st.innerHTML = wStatHtml(selItem, !selItem);

  /* ---- 使用 / 脱下（用户要求：点武器出现"使用"，用后变成"脱下"）---- */
  var useBtn = document.getElementById('bagUse');
  if (useBtn) {
    if (selIsEquipped) {
      useBtn.textContent = '脱 下';
      useBtn.className = 'bagB off';
      useBtn.disabled = false;
      useBtn.setAttribute('data-act', 'off');
    } else if (selItem && selItem.slot === 'weapon' && selItem !== DEFAULT_W) {
      useBtn.textContent = '使 用';
      useBtn.className = 'bagB';
      useBtn.disabled = false;
      useBtn.setAttribute('data-act', 'use');
    } else {
      useBtn.textContent = '使 用';
      useBtn.className = 'bagB';
      useBtn.disabled = true;
      useBtn.setAttribute('data-act', '');
    }
  }
  var selTip = document.getElementById('bagSelTip');
  if (selTip) {
    var selW = (selItem && selItem.slot === 'weapon');
    selTip.textContent = selW
      ? (selIsEquipped ? '这件正拿在手上' : '点「使用」穿上它')
      : '点上面的格子选中一件武器';
  }

'''
t = t[:i3] + new3 + t[j3:]
io.open('web/platform/web.js', 'w', encoding='utf-8', newline='\n').write(t)
print('  OK 面板跟着选中走 + 使用/脱下按钮状态')

rep("""      // ★ 第 53 轮：不再拦"穿不上"了（能装 ✓ 只是发挥度打折 ✓ 见 wStatHtml）
      bagEquip(el.getAttribute('data-id'));""",
"""      /* ★ 第 54 轮（用户要求）：点武器 = 【选中】它（面板显示它的数值 ✓）
         真正"穿"要再按【使用】按钮 ✓ —— 免得手一滑就换了装备 ✗ */
      BAG.sel = el.getAttribute('data-id');
      BAG.msg = '';
      bagRender();""", '点击=选中')

rep("""  // 点装备槽 = 脱下
  var eqs = document.getElementById('bagEqSlot');""",
"""  /* ★ 使用 / 脱下 按钮（第 54 轮）*/
  var useBtn = document.getElementById('bagUse');
  if (useBtn) {
    useBtn.onclick = function (e) {
      if (e) { e.preventDefault(); }
      var act = useBtn.getAttribute('data-act');
      if (act === 'use' && BAG.sel) { bagEquip(BAG.sel); }
      else if (act === 'off') { bagUnequip(); }
    };
  }
  // 点装备槽 = 直接脱下（老路径保留 ✓）
  var eqs = document.getElementById('bagEqSlot');""", '按钮绑定')

# BAG 初始多一个 sel
rep("var BAG = { items: [], weapon: null, weaponItemId: null, busy: false, msg: '' };",
    "var BAG = { items: [], weapon: null, weaponItemId: null, busy: false, msg: '', sel: null };",
    'BAG.sel')

# ==================== ③ HTML/CSS ====================
patch('web/index.html', [
("""   <div class="bagEquipRow">
     <div id="bagEqSlot" class="slot eqslot"></div>
     <div class="bagStat" id="bagStat"></div>
   </div>""",
"""   <div class="bagEquipRow">
     <div id="bagEqSlot" class="slot eqslot"></div>
     <div class="bagStat" id="bagStat"></div>
   </div>
   <!-- ★ 第 54 轮：点武器选中 → 这里出现【使用】；穿上之后变成【脱下】（用户要求）-->
   <div class="bagBtns"><button id="bagUse" class="bagB" disabled>使 用</button>
     <span class="bagTip" id="bagSelTip">点上面的格子选中一件武器</span></div>""",
 'html 按钮'),
(""".slot .tg{position:absolute;right:2px;bottom:0;font-size:10px;color:#ffd83d;
  text-shadow:0 1px 2px #000,0 0 3px #000}""",
"""/* ★ 第 54 轮：阶数 → 【左上角】；数量 → 【右下角】（MC 惯例 ✓）*/
.slot .tg{position:absolute;left:2px;top:-1px;font-size:10px;color:#ffd83d;font-weight:700;
  text-shadow:0 1px 2px #000,0 0 3px #000}
.slot .cnt{position:absolute;right:2px;bottom:-1px;font-size:11px;color:#fff;font-weight:700;
  text-shadow:0 1px 2px #000,0 0 3px #000}
.slot.sel{outline:2px solid #8ee08a;outline-offset:-2px}
.bagBtns{display:flex;align-items:center;gap:10px;margin-top:8px}
.bagB.off{border-color:#a05a4a}
.bagB:disabled{opacity:.45;cursor:default}""", 'css 位置'),
], 'index.html')
print('全部完成')
