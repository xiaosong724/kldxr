/* ===================================================================
   icons.js —— 技能图标（round539）
   -------------------------------------------------------------------
   ★ 全部【程序画】✗ 不需要美术资源 ✓ 38 个技能每类一套造型 ✓
   ★ 用法：SKI.icon(key, kind) → dataURL  /  SKI.drawTo(ctx, key, kind, size)
   ★ 想改风格只改这里，游戏里所有地方自动跟着变 ✓
   =================================================================== */
(function () {
  'use strict';
  var CACHE = {};

  var PALETTE = {
    A: { bg1: '#1d2b3a', bg2: '#0d1620', ring: '#ffd83d' },   /* 主动：金边 */
    B: { bg1: '#2a1d33', bg2: '#150d1c', ring: '#c084fc' },   /* 被动释放：紫边 */
    C: { bg1: '#1d2f26', bg2: '#0d1c15', ring: '#8ee0a8' }    /* 被动加成：绿边 */
  };

  /* 每个技能的图形（用简单路径画）*/
  var GLYPH = {
    blackhole: 'hole', swordrain: 'swords', earthsplit: 'crack', icefield: 'snow',
    thunder: 'bolt', bloodrage: 'flame', gale: 'wind', shield: 'shield',
    timestop: 'clock', bloodslash: 'slash', judgement: 'bigsword', arrowrain: 'arrows',
    firestorm: 'pillar', blink: 'portal', plague: 'cloud',
    clone: 'person', tank: 'gear', shadowstep: 'dagger', thunderbolt: 'bolt',
    thorns: 'thorns', splitarrow: 'arrows', berserk: 'fist', undying: 'cross',
    bloodthirst: 'drop',
    cdcut: 'clock', skillcrit: 'star', omnivamp: 'drop', skilldmg: 'arrowup',
    qiflow: 'orb', skillten: 'shield', chain: 'chain', masterA: 'sword',
    masterB: 'person', thrifty: 'feather', corrode: 'ring', skrange: 'circle',
    skdur: 'hourglass', extra_crit: 'star'
  };

  function path(ctx, g, s) {
    var c = s / 2, u = s / 100;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#eaf2fb'; ctx.fillStyle = '#eaf2fb'; ctx.lineWidth = 6 * u;
    switch (g) {
      case 'hole': {
        var grd = ctx.createRadialGradient(c, c, 2 * u, c, c, 34 * u);
        grd.addColorStop(0, '#000'); grd.addColorStop(0.55, '#2a0b3d'); grd.addColorStop(1, '#a855f7');
        ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(c, c, 34 * u, 0, 7); ctx.fill();
        ctx.strokeStyle = '#d8b4fe'; ctx.lineWidth = 4 * u;
        ctx.beginPath(); ctx.arc(c, c, 40 * u, 0.4, 2.4); ctx.stroke();
        ctx.beginPath(); ctx.arc(c, c, 44 * u, 3.4, 5.4); ctx.stroke();
        break;
      }
      case 'swords': case 'sword': {
        for (var i = -1; i <= 1; i++) {
          ctx.save(); ctx.translate(c + i * 18 * u, c); ctx.rotate(i * 0.28);
          ctx.fillRect(-3 * u, -28 * u, 6 * u, 46 * u);
          ctx.fillRect(-11 * u, 14 * u, 22 * u, 6 * u);
          ctx.restore();
        }
        break;
      }
      case 'bigsword': {
        ctx.fillRect(c - 5 * u, 10 * u, 10 * u, 60 * u);
        ctx.fillRect(c - 20 * u, 66 * u, 40 * u, 9 * u);
        ctx.beginPath(); ctx.moveTo(c - 5 * u, 10 * u); ctx.lineTo(c, -22 * u);
        ctx.lineTo(c + 5 * u, 10 * u); ctx.closePath(); ctx.fill();
        break;
      }
      case 'crack': {
        ctx.strokeStyle = '#ff7a22'; ctx.lineWidth = 7 * u;
        ctx.beginPath(); ctx.moveTo(10 * u, 80 * u);
        ctx.lineTo(38 * u, 56 * u); ctx.lineTo(28 * u, 40 * u);
        ctx.lineTo(62 * u, 30 * u); ctx.lineTo(88 * u, 16 * u); ctx.stroke();
        break;
      }
      case 'snow': {
        ctx.strokeStyle = '#bfe6ff'; ctx.lineWidth = 6 * u;
        for (var k = 0; k < 6; k++) {
          var a = k * Math.PI / 3;
          ctx.beginPath(); ctx.moveTo(c, c);
          ctx.lineTo(c + Math.cos(a) * 34 * u, c + Math.sin(a) * 34 * u); ctx.stroke();
          /* 小分叉 */
          var mx = c + Math.cos(a) * 20 * u, my = c + Math.sin(a) * 20 * u;
          ctx.beginPath(); ctx.moveTo(mx, my);
          ctx.lineTo(mx + Math.cos(a + 0.7) * 11 * u, my + Math.sin(a + 0.7) * 11 * u);
          ctx.moveTo(mx, my);
          ctx.lineTo(mx + Math.cos(a - 0.7) * 11 * u, my + Math.sin(a - 0.7) * 11 * u);
          ctx.stroke();
        }
        break;
      }
      case 'bolt': {
        ctx.fillStyle = '#bfe6ff';
        ctx.beginPath();
        ctx.moveTo(58 * u, 8 * u); ctx.lineTo(30 * u, 54 * u); ctx.lineTo(48 * u, 54 * u);
        ctx.lineTo(38 * u, 92 * u); ctx.lineTo(72 * u, 42 * u); ctx.lineTo(52 * u, 42 * u);
        ctx.closePath(); ctx.fill();
        break;
      }
      case 'flame': {
        var g2 = ctx.createLinearGradient(0, 90 * u, 0, 8 * u);
        g2.addColorStop(0, '#ff3a1a'); g2.addColorStop(0.6, '#ff8a1a'); g2.addColorStop(1, '#ffe08a');
        ctx.fillStyle = g2;
        ctx.beginPath();
        ctx.moveTo(c, 8 * u);
        ctx.bezierCurveTo(76 * u, 40 * u, 78 * u, 74 * u, c, 92 * u);
        ctx.bezierCurveTo(22 * u, 74 * u, 24 * u, 40 * u, c, 8 * u);
        ctx.fill();
        break;
      }
      case 'pillar': {
        /* 烈焰风暴：三根火柱，和血怒的单团火焰区分开 */
        var g3 = ctx.createLinearGradient(0, 92 * u, 0, 12 * u);
        g3.addColorStop(0, '#ff2a0a'); g3.addColorStop(0.55, '#ff8a1a');
        g3.addColorStop(1, '#ffe08a');
        ctx.fillStyle = g3;
        var pxs = [24, 50, 76], phs = [58, 76, 52];
        for (var pi2 = 0; pi2 < 3; pi2++) {
          var px2 = pxs[pi2] * u, ph2 = phs[pi2] * u;
          ctx.beginPath();
          ctx.moveTo(px2, 92 * u);
          ctx.bezierCurveTo(px2 - 16 * u, 92 * u - ph2 * 0.35,
                            px2 - 12 * u, 92 * u - ph2 * 0.72,
                            px2, 92 * u - ph2);
          ctx.bezierCurveTo(px2 + 12 * u, 92 * u - ph2 * 0.72,
                            px2 + 16 * u, 92 * u - ph2 * 0.35,
                            px2, 92 * u);
          ctx.fill();
        }
        break;
      }
      case 'wind': {
        ctx.strokeStyle = '#d8f6ff'; ctx.lineWidth = 6 * u;
        for (var w2 = 0; w2 < 3; w2++) {
          ctx.beginPath();
          ctx.moveTo(14 * u, (34 + w2 * 18) * u);
          ctx.bezierCurveTo(46 * u, (24 + w2 * 18) * u, 66 * u, (52 + w2 * 16) * u, 88 * u, (34 + w2 * 16) * u);
          ctx.stroke();
        }
        break;
      }
      case 'shield': {
        ctx.strokeStyle = '#8ee0a8'; ctx.fillStyle = 'rgba(102,217,255,0.18)';
        ctx.lineWidth = 6 * u;
        ctx.beginPath();
        ctx.moveTo(c, 12 * u); ctx.lineTo(80 * u, 28 * u); ctx.lineTo(80 * u, 54 * u);
        ctx.quadraticCurveTo(80 * u, 80 * u, c, 92 * u);
        ctx.quadraticCurveTo(20 * u, 80 * u, 20 * u, 54 * u);
        ctx.lineTo(20 * u, 28 * u); ctx.closePath();
        ctx.fill(); ctx.stroke();
        break;
      }
      case 'clock': {
        ctx.strokeStyle = '#9fd8ff'; ctx.lineWidth = 6 * u;
        ctx.beginPath(); ctx.arc(c, c, 34 * u, 0, 7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c, c - 22 * u); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c + 18 * u, c + 8 * u); ctx.stroke();
        break;
      }
      case 'slash': {
        ctx.strokeStyle = '#ff7a33'; ctx.lineWidth = 10 * u;
        ctx.beginPath(); ctx.arc(20 * u, 84 * u, 74 * u, -1.15, -0.15); ctx.stroke();
        break;
      }
      case 'arrows': {
        ctx.strokeStyle = '#ffe08a'; ctx.fillStyle = '#ffe08a'; ctx.lineWidth = 5 * u;
        for (var a2 = 0; a2 < 3; a2++) {
          var ox = (24 + a2 * 24) * u, oy = (16 + a2 * 4) * u;
          ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + 8 * u, oy + 66 * u); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(ox + 8 * u, oy + 72 * u);
          ctx.lineTo(ox + 2 * u, oy + 60 * u); ctx.lineTo(ox + 14 * u, oy + 60 * u);
          ctx.closePath(); ctx.fill();
        }
        break;
      }
      case 'portal': {
        ctx.strokeStyle = '#c79cff'; ctx.lineWidth = 7 * u;
        for (var p2 = 0; p2 < 2; p2++) {
          ctx.beginPath(); ctx.ellipse(c, c, (26 - p2 * 10) * u, (36 - p2 * 12) * u, 0.4, 0, 7); ctx.stroke();
        }
        break;
      }
      case 'cloud': {
        ctx.fillStyle = 'rgba(155,212,74,0.75)';
        [[c - 14 * u, c + 6 * u, 20 * u], [c + 12 * u, c + 8 * u, 17 * u],
         [c, c - 8 * u, 22 * u], [c + 22 * u, c - 4 * u, 13 * u], [c - 24 * u, c - 2 * u, 12 * u]]
          .forEach(function (q) { ctx.beginPath(); ctx.arc(q[0], q[1], q[2], 0, 7); ctx.fill(); });
        break;
      }
      case 'person': {
        ctx.fillStyle = '#c084fc';
        ctx.beginPath(); ctx.arc(c, 32 * u, 15 * u, 0, 7); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(c - 24 * u, 88 * u);
        ctx.quadraticCurveTo(c, 46 * u, c + 24 * u, 88 * u);
        ctx.closePath(); ctx.fill();
        break;
      }
      case 'gear': {
        ctx.strokeStyle = '#ffa733'; ctx.fillStyle = '#ffa733'; ctx.lineWidth = 6 * u;
        for (var gi = 0; gi < 8; gi++) {
          var ga = gi / 8 * Math.PI * 2;
          ctx.save(); ctx.translate(c, c); ctx.rotate(ga);
          ctx.beginPath(); ctx.moveTo(0, -34 * u); ctx.lineTo(0, -45 * u); ctx.stroke();
          ctx.restore();
        }
        ctx.beginPath(); ctx.arc(c, c, 27 * u, 0, 7); ctx.stroke();
        ctx.beginPath(); ctx.arc(c, c, 12 * u, 0, 7); ctx.stroke();
        break;
      }
      case 'dagger': {
        ctx.fillStyle = '#8a5aff';
        ctx.beginPath();
        ctx.moveTo(c, 8 * u); ctx.lineTo(c + 9 * u, 60 * u); ctx.lineTo(c, 52 * u);
        ctx.lineTo(c - 9 * u, 60 * u); ctx.closePath(); ctx.fill();
        ctx.fillRect(c - 14 * u, 62 * u, 28 * u, 6 * u);
        break;
      }
      case 'thorns': {
        ctx.strokeStyle = '#ffb066'; ctx.lineWidth = 6 * u;
        ctx.beginPath(); ctx.arc(c, c, 26 * u, 0, 7); ctx.stroke();
        for (var ti = 0; ti < 8; ti++) {
          var ta = ti / 8 * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(c + Math.cos(ta) * 26 * u, c + Math.sin(ta) * 26 * u);
          ctx.lineTo(c + Math.cos(ta) * 43 * u, c + Math.sin(ta) * 43 * u);
          ctx.stroke();
        }
        break;
      }
      case 'fist': {
        ctx.fillStyle = '#ff6a3a';
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(28 * u, 34 * u, 44 * u, 34 * u, 8 * u)
          : ctx.rect(28 * u, 34 * u, 44 * u, 34 * u);
        ctx.fill();
        ctx.fillRect(24 * u, 26 * u, 12 * u, 22 * u);
        break;
      }
      case 'cross': {
        ctx.fillStyle = '#ffd83d';
        ctx.fillRect(c - 8 * u, 16 * u, 16 * u, 68 * u);
        ctx.fillRect(24 * u, c - 12 * u, 52 * u, 16 * u);
        break;
      }
      case 'drop': {
        var g3 = ctx.createLinearGradient(0, 20 * u, 0, 90 * u);
        g3.addColorStop(0, '#ff6a6a'); g3.addColorStop(1, '#8a0f1a');
        ctx.fillStyle = g3;
        ctx.beginPath();
        ctx.moveTo(c, 14 * u);
        ctx.bezierCurveTo(74 * u, 50 * u, 68 * u, 90 * u, c, 90 * u);
        ctx.bezierCurveTo(32 * u, 90 * u, 26 * u, 50 * u, c, 14 * u);
        ctx.fill();
        break;
      }
      case 'star': {
        ctx.fillStyle = '#ffd83d';
        ctx.beginPath();
        for (var si = 0; si < 10; si++) {
          var sa = -Math.PI / 2 + si * Math.PI / 5;
          var sr = (si % 2 ? 16 : 36) * u;
          var fn = si ? 'lineTo' : 'moveTo';
          ctx[fn](c + Math.cos(sa) * sr, c + Math.sin(sa) * sr);
        }
        ctx.closePath(); ctx.fill();
        break;
      }
      case 'arrowup': {
        ctx.fillStyle = '#8ee0a8';
        ctx.beginPath();
        ctx.moveTo(c, 12 * u); ctx.lineTo(76 * u, 52 * u); ctx.lineTo(60 * u, 52 * u);
        ctx.lineTo(60 * u, 88 * u); ctx.lineTo(40 * u, 88 * u); ctx.lineTo(40 * u, 52 * u);
        ctx.lineTo(24 * u, 52 * u); ctx.closePath(); ctx.fill();
        break;
      }
      case 'orb': {
        var g4 = ctx.createRadialGradient(c - 8 * u, c - 8 * u, 4 * u, c, c, 34 * u);
        g4.addColorStop(0, '#e6f6ff'); g4.addColorStop(1, '#3a8ae0');
        ctx.fillStyle = g4;
        ctx.beginPath(); ctx.arc(c, c, 32 * u, 0, 7); ctx.fill();
        break;
      }
      case 'chain': {
        ctx.strokeStyle = '#9fd8ff'; ctx.lineWidth = 7 * u;
        ctx.beginPath(); ctx.ellipse(c - 12 * u, c, 16 * u, 22 * u, 0.5, 0, 7); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(c + 14 * u, c, 16 * u, 22 * u, 0.5, 0, 7); ctx.stroke();
        break;
      }
      case 'feather': {
        ctx.fillStyle = '#8ee0a8';
        ctx.beginPath();
        ctx.moveTo(70 * u, 24 * u);
        ctx.quadraticCurveTo(30 * u, 40 * u, 26 * u, 82 * u);
        ctx.quadraticCurveTo(64 * u, 70 * u, 70 * u, 24 * u);
        ctx.fill();
        ctx.strokeStyle = '#1d2f26'; ctx.lineWidth = 4 * u;
        ctx.beginPath(); ctx.moveTo(70 * u, 24 * u); ctx.lineTo(30 * u, 78 * u); ctx.stroke();
        break;
      }
      case 'ring': {
        ctx.strokeStyle = '#9bd44a'; ctx.lineWidth = 7 * u;
        ctx.beginPath(); ctx.arc(c, c, 30 * u, 0, 7); ctx.stroke();
        ctx.beginPath(); ctx.arc(c, c, 16 * u, 0, 7); ctx.stroke();
        break;
      }
      case 'circle': {
        ctx.strokeStyle = '#8ee0a8'; ctx.lineWidth = 6 * u;
        ctx.setLineDash([8 * u, 7 * u]);
        ctx.beginPath(); ctx.arc(c, c, 32 * u, 0, 7); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(c, c, 5 * u, 0, 7); ctx.fillStyle = '#8ee0a8'; ctx.fill();
        break;
      }
      case 'hourglass': {
        ctx.strokeStyle = '#8ee0a8'; ctx.lineWidth = 6 * u;
        ctx.beginPath();
        ctx.moveTo(30 * u, 16 * u); ctx.lineTo(70 * u, 16 * u);
        ctx.lineTo(38 * u, 50 * u); ctx.lineTo(70 * u, 84 * u);
        ctx.lineTo(30 * u, 84 * u); ctx.lineTo(62 * u, 50 * u); ctx.closePath();
        ctx.stroke();
        break;
      }
      default: {
        ctx.beginPath(); ctx.arc(c, c, 26 * u, 0, 7);
        ctx.strokeStyle = '#9fb0c2'; ctx.lineWidth = 6 * u; ctx.stroke();
      }
    }
  }

  function drawTo(ctx, key, kind, size) {
    var p = PALETTE[kind] || PALETTE.A;
    /* 背景 */
    var grd = ctx.createLinearGradient(0, 0, 0, size);
    grd.addColorStop(0, p.bg1); grd.addColorStop(1, p.bg2);
    ctx.fillStyle = grd;
    ctx.beginPath();
    var r = size * 0.22;
    if (ctx.roundRect) { ctx.roundRect(0, 0, size, size, r); } else { ctx.rect(0, 0, size, size); }
    ctx.fill();
    /* 边框 */
    ctx.strokeStyle = p.ring; ctx.lineWidth = Math.max(1.5, size * 0.045);
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(1, 1, size - 2, size - 2, r); } else { ctx.rect(1, 1, size - 2, size - 2); }
    ctx.stroke();
    /* 图形 */
    ctx.save();
    ctx.translate(size * 0.04, size * 0.04);
    path(ctx, GLYPH[key] || 'default', size * 0.92);
    ctx.restore();
  }

  function icon(key, kind, size) {
    size = size || 44;
    var k = key + '|' + kind + '|' + size;
    if (CACHE[k]) { return CACHE[k]; }
    try {
      var cv = document.createElement('canvas');
      cv.width = size; cv.height = size;
      drawTo(cv.getContext('2d'), key, kind, size);
      CACHE[k] = cv.toDataURL('image/png');
      return CACHE[k];
    } catch (e) { return ''; }
  }

  window.SKI = { icon: icon, drawTo: drawTo, GLYPH: GLYPH };
})();
