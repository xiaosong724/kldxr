// 从 game.js 的 SKINS 标记区抽出 数据+构建器 → tools/skin_rig_bundle.js（给骨架测试页用）
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const s = fs.readFileSync(path.join(ROOT, 'web', 'core', 'game.js'), 'utf8');
const B = '/* ==================== SKINS BEGIN';
const E = '/* ==================== SKINS END';
const i = s.indexOf(B);
const j = s.indexOf(E);
if (i < 0 || j < 0) { throw new Error('没找到 SKINS 标记'); }
const body = s.slice(i, j);
const out = '// 自动生成（tools/build_skin_rig.js）-- 别手改\n' + body +
  '\nif (typeof window !== "undefined") { window.SKIN_DEFS = SKIN_DEFS; window.SKIN_ORDER = SKIN_ORDER; window.SKIN_NAME = SKIN_NAME; window.skBuildHero = skBuildHero; }\n';
fs.writeFileSync(path.join(ROOT, 'tools', 'skin_rig_bundle.js'), out, 'utf8');
console.log('bundle', (out.length / 1024).toFixed(1) + 'KB');
