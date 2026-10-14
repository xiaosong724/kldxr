# -*- coding: utf-8 -*-
"""第 53 轮（客户端）：去掉穿戴锁，改成显示"发挥度"

★ 和服务器对齐：weapons.mastery_of
   发挥度 = lv >= reqLevel ? 1 : clamp(0.35 + 0.65 × lv/reqLevel, 0.35, 1)
   实际每击 = (固有 × 系数 + 平伤) × 发挥度，再封顶（固有 × 2.5）
   ★ 两边必须逐位一致（test_browser 里有对账 ✓）
"""
import io

p = 'web/platform/web.js'
t = io.open(p, encoding='utf-8').read()

# ① 发挥度
a = """function wRealHit(it) {
  var b = wBase(it);
  if (!b) { return 0; }
  var inh = wInherent();
  var v = inh * (+b.coeff || 1) + wFlat(it);
  return Math.min(v, inh * 2.5);          // §7.5 封顶：装备最多贡献 60% ✓
}"""
b = """/* ★★ 第 53 轮：等级不够【不是不能穿】，而是"发挥度打折" ★★
   （方案 §7.8 原来写的是"不能装"✗ —— 用户改成"能装、只是发挥不出最大伤害" ✓）
   算法和 server/weapons.py 的 mastery_of 逐位一致 ✓ */
function wMastery(it) {
  var req = +((it && it.reqLevel) || 1);
  var lv = (WSC.role && WSC.role.level) || 1;
  if (req <= 1 || lv >= req) { return 1; }
  var v = 0.35 + 0.65 * (lv / req);
  return Math.max(0.35, Math.min(1, v));
}
/* 满发挥（不打折、不封顶）—— 用来告诉玩家"你只发挥了它的多少" ✓ */
function wFull(it) {
  var b = wBase(it);
  if (!b) { return 0; }
  return wInherent() * (+b.coeff || 1) + wFlat(it);
}
function wRealHit(it) {
  var b = wBase(it);
  if (!b) { return 0; }
  var inh = wInherent();
  var v = wFull(it) * wMastery(it);       // ★ 先按等级发挥度打折
  return Math.min(v, inh * 2.5);          // 再按 §7.5 封顶：装备最多贡献 60% ✓
}"""
assert t.count(a) == 1, ('mastery', t.count(a))
t = t.replace(a, b)

# ② 显示：把"穿不上"整段换成"发挥度"
i = t.index("function wStatHtml(it, dim) {")
j = t.index("function bagRender() {")
new = '''function wStatHtml(it, dim) {
  var s = wStatsOf(it);
  var m = wMastery(it);
  var req = +((it && it.reqLevel) || 1);
  var lv = (WSC.role && WSC.role.level) || 1;
  var head = '';
  if (m < 1) {
    // ★ 不拦穿戴了 ✓ 只提示"你现在发挥不出它的全部"（用户要的就是这个 ✓）
    head = '<span style="color:#ffd83d">⚠ 建议 ' + req + ' 级（你现在 ' + lv +
      ' 级）· 只能发挥 <s>' + Math.round(m * 100) + '%</s></span><br>';
  } else if (dim) {
    head = '<span style="opacity:.65">空手 · 按默认单手剑算</span><br>';
  }
  var real = wRealHit(it);
  return head +
    '<span>实际每击 <s>' + real.toFixed(0) + '</s>（暴击 <s>' +
      (real * 1.5).toFixed(0) + '</s> · 20% 概率）' +
      (m < 1 ? '<i style="opacity:.7;font-style:normal"> ← 满发挥 ' +
        (Math.min(wFull(it), wInherent() * 2.5) * 1).toFixed(0) + '</i>' : '') + '</span>' +
    '<span>每秒伤害 <s>' + wRealDps(it).toFixed(0) + '</s>（含暴击期望 ✓）</span>' +
    '<span>武器强度 <s>' + wStrength(it).toFixed(0) +
      '</s> <i style="opacity:.7;font-style:normal">← 只比武器、不含你的等级</i></span>' +
    '<span>范围 <s>' + s.reach.toFixed(1) + '</s> 米 · ' + rangeWord(s.reach) + '</span>' +
    '<span>打击面 ' + arcWord(s.arc) + '（正前方 ' +
      Math.round(s.arc * 2 * 180 / Math.PI) + '°）</span>' +
    '<span>攻速 <s>×' + s.spd.toFixed(2) + '</s>（' + wInterval(it).toFixed(2) + ' 秒一刀）</span>';
}

'''
t = t[:i] + new + t[j:]

# ③ 格子：锁 → 改成"等级不足"的告示（不禁止穿 ✓）
a3 = """    // ★ 第 52 轮：等级不够的武器在格子上就打锁（一眼能看出"这不是我不想穿"✓）
    var need = isW ? wNeedLevel(it) : 0;
    var lock = need ? ' locked' : '';
    html += '<div class="slot' + cur + lock + '" data-id="' + e.id + '" data-w="' + (isW ? 1 : 0) +
      '" data-i="' + i + '"' + (need ? (' title="需要 ' + need + ' 级"') : '') + '>' +
      '<span style="color:' + col + '">' + iconOfItem(it) + '</span>' +
      '<span class="tg">' + (it.tier || 0) + '</span>' +
      (need ? '<span class="lvl">' + need + '级</span>' : '') + '</div>';"""
b3 = """    // ★ 第 53 轮：不禁止穿了 ✓ 只在"发挥不满"的武器上做个黄标（是提示、不是锁 ✓）
    var lowm = isW ? (wMastery(it) < 1) : false;
    html += '<div class="slot' + cur + (lowm ? ' lowmastery' : '') + '" data-id="' + e.id +
      '" data-w="' + (isW ? 1 : 0) + '" data-i="' + i + '"' +
      (lowm ? (' title="建议 ' + (it.reqLevel || 1) + ' 级（发挥 ' +
        Math.round(wMastery(it) * 100) + '%）"') : '') + '>' +
      '<span style="color:' + col + '">' + iconOfItem(it) + '</span>' +
      '<span class="tg">' + (it.tier || 0) + '</span>' +
      (lowm ? '<span class="lvl">' + Math.round(wMastery(it) * 100) + '%</span>' : '') + '</div>';"""
assert t.count(a3) == 1, ('slot', t.count(a3))
t = t.replace(a3, b3)

# ④ 点击：不再有"穿不上"，所以把那段本地拦截删掉（服务器也不再拦 ✓）
i4 = t.index("      // ★ 先本地判一次等级：不够就把话说清楚、而且【留在面板里】✓")
j4 = t.index("      bagEquip(el.getAttribute('data-id'));")
t = t[:i4] + "      // ★ 第 53 轮：不再拦"穿不上"了（能装 ✓ 只是发挥度打折 ✓ 见 wStatHtml）\n" + t[j4:]

# ⑤ 悬停：需要等级 → 改成"发挥度"提示
a5 = """    var needT = wNeedLevel(it);
    if (needT) {
      extra += '<b style="color:#ff8a7a">✗ 需要 ' + needT + ' 级（你现在 ' +
        ((WSC.role && WSC.role.level) || 1) + ' 级）</b><br>';
    }"""
b5 = """    var mT = wMastery(it);
    if (mT < 1) {
      extra += '<b style="color:#ffd83d">⚠ 建议 ' + (it.reqLevel || 1) + ' 级（你现在 ' +
        ((WSC.role && WSC.role.level) || 1) + ' 级）· 只能发挥 ' +
        Math.round(mT * 100) + '%</b><br>';
    }"""
assert t.count(a5) == 1, ('tip', t.count(a5))
t = t.replace(a5, b5)

# ⑥ 服务器拒绝那段：等级不够不再会出现（保留其它两种 ✓）
a6 = """    if (_tx.indexOf('等级不够') >= 0 || _tx.indexOf('不是武器') >= 0 ||
        _tx.indexOf('没有这件') >= 0) {"""
b6 = """    if (_tx.indexOf('不是武器') >= 0 || _tx.indexOf('没有这件') >= 0) {"""
assert t.count(a6) == 1, ('notice', t.count(a6))
t = t.replace(a6, b6)

io.open(p, 'w', encoding='utf-8', newline='\n').write(t)
print('  OK web.js：锁 → 发挥度')

# ⑦ CSS：黄标（不是红锁 ✓）
p2 = 'web/index.html'
t2 = io.open(p2, encoding='utf-8').read()
a7 = """/* ★ 等级不够：压暗 + 左下角标"需要 N 级"（一眼看出不是我不想穿 ✓）*/
.slot.locked{background:rgba(0,0,0,.62);cursor:not-allowed}
.slot.locked svg{opacity:.35}
.slot.locked .lvl{position:absolute;left:1px;bottom:0;font-size:9px;color:#ff8a7a;
  text-shadow:0 1px 2px #000,0 0 3px #000}
.slot.locked:hover{border-color:#ff8a7a88}"""
b7 = """/* ★ 第 53 轮：等级不够【不禁止穿】—— 只在右下角标"发挥 X%"（黄标 = 提示，不是锁 ✓）*/
.slot.lowmastery{border-color:#ffd83d55}
.slot.lowmastery .lvl{position:absolute;left:1px;top:0;font-size:9px;color:#ffd83d;
  text-shadow:0 1px 2px #000,0 0 3px #000}
.slot.lowmastery:hover{border-color:#ffd83d}"""
assert t2.count(a7) == 1, ('css', t2.count(a7))
t2 = t2.replace(a7, b7)
io.open(p2, 'w', encoding='utf-8', newline='\n').write(t2)
print('  OK CSS：红锁 → 黄标')
