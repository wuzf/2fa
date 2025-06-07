# 🚀 部署指南

本文档提供三种部署方式，请根据您的技术背景选择：

- **[一键部署指南](#一键部署指南)** - 最快捷但需要后续配置
- **[非开发者部署指南](#非开发者部署指南)** - 零基础图文教程，详细到每一步
- **[开发者部署指南](#开发者部署指南)** - 快速命令行部署，5分钟完成

---

## 🚀 一键部署指南

**适合人群**：想要快速体验 Cloudflare Workers 部署，愿意后续手动配置

**部署时间**：2-3 分钟部署 + 5-10 分钟配置

**优点**：

- ✅ 点击按钮即可部署
- ✅ 无需安装 Node.js 和命令行工具
- ✅ 自动创建 Worker

**缺点**：

- ⚠️ KV Namespace 需要手动配置
- ⚠️ 加密密钥需要手动设置
- ⚠️ 需要了解 Cloudflare Dashboard 操作

---

### 第 1 步：点击一键部署

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wuzf/2fa)

1. 点击上面的部署按钮
2. 如果未登录 Cloudflare，会提示登录
3. 授权 GitHub 访问（首次使用需要）
4. 选择仓库和分支
5. 点击 "Deploy" 按钮

**会发生什么**：

- Worker 会被自动创建和部署
- 代码会从 GitHub 仓库拉取
- 显示部署成功的 URL

📝 **记下您的 Worker URL**（如 `https://2fa-xxxx.workers.dev`）

⚠️ **此时访问 URL 会显示错误**，因为还需要配置 KV Namespace。

---

### 第 2 步：创建 KV Namespace

1. **访问 Cloudflare Dashboard**：
   - 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
   - 点击左侧菜单 **Workers & Pages**
   - 点击 **KV**

2. **创建 KV Namespace**：
   - 点击 **Create a namespace** 按钮
   - 输入名称：`2fa-secrets`（可以自定义）
   - 点击 **Add**

3. **记下 Namespace ID**：
   - 创建成功后，记下显示的 **ID**（类似 `a98735f310c24a9786cfd388241258e7`）

📝 **保存这个 ID**，下一步需要用到。

---

### 第 3 步：绑定 KV Namespace 到 Worker

1. **打开 Worker 设置**：
   - 在 Cloudflare Dashboard 中
   - 转到 **Workers & Pages**
   - 找到并点击您的 Worker（名称为 `2fa`）

2. **添加 KV 绑定**：
   - 点击 **Settings** 标签
   - 滚动到 **Variables and Secrets** 部分
   - 点击 **KV Namespace Bindings** 旁的 **Add binding**

3. **配置绑定**：
   - **Variable name**: 输入 `SECRETS_KV`（必须完全一致）
   - **KV namespace**: 选择刚才创建的 `2fa-secrets`
   - 点击 **Save**

4. **重新部署**：
   - 点击 **Deployments** 标签
   - 点击最新部署右侧的 **...** 菜单
   - 选择 **Retry deployment**

✅ **完成标志**：重新部署成功，没有错误提示

---

### 第 4 步：（强烈推荐）配置加密密钥

**为什么要配置**？

- 保护您的 2FA 密钥数据
- AES-GCM 256 位加密
- 防止数据泄露

1. **生成加密密钥**：

   **方法 1：在线生成（推荐）**
   - 访问：https://generate-secret.vercel.app/32
   - 复制生成的 Base64 字符串

   **方法 2：使用浏览器控制台**
   - 按 `F12` 打开浏览器控制台
   - 粘贴以下代码并回车：

   ```javascript
   crypto
   	.getRandomValues(new Uint8Array(32))
   	.reduce((s, b) => s + String.fromCharCode(b), '')
   	.split('')
   	.map((c) => btoa(c))
   	.join('')
   	.slice(0, 44);
   ```

   - 复制输出的字符串

2. **在 Worker 中添加 Secret**：
   - 在 Worker 的 **Settings** 页面
   - 滚动到 **Environment Variables** 部分
   - 点击 **Add variable**
   - **Type**: 选择 **Secret**
   - **Variable name**: 输入 `ENCRYPTION_KEY`
   - **Value**: 粘贴刚才生成的加密密钥
   - 点击 **Save and deploy**

⚠️ **重要**：将加密密钥保存到密码管理器，丢失后数据无法解密！

✅ **完成标志**：看到 "Successfully saved" 提示

---

### 第 5 步：首次访问设置密码

1. **访问您的 Worker URL**：
   - 在浏览器中打开记下的 URL
   - 例如：`https://2fa-xxxx.workers.dev`

2. **自动跳转到设置页面**：
   - 首次访问会自动跳转到 `/setup` 页面
   - 看到 "欢迎使用 2FA" 的设置界面

3. **设置管理密码**：
   - 输入密码（至少 8 位，包含大小写字母、数字、特殊字符）
   - 确认密码
   - 点击 "完成设置"

4. **自动登录**：
   - 设置成功后自动登录
   - 跳转到主页面
   - 可以开始添加 2FA 密钥

✅ **恭喜！一键部署完成！**

---

### 一键部署常见问题

**Q1: 点击部署按钮后显示 "Repository not found"**

**原因**：GitHub 仓库权限问题

**解决**：

- 确认已登录 GitHub
- 授权 Cloudflare Workers 访问 GitHub
- 重试部署

---

**Q2: 部署成功但访问显示 "Error 1101"**

**原因**：KV Namespace 未正确绑定

**解决**：

- 检查 KV Namespace 是否已创建
- 检查 Variable name 是否为 `SECRETS_KV`（区分大小写）
- 重新部署 Worker

---

**Q3: 访问页面显示 "服务未配置"**

**原因**：KV 绑定不正确

**解决**：

1. 在 Worker Settings 中检查 KV Namespace Bindings
2. 确认 Variable name 完全一致：`SECRETS_KV`
3. 重新部署

---

**Q4: 忘记保存加密密钥怎么办？**

**解决**：

- 如果还没有添加数据，可以重新生成并设置新的密钥
- 如果已有数据，旧数据无法解密（建议重新导入）
- 未来添加的数据将使用新密钥加密

---

### 一键部署 vs 命令行部署

| 特性         | 一键部署               | 命令行部署                |
| ------------ | ---------------------- | ------------------------- |
| **部署速度** | ⚡ 快（2-3分钟）       | 中等（5-10分钟）          |
| **技术要求** | 低（仅需浏览器）       | 中等（需要命令行）        |
| **后续配置** | ⚠️ 较多（手动配置 KV） | ✅ 较少（自动化脚本）     |
| **加密设置** | 手动（Dashboard）      | 命令行（wrangler secret） |
| **适合人群** | 快速体验用户           | 开发者和高级用户          |

**推荐**：

- 如果只是想快速体验 → 使用一键部署
- 如果要长期使用或了解技术细节 → 使用命令行部署

---

## 📖 非开发者部署指南

**适合人群**：第一次使用命令行，没有编程经验

**部署时间**：15-20 分钟

**所需工具**：

- 一台电脑（Windows/Mac/Linux 都可以）
- 浏览器（Chrome/Firefox/Safari/Edge）
- 稳定的网络连接

---

### 准备工作

#### 第 1 步：注册 Cloudflare 账户

1. 访问 [Cloudflare 注册页面](https://dash.cloudflare.com/sign-up)
2. 输入您的邮箱和密码
3. 点击"Create Account"
4. 到邮箱查收验证邮件，点击验证链接
5. 完成注册

✅ **完成标志**：能够登录 [Cloudflare Dashboard](https://dash.cloudflare.com)

---

#### 第 2 步：安装 Node.js

**什么是 Node.js**？它是运行部署工具的必需软件，就像安装其他普通软件一样。

**Windows 系统**：

1. 访问 [Node.js 官网](https://nodejs.org/)
2. 点击绿色的"LTS"版本下载按钮（推荐版本，如 v20.x.x）
3. 下载完成后，双击安装包
4. 安装过程中一路点击"Next"（保持默认选项即可）
5. 安装完成后，点击"Finish"

**Mac 系统**：

1. 访问 [Node.js 官网](https://nodejs.org/)
2. 点击绿色的"LTS"版本下载按钮
3. 下载完成后，双击 `.pkg` 文件
4. 安装过程中一路点击"继续"（保持默认选项即可）
5. 输入系统密码完成安装

**验证安装**：

打开命令行工具：

- **Windows**：按 `Win + R`，输入 `cmd`，按回车
- **Mac**：按 `Cmd + Space`，输入 `Terminal`，按回车

在命令行中输入以下命令（输入后按回车）：

```bash
node --version
```

如果显示类似 `v20.11.0` 的版本号，说明安装成功。

✅ **完成标志**：能看到 Node.js 版本号

---

#### 第 3 步：下载项目代码

**方法 1：使用 Git（推荐）**

如果您已安装 Git：

1. 打开命令行工具
2. 进入您想保存项目的文件夹，例如：

   ```bash
   # Windows
   cd C:\Users\你的用户名\Documents

   # Mac
   cd ~/Documents
   ```

3. 克隆项目：

   ```bash
   git clone https://github.com/wuzf/2fa.git
   ```

4. 进入项目目录：
   ```bash
   cd 2fa
   ```

**方法 2：直接下载 ZIP（无需 Git）**

1. 访问 [项目页面](https://github.com/wuzf/2fa)
2. 点击绿色的"Code"按钮
3. 点击"Download ZIP"
4. 下载完成后，解压到任意文件夹
5. 打开命令行，进入解压后的文件夹：
   ```bash
   # 例如解压到桌面
   cd Desktop/2fa-main
   ```

✅ **完成标志**：命令行显示的路径包含 `2fa` 文件夹

---

### 开始部署

#### 第 4 步：安装项目依赖

在命令行中，确保您在 `2fa` 项目文件夹内，然后输入：

```bash
npm install
```

**会发生什么**：

- 命令行会显示很多下载信息
- 大约需要 1-3 分钟（取决于网速）
- 最后显示"added XXX packages"表示成功

**如果出现错误**：

- 检查网络连接是否正常
- 尝试切换到手机热点
- 如果还是失败，尝试运行：`npm install --registry=https://registry.npmmirror.com`

✅ **完成标志**：命令行回到输入提示符，没有红色错误信息

---

#### 第 5 步：登录 Cloudflare

在命令行中输入：

```bash
npx wrangler login
```

**会发生什么**：

1. 浏览器会自动打开一个 Cloudflare 授权页面
2. 如果您已登录 Cloudflare，直接点击"Allow"（允许）
3. 如果未登录，先登录后再点击"Allow"
4. 看到"Success"页面后，可以关闭浏览器
5. 命令行显示"Successfully logged in"

**常见问题**：

**Q: 浏览器没有自动打开怎么办？**

- 命令行会显示一个链接（以 `https://` 开头）
- 复制这个链接，手动粘贴到浏览器打开

**Q: 点击 Allow 后没反应？**

- 等待 10 秒左右
- 检查是否有弹窗被浏览器拦截
- 刷新页面重试

✅ **完成标志**：命令行显示"Successfully logged in"

---

#### 第 6 步：创建存储空间（KV）

**什么是 KV**？它是 Cloudflare 提供的数据存储服务，用来保存您的 2FA 密钥。

**创建生产环境 KV**：

在命令行中输入：

```bash
npx wrangler kv:namespace create SECRETS_KV
```

命令行会输出类似以下内容（**重要！需要保存**）：

```
✨ Success!
Add the following to your wrangler.toml:

[[kv_namespaces]]
binding = "SECRETS_KV"
id = "a98735f310c24a9786cfd388241258e7"
```

📝 **请记下 `id` 后面的这串字符**（每个人都不一样）

**创建预览环境 KV**：

继续输入：

```bash
npx wrangler kv:namespace create SECRETS_KV --preview
```

输出类似：

```
✨ Success!
preview_id = "b60723194832445f8f3abc1b69fb693c"
```

📝 **请记下 `preview_id` 后面的这串字符**

✅ **完成标志**：获得两个 ID（`id` 和 `preview_id`）

---

#### 第 7 步：修改配置文件

1. **打开配置文件**：
   - 在项目文件夹中找到 `wrangler.toml` 文件
   - 用记事本（Windows）或文本编辑（Mac）打开

2. **找到这几行**：

   ```toml
   [[kv_namespaces]]
   binding = "SECRETS_KV"
   id = "a98735f310c24a9786cfd388241258e7"
   preview_id = "b60723194832445f8f3abc1b69fb693c"
   ```

3. **替换 ID**：
   - 将 `id = "..."` 中的内容替换为第 6 步记下的 `id`
   - 将 `preview_id = "..."` 中的内容替换为第 6 步记下的 `preview_id`

4. **保存文件**：
   - Windows：按 `Ctrl + S`
   - Mac：按 `Cmd + S`
   - 关闭文本编辑器

✅ **完成标志**：文件已保存，ID 已更新

---

#### 第 8 步：（可选但强烈推荐）配置加密

**为什么要配置加密**？

- 保护您的 2FA 密钥数据
- 即使有人获得 Cloudflare 访问权限，也无法读取数据
- **强烈建议配置**

**生成加密密钥**：

在命令行中输入：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

会输出一串随机字符，例如：

```
dGhpc2lzYXNlY3VyZXJhbmRvbXRva2VuMTIzNDU2Nzg5MA==
```

📝 **将这串字符复制并保存到安全的地方**（如密码管理器）

⚠️ **重要警告**：

- 这是您唯一的加密密钥
- 丢失后数据将无法解密
- 请务必备份到安全位置

**设置加密密钥**：

在命令行中输入：

```bash
npx wrangler secret put ENCRYPTION_KEY
```

提示"Enter a secret value:"时，粘贴刚才生成的密钥，按回车。

**不会显示任何字符，这是正常的**（密码输入模式）。

✅ **完成标志**：命令行显示"Success! Uploaded secret ENCRYPTION_KEY"

---

#### 第 9 步：部署到 Cloudflare

终于到最后一步了！在命令行中输入：

```bash
npm run deploy
```

**会发生什么**：

1. 项目会被打包和上传（大约 10-30 秒）
2. 显示上传进度和大小
3. 最后显示部署的 URL

**输出示例**：

```
✨ Total Upload: 518.76 KiB / gzip: 102.84 KiB
✨ Deployed 2fa triggers (1.80 sec)
   https://2fa-abc123.workers.dev
   schedule: 0 16 * * *
Current Version ID: 63b40cd3-91de-421b-bd97-f556cc27fa83
```

📝 **记下您的 Worker URL**（如 `https://2fa-abc123.workers.dev`）

✅ **完成标志**：看到"Deployed"和您的专属 URL

---

#### 第 10 步：首次设置密码

1. **访问您的 URL**：
   - 在浏览器中打开刚才记下的 URL
   - 例如：`https://2fa-abc123.workers.dev`

2. **自动跳转到设置页面**：
   - 首次访问会自动跳转到 `/setup` 页面
   - 看到"欢迎使用 2FA"的设置界面

3. **设置管理密码**：

   **密码要求**（必须全部满足）：
   - ✅ 至少 8 个字符
   - ✅ 包含大写字母（A-Z）
   - ✅ 包含小写字母（a-z）
   - ✅ 包含数字（0-9）
   - ✅ 包含特殊字符（如 `!@#$%^&*`）

   **示例密码**：
   - `MySecure2FA@2025`
   - `Strong!Pass123`
   - `CloudFlare#2FA`

4. **确认密码**：
   - 在第二个输入框中再次输入相同的密码

5. **点击"完成设置"**：
   - 等待几秒
   - 自动登录并跳转到主页

✅ **恭喜！部署成功！**

---

### 使用您的 2FA 管理器

现在您可以：

1. **添加 2FA 密钥**：
   - 点击右下角的 ➕ 按钮
   - 选择"扫二维码"或"手动添加"

2. **管理密钥**：
   - 查看验证码
   - 复制验证码
   - 编辑或删除密钥

3. **批量导入**：
   - 从其他 2FA 应用导入密钥

4. **定期备份**：
   - 点击"批量导出"保存备份

---

### 常见问题

**Q1: 忘记管理密码怎么办？**

**解决方法**：

1. 打开命令行，进入项目文件夹
2. 运行以下命令（替换为您的 KV ID）：
   ```bash
   npx wrangler kv:key delete "user_password" --namespace-id=your-kv-id
   ```
3. 重新访问 URL，会自动跳转到设置页面
4. 设置新密码

**如何找到 KV ID**？

- 打开 `wrangler.toml` 文件
- 找到 `id = "......"` 这一行
- 引号内的字符串就是您的 KV ID

**Q2: 部署后访问显示错误怎么办？**

**检查清单**：

1. 确认部署成功（看到"Deployed"字样）
2. 等待 1-2 分钟（DNS 传播需要时间）
3. 刷新浏览器页面（按 `Ctrl + F5` 或 `Cmd + Shift + R`）
4. 检查 `wrangler.toml` 中的 KV ID 是否正确

**Q3: 提示"服务未配置"怎么办？**

**原因**：KV 存储未正确配置

**解决方法**：

1. 检查 `wrangler.toml` 中的 `id` 是否正确
2. 重新运行 `npm run deploy`
3. 清除浏览器缓存后重试

**Q4: 如何更新到最新版本？**

```bash
# 1. 在项目文件夹中打开命令行
cd path/to/2fa

# 2. 拉取最新代码
git pull origin main

# 3. 更新依赖
npm install

# 4. 重新部署
npm run deploy
```

**Q5: 如何更换电脑继续管理？**

您的数据存储在 Cloudflare，不在本地电脑：

1. 在新电脑上重复第 1-5 步（不需要重新创建 KV）
2. 使用原来的 `wrangler.toml` 配置
3. 重新部署即可（数据不会丢失）

---

### 获取帮助

如果遇到问题：

1. **查看详细错误信息**：
   - 命令行显示的红色文字
   - 浏览器控制台（按 `F12` 打开）

2. **搜索已知问题**：
   - 查看 [GitHub Issues](https://github.com/wuzf/2fa/issues)
   - 搜索错误关键词

3. **提交问题**：
   - [创建新 Issue](https://github.com/wuzf/2fa/issues/new)
   - 描述问题和错误信息
   - 附上命令行输出截图

---

## ⚡ 开发者部署指南

**适合人群**：熟悉命令行，有基本开发经验

**部署时间**：5 分钟

### 步骤 1: 克隆项目

```bash
git clone https://github.com/wuzf/2fa.git
cd 2fa
```

### 步骤 2: 安装依赖

```bash
npm install
```

### 步骤 3: 登录 Cloudflare

```bash
npx wrangler login
```

浏览器会自动打开，完成授权。

### 步骤 4: 创建 KV 命名空间

```bash
# 生产环境
npx wrangler kv:namespace create SECRETS_KV

# 输出示例:
# ✨ Success!
# Add the following to your wrangler.toml:
# [[kv_namespaces]]
# binding = "SECRETS_KV"
# id = "a98735f310c24a9786cfd388241258e7"

# 预览环境
npx wrangler kv:namespace create SECRETS_KV --preview

# 输出示例:
# preview_id = "b60723194832445f8f3abc1b69fb693c"
```

### 步骤 5: 更新配置文件

编辑 `wrangler.toml`，填入步骤 4 生成的 ID：

```toml
[[kv_namespaces]]
binding = "SECRETS_KV"
id = "a98735f310c24a9786cfd388241258e7"        # 替换为你的 id
preview_id = "b60723194832445f8f3abc1b69fb693c"  # 替换为你的 preview_id
```

### 步骤 6: （推荐）配置加密密钥

如果需要加密存储数据，设置 `ENCRYPTION_KEY`：

```bash
# 1. 生成加密密钥（256位）
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 示例输出:
# dGhpc2lzYXNlY3VyZXJhbmRvbXRva2VuMTIzNDU2Nzg5MA==

# 2. 设置为 Secret
npx wrangler secret put ENCRYPTION_KEY
# 提示输入时，粘贴步骤1生成的密钥
```

⚠️ **重要提示**：

- 如果不设置 `ENCRYPTION_KEY`，数据将以明文形式存储在 KV 中
- 一旦设置加密密钥，请务必妥善保管，丢失将无法解密数据
- **建议生产环境启用加密**

### 步骤 7: 部署

```bash
npm run deploy
```

或使用 Wrangler 直接部署：

```bash
npx wrangler deploy
```

**输出示例**:

```
✨ Total Upload: 518.76 KiB / gzip: 102.84 KiB
✨ Deployed 2fa triggers (1.80 sec)
   https://2fa.your-subdomain.workers.dev
   schedule: 0 16 * * *
Current Version ID: 63b40cd3-91de-421b-bd97-f556cc27fa83
```

### 步骤 8: 首次访问

访问部署的 URL：

```
https://2fa.your-subdomain.workers.dev
```

首次访问会自动跳转到设置页面。

---

## 首次设置

### 设置管理密码

首次访问应用时，系统会自动跳转到设置页面：

**步骤**：

1. 访问部署的 URL
2. 自动跳转到 `/setup` 设置页面
3. 输入管理密码
4. 确认密码
5. 点击"完成设置"
6. 自动登录并跳转到主页

**密码强度要求**：

- ✅ 至少 8 个字符
- ✅ 包含大写字母（A-Z）
- ✅ 包含小写字母（a-z）
- ✅ 包含数字（0-9）
- ✅ 包含特殊字符（如 !@#$%^&\*）

**密码安全**：

- 密码使用 PBKDF2 加密（100,000 次迭代）
- 哈希值存储在 Cloudflare KV
- 使用 JWT token 进行身份验证
- Token 存储在 HttpOnly Cookie

**示例强密码**：

```
MySecure2FA@Pass2025
CloudFlare#Worker2024
Strong!Password123
```

### 后续登录

设置完成后，后续访问输入密码即可登录：

1. 访问应用 URL
2. 显示登录界面
3. 输入密码
4. 点击"登录"
5. JWT token 有效期 1 天

---

## 环境配置

### 环境变量（Secrets）

| 变量名           | 必需 | 说明                              | 生成方法                                                                      |
| ---------------- | ---- | --------------------------------- | ----------------------------------------------------------------------------- |
| `ENCRYPTION_KEY` | 推荐 | AES-GCM 256位加密密钥             | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `LOG_LEVEL`      | ❌   | 日志级别（DEBUG/INFO/WARN/ERROR） | 默认 `INFO`                                                                   |
| `SENTRY_DSN`     | ❌   | Sentry 错误追踪 DSN               | 从 Sentry 获取                                                                |

⚠️ **认证说明**：

- 系统使用密码认证（存储在 KV 的 `user_password` 键）
- 首次访问时通过网页设置管理员密码
- 密码使用 PBKDF2 加密存储，无法逆向解密

### KV 命名空间

| Binding      | 用途                        | 必需 | 存储的键                                                   |
| ------------ | --------------------------- | ---- | ---------------------------------------------------------- |
| `SECRETS_KV` | 存储2FA密钥、备份、密码哈希 | ✅   | `secrets`, `user_password`, `backup_*`, `last_backup_hash` |

### Cron 触发器

```toml
[triggers]
crons = ["0 16 * * *"]  # 每天北京时间凌晨0点（UTC 16:00）
```

**备份机制**：

- ✅ **事件驱动**: 数据变化后 5 分钟自动备份
- ✅ **定时检查**: 每天凌晨检查数据变化
- ✅ **智能备份**: 使用 SHA-256 哈希检测变化
- ✅ **自动清理**: 保留最新 100 个备份

**调整备份频率**：

```toml
# 每6小时
crons = ["0 */6 * * *"]

# 每周日凌晨
crons = ["0 0 * * 0"]

# 每月1号凌晨
crons = ["0 0 1 * *"]
```

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
preview_id = "your-preview-kv-id"

# 开发环境
[env.development]
name = "2fa-dev"
[[env.development.kv_namespaces]]
binding = "SECRETS_KV"
id = "your-dev-kv-id"
```

### 为每个环境配置 Secrets

```bash
# 开发环境
npx wrangler secret put ENCRYPTION_KEY --env development

# 部署到开发环境
npx wrangler deploy --env development
```

### 自定义域名

#### 方法 1: 在 Cloudflare Dashboard 配置

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 选择你的域名
3. 转到 **Workers & Pages** → 选择你的 Worker
4. 点击 **Triggers** → **Custom Domains**
5. 点击 **Add Custom Domain**
6. 输入域名（如 `2fa.example.com`）
7. 点击 **Add Custom Domain**

#### 方法 2: 在 wrangler.toml 配置

```toml
routes = [
  { pattern = "2fa.example.com/*", zone_name = "example.com" }
]
```

**重新部署**：

```bash
npx wrangler deploy
```

### CORS 白名单配置

生产环境应该限制 CORS 来源。

编辑 `src/utils/security.js`:

```javascript
const ALLOWED_ORIGINS = ['https://2fa.example.com', 'https://2fa.your-worker.workers.dev'];
```

---

## 验证部署

### 健康检查清单

#### 1. 访问主页

```
✅ 页面正常加载
✅ 首次访问跳转到设置页面
✅ 无控制台错误
```

#### 2. 设置密码

```
✅ 密码强度验证正常工作
✅ 设置成功后自动登录
✅ Cookie 正确设置（HttpOnly）
```

#### 3. 登录认证

```
✅ 使用密码成功登录
✅ JWT token 存储在 HttpOnly Cookie
✅ 登录后可以访问主界面
✅ Token 有效期 1 天
```

#### 4. 密钥管理

```
✅ 可以添加新密钥
✅ 可以编辑密钥
✅ 可以删除密钥
✅ 密钥列表正确显示
```

#### 5. OTP 生成

```
✅ 验证码正确生成
✅ 倒计时正常工作
✅ 可以复制验证码
✅ 支持 TOTP/HOTP
```

#### 6. 备份功能

```
✅ 可以手动触发备份
✅ 可以查看备份列表
✅ 可以导出备份（支持 TXT/JSON/CSV/HTML）
✅ 可以恢复备份
✅ 定时备份正常运行
```

#### 7. 加密功能

```
✅ 数据加密保存（如果配置了 ENCRYPTION_KEY）
✅ 备份文件已加密
✅ 可以正常解密读取
```

#### 8. PWA 功能

```
✅ Service Worker 注册成功
✅ Manifest 文件可访问（/manifest.json）
✅ 可以安装 PWA
✅ 图标正确显示
```

#### 9. 工具箱功能

```
✅ 二维码解析正常
✅ 二维码生成正常
✅ Base32 编解码正常
✅ 时间戳工具正常
✅ 密钥检查器正常
✅ 密钥生成器正常
```

---

## 故障排查

### 问题 1: 部署失败

**错误**: `Error: Unknown binding name: SECRETS_KV`

**原因**: KV 命名空间未配置或 ID 错误

**解决**:

```bash
# 1. 检查 wrangler.toml 中的 KV 配置
# 2. 重新创建 KV 命名空间
npx wrangler kv:namespace create SECRETS_KV
# 3. 更新 wrangler.toml 中的 id
```

---

### 问题 2: 无法访问设置页面

**现象**: 访问应用后显示错误或空白页

**原因**: KV 存储未正确配置

**解决**:

```bash
# 1. 检查 KV 是否已创建
npx wrangler kv:namespace list

# 2. 检查 wrangler.toml 中的 KV ID 是否正确
# 3. 重新部署
npx wrangler deploy
```

---

### 问题 3: 设置密码失败

**错误**: 「密码强度不足」

**原因**: 密码不满足强度要求

**解决**: 确保密码满足以下要求：

- 至少 8 个字符
- 包含大写字母
- 包含小写字母
- 包含数字
- 包含特殊字符

---

### 问题 4: 登录失败

**错误**: 「密码错误」

**可能原因**:

1. 密码输入错误
2. KV 中的密码哈希损坏

**解决**:

**方法 1: 重置密码（删除 KV 数据）**

```bash
# 1. 列出 KV 中的所有键
npx wrangler kv:key list --namespace-id=your-kv-id

# 2. 删除密码哈希
npx wrangler kv:key delete "user_password" --namespace-id=your-kv-id

# 3. 重新访问应用，会自动跳转到设置页面
```

**方法 2: 通过 Dashboard 重置**

1. 登录 Cloudflare Dashboard
2. 转到 Workers & Pages → KV
3. 选择你的 KV 命名空间
4. 找到并删除 `user_password` 键
5. 重新访问应用设置密码

---

### 问题 5: 数据无法加密

**现象**: 控制台显示「密钥以明文保存」

**原因**: `ENCRYPTION_KEY` 未配置

**解决**:

```bash
# 1. 生成加密密钥
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 2. 设置为 Secret
npx wrangler secret put ENCRYPTION_KEY

# 3. 重新部署
npx wrangler deploy
```

⚠️ **注意**: 设置加密密钥后，旧的明文数据仍可读取，但新数据会被加密。

---

### 问题 6: CORS 错误

**错误**: 浏览器控制台显示 CORS 错误

**原因**: 生产环境未正确配置 CORS 白名单

**解决**:

编辑 `src/utils/security.js`，添加你的域名：

```javascript
const ALLOWED_ORIGINS = ['https://your-domain.com', 'https://your-worker.workers.dev'];
```

重新部署：

```bash
npx wrangler deploy
```

---

### 问题 7: Service Worker 未注册

**检查方法**:

```
Chrome DevTools (F12) → Application → Service Workers
```

**可能原因**:

1. 未使用 HTTPS（Cloudflare Workers 自动提供）
2. Service Worker 文件路径错误
3. 浏览器不支持

**解决**:

```bash
# 1. 确认 /sw.js 可以访问
curl https://your-worker.workers.dev/sw.js

# 2. 检查控制台错误
# 3. 清除浏览器缓存后重试
```

---

### 问题 8: 备份未自动触发

**检查方法**:

```bash
# 查看 Worker 日志
npx wrangler tail
```

**可能原因**:

1. Cron 触发器未配置
2. 数据未发生变化（智能备份机制）
3. Worker 未正确部署

**解决**:

检查 `wrangler.toml`:

```toml
[triggers]
crons = ["0 16 * * *"]
```

确保已部署：

```bash
npx wrangler deploy
```

手动触发备份测试：

```bash
# 通过页面手动触发备份功能
# 或使用 cron 触发器：
npx wrangler tail  # 观察定时任务日志
```

---

### 问题 9: 忘记密码

**解决方法**:

**方法 1: 删除密码重新设置**

```bash
# 删除 KV 中的密码哈希
npx wrangler kv:key delete "user_password" --namespace-id=your-kv-id

# 重新访问应用设置密码
```

**方法 2: 通过 Dashboard 重置**

1. Cloudflare Dashboard → Workers & Pages → KV
2. 选择 SECRETS_KV
3. 删除 `user_password` 和 `setup_completed` 键
4. 重新访问应用

⚠️ **注意**: 删除密码不会影响已存储的 2FA 密钥数据。

---

## 升级指南

### 从旧版本升级

```bash
# 1. 备份当前数据
# 在应用中导出所有密钥

# 2. 拉取最新代码
git pull origin main

# 3. 更新依赖
npm install

# 4. 检查配置变更
git diff wrangler.toml

# 5. 部署新版本
npx wrangler deploy
```

---

## 生产环境最佳实践

### 安全

- ✅ 设置强管理密码
- ✅ 启用 `ENCRYPTION_KEY` 加密数据
- ✅ 配置 CORS 白名单
- ✅ 使用自定义域名
- ✅ 定期更新依赖
- ✅ 启用 Rate Limiting（已内置）

### 性能

- ✅ 使用 Cloudflare CDN
- ✅ 启用 Service Worker 缓存
- ✅ 使用生产环境 KV
- ✅ 配置合理的 Cron 间隔

### 监控

- ✅ 配置 Sentry 错误追踪
- ✅ 定期查看 Worker 日志
- ✅ 监控 KV 存储使用量
- ✅ 设置告警规则

### 备份

- ✅ 启用自动备份（已内置）
- ✅ 定期手动导出备份
- ✅ 备份管理密码到密码管理器
- ✅ 备份加密密钥到安全位置
- ✅ 测试备份恢复流程

---

## 卸载

### 删除 Worker

```bash
npx wrangler delete
```

### 删除 KV 数据

```bash
# 列出所有 KV 命名空间
npx wrangler kv:namespace list

# 删除指定命名空间（谨慎操作！）
npx wrangler kv:namespace delete --namespace-id=your-kv-id
```

### 清理 Secrets

```bash
# 列出所有 Secrets
npx wrangler secret list

# 删除指定 Secret
npx wrangler secret delete ENCRYPTION_KEY
npx wrangler secret delete LOG_LEVEL
npx wrangler secret delete SENTRY_DSN
```

---

## 相关文档

- [架构文档](ARCHITECTURE.md) - 了解系统设计
- [API 参考](API_REFERENCE.md) - API 端点文档
- [功能文档](features/) - 各功能详解
- [PWA 指南](PWA_GUIDE.md) - PWA 安装和配置

---

**支持**: 如有问题，请提交 [GitHub Issue](https://github.com/wuzf/2fa/issues)
