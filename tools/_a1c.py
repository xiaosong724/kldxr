# -*- coding: utf-8 -*-
"""A1 第三步：接线（每帧调 limbInstTick + 删怪时清实例 + 受击闪白）"""
import io

p = 'web/core/game.js'
s = io.open(p, encoding='utf-8').read()


def rep(old, new, tag):
    global s
    assert s.count(old) == 1, (tag, s.count(old))
    s = s.replace(old, new, 1)
    print('  ok:', tag)


# ① 删怪时把它的实例槽清零（不然会留"幽灵腿" ✗）
rep("""  var rm = NET.rmobs[mid];
  if (!rm) { return; }
  scene.remove(rm.g);""",
    """  var rm = NET.rmobs[mid];
  if (!rm) { return; }
  /* \u2605 round434\uff1a\u5b9e\u4f8b\u5316\u540e\u5220\u602a\u5fc5\u987b\u628a\u5b83\u90a3 4 \u4e2a\u5b9e\u4f8b\u69fd\u6e05\u96f6 \u2717
     \u4e0d\u7136\u817f\u4f1a\u4e00\u76f4\u505c\u5728\u6b7b\u7684\u5730\u65b9\uff08\u5e7d\u7075\u817f \u2717\uff09*/
  try {
    if (rm.hh && rm.hh.slots) {
      var _dz = {};
      limbZero(rm, _dz);
      for (var _dk in _dz) { _dz[_dk].mesh.instanceMatrix.needsUpdate = true; }
    }
  } catch (e0) { }
  scene.remove(rm.g);""",
    'removeWorldMob')

# ② 受击闪白：给这只怪记一个 flashT
rep("""      if (_rm2 && _rm2.g) { flashCloneMesh(_rm2.g); }""",
    """      if (_rm2 && _rm2.g) {
        flashCloneMesh(_rm2.g);
        _rm2.flashT = 0.16;      /* \u2605 round434\uff1a\u5b9e\u4f8b\u5316\u7684\u56db\u80a2\u4e5f\u8981\u95ea\uff08instanceColor\uff09\u2713 */
      }""",
    'flash')

# ③ 每帧调一次（渲染前，模型矩阵都更新完了 ✓）
rep("""  rd.render(scene, cam);
  /* ---- 面板 ---- */""",
    """  /* \u2605 round434\uff1a\u56db\u80a2\u5b9e\u4f8b\u77e9\u9635\uff08\u6bcf\u5e27\u4e00\u6b21\uff0c\u5728\u6240\u6709\u6a21\u578b\u59ff\u52bf\u7b97\u5b8c\u4e4b\u540e \u2713\uff09*/
  try { limbInstTick(); } catch (e0) { }
  /* flashT \u8870\u51cf\uff08\u548c\u4e00\u6761\u4e00\u8d77\u505a\uff0c\u5c11\u4e00\u6b21\u904d\u5386 \u2713\uff09*/
  for (var _fm in NET.rmobs) {
    var _fr = NET.rmobs[_fm];
    if (_fr && _fr.flashT > 0) { _fr.flashT -= dt; }
  }
  rd.render(scene, cam);
  /* ---- 面板 ---- */""",
    'tick call')

io.open(p, 'w', encoding='utf-8').write(s)
print('part3 改完')
