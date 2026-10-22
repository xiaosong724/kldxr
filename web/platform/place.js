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

  function catOf(cid) {
    var list = W().MY_TOWN_CATALOG || [];
    for (var i = 0; i < list.length; i++) { if (list[i].id === cid) { return list[i]; } }
    return null;
  }
  /* 哪些零件算"墙体"（进屋时要淡化它们，别的都不动） */
  function objIsWallPart(nm) {
    if (!nm) { return false; }
    /* 只要名字里有 wall 就算墙（各建筑的前/侧/后墙命名不完全统一）；
       但"室内地面"这类不算 */
    if (nm.indexOf('interior') >= 0) { return false; }
    if (nm.indexOf('wall') >= 0) { return true; }
    if (nm.indexOf('parapet') >= 0) { return true; }
    if (nm.indexOf('door_header') >= 0) { return true; }
    if (nm.indexOf('belt_band') >= 0) { return true; }
    return false;
  }

  /* 这些建筑模型内部画了 interior_floor（抬高 0.28），其它室内就是原地形 */
  var FLOOR_MODELS = {
    shop_cafe_v1: 0.28, shop_cafe_v2: 0.28, shop_mart_v1: 0.28,
    house_flat_v1: 0.28, house_villa_v1: 0.28
  };
  function isBuildingWithFloor(cid) {
    var c = catOf(cid);
    var mid = (c && (c.model_id || c.id)) || cid;
    return (FLOOR_MODELS[mid] || 0) > 0;
  }

  function isBuildingCat(cid) {
    var c = catOf(cid);
    return !!(c && c.category === 'building');
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
    /* ★ 2026-10-22：屋顶单独拆出来放一个子组 —— 合批会按材质合并、名字全丢 ✗
       拆出来之后进屋才能"只藏屋顶"。其它部件照旧合批。 */
    /* ★ 2026-10-22：把【墙】和【屋顶】分别拆成独立子组：
       进屋时只淡化墙、藏掉屋顶，屋里的地板/家具/柜台/招牌保持正常显示。
       （以前整栋建筑一起淡化 → 屋里的东西也跟着变透明，看不见了） */
    try {
      var roofParts = [], wallParts = [], upperFloorParts = [];
      g.traverse(function (o) {
        if (!o.isMesh) { return; }
        var nm = String(o.name || '').toLowerCase();
        /* ★ 2026-10-22：只有【二楼地板】进屋时透明；一楼地面永远不透明、不隐藏 */
        if (nm.indexOf('balcony_floor') >= 0) { upperFloorParts.push(o); return; }
        if (nm.indexOf('roof') >= 0 || nm.indexOf('ridge') >= 0) { roofParts.push(o); return; }
        if (objIsWallPart(nm)) { wallParts.push(o); }
      });
      if (roofParts.length) {
        var roof = new THREE.Group();
        roof.name = '__roof';
        roof.userData.noBatch = true;      /* 别被合批吃掉，不然组里就空了 */
        for (var ri = 0; ri < roofParts.length; ri++) {
          var rp = roofParts[ri];
          if (rp.parent) { rp.parent.remove(rp); }
          roof.add(rp);
        }
        g.add(roof);
      }
      if (wallParts.length) {
        var walls = new THREE.Group();
        walls.name = '__walls';
        walls.userData.noBatch = true;
        for (var wi = 0; wi < wallParts.length; wi++) {
          var wp = wallParts[wi];
          if (wp.parent) { wp.parent.remove(wp); }
          walls.add(wp);
        }
        g.add(walls);
      }
      if (upperFloorParts.length) {
        var uf = new THREE.Group();
        uf.name = '__upperFloor';
        uf.userData.noBatch = true;
        for (var ui = 0; ui < upperFloorParts.length; ui++) {
          var up = upperFloorParts[ui];
          if (up.parent) { up.parent.remove(up); }
          uf.add(up);
        }
        g.add(uf);
      }
    } catch (eRoof) { }
    /* ★ 2026-10-22（用户：别人脚下的阴影看不到）：放置的模型原来既不投影也不接影，
       结果站在室内地板上的人，阴影投在楼下的地形上、被地板挡住 → 看着没影子。
       这里让建筑（尤其地板）能接收阴影。 */
    try {
      g.traverse(function (m) { if (m.isMesh) { m.receiveShadow = true; } });
    } catch (eRS) { }
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

  /* ★ 2026-10-22：把放置物件的碰撞（服务端算好的世界 AABB）注册进 core 的 solids，
     这样墙真的挡人、门洞能进（以前放置物件完全没有客户端碰撞） */
  /* ★ 2026-10-22：建筑室内地板（走进屋里不再踩到地形） */
  function syncFloors() {
    try {
      if (typeof townSetObjectFloors !== 'function') { return; }
      var cats = {};
      (W().MY_TOWN_CATALOG || []).forEach(function (c) { cats[c.id] = c; });
      var out = [];
      for (var k in P.objs) {
        var e = P.objs[k];
        if (!e || !e.data) { continue; }
        var d = e.data, c = cats[d.catalog];
        if (!c || c.category !== 'building') { continue; }
        var hw = (+c.size_w || 0) / 2 - 0.2;
        var hd = (+c.size_d || 0) / 2 - 0.2;
        if (hw <= 0 || hd <= 0) { continue; }
        var r = +d.rot || 0;
        var ca = Math.abs(Math.cos(r)), sa = Math.abs(Math.sin(r));
        var ex = hw * ca + hd * sa, ez = hw * sa + hd * ca;
        /* ★ 2026-10-22：只有模型里真有抬高地板的建筑才加（和 towns.FLOOR_Y_BY_MODEL 一致） */
        var _fy = 0.28;
        if (!isBuildingWithFloor(d.catalog)) { continue; }
        out.push({ id: d.id, x0: +d.x - ex, x1: +d.x + ex,
                   z0: +d.z - ez, z1: +d.z + ez, y: _fy });
      }
      townSetObjectFloors(out);
    } catch (e2) { }
  }

  function syncSolids() {
    try {
      if (typeof townSetObjectSolids !== 'function') { return 0; }
      var out = [];
      for (var k in P.objs) {
        var e = P.objs[k];
        if (!e || !e.mesh) { continue; }
        var col = e.data && e.data.col;
        if (col && col.length) { out = out.concat(col); }
      }
      townSetObjectSolids(out);
      return out.length;
    } catch (e2) { return -1; }
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
    if (isBuildingCat(o.catalog)) {
      /* ★ 2026-10-22：进屋要单独淡化这栋建筑 → 材质必须每栋一份，不能共用 */
      mesh.userData.isBuilding = true;
      mesh.traverse(function (m) {
        if (m.isMesh && m.material) {
          m.material = m.material.clone();
          /* 记住原始透明度（玻璃本来就是半透明的，恢复时不能一律设 1） */
          m.material.userData.baseOpacity =
            (typeof m.material.opacity === 'number') ? m.material.opacity : 1;
          m.material.userData.baseTransparent = !!m.material.transparent;
          m.material.userData.baseDepthWrite = !!m.material.depthWrite;
        }
      });
    }
    grp.add(mesh);
    P.objs[o.id] = { mesh: mesh, data: o };
    syncSolids();
    syncFloors();
  }

  /* ★ 2026-10-22：玩家进屋 → 这栋建筑的墙和屋顶变半透明（看清屋内）；
     走出去自动恢复。每 150ms 检查一次，开销很小。 */
  var INTERIOR = { id: null };
  function interiorTick() {
    try {
      var gp = W().P || null;          /* place.js 自己的 P 是同名的私有对象 ✗ 必须走 window.P */
      var px = gp ? +gp.x : 0, pz = gp ? +gp.z : 0;
      var fl = (W().TOWN_FLOORS || []);
      var inside = null;
      for (var i = 0; i < fl.length; i++) {
        var f = fl[i];
        if (px >= f.x0 && px <= f.x1 && pz >= f.z0 && pz <= f.z1) { inside = f.id; break; }
      }
      /* ★ 2026-10-22：不能只靠 id 短路 —— 交互/移动会重建模型，材质被打回不透明，
         而 id 没变就不会重应用 → 屋里突然变回不透明。所以每次都校验一遍材质。 */
      INTERIOR.id = inside;
      for (var k in P.objs) {
        var e = P.objs[k];
        if (!e || !e.mesh || !e.mesh.userData) { continue; }
        /* 目录可能比对象晚到 → 第一次遇到时补上「建筑」标记和独立材质 */
        if (!e.mesh.userData.isBuilding) {
          if (!isBuildingCat(e.data && e.data.catalog)) { continue; }
          e.mesh.userData.isBuilding = true;
          e.mesh.traverse(function (mm) {
            if (mm.isMesh && mm.material) {
              mm.material = mm.material.clone();
              mm.material.userData.baseOpacity =
                (typeof mm.material.opacity === 'number') ? mm.material.opacity : 1;
              mm.material.userData.baseTransparent = !!mm.material.transparent;
              mm.material.userData.baseDepthWrite = !!mm.material.depthWrite;
            }
          });
        }
        var fade = (inside != null && String(e.mesh.userData.objId) === String(inside));
        /* 进屋：屋顶直接藏起来，墙体淡化；屋里的地板/家具保持原样 */
        if (e.mesh.userData.roof == null) {
          var _rg = null;
          e.mesh.traverse(function (mm) { if (mm.name === '__roof') { _rg = mm; } });
          e.mesh.userData.roof = _rg;
        }
        if (e.mesh.userData.roof) { e.mesh.userData.roof.visible = !fade; }
        if (e.mesh.userData.walls == null) {
          var _wg = null;
          e.mesh.traverse(function (mm) { if (mm.name === '__walls') { _wg = mm; } });
          e.mesh.userData.walls = _wg;
        }
        if (e.mesh.userData.upperFloor == null) {
          var _ug = null;
          e.mesh.traverse(function (mm) { if (mm.name === '__upperFloor') { _ug = mm; } });
          e.mesh.userData.upperFloor = _ug;
        }
        var _fadeRoots = [];
        if (e.mesh.userData.walls) { _fadeRoots.push(e.mesh.userData.walls); }
        if (e.mesh.userData.upperFloor) { _fadeRoots.push(e.mesh.userData.upperFloor); }
        var _wallRoot = e.mesh.userData.walls;
        _fadeRoots.forEach(function (root) {
          root.traverse(function (m) {
            if (!m.isMesh || !m.material) { return; }
            var u = m.material.userData || {};
            if (fade) {
              m.material.transparent = true;
              m.material.opacity = Math.min(0.12, (u.baseOpacity == null ? 1 : u.baseOpacity));
              m.material.depthWrite = false;
            } else {
              m.material.transparent = !!u.baseTransparent;
              m.material.opacity = (u.baseOpacity == null) ? 1 : u.baseOpacity;
              m.material.depthWrite = (u.baseDepthWrite == null) ? true : u.baseDepthWrite;
            }
            m.material.needsUpdate = true;
          });
        });
      }
    } catch (e2) { }
  }
  window.__townInteriorTick = interiorTick;

  function clearAll() {
    var grp = ensureGroup();
    if (grp) {
      for (var k in P.objs) {
        if (P.objs[k].mesh) { grp.remove(P.objs[k].mesh); }
      }
    }
    P.objs = {};
    syncSolids();
    syncFloors();
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
    var _pp = W().P || null;
    updateGhost(_pp ? +_pp.x : 0, _pp ? +_pp.z + 2.2 : 0);
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
  /* ★ 2026-10-22：删除用我们自己的确认框（不用浏览器 confirm） */
  function editConfirmOpen() {
    var e = P.objs[EDIT.id], o = e && e.data;
    var nm = (o && o.catalog && typeof townObjName === 'function')
      ? (townObjName(o.catalog) || '这个物件') : '这个物件';
    var box = document.getElementById('editConfirm');
    if (!box) {
      box = document.createElement('div');
      box.id = 'editConfirm';
      document.body.appendChild(box);
    }
    box.style.cssText =
      'position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(4,6,9,.55)';
    box.innerHTML =
      '<div style="width:min(360px,88vw);border-radius:14px;background:#17110bee;' +
      'border:1px solid #b98a42;box-shadow:0 16px 48px #000c;color:#f1e3c6;' +
      'font:14px system-ui,Microsoft YaHei;overflow:hidden">' +
      '<div style="padding:14px 16px 6px;font-weight:800;color:#ffe9b0">删除「' + nm + '」？</div>' +
      '<div style="padding:0 16px 14px;font-size:12.5px;color:#b9ad96;line-height:1.7">' +
      '删除后不能撤销，建筑自带的家具会一起删除，<b style="color:#ffb4a0">不退款</b>。</div>' +
      '<div style="display:flex;gap:8px;padding:0 16px 16px">' +
      '<button data-e="delno" style="flex:1;padding:10px;border-radius:9px;border:1px solid #ffffff2e;' +
      'background:#2a2419;color:#e9e1cf;font:700 14px system-ui;cursor:pointer">取消</button>' +
      '<button data-e="delok" style="flex:1;padding:10px;border-radius:9px;border:1px solid #ff9a8a;' +
      'background:#6a2f2f;color:#ffd9d2;font:700 14px system-ui;cursor:pointer">删除</button>' +
      '</div></div>';
    box.style.display = 'flex';
    if (!box._bound) {
      box._bound = true;
      box.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('button[data-e]') : null;
        if (!b) { return; }
        editAct(b.getAttribute('data-e'));
      });
    }
  }
  function editConfirmClose() {
    var box = document.getElementById('editConfirm');
    if (box) { box.style.display = 'none'; }
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
    var nm = (o && o.catalog && typeof townObjName === 'function')
      ? (townObjName(o.catalog) || ('#' + EDIT.id))
      : ((o && (o.catalog || o.model)) || ('#' + EDIT.id));
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
    if (a === 'del') { editConfirmOpen(); return; }
    if (a === 'delok') { editConfirmClose(); send('remove_object', { id: EDIT.id }); editSelect(null); return; }
    if (a === 'delno') { editConfirmClose(); return; }
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
    /* 目录后到（towns 包）时重算一遍碰撞和地板 */
    refreshAux: function () { syncSolids(); syncFloors(); },
    /* 自测用：某栋建筑当前的透明度 / 是否半透明 */
    debugUserData: function (id) {
      var e = P.objs[id];
      if (!e || !e.mesh) { return null; }
      var ud = e.mesh.userData || {};
      var n = 0;
      e.mesh.traverse(function (m) { if (m.isMesh) { n++; } });
      return { isBuilding: !!ud.isBuilding, hasWalls: !!ud.walls,
               wallsKids: ud.walls ? ud.walls.children.length : -1,
               hasRoof: !!ud.roof, meshes: n,
               childNames: e.mesh.children.map(function (c) { return c.name || '?'; }) };
    },
    roofVisible: function (id) {
      var e = P.objs[id];
      if (!e || !e.mesh) { return null; }
      var r = e.mesh.userData.roof;
      return r ? !!r.visible : null;
    },
    buildingFade: function (id) {
      var e = P.objs[id];
      if (!e || !e.mesh) { return null; }
      var out = null;
      function sample(g) {
        var v = null;
        if (g) {
          g.traverse(function (m) {
            if (v == null && m.isMesh && m.material) {
              v = { opacity: m.material.opacity, transparent: !!m.material.transparent };
            }
          });
        }
        return v;
      }
      out = sample(e.mesh.userData.walls);
      if (!out) { out = sample(e.mesh); }
      return out;
    },
    /* 自测用：墙 / 屋顶 / 其它（家具等）的透明度，验证只淡化墙 */
    interiorParts: function (id) {
      var e = P.objs[id];
      if (!e || !e.mesh) { return null; }
      function sample(g) {
        var v = null;
        if (g) {
          g.traverse(function (m) {
            if (v == null && m.isMesh && m.material) {
              v = { opacity: m.material.opacity, transparent: !!m.material.transparent };
            }
          });
        }
        return v;
      }
      var walls = e.mesh.userData.walls || null;
      var roof = e.mesh.userData.roof || null;
      var others = null;
      e.mesh.traverse(function (m) {
        if (others) { return; }
        var inWall = false, inRoof = false;
        var q = m;
        while (q) {
          if (q === walls) { inWall = true; break; }
          if (q === roof) { inRoof = true; break; }
          q = q.parent;
        }
        if (!inWall && !inRoof && m.isMesh && m.material) {
          others = { opacity: m.material.opacity, transparent: !!m.material.transparent };
        }
      });
      return { walls: sample(walls), roofVisible: roof ? !!roof.visible : null, others: others };
    },
    startEdit: editEnter,
    selectById: function (id) { editSelect(id); return EDIT.id; },
    objPos: function (id) {
      var e = P.objs[id];
      return e && e.mesh ? { x: +e.mesh.position.x.toFixed(2), z: +e.mesh.position.z.toFixed(2),
                             vis: !!e.mesh.visible } : null;
    },
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
      syncSolids();
      syncFloors();
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
      syncSolids();
      syncFloors();
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
    if (typeof setInterval === 'function') { setInterval(interiorTick, 150); }
    /* ★ 2026-10-22：不再单独放一个「放置」按钮 ✓
       放置 / 编辑 / 权限都并进「小镇」面板的导航里了 */
  }
  if (document.readyState === 'loading') {
    addEventListener('DOMContentLoaded', boot);
  } else { boot(); }
})();
