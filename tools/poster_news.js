// 更新公告 / 功能说明 出图（★ 内容改 tools/poster_news.json ✗ 不用动这个文件 ✓）
//
// 跑法：node tools\poster_news.js
// 出图：docs/shots/<title>.png（2x）+ <title>-手机.jpg（1x）
//
// ★ 这就是"我们的图"的标准格式（规格见 docs\格式-公告海报.md）
//   · 暗金底 + 金色大标题 + 编号卡片（两列瀑布流）
//   · 每张卡 = 编号 + 分类标签 + 一句话标题 + 若干条要点
//   · 底部一条小字：生效方式 / 数值口径 / 去哪看
const fs = require('fs');
const path = require('path');
const P = require('./poster_lib');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'poster_news.json'), 'utf8'));

const items = data.items || [];
const sub = [data.date, data.headline, '共 ' + items.length + ' 项改动']
  .filter(Boolean).join(' · ');

const body = P.cards(items, { cols: data.cols || 2 });

const foot = (data.badge ? '<span class="badge">' + data.badge + '</span><br>' : '')
  + (data.foot || '');

const html = P.page({
  title: data.title || '更 新 公 告',
  sub: sub,
  body: body,
  foot: foot,
});

// 文件名用标题去掉空格（「更 新 公 告」→「更新公告」）
const name = (data.title || '更新公告').replace(/\s+/g, '') || '更新公告';
const out = path.join(path.resolve(__dirname, '..'), 'docs', 'shots', name);

(async () => {
  console.log('  条目: ' + items.length + ' 项 · 标签: ' +
    Array.from(new Set(items.map(x => x.tag).filter(Boolean))).join(' / '));
  await P.make(html, out);
})();
