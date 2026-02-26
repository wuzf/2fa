#!/usr/bin/env node

/**
 * 自动化部署脚本
 *
 * 功能：
 * 1. 自动生成 Service Worker 版本号
 * 2. 注入版本到环境变量
 * 3. 执行 wrangler 部署
 *
 * 使用方式：
 *   node scripts/deploy.js                  # 使用时间戳版本
 *   node scripts/deploy.js --git            # 使用 git commit 版本
 *   node scripts/deploy.js --package        # 使用 package.json 版本
 *   node scripts/deploy.js --env production # 部署到生产环境
 */

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 解析命令行参数
const args = process.argv.slice(2);
const versionStrategy = args.includes('--git') ? '--git' :
                        args.includes('--package') ? '--package' :
                        '';

// 提取环境参数
const envIndex = args.indexOf('--env');
const envArg = envIndex !== -1 && args[envIndex + 1] ? `--env ${args[envIndex + 1]}` : '';

console.log('');
console.log('🚀 ========================================');
console.log('   2FA Manager 自动化部署');
console.log('========================================');
console.log('');

// Step 1: 生成版本号
console.log('📦 Step 1: 生成 Service Worker 版本号...');
try {
  const versionCmd = `node ${join(__dirname, 'generate-version.js')} ${versionStrategy} --verbose`;
  const version = execSync(versionCmd, { encoding: 'utf-8' }).trim().split('\n')[0];
  console.log(`   ✅ 版本号: ${version}`);
  console.log('');

  // Step 2: 临时修改 wrangler.toml
  console.log('📝 Step 2: 注入版本到配置...');
  const wranglerPath = join(__dirname, '..', 'wrangler.toml');

  // 读取原始配置
  const fs = await import('fs');
  const originalConfig = fs.readFileSync(wranglerPath, 'utf-8');

  let modifiedConfig = originalConfig;

  // 替换版本号
  modifiedConfig = modifiedConfig.replace(
    /SW_VERSION = "v1"/,
    `SW_VERSION = "${version}"`
  );

  // 检测 KV namespace 是否缺少 id，自动创建
  const kvBindingPattern = /\[\[kv_namespaces\]\]\r?\nbinding = "SECRETS_KV"/;
  const hasKvId = /\[\[kv_namespaces\]\]\r?\nbinding = "SECRETS_KV"\r?\nid = "/.test(modifiedConfig);
  if (kvBindingPattern.test(modifiedConfig) && !hasKvId) {
    console.log('   🔍 检测到 KV namespace 未配置 ID，自动创建...');

    // 先写入临时占位 ID，否则 wrangler 校验 toml 会报错
    const placeholderId = '00000000000000000000000000000000';
    const tempConfig = modifiedConfig.replace(
      kvBindingPattern,
      `[[kv_namespaces]]\nbinding = "SECRETS_KV"\nid = "${placeholderId}"`
    );
    fs.writeFileSync(wranglerPath, tempConfig, 'utf-8');

    try {
      const kvOutput = execSync('npx wrangler kv namespace create SECRETS_KV', {
        encoding: 'utf-8',
      });
      const idMatch = kvOutput.match(/id = "([a-f0-9]+)"/);
      if (idMatch) {
        const kvId = idMatch[1];
        modifiedConfig = modifiedConfig.replace(
          kvBindingPattern,
          `[[kv_namespaces]]\nbinding = "SECRETS_KV"\nid = "${kvId}"`
        );
        console.log(`   ✅ KV namespace 已创建: ${kvId}`);
      } else {
        console.warn('   ⚠️  无法从输出中提取 KV ID，尝试继续部署...');
      }
    } catch (kvError) {
      // 可能已存在同名 namespace，尝试从 list 中查找
      console.log('   🔍 创建失败，尝试查找已有的 KV namespace...');
      try {
        const listOutput = execSync('npx wrangler kv namespace list', { encoding: 'utf-8' });
        const namespaces = JSON.parse(listOutput);
        const existing = namespaces.find((ns) => ns.title.includes('2fa') && ns.title.includes('SECRETS_KV'));
        if (existing) {
          modifiedConfig = modifiedConfig.replace(
            kvBindingPattern,
            `[[kv_namespaces]]\nbinding = "SECRETS_KV"\nid = "${existing.id}"`
          );
          console.log(`   ✅ 找到已有 KV namespace: ${existing.id}`);
        } else {
          console.error('   ❌ 未找到匹配的 KV namespace');
          throw kvError;
        }
      } catch {
        throw kvError;
      }
    }
  }

  fs.writeFileSync(wranglerPath, modifiedConfig, 'utf-8');
  console.log(`   ✅ 已注入版本: ${version}`);
  console.log('');

  // Step 3: 执行部署
  console.log('🚀 Step 3: 部署到 Cloudflare Workers...');
  console.log(`   命令: npx wrangler deploy ${envArg}`.trim());
  console.log('');

  try {
    execSync(`npx wrangler deploy ${envArg}`.trim(), {
      stdio: 'inherit',
      encoding: 'utf-8'
    });

    console.log('');
    console.log('✅ ========================================');
    console.log('   部署成功！');
    console.log('========================================');
    console.log('');
    console.log(`📦 版本: ${version}`);
    console.log(`🌐 环境: ${envArg || '生产环境 (production)'}`);
    console.log('');

  } catch (deployError) {
    console.error('');
    console.error('❌ ========================================');
    console.error('   部署失败');
    console.error('========================================');
    console.error('');
    throw deployError;
  } finally {
    // Step 4: 恢复原始配置
    console.log('🔄 Step 4: 恢复配置文件...');
    fs.writeFileSync(wranglerPath, originalConfig, 'utf-8');
    console.log('   ✅ 配置已恢复');
    console.log('');
  }

} catch (error) {
  console.error('');
  console.error('❌ 部署流程失败:');
  console.error('   ', error.message);
  console.error('');
  process.exit(1);
}
