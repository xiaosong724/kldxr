// 闸门：找出 web/core + web/platform 里【用了但没声明】的自由变量
//
// 为什么需要这个（P0-8 拆分 core/platform 留下的伤）：
//   拆分是按"函数边界搬代码"做的，于是留下了一串只有真浏览器才暴露的问题：
//     ① 启动调用 init() 排在一堆顶层 var 之前 → WSC 还是 undefined
//     ② index.html 里登录浮层排在 <script> 之后 → 元素还没解析出来
//     ③④⑤ 原件里 `var st = getElementById('stat')` / `var el` / `var el2` / `var de`
//          这些行【丢了】，但 `if (st)` / `if (el)` / `if (de)` 还留着 → 一执行就 ReferenceError
//   ① ② 用真浏览器测出来了（tools\test_browser.js）；③④⑤ 这种"丢声明"静态扫更省事。
//
// 跑法：node tools\check_free_vars.js      退出码 0 = 干净
//
// ★ 判定口径（这里踩过坑）：
//   顶层声明（行首无缩进）会成为 window 上的全局，两个文件互相看得见 ✓
//   函数内的 var / 形参 / catch 变量只是局部 —— 【不能】算成全局，
//   否则 platform 里一个同名的局部变量就会掩盖 core 里真正缺失的全局 ✗
//   （de 就是这么漏掉的：web.js 里有个函数内 `var de`，把 core 里的 `de` 遮住了）
//
// 剩下的再减掉浏览器 / three.js 内置全局、属性名（.foo）、对象字面量的键（foo:）。

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILES = [
  path.join(ROOT, 'web', 'core', 'game.js'),
  path.join(ROOT, 'web', 'platform', 'web.js'),
];

// 浏览器 / three.js 的内置全局（出现这些是正常的）
const BUILTIN = new Set(('window document navigator location localStorage sessionStorage console performance ' +
  'setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame queueMicrotask ' +
  'Math JSON Object Array String Number Boolean Date RegExp Error TypeError RangeError Function Symbol Map Set WeakMap ' +
  'parseInt parseFloat isNaN isFinite NaN Infinity undefined null true false this ' +
  'innerWidth innerHeight devicePixelRatio screen history fetch WebSocket XMLHttpRequest Image Audio Blob File FileReader URL ' +
  'encodeURIComponent decodeURIComponent encodeURI decodeURI alert confirm prompt atob btoa ' +
  'THREE UI E SKI VFX ' +
  'var let const function return if else for while do break continue new typeof instanceof in of delete void switch case default try catch finally throw class extends super yield await async ' +
  'get set static import export from as ' +
  'arguments eval globalThis Intl Promise Proxy Reflect TextDecoder TextEncoder AbortController ' +
  'matchMedia getComputedStyle addEventListener removeEventListener dispatchEvent CustomEvent Event ' +
  'Float32Array Uint8Array Uint16Array Uint32Array Int8Array Int16Array Int32Array ArrayBuffer DataView ' +
  'OffscreenCanvas Worker Notification ResizeObserver IntersectionObserver MutationObserver').split(/\s+/));

const ID = /[A-Za-z_$][A-Za-z0-9_$]*/g;

function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let mode = null;      // null | "'" | '"' | '`' | '//' | '/*'
  let prevSig = '';     // 上一个"有意义的"字符（判断 / 是正则还是除号）
  const REGEX_PREV = /[(,=:[!&|?{};+\-*%<>~^]/;
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (mode === null) {
      if (c === '/' && c2 === '/') { mode = '//'; i += 2; out += '  '; continue; }
      if (c === '/' && c2 === '*') { mode = '/*'; i += 2; out += '  '; continue; }
      // ★ 正则字面量也要跳过：/stress=(\d+)/ 里的 stress 会被当成标识符 ✗
      if (c === '/' && (prevSig === '' || REGEX_PREV.test(prevSig))) {
        let j = i + 1, cls = false, okEnd = false;
        while (j < n) {
          const d = src[j];
          if (d === '\\') { j += 2; continue; }
          if (d === '\n') { break; }
          if (cls) { if (d === ']') { cls = false; } }
          else if (d === '[') { cls = true; }
          else if (d === '/') { okEnd = true; j++; break; }
          j++;
        }
        if (okEnd) { out += ' '.repeat(j - i); i = j; continue; }
      }
      if (c === '"' || c === "'" || c === '`') { mode = c; i++; out += ' '; continue; }
      out += c; i++;
      if (!/\s/.test(c)) { prevSig = c; }
      continue;
    }
    if (mode === '//') { if (c === '\n') { mode = null; out += '\n'; } else { out += ' '; } i++; continue; }
    if (mode === '/*') { if (c === '*' && c2 === '/') { mode = null; out += '  '; i += 2; continue; } out += (c === '\n' ? '\n' : ' '); i++; continue; }
    // 字符串 / 模板串里
    if (c === '\\') { out += '  '; i += 2; continue; }
    if (c === mode) { mode = null; out += ' '; i++; continue; }
    out += (c === '\n' ? '\n' : ' ');
    i++;
  }
  return out;
}

function isTopLevel(code, idx) {
  const lineStart = code.lastIndexOf('\n', idx) + 1;
  return !/^[ \t]/.test(code.slice(lineStart, idx));   // 行首没有缩进 = 顶层
}

function collectDecls(code) {
  const all = new Set();   // 本文件里任何位置的声明（含函数内局部）
  const top = new Set();   // 只是顶层声明 → 会成为全局
  let m;

  // var / let / const（一行多个 var 也要收全）
  const re = /\b(?:var|let|const)\b/g;
  while ((m = re.exec(code))) {
    const idx = m.index;
    const isTop = isTopLevel(code, idx);
    const seg = code.slice(idx + m[0].length).split(/[;\n]/)[0];
    seg.split(',').forEach(function (one) {
      const mm = /^\s*([A-Za-z_$][A-Za-z0-9_$]*)/.exec(one);
      if (mm) { all.add(mm[1]); if (isTop) { top.add(mm[1]); } }
    });
  }
  // 具名函数
  const reFn = /function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  while ((m = reFn.exec(code))) {
    all.add(m[1]);
    if (isTopLevel(code, m.index)) { top.add(m[1]); }
  }
  // 形参 / catch / for-in 变量 —— 一律只算本文件局部
  const reParam = /function\s*[A-Za-z_$]*\s*\(([^)]*)\)/g;
  while ((m = reParam.exec(code))) { (m[1].match(ID) || []).forEach(function (x) { all.add(x); }); }
  const reArrow = /\(([^()]*)\)\s*=>/g;
  while ((m = reArrow.exec(code))) { (m[1].match(ID) || []).forEach(function (x) { all.add(x); }); }
  const reCatch = /catch\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)/g;
  while ((m = reCatch.exec(code))) { all.add(m[1]); }
  const reForIn = /for\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s+(?:in|of)\b/g;
  while ((m = reForIn.exec(code))) { all.add(m[1]); }

  return { all: all, top: top };
}

function lineIndex(code) {
  const starts = [0];
  for (let i = 0; i < code.length; i++) { if (code[i] === '\n') { starts.push(i + 1); } }
  return function (idx) {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= idx) { lo = mid; } else { hi = mid - 1; } }
    return lo + 1;
  };
}

const items = FILES.map(function (f) {
  const code = stripCommentsAndStrings(fs.readFileSync(f, 'utf8'));
  const d = collectDecls(code);
  return { file: f, code: code, all: d.all, top: d.top, lineAt: lineIndex(code) };
});

// 顶层声明两个文件共享（core / platform 互相调用是设计的一部分）
const globalTop = new Set();
items.forEach(function (it) { it.top.forEach(function (x) { globalTop.add(x); }); });
// ★ 2026-10-22：core 的其它文件（town.js / town_models.js …）也是全局，
//   game.js 会调用它们（例如 townFloorAt）；把这些文件的顶层声明也算进来
try {
  const extra = [
    path.join(ROOT, 'web', 'core', 'town.js'),
    path.join(ROOT, 'web', 'core', 'town_models.js'),
  ];
  extra.forEach(function (fp) {
    if (!fs.existsSync(fp)) { return; }
    const code2 = stripCommentsAndStrings(fs.readFileSync(fp, 'utf8'));
    const d2 = collectDecls(code2);
    d2.top.forEach(function (x) { globalTop.add(x); });
  });
} catch (e) { }

let bad = 0;
for (const it of items) {
  const okSet = new Set(globalTop);
  it.all.forEach(function (x) { okSet.add(x); });

  const code = it.code;
  const seen = new Map();
  let m;
  ID.lastIndex = 0;
  while ((m = ID.exec(code))) {
    const name = m[0], idx = m.index;
    if (okSet.has(name) || BUILTIN.has(name)) { continue; }
    // 属性访问 .foo
    const prev = idx > 0 ? code[idx - 1] : '';
    if (prev === '.' || prev === '$') { continue; }
    // 数字字面量的一部分：0x8a6a48 会被当成 x8a6a48，1e9 会被当成 e9
    if (/[0-9]/.test(prev)) { continue; }
    // 对象字面量的键 foo:
    const after = code.slice(idx + name.length, idx + name.length + 2);
    if (/^\s*:/.test(after) && !/^\s*::/.test(after)) { continue; }
    if (!seen.has(name)) { seen.set(name, it.lineAt(idx)); }
  }
  if (seen.size) {
    bad += seen.size;
    console.log('!! ' + path.relative(ROOT, it.file) + ' 里用了但没声明的自由变量：');
    const arr = Array.from(seen.entries()).sort(function (a, b) { return a[1] - b[1]; });
    for (const e of arr) { console.log('     第 ' + e[1] + ' 行: ' + e[0]); }
  }
}

console.log('');
if (bad) {
  console.log('发现 ' + bad + ' 个可疑自由变量 —— 很可能是拆分 core/platform 时丢的声明（见脚本头注释）');
  process.exit(1);
} else {
  console.log('✓ core/ 与 platform/ 里没有未声明的自由变量');
  process.exit(0);
}
