// ============================================
// 觅露 (Truffle) — Options Page 逻辑
// 配置管理 + 激活码验证
// ============================================

(function() {
  'use strict';

  // DOM引用
  const $ = (id) => document.getElementById(id);

  let currentProvider = 'moonshot';

  // 初始化
  async function init() {
    // 加载配置
    const config = await Storage.getConfig();
    loadConfigToUI(config);

    // 检查激活状态
    updateActivationUI(config.isActivated);

    // 绑定事件
    bindEvents();
  }

  function bindEvents() {
    // Provider Tab切换
    document.querySelectorAll('.provider-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const provider = tab.dataset.provider;
        switchProvider(provider);
      });
    });

    // 激活码
    $('activate-btn').addEventListener('click', handleActivation);

    // 测试按钮
    $('test-moonshot-btn').addEventListener('click', () => testApiConnection('moonshot'));
    $('test-kimi-coding-btn').addEventListener('click', () => testApiConnection('kimiCoding'));
    $('test-custom-btn').addEventListener('click', () => testApiConnection('custom'));

    // 保存配置
    $('save-config-btn').addEventListener('click', saveConfig);

    // 恢复默认
    $('reset-btn').addEventListener('click', resetConfig);

    // 选择文件夹按钮
    if ($('select-dir-btn')) {
      $('select-dir-btn').addEventListener('click', selectDirectory);
    }
  }

  function switchProvider(provider) {
    currentProvider = provider;

    // 更新Tab状态
    document.querySelectorAll('.provider-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.provider === provider);
    });

    // 显示对应面板
    document.querySelectorAll('.provider-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `panel-${provider}`);
    });
  }

  // 加载配置到UI
  function loadConfigToUI(config) {
    // 文件夹组织方式（单选按钮）
    const structure = config.folderStructure || 'flat';
    $(`folder-${structure}`).checked = true;

    // AI配置
    $('moonshot-key').value = config.apiKey || '';
    $('moonshot-model').value = config.apiModel || 'kimi-k2.5';
    $('kimi-coding-key').value = config.kimiCodingKey || '';
    $('kimi-coding-model').value = config.kimiCodingModel || 'kimi-k2.6';
    $('custom-base-url').value = config.apiBaseUrl || '';
    $('custom-key').value = ''; // 安全考虑，不显示已保存的key
    $('custom-model').value = config.apiModel || '';

    // 开关
    $('ai-enabled').checked = config.aiEnabled;
    $('auto-title').checked = config.autoGenerateTitle;
    $('auto-tags').checked = config.autoGenerateTags;

    // Provider
    switchProvider(config.apiProvider || 'moonshot');
  }

  // 保存配置
  async function saveConfig() {
    const config = {
      useDownloadsFallback: false,
      folderStructure: document.querySelector('input[name="folder-structure"]:checked')?.value || 'flat',
      aiEnabled: $('ai-enabled').checked,
      autoGenerateTitle: $('auto-title').checked,
      autoGenerateTags: $('auto-tags').checked,
      apiProvider: currentProvider,
    };

    // 根据当前provider保存对应的key
    if (currentProvider === 'moonshot') {
      const key = $('moonshot-key').value.trim();
      if (key) config.apiKey = key;
      config.apiModel = $('moonshot-model').value;
      config.baseUrl = 'https://api.moonshot.cn/v1';
    } else if (currentProvider === 'kimiCoding') {
      const key = $('kimi-coding-key').value.trim();
      if (key) config.kimiCodingKey = key;
      config.kimiCodingModel = $('kimi-coding-model').value;
      config.apiKey = key; // 使用coding key作为主key（需要时切换）
      config.baseUrl = 'https://api.kimi.com/coding/v1';
    } else if (currentProvider === 'custom') {
      const key = $('custom-key').value.trim();
      if (key) config.apiKey = key;
      config.apiBaseUrl = $('custom-base-url').value.trim();
      config.apiModel = $('custom-model').value.trim();
    }

    await Storage.saveConfig(config);
    showToast('✅ 设置已保存');
  }

  // 恢复默认
  async function resetConfig() {
    if (!confirm('确定要恢复所有默认设置吗？')) return;
    await chrome.storage.local.clear();
    showToast('已恢复默认，请刷新页面');
  }

  // 选择目录
  async function selectDirectory() {
    try {
      if (!('showDirectoryPicker' in window)) {
        alert('当前浏览器不支持 File System Access API\n请使用 Chrome 或 Edge 浏览器');
        return;
      }

      // 一步请求读写权限（避免单独的 requestPermission 可能失效）
      const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });

      // 验证权限
      const options = { mode: 'readwrite' };
      if ((await dirHandle.queryPermission(options)) !== 'granted') {
        if ((await dirHandle.requestPermission(options)) !== 'granted') {
          throw new Error('未获得文件夹写入权限');
        }
      }

      await Storage.saveDirectoryHandle(dirHandle);

      $('dir-note').textContent = `已选择：${dirHandle.name}`;

      await Storage.set('useDownloadsFallback', false);
      showToast('✅ 保存文件夹已设置');
    } catch (error) {
      if (error.name === 'AbortError') {
        // 用户取消了选择，不做处理
        return;
      }
      console.error('[Truffle] selectDirectory error:', error);
      alert('选择文件夹失败：' + error.message);
      $('dir-note').textContent = '未选择保存文件夹';
    }
  }

  // 激活码处理
  async function handleActivation() {
    const code = $('activation-code').value.trim().toUpperCase();
    if (!code) {
      alert('请输入激活码');
      return;
    }

    const valid = validateActivationCode(code);
    if (valid) {
      await Storage.set('isActivated', true);
      await Storage.set('activationCode', code);
      updateActivationUI(true);
      showToast('✅ 激活成功！');
    } else {
      alert('激活码无效，请联系开发者获取');
    }
  }

  // 激活码校验（简单校验和算法）
  function validateActivationCode(code) {
    if (!code || code.length < 6) return false;

    // 计算校验和
    let sum = 0;
    for (let i = 0; i < code.length; i++) {
      sum += code.charCodeAt(i);
    }
    const checksum = sum % 1000;

    // 校验规则：校验和能被7整除且大于100
    return checksum % 7 === 0 && checksum > 100;
  }

  // 更新激活UI
  function updateActivationUI(isActivated) {
    const box = $('activation-box');
    const status = $('activation-status');

    if (isActivated) {
      box.classList.add('activated');
      status.innerHTML = '<span class="status-dot active"></span><span>已激活</span>';
      $('activation-code').style.display = 'none';
      $('activate-btn').style.display = 'none';
      $('activation-hint').textContent = '感谢使用觅露 (Truffle)';
    }
  }

  // API 连接测试
  async function testApiConnection(provider) {
    const resultMap = {
      moonshot: 'test-moonshot-result',
      kimiCoding: 'test-kimi-coding-result',
      custom: 'test-custom-result',
    };
    const resultEl = $(resultMap[provider]);
    resultEl.textContent = '测试中...';
    resultEl.style.color = '#6366F1';
    resultEl.style.marginLeft = '10px';
    resultEl.style.fontSize = '13px';
    resultEl.style.verticalAlign = 'middle';

    // 先保存当前配置
    const currentProvider = provider;
    let apiKey, baseUrl, model;

    if (provider === 'moonshot') {
      apiKey = $('moonshot-key').value.trim();
      baseUrl = 'https://api.moonshot.cn/v1';
      model = $('moonshot-model').value;
    } else if (provider === 'kimiCoding') {
      apiKey = $('kimi-coding-key').value.trim();
      baseUrl = 'https://api.kimi.com/coding/v1';
      model = $('kimi-coding-model').value;
    } else {
      apiKey = $('custom-key').value.trim();
      baseUrl = $('custom-base-url').value.trim();
      model = $('custom-model').value.trim();
    }

    if (!apiKey) {
      resultEl.textContent = '❌ 请先输入 API Key';
      resultEl.style.color = '#DC2626';
      return;
    }
    if (!baseUrl) {
      resultEl.textContent = '❌ 请先输入 Base URL';
      resultEl.style.color = '#DC2626';
      return;
    }

    // 调用 background 的 validateApiKey
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'validateApiKey',
        data: { provider, apiKey, baseUrl, model },
      });

      if (response && response.valid) {
        resultEl.textContent = '✅ 连接成功';
        resultEl.style.color = '#10B981';
      } else {
        resultEl.textContent = '❌ ' + (response?.error || '连接失败');
        resultEl.style.color = '#DC2626';
      }
    } catch (err) {
      resultEl.textContent = '❌ ' + err.message;
      resultEl.style.color = '#DC2626';
    }
  }

  // Toast
  function showToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #1F2937;
      color: white;
      padding: 10px 18px;
      border-radius: 6px;
      font-size: 14px;
      z-index: 10000;
      animation: truffle-toast-in 0.2s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }

  // 启动
  init();
})();