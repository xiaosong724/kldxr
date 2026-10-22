# -*- coding: utf-8 -*-
"""round470：
  ① 武器基础属性显示（基础伤害 / 武器系数 / 基础攻速 / 当前攻速含词条）
  ② 攻速上限说明（全局 ×0.6~×2.2，不是按武器也不是按人物）+ 属性页显示当前攻速
  ③ 客户端攻速要把【攻速词条】算进去（以前漏了 ✗ 服务器算了、客户端没算 ✗）
"""
import io

# ================= 客户端 =================
p = 'web/platform/web.js'
s = io.open(p, encoding='utf-8').read()


def rep(old, new, tag, src=None):
    global s
    assert s.count(old) == 1, (tag, s.count(old))
    s = s.replace(old, new, 1)
    print('  ok:', tag)


# ① 攻速工具函数（含词条 + 上下限）
rep("""function wInterval(it) {
  var b = wBase(it);
  var spd = b ? (+b.atkSpeed || 1.15) : 1.15;
  return 0.62 / Math.max(0.6, Math.min(2.2, spd));
}""",
    """/* \u2605\u2605\u2605 round470\uff1a\u653b\u901f\u4e0a\u4e0b\u9650\u662f\u3010\u5168\u5c40\u5e38\u91cf\u3011\u2717 \u65e2\u4e0d\u662f\u6309\u6b66\u5668\u3001\u4e5f\u4e0d\u662f\u6309\u4eba\u7269 \u2713
   \u6765\u6e90\uff1aserver/weapons.py  S_MIN=0.6  S_MAX=2.2  BASE_INTERVAL=0.62
      \u95f4\u9694 = 0.62 / S\uff08\u79d2\uff09
      \u2192 \u6700\u5feb \u00d72.2 = 0.282 \u79d2\u4e00\u5200 \u00b7 \u6700\u6162 \u00d70.6 = 1.033 \u79d2\u4e00\u5200
   \u2605 \u6bcf\u628a\u6b66\u5668\u81ea\u5df1\u7684\u3010\u57fa\u7840 S\u3011\u662f\u56fa\u5b9a\u7684\uff08\u5315\u9996 1.45 \u00b7 \u9524 0.66\u2026\uff09\u2717
     \u800c\u8bcd\u6761\u7684\u3010\u653b\u901f %\u3011\u4e58\u5728\u57fa\u7840 S \u4e0a \u2192 \u518d\u5939\u56de [0.6, 2.2] \u2713
   \u2605 \u4ee5\u524d\u8fd9\u91cc\u6ca1\u7b97\u8bcd\u6761 \u2717 \u800c\u670d\u52a1\u5668\u7b97\u4e86 \u2717\u2717\uff08\u4e24\u8fb9\u4e0d\u4e00\u81f4 \u2717\uff09*/
var W_SPD_MIN = 0.6, W_SPD_MAX = 2.2, W_BASE_INTERVAL = 0.62;

function wSpdPct(it) {            /* \u6b66\u5668\u4e0a\u7684\u653b\u901f\u8bcd\u6761\u5408\u8ba1 % */
  var af = (it && it.affixes) || [];
  var pct = 0;
  for (var i = 0; i < af.length; i++) {
    if (af[i] && af[i].key === 'spd_pct') { pct += (+af[i].val || 0); }
  }
  return pct;
}
function wSpdBase(it) {           /* \u6b66\u5668\u81ea\u5e26\u7684\u57fa\u7840\u653b\u901f\uff08\u4e0d\u542b\u8bcd\u6761\uff09*/
  var b = wBase(it);
  return b ? (+b.atkSpeed || 1.15) : 1.15;
}
function wSpdTotal(it) {          /* \u542b\u8bcd\u6761\u3001\u5df2\u5939\u4e0a\u4e0b\u9650\u7684\u3010\u5f53\u524d\u653b\u901f\u3011*/
  var v = wSpdBase(it) * (1.0 + wSpdPct(it) / 100.0);
  return Math.max(W_SPD_MIN, Math.min(W_SPD_MAX, v));
}
function wInterval(it) {
  return W_BASE_INTERVAL / wSpdTotal(it);
}""",
    'wSpdTotal + wInterval')

# ② wStatsOf 带上词条
rep("""function wStatsOf(it) {
  var b = wBase(it);
  var spd = b ? (+b.atkSpeed || 1.15) : 1.15;
  var reach = b ? (+b.reach || 2.4) : 2.4;
  var arc = b ? (+b.arc || 1.05) : 1.05;
  return { reach: reach, arc: arc, spd: spd };
}""",
    """function wStatsOf(it) {
  var b = wBase(it);
  var reach = b ? (+b.reach || 2.4) : 2.4;
  var arc = b ? (+b.arc || 1.05) : 1.05;
  /* \u2605 round470\uff1aspd = \u3010\u5f53\u524d\u653b\u901f\uff08\u542b\u8bcd\u6761\u3001\u5df2\u5939\u9650\uff09\u3011\u2717
     spdBase = \u6b66\u5668\u57fa\u7840\u653b\u901f \u2717 spdPct = \u8bcd\u6761\u52a0\u6210 % \u2713\uff08\u9762\u677f\u8981\u5206\u5f00\u5199\uff09*/
  return { reach: reach, arc: arc,
           spd: wSpdTotal(it), spdBase: wSpdBase(it), spdPct: wSpdPct(it) };
}""",
    'wStatsOf')

# ③ 武器基础属性：悬浮浮窗
rep("""    extra += '\u5b9e\u9645\u6bcf\u51fb <b>' + wRealHit(it).toFixed(0) + '</b> \u00b7 \u6bcf\u79d2 <b>' +
      wRealDps(it).toFixed(0) + '</b><br>' +
      '\u6b66\u5668\u5f3a\u5ea6 <b>' + wStrength(it).toFixed(0) + '</b>\uff08\u7eaf\u6bd4\u8f83\u7528\u3001\u4e0d\u542b\u4f60\u7684\u7b49\u7ea7\uff09<br>' +""",
    """    /* \u2605\u2605 round470\uff08\u7528\u6237\uff1a"\u6b66\u5668\u7684\u57fa\u7840\u5c5e\u6027\u8981\u663e\u793a\u51fa\u6765\uff0c\u4f8b\u5982\u57fa\u7840\u4f24\u5bb3\uff0c\u6211\u770b\u9632\u5177\u90fd\u6709\u663e\u793a\u751f\u547d\u503c\u548c\u51cf\u4f24"\uff09\u2605\u2605
       \u9632\u5177\u90a3\u8fb9\u5199\u7684\u662f\u3010\u88c5\u5907\u81ea\u5df1\u7684\u57fa\u7840\u503c\u3011\uff08\u51cf\u4f24 / \u751f\u547d\uff09\u2717
       \u6b66\u5668\u8fd9\u8fb9\u4e00\u76f4\u53ea\u6709"\u5b9e\u9645\u6bcf\u51fb"\uff08\u7b97\u4e0a\u4f60\u7b49\u7ea7\u4e86 \u2717\uff09\u2717 \u6ca1\u6709\u57fa\u7840\u4f24\u5bb3 \u2717
       \u2192 \u8865\u4e0a\uff1a\u57fa\u7840\u4f24\u5bb3\uff08\u5e73\u4f24\uff09\u00b7 \u6b66\u5668\u7cfb\u6570 \u00b7 \u57fa\u7840\u653b\u901f \u2192 \u5f53\u524d\u653b\u901f\uff08\u542b\u8bcd\u6761\uff09\u2713 */
    extra += '\u57fa\u7840\u4f24\u5bb3 <b>' + wFlat(it).toFixed(0) + '</b> \u70b9\uff08\u968f\u54c1\u9636\u548c\u7269\u54c1\u7b49\u7ea7\u957f\uff09<br>' +
      '\u6b66\u5668\u7cfb\u6570 <b>\u00d7' + (+((it.base || {}).coeff) || 1.0).toFixed(2) + '</b>\uff08\u4e58\u5728\u4f60\u7684\u56fa\u6709\u653b\u51fb\u4e0a\uff09<br>' +
      '\u57fa\u7840\u653b\u901f <b>\u00d7' + s.spdBase.toFixed(2) + '</b>' +
      (s.spdPct ? (' \u00b7 \u8bcd\u6761 <b style="color:#8ee0ff">+' + s.spdPct.toFixed(1) + '%</b>') : '') +
      ' \u2192 \u5f53\u524d <b style="color:#ffd83d">\u00d7' + s.spd.toFixed(2) + '</b>' +
      '\uff08' + wInterval(it).toFixed(2) + ' \u79d2\u4e00\u5200\u00b7\u4e0a\u9650 \u00d7' + W_SPD_MAX + '\uff09<br>' +
      '\u5b9e\u9645\u6bcf\u51fb <b>' + wRealHit(it).toFixed(0) + '</b> \u00b7 \u6bcf\u79d2 <b>' +
      wRealDps(it).toFixed(0) + '</b><br>' +
      '\u6b66\u5668\u5f3a\u5ea6 <b>' + wStrength(it).toFixed(0) + '</b>\uff08\u7eaf\u6bd4\u8f83\u7528\u3001\u4e0d\u542b\u4f60\u7684\u7b49\u7ea7\uff09<br>' +""",
    'tooltip weapon base')

# 去掉后面重复的"攻速 ×"那行（已经合并进上面）
rep("""      '\u6253\u51fb\u9762\uff1a' + arcWord(s.arc) + '<br>' +
      '\u653b\u901f \u00d7' + s.spd.toFixed(2) + '\uff08' + wInterval(it).toFixed(2) + ' \u79d2\u4e00\u5200\uff09<br>';""",
    """      '\u6253\u51fb\u9762\uff1a' + arcWord(s.arc) + '<br>';""",
    'tooltip drop dup speed')

# ④ 装备页详情：同样补基础属性
rep("""      stRow('\u5b9e\u9645\u6bcf\u51fb', Math.round(wRealHit(w)), '\u542b\u53d1\u6325\u5ea6\u548c\u5c01\u9876') +
      stRow('\u6bcf\u79d2\u4f24\u5bb3', Math.round(wRealDps(w)), '\u542b\u66b4\u51fb\u671f\u671b') +
      stRow('\u653b\u901f', '\u00d7' + ws.spd.toFixed(2) + '\uff08' + wInterval(w).toFixed(2) + ' \u79d2\u4e00\u5200\uff09', '') +""",
    """      /* \u2605 round470\uff1a\u57fa\u7840\u5c5e\u6027\u5355\u72ec\u5217\u51fa\u6765\uff08\u548c\u9632\u5177\u90a3\u8fb9\u4e00\u4e2a\u53e3\u5f84 \u2713\uff09*/
      stRow('\u57fa\u7840\u4f24\u5bb3', Math.round(wFlat(w)) + ' \u70b9', '\u968f\u54c1\u9636\u548c\u7269\u54c1\u7b49\u7ea7\u957f') +
      stRow('\u6b66\u5668\u7cfb\u6570', '\u00d7' + (+((w.base || {}).coeff) || 1.0).toFixed(2),
            '\u4e58\u5728\u4f60\u7684\u56fa\u6709\u653b\u51fb\u4e0a') +
      stRow('\u5b9e\u9645\u6bcf\u51fb', Math.round(wRealHit(w)), '\u542b\u53d1\u6325\u5ea6\u548c\u5c01\u9876') +
      stRow('\u6bcf\u79d2\u4f24\u5bb3', Math.round(wRealDps(w)), '\u542b\u66b4\u51fb\u671f\u671b') +
      stRow('\u653b\u901f', '\u00d7' + ws.spd.toFixed(2) + '\uff08' + wInterval(w).toFixed(2) + ' \u79d2\u4e00\u5200\uff09',
            '\u57fa\u7840 \u00d7' + ws.spdBase.toFixed(2) +
            (ws.spdPct ? (' + \u8bcd\u6761 ' + ws.spdPct.toFixed(1) + '%') : '') +
            ' \u00b7 \u4e0a\u9650 \u00d7' + W_SPD_MAX) +""",
    'equip page base stats')

# ⑤ 属性页数值格式：支持 '×' 单位
rep("""  function fmtVal(r) {
    var u = (r.unit === '%') ? '%' : '';
    if (r.unit === '\u79d2' || r.unit === '\u7c73/\u79d2') {
      return (Math.round(+r.v * 100) / 100) + ' ' + r.unit;
    }""",
    """  function fmtVal(r) {
    var u = (r.unit === '%') ? '%' : '';
    /* \u2605 round470\uff1a\u65b0\u589e\u3010\u500d\u7387\u3011\u5355\u4f4d\uff08\u653b\u901f \u00d71.32 \u8fd9\u79cd\uff09*/
    if (r.unit === '\u00d7') {
      return '\u00d7' + (Math.round(+r.v * 100) / 100);
    }
    if (r.unit === '\u79d2' || r.unit === '\u7c73/\u79d2') {
      return (Math.round(+r.v * 100) / 100) + ' ' + r.unit;
    }""",
    'fmtVal x')

io.open(p, 'w', encoding='utf-8').write(s)
print('platform 改完')
