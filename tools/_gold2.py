# -*- coding: utf-8 -*-
# round294: show gold - (a) server pushes it in `me`, (b) top-left player info row,
#           (c) a new menu tab.
# ★ PURE INSERTIONS ONLY. Nothing is deleted. ast/node checks run before writing.
import ast
import io

# ============================================================ 1) server: me.gold
p = 'server/world.py'
lines = io.open(p, encoding='utf-8').read().split('\n')
a = "                _me0['hpm'] = int(self._hp_max(p))"
h = [i for i, ln in enumerate(lines) if ln.strip() == a.strip()]
assert len(h) == 1, 'me anchor: %d' % len(h)
i = h[0]
ind = ' ' * (len(lines[i]) - len(lines[i].lstrip()))
lines[i + 1:i + 1] = [
    ind + "# round294: gold goes out with `me` (one extra int, no new message).",
    ind + "#   The client adopts it field-wise, so a missing value never zeroes it.",
    ind + "_me0['gold'] = int(getattr(p, 'gold', 0) or 0)",
]
out = '\n'.join(lines)
ast.parse(out)
io.open(p, 'w', encoding='utf-8', newline='\n').write(out)
print('  server: me.gold added at line %d' % (i + 2))

# ============================================================ 2) client: top-left row
p2 = 'web/platform/web.js'
t = io.open(p2, encoding='utf-8').read()
anchor = "    + stRow('\u9b54\u6c14\u503c', (MY_MQ > 0 ? (MQ_ICON + MY_MQ) : '0'),"
hits = [j for j, ln in enumerate(t.split('\n')) if ln.startswith(anchor)]
assert len(hits) == 1, 'magic row anchor: %d' % len(hits)
old_row = t.split('\n')[hits[0]]
# find the whole stRow(...) call (it may span lines) by matching to the closing line
L = t.split('\n')
k = hits[0]
while ')' not in L[k] or L[k].count('(') > L[k].count(')'):
    k += 1
    if k - hits[0] > 6:
        break
ins = [
    "    /* round294: gold. Read from the `me` payload (WSC.role.gold) - the",
    "       server sends it every tick, so this never goes stale. */",
    "    + stRow('\u91d1\u5e01', fmtGold((WSC.role && WSC.role.gold) || 0), GOLD_COL)",
]
L[k + 1:k + 1] = ins
t = '\n'.join(L)
# add the tiny helpers right before statRender()
helper = """/* round294: gold display helpers.
   fmtGold(): plain digits below 10000, short form above (12,345 / 1.2wan).
   GOLD_COL is the same yellow used by the ticker's level-up colour. */
var GOLD_COL = '#ffd83d';
function fmtGold(n) {
  n = Math.max(0, Math.floor(+n || 0));
  if (n < 10000) { return String(n); }
  if (n < 100000000) { return (n / 10000).toFixed(n < 100000 ? 1 : 0) + '\u4e07'; }
  return (n / 100000000).toFixed(2) + '\u4ebf';
}
"""
idx = t.find('function statRender() {')
assert idx > 0, 'statRender not found'
t = t[:idx] + helper + t[idx:]
io.open(p2, 'w', encoding='utf-8', newline='\n').write(t)
print('  client: gold row + helpers added')

# ============================================================ 3) menu tab + pane
p3 = 'web/index.html'
h2 = io.open(p3, encoding='utf-8').read()
anchor2 = '<div class="tab" data-tab="view">'
hits2 = [j for j, ln in enumerate(h2.split('\n')) if anchor2 in ln]
assert len(hits2) == 1, 'view tab anchor: %d' % len(hits2)
L2 = h2.split('\n')
j = hits2[0]
ind2 = L2[j][:len(L2[j]) - len(L2[j].lstrip())]
L2[j:j] = [
    ind2 + '<!-- round294: gold tab (balance + how to get it) -->',
    ind2 + '<div class="tab" data-tab="gold">\u91d1\u5e01</div>',
]
h2 = '\n'.join(L2)
# pane: insert right before the view pane
pane_anchor = '<div class="tabpane" data-pane="view">'
hits3 = [j for j, ln in enumerate(h2.split('\n')) if pane_anchor in ln]
assert len(hits3) == 1, 'view pane anchor: %d' % len(hits3)
L3 = h2.split('\n')
j3 = hits3[0]
ind3 = L3[j3][:len(L3[j3]) - len(L3[j3].lstrip())]
L3[j3:j3] = [
    ind3 + '<div class="tabpane" data-pane="gold">',
    ind3 + '  <div class="mrow" style="font-size:22px;color:#ffd83d;text-align:center;padding:14px 0">',
    ind3 + '    <span id="goldBig">0</span> <span style="font-size:13px;color:#aaa">\u91d1\u5e01</span>',
    ind3 + '  </div>',
    ind3 + '  <div class="mhint">',
    ind3 + '    \u6253\u602a\u7269\u6389\u843d \u00b7 \u5356\u7269\u54c1\u7ed9\u7cfb\u7edf \u00b7 \u4ea4\u6613\u6240\u5356\u7ed9\u5176\u4ed6\u73a9\u5bb6<br>',
    ind3 + '    \u4e0a\u9650 10 \u4ebf \u00b7 \u5230\u9876\u540e\u81ea\u52a8\u6362\u6210\u3010\u9ec4\u91d1\u3011\uff081 \u9ec4\u91d1 = 1 \u4ebf\uff09',
    ind3 + '  </div>',
    ind3 + '</div>',
]
h2 = '\n'.join(L3)
io.open(p3, 'w', encoding='utf-8', newline='\n').write(h2)
print('  client: gold tab + pane added')
print('  style tags: %d/%d' % (h2.count('<style'), h2.count('</style>')))
