# 手动回归测试指南：升级流程与首次部署

本文件用于手动验证下面 3 个场景是否成立：

1. 旧用户基于 `tag v1.0.0` 部署的仓库，能否正常升级到最新版本
2. 旧用户基于 `tag v1.1.0` 部署的仓库，能否正常升级到最新版本
3. 新用户基于最新版本，能否正常首次一键部署

---

## 1. 测试目标

你需要确认的不是“代码能跑”，而是“真实用户升级时不会丢配置、不会丢 KV 绑定、不会跳回 `/setup`”。

每个场景至少要验证下面几点：

- GitHub 仓库能拿到最新代码
- Cloudflare 构建命令和部署命令正确
- Worker 部署后仍然绑定 `SECRETS_KV`
- 已有数据不会消失
- 已有用户不会重新回到 `/setup`

---

## 2. 测试前原则

请严格遵守下面几条：

- 不要使用生产仓库
- 不要使用生产 Worker
- 不要使用生产 KV
- 不要使用生产域名
- 每个测试场景都使用独立的 GitHub 仓库
- 每个测试场景都使用独立的 Cloudflare Worker

如果你当前本地代码还没有推送到正式上游 `wuzf/2fa`，那么**不要**把老用户测试仓库的 `Sync Upstream` 指向 `wuzf/2fa`，而应该先创建一个“最新代码镜像仓库”，让所有测试仓库从这个镜像仓库升级。

---

## 3. 你需要准备哪些仓库

建议一共准备 4 个 GitHub 仓库。

### 3.1 最新代码镜像仓库

用途：作为“升级到最新版本”的来源仓库。

建议仓库名：

```text
2fa-upgrade-source-manual
```

这个仓库里放的是你**当前本地最新代码**。

### 3.2 旧用户 v1.0.0 测试仓库

用途：模拟“老用户当年在 `v1.0.0` 部署过，现在要升级”。

建议仓库名：

```text
2fa-upgrade-v100-manual
```

### 3.3 旧用户 v1.1.0 测试仓库

用途：模拟“老用户当年在 `v1.1.0` 部署过，现在要升级”。

建议仓库名：

```text
2fa-upgrade-v110-manual
```

### 3.4 最新版本首次部署测试仓库

用途：模拟“一个全新的用户，直接用最新版本首次一键部署”。

建议仓库名：

```text
2fa-upgrade-latest-manual
```

---

## 4. 你需要准备哪些 Worker

建议一共准备 3 个 Cloudflare Worker。

建议命名如下：

```text
2fa-test-v100
2fa-test-v110
2fa-test-latest
```

每个 Worker 对应一个 GitHub 测试仓库。

不要复用。

---

## 5. Cloudflare Git 构建固定配置

如果你手动把 GitHub 仓库连接到 Cloudflare Worker，必须使用下面这组固定配置。

### 必填配置

- 根目录：`/`
- 构建命令：`npm run build`
- 部署命令：`npm run deploy`
- 版本命令：`npm run deploy`

### 绝对不要这样填

不要把部署命令写成：

```bash
npx wrangler deploy
```

不要把版本命令写成：

```bash
npx wrangler versions upload
```

原因：

- 这会绕过项目里的 `scripts/deploy.js`
- 会跳过项目里的 `SW_VERSION` 版本注入
- 不利于和仓库默认部署路径保持一致

---

## 6. 建议使用的测试假数据

添加 2 到 3 条假的 2FA 数据即可。

可直接使用下面这些假密钥：

```text
服务名: GitHub Test
账户: user1@example.com
密钥: JBSWY3DPEHPK3PXP

服务名: Google Test
账户: user2@example.com
密钥: MFRGGZDFMZTWQ2LK

服务名: Bitwarden Test
账户: user3@example.com
密钥: KRSXG5CTMVRXEZLU
```

这些只是测试用假数据，不是有效生产密钥。

---

## 7. 先创建“最新代码镜像仓库”

这一步非常重要。

如果你当前本地最新版代码还没有推到正式上游 `wuzf/2fa`，后续所有旧用户升级测试都应该从你自己的镜像仓库同步，而不是从正式上游同步。

### 7.1 GitHub 上新建仓库

新建一个空仓库：

```text
2fa-upgrade-source-manual
```

### 7.2 把当前本地最新代码推上去

在当前工程目录执行：

```bash
git remote add manual-source https://github.com/<你的 GitHub 用户名>/2fa-upgrade-source-manual.git
git push manual-source HEAD:main
```

如果已经添加过这个远端，就不要重复添加。

### 7.3 确认镜像仓库是最新代码

确认这个仓库里至少包含：

- `scripts/merge-wrangler-config.js`
- `.github/workflows/sync-upstream.yml`
- `README.md` 中关于 `npm run deploy` 的说明

---

## 8. 场景一：旧用户基于 v1.0.0 升级

## 8.1 创建测试仓库

GitHub 上新建空仓库：

```text
2fa-upgrade-v100-manual
```

## 8.2 把 `v1.0.0` 代码推上去

在当前工程目录执行：

```bash
git worktree add ../2fa-tag-v100 v1.0.0
git -C ../2fa-tag-v100 push https://github.com/<你的 GitHub 用户名>/2fa-upgrade-v100-manual.git HEAD:refs/heads/main
```

## 8.3 给“用户自己的旧仓库”补上 `Sync Upstream`

这里要特别注意：

- `wuzf/2fa-upgrade-v100-manual` 只是**种子仓库**
- 如果你走的是 **Cloudflare 一键部署**，Cloudflare 会在**你的 GitHub 账号下**再创建一个独立仓库
- 后续真正升级的对象，是**你自己账号下这个新创建的独立仓库**
- `Sync Upstream` 应该加在**用户自己的那个独立仓库**上，不是加在种子仓库上

也就是说，如果你的 GitHub 用户名是 `3555`，而一键部署后 Cloudflare 在你账号下创建了：

```text
3555/2fa-test-v100-manual
```

那么你要操作的是：

```text
3555/2fa-test-v100-manual
```

不是：

```text
wuzf/2fa-upgrade-v100-manual
```

旧用户仓库里通常没有 `Actions -> Sync Upstream`。

⚠️ 这里还有一个非常重要的点：

- 手动测试阶段，不要再从正式上游 `wuzf/2fa` 复制 workflow 文件
- 因为正式上游未必已经包含你当前正在验证的最新版流程
- 这里应当始终从“最新代码镜像仓库”复制 workflow 文件

你需要手动新增文件：

```text
/.github/workflows/sync-upstream.yml
```

### 最傻瓜的方法：GitHub 网页操作

1. 打开**你自己账号下的一键部署生成仓库**
2. 点击 `Add file`
3. 点击 `Create new file`
4. 文件名输入：

   ```text
   .github/workflows/sync-upstream.yml
   ```

5. 打开“最新代码镜像仓库”中的 workflow 文件：

   ```text
   https://github.com/<你的 GitHub 用户名>/2fa-upgrade-source-manual/blob/main/.github/workflows/sync-upstream.yml
   ```

   如果你沿用本指南里的仓库命名，那么当前应使用：

   ```text
   https://github.com/wuzf/2fa-upgrade-source-manual/blob/main/.github/workflows/sync-upstream.yml
   ```

6. 复制全部内容到 GitHub 网页
7. **修改其中这一行**：

   ```yaml
   UPSTREAM_REPO: wuzf/2fa
   ```

   改成：

   ```yaml
   UPSTREAM_REPO: <你的 GitHub 用户名>/2fa-upgrade-source-manual
   ```

8. 提交到 `main`

### 提交后检查

打开**你自己账号下那个仓库**的 `Actions` 页面，确认能看到：

```text
Sync Upstream
```

## 8.4 连接 Cloudflare Worker

新建测试 Worker：

```text
2fa-test-v100
```

连接 Git 仓库时填写：

- 仓库：`2fa-upgrade-v100-manual`
- 分支：`main`
- 根目录：`/`
- 构建命令：`npm run build`
- 部署命令：`npm run deploy`
- 版本命令：`npm run deploy`

## 8.5 先部署旧版本，再制造“已有用户状态”

1. 等第一次 Cloudflare 构建成功
2. 打开 Worker 访问地址
3. 设置一个测试密码
4. 添加上面给出的 2 到 3 条假数据
5. 确认刷新页面后数据还在

## 8.6 运行升级

1. 打开**你自己账号下的一键部署生成仓库**
2. 进入 `Actions`
3. 点击 `Sync Upstream`
4. 点击 `Run workflow`

## 8.7 观察结果

需要确认：

- GitHub Action 成功
- 新提交类似：

  ```text
  chore: sync upstream (main)
  ```

- Cloudflare 自动开始新构建
- 新构建日志里有：

  ```text
  Executing user deploy command: npm run deploy
  ```

- bindings 里有：

  ```text
  env.SECRETS_KV
  ```

- 打开站点后：
  - 不跳 `/setup`
  - 旧密码仍然有效
  - 旧假数据仍然在

---

## 9. 场景二：旧用户基于 v1.1.0 升级

步骤和 `v1.0.0` 完全一样，只是把 tag 和仓库名换掉。

### 9.1 创建仓库

```text
2fa-upgrade-v110-manual
```

### 9.2 推送 `v1.1.0`

```bash
git worktree add ../2fa-tag-v110 v1.1.0
git -C ../2fa-tag-v110 push https://github.com/<你的 GitHub 用户名>/2fa-upgrade-v110-manual.git HEAD:refs/heads/main
```

### 9.3 手动补 `Sync Upstream`

同样新增：

```text
/.github/workflows/sync-upstream.yml
```

同样要注意：

- 如果你走的是 **Cloudflare 一键部署**
- 需要补文件的是**你自己账号下生成出来的独立仓库**
- 不是 `wuzf/2fa-upgrade-v110-manual` 这个种子仓库

并把：

```yaml
UPSTREAM_REPO: wuzf/2fa
```

改成：

```yaml
UPSTREAM_REPO: <你的 GitHub 用户名>/2fa-upgrade-source-manual
```

### 9.4 连接 Cloudflare Worker

Worker 名建议：

```text
2fa-test-v110
```

构建配置仍然固定为：

- 根目录：`/`
- 构建命令：`npm run build`
- 部署命令：`npm run deploy`
- 版本命令：`npm run deploy`

### 9.5 先部署旧版本，再加假数据

和 `v1.0.0` 场景完全相同。

### 9.6 运行升级并验证

验证标准也完全相同：

- 不跳 `/setup`
- 旧数据保留
- `env.SECRETS_KV` 仍在
- 不出现“创建新 KV namespace”的日志

---

## 10. 场景三：新用户基于最新版本首次一键部署

这个场景最简单。

## 10.1 创建最新版本测试仓库

新建仓库：

```text
2fa-upgrade-latest-manual
```

把当前本地最新代码推上去：

```bash
git push https://github.com/<你的 GitHub 用户名>/2fa-upgrade-latest-manual.git HEAD:refs/heads/main
```

## 10.2 连接 Cloudflare Worker

新建 Worker：

```text
2fa-test-latest
```

配置仍然固定为：

- 根目录：`/`
- 构建命令：`npm run build`
- 部署命令：`npm run deploy`
- 版本命令：`npm run deploy`

## 10.3 第一次构建完成后验证

需要确认：

- 构建成功
- 日志里有：

  ```text
  Executing user deploy command: npm run deploy
  ```

- 日志里有：

  ```text
  env.SECRETS_KV
  ```

- 首次访问站点时可以进入设置密码流程
- 设置密码后能正常进入主界面
- 添加假数据后刷新仍存在

注意：

- 新用户首次部署时，首次进入 `/setup` 是正常的
- 只有“老用户升级后重新跳 `/setup`”才是不正常
- Cloudflare 的“一键部署模板”首次执行时，可能会出现 **两次构建**
  - 第一次：从模板/种子仓库复制代码并完成真实部署
  - 第二次：新建仓库后的首次自动分支构建
- 如果第一次构建成功，站点已经可用，而第二次构建因初始化时机问题失败，这一轮“首次一键部署”仍可判定为通过
- 为了确认后续正常构建链路也没问题，建议在你自己的新仓库里再提交一个很小的变更（例如改一行 `README.md`），观察下一次常规构建是否成功
- 首次一键部署时，应该只创建并绑定当前 Worker 需要的那一个 `SECRETS_KV`

---

## 11. 每次都要重点看哪些日志

请优先看下面几段。

### 11.1 正确的部署命令

应该看到：

```text
Executing user deploy command: npm run deploy
```

不应该看到：

```text
Executing user deploy command: npx wrangler deploy
```

### 11.2 正确的绑定

应该看到：

```text
Your Worker has access to the following bindings:
env.SECRETS_KV
env.SW_VERSION
```

### 11.3 老用户升级场景下，错误日志不应再出现

不应该再看到：

```text
Creating new KV Namespace "2fa-secrets-kv"
```

如果你在升级前已经手工绑回正确的旧 KV，升级后常见的正确表现是：

```text
env.SECRETS_KV (inherited)
```

---

## 12. 最终通过标准

### v1.0.0 升级通过标准

- `Sync Upstream` 成功
- Cloudflare 自动构建成功
- 升级后不跳 `/setup`
- 旧数据保留
- `env.SECRETS_KV` 仍存在

### v1.1.0 升级通过标准

- `Sync Upstream` 成功
- Cloudflare 自动构建成功
- 升级后不跳 `/setup`
- 旧数据保留
- `env.SECRETS_KV` 仍存在

### 最新版首次部署通过标准

- 第一次部署成功
- 只创建并使用一个 `SECRETS_KV`
- 能正常设置密码
- 能正常进入首页
- 能正常添加和保存假数据

---

## 13. 常见失败原因

### 13.1 `Actions` 里没有 `Sync Upstream`

原因：

- 旧用户自己账号下的独立仓库没有这个工作流文件

解决：

- 在**用户自己账号下的一键部署生成仓库**里手动新增 `/.github/workflows/sync-upstream.yml`

### 13.2 升级后跳回 `/setup`

原因通常是：

- `SECRETS_KV` 丢了

解决：

- 确认 Cloudflare Git 构建部署命令是 `npm run deploy`
- 确认最新构建日志里有 `env.SECRETS_KV`

### 13.3 升级时自动创建了新的 KV namespace

原因通常是：

- 本地或 Dashboard 里保留了旧的手工绑定配置
- 直接修改过 `wrangler.toml` 里的 KV 绑定

解决：

- 对照当前仓库的 `wrangler.toml` 恢复 `SECRETS_KV` 默认声明方式
- 重新触发一次 `npm run deploy`

### 13.4 日志里还有 routes / custom_domain 差异告警

这和 KV 绑定不是一回事。

说明：

- 你在 Dashboard 和仓库里的路由配置不一致
- 这不会直接说明升级失败

当前这份测试里，优先看：

- 是否跳 `/setup`
- 数据是否保留
- `env.SECRETS_KV` 是否还在

### 13.5 新用户首次一键部署时出现“第二次构建失败”

如果你看到第一次构建已经成功，Worker 也已经可用，但紧接着 Cloudflare 又触发了一次新的构建，而第二次失败：

- 先不要判定这次测试失败
- 先确认第一次构建是否已经成功部署
- 再确认站点是否已经可以正常使用
- 如果站点正常、`env.SECRETS_KV` 已绑定、可以设置密码并保存数据，那么“首次一键部署”场景仍然算通过

建议额外做一步确认：

- 在新建出来的用户仓库里手动提交一个很小的变更
- 看后续那次“常规构建”是否成功

如果后续常规构建成功，就说明失败的是模板初始化阶段的附带构建，不是项目配置本身的问题

### 13.6 最新版本一键部署时需要确认什么

如果你在做“最新版本首次一键部署”的回归：

- 打开最新一次成功构建日志
- 找到：

```text
Your Worker has access to the following bindings:
env.SECRETS_KV (...)
```

- 确认这里存在 `env.SECRETS_KV`
- 再去 Cloudflare 的 KV 列表里确认本次首次部署只新增了当前 Worker 使用的那一个 namespace

---

## 14. 最后建议

建议实际执行顺序：

1. 先做“最新版本首次部署”
2. 再做“v1.1.0 升级”
3. 最后做“v1.0.0 升级”

原因：

- 最新版本首次部署最容易验证
- `v1.1.0` 比 `v1.0.0` 离现在近，升级差异更小
- `v1.0.0` 变化最大，最后做最稳妥

---

## 15. 如果你测试过程中卡住

请把下面内容一次性贴出来，最容易判断问题：

- 当前测试的是哪个场景
- GitHub 仓库地址
- Cloudflare 构建日志里以下片段：
  - `Executing user deploy command`
  - `Your Worker has access to the following bindings`
  - `SECRETS_KV`
  - `Creating new KV Namespace`
  - `routes` / `custom_domain` warning
- 站点打开后是首页、登录页还是 `/setup`
