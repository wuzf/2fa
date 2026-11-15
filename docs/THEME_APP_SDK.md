# 完整前端主题与 SDK API 1

本文面向独立主题仓库作者，对应当前实现的 `themeApiVersion: 2`、`kind: "app"`、`sdkApiVersion: 1`。用户安装、离线与安全模式说明见 [主题指南](THEMES.md)。v1 CSS/layout 主题仍使用原协议，不能把 JS 塞进 v1 包。

第一次制作建议从模板仓库 [wuzf/2fa-theme-template](https://github.com/wuzf/2fa-theme-template) 开始：它已经按本文实现账户列表、管理菜单、各种状态和 15 种语言，并带有开发预览、测试、打包和主机校验脚本，README 按步骤说明。本文是接口与验收的完整参考。

<!-- APP_THEME_ACTIVATION_STATUS -->

完整前端运行层已通过独立审核，社区目录安装、联网隔离预览和发布入口已开放。发布不会跳过设备端的完整资源准备、SDK 许可及安全恢复检查；不要修改 Service Worker 来绕过这些检查。

完整主题正式运行于 2FA 同源页面，**不是安全沙箱**。SDK 不直接提供种子、认证 fetch 或原始离线写队列，但这不意味着主题脚本没有同源页面权限。包扫描用于资源与构建兼容校验，不是对任意 JavaScript 的安全审计；清单的 `capabilities` 也是描述性字符串，不是授权或隔离机制。

## 挂载接口

入口必须是浏览器 ESM，并导出 `mount`：

```js
export function mount({ root, sdk, appearance, signal }) {
	// 只管理 root 内的主题界面。
	return {
		update(nextAppearance) {}, // 可选；接收新的完整配置
		unmount() {}, // 清理订阅、事件、计时器和自建节点
	};
}
```

`mount` 可以返回 Promise、清理函数，或含可选 `update/unmount` 的对象。主机在完整资源准备和当前页面许可就绪后才导入入口；正式 app 只在已确认的账户会话下启动。不要在模块顶层启动定时器、读账户或改页面；把所有有副作用的工作放入 `mount`。

| 参数         | 合同                                                                                    |
| ------------ | --------------------------------------------------------------------------------------- |
| `root`       | 本次挂载的独立 DOM 根节点；不是整个 document，也不是官方账户 DOM                        |
| `sdk`        | 本次挂载的 API 1 实例，账户内核与官方界面共用                                           |
| `appearance` | 冻结的 `{kind, packageId, package, revision, settings, baseUrl, files}`；与账户快照分开 |
| `signal`     | 本次挂载的 AbortSignal；失效后停止新命令和界面反馈                                      |

`appearance.package` 为 `{id,name,version}`；`files` 每项为 `{path,url,mime,size,hash}`。使用 `appearance.settings`，不要试图修改冻结对象。主机不再向主题提供品牌信息，站点名称固定为 2FA；需要构建包内文件时可使用 `new URL('./assets/picture.png', import.meta.url)`。

完整导航用于不同包的切换与升级；同包配置变化可以在当前页重新准备、卸载和挂载。**不能假设只会调用 `update`，也不能要求每次重新求值 ESM 顶层。** 预览支持 `update`，未实现时使用同一预览授权重新挂载。每次重新挂载都获得新的 scope，不能复用上次的 SDK、复制票据、DOM 引用或异步结果。

`unmount` 和 `signal.abort` 不会撤销已经开始的原生剪贴板或服务端事务，也不能收回任意同源 ESM 已求值的权限。所有异步回调须再次检查挂载、会话和有关账户的代次，再更新界面；业务事实交给主机记录。

## 最小挂载示例

下面是可运行的账户显示与设置入口示例，用于验证包和生命周期；完整发布主题还需实现后文列出的账户、菜单、恢复、键盘和空状态入口。它读取主机已提交的验证码，不自行计算 OTP。

```js
// entry.js
export function mount({ root, sdk, appearance, signal }) {
	if (signal.aborted) return;
	let active = true;
	let config = appearance;
	root.dataset.themeDemo = '';
	const title = document.createElement('h1');
	const settings = document.createElement('button');
	settings.type = 'button';
	const list = document.createElement('ul');
	root.append(title, settings, list);

	settings.onclick = () => {
		if (active && !signal.aborted) {
			sdk.host.open({ kind: 'settings', section: 'preferences' }, { returnFocus: settings });
		}
	};
	function render(snapshot) {
		if (!active || signal.aborted) return;
		title.textContent = config.package.name;
		settings.textContent = sdk.i18n.t('fabSettings');
		const byId = new Map(snapshot.library.accounts.map((account) => [account.ref.id, account]));
		list.replaceChildren(
			...snapshot.library.view.resultIds.map((id) => {
				const account = byId.get(id);
				const row = document.createElement('li');
				row.textContent = `${account.service.label} · ${account.accountLabel} · ${account.otp.current?.value || '…'}`;
				return row;
			}),
		);
	}
	const unsubscribe = sdk.subscribe(render); // 同步交付一次当前快照
	function unmount() {
		if (!active) return;
		active = false;
		unsubscribe();
		signal.removeEventListener('abort', unmount);
		settings.onclick = null;
		root.replaceChildren();
	}
	signal.addEventListener('abort', unmount, { once: true });
	return {
		update(nextAppearance) {
			config = nextAppearance;
			render(sdk.getSnapshot());
		},
		unmount,
	};
}
```

```css
/* theme.css：限定在自己的根节点，避免覆盖主机弹窗。 */
[data-theme-demo] {
	font-family: system-ui, sans-serif;
	padding: 1rem;
	color: #172025;
	background: #f7faf8;
}
[data-theme-demo] button:focus-visible {
	outline: 3px solid #18724d;
	outline-offset: 3px;
}
[data-theme='dark'] [data-theme-demo] {
	color: #edf4ef;
	background: #172025;
}
```

生产主题请使用稳定节点或框架的 keyed 更新，避免每次快照重建正在聚焦的按钮或输入框。自己的路由限于 `#/theme/<主题命名空间>/...`，例如 `#/theme/pixel/accounts`；SDK 没有公开 router 方法。不要接管 `/otp`、OAuth、API、模块或安全模式路由，也不要自行注册或接管 Service Worker。

## 包格式与构建

ZIP 根目录直接放清单和构建产物，不包仓库顶层目录，不上传 GitHub 自动生成的源码 ZIP：

```text
2fa-theme.zip
├── 2fa-theme.json
├── entry.js
├── theme.css
├── chunks/
│   └── detail.js
├── assets/
│   ├── background.webp
│   └── font.woff2
└── licenses/
    └── theme.txt
```

`2fa-theme.json` 的基础部分如下；`files` 必须由实际输出字节生成，不能填写占位哈希：

```json
{
	"themeApiVersion": 2,
	"kind": "app",
	"sdkApiVersion": 1,
	"id": "my-authenticator",
	"name": "My Authenticator",
	"version": "1.0.0",
	"author": "Theme author",
	"description": "A standalone 2FA frontend",
	"entry": "entry.js",
	"styles": ["theme.css"],
	"settings": [
		{ "key": "accent", "type": "color", "label": "Accent", "default": "#18724d" },
		{ "key": "compact", "type": "boolean", "label": "Compact", "default": false }
	],
	"files": []
}
```

上面空 `files` 仅用于展示待生成的清单结构，直接导入会被拒绝。以下独立仓库脚本可把只含构建产物的 `build/` 目录打包；将上述基础对象保存在仓库根的 `theme.config.json`，安装 `fflate` 后执行 `node scripts/package.mjs`：

```js
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { zipSync } from 'fflate';

const root = path.resolve('build');
const mime = {
	js: 'text/javascript',
	mjs: 'text/javascript',
	css: 'text/css',
	json: 'application/json',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
	gif: 'image/gif',
	woff2: 'font/woff2',
	txt: 'text/plain',
};
async function walk(directory, prefix = '') {
	const files = [];
	for (const item of await readdir(directory, { withFileTypes: true })) {
		const relative = prefix + item.name;
		if (item.isDirectory()) files.push(...(await walk(path.join(directory, item.name), relative + '/')));
		else if (item.isFile() && relative !== '2fa-theme.json') files.push(relative);
		else if (!item.isFile()) throw new Error('Unsupported entry: ' + relative);
	}
	return files.sort();
}
const names = await walk(root);
const entries = Object.create(null);
const files = [];
for (const name of names) {
	const bytes = new Uint8Array(await readFile(path.join(root, name)));
	const type = mime[name.split('.').pop()];
	if (!type) throw new Error('Unsupported file: ' + name);
	files.push({ path: name, mime: type, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
	entries[name] = bytes;
}
const config = JSON.parse(await readFile('theme.config.json', 'utf8'));
entries['2fa-theme.json'] = new TextEncoder().encode(JSON.stringify({ ...config, files }));
await mkdir('release', { recursive: true });
await writeFile('release/2fa-theme.zip', zipSync(entries));
```

该脚本生成清单，不替代主机校验。完整 inventory 应包含所有入口、二级/三级 lazy chunk、CSS、JSON、图片、字体和许可证，包含未访问过的页面所需资源。每项 `size` 是字节数，`sha256` 是原始字节的 64 位小写十六进制 SHA-256；不能在生成哈希后再压缩 JS、替换换行或修改素材。

路径与引用规则：

- 文件路径为 1–240 字符的 ASCII 相对路径，仅允许字母、数字、`.`、`_`、`-`、`/`；无空段、`.`/`..` 段、反斜杠、查询串、fragment、百分号或大小写等价冲突。
- `2fa-theme.json` 不放进 `files`；包内不能出现清单之外的文件。
- JS 只接受 `.js/.mjs` ESM。静态 import/export 与动态 `import()` 必须引用包内相对路径；动态目标必须是字符串字面量或无插值模板。可用 `import('./chunks/detail.js')`，不可用包名裸 import、CDN import 或 `import(variable)`。将框架及依赖打包进产物。
- `../` 只可用于引用并必须留在包内。`new URL('./assets/picture.png', import.meta.url)` 的静态目标也会核对 inventory。任意运行时代码的行为不由这些静态检查保证安全。
- CSS 通过 `styles` 数组声明，最多 32 项；不要把 `import './theme.css'` 留在浏览器 ESM 中。CSS `@import`、`url()` 与 image-set 素材必须是包内相对资源；不依赖远程字体或 CSS。规则支持的本文件 `#fragment` 不产生新的文件。
- 文件类型仅有 JS/MJS、CSS、JSON、PNG、JPEG、WebP、GIF、WOFF2，以及 `licenses/` 下的 TXT。没有 HTML 入口、SVG、WASM、source map 或任意可执行附件。字体和图片必须通过文件魔数/类型校验。
- 正式样式要限定在主题自己的根节点。自定义字体族和 keyframes 也应有主题前缀；保留主机弹层、焦点和屏幕阅读器语义。

| 项目                                           | v2 上限                                             |
| ---------------------------------------------- | --------------------------------------------------- |
| ZIP 上传                                       | 12 MiB                                              |
| 完整便携表示（含清单、个人配置、素材、许可证） | 10 MiB / 256 文件                                   |
| manifest `files`                               | 1–255 项，给清单留出名额；备份另需配置/个人素材名额 |
| 单份 JS / CSS                                  | 4 MiB / 1 MiB                                       |
| 清单                                           | 128 KiB                                             |
| 非内置主题 / 全实例去重素材                    | 与 v1 共用 20 个主题 / 50 MiB；同主题更新不另占名额 |

`id` 使用 1–64 位字母、数字、下划线或短横线，不能使用 `builtin-` 前缀。`version` 为 SemVer；同系列沿用 id，内容变化得到新不可变 packageId。可选 `minHostVersion` 是最低主机 SemVer，主机在预览和应用时检查；仅设置 `sdkApiVersion:1` 不会跳过主机版本或完整资源检查。

可选 `preview` 是包内一张 PNG、JPEG 或 WebP 截图的路径（必须在 `files` 中），显示在外观编辑器的主题卡片上，按 16:10 从左上角裁切，建议 640×400。截图请用示例数据，不要包含真实账户。没有 `preview` 或图片加载失败时，卡片显示主题 `public-appearance.json` 的配色。

### PR 上架到社区目录

主题公共仓库为 **[wuzf/2fa-theme-mytheme](https://github.com/wuzf/2fa-theme-mytheme)**。作者在自己的仓库开发和构建，向公共仓库提交 PR，收录完整产物：

```text
themes/<manifest.id>/
├── 2fa-theme.zip   完整构建包，内含全部运行资源和必要许可
├── theme.json     贡献指南要求的来源与许可信息
└── LICENSE        分发许可
```

遵循公共仓库的 CONTRIBUTING 文档生成并提交 `catalog.json`。索引中的主题身份、名称、版本、包身份、大小和 SHA-256 来自实际 ZIP；校验通过并经维护者合并后，用户可在 2FA 的 **外观与主题 → 社区主题** 直接选择安装。CI 只静态验证投稿产物，不执行主题 JavaScript 或作者的构建脚本。

公共仓库必须实际保存 ZIP 与全部资源，不能只登记作者的 Release 下载地址、子模块或外链。作者仓库仅用于开发和来源说明，删除、改名或转为私有不会影响已合并的主题。主题文件不能依赖作者站点的字体、图片、JS 或 CSS。

同一主题只有一个当前条目。更新时沿用 id、更新 SemVer、重新构建并通过 PR 覆盖 `themes/<id>/2fa-theme.zip`，同步元数据与索引，不建立多个版本目录。应用安装同格式同 id 的新包会替换已安装条目；内部内容哈希、当前运行资源与应急恢复引用仍保持一致，不能原地修改某个已经运行的 chunk。

### 使用未上架的主题

上架不是使用主题的前提。实例所有者可以：

- 在 **外观与主题 → 导入主题** 上传构建好的 `2fa-theme.zip`（最大 12 MB）；
- 在 **主题目录** 中添加自己的公开 GitHub 仓库（`所有者/仓库名`，最多 5 个）。仓库结构与官方目录相同：`main` 分支根目录的 `catalog.json` 加 `themes/<id>/2fa-theme.zip`，可复制官方仓库的 `npm run catalog` 生成索引。实例只读取这两类文件并核对 SHA-256、大小和 packageId。

不支持从任意 HTTPS 地址或作者 Release 安装。2FA 不在服务器执行 npm install/build。这两种方式同样遵循单主题覆盖规则，安装后需预览并应用。

## 主题设置

v2 设置只包含纯数据，没有 v1 `binding`、layout、content、tokens、customCss，也不支持服务器迁移 JavaScript。清单最多 64 个字段：

| 类型                | 字段规则                                           |
| ------------------- | -------------------------------------------------- |
| `boolean`           | 布尔默认值                                         |
| `color`             | `#RGB/#RGBA/#RRGGBB/#RRGGBBAA`                     |
| `number`            | 有限数字，可带 min/max 和正数 step                 |
| `select`            | 1–64 个 `{value,label}` 字符串选项，默认值必须匹配 |
| `text` / `textarea` | 最大 2048 / 16384 字符，不含 NUL                   |

每项允许 `key/type/label/description/default/min/max/step/options`，不接受未知字段。v2 字段标签和说明目前是字符串，**不接受 v1 的 `translations` 字段**；主题自有界面翻译由作者提供，主机入口标签使用 `sdk.i18n.t`。

编辑器按“格式 + id”保存配置，升级时保留相同类型的合法值，失效值回退默认并提示。`appearance.settings` 是主机外观配置，`sdk.preferences` 则是用户语言、明暗与显示偏好，两者不是同一份状态。

## SDK 快照与方法

所有快照、票据和公开配置均只读。`sdk.subscribe(listener)` 同步发送一次当前快照，之后按变更推送，返回取消订阅函数；不要按秒重新获取账户或手工计算验证码。未确认会话与已退出会话需要显示对应入口，不能用示例账户伪装真实空状态。

| 快照字段                                     | 用途                                                                                                             |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `snapshotId/revision/epochs`                 | 本 scope 快照版本与 session/data/clock 代次；不是外观 revision                                                   |
| `session.state/accessVerified`               | `authenticated/unconfirmed/logged-out` 与会话确认状态                                                            |
| `library.state/source/refreshState/errorKey` | 初始加载、来源、刷新与失败提示；刷新不等于已有数据必须清空                                                       |
| `library.accounts`                           | 所有公开账户：ref、service、accountLabel、type、digits、algorithm、period 或 counter、OTP 展示、availableActions |
| `library.view`                               | 统一筛选/排序结果：resultIds、services、groups、found/queryFound/total 及当前选择                                |
| `library.hidden`                             | 隐藏异常账户数量与允许展示的诊断；操作走 host 入口                                                               |
| `connectivity/clock/queue`                   | 连接提示、主机时钟与离线队列摘要；queue.operations 不含写入 body                                                 |
| `preferences/host`                           | 语言/主题偏好；弹窗、未保存、写入与 HOTP 操作摘要等                                                              |

账户 `ref` 是 `{id,generation}`。`service` 含 label/groupId 和可选 iconURL。`otp` 含 `state/displayRevision/current/next/operation`；HOTP 没有 next。已提交 code 含 `value/snapshotId/copyAvailability`，TOTP 另有 `validFrom/validUntil` 毫秒时间。展示筛选结果应按 `library.view.resultIds` 找账户；不要把 `library.accounts` 全部当作当前可见项。

| 公开方法                              | 参数与返回要点                                                          |
| ------------------------------------- | ----------------------------------------------------------------------- |
| `sdk.getSnapshot()`                   | 当前冻结快照                                                            |
| `sdk.subscribe(listener)`             | 返回 unsubscribe                                                        |
| `sdk.clock.now()`                     | 主机校正后的毫秒时间；挂载失效时 null。适合进度显示，不参与自行生成 OTP |
| `sdk.view.setQuery(text)`             | 统一搜索，自动 trim/小写；与服务筛选取交集                              |
| `sdk.view.setServiceFilter(groupId)`  | 使用快照的 groupId，null 清除                                           |
| `sdk.view.setMode(mode)`              | `grouped` 或 `flat`                                                     |
| `sdk.view.setSort(patch)`             | groupSort/flatSort/groupedItemSort 的有效组合，见下文                   |
| `sdk.otp.readCopyTarget(id, slot)`    | 同步返回 `{status:'ready',target}` 或 not-ready；slot 是 current/next   |
| `sdk.otp.copy(target)`                | 传回原始票据，返回 Promise 操作结果                                     |
| `sdk.otp.reconcile(operationId)`      | 对已有 HOTP 操作只读对账；成功为 committed，不再次复制/预留             |
| `sdk.accounts.refresh()`              | 主机账户刷新，Promise 结果，成功状态为 loaded                           |
| `sdk.accounts.copyURI(ref)`           | 真实账号 ref；Promise 复制结果                                          |
| `sdk.accounts.copyShareLink(ref)`     | 真实账号 ref；Promise 复制结果                                          |
| `sdk.host.listActions()`              | 入口元数据：actionId/labelKey/request/requires/enabled/reason           |
| `sdk.host.open(request, options?)`    | 返回带 closed Promise 的 flow；options 可带 returnFocus DOM 节点        |
| `sdk.host.setAppearance(tokens)`      | 可选同步宿主视觉接口；只有已就绪 app scope 生效，详见下节               |
| `sdk.preferences.set(patch)`          | 仅允许 language/theme/defaultViewMode/otpAnimation，Promise 结果        |
| `sdk.i18n.t(key, params?)`            | 主机文案；自定义主题词条需自建词典                                      |
| `sdk.lifecycle.requestReload(reason)` | theme-change/update/recovery，Promise 结果；受未保存/事务保护           |

`identity` 是只读属性，含 `hostBuild/sdkApiVersion/packageId/appearanceRevision/mode`，正式 SDK 的 mode 为 `live`、预览为 `preview`。它属于本次挂载，不会随着外观发布自动变成新运行身份。

排序合法值：groupSort 为 `name-asc/name-desc`；flatSort 为 `oldest-first/newest-first/name-asc/name-desc/account-asc/account-desc`；groupedItemSort 为 `oldest-first/newest-first/account-asc/account-desc`。同步 view 命令通常返回 committed/unchanged/rejected，committed 可另带 persistence；以返回结果和后续快照为准。

偏好合法值：language 为 `auto` 或主机支持的 15 个语言代码；theme 为 `auto/light/dark`；defaultViewMode 为 `remember/grouped/flat`；otpAnimation 为 `none/flow/flip/spotlight`。resolvedLanguage/resolvedTheme/reducedMotion 是读取状态，不是可写字段。其他设置通过主机设置对话框修改。

## 可选宿主视觉接口

`sdk.host.setAppearance(tokens)` 是 API 1 的可选增量，不增加 manifest 字段。旧主题不调用时，主机保持原有外观；新主题须先检查方法是否存在，旧主机可以继续显示主题账户页与官方默认弹窗。

```js
if (typeof sdk.host.setAppearance === 'function') {
	sdk.host.setAppearance({
		surface: '#fffdf7',
		text: '#1b1b1f',
		stroke: '#1b1b1f',
		accent: '#a8d49b',
		accentHover: '#94c486',
		accentText: '#1b1b1f',
		radius: 0,
		controlRadius: 0,
		borderWidth: 2,
		fontFamily: ['Pixel2FA Text', 'Microsoft YaHei', 'sans-serif'],
		shadow: { x: 4, y: 4, blur: 0, spread: 0, color: '#1b1b1f' },
		controlShadow: null,
	});
}
```

返回值同步为 `{status:'completed'}`，或 `{status:'rejected',reason}`；reason 为 `invalid-appearance`、`mount-invalidated` 或 `unavailable`。completed 只表示视觉参数已接受，不是保存业务设置或发布成功。在 mount 阶段参数仅暂存，主机确认 startup ready 后才激活。

合法对象**替换整份**视觉配置，不累积 patch；缺失字段保持官方默认。整个参数 `null` 恢复当前 scope 的默认外观；`shadow:null` 或 `controlShadow:null` 仅关闭相应阴影。非法或未知字段整份拒绝并保留上一份有效配置。

| 字段                                                            | 允许值                                                                                                         |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `surface/subtle/hover/text/muted/line/stroke`                   | `#RGB/#RGBA/#RRGGBB/#RRGGBBAA`                                                                                 |
| `accent/accentHover/accentText/selected`                        | 同上；主按钮填充、悬停、文字及选中背景                                                                         |
| `danger/dangerBackground/dangerFill/dangerFillHover/dangerText` | 同上；危险提示与危险按钮分别设置                                                                               |
| `warning/warningBackground/success/successBackground`           | 同上；提示与状态颜色                                                                                           |
| `radius/controlRadius/borderWidth`                              | 有限 number，分别为 0–24、0–16、1–3，单位 px；不接受数字字符串                                                 |
| `shadow/controlShadow`                                          | `null` 或完整 `{x,y,blur,spread,color}`；x/y 为 −8–8，blur 为 0–64，spread 为 0–8，均为有限 number，color 同上 |
| `fontFamily`                                                    | 1–8 个非空字体族名称字符串，每项最多 80 字符；不接受控制符和 CSS 结构字符                                      |

字体族由主机安全序列化，`sans-serif`、`system-ui` 等通用族保持 CSS 关键字含义。只引用主题已有字体或系统 fallback，主机不会下载新字体。不接受 `var()`、URL、任意 CSS、选择器或控制布局、字号、定位、遮罩、z-index、display、pointer-events 的参数。

作用范围为官方弹窗及其控件、内部菜单和官方 toast，明确排除 `#appThemeRoot` 及其子树。主题仍自行绘制账户页面与账户菜单；方法不改变业务表单 DOM、校验、焦点、关闭、保存和离线行为。

每次挂载有独立 owner。卸载、失败、登出、许可失效、页面离开及官方回退会由主机同步清理，不依赖主题异步 unmount；旧 owner 不能修改或清理新 owner 的样式。safeMode 不激活此接口，视觉参数不写服务器或 localStorage。主题在 resolvedTheme、强调色、字体设置变化时发送新的完整对象即可，应按值去重；主机也会去重且不会因此发布账户快照。

隔离预览的 mock SDK 使用同一校验规则，只在 iframe 内保存和清理这些视觉参数，不通过 RPC 修改父页面弹窗。现有预览 `host.open` 仍为模拟命令，不提供真实业务表单；弹窗的实际外观和操作须在正式宿主的隔离测试实例验证。

## 复制票据与 HOTP

复制时在真实用户点击的同步调用栈中获取票据并调用 `copy`。不要先 await 动态 import、网络请求或动画；不要从 DOM 文本复制，不要缓存、克隆、序列化或拼装 target。target 与当前 SDK 实例绑定；跨窗口、跨账户代次和挂载失效时，主机重新核验并拒绝旧票据。

```js
// 将返回函数直接绑定到本次挂载的按钮 onclick。
function copyHandler(sdk, signal, accountId, slot, showOutcome) {
	return () => {
		if (signal.aborted) return;
		const before = sdk.getSnapshot();
		const account = before.library.accounts.find((item) => item.ref.id === accountId);
		if (!account) return;
		const read = sdk.otp.readCopyTarget(accountId, slot);
		if (read.status !== 'ready') return;
		// 动效可在此同步结束；票据始终保持原对象。
		sdk.otp.copy(read.target).then((outcome) => {
			if (signal.aborted) return;
			const current = sdk.getSnapshot();
			const latest = current.library.accounts.find((item) => item.ref.id === accountId);
			if (current.epochs.session !== before.epochs.session || latest?.ref.generation !== account.ref.generation) return;
			showOutcome(outcome); // 同时结合 host.operations 展示在途/未知事实。
		});
	};
}
```

HOTP 复制包含独立事实：`clipboard`、`reservation`、`localCommit`、`reconciliation`、`counterAdvanced` 与 `recovery`。`status:'settled'` 不表示全部成功，剪贴板成功也不代表计数器预留已确认；5xx/网络未知不能显示为明确拒绝。订阅 `snapshot.host.operations` 以及账户的 `otp.operation`，即使账户被筛选隐藏，也保留在途状态与恢复入口。

在途或结果未知时**不能自动重试复制、再次预留或回退本地 counter**。由用户调用 `sdk.otp.reconcile(operationId)` 获取权威状态，必要时再请求 `sdk.lifecycle.requestReload('recovery')`；主机会判断资格并确认。HOTP 离线不可预留，按钮应反映 copyAvailability/连接/操作状态。对账成功只说明读取了服务器现状，不证明某次未知请求是否恰好推进计数器。旧挂载晚返回的结果不应重新打开 toast、弹窗或改变新页面。

## 有类型的主机入口

账户表单、密码、备份、同步服务等使用现有主机流程；主题不重复实现账户 API。`host.open()` 开始返回 opening 并带 closed Promise，立即拒绝也带已决议的 closed。`closed` 只是弹窗已关闭，不等于保存成功；可能结果还包括 cancelled/committed/queued-offline/completed/rejected/unknown/session-invalidated。根据快照和明确业务结果更新界面。

| `request.kind`                                                | 参数                                                                              |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| login、logout、account-add                                    | 无                                                                                |
| account-edit、account-delete、account-qr                      | `account: account.ref`，必须是最新代次                                            |
| scan-import、import、export、backup、tools                    | 无                                                                                |
| tool                                                          | `tool: 'qr-decode'/'qr-generate'/'base32'/'timestamp'/'key-check'/'key-generate'` |
| settings                                                      | 可选 `section: 'security'/'preferences'/'sync'/'custom-code'`，默认 security      |
| sync-provider                                                 | `provider: 'webdav'/'s3'/'onedrive'/'gdrive'`                                     |
| appearance、recovery、hidden-accounts、offline-queue          | 无                                                                                |
| offline-queue-edit、offline-queue-retry、offline-queue-cancel | `operationId` 来自队列摘要                                                        |
| offline-queue-status-retry、extension、pwa-install、quick-otp | 无                                                                                |

`listActions()` 的账户/队列入口提供 requires 标记，不能把缺少 account/operationId 的模板直接提交。填写最新 ref 或真实队列 operationId，不把库内 HOTP operationId 当作离线队列 ID。仅使用表内字段，额外未知参数会被拒绝，最终许可仍由 open 检查。

`listActions()` 是能力清单，主题应根据功能用途与当前快照组织导航。`requires:null` 只表示无需额外参数，`enabled:true` 也不表示当前需要展示该操作。添加、导入、备份、设置等用户功能暂不可用时，可以保留可发现的入口及原因；隐藏账户、离线队列和队列状态重试则由有对应记录或异常的状态区域承接，无需无条件复制到管理菜单。状态消失时应处理焦点返回，宿主弹窗持有焦点时不要抢焦点；可能消失的状态按钮打开 host flow 时，应传入稳定可见的 `returnFocus`。

会话需区分 `authenticated/unconfirmed/logged-out`：未确认会话仍可能有本地数据，不能移除其退出/锁定路径。安装入口结合 `host.installAvailable` 与 descriptor 可用性展示；更新操作仅在 `host.updateAvailable/versionMismatch` 时提示。恢复默认界面和独立验证码生成器是用户功能，其操作名称可使用 `appearanceUseDefault` 和 `quickOtpTitle`，不要把安全模式状态句或应用标题用作按钮名称。主题自定布局时仍需保留这些能力的合适入口，不改变 SDK 鉴权与命令契约。

```js
const account = sdk.getSnapshot().library.accounts.find((item) => item.ref.id === selectedId);
if (account) {
	const flow = sdk.host.open({ kind: 'account-edit', account: account.ref }, { returnFocus: editButton });
	const result = await flow.closed;
	if (!signal.aborted && result.status === 'committed') {
		// 只处理明确提交结果；通常以 subscribe 中的新账户快照刷新列表。
	}
}
```

## 隔离预览、离线与验收

### 可选公共静态外观

包可在根目录提供 `public-appearance.json`，并将其作为 `application/json` 普通文件加入既有 `manifest.files` 的 size/SHA256 清单。不要新增 manifest 顶层字段；themeApiVersion 2 / sdkApiVersion 1 保持不变。旧主机只把它当普通文件，新主机在安装、预览和发布时严格验证。没有此文件时维持官方默认，存在但非法时拒绝整个操作，不能以“忽略外观”继续安装。

```json
{
	"formatVersion": 1,
	"light": { "surface": "#fffdf7", "text": "#222222", "fontFamily": ["My Font", "sans-serif"] },
	"dark": { "surface": "#222222", "text": "#eeeeee", "fontFamily": ["My Font", "sans-serif"] },
	"fonts": [{ "family": "My Font", "path": "assets/font.woff2", "weight": [400, 700], "unicodeRange": "U+0000-00FF" }],
	"variants": [
		{
			"setting": "handwriting",
			"values": { "false": { "light": { "fontFamily": ["sans-serif"] }, "dark": { "fontFamily": ["sans-serif"] } } }
		}
	]
}
```

`light` / `dark` 及每项变体 patch 采用 `sdk.host.setAppearance()` 相同的有限 token 规则，允许部分字段，遗漏字段使用官方 fallback。不会执行 JavaScript、表达式、条件、字符串插值或任意 CSS。未知字段、外部 URL、CSS 值、非法字体声明均拒绝。

- `variants` 可省略，最多 4 个不重复 setting，每个 values 最多 16 项。只可引用 manifest 中已有 boolean/select；boolean 的 JSON 键是 `"true"` / `"false"`，select 键必须是合法 option.value。可省略无需覆盖的值；按 variants 声明顺序浅覆盖 light/dark token，fontFamily 和 shadow 整体替换。patch 至少含 light/dark 之一，省略的模式保持前值。只使用服务端验证后的 settings。
- `fonts` 可省略，最多 4 个 family、64 个 face。family 为受限非 generic 名称，path 必须与同包已验证 `font/woff2` 清单精确匹配；字体魔数、长度和 SHA 沿用完整包校验。weight 默认 400，可为 100–900 的整数或有序 `[min,max]`；style 仅 normal/italic，默认 normal；font-display 固定 swap。
- unicodeRange 可省略；单项不超过 32 KiB / 4096 段，仅接受 `U+码点`、`U+起点-终点`、尾部 `?` wildcard。解析后检查 0–0x10FFFF、排序合并相邻/重叠区间，再生成规范 CSS；不直接拼接输入。主机只输出解析后 light/dark 引用的家族及其分片，使用 packageId 派生内部 family 防止跨包冲突。主题运行态仍使用自己的原 family。
- 描述原文件最大 128 KiB；描述和字体均计入原包文件数与总大小预算，没有额外上传/公共资源豁免。

服务端从包字节与设置派生 `snapshot.publicAppearance`，内容只有有限 light/dark、当前同包字体 URL/hash/size 及包身份，没有完整 variants/settings、账户或认证数据。此字段由主机拥有，PUT/预览请求不能自行覆盖。发布仍须完成全部文件最终验证与 CAS 原子事务，GC 和离线 inventory 沿用完整包引用。

公开描述用于首页登录 baseline、快速/独立 OTP、首次设置及站内 OAuth 返回页；不运行 app entry 或包 CSS。OAuth 返回页不启用 v1 主题 CSS。safeMode 或 disableCustomCode 时各入口都跳过外观读取/字体/描述；离线恢复兜底、自包含 HTML 导出与 JSON 错误维持独立默认。独立分享 OTP 不增加秘密缓存或离线能力。

首页公共 baseline 与运行态视觉各自拥有 style/scope：主题成功 running 后运行态优先；登出/失效只撤销运行态而保留已发布 baseline。只有确认 current tuple 的同包设置更新才能更新 DOM baseline，失败候选/迟到 owner 不更新；跨包沿用刷新边界。旧主机发布的快照缺少派生字段时只读不迁移，重新应用后才启用。预览投影字体使用现有 capability URL，不提前公开包文件，也不改变父页面 baseline。

预览使用真实包，但仅注入合成 SDK。首次打开、增加新资源或到期后重新打开需要联网；授权固定五分钟，不随设置更新延长。预览资源使用只覆盖该包及个人素材的匿名授权 URL；脚本不能依赖 `/api/secrets`、真实剪贴板、登录凭据或任意联网请求。动态图片可设置 `img.crossOrigin = 'anonymous'` 后再设置 src，以兼容 opaque origin。预览内的模拟成功不等于浏览器实际权限或服务端写入验收。

正式运行前主机会准备当前完整构建、所有包文件和恢复壳，因此不要在主题中自行选择 worker、执行 skipWaiting、清理应用缓存或把新版文件补入旧版组合。服务端已发布、主题运行成功和本设备离线就绪分别判断；需要刷新时使用 lifecycle 入口，不直接 location.reload。安全恢复 URL 为 `/?safeMode=1`，旧 `?disableCustomCode=1` 继续有效。

发布前至少完成：320/390/768/1440 宽度、浅/深色、长文字、全部支持语言；分组/平铺与各排序；当前码/下一码、HOTP pending/未知/对账；菜单实际命中、键盘和焦点恢复；主机编辑保存、同步、队列；配置迁移、包升级、v1↔v2；首次无 controller、离线资源缺失、安全模式、BFCache 和旧异步结果。遵循 `prefers-reduced-motion`，并提供加载、空、无结果、离线和登录状态，不用示例数据掩盖失败。

参考实现是模板仓库 [wuzf/2fa-theme-template](https://github.com/wuzf/2fa-theme-template)。它使用主机 SDK、独立构建与合成开发壳；开发壳测试不替代正式安装和实机验收。模板的 `npm run test:host` 用主项目的导入器校验产物，需要把主项目克隆到旁边并设置 `HOST_ROOT`，具体步骤见模板 README。

本合同的源码依据：[appSchema](../src/themes/appSchema.js)、[资源校验](../src/themes/appResources.js)、[SDK](../src/ui/runtime/themeSdk.js)、[视图状态](../src/ui/runtime/accountViewState.js)、[主机入口](../src/ui/runtime/hostFlows.js)、[宿主生命周期](../src/ui/scripts/appThemeHost.js)。以这些公开边界为准，不把内部 controller 方法当作主题 API。
