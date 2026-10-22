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
  /* ★ 2026-10-22 修正：**所有建筑**都有抬高的地面
     （通用构建器每栋都画了 foundation 顶面 0.18 / floor 顶面 0.26；
      少数模型另有 interior_floor 顶面 0.28）。 */
  var FLOOR_Y_DEFAULT = 0.26;
  var FLOOR_MODELS = {
    shop_cafe_v1: 0.28, shop_cafe_v2: 0.28, shop_mart_v1: 0.28,
    house_flat_v1: 0.28, house_villa_v1: 0.28
  };
  function floorYOfBuilding(cid) {
    var c = catOf(cid);
    var mid = (c && (c.model_id || c.id)) || cid;
    return FLOOR_MODELS[mid] || FLOOR_Y_DEFAULT;
  }
  function isBuildingWithFloor(cid) { return true; }

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
    /* ★★★ 2026-10-22（用户："放置清单里很多东西没有模型"）★★★
       `prop_*`（树/路灯/长椅/售货机/木桶/摊位…）在 town_props.js 里
       【全都有精细模型】，只是从来没被路由过来 —— 一直被画成方块。
       这里优先走 PROP_SPECS + buildPropModel()。 */
    try {
      if (typeof PROP_SPECS !== 'undefined' && PROP_SPECS[o.catalog] &&
          typeof buildPropModel === 'function') {
        return batchModel(buildPropModel(PROP_SPECS[o.catalog]));
      }
    } catch (eProp) { }
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
        /* 所有建筑都有抬高地面（和服务端 towns.floor_y_of 一致） */
        var _fy = floorYOfBuilding(d.catalog);
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

  /* ★ 2026-10-22：物件增删改后重建店铺飘字（飘字跟着建筑走） */
  function rebuildLabels() {
    try { if (typeof townShopLabelsRebuild === 'function') { townShopLabelsRebuild(); } } catch (e) { }
    /* 店员也要跟着店铺重建（放/挪/删都会走到这里） */
    try { if (typeof townNpcsRebuild === 'function') { townNpcsRebuild(); } } catch (e2) { }
  }

  function placeAt(o) {
    var grp = ensureGroup();
    if (!grp) { return; }
    /* 旧建筑由原有渲染器负责，不在这里重复画 */
    if (isLegacy(o)) { return; }
    var old = P.objs[o.id];
    if (old && old.mesh) {
      try { if (typeof townAnimUnregister === 'function') { townAnimUnregister(old.mesh); } } catch (eAU) { }
      grp.remove(old.mesh);
    }
    var mesh = buildMesh(o);
    /* ★ 2026-10-22：室内家具要抬到建筑地板高度（服务端下发 o.y），
       否则从 y=0 起画的模型（椅子/桌子）会陷进 0.26 高的室内地板。 */
    mesh.position.set(+o.x + _TOFF.x, +o.y || 0, +o.z + _TOFF.z);
    mesh.rotation.y = +o.rot || 0;
    mesh.userData.objId = o.id;          /* 2026-10-22：编辑模式拾取用 */
    /* ★ 2026-10-22：有 userData.animate 的模型（传送阵粒子）登记进每帧 tick */
    try { if (typeof townAnimRegister === 'function') { townAnimRegister(mesh); } } catch (eA) { }
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
    try { if (typeof townAnimClear === 'function') { townAnimClear(); } } catch (eAC) { }
    syncSolids();
    syncFloors();
  }

  /* ---------- ghost preview ---------- */
  function makeGhost(spec) {
    /* ★ 2026-10-22：预览必须和实际放置出来的一致 ——
       prop_* 现在走 buildPropModel（精细模型），预览也要走同一条路，
       否则会出现"预览是方块、放下变成模型"的错位。 */
    var g = null;
    try {
      var _cid = spec && (spec.furnitureId || spec.propId || spec.id || spec.catalog);
      if (_cid && typeof PROP_SPECS !== 'undefined' && PROP_SPECS[_cid] &&
          typeof buildPropModel === 'function') {
        g = buildPropModel(PROP_SPECS[_cid]);
      }
    } catch (eGhostProp) { }
    if (!g) { g = buildTownModel(spec, {}); }
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

  /* ★ 2026-10-22（用户："放置的建筑没有放置的时候也要加取消按钮，手机端没法取消"）：
     放置模式给一条操作栏：确认放置 / 取消。不用再靠点地面或按 Esc。 */
  var PLACEBAR = { el: null };
  function placeBarRender() {
    var need = !!P.placing;
    if (!PLACEBAR.el) {
      PLACEBAR.el = document.createElement('div');
      PLACEBAR.el.id = 'placeBar';
      PLACEBAR.el.style.cssText =
        'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147482000;' +
        'background:#111417ee;border:1px solid #ffffff22;border-radius:12px;padding:8px 12px;' +
        'color:#e9e1cf;font:12px system-ui;display:flex;gap:8px;align-items:center;' +
        'box-shadow:0 12px 40px #000a;max-width:94vw;flex-wrap:wrap';
      PLACEBAR.el.innerHTML =
        '<b style="color:#7ee08a">放置中</b>' +
        '<span style="color:#9aa3a8">方向键移动 · 点地面也行</span>' +
        '<button data-p="ok" style="background:#2f6b3f;border:1px solid #7ee08a;color:#e6ffe9;' +
        'border-radius:8px;padding:7px 14px;font:700 13px system-ui;cursor:pointer">确认放置</button>' +
        '<button data-p="cancel" style="background:#6a2f2f;border:1px solid #ff9a8a;color:#ffd9d2;' +
        'border-radius:8px;padding:7px 14px;font:700 13px system-ui;cursor:pointer">取消</button>';
      document.body.appendChild(PLACEBAR.el);
      PLACEBAR.el.addEventListener('pointerdown', function (e) { e.stopPropagation(); }, { capture: true });
      PLACEBAR.el.addEventListener('click', function (e) {
        e.stopPropagation();
        var b = e.target.closest ? e.target.closest('button[data-p]') : null;
        if (!b) { return; }
        var a = b.getAttribute('data-p');
        if (a === 'cancel') { stopPlace(); return; }
        if (a === 'ok') {
          var g = P.ghost;
          if (!g) { return; }
          var gx = g.position.x, gz = g.position.z;
          if (confirmPlace(gx, gz)) { /* confirmPlace 内部会收掉 */ }
          return;
        }
      });
    }
    PLACEBAR.el.style.display = need ? 'flex' : 'none';
  }

  function startPlace(item) {
    P.sel = item;
    P.placing = true;
    P.rot = 0;
    /* ★ 2026-10-22：操作栏【最先】建出来 —— 后面任何一步出错或提前 return，
       用户也一定看得到「确认放置 / 取消」，不会出现"退不出去"的情况。 */
    try { placeBarRender(); } catch (eBar0) { console.warn('placeBar0', eBar0); }
    var grp = ensureGroup();
    if (!grp) { return; }
    if (P.ghost) { grp.remove(P.ghost); P.ghost = null; }
    /* ★ 2026-10-22（用户："长椅、自行车放置时预览用的不是对应模型"）：
       prop_* 不在 TOWN_MODELS 也不在 TOWN_FURNITURE_SPECS 里，
       以前这里拿不到 spec → 落到"占位建筑"（一座 1×1 的小房子，18 个零件）。
       现在先查 PROP_SPECS。 */
    var spec = null;
    try {
      if (typeof PROP_SPECS !== 'undefined' && PROP_SPECS[item.id]) {
        spec = PROP_SPECS[item.id];
      }
    } catch (eSp) { }
    if (!spec) { spec = TOWN_MODELS[item.model_id || item.id]; }
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
    try { padRender(); } catch (ePad3) { }
    try { placeBarRender(); } catch (eBar) { console.warn('placeBar', eBar); }
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
    try { padRender(); } catch (ePad4) { }
    try { placeBarRender(); } catch (eBar2) { console.warn('placeBar2', eBar2); }
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
    /* ★★★ 2026-10-22（用户："点取消还是会放置" + "把点击放置取消掉，只用确认键"）★★★
       病根：这个监听在【捕获阶段】跑，之前只排除了目录面板和方向键，
       没排除刚加的 #placeBar → 点「取消」时先执行取消，捕获阶段又拿这一下的
       坐标去确认放置了（所以"取消"变成了"放在点击的位置"）。
       现在：① 只认 UI 上的确认按钮；② 点地面只挪预览，不落地。 */
    addEventListener('pointerdown', function (e) {
      if (!P.placing) { return; }
      if (panel && panel.contains(e.target)) { return; }
      if (PAD.el && PAD.el.contains(e.target)) { return; }
      if (PLACEBAR.el && PLACEBAR.el.contains(e.target)) { return; }
      /* 只移动预览，不再"点一下就放" —— 避免任意误触 */
      var p = groundPoint(e.clientX, e.clientY);
      if (p) { updateGhost(p.x, p.z); }
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
    /* ★★★ 2026-10-22（用户："建筑能删，别的都不行"）★★★
       病根：射线第一个命中的总是【建筑的外壳】，里面/旁边的小物件被挡在后面
       → 点家具其实选中了那栋建筑，所以"点删除没反应"（删的是建筑或什么都没删）。
       现在把命中列表全过一遍：优先返回【不是建筑】的物件（最近的优先），
       一个都没有才返回建筑。 */
    var firstBuilding = null;
    var seen = {};
    for (var i = 0; i < hits.length; i++) {
      var o = hits[i].object;
      var hitId = null;
      while (o && o !== grp) {
        if (o.userData && o.userData.objId != null) { hitId = o.userData.objId; break; }
        o = o.parent;
      }
      if (hitId == null || seen[hitId]) { continue; }
      seen[hitId] = 1;
      var ee = P.objs[hitId];
      var isBld = !!(ee && ee.mesh && ee.mesh.userData && ee.mesh.userData.isBuilding);
      if (!isBld) { return hitId; }        /* 小物件优先 */
      if (firstBuilding == null) { firstBuilding = hitId; }
    }
    return firstBuilding;
  }
  function editClear() {
    if (EDIT.box) {
      if (EDIT.box.parent) { EDIT.box.parent.remove(EDIT.box); }
      EDIT.box = null;
    }
  }
  /* ★ 2026-10-22：删除用我们自己的确认框（不用浏览器 confirm） */
  function editConfirmOpen() {
    /* ★★★ 2026-10-22（用户："弹窗关了但没删掉"）★★★
       点「删除」那一刻把目标 id 记下来 —— 之后不管 EDIT.id 因为什么被清空
       （点穿透、取消选中、刷新…），确认删除时都用这个记下的 id。
       之前用的是「当前 EDIT.id」，它一变 null 就静默不发了：
       弹窗照常关闭、什么都不删、也不报错。 */
    EDIT.confirmId = EDIT.id;
    var e = P.objs[EDIT.id], o = e && e.data;
    var nm = (o && o.catalog && typeof townObjName === 'function')
      ? (townObjName(o.catalog) || '这个物件') : '这个物件';
    var box = document.getElementById('editConfirm');
    if (!box) {
      box = document.createElement('div');
      box.id = 'editConfirm';
      document.body.appendChild(box);
    }
    /* ★★★ 2026-10-22（用户："还是不能删除，点取消也关不掉"）★★★
       实测：确认框 z-index=70，但按钮位置上命中的是别的面板
       （elementFromPoint 返回的 isInside=false）→ 点击全被上层拦掉了。
       现在把确认框压到最上层，并强制可点。 */
    box.style.cssText =
      'position:fixed;inset:0;z-index:2147483000;display:flex;' +
      'align-items:center;justify-content:center;pointer-events:auto;' +
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
    /* ★ 2026-10-22：回退到实测可用的版本（c963934）——
       之前我在绑定方式上反复折腾（捕获阶段拦 pointerdown 会掐掉 click），越改越坏。 */
    if (!box._bound) {
      box._bound = true;
      box.addEventListener('click', function (e) {
        e.stopPropagation();
        var b = e.target.closest ? e.target.closest('button[data-e]') : null;
        if (b) { editAct(b.getAttribute('data-e')); return; }
        editConfirmClose();
      });
      box.addEventListener('pointerdown', function (e) {
        e.stopPropagation();
      }, { capture: true });
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
      /* ★ 2026-10-22（用户："出现黄框但点删除对话框不弹"）：
         实测 #annBox（公告遮罩，z-index:120）压在编辑条（55）上面，
         点「删除」其实点到了公告框 → 穿透到场景 → 取消选中。
         编辑条必须压在所有 HUD 之上。 */
      EDIT.bar.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);' +
        'z-index:2147482000;background:#111417ee;border:1px solid #ffffff22;border-radius:12px;' +
        'padding:8px 12px;color:#e9e1cf;font:12px system-ui;display:flex;gap:8px;align-items:center;' +
        'box-shadow:0 12px 40px #000a;max-width:94vw;flex-wrap:wrap';
      document.body.appendChild(EDIT.bar);
      EDIT.bar.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('button[data-e]') : null;
        if (!b) { return; }
        /* ★ 2026-10-22：别让工具条上的点击漏到场景里（会被当成"点空地"→ 取消选中） */
        e.stopPropagation();
        editAct(b.getAttribute('data-e'));
      });
      /* 指针按下阶段也拦住，否则场景的 pointerdown 可能先清掉选中 */
      EDIT.bar.addEventListener('pointerdown', function (e) {
        e.stopPropagation();
      }, { capture: true });
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
      /* ★ 2026-10-22（用户："取消移动旁边再加一个确认键"）：
         用方向键挪到满意位置后，不用再点地面，直接点「确认移动」。 */
      EDIT.bar.innerHTML = '<b style="color:#7ee08a">③ 方向键调整位置</b>' +
        '<span style="color:#9aa3a8">也可以直接点地面 · Esc 取消</span>' +
        '<button data-e="okmove" style="background:#2f6b3f;border-color:#7ee08a">确认移动</button>' +
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
    if (a === 'okmove') {
      /* 用预览模型当前的位置提交移动 */
      var gp = padTargetPos();
      var ed = P.objs[EDIT.id];
      if (gp && ed && ed.data) {
        editMoveGhostStop(false);
        send('move_object', { id: EDIT.id, x: +gp.x.toFixed(2), z: +gp.z.toFixed(2),
                              rot: +ed.data.rot || 0 });
      }
      EDIT.moving = false;
      editBarRender();
      editHintText();
      try { padRender(); } catch (eOk) { }
      return;
    }
    if (a === 'cancelmove') {
      EDIT.moving = false;
      editMoveGhostStop(true);
      editBarRender();
      try { padRender(); } catch (ePad2) { }
      return;
    }
    /* ★★★ 2026-10-22（用户："删了一个，再删一个就不行"）★★★
       `delok` / `delno` 原来排在 `if (EDIT.id == null) return;` 后面 ——
       删除完第一个之后 EDIT.id 已经被 editSelect(null) 清空，
       第二次点「删除」就卡在这个 return，对话框关不掉、也删不掉。
       这两个动作只跟对话框有关，必须在 id 检查之前处理。 */
    if (a === 'delok') {
      var _delId = (EDIT.confirmId != null) ? EDIT.confirmId : EDIT.id;
      EDIT.confirmId = null;
      editConfirmClose();
      if (_delId != null) {
        send('remove_object', { id: _delId });
        editSelect(null);
      } else {
        /* 不再静默失败：让用户知道发生了什么 */
        try { toast('没选中要删除的东西，请重新点一下再删'); } catch (eEmpty) { }
      }
      return;
    }
    if (a === 'delno') { EDIT.confirmId = null; editConfirmClose(); return; }
    if (EDIT.id == null) { return; }
    if (a === 'move') {
      /* ★ 2026-10-22：移动时给一个半透明预览 ✗ 不然看不见会挪到哪 ✓ */
      editMoveGhostStart();
      EDIT.moving = true;
      editBarRender();
      editHintText();
      try { padRender(); } catch (ePad) { }
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

  /* ★★★ 2026-10-22（用户："点击移动时用方向键控制方向，放置也一样，预览跟着动"）★★★
     方向键盘：按住不放就持续朝那个方向挪预览（每秒 2.5 米），松开停。
     和屏幕方向绑定（上=屏幕上方），和摇杆同一套换算。 */
  var PAD = { el: null, timer: 0, dx: 0, dz: 0, spd: 2.5 };
  function padTargetPos() {
    if (P.placing && P.ghost) { return { x: P.ghost.position.x, z: P.ghost.position.z }; }
    if (EDIT.moving && EDIT.ghost) { return { x: EDIT.ghost.position.x, z: EDIT.ghost.position.z }; }
    return null;
  }
  function padStep() {
    var t = padTargetPos();
    if (!t) { return; }
    var cy = (typeof CAM_YAW === 'number') ? CAM_YAW : 0;
    /* 屏幕方向 → 世界方向（和玩家移动同一套） */
    var mcy = Math.cos(cy), msy = Math.sin(cy);
    var wx = PAD.dx * mcy + PAD.dz * msy;
    var wz = -PAD.dx * msy + PAD.dz * mcy;
    var nx = t.x + wx * PAD.spd * 0.05;
    var nz = t.z + wz * PAD.spd * 0.05;
    if (P.placing && P.ghost) { updateGhost(nx, nz); }
    else if (EDIT.moving && EDIT.ghost) { editMoveGhostAt(nx, nz); }
  }
  function padStop() {
    if (PAD.timer) { clearInterval(PAD.timer); PAD.timer = 0; }
    PAD.dx = 0; PAD.dz = 0;
  }
  function padStart(dx, dz) {
    padStop();
    PAD.dx = dx; PAD.dz = dz;
    PAD.timer = setInterval(padStep, 50);
    padStep();
  }
  function padRender() {
    var need = (P.placing && P.ghost) || (EDIT.moving && EDIT.ghost);
    if (!PAD.el) {
      PAD.el = document.createElement('div');
      PAD.el.id = 'movePad';
      PAD.el.style.cssText =
        'position:fixed;right:16px;bottom:150px;z-index:2147482000;display:grid;' +
        'grid-template-columns:repeat(3,52px);grid-template-rows:repeat(3,52px);gap:6px;' +
        'touch-action:none;user-select:none';
      var keys = [
        ['', '', 'up', '↑', '1 / 2'],
        ['', '', 'left', '←', '1 / 1'], ['', '', 'stop', '·', '2 / 2'], ['', '', 'right', '→', '1 / 3'],
        ['', '', 'down', '↓', '2 / 3']
      ];
      var cells = {};
      cells['1/2'] = 'up'; cells['1/1'] = 'left'; cells['2/2'] = 'stop';
      cells['1/3'] = 'right'; cells['2/3'] = 'down';
      for (var r = 1; r <= 3; r++) {
        for (var c = 1; c <= 3; c++) {
          var k = cells[r + '/' + c];
          var cell = document.createElement('div');
          var key = 'g' + r + c;
          cell.style.gridArea = r + ' / ' + c;
          if (!k) { PAD.el.appendChild(cell); continue; }
          cell.setAttribute('data-pad', k);
          cell.textContent = k === 'up' ? '↑' : k === 'down' ? '↓' : k === 'left' ? '←' : k === 'right' ? '→' : '·';
          cell.style.cssText += 'display:flex;align-items:center;justify-content:center;' +
            'border-radius:12px;background:#111417dd;border:1px solid #ffffff2e;color:#e9e1cf;' +
            'font:700 20px system-ui;cursor:pointer';
          PAD.el.appendChild(cell);
        }
      }
      PAD.el.addEventListener('pointerdown', function (e) {
        var t = e.target.closest ? e.target.closest('[data-pad]') : null;
        if (!t) { return; }
        e.preventDefault();
        /* ★ 别让这次按下冒泡到场景（否则会被当成"点地面确认移动"，一按就结束） */
        e.stopPropagation();
        if (e.stopImmediatePropagation) { e.stopImmediatePropagation(); }
        var k = t.getAttribute('data-pad');
        if (k === 'stop') { padStop(); return; }
        var d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[k];
        if (d) { padStart(d[0], d[1]); }
      }, { passive: false, capture: true });
      /* 也要挡住"点空白取消选中"的那条 capture 监听 */
      PAD.el.addEventListener('pointerdown', function (e) {
        e.stopPropagation();
      }, { capture: true });
      var up = function () { padStop(); };
      PAD.el.addEventListener('pointerup', up);
      PAD.el.addEventListener('pointercancel', up);
      PAD.el.addEventListener('pointerleave', up);
      document.body.appendChild(PAD.el);
    }
    PAD.el.style.display = need ? 'grid' : 'none';
    if (!need) { padStop(); }
  }
  window.__padRender = padRender;

  function editEnter() {
    if (P.placing) { stopPlace(); }
    EDIT.on = true;
    closePanel();
    if (!EDIT.hint) {
      EDIT.hint = document.createElement('div');
      EDIT.hint.id = 'editHint';
      EDIT.hint.style.cssText = 'position:fixed;left:50%;top:56px;transform:translateX(-50%);' +
        'z-index:2147482000;background:#111417ee;border:1px solid #ffd83d55;border-radius:10px;' +
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
      /* ★ 2026-10-22：确认框开着时，Esc 先关确认框（不然"关不掉"） */
      var _cb = document.getElementById('editConfirm');
      if (_cb && _cb.style.display !== 'none') { editConfirmClose(); return; }
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
    /* ★ 2026-10-22：方向键盘上的按下不算"点地面" */
    if (PAD.el && PAD.el.contains(e.target)) { return; }
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
        try { padRender(); } catch (ePad5) { }
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
      rebuildLabels();
    },
    stats: function () {
      var n = 0, legacy = 0;
      for (var k in P.objs) { if (P.objs[k].mesh) { n++; } }
      (W().MY_OBJECTS || []).forEach(function (o) { if (isLegacy(o)) { legacy++; } });
      return { rendered: n, legacySkipped: legacy };
    },
    onPlaced: function (o) { if (o) { placeAt(o); rebuildLabels(); } },
    onMoved: function (o) {
      if (!o) { return; }
      placeAt(o);
      rebuildLabels();
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
      /* ★★★ 2026-10-22（用户："弹窗关了但东西没删掉"）★★★
         数据库里确实删掉了，但画面上可能残留 —— 原因可能是：
         ① mesh 被合批/重挂到别处，parent.remove 移不掉；
         ② 有缓存引用没清。
         所以这里做得彻底一点：先按引用移除，再全场景扫一遍兜底。 */
      var e = P.objs[id];
      if (e && e.mesh) {
        try {
          if (e.mesh.parent) { e.mesh.parent.remove(e.mesh); }
          e.mesh.visible = false;
          if (e.mesh.traverse) {
            e.mesh.traverse(function (m) {
              m.visible = false;
              m.userData = m.userData || {};
              m.userData.objId = null;
            });
          }
        } catch (eRm) { }
      }
      delete P.objs[id];
      /* 全场景兜底：凡是 userData.objId 等于它的，一律摘掉 */
      try {
        var S = scene(), kill = [];
        if (S) {
          S.traverse(function (n) {
            if (n.userData && n.userData.objId != null &&
                String(n.userData.objId) === String(id)) { kill.push(n); }
          });
        }
        for (var q = 0; q < kill.length; q++) {
          if (kill[q].parent) { kill[q].parent.remove(kill[q]); }
        }
      } catch (eSweep) { }
      try { if (typeof townAnimUnregister === 'function') {
        var _rm = P.objs[id] && P.objs[id].mesh;
        if (_rm) { townAnimUnregister(_rm); }
      } } catch (eAU2) { }
      try { syncSolids(); } catch (eS1) { }
      try { syncFloors(); } catch (eS2) { }
      rebuildLabels();
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
    isPlacing: function () { return P.placing; },
    startPlace: function (item) { startPlace(item); },
    stopPlace: function () { stopPlace(); },
    debugEdit: function () { return { on: EDIT.on, id: EDIT.id, moving: EDIT.moving }; },
    /* ★ 2026-10-22：自检 —— 在控制台跑 PlaceMode.selfTest() 就能看出卡在哪一环 */
    selfTest: function () {
      var out = { build: '?', canPick: '?', objs: 0, buildings: 0, small: 0 };
      try {
        out.objs = Object.keys(P.objs).length;
        var all = window.MY_OBJECTS || [];
        var sm = [], bd = [];
        for (var i = 0; i < all.length; i++) {
          var e = P.objs[all[i].id];
          if (!e || !e.mesh) { continue; }
          if (e.mesh.userData && e.mesh.userData.isBuilding) { bd.push(all[i]); } else { sm.push(all[i]); }
        }
        out.buildings = bd.length;
        out.small = sm.length;
        /* 取一个小物件，算它屏幕位置，再拾取一次 */
        var t = sm[0];
        if (t) {
          var d = PlaceMode.debugScreen(t.id);
          out.testTarget = { id: t.id, cat: t.catalog };
          out.screen = d;
          out.canPick = (d && String(d.picked) === String(t.id)) ? 'YES' : 'NO(' + (d ? d.picked : 'null') + ')';
        } else {
          out.canPick = 'NO small objects in scene';
        }
        out.build = 'ok';
      } catch (e) { out.build = 'EX:' + e; }
      return out;
    },
    /* 2026-10-22 调试：物件在屏幕上的位置 + 该位置能拾取到什么 */
    debugScreen: function (objId) {
      var e = P.objs[objId]; var c = editCam();
      if (!e || !e.mesh || !c) { return null; }
      var b = new THREE.Box3().setFromObject(e.mesh);
      var tp = new THREE.Vector3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2,
                                 (b.min.z + b.max.z) / 2);
      tp.project(c);
      var cx = (tp.x * 0.5 + 0.5) * innerWidth, cy = (-tp.y * 0.5 + 0.5) * innerHeight;
      return { cx: Math.round(cx), cy: Math.round(cy), nz: +tp.z.toFixed(3),
               picked: editPick(cx, cy) };
    }
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
