// 觅露 (Truffle) v1.4.1 — AI API 客户端
// 支持多Provider：Moonshot / Kimi Coding / 自定义
// ============================================

const AIClient = {
  // 当前配置
  config: {
    provider: 'moonshot',
    apiKey: '',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
  },

  // 设置配置
  setConfig(cfg) {
    this.config = { ...this.config, ...cfg };
  },

  // ============================================
  // 流式聊天完成（循环内超时 + maxChunks 硬限制）
  // 不用 setTimeout 做读取超时（Chrome MV3 SW 会冻结 setTimeout）
  // ============================================
  async *chatCompletion(messages, options = {}) {
    const { provider, apiKey, baseUrl, model } = this.config;

    if (!apiKey) {
      throw new Error('API Key 未配置，请在设置中添加');
    }

    const url = `${baseUrl}/chat/completions`;
    const body = {
      model: options.model || model,
      messages,
      temperature: 1,
      stream: true,
      max_tokens: options.maxTokens || 4000,
    };

    // 时间限制：循环内检查 Date.now()，不依赖 setTimeout
    const startTime = Date.now();
    const maxTotalMs = options.maxTotalTime || 120000; // 默认120秒总时间（推理模型需要更多时间）
    const maxChunks = options.maxChunks || 10000;      // 最多接收10000个chunk（推理过程chunk很多）

    // fetch 阶段用 AbortController（响应头通常很快，15秒足够）
    const controller = new AbortController();
    const connectTimer = setTimeout(() => controller.abort(), 15000);

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'User-Agent': 'claude-code/1.0.0',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(connectTimer);
    } catch (err) {
      clearTimeout(connectTimer);
      if (err.name === 'AbortError') {
        throw new Error('AI连接超时（15秒），请检查网络');
      }
      throw err;
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API请求失败 (${response.status}): ${error}`);
    }

    // 读取阶段：循环内时间检查，不依赖 setTimeout
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let chunkCount = 0;

    while (true) {
      // 总时间硬限制：无论如何都会在 maxTotalMs 后停止
      if (Date.now() - startTime > maxTotalMs) {
        console.warn(`[Truffle AI] 总时间达到${maxTotalMs}ms，强制结束流`);
        break;
      }

      let done, value;
      try {
        ({ done, value } = await reader.read());
      } catch (readErr) {
        console.warn('[Truffle AI] reader.read() 异常:', readErr.message);
        break;
      }

      if (done) break;

      chunkCount++;
      if (chunkCount > maxChunks) {
        console.warn(`[Truffle AI] chunk数量达到${maxChunks}，强制结束流`);
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;

        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          const content = delta?.content || '';
          if (content) yield content;
        } catch (e) {
          // 忽略解析错误，继续
        }
      }
    }
  },

  // ============================================
  // 非流式请求（收集所有chunk后返回完整文本）
  // ============================================
  async chat(messages, options = {}) {
    const chunks = [];
    for await (const chunk of this.chatCompletion(messages, options)) {
      chunks.push(chunk);
    }
    return chunks.join('').trim();
  },

  // ============================================
  // 生成元数据（标题、标签、分类、概述）
  // ============================================
  async generateMetadata(text, prompt, options = {}) {
    const messages = [
      { role: 'system', content: '你是一个严谨的情报分类专家。' },
      { role: 'user', content: `${prompt}\n\n文本内容：\n${text.substring(0, 3000)}` },
    ];

    try {
      const result = await this.chat(messages, {
        model: options.model || this.config.model,
        maxTokens: options.maxTokens || 500,
        maxTotalTime: options.maxTotalTime || 15000,
      });

      try {
        const json = JSON.parse(result);
        return {
          title: json.title || '',
          overview: json.overview || '',
          tags: Array.isArray(json.tags) ? json.tags : [],
          category: json.category || '其他',
        };
      } catch {
        return this._parseMetadataFallback(result);
      }
    } catch (error) {
      console.error('[Truffle AI] generateMetadata error:', error);
      return { title: '', overview: '', tags: [], category: '其他' };
    }
  },

  // ============================================
  // 总结
  // ============================================
  async summarize(text, options = {}) {
    const messages = [
      { role: 'system', content: `请对以下内容进行结构化总结，提取3-5个核心要点。最终的返回结果里只有要点总结，不要有其他内容。\n\n${text}` },
    ];
    return await this.chat(messages, {
      maxTokens: options.maxTokens || 2000,
      model: options.model,
      maxTotalTime: options.maxTotalTime || 120000,
    });
  },

  // ============================================
  // 扩展阅读
  // ============================================
  async expand(text, options = {}) {
    const messages = [
      { role: 'system', content: `请对以下内容进行扩展阅读推荐，给出3个相关的深入阅读方向或关键概念，每个方向用一句话说明。最终的返回结果里只有扩展内容方向和相关说明，不要有其他内容。\n\n${text}` },
    ];
    return await this.chat(messages, {
      maxTokens: options.maxTokens || 2000,
      model: options.model,
      maxTotalTime: options.maxTotalTime || 120000,
    });
  },

  // ============================================
  // 批判性思考
  // ============================================
  async critique(text, options = {}) {
    const messages = [
      { role: 'system', content: `请审视以下文本，找出3个关键问题（逻辑漏洞、未证实的假设、认知偏差等）。每条用一句话指出问题所在，然后附一句简要说明。最终的返回结果里只有问题和说明，不要有其他内容。\n\n${text}` },
    ];
    return await this.chat(messages, {
      maxTokens: options.maxTokens || 2000,
      model: options.model,
      maxTotalTime: options.maxTotalTime || 120000,
    });
  },

  // ============================================
  // 翻译（永远翻译成中文）
  // ============================================
  async translate(text, options = {}) {
    const messages = [
      { role: 'system', content: `请把以下内容翻译成中文。最终的返回结果里只有翻译后的文本，不要有其他内容。\n\n${text}` },
    ];
    return await this.chat(messages, {
      maxTokens: options.maxTokens || 8000,
      model: options.model,
      maxTotalTime: options.maxTotalTime || 120000,
    });
  },

  // ============================================
  // 元数据解析降级方案
  // ============================================
  _parseMetadataFallback(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    const result = { title: '', overview: '', tags: [], category: '其他' };

    for (const line of lines) {
      if (line.toLowerCase().includes('标题') || line.startsWith('title:')) {
        result.title = line.split(/[:：]/).pop().trim().replace(/^["']|["']$/g, '');
      } else if (line.toLowerCase().includes('概述') || line.toLowerCase().includes('overview')) {
        result.overview = line.split(/[:：]/).pop().trim();
      } else if (line.toLowerCase().includes('标签') || line.toLowerCase().includes('tags')) {
        const tagPart = line.split(/[:：]/).pop().trim();
        result.tags = tagPart.split(/[,，\s]+/).filter(t => t);
      } else if (line.toLowerCase().includes('分类') || line.toLowerCase().includes('category')) {
        result.category = line.split(/[:：]/).pop().trim();
      }
    }

    return result;
  },

  // ============================================
  // 验证API Key是否有效（轻量测试）
  // ============================================
  async validateApiKey() {
    try {
      const messages = [{ role: 'user', content: 'Hi' }];
      await this.chat(messages, { maxTokens: 500, maxTotalTime: 15000 });
      return { valid: true };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AIClient };
}
