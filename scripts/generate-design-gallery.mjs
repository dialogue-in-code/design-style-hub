#!/usr/bin/env node
/**
 * generate-design-gallery.mjs
 * 解析本地 design-style 目录中全部品牌的 STYLE.md 文档，
 * 生成自包含的可视化画廊页面 ../design-style-hub.html（相对本脚本位置）
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// 以脚本自身所在目录为基准（design-style-hub/scripts/ → 上一级为 design-style-hub/，仓库位于其下的 design-style/）
const BASE = path.resolve(import.meta.dirname, '..');
const REPO_DIR = path.join(BASE, 'design-style');
const DESIGN_DIR = path.join(REPO_DIR, 'design-md');
const OUT = path.join(BASE, 'design-style-hub.html');
// Preview 资源：从 getdesign.md 抓取，下载到本地 previews/<品牌>/ 下
const SITE_BASE = 'https://getdesign.md';
const PREVIEW_DIR = path.join(BASE, 'previews');
const REFRESH_PREVIEWS = process.argv.includes('--refresh-previews');

/* ---------------- 分类映射（内联自原 design-style/README.md 的品牌索引） ---------------- */
const BRAND_CATEGORIES = {
  'AI 与 LLM 平台': [
    ['claude', 'Claude'], ['cohere', 'Cohere'], ['elevenlabs', 'ElevenLabs'],
    ['jobright', 'Jobright'], ['minimax', 'Minimax'], ['mistral.ai', 'Mistral AI'],
    ['ollama', 'Ollama'], ['opencode.ai', 'OpenCode AI'], ['replicate', 'Replicate'],
    ['runwayml', 'Runway'], ['together.ai', 'Together AI'], ['voltagent', 'VoltAgent'],
    ['x.ai', 'xAI'],
  ],
  '开发者工具与 IDE': [
    ['cursor', 'Cursor'], ['expo', 'Expo'], ['lovable', 'Lovable'], ['raycast', 'Raycast'],
    ['superhuman', 'Superhuman'], ['vercel', 'Vercel'], ['warp', 'Warp'],
  ],
  '后端、数据库与 DevOps': [
    ['clickhouse', 'ClickHouse'], ['composio', 'Composio'], ['hashicorp', 'HashiCorp'],
    ['mongodb', 'MongoDB'], ['oracle', 'Oracle'], ['posthog', 'PostHog'], ['sanity', 'Sanity'],
    ['sentry', 'Sentry'], ['supabase', 'Supabase'],
  ],
  '生产力与 SaaS': [
    ['cal', 'Cal.com'], ['intercom', 'Intercom'], ['linear.app', 'Linear'],
    ['mintlify', 'Mintlify'], ['notion', 'Notion'], ['resend', 'Resend'], ['sap', 'SAP'],
    ['zapier', 'Zapier'],
  ],
  '设计与创意工具': [
    ['airtable', 'Airtable'], ['clay', 'Clay'], ['figma', 'Figma'], ['framer', 'Framer'],
    ['miro', 'Miro'], ['webflow', 'Webflow'],
  ],
  '金融科技与加密货币': [
    ['binance', 'Binance'], ['coinbase', 'Coinbase'], ['kraken', 'Kraken'],
    ['mastercard', 'Mastercard'], ['mercury', 'Mercury'], ['nerdwallet', 'NerdWallet'],
    ['revolut', 'Revolut'], ['stripe', 'Stripe'], ['wise', 'Wise'],
  ],
  '电商与零售': [
    ['airbnb', 'Airbnb'], ['meta', 'Meta'], ['mydealz', 'mydealz'], ['nike', 'Nike'],
    ['shopify', 'Shopify'], ['starbucks', 'Starbucks'],
  ],
  '媒体与消费科技': [
    ['1win', '1win'], ['aljazeera', 'Al Jazeera'], ['apple', 'Apple'], ['dji', 'DJI'],
    ['hp', 'HP'], ['ibm', 'IBM'], ['nvidia', 'NVIDIA'], ['oura', 'Oura'],
    ['pinterest', 'Pinterest'], ['playstation', 'PlayStation'], ['spacex', 'SpaceX'],
    ['spotify', 'Spotify'], ['theverge', 'The Verge'], ['uber', 'Uber'],
    ['vodafone', 'Vodafone'], ['wired', 'WIRED'],
  ],
  '汽车': [
    ['bmw', 'BMW'], ['bmw-m', 'BMW M'], ['bugatti', 'Bugatti'], ['ferrari', 'Ferrari'],
    ['lamborghini', 'Lamborghini'], ['renault', 'Renault'], ['tesla', 'Tesla'],
  ],
  '复古网页': [
    ['dell-1996', 'Dell (1996)'], ['nintendo-2001', 'Nintendo (2001)'],
  ],
};

function parseCategories() {
  const map = new Map(); // key: normalized slug/name -> {cat, label}
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const [cat, brands] of Object.entries(BRAND_CATEGORIES)) {
    for (const [slug, label] of brands) {
      map.set(norm(slug), { cat, label });
      map.set(norm(label), { cat, label });
    }
  }
  return map;
}

/* ---------------- 品牌名/分类修正表 ---------------- */
const LABEL_OVERRIDES = {
  'cal': 'Cal.com', 'linear.app': 'Linear', 'x.ai': 'xAI', 'mistral.ai': 'Mistral AI',
  'opencode.ai': 'OpenCode AI', 'together.ai': 'Together AI', 'runwayml': 'Runway',
  'theverge': 'The Verge', 'bmw-m': 'BMW M', 'dell-1996': 'Dell (1996)',
  'nintendo-2001': 'Nintendo (2001)',
};
const CATEGORY_OVERRIDES = {
  'linear.app': '生产力与 SaaS', 'slack': '生产力与 SaaS', 'lovable': '开发者工具与 IDE',
  'composio': '后端、数据库与 DevOps', 'clay': '设计与创意工具', 'jobright': 'AI 与 LLM 平台',
};

/* ---------------- 极简 YAML 解析（缩进嵌套 map，支持块标量与行内注释） ---------------- */
function cleanScalar(val) {
  val = val.trim();
  if ((val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2)) {
    return val.slice(1, -1).trim();
  }
  // 剥离行内注释（" #" 之后的内容；值本身以 # 开头的十六进制色不受影响）
  const ci = val.indexOf(' #');
  if (ci !== -1) val = val.slice(0, ci).trim();
  // 仅当整体就是一个（可带引号的）十六进制色时才做归一化
  const hexOnly = val.match(/^["']?(#[0-9a-fA-F]{3,8})["']?$/);
  if (hexOnly) return hexOnly[1];
  return val.replace(/^["']+|["']+$/g, '').trim();
}

function parseSimpleYAML(yamlText) {
  const root = {};
  const lines = yamlText.split(/\r?\n/);
  const stack = [{ indent: -1, obj: root }];
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue;
    const m = rawLine.match(/^(\s*)([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!m) continue;
    const indent = m[1].length;
    const key = m[2];
    let val = m[3];
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    // 块标量：| 或 >（含 |-, >- 等变体）
    if (/^[|>][+-]?$/.test(val.trim())) {
      const blockLines = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const bl = lines[j];
        if (!bl.trim()) { blockLines.push(''); continue; }
        const bi = bl.match(/^\s*/)[0].length;
        if (bi <= indent) break;
        blockLines.push(bl.trim());
      }
      parent[key] = blockLines.join(' ').trim();
      i = j - 1;
      continue;
    }
    if (val === '') {
      parent[key] = {};
      stack.push({ indent, obj: parent[key] });
    } else {
      parent[key] = cleanScalar(val);
    }
  }
  return root;
}

/* ---------------- 工具函数 ---------------- */
function luminance(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length < 6) return 0.5;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function pickPalette(colors, primary) {
  const seen = new Set();
  const out = [];
  const isNoise = (k) => /soft|deep|hover|focus|selection|bg-|on-|inverse|overlay|shadow/i.test(k);
  if (primary && /^#[0-9a-fA-F]{3,8}$/.test(primary)) { out.push(primary); seen.add(primary.toLowerCase()); }
  for (const [k, v] of Object.entries(colors)) {
    if (out.length >= 8) break;
    if (!/^#[0-9a-fA-F]{6}$/.test(String(v))) continue;
    if (isNoise(k)) continue;
    if (seen.has(String(v).toLowerCase())) continue;
    if (k === 'primary') continue;
    seen.add(String(v).toLowerCase());
    out.push(String(v));
  }
  return out;
}

function extractBullets(md, headingRegex) {
  const lines = md.split(/\r?\n/);
  let capturing = false;
  const out = [];
  for (const line of lines) {
    if (/^#{1,4}\s/.test(line)) { capturing = headingRegex.test(line); continue; }
    if (capturing && /^\s*[-*]\s+/.test(line)) out.push(line.trim().replace(/^[-*]\s+/, ''));
  }
  return out.slice(0, 6);
}

/* ---------------- 无 frontmatter 时的 Markdown 降级提取 ---------------- */
function extractFromMarkdown(md) {
  // 提取全部 hex 并按出现频次排序
  const counts = new Map();
  for (const m of md.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
    const hex = m[0].toLowerCase();
    counts.set(hex, (counts.get(hex) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  const isNeutral = (hex) => {
    const h = hex.slice(1);
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return Math.max(r, g, b) - Math.min(r, g, b) < 24;
  };
  // primary：频次最高的彩色；canvas：频次最高的极端亮/暗色；palette：高频优先、彩色在前
  const colorful = sorted.filter(h => !isNeutral(h));
  const primary = colorful[0] || sorted[0] || '#6366f1';
  const extremes = sorted.filter(h => { const l = luminance(h); return l < 0.15 || l > 0.92; });
  const canvas = extremes[0] || '#ffffff';
  const ink = luminance(canvas) > 0.5 ? '#17171c' : '#f0f0f5';
  const palette = [...new Set([...colorful, ...sorted])].slice(0, 8);
  // 描述：取第一个长度足够的正文段落（跳过标题）
  let description = '';
  const paras = md.split(/\r?\n\r?\n/).map(p => p.trim()).filter(Boolean);
  for (const p of paras) {
    const text = p.replace(/^#+\s.*$/gm, '').replace(/\*\*/g, '').replace(/`/g, '').trim();
    if (text.length > 60) { description = text.replace(/\s+/g, ' ').slice(0, 300); break; }
  }
  return { palette, primary, canvas, ink, description };
}

/* ---------------- 解析单个 STYLE.md ---------------- */
function parseBrand(dirName, filePath) {
  const md = fs.readFileSync(filePath, 'utf8');
  const fmMatch = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const tokens = fmMatch ? parseSimpleYAML(fmMatch[1]) : {};
  const colors = tokens.colors || {};
  const typography = tokens.typography || {};
  const rounded = tokens.rounded || {};
  const spacing = tokens.spacing || {};
  if (!Object.keys(colors).length) {
    // 降级：从 Markdown 正文提取颜色与描述
    const ext = extractFromMarkdown(md);
    return {
      dir: dirName,
      label: LABEL_OVERRIDES[dirName] || dirName,
      name: dirName,
      description: ext.description || '（此文件为纯 Markdown 格式，无结构化令牌，颜色取自正文）',
      primary: ext.primary, canvas: ext.canvas, ink: ext.ink,
      onPrimary: luminance(ext.primary) > 0.5 ? '#111114' : '#ffffff',
      palette: ext.palette,
      fontFamily: 'system-ui, sans-serif',
      tokensColors: {}, tokensTypo: {}, tokensRounded: {}, tokensSpacing: {},
      rounded: {}, spacing: {},
      colorCount: ext.palette.length, typoCount: 0, componentCount: 0,
      dos: extractBullets(md, /^#{2,4}\s*Do'?s?\b/i),
      donts: extractBullets(md, /^#{2,4}\s*Don'?ts?\b/i),
      raw: md,
    };
  }
  const primary = colors.primary || colors.ink || Object.values(colors)[0] || '#6366f1';
  const canvas = colors.canvas || (luminance(primary) > 0.5 ? '#fafafa' : '#101014');
  const ink = colors.ink || (luminance(canvas) > 0.5 ? '#17171c' : '#f0f0f5');
  const fontEntry = typography['display-xl'] || typography['display-lg'] || Object.values(typography)[0] || {};
  const fontFamily = typeof fontEntry === 'object' ? (fontEntry.fontFamily || '') : String(fontEntry);
  const dos = extractBullets(md, /^#{2,4}\s*Do'?s?\b/i);
  const donts = extractBullets(md, /^#{2,4}\s*Don'?ts?\b/i);
  return {
    dir: dirName,
    label: LABEL_OVERRIDES[dirName] || dirName,
    name: tokens.name || dirName,
    description: (tokens.description || '').slice(0, 600),
    primary, canvas, ink,
    onPrimary: colors['on-primary'] || (luminance(primary) > 0.5 ? '#111114' : '#ffffff'),
    palette: pickPalette(colors, primary),
    fontFamily: fontFamily || 'system-ui, sans-serif',
    tokensColors: colors, tokensTypo: typography, tokensRounded: rounded, tokensSpacing: spacing,
    rounded, spacing,
    colorCount: Object.keys(colors).length,
    typoCount: Object.keys(typography).length,
    componentCount: Object.keys(tokens.components || {}).length,
    dos, donts,
    raw: md,
  };
}

/* ---------------- Preview 资源抓取 ---------------- */
/** 检测代理：环境变量 → Windows 注册表（IE 设置）。返回 "http://host:port" 或 '' */
function detectProxy() {
  const envP = process.env.HTTPS_PROXY || process.env.https_proxy ||
               process.env.HTTP_PROXY || process.env.http_proxy ||
               process.env.ALL_PROXY || process.env.all_proxy;
  if (envP) return envP.startsWith('http') ? envP : 'http://' + envP;
  try {
    const out = execFileSync('reg', [
      'query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
    ], { encoding: 'utf8' });
    const enable = out.match(/ProxyEnable\s+REG_(?:DWORD|SZ)\s+0x1\b/i);
    const server = out.match(/ProxyServer\s+REG_SZ\s+(\S+)/);
    if (enable && server) {
      const s = server[1].replace(/^https?=/i, '');
      return s.startsWith('http') ? s : 'http://' + s;
    }
  } catch { /* 非 Windows 或无 reg，忽略 */ }
  return '';
}

const PROXY = detectProxy();
const HAS_CURL = (() => {
  try { execFileSync('curl', ['--version'], { stdio: 'pipe' }); return true; } catch { return false; }
})();

/**
 * 下载 URL 内容。优先 curl.exe（可走系统代理）；无 curl 时退回 fetch。
 * 返回 Buffer；站点 404 返回 null；其他错误抛异常。
 */
function downloadUrl(url, retries = 2) {
  const tmp = path.join(PREVIEW_DIR, '.tmp-download');
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  for (let i = 0; i <= retries; i++) {
    try {
      if (HAS_CURL) {
        const args = ['-sS', '-L', '--max-time', '60', '-w', '%{http_code}', '-o', tmp];
        if (PROXY) args.push('-x', PROXY);
        args.push(url);
        const code = execFileSync('curl', args, { encoding: 'utf8' }).trim();
        if (code === '404') return null;
        if (code === '200') return fs.readFileSync(tmp);
        throw new Error('HTTP ' + code);
      }
      // 退回 fetch（Node 内置 fetch 不走系统代理，仅适用于直连环境）
      throw new Error('__USE_FETCH__');
    } catch (e) {
      if (e.message === '__USE_FETCH__') {
        // 同步上下文外用 fetch 需异步；此分支仅当无 curl 时由 ensurePreviews 的异步路径处理
        throw e;
      }
      if (i === retries) throw e;
    }
  }
  return null;
}

async function fetchWithRetry(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      if (res.status === 404) return null; // 该品牌无此预览文件
      throw new Error('HTTP ' + res.status);
    } catch (e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, 800 * (i + 1)));
    }
  }
}

async function downloadOne(url) {
  if (HAS_CURL) {
    try { return downloadUrl(url); } catch (e) { throw new Error(e.message); }
  }
  return fetchWithRetry(url);
}

/* ---------------- Preview 标题中文化 ---------------- */
/** 标题类文案翻译映射（长词组在前，避免短词抢先匹配） */
const HEADING_ZH = [
  ['Agent Prompt Guide - Quick Color Reference', '代理提示指南 · 快速色彩参考'],
  ['Agent Prompt Guide — Quick Color Reference', '代理提示指南 · 快速色彩参考'],
  ['Responsive Behavior', '响应式行为'],
  ['Elevation &amp; Depth', '阴影与层级'],
  ['Elevation & Depth', '阴影与层级'],
  ['Elevation / Depth', '阴影与层级'],
  ['Border Radius Scale', '圆角刻度'],
  ['Border Radius', '圆角体系'],
  ['Button Variants', '按钮变体'],
  ['Buttons', '按钮'],
  ['Card Examples', '卡片示例'],
  ['Cards &amp; Surfaces', '卡片与表面'],
  ['Cards & Surfaces', '卡片与表面'],
  ['Color Palette', '色彩调色板'],
  ['Typography Scale', '排版层级'],
  ['Typography', '排版系统'],
  ['Form Elements', '表单元素'],
  ['Forms &amp; Footers', '表单与页脚'],
  ['Forms & Footers', '表单与页脚'],
  ['Spacing Scale', '间距刻度'],
  ['Signature Components', '签名组件'],
  ['Component Library', '组件库'],
  ['Navigation', '导航'],
];

/* ---------------- 标题词典（短语 + 词级，来自 headings-zh.json 与 headings-zh-extra.json） ---------------- */
let PHRASE_ZH = {};
let WORD_ZH = {};
let PROTECT_TOKENS = [];
try {
  const d1 = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'headings-zh.json'), 'utf8'));
  PHRASE_ZH = d1.phrases || {};
  WORD_ZH = d1.words || {};
  PROTECT_TOKENS = d1.protect || [];
  try {
    const d2 = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'headings-zh-extra.json'), 'utf8'));
    Object.assign(PHRASE_ZH, d2.phrases || {});
    Object.assign(WORD_ZH, d2.words || {});
    PROTECT_TOKENS = PROTECT_TOKENS.concat(d2.protect || []);
  } catch { /* 无附加词典，忽略 */ }
  try {
    const d3 = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'headings-zh-extra2.json'), 'utf8'));
    Object.assign(PHRASE_ZH, d3.phrases || {});
    Object.assign(WORD_ZH, d3.words || {});
    PROTECT_TOKENS = PROTECT_TOKENS.concat(d3.protect || []);
  } catch { /* 无附加词典，忽略 */ }
  try {
    const d4 = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'headings-zh-extra3.json'), 'utf8'));
    Object.assign(PHRASE_ZH, d4.phrases || {});
    Object.assign(WORD_ZH, d4.words || {});
    PROTECT_TOKENS = PROTECT_TOKENS.concat(d4.protect || []);
  } catch { /* 无附加词典，忽略 */ }
} catch (e) { console.warn('headings-zh.json 加载失败，跳过词典翻译: ' + e.message); }

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// 边界：只在相邻处是字母/数字时要求边界（兼容短语以标点开头/结尾的情况）
const wrapBounds = (s) => '(?<![A-Za-z0-9])' + s + '(?![A-Za-z0-9])';
// 预编译：短语/保护词按长度降序（避免短词抢先破坏长短语）
const PHRASE_ENTRIES = Object.entries(PHRASE_ZH).sort((a, b) => b[0].length - a[0].length)
  .map(([en, zh]) => [new RegExp(wrapBounds(escRe(en)), 'gi'), zh]);
const WORD_ENTRIES = Object.entries(WORD_ZH).sort((a, b) => b[0].length - a[0].length)
  .map(([en, zh]) => [new RegExp(wrapBounds(escRe(en)), 'gi'), zh]);
const PROTECT_RES = [...new Set(PROTECT_TOKENS)].sort((a, b) => b.length - a.length)
  .map(p => [new RegExp(wrapBounds(escRe(p)), 'gi'), p]);
// 归一化整句查找表：剥离标签后的纯文本（小写、空白收敛）→ 中文，兜底命中含内嵌标签的标题
const normPlain = (s) => String(s).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&middot;/g, '·')
  .replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&rsquo;/g, '’').replace(/&mdash;/g, '—')
  .replace(/\u00A0/g, ' ').replace(/[–]/g, '—').replace(/\s+/g, ' ').trim().toLowerCase()
  .replace(/[.。!！?？]+$/, '');
const PHRASE_NORM = new Map(Object.entries(PHRASE_ZH).map(([en, zh]) => [normPlain(en), zh]));

/** 标题文本词典翻译：整句兜底 → 归一化 → 标签保护 → 短语 → 白名单 → kebab 标识符 → 词级（长句跳过） → 还原 */
function translateHeadingByDict(text) {
  if (!text || (!PHRASE_ENTRIES.length && !WORD_ENTRIES.length)) return text;
  // 0) 整句兜底：剥离标签后的纯文本与短语精确匹配（处理标题内嵌 <span>/<br> 拆词的情况）
  const plainHit = PHRASE_NORM.get(normPlain(text));
  if (plainHit !== undefined) return plainHit;
  let t = text;
  // 归一化：实体、不换行空格、连字符变体、多余空白
  t = t.replace(/&amp;/g, '&').replace(/&middot;/g, '·').replace(/&thinsp;/g, ' ')
       .replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&rsquo;/g, '’').replace(/&mdash;/g, '—')
       .replace(/\u00A0/g, ' ').replace(/[–]/g, '—').replace(/\s+/g, ' ');
  const trimmed = t.trim();
  if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(trimmed)) return t; // 纯代码标识符（如 feature-card）不译
  const store = [];
  const stash = (m) => '⟦' + (store.push(m) - 1) + '⟧';
  t = t.replace(/<[^>]+>/g, stash); // HTML 标签
  // 1) 短语精确翻译（先于保护，避免品牌词破坏含品牌名的短语）
  for (const [re, zh] of PHRASE_ENTRIES) t = t.replace(re, zh);
  // 2) 白名单保护（品牌/字体/产品名）
  for (const [re, p] of PROTECT_RES) t = t.replace(re, stash);
  // 3) kebab 代码标识符保护
  t = t.replace(/(?<![A-Za-z-])[a-z0-9]+(?:-[a-z0-9]+)+(?![A-Za-z-])/g, stash);
  // 4) 词级翻译：残留英文单词超过 8 个时视为完整句子，跳过词级（避免破碎混合语），保持英文原句
  const latinWords = t.match(/[A-Za-z]+/g) || [];
  if (latinWords.length <= 8) {
    for (const [re, zh] of WORD_ENTRIES) t = t.replace(re, zh);
    t = t.replace(/&/g, '与').replace(/ +与 +/g, '与');
  }
  t = t.replace(/⟦(\d+)⟧/g, (m, i) => store[i]);
  return t;
}

/* ---------------- hero 段落中文翻译（按品牌目录名索引；未列出的品牌无 hero 段落） ---------------- */
const HERO_ZH = {
  'webflow': '视觉化 Web 开发平台：深近黑主色与大面积白色画布形成对比，以五档彩色强调系统（紫/粉/蓝/橙/绿）对应品牌产品线，全站使用单一无衬线字体，克制地使用 500/600 字重并配合负字距。',
  'oracle': '企业级系统：以暖色中性阶梯取代传统调色板，六级灰阶承担几乎所有表面，单一炭黑承担所有操作，著名的红色仅保留给字标。两种展示字阶并存——企业官网使用极轻无衬线体，产品页面则使用 Georgia 衬线体。',
  'resend': '纯黑画布、96px 的 Domaine Display 标题、ABC Favorit 正文、Geist Mono 代码字体，并用氛围光晕取代传统的投影。',
  'revolut': '双模式画布系统——黑色用于叙事、白色用于产品目录——搭配 Aeonik Pro 展示标题、Inter 正文，以及仅用于特色套餐卡片的钴紫品牌印记。',
  'raycast': '深色画布的开发者工具系统，把营销页面当作延展的产品截图来处理——纯近黑背景、以命令面板模拟界面作为主视觉、全站启用 Inter 的 ss03 字形变体，以及不破坏墨色氛围的单一白色 CTA 胶囊。表面阶梯从 #07080a → #0d0d0d → #101111 → #121212；#242728 的 1px 细线勾勒所有卡片边缘。',
  'ibm': '忠实于 Carbon Design System 的企业营销画布：白色表面、炭黑文字、IBM 蓝（#0f62fe）作为唯一而自信的强调色，以及刻意方正的扁平美学——圆角保持在 0–4px。Plex Sans 以 300 字重承担展示字号，这是 IBM 的排版签名。',
  'elevenlabs': '读起来像编辑杂志的语音 AI 品牌。米白画布、300 字重的 Waldenburg Light、以柔和渐变光球作为唯一的色彩时刻。',
  'intercom': '围绕柔和奶油白底色构建的编辑风客服营销画布，炭黑文字使用 Saans 字体，唯一而自信的 Fin 橙（#ff5600）仅保留给 Fin AI 品牌。卡片是带细边框的悬浮白色磁贴，整体读起来像一份克制的产品导向刊物。',
  'playstation': '围绕黑、白、PlayStation 蓝三色章节交替组织的三表面营销系统，滚动时如同一部主机发布预告片。PlayStation SST 展示文字采用标志性的 300 轻字重，带来轻盈高级感；明亮的 PlayStation 蓝（#0070d1）承担所有主 CTA 的全圆角胶囊；商务橙（#d53b00）锚定商店操作。系统从不做装饰——影像承担全部视觉重量。',
  'linear.app': '围绕 #010102（本合集中最深的暗色表面）构建的近黑产品向营销画布，浅灰文字，以及作为唯一彩色强调的标志性 Linear 薰衣草蓝（#5e6ad2）。整个系统读起来像软件工艺文档：致密、技术感、低调奢华。',
  'mercury': '在首页的深墨紫夜晚与产品和定价页的浅近白白天之间切换的金融科技系统。一枚自信的靛蓝操作胶囊、柔和的半透明次级胶囊、圆润的卡片，以及字重异常轻盈的安静定制无衬线字体。',
  'apple': '摄影优先的界面，把营销变成美术馆画廊。通栏磁贴明暗交替；一种操作蓝承担所有交互时刻。',
  'vercel': 'Vercel 的 Geist 系统是"做减法"的练习：近白纸面上的近黑墨色，单一色调承担所有标题、CTA 与 1px 边框，唯一被允许的颜色是只出现在主视觉的多层网格渐变。Geist Sans 驱动紧字距的展示字体，Geist Mono 标注技术眉标，黑色胶囊按钮标记营销 CTA。',
  'hashicorp': '围绕近黑底色构建的企业基础设施营销画布，采用按产品划分的强调色系统——Terraform 紫、Vault 黄、Consul 红、Waypoint 青、Vagrant 蓝——它们是身份令牌而非装饰调色板。展示字体 hashicorpSans 收紧字距；正文使用同族字体并刻意放宽行高。',
  '1win': '近黑的加密赌场与体育博彩平台，两种操作色承担一切——鲜艳绿色用于注册与主要确认，电光蓝用于次级操作与实时投注。Inter 使用重磅字重，表面阶梯是平坦的深灰，密集的通栏游戏磁贴轨道供应所有色彩。',
  'dji': '无人机与相机的产品摄影陈列室：白色画布上以方形、留沟槽分隔的通栏摄影棚渲染图，所有操作都是同一种工程蓝的圆角胶囊，近黑墨色紧字距的 Open Sans，小号橙色档位标签，以及同一克制系统上的商店选品卡片。',
  'nerdwallet': 'NerdWallet 是穿着编辑外套的比价引擎。文章页以宽阔的绿色渐变带开场，随后落入近白区域，致密的利率表格在那里做真正的工作。一种深绿填满所有按钮、激活标签与评分星；其下是三阶薄荷色阶梯洗刷着区块面板。圆角几乎为零，基本没有投影。',
  'bmw': 'BMW 企业官网。在浅色画布上，BMW 企业蓝（#1c69d4）承担所有主 CTA；深海军蓝的主视觉横幅框住车型摄影。BMW Type Next Latin 中 700 重展示字体与 300 轻正文的对比是编辑签名。',
  'runwayml': '为 AI 创作工具公司打造的编辑级、画廊级营销系统。电影感摄影主视觉、纸白阅读带、单一专有无衬线字体，以及所有操作统一的纯黑胶囊 CTA。',
  'stripe': '对 Stripe 设计语言的演绎——金融基础设施品牌，以深海军墨、电光靛蓝主色和每个营销主视觉上循环出现的渐变网格构建。Sohne 细体（300）展示字体配负字距；金额单元格使用等宽数字正文。',
  'x.ai': '近黑画布、白色描边胶囊，以及 400 字重、激进负字距的 Universal Sans。胶囊是唯一的交互形状，眉标是唯一的装饰；整个系统读起来像工程日志，而不是营销网站。',
  'nike': '以极端排版对比构建的摄影优先电商系统——高耸的全大写 Futura 展示组合烙印在编辑感 campaign 影像上，下方是近乎单色的零售框架：胶囊形黑色 CTA、灰色搜索与标签胶囊、紧凑 8px 网格产品卡。纯黑、纯白与单一柔和表面灰——彩色能量只保留给摄影与价格信号，绝不用于装饰框架。',
  'expo': 'React Native 开发者平台。纯黑 CTA、克制字重的 Inter、所有代码表面上的 JetBrains Mono——低调而自信的基础设施口吻。',
  'figma': '自信的黑白编辑框架，被超大、手剪风格的粉彩色块打断。营销画布严格单色——figmaSans 可变字体、纯白表面、纯黑墨水、胶囊形 CTA——而每个故事区块都让页面落入饱和的青柠、薰衣草、奶油、薄荷或粉色面板，读起来像放在干净书桌上的便利贴。',
  'hp': '以 HP 电光蓝（#024ad8）作为唯一信号 CTA 的白纸企业-消费系统，近黑墨色标题，几何感 Forma DJR Micro 遍布所有表面，呼应 HP 字标斜线的蓝色雪佛龙角饰。卡片 16px 圆角，照片置于 16px 软边框中，深海军蓝板块锚定结尾的客户故事与"我们能帮什么"横幅。',
  'opencode.ai': '完全以等宽字体渲染的终端原生营销系统——页面上的每个字都使用同一种等宽字体。暖奶油画布（#fdfcfc）、近黑墨色（#201d1d）、少量交互元素使用 4px 圆角矩形，以及用作项目符号的 [+] / [-] / [x] ASCII 标记。品牌唯一的视觉时刻是一张模拟 OpenCode TUI 的深色主视觉卡片。',
  'oura': '暖纸感健康系统：高对比编辑衬线体用于陈述句，安静的无衬线怪诞体用于阅读，通栏摄影承担视觉重量。所有表面都落在奶油色上，调色板是从芥末、陶土到橄榄绿的大地色系，单一果断的操作蓝驱动所有主 CTA。',
  'sanity': '暗色优先的编辑营销表面。最高 112px 的超大 waldenburgNormal 展示字体、IBM Plex Mono 技术眉标、仅用于最高优先级 CTA 的珊瑚红强调色，以及页面中段翻转画布极性的区块节奏。',
  'framer': '自信的深色画布建站营销网站，把页面当作正在工作的画板——纯黑表面、GT Walsheim Medium 白色展示字体配激进负字距，以及只用于超链接与选中状态的自信蓝色（#0099ff）。超大而鲜艳的渐变氛围面板打破页面节奏，充当活的展示磁贴。',
  'slack': '对 Slack 设计语言的演绎——职场通讯品牌，以深茄子色为主色，奶油薰衣草渐变主视觉配悬浮产品 UI 模拟图，蓝色行内链接，以及 90px 圆角的过填充胶囊 CTA。',
  'coinbase': '机构级加密交易所。Coinbase 蓝在 100px 胶囊上承担所有主 CTA；CoinbaseDisplay 保持 400 字重——平静，从不喧哗。',
  'voltagent': '开发者向 AI 代理平台，其表面是毫不妥协的近黑画布，仅被单一电光绿品牌强调色、细边框功能卡片和读起来像文档穿着营销外衣的代码编辑器模拟图打破。Voltagent 是纯深色画布品牌——生产级营销系统中不存在浅色模式。',
  'ferrari': '奢华汽车品牌如电影编辑。近黑画布、Rosso Corsa 强调色、克制字重的 FerrariSans，全大写加字距的 CTA 与锐利的 0px 直角。',
  'sap': '像应用框架而非营销表面的企业系统：产品标签栏上方的浅色框架条、被四条通栏扁平色带切开的画布，以及一种承担所有操作的蓝色。深度来自色带与渐变而非投影，控件圆角止于 8px，媒体 12px。',
  'together.ai': '对 Together AI 设计语言的演绎——AI 云基础设施品牌，表面在近黑主视觉横幅（以橙-品红-长春花蓝三色渐变作为唯一品牌装饰）与明亮的研究/定价/文档白色横幅之间交替，由定制展示无衬线体和全大写等宽眉标字体编织在一起。',
  'mydealz': '建立在自信品牌绿之上的高密度德国折扣社区系统，堆叠的白卡信息流承载成千上万的优惠，每张卡片都佩戴标志性的冷热温度控制，把定价变成大众投票。540px 全圆角胶囊按钮、两种字重的 Averta CY，以及紧凑的红/蓝/橙状态词汇，让信息流既易扫读又有趣。',
  'airbnb': '温暖、大方的消费级市场，锚定在干净白色画布上，Airbnb Rausch 红（#ff385c）是唯一的品牌电压。Cereal VF 以克制字重运行，让摄影与圆角形状承担视觉重量。按钮柔和圆角，搜索栏是完整胶囊，搜索球体在 Rausch 红中发光。',
  'jobright': '建立在活力春薄荷绿之上、以黑白为骨架的 AI 求职平台，浅薄荷色区块横幅承载页面节奏。粗壮紧凑的 Titillium Web 展示标题搭配干净的 Inter UI，CTA 系统运行在高对比胶囊按钮上——主操作为黑色胶囊，标志性的强调色为薄荷绿胶囊。',
  'warp': '代理式终端与开发环境品牌，其表面是暖炭色画布（比纯黑更暖的色调），仅被干净的 Inter 排版、偶尔出现的 Instrument Serif 斜体时刻和密集的终端模拟图打破。CTA 异常低调，形状几何比大多数营销网站更紧凑。',
  'clay': '鲜活的黏土动画遇上数据界面。奶油画布配深海军 CTA、定制圆润展示字体，以及贯穿长滚动说明页的饱和单色功能卡片——粉、青、薰衣草、蜜桃、赭石。',
  'ollama': '几乎是刻意极简的文档优先系统，把主页当作 Markdown README 来处理——纸白画布、居中标题、单一黑色胶囊 CTA、行内终端安装代码片段。没有渐变、没有主视觉摄影、没有营销焰火。界面框架是一套纯黑、纯白加三种中性灰的小型工具调色板；每个交互元素都是全圆角胶囊。SF Pro Rounded 展示字体搭配系统无衬线正文与 ui-monospace 代码。',
  'wise': '全球转账品牌，其表面结合了异常厚重的 900 字重近黑展示无衬线体、鲜艳的青柠绿 CTA、鼠尾草色调画布与圆润白卡。整个系统读起来更像斯堪的纳维亚金融杂志而非银行——慷慨的留白、24px 大圆角，以及青柠绿作为唯一的彩色签名。',
  'binance': '锚定在深近黑画布上的自信金融平台界面，Binance 标志性的黄色承担所有主 CTA、品牌强调与价值主张时刻。',
  'nvidia': '围绕两种表面模式组织的工程级营销系统——主视觉与页脚章节的深黑画布、正文的平坦纸白画布——由单一、几乎浓烈到暴烈的 NVIDIA 绿强调色连接，它承担所有 CTA、所有激活标签以及标记卡片的装饰性小方块。系统毫不妥协地棱角分明：所有表面 2px 圆角、紧凑粗体排版，以及分隔致密多栏技术内容的灰色细线。',
  'supabase': '对 Supabase 设计语言的演绎——开源数据库品牌，干净白色画布配单一祖母绿 CTA、500 字重负字距的 Circular 字体，以及代替摄影的合成产品 UI 模拟图。',
  'composio': 'AI 代理工具集成平台。深电光蓝（#0007cd）配紧凑 8px 圆角 CTA——深色整体画布上的开发者工具方言。',
  'cursor': '具有编辑风开发者工具口吻的 AI 优先代码编辑器。暖奶油画布、单一 Cursor 橙强调色、400 字重的 CursorGothic——杂志般的安静，从不粗黑。',
  'notion': '温暖、纸感的平静生产力系统：近白画布上的近黑 Inter 文字，由单一自信的蓝色构建结构。俏皮的多彩贴纸调色板承载个性，而界面框架保持安静——配有一条反转的深靛蓝主视觉横幅。',
  'posthog': '在暖奶油画布上渲染的俏皮开发者工具系统，手绘刺猬吉祥物像速写本边缘的注记散布在每个页面。界面框架读起来像友好的工程博客：橄榄灰墨色（#4d4f46）正文、深橄榄炭色（#23251d）标题、紧 1.43 行高的 IBM Plex Sans Variable 排版，以及承担所有主操作的单一饱和黄橙 CTA 胶囊（#f7a501）。系统主动拒绝该品类典型的阴郁深色科技美学，转而拥抱奶油色教科书插画式的感性。',
  'uber': '出行与外卖超级应用品牌，其网页表面是黑白二重奏，以定制几何展示无衬线体框住，所有交互元素上的标志性胶囊形状（999px 圆角）作为强调，并仅以编辑感的 4:3 插画（乘客、司机与城市物件）作装饰。',
  'bugatti': '严苛的奢华汽车界面：近纯黑画布、白色全大写字距展示字体，以及通栏汽车摄影作为唯一的电压。没有强调色，没有装饰元素，没有界面装饰。',
  'spacex': '对 SpaceX 设计语言的演绎——使命导向的航空航天品牌，纯黑画布、通栏火箭与火星摄影、全大写 D-DIN 展示字体，以及每个横幅一枚幽灵描边胶囊 CTA。',
  'wired': '以严格编辑二重奏构建的旗舰科技杂志表面——白画布上的纯黑字标、64px 高对比展示衬线体、长文阅读的人文衬线体，以及导航、眉标与按钮使用的干净无衬线体。直角、细线、无彩色强调。',
  'nintendo-2001': '把网页渲染成主机硬件。每个区域都是顶部受光、底部阴影线的斜面长春花蓝金属板——页面读起来像一块机器面板。碳海军蓝命令层承载导航、右栏与页脚；暖琥珀与橙色严格配给作为寻路信号。描边盒装封面字标坐落在通栏摄影主视觉上。',
  'replicate': '暖奶油画布、火热橙色品牌印记、超大 rb-freigeist-neue 展示字体，以及胶囊圆角 UI 词汇中的 JetBrains Mono 代码井。',
  'renault': '高对比黑白画布、单一 Sunlight 黄强调色、直角摄影磁贴，以及来自现代化雷诺钻石标志的专有 NouvelR 展示字体。',
  'superhuman': '对 Superhuman 设计语言的演绎——在编辑风深色主视觉（深靛蓝海军底、紫罗兰天空氛围背景与半出血人像）与安静白色正文之间分割的生产力品牌。收尾的青绿色横幅打破节奏。Super Sans VF 使用低于默认的 460/540/600 字重。',
  'claude': 'Anthropic 的暖画布编辑界面。奶油 + 珊瑚 + 深海军三巨头。粗衬线展示标题、人文无衬线正文，以及作为产品框架的深色代码模拟卡片。',
  'airtable': '锚定白色画布与深墨文字的沉稳编辑风工作流软件界面。品牌电压来自贯穿长滚动说明页的通栏签名卡片：珊瑚色、深绿与深海军蓝。',
  'clickhouse': '锚定在近纯黑画布上的高性能数据库界面，电光黄作为品牌电压。自信粗体无衬线的白色排版、黄色 CTA 与黄色统计数字承载品牌声音。',
  'sentry': '对 Sentry 设计语言的演绎——开发者工具品牌，深紫罗兰午夜画布、电光青柠强调色，以及略有颠覆性的插画个性。系统将定制展示无衬线体与开源 Rubik 家族（UI 文案）和 Monaco（代码）配对。',
  'cal': '干净的、日历软件优先的界面，白色画布、黑色主 CTA 与定制 Cal Sans 展示字体。友好的现代 SaaS、慷慨的留白、软圆角卡片。',
  'vodafone': '电信超级品牌，其网页表面在带超大全大写展示标题的编辑摄影主视觉横幅与干净的白色内容横幅之间交替，以公司标志性的猩红 CTA 与难以置信的 800 重专有展示无衬线体锚定。',
  'zapier': '工作流自动化品牌，其表面结合了暖奶油中性色（#fffefb 画布、#f8f4f0 软奶油）、深咖啡墨色（#201515）与单一饱和橙 CTA 强调（#ff4f00）。字体将专有 Degular Display 家族的主视觉字号与 Inter 的副展示及正文配对，给品牌带来自信温暖而非冷峻科技的口吻。',
  'pinterest': '围绕 Pinterest 红 CTA、瀑布流 Pin 网格与柔软暖奶油界面框架组织的摄影优先发现系统，界面框架为影像让路。Pin Sans 排版、全圆角胶囊按钮（16px）、奶油色调中性调色板，以及锚定每个视口的粘性红色注册 CTA。界面框架其余部分保持安静：暖灰、纯白、单一饱和红——没有装饰性渐变、没有氛围背景，除柔和弹窗外没有投影。',
  'aljazeera': '平面纸媒上的硬新闻编辑系统：致密的 Roboto 标题堆叠、以细线规则取代阴影，摄影承担视觉工作。一种饱和橙色签署报头标识块与每个章节眉标条；专属的直播红用徽章、横带与时间线圆点标记突发报道；操作是紧凑的黑色胶囊。企业网络页面把同一身份带到近黑画布上，配皇家靛蓝面板、金色细线、琥珀链接以及青色与绯红章节栏。',
  'bmw-m': '以近黑画布为锚的运动工程界面，白色 BMW Type Next Latin 展示标题使用自信的全大写。品牌电压来自通栏汽车摄影。',
  'shopify': '对 Shopify 设计语言的演绎——电影感的电商平台，运行两条平行设计轨道：近黑画布配细字重 Neue Haas Grotesk 展示字体，以及奶油薄荷交易表面配反极性的同款胶囊按钮词汇。',
  'cohere': '从 Cohere 的 STYLE.md 生成的静态目录：纪念碑式字体、素净画布、深色产品横带、圆角媒体卡片、珊瑚色编辑徽章与企业级 AI 产品模拟图。',
  'dell-1996': '对 Dell.com 1996 年设计语言的演绎——目录时代的企业网页设计：字面意义的黑色页面边框、鲜艳的扁平色带卡片、厚重的 Arial Black 展示标题、Times Roman 正文，以及整套前 Photoshop 时代手工剪贴 GIF 贴纸的视觉词汇。',
  'kraken': '每一种颜色、字体与组件——以加密交易所般的精度可视化呈现。',
  'lamborghini': '从 STYLE.md 生成的视觉目录——黑暗、金色与毫不妥协的棱角。',
  'lovable': '从 STYLE.md 生成的设计令牌目录。每一种颜色、字体、组件与间距值——全部可视化。',
  'mastercard': '从 STYLE.md 生成的完整令牌级目录。下方每种颜色、字阶、按钮、卡片与圆角，均以文档中提供给下游代理的同一套数值渲染。',
  'meta': 'Meta 的电商表面（首页、Quest 配置器、Ray-Ban 产品详情、处方页）读起来像自信的硬件商品陈列。品牌声音以摄影为先：通栏产品影像、紧凑的排版层级，以及可辨识的双 CTA 模式——营销区黑色胶囊主按钮，立即购买流程中钴蓝胶囊主按钮。',
  'minimax': 'MiniMax 将自己呈现为具有精致双重身份的 AI 基础设施品牌：极简单色营销画布，搭配鲜艳渐变产品卡片（珊瑚色 M2.7、品红 Music 2.6、蓝色海螺 Hailuo）。全站 DM Sans 字体，超大 80px 主视觉展示配 -2px 字距。',
  'mintlify': 'Mintlify 以双模式美学呈现文档基础设施——氛围感天空渐变营销主视觉，搭配致密的开发者级文档表面。Inter 用于 UI 文案，Geist Mono 用于代码，标志性的薄荷绿用于强调 CTA。',
  'miro': 'Miro 以自信而略带俏皮的品牌声音定位自己为 AI 驱动的可视化工作区——锚定在极简白色画布上，标志性的金丝雀黄字标、黑色胶囊主 CTA，以及呼应真实白板便利贴调色板的柔和功能卡片。',
  'mistral.ai': '氛围感山峦日落渐变，配编辑风近衬线主视觉展示。',
  'mongodb': 'MongoDB 带有强烈双模式视觉身份——深青色主视觉横幅配明亮的 MongoDB 绿 CTA，以及纯白文档表面。标志性的绿色胶囊在产品、定价、学习与 AI 用例表面上辨识度极高。',
  'spotify': '从 STYLE.md 生成的设计令牌目录。每一种颜色、字体与组件——在黑暗中可视化。',
  'starbucks': '从 Starbucks.com 提取的令牌、组件与布局原则视觉目录——由 STYLE.md 生成。',
  'tesla': '摄影优先，界面隐形。',
  'theverge': '警示带编辑风。巨大的 Manuka 标题、酸性薄荷 + 紫外线强调色，以及像新闻的 git log 的 StoryStream 时间线。由 STYLE.md 生成。',
};

/** 将 preview HTML 中的标题类内容（title/h1-h3/eyebrow）替换为中文，并移除导航与 hero 演示按钮 */
function translatePreviewHtml(html, dir) {
  let out = html;
  // 1) 整体移除顶部导航条（站点导航链接那一行）
  out = out.replace(/<nav[^>]*class="[^"]*\bnav\b[^"]*"[^>]*>[\s\S]*?<\/nav>/gi, '');
  // 2) 移除 hero 区的演示按钮行（Sign up / Subscribe / Open account / Contact sales 等）
  out = out.replace(/<div[^>]*class="[^"]*hero-actions[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
  // 3) hero 下的 <p> 段落改为中文（有对应翻译时；兼容无 hero-content 包装层的结构）
  const zhText = HERO_ZH[dir];
  if (zhText) {
    out = out.replace(
      /(<h1[^>]*>[\s\S]*?<\/h1>\s*<p[^>]*>)[\s\S]*?(<\/p>)/i,
      (m, a, b) => a + zhText + b
    );
  }
  const zhHeading = (text) => {
    // 整句兜底必须最先执行：在其它转换改写单词之前，用原始文本命中整句短语
    const plainHit = PHRASE_NORM.get(normPlain(text));
    if (plainHit !== undefined) return plainHit;
    let t = text;
    // 页面主标题："Design System Analysis of X" / "Design System Inspired by X" → "X 设计分析"（去掉"系统"二字，兼容 <br> 与 span 包裹）
    t = t.replace(/Design System(?:\s+Analysis)?\s*(?:<br\s*\/?>)?\s*(?:of|Inspired by)\s*([\s\S]*?)(<\/|$)/i, '$1 设计分析$2');
    for (const [en, zh] of HEADING_ZH) {
      if (t.includes(en)) t = t.split(en).join(zh);
    }
    // 眉标后缀："01 — Foundations" → "01 — 基础规范"
    t = t.replace(/(—\s*|-)\s*Foundations\b/g, '$1 基础规范');
    t = t.replace(/(—\s*|-)\s*Components\b/g, '$1 组件');
    t = t.replace(/(—\s*|-)\s*Responsive\b/g, '$1 响应式');
    // "Section 01" → "第 01 节"
    t = t.replace(/Section\s+(\d{1,2})/g, '第 $1 节');
    // 词典级翻译：短语（长→短）+ 词级（词边界），保护品牌/字体名/代码标识符
    t = translateHeadingByDict(t);
    return t;
  };
  out = out
    .replace(/(<title[^>]*>)([\s\S]*?)(<\/title>)/gi, (m, a, b, c) => a + zhHeading(b) + c)
    .replace(/(<h[1-4][^>]*>)([\s\S]*?)(<\/h[1-4]>)/gi, (m, a, b, c) => a + zhHeading(b) + c)
    .replace(/(<([a-z]+)[^>]*class="[^"]*(?:eyebrow|section-label)[^"]*"[^>]*>)([\s\S]*?)(<\/\2>)/gi, (m, a, b, c, d) => a + zhHeading(c) + d);
  return out;
}

/** 抓取全部品牌的 preview.html / preview-dark.html 到本地（已存在且非强制时跳过），并生成中文标题版 .zh.html */
async function ensurePreviews(dirs) {
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  const jobs = [];
  for (const dir of dirs) {
    for (const variant of ['preview', 'preview-dark']) {
      const localPath = path.join(PREVIEW_DIR, dir, variant + '.html');
      if (!REFRESH_PREVIEWS && fs.existsSync(localPath) && fs.statSync(localPath).size > 0) {
        jobs.push({ dir, variant, localPath, cached: true });
        continue;
      }
      jobs.push({ dir, variant, localPath, cached: false });
    }
  }
  const download = async (j) => {
    try {
      const buf = await downloadOne(`${SITE_BASE}/design-md/${encodeURIComponent(j.dir)}/${j.variant}.html`);
      if (!buf) return { ...j, status: 'missing' };
      fs.mkdirSync(path.dirname(j.localPath), { recursive: true });
      fs.writeFileSync(j.localPath, buf);
      return { ...j, status: 'downloaded' };
    } catch (e) {
      console.warn(`  预览抓取失败: ${j.dir}/${j.variant} -> ${e.message}`);
      return { ...j, status: 'failed' };
    }
  };
  // 并发池：最多 8 个同时下载
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(8, jobs.length) }, async () => {
    while (cursor < jobs.length) {
      const j = jobs[cursor++];
      results.push(j.cached ? { ...j, status: 'cached' } : await download(j));
    }
  });
  await Promise.all(workers);
  // 为每个本地 preview 生成中文标题版 .zh.html，并汇总为 dir -> { light, dark }
  const map = new Map();
  let downloaded = 0, cached = 0, missing = 0, failed = 0, zhOk = 0;
  for (const r of results) {
    if (r.status === 'downloaded') downloaded++;
    else if (r.status === 'cached') cached++;
    else if (r.status === 'missing') missing++;
    else failed++;
    if (r.status !== 'downloaded' && r.status !== 'cached') continue;
    let relZh = 'previews/' + encodeURIComponent(r.dir) + '/' + r.variant + '.html';
    try {
      const src = fs.readFileSync(r.localPath, 'utf8');
      const zhPath = r.localPath.replace(/\.html$/, '.zh.html');
      // 每次生成都重写中文版（纯字符串处理，开销极小，保证规则更新即生效）
      fs.writeFileSync(zhPath, translatePreviewHtml(src, r.dir), 'utf8');
      relZh = 'previews/' + encodeURIComponent(r.dir) + '/' + path.basename(zhPath);
      zhOk++;
    } catch (e) {
      console.warn(`  中文版生成失败（使用原文）: ${r.dir}/${r.variant} -> ${e.message}`);
    }
    const slot = r.variant === 'preview' ? 'light' : 'dark';
    const o = map.get(r.dir) || {};
    o[slot] = relZh;
    o[slot + 'En'] = 'previews/' + encodeURIComponent(r.dir) + '/' + r.variant + '.html';
    map.set(r.dir, o);
  }
  console.log(`   预览资源: 下载 ${downloaded} · 缓存 ${cached} · 站点缺失 ${missing} · 失败 ${failed} · 中文标题版 ${zhOk}`);
  return map;
}

/* ---------------- 主流程 ---------------- */
async function main() {
  if (!fs.existsSync(DESIGN_DIR)) {
    console.error('未找到 design-md 目录：' + DESIGN_DIR);
    process.exit(1);
  }
  const catMap = parseCategories();
  const dirs = fs.readdirSync(DESIGN_DIR).filter(d => {
    const p = path.join(DESIGN_DIR, d);
    return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'STYLE.md'));
  });
  const brands = dirs.map(d => {
    let b;
    try {
      b = parseBrand(d, path.join(DESIGN_DIR, d, 'STYLE.md'));
    } catch (e) {
      console.warn('降级处理（解析失败）: ' + d + ' -> ' + e.message);
      b = {
        dir: d, label: LABEL_OVERRIDES[d] || d, name: d,
        description: '（此文件解析失败，仅显示原文）',
        primary: '#6366f1', canvas: '#101014', ink: '#f0f0f5', onPrimary: '#ffffff',
        palette: ['#6366f1', '#8b5cf6', '#22c55e'], fontFamily: 'system-ui, sans-serif',
        rounded: {}, spacing: {}, colorCount: 0, typoCount: 0, componentCount: 0,
        dos: [], donts: [], raw: fs.readFileSync(path.join(DESIGN_DIR, d, 'STYLE.md'), 'utf8'),
      };
    }
    const info = catMap.get(d.toLowerCase()) || catMap.get(d.replace(/[^a-z0-9]/gi, '').toLowerCase());
    b.cat = CATEGORY_OVERRIDES[d] || (info ? info.cat : '其他');
    if (!LABEL_OVERRIDES[d] && info) b.label = info.label;
    // 预计算卡片渲染所需派生值
    b.roundedSm = b.rounded.sm || b.rounded.xs || '6px';
    b.roundedMd = b.rounded.md || b.rounded.lg || '12px';
    b.roundedPill = b.rounded.pill || b.rounded.full || '999px';
    b.canvasLum = luminance(b.canvas);
    b.descShort = b.description.slice(0, 110) + (b.description.length > 110 ? '…' : '');
    return b;
  });

  // 排序：分类顺序 + 名称
  const catOrder = [...new Set(brands.map(b => b.cat))];
  brands.sort((a, b) => catOrder.indexOf(a.cat) - catOrder.indexOf(b.cat) || a.label.localeCompare(b.label));
  const catCount = {};
  for (const b of brands) catCount[b.cat] = (catCount[b.cat] || 0) + 1;

  // 抓取 Preview 资源并挂到品牌数据上
  console.log('开始抓取品牌 Preview 资源（已存在的会跳过，可加 --refresh-previews 强制刷新）…');
  console.log(`   下载通道: ${HAS_CURL ? 'curl.exe' : 'Node fetch'} · 代理: ${PROXY || '无'}`);
  const previewMap = await ensurePreviews(brands.map(b => b.dir));
  for (const b of brands) {
    const pv = previewMap.get(b.dir) || {};
    b.pvLight = pv.light || '';
    b.pvDark = pv.dark || '';
    b.pvLightEn = pv.lightEn || '';
    b.pvDarkEn = pv.darkEn || '';
  }

  const dataJson = JSON.stringify(brands).replace(/<\/script/gi, '<\\/script');
  const html = buildHTML(brands, catCount, dataJson);
  fs.writeFileSync(OUT, html, 'utf8');
  const sizeKB = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(`OK 生成 ${OUT}`);
  console.log(`   品牌: ${brands.length} · 分类: ${Object.keys(catCount).length} · 体积: ${sizeKB} KB`);
  console.log('   分类分布:', JSON.stringify(catCount));
}

/* ---------------- HTML 模板 ---------------- */
function escAttrNode(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildHTML(brands, catCount, dataJson) {
  const chips = Object.entries(catCount).map(([cat, n]) =>
    `<button class="chip" data-cat="${escAttrNode(cat)}">${escAttrNode(cat)}<span class="chip-n">${n}</span></button>`).join('');
  return `<!DOCTYPE html>
<html lang="zh-CN" class="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DesignStyleHub · 设计图鉴</title>
<style>
  :root {
    --bg: #0b0d12; --bg-2: #141821; --panel: rgba(20,24,33,.72);
    --text: #e5e9f0; --text-2: #8b93a7; --primary: #6366f1; --primary-2: #8b5cf6;
    --ok: #22c55e; --err: #ef4444;
  }
  html.light {
    --bg: #f4f5f9; --bg-2: #ffffff; --panel: rgba(255,255,255,.8);
    --text: #171a23; --text-2: #5c6373;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background:
      radial-gradient(1200px 600px at 15% -10%, rgba(99,102,241,.16), transparent 60%),
      radial-gradient(900px 500px at 85% 0%, rgba(139,92,246,.12), transparent 55%),
      var(--bg);
    color: var(--text);
    font-family: Inter, "Segoe UI", system-ui, -apple-system, sans-serif;
    min-height: 100vh; transition: background .3s, color .3s;
  }
  .toolbar {
    position: sticky; top: 0; z-index: 50;
    backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
    background: var(--panel);
    border-bottom: 1px solid rgba(139,147,167,.16);
    padding: 14px clamp(16px,4vw,48px);
    display: flex; flex-direction: column; gap: 12px;
  }
  .tb-row { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .logo { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 19px; letter-spacing: -.02em; }
  .logo-mark {
    width: 30px; height: 30px; border-radius: 9px; flex: none;
    background: linear-gradient(135deg, var(--primary), var(--primary-2));
    box-shadow: 0 4px 18px rgba(99,102,241,.45);
    display: grid; place-items: center; color: #fff; font-size: 15px;
  }
  .logo small { color: var(--text-2); font-weight: 500; font-size: 12px; margin-left: 4px; }
  .search-wrap { flex: 1; min-width: 220px; max-width: 480px; position: relative; }
  .search-wrap svg { position: absolute; left: 13px; top: 50%; transform: translateY(-50%); opacity: .5; }
  #search {
    width: 100%; padding: 10px 14px 10px 38px; border-radius: 10px;
    border: 1px solid rgba(139,147,167,.22); background: var(--bg-2);
    color: var(--text); font-size: 14px; outline: none; transition: border .2s, box-shadow .2s;
  }
  #search:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(99,102,241,.22); }
  .tb-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
  .stat { color: var(--text-2); font-size: 13px; }
  #themeToggle {
    width: 38px; height: 38px; border-radius: 50%; border: 1px solid rgba(139,147,167,.25);
    background: var(--bg-2); color: var(--text); cursor: pointer; font-size: 16px;
    display: grid; place-items: center; transition: transform .2s;
  }
  #themeToggle:hover { transform: rotate(20deg) scale(1.06); }
  .chips { display: flex; gap: 8px; flex-wrap: wrap; }
  .chip {
    padding: 6px 13px; border-radius: 999px; cursor: pointer; font-size: 12.5px;
    border: 1px solid rgba(139,147,167,.25); background: transparent; color: var(--text-2); transition: all .18s;
  }
  .chip:hover { border-color: var(--primary); color: var(--text); transform: translateY(-1px); }
  .chip.active {
    background: linear-gradient(135deg, var(--primary), var(--primary-2));
    border-color: transparent; color: #fff; box-shadow: 0 4px 14px rgba(99,102,241,.35);
  }
  .chip-n { opacity: .65; margin-left: 5px; font-size: 11px; }
  .grid {
    padding: 28px clamp(16px,4vw,48px) 80px;
    display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 18px;
  }
  .brand-card {
    padding: 22px; cursor: pointer; overflow: hidden; position: relative;
    transition: transform .22s cubic-bezier(.2,.8,.3,1.2), box-shadow .22s;
    animation: fadeIn .5s both;
  }
  .brand-card:hover { transform: translateY(-5px); box-shadow: 0 18px 44px rgba(0,0,0,.35); }
  .brand-card .view-hint {
    position: absolute; right: 22px; top: 11px; font-size: 12px; opacity: 0; transition: opacity .2s;
  }
  .brand-card:hover .view-hint { opacity: .8; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
  .bc-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .bc-name { font-size: 21px; }
  .bc-meta { font-size: 11.5px; white-space: nowrap; }
  .bc-desc { font-size: 12.5px; line-height: 1.55; margin-top: 10px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .bc-palette { display: flex; gap: 6px; margin-top: 16px; }
  .bc-sw { width: 30px; height: 30px; border-radius: 8px; border: 1px solid rgba(128,128,128,.25); transition: transform .18s; }
  .brand-card:hover .bc-sw { transform: translateY(-3px); }
  .bc-actions { display: flex; align-items: center; gap: 10px; margin-top: 16px; }
  .bc-btn { padding: 8px 18px; font-size: 12.5px; font-weight: 600; white-space: nowrap; }
  .bc-radius-demo { width: 34px; height: 34px; }
  .empty { grid-column: 1/-1; text-align: center; color: var(--text-2); padding: 60px 0; font-size: 15px; }
  .modal-mask {
    position: fixed; inset: 0; z-index: 100; background: rgba(4,6,10,.66);
    backdrop-filter: blur(8px); display: none; align-items: center; justify-content: center; padding: 24px;
  }
  .modal-mask.open { display: flex; }
  .modal-wrap {
    position: relative; width: min(980px,100%); max-height: 90vh; display: flex;
    flex-direction: column; border-radius: 20px; overflow: hidden; background: var(--bg-2);
    border: 1px solid rgba(139,147,167,.2); box-shadow: 0 40px 120px rgba(0,0,0,.5);
    animation: fadeIn .2s;
  }
  .md-body { flex: 1; padding: 26px 30px; overflow-y: auto; }
  .md-head {
    display: flex; align-items: center; justify-content: space-between;
    gap: 16px; flex-wrap: wrap;
    padding: 14px 18px; margin-bottom: 20px;
    background: var(--bg); border: 1px solid rgba(139,147,167,.15); border-radius: 14px;
  }
  .md-palette { display: flex; flex-wrap: wrap; gap: 8px; }
  .md-palette .bc-sw { width: 34px; height: 34px; border-radius: 9px; }
  .md-actions { display: flex; gap: 10px; flex-wrap: wrap; }
  .btn {
    padding: 10px 18px; border-radius: 10px; border: none; cursor: pointer; font-size: 13.5px; font-weight: 600;
    background: linear-gradient(135deg, var(--primary), var(--primary-2)); color: #fff;
    box-shadow: 0 6px 18px rgba(99,102,241,.4); transition: transform .15s, box-shadow .15s;
    display: inline-flex; align-items: center; gap: 7px; text-decoration: none;
  }
  .btn:hover { transform: translateY(-2px); box-shadow: 0 10px 26px rgba(99,102,241,.5); }
  .btn.ghost { background: transparent; color: var(--text); border: 1px solid rgba(139,147,167,.3); box-shadow: none; }
  .md-close {
    position: absolute; top: 16px; right: 18px; z-index: 5;
    width: 36px; height: 36px; border-radius: 50%; border: 1px solid rgba(139,147,167,.3);
    background: var(--bg-2); color: var(--text); cursor: pointer; font-size: 16px;
  }
  .dd-title { font-size: 13px; color: var(--text-2); text-transform: uppercase; letter-spacing: .1em; margin: 22px 0 10px; }
  .tk-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .tk-table td { padding: 6px 8px; border-bottom: 1px solid rgba(139,147,167,.12); vertical-align: middle; }
  .tk-k { color: var(--text-2); white-space: nowrap; width: 40%; }
  .tk-v { word-break: break-all; }
  .tk-v.mono { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-size: 11.5px; }
  .tk-sw { display: inline-block; width: 20px; height: 20px; border-radius: 6px; border: 1px solid rgba(128,128,128,.3); }
  .dd-sub { font-size: 14px; margin: 20px 0 8px; }
  .dd-list { font-size: 13px; line-height: 1.7; color: var(--text-2); padding-left: 18px; }
  .dd-list.ok li::marker { color: var(--ok); }
  .dd-list.no li::marker { color: var(--err); }
  .raw-md {
    margin-top: 14px; background: var(--bg); border: 1px solid rgba(139,147,167,.18);
    border-radius: 12px; padding: 16px; font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
    font-size: 11.5px; line-height: 1.6; white-space: pre-wrap; word-break: break-word;
    max-height: 420px; overflow-y: auto; color: var(--text-2);
  }
  .pv-tabs { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
  .pv-tab {
    padding: 5px 16px; border-radius: 999px; border: 1px solid rgba(139,147,167,.3);
    background: transparent; color: var(--text-2); cursor: pointer; font-size: 12px; font-weight: 600;
    transition: all .15s;
  }
  .pv-tab:hover { color: var(--text); border-color: var(--primary); transform: translateY(-1px); }
  .pv-tab.active {
    background: linear-gradient(135deg, var(--primary), var(--primary-2));
    color: #fff; border-color: transparent; box-shadow: 0 3px 10px rgba(99,102,241,.35);
  }
  .pv-frame {
    width: 100%; height: 800px; border: 1px solid rgba(139,147,167,.22); border-radius: 12px;
    background: #ffffff; display: block;
  }
  .pv-empty { font-size: 13px; color: var(--text-2); padding: 12px 0; }
  .pv-empty a { color: var(--primary); }
  .toast {
    position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%) translateY(80px);
    background: var(--ok); color: #fff; padding: 11px 22px; border-radius: 12px; font-size: 13.5px;
    font-weight: 600; opacity: 0; transition: all .3s cubic-bezier(.2,.8,.3,1.2); z-index: 200;
    box-shadow: 0 10px 30px rgba(34,197,94,.4); pointer-events: none;
  }
  .toast.show { transform: translateX(-50%) translateY(0); opacity: 1; }
  .toast.err { background: var(--err); box-shadow: 0 10px 30px rgba(239,68,68,.4); }
  /* 新增品牌（草稿）相关样式 */
  .btn.sm { padding: 8px 14px; font-size: 12.5px; }
  .local-stat { color: var(--primary); }
  .storage-banner {
    padding: 10px 14px; border-radius: 10px; font-size: 12.5px; color: #fff;
    background: var(--err); box-shadow: 0 6px 18px rgba(239,68,68,.3);
  }
  .bc-badge {
    margin-left: 8px; padding: 2px 8px; border-radius: 999px; font-size: 10.5px; font-weight: 700;
    background: rgba(99,102,241,.18); color: var(--primary); border: 1px solid rgba(99,102,241,.4); vertical-align: middle;
  }
  .brand-card.is-local { outline: 2px dashed rgba(99,102,241,.55); outline-offset: 2px; }
  .dlg-mask {
    position: fixed; inset: 0; z-index: 120; display: none;
    background: rgba(6,8,14,.7); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    overflow-y: auto; padding: 40px 16px;
  }
  .dlg-mask.open { display: block; }
  .dlg {
    max-width: 860px; margin: 0 auto; background: var(--bg-2); border: 1px solid rgba(139,147,167,.22);
    border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,.5); position: relative;
  }
  .dlg-head { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 18px 22px; border-bottom: 1px solid rgba(139,147,167,.18); }
  /* 复用 .md-close 的圆形样式，但在对话框头部改为常规流式布局，避免与「表单/导出」页签重叠 */
  .dlg-head .md-close { position: static; flex: 0 0 auto; margin-left: 2px; }
  .dlg-title { font-size: 16px; font-weight: 700; flex: 1 1 160px; }
  .dlg-panes { display: flex; gap: 8px; flex: 0 0 auto; }
  .dlg-body { padding: 20px 22px 24px; }
  .dlg-hint { font-size: 12.5px; color: var(--text-2); line-height: 1.7; margin-bottom: 14px; }
  .dlg-hint code { font-family: ui-monospace, Consolas, monospace; color: var(--text); }
  .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px 16px; }
  .fld { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--text-2); }
  .fld-wide { grid-column: 1 / -1; }
  .fld input, .fld select, .fld textarea {
    font: inherit; font-size: 13px; color: var(--text); background: var(--bg);
    border: 1px solid rgba(139,147,167,.28); border-radius: 9px; padding: 9px 11px; width: 100%;
    font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
  }
  .fld textarea { font-family: Inter, "Segoe UI", system-ui, sans-serif; resize: vertical; }
  .fld input:focus, .fld select:focus, .fld textarea:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px rgba(99,102,241,.2); }
  .fld input:disabled { opacity: .55; }
  .fld-err { font-size: 11.5px; line-height: 1.5; min-height: 0; }
  .fld-err.bad { color: var(--err); }
  .fld-err.warn { color: #e0a800; }
  .form-errors:not(:empty) {
    margin-bottom: 14px; padding: 12px 14px; border-radius: 10px; font-size: 12.5px;
    background: rgba(239,68,68,.1); border: 1px solid rgba(239,68,68,.35); color: var(--text);
  }
  .form-errors ul { margin: 6px 0 0 18px; line-height: 1.7; }
  .form-errors li { cursor: pointer; }
  .form-errors li:hover { color: var(--err); }
  .dlg-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 20px; }
  .btn.danger { background: transparent; color: var(--err); border: 1px solid rgba(239,68,68,.5); box-shadow: none; }
  .ex-pre {
    max-height: 360px; overflow: auto; background: var(--bg); border: 1px solid rgba(139,147,167,.2);
    border-radius: 12px; padding: 14px; font-family: ui-monospace, Consolas, monospace; font-size: 11.5px;
    line-height: 1.55; white-space: pre; color: var(--text-2);
  }
  footer { text-align: center; color: var(--text-2); font-size: 12px; padding: 0 0 40px; }
  footer a { color: var(--primary); text-decoration: none; }
</style>
</head>
<body>
<header class="toolbar">
  <div class="tb-row">
    <div class="logo"><span class="logo-mark">DS</span>DesignStyleHub<small>STYLE.md 设计图鉴</small></div>
    <div class="search-wrap">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
      <input id="search" type="text" placeholder="搜索品牌（如 stripe / linear / nvidia）…" autocomplete="off">
    </div>
    <div class="tb-right">
      <span class="stat" id="stat"></span>
      <span class="stat local-stat" id="localStat" style="display:none"></span>
      <button class="btn sm" id="addBrandBtn">＋ 新增品牌</button>
      <button id="themeToggle" title="深浅色切换">🌙</button>
    </div>
  </div>
  <div class="chips" id="chips"><button class="chip active" data-cat="">全部</button>${chips}</div>
  <div class="storage-banner" id="storageBanner" style="display:none">当前浏览器禁止本地文件页写入存储：草稿只存在于这一次打开的页面里，刷新即丢。请随时用「导出」备份。</div>
</header>
<main class="grid" id="grid"></main>
<footer>数据来源：<a href="https://github.com/dialogue-in-code/design-style-hub" target="_blank" rel="noopener">DesignStyleHub</a> · 本地仓库 design-style · 点击卡片查看设计令牌并复制 STYLE.md</footer>

<div class="modal-mask" id="modalMask">
  <div class="modal-wrap">
    <button class="md-close" id="modalClose">✕</button>
    <div class="md-body" id="mdBody"></div>
  </div>
</div>

<div class="dlg-mask" id="dlgMask">
  <div class="dlg">
    <div class="dlg-head">
      <div class="dlg-title" id="dlgTitle">新增品牌</div>
      <div class="dlg-panes">
        <button class="pv-tab active" id="dlgPaneFormBtn">表单</button>
        <button class="pv-tab" id="dlgPaneExportBtn">导出</button>
      </div>
      <button class="md-close" id="dlgClose">✕</button>
    </div>
    <div class="dlg-body">
      <div id="paneForm">
        <p class="dlg-hint" id="dlgHint"></p>
        <div class="form-errors" id="formErrors"></div>
        <div id="ab-form" class="form-grid">
          <label class="fld fld-wide"><span>目录名 dir（小写字母数字与 . _ -）</span>
            <input id="ab-dir" type="text" placeholder="my-brand" autocomplete="off"><p class="fld-err" id="err-dir"></p></label>
          <label class="fld"><span>显示名 label</span>
            <input id="ab-label" type="text" placeholder="My Brand" autocomplete="off"><p class="fld-err" id="err-label"></p></label>
          <label class="fld"><span>分类</span>
            <select id="ab-cat"><option value="">（空则归入「其他」）</option></select>
            <input id="ab-catnew" type="text" placeholder="新分类名" style="display:none" autocomplete="off"></label>
          <label class="fld fld-wide"><span>描述（卡片与 STYLE.md 都用它）</span>
            <textarea id="ab-description" rows="3" placeholder="一句话说清这个品牌的视觉气质"></textarea><p class="fld-err" id="err-description"></p></label>
          <label class="fld"><span>主色 primary</span>
            <input id="ab-primary" type="text" placeholder="#6366f1" autocomplete="off"><p class="fld-err" id="err-primary"></p></label>
          <label class="fld"><span>画布 canvas</span>
            <input id="ab-canvas" type="text" placeholder="#ffffff" autocomplete="off"><p class="fld-err" id="err-canvas"></p></label>
          <label class="fld"><span>文字 ink</span>
            <input id="ab-ink" type="text" placeholder="#17171c" autocomplete="off"><p class="fld-err" id="err-ink"></p></label>
          <label class="fld"><span>主色上的字 on-primary</span>
            <input id="ab-onPrimary" type="text" placeholder="#ffffff" autocomplete="off"><p class="fld-err" id="err-onPrimary"></p></label>
          <label class="fld"><span>展示字体族</span>
            <input id="ab-font" type="text" placeholder="Inter" autocomplete="off"></label>
          <label class="fld"><span>display-xl 字号</span>
            <input id="ab-dsize" type="text" placeholder="64px" autocomplete="off"></label>
          <label class="fld"><span>display-xl 字重</span>
            <input id="ab-dweight" type="text" placeholder="600" autocomplete="off"></label>
          <label class="fld"><span>display-xl 行高</span>
            <input id="ab-lheight" type="text" placeholder="1.05" autocomplete="off"></label>
          <label class="fld"><span>圆角 sm</span>
            <input id="ab-rsm" type="text" placeholder="6px" autocomplete="off"></label>
          <label class="fld"><span>圆角 md</span>
            <input id="ab-rmd" type="text" placeholder="12px" autocomplete="off"></label>
          <label class="fld"><span>圆角 pill</span>
            <input id="ab-rpill" type="text" placeholder="999px" autocomplete="off"></label>
          <label class="fld fld-wide"><span>附加色板（每行 key: #rrggbb）</span>
            <textarea id="ab-colorsText" rows="3" placeholder="accent: #ff6600"></textarea><p class="fld-err" id="err-colorsText"></p></label>
          <label class="fld fld-wide"><span>间距（每行 key: value）</span>
            <textarea id="ab-spacing" rows="2" placeholder="md: 16px"></textarea></label>
          <label class="fld fld-wide"><span>Do（每行一条，第 7 条起被截断）</span>
            <textarea id="ab-dosText" rows="3"></textarea><p class="fld-err" id="err-dosText"></p></label>
          <label class="fld fld-wide"><span>Don't（每行一条，第 7 条起被截断）</span>
            <textarea id="ab-dontsText" rows="3"></textarea><p class="fld-err" id="err-dontsText"></p></label>
          <label class="fld fld-wide"><span>STYLE.md 原文覆盖（可选；非空时导出与复制都用它，页面不会反向解析它）</span>
            <textarea id="ab-raw" rows="5" placeholder="留空则由表单自动生成 STYLE.md"></textarea></label>
        </div>
        <div class="dlg-actions">
          <button class="btn" id="ab-save">保存草稿</button>
          <button class="btn ghost" id="ab-cancel">取消</button>
          <button class="btn ghost" id="ab-export">导出</button>
          <button class="btn ghost danger" id="ab-del">删除草稿</button>
        </div>
      </div>
      <div id="paneExport" style="display:none">
        <p class="dlg-hint">导出的是「文件 + 目标路径」。把它们放进仓库后重跑 <code>node scripts/generate-design-gallery.mjs</code>（不带 --refresh-previews 即零网络），草稿才会变成正式资产；此后可以从卡片上删除同名草稿。</p>
        <div class="pv-tabs" id="exportTabs"></div>
        <p class="dlg-hint" id="exportPath"></p>
        <pre class="ex-pre" id="exportBody"></pre>
        <div class="dlg-actions">
          <button class="btn" id="exCopy">复制当前文件</button>
          <button class="btn ghost" id="exDownload">下载当前文件</button>
          <button class="btn ghost" id="exDownloadAll">下载全部</button>
          <button class="btn ghost" id="dlgBackForm">回表单</button>
        </div>
      </div>
    </div>
  </div>
</div>
<div class="toast" id="toast">已复制到剪贴板</div>

<script id="gallery-data" type="application/json">${dataJson}<\/script>
<script>
"use strict";
var DATA = JSON.parse(document.getElementById('gallery-data').textContent);
var grid = document.getElementById('grid');
var chipsEl = document.getElementById('chips');
var searchEl = document.getElementById('search');
var mask = document.getElementById('modalMask');
var toast = document.getElementById('toast');
var SITE_BASE_SAFE = "https://getdesign.md";
var curCat = '', curQuery = '';

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function cssStr(s) { return String(s).replace(/["';{}\\\\]/g, ''); }

/* ---------- 新增品牌（草稿）· 纯函数区 ----------
   以下函数不触碰 DOM，可被 tests/06 切片后单独求值验证。
   约束：本区块位于 JS 模板字符串内，禁止使用反引号、美元花括号；正则里的反斜杠必须翻倍。 */
/* PURE-ADD-BRAND-BEGIN */
var HEX6_RE = /^#[0-9a-fA-F]{6}$/;
var DIR_RE = /^[a-z0-9][a-z0-9._-]*$/;
var NOISE_KEY_RE = /soft|deep|hover|focus|selection|bg-|on-|inverse|overlay|shadow/i;

function hEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function oneLine(s) {
  var t = String(s == null ? '' : s).split('\\n').join(' ').split('\\r').join(' ');
  while (t.indexOf('  ') !== -1) t = t.split('  ').join(' ');
  return t.trim();
}
function mdScalar(s) {
  // 会被极简 YAML 解析器误读的字符：双引号（走引号早退分支）与 #（走注释剥离）
  return oneLine(s).split('"').join('').split('#').join('');
}
function splitLines(text) {
  var out = [];
  var arr = String(text == null ? '' : text).split('\\n');
  for (var i = 0; i < arr.length; i++) { var s = arr[i].trim(); if (s) out.push(s); }
  return out;
}
function parsePairs(text) {
  var out = [];
  var arr = splitLines(text);
  for (var i = 0; i < arr.length; i++) {
    var ix = arr[i].indexOf(':');
    if (ix === -1) { out.push({ k: arr[i], v: '' }); continue; }
    out.push({ k: arr[i].slice(0, ix).trim(), v: arr[i].slice(ix + 1).trim() });
  }
  return out;
}
function parseBullets(text) {
  var out = [];
  var arr = splitLines(text);
  for (var i = 0; i < arr.length; i++) out.push(arr[i].replace(/^[-*][ \\t]+/, ''));
  return out;
}
function luminanceLocal(hex) {
  var h = String(hex || '').replace('#', '');
  if (h.length < 6) return 0.5;
  var r = parseInt(h.slice(0, 2), 16) / 255;
  var g = parseInt(h.slice(2, 4), 16) / 255;
  var b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function pickPaletteLocal(colors, primary) {
  var seen = {}; var out = []; var keys = [];
  if (primary && HEX6_RE.test(primary)) { out.push(primary); seen[primary.toLowerCase()] = 1; }
  for (var k in colors) if (Object.prototype.hasOwnProperty.call(colors, k)) keys.push(k);
  for (var i = 0; i < keys.length; i++) {
    if (out.length >= 8) break;
    var kk = keys[i], v = colors[kk];
    if (!HEX6_RE.test(String(v))) continue;
    if (NOISE_KEY_RE.test(kk)) continue;
    if (seen[String(v).toLowerCase()]) continue;
    if (kk === 'primary') continue;
    seen[String(v).toLowerCase()] = 1;
    out.push(String(v));
  }
  return out;
}
function tokensFrom(form) {
  var colors = {};
  colors.primary = form.primary;
  colors.canvas = form.canvas;
  colors.ink = form.ink;
  colors['on-primary'] = form.onPrimary;
  var extra = parsePairs(form.colorsText);
  for (var i = 0; i < extra.length; i++) {
    var k = mdScalar(extra[i].k).split(' ').join('-');
    if (!k || !HEX6_RE.test(extra[i].v)) continue;
    colors[k] = extra[i].v;
  }
  var rounded = { sm: form.roundedSm || '6px', md: form.roundedMd || '12px', pill: form.roundedPill || '999px' };
  var spacing = {};
  var sp = parsePairs(form.spacingText);
  for (var j = 0; j < sp.length; j++) {
    var sk = mdScalar(sp[j].k).split(' ').join('-');
    if (!sk) continue;
    spacing[sk] = mdScalar(sp[j].v);
  }
  var typo = {};
  typo['display-xl'] = {
    fontFamily: mdScalar(form.fontFamily) || 'Inter',
    fontSize: mdScalar(form.displaySize) || '64px',
    fontWeight: mdScalar(form.displayWeight) || '600',
    lineHeight: mdScalar(form.lineHeight) || '1.05'
  };
  return { colors: colors, rounded: rounded, spacing: spacing, typo: typo };
}
function deriveLocalBrand(form) {
  var t = tokensFrom(form);
  var desc = String(form.description || '').slice(0, 600);
  var roundedSm = t.rounded.sm || t.rounded.xs || '6px';
  var roundedMd = t.rounded.md || t.rounded.lg || '12px';
  var roundedPill = t.rounded.pill || t.rounded.full || '999px';
  return {
    dir: form.dir, label: form.label || form.dir, name: (form.label || form.dir) + '-local-draft',
    description: desc,
    primary: form.primary, canvas: form.canvas, ink: form.ink, onPrimary: form.onPrimary,
    palette: pickPaletteLocal(t.colors, form.primary),
    fontFamily: t.typo['display-xl'].fontFamily,
    tokensColors: t.colors, tokensTypo: t.typo, tokensRounded: t.rounded, tokensSpacing: t.spacing,
    rounded: t.rounded, spacing: t.spacing,
    colorCount: Object.keys(t.colors).length, typoCount: Object.keys(t.typo).length, componentCount: 0,
    dos: parseBullets(form.dosText).slice(0, 6), donts: parseBullets(form.dontsText).slice(0, 6),
    raw: form.rawOverride && form.rawOverride.trim() ? form.rawOverride : serializeDesignMd(form),
    cat: form.cat || '其他',
    roundedSm: roundedSm, roundedMd: roundedMd, roundedPill: roundedPill,
    canvasLum: luminanceLocal(form.canvas),
    descShort: desc.slice(0, 110) + (desc.length > 110 ? '…' : ''),
    pvLight: '', pvDark: ''
  };
}
function serializeDesignMd(form) {
  var t = tokensFrom(form);
  var L = ['---', 'version: alpha', 'name: ' + mdScalar(form.label || form.dir),
    'description: "' + (oneLine(form.description).split('"').join('') || '本地草稿品牌') + '"', 'colors:'];
  for (var ck in t.colors) if (Object.prototype.hasOwnProperty.call(t.colors, ck)) L.push('  ' + ck + ': "' + t.colors[ck] + '"');
  L.push('', 'typography:', '  display-xl:',
    '    fontFamily: ' + t.typo['display-xl'].fontFamily,
    '    fontSize: ' + t.typo['display-xl'].fontSize,
    '    fontWeight: ' + t.typo['display-xl'].fontWeight,
    '    lineHeight: ' + t.typo['display-xl'].lineHeight, '', 'rounded:');
  for (var rk in t.rounded) if (Object.prototype.hasOwnProperty.call(t.rounded, rk)) L.push('  ' + rk + ': ' + t.rounded[rk]);
  if (Object.keys(t.spacing).length) {
    L.push('', 'spacing:');
    for (var sk in t.spacing) if (Object.prototype.hasOwnProperty.call(t.spacing, sk)) L.push('  ' + sk + ': ' + t.spacing[sk]);
  }
  L.push('---', '', '# ' + mdScalar(form.label || form.dir), '', '## Palette', '',
    '本文件由 DesignStyleHub 首页「新增品牌」草稿导出，尚未进入构建资产。');
  var dos = parseBullets(form.dosText).slice(0, 6);
  var donts = parseBullets(form.dontsText).slice(0, 6);
  if (dos.length) { L.push('', '## Do', ''); for (var i = 0; i < dos.length; i++) L.push('- ' + oneLine(dos[i])); }
  if (donts.length) { L.push('', "## Don't", ''); for (var j = 0; j < donts.length; j++) L.push('- ' + oneLine(donts[j])); }
  L.push('');
  return L.join('\\n');
}
function validateLocalBrand(form, builtDirs, draftDirs) {
  var errors = []; var warns = [];
  var dir = String(form.dir || '').trim();
  if (!dir) errors.push({ field: 'dir', msg: '目录名必填，它将作为 design-md 下的文件夹名' });
  else if (dir.length > 40) errors.push({ field: 'dir', msg: '目录名不要超过 40 个字符' });
  else if (!DIR_RE.test(dir)) errors.push({ field: 'dir', msg: '只能用 a-z 0-9 与 . _ -，且必须以字母或数字开头（如 my-brand / acme.ai）' });
  else if (builtDirs[dir]) errors.push({ field: 'dir', msg: '该目录名已被构建资产占用（' + builtDirs[dir] + '），请改名' });
  else if (draftDirs[dir]) errors.push({ field: 'dir', msg: '本地已有同名草稿，请直接在那张卡片上点「编辑」' });
  var need = [['primary', '主色'], ['canvas', '画布色'], ['ink', '文字色'], ['onPrimary', '主色上的文字色']];
  for (var i = 0; i < need.length; i++) {
    var v = String(form[need[i][0]] || '').trim();
    if (!v) errors.push({ field: need[i][0], msg: need[i][1] + '不能为空' });
    else if (!HEX6_RE.test(v)) errors.push({ field: need[i][0], msg: need[i][1] + '请用 6 位十六进制，如 #112233（不接受 #fff 缩写，明暗判定会漂移）' });
  }
  var extra = parsePairs(form.colorsText);
  for (var e = 0; e < extra.length; e++) {
    if (!HEX6_RE.test(extra[e].v)) errors.push({ field: 'colorsText', msg: '附加色板第 ' + (e + 1) + ' 行不是 6 位十六进制：' + extra[e].k });
  }
  if (!String(form.label || '').trim()) errors.push({ field: 'label', msg: '显示名必填' });
  if (!String(form.description || '').trim()) errors.push({ field: 'description', msg: '描述必填（卡片与 STYLE.md 都依赖它）' });
  else if (String(form.description).length > 600) warns.push({ field: 'description', msg: '超过 600 字，导出与构建都会截断（与 parseBrand 一致）' });
  var pal = pickPaletteLocal(tokensFrom(form).colors, form.primary);
  if (Object.keys(tokensFrom(form).colors).length > 8) warns.push({ field: 'colorsText', msg: '卡片色板最多显示 8 个，超出部分被 pickPalette 过滤' });
  if (parseBullets(form.dosText).length > 6) warns.push({ field: 'dosText', msg: '第 7 条起被忽略（构建期 extractBullets 截断 6 条）' });
  if (parseBullets(form.dontsText).length > 6) warns.push({ field: 'dontsText', msg: '第 7 条起被忽略（构建期 extractBullets 截断 6 条）' });
  if (!pal.length) warns.push({ field: 'palette', msg: '色板只剩主色：键名含 soft/deep/hover/focus/bg-/on-/overlay 等会被当作噪声过滤' });
  return { errors: errors, warns: warns, ok: errors.length === 0 };
}
function loadLocalBrands(text) {
  if (!text || !String(text).trim()) return { ok: true, items: [], error: '' };
  var parsed;
  try { parsed = JSON.parse(text); } catch (e) { return { ok: false, items: [], error: 'JSON 解析失败' }; }
  if (!parsed || Object.prototype.toString.call(parsed) !== '[object Array]') return { ok: false, items: [], error: '顶层不是数组' };
  var out = []; var dropped = 0;
  for (var i = 0; i < parsed.length; i++) {
    var it = parsed[i];
    if (!it || typeof it !== 'object' || !it.dir || !HEX6_RE.test(String(it.primary)) ||
      !HEX6_RE.test(String(it.canvas)) || !HEX6_RE.test(String(it.ink)) || !HEX6_RE.test(String(it.onPrimary))) { dropped++; continue; }
    out.push(it);
  }
  return { ok: dropped === 0, items: out, error: dropped ? ('丢弃 ' + dropped + ' 条非法草稿') : '' };
}
function buildLocalPreviewHtml(form, mode) {
  var t = tokensFrom(form);
  var dark = mode === 'dark';
  var canvas = dark ? (luminanceLocal(t.canvas) < 0.5 ? t.canvas : '#101014') : (luminanceLocal(t.canvas) > 0.5 ? t.canvas : '#fafafa');
  var ink = dark ? (luminanceLocal(canvas) < 0.5 ? t.ink : '#f0f0f5') : (luminanceLocal(canvas) > 0.5 ? t.ink : '#17171c');
  var hair = luminanceLocal(canvas) > 0.5 ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.16)';
  var sub = luminanceLocal(canvas) > 0.5 ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.55)';
  var sw = [];
  for (var ck in t.colors) if (Object.prototype.hasOwnProperty.call(t.colors, ck)) {
    sw.push('<div class="row"><span class="chip" style="background:' + hEsc(t.colors[ck]) + '"></span>' +
      '<code>' + hEsc(ck) + '</code><b style="color:' + hEsc(ink) + '">' + hEsc(t.colors[ck]) + '</b></div>');
  }
  var spRows = [];
  for (var sk in t.spacing) if (Object.prototype.hasOwnProperty.call(t.spacing, sk)) {
    spRows.push('<div class="row"><span class="bar" style="width:' + hEsc(t.spacing[sk]) + ';background:' + hEsc(t.primary) + '"></span>' +
      '<code>' + hEsc(sk) + '</code><b style="color:' + hEsc(ink) + '">' + hEsc(t.spacing[sk]) + '</b></div>');
  }
  if (!spRows.length) spRows.push('<div class="row"><span class="bar" style="width:16px;background:' + hEsc(t.primary) + '"></span><code>md</code><b style="color:' + hEsc(ink) + '">16px</b></div>');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>' + hEsc(form.label || form.dir) +
    ' design draft</title><style>' +
      'body{margin:0;background:' + hEsc(canvas) + ';color:' + hEsc(ink) + ';font-family:' + hEsc(t.typo['display-xl'].fontFamily) + ';line-height:1.6}' +
      '.wrap{max-width:960px;margin:0 auto;padding:32px 24px 64px}' +
      'nav{display:flex;gap:16px;align-items:center;padding:14px 24px;border-bottom:1px solid ' + hair + ';font-size:14px}' +
      '.brand{font-weight:700}nav a{color:' + sub + ';text-decoration:none;margin-right:12px}' +
      'h1{font-size:' + hEsc(t.typo['display-xl'].fontSize) + ';font-weight:' + hEsc(t.typo['display-xl'].fontWeight) +
        ';line-height:' + hEsc(t.typo['display-xl'].lineHeight) + ';margin:0 0 12px;letter-spacing:-.02em}' +
      'h2{font-size:14px;text-transform:uppercase;letter-spacing:.1em;color:' + sub + ';margin:36px 0 14px}' +
      '.hero p{color:' + sub + ';max-width:640px;margin:0}' +
      '.hero-actions{display:flex;gap:12px;margin-top:20px}' +
      '.btn{display:inline-block;padding:12px 22px;border-radius:' + hEsc(t.rounded.pill) + ';font-weight:600;font-size:14px}' +
      '.btn-primary{background:' + hEsc(t.primary) + ';color:' + hEsc(t.onPrimary) + '}' +
      '.btn-secondary{border:1px solid ' + hEsc(t.primary) + ';color:' + hEsc(ink) + ';border-radius:' + hEsc(t.rounded.sm) + '}' +
      '.row{display:flex;align-items:center;gap:12px;padding:6px 0;border-bottom:1px solid ' + hair + ';font-size:13px}' +
      '.chip{width:28px;height:28px;border-radius:8px;border:1px solid ' + hair + '}' +
      '.bar{height:10px;border-radius:2px;display:inline-block}' +
      'code{flex:1;color:' + sub + '}b{font-weight:600}' +
      '.card{border:1px solid ' + hair + ';border-radius:' + hEsc(t.rounded.md) + ';padding:22px;margin:12px 0}' +
      '.card h3{margin:0 0 8px;font-size:16px}.card p{margin:0;color:' + sub + ';font-size:14px}' +
      '.rad{display:flex;gap:14px;flex-wrap:wrap}.rad span{width:72px;height:56px;border:2px dashed ' + hEsc(t.primary) + '}' +
    '</style></head><body>' +
    '<nav><span class="brand">' + hEsc(form.label || form.dir) + '</span><a href="#palette">色彩</a><a href="#typography">排版</a><a href="#cards">卡片</a></nav>' +
    '<div class="wrap"><section class="hero"><h1>' + hEsc(form.label || form.dir) + '</h1><p>' + hEsc(oneLine(form.description)) + '</p>' +
      '<div class="hero-actions"><span class="btn btn-primary">开始使用</span><span class="btn btn-secondary">查看文档</span></div></section>' +
    '<section id="palette"><h2>Color Palette</h2>' + sw.join('') + '</section>' +
    '<section id="typography"><h2>Typography Scale</h2><div class="card"><div style="font-size:' + hEsc(t.typo['display-xl'].fontSize) +
      ';font-weight:' + hEsc(t.typo['display-xl'].fontWeight) + ';line-height:' + hEsc(t.typo['display-xl'].lineHeight) + '">Design 设计 Aa</div>' +
      '<p>display-xl · ' + hEsc(t.typo['display-xl'].fontFamily) + ' ' + hEsc(t.typo['display-xl'].fontSize) + ' / ' + hEsc(t.typo['display-xl'].fontWeight) + '</p></div></section>' +
    '<section id="buttons"><h2>Button Variants</h2><div class="hero-actions"><span class="btn btn-primary">Primary</span>' +
      '<span class="btn btn-secondary">Secondary</span></div></section>' +
    '<section id="cards"><h2>Card Examples</h2><div class="card"><h3>Feature Card Example</h3><p>' + hEsc(oneLine(form.description).slice(0, 120)) + '</p></div></section>' +
    '<section id="spacing"><h2>Spacing Scale</h2>' + spRows.join('') + '</section>' +
    '<section id="radius"><h2>Border Radius Scale</h2><div class="rad">' +
      '<span style="border-radius:' + hEsc(t.rounded.sm) + '"></span><span style="border-radius:' + hEsc(t.rounded.md) + '"></span>' +
      '<span style="border-radius:' + hEsc(t.rounded.pill) + '"></span></div></section>' +
    '<footer style="margin-top:48px;color:' + sub + ';font-size:12px">本地草稿预览 · 导出并放入仓库重跑构建后将替换为正式预览页</footer></div></body></html>';
}
/* PURE-ADD-BRAND-END */

/* ---------- 本地草稿：存储、合并、表单、导出 ---------- */
var STORE_KEY = 'dsh.localBrands.v1';
var BASE_DATA = DATA.slice(0);
var BUILT_DIRS = {};
BASE_DATA.forEach(function (b) { BUILT_DIRS[b.dir] = b.label; });
var LOCAL = [];
var SHADOWED = 0;
var curLocalForm = null;
var curLocalPv = null;
var exportFiles = [];
var exportIdx = 0;
var dlgMask = document.getElementById('dlgMask');
var storageOk = (function () {
  try { localStorage.setItem('dsh.probe', '1'); localStorage.removeItem('dsh.probe'); return true; } catch (e) { return false; }
})();
function elId(id) { return document.getElementById(id); }
function val(id) { var e = elId(id); return e ? e.value : ''; }
function setVal(id, v) { var e = elId(id); if (e) e.value = v == null ? '' : v; }

function readStore() {
  if (!storageOk) return '';
  try { return localStorage.getItem(STORE_KEY) || ''; } catch (e) { return ''; }
}
function writeStore() {
  if (!storageOk) return false;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(LOCAL)); return true; } catch (e) { return false; }
}
function draftDirs() {
  var o = {};
  LOCAL.forEach(function (f) { o[f.dir] = f.label || f.dir; });
  return o;
}
function recomputeLocal() {
  var keep = []; SHADOWED = 0;
  for (var i = 0; i < LOCAL.length; i++) {
    if (BUILT_DIRS[LOCAL[i].dir]) { SHADOWED++; continue; }
    keep.push(LOCAL[i]);
  }
  DATA = BASE_DATA.concat(keep.map(deriveLocalBrand));
  syncChips();
  render();
  var ls = elId('localStat');
  if (ls) {
    ls.textContent = LOCAL.length ? ('本地草稿 ' + keep.length + ' 个' + (SHADOWED ? '（' + SHADOWED + ' 个已被构建收录，可删除）' : '')) : '';
    ls.style.display = LOCAL.length ? '' : 'none';
  }
  var bn = elId('storageBanner');
  if (bn) bn.style.display = storageOk ? 'none' : 'block';
}
function syncChips() {
  var byCat = {};
  Array.prototype.forEach.call(chipsEl.querySelectorAll('.chip'), function (c) { byCat[c.dataset.cat] = c; });
  var cats = {};
  DATA.forEach(function (b) { if (b.cat) cats[b.cat] = (cats[b.cat] || 0) + 1; });
  for (var cat in cats) {
    if (!Object.prototype.hasOwnProperty.call(cats, cat)) continue;
    var chip = byCat[cat];
    if (chip) {
      if (chip.dataset.draft === '1') chip.innerHTML = hEsc(cat) + '<span class="chip-n">' + cats[cat] + '</span>';
      continue;
    }
    var btn = document.createElement('button');
    btn.className = 'chip';
    btn.dataset.cat = cat;
    btn.dataset.draft = '1';
    btn.innerHTML = hEsc(cat) + '<span class="chip-n">' + cats[cat] + '</span>';
    chipsEl.appendChild(btn);
  }
}
function formFromInputs() {
  return {
    dir: val('ab-dir').trim().toLowerCase(), label: val('ab-label').trim(), cat: abCat(),
    description: val('ab-description'), primary: val('ab-primary'), canvas: val('ab-canvas'),
    ink: val('ab-ink'), onPrimary: val('ab-onPrimary'), fontFamily: val('ab-font'),
    displaySize: val('ab-dsize'), displayWeight: val('ab-dweight'), lineHeight: val('ab-lheight'),
    roundedSm: val('ab-rsm'), roundedMd: val('ab-rmd'), roundedPill: val('ab-rpill'),
    colorsText: val('ab-colorsText'), spacingText: val('ab-spacing'), dosText: val('ab-dosText'),
    dontsText: val('ab-dontsText'), rawOverride: val('ab-raw')
  };
}
function abCat() {
  var sel = val('ab-cat');
  if (sel === '__new__') return val('ab-catnew').trim();
  return sel;
}
function fillInputs(form) {
  setVal('ab-dir', form.dir); setVal('ab-label', form.label); setVal('ab-description', form.description);
  setVal('ab-primary', form.primary); setVal('ab-canvas', form.canvas); setVal('ab-ink', form.ink);
  setVal('ab-onPrimary', form.onPrimary); setVal('ab-font', form.fontFamily);
  setVal('ab-dsize', form.displaySize); setVal('ab-dweight', form.displayWeight); setVal('ab-lheight', form.lineHeight);
  setVal('ab-rsm', form.roundedSm); setVal('ab-rmd', form.roundedMd); setVal('ab-rpill', form.roundedPill);
  setVal('ab-colorsText', form.colorsText); setVal('ab-spacing', form.spacingText);
  setVal('ab-dosText', form.dosText); setVal('ab-dontsText', form.dontsText); setVal('ab-raw', form.rawOverride);
  var catSel = elId('ab-cat');
  var exists = false;
  Array.prototype.forEach.call(catSel.options, function (o) { if (o.value === form.cat) exists = true; });
  if (exists) catSel.value = form.cat; else { catSel.value = '__new__'; setVal('ab-catnew', form.cat); }
  elId('ab-dir').disabled = !!editingDir;
}
function formFromBrand(b) {
  var colors = [];
  for (var k in b.tokensColors) if (Object.prototype.hasOwnProperty.call(b.tokensColors, k)) {
    if (k === 'primary' || k === 'canvas' || k === 'ink' || k === 'on-primary') continue;
    colors.push(k + ': ' + b.tokensColors[k]);
  }
  var sp = [];
  for (var sk in b.spacing) if (Object.prototype.hasOwnProperty.call(b.spacing, sk)) sp.push(sk + ': ' + b.spacing[sk]);
  var ty = (b.tokensTypo && b.tokensTypo['display-xl']) || {};
  return {
    dir: '', label: b.label, cat: b.cat, description: b.description,
    primary: b.primary, canvas: b.canvas, ink: b.ink, onPrimary: b.onPrimary,
    fontFamily: ty.fontFamily || b.fontFamily, displaySize: ty.fontSize || '', displayWeight: ty.fontWeight || '',
    lineHeight: ty.lineHeight || '', roundedSm: b.roundedSm, roundedMd: b.roundedMd, roundedPill: b.roundedPill,
    colorsText: colors.join('\\n'), spacingText: sp.join('\\n'),
    dosText: b.dos.join('\\n'), dontsText: b.donts.join('\\n'), rawOverride: ''
  };
}
function formOfDraft(dir) {
  for (var i = 0; i < LOCAL.length; i++) if (LOCAL[i].dir === dir) return LOCAL[i];
  return null;
}
function renderValidation(res) {
  var fields = ['dir', 'label', 'description', 'primary', 'canvas', 'ink', 'onPrimary', 'colorsText', 'dosText', 'dontsText'];
  for (var k = 0; k < fields.length; k++) {
    var p0 = elId('err-' + fields[k]);
    if (p0) { p0.textContent = ''; p0.className = 'fld-err'; }
  }
  var box = elId('formErrors');
  var msgOf = {}; var kindOf = {};
  for (var j = 0; j < res.warns.length; j++) if (!msgOf[res.warns[j].field]) { msgOf[res.warns[j].field] = res.warns[j].msg; kindOf[res.warns[j].field] = 'warn'; }
  for (var i = 0; i < res.errors.length; i++) if (!msgOf[res.errors[i].field] || kindOf[res.errors[i].field] === 'warn') { msgOf[res.errors[i].field] = res.errors[i].msg; kindOf[res.errors[i].field] = 'bad'; }
  for (var f in msgOf) if (Object.prototype.hasOwnProperty.call(msgOf, f)) {
    var p = elId('err-' + f);
    if (p) { p.textContent = msgOf[f]; p.className = 'fld-err ' + kindOf[f]; }
  }
  var html = '';
  if (res.errors.length) {
    html = '<strong>有 ' + res.errors.length + ' 项需要修正：</strong><ul>';
    for (var m = 0; m < res.errors.length; m++) html += '<li data-focus="' + hEsc(res.errors[m].field) + '">' + hEsc(res.errors[m].msg) + '</li>';
    html += '</ul>';
  }
  box.innerHTML = html;
  elId('ab-save').disabled = !res.ok;
}

var editingDir = '';
function openDialog(form, dirForEdit) {
  editingDir = dirForEdit || '';
  fillInputs(form);
  elId('dlgTitle').textContent = dirForEdit ? ('编辑草稿 · ' + dirForEdit) : '新增品牌';
  showPane('form');
  elId('ab-del').style.display = dirForEdit ? '' : 'none';
  elId('ab-export').style.display = dirForEdit ? '' : 'none';
  elId('dlgHint').textContent = '草稿只保存在本机浏览器里。要让 84 家之外的它成为正式资产：用「导出」拿到文件，放进 design-style/design-md/<目录名>/ 与 previews/<目录名>/，再重跑 node scripts/generate-design-gallery.mjs。';
  renderValidation(validateLocalBrand(form, BUILT_DIRS, otherDraftDirs(dirForEdit)));
  dlgMask.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function otherDraftDirs(dir) {
  var o = draftDirs();
  if (dir) delete o[dir];
  return o;
}
function closeDialog() {
  var f = formFromInputs();
  if (dlgMask.querySelector('.dirty') && f.dir && !confirm('放弃未保存的草稿内容？')) return;
  dlgMask.classList.remove('open');
  if (!mask.classList.contains('open')) document.body.style.overflow = '';
}
function saveDraft() {
  var f = formFromInputs();
  var res = validateLocalBrand(f, BUILT_DIRS, otherDraftDirs(editingDir));
  renderValidation(res);
  if (!res.ok) return;
  var replaced = false;
  if (editingDir) {
    for (var i = 0; i < LOCAL.length; i++) if (LOCAL[i].dir === editingDir) { LOCAL[i] = f; replaced = true; break; }
  }
  if (!replaced) LOCAL.push(f);
  if (!writeStore()) {
    showToast('浏览器存储不可用，草稿只保留在当前页面；请立即用「导出」备份。', true);
  } else {
    showToast('已保存草稿：' + f.dir + '（' + (storageOk ? '刷新后仍在' : '未持久化') + '）', false);
  }
  recomputeLocal();
  dlgMask.classList.remove('open');
  if (!mask.classList.contains('open')) document.body.style.overflow = '';
}
function deleteDraft() {
  if (!editingDir) return;
  if (!confirm('删除本地草稿 ' + editingDir + '？（不影响仓库文件）')) return;
  for (var i = 0; i < LOCAL.length; i++) if (LOCAL[i].dir === editingDir) { LOCAL.splice(i, 1); break; }
  writeStore();
  recomputeLocal();
  dlgMask.classList.remove('open');
  closeModal();
  if (!mask.classList.contains('open')) document.body.style.overflow = '';
}
function showToast(msg, isErr) {
  toast.textContent = msg;
  toast.className = 'toast show' + (isErr ? ' err' : '');
  setTimeout(function () { toast.classList.remove('show'); toast.className = 'toast'; }, 2600);
}

/* ---------- 导出 ---------- */
function exportTargets(form) {
  var raw = form.rawOverride && form.rawOverride.trim() ? form.rawOverride : serializeDesignMd(form);
  return [
    { name: 'design-md__' + form.dir + '__STYLE.md', target: 'design-style/design-md/' + form.dir + '/STYLE.md', text: raw },
    { name: 'previews__' + form.dir + '__preview.html', target: 'previews/' + form.dir + '/preview.html', text: buildLocalPreviewHtml(form, 'light') },
    { name: 'previews__' + form.dir + '__preview-dark.html', target: 'previews/' + form.dir + '/preview-dark.html', text: buildLocalPreviewHtml(form, 'dark') }
  ];
}
function packText(files) {
  var out = '把下面的内容按各自的目标路径落盘，然后重跑 node scripts/generate-design-gallery.mjs（不带 --refresh-previews 即零网络）。\\n\\n';
  for (var i = 0; i < files.length; i++) {
    out += '=== FILE: ' + files[i].target + ' ===\\n' + files[i].text + '\\n\\n';
  }
  return out;
}
function openExport(form) {
  exportFiles = exportTargets(form);
  exportIdx = 0;
  dlgMask.classList.add('open');
  document.body.style.overflow = 'hidden';
  showPane('export');
  renderExportTabs();
  renderExportBody();
}
function renderExportTabs() {
  var box = elId('exportTabs');
  var h = '';
  for (var i = 0; i < exportFiles.length; i++) {
    h += '<button class="pv-tab' + (i === exportIdx ? ' active' : '') + '" data-ex="' + i + '">' + hEsc(exportFiles[i].name) + '</button>';
  }
  h += '<button class="pv-tab" data-ex="-1">文件包（全部）</button>';
  box.innerHTML = h;
}
function exportCurrentText() {
  return exportIdx < 0 ? packText(exportFiles) : exportFiles[exportIdx].text;
}
function exportCurrentTarget() {
  return exportIdx < 0 ? ('dsh-pack__' + (exportFiles[0] ? exportFiles[0].name.split('__')[1] : 'brand') + '.md') : exportFiles[exportIdx].target;
}
function renderExportBody() {
  elId('exportPath').textContent = '目标路径：' + exportCurrentTarget();
  elId('exportBody').textContent = exportCurrentText();
}
function downloadText(name, text) {
  try {
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    return true;
  } catch (e) { return false; }
}
function downloadAll() {
  var files = exportFiles.slice(0);
  var i = 0;
  (function next() {
    if (i >= files.length) return;
    if (!downloadText(files[i].name, files[i].text)) {
      showToast('浏览器拦住了自动下载，请改用「复制」后手动保存为 ' + files[i].name, true);
      return;
    }
    i++; setTimeout(next, 350);
  })();
}
function showPane(which) {
  elId('paneForm').style.display = which === 'form' ? '' : 'none';
  elId('paneExport').style.display = which === 'export' ? '' : 'none';
  elId('dlgTitle').textContent = which === 'export' ? '导出草稿文件' : (editingDir ? ('编辑草稿 · ' + editingDir) : '新增品牌');
  elId('dlgPaneFormBtn').className = 'pv-tab' + (which === 'form' ? ' active' : '');
  elId('dlgPaneExportBtn').className = 'pv-tab' + (which === 'export' ? ' active' : '');
}

/* ---------- 卡片渲染 ---------- */
function cardEl(b, i) {
  var light = b.canvasLum > 0.5;
  var hairline = light ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.14)';
  var subText = light ? 'rgba(0,0,0,.45)' : 'rgba(255,255,255,.45)';
  var descText = light ? 'rgba(0,0,0,.62)' : 'rgba(255,255,255,.62)';
  var el = document.createElement('div');
  el.className = 'brand-card';
  if (!BUILT_DIRS[b.dir]) el.className = 'brand-card is-local';
  el.dataset.dir = b.dir;
  el.style.cssText = 'background:' + b.canvas + ';border:1px solid ' + hairline +
    ';border-radius:' + b.roundedMd + ';animation-delay:' + (Math.min(i, 24) * 0.025) + 's';
  var swatches = b.palette.slice(0, 6).map(function (c) {
    return '<span class="bc-sw" style="background:' + c + '" title="' + c + '"></span>';
  }).join('');
  el.innerHTML =
    '<div class="bc-top" style="color:' + b.ink + '">' +
      '<div class="bc-name" style="font-family:' + cssStr(b.fontFamily) + '">' + esc(b.label) +
        (BUILT_DIRS[b.dir] ? '' : '<span class="bc-badge">草稿</span>') + '</div>' +
      '<div class="bc-meta" style="color:' + subText + '">' + b.colorCount + ' 色 · ' + b.typoCount + ' 字级 · ' + b.componentCount + ' 组件</div>' +
    '</div>' +
    '<div class="bc-desc" style="color:' + descText + '">' + esc(b.descShort) + '</div>' +
    '<div class="bc-palette">' + swatches + '</div>' +
    '<div class="bc-actions">' +
      '<span class="bc-btn" style="background:' + b.primary + ';color:' + b.onPrimary + ';border-radius:' + b.roundedPill + '">主按钮</span>' +
      '<span class="bc-btn" style="color:' + b.ink + ';border:1px solid ' + b.primary + ';border-radius:' + b.roundedSm + '">次按钮</span>' +
      '<span class="bc-radius-demo" style="border:2px dashed ' + b.primary + ';border-radius:' + b.roundedMd + ';margin-left:auto"></span>' +
      '<span class="view-hint" style="color:' + b.ink + '">查看详情 →</span>' +
    '</div>';
  el.addEventListener('click', function () { openModal(b.dir); });
  return el;
}

function render() {
  var q = curQuery.toLowerCase();
  var list = DATA.filter(function (b) {
    var okCat = !curCat || b.cat === curCat;
    var okQ = !q || (b.label + ' ' + b.dir + ' ' + b.cat + ' ' + b.description).toLowerCase().indexOf(q) !== -1;
    return okCat && okQ;
  });
  grid.innerHTML = '';
  if (!list.length) {
    grid.innerHTML = '<div class="empty">没有匹配的品牌，换个关键词试试。</div>';
  } else {
    var frag = document.createDocumentFragment();
    list.forEach(function (b, i) { frag.appendChild(cardEl(b, i)); });
    grid.appendChild(frag);
  }
  document.getElementById('stat').textContent = list.length + ' / ' + DATA.length + ' 个品牌';
}

/* ---------- 模态框 ---------- */
function tokenTable(title, obj, mono) {
  var rows = Object.entries(obj || {}).slice(0, 40).map(function (e) {
    var sw = /^#[0-9a-fA-F]{3,8}$/.test(String(e[1])) ? '<span class="tk-sw" style="background:' + e[1] + '"></span>' : '';
    return '<tr><td class="tk-k">' + esc(e[0]) + '</td><td class="tk-v' + (mono ? ' mono' : '') + '">' + esc(e[1]) + '</td><td>' + sw + '</td></tr>';
  }).join('');
  if (!rows) return '';
  return '<h4 class="dd-sub">' + title + '</h4><table class="tk-table">' + rows + '</table>';
}
function list(cls, items) {
  if (!items || !items.length) return '';
  return '<ul class="dd-list ' + cls + '">' + items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>';
}
function openModal(dir) {
  var b = null;
  for (var i = 0; i < DATA.length; i++) if (DATA[i].dir === dir) { b = DATA[i]; break; }
  if (!b) return;
  var isLocal = !BUILT_DIRS[b.dir];
  curLocalForm = isLocal ? formOfDraft(b.dir) : null;
  curLocalPv = null;
  var localActions = isLocal
    ? '<button class="btn ghost" id="editBtn">✎ 编辑草稿</button>' +
      '<button class="btn ghost" id="exportBtn">⤓ 导出文件</button>' +
      '<button class="btn ghost danger" id="delBtn">删除</button>'
    : '<a class="btn ghost" href="design-style/design-md/' + encodeURIComponent(b.dir) + '/STYLE.md" target="_blank">打开源文件</a>' +
      '<button class="btn ghost" id="cloneBtn">以此为模板新增</button>';
  var headHtml =
    '<div class="md-head">' +
      '<div class="md-palette">' + b.palette.map(function (c) {
        return '<span class="bc-sw" style="background:' + c + '" title="' + c + '"></span>';
      }).join('') + '</div>' +
      '<div class="md-actions">' +
        '<button class="btn" id="copyBtn">⧉ 复制 STYLE.md</button>' +
        localActions +
      '</div>' +
    '</div>';
  var pvHtml;
  if (b.pvLight || b.pvLightEn) {
    pvHtml =
      '<div class="dd-title">Preview · 设计预览</div>' +
      '<div class="pv-tabs">' +
        '<button class="pv-tab active" data-lang="zh">中文</button>' +
        (b.pvLightEn ? '<button class="pv-tab" data-lang="en">EN</button>' : '') +
      '</div>' +
      '<iframe id="pvFrame" class="pv-frame" data-zh-light="' + esc(b.pvLight || '') + '"' +
        ' data-zh-dark="' + esc(b.pvDark || '') + '"' +
        ' data-en-light="' + esc(b.pvLightEn || '') + '"' +
        ' data-en-dark="' + esc(b.pvDarkEn || '') + '"' +
        ' data-lang="zh" title="' + esc(b.label) + ' design preview"></iframe>';
  } else if (isLocal && curLocalForm && supportsSrcdoc()) {
    curLocalPv = { light: buildLocalPreviewHtml(curLocalForm, 'light'), dark: buildLocalPreviewHtml(curLocalForm, 'dark') };
    pvHtml =
      '<div class="dd-title">Preview · 设计预览（草稿自动生成的同构预览）</div>' +
      '<iframe id="pvFrame" class="pv-frame" data-local="1" sandbox="" title="' + esc(b.label) + ' draft preview"></iframe>';
  } else {
    pvHtml =
      '<div class="dd-title">Preview · 设计预览</div>' +
      '<div class="pv-empty">本地暂无该品牌的预览资源。</div>';
  }
  document.getElementById('mdBody').innerHTML =
    headHtml +
    pvHtml;
  applyPreviewSrc();
  mask.classList.add('open');
  document.body.style.overflow = 'hidden';
  document.getElementById('copyBtn').addEventListener('click', function () { copyText(b.raw); });
  var cloneBtn = document.getElementById('cloneBtn');
  if (cloneBtn) cloneBtn.addEventListener('click', function () { openDialog(formFromBrand(b), ''); });
  var editBtn = document.getElementById('editBtn');
  if (editBtn) editBtn.addEventListener('click', function () { openDialog(curLocalForm, b.dir); });
  var exportBtn = document.getElementById('exportBtn');
  if (exportBtn) exportBtn.addEventListener('click', function () { openExport(curLocalForm); });
  var delBtn = document.getElementById('delBtn');
  if (delBtn) delBtn.addEventListener('click', function () { editingDir = b.dir; deleteDraft(); });
}
function supportsSrcdoc() { return 'srcdoc' in document.createElement('iframe'); }
function closeModal() { mask.classList.remove('open'); document.body.style.overflow = ''; var f = document.getElementById('pvFrame'); if (f) { f.src = 'about:blank'; f.removeAttribute('srcdoc'); } }

/* Preview 语言切换：深浅色跟随页面主题（事件委托，模态框内容重挂后仍有效） */
function isLightTheme() { return document.documentElement.classList.contains('light'); }
function applyPreviewSrc() {
  var f = document.getElementById('pvFrame');
  if (!f) return;
  if (f.dataset.local) {
    if (curLocalPv) f.srcdoc = curLocalPv[isLightTheme() ? 'light' : 'dark'];
    return;
  }
  var lang = f.dataset.lang === 'en' ? 'en' : 'zh';
  var src = f.dataset[lang + (isLightTheme() ? 'Light' : 'Dark')];
  if (src) f.src = src;
}
document.getElementById('mdBody').addEventListener('click', function (e) {
  var tab = e.target.closest('.pv-tab'); if (!tab || !tab.dataset.lang) return;
  this.querySelectorAll('.pv-tab[data-lang]').forEach(function (t) { t.classList.remove('active'); });
  tab.classList.add('active');
  var f = document.getElementById('pvFrame');
  if (!f) return;
  f.dataset.lang = tab.dataset.lang;
  applyPreviewSrc();
});

function copyText(text) {
  function done() { toast.classList.add('show'); setTimeout(function () { toast.classList.remove('show'); }, 1600); }
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text, done); });
  } else fallbackCopy(text, done);
}
function fallbackCopy(text, done) {
  var ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { alert('复制失败，请手动选择文本复制'); }
  document.body.removeChild(ta);
}

/* ---------- 事件绑定 ---------- */
chipsEl.addEventListener('click', function (e) {
  var chip = e.target.closest('.chip'); if (!chip) return;
  chipsEl.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('active'); });
  chip.classList.add('active');
  curCat = chip.dataset.cat; render();
});
searchEl.addEventListener('input', function () { curQuery = searchEl.value.trim(); render(); });
document.getElementById('modalClose').addEventListener('click', closeModal);
mask.addEventListener('click', function (e) { if (e.target === mask) closeModal(); });
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  if (dlgMask.classList.contains('open')) closeDialog();
  else closeModal();
});

document.getElementById('themeToggle').addEventListener('click', function () {
  document.documentElement.classList.toggle('light');
  this.textContent = document.documentElement.classList.contains('light') ? '🌙' : '☀';
  applyPreviewSrc();
});

/* ---------- 新增品牌：对话框事件 ---------- */
elId('addBrandBtn').addEventListener('click', function () {
  openDialog({
    dir: '', label: '', cat: '', description: '', primary: '#6366f1', canvas: '#ffffff', ink: '#17171c',
    onPrimary: '#ffffff', fontFamily: 'Inter', displaySize: '64px', displayWeight: '600', lineHeight: '1.05',
    roundedSm: '6px', roundedMd: '12px', roundedPill: '999px', colorsText: '', spacingText: 'md: 16px\\nlg: 24px',
    dosText: '', dontsText: '', rawOverride: ''
  }, '');
});
(function () {
  var sel = elId('ab-cat');
  var cats = {};
  BASE_DATA.forEach(function (b) { cats[b.cat] = 1; });
  for (var c in cats) if (Object.prototype.hasOwnProperty.call(cats, c)) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o);
  }
  var o2 = document.createElement('option'); o2.value = '__new__'; o2.textContent = '新建分类…'; sel.appendChild(o2);
})();
elId('ab-form').addEventListener('input', function (e) {
  dlgMask.classList.add('dirty');
  if (e.target.id === 'ab-cat') { elId('ab-catnew').style.display = e.target.value === '__new__' ? '' : 'none'; }
  var f = formFromInputs();
  renderValidation(validateLocalBrand(f, BUILT_DIRS, otherDraftDirs(editingDir)));
});
elId('ab-cancel').addEventListener('click', closeDialog);
elId('ab-save').addEventListener('click', saveDraft);
elId('ab-del').addEventListener('click', deleteDraft);
elId('ab-export').addEventListener('click', function () { openExport(formFromInputs()); });
elId('dlgClose').addEventListener('click', closeDialog);
dlgMask.addEventListener('click', function (e) { if (e.target === dlgMask) closeDialog(); });
elId('formErrors').addEventListener('click', function (e) {
  var li = e.target.closest('li[data-focus]'); if (!li) return;
  var input = elId('ab-' + li.dataset.focus);
  if (input && !input.disabled) input.focus();
  else { var t = elId('err-' + li.dataset.focus); if (t) t.scrollIntoView({ block: 'center' }); }
});
elId('dlgBackForm').addEventListener('click', function () { showPane('form'); });
elId('dlgPaneFormBtn').addEventListener('click', function () { showPane('form'); });
elId('dlgPaneExportBtn').addEventListener('click', function () {
  if (!exportFiles.length) { openExport(formFromInputs()); return; }
  showPane('export'); renderExportTabs(); renderExportBody();
});
elId('exportTabs').addEventListener('click', function (e) {
  var tab = e.target.closest('.pv-tab'); if (!tab) return;
  exportIdx = parseInt(tab.dataset.ex, 10);
  renderExportTabs(); renderExportBody();
});
elId('exCopy').addEventListener('click', function () { copyText(exportCurrentText()); });
elId('exDownload').addEventListener('click', function () {
  if (!downloadText(exportCurrentTarget().split('/').pop(), exportCurrentText())) {
    showToast('浏览器拦住了下载，请用「复制」后手动保存', true);
  }
});
elId('exDownloadAll').addEventListener('click', function () {
  downloadAll();
  showToast('已尝试下载 ' + exportFiles.length + ' 个文件；若被拦截请逐个用「复制」', false);
});

/* 启动时读回上次保存的草稿；坏数据留一份带时间戳的备份键，不把整仓清空 */
(function initLocalDrafts() {
  var raw = readStore();
  var r = loadLocalBrands(raw);
  LOCAL = r.items;
  if (raw && !r.ok) {
    try { localStorage.setItem(STORE_KEY + '.corrupt-' + Date.now(), raw); } catch (e) { /* 备份失败也只影响取证 */ }
  }
})();

recomputeLocal();
<\/script>
</body>
</html>`;
}

main();
