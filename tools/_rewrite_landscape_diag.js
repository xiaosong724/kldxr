const fs = require('fs');
const p = 'web/platform/web.js';
let s = fs.readFileSync(p, 'utf8');
const start = s.indexOf('function camLandApply(on) {');
const end = s.indexOf('\nfunction camRequestLandscape()', start);
if (start < 0 || end < 0) throw new Error('camLandApply block not found');
const code = `function camLandApply(on) {
  var target = on ? 'landscape' : 'portrait';
  function finish(ok, why) {
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
        var t = on ? '横屏' : '竖屏';
        toast('无法切换到' + t + '：' + (why || '浏览器/设备不支持自动转屏') +
          '（桌面浏览器无法旋转屏幕；手机需 HTTPS + 全屏）');
      } catch (e5) { }
    }
  }
  function lockNow() {
    if (!window.isSecureContext) { finish(false, '需要 HTTPS 或 localhost'); return; }
    var so = (typeof screen !== 'undefined') ? screen.orientation : null;
    if (!so || !so.lock) { finish(false, '此浏览器没有方向锁 API'); return; }
    var list = (target === 'portrait') ? ['portrait', 'portrait-primary'] : ['landscape', 'landscape-primary'];
    function tryAt(i) {
      if (i >= list.length) { finish(false, '系统拒绝了方向锁'); return; }
      try {
        var pr = so.lock(list[i]);
        if (pr && pr.then) {
          pr.then(function () { finish(true); }).catch(function () { tryAt(i + 1); });
        } else { finish(true); }
      } catch (eL) { tryAt(i + 1); }
    }
    try { if (so.unlock) { so.unlock(); } } catch (eU) { }
    tryAt(0);
  }
  try {
    if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(function () {
        setTimeout(lockNow, 120);
      }).catch(function () { setTimeout(lockNow, 120); });
    } else {
      setTimeout(lockNow, 120);
    }
  } catch (eF) {
    setTimeout(lockNow, 120);
  }
}
`;
s = s.slice(0, start) + code + s.slice(end);
fs.writeFileSync(p, s);
