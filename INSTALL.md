# 觅露 (Truffle) — 安装指南

## 快速安装（Chrome/Edge）

### 步骤 1：下载代码
将项目文件夹保存到本地任意位置。

### 步骤 2：打开开发者模式
1. 在 Chrome/Edge 地址栏输入：`chrome://extensions/`
2. 打开右上角「开发者模式」开关

### 步骤 3：加载扩展
1. 点击「加载已解压的扩展程序」
2. 选择觅露项目的根目录（包含 `manifest.json` 的文件夹）
3. 扩展将出现在扩展列表中

### 步骤 4：固定扩展图标
1. 点击浏览器工具栏的「扩展」拼图图标
2. 找到「觅露 (Truffle)」
3. 点击「固定」图钉图标

### 步骤 5：首次配置
1. 点击固定的觅露图标 → 打开设置页面
2. 输入**激活码**
3. （可选）配置 AI API Key
4. （可选）选择保存文件夹

## 配置 AI（可选）

### Moonshot (Kimi)
1. 访问 [platform.moonshot.cn](https://platform.moonshot.cn)
2. 注册并创建 API Key
3. 在觅露设置中粘贴 Key

### Kimi Coding API
1. 访问 [api.kimi.com](https://api.kimi.com)
2. 获取 Coding API Key（注意：与普通 API Key 不互通）
3. 在觅露设置中选择「Kimi Coding」标签页

## 使用技巧

### 设置保存目录
- **方式 A（推荐）**：设置 → 选择「File System Access」→ 选择 Obsidian Vault 或其他文件夹
- **方式 B**：使用浏览器下载文件夹，然后在 Chrome 设置中将下载目录改为你的知识库路径

### 与 Obsidian 配合
1. 将保存目录设为 Obsidian Vault 中的某个文件夹（如 `Clippings/`）
2. 觅露保存的 Markdown 文件会自动出现在 Obsidian 中
3. YAML Frontmatter 中的 tags 可被 Obsidian 识别

### 快捷键修改
1. 访问 `chrome://extensions/shortcuts`
2. 找到「觅露 (Truffle)」
3. 修改「唤起全页标记」的快捷键

## 常见问题

**Q: 悬浮窗没有出现？**
A: 确保当前页面不是 PDF 文件。PDF 页面暂不支持。刷新页面后再试。

**Q: 保存后文件在哪里？**
A: 如果使用「浏览器下载」模式，文件在 Chrome 的下载文件夹中。如果使用「File System Access」模式，文件在你选择的文件夹中。

**Q: AI 功能不工作？**
A: 检查设置中的 API Key 是否正确。注意 Kimi Coding API Key 与普通 API Key 是不同的，需要分别配置。

**Q: 如何导出已有数据？**
A: 所有数据已以 Markdown 格式保存在本地，直接复制文件即可。
