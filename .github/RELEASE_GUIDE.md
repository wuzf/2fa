# Release 构建和发布指南

本文档说明如何创建 Release、构建单文件 Worker，以及如何使用 Release 文件部署。

## 📦 什么是 Release？

每次创建 Release 时，GitHub Actions 会自动：

1. ✅ 运行所有测试确保代码质量
2. ✅ 构建压缩版 `worker.js` - 生产环境使用
3. ✅ 构建调试版 `worker.debug.js` - 调试用
4. ✅ 生成元数据文件 `worker.metadata.json`
5. ✅ 创建部署说明 `DEPLOY.md`
6. ✅ 生成文件校验和（SHA256）
7. ✅ 打包所有文件为 `2fa-release.zip`
8. ✅ 创建 GitHub Release 并上传所有文件

## 🚀 创建 Release

### 方法 1: 推送标签（推荐）

```bash
# 步骤 1: 确保代码已提交
git add .
git commit -m "Ready for release v1.0.0"

# 步骤 2: 更新 package.json 版本号（可选）
npm version patch   # 1.0.0 → 1.0.1
npm version minor   # 1.0.0 → 1.1.0
npm version major   # 1.0.0 → 2.0.0

# 步骤 3: 创建标签
git tag -a v1.0.0 -m "Release v1.0.0

主要变更：
- 添加新功能 A
- 修复 Bug B
- 性能优化 C"

# 步骤 4: 推送标签触发 Release
git push origin v1.0.0
```

### 方法 2: 手动触发

1. 访问 `https://github.com/wuzf/2fa/actions`
2. 选择 "Create Release" 工作流
3. 点击 "Run workflow"
4. 输入版本号（例如：`v1.0.0`）
5. 点击绿色的 "Run workflow" 按钮

### 方法 3: 通过 GitHub Web 界面

1. 访问 `https://github.com/wuzf/2fa/releases`
2. 点击 "Draft a new release"
3. 点击 "Choose a tag" → 输入新标签（例如：`v1.0.0`）
4. 填写 Release 标题和说明
5. 点击 "Publish release"

**注意**：使用此方法时，GitHub Actions 仍会自动构建和上传文件。

## 📥 Release 文件说明

每个 Release 包含以下文件：

### 1. worker.js（生产环境推荐）

**特点**：
- ✅ 已压缩优化，体积小
- ✅ 加载速度快
- ✅ 适合生产部署

**使用场景**：
- 正式环境部署
- 最终用户使用

### 2. worker.debug.js（开发调试用）

**特点**：
- 🔍 未压缩，保留完整代码结构
- 🐛 包含所有变量名和注释
- 📚 代码可读性高

**使用场景**：
- 本地调试
- 问题排查
- 学习源码

### 3. worker.metadata.json（元数据）

**包含信息**：
```json
{
  "name": "2fa",
  "version": "1.0.0",
  "author": "wuzf",
  "license": "MIT",
  "buildDate": "2025-01-04T12:00:00.000Z",
  "minified": true,
  "fileSizeKB": 245.67,
  "repository": "https://github.com/wuzf/2fa"
}
```

### 4. DEPLOY.md（部署说明）

完整的部署指南，包括：
- 部署步骤
- 环境配置
- KV Namespace 设置
- 安全建议

### 5. *.sha256（校验和）

用于验证文件完整性：

```bash
# Linux/Mac
sha256sum -c worker.js.sha256

# Windows PowerShell
$hash = Get-FileHash worker.js -Algorithm SHA256
$expected = Get-Content worker.js.sha256
if ($hash.Hash -eq $expected.Split()[0]) {
    Write-Host "✅ 校验成功"
} else {
    Write-Host "❌ 校验失败"
}
```

### 6. 2fa-release.zip（完整包）

包含上述所有文件的压缩包，方便一次性下载。

## 🛠️ 本地构建（测试用）

如果你想在本地测试构建过程：

```bash
# 安装依赖
npm install

# 构建未压缩版本
npm run build

# 构建压缩版本（推荐）
npm run build:minify

# 自定义输出路径
npm run build -- --output=custom-path/worker.js

# 查看构建结果
ls -lh dist/
cat dist/worker.metadata.json
```

**输出目录**：`dist/`

**注意**：本地构建的文件不会自动上传到 GitHub Release。

## 📤 使用 Release 文件部署

### 方法 1: Cloudflare Dashboard（最简单）

**步骤**：

1. **下载 worker.js**
   - 访问 `https://github.com/wuzf/2fa/releases/latest`
   - 下载 `worker.js` 文件

2. **登录 Cloudflare**
   - 访问 https://dash.cloudflare.com/
   - 进入 "Workers & Pages"

3. **创建 Worker**
   - 点击 "Create application" → "Create Worker"
   - 给 Worker 命名（例如：`2fa`）
   - 点击 "Deploy"

4. **编辑代码**
   - 点击 "Edit Code"
   - 删除默认代码
   - 打开下载的 `worker.js`，全选并复制
   - 粘贴到编辑器中
   - 点击 "Save and Deploy"

5. **配置 KV**（见下文"配置 KV Namespace"）

### 方法 2: Wrangler CLI

**前提条件**：
- 已安装 Node.js
- 已安装 Wrangler CLI

**步骤**：

```bash
# 1. 安装 Wrangler（如果未安装）
npm install -g wrangler

# 2. 登录 Cloudflare
wrangler login

# 3. 下载 worker.js
# 访问 GitHub Release 页面下载

# 4. 部署
wrangler deploy worker.js --name 2fa

# 5. 配置 KV（见下文）
```

### 方法 3: 使用 wrangler.toml

创建 `wrangler.toml` 文件：

```toml
name = "2fa"
main = "worker.js"
compatibility_date = "2025-01-01"

[[kv_namespaces]]
binding = "SECRETS_KV"
id = "your-kv-namespace-id"
```

然后部署：

```bash
wrangler deploy
```

## ⚙️ 配置 KV Namespace

### 使用 Dashboard

1. 在 Cloudflare Dashboard 中
2. 进入 "Workers & Pages" → "KV"
3. 点击 "Create namespace"
4. 命名：`2FA_SECRETS`
5. 复制 Namespace ID
6. 返回 Worker 设置
7. 选择 "Settings" → "Variables"
8. 点击 "Add binding"
   - Variable name: `SECRETS_KV`
   - KV namespace: 选择刚创建的 namespace
9. 点击 "Save"

### 使用 Wrangler

```bash
# 1. 创建 KV Namespace
wrangler kv:namespace create SECRETS_KV

# 2. 记录输出的 Namespace ID
# 输出示例：
# ✨ Success! Created KV namespace SECRETS_KV
# id = "abc123def456"

# 3. 绑定到 Worker
wrangler secret put SECRETS_KV --binding SECRETS_KV --id abc123def456
```

## 🔐 配置加密密钥（推荐）

### 生成密钥

```bash
# 使用 Node.js 生成 32 字节密钥
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 输出示例：
# vK8xJ2mN5pQ7sT9uVwXyZaBcDeFgHiJkLmNoPqRsTuV=
```

### 设置密钥

**使用 Dashboard**：
1. Worker 设置 → "Variables"
2. 点击 "Add variable"
3. Variable name: `ENCRYPTION_KEY`
4. Type: "Secret"（切换到 "Encrypt"）
5. 粘贴生成的密钥
6. 点击 "Save"

**使用 Wrangler**：
```bash
wrangler secret put ENCRYPTION_KEY
# 提示时粘贴生成的密钥
```

## 🧪 验证部署

部署完成后，访问你的 Worker URL：

```
https://2fa.your-account.workers.dev
```

**首次访问**：
- 会提示设置访问密码
- 设置密码后即可开始使用

**功能测试**：
1. ✅ 添加一个测试用的 2FA 密钥
2. ✅ 验证 OTP 生成是否正常
3. ✅ 测试导出备份功能
4. ✅ 测试还原功能

## 📊 监控 Release

### 查看 Release 构建状态

1. 访问 `https://github.com/wuzf/2fa/actions`
2. 找到 "Create Release" 工作流
3. 点击最新的运行查看详情
4. 查看各步骤的日志

### Release 构建失败？

**常见原因**：
1. 测试未通过 → 检查测试日志
2. 构建脚本错误 → 检查 build 步骤日志
3. 文件上传失败 → 检查网络和权限

**解决步骤**：
1. 查看 Actions 日志找出错误
2. 修复问题并提交代码
3. 删除失败的 tag：`git tag -d v1.0.0 && git push origin :refs/tags/v1.0.0`
4. 重新创建 tag 触发构建

## 🔄 更新现有部署

当有新版本 Release 时：

### Dashboard 更新

1. 下载新版本的 `worker.js`
2. 登录 Cloudflare Dashboard
3. 进入你的 Worker
4. 点击 "Edit Code"
5. 全选并删除旧代码
6. 粘贴新版本代码
7. 点击 "Save and Deploy"

### Wrangler 更新

```bash
# 下载新版本 worker.js 后
wrangler deploy worker.js
```

**注意**：
- ✅ 更新不会影响现有数据
- ✅ KV 中的密钥和设置会保留
- ⚠️ 建议更新前先导出备份

## 📝 版本管理建议

### 语义化版本

使用 [语义化版本](https://semver.org/lang/zh-CN/)：

- **MAJOR.MINOR.PATCH**
- 例如：v1.2.3

**何时递增**：
- `PATCH`: Bug 修复 (1.0.0 → 1.0.1)
- `MINOR`: 新增功能，向后兼容 (1.0.0 → 1.1.0)
- `MAJOR`: 不兼容的变更 (1.0.0 → 2.0.0)

### Release 命名

**推荐格式**：
```
v1.0.0 - 2FA Manager 首次正式版
v1.1.0 - 添加离线支持
v1.1.1 - 修复 iPad 样式问题
v2.0.0 - 重构架构，API 变更
```

### 标签说明模板

```bash
git tag -a v1.0.0 -m "Release v1.0.0 - 功能完善版

新增功能：
- ✨ 添加离线数据修改支持
- ✨ 实现 Background Sync 自动同步
- 🎨 优化 iPad 界面布局

Bug 修复：
- 🐛 修复备份下拉框宽度问题
- 🐛 修复下拉选项换行问题

其他改进：
- 📝 完善部署文档
- 🚀 优化构建流程
- ✅ 增加 GitHub Actions 支持"
```

## 🆘 常见问题

### Q: Release 构建失败怎么办？

A: 查看 Actions 日志，根据错误信息修复，然后删除失败的 tag 重新创建。

### Q: 如何删除错误的 Release？

A:
```bash
# 删除本地 tag
git tag -d v1.0.0

# 删除远程 tag
git push origin :refs/tags/v1.0.0

# 在 GitHub 上删除 Release
# 访问 Releases 页面，点击对应 Release 的 "Delete" 按钮
```

### Q: worker.js 太大怎么办？

A:
1. 检查是否误打包了不必要的依赖
2. 使用压缩版本（`npm run build:minify`）
3. Cloudflare Workers 限制为 1MB，正常情况下不会超过

### Q: 本地构建和 GitHub Actions 构建有什么区别？

A:
- 本地构建：用于测试，文件保存在本地 `dist/` 目录
- GitHub Actions 构建：自动化，创建 Release 并上传到 GitHub

### Q: 可以跳过测试直接构建 Release 吗？

A: 不推荐。可以修改 `.github/workflows/release.yml`，但这会降低代码质量保障。

## 📚 相关文档

- [GitHub Actions 配置说明](./README.md)
- [GitHub Actions 配置说明](./ACTIONS_GUIDE.md)
- [贡献指南](./CONTRIBUTING.md)
- [部署文档](../docs/DEPLOYMENT.md)

---

🎉 **恭喜！你已掌握 Release 的创建和使用方法！**
