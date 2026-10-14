# -*- coding: utf-8 -*-
"""第 56 轮 UI（用户 1~6 条）
  ① 使用/脱下按钮太丑 → 用和设置面板 .opt 同一套样式
  ② 统一在右上角做一个 X（不再只有信息页有关闭）
  ③ 每页高度不一致 → 面板固定高度，只有内容区滚动
  ④ 高品阶只要背景色，不要额外边框
  ⑤ 点装备时"已装备"文案跟着变 → 数值改成挂在"选中的武器"名下
  ⑥ 点别处自动关掉介绍框
"""
import io

P = 'web/index.html'
t = io.open(P, encoding='utf-8').read()


def rep(a, b, name):
    global t
    c = t.count(a)
    assert c == 1, '%s: %d 次' % (name, c)
    t = t.replace(a, b)
    io.open(P, 'w', encoding='utf-8', newline='\n').write(t)
    print('  OK', name)


# ---------- ② 统一 X：面板头部右上角 ----------
rep("""  <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px">
   <div style="font-size:17px;font-weight:800;color:#ffd83d">菜单</div>
   <div style="font-size:11px;color:#9aa4b2">改完立即生效 ✓ 自动保存 <span id="setFps" style="color:#8ee08a">FPS --</span></div>
  </div>""",
"""  <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
   <div style="font-size:17px;font-weight:800;color:#ffd83d">菜单</div>
   <div style="display:flex;align-items:center;gap:10px">
     <div style="font-size:11px;color:#9aa4b2">改完立即生效 ✓ 自动保存 <span id="setFps" style="color:#8ee08a">FPS --</span></div>
     <!-- ★ 第 56 轮：右上角统一一个 X（不再只有"信息"页里有关闭 ✓ 用户要求）-->
     <div id="setX" title="关闭（Esc）">✕</div>
   </div>
  </div>""", '统一 X')

# 把信息页里那个老的"关闭"按钮去掉（统一用右上角的 X ✓）
rep("""    <div id="setClose" class="opt" style="flex:1;padding:10px;background:#2a3550">关闭</div>""",
"""    <!-- ★ 第 56 轮：这里原来有个"关闭"按钮 —— 现在统一用右上角的 X 了 ✓
         （JS 里 setClose 可能还在找它 → 保留一个隐藏的占位，免得报错 ✗）-->
    <div id="setClose" style="display:none"></div>""", '去掉老关闭')

# ---------- ③ 固定高度：面板改成 flex 列，只有内容区滚动 ----------
rep(""" <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(440px,93vw);max-height:88vh;overflow:auto;
   background:linear-gradient(180deg,#1e2630f5,#141a22f5);border:1px solid #ffffff28;border-radius:14px;padding:16px 18px;color:#e8eef6">""",
""" <!-- ★ 第 56 轮：固定高度 —— 以前每页内容多少不同，切标签时整个面板会跳 ✗
      现在面板高度定死（min(78vh,560px)），只有内容区滚动 ✓ -->
 <div id="setBox" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(440px,93vw);
   height:min(78vh,560px);display:flex;flex-direction:column;
   background:linear-gradient(180deg,#1e2630f5,#141a22f5);border:1px solid #ffffff28;border-radius:14px;padding:16px 18px;color:#e8eef6">""",
'面板固定高度')

# ---------- ⑤ 背包页重排：数值挂到"选中的武器"名下，装备只留槽 ----------
rep("""   <div class="bagHead">
     <span class="setLabel" style="margin:0">背包</span>
     <span class="bagTip" id="bagCount"></span>
   </div>
   <div id="bagGrid" class="bagGrid"></div>

   <div class="bagHead" style="margin-top:12px">
     <span class="setLabel" style="margin:0">装备</span>
     <span class="bagTip">点装备槽 = 脱下</span>
   </div>
   <div class="bagEquipRow">
     <div id="bagEqSlot" class="slot eqslot"></div>
     <div class="bagStat" id="bagStat"></div>
   </div>
   <!-- ★ 第 54 轮：点武器选中 → 这里出现【使用】；穿上之后变成【脱下】（用户要求）-->
   <div class="bagBtns"><button id="bagUse" class="bagB" disabled>使 用</button>
     <span class="bagTip" id="bagSelTip">点上面的格子选中一件武器</span></div>
   <div class="bagEmpty" id="bagMsg"></div>
   <div id="bagTipBox" class="bagTipBox"></div>""",
"""   <div class="bagHead">
     <span class="setLabel" style="margin:0">背包</span>
     <span class="bagTip" id="bagCount"></span>
   </div>
   <div id="bagGrid" class="bagGrid"></div>
   <!-- ★ 第 54 轮：点武器选中 → 这里出现【使用】；穿上之后变成【脱下】-->
   <div class="bagBtns"><button id="bagUse" class="bagB" disabled>使 用</button>
     <span class="bagTip" id="bagSelTip">点上面的格子选中一件武器</span></div>

   <!-- ★★ 第 56 轮（用户第 5 条）：以前这几行挂在"装备"标题下面 ✗
        点别的武器时它就跟着变 → 看着像"已装备的数值变了"✗ 多余
        现在改成挂在【选中的武器】名下 ✓ 标题就是那件装备的名字 ✓ -->
   <div class="bagHead" style="margin-top:12px">
     <span class="setLabel" style="margin:0" id="bagSelName">选中的武器</span>
     <span class="bagTip">数值跟着上面选中走 ✓</span>
   </div>
   <div class="bagStat" id="bagStat"></div>

   <div class="bagHead" style="margin-top:12px">
     <span class="setLabel" style="margin:0">已装备</span>
     <span class="bagTip">点装备槽 = 脱下</span>
   </div>
   <div class="bagEquipRow">
     <div id="bagEqSlot" class="slot eqslot"></div>
   </div>
   <div class="bagEmpty" id="bagMsg"></div>
   <div id="bagTipBox" class="bagTipBox"></div>""", '背包页重排')

# ---------- ①④ 样式：按钮统一 .opt 风格 / 去掉额外边框 ----------
rep("""/* ★ 第 54 轮：阶数 → 【左上角】；数量 → 【右下角】（MC 惯例 ✓）*/""",
"""/* ★ 第 56 轮（用户第 1 条）：按钮改用和设置面板 .opt 同一套样子 ✓
   以前是"深棕 + 亮边"，和面板的蓝灰风格不搭 ✗ */
.bagB{padding:8px 14px;border-radius:9px;background:#26303c;border:1px solid #ffffff22;
  font-size:13px;color:#e8eef6;cursor:pointer;font-family:inherit}
.bagB:hover{background:#2f3b49;border-color:#ffffff3a}
.bagB.off{background:#3a2630;border-color:#a05a4a66}
.bagB:disabled{opacity:.4;cursor:default}
#setX{width:26px;height:26px;border-radius:8px;background:#26303c;border:1px solid #ffffff22;
  display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:13px;color:#cfd8e3}
#setX:hover{background:#3a2630;border-color:#a05a4a66;color:#ffb4a0}
/* 固定高度之后：内容区自己滚，切标签不再整块跳 ✓ */
#setBox .tabpane{flex:1;min-height:0;overflow:auto;padding-right:2px}
#setTabs,#setBox>div:first-child{flex:0 0 auto}
/* ★ 第 56 轮：阶数 → 【左上角】；数量 → 【右下角】（MC 惯例 ✓）*/""",
'按钮风格 + 滚动')

# ④ 去掉等级不足那条额外边框
rep(""".slot.lowmastery{border-color:#ffd83d55}""",
"""/* ★ 第 56 轮（用户第 4 条）：高品阶用底色区分就够了 ✓ 不要再加额外边框 ✗ */
.slot.lowmastery{}""", '去额外边框')
rep(""".slot.lowmastery:hover{border-color:#ffd83d}""",
""".slot.lowmastery:hover{background:rgba(255,255,255,.14)}""", '去悬停边框')

# 高品阶不再用边框 → 选中/已装备也改成用底色区分（不再画框 ✓）
rep(""".slot.sel{outline:2px solid #8ee08a;outline-offset:-2px}""",
"""/* 选中/已装备：用【右上角一个小点】+ 提亮底色区分（不画框 ✓ 用户第 4 条）*/
.slot.sel{background-image:linear-gradient(180deg,rgba(255,255,255,.22),rgba(255,255,255,.06))}
.slot.cur::after{content:'';position:absolute;right:2px;top:2px;width:6px;height:6px;
  border-radius:50%;background:#8ee08a;box-shadow:0 0 4px #8ee08a}""", '选中用底色/小点')
