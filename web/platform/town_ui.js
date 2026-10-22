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
  function townRender() {
    var body = el('townBody');
    if (!body) { return; }
    var t = (window.MY_TOWNS || [])[0];
    if (!t) {
      body.innerHTML =
        '<div class="townHint">你还没有小镇。选尺寸和坐标，支付首日费用后创建；每人只能拥有 1 座。</div>' +
        '<div class="row"><input id="townName" maxlength="12" placeholder="小镇名字（2~12字）" style="flex:1"></div>' +
        '<div class="row"><select id="townTier">' +
        [30, 50, 80, 100].map(function (n) {
          return '<option value="' + n + '">' + n + ' 格 · ' + fmt(tierFee(n)) + ' / 日</option>';
        }).join('') + '</select></div>' +
        '<div class="row"><input id="townX" type="number" step="0.1" value="' + (+P.x).toFixed(1) + '">' +
        '<input id="townZ" type="number" step="0.1" value="' + (+P.z).toFixed(1) + '">' +
        '<button onclick="townUsePos()">用当前位置</button></div>' +
        '<div class="row"><button onclick="townCreate()">支付首日费用并创建</button></div>' +
        '<div class="townHint">小镇必须建在主城/其它小镇外，边界之间至少空 50 格；创建后成为安全区（边界外扩 2 格）。</div>';
      return;
    }
    var frozen = (t.status === 'frozen' || t.status === 'restoring');
    var h = '<div class="row" style="justify-content:space-between"><b>' + (t.name || '') + '</b><span>' +
      (frozen ? '已冻结' : '正常') + '</span></div>' +
      '<div class="townHint">' + t.tier + ' 格 · 中心 (' + (+t.x).toFixed(1) + ', ' + (+t.z).toFixed(1) +
      ') · 每日 ' + fmt(t.fee) + ' · 到期 ' + (t.expires ? new Date(t.expires).toLocaleString() : '-') + '</div>';
    if (frozen) {
      h += '<div class="row"><input id="townRX" type="number" step="0.1" placeholder="新 X（可选）">' +
        '<input id="townRZ" type="number" step="0.1" placeholder="新 Z（可选）">' +
        '<button onclick="townRestore()">支付当日费用并恢复</button>' +
        '<button onclick="townDissolve()">彻底解散</button></div>' +
        '<div class="townHint">恢复时优先原坐标；原坐标被占用会使用新坐标；7 天内不恢复永久删除。</div>';
    } else {
      h += '<div class="row"><button onclick="townDissolve()">主动解散（保留 7 天）</button></div>';
    }
    h += '<hr style="border:0;border-top:1px solid #ffffff1a;margin:12px 0">' +
      '<div class="townHint">权限：主人默认全部；访客默认 可交互+可交易+可传送。给某个玩家单独授权。</div>' +
      '<div class="row"><input id="townTarget" type="number" placeholder="玩家角色 ID" style="flex:1"></div>' +
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
    body.innerHTML = h;
  }
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
