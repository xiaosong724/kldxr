# -*- coding: utf-8 -*-
# 第 256 轮修 bug（用户："怪不能进入安全区范围内"）
# 病根：安全区判断被写进了 if m.kind == '工人': 分支里
#       → 只有工人进不去 ✗ 白领/保安/其它怪完全没有这个判断 ✓
# 做法：把安全区判断提到函数开头（所有怪都过 ✓）
#       再按 kind 分流"工人穿墙 / 其它算墙"✓
import io

p = 'server/world.py'
lines = io.open(p, encoding='utf-8').read().split('\n')

# 找到 if m.kind == '工人': 那行（在 _move_mob 里 ✓）
hit = None
for i, ln in enumerate(lines):
    if ln.strip() == "if m.kind == '工人':" and 1205 <= i + 1 <= 1230:
        hit = i
        break
assert hit is not None, '找不到 _move_mob 里的工人分支'
ind = ' ' * (len(lines[hit]) - len(lines[hit].lstrip()))
print('  第 %d 行：%s（缩进 %d 格）' % (hit + 1, lines[hit].strip(), len(ind)))

# 找这块的结尾 return（工人分支的最后一行 ✓）
end = None
for j in range(hit, hit + 20):
    if lines[j].strip() == 'return':
        end = j
        break
assert end is not None, '找不到工人分支结尾的 return'
print('  工人分支：第 %d~%d 行' % (hit + 1, end + 1))

# 整块替换成：安全区判断在前（所有怪）✗ 工人穿墙在后 ✓
NEW = [
    ind + "# ★★★ 第 256 轮修的真 bug（用户：怪不能进入安全区范围内）★★★",
    ind + "#   病根：这段安全区判断原来被写在 if m.kind == '工人': 里面 ✗",
    ind + "#     → 只有【工人】进不去安全区 ✓",
    ind + "#       白领 / 保安 / 其它所有怪【完全没有这个判断】✗ 大摇大摆走进去 ✓",
    ind + "#   ★ 为什么会写成这样：工人那一支本来是为了"能穿墙"（用户要求建筑工除外 ✓）",
    ind + "#     第 174 轮加安全区规则时 ✗ 顺手加在了那个分支里 ✗ 就只对工人生效了 ✓",
    ind + "#   ★ 修法：安全区判断【提到最前面】✗ 所有怪都过一遍 ✓",
    ind + "#     再按 kind 分流"工人穿墙 / 其它算墙"✓",
    ind + "_nx = m.x + dx",
    ind + "_nz = m.z + dz",
    ind + "_outside = not (abs(m.x) <= mqmod.SAFE_HALF and abs(m.z) <= mqmod.SAFE_HALF)",
    ind + "_would_in = (abs(_nx) <= mqmod.SAFE_HALF and abs(_nz) <= mqmod.SAFE_HALF)",
    ind + "if _outside and _would_in:",
    ind + "    # 本来在外面、这一步会踏进去 → 停在门外（不推出去 ✗ 那样会抖 ✓）",
    ind + "    return",
    ind + "if m.kind == '工人':",
    ind + "    # ★ 工人可以穿墙（用户明确要求"建筑工除外"✓）",
    ind + "    #   已经在安全区里的话也允许走出去（老存档 / 被击退进去 ✓）",
    ind + "    m.x, m.z = _nx, _nz",
    ind + "    return",
]
lines[hit:end + 1] = NEW
io.open(p, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
print('  OK 安全区判断已提到最前面（所有怪生效 ✓）')
