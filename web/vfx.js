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
  function M(c, o) { var m = new THREE.MeshBasicMaterial({ color: c, transparent: true }); if (o) { for (var k in o) { m[k] = o[k]; } } return m; }
  function grp() { return new THREE.Group(); }
  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  /* ---------- 粒子 ---------- */
  function burst(g, o) {
    var n = o.count || 30, r = rnd(o.seed || 7), pos = new Float32Array(n * 3), v = [];
    for (var i = 0; i < n; i++) {
      var a = r() * Math.PI * 2, e = (r() - 0.15) * Math.PI * 0.6, sp = (o.speed || 4) * (0.4 + r());
      pos[i * 3] = 0; pos[i * 3 + 1] = o.y || 0.6; pos[i * 3 + 2] = 0;
      v.push({ dx: Math.cos(a) * Math.cos(e) * sp, dy: Math.sin(e) * sp + (o.up || 1.2), dz: Math.sin(a) * Math.cos(e) * sp });
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    var obj = new THREE.Points(geo, new THREE.PointsMaterial({ color: o.color || 0xffaa33,
      size: o.size || 0.22, transparent: true, opacity: 1, sizeAttenuation: true, depthWrite: false }));
    g.add(obj);
    var pos0 = new Float32Array(pos);
    var v0 = v.map(function (p) { return { dx: p.dx, dy: p.dy, dz: p.dz }; });
    return { obj: obj, t: 0, life: o.life || 0.7, v: v, geo: geo, pos: pos, grav: o.grav == null ? 5.8 : o.grav,
      reset: function () {
        this.t = 0;
        this.pos.set(pos0);
        for (var i = 0; i < this.v.length; i++) {
          this.v[i].dx = v0[i].dx; this.v[i].dy = v0[i].dy; this.v[i].dz = v0[i].dz;
        }
        this.geo.attributes.position.needsUpdate = true;
        this.obj.material.opacity = 1;
      },
      update: function (dt) {
        this.t += dt; var k = this.t / this.life;
        for (var i = 0; i < this.v.length; i++) {
          var p = this.v[i];
          p.dy -= this.grav * dt;
          this.pos[i * 3] += p.dx * dt; this.pos[i * 3 + 1] += p.dy * dt; this.pos[i * 3 + 2] += p.dz * dt;
        }
        this.geo.attributes.position.needsUpdate = true;
        this.obj.material.opacity = Math.max(0, 1 - k);
        return k < 1;
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
    var b = new THREE.Mesh(new THREE.BoxGeometry(o.w || 1.5, o.h || 2.4, o.d || 1.3),
      M(0xbfe9ff, { opacity: 0.42, depthWrite: false }));
    b.position.y = (o.h || 2.4) / 2; g.add(b);
    for (var i = 0; i < 6; i++) {
      var m = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 4), M(0xe6f9ff, { opacity: 0.75 }));
      var a = i / 6 * Math.PI * 2;
      m.position.set(Math.cos(a) * 0.8, 0.4 + (i % 3) * 0.6, Math.sin(a) * 0.7);
      m.rotation.z = -Math.cos(a); g.add(m);
    }
    return { t: 0, dur: o.dur || 2.2, update: function (dt) {
      this.t += dt; var k = Math.min(1, this.t / this.dur);
      b.material.opacity = 0.42 * (1 - Math.max(0, (k - 0.7) / 0.3));
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
      var ground = new THREE.Mesh(new THREE.RingGeometry(r - 0.3, r, 64),
        M(0xa855f7, { side: THREE.DoubleSide, opacity: 0.35 }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = 0.05; g.add(ground);
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
        ground.material.opacity = 0.35 * (0.55 + 0.45 * Math.sin(t * 8));
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
          ground.material.opacity = Math.max(0, 0.35 * (1 - w));
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
          var w = ringWave(sub, { color: 0x9fd8ff, r0: 0.3, r1: 1.8, dur: 0.4, thick: 0.15, alpha: 0.8 });
          parts.push({ t: -i * (o.dur / o.n), sw: sw, w: w, fall: 12 / Math.max(2, o.speed), phase: 0,
            update: function (dt) {
              this.t += dt;
              if (this.t < 0) { return true; }
              if (this.phase === 0) {
                this.sw.position.y = 12 * (1 - ease(Math.min(1, this.t / this.fall))) + 0.1;
                if (this.t >= this.fall) { this.phase = 1; this.t = 0; this.sw.visible = false; }
              } else {
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
          parts.push({ t: -R() * (o.dur * 0.7), ar: ar, fall: 11 / Math.max(3, o.speed), update: function (dt) {
            this.t += dt; if (this.t < 0) { return true; }
            var k = Math.min(1, this.t / this.fall);
            this.ar.position.y = 11 * (1 - k) + 0.1;
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
    mk: function (o) {
      var g = grp(), t = 0, R = rnd(o.seed || 1);
      var base = new THREE.Mesh(new THREE.CircleGeometry(o.r, 44),
        M(0xff4d00, { side: THREE.DoubleSide, opacity: 0.3 }));
      base.rotation.x = -Math.PI / 2; base.position.y = 0.04; g.add(base);
      var layers = [];
      for (var L = 0; L < 3; L++) {
        var l = grp(); g.add(l);
        var segs = 18 + L * 6;
        for (var i = 0; i < segs; i++) {
          var k2 = i / segs;
          var rr = o.r * (0.25 + k2 * 0.9) * (1 - L * 0.18);
          var part = new THREE.Mesh(new THREE.SphereGeometry(0.22 + k2 * 0.5, 6, 5),
            M(L === 0 ? 0xff2a00 : (L === 1 ? 0xff8a1a : 0xffd86a),
              { opacity: 0.5 - L * 0.1, depthWrite: false }));
          var ang = i * 1.1 + L;
          part.position.set(Math.cos(ang) * rr, k2 * (o.th || 8), Math.sin(ang) * rr);
          l.add(part);
        }
        layers.push(l);
      }
      var em = burst(g, { color: 0xffb347, count: 40, speed: 2.5, size: 0.2, life: 1.4,
        y: 0.4, up: 2.6, grav: -1.5, seed: 5 });
      var smoke = [];
      for (var s2 = 0; s2 < 14; s2++) {
        var sm = new THREE.Mesh(new THREE.SphereGeometry(0.5 + R() * 0.4, 6, 5),
          M(0x2a1a14, { opacity: 0.2, depthWrite: false }));
        var a2 = R() * 6.28, r2 = o.r * (0.8 + R() * 0.4);
        sm.position.set(Math.cos(a2) * r2, 0.6 + R() * (o.th || 8) * 0.5, Math.sin(a2) * r2);
        g.add(sm); smoke.push({ m: sm, sp: 0.3 + R() * 0.5 });
      }
      return { group: g, update: function (dt) {
        t += dt; var k = Math.min(1, t / o.dur);
        for (var i = 0; i < layers.length; i++) {
          layers[i].rotation.y += dt * o.spin * (1 + i * 0.35);
          layers[i].scale.setScalar(1 + Math.sin(t * 6 + i) * 0.04);
        }
        base.material.opacity = 0.3 * (0.7 + 0.3 * Math.sin(t * 9)) * (1 - Math.max(0, (k - 0.85) / 0.15));
        for (var j = 0; j < smoke.length; j++) {
          smoke[j].m.position.y += dt * smoke[j].sp;
          smoke[j].m.material.opacity = 0.2 * (1 - k);
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
      var disc = new THREE.Mesh(new THREE.CircleGeometry(o.r, 44),
        M(0x9fe8ff, { side: THREE.DoubleSide, opacity: 0.28 }));
      disc.rotation.x = -Math.PI / 2; disc.position.y = 0.04; g.add(disc);
      parts.push({ t: 0, update: function (dt) {
        this.t += dt; disc.material.opacity = 0.28 * Math.max(0, 1 - this.t / (o.dur + 0.6));
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
      var sh = new THREE.Mesh(new THREE.CircleGeometry(o.r, 40),
        M(0x000000, { side: THREE.DoubleSide, opacity: 0.4 }));
      sh.rotation.x = -Math.PI / 2; sh.position.y = 0.05; g.add(sh);
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
      var lava = new THREE.Mesh(new THREE.PlaneGeometry(o.w * 0.45, o.len * 0.96),
        M(0xff5a00, { side: THREE.DoubleSide, opacity: 0.9 }));
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
        lava.material.opacity = 0.9 * (0.7 + 0.3 * Math.sin(this.t * 20));
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
      var dial = new THREE.Mesh(new THREE.RingGeometry(o.r * 0.9, o.r, 72),
        M(0xbfe6ff, { side: THREE.DoubleSide, opacity: 0.75 }));
      dial.rotation.x = -Math.PI / 2; dial.position.y = 0.05; g.add(dial);
      var inner = new THREE.Mesh(new THREE.CircleGeometry(o.r * 0.9, 60),
        M(0x2a4a6a, { side: THREE.DoubleSide, opacity: 0.18 }));
      inner.rotation.x = -Math.PI / 2; inner.position.y = 0.045; g.add(inner);
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
        dial.material.opacity = 0.75 * fade; inner.material.opacity = 0.18 * fade;
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
      var m = new THREE.Mesh(new THREE.SphereGeometry(o.r, 20, 14),
        M(0xff3a3a, { opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
      m.position.y = 1.1; g.add(m);
      var rm = new THREE.Mesh(new THREE.RingGeometry(o.r * 1.05, o.r * 1.2, 40),
        M(0xff3a3a, { side: THREE.DoubleSide, opacity: 0.55, depthWrite: false }));
      rm.rotation.x = -Math.PI / 2; rm.position.y = 0.06; g.add(rm);
      var b = burst(g, { color: 0xff4d4d, count: 40, speed: 3.4, size: 0.2, life: 0.6, seed: 11 });
      return { group: g, t: 0, update: function (dt) {
        this.t += dt; var k = Math.min(1, this.t / o.dur);
        m.material.opacity = 0.22 * (1 - k);
        rm.scale.setScalar(1 + k * 0.5); rm.material.opacity = 0.55 * (1 - k);
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
    tune: [{ k: 'r', label: '半径', min: 0.6, max: 2.2, step: 0.1, def: 1.05 },
      { k: 'dur', label: '持续', min: 1, max: 40, step: 0.5, def: 30 }],
    mk: function (o) {
      var g = grp(), t = 0, R = o.r || 1.05;
      var ball = new THREE.Mesh(new THREE.SphereGeometry(R, 20, 14),
        M(0x66d8ff, { opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
      ball.position.y = 1.0; g.add(ball);
      var ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.92, 0.035, 8, 36),
        M(0xbfefff, { opacity: 0.65, depthWrite: false }));
      ring.rotation.x = Math.PI / 2; ring.position.y = 1.0; g.add(ring);
      var ring2 = ring.clone(); ring2.rotation.set(0, 0, 0);
      ring2.position.y = 0.55; g.add(ring2);
      return { group: g, update: function (dt) {
        t += dt;
        var pulse = 1 + 0.03 * Math.sin(t * 4.5);
        ball.scale.setScalar(pulse);
        ring.rotation.z += dt * 0.8; ring2.rotation.z -= dt * 0.6;
        var fade = Math.min(1, (o.dur - t) / 0.5);
        ball.material.opacity = 0.16 * Math.max(0, fade);
        ring.material.opacity = 0.65 * Math.max(0, fade);
        ring2.material.opacity = 0.45 * Math.max(0, fade);
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
      var r = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.5, 20),
        M(0xffd08a, { side: THREE.DoubleSide, opacity: 0.85, depthWrite: false }));
      r.rotation.x = -Math.PI / 2; r.position.y = 0.05; g.add(r);
      var b = burst(g, { color: 0xffb347, count: 12, speed: 3, size: 0.13,
                         life: 0.3, y: 0.3, seed: 9 });
      var inst = { group: g, ring: r, burst: b, poolKey: 'impact', dur: o.dur || 0.32,
        reset: function (no) {
          this.t = 0;
          this.dur = Number(no.dur) || 0.32;
          this.ring.scale.setScalar(1);
          this.ring.material.opacity = 0.85;
          this.burst.reset();
          this.group.position.set(0, 0, 0);
          this.group.visible = true;
          this._fade = null;
        },
        update: function (dt) {
          this.t = (this.t || 0) + dt;
          var k = Math.min(1, this.t / this.dur);
          r.scale.setScalar(1 + k * 1.4);
          r.material.opacity = 0.85 * (1 - k);
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
      var ai = afterimages(g, { n: o.n, dur: o.dur, color: 0xff3020, drift: o.drift });
      var b = burst(g, { color: 0xff6a3a, count: 30, speed: 3.5, size: 0.2, life: 0.7, seed: 5 });
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
      var ft = floatText(g, { text: o.text || '攻速+', y: 2.6, rise: o.rise, dur: o.dur, size: o.size, color: '#ff7a4d' });
      var b = burst(g, { color: 0xd01a1a, count: 22, speed: 2.6, size: 0.2, life: 0.7, seed: 4 });
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
      var ring = new THREE.Mesh(new THREE.RingGeometry(o.r - 0.1, o.r, 48),
        M(0xff6a1a, { side: THREE.DoubleSide, opacity: 0.45 }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; g.add(ring);
      for (var i = 0; i < o.n; i++) {
        var m = new THREE.Mesh(new THREE.ConeGeometry(0.16 + R() * 0.12, 0.6 + R() * 0.7, 5),
          M(R() > 0.5 ? 0xff5a00 : 0xffb347, { opacity: 0.8 }));
        var a = R() * 6.28, d = R() * o.r * 0.7;
        m.position.set(Math.cos(a) * d, 0.4, Math.sin(a) * d);
        g.add(m); flames.push({ m: m, ph: R() * 6.28, sp: 1 + R() });
      }
      return { group: g, t: 0, update: function (dt) {
        this.t += dt; var k = Math.min(1, this.t / o.dur);
        for (var i = 0; i < flames.length; i++) {
          var f = flames[i];
          f.m.scale.y = 0.7 + Math.sin(this.t * 9 * f.sp + f.ph) * 0.35;
          f.m.material.opacity = 0.8 * (1 - k);
        }
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
        parts.push({ t: -i * 0.16, p: pillar(sub, { color: 0xdfe9ff, w: 0.5, h: 14, dur: 0.3 }),
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
      var m = new THREE.Mesh(new THREE.RingGeometry(o.rad * 0.25, o.rad, 40, 1, -o.arc / 2, o.arc),
        M(0xff2a2a, { side: THREE.DoubleSide, opacity: 0.85, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.y = 1.0; g.add(m);
      var m2 = new THREE.Mesh(new THREE.RingGeometry(o.rad * 0.2, o.rad * 0.82, 40, 1, -o.arc / 2, o.arc),
        M(0xffb0b0, { side: THREE.DoubleSide, opacity: 0.5, depthWrite: false }));
      m2.rotation.x = -Math.PI / 2; m2.position.y = 1.02; g.add(m2);
      var b = burst(g, { color: 0xff5a3a, count: 26, speed: 5, size: 0.2, life: 0.5, y: 1.0, seed: 6 });
      return { group: g, t: 0, update: function (dt) {
        this.t += dt; var k = Math.min(1, this.t / o.dur);
        m.material.opacity = 0.85 * (1 - k); m2.material.opacity = 0.5 * (1 - k);
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
    mk: function (o) {
      var g = grp(), t = 0, R = rnd(o.seed || 8);
      var pts = [], N = 8, h = o.h;
      for (var i = 0; i <= N; i++) {
        pts.push(new THREE.Vector3((R() - 0.5) * (i > 0 && i < N ? 1 : 0.15),
          h * (1 - i / N), (R() - 0.5) * (i > 0 && i < N ? 1 : 0.15)));
      }
      var curve = new THREE.CatmullRomCurve3(pts);
      var tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, o.w * 0.4, 5, false),
        M(0xb066ff, { opacity: 0.95, depthWrite: false }));
      g.add(tube);
      var tube2 = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, o.w * 0.16, 5, false),
        M(0xf0d8ff, { opacity: 0.95, depthWrite: false }));
      g.add(tube2);
      var b = burst(g, { color: 0xb066ff, count: 22, speed: 4.5, size: 0.18, life: 0.45, seed: 3 });
      return { group: g, update: function (dt) {
        t += dt; var k = Math.min(1, t / o.dur);
        tube.material.opacity = 0.95 * (1 - k); tube2.material.opacity = 0.95 * (1 - k);
        b.update(dt);
        return k < 1;
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
      var a2 = new THREE.Mesh(new THREE.SphereGeometry(1.35, 16, 12),
        M(0xd08a3a, { opacity: 0.28, depthWrite: false }));
      a2.position.y = 1.0; g.add(a2);
      return { group: g, t: 0, update: function (dt) {
        this.t += dt; var k = Math.min(1, this.t / o.dur);
        for (var i = 0; i < list.length; i++) { list[i].material.opacity = 0.9 * (1 - k); }
        a2.material.opacity = 0.28 * (1 - k);
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
      var m = new THREE.Mesh(new THREE.SphereGeometry(o.r, 20, 14),
        M(0xffd83d, { opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
      m.position.y = 1.1; g.add(m);
      var b = burst(g, { color: 0xffe98a, count: 50, speed: 3.6, size: 0.22, life: 0.9, seed: 13 });
      return { group: g, t: 0, update: function (dt) {
        this.t += dt; var k = Math.min(1, this.t / o.dur);
        m.material.opacity = 0.3 * (1 - k); m.scale.setScalar(1 + k * 0.2);
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
    label: '病毒扩散（粒子）', target: 'ground',
    tune: [{ k: 'r', label: '范围', min: 0.6, max: 4, step: 0.1, def: 1.6 },
      { k: 'dur', label: '持续', min: 0.5, max: 4, step: 0.1, def: 2.2 },
      { k: 'parts', label: '粒子数', min: 20, max: 300, step: 10, def: 120 }],
    mk: function (o) {
      var g = grp(), R = rnd(o.seed || 16);
      var n = o.parts, pos = new Float32Array(n * 3), vel = [];
      for (var i = 0; i < n; i++) {
        var a = R() * 6.28, d = R() * o.r, y = 0.2 + R() * 1.6;
        pos[i * 3] = Math.cos(a) * d; pos[i * 3 + 1] = y; pos[i * 3 + 2] = Math.sin(a) * d;
        vel.push({ a: a, d: d, y: y, sp: 0.2 + R() * 0.6, rise: 0.2 + R() * 0.5 });
      }
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      var obj = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x9bd44a, size: 0.28,
        transparent: true, opacity: 0.75, sizeAttenuation: true, depthWrite: false }));
      g.add(obj);
      return { group: g, t: 0, update: function (dt) {
        this.t += dt; var k = Math.min(1, this.t / o.dur);
        var arr = geo.attributes.position.array;
        for (var i = 0; i < vel.length; i++) {
          var p = vel[i];
          p.y += p.rise * dt; p.d += p.sp * dt * 0.4; p.a += dt * 0.5;
          arr[i * 3] = Math.cos(p.a) * p.d; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = Math.sin(p.a) * p.d;
        }
        geo.attributes.position.needsUpdate = true;
        obj.material.opacity = 0.75 * (1 - k);
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
  V.spawn = function (key, o, sceneOrParent) {
    var def = V[key] || V.none;
    if (!def || !def.mk) { return null; }
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
  V.tick = function (dt) {
    for (var i = live.length - 1; i >= 0; i--) {
      var _ins = live[i];
      var _nowS = (typeof performance !== 'undefined') ? performance.now() / 1000 : 0;
      if (_ins._born && (_nowS - _ins._born) > _ins._maxLife) { _ins._fade = 0.35; }
      /* ★★ round559（用户："所有技能动画都要淡出，不然戛然而止"）
         ★ 动画跑完后【不立刻删】✗ 再花 0.35 秒把材质透明度乘下去 ✓ */
      if (_ins._fade != null) {
        _ins._fade += dt;
        if (_ins._noFade) {
          /* ★ 共享材质的持续光环：不能按实例改 opacity，直接移除 */
          if (_ins._fade >= 0.35) {
            var _gn = _ins.group;
            if (_gn.parent) { _gn.parent.remove(_gn); }
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
            _g0.traverse(function (o) { if (o.geometry) { if (!o.geometry.__shared) { o.geometry.dispose(); } } if (o.material) { o.material.dispose(); } });
            if (_g0.parent) { _g0.parent.remove(_g0); }
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
        var g = live[i].group;
        g.traverse(function (o) { if (o.geometry) { if (!o.geometry.__shared) { o.geometry.dispose(); } } if (o.material) { o.material.dispose(); } });
        if (g.parent) { g.parent.remove(g); }
        live.splice(i, 1);
      }
    }
  };
  V.clear = function () {
    for (var i = 0; i < live.length; i++) { var g = live[i].group; if (g.parent) { g.parent.remove(g); } }
    live.length = 0;
  };
  V.list = function () { return Object.keys(V).filter(function (k) { return V[k] && V[k].mk; }); };

  window.VFX = V;
})();
