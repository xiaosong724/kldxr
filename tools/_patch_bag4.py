# -*- coding: utf-8 -*-
"""第 54 轮（客户端）：
   ① 武器刀刃朝向修正（挥砍是绕 X 轴 → 必须让刃朝前，不然砸下去是刀面 ✗）
   ② 品阶改成图标底色 + 阶数挪到左上角
   ③ 材料右下角显示【数量】
   ④ 点武器 → 出现"使用"按钮；装备后 → 变成"脱下"按钮
"""
import io

# ==================== ① 手上武器转 90° ====================
p = 'web/platform/web.js'
t = io.open(p, encoding='utf-8').read()

a = """  var w = MY_WEAPON;
  var g = buildWeaponMesh(w ? w.look : 'sword', w ? (w.tier || 0) : 0);
  for (var k = g.children.length - 1; k >= 0; k--) { sw.add(g.children[k]); }
  return sw;"""
b = """  var w = MY_WEAPON;
  var g = buildWeaponMesh(w ? w.look : 'sword', w ? (w.tier || 0) : 0);
  /* ★★ 第 54 轮：刀刃朝向修正（用户报的"拿着斧头刀刃不是朝下"）★★
     病根：零件数据是"宽在 X、薄在 Z"——也就是【正面看是刀的平面】（示意图就是这么画的 ✓）
           但挥砍动画是绕 X 轴往下劈 ✗
           不转的话，砸下去的是刀【面】而不是刀【刃】✗（像拿刀背拍人）
     修法：把整把武器绕自身 Y 轴转 -90° → 原来朝 ±X 的刃口变成朝 ±Z（正前/正后）✓
           这样往下劈时刃先着 ✓（八种武器一起修好，不是只修斧头 ✓）*/
  g.rotation.y = -Math.PI / 2;
  sw.add(g);
  return sw;"""
assert t.count(a) == 1, ('held', t.count(a))
t = t.replace(a, b)

# ==================== ② 品阶底色 + 阶数/数量 ====================
a2 = """  var html = '';
  for (var i = 0; i < BAG.items.length; i++) {
    var e = BAG.items[i];
    var it = e.item || {};
    var isW = (it.slot === 'weapon');
    var col = tierHex(it.tier || 0);
    var cur = (BAG.weaponItemId && e.id === BAG.weaponItemId) ? ' cur' : '';
    // ★ 第 53 轮：不禁止穿了 ✓ 只在"发挥不满"的武器上做个黄标（是提示、不是锁 ✓）
    var lowm = isW ? (wMastery(it) < 1) : false;
    html += '<div class="slot' + cur + (lowm ? ' lowmastery' : '') + '" data-id="' + e.id +
      '" data-w="' + (isW ? 1 : 0) + '" data-i="' + i + '"' +
      (lowm ? (' title="建议 ' + (it.reqLevel || 1) + ' 级（发挥 ' +
        Math.round(wMastery(it) * 100) + '%）"') : '') + '>' +
      '<span style="color:' + col + '">' + iconOfItem(it) + '</span>' +
      '<span class="tg">' + (it.tier || 0) + '</span>' +
      (lowm ? '<span class="lvl">' + Math.round(wMastery(it) * 100) + '%</span>' : '') + '</div>';
  }"""
b2 = """  var html = '';
  for (var i = 0; i < BAG.items.length; i++) {
    var e = BAG.items[i];
    var it = e.item || {};
    var isW = (it.slot === 'weapon');
    var col = tierHex(it.tier || 0);
    var cur = (BAG.weaponItemId && e.id === BAG.weaponItemId) ? ' cur' : '';
    var sel = (BAG.sel && String(BAG.sel) === String(e.id)) ? ' sel' : '';
    // ★ 第 53 轮：不禁止穿了 ✓ 只在"发挥不满"的武器上做个黄标（是提示、不是锁 ✓）
    var lowm = isW ? (wMastery(it) < 1) : false;
    var n = (e.stack || 1);
    /* ★★ 第 54 轮（用户要求）★★
       品阶 → 改成【图标底色】（不再只是一个角上的数字 ✓）
       阶数 → 武器放【左上角】
       数量 → 材料放【右下角】（MC 就是这样 ✓）
       武器永远不堆叠 → 所以不会有数量 ✓ */
    var bg = 'background:linear-gradient(180deg,' + tierRgba(it.tier || 0, 0.42) + ','
             + tierRgba(it.tier || 0, 0.20) + ')' + (lowm ? ';' : '');
    html += '<div class="slot' + cur + sel + (lowm ? ' lowmastery' : '') + '" style="' + bg + '"' +
      ' data-id="' + e.id + '" data-w="' + (isW ? 1 : 0) + '" data-i="' + i + '"' +
      (lowm ? (' title="建议 ' + (it.reqLevel || 1) + ' 级（发挥 ' +
        Math.round(wMastery(it) * 100) + '%）"') : '') + '>' +
      '<span style="color:' + col + '">' + iconOfItem(it) + '</span>' +
      '<span class="tg">' + (it.tier || 0) + '</span>' +
      (!isW && n > 1 ? '<span class="cnt">' + n + '</span>' : '') +
      (lowm ? '<span class="lvl">' + Math.round(wMastery(it) * 100) + '%</span>' : '') + '</div>';
  }"""
assert t.count(a2) == 1, ('slot2', t.count(a2))
t = t.replace(a2, b2)

# tierRgba 辅助
a3 = """/* 品阶色 —— 和 core 里地上掉落物同一套 LOOT_COL ✓ */"""
b3 = """/* 品阶色 → 带透明度的 rgba（用来做图标【底色】✓ 第 54 轮）*/
function tierRgba(tier, a) {
  var h = tierHex(tier);
  var r = parseInt(h.substr(1, 2), 16), g = parseInt(h.substr(3, 2), 16),
      b = parseInt(h.substr(5, 2), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}

/* 品阶色 —— 和 core 里地上掉落物同一套 LOOT_COL ✓ */"""
assert t.count(a3) == 1, ('tierrgba', t.count(a3))
t = t.replace(a3, b3)

# ==================== ③ 面板显示"选中的那件" + 使用/脱下按钮 ====================
i3 = t.index("  /* ---- 数值：只算【武器自己】的（用户要求，不掺玩家等级 ✓）---- */")
j3 = t.index("  if (mg) {\n    mg.textContent = BAG.msg")
new3 = '''  /* ---- 数值：显示【当前选中】的那件（默认=已装备 ✓）----
     ★ 第 54 轮：以前固定显示"已装备"的，悬停/点别的武器时对不上 ✗ 现在跟着选中走 ✓ */
  var selItem = null, selIsEquipped = false;
  for (var q = 0; q < BAG.items.length; q++) {
    if (BAG.sel && String(BAG.items[q].id) === String(BAG.sel)) {
      selItem = BAG.items[q].item;
      selIsEquipped = (BAG.weaponItemId && String(BAG.weaponItemId) === String(BAG.items[q].id));
      break;
    }
  }
  if (!selItem) { selItem = shownWeapon(); selIsEquipped = !!w; }
  st.innerHTML = wStatHtml(selItem, !selItem);

  /* ---- 使用 / 脱下（第 54 轮：用户要求"点武器 → 出现使用按钮；用后 → 脱下"）---- */
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

'''
t = t[:i3] + new3 + t[j3:]

# 点击 = 选中（不再是直接穿 ✓）
a4 = """      // ★ 第 53 轮：不再拦"穿不上"了（能装 ✓ 只是发挥度打折 ✓ 见 wStatHtml）
      bagEquip(el.getAttribute('data-id'));"""
b4 = """      /* ★ 第 54 轮（用户要求）：点武器 = 选中它（面板显示它的数值 ✓）
         真正"穿"要再按【使用】按钮 ✓ —— 免得手一滑就换了装备 ✗ */
      BAG.sel = el.getAttribute('data-id');
      BAG.msg = '';
      bagRender();"""
assert t.count(a4) == 1, ('click2', t.count(a4))
t = t.replace(a4, b4)

# 绑定使用/脱下按钮
a5 = """  // 点装备槽 = 脱下
  var eqs = document.getElementById('bagEqSlot');"""
b5 = """  /* ★ 使用 / 脱下 按钮（第 54 轮）*/
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
  var eqs = document.getElementById('bagEqSlot');"""
assert t.count(a5) == 1, ('bind', t.count(a5))
t = t.replace(a5, b5)

# 穿上/脱下之后：选中跟着走
a6 = """  setTimeout(function () { BAG.busy = false; bagFetch(bagRender); }, 420);
}

function bagUnequip() {"""
b6 = """  setTimeout(function () { BAG.busy = false; bagFetch(bagRender); }, 420);
}

/* 脱下之后：选中回到"已装备/默认"（不然按钮状态会停在刚脱下那件上 ✗）*/
function bagUnequip() {"""
assert t.count(a6) == 1, ('unequip', t.count(a6))
t = t.replace(a6, b6)

io.open(p, 'w', encoding='utf-8', newline='\n').write(t)
print('  OK web.js：朝向 + 底色/数量 + 选中/按钮')

# ==================== ④ CSS + 按钮 ====================
p2 = 'web/index.html'
t2 = io.open(p2, encoding='utf-8').read()

a7 = """   <div class="bagEquipRow">
     <div id="bagEqSlot" class="slot eqslot"></div>
     <div class="bagStat" id="bagStat"></div>
   </div>"""
b7 = """   <div class="bagEquipRow">
     <div id="bagEqSlot" class="slot eqslot"></div>
     <div class="bagStat" id="bagStat"></div>
   </div>
   <!-- ★ 第 54 轮：点武器选中 → 这里出现【使用】；穿上之后变成【脱下】（用户要求）-->
   <div class="bagBtns"><button id="bagUse" class="bagB" disabled>使 用</button>
     <span class="bagTip" id="bagSelTip">点上面的格子选中一件武器</span></div>"""
assert t2.count(a7) == 1, ('html', t2.count(a7))
t2 = t2.replace(a7, b7)

a8 = """.slot .tg{position:absolute;right:2px;bottom:0;font-size:10px;color:#ffd83d;
  text-shadow:0 1px 2px #000,0 0 3px #000}"""
b8 = """/* ★ 第 54 轮：阶数挪到【左上角】（用户要求）；数量放【右下角】（MC 惯例 ✓）*/
.slot .tg{position:absolute;left:2px;top:-1px;font-size:10px;color:#ffd83d;font-weight:700;
  text-shadow:0 1px 2px #000,0 0 3px #000}
.slot .cnt{position:absolute;right:2px;bottom:-1px;font-size:11px;color:#fff;font-weight:700;
  text-shadow:0 1px 2px #000,0 0 3px #000}
.slot.sel{outline:2px solid #8ee08a;outline-offset:-2px}
.slot .lvl{left:auto;right:1px;top:-1px}
.bagBtns{display:flex;align-items:center;gap:10px;margin-top:8px}
.bagB.off{border-color:#a05a4a}
.bagB:disabled{opacity:.45;cursor:default}"""
assert t2.count(a8) == 1, ('css2', t2.count(a8))
t2 = t2.replace(a8, b8)
io.open(p2, 'w', encoding='utf-8', newline='\n').write(t2)
print('  OK index.html：使用/脱下按钮 + 阶数/数量位置 + 选中高亮')
