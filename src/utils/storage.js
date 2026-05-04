// ============================================
// 觅露 (Truffle) — 存储管理模块
// 所有配置和状态通过 chrome.storage 持久化
// ============================================

const Storage = {
  // 获取单个值
  async get(key, defaultValue = null) {
    try {
      const result = await chrome.storage.local.get(key);
      return result[key] !== undefined ? result[key] : defaultValue;
    } catch (e) {
      console.error('[Truffle Storage] get error:', e);
      return defaultValue;
    }
  },

  // 设置单个值
  async set(key, value) {
    try {
      await chrome.storage.local.set({ [key]: value });
      return true;
    } catch (e) {
      console.error('[Truffle Storage] set error:', e);
      return false;
    }
  },

  // 获取多个值
  async getMulti(keys) {
    try {
      return await chrome.storage.local.get(keys);
    } catch (e) {
      console.error('[Truffle Storage] getMulti error:', e);
      return {};
    }
  },

  // 设置多个值
  async setMulti(data) {
    try {
      await chrome.storage.local.set(data);
      return true;
    } catch (e) {
      console.error('[Truffle Storage] setMulti error:', e);
      return false;
    }
  },

  // 获取配置（结构化读取）
  async getConfig() {
    const defaults = {
      savePath: '',           // 本地保存路径（File System Access句柄序列化后存储）
      useDownloadsFallback: true,  // 是否使用downloads API作为fallback
      apiProvider: 'moonshot', // 默认AI提供商
      apiKey: '',             // API Key（加密存储）
      apiBaseUrl: '',         // 自定义API基础URL
      apiModel: 'moonshot-v1-8k', // 默认模型
      kimiCodingKey: '',      // Kimi Coding API Key（独立）
      kimiCodingModel: 'kimi-k2.6',
      aiEnabled: true,        // 是否启用AI功能
      autoGenerateTitle: true, // 是否自动生成标题
      autoGenerateTags: true,  // 是否自动生成标签
      floatingToolbar: true,   // 是否启用悬浮窗
      shortcutKey: 'Alt+Shift+C',
      folderStructure: 'flat', // flat | byDate | byDomain
      template: 'default',    // Markdown模板
      activationCode: '',     // 激活码
      isActivated: false,     // 是否已激活
    };
    const stored = await this.getMulti(Object.keys(defaults));
    return { ...defaults, ...stored };
  },

  // 保存配置
  async saveConfig(config) {
    return await this.setMulti(config);
  },

  // 保存 File System Access 目录句柄（需要IndexedDB，chrome.storage无法存储对象句柄）
  async saveDirectoryHandle(handle) {
    try {
      // 使用 IndexedDB 存储 FileSystemDirectoryHandle
      return new Promise((resolve, reject) => {
        const request = indexedDB.open('TruffleDB', 1);
        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('handles')) {
            db.createObjectStore('handles', { keyPath: 'id' });
          }
        };
        request.onsuccess = (e) => {
          const db = e.target.result;
          const tx = db.transaction('handles', 'readwrite');
          const store = tx.objectStore('handles');
          store.put({ id: 'saveDirectory', handle });
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.error('[Truffle Storage] saveDirectoryHandle error:', e);
      return false;
    }
  },

  // 读取 File System Access 目录句柄
  async getDirectoryHandle() {
    try {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open('TruffleDB', 1);
        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('handles')) {
            db.createObjectStore('handles', { keyPath: 'id' });
          }
        };
        request.onsuccess = (e) => {
          const db = e.target.result;
          const tx = db.transaction('handles', 'readonly');
          const store = tx.objectStore('handles');
          const getReq = store.get('saveDirectory');
          getReq.onsuccess = () => resolve(getReq.result?.handle || null);
          getReq.onerror = () => reject(getReq.error);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.error('[Truffle Storage] getDirectoryHandle error:', e);
      return null;
    }
  },

  // 缓存输入状态（防止Service Worker被kill导致数据丢失）
  async cacheInputState(state) {
    return await this.set('inputCache', { ...state, timestamp: Date.now() });
  },

  // 恢复输入状态
  async restoreInputState() {
    const cache = await this.get('inputCache');
    if (cache && Date.now() - cache.timestamp < 30 * 60 * 1000) { // 30分钟内有效
      return cache;
    }
    return null;
  },

  // 清除输入缓存
  async clearInputCache() {
    await chrome.storage.local.remove('inputCache');
  },

  // 历史记录
  async addHistory(entry) {
    const history = await this.get('clipHistory', []);
    history.unshift({ ...entry, id: Date.now().toString(36) });
    if (history.length > 500) history.pop(); // 最多保留500条
    return await this.set('clipHistory', history);
  },

  async getHistory(limit = 50) {
    const history = await this.get('clipHistory', []);
    return history.slice(0, limit);
  },
};

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Storage };
}
