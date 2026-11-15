# 自定义主题与外观

2FA 支持两种主题格式，均可在独立仓库制作，无需修改主项目源码。认证、验证码、HOTP、离线队列和账户操作继续使用主程序的同一套业务内核。

| 格式          | 适用范围                                         | 执行方式                                                                 |
| ------------- | ------------------------------------------------ | ------------------------------------------------------------------------ |
| v1 样式和布局 | 调整官方页面的区域、卡片、导航和配色             | 声明式布局、CSS、图片和字体；不执行主题 JavaScript，不接受任意 HTML 模板 |
| v2 完整前端   | 独立组织整个账户界面、交互、像素或手绘等视觉风格 | `kind: "app"` 的受信任 ESM，使用 SDK API 1 接入账户与主机功能            |

**v2 正式运行不是沙箱。** 主题 JavaScript 与 2FA 页面同源，具有页面权限，可访问账户数据和发送网络请求；SDK 的数据投影不构成权限隔离。只应用自己信任的作者和版本。隔离的合成预览与正式运行的信任模型不同。

<!-- APP_THEME_ACTIVATION_STATUS -->

v2 已通过完整资源、恢复路径和独立审核，可安装、联网预览并应用。发布成功后，每台设备仍需准备对应的完整运行资源；资源暂不可用时会保留官方界面或提供安全恢复入口。

v2 作者直接阅读 [完整前端主题与 SDK API 1](THEME_APP_SDK.md)。本文后半部分的布局、绑定和 CSS 示例专用于 v1。

## 制作自己的主题

先按想改的范围选格式：

- **只换配色、卡片和布局**：用 v1，不需要写 JavaScript。按本文「v1 作者：最小可用主题」一节准备 `2fa-theme.json` 和 CSS，打包成 ZIP 即可。
- **自己设计整个界面**：用 v2。从模板仓库 [wuzf/2fa-theme-template](https://github.com/wuzf/2fa-theme-template) 开始，在 GitHub 上点 **Use this template** 创建自己的仓库。模板带有开发预览、测试、打包和校验脚本，README 按步骤说明从创建、本地预览、校验到导入和发布的全过程；接口、清单和验收要求见 [完整前端主题与 SDK API 1](THEME_APP_SDK.md)。

做好的主题按下文「安装自己的主题」导入自己的实例试用，再决定发布到自己的主题目录或投稿官方目录。

## 使用主题

从设置打开 **外观与主题**。弹窗左侧依次是：

- **主题**：官方默认主题和本实例已安装的主题。点击卡片即在右侧预览；已安装主题的卡片右上角可以删除。**导入主题** 选择本机的主题 ZIP（最大 12 MB）安装，安装后同样只预览，点击 **应用外观** 才生效。
- **社区主题**：官方目录 [wuzf/2fa-theme-mytheme](https://github.com/wuzf/2fa-theme-mytheme) 和你添加的主题目录中、本实例尚未安装的主题。来自自己目录的主题会注明「来自 所有者/仓库名」。点击后安装并打开预览；某个目录暂时无法加载时只显示一行提示和 **重试**，不影响其他目录。
- **主题目录**（社区主题下方）：填写公开 GitHub 仓库 `所有者/仓库名` 后点击 **添加目录**，最多 5 个；点 × 移除。移除目录不会删除已经从它安装的主题。
- **主题设置**：当前主题作者声明的选项，例如强调色、圆角、密度和字体；**重置主题设置**恢复作者默认值。

右侧预览使用示例账户，可切换桌面、平板、手机和浅色、深色，并选择账户工作区、登录页、空状态或离线状态。修改只在点击 **应用外观** 后发布到实例；点击 **取消** 或关闭时会确认是否放弃未应用的修改。另一设备修改外观造成冲突时，请重新加载已保存外观后再应用。

安装与应用是两个步骤；安装不会自动执行正式主题。v2 应用前有同源脚本的受信确认。每个“格式 + 主题 id”只保留一个已安装版本，从社区更新会替换该主题的已安装条目。新包校验或保存失败时保留原条目；安装成功后先预览配置迁移结果，再应用。配置按“格式 + 主题 id”隔离；系统保留同名、同类型且仍有效的字段，新增字段使用默认值，失效或移除的设置会提示调整。

社区主题下方的 **自动更新官方主题** 默认开启，关闭后不再自动更新。开启时，每天北京时间 0 点的定时任务检查一次官方目录：从官方目录安装的主题有新版本时自动安装；当前正在使用的主题直接换成新版，设置按上面的规则保留。以下情况不自动更新，仍在社区主题中显示 **更新主题**，由你手动处理：

- 导入的 ZIP 和自己添加的主题目录中的主题（这些主题没有经过官方目录的审核）；
- 新版要求更高版本的 2FA；
- 新版申请了旧版没有的权限（`capabilities`）；
- 正在使用的主题有设置在新版中失效、改了类型或被移除。

最近的自动更新和需要手动处理的更新会显示在开关下方。手动导入旧版 ZIP 可以退回旧版本；导入的主题之后不再自动更新，从官方目录重新安装后才会恢复。

### 安装自己的主题

主题会在本站以你的身份运行脚本，只安装你信任来源的主题。有三种方式：

1. **导入主题**：在 **外观与主题** 中选择构建好的 `2fa-theme.zip`。适合自己开发或只在本实例使用的主题。
2. **自己的主题目录**：建一个公开 GitHub 仓库，结构与官方目录相同：根目录的 `catalog.json` 加上 `themes/<主题 id>/2fa-theme.zip`，`catalog.json` 中的 `sha256`、`size` 和 `packageId` 与包一致（可复制官方仓库的 `npm run catalog` 生成）。实例只读取该仓库 `main` 分支的这两类文件，不跟随作者链接或其他地址；私有仓库无法读取。在主题目录中添加 `所有者/仓库名` 后，其中的主题出现在社区主题里，更新时推送新的包和 `catalog.json` 即可。
3. **上架官方目录**：向公共仓库 **`wuzf/2fa-theme-mytheme`** 提交 PR。按公共仓库的贡献指南，将完整包、主题信息和许可提交到 `themes/<主题 id>/`，生成目录索引，经维护者审核合并后即可在所有实例的社区主题中选择。

不提供从任意网址安装。

公共仓库保存主题代码、样式、图片、字体及许可的完整副本。作者仓库链接只作来源说明，安装不依赖该仓库或其 Release；作者仓库改名、转为私有或删除，不影响已经合并的主题。更新时提交 PR 覆盖同一目录中的 `2fa-theme.zip` 和信息，不新增版本目录。

### 完整前端预览与本设备运行

v2 预览需要联网，运行包内真实构建产物，但账户、验证码及操作结果都是合成数据。预览窗口仅允许脚本执行，不向主题提供登录凭据或真实账户 SDK；预览按钮不会真实修改账户或复制密钥。每次预览授权固定有效 **5 分钟**，普通配色、文字、模式和尺寸变化不会延长有效期；到期后点击 **更新预览**。每个登录所有者最多同时保有 2 个预览，每分钟最多创建 6 个；关闭窗口和会话失效会撤销本地预览，远端撤销失败时仍受固定到期时间约束。

**已发布、本页已运行、本设备离线就绪是三个状态。** 服务端保存成功不表示每个浏览器已经完成启动。v2 启动前，本设备需要准备对应主机构建、主题所有文件及独立恢复页，并取得当前 Service Worker 的运行许可。未受控制、空间不足、资源缺失或不兼容时保留官方界面或给出恢复入口；不要手动清缓存来跳过准备。从 1.13.1 或更早的版本升级后，浏览器里还是不能运行 v2 主题的旧版 Service Worker：只开着一个 2FA 页面时，应用或打开 v2 主题会先下载主题，再换成新版 Service Worker 并自动刷新一次；同时开着其他 2FA 页面（包括已安装的应用）时会提示先关闭它们，关闭后点「重试」即可。

不同 app 包之间的切换和升级需要完整刷新。相同 app 包只修改设置时，主机可在当前页面重新准备并挂载；主题应清理旧挂载。旧标签页不会混用新旧构建模块，尚未保存的编辑、在途写入和 HOTP 操作会阻止不安全的刷新。

首次从未缓存的设备离线访问不保证可用。即使已经离线就绪，浏览器主动清理站点存储仍可能使资源不可用；明确的登录拒绝也不会被离线缓存掩盖。HOTP 离线时不能执行需要服务端预留计数器的复制。

## 恢复

账户自动备份不包含主题。

如果主题或代码导致页面无法操作，访问：

```text
https://你的域名/?safeMode=1
```

该入口临时停用主题和已有自定义代码，使用独立基础界面。旧的 `disableCustomCode=1` 恢复链接继续有效。保存修改不会自动离开安全模式，使用明确的退出按钮才会重新加载已保存配置。

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

### 协议与版本

`themeApiVersion` 固定为 `1`，它与应用版本、主题自身版本独立。`id` 为 1–64 位字母、数字、下划线或短横线，不能使用保留的 `builtin-` 前缀；`name` 必填，`version` 使用语义化版本，例如 `1.2.0`。

同一 `id` 表示同一个主题系列。同格式、同 id 的新包替换已安装条目，仅保留一个可选择版本。系统内部仍根据规范化内容计算不可变 `packageId`，正在运行的页面和隔离预览所引用的资源不会在更新途中被覆盖；这些资源不属于可浏览的历史版本，无引用后按回收规则清理。未识别的清单字段会被拒绝，请通过已支持的配置字段扩展主题。

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

斜杠表示同前缀的多个独立变量，例如 `--2fa-background` 和 `--2fa-surface`。浅深色仍由根节点的 `data-theme="light|dark"` 表示。样式顺序为基础结构、主题默认样式、用户配置；已有全局自定义代码后置加载，实际覆盖遵循 CSS 级联规则。

## v1 资源与容量

| 项目               | 上限                                    |
| ------------------ | --------------------------------------- |
| 主题 ZIP           | 12MiB                                   |
| 规范化主题         | 10MiB、64 文件                          |
| 单份 CSS／主题描述 | 256KiB／64KiB                           |
| 非内置已安装主题   | 20 个（同格式、同 id 的更新不另占名额） |
| 实例素材库         | 按内容去重后 50MiB，暂存素材也计入      |

已发布外观中的图片、字体和样式在登录前可以访问。未发布素材需要登录，不能作为公开图床使用。

v2 使用独立文件类型和容量校验，允许完整构建最多 256 个文件；详细限制见 [v2 包格式](THEME_APP_SDK.md#包格式与构建)。两种格式共用非内置主题名额和实例素材库额度。已发布 v2 包中的 JavaScript 等文件也属于公开资源，主题包中不得放置私有密钥或登录凭据。

## 部署与开发约定

主题权威数据保存在现有 `SECRETS_STORE` 命名空间的独立 `appearance:v1` 对象中，不与密钥操作共用实例。KV 只是主题资源镜像，不能替代主题库和外观配置备份。不需要增加 R2、独立 Worker 或新的存储绑定。

缺少 DO 绑定时只能预览内置主题，不能向服务器安装或应用主题。删除 DO 类或迁移至新的 Worker 后需要重新安装主题。参见 [部署指南](DEPLOYMENT.md)。

开发和部署使用 `npm run dev`、`npm run deploy`、`npm run build`，以生成一致的构建身份。页面、懒加载模块和离线快照按构建身份隔离。旧标签页缺少匹配版本的模块时会要求先保存编辑，再刷新；不会执行另一构建的模块。详细约定见 [开发文档](DEVELOPMENT.md)。
