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

  // 检测 KV namespace 配置，自动查找或创建
  const hasKvBinding = /\[\[kv_namespaces\]\]\r?\nbinding = "SECRETS_KV"\r?\nid = "/.test(modifiedConfig);
  if (!hasKvBinding) {
    console.log('   🔍 检测到 KV namespace 未配置，查找已有的...');

    let kvId = null;

    // Step A: 先从已有的 KV namespace 中查找
    try {
      const listOutput = execSync('npx wrangler kv namespace list', { encoding: 'utf-8' });
      const namespaces = JSON.parse(listOutput);
      // 精确匹配 "SECRETS_KV"（deploy.js 创建的，用户数据在此）
      const existing = namespaces.find((ns) => ns.title === 'SECRETS_KV');
      if (existing) {
        kvId = existing.id;
        console.log(`   ✅ 找到已有 KV namespace "${existing.title}": ${kvId}`);
      }
    } catch {
      console.log('   ⚠️  查询 KV namespace 列表失败，尝试创建新的...');
    }

    // Step B: 没找到才创建
    if (!kvId) {
      try {
        console.log('   📦 未找到已有 KV namespace，创建新的...');
        const kvOutput = execSync('npx wrangler kv namespace create SECRETS_KV', {
          encoding: 'utf-8',
        });
        const idMatch = kvOutput.match(/id = "([a-f0-9]+)"/);
        if (idMatch) {
          kvId = idMatch[1];
          console.log(`   ✅ KV namespace 已创建: ${kvId}`);
        } else {
          console.warn('   ⚠️  无法从输出中提取 KV ID，尝试继续部署...');
        }
      } catch (kvError) {
        console.error('   ❌ 创建 KV namespace 失败');
        throw kvError;
      }
    }

    // 注入 KV 配置到 wrangler.toml
    if (kvId) {
      const kvBlock = `[[kv_namespaces]]\nbinding = "SECRETS_KV"\nid = "${kvId}"`;
      // 替换已有的注释块，或在 [vars] 前插入
      const commentedKvPattern = /# \[\[kv_namespaces\]\]\r?\n# binding = "SECRETS_KV"\r?\n(?:#[^\n]*\r?\n)*/;
      if (commentedKvPattern.test(modifiedConfig)) {
        modifiedConfig = modifiedConfig.replace(commentedKvPattern, kvBlock + '\n');
      } else {
        modifiedConfig = modifiedConfig.replace(/(\[vars\])/, kvBlock + '\n\n$1');
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
