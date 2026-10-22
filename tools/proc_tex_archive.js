/* 程序化贴图生成器（存档，不参与游戏）
   ------------------------------------------------------------------
   背景：2026-10-18 做过一版"程序化贴图"（Canvas 噪声生成，无版权问题），
        在设置里做成了可切换（原版 / 程序化）。用户看过样图后决定：
        「看起来没什么区别，不用改了，你觉得哪个好就用哪个吧，不要设置切换了」
        → 最终保留【原版贴图】（细节/明暗层次更好），本文件只是把生成器存下来，
          以后如果要把客户端公开分发（MC 原版贴图不能分发），直接拿这份代码用。

   用法（放到 web/platform/ 里，平台层可以用 Canvas）：
     1. 每张方块贴图：procTexMake(kind, seed) → HTMLCanvasElement（32×32）
        kind: grass / dirt / stone / brick / plank / log / water / leaf
     2. 大地面那层（ground_mix）：procTexGround(seed)
     3. 换进游戏：tex.image = canvas; tex.needsUpdate = true;
        ★ 程序化图已经是末日色调 → 材质的 color 要设成 0xffffff（否则再乘 TINT 会发黑）
     4. 还原原版：切换前把 tex.image 原对象存起来，切回去时放回 + needsUpdate

   ★ 踩过的两个坑（都写在这里，免得以后重踩）：
     1) 别写 `var T = (typeof T !== 'undefined') ? T : null;`
        —— var 提升会让右边那个 T 指向刚声明的局部变量 → 永远 undefined → 静默失败
     2) 只换 T/M 里的贴图是不够的：可见的主地面用的是 groundMaterial() 的
        ground_mix.png（不在 T 里）→ 一定要单独把它的 map.image 也换掉
   ------------------------------------------------------------------ */

function procTexRandom(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function procTexMake(kind, seed) {
  var N = 32, cv = document.createElement('canvas');
  cv.width = N; cv.height = N;
  var g = cv.getContext('2d');
  var R = procTexRandom(seed || 1);
  var base = {
    grass: 0x9a9670, dirt: 0x8f8070, stone: 0x8e8e8c, brick: 0x8f8a84,
    plank: 0x7d6f5c, log: 0x6e5f4c, water: 0x4f625c, leaf: 0x8a8258
  }[kind] || 0x888888;
  function sh(k) {
    var r = Math.max(0, Math.min(255, Math.round(((base >> 16) & 255) * k)));
    var g2 = Math.max(0, Math.min(255, Math.round(((base >> 8) & 255) * k)));
    var b = Math.max(0, Math.min(255, Math.round((base & 255) * k)));
    return 'rgb(' + r + ',' + g2 + ',' + b + ')';
  }
  g.fillStyle = sh(1); g.fillRect(0, 0, N, N);
  var i, x, y;
  for (i = 0; i < 150; i++) {
    g.fillStyle = sh(0.9 + R() * 0.2);
    g.fillRect(Math.floor(R() * N), Math.floor(R() * N), 1, 1);
  }
  for (i = 0; i < 22; i++) {
    g.fillStyle = sh(0.86 + R() * 0.24);
    var w2 = 1 + Math.floor(R() * 3);
    g.fillRect(Math.floor(R() * N), Math.floor(R() * N), w2, w2);
  }
  if (kind === 'grass') {
    for (i = 0; i < 40; i++) {
      x = R() * N; y = R() * N;
      g.strokeStyle = sh(0.82 + R() * 0.4);
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 1.2, y - 1 - R() * 2.2); g.stroke();
    }
  } else if (kind === 'dirt') {
    g.strokeStyle = sh(0.72);
    for (i = 0; i < 3; i++) {
      g.beginPath(); x = R() * N; y = R() * N; g.moveTo(x, y);
      for (var k2 = 0; k2 < 3; k2++) { x += (R() - 0.5) * 8; y += (R() - 0.5) * 8; g.lineTo(x, y); }
      g.stroke();
    }
  } else if (kind === 'stone') {
    g.strokeStyle = sh(0.78); g.lineWidth = 1;
    for (i = 1; i < 3; i++) {
      g.beginPath(); g.moveTo(0, i * (N / 3) + R() * 2);
      for (x = 0; x <= N; x += 6) { g.lineTo(x, i * (N / 3) + (R() - 0.5) * 2); }
      g.stroke();
    }
  } else if (kind === 'brick') {
    var bh = N / 4, bw = N / 2;
    for (y = 0; y < N; y += bh) {
      var off = ((y / bh) % 2) ? bw / 2 : 0;
      for (x = -bw; x < N; x += bw) {
        g.fillStyle = sh(0.9 + R() * 0.18);
        g.fillRect(x + off + 1, y + 1, bw - 2, bh - 2);
      }
      g.fillStyle = sh(0.66); g.fillRect(0, y, N, 1);
    }
    g.fillStyle = sh(0.6);
    for (x = 0; x < N; x += bw) { g.fillRect(x, 0, 1, N); }
  } else if (kind === 'plank') {
    var ph = N / 4;
    for (y = 0; y < N; y += ph) {
      g.fillStyle = sh(0.92 + R() * 0.14);
      g.fillRect(0, y + 1, N, ph - 1);
      g.fillStyle = sh(0.62); g.fillRect(0, y, N, 1);
      for (i = 0; i < 4; i++) {
        g.fillStyle = sh(0.82 + R() * 0.22);
        g.fillRect(R() * N, y + 1 + R() * (ph - 2), 3 + R() * 6, 1);
      }
    }
  } else if (kind === 'log') {
    for (i = 0; i < 14; i++) {
      g.fillStyle = sh(0.72 + R() * 0.36);
      g.fillRect(Math.floor(R() * N), 0, 1, N);
    }
  } else if (kind === 'water') {
    for (i = 0; i < 8; i++) {
      var yy = R() * N;
      g.strokeStyle = sh(0.86 + R() * 0.3); g.lineWidth = 1;
      g.beginPath();
      for (x = 0; x <= N; x += 4) { g.lineTo(x, yy + Math.sin((x / N) * 6.28 + R()) * 0.8); }
      g.stroke();
    }
  } else if (kind === 'leaf') {
    for (i = 0; i < 26; i++) {
      g.fillStyle = sh(0.8 + R() * 0.36);
      g.fillRect(Math.floor(R() * N), Math.floor(R() * N), 1 + Math.floor(R() * 2), 1 + Math.floor(R() * 2));
    }
  }
  g.globalAlpha = 0.16; g.fillStyle = '#000';
  g.fillRect(0, 0, N, 1); g.fillRect(0, N - 1, N, 1);
  g.fillRect(0, 0, 1, N); g.fillRect(N - 1, 0, 1, N);
  g.globalAlpha = 1;
  return cv;
}

function procTexGround(seed) {
  var N = 32, cv = document.createElement('canvas');
  cv.width = N; cv.height = N;
  var g = cv.getContext('2d');
  var R = procTexRandom(seed || 7);
  g.fillStyle = '#8a7460'; g.fillRect(0, 0, N, N);
  for (var i = 0; i < 130; i++) {
    g.fillStyle = (R() < 0.55) ? '#7f6a58' : '#96836d';
    g.fillRect(Math.floor(R() * N), Math.floor(R() * N), 2 + Math.floor(R() * 4), 2 + Math.floor(R() * 4));
  }
  for (i = 0; i < 26; i++) {
    g.fillStyle = '#8f8a62';
    g.fillRect(Math.floor(R() * N), Math.floor(R() * N), 2 + Math.floor(R() * 3), 2 + Math.floor(R() * 3));
  }
  for (i = 0; i < 160; i++) {
    g.fillStyle = (R() < 0.5) ? '#7a6753' : '#9a8a72';
    g.fillRect(Math.floor(R() * N), Math.floor(R() * N), 1, 1);
  }
  g.globalAlpha = 0.10; g.fillStyle = '#000';
  for (i = 0; i < N; i += 8) { g.fillRect(i, 0, 1, N); g.fillRect(0, i, N, 1); }
  g.globalAlpha = 1;
  return cv;
}

/* 供 Node 里捡起来检查语法用（浏览器里没有 module）*/
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { procTexMake: procTexMake, procTexGround: procTexGround };
}
