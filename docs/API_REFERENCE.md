# 🔌 API 参考文档

## 📋 目录

- [认证](#认证)
- [端点列表](#端点列表)
- [密钥管理 API](#密钥管理-api)
- [OTP 生成 API](#otp-生成-api)
- [备份管理 API](#备份管理-api)
- [云盘同步 API](#云盘同步-api)
- [认证 API](#认证-api)
- [错误代码](#错误代码)
- [Rate Limiting](#rate-limiting)

---

## 认证

### 认证方式

所有 API 端点（除了公开端点）都需要身份认证。

**认证方法**: HttpOnly Cookie

```
Cookie: auth_token=<JWT_TOKEN>
```

**公开端点**（无需认证）:

- `GET /` - 主页面
- `GET /manifest.json` - PWA Manifest
- `GET /sw.js` - Service Worker
- `GET /icon-*.png` - PWA 图标
- `POST /api/login` - 登录
- `GET /otp/{secret}` - OTP 生成（传统方式）
- `GET /api/onedrive/oauth/callback` - OneDrive OAuth 回调
- `GET /api/gdrive/oauth/callback` - Google Drive OAuth 回调

**特殊端点**:

- `POST /api/refresh-token` - 不经过全局认证中间件，但仍要求请求中携带有效 `auth_token` Cookie

**受保护端点**（需要认证）:

- 其余所有 `/api/*` 端点

### 获取认证 Token

**端点**: `POST /api/login`

**请求体**:

```json
{
	"username": "admin",
	"password": "<YOUR_PASSWORD>"
}
```

**说明**:

- `username`: 固定为 "admin"
- `password`: 通过网页界面设置的管理员密码

**成功响应** (200 OK):

```json
{
	"success": true,
	"message": "登录成功"
}
```

**响应头**:

```http
Set-Cookie: auth_token=<JWT_TOKEN>; HttpOnly; Secure; SameSite=Strict; Max-Age=604800; Path=/
```

**失败响应** (401 Unauthorized):

```json
{
	"error": "认证失败",
	"message": "访问令牌无效",
	"timestamp": "2025-10-24T10:30:00.000Z"
}
```

### Token 刷新

**端点**: `POST /api/refresh-token`

**认证**: ✅ 需要

**描述**: 刷新当前 Token，延长过期时间

**成功响应** (200 OK):

```json
{
	"success": true,
	"message": "Token 刷新成功"
}
```

**响应头**:

```http
Set-Cookie: auth_token=<NEW_JWT_TOKEN>; HttpOnly; Secure; SameSite=Strict; Max-Age=604800; Path=/
```

---

## 端点列表

| 端点                                   | 方法   | 认证 | 限流    | 描述                         |
| -------------------------------------- | ------ | ---- | ------- | ---------------------------- |
| [/api/secrets](#获取所有密钥)          | GET    | ✅   | 60/min  | 获取所有密钥                 |
| [/api/secrets](#添加新密钥)            | POST   | ✅   | 60/min  | 添加新密钥                   |
| [/api/secrets/{id}](#更新密钥)         | PUT    | ✅   | 60/min  | 更新指定密钥                 |
| [/api/secrets/{id}](#删除密钥)         | DELETE | ✅   | 60/min  | 删除指定密钥                 |
| [/api/secrets/batch](#批量添加密钥)    | POST   | ✅   | 10/min  | 批量添加密钥                 |
| [/api/generate-otp](#生成-otp)         | POST   | ✅   | 100/min | 生成 OTP                     |
| [/api/backup](#手动触发备份)           | POST   | ✅   | 5/min   | 手动触发备份                 |
| [/api/backups](#获取备份列表)          | GET    | ✅   | 30/min  | 获取备份列表                 |
| [/api/backups/export/{id}](#导出备份)  | GET    | ✅   | 10/min  | 导出指定备份                 |
| [/api/backups/restore/{id}](#恢复备份) | POST   | ✅   | 5/min   | 恢复指定备份                 |
| `/api/onedrive/config`                 | GET    | ✅   | 30/min  | 获取 OneDrive 目标           |
| `/api/onedrive/config`                 | POST   | ✅   | 10/min  | 保存 OneDrive 目标           |
| `/api/onedrive/config?id={id}`         | DELETE | ✅   | 10/min  | 删除 OneDrive 目标           |
| `/api/onedrive/toggle`                 | POST   | ✅   | 10/min  | 启用或禁用 OneDrive 目标     |
| `/api/onedrive/oauth/start`            | POST   | ✅   | 10/min  | 启动 OneDrive OAuth          |
| `/api/onedrive/oauth/callback`         | GET    | ❌   | -       | OneDrive OAuth 回调          |
| `/api/gdrive/config`                   | GET    | ✅   | 30/min  | 获取 Google Drive 目标       |
| `/api/gdrive/config`                   | POST   | ✅   | 10/min  | 保存 Google Drive 目标       |
| `/api/gdrive/config?id={id}`           | DELETE | ✅   | 10/min  | 删除 Google Drive 目标       |
| `/api/gdrive/toggle`                   | POST   | ✅   | 10/min  | 启用或禁用 Google Drive 目标 |
| `/api/gdrive/oauth/start`              | POST   | ✅   | 10/min  | 启动 Google Drive OAuth      |
| `/api/gdrive/oauth/callback`           | GET    | ❌   | -       | Google Drive OAuth 回调      |
| [/api/login](#获取认证-token)          | POST   | ❌   | 5/min   | 用户登录                     |
| [/api/refresh-token](#token-刷新)      | POST   | ✅   | 60/min  | 刷新 Token                   |
| [/otp/{secret}](#传统-otp-生成)        | GET    | ❌   | 100/min | 生成 OTP（旧版）             |

---

## 密钥管理 API

### 获取所有密钥

**端点**: `GET /api/secrets`

**认证**: ✅ 需要

**描述**: 获取所有存储的 2FA 密钥

**请求示例**:

```http
GET /api/secrets HTTP/1.1
Host: 2fa.example.com
Cookie: auth_token=<JWT_TOKEN>
```

**成功响应** (200 OK):

```json
[
	{
		"id": "550e8400-e29b-41d4-a716-446655440000",
		"name": "GitHub",
		"account": "user@example.com",
		"secret": "JBSWY3DPEHPK3PXP"
	},
	{
		"id": "660e8400-e29b-41d4-a716-446655440001",
		"name": "Google",
		"account": "john@gmail.com",
		"secret": "ABCDEFGHIJKLMNOP"
	}
]
```

**字段说明**:
| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String (UUID) | 密钥唯一标识符 |
| `name` | String | 服务名称（如 "GitHub"） |
| `account` | String | 账户名称（可选） |
| `secret` | String | Base32 编码的密钥 |

---

### 添加新密钥

**端点**: `POST /api/secrets`

**认证**: ✅ 需要

**描述**: 添加新的 2FA 密钥

**请求体**:

```json
{
	"name": "GitHub",
	"account": "user@example.com",
	"secret": "JBSWY3DPEHPK3PXP"
}
```

**字段说明**:
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | String | ✅ | 服务名称，不能为空 |
| `account` | String | ❌ | 账户名称，可选 |
| `secret` | String | ✅ | Base32 格式的密钥，至少 8 个字符 |

**成功响应** (201 Created):

```json
{
	"success": true,
	"data": {
		"id": "550e8400-e29b-41d4-a716-446655440000",
		"name": "GitHub",
		"account": "user@example.com",
		"secret": "JBSWY3DPEHPK3PXP"
	},
	"message": "密钥添加成功"
}
```

**错误响应**:

**400 Bad Request** - 参数验证失败:

```json
{
	"error": "参数错误",
	"message": "服务名称不能为空",
	"timestamp": "2025-10-24T10:30:00.000Z"
}
```

**409 Conflict** - 密钥已存在:

```json
{
	"error": "密钥已存在",
	"message": "相同服务名称和账户的密钥已存在",
	"timestamp": "2025-10-24T10:30:00.000Z"
}
```

**Base32 验证规则**:

- 只允许字符: `A-Z` 和 `2-7`
- 可选的 `=` 填充字符
- 最小长度: 8 个字符
- 示例有效密钥: `JBSWY3DPEHPK3PXP`, `ABCDEFGHIJKLMNOP====`

---

### 更新密钥

**端点**: `PUT /api/secrets/{id}`

**认证**: ✅ 需要

**描述**: 更新指定 ID 的密钥信息

**URL 参数**:

- `id` (UUID): 密钥的唯一标识符

**请求体**:

```json
{
	"name": "GitHub Enterprise",
	"account": "newuser@example.com",
	"secret": "NEWBASE32SECRETKEY"
}
```

**成功响应** (200 OK):

```json
{
	"success": true,
	"data": {
		"id": "550e8400-e29b-41d4-a716-446655440000",
		"name": "GitHub Enterprise",
		"account": "newuser@example.com",
		"secret": "NEWBASE32SECRETKEY"
	},
	"message": "密钥更新成功"
}
```

**错误响应**:

**404 Not Found** - 密钥不存在:

```json
{
	"error": "密钥不存在",
	"message": "找不到指定的密钥",
	"timestamp": "2025-10-24T10:30:00.000Z"
}
```

---

### 删除密钥

**端点**: `DELETE /api/secrets/{id}`

**认证**: ✅ 需要

**描述**: 删除指定 ID 的密钥

**URL 参数**:

- `id` (UUID): 密钥的唯一标识符

**成功响应** (200 OK):

```json
{
	"success": true,
	"data": {
		"id": "550e8400-e29b-41d4-a716-446655440000"
	},
	"message": "密钥删除成功"
}
```

**错误响应**:

**404 Not Found** - 密钥不存在:

```json
{
	"error": "密钥不存在",
	"message": "找不到指定的密钥",
	"timestamp": "2025-10-24T10:30:00.000Z"
}
```

---

### 批量添加密钥

**端点**: `POST /api/secrets/batch`

**认证**: ✅ 需要

**描述**: 批量添加多个密钥（用于导入）

**请求体**:

```json
{
	"secrets": [
		{
			"name": "GitHub",
			"account": "user@example.com",
			"secret": "JBSWY3DPEHPK3PXP"
		},
		{
			"name": "Google",
			"account": "john@gmail.com",
			"secret": "ABCDEFGHIJKLMNOP"
		}
	]
}
```

**成功响应** (200 OK):

```json
{
	"success": true,
	"data": {
		"total": 2,
		"success": 2,
		"failed": 0,
		"results": [
			{
				"success": true,
				"name": "GitHub",
				"account": "user@example.com"
			},
			{
				"success": true,
				"name": "Google",
				"account": "john@gmail.com"
			}
		]
	},
	"message": "批量添加完成：成功 2 个，失败 0 个"
}
```

**部分成功响应** (200 OK):

```json
{
	"success": true,
	"data": {
		"total": 3,
		"success": 2,
		"failed": 1,
		"results": [
			{
				"success": true,
				"name": "GitHub",
				"account": "user@example.com"
			},
			{
				"success": false,
				"name": "Invalid",
				"error": "密钥格式无效"
			},
			{
				"success": true,
				"name": "Google",
				"account": "john@gmail.com"
			}
		]
	},
	"message": "批量添加完成：成功 2 个，失败 1 个"
}
```

---

### 导入格式参考

批量导入功能在客户端自动识别格式并解析为标准结构后调用 `POST /api/secrets/batch`。以下是各应用导出文件的格式说明。

#### otpauth:// URI（通用）

每行一个 URI，支持 TXT 文件或直接粘贴：

```
otpauth://totp/GitHub:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&digits=6&period=30&algorithm=SHA1
otpauth://hotp/Service:account?secret=ABCDEFGH&counter=5
```

#### Google Authenticator 迁移二维码

扫描或粘贴 `otpauth-migration://` 链接，内含 Protobuf 编码的批量密钥数据：

```
otpauth-migration://offline?data=CjEKCkhlbGxvId...
```

#### Aegis Authenticator（JSON）

```json
{
	"db": {
		"entries": [
			{
				"type": "totp",
				"issuer": "GitHub",
				"name": "user@example.com",
				"info": {
					"secret": "JBSWY3DPEHPK3PXP",
					"digits": 6,
					"period": 30,
					"algo": "SHA1"
				}
			}
		]
	}
}
```

#### 2FAS Authenticator（.2fas）

```json
{
	"services": [
		{
			"name": "GitHub",
			"secret": "JBSWY3DPEHPK3PXP",
			"otp": {
				"account": "user@example.com",
				"digits": 6,
				"period": 30,
				"algorithm": "SHA1",
				"tokenType": "TOTP"
			}
		}
	],
	"schemaVersion": 4
}
```

#### Bitwarden（JSON）

```json
{
	"items": [
		{
			"name": "GitHub",
			"login": {
				"username": "user@example.com",
				"totp": "otpauth://totp/GitHub:user?secret=JBSWY3DPEHPK3PXP&issuer=GitHub"
			}
		}
	]
}
```

`totp` 字段支持完整 `otpauth://` URI 或纯 Base32 密钥。也支持 Bitwarden Authenticator 的 CSV 格式（含 `login_totp` 列）。

#### LastPass Authenticator（JSON）

```json
{
	"version": 1,
	"accounts": [
		{
			"issuerName": "GitHub",
			"userName": "user@example.com",
			"secret": "JBSWY3DPEHPK3PXP",
			"digits": 6,
			"timeStep": 30,
			"algorithm": "SHA1"
		}
	]
}
```

#### andOTP（JSON）

```json
[
	{
		"secret": "JBSWY3DPEHPK3PXP",
		"issuer": "GitHub",
		"label": "user@example.com",
		"digits": 6,
		"type": "totp",
		"algorithm": "SHA1",
		"period": 30,
		"thumbnail": "Default"
	}
]
```

#### Ente Auth（HTML）

Ente Auth 导出为 HTML 文件，包含如下结构的表格：

```html
<table class="otp-entry">
	<tr>
		<td>
			<p><b>GitHub</b></p>
			<p><b>user@example.com</b></p>
			<p>Type: <b>TOTP</b></p>
			<p>Secret: <b>JBSWY3DPEHPK3PXP</b></p>
			<p>Digits: <b>6</b></p>
			<p>Period: <b>30</b></p>
		</td>
	</tr>
</table>
```

#### CSV 格式

支持两种 CSV 表头：

```csv
服务名称,账户信息,密钥,类型,位数,周期(秒),算法
GitHub,user@example.com,JBSWY3DPEHPK3PXP,TOTP,6,30,SHA1
```

```csv
service,account,secret,type,digits,period,algorithm
GitHub,user@example.com,JBSWY3DPEHPK3PXP,TOTP,6,30,SHA1
```

#### 其他支持的格式

| 来源                 | 格式                             | 识别方式                               |
| -------------------- | -------------------------------- | -------------------------------------- |
| Proton Authenticator | JSON（含 `version` + `entries`） | `entries[].content.uri` 为 otpauth URL |
| Authenticator Pro    | JSON（含 `Authenticators` 大写） | 字段 `Type`: 1=HOTP, 2=TOTP            |
| FreeOTP+             | JSON（含 `tokens`）              | `secret` 可为 Base32 或字节数组        |
| FreeOTP              | JSON（含 `tokenOrder`）          | `secret` 为字节数组格式                |

---

## OTP 生成 API

### 生成 OTP

**端点**: `POST /api/generate-otp`

**认证**: ✅ 需要

**描述**: 根据密钥生成一次性密码（OTP）

**请求体**:

```json
{
	"secret": "JBSWY3DPEHPK3PXP",
	"type": "totp",
	"options": {
		"timeStep": 30,
		"digits": 6,
		"algorithm": "SHA1"
	}
}
```

**字段说明**:
| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `secret` | String | ✅ | - | Base32 编码的密钥 |
| `type` | String | ❌ | `"totp"` | OTP 类型: `totp`, `hotp` |
| `options.timeStep` | Number | ❌ | `30` | TOTP 时间步长（秒） |
| `options.digits` | Number | ❌ | `6` | OTP 位数（6 或 8） |
| `options.algorithm` | String | ❌ | `"SHA1"` | 哈希算法: `SHA1`, `SHA256`, `SHA512` |
| `options.counter` | Number | ❌ | - | HOTP 计数器（仅 HOTP 需要） |

**成功响应** (200 OK):

```json
{
	"otp": "123456",
	"timeRemaining": 25,
	"timestamp": "2025-10-24T10:30:00.000Z",
	"type": "totp",
	"nextOtp": "654321"
}
```

**响应字段说明**:
| 字段 | 类型 | 说明 |
|------|------|------|
| `otp` | String | 当前 OTP（6 位数字） |
| `timeRemaining` | Number | 当前 OTP 剩余有效时间（秒） |
| `timestamp` | String | 服务器时间戳 |
| `type` | String | OTP 类型 |
| `nextOtp` | String | 下一个时段的 OTP（仅 TOTP） |

**错误响应**:

**400 Bad Request** - 密钥无效:

```json
{
	"error": "OTP生成失败",
	"message": "密钥格式无效，必须是有效的 Base32 格式",
	"timestamp": "2025-10-24T10:30:00.000Z"
}
```

---

### 传统 OTP 生成

**端点**: `GET /otp/{secret}`

**认证**: ❌ 不需要

**描述**: 简化的 OTP 生成端点（向后兼容旧版本）

**URL 参数**:

- `secret` (String): Base32 编码的密钥

**查询参数** (可选):

- `type` (String): OTP 类型 (`totp`, `hotp`)，默认 `totp`
- `timeStep` (Number): TOTP 时间步长（秒），默认 `30`
- `digits` (Number): OTP 位数，默认 `6`
- `counter` (Number): HOTP 计数器（仅 HOTP）

**请求示例**:

```http
GET /otp/JBSWY3DPEHPK3PXP?type=totp&digits=6 HTTP/1.1
Host: 2fa.example.com
```

**成功响应** (200 OK):

```json
{
	"otp": "123456",
	"timeRemaining": 25,
	"timestamp": "2025-10-24T10:30:00.000Z",
	"type": "totp",
	"nextOtp": "654321"
}
```

---

## 备份管理 API

### 手动触发备份

**端点**: `POST /api/backup`

**认证**: ✅ 需要

**描述**: 立即触发一次完整备份

**成功响应** (200 OK):

```json
{
	"success": true,
	"data": {
		"backupId": "backup_1729765800000",
		"timestamp": "2025-10-24T10:30:00.000Z",
		"count": 15,
		"encrypted": true
	},
	"message": "备份成功"
}
```

---

### 获取备份列表

**端点**: `GET /api/backups`

**认证**: ✅ 需要

**描述**: 获取所有可用备份的列表

**成功响应** (200 OK):

```json
{
	"success": true,
	"data": [
		{
			"id": "backup_1729765800000",
			"timestamp": "2025-10-24T10:30:00.000Z",
			"count": 15,
			"encrypted": true,
			"reason": "manual",
			"size": "2.5 KB"
		},
		{
			"id": "backup_1729765500000",
			"timestamp": "2025-10-24T10:25:00.000Z",
			"count": 15,
			"encrypted": true,
			"reason": "event-driven",
			"size": "2.5 KB"
		}
	],
	"total": 2
}
```

---

### 导出备份

**端点**: `GET /api/backups/export/{id}`

**认证**: ✅ 需要

**描述**: 导出指定备份为 JSON 文件

**URL 参数**:

- `id` (String): 备份 ID（如 `backup_1729765800000`）

**成功响应** (200 OK):

```json
{
	"id": "backup_1729765800000",
	"timestamp": "2025-10-24T10:30:00.000Z",
	"count": 15,
	"reason": "manual",
	"encrypted": true,
	"data": [
		{
			"id": "550e8400-e29b-41d4-a716-446655440000",
			"name": "GitHub",
			"account": "user@example.com",
			"secret": "JBSWY3DPEHPK3PXP",
			"createdAt": "2025-10-20T10:30:00.000Z",
			"updatedAt": "2025-10-20T10:30:00.000Z"
		}
	]
}
```

**错误响应**:

**404 Not Found** - 备份不存在:

```json
{
	"error": "备份不存在",
	"message": "找不到指定的备份",
	"timestamp": "2025-10-24T10:30:00.000Z"
}
```

**400 Bad Request** - 备份已加密但无密钥:

```json
{
	"error": "无法导出",
	"message": "备份文件已加密，但未配置 ENCRYPTION_KEY。如需访问加密备份，请先配置正确的加密密钥。",
	"timestamp": "2025-10-24T10:30:00.000Z"
}
```

---

### 恢复备份

**端点**: `POST /api/backups/restore/{id}`

**认证**: ✅ 需要

**描述**: 从指定备份恢复数据（会覆盖当前数据）

**URL 参数**:

- `id` (String): 备份 ID

**成功响应** (200 OK):

```json
{
	"success": true,
	"data": {
		"backupId": "backup_1729765800000",
		"count": 15,
		"restored": 15
	},
	"message": "备份恢复成功"
}
```

**错误响应**:

**404 Not Found** - 备份不存在:

```json
{
	"error": "备份不存在",
	"message": "找不到指定的备份",
	"timestamp": "2025-10-24T10:30:00.000Z"
}
```

**400 Bad Request** - 备份已加密但无密钥:

```json
{
	"error": "无法恢复",
	"message": "备份文件已加密，但未配置 ENCRYPTION_KEY。如需恢复加密备份，请先配置正确的加密密钥。",
	"timestamp": "2025-10-24T10:30:00.000Z"
}
```

---

## 云盘同步 API

OneDrive 和 Google Drive 使用同一套目标管理模型:

- 目标配置保存到 KV，可选使用 `ENCRYPTION_KEY` 加密
- OAuth 授权成功后会立即执行一次自动连接测试
- 新目标授权成功后默认保持关闭状态，需要用户手动启用
- 已启用的目标重新授权后，会保留原有启用状态

### 目标配置字段

```json
{
	"id": "uuid",
	"name": "工作盘",
	"folderPath": "/2FA-Backups"
}
```

字段说明:

- `id`: 目标 ID；更新或删除现有目标时使用
- `name`: 目标名称，最多 30 个字符
- `folderPath`: 远程备份目录，默认为 `/2FA-Backups`

### OneDrive API

| 端点                           | 方法   | 认证 | 描述                                                              |
| ------------------------------ | ------ | ---- | ----------------------------------------------------------------- |
| `/api/onedrive/config`         | GET    | ✅   | 获取 OneDrive 目标列表、授权状态和最近推送结果                    |
| `/api/onedrive/config`         | POST   | ✅   | 新增或更新 OneDrive 目标                                          |
| `/api/onedrive/config?id={id}` | DELETE | ✅   | 删除指定 OneDrive 目标                                            |
| `/api/onedrive/toggle`         | POST   | ✅   | 启用或禁用指定 OneDrive 目标                                      |
| `/api/onedrive/oauth/start`    | POST   | ✅   | 生成授权链接并启动 OAuth                                          |
| `/api/onedrive/oauth/callback` | GET    | ❌   | Microsoft 回调地址，返回弹窗 HTML 并通过 `postMessage` 通知主窗口 |

### Google Drive API

| 端点                         | 方法   | 认证 | 描述                                                           |
| ---------------------------- | ------ | ---- | -------------------------------------------------------------- |
| `/api/gdrive/config`         | GET    | ✅   | 获取 Google Drive 目标列表、授权状态和最近推送结果             |
| `/api/gdrive/config`         | POST   | ✅   | 新增或更新 Google Drive 目标                                   |
| `/api/gdrive/config?id={id}` | DELETE | ✅   | 删除指定 Google Drive 目标                                     |
| `/api/gdrive/toggle`         | POST   | ✅   | 启用或禁用指定 Google Drive 目标                               |
| `/api/gdrive/oauth/start`    | POST   | ✅   | 生成授权链接并启动 OAuth                                       |
| `/api/gdrive/oauth/callback` | GET    | ❌   | Google 回调地址，返回弹窗 HTML 并通过 `postMessage` 通知主窗口 |

### 保存目标

**端点**: `POST /api/onedrive/config` 或 `POST /api/gdrive/config`

**请求体**:

```json
{
	"name": "工作盘",
	"folderPath": "/2FA-Backups"
}
```

**成功响应** (200 OK):

```json
{
	"success": true,
	"id": "550e8400-e29b-41d4-a716-446655440000",
	"message": "配置已保存",
	"encrypted": true,
	"warning": null
}
```

### 切换启用状态

**端点**: `POST /api/onedrive/toggle` 或 `POST /api/gdrive/toggle`

**请求体**:

```json
{
	"id": "550e8400-e29b-41d4-a716-446655440000",
	"enabled": true
}
```

说明:

- 未授权目标不能直接启用
- 授权成功但连接测试失败时，目标会保持禁用

### 启动 OAuth

**端点**: `POST /api/onedrive/oauth/start` 或 `POST /api/gdrive/oauth/start`

**请求体**:

```json
{
	"id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**成功响应** (200 OK):

```json
{
	"success": true,
	"authorizeUrl": "https://provider.example.com/oauth/authorize?...",
	"callbackOrigin": "https://your-app.example.com"
}
```

### OAuth 回调

**端点**: `GET /api/onedrive/oauth/callback` 或 `GET /api/gdrive/oauth/callback`

**认证**: ❌ 不需要

**描述**:

- 这是 OAuth 平台回跳用的公开端点
- 它会消费一次性 `state`，保存授权结果，并返回一个弹窗页面
- 弹窗页面会向主窗口发送 `cloudBackupAuthComplete` 消息，然后尝试自动关闭

---

## 认证 API

### 登录

见 [获取认证 Token](#获取认证-token)

### Token 刷新

见 [Token 刷新](#token-刷新)

---

## 错误代码

### HTTP 状态码

| 状态码  | 说明                  | 场景                   |
| ------- | --------------------- | ---------------------- |
| **200** | OK                    | 请求成功               |
| **201** | Created               | 资源创建成功           |
| **400** | Bad Request           | 请求参数错误或验证失败 |
| **401** | Unauthorized          | 未授权或 Token 无效    |
| **404** | Not Found             | 资源不存在             |
| **409** | Conflict              | 资源冲突（如重复添加） |
| **429** | Too Many Requests     | 超过限流限制           |
| **500** | Internal Server Error | 服务器内部错误         |

### 错误响应格式

所有错误响应都遵循统一格式：

```json
{
	"error": "错误标题",
	"message": "详细错误信息",
	"timestamp": "2025-10-24T10:30:00.000Z"
}
```

### 常见错误示例

#### 1. 认证失败 (401)

```json
{
	"error": "认证失败",
	"message": "访问令牌无效或已过期",
	"timestamp": "2025-10-24T10:30:00.000Z"
}
```

#### 2. 参数验证失败 (400)

```json
{
	"error": "参数错误",
	"message": "密钥格式无效，必须是有效的 Base32 格式",
	"timestamp": "2025-10-24T10:30:00.000Z"
}
```

#### 3. 资源不存在 (404)

```json
{
	"error": "密钥不存在",
	"message": "找不到指定的密钥",
	"timestamp": "2025-10-24T10:30:00.000Z"
}
```

#### 4. 资源冲突 (409)

```json
{
	"error": "密钥已存在",
	"message": "相同服务名称和账户的密钥已存在",
	"timestamp": "2025-10-24T10:30:00.000Z"
}
```

#### 5. 超过限流 (429)

```json
{
	"error": "请求过于频繁",
	"message": "您的请求过于频繁，请稍后再试",
	"retryAfter": 30,
	"timestamp": "2025-10-24T10:30:00.000Z"
}
```

#### 6. 服务器错误 (500)

```json
{
	"error": "服务器错误",
	"message": "请求处理失败，请稍后重试",
	"errorId": "err_1729765800_abc123",
	"timestamp": "2025-10-24T10:30:00.000Z"
}
```

---

## Rate Limiting

### 限流策略

所有 API 端点都有限流保护，防止滥用和 DDoS 攻击。

| 端点类别                            | 限流规则 | 窗口时间 | 预设名称    |
| ----------------------------------- | -------- | -------- | ----------- |
| **登录** (`/api/login`)             | 5 次     | 1 分钟   | `login`     |
| **标准 API** (`/api/secrets` CRUD)  | 30 次    | 1 分钟   | `api`       |
| **敏感操作** (删除、导出)           | 10 次    | 1 分钟   | `sensitive` |
| **批量操作** (`/api/secrets/batch`) | 5 次     | 5 分钟   | `bulk`      |
| **OTP 生成** (`/otp/*`)             | 100 次   | 1 分钟   | `global`    |
| **备份管理** (`/api/backup`)        | 5 次     | 1 分钟   | -           |
| **备份查询** (`/api/backups`)       | 30 次    | 1 分钟   | `api`       |
| **首次设置** (`/api/setup`)         | 5 次     | 5 分钟   | `bulk`      |

### 限流响应头

所有 API 响应都包含限流信息头：

```http
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1729765860
```

| Header                  | 说明                            |
| ----------------------- | ------------------------------- |
| `X-RateLimit-Limit`     | 窗口时间内的最大请求数          |
| `X-RateLimit-Remaining` | 窗口时间内剩余请求数            |
| `X-RateLimit-Reset`     | 限流窗口重置时间（Unix 时间戳） |

### 超过限流

当超过限流限制时，API 返回 429 状态码：

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 30
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1729765860
```

```json
{
	"error": "请求过于频繁",
	"message": "您的请求过于频繁，请稍后再试",
	"retryAfter": 30,
	"timestamp": "2025-10-24T10:30:00.000Z"
}
```

### 限流算法

使用**固定窗口计数器 (Fixed Window Counter)** 算法：

```
时间轴: ───────────────────────────→
         │         窗口1          │         窗口2          │
      t=0s                    t=60s                   t=120s
         └─────────────────────┘─────────────────────┘
            固定 60 秒窗口         新窗口重置计数器

请求计数: 每个窗口内的请求数 ≤ 最大请求数
窗口重置: 到达窗口结束时间时，计数器重置为 0
```

**算法特点**:

- ✅ 实现简单，性能高效
- ✅ 内存占用低（只需存储计数和窗口结束时间）
- ✅ 与 Cloudflare KV 存储完美适配
- ⚠️ 窗口边界可能存在突发流量（例如在窗口结束前和新窗口开始时各发送最大请求数）

**实现说明**:

- 基于 Cloudflare KV 存储限流状态
- 使用客户端 IP 地址作为限流键（来自 `CF-Connecting-IP` header）
- KV 自动过期机制确保窗口状态自动清理
- 限流检查失败时采用 "fail open" 策略（允许请求通过，不影响正常用户）

---

## 示例代码

### JavaScript / Fetch API

#### 登录并获取密钥

```javascript
// 1. 登录
const loginResponse = await fetch('https://2fa.example.com/api/login', {
	method: 'POST',
	headers: {
		'Content-Type': 'application/json',
	},
	body: JSON.stringify({
		username: 'admin',
		password: 'YOUR_PASSWORD',
	}),
	credentials: 'include', // 重要：携带 Cookie
});

if (loginResponse.ok) {
	console.log('登录成功');

	// 2. 获取密钥列表（Cookie 自动携带）
	const secretsResponse = await fetch('https://2fa.example.com/api/secrets', {
		credentials: 'include', // 重要：携带 Cookie
	});

	const secrets = await secretsResponse.json();
	console.log('密钥列表:', secrets);
}
```

#### 添加新密钥

```javascript
const response = await fetch('https://2fa.example.com/api/secrets', {
	method: 'POST',
	headers: {
		'Content-Type': 'application/json',
	},
	credentials: 'include',
	body: JSON.stringify({
		name: 'GitHub',
		account: 'user@example.com',
		secret: 'JBSWY3DPEHPK3PXP',
	}),
});

const result = await response.json();
if (response.ok) {
	console.log('密钥添加成功:', result.data);
} else {
	console.error('添加失败:', result.message);
}
```

#### 生成 OTP

```javascript
const response = await fetch('https://2fa.example.com/api/generate-otp', {
	method: 'POST',
	headers: {
		'Content-Type': 'application/json',
	},
	credentials: 'include',
	body: JSON.stringify({
		secret: 'JBSWY3DPEHPK3PXP',
		type: 'totp',
	}),
});

const result = await response.json();
console.log('当前 OTP:', result.otp);
console.log('剩余时间:', result.timeRemaining, '秒');
```

### cURL

#### 登录

```bash
curl -X POST https://2fa.example.com/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"YOUR_PASSWORD"}' \
  -c cookies.txt  # 保存 Cookie
```

#### 获取密钥列表

```bash
curl https://2fa.example.com/api/secrets \
  -b cookies.txt  # 使用保存的 Cookie
```

#### 添加新密钥

```bash
curl -X POST https://2fa.example.com/api/secrets \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "name": "GitHub",
    "account": "user@example.com",
    "secret": "JBSWY3DPEHPK3PXP"
  }'
```

#### 生成 OTP（无需认证）

```bash
curl https://2fa.example.com/otp/JBSWY3DPEHPK3PXP
```

### Python

```python
import requests

# 1. 登录
session = requests.Session()
login_response = session.post(
    'https://2fa.example.com/api/login',
    json={
        'username': 'admin',
        'password': 'YOUR_PASSWORD'
    }
)

if login_response.ok:
    print('登录成功')

    # 2. 获取密钥列表
    secrets_response = session.get(
        'https://2fa.example.com/api/secrets'
    )
    secrets = secrets_response.json()
    print('密钥列表:', secrets)

    # 3. 添加新密钥
    add_response = session.post(
        'https://2fa.example.com/api/secrets',
        json={
            'name': 'GitHub',
            'account': 'user@example.com',
            'secret': 'JBSWY3DPEHPK3PXP'
        }
    )
    print('添加结果:', add_response.json())
```

---

## Webhook 集成（计划中）

> **状态**: 🚧 计划中，尚未实现

未来版本将支持 Webhook 集成，用于：

- 密钥添加/删除通知
- 备份完成通知
- 异常登录警报

---

## GraphQL API（计划中）

> **状态**: 🚧 计划中，尚未实现

未来版本可能提供 GraphQL 端点，提供更灵活的数据查询。

---

## 相关文档

- [架构文档](ARCHITECTURE.md) - 了解系统设计
- [部署指南](DEPLOYMENT.md) - 部署和配置
- [功能文档](features/) - 各功能详解

---

**基础 URL**: `https://your-worker.workers.dev` 或自定义域名
