# 贡献指南

感谢你对 2FA Manager 项目的关注！我们欢迎任何形式的贡献。

## 如何贡献

### 报告 Bug

如果你发现了 Bug，请：

1. 检查 [Issues](https://github.com/wuzf/2fa/issues) 中是否已有类似问题
2. 如果没有，创建新的 Issue，使用 "Bug 报告" 模板
3. 提供详细的复现步骤、环境信息和截图

### 提出功能建议

如果你有新功能的想法：

1. 查看现有的 [Feature Requests](https://github.com/wuzf/2fa/labels/enhancement)
2. 创建新的 Issue，使用 "功能请求" 模板
3. 清楚描述功能的用途和预期收益

## 提交代码

### 基本流程

1. **Fork** 仓库并克隆到本地

   ```bash
   git clone https://github.com/YOUR_USERNAME/2fa.git
   cd 2fa
   npm install
   ```

2. **创建分支**

   ```bash
   git checkout -b feature/your-feature-name
   # 或
   git checkout -b fix/your-bug-fix
   ```

3. **开发和测试** — 完成代码修改并确保测试通过

4. **提交代码**

   ```bash
   git add .
   git commit -m "feat: 添加新功能"
   ```

5. **推送并创建 PR**
   ```bash
   git push origin feature/your-feature-name
   ```
   在 GitHub 上创建 Pull Request，填写 PR 模板，等待代码审核。

> 详细的开发环境配置、代码规范和测试指南请参考 [开发文档](../docs/DEVELOPMENT.md)。
> 部署相关信息请参考 [部署文档](../docs/DEPLOYMENT.md)。
> 项目架构详情请参考 [架构文档](../docs/ARCHITECTURE.md)。

## 提交信息格式

使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

- `feat:` 新功能
- `fix:` Bug 修复
- `docs:` 文档更新
- `style:` 代码格式调整
- `refactor:` 代码重构
- `test:` 测试相关
- `chore:` 构建/配置相关

## 代码审核

### 审核标准

- 代码功能正确
- 有适当的测试覆盖
- 代码风格一致
- 有必要的注释和文档
- 没有引入新的安全问题
- 性能没有明显下降

### 审核流程

1. 提交 PR 后，项目维护者会审核代码
2. 如有修改建议，请及时响应
3. 审核通过后会合并到主分支

## 安全

### 报告安全问题

如果发现安全漏洞，请：

1. **不要**公开披露
2. 通过 [GitHub Security Advisories](https://github.com/wuzf/2fa/security/advisories/new) 私密报告
3. 或发送邮件到项目维护者

### 安全最佳实践

- 永远不要提交敏感信息（密码、API Key、密钥等）
- 使用 `.gitignore` 忽略敏感文件
- 加密敏感数据
- 定期更新依赖

## 行为准则

- 尊重所有贡献者
- 建设性的反馈
- 保持专业和友好
- 欢迎新手提问

## 许可证

贡献的代码将遵循项目的 [MIT License](../LICENSE)。

---

再次感谢你的贡献！如有任何疑问，请查看 [项目文档](../README.md) 或在 [Discussions](https://github.com/wuzf/2fa/discussions) 中提问。
