# 案例：坚果云 WebDAV 在 Cloudflare Workers 上返回 520 错误

> 排查过程全记录，从现象到根因，适合零基础阅读。

---

## 目录

1. [背景介绍](#1-背景介绍)
2. [问题现象](#2-问题现象)
3. [排查过程](#3-排查过程)
   - [第一轮：以为是 HTTP 方法不支持](#31-第一轮以为是-http-方法不支持)
   - [第二轮：以为是缺少 User-Agent](#32-第二轮以为是缺少-user-agent)
   - [第三轮：加调试信息，发现 Cloudflare](#33-第三轮加调试信息发现-cloudflare)
   - [第四轮：海外 VPS 验证，修正根因](#34-第四轮海外-vps-验证修正根因)
4. [根因分析](#4-根因分析)
5. [知识点详解](#5-知识点详解)
   - [什么是 HTTP 520 错误？](#51-什么是-http-520-错误)
   - [什么是 Cloudflare CDN？](#52-什么是-cloudflare-cdn)
   - [什么是 Cloudflare Workers？](#53-什么是-cloudflare-workers)
   - [什么是 WebDAV？](#54-什么是-webdav)
   - [如何判断一个网站是否在 Cloudflare 后面？](#55-如何判断一个网站是否在-cloudflare-后面)
6. [最终解决方案](#6-最终解决方案)
7. [教训与收获](#7-教训与收获)
8. [参考资料](#8-参考资料)

---

## 1. 背景介绍

### 项目是什么？

「2FA Manager」是一个部署在 **Cloudflare Workers** 上的两步验证密钥管理工具。它可以：
- 存储你各个网站的 2FA 密钥
- 生成 TOTP 验证码
- 自动备份密钥数据

### 想做什么？

我们想给这个工具加一个「WebDAV 自动推送」功能：每次备份时，自动把备份文件推送到用户的 WebDAV 网盘（比如坚果云），这样即使 Cloudflare KV 数据丢失，用户也有一份备份在自己的网盘里。

### 用户的配置

| 配置项 | 值 |
|--------|-----|
| WebDAV 服务器 | `https://dav.jianguoyun.com/dav` (坚果云) |
| 用户名 | `user@example.com` |
| 密码 | 坚果云的应用专用密码 |
| 备份路径 | `/` |

用户确认账号密码没有问题，在其他 WebDAV 客户端中可以正常使用。

---

## 2. 问题现象

部署完成后，用户在 `https://2fa.guts.eu.org/` 页面打开 WebDAV 设置，填入坚果云的地址和凭据，点击「测试连接」按钮，页面提示：

> ❌ 服务器返回 520

用户反复检查了账号密码，确认无误，但始终无法连接。

---

## 3. 排查过程

### 3.1 第一轮：以为是 HTTP 方法不支持

**假设：** WebDAV 使用的 `PROPFIND` 方法不被坚果云支持，所以返回错误。

**做了什么：** 在 `PROPFIND` 失败后，加了回退逻辑，先试 `PROPFIND`，如果返回 405（方法不允许），就改用 `OPTIONS` 方法。

```
PROPFIND 失败(405) → 回退到 OPTIONS
```

**结果：** 部署后依然报 520。因为 520 ≠ 405，回退逻辑没被触发。

**修正：** 把 520 也加入回退条件。

```
PROPFIND 失败(405 或 520) → 回退到 OPTIONS
```

**结果：** 依然失败。OPTIONS 方法也返回 520。

**反思：** 说明不是某个方法不被支持的问题——是所有方法都失败了。

---

### 3.2 第二轮：以为是缺少 User-Agent

**假设：** Cloudflare Workers 的 `fetch()` 默认不发送 `User-Agent` 请求头，坚果云服务器可能会拒绝没有 `User-Agent` 的请求。

**做了什么：** 给所有 WebDAV 请求加上了 `User-Agent` 头：

```javascript
const WEBDAV_USER_AGENT = '2FA-Manager/1.0 (Cloudflare Workers; WebDAV Client)';

// 每个 fetch 调用都加上：
headers: {
    Authorization: authHeader,
    'User-Agent': WEBDAV_USER_AGENT,
}
```

同时扩展了测试方法，改为依次尝试三种方法：

```
PROPFIND → HEAD → GET
```

**结果：** 三种方法全部返回 520。

**反思：** 不是请求头的问题。三种完全不同的 HTTP 方法都返回同样的错误，说明问题在更底层。

---

### 3.3 第三轮：加调试信息，发现 Cloudflare

**做了什么：** 在 `testWebDAVConnection` 函数中加入了调试代码，捕获每次请求的完整响应信息（状态码、响应头、响应体前 200 字符），一并返回给前端。

然后在浏览器控制台直接调用测试 API：

```javascript
const resp = await fetch('/api/webdav/test', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        url: 'https://dav.jianguoyun.com/dav',
        username: 'user@example.com',
        password: 'YOUR_APP_PASSWORD',
        path: '/'
    })
});
const data = await resp.json();
console.log(JSON.stringify(data, null, 2));
```

**看到的调试数据：**

```json
{
    "success": false,
    "message": "连接失败：所有测试方法均不可用，请检查服务器地址和网络",
    "debug": [
        {
            "method": "PROPFIND",
            "status": 520,
            "headers": {
                "server": "cloudflare",
                "cf-ray": "9d58d8a4a2c8dcfa-LAX"
            },
            "bodyPreview": "error code: 520"
        },
        {
            "method": "HEAD",
            "status": 520,
            "headers": {
                "server": "cloudflare",
                "cf-ray": "9d58d8a74387dcfa-LAX"
            },
            "bodyPreview": ""
        },
        {
            "method": "GET",
            "status": 520,
            "headers": {
                "server": "cloudflare",
                "cf-ray": "9d58d8aa1461dcfa-LAX"
            },
            "bodyPreview": "error code: 520"
        }
    ]
}
```

**关键发现：**

响应头中出现了两个决定性的字段：
- `"server": "cloudflare"` → 请求经过了 Cloudflare 的基础设施
- `"cf-ray": "...-LAX"` → 请求经过了 Cloudflare 的洛杉矶（LAX）节点

**初步结论（后来被修正）：** 坚果云使用了 Cloudflare CDN，CDN 看不懂 WebDAV 的 207 响应，所以返回 520。

但这个结论对吗？我们决定用海外 VPS 进一步验证。

---

### 3.4 第四轮：海外 VPS 验证，修正根因

**为什么要再验证？** 第三轮得出的结论是「Cloudflare CDN 看不懂 WebDAV 响应」。但如果这是真的，那么任何通过 Cloudflare CDN 访问坚果云的客户端都应该失败。我们用一台洛杉矶的 VPS 来验证。

**做了什么：** 在美国洛杉矶的 VPS（RackNerd）上执行了三组测试。

**测试 1：国内直连 vs 海外访问**

```bash
# 国内电脑
$ curl -sI https://dav.jianguoyun.com | head -3
HTTP/1.1 403 Forbidden
Server: nginx                    ← 国内直连坚果云 nginx，不经过 CF

# 洛杉矶 VPS
$ curl -sI https://dav.jianguoyun.com | head -3
HTTP/2 403
server: nginx                    ← 等等... 海外也是 nginx？！
```

**意外发现：** 虽然 DNS 解析到了 Cloudflare IP，但 `server` 头显示的是 `nginx`，不是 `cloudflare`。Cloudflare 在这里是作为负载均衡器（Load Balancer）透传请求，没有改写响应头。

**测试 2：带认证的 WebDAV 请求**

```bash
# 洛杉矶 VPS - PROPFIND 请求
$ curl -sI -X PROPFIND \
    -H "Authorization: Basic $(echo -n 'user@example.com:YOUR_APP_PASSWORD' | base64)" \
    -H "Depth: 0" \
    https://dav.jianguoyun.com/dav/

HTTP/2 207                       ← ✅ WebDAV 正常返回 207！
server: nginx
content-type: text/xml; charset=UTF-8
```

**关键发现：** 从海外 VPS 通过 Cloudflare CDN 访问坚果云 WebDAV，**PROPFIND 返回 207 完全正常**！这直接推翻了「CDN 看不懂 WebDAV 响应」的假设。

**测试 3：DNS 解析链路**

```bash
$ nslookup dav.jianguoyun.com
dav.jianguoyun.com      → app.jianguoyun.com
                        → cloudflarelb.jianguoyun.com
                        → cloudflarelb.jianguoyun.com.cdn.cloudflare.net
                        → 172.65.209.49 (Cloudflare IP)
```

DNS CNAME 链中的 `cloudflarelb` 明确表明坚果云使用 Cloudflare 作为**负载均衡器**（LB），不是传统的 CDN 代理。

**对比结论：**

| 请求来源 | 路径 | PROPFIND 结果 |
|---------|------|--------------|
| 海外 VPS（curl） | curl → Cloudflare LB → 坚果云 | **207 成功** |
| Cloudflare Workers（fetch） | Workers → Cloudflare LB → 坚果云 | **520 失败** |

同样经过 Cloudflare，curl 正常但 Workers 的 `fetch()` 失败 → **问题出在 Workers fetch() 自身**。

---

## 4. 根因分析

### 正常情况下的网络路径

当你在国内的电脑或手机上使用坚果云 WebDAV 时：

```
你的设备 (国内)
  → 坚果云源服务器 (国内 nginx)
  ✅ 直连，正常工作
```

当你从海外 VPS（如洛杉矶）使用坚果云 WebDAV 时：

```
海外 VPS
  → Cloudflare 负载均衡 (坚果云的 LB)
    → 坚果云源服务器
  ✅ 正常返回 207，WebDAV 工作正常
```

### 出问题的网络路径

当 Cloudflare Workers 去连接坚果云时：

```
你的浏览器
  → Cloudflare Workers (你的 2FA 应用)  ← 第一层 Cloudflare
    → Cloudflare LB (坚果云的负载均衡)  ← 第二层 Cloudflare
      → 坚果云源服务器 (国内)
```

形成了 **Cloudflare → Cloudflare → 源站** 的「套娃」结构。

### 为什么会失败？

这是排查中最关键的发现：**Cloudflare CDN 本身能正确传递 WebDAV 的 207 响应**（海外 VPS 用 curl 通过同一条 DNS 链路访问完全正常）。

520 的真正原因是 **Cloudflare Workers 的 `fetch()` 请求另一个 Cloudflare 代理的域名时，触发了 Cloudflare 内部的路由冲突或回环检测机制**。

具体来说：
1. Cloudflare Workers 的 `fetch()` 发出请求，出口 IP 在海外（本次是 LAX 节点）
2. DNS 将 `dav.jianguoyun.com` 解析到 Cloudflare IP（`172.65.209.49`），因为坚果云使用了 Cloudflare 负载均衡
3. 请求从 Cloudflare Workers 边缘节点发往 Cloudflare 负载均衡节点——**两者都是 Cloudflare 内部基础设施**
4. Cloudflare 检测到这是一个从自身边缘网络发往自身边缘网络的请求，触发内部安全机制，返回 520

这类似于一个信件在邮局内部转来转去，最终因为「内部循环」被退回——信件本身没问题，收件地址也没问题，问题在于转运方式。

### 一张图理解

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────────┐     ┌──────────────┐
│   你的浏览器  │──→ │ Cloudflare Workers │──→ │  Cloudflare LB    │──→ │  坚果云源服务器 │
│             │     │ (你的 2FA 应用)    │     │ (坚果云的负载均衡) │     │   (国内)      │
└─────────────┘     └──────────────────┘     └──────────────────┘     └──────────────┘
                           │                        │                        │
                      发出 PROPFIND            Cloudflare 内部            正常返回 207
                      HEAD/GET 请求            路由冲突，返回 520          XML 目录列表
                           │                        │                   （但根本到不了这里）
                           │←─── HTTP 520 ──────────│
                           │
                      所有方法都失败
```

### 对比实验：为什么海外 VPS 没问题？

| 请求来源 | 到 Cloudflare LB 的请求来源 | 结果 |
|---------|--------------------------|------|
| 国内电脑 | 来自普通客户端 IP | ✅ server: nginx, 正常 |
| 海外 VPS (curl) | 来自普通服务器 IP | ✅ server: nginx, 207 正常 |
| Cloudflare Workers (fetch) | 来自 Cloudflare 内部边缘节点 IP | ❌ 520 错误 |

关键区别：Workers 的 `fetch()` 请求源 IP 属于 Cloudflare 自身的 IP 段。当 Cloudflare 负载均衡收到来自 Cloudflare 自身 IP 的请求时，触发了内部保护机制。

### 为什么国内直连没问题？

从国内网络访问 `dav.jianguoyun.com` 时，DNS 解析到坚果云的国内 nginx 服务器 IP（不经过 Cloudflare），WebDAV 响应直接返回给客户端，完全不涉及 Cloudflare。

---

## 5. 知识点详解

### 5.1 什么是 HTTP 520 错误？

**520 不是标准的 HTTP 状态码**，它是 Cloudflare 自定义的。标准 HTTP 状态码只定义到 511。

| 状态码 | 含义 | 谁定义的 |
|--------|------|---------|
| 200 | 成功 | HTTP 标准 |
| 404 | 页面未找到 | HTTP 标准 |
| 500 | 服务器内部错误 | HTTP 标准 |
| **520** | **源站返回了未知响应** | **Cloudflare 自定义** |
| 521 | 源站拒绝连接 | Cloudflare 自定义 |
| 522 | 连接源站超时 | Cloudflare 自定义 |
| 523 | 源站不可达 | Cloudflare 自定义 |
| 524 | 源站响应超时 | Cloudflare 自定义 |

Cloudflare 官方对 520 的描述：

> Error 520 occurs when the origin server returns an **empty, unknown, or unexpected response** to Cloudflare.

翻译：当源站返回了空的、未知的或意外的响应时，Cloudflare 就返回 520。

**官方文档地址：**
[https://developers.cloudflare.com/support/troubleshooting/cloudflare-errors/troubleshooting-cloudflare-5xx-errors/#error-520](https://developers.cloudflare.com/support/troubleshooting/cloudflare-errors/troubleshooting-cloudflare-5xx-errors/#error-520)

---

### 5.2 什么是 Cloudflare CDN？

**CDN（Content Delivery Network）** 叫「内容分发网络」，你可以理解为在全球各地放了很多个「缓存服务器」。

打个比方：
- 没有 CDN：你在福州，想吃北京烤鸭，要从北京快递过来 → 很慢
- 有 CDN：北京烤鸭在福州设了分店（缓存节点），就近供应 → 很快

**Cloudflare CDN** 就是最大的 CDN 服务商之一。很多网站（包括坚果云）把自己的域名解析到 Cloudflare 的 IP 上，让 Cloudflare 帮忙加速和防护。

当你访问一个使用了 Cloudflare CDN 的网站时，实际的访问路径是：

```
你 → Cloudflare CDN 节点 → 源站服务器
```

Cloudflare 在中间「代理」了请求和响应。大部分时候这能加速访问，并且能正确传递各种 HTTP 响应（包括 WebDAV 的 207 响应）。但当请求来自 Cloudflare 自身的基础设施（如 Workers）时，可能触发内部路由冲突（比如我们遇到的 520）。

---

### 5.3 什么是 Cloudflare Workers？

**Cloudflare Workers** 是 Cloudflare 提供的「无服务器计算平台」。你可以把 JavaScript 代码部署在 Cloudflare 的全球边缘网络上运行，不需要自己买服务器。

优点：
- 免费额度够个人使用
- 全球部署，访问速度快
- 不需要维护服务器

限制：
- 代码运行在 Cloudflare 的环境中，有一些限制
- **`fetch()` 发出的请求出口 IP 在海外**（这就是我们遇到问题的原因之一）

---

### 5.4 什么是 WebDAV？

**WebDAV（Web Distributed Authoring and Versioning）** 是 HTTP 协议的扩展，让你可以通过网络像操作本地文件一样管理远程文件（上传、下载、创建文件夹、列目录等）。

它在标准 HTTP 方法（GET、POST、PUT、DELETE）基础上增加了几个专有方法：

| 方法 | 作用 | 说明 |
|------|------|------|
| `PROPFIND` | 查看文件/目录属性 | 类似 `ls -la` |
| `MKCOL` | 创建目录 | 类似 `mkdir` |
| `COPY` | 复制文件 | 类似 `cp` |
| `MOVE` | 移动/重命名文件 | 类似 `mv` |
| `LOCK/UNLOCK` | 锁定/解锁文件 | 防止并发修改 |

WebDAV 响应也有自己的格式，比如 `207 Multi-Status` 状态码配合 XML 响应体。经过实测验证，**Cloudflare CDN/LB 能正确传递这些响应**（海外 VPS 通过 Cloudflare 访问坚果云 PROPFIND 返回 207 完全正常）。520 错误的原因并非 CDN 看不懂 WebDAV 响应，而是 Workers 内部的路由冲突机制。

坚果云、NextCloud、Alist 等工具都支持 WebDAV 协议。

---

### 5.5 如何判断一个网站是否在 Cloudflare 后面？

#### 方法一：浏览器 F12（最简单）

1. 打开浏览器，按 F12 打开开发者工具
2. 切换到 Network（网络）面板
3. 刷新页面
4. 点击第一个请求，查看 Response Headers（响应头）
5. 找这两个字段：

```
server: cloudflare              ← 看到这个就确认了
cf-ray: 9d58d8a4a2c8dcfa-LAX    ← Cloudflare 请求 ID，LAX 是节点代号
```

#### 方法二：命令行 curl

```bash
curl -sI https://dav.jianguoyun.com | grep -i "server\|cf-ray"
```

如果输出：
```
server: cloudflare
cf-ray: xxxxxxx-LAX
```

就说明在 Cloudflare 后面。

#### 方法三：查 DNS 解析

```bash
nslookup dav.jianguoyun.com
```

如果解析到的 IP 在以下范围内，就属于 Cloudflare：
- `104.16.x.x` ~ `104.31.x.x`
- `172.64.x.x` ~ `172.71.x.x`
- `103.21.244.x` ~ `103.22.201.x`

完整列表：[https://www.cloudflare.com/ips/](https://www.cloudflare.com/ips/)

#### 方法四：在线工具

- [BuiltWith](https://builtwith.com) — 输入域名，看技术栈里有没有 Cloudflare
- [SecurityTrails](https://securitytrails.com) — 查域名的 DNS 历史

---

## 6. 最终解决方案

### 代码修改

清理了所有调试代码，在 `testWebDAVConnection` 函数中加入了 520 专用检测：

```javascript
// 跟踪是否所有请求都返回 520
let all520 = true;

for (const { method, headers } of methods) {
    // ... 发送请求 ...

    if (response.status !== 520) {
        all520 = false;
    }

    // 520/405 继续尝试下一个方法
    if (response.status === 520 || response.status === 405) {
        continue;
    }
}

// 所有请求都返回 520：给用户明确的提示
if (all520) {
    return {
        success: false,
        message: '该 WebDAV 服务器使用了 Cloudflare CDN，'
               + 'Cloudflare Workers 内部请求会触发路由冲突（错误 520）。'
               + '请使用未经 Cloudflare 代理的 WebDAV 服务，如自建 NextCloud、Alist 等。',
    };
}
```

### 为什么不能在代码层面修复？

这是 Cloudflare 平台级的限制，不是代码 bug。根本原因是 Workers 的 `fetch()` 请求源 IP 属于 Cloudflare 自身的 IP 段，当目标域名也在 Cloudflare 后面时，Cloudflare 内部的路由/回环检测机制会拦截请求返回 520。

Cloudflare 官方提供了几个绕过方案，但大部分对第三方服务（如坚果云）不适用：

| 官方方案 | 适用场景 | 对坚果云是否可行 |
|---------|---------|----------------|
| Service Bindings | 同账户下 Worker 互调 | ❌ 坚果云不是你的 Worker |
| `cf.resolveOverride` | 自定义 DNS 解析绕过 CF | ❌ 仅 Enterprise 付费计划 |
| 灰云 DNS（关闭 CF 代理） | 你控制目标域名的 DNS | ❌ 你无法控制坚果云的 DNS |
| 不挂 Worker 路由的子域名 | 同 Zone 下分流 | ❌ 坚果云不在你的 Zone |

### 用户可以怎么办？

#### 方案一：VPS 反向代理中转（推荐，你已有 VPS）

利用你已有的洛杉矶 VPS 做中转。已验证 VPS 直连坚果云 WebDAV 完全正常（PROPFIND 返回 207）。

**原理：**
```
之前（失败）：Workers fetch() [CF IP] → Cloudflare LB → 坚果云 → 520
现在（成功）：Workers fetch() → 你的 VPS [普通 IP] → 坚果云 → 207 ✅
```

**VPS 上的 nginx 配置：**

```nginx
server {
    listen 443 ssl;
    server_name webdav-proxy.yourdomain.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location /dav/ {
        proxy_pass https://dav.jianguoyun.com/dav/;
        proxy_set_header Host dav.jianguoyun.com;
        proxy_set_header Authorization $http_authorization;
        proxy_ssl_server_name on;
    }
}
```

然后 Worker 中把 WebDAV URL 从 `https://dav.jianguoyun.com/dav` 改为 `https://webdav-proxy.yourdomain.com/dav` 即可。

| 项目 | 说明 |
|------|------|
| 难度 | ⭐⭐ 中等（需要有 VPS 和域名） |
| 费用 | 低（你已有 VPS） |
| 优点 | 不改变用户习惯，备份仍在坚果云 |
| 缺点 | 多一跳延迟，VPS 挂了备份中断 |

#### 方案二：改用 Cloudflare R2 存储备份（最稳定）

放弃 WebDAV，用 Cloudflare R2（S3 兼容的对象存储）存备份。R2 和 Workers 同属 Cloudflare 内部网络，通过 binding 直连，不走 HTTP，完全不存在路由冲突问题。

**wrangler.toml 配置：**
```toml
[[r2_buckets]]
binding = "BACKUP_BUCKET"
bucket_name = "2fa-backups"
```

**代码示例：**
```javascript
// 存储备份
await env.BACKUP_BUCKET.put(backupKey, backupContent);

// 读取备份
const object = await env.BACKUP_BUCKET.get(backupKey);
const content = await object.text();

// 列出所有备份
const list = await env.BACKUP_BUCKET.list({ prefix: 'backup_' });
```

| 项目 | 说明 |
|------|------|
| 难度 | ⭐⭐ 中等（需要改代码） |
| 费用 | 免费（R2 免费额度：10GB 存储 + 每月 1000 万次读 + 100 万次写） |
| 优点 | 零延迟、最稳定、无外部依赖、和 Workers 原生集成 |
| 缺点 | 用户不能像网盘一样直接浏览文件；需要单独做导出功能 |

#### 方案三：换用不在 Cloudflare 后面的 WebDAV 服务

| 替代服务 | 说明 |
|---------|------|
| 自建 NextCloud | 开源私有云，支持 WebDAV，部署在自己的 VPS 上 |
| Alist | 轻量存储管理工具，支持 WebDAV，Docker 一键部署 |
| 群晖 NAS WebDAV | 如果有群晖 NAS，自带 WebDAV Server 套件 |
| InfiniCLOUD (teracloud.jp) | 日本免费 WebDAV 服务，不在 Cloudflare 后面 |

| 项目 | 说明 |
|------|------|
| 难度 | ⭐ 简单（只需更换 WebDAV 地址） |
| 费用 | 免费~低 |
| 优点 | 不需要改代码，现有 WebDAV 功能直接可用 |
| 缺点 | 需要用户迁移，放弃坚果云 |

### 方案对比总结

| 方案 | 难度 | 费用 | 是否需要改代码 | 备份位置 | 稳定性 |
|------|------|------|--------------|---------|--------|
| VPS 反代中转 | ⭐⭐ | 低 | 不需要 | 坚果云 | 依赖 VPS |
| Cloudflare R2 | ⭐⭐ | 免费 | 需要 | R2 存储桶 | 最高 |
| 换 WebDAV 服务 | ⭐ | 免费~低 | 不需要 | 新的 WebDAV 服务 | 取决于服务 |

---

## 7. 教训与收获

### 排查方法论

| 步骤 | 我们做了什么 | 教训 |
|------|------------|------|
| 1. 先猜测 | 猜是 HTTP 方法不支持 | 猜测可以作为起点，但不能只靠猜 |
| 2. 加回退 | 加了 PROPFIND → OPTIONS 回退 | 修了一个可能的原因，但没验证根因 |
| 3. 继续猜 | 猜是缺少 User-Agent | 多种方法都失败时，要怀疑更底层的原因 |
| 4. 加调试 | 返回完整的响应头和响应体 | **看数据说话**，发现了 Cloudflare 的介入 |
| 5. 初步结论 | 以为是 CDN 看不懂 WebDAV 响应 | 看起来合理，但未经验证的结论可能是错的 |
| 6. 交叉验证 | 用海外 VPS curl 同一域名 | **推翻了初步结论**，发现 CDN 能正确传递 207 |
| 7. 修正根因 | 确认是 Workers → CF 内部路由冲突 | 多维度验证才能得到正确结论 |

### 核心教训

1. **先看数据，再下结论。** 头两轮排查都是在猜测，浪费了时间。第三轮加了调试信息后，一眼就看到了 `server: cloudflare`。

2. **结论需要交叉验证。** 看到 `server: cloudflare` 后，我们最初以为是「CDN 看不懂 WebDAV 响应」。但用海外 VPS 做对比实验后发现，同样经过 Cloudflare 的 curl 请求完全正常（207），直接推翻了这个假设。**如果没有这一步验证，我们会带着错误的根因给用户错误的建议。**

3. **当所有变种都失败时，问题不在变种本身。** PROPFIND、HEAD、GET 全部返回 520，说明问题不在 HTTP 方法，而在更底层（网络路径）。

4. **Cloudflare Workers 的 `fetch()` 有隐含限制。** 它的出口 IP 属于 Cloudflare 自身的 IP 段，当目标域名也在 Cloudflare 后面时，会触发内部路由冲突或回环检测，产生 520 错误。这是一个平台级的限制，无法在应用层规避。

5. **「套娃」架构要警惕。** Cloudflare Workers（第一层 CF）→ Cloudflare LB（第二层 CF）→ 源站，两层 Cloudflare 之间的内部路由冲突是问题根源，而非协议不兼容。

---

## 8. 参考资料

- [Cloudflare 5XX 错误排查官方文档](https://developers.cloudflare.com/support/troubleshooting/cloudflare-errors/troubleshooting-cloudflare-5xx-errors/#error-520)
- [Cloudflare IP 地址列表](https://www.cloudflare.com/ips/)
- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [WebDAV 协议 (RFC 4918)](https://datatracker.ietf.org/doc/html/rfc4918)
- [坚果云 WebDAV 文档](https://help.jianguoyun.com/?p=2064)
- [Cloudflare Community Forum](https://community.cloudflare.com) — 搜索 "520 error" 可找到更多案例

---

*文档生成日期：2026-03-01（根因修正于同日）*
*问题发现到定位耗时：4 轮排查，4 次部署，1 次海外 VPS 交叉验证*
