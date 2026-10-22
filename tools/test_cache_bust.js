// 验证"缓存不会跑到旧程序"：构建号变化 / 旧版本号 / 动态配置
const ORIGIN = 'http://127.0.0.1:8899';
const fs = require('fs'), path = require('path');
let FAILS = 0;
function ck(c, m, got) {
  if (c) { console.log('  PASS  ' + m); }
  else { FAILS++; console.log('  FAIL  ' + m + (got !== undefined ? '  got=' + JSON.stringify(got) : '')); }
}
(async () => {
  // 拿到当前 HTML（会带上 ?v=构建号）
  const html = await (await fetch(ORIGIN + '/')).text();
  const mv = html.match(/\/core\/game\.js\?v=(\d+)/);
  ck(!!mv, '★ HTML 里的脚本带上了 ?v=构建号', mv && mv[1]);
  const v = mv ? mv[1] : '0';

  const js1 = await fetch(ORIGIN + '/core/game.js?v=' + v);
  console.log('  当前构建号: ' + v + ' → Cache-Control: ' + js1.headers.get('cache-control'));
  ck(/immutable/.test(js1.headers.get('cache-control') || ''),
    '★★ 当前版本号 → 允许长缓存（immutable）', js1.headers.get('cache-control'));

  const js2 = await fetch(ORIGIN + '/core/game.js?v=1');
  console.log('  旧/错版本号: 1 → Cache-Control: ' + js2.headers.get('cache-control'));
  ck(!/immutable/.test(js2.headers.get('cache-control') || ''),
    '★★ 版本号对不上 → 只允许 no-cache（不会长期占着旧内容）', js2.headers.get('cache-control'));

  const wsc = await fetch(ORIGIN + '/ws-config.js?v=' + v);
  console.log('  ws-config.js → Cache-Control: ' + wsc.headers.get('cache-control'));
  ck(!/immutable/.test(wsc.headers.get('cache-control') || ''),
    '★★ 动态配置 ws-config.js 永不长缓存', wsc.headers.get('cache-control'));
  await wsc.text(); await js2.arrayBuffer();

  // 模拟"改了 JS"：动一下 mtime → 构建号必须跟着变（浏览器就不会用旧缓存）
  const fp = path.resolve(__dirname, '..', 'web', 'core', 'game.js');
  const oldM = fs.statSync(fp).mtime;
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(fp, future, future);
  await new Promise(r => setTimeout(r, 300));
  const html2 = await (await fetch(ORIGIN + '/')).text();
  const mv2 = html2.match(/\/core\/game\.js\?v=(\d+)/);
  console.log('  改 mtime 后构建号: ' + (mv2 && mv2[1]) + '（原来是 ' + v + '）');
  ck(mv2 && mv2[1] !== v, '★★ 文件一改，构建号自动变 → HTML 里引用新地址', [v, mv2 && mv2[1]]);

  // 新地址能拿到新内容、且允许长缓存
  const js3 = await fetch(ORIGIN + '/core/game.js?v=' + (mv2 ? mv2[1] : '0'));
  ck(/immutable/.test(js3.headers.get('cache-control') || ''), '★★ 新构建号 → 又是新的长缓存地址');
  await js3.arrayBuffer();
  // 旧地址（上一个构建号）现在应当变成 no-cache
  const js4 = await fetch(ORIGIN + '/core/game.js?v=' + v);
  ck(!/immutable/.test(js4.headers.get('cache-control') || ''),
    '★★ 旧构建号地址自动降级为 no-cache（不会继续当新的用）', js4.headers.get('cache-control'));
  await js4.arrayBuffer();

  // 还原 mtime（别留下莫名其妙的未来时间）
  fs.utimesSync(fp, oldM, oldM);
  console.log('');
  console.log(FAILS ? ('FAILED: ' + FAILS) : 'ALL PASS ✓');
  process.exit(FAILS ? 1 : 0);
})();
