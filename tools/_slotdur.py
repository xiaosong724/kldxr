import io, re
p = 'web/platform/web.js'
t = io.open(p, encoding='utf-8').read()
# 找 bagRender 里那个 durbar 块（内联 it.dur ✗ 没走 itDur ✓）
m = re.search(r"( *)(var _dd = \(typeof it\.dur === 'number'\) \? it\.dur : it\.durMax;)", t)
if m:
    print('  找到第 %d 行：%s' % (t[:m.start()].count('\n') + 1, m.group(2)[:70]))
    t = t[:m.start(2)] + ("/* ★ 第 235 轮：这里原来读 item_json 里的旧值 ✗\n"
                          + m.group(1) + "   穿在身上期间服务端记在 p.wDur ✓ item_json 不更新 ✓\n"
                          + m.group(1) + "   → 格子上看到的是穿之前的值 ✓（用户："耐久掉了一半"✓）\n"
                          + m.group(1) + "   ★ 改成 itDur：是身上那件就用实时值 ✓ 不是就用原来的 ✓ */\n"
                          + m.group(1) + "var _dd = itDur(it, (typeof e !== 'undefined' && e ? e.id : null));") + t[m.end(2):]
    print('  OK 改成 itDur ✓')
else:
    print('  ★ 没找到 ✗ 看看还有哪些地方内联了 it.dur：')
    for i, ln in enumerate(t.split('\n')):
        if 'it.dur' in ln and 'typeof' in ln and 'itDur' not in ln:
            print('     第 %d 行: %s' % (i + 1, ln.strip()[:90]))
io.open(p, 'w', encoding='utf-8', newline='\n').write(t)
