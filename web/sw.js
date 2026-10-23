/* 末日丧尸 × 组队修仙 · Service Worker：静态资源离线缓存（"装到手机 / 离线可开"必需）

   ★ 两个必须记着的点（第 28 轮修的）：
     ① 清单里原来有 `./app.js` —— 那是老 2D 版留下的，本仓库根本没这个文件 ✗
        而 `caches.addAll()` 是"有一个 404 就整批失败" → **安装直接失败** → SW 根本没装上
        → 文档里写的"离线可开"是假的 ✗
        现在改成逐个 add + catch（单个失败不影响整体），并把真正要用的文件都列上 ✓
     ② 顺便把【注册】补上了 —— 在 web/platform/web.js 里注册
        （那是全项目唯一允许碰浏览器 API 的文件 ✓ core 一行都不用改）

   ★ 改了前端之后要不要更新缓存版本？
     代码类（js/html）走的是【network-first】→ 联网时永远拿最新，平时不用管；
     只有离线场景才读缓存副本。真想让离线副本也刷新，把 CACHE_VERSION +1 即可 ✓ */
const CACHE_VERSION = 'xx2d-v126';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './core/game.js',
  './platform/web.js',
  './lib/three.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      // ★ 逐个 add + catch：某个资源 404 不能让整个 SW 装不上 ✓
      .then(c => Promise.all(ASSETS.map(u => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') { return; }
  const u = new URL(req.url);
  if (u.origin !== location.origin) { return; }      // 跨域资源不掺和 ✓
  if (u.pathname.startsWith('/api/')) { return; }    // 接口永远走网络 ✓
  if (u.pathname === '/ws-config.js') { return; }    // 服务端按配置生成的，别缓存（改了端口免得还是旧的）✓

  // ★ 代码类走 network-first：否则改了前端手机上永远是旧的 ✗
  const netFirst = req.mode === 'navigate' || /\.(js|html|webmanifest)$/.test(u.pathname);
  if (netFirst) {
    e.respondWith(
      fetch(req).then(resp => {
        const cp = resp.clone();
        caches.open(CACHE_VERSION).then(c => c.put(req, cp)).catch(() => { });
        return resp;
      }).catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // 图片 / 音效等走 cache-first（省流量、离线也能看 ✓）
  e.respondWith(
    caches.match(req).then(r => r || fetch(req).then(resp => {
      if (resp && resp.ok) {
        const cp = resp.clone();
        caches.open(CACHE_VERSION).then(c => c.put(req, cp)).catch(() => { });
      }
      return resp;
    }).catch(() => r || Response.error()))
  );
});
