# Microsoft Authenticator 导出工具

将 Microsoft Authenticator 的 PhoneFactor SQLite 数据库转换为通用的 otpauth:// URL 格式，以便导入到 2FA Manager 或其他兼容的 2FA 应用。

## 📋 功能特性

- ✅ 从 PhoneFactor SQLite 数据库提取所有 2FA 账户
- ✅ 支持所有账户类型（account_type=0/1/2）
- ✅ 自动处理 Microsoft 个人账户（account_type=1）的 Base64 → Base32 密钥转换
- ✅ 支持企业账户（account_type=2）的 SHA256 算法
- ✅ 自动清理密钥中的空格、换行符等无效字符
- ✅ 导出标准 otpauth:// URL 格式，兼容所有主流 2FA 应用
- ✅ 自动合并 WAL 文件到主数据库
- ✅ Python 3.x 支持，使用现代 Python 语法

## 📦 前置要求

- Python 3.x（推荐 3.6 或更高版本）
- SQLite3（Python 内置）
- 已 Root 的 Android 设备或模拟器（用于提取数据库文件）

## 📱 步骤 1：从 Microsoft Authenticator 导出数据库

### 方法：使用文件管理器

**手机需要 Root 权限，如果没有可以使用 Android 模拟器登录账号**

1. 使用支持 Root 的文件管理器（如 Root Explorer、Solid Explorer）
2. 导航到 `/data/data/com.azure.authenticator/databases/`
3. 复制以下文件到电脑：
   - `PhoneFactor`（主数据库文件，必需）
   - `PhoneFactor-wal`（WAL 日志，如果存在请一起复制）
   - `PhoneFactor-shm`（共享内存索引，如果存在请一起复制）

**注意**：

- WAL 文件包含最新的账户数据，务必一起复制
- 脚本运行时会自动将 WAL 文件合并到主数据库，合并后 WAL 和 SHM 文件会被自动删除（这是正常行为）

## 🚀 步骤 2：运行导出脚本

### 文件放置

将数据库文件放在以下固定位置：

```
tools/MSAuthExport/databases/PhoneFactor
```

如果有 WAL 和 SHM 文件，也放在同一目录：

```
tools/MSAuthExport/databases/
├── PhoneFactor          (主数据库，必需)
├── PhoneFactor-wal      (WAL 日志，如果存在)
└── PhoneFactor-shm      (共享内存，如果存在)
```

### 运行脚本

```bash
# 或在脚本目录运行
cd tools/MSAuthExport
python MSAuthExportScript.py
```

### 运行结果示例

```
============================================================
Microsoft Authenticator 导出工具
============================================================
输出文件: msauth-export-2025-12-14-164508.txt
============================================================

找到 50 个有效账户

  [ 1] AWS                        amazon@qq.com              (account_type=0)
  [ 2] GitHub                     test@gmail.com             (account_type=0)
  [ 3] Microsoft                  test@outlook.com           (account_type=1, Microsoft)
  [ 4] AzureAD                    user@company.com           (account_type=2, SHA256)
  ...

============================================================
成功导出 50 个账户到文件: msauth-export-2025-12-14-164508.txt
============================================================

下一步操作:
  1. 在 2FA Manager 中点击 "导入" 按钮
  2. 选择或拖拽文件: msauth-export-2025-12-14-164508.txt
  3. 应该成功导入所有 50 个账户
```

## 📄 输出格式说明

脚本会生成一个带时间戳的文本文件 `msauth-export-<timestamp>.txt`，每行是一个标准的 otpauth:// URL：

```
otpauth://totp/GitHub:username?secret=JBSWY3DPEHPK3PXP&digits=6&period=30&algorithm=SHA1&issuer=GitHub
otpauth://totp/Microsoft:user%40outlook.com?secret=KQA5S3QN5PCKOJM4&digits=6&period=30&algorithm=SHA1&issuer=Microsoft
otpauth://totp/AzureAD:admin%40company.com?secret=ABCD1234EFGH5678&digits=6&period=30&algorithm=SHA256&issuer=AzureAD
```

### 字段说明

- **secret**: 密钥（已清理空格，转为大写）
- **digits**: 验证码位数（固定 6 位）
- **period**: 刷新周期（固定 30 秒）
- **algorithm**: 哈希算法（SHA1 或 SHA256，根据账户类型自动选择）
- **issuer**: 服务提供商名称

## 📥 步骤 3：导入到 2FA Manager

1. 访问你的 2FA Manager 实例
2. 点击 **"导入"** 按钮
3. 选择或拖拽生成的 `msauth-export-*.txt` 文件
4. 系统会自动识别 otpauth:// URL 格式并预览
5. 确认无误后点击 **"执行导入"**

导入后即可在 2FA Manager 中使用所有账户。

## 🔧 技术细节

### 账户类型处理

Microsoft Authenticator 使用 `account_type` 字段区分账户类型，脚本会自动识别并处理：

| account_type | 说明                                   | 处理方式             | 算法   |
| ------------ | -------------------------------------- | -------------------- | ------ |
| 0            | 标准 TOTP 账户（如 Google、GitHub 等） | 直接使用 Base32 密钥 | SHA1   |
| 1            | Microsoft 个人账户                     | Base64 → Base32 转换 | SHA1   |
| 2            | 企业账户（如 Azure AD）                | 直接使用 Base32 密钥 | SHA256 |

### Base64 → Base32 转换

Microsoft 个人账户（account_type=1）的密钥存储为 Base64 编码，脚本会自动转换为标准的 Base32 格式：

- **输入（Base64）**: `VAHZbg3rxKclnA==`
- **输出（Base32）**: `KQA5S3QN5PCKOJM4`

转换过程完全自动化，无需手动操作。

### 密钥清理

脚本会自动清理所有密钥中的：

- 空格 (` `)
- 制表符 (`\t`)
- 换行符 (`\n`, `\r`)

并统一转换为大写字母，确保符合标准格式。

### WAL 文件自动合并

SQLite 的 WAL（Write-Ahead Logging）模式会将最新的数据写入单独的 `-wal` 文件。当脚本打开数据库时：

1. SQLite 自动检测 WAL 文件
2. 将 WAL 中的更改合并到主数据库（checkpoint 操作）
3. 合并完成后自动删除 WAL 和 SHM 文件

**这是 SQLite 的正常行为**，不用担心：

- ✅ 所有数据已安全合并到主数据库
- ✅ 数据库处于一致状态
- ✅ 不会有数据丢失

## ⚠️ 注意事项

### 安全警告

- ⚠️ **数据库文件包含所有 2FA 密钥的明文，务必妥善保管**
- ⚠️ **导出的文本文件包含可直接使用的密钥，使用后请立即删除**
- ⚠️ **不要将数据库文件或导出文件上传到公共平台或云存储**
- ⚠️ **建议在操作完成后，从电脑中彻底删除数据库文件和导出文件**

### Root 权限要求

- 提取数据库文件**必须**需要 Root 权限
- Android 系统保护应用数据目录 `/data/data/`，普通用户无法访问
- 如果设备未 Root，可以使用 Android 模拟器（如 BlueStacks、Memu）登录 Microsoft Authenticator

### 兼容性

**脚本兼容性**：

- Python 3.6 或更高版本
- Windows、Linux、macOS

**导出格式兼容性**：

- Google Authenticator
- Authy
- Aegis Authenticator
- 2FAS Auth
- 1Password
- Bitwarden
- 等所有支持标准 TOTP 的应用

## 🛠️ 故障排除

### 问题 1：未找到数据库文件

**错误信息**：

```
错误: 未找到 PhoneFactor 数据库文件
```

**解决方案**：

1. 确认文件路径正确：`tools/MSAuthExport/databases/PhoneFactor`
2. 检查文件是否从手机正确复制
3. 确认文件名拼写正确（区分大小写）

### 问题 2：未找到任何有效账户

**可能原因**：

- 数据库为空（Microsoft Authenticator 中没有账户）
- 数据库文件损坏
- 复制文件时出错

**解决方案**：

1. 在手机上打开 Microsoft Authenticator，确认账户存在
2. 重新从手机复制数据库文件（包括 WAL 文件）
3. 如果使用模拟器，确保账户已同步

### 问题 3：WAL 和 SHM 文件被删除了

这是**正常现象**，不是错误：

- SQLite 在打开数据库时会自动合并 WAL 文件
- 合并后的数据已完整保存在主数据库文件中
- 删除 WAL/SHM 是 SQLite 的标准行为

**不需要任何操作**，数据已安全保存。

### 问题 4：Microsoft 账户转换失败

**错误信息**：

```
[XX] 转换失败，跳过: Microsoft user@outlook.com
```

**解决方案**：

1. 这可能是因为密钥格式不符合 Base64 标准
2. 检查导出文件，确认其他账户是否正常导出
3. 如果问题持续，请提 Issue 并附上错误信息

### 问题 5：导入后验证码不正确

**可能原因**：

- 设备时间不同步
- 密钥格式错误

**解决方案**：

1. 确保所有设备时间与标准时间同步（误差应小于 30 秒）
2. 检查导出文件中的密钥格式
3. 尝试重新导出和导入

## 📝 更新日志

**版本 2.0.0** (2025-12-14)

- ✅ 添加对所有账户类型的支持（account_type=0/1/2）
- ✅ 实现 Base64 → Base32 自动转换
- ✅ 支持 SHA256 算法（企业账户）
- ✅ 简化数据库路径为单一固定位置
- ✅ 添加 WAL 文件自动合并说明
- ✅ 改进错误提示和文档

**版本 1.0.0** (2025-12-13)

- 初始版本
- 基本的 otpauth:// URL 导出功能

## 📄 许可证

本工具是 2FA Manager 项目的一部分，遵循相同的开源许可证。

---

**最后更新**: 2025-12-14
**脚本版本**: 2.0.0
**作者**: 2FA Manager Team
