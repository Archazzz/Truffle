// ============================================
// 觅露 (Truffle) — Side Panel 逻辑
// 编辑面板 + AI调用 + 保存逻辑
// ============================================

(function() {
  'use strict';

  // 当前数据
  let currentData = {
    mode: 'hunter', // hunter | archaeologist
    text: '',
    url: '',
    title: '',
    author: '',
    siteName: '',
    excerpt: '',
    aiResults: {},
  };

  let config = {};
  let isAIProcessing = false;
  let customCategories = [];

  // DOM 引用
  const $ = (id) => document.getElementById(id);

  // 初始化
  async function init() {
    // 先检查扩展上下文是否有效
    try {
      chrome.runtime.id; // 如果扩展已重新加载，这里会抛异常
    } catch (e) {
      document.body.innerHTML = '<div style="padding:40px;text-align:center;color:#6B7280;font-family:sans-serif;"><h2 style="color:#1F2937;">觅露已更新</h2><p>扩展已重新加载，请关闭此面板并重新标记。</p></div>';
      return;
    }

    // 加载配置
    try {
      config = await Storage.getConfig();

      // 同步 AIClient 配置（关键修复）
      const provider = config.apiProvider;
      const isKimiCoding = provider === 'kimiCoding';
      const apiKey = isKimiCoding ? config.kimiCodingKey : config.apiKey;
      const baseUrl = isKimiCoding
        ? 'https://api.kimi.com/coding/v1'
        : (config.baseUrl || 'https://api.moonshot.cn/v1');
      const model = isKimiCoding
        ? (config.kimiCodingModel || 'kimi-k2.6')
        : (config.apiModel || 'moonshot-v1-8k');

      if (apiKey) {
        AIClient.setConfig({ apiKey, baseUrl, model });
        console.log('[Truffle SidePanel] AI configured, provider:', provider);
      } else {
        console.log('[Truffle SidePanel] No API Key set');
      }
    } catch (e) {
      console.error('[Truffle SidePanel] config load failed:', e);
    }

    // 加载自定义分类
    try {
      customCategories = await Storage.get('customCategories', []);
      populateCategorySelect();
    } catch (e) {
      customCategories = [];
    }

    // 请求当前待处理的数据
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getPendingClip' });
      if (response && response.data) {
        loadData(response.data);
      }
    } catch (err) {
      if (err.message && err.message.includes('Extension context invalidated')) {
        document.body.innerHTML = '<div style="padding:40px;text-align:center;color:#6B7280;font-family:sans-serif;"><h2 style="color:#1F2937;">觅露已更新</h2><p>扩展已重新加载，请关闭此面板并重新标记。</p></div>';
        return;
      }
      // Side Panel可能被独立打开 — 正常情况
    }

    // 绑定事件
    bindEvents();

    // 更新保存路径显示
    try {
      await updateSavePathDisplay();
    } catch (e) { /* 非关键 */ }
  }

  function loadData(data) {
    currentData = { ...currentData, ...data };

    // 更新UI
    $('mode-badge').textContent = data.mode === 'hunter' ? '猎人模式' : '考古模式';
    $('source-url').textContent = data.url || '';
    $('source-url').title = data.url || '';
    $('source-date').textContent = new Date().toLocaleString('zh-CN');
    $('excerpt-preview').textContent = data.text || '';

    // 设置默认标题
    if (data.title) {
      $('title-input').value = data.title;
    }

    // 自动触发AI元数据生成（如果开启）
    if (config.aiEnabled && config.autoGenerateTitle && data.text) {
      setTimeout(() => generateMetadata(), 300);
    }
  }

  function bindEvents() {
    // AI生成标题
    $('ai-title-btn').addEventListener('click', () => {
      if (!currentData.text) return;
      generateSingle('title', currentData.text, (result) => {
        $('title-input').value = result;
      });
    });

    // AI生成标签
    $('ai-tags-btn').addEventListener('click', () => {
      if (!currentData.text) return;
      generateSingle('tags', currentData.text, (result) => {
        const tags = Array.isArray(result) ? result : result.split(/[,，\s]+/).filter(t => t);
        $('tags-input').value = tags.join(', ');
      });
    });

    // AI功能按钮
    document.querySelectorAll('.truffle-ai-action').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        await handleAIAction(action);
      });
    });

    // AI开关
    $('ai-enabled').addEventListener('change', (e) => {
      const enabled = e.target.checked;
      $('ai-buttons').style.opacity = enabled ? '1' : '0.5';
      $('ai-buttons').style.pointerEvents = enabled ? 'auto' : 'none';
    });

    // AI输出关闭
    $('ai-close-btn').addEventListener('click', () => {
      $('ai-output').style.display = 'none';
    });

    // 预览开关
    $('preview-toggle').addEventListener('click', () => {
      const preview = $('markdown-preview');
      const isHidden = preview.style.display === 'none';
      preview.style.display = isHidden ? 'block' : 'none';
      $('preview-toggle').textContent = isHidden ? '收起' : '展开';
      if (isHidden) updatePreview();
    });

    // 更改路径
    $('change-path-btn').addEventListener('click', async () => {
      await selectSaveDirectory();
    });

    // 自定义分类添加
    const customCatInput = $('custom-category-input');
    const addCatBtn = $('add-category-btn');
    if (addCatBtn && customCatInput) {
      addCatBtn.addEventListener('click', async () => {
        const val = customCatInput.value.trim();
        if (!val) return;
        const preset = ['科技','商业','设计','人文','学术','生活','其他'];
        if (preset.includes(val) || customCategories.includes(val)) {
          alert('该分类已存在');
          return;
        }
        customCategories.push(val);
        await Storage.set('customCategories', customCategories);
        populateCategorySelect();
        $('category-select').value = val;
        customCatInput.value = '';
        showToast('分类已添加');
      });
    }

    // 取消
    $('cancel-btn').addEventListener('click', () => {
      // 关闭 Side Panel 或清空表单
      window.close();
    });

    // 保存
    $('save-btn').addEventListener('click', saveDocument);

    // 表单变化时更新预览
    ['title-input', 'tags-input', 'category-select', 'thoughts-input'].forEach(id => {
      $(id).addEventListener('input', debounce(updatePreview, 300));
    });
  }

  // 加载自定义分类到 select
  function populateCategorySelect() {
    const select = $('category-select');
    if (!select) return;
    // 保留前两个（空选项 + 预置选项）... 实际上我们需要重新构建
    const preset = ['', '科技', '商业', '设计', '人文', '学术', '生活', '其他'];
    select.innerHTML = '';
    preset.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat || '选择分类...';
      select.appendChild(opt);
    });
    customCategories.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      select.appendChild(opt);
    });
  }

  // AI动作处理
  async function handleAIAction(action) {
    if (isAIProcessing || !currentData.text) return;
    if (!$('ai-enabled').checked) return;

    const text = currentData.text;
    showAIOutput(true);

    try {
      let result = '';
      switch (action) {
        case 'summary':
          setAILabel('内容总结');
          result = await AIClient.summarize(text);
          currentData.aiResults.summary = result;
          break;
        case 'expansion':
          setAILabel('扩展阅读');
          result = await AIClient.expand(text);
          currentData.aiResults.expansion = result;
          break;
        case 'critique':
          setAILabel('批判性思考');
          result = await AIClient.critique(text);
          currentData.aiResults.critique = result;
          break;
        case 'metadata':
          setAILabel('生成元数据');
          await generateMetadata();
          hideAILoading();
          return;
      }
      displayAIResult(result);
    } catch (error) {
      displayAIResult(`❌ 错误：${error.message}`, true);
    } finally {
      hideAILoading();
    }
  }

  // 生成元数据
  async function generateMetadata() {
    if (!currentData.text) return;

    showAIOutput(true);
    try {
      const prompt = `你是一名严谨的情报分类专家。请分析以下截取的文本，以 JSON 格式输出：
{
  "title": "高度凝练的文档标题（不超过15字）",
  "overview": "不超过三句的核心概述预览",
  "tags": ["3-5个极其精准的知识分类标签"],
  "category": "选择一个最合适的分类（科技/商业/设计/人文/学术/生活/其他）"
}
要求：标题简洁有力，标签使用中文。返回纯JSON，不要任何解释。`;

      const result = await AIClient.generateMetadata(currentData.text, prompt);

      // 填充表单
      if (result.title && !$('title-input').value) {
        $('title-input').value = result.title;
      }
      if (result.tags && result.tags.length > 0 && !$('tags-input').value) {
        $('tags-input').value = result.tags.join(', ');
      }
      if (result.category) {
        $('category-select').value = result.category;
      }

      // 显示结果
      const display = `✅ 已生成：\n标题：${result.title}\n标签：${result.tags.join(', ')}\n分类：${result.category}`;
      displayAIResult(display);
    } catch (error) {
      displayAIResult(`❌ 生成失败：${error.message}`, true);
    } finally {
      hideAILoading();
    }
  }

  // 单项AI生成
  async function generateSingle(type, text, callback) {
    showAIOutput(true);
    try {
      let result;
      if (type === 'title') {
        result = await AIClient.chat([
          { role: 'user', content: `为以下内容生成一个极其简洁有力的标题（10字以内），直接返回标题文本：\n\n${text.substring(0, 1000)}` }
        ], { temperature: 0.5, maxTokens: 50 });
      } else if (type === 'tags') {
        result = await AIClient.chat([
          { role: 'user', content: `为以下内容生成5个分类标签，用逗号分隔，直接返回标签：\n\n${text.substring(0, 1000)}` }
        ], { temperature: 0.5, maxTokens: 100 });
        result = result.split(/[,，\s]+/).filter(t => t);
      }
      callback(result);
    } catch (error) {
      console.error('[Truffle] generateSingle error:', error);
    } finally {
      hideAILoading();
    }
  }

  // AI UI 控制
  function showAIOutput(showLoading = false) {
    $('ai-output').style.display = 'block';
    $('ai-output-content').textContent = '';
    $('ai-loading').style.display = showLoading ? 'flex' : 'none';
  }

  function hideAILoading() {
    $('ai-loading').style.display = 'none';
  }

  function setAILabel(label) {
    $('ai-output-label').textContent = label;
  }

  function displayAIResult(text, isError = false) {
    $('ai-output-content').textContent = text;
    if (isError) {
      $('ai-output-content').style.color = '#DC2626';
    } else {
      $('ai-output-content').style.color = '#374151';
    }
  }

  // 更新预览
  function updatePreview() {
    const doc = buildDocument();
    const md = MarkdownEngine.generateDocument(doc);
    $('markdown-preview').textContent = md;
  }

  // 构建文档数据
  function buildDocument() {
    const date = new Date();
    const excerpt = currentData.text || '';
    const thoughts = $('thoughts-input').value.trim();
    const title = $('title-input').value.trim() || '未命名摘录';
    
    // Token 估算
    const inputTokens = estimateTokens(excerpt) + estimateTokens(thoughts) + estimateTokens(title);
    const outputTokens = estimateTokens(currentData.aiResults.summary || '')
      + estimateTokens(currentData.aiResults.critique || '')
      + estimateTokens(currentData.aiResults.expansion || '');
    
    return {
      title,
      date: date.toISOString(),
      sourceUrl: currentData.url || '',
      sourceTitle: currentData.title || '',
      author: currentData.author || '',
      tags: $('tags-input').value.split(/[,，\s]+/).filter(t => t.trim()),
      category: $('category-select').value || '其他',
      excerpt,
      thoughts,
      aiSummary: currentData.aiResults.summary || '',
      aiCritique: currentData.aiResults.critique || '',
      aiExpansion: currentData.aiResults.expansion || '',
      saveTime: date.toLocaleString('zh-CN'),
      version: '1.4.1',
      estimatedTokens: inputTokens + outputTokens,
    };
  }

  // Token 估算
  function estimateTokens(text) {
    if (!text) return 0;
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return chineseChars + Math.ceil(otherChars / 4);
  }

  // 保存文档
  async function saveDocument() {
    // 校验必填
    const title = $('title-input').value.trim();
    if (!title) {
      alert('请填写标题（必填）');
      $('title-input').focus();
      return;
    }

    // 强制思考
    const thoughts = $('thoughts-input').value.trim();
    if (!thoughts) {
      const confirmSkip = confirm('个人思考尚未填写。觅露的核心理念是"先判断，后保存"。\n\n是否跳过思考直接保存？');
      if (!confirmSkip) {
        $('thoughts-input').focus();
        return;
      }
    }

    // 构建文档
    const doc = buildDocument();
    const markdown = MarkdownEngine.generateDocument(doc);
    const filename = MarkdownEngine.generateFilename(doc.title);

    // 保存
    try {
      $('save-btn').textContent = '保存中...';
      $('save-btn').disabled = true;

      const result = await chrome.runtime.sendMessage({
        action: 'saveMarkdown',
        data: {
          filename,
          content: markdown,
          doc,
        },
      });

      if (result && result.success) {
        // 添加到历史
        try {
          await Storage.addHistory({
            title: doc.title,
            filename,
            url: doc.sourceUrl,
            date: doc.date,
          });
        } catch (e) { /* 历史记录非关键 */ }

        showToast(`✅ 已保存：${filename}`);

        setTimeout(() => {
          resetForm();
        }, 500);
      } else {
        throw new Error(result?.error || '保存失败');
      }
    } catch (error) {
      console.error('[Truffle] saveDocument error:', error);
      if (error.message && error.message.includes('Extension context invalidated')) {
        alert('扩展已重新加载，请关闭此面板并刷新页面后重试。');
      } else {
        alert(`保存失败：${error.message}\n\n请检查：\n1. 是否已设置保存路径\n2. 是否已激活插件`);
      }
    } finally {
      $('save-btn').textContent = '保存到本地';
      $('save-btn').disabled = false;
    }
  }

  // 选择保存目录
  async function selectSaveDirectory() {
    try {
      // 检查 File System Access API 是否可用
      if ('showDirectoryPicker' in window) {
        const dirHandle = await window.showDirectoryPicker();
        await dirHandle.requestPermission({ mode: 'readwrite' });
        await Storage.saveDirectoryHandle(dirHandle);
        await Storage.set('savePath', '(File System Access)');
        await Storage.set('useDownloadsFallback', false);
        updateSavePathDisplay();
        showToast('保存路径已设置');
      } else {
        throw new Error('浏览器不支持 File System Access API');
      }
    } catch (error) {
      console.error('[Truffle] selectSaveDirectory error:', error);
      // 降级到 downloads fallback
      await Storage.set('useDownloadsFallback', true);
      updateSavePathDisplay();
      alert('将使用浏览器下载作为保存方式。\n请在Chrome设置中将下载目录设为你的知识库文件夹。');
    }
  }

  // 更新保存路径显示
  async function updateSavePathDisplay() {
    const cfg = await Storage.getConfig();
    const display = $('save-path-display');
    if (cfg.useDownloadsFallback) {
      display.textContent = '使用浏览器下载文件夹';
    } else if (cfg.savePath) {
      display.textContent = '已设置自定义路径';
    } else {
      display.textContent = '保存路径未设置（点击更改）';
    }
  }

  // 重置表单
  function resetForm() {
    $('title-input').value = '';
    $('tags-input').value = '';
    $('category-select').value = '';
    $('thoughts-input').value = '';
    $('excerpt-preview').textContent = '';
    $('markdown-preview').textContent = '';
    currentData = { mode: 'hunter', text: '', url: '', title: '', aiResults: {} };
    $('ai-output').style.display = 'none';
  }

  // Toast
  function showToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      background: #1F2937;
      color: white;
      padding: 10px 18px;
      border-radius: 6px;
      font-size: 13px;
      z-index: 10000;
      animation: truffle-toast-in 0.2s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }

  // 防抖
  function debounce(fn, wait) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  // 启动
  init();
})();
