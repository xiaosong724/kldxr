# -*- coding: utf-8 -*-
"""round446 后半：core 侧（SFX_CORE + 坐标 + 音量 + 处理 lvfx）"""
import io

p = 'web/core/game.js'
s = io.open(p, encoding='utf-8').read()


def rep(old, new, tag):
    global s
    assert s.count(old) == 1, (tag, s.count(old))
    s = s.replace(old, new, 1)
    print('  ok:', tag)


rep("var SFX_CORE = ['swing', 'hit', 'crit'];",
    """/* \u2605 round446\uff1athunder \u5fc5\u987b\u5728\u6838\u5fc3\u96c6\u91cc \u2717\u2717
   \u4e0d\u7136\u7b2c\u4e00\u6b21\u7a81\u7834\u65f6\u5b83\u8fd8\u5728"\u5f85\u52a0\u8f7d"\u2192 sfx() \u76f4\u63a5 return\uff08\u4e0d\u51fa\u58f0\uff09\u2717
   \u7b49\u5b83\u52a0\u8f7d\u5b8c\uff0c\u7279\u6548\u65e9\u5c31\u653e\u5b8c\u4e86 \u2192 "\u4e24\u4e2a\u73a9\u5bb6\u90fd\u6ca1\u542c\u5230\u96f7\u58f0" \u2713\u2713 */
var SFX_CORE = ['swing', 'hit', 'crit', 'thunder', 'strong'];""",
    'SFX_CORE thunder')

rep("""function fxLevelUp(lv) {
  var cx = P.x, cz = P.z, cy = P.y;""",
    """/* \u2605 round446\uff1a\u652f\u6301\u4f20\u5750\u6807\uff08\u770b\u522b\u4eba\u7a81\u7834\u7528 \u2713\uff09+ \u8fdc\u7684\u58f0\u97f3\u5c0f\u4e00\u70b9 */
function fxLevelUp(lv, atX, atZ, remote) {
  var cx = (typeof atX === 'number') ? atX : P.x;
  var cz = (typeof atZ === 'number') ? atZ : P.z;
  var cy = P.y;""",
    'fxLevelUp coords')

rep("""  try { sfx('thunder', 1.0); } catch (e1) { }     /* \u2605 \u96f7\u58f0\uff08\u4e3b\u97f3\uff09*/
  try { sfx('manifest', 0.75); } catch (e1b) { }  /* \u2605 \u91d1\u5c5e\u9189\u97f3\uff08\u8f85\uff09*/
  try { sfx('crit2', 0.55); } catch (e2) { }""",
    """  var _vf = 1.0;
  if (remote) {
    var _d = Math.hypot(cx - P.x, cz - P.z);
    _vf = Math.max(0.32, Math.min(0.85, 1.0 - _d / 45));   /* \u2605 \u8d8a\u8fdc\u8d8a\u8f7b \u2713 */
  }
  try { sfx('thunder', _vf); } catch (e1) { }           /* \u2605 \u96f7\u58f0\uff08\u4e3b\u97f3\uff09*/
  try { sfx('manifest', _vf * 0.75); } catch (e1b) { }  /* \u2605 \u91d1\u5c5e\u9189\u97f3\uff08\u8f85\uff09*/
  try { sfx('crit2', _vf * 0.55); } catch (e2) { }""",
    'sfx volume')

rep("""  shake = Math.max(shake, 0.22);
  fxNum('\u7a81\u7834 Lv.' + lv, '#9fd0ff', cx, 3.0, cz);
  try { if (UI.flashWhite) { UI.flashWhite(0.16, '#cfe4ff'); } } catch (e4) { }""",
    """  if (!remote) {
    shake = Math.max(shake, 0.22);
    fxNum('\u7a81\u7834 Lv.' + lv, '#9fd0ff', cx, 3.0, cz);
    try { if (UI.flashWhite) { UI.flashWhite(0.16, '#cfe4ff'); } } catch (e4) { }
  } else {
    /* \u2605 \u522b\u4eba\u7a81\u7834\uff1a\u53ea\u6f02\u5b57\uff0c\u4e0d\u9707\u6211\u7684\u5c4f\u3001\u4e0d\u767d\u95ea\u6211\u7684\u5c4f \u2713 */
    fxNum('\u7a81\u7834 Lv.' + lv, '#9fd0ff', cx, 3.0, cz);
  }""",
    'remote no shake')

rep("""  /* ---- \u6253\u5728\u6211\u8eab\u4e0a\u7684\u4f24\u5bb3 ---- */""",
    """  /* ---- \u2605 round446\uff1a\u6709\u4eba\u7a81\u7834\u4e86\uff08\u540c\u5c4f\u7684\u4eba\uff09----
     \u683c\u5f0f [x, z, \u65b0\u7b49\u7ea7, \u662f\u4e0d\u662f\u672c\u4eba]
     \u2605 \u672c\u4eba\u90a3\u6761\u4e0d\u7528\u653e\uff1ame.lv \u90a3\u8fb9\u5df2\u7ecf\u89e6\u53d1\u8fc7\u4e86 \u2717 \u4f1a\u91cd\u590d\u653e\u4e24\u6b21 \u2713 */
  var lf = d.lvfx || [];
  for (var _li = 0; _li < lf.length; _li++) {
    var _le2 = lf[_li];
    if (!_le2 || _le2.length < 4) { continue; }
    if (+_le2[3]) { continue; }
    try { fxLevelUp(+_le2[2] || 1, +_le2[0], +_le2[1], true); } catch (e5) { }
  }

  /* ---- \u6253\u5728\u6211\u8eab\u4e0a\u7684\u4f24\u5bb3 ---- */""",
    'apply lvfx')

io.open(p, 'w', encoding='utf-8').write(s)
print('core 改完')
