/* 大厅与传送阵专用模型：大厅门廊/山花/塔楼、20 把座椅；圆形传送阵 */
function makeAdd(g) {
  return function (m, name) {
    if (!m) { return m; }
    tmTag(m, name);
    g.userData.parts.push({ id: name, cn: townPartCn(name) });
    return m;
  };
}

function buildHallModel(spec, opts) {
  var W = 20.0, D = 14.0, H = 4.8, BY = 0.18;
  var wall = opts.wall || 0xd8cdb8;
  var trim = opts.trim || 0x3d4549;
  var roof = opts.roof || 0x4a5458;
  var g = new THREE.Group(); g.userData.parts = [];
  var add = makeAdd(g);
  function box(w, h, d, c, x, y, z, name, ry) { return add(tmBox(g, w, h, d, c, x, y, z, ry), name); }
  function glass(w, h, d, x, y, z, name) { return add(tmGlassBox(g, w, h, d, x, y, z, name), name); }

  /* base + broad front steps */
  box(W + 2.4, 0.20, D + 2.4, 0xcfc7b6, 0, 0.10, 0, 'hall_base');
  for (var s = 0; s < 3; s++) {
    box(10.8 - s * 1.4, 0.16, 0.55, 0xd8d0bf, 0, 0.10 + s * 0.16, D / 2 + 1.6 - s * 0.55, 'hall_step_' + (s + 1));
  }

  /* main hall shell */
  box(W, H, 0.22, wall, 0, BY + H / 2, -D / 2, 'hall_back_wall');
  box(0.22, H, D, wall, -W / 2, BY + H / 2, 0, 'hall_side_wall_left');
  box(0.22, H, D, wall, W / 2, BY + H / 2, 0, 'hall_side_wall_right');
  var dW = 2.8, sgw = (W - dW) / 2 - 0.5;
  glass(sgw, H - 0.9, 0.05, -(dW / 2 + sgw / 2 + 0.2), BY + H / 2, D / 2, 'hall_front_glass_left');
  glass(sgw, H - 0.9, 0.05, (dW / 2 + sgw / 2 + 0.2), BY + H / 2, D / 2, 'hall_front_glass_right');
  box(0.18, H - 0.8, 0.18, trim, -dW / 2 - 0.12, BY + H / 2, D / 2 + 0.05, 'hall_entry_frame_left');
  box(0.18, H - 0.8, 0.18, trim, dW / 2 + 0.12, BY + H / 2, D / 2 + 0.05, 'hall_entry_frame_right');
  box(dW + 0.45, 0.22, 0.26, trim, 0, BY + H - 0.38, D / 2 + 0.05, 'hall_entry_frame_top');
  box(dW, 0.06, 0.9, 0x9a968a, 0, BY + 0.03, D / 2 + 0.35, 'hall_entry_threshold');
  for (var m = 0; m < 5; m++) {
    var mx = -W / 2 + 0.8 + m * (W - 1.6) / 4;
    if (Math.abs(mx) < dW / 2 + 0.3) { continue; }
    box(0.12, H, 0.12, trim, mx, BY + H / 2, D / 2 + 0.03, 'hall_front_mullion_' + (m + 1));
  }
  box(W + 1.0, 0.24, 0.45, trim, 0, BY + H + 0.12, D / 2 + 0.1, 'hall_front_fascia');
  box(W + 1.2, 0.35, D + 1.2, roof, 0, BY + H + 0.32, 0, 'hall_roof');
  box(W + 1.0, 0.50, 0.18, trim, 0, BY + H + 0.60, D / 2 + 0.60, 'hall_parapet_front');
  box(W + 1.0, 0.50, 0.18, trim, 0, BY + H + 0.60, -D / 2 - 0.60, 'hall_parapet_back');

  /* grand portico: six columns, entablature and pediment */
  var pz = D / 2 + 1.55, cw = 11.4;
  box(cw, 0.30, 1.9, 0xcfc7b6, 0, BY + 0.15, pz, 'hall_portico_floor');
  for (var c = 0; c < 6; c++) {
    var cx = -cw / 2 + 0.7 + c * (cw - 1.4) / 5;
    box(0.55, 3.65, 0.55, 0xe6ddca, cx, BY + 1.98, pz, 'hall_portico_column_' + (c + 1));
    box(0.72, 0.18, 0.72, trim, cx, BY + 0.30, pz, 'hall_portico_base_' + (c + 1));
    box(0.70, 0.16, 0.70, trim, cx, BY + 3.68, pz, 'hall_portico_cap_' + (c + 1));
  }
  box(cw + 0.5, 0.50, 1.5, 0xe6ddca, 0, BY + 3.98, pz, 'hall_portico_entablature');
  box(cw + 0.9, 0.22, 1.8, trim, 0, BY + 4.25, pz, 'hall_portico_cornice');
  /* triangular pediment */
  var ped = new THREE.BufferGeometry();
  var pw = cw / 2 + 0.25, ph = 1.35, py = BY + 4.35;
  ped.setAttribute('position', new THREE.Float32BufferAttribute([
    -pw, py, pz + 0.70, pw, py, pz + 0.70, 0, py + ph, pz + 0.70,
    -pw, py, pz - 0.70, 0, py + ph, pz - 0.70, pw, py, pz - 0.70
  ], 3));
  ped.setIndex([0, 1, 2, 3, 4, 5, 0, 3, 5, 0, 5, 1, 1, 5, 4, 1, 4, 2, 0, 2, 4, 0, 4, 3]);
  ped.computeVertexNormals();
  var pm = new THREE.Mesh(ped, new THREE.MeshLambertMaterial({ color: 0xe6ddca, side: THREE.DoubleSide }));
  g.add(pm); add(pm, 'hall_pediment');
  box(cw + 0.4, 0.18, 0.20, trim, 0, py + 0.05, pz + 0.72, 'hall_pediment_beam');

  /* side wings */
  for (var sd = -1; sd <= 1; sd += 2) {
    var wx = sd * (W / 2 + 1.5);
    box(3.6, 3.7, 6.0, wall, wx, BY + 1.85, 0, sd < 0 ? 'hall_wing_left' : 'hall_wing_right');
    box(3.8, 0.20, 6.2, roof, wx, BY + 3.80, 0, sd < 0 ? 'hall_wing_left_roof' : 'hall_wing_right_roof');
    glass(0.05, 2.1, 3.4, wx + sd * 1.82, BY + 2.0, 0, sd < 0 ? 'hall_wing_left_glass' : 'hall_wing_right_glass');
  }

  /* roof lantern / clock tower */
  box(4.2, 2.2, 4.2, wall, 0, BY + H + 1.4, 0, 'hall_tower');
  glass(3.0, 1.2, 0.05, 0, BY + H + 1.5, 2.13, 'hall_tower_glass');
  /* square tower roof: stacked square slabs instead of a round cone */
  box(4.4, 0.18, 4.4, trim, 0, BY + H + 2.82, 0, 'hall_tower_roof_1');
  box(3.9, 0.18, 3.9, 0x4a5458, 0, BY + H + 3.02, 0, 'hall_tower_roof_2');
  box(3.2, 0.18, 3.2, trim, 0, BY + H + 3.22, 0, 'hall_tower_roof_3');
  box(2.3, 0.18, 2.3, 0x4a5458, 0, BY + H + 3.42, 0, 'hall_tower_roof_4');
  box(1.2, 0.30, 1.2, trim, 0, BY + H + 3.62, 0, 'hall_tower_finial');
  box(0.16, 0.55, 0.16, 0x9a968a, 0, BY + H + 3.98, 0, 'hall_tower_spire');

  /* interior: marble floor, stage and rows of player chairs */
  box(W - 0.8, 0.04, D - 0.8, 0xc9cbcc, 0, BY + 0.02, 0, 'hall_floor');
  var Pst = tmPiece(g, 'shop_counter', '舞台');
  Pst.add(box(7.0, 0.28, 2.4, 0x8a6a48, 0, BY + 0.14, -D / 2 + 1.6, 'hall_stage'));
  tmPieceEnd(g, Pst);
  var Prug = tmPiece(g, 'rug_rect', '舞台地毯');
  Prug.add(box(6.0, 0.06, 1.8, 0x8a5a4a, 0, BY + 0.32, -D / 2 + 1.6, 'hall_stage_rug'));
  tmPieceEnd(g, Prug);
  var Psp = tmPiece(g, 'dining_table', '演讲台');
  Psp.add(box(1.5, 0.10, 0.6, 0x6b4a32, 0, BY + 0.40, -D / 2 + 1.5, 'hall_speaker_desk'));
  tmPieceEnd(g, Psp);
  var Plect = tmPiece(g, 'shop_counter', '讲台');
  Plect.add(add(tmCyl(g, 0.8, 0.0, 0.45, 0x6b4a32, 2.8, BY + 0.55, -D / 2 + 1.5, 'hall_lectern'), 'hall_lectern'));
  tmPieceEnd(g, Plect);
  var chairNo = 1;
  for (var r = 0; r < 4; r++) {
    for (var q = 0; q < 5; q++) {
      var chx = -4.4 + q * 2.2, chz = -1.6 + r * 2.0;
      buildChairAt(g, add, chx, chz, Math.PI, 'hall_chair_' + chairNo, 0x6b4a32, BY);
      chairNo++;
    }
  }
  var Prec = tmPiece(g, 'shop_counter', '接待台');
  Prec.add(box(5.0, 0.95, 0.8, 0x6b4a32, -W / 2 + 3.0, BY + 0.50, D / 2 - 2.0, 'hall_reception'));
  Prec.add(box(5.2, 0.10, 0.9, 0xd8cbb0, -W / 2 + 3.0, BY + 1.02, D / 2 - 2.0, 'hall_reception_top'));
  tmPieceEnd(g, Prec);
  var Pif = tmPiece(g, 'dining_table', '咨询桌');
  Pif.add(box(2.4, 0.85, 0.8, 0x6b4a32, W / 2 - 3.0, BY + 0.45, D / 2 - 2.0, 'hall_info_table'));
  tmPieceEnd(g, Pif);
  var Ppl = tmPiece(g, 'plant_pot', '盆栽');
  Ppl.add(add(tmCyl(g, 0.18, 0.23, 0.35, 0x9a5f42, W / 2 - 3.0, BY + 1.10, D / 2 - 2.0, 'plant_1'), 'plant_1'));
  Ppl.add(add(tmSphere(g, 0.28, 0x5c8a52, W / 2 - 3.0, BY + 1.48, D / 2 - 2.0, 'plant_1_leaf'), 'plant_1_leaf'));
  tmPieceEnd(g, Ppl);
  var Pnt = tmPiece(g, 'promo_board', '公告栏');
  Pnt.add(box(2.2, 1.0, 0.10, 0x2f3438, -W / 2 + 0.40, BY + 2.1, 0, 'hall_notice'));
  tmPieceEnd(g, Pnt);
  var Pch = tmPiece(g, 'ceiling_lamp', '吊灯');
  Pch.add(box(0.7, 0.30, 0.7, 0xffd9a0, 0, BY + 3.8, 0, 'hall_chandelier'));
  tmPieceEnd(g, Pch);
  tmCollectFurniture(g);
  return g;
}

/* ★★★ 2026-10-25（用户："帮我把传送阵也加一下着色器"）★★★
   ★ 原来的传送阵：能量盘/光柱/粒子全是【纯色 + 透明度】✗ 像一块青色塑料 ✓
   ★ 现在给三样东西加着色器：
     ① 能量盘（地面那个圆）：同心环 + 旋转符文 + 脉动 ✗ 有"阵法"感 ✓
     ② 光柱：向上流动的能量丝 + 底部亮顶部淡 ✓
     ③ 粒子：改成着色器驱动的【上升光点】，CPU 不再每帧算 ✓
   ★ 成本：几何体一个都没多 ✗ 粒子甚至更省（CPU 不再逐帧改 220 个点）✓
   ★ 时钟：统一用 performance.now() 换算 ✗ 不依赖外部模块 ✓
     （这个文件被 buildTeleportModel 调用时不一定能拿到 VFX ✓ 自己算最稳 ✓）*/
function _tpTime() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000; }
var _TP_NOISE = [
  'float th21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }',
  'float tvn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);',
  '  return mix(mix(th21(i), th21(i + vec2(1,0)), f.x), mix(th21(i + vec2(0,1)), th21(i + vec2(1,1)), f.x), f.y); }'
].join('\n');

function _tpDiscMat(colorHex) {
  var uT = { value: 0 };
  var m = new THREE.ShaderMaterial({
    uniforms: { uTime: uT, uColor: { value: new THREE.Color(colorHex) }, uOpacity: { value: 1 } },
    vertexShader: [
      'varying vec2 vTp;',
      'void main(){ vTp = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
    ].join('\n'),
    fragmentShader: [
      'precision mediump float;',
      'varying vec2 vTp;',
      'uniform float uTime, uOpacity;',
      'uniform vec3 uColor;',
      _TP_NOISE,
      'void main(){',
      '  float r = length(vTp) / 1.22;',           /* 0=中心 1=边缘 */
      '  if (r > 1.0) discard;',
      '  float ang = atan(vTp.y, vTp.x);',
      /* ① 同心环：三圈慢慢向外扩 ✗ 阵法感 ✓ */
      '  float rings = 0.0;',
      '  for (int i = 0; i < 3; i++) {',
      '    float ph = fract(uTime * 0.45 + float(i) * 0.333);',
      '    float rr = ph;',
      '    rings += smoothstep(0.045, 0.0, abs(r - rr)) * (1.0 - ph);',
      '  }',
      /* ② 旋转符文：8 个角向的亮块，整体缓慢转 */
      '  float sector = fract((ang / 6.2831853 + uTime * 0.05) * 8.0);',
      '  float rune = smoothstep(0.42, 0.5, sector) * smoothstep(0.58, 0.5, sector);',
      '  rune *= smoothstep(0.72, 0.95, r) * smoothstep(1.0, 0.95, r);',
      /* ③ 中心能量核：脉动 */
      '  float core = smoothstep(0.34, 0.0, r) * (0.55 + 0.45 * sin(uTime * 3.4));',
      /* ④ 细密纹理 ✗ 填充空隙，不至于一片空白 ✓ */
      '  float grain = tvn(vTp * 14.0 + vec2(uTime * 0.3, -uTime * 0.22)) * 0.5',
      '              + tvn(vTp * 30.0) * 0.5;',
      '  float base = smoothstep(1.0, 0.72, r) * (0.10 + grain * 0.22);',
      /* 边缘辉光 */
      '  float rim = smoothstep(0.86, 1.0, r) * smoothstep(1.0, 0.94, r);',
      '  float a = (rings * 0.55 + rune * 0.85 + core * 0.9 + base + rim * 0.7) * uOpacity;',
      '  vec3 col = mix(uColor, vec3(0.85, 0.98, 1.0), core * 0.7 + rune * 0.5);',
      '  gl_FragColor = vec4(col * (1.0 + core * 1.2 + rune * 0.6), clamp(a, 0.0, 1.0));',
      '}'
    ].join('\n'),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  });
  m.userData.tpTime = uT;
  return m;
}

function _tpBeamMat(colorHex) {
  var uT = { value: 0 };
  var m = new THREE.ShaderMaterial({
    uniforms: { uTime: uT, uColor: { value: new THREE.Color(colorHex) }, uOpacity: { value: 1 } },
    vertexShader: [
      'varying vec2 vTpUv;',
      'varying vec3 vTpP;',
      'void main(){ vTpUv = uv; vTpP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
    ].join('\n'),
    fragmentShader: [
      'precision mediump float;',
      'varying vec2 vTpUv;',
      'varying vec3 vTpP;',
      'uniform float uTime, uOpacity;',
      'uniform vec3 uColor;',
      _TP_NOISE,
      'void main(){',
      /* CylinderGeometry：y 从 -0.45 到 +0.45（高 0.9）→ 归一化 0~1 */
      '  float y = clamp(vTpP.y / 0.9 + 0.5, 0.0, 1.0);',
      '  float ang = atan(vTpP.z, vTpP.x);',
      /* 向上流动的能量丝 */
      '  float strand = tvn(vec2(ang * 9.0, y * 5.0 - uTime * 2.2)) * 0.6',
      '               + tvn(vec2(ang * 23.0, y * 11.0 - uTime * 3.6)) * 0.4;',
      '  float flow = smoothstep(0.35, 0.72, strand + y * 0.28);',
      /* 底部亮、顶部淡 ✗ 像从阵里升起来 ✓ */
      '  float vfade = (1.0 - pow(y, 0.75)) * smoothstep(1.0, 0.86, y);',
      '  float a = (flow * 0.85 + 0.12) * vfade * uOpacity;',
      '  vec3 col = mix(uColor, vec3(0.90, 0.99, 1.0), flow * 0.65);',
      '  gl_FragColor = vec4(col * (1.0 + flow * 0.9), clamp(a, 0.0, 1.0));',
      '}'
    ].join('\n'),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  });
  m.userData.tpTime = uT;
  return m;
}

function _tpParticleMat(colorHex) {
  var uT = { value: 0 };
  var m = new THREE.ShaderMaterial({
    uniforms: { uTime: uT, uColor: { value: new THREE.Color(colorHex) }, uOpacity: { value: 1 } },
    vertexShader: [
      'attribute float aSeed;',      /* 每个粒子的相位 ✗ 让它们不同步 ✓ */
      'attribute float aSpeed;',
      'varying float vAlpha;',
      'varying float vSeed;',
      'uniform float uTime;',
      'void main(){',
      '  vec3 p = position;',
      /* ★ 粒子上升完全在 GPU 里算 ✗ CPU 一个点都不用碰 ✓
         fract() 让它循环：升到顶就回到原点 ✓ 无缝衔接 ✓ */
      '  float span = 2.9;',
      '  float t = fract(aSeed + uTime * aSpeed * 0.22);',
      '  p.y = 0.40 + t * span;',
      /* 上升时略微向内收（被吸进光柱）*/
      '  p.xz *= 1.0 - t * 0.35;',
      '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
      '  gl_Position = projectionMatrix * mv;',
      /* 越靠上越亮、到顶前淡出 ✗ 不会突然消失 ✓ */
      '  vAlpha = smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.75, 1.0, t));',
      '  gl_PointSize = (2.4 + (1.0 - t) * 2.2) * 300.0 / max(-mv.z, 0.1);',
      '  vSeed = aSeed;',
      '}'
    ].join('\n'),
    fragmentShader: [
      'precision mediump float;',
      'varying float vAlpha;',
      'varying float vSeed;',
      'uniform float uOpacity;',
      'uniform vec3 uColor;',
      'void main(){',
      '  vec2 q = gl_PointCoord - 0.5;',
      '  float d = length(q) * 2.0;',
      '  if (d > 1.0) discard;',
      '  float a = pow(1.0 - d, 1.8) * vAlpha * uOpacity;',
      '  vec3 col = mix(uColor, vec3(1.0, 1.0, 1.0), (1.0 - d) * 0.65);',
      '  gl_FragColor = vec4(col, a);',
      '}'
    ].join('\n'),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  m.userData.tpTime = uT;
  return m;
}

function buildTeleportModel(spec, opts) {
  var g = new THREE.Group(); g.userData.parts = [];
  var add = makeAdd(g);
  var cyan = 0x8fe6ff, blue = 0x3f9fbe;
  function box(w, h, d, c, x, y, z, name) { return add(tmBox(g, w, h, d, c, x, y, z), name); }
  function cyl(rt, rb, h, c, x, y, z, name, seg) {
    var m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 32),
      new THREE.MeshLambertMaterial({ color: c }));
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    g.add(m); add(m, name); return m;
  }
  cyl(1.75, 1.85, 0.14, 0x726b5e, 0, 0.07, 0, 'tp_base_lower', 36);
  cyl(1.55, 1.68, 0.12, 0x8a8272, 0, 0.18, 0, 'tp_base_mid', 36);
  cyl(1.35, 1.48, 0.12, 0xa39a87, 0, 0.29, 0, 'tp_base_upper', 36);
  /* ★ 2026-10-25：能量盘换成着色器（同心环 + 旋转符文 + 中心脉动）*/
  var discMat = _tpDiscMat(cyan);
  var discMesh = new THREE.Mesh(new THREE.CircleGeometry(1.22, 40), discMat);
  discMesh.rotation.x = -Math.PI / 2; discMesh.position.y = 0.375;
  g.add(discMesh); add(discMesh, 'tp_energy_disc');
  var ring = new THREE.Mesh(new THREE.TorusGeometry(1.30, 0.075, 10, 48),
    new THREE.MeshLambertMaterial({ color: cyan, emissive: 0x2a6b80 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.40; g.add(ring); add(ring, 'tp_ring_outer');
  var ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.055, 10, 40),
    new THREE.MeshLambertMaterial({ color: blue, emissive: 0x1f4f60 }));
  ring2.rotation.x = Math.PI / 2; ring2.position.y = 0.42; g.add(ring2); add(ring2, 'tp_ring_inner');
  for (var rn = 0; rn < 8; rn++) {
    var a = rn / 8 * Math.PI * 2;
    box(0.16, 0.05, 0.34, cyan, Math.cos(a) * 1.08, 0.40, Math.sin(a) * 1.08, 'tp_rune_' + (rn + 1));
  }
  for (var c = 0; c < 4; c++) {
    var ca = c / 4 * Math.PI * 2 + Math.PI / 4;
    var cm = new THREE.Mesh(new THREE.OctahedronGeometry(0.20),
      new THREE.MeshLambertMaterial({ color: cyan, emissive: 0x2a6b80 }));
    cm.position.set(Math.cos(ca) * 1.55, 0.75, Math.sin(ca) * 1.55);
    g.add(cm); add(cm, 'tp_crystal_' + (c + 1));
  }
  /* rising teleport particles instead of a solid beam */
  var COUNT = 220;
  var pos = new Float32Array(COUNT * 3);
  var seed = new Float32Array(COUNT * 3);
  for (var pi = 0; pi < COUNT; pi++) {
    var ang = Math.random() * Math.PI * 2;
    var rad = Math.sqrt(Math.random()) * 1.18;
    seed[pi * 3] = Math.cos(ang) * rad;
    seed[pi * 3 + 1] = Math.random();
    seed[pi * 3 + 2] = Math.sin(ang) * rad;
    pos[pi * 3] = seed[pi * 3];
    pos[pi * 3 + 1] = 0.4 + seed[pi * 3 + 1] * 2.8;
    pos[pi * 3 + 2] = seed[pi * 3 + 2];
  }
  /* ★ 2026-10-25：粒子改成 GPU 驱动 ✗ CPU 不再逐帧算位置 ✓
     （原来每帧要循环 220 次 + 上传位置 ✗ 现在着色器自己算 ✓）
     aSeed：每个粒子的相位（错开上升）
     aSpeed：上升速度 */
  var pgeo = new THREE.BufferGeometry();
  pgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  var pSeed = new Float32Array(COUNT);
  var pSpeed = new Float32Array(COUNT);
  for (var psi = 0; psi < COUNT; psi++) {
    pSeed[psi] = Math.random();
    pSpeed[psi] = 0.35 + Math.random() * 0.75;
  }
  pgeo.setAttribute('aSeed', new THREE.BufferAttribute(pSeed, 1));
  pgeo.setAttribute('aSpeed', new THREE.BufferAttribute(pSpeed, 1));
  var pmat = _tpParticleMat(cyan);
  var particles = new THREE.Points(pgeo, pmat);
  g.add(particles);
  add(particles, 'tp_particles');
  /* ★ 2026-10-25：光柱换成着色器（向上流动的能量丝）*/
  var beamMat = _tpBeamMat(cyan);
  var core = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.42, 0.9, 24, 1, true), beamMat);
  core.position.y = 0.90; g.add(core); add(core, 'tp_core_glow');
  /* animated particles: rise, fade by re-seeding at the base */
  /* ★★★ 2026-10-25 升级：动画只更新时钟 ✗ CPU 不再逐帧算粒子 ✓★★★
     ★ 原来：每帧循环 220 个粒子改 y 坐标 + needsUpdate 上传 ✓
       每个传送阵 220 次运算 ✗ 镇上好几座就是上千次 ✓
     ★ 现在：着色器里用 fract(seed + time*speed) 自己算位置 ✓
       CPU 只写 3 个 uniform（而且是同一个时间值）✗ 开销几乎为 0 ✓✓
     ★ 视觉还更好了：
       · 粒子是【圆形柔边光点】✗ 不是方块 ✓
       · 越往上越亮、到顶前淡出 ✗ 不会突然消失 ✓
       · 上升时向内收 ✗ 像被光柱吸上去 ✓ */
  g.userData.animate = function (t) {
    var now = _tpTime();
    discMat.userData.tpTime.value = now;
    beamMat.userData.tpTime.value = now;
    pmat.userData.tpTime.value = now;
    /* 整体明暗脉动 ✓ 保留原来的呼吸感 */
    var pulse = 0.82 + Math.sin(now * 2.2) * 0.18;
    pmat.uniforms.uOpacity.value = pulse;
    beamMat.uniforms.uOpacity.value = 0.85 + Math.sin(now * 1.7) * 0.15;
    discMat.uniforms.uOpacity.value = 0.90 + Math.sin(now * 2.6) * 0.10;
  };
  return g;
}
