# -*- coding: utf-8 -*-
"""第 64 轮 管理页 UI：分页 / 测试账号开关与清理 / 详细发装备菜单"""
import io

P = 'web/admin.html'
t = io.open(P, encoding='utf-8').read()


def rep(a, b, name):
    global t
    c = t.count(a)
    assert c == 1, '%s: %d 次' % (name, c)
    t = t.replace(a, b)
    io.open(P, 'w', encoding='utf-8', newline='\n').write(t)
    print('  OK', name)


# ---------- ① 玩家区：标题栏加开关/清理 + 分页条 ----------
rep("""    <div class="card">
      <h2>玩家 <span class="tip">（点名字那行的按钮操作那个玩家）</span></h2>
      <table>
        <thead><tr><th>状态</th><th>名字</th><th>等级</th><th>经验</th><th>坐标</th><th>操作</th></tr></thead>
        <tbody id="rows"></tbody>
      </table>
    </div>""",
"""    <div class="card">
      <h2 style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span>玩家 <span class="tip">（在线的排前面 ✓ 点行尾按钮操作）</span></span>
        <label class="tip" style="cursor:pointer">
          <input type="checkbox" id="showTest"> 显示测试账号
        </label>
        <span class="tip" id="testInfo"></span>
        <button class="warn" id="btnClean">清理测试账号</button>
      </h2>
      <table>
        <thead><tr><th>状态</th><th>名字</th><th>等级</th><th>经验</th><th>坐标</th><th>操作</th></tr></thead>
        <tbody id="rows"></tbody>
      </table>
      <!-- ★ 第 64 轮：分页（在线优先 ✓ 服务器排好序了 ✓）-->
      <div style="display:flex;align-items:center;gap:10px;margin-top:10px">
        <button id="pgPrev">◀ 上一页</button>
        <span class="tip" id="pgInfo">—</span>
        <button id="pgNext">下一页 ▶</button>
      </div>
    </div>""", '玩家区')

# ---------- ② 发装备的详细菜单（弹层）----------
rep("""  <!-- 面板 -->""",
"""  <!-- ★ 第 64 轮：发装备的详细菜单（用户要求"给一个详细的菜单可以选择给什么装备"）-->
  <div id="giveBox" style="display:none;position:fixed;inset:0;z-index:50;background:#000a;
       align-items:center;justify-content:center">
    <div class="card" style="width:min(560px,94vw);max-height:90vh;overflow:auto;margin:0">
      <h2 style="display:flex;justify-content:space-between">
        <span>给 <b id="giveWho" style="color:#ffd83d"></b> 发装备</span>
        <span style="cursor:pointer" id="giveX">✕</span>
      </h2>
      <div class="tip" style="margin-bottom:6px">武器类型（8 种）</div>
      <div id="giveType" style="display:flex;flex-wrap:wrap;gap:6px"></div>
      <div class="tip" style="margin:12px 0 6px">品阶（1 ~ 12，越后面越强）</div>
      <div id="giveTier" style="display:flex;flex-wrap:wrap;gap:6px"></div>
      <div class="tip" style="margin:12px 0 6px">词条条数</div>
      <div id="giveAff" style="display:flex;flex-wrap:wrap;gap:6px"></div>
      <div style="margin-top:14px;display:flex;align-items:center;gap:10px">
        <button id="giveGo" style="background:#2f6b3f;border-color:#7ee08a">赠 送</button>
        <span class="tip" id="givePrev"></span>
      </div>
    </div>
  </div>

  <!-- 面板 -->""", '发装备弹层')

# ---------- ③ JS ----------
rep("""let ADMIN_TOKEN = null;""",
"""let ADMIN_TOKEN = null;
/* ★ 第 64 轮：分页 / 测试账号开关 / 发装备选择 */
let PAGE = 1, SHOW_TEST = false, PAGES = 1, TOTAL = 0;
const TYPES = [['dagger', '匕首'], ['sword', '单手剑'], ['saber', '刀'], ['staff', '长棍'],
               ['spear', '长枪'], ['axe', '双手斧'], ['hammer', '锤'], ['bow', '弓']];
const TIER_NAME = ['锈蚀', '破旧', '精铁', '镔铁', '玄铁', '灵纹',
                   '秘银', '灵器', '宝器', '灵宝', '仙器', '神品'];
let givePick = { name: '', kind: 'sword', tier: 5, affix: 'auto' };""", 'JS 状态')

rep("""  api('/api/admin/players').then(function (r) {
    if (!r.ok) { return; }
    $('rows').innerHTML = (r.players || []).map(function (p) {
      var nm = p.name.replace(/</g, '&lt;');
      return '<tr><td>' + (p.online ? '<span class="on">在线</span>' : '<span class="off">离线</span>') +
        '</td><td>' + nm + '</td><td>' + p.level + '</td><td>' + p.exp + '</td>' +
        '<td>' + p.x + ', ' + p.z + '</td>' +
        '<td>' +
        '<button data-a="spawn" data-n="' + nm + '">刷 5 只</button>' +
        '<button data-a="give" data-n="' + nm + '">给武器</button>' +
        '<button data-a="heal" data-n="' + nm + '">治疗</button>' +
        '<button class="warn" data-a="kill" data-n="' + nm + '">打倒</button>' +
        '<button class="warn" data-a="kick" data-n="' + nm + '">踢下线</button>' +
        '</td></tr>';
    }).join('') || '<tr><td colspan="6" class="tip">还没有角色</td></tr>';
  });""",
"""  api('/api/admin/players?page=' + PAGE + '&size=20' + (SHOW_TEST ? '&test=1' : ''))
    .then(function (r) {
    if (!r.ok) { return; }
    PAGE = r.page || 1; PAGES = r.pages || 1; TOTAL = r.total || 0;
    $('testInfo').textContent = r.testHidden
      ? ('（已隐藏 ' + r.testHidden + ' 个测试账号）') : '';
    $('pgInfo').textContent = '第 ' + PAGE + ' / ' + PAGES + ' 页 · 共 ' +
      TOTAL + ' 人（在线 ' + (r.online || 0) + '）';
    $('rows').innerHTML = (r.players || []).map(function (p) {
      var nm = p.name.replace(/</g, '&lt;');
      return '<tr' + (p.test ? ' style="opacity:.55"' : '') + '><td>' +
        (p.online ? '<span class="on">在线</span>' : '<span class="off">离线</span>') +
        '</td><td>' + nm + (p.test ? ' <span class="tip">测试</span>' : '') +
        '</td><td>' + p.level + '</td><td>' + p.exp + '</td>' +
        '<td>' + p.x + ', ' + p.z + '</td>' +
        '<td>' +
        '<button data-a="spawn" data-n="' + nm + '">刷 5 只</button>' +
        '<button data-a="give" data-n="' + nm + '">给装备</button>' +
        '<button data-a="heal" data-n="' + nm + '">治疗</button>' +
        (p.online ? '<button class="warn" data-a="kill" data-n="' + nm + '">打倒</button>' +
                    '<button class="warn" data-a="kick" data-n="' + nm + '">踢下线</button>'
                  : '<button class="warn" data-a="del" data-n="' + nm + '">删除</button>') +
        '</td></tr>';
    }).join('') || '<tr><td colspan="6" class="tip">还没有角色</td></tr>';
  });""", 'refresh 玩家表')

# 按钮事件
rep("""$('rows').onclick = function (e) {
  var b = e.target;
  if (!b || b.tagName !== 'BUTTON') { return; }
  var a = b.getAttribute('data-a'), n = b.getAttribute('data-n');
  if (a === 'give') { act('give', { name: n, kind: 'axe', tier: 4 }); }
  else if (a === 'spawn') { act('spawn', { name: n, n: 5 }); }
  else if (a === 'heal') { act('heal', { name: n }); }
  else if (a === 'kill') { if (confirm('把 ' + n + ' 打倒？')) { act('kill', { name: n }); } }
};""",
"""$('rows').onclick = function (e) {
  var b = e.target;
  if (!b || b.tagName !== 'BUTTON') { return; }
  var a = b.getAttribute('data-a'), n = b.getAttribute('data-n');
  if (a === 'give') { openGive(n); }
  else if (a === 'spawn') { act('spawn', { name: n, n: 5 }); }
  else if (a === 'heal') { act('heal', { name: n }); }
  else if (a === 'kill') { if (confirm('把 ' + n + ' 打倒？')) { act('kill', { name: n }); } }
  else if (a === 'del') {
    if (confirm('【不可恢复】删掉 ' + n + ' 的账号与角色？\\n（背包/装备一起删）')) {
      act('delplayer', { name: n });
    }
  }
};

/* ---------- 分页 / 测试账号 ---------- */
$('pgPrev').onclick = function () { if (PAGE > 1) { PAGE--; refresh(); } };
$('pgNext').onclick = function () { if (PAGE < PAGES) { PAGE++; refresh(); } };
$('showTest').onchange = function () { SHOW_TEST = this.checked; PAGE = 1; refresh(); };
$('btnClean').onclick = function () {
  if (confirm('【不可恢复】删掉所有【离线】的测试账号？\\n（名字里含测试关键词的 ✓ 在线的不动 ✓）')) {
    act('delTest', {});
  }
};

/* ---------- 发装备的详细菜单 ---------- */
var giveBox = document.getElementById('giveBox');
function mkPick(box, list, cur, onPick) {
  box.innerHTML = '';
  list.forEach(function (it) {
    var b = document.createElement('button');
    b.textContent = it[1];
    if (it[0] === cur) { b.style.background = '#3a6ea8'; b.style.borderColor = '#8ee0ff'; }
    b.onclick = function () { onPick(it[0]); };
    box.appendChild(b);
  });
}
function giveRender() {
  mkPick($('giveType'), TYPES, givePick.kind, function (v) { givePick.kind = v; giveRender(); });
  mkPick($('giveTier'), TIER_NAME.map(function (nm, i) { return [i + 1, (i + 1) + ' ' + nm]; }),
         givePick.tier + 1, function (v) { givePick.tier = v - 1; giveRender(); });
  mkPick($('giveAff'), [['auto', '按概率'], [1, '1 条'], [2, '2 条'], [3, '3 条'],
                        [4, '4 条'], [5, '5 条']], givePick.affix,
         function (v) { givePick.affix = v; giveRender(); });
  var tn = TYPES.filter(function (x) { return x[0] === givePick.kind; })[0][1];
  $('givePrev').textContent = '将发出：' + TIER_NAME[givePick.tier] + tn +
    '（' + (givePick.tier + 1) + ' 阶 · ' +
    (givePick.affix === 'auto' ? '词条按概率' : givePick.affix + ' 条词条') + '）';
}
function openGive(name) {
  givePick.name = name;
  $('giveWho').textContent = name;
  giveBox.style.display = 'flex';
  giveRender();
}
function closeGive() { giveBox.style.display = 'none'; }
$('giveX').onclick = closeGive;
giveBox.onclick = function (e) { if (e.target === giveBox) { closeGive(); } };
$('giveGo').onclick = function () {
  var body = { name: givePick.name, kind: givePick.kind, tier: givePick.tier };
  if (givePick.affix !== 'auto') { body.affixCount = givePick.affix; }
  act('give', body);
  closeGive();
};""", '按钮 + 分页 + 发装备菜单')

io.open(P, 'w', encoding='utf-8', newline='\n').write(t)
print('admin.html 改好')
