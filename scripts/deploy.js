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
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { extractWorkerName, injectKvNamespaceId, injectWorkerVersion } from './deploy-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
const versionStrategy = args.includes('--git') ? '--git' :
  args.includes('--package') ? '--package' :
    '';

const envIndex = args.indexOf('--env');
const envArg = envIndex !== -1 && args[envIndex + 1] ? `--env ${args[envIndex + 1]}` : '';

console.log('');
console.log('🚀 ========================================');
console.log('   2FA Manager 自动化部署');
console.log('========================================');
console.log('');

try {
  const version = generateVersion(versionStrategy);
  const wranglerPath = join(__dirname, '..', 'wrangler.toml');
  const originalConfig = readFileSync(wranglerPath, 'utf-8');

  console.log(`   ✅ 版本号: ${version}`);
  console.log('');

  console.log('📝 Step 2: 注入版本到配置...');

  let modifiedConfig = injectWorkerVersion(originalConfig, version);

  console.log(`   ✅ 已注入版本: ${version}`);
  console.log('');

  // Step 2.5: 自动检测并绑定已有 KV namespace，防止重复创建
  console.log('🔍 Step 2.5: 检测已有 KV namespace...');
  const existingKv = findExistingKvId(extractWorkerName(modifiedConfig));
  if (existingKv) {
    modifiedConfig = injectKvNamespaceId(modifiedConfig, existingKv.id);
    console.log(`   ✅ 复用已有 KV: ${existingKv.title} (${existingKv.id})`);
  } else {
    console.log('   ℹ️ 未检测到已有 KV，将由 Wrangler 自动创建');
  }
  console.log('');

  writeFileSync(wranglerPath, modifiedConfig, 'utf-8');

  console.log('🚀 Step 3: 部署到 Cloudflare Workers...');
  console.log(`   命令: npx wrangler deploy ${envArg}`.trim());
  console.log('');

  try {
    execSync(`npx wrangler deploy ${envArg}`.trim(), {
      stdio: 'inherit',
      encoding: 'utf-8',
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
    console.log('🔄 Step 4: 恢复配置文件...');
    writeFileSync(wranglerPath, originalConfig, 'utf-8');
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

function generateVersion(versionStrategyArg) {
  console.log('📦 Step 1: 生成 Service Worker 版本号...');
  const versionCmd = `node ${join(__dirname, 'generate-version.js')} ${versionStrategyArg} --verbose`;
  return execSync(versionCmd, { encoding: 'utf-8' }).trim().split('\n')[0];
}

function findExistingKvId(workerName) {
  try {
    const output = execSync('npx wrangler kv namespace list', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const namespaces = JSON.parse(output);
    if (!namespaces.length) return null;

    // 按优先级匹配，覆盖 wrangler auto-provision、Dashboard 创建、老版本等命名格式
    const match =
      namespaces.find(ns => ns.title === `${workerName}-SECRETS_KV`) ||
      namespaces.find(ns => ns.title.includes('SECRETS_KV')) ||
      namespaces.find(ns => ns.title === workerName) ||
      (namespaces.length === 1 ? namespaces[0] : null);

    return match ? { id: match.id, title: match.title } : null;
  } catch {
    return null;
  }
}
