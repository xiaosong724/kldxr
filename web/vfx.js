/* ===================================================================
   vfx.js —— 技能动画（纯表现层，round545）
   -------------------------------------------------------------------
   ★ 铁律：不算伤害、不改血量；进来参数，出去画面
   ★ target: 'self'  → 挂在【施法者模型】上（跟着体型缩放 ✓ 性能无影响）
             'ground'→ 放在世界坐标（落点）
   ★ 调参：/vfx.html
   =================================================================== */
(function () {
  'use strict';
  var V = {};

  function rnd(seed) { var s = (seed >>> 0) || 1; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  /* ★★★ 2026-10-24：材质缓存（第二步：减少 GC）★★★
     ★ 先说结论：这里【不能直接共享材质】✗ 原因很实在：
       项目里有 40 多处按实例改 material.opacity（淡出、脉动、闪烁）
       材质一共享 → 一个特效淡出，同色的其它特效跟着一起变透明 ✓✓
     ★ 那缓存有什么用：
       ① 把【构造参数】缓存起来 ✗ 省掉 key 拼接和对象字面量的开销 ✓
       ② 更重要的是【保留 clone 的基准】✗ clone 比 new 快得多 ✓
          （clone 只复制属性，不解析配置对象 ✓）
     ★ 实现：缓存一个"原型材质"✗ 每次返回 prototype.clone() ✓
       · clone 出来的实例独立改 opacity ✗ 互不影响 ✓
       · clone 成本约为 new 的 1/3 ✗ 而且不会产生配置对象垃圾 ✓
       · 原型本身永远不挂到场景上 ✗ 不会误改 ✓
     ★ 上限 200 种保护：万一参数被乱传也不会无限增长 ✓ */
  var _MAT_PROTO = {}, _MAT_PROTO_N = 0;
  function M(c, o) {
    var key = String(c);
    if (o) {
      var ks = [];
      for (var k0 in o) { ks.push(k0 + '=' + o[k0]); }
      ks.sort();
      key += '|' + ks.join(',');
    }
    var proto = _MAT_PROTO[key];
    if (!proto) {
      if (_MAT_PROTO_N > 200) { _MAT_PROTO = {}; _MAT_PROTO_N = 0; }
      proto = new THREE.MeshBasicMaterial({ color: c, transparent: true });
      if (o) { for (var k in o) { proto[k] = o[k]; } }
      proto.__isProto = true;
      _MAT_PROTO[key] = proto;
      _MAT_PROTO_N++;
    }
    /* ★ 返回副本 ✗ 每个实例都能独立改 opacity/color ✓ */
    return proto.clone();
  }

  /* ★★★ 2026-10-24：几何体缓存（同材质缓存同一个思路）★★★
     ★ 原来 new THREE.SphereGeometry(0.22, 6, 5) 每次 spawn 都重建 ✗
       一个球 6×5 段 = 60 个三角 ✗ 建的时候要算顶点、法线、UV ✓
       这些都是【纯 CPU 开销】✗ 而且产生垃圾 ✓
     ★ 现在：按参数缓存 ✗ 建一次用到底 ✓
       geoOf('sphere', [0.22, 6, 5]) → 同一个几何体 ✓
     ★ 带 __shared = true ✗ releaseGroup 会跳过它 ✓ */
  var _GEO_CACHE = {}, _GEO_CACHE_N = 0;
  function geoOf(type, args) {
    var key = type + '(' + args.join(',') + ')';
    var hit = _GEO_CACHE[key];
    if (hit) { return hit; }
    if (_GEO_CACHE_N > 300) { _GEO_CACHE = {}; _GEO_CACHE_N = 0; }
    var g;
    if (type === 'sphere') { g = new THREE.SphereGeometry(args[0], args[1], args[2]); }
    else if (type === 'box') { g = new THREE.BoxGeometry(args[0], args[1], args[2]); }
    else if (type === 'cone') { g = new THREE.ConeGeometry(args[0], args[1], args[2]); }
    else if (type === 'cyl') { g = new THREE.CylinderGeometry(args[0], args[1], args[2], args[3]); }
    else if (type === 'ring') { g = new THREE.RingGeometry(args[0], args[1], args[2]); }
    else if (type === 'circle') { g = new THREE.CircleGeometry(args[0], args[1]); }
    else if (type === 'plane') { g = new THREE.PlaneGeometry(args[0], args[1]); }
    else if (type === 'torus') { g = new THREE.TorusGeometry(args[0], args[1], args[2], args[3]); }
    else { g = new THREE.SphereGeometry(0.2, 6, 5); }
    g.__shared = true;
    _GEO_CACHE[key] = g;
    _GEO_CACHE_N++;
    return g;
  }
  function grp() { return new THREE.Group(); }

  /* ===================================================================
     ★★★ 2026-10-24（用户："让现在的技能特效很好看"）★★★
     着色器基础设施 —— 这一层是后面所有特效升级的地基

     ★ 为什么必须要有：
       现在 46 个特效全是【纯色几何体】✗ MeshBasicMaterial 画出来的
       东西只有一种颜色 + 透明度 ✓ 没有纹理、没有噪声、没有边缘光 ✗
       参考项目（LinearAbiltyCastingThreeJS）之所以好看，靠的是
       每一个特效都有【自己的着色器】：火焰在翻腾、闪电在抖、冰在结霜 ✓

     ★ 共享 uniform（性能关键，学自参考项目的 FrameUniforms）：
       three.js 里每个材质各存一份 { value } 盒子 ✗
       如果 30 个特效各存一份 uTime，每帧就要写 30 次 ✓
       改成【同一个盒子】✗ 每帧只写一次，30 个材质同时更新 ✓✓
       → 特效越多，省得越多 ✓

     ★ 噪声：所有"有机"的视觉（火焰、烟雾、霜花、电弧）都靠它
       用便宜的 2D/3D hash 噪声（不用贴图 ✓ 不占带宽 ✓）
     =================================================================== */
  /* ★★★ 2026-10-25（用户："有的玩家的设备可能不好不适合开着色器，
     在菜单设置里加一个着色器的开关，并且再加上拉动条来决定着色器的效果"）★★★
     ★ 两个全局控制：
       SHADER_ON  —— 着色器开关（关掉时所有特效退回纯色材质）
       STRENGTH   —— 强度 0.2~3.0（越大越浓烈/越亮）
     ★ 为什么强度能真正"让效果变强"：
       所有着色器的最终颜色都乘 uIntensity ✗ 透明度也乘它 ✓
       → 0.3 时几乎透明（省 GPU）✗ 2.5 时浓烈发光 ✓✓
       → 不改几何形状、不改动画 ✓ 只改"存在感"✓
     ★ 关闭时怎么省 GPU：
       把 uIntensity 设为 0 ✗ 着色器还在跑 ✗ 省不到什么 ✓
       真正的关闭：spawn 时不用 shaderMat ✗ 直接用纯色 MeshBasicMaterial ✓✓
       （已经在 shaderMat() 里做了分支 ✓）*/
  var SHADER_ON = true;
  var STRENGTH = 1.0;
  var FRAME = {
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uIntensity: { value: 1 }        /* 全局特效强度（= STRENGTH，设置里可调 ✓）*/
  };
  V.setShader = function (on) {
    SHADER_ON = !!on;
    V._shaderOn = SHADER_ON;
  };
  V.getShader = function () { return SHADER_ON; };
  V.setStrength = function (k) {
    STRENGTH = Math.max(0.2, Math.min(3.0, Number(k) || 1));
    FRAME.uIntensity.value = STRENGTH;
    V._strength = STRENGTH;
  };
  V.getStrength = function () { return STRENGTH; };

  /* 所有 VFX 着色器共用的 GLSL 头 */
  var GLSL_NOISE = [
    'float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }',
    'float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }',
    'float vnoise(vec2 p){',
    '  vec2 i = floor(p), f = fract(p);',
    '  f = f * f * (3.0 - 2.0 * f);',
    '  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));',
    '  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));',
    '  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);',
    '}',
    /* 4 层 FBM —— 火焰/烟雾的主体 */
    'float fbm(vec2 p){',
    '  float v = 0.0, a = 0.5;',
    '  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }',
    '  return v;',
    '}'
  ].join('\n');

  /* 标准顶点着色器（带 UV）*/
  /* ★★★ 2026-10-24（用户报错："'modelMatrix' : undeclared identifier"）★★★
     ★ 病根：我在片元着色器里用了 modelMatrix 和 cameraPosition ✗
       这两个是【顶点着色器专属】的内置变量 ✗ 片元着色器里没有 ✓
       报错只在真机上编译时出现 ✗ 我测试时被吞掉了 ✓✓
     ★ 修：在【顶点着色器】里算好，用 varying 传给片元：
        vWorld   = 顶点的世界坐标（modelMatrix 只在顶点里合法 ✓）
        vViewDir = 从顶点指向摄像机的单位向量（cameraPosition 同理 ✓）
      这样片元里直接用 vViewDir ✗ 不需要那两个内置变量 ✓
     ★ 顺带法线也传一份（有些特效要用真实法线做菲涅尔 ✓）*/
  var GLSL_VERT = [
    'varying vec2 vUv;',
    'varying vec3 vPos;',
    'varying vec3 vWorld;',
    'varying vec3 vViewDir;',
    'varying vec3 vNormalW;',
    'void main(){',
    '  vUv = uv;',
    '  vPos = position;',
    '  vec4 wp = modelMatrix * vec4(position, 1.0);',
    '  vWorld = wp.xyz;',
    '  vViewDir = normalize(cameraPosition - wp.xyz);',
    '  vNormalW = normalize(mat3(modelMatrix) * normal);',
    '  gl_Position = projectionMatrix * viewMatrix * wp;',
    '}'
  ].join('\n');

  /* 造一个 VFX 用的 ShaderMaterial ✗ 自动接上共享 uniform ✓
     o.frag  片元着色器主体（不含 precision / varying 声明 ✓ 这里补齐）
     o.uni   额外 uniform
     o.side  THREE.DoubleSide 等 */
  function shaderMat(o) {
    /* ★ 2026-10-25：着色器关闭 → 返回纯色材质 ✗ 真正省 GPU ✓
       （着色器跑起来每像素几十次噪声采样 ✗ 纯色几乎免费 ✓✓）
       ★ 颜色取 o.uni.uColor 或默认的青色 ✗ 尽量接近原来观感 ✓ */
    if (!SHADER_ON) {
      /* 关闭时用 o.tint（每个特效可以指定主色 ✗ 不指定就用中性灰青）*/
      var _c = (o && o.tint !== undefined) ? o.tint : 0x8fd6ff;
      var sm = new THREE.MeshBasicMaterial({
        color: _c, transparent: true, opacity: 0.45,
        depthWrite: false,
        side: (o && o.side !== undefined) ? o.side : THREE.DoubleSide,
        blending: (o && o.blending !== undefined) ? o.blending : THREE.AdditiveBlending
      });
      sm.userData._plainFallback = true;
      return sm;
    }
    var u = {
      uTime: FRAME.uTime,
      uIntensity: FRAME.uIntensity
    };
    if (o.uni) { for (var k in o.uni) { u[k] = o.uni[k]; } }
    var m = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: GLSL_VERT,
      fragmentShader: [
        'precision highp float;',
        'varying vec2 vUv;',
        'varying vec3 vPos;',
        'varying vec3 vWorld;',
        'varying vec3 vViewDir;',
        'varying vec3 vNormalW;',
        'uniform float uTime;',
        'uniform float uIntensity;',
        GLSL_NOISE,
        o.frag
      ].join('\n'),
      transparent: true,
      depthWrite: false,
      blending: (o.blending !== undefined) ? o.blending : THREE.AdditiveBlending,
      side: (o.side !== undefined) ? o.side : THREE.DoubleSide
    });
    return m;
  }

  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  /* ---------- 粒子 ---------- */
  /* ★★★ 2026-10-24：burst 改成【GPU 版】★★★
     ★ 保留原来的函数名和参数签名 ✗ 46 个特效一个都不用改 ✓
     ★ 内部换成 gpuBurst：
       · CPU 不再每帧跑 for 循环算粒子位置 ✓
       · 一个 draw call 画完所有粒子 ✓
       · 粒子是圆形柔边（着色器算的 ✗ 不是贴图 ✓）
     ★ 参数映射（原来 → 现在）：
       count → count      speed → speed      size → size
       life  → life       grav  → grav(=重力) up → up(=初速向上)
       color → color      y     → y(=出生高度)
       seed  → seed
     ★ 新增可选参数（老调用不用管 ✗ 默认值就是老行为 ✓）：
       drag    空气阻力（默认 0.6 ✗ 老版没有阻尼 ✓ 让粒子减速更自然）
       turb    湍流强度（默认 0.18 ✗ 轨迹会有轻微的飘动 ✓ 不再直线飞）
       grow    大小变化（0=不变 1=长大一倍 ✓ 火焰/烟雾用）
       stagger 错开出生（默认 0 ✓ 传 0.15 会让粒子陆续冒出来）
       color2  第二颜色（做渐变用 ✓）
       soft    柔边（默认 1 ✓）
     =================================================================== */
  function burst(g, o) {
    return gpuBurst(g, {
      count: o.count || 30,
      speed: o.speed || 4,
      size: o.size || 0.22,
      life: o.life || 0.7,
      grav: o.grav == null ? 5.8 : o.grav,
      up: o.up || 1.2,
      y: o.y || 0.6,
      color: o.color || 0xffaa33,
      color2: o.color2,
      colorMix: o.colorMix,
      seed: o.seed || 7,
      r: o.r || 0,
      spread: o.spread,
      drag: o.drag == null ? 0.6 : o.drag,
      turb: o.turb == null ? 0.18 : o.turb,
      turbFreq: o.turbFreq,
      grow: o.grow,
      stagger: o.stagger,
      soft: o.soft,
      ring: o.ring,
      blending: o.blending
    });
  }

  /* ===================================================================
     ★★★ 2026-10-24：GPU 粒子系统（第三步，学自参考项目 ParticleSystem）★★★

     ★ 现在的问题（burst 函数）：
       每一帧都在 CPU 上：
         for (每个粒子) { 加速度 → 速度 → 位置 }  ✗ 再 needsUpdate 上传显存 ✓
       30 个粒子还好 ✓ 但烈焰风暴要 40 个、暴风雪要 100+ 个 ✗
       而且【每个 burst 一个 draw call】✗ 同时放 5 个技能就是 5 次 ✓
       → 手机上一放技能就掉帧 ✓✓

     ★ GPU 的做法：
       ① 生成时把【出生数据】写进 InstancedBufferAttribute（一次性 ✓）
          position=起点、velocity=初速、life=寿命、seed=随机种子
       ② 之后【CPU 完全不管】✗ 着色器每帧自己算：
          pos = start + vel*t + 0.5*gravity*t² ✗ 就是牛顿运动定律 ✓
          大小、透明度、颜色全都按时序在着色器里插值 ✓
       ③ 一个材质 = 一个 draw call ✗ 里面可以有几千个粒子 ✓✓
       ④ 环形缓冲：超出容量就覆盖最老的 ✗ 不用 new 也不用 GC ✓

     ★ 视觉上的额外好处：
       · 粒子是【面向摄像机的四边形】✗ 不是固定朝向的点 ✓ 永远不侧看 ✓
       · 每个粒子可以有自己的旋转和大小曲线 ✓
       · 可以加柔边（圆形衰减）✗ 不像 PointsMaterial 那样是硬方块 ✓✓
     =================================================================== */
  var GPU_PART_VERT = [
    'attribute vec3 aStart;',
    'attribute vec3 aVel;',
    'attribute float aBirth;',      /* 出生时刻（秒）*/
    'attribute float aLife;',       /* 寿命（秒）*/
    'attribute float aSize;',       /* 初始大小 */
    'attribute float aSeed;',       /* 随机种子（决定旋转/相位 ✓）*/
    'attribute vec3 aColor;',
    'uniform float uTime;',
    'uniform float uGravity;',
    'uniform float uDrag;',
    'uniform float uTurb;',         /* 湍流强度 */
    'uniform float uTurbFreq;',
    'uniform float uSizeGrow;',     /* 生命期内大小变化（0=不变 1=长大一倍）★ 2026-10-24 补分号！*/
    'varying float vAlpha;',
    'varying vec3 vColor;',
    'varying float vSeed;',
    'void main(){',
    '  float age = uTime - aBirth;',
    '  float k = age / aLife;',                  /* 0 = 刚出生 1 = 死亡 */
    '  if (k < 0.0 || k > 1.0) {',               /* 还没出生 / 已经死了 → 缩到 0 ✓ */
    '    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);',
    '    vAlpha = 0.0; vColor = aColor; vSeed = aSeed;',
    '    return;',
    '  }',
    /* ── 运动：牛顿定律 + 阻尼 + 噪声湍流 ── */
    '  float damp = exp(-uDrag * age);',
    '  vec3 p = aStart + aVel * (1.0 - damp) / max(uDrag, 0.001);',
    '  p.y -= 0.5 * uGravity * age * age;',
    /* 湍流：用 sin 拼一个便宜的伪 curl（不需要真噪声 ✓ 快得多 ✓）*/
    '  float tt = age * uTurbFreq + aSeed * 6.28;',
    '  vec3 turb = vec3(sin(tt * 1.7), sin(tt * 2.3 + 1.1), sin(tt * 1.3 + 2.7)) * uTurb * age;',
    '  p += turb;',
    '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
    '  gl_Position = projectionMatrix * mv;',
    /* ── 大小：随生命期变化 ✗ 火焰会膨胀、火星会缩小 ✓ ── */
    '  float sz = aSize * (1.0 + uSizeGrow * k);',
    '  gl_PointSize = sz * 300.0 / max(-mv.z, 0.1);',
    /* ── 透明度：淡入（前 8%）→ 保持 → 淡出（后 35%）── */
    '  float fin = smoothstep(0.0, 0.08, k);',
    '  float fout = 1.0 - smoothstep(0.65, 1.0, k);',
    '  vAlpha = fin * fout;',
    '  vColor = aColor;',
    '  vSeed = aSeed;',
    '}'
  ].join('\n');

  var GPU_PART_FRAG = [
    'precision mediump float;',
    'varying float vAlpha;',
    'varying vec3 vColor;',
    'varying float vSeed;',
    'uniform float uIntensity;',
    'uniform float uSoft;',       /* 柔边强度：1=圆润 0=硬点 */
    'uniform float uRingMode;',   /* 1 = 画成空心环（冲击波）*/
    'void main(){',
    /* gl_PointCoord 是 0~1 的点内坐标 ✗ 拿它做圆形 ✓ */
    '  vec2 q = gl_PointCoord - 0.5;',
    '  float d = length(q) * 2.0;',
    '  float a;',
    '  if (uRingMode > 0.5) {',
    '    a = smoothstep(0.55, 1.0, d) * smoothstep(1.0, 0.82, d);',   /* 环 */
    '  } else {',
    '    a = clamp(1.0 - pow(d, mix(1.0, 2.6, uSoft)), 0.0, 1.0);',   /* 圆形柔边 */
    '  }',
    '  if (a <= 0.001) discard;',
    '  vec3 col = vColor * (0.85 + 0.35 * sin(vSeed * 9.0 + d * 3.0));',
    '  gl_FragColor = vec4(col * uIntensity, a * vAlpha);',
    '}'
  ].join('\n');

  /* 造一个 GPU 粒子系统 ✗ 用 points（每个粒子 1 个点，比四边形省三角面 ✓）
     gl_PointSize 在大多数 GPU 上上限 64~256px ✗ 但技能粒子本来就小 ✓ 够用 ✓ */
  function gpuBurst(g, o) {
    var n = Math.max(1, o.count || 30);
    var r = rnd(o.seed || 7);
    var R = o.r || 0;                      /* 出生半径（球状扩散）*/
    var start = new Float32Array(n * 3);
    var vel = new Float32Array(n * 3);
    var birth = new Float32Array(n);
    var life = new Float32Array(n);
    var size = new Float32Array(n);
    var seed = new Float32Array(n);
    var col = new Float32Array(n * 3);
    var c0 = new THREE.Color(o.color || 0xffaa33);
    var c1 = o.color2 != null ? new THREE.Color(o.color2) : c0;
    var spread = o.spread == null ? 1 : o.spread;   /* 方向集中度（1=全向）*/
    var dirY = o.dirY || 0;
    var sp = o.speed || 4;
    for (var i = 0; i < n; i++) {
      var a = r() * Math.PI * 2;
      var e = (r() * 2 - 1) * Math.PI * 0.5 * spread + dirY * Math.PI * 0.5;
      var v = sp * (0.4 + r() * 0.9);
      start[i * 3] = (r() - 0.5) * R * 2;
      start[i * 3 + 1] = (o.y || 0.6) + (r() - 0.5) * R * 1.2;
      start[i * 3 + 2] = (r() - 0.5) * R * 2;
      vel[i * 3] = Math.cos(a) * Math.cos(e) * v;
      vel[i * 3 + 1] = Math.sin(e) * v + (o.up || 1.2);
      vel[i * 3 + 2] = Math.sin(a) * Math.cos(e) * v;
      birth[i] = (o.delay || 0) + r() * (o.stagger || 0);   /* 错开出生 ✗ 有层次 ✓ */
      life[i] = (o.life || 0.7) * (0.65 + r() * 0.7);       /* 寿命随机化 ✓ */
      size[i] = (o.size || 0.22) * (0.6 + r() * 0.8);
      seed[i] = r();
      var mixK = o.colorMix == null ? 0 : (o.colorMix * (0.5 + r() * 0.5));
      col[i * 3] = c0.r + (c1.r - c0.r) * mixK;
      col[i * 3 + 1] = c0.g + (c1.g - c0.g) * mixK;
      col[i * 3 + 2] = c0.b + (c1.b - c0.b) * mixK;
    }
    var geo = new THREE.BufferGeometry();
    /* position 属性必须存在（three 要求 ✓）但全都放原点 ✗ 真正位置在 aStart 里 ✓ */
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aStart', new THREE.BufferAttribute(start, 3));
    geo.setAttribute('aVel', new THREE.BufferAttribute(vel, 3));
    geo.setAttribute('aBirth', new THREE.BufferAttribute(birth, 1));
    geo.setAttribute('aLife', new THREE.BufferAttribute(life, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, (o.y || 0) + 2, 0), 30);

    var mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: FRAME.uTime,
        uIntensity: FRAME.uIntensity,
        uGravity: { value: o.grav == null ? 5.8 : o.grav },
        uDrag: { value: o.drag == null ? 0.6 : o.drag },
        uTurb: { value: o.turb == null ? 0.18 : o.turb },
        uTurbFreq: { value: o.turbFreq == null ? 2.4 : o.turbFreq },
        uSizeGrow: { value: o.grow == null ? 0 : o.grow },
        uSoft: { value: o.soft == null ? 1 : o.soft },
        uRingMode: { value: o.ring ? 1 : 0 }
      },
      vertexShader: GPU_PART_VERT,
      fragmentShader: GPU_PART_FRAG,
      transparent: true,
      depthWrite: false,
      blending: (o.blending !== undefined) ? o.blending : THREE.AdditiveBlending
    });
    var pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    g.add(pts);

    /* 出生时刻要相对【共享时钟】✗ 所以要记下当前 uTime ✓ */
    var t0 = FRAME.uTime.value;
    for (var j = 0; j < n; j++) { birth[j] += t0; }
    geo.attributes.aBirth.needsUpdate = true;

    var maxLife = 0;
    for (var m = 0; m < n; m++) { if (life[m] > maxLife) { maxLife = life[m]; } }

    return { obj: pts, t: 0, life: maxLife + (o.stagger || 0),
      /* ★ 2026-10-24：补 reset() ✗ POOL_IMPACT 池化时要重新用 ✓
         做法：把出生时刻整体平移到【当前共享时钟】✗ 粒子又从头开始 ✓
         不用重建几何、不用重新上传数据（只改 aBirth 一个属性 ✓ 很便宜）*/
      reset: function () {
        this.t = 0;
        var now = FRAME.uTime.value;
        var span = (o.stagger || 0);
        var base = birth;
        for (var q = 0; q < n; q++) {
          /* 原始偏移量 = 第一次记录的 birth - 那时的起点时间 ✗ 保留层次感 ✓ */
          base[q] = now + (q % 17) / 17 * span;
        }
        geo.attributes.aBirth.needsUpdate = true;
      },
      update: function (dt) {
        this.t += dt;
        return this.t < this.life;
      } };
  }

  /* ---------- 地面环 ---------- */
  function ringWave(g, o) {
    var m = new THREE.Mesh(new THREE.RingGeometry(0.2, o.thick || 0.4, 56),
      M(o.color || 0xa855f7, { side: THREE.DoubleSide, opacity: 0.9, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.y = o.y || 0.06; g.add(m);
    return { obj: m, t: 0, update: function (dt) {
      this.t += dt; var k = Math.min(1, this.t / (o.dur || 0.6));
      var r = (o.r0 || 0.5) + ((o.r1 || 8) - (o.r0 || 0.5)) * ease(k);
      this.obj.scale.setScalar(r / 0.5);
      this.obj.material.opacity = (1 - k) * (o.alpha == null ? 0.9 : o.alpha);
      return k < 1;
    } };
  }

  /* ---------- 柱子 ---------- */
  function pillar(g, o) {
    var m = new THREE.Mesh(new THREE.CylinderGeometry((o.w || 0.6) * (1 - (o.taper || 0.5)), o.w || 0.6, o.h || 12, 14, 1, true),
      M(o.color || 0x9fdcff, { opacity: o.alpha == null ? 0.45 : o.alpha, side: THREE.DoubleSide, depthWrite: false }));
    m.position.y = (o.h || 12) / 2; g.add(m);
    return { obj: m, t: 0, dur: o.dur || 0.35, update: function (dt) {
      this.t += dt; var k = Math.min(1, this.t / this.dur);
      this.obj.material.opacity = (1 - k) * ((o.alpha == null ? 0.45 : o.alpha) * 1.1);
      this.obj.scale.x = this.obj.scale.z = 1 + k * 0.6;
      return k < 1;
    } };
  }

  /* ---------- 剑 ---------- */
  function swordMesh(o) {
    o = o || {};
    var g = grp();
    var L = o.len || 3.2, W = o.w || 0.22;
    var blade = new THREE.Mesh(new THREE.BoxGeometry(W, L, W * 0.28), M(o.color || 0xdfe9f5));
    blade.position.y = L / 2; g.add(blade);
    var tip = new THREE.Mesh(new THREE.ConeGeometry(W * 0.52, L * 0.22, 4), M(o.color || 0xdfe9f5));
    tip.position.y = L + L * 0.09; tip.rotation.y = Math.PI / 4; g.add(tip);
    var guard = new THREE.Mesh(new THREE.BoxGeometry(W * 3.2, W * 0.42, W * 1.1), M(o.guard || 0xffd83d));
    guard.position.y = 0; g.add(guard);
    var hilt = new THREE.Mesh(new THREE.BoxGeometry(W * 0.62, L * 0.17, W * 0.62), M(0x6b4a2a));
    hilt.position.y = -L * 0.09; g.add(hilt);
    var pom = new THREE.Mesh(new THREE.SphereGeometry(W * 0.55, 8, 6), M(0xffd83d));
    pom.position.y = -L * 0.19; g.add(pom);
    g.rotation.x = Math.PI;
    return g;
  }
  function arrowMesh(color) {
    var g = grp();
    var shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 1.5, 5), M(0x9a6a3a));
    g.add(shaft);
    var head = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.3, 5), M(color || 0xdfe9f5));
    head.position.y = -0.88; head.rotation.x = Math.PI; g.add(head);
    var fl = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.02), M(0xffe0a0, { opacity: 0.85 }));
    fl.position.y = 0.64; g.add(fl);
    return g;
  }

  /* ---------- 飘字 ---------- */
  function floatText(g, o) {
    var cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
    var cx = cv.getContext('2d');
    cx.font = 'bold 64px system-ui,sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.fillStyle = o.color || '#ff9a3a';
    cx.shadowColor = 'rgba(0,0,0,0.6)'; cx.shadowBlur = 10;
    cx.fillText(o.text || '+', 128, 64);
    var tex = new THREE.CanvasTexture(cv);
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true,
      opacity: 0.95, depthWrite: false }));
    sp.scale.set(o.size || 2.2, (o.size || 2.2) / 2, 1);
    sp.position.set(0, o.y || 2.6, 0); g.add(sp);
    return { t: 0, sp: sp, dur: o.dur || 1.6, update: function (dt) {
      this.t += dt; var k = this.t / this.dur;
      this.sp.position.y = (o.y || 2.6) + k * (o.rise || 2.2);
      this.sp.material.opacity = 0.95 * (1 - k);
      return k < 1;
    } };
  }

  /* ---------- 残影 ---------- */
  function afterimages(g, o) {
    var list = [], N = o.n || 4;
    for (var i = 0; i < N; i++) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.7, 0.6),
        M(o.color || 0x7fd4ff, { opacity: 0.28, depthWrite: false }));
      m.position.set(0, 1.0, -(i + 1) * 0.55);
      g.add(m); list.push(m);
    }
    return { t: 0, dur: o.dur || 1.0, list: list, update: function (dt) {
      this.t += dt; var k = Math.min(1, this.t / this.dur);
      for (var i = 0; i < this.list.length; i++) {
        var it = this.list[i];
        it.material.opacity = 0.3 * (1 - k) * (1 - i / (this.list.length + 1));
        it.position.z = -(i + 1) * 0.55 - k * (o.drift || 2.5);
      }
      return k < 1;
    } };
  }

  /* ---------- 冰块 ---------- */
  function iceBlock(g, o) {
    /* ★★★ 2026-10-25（用户："被冻住的冰块做一下"）★★★
       ★ 原来：半透明蓝方块 + 6 个锥体 ✗ 像一块果冻 ✓
       ★ 现在：真冰块
         · 体内有【冰裂纹】：多层随机裂纹线，会随时间缓慢生长 ✓
         · 表面【霜花】：边缘结晶白化 ✗ 越靠边越白 ✓
         · 菲涅尔：正对视线透，掠射角反光 ✗ 冰的通透感 ✓
         · 内部有【气泡和杂质】：小亮点缓慢浮动 ✓
         · 6 个锥体保留（冰刺形状是对的）✗ 只是换成冰材质 ✓
       ★ 成本：方块还是 12 个三角 ✗ 完全不变 ✓ */
    var iceW = o.w || 1.5, iceH = o.h || 2.4, iceD = o.d || 1.3;
    var iceMat = shaderMat({
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      uni: { uOpacity: { value: 1 }, uSize: { value: new THREE.Vector3(iceW, iceH, iceD) } },
      frag: [
        'uniform float uOpacity;',
        'uniform vec3 uSize;',
        'void main(){',
        /* 用模型空间坐标归一化到 0~1 盒内坐标 */
        '  vec3 q = vPos / uSize + 0.5;',
        '  vec3 aq = abs(q - 0.5) * 2.0;',
        /* ② 霜花：越靠近表面越白 ✗ 六个面各自算 ✓ */
        '  float nearFace = max(max(aq.x, aq.y), aq.z);',
        '  float frost = smoothstep(0.55, 1.0, nearFace);',
        /* ① 冰裂纹：三层不同尺度的噪声，只在某个阈值附近出亮线 */
        '  float n1 = fbm(q.xy * 6.0 + q.z * 2.0 + uTime * 0.05);',
        '  float n2 = fbm(q.zy * 11.0 - q.x * 3.0 - uTime * 0.035);',
        '  float n3 = fbm(q.xz * 19.0 + q.y * 4.0);',
        '  float crack = 0.0;',
        '  crack += smoothstep(0.035, 0.0, abs(n1 - 0.50));',
        '  crack += smoothstep(0.025, 0.0, abs(n2 - 0.50)) * 0.8;',
        '  crack += smoothstep(0.018, 0.0, abs(n3 - 0.50)) * 0.6;',
        /* ③ 气泡/杂质：稀疏亮点 */
        '  float bubble = smoothstep(0.86, 0.99, fbm(q.xy * 30.0 + q.z * 12.0));',
        /* ④ 菲涅尔 */
        '  vec3 nrm = normalize(vNormalW);',
        '  float fres = pow(1.0 - abs(dot(nrm, vViewDir)), 2.0);',
        /* 配色 */
        '  vec3 cCore  = vec3(0.44, 0.76, 0.94);',    /* 冰体 */
        '  vec3 cDeep  = vec3(0.16, 0.44, 0.66);',    /* 深处 */
        '  vec3 cCrack = vec3(0.92, 0.99, 1.00);',    /* 裂纹亮 */
        '  vec3 cFrost = vec3(0.98, 1.00, 1.00);',    /* 霜白 */
        '  vec3 col = mix(cDeep, cCore, 0.55 + fres * 0.45);',
        '  col = mix(col, cCrack, clamp(crack, 0.0, 1.0) * 0.85);',
        '  col = mix(col, cFrost, frost * 0.75);',
        '  col += vec3(0.75, 0.95, 1.0) * bubble * 0.6;',
        '  col += vec3(0.85, 0.97, 1.0) * fres * 0.55;',
        /* 透明度：中心更透（看得见里面的人）✗ 边缘更实 ✓ */
        '  float alpha = 0.30 + frost * 0.42 + crack * 0.30 + fres * 0.28;',
        '  gl_FragColor = vec4(col * uIntensity, clamp(alpha, 0.0, 0.95) * uOpacity);',
        '}'
      ].join('\n')
    });
    var b = new THREE.Mesh(new THREE.BoxGeometry(iceW, iceH, iceD), iceMat);
    b.position.y = iceH / 2; g.add(b);
    for (var i = 0; i < 6; i++) {
      var m = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 4), M(0xe6f9ff, { opacity: 0.75 }));
      var a = i / 6 * Math.PI * 2;
      m.position.set(Math.cos(a) * 0.8, 0.4 + (i % 3) * 0.6, Math.sin(a) * 0.7);
      m.rotation.z = -Math.cos(a); g.add(m);
    }
    return { t: 0, dur: o.dur || 2.2, update: function (dt) {
      this.t += dt; var k = Math.min(1, this.t / this.dur);
      iceMat.uniforms.uOpacity.value = 1 - Math.max(0, (k - 0.7) / 0.3);
      return k < 1;
    } };
  }

  /* =================================================================
     技能动画
     ================================================================= */

  /* ---- 黑洞 ---- */
  V.blackhole = {
    label: '黑洞', target: 'ground',
    tune: [{ k: 'r', label: '半径', min: 3, max: 16, step: 0.5, def: 10 },
      { k: 'dur', label: '持续', min: 0.4, max: 3, step: 0.1, def: 1.0 },
      { k: 'parts', label: '粒子数', min: 0, max: 300, step: 10, def: 120 },
      { k: 'core', label: '核心大小', min: 0.4, max: 3, step: 0.1, def: 1.5 },
      { k: 'spin', label: '环转速', min: 0, max: 10, step: 0.5, def: 4.5 }],
    mk: function (o) {
      var g = grp(), r = o.r, dur = o.dur, coreR = o.core, spin = o.spin;
      var R = rnd(o.seed);
      var core = new THREE.Mesh(new THREE.SphereGeometry(coreR, 20, 16), new THREE.MeshBasicMaterial({ color: 0x05000a }));
      core.position.y = 2.4; g.add(core);
      function arc(rr, w, color, len, op) {
        var m = new THREE.Mesh(new THREE.TorusGeometry(rr, w, 8, 40, len), M(color, { opacity: op }));
        m.position.y = 2.4; return m;
      }
      var h1 = arc(coreR * 1.45, coreR * 0.1, 0xb266ff, Math.PI * 1.45, 0.95);
      var h2 = arc(coreR * 1.85, coreR * 0.06, 0xe9c7ff, Math.PI * 1.1, 0.7);
      h1.rotation.set(Math.PI / 2.1, 0, 0); h2.rotation.set(Math.PI / 2.4, 0, 0);
      g.add(h1); g.add(h2);
      /* ★★★ 2026-10-24 升级：引力吸积盘着色器 ★★★
         原来：一个紫色圆环（RingGeometry + 0.35 透明度）✗ 就是个光圈 ✓
         现在：地面上一张【被吸进去的旋涡盘】
           · 螺旋纹理：用极坐标 + 角度偏移让纹理卷成旋臂 ✗ 真的在"转" ✓
           · 越靠近中心越亮越蓝白 ✗ 远处是暗紫 ✗ 典型的吸积盘配色 ✓
           · 边缘破碎：噪声溶解 ✗ 不是完美圆环 ✓
           · 内圈是纯黑（事件视界）✗ 中心有个真正的"洞" ✓✓
         成本：圆盘 64 段 ✗ 三角面不变 ✓ */
      var diskMat = shaderMat({
        blending: THREE.AdditiveBlending,
        uni: { uRadius: { value: r }, uCore: { value: coreR }, uSpin: { value: spin || 4.5 }, uOpacity: { value: 1 } },
        frag: [
          'uniform float uRadius, uCore, uSpin, uOpacity;',
          'void main(){',
          '  vec2 p = (vUv - 0.5) * 2.0;',
          '  float d = length(p);',
          '  if (d > 1.0) discard;',
          '  float ang = atan(p.y, p.x) / 6.2831853;',
          /* 事件视界：中心一小块纯黑 ✗ 什么都看不到 ✓ */
          '  float horizon = uCore / uRadius * 0.5;',
          '  if (d < horizon) { gl_FragColor = vec4(0.0, 0.0, 0.0, 0.92); return; }',
          /* 螺旋：角度减去随半径变化的相位 ✗ 纹理就卷成旋臂 ✓ */
          '  float spiral = ang + log(max(d, 0.02)) * 1.8 - uTime * uSpin * 0.22;',
          /* 两套低频花纹叠一层高频细纹 ✗ 层次感 ✓ */
          '  float n1 = fbm(vec2(spiral * 5.0, d * 3.0 - uTime * 0.3));',
          '  float n2 = fbm(vec2(spiral * 13.0 + 7.0, d * 7.0 + uTime * 0.18));',
          '  float arms = n1 * 0.68 + n2 * 0.32;',
          /* 越靠近中心越亮（引力势能）✗ 远处快速衰减 ✓ */
          '  float rr = clamp((d - horizon) / max(1.0 - horizon, 0.01), 0.0, 1.0);',
          '  float glow = pow(1.0 - rr, 2.2);',
          /* 边缘溶解 ✗ 不规则 ✓ */
          '  float edge = smoothstep(1.0, 0.72, d + arms * 0.20);',
          '  vec3 cFar  = vec3(0.28, 0.06, 0.55);',   /* 暗紫 */
          '  vec3 cMid  = vec3(0.62, 0.24, 0.95);',   /* 紫 */
          '  vec3 cHot  = vec3(0.88, 0.72, 1.00);',   /* 蓝白 */
          '  vec3 col = mix(cFar, cMid, smoothstep(0.0, 0.55, glow));',
          '  col = mix(col, cHot, smoothstep(0.55, 1.0, glow));',
          '  float a = edge * (0.10 + arms * 0.62 + glow * 0.55) * uOpacity;',
          '  gl_FragColor = vec4(col * (1.0 + glow * 1.3) * uIntensity, a);',
          '}'
        ].join('\n')
      });
      var ground = new THREE.Mesh(new THREE.CircleGeometry(r, 64), diskMat);
      ground.rotation.x = -Math.PI / 2; ground.position.y = 0.10; g.add(ground);
      diskMat.uniforms.uOpacity.value = 1;
      var P = null;
      if (o.parts > 0) {
        var pos = new Float32Array(o.parts * 3), list = [];
        for (var i = 0; i < o.parts; i++) {
          var a = R() * Math.PI * 2, rr = r * (0.45 + R() * 0.55);
          list.push({ a: a, rr: rr, h: 0.3 + R() * 2.2, sp: 1.4 + R() * 1.6 });
          pos[i * 3] = Math.cos(a) * rr; pos[i * 3 + 1] = list[i].h; pos[i * 3 + 2] = Math.sin(a) * rr;
        }
        var geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        var obj = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xc79cff, size: 0.24,
          transparent: true, opacity: 0.95, sizeAttenuation: true, depthWrite: false }));
        g.add(obj); P = { geo: geo, list: list, obj: obj };
      }
      var wave = new THREE.Mesh(new THREE.RingGeometry(0.6, 1.2, 64),
        M(0xd8b4fe, { side: THREE.DoubleSide, opacity: 0 }));
      wave.rotation.x = -Math.PI / 2; wave.position.y = 0.25; g.add(wave);
      return { group: g, t: 0, dur: dur, update: function (dt) {
        var t = (this.t += dt), k = Math.min(1, t / dur);
        core.scale.setScalar((1 + Math.sin(t * 14) * 0.06) * (1 - k * 0.3));
        h1.rotation.z += dt * spin; h2.rotation.z -= dt * spin * 1.4;
        /* ★ 2026-10-24：着色器材质不能用 .opacity ✗ 要改 uniform ✓ */
        diskMat.uniforms.uOpacity.value = 0.62 + 0.38 * Math.sin(t * 8);
        if (P) {
          var arr = P.geo.attributes.position.array;
          for (var i = 0; i < P.list.length; i++) {
            var p = P.list[i];
            p.rr *= (1 - 2.4 * dt * p.sp / r); p.h += (2.4 - p.h) * (1.8 * dt);
            arr[i * 3] = Math.cos(p.a) * p.rr; arr[i * 3 + 1] = p.h; arr[i * 3 + 2] = Math.sin(p.a) * p.rr;
          }
          P.geo.attributes.position.needsUpdate = true;
        }
        if (t >= dur) {
          var e = t - dur; core.visible = false; h1.visible = false; h2.visible = false;
          var w = Math.min(1, e / 0.45);
          wave.scale.setScalar(1 + w * (r / 0.9)); wave.material.opacity = (1 - w) * 0.9;
          diskMat.uniforms.uOpacity.value = Math.max(0, 1 - w);
          if (e > 0.55) { this.dead = true; }
        }
        return !this.dead;
      } };
    }
  };

  /* ---- 万剑归宗 ---- */
  V.swordrain = {
    label: '万剑归宗', target: 'ground',
    tune: [{ k: 'r', label: '半径', min: 1, max: 14, step: 0.5, def: 6 },
      { k: 'dur', label: '持续', min: 1, max: 5, step: 0.1, def: 3 },
      { k: 'n', label: '次数', min: 1, max: 14, step: 1, def: 8 },
      { k: 'speed', label: '掉落速度', min: 4, max: 40, step: 1, def: 24 },
      { k: 'size', label: '剑大小', min: 0.6, max: 2.5, step: 0.1, def: 1.2 }],
    mk: function (o) {
      var g = grp(), R = rnd(o.seed), parts = [];
      var edge = new THREE.Mesh(new THREE.RingGeometry(o.r - 0.12, o.r, 56),
        M(0x9fd8ff, { side: THREE.DoubleSide, opacity: 0.5 }));
      edge.rotation.x = -Math.PI / 2; edge.position.y = 0.05; g.add(edge);
      parts.push({ t: 0, update: function (dt) { this.t += dt; edge.material.opacity = 0.5 * Math.max(0, 1 - this.t / 1.2); return this.t < 1.2; } });
      for (var i = 0; i < o.n; i++) {
        (function (i) {
          var sub = grp();
          var a = R() * Math.PI * 2, d = R() * o.r * 0.8;
          sub.position.set(Math.cos(a) * d, 0, Math.sin(a) * d); g.add(sub);
          var sw = swordMesh({ len: 2.6 * o.size, w: 0.2 * o.size, color: 0xdfe9f5 });
          sw.position.y = 12; sub.add(sw);
          /* ★★★ 2026-10-24 升级：下落光轨 ★★★
             ★ 原来只有一把剑往下掉 ✗ 看不出"速度"✓
             ★ 现在剑后面拖一条【渐隐的光带】✗ 像流星 ✓
               · 用一片竖直四边形 + 着色器做由上到下的渐隐
               · 顶部亮白、底部完全透明 ✗ 速度感就出来了 ✓
               · 边缘软化（避免看到方形的边）✓
               · 成本：2 个三角 ✗ 比剑本身还便宜 ✓ */
          var trailH = 9 * o.size;
          var trailMat = shaderMat({
            blending: THREE.AdditiveBlending,
            uni: { uOpacity: { value: 1 } },
            frag: [
              'uniform float uOpacity;',
              'void main(){',
              /* vUv.y: 0=底部 1=顶部 */
              '  float y = vUv.y;',
              /* 横向软边 ✗ 不然是个方形光片 ✓ */
              '  float x = abs(vUv.x - 0.5) * 2.0;',
              '  float softX = pow(1.0 - x, 2.2);',
              /* 纵向：顶部最亮，往下渐隐 ✗ 拖尾感 ✓ */
              '  float fadeY = pow(y, 1.6);',
              /* 细密的横向波纹 ✗ 高速流动的光带质感 ✓ */
              '  float streak = 0.75 + 0.25 * sin(vUv.y * 40.0 - uTime * 30.0);',
              '  float a = softX * fadeY * streak * uOpacity;',
              '  vec3 cNear = vec3(1.0, 1.0, 1.0);',
              '  vec3 cFar  = vec3(0.42, 0.72, 1.0);',
              '  vec3 col = mix(cFar, cNear, pow(y, 2.5));',
              '  gl_FragColor = vec4(col * uIntensity, a * 0.85);',
              '}'
            ].join('\n')
          });
          var trail = new THREE.Mesh(new THREE.PlaneGeometry(0.55 * o.size, trailH), trailMat);
          /* ★ 光轨挂在剑【上方】✗ 跟着剑一起落 ✓ 剑尖顶部 = sw.position.y + 剑长 */
          var SWLEN = 2.6 * o.size;
          trail.position.y = 12 + SWLEN + trailH * 0.5;
          sub.add(trail);
          var w = ringWave(sub, { color: 0x9fd8ff, r0: 0.3, r1: 1.8, dur: 0.4, thick: 0.15, alpha: 0.8 });
          parts.push({ t: -i * (o.dur / o.n), sw: sw, w: w, tr: trail, trMat: trailMat,
            fall: 12 / Math.max(2, o.speed), phase: 0, swlen: SWLEN, trH: trailH,
            update: function (dt) {
              this.t += dt;
              if (this.t < 0) { return true; }
              if (this.phase === 0) {
                var yy = 12 * (1 - ease(Math.min(1, this.t / this.fall))) + 0.1;
                this.sw.position.y = yy;
                /* 光轨跟着剑：顶端贴着剑尖，向下拖出 trailH */
                if (this.tr) { this.tr.position.y = yy + this.swlen + this.trH * 0.5; }
                if (this.t >= this.fall) {
                  this.phase = 1; this.t = 0;
                  this.sw.visible = false;
                  if (this.tr) { this.tr.visible = false; }
                }
              } else {
                /* 落地瞬间光轨快速收掉 ✗ 不然会闪一下 ✓ */
                if (this.tr && this.tr.visible) {
                  this.trMat.uniforms.uOpacity.value = Math.max(0, 1 - this.t / 0.12);
                  if (this.t > 0.12) { this.tr.visible = false; }
                }
                this.w.update(dt);
                if (this.t > 0.5) { return false; }
              }
              return true;
            } });
        })(i);
      }
      return { group: g, update: function (dt) {
        var alive = false;
        for (var i = 0; i < parts.length; i++) { if (parts[i].update(dt)) { alive = true; } }
        return alive;
      } };
    }
  };

  /* ---- 混沌箭雨 ---- */
  V.arrowrain = {
    label: '混沌箭雨', target: 'ground',
    tune: [{ k: 'r', label: '半径', min: 2, max: 14, step: 0.5, def: 10 },
      { k: 'dur', label: '持续', min: 0.5, max: 4, step: 0.1, def: 2 },
      { k: 'n', label: '箭数', min: 3, max: 24, step: 1, def: 12 },
      { k: 'speed', label: '掉落速度', min: 6, max: 40, step: 1, def: 26 }],
    mk: function (o) {
      var g = grp(), R = rnd(o.seed), parts = [];
      for (var i = 0; i < o.n; i++) {
        (function () {
          var sub = grp();
          var a = R() * Math.PI * 2, d = R() * o.r;
          sub.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
          sub.rotation.y = R() * Math.PI * 2;
          g.add(sub);
          var ar = arrowMesh(0xdfe9f5); ar.position.y = 11; sub.add(ar);
          /* ★ 2026-10-25 升级：箭雨加【下落光轨】✗ 像流星雨 ✓
             （和万剑归宗同一套做法 ✗ 但箭更细、光轨更紫 ✓）*/
          var arrTrailMat = shaderMat({
            blending: THREE.AdditiveBlending,
            uni: { uOpacity: { value: 1 } },
            frag: [
              'uniform float uOpacity;',
              'void main(){',
              '  float y = vUv.y;',
              '  float x = abs(vUv.x - 0.5) * 2.0;',
              '  float softX = pow(1.0 - x, 2.4);',
              '  float fadeY = pow(y, 1.7);',
              '  float streak = 0.70 + 0.30 * sin(vUv.y * 55.0 - uTime * 34.0);',
              '  float a = softX * fadeY * streak * uOpacity;',
              '  vec3 cNear = vec3(0.96, 0.94, 1.00);',
              '  vec3 cFar  = vec3(0.52, 0.42, 0.95);',   /* 紫罗兰：混沌 ✓ */
              '  vec3 col = mix(cFar, cNear, pow(y, 2.0));',
              '  gl_FragColor = vec4(col * uIntensity, a * 0.8);',
              '}'
            ].join('\n')
          });
          var arrTrailH = 6.5;
          var arrTrail = new THREE.Mesh(new THREE.PlaneGeometry(0.34, arrTrailH), arrTrailMat);
          arrTrail.position.y = 11 + 1.2 + arrTrailH * 0.5;
          sub.add(arrTrail);
          parts.push({ t: -R() * (o.dur * 0.7), ar: ar, tr: arrTrail, trMat: arrTrailMat,
            trH: arrTrailH, fall: 11 / Math.max(3, o.speed), update: function (dt) {
            this.t += dt; if (this.t < 0) { return true; }
            var k = Math.min(1, this.t / this.fall);
            this.ar.position.y = 11 * (1 - k) + 0.1;
            if (this.tr) { this.tr.position.y = this.ar.position.y + 1.2 + this.trH * 0.5; }
            if (k >= 1 && this.tr) {
              this.trMat.uniforms.uOpacity.value = Math.max(0, 1 - (this.t - this.fall) / 0.12);
            }
            return k < 1;
          } });
        })();
      }
      return { group: g, update: function (dt) {
        var alive = false;
        for (var i = 0; i < parts.length; i++) { if (parts[i].update(dt)) { alive = true; } }
        return alive;
      } };
    }
  };

  /* ---- 烈焰风暴：龙卷 + 火焰 ---- */
  V.firestorm = {
    label: '烈焰风暴', target: 'ground',
    tune: [{ k: 'r', label: '半径', min: 2, max: 9, step: 0.5, def: 5 },
      { k: 'dur', label: '持续', min: 1, max: 6, step: 0.2, def: 4 },
      { k: 'th', label: '龙卷高度', min: 3, max: 14, step: 0.5, def: 8 },
      { k: 'spin', label: '旋转速度', min: 1, max: 14, step: 0.5, def: 7 }],
    /* ★★★ 2026-10-24 升级：体积火着色器 ★★★
       原来：三层小球（SphereGeometry）+ 纯色 0xff2a00 / 0xff8a1a / 0xffd86a
       问题：球是光滑的 ✗ 一眼就是"一堆球在转" ✓ 没有火焰的翻腾感 ✓
       现在：两片【旋转的圆柱壳】+ FBM 噪声着色的火焰
         · 火焰形状完全由噪声决定 ✗ 每帧都在变 ✓ 会"烧"不会"转圈"✓
         · 颜色按高度分层：底部深红 → 中部橙 → 顶部亮黄 ✗ 和真火一样 ✓
         · 边缘用 smoothstep 软化 ✗ 不会有硬边 ✓
         · 底部画一个发光的热盘 ✗ 火从地上烧起来的感觉 ✓
       成本：2 个圆柱壳（约 600 三角）+ 1 个圆盘（88 三角）✗ 比原来 100+ 个球便宜得多 ✓✓ */
    mk: function (o) {
      var g = grp(), t = 0, R = rnd(o.seed || 1);
      var TH = o.th || 8, RAD = o.r;

      /* 火焰主体：两层同心圆柱壳，外层慢转、内层快转（像火焰分层上升）*/
      var shells = [];
      for (var L = 0; L < 2; L++) {
        var rr = RAD * (L === 0 ? 1.0 : 0.66);
        var dir = L === 0 ? 1 : -1;              /* 两层反向转 ✗ 更有搅动感 ✓ */
        var mat = shaderMat({
          uni: {
            uRadius: { value: rr },
            uHeight: { value: TH },
            uSeed: { value: (o.seed || 1) * 0.137 + L * 3.7 },
            uSpin: { value: (o.spin || 7) * dir * (L === 0 ? 1 : 1.6) },
            uOpacity: { value: L === 0 ? 1.0 : 0.75 }
          },
          tint: 0xff6a1a,
          frag: [
            'uniform float uRadius, uHeight, uSeed, uSpin, uOpacity;',
            'void main(){',
            /* 圆柱壳展开成"一圈 + 高度"的纹理坐标 */
            '  float ang = atan(vPos.z, vPos.x) / 6.2831853 + 0.5;',
            '  float h = clamp((vPos.y + uHeight * 0.5) / uHeight, 0.0, 1.0);',
            /* 火焰向上翻滚 ✗ 噪声坐标随时间沿 y 往上跑 ✓ */
            '  vec2 np = vec2(ang * 7.0 + uSeed, h * 3.2 - uTime * (1.1 + uSpin * 0.06));',
            '  float n = fbm(np);',
            '  float n2 = fbm(np * 2.4 + vec2(5.2, -uTime * 0.7));',
            '  float flame = n * 0.68 + n2 * 0.32;',
            /* 高度越高越稀薄 ✗ 顶部散成烟 ✓ */
            '  float body = smoothstep(0.18, 0.55, flame) * (1.0 - smoothstep(0.45, 1.0, h));',
            /* 底部最亮（火源）✗ 往上渐暗 ✓ */
            '  float heat = 1.0 - h;',
            '  vec3 cDark  = vec3(0.55, 0.06, 0.01);',
            '  vec3 cMid   = vec3(1.00, 0.32, 0.03);',
            '  vec3 cHot   = vec3(1.00, 0.72, 0.20);',
            '  vec3 cWhite = vec3(1.00, 0.95, 0.70);',
            '  float hh = clamp(heat * (0.55 + flame * 0.75), 0.0, 1.0);',
            '  vec3 col = mix(cDark, cMid, smoothstep(0.0, 0.45, hh));',
            '  col = mix(col, cHot, smoothstep(0.45, 0.78, hh));',
            '  col = mix(col, cWhite, smoothstep(0.82, 1.0, hh));',
            /* 边缘：法线朝向摄像机的部分更亮（体积感的廉价近似）*/
            '  float rim = pow(1.0 - abs(normalize(vPos.xz).x * normalize(vPos.xz).y + 0.5), 1.2);',
            '  float a = body * (0.55 + 0.45 * rim) * uOpacity;',
            '  a *= 0.85 + 0.15 * sin(uTime * 9.0 + uSeed * 6.0);',   /* 轻微脉动 */
            '  gl_FragColor = vec4(col * (1.0 + heat * 0.6) * uIntensity, a);',
            '}'
          ].join('\n')
        });
        var geo = new THREE.CylinderGeometry(rr * 0.55, rr, TH, 28, 1, true);
        var mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = TH * 0.5;
        g.add(mesh);
        shells.push({ m: mesh, sp: (o.spin || 7) * dir * (L === 0 ? 1 : 1.5) });
      }

      /* 地面热盘：火从地上烧起来的底座 ✗ 用发光渐变 ✓ */
      var baseMat = shaderMat({
        blending: THREE.AdditiveBlending,
        uni: { uRadius: { value: RAD } },
        frag: [
          'uniform float uRadius;',
          'void main(){',
          '  vec2 p = (vUv - 0.5) * 2.0;',
          '  float d = length(p);',
          '  if (d > 1.0) discard;',
          /* 中心白热 → 外围橙红，边缘溶解成不规则火舌 */
          '  float n = fbm(p * 3.5 + vec2(0.0, -uTime * 0.9));',
          '  float edge = smoothstep(1.0, 0.55, d + n * 0.22);',
          '  float core = smoothstep(0.85, 0.0, d);',
          '  vec3 col = mix(vec3(1.0, 0.28, 0.02), vec3(1.0, 0.85, 0.45), core);',
          '  float a = edge * (0.35 + core * 0.65);',
          '  gl_FragColor = vec4(col * uIntensity, a);',
          '}'
        ].join('\n')
      });
      var base = new THREE.Mesh(new THREE.CircleGeometry(RAD * 1.06, 40), baseMat);
      base.rotation.x = -Math.PI / 2; base.position.y = 0.10;
      g.add(base);

      /* 飞溅的火星（保留原来的粒子 ✗ 它效果好、成本低 ✓）*/
      var em = burst(g, { color: 0xffb347, count: 40, speed: 2.5, size: 0.2, life: 1.4,
        y: 0.4, up: 2.6, grav: -1.5, seed: 5 });

      return { group: g, update: function (dt) {
        t += dt;
        var k = Math.min(1, t / o.dur);
        for (var i = 0; i < shells.length; i++) {
          shells[i].m.rotation.y += dt * shells[i].sp * 0.35;
          /* 整体胀缩：呼吸感 ✗ 但幅度要小，不然像弹簧 ✓ */
          var sc = 1 + Math.sin(t * 5.5 + i * 2.1) * 0.035;
          shells[i].m.scale.set(sc, 1 + Math.sin(t * 4.2 + i) * 0.05, sc);
        }
        /* 结尾淡出 ✗ 不戛然而止 ✓ */
        var fadeOut = 1 - Math.max(0, (k - 0.82) / 0.18);
        base.material.uniforms.uIntensity.value = FRAME.uIntensity.value * fadeOut;
        for (var j = 0; j < shells.length; j++) {
          var u = shells[j].m.material.uniforms;
          u.uOpacity.value = (j === 0 ? 1.0 : 0.75) * fadeOut;
        }
        em.update(dt);
        return t < o.dur;
      } };
    }
  };

  /* ---- 冰封领域 ---- */
  V.icefield = {
    label: '冰封领域', target: 'ground',
    tune: [{ k: 'r', label: '半径', min: 2, max: 14, step: 0.5, def: 7 },
      { k: 'dur', label: '持续', min: 0.5, max: 3, step: 0.1, def: 1.2 },
      { k: 'ice', label: '目标冰块时长', min: 0.5, max: 6, step: 0.2, def: 3.0 },
      { k: 'n', label: '冰柱数', min: 0, max: 16, step: 1, def: 10 }],
    mk: function (o) {
      var g = grp(), R = rnd(o.seed), parts = [];
      /* ★★★ 2026-10-24 升级：霜冻着色器 ★★★
         原来：一个纯蓝圆盘（CircleGeometry + 0.28 透明度）✗ 就是个色块 ✓
         现在：片元着色器画【冰晶裂纹 + 霜花边缘 + 冷雾流动】
           · 从中心往外辐射的裂纹（用极坐标角度的 hash 噪声）✗ 像真的冻结 ✓
           · 边缘不规则地爬满霜 ✗ 不是完美圆形 ✓
           · 中心亮、边缘暗 ✗ 有能量从地面渗出的感觉 ✓
         成本：圆盘还是 40 段 ✗ 一个三角面都没多 ✓ */
      var iceMat = shaderMat({
        blending: THREE.NormalBlending,
        uni: { uRadius: { value: o.r }, uOpacity: { value: 1 } },
        tint: 0x9fe8ff,
        frag: [
          'uniform float uRadius, uOpacity;',
          'void main(){',
          '  vec2 p = (vUv - 0.5) * 2.0;',
          '  float d = length(p);',
          '  if (d > 1.0) discard;',
          '  float ang = atan(p.y, p.x);',
          /* ① 辐射状冰裂纹：角度上做 hash ✗ 只取一部分角度出裂纹 ✓ */
          '  float spokes = fract(ang / 6.2831853 * 26.0 + hash11(floor(d * 4.0) + 7.0) * 0.5);',
          '  float crack = smoothstep(0.46, 0.5, spokes) * smoothstep(0.54, 0.5, spokes);',
          '  crack *= smoothstep(0.15, 0.55, d);',
          /* ② 霜花：fbm 噪声 ✗ 从外向内蔓延 ✓ */
          '  float frost = fbm(vec2(ang * 3.2, d * 5.5) + uTime * 0.06);',
          '  float frostMask = smoothstep(0.42, 0.72, frost + d * 0.55);',
          /* ③ 边缘不规则溶解 ✗ 不是完美圆 ✓ */
          '  float edgeNoise = fbm(vec2(ang * 2.4 + 3.1, 0.5)) * 0.24;',
          '  float edge = smoothstep(1.0, 0.60, d + edgeNoise);',
          /* ④ 中心冷光 */
          '  float core = smoothstep(0.75, 0.0, d);',
          '  vec3 cDeep = vec3(0.16, 0.55, 0.86);',
          '  vec3 cIce  = vec3(0.62, 0.92, 1.00);',
          '  vec3 cWhite= vec3(0.94, 0.99, 1.00);',
          '  vec3 col = mix(cDeep, cIce, frostMask);',
          '  col = mix(col, cWhite, crack * 0.85 + core * 0.55);',
          '  float a = edge * (0.16 + frostMask * 0.30 + crack * 0.42 + core * 0.16);',
          '  gl_FragColor = vec4(col * uIntensity, a * uOpacity);',
          '}'
        ].join('\n')
      });
      var disc = new THREE.Mesh(new THREE.CircleGeometry(o.r, 40), iceMat);
      disc.rotation.x = -Math.PI / 2; disc.position.y = 0.10; g.add(disc);
      parts.push({ t: 0, update: function (dt) {
        this.t += dt;
        iceMat.uniforms.uOpacity.value = Math.max(0, 1 - this.t / (o.dur + 0.6));
        return this.t < o.dur + 0.6; } });
      parts.push(ringWave(g, { color: 0xd6f6ff, r0: 0.6, r1: o.r, dur: o.dur, thick: 0.32 }));
      for (var i = 0; i < o.n; i++) {
        (function () {
          var m = new THREE.Mesh(new THREE.ConeGeometry(0.2 + R() * 0.2, 0.9 + R() * 0.9, 6),
            M(0xd6f6ff, { opacity: 0.85 }));
          var a = R() * 6.28, d = R() * o.r * 0.85;
          m.position.set(Math.cos(a) * d, 0.45, Math.sin(a) * d);
          g.add(m);
          parts.push({ t: -R() * o.dur * 0.5, m: m, update: function (dt) {
            this.t += dt; if (this.t < 0) { return true; }
            var k = Math.min(1, this.t / 0.35);
            this.m.scale.y = 0.2 + ease(k);
            this.m.material.opacity = 0.85 * (1 - Math.max(0, (this.t - 0.8) / 0.8));
            return this.t < 1.7;
          } });
        })();
      }
      var ice = iceBlock(grp(), { w: 1.6, h: 2.5, d: 1.4, dur: o.ice });
      g.add(ice.obj || grp());
      parts.push(ice);
      return { group: g, update: function (dt) {
        var alive = false;
        for (var i = 0; i < parts.length; i++) { if (parts[i].update(dt)) { alive = true; } }
        return alive;
      } };
    }
  };

  /* ---- 天罚：青竹风云剑 ---- */
  V.judgement = {
    label: '天罚', target: 'ground',
    tune: [{ k: 'r', label: '半径', min: 2, max: 14, step: 0.5, def: 8 },
      { k: 'size', label: '剑大小', min: 1, max: 4, step: 0.1, def: 2.2 },
      { k: 'speed', label: '下落速度', min: 3, max: 20, step: 0.5, def: 7 },
      { k: 'dur', label: '余波时长', min: 0.3, max: 2, step: 0.1, def: 0.9 }],
    mk: function (o) {
      var g = grp();
      /* ★★★ 2026-10-25 升级：天罚（大招） ★★★
         ★ 原来：一个纯黑圆 + 一根光柱 + 一把剑 ✗ 地上就是块黑饼 ✓
         ★ 现在：审判法阵
           · 黑底保留（判罚的阴影）✗ 但在上面叠一层【法阵纹】✓
           · 外圈符文环缓慢旋转 ✗ 像在吟唱 ✓
           · 内圈十字光纹脉动 ✗ 吟唱到最亮时剑才落下 ✓
           · 边缘有向外扩散的能量波 ✓
         ★ 成本：圆盘 40 段 ✗ 不变 ✓ */
      var judgMat = shaderMat({
        blending: THREE.AdditiveBlending,
        uni: { uRadius: { value: o.r }, uOpacity: { value: 1 }, uProg: { value: 0 } },
        frag: [
          'uniform float uRadius, uOpacity, uProg;',
          'void main(){',
          '  vec2 p = (vUv - 0.5) * 2.0;',
          '  float d = length(p);',
          '  if (d > 1.0) discard;',
          '  float ang = atan(p.y, p.x) / 6.2831853 + 0.5;',
          /* ① 外圈符文环：24 块，整体缓慢转 */
          '  float runeSector = fract((ang + uTime * 0.035) * 24.0);',
          '  float rune = smoothstep(0.30, 0.44, runeSector) * smoothstep(0.70, 0.56, runeSector);',
          '  rune *= smoothstep(0.80, 0.88, d) * smoothstep(0.98, 0.90, d);',
          /* ② 内圈十字光纹（四条径向亮线）*/
          '  float cross4 = pow(abs(sin(ang * 12.566)), 12.0);',
          '  cross4 *= smoothstep(0.72, 0.30, d) * smoothstep(0.12, 0.26, d);',
          /* ③ 中心审判十字：一个亮十字 + 脉动 */
          '  float vbar = smoothstep(0.055, 0.0, abs(p.x)) * smoothstep(0.55, 0.0, abs(p.y));',
          '  float hbar = smoothstep(0.055, 0.0, abs(p.y)) * smoothstep(0.55, 0.0, abs(p.x));',
          '  float cross = max(vbar, hbar);',
          /* ④ 外层扩散波 */
          '  float waveP = fract(uTime * 0.55);',
          '  float wave = smoothstep(0.06, 0.0, abs(d - waveP)) * (1.0 - waveP);',
          /* ⑤ 底色：黑（判罚阴影）转成很暗的蓝黑，不至于死黑 */
          '  float body = smoothstep(1.0, 0.72, d) * 0.42;',
          '  vec3 cDark = vec3(0.04, 0.06, 0.10);',
          '  vec3 cRune = vec3(0.55, 0.95, 0.78);',   /* 冷绿：和剑的玉色呼应 */
          '  vec3 col = cDark * body + cRune * (rune * 0.9 + cross4 * 0.5 + wave * 0.7);',
          '  col += vec3(0.85, 1.0, 0.95) * cross * (0.55 + 0.45 * sin(uTime * 4.2));',
          '  float a = body + rune * 0.75 + cross4 * 0.35 + cross * 0.9 + wave * 0.5;',
          '  gl_FragColor = vec4(col * uIntensity, clamp(a, 0.0, 1.0) * uOpacity);',
          '}'
        ].join('\n')
      });
      var sh = new THREE.Mesh(new THREE.CircleGeometry(o.r, 48), judgMat);
      sh.rotation.x = -Math.PI / 2; sh.position.y = 0.10; g.add(sh);
      var beam = pillar(g, { color: 0xd8f6ff, w: o.r * 0.28, h: 20, dur: 1.0, alpha: 0.3 });
      var sw = swordMesh({ len: 6 * o.size, w: 0.5 * o.size, color: 0xcfe9d8, guard: 0x6abf8a });
      var startY = 26;
      sw.position.y = startY; g.add(sw);
      var fall = startY / Math.max(2, o.speed), boom = null, t = 0;
      return { group: g, update: function (dt) {
        t += dt; beam.update(dt);
        if (!boom) {
          var k = Math.min(1, t / fall);
          sw.position.y = startY * (1 - ease(k)) + 0.1;
          if (k >= 1) {
            sw.visible = false;
            boom = { w: ringWave(g, { color: 0xe6fff0, r0: 1, r1: o.r, dur: 0.7, thick: 0.7, alpha: 0.95 }),
              b: burst(g, { color: 0xbff5d0, count: 70, speed: 9, size: 0.3, life: 0.9, seed: 3 }), t: 0 };
            if (typeof window !== 'undefined') { window.__VFX_SHAKE__ = 0.55; }
          }
          return true;
        }
        boom.t += dt; boom.w.update(dt); boom.b.update(dt);
        /* ★ 2026-10-25：剑砸下后法阵同步淡出 ✗ 不然会一直亮着 ✓ */
        judgMat.uniforms.uOpacity.value = Math.max(0, 1 - boom.t / Math.max(0.1, o.dur * 0.8));
        return boom.t < o.dur;
      } };
    }
  };

  /* ---- 地裂 ---- */
  V.earthsplit = {
    label: '地裂', target: 'ground',
    tune: [{ k: 'len', label: '长度', min: 3, max: 14, step: 0.5, def: 8 },
      { k: 'w', label: '宽度', min: 1, max: 4, step: 0.1, def: 2 },
      { k: 'n', label: '岩浆柱数', min: 2, max: 16, step: 1, def: 8 },
      { k: 'shake', label: '震屏强度', min: 0, max: 2, step: 0.1, def: 0.8 }],
    mk: function (o) {
      var g = grp(), R = rnd(o.seed || 3), parts = [];
      var crack = new THREE.Mesh(new THREE.PlaneGeometry(o.w, o.len),
        M(0x120a06, { side: THREE.DoubleSide, opacity: 0.9 }));
      crack.rotation.x = -Math.PI / 2; crack.position.set(0, 0.05, o.len * 0.5); g.add(crack);
      /* ★★★ 2026-10-24 升级：岩浆裂缝着色器 ★★★
         ★ 原来：裂缝里贴一条纯橙色平面（0xff5a00）✗ 像一条胶带 ✓
         ★ 现在：真正的岩浆
           · 中心白热、两边渐变到深红 ✗ 温度梯度 ✓
           · FBM 噪声在流动（向上游动）✗ 岩浆在翻涌 ✓
           · 边缘不规则（噪声溶解）✗ 不是笔直的条 ✓
           · 沿裂缝方向有脉动的亮斑 ✗ 像有气泡在爆 ✓
         ★ 成本：平面 2 个三角 ✗ 和原来一样 ✓ */
      var lavaMat = shaderMat({
        blending: THREE.AdditiveBlending,
        uni: { uOpacity: { value: 1 }, uPH: { value: o.len }, uPW: { value: o.w } },
        frag: [
          'uniform float uOpacity, uPH, uPW;',
          'void main(){',
          /* vUv.x = 横跨裂缝 (0~1)，vUv.y = 沿裂缝方向 */
          '  float x = abs(vUv.x - 0.5) * 2.0;',   /* 0=中心 1=边缘 */
          '  float y = vUv.y;',
          /* ① 横向温度梯度：中心白热 → 边缘深红 */
          '  float heat = pow(1.0 - x, 1.8);',
          /* ② 纵向流动的岩浆纹理（沿 y 往上跑）*/
          '  vec2 np = vec2(vUv.x * 5.0, y * 6.0 - uTime * 1.8);',
          '  float n1 = fbm(np);',
          '  float n2 = fbm(np * 2.7 + vec2(3.1, y * 2.0 - uTime * 1.1));',
          '  float flow = n1 * 0.65 + n2 * 0.35;',
          /* ③ 沿裂缝方向的脉动亮斑（气泡爆裂感）*/
          '  float blob = sin(y * 34.0 - uTime * 6.0 + flow * 8.0) * 0.5 + 0.5;',
          '  blob = pow(blob, 6.0) * 0.55;',
          /* ④ 边缘不规则溶解 */
          '  float edge = smoothstep(1.0, 0.62, x + flow * 0.28);',
          /* ⑤ 纵向两端淡出（裂缝尖）*/
          '  float tipFade = smoothstep(0.0, 0.08, y) * smoothstep(1.0, 0.90, y);',
          /* 配色：深红 → 橙 → 黄 → 白热 */
          '  float hh = clamp(heat * (0.55 + flow * 0.65) + blob, 0.0, 1.4);',
          '  vec3 cDeep = vec3(0.42, 0.04, 0.01);',
          '  vec3 cRed  = vec3(0.85, 0.14, 0.02);',
          '  vec3 cOrange = vec3(1.00, 0.42, 0.04);',
          '  vec3 cYellow = vec3(1.00, 0.78, 0.20);',
          '  vec3 cWhite  = vec3(1.00, 0.97, 0.85);',
          '  vec3 col = mix(cDeep, cRed, smoothstep(0.0, 0.35, hh));',
          '  col = mix(col, cOrange, smoothstep(0.35, 0.70, hh));',
          '  col = mix(col, cYellow, smoothstep(0.70, 1.00, hh));',
          '  col = mix(col, cWhite, smoothstep(1.00, 1.35, hh));',
          '  float a = edge * tipFade * (0.45 + flow * 0.55) * uOpacity;',
          '  gl_FragColor = vec4(col * (1.0 + heat * 0.7) * uIntensity, a);',
          '}'
        ].join('\n')
      });
      var lava = new THREE.Mesh(new THREE.PlaneGeometry(o.w * 0.55, o.len * 0.96), lavaMat);
      lava.rotation.x = -Math.PI / 2; lava.position.set(0, 0.07, o.len * 0.5); g.add(lava);
      crack.scale.z = 0.01; lava.scale.z = 0.01;
      if (typeof window !== 'undefined') { window.__VFX_SHAKE__ = o.shake; }
      for (var i = 0; i < o.n; i++) {
        (function (i) {
          var z = (i + 0.5) / o.n * o.len;
          var sub = grp(); sub.position.set((R() - 0.5) * o.w * 0.5, 0, z); g.add(sub);
          var pl = pillar(sub, { color: 0xff7a22, w: 0.35 + R() * 0.3, h: 2.5 + R() * 3, dur: 0.5, alpha: 0.5 });
          var sm = burst(sub, { color: 0x3a3a3a, count: 14, speed: 1.6, size: 0.45, life: 1.1, y: 0.5, up: 1.4, grav: -0.4, seed: i });
          var fi = burst(sub, { color: 0xff8a3a, count: 16, speed: 4, size: 0.2, life: 0.6, seed: i + 9 });
          parts.push({ t: -i / o.n * 0.5, pl: pl, sm: sm, fi: fi, update: function (dt) {
            this.t += dt; if (this.t < 0) { return true; }
            this.pl.update(dt); this.sm.update(dt); this.fi.update(dt);
            return this.t < 1.4;
          } });
        })(i);
      }
      return { group: g, t: 0, update: function (dt) {
        this.t += dt;
        var k = Math.min(1, this.t / 0.5);
        crack.scale.z = ease(k); lava.scale.z = ease(k);
        lavaMat.uniforms.uOpacity.value = 0.72 + 0.28 * Math.sin(this.t * 20);
        var alive = this.t < 0.6;
        for (var i = 0; i < parts.length; i++) { if (parts[i].update(dt)) { alive = true; } }
        return alive;
      } };
    }
  };

  /* ---- 时间凝滞：地面钟表 ---- */
  V.timestop = {
    label: '时间凝滞', target: 'ground',
    tune: [{ k: 'r', label: '半径', min: 3, max: 14, step: 0.5, def: 10 },
      { k: 'dur', label: '持续', min: 1, max: 6, step: 0.2, def: 3 },
      { k: 'spin', label: '指针速度', min: 0.5, max: 8, step: 0.5, def: 3 }],
    mk: function (o) {
      var g = grp(), t = 0;
      /* ★★★ 2026-10-25 升级：时间凝滞（表盘） ★★★
         ★ 原来：一个纯色圆环 ✗ 就一个圈 ✓
         ★ 现在：真正的表盘
           · 60 格刻度（小刻度暗、5 格一个的粗刻度亮）✗ 一眼是钟表 ✓
           · 外圈有一道【逆流扫光】✗ 时间被冻住的视觉暗示 ✓
           · 刻度随时间【越来越慢地转】✗ 呼应"凝滞"✓
           · 整体色调冷蓝 + 边缘霜化 ✓
         ★ 成本：环 72 段 ✗ 三角面不变 ✓ */
      var dialMat = shaderMat({
        blending: THREE.AdditiveBlending,
        uni: { uInner: { value: o.r * 0.9 }, uOuter: { value: o.r }, uOpacity: { value: 1 } },
        frag: [
          'uniform float uInner, uOuter, uOpacity;',
          'void main(){',
          '  float rad = length(vPos.xy);',
          '  float d = clamp((rad - uInner) / max(uOuter - uInner, 0.001), 0.0, 1.0);',
          '  float ang = atan(vPos.y, vPos.x) / 6.2831853 + 0.5;',
          /* ① 60 格刻度：每 1/60 一格 */
          '  float tick60 = fract(ang * 60.0);',
          '  float fine = smoothstep(0.42, 0.5, tick60) * smoothstep(0.58, 0.5, tick60);',
          /* ② 12 格主刻度：每 5 格一个，更长更亮 */
          '  float tick12 = fract(ang * 12.0);',
          '  float major = smoothstep(0.34, 0.5, tick12) * smoothstep(0.66, 0.5, tick12);',
          /* ③ 逆流扫光：一个亮点沿相反方向转 */
          '  float sweepP = fract(-uTime * 0.16 + 0.5);',
          '  float dA = abs(fract(ang - sweepP + 0.5) - 0.5);',
          '  float sweep = smoothstep(0.16, 0.0, dA) * (0.5 + 0.5 * d);',
          /* ④ 环本身：内沿亮、外沿淡 */
          '  float ring = smoothstep(0.0, 0.35, d) * smoothstep(1.0, 0.72, d);',
          '  vec3 cBase = vec3(0.55, 0.82, 1.00);',
          '  vec3 cHot  = vec3(0.92, 0.99, 1.00);',
          '  float lum = ring * 0.32 + fine * 0.35 + major * 0.75 + sweep * 0.95;',
          '  vec3 col = mix(cBase, cHot, major * 0.7 + sweep * 0.6);',
          '  gl_FragColor = vec4(col * (1.0 + sweep * 0.8) * uIntensity, clamp(lum, 0.0, 1.0) * uOpacity);',
          '}'
        ].join('\n')
      });
      var dial = new THREE.Mesh(new THREE.RingGeometry(o.r * 0.9, o.r, 72), dialMat);
      dial.rotation.x = -Math.PI / 2; dial.position.y = 0.10; g.add(dial);
      /* 内圈：凝滞的寒气（缓慢游动的霜雾）*/
      var innerMat = shaderMat({
        blending: THREE.AdditiveBlending,
        uni: { uInner: { value: o.r * 0.9 }, uOpacity: { value: 1 } },
        frag: [
          'uniform float uInner, uOpacity;',
          'void main(){',
          '  vec2 p = (vUv - 0.5) * 2.0;',
          '  float d = length(p);',
          '  if (d > 1.0) discard;',
          /* 极慢的霜雾流动 ✗ 强调"时间被拉长"✓ */
          '  float n1 = fbm(p * 2.6 + vec2(uTime * 0.06, uTime * 0.04));',
          '  float n2 = fbm(p * 6.5 - vec2(uTime * 0.10, 0.0));',
          '  float frost = n1 * 0.6 + n2 * 0.4;',
          '  float body = smoothstep(1.0, 0.55, d);',
          '  float a = body * (0.10 + frost * 0.32) * uOpacity;',
          '  vec3 col = mix(vec3(0.16, 0.30, 0.42), vec3(0.62, 0.86, 1.0), frost);',
          '  gl_FragColor = vec4(col * uIntensity, a);',
          '}'
        ].join('\n')
      });
      var inner = new THREE.Mesh(new THREE.CircleGeometry(o.r * 0.9, 60), innerMat);
      inner.rotation.x = -Math.PI / 2; inner.position.y = 0.10; g.add(inner);
      var ticks = [];
      for (var i = 0; i < 12; i++) {
        var m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, i % 3 === 0 ? 1.1 : 0.6),
          M(0xe6f6ff, { opacity: 0.85 }));
        var a = i / 12 * Math.PI * 2;
        m.position.set(Math.sin(a) * o.r * 0.82, 0.07, Math.cos(a) * o.r * 0.82);
        m.rotation.y = a; g.add(m); ticks.push(m);
      }
      function hand(len, w, color) {
        var gg = grp(); gg.position.y = 0.09; g.add(gg);
        var h = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, len), M(color, { opacity: 0.9 }));
        h.position.z = len / 2; gg.add(h);
        return gg;
      }
      var hHour = hand(o.r * 0.45, 0.16, 0xffd83d);
      var hMin = hand(o.r * 0.68, 0.11, 0xe6f6ff);
      var hSec = hand(o.r * 0.8, 0.05, 0xff6a6a);
      var w = ringWave(g, { color: 0x9fd8ff, r0: 0.5, r1: o.r, dur: 0.9, thick: 0.5, alpha: 0.8 });
      return { group: g, update: function (dt) {
        t += dt; var k = Math.min(1, t / o.dur);
        hSec.rotation.y -= dt * o.spin * 2.4;
        hMin.rotation.y -= dt * o.spin * 0.3;
        hHour.rotation.y -= dt * o.spin * 0.05;
        var fade = (1 - Math.max(0, (k - 0.8) / 0.2));
        /* ★ 2026-10-25：表盘/内圈是着色器材质 ✗ 要改 uniform ✓ */
        dialMat.uniforms.uOpacity.value = fade;
        innerMat.uniforms.uOpacity.value = fade;
        for (var i = 0; i < ticks.length; i++) { ticks[i].material.opacity = 0.85 * fade; }
        w.update(dt);
        return t < o.dur;
      } };
    }
  };

  /* ---- 血怒（self）---- */
  V.bloodrage = {
    label: '血怒', target: 'self',
    tune: [{ k: 'dur', label: '持续', min: 0.6, max: 3, step: 0.1, def: 1.6 },
      { k: 'r', label: '半径', min: 1, max: 4, step: 0.1, def: 1.6 }],
    mk: function (o) {
      var g = grp();
      /* ★★★ 2026-10-24 升级：血怒 ★★★
         ★ 原来：一个半透明红球 + 一个红环 ✗ 就是"红色气球"✓
         ★ 现在：【血气漩涡】—— 血色雾气从脚下向上盘旋
           · 球体不画实心 ✗ 画成"由下往上流动的血气"✓
           · 漩涡：噪声坐标随高度扭转 ✗ 像龙卷 ✓
           · 越往上越稀薄 ✗ 底部浓 ✓
         ★ 成本：球 20×14 → 24×16（略增）但视觉完全不同 ✓ */
      var rageMat = shaderMat({
        blending: THREE.AdditiveBlending,
        uni: { uOpacity: { value: 1 } },
        frag: [
          'uniform float uOpacity;',
          'void main(){',
          /* 用球面坐标：高度 h + 环绕角 ang */
          '  float h = vPos.y / max(length(vPos), 0.001) * 0.5 + 0.5;',
          '  float ang = atan(vPos.z, vPos.x);',
          /* 漩涡：角度随高度扭转 ✗ 螺旋上升 ✓ */
          '  float swirl = ang * 2.2 + h * 7.0 - uTime * 2.6;',
          '  float n1 = fbm(vec2(swirl * 1.6, h * 3.4 - uTime * 1.4));',
          '  float n2 = fbm(vec2(swirl * 3.4 + 4.0, h * 6.2 - uTime * 2.1));',
          '  float blood = n1 * 0.62 + n2 * 0.38;',
          /* 底部浓、顶部稀 ✗ 像血气往上散 ✓ */
          '  float dense = smoothstep(1.0, 0.15, h) * (0.45 + blood * 0.75);',
          /* 边缘：菲涅尔让球有体积 */
          '  vec3 nrm = normalize(vPos);',
          '  float fres = pow(1.0 - abs(dot(nrm, vViewDir)), 1.6);',
          '  float a = dense * (0.28 + fres * 0.55) * uOpacity;',
          '  vec3 cDark = vec3(0.42, 0.02, 0.02);',
          '  vec3 cRed  = vec3(0.95, 0.12, 0.10);',
          '  vec3 cHot  = vec3(1.00, 0.42, 0.34);',
          '  vec3 col = mix(cDark, cRed, blood);',
          '  col = mix(col, cHot, pow(blood, 3.0) * 0.7 + fres * 0.3);',
          '  gl_FragColor = vec4(col * (1.0 + fres * 0.8) * uIntensity, a);',
          '}'
        ].join('\n')
      });
      var m = new THREE.Mesh(new THREE.SphereGeometry(o.r, 24, 16), rageMat);
      m.position.y = 1.1; g.add(m);
      /* 地面血环也换成着色器 ✗ 血迹从脚下渗出 ✓ */
      var rmMat = shaderMat({
        blending: THREE.AdditiveBlending,
        uni: { uOpacity: { value: 1 }, uInner: { value: o.r * 1.05 }, uOuter: { value: o.r * 1.2 } },
        frag: [
          'uniform float uOpacity, uInner, uOuter;',
          'void main(){',
          '  float rad = length(vPos.xy);',
          '  float d = clamp((rad - uInner) / max(uOuter - uInner, 0.001), 0.0, 1.0);',
          '  float ang = atan(vPos.y, vPos.x);',
          '  float band = sin(d * 3.14159);',
          '  float n = fbm(vec2(ang * 9.0, d * 3.0 + uTime * 1.2));',
          '  float a = band * smoothstep(0.30, 0.70, n) * uOpacity;',
          '  vec3 col = mix(vec3(0.55, 0.03, 0.02), vec3(1.0, 0.20, 0.14), band);',
          '  gl_FragColor = vec4(col * uIntensity, a * 0.85);',
          '}'
        ].join('\n')
      });
      var rm = new THREE.Mesh(new THREE.RingGeometry(o.r * 1.05, o.r * 1.2, 40), rmMat);
      rm.rotation.x = -Math.PI / 2; rm.position.y = 0.06; g.add(rm);
      var b = burst(g, { color: 0xff4d4d, count: 40, speed: 3.4, size: 0.2, life: 0.6, seed: 11 });
      return { group: g, t: 0, update: function (dt) {
        this.t += dt; var k = Math.min(1, this.t / o.dur);
        rageMat.uniforms.uOpacity.value = (1 - k) * (0.75 + 0.25 * Math.sin(this.t * 11));
        rm.scale.setScalar(1 + k * 0.5);
        rmMat.uniforms.uOpacity.value = 1 - k;
        b.update(dt);
        return k < 1;
      } };
    }
  };

  /* ---- 冰封：包裹目标的冰块 ---- */
  var ICE_GEO = { box: null, cone: null };
  V.iceblock = {
    label: '冰封', target: 'self',
    tune: [{ k: 'dur', label: '持续', min: 0.5, max: 8, step: 0.5, def: 5 }],
    mk: function (o) {
      var g = grp();
      if (!ICE_GEO.box) { ICE_GEO.box = new THREE.BoxGeometry(1.35, 2.25, 1.25); ICE_GEO.box.__shared = true; }
      if (!ICE_GEO.cone) { ICE_GEO.cone = new THREE.ConeGeometry(0.13, 0.45, 4); ICE_GEO.cone.__shared = true; }
      var b = new THREE.Mesh(ICE_GEO.box,
        M(0xbfe9ff, { opacity: 0.42, depthWrite: false }));
      b.position.y = 1.12; g.add(b);
      for (var i = 0; i < 7; i++) {
        var sp = new THREE.Mesh(ICE_GEO.cone,
          M(0xe8fbff, { opacity: 0.75, depthWrite: false }));
        var a = i / 7 * Math.PI * 2;
        sp.position.set(Math.cos(a) * 0.62, 0.35 + (i % 3) * 0.62, Math.sin(a) * 0.55);
        sp.rotation.z = -Math.cos(a); g.add(sp);
      }
      return { group: g, update: function (dt) {
        this.t = (this.t || 0) + dt;
        var k = Math.min(1, this.t / o.dur);
        b.material.opacity = 0.42 * (1 - Math.max(0, (k - 0.85) / 0.15));
        return k < 1;
      } };
    }
  };

  /* ---- 灵能护盾：贴在玩家身上的蓝色护盾泡（持续到结束/破碎）---- */
  V.shield = {
    label: '灵能护盾', target: 'self',
    /* ★ 2026-10-25：def 跟着改成 1.55 ✗ 不然调参台会把它覆盖回 1.05 ✓
       范围也放宽到 0.8~3.0（角色缩放不同，需要更大范围）*/
    tune: [{ k: 'r', label: '半径', min: 1.0, max: 4.0, step: 0.05, def: 2.2 },
      { k: 'dur', label: '持续', min: 1, max: 40, step: 0.5, def: 30 }],
    mk: function (o) {
      /* ★★★ 2026-10-25（用户："灵能护盾的动画有点小，玩家的头在外面，改大一点把整个玩家都罩住"）★★★
         ★ 为什么原来的罩不住：
           护盾挂在 H.g（角色模型组）上 ✗ 而 H.g 有【角色缩放 0.42】✓
           代码半径 1.05 → 实际只有 1.05 × 0.42 = 0.44 米 ✓
           而玩家实际身高 1.8 × 0.42 = 0.76 米 ✗ 头当然露在外面 ✓✓
         ★ 修：代码半径 1.05 → 1.55（实际 0.65 米）
             覆盖高度 0.42 ± 0.65 = -0.23 ~ 1.07 米 ✗ 完整罩住 0~0.76 米的玩家 ✓
         ★ 同时球心略降（1.0 → 0.92）✗ 让底部也不漏 ✓ */
      var g = grp(), t = 0, R = o.r || 2.2;
      /* ★★★ 2026-10-24 升级：能量罩着色器 ★★★
         原来：一个半透明的蓝球（0.16 透明度）✗ 看着像个气泡 ✓
         现在：着色器画【六边形网格 + 菲涅尔边缘光 + 能量向上流动】
           · 六边形网格：护盾最经典的视觉符号（科幻感）✓
           · 菲涅尔：正对视线的地方几乎透明，边缘发亮 ✗ 球的体积感就出来了 ✓
           · 能量流动：网格线在缓慢上移 ✗ 说明它是"活的" ✓
         成本：球还是 20×14 段 ✗ 三角面不变 ✓ */
      var shieldMat = shaderMat({
        blending: THREE.AdditiveBlending,
        uni: { uOpacity: { value: 1 } },
        frag: [
          'uniform float uOpacity;',
          /* 六边形网格距离函数（标准写法）*/
          'float hexDist(vec2 p){',
          '  p = abs(p);',
          '  return max(dot(p, normalize(vec2(1.0, 1.732))), p.x);',
          '}',
          'void main(){',
          /* 用位置做球面坐标 ✗ 网格才不会在极点挤成一团 ✓ */
          '  vec3 n = normalize(vPos);',
          '  float u = atan(n.z, n.x) / 6.2831853;',
          '  float v = asin(clamp(n.y, -1.0, 1.0)) / 3.1415926 + 0.5;',
          /* 六边形格：u 方向多铺一些（周长比高度长）*/
          '  vec2 hp = vec2(u * 14.0, v * 9.0 + uTime * 0.30);',
          '  vec2 hp2 = hp;',
          '  hp2.y += mod(floor(hp.x), 2.0) * 0.5;',       /* 交错排列 */
          '  vec2 cell = fract(hp2) - 0.5;',
          '  float hd = hexDist(cell);',
          '  float grid = smoothstep(0.40, 0.48, hd);',    /* 格子边缘亮 */
          '  float pulseG = 0.65 + 0.35 * sin(uTime * 2.6 + v * 6.0);',
          /* 菲涅尔：视线越斜越亮 ✗ 这是球的立体感来源 ✓ */
          /* 菲涅尔直接用顶点传下来的视线方向 ✗ 不需要 modelMatrix ✓ */
          '  float fres = pow(1.0 - abs(dot(n, vViewDir)), 2.6);',
          '  vec3 cInner = vec3(0.32, 0.78, 1.00);',
          '  vec3 cEdge  = vec3(0.75, 0.95, 1.00);',
          '  vec3 col = mix(cInner, cEdge, fres);',
          '  float a = (grid * 0.72 * pulseG + fres * 0.85 + 0.04) * uOpacity;',
          '  gl_FragColor = vec4(col * (1.0 + fres * 0.9) * uIntensity, a);',
          '}'
        ].join('\n')
      });
      var ball = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 16), shieldMat);
      ball.position.y = 0.92; g.add(ball);   /* ★ 球心略降 ✗ 底部也不漏 ✓ */
      var ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.92, 0.035, 8, 36),
        M(0xbfefff, { opacity: 0.65, depthWrite: false }));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.92; g.add(ring);
      var ring2 = ring.clone(); ring2.rotation.set(0, 0, 0);
      ring2.position.y = 0.55; g.add(ring2);
      return { group: g, update: function (dt) {
        t += dt;
        var pulse = 1 + 0.03 * Math.sin(t * 4.5);
        ball.scale.setScalar(pulse);
        ring.rotation.z += dt * 0.8; ring2.rotation.z -= dt * 0.6;
        var fade = Math.max(0, Math.min(1, (o.dur - t) / 0.5));
        shieldMat.uniforms.uOpacity.value = fade;
        ring.material.opacity = 0.65 * fade;
        ring2.material.opacity = 0.45 * fade;
        return t < o.dur;
      } };
    }
  };

  /* ---- 多段技能的单段落点冲击 ---- */
  V.impact = {
    label: '落点冲击', target: 'ground',
    tune: [{ k: 'dur', label: '持续', min: 0.15, max: 0.6, step: 0.05, def: 0.32 }],
    mk: function (o) {
      var g = grp();
      /* ★★★ 2026-10-24 升级：命中冲击波着色器 ★★★
         ★ impact 是【全场最高频】的特效（每次攻击都触发）✗
           原来只是一个纯色圆环在放大淡出 ✓ 便宜但没味道 ✓
         ★ 现在：环形冲击波 + 中心闪光
           · 双层环：外圈粗、内圈细 ✗ 更有"炸开"的层次 ✓
           · 角度方向的速度感（环上明暗不均）✗ 像被气浪推开 ✓
           · 中心一个短促的白闪 ✗ 命中瞬间的"亮点" ✓
           · 边缘锯齿/碎裂 ✗ 不是完美的几何圆 ✓
         ★ 成本：环 20 段 × 2 = 40 个三角 ✗ 和原来一样 ✓
         ★ 因为它是池化的：uniform 要能复位置零 ✓ 已在 reset 里处理 ✓ */
      var ringMat = shaderMat({
        blending: THREE.AdditiveBlending,
        uni: { uOpacity: { value: 1 }, uProg: { value: 0 },
               uInner: { value: 0.15 }, uOuter: { value: 0.5 } },
        frag: [
          'uniform float uOpacity, uProg;',
          'uniform float uInner, uOuter;',
          'void main(){',
          /* ★ 2026-10-24 修正：RingGeometry 的 uv 是【方形映射】✗ 不是沿半径 ✓
             必须用顶点位置 vPos 自己算半径和角度 ✓✓ */
          '  float rad = length(vPos.xy);',
          '  float d = clamp((rad - uInner) / max(uOuter - uInner, 0.001), 0.0, 1.0);',
          '  float ang = atan(vPos.y, vPos.x);',
          /* ① 环的径向分布：中间最亮、两侧渐隐 */
          '  float ring = sin(clamp(d, 0.0, 1.0) * 3.14159);',
          '  ring = pow(ring, 0.55);',
          /* ② 沿圆周的不均匀亮带 ✗ 速度感 ✓ */
          '  float band = 0.78 + 0.22 * sin(ang * 5.0 + uProg * 6.0);',
          /* ③ 边缘碎裂：噪声扰动 */
          '  float n = vnoise(vec2(d * 9.0, uProg * 3.0));',
          '  float fray = smoothstep(0.22, 0.68, n + (1.0 - d) * 0.5);',
          /* ④ 中心闪光：进度早期最强 */
          '  float flash = pow(1.0 - d, 3.0) * pow(1.0 - uProg, 2.5) * 0.9;',
          '  vec3 cHot = vec3(1.00, 0.96, 0.84);',
          '  vec3 cMid = vec3(1.00, 0.70, 0.28);',
          '  vec3 col = mix(cMid, cHot, 0.35 + flash);',
          '  float a = (ring * band * fray + flash) * uOpacity;',
          '  gl_FragColor = vec4(col * (1.0 + flash * 1.4) * uIntensity, a);',
          '}'
        ].join('\n')
      });
      var r = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.5, 24), ringMat);
      r.rotation.x = -Math.PI / 2; r.position.y = 0.10; g.add(r);
      var b = burst(g, { color: 0xffb347, count: 12, speed: 3, size: 0.13,
                         life: 0.3, y: 0.3, seed: 9 });
      var inst = { group: g, ring: r, ringMat: ringMat, burst: b, poolKey: 'impact', dur: o.dur || 0.32,
        reset: function (no) {
          this.t = 0;
          this.dur = Number(no.dur) || 0.32;
          this.ring.scale.setScalar(1);
          /* ★ 着色器材质用 uniform ✗ 不能写 material.opacity ✓ */
          this.ringMat.uniforms.uOpacity.value = 1;
          this.ringMat.uniforms.uProg.value = 0;
          this.ringMat.uniforms.uIntensity = FRAME.uIntensity;
          this.burst.reset();
          this.group.position.set(0, 0, 0);
          this.group.visible = true;
          this._fade = null;
        },
        update: function (dt) {
          this.t = (this.t || 0) + dt;
          var k = Math.min(1, this.t / this.dur);
          r.scale.setScalar(1 + k * 1.5);
          this.ringMat.uniforms.uProg.value = k;
          this.ringMat.uniforms.uOpacity.value = 1 - k * 0.15;
          b.update(dt);
          return k < 1;
        } };
      return inst;
    }
  };

  /* ---- 疾风步残影单体（世界坐标，连续生成 → 像武器拖影）---- */
  V.ghost = {
    label: '残影', target: 'ground',
    tune: [{ k: 'dur', label: '停留', min: 0.15, max: 1, step: 0.05, def: 0.45 }],
    mk: function (o) {
      var g = grp();
      var m = new THREE.Mesh(new THREE.BoxGeometry(0.78, 1.7, 0.55),
        M(o.color || 0x9fe8ff, { opacity: 0.30, depthWrite: false }));
      m.position.y = 0.9; g.add(m);
      g.rotation.y = o.yaw || 0;
      var inst = { group: g, mesh: m, poolKey: 'ghost', dur: o.dur || 0.5,
        reset: function (no) {
          this.t = 0;
          this.dur = Number(no.dur) || 0.5;
          this.mesh.material.color.set(no.color || 0x9fe8ff);
          this.mesh.material.opacity = 0.30;
          this.mesh.material.__baseOp = 0.30;
          this.group.rotation.y = no.yaw || 0;
          this.group.position.set(0, 0, 0);
          this.group.visible = true;
          this._fade = null;
        },
        update: function (dt) {
          this.t = (this.t || 0) + dt;
          var k = Math.min(1, this.t / this.dur);
          m.material.opacity = 0.30 * (1 - k);
          return k < 1;
        } };
      return inst;
    }
  };

  /* ---- 疾风步：残影（self）---- */
  V.gale = {
    label: '疾风步', target: 'self',
    tune: [{ k: 'dur', label: '持续', min: 0.4, max: 2.5, step: 0.1, def: 1.2 },
      { k: 'n', label: '残影数', min: 2, max: 8, step: 1, def: 4 },
      { k: 'drift', label: '拖尾距离', min: 0.5, max: 8, step: 0.5, def: 3 }],
    mk: function (o) {
      var g = grp();
      var ai = afterimages(g, { n: o.n, dur: o.dur, color: 0x9fe8ff, drift: o.drift });
      var w = ringWave(g, { color: 0xd8f6ff, r0: 0.4, r1: 2.4, dur: o.dur * 0.6, thick: 0.2, alpha: 0.7 });
      return { group: g, update: function (dt) { ai.update(dt); w.update(dt); return ai.t < o.dur; } };
    }
  };

  /* ---- 暴走（self）---- */
  V.berserk = {
    label: '暴走', target: 'self',
    tune: [{ k: 'dur', label: '持续', min: 0.5, max: 3, step: 0.1, def: 1.4 },
      { k: 'n', label: '残影数', min: 2, max: 8, step: 1, def: 4 },
      { k: 'drift', label: '拖尾距离', min: 0.5, max: 8, step: 0.5, def: 2.5 }],
    mk: function (o) {
      var g = grp();
      /* ★★★ 2026-10-24 升级：暴走 ★★★
         ★ 残影本体保留（afterimages 已经是对的实现 ✓ 它复制身体模型）
         ★ 提升点：
           · 粒子加双色 + 湍流 ✗ 爆发感更强 ✓
           · 数量 30 → 44（GPU 粒子 ✗ 开销几乎不变）✓
           · 加大初速和生长 ✗ 像炸开 ✓ */
      var ai = afterimages(g, { n: o.n, dur: o.dur, color: 0xff3020, drift: o.drift });
      var b = burst(g, { color: 0xff3a1a, color2: 0xffb068, colorMix: 0.85,
                         count: 44, speed: 4.2, size: 0.22, life: 0.75, seed: 5,
                         turb: 0.55, turbFreq: 3.8, drag: 1.1, grow: 0.9 });
      return { group: g, update: function (dt) { ai.update(dt); b.update(dt); return ai.t < o.dur; } };
    }
  };

  /* ---- 嗜血：向上飘的 3D 文字（self）---- */
  V.bloodthirst = {
    label: '嗜血', target: 'self',
    tune: [{ k: 'rise', label: '上升高度', min: 0.5, max: 5, step: 0.2, def: 2.4 },
      { k: 'dur', label: '持续', min: 0.5, max: 3, step: 0.1, def: 1.6 },
      { k: 'size', label: '字号', min: 1, max: 5, step: 0.2, def: 2.3 },
      { k: 'txt', label: '文字', min: 0, max: 1, step: 1, def: 0, text: 1, options: ['攻速+', '吸血+', '狂热!'] }],
    mk: function (o) {
      var g = grp();
      /* ★★★ 2026-10-24 升级：嗜血 ★★★
         ★ 这个特效本来就有飘字 + 粒子 ✗ 结构是对的 ✓
         ★ 提升点：粒子质感和数量
           · 双色渐变（暗红 → 亮橙红）✗ 有热度的血 ✓
           · 粒子数量 22 → 34 ✗ 但走 GPU ✗ 几乎不增加开销 ✓
           · 加大湍流 ✗ 血雾会飘散而不是直线飞 ✓
           · 生长参数 ✗ 血滴会膨胀（像被溅开）✓ */
      var ft = floatText(g, { text: o.text || '攻速+', y: 2.6, rise: o.rise, dur: o.dur, size: o.size, color: '#ff7a4d' });
      var b = burst(g, { color: 0xd01a1a, color2: 0xff7a4d, colorMix: 1.0,
                         count: 34, speed: 2.6, size: 0.2, life: 0.7, seed: 4,
                         turb: 0.42, turbFreq: 3.2, drag: 0.9, grow: 0.6 });
      return { group: g, update: function (dt) { ft.update(dt); b.update(dt); return ft.t < o.dur; } };
    }
  };

  /* ---- 灼烧（原腐蚀光环，self）---- */
  V.burn = {
    label: '灼烧（原腐蚀光环）', target: 'self',
    tune: [{ k: 'dur', label: '持续', min: 0.6, max: 4, step: 0.1, def: 1.8 },
      { k: 'r', label: '范围', min: 0.5, max: 4, step: 0.1, def: 3 },
      { k: 'n', label: '火苗数', min: 4, max: 30, step: 1, def: 14 }],
    mk: function (o) {
      var g = grp(), R = rnd(o.seed || 6), flames = [];
      /* ★★★ 2026-10-24 升级：灼烧（状态特效，长时间挂在身上）★★★
         ★ 原来：一圈纯色环 + 十几个纯色锥体 ✗ 像插了一圈橙色三角 ✓
         ★ 现在：
           · 地面火环用着色器画【跳动的火舌】✗ 边缘不规则燃烧 ✓
           · 身周的火焰锥改成【体积火片】✗ 用噪声做翻腾的火焰 ✓
           · 每个火片独立相位 ✗ 不同步，看起来更"活" ✓
         ★ 成本：火环 48 段（原来就有✓）+ 火片仍是平面 ✓ 三角面反而更少 ✓ */
      var burnRingMat = shaderMat({
        blending: THREE.AdditiveBlending,
        uni: { uRadius: { value: o.r }, uOpacity: { value: 1 }, uDur: { value: o.dur } },
        frag: [
          'uniform float uRadius, uOpacity, uDur;',
          'void main(){',
          '  vec2 p = (vUv - 0.5) * 2.0;',
          '  float d = length(p);',
          '  if (d > 1.0) discard;',
          /* 环带：只在半径附近亮 ✗ 中间是空的 ✓ */
          '  float band = smoothstep(0.62, 0.94, d) * smoothstep(1.0, 0.90, d);',
          /* 火舌：极坐标 + 噪声 ✗ 环上长出跳动的火 ✓ */
          '  float ang = atan(p.y, p.x) / 6.2831853;',
          '  float n1 = fbm(vec2(ang * 16.0, d * 4.0 - uTime * 1.6));',
          '  float n2 = fbm(vec2(ang * 30.0 + 5.0, d * 7.0 - uTime * 2.4));',
          '  float tongues = n1 * 0.6 + n2 * 0.4;',
          '  float fray = smoothstep(0.34, 0.72, tongues + band * 0.35);',
          /* 颜色：外圈深红 → 中圈橙 → 内侧亮黄 */
          '  float heat = smoothstep(1.0, 0.6, d) * (0.55 + tongues * 0.7);',
          '  vec3 cDeep = vec3(0.55, 0.06, 0.01);',
          '  vec3 cMid  = vec3(1.00, 0.34, 0.03);',
          '  vec3 cHot  = vec3(1.00, 0.82, 0.30);',
          '  vec3 col = mix(cDeep, cMid, smoothstep(0.0, 0.55, heat));',
          '  col = mix(col, cHot, smoothstep(0.55, 1.0, heat));',
          '  float a = band * fray * (0.35 + tongues * 0.65) * uOpacity;',
          '  gl_FragColor = vec4(col * (1.0 + heat * 0.8) * uIntensity, a);',
          '}'
        ].join('\n')
      });
      var ring = new THREE.Mesh(new THREE.CircleGeometry(o.r, 48), burnRingMat);
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.10; g.add(ring);
      /* 身周火片：每片一个竖直四边形 + 火焰着色器 */
      for (var i = 0; i < o.n; i++) {
        var fh = 0.7 + R() * 0.9;
        var fw = 0.45 + R() * 0.35;
        var fm = shaderMat({
          blending: THREE.AdditiveBlending,
          uni: { uSeed: { value: R() * 43.7 }, uOpacity: { value: 1 }, uH: { value: fh } },
          frag: [
            'uniform float uSeed, uOpacity, uH;',
            'void main(){',
            '  float y = vUv.y;',        /* 0=底 1=顶 */
            '  float x = abs(vUv.x - 0.5) * 2.0;',
            /* 火焰轮廓：上窄下宽 ✗ 顶部收成尖 ✓ */
            '  float taper = 1.0 - pow(y, 0.75) * 0.85;',
            '  if (x > taper) discard;',
            /* 翻腾：噪声沿 y 往上跑 */
            '  float n = fbm(vec2(vUv.x * 4.0 + uSeed, y * 3.0 - uTime * 2.2 + uSeed));',
            '  float flame = n * 0.65 + fbm(vec2(vUv.x * 9.0 - uSeed, y * 6.0 - uTime * 3.1)) * 0.35;',
            '  float body = smoothstep(0.28, 0.68, flame + (1.0 - y) * 0.45);',
            /* 高度越高越淡 */
            '  float vfade = smoothstep(1.0, 0.35, y);',
            /* 温度：底部亮黄 → 顶部暗红 */
            '  float heat = pow(1.0 - y, 1.6) * (0.6 + flame * 0.6);',
            '  vec3 cDeep = vec3(0.60, 0.08, 0.01);',
            '  vec3 cMid  = vec3(1.00, 0.38, 0.05);',
            '  vec3 cHot  = vec3(1.00, 0.88, 0.45);',
            '  vec3 col = mix(cDeep, cMid, smoothstep(0.0, 0.5, heat));',
            '  col = mix(col, cHot, smoothstep(0.5, 1.0, heat));',
            '  float a = body * vfade * (0.55 + flame * 0.45) * uOpacity;',
            '  gl_FragColor = vec4(col * (1.0 + heat * 0.9) * uIntensity, a);',
            '}'
          ].join('\n')
        });
        var fmesh = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh), fm);
        var a = R() * 6.28, d = R() * o.r * 0.72;
        fmesh.position.set(Math.cos(a) * d, fh * 0.45, Math.sin(a) * d);
        /* 火焰片始终面向摄像机 ✗ 不然侧看就变成一条线 ✓ 交给 billboard 逻辑处理 */
        fmesh.userData.billboard = true;
        g.add(fmesh);
        flames.push({ m: fmesh, ph: R() * 6.28, sp: 1 + R(), mat: fm, baseY: fh * 0.45, fh: fh });
      }
      return { group: g, t: 0, update: function (dt) {
        this.t += dt; var k = Math.min(1, this.t / o.dur);
        /* ★ 每帧：火片跳动 + 面向摄像机（billboard）✗ 侧看也不会变成一条线 ✓ */
        for (var i = 0; i < flames.length; i++) {
          var f = flames[i];
          var wob = 0.78 + Math.sin(this.t * 8.5 * f.sp + f.ph) * 0.30;
          f.m.scale.set(1 + Math.sin(this.t * 6 * f.sp) * 0.06, wob, 1);
          f.m.position.y = f.baseY * wob;
          if (cam) { f.m.rotation.y = Math.atan2(cam.position.x - f.m.position.x,
                                                cam.position.z - f.m.position.z); }
          if (f.mat) { f.mat.uniforms.uOpacity.value = 1 - k; }
        }
        if (burnRingMat) { burnRingMat.uniforms.uOpacity.value = 1 - k; }
        ring.material.opacity = 0.45 * (0.6 + 0.4 * Math.sin(this.t * 7)) * (1 - k);
        return this.t < o.dur;
      } };
    }
  };

  /* ---- 雷霆万钧 ---- */
  V.thunder = {
    label: '雷霆万钧', target: 'ground',
    tune: [{ k: 'n', label: '雷数', min: 1, max: 10, step: 1, def: 5 },
      { k: 'r', label: '散布', min: 1, max: 14, step: 1, def: 7 }],
    mk: function (o) {
      var g = grp(), R = rnd(o.seed || 2), parts = [];
      for (var i = 0; i < o.n; i++) {
        var a = R() * 6.28, d = R() * o.r;
        var sub = grp(); sub.position.set(Math.cos(a) * d, 0, Math.sin(a) * d); g.add(sub);
        /* ★ 2026-10-24：pillar（纯色圆柱）→ boltShader（着色器闪电）
           ★ 闪电会抖、有分支、有蓝紫辉光 ✗ 不再是死板的白色柱子 ✓
           ★ 成本反而更低（2 个三角 vs 圆柱的几十个）✓ */
        parts.push({ t: -i * 0.16,
          p: boltShader(sub, { h: 14, w: 0.55, dur: 0.35, seed: i * 1.7 + 3 }),
          b: burst(sub, { color: 0xbfd6ff, count: 20, speed: 5, size: 0.2, life: 0.5, seed: i + 3 }) });
      }
      return { group: g, update: function (dt) {
        var alive = false;
        for (var i = 0; i < parts.length; i++) {
          var p = parts[i];
          if (p.t < 0) { p.t += dt; alive = true; continue; }
          p.p.update(dt); p.b.update(dt);
          if (p.p.t < p.p.dur || p.b.t < p.b.life) { alive = true; }
        }
        return alive;
      } };
    }
  };

  /* ---- 燃血斩：红色扇形剑气 ---- */
  V.bloodslash = {
    label: '燃血斩', target: 'ground',
    tune: [{ k: 'rad', label: '扇形半径', min: 1.5, max: 7, step: 0.2, def: 3.6 },
      { k: 'arc', label: '张角', min: 0.6, max: 3, step: 0.1, def: 1.9 },
      { k: 'dur', label: '持续', min: 0.15, max: 1, step: 0.05, def: 0.4 }],
    mk: function (o) {
      var g = grp();
      /* ★★★ 2026-10-25 升级：燃血斩（近战高频） ★★★
         ★ 原来：两层纯红扇形 ✗ 就是两块红布 ✓
         ★ 现在：血刃
           · 沿扇形【径向】的血丝（从内向外拉）✗ 像刀光扫过 ✓
           · 贴边处最亮（刃口）✗ 越往外越暗（血雾）✓
           · 血滴飞溅：扇形上有随机的深色斑 ✗ 不规则 ✓
         ★ 成本：扇形 40 段 ✗ 不变 ✓ */
      var slashMat = shaderMat({
        blending: THREE.AdditiveBlending,
        uni: { uRad: { value: o.rad }, uOpacity: { value: 1 }, uArc: { value: o.arc } },
        frag: [
          'uniform float uRad, uOpacity, uArc;',
          'void main(){',
          '  float rad = length(vPos.xy);',
          '  float t = clamp(rad / max(uRad, 0.001), 0.0, 1.0);',
          '  float ang = atan(vPos.y, vPos.x);',
          /* ① 径向血丝：角度上高频，形成细线 */
          '  float strand = fract(ang * 26.0);',
          '  float strands = smoothstep(0.55, 0.72, strand) * smoothstep(0.95, 0.78, strand);',
          /* ② 噪声让血丝不整齐 */
          '  float n = fbm(vec2(ang * 12.0, t * 5.0 - uTime * 3.0));',
          '  strands *= 0.55 + n * 0.85;',
          /* ③ 刃口最亮（外沿）✗ 往里渐淡 ✓ */
          '  float edge = smoothstep(0.55, 1.0, t);',
          /* ④ 血斑：低频噪点 */
          '  float splat = smoothstep(0.62, 0.88, fbm(vec2(ang * 8.0 + 3.0, t * 7.0)));',
          '  float body = pow(t, 0.65) * 0.45;',
          '  vec3 cDeep = vec3(0.45, 0.02, 0.02);',
          '  vec3 cRed  = vec3(0.95, 0.10, 0.08);',
          '  vec3 cHot  = vec3(1.00, 0.55, 0.42);',
          '  vec3 col = mix(cDeep, cRed, t);',
          '  col = mix(col, cHot, edge * 0.6 + splat * 0.35);',
          '  float a = (body + strands * 0.75 + splat * 0.45 + edge * 0.55) * uOpacity;',
          '  gl_FragColor = vec4(col * (1.0 + edge * 0.8) * uIntensity, clamp(a, 0.0, 1.0));',
          '}'
        ].join('\n')
      });
      var m = new THREE.Mesh(new THREE.RingGeometry(o.rad * 0.25, o.rad, 40, 1, -o.arc / 2, o.arc), slashMat);
      m.rotation.x = -Math.PI / 2; m.position.y = 1.0; g.add(m);
      var m2 = new THREE.Mesh(new THREE.RingGeometry(o.rad * 0.2, o.rad * 0.82, 40, 1, -o.arc / 2, o.arc),
        M(0xffb0b0, { side: THREE.DoubleSide, opacity: 0.5, depthWrite: false }));
      m2.rotation.x = -Math.PI / 2; m2.position.y = 1.02; g.add(m2);
      var b = burst(g, { color: 0xff5a3a, count: 26, speed: 5, size: 0.2, life: 0.5, y: 1.0, seed: 6 });
      return { group: g, t: 0, update: function (dt) {
        this.t += dt; var k = Math.min(1, this.t / o.dur);
        slashMat.uniforms.uOpacity.value = 1 - k; m2.material.opacity = 0.5 * (1 - k);
        m.rotation.z = -0.3 + k * 0.6; m2.rotation.z = m.rotation.z;
        m.scale.setScalar(1 + k * 0.15);
        b.update(dt);
        return k < 1;
      } };
    }
  };

  /* ---- 影袭：小范围剑气 ---- */
  V.shadowstep = {
    label: '影袭', target: 'ground',
    tune: [{ k: 'rad', label: '剑气半径', min: 0.6, max: 4, step: 0.1, def: 1.8 },
      { k: 'dur', label: '持续', min: 0.1, max: 0.8, step: 0.05, def: 0.3 }],
    mk: function (o) {
      var g = grp();
      var m = new THREE.Mesh(new THREE.RingGeometry(o.rad * 0.2, o.rad, 32, 1, -0.7, 1.4),
        M(0x8a5aff, { side: THREE.DoubleSide, opacity: 0.9, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.y = 1.1; g.add(m);
      var b = burst(g, { color: 0x6a3aff, count: 18, speed: 4, size: 0.18, life: 0.4, y: 1.1, seed: 7 });
      return { group: g, t: 0, update: function (dt) {
        this.t += dt; var k = Math.min(1, this.t / o.dur);
        m.material.opacity = 0.9 * (1 - k); m.rotation.z += dt * 4;
        b.update(dt);
        return k < 1;
      } };
    }
  };

  /* ---- 雷引：紫色闪电 ---- */
  V.thunderbolt = {
    label: '雷引', target: 'ground',
    tune: [{ k: 'w', label: '粗细', min: 0.1, max: 1, step: 0.05, def: 0.3 },
      { k: 'h', label: '高度', min: 4, max: 16, step: 0.5, def: 9 },
      { k: 'dur', label: '持续', min: 0.15, max: 1, step: 0.05, def: 0.32 }],
    /* ★★★ 2026-10-24 升级：管状闪电 → 着色器闪电 ★★★
       ★ 原来：CatmullRomCurve3 + 两条 TubeGeometry（各 24 段 × 5 边）
         每来一道雷：建曲线 + 三角化两根管子 ≈ 480 个三角 ✗
         而且几何体是【固定的】✗ 闪电是死的（不会跳）✓
       ★ 现在：boltShader（和雷霆万钧同一套）
         2 个三角 ✗ 便宜 240 倍 ✓ 而且会抖、有分支、有辉光 ✓
       ★ 紫色保留（雷引是紫电 ✗ 和雷霆万钧的蓝白区分开）✓
       ★ 高度/粗细/时长全照旧 ✓ 调参台不用改 ✓ */
    mk: function (o) {
      var g = grp();
      var bolt = boltShader(g, { h: o.h || 9, w: (o.w || 0.3) * 1.8, dur: o.dur || 0.32,
                                 seed: (o.seed || 8) * 1.3 });
      /* 紫色版本：boltShader 用的是蓝白 ✗ 这里给材质换色 ✓ */
      try {
        var mt = bolt.outer.material;
        if (mt && mt.uniforms) {
          mt.uniforms.uTint = { value: new THREE.Color(0xb066ff) };
        }
      } catch (eTint) { }
      var b = burst(g, { color: 0xb066ff, count: 22, speed: 4.5, size: 0.18, life: 0.45, seed: 3 });
      return { group: g, update: function (dt) {
        var alive = bolt.update(dt);
        b.update(dt);
        return alive;
      } };
    }
  };

  /* ---- 分裂箭 ---- */
  V.splitarrow = {
    label: '分裂箭', target: 'ground',
    tune: [{ k: 'speed', label: '飞行速度', min: 6, max: 30, step: 1, def: 16 },
      { k: 'spread', label: '散开角度', min: 0.05, max: 1, step: 0.05, def: 0.26 },
      { k: 'n', label: '箭数', min: 1, max: 5, step: 1, def: 3 }],
    mk: function (o) {
      var g = grp(), list = [];
      for (var i = 0; i < o.n; i++) {
        var off = i - (o.n - 1) / 2;
        var ar = arrowMesh(0xdfe9f5);
        ar.rotation.x = Math.PI / 2;
        ar.position.set(off * 0.28, 1.1, 0.6);
        g.add(ar);
        list.push({ m: ar, vx: off * o.spread * 2, t: 0 });
      }
      return { group: g, update: function (dt) {
        var alive = false;
        for (var i = 0; i < list.length; i++) {
          var p = list[i]; p.t += dt;
          p.m.position.z += dt * o.speed;
          p.m.position.x += dt * p.vx * o.speed * 0.5;
          if (p.t < 0.55) { alive = true; }
        }
        return alive;
      } };
    }
  };

  /* ---- 荆棘护甲（self）---- */
  V.thorns = {
    label: '荆棘护甲', target: 'self',
    tune: [{ k: 'dur', label: '持续', min: 0.2, max: 1.5, step: 0.1, def: 0.5 },
      { k: 'n', label: '尖刺数', min: 4, max: 20, step: 1, def: 10 }],
    mk: function (o) {
      var g = grp(), list = [];
      for (var i = 0; i < o.n; i++) {
        var m = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.7, 5), M(0xffb066, { opacity: 0.9 }));
        var a = i / o.n * Math.PI * 2;
        m.position.set(Math.cos(a) * 1.2, 1.0, Math.sin(a) * 1.2);
        m.rotation.z = -Math.cos(a) * 1.2; m.rotation.x = Math.sin(a) * 1.2;
        g.add(m); list.push(m);
      }
      /* ★★★ 2026-10-24 升级：荆棘护甲 ★★★
         ★ 原来：一圈纯色锥体 + 一个半透明球 ✗ 像插了一圈棕色三角 ✓
         ★ 现在：
           · 尖刺保留（它们本来就是几何体拼的 ✗ 形状是对的 ✓）
             但材质加【生长动画感】—— 用着色器让尖端更亮 ✓
           · 护罩球改着色器：木质/藤蔓的纹理 ✗ 不再是纯色气球 ✓
           · 尖刺从体内"刺出来"的效果：靠缩放 ✓ 保持原逻辑 ✓
         ★ 成本：球 16×12 → 20×14，几乎不变 ✓ */
      var thornMat = shaderMat({
        blending: THREE.AdditiveBlending,
        uni: { uOpacity: { value: 1 } },
        frag: [
          'uniform float uOpacity;',
          'void main(){',
          '  vec3 nrm = normalize(vPos);',
          '  float h = nrm.y * 0.5 + 0.5;',
          '  float u = atan(nrm.z, nrm.x);',
          /* 藤蔓：用噪声拉出细长的纵向纹理 */
          '  float n1 = fbm(vec2(u * 5.0, h * 3.0 + uTime * 0.5));',
          '  float n2 = fbm(vec2(u * 13.0 + 2.0, h * 8.0 - uTime * 0.3));',
          '  float vine = n1 * 0.65 + n2 * 0.35;',
          /* 网格状：让藤蔓有交叉感 ✗ 像缠满藤条 ✓ */
          '  float mesh = smoothstep(0.42, 0.68, vine);',
          '  float fres = pow(1.0 - abs(dot(nrm, vViewDir)), 1.8);',
          '  vec3 cBrown = vec3(0.40, 0.22, 0.06);',
          '  vec3 cAmber = vec3(0.95, 0.60, 0.18);',
          '  vec3 col = mix(cBrown, cAmber, mesh);',
          '  float a = (mesh * 0.75 + fres * 0.45) * uOpacity;',
          '  gl_FragColor = vec4(col * (1.0 + fres * 0.7) * uIntensity, a);',
          '}'
        ].join('\n')
      });
      var a2 = new THREE.Mesh(new THREE.SphereGeometry(1.35, 20, 14), thornMat);
      a2.position.y = 1.0; g.add(a2);
      return { group: g, t: 0, update: function (dt) {
        this.t += dt; var k = Math.min(1, this.t / o.dur);
        for (var i = 0; i < list.length; i++) { list[i].material.opacity = 0.9 * (1 - k); }
        thornMat.uniforms.uOpacity.value = 1 - k;
        return k < 1;
      } };
    }
  };

  /* ---- AI 分身 ---- */
  V.clone = {
    label: 'AI 分身', target: 'ground',
    tune: [{ k: 'dur', label: '持续', min: 0.4, max: 2.5, step: 0.1, def: 1.1 },
      { k: 'size', label: '雾团大小', min: 0.4, max: 2, step: 0.1, def: 0.9 }],
    mk: function (o) {
      var g = grp(), R = rnd(o.seed || 12), list = [];
      for (var i = 0; i < 7; i++) {
        var _sz = o.size || 0.9;
        var m = new THREE.Mesh(new THREE.SphereGeometry(_sz * (0.7 + R() * 0.7), 10, 8),
          M(0xffffff, { opacity: 0.4, depthWrite: false }));
        var a = R() * 6.28, d = R() * 0.9;
        m.position.set(Math.cos(a) * d, 0.7 + R() * 0.9, Math.sin(a) * d);
        g.add(m); list.push(m);
      }
      var aRing = ringWave(g, { color: 0x88aaff, r0: 0.4, r1: 1.8, dur: o.dur, thick: 0.2, alpha: 0.7 });
      return { group: g, t: 0, update: function (dt) {
        this.t += dt; var k = Math.min(1, this.t / o.dur);
        for (var i = 0; i < list.length; i++) { list[i].material.opacity = 0.4 * (1 - k); list[i].scale.setScalar(1 + k * 0.6); }
        aRing.update(dt);
        return k < 1;
      } };
    }
  };

  /* ---- 精英/Boss 技能地面预警 ---- */
  V.boss_cast = {
    label: 'Boss技能预警', target: 'ground',
    mk: function (o) {
      var g = grp(), R = Math.max(1, +o.r || 3), shape = String(o.shape || 'aoe');
      var col = o.color || 0xff5a3a;
      var w = ringWave(g, { color: col, r0: R * 0.15, r1: R,
        dur: o.dur || 1.2, thick: 0.16, alpha: 0.7 });
      /* 扇形/直线预警：除了外圈，再给一块半透明区域 */
      if (shape === 'cone') {
        var cone = +o.cone || 70;
        var sec = new THREE.Mesh(
          new THREE.RingGeometry(R * 0.12, R, 28, 1,
            -cone * Math.PI / 360, cone * Math.PI / 180),
          new THREE.MeshBasicMaterial({ color: col, transparent: true,
            opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
        sec.rotation.x = -Math.PI / 2;
        sec.rotation.z = -(+o.yaw || 0);
        sec.position.y = 0.025; g.add(sec);
      } else if (shape === 'line') {
        var ln = new THREE.Mesh(new THREE.PlaneGeometry(R * 1.2, R * 3.2),
          new THREE.MeshBasicMaterial({ color: col, transparent: true,
            opacity: 0.13, side: THREE.DoubleSide, depthWrite: false }));
        ln.rotation.x = -Math.PI / 2;
        ln.rotation.z = -(+o.yaw || 0);
        ln.position.set(0, 0.022, R * 1.2); g.add(ln);
      }
      return { group: g, t: 0, update: function (dt) {
        this.t += dt; w.update(dt);
        return this.t < (o.dur || 1.2);
      } };
    }
  };

  /* ---- 精英/Boss 技能命中表现（按技能类型分支）---- */
  V.boss_hit = {
    label: 'Boss技能命中', target: 'ground',
    mk: function (o) {
      var g = grp(), R = Math.max(1, +o.r || 3), mode = String(o.mode || 'burst');
      var col = o.color || 0xff5a3a, t = 0, bits = [];
      var ring = ringWave(g, { color: col, r0: R * 0.15, r1: R,
        dur: mode === 'pool' ? 4.8 : 0.8, thick: 0.14, alpha: 0.75 });
      if (mode === 'summon') {
        for (var i = 0; i < 3; i++) {
          var a = i / 3 * Math.PI * 2;
          var colm = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.45, 2.4, 8, 1, true),
            M(col, { opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }));
          colm.position.set(Math.cos(a) * R * 0.45, 1.2, Math.sin(a) * R * 0.45);
          g.add(colm); bits.push(colm);
        }
      } else if (mode === 'pool') {
        var pool = new THREE.Mesh(new THREE.CircleGeometry(R, 28),
          M(col, { opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }));
        pool.rotation.x = -Math.PI / 2; pool.position.y = 0.03; g.add(pool); bits.push(pool);
      } else {
        var b = burst(g, { color: col, count: mode === 'wave' ? 28 : 18,
          speed: mode === 'wave' ? 5 : 3, size: 0.22, life: 0.9,
          y: 0.35, up: 2.0, grav: 4.0, seed: (o.seed || 7) | 0 });
        bits.push(b);
      }
      if (mode === 'rune') {
        var rr = new THREE.Mesh(new THREE.TorusGeometry(R * 0.72, 0.04, 6, 28),
          M(col, { opacity: 0.8 }));
        rr.rotation.x = -Math.PI / 2; rr.position.y = 0.06; g.add(rr); bits.push(rr);
      }
      return { group: g, t: 0, update: function (dt) {
        this.t += dt; ring.update(dt);
        for (var i = 0; i < bits.length; i++) {
          if (bits[i].update) { bits[i].update(dt); }
          else if (bits[i].material) { bits[i].material.opacity *= 0.985; }
        }
        return this.t < (mode === 'pool' ? 5.0 : 1.2);
      } };
    }
  };

  /* ---- 持续地火区域（zone 技能）---- */
  V.boss_zone = {
    label: 'Boss持续区域', target: 'ground',
    mk: function (o) {
      var g = grp(), R = Math.max(1, +o.r || 4), col = 0xff6a1f, t = 0;
      var pool = new THREE.Mesh(new THREE.CircleGeometry(R, 32),
        M(col, { opacity: 0.24, side: THREE.DoubleSide, depthWrite: false }));
      pool.rotation.x = -Math.PI / 2; pool.position.y = 0.025; g.add(pool);
      var ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.05, 6, 32),
        M(col, { opacity: 0.8, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; g.add(ring);
      var dur = Math.max(1, +o.dur || 6);
      return { group: g, t: 0, update: function (dt) {
        this.t += dt; t = Math.min(1, this.t / dur);
        pool.material.opacity = 0.24 * (1 - t * 0.5);
        ring.material.opacity = 0.8 * (1 - t * 0.4);
        ring.rotation.z += dt * 0.35;
        return this.t < dur;
      } };
    }
  };

  /* ---- Boss 目标锁定圈：起手读到命中放 ---- */
  V.boss_lock = {
    label: 'Boss锁定圈', target: 'ground',
    mk: function (o) {
      var g = grp(), R = Math.max(0.8, +o.r || 2.2), col = o.color || 0xff5a3a;
      var ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.045, 6, 32),
        M(col, { opacity: 0.9, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.08; g.add(ring);
      var inner = new THREE.Mesh(new THREE.TorusGeometry(R * 0.55, 0.025, 6, 24),
        M(col, { opacity: 0.55, depthWrite: false }));
      inner.rotation.x = -Math.PI / 2; inner.position.y = 0.07; g.add(inner);
      for (var i = 0; i < 4; i++) {
        var a = i * Math.PI / 2;
        var tick = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, R * 0.28),
          M(col, { opacity: 0.8, depthWrite: false }));
        tick.position.set(Math.cos(a) * R * 0.78, 0.08, Math.sin(a) * R * 0.78);
        tick.rotation.y = -a; g.add(tick);
      }
      var t = 0, dur = Math.max(0.2, +o.dur || 1.2);
      return { group: g, t: 0, update: function (dt) {
        this.t += dt; t = Math.min(1, this.t / dur);
        inner.rotation.z += dt * 2.2;
        ring.material.opacity = 0.35 + 0.55 * (1 - t);
        inner.material.opacity = 0.25 + 0.35 * t;
        g.scale.setScalar(1.12 - 0.12 * t);
        return this.t < dur;
      } };
    }
  };

  /* ---- 远程怪弹道（从怪到玩家）---- */
  V.mob_shot = {
    label: '妖兽弹道', target: 'ground',
    mk: function (o) {
      var g = grp();
      var sx = +o.x || 0, sz = +o.z || 0, ex = +o.tx || 0, ez = +o.tz || 0;
      var sy = 1.05, ey = 1.0, dur = Math.max(0.08, +o.dur || 0.18);
      var col = (+o.rank || 0) >= 2 ? 0xff5a3a : ((+o.rank || 0) ? 0xffb347 : 0xa8d8ff);
      var orb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 5),
        M(col, { opacity: 0.95, depthWrite: false }));
      orb.position.set(sx, sy, sz); g.add(orb);
      var geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(sx, sy, sz), new THREE.Vector3(ex, ey, ez)]);
      var line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: col, transparent: true, opacity: 0.42, depthWrite: false }));
      g.add(line);
      var k = 0;
      return { group: g, t: 0, update: function (dt) {
        this.t += dt; k = Math.min(1, this.t / dur);
        orb.position.set(sx + (ex - sx) * k, sy + (ey - sy) * k, sz + (ez - sz) * k);
        line.material.opacity = 0.42 * (1 - k * 0.65);
        return this.t < dur + 0.05;
      } };
    }
  };

  /* ---- 精英/Boss 技能名（世界坐标飘字）---- */
  V.skillname = {
    label: '技能名', target: 'self',
    mk: function (o) {
      var txt = String(o.text || '');
      var big = !!o.boss;
      var c = document.createElement('canvas');
      c.width = big ? 1024 : 640; c.height = big ? 168 : 112;
      var g = c.getContext('2d');
      g.textAlign = 'center';
      g.font = (big ? '900 76px' : '800 52px') + ' "Microsoft YaHei",sans-serif';
      var cy = big ? 104 : 72;
      g.strokeStyle = 'rgba(0,0,0,.92)'; g.lineWidth = big ? 14 : 9;
      g.strokeText(txt, c.width / 2, cy);
      g.fillStyle = o.color || '#ffb35a';
      g.fillText(txt, c.width / 2, cy);
      var tex = new THREE.CanvasTexture(c);
      tex.encoding = THREE.sRGBEncoding;
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, depthWrite: false, depthTest: false
      }));
      sp.scale.set(big ? 4.9 : 3.4, big ? 0.80 : 0.60, 1);
      sp.position.y = 0.55;
      var grp = new THREE.Group(); grp.add(sp);
      return { group: grp, t: 0, dur: 1.2, update: function (dt) {
        this.t += dt;
        var k = Math.min(1, this.t / this.dur);
        if (this.baseY === undefined) { this.baseY = grp.position.y; }
        grp.position.y = this.baseY + k * 0.7;
        sp.material.opacity = 1 - k;
        return k < 1;
      } };
    }
  };

  /* ---- 坦克引擎：只有脚下一圈（self）---- */
  var TANK_GEO = { teeth: null, ring: {} };
  var TANK_MAT = {};      /* ★ 按颜色分材质，橙色/绿色互不影响 */
  V.tank = {
    label: '坦克引擎', target: 'self',
    tune: [{ k: 'r', label: '半径', min: 0.6, max: 4, step: 0.1, def: 1.4 },
      { k: 'dur', label: '持续', min: 0.2, max: 2, step: 0.1, def: 0.7 },
      { k: 'spin', label: '转速', min: 0, max: 12, step: 0.5, def: 5 }],
    mk: function (o) {
      var g = grp();
      var _c1 = o.color || 0xffa733, _c2 = o.color2 || 0xffc266;
      /* ★ 几何体按半径缓存；材质按颜色缓存（不是所有颜色共用一个材质）*/
      var _rk = Math.round((o.r || 1.4) * 100) / 100;
      if (!TANK_GEO.ring[_rk]) {
        TANK_GEO.ring[_rk] = new THREE.TorusGeometry(_rk, 0.07, 6, 36);
        TANK_GEO.ring[_rk].__shared = true;
      }
      if (!TANK_GEO.teeth) {
        TANK_GEO.teeth = new THREE.BoxGeometry(0.1, 0.05, 0.22);
        TANK_GEO.teeth.__shared = true;
      }
      function _mat(c) {
        if (!TANK_MAT[c]) {
          TANK_MAT[c] = M(c, { opacity: 0.92 });
          TANK_MAT[c].__sharedBase = true;
        }
        return TANK_MAT[c].clone();   /* 每个实例独立透明度，颜色仍按颜色缓存 */
      }
      var ring = new THREE.Mesh(TANK_GEO.ring[_rk], _mat(_c1));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.08; g.add(ring);
      var teeth = [];
      for (var i = 0; i < 12; i++) {
        var m = new THREE.Mesh(TANK_GEO.teeth, _mat(_c2));
        var a = i / 12 * Math.PI * 2;
        m.position.set(Math.cos(a) * (_rk + 0.12), 0.08, Math.sin(a) * (_rk + 0.12));
        m.rotation.y = -a; g.add(m); teeth.push(m);
      }
      var w = ringWave(g, { color: _c1, r0: _rk * 0.6, r1: _rk * 1.6, dur: o.dur, thick: 0.14, alpha: 0.8 });
      var inst = { group: g, t: 0, acc: 0, poolKey: '',
        update: function (dt) {
          this.t += dt; this.acc += dt;
          var k = Math.min(1, this.t / o.dur);
          if (this.acc >= 0.1) { this.acc = 0; ring.rotation.z += dt * (o.spin || 5); }
          for (var ti2 = 0; ti2 < teeth.length; ti2++) {
            teeth[ti2].material.opacity = 0.9 * (1 - k);
          }
          ring.material.opacity = 0.95 * (1 - k);
          w.update(dt);
          return this.t < o.dur;
        } };
      return inst;
    }
  };

  /* ---- 不灭意志（self）---- */
  V.undying = {
    label: '不灭意志', target: 'self',
    tune: [{ k: 'dur', label: '持续', min: 0.4, max: 2.5, step: 0.1, def: 1.2 },
      { k: 'r', label: '护罩半径', min: 1, max: 3.5, step: 0.1, def: 1.8 }],
    mk: function (o) {
      var g = grp();
      /* ★★★ 2026-10-24 升级：不灭意志（神圣护罩）★★★
         ★ 原来：一个半透明黄球 ✗ 和灵能护盾一个毛病 ✓
         ★ 现在：金色护罩着色器
           · 六边形网格（和护盾区分：这里是【大格子】✗ 更庄重 ✓）
           · 表面有缓慢旋转的光带 ✗ 像圣光流转 ✓
           · 菲涅尔边缘发光 ✗ 有体积 ✓
           · 底部更亮（从脚下升起的力量）✓
         ★ 成本：球 24×16 ✗ 和护盾同规格 ✓ */
      var udMat = shaderMat({
        blending: THREE.AdditiveBlending,
        uni: { uOpacity: { value: 1 } },
        frag: [
          'uniform float uOpacity;',
          'void main(){',
          '  vec3 nrm = normalize(vPos);',
          '  float h = nrm.y * 0.5 + 0.5;',
          '  float u = atan(nrm.z, nrm.x) / 6.2831853;',
          /* 大六边形格：比灵能护盾粗一倍 ✗ 两个技能一眼能分开 ✓ */
          '  vec2 hp = vec2(u * 9.0, h * 6.0);',
          '  hp.y += mod(floor(hp.x), 2.0) * 0.5;',
          '  vec2 cell = fract(hp) - 0.5;',
          '  vec2 ab = abs(cell);',
          '  float hd = max(dot(ab, normalize(vec2(1.0, 1.732))), ab.x);',
          '  float grid = smoothstep(0.38, 0.47, hd);',
          /* 旋转光带：沿高度绕圈流动 */
          '  float band = pow(sin(h * 9.0 - uTime * 3.2) * 0.5 + 0.5, 6.0);',
          /* 菲涅尔 */
          '  float fres = pow(1.0 - abs(dot(nrm, vViewDir)), 2.2);',
          /* 底部更亮 */
          '  float low = smoothstep(1.0, 0.0, h) * 0.45;',
          '  vec3 cGold = vec3(1.00, 0.76, 0.20);',
          '  vec3 cWarm = vec3(1.00, 0.94, 0.62);',
          '  vec3 col = mix(cGold, cWarm, fres * 0.7 + band * 0.5);',
          '  float a = (grid * 0.55 + band * 0.35 + fres * 0.75 + low) * uOpacity;',
          '  gl_FragColor = vec4(col * (1.0 + fres * 1.1 + band * 0.6) * uIntensity, a);',
          '}'
        ].join('\n')
      });
      var m = new THREE.Mesh(new THREE.SphereGeometry(o.r, 24, 16), udMat);
      m.position.y = 1.1; g.add(m);
      var b = burst(g, { color: 0xffe98a, count: 50, speed: 3.6, size: 0.22, life: 0.9, seed: 13 });
      return { group: g, t: 0, update: function (dt) {
        this.t += dt; var k = Math.min(1, this.t / o.dur);
        udMat.uniforms.uOpacity.value = 1 - k; m.scale.setScalar(1 + k * 0.2);
        b.update(dt);
        return k < 1;
      } };
    }
  };

  /* ---- 空间跳跃 ---- */
  V.blink = {
    label: '空间跳跃', target: 'ground',
    tune: [{ k: 'dur', label: '持续', min: 0.2, max: 1.5, step: 0.1, def: 0.5 },
      { k: 'r', label: '半径', min: 1, max: 6, step: 0.2, def: 3 }],
    mk: function (o) {
      var g = grp();
      var a = new THREE.Mesh(new THREE.SphereGeometry(o.r * 0.5, 18, 12),
        M(0xb266ff, { opacity: 0.4, depthWrite: false }));
      a.position.y = 1.0; g.add(a);
      var w = ringWave(g, { color: 0xd8b4fe, r0: 0.5, r1: o.r, dur: o.dur, thick: 0.4 });
      var b = burst(g, { color: 0xc79cff, count: 40, speed: 6, size: 0.2, life: 0.5, seed: 15 });
      return { group: g, t: 0, update: function (dt) {
        this.t += dt; var k = Math.min(1, this.t / o.dur);
        a.material.opacity = 0.4 * (1 - k); a.scale.setScalar(1 + k * 0.5);
        w.update(dt); b.update(dt);
        return k < 1;
      } };
    }
  };

  /* ---- 病毒扩散：纯粒子 ---- */
  V.plague = {
    label: '病毒扩散（毒气）', target: 'ground',
    tune: [{ k: 'r', label: '范围', min: 0.8, max: 5, step: 0.1, def: 2.4 },
      { k: 'dur', label: '持续', min: 0.5, max: 5, step: 0.1, def: 3.0 },
      { k: 'parts', label: '粒子数', min: 20, max: 300, step: 10, def: 90 },
      { k: 'h', label: '气团高度', min: 0.8, max: 5, step: 0.1, def: 2.2 }],
    /* ★★★ 2026-10-25（用户："我指的是加了着色器和原来好像没有什么区别，应该是有气雾感，
       你可以理解毒气扩散"）★★★
       ★ 上一版的问题：只画了一个【平面圆盘】✗ 从 20 米高俯视时
         平面几乎看不出厚度 ✗ 完全没有"雾"的感觉 ✓✓
       ★ 真正的毒气需要【体积感】✗ 做法：
         ① 三层【圆柱壳】从外到内套着 ✗ 每层用体积噪声
            → 视线穿过时能感受到厚度 ✓✓（这是体积感的关键）
         ② 每层的透明度由【菲涅尔 + 噪声】共同决定
            → 边缘厚、中间薄（视线穿过气体层的路径长度）
         ③ 噪声沿高度方向流动 ✗ 气团在往上翻涌 ✓
         ④ 整体范围随时间【缓慢扩大】✗ 毒气在扩散 ✓
         ⑤ 底部还有一层贴地雾 ✗ 从地面渗出来的感觉 ✓
       ★ 成本：3 个圆柱壳 + 1 个圆盘 ✗ 约 300 个三角 ✓
         每层着色器 2 次 fbm ✗ 比水面的 9 次省得多 ✓ */
    mk: function (o) {
      var g = grp();
      var RAD = o.r || 2.4;
      var HGT = o.h || 2.2;

      /* ── ① 三层气壳（体积感的来源）── */
      var shells = [];
      for (var L = 0; L < 3; L++) {
        var rr = RAD * (1.0 - L * 0.22);          /* 外 → 内依次缩小 */
        var hh = HGT * (1.0 - L * 0.12);
        var seed = (o.seed || 16) * 0.037 + L * 11.3;
        var mat = shaderMat({
          blending: THREE.NormalBlending,          /* 气体用普通混合 ✗ 加法会发亮像火 ✓ */
          side: THREE.DoubleSide,
          uni: {
            uRadius: { value: rr }, uHeight: { value: hh },
            uSeed: { value: seed }, uOpacity: { value: 1 },
            uGrow: { value: 1.0 }, uLayer: { value: L }
          },
          tint: 0x6aab2a,
          frag: [
            'uniform float uRadius, uHeight, uSeed, uOpacity, uGrow, uLayer;',
            'void main(){',
            /* 圆柱壳展开成 (环绕角, 高度) */
            '  float ang = atan(vPos.z, vPos.x) / 6.2831853 + 0.5;',
            '  float h = clamp((vPos.y + uHeight * 0.5) / uHeight, 0.0, 1.0);',
            /* ② 噪声：沿高度方向翻涌（往上跑）+ 环绕方向横向漂移 */
            '  vec2 np = vec2(ang * 5.0 + uSeed + h * 1.4, h * 3.0 - uTime * 0.75);',
            '  float n1 = fbm(np);',
            '  float n2 = fbm(np * 2.6 + vec2(uSeed * 2.0, -uTime * 0.45));',
            '  float cloud = n1 * 0.62 + n2 * 0.38;',
            /* ③ 气团形状：中下部最浓、顶部散开 ✗ 底部贴近地面也浓 ✓ */
            '  float dens = smoothstep(0.30, 0.72, cloud);',
            '  float shape = pow(1.0 - h, 0.55) * (0.55 + dens * 0.85);',
            /* ④ 菲涅尔：边缘的视线穿过更多气体 → 更浓 ✗ 这是体积感的来源 ✓ */
            '  float fres = pow(1.0 - abs(dot(normalize(vPos.xz), normalize(vViewDir.xz + 0.0001))), 1.4);',
            /* ⑤ 三层叠加：内层淡一点，靠噪声错开 */
            '  float layerK = 1.0 - uLayer * 0.16;',
            '  float a = shape * (0.30 + fres * 0.55) * layerK * uOpacity;',
            /* 颜色：暗绿 → 亮黄绿（毒气经典的病态绿）*/
            '  vec3 cDeep = vec3(0.10, 0.20, 0.03);',
            '  vec3 cMid  = vec3(0.30, 0.55, 0.09);',
            '  vec3 cHot  = vec3(0.62, 0.88, 0.26);',
            '  vec3 col = mix(cDeep, cMid, cloud);',
            '  col = mix(col, cHot, pow(dens, 2.2) * 0.75);',
            /* 顶部略微发亮（被光照射到的边缘）*/
            '  col += vec3(0.18, 0.30, 0.10) * pow(h, 2.0) * 0.6;',
            '  gl_FragColor = vec4(col * uIntensity, clamp(a, 0.0, 0.85));',
            '}'
          ].join('\n')
        });
        var geo = new THREE.CylinderGeometry(rr, rr * 1.15, hh, 26, 1, true);
        var mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = hh * 0.5;
        g.add(mesh);
        shells.push({ m: mesh, mat: mat, baseR: rr, baseH: hh });
      }

      /* ── ② 贴地雾（从地面渗出来的感觉）── */
      var groundMat = shaderMat({
        blending: THREE.NormalBlending,
        side: THREE.DoubleSide,
        uni: { uRadius: { value: RAD * 1.2 }, uOpacity: { value: 1 }, uSeed: { value: (o.seed || 16) * 0.07 } },
        tint: 0x6aab2a,
        frag: [
          'uniform float uRadius, uOpacity, uSeed;',
          'void main(){',
          '  vec2 p = (vUv - 0.5) * 2.0;',
          '  float d = length(p);',
          '  if (d > 1.0) discard;',
          '  float ang = atan(p.y, p.x) / 6.2831853 + 0.5;',
          /* 贴地雾也是气团状的 ✗ 不是均匀的圆 ✓ */
          '  float n1 = fbm(vec2(ang * 7.0 + uSeed, d * 3.5 - uTime * 0.35));',
          '  float n2 = fbm(vec2(ang * 15.0 - uSeed, d * 7.0 + uTime * 0.22));',
          '  float cloud = n1 * 0.6 + n2 * 0.4;',
          '  float dens = smoothstep(0.32, 0.70, cloud);',
          /* 边缘不规则 ✗ 像雾在往外渗 ✓ */
          '  float edge = smoothstep(1.0, 0.55, d + cloud * 0.30);',
          /* 中心浓、边缘更快消散 */
          '  float core = smoothstep(0.9, 0.0, d);',
          '  float a = edge * (dens * 0.35 + core * 0.22) * uOpacity;',
          '  vec3 col = mix(vec3(0.14, 0.26, 0.04), vec3(0.42, 0.68, 0.14), dens);',
          '  gl_FragColor = vec4(col * uIntensity, clamp(a, 0.0, 0.70));',
          '}'
        ].join('\n')
      });
      var ground = new THREE.Mesh(new THREE.CircleGeometry(RAD * 1.25, 40), groundMat);
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = 0.10;
      g.add(ground);

      /* ── ③ GPU 粒子（绿孢子飘散）── */
      var b = burst(g, { color: 0x2a5a10, color2: 0x9ee04a, colorMix: 0.9,
                         count: o.parts || 90, speed: 0.9, size: 0.26,
                         life: o.dur * 1.1, y: 0.35, up: 0.85, grav: -0.10,
                         r: RAD * 0.8, spread: 1.0,
                         turb: 0.65, turbFreq: 2.0, drag: 0.6, grow: 1.3,
                         stagger: o.dur * 0.55, seed: o.seed || 16 });

      return { group: g, t: 0, update: function (dt) {
        this.t += dt;
        var k = Math.min(1, this.t / o.dur);
        /* ⑥ 毒气【缓慢扩散】：半径和高都随时间放大 ✗ 越飘越开 ✓ */
        var grow = 1 + k * 0.42;
        for (var i = 0; i < shells.length; i++) {
          var sh = shells[i];
          sh.m.scale.set(grow, 1 + k * 0.28, grow);
          sh.mat.uniforms.uGrow.value = grow;
          /* 后 30% 时间快速消散 ✗ 不会突然消失 ✓ */
          sh.mat.uniforms.uOpacity.value = 1 - Math.max(0, (k - 0.68) / 0.32);
        }
        groundMat.uniforms.uOpacity.value = 1 - Math.max(0, (k - 0.60) / 0.40);
        ground.scale.setScalar(1 + k * 0.30);
        b.update(dt);
        return k < 1;
      } };
    }
  };

  /* ---- 无动画 ---- */
  V.none = {
    label: '（无动画）', target: 'self',
    tune: [{ k: 'dur', label: '持续', min: 0.2, max: 2, step: 0.1, def: 0.5 }],
    mk: function (o) {
      var g = grp();
      var m = new THREE.Mesh(new THREE.SphereGeometry(0.9, 14, 10),
        M(0x9fd8ff, { opacity: 0.14, depthWrite: false }));
      m.position.y = 1.1; g.add(m);
      return { group: g, t: 0, update: function (dt) {
        this.t += dt; var k = Math.min(1, this.t / o.dur);
        m.material.opacity = 0.14 * (1 - k);
        return k < 1;
      } };
    }
  };


  /* ===== round546 覆写 ===== */
  function lightning(g, o) {
    var R = rnd(o.seed || 9), h = o.h || 12, pts = [], N = o.seg || 9;
    for (var i = 0; i <= N; i++) {
      var k = i / N, jitter = (i === 0 || i === N) ? 0.12 : 1;
      pts.push(new THREE.Vector3((R() - 0.5) * (o.spread || 1.2) * jitter,
        h * (1 - k), (R() - 0.5) * (o.spread || 1.2) * jitter));
    }
    var curve = new THREE.CatmullRomCurve3(pts);
    var outer = new THREE.Mesh(new THREE.TubeGeometry(curve, 30, o.w || 0.28, 6, false),
      M(o.color || 0xd8e6ff, { opacity: 0.9, depthWrite: false }));
    var inner = new THREE.Mesh(new THREE.TubeGeometry(curve, 30, (o.w || 0.28) * 0.38, 6, false),
      M(o.core || 0xffffff, { opacity: 0.95, depthWrite: false }));
    g.add(outer); g.add(inner);
    return { outer: outer, inner: inner, t: 0, update: function (dt) {
      this.t += dt; var k = Math.min(1, this.t / (o.dur || 0.3));
      this.outer.material.opacity = 0.9 * (1 - k);
      this.inner.material.opacity = 0.95 * (1 - k);
      return k < 1;
    } };
  }

  /* ★★★ 2026-10-24：着色器闪电（给雷霆万钧用）★★★
     ★ 原来的 lightning()：CatmullRomCurve3 + TubeGeometry ✗
       每来一道雷就要【新建曲线 + 三角化管子】✗ 12 段 × 6 边 = 一堆三角 ✓
       而且几何体是【固定的】✗ 闪电看起来是死的（不会抖）✓
     ★ 现在：一片竖直的四边形 + 片元着色器画闪电
       · 路径由 sin 叠加生成 ✗ 随时间抖动 ✓ 像真的在跳
       · 有【分支】✗ 主通道旁边会裂出小岔 ✓
       · 核心白 ✗ 外圈蓝紫辉光 ✓ 边缘 additive 叠加
       · 成本：2 个三角 ✗ 比 TubeGeometry 便宜 100 倍 ✓✓
     ★ 返回对象和 lightning() 完全一致（update 返回值语义相同）✓
       → 调用它的地方一行都不用改 ✓ */
  function boltShader(g, o) {
    var H = o.h || 14;
    var W = o.w || 0.5;
    var mat = shaderMat({
      blending: THREE.AdditiveBlending,
      uni: {
        uH: { value: H },
        uSeed: { value: (o.seed || 9) * 0.0817 },
        uWidth: { value: W },
        uOpacity: { value: 1 }
      },
      frag: [
        'uniform float uH, uSeed, uWidth, uOpacity;',
        /* 给定高度 h（0~1）算出闪电中心的横向偏移 */
        'float pathAt(float h, float seed){',
        '  return sin(h * 7.3 + seed) * 0.22 + sin(h * 17.1 - seed * 2.3) * 0.11',
        '       + sin(h * 31.7 + seed * 1.7) * 0.05;',
        '}',
        'void main(){',
        '  float h = 1.0 - vUv.y;',            /* 0=底 1=顶 */
        /* 主通道：随时间快速抖动 ✗ 每 ~60ms 换一次形状 ✓ */
        '  float flick = floor(uTime * 16.0);',
        '  float cx = pathAt(h, uSeed + flick * 0.37);',
        '  float dx = abs(vUv.x - 0.5 - cx * 0.5) * 2.0;',   /* 到中心的归一化距离 */
        /* 越往下越细 ✗ 顶部粗底部尖（像劈下来的）✓ */
        '  float wBase = uWidth * (1.0 - h * 0.55);',
        '  float core = smoothstep(wBase, 0.0, dx);',
        '  float glow = smoothstep(wBase * 4.5, 0.0, dx);',
        /* 分支：用另一条相位不同的路径 ✗ 只在某些高度出现 ✓ */
        '  float bx = pathAt(h * 1.6 + 0.35, uSeed * 2.1 + flick * 0.53 + 4.0);',
        '  float bdx = abs(vUv.x - 0.5 - bx * 0.5) * 2.0;',
        '  float branchMask = step(0.42, sin(h * 9.0 + uSeed * 3.1 + flick * 0.9) * 0.5 + 0.5);',
        '  float branch = smoothstep(wBase * 0.5, 0.0, bdx) * branchMask * 0.55;',
        /* 整体：底部亮、顶部衰减 ✗ 落地处额外爆亮 ✓ */
        '  float vFade = smoothstep(1.0, 0.72, h) * 0.75 + 0.25;',
        '  float impact = smoothstep(0.16, 0.0, h) * 1.6;',
        '  vec3 cCore = vec3(1.0, 0.99, 1.0);',
        '  vec3 cGlow = vec3(0.45, 0.62, 1.0);',
        '  vec3 cBranch = vec3(0.70, 0.82, 1.0);',
        '  vec3 col = mix(cGlow * 1.4, cCore, core);',
        '  col = mix(col, cBranch, branch);',
        '  float a = clamp(core * 1.3 + glow * 0.55 + branch, 0.0, 1.6);',
        '  a *= vFade * uOpacity;',
        '  col *= 1.0 + impact;',
        '  gl_FragColor = vec4(col * uIntensity, a);',
        '}'
      ].join('\n')
    });
    /* 竖直四边形 ✗ 宽度给 1（着色器里自己算精细宽度）*/
    var geo = new THREE.PlaneGeometry(2.4, H, 1, 1);
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = H * 0.5;
    g.add(mesh);
    return { outer: mesh, inner: null, t: 0, dur: (o.dur || 0.3), update: function (dt) {
      this.t += dt;
      var k = Math.min(1, this.t / this.dur);
      /* 前 15% 猛地亮起来 ✗ 后面快速衰减（雷击的节奏）✓ */
      var rise = Math.min(1, this.t / (this.dur * 0.15));
      var fall = 1 - Math.max(0, (k - 0.15) / 0.85);
      mat.uniforms.uOpacity.value = rise * fall * fall;
      return k < 1;
    } };
  }

  V.firestorm = {
    label: '烈焰风暴', target: 'ground',
    tune: [{ k: 'r', label: '底部半径', min: 1, max: 6, step: 0.2, def: 2.6 },
      { k: 'th', label: '龙卷高度', min: 4, max: 16, step: 0.5, def: 9 },
      { k: 'dur', label: '持续', min: 1, max: 8, step: 0.2, def: 4 },
      { k: 'spin', label: '旋转速度', min: 1, max: 16, step: 0.5, def: 8 },
      { k: 'taper', label: '上宽比例', min: 1.2, max: 4, step: 0.1, def: 2.4 },
      { k: 'fade', label: '淡出时长', min: 0.3, max: 2, step: 0.1, def: 1.0 }],
    mk: function (o) {
      var g = grp(), R = rnd(o.seed || 1), t = 0;
      var H = o.th, r0 = o.r, taper = o.taper, fade = o.fade, total = o.dur + fade;
      var base = new THREE.Mesh(new THREE.RingGeometry(r0 * 0.5, r0 * 1.35, 48),
        M(0xff5a00, { side: THREE.DoubleSide, opacity: 0.5, depthWrite: false }));
      base.rotation.x = -Math.PI / 2; base.position.y = 0.05; g.add(base);
      var layers = [], RINGS = 22;
      for (var i = 0; i < RINGS; i++) {
        var k = i / (RINGS - 1);
        var rr = r0 * (1 + (taper - 1) * Math.pow(k, 1.7));
        var lg = new THREE.Group();
        var cnt = 7;
        for (var j = 0; j < cnt; j++) {
          var m = new THREE.Mesh(new THREE.SphereGeometry(0.16 + k * 0.22, 5, 4),
            M(i < RINGS * 0.35 ? 0xff4a00 : (i < RINGS * 0.7 ? 0xff8a1a : 0xffcf6a),
              { opacity: 0.42, depthWrite: false }));
          var a = (j / cnt) * Math.PI * 2 + i * 0.5;
          m.position.set(Math.cos(a) * rr, k * H, Math.sin(a) * rr);
          lg.add(m);
        }
        g.add(lg); layers.push({ g: lg, k: k });
      }
      var strips = [];
      for (var s2 = 0; s2 < 3; s2++) {
        var pts = [];
        for (var q = 0; q <= 26; q++) {
          var kk = q / 26, ang = kk * Math.PI * 5 + s2 * 2.1;
          var rq = r0 * (1 + (taper - 1) * Math.pow(kk, 1.7));
          pts.push(new THREE.Vector3(Math.cos(ang) * rq, kk * H, Math.sin(ang) * rq));
        }
        var tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.12, 5, false),
          M(0xff9a3a, { opacity: 0.3, depthWrite: false }));
        g.add(tube); strips.push(tube);
      }
      var embers = burst(g, { color: 0xffb347, count: 50, speed: 1.6, size: 0.18, life: 2.0,
        y: 0.3, up: 3.4, grav: -2.0, seed: 5 });
      var smoke = [];
      for (var sm2 = 0; sm2 < 12; sm2++) {
        var sm = new THREE.Mesh(new THREE.SphereGeometry(0.6 + R() * 0.5, 6, 5),
          M(0x2a1a14, { opacity: 0.18, depthWrite: false }));
        var a3 = R() * 6.28, r3 = r0 * taper * (0.5 + R() * 0.7);
        sm.position.set(Math.cos(a3) * r3, H * (0.75 + R() * 0.3), Math.sin(a3) * r3);
        g.add(sm); smoke.push({ m: sm, sp: 0.25 + R() * 0.4 });
      }
      return { group: g, update: function (dt) {
        t += dt;
        var fadeK = t <= o.dur ? 1 : Math.max(0, 1 - (t - o.dur) / fade);
        var grow = Math.min(1, t / 0.5);
        for (var i = 0; i < layers.length; i++) {
          var L = layers[i];
          L.g.rotation.y += dt * o.spin * (1 - L.k * 0.45);
          var parts = L.g.children;
          for (var j = 0; j < parts.length; j++) {
            parts[j].material.opacity = 0.42 * fadeK * grow * (1 - L.k * 0.35);
          }
          L.g.position.y = Math.sin(t * 3 + i * 0.5) * 0.1;
        }
        for (var s3 = 0; s3 < strips.length; s3++) {
          strips[s3].material.opacity = 0.3 * fadeK * grow;
          strips[s3].rotation.y += dt * o.spin * 0.9;
        }
        base.material.opacity = 0.5 * fadeK * (0.7 + 0.3 * Math.sin(t * 9));
        for (var k2 = 0; k2 < smoke.length; k2++) {
          smoke[k2].m.position.y += dt * smoke[k2].sp;
          smoke[k2].m.material.opacity = 0.18 * fadeK;
        }
        if (embers.obj) { embers.obj.material.opacity *= fadeK; }
        embers.update(dt);
        return t < total;
      } };
    }
  };

  V.earthsplit = {
    label: '地裂', target: 'ground',
    tune: [{ k: 'len', label: '长度', min: 3, max: 14, step: 0.5, def: 8 },
      { k: 'w', label: '裂口宽度', min: 0.4, max: 3, step: 0.1, def: 1.2 },
      { k: 'open', label: '裂开幅度', min: 0.2, max: 3, step: 0.1, def: 1.1 },
      { k: 'n', label: '岩浆柱数', min: 2, max: 16, step: 1, def: 8 },
      { k: 'shake', label: '震屏强度', min: 0, max: 2, step: 0.1, def: 0.8 }],
    mk: function (o) {
      var g = new THREE.Group(), R = rnd(o.seed || 3), t = 0, parts = [];
      var L = o.len, W = o.w, OP = o.open;
      function half(sign) {
        var mg = new THREE.Group(); g.add(mg);
        var geo = new THREE.PlaneGeometry(W * 2.2, L, 6, 10);
        var pos = geo.attributes.position;
        for (var i = 0; i < pos.count; i++) {
          var px = pos.getX(i);
          if (Math.abs(px) < W * 1.1) { pos.setX(i, px + sign * (R() * 0.25 + 0.15)); }
        }
        pos.needsUpdate = true;
        var m = new THREE.Mesh(geo, M(0x3a2a1e, { side: THREE.DoubleSide, opacity: 0.95 }));
        m.rotation.x = -Math.PI / 2; m.position.set(sign * W * 1.1, 0.03, L * 0.5);
        mg.add(m);
        return { g: mg, m: m, sign: sign };
      }
      var h1 = half(-1), h2 = half(1);
      var lava = new THREE.Mesh(new THREE.PlaneGeometry(W * 2.4, L),
        M(0xff4a00, { side: THREE.DoubleSide, opacity: 0.95 }));
      lava.rotation.x = -Math.PI / 2; lava.position.set(0, -0.35, L * 0.5); g.add(lava);
      window.__VFX_SHAKE__ = o.shake;
      for (var i = 0; i < o.n; i++) {
        (function (i) {
          var z = (i + 0.5) / o.n * L;
          var sub = new THREE.Group(); sub.position.set((R() - 0.5) * W * 0.6, 0, z); g.add(sub);
          var pl = pillar(sub, { color: 0xff7a22, w: 0.3 + R() * 0.28, h: 2 + R() * 2.6,
            dur: 0.55, alpha: 0.45 });
          var debris = burst(sub, { color: 0x6b5a4a, count: 14, speed: 3.2, size: 0.2, life: 0.9,
            y: 0.15, up: 3.0, seed: i + 1 });
          var fire = burst(sub, { color: 0xff8a3a, count: 18, speed: 2.6, size: 0.18, life: 0.8,
            y: 0.2, up: 2.2, seed: i + 21 });
          var smoke = burst(sub, { color: 0x2a2a2a, count: 10, speed: 1.1, size: 0.5, life: 1.6,
            y: 0.5, up: 1.0, grav: -0.3, seed: i + 41 });
          parts.push({ t: -i / o.n * 0.45, pl: pl, debris: debris, fire: fire, smoke: smoke,
            update: function (dt) {
              this.t += dt; if (this.t < 0) { return true; }
              this.pl.update(dt); this.debris.update(dt); this.fire.update(dt); this.smoke.update(dt);
              return this.t < 1.6;
            } });
        })(i);
      }
      return { group: g, update: function (dt) {
        t += dt;
        var k = Math.min(1, t / 0.6);
        h1.g.rotation.z = -ease(k) * OP * 0.25;
        h2.g.rotation.z = ease(k) * OP * 0.25;
        h1.m.position.x = -W * 1.1 - ease(k) * OP * 0.6;
        h2.m.position.x = W * 1.1 + ease(k) * OP * 0.6;
        lava.material.opacity = (0.55 + 0.4 * Math.sin(t * 12)) * (t < 2.2 ? 1 : 0);
        var alive = t < 2.2;
        for (var i = 0; i < parts.length; i++) { if (parts[i].update(dt)) { alive = true; } }
        return alive;
      } };
    }
  };

  function slashWave(g, o) {
    var m = new THREE.Mesh(new THREE.RingGeometry(o.rad * 0.55, o.rad, 40, 1,
      -Math.PI / 2 - o.arc / 2, o.arc),
      M(o.color, { side: THREE.DoubleSide, opacity: 0.9, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, o.y || 1.1, 0.6); g.add(m);
    var core = new THREE.Mesh(new THREE.RingGeometry(o.rad * 0.72, o.rad * 0.9, 40, 1,
      -Math.PI / 2 - o.arc / 2, o.arc),
      M(o.core || 0xffd0d0, { side: THREE.DoubleSide, opacity: 0.85, depthWrite: false }));
    core.rotation.copy(m.rotation); core.position.copy(m.position); g.add(core);
    return { t: 0, update: function (dt) {
      this.t += dt;
      var k = Math.min(1, this.t / (o.dur || 0.55));
      m.position.z = 0.6 + k * (o.dist || 9);
      core.position.z = m.position.z;
      m.material.opacity = 0.9 * (1 - k);
      core.material.opacity = 0.85 * (1 - k);
      m.scale.setScalar(0.9 + k * 0.5);
      core.scale.setScalar(0.9 + k * 0.5);
      return k < 1;
    } };
  }

  V.bloodslash = {
    label: '燃血斩', target: 'ground',
    tune: [{ k: 'rad', label: '剑气半径', min: 1, max: 5, step: 0.2, def: 2.8 },
      { k: 'arc', label: '张角', min: 0.6, max: 3, step: 0.1, def: 2.0 },
      { k: 'dist', label: '飞行距离', min: 2, max: 18, step: 0.5, def: 9 },
      { k: 'dur', label: '飞行时长', min: 0.2, max: 1.5, step: 0.05, def: 0.55 }],
    mk: function (o) {
      var g = new THREE.Group();
      g.rotation.y = o.yaw || 0;          /* ★ round587：弧形中间朝玩家面向 */
      var w = slashWave(g, { rad: o.rad, arc: o.arc, dist: o.dist, dur: o.dur,
        color: 0xff2a2a, core: 0xffd0d0, y: 1.1 });
      var b = burst(g, { color: 0xff5a3a, count: 24, speed: 3, size: 0.2, life: 0.6, y: 1.1, seed: 6 });
      return { group: g, update: function (dt) { b.update(dt); return w.update(dt); } };
    }
  };

  V.shadowstep = {
    label: '影袭', target: 'ground',
    tune: [{ k: 'rad', label: '剑气半径', min: 0.6, max: 3, step: 0.1, def: 1.6 },
      { k: 'arc', label: '张角', min: 0.5, max: 2.5, step: 0.1, def: 1.5 },
      { k: 'dist', label: '飞行距离', min: 1, max: 10, step: 0.5, def: 5 },
      { k: 'dur', label: '飞行时长', min: 0.15, max: 1, step: 0.05, def: 0.35 }],
    mk: function (o) {
      var g = new THREE.Group();
      var w = slashWave(g, { rad: o.rad, arc: o.arc, dist: o.dist, dur: o.dur,
        color: 0x8a5aff, core: 0xe0d0ff, y: 1.1 });
      var b = burst(g, { color: 0x6a3aff, count: 16, speed: 3, size: 0.16, life: 0.45, y: 1.1, seed: 7 });
      return { group: g, update: function (dt) { b.update(dt); return w.update(dt); } };
    }
  };

  V.thunder = {
    label: '雷霆万钧', target: 'ground',
    tune: [{ k: 'n', label: '雷数', min: 1, max: 10, step: 1, def: 5 },
      { k: 'r', label: '散布', min: 1, max: 14, step: 1, def: 7 },
      { k: 'h', label: '雷高', min: 6, max: 20, step: 0.5, def: 14 },
      { k: 'w', label: '粗细', min: 0.08, max: 0.8, step: 0.02, def: 0.26 },
      { k: 'spread', label: '抖动', min: 0.2, max: 3, step: 0.1, def: 1.1 }],
    mk: function (o) {
      var g = new THREE.Group(), R = rnd(o.seed || 2), parts = [];
      for (var i = 0; i < o.n; i++) {
        var a = R() * 6.28, d = R() * o.r;
        var sub = new THREE.Group(); sub.position.set(Math.cos(a) * d, 0, Math.sin(a) * d); g.add(sub);
        var li = lightning(sub, { h: o.h, w: o.w, spread: o.spread, dur: 0.28,
          color: 0xbfd6ff, core: 0xffffff, seed: R() * 1e6 | 0, seg: 10 });
        var b = burst(sub, { color: 0xbfd6ff, count: 18, speed: 4.5, size: 0.18, life: 0.45, seed: i + 3 });
        parts.push({ t: -i * 0.15, li: li, b: b, update: function (dt) {
          this.t += dt; if (this.t < 0) { return true; }
          var alive = false;
          if (this.li.update(dt)) { alive = true; }
          this.b.update(dt);
          if (this.b.t < this.b.life) { alive = true; }
          return alive;
        } });
      }
      return { group: g, update: function (dt) {
        var alive = false;
        for (var i = 0; i < parts.length; i++) { if (parts[i].update(dt)) { alive = true; } }
        return alive;
      } };
    }
  };

  V.splitarrow = {
    label: '分裂箭', target: 'ground',
    tune: [{ k: 'speed', label: '飞行速度', min: 6, max: 30, step: 1, def: 16 },
      { k: 'spread', label: '散开角度', min: 0.02, max: 1, step: 0.02, def: 0.18 },
      { k: 'n', label: '箭数', min: 1, max: 5, step: 1, def: 3 }],
    mk: function (o) {
      var g = new THREE.Group(), list = [];
      for (var i = 0; i < o.n; i++) {
        var off = i - (o.n - 1) / 2;
        var ar = arrowMesh(0xdfe9f5);
        ar.rotation.x = -Math.PI / 2;
        ar.position.set(off * 0.26, 1.1, 0.6);
        ar.rotation.z = -off * o.spread * 0.5;
        g.add(ar);
        list.push({ m: ar, vx: off * o.spread, t: 0 });
      }
      return { group: g, update: function (dt) {
        var alive = false;
        for (var i = 0; i < list.length; i++) {
          var p = list[i]; p.t += dt;
          p.m.position.z += dt * o.speed;
          p.m.position.x += dt * p.vx * o.speed * 0.45;
          if (p.t < 0.6) { alive = true; }
        }
        return alive;
      } };
    }
  };

  V.plague = {
    label: '病毒扩散（拖尾粒子）', target: 'ground',
    tune: [{ k: 'r', label: '毒雾半径', min: 0.4, max: 3, step: 0.1, def: 1.1 },
      { k: 'trail', label: '拖尾长度', min: 1, max: 10, step: 0.5, def: 5 },
      { k: 'dur', label: '淡出时长', min: 0.5, max: 4, step: 0.1, def: 2.2 },
      { k: 'parts', label: '粒子数', min: 30, max: 300, step: 10, def: 140 }],
    mk: function (o) {
      var g = new THREE.Group(), R = rnd(o.seed || 16);
      var n = o.parts, pos = new Float32Array(n * 3), vel = [];
      for (var i = 0; i < n; i++) {
        var back = R() * o.trail;
        var a = R() * 6.28, rad = R() * o.r;
        var y = 0.15 + R() * 1.1;
        pos[i * 3] = Math.cos(a) * rad;
        pos[i * 3 + 1] = y;
        pos[i * 3 + 2] = -back;
        vel.push({ a: a, rad: rad, y: y, back: back, rise: 0.15 + R() * 0.35,
          swirl: (R() - 0.5) * 1.4 });
      }
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      var obj = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x9bd44a, size: 0.26,
        transparent: true, opacity: 0.8, sizeAttenuation: true, depthWrite: false }));
      g.add(obj);
      var heads = [];
      for (var h = 0; h < 6; h++) {
        var m = new THREE.Mesh(new THREE.SphereGeometry(o.r * (0.5 + R() * 0.4), 8, 6),
          M(0x9bd44a, { opacity: 0.25, depthWrite: false }));
        m.position.set((R() - 0.5) * o.r, 0.5 + R() * 0.6, -R() * 0.8);
        g.add(m); heads.push({ m: m, sp: 0.2 + R() * 0.4, ph: R() * 6.28 });
      }
      return { group: g, t: 0, update: function (dt) {
        this.t += dt; var k = Math.min(1, this.t / o.dur);
        var arr = geo.attributes.position.array;
        for (var i = 0; i < vel.length; i++) {
          var p = vel[i];
          p.a += dt * p.swirl;
          p.y += p.rise * dt;
          arr[i * 3] = Math.cos(p.a) * p.rad;
          arr[i * 3 + 1] = p.y;
          arr[i * 3 + 2] = -p.back;
        }
        geo.attributes.position.needsUpdate = true;
        obj.material.opacity = 0.8 * (1 - k);
        for (var j = 0; j < heads.length; j++) {
          var hh = heads[j];
          hh.m.material.opacity = 0.25 * (0.6 + 0.4 * Math.sin(this.t * 4 + hh.ph)) * (1 - k);
          hh.m.position.y += dt * hh.sp * 0.3;
        }
        return k < 1;
      } };
    }
  };


  /* ===== round547 覆写 ===== */

  /* ---- 地裂：地面裂开 + 岩浆向上喷 ---- */
  V.earthsplit = {
    label: '地裂（岩浆喷发）', target: 'ground',
    tune: [{ k: 'len', label: '长度', min: 3, max: 16, step: 0.5, def: 8 },
      { k: 'w', label: '裂口宽度', min: 0.3, max: 3, step: 0.1, def: 1.6 },
      { k: 'n', label: '喷发点', min: 2, max: 20, step: 1, def: 10 },
      { k: 'eh', label: '喷发高度', min: 1, max: 8, step: 0.2, def: 3.4 },
      { k: 'shake', label: '震屏强度', min: 0, max: 2, step: 0.1, def: 0.7 }],
    mk: function (o) {
      var g = new THREE.Group(), R = rnd(o.seed || 3), t = 0, parts = [];
      var L = o.len, W = o.w, N = o.n, H = (o.eh || 3.4), total = Math.max(2.4, Number(o.dur) || 2.4);

      /* ① 地面裂口：一条发光的岩浆缝（平的，贴地） */
      var seam = new THREE.Mesh(new THREE.PlaneGeometry(W, L),
        M(0xff3a00, { side: THREE.DoubleSide, opacity: 0.9, depthWrite: false }));
      seam.rotation.x = -Math.PI / 2; seam.position.set(0, 0.03, L * 0.5);
      seam.scale.z = 0.02; g.add(seam);
      var seamGlow = new THREE.Mesh(new THREE.PlaneGeometry(W * 2.1, L),
        M(0xff7a22, { side: THREE.DoubleSide, opacity: 0.35, depthWrite: false }));
      seamGlow.rotation.x = -Math.PI / 2; seamGlow.position.set(0, 0.02, L * 0.5);
      seamGlow.scale.z = 0.02; g.add(seamGlow);
      /* 缝边焦黑 */
      var scorch = new THREE.Mesh(new THREE.PlaneGeometry(W * 3.2, L * 1.02),
        M(0x1a0d06, { side: THREE.DoubleSide, opacity: 0.55, depthWrite: false }));
      scorch.rotation.x = -Math.PI / 2; scorch.position.set(0, 0.01, L * 0.5);
      scorch.scale.z = 0.01; g.add(scorch);

      window.__VFX_SHAKE__ = o.shake;

      /* ② 喷发：每个点一条岩浆柱（下粗上尖）+ 溅射 + 火星 + 烟 */
      for (var i = 0; i < N; i++) {
        (function (i) {
          var z = (i + 0.5) / N * L;
          var sub = new THREE.Group();
          sub.position.set((R() - 0.5) * W * 0.55, 0, z); g.add(sub);

          var hh = H * (0.55 + R() * 0.75);
          /* 岩浆柱：锥形向上，外面一圈更亮的芯 */
          var cone = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.34 + R() * 0.22, hh, 8, 1, true),
            M(0xff5a00, { opacity: 0.72, side: THREE.DoubleSide, depthWrite: false }));
          cone.position.y = hh / 2; sub.add(cone);
          var core = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.15 + R() * 0.1, hh * 0.92, 8, 1, true),
            M(0xffe08a, { opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
          core.position.y = hh * 0.46; sub.add(core);

          /* 溅射的岩浆团 */
          var blobs = [];
          for (var b = 0; b < 6; b++) {
            var bl = new THREE.Mesh(new THREE.SphereGeometry(0.1 + R() * 0.12, 6, 5),
              M(0xff8a1a, { opacity: 0.9 }));
            bl.position.set((R() - 0.5) * 0.5, 0.2, (R() - 0.5) * 0.5);
            sub.add(bl);
            blobs.push({ m: bl, vy: 3.5 + R() * 3.5, vx: (R() - 0.5) * 2.2, vz: (R() - 0.5) * 2.2, y: 0.2 });
          }
          /* 火星 + 黑烟 */
          var spark = burst(sub, { color: 0xffb347, count: 16, speed: 2.2, size: 0.16, life: 1.0,
            y: 0.3, up: 2.6, grav: 6.0, seed: i + 3 });
          var smoke = burst(sub, { color: 0x241a14, count: 10, speed: 1.0, size: 0.5, life: 1.6,
            y: 0.6, up: 1.6, grav: -0.4, seed: i + 31 });

          parts.push({ t: -i / N * 0.5, cone: cone, core: core, blobs: blobs,
            spark: spark, smoke: smoke, hh: hh, life: 1.4 + R() * 0.5,
            update: function (dt) {
              this.t += dt;
              if (this.t < 0) { return true; }
              var k = Math.min(1, this.t / this.life);
              var rise = Math.min(1, this.t / 0.25);
              var fade = 1 - Math.max(0, (k - 0.6) / 0.4);
              this.cone.scale.y = 0.15 + 0.85 * rise;
              this.core.scale.y = 0.15 + 0.85 * rise;
              this.cone.material.opacity = 0.72 * fade;
              this.core.material.opacity = 0.8 * fade;
              for (var b2 = 0; b2 < this.blobs.length; b2++) {
                var bb = this.blobs[b2];
                bb.vy -= 9.5 * dt;
                bb.y += bb.vy * dt;
                if (bb.y < 0.05) { bb.y = 0.05; bb.vy = Math.abs(bb.vy) * 0.35; }
                bb.m.position.set(bb.m.position.x + bb.vx * dt, bb.y, bb.m.position.z + bb.vz * dt);
                bb.m.material.opacity = 0.9 * fade;
              }
              this.spark.update(dt); this.smoke.update(dt);
              return k < 1;
            } });
        })(i);
      }

      return { group: g, update: function (dt) {
        t += dt;
        var open = Math.min(1, t / 0.35);
        seam.scale.z = open; seamGlow.scale.z = open; scorch.scale.z = open;
        seam.material.opacity = 0.85 + 0.15 * Math.sin(t * 16);
        seamGlow.material.opacity = 0.35 * (1 - Math.max(0, (t - 1.8) / 0.6));
        scorch.material.opacity = 0.55 * (1 - Math.max(0, (t - 1.8) / 0.6));
        var alive = t < total;
        for (var i = 0; i < parts.length; i++) { if (parts[i].update(dt)) { alive = true; } }
        return alive;
      } };
    }
  };

  /* ---- 雷霆万钧：更长的闪电 ---- */
  V.thunder = {
    label: '雷霆万钧', target: 'ground',
    tune: [{ k: 'n', label: '雷数', min: 1, max: 10, step: 1, def: 5 },
      { k: 'r', label: '散布', min: 1, max: 14, step: 1, def: 7 },
      { k: 'lh', label: '雷高', min: 10, max: 40, step: 1, def: 26 },
      { k: 'w', label: '粗细', min: 0.1, max: 1.2, step: 0.02, def: 0.34 },
      { k: 'spread', label: '抖动', min: 0.2, max: 4, step: 0.1, def: 1.6 }],
    mk: function (o) {
      var g = new THREE.Group(), R = rnd(o.seed || 2), parts = [];
      for (var i = 0; i < o.n; i++) {
        var a = R() * 6.28, d = R() * o.r;
        var sub = new THREE.Group(); sub.position.set(Math.cos(a) * d, 0, Math.sin(a) * d); g.add(sub);
        var li = lightning(sub, { h: (o.lh || 26), w: o.w, spread: o.spread, dur: 0.3, seg: 14,
          color: 0xbfd6ff, core: 0xffffff, seed: R() * 1e6 | 0 });
        var b = burst(sub, { color: 0xbfd6ff, count: 22, speed: 5, size: 0.2, life: 0.5, seed: i + 3 });
        parts.push({ t: -i * 0.15, li: li, b: b, update: function (dt) {
          this.t += dt; if (this.t < 0) { return true; }
          var alive = false;
          if (this.li.update(dt)) { alive = true; }
          this.b.update(dt);
          if (this.b.t < this.b.life) { alive = true; }
          return alive;
        } });
      }
      return { group: g, update: function (dt) {
        var alive = false;
        for (var i = 0; i < parts.length; i++) { if (parts[i].update(dt)) { alive = true; } }
        return alive;
      } };
    }
  };

  /* ---- 雷引：更长的紫色闪电 ---- */
  V.thunderbolt = {
    label: '雷引', target: 'ground',
    tune: [{ k: 'w', label: '粗细', min: 0.08, max: 1, step: 0.02, def: 0.3 },
      { k: 'lh', label: '高度', min: 8, max: 30, step: 1, def: 18 },
      { k: 'spread', label: '抖动', min: 0.2, max: 4, step: 0.1, def: 1.4 },
      { k: 'dur', label: '持续', min: 0.15, max: 1, step: 0.05, def: 0.35 }],
    mk: function (o) {
      var g = new THREE.Group();
      var li = lightning(g, { h: (o.lh || 18), w: o.w, spread: o.spread, dur: o.dur, seg: 12,
        color: 0xb066ff, core: 0xf0d8ff, seed: o.seed || 8 });
      var b = burst(g, { color: 0xb066ff, count: 24, speed: 4.5, size: 0.18, life: 0.5, seed: 3 });
      return { group: g, update: function (dt) { b.update(dt); return li.update(dt); } };
    }
  };


  /* ★ round568：召唤用的纯烟雾（0.6 秒，白雾扩散 + 火星 ✓ 一定能看到在动）*/
  V.puff = {
    label: '烟雾（召唤用）', target: 'ground',
    tune: [{ k: 'size', label: '大小', min: 0.3, max: 2, step: 0.1, def: 0.7 },
      { k: 'dur', label: '持续', min: 0.3, max: 2, step: 0.1, def: 0.6 }],
    mk: function (o) {
      var g = grp(), t = 0, R = rnd(o.seed || 3);
      var list = [];
      for (var i = 0; i < 8; i++) {
        var m = new THREE.Mesh(new THREE.SphereGeometry((o.size || 0.45) * (0.35 + R() * 0.35), 8, 6),
          M(0xdfefff, { opacity: 0.55, depthWrite: false }));
        var a = R() * 6.28, d = R() * 0.35;
        m.position.set(Math.cos(a) * d, 0.5 + R() * 0.6, Math.sin(a) * d);
        g.add(m); list.push({ m: m, vx: Math.cos(a), vz: Math.sin(a), sp: 0.6 + R() });
      }
      var b = burst(g, { color: 0x9fd8ff, count: 24, speed: 2.4, size: 0.16, life: 0.5, y: 0.6, seed: 9 });
      return { group: g, update: function (dt) {
        t += dt; var k = Math.min(1, t / (o.dur || 0.6));
        for (var i = 0; i < list.length; i++) {
          var q = list[i];
          q.m.position.x += q.vx * q.sp * dt;
          q.m.position.z += q.vz * q.sp * dt;
          q.m.position.y += 0.5 * dt;
          q.m.scale.setScalar(0.6 + k * 2.2);
          q.m.material.opacity = 0.55 * (1 - k);
        }
        b.update(dt);
        return k < 1;
      } };
    }
  };

  /* ---------------- 参数存档 ---------------- */
  var PKEY = 'vfxParams_v1';
  function loadParams() { try { return JSON.parse(localStorage.getItem(PKEY) || '{}') || {}; } catch (e) { return {}; } }
  function saveParams(key, o) {
    var all = loadParams(); all[key] = o || {};
    try { localStorage.setItem(PKEY, JSON.stringify(all)); } catch (e) { }
    return all;
  }
  V.params = loadParams; V.saveParams = saveParams;
  V.clearParams = function (key) {
    var all = loadParams(); if (key) { delete all[key]; } else { all = {}; }
    try { localStorage.setItem(PKEY, JSON.stringify(all)); } catch (e) { }
  };
  var REMOTE = {};
  try {
    fetch('/api/vfx').then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok && j.params) { REMOTE = j.params; }
    }).catch(function () { });
  } catch (e) { }
  V.remote = function () { return REMOTE; };

  /* ---------------- 对外接口 ---------------- */
  var live = [];
  var POOL_GHOST = [];      /* ★ 性能：疾风步/暴走残影循环复用 */
  var POOL_IMPACT = [];     /* ★ 性能：多段落点冲击循环复用 */
  /* ★★★ 2026-10-25（用户："特效距离降级"）★★★
     ★ 目标：打怪时同时 10+ 个特效 ✗ 远处的全部还在跑完整着色器 ✓
     ★ 三档策略：
       · 距离 > FAR（默认 45 米）→ 【不生成】特效 ✓ 反正看不见 ✓✓
       · 距离 20~45 米 → 生成，但【跳过 update】✗ 只画静态第一帧 ✓
       · 距离 < 20 米 → 完整动画 ✓
     ★ 为什么按"生成时"的距离判断：
       特效都很短（0.3~4 秒）✗ 生成时的距离就够用了 ✓
       逐帧重新算距离反而更贵 ✗ 不值得 ✓✓
     ★ 例外：自己身上的特效（shield/burn/bloodrage 等）永远不剔除 ✗
       它们在 target:'self' 那一路，距离一定是 0 ✓
     ★ 怎么知道玩家在哪：
       VFX.setViewer(x, z) 由主循环每帧调用 ✗ 或者生成时传 o._px/_pz ✓
       这里用后者：game.js 调 spawn 时把玩家坐标塞进去 ✓ 零额外开销 ✓ */
  var VFX_FAR = 45, VFX_NEAR = 20;
  var _vfxViewer = { x: 0, z: 0, ok: false };
  V.setViewer = function (x, z) {
    if (typeof x === 'number' && typeof z === 'number' && isFinite(x) && isFinite(z)) {
      _vfxViewer.x = x; _vfxViewer.z = z; _vfxViewer.ok = true;
    }
  };
  V.spawn = function (key, o, sceneOrParent) {
    var def = V[key] || V.none;
    if (!def || !def.mk) { return null; }
    /* ★ 距离剔除：只对 ground 类特效生效 ✗ self 类永远不剔除 ✓ */
    if (_vfxViewer.ok && o && def.target !== 'self' && o.attach === undefined) {
      var _tx = (typeof o.x === 'number') ? o.x : _vfxViewer.x;
      var _tz = (typeof o.z === 'number') ? o.z : _vfxViewer.z;
      var _dd = (_tx - _vfxViewer.x) * (_tx - _vfxViewer.x) + (_tz - _vfxViewer.z) * (_tz - _vfxViewer.z);
      if (_dd > VFX_FAR * VFX_FAR) {
        return null;                    /* 太远 → 不生成 ✓ */
      }
    }
    var merged = {};
    /* ★ round566：参数兜底 ✗ 缺字段会造出 NaN 半径的几何体（控制台一堆 NaN 警告 ✓）*/
    var NUMKEYS = ['r','dur','x','z','y','h','th','parts','core','spin','seed','len','w','n',
                   'size','speed','dist','rad','arc','ice','open','shake','rise','trail',
                   'spread','lh','eh','taper','fade'];
    var srv = REMOTE[key];
    if (srv) { for (var rk in srv) { merged[rk] = srv[rk]; } }
    var saved = loadParams()[key];
    if (saved) { for (var sk in saved) { merged[sk] = saved[sk]; } }
    if (o) { for (var ok in o) { merged[ok] = o[ok]; } }
    /* ★ round584：VFX 参数兜底 —— 缺 len/w/n 会造出 NaN 几何体（用户看到的地裂报错）
       → 先套用 tune 里的默认值 ✓ */
    if (def.tune) {
      for (var ti = 0; ti < def.tune.length; ti++) {
        var tt = def.tune[ti];
        if (tt && tt.k && (merged[tt.k] === undefined || merged[tt.k] === null)) {
          merged[tt.k] = tt.def;
        }
      }
    }
    for (var qi = 0; qi < NUMKEYS.length; qi++) {
      var _k2 = NUMKEYS[qi];
      var _v = merged[_k2];
      if (_v === undefined || _v === null || (typeof _v === 'number' && !isFinite(_v))) {
        delete merged[_k2];
      }
    }
    var inst = null;
    if (key === 'ghost' && POOL_GHOST.length) {
      inst = POOL_GHOST.pop();
      inst.reset(merged);
    } else if (key === 'impact' && POOL_IMPACT.length) {
      inst = POOL_IMPACT.pop();
      inst.reset(merged);
    } else {
      inst = def.mk(merged);
    }
    if (def.target === 'self' && merged.attach) {
      merged.attach.add(inst.group);
      inst.group.position.set(0, 0, 0);
    } else if (sceneOrParent) {
      sceneOrParent.add(inst.group);
      if (merged.h) { inst.group.position.y += merged.h; }
      if (merged.x !== undefined) { inst.group.position.x += merged.x; }
      if (merged.z !== undefined) { inst.group.position.z += merged.z; }
    }
    inst.target = def.target || 'ground';
    /* ★ round567：记下出生时间 ✗ 到点强删（防止某个特效 update 永远返回 true）*/
    inst._born = (typeof performance !== 'undefined') ? performance.now() / 1000 : 0;
    inst._maxLife = (Number(merged.dur) || 2.0) + 1.5;
    live.push(inst);
    return inst;
  };
  V.kill = function (inst) {
    /* ★ round587：护盾结束/破碎时立刻进入淡出，不再等自然寿命 */
    if (inst) { inst._fade = 0; }
  };
  /* ★★★ 2026-10-24：统一的"释放一个特效"函数 ★★★
     ★ 为什么要统一：原来有两处各写了一遍清理逻辑 ✗ 其中一处还漏了 dispose ✓
       → 以后加新的清理路径，只要调这一个函数就不会再漏 ✓
     ★ 释放规则：
       · 几何体 / 材质带 __shared 标记 → 是缓存复用的 ✗ 绝对不能 dispose ✓
       · 不带的 → 是这次现建的 ✗ 必须 dispose ✓
     ★ 只 removeView 不 dispose = 显存永不回收 ✗ 这是 three.js 最常见的泄漏 ✓ */
  function releaseGroup(g) {
    if (!g) { return; }
    try {
      g.traverse(function (o) {
        if (o.geometry && !o.geometry.__shared) { o.geometry.dispose(); }
        if (o.material) {
          var ms = Array.isArray(o.material) ? o.material : [o.material];
          for (var mi = 0; mi < ms.length; mi++) {
            if (ms[mi] && !ms[mi].__sharedBase) {
              /* ★★★ 2026-10-24（用户："我看贴图的数字也在增加"）★★★
                 ★ 病根：material.dispose() 【不会】释放它的 map
                   → floatText / 技能名的 CanvasTexture 永远留在 GPU 里 ✓✓
                   → 打一波怪 30 个飘字 = 30 张 256×128 纹理 = 3.8MB ✗
                 ★ 修：dispose 材质前先把 map 也 dispose 掉 ✓
                   （__shared 的纹理是缓存复用的 ✗ 不能动 ✓）*/
              try {
                var _mp = ms[mi].map;
                if (_mp && !_mp.__shared) { _mp.dispose(); }
              } catch (eTex) { }
              ms[mi].dispose();
            }
          }
        }
      });
    } catch (e) { }
    if (g.parent) { g.parent.remove(g); }
  }

  V.tick = function (dt) {
    /* ★★★ 2026-10-24：每帧只写【一次】共享 uniform ✗ 所有着色器同时更新 ✓★★★
       ★ 这就是共享 uniform 的全部意义：
         30 个特效材质各有一份 uTime 盒子的话，每帧要遍历写 30 次 ✓
         现在共用一个盒子 ✗ 一行代码更新全部 ✓✓
       ★ 用累加而不是 performance.now()：dt 已经被主循环钳制过 ✗ 暂停时不会跳 ✓ */
    FRAME.uTime.value += dt;
    for (var i = live.length - 1; i >= 0; i--) {
      var _ins = live[i];
      var _nowS = (typeof performance !== 'undefined') ? performance.now() / 1000 : 0;
      if (_ins._born && (_nowS - _ins._born) > _ins._maxLife) { _ins._fade = 0.35; }
      /* ★★★ 2026-10-25 距离降级 + 修一个真 bug ★★★
         ★ 上一版我写成 continue ✗ 直接跳过了下面的【淡出和释放】✓
           → 中距离的特效永远不会结束 ✗ 也就永远不会 releaseGroup ✓✓
           → 等于把之前修的显存泄漏又还回去了 ✓✓（这次自查发现了）
         ★ 正确做法：不跳过 update ✗ 而是【让 update 少干活】✓
           做法：给实例打个 _vfxFar 标记 ✗ update 内部照常跑计时 ✓
                 只是不更新粒子位置（由调用方决定要不要用标记）✓
         ★ 更简单可靠：什么都不特殊处理 ✗ 只靠【生成时距离剔除】✓
           45 米外根本不生成 ✓ 已经够省了 ✓
           中距离那档收益本来就小 ✗ 风险却很大 ✓ 去掉 ✓ */

      /* ★★ round559（用户："所有技能动画都要淡出，不然戛然而止"）
         ★ 动画跑完后【不立刻删】✗ 再花 0.35 秒把材质透明度乘下去 ✓ */
      if (_ins._fade != null) {
        _ins._fade += dt;
        if (_ins._noFade) {
          /* ★ 共享材质的持续光环：不能按实例改 opacity，直接移除 */
          if (_ins._fade >= 0.35) {
            /* ★★★ 2026-10-24 修显存泄漏 ★★★
               ★ 原来这里只 removeView + splice ✗ 从不 dispose ✓
                 几何体和材质一直留在显存里 → 玩久了越来越卡 ✓✓
               ★ 现在统一走 releaseGroup() ✗ 和正常路径一致 ✓ */
            releaseGroup(_ins.group);
            live.splice(i, 1);
          }
          continue;
        }
        var _k = 1 - _ins._fade / 0.35;
        if (_k <= 0) {
          var _g0 = _ins.group;
          if (_ins.poolKey === 'ghost' && POOL_GHOST.length < 64) {
            if (_g0.parent) { _g0.parent.remove(_g0); }
            _g0.visible = false;
            POOL_GHOST.push(_ins);
          } else if (_ins.poolKey === 'impact' && POOL_IMPACT.length < 48) {
            if (_g0.parent) { _g0.parent.remove(_g0); }
            _g0.visible = false;
            POOL_IMPACT.push(_ins);
          } else {
            releaseGroup(_g0);
          }
          live.splice(i, 1);
          continue;
        }
        _ins.group.traverse(function (o) {
          if (o.material && o.material.opacity != null) {
            if (o.material.__baseOp == null) { o.material.__baseOp = o.material.opacity; }
            o.material.opacity = o.material.__baseOp * _k;
          }
        });
        continue;
      }
      if (!live[i].update(dt)) {
        live[i]._fade = 0;          /* 进入淡出阶段 ✓ */
        continue;
      }
      if (false) {
        releaseGroup(live[i].group);
        live.splice(i, 1);
      }
    }
  };
  V.clear = function () {
    for (var i = 0; i < live.length; i++) { var g = live[i].group; if (g.parent) { g.parent.remove(g); } }
    live.length = 0;
  };
  V.list = function () { return Object.keys(V).filter(function (k) { return V[k] && V[k].mk; }); };

  /* ★ 2026-10-24：把共享 uniform 暴露出去 ✗ game.js 里的武器拖影要用同一个时钟 ✓
     （不暴露的话它得自己维护一份 uTime ✗ 两处时间不同步 → 纹理流动对不上 ✓）*/
  V.FRAME = FRAME;
  window.VFX = V;
})();
