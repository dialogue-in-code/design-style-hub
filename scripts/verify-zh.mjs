import fs from 'node:fs';
import path from 'node:path';
const base = 'e:/github-cloud/design-style-hub/previews';
let navEl = [], haEl = [], h1Bad = [], pEn = [], pZh = 0;
for (const d of fs.readdirSync(base)) {
  for (const v of ['preview.zh.html', 'preview-dark.zh.html']) {
    const f = path.join(base, d, v);
    if (!fs.existsSync(f)) continue;
    const c = fs.readFileSync(f, 'utf8');
    if (/<nav[^>]*class="[^"]*\bnav\b/.test(c)) navEl.push(d + '/' + v);
    // 只检测 hero-actions 的 div 元素（CSS 中的 .hero-actions{} 规则无害，忽略）
    if (/<div[^>]*class="[^"]*hero-actions/.test(c)) haEl.push(d + '/' + v);
    const h1 = (c.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '';
    if (!h1.includes('设计分析')) h1Bad.push(d + ':' + h1.replace(/<[^>]+>/g, '').trim().slice(0, 40));
    const m = c.match(/<h1[^>]*>([\s\S]*?)<\/h1>\s*<p[^>]*>([\s\S]*?)<\/p>/);
    if (m && m[2].trim()) {
      /[\u4e00-\u9fa5]/.test(m[2]) ? pZh++ : pEn.push(d + '/' + v + ' :: ' + m[2].trim().slice(0, 60));
    }
  }
}
console.log(JSON.stringify({
  navElCount: navEl.length, navEl: navEl.slice(0, 5),
  haElCount: haEl.length, haEl: haEl.slice(0, 5),
  h1BadCount: h1Bad.length, h1Bad: h1Bad.slice(0, 6),
  pZh, pEnCount: pEn.length, pEn: pEn.slice(0, 8),
}, null, 1));
