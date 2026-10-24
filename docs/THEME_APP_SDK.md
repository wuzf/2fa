# 完整前端主题与 SDK API 1

本文面向独立主题仓库作者，对应当前实现的 `themeApiVersion: 2`、`kind: "app"`、`sdkApiVersion: 1`。用户安装、草稿、品牌、离线与安全模式说明见 [主题指南](THEMES.md)。v1 CSS/layout 主题仍使用原协议，不能把 JS 塞进 v1 包。

<!-- APP_THEME_ACTIVATION_STATUS -->

完整前端运行层已通过独立审核，普通 app 安装、联网隔离预览、发布和回滚入口已开放。发布不会跳过设备端的完整资源准备、SDK 许可及安全恢复检查；不要修改 Service Worker 来绕过这些检查。

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

| 参数         | 合同                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------- |
| `root`       | 本次挂载的独立 DOM 根节点；不是整个 document，也不是官方账户 DOM                                  |
| `sdk`        | 本次挂载的 API 1 实例，账户内核与官方界面共用                                                     |
| `appearance` | 冻结的 `{kind, packageId, package, revision, settings, branding, baseUrl, files}`；与账户快照分开 |
| `signal`     | 本次挂载的 AbortSignal；失效后停止新命令和界面反馈                                                |

`appearance.package` 为 `{id,name,version}`；`files` 每项为 `{path,url,mime,size,hash}`。使用 `appearance.settings` 和 `appearance.branding`，不要试图修改冻结对象。品牌包含 `name/description/loginText/footer/logo/icon192/icon512/appleTouchIcon/background`；图标由主机管理。设置中的 asset 和品牌图片可能是主机 URL，使用收到的完整值；需要构建包内文件时可使用 `new URL('./assets/picture.png', import.meta.url)`。

完整导航用于不同包的切换、升级与回滚；同包配置变化可以在当前页重新准备、卸载和挂载。**不能假设只会调用 `update`，也不能要求每次重新求值 ESM 顶层。** 预览支持 `update`，未实现时使用同一预览授权重新挂载。每次重新挂载都获得新的 scope，不能复用上次的 SDK、复制票据、DOM 引用或异步结果。

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
		title.textContent = config.branding.name || config.package.name;
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
- `2fa-theme.json` 不放进 `files`；`appearance.json` 与 `appearance-assets/` 是完整外观备份的保留路径，不属于普通主题构建。
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
| 清单或 appearance.json                         | 128 KiB                                             |
| 非内置版本 / 全实例去重素材                    | 与 v1 共用 20 个版本 / 50 MiB                       |

`id` 使用 1–64 位字母、数字、下划线或短横线，不能使用 `builtin-` 前缀。`version` 为 SemVer；同系列沿用 id，内容变化得到新不可变 packageId。可选 `minHostVersion` 是最低主机 SemVer，主机在预览、应用、回滚时检查；仅设置 `sdkApiVersion:1` 不会跳过主机版本或完整资源检查。

发布 ZIP 供用户上传，或在公开 GitHub 的非草稿、非预发布 Release 中附上唯一的 **`2fa-theme.zip`**；用户可以导入仓库地址或具体 Release/tag 地址。2FA 不在服务器执行 npm install/build。ZIP、发布页和仓库源码分别核对，不手工替换已经发布的某个 chunk。

## 主题设置与品牌

v2 设置只包含纯数据，没有 v1 `binding`、layout、content、tokens、customCss，也不支持服务器迁移 JavaScript。清单最多 64 个字段：

| 类型                | 字段规则                                               |
| ------------------- | ------------------------------------------------------ |
| `boolean`           | 布尔默认值                                             |
| `color`             | `#RGB/#RGBA/#RRGGBB/#RRGGBBAA`                         |
| `number`            | 有限数字，可带 min/max 和正数 step                     |
| `select`            | 1–64 个 `{value,label}` 字符串选项，默认值必须匹配     |
| `text` / `textarea` | 最大 2048 / 16384 字符，不含 NUL                       |
| `asset`             | 图片或 WOFF2 引用；默认值为空或 inventory 中的资源路径 |

每项允许 `key/type/label/description/default/min/max/step/options`，不接受未知字段。v2 字段标签和说明目前是字符串，**不接受 v1 的 `translations` 字段**；主题自有界面翻译由作者提供，主机入口标签使用 `sdk.i18n.t`。

编辑器按“格式 + id”保存配置，升级时保留相同类型的合法值，失效值回退默认并提示。包内 asset 会映射到新版本相同路径，路径缺失时提示调整；个人 hash 素材保留。app → v1 → app 切换时完整品牌保留。`appearance.settings` 是主机外观配置，`sdk.preferences` 则是用户语言、明暗与显示偏好，两者不是同一份状态。

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
| `sdk.preferences.set(patch)`          | 仅允许 language/theme/defaultViewMode/otpAnimation，Promise 结果        |
| `sdk.i18n.t(key, params?)`            | 主机文案；自定义主题词条需自建词典                                      |
| `sdk.lifecycle.requestReload(reason)` | theme-change/update/recovery，Promise 结果；受未保存/事务保护           |

`identity` 是只读属性，含 `hostBuild/sdkApiVersion/packageId/appearanceRevision/mode`，正式 SDK 的 mode 为 `live`、预览为 `preview`。它属于本次挂载，不会随着外观发布自动变成新运行身份。

排序合法值：groupSort 为 `name-asc/name-desc`；flatSort 为 `oldest-first/newest-first/name-asc/name-desc/account-asc/account-desc`；groupedItemSort 为 `oldest-first/newest-first/account-asc/account-desc`。同步 view 命令通常返回 committed/unchanged/rejected，committed 可另带 persistence；以返回结果和后续快照为准。

偏好合法值：language 为 `auto` 或主机支持的 15 个语言代码；theme 为 `auto/light/dark`；defaultViewMode 为 `remember/grouped/flat`；otpAnimation 为 `none/flow/flip/spotlight`。resolvedLanguage/resolvedTheme/reducedMotion 是读取状态，不是可写字段。其他设置通过主机设置对话框修改。

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

`listActions()` 的账户/队列入口提供 requires 标记，不能把缺少 account/operationId 的模板直接提交。填写最新 ref 或真实队列 operationId，不把库内 HOTP operationId 当作离线队列 ID。仅使用表内字段，额外未知参数会被拒绝。某项暂不可用时保留可发现的入口和原因，最终许可仍由 open 检查。

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

预览使用真实包，但仅注入合成 SDK。首次打开、增加新资源或到期后重新打开需要联网；授权固定五分钟，不随设置更新延长。预览资源使用只覆盖该包及个人素材的匿名授权 URL；脚本不能依赖 `/api/secrets`、真实剪贴板、登录凭据或任意联网请求。动态图片可设置 `img.crossOrigin = 'anonymous'` 后再设置 src，以兼容 opaque origin。预览内的模拟成功不等于浏览器实际权限或服务端写入验收。

正式运行前主机会准备当前完整构建、所有包文件和恢复壳，因此不要在主题中自行选择 worker、执行 skipWaiting、清理应用缓存或把新版文件补入旧版组合。服务端已发布、主题运行成功和本设备离线就绪分别判断；需要刷新时使用 lifecycle 入口，不直接 location.reload。安全恢复 URL 为 `/?safeMode=1`，旧 `?disableCustomCode=1` 继续有效。

发布前至少完成：320/390/768/1440 宽度、浅/深色、长文字、全部支持语言；分组/平铺与各排序；当前码/下一码、HOTP pending/未知/对账；菜单实际命中、键盘和焦点恢复；主机编辑保存、导入导出、同步、队列；配置迁移、包升级、v1↔v2、回滚；首次无 controller、离线资源缺失、安全模式、BFCache 和旧异步结果。遵循 `prefers-reduced-motion`，并提供加载、空、无结果、离线和登录状态，不用示例数据掩盖失败。

独立参考实现名为 **`2fa-theme-pixel`**；当前工作区与主项目并列，可查看 [本地 Pixel README](../../2fa-theme-pixel/README.md)。这是本地相对链接，只有两个仓库按该目录结构检出时可用；没有假定它已经发布到任何远端仓库。它使用主机 SDK、独立构建与合成开发壳，开发壳测试不替代正式安装和实机验收。

本合同的源码依据：[appSchema](../src/themes/appSchema.js)、[资源校验](../src/themes/appResources.js)、[SDK](../src/ui/runtime/themeSdk.js)、[视图状态](../src/ui/runtime/accountViewState.js)、[主机入口](../src/ui/runtime/hostFlows.js)、[宿主生命周期](../src/ui/scripts/appThemeHost.js)。以这些公开边界为准，不把内部 controller 方法当作主题 API。
