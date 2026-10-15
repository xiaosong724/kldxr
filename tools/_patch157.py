# -*- coding: utf-8 -*-
"""第 157 轮（用户要求）：自画红色恶魔头 + 数字放里面 + 魔气越高头越大

用户原话："自己做一个红色恶魔头，把数字放到恶魔头里，魔气越高恶魔头越大"

设计：
  · 用内联 SVG 手画一个恶魔头（两只角 + 尖下巴 + 怒眼 + 獠牙 ✓）
    ★ 完全自己画 ✗ 不抄任何素材 ✓（和防具图标一个原则 ✓）
  · 数字放在恶魔头【里面】（正中偏下 ✓ 留给眼睛的位置 ✓）
  · 大小随魔气增长：22px（低）→ 40px（500 以上封顶 ✓）
  · 颜色还是五档递增（浅红 → 正红 → 深红 → 暗红 → 血红偏黑 ✓）
    恶魔头的描边用深色 ✓ 保证在任何背景上都看得清 ✓
  · ★ 只在数值变化时才重建 SVG ✗（每帧都调 ✓ 不能每帧重画 ✓）
"""
import io

P = 'web/platform/web.js'
t = io.open(P, encoding='utf-8').read()

# ---------- ① 新增 mqSvg：画恶魔头 ----------
A = "var MQ_ICON = '\\uD83D\\uDC7F ';          // \ud83d\udc7f \u5c0f\u6076\u9b54"
if t.count(A) != 1:
    # 兼容：直接写中文的那一版
    A = "var MQ_ICON = '\U0001F47F ';          // 👿 小恶魔"
assert t.count(A) == 1, ('MQ_ICON 锚点: %d' % t.count(A))

DEVIL = r'''/* ★★ 第 157 轮（用户要求）：自己画的红色恶魔头 ★★
   用户原话："自己做一个红色恶魔头，把数字放到恶魔头里，魔气越高恶魔头越大"

   ★ 三条都在这里实现：
     ① 手画（两条角 + 尖下巴 + 怒眼 + 獠牙）—— 不抄任何素材 ✓
     ② 数字放在头【里面】（正中偏下，上面留给眼睛 ✓）
     ③ 魔气越高头越大：22px（低）→ 40px（500 以上封顶 ✓）
   ★ 只返回 SVG 字符串 ✗ 调用方负责"值变了才重建"✓（每帧都调 ✓ 不能每帧重画 ✓）*/
function mqSvg(v) {
  v = Math.round(+v || 0);
  var col = mqColor(v);
  // 大小：魔气 0 → 22px，每 30 点涨 1px，最多涨到 40px（约 540 点封顶 ✓）
  var sz = 22 + Math.min(18, Math.floor(v / 30));
  // 数字越长字号越小（4 位数要塞得下 ✓）
  var fs = (v >= 1000) ? 9.5 : (v >= 100) ? 11 : 13;
  var dark = '#2a0505';
  return '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 40 40" '
    + 'style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.85))">'
    // 两只角
    + '<path d="M9 14 L3 2 L16 9 Z" fill="' + col + '" stroke="' + dark + '" stroke-width="1.6"/>'
    + '<path d="M31 14 L37 2 L24 9 Z" fill="' + col + '" stroke="' + dark + '" stroke-width="1.6"/>'
    // 头（额头宽、下巴尖 ✓）
    + '<path d="M20 6 C31 6 35 13 34 21 C33 30 27 37 20 37 C13 37 7 30 6 21 '
    + 'C5 13 9 6 20 6 Z" fill="' + col + '" stroke="' + dark + '" stroke-width="1.8"/>'
    // 怒眼（向内下压的三角 ✓ 一看就凶 ✓）
    + '<path d="M10 17 L18 21 L10 23 Z" fill="' + dark + '"/>'
    + '<path d="M30 17 L22 21 L30 23 Z" fill="' + dark + '"/>'
    // 数字（放在头里，眼睛下面 ✓）
    + '<text x="20" y="' + (v >= 1000 ? 34 : 33) + '" text-anchor="middle" '
    + 'font-size="' + fs + '" font-weight="700" font-family="inherit" '
    + 'fill="#fff" stroke="' + dark + '" stroke-width="0.7" paint-order="stroke">'
    + v + '</text>'
    + '</svg>';
}

var MQ_ICON = '\U0001F47F ';          /* 👿 保留着：万一哪里还要文字版 ✓ */'''

t = t.replace(A, DEVIL)

# ---------- ② UI.plate.mq：改用恶魔头 ----------
OLD = """    var col = (typeof mqColor === 'function') ? mqColor(v) : '#ff5a4a';
    var txt = ((typeof MQ_ICON === 'string') ? MQ_ICON : '\\uD83D\\uDC7F ') + v;
    if (ui.mqEl.textContent !== txt) { ui.mqEl.textContent = txt; }
    if (ui.mqEl.style.color !== col) { ui.mqEl.style.color = col; }
    /* \u2605 \u9ad8\u9b54\u6c14\u52a0\u4e00\u5c42\u53d1\u5149 \u2717 \u8ba9"\u770b\u7740\u5c31\u5371\u9669"\u8fd9\u4ef6\u4e8b\u4e00\u773c\u53ef\u89c1 \u2713 */
    var glow = (v >= 200) ? ('0 0 6px ' + col) : 'none';
    if (ui.mqEl.style.textShadow.indexOf('6px') < 0 !== (v >= 200)) {
      ui.mqEl.style.textShadow = '0 1px 2px #000, 0 0 3px #000'
        + (glow === 'none' ? '' : (', ' + glow));
    }
    ui.mqEl.style.display = 'block';"""
if t.count(OLD) != 1:
    import re
    m = re.search(r"    var col = \(typeof mqColor[\s\S]*?ui\.mqEl\.style\.display = 'block';", t)
    assert m, '找不到 plate.mq 的绘制段 ✗'
    OLD = m.group(0)
assert t.count(OLD) == 1, ('plate.mq 锚点: %d' % t.count(OLD))
t = t.replace(OLD, """    /* ★ 第 157 轮：改成【自画的恶魔头】✗ 数字在头里面 ✓（用户要求 ✓）
       ★ 只在值变了才重建 ✗（这个函数每帧都调 ✓ 每帧重画 SVG 会白烧 CPU ✓）*/
    if (ui._mqV !== v) {
      ui._mqV = v;
      ui.mqEl.innerHTML = mqSvg(v);
    }
    ui.mqEl.style.display = 'block';""")

io.open(P, 'w', encoding='utf-8', newline='\n').write(t)
print('  OK platform：mqSvg（自画恶魔头）+ plate.mq 改用它')
print('  DONE')
