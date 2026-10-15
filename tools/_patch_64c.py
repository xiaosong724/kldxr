# -*- coding: utf-8 -*-
"""第 64 轮 管理页 JS（按真实变量名 var TOKEN）"""
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


rep("""var TOKEN = '';""",
"""var TOKEN = '';
/* ★ 第 64 轮：分页 / 测试账号开关 / 发装备选择 */
var PAGE = 1, SHOW_TEST = false, PAGES = 1, TOTAL = 0;
var TYPES = [['dagger', '匕首'], ['sword', '单手剑'], ['saber', '刀'], ['staff', '长棍'],
             ['spear', '长枪'], ['axe', '双手斧'], ['hammer', '锤'], ['bow', '弓']];
var TIER_NAME = ['锈蚀', '破旧', '精铁', '镔铁', '玄铁', '灵纹',
                 '秘银', '灵器', '宝器', '灵宝', '仙器', '神品'];
var givePick = { name: '', kind: 'sword', tier: 5, affix: 'auto' };""", 'JS 状态')

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

rep("""  if (a === 'give') { act('give', { name: n, kind: 'axe', tier: 4 }); }""",
"""  if (a === 'give') { openGive(n); }""", '给装备按钮')

rep("""  else if (a === 'kill') { if (confirm('把 ' + n + ' 打倒？')) { act('kill', { name: n }); } }
};""",
"""  else if (a === 'kill') { if (confirm('把 ' + n + ' 打倒？')) { act('kill', { name: n }); } }
  else if (a === 'del') {
    if (confirm('【不可恢复】删掉 ' + n + ' 的账号与角色？' + String.fromCharCode(10) +
                '（背包/装备一起删）')) { act('delplayer', { name: n }); }
  }
};

/* ---------- 分页 / 测试账号（第 64 轮）---------- */
$('pgPrev').onclick = function () { if (PAGE > 1) { PAGE--; refresh(); } };
$('pgNext').onclick = function () { if (PAGE < PAGES) { PAGE++; refresh(); } };
$('showTest').onchange = function () { SHOW_TEST = this.checked; PAGE = 1; refresh(); };
$('btnClean').onclick = function () {
  if (confirm('【不可恢复】删掉所有【离线】的测试账号？' + String.fromCharCode(10) +
              '（名字里含测试关键词的 ✓ 在线的一个都不动 ✓）')) { act('delTest', {}); }
};

/* ---------- 发装备的详细菜单（用户要求"详细的菜单选择给什么装备"）---------- */
var giveBox = document.getElementById('giveBox');
function mkPick(box, list, cur, onPick) {
  box.innerHTML = '';
  list.forEach(function (it) {
    var b = document.createElement('button');
    b.textContent = it[1];
    if (String(it[0]) === String(cur)) {
      b.style.background = '#3a6ea8'; b.style.borderColor = '#8ee0ff';
    }
    b.onclick = function () { onPick(it[0]); };
    box.appendChild(b);
  });
}
function giveRender() {
  mkPick($('giveType'), TYPES, givePick.kind,
         function (v) { givePick.kind = v; giveRender(); });
  mkPick($('giveTier'), TIER_NAME.map(function (nm, i) { return [i, (i + 1) + ' ' + nm]; }),
         givePick.tier, function (v) { givePick.tier = v; giveRender(); });
  mkPick($('giveAff'), [['auto', '按概率'], [1, '1 条'], [2, '2 条'], [3, '3 条'],
                        [4, '4 条'], [5, '5 条']], givePick.affix,
         function (v) { givePick.affix = v; giveRender(); });
  var tn = TYPES.filter(function (x) { return x[0] === givePick.kind; })[0][1];
  $('givePrev').textContent = '将发出：' + TIER_NAME[givePick.tier] + tn + '（' +
    (givePick.tier + 1) + ' 阶 · 建议等级 ' + (givePick.tier * 3 + 1) + ' · ' +
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
};""", '删除按钮 + 分页 + 发装备菜单')
