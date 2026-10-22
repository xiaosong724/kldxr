// 把 皮肤数据 + 皮肤构建器 贴进 web/core/game.js 的标记区
// （core 的分层门禁要求"一个文件里所有自由变量都声明过"，所以不能拆成独立 script）
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const G = path.join(ROOT, 'web', 'core', 'game.js');

const defs = fs.readFileSync(path.join(ROOT, 'tools', 'skins_src', 'skin_defs.js'), 'utf8');
const heroSrc = fs.readFileSync(path.join(ROOT, 'tools', 'skins_src', 'skin_hero.js'), 'utf8');

let s = fs.readFileSync(G, 'utf8');
const B = '/* ==================== SKINS BEGIN（由 tools/patch_skins.js 生成，别手改） ==================== */';
const E = '/* ==================== SKINS END ==================== */';
const i = s.indexOf(B);
const j = s.indexOf(E);
if (i < 0 || j < 0) { throw new Error('没找到标记'); }

const body = '\n' + defs.trim() + '\n\n' + heroSrc.trim() + '\n';
s = s.slice(0, i + B.length) + body + s.slice(j);
fs.writeFileSync(G, s, 'utf8');
console.log('已贴入 game.js：数据', (defs.length / 1024).toFixed(1) + 'KB',
            '+ 构建器', (heroSrc.length / 1024).toFixed(1) + 'KB');
