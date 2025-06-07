# Security Policy / 安全政策

## Supported Versions / 支持的版本

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |

## Reporting a Vulnerability / 报告漏洞

### English

We take the security of 2FA Manager seriously. If you discover a security vulnerability, please report it responsibly.

**How to Report:**

1. **Do NOT** open a public GitHub issue for security vulnerabilities
2. Create a private security advisory at: [GitHub Security Advisory](../../security/advisories/new)
3. Or email security concerns to the maintainer (see profile)

**Please include:**

- Description of the vulnerability
- Steps to reproduce
- Potential impact assessment
- Suggested fix (if any)

**What to Expect:**

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 7 days
- **Resolution Timeline**: Depends on severity
  - Critical: 24-72 hours
  - High: 7 days
  - Medium: 30 days
  - Low: 90 days

### 中文

我们非常重视 2FA Manager 的安全性。如果您发现安全漏洞，请负责任地报告。

**如何报告：**

1. **不要** 在公开的 GitHub issue 中报告安全漏洞
2. 在此创建私密安全公告: [GitHub Security Advisory](../../security/advisories/new)
3. 或发送邮件给维护者（见个人资料）

**请包含：**

- 漏洞描述
- 复现步骤
- 潜在影响评估
- 建议的修复方案（如有）

**预期响应时间：**

- **确认收到**: 48 小时内
- **初步评估**: 7 天内
- **解决时间线**: 取决于严重程度
  - 严重: 24-72 小时
  - 高危: 7 天
  - 中等: 30 天
  - 低危: 90 天

---

## Security Best Practices for Users / 用户安全最佳实践

### English

1. **Encryption Key**: Always set `ENCRYPTION_KEY` in production environments
2. **Strong Password**: Use a strong password (12+ characters, mixed case, numbers, symbols)
3. **HTTPS Only**: Always access via HTTPS (enforced by Cloudflare)
4. **Regular Backups**: Enable automatic backups and test restoration periodically
5. **Access Control**: Limit who has access to the Cloudflare Worker and KV namespace
6. **Monitor Access**: Check Cloudflare analytics for unusual access patterns
7. **Update Regularly**: Keep dependencies updated by running `npm audit` periodically

### 中文

1. **加密密钥**: 生产环境必须设置 `ENCRYPTION_KEY`
2. **强密码**: 使用强密码（12+ 字符，混合大小写、数字、符号）
3. **仅 HTTPS**: 始终通过 HTTPS 访问（由 Cloudflare 强制）
4. **定期备份**: 启用自动备份并定期测试恢复
5. **访问控制**: 限制对 Cloudflare Worker 和 KV 命名空间的访问
6. **监控访问**: 检查 Cloudflare 分析以发现异常访问模式
7. **定期更新**: 定期运行 `npm audit` 保持依赖更新

---

## Security Features / 安全特性

| Feature              | Description                                                    |
| -------------------- | -------------------------------------------------------------- |
| **AES-GCM 256-bit**  | All secrets encrypted at rest with authenticated encryption    |
| **PBKDF2**           | Password hashing with 100,000 iterations and SHA-256           |
| **HttpOnly Cookies** | JWT tokens stored in HttpOnly, Secure, SameSite=Strict cookies |
| **Rate Limiting**    | Protection against brute force attacks on all endpoints        |
| **CSP Headers**      | Content Security Policy headers to prevent XSS                 |
| **Input Validation** | Comprehensive input validation and sanitization                |

---

## Acknowledgments / 致谢

We thank the security researchers who have helped improve this project.

| Researcher | Vulnerability | Date |
| ---------- | ------------- | ---- |
| -          | -             | -    |

---

## Security Audit History / 安全审计历史

| Date | Auditor    | Scope         | Result  |
| ---- | ---------- | ------------- | ------- |
| -    | Self-audit | Full codebase | Ongoing |
