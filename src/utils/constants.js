// ============================================
// 觅露 (Truffle) — 常量定义
// ============================================

const TRUFFLE = {
  name: '觅露',
  englishName: 'Truffle',
  version: '1.4.1',
  primaryColor: '#1F2937', // Slate-900
  primaryColorLight: '#374151', // Slate-700
  accentColor: '#6366F1', // Indigo-500
  bgColor: '#F8FAFC', // Slate-50
  textColor: '#111827', // Gray-900
  textMuted: '#6B7280', // Gray-500
  borderColor: '#E5E7EB', // Gray-200
  dangerColor: '#EF4444', // Red-500
  successColor: '#10B981', // Emerald-500
};

// AI Provider 配置模板
const AI_PROVIDERS = {
  moonshot: {
    id: 'moonshot',
    name: 'Moonshot (Kimi)',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: [
      { id: 'moonshot-v1-8k', name: 'Moonshot v1-8k (轻量)', cost: '低' },
      { id: 'kimi-k2.5', name: 'Kimi K2.5 (通用)', cost: '中' },
    ],
    keyPattern: /^sk-[a-zA-Z0-9]+$/,
  },
  kimiCoding: {
    id: 'kimiCoding',
    name: 'Kimi Coding',
    baseUrl: 'https://api.kimi.com/coding/v1',
    models: [
      { id: 'kimi-k2.6', name: 'Kimi K2.6 (代码/结构化)', cost: '中' },
    ],
    keyPattern: /^sk-kimi-[a-zA-Z0-9]+$/,
  },
  custom: {
    id: 'custom',
    name: '自定义 OpenAI 兼容 API',
    baseUrl: '',
    models: [],
    keyPattern: /.*/,
  },
};

// 提示词模板
const PROMPTS = {
  metadata: `你是一名严谨的情报分类专家。请分析以下截取的文本，以 JSON 格式输出：
{
  "title": "高度凝练的文档标题（不超过15字）",
  "overview": "不超过三句的核心概述预览",
  "tags": ["3-5个极其精准的知识分类标签"],
  "category": "选择一个最合适的分类（科技/商业/设计/人文/学术/生活/其他）"
}
要求：
- 标题必须简洁有力，能在一瞥之间传达核心主题
- 标签使用中文，避免泛泛词汇
- 返回纯 JSON，不要任何解释或 markdown 标记`,

  summary: `请对以下内容进行结构化总结。提取3-5个核心要点，每个要点用一句话概括。
要求：
- 只保留最本质的信息，去除修饰性语言
- 如果原文是论证性文章，保留核心论点和关键论据
- 如果原文是叙事性文章，保留关键事件和转折点
- 用中文输出`,

  expansion: `基于以下内容，从知识图谱的角度提供扩展阅读建议：
要求：
- 推荐3个相关的深入阅读方向或关键概念
- 每个方向附带一句说明，解释它与原文的关联
- 如果有相关的经典著作、重要论文或权威来源，请一并提及
- 用中文输出`,

  critique: `请扮演一位刻薄且逻辑极其严密的学术辩难者。不要顺从原作者的观点。
仔细审视以下文本，全力寻找其逻辑谬误、幸存者偏差、未经证实的假设条件以及潜在的信息茧房效应。
列出至少三条极具攻击性与颠覆性的反对性意见。
要求：
- 每条意见都必须有具体的文本依据，不能泛泛而谈
- 指出作者可能遗漏的反例或对立面证据
- 分析作者的利益立场和潜在偏见来源
- 用中文输出`,

  titleOnly: `为以下内容生成一个极其简洁有力的标题（10字以内），要求：
- 能在一瞥之间传达核心主题
- 不使用无意义的修饰词
- 直接返回标题文本，不要任何解释`,
};

// Markdown 模板
const MARKDOWN_TEMPLATE = `---
title: "{{title}}"
date: "{{date}}"
source: "{{sourceUrl}}"
source_title: "{{sourceTitle}}"
author: "{{author}}"
tags: [{{tags}}]
category: "{{category}}"
ai_summary: "{{aiSummary}}"
ai_critique: "{{aiCritique}}"
ai_expansion: "{{aiExpansion}}"
---

# {{title}}

## 摘录内容

> {{excerpt}}

## 个人思考

{{thoughts}}

{{aiSection}}

---
*保存时间：{{saveTime}}*
*插件版本：觅露 (Truffle) v{{version}}*
`;

const AI_SECTION_TEMPLATE = `
## AI 扩展视角

### 内容总结

{{summary}}

### 扩展阅读

{{expansion}}

### 批判性思考

{{critique}}
`;

// 激活码配置
const ACTIVATION_CONFIG = {
  // 简单校验和算法：code.split('').reduce((a,c)=>a+c.charCodeAt(0),0) % 1000 === checksum
  salt: 'truffle-2026',
};

// 导出（如果是模块环境）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TRUFFLE, AI_PROVIDERS, PROMPTS, MARKDOWN_TEMPLATE, AI_SECTION_TEMPLATE, ACTIVATION_CONFIG };
}
