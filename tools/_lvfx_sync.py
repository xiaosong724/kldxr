# -*- coding: utf-8 -*-
"""round446：突破特效同步给别人 + 雷声真的能听见

用户反馈两件事：
  ① "突破的动画没有同步给别的玩家"
  ② "没有打雷的声音，两个玩家都没有听到"

② 的根因：thunder 在【懒加载表】里（不在核心集）→ 第一次触发时
   `sfx()` 发现没加载 → 调 loadSfxKey 并 **return**（不出声）✗
   等它加载完，特效早就放完了 ✓ 所以谁都听不到 ✓
   修：把 thunder 放进核心集（62KB，划算 ✓）；另外把重击用的 strong 也放进去
"""
import io

# ---------- ① 服务端：升级时广播给视野内所有人 ----------
p = 'server/world.py'
s = io.open(p, encoding='utf-8').read()
old = """            # \u2605 \u7b2c 247 \u8f6e\uff1a\u5347\u7ea7\u8fd8\u8981\u64ad\u62a5\u7ed9\u5168\u670d\uff08\u7528\u6237\u8981\u6c42\uff1a\u8c01\u5347\u5230\u4e86\u591a\u5c11\u7ea7\uff09
            self._ticker('%s \u7a81\u7834\u5230\u7b2c %d \u5c42' % (q.name, level), 'up',
                         tag='up:%d' % q.role_id)"""
new = """            # \u2605 \u7b2c 247 \u8f6e\uff1a\u5347\u7ea7\u8fd8\u8981\u64ad\u62a5\u7ed9\u5168\u670d\uff08\u7528\u6237\u8981\u6c42\uff1a\u8c01\u5347\u5230\u4e86\u591a\u5c11\u7ea7\uff09
            self._ticker('%s \u7a81\u7834\u5230\u7b2c %d \u5c42' % (q.name, level), 'up',
                         tag='up:%d' % q.role_id)
            # \u2605\u2605 round446\uff08\u7528\u6237\uff1a"\u7a81\u7834\u7684\u52a8\u753b\u6ca1\u6709\u540c\u6b65\u7ed9\u522b\u7684\u73a9\u5bb6"\uff09\u2605\u2605
            #   \u628a"\u8c01\u5728\u54ea\u91cc\u7a81\u7834\u4e86"\u53d1\u7ed9\u3010\u540c\u5c4f\u3011\u7684\u4eba \u2717 \u4ed6\u4eec\u4e5f\u80fd\u770b\u5230\u96f7\u51fb + \u542c\u5230\u96f7\u58f0 \u2713
            #   \u2605 \u683c\u5f0f\uff1a[x, z, \u65b0\u7b49\u7ea7, \u662f\u4e0d\u662f\u672c\u4eba]\uff08\u548c hurts/mhits \u4e00\u6837\u8d70\u5feb\u7167 \u2713\uff09
            try:
                _v2 = VIEW * VIEW
                for _q2 in self.players.values():
                    if (_q2.x - q.x) ** 2 + (_q2.z - q.z) ** 2 > _v2:
                        continue
                    self._add_pend(_q2.cid, 'lvfx',
                                   [round(q.x, 2), round(q.z, 2), int(level),
                                    1 if _q2 is q else 0])
            except Exception:
                pass"""
assert s.count(old) == 1
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('  ok: server broadcast')

# ---------- ② core：fxLevelUp 支持坐标 + 处理 d.lvfx + thunder 进核心集 ----------
p = 'web/core/game.js'
s = io.open(p, encoding='utf-8').read()


def rep(old, new, tag):
    global s
    assert s.count(old) == 1, (tag, s.count(old))
    s = s.replace(old, new, 1)
    print('  ok:', tag)


rep("""var SFX_CORE = ['swing', 'hit', 'crit'];   /* \u2605 round445\uff1a\u53ea\u7559\u6700\u5e38\u7528\u7684 3 \u4e2a\uff08ogg \u5171\u7ea6 30KB \u2713\uff09*/""",
    """/* \u2605 round446\uff1athunder \u5fc5\u987b\u5728\u6838\u5fc3\u96c6\u91cc \u2717\u2717
   \u4e0d\u7136\u7b2c\u4e00\u6b21\u7a81\u7834\u65f6\u5b83\u8fd8\u5728"\u5f85\u52a0\u8f7d"\u2192 sfx() \u76f4\u63a5 return\uff08\u4e0d\u51fa\u58f0\uff09\u2717
   \u7b49\u5b83\u52a0\u8f7d\u5b8c\uff0c\u7279\u6548\u65e9\u5c31\u653e\u5b8c\u4e86 \u2192 "\u4e24\u4e2a\u73a9\u5bb6\u90fd\u6ca1\u542c\u5230\u96f7\u58f0" \u2713\u2713 */
var SFX_CORE = ['swing', 'hit', 'crit', 'thunder', 'strong'];""",
    'SFX_CORE thunder')

# fxLevelUp 接受坐标（别人在哪突破，就在哪放）
rep("""function fxLevelUp(lv) {
  var cx = P.x, cz = P.z, cy = P.y;""",
    """/* \u2605 round446\uff1a\u652f\u6301\u4f20\u5750\u6807\uff08\u770b\u522b\u4eba\u7a81\u7834\u7528 \u2713\uff09+ \u8fdc\u7684\u58f0\u97f3\u5c0f\u4e00\u70b9 */
function fxLevelUp(lv, atX, atZ, remote) {
  var cx = (typeof atX === 'number') ? atX : P.x;
  var cz = (typeof atZ === 'number') ? atZ : P.z;
  var cy = P.y;""",
    'fxLevelUp coords')

# 音效：本人 1.0，别人按远近 0.35~0.85
rep("""  try { sfx('thunder', 1.0); } catch (e1) { }     /* \u2605 \u96f7\u58f0\uff08\u4e3b\u97f3\uff09*/
  try { sfx('manifest', 0.75); } catch (e1b) { }  /* \u2605 \u91d1\u5c5e\u9189\u97f3\uff08\u8f85\uff09*/
  try { sfx('crit2', 0.55); } catch (e2) { }""",
    """  var _vf = 1.0;
  if (remote) {
    var _d = Math.hypot(cx - P.x, cz - P.z);
    _vf = Math.max(0.32, Math.min(0.85, 1.0 - _d / 45));   /* \u2605 \u8d8a\u8fdc\u8d8a\u8f7b \u2713 */
  }
  try { sfx('thunder', _vf); } catch (e1) { }      /* \u2605 \u96f7\u58f0\uff08\u4e3b\u97f3\uff09*/
  try { sfx('manifest', _vf * 0.75); } catch (e1b) { }  /* \u2605 \u91d1\u5c5e\u9189\u97f3\uff08\u8f85\uff09*/
  try { sfx('crit2', _vf * 0.55); } catch (e2) { }""",
    'sfx volume by distance')

# 震屏/飘字只给本人（别人突破不该抖我的屏 ✓）
rep("""  shake = Math.max(shake, 0.22);
  fxNum('\u7a81\u7834 Lv.' + lv, '#9fd0ff', cx, 3.0, cz);
  try { if (UI.flashWhite) { UI.flashWhite(0.16, '#cfe4ff'); } } catch (e4) { }""",
    """  if (!remote) {
    shake = Math.max(shake, 0.22);
    fxNum('\u7a81\u7834 Lv.' + lv, '#9fd0ff', cx, 3.0, cz);
    try { if (UI.flashWhite) { UI.flashWhite(0.16, '#cfe4ff'); } } catch (e4) { }
  } else {
    /* \u2605 \u522b\u4eba\u7a81\u7834\uff1a\u53ea\u5728\u4ed6\u5934\u4e0a\u6f02\u4e2a\u5c0f\u5b57\uff0c\u4e0d\u9707\u6211\u7684\u5c4f \u2717 \u4e0d\u767d\u95ea\u6211\u7684\u5c4f \u2713\uff09*/
    fxNum('\u7a81\u7834 Lv.' + lv, '#9fd0ff', cx, 3.0, cz);
  }""",
    'remote no shake')

# 处理快照里的 lvfx
rep("""  /* ---- \u6253\u5728\u6211\u8eab\u4e0a\u7684\u4f24\u5bb3 ---- */""",
    """  /* ---- \u2605 round446\uff1a\u6709\u4eba\u7a81\u7834\u4e86\uff08\u81ea\u5df1\u6216\u540c\u5c4f\u7684\u4eba\uff09----
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
