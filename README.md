# 2FA OTP Generator

这是一个用Cloudflare Worker实现的Two Factor Authentication (2FA) OTP生成器，可以简单代替Google Authenticator或Microsoft Authenticator。

## 功能特点

- 🔐 基于TOTP (Time-based One-Time Password) 算法
- ⏰ 30秒自动刷新OTP
- 📱 支持所有支持2FA的服务（GitHub、Google、Microsoft等）
- 🔄 自动刷新，无需手动操作

## 部署方法

直接复制worker.js源码到Cloudflare Workers部署。

## 使用方法

### 1. 访问OTP生成器
在URL后添加您的2FA密钥：
```
https://your-domain.com/YOUR_SECRET_KEY
```

**示例：**

```
https://your-domain.com/JBSWY3DPEHPK3PXP
```

### 2. 获取OTP
页面会显示JSON格式的OTP：
```json
{
  "token": "123456"
}
```

OTP每30秒自动刷新，无需手动刷新页面。

## 演示网站

https://2fa.guts.eu.org/MBWJJVDIQ3PH3SA5


## 技术实现

- **算法**: TOTP (RFC 6238)
- **哈希算法**: HMAC-SHA1
- **时间步长**: 30秒
- **OTP长度**: 6位数字

## 许可证

MIT License