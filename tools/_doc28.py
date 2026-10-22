# -*- coding: utf-8 -*-
"""方案补：§22 镜头推进已删 + 贴图切换已实现"""
import io

p = 'docs/画面与性能方案.md'
s = io.open(p, encoding='utf-8').read()
add = """

---

## 22. 两项用户决定（2026-10-18）

### 22.1 镜头推进：**删掉**

> 用户："镜头推进这个不要了，感觉没什么用"

- 已删除 `camPunch` 全部代码（变量、触发、相机那段位移）
- **保留** 暴击顿帧 0.11 秒（用户没说这个不要）
- 相机恢复成原来的直出：`cam.position.set(P.x+sx, ...)`
- 测试：`tools/test_crit_punch.js` 已删；`tools/test_crit_real.js` 改成只验顿帧（真打，实测峰值 0.0767，起始 0.11）

### 22.2 贴图：**用程序化 B，但保留原版，设置里可切，默认原版**

> 用户："这个用B，但是还是保留原来的，在菜单设置里，可以进行切换，默认是原来的"

| 项 | 实现 |
|---|---|
| 设置项 | 设置 → 画面 → **贴图风格**：`原版`（默认）/ `程序化 B` |
| 默认值 | `SETCFG.tex = 'orig'`（老存档没有这个键 → 也走默认 ✓）|
| 切换机制 | **换 `THREE.Texture.image` + `needsUpdate`** ✗ 不重建材质/区块 ✓ 所有材质自动跟着变 ✓ |
| 原图还原 | 第一次切换前把原图对象存下来，切回去时原样放回 ✓ |
| 颜色处理 | 程序化图本身是末日色调 → 材质 `color` 改白；切回原版再乘回 `TEX_TINT` ✓ |
| 覆盖范围 | 8 种方块贴图（草/土/石/砖/木/原木/水/枯叶）+ **大地面那层 `ground_mix`**（它不在 M/T 表里，单独处理）|
| 生成器 | `web/platform/web.js`：`procTexMake()` / `procTexGround()`（32×32，Canvas 噪声，固定种子）|

★ 为什么放平台层：要用 Canvas，core 不许碰浏览器对象（分层铁律 `check_core_dom` 盯着）。

### 22.2.1 踩到的两个坑

1. **`var T = (typeof T !== 'undefined') ? T : null`** —— `var` 提升让右边那个 `T` 指向刚声明的局部变量
   → `typeof T` 永远是 `undefined` → 函数一进去就 `return false`
   → 表现是"点了切换毫无反应，而且一点报错都没有" ✗（改成 `texMap` / `matMap` ✓）
2. **大地面不在切换列表里** —— 第一版只换了 `T/M`，而可见的主地面用的是 `groundMaterial()` 的
   `ground_mix.png`（不在 T 里）→ 切换后画面几乎没变化 ✗（现在单独换了它 ✓）

### 22.3 验收（`tools/test_tex_switch.js`）

```
默认: {"tex":"orig","procOn":false}
PASS  ★★ 默认是原版贴图
切换后: {"tex":"proc","procOn":true,"cached":[...],"grassIsCanvas":true,"grassW":32,"matColor":"#ffffff"}
PASS  ★★ 切到程序化贴图生效
PASS  ★★ 草地方块的贴图换成了 32×32 程序化图
PASS  ★★ 程序化图不再乘 TINT（材质色改成白）
PASS  ★★ 画面确实变了
切回后: {"tex":"orig","procOn":false,"grassIsImg":true,"grassW":128,"matColor":"#8f8a62"}
PASS  ★★ 切回原版生效
PASS  ★★ 贴图换回了原来的图片对象（IMG）
PASS  ★★ 原版的 TINT 调色也恢复了
PASS  ★ 切回来的差异比"切到程序化"小（说明确实还原了）
ALL PASS ✓
```

对比图：`docs/shots/texcmp_ab.png`（左原版 / 右程序化，同一位置同一角度）

### 22.4 还没做的（等你决定）

- `web/assets/3d/*.png` **仍然保留**（因为默认要用原版 ✓ 版权问题等你决定"彻底换掉"再删）
- 程序化目前只做了"B"那一套；要调脏/调细节随时改参数
"""
assert '## 22. ' not in s
io.open(p, 'w', encoding='utf-8').write(s.rstrip('\n') + add)
print('已追加 §22')
