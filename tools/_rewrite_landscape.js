const fs = require('fs');
const p = 'web/platform/web.js';
let s = fs.readFileSync(p, 'utf8');
const start = s.indexOf('function camLandApply(on) {');
const end = s.indexOf('\nfunction camRequestLandscape()', start);
if (start < 0 || end < 0) throw new Error('camLandApply block not found');
const code = `function camLandApply(on) {
  var target = on ? 'landscape' : 'portrait';
  function finish(ok) {
    if (ok) {
      CAM_LAND_ON = !!on;
      try { document.body.classList.toggle('landscape', !!on); } catch (e0) { }
      try { camToolsSync(); } catch (e1) { }
      try { toast(on ? '已切换为横屏' : '已切换为竖屏'); } catch (e2) { }
    } else {
      CAM_LAND_ON = null;
      try { document.body.classList.toggle('landscape', window.innerWidth > window.innerHeight + 40); } catch (e3) { }
      try { camToolsSync(); } catch (e4) { }
      try {
        toast(on ? '无法自动锁定横屏：请横放手机，或把游戏加入主屏幕'
                 : '无法自动锁定竖屏：请竖放手机，并关闭系统旋转锁定');
      } catch (e5) { }
    }
  }
  function lockNow() {
    try {
      var so = screen && screen.orientation;
      if (!so || !so.lock) { finish(false); return; }
      try { if (so.unlock) { so.unlock(); } } catch (eU) { }
      var p = so.lock(target);
      if (p && p.then) {
        p.then(function () { finish(true); }).catch(function () {
          /* 有些浏览器只认 portrait-primary / landscape-primary */
          var alt = target === 'portrait' ? 'portrait-primary' : 'landscape-primary';
          try {
            so.lock(alt).then(function () { finish(true); }).catch(function () { finish(false); });
          } catch (e2) { finish(false); }
        });
      } else {
        finish(true);
      }
    } catch (eL) { finish(false); }
  }
  try {
    if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(lockNow).catch(lockNow);
    } else {
      lockNow();
    }
  } catch (eF) {
    lockNow();
  }
}
`;
s = s.slice(0, start) + code + s.slice(end);
fs.writeFileSync(p, s);
