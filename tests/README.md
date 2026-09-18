# 测试套件

## 🎯 快速开始

```bash
# 一次性运行所有测试，适合提交前检查和 CI
npm test -- --run

# 观察模式（自动重跑）
npm run test:watch

# 交互式 UI
npm run test:ui

# 生成覆盖率报告并退出
npm run test:coverage -- --run

# 仅运行主题切换回归测试
npx vitest run tests/ui/theme-transition.test.js
```

## 📊 测试结果与验证范围

测试数量、通过/跳过情况以当次运行输出为准；覆盖率以 `npm run test:coverage -- --run` 生成的报告为准。本文不维护固定的覆盖率百分比，也不把历史测试结果作为当前状态。

部分测试包含耗时上限断言，用于在测试环境中发现明显退化。它们不是生产环境延迟、浏览器帧率或可用性承诺；评估性能时应记录设备、运行环境、输入规模及实际测量结果。

Vitest 默认使用 Node 环境。前端测试会执行生成脚本、构造模拟 DOM 或检查生成的 HTML/CSS；通过这些测试不等于已经完成真实浏览器的动画、摄像头、PWA 安装或第三方云服务验收。

## 🔑 功能与回归覆盖

以下列出主要场景及对应测试入口；完整清单以测试目录为准。

| 范围             | 主要验证内容                                                                    | 测试入口                                                                                                                                                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OTP 算法         | RFC 6238 的 SHA1/SHA256/SHA512 向量、RFC 4226 HOTP 向量、Base32、参数和周期边界 | [generator.test.js](otp/generator.test.js)                                                                                                                                                                                                                                                                         |
| 数据加密         | AES-GCM 往返、错误密钥、篡改、IV 随机性、中文和加密配置缺失                     | [encryption.test.js](utils/encryption.test.js)                                                                                                                                                                                                                                                                     |
| 认证             | 密码哈希、JWT 与 Cookie；真实认证模块的设置、登录、刷新、登出和限流集成         | [auth.test.js](utils/auth.test.js)、[auth.integration.test.js](utils/auth.integration.test.js)                                                                                                                                                                                                                     |
| 校验、响应与安全 | Base32/OTP 参数、标准响应、同源检查、CORS 和安全头                              | [validation.test.js](utils/validation.test.js)、[response.test.js](utils/response.test.js)、[security.test.js](utils/security.test.js)                                                                                                                                                                             |
| 请求限流         | 默认滑动窗口、固定窗口兼容路径、窗口边界、客户端识别、拒绝响应和 KV 错误处理    | [rateLimit.test.js](utils/rateLimit.test.js)、[rateLimitSlidingWindow.test.js](utils/rateLimitSlidingWindow.test.js)                                                                                                                                                                                               |
| 密钥与 HOTP      | CRUD、批量导入、计数器推进与冲突、离线同步约束                                  | [secrets.test.js](api/secrets.test.js)、[hotp-counter.test.js](api/hotp-counter.test.js)、[hotp-offline-sync-contract.test.js](scripts/hotp-offline-sync-contract.test.js)                                                                                                                                         |
| 备份与恢复       | 事件触发、并发合并、补偿备份、加密、保留数量与备份格式                          | [backup.test.js](utils/backup.test.js)、[backup.test.js](api/backup.test.js)、[backup-format.test.js](utils/backup-format.test.js)                                                                                                                                                                                 |
| 云同步           | WebDAV/S3/OneDrive/Google Drive 配置与请求行为、OAuth、编辑触发同步             | [api/](api/)、[utils/](utils/)、[edit-triggers-sync.test.js](integration/edit-triggers-sync.test.js)                                                                                                                                                                                                               |
| 导入导出         | 格式识别、CSV 字段转义、URI/HOTP 参数往返、Unicode 二维码与迁移预览             | [import-code.test.js](scripts/import-code.test.js)、[uri-export-roundtrip.test.js](ui/uri-export-roundtrip.test.js)、[qr-text-encoding.test.js](ui/qr-text-encoding.test.js)                                                                                                                                       |
| 前端交互         | 键盘导航、服务分组、偏好自动保存、主题连续反向切换与视口筛选                    | [card-keyboard-navigation.test.js](scripts/card-keyboard-navigation.test.js)、[smart-aggregation-rendering.integration.test.js](scripts/smart-aggregation-rendering.integration.test.js)、[preferences-autosave.test.js](ui/preferences-autosave.test.js)、[theme-transition.test.js](ui/theme-transition.test.js) |
| OTP 页面与调度   | 时间校准、批量刷新、动效清理、复制、公开 TOTP 过期处理和 HOTP 固定计数器        | [otp-time-sync.test.js](scripts/otp-time-sync.test.js)、[otp-promotion-scheduler.test.js](scripts/otp-promotion-scheduler.test.js)、[quick-otp.test.js](ui/quick-otp.test.js)                                                                                                                                      |
| PWA 与脚本输出   | 离线主页回退、队列保留、生成脚本可解析性                                        | [serviceworker-offline.test.js](ui/serviceworker-offline.test.js)、[hotp-offline-sync-contract.test.js](scripts/hotp-offline-sync-contract.test.js)、[emitted-scripts-parse.test.js](scripts/emitted-scripts-parse.test.js)                                                                                        |
| 部署与升级       | 部署配置、发布构建及原地同步保护                                                | [deploy-config.test.js](scripts/deploy-config.test.js)、[build-release-code.test.js](scripts/build-release-code.test.js)、[sync-upstream.test.js](scripts/sync-upstream.test.js)                                                                                                                                   |
| 日志与监控       | 日志过滤、脱敏、请求记录、计时和错误监控                                        | [logger.test.js](utils/logger.test.js)、[monitoring.test.js](utils/monitoring.test.js)                                                                                                                                                                                                                             |

`auth.test.js` 包含认证函数副本的单元测试；验证生产模块的集成行为时，应同时查看直接导入实现的 `auth.integration.test.js`。

## 📁 测试文件结构

```text
tests/
├── api/          # 密钥、备份、设置及云同步 API
├── integration/  # 跨模块集成场景
├── otp/          # TOTP/HOTP 算法与测试向量
├── router/       # 路由和认证边界
├── scripts/      # 前端脚本、调度、导入导出和交互
├── ui/           # 页面生成、样式、PWA 与回归测试
├── utils/        # 加密、认证、备份、限流等工具
├── fixtures/     # 导入导出和同步测试样例
└── setup.js      # Vitest 公共测试环境
```

## 📈 覆盖率详情

覆盖率报告生成在 `coverage/` 目录，可用浏览器打开 `coverage/index.html`。当前 [vitest.config.js](../vitest.config.js) 使用 V8 provider，统计 `src/**/*.js`，排除 `src/ui/**`、`src/worker.js` 和测试文件。因此报告中的覆盖率不代表页面交互或 Worker 入口已经完整验证。

## 💡 编写和维护测试

1. 在对应目录创建 `.test.js` 文件，使用 Vitest 的 `describe` 和 `it`。
2. 优先执行实际模块或生成脚本，围绕用户可观察的行为和明确失败条件编写断言。
3. 使用虚拟密钥、模拟存储和请求替身；第三方实连验证另行记录环境与范围。
4. 新增或修复功能时先运行相关测试，再按影响范围运行完整套件。

后续继续补充真实浏览器端到端覆盖，并为 OTP 批量刷新、主题切换和大规模导入导出保留可重复的性能测量。

## 📚 参考

- [开发指南](../docs/DEVELOPMENT.md)
- [Vitest 文档](https://vitest.dev/)
- [RFC 6238 - TOTP](https://tools.ietf.org/html/rfc6238)
- [RFC 4226 - HOTP](https://tools.ietf.org/html/rfc4226)
