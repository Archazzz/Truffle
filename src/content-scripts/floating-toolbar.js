// 觅露 (Truffle) v1.4.1 — Content Script
// 划词检测 + 悬浮窗 + 左右布局内联编辑器
// 新增：激活状态检查、分类持久化、AI异步后台生成、Token追踪、进度提示
// ============================================

(function() {
  'use strict';

  if (window.__truffleInjected) return;
  window.__truffleInjected = true;

  const TOOLBAR_HOST_ID = 'truffle-toolbar-host';
  let toolbarHost = null;

  // SVG 图标 - 优化版
  const SVGS = {
    copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`,
    mark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>`,
    sparkle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,
    tag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><circle cx="7.5" cy="7.5" r="1.5" fill="currentColor"/></svg>`,
    translate: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8l6 6"/><path d="M4 14h6"/><path d="M2 5h12"/><path d="M7 2v3"/><path d="M22 22l-5-10-5 10"/><path d="M14 18h6"/></svg>`,
    summary: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
    expand: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>`,
    critique: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  };

  const PRESET_CATEGORIES = ['科技','商业','设计','人文','学术','生活','其他'];
  let isActivated = false;
  let customCategories = [];
  let localJobId = 0;

  // ===== 事件监听 =====
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('mousedown', (e) => {
    if (toolbarHost && !toolbarHost.contains(e.target)) hideToolbar();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideToolbar();
      const ed = document.getElementById('truffle-inline-editor');
      if (ed) ed.remove();
      hideAIProgressPanel();
    }
  });

  // ===== 监听 Background =====
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'showFullPageEditor') {
      const content = extractPageContent();
      showInlineEditor(content.textContent || '', content);
      sendResponse({ ok: true });
      return true;
    }
    if (request.action === 'extractPageContent') {
      sendResponse(extractPageContent());
      return true;
    }
    if (request.action === 'backgroundAIComplete') {
      handleBackgroundAIComplete(request.data);
      sendResponse({ ok: true });
      return true;
    }
    if (request.action === 'backgroundAIProgress') {
      handleBackgroundAIProgress(request.data);
      sendResponse({ ok: true });
      return true;
    }
    return true;
  });

  // ===== Token 估算 =====
  function estimateTokens(text) {
    if (!text) return 0;
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return chineseChars + Math.ceil(otherChars / 4);
  }

  // ===== 配置加载 =====
  async function loadConfig() {
    try {
      const config = await Storage.getConfig();
      isActivated = config.isActivated;
      customCategories = await Storage.get('customCategories', []);
    } catch (e) {
      isActivated = false;
      customCategories = [];
    }
  }

  // ===== 自定义分类持久化 =====
  async function saveCustomCategories() {
    try {
      await Storage.set('customCategories', customCategories);
    } catch (e) {
      console.error('[Truffle] saveCustomCategories failed:', e);
    }
  }

  // ===== 划词检测 =====
  function onMouseUp(e) {
    if (toolbarHost && toolbarHost.contains(e.target)) return;
    setTimeout(() => {
      const text = window.getSelection().toString().trim();
      if (text.length > 0 && text.length < 50000) showToolbar(text);
      else hideToolbar();
    }, 10);
  }

  // ===== 悬浮窗 =====
  function showToolbar(text) {
    hideToolbar();
    toolbarHost = document.createElement('div');
    toolbarHost.id = TOOLBAR_HOST_ID;
    toolbarHost.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;';
    document.body.appendChild(toolbarHost);

    const shadow = toolbarHost.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      .tbar{display:flex;gap:4px;background:#1F2937;border-radius:8px;padding:4px;box-shadow:0 4px 20px rgba(0,0,0,0.3);font-family:system-ui,sans-serif;font-size:13px;animation:fi 0.15s ease-out}
      @keyframes fi{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
      .btn{display:flex;align-items:center;gap:4px;padding:6px 12px;border:none;border-radius:6px;background:transparent;color:#F8FAFC;cursor:pointer;font-size:13px;font-weight:500;white-space:nowrap}
      .btn:hover{background:rgba(255,255,255,0.15)}
      .btn:active{transform:scale(0.95)}
      .btn svg{width:14px;height:14px;flex-shrink:0}
      .btn-mark{background:#6366F1;color:white}
      .sep{width:1px;background:rgba(255,255,255,0.15);margin:4px 0}
      .toast{position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);background:#1F2937;color:white;padding:5px 12px;border-radius:4px;font-size:12px;font-weight:500;white-space:nowrap;pointer-events:none;animation:tp 0.2s ease}
      .toast::after{content:'';position:absolute;top:100%;left:50%;transform:translateX(-50%);border:4px solid transparent;border-top-color:inherit}
      @keyframes tp{from{opacity:0;transform:translateX(-50%)translateY(4px)}to{opacity:1;transform:translateX(-50%)translateY(0)}}
    `;
    shadow.appendChild(style);

    const rect = getSelectionRect();
    const vw = window.innerWidth;
    let left = rect.left + rect.width/2 - 80;
    let top = rect.bottom + 8 + window.scrollY;
    left = Math.max(10, Math.min(left, vw-170));
    if (rect.bottom + 60 > window.innerHeight) top = rect.top - 48 + window.scrollY;

    const wrap = document.createElement('div');
    wrap.style.cssText = `position:absolute;left:${left}px;top:${top}px;`;
    const toastBox = document.createElement('div');
    toastBox.style.cssText = 'position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);pointer-events:none;';
    const tbar = document.createElement('div');
    tbar.className = 'tbar';
    tbar.innerHTML = `
      <button class="btn" id="tr-copy">${SVGS.copy}<span>复制</span></button>
      <div class="sep"></div>
      <button class="btn btn-mark" id="tr-mark">${SVGS.mark}<span>标记</span></button>
    `;
    wrap.appendChild(toastBox);
    wrap.appendChild(tbar);
    shadow.appendChild(wrap);

    tbar.querySelector('#tr-copy').addEventListener('click', (e) => {
      e.stopPropagation();
      doCopy(text, toastBox);
    });
    tbar.querySelector('#tr-mark').addEventListener('click', (e) => {
      e.stopPropagation();
      hideToolbar();
      window.getSelection().removeAllRanges();
      showInlineEditor(text);
    });
  }

  function hideToolbar() {
    if (toolbarHost) { toolbarHost.remove(); toolbarHost = null; }
  }
  function getSelectionRect() {
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (r.width > 0 || r.height > 0) return r;
    }
    return { left: window.innerWidth/2-50, top: window.innerHeight/2, width: 100, height: 20, bottom: window.innerHeight/2+20 };
  }

  // ===== 复制 =====
  function doCopy(text, toastBox) {
    let copied = false;
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;';
      document.body.appendChild(ta); ta.select();
      copied = document.execCommand('copy');
      document.body.removeChild(ta);
    } catch(e){}
    if (!copied && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(()=>copied=true).catch(()=>{});
    }
    if (copied) { showToast(toastBox, '已复制'); setTimeout(hideToolbar, 400); }
    else showToast(toastBox, '复制失败', true);
  }
  function showToast(box, msg, isError) {
    box.innerHTML = '';
    const t = document.createElement('div');
    t.className = 'toast' + (isError ? ' error' : '');
    t.textContent = msg; box.appendChild(t);
    setTimeout(()=>t.remove(), 1500);
  }

  // ===== 全局进度通知系统 =====
  function showAIProgressPanel() {
    let panel = document.getElementById('truffle-ai-progress');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'truffle-ai-progress';
      panel.className = 'truffle-ai-progress';
      panel.innerHTML = `
        <div class="truffle-ai-progress-header">
          <span>AI 分析进度</span>
          <button class="truffle-ai-progress-close">&times;</button>
        </div>
        <div class="truffle-ai-progress-list" id="truffle-ai-progress-list"></div>
      `;
      document.body.appendChild(panel);
      panel.querySelector('.truffle-ai-progress-close').addEventListener('click', () => panel.classList.add('hidden'));
    }
    panel.classList.remove('hidden');
    return panel;
  }

  function hideAIProgressPanel() {
    const panel = document.getElementById('truffle-ai-progress');
    if (panel) panel.classList.add('hidden');
  }

  function updateAIProgressItem(jobId, filename, status, detail, progress) {
    const panel = showAIProgressPanel();
    const list = panel.querySelector('#truffle-ai-progress-list');
    let item = list.querySelector(`[data-job-id="${jobId}"]`);
    if (!item) {
      item = document.createElement('div');
      item.className = 'truffle-ai-progress-item';
      item.dataset.jobId = jobId;
      list.appendChild(item);
    }
    const statusClass = status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'running';
    item.className = `truffle-ai-progress-item ${statusClass}`;
    const progressText = progress ? ` (${progress})` : '';
    const statusHTML = status === 'running'
      ? `<span class="truffle-spinner-mini"></span>进行中${progressText}`
      : status === 'completed' ? `✅ 已完成${progressText}` : '❌ 失败';
    item.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span class="truffle-ai-progress-filename">${escapeHtml(filename)}</span>
        <button class="truffle-ai-progress-item-close" data-close-job="${jobId}" title="关闭">&times;</button>
      </div>
      <span class="truffle-ai-progress-status">${statusHTML}</span>
      ${detail ? `<span class="truffle-ai-progress-detail">${escapeHtml(detail)}</span>` : ''}
    `;
    // 绑定关闭按钮
    const closeBtn = item.querySelector(`[data-close-job="${jobId}"]`);
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        item.style.animation = 'truffle-fade-out 0.3s ease forwards';
        setTimeout(() => {
          item.remove();
          if (list.children.length === 0) {
            setTimeout(() => hideAIProgressPanel(), 3000);
          }
        }, 300);
      });
    }
  }

  function removeAIProgressItem(jobId) {
    const list = document.getElementById('truffle-ai-progress-list');
    if (!list) return;
    const item = list.querySelector(`[data-job-id="${jobId}"]`);
    if (item) {
      item.style.animation = 'truffle-fade-out 0.3s ease forwards';
      setTimeout(() => {
        item.remove();
        // 如果列表为空，延时3秒后隐藏面板
        if (list.children.length === 0) {
          setTimeout(() => hideAIProgressPanel(), 3000);
        }
      }, 300);
    }
  }

  async function handleBackgroundAIComplete(data) {
    const { jobId, filename, success, totalCount, completedCount } = data;
    if (success) {
      updateAIProgressItem(jobId, filename, 'completed', '已追加到文件', `${completedCount}/${totalCount}`);
      showGlobalToast(`✅ "${filename}" AI分析已完成 (${completedCount}/${totalCount})`);
      setTimeout(() => removeAIProgressItem(jobId), 5000);
    } else {
      updateAIProgressItem(jobId, filename, 'failed', '追加失败');
      showGlobalToast(`❌ "${filename}" AI分析追加失败`);
    }
  }

  async function handleBackgroundAIProgress(data) {
    const { jobId, filename, step, total, type } = data;
    updateAIProgressItem(jobId, filename, 'running', `${type} 处理中...`, `${step}/${total}`);
  }

  // ===== 内联编辑器（v1.3 左右布局）=====
  async function showInlineEditor(text, pageInfo) {
    if (document.getElementById('truffle-inline-editor')) return;

    // 加载配置
    await loadConfig();

    const isFullPage = !!pageInfo;
    const pageTitle = pageInfo?.title || document.title;
    const pageUrl = pageInfo?.url || location.href;
    const excerpt = text.substring(0, 1000) + (text.length > 1000 ? '...' : '');

    const allCategories = [...PRESET_CATEGORIES, ...customCategories];
    const saveBtnText = isActivated ? '保存到本地' : '去激活';
    const saveBtnClass = isActivated ? 'truffle-btn-save' : 'truffle-btn-save truffle-btn-activate';

    const overlay = document.createElement('div');
    overlay.id = 'truffle-inline-editor';
    overlay.className = 'truffle-editor-overlay';
    overlay.innerHTML = `
      <div class="truffle-editor-modal">
        <div class="truffle-editor-header">
          <span>觅露 — ${isFullPage ? '全页标记' : '标记'}</span>
          <button class="truffle-editor-close" id="tr-close">&times;</button>
        </div>
        <div class="truffle-editor-body">
          <div class="truffle-editor-left">
            <div class="truffle-field">
              <label>来源</label>
              <div style="font-size:12px;color:#6B7280;word-break:break-all;">${escapeHtml(pageUrl)}</div>
            </div>
            <div class="truffle-field">
              <label>文档标题 <span class="required">*</span></label>
              <div class="truffle-title-row">
                <input type="text" id="tr-title" value="${escapeHtml(pageTitle)}" placeholder="输入标题（必填）">
                <button class="truffle-inline-ai-btn" id="tr-gen-title" title="AI生成标题">${SVGS.sparkle}<span>生成</span></button>
              </div>
            </div>
            <div class="truffle-field">
              <label>标签 <span class="hint">用逗号分隔</span></label>
              <div class="truffle-title-row">
                <input type="text" id="tr-tags" placeholder="AI, 产品, 思考">
                <button class="truffle-inline-ai-btn" id="tr-gen-tags" title="AI生成标签">${SVGS.tag}<span>生成</span></button>
              </div>
            </div>
            <div class="truffle-field">
              <label>分类</label>
              <div class="truffle-categories" id="tr-categories">
                ${allCategories.map((c, i) => `
                  <label class="truffle-category-chip ${i === allCategories.length - 1 ? 'active' : ''}" data-cat="${c}">
                    <input type="radio" name="category" value="${c}" ${i === allCategories.length - 1 ? 'checked' : ''}>
                    ${c}
                  </label>
                `).join('')}
                <button class="truffle-category-chip" id="tr-add-cat-btn">+ 添加标签</button>
              </div>
              <div class="truffle-category-custom" id="tr-custom-cat-wrap" style="display: none;">
                <input type="text" id="tr-custom-cat" placeholder="输入新分类名称...">
                <button id="tr-add-cat">确认添加</button>
              </div>
            </div>
            <div class="truffle-field">
              <label>摘录内容</label>
              <div class="truffle-excerpt-box">${escapeHtml(excerpt)}</div>
            </div>
            <div class="truffle-field truffle-ai-section">
              <div class="truffle-ai-label">AI 辅助（可多选，保存后后台生成）</div>
              <div class="truffle-ai-checkboxes">
                <label class="truffle-ai-check" data-ai="summary">
                  <input type="checkbox" value="summary">
                  <span>总结</span>
                </label>
                <label class="truffle-ai-check" data-ai="expansion">
                  <input type="checkbox" value="expansion">
                  <span>扩展阅读</span>
                </label>
                <label class="truffle-ai-check" data-ai="critique">
                  <input type="checkbox" value="critique">
                  <span>批判性思考</span>
                </label>
                <label class="truffle-ai-check" data-ai="translate">
                  <input type="checkbox" value="translate">
                  <span>翻译</span>
                </label>
              </div>
            </div>
          </div>
          <div class="truffle-editor-right">
            <div class="truffle-field" style="flex:1;display:flex;flex-direction:column;">
              <label>个人思考 <span class="hint">你的判断、质疑、共鸣</span></label>
              <div class="truffle-thoughts-wrap">
                <textarea id="tr-thoughts" placeholder="这段内容让你想到了什么？"></textarea>
                <div class="truffle-char-count" id="tr-char-count">0 字</div>
              </div>
            </div>
          </div>
        </div>
        <div class="truffle-editor-footer">
          <button class="truffle-btn-cancel" id="tr-cancel">取消</button>
          <button class="${saveBtnClass}" id="tr-save">${saveBtnText}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // 绑定事件
    bindEditorEvents(overlay, text, pageUrl, pageTitle);
  }

  function bindEditorEvents(overlay, text, url, pageTitle) {
    // 关闭
    overlay.querySelector('#tr-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#tr-cancel').addEventListener('click', () => overlay.remove());

    // 保存（根据激活状态决定行为）
    overlay.querySelector('#tr-save').addEventListener('click', () => {
      if (!isActivated) {
        chrome.runtime.sendMessage({ action: 'openOptionsPage' }).catch(() => {});
        return;
      }
      doSave(text, url, pageTitle);
    });

    // 字数统计
    const thoughtsArea = overlay.querySelector('#tr-thoughts');
    const charCount = overlay.querySelector('#tr-char-count');
    thoughtsArea.addEventListener('input', () => {
      const len = thoughtsArea.value.length;
      charCount.textContent = len + ' 字';
      charCount.className = 'truffle-char-count' + (len > 500 ? ' warning' : '') + (len > 1000 ? ' danger' : '');
    });

    // 分类点击
    overlay.querySelectorAll('.truffle-category-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        if (chip.id === 'tr-add-cat-btn') return; // 跳过添加按钮
        overlay.querySelectorAll('.truffle-category-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        chip.querySelector('input').checked = true;
      });
    });

    // 显示/隐藏自定义分类输入框
    const addCatBtn = overlay.querySelector('#tr-add-cat-btn');
    const customCatWrap = overlay.querySelector('#tr-custom-cat-wrap');
    if (addCatBtn) {
      addCatBtn.addEventListener('click', () => {
        const isHidden = customCatWrap.style.display === 'none' || customCatWrap.style.display === '';
        customCatWrap.style.display = isHidden ? 'flex' : 'none';
        if (isHidden) {
          setTimeout(() => customCatWrap.querySelector('input').focus(), 50);
        }
      });
    }

    // 自定义分类添加（持久化）
    const customInput = overlay.querySelector('#tr-custom-cat');
    overlay.querySelector('#tr-add-cat').addEventListener('click', async () => {
      const val = customInput.value.trim();
      if (!val) return;
      if (PRESET_CATEGORIES.includes(val) || customCategories.includes(val)) {
        alert('该分类已存在');
        return;
      }

      const container = overlay.querySelector('#tr-categories');
      const chip = document.createElement('label');
      chip.className = 'truffle-category-chip active';
      chip.dataset.cat = val;
      chip.innerHTML = `<input type="radio" name="category" value="${escapeHtml(val)}" checked>${escapeHtml(val)}`;
      container.querySelectorAll('.truffle-category-chip:not(#tr-add-cat-btn)').forEach(c => c.classList.remove('active'));
      container.insertBefore(chip, addCatBtn);
      chip.addEventListener('click', () => {
        overlay.querySelectorAll('.truffle-category-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        chip.querySelector('input').checked = true;
      });
      customInput.value = '';
      customCatWrap.style.display = 'none';

      // 持久化
      customCategories.push(val);
      await saveCustomCategories();
    });

    // AI 多选切换
    overlay.querySelectorAll('.truffle-ai-check').forEach(check => {
      check.addEventListener('click', () => {
        const cb = check.querySelector('input');
        cb.checked = !cb.checked;
        check.classList.toggle('checked', cb.checked);
      });
    });

    // 生成标题（轻量模型 — 强制 light）
    overlay.querySelector('#tr-gen-title').addEventListener('click', () => {
      if (!isActivated) {
        chrome.runtime.sendMessage({ action: 'openOptionsPage' }).catch(() => {});
        return;
      }
      runLightAI('title', text, (result) => {
        const input = overlay.querySelector('#tr-title');
        input.value = result;
        input.style.color = '#111827';
      });
    });

    // 生成标签（轻量模型 — 强制 light）
    overlay.querySelector('#tr-gen-tags').addEventListener('click', () => {
      if (!isActivated) {
        chrome.runtime.sendMessage({ action: 'openOptionsPage' }).catch(() => {});
        return;
      }
      runLightAI('tags', text, (result) => {
        const input = overlay.querySelector('#tr-tags');
        input.value = Array.isArray(result) ? result.join(', ') : result;
        input.style.color = '#111827';
      });
    });
  }

  // ===== 轻量 AI（标题/标签 — 快速直出，强制 light 模型）=====
  async function runLightAI(type, text, callback) {
    const btn = type === 'title'
      ? document.getElementById('tr-gen-title')
      : document.getElementById('tr-gen-tags');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span>生成中...</span>';
    btn.disabled = true;

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'callAI',
        data: { type, text: text.substring(0, 2000), options: { modelType: 'light' } },
      });

      if (response && response.success) {
        callback(response.result);
      } else {
        alert('生成失败：' + (response?.error || '未知错误'));
      }
    } catch (err) {
      alert('生成失败：' + err.message);
    } finally {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  }

  // ===== 保存 =====
  async function doSave(text, url, pageTitle) {
    const overlay = document.getElementById('truffle-inline-editor');
    const title = overlay.querySelector('#tr-title').value.trim();
    const thoughts = overlay.querySelector('#tr-thoughts').value.trim();
    const tags = overlay.querySelector('#tr-tags').value;
    const categoryEl = overlay.querySelector('.truffle-category-chip.active input');
    const category = categoryEl ? categoryEl.value : '其他';

    if (!title) {
      overlay.querySelector('#tr-title').focus();
      return;
    }

    const saveBtn = overlay.querySelector('#tr-save');
    saveBtn.textContent = '保存中...';
    saveBtn.disabled = true;

    // 检查勾选的 AI 类型
    const checkedAITypes = Array.from(overlay.querySelectorAll('.truffle-ai-check input:checked')).map(cb => cb.value);

    const date = new Date();
    const tagList = tags.split(/[,，\s]+/).filter(t => t.trim()).map(t => `"${t.trim()}"`);

    // Token 估算（基础输入，不含AI生成部分）
    const inputTokens = estimateTokens(text) + estimateTokens(thoughts) + estimateTokens(title);
    const totalTokens = inputTokens;

    const filename = `${date.toISOString().split('T')[0]}-${title.replace(/[^\w\u4e00-\u9fa5]/g, '-').substring(0, 30)}.md`;

    const markdown = `---
title: "${title.replace(/"/g, '\\"')}"
date: "${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}:${String(date.getSeconds()).padStart(2,'0')}"
source: "${url || location.href}"
source_title: "${(pageTitle || document.title).replace(/"/g, '\\"')}"
tags: [${tagList.join(', ')}]
category: "${category}"
estimated_tokens: ${checkedAITypes.length > 0 ? totalTokens : 0}
---

# ${title}

## 摘录内容

> ${text.replace(/\n/g, '\n> ').substring(0, 3000)}${text.length > 3000 ? '...' : ''}

## 个人思考

${thoughts || '(未填写)'}

---
*保存时间：${date.toLocaleString('zh-CN')}*
*插件版本：觅露 (Truffle) v1.4.1*
${checkedAITypes.length > 0 ? '\n*AI 分析：后台生成中...*' : ''}
`;

    try {
      const result = await chrome.runtime.sendMessage({
        action: 'saveMarkdown',
        data: {
          filename,
          content: markdown,
          doc: { sourceUrl: url || location.href, category },
        },
      });

      if (result && result.success) {
        // 如果有勾选了 AI，启动后台队列
        if (checkedAITypes.length > 0) {
          try {
            const clientJobId = ++localJobId;
            await chrome.runtime.sendMessage({
              action: 'startBackgroundAI',
              data: {
                filename,
                doc: { sourceUrl: url || location.href, category },
                types: checkedAITypes,
                text: text.substring(0, 4000),
                baseContent: markdown,
                clientJobId,
                baseTokens: totalTokens,
              },
            });
            showGlobalToast('✅ 已保存，AI分析后台进行中...');
            // 显示进度面板
            updateAIProgressItem(clientJobId, filename, 'running');
          } catch (bgErr) {
            console.error('[Truffle] startBackgroundAI error:', bgErr);
            showGlobalToast('✅ 已保存（AI后台启动失败）');
          }
        } else {
          showGlobalToast('✅ 已保存');
        }
        overlay.remove();
      } else if (result && result.fsaFailed) {
        // FSA 权限失效，提示用户
        if (confirm(result.error + '\n\n是否改用浏览器下载方式保存？')) {
          try {
            const fallbackResult = await chrome.runtime.sendMessage({
              action: 'saveMarkdown',
              data: {
                filename,
                content: markdown,
                doc: { sourceUrl: url || location.href },
                forceDownloads: true,
              },
            });
            if (fallbackResult && fallbackResult.success) {
              showGlobalToast('✅ 已保存到下载文件夹');
              overlay.remove();
            } else {
              alert('保存失败：' + (fallbackResult?.error || '未知错误'));
            }
          } catch (err2) {
            alert('保存失败：' + err2.message);
          }
        }
      } else {
        alert('保存失败：' + (result?.error || '未知错误'));
      }
    } catch (err) {
      if (err.message && err.message.includes('context invalidated')) {
        alert('扩展已重新加载，请刷新页面后重试');
      } else {
        alert('保存失败：' + err.message);
      }
    } finally {
      saveBtn.textContent = isActivated ? '保存到本地' : '去激活';
      saveBtn.disabled = false;
    }
  }

  // ===== 工具函数 =====
  function showGlobalToast(msg) {
    const t = document.createElement('div');
    t.className = 'truffle-global-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }
  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  // 平台检测
  function detectAIPlatform() {
    const host = location.hostname;
    if (host === 'doubao.com' || host.endsWith('.doubao.com')) return 'doubao';
    if (host === 'gemini.google.com') return 'gemini';
    if (host === 'chat.deepseek.com') return 'deepseek';
    if (host === 'kimi.moonshot.cn' || host === 'kimi.com' || host.endsWith('.kimi.com')) return 'kimi';
    if (host === 'yuanbao.tencent.com' || host.endsWith('.yuanbao.tencent.com')) return 'yuanbao';
    if (host === 'chatgpt.com' || host === 'chat.openai.com' || host.endsWith('.chatgpt.com')) return 'gpt';
    if (host === 'sider.ai' || host.endsWith('.sider.ai')) return 'sider';
    return null;
  }

  // 平台专用提取器
  const AI_EXTRACTORS = {
    doubao() {
      const msgs = [];
      document.querySelectorAll('div[data-message-id]').forEach(el => {
        const isUser = (el.className || '').includes('justify-end');
        const role = isUser ? 'user' : 'assistant';
        let text = '';
        if (isUser) {
          const bubble = el.querySelector('[class*="send-msg-bubble"]');
          text = bubble ? bubble.textContent : el.textContent;
        } else {
          const md = el.querySelector('.flow-markdown-body, .paragraph-element');
          text = md ? md.textContent : el.textContent;
        }
        const t = (text || '').trim();
        if (t) msgs.push({ role, text: t });
      });
      return msgs;
    },
    gemini() {
      const msgs = [];
      document.querySelectorAll('user-query').forEach(el => {
        const t = ((el.querySelector('.query-text') || el).textContent || '').trim();
        if (t) msgs.push({ role: 'user', text: t });
      });
      document.querySelectorAll('model-response').forEach(el => {
        const t = ((el.querySelector('.markdown-main-panel') || el).textContent || '').trim();
        if (t) msgs.push({ role: 'assistant', text: t });
      });
      return msgs;
    },
    deepseek() {
      const msgs = [];
      document.querySelectorAll('[data-virtual-list-item-key]').forEach(container => {
        const dsMsg = container.querySelector('.ds-message');
        if (!dsMsg) return;
        const userEl = dsMsg.querySelector('.fbb737a4');
        if (userEl) {
          const t = (userEl.textContent || '').trim();
          if (t) msgs.push({ role: 'user', text: t });
          return;
        }
        const aiEl = dsMsg.querySelector('.ds-markdown');
        if (aiEl) {
          const t = (aiEl.textContent || '').trim();
          if (t) msgs.push({ role: 'assistant', text: t });
        }
      });
      return msgs;
    },
    kimi() {
      const msgs = [];
      document.querySelectorAll('.chat-content-item.chat-content-item-user').forEach(el => {
        const t = ((el.querySelector('.user-content') || el).textContent || '').trim();
        if (t) msgs.push({ role: 'user', text: t });
      });
      document.querySelectorAll('.chat-content-item.chat-content-item-assistant').forEach(el => {
        const t = ((el.querySelector('.markdown') || el).textContent || '').trim();
        if (t) msgs.push({ role: 'assistant', text: t });
      });
      return msgs;
    },
    yuanbao() {
      const msgs = [];
      document.querySelectorAll('.agent-chat__list__item').forEach(el => {
        const speaker = el.getAttribute('data-conv-speaker');
        if (speaker === 'human') {
          const t = ((el.querySelector('.hyc-content-text') || el).textContent || '').trim();
          if (t) msgs.push({ role: 'user', text: t });
        } else if (speaker === 'ai') {
          const t = ((el.querySelector('.hyc-common-markdown') || el).textContent || '').trim();
          if (t) msgs.push({ role: 'assistant', text: t });
        }
      });
      return msgs;
    },
    gpt() {
      const msgs = [];
      document.querySelectorAll('section[data-turn]').forEach(turn => {
        const role = turn.getAttribute('data-turn');
        if (role === 'user') {
          const t = ((turn.querySelector('.whitespace-pre-wrap') || turn).textContent || '').trim();
          if (t) msgs.push({ role: 'user', text: t });
        } else if (role === 'assistant') {
          const t = ((turn.querySelector('.markdown') || turn).textContent || '').trim();
          if (t) msgs.push({ role: 'assistant', text: t });
        }
      });
      return msgs;
    },
    sider() {
      const msgs = [];
      document.querySelectorAll('.message-item-outer[data-id]').forEach(el => {
        const userInput = el.querySelector('.user-input-text');
        const isUser = el.querySelector('.flex.flex-row-reverse') !== null;
        const aiMarkdown = el.querySelector('.markdown-body');
        const isAssistant = el.querySelector('.role-icon-box') !== null || el.querySelector('.answer-markdown-box') !== null;
        if (isUser && userInput) {
          const t = (userInput.textContent || '').trim();
          if (t) msgs.push({ role: 'user', text: t });
        } else if (isAssistant) {
          const t = (aiMarkdown ? aiMarkdown.textContent : el.textContent || '').trim();
          if (t) msgs.push({ role: 'assistant', text: t });
        }
      });
      return msgs;
    },
  };

  function extractPageContent() {
    const platform = detectAIPlatform();
    if (platform && AI_EXTRACTORS[platform]) {
      const msgs = AI_EXTRACTORS[platform]();
      if (msgs.length > 0) {
        const textContent = msgs.map(m => `**${m.role === 'user' ? '用户' : 'AI'}**: ${m.text}`).join('\n\n');
        return {
          title: document.title,
          textContent: textContent,
          url: location.href,
          excerpt: msgs[0].text.substring(0, 300),
          author: '',
          siteName: location.hostname.replace(/^www\./, ''),
          isAIPage: true,
          platform: platform,
        };
      }
    }
    
    // 回退到 ReadabilityLite
    let result;
    if (typeof ReadabilityLite !== 'undefined' && ReadabilityLite.extract) {
      try { result = ReadabilityLite.extract(document); } catch(e){ result = null; }
    }
    if (!result) {
      const clone = document.body.cloneNode(true);
      clone.querySelectorAll('script, style, nav, header, footer, aside, iframe').forEach(el => el.remove());
      result = {
        title: document.title,
        textContent: clone.innerText || document.body.innerText,
        excerpt: (clone.innerText || '').substring(0, 300),
        byline: '',
        siteName: location.hostname.replace(/^www\./, ''),
      };
    }
    return {
      title: result.title || document.title,
      textContent: result.textContent || result.content || document.body.innerText,
      url: location.href,
      excerpt: result.excerpt || '',
      author: result.byline || '',
      siteName: result.siteName || location.hostname,
      isAIPage: false,
      platform: null,
    };
  }
})();