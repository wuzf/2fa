# 2FA OTP Generator

这是一个用Cloudflare Worker实现的Two Factor Authentication (2FA) OTP生成器，可以简单代替Google Authenticator或Microsoft Authenticator。

## 功能特点

- 🔐 基于TOTP (Time-based One-Time Password) 算法
- ⏰ 30秒自动刷新OTP
- 📱 支持所有支持2FA的服务（GitHub、Google、Microsoft等）
- 🔄 自动刷新，无需手动操作
- 🎨 现代化UI界面 + 实时倒计时
- 🔌 双模式支持：Web界面 & JSON API

## 部署方法

直接复制worker.js源码到Cloudflare Workers部署。

## 使用方法

### 模式一：Web界面（推荐给人类使用）

**1. 访问OTP生成器**

在URL后添加您的2FA密钥：
```
https://your-domain.com/YOUR_SECRET_KEY
```

**示例：**
```
https://your-domain.com/JBSWY3DPEHPK3PXP
```

**2. 查看OTP**

页面会显示：
- ✅ 大号的6位数字OTP代码
- ⏱️ 实时倒计时（显示剩余有效秒数）
- 🔄 倒计时结束后自动刷新获取新OTP

**界面特点：**
- 深色主题，保护眼睛
- 大字体显示，易于识别
- 自动刷新，无需手动操作

### 模式二：JSON API（推荐给程序调用）

**访问方式：**

在URL后添加 `?format=json` 参数：
```
https://your-domain.com/YOUR_SECRET_KEY?format=json
```

**示例：**
```
https://your-domain.com/JBSWY3DPEHPK3PXP?format=json
```

**返回格式：**
```json
{
  "token": "123456"
}
```

**字段说明：**
- `token`: 当前的6位数字OTP代码

**命令行使用示例：**

```bash
# 获取OTP token
curl https://your-domain.com/YOUR_SECRET?format=json | jq -r '.token'

# 获取完整信息
curl https://your-domain.com/YOUR_SECRET?format=json

# 在脚本中使用
TOKEN=$(curl -s https://your-domain.com/YOUR_SECRET?format=json | jq -r '.token')
echo "Current OTP: $TOKEN"
```

## 演示网站

**Web界面：**
https://2fa.guts.eu.org/MBWJJVDIQ3PH3SA5

**JSON API：**
https://2fa.guts.eu.org/MBWJJVDIQ3PH3SA5?format=json

## 技术实现

- **算法**: TOTP (RFC 6238)
- **哈希算法**: HMAC-SHA1
- **时间步长**: 30秒
- **OTP长度**: 6位数字
- **支持格式**: HTML页面 / JSON API

## 开发

```bash
# 本地开发
npm run dev

# 部署到Cloudflare Workers
npm run deploy
```

## 安全注意事项

⚠️ **重要提醒：**
- 密钥通过URL传递，会出现在浏览器历史记录和服务器日志中
- 建议仅在私人环境或受信任的网络中使用
- 不要在公共场所或共享设备上使用
- 考虑使用HTTPS以保护传输安全

## 许可证

MIT License