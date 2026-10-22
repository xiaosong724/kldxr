# -*- coding: utf-8 -*-
"""round468：词条一条一行显示（用户："装备的词条每一条要换行显示，这样看起来更清楚一些"）"""
import io

p = 'web/platform/web.js'
s = io.open(p, encoding='utf-8').read()


def rep(old, new, tag):
    global s
    assert s.count(old) == 1, (tag, s.count(old))
    s = s.replace(old, new, 1)
    print('  ok:', tag)


# ① 装备页详情：武器词条 → 一条一行
rep("""      ((w.affixes && w.affixes.length)
        ? stRow('\u8bcd\u6761', w.affixes.length + ' \u6761',
                w.affixes.map(function (a) { return a.text; }).join(' \u00b7 '))
        : stRow('\u8bcd\u6761', '\u65e0', '')) +""",
    """      /* \u2605\u2605 round468\uff08\u7528\u6237\uff1a"\u8bcd\u6761\u6bcf\u4e00\u6761\u8981\u6362\u884c\u663e\u793a\uff0c\u8fd9\u6837\u770b\u8d77\u6765\u66f4\u6e05\u695a"\uff09\u2605\u2605
         \u4ee5\u524d\u662f\u4e00\u884c "\u8840\u5438 +3.2% \u00b7 \u66b4\u51fb\u7387 +5% \u00b7 \u5bfb\u5b9d +12%" \u2717 \u6324\u6210\u4e00\u56e2 \u2713
         \u73b0\u5728\u6bcf\u6761\u4e00\u884c \u2717 \u5e26\u524d\u5bfc\u7b26\u53f7 \u2713 */
      affixBlock('\u6b66\u5668\u8bcd\u6761', w.affixes) +""",
    'weapon affix lines')

# ② 防具词条同样
rep("""    var affTxt = (ar.affixes && ar.affixes.length)
      ? ar.affixes.map(function (a) { return a.text; }).join(' \u00b7 ') : '\u65e0';""",
    """    var affTxt = '';   /* \u2605 round468\uff1a\u9632\u5177\u8bcd\u6761\u4e5f\u6539\u6210\u4e00\u6761\u4e00\u884c\uff08\u89c1\u4e0b\u9762 affixBlock\uff09*/""")
rep("""      stRow('\u8bcd\u6761', (ar.affixes && ar.affixes.length) ? (ar.affixes.length + ' \u6761') : '\u65e0', affTxt) +""",
    """      affixBlock('\u9632\u5177\u8bcd\u6761', ar.affixes) +""",
    'armor affix lines')

# ③ 悬浮提示里的词条：也一条一行
rep("""    ((it.affixes && it.affixes.length) ? (function () {
      var out = '<span style="color:#ffd83d">\u8bcd\u6761 ' + it.affixes.length + ' \u6761\uff1a</span>';
      for (var ai = 0; ai < it.affixes.length; ai++) {
        var af = it.affixes[ai];
        out += '<span style="color:#8ee0ff">\u00b7 ' + (af.text || af.name || '') +
          '</span>';
      }
      return out;
    })() : '') +""",
    """    ((it.affixes && it.affixes.length) ? (function () {
      /* \u2605 round468\uff1a\u4e00\u6761\u4e00\u884c \u2717\u2717\uff08\u7528\u6237\uff1a"\u6362\u884c\u663e\u793a\u770b\u5f97\u6e05\u695a"\uff09*/
      var out = '<span style="color:#ffd83d">\u8bcd\u6761 ' + it.affixes.length + ' \u6761\uff1a</span>' +
        '<span style="display:block;margin-top:2px"></span>';
      for (var ai = 0; ai < it.affixes.length; ai++) {
        var af = it.affixes[ai];
        out += '<span style="color:#8ee0ff;display:block;padding-left:6px">\u2022 ' +
          (af.text || af.name || '') + '</span>';
      }
      return out;
    })() : '') +""",
    'tooltip affix lines')

# ④ 新增 affixBlock 工具函数（放在 equipRender 之前）
rep("""function equipRender() {""",
    """/* \u2605 round468\uff1a\u8bcd\u6761\u5757\uff08\u4e00\u6761\u4e00\u884c \u2717 \u6ca1\u8bcd\u6761\u65f6\u53ea\u5199\u4e00\u53e5\uff09*/
function affixBlock(title, list) {
  if (!list || !list.length) {
    return stRow(title, '\u65e0', '');
  }
  var h = '<div class="ptLine" style="justify-content:space-between;padding:4px 0 2px">' +
    '<span style="color:#cfd8e4">' + title + '</span>' +
    '<span class="bagTip">' + list.length + ' \u6761</span></div>';
  for (var i = 0; i < list.length; i++) {
    h += '<div style="color:#8ee0ff;font-size:13px;padding:1px 0 1px 8px">\u2022 ' +
      (list[i].text || list[i].name || '') + '</div>';
  }
  return h;
}

function equipRender() {""",
    'affixBlock')

io.open(p, 'w', encoding='utf-8').write(s)
print('platform 改完')
