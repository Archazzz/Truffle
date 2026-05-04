// 觅露 (Truffle) v1.4.1 — Service Worker
// 职责：保存文件 + AI代理（模型分层） + 图标点击通知content script
// ============================================

importScripts(
  '../utils/constants.js',
  '../utils/storage.js',
  '../utils/ai-client.js',
  '../utils/markdown-engine.js'
);

let pendingClip = null;

// ============================================
// AI 后台异步任务队列
// ============================================
const aiJobQueue = [];
let isProcessingAIJobs = false;
let currentJobId = 0;

// ============================================
// 图标点击 / 快捷键 — 考古模式（通知 content script 显示全页编辑器）
// ============================================
async function triggerFullPageEditor(tab) {
  if (!tab || !tab.id) {
    console.error('[Truffle] No active tab');
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'showFullPageEditor' });
    console.log('[Truffle v1.4.1] Full page editor triggered on tab', tab.id);
  } catch (err) {
    // Content script 可能未注入（如 Chrome 内置页面），尝试主动注入
    console.log('[Truffle] content script not ready, attempting injection:', err.message);
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['src/utils/storage.js', 'src/content-scripts/floating-toolbar.js'],
      });
      // 注入后重试
      await chrome.tabs.sendMessage(tab.id, { action: 'showFullPageEditor' });
    } catch (injectErr) {
      console.error('[Truffle] Injection failed:', injectErr.message);
    }
  }
}

chrome.action.onClicked.addListener((tab) => {
  triggerFullPageEditor(tab);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'show-full-page-editor') {
    triggerFullPageEditor(tab);
  }
});

// ============================================
// 消息路由
// ============================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handler = async () => {
    try {
      switch (request.action) {
        case 'saveMarkdown':
          sendResponse(await handleSaveMarkdown(request.data));
          break;
        case 'callAI':
          sendResponse(await handleAICall(request.data));
          break;
        case 'startBackgroundAI':
          sendResponse(await enqueueBackgroundAI(request.data));
          break;
        case 'getBackgroundAIStatus':
          sendResponse({ queueLength: aiJobQueue.length, isProcessing: isProcessingAIJobs });
          break;
        case 'openOptionsPage':
          chrome.runtime.openOptionsPage();
          sendResponse({ success: true });
          break;
        case 'validateApiKey':
          sendResponse(await handleValidateApiKey(request.data));
          break;
        case 'ping':
          sendResponse({ alive: true });
          break;
        default:
          sendResponse({ error: 'Unknown: ' + request.action });
      }
    } catch (err) {
      console.error('[Truffle BG] error:', err);
      sendResponse({ error: err.message });
    }
  };
  handler();
  return true;
});

// ============================================
// 保存
// ============================================
async function handleSaveMarkdown({ filename, content, doc }) {
  const config = await Storage.getConfig();
  if (!config.isActivated) {
    return { success: false, error: '插件未激活' };
  }

  try {
    if (!config.useDownloadsFallback) {
      try {
        const handle = await Storage.getDirectoryHandle();
        if (handle) {
          // 检查权限是否仍然有效
          const perm = await handle.queryPermission({ mode: 'readwrite' });
          if (perm === 'granted') {
            await saveViaFSA(handle, filename, content, config.folderStructure, doc);
            return { success: true, path: filename };
          }
          // 权限失效，尝试重新请求
          const newPerm = await handle.requestPermission({ mode: 'readwrite' });
          if (newPerm === 'granted') {
            await saveViaFSA(handle, filename, content, config.folderStructure, doc);
            return { success: true, path: filename };
          }
          throw new Error('文件夹权限已失效，请重新在设置中选择保存文件夹');
        }
      } catch (e) {
        console.log('[Truffle] FSA failed:', e.message);
        // 如果是权限问题，fallback 到 downloads 并给出提示
        if (e.message.includes('权限') || e.name === 'NotAllowedError') {
          return { 
            success: false, 
            error: '文件夹权限已失效，请重新在设置中选择保存文件夹，或改用浏览器下载方式。',
            fsaFailed: true
          };
        }
      }
    }
    await saveViaDownloads(filename, content, true);
    return { success: true, path: filename };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function saveViaFSA(dirHandle, filename, content, structure, doc) {
  let targetDir = dirHandle;
  if (structure === 'byDate') {
    const d = new Date().toISOString().split('T')[0];
    targetDir = await dirHandle.getDirectoryHandle(d, { create: true });
  } else if (structure === 'byDomain') {
    const domain = new URL(doc?.sourceUrl || 'https://x').hostname.replace(/^www\./, '');
    targetDir = await dirHandle.getDirectoryHandle(domain, { create: true });
  } else if (structure === 'byCategory') {
    const category = doc?.category || '未分类';
    targetDir = await dirHandle.getDirectoryHandle(category, { create: true });
  }
  const fh = await targetDir.getFileHandle(filename, { create: true });
  const w = await fh.createWritable();
  await w.write(content);
  await w.close();
}

async function saveViaDownloads(filename, content, skipDialog = false) {
  // 使用 Blob URL 替代 data URL，避免长内容超出 URL 长度限制
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({
      url: url,
      filename: `Truffle/${filename}`,
      saveAs: !skipDialog, // 中间步骤不弹对话框，最后一步弹
    });
  } finally {
    // 延迟释放 Blob URL，确保下载请求已发起
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

// ============================================
// AI 代理（模型分层）
// ============================================
// modelType: 'light'  → 轻量模型，快速直出（标题/标签）
// modelType: 'deep'   → 深度模型，思考分析（总结/扩展/批判）
// ============================================
async function handleAICall({ type, text, options = {} }) {
  const config = await Storage.getConfig();

  if (!config.aiEnabled) {
    return { error: 'AI 功能已禁用' };
  }

  const provider = options.provider || config.apiProvider;
  const modelType = options.modelType || 'light'; // 'light' | 'deep'

  // ===== 模型分层配置 =====
  let apiKey, baseUrl, model;

  if (provider === 'kimiCoding') {
    apiKey = config.kimiCodingKey;
    baseUrl = 'https://api.kimi.com/coding/v1';
    // Kimi Coding 只有一个模型 kimi-k2.6
    model = config.kimiCodingModel || 'kimi-k2.6';
  } else if (provider === 'custom') {
    apiKey = config.apiKey;
    baseUrl = config.apiBaseUrl || '';
    // 自定义端点不区分 light/deep，用用户指定的
    model = config.apiModel || 'gpt-4';
  } else {
    // Moonshot 普通 API — 模型分层
    apiKey = config.apiKey;
    baseUrl = config.baseUrl || 'https://api.moonshot.cn/v1';

    if (modelType === 'light') {
      // 轻量任务：标题/标签 — 用便宜的轻量模型，快速直出
      model = 'moonshot-v1-8k';
    } else {
      // 深度任务：总结/扩展/批判 — 用强模型，允许深度思考
      model = config.apiModel || 'kimi-k2.5';
    }
  }

  if (!apiKey) {
    return { error: 'API Key 未配置' };
  }
  if (!baseUrl) {
    return { error: 'Base URL 未配置' };
  }

  AIClient.setConfig({ apiKey, baseUrl, model });

  try {
    let result;
    switch (type) {
      case 'metadata':
        result = await AIClient.generateMetadata(text, PROMPTS.metadata, { model });
        break;
      case 'summary':
        result = await AIClient.summarize(text, { model, maxTotalTime: 30000 });
        break;
      case 'expansion':
        result = await AIClient.expand(text, { model, maxTotalTime: 30000 });
        break;
      case 'critique':
        result = await AIClient.critique(text, { model, maxTotalTime: 30000 });
        break;
      case 'title': {
        let r = await AIClient.chat([
          { role: 'system', content: '你给这段文字写个中文标题，最终你的返回结果里面只有一行标题，不要有其他内容\n\n' + text }
        ], { maxTokens: 1000, model, maxTotalTime: 120000 });
        r = stripThinking(r);
        if (!r) { console.warn('[Truffle BG] title stripThinking returned empty, using raw'); r = '[标题生成失败]'; }
        result = r.replace(/["'""「」]/g, '').trim();
        break;
      }
      case 'tags': {
        let r = await AIClient.chat([
          { role: 'system', content: '你给这段文字写几个tag，最终你的返回结果里面只有tags不要有其他内容，中间用逗号隔开，数量不要超过五个\n\n' + text.substring(0, 1500) }
        ], { maxTokens: 1000, model, maxTotalTime: 120000 });
        r = stripThinking(r);
        if (!r) { console.warn('[Truffle BG] tags stripThinking returned empty, using raw'); r = ''; }
        result = r.split(/[,，]+/).map(t => t.trim()).filter(t => t);
        break;
      }
      case 'translate':
        result = await AIClient.translate(text, { model, maxTotalTime: 30000 });
        break;
      default:
        return { error: 'Unknown AI type: ' + type };
    }
    return { success: true, result, estimatedTokens: estimateTokens(text) };
  } catch (err) {
    if (err.message && err.message.includes('access_terminated_error')) {
      return { error: 'Kimi Coding API 仅对 Coding Agents 开放。请检查 User-Agent 设置。' };
    }
    if (err.message && err.message.includes('403')) {
      return { error: 'API 认证失败（403）。' };
    }
    return { error: err.message };
  }
}

// ============================================
// API Key 验证
// ============================================
async function handleValidateApiKey({ provider, apiKey: keyArg, baseUrl: urlArg, model: modelArg }) {
  const config = await Storage.getConfig();
  let apiKey = keyArg, baseUrl, model;

  if (provider === 'kimiCoding') {
    apiKey = keyArg || config.kimiCodingKey;
    baseUrl = urlArg || 'https://api.kimi.com/coding/v1';
    model = modelArg || config.kimiCodingModel || 'kimi-k2.6';
  } else if (provider === 'custom') {
    apiKey = keyArg || config.apiKey;
    baseUrl = urlArg || config.apiBaseUrl;
    model = modelArg || config.apiModel || 'gpt-4';
  } else {
    apiKey = keyArg || config.apiKey;
    baseUrl = urlArg || config.baseUrl || 'https://api.moonshot.cn/v1';
    model = modelArg || config.apiModel || 'moonshot-v1-8k';
  }

  if (!apiKey) return { valid: false, error: 'API Key 未配置' };
  if (!baseUrl) return { valid: false, error: 'Base URL 未配置' };

  AIClient.setConfig({ apiKey, baseUrl, model });

  try {
    const result = await AIClient.chat(
      [{ role: 'user', content: 'Hi' }],
      { maxTokens: 500, maxTotalTime: 15000 }
    );
    return { valid: true, result: result.substring(0, 50) };
  } catch (err) {
    if (err.message && err.message.includes('access_terminated_error')) {
      return { valid: false, error: 'Kimi Coding API 仅对 Coding Agents 开放。', isCodingOnly: true };
    }
    return { valid: false, error: err.message };
  }
}

// ============================================
// Token 估算
// ============================================
function estimateTokens(text) {
  if (!text) return 0;
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return chineseChars + Math.ceil(otherChars / 4);
}

// ============================================
// AI 后台异步任务队列
// ============================================
async function enqueueBackgroundAI(data) {
  const { filename, doc, types, text, baseContent, clientJobId, baseTokens } = data;
  if (!types || types.length === 0) {
    return { success: false, error: '未指定 AI 类型' };
  }

  const job = {
    id: ++currentJobId,
    clientJobId,
    filename,
    doc,
    types,
    text,
    baseContent,
    baseTokens: baseTokens || 0,
    status: 'pending',
    createdAt: Date.now(),
  };
  aiJobQueue.push(job);

  // 更新 badge
  updateAIBadge();

  // 启动处理
  processAIJobs();

  return { success: true, jobId: job.id };
}

async function processAIJobs() {
  if (isProcessingAIJobs || aiJobQueue.length === 0) return;
  isProcessingAIJobs = true;

  while (aiJobQueue.length > 0) {
    const job = aiJobQueue[0];
    job.status = 'running';
    updateAIBadge();
    console.log(`[Truffle BG] 开始处理AI job #${job.id}, types=[${job.types.join(',')}], file=${job.filename}`);

    const totalTypes = job.types.length;
    let completedCount = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const type of job.types) {
      console.log(`[Truffle BG] Job #${job.id} ${type} (${completedCount + 1}/${totalTypes})...`);

      // 通知前端进度
      notifyJobProgress(job, completedCount + 1, totalTypes, type);

      let result = '';
      try {
        const response = await handleAICall({
          type,
          text: job.text,
          options: { modelType: 'deep' },
        });
        if (response && response.success) {
          result = response.result;
          totalInputTokens += response.estimatedTokens || 0;
          totalOutputTokens += estimateTokens(String(response.result || ''));
          console.log(`[Truffle BG] Job #${job.id} ${type} 成功, 输出长度=${String(response.result || '').length}`);
        } else {
          result = '❌ ' + (response?.error || '生成失败');
          console.warn(`[Truffle BG] Job #${job.id} ${type} 失败:`, response?.error);
        }
      } catch (err) {
        console.error(`[Truffle BG] Job #${job.id} ${type} 异常:`, err.message);
        result = '❌ ' + err.message;
      }

      // 每完成一个类型立即追加写入文件
      if (!result.startsWith('❌') && result.trim()) {
        try {
          await appendSingleAIResult(job, type, result, completedCount, totalTypes, totalInputTokens + totalOutputTokens);
        } catch (appendErr) {
          console.error(`[Truffle BG] 追加 ${type} 失败:`, appendErr.message);
        }
      }

      completedCount++;
    }

    // 全部完成通知
    job.status = 'completed';
    notifyJobComplete(job, true, totalTypes, completedCount);
    console.log(`[Truffle BG] Job #${job.id} 全部完成 (${completedCount}/${totalTypes})`);

    aiJobQueue.shift();
    updateAIBadge();
  }

  isProcessingAIJobs = false;
  console.log('[Truffle BG] AI任务队列处理完毕');
}

function updateAIBadge() {
  const count = aiJobQueue.filter(j => j.status === 'pending' || j.status === 'running').length;
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ color: '#6366F1' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

async function appendSingleAIResult(job, type, result, completedIndex, totalCount, totalTokens) {
  const config = await Storage.getConfig();

  const aiLabels = { summary: '内容总结', expansion: '扩展阅读', critique: '批判性思考', translate: '翻译' };
  const filtered = stripThinking(result);
  const contentToAppend = filtered || result;

  const aiSection = `\n\n### ${aiLabels[type] || type}\n\n${contentToAppend}`;
  const tokenNote = totalTokens > 0 ? `\n\n---\n*AI 分析后台生成中 (${completedIndex + 1}/${totalCount})*` : '';

  // 尝试 FSA 追加写入
  if (!config.useDownloadsFallback) {
    try {
      const handle = await Storage.getDirectoryHandle();
      if (handle) {
        const perm = await handle.queryPermission({ mode: 'readwrite' });
        if (perm === 'granted' || (await handle.requestPermission({ mode: 'readwrite' })) === 'granted') {
          const targetDir = await getTargetDir(handle, config.folderStructure, job.doc);
          const fh = await targetDir.getFileHandle(job.filename, { create: false });
          const file = await fh.getFile();
          let originalContent = await file.text();

          // 移除旧的 "AI 分析" 占位标记
          originalContent = originalContent.replace(/\n*---\n\*AI 分析.*\*/, '');

          // 如果是第一次追加，创建 AI 分析标题
          let newContent;
          if (!originalContent.includes('## AI 分析（后台生成）')) {
            newContent = originalContent + '\n\n---\n\n## AI 分析（后台生成）' + aiSection + tokenNote;
          } else {
            // 在已有的 AI 分析节末尾追加
            const idx = originalContent.indexOf('## AI 分析（后台生成）');
            const before = originalContent.slice(0, idx);
            const after = originalContent.slice(idx + '## AI 分析（后台生成）'.length);
            newContent = before + '## AI 分析（后台生成）' + after + aiSection + tokenNote;
          }

          const w = await fh.createWritable();
          await w.write(newContent);
          await w.close();

          notifyJobProgress(job, completedIndex + 1, totalCount, type, true);
          return;
        }
      }
    } catch (e) {
      console.log('[Truffle] FSA append failed:', e.message);
    }
  }

  // FSA 失败或 downloads 模式
  try {
    let baseContent = job.baseContent || '';
    let newContent;
    if (!baseContent.includes('## AI 分析（后台生成）')) {
      newContent = baseContent + '\n\n---\n\n## AI 分析（后台生成）' + aiSection + tokenNote;
    } else {
      newContent = baseContent + aiSection + tokenNote;
    }
    job.baseContent = newContent;

    // 每步都保存到下载文件夹（不弹对话框），确保中间内容不丢失
    const isLast = completedIndex + 1 === totalCount;
    const suffix = isLast ? '-ai-complete.md' : `-${completedIndex + 1}of${totalCount}.md`;
    const downloadFilename = job.filename.replace('.md', suffix);
    
    // 如果是最后一步，更新 YAML token
    if (isLast) {
      newContent = newContent.replace(/estimated_tokens:\s*\d+/, `estimated_tokens: ${totalTokens}`);
    }
    
    await saveViaDownloads(downloadFilename, newContent, !isLast); // 中间步骤不弹对话框
    
    notifyJobProgress(job, completedIndex + 1, totalCount, type, true);
  } catch (e) {
    console.error('[Truffle] Downloads append failed:', e);
    notifyJobProgress(job, completedIndex + 1, totalCount, type, false, e.message);
  }
}

async function notifyJobProgress(job, step, total, type, success, error) {
  const typeLabels = { summary: '总结', expansion: '扩展', critique: '批判', translate: '翻译' };
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: 'backgroundAIProgress',
        data: {
          jobId: job.clientJobId,
          filename: job.filename,
          step,
          total,
          type: typeLabels[type] || type,
          success,
          error,
        },
      });
    } catch (e) {
      // tab 没有 content script，忽略
    }
  }
}

async function notifyJobComplete(job, success, totalCount, completedCount) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: 'backgroundAIComplete',
        data: {
          jobId: job.clientJobId,
          filename: job.filename,
          success,
          totalCount,
          completedCount,
        },
      });
    } catch (e) {
      // tab 没有 content script，忽略
    }
  }
}
async function getTargetDir(dirHandle, structure, doc) {
  let targetDir = dirHandle;
  if (structure === 'byDate') {
    const d = new Date().toISOString().split('T')[0];
    targetDir = await dirHandle.getDirectoryHandle(d, { create: true });
  } else if (structure === 'byDomain') {
    const domain = new URL(doc?.sourceUrl || 'https://x').hostname.replace(/^www\./, '');
    targetDir = await dirHandle.getDirectoryHandle(domain, { create: true });
  } else if (structure === 'byCategory') {
    const category = doc?.category || '未分类';
    targetDir = await dirHandle.getDirectoryHandle(category, { create: true });
  }
  return targetDir;
}

// ============================================
// AI 输出后处理：清理思考痕迹，提取最终结论
// ============================================
function stripThinking(text) {
  if (!text) return '';
  const raw = text.trim();
  let cleaned = raw;

  // 策略1: 如果包含明确的"结论/决定/输出"标记，提取标记后的内容
  const conclusionMarkers = [
    /(?:最终决定[：:]\s*)/i,
    /(?:最终答案[：:]\s*)/i,
    /(?:最终输出[：:]\s*)/i,
    /(?:最终结论[：:]\s*)/i,
    /(?:答案[：:]\s*)/i,
    /(?:输出[：:]\s*)/i,
    /(?:结论[：:]\s*)/i,
    /(?:标题[：:]\s*)/i,
    /(?:标签[：:]\s*)/i,
    /(?:翻译[：:]\s*)/i,
  ];
  for (const marker of conclusionMarkers) {
    const match = cleaned.match(marker);
    if (match) {
      const after = cleaned.slice(match.index + match[0].length).trim();
      if (after.length > 0 && after.length < cleaned.length * 0.95) {
        cleaned = after;
        break;
      }
    }
  }

  // 策略2: 按段落分割，3+段时最后一段通常是结论
  const paragraphs = cleaned.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 0);
  if (paragraphs.length >= 3) {
    const last = paragraphs[paragraphs.length - 1];
    if (last.length > 3 && !/^\d+[.．、]/.test(last) && !/^(用户|思考|分析|步骤|首先|然后)/.test(last)) {
      cleaned = last;
    }
  }

  // 策略3: 行级别——删除元话语行和候选序号行
  const filteredLines = cleaned.split('\n').map(l => l.trim()).filter(l => {
    if (l.length === 0) return false;
    // 删除元话语行
    if (/^(用户要求|我需要|让我|首先|然后|接着|分析|思考|候选|推荐|步骤|第[一二三四五六七八九十\d]+步|或者|但是|考虑到|基于以上|选择最|我选择|我决定|最终决定|这个标题|这标题|这个标签|这标签|综合来看|比较后)/.test(l)) return false;
    // 删除纯数字序号行（如"1." "2."）
    if (/^\d+[.．、)\]]*\s*$/.test(l)) return false;
    // 删除非常短的候选序号行（如"1." "2. xxx" 少于15字），保留实际内容要点
    if (/^\d+[.．、]\s*[^：:]+$/.test(l) && l.length < 15) return false;
    return true;
  });

  // 如果过滤后只剩空，回退
  if (filteredLines.length === 0 && paragraphs.length > 0) {
    const longest = paragraphs.reduce((a, b) => a.length > b.length ? a : b);
    if (longest.length > 3) {
      filteredLines.push(longest);
    }
  }
  cleaned = filteredLines.join('\n');

  // 策略4: 清理首尾标点
  cleaned = cleaned
    .replace(/^[\s"'""「『【（\-•·]+/, '')
    .replace(/[\s"\'""」』】）\-•·]+$/, '')
    .trim();

  // 去重：如果同一句话重复出现，只保留一次
  cleaned = cleaned.replace(/(.{5,50})\1+/g, '$1');

  // 最终回退
  if (!cleaned) {
    console.warn('[Truffle BG] stripThinking: all filters emptied result, returning raw');
    return raw;
  }

  return cleaned;
}

// ============================================
// 心跳
// ============================================
if (chrome.alarms) {
  chrome.alarms.create('heartbeat', { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener(a => {
    if (a.name === 'heartbeat') console.log('[Truffle v1.4.1] heartbeat');
  });
}

console.log('[Truffle v1.4.1] Service Worker started');

// 保持 Service Worker 活跃：后台AI任务运行时定期触发alarm防止被kill
chrome.alarms?.create?.('keepAlive', { periodInMinutes: 0.5 });
chrome.alarms?.onAlarm?.addListener?.((alarm) => {
  if (alarm.name === 'keepAlive') {
    console.log('[Truffle v1.4.1] keepAlive alarm');
  }
});
