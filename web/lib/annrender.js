/* ============================================================
   公告渲染器（游戏内 / 管理页预览 / 独立预览页 共用这一份）
   ★ 样式照抄 tools/poster_lib.js（就是我们发群那套图的格式）
   ★ 只有一个出口：AnnRender.html(data) → 一段 HTML 字符串
   ★ 允许 <b> <br>，其它一律转义（服务端也会过滤一遍 ✓）
   ============================================================ */
(function (root) {
  var TAG_COL = {
    '战斗': '#ff9a5c', '玩法': '#ff9a5c',
    '掉落': '#8ee0a8', '优化': '#8ee0a8',
    '挂机': '#8fd28a',
    '成长': '#8fc4ff', '系统': '#8fc4ff',
    '背包': '#c08fff',
    '装备': '#ffd83d',
    '交易行': '#ffe08a',
    '画面': '#5cf0ff',
    '修复': '#ff6a5c', '修复bug': '#ff6a5c',
    '提示': '#9fb08f',
    '群': '#5cd0ff',
    '其它': '#b9c2a8'
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  /* 只放行 <b> <br>（其它全转义 ✓）*/
  function rich(s) {
    var t = esc(s);
    t = t.replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>');
    t = t.replace(/&lt;br\s*\/?&gt;/g, '<br>');
    return t;
  }
  function tagColor(t) { return TAG_COL[t] || '#dfe8d4'; }

  /* 样式：sc = 缩放（游戏内小面板用 0.62 左右；海报页用 1）*/
  function css(sc) {
    var k = sc || 1;
    function px(v) { return (v * k).toFixed(2).replace(/\.00$/, '') + 'px'; }
    return '' +
      '.ann{position:relative;background:#14120d;color:#dfe8d4;' +
        'font-family:system-ui,"Microsoft YaHei","PingFang SC",sans-serif;' +
        'padding:' + px(46) + ' ' + px(44) + ' ' + px(38) + ';' +
        'background-image:' +
          'radial-gradient(1200px 620px at 50% -8%, #3d3424 0%, #241f16 46%, #14120d 100%),' +
          'repeating-linear-gradient(0deg,#0000 0 38px,#ffffff06 38px 39px),' +
          'repeating-linear-gradient(90deg,#0000 0 38px,#ffffff06 38px 39px)}' +
      '.ann .annHd{text-align:center;margin-bottom:' + px(24) + '}' +
      '.ann h1{font-size:' + px(56) + ';letter-spacing:' + px(12) + ';color:#ffd83d;' +
        'font-weight:800;line-height:1.15;text-shadow:0 3px 0 #00000077,0 0 30px #ffd83d44}' +
      '.ann .annSub{margin-top:' + px(11) + ';font-size:' + px(19) + ';color:#b9c2a8;letter-spacing:' + px(2) + '}' +
      '.ann .annLine{width:' + px(200) + ';height:' + px(3) + ';margin:' + px(16) + ' auto 0;border-radius:2px;' +
        'background:linear-gradient(90deg,#ffd83d00,#ffd83dbb,#ffd83d00)}' +
      '.ann .annGrid{column-gap:' + px(15) + ';column-count:2}' +
      '.ann .annCard{background:linear-gradient(180deg,#252a2299,#1a1d1899);' +
        'border:' + px(2) + ' solid #ffffff16;border-radius:' + px(14) + ';' +
        'padding:' + px(14) + ' ' + px(16) + ' ' + px(13) + ';' +
        'box-shadow:0 7px 20px #00000066,inset 0 1px 0 #ffffff10;' +
        'break-inside:avoid;-webkit-column-break-inside:avoid;margin-bottom:' + px(15) + '}' +
      '.ann .annCh{display:flex;align-items:center;gap:' + px(12) + ';margin-bottom:' + px(9) + '}' +
      '.ann .annNo{font-size:' + px(26) + ';font-weight:800;color:#ffd83d;letter-spacing:' + px(1) + ';' +
        'font-variant-numeric:tabular-nums;text-shadow:0 2px 0 #00000066;min-width:' + px(42) + '}' +
      '.ann .annTag{display:inline-block;padding:' + px(1) + ' ' + px(8) + ';border:1px solid;' +
        'border-radius:' + px(20) + ';font-size:' + px(11.5) + ';letter-spacing:' + px(2) + ';margin-bottom:' + px(5) + '}' +
      '.ann .annH{font-size:' + px(20.5) + ';font-weight:800;color:#eef4e4;letter-spacing:' + px(1) + ';line-height:1.3}' +
      '.ann ul{list-style:none;margin:0;padding:0}' +
      '.ann li{position:relative;padding-left:' + px(15) + ';font-size:' + px(13.5) + ';' +
        'line-height:1.72;color:#c2ccb4;margin-top:' + px(3) + '}' +
      '.ann li:before{content:"";position:absolute;left:' + px(2) + ';top:' + px(9) + ';' +
        'width:' + px(6) + ';height:' + px(6) + ';border-radius:2px;background:#8ee0a877}' +
      '.ann li b{color:#ffd83d;font-weight:700}' +
      '.ann .annFt{margin-top:' + px(22) + ';text-align:center}' +
      '.ann .annFtBox{border-top:1px solid #ffffff14;padding-top:' + px(15) + ';' +
        'font-size:' + px(13) + ';line-height:1.9;color:#8f9a84}' +
      '.ann .annFtBox b{color:#c9d3ba}' +
      '.ann .annBadge{display:inline-block;margin-bottom:' + px(9) + ';padding:' + px(3) + ' ' + px(12) + ';' +
        'border-radius:' + px(20) + ';font-size:' + px(12.5) + ';letter-spacing:' + px(2) + ';' +
        'color:#11170f;background:#8ee0a8;font-weight:700}' +
      '@media (max-width:520px){.ann .annGrid{column-count:1}}';
  }

  /* 公告主体（不含外框）*/
  function body(data) {
    var d = data || {};
    var items = d.items || [];
    var cards = items.map(function (it, i) {
      var col = tagColor(it.tag);
      var no = String(i + 1).padStart(2, '0');
      var lis = (it.b || []).map(function (x) { return '<li>' + rich(x) + '</li>'; }).join('');
      return '<div class="annCard"><div class="annCh"><div class="annNo">' + no + '</div>' +
        '<div>' + (it.tag ? '<div class="annTag" style="color:' + col + ';border-color:' + col +
          '66;background:' + col + '1a">' + esc(it.tag) + '</div>' : '') +
        '<div class="annH">' + rich(it.t) + '</div></div></div>' +
        (lis ? '<ul>' + lis + '</ul>' : '') + '</div>';
    }).join('');
    return '<div class="ann">' +
      '<div class="annHd"><h1>' + esc(d.title || '更 新 公 告') + '</h1>' +
      '<div class="annSub">' + rich([d.date || '', d.headline || ''].filter(Boolean).join(' · ')) + '</div>' +
      '<div class="annLine"></div></div>' +
      '<div class="annGrid">' + cards + '</div>' +
      (d.foot ? '<div class="annFt"><div class="annFtBox">' +
        (d.badge ? '<div class="annBadge">' + esc(d.badge) + '</div><br>' : '') +
        rich(d.foot) + '</div></div>'
        : (d.badge ? '<div class="annFt"><div class="annFtBox">' +
          '<div class="annBadge">' + esc(d.badge) + '</div></div></div>' : '')) +
      '</div>';
  }

  /* 完整 HTML（游戏内嵌 / 预览页都用它 ✓ 自带样式 ✓）*/
  function html(data, opt) {
    var o = opt || {};
    return '<style>' + css(o.scale || 1) + '</style>' + body(data);
  }

  root.AnnRender = { css: css, body: body, html: html, tagColor: tagColor, esc: esc, rich: rich };
})(typeof window !== 'undefined' ? window : this);
