/* 小镇放置模式 v1：目录 → 点地图 → 预览 → 确认
 * 依赖：web.js 的武 WS 发送（window.netSend 或全局 send）
 * 渲染：把已放置物件用 TOWN_MODELS 的模型建出来，加进场景
 */
(function () {
  var P = {
    active: false,
    catalog: [],
    sel: null,          // 选中的目录项
    ghost: null,        // 预览模型
    placing: false,
    rot: 0,
    objs: {},           // id -> {mesh, data}
    group: null
  };

  function W() { return window; }

  /* ★ C3 对照实验：?tox=-130&toz=130 只平移渲染，不改数据 */
  var _TOFF = (function () {
    var q = (W().location && W().location.search) || '';
    var mx = /[?&]tox=(-?[\d.]+)/.exec(q), mz = /[?&]toz=(-?[\d.]+)/.exec(q);
    return { x: mx ? +mx[1] : 0, z: mz ? +mz[1] : 0 };
  })();

  function send(t, d) {
    try {
      if (typeof W().wsSend === 'function') { W().wsSend(t, d || {}); return true; }
    } catch (e) { }
    return false;
  }

  function scene() {
    return typeof W().scene !== 'undefined' ? W().scene : null;
  }

  function catalogItems() {
    var cat = W().MY_TOWN_CATALOG || [];
    return cat.filter(function (c) {
      return c && (c.category === 'building' || c.category === 'furniture' ||
                   c.category === 'decor' || c.category === 'function');
    });
  }

  function ensureGroup() {
    if (P.group && P.group.parent) { return P.group; }
    var S = scene();
    if (!S) { return null; }
    P.group = new THREE.Group();
    P.group.name = 'placedObjects';
    S.add(P.group);
    return P.group;
  }

  /* build one object mesh from the shared model kit */
  function buildMesh(o) {
    var spec = TOWN_MODELS[o.model || o.catalog];
    if (!spec && typeof tmFurnitureModelFor === 'function') {
      spec = tmFurnitureModelFor(o.catalog);
    }
    if (!spec && typeof TOWN_FURNITURE_SPECS !== 'undefined' && TOWN_FURNITURE_SPECS[o.catalog]) {
      spec = tmFurnitureModelFor(o.catalog);
    }
    if (!spec) {
      // fall back to a simple box so the object is still visible
      var g0 = new THREE.Group();
      var m0 = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.62),
        new THREE.MeshLambertMaterial({ color: 0xcc8866 }));
      m0.position.y = 0.31;
      g0.add(m0);
      return g0;
    }
    var g = buildTownModel(spec, {});
    return batchModel(g);
  }

  /* ★ C4：每个放置物建完先合批（同材质类合并成 1~3 个网格）
     否则 309 个物件 = 3000+ 个 mesh / 700+ draw call。
     复用 static 镇那套合批器，但把 TOWN_STATS 原样还回去（它会被合批函数改写）。 */
  function batchModel(g) {
    try {
      if (typeof townBatchStatic !== 'function') { return g; }
      var keep = null;
      if (typeof TOWN_STATS !== 'undefined' && TOWN_STATS) {
        keep = { i: TOWN_STATS.instanced, m: TOWN_STATS.meshes,
                 g: TOWN_STATS.merged, k: TOWN_STATS.kept };
      }
      townBatchStatic(g);
      if (keep) {
        TOWN_STATS.instanced = keep.i; TOWN_STATS.meshes = keep.m;
        TOWN_STATS.merged = keep.g; TOWN_STATS.kept = keep.k;
      }
    } catch (e) { }
    return g;
  }

  function isLegacy(o) {
    if (!o) { return true; }
    if (String(o.catalog || '').indexOf('legacy_') === 0) { return true; }
    if (!o.model && !TOWN_MODELS[o.catalog] &&
        !(typeof tmFurnitureModelFor === 'function' && tmFurnitureModelFor(o.catalog))) {
      return true;
    }
    return false;
  }

  function placeAt(o) {
    var grp = ensureGroup();
    if (!grp) { return; }
    /* 旧建筑由原有渲染器负责，不在这里重复画 */
    if (isLegacy(o)) { return; }
    var old = P.objs[o.id];
    if (old && old.mesh) { grp.remove(old.mesh); }
    var mesh = buildMesh(o);
    mesh.position.set(+o.x + _TOFF.x, 0, +o.z + _TOFF.z);
    mesh.rotation.y = +o.rot || 0;
    mesh.userData.objId = o.id;          /* 2026-10-22：编辑模式拾取用 */
    grp.add(mesh);
    P.objs[o.id] = { mesh: mesh, data: o };
  }

  function clearAll() {
    var grp = ensureGroup();
    if (grp) {
      for (var k in P.objs) {
        if (P.objs[k].mesh) { grp.remove(P.objs[k].mesh); }
      }
    }
    P.objs = {};
  }

  /* ---------- ghost preview ---------- */
  function makeGhost(spec) {
    var g = buildTownModel(spec, {});
    g.traverse(function (o) {
      if (!o.isMesh || !o.material) { return; }
      o.material = o.material.clone();
      o.material.transparent = true;
      o.material.opacity = 0.45;
      o.material.depthWrite = false;
      /* ★ 2026-10-22：半透明在暗色场景里不明显 → 每个零件再加一圈亮边 */
      try {
        var eg = new THREE.EdgesGeometry(o.geometry, 35);
        var line = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({
          color: 0x9fe8ff, transparent: true, opacity: 0.9, depthWrite: false }));
        o.add(line);
      } catch (e) { }
    });
    return g;
  }

  function startPlace(item) {
    P.sel = item;
    P.placing = true;
    P.rot = 0;
    var grp = ensureGroup();
    if (!grp) { return; }
    if (P.ghost) { grp.remove(P.ghost); P.ghost = null; }
    var spec = TOWN_MODELS[item.model_id || item.id];
    if (!spec && typeof tmFurnitureModelFor === 'function') {
      spec = tmFurnitureModelFor(item.id);
    }
    if (!spec) {
      // build a placeholder once so the user sees something
      spec = { name: item.name, type: 'shop', w: 1, d: 1, h: 1, floors: 1,
               roof: 'flat', wall: 0xd9cdb8, trim: 0x6b4a32, roofColor: 0x4a5458,
               door: 'south', doorW: 1, windows: 0 };
    }
    P.ghost = makeGhost(spec);
    grp.add(P.ghost);
    /* ★ 立即放在玩家面前（不用等鼠标动就能看到预览） */
    var gy = 0;
    try { gy = (typeof P !== 'undefined' && P.y) ? 0 : 0; } catch (e) { }
    updateGhost((typeof P.x === 'number' ? P.x : 0),
                (typeof P.z === 'number' ? P.z + 2.2 : 0));
  }

  function stopPlace() {
    P.placing = false;
    P.sel = null;
    if (P.ghost && P.ghost.parent) { P.ghost.parent.remove(P.ghost); }
    P.ghost = null;
  }

  function updateGhost(x, z) {
    if (!P.ghost) { return; }
    P.ghost.position.set(x, 0, z);
    P.ghost.rotation.y = P.rot;
  }

  function confirmPlace(x, z) {
    if (!P.sel) { return; }
    var d = { catalog: P.sel.id, x: x, z: z, rot: P.rot };
    var isBuilding = (P.sel.category === 'building');
    send(isBuilding ? 'place_building' : 'place', d);
    stopPlace();
  }

  /* ---------- pick point from a screen click ---------- */
  function groundPoint(clientX, clientY) {
    var S = scene();
    var cam = typeof W().cam !== 'undefined' ? W().cam : null;
    if (!S || !cam) { return null; }
    var rr = typeof W().rd !== 'undefined' ? W().rd : null;
    var r = (rr && rr.domElement) ? rr.domElement.getBoundingClientRect()
                                 : { left: 0, top: 0, width: innerWidth, height: innerHeight };
    var nx = ((clientX - r.left) / r.width) * 2 - 1;
    var ny = -((clientY - r.top) / r.height) * 2 + 1;
    var ray = new THREE.Raycaster();
    ray.setFromCamera({ x: nx, y: ny }, cam);
    var plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    var hit = new THREE.Vector3();
    if (ray.ray.intersectPlane(plane, hit)) { return { x: hit.x, z: hit.z }; }
    return null;
  }

  /* ---------- panel ---------- */
  var panel = null;
  function panelHTML() {
    var list = catalogItems();
    var cats = { building: '建筑', furniture: '家具', decor: '装饰', function: '功能' };
    var groups = {};
    list.forEach(function (c) {
      var k = c.category || 'decor';
      (groups[k] = groups[k] || []).push(c);
    });
    var html = '<div style="font-weight:700;color:#ffe9b0;margin-bottom:6px">放置目录</div>' +
      '<div style="display:flex;gap:6px;margin-bottom:8px">' +
      '<button id="editTownBtn" style="flex:1;background:#3a2f18;border:1px solid #ffd83d66;' +
      'color:#ffe9b0;border-radius:6px;padding:5px;font-size:12px;cursor:pointer">编辑小镇（移动/删除）</button>' +
      '</div>' +
      '<div style="font-size:11px;color:#9aa3a8;margin-bottom:8px">' +
      '选一项 → 点地面 → 确认；R 旋转；Esc 取消</div>';
    ['building', 'furniture', 'decor', 'function'].forEach(function (k) {
      var arr = groups[k];
      if (!arr || !arr.length) { return; }
      html += '<div style="margin:8px 0 4px;color:#9fe0a8;font-size:12px">' + (cats[k] || k) + '</div>';
      arr.forEach(function (c) {
        var price = (+c.price || 0).toLocaleString();
        html += '<button data-cat="' + c.id + '" style="display:block;width:100%;text-align:left;' +
          'background:#1b2126;border:1px solid #ffffff14;color:#cfd6da;border-radius:5px;' +
          'padding:4px 6px;font-size:11px;margin-bottom:3px;cursor:pointer">' +
          (c.name || c.id) + ' · ' + price + '</button>';
      });
    });
    return html;
  }

  function renderPanel() {
    if (!panel) { return; }
    panel.innerHTML = panelHTML();
    var eb = panel.querySelector('#editTownBtn');
    if (eb) { eb.onclick = function () { editEnter(); }; }
    var btns = panel.querySelectorAll('button[data-cat]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].onclick = function () {
        var id = this.getAttribute('data-cat');
        var item = null;
        catalogItems().forEach(function (c) { if (c.id === id) { item = c; } });
        if (item) { startPlace(item); }
      };
    }
  }

  function openPanel() {
    if (panel) { panel.style.display = 'block'; renderPanel(); return; }
    panel = document.createElement('div');
    panel.id = 'placePanel';
    panel.style.cssText = 'position:fixed;right:14px;top:14px;width:250px;max-height:70vh;overflow:auto;' +
      'background:#111417ee;border:1px solid #ffffff22;border-radius:12px;padding:12px;' +
      'color:#e9e1cf;font:12px system-ui;z-index:50;box-shadow:0 12px 40px #000a';
    document.body.appendChild(panel);
    renderPanel();
    try { send('town_catalog', {}); send('town_objects', {}); } catch (e) { }
  }

  function closePanel() {
    if (panel) { panel.style.display = 'none'; }
    stopPlace();
  }

  /* ---------- input hooks ---------- */
  function bindInput() {
    addEventListener('keydown', function (e) {
      if (!P.placing) { return; }
      if (e.key === 'r' || e.key === 'R') { P.rot += Math.PI / 2; }
      if (e.key === 'Escape') { stopPlace(); }
    });
    addEventListener('pointermove', function (e) {
      if (!P.placing) { return; }
      var p = groundPoint(e.clientX, e.clientY);
      if (p) { updateGhost(p.x, p.z); }
    });
    addEventListener('pointerdown', function (e) {
      if (!P.placing) { return; }
      if (panel && panel.contains(e.target)) { return; }
      var p = groundPoint(e.clientX, e.clientY);
      if (p) {
        updateGhost(p.x, p.z);          /* 先让预览跳到落点，再确认 */
        if (confirmPlace(p.x, p.z)) { e.stopPropagation(); }
      }
    }, true);
  }

  /* ---------- 2026-10-22：编辑模式（选中 → 移动 / 旋转 / 删除） ---------- */
  var EDIT = { on: false, id: null, moving: false, box: null, bar: null, hint: null,
               ghost: null, srcMesh: null };

  function editCam() {
    try { return (typeof W().cam !== 'undefined') ? W().cam : null; } catch (e) { return null; }
  }
  function editPick(cx, cy) {
    var c = editCam(), grp = ensureGroup();
    if (!c || !grp || typeof THREE === 'undefined') { return null; }
    var rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2((cx / innerWidth) * 2 - 1,
                                       -(cy / innerHeight) * 2 + 1), c);
    var hits = rc.intersectObjects(grp.children, true);
    for (var i = 0; i < hits.length; i++) {
      var o = hits[i].object;
      while (o && o !== grp) {
        if (o.userData && o.userData.objId != null) { return o.userData.objId; }
        o = o.parent;
      }
    }
    return null;
  }
  function editClear() {
    if (EDIT.box) {
      if (EDIT.box.parent) { EDIT.box.parent.remove(EDIT.box); }
      EDIT.box = null;
    }
  }
  function editHintText() {
    if (!EDIT.hint) { return; }
    var txt;
    if (EDIT.moving) {
      txt = '第 3 步：点一下地面，物件就搬过去（半透明模型 = 新位置）· Esc 取消';
    } else if (EDIT.id != null) {
      txt = '第 2 步：点底部「移动」，然后点地面 · 也可以直接「旋转 90°」或「删除」';
    } else {
      txt = '第 1 步：点场景里的建筑 / 家具（会变黄框）· Esc 退出编辑';
    }
    EDIT.hint.textContent = txt;
  }

  function editSelect(id) {
    editClear();
    EDIT.id = id;
    EDIT.moving = false;
    if (id == null) { editBarRender(); editHintText(); return; }
    var e = P.objs[id];
    if (!e || !e.mesh) { EDIT.id = null; editBarRender(); editHintText(); return; }
    try {
      EDIT.box = new THREE.BoxHelper(e.mesh, 0xffd83d);
      (sceneOf() || W().scene).add(EDIT.box);
    } catch (e1) { EDIT.box = null; }
    editBarRender();
    editHintText();
  }
  function sceneOf() { return (typeof W().scene !== 'undefined') ? W().scene : null; }
  function editBarRender() {
    if (!EDIT.on) {
      if (EDIT.bar) { EDIT.bar.style.display = 'none'; }
      return;
    }
    if (!EDIT.bar) {
      EDIT.bar = document.createElement('div');
      EDIT.bar.id = 'editBar';
      EDIT.bar.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);' +
        'z-index:55;background:#111417ee;border:1px solid #ffffff22;border-radius:12px;' +
        'padding:8px 12px;color:#e9e1cf;font:12px system-ui;display:flex;gap:8px;align-items:center;' +
        'box-shadow:0 12px 40px #000a;max-width:94vw;flex-wrap:wrap';
      document.body.appendChild(EDIT.bar);
      EDIT.bar.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('button[data-e]') : null;
        if (!b) { return; }
        editAct(b.getAttribute('data-e'));
      });
    }
    EDIT.bar.style.display = 'flex';
    if (EDIT.id == null) {
      EDIT.bar.innerHTML =
        '<b style="color:#ffe9b0">① 点场景里的物件</b>' +
        '<span style="color:#9aa3a8">选中后会变黄框 · Esc 退出</span>' +
        '<button data-e="done" style="background:#2f6b3f;border-color:#7ee08a">完成</button>';
      return;
    }
    var e = P.objs[EDIT.id], o = e && e.data;
    var nm = (o && (o.catalog || o.model)) || ('#' + EDIT.id);
    if (EDIT.moving) {
      EDIT.bar.innerHTML = '<b style="color:#7ee08a">③ 点地面确定新位置</b>' +
        '<span style="color:#9aa3a8">左键/点一下地面 · Esc 取消</span>' +
        '<button data-e="cancelmove" style="background:#6a2f2f;border-color:#ff9a8a">取消移动</button>';
      return;
    }
    EDIT.bar.innerHTML = '<b style="color:#ffe9b0">② 已选：' + nm + '</b>' +
      '<button data-e="move" style="background:#2f5f8a;border-color:#9fe8ff">移动（点这里）</button>' +
      '<button data-e="rot">旋转 90°</button>' +
      '<button data-e="del" style="background:#6a2f2f;border-color:#ff9a8a">删除</button>' +
      '<button data-e="unsel">取消选中</button>' +
      '<button data-e="done" style="background:#2f6b3f;border-color:#7ee08a">完成</button>';
  }
  function editAct(a) {
    if (a === 'done') { editExit(); return; }
    if (a === 'unsel') { editSelect(null); return; }
    if (a === 'cancelmove') {
      EDIT.moving = false;
      editMoveGhostStop(true);
      editBarRender();
      return;
    }
    if (EDIT.id == null) { return; }
    if (a === 'move') {
      /* ★ 2026-10-22：移动时给一个半透明预览 ✗ 不然看不见会挪到哪 ✓ */
      editMoveGhostStart();
      EDIT.moving = true;
      editBarRender();
      editHintText();
      return;
    }
    if (a === 'rot') {
      var e = P.objs[EDIT.id];
      if (!e || !e.data) { return; }
      var nr = (+e.data.rot || 0) + Math.PI / 2;
      send('move_object', { id: EDIT.id, x: +e.data.x, z: +e.data.z, rot: nr });
      return;
    }
    if (a === 'del') {
      if (!confirm('删除这个物件？家具会一起删除，不退款。')) { return; }
      send('remove_object', { id: EDIT.id });
      editSelect(null);
    }
  }
  /* 移动预览：克隆一份半透明模型，原物件先隐藏 */
  function editMoveGhostStart() {
    editMoveGhostStop(true);
    var e = EDIT.id != null ? P.objs[EDIT.id] : null;
    if (!e || !e.mesh) { return; }
    var grp = ensureGroup();
    if (!grp) { return; }
    var g;
    try { g = e.mesh.clone(true); } catch (e1) { g = null; }
    if (!g) { return; }
    g.traverse(function (o) {
      if (!o.isMesh || !o.material) { return; }
      o.material = o.material.clone();
      o.material.transparent = true;
      o.material.opacity = 0.45;
      o.material.depthWrite = false;
    });
    g.position.copy(e.mesh.position);
    g.rotation.copy(e.mesh.rotation);
    g.userData.ghostOf = EDIT.id;
    grp.add(g);
    EDIT.ghost = g;
    EDIT.srcMesh = e.mesh;
    e.mesh.visible = false;
  }
  function editMoveGhostStop(keepOriginal) {
    if (EDIT.ghost) {
      if (EDIT.ghost.parent) { EDIT.ghost.parent.remove(EDIT.ghost); }
      EDIT.ghost = null;
    }
    if (EDIT.srcMesh) { EDIT.srcMesh.visible = true; EDIT.srcMesh = null; }
  }
  function editMoveGhostAt(x, z) {
    if (!EDIT.ghost) { return; }
    EDIT.ghost.position.set(x, 0, z);
  }

  function editEnter() {
    if (P.placing) { stopPlace(); }
    EDIT.on = true;
    closePanel();
    if (!EDIT.hint) {
      EDIT.hint = document.createElement('div');
      EDIT.hint.id = 'editHint';
      EDIT.hint.style.cssText = 'position:fixed;left:50%;top:56px;transform:translateX(-50%);' +
        'z-index:55;background:#111417ee;border:1px solid #ffd83d55;border-radius:10px;' +
        'padding:6px 14px;color:#ffe9b0;font:12px system-ui';
      document.body.appendChild(EDIT.hint);
    }
    EDIT.hint.style.display = 'block';
    editHintText();
    editSelect(null);
  }
  function editExit() {
    EDIT.on = false; EDIT.moving = false; EDIT.id = null;
    editMoveGhostStop(true);
    editClear();
    if (EDIT.bar) { EDIT.bar.style.display = 'none'; }
    if (EDIT.hint) { EDIT.hint.style.display = 'none'; }
  }
  addEventListener('keydown', function (e) {
    if (!EDIT.on) { return; }
    if (e.key === 'Escape') {
      if (EDIT.moving) { EDIT.moving = false; editMoveGhostStop(true); editBarRender(); }
      else { editExit(); }
    }
  });
  addEventListener('pointermove', function (e) {
    if (!EDIT.on || !EDIT.moving) { return; }
    var p = groundPoint(e.clientX, e.clientY);
    if (p) { editMoveGhostAt(p.x, p.z); }
  });
  addEventListener('pointerdown', function (e) {
    if (!EDIT.on) { return; }
    if (EDIT.bar && EDIT.bar.contains(e.target)) { return; }
    if (EDIT.moving && EDIT.id != null) {
      var p = groundPoint(e.clientX, e.clientY);
      var ed = P.objs[EDIT.id];
      if (p && ed && ed.data) {
        editMoveGhostAt(p.x, p.z);
        editMoveGhostStop(false);            /* 先恢复原物件，等 moved 回来再刷新位置 */
        send('move_object', { id: EDIT.id, x: +p.x.toFixed(2), z: +p.z.toFixed(2),
                              rot: +ed.data.rot || 0 });
        EDIT.moving = false;
        editBarRender();
      }
      e.stopPropagation();
      return;
    }
    var id = editPick(e.clientX, e.clientY);
    if (id != null) {
      editSelect(id);
      try { e.stopPropagation(); } catch (e2) { }
      return;
    }
    /* 点空地：如果选着东西，就当作「取消选中」（避免误触移动） */
    if (EDIT.id != null && !EDIT.moving) {
      editSelect(null);
    }
  }, true);

  /* ---------- public ---------- */
  window.PlaceMode = {
    open: openPanel,
    close: closePanel,
    toggle: function () {
      if (panel && panel.style.display !== 'none') { closePanel(); }
      else { openPanel(); }
    },
    onObjects: function (list) {
      clearAll();
      (list || []).forEach(placeAt);
    },
    stats: function () {
      var n = 0, legacy = 0;
      for (var k in P.objs) { if (P.objs[k].mesh) { n++; } }
      (W().MY_OBJECTS || []).forEach(function (o) { if (isLegacy(o)) { legacy++; } });
      return { rendered: n, legacySkipped: legacy };
    },
    onPlaced: function (o) { if (o) { placeAt(o); } },
    onMoved: function (o) {
      if (!o) { return; }
      placeAt(o);
      if (EDIT.on && EDIT.id != null && String(EDIT.id) === String(o.id)) { editSelect(EDIT.id); }
    },
    startEdit: editEnter,
    selectById: function (id) { editSelect(id); return EDIT.id; },
    objVisible: function (id) {
      var e = P.objs[id];
      return e && e.mesh ? !!e.mesh.visible : null;
    },
    stopEdit: editExit,
    /* 小镇面板里用：给它目录 id，直接开始放置 */
    /* 2026-10-22：给自测看预览状态（放置 ghost / 移动 ghost） */
    previewState: function () {
      function op(g) {
        var v = null;
        if (g) { g.traverse(function (o) { if (v == null && o.isMesh && o.material) { v = o.material.opacity; } }); }
        return v;
      }
      var src = EDIT.srcMesh ? EDIT.srcMesh.visible : null;
      return { placing: !!P.placing, ghost: !!P.ghost, ghostOpacity: op(P.ghost),
               moving: !!EDIT.moving, moveGhost: !!EDIT.ghost,
               moveGhostOpacity: op(EDIT.ghost), srcVisible: src };
    },
    startPlaceById: function (id) {
      var item = null;
      catalogItems().forEach(function (c) { if (String(c.id) === String(id)) { item = c; } });
      if (item) { startPlace(item); return true; }
      /* 目录还没到（没打开过面板）→ 请求一次，调用方稍后重试 */
      try { send('town_catalog', {}); } catch (e) { }
      return false;
    },
    catalog: function () { return catalogItems(); },
    editState: function () { return { on: EDIT.on, id: EDIT.id, moving: EDIT.moving }; },
    onRemoved: function (id) {
      var e = P.objs[id];
      if (e && e.mesh && e.mesh.parent) { e.mesh.parent.remove(e.mesh); }
      delete P.objs[id];
      if (EDIT.on && String(EDIT.id) === String(id)) { editSelect(null); }
    },
    /* 小镇被冻结/解散：把这块区域里的物件全部撤掉（服务端 towncleared） */
    clearArea: function (x, z, r) {
      var r2 = (r || 60) * (r || 60);
      for (var k in P.objs) {
        var e = P.objs[k], d = e && e.data;
        if (!d) { continue; }
        var dx = (+d.x) - x, dz = (+d.z) - z;
        if (dx * dx + dz * dz > r2) { continue; }
        if (e.mesh && e.mesh.parent) { e.mesh.parent.remove(e.mesh); }
        delete P.objs[k];
      }
    },
    isPlacing: function () { return P.placing; }
  };

  /* web.js 收到消息后回调这些 */
  window.onObjects = function (list, town) { window.PlaceMode.onObjects(list); };
  window.onPlaced = function (o, n, list) {
    window.PlaceMode.onPlaced(o);
    (list || []).forEach(function (f) { window.PlaceMode.onPlaced(f); });
  };
  window.onMoved = function (o) { window.PlaceMode.onMoved(o); };
  window.onRemoved = function (id) { window.PlaceMode.onRemoved(id); };

  function boot() {
    bindInput();
    /* ★ 2026-10-22：不再单独放一个「放置」按钮 ✓
       放置 / 编辑 / 权限都并进「小镇」面板的导航里了 */
  }
  if (document.readyState === 'loading') {
    addEventListener('DOMContentLoaded', boot);
  } else { boot(); }
})();
