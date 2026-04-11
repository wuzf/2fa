# ☁️ 网盘备份配置指南

本文档用于配置：

- `OneDrive` 远程备份
- `Google Drive` 远程备份

本文档面向“自己部署，自己使用”的场景。

> 如果你不打算使用 `OneDrive` / `Google Drive` 备份，可以直接跳过本文档。

目标是两件事：

1. 让你一步一步完成一次性的 OAuth 平台配置
2. 让你后续只需要点“保存并授权”，再按需启用同步就能用

---

## 一、先理解为什么要分两步

这个功能分成两层：

> 虽然是你自己部署、自己使用，但流程仍然分成两步：
>
> 1. 先完成一次性的 OAuth 应用初始化；
> 2. 再回到站内点击“保存并授权”绑定你自己的网盘帐号，并按需启用同步。
>
> 也就是说，这份文档里的平台配置步骤仍然需要做一次，不能直接跳到授权按钮。

### 1. 首次做一次配置

你需要：

- 去 Google / Microsoft 控制台创建授权应用
- 拿到 `客户端 ID` 和 `客户端密钥`
- 填回 Cloudflare Worker

这一步只做一次。

原因是：

- 当前项目不会把 `CLIENT_SECRET` 内置在仓库里
- OAuth 回调地址还需要和你自己的部署域名对应起来

### 2. 后续日常使用

完成上面的一次性配置后，你平时只需要：

1. 打开 `设置 -> 同步设置`
2. 进入 `OneDrive 同步` 或 `Google Drive 同步`
3. 填一个目标名称
4. 点击 `保存并授权`
5. 登录自己的网盘并同意授权
6. 按需启用该目标

也就是说：

- **复杂操作只在首次初始化时做一次**
- **后续使用应该尽量像“绑定登录 + 开关控制”一样简单**

---

## 二、开始前先准备好这几个东西

### 1. 你的应用访问地址

例如：

```text
https://your-app.workers.dev
```

或者：

```text
https://2fa.example.com
```

后面会用到两个回调地址：

```text
https://你的应用地址/api/gdrive/oauth/callback
https://你的应用地址/api/onedrive/oauth/callback
```

### 2. Cloudflare 中要配置的变量名

你最终需要配置这 4 个 Secret：

```text
ONEDRIVE_CLIENT_ID
ONEDRIVE_CLIENT_SECRET
GOOGLE_DRIVE_CLIENT_ID
GOOGLE_DRIVE_CLIENT_SECRET
```

可选再加 1 个普通变量：

```text
OAUTH_REDIRECT_BASE_URL
```

它的作用是：

- 如果不填，程序默认使用当前访问域名
- 如果你绑定了自定义域名，建议显式填写

例如：

```text
https://2fa.example.com
```

---

## 三、Google Drive 配置步骤

下面这部分完全按中文界面写。

### 第 1 步：打开 Google Cloud Console

访问：

https://console.cloud.google.com/

### 第 2 步：创建一个新项目

页面顶部点击项目选择框，然后点击：

```text
新建项目
```

项目名称建议填写：

```text
2FA Backup Google Drive
```

创建完成后，确认顶部显示的当前项目就是它。

### 第 3 步：启用 Google Drive API

左上角打开菜单，进入：

```text
API 和服务 -> 库
```

搜索：

```text
Google Drive API
```

打开后点击：

```text
启用
```

### 第 4 步：进入 OAuth 配置区域

左侧菜单进入：

```text
Google Auth Platform
```

如果已经完成初始配置，你会看到这些中文菜单：

- `概览`
- `品牌塑造`
- `目标对象`
- `客户端`
- `数据访问`

这和你截图里看到的是一致的。

### 第 5 步：配置“品牌塑造”

点击左侧：

```text
品牌塑造
```

按页面提示填写：

- 应用名称：`2FA Backup Google Drive`
- 用户支持邮箱：选你自己的邮箱
- 开发者联系邮箱：填你自己的邮箱

填完后保存。

### 第 6 步：配置“目标对象”

点击左侧：

```text
目标对象
```

建议选择：

```text
外部
```

原因：

- 个人 Gmail 账号可以使用
- 这是个人自部署、自用场景下最合适的用户类型

如果页面里还能看到 `发布状态`，建议切换为：

```text
正式版
```

原因：

- 当前项目会长期使用 refresh token 做自动备份
- 自部署自用场景下，`外部 + 正式版` 比 `Testing` 更适合长期使用

> 如果你已经是 `外部 + 正式版`，就不需要再配置 `测试用户`。
>
> 只有在你故意保持 `Testing` 时，才需要把自己的 Google 邮箱加入 `测试用户`，否则授权通常会失败。
>
> 如果处于 `正式版` 但尚未通过 Google 验证，授权时可能会看到“未验证应用”提示；个人自用场景下一般可以继续。

如果你暂时仍想保持 `Testing`，操作方式是：

1. 找到 `测试用户`
2. 点击 `添加用户`
3. 输入你自己的 Google 邮箱
4. 点击保存

> 再强调一次：`测试用户` 只是 `Testing` 状态下的临时方案，不是本文档对长期自用场景的首选配置。

### 第 7 步：配置“数据访问”

点击左侧：

```text
数据访问
```

然后点击类似下面的按钮：

```text
添加或移除范围
```

把这 3 个范围加进去：

```text
https://www.googleapis.com/auth/drive.file
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
```

说明：

- `drive.file`：让应用可以写入和管理它自己创建的备份文件
- `userinfo.email`：读取邮箱地址
- `userinfo.profile`：读取基本账号信息

额外说明：

- 页面里填写的 `备份目录`，应理解为应用会在自己的可管理范围内自动创建并维护的目录路径。
- 不要把它理解成“可直接复用你网盘里任意一个现有目录”；为了避免权限和可见性问题，建议为本应用单独使用一个专用目录。

加完后点击：

```text
更新
```

然后再点击页面里的：

```text
保存
```

### 第 8 步：创建客户端

点击左侧：

```text
客户端
```

然后点击右上角：

```text
创建 OAuth 客户端
```

如果页面要你选择客户端类型，选择：

```text
Web 应用
```

名称建议填写：

```text
2FA Backup Google Drive Web
```

### 第 9 步：填写 Google Drive 回调地址

在 `已获授权的重定向 URI` 或类似位置中填写：

```text
https://你的应用地址/api/gdrive/oauth/callback
```

例如：

```text
https://your-app.workers.dev/api/gdrive/oauth/callback
```

或者：

```text
https://2fa.example.com/api/gdrive/oauth/callback
```

然后保存创建。

### 第 10 步：复制客户端信息

创建完成后，页面会显示：

- `客户端 ID`
- `客户端密钥`

把它们保存下来。

它们分别对应：

```text
GOOGLE_DRIVE_CLIENT_ID
GOOGLE_DRIVE_CLIENT_SECRET
```

---

## 四、OneDrive 配置步骤

下面这部分是给 Microsoft / OneDrive 用的。

### 第 1 步：打开 Microsoft Entra 管理中心

访问：

https://entra.microsoft.com/

> 注意：
>
> - `entra.microsoft.com` 是 Microsoft Entra 的租户管理后台，不是普通的个人 OneDrive 登录页。
> - 如果你用的是 `outlook.com` / `hotmail.com` / `live.com` 这类个人 Microsoft 帐号，并且打开后直接报 `AADSTS16000` 或“`user account from identity provider 'live.com' does not exist in tenant`”，通常表示这个帐号当前没有可管理的 Entra 租户。
> - 解决办法通常是二选一：
>   1. 改用已有 Microsoft 365 / Azure / 工作或学校租户的帐号登录；
>   2. 或先去 `https://portal.azure.com/` 创建一个 Microsoft Entra 租户，再回到这里注册应用。
> - 如果浏览器自动带入了错误帐号，先退出当前所有 Microsoft 登录状态，或使用无痕窗口重新登录。

### 第 2 步：进入应用注册

左侧进入：

```text
Microsoft Entra ID -> 应用注册
```

点击：

```text
新注册
```

### 第 3 步：创建应用

建议填写：

- 名称：`2FA Backup OneDrive`

支持的帐户类型建议选择：

```text
任何组织目录中的帐户以及个人 Microsoft 帐户
```

原因：

- 当前项目实现使用通用授权端点
- 这样个人 OneDrive 和工作/学校 OneDrive 都更容易兼容

然后点击注册。

### 第 4 步：复制客户端 ID

创建完成后，在概览页找到：

```text
应用程序(客户端) ID
```

把它保存下来。

它对应：

```text
ONEDRIVE_CLIENT_ID
```

### 第 5 步：配置身份验证

左侧进入：

```text
Authentication (Preview)
```

在新版 Entra 界面中，保持停留在：

```text
重定向 URI 配置
```

然后点击：

```text
添加重定向 URI
```

### 第 6 步：填写 OneDrive 回调地址

右侧会弹出“选择要添加重定向 URI 的平台”侧栏。

在 `Web 应用程序` 区域选择：

```text
Web
```

> 不要选择 `单页应用程序`（SPA）。

然后在重定向 URI 输入框中填写：

```text
https://你的应用地址/api/onedrive/oauth/callback
```

例如：

```text
https://your-app.workers.dev/api/onedrive/oauth/callback
```

或者：

```text
https://2fa.example.com/api/onedrive/oauth/callback
```

填写后点击保存 / 配置。

> 如果你看到的是旧版界面，也可以按旧流程操作：`身份验证 -> 添加平台 -> Web`。

### 第 7 步：配置 API 权限

左侧进入：

```text
API 权限
```

点击：

```text
添加权限
```

选择：

```text
Microsoft Graph
```

然后选择：

```text
委托的权限
```

添加下面这些权限：

```text
Files.ReadWrite.AppFolder
User.Read
```

如果页面里能找到 `offline_access`，也一并加上。

说明：

- `Files.ReadWrite.AppFolder`：允许把备份写到 OneDrive 应用专用目录
- `User.Read`：读取基本账户信息

### 第 8 步：企业账号可能需要管理员同意

如果你使用的是公司或学校账号，后面授权时可能提示需要管理员批准。

这种情况可以回到：

```text
API 权限
```

点击：

```text
授予管理员同意
```

如果你没有管理员权限，就需要让管理员来操作。

### 第 9 步：创建客户端密钥

左侧进入：

```text
证书和密码
```

在 `客户端密码` 区域点击：

```text
新建客户端密码
```

描述建议填写：

```text
2FA OneDrive Secret
```

然后创建。

### 第 10 步：立刻复制“值”

创建后会显示：

- `值`
- `机密 ID`

请复制：

```text
值
```

不是 `机密 ID`。

这个值对应：

```text
ONEDRIVE_CLIENT_SECRET
```

---

## 五、把凭据填回 Cloudflare

### 方式一：命令行

在项目目录下执行：

```bash
npx wrangler secret put ONEDRIVE_CLIENT_ID
npx wrangler secret put ONEDRIVE_CLIENT_SECRET
npx wrangler secret put GOOGLE_DRIVE_CLIENT_ID
npx wrangler secret put GOOGLE_DRIVE_CLIENT_SECRET
```

如果你使用自定义域名，建议再配置：

```text
OAUTH_REDIRECT_BASE_URL = https://你的应用地址
```

### 方式二：Cloudflare Dashboard

进入：

```text
Workers & Pages -> 你的 Worker -> Settings -> Variables and Secrets
```

新增 4 个 Secret：

- `ONEDRIVE_CLIENT_ID`
- `ONEDRIVE_CLIENT_SECRET`
- `GOOGLE_DRIVE_CLIENT_ID`
- `GOOGLE_DRIVE_CLIENT_SECRET`

如果用了自定义域名，再新增普通变量：

- `OAUTH_REDIRECT_BASE_URL`

例如：

```text
https://2fa.example.com
```

### 最后一步

重新部署 Worker。

---

## 六、如何验证自己配置成功

部署完成后，打开你的 2FA 应用，依次检查：

1. 进入 `设置 -> 同步设置`
2. 查看 `OneDrive 同步` 和 `Google Drive 同步`
3. 如果页面不再提示“服务端未配置 OAuth 凭据”，说明 Cloudflare 变量大概率已经生效
4. 分别添加一个测试目标
5. 点击 `保存并授权`
6. 在弹出的窗口中完成登录和授权
7. 授权成功后，启用目标
8. 手动触发一次备份，查看网盘里是否出现 `backup_*.(txt|json|csv|html)` 文件
   文件扩展名取决于「设置 → 默认导出格式」

---

## 七、后续如何使用

完成配置后，你后续应当只需要：

1. 打开 `设置 -> 同步设置`
2. 进入 `OneDrive 同步` 或 `Google Drive 同步`
3. 添加目标
4. 填一个名称
5. 点击 `保存并授权`
6. 登录自己的网盘并同意授权
7. 按需启用目标
8. 完成

然后系统会对所有**已启用**目标自动：

- 在手动备份时推送
- 在数据变更触发备份时推送
- 在定时备份时推送

---

## 八、最常见的问题

### 1. 提示 `redirect_uri_mismatch`

原因：

- 平台控制台里填写的回调地址和程序实际使用的不完全一致

重点检查：

- 是否是 `https`
- 域名是否一致
- 路径是否一致
- 是否多了或少了 `/`

### 2. Google 页面提示应用不可用 / 未完成验证

常见原因：

- 你当前仍处于 `Testing`
- 但没有把自己的 Google 账号加入 `测试用户`
- 或者应用已经是 `正式版`，但 Google 仍显示“未验证应用”提示

处理办法：

- 如果你是个人自用，优先把 `目标对象` 保持为 `外部`，并把 `发布状态` 切到 `正式版`
- 如果你暂时继续使用 `Testing`，记得把自己的 Google 邮箱加入 `测试用户`
- 如果已经是 `正式版` 但仍提示“未验证应用”，通常可以继续完成授权

### 3. 打开 `entra.microsoft.com` 就报 `AADSTS16000`

常见原因：

- 你当前登录的是个人 Microsoft 帐号
- 该帐号没有关联可管理的 Microsoft Entra 租户
- 浏览器自动复用了错误的 Microsoft 登录状态

处理办法：

- 先确认你登录的是准备用来创建 OneDrive OAuth 应用的帐号
- 如果你已有 Microsoft 365 / Azure / 工作或学校租户，切换到对应帐号或对应目录后再进入 Entra
- 如果你只有个人帐号，先访问 `https://portal.azure.com/`，按 Microsoft 官方文档创建一个 Microsoft Entra 租户，再回到 `https://entra.microsoft.com/`
- 仍然报同样错误时，先退出所有 Microsoft 帐号，或使用无痕窗口重新登录

### 4. OneDrive 提示需要管理员批准

常见原因：

- 你使用的是企业租户
- 需要管理员同意权限

处理办法：

- 回到 `API 权限`
- 让管理员点击 `授予管理员同意`

### 5. 页面里能看到入口，但点击授权失败

优先检查：

- `ONEDRIVE_CLIENT_ID`
- `ONEDRIVE_CLIENT_SECRET`
- `GOOGLE_DRIVE_CLIENT_ID`
- `GOOGLE_DRIVE_CLIENT_SECRET`

是否真的已经配置到 Cloudflare，并且已经重新部署。
