# DesignStyleHub · 设计图鉴

> 84 个知名品牌网站的设计系统速查画廊 —— 把 `STYLE.md` 丢给 AI 编程助手，即可生成风格一致的 UI。

**English**: A curated gallery of 84 `STYLE.md` design-system documents extracted from real-world websites (Claude, Apple, Stripe, Linear, Tesla, ...), with light/dark visual previews in both English and Chinese, and a self-contained, offline-friendly gallery page (`design-style-hub.html`) for browsing, searching, and copying any design system.

---

## 项目简介

[STYLE.md](https://stitch.withgoogle.com/docs/design-md/overview/) 是 Google Stitch 提出的一种约定：用一个纯 Markdown 文件描述项目的设计系统（色彩、字体、组件、布局、响应式规则等），供 AI 编程代理读取，从而生成视觉一致的界面。Markdown 正是 LLM 最擅长解析的格式——无需 Figma 导出、无需 JSON Schema、无需额外工具链。

- **本地可视化画廊**：`design-style-hub.html`，单文件、零依赖、离线可用，支持搜索 / 分类筛选 / 明暗主题 / iframe 内嵌预览 / 一键复制 STYLE.md。
- **中英双语预览**：每个品牌提供 Light/Dark × 中文/英文 四种预览页面（`previews/<品牌>/`）。
- **汉化工具链**：内置术语词典与校验脚本，可持续翻译新增品牌。

## 目录结构

```
design-style-hub/
├── design-style-hub.html        # 生成的自包含画廊页（中文界面）
├── design-style/                # 仓库
│   └── design-md/<品牌>/        # 84 个品牌，每个包含：
│       ├── STYLE.md            # 设计系统文档（YAML tokens + 设计规则）
│       └── README.md            # 来源链接说明
├── previews/<品牌>/             # 每个品牌 4 份预览：
│   ├── preview.html             # 英文 · Light
│   ├── preview-dark.html        # 英文 · Dark
│   ├── preview.zh.html          # 中文 · Light
│   └── preview-dark.zh.html     # 中文 · Dark
└── scripts/
    ├── generate-design-gallery.mjs   # 解析 STYLE.md，生成画廊页
    ├── verify-zh.mjs                 # 校验中文预览页的翻译完整性
    ├── headings-zh.json              # 汉化术语词典（含 extra/2/3 增补）
    └── remaining-words.txt           # 待翻译词频统计
```

另有行为规格与特征测试（重构或改动生成脚本前先读）：

```
design-style-hub/
├── spec.md                    # 当前行为规格（含「新增品牌」§11 与变更 §10）
└── tests/                     # node --test tests/ 全绿
    ├── 01-isolation ~ 06-add-brand
    ├── helpers/harness.mjs    # 临时工作区 + 插桩副本 + 纯函数接缝
    └── __golden__/            # 字节级母本（make-golden.mjs 再生）
```

## 每份 STYLE.md 包含什么

每份文档遵循 [Stitch STYLE.md 规范](https://stitch.withgoogle.com/docs/design-md/specification/) 并做了扩展：

| # | 章节 | 内容 |
|---|------|------|
| 1 | 视觉主题与氛围 | 情绪、信息密度、设计哲学 |
| 2 | 色彩体系与角色 | 语义命名 + HEX + 功能角色 |
| 3 | 字体排印规则 | 字体族、完整字号层级表 |
| 4 | 组件样式 | 按钮 / 卡片 / 输入框 / 导航及其状态 |
| 5 | 布局原则 | 间距标尺、栅格、留白哲学 |
| 6 | 深度与层级 | 阴影体系、表面层级 |
| 7 | Do / Don't | 设计护栏与反模式 |
| 8 | 响应式行为 | 断点、触控目标、折叠策略 |
| 9 | Agent 提示指南 | 速查色表、开箱即用的提示词 |

## 快速开始

### 1. 直接使用（推荐）

用浏览器打开 `design-style-hub.html` 即可——搜索品牌、筛选分类、切换明暗主题，在详情弹层中查看设计规范与实时预览，并一键复制整份 STYLE.md。

### 2. 把 STYLE.md 用在 AI 编程中

```bash
# 复制任一品牌的文档到项目根目录
cp design-style/design-md/stripe/STYLE.md ./STYLE.md
```

然后对任意 AI 编程代理（Claude Code、Cursor、GitHub Copilot 等）说：

> 请参考项目根目录的 `STYLE.md`，为我生成一个定价页，保持视觉风格一致。

`AGENTS.md` 告诉代理"如何构建项目"，`STYLE.md` 告诉代理"项目应该长什么样"。

### 3. 在画廊里新增品牌

打开 `design-style-hub.html`，点右上角「＋ 新增品牌」：

- 从零填写（目录名、显示名、分类、描述、四个核心色值、字体、圆角、色板、间距、Do/Don't），或点开任一品牌详情里的「以此为模板新增」。
- 草稿保存在本机浏览器里（`localStorage`），刷新后仍在；卡片带虚线描边与「草稿」徽标，详情里的预览页由表单自动生成。
- 要让草稿变成正式资产：用详情或对话框里的「导出」拿到 `STYLE.md` 与两份 `preview.html`，
  放进 `design-style/design-md/<目录名>/` 与 `previews/<目录名>/`，再重跑下面的生成脚本。
- 注意：以 `file://` 打开时 Safari 禁止页面写存储，此时草稿只在当前这次打开有效，请随手导出。

### 4. 本地重新生成画廊页

需要 Node.js 18+（无第三方依赖）：

```bash
# 重新解析 design-style/design-md/ 并生成 design-style-hub.html
node scripts/generate-design-gallery.mjs

# 同时重新从 getdesign.md 拉取品牌预览到 previews/
node scripts/generate-design-gallery.mjs --refresh-previews

# 校验中文预览页的翻译质量（h1、hero 文案等）
node scripts/verify-zh.mjs
```

## 收录品牌（84 个）

| 分类 | 品牌 |
|------|------|
| AI 与 LLM 平台 | Claude · Cohere · ElevenLabs · Jobright · MiniMax · Mistral AI · Ollama · OpenCode AI · Replicate · Runway · Together AI · VoltAgent · xAI |
| 开发者工具与 IDE | Cursor · Expo · Lovable · Raycast · Superhuman · Vercel · Warp |
| 后端 / 数据库 / DevOps | ClickHouse · Composio · HashiCorp · MongoDB · Oracle · PostHog · Sanity · Sentry · Supabase |
| 生产力与 SaaS | Cal.com · Intercom · Linear · Mintlify · Notion · Resend · SAP · Slack · Zapier |
| 设计与创意工具 | Airtable · Clay · Figma · Framer · Miro · Webflow |
| 金融科技与加密货币 | Binance · Coinbase · Kraken · Mastercard · Mercury · NerdWallet · Revolut · Stripe · Wise |
| 电商与零售 | Airbnb · Meta · mydealz · Nike · Shopify · Starbucks |
| 媒体与消费科技 | 1win · Al Jazeera · Apple · DJI · HP · IBM · NVIDIA · Oura · Pinterest · PlayStation · SpaceX · Spotify · The Verge · Uber · Vodafone · WIRED |
| 汽车 | BMW · BMW M · Bugatti · Ferrari · Lamborghini · Renault · Tesla |
| 复古网页 | Dell (1996) · Nintendo (2001) |

## 脚本说明

| 脚本 | 用途 |
|------|------|
| `generate-design-gallery.mjs` | 极简 YAML 解析器读取各品牌 `STYLE.md` 的 front-matter（色彩、字体 tokens），结合顶层 README 的分类映射，输出单文件画廊页；`--refresh-previews` 可重新抓取预览资源 |
| `verify-zh.mjs` | 批量检查 `previews/*/preview*.zh.html`：导航残留、`<h1>` 是否含"设计分析"、hero 描述是否已完成中文化，输出 JSON 报告 |
| `headings-zh*.json` | 英文→中文短语词典，供翻译流程复用，保证 84 个品牌术语一致（如 Feature Card → 功能卡片、Touch Targets → 触控目标） |
| `remaining-words.txt` | 翻译收尾用的唯一词频清单（1385 词） |

## 适用场景

- **AI 生成 UI**：给 Claude / Cursor / v0 等注入某品牌风格，产出高一致性界面
- **设计研究**：横向对比 84 个真实产品的色彩体系、字号层级、组件规范
- **原型起步**：挑选与产品气质相符的风格文档，作为新项目设计基线

## License

MIT
