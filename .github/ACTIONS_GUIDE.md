# GitHub Actions 配置说明

本项目已配置 GitHub Actions 自动化工作流，用于持续集成（CI）和持续部署（CD）。

## 目录

- [快速参考](#-快速参考)
- [目录结构](#-目录结构)
- [工作流说明](#-工作流说明)
- [Secrets 配置](#-必需的-secrets-配置)
- [配置步骤](#-配置步骤)
- [使用方法](#-使用方法)
- [常用命令](#-常用命令)
- [监控和日志](#-监控和日志)
- [自定义配置](#-自定义配置)
- [常见问题](#-常见问题)
- [参考资源](#-参考资源)

---

## 🎯 快速参考

### 工作流触发条件一览

| 工作流 | 触发条件 |
|--------|---------|
| CI (ci.yml) | Push 到 `main`/`develop`，PR 到 `main`/`develop` |
| 部署 (deploy.yml) | Push 到 `main`（自动部署生产），Push tag `v*`（版本发布），手动触发 |
| Release (release.yml) | Push tag `v*`，手动触发（指定版本号） |
| Stale (stale.yml) | 每天 UTC 00:00（北京时间 08:00），手动触发 |

### Git 操作速查

```bash
# 创建功能分支
git checkout -b feature/your-feature

# 提交代码
git add .
git commit -m "feat: 添加新功能"
git push origin feature/your-feature

# 创建版本标签
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0
```

---

## 📋 目录结构

```
.github/
├── workflows/
│   ├── ci.yml           # 持续集成工作流
│   ├── deploy.yml       # 持续部署工作流
│   ├── release.yml      # Release 发布工作流
│   └── stale.yml        # 过期 Issue/PR 管理
├── ISSUE_TEMPLATE/      # Issue 模板
│   ├── bug_report.md    # Bug 报告模板
│   ├── feature_request.md # 功能请求模板
│   ├── question.md      # 问题疑问模板
│   └── config.yml       # Issue 配置
├── dependabot.yml       # Dependabot 配置
└── PULL_REQUEST_TEMPLATE.md # PR 模板
```

## 🔄 工作流说明

### 1. CI 工作流 (ci.yml)

**触发条件**：
- 推送到 `main` 或 `develop` 分支
- 创建针对 `main` 或 `develop` 分支的 Pull Request

**包含任务**：
- ✅ **测试**: 在 Node.js 18.x 和 20.x 上运行测试
- 📊 **代码覆盖率**: 生成测试覆盖率报告并上传到 Codecov
- 🔍 **代码检查**: 代码风格检查（可扩展 ESLint/Prettier）
- 🏗️ **构建验证**: 验证构建脚本是否正常工作
- 🔒 **安全审计**: 运行 npm audit 检查依赖漏洞

### 2. 部署工作流 (deploy.yml)

**触发条件**：
- 推送到 `main` 分支（自动部署到生产环境）
- 推送 `v*` 标签（版本发布）
- 手动触发（可选择部署环境）

**部署流程**：
1. 运行测试确保代码质量
2. 生成版本号（基于 Git commit 或 tag）
3. 部署到 Cloudflare Workers
4. 生成部署摘要
5. 发送部署状态通知

### 3. Release 工作流 (release.yml)

**触发条件**：
- 推送 `v*` 标签（例如：v1.0.0）
- 手动触发（指定版本号）

**Release 流程**：
1. 运行测试确保代码质量
2. 构建压缩版和调试版 Worker 文件
3. 生成文件校验和（SHA256）
4. 创建 Release 压缩包
5. 创建 GitHub Release 并上传所有文件
6. 生成 Release 说明和部署文档

**生成的文件**：
- `worker.js` - 压缩优化版（推荐用于生产环境）
- `worker.debug.js` - 未压缩调试版（便于调试）
- `worker.metadata.json` - 构建元数据
- `DEPLOY.md` - 部署说明文档
- `*.sha256` - 文件校验和
- `2fa-release.zip` - 完整 Release 包

### 4. Dependabot 自动更新

**配置内容**：
- 📦 **npm 依赖**: 每周一检查并创建更新 PR
- 🔧 **GitHub Actions**: 自动更新工作流中使用的 Actions 版本
- 🏷️ **自动标签**: 自动添加 `dependencies` 和 `automated` 标签
- 👥 **自动分配**: 自动分配给项目维护者

## 🔐 必需的 Secrets 配置

在 GitHub 仓库设置中配置以下 Secrets：

```
Settings → Secrets and variables → Actions → New repository secret
```

### Cloudflare 相关

| Secret 名称 | 说明 | 获取方式 |
|------------|------|---------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token | [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens) → Create Token → Edit Cloudflare Workers |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID | Cloudflare Dashboard → Workers & Pages → Overview → Account ID |

### 可选 Secrets

| Secret 名称 | 说明 | 用途 |
|------------|------|------|
| `CODECOV_TOKEN` | Codecov Token | 上传代码覆盖率报告 |
| `ENCRYPTION_KEY` | AES-GCM 加密密钥 | Workers 环境变量（也可以在 Cloudflare 中配置） |

## 📝 配置步骤

### 1. 获取 Cloudflare API Token

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 "My Profile" → "API Tokens"
3. 点击 "Create Token"
4. 使用 "Edit Cloudflare Workers" 模板
5. 配置权限：
   - Account: Workers Scripts (Edit)
   - Account: Workers KV Storage (Edit)
6. 创建并复制 Token

### 2. 获取 Account ID

1. 在 Cloudflare Dashboard 中
2. 进入 "Workers & Pages"
3. 在右侧找到 "Account ID"
4. 复制 Account ID

### 3. 在 GitHub 中配置 Secrets

1. 进入仓库的 Settings
2. 选择 "Secrets and variables" → "Actions"
3. 点击 "New repository secret"
4. 添加以下 Secrets：
   - Name: `CLOUDFLARE_API_TOKEN`, Value: [你的 API Token]
   - Name: `CLOUDFLARE_ACCOUNT_ID`, Value: [你的 Account ID]

### 4. （可选）配置 Environments

1. 进入仓库的 Settings → Environments
2. 创建两个环境：
   - `production` (生产环境)
   - `development` (开发环境)
3. 为每个环境配置：
   - Protection rules（保护规则）
   - Environment secrets（环境专属 secrets）
   - Deployment branches（允许部署的分支）

## 🚀 使用方法

### 自动部署

推送代码到 `main` 分支会自动触发部署：

```bash
git push origin main
```

### 手动部署

1. 进入仓库的 "Actions" 标签
2. 选择 "Deploy to Cloudflare Workers" 工作流
3. 点击 "Run workflow"
4. 选择环境（production 或 development）
5. 点击 "Run workflow" 按钮

### 版本发布

#### 创建 Release（自动构建单文件）

推送标签会自动触发 Release 构建：

```bash
# 1. 更新版本号（可选）
npm version patch  # 或 minor, major

# 2. 创建标签
git tag -a v1.0.0 -m "Release v1.0.0"

# 3. 推送标签
git push origin v1.0.0
```

**自动生成内容**：
- ✅ 构建压缩版 `worker.js`（适合生产环境）
- ✅ 构建调试版 `worker.debug.js`（便于调试）
- ✅ 生成校验和文件（SHA256）
- ✅ 创建 GitHub Release
- ✅ 上传所有文件到 Release
- ✅ 生成部署说明文档

#### 手动触发 Release

1. 进入仓库的 "Actions" 标签
2. 选择 "Create Release" 工作流
3. 点击 "Run workflow"
4. 输入版本号（例如：v1.0.0）
5. 点击 "Run workflow" 按钮

#### 本地构建（仅测试）

```bash
# 构建未压缩版本
npm run build

# 构建压缩版本
npm run build:minify

# 自定义输出路径
npm run build -- --output=my-worker.js
```

构建输出目录：`dist/`

### 使用 Release 文件部署

下载 Release 文件后，可以直接部署：

**方法 1: Cloudflare Dashboard**
1. 下载 `worker.js`
2. 登录 Cloudflare Dashboard
3. 复制文件内容到 Worker 编辑器
4. 保存并部署

**方法 2: Wrangler CLI**
```bash
wrangler deploy worker.js
```

## 🔨 常用命令

### 本地开发

```bash
npm run dev              # 启动开发服务器
npm test                 # 运行测试
npm run test:watch       # 监听模式运行测试
npm run test:coverage    # 生成覆盖率报告
```

### 部署

```bash
npm run deploy           # 部署（自动版本号）
npm run deploy:git       # 使用 git commit 版本号
npm run deploy:dev       # 部署到开发环境
```

## 📊 监控和日志

### 查看工作流运行状态

1. 访问 `https://github.com/wuzf/2fa/actions`
2. 查看所有工作流运行历史
3. 点击具体的运行查看详细日志

### 部署摘要

每次部署完成后会生成摘要，包含：
- 部署环境
- 版本号
- 分支名称
- Commit SHA
- 部署者

### Cloudflare Workers 日志

使用 Wrangler CLI 查看实时日志：

```bash
npx wrangler tail                # 实时日志
npx wrangler tail --format=pretty # 格式化日志
```

## 🔧 自定义配置

### 修改 Node.js 版本

编辑 `.github/workflows/ci.yml`:

```yaml
strategy:
  matrix:
    node-version: [18.x, 20.x, 22.x]  # 添加或删除版本
```

### 修改部署环境

编辑 `.github/workflows/deploy.yml`:

```yaml
environment:
  name: ${{ github.event.inputs.environment || 'production' }}
  url: https://your-worker.your-domain.workers.dev  # 修改这里
```

### 添加代码检查工具

在 CI 工作流中添加 ESLint 或 Prettier：

```yaml
- name: Run ESLint
  run: npm run lint

- name: Run Prettier
  run: npm run format:check
```

### 配置通知

在 `deploy.yml` 的 `notify` job 中添加通知逻辑：

```yaml
- name: Send Slack notification
  uses: slackapi/slack-github-action@v1
  with:
    payload: |
      {
        "text": "Deployment ${{ needs.deploy.result }}"
      }
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK }}
```

### 调整 Dependabot 频率

编辑 `.github/dependabot.yml`:

```yaml
schedule:
  interval: "monthly"  # weekly → monthly
```

## 🐛 常见问题

### 1. 部署失败：API Token 无效

**解决方案**：
- 检查 `CLOUDFLARE_API_TOKEN` 是否正确配置
- 确认 Token 有足够的权限
- Token 可能已过期，需要重新生成
- 查看 Actions 日志找出具体错误

### 2. 测试失败导致无法部署

**解决方案**：
- 本地运行 `npm test` 确认问题
- 检查测试日志找出失败原因
- 修复代码后重新推送
- 如果是临时问题，可以在 Actions 中重新运行工作流

### 3. Dependabot PR 太多

**解决方案**：
- 调整 `dependabot.yml` 中的 `open-pull-requests-limit`
- 修改检查频率（weekly → monthly）
- 在 `ignore` 部分添加不需要更新的依赖

### 4. PR 检查不通过

**解决方案**：
- 查看失败的检查项
- 本地修复问题
- 推送更新后自动重新检查

## 📚 参考资源

- [GitHub Actions 文档](https://docs.github.com/en/actions)
- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Wrangler Action](https://github.com/cloudflare/wrangler-action)
- [Dependabot 配置](https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file)

## 📞 获取帮助

如有问题，请：
1. 查看 [项目文档](../README.md)
2. 在 [Issues](https://github.com/wuzf/2fa/issues) 中搜索类似问题
3. 创建新的 Issue 描述你的问题
4. 参与 [讨论](https://github.com/wuzf/2fa/discussions)
