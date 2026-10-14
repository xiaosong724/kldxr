# -*- coding: utf-8 -*-
"""第 56 轮 ⑦ 客户端：倒地姿势 + 无敌护盾环 + 无敌期间穿怪 + 复活告诉服务器"""
import io

# ==================== core ====================
P = 'web/core/game.js'
t = io.open(P, encoding='utf-8').read()


def rep(a, b, name, path=P):
    global t
    c = t.count(a)
    assert c == 1, '%s: %d 次' % (name, c)
    t = t.replace(a, b)
    io.open(path, 'w', encoding='utf-8', newline='\n').write(t)
    print('  OK', name)


# ① 无敌计时变量
rep("var dead = false;                    // ★ 倒下状态（血空 → 必须点复活才起来 ✓）",
"""var dead = false;                    // ★ 倒下状态（血空 → 必须点复活才起来 ✓）
/* ★★ 第 56 轮：复活无敌剩余（秒）★★
   用户要求：复活后 1.5 秒无敌 + 无视体积碰撞，方便逃出怪群 ✓
   ★ 是不是真免伤由【服务器】说了算（它那边也有一个 invulnT ✓）
     这里只管表现和"能不能穿怪" ✓ */
var INVULN_T = 0;""", 'INVULN_T')

# ② 无敌期间穿怪（原来 blocked(..., true) 会让僵尸挡住玩家 ✓）
rep("""    if (!blocked(P.x + mx, P.z, G.BODY_W / 2, G.BODY_D / 2, true, null, P.x, P.z)) { P.x += mx; }
    if (!blocked(P.x, P.z + mz, G.BODY_W / 2, G.BODY_D / 2, true, null, P.x, P.z)) { P.z += mz; }""",
"""    /* ★ 第 56 轮：无敌期间【无视体积碰撞】—— byMob 传 false ✓
       （原来 byMob=true，僵尸会把玩家挡住 ✗ 复活后被围死跑不掉 ✗）
       ★ 只放行"僵尸碰撞"这层 ✓ 建筑/树照旧挡 ✓（不然会穿墙 ✗）*/
    var _byMob = !(INVULN_T > 0);
    if (!blocked(P.x + mx, P.z, G.BODY_W / 2, G.BODY_D / 2, _byMob, null, P.x, P.z)) { P.x += mx; }
    if (!blocked(P.x, P.z + mz, G.BODY_W / 2, G.BODY_D / 2, _byMob, null, P.x, P.z)) { P.z += mz; }""",
'无敌穿怪')

# ③ 倒地姿势 + 护盾环
rep("""  if (atkT < 0) { H.g.position.set(P.x, moving ? Math.abs(Math.sin(walkT)) * 0.05 : 0, P.z); }   // ★ 攻击时坐标由动画控制 ✓""",
"""  if (atkT < 0) { H.g.position.set(P.x, moving ? Math.abs(Math.sin(walkT)) * 0.05 : 0, P.z); }   // ★ 攻击时坐标由动画控制 ✓
  /* ★★ 第 56 轮：死亡 = 【倒地】，不是站着 ✗（用户要求）★★
     ★ 必须放在上面那些姿势代码【之后】—— 不然会被它们覆盖回去 ✗ */
  if (dead) {
    H.g.rotation.x = -1.45;        // 躺平（绕 X 转过去 ✓）
    H.g.rotation.z = 0.12;         // 稍微侧一点，别像块板子
    H.g.rotation.y = P.yaw;        // 朝向保持不变 ✓
    H.g.position.set(P.x, 0.28, P.z);   // 贴地（不然会陷进地面或有半截悬空）
  }
  invRingUpdate();""", '倒地 + 护盾环')

# ④ 护盾环（懒创建 ✓ 不碰 init ✓）
rep("""function blocked(x, z, hw, hd, byMob, skipMob, fromX, fromZ) {""",
"""/* ★ 第 56 轮：复活无敌的显示效果 —— 脚下一圈会呼吸的浅蓝光环 ✓
   ★ 懒创建（第一次用到才建）→ 不用动 init，也不用管加载顺序 ✓
   ★ 核心层不许碰浏览器 API ✗ 所以这里不用 performance.now()，
     用 INVULN_T 自己算脉动（它就是 1.5 → 0 的倒计时 ✓）*/
var _invRing = null;
function invRingUpdate() {
  if (INVULN_T <= 0) {
    if (_invRing) { _invRing.visible = false; }
    return;
  }
  if (!_invRing) {
    _invRing = new THREE.Mesh(
      new THREE.RingGeometry(0.60, 0.88, 28),
      new THREE.MeshBasicMaterial({ color: 0x8ee0ff, transparent: true, opacity: 0.7,
                                    side: THREE.DoubleSide, depthWrite: false }));
    _invRing.rotation.x = -Math.PI / 2;
    scene.add(_invRing);
  }
  _invRing.visible = true;
  _invRing.position.set(P.x, 0.07, P.z);
  var k = Math.max(0, Math.min(1, INVULN_T / 1.5));
  // 越接近结束越淡、越细（快没了 ✓）+ 呼吸脉动
  _invRing.material.opacity = 0.20 + 0.55 * k;
  var pulse = 1 + 0.10 * Math.sin(INVULN_T * 14.0);
  _invRing.scale.set(pulse, pulse, pulse);
}


function blocked(x, z, hw, hd, byMob, skipMob, fromX, fromZ) {""", '护盾环')

# ⑤ 计时递减（挂在帧循环里）
rep("""  if (heroObj.sw) { heroObj.sw.rotation.x = lp(3); }""",
"""  if (heroObj.sw) { heroObj.sw.rotation.x = lp(3); }""", '占位')  # 不动它，只确认锚点
io.open(P, 'w', encoding='utf-8', newline='\n').write(t)
print('core 完成')
