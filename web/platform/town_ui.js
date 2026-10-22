/* v4 town UI: create/list/permissions/restore/dissolve.
   Loaded after platform/web.js; all server ops go through wsSend. */
(function () {
  var PERMS = [
    [1, '可移动'], [2, '可交互'], [4, '可交易'], [8, '可权限'],
    [16, '可移除'], [32, '可调价格'], [64, '可传送']
  ];
  function el(id) { return document.getElementById(id); }
  function open() { var p = el('townPanel'); if (p) { p.classList.add('on'); } townRefresh(); }
  function close() { var p = el('townPanel'); if (p) { p.classList.remove('on'); } }
  function fmt(n) { return (Math.round(+n || 0)).toLocaleString('zh-CN'); }
  function tierFee(t) {
    return Math.round(5000000 * (t / 30) * (t / 30) / 10000) * 10000;
  }
  function townRefresh() {
    try { if (typeof wsSend === 'function' && (!WSC || WSC.ready)) { wsSend('town_list', {}); } } catch (e) { }
  }
  /* ★ 2026-10-22：小镇面板改成多个导航页 */
  var NAV = 'overview';
  function navBar() {
    var tabs = [['overview', '概览'], ['place', '放置'], ['edit', '编辑'],
                ['perm', '权限'], ['map', '地图']];
    return '<div class="townNav">' + tabs.map(function (t) {
      return '<button class="' + (NAV === t[0] ? 'on' : '') +
        '" onclick="townNav(\'' + t[0] + '\')">' + t[1] + '</button>';
    }).join('') + '</div>';
  }
  function townRender() {
    var body = el('townBody');
    if (!body) { return; }
    var head = navBar();
    var t = (window.MY_TOWNS || [])[0];
    if (NAV === 'place') { body.innerHTML = head + placeHTML(t); return; }
    if (NAV === 'edit') { body.innerHTML = head + editHTML(t); return; }
    if (NAV === 'perm') { body.innerHTML = head + permHTML(t); return; }
    if (NAV === 'map') { body.innerHTML = head + mapHTML(t); return; }
    body.innerHTML = head + overviewHTML(t);
  }
  function overviewHTML(t) {
    if (!t) {
      return '<div class="townHint">你还没有小镇。选尺寸和坐标，支付首日费用后创建；每人只能拥有 1 座。</div>' +
        '<div class="row"><input id="townName" maxlength="12" placeholder="小镇名字（2~12字）" style="flex:1"></div>' +
        '<div class="row"><select id="townTier">' +
        [30, 50, 80, 100].map(function (n) {
          return '<option value="' + n + '">' + n + ' 格 · ' + fmt(tierFee(n)) + ' / 日</option>';
        }).join('') + '</select></div>' +
        '<div class="row"><input id="townX" type="number" step="0.1" value="' + (+P.x).toFixed(1) + '">' +
        '<input id="townZ" type="number" step="0.1" value="' + (+P.z).toFixed(1) + '">' +
        '<button onclick="townUsePos()">用当前位置</button>' +
        '<button onclick="townPick(\'create\')">地图选点</button></div>' +
        '<div class="row"><button onclick="townCreate()">支付首日费用并创建</button></div>' +
        '<div class="townHint">小镇必须建在主城/其它小镇外，边界之间至少空 50 格；创建后成为安全区（边界外扩 2 格）。</div>';
    }
    var frozen = (t.status === 'frozen' || t.status === 'restoring');
    var h = '<div class="row" style="justify-content:space-between"><b>' + (t.name || '') + '</b><span>' +
      (frozen ? '已冻结' : '正常') + '</span></div>' +
      '<div class="townHint">' + t.tier + ' 格 · 中心 (' + (+t.x).toFixed(1) + ', ' + (+t.z).toFixed(1) +
      ') · 每日 ' + fmt(t.fee) + ' · 到期 ' + (t.expires ? new Date(t.expires).toLocaleString() : '-') + '</div>';
    if (frozen) {
      h += '<div class="row"><input id="townRX" type="number" step="0.1" placeholder="新 X（可选）">' +
        '<input id="townRZ" type="number" step="0.1" placeholder="新 Z（可选）">' +
        '<button onclick="townPick(\'restore\')">地图选点</button>' +
        '<button onclick="townRestore()">支付当日费用并恢复</button>' +
        '<button onclick="townDissolve()">彻底解散</button></div>' +
        '<div class="townHint">恢复时优先原坐标；原坐标被占用会使用新坐标；7 天内不恢复永久删除。</div>';
    } else {
      h += '<div class="row"><button onclick="townDissolve()">主动解散（保留 7 天）</button></div>';
    }
    h += '<div class="townHint">放置 / 移动 / 删除：切到「放置」「编辑」页。</div>';
    return h;
  }
  function placeHTML(t) {
    var cats = (window.PlaceMode && PlaceMode.catalog) ? PlaceMode.catalog() : [];
    var cn = { building: '建筑', furniture: '家具', decor: '装饰', function: '功能' };
    var groups = {};
    cats.forEach(function (c) { var k = c.category || 'decor'; (groups[k] = groups[k] || []).push(c); });
    if (!cats.length) {
      return '<div class="townHint">目录还没加载，稍等一下再切回来。</div>';
    }
    var h = '<div class="townHint">选一项 → 点地面放置；R 旋转；Esc 取消。' +
      (t ? '' : '（你还没有镇，会放在系统主城）') + '</div>';
    ['building', 'furniture', 'decor', 'function'].forEach(function (k) {
      var arr = groups[k];
      if (!arr || !arr.length) { return; }
      h += '<div class="townSub">' + (cn[k] || k) + '</div><div class="townGrid">';
      arr.forEach(function (c) {
        h += '<button onclick="townPlace(\'' + c.id + '\')">' + (c.name || c.id) +
          '<s>' + (+c.price || 0).toLocaleString() + '</s></button>';
      });
      h += '</div>';
    });
    return h;
  }
  function editHTML(t) {
    return '<div class="townHint"><b>怎么改已经放好的东西：</b></div>' +
      '<div class="townHint">① 点下面的按钮进入编辑模式；<br>' +
      '② 点场景里的建筑 / 家具 → 会套一个黄框；<br>' +
      '③ 点底部工具条的「移动」→ 再点一下地面，就搬过去了<br>' +
      '　（搬的时候有半透明模型预览；按 Esc 可以取消）</div>' +
      '<div class="row"><button onclick="townEdit()" style="background:#2f5f8a;border-color:#9fe8ff">' +
      '进入编辑模式</button></div>' +
      '<div class="townHint">想换朝向：选中后点「旋转 90°」；不要了：点「删除」' +
      '（连同建筑自带家具一起删，不退款）。</div>';
  }
  function mapHTML(t) {
    var nm = t ? (t.name || '我的小镇') : '系统主城';
    return '<div class="townHint"><b>' + nm + '</b> · 实时地图（玩家位置、放置的建筑/家具都会实时更新）</div>' +
      '<div class="row"><button onclick="townMap()" style="background:#2f5f8a;border-color:#9fe8ff">' +
      '打开地图</button></div>' +
      '<div class="townHint">地图上：<b style="color:#ff8a8a">红色三角</b> = 你（尖头是朝向）；' +
      '深灰块 = 放置的建筑；浅褐块 = 放置的家具。点一下可以看名字和坐标。</div>';
  }
  function permHTML(t) {
    if (!t) {
      return '<div class="townHint">你还没有小镇。系统主城的权限请在 /admin 里设置。</div>';
    }
    var h = '<div class="townHint">权限：主人默认全部；访客默认 可交互+可交易+可传送。给某个玩家单独授权。</div>' +
      '<div class="row"><input id="townTarget" type="number" placeholder="玩家角色 ID（设置-信息里能看到自己的）" style="flex:1"></div>' +
      '<div class="permGrid">' + PERMS.map(function (p) {
        return '<label><input type="checkbox" class="townPerm" value="' + p[0] + '">' + p[1] + '</label>';
      }).join('') + '</div>' +
      '<div class="row"><button onclick="townPermSave()">保存该玩家权限</button>' +
      '<button onclick="townRefreshPerms()">刷新权限</button></div>';
    var perms = window.MY_TOWN_PERMS || [];
    if (perms.length) {
      h += '<div class="townHint">已有授权：' + perms.map(function (p) {
        return '#' + p.player + '=' + p.mask;
      }).join(' · ') + '</div>';
    }
    return h;
  }
  window.townNav = function (n) { NAV = n; townRender(); };
  window.townMap = function () {
    close();
    if (typeof mapOpen === 'function') { mapOpen(); }
  };
  window.townPlace = function (id) {
    close();
    if (window.PlaceMode && PlaceMode.startPlaceById) { PlaceMode.startPlaceById(id); }
  };
  window.townEdit = function () {
    close();
    if (window.PlaceMode && PlaceMode.startEdit) { PlaceMode.startEdit(); }
  };
  function townUsePos() {
    var x = el('townX'), z = el('townZ');
    if (x) { x.value = (+P.x).toFixed(1); }
    if (z) { z.value = (+P.z).toFixed(1); }
  }
  function townCreate() {
    var name = (el('townName') && el('townName').value || '').trim();
    var tier = +(el('townTier') && el('townTier').value || 30);
    var x = +(el('townX') && el('townX').value || P.x);
    var z = +(el('townZ') && el('townZ').value || P.z);
    if (!name) { toast('先填小镇名字'); return; }
    wsSend('town_create', { name: name, tier: tier, x: x, z: z });
  }
  function townRestore() {
    var t = (window.MY_TOWNS || [])[0];
    if (!t) { return; }
    var d = { id: t.id };
    var x = el('townRX'), z = el('townRZ');
    if (x && x.value !== '') { d.x = +x.value; }
    if (z && z.value !== '') { d.z = +z.value; }
    wsSend('town_restore', d);
  }
  function townDissolve() {
    var t = (window.MY_TOWNS || [])[0];
    if (!t) { return; }
    if (confirm('确定解散这个小镇？数据保留 7 天，期间可以恢复。')) {
      wsSend('town_dissolve', { id: t.id });
    }
  }
  function townRefreshPerms() {
    var t = (window.MY_TOWNS || [])[0];
    if (t) { wsSend('town_perm_list', { id: t.id }); }
  }
  function townPermSave() {
    var t = (window.MY_TOWNS || [])[0];
    if (!t) { return; }
    var target = +(el('townTarget') && el('townTarget').value || 0);
    if (!target) { toast('先填玩家角色 ID'); return; }
    var mask = 0;
    document.querySelectorAll('.townPerm:checked').forEach(function (c) { mask |= +c.value; });
    wsSend('town_perm_set', { id: t.id, player: target, mask: mask });
  }
  /* ================= B5：地图选点 + 占地预览 =================
     只做"选中心 + 画一块占地框"，不碰服务端；创建/恢复仍然走原来的协议。
     红色 = 离主城太近（50 格间距不满足），绿色 = 可以放。 */
  var PICK = { on: false, mode: 'create', ghost: null, size: 0,
               downX: 0, downY: 0, valid: false };

  function pickScene() {
    if (typeof scene !== 'undefined' && scene) { return scene; }
    return window.scene || null;
  }
  function pickCamera() {
    if (typeof cam !== 'undefined' && cam) { return cam; }
    return window.cam || null;
  }
  function pickTier() {
    var t = (window.MY_TOWNS || [])[0];
    if (PICK.mode === 'restore' && t) { return +t.tier || 30; }
    var s = el('townTier');
    return s ? (+s.value || 30) : 30;
  }
  function pickSize() { return pickTier() * 0.62; }

  function pickGroundPoint(cx, cy) {
    var c = pickCamera();
    if (!c || typeof THREE === 'undefined') { return null; }
    var rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2((cx / window.innerWidth) * 2 - 1,
                                       -(cy / window.innerHeight) * 2 + 1), c);
    var hit = new THREE.Vector3();
    var plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    return rc.ray.intersectPlane(plane, hit) ? hit : null;
  }

  function pickValid(x, z, size) {
    /* 两镇边界至少空 50 格 = 31m。用服务端下发的 TOWN_ZONES 判，
       这样不只避开主城，也避开别人已经建好的镇（以前只考虑了主城）。 */
    var half = size / 2, gap = 31;
    var zones = window.TOWN_ZONES || [];
    for (var i = 0; i < zones.length; i++) {
      var zn = zones[i], b = (+zn.size || 0) / 2;
      if (b <= 0) { continue; }
      var sepX = (x + half + gap <= (+zn.x) - b) || ((+zn.x) + b + gap <= x - half);
      var sepZ = (z + half + gap <= (+zn.z) - b) || ((+zn.z) + b + gap <= z - half);
      if (!sepX && !sepZ) { return false; }
    }
    if (zones.length) { return true; }
    var pad = 250 + gap;
    if (Math.abs(x) <= pad + half && Math.abs(z) <= pad + half) { return false; }
    return true;
  }

  function pickGhost(x, z) {
    var S = pickScene();
    if (!S) { return; }
    if (!PICK.ghost) {
      var g = new THREE.Group();
      var geo = new THREE.PlaneGeometry(1, 1);
      var face = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0x66d9ff, transparent: true, opacity: 0.18,
        depthWrite: false, side: THREE.DoubleSide }));
      face.rotation.x = -Math.PI / 2;
      face.position.y = 0.06;
      g.add(face);
      var edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.9 }));
      edge.rotation.x = -Math.PI / 2;
      edge.position.y = 0.07;
      g.add(edge);
      g.userData.face = face;
      g.userData.edge = edge;
      S.add(g);
      PICK.ghost = g;
    }
    PICK.ghost.position.set(x, 0, z);
    PICK.ghost.scale.set(PICK.size, 1, PICK.size);
  }

  function pickTint(valid) {
    if (!PICK.ghost) { return; }
    var f = PICK.ghost.userData.face, e = PICK.ghost.userData.edge;
    if (f && f.material) { f.material.color.setHex(valid ? 0x66d9ff : 0xff5a4a); }
    if (e && e.material) { e.material.color.setHex(valid ? 0x9fe8ff : 0xffb0a0); }
  }

  function pickMove(e) {
    if (!PICK.on) { return; }
    var p = pickGroundPoint(e.clientX, e.clientY);
    if (!p) { return; }
    PICK.valid = pickValid(p.x, p.z, PICK.size);
    pickGhost(p.x, p.z);
    pickTint(PICK.valid);
  }

  function pickDown(e) {
    PICK.downX = e.clientX;
    PICK.downY = e.clientY;
  }

  function pickClick(e) {
    if (!PICK.on) { return; }
    var dx = e.clientX - PICK.downX, dy = e.clientY - PICK.downY;
    if (dx * dx + dy * dy > 36) { return; }      /* 拖动视角，不算选点 */
    var p = pickGroundPoint(e.clientX, e.clientY);
    if (!p) { return; }
    if (!pickValid(p.x, p.z, PICK.size)) {
      if (typeof toast === 'function') { toast('离主城/其它小镇太近：边界之间至少空 50 格'); }
      return;
    }
    var ix = p.x.toFixed(1), iz = p.z.toFixed(1);
    if (PICK.mode === 'restore') {
      if (el('townRX')) { el('townRX').value = ix; }
      if (el('townRZ')) { el('townRZ').value = iz; }
    } else {
      if (el('townX')) { el('townX').value = ix; }
      if (el('townZ')) { el('townZ').value = iz; }
    }
    pickEnd();
    var panel = el('townPanel');
    if (panel) { panel.classList.add('on'); }   /* 只显示，不重渲染，保住已填的名字/尺寸 */
  }

  function pickKey(e) {
    if (e.key === 'Escape') {
      pickEnd();
      var panel = el('townPanel');
      if (panel) { panel.classList.add('on'); }
    }
  }

  function pickStart(mode) {
    if (PICK.on) { return; }
    if (!pickScene() || !pickCamera()) {
      if (typeof toast === 'function') { toast('场景还没准备好'); }
      return;
    }
    PICK.on = true;
    PICK.mode = mode === 'restore' ? 'restore' : 'create';
    PICK.size = pickSize();
    PICK.valid = pickValid(+P.x, +P.z, PICK.size);
    pickGhost(+P.x, +P.z);
    pickTint(PICK.valid);
    close();
    var hint = document.getElementById('townPickHint');
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'townPickHint';
      hint.style.cssText = 'position:fixed;left:50%;bottom:64px;transform:translateX(-50%);' +
        'z-index:80;padding:8px 16px;border-radius:10px;background:rgba(10,14,20,.82);' +
        'color:#e8f4ff;font:14px system-ui,"Microsoft YaHei";pointer-events:none';
      document.body.appendChild(hint);
    }
    hint.textContent = '地图选点：左键确认 · Esc 取消 · 红框 = 离主城太近';
    hint.style.display = 'block';
    document.addEventListener('mousemove', pickMove, true);
    document.addEventListener('mousedown', pickDown, true);
    document.addEventListener('click', pickClick, true);
    document.addEventListener('keydown', pickKey, true);
  }

  function pickEnd() {
    PICK.on = false;
    if (PICK.ghost) {
      var S = pickScene();
      if (S) { S.remove(PICK.ghost); }
      PICK.ghost = null;
    }
    var hint = document.getElementById('townPickHint');
    if (hint) { hint.style.display = 'none'; }
    document.removeEventListener('mousemove', pickMove, true);
    document.removeEventListener('mousedown', pickDown, true);
    document.removeEventListener('click', pickClick, true);
    document.removeEventListener('keydown', pickKey, true);
  }

  window.townPick = pickStart;
  window.townPickState = function () {
    return { on: PICK.on, ghost: !!PICK.ghost, size: PICK.size, valid: PICK.valid };
  };

  window.townOpen = open;
  window.townClose = close;
  window.townRefresh = townRefresh;
  window.townRender = townRender;
  window.townCreate = townCreate;
  window.townRestore = townRestore;
  window.townDissolve = townDissolve;
  window.townPermSave = townPermSave;
  window.townRefreshPerms = townRefreshPerms;
  window.townUsePos = townUsePos;
  function boot() {
    var b = el('townBtn');
    if (b) { b.onclick = open; }
    var c = el('townClose');
    if (c) { c.onclick = close; }
    var p = el('townPanel');
    if (p) { p.addEventListener('click', function (e) { if (e.target === p) { close(); } }); }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
