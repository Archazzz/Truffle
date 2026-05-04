// ============================================
// 觅露 (Truffle) — Markdown 生成引擎
// HTML → Markdown 转换 + 模板渲染
// ============================================

const MarkdownEngine = {
  // 将HTML转换为Markdown
  htmlToMarkdown(html) {
    if (!html) return '';

    let md = html;

    // 块级元素
    md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n# $1\n');
    md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n');
    md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n### $1\n');
    md = md.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '\n#### $1\n');
    md = md.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '\n##### $1\n');
    md = md.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '\n###### $1\n');

    md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, '\n$1\n');
    md = md.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gi, (match, content) => {
      return '\n> ' + content.replace(/<p[^>]*>/gi, '').replace(/<\/p>/gi, '\n> ').trim() + '\n';
    });

    md = md.replace(/<br\s*\/?>/gi, '\n');
    md = md.replace(/<hr\s*\/?>/gi, '\n---\n');

    // 列表
    md = md.replace(/<ul[^>]*>(.*?)<\/ul>/gis, (match, content) => {
      return '\n' + content.replace(/<li[^>]*>(.*?)<\/li>/gi, '\n- $1') + '\n';
    });
    md = md.replace(/<ol[^>]*>(.*?)<\/ol>/gis, (match, content) => {
      let i = 1;
      return '\n' + content.replace(/<li[^>]*>(.*?)<\/li>/gi, () => `\n${i++}. $1`) + '\n';
    });

    // 行内元素
    md = md.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
    md = md.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
    md = md.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
    md = md.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');
    md = md.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');

    // 链接
    md = md.replace(/<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');

    // 图片
    md = md.replace(/<img[^>]+src="([^"]+)"[^>]*alt="([^"]*)"[^>]*>/gi, '![$2]($1)');
    md = md.replace(/<img[^>]+alt="([^"]*)"[^>]*src="([^"]+)"[^>]*>/gi, '![$1]($2)');
    md = md.replace(/<img[^>]+src="([^"]+)"[^>]*>/gi, '![]($1)');

    // 预格式化代码块
    md = md.replace(/<pre[^>]*>(.*?)<\/pre>/gis, (match, content) => {
      const code = content.replace(/<code[^>]*>/gi, '').replace(/<\/code>/gi, '');
      return '\n```\n' + code.trim() + '\n```\n';
    });

    // 表格（简化处理）
    md = md.replace(/<table[^>]*>(.*?)<\/table>/gis, (match, content) => {
      let tableMd = '\n';
      const rows = content.match(/<tr[^>]*>(.*?)<\/tr>/gis) || [];
      rows.forEach((row, idx) => {
        const cells = row.match(/<t[dh][^>]*>(.*?)<\/t[dh]>/gi) || [];
        const cellTexts = cells.map(c => c.replace(/<[^>]+>/g, '').trim());
        tableMd += '| ' + cellTexts.join(' | ') + ' |\n';
        if (idx === 0) {
          tableMd += '|' + cellTexts.map(() => ' --- ').join('|') + '|\n';
        }
      });
      return tableMd;
    });

    // 清理剩余标签
    md = md.replace(/<[^>]+>/g, '');

    // 清理空白
    md = md.replace(/\n\s*\n\s*\n/g, '\n\n');
    md = md.replace(/^\s+|\s+$/g, '');

    // HTML实体解码
    md = md.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
           .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');

    return md.trim();
  },

  // 生成YAML frontmatter
  generateFrontmatter(data) {
    const fields = [];

    if (data.title) fields.push(`title: "${this._escapeYaml(data.title)}"`);
    if (data.date) fields.push(`date: "${data.date}"`);
    if (data.sourceUrl) fields.push(`source: "${data.sourceUrl}"`);
    if (data.sourceTitle) fields.push(`source_title: "${this._escapeYaml(data.sourceTitle)}"`);
    if (data.author) fields.push(`author: "${this._escapeYaml(data.author)}"`);
    if (data.tags && data.tags.length > 0) {
      const tagStr = data.tags.map(t => `"${t}"`).join(', ');
      fields.push(`tags: [${tagStr}]`);
    }
    if (data.category) fields.push(`category: "${data.category}"`);
    if (data.estimatedTokens) fields.push(`estimated_tokens: ${data.estimatedTokens}`);
    if (data.aiSummary) fields.push(`ai_summary: "${this._escapeYaml(data.aiSummary)}"`);
    if (data.aiCritique) fields.push(`ai_critique: "${this._escapeYaml(data.aiCritique)}"`);
    if (data.aiExpansion) fields.push(`ai_expansion: "${this._escapeYaml(data.aiExpansion)}"`);

    return '---\n' + fields.join('\n') + '\n---';
  },

  // 生成完整Markdown文档
  generateDocument(data) {
    const frontmatter = this.generateFrontmatter(data);

    let body = '';

    // 标题
    if (data.title) {
      body += `\n# ${data.title}\n`;
    }

    // 摘录内容
    if (data.excerpt) {
      body += `\n## 摘录内容\n\n> ${data.excerpt.replace(/\n/g, '\n> ')}\n`;
    }

    // 个人思考
    if (data.thoughts) {
      body += `\n## 个人思考\n\n${data.thoughts}\n`;
    }

    // AI扩展（如果有）
    if (data.aiSummary || data.aiExpansion || data.aiCritique) {
      body += '\n## AI 扩展视角\n';

      if (data.aiSummary) {
        body += `\n### 内容总结\n\n${data.aiSummary}\n`;
      }
      if (data.aiExpansion) {
        body += `\n### 扩展阅读\n\n${data.aiExpansion}\n`;
      }
      if (data.aiCritique) {
        body += `\n### 批判性思考\n\n${data.aiCritique}\n`;
      }
    }

    // 完整原文（可选）
    if (data.fullContent) {
      body += `\n## 完整原文\n\n${data.fullContent}\n`;
    }

    // 页脚
    body += `\n---\n*保存时间：${data.saveTime || data.date}*\n`;
    body += `*插件版本：觅露 (Truffle) v${data.version || '1.0.0'}*\n`;

    return frontmatter + body;
  },

  // 生成文件名称
  generateFilename(title, date = new Date()) {
    const dateStr = date.toISOString().split('T')[0];
    const slug = this._slugify(title || 'untitled').substring(0, 50);
    return `${dateStr}-${slug}.md`;
  },

  // 辅助：YAML字符串转义
  _escapeYaml(str) {
    if (!str) return '';
    return str.replace(/"/g, '\"').replace(/\n/g, ' ').replace(/\r/g, '');
  },

  // 辅助：生成slug
  _slugify(str) {
    if (!str) return 'untitled';
    return str
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5\s-]+/g, '') // 保留中文、英文、数字
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MarkdownEngine };
}
