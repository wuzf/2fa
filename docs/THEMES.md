# 自定义主题与外观

2FA 支持两种主题格式，均可在独立仓库制作，无需修改主项目源码。认证、验证码、HOTP、离线队列和账户操作继续使用主程序的同一套业务内核。

| 格式          | 适用范围                                         | 执行方式                                                                 |
| ------------- | ------------------------------------------------ | ------------------------------------------------------------------------ |
| v1 样式和布局 | 调整官方页面的区域、卡片、导航、品牌和配色       | 声明式布局、CSS、图片和字体；不执行主题 JavaScript，不接受任意 HTML 模板 |
| v2 完整前端   | 独立组织整个账户界面、交互、像素或手绘等视觉风格 | `kind: "app"` 的受信任 ESM，使用 SDK API 1 接入账户与主机功能            |

**v2 正式运行不是沙箱。** 主题 JavaScript 与 2FA 页面同源，具有页面权限，可访问账户数据和发送网络请求；SDK 的数据投影不构成权限隔离。只应用自己信任的作者和版本。隔离的合成预览与正式运行的信任模型不同。

<!-- APP_THEME_ACTIVATION_STATUS -->

v2 已通过完整资源、恢复路径和独立审核，可安装、联网预览并应用。发布成功后，每台设备仍需准备对应的完整运行资源；资源暂不可用时会保留官方界面或提供安全恢复入口。

v2 作者直接阅读 [完整前端主题与 SDK API 1](THEME_APP_SDK.md)。本文后半部分的布局、绑定和 CSS 示例专用于 v1。

## 使用主题

从设置打开 **外观与主题**。**主题**页展示一个 **官方默认主题** 与已安装的独立主题，例如 Sketch、Pixel、Journal、Receipt。Receipt 是超市小票风格的完整前端主题，默认以独立黑白热敏纸卡片呈现验证码，使用剩余秒数代替进度条；首页仅保留添加、管理、搜索筛选与折叠视图入口，支持浅深色、可选印色及纸张纹理开关。导入文件或粘贴地址时自动识别主题格式，无需手动选择。以前使用过的文档、紧凑列表主题及其设置保留在折叠的 **兼容主题** 区；正在使用兼容主题时，该区域会展开并标出当前选择。

编辑器分为 **主题、品牌、主题设置** 三页。预览使用示例账户，修改先作为本机草稿保留，点击 **应用外观** 后才请求发布到实例。

**社区主题**直接展示公共仓库 [wuzf/2fa-theme-mytheme](https://github.com/wuzf/2fa-theme-mytheme) 已合并收录的主题，选择后安装并打开预览。**我的主题**显示本实例已安装的主题，包括未上架的个人作品。社区目录暂时不可用时，仍可选择已安装或官方主题，并使用个人导入入口。

当前社区仓库暂为私有，尚未开放公开投稿和匿名目录读取。开放前可继续使用已安装主题，或导入自己的主题文件；下文的 PR 上架流程适用于仓库公开后。

未上架的主题可以通过以下方式安装：

- v1 上传 ZIP、`.css` 或包含内联 CSS 的 `.json`；v2 上传构建完成的 ZIP。
- 粘贴直接指向主题文件的 HTTPS 地址。
- 粘贴公开 GitHub 仓库或指定 Release 地址。系统下载正式 Release 中名称严格为 `2fa-theme.zip` 的附件，不在服务器构建仓库源码。

安装与应用是两个步骤；安装不会自动执行正式主题。v2 应用前有同源脚本的受信确认。每个“格式 + 主题 id”只显示一个已安装版本，重复导入或从社区更新会替换该主题的已安装条目，不再提供历史版本列表。新包校验或保存失败时保留原条目；安装成功后，先预览配置迁移结果，再应用。配置按“格式 + 主题 id”隔离；系统保留同名、同类型且仍有效的字段，新增字段使用默认值，失效或移除的设置会提示调整。

### 将自己的主题上架

作者可在自己的 GitHub 仓库开发主题，构建完整的 `2fa-theme.zip` 后，向公共仓库 **`wuzf/2fa-theme-mytheme`** 提交 PR。按公共仓库的贡献指南，将完整包、主题信息和许可提交到 `themes/<主题 id>/`，生成目录索引，经维护者审核合并后即可在应用的社区主题中选择。

公共仓库保存主题代码、样式、图片、字体及许可的完整副本。作者仓库链接只作来源说明，安装不依赖该仓库或其 Release；作者仓库改名、转为私有或删除，不影响已经合并的主题。更新时提交 PR 覆盖同一目录中的 `2fa-theme.zip` 和信息，不新增版本目录。Git 提交记录仍用于维护者审查，应用不将其作为主题历史版本展示。

**品牌**包含站点名、简介、Logo、应用图标、登录说明、页脚和背景。跨 v1/v2 切换时继续保留完整个人品牌。若未发布包中的品牌图片尚未保存到本机，离线切换会保留原草稿并提示联网。系统生成 PNG 应用图标，已安装 PWA 的名称与图标何时更新由浏览器和操作系统决定。

**主题设置**展示当前主题作者声明的选项；没有选项时会提示无需配置。v1 的 **布局**和 **自定义 CSS** 收在该页折叠的 **高级设置** 中，已有布局和 CSS 会保留；外部素材会在应用时导入到实例。v2 只编辑作者声明的设置和品牌，不套用 v1 的布局、内容绑定或自定义 CSS。两者的草稿都不会即时改变其他设备看到的页面。

关闭编辑器时可以保留本机草稿或放弃修改。草稿包含新增素材，保存在当前浏览器的 IndexedDB；清理站点数据也会删除这些草稿。离线时可继续编辑本机已有内容，联网后再应用。另一设备修改外观造成冲突时，草稿会保留，请加载最新已保存外观后重新确认。

### 完整前端预览与本设备运行

v2 预览需要联网，运行包内真实构建产物，但账户、验证码及操作结果都是合成数据。预览窗口仅允许脚本执行，不向主题提供登录凭据或真实账户 SDK；预览按钮不会真实修改账户或复制密钥。每次预览授权固定有效 **5 分钟**，普通配色、文字、模式和尺寸变化不会延长有效期。到期或添加新素材后点击 **更新预览**。每个登录所有者最多同时保有 2 个预览，每分钟最多创建 6 个；关闭窗口和会话失效会撤销本地预览，远端撤销失败时仍受固定到期时间约束。

**已发布、本页已运行、本设备离线就绪是三个状态。** 服务端保存成功不表示每个浏览器已经完成启动。v2 启动前，本设备需要准备对应主机构建、主题所有文件及独立恢复页，并取得当前 Service Worker 的运行许可。未受控制、空间不足、资源缺失或不兼容时保留官方界面或给出恢复入口；不要手动清缓存来跳过准备。

不同 app 包之间的切换、升级和回滚需要完整刷新。相同 app 包只修改设置或品牌时，主机可在当前页面重新准备并挂载；主题应清理旧挂载。旧标签页不会混用新旧构建模块，尚未保存的编辑、在途写入和 HOTP 操作会阻止不安全的刷新。

首次从未缓存的设备离线访问不保证可用。即使已经离线就绪，浏览器主动清理站点存储仍可能使资源不可用；明确的登录拒绝也不会被离线缓存掩盖。HOTP 离线时不能执行需要服务端预留计数器的复制。

## 备份、更新与恢复

- **导出主题**保存原主题版本，适合分发给其他用户。
- **导出完整外观**包含当前主题、个人设置、品牌和必要素材；v1 另外包含布局和自定义 CSS，v2 包含构建后的 ESM 与所有清单资源。
- **恢复外观**检查完整备份并打开恢复草稿，不直接覆盖正在使用的外观。
- **恢复上一套外观**同时恢复上一版本主题、设置和品牌。

账户自动备份不包含主题。完整外观备份也不包含全局“自定义代码”中的 JavaScript。需要迁移全局代码时请单独保存。

如果主题或代码导致页面无法操作，访问：

```text
https://你的域名/?safeMode=1
```

该入口临时停用主题、高级 CSS 和已有自定义代码，使用独立基础界面。旧的 `disableCustomCode=1` 恢复链接继续有效。保存修改不会自动离开安全模式，使用明确的退出按钮才会重新加载已保存配置。

## v1 作者：最小可用主题

ZIP 根目录放置以下文件，不要额外包一层目录：

```text
2fa-theme.zip
├── 2fa-theme.json
├── theme.css
├── preview.webp       可选
└── assets/
    ├── background.webp
    └── font.woff2
```

一个没有附件的有效 `2fa-theme.json`：

```json
{
	"themeApiVersion": 1,
	"id": "my-space",
	"name": "我的空间",
	"version": "1.0.0",
	"author": "主题作者",
	"description": "带侧栏导航的个人 2FA",
	"styles": "theme.css",
	"layout": {
		"header": ["brand", { "id": "actions", "type": "actions", "mode": "toolbar" }],
		"leading": ["service-nav"],
		"main": ["search", "view-controls", "system-status", "accounts"],
		"trailing": [{ "id": "welcome", "type": "text" }],
		"footer": ["footer"]
	},
	"tokens": {
		"light": { "--2fa-accent": "#006c67", "--2fa-radius": "12px" },
		"dark": { "--2fa-accent": "#72d9cf", "--2fa-radius": "12px" }
	},
	"content": {
		"welcome": { "title": "欢迎", "text": "这是我的验证器。" }
	},
	"settings": [
		{
			"key": "radius",
			"type": "select",
			"label": "圆角",
			"default": "12px",
			"options": [
				{ "value": "0px", "label": "方角" },
				{ "value": "12px", "label": "圆角" }
			],
			"binding": { "type": "variable", "name": "--2fa-radius" }
		},
		{
			"key": "welcomeText",
			"type": "textarea",
			"label": "欢迎文字",
			"default": "这是我的验证器。",
			"binding": { "type": "content", "component": "welcome", "field": "text" }
		}
	]
}
```

配套 `theme.css`：

```css
[data-part='account'] {
	background: var(--2fa-surface);
	border: 1px solid var(--2fa-border);
	border-radius: var(--2fa-radius);
	padding: var(--2fa-card-padding);
}

[data-part='region-leading'],
[data-part='region-trailing'] {
	padding: 20px;
	background: var(--2fa-surface);
	border-radius: var(--2fa-radius);
}

[data-part='service-nav'] {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

@media (prefers-reduced-motion: reduce) {
	:root {
		--2fa-motion: 0ms;
	}
}
```

需要图片时，使用相对路径，如 `url("assets/background.webp")`。支持 PNG、JPEG、WebP、GIF、WOFF2；HTML、JavaScript、SVG 和可执行附件不能放入主题包。系统解析 CSS 和素材引用，保存到实例后重新生成引用，不在运行时依赖主题作者的站点。

单文件 JSON 使用 `{ "manifest": { ... }, "css": "..." }`，其中 `manifest` 是同样的清单。单独导入 CSS 时自动继承默认布局并生成主题标识。

### 协议与版本

`themeApiVersion` 固定为 `1`，它与应用版本、主题自身版本独立。`id` 为 1–64 位字母、数字、下划线或短横线，不能使用保留的 `builtin-` 前缀；`name` 必填，`version` 使用语义化版本，例如 `1.2.0`。

同一 `id` 表示同一个主题系列。同格式、同 id 的新包替换已安装条目，仅保留一个可选择版本。系统内部仍根据规范化内容计算不可变 `packageId`，正在运行的页面、隔离预览和上一套外观恢复所引用的资源不会在更新途中被覆盖；这些资源不属于可浏览的历史版本，无引用后按回收规则清理。未识别的清单字段会被拒绝，请通过已支持的配置字段扩展主题。

### 布局与内容

布局有五个区域：`header`、`leading`、`main`、`trailing`、`footer`。每个区域是有序数组。字符串 `"search"` 等价于 `{ "id": "search", "type": "search" }`。

| 组件类型                 | 能力                           |
| ------------------------ | ------------------------------ |
| `brand`                  | Logo、站点名称和简介           |
| `service-nav`            | 服务分组筛选，与文字搜索取交集 |
| `search`                 | 搜索与清除                     |
| `view-controls`          | 聚合／平铺与排序               |
| `system-status`          | 离线、错误及隐藏账户状态       |
| `accounts`               | 账户、验证码、进度及空状态     |
| `actions`                | 全部账户操作入口               |
| `footer`                 | 页脚                           |
| `text`、`image`、`links` | 可重复的个性内容               |

`search/view-controls/system-status/accounts/actions` 必须各有且仅有一个，不能隐藏；`accounts` 必须在 `main`。其他内置组件最多一个，内容组件可以重复，但每个 `id` 必须唯一。

可选组件可以声明 `hidden: true`。`actions` 支持 `mode: "floating"` 或 `mode: "toolbar"`；使用正式模式切换，不用 CSS 模拟悬浮入口的拖拽状态。

`content` 的键对应内容组件的 `id`：

```json
{
	"welcome": { "title": "欢迎", "text": "个人说明" },
	"picture": { "src": "assets/background.webp", "alt": "背景风景", "title": "我的照片" },
	"bookmarks": {
		"title": "常用链接",
		"items": [{ "label": "项目主页", "href": "https://example.com" }]
	}
}
```

分别用于 `text/image/links`。链接允许 HTTPS 或 `mailto:`；内容作为文本显示，不支持 HTML。主题的自由度来自区域组合和 CSS，不支持任意嵌套模板。

官方布局在小于 768px 时使用单栏，768–1199px 最多两栏，1200px 起可使用三栏。主题作者仍需验证自定义 CSS 在窄屏下不会遮挡搜索、账户或操作入口。

### 配置字段

`settings` 最多 64 项，每项具有唯一 `key`、`type`、`label`、`default` 和 `binding`。支持：

| 类型               | 额外字段／值                                                          |
| ------------------ | --------------------------------------------------------------------- |
| `boolean`          | 默认值为布尔值                                                        |
| `color`            | 十六进制颜色，如 `#008080`                                            |
| `number`           | 可选 `min/max/step`                                                   |
| `select`           | `options: [{ "value": "...", "label": "..." }]`，默认值必须是一个选项 |
| `text`、`textarea` | 文字                                                                  |
| `asset`            | 图片／字体资源引用，空字符串表示未选择                                |

绑定有三种形式：

```json
{ "type": "variable", "name": "--theme-my-color" }
{ "type": "attribute", "name": "data-theme-option-density" }
{ "type": "content", "component": "welcome", "field": "text" }
```

变量绑定接受 `--2fa-*` 或 `--theme-*`。属性绑定必须使用 `data-theme-option-*` 且字段为 `boolean/select`。内容绑定只能指向已经声明的内容组件，字段为 `text/title/src/alt`。不支持模板表达式和自定义配置脚本。

数值字段的变量绑定可以增加 `unit`，接受 `px/rem/em/%/ms/s/vw/vh`，例如 `{ "type": "variable", "name": "--2fa-font-size", "unit": "px" }`。默认值和用户配置仍保存数字，应用样式时才附加单位。

字段可提供 `description`，以及 `translations` 中的语言标签：

```json
{
	"translations": {
		"en": { "label": "Welcome message", "description": "Text in the side panel" },
		"zh-CN": { "label": "欢迎文字", "description": "显示在侧栏的文字" }
	}
}
```

### 稳定样式接口

优先使用 `data-part` 和公开变量，避免依赖内部 DOM 层级。页面区域使用 `region-header/region-leading/region-main/region-trailing/region-footer`；账户公开 `account/account-header/identity/code/next-code/progress` 等部件。保持内容可读、焦点可见，并尊重 `prefers-reduced-motion`。

基础工作区使用 `:where()` 降低上下文选择器的权重。主题中的单个 `[data-part="account"]` 可以覆盖默认布局、间距和字体，无需依赖 `.fluent-app` 或叠加 `!important`。悬停、焦点等状态仍遵循正常 CSS 优先级；需要改变这些状态时，使用对应的 `:hover`、`:focus-visible` 等选择器。账户标题和名称应保留 `min-width: 0` 及省略规则，避免长账户名撑开窄屏布局。

| 用途 | 主要变量                                                           |
| ---- | ------------------------------------------------------------------ |
| 配色 | `--2fa-background/surface/text/muted/accent/border/success/danger` |
| 字体 | `--2fa-font`、`--2fa-code-font`、`--2fa-font-size`                 |
| 布局 | `--2fa-page-width/sidebar-width/gap/card-padding/icon-size`        |
| 效果 | `--2fa-radius/shadow/background-image/opacity/blur/motion`         |

斜杠表示同前缀的多个独立变量，例如 `--2fa-background` 和 `--2fa-surface`。浅深色仍由根节点的 `data-theme="light|dark"` 表示。样式顺序为基础结构、主题默认样式、用户配置、高级 CSS；已有全局自定义代码后置加载，实际覆盖遵循 CSS 级联规则。

## v1 资源与容量

| 项目                  | 上限                                    |
| --------------------- | --------------------------------------- |
| 普通主题 ZIP 上传     | 12MiB                                   |
| 完整外观备份 ZIP 上传 | 12MiB                                   |
| 规范化主题或完整外观  | 10MiB、64 文件                          |
| 单份 CSS／主题描述    | 256KiB／64KiB                           |
| 非内置已安装主题      | 20 个（同格式、同 id 的更新不另占名额） |
| 实例素材库            | 按内容去重后 50MiB，暂存素材也计入      |

完整外观额度包含个人品牌、CSS、配置和全部必要素材。所有允许应用的外观都能导出为可恢复的完整包；恢复目标仍需有足够容量和主题名额，当前运行和上一套外观恢复所需的资源仍受保护。

远程导入共用最多 32 次请求、4 个同时下载、每个资源 3 次重定向、CSS 导入深度 4 层；单请求 10 秒、整个导入 45 秒。地址只接受 HTTPS，私网目标、循环引用和无法静态判断的资源表达式会被拒绝。

已发布外观中的图片、字体和样式在登录前可以访问，适用于品牌和登录页。未发布素材需要登录，不能作为公开图床使用。

v2 使用独立文件类型和容量校验，允许完整构建最多 256 个文件；详细限制见 [v2 包格式](THEME_APP_SDK.md#包格式与构建)。两种格式共用非内置主题名额和实例素材库额度。已发布 v2 包中的 JavaScript 等文件也属于公开资源，主题包中不得放置私有密钥或登录凭据。

## 部署与开发约定

主题权威数据保存在现有 `SECRETS_STORE` 命名空间的独立 `appearance:v1` 对象中，不与密钥操作共用实例。KV 只是主题资源镜像，不能替代主题库和外观配置备份。不需要增加 R2、独立 Worker 或新的存储绑定。

缺少 DO 绑定时只能预览内置主题并保留本机草稿，不能向服务器安装或应用主题。删除 DO 类或迁移至新的 Worker 前，先导出需要保留的完整外观。参见 [部署指南](DEPLOYMENT.md)。

开发和部署使用 `npm run dev`、`npm run deploy`、`npm run build`，以生成一致的构建身份。页面、懒加载模块和离线快照按构建身份隔离。旧标签页缺少匹配版本的模块时会要求先保存编辑，再刷新；不会执行另一构建的模块。详细约定见 [开发文档](DEVELOPMENT.md)。
