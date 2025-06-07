# Test Fixtures

测试用的导入/导出样本文件。

## 目录结构

- `imports/` — 第三方 2FA 应用的导出文件，用于测试导入解析功能
- `exports/` — 本项目导出的文件，用于验证导出格式正确性

## imports/ 文件清单

| 文件名                        | 来源应用                | 格式        | 备注             |
| ----------------------------- | ----------------------- | ----------- | ---------------- |
| `2fas-backup.2fas`            | 2FAS                    | JSON (zip)  |                  |
| `aegis-export-plain.json`     | Aegis                   | JSON        | 明文导出         |
| `aegis-export.html`           | Aegis                   | HTML        |                  |
| `aegis-export-uri.txt`        | Aegis                   | otpauth URI |                  |
| `andotp-accounts.json`        | andOTP                  | JSON        |                  |
| `authpro-backup.authpro`      | Authenticator Pro       | 自有格式    |                  |
| `authpro-backup.html`         | Authenticator Pro       | HTML        |                  |
| `authpro-backup.txt`          | Authenticator Pro       | 文本        |                  |
| `bitwarden-auth.json`         | Bitwarden Authenticator | JSON        |                  |
| `bitwarden-auth.csv`          | Bitwarden Authenticator | CSV         |                  |
| `ente-auth-encrypted.txt`     | ente Auth               | 文本        | 加密，密码见下方 |
| `ente-auth-html.txt`          | ente Auth               | HTML 文本   |                  |
| `ente-auth-plain.txt`         | ente Auth               | 文本        | 明文             |
| `freeotp-backup.xml`          | FreeOTP                 | XML         |                  |
| `freeotp-plus-backup.json`    | FreeOTP+                | JSON        |                  |
| `freeotp-plus-backup.txt`     | FreeOTP+                | 文本        |                  |
| `lastpass-auth.json`          | LastPass Authenticator  | JSON        |                  |
| `proton-auth-backup.json`     | Proton Authenticator    | JSON        |                  |
| `totp-auth-encrypted.encrypt` | TOTP Authenticator      | 自有格式    | 加密，密码见下方 |
| `winauth-backup.txt`          | WinAuth                 | 文本        |                  |

## exports/ 文件清单

本项目导出的各种格式，文件名遵循 `2fa-secrets-{format}.{ext}` 规范。

## 加密文件测试密码

| 文件                                             | 密码       |
| ------------------------------------------------ | ---------- |
| `imports/ente-auth-encrypted.txt`                | `666666`   |
| `imports/totp-auth-encrypted.encrypt`            | `666666Aa` |
| `exports/2fa-secrets-freeotp-encrypted.xml`      | `666666`   |
| `exports/2fa-secrets-totpauth-encrypted.encrypt` | `666666Aa` |
