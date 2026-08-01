# 🚀 部署指南

本文档提供两种部署方式：

- **[一键部署](#一键部署)** — 点击按钮即可完成，适合大多数用户
- **[命令行部署](#命令行部署)** — 适合开发者或需要自定义配置的用户

---

## 一键部署

**部署时间**：约 5 分钟

### 第 1 步：部署 Worker

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wuzf/2fa)

1. 点击上方部署按钮，使用 GitHub 登录并授权
2. 登录 Cloudflare 账户，点击 **Deploy** 等待部署完成
3. 记下您的 Worker URL（如 `https://2fa-xxxx.workers.dev`）

> 项目 `wrangler.toml` 已显式声明 `SECRETS_KV`，Wrangler 会在首次部署时自动创建所需 KV 并在后续部署中复用，无需手动创建。
> 如果您在 Cloudflare Dashboard 中手动配置 Git 构建命令，**部署命令请使用 `npm run deploy`，不要直接写 `npx wrangler deploy`**，以保留项目的版本注入流程。

### 第 2 步：（强烈推荐）配置加密密钥

配置 `ENCRYPTION_KEY` 后，密钥数据将使用 AES-GCM 256 位加密存储。

1. 生成加密密钥（任选一种方式）：

   ```bash
   openssl rand -base64 32
   # 或
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

   没有命令行环境时，也可以按 `F12` 在浏览器控制台运行：

   ```javascript
   btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
   ```

2. 在 Cloudflare Dashboard 中打开您的 Worker → **Settings** → **Variables and Secrets** → **Add**：
   - **Type**: `Secret`
   - **Variable name**: `ENCRYPTION_KEY`
   - **Value**: 粘贴刚才生成的密钥
   - 点击 **Save and deploy**

⚠️ **重要**：`ENCRYPTION_KEY` 是解密数据的唯一主密钥，Cloudflare 保存后不会再次显示原值。请立即将其保存到密码管理器或其他安全位置——**丢失后已加密的数据将无法恢复**。如果无法确保保存原值，宁可暂时不设置。

### 第 3 步：设置管理密码

访问您的 Worker URL，首次访问会自动跳转到 `/setup` 设置页面：

1. 设置管理密码（至少 8 位，需包含大写字母、小写字母、数字和特殊字符）
2. 确认密码后点击"完成设置"，自动登录进入主页

✅ 部署完成，可以开始添加 2FA 密钥了。

---

## 命令行部署

**适合人群**：熟悉命令行，本机已安装 [Node.js](https://nodejs.org/)（LTS 版本）和 [Git](https://git-scm.com/)

### 步骤 1：克隆项目并安装依赖

```bash
git clone https://github.com/wuzf/2fa.git
cd 2fa
npm install
```

### 步骤 2：登录 Cloudflare

```bash
npx wrangler login
```

浏览器会自动打开授权页面，点击 **Allow** 完成授权。

### 步骤 3：创建 KV 命名空间

```bash
npx wrangler kv namespace create SECRETS_KV            # 生产环境，输出 id
npx wrangler kv namespace create SECRETS_KV --preview  # 预览环境，输出 preview_id
```

### 步骤 4：更新配置文件

编辑 `wrangler.toml`，填入上一步输出的 ID：

```toml
[[kv_namespaces]]
binding = "SECRETS_KV"
id = "你的 id"
preview_id = "你的 preview_id"
```

### 步骤 5：（强烈推荐）配置加密密钥

```bash
# 1. 生成加密密钥（256 位）
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 2. 设置为 Secret（提示输入时粘贴上面生成的密钥）
npx wrangler secret put ENCRYPTION_KEY
```

⚠️ **重要**：

- 不设置 `ENCRYPTION_KEY` 时，数据将以明文存储在 KV 中，**建议生产环境启用加密**
- 密钥丢失后已加密数据无法解密，请务必保存到密码管理器

### 步骤 6：部署并完成设置

```bash
npm run deploy
```

部署成功后会输出 Worker URL。访问该 URL，按照页面提示设置管理密码即可（密码要求同上）。

---

## 环境配置

### 环境变量（Variables / Secrets）

| 变量名                       | 必需 | 说明                                             | 生成方法 / 来源                                                               |
| ---------------------------- | ---- | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| `ENCRYPTION_KEY`             | 推荐 | AES-GCM 256 位加密密钥                           | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `ONEDRIVE_CLIENT_ID`         | 按需 | OneDrive OAuth 客户端 ID                         | Microsoft Entra 应用注册                                                      |
| `ONEDRIVE_CLIENT_SECRET`     | 按需 | OneDrive OAuth 客户端密钥                        | Microsoft Entra 应用注册                                                      |
| `GOOGLE_DRIVE_CLIENT_ID`     | 按需 | Google Drive OAuth 客户端 ID                     | Google Cloud Console                                                          |
| `GOOGLE_DRIVE_CLIENT_SECRET` | 按需 | Google Drive OAuth 客户端密钥                    | Google Cloud Console                                                          |
| `OAUTH_REDIRECT_BASE_URL`    | 按需 | OAuth 回调基准地址；使用自定义域名时推荐显式配置 | 例如 `https://2fa.example.com`                                                |

如需启用 OneDrive / Google Drive 远程备份，配置上表中的 OAuth 变量后，参考 [网盘备份配置指南](CLOUD_DRIVE_SETUP.md) 完成回调地址和授权步骤。

### KV 命名空间

| Binding      | 用途                          | 必需 | 存储的键                                                   |
| ------------ | ----------------------------- | ---- | ---------------------------------------------------------- |
| `SECRETS_KV` | 存储 2FA 密钥、备份、密码哈希 | ✅   | `secrets`, `user_password`, `backup_*`, `last_backup_hash` |

### Cron 触发器

```toml
[triggers]
crons = ["0 16 * * *"]  # 每天北京时间凌晨 0 点（UTC 16:00）检查并备份
```

备份机制：数据变化后立即触发自动备份；定时任务通过 SHA-256 哈希检测变化，仅在有变化时创建备份；自动保留最新 100 个备份。如需调整频率，修改 cron 表达式即可（每 6 小时：`"0 */6 * * *"`；每周日凌晨：`"0 0 * * 0"`）。

---

## 生产环境配置

### 多环境部署

`wrangler.toml` 支持多环境配置：

```toml
# 默认环境
name = "2fa"
[[kv_namespaces]]
binding = "SECRETS_KV"
id = "your-default-kv-id"

# 开发环境
[env.development]
name = "2fa-dev"
[[env.development.kv_namespaces]]
binding = "SECRETS_KV"
id = "your-dev-kv-id"
```

```bash
npx wrangler secret put ENCRYPTION_KEY --env development  # 为环境单独配置 Secret
npm run deploy:dev                                         # 部署到开发环境（保留版本注入流程）
```

### 自定义域名

**方法 1：Dashboard 配置** — Worker → **Triggers** → **Custom Domains** → **Add Custom Domain**，输入域名（如 `2fa.example.com`）。

**方法 2：`wrangler.toml` 配置**（修改后需执行 `npm run deploy` 生效）：

```toml
routes = [
  { pattern = "2fa.example.com", zone_name = "example.com", custom_domain = true }
]
```

### CORS 说明

CORS 采用动态同源策略：仅允许与当前请求 Host 同源的来源（自动适配 workers.dev 域名和自定义域名），无需任何配置。

---

## 部署后验证

快速确认部署是否成功：

1. 访问 Worker URL，首次自动跳转到 `/setup`，设置密码后能正常登录
2. 添加一条测试密钥，验证码正常刷新；退出重新登录后数据仍在（KV 读写正常）
3. 配置了 `ENCRYPTION_KEY` 的部署：在 Dashboard → **KV** 中查看 `secrets` 键，值应以 `__ENCRYPTED__` 开头
4. 建议定期通过 **批量导出** 保存备份，并实际演练一次备份恢复流程

---

## 升级指南

> ⚠️ **升级前请先备份数据**：通过应用内 **批量导出** 或 **还原配置 → 导出备份** 将数据导出到本地。
> 正常升级**不要**删除 Worker、GitHub 仓库或 KV 命名空间，已配置的 Secrets（含 `ENCRYPTION_KEY`）会继续生效。

### 一键部署用户：Sync Upstream 工作流

一键部署创建的是独立仓库（非 Fork），统一使用 **Sync Upstream** 工作流原地升级。

**首次升级前**：一键部署创建的仓库不包含 `.github/workflows/` 目录。请先在自己的仓库中新增文件 `.github/workflows/sync-upstream.yml`，内容复制自上游文件 <https://github.com/wuzf/2fa/blob/main/.github/workflows/sync-upstream.yml>，提交一次即可。

**升级步骤**：

1. 打开一键部署时在您 GitHub 上生成的 2fa 仓库
2. 进入 **Actions** → **Sync Upstream** → **Run workflow**
3. 工作流会同步上游最新代码，并自动合并您仓库中的 Worker 名称、KV 绑定等部署配置
4. Cloudflare 会自动重新部署同一个 Worker；如未自动部署，在 **Deployments** 页面手动重新部署最新提交

工作流运行摘要中会展示 `wrangler.toml` 与上游的 diff，如果您维护了特殊配置，可据此确认合并结果。

### 命令行部署用户

```bash
git pull origin main
npm install
git diff wrangler.toml   # 检查配置变更，确认自己维护的 KV ID、路由等仍然正确
npm run deploy
```

---

## 故障排查

### 部署前的环境问题

- **`npx wrangler login` 浏览器未自动打开**：复制命令行中显示的 `https://` 链接，手动粘贴到浏览器完成授权
- **`npm install` 失败**：检查网络后重试，或使用国内镜像 `npm install --registry=https://registry.npmmirror.com`
- **一键部署提示 `Repository not found`**：确认已登录 GitHub 并授权 Cloudflare Workers 访问，重试部署

### 部署或访问异常（Error 1101 / "服务未配置" / Unknown binding）

原因基本都是 KV 未正确绑定：

1. 检查 Worker **Settings** → **Bindings** 中是否存在名为 `SECRETS_KV` 的 KV 绑定（名称需完全一致，区分大小写）
2. 命令行部署用户检查 `wrangler.toml` 中的 KV `id` 是否正确（`npx wrangler kv namespace list` 可查看现有命名空间）
3. 修正后重新部署

### 忘记管理密码 / 登录失败

删除 KV 中的密码哈希后重新设置（不影响已存储的 2FA 密钥数据）：

- **Dashboard 方式**：**Workers & Pages** → **KV** → 选择您的命名空间 → 删除 `user_password` 键
- **命令行方式**：

  ```bash
  npx wrangler kv key delete "user_password" --namespace-id=your-kv-id
  ```

之后重新访问应用，会自动跳转到设置页面。

### 数据以明文保存

未配置 `ENCRYPTION_KEY`。按部署章节的说明生成并设置密钥后重新部署；旧的明文数据仍可读取，新数据将被加密。

### 忘记保存加密密钥

Cloudflare 不会再次显示 Secret 原值。如果尚未添加数据，可直接重新生成并覆盖 `ENCRYPTION_KEY`；如果已有加密数据，旧数据无法解密，只能重新导入。

### CORS 错误

系统按请求 Host 动态放行同源请求，正常直接访问不会出现 CORS 错误。如果浏览器控制台出现 CORS 报错，通常是通过反向代理或中转域名访问导致回源 `Host` 与页面域名不一致——请改用 Cloudflare 原生的自定义域名绑定（见上文"自定义域名"），或确保代理透传正确的 `Host` 头。

### 备份未自动触发

1. 检查 `wrangler.toml` 中的 `[triggers]` cron 配置是否存在
2. 定时备份仅在数据发生变化时创建（SHA-256 哈希比对），数据无变化不生成新备份
3. `npx wrangler tail` 可实时查看 Worker 日志确认执行情况

### 页面异常 / Service Worker 问题

强制刷新（`Ctrl + F5`）或清除浏览器缓存后重试；可在 DevTools（F12）→ **Application** → **Service Workers** 中查看注册状态。

---

## 卸载

```bash
# 删除 Worker
npx wrangler delete

# 删除 KV 命名空间（谨慎操作，数据将永久丢失！）
npx wrangler kv namespace list
npx wrangler kv namespace delete --namespace-id=your-kv-id
```

---

## 相关文档

- [网盘备份配置指南](CLOUD_DRIVE_SETUP.md) — WebDAV / S3 / OneDrive / Google Drive 远程备份配置
- [API 参考](API_REFERENCE.md) — API 端点文档
- [架构文档](ARCHITECTURE.md) — 系统设计
- [PWA 指南](PWA_GUIDE.md) — PWA 安装和配置

---

**支持**：如有问题，请提交 [GitHub Issue](https://github.com/wuzf/2fa/issues)
