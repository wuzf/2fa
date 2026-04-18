/**
 * 构建发布版本的单文件 Worker
 *
 * 这个脚本将所有模块打包成单个 JS 文件，方便用户直接部署到 Cloudflare Workers
 *
 * 使用方法：
 * node scripts/build-release.js [--minify] [--output=dist/worker.js]
 */

import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// 解析命令行参数
const args = process.argv.slice(2);
const shouldMinify = args.includes('--minify');
const outputArg = args.find(arg => arg.startsWith('--output='));
const outputPath = outputArg
  ? join(rootDir, outputArg.split('=')[1])
  : join(rootDir, 'dist', 'worker.js');

console.log('🚀 开始构建 Release 版本...\n');

async function buildRelease() {
  try {
    // 确保输出目录存在
    const outputDir = dirname(outputPath);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    // 读取 package.json 获取版本信息
    const packageJson = JSON.parse(
      readFileSync(join(rootDir, 'package.json'), 'utf-8')
    );

    // 生成版本信息
    const buildDate = new Date().toISOString();
    const version = packageJson.version;
    const serviceWorkerVersion = `v${version}-${buildDate.replace(/[^\d]/g, '').slice(0, 14)}`;

    console.log('📦 项目信息：');
    console.log(`   名称: ${packageJson.name}`);
    console.log(`   版本: ${version}`);
    console.log(`   构建时间: ${buildDate}\n`);

    // 使用 esbuild 打包
    console.log('⚙️  正在打包模块...');
    const result = await build({
      entryPoints: [join(rootDir, 'src', 'worker.js')],
      bundle: true,
      format: 'esm',
      target: 'es2022',
      platform: 'neutral',
      mainFields: ['browser', 'module', 'main'],
      outfile: outputPath,
      minify: shouldMinify,
      sourcemap: false,
      banner: {
        js: `/**
 * 2FA Manager - Cloudflare Worker (Release Build)
 *
 * @name ${packageJson.name}
 * @version ${version}
 * @author ${packageJson.author}
 * @license ${packageJson.license}
 * @build ${buildDate}
 *
 * This is a bundled release version for easy deployment.
 * For source code, visit: https://github.com/wuzf/2fa
 */
`,
      },
      define: {
        'process.env.VERSION': JSON.stringify(version),
        'process.env.BUILD_DATE': JSON.stringify(buildDate),
        'globalThis.__BUILD_SW_VERSION__': JSON.stringify(serviceWorkerVersion),
      },
      external: [],
      logLevel: 'info',
    });

    // 获取文件大小
    const outputContent = readFileSync(outputPath, 'utf-8');
    const fileSizeKB = (Buffer.byteLength(outputContent, 'utf-8') / 1024).toFixed(2);

    console.log('\n✅ 构建成功！');
    console.log(`   输出文件: ${outputPath}`);
    console.log(`   文件大小: ${fileSizeKB} KB`);
    console.log(`   压缩模式: ${shouldMinify ? '已启用' : '未启用'}`);

    // 生成元数据文件
    const metadataPath = outputPath.replace('.js', '.metadata.json');
    const metadata = {
      name: packageJson.name,
      version: version,
      author: packageJson.author,
      license: packageJson.license,
      buildDate: buildDate,
      minified: shouldMinify,
      fileSizeKB: parseFloat(fileSizeKB),
      repository: packageJson.repository?.url || 'https://github.com/wuzf/2fa',
    };

    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    console.log(`   元数据文件: ${metadataPath}`);

    // 生成部署说明
    const readmePath = join(outputDir, 'DEPLOY.md');
    const deployReadme = `# 2FA Manager - 部署说明

## 📦 发布版本

- **版本**: ${version}
- **构建时间**: ${buildDate}
- **文件大小**: ${fileSizeKB} KB

## 🚀 部署到 Cloudflare Workers

### 方法 1: 使用 Cloudflare Dashboard (推荐)

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 选择 "Workers & Pages" → "Create application" → "Create Worker"
3. 点击 "Edit Code"
4. 复制 \`worker.js\` 的全部内容
5. 粘贴到编辑器中，替换默认代码
6. 点击 "Save and Deploy"

### 方法 2: 使用 Wrangler CLI

\`\`\`bash
# 安装 wrangler (如果还没安装)
npm install -g wrangler

# 登录 Cloudflare
wrangler login

# 部署 worker
wrangler deploy worker.js
\`\`\`

## ⚙️ 配置环境变量

部署后需要配置以下环境变量：

### 1. 创建 KV Namespace

\`\`\`bash
wrangler kv:namespace create SECRETS_KV
\`\`\`

或在 Dashboard 中：
- Workers & Pages → KV → Create namespace
- 名称：SECRETS_KV

### 2. 绑定 KV Namespace

在 Worker 设置中绑定 KV：
- Variable name: \`SECRETS_KV\`
- KV namespace: 选择刚创建的 namespace

### 3. 配置密钥（推荐）

\`\`\`bash
# 生成加密密钥
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 设置密钥
wrangler secret put ENCRYPTION_KEY
\`\`\`

或在 Dashboard 中：
- Worker 设置 → Variables → Add variable
- Variable name: \`ENCRYPTION_KEY\`
- Type: Secret
- Value: [你的 32 字节 base64 密钥]

### 4. 按需配置云盘 OAuth（可选）

如果你准备启用 OneDrive / Google Drive 远程备份，还需要额外配置：

- \`ONEDRIVE_CLIENT_ID\`
- \`ONEDRIVE_CLIENT_SECRET\`
- \`GOOGLE_DRIVE_CLIENT_ID\`
- \`GOOGLE_DRIVE_CLIENT_SECRET\`
- \`OAUTH_REDIRECT_BASE_URL\`（使用自定义域名时推荐显式配置，例如 \`https://2fa.example.com\`）

完成变量配置后，再参考网盘备份配置指南：

- https://github.com/wuzf/2fa/blob/main/docs/CLOUD_DRIVE_SETUP.md

### 5. Service Worker 版本

当前 release 构建已内嵌 Service Worker 版本回退值：

- \`${serviceWorkerVersion}\`

即使你直接把 \`dist/worker.js\` 粘贴到 Cloudflare Dashboard 部署，PWA 缓存版本也会随本次构建一起更新。

## 🔒 安全建议

1. **必须设置加密密钥**: 使用 \`ENCRYPTION_KEY\` 保护存储的 2FA 密钥
2. **设置访问密码**: 首次访问时会提示设置密码
3. **使用 HTTPS**: Cloudflare Workers 默认使用 HTTPS
4. **定期备份**: 使用应用内的备份功能定期导出数据
5. **保留原始加密密钥**: 丢失 \`ENCRYPTION_KEY\` 后无法解密已有密钥、备份和远程同步凭据

## 📚 更多信息

- [项目主页](https://github.com/wuzf/2fa)
- [完整文档](https://github.com/wuzf/2fa/blob/main/README.md)
- [部署指南](https://github.com/wuzf/2fa/blob/main/docs/DEPLOYMENT.md)
- [网盘备份配置指南](https://github.com/wuzf/2fa/blob/main/docs/CLOUD_DRIVE_SETUP.md)

## 📝 版本信息

\`\`\`json
${JSON.stringify(metadata, null, 2)}
\`\`\`
`;

    writeFileSync(readmePath, deployReadme);
    console.log(`   部署说明: ${readmePath}`);

    console.log('\n🎉 构建完成！\n');
    console.log('📖 接下来的步骤：');
    console.log('   1. 查看 dist/DEPLOY.md 了解部署说明');
    console.log('   2. 将 dist/worker.js 部署到 Cloudflare Workers');
    console.log('   3. 配置 KV namespace 和环境变量\n');

  } catch (error) {
    console.error('\n❌ 构建失败：', error);
    process.exit(1);
  }
}

buildRelease();
