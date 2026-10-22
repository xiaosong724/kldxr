// announce_push.js -- 把一份公告 JSON 推到服务器（我写内容就用这个）
//
// 用法：
//   node tools/announce_push.js tools/announce/2026-10-19-皮肤系统.json          # 存草稿
//   node tools/announce_push.js tools/announce/2026-10-19-皮肤系统.json --publish # 直接发布
//   ADMIN_PW=xxx node ...（默认用 config.json 里的 admin_password）
//
// JSON 结构（和 tools/poster_news.json 的 items 同构 ✓）：
// {
//   "ver": "v1.3", "title": "更 新 公 告", "date": "2026-10-19",
//   "headline": "皮肤系统上线", "badge": "刷新页面即可生效",
//   "foot": "数值口径看菜单里的<b>百科</b>",
//   "items": [ { "tag": "皮肤", "t": "40 套皮肤", "b": ["第一点", "第二点"] } ]
// }
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = process.env.PAGE || 'http://127.0.0.1:8899';
const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const publish = args.indexOf('--publish') >= 0;

function adminPw() {
  if (process.env.ADMIN_PW) { return process.env.ADMIN_PW; }
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'config.json'), 'utf8'));
    return cfg.admin_password || '';
  } catch (e) { return ''; }
}

(async () => {
  if (!file) {
    console.error('用法：node tools/announce_push.js <公告.json> [--publish]');
    process.exit(1);
  }
  const full = path.isAbsolute(file) ? file : path.join(ROOT, file);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (e) {
    console.error('读不了这个 JSON：' + e.message);
    process.exit(1);
  }
  if (!Array.isArray(data.items) || !data.items.length) {
    console.error('items 是空的 ✗ 至少写一张卡片');
    process.exit(1);
  }

  const tok = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: adminPw() })
  }).then(r => r.json()).then(j => j.token).catch(() => '');
  if (!tok) { console.error('管理登录失败（ADMIN_PW 或 config.json 的 admin_password 不对）'); process.exit(1); }

  const res = await fetch(ORIGIN + '/api/admin/announce', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin': tok },
    body: JSON.stringify(Object.assign({}, data, { publish: publish }))
  }).then(r => r.json());

  if (!res.ok) { console.error('推送失败：' + (res.error || '?')); process.exit(1); }
  console.log((publish ? '✅ 已发布' : '📝 已存草稿') + ' → #' + res.id +
              '  ' + (data.title || '') + ' · ' + (data.headline || ''));
  console.log('   预览页：' + ORIGIN + '/ann?shot=1');
  console.log('   管理页：' + ORIGIN + '/admin/announce' +
              (publish ? '' : '（还是草稿，要在管理页点发布）'));
})();
