# -*- coding: utf-8 -*-
"""round466 第三部分：客户端 UI（设置里加"自动出售"下拉）"""
import io

# ---------------- ① index.html：设置面板底部加一行 ----------------
p = 'web/index.html'
s = io.open(p, encoding='utf-8').read()
old = """  <label style="display:flex;align-items:center;gap:8px;padding:7px 2px;font-size:13px;cursor:pointer;user-select:none">
    <input type="checkbox" id="setAutoLoot" style="width:17px;height:17px;flex:0 0 auto">
    <span>\u81ea\u52a8\u637f\u4e1c\u897f<span style="opacity:.6;font-size:11px">\uff08\u5468\u56f4\u6ca1\u602a\u65f6\u8d70\u8fc7\u53bb\u637f\uff09</span></span>
  </label>"""
new = """  <label style="display:flex;align-items:center;gap:8px;padding:7px 2px;font-size:13px;cursor:pointer;user-select:none">
    <input type="checkbox" id="setAutoLoot" style="width:17px;height:17px;flex:0 0 auto">
    <span>\u81ea\u52a8\u637f\u4e1c\u897f<span style="opacity:.6;font-size:11px">\uff08\u5468\u56f4\u6ca1\u602a\u65f6\u8d70\u8fc7\u53bb\u637f\uff09</span></span>
  </label>
  <!-- \u2605\u2605 round466\uff08\u7528\u6237\uff1a"\u589e\u52a0\u88c5\u5907\u81ea\u52a8\u51fa\u552e\uff0c\u53ef\u4ee5\u8bbe\u7f6e\u4f4e\u4e8e\u591a\u5c11\u9636\u83b7\u53d6\u540e\u81ea\u52a8\u51fa\u552e"\uff09\u2605\u2605
       \u637f\u8d77\u6765\u90a3\u4e00\u523b\u5c31\u5356\u6210\u91d1\u5e01\uff08\u4e0d\u8fdb\u80cc\u5305\uff09\u2713 \u4ef7\u683c\u548c\u80cc\u5305\u91cc\u5356\u7cfb\u7edf\u4e00\u6837 \u2713 -->
  <label style="display:flex;align-items:center;gap:8px;padding:7px 2px;font-size:13px;user-select:none">
    <span>\u81ea\u52a8\u51fa\u552e\u88c5\u5907</span>
    <select id="setAutoSell" style="flex:1;padding:6px 8px;background:#0e1218;color:#dfe8f2;
            border:2px solid #2a3442;border-radius:0;font-size:13px">
      <option value="0">\u4e0d\u81ea\u52a8\u5356</option>
      <option value="1">\u4f4e\u4e8e 1 \u9636\uff08\u4e0d\u4f1a\u89e6\u53d1\uff09</option>
      <option value="2">\u4f4e\u4e8e 2 \u9636\uff08\u5373 1 \u9636\uff09</option>
      <option value="3">\u4f4e\u4e8e 3 \u9636\uff08\u5373 1~2 \u9636\uff09</option>
      <option value="4">\u4f4e\u4e8e 4 \u9636\uff08\u5373 1~3 \u9636\uff09</option>
      <option value="5">\u4f4e\u4e8e 5 \u9636\uff08\u5373 1~4 \u9636\uff09</option>
      <option value="6">\u4f4e\u4e8e 6 \u9636\uff08\u5373 1~5 \u9636\uff09</option>
      <option value="7">\u4f4e\u4e8e 7 \u9636\uff08\u5373 1~6 \u9636\uff09</option>
      <option value="8">\u4f4e\u4e8e 8 \u9636\uff08\u5373 1~7 \u9636\uff09</option>
      <option value="9">\u4f4e\u4e8e 9 \u9636\uff08\u5373 1~8 \u9636\uff09</option>
      <option value="10">\u4f4e\u4e8e 10 \u9636\uff08\u5373 1~9 \u9636\uff09</option>
      <option value="11">\u4f4e\u4e8e 11 \u9636\uff08\u5373 1~10 \u9636\uff09</option>
      <option value="12">\u4f4e\u4e8e 12 \u9636\uff08\u5373 1~11 \u9636\uff09</option>
    </select>
  </label>
  <div class="bagTip" id="setAutoSellHint" style="margin:2px 0 6px">\u2605 \u53ea\u5bf9\u88c5\u5907\u751f\u6548\uff08\u6750\u6599\u4e0d\u5356\uff09\uff1b\u637f\u8d77\u5c31\u5356\uff0c\u4e0d\u8fdb\u80cc\u5305</div>"""
assert s.count(old) == 1
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('  ok: HTML 下拉')
