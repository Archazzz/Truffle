// ============================================
// 觅露 (Truffle) — 轻量内容提取引擎
// 基于 Readability.js 核心思想实现的简化版
// ============================================

const ReadabilityLite = {
  // 提取页面主要内容
  extract(document) {
    const clone = document.cloneNode(true);
    this._cleanStyles(clone);
    this._removeJunk(clone);

    // 尝试找到主要内容区域
    const candidates = this._getCandidates(clone);
    const bestCandidate = this._selectBestCandidate(candidates);

    if (!bestCandidate) {
      return {
        title: document.title,
        content: document.body.innerText.trim().substring(0, 10000),
        textContent: document.body.innerText.trim(),
        excerpt: document.body.innerText.trim().substring(0, 300),
        byline: '',
        dir: 'ltr',
        length: document.body.innerText.length,
        siteName: this._getSiteName(document),
      };
    }

    const content = this._extractContent(bestCandidate);
    const textContent = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    return {
      title: this._getTitle(document),
      content: content,
      textContent: textContent,
      excerpt: textContent.substring(0, 300),
      byline: this._getByline(document),
      dir: 'ltr',
      length: textContent.length,
      siteName: this._getSiteName(document),
    };
  },

  // 清理样式
  _cleanStyles(node) {
    if (!node) return;
    const elements = node.querySelectorAll('*');
    elements.forEach(el => {
      el.removeAttribute('style');
      el.removeAttribute('class');
      el.removeAttribute('id');
      el.removeAttribute('width');
      el.removeAttribute('height');
    });
  },

  // 移除垃圾元素
  _removeJunk(node) {
    const junkTags = ['script', 'style', 'nav', 'header', 'footer', 'aside', 
                      'form', 'iframe', 'noscript', 'ad', 'canvas', 'svg',
                      'button', 'input', 'select', 'textarea'];
    const junkClasses = ['advertisement', 'ad-', 'ads-', 'social-', 'share-',
                         'comment', 'disqus', 'related', 'sidebar', 'popup',
                         'modal', 'overlay', 'newsletter', 'subscribe'];

    junkTags.forEach(tag => {
      node.querySelectorAll(tag).forEach(el => el.remove());
    });

    // 移除包含垃圾class的元素
    node.querySelectorAll('*').forEach(el => {
      const className = (el.getAttribute('class') || '').toLowerCase();
      const idName = (el.getAttribute('id') || '').toLowerCase();
      for (const junk of junkClasses) {
        if (className.includes(junk) || idName.includes(junk)) {
          el.remove();
          break;
        }
      }
    });
  },

  // 获取候选容器
  _getCandidates(doc) {
    const candidates = [];
    const divs = doc.querySelectorAll('div, article, section, main');

    divs.forEach(div => {
      const text = div.innerText || '';
      const linkDensity = this._getLinkDensity(div);
      const score = text.length * (1 - linkDensity);

      // 根据标签名加分
      const tagName = div.tagName.toLowerCase();
      if (tagName === 'article') score *= 2;
      if (tagName === 'main') score *= 1.5;

      // 根据class/id加分
      const marker = (div.className + ' ' + div.id).toLowerCase();
      if (marker.includes('content')) score *= 1.3;
      if (marker.includes('article')) score *= 1.5;
      if (marker.includes('post')) score *= 1.3;
      if (marker.includes('entry')) score *= 1.2;

      candidates.push({ element: div, score });
    });

    // 同时考虑p标签密集区域
    const paragraphs = doc.querySelectorAll('p');
    if (paragraphs.length > 3) {
      const parent = paragraphs[0].parentElement;
      if (parent) {
        const text = parent.innerText || '';
        const linkDensity = this._getLinkDensity(parent);
        candidates.push({
          element: parent,
          score: text.length * (1 - linkDensity) * 0.8,
        });
      }
    }

    return candidates.sort((a, b) => b.score - a.score);
  },

  // 选择最佳候选
  _selectBestCandidate(candidates) {
    if (candidates.length === 0) return null;

    const best = candidates[0];
    if (best.score < 100) return null; // 内容太少，可能不是正文
    return best.element;
  },

  // 计算链接密度
  _getLinkDensity(element) {
    const text = element.innerText || '';
    const links = element.querySelectorAll('a');
    let linkText = 0;
    links.forEach(a => {
      linkText += (a.innerText || '').length;
    });
    return text.length > 0 ? linkText / text.length : 0;
  },

  // 提取HTML内容
  _extractContent(element) {
    // 保留语义标签
    const allowedTags = ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                         'blockquote', 'ul', 'ol', 'li', 'strong', 'em',
                         'a', 'img', 'code', 'pre', 'table', 'tr', 'td', 'th'];

    let html = '';
    const children = element.children;

    for (const child of children) {
      const tag = child.tagName.toLowerCase();
      if (allowedTags.includes(tag)) {
        html += child.outerHTML;
      }
    }

    return html || element.innerHTML;
  },

  // 获取标题
  _getTitle(doc) {
    // 优先og:title
    const ogTitle = doc.querySelector('meta[property="og:title"]');
    if (ogTitle) return ogTitle.getAttribute('content') || '';

    // 其次article标题
    const h1 = doc.querySelector('h1');
    if (h1) return h1.innerText.trim();

    return doc.title || '';
  },

  // 获取作者
  _getByline(doc) {
    const authorMeta = doc.querySelector('meta[name="author"], meta[property="article:author"]');
    if (authorMeta) return authorMeta.getAttribute('content') || '';

    // 尝试从常见class/id中提取
    const authorEl = doc.querySelector('.author, [class*="author"], [class*="byline"]');
    if (authorEl) return authorEl.innerText.trim();

    return '';
  },

  // 获取站点名称
  _getSiteName(doc) {
    const ogSite = doc.querySelector('meta[property="og:site_name"]');
    if (ogSite) return ogSite.getAttribute('content') || '';

    try {
      return new URL(doc.location?.href || '').hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ReadabilityLite };
}
